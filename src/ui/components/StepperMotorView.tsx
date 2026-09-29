import { useEffect, useRef } from "react";
import type { StepperMotorElement } from "../../vendor/wokwi/stepper-motor-element";
import type { PinOffsetMap } from "../types";

// The motor body is our VENDORED, modified copy of @wokwi/elements' stepper,
// <app-stepper-motor> (registered in main.tsx). Vendoring is a deliberate,
// documented exception (docs/DECISIONS.md, "Stepper"): the published element
// exposes only four cosmetic bipolar pins (A-/A+/B+/B-) with no vcc/gnd, so we
// compile the source ourselves with 6 leads relabeled in1..in4, vcc, gnd and
// the reactive-property layer rewritten for useDefineForClassFields: true.
// The engine's unipolar step tables stay the single source of truth; the
// element merely reflects angleDegrees via its `angle` property + a red arrow.
export const STEPPER_W = 80.892;
export const STEPPER_H = 96.012;

const MOTOR_SIZE: StepperMotorElement["size"] = 8;
const MOTOR_ARROW = "#c62828";

// Pin offsets, derived from the modified source's own geometry (size 8):
//   xOff = (frameSize/2 - 6.35) * mmToPix + 1   = (10.2 - 6.35)*3.78 + 1 = 15.553
//   yOff = (frameSize + 5) * mmToPix            = 25.4*3.78              = 96.012
//   pitch = 2.54 * mmToPix                      = 9.6012
// giving in1..gnd along the bottom-face lead strip. The canvas markers sit on
// these exact coordinates, and browser-verify asserts they match the live
// element's `pinInfo` to sub-pixel tolerance.
export const stepperPinOffsets: PinOffsetMap = {
  in1: { x: 15.553, y: 96.012 },
  in2: { x: 25.1542, y: 96.012 },
  in3: { x: 34.7554, y: 96.012 },
  in4: { x: 44.3566, y: 96.012 },
  vcc: { x: 53.9578, y: 96.012 },
  gnd: { x: 63.559, y: 96.012 },
};

interface StepperArtProps {
  angleDegrees: number;
}

// Component body art: the vendored motor element alone (single unified visual —
// the old hybrid's hand-drawn board is gone). `angleDegrees` is mirrored onto
// the element's `angle` property via a ref (the same ref-property pattern
// LedView uses for wokwi-led.value / brightness), so a running sequence spins
// the arrow + shaft. Exported for the palette preview like RelayArt/TransistorArt.
export function StepperArt({ angleDegrees }: StepperArtProps) {
  const motorRef = useRef<StepperMotorElement | null>(null);
  useEffect(() => {
    const m = motorRef.current;
    if (m) {
      m.size = MOTOR_SIZE;
      m.arrow = MOTOR_ARROW;
    }
  }, []);
  useEffect(() => {
    const m = motorRef.current;
    if (m) m.angle = angleDegrees;
  }, [angleDegrees]);

  return (
    <div style={{ position: "relative", width: STEPPER_W, height: STEPPER_H }}>
      {/* Vendored motor (registered in main.tsx, browser only). In jsdom tests it
          is an unrecognised tag — harmless, nothing reads its shadow DOM. */}
      <app-stepper-motor ref={motorRef} size={MOTOR_SIZE} />
    </div>
  );
}

interface StepperViewProps {
  renderInfo: {
    type: "stepper";
    angleDegrees: number;
    direction: "CW" | "CCW" | "none";
    stepsPerSecond: number;
  };
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
}

// Static view apart from the rotating motor. The worker is the single source of
// truth for angle/direction/rate; the view mirrors them as data attributes (for
// the browser verification + tests) and drives the vendored motor's `angle`.
export function StepperView({ renderInfo, selected }: StepperViewProps) {
  const { angleDegrees, direction, stepsPerSecond } = renderInfo;
  return (
    <div
      data-testid="stepper"
      data-selected={selected ? "true" : "false"}
      style={{
        outline: selected ? "3px solid #ffd500" : "none",
        outlineOffset: 2,
      }}
    >
      <div
        data-testid="stepper-body"
        data-angle={angleDegrees}
        data-direction={direction}
        data-steps-per-second={stepsPerSecond}
      >
        <StepperArt angleDegrees={angleDegrees} />
      </div>
    </div>
  );
}