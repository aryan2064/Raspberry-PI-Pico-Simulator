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
// The vendored element renders its shadow SVG at a natural 80.892x96.012px.
// The rendered width in mm is the SIZE KNOB: bump STEPPER_W_MM and every
// derived constant follows, so the default stays byte-identical to the natural.
export const STEPPER_W_MM = (80.892 / 3.78) - 0; // SIZE KNOB (mm) — 21.4mm natural width
const STEPPER_NATURAL_W = 80.892;
const STEPPER_NATURAL_H = 96.012;
const STEPPER_F = +((STEPPER_W_MM * 3.78) / STEPPER_NATURAL_W).toFixed(4); // 1 at default
export const STEPPER_W = +((STEPPER_NATURAL_W * STEPPER_F).toFixed(3));
export const STEPPER_H = +((STEPPER_NATURAL_H * STEPPER_F).toFixed(3));

const MOTOR_SIZE: StepperMotorElement["size"] = 8;
const MOTOR_ARROW = "#c62828";

// Pin offsets, derived from the modified source's own geometry (size 8):
//   xOff = (frameSize/2 - 6.35) * mmToPix + 1   = (10.2 - 6.35)*3.78 + 1 = 15.553
//   yOff = (frameSize + 5) * mmToPix            = 25.4*3.78              = 96.012
//   pitch = 2.54 * mmToPix                      = 9.6012
// giving in1..gnd along the bottom-face lead strip. The canvas markers sit on
// these exact coordinates, and browser-verify asserts they match the live
// element's `pinInfo` to sub-pixel tolerance. Scaled by STEPPER_F so the
// markers follow the resized art.
export const stepperPinOffsets: PinOffsetMap = {
  in1: { x: +(15.553 * STEPPER_F).toFixed(3), y: +(96.012 * STEPPER_F).toFixed(3) },
  in2: { x: +(25.1542 * STEPPER_F).toFixed(3), y: +(96.012 * STEPPER_F).toFixed(3) },
  in3: { x: +(34.7554 * STEPPER_F).toFixed(3), y: +(96.012 * STEPPER_F).toFixed(3) },
  in4: { x: +(44.3566 * STEPPER_F).toFixed(3), y: +(96.012 * STEPPER_F).toFixed(3) },
  vcc: { x: +(53.9578 * STEPPER_F).toFixed(3), y: +(96.012 * STEPPER_F).toFixed(3) },
  gnd: { x: +(63.559 * STEPPER_F).toFixed(3), y: +(96.012 * STEPPER_F).toFixed(3) },
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
      <div
        style={{
          width: STEPPER_NATURAL_W,
          height: STEPPER_NATURAL_H,
          transform: `scale(${STEPPER_F})`,
          transformOrigin: "top left",
        }}
      >
        <app-stepper-motor ref={motorRef} size={MOTOR_SIZE} />
      </div>
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