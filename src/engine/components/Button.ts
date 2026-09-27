import { Component, newId } from "../Component";
import type { HasInternalConnections } from "../Component";
import type { RenderInfo } from "../RenderInfo";
import type { Pin } from "../Pin";

// A passive 4-pin push button — a real momentary switch, not a driver.
// A physical push button has two mechanical terminals; each terminal is
// electrically a single strip that spans two corners of the body, so it is
// modeled as two legs that are ALWAYS internally shorted together:
//   - leg1a / leg1b  = the top strip (the 1.l / 1.r corners). Permanently
//     connected, pressed or not.
//   - leg2a / leg2b  = the bottom strip (the 2.l / 2.r corners). Permanently
//     connected, pressed or not.
// Pressing the button closes the switch action across the LEFT pair: it adds
// a third internal connection leg1a <-> leg2a. Because each side's pair is
// already one net, bridging leg1a to leg2a electrically stacks the two strips
// — exactly what the press does on a real button, and why wiring either leg
// of a pair behaves identically.
//
// The button never drives a net on its own: the classic circuit wires one
// side to a power rail (e.g. 3V3_OUT -> leg1a) and the other to a GPIO input
// (e.g. leg2a -> GPIO, with an internal pull-down), so at rest the input
// reads LOW and while held it is pulled up to the rail by the closed switch.
//
// The press/release methods are how the UI (or tests) trigger interaction —
// they are not part of the abstract Component base, since not every
// component is user-interactive. They only flip the internal closed boolean;
// the net merge/split effect is applied by Circuit.resolveNets() via
// HasInternalConnections, not by update().
export class Button extends Component implements HasInternalConnections {
  private closed = false;

  constructor(id?: string) {
    super(id ?? `button-${newId()}`);
    // Legs match a real push button's two terminals, each duplicated to its
    // two corners. Mode is UNSET because the button is passive: it neither
    // drives nor listens, it connects.
    this.addPin("leg1a", "UNSET");
    this.addPin("leg1b", "UNSET");
    this.addPin("leg2a", "UNSET");
    this.addPin("leg2b", "UNSET");
  }

  // The mechanical switch: the two strips are always internally shorted
  // (leg1a-leg1b, leg2a-leg2b), and while the button is held the switch
  // action additionally bridges the two strips (leg1a-leg2a).
  getInternalConnections(): Array<[Pin, Pin]> {
    const pairs: Array<[Pin, Pin]> = [
      [this.pin("leg1a"), this.pin("leg1b")],
      [this.pin("leg2a"), this.pin("leg2b")],
    ];
    if (this.closed) {
      pairs.push([this.pin("leg1a"), this.pin("leg2a")]);
    }
    return pairs;
  }

  update(_dt: number): void {
    // Purely passive — nothing to compute per tick. The closed/broken leg
    // connections above are applied by net resolution, and the leg pins read
    // whatever their merged net resolves to on the following tick.
  }

  getRenderInfo(): RenderInfo {
    return { type: "button", isPressed: this.closed };
  }

  press(): void {
    this.closed = true;
  }

  release(): void {
    this.closed = false;
  }
}