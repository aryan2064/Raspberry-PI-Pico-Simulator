import type { RenderInfo } from "./RenderInfo";
import { Pin } from "./Pin";

export const newId = (): string => crypto.randomUUID();

abstract class Component {
  readonly id: string;
  readonly pins: Pin[] = [];

  constructor(id: string) {
    this.id = id;
  }

  // Look up one of this component's own pins by label.
  // Throws loudly instead of returning undefined — a missing pin is a
  // programming error, not a runtime case to handle gracefully.
  pin(label: string): Pin {
    const found = this.pins.find((p) => p.label === label);
    if (!found) {
      throw new Error(`Component ${this.id} has no pin labeled "${label}"`);
    }
    return found;
  }

  protected addPin(label: string, mode: "IN" | "OUT" | "UNSET" = "UNSET"): Pin {
    const p = new Pin(newId(), label, this);
    p.mode = mode;
    this.pins.push(p);
    return p;
  }

  // Called once per simulation tick, AFTER net values have been resolved
  // and propagated. Components read their input pins and/or write their
  // output pins here.
  abstract update(dt: number): void;

  abstract getRenderInfo(): RenderInfo;
}

export { Component };
