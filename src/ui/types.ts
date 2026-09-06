export interface Vec {
  x: number;
  y: number;
}

// Pin label -> offset from the owning component's origin (top-left).
// Each view file defines and exports its own map; CircuitCanvas imports
// them so wire endpoints and pin markers are computed from the same
// positions the views draw their bodies at.
export type PinOffsetMap = Record<string, Vec>;

// Visual appearance for a pin marker, per component type. Body views render
// only the component shapes; pin markers are drawn centrally by
// CircuitCanvas in their own SVG layer so they stay on top of wires.
export interface PinMarkerStyle {
  r: number;
  fill: string;
  stroke: string;
}