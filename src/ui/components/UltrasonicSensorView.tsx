import { useRef } from "react";
import type { PinOffsetMap } from "../types";

// The HC-SR04 body is the PUBLISHED wokwi-hc-sr04 element, used unchanged —
// no vendoring, no main.tsx edit. Unlike the stepper/PIR/pot, wokwi-hc-sr04 is
// a purely static SVG with zero interaction handlers and no state properties
// the engine must drive, so it is exactly the Resistor situation: passive art
// under an overlay. See docs/DECISIONS.md ("Ultrasonic Sensor").
// The wokwi-hc-sr04 element renders its shadow SVG at a natural 170.1x94.5px
// (45mm x 25mm @ 3.78 px/mm). The rendered width in mm is the SIZE KNOB: bump
// ULTRA_W_MM and every derived constant follows, so the default stays
// byte-identical to the natural art.
export const ULTRA_W_MM = 170.1 / 3.78; // SIZE KNOB (mm) — 45mm natural width
const ULTRA_NATURAL_W = 170.1;
const ULTRA_NATURAL_H = 94.5;
const ULTRA_F = +((ULTRA_W_MM * 3.78) / ULTRA_NATURAL_W).toFixed(4); // 1 at default
export const ULTRA_W = +((ULTRA_NATURAL_W * ULTRA_F).toFixed(3)); // 45mm @ 3.78 px/mm (the element's natural size)
export const ULTRA_H = +((ULTRA_NATURAL_H * ULTRA_F).toFixed(3)); // 25mm @ 3.78 px/mm

// Pin offsets, straight from the package element's own pinInfo — the four
// header pins in module order VCC-TRIG-ECHO-GND along the bottom face:
//   vcc (71.3, 94.5)  trig (81.3, 94.5)  echo (91.3, 94.5)  gnd (101.3, 94.5).
// The canvas markers sit on these exact coordinates and browser-verify asserts
// they match the live element's `pinInfo` to sub-pixel tolerance. Scaled by
// ULTRA_F so the markers follow the resized art.
export const ultrasonicPinOffsets: PinOffsetMap = {
  vcc: { x: +(71.3 * ULTRA_F).toFixed(3), y: +(94.5 * ULTRA_F).toFixed(3) },
  trig: { x: +(81.3 * ULTRA_F).toFixed(3), y: +(94.5 * ULTRA_F).toFixed(3) },
  echo: { x: +(91.3 * ULTRA_F).toFixed(3), y: +(94.5 * ULTRA_F).toFixed(3) },
  gnd: { x: +(101.3 * ULTRA_F).toFixed(3), y: +(94.5 * ULTRA_F).toFixed(3) },
};

// Component body art: the published element alone. Exported for the palette
// preview like ResistorArt.
export function UltrasonicArt() {
  return (
    <div style={{ position: "relative", width: ULTRA_W, height: ULTRA_H }}>
      {/* Published wokwi element (registered via main.tsx's `import
          "@wokwi/elements"`; browser only). In jsdom tests it is an
          unrecognised tag — harmless, nothing reads its shadow DOM. */}
      <div
        style={{
          width: ULTRA_NATURAL_W,
          height: ULTRA_NATURAL_H,
          transform: `scale(${ULTRA_F})`,
          transformOrigin: "top left",
        }}
      >
        <wokwi-hc-sr04 />
      </div>
    </div>
  );
}

// Distance slider bounds — must mirror the engine's UltrasonicSensor static
// (2..400 cm factory range); the slider is just the drag affordance for the
// engine stimulus, it adds no range of its own.
const MIN_DISTANCE_CM = 2;
const MAX_DISTANCE_CM = 400;
// The track's full 2..400 sweep (and the "no object" stop) maps to this many
// CLIENT pixels of horizontal drag, independent of stage scale — the overlay
// lives in the scaled stage, so 150 client px is a comfortable sweep at any
// zoom (same approach as the pot's KNOB_TRAVEL).
const SLIDER_W = 150;
const SLIDER_H = 14;
const THUMB_W = 14;

// 0..1 tap-fraction -> cm (2..400). p>=1 is not a distance: dragging to / past
// the far end means "nothing in front" (a real >max-range read reports nothing
// detected), which the engine models as null.
function fractionToCm(frac: number): number | null {
  if (frac >= 1) return null;
  return MIN_DISTANCE_CM + Math.max(0, frac) * (MAX_DISTANCE_CM - MIN_DISTANCE_CM);
}

