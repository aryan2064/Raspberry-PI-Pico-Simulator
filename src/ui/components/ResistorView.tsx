import { useEffect, useRef } from "react";
import type { ResistorElement } from "@wokwi/elements";
import type { PinOffsetMap } from "../types";

// The resistor is the ONE new part we can use straight from the published
// @wokwi/elements package: unlike the stepper/PIR/pot, wokwi-resistor has no
// interaction handlers and no state the engine must drive through a mod — we
// only reflect the resistance as band colors via its `value` property. See
// docs/DECISIONS.md ("Resistor") for why this one needs no vendoring exception.
// The wokwi-resistor element renders its shadow SVG at a natural 59.14x11.34px
// (15.645mm x 3mm @ 3.78 px/mm). The rendered width in mm is the SIZE KNOB:
// bump RESISTOR_W_MM and every derived constant follows, so the default stays
// byte-identical to the natural art.
export const RESISTOR_W_MM = 59.14 / 3.78; // SIZE KNOB (mm) — 15.645mm natural width
const RESISTOR_NATURAL_W = 59.14;
const RESISTOR_NATURAL_H = 11.34;
const RESISTOR_F = +((RESISTOR_W_MM * 3.78) / RESISTOR_NATURAL_W).toFixed(4); // 1 at default
export const RESISTOR_W = +((RESISTOR_NATURAL_W * RESISTOR_F).toFixed(3));
export const RESISTOR_H = +((RESISTOR_NATURAL_H * RESISTOR_F).toFixed(3));

// Pin offsets, straight from the package element's own pinInfo — the two lead
// tips, terminal1 left / terminal2 right at the vertically-centered lead line:
//   terminal1 (0, 5.65)  terminal2 (58.8, 5.65)
// The canvas markers sit on these exact coordinates and browser-verify asserts
// they match the live element's `pinInfo`. Scaled by RESISTOR_F so the markers
// follow the resized art.
export const resistorPinOffsets: PinOffsetMap = {
  terminal1: { x: 0, y: +(5.65 * RESISTOR_F).toFixed(3) },
  terminal2: { x: +(58.8 * RESISTOR_F).toFixed(3), y: +(5.65 * RESISTOR_F).toFixed(3) },
};

// Component body art: the real <wokwi-resistor> with its value (ohms) reflected
// as standard 4-band color coding via the ref-property pattern. Exported for
// the palette preview.
export function ResistorArt({ resistanceOhms }: { resistanceOhms: number }) {
  const ref = useRef<ResistorElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.value = String(resistanceOhms);
  }, [resistanceOhms]);
  return (
    <div style={{ position: "relative", width: RESISTOR_W, height: RESISTOR_H }}>
      {/* Published wokwi element (registered in main.tsx, browser only). In
          jsdom tests it is an unrecognised tag — harmless. */}
      <div
        style={{
          width: RESISTOR_NATURAL_W,
          height: RESISTOR_NATURAL_H,
          transform: `scale(${RESISTOR_F})`,
          transformOrigin: "top left",
        }}
      >
        <wokwi-resistor ref={ref} />
      </div>
    </div>
  );
}

interface ResistorViewProps {
  renderInfo: { type: "resistor"; resistanceOhms: number };
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
}

export function ResistorView({ renderInfo, selected }: ResistorViewProps) {
  const { resistanceOhms } = renderInfo;
  return (
    <div
      data-testid="resistor"
      data-selected={selected ? "true" : "false"}
      data-resistance-ohms={resistanceOhms}
      style={{
        outline: selected ? "3px solid #ffd500" : "none",
        outlineOffset: 2,
      }}
    >
      <ResistorArt resistanceOhms={resistanceOhms} />
    </div>
  );
}