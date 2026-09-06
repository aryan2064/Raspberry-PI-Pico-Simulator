import type { Component } from "./Component";

export type PinMode = "IN" | "OUT" | "UNSET";
export type PinValue = "HIGH" | "LOW" | "FLOATING";

export class Pin {
  readonly id: string; // stable unique uuid — internal identity
  readonly label: string; // human-readable name, e.g. "GPIO15", "anode", "VCC"
  readonly owner: Component;

  mode: PinMode = "UNSET";
  value: PinValue = "FLOATING";
  analogValue: number | null = null; // separate analog channel, independent of value
  netId: string | null = null; // filled in by Circuit.resolveNets()

  constructor(id: string, label: string, owner: Component) {
    this.id = id;
    this.label = label;
    this.owner = owner;
  }
}
