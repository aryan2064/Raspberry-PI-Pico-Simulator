import { Component, newId } from "../Component";
import type { RenderInfo } from "../RenderInfo";

// A resistor as a passive analog source for RC-style timing: it drives its
// terminal1's analogValue with a constant 0..1 fraction derived from its
// resistance. The value it broadcasts is deliberately NOT real, calibrated
// ohms-to-seconds physics — full-scale (FULL_SCALE_OHMS, 20kΩ by convention)
// maps to resistanceFraction 1.0 and a Capacitor's threshold is then
// maxChargeSeconds * fraction (see docs/DECISIONS.md, "RC timing").
//
//   terminal1  <- the only ACTIVE pin. IN (never OUT): like a Potentiometer's
//                 wiper it is a passive producer — a "resistance", not a
//                 driver. The net being timed (a Capacitor's `a`, a board
//                 GPIO in poll mode) reads this fraction from its analogValue.
//   terminal2  <- inert. Present so the part wires like a real two-lead axial
//                 resistor (a little visual realism in the canvas), but it
//                 contributes nothing electrically.
export class Resistor extends Component {
  static readonly DEFAULT_RESISTANCE_OHMS = 10000;
  // Documented full-scale: the resistance that maps to resistanceFraction 1.0.
  static readonly FULL_SCALE_OHMS = 20000;

  readonly resistanceOhms: number;
  private readonly resistanceFraction: number;

  constructor(resistanceOhms: number = Resistor.DEFAULT_RESISTANCE_OHMS, id?: string) {
    super(id ?? `resistor-${newId()}`);
    this.resistanceOhms = resistanceOhms;
    this.resistanceFraction = Math.min(
      1,
      Math.max(0, resistanceOhms / Resistor.FULL_SCALE_OHMS)
    );
    this.addPin("terminal1", "IN"); // sole broadcast pin (see class doc)
    this.addPin("terminal2", "UNSET"); // decorative ground-side lead
    // Publish the resistance fraction immediately (like Potentiometer) so a
    // freshly wired resistor is a live analog source on the first resolve
    // instead of one tick later. update() re-publishes each tick.
    this.pin("terminal1").analogValue = this.resistanceFraction;
  }

  update(_dt: number): void {
    this.pin("terminal1").analogValue = this.resistanceFraction;
  }

  getRenderInfo(): RenderInfo {
    return { type: "resistor", resistanceOhms: this.resistanceOhms };
  }
}