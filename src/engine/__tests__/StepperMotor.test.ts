import { describe, it, expect, beforeEach } from "vitest";
import { Circuit, PicoBoard, StepperMotor } from "../index";

// Drives the stepper's four control inputs over real wires from four board
// GPIOs (exactly what a microcontroller build would do). The motor senses the
// four pins directly (MODE_IN), so a pattern change lands the same tick it is
// written - resolveNow() + one tick() is enough (no relay/transistor-style
// internal-connection latency). Bit order is IN1 IN2 IN3 IN4 = MSB..LSB.
const GPIO = [0, 1, 2, 3] as const; // GPIO0 -> in1, GPIO1 -> in2, ...

function writePattern(circuit: Circuit, board: PicoBoard, pattern: number): void {
  for (let i = 0; i < 4; i++) {
    const bit = (pattern >> (3 - i)) & 1;
    board.pin(`GPIO${GPIO[i]}`).value = bit === 1 ? "HIGH" : "LOW";
  }
  circuit.resolveNow();
  circuit.tick(1 / 60);
}

function info(motor: StepperMotor): StepperInfo {
  const r = motor.getRenderInfo();
  if (r.type !== "stepper") throw new Error("expected stepper render info");
  return r;
}

// One recognized full-step state = 2 half-step units (full states sit at every
// other position of the half-step table).
const FULL_STEP_DEG = (360 / 4096) * 2;
const HALF_STEP_DEG = 360 / 4096;

type StepperInfo = {
  type: "stepper";
  angleDegrees: number;
  direction: "CW" | "CCW" | "none";
  stepsPerSecond: number;
};

describe("StepperMotor (28BYJ-48 + ULN2003, full/half-step sensing)", () => {
  let circuit: Circuit;
  let board: PicoBoard;
  let motor: StepperMotor;

  beforeEach(() => {
    circuit = new Circuit();
    board = new PicoBoard();
    motor = new StepperMotor();
    circuit.addComponent(board);
    circuit.addComponent(motor);
    // IN1<-GPIO0, IN2<-GPIO1, IN3<-GPIO2, IN4<-GPIO3
    GPIO.forEach((g) => {
      circuit.connect(board.pin(`GPIO${g}`), motor.pin(`in${GPIO.indexOf(g) + 1}`));
    });
    circuit.resolveNets();
    GPIO.forEach((g) => (board.pin(`GPIO${g}`).mode = "OUT"));
  });

  it("anchors on the first valid pattern (no phantom movement), then advances a full step per state", () => {
    writePattern(circuit, board, 0b1010); // full-step state 0
    expect(info(motor)).toEqual({
      type: "stepper",
      angleDegrees: 0,
      direction: "none",
      stepsPerSecond: 0,
    });

    // 1010 -> 0110 -> 0101 -> 1001 : three recognized full steps forward.
    writePattern(circuit, board, 0b0110);
    writePattern(circuit, board, 0b0101);
    writePattern(circuit, board, 0b1001);
    expect(info(motor).angleDegrees).toBeCloseTo(3 * FULL_STEP_DEG, 9);
    expect(info(motor).direction).toBe("CW");
  });

  it("re-locks a dual-excitation anchor onto full-step driving and advances 2x (structural 4096/2048 split)", () => {
    // 1010 lives in both tables. Anchored as a half-step state (index 1) it is
    // NOT adjacent to 0110 in the half table (index 3); the transition is only
    // adjacent in the FULL table -> single full step = two half-step units.
    writePattern(circuit, board, 0b1010);
    writePattern(circuit, board, 0b0110);
    expect(info(motor).angleDegrees).toBeCloseTo(FULL_STEP_DEG, 9);
    expect(info(motor)).toMatchObject({ direction: "CW" });
  });

  it("advances backward through the same table: reverse drive flips to CCW and subtracts", () => {
    writePattern(circuit, board, 0b1010); // anchor
    writePattern(circuit, board, 0b0110); // +1 full step (CW)
    writePattern(circuit, board, 0b1010); // -1 full step (CCW: 0110's other neighbor)
    // Reverse of a full step must land back at zero (a true subtraction, not a
    // wrap-around reset), and the direction must flip to CCW.
    expect(info(motor)).toMatchObject({ direction: "CCW" });
    expect(info(motor).angleDegrees).toBeCloseTo(0, 9);
  });

  it("half-step drive moves by 360/4096 per single-excitation state", () => {
    // Pure half-stepping from a single-excitation anchor: 1000 1010 0010 0110.
    writePattern(circuit, board, 0b1000); // anchors into the HALF table
    writePattern(circuit, board, 0b1010);
    writePattern(circuit, board, 0b0010);
    writePattern(circuit, board, 0b0110);
    expect(info(motor).angleDegrees).toBeCloseTo(3 * HALF_STEP_DEG, 9);
    expect(info(motor)).toMatchObject({ direction: "CW" });
  });

  it("ignores invalid patterns - no crash, no movement, lock survives", () => {
    writePattern(circuit, board, 0b1010); // anchor
    writePattern(circuit, board, 0b0110); // +1 full step
    const before = info(motor);

    // All-low, all-high, and single-excitation states that are NOT adjacent to
    // 0110 in either table (0001 is the half-step state at index 6; 0110 is at
    // index 3) are all ignored - no crash, no movement.
    writePattern(circuit, board, 0b0000);
    writePattern(circuit, board, 0b1111);
    writePattern(circuit, board, 0b0001);
    // Position and direction are unchanged; the rate has merely decayed (time
    // kept running even though the shaft didn't move).
    expect(info(motor).angleDegrees).toBeCloseTo(before.angleDegrees, 9);
    expect(info(motor).direction).toBe(before.direction);
    expect(info(motor).stepsPerSecond).toBeLessThan(before.stepsPerSecond);

    // The lock is still live: the next valid step advances from where it was.
    writePattern(circuit, board, 0b0101);
    expect(info(motor).angleDegrees).toBeCloseTo(2 * FULL_STEP_DEG, 9);
  });

  it("stepsPerSecond reflects real elapsed time between recognized states and decays on holds", () => {
    const DT = 1 / 20;
    const drive = (pattern: number): void => {
      for (let i = 0; i < 4; i++) {
        const bit = (pattern >> (3 - i)) & 1;
        board.pin(`GPIO${GPIO[i]}`).value = bit === 1 ? "HIGH" : "LOW";
      }
      circuit.resolveNow();
      circuit.tick(DT);
    };

    drive(0b1010); // anchor (no movement, timing count starts here)

    // One DT between transitions -> 20 steps/sec.
    drive(0b0110);
    expect(info(motor).stepsPerSecond).toBeCloseTo(1 / DT, 9);

    // Holding the same pattern adds elapsed time without advancing: one tick
    // still shows the just-landed rate (one DT since the reset), the second
    // shows the decay toward 0.
    circuit.tick(DT);
    expect(info(motor).stepsPerSecond).toBeCloseTo(1 / DT, 9);
    circuit.tick(DT);
    expect(info(motor).stepsPerSecond).toBeCloseTo(1 / (2 * DT), 9);

    // Next transition reports the real time since the previous one.
    drive(0b0101);
    expect(info(motor).stepsPerSecond).toBeCloseTo(1 / (3 * DT), 9);
  });
});
