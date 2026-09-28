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

  it("places relay and transistor drops like any other palette part", () => {
    const onPlaceComponent = vi.fn();
    renderCanvas(makeSnapshot(), makeConnections(), { onPlaceComponent });

    const svg = screen.getByTestId("circuit-canvas");
    dropPaletteComponent(svg, "relay", 300, 200);
    dropPaletteComponent(svg, "transistor", 500, 400);

    expect(onPlaceComponent).toHaveBeenCalledTimes(2);
    expect(onPlaceComponent).toHaveBeenCalledWith({ x: 300, y: 200 }, "relay");
    expect(onPlaceComponent).toHaveBeenCalledWith({ x: 500, y: 400 }, "transistor");
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
