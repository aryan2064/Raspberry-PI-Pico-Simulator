import { Component, newId } from "../Component";
import type { RenderInfo } from "../RenderInfo";

// A 28BYJ-48 unipolar stepper motor driven through a ULN2003 darlington
// driver module — modeled EXACTLY as the MCU sees it: a module with 4 raw
// digital control inputs and inert power pins, no internal driver logic.
//
//   in1 in2 in3 in4  <- ULN2003 inputs (digital, MODE_IN). A HIGH excites
//                      that winding (the ULN2003's open-collector outputs
//                      sink the coil when its input is HIGH). Bit order
//                      IN1 IN2 IN3 IN4, 1 = winding excited.
//   vcc gnd          <- driver board supply. Inert UNSET pins for wiring
//                      realism ONLY (same pattern as the relay's coil pins):
//                      the driver board's own power draw is not simulated.
//
// HARDCODED sequence tables (see docs/DECISIONS.md for the derivation and
// verification). These are the exact tables for this gear-reducer motor;
// nothing is derived or recomputed at runtime:
//
//   Full-step (4 states):  1010, 0110, 0101, 1001   (2048 steps/rev)
//   Half-step (8 states):  1000, 1010, 0010, 0110, 0100, 0101, 0001, 1001
//                                                (4096 steps/rev)
//
// Halving/resolution: half-step mode advances 360/4096 degrees per
// recognized state; full-step advances twice that per recognized state
// (because a full-step state only changes every OTHER half-step state).
//
// Recognition behavior: each update() reads in1..in4 as a 4-bit pattern.
// A pattern change that is the VALID NEXT state (forward or backward) in
// the locked table advances the angle by that table's step, else the other
// table is checked and the lock switches to it. Contradiction-free by
// construction: no pair of adjacent states is adjacent in BOTH tables (the
// full-step states sit at every other position of the half-step table), so
// a transition can only match one table. The first valid pattern seen only
// anchors position (no movement) — the motor cannot move until it knows
// where it is. Any pattern that is not a valid next state in either table
// is ignored: no movement, no error.
export class StepperMotor extends Component {
  // Bit order IN1 IN2 IN3 IN4 (IN1 = MSB), 1 = winding excited.
  // Full-step states are exactly HALF_STEP at even indices — the 2x
  // full-step angle increment follows from that structural fact.
  static readonly FULL_STEP: readonly number[] = [0b1010, 0b0110, 0b0101, 0b1001];
  static readonly HALF_STEP: readonly number[] = [
    0b1000, 0b1010, 0b0010, 0b0110, 0b0100, 0b0101, 0b0001, 0b1001,
  ];

  // Half-step mode: 4096 states per full revolution.
  static readonly DEG_PER_HALF_STEP = 360 / 4096;

  private angleDegrees = 0;
  private direction: "CW" | "CCW" | "none" = "none";
  private stepsPerSecond = 0;

  // Recognition state (all internal). lastPattern is the raw pin pattern
  // from the previous tick; it only gates change detection. The locked
  // table + index are the last RECOGNIZED state — everything advances
  // relative to it. timeSinceStep accumulates real dt between recognized
  // steps to report a true steps-per-second rate.
  private lastPattern: number | null = null;
  private lockedTable: "full" | "half" | null = null;
  private tableIndex: number | null = null;
  private timeSinceStep = 0;
  private hasStepped = false;

  // Keep the reported rate honest while the shaft is motionless: every tick of
  // real time that passes after a step without a new step lengthens the
  // measured interval, so the rate decays toward 0 (a frozen shaft is not
  // "moving at the last step's speed"). Untouched before the first step — an
  // anchored-but-never-driven motor reads 0, never a bogus rate.
  private refreshRate(): void {
    if (this.hasStepped && this.timeSinceStep > 0) {
      this.stepsPerSecond = 1 / this.timeSinceStep;
    }
  }

  constructor(id?: string) {
    super(id ?? `stepper-${newId()}`);
    this.addPin("in1", "IN"); // winding inputs (control side)
    this.addPin("in2", "IN");
    this.addPin("in3", "IN");
    this.addPin("in4", "IN");
    this.addPin("vcc", "UNSET"); // driver board supply (inert, wiring realism)
    this.addPin("gnd", "UNSET");
  }

