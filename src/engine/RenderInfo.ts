// Discriminated union: one variant per component type.
// Deliberately minimal — only "led", "pico_board", and "button" exist as
// variants. Add one member per new component as it's actually built;
// TypeScript forces the canvas renderer to handle every variant
// exhaustively.

export type RenderInfo =
  | { type: "led"; isOn: boolean }
  | { type: "button"; isPressed: boolean }
  | { type: "pico_board" };
