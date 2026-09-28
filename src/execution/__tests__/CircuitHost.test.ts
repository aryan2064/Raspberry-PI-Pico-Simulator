import { describe, it, expect, beforeEach } from "vitest";
import { CircuitHost } from "../worker-core";
import type { ConnectMessage, SnapshotMessage } from "../messages";

// The worker's message-handling logic is exercised here directly: CircuitHost
// is the piece that owns the Circuit and applies every edit message, and it
// has no Worker/Pyodide dependency. What can't be tested in vitest is the
// actual Worker + Pyodide load/run path (importScripts/CDN are browser-only) —
// see README/docs for the manual browser verification of that part.

function addDemoBoard(host: CircuitHost): void {
  host.handleEdit({ type: "addComponent", componentId: "board", kind: "pico_board" });
  host.handleEdit({ type: "addComponent", componentId: "led", kind: "led" });
  host.handleEdit({ type: "addComponent", componentId: "button", kind: "button" });
}

function connect(host: CircuitHost, wireId: string, ownerA: string, labelA: string, ownerB: string, labelB: string): void {
  host.handleEdit({
    type: "connect",
    wireId,
    pinOwnerIdA: ownerA,
    pinLabelA: labelA,
    pinOwnerIdB: ownerB,
    pinLabelB: labelB,
  } as ConnectMessage);
}

function snapshot(host: CircuitHost): SnapshotMessage {
  return host.getSnapshot();
}

function renderInfoById(host: CircuitHost, id: string) {
  const found = snapshot(host).components.find((c) => c.id === id);
  if (!found) throw new Error(`no component ${id}`);
  return found.renderInfo;
}

