import type { PinOffsetMap, Vec } from "../types";
import transistorArtUrl from "../assets/transistor-to92-npn.svg";

// Real Fritzing artwork (fritzing/fritzing-parts, CC BY-SA 3.0): the
// breadboard view referenced by core/transistor_signal_NPN_TO92_CBE.fzp
// ("NPN-Transistor", TO92 [THT]), shipped as a static asset — the same approach
// as the Pico board. This replaces the hand-drawn TO-92-ish outline. Source
// URL, license and the deferred-attribution TODO live in the asset's own header
// comment and in docs/DECISIONS.md.
//
// PACKAGE CHOICE: a genuine generic TO-92 through-hole part was found in
// core/, so the SOT-23 surface-mount fallback was NOT needed. It is also the
// better visual match because its left-to-right lead order already equals our
// BC547-style reading, so the pin labels are unchanged.
// SIZE KNOB: rendered width in mm (real TO-92 = 5.83mm across the leads).
// Raise it to scale the whole part up uniformly — height and the three lead
// offsets derive from TRANSISTOR_W via TRANSISTOR_SCALE (docs/DECISIONS.md).
export const TRANSISTOR_W_MM = 7.83; // the part's 5.83mm width
export const TRANSISTOR_W = TRANSISTOR_W_MM * 3.78; // 22.037 px = the part's 5.83mm width
// REAL-SIZE SCALING: the part's own viewBox is "0 0 16.527 24.081"
// (0.22954in x 0.33446in), an Inkscape-72dpi drawing — 16.527 px @ 72dpi =
// 0.22954in = 5.83mm, which the shared Wokwi-calibrated scale (3.78 px/mm,
// docs/DECISIONS.md "Shared component scale") renders as 22.037 px wide. A
// TO-92 with its leads is taller than it is wide, so the derived height keeps
// the width-dominant body honest: aspect ratio is preserved exactly, never
// independently chosen (the old 80-wide pick inflated the part ~3.6x).
const TRANSISTOR_VIEWBOX = { x: 0, y: 0, w: 16.527, h: 24.081 };
const TRANSISTOR_SCALE = TRANSISTOR_W / TRANSISTOR_VIEWBOX.w;
export const TRANSISTOR_H = +(TRANSISTOR_VIEWBOX.h * TRANSISTOR_SCALE).toFixed(3);

// Engine label -> [x, y, width, height] of that pin's connector rect, copied
// verbatim from the asset's own connection markup. The .fzp's breadboard
// mapping is the legacy-scrambled kind (connector0 "E" points at connector2pin),
// so the identity of each lead is resolved from the part's real left-to-right
// geometry instead:
//   left  lead = collector, centre lead = base, right lead = emitter
// which is exactly the order the engine already used, so no label moved.
const TRANSISTOR_CONNECTOR_RECTS: Record<string, [number, number, number, number]> = {
  collector: [0, 22.081, 2.16, 1], // connector0pin — left lead
  base: [7.181, 22.081, 2.16, 1], // connector1pin — centre lead
  emitter: [14.367, 22.081, 2.16, 1], // connector2pin — right lead
};

function buildTransistorPinOffsets(): PinOffsetMap {
  const offsets: PinOffsetMap = {};
  for (const [label, [x, y, w, h]] of Object.entries(TRANSISTOR_CONNECTOR_RECTS)) {
    const center: Vec = { x: x + w / 2, y: y + h / 2 };
    offsets[label] = {
      x: +((center.x - TRANSISTOR_VIEWBOX.x) * TRANSISTOR_SCALE).toFixed(3),
      y: +((center.y - TRANSISTOR_VIEWBOX.y) * TRANSISTOR_SCALE).toFixed(3),
    };
  }
  return offsets;
}

// collector x = 1.44, base x = 11.015, emitter x = 20.597; all at y = 30.11.
export const transistorPinOffsets: PinOffsetMap = buildTransistorPinOffsets();

interface TransistorArtProps {
  conducting: boolean;
}

// Component body art: the vendored Fritzing transistor part alone, drawn at the
// part's own viewBox so the pin markers land exactly on its lead tabs. The
// upstream part is static artwork, so `conducting` is not painted here; the
// worker stays the single source of truth and TransistorView mirrors it as
// data-conducting. Exported for the palette preview.
export function TransistorArt(_props: TransistorArtProps) {
  return (
    <svg
      width={TRANSISTOR_W}
      height={TRANSISTOR_H}
      viewBox={`${TRANSISTOR_VIEWBOX.x} ${TRANSISTOR_VIEWBOX.y} ${TRANSISTOR_VIEWBOX.w} ${TRANSISTOR_VIEWBOX.h}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <image
        href={transistorArtUrl}
        x={TRANSISTOR_VIEWBOX.x}
        y={TRANSISTOR_VIEWBOX.y}
        width={TRANSISTOR_VIEWBOX.w}
        height={TRANSISTOR_VIEWBOX.h}
        preserveAspectRatio="none"
        style={{ pointerEvents: "none" }}
      />
    </svg>
  );
}

interface TransistorViewProps {
  renderInfo: { type: "transistor"; conducting: boolean };
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
}

// Static view — no interactive terminals. The worker is the single source of
// truth for `conducting`; the view mirrors it as a data attribute.
export function TransistorView({ renderInfo, selected }: TransistorViewProps) {
  const { conducting } = renderInfo;
  return (
    <div
      data-testid="transistor"
      data-selected={selected ? "true" : "false"}
      style={{
        outline: selected ? "3px solid #ffd500" : "none",
        outlineOffset: 2,
      }}
    >
      <div data-testid="transistor-body" data-conducting={conducting ? "true" : "false"}>
        <TransistorArt conducting={conducting} />
      </div>
    </div>
  );
}