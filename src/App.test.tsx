// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, act, render, screen } from "@testing-library/react";
import App from "./App";

// The app's whole interaction surface (palette drop, wiring, Stop) is the
// worker message queue. jsdom can't run a real Worker/Pyodide, so this file
// stubs the Worker constructor with one that plays back the worker side of
// the protocol: ack each addComponent with a snapshot containing that
// component. That makes these tests about App's real state transitions
// (topology record, positions map, replay-after-Stop), not a fake HTML layer.

interface FakeComponent {
  id: string;
  kind: string;
}

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  messages: unknown[] = [];
  components: FakeComponent[] = [];
  terminated = false;

  constructor() {
    FakeWorker.instances.push(this);
  }

postMessage(msg: unknown): void {
    this.messages.push(msg);
    const m = msg as { type: string };
    if (m.type === "addComponent") {
      const add = m as unknown as { componentId: string; kind: string };
      // Replay-safe, like the real CircuitHost.
      if (!this.components.some((c) => c.id === add.componentId)) {
        this.components.push({ id: add.componentId, kind: add.kind });
      }
      // The real worker posts a fresh snapshot after each edit.
      this.emitSnapshot();
    }
    if (m.type === "removeComponent") {
      const del = m as unknown as { componentId: string };
      this.components = this.components.filter((c) => c.id !== del.componentId);
      this.emitSnapshot();
    }
  }

  terminate(): void {
    this.terminated = true;
  }

private emitSnapshot(): void {
    // Pin ids in the fake snapshots are deterministic ("<component>:<label>");
    // the real worker re-reads engine pin ids each tick. No conflict is ever
    // emitted by the fake worker, so conflictedPinIds stays empty.
    const pinLabels: Record<string, string[]> = {
      pico_board: ["GPIO15", "GPIO16", "GPIO17", "GND", "3V3_OUT"],
      led: ["anode", "cathode"],
      button: ["leg1a", "leg1b", "leg2a", "leg2b"],
      relay: ["in", "vcc", "gnd", "com", "no", "nc"],
      transistor: ["base", "collector", "emitter"],
      stepper: ["in1", "in2", "in3", "in4", "vcc", "gnd"],
      pir: ["vcc", "out", "gnd"],
    };
    this.onmessage?.({
      data: {
        type: "snapshot",
        conflictedPinIds: [],
        components: this.components.map((c) => ({
          id: c.id,
          renderInfo:
            c.kind === "led"
              ? { type: "led", isOn: false, brightness: 0 }
              : c.kind === "button"
                ? { type: "button", isPressed: false }
                : c.kind === "relay"
                  ? { type: "relay", energized: false }
                  : c.kind === "transistor"
                    ? { type: "transistor", conducting: false }
                    : c.kind === "stepper"
                      ? { type: "stepper", angleDegrees: 0, direction: "none", stepsPerSecond: 0 }
                      : c.kind === "pir"
                        ? { type: "pir", motionActive: false }
                        : { type: "pico_board" },
          pins: (pinLabels[c.kind] ?? []).map((label) => ({
            id: `${c.id}:${label}`,
            label,
          })),
        })),
      },
    } as unknown as MessageEvent);
  }
}

function lastWorker(): FakeWorker {
  return FakeWorker.instances[FakeWorker.instances.length - 1];
}

function workerMessages(w: FakeWorker): Record<string, unknown>[] {
  return w.messages as Record<string, unknown>[];
}

// The drag wrapper `body-<id>` carries both the pointer handlers and the
// component's position (absolutely positioned with left/top in stage coords).
function bodyPosition(bodyTestId: string): { x: number; y: number } | null {
  const el = document.querySelector(`[data-testid="${bodyTestId}"]`);
  if (!el) return null;
  return {
    x: parseFloat((el as HTMLElement).style.left),
    y: parseFloat((el as HTMLElement).style.top),
  };
}

// Selects a component with a plain click (no drag): pointer-down + pointer-up
// on its body wrapper, staying under the 4px drag threshold.
function selectBody(bodyTestId: string): void {
  const svg = screen.getByTestId("circuit-canvas");
  fireEvent.pointerDown(screen.getByTestId(bodyTestId), { clientX: 100, clientY: 100 });
  fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });
}

