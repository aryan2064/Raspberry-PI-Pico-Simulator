import { Component, newId } from "../Component";
import type { HasInternalConnections } from "../Component";
import type { RenderInfo } from "../RenderInfo";
import type { Pin } from "../Pin";

// An NPN transistor modeled as a base-controlled single-pole switch — the
// simplest switch the load path needs, with no analog detail:
//
//   base      <- MODE_IN. HIGH -> transistor saturates (conducts hard),
//                LOW or FLOATING -> cutoff (open). No base resistor, no
//                Vbe threshold, no leakage. See docs/DECISIONS.md.
//   collector / emitter <- UNSET switch terminals (passive, like button legs).
//
// Canonical wiring: SWITCHED side (collector) between the supply rail and the
// load's high side, load's low side to ground; the SWITCHING side (base)
// driven by a GPIO. getInternalConnections() returns [[collector, emitter]]
// ONLY while conducting, and [] in cutoff — empty means the two switch
// terminals are not part of any shared net.
//
// This is Button's user-gesture switch turned into a *state*-driven switch:
// whether a net flows across it is decided by the base pin's digital value
// each tick, not by hardware contact mechanics.
export class Transistor extends Component implements HasInternalConnections {
  private conducting = false;

  constructor(id?: string) {
    super(id ?? `transistor-${newId()}`);
    this.addPin("base", "IN"); // control input — must listen to read its state
    this.addPin("collector", "UNSET"); // switched terminal (high side)
    this.addPin("emitter", "UNSET"); // switched terminal (low side)
  }

  getInternalConnections(): Array<[Pin, Pin]> {
    return this.conducting ? [[this.pin("collector"), this.pin("emitter")]] : [];
  }

  update(_dt: number): void {
    this.conducting = this.pin("base").value === "HIGH";
  }

  getRenderInfo(): RenderInfo {
    return { type: "transistor", conducting: this.conducting };
  }
}