describe("CircuitHost (worker-side message handling)", () => {
  let host: CircuitHost;

  beforeEach(() => {
    host = new CircuitHost();
  });

  it("adds components and reports their renderInfo in the snapshot", () => {
    addDemoBoard(host);
    const comps = snapshot(host).components;
    expect(comps).toHaveLength(3);
    expect(comps.map((c) => c.id)).toEqual(["board", "led", "button"]);
    expect(comps.find((c) => c.id === "led")!.renderInfo).toEqual({ type: "led", isOn: false, brightness: 0 });
    expect(comps.find((c) => c.id === "button")!.renderInfo).toEqual({ type: "button", isPressed: false });
  });

  it("is replay-safe: adding the same component id again is a no-op", () => {
    addDemoBoard(host);
    host.handleEdit({ type: "addComponent", componentId: "board", kind: "pico_board" });
    expect(snapshot(host).components).toHaveLength(3);
  });

  it("adds relay and transistor components and exposes their state pins in snapshots", () => {
    addDemoBoard(host);
    host.handleEdit({ type: "addComponent", componentId: "relay", kind: "relay" });
    host.handleEdit({ type: "addComponent", componentId: "transistor", kind: "transistor" });
    const comps = snapshot(host).components;
    expect(comps.map((c) => c.id)).toEqual(["board", "led", "button", "relay", "transistor"]);
    expect(comps.find((c) => c.id === "relay")!.renderInfo).toEqual({ type: "relay", energized: false });
    expect(comps.find((c) => c.id === "transistor")!.renderInfo).toEqual({
      type: "transistor",
      conducting: false,
    });
    expect(comps.find((c) => c.id === "relay")!.pins.map((p) => p.label)).toEqual([
      "in",
      "vcc",
      "gnd",
      "com",
      "no",
      "nc",
    ]);
    expect(comps.find((c) => c.id === "transistor")!.pins.map((p) => p.label)).toEqual([
      "base",
      "collector",
      "emitter",
    ]);
  });

  it("drives a connected LED via the machine.Pin bridge (same thread)", () => {
    addDemoBoard(host);
    connect(host, "w1", "board", "GPIO15", "led", "anode");

    // mirror what machine.Pin(15, machine.Pin.OUT) does:
    host.setupPin(15, 1); // OUT
    host.writePin(15, 1); // value(1)
    host.tick(1 / 60);

    expect(host.readPin(15)).toBe(1);
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: true, brightness: 1 });

    host.writePin(15, 0);
    host.tick(1 / 60);
    expect(host.readPin(15)).toBe(0);
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: false, brightness: 0 });
  });

  it("disconnect breaks a net so the driven pin no longer affects the LED", () => {
    addDemoBoard(host);
    connect(host, "w1", "board", "GPIO15", "led", "anode");
    host.setupPin(15, 1);
    host.writePin(15, 1);
    host.tick(1 / 60);
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: true, brightness: 1 });

    host.handleEdit({ type: "disconnect", wireId: "w1" });
    host.writePin(15, 1);
    host.tick(1 / 60);
    // anode's net no longer has a driver -> FLOATING -> LED off
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: false, brightness: 0 });

    // unknown wireId is a safe no-op
    host.handleEdit({ type: "disconnect", wireId: "does-not-exist" });
  });

  it("press/release messages flip the button and drive the connected LED", () => {
    addDemoBoard(host);
    // New passive button circuit: 3V3_OUT -> leg1a, leg2a -> GPIO15 -> LED.
    // Press bridges the strips (leg1a/leg2a), pulling the LED net up to 3V3_OUT.
    connect(host, "w1", "board", "3V3_OUT", "button", "leg1a");
    connect(host, "w2", "board", "GPIO15", "button", "leg2a");
    connect(host, "w3", "board", "GPIO15", "led", "anode");

    host.handleEdit({ type: "press", componentId: "button" });
    host.tick(1 / 60);
    expect(renderInfoById(host, "button")).toEqual({ type: "button", isPressed: true });
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: true, brightness: 1 });

    host.handleEdit({ type: "release", componentId: "button" });
    host.tick(1 / 60);
    expect(renderInfoById(host, "button")).toEqual({ type: "button", isPressed: false });
    // Driverless net (no pull set) -> FLOATING -> LED off.
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: false, brightness: 0 });
  });

  it("throws a useful error for invalid edits (worker turns it into an error message)", () => {
    addDemoBoard(host);
    expect(() =>
      host.handleEdit({ type: "connect", wireId: "w1", pinOwnerIdA: "nope", pinLabelA: "x", pinOwnerIdB: "board", pinLabelB: "GPIO1" } as ConnectMessage)
    ).toThrow(/No component with id "nope"/);
    expect(() =>
      host.handleEdit({ type: "press", componentId: "led" })
    ).toThrow(/is not a button/);
  });

  it("removeComponent removes the component and everything wired to its pins", () => {
    addDemoBoard(host);
    connect(host, "w1", "board", "3V3_OUT", "button", "leg1a");
    connect(host, "w2", "button", "leg2a", "board", "GPIO15");
    connect(host, "w3", "board", "GPIO15", "led", "anode");
    connect(host, "w4", "led", "cathode", "board", "GND");
    expect(host.circuit.wires).toHaveLength(4);

    host.handleEdit({ type: "removeComponent", componentId: "led" });

    // LED gone; both of its wires (w3, w4) went with it.
    expect(snapshot(host).components.map((c) => c.id)).toEqual(["board", "button"]);
    expect(host.circuit.wires).toHaveLength(2);

    // The surviving net resolves cleanly: pressing the button still drives
    // GPIO15 HIGH (IN listener) via the 3V3_OUT -> leg1a -> leg2a path.
    host.handleEdit({ type: "setupPin", gpio: 15, mode: "IN" });
    host.handleEdit({ type: "press", componentId: "button" });
    host.tick(1 / 60);
    expect(host.readPin(15)).toBe(1);

    // A later disconnect of a cascade-removed wire id is a safe no-op.
    host.handleEdit({ type: "disconnect", wireId: "w3" });
    expect(host.circuit.wires).toHaveLength(2);
  });

  it("surfaces a wired two-OUT conflict as conflictedPinIds and clears it on disconnect", () => {
    addDemoBoard(host);
    // 3V3_OUT (OUT HIGH) wired to GPIO15 when set to OUT LOW -> two OUT drivers.
    connect(host, "w1", "board", "3V3_OUT", "board", "GPIO15");
    host.setupPin(15, 1); // OUT
    host.writePin(15, 0); // LOW

    host.tick(1 / 60);

    const snap = snapshot(host);
    expect(snap.conflictedPinIds).toHaveLength(2);
    const conflicted = new Set(snap.conflictedPinIds);
    const board3V3 = host.componentById("board")!.pin("3V3_OUT");
    const boardGpio15 = host.componentById("board")!.pin("GPIO15");
    expect(conflicted.has(board3V3.id)).toBe(true);
    expect(conflicted.has(boardGpio15.id)).toBe(true);

    // Disconnect resolves the net back to a single driver: nothing conflicted.
    host.handleEdit({ type: "disconnect", wireId: "w1" });
    host.tick(1 / 60);
    expect(snapshot(host).conflictedPinIds).toHaveLength(0);
  });

  it("reports no conflicted pin ids while Python drives a single OUT pin", () => {
    addDemoBoard(host);
    connect(host, "w1", "board", "GPIO15", "led", "anode");
    host.setupPin(15, 1);
    host.writePin(15, 1);
    host.tick(1 / 60);
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: true, brightness: 1 });
    expect(snapshot(host).conflictedPinIds).toHaveLength(0);
  });

  it("refuses to remove the PicoBoard", () => {
    addDemoBoard(host);
    expect(() =>
      host.handleEdit({ type: "removeComponent", componentId: "board" })
    ).toThrow(/Cannot remove the PicoBoard/);
    // The board is still there — the error did not cascade anything away.
    expect(snapshot(host).components).toHaveLength(3);
  });

  it("removing an unknown component id is a safe no-op", () => {
    addDemoBoard(host);
    host.handleEdit({ type: "removeComponent", componentId: "does-not-exist" });
    expect(snapshot(host).components).toHaveLength(3);
  });

  it("setupPin message pre-configures a board GPIO's mode and pull", () => {
    addDemoBoard(host);
    const gpio15 = host.componentById("board")!.pin("GPIO15");
    expect(gpio15.mode).toBe("UNSET");
    expect(gpio15.pull).toBe("NONE");

    host.handleEdit({ type: "setupPin", gpio: 15, mode: "IN", pull: "DOWN" });

    expect(gpio15.mode).toBe("IN");
    expect(gpio15.pull).toBe("DOWN");
  });

  it("setupPin without pull defaults to NONE", () => {
    addDemoBoard(host);
    const gpio16 = host.componentById("board")!.pin("GPIO16");
    host.handleEdit({ type: "setupPin", gpio: 16, mode: "OUT" });
    expect(gpio16.mode).toBe("OUT");
    expect(gpio16.pull).toBe("NONE");
  });

  it("bridge setupPin forwards pull from machine.Pin third arg", () => {
    addDemoBoard(host);
    const gpio17 = host.componentById("board")!.pin("GPIO17");
    // Pull UP (numeric id 2 maps to "UP")
    host.setupPin(17, 0, 2);
    expect(gpio17.mode).toBe("IN");
    expect(gpio17.pull).toBe("UP");

    // Pull DOWN (numeric id 3 maps to "DOWN")
    host.setupPin(17, 0, 3);
    expect(gpio17.pull).toBe("DOWN");

    // No pull (null or undefined -> "NONE")
    host.setupPin(17, 0, null);
    expect(gpio17.pull).toBe("NONE");

    host.setupPin(17, 0);
    expect(gpio17.pull).toBe("NONE");
  });
});

