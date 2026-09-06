import { describe, it, expect, beforeEach } from "vitest";
import { Circuit, PicoBoard } from "../index";

describe("Circuit analog propagation (analogValue channel)", () => {
  let circuit: Circuit;
  let board: PicoBoard;

  beforeEach(() => {
    circuit = new Circuit();
    board = new PicoBoard();
    circuit.addComponent(board);
  });

  it("propagates a single analog driver's analogValue to listening pins", () => {
    circuit.connect(board.pin("GPIO0"), board.pin("GPIO1"));
    circuit.resolveNets();

    board.pin("GPIO0").mode = "OUT";
    board.pin("GPIO0").analogValue = 0.75;
    board.pin("GPIO1").mode = "IN";

    circuit.tick(1 / 60);
    expect(board.pin("GPIO1").analogValue).toBe(0.75);
  });

  it("leaves IN pins' analogValue null when a net has no analog driver", () => {
    circuit.connect(board.pin("GPIO0"), board.pin("GPIO1"));
    circuit.connect(board.pin("GPIO2"), board.pin("GPIO3"));
    circuit.resolveNets();

    board.pin("GPIO0").mode = "OUT";
    board.pin("GPIO0").analogValue = null; // driving digitally, but no analog signal
    board.pin("GPIO1").mode = "IN";
    board.pin("GPIO2").mode = "OUT";
    board.pin("GPIO3").mode = "IN";

    circuit.tick(1 / 60);
    expect(board.pin("GPIO1").analogValue).toBeNull();
    expect(board.pin("GPIO3").analogValue).toBeNull();
  });

  it("resolves multi-analog-driver nets to null (placeholder, mirrors digital conflict)", () => {
    circuit.connect(board.pin("GPIO0"), board.pin("GPIO1"));
    circuit.connect(board.pin("GPIO2"), board.pin("GPIO1"));
    circuit.resolveNets();

    board.pin("GPIO0").mode = "OUT";
    board.pin("GPIO0").analogValue = 0.5;
    board.pin("GPIO2").mode = "OUT";
    board.pin("GPIO2").analogValue = 0.8;
    board.pin("GPIO1").mode = "IN";

    circuit.tick(1 / 60);
    expect(board.pin("GPIO1").analogValue).toBeNull();
  });

  it("keeps the analog and digital channels independent", () => {
    circuit.connect(board.pin("GPIO0"), board.pin("GPIO1"));
    circuit.connect(board.pin("GPIO2"), board.pin("GPIO3"));
    circuit.resolveNets();

    // GPIO0: carries an analog signal but is digitally FLOATING.
    board.pin("GPIO0").mode = "OUT";
    board.pin("GPIO0").analogValue = 0.5;
    board.pin("GPIO1").mode = "IN";

    // GPIO2: carries a digital signal but no analog value.
    board.pin("GPIO2").mode = "OUT";
    board.pin("GPIO2").value = "HIGH";
    board.pin("GPIO2").analogValue = null;
    board.pin("GPIO3").mode = "IN";

    circuit.tick(1 / 60);

    // Analog valid + digital FLOATING.
    expect(board.pin("GPIO1").analogValue).toBe(0.5);
    expect(board.pin("GPIO1").value).toBe("FLOATING");

    // Digital valid + analog null.
    expect(board.pin("GPIO3").value).toBe("HIGH");
    expect(board.pin("GPIO3").analogValue).toBeNull();
  });
});