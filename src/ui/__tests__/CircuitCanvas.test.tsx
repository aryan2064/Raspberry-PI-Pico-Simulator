// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CircuitCanvas } from "../CircuitCanvas";
import { Button, Circuit, LED, PicoBoard } from "../../engine";

const FRAME = 1000 / 60;

describe("CircuitCanvas", () => {
  let circuit: Circuit;
  let board: PicoBoard;
  let led: LED;
  let button: Button;

  beforeEach(() => {
    vi.useFakeTimers();
    circuit = new Circuit();
    board = new PicoBoard();
    led = new LED();
    button = new Button();
    circuit.addComponent(board);
    circuit.addComponent(led);
    circuit.addComponent(button);

    // Pre-wire a working demo: button -> GPIO15 -> LED anode; cathode -> GND.
    circuit.connect(button.pin("signal"), board.pin("GPIO15"));
    circuit.connect(board.pin("GPIO15"), led.pin("anode"));
    circuit.connect(led.pin("cathode"), board.pin("GND"));
    // A GPIO pin only listens once set to IN (mirrors the machine.Pin shim).
    board.pin("GPIO15").mode = "IN";
    circuit.resolveNets();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  function awaitFrames(n: number) {
    act(() => {
      vi.advanceTimersByTime(n * FRAME);
    });
  }

  it("renders every component and the existing wires", () => {
    render(<CircuitCanvas circuit={circuit} />);

    expect(screen.getByTestId("pico-board")).toBeTruthy();
    expect(screen.getByTestId("led-body")).toBeTruthy();
    expect(screen.getByTestId("button-body")).toBeTruthy();

    expect(circuit.wires).toHaveLength(3);
    for (const w of circuit.wires) {
      expect(screen.getByTestId(`wire-${w.id}`)).toBeTruthy();
    }
  });

  it("lights the LED on press and turns it off on release", () => {
    render(<CircuitCanvas circuit={circuit} />);

    expect(screen.getByTestId("led-body").getAttribute("data-on")).toBe("false");

    fireEvent.mouseDown(screen.getByTestId("button-body"));
    awaitFrames(3);
    expect(board.pin("GPIO15").value).toBe("HIGH");
    expect(screen.getByTestId("led-body").getAttribute("data-on")).toBe("true");

    fireEvent.mouseUp(screen.getByTestId("button-body"));
    awaitFrames(3);
    expect(screen.getByTestId("led-body").getAttribute("data-on")).toBe("false");
  });

  it("creates a working wire by clicking two pins on different components", () => {
    render(<CircuitCanvas circuit={circuit} />);

    fireEvent.click(screen.getByTestId(`pin-${led.pin("anode").id}`));
    fireEvent.click(screen.getByTestId(`pin-${board.pin("GPIO16").id}`));

    expect(circuit.wires).toHaveLength(4);
    const newWire = circuit.wires[3];
    // The new wire is rendered between the two clicked pins' screen positions.
    expect(screen.getByTestId(`wire-${newWire.id}`)).toBeTruthy();
  });

  it("cancels the pending wire when the same pin is clicked twice", () => {
    render(<CircuitCanvas circuit={circuit} />);

    const anode = screen.getByTestId(`pin-${led.pin("anode").id}`);
    fireEvent.click(anode);
    fireEvent.click(anode);

    expect(circuit.wires).toHaveLength(3);
  });

  it("paints bodies then wires then pins, so wires sit above bodies and pins above wires", () => {
    render(<CircuitCanvas circuit={circuit} />);

    const bodies = document.querySelector('[data-layer="bodies"]')!;
    const wires = document.querySelector('[data-layer="wires"]')!;
    const pins = document.querySelector('[data-layer="pins"]')!;

    // In SVG, paint order = document order; later siblings render on top.
    const bodiesBeforeWires =
      bodies.compareDocumentPosition(wires) & Node.DOCUMENT_POSITION_FOLLOWING;
    const wiresBeforePins =
      wires.compareDocumentPosition(pins) & Node.DOCUMENT_POSITION_FOLLOWING;
    expect(bodiesBeforeWires).toBeTruthy();
    expect(wiresBeforePins).toBeTruthy();
  });

  it("removes a wire when clicked, breaking the connection behind it", () => {
    render(<CircuitCanvas circuit={circuit} />);

    const signalWire = circuit.wires.find(
      (w) => w.a === button.pin("signal") || w.b === button.pin("signal")
    )!;

    fireEvent.click(screen.getByTestId(`wire-${signalWire.id}`));

    // The wire is gone from the DOM and from the circuit.
    expect(screen.queryByTestId(`wire-${signalWire.id}`)).toBeNull();
    expect(circuit.wires).toHaveLength(2);

    // The connection is really broken: pressing the button no longer reaches
    // GPIO15 (its net is now driverless), so the LED stays off.
    fireEvent.mouseDown(screen.getByTestId("button-body"));
    awaitFrames(3);
    expect(board.pin("GPIO15").value).toBe("FLOATING");
    expect(screen.getByTestId("led-body").getAttribute("data-on")).toBe("false");

    fireEvent.mouseUp(screen.getByTestId("button-body"));
  });
});