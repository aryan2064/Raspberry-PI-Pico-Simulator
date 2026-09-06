import { describe, it, expect, beforeEach } from "vitest";
import { Circuit, PicoBoard, LED } from "../index";

describe("Circuit net resolution", () => {
  let circuit: Circuit;
  let board: PicoBoard;
  let led: LED;

  beforeEach(() => {
    circuit = new Circuit();
    board = new PicoBoard();
    led = new LED();
    circuit.addComponent(board);
    circuit.addComponent(led);
  });

  it("resolves an unconnected pin to FLOATING (no driver in net)", () => {
    // LED anode is alone (well, sharing with cathode only if we connect it).
    circuit.resolveNets();
    circuit.tick(1 / 60);
    // anode has no driver -> floating -> LED off
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: false });
  });

  it("turns the LED on when the driver pin is driven HIGH", () => {
    circuit.connect(board.pin("GPIO15"), led.pin("anode"));
    circuit.connect(board.pin("GND"), led.pin("cathode"));
    circuit.resolveNets();

    board.pin("GPIO15").mode = "OUT";
    board.pin("GPIO15").value = "HIGH";

    circuit.tick(1 / 60);
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: true });
  });

  it("turns the LED off when the driver pin is driven LOW", () => {
    circuit.connect(board.pin("GPIO15"), led.pin("anode"));
    circuit.resolveNets();

    board.pin("GPIO15").mode = "OUT";
    board.pin("GPIO15").value = "LOW";

    circuit.tick(1 / 60);
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: false });
  });

  it("resolves a net with multiple drivers to FLOATING (known gap placeholder)", () => {
    // Two output pins connected to the same net — a conflict.
    circuit.connect(board.pin("GPIO0"), led.pin("anode"));
    circuit.connect(board.pin("GPIO1"), led.pin("anode"));
    circuit.resolveNets();

    board.pin("GPIO0").mode = "OUT";
    board.pin("GPIO0").value = "HIGH";
    board.pin("GPIO1").mode = "OUT";
    board.pin("GPIO1").value = "LOW";

    circuit.tick(1 / 60);
    // Conflict placeholder resolves to FLOATING, so LED stays off.
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: false });
  });

  it("propagates a net value through an intermediate net (transitive wiring)", () => {
    // GPIO15 -> LED anode, and cathode -> GND puts LED on regardless.
    circuit.connect(board.pin("GPIO15"), led.pin("anode"));
    circuit.resolveNets();

    board.pin("GPIO15").mode = "OUT";
    board.pin("GPIO15").value = "HIGH";
    circuit.tick(1 / 60);
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: true });
  });

  it("disconnects a wire so its pins are no longer in the same net", () => {
    const wire = circuit.connect(board.pin("GPIO15"), led.pin("anode"));
    circuit.resolveNets();

    // Sanity: while connected, driving GPIO15 HIGH lights the LED.
    board.pin("GPIO15").mode = "OUT";
    board.pin("GPIO15").value = "HIGH";
    circuit.tick(1 / 60);
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: true });

    // Remove the wire and re-resolve. The anode is now in a driverless net,
    // so driving GPIO15 no longer affects it — LED stays off.
    circuit.disconnect(wire.id);
    circuit.resolveNets();
    circuit.tick(1 / 60);
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: false });
    expect(circuit.wires).toHaveLength(0);
  });
});
