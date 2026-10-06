// Discriminated union: one variant per component type.
// Deliberately minimal — only "led", "pico_board", and "button" exist as
// variants. Add one member per new component as it's actually built;
// TypeScript forces the canvas renderer to handle every variant
// exhaustively.

export type RenderInfo =
  | { type: "led"; isOn: boolean; brightness: number }
  | { type: "button"; isPressed: boolean }
  | { type: "relay"; energized: boolean }
  | { type: "transistor"; conducting: boolean }
  | { type: "stepper"; angleDegrees: number; direction: "CW" | "CCW" | "none"; stepsPerSecond: number }
  | { type: "pir"; motionActive: boolean }
  | { type: "potentiometer"; knobPosition: number }
  | { type: "resistor"; resistanceOhms: number }
  | { type: "capacitor"; chargeFraction: number; charged: boolean }
  | { type: "ultrasonic"; measuring: boolean; simulatedDistanceCm: number | null }
  | { type: "pico_board" };
