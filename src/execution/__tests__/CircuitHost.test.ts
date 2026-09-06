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
    expect(comps.find((c) => c.id === "led")!.renderInfo).toEqual({ type: "led", isOn: false });
    expect(comps.find((c) => c.id === "button")!.renderInfo).toEqual({ type: "button", isPressed: false });
  });

  it("is replay-safe: adding the same component id again is a no-op", () => {
    addDemoBoard(host);
    host.handleEdit({ type: "addComponent", componentId: "board", kind: "pico_board" });
    expect(snapshot(host).components).toHaveLength(3);
  });

  it("drives a connected LED via the machine.Pin bridge (same thread)", () => {
    addDemoBoard(host);
    connect(host, "w1", "board", "GPIO15", "led", "anode");

    // mirror what machine.Pin(15, machine.Pin.OUT) does:
    host.setupPin(15, 1); // OUT
    host.writePin(15, 1); // value(1)
    host.tick(1 / 60);

    expect(host.readPin(15)).toBe(1);
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: true });

    host.writePin(15, 0);
    host.tick(1 / 60);
    expect(host.readPin(15)).toBe(0);
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: false });
  });

  it("disconnect breaks a net so the driven pin no longer affects the LED", () => {
    addDemoBoard(host);
    connect(host, "w1", "board", "GPIO15", "led", "anode");
    host.setupPin(15, 1);
    host.writePin(15, 1);
    host.tick(1 / 60);
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: true });

    host.handleEdit({ type: "disconnect", wireId: "w1" });
    host.writePin(15, 1);
    host.tick(1 / 60);
    // anode's net no longer has a driver -> FLOATING -> LED off
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: false });

    // unknown wireId is a safe no-op
    host.handleEdit({ type: "disconnect", wireId: "does-not-exist" });
  });

  it("press/release messages flip the button and drive the connected LED", () => {
    addDemoBoard(host);
    connect(host, "w1", "button", "signal", "board", "GPIO15");
    connect(host, "w2", "board", "GPIO15", "led", "anode");

    host.handleEdit({ type: "press", componentId: "button" });
    host.tick(1 / 60);
    host.tick(1 / 60); // LED caches isOn in update(); the button drives the
    // net during update(), so the LED lights one tick later.
    expect(renderInfoById(host, "button")).toEqual({ type: "button", isPressed: true });
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: true });

    host.handleEdit({ type: "release", componentId: "button" });
    host.tick(1 / 60);
    host.tick(1 / 60);
    expect(renderInfoById(host, "button")).toEqual({ type: "button", isPressed: false });
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: false });
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
    connect(host, "w1", "button", "signal", "board", "GPIO15");
    connect(host, "w2", "board", "GPIO15", "led", "anode");
    connect(host, "w3", "led", "cathode", "board", "GND");
    expect(host.circuit.wires).toHaveLength(3);

    host.handleEdit({ type: "removeComponent", componentId: "led" });

    // LED gone; only the LED's own two wires went with it.
    expect(snapshot(host).components.map((c) => c.id)).toEqual(["board", "button"]);
    expect(host.circuit.wires).toHaveLength(1);

    // The surviving net resolves cleanly: pressing the button still drives
    // GPIO15 HIGH (listening mode) even though nothing listens on it anymore.
    host.setupPin(15, 0); // GPIO15 as IN listener
    host.handleEdit({ type: "press", componentId: "button" });
    host.tick(1 / 60);
    expect(host.readPin(15)).toBe(1);

    // A later disconnect of a cascade-removed wire id is a safe no-op.
    host.handleEdit({ type: "disconnect", wireId: "w2" });
    expect(host.circuit.wires).toHaveLength(1);
  });

  it("surfaces a wired two-OUT conflict as conflictedPinIds and clears it on disconnect", () => {
    addDemoBoard(host);
    connect(host, "w1", "button", "signal", "board", "GPIO15");
    // GPIO15 is the second driver: the button's signal pin is already OUT, so
    // OUT + OUT on one net is a genuine conflict (mirrors wiring a board GPIO
    // to another board pin, or to the button, like a real short).
    host.setupPin(15, 1); // OUT

    host.tick(1 / 60);

    const snap = snapshot(host);
    expect(snap.conflictedPinIds).toHaveLength(2);
    const conflicted = new Set(snap.conflictedPinIds);
    const buttonSignal = host.componentById("button")!.pin("signal");
    const boardGpio15 = host.componentById("board")!.pin("GPIO15");
    expect(conflicted.has(buttonSignal.id)).toBe(true);
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
    expect(renderInfoById(host, "led")).toEqual({ type: "led", isOn: true });
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
});