// The Pyodide Web Worker. It owns the live Circuit (via CircuitHost), runs
// the tick loop itself, and is the only place Pyodide / the machine shim
// lives. The main thread talks to it exclusively through postMessage —
// structured-cloneable messages defined in ./messages.
import { loadPyodide } from "pyodide";
import shimSource from "./machine-shim.py?raw";
import { CircuitHost } from "./worker-core";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./messages";

const host = new CircuitHost();

// Minimal typed view of the Worker global (avoids mixing DOM + webworker libs).
const ctx = globalThis as unknown as {
  postMessage(message: WorkerToMainMessage): void;
  onmessage: ((event: MessageEvent<MainToWorkerMessage>) => void) | null;
};

// Nothing here may ever fail silently: route worker-level crashes back to the
// main thread so the app can show them instead of leaving a dead-looking UI.
function signalError(message: string): void {
  ctx.postMessage({ type: "error", message });
}
globalThis.addEventListener("error", (e) => {
  signalError(
    `Worker error: ${e.message ?? "unknown"}${e.filename ? ` (${e.filename}:${e.lineno})` : ""}`
  );
});
globalThis.addEventListener("unhandledrejection", (e) => {
  const reason = (e as unknown as { reason?: unknown }).reason;
  signalError(
    "Worker unhandled rejection: " +
      (reason instanceof Error ? reason.message : String(reason))
  );
});

// Own simulation loop — same ~60fps cadence the canvas used to run. Each tick
// re-reads every component and posts the full snapshot.
setInterval(() => {
  host.tick(1 / 60);
  ctx.postMessage(host.getSnapshot());
}, 1000 / 60);

ctx.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;
  if (msg.type === "run") {
    void runCode(msg.code);
    return;
  }
  try {
    host.handleEdit(msg);
    // Reflect a topology edit immediately, not one loop tick later.
    ctx.postMessage(host.getSnapshot());
  } catch (err) {
    signalError(err instanceof Error ? err.message : String(err));
  }
};

// ---- Pyodide + machine shim ----
//
// We load Pyodide's JS runtime from its official npm package (its ESM build,
// imported above so it bundles cleanly into this module worker). Only the
// static WebAssembly/stdlib assets come from the CDN (the npm package fetches
// them relative to indexURL at load time). This deliberately avoids
// importScripts entirely: that API exists only in classic workers, and the
// npm loader rejects classic workers outright ("Classic web workers are not
// supported").
const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v314.0.6/full/";

let pyodide: any = null;
let pyodideLoading: Promise<void> | null = null;

