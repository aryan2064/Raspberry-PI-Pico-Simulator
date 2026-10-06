import type { Component } from "./Component";

export type PinMode = "IN" | "OUT" | "UNSET";
export type PinValue = "HIGH" | "LOW" | "FLOATING";
// Internal (weak) pull resistor on a pin — like the RP2040's internal GPIO
// pulls. Only consulted by net resolution as a FALLBACK when a net has zero
// active OUT drivers: any UP pull -> net HIGH, any DOWN pull -> net LOW,
// both present with no driver -> stays FLOATING (documented simplification).
// An active driver always wins over a pull; pulls never create conflicts.
export type PinPull = "UP" | "DOWN" | "NONE";

export class Pin {
  readonly id: string; // stable unique uuid — internal identity
  readonly label: string; // human-readable name, e.g. "GPIO15", "anode", "VCC"
  readonly owner: Component;

  mode: PinMode = "UNSET";
  value: PinValue = "FLOATING";
  analogValue: number | null = null; // separate analog channel, independent of value
  netId: string | null = null; // filled in by Circuit.resolveNets()
  // Set by Circuit.propagate(): true when this pin's net has more than one
  // driver (two outputs fighting over one connection). Purely diagnostic —
  // the resolved value/analogValue still fall back to FLOATING/null on
  // conflict; this flag is what the UI warns about.
  hasConflict = false;
  // Set by Circuit.propagate()'s DIGITAL pass: true when this pin's net has
  // at least one real OUT-mode driver. Distinct from `value`/`pull` — an
  // actively-driven net (two outputs fighting) is still "digitally driven",
  // and a pull is never a driver. RC-timing consumers (e.g. Capacitor) use
  // this to tell "something is REALLY holding the net" apart from "a weak
  // pull I set myself".
  digitallyDriven = false;
  // Internal (engine-only) marker: true once the analog propagation pass has
  // written a resolved value INTO this pin. The analog source scoring treats
  // analogValue !== null && !analogDelivered as "this pin produces a signal",
  // so a delivered listener value (e.g. a Capacitor's `a`) is never mistaken
  // for a second source on the next pass. Only the resolver sets it, on
  // non-source IN pins it writes; OUT pins and component-driven IN sources
  // (a Potentiometer's wiper, a Resistor's terminal1) never receive it.
  analogDelivered = false;
  // Internal weak pull resistor (see PinPull). Set by the machine.Pin shim's
  // third argument (GPIO pull mode) or by a component/circuit pre-configuring
  // a pin; additive — the default "NONE" leaves every existing circuit
  // unchanged.
  pull: PinPull = "NONE";

  constructor(id: string, label: string, owner: Component) {
    this.id = id;
    this.label = label;
    this.owner = owner;
  }
}
