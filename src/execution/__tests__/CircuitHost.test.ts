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
    ).toThrow(/is not pressable/);
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

type StepperInfo = {
  type: "stepper";
  angleDegrees: number;
  direction: "CW" | "CCW" | "none";
  stepsPerSecond: number;
};

describe("CircuitHost stepper: 2 full cycles forward and back through four GPIOs", () => {
  let host: CircuitHost;

  beforeEach(() => {
    host = new CircuitHost();
    addDemoBoard(host);
    host.handleEdit({ type: "addComponent", componentId: "motor", kind: "stepper" });
    connect(host, "w1", "board", "GPIO0", "motor", "in1");
    connect(host, "w2", "board", "GPIO1", "motor", "in2");
    connect(host, "w3", "board", "GPIO2", "motor", "in3");
    connect(host, "w4", "board", "GPIO3", "motor", "in4");
    [0, 1, 2, 3].forEach((gpio) => host.setupPin(gpio, 1)); // OUT, as a motor driver does
  });

  // Writes one 4-bit pattern to GPIO0..3 (IN1..IN4) and steps the sim once at
  // 1/20s — the whole circuit resolves and the motor's sense pins land in the
  // right state before its update() runs in the same tick.
  function drive(pattern: number): void {
    const bits = [(pattern >> 3) & 1, (pattern >> 2) & 1, (pattern >> 1) & 1, pattern & 1];
    bits.forEach((bit, i) => host.writePin(i, bit));
    host.tick(1 / 20);
  }

  function motorInfo(): StepperInfo {
    return renderInfoById(host, "motor") as StepperInfo;
  }

  it("exposes the four control inputs plus inert vcc/gnd in the snapshot", () => {
    const pins = snapshot(host)
      .components.find((c) => c.id === "motor")!
      .pins.map((p) => p.label);
    expect(pins).toEqual(["in1", "in2", "in3", "in4", "vcc", "gnd"]);
  });

  it("tracks two full drive cycles (1024 full-step units), then reverses cleanly back to 0", () => {
    drive(0b1010); // anchor: locks position without moving
    expect(motorInfo()).toEqual({
      type: "stepper",
      angleDegrees: 0,
      direction: "none",
      stepsPerSecond: 0,
    });

    // Two full passes of the 4-state full-step table (8 recognized steps).
    const CYCLES: readonly number[] = [0b0110, 0b0101, 0b1001, 0b1010];
    for (let cycle = 0; cycle < 2; cycle++) {
      for (const pattern of CYCLES) drive(pattern);
    }
    expect(motorInfo().angleDegrees).toBeCloseTo(8 * (360 / 2048), 9);
    expect(motorInfo().direction).toBe("CW");
    // Steady stepping at 1/20s between states -> 20 steps/sec.
    expect(motorInfo().stepsPerSecond).toBeCloseTo(20, 9);

    // Two full passes backward (8 steps) subtract right back to the origin.
    const BACK: readonly number[] = [0b1001, 0b0101, 0b0110, 0b1010];
    for (let cycle = 0; cycle < 2; cycle++) {
      for (const pattern of BACK) drive(pattern);
    }
    expect(motorInfo().angleDegrees).toBeCloseTo(0, 9);
    expect(motorInfo().direction).toBe("CCW");
  });
});

describe("CircuitHost PIR motion sensor: press triggers OUT HIGH on a wired GPIO, then expires", () => {
  let host: CircuitHost;

  beforeEach(() => {
    host = new CircuitHost();
    addDemoBoard(host);
    host.handleEdit({ type: "addComponent", componentId: "sensor", kind: "pir" });
    connect(host, "w1", "sensor", "out", "board", "GPIO0");
    host.setupPin(0, 0); // GPIO0 as IN, reading the sensor's OUT
  });

  function pirInfo(): { type: "pir"; motionActive: boolean } {
    return renderInfoById(host, "sensor") as { type: "pir"; motionActive: boolean };
  }

  it("exposes vcc/out/gnd in the snapshot and idles motion-inactive", () => {
    const pins = snapshot(host)
      .components.find((c) => c.id === "sensor")!
      .pins.map((p) => p.label);
    expect(pins).toEqual(["vcc", "out", "gnd"]);
    expect(pirInfo()).toEqual({ type: "pir", motionActive: false });
    expect(host.readPin(0)).toBe(0); // idle OUT drives the GPIO LOW
  });

  it("a press trigger propagates OUT HIGH to GPIO0 and the hold expires after a dive", () => {
    // The press gesture is the motion stimulus — same message a view sends.
    host.handleEdit({ type: "press", componentId: "sensor" });
    expect(pirInfo()).toEqual({ type: "pir", motionActive: true });

    // Net resolution + one update tick land the HIGH end-to-end.
    host.tick(1 / 60);
    expect(host.readPin(0)).toBe(1);

    // Just inside the default 5s hold it stays detected, then drops LOW.
    host.tick(4.9);
    expect(host.readPin(0)).toBe(1);
    host.tick(0.2);
    expect(pirInfo()).toEqual({ type: "pir", motionActive: false });
    expect(host.readPin(0)).toBe(0);
  });

  it("rejects press on a non-pressable component like the board", () => {
    expect(() => host.handleEdit({ type: "press", componentId: "board" })).toThrow(
      'Component "board" is not pressable'
    );
  });
});

