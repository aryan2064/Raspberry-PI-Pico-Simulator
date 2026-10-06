import { describe, it, expect, beforeEach } from "vitest";
import { Capacitor, Circuit, PicoBoard, Resistor } from "../index";

describe("Capacitor RC timing", () => {
  let circuit: Circuit;
  let board: PicoBoard;

  beforeEach(() => {
    circuit = new Circuit();
    board = new PicoBoard();
    circuit.addComponent(board);
  });

  // The classic GPIO RC recipe: a real OUT driver discharges the cap, then the
  // pin flips to IN (no driver) and the cap recharges through the resistor's
  // analog fraction until it trips its pull and the net reads HIGH again.
  function discharge(gpio: number): void {
    board.pin(`GPIO${gpio}`).mode = "OUT";
    board.pin(`GPIO${gpio}`).value = "LOW";
    circuit.tick(1 / 60);
  }
  function poll(gpio: number): void {
    board.pin(`GPIO${gpio}`).mode = "IN";
    circuit.tick(1 / 60);
  }

  function capCharged(cap: Capacitor): boolean {
    return (cap.getRenderInfo() as { type: "capacitor"; charged: boolean }).charged;
  }

  it("forced-discharges while a real OUT LOW driver owns the net", () => {
    const cap = new Capacitor({ maxChargeSeconds: 2 }, "cap");
    circuit.addComponent(cap);
    circuit.connect(board.pin("GPIO0"), cap.pin("a"));
    circuit.resolveNets();

    discharge(0);

    expect(board.pin("GPIO0").mode).toBe("OUT");
    expect(board.pin("GPIO0").value).toBe("LOW");
    expect(cap.getRenderInfo()).toEqual({ type: "capacitor", chargeFraction: 0, charged: false });
    expect(cap.pin("a").pull).toBe("DOWN");
  });

  it("forced-charges while a real OUT HIGH driver owns the net", () => {
    const cap = new Capacitor({ maxChargeSeconds: 2 }, "cap");
    circuit.addComponent(cap);
    circuit.connect(board.pin("GPIO0"), cap.pin("a"));
    circuit.resolveNets();

    board.pin("GPIO0").mode = "OUT";
    board.pin("GPIO0").value = "HIGH";
    circuit.tick(1 / 60);

    expect(cap.getRenderInfo()).toEqual({ type: "capacitor", chargeFraction: 1, charged: true });
    expect(cap.pin("a").pull).toBe("UP");
  });

  it("charges through the resistor fraction over accumulated dt and trips the net HIGH", () => {
    const resistor = new Resistor(20000, "r"); // fraction 1.0
    const cap = new Capacitor({ maxChargeSeconds: 1 }, "cap");
    circuit.addComponent(resistor);
    circuit.addComponent(cap);

    circuit.connect(resistor.pin("terminal1"), cap.pin("a"));
    circuit.connect(board.pin("GPIO8"), cap.pin("a"));
    circuit.resolveNets();

    discharge(8); // GPIO8 OUT LOW -> cap empty, pulls DOWN
    expect(capCharged(cap)).toBe(false);

    poll(8); // GPIO8 now IN -> poll phase begins
    expect(capCharged(cap)).toBe(false);

    // threshold = 1s; accumulate 4 x 0.25s ticks.
    for (let i = 0; i < 3; i++) circuit.tick(0.25);
    expect(capCharged(cap)).toBe(false);
    circuit.tick(0.25);
    expect(capCharged(cap)).toBe(true);

    // The cap's pull-UP resolves the driverless net HIGH for the GPIO to read.
    expect(cap.pin("a").pull).toBe("UP");
    expect(board.pin("GPIO8").value).toBe("HIGH");
  });

  it("charges proportionally longer for a lower resistance fraction", () => {
    const secondsToCharge = (resistanceOhms: number): number => {
      const c = new Circuit();
      const b = new PicoBoard();
      c.addComponent(b);
      const cap = new Capacitor({ maxChargeSeconds: 10 }, "cap");
      const resistor = new Resistor(resistanceOhms, "r");
      c.addComponent(cap);
      c.addComponent(resistor);
      c.connect(resistor.pin("terminal1"), cap.pin("a"));
      c.connect(b.pin("GPIO8"), cap.pin("a"));
      c.resolveNets();

      b.pin("GPIO8").mode = "IN"; // clean poll phase
      c.tick(0.01);

      let elapsed = 0;
      while (!capCharged(cap) && elapsed < 20) {
        c.tick(0.1);
        elapsed += 0.1;
      }
      return elapsed;
    };

    // fraction 0.1 (2000Ω) -> 1s; fraction 1.0 (20000Ω) -> 10s.
    expect(secondsToCharge(2000)).toBeCloseTo(1);
    expect(secondsToCharge(20000)).toBeCloseTo(10);
  });

  it("digitallyDriven distinguishes a real driver from the cap's own pull", () => {
    // A cap can pull its own net HIGH (charged) while nothing is digitally
    // driving it — that must not look "driven" (the cap must keep charging,
    // and a later real OUT LOW must still discharge it).
    const cap = new Capacitor({ maxChargeSeconds: 2 }, "cap");
    circuit.addComponent(cap);
    circuit.connect(board.pin("GPIO8"), cap.pin("a"));
    circuit.resolveNets();

    // No driver at all, no resistor -> fraction 0 -> trips instantly.
    board.pin("GPIO8").mode = "IN";
    circuit.tick(1 / 60);
    expect(capCharged(cap)).toBe(true);
    expect(cap.pin("a").digitallyDriven).toBe(false);
    expect(cap.pin("a").pull).toBe("UP");
    expect(board.pin("GPIO8").value).toBe("HIGH");

    // A real OUT LOW driver now appears -> the cap must discharge again.
    discharge(8);
    expect(cap.pin("a").digitallyDriven).toBe(true);
    expect(capCharged(cap)).toBe(false);
    expect(cap.pin("a").pull).toBe("DOWN");
    expect(board.pin("GPIO8").value).toBe("LOW");
  });
});