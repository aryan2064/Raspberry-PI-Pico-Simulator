// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { afterEach } from "vitest";
import { cleanup, fireEvent, act, render, screen } from "@testing-library/react";
import { CircuitCanvas } from "../CircuitCanvas";
import { COMPONENT_MIME } from "../ComponentPalette";
import type { Vec } from "../types";
import type { ComponentKind, PinRef, SnapshotMessage, TopologyConnection } from "../../execution/messages";

// The canvas is now a pure renderer: it draws from a worker snapshot + the
// main-thread topology record and relays interactions through callbacks. No
// engine objects are involved here — pin objects live in the worker.

// fireEvent.drop in this jsdom/testing-library version doesn't carry
// clientX/clientY, so drops are dispatched as real MouseEvents and the
// dataTransfer object is attached explicitly.
function dropPaletteComponent(
  target: Element,
  payload: string,
  x: number,
  y: number
): void {
  const event = new MouseEvent("drop", {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperty(event, "dataTransfer", {
    value: { getData: (mime: string) => (mime === COMPONENT_MIME ? payload : "") },
  });
  act(() => {
    target.dispatchEvent(event);
  });
}

const BOARD = { id: "board" };
const LED = { id: "led" };
const BUTTON = { id: "button" };

// Pin ids in the fixture snapshots are stable strings ("<component>:<label>")
// so conflict tests can target them directly. The real worker re-reads these
// from the engine each tick; here we only need deterministic ids to match.
function makeSnapshot(
  isOn = false,
  isPressed = false,
  conflictPinKeys: string[] = [],
  brightness = isOn ? 1 : 0
): SnapshotMessage {
  const pinsByKind: Record<string, Array<{ id: string; label: string }>> = {
    pico_board: [
      { id: "board:GPIO15", label: "GPIO15" },
      { id: "board:GPIO16", label: "GPIO16" },
      { id: "board:3V3_OUT", label: "3V3_OUT" },
      { id: "board:GND", label: "GND" },
    ],
    led: [
      { id: "led:anode", label: "anode" },
      { id: "led:cathode", label: "cathode" },
    ],
    button: [
      { id: "button:leg1a", label: "leg1a" },
      { id: "button:leg1b", label: "leg1b" },
      { id: "button:leg2a", label: "leg2a" },
      { id: "button:leg2b", label: "leg2b" },
    ],
  };
  // conflictedPinIds must be real pin ids (uuids), not labels — the canvas
  // resolves labels to ids through the pins mapping before matching.
  const conflictedPinIds = conflictPinKeys.map((key) => {
    const found = Object.values(pinsByKind)
      .flat()
      .find((p) => p.id === key || p.label === key);
    return found ? found.id : key;
  });
  return {
    type: "snapshot",
    conflictedPinIds,
    components: [
      {
        id: BOARD.id,
        renderInfo: { type: "pico_board" },
        pins: pinsByKind.pico_board,
      },
      { id: LED.id, renderInfo: { type: "led", isOn, brightness }, pins: pinsByKind.led },
      {
        id: BUTTON.id,
        renderInfo: { type: "button", isPressed },
        pins: pinsByKind.button,
      },
    ],
  };
}

// Demo wiring (passive button circuit):
//   w1: board.3V3_OUT -> button.leg1a
//   w2: board.GPIO15 -> led.anode
//   w3: button.leg2a -> board.GPIO15
//   w4: led.cathode -> board.GND
function makeConnections(wireIds = ["w1", "w2", "w3", "w4"]): TopologyConnection[] {
  const all: TopologyConnection[] = [
    {
      wireId: "w1",
      from: { componentId: BOARD.id, pinLabel: "3V3_OUT" },
      to: { componentId: BUTTON.id, pinLabel: "leg1a" },
    },
    {
      wireId: "w2",
      from: { componentId: BOARD.id, pinLabel: "GPIO15" },
      to: { componentId: LED.id, pinLabel: "anode" },
    },
    {
      wireId: "w3",
      from: { componentId: BUTTON.id, pinLabel: "leg2a" },
      to: { componentId: BOARD.id, pinLabel: "GPIO15" },
    },
    {
      wireId: "w4",
      from: { componentId: LED.id, pinLabel: "cathode" },
      to: { componentId: BOARD.id, pinLabel: "GND" },
    },
  ];
  return all.filter((c) => wireIds.includes(c.wireId));
}

// Matches the demo layout the app computes for the fixed components.
function defaultPositions(extra: Record<string, Vec> = {}): Record<string, Vec> {
  return { board: { x: 40, y: 40 }, led: { x: 400, y: 40 }, button: { x: 760, y: 40 }, ...extra };
}

interface CanvasHandlers {
  onConnect: (from: PinRef, to: PinRef) => void;
  onDisconnect: (wireId: string) => void;
  onPress: (componentId: string) => void;
  onRelease: (componentId: string) => void;
  onKnobChange: (componentId: string, knobPosition: number) => void;
  onDistanceChange: (componentId: string, simulatedDistanceCm: number | null) => void;
  onMoveComponent: (componentId: string, position: Vec) => void;
  onPlaceComponent: (position: Vec, kind: ComponentKind) => void;
  onDeleteComponent: (componentId: string) => void;
}

function renderCanvas(
  snapshot: SnapshotMessage = makeSnapshot(),
  connections: TopologyConnection[] = makeConnections(),
  handlers: Partial<CanvasHandlers> = {},
  positions: Record<string, Vec> = defaultPositions()
) {
  const h: CanvasHandlers = {
    onConnect: handlers.onConnect ?? vi.fn(),
    onDisconnect: handlers.onDisconnect ?? vi.fn(),
    onPress: handlers.onPress ?? vi.fn(),
    onRelease: handlers.onRelease ?? vi.fn(),
    onKnobChange: handlers.onKnobChange ?? vi.fn(),
    onDistanceChange: handlers.onDistanceChange ?? vi.fn(),
    onMoveComponent: handlers.onMoveComponent ?? vi.fn(),
    onPlaceComponent: handlers.onPlaceComponent ?? vi.fn(),
    onDeleteComponent: handlers.onDeleteComponent ?? vi.fn(),
  };
  const utils = render(
    <CircuitCanvas
      snapshot={snapshot}
      connections={connections}
      positions={positions}
      onConnect={h.onConnect}
      onDisconnect={h.onDisconnect}
      onPress={h.onPress}
      onRelease={h.onRelease}
      onKnobChange={h.onKnobChange}
      onDistanceChange={h.onDistanceChange}
      onMoveComponent={h.onMoveComponent}
      onPlaceComponent={h.onPlaceComponent}
      onDeleteComponent={h.onDeleteComponent}
    />
  );
  return { ...utils, ...h };
}

afterEach(() => cleanup());

describe("CircuitCanvas (snapshot renderer + input relay)", () => {
  it("renders every component body, wire, and pin marker", () => {
    renderCanvas();
    expect(screen.getByTestId("pico-board")).toBeTruthy();
    expect(screen.getByTestId("led-body")).toBeTruthy();
    expect(screen.getByTestId("button-body")).toBeTruthy();

    for (const w of makeConnections()) {
      expect(screen.getByTestId(`wire-${w.wireId}`)).toBeTruthy();
    }

    expect(screen.getByTestId("pin-board-GPIO15")).toBeTruthy();
    expect(screen.getByTestId("pin-led-anode")).toBeTruthy();
    expect(screen.getByTestId("pin-button-leg1a")).toBeTruthy();
    expect(screen.getByTestId("pin-button-leg1b")).toBeTruthy();
    expect(screen.getByTestId("pin-button-leg2a")).toBeTruthy();
    expect(screen.getByTestId("pin-button-leg2b")).toBeTruthy();
  });

  it("renders the LED state straight from the snapshot", () => {
    const { rerender } = renderCanvas(makeSnapshot(false));
    expect(screen.getByTestId("led-body").getAttribute("data-on")).toBe("false");

    rerender(
      <CircuitCanvas
        snapshot={makeSnapshot(true)}
        connections={makeConnections()}
        positions={defaultPositions()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onPress={vi.fn()}
        onRelease={vi.fn()}
        onKnobChange={vi.fn()}
        onDistanceChange={vi.fn()}
        onMoveComponent={vi.fn()}
        onPlaceComponent={vi.fn()}
        onDeleteComponent={vi.fn()}
      />
    );
    expect(screen.getByTestId("led-body").getAttribute("data-on")).toBe("true");
  });

  it("renders relay and transistor bodies with their contact state attributes", () => {
    const snapshot: SnapshotMessage = {
      type: "snapshot",
      conflictedPinIds: [],
      components: [
        { id: "board", renderInfo: { type: "pico_board" }, pins: Array.from({ length: 3 }, (_, i) => ({ id: `board:GPIO${i}`, label: `GPIO${i}` })) },
        {
          id: "relay",
          renderInfo: { type: "relay", energized: false },
          pins: ["in", "vcc", "gnd", "com", "no", "nc"].map((label) => ({ id: `relay:${label}`, label })),
        },
        {
          id: "transistor",
          renderInfo: { type: "transistor", conducting: true },
          pins: ["base", "collector", "emitter"].map((label) => ({ id: `transistor:${label}`, label })),
        },
      ],
    };
    const positions = { board: { x: 40, y: 40 }, relay: { x: 400, y: 80 }, transistor: { x: 700, y: 80 } };
    renderCanvas(snapshot, [], {}, positions);

    expect(screen.getByTestId("relay-body").getAttribute("data-energized")).toBe("false");
    expect(screen.getByTestId("transistor-body").getAttribute("data-conducting")).toBe("true");

    for (const label of ["in", "vcc", "gnd", "com", "no", "nc"]) {
      expect(screen.getByTestId(`pin-relay-${label}`)).toBeTruthy();
    }
    for (const label of ["base", "collector", "emitter"]) {
      expect(screen.getByTestId(`pin-transistor-${label}`)).toBeTruthy();
    }
  });

  it("renders a stepper body with its spin state as data attributes and all six pins", () => {
    const snapshot: SnapshotMessage = {
      type: "snapshot",
      conflictedPinIds: [],
      components: [
        { id: "board", renderInfo: { type: "pico_board" }, pins: Array.from({ length: 3 }, (_, i) => ({ id: `board:GPIO${i}`, label: `GPIO${i}` })) },
        {
          id: "motor",
          renderInfo: { type: "stepper", angleDegrees: 1.40625, direction: "CW", stepsPerSecond: 20 },
          pins: ["in1", "in2", "in3", "in4", "vcc", "gnd"].map((label) => ({ id: `motor:${label}`, label })),
        },
      ],
    };
    const positions = { board: { x: 40, y: 40 }, motor: { x: 400, y: 80 } };
    renderCanvas(snapshot, [], {}, positions);

    const motorBody = screen.getByTestId("stepper-body");
    expect(motorBody.getAttribute("data-angle")).toBe("1.40625");
    expect(motorBody.getAttribute("data-direction")).toBe("CW");
    expect(motorBody.getAttribute("data-steps-per-second")).toBe("20");

    for (const label of ["in1", "in2", "in3", "in4", "vcc", "gnd"]) {
      expect(screen.getByTestId(`pin-motor-${label}`)).toBeTruthy();
    }
  });

  it("renders a PIR body with its motion state and all three pins, and relays a click as press", () => {
    const snapshot: SnapshotMessage = {
      type: "snapshot",
      conflictedPinIds: [],
      components: [
        { id: "board", renderInfo: { type: "pico_board" }, pins: Array.from({ length: 3 }, (_, i) => ({ id: `board:GPIO${i}`, label: `GPIO${i}` })) },
        {
          id: "sensor",
          renderInfo: { type: "pir", motionActive: true },
          pins: ["vcc", "out", "gnd"].map((label) => ({ id: `sensor:${label}`, label })),
        },
      ],
    };
    const positions = { board: { x: 40, y: 40 }, sensor: { x: 400, y: 80 } };
    const onPress = vi.fn();
    renderCanvas(snapshot, [], { onPress }, positions);

    expect(screen.getByTestId("pir-body").getAttribute("data-motion-active")).toBe("true");
    for (const label of ["vcc", "out", "gnd"]) {
      expect(screen.getByTestId(`pin-sensor-${label}`)).toBeTruthy();
    }

    // A click on the dome is the motion stimulus — the press callback fires.
    fireEvent.mouseDown(screen.getByTestId("pir-body"));
    expect(onPress).toHaveBeenCalledWith("sensor");
  });

  it("relays button press/release to the worker callbacks", () => {
    const onPress = vi.fn();
    const onRelease = vi.fn();
    renderCanvas(makeSnapshot(false, false), makeConnections(), { onPress, onRelease });

    fireEvent.mouseDown(screen.getByTestId("button-body"));
    expect(onPress).toHaveBeenCalledWith("button");

    fireEvent.mouseUp(screen.getByTestId("button-body"));
    expect(onRelease).toHaveBeenCalledWith("button");
  });

  it("relays a completed wire as a connect message (pin click to pin click)", () => {
    const onConnect = vi.fn();
    renderCanvas(makeSnapshot(), makeConnections(), { onConnect });

    fireEvent.click(screen.getByTestId("pin-board-GPIO16"));
    fireEvent.click(screen.getByTestId("pin-led-anode"));

    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(onConnect).toHaveBeenCalledWith(
      { componentId: "board", pinLabel: "GPIO16" },
      { componentId: "led", pinLabel: "anode" }
    );
  });

  it("cancels the pending wire when the same pin is clicked twice", () => {
    const onConnect = vi.fn();
    renderCanvas(makeSnapshot(), makeConnections(), { onConnect });

    const pin = screen.getByTestId("pin-board-GPIO15");
    fireEvent.click(pin);
    fireEvent.click(pin);

    expect(onConnect).not.toHaveBeenCalled();
  });

  it("relays a wire click as a disconnect message", () => {
    const onDisconnect = vi.fn();
    renderCanvas(makeSnapshot(), makeConnections(), { onDisconnect });

    fireEvent.click(screen.getByTestId("wire-w2"));
    expect(onDisconnect).toHaveBeenCalledWith("w2");
  });

  it("drops a wire from the DOM when the topology no longer lists it", () => {
    const { rerender } = renderCanvas(makeSnapshot(), makeConnections());
    expect(screen.getByTestId("wire-w2")).toBeTruthy();

    rerender(
      <CircuitCanvas
        snapshot={makeSnapshot()}
        connections={makeConnections(["w1", "w3", "w4"])}
        positions={defaultPositions()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onPress={vi.fn()}
        onRelease={vi.fn()}
        onKnobChange={vi.fn()}
        onDistanceChange={vi.fn()}
        onMoveComponent={vi.fn()}
        onPlaceComponent={vi.fn()}
        onDeleteComponent={vi.fn()}
      />
    );
    expect(screen.queryByTestId("wire-w2")).toBeNull();
  });

  it("paints bodies then wires then pins (wires above bodies, pins on top)", () => {
    renderCanvas();
    const bodies = document.querySelector('[data-layer="bodies"]')!;
    const wires = document.querySelector('[data-layer="wires"]')!;
    const pins = document.querySelector('[data-layer="pins"]')!;

    const bodiesBeforeWires =
      bodies.compareDocumentPosition(wires) & Node.DOCUMENT_POSITION_FOLLOWING;
    const wiresBeforePins =
      wires.compareDocumentPosition(pins) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(bodiesBeforeWires).toBeTruthy();
    expect(wiresBeforePins).toBeTruthy();
  });

  it("places a dropped palette component at the drop position with its kind", () => {
    const onPlaceComponent = vi.fn();
    renderCanvas(makeSnapshot(), makeConnections(), { onPlaceComponent });

    const svg = screen.getByTestId("circuit-canvas");
    fireEvent.dragOver(svg, { dataTransfer: { getData: () => "led" } });
    dropPaletteComponent(svg, "led", 600, 350);

    expect(onPlaceComponent).toHaveBeenCalledTimes(1);
    // jsdom has no usable getScreenCTM, so the fallback passes client coords
    // through — the browser path converts via the inverse screen transform.
    expect(onPlaceComponent).toHaveBeenCalledWith({ x: 600, y: 350 }, "led");
  });

  it("ignores drops that carry no palette payload", () => {
    const onPlaceComponent = vi.fn();
    renderCanvas(makeSnapshot(), makeConnections(), { onPlaceComponent });

    const svg = screen.getByTestId("circuit-canvas");
    dropPaletteComponent(svg, "wow", 100, 100);

    expect(onPlaceComponent).not.toHaveBeenCalled();
  });

  it("places relay, transistor, stepper, and PIR drops like any other palette part", () => {
    const onPlaceComponent = vi.fn();
    renderCanvas(makeSnapshot(), makeConnections(), { onPlaceComponent });

    const svg = screen.getByTestId("circuit-canvas");
    dropPaletteComponent(svg, "relay", 300, 200);
    dropPaletteComponent(svg, "transistor", 500, 400);
    dropPaletteComponent(svg, "stepper", 700, 600);
    dropPaletteComponent(svg, "pir", 900, 300);

    expect(onPlaceComponent).toHaveBeenCalledTimes(4);
    expect(onPlaceComponent).toHaveBeenCalledWith({ x: 300, y: 200 }, "relay");
    expect(onPlaceComponent).toHaveBeenCalledWith({ x: 500, y: 400 }, "transistor");
    expect(onPlaceComponent).toHaveBeenCalledWith({ x: 700, y: 600 }, "stepper");
    expect(onPlaceComponent).toHaveBeenCalledWith({ x: 900, y: 300 }, "pir");
  });

  it("places potentiometer, resistor, and capacitor drops like any other palette part", () => {
    const onPlaceComponent = vi.fn();
    renderCanvas(makeSnapshot(), makeConnections(), { onPlaceComponent });

    const svg = screen.getByTestId("circuit-canvas");
    dropPaletteComponent(svg, "potentiometer", 200, 150);
    dropPaletteComponent(svg, "resistor", 400, 250);
    dropPaletteComponent(svg, "capacitor", 600, 350);

    expect(onPlaceComponent).toHaveBeenCalledTimes(3);
    expect(onPlaceComponent).toHaveBeenCalledWith({ x: 200, y: 150 }, "potentiometer");
    expect(onPlaceComponent).toHaveBeenCalledWith({ x: 400, y: 250 }, "resistor");
    expect(onPlaceComponent).toHaveBeenCalledWith({ x: 600, y: 350 }, "capacitor");
  });

  it("places an ultrasonic sensor drop like any other palette part", () => {
    const onPlaceComponent = vi.fn();
    renderCanvas(makeSnapshot(), makeConnections(), { onPlaceComponent });

    const svg = screen.getByTestId("circuit-canvas");
    dropPaletteComponent(svg, "ultrasonic", 700, 300);

    expect(onPlaceComponent).toHaveBeenCalledTimes(1);
    expect(onPlaceComponent).toHaveBeenCalledWith({ x: 700, y: 300 }, "ultrasonic");
  });

  it("renders resistor and capacitor bodies with their state attributes from the snapshot", () => {
    const snapshot: SnapshotMessage = {
      type: "snapshot",
      conflictedPinIds: [],
      components: [
        {
          id: "r1",
          renderInfo: { type: "resistor", resistanceOhms: 10000 },
          pins: [
            { id: "r-p1", label: "terminal1" },
            { id: "r-p2", label: "terminal2" },
          ],
        },
        {
          id: "c1",
          renderInfo: { type: "capacitor", chargeFraction: 0.5, charged: true },
          pins: [
            { id: "c-p1", label: "a" },
            { id: "c-p2", label: "b" },
          ],
        },
      ],
    };
    renderCanvas(snapshot, [], {}, { r1: { x: 100, y: 100 }, c1: { x: 100, y: 200 } });

    const resistor = screen.getByTestId("resistor");
    expect(resistor.getAttribute("data-resistance-ohms")).toBe("10000");

    const capacitor = screen.getByTestId("capacitor");
    expect(capacitor.getAttribute("data-charged")).toBe("true");
    expect(capacitor.getAttribute("data-charge-fraction")).toBe("0.500");

    // Pin markers for the new parts come from their own offset maps.
    expect(screen.getByTestId("pin-r1-terminal1")).toBeTruthy();
    expect(screen.getByTestId("pin-r1-terminal2")).toBeTruthy();
    expect(screen.getByTestId("pin-c1-a")).toBeTruthy();
    expect(screen.getByTestId("pin-c1-b")).toBeTruthy();
  });

  it("relays a potentiometer knob drag as onKnobChange without moving the body", () => {
    const snapshot: SnapshotMessage = {
      type: "snapshot",
      conflictedPinIds: [],
      components: [
        {
          id: "pot1",
          renderInfo: { type: "potentiometer", knobPosition: 0 },
          pins: [
            { id: "p-p1", label: "terminal1" },
            { id: "p-p2", label: "wiper" },
            { id: "p-p3", label: "terminal2" },
          ],
        },
      ],
    };
    const onKnobChange = vi.fn();
    const onMoveComponent = vi.fn();
    renderCanvas(snapshot, [], { onKnobChange, onMoveComponent }, { pot1: { x: 100, y: 100 } });

    const knob = screen.getByTestId("potentiometer-knob");
    // Drag the pointer UP by 60 client px: knob travel is 120px/rev, so the
    // position goes 0 -> 0.5.
    fireEvent.pointerDown(knob, { button: 0, clientY: 100 });
    fireEvent.pointerMove(knob, { clientY: 40 });
    fireEvent.pointerUp(knob, { clientY: 40 });

    expect(onKnobChange).toHaveBeenCalledWith("pot1", 0.5);
    // The knob overlay consumed the gesture: the body must not have been
    // dragged along with it.
    expect(onMoveComponent).not.toHaveBeenCalled();
  });

  it("renders an ultrasonic body with its state attributes and all four pins", () => {
    const snapshot: SnapshotMessage = {
      type: "snapshot",
      conflictedPinIds: [],
      components: [
        {
          id: "ultra1",
          renderInfo: { type: "ultrasonic", measuring: true, simulatedDistanceCm: 300 },
          pins: ["vcc", "trig", "echo", "gnd"].map((label) => ({ id: `ultra1:${label}`, label })),
        },
      ],
    };
    renderCanvas(snapshot, [], {}, { ultra1: { x: 200, y: 200 } });

    const ultra = screen.getByTestId("ultrasonic");
    expect(ultra.getAttribute("data-measuring")).toBe("true");
    expect(ultra.getAttribute("data-distance")).toBe("300");
    // "measuring" renders the pulse indicator overlay.
    expect(screen.getByTestId("ultrasonic-measuring")).toBeTruthy();

    for (const label of ["vcc", "trig", "echo", "gnd"]) {
      expect(screen.getByTestId(`pin-ultra1-${label}`)).toBeTruthy();
    }

    // The slider readout reflects the distance; "no object" state comes from
    // a null simulatedDistanceCm.
    const readout = screen.getByTestId("ultrasonic-readout");
    expect(readout.textContent).toBe("300 cm");
  });

  it("renders the ultrasonic readout as 'no object' when the distance is null", () => {
    const snapshot: SnapshotMessage = {
      type: "snapshot",
      conflictedPinIds: [],
      components: [
        {
          id: "ultra1",
          renderInfo: { type: "ultrasonic", measuring: false, simulatedDistanceCm: null },
          pins: ["vcc", "trig", "echo", "gnd"].map((label) => ({ id: `ultra1:${label}`, label })),
        },
      ],
    };
    renderCanvas(snapshot, [], {}, { ultra1: { x: 200, y: 200 } });

    const ultra = screen.getByTestId("ultrasonic");
    expect(ultra.getAttribute("data-distance")).toBe("none");
    expect(screen.getByTestId("ultrasonic-readout").textContent).toBe("no object");
    expect(screen.queryByTestId("ultrasonic-measuring")).toBeNull();
  });

  it("relays an ultrasonic slider drag as onDistanceChange without moving the body", () => {
    const snapshot: SnapshotMessage = {
      type: "snapshot",
      conflictedPinIds: [],
      components: [
        {
          id: "ultra1",
          renderInfo: { type: "ultrasonic", measuring: false, simulatedDistanceCm: 300 },
          pins: ["vcc", "trig", "echo", "gnd"].map((label) => ({ id: `ultra1:${label}`, label })),
        },
      ],
    };
    const onDistanceChange = vi.fn();
    const onMoveComponent = vi.fn();
    renderCanvas(
      snapshot,
      [],
      { onDistanceChange, onMoveComponent },
      { ultra1: { x: 200, y: 200 } }
    );

    const slider = screen.getByTestId("ultrasonic-slider");
    // At 300cm the tap fraction is (300-2)/398 = 0.7487. Dragging right 15
    // client px (150 px = the full 2..400 sweep) adds 15/150 = 0.1:
    // frac 0.8487 -> 2 + 0.8487*398 = 339.78 cm (a real distance).
    fireEvent.pointerDown(slider, { button: 0, clientX: 0 });
    fireEvent.pointerMove(slider, { clientX: 15 });
    fireEvent.pointerUp(slider, { clientX: 15 });
    expect(onDistanceChange).toHaveBeenCalledWith(
      "ultra1",
      expect.closeTo(2 + (0.748743718593 + 0.1) * 398, 4)
    );

    // Dragging past the far end (frac >= 1) is the "no object" stop: null.
    fireEvent.pointerDown(slider, { button: 0, clientX: 15 });
    fireEvent.pointerMove(slider, { clientX: 200 });
    fireEvent.pointerUp(slider, { clientX: 200 });
    expect(onDistanceChange).toHaveBeenLastCalledWith("ultra1", null);

    // The slider overlay consumed both gestures: the body must not move.
    expect(onMoveComponent).not.toHaveBeenCalled();
  });

  it("drags an existing component body to reposition it", () => {
    const onMoveComponent = vi.fn();
    renderCanvas(makeSnapshot(), makeConnections(), { onMoveComponent });

    const svg = screen.getByTestId("circuit-canvas");
    const body = screen.getByTestId("body-led");
    fireEvent.pointerDown(body, { clientX: 100, clientY: 100 });
    // 3px is under the 4px drag threshold: nothing may move yet.
    fireEvent.pointerMove(svg, { clientX: 103, clientY: 100 });
    expect(onMoveComponent).not.toHaveBeenCalled();
    fireEvent.pointerMove(svg, { clientX: 160, clientY: 130 });
    expect(onMoveComponent).toHaveBeenCalledWith("led", { x: 460, y: 70 });
    fireEvent.pointerUp(svg, { clientX: 160, clientY: 130 });
    // Commits the final position on pointer-up.
    expect(onMoveComponent).toHaveBeenCalledWith("led", { x: 460, y: 70 });
  });

  it("repositions wire endpoints when a component's position changes", () => {
    // wire-w2 = board.GPIO15 -> led.anode; led anode offset = (25, 42).
    const { rerender } = renderCanvas(makeSnapshot(), makeConnections());
    const visibleLine = (): Element => {
      const g = screen.getByTestId("wire-w2");
      return g.querySelectorAll("line")[1];
    };
    expect(visibleLine().getAttribute("x2")).toBe("425"); // led at (400,40) + (25,42)
    expect(visibleLine().getAttribute("y2")).toBe("82");

    rerender(
      <CircuitCanvas
        snapshot={makeSnapshot()}
        connections={makeConnections()}
        positions={defaultPositions({ led: { x: 500, y: 100 } })}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onPress={vi.fn()}
        onRelease={vi.fn()}
        onKnobChange={vi.fn()}
        onDistanceChange={vi.fn()}
        onMoveComponent={vi.fn()}
        onPlaceComponent={vi.fn()}
        onDeleteComponent={vi.fn()}
      />
    );
    expect(visibleLine().getAttribute("x2")).toBe("525"); // led at (500,100) + (25,42)
    expect(visibleLine().getAttribute("y2")).toBe("142");
  });

  describe("selection and deletion", () => {
    // Select a component with a plain click: pointer-down + pointer-up on the
    // body without ever crossing the 4px drag threshold.
    function selectBody(bodyTestId: string): void {
      const svg = screen.getByTestId("circuit-canvas");
      fireEvent.pointerDown(screen.getByTestId(bodyTestId), { clientX: 100, clientY: 100 });
      fireEvent.pointerUp(svg, { clientX: 100, clientY: 100 });
    }

    it("selects a component on a plain click and highlights it", () => {
      renderCanvas();
      selectBody("body-led");
      expect(screen.getByTestId("delete-component")).toBeTruthy();
      expect(
        document.querySelector('div[data-testid="led"][data-selected="true"]')
      ).toBeTruthy();
    });

    it("deletes the selected component via the Delete button", () => {
      const onDeleteComponent = vi.fn();
      renderCanvas(makeSnapshot(), makeConnections(), { onDeleteComponent });
      selectBody("body-led");

      fireEvent.click(screen.getByTestId("delete-component"));

      expect(onDeleteComponent).toHaveBeenCalledTimes(1);
      expect(onDeleteComponent).toHaveBeenCalledWith("led");
      // deleting clears the selection -> the button disappears
      expect(screen.queryByTestId("delete-component")).toBeNull();
      expect(
        document.querySelector('div[data-testid="led"][data-selected="true"]')
      ).toBeNull();
    });

    it("deletes the selected component via the Delete/Backspace key", () => {
      const onDeleteComponent = vi.fn();
      renderCanvas(makeSnapshot(), makeConnections(), { onDeleteComponent });
      selectBody("body-led");

      fireEvent.keyDown(window, { key: "Backspace" });

      expect(onDeleteComponent).toHaveBeenCalledWith("led");
      expect(screen.queryByTestId("delete-component")).toBeNull();
    });

    it("does not offer/trigger Delete for the PicoBoard", () => {
      const onDeleteComponent = vi.fn();
      renderCanvas(makeSnapshot(), makeConnections(), { onDeleteComponent });
      selectBody("body-board");

      // Selected (highlighted) but not deletable: no button, key is a no-op.
      expect(
        document.querySelector('g[data-testid="pico-board"][data-selected="true"]')
      ).toBeTruthy();
      expect(screen.queryByTestId("delete-component")).toBeNull();
      fireEvent.keyDown(window, { key: "Delete" });
      expect(onDeleteComponent).not.toHaveBeenCalled();
    });

    it("clears the selection when the bare canvas is clicked", () => {
      renderCanvas();
      selectBody("body-led");
      expect(screen.getByTestId("delete-component")).toBeTruthy();

      fireEvent.click(screen.getByTestId("circuit-canvas"));

      expect(screen.queryByTestId("delete-component")).toBeNull();
      expect(
        document.querySelector('div[data-testid="led"][data-selected="true"]')
      ).toBeNull();
    });

    it("does not select a component that was dragged past the threshold", () => {
      const onDeleteComponent = vi.fn();
      renderCanvas(makeSnapshot(), makeConnections(), { onDeleteComponent });
      const svg = screen.getByTestId("circuit-canvas");
      fireEvent.pointerDown(screen.getByTestId("body-led"), { clientX: 100, clientY: 100 });
      fireEvent.pointerMove(svg, { clientX: 200, clientY: 200 });
      fireEvent.pointerUp(svg, { clientX: 200, clientY: 200 });

      expect(screen.queryByTestId("delete-component")).toBeNull();
    });

    it("ignores Delete/Backspace while a text field has focus", () => {
      const onDeleteComponent = vi.fn();
      renderCanvas(makeSnapshot(), makeConnections(), { onDeleteComponent });
      selectBody("body-led");
      expect(screen.getByTestId("delete-component")).toBeTruthy();

      // Simulate focus sitting in a text input (like the code editor).
      const editor = document.createElement("textarea");
      editor.setAttribute("aria-label", "fake-editor");
      document.body.appendChild(editor);
      editor.focus();
      try {
        fireEvent.keyDown(window, { key: "Backspace" });
      } finally {
        document.body.removeChild(editor);
      }

      expect(onDeleteComponent).not.toHaveBeenCalled();
      // selection intact
      expect(screen.getByTestId("delete-component")).toBeTruthy();
    });

    it("clears an in-progress wire when its source component is deleted", () => {
      const onDeleteComponent = vi.fn();
      renderCanvas(makeSnapshot(), makeConnections(), { onDeleteComponent });
      // start a wire from the LED's anode
      fireEvent.click(screen.getByTestId("pin-led-anode"));

      selectBody("body-led");
      fireEvent.click(screen.getByTestId("delete-component"));

      expect(onDeleteComponent).toHaveBeenCalledWith("led");
      // the pending pin marker is gone (no yellow pin remains)
      expect(
        document.querySelector('circle[fill="#ffd500"]')
      ).toBeNull();
    });
  });

  describe("conflict warning (hasConflict -> conflictedPinIds)", () => {
    // Wiring 3V3_OUT (OUT HIGH) to GND (OUT LOW) is a genuine two-driver short:
    // both pins are OUT from the moment the board is added.
    const conflictedBoardShort = () =>
      makeSnapshot(false, false, ["board:3V3_OUT", "board:GND"]);
    // the stroke line is the second <line> in each wire group; the first is
    // the transparent hit area
    const visibleLine = (wireTestId: string): Element => {
      const g = screen.getByTestId(wireTestId);
      return g.querySelectorAll("line")[1];
    };

    it("flag-style wires whose net is conflicted and show a single-wire banner", () => {
      // Only w1 (3V3_OUT -> button.leg1a) touches 3V3_OUT; w3/w2 don't touch 3V3_OUT or GND.
      renderCanvas(conflictedBoardShort(), makeConnections(["w1", "w3"]));

      expect(screen.getByTestId("wire-w1").getAttribute("data-conflicted")).toBe("true");
      expect(visibleLine("wire-w1").getAttribute("stroke")).toBe("#d81b1b");
      expect(visibleLine("wire-w1").getAttribute("stroke-dasharray")).toBe("8 5");
      // untouched wire keeps its normal style
      expect(screen.getByTestId("wire-w3").getAttribute("data-conflicted")).toBeNull();
      expect(visibleLine("wire-w3").getAttribute("stroke")).toBe("#1f8aff");

      expect(screen.getByTestId("conflict-banner").textContent).toContain(
        "1 wire conflict"
      );
    });

    it("counts every wire on the conflicted net (plural banner)", () => {
      // w1 (3V3_OUT -> button.leg1a) and w4 (led.cathode -> GND) both touch the
      // shorted net.
      renderCanvas(conflictedBoardShort(), makeConnections());

      expect(screen.getByTestId("wire-w1").getAttribute("data-conflicted")).toBe("true");
      expect(screen.getByTestId("wire-w4").getAttribute("data-conflicted")).toBe("true");
      expect(screen.getByTestId("wire-w2").getAttribute("data-conflicted")).toBeNull();
      expect(screen.getByTestId("wire-w3").getAttribute("data-conflicted")).toBeNull();
      expect(screen.getByTestId("conflict-banner").textContent).toContain(
        "2 wire conflicts"
      );
    });

    it("clears the styling and hides the banner when the conflict resolves", () => {
      const { rerender } = renderCanvas(
        conflictedBoardShort(),
        makeConnections(["w1"])
      );
      expect(screen.getByTestId("conflict-banner")).toBeTruthy();

      rerender(
        <CircuitCanvas
          snapshot={makeSnapshot()}
          connections={makeConnections(["w1"])}
          positions={defaultPositions()}
          onConnect={vi.fn()}
          onDisconnect={vi.fn()}
          onPress={vi.fn()}
          onRelease={vi.fn()}
          onKnobChange={vi.fn()}
          onDistanceChange={vi.fn()}
          onMoveComponent={vi.fn()}
          onPlaceComponent={vi.fn()}
          onDeleteComponent={vi.fn()}
        />
      );

      expect(screen.queryByTestId("conflict-banner")).toBeNull();
      expect(screen.getByTestId("wire-w1").getAttribute("data-conflicted")).toBeNull();
      expect(visibleLine("wire-w1").getAttribute("stroke")).toBe("#1f8aff");
    });
  });
});

describe("CircuitCanvas (pan/zoom viewport)", () => {
  // The canvas is a fixed 4000x2800 stage inside a pannable/zoomable viewport.
  // jsdom has no layout, so every rect is zero and clientToStagePoint reduces
  // to (client - pan)/zoom — the exact browser math, so the cursor-centered
  // wheel invariant holds to the last pixel and can be asserted with ===.
  const wheel = (container: Element, deltaY: number) =>
    fireEvent.wheel(container, { deltaY, clientX: 300, clientY: 200 });

  it("starts at 100%/origin and reports pan/zoom on the container", () => {
    renderCanvas();
    const container = screen.getByTestId("circuit-canvas");
    expect(container.getAttribute("data-zoom")).toBe("1");
    expect(container.getAttribute("data-pan-x")).toBe("0");
    expect(container.getAttribute("data-pan-y")).toBe("0");

    // The stage is 4000x2800 regardless of the viewport size.
    const stage = screen.getByTestId("circuit-stage");
    expect(stage.style.width).toBe("4000px");
    expect(stage.style.height).toBe("2800px");
  });

  it("zooms in with the wheel, centered on the cursor (pan = cursor*(1-zoom))", () => {
    renderCanvas();
    const container = screen.getByTestId("circuit-canvas");

    wheel(container, -100);
    expect(Number(container.getAttribute("data-zoom"))).toBeCloseTo(1.1, 9);
    expect(Number(container.getAttribute("data-pan-x"))).toBeCloseTo(-30, 9); // 300*(1-1.1)
    expect(Number(container.getAttribute("data-pan-y"))).toBeCloseTo(-20, 9); // 200*(1-1.1)

    // After 12 ticks 1.1^12 > 3 => clamps at exactly 3, still cursor-centered:
    // the stage point under (300,200) stays fixed throughout.
    for (let i = 0; i < 11; i++) wheel(container, -100);
    expect(Number(container.getAttribute("data-zoom"))).toBeCloseTo(3, 9);
    expect(Number(container.getAttribute("data-pan-x"))).toBeCloseTo(-600, 9);
    expect(Number(container.getAttribute("data-pan-y"))).toBeCloseTo(-400, 9);
  });

  it("clamps zoom-out at 0.25x, also cursor-centered", () => {
    renderCanvas();
    const container = screen.getByTestId("circuit-canvas");

    for (let i = 0; i < 20; i++) wheel(container, 100);
    expect(Number(container.getAttribute("data-zoom"))).toBeCloseTo(0.25, 9);
    // pan = cursor*(1-zoom) => 300*0.75, 200*0.75.
    expect(Number(container.getAttribute("data-pan-x"))).toBeCloseTo(225, 9);
    expect(Number(container.getAttribute("data-pan-y"))).toBeCloseTo(150, 9);
  });

  it("preserves the stage point under the cursor when zooming out after a pan", () => {
    renderCanvas();
    const container = screen.getByTestId("circuit-canvas");

    // Pan first: wheel-zoom to 1.61051x (5 ticks), then pan by (+30,+40).
    for (let i = 0; i < 5; i++) wheel(container, -100);
    fireEvent.pointerDown(container, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(container, { clientX: 130, clientY: 140 });
    fireEvent.pointerUp(container, { clientX: 130, clientY: 140 });
    const panX = Number(container.getAttribute("data-pan-x"));
    const panY = Number(container.getAttribute("data-pan-y"));

    // The stage point under the cursor is (300-panX)/zoom == (200-panY)/zoom.
    const stageX = (300 - panX) / 1.61051;
    const stageY = (200 - panY) / 1.61051;

    // One zoom-out tick: 1/1.1 => zoom' = 1.4641. The stage point must stay put.
    wheel(container, 100);
    const zoomAfter = Number(container.getAttribute("data-zoom"));
    const panXAfter = Number(container.getAttribute("data-pan-x"));
    const panYAfter = Number(container.getAttribute("data-pan-y"));
    expect(zoomAfter).toBeCloseTo(1.4641, 12);
    expect((300 - panXAfter) / zoomAfter).toBeCloseTo(stageX, 9);
    expect((200 - panYAfter) / zoomAfter).toBeCloseTo(stageY, 9);
  });

  it("pans on an empty-canvas drag and never moves the component bodies", () => {
    const onMoveComponent = vi.fn();
    renderCanvas(makeSnapshot(), makeConnections(), { onMoveComponent });
    const container = screen.getByTestId("circuit-canvas");

    fireEvent.pointerDown(container, { clientX: 100, clientY: 50, button: 0 });
    fireEvent.pointerMove(container, { clientX: 130, clientY: 90 });
    fireEvent.pointerUp(container, { clientX: 130, clientY: 90 });

    expect(container.getAttribute("data-pan-x")).toBe("30");
    expect(container.getAttribute("data-pan-y")).toBe("40");
    expect(onMoveComponent).not.toHaveBeenCalled();
  });

  it("a body drag takes priority over panning even when the move passes over the canvas", () => {
    const onMoveComponent = vi.fn();
    renderCanvas(makeSnapshot(), makeConnections(), { onMoveComponent });
    const container = screen.getByTestId("circuit-canvas");
    const body = screen.getByTestId("body-led");

    fireEvent.pointerDown(body, { clientX: 100, clientY: 100, button: 0 });
    // Move far (well past the 4px threshold) over the bare canvas.
    fireEvent.pointerMove(container, { clientX: 250, clientY: 220 });
    fireEvent.pointerUp(container, { clientX: 250, clientY: 220 });

    // The component was dragged (in stage units) but the viewport did not pan.
    expect(onMoveComponent).toHaveBeenCalledWith("led", { x: 550, y: 160 });
    expect(container.getAttribute("data-pan-x")).toBe("0");
    expect(container.getAttribute("data-pan-y")).toBe("0");
  });

  it("translates a drop through the current pan/zoom (drop lands on the right stage point)", () => {
    const onPlaceComponent = vi.fn();
    renderCanvas(makeSnapshot(), makeConnections(), { onPlaceComponent });
    const container = screen.getByTestId("circuit-canvas");

    // Zoom in 8 ticks (zoom = 1.1^8), cursor-centered on (300,200).
    wheel(container, -100);
    wheel(container, -100);
    wheel(container, -100);
    wheel(container, -100);
    wheel(container, -100);
    wheel(container, -100);
    wheel(container, -100);
    wheel(container, -100);
    expect(Number(container.getAttribute("data-zoom"))).toBeCloseTo(1.1 ** 8, 9);

    // Drop at client (600,350): stage = (client - pan)/zoom, rect is zero.
    dropPaletteComponent(container, "led", 600, 350);
    const zoom = Number(container.getAttribute("data-zoom"));
    const panX = Number(container.getAttribute("data-pan-x"));
    const panY = Number(container.getAttribute("data-pan-y"));
    expect(onPlaceComponent).toHaveBeenCalledTimes(1);
    expect(onPlaceComponent).toHaveBeenCalledWith(
      { x: (600 - panX) / zoom, y: (350 - panY) / zoom },
      "led"
    );
  });

  it("repositions a body drag through the current pan/zoom in stage units", () => {
    const onMoveComponent = vi.fn();
    renderCanvas(makeSnapshot(), makeConnections(), { onMoveComponent });
    const container = screen.getByTestId("circuit-canvas");
    const body = screen.getByTestId("body-led");

    // 8 wheel zoom-ins => zoom = 1.1^8, still cursor-centered on (300,200).
    for (let i = 0; i < 8; i++) wheel(container, -100);
    const zoom = Number(container.getAttribute("data-zoom"));
    const panX = Number(container.getAttribute("data-pan-x"));
    const panY = Number(container.getAttribute("data-pan-y"));

    fireEvent.pointerDown(body, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(container, { clientX: 220, clientY: 190 });
    fireEvent.pointerUp(container, { clientX: 220, clientY: 190 });

    const startStage = { x: (100 - panX) / zoom, y: (100 - panY) / zoom };
    const endStage = { x: (220 - panX) / zoom, y: (190 - panY) / zoom };
    expect(onMoveComponent).toHaveBeenCalledWith("led", {
      x: 400 + (endStage.x - startStage.x),
      y: 40 + (endStage.y - startStage.y),
    });
  });

  it("wire endpoints stay in stage space when the view is panned and zoomed", () => {
    // wheel-zoom to 2x then pan — the rendered wire line coordinates must not
    // change because they live on the (transformed) stage layer.
    const { rerender } = renderCanvas(makeSnapshot(), makeConnections());
    const container = screen.getByTestId("circuit-canvas");
    const visibleLine = (): Element => {
      const g = screen.getByTestId("wire-w2");
      return g.querySelectorAll("line")[1];
    };
    const before = {
      x2: visibleLine().getAttribute("x2"),
      y2: visibleLine().getAttribute("y2"),
    };

    for (let i = 0; i < 8; i++) wheel(container, -100);
    fireEvent.pointerDown(container, { clientX: 100, clientY: 100, button: 0 });
    fireEvent.pointerMove(container, { clientX: 500, clientY: 300 });
    fireEvent.pointerUp(container, { clientX: 500, clientY: 300 });

    rerender(
      <CircuitCanvas
        snapshot={makeSnapshot()}
        connections={makeConnections()}
        positions={defaultPositions()}
        onConnect={vi.fn()}
        onDisconnect={vi.fn()}
        onPress={vi.fn()}
        onRelease={vi.fn()}
        onKnobChange={vi.fn()}
        onDistanceChange={vi.fn()}
        onMoveComponent={vi.fn()}
        onPlaceComponent={vi.fn()}
        onDeleteComponent={vi.fn()}
      />
    );
    expect(visibleLine().getAttribute("x2")).toBe(before.x2);
    expect(visibleLine().getAttribute("y2")).toBe(before.y2);
  });
});
