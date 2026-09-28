import { Component, newId } from "../Component";
import type { HasInternalConnections } from "../Component";
import type { RenderInfo } from "../RenderInfo";
import type { Pin } from "../Pin";

// A relay as a condition-driven passive switch — the same HasInternalConnections
// pattern as Button, but the "switch action" is driven by an input pin's
// DIGITAL STATE rather than by a user gesture:
//
//   in  vcc  gnd   <- coil/control side. vcc/gnd are physically present for
//                    wiring realism ONLY — a real relay module's onboard coil
//                    driver isn't simulated, so they are inert UNSET pins.
//   com  no  nc    <- switching side (SPDT contact). Exactly one of
//                    com-nc / com-no is internally shorted at any time.
//
// De-energized (in LOW or FLOATING — the default): com is internally connected
// to nc. Energized (in reads a solid digital HIGH): com connects to no instead;
// never both at once. getInternalConnections() returns exactly one pair, so net
// resolution merges/splits the contact nets exactly like the button's strips.
//
// No coil-current or driver-circuit modeling: the energization decision is
// purely `in === HIGH` (see docs/DECISIONS.md). The one-tick latency between a
// change on the `in` net (propagated to listening pins) and the contact swap is
// inherent to state-driven connections and matches a real relay's coil delay.
export class Relay extends Component implements HasInternalConnections {
  private energized = false;

  constructor(id?: string) {
    super(id ?? `relay-${newId()}`);
    this.addPin("in", "IN"); // control input — must listen to read its state
    this.addPin("vcc", "UNSET"); // coil supply (inert: wiring realism only)
    this.addPin("gnd", "UNSET"); // coil return (inert: wiring realism only)
    this.addPin("com", "UNSET"); // common contact (passive, like a button leg)
    this.addPin("no", "UNSET"); // normally-open contact
    this.addPin("nc", "UNSET"); // normally-closed contact
  }

  getInternalConnections(): Array<[Pin, Pin]> {
    return this.energized
      ? [[this.pin("com"), this.pin("no")]]
      : [[this.pin("com"), this.pin("nc")]];
  }

  update(_dt: number): void {
    this.energized = this.pin("in").value === "HIGH";
  }

  getRenderInfo(): RenderInfo {
    return { type: "relay", energized: this.energized };
  }
}