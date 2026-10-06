import { describe, it, expect, beforeEach } from "vitest";
import { Circuit, PicoBoard, Potentiometer } from "../index";
import { LED } from "../index";

describe("Potentiometer", () => {
  let circuit: Circuit;
  let board: PicoBoard;

  beforeEach(() => {
    circuit = new Circuit();
    board = new PicoBoard();
    circuit.addComponent(board);
  });

  it("reports knobPosition 0 by default and never exposes the wiper as a digital driver", () => {
    const pot = new Potentiometer();
    circuit.addComponent(pot);
    expect(pot.pin("wiper").mode).toBe("IN");
    expect(pot.pin("terminal1").mode).toBe("UNSET");
    expect(pot.pin("terminal2").mode).toBe("UNSET");
    expect(pot.getRenderInfo()).toEqual({ type: "potentiometer", knobPosition: 0 });
  });

  it("setKnobPosition drives the wiper's analogValue and propagates it to listeners", () => {
    const pot = new Potentiometer("pot");
    const led = new LED("led1");
    circuit.addComponent(pot);
    circuit.addComponent(led);

    circuit.connect(pot.pin("wiper"), led.pin("anode"));
    circuit.connect(led.pin("cathode"), board.pin("GND"));
    circuit.resolveNets();

    pot.setKnobPosition(0.6);
    circuit.tick(1 / 60);

    // The wiper is a mode-IN analog source (no OUT involved anywhere).
    expect(pot.pin("wiper").analogValue).toBe(0.6);
    expect(led.pin("anode").analogValue).toBe(0.6);
    // A fully-dimmed LED: the pot cannot drive anything digitally.
    expect((led.getRenderInfo() as { type: "led"; brightness: number }).brightness).toBeCloseTo(0.6);
  });

  it("clamps knobPosition to 0..1", () => {
    const pot = new Potentiometer();
    const potInfo = () =>
      pot.getRenderInfo() as { type: "potentiometer"; knobPosition: number };
    pot.setKnobPosition(1.7);
    expect(potInfo().knobPosition).toBe(1);
    pot.setKnobPosition(-0.2);
    expect(potInfo().knobPosition).toBe(0);
  });
});