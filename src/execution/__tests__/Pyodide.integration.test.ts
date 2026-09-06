// End-to-end verification of the real Pyodide runtime against the worker's
// circuit logic. Skipped by default (Pyodide does not load inside jsdom and is
// heavy); run with:  npm run verify:python
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadPyodide } from "pyodide";
import { CircuitHost } from "../worker-core";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
// Vitest rewrites module URLs, so Pyodide cannot locate its own assets
// relative to import.meta.url. Resolve the installed package directory and
// hand the indexURL to loadPyodide explicitly.
const pyodideIndex = dirname(require.resolve("pyodide")).split("\\").join("/");
const shimSource = readFileSync(join(here, "..", "machine-shim.py"), "utf8");

// Same install step the worker performs, against a real Pyodide instance.
// The canRunSync flag mirrors the worker's bridge: it tells the shim whether
// pyodide.ffi.run_sync (JS Promise Integration) is usable for time.sleep, which
// is exactly what pyodide.ffi.can_run_sync() reports in the caller's runtime.
function installShim(py: any, host: CircuitHost, canRunSync: boolean): void {
  const bridge = {
    setup: (gpio: number, mode: number) => host.setupPin(gpio, mode),
    read: (gpio: number) => host.readPin(gpio),
    write: (gpio: number, value: number) => {
      host.writePin(gpio, value);
      host.tick(1 / 60);
    },
    canRunSync,
  };
  // The `js` module in Pyodide proxies JS globals, so the bridge must go on
  // globalThis (pyodide.globals only seeds the Python main namespace).
  (globalThis as unknown as Record<string, unknown>).__pico_bridge = bridge;
  py.globals.set("__pico_bridge", bridge);
  py.runPython(`
import sys, types
_src = ${JSON.stringify(shimSource)}
_m = types.ModuleType("machine")
exec(_src, _m.__dict__)
sys.modules["machine"] = _m
del _src, _m
`);
}

function demoHost(): CircuitHost {
  const host = new CircuitHost();
  host.handleEdit({ type: "addComponent", componentId: "board", kind: "pico_board" });
  host.handleEdit({ type: "addComponent", componentId: "led", kind: "led" });
  host.handleEdit({
    type: "connect",
    wireId: "w2",
    pinOwnerIdA: "board",
    pinLabelA: "GPIO15",
    pinOwnerIdB: "led",
    pinLabelB: "anode",
  });
  return host;
}

describe("Pyodide + machine shim (integration, real Pyodide in Node)", () => {
  it.skipIf(process.env.PICO_VERIFY_PYODIDE !== "1")(
    "runs machine.Pin code against the worker Circuit; JSPI sleep + forced busy-wait fallback; stdout; errors",
    async () => {
      const py = await loadPyodide({ indexURL: pyodideIndex });
      const host = demoHost();

      // Same detection the worker performs before installing the shim: probe
      // pyodide.ffi.can_run_sync() from inside a runPythonAsync call stack
      // (run_sync's precondition), which is how user code always runs. Node 26
      // enables JSPI by default, so on a modern runtime this reports True.
      const canRunSync =
        (await py.runPythonAsync("import pyodide\npyodide.ffi.can_run_sync()")) === true;
      expect(typeof canRunSync).toBe("boolean");

      installShim(py, host, canRunSync);

      // Machine.Pin drives the real Circuit: writing OUT HIGH must light the
      // wired LED, read() must return the written value, and an IN pin that is
      // undriven must read 0.
      py.runPython(`
import machine
import time

led = machine.Pin(15, machine.Pin.OUT)
led.value(1)
assert led.value() == 1

probe = machine.Pin(16, machine.Pin.IN)
assert probe.value() == 0
`);
      expect(host.readPin(15)).toBe(1);
      expect(host.getSnapshot().components.find((c) => c.id === "led")!.renderInfo).toEqual({
        type: "led",
        isOn: true,
      });

      // Turn it off and confirm via the engine, not just Python.
      py.runPython("led.value(0)");
      expect(host.readPin(15)).toBe(0);
      expect(host.getSnapshot().components.find((c) => c.id === "led")!.renderInfo).toEqual({
        type: "led",
        isOn: false,
      });

      // When JSPI is available (the common case on modern runtimes), time.sleep
      // takes the non-blocking path: pyodide.ffi.run_sync(asyncio.sleep(...))
      // from within the runPythonAsync stack. Assert it actually completes and
      // roughly honors the requested duration. (The JSPI benefit — the worker's
      // JS loop staying live mid-sleep — is what browser-verify step 8 proves;
      // here we assert the code path runs.)
      if (canRunSync) {
        const started = performance.now();
        await py.runPythonAsync("time.sleep(0.05)");
        const elapsed = performance.now() - started;
        expect(elapsed).toBeGreaterThan(30);
      }

      // The busy-wait fallback is verified deterministically by temporarily
      // forcing the fallback branch (the same branch a non-JSPI browser uses):
      // flipping the shared bridge object's canRunSync to false makes time.sleep
      // spin on time.monotonic(), blocking the Python thread (and here, the
      // whole event loop) for roughly the requested time.
      (globalThis as unknown as Record<string, { canRunSync: boolean }>).__pico_bridge.canRunSync =
        false;
      const started = performance.now();
      py.runPython("time.sleep(0.3)");
      const elapsed = performance.now() - started;
      expect(elapsed).toBeGreaterThan(250);

      // stdout reaches the caller via setStdout batched callback.
      let captured = "";
      py.setStdout({ batched: (text: string) => (captured += text) });
      py.runPython("print('hello-from-python')");
      expect(captured).toContain("hello-from-python");

      // Out-of-scope machine modules must raise a normal Python ImportError,
      // which the worker surfaces as an { type: "error" } message.
      expect(() => py.runPython("import machine.PWM")).toThrow();
    },
    60000
  );
});