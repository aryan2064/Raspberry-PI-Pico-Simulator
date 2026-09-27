import { describe, it, expect, beforeEach } from "vitest";
import { Circuit, PicoBoard, Button } from "../index";

describe("Button (passive 4-pin switch)", () => {
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

  it("permanently shorts each strip (leg1a-leg1b, leg2a-leg2b) whether pressed or not", () => {
    // No wires at all: the strips' internal shorts still union the pair nets.
    circuit.resolveNets();
    expect(button.pin("leg1a").netId).toBe(button.pin("leg1b").netId);
    expect(button.pin("leg2a").netId).toBe(button.pin("leg2b").netId);
    // The two strips are separate nets while the button is open.
    expect(button.pin("leg1a").netId).not.toBe(button.pin("leg2a").netId);

    button.press();
    circuit.resolveNets();
    expect(button.pin("leg1a").netId).toBe(button.pin("leg1b").netId);
    expect(button.pin("leg2a").netId).toBe(button.pin("leg2b").netId);
    expect(button.pin("leg1a").netId).toBe(button.pin("leg2a").netId);

    button.release();
    circuit.resolveNets();
    expect(button.pin("leg1a").netId).toBe(button.pin("leg1b").netId);
    expect(button.pin("leg2a").netId).toBe(button.pin("leg2b").netId);
    expect(button.pin("leg1a").netId).not.toBe(button.pin("leg2a").netId);
  });

  it("bridges the two strips together while pressed", () => {
    // leg1a hangs off a driven rail; leg2a off a listening pin. While open
    // they are separate nets; pressing the button merges them.
    circuit.connect(button.pin("leg1a"), board.pin("GPIO0"));
    circuit.connect(board.pin("GPIO1"), button.pin("leg2a"));
    circuit.resolveNets();

    board.pin("GPIO0").mode = "OUT";
    board.pin("GPIO0").value = "HIGH";
    board.pin("GPIO1").mode = "IN";

    circuit.tick(1 / 60);
    // Open: GPIO1's own net has no driver -> FLOATING.
    expect(board.pin("GPIO1").value).toBe("FLOATING");

    button.press();
    circuit.tick(1 / 60);
    // Closed: leg1a's net (driven HIGH by GPIO0) and leg2a's net are one.
    expect(board.pin("GPIO1").value).toBe("HIGH");
    expect(button.getRenderInfo()).toEqual({ type: "button", isPressed: true });
  });

  it("splits the nets again when released", () => {
    circuit.connect(button.pin("leg1a"), board.pin("GPIO0"));
    circuit.connect(board.pin("GPIO1"), button.pin("leg2a"));
    circuit.resolveNets();

    board.pin("GPIO0").mode = "OUT";
    board.pin("GPIO0").value = "HIGH";
    board.pin("GPIO1").mode = "IN";

    button.press();
    circuit.tick(1 / 60);
    expect(board.pin("GPIO1").value).toBe("HIGH");

    button.release();
    circuit.tick(1 / 60);
    expect(board.pin("GPIO1").value).toBe("FLOATING");
    expect(button.getRenderInfo()).toEqual({ type: "button", isPressed: false });
  });

  it("drives a pull-down net LOW at rest and HIGH while held (demo button circuit)", () => {
    // 3V3_OUT -> leg1a, leg2a -> GPIO15(IN, pull DOWN)
    circuit.connect(board.pin("3V3_OUT"), button.pin("leg1a"));
    circuit.connect(button.pin("leg2a"), board.pin("GPIO15"));
    circuit.resolveNets();
    board.pin("GPIO15").mode = "IN";
    board.pin("GPIO15").pull = "DOWN";

    circuit.tick(1 / 60);
    // At rest: driverless net, pull-down fallback -> LOW.
    expect(board.pin("GPIO15").value).toBe("LOW");

    button.press();
    circuit.tick(1 / 60);
    // Shorted to 3V3_OUT (OUT HIGH): active driver wins over pull-down -> HIGH.
    expect(board.pin("GPIO15").value).toBe("HIGH");

    button.release();
    circuit.tick(1 / 60);
    // Split again: back to pull-down fallback -> LOW.
    expect(board.pin("GPIO15").value).toBe("LOW");
  });

  it("wiring either leg of a strip drives the GPIO identically (leg1a vs leg1b)", () => {
    // Same circuit as the demo, but the rail lands on the OTHER leg of the
    // top strip — leg1b behaves exactly like leg1a because they are one net.
    circuit.connect(board.pin("3V3_OUT"), button.pin("leg1b"));
    circuit.connect(button.pin("leg2a"), board.pin("GPIO15"));
    circuit.resolveNets();
    board.pin("GPIO15").mode = "IN";
    board.pin("GPIO15").pull = "DOWN";

    circuit.tick(1 / 60);
    expect(board.pin("GPIO15").value).toBe("LOW");

    button.press();
    circuit.tick(1 / 60);
    expect(board.pin("GPIO15").value).toBe("HIGH");

    button.release();
    circuit.tick(1 / 60);
    expect(board.pin("GPIO15").value).toBe("LOW");
  });

  it("reports unpressed before any interaction", () => {
    circuit.resolveNets();
    circuit.tick(1 / 60);
    expect(button.getRenderInfo()).toEqual({ type: "button", isPressed: false });
  });
});