function cmToFraction(cm: number | null): number {
  if (cm === null) return 1;
  return Math.min(1, Math.max(0, (cm - MIN_DISTANCE_CM) / (MAX_DISTANCE_CM - MIN_DISTANCE_CM)));
}

interface UltrasonicSensorViewProps {
  renderInfo: { type: "ultrasonic"; measuring: boolean; simulatedDistanceCm: number | null };
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
  // A slider drag is relayed to the worker (the engine UltrasonicSensor lives
  // there), not applied on a local engine object.
  onDistanceChange: (simulatedDistanceCm: number | null) => void;
}

export function UltrasonicSensorView({ renderInfo, selected, onDistanceChange }: UltrasonicSensorViewProps) {
  const { measuring, simulatedDistanceCm } = renderInfo;

  // Drag state: null = not dragging; otherwise the tap fraction at drag start
  // and the client x at drag start. Horizontal travel maps to distance.
  const dragRef = useRef<{ startFrac: number; startClientX: number } | null>(null);

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return; // primary button only
    // Keep the canvas's body drag (drag-to-move) out of this: the slider owns
    // its pointer from here, so sweeping the slider can never drag the sensor
    // around the canvas (the same stopPropagation contract as the pot knob).
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { startFrac: cmToFraction(simulatedDistanceCm), startClientX: e.clientX };
    if (typeof e.currentTarget.setPointerCapture === "function") {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore — jsdom / synthetic / already-released pointer
      }
    }
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    // Map horizontal pixel travel to tap fraction. From the "no object" stop a
    // left-drag picks a real distance again; dragging to / past max returns to
    // the stop (null).
    const frac = drag.startFrac + (e.clientX - drag.startClientX) / SLIDER_W;
    onDistanceChange(fractionToCm(frac));
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current) return;
    dragRef.current = null;
    e.stopPropagation();
    if (typeof e.currentTarget.releasePointerCapture === "function") {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  }

  const thumbLeft = cmToFraction(simulatedDistanceCm) * (SLIDER_W - THUMB_W);

  return (
    <div
      data-testid="ultrasonic"
      data-selected={selected ? "true" : "false"}
      data-measuring={measuring ? "true" : "false"}
      data-distance={simulatedDistanceCm === null ? "none" : String(Math.round(simulatedDistanceCm))}
      style={{
        outline: selected ? "3px solid #ffd500" : "none",
        outlineOffset: 2,
      }}
    >
      <div style={{ position: "relative", width: ULTRA_W, height: ULTRA_H }}>
        <UltrasonicArt />
        {/* Pulsing indicator while an echo is in flight (engine `measuring`).
            The pulse only lasts sub-cycle to a few ms of SIM time, so it
            flashes — see the keyframes in index.css. */}
        {measuring && (
          <div
            data-testid="ultrasonic-measuring"
            aria-hidden="true"
            className="ultrasonic-measuring"
          />
        )}
      </div>
      <div style={{ marginTop: 6 }}>
        <div
          data-testid="ultrasonic-slider"
          role="slider"
          aria-label="Simulated target distance"
          aria-valuemin={MIN_DISTANCE_CM}
          aria-valuemax={MAX_DISTANCE_CM}
          aria-valuenow={simulatedDistanceCm === null ? 0 : Math.round(simulatedDistanceCm)}
          aria-valuetext={
            simulatedDistanceCm === null ? "no object" : `${Math.round(simulatedDistanceCm)} cm`
          }
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          style={{
            position: "relative",
            width: SLIDER_W,
            height: SLIDER_H,
            touchAction: "none",
            cursor: "pointer",
            userSelect: "none",
          }}
        >
          {/* Track */}
          <div
            style={{
              position: "absolute",
              left: 0,
              top: SLIDER_H / 2 - 2,
              width: SLIDER_W,
              height: 4,
              borderRadius: 2,
              background: "#d0d0d4",
            }}
          />
          {/* Thumb */}
          <div
            data-testid="ultrasonic-thumb"
            style={{
              position: "absolute",
              left: thumbLeft,
              top: 0,
              width: THUMB_W,
              height: SLIDER_H,
              borderRadius: 4,
              background: "#1f8aff",
              border: "1px solid #0056b3",
            }}
          />
        </div>
        <div
          data-testid="ultrasonic-readout"
          style={{ fontSize: 11, color: "#555", marginTop: 2 }}
        >
          {simulatedDistanceCm === null ? "no object" : `${Math.round(simulatedDistanceCm)} cm`}
        </div>
      </div>
    </div>
  );
}