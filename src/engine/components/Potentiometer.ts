import { Component, newId } from "../Component";
import type { RenderInfo } from "../RenderInfo";

// A rotary potentiometer as a passive analog divider. Unlike LED/StepperMotor,
// it has no OUT pin and never drives anything digitally — it only ever sources
// a 0..1 voltage onto the analog channel:
//
//   terminal1  terminal2   <- the fixed element ends. Kirchhoff-simple in this
//                             simulation: both are UNSET (wiring realism only) —
//                             the divider output is the wiper's analogValue.
//   wiper                 <- the moving tap. Read by whatever listens analog
//                             (a Capacitor's `a`, a GPIO's IN...). IN, and
//                             deliberately never OUT, so the pot can never be
//                             mistaken for a digital driver on its net.
//
// knobPosition (0..1) is the only control surface — the UI maps a drag over the
// knob artwork onto it via setKnobPosition(). There is no ohm-based taper or
// max-resistance model; the wiper simply reports knobPosition (see
// docs/DECISIONS.md for the documented simplifications).
export class Potentiometer extends Component {
  private knobPosition = 0; // 0..1 (clamped)

  constructor(id?: string) {
    super(id ?? `potentiometer-${newId()}`);
    this.addPin("terminal1", "UNSET"); // fixed end (wiring realism only)
    this.addPin("wiper", "IN"); // moving tap — sources analog, never digital
    this.addPin("terminal2", "UNSET"); // fixed end (wiring realism only)
    // A potentiometer always has a tap position (default 0). Publishing it at
    // construction (like PIRSensor.triggerMotion drives `out` immediately)
    // means a freshly dropped pot is already a live analog source — listeners
    // see the position on the very first resolve, not one tick later.
    this.setKnobPosition(this.knobPosition);
  }

  // The stimulus: sets the wiper's tap position. Mirrored straight onto the
  // wiper's analogValue (immediate visibility) and re-published each tick;
  // the worker calls this from the UI drag.
  setKnobPosition(value: number): void {
    this.knobPosition = Math.min(1, Math.max(0, value));
    this.pin("wiper").analogValue = this.knobPosition;
  }

  update(_dt: number): void {
    this.pin("wiper").analogValue = this.knobPosition;
  }

  getRenderInfo(): RenderInfo {
    return { type: "potentiometer", knobPosition: this.knobPosition };
  }
}