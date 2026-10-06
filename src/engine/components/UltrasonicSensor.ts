import { Component, newId } from "../Component";
import type { PinValue } from "../Pin";
import type { RenderInfo } from "../RenderInfo";

// An HC-SR04 ultrasonic distance sensor, modeling the TRIG/ECHO measure-pulse
// protocol. The stimulus — how far the object in front is — comes from OUTSIDE
// the circuit (setSimulatedDistance(), driven by the UI slider), and the
// sensor's response is the standard time-of-flight pulse on `echo`, exactly
// the same stimulus-in / pulse-out shape as the PIR's hole-in / hold-out.
//
//   vcc  gnd  <- power. Physically present on the module but inert: the board
//                feeding them isn't simulated, so they are UNSET pins (PIR
//                precedent) doing wiring realism only.
//   trig      <- digital input. A RISING edge here arms a measurement.
//   echo      <- digital output (active high). Driven HIGH for exactly the
//                sound's round-trip time at the simulated distance, then LOW.
//
// The measurement model: `echo` stays HIGH for simulatedDistanceCm * 58 µs —
// the standard speed-of-sound round-trip constant (174 m/s travelled at
// 343 m/s means the pulse to and from a target at 1 cm takes 58 µs). The echo
// only starts when a valid target is in range: simulatedDistanceCm must be
// non-null and within [2, 400] cm (the real module's spec range); null means
// "nothing in front", which produces no echo, matching a real >max-range read.
//
// Deliberate simplifications (see docs/DECISIONS.md): only the RISING edge on
// trig is honored — no minimum TRIG pulse-width validation and no sub-µs timing
// of the width itself; a rising edge while an echo is already in flight is
// IGNORED (a real module does not restart an in-progress pulse); and there is
// no internal ~38 ms "no echo" timeout pulse — an invalid/missing distance
// simply never starts an echo.
export class UltrasonicSensor extends Component {
  // Round-trip speed of sound: 58 µs per cm (the HC-SR04 vendor constant).
  static readonly MICROSECONDS_PER_CM = 58;
  // The module's factory spec measurement range.
  static readonly MIN_DISTANCE_CM = 2;
  static readonly MAX_DISTANCE_CM = 400;

  // The simulated target distance in cm, or null = "nothing in front" (no
  // object within range, so no echo comes back). Held locally: the engine has
  // no ranging model, an external stimulus sets this.
  private simulatedDistanceCm: number | null = null;
  // Whether an echo is currently in flight (echo pin HIGH).
  private measuring = false;
  // Simulated time the current echo has been in flight, in seconds.
  private elapsedSeconds = 0;
  // For how long the current echo should stay HIGH, in seconds.
  private echoDurationSeconds = 0;
  // The trig net's value as of the last update() (for rising-edge detection).
  // FLOATING is never a valid "high" source, so any first HIGH is an edge.
  private previousTrigValue: PinValue = "FLOATING";

  constructor(id?: string) {
    super(id ?? `ultrasonic-${newId()}`);
    this.addPin("vcc", "UNSET"); // power (inert: wiring realism only)
    this.addPin("trig", "IN"); // measure trigger (rising edge arms a pulse)
    this.addPin("echo", "OUT"); // echo pulse output (active high)
    this.addPin("gnd", "UNSET"); // ground (inert: wiring realism only)
    this.pin("echo").value = "LOW"; // a sensor output idles LOW, never floating
  }

  // The stimulus: how far the object in front is, or null for no object.
  setSimulatedDistance(cm: number | null): void {
    this.simulatedDistanceCm = cm;
  }

  update(dt: number): void {
    // Rising-edge detection on trig — the only trigger the model honors (the
    // DECISIONS simplifications listed above). The IN pin's value was resolved
    // by Circuit.propagate() earlier this same tick; the edge is treated as
    // occurring dt before this update, which is what makes the echo duration
    // land exact (see UltrasonicSensor.test.ts / browser-verify).
    const trigValue = this.pin("trig").value;
    const rising = trigValue === "HIGH" && this.previousTrigValue !== "HIGH";
    this.previousTrigValue = trigValue;

    // A rising edge starts a measurement only when there is a valid target
    // AND no echo is already in flight (a retrigger mid-pulse is ignored).
    if (rising && !this.measuring) {
      const cm = this.simulatedDistanceCm;
      if (
        cm !== null &&
        cm >= UltrasonicSensor.MIN_DISTANCE_CM &&
        cm <= UltrasonicSensor.MAX_DISTANCE_CM
      ) {
        this.measuring = true;
        this.elapsedSeconds = 0;
        this.echoDurationSeconds =
          (cm * UltrasonicSensor.MICROSECONDS_PER_CM) / 1e6;
        this.pin("echo").value = "HIGH";
      }
    }

    // Age the in-flight echo; drop it LOW once the round-trip time elapses.
    if (this.measuring) {
      this.elapsedSeconds += dt;
      if (this.elapsedSeconds >= this.echoDurationSeconds) {
        this.measuring = false;
        this.elapsedSeconds = 0;
        this.pin("echo").value = "LOW";
      }
    }
  }

  getRenderInfo(): RenderInfo {
    return {
      type: "ultrasonic",
      measuring: this.measuring,
      simulatedDistanceCm: this.simulatedDistanceCm,
    };
  }
}