// fireEvent.drop in this jsdom/testing-library version doesn't carry
// clientX/clientY, so drop the palette payload via a real MouseEvent. It must
// be dispatched inside act() so React 18 flushes the placement re-renders
// (the worker replies with a snapshot synchronously) before assertions run.
function dropLed(target: Element, x: number, y: number): void {
  const event = new MouseEvent("drop", {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, "dataTransfer", {
    value: { getData: () => "led" },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

beforeEach(() => {
  vi.stubGlobal("Worker", FakeWorker);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  FakeWorker.instances = [];
});

describe("App (worker lifecycle + palette placement)", () => {
  it("renders the palette with LED, Button, Relay, Transistor, Stepper, and PIR (no PicoBoard) and replays the demo wiring on first spawn", () => {
    render(<App />);

    expect(screen.getByTestId("palette-led")).toBeTruthy();
    expect(screen.getByTestId("palette-button")).toBeTruthy();
    expect(screen.getByTestId("palette-relay")).toBeTruthy();
    expect(screen.getByTestId("palette-transistor")).toBeTruthy();
    expect(screen.getByTestId("palette-stepper")).toBeTruthy();
    expect(screen.getByTestId("palette-pir")).toBeTruthy();
    expect(screen.queryByTestId("palette-pico_board")).toBeNull();

    // The first spawn rebuilt the whole demo topology.
    const messages = workerMessages(lastWorker());
    expect(messages.filter((m) => m.type === "addComponent")).toHaveLength(4);
    expect(messages.filter((m) => m.type === "connect")).toHaveLength(6);

    expect(screen.getByTestId("pico-board")).toBeTruthy();
    expect(screen.getByTestId("body-led")).toBeTruthy();
  });

  it("places a dropped LED with a fresh id, position, and worker message", () => {
    render(<App />);

    expect(screen.queryByTestId("body-placed-1")).toBeNull();

    dropLed(screen.getByTestId("circuit-canvas"), 600, 300);

    // The worker acked the addComponent with a snapshot, so the new LED
    // renders at the drop position.
    expect(screen.getByTestId("body-placed-1")).toBeTruthy();
    expect(bodyPosition("body-placed-1")).toEqual({ x: 600, y: 300 });
    expect(screen.getAllByTestId("led-body")).toHaveLength(3); // 2 demo + 1 placed

    expect(
      workerMessages(lastWorker()).some(
        (m) => m.type === "addComponent" && m.componentId === "placed-1" && m.kind === "led"
      )
    ).toBe(true);
  });

  it("wires a placed component through the existing pin-click flow", () => {
    render(<App />);
    dropLed(screen.getByTestId("circuit-canvas"), 600, 300);

    fireEvent.click(screen.getByTestId("pin-placed-1-anode"));
    fireEvent.click(screen.getByTestId("pin-board-GPIO17"));

    expect(
      workerMessages(lastWorker()).some(
        (m) =>
          m.type === "connect" &&
          m.wireId === "w7" &&
          m.pinOwnerIdA === "placed-1" &&
          m.pinLabelA === "anode" &&
          m.pinOwnerIdB === "board" &&
          m.pinLabelB === "GPIO17"
      )
    ).toBe(true);
  });

it("keeps a placed component (and its wire) after Stop respawns the worker", () => {
    render(<App />);
    dropLed(screen.getByTestId("circuit-canvas"), 600, 300);
    fireEvent.click(screen.getByTestId("pin-placed-1-anode"));
    fireEvent.click(screen.getByTestId("pin-board-GPIO17"));

    const first = lastWorker();
    expect(screen.getAllByTestId("led-body")).toHaveLength(3);

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    // Stop terminated the old worker and immediately spawned a fresh one.
    expect(first.terminated).toBe(true);
    expect(FakeWorker.instances).toHaveLength(2);
    const replayed = FakeWorker.instances[1];

    // The fresh worker received the placed component and its wire.
    expect(
      workerMessages(replayed).some((m) => m.type === "addComponent" && m.componentId === "placed-1" && m.kind === "led")
    ).toBe(true);
    expect(
      workerMessages(replayed).some((m) => m.type === "connect" && m.wireId === "w7")
    ).toBe(true);

    // And the UI re-rendered from the fresh worker's replay snapshots: the
    // placed LED is back at the same position (plain React state survived).
    expect(screen.getByTestId("body-placed-1")).toBeTruthy();
    expect(bodyPosition("body-placed-1")).toEqual({ x: 600, y: 300 });
    expect(screen.getByTestId("pico-board")).toBeTruthy();
  });

  it("deletes a selected placed component and its wire via the Delete button", () => {
    render(<App />);
    dropLed(screen.getByTestId("circuit-canvas"), 600, 300);
    fireEvent.click(screen.getByTestId("pin-placed-1-anode"));
    fireEvent.click(screen.getByTestId("pin-board-GPIO17"));
    expect(screen.getByTestId("wire-w7")).toBeTruthy();

    // A plain click selects the LED; it shows the highlight and the button.
    selectBody("body-placed-1");
    expect(
      document.querySelector(
        '[data-testid="body-placed-1"] [data-testid="led"][data-selected="true"]'
      )
    ).toBeTruthy();
    expect(screen.getByTestId("delete-component")).toBeTruthy();

    fireEvent.click(screen.getByTestId("delete-component"));

    // The LED and its wire disappear from the render…
    expect(screen.queryByTestId("body-placed-1")).toBeNull();
    expect(screen.queryByTestId("wire-w7")).toBeNull();
    expect(screen.getAllByTestId("led-body")).toHaveLength(2); // just the demo LEDs
    // …and the worker was told to remove it (cascading the wire there too).
    expect(
      workerMessages(lastWorker()).some(
        (m) => m.type === "removeComponent" && m.componentId === "placed-1"
      )
    ).toBe(true);
    // The board remains untouched.
    expect(screen.getByTestId("pico-board")).toBeTruthy();
  });

  it("deletes a selected placed component via the Delete/Backspace key", () => {
    render(<App />);
    dropLed(screen.getByTestId("circuit-canvas"), 600, 300);
    fireEvent.click(screen.getByTestId("pin-placed-1-anode"));
    fireEvent.click(screen.getByTestId("pin-board-GPIO17"));

    selectBody("body-placed-1");
    expect(screen.getByTestId("delete-component")).toBeTruthy();

    fireEvent.keyDown(window, { key: "Backspace" });

    expect(screen.queryByTestId("body-placed-1")).toBeNull();
    expect(screen.queryByTestId("wire-w7")).toBeNull();
    expect(
      workerMessages(lastWorker()).some(
        (m) => m.type === "removeComponent" && m.componentId === "placed-1"
      )
    ).toBe(true);
  });

  it("cannot delete the PicoBoard via either trigger", () => {
    render(<App />);
    expect(screen.getByTestId("pico-board")).toBeTruthy();

    // Selecting the board highlights it but offers no Delete button…
    selectBody("body-board");
    expect(
      document.querySelector('g[data-testid="pico-board"][data-selected="true"]')
    ).toBeTruthy();
    expect(screen.queryByTestId("delete-component")).toBeNull();

    // …and the Delete key is a no-op too.
    fireEvent.keyDown(window, { key: "Delete" });
    expect(
      workerMessages(lastWorker()).some((m) => m.type === "removeComponent")
    ).toBe(false);
    expect(screen.getByTestId("pico-board")).toBeTruthy();
  });

  it("does not re-add a deleted component after Stop respawns the worker", () => {
    render(<App />);
    dropLed(screen.getByTestId("circuit-canvas"), 600, 300);
    fireEvent.click(screen.getByTestId("pin-placed-1-anode"));
    fireEvent.click(screen.getByTestId("pin-board-GPIO17"));

    selectBody("body-placed-1");
    fireEvent.click(screen.getByTestId("delete-component"));
    expect(screen.queryByTestId("body-placed-1")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Stop" }));

    // Stop respawned a fresh worker; replay must NOT include the deleted part.
    expect(FakeWorker.instances).toHaveLength(2);
    const replayed = FakeWorker.instances[1];
    expect(
      workerMessages(replayed).some((m) => m.type === "addComponent" && m.componentId === "placed-1")
    ).toBe(false);
    expect(
      workerMessages(replayed).some((m) => m.type === "connect" && m.wireId === "w7")
    ).toBe(false);

    // The UI stays clean: no placed LED, no w7 wire, demo wiring intact.
    expect(screen.queryByTestId("body-placed-1")).toBeNull();
    expect(screen.queryByTestId("wire-w7")).toBeNull();
    expect(screen.getByTestId("wire-w2")).toBeTruthy();
    expect(screen.getByTestId("pico-board")).toBeTruthy();
  });

  it("Backspace while typing in the code editor never deletes a component", () => {
    render(<App />);
    dropLed(screen.getByTestId("circuit-canvas"), 600, 300);
    selectBody("body-placed-1");
    expect(screen.getByTestId("delete-component")).toBeTruthy();

    // Focus moves into the code editor (a textarea); Backspace must edit the
    // editor, not delete the selected component.
    const editor = screen.getByLabelText("MicroPython code");
    act(() => editor.focus());
    fireEvent.keyDown(window, { key: "Backspace" });

    expect(screen.getByTestId("body-placed-1")).toBeTruthy();
    expect(
      workerMessages(lastWorker()).some((m) => m.type === "removeComponent")
    ).toBe(false);
    // Selection intact — the Delete button is still there.
    expect(screen.getByTestId("delete-component")).toBeTruthy();
  });
});
