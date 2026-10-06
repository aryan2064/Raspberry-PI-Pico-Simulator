import { describe, it, expect, beforeEach } from "vitest";
import { Circuit, PicoBoard, Resistor } from "../index";
import { LED } from "../index";

describe("Resistor", () => {
  let circuit: Circuit;
  let board: PicoBoard;

  beforeEach(() => {
    circuit = new Circuit();
    board = new PicoBoard();
    circuit.addComponent(board);
  });

  it("broadcasts terminal1 as a mode-IN analog source even with nothing on the net", () => {
    const resistor = new Resistor(2000, "r1");
    circuit.addComponent(resistor);
    expect(resistor.getRenderInfo()).toEqual({ type: "resistor", resistanceOhms: 2000 });

    circuit.tick(1 / 60);
    // 2000 / 20000 (full scale) = 0.1
    expect(resistor.pin("terminal1").analogValue).toBeCloseTo(0.1);
  });

  it("maps different resistances to different fractions on the shared net", () => {
    const low = new Resistor(2000, "r-low");
    const high = new Resistor(20000, "r-high");
    const led = new LED("led1");
    circuit.addComponent(low);
    circuit.addComponent(high);
    circuit.addComponent(led);

    // low drives the LED's net alone -> 0.1 duty.
    circuit.connect(low.pin("terminal1"), led.pin("anode"));
    circuit.resolveNets();
    circuit.tick(1 / 60);
    expect((led.getRenderInfo() as { type: "led"; brightness: number }).brightness).toBeCloseTo(0.1);

    // Unwire it, wire the full-scale resistor -> 1.0 duty.
    circuit.disconnect(circuit.wires[0].id);
    circuit.connect(high.pin("terminal1"), led.pin("anode"));
    circuit.resolveNets();
    circuit.tick(1 / 60);
    expect((led.getRenderInfo() as { type: "led"; brightness: number }).brightness).toBeCloseTo(1);

    // Both on the same net = two analog sources -> conflict -> null (no blend).
    circuit.connect(low.pin("terminal1"), high.pin("terminal1"));
    circuit.resolveNets();
    circuit.tick(1 / 60);
    expect(led.pin("anode").analogValue).toBeNull();
  });

  it("clamps resistanceFraction at the documented full scale", () => {
    const resistor = new Resistor(40000);
    circuit.addComponent(resistor);
    circuit.tick(1 / 60);
    expect(resistor.pin("terminal1").analogValue).toBe(1);
  });
});