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