async function ensurePyodide(): Promise<any> {
  if (pyodide) return pyodide;
  if (!pyodideLoading) {
    // Eagerly (and exactly once) fetch Pyodide on worker start, so a failed
    // load surfaces immediately here rather than on the first Run click.
    pyodideLoading = (async () => {
      pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });

      // JS Promise Integration (JSPI / stack switching) lets a Python call
      // that awaits a JS timer suspend the Python script while freeing this
      // worker's JS event loop — which is exactly what a non-blocking
      // time.sleep needs. Detection gotcha (verified empirically): Pyodide's
      // pyodide.ffi.can_run_sync() reports False for a plain top-level call
      // even in a JSPI-capable browser, because run_sync's precondition is
      // that the current Python stack was entered via runPythonAsync. User
      // code always runs under runPythonAsync here, so probe from that exact
      // context: True iff run_sync will actually work for user scripts. The
      // result is passed to the shim via the bridge, so time.sleep can choose
      // between the JSPI path and the busy-wait fallback. (Note: pyodide.ffi
      // from JS is Pyodide's JS-side ffi namespace, NOT the pyodide.ffi Python
      // module — so it must be reached through pyimport. Guard with try/catch:
      // any failure just means "no JSPI" -> busy-wait fallback.)
      let jsPiAvailable = false;
      try {
        jsPiAvailable =
          (await pyodide.runPythonAsync(
            "import pyodide\npyodide.ffi.can_run_sync()"
          )) === true;
      } catch {
        jsPiAvailable = false;
      }

      // Bridge the shim's machine.Pin calls straight onto the live Circuit on
      // this same thread. Writes tick the sim immediately and post a snapshot
      // so the UI reacts even while a Python script holds the worker busy.
      const bridge = {
        setup: (gpio: number, mode: number, pull?: number | null) =>
          host.setupPin(gpio, mode, pull),
        read: (gpio: number) => host.readPin(gpio),
        write: (gpio: number, value: number) => {
          host.writePin(gpio, value);
          host.tick(1 / 60);
          ctx.postMessage(host.getSnapshot());
        },
        // The sim clock + sub-tick advance used by the browser-verify TRIG/ECHO
        // measurement script. A single 1/60s tick is ~287 cm of HC-SR04
        // round-trip time, so at 60fps an echo pulse is only observable for
        // distances ≳287 cm and never measured correctly — Python must instead
        // step the sim itself. micros() timestamps on the shared sim clock
        // (advanced only by tick()/tickUs(), never wall-clock), and tickUs()
        // advances the circuit in µs increments without posting snapshots, so
        // a script can wait out an echo affordably. Normal scripts never touch
        // these — they run the usual 60fps loop.
        micros: () => host.getSimTimeMicros(),
        tickUs: (us: number) => host.tick(us / 1e6),
        // machine.PWM — mirror the write pattern above: set duty, then tick
        // (so the LED's update() sees the new analog value immediately) and
        // post a snapshot so the UI reacts in the same turn the Python write
        // returns, even while a script holds the worker busy.
        pwmSetup: (gpio: number) => host.initPwm(gpio),
        pwmDuty: (gpio: number, duty: number) => {
          host.setAnalogDuty(gpio, duty);
          host.tick(1 / 60);
          ctx.postMessage(host.getSnapshot());
        },
        pwmDeinit: (gpio: number) => {
          host.deinitPwm(gpio);
          host.tick(1 / 60);
          ctx.postMessage(host.getSnapshot());
        },
        // The sleep implementation the machine shim should use (see
        // machine-shim.py): true -> non-blocking JSPI sleep; false/absent ->
        // keep the historical busy-wait.
        canRunSync: jsPiAvailable,
      };
      // The shim imports the bridge as `from js import __pico_bridge`; Pyodide's
      // `js` module is a proxy of the JS global scope, so the bridge must live
      // on globalThis (pyodide.globals only covers the Python main namespace).
      (globalThis as unknown as Record<string, unknown>).__pico_bridge = bridge;
      pyodide.globals.set("__pico_bridge", bridge);

      // Install the shim as the importable `machine` module.
      const install = `
import sys, types
_src = ${JSON.stringify(shimSource)}
_m = types.ModuleType("machine")
exec(_src, _m.__dict__)
sys.modules["machine"] = _m
del _src, _m
`;
      pyodide.runPython(install);

      // Route Python stdout/stderr to the main thread as messages.
      pyodide.setStdout({
        batched: (text: string) => ctx.postMessage({ type: "stdout", text }),
      });
      pyodide.setStderr({
        batched: (text: string) => ctx.postMessage({ type: "error", message: text }),
      });

      ctx.postMessage({ type: "ready" });
    })().catch((err) => {
      pyodide = null;
      pyodideLoading = null;
      throw err;
    });
  }
  await pyodideLoading;
  return pyodide;
}

async function runCode(code: string) {
  try {
    const py = await ensurePyodide();
    // runPythonAsync, not runPython: a regular runPython call never yields a JS
    // stack that can be suspended, so pyodide.ffi.run_sync() (used by the JSPI
    // sleep in machine-shim.py) would be unusable and time.sleep would have to
    // busy-wait. With runPythonAsync, a sleeping script frees this worker's JS
    // event loop (tick loop, button relays, future run messages) for the whole
    // duration. Without JSPI the shim falls back to the busy-wait, which blocks
    // the worker exactly as it did under runPython.
    await py.runPythonAsync(code);
  } catch (err) {
    signalError(err instanceof Error ? err.message : String(err));
  }
}

// Warm Pyodide on boot so the first Run is instant; failures surface via the
// error listener above / the catch in ensurePyodide.
void ensurePyodide();

export {};