  private readPattern(): number {
    const bit = (label: string): number =>
      this.pin(label).value === "HIGH" ? 1 : 0;
    // IN1 is the most significant bit: "1010" reads as binary 0b1010.
    return (bit("in1") << 3) | (bit("in2") << 2) | (bit("in3") << 1) | bit("in4");
  }

  // Direction of `pattern` relative to `prevIndex` within `table`:
  // "forward" / "backward" if it is the next/previous state, else null.
  private static neighborDirection(
    table: readonly number[],
    prevState: number,
    pattern: number
  ): "forward" | "backward" | null {
    const len = table.length;
    const i = table.indexOf(pattern);
    const prev = table.indexOf(prevState);
    if (i === -1 || prev === -1) return null;
    if (i === (prev + 1) % len) return "forward";
    if (i === (prev - 1 + len) % len) return "backward";
    return null;
  }

  update(dt: number): void {
    this.timeSinceStep += dt;
    const pattern = this.readPattern();
    // No change since the last tick: the pattern is being held, which is
    // exactly what real step driving does between transitions. Real time is
    // still passing, so the reported rate keeps decaying toward 0.
    if (this.lastPattern !== null && pattern === this.lastPattern) {
      this.refreshRate();
      return;
    }
    this.lastPattern = pattern;

    if (this.lockedTable === null || this.tableIndex === null) {
      // First contact: anchor onto whichever table contains this pattern.
      // Single-excitation states (1000/0010/0100/0001) exist only in the
      // half-step table; dual-excitation states are anchored as half-step
      // too (they are half-step states regardless), and any subsequent
      // full-step drive re-locks on its first recognized transition.
      const halfIdx = StepperMotor.HALF_STEP.indexOf(pattern);
      if (halfIdx !== -1) {
        this.lockedTable = "half";
        this.tableIndex = halfIdx;
      } else {
        const fullIdx = StepperMotor.FULL_STEP.indexOf(pattern);
        if (fullIdx === -1) return; // not a valid state at all: ignore
        this.lockedTable = "full";
        this.tableIndex = fullIdx;
      }
      this.timeSinceStep = 0; // timing starts from the anchor, not boot
      return;
    }

    const locked = this.lockedTable === "half" ? StepperMotor.HALF_STEP : StepperMotor.FULL_STEP;
    const prevState = locked[this.tableIndex];
    const wasHalf = this.lockedTable === "half";

    let dir = StepperMotor.neighborDirection(locked, prevState, pattern);
    let isHalf = wasHalf;

    if (dir === null) {
      // Not adjacent in the locked table — try the other table. Re-locking
      // here is what lets a half-step sequence (single-excitation states,
      // which the full table never contains) fold in cleanly after a full-step
      // anchor, and vice-versa.
      const other = wasHalf ? StepperMotor.FULL_STEP : StepperMotor.HALF_STEP;
      dir = StepperMotor.neighborDirection(other, prevState, pattern);
      if (dir === null) {
        // Garbage / invalid next state: ignored — no movement, no error. Time
        // still passes, so the rate keeps decaying.
        this.refreshRate();
        return;
      }
      this.lockedTable = wasHalf ? "full" : "half";
      isHalf = !wasHalf;
    }

    // A valid forward/backward step in whichever table is adjacent.
    const halfStepCount = isHalf ? 1 : 2;
    const sign = dir === "forward" ? 1 : -1;
    this.angleDegrees += sign * halfStepCount * StepperMotor.DEG_PER_HALF_STEP;
    this.direction = dir === "forward" ? "CW" : "CCW";
    this.hasStepped = true;
    this.stepsPerSecond = this.timeSinceStep > 0 ? 1 / this.timeSinceStep : this.stepsPerSecond;
    this.timeSinceStep = 0;
    this.tableIndex = (isHalf ? StepperMotor.HALF_STEP : StepperMotor.FULL_STEP).indexOf(pattern);
  }

  // Nothing is electrically shorted inside a stepper driver — it is a pure
  // sensor of the four input states. (The interface cleanliness of
  // HasInternalConnections is simply not applicable here.)
  getRenderInfo(): RenderInfo {
    return {
      type: "stepper",
      angleDegrees: this.angleDegrees,
      direction: this.direction,
      stepsPerSecond: this.stepsPerSecond,
    };
  }
}