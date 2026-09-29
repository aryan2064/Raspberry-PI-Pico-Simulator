import { Component, newId } from "../Component";
import type { RenderInfo } from "../RenderInfo";

export interface PIRSensorOptions {
  // How long `out` stays HIGH after motion is detected. Real HC-SR501 modules
  // fix this with a board trimmer; we model a configurable hold (default 5s).
  holdSeconds?: number;
  // When true, a second trigger while already active restarts the whole hold;
  // when false it is ignored and the original hold simply expires (the
  // module's repeat-trigger selection).
  retriggerable?: boolean;
}

// A PIR motion sensor as the first real HasStimulus-style component: it needs
// no input pins — the stimulus comes from OUTSIDE the circuit (a user click, a
// script) and its response shows up as a driven output, exactly the inverted
// mirror of LED/StepperMotor (which are driven by pins / internal state).
//
//   vcc  gnd  <- power. Physically present on the module but inert: the board
//                feeding them isn't simulated, so they are UNSET pins (Relay
//                precedent) doing wiring realism only.
//   out       <- digital output: HIGH while motion is being detected, LOW
//                otherwise. Driven directly, like a PWM'd LED pin.
//
// The detection model is deliberately simple (see docs/DECISIONS.md): a single
// boolean "motion detected" set by triggerMotion() and held for holdSeconds of
// accumulated simulation time. No sensitivity/range, no warm-up, no ambient
// sensing. So long as the hold lasts, `out` is HIGH; the moment it expires out
// drops LOW until the next trigger.
export class PIRSensor extends Component {
  static readonly DEFAULT_HOLD_SECONDS = 5;
  static readonly DEFAULT_RETRIGGERABLE = true;

  private readonly holdSeconds: number;
  private readonly retriggerable: boolean;
  private motionActive = false;
  // Remaining detected-motion hold, in seconds of simulated time. The sensor
  // goes idle when this runs out; triggerMotion() replenishes it (from the
  // trigger instant, not the leftover) on retriggerable modules.
  private holdRemaining = 0;

  constructor(options: PIRSensorOptions = {}, id?: string) {
    super(id ?? `pir-${newId()}`);
    this.holdSeconds = options.holdSeconds ?? PIRSensor.DEFAULT_HOLD_SECONDS;
    this.retriggerable = options.retriggerable ?? PIRSensor.DEFAULT_RETRIGGERABLE;
    this.addPin("vcc", "UNSET"); // power (inert: wiring realism only)
    this.addPin("out", "OUT"); // motion detect output (active high)
    this.addPin("gnd", "UNSET"); // ground (inert: wiring realism only)
    this.pin("out").value = "LOW"; // a PIR output drive idles LOW, never floating
  }

  // The stimulus: the detector sees motion. Must be externally invoked (a
  // user click / script) — the component itself has no sensing model. Driving
  // `out` HIGH here (not waiting for the next update()) makes the trigger
  // visible immediately through net resolution, the same immediate-visibility
  // requirement already established for pull resistors and PWM writes.
  triggerMotion(): void {
    if (this.motionActive && !this.retriggerable) return; // ignored mid-hold
    this.motionActive = true;
    this.holdRemaining = this.holdSeconds;
    this.pin("out").value = "HIGH";
  }

  update(dt: number): void {
    if (!this.motionActive) return; // idle: out already LOW, nothing to age
    this.holdRemaining -= dt;
    if (this.holdRemaining <= 0) {
      this.motionActive = false;
      this.holdRemaining = 0;
      this.pin("out").value = "LOW";
    }
  }

  getRenderInfo(): RenderInfo {
    return { type: "pir", motionActive: this.motionActive };
  }
}