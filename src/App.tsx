import { useCallback, useEffect, useRef, useState } from "react";
import { CircuitCanvas } from "./ui/CircuitCanvas";
import { ScriptPanel } from "./ui/ScriptPanel";
import type { OutputEntry } from "./ui/ScriptPanel";
import { OutputConsole } from "./ui/OutputConsole";
import type { Vec } from "./ui/types";
import type { ComponentKind, PinRef, SnapshotMessage, Topology, WorkerToMainMessage } from "./execution/messages";

// The demo circuit everyone starts with. Two independent nets so the
// interactive demo and the Python demo never fight:
//   - 3V3_OUT -> button leg1a; button leg2a -> GPIO15 -> LED1. The button is
//     a passive switch: at rest its strips are open, and GPIO15 (pre-configured
//     IN with an internal pull-DOWN in pinSetups, the same reason the demo
//     pre-sets pin state at all — it must work out of the box) keeps the
//     node LOW so LED1 is off. While held, the switch bridges the two strips
//     (leg1a-leg2a) up to 3V3_OUT and LED1 lights; on release it drops back
//     LOW. Press-and-hold the green button to light LED1.
//   - LED2 <-> GPIO16 (driven by the default MicroPython script)
const INITIAL_TOPOLOGY: Topology = {
  components: [
    { id: "board", kind: "pico_board" },
    { id: "led", kind: "led" },
    { id: "button", kind: "button" },
    { id: "led2", kind: "led" },
  ],
  // Pin pre-configuration replayed into every fresh worker alongside the
  // wiring: GPIO15 is an IN input with an internal pull-down (like wiring a
  // real button with PULL_DOWN software-wise). No Python runs to set this —
  // it's part of the demo topology itself.
  pinSetups: [{ type: "setupPin", gpio: 15, mode: "IN", pull: "DOWN" }],
  connections: [
    { wireId: "w1", from: { componentId: "board", pinLabel: "3V3_OUT" }, to: { componentId: "button", pinLabel: "leg1a" } },
    { wireId: "w2", from: { componentId: "button", pinLabel: "leg2a" }, to: { componentId: "board", pinLabel: "GPIO15" } },
    { wireId: "w3", from: { componentId: "board", pinLabel: "GPIO15" }, to: { componentId: "led", pinLabel: "anode" } },
    { wireId: "w4", from: { componentId: "led", pinLabel: "cathode" }, to: { componentId: "board", pinLabel: "GND" } },
    { wireId: "w5", from: { componentId: "led2", pinLabel: "anode" }, to: { componentId: "board", pinLabel: "GPIO16" } },
    { wireId: "w6", from: { componentId: "led2", pinLabel: "cathode" }, to: { componentId: "board", pinLabel: "GND" } },
  ],
};

const EMPTY_SNAPSHOT: SnapshotMessage = {
  type: "snapshot",
  components: [],
  conflictedPinIds: [],
};

// Starting layout for the fixed demo parts, keyed by component id. Positions
// are a main-thread/UI concern only — the worker and engine have no concept
// of them — so the demo's first layout is computed here, once, into React
// state (see `positions` below) and never sent to the worker.
function initialPositions(components: Topology["components"]): Record<string, Vec> {
  const out: Record<string, Vec> = {};
  components.forEach((c, i) => {
    // Same 3-column grid the canvas has always used.
    const col = i % 3;
    const row = Math.floor(i / 3);
    out[c.id] = { x: 40 + col * 360, y: 40 + row * 200 };
  });
  return out;
}

