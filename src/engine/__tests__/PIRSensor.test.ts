import { describe, it, expect, beforeEach } from "vitest";
import { Circuit, PicoBoard, PIRSensor } from "../index";

// PIRSensor test wiring: `out` drives a board GPIO configured IN over a real
// wire. Because triggerMotion() writes the OUT pin directly (not on the next
// update()), the HIGH is visible through a single resolveNow() — the same
// immediate-visibility requirement already established for pull resistors and
// PWM writes. The hold is pure accumulated dt, so the sensor's own pins are
// the source of truth everywhere else.

function wireSensor(circuit: Circuit, board: PicoBoard, sensor: PIRSensor, gpio = 0): void {
  board.pin(`GPIO${gpio}`).mode = "IN"; // receives motion OUT (a GPIO reader)
  circuit.connect(sensor.pin("out"), board.pin(`GPIO${gpio}`));
  circuit.resolveNets();
}

describe("PIRSensor (HC-SR501-style motion module)", () => {
  let circuit: Circuit;
  let board: PicoBoard;
  let sensor: PIRSensor;

  beforeEach(() => {
    circuit = new Circuit();
    board = new PicoBoard("board");
    sensor = new PIRSensor({}, "sensor");
    circuit.addComponent(board);
    circuit.addComponent(sensor);
  });

  it("idles LOW: pins are vcc/gnd (UNSET) + out (OUT), no motion until triggered", () => {
    expect(sensor.pin("vcc").mode).toBe("UNSET");
    expect(sensor.pin("gnd").mode).toBe("UNSET");
    expect(sensor.pin("out").mode).toBe("OUT");
    // A PIR output drive idles LOW, never floating.
    expect(sensor.pin("out").value).toBe("LOW");
    expect(sensor.getRenderInfo()).toEqual({ type: "pir", motionActive: false });
  });

  it("triggerMotion() drives OUT HIGH immediately through resolveNow (no tick)", () => {
    wireSensor(circuit, board, sensor);

    sensor.triggerMotion();
    circuit.resolveNow();

    expect(sensor.getRenderInfo()).toEqual({ type: "pir", motionActive: true });
    expect(sensor.pin("out").value).toBe("HIGH");
    // Propagated to the listening GPIO in the same resolution — proving the
    // trigger is visible at once, not one simulation step late.
    expect(board.pin("GPIO0").value).toBe("HIGH");
  });

  it("OUT returns to LOW after holdSeconds of accumulated dt without a trigger", () => {
    wireSensor(circuit, board, sensor);

    sensor.triggerMotion();
    circuit.tick(1 / 60); // first tick lands the HIGH (update keeps it)

    // Still detected just inside the 5s hold…
    circuit.tick(4.9);
    expect(sensor.getRenderInfo()).toEqual({ type: "pir", motionActive: true });
    expect(sensor.pin("out").value).toBe("HIGH");

    // …and OFF once the hold has elapsed.
    circuit.tick(0.2);
    expect(sensor.getRenderInfo()).toEqual({ type: "pir", motionActive: false });
    expect(sensor.pin("out").value).toBe("LOW");
  });

  it("retriggerable: a mid-hold trigger restarts the full hold from the new instant", () => {
    wireSensor(circuit, board, sensor);

    sensor.triggerMotion(); // hold from t=0
    circuit.tick(3); // t=3, 2s of hold left

    sensor.triggerMotion(); // extends: full 5s from t=3 -> expires t=8
    circuit.tick(1 / 60);
    expect(sensor.getRenderInfo()).toEqual({ type: "pir", motionActive: true });

    // t=7.9: far past the ORIGINAL expiry (t=5) yet still detected — the
    // retrigger extended, it did not merely top up the leftover.
    circuit.tick(4.9);
    expect(sensor.getRenderInfo()).toEqual({ type: "pir", motionActive: true });

    circuit.tick(0.2); // t=8.1 -> past the extended expiry
    expect(sensor.getRenderInfo()).toEqual({ type: "pir", motionActive: false });
    expect(sensor.pin("out").value).toBe("LOW");
  });

  it("non-retriggerable: a mid-hold trigger is ignored until the hold expires", () => {
    const latch = new PIRSensor({ holdSeconds: 5, retriggerable: false }, "latch");
    circuit.addComponent(latch);

    latch.triggerMotion(); // hold from t=0
    circuit.tick(1);

    latch.triggerMotion(); // ignored while already active
    circuit.tick(3); // t=4, still detected on the ORIGINAL schedule

    expect(latch.getRenderInfo()).toEqual({ type: "pir", motionActive: true });
    // t=5.0 is the original expiry; this crosses it. If the ignored trigger had
    // restarted the hold (t=1 -> t=6) it would still be active here.
    latch.triggerMotion();
    circuit.tick(1.1);
    expect(latch.getRenderInfo()).toEqual({ type: "pir", motionActive: false });
    expect(latch.pin("out").value).toBe("LOW");
  });
});