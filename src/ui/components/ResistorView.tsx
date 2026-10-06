import { useEffect, useRef } from "react";
import type { ResistorElement } from "@wokwi/elements";
import type { PinOffsetMap } from "../types";

// The resistor is the ONE new part we can use straight from the published
// @wokwi/elements package: unlike the stepper/PIR/pot, wokwi-resistor has no
// interaction handlers and no state the engine must drive through a mod — we
// only reflect the resistance as band colors via its `value` property. See
// docs/DECISIONS.md ("Resistor") for why this one needs no vendoring exception.
export const RESISTOR_W = 59.14; // 15.645mm @ 3.78 px/mm (the element's natural size)
export const RESISTOR_H = 11.34; // 3mm @ 3.78 px/mm

// Pin offsets, straight from the package element's own pinInfo — the two lead
// tips, terminal1 left / terminal2 right at the vertically-centered lead line:
//   terminal1 (0, 5.65)  terminal2 (58.8, 5.65)
// The canvas markers sit on these exact coordinates and browser-verify asserts
// they match the live element's `pinInfo`.
export const resistorPinOffsets: PinOffsetMap = {
  terminal1: { x: 0, y: 5.65 },
  terminal2: { x: 58.8, y: 5.65 },
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
      <wokwi-resistor ref={ref} />
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