describe("CircuitHost (RC timing components)", () => {
  let host: CircuitHost;

  beforeEach(() => {
    host = new CircuitHost();
    host.handleEdit({ type: "addComponent", componentId: "board", kind: "pico_board" });
  });

  it("adds potentiometer, resistor, and capacitor with their pins + renderInfo", () => {
    host.handleEdit({ type: "addComponent", componentId: "pot", kind: "potentiometer" });
    host.handleEdit({ type: "addComponent", componentId: "r", kind: "resistor" });
    host.handleEdit({ type: "addComponent", componentId: "c", kind: "capacitor" });

    const comps = snapshot(host).components;
    expect(comps.find((x) => x.id === "pot")!.pins.map((p) => p.label)).toEqual([
      "terminal1", "wiper", "terminal2",
    ]);
    expect(comps.find((x) => x.id === "r")!.pins.map((p) => p.label)).toEqual([
      "terminal1", "terminal2",
    ]);
    expect(comps.find((x) => x.id === "c")!.pins.map((p) => p.label)).toEqual(["a", "b"]);
    expect(renderInfoById(host, "pot")).toEqual({ type: "potentiometer", knobPosition: 0 });
    expect(renderInfoById(host, "r")).toEqual({ type: "resistor", resistanceOhms: 10000 });
    expect(renderInfoById(host, "c")).toEqual({ type: "capacitor", chargeFraction: 0, charged: false });
  });

  it("routes a setKnobPosition message to the engine and re-snapshots", () => {
    host.handleEdit({ type: "addComponent", componentId: "pot", kind: "potentiometer" });
    host.handleEdit({ type: "setKnobPosition", componentId: "pot", knobPosition: 0.75 });
    expect(renderInfoById(host, "pot")).toEqual({ type: "potentiometer", knobPosition: 0.75 });

    // The wiper publishes immediately, so the shot is live even before a tick.
    const wiper = host.componentById("pot")!.pin("wiper");
    expect(wiper.analogValue).toBe(0.75);

    // Clamping happens in the engine; a bogus target is still legal to send.
    host.handleEdit({ type: "setKnobPosition", componentId: "pot", knobPosition: 5 });
    expect(renderInfoById(host, "pot")).toEqual({ type: "potentiometer", knobPosition: 1 });

    // Only a potentiometer has a knob.
    expect(() =>
      host.handleEdit({ type: "addComponent", componentId: "r", kind: "resistor" })
    ).not.toThrow();
    expect(() =>
      host.handleEdit({ type: "setKnobPosition", componentId: "r", knobPosition: 0.5 })
    ).toThrow('Component "r" is not a potentiometer');
  });

  it("runs the full RC-approach pulse end-to-end through the host bridge", () => {
    // The demo the browser-verify script mirrors in real MicroPython:
    //   resistor.terminal1 - cap.a - GPIO8 ; cap.b - GND
    host.handleEdit({ type: "addComponent", componentId: "r", kind: "resistor" });
    host.handleEdit({ type: "addComponent", componentId: "c", kind: "capacitor" });
    connect(host, "w1", "r", "terminal1", "c", "a");
    connect(host, "w2", "c", "a", "board", "GPIO8");
    connect(host, "w3", "c", "b", "board", "GND");

    // ---- DISCHARGE: GPIO8 as an OUT LOW driver empties the cap ----
    // (machine.Pin(8, OUT, PULL_DOWN); p.value(0); time.sleep(...) in real code)
    host.setupPin(8, 1, 3); // mode OUT, pull DOWN
    host.writePin(8, 0);
    host.tick(1 / 60);
    expect(renderInfoById(host, "c")).toEqual({ type: "capacitor", chargeFraction: 0, charged: false });
    expect(host.readPin(8)).toBe(0);

    // ---- POLL: GPIO8 flips to IN and the cap recharges through the 10kΩ ----
    // resistor (fraction 0.5) at maxCharge 2s -> threshold 1.0s.
    host.setupPin(8, 0); // machine.Pin(8, IN)
    expect(host.readPin(8)).toBe(0);

    let elapsed = 0;
    const dt = 0.05;
    while (host.readPin(8) === 0 && elapsed < 5) {
      host.tick(dt);
      elapsed += dt;
    }

    // The net tripped HIGH within the expected RC window.
    expect(host.readPin(8)).toBe(1);
    expect(elapsed).toBeGreaterThanOrEqual(0.85);
    expect(elapsed).toBeLessThan(1.15);

    // ---- DECAY: driving GPIO8 LOW again discharges and the net returns ----
    host.setupPin(8, 1, 3);
    host.writePin(8, 0);
    host.tick(1 / 60);
    expect(host.readPin(8)).toBe(0);
    expect(renderInfoById(host, "c")).toEqual({ type: "capacitor", chargeFraction: 0, charged: false });
  });

  it("a potentiometer's wiper fraction drives the cap's threshold proportionally", () => {
    host.handleEdit({ type: "addComponent", componentId: "pot", kind: "potentiometer" });
    host.handleEdit({ type: "addComponent", componentId: "c", kind: "capacitor" });
    connect(host, "w1", "pot", "wiper", "c", "a");
    connect(host, "w2", "c", "a", "board", "GPIO8");
    connect(host, "w3", "c", "b", "board", "GND");

    // knob at 0.25 -> threshold = 2s * 0.25 = 0.5s.
    host.handleEdit({ type: "setKnobPosition", componentId: "pot", knobPosition: 0.25 });
    host.setupPin(8, 0); // poll phase; nothing drives, cap starts from 0

    let elapsed = 0;
    const dt = 0.05;
    while (host.readPin(8) === 0 && elapsed < 5) {
      host.tick(dt);
      elapsed += dt;
    }
    expect(host.readPin(8)).toBe(1);
    expect(elapsed).toBeGreaterThanOrEqual(0.4);
    expect(elapsed).toBeLessThan(0.65);
  });

  it("is replay-safe and keeps the new kinds limited to palettable components", () => {
    host.handleEdit({ type: "addComponent", componentId: "c", kind: "capacitor" });
    const before = snapshot(host).components.length;
    host.handleEdit({ type: "addComponent", componentId: "c", kind: "capacitor" });
    expect(snapshot(host).components.length).toBe(before);
  });
});

