import { useEffect, useRef } from "react";
import type { PotentiometerElement } from "../../vendor/wokwi/potentiometer-element";
import type { PinOffsetMap } from "../types";

// The pot is our VENDORED, modified copy of @wokwi/elements'
// wokwi-potentiometer, <app-potentiometer> (registered in main.tsx). Vendoring
// is a deliberate, documented exception (docs/DECISIONS.md, "Potentiometer"):
// the published element owns its own drag + hidden range input and would
// fight the engine as the source of truth — so we strip ALL interaction
// machinery and drive its `knobPosition` property (0..1) from the engine
// snapshot. The knob TURN itself is a DRAG on an overlay in THIS view (the
// element is purely presentational).
export const POT_W_MM = 75.6 / 3.78; // SIZE KNOB (mm) — 20mm natural width
const POT_NATURAL_W = 75.6;
const POT_NATURAL_H = 75.6;
const POT_F = +((POT_W_MM * 3.78) / POT_NATURAL_W).toFixed(4); // 1 at default
export const POT_W = +((POT_NATURAL_W * POT_F).toFixed(3)); // 20mm @ 3.78 px/mm (the element's natural size)
export const POT_H = +((POT_NATURAL_H * POT_F).toFixed(3));

// Pin offsets, straight from the vendored source's own pinInfo — the three
// lead tips poking out of the bottom face, in element order GND-SIG-VCC
// (left-to-right). The canvas markers sit on these exact coordinates and
// browser-verify asserts they match the live element's `pinInfo`:
//   GND (29, 68.5)  SIG (39, 68.5)  VCC (49, 68.5)
// Scaled by POT_F so the markers follow the resized art.
export const potPinOffsets: PinOffsetMap = {
  terminal1: { x: +(29 * POT_F).toFixed(3), y: +(68.5 * POT_F).toFixed(3) },
  wiper: { x: +(39 * POT_F).toFixed(3), y: +(68.5 * POT_F).toFixed(3) },
  terminal2: { x: +(49 * POT_F).toFixed(3), y: +(68.5 * POT_F).toFixed(3) },
};

// Knob geometry in natural pixel units (element viewBox 0..20 x 0..20, scaled
// to a 75.6px face; knob center (9.91, 8.18), rx/ry ~7.27/7.43), scaled by
// POT_F so the drag surface rides the resized knob ellipse.
const KNOB_CX = 9.91 * 3.78 * POT_F;
const KNOB_CY = 8.18 * 3.78 * POT_F;
const KNOB_R = 7.43 * 3.78 * POT_F;

// One full sweep of the knob maps to this many CLIENT pixels of vertical drag
// (dragging up turns it "up", like turning a min->max pot counter-clockwise to
// raise its tap... turning toward +). Independent of stage scale — the overlay
// lives in the (scaled) stage, so 120 client px is a comfortable arc at any
// zoom.
const KNOB_TRAVEL = 120;

// Component body art: the vendored pot element alone, `knobPosition` mirrored
// onto its property via a ref (the LedView ref-property pattern). Exported for
// the palette preview.
export function PotentiometerArt({ knobPosition }: { knobPosition: number }) {
  const potRef = useRef<PotentiometerElement | null>(null);
  useEffect(() => {
    if (potRef.current) potRef.current.knobPosition = knobPosition;
  }, [knobPosition]);
  return (
    <div style={{ position: "relative", width: POT_W, height: POT_H }}>
      {/* Vendored pot (registered in main.tsx, browser only). In jsdom tests it
          is an unrecognised tag — harmless, nothing reads its shadow DOM. */}
      <div
        style={{
          width: POT_NATURAL_W,
          height: POT_NATURAL_H,
          transform: `scale(${POT_F})`,
          transformOrigin: "top left",
        }}
      >
        <app-potentiometer ref={potRef} />
      </div>
    </div>
  );
}

interface PotentiometerViewProps {
  renderInfo: { type: "potentiometer"; knobPosition: number };
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
  // A knob turn (drag) is relayed to the worker (the engine Potentiometer
  // lives there), not fired on a local engine object.
  onKnobChange: (knobPosition: number) => void;
}

export function PotentiometerView({ renderInfo, selected, onKnobChange }: PotentiometerViewProps) {
  const { knobPosition } = renderInfo;

  // Drag state: null = not dragging; otherwise the knob position at drag start
  // and the client y at drag start. Vertical deviation maps to knob travel.
  const dragRef = useRef<{ startKnob: number; startClientY: number } | null>(null);

  function handleKnobPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return; // primary button only
    // Keep the canvas's body drag (drag-to-move) out of this: the knob overlay
    // owns its pointer from here on, and capture routes every subsequent event
    // here, so turning the knob can never drag the component around.
    e.stopPropagation();
    e.preventDefault();
    dragRef.current = { startKnob: knobPosition, startClientY: e.clientY };
    if (typeof e.currentTarget.setPointerCapture === "function") {
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore — jsdom / synthetic / already-released pointer
      }
    }
  }

  function handleKnobPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    // Map vertical pixel travel to knob position; up is "more" (a natural
    // "turn up the volume" feel). Clamped to 0..1 by the engine anyway.
    const next = drag.startKnob - (e.clientY - drag.startClientY) / KNOB_TRAVEL;
    onKnobChange(Math.min(1, Math.max(0, next)));
  }

  function handleKnobPointerUp(e: React.PointerEvent<HTMLDivElement>) {
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

  return (
    <div
      data-testid="potentiometer"
      data-selected={selected ? "true" : "false"}
      data-knob-position={knobPosition.toFixed(3)}
      style={{
        outline: selected ? "3px solid #ffd500" : "none",
        outlineOffset: 2,
      }}
    >
      <div style={{ position: "relative", width: POT_W, height: POT_H }}>
        <PotentiometerArt knobPosition={knobPosition} />
        {/* The drag surface, sized to the knob ellipse and on top of the
            element. Body clicks elsewhere on the pot still select/move it. */}
        <div
          data-testid="potentiometer-knob"
          aria-label="Potentiometer knob"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={1}
          aria-valuenow={Math.round(knobPosition * 100) / 100}
          onPointerDown={handleKnobPointerDown}
          onPointerMove={handleKnobPointerMove}
          onPointerUp={handleKnobPointerUp}
          onPointerCancel={handleKnobPointerUp}
          style={{
            position: "absolute",
            left: KNOB_CX - KNOB_R,
            top: KNOB_CY - KNOB_R,
            width: KNOB_R * 2,
            height: KNOB_R * 2,
            borderRadius: "50%",
            cursor: "pointer",
            userSelect: "none",
            touchAction: "none",
          }}
        />
      </div>
    </div>
  );
}