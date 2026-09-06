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

  it("removes a component and every wire attached to its pins", () => {
    circuit.connect(board.pin("GPIO15"), led.pin("anode"));
    circuit.connect(board.pin("GND"), led.pin("cathode"));
    // An untouched wire must survive the removal, to prove the cascade only
    // targets wires actually touching the removed component's pins.
    circuit.connect(board.pin("GPIO0"), board.pin("GPIO1"));
    circuit.resolveNets();
    expect(circuit.wires).toHaveLength(3);

    circuit.removeComponent(led.id);
    circuit.resolveNets();

    // The LED is gone, both of its wires are gone, and the unrelated
    // GPIO0-GPIO1 wire (owner is the board on both ends) remains.
    expect(circuit.components.some((c) => c.id === led.id)).toBe(false);
    expect(circuit.wires).toHaveLength(1);
    expect(circuit.wires[0].a.owner).toBe(board);

    // The board pin that used to drive the LED is back in a driverless net,
    // while the untouched GPIO0-GPIO1 net still resolves its own value.
    board.pin("GPIO1").mode = "IN";
    board.pin("GPIO0").mode = "OUT";
    board.pin("GPIO0").value = "HIGH";
    circuit.tick(1 / 60);
    expect(board.pin("GPIO15").netId).not.toBe(led.pin("cathode").netId);
    expect(board.pin("GPIO0").netId).toBe(board.pin("GPIO1").netId);
    expect(board.pin("GPIO1").value).toBe("HIGH");
  });
});

describe("Circuit conflict detection (hasConflict)", () => {
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

  it("flags every pin in a net with two digital drivers and resolves it to FLOATING", () => {
    circuit.connect(board.pin("GPIO0"), led.pin("anode"));
    circuit.connect(board.pin("GPIO1"), led.pin("anode"));
    circuit.resolveNets();

    board.pin("GPIO0").mode = "OUT";
    board.pin("GPIO0").value = "HIGH";
    board.pin("GPIO1").mode = "OUT";
    board.pin("GPIO1").value = "LOW";

    circuit.tick(1 / 60);

    // The net resolves to FLOATING (unchanged placeholder) and every pin in
    // it — drivers and listeners alike — carries the diagnostic flag.
    expect(led.pin("anode").value).toBe("FLOATING");
    expect(led.pin("anode").hasConflict).toBe(true);
    expect(board.pin("GPIO0").hasConflict).toBe(true);
    expect(board.pin("GPIO1").hasConflict).toBe(true);

    // Dropping one driver returns the net to a clean single-driver state.
    circuit.disconnect(circuit.wires[0].id);
    circuit.resolveNets();
    circuit.tick(1 / 60);
    expect(board.pin("GPIO1").value).toBe("LOW");
    expect(led.pin("anode").value).toBe("LOW");
    expect(led.pin("anode").hasConflict).toBe(false);
  });

  it("flags no pin in a net with a single driver", () => {
    circuit.connect(board.pin("GPIO15"), led.pin("anode"));
    circuit.resolveNets();

    board.pin("GPIO15").mode = "OUT";
    board.pin("GPIO15").value = "HIGH";

    circuit.tick(1 / 60);
    expect(led.pin("anode").value).toBe("HIGH");
    expect(led.pin("anode").hasConflict).toBe(false);
    expect(board.pin("GPIO15").hasConflict).toBe(false);
  });

  it("flags nets with two analog drivers and resolves analogValue to null", () => {
    circuit.connect(board.pin("GPIO0"), led.pin("anode"));
    circuit.connect(board.pin("GPIO1"), led.pin("anode"));
    circuit.resolveNets();

    board.pin("GPIO0").mode = "OUT";
    board.pin("GPIO0").value = "HIGH";
    board.pin("GPIO0").analogValue = 0.6;
    board.pin("GPIO1").mode = "OUT";
    board.pin("GPIO1").value = "LOW";
    board.pin("GPIO1").analogValue = 0.3;

    circuit.tick(1 / 60);

    expect(led.pin("anode").analogValue).toBeNull();
    expect(led.pin("anode").hasConflict).toBe(true);
    expect(board.pin("GPIO0").hasConflict).toBe(true);
    expect(board.pin("GPIO1").hasConflict).toBe(true);
  });
});