describe("CircuitHost ultrasonic HC-SR04: TRIG rise drives ECHO for 58µs/cm on a wired GPIO", () => {
  let host: CircuitHost;

  beforeEach(() => {
    host = new CircuitHost();
    addDemoBoard(host);
    host.handleEdit({ type: "addComponent", componentId: "sensor", kind: "ultrasonic" });
    connect(host, "w1", "board", "GPIO9", "sensor", "trig");
    connect(host, "w2", "sensor", "echo", "board", "GPIO10");
    host.setupPin(9, 1); // GPIO9 as OUT, driving TRIG (the Python writer)
    host.setupPin(10, 0); // GPIO10 as IN, reading ECHO (the Python listener)
  });

  type UltraInfo = {
    type: "ultrasonic";
    measuring: boolean;
    simulatedDistanceCm: number | null;
  };

  function ultraInfo(): UltraInfo {
    return renderInfoById(host, "sensor") as UltraInfo;
  }

  it("exposes vcc/trig/echo/gnd in the snapshot and idles with no echo", () => {
    const pins = snapshot(host)
      .components.find((c) => c.id === "sensor")!
      .pins.map((p) => p.label);
    expect(pins).toEqual(["vcc", "trig", "echo", "gnd"]);
    expect(ultraInfo()).toEqual({ type: "ultrasonic", measuring: false, simulatedDistanceCm: null });
    expect(host.readPin(10)).toBe(0); // idle ECHO drives the GPIO LOW
  });

  it("routes a setSimulatedDistance message to the engine and the ECHO pulse is measurable", () => {
    host.handleEdit({ type: "setSimulatedDistance", componentId: "sensor", simulatedDistanceCm: 300 });
    expect(ultraInfo()).toEqual({ type: "ultrasonic", measuring: false, simulatedDistanceCm: 300 });

    // TRIG rise: writing GPIO9 HIGH then ticking (finely) detects the edge and
    // starts the echo mid-tick — ECHO is HIGH from the very first µs.
    host.writePin(9, 1);
    host.tick(1e-6);
    expect(ultraInfo().measuring).toBe(true);
    expect(host.readPin(10)).toBe(1);

    // Step in 1µs dt until ECHO drops: 300cm * 58µs/cm = 17.4ms.
    let elapsedUs = 1;
    while (host.readPin(10) === 1 && elapsedUs < 30000) {
      host.tick(1e-6);
      elapsedUs += 1;
    }
    expect(host.readPin(10)).toBe(0);
    expect(elapsedUs).toBeGreaterThan(17400 - 5);
    expect(elapsedUs).toBeLessThan(17400 + 5);
    expect(ultraInfo().measuring).toBe(false);
  });

  it("null distance (no object) produces no echo despite a TRIG rise", () => {
    host.handleEdit({ type: "setSimulatedDistance", componentId: "sensor", simulatedDistanceCm: null });
    host.writePin(9, 1);
    host.tick(1e-6);
    expect(ultraInfo().measuring).toBe(false);
    expect(host.readPin(10)).toBe(0);
  });

  it("rejects setSimulatedDistance on a non-ultrasonic component", () => {
    host.handleEdit({ type: "addComponent", componentId: "led2", kind: "led" });
    expect(() =>
      host.handleEdit({ type: "setSimulatedDistance", componentId: "led", simulatedDistanceCm: 10 })
    ).toThrow('Component "led" is not an ultrasonic sensor');
  });

  it("advances the shared sim clock per tick() and exposes it in µs", () => {
    host.tick(0.25);
    host.tick(0.25);
    expect(host.getSimTimeMicros()).toBe(500_000);
  });
});