describe("CircuitHost machine.PWM bridge (analog duty channel)", () => {
  let host: CircuitHost;

  beforeEach(() => {
    host = new CircuitHost();
  });

  function wiredLed() {
    addDemoBoard(host);
    connect(host, "w1", "board", "GPIO15", "led", "anode");
  }

  it("initPwm flips the pin to OUT mode (real Pico behavior), immediately", () => {
    wiredLed();
    const gpio15 = host.componentById("board")!.pin("GPIO15");
    expect(gpio15.mode).toBe("UNSET");

    host.initPwm(15);
    expect(gpio15.mode).toBe("OUT");
  });

  it("setAnalogDuty resolves immediately (read-after-write) and the LED reports matching brightness", () => {
    wiredLed();
    host.initPwm(15);
    host.setAnalogDuty(15, 0.25);

    // Same immediacy class as the pull fix: the write must already be visible
    // on the forwarding pin (LED anode) when the Python call returns — no
    // waiting for the next 60fps tick.
    expect(host.componentById("board")!.pin("GPIO15").analogValue).toBe(0.25);
    expect(host.componentById("led")!.pin("anode").analogValue).toBe(0.25);

    host.tick(1 / 60);
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: true, brightness: 0.25 });
  });

  it("duty extremes: full duty lights the LED, zero duty turns it off", () => {
    wiredLed();
    host.initPwm(15);

    host.setAnalogDuty(15, 1);
    host.tick(1 / 60);
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: true, brightness: 1 });

    host.setAnalogDuty(15, 0);
    host.tick(1 / 60);
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: false, brightness: 0 });
  });

  it("deinitPwm clears the analog channel and the LED falls back to the digital value", () => {
    wiredLed();
    host.setupPin(15, 1); // OUT
    host.writePin(15, 0); // digitally LOW
    host.initPwm(15);
    host.setAnalogDuty(15, 0.5);
    host.tick(1 / 60);
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: true, brightness: 0.5 });

    const gpio15 = host.componentById("board")!.pin("GPIO15");
    host.deinitPwm(15);
    expect(gpio15.analogValue).toBeNull();

    host.tick(1 / 60);
    // analog channel gone -> LED reflects the plain digital LOW again.
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: false, brightness: 0 });
  });

  it("an analog duty on a pin that is also digitally HIGH is a single driver, no conflict", () => {
    wiredLed();
    host.setupPin(15, 1);
    host.writePin(15, 1); // HIGH
    host.initPwm(15);
    host.setAnalogDuty(15, 0.4);
    host.tick(1 / 60);

    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: true, brightness: 0.4 });
    const snap = snapshot(host);
    expect(snap.conflictedPinIds).toHaveLength(0);
  });
});