function App() {
  // --- Theme handling (light / dark) -------------------------------------------------
  // Persisted user preference ("light" | "dark"). If missing, follow system.
  const [theme, setTheme] = useState(() => {
    // LocalStorage value may be "light" or "dark"
    try {
      const stored = localStorage.getItem("pico-sim-theme");
      if (stored === "light" || stored === "dark") return stored;
    } catch (_) {}
    // No stored pref → follow system preference if available
    if (typeof window !== "undefined" && window.matchMedia) {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return "light";
  });

  // Apply the effective theme to the document root.  Using a data attribute lets CSS
  // token overrides stay simple.
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("pico-sim-theme", theme);
    } catch (_) {}
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "light" ? "dark" : "light"));
  }, []);
  // -----------------------------------------------------------------------------------
  const workerRef = useRef<Worker | null>(null);
  const workerTimerRef = useRef<number | null>(null);
  const respondedRef = useRef(false);
  const nextWireIdRef = useRef(7); // w1..w6 are taken by the demo wiring
  const nextComponentIdRef = useRef(1); // placed-1, placed-2, ...

  // Authoritative topology record — NOT used for rendering (snapshots are).
  // It exists so a terminated worker's state can be rebuilt exactly. Every
  // palette-placed component is appended here, so it survives Stop/replay.
  const topologyRef = useRef<Topology>(INITIAL_TOPOLOGY);

  const [snapshot, setSnapshot] = useState<SnapshotMessage>(EMPTY_SNAPSHOT);
  const [connections, setConnections] = useState<Topology["connections"]>(INITIAL_TOPOLOGY.connections);
  const [output, setOutput] = useState<OutputEntry[]>([]);
  const [workerIssue, setWorkerIssue] = useState<string | null>(null);
  // Component positions (UI-only). Plain React state survives worker
  // termination — a Stop respawn never touches it.
  const [positions, setPositions] = useState<Record<string, Vec>>(() =>
    initialPositions(INITIAL_TOPOLOGY.components)
  );

  function handleWorkerMessage(msg: WorkerToMainMessage) {
    switch (msg.type) {
      case "snapshot":
        respondedRef.current = true;
        setWorkerIssue(null);
        setSnapshot(msg);
        break;
      case "stdout":
        setOutput((prev) => [...prev.slice(-199), { kind: "stdout", text: msg.text }]);
        break;
      case "error":
        setWorkerIssue(msg.message);
        setOutput((prev) => [...prev.slice(-199), { kind: "error", text: msg.message }]);
        break;
      case "ready":
        // Pyodide + shim installed in the worker — nothing to do yet; Run is always allowed.
        break;
    }
  }

  // Spawns a fresh worker and replays the current topology into it. Used on
  // mount AND after Stop — this is how wiring survives a terminated worker.
  const spawnWorker = useCallback(() => {
    // Module worker: it needs ES import support (engine + pyodide npm package).
    // Vite serves the *classic* variant with top-level `import` statements in
    // dev, which is a syntax error in a classic worker script — the worker
    // would die silently on boot (no snapshot, blank canvas, dead Run/Stop).
    const worker = new Worker(new URL("./execution/pyodide.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    respondedRef.current = false;

    // Surface worker failures in the output panel on the main thread — worker
    // boot/parse errors and message deserialization errors are silent by default.
    worker.onerror = (e: ErrorEvent) => {
      if (worker !== workerRef.current) return; // stale worker (terminated)
      const detail = e.message || `worker.onerror at ${e.filename ?? "?"}:${e.lineno ?? "?"}`;
      setWorkerIssue(`Worker error: ${detail}`);
      setOutput((prev) => [...prev.slice(-199), { kind: "error", text: detail }]);
    };
    worker.onmessageerror = (e: MessageEvent) => {
      if (worker !== workerRef.current) return; // stale worker (terminated)
      setWorkerIssue("Worker message decode error");
      setOutput((prev) => [
        ...prev.slice(-199),
        { kind: "error", text: "worker.onmessageerror: " + String(e.data ?? "") },
      ]);
    };

    worker.onmessage = (e: MessageEvent<WorkerToMainMessage>) => {
      if (worker !== workerRef.current) return; // stale worker (terminated)
      handleWorkerMessage(e.data);
    };

    // Watchdog: if the worker never posts a first snapshot, tell the user
    // instead of leaving a blank canvas with dead-feeling buttons.
    workerTimerRef.current = window.setTimeout(() => {
      if (worker !== workerRef.current) return;
      if (!respondedRef.current) {
        setWorkerIssue("Worker did not respond");
        setOutput((prev) => [...prev.slice(-199), { kind: "error", text: "Worker did not respond within 5s" }]);
      }
    }, 5000);

    for (const c of topologyRef.current.components) {
      worker.postMessage({ type: "addComponent", componentId: c.id, kind: c.kind });
    }
    for (const conn of topologyRef.current.connections) {
      worker.postMessage({
        type: "connect",
        wireId: conn.wireId,
        pinOwnerIdA: conn.from.componentId,
        pinLabelA: conn.from.pinLabel,
        pinOwnerIdB: conn.to.componentId,
        pinLabelB: conn.to.pinLabel,
      });
    }
    for (const pinSetup of topologyRef.current.pinSetups ?? []) {
      worker.postMessage(pinSetup);
    }
  }, []);

  useEffect(() => {
    spawnWorker();
    return () => {
      if (workerTimerRef.current !== null) {
        clearTimeout(workerTimerRef.current);
        workerTimerRef.current = null;
      }
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, [spawnWorker]);

  // ---- relays: canvas/user interactions -> worker messages ----

  const handleConnect = useCallback((from: PinRef, to: PinRef) => {
    const wireId = `w${nextWireIdRef.current++}`;
    const conn = { wireId, from, to };
    topologyRef.current = {
      ...topologyRef.current,
      connections: [...topologyRef.current.connections, conn],
    };
    setConnections(topologyRef.current.connections);
    workerRef.current?.postMessage({
      type: "connect",
      wireId: conn.wireId,
      pinOwnerIdA: from.componentId,
      pinLabelA: from.pinLabel,
      pinOwnerIdB: to.componentId,
      pinLabelB: to.pinLabel,
    });
  }, []);

  const handleDisconnect = useCallback((wireId: string) => {
    topologyRef.current = {
      ...topologyRef.current,
      connections: topologyRef.current.connections.filter((c) => c.wireId !== wireId),
    };
    setConnections(topologyRef.current.connections);
    workerRef.current?.postMessage({ type: "disconnect", wireId });
  }, []);

  const handlePress = useCallback((componentId: string) => {
    workerRef.current?.postMessage({ type: "press", componentId });
  }, []);

  const handleRelease = useCallback((componentId: string) => {
    workerRef.current?.postMessage({ type: "release", componentId });
  }, []);

  // Potentiometer knob drag — straight passthrough to the worker; the engine
  // publishes the new wiper fraction immediately and the snapshot loop picks
  // it up (see pyodide.worker.ts handleEdit). No topology change involved.
  const handleKnobPosition = useCallback((componentId: string, knobPosition: number) => {
    workerRef.current?.postMessage({ type: "setKnobPosition", componentId, knobPosition });
  }, []);

  // Ultrasonic distance slider drag — same relay shape as the knob above: the
  // worker routes it to UltrasonicSensor.setSimulatedDistance() and the
  // snapshot loop reflects it. null = "no object in front".
  const handleDistanceChange = useCallback(
    (componentId: string, simulatedDistanceCm: number | null) => {
      workerRef.current?.postMessage({
        type: "setSimulatedDistance",
        componentId,
        simulatedDistanceCm,
      });
    },
    []
  );

  // A palette part was dropped on the canvas. Record it in the topology (so a
  // later Stop/respawn rebuilds it), give it its dropped position, and send
  // the same addComponent message the init/replay path uses — the worker
  // treats it identically whenever it arrives.
  const handlePlaceComponent = useCallback((position: Vec, kind: ComponentKind) => {
    const componentId = `placed-${nextComponentIdRef.current++}`;
    topologyRef.current = {
      ...topologyRef.current,
      components: [...topologyRef.current.components, { id: componentId, kind }],
    };
    setPositions((prev) => ({ ...prev, [componentId]: position }));
    workerRef.current?.postMessage({ type: "addComponent", componentId, kind });
  }, []);

  const handleMoveComponent = useCallback((componentId: string, position: Vec) => {
    setPositions((prev) => ({ ...prev, [componentId]: position }));
  }, []);

  // The canvas calls this when the user deletes a selected component (Delete
  // button or Delete/Backspace key — one shared path). The worker removes the
  // engine component (cascading its wires), and the main thread drops it from
  // the topology record and positions so it can't reappear on the next Stop.
  const handleDeleteComponent = useCallback((componentId: string) => {
    const target = topologyRef.current.components.find((c) => c.id === componentId);
    if (!target) return; // unknown id — nothing to delete
    if (target.kind === "pico_board") return; // the board is undeletable
    topologyRef.current = {
      components: topologyRef.current.components.filter((c) => c.id !== componentId),
      connections: topologyRef.current.connections.filter(
        (conn) => conn.from.componentId !== componentId && conn.to.componentId !== componentId
      ),
    };
    setConnections(topologyRef.current.connections);
    setPositions((prev) => {
      const next = { ...prev };
      delete next[componentId];
      return next;
    });
    workerRef.current?.postMessage({ type: "removeComponent", componentId });
  }, []);

  const handleRun = useCallback((code: string) => {
    setOutput([]);
    workerRef.current?.postMessage({ type: "run", code });
  }, []);

  // Stop is deliberately non-cooperative: a genuinely stuck loop (no sleep, no
  // yielding) would never process a "stop" message, so we terminate
  // unconditionally, then immediately respawn a fresh worker and replay the
  // topology so the wiring never visibly disappears.
  const handleStop = useCallback(() => {
    if (workerTimerRef.current !== null) {
      clearTimeout(workerTimerRef.current);
      workerTimerRef.current = null;
    }
    workerRef.current?.terminate();
    workerRef.current = null;
    spawnWorker();
  }, [spawnWorker]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          Pico Sim
        </div>
        <span className={workerIssue ? "status status-error" : "status"}>
          <span className="status-dot" aria-hidden />
          {workerIssue ? "Worker issue" : "Simulator ready"}
        </span>
        {/* Theme toggle (sun/moon) */}
        <button
          type="button"
          className="icon-btn"
          aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
          onClick={toggleTheme}
        >
          {theme === "light" ? "☀" : "☾"}
        </button>
      </header>
      {workerIssue && (
        <div role="alert" data-testid="worker-issue" className="worker-issue">
          {workerIssue}
        </div>
      )}
      <div className="workspace">
        <ScriptPanel onRun={handleRun} onStop={handleStop} />
        <main className="canvas-column">
          <CircuitCanvas
            snapshot={snapshot}
            connections={connections}
            positions={positions}
            onConnect={handleConnect}
            onDisconnect={handleDisconnect}
            onPress={handlePress}
            onRelease={handleRelease}
            onKnobChange={handleKnobPosition}
            onDistanceChange={handleDistanceChange}
            onMoveComponent={handleMoveComponent}
            onPlaceComponent={handlePlaceComponent}
            onDeleteComponent={handleDeleteComponent}
          />
          <OutputConsole output={output} />
        </main>
      </div>
    </div>
  );
}

export default App;