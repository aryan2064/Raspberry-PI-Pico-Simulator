import { describe, it, expect, beforeEach } from "vitest";
import { Circuit, PicoBoard, Transistor, LED } from "../index";

// State-driven internal connection -> all conduction tests drive `base` over
// an actual wire and step the circuit. Per Circuit.tick()'s ordering the state
// flip takes two ticks (see Relay.test.ts for the walk-through).
describe("Transistor (NPN, base-controlled switch)", () => {
  let circuit: Circuit;
  let board: PicoBoard;
  let transistor: Transistor;
  let led: LED;

  beforeEach(() => {
    circuit = new Circuit();
    board = new PicoBoard();
    transistor = new Transistor();
    led = new LED();
    circuit.addComponent(board);
    circuit.addComponent(transistor);
    circuit.addComponent(led);
  });

  it("is cut off by default: no collector–emitter path at all", () => {
    circuit.resolveNets();
    expect(transistor.getRenderInfo()).toEqual({ type: "transistor", conducting: false });
    // Cutoff returns ZERO pairs — collector and emitter stay entirely separate.
    expect(transistor.pin("collector").netId).not.toBe(transistor.pin("emitter").netId);
  });

  it("conducts only while base reads HIGH (HIGH/LOW/FLOATING behavior)", () => {
    circuit.connect(board.pin("GPIO15"), transistor.pin("base"));
    circuit.connect(board.pin("3V3_OUT"), transistor.pin("collector"));
    circuit.connect(transistor.pin("emitter"), board.pin("GPIO0"));
    circuit.resolveNets();
    board.pin("GPIO15").mode = "OUT";
    board.pin("GPIO0").mode = "IN";

    // base HIGH -> saturated: collector–emitter shorted, rail reaches GPIO0.
    board.pin("GPIO15").value = "HIGH";
    circuit.resolveNow();
    circuit.tick(1 / 60);
    circuit.tick(1 / 60);
    expect(board.pin("GPIO0").value).toBe("HIGH");
    expect(transistor.getRenderInfo()).toEqual({ type: "transistor", conducting: true });
    expect(transistor.pin("collector").netId).toBe(transistor.pin("emitter").netId);

    // base LOW -> cutoff: the emitter net loses the rail -> FLOATING.
    board.pin("GPIO15").value = "LOW";
    circuit.resolveNow();
    circuit.tick(1 / 60);
    circuit.tick(1 / 60);
    expect(board.pin("GPIO0").value).toBe("FLOATING");
    expect(transistor.getRenderInfo()).toEqual({ type: "transistor", conducting: false });
    expect(transistor.pin("collector").netId).not.toBe(transistor.pin("emitter").netId);
  });

  it("cuts off on a FLOATING base (no pin you wire it to ever leaves it on)", () => {
    circuit.connect(board.pin("GPIO15"), transistor.pin("base"));
    circuit.connect(board.pin("3V3_OUT"), transistor.pin("collector"));
    circuit.connect(transistor.pin("emitter"), board.pin("GPIO0"));
    circuit.resolveNets();
    board.pin("GPIO0").mode = "IN";

    circuit.tick(1 / 60);
    circuit.tick(1 / 60);
    // GPIO15 is INPUT-with-no-driver: the base net stays FLOATING -> cutoff,
    // despite the collector being strapped to the rail.
    expect(board.pin("GPIO15").value).toBe("FLOATING");
    expect(transistor.getRenderInfo()).toEqual({ type: "transistor", conducting: false });
    expect(board.pin("GPIO0").value).toBe("FLOATING");
  });

  it("end-to-end demo: GPIO base drive powers an LED through the collector load path", () => {
    //   GPIO15(OUT)  -> transistor.base
    //   3V3_OUT      -> transistor.collector
    //   transistor.emitter -> LED2.anode
    //   LED2.cathode -> GND
    circuit.connect(board.pin("GPIO15"), transistor.pin("base"));
    circuit.connect(board.pin("3V3_OUT"), transistor.pin("collector"));
    circuit.connect(transistor.pin("emitter"), led.pin("anode"));
    circuit.connect(led.pin("cathode"), board.pin("GND"));
    circuit.resolveNets();
    board.pin("GPIO15").mode = "OUT";

    circuit.tick(1 / 60);
    circuit.tick(1 / 60);
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: false, brightness: 0 });

    board.pin("GPIO15").value = "HIGH";
    circuit.resolveNow();
    circuit.tick(1 / 60);
    circuit.tick(1 / 60);
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: true, brightness: 1 });

    board.pin("GPIO15").value = "LOW";
    circuit.resolveNow();
    circuit.tick(1 / 60);
    circuit.tick(1 / 60);
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: false, brightness: 0 });
  });
});