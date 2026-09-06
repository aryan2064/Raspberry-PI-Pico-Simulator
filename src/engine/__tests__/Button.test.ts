import { describe, it, expect, beforeEach } from "vitest";
import { Circuit, PicoBoard, Button } from "../index";

describe("Button component", () => {
  let circuit: Circuit;
  let board: PicoBoard;
  let button: Button;

  beforeEach(() => {
    circuit = new Circuit();
    board = new PicoBoard();
    button = new Button();
    circuit.addComponent(board);
    circuit.addComponent(button);
  });

  it("drives a connected IN pin HIGH while pressed", () => {
    circuit.connect(button.pin("signal"), board.pin("GPIO0"));
    circuit.resolveNets();

    board.pin("GPIO0").mode = "IN";
    button.press();
    circuit.tick(1 / 60);

    expect(board.pin("GPIO0").value).toBe("HIGH");
    expect(button.getRenderInfo()).toEqual({ type: "button", isPressed: true });
  });

  it("drives a connected IN pin LOW after release", () => {
    circuit.connect(button.pin("signal"), board.pin("GPIO0"));
    circuit.resolveNets();

    board.pin("GPIO0").mode = "IN";
    button.press();
    circuit.tick(1 / 60);
    button.release();
    circuit.tick(1 / 60);

    expect(board.pin("GPIO0").value).toBe("LOW");
    expect(button.getRenderInfo()).toEqual({ type: "button", isPressed: false });
  });

  it("already reports LOW before the first press", () => {
    circuit.resolveNets();
    circuit.tick(1 / 60);

    expect(button.getRenderInfo()).toEqual({ type: "button", isPressed: false });
  });
});