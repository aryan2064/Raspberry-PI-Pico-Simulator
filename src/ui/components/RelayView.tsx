import type { PinOffsetMap, Vec } from "../types";
import relayArtUrl from "../assets/dfrobot-3v-relay-module.svg";

// Real DFRobot artwork (DFRobot/DFRobot_3V-Relay-Module, GPL-3.0): the product
// drawing "3V Relay Module V1.0 SVG.svg" for DFR0473, the Gravity 3V Relay
// Module (38 x 33 x 20 mm board), shipped as a static asset — the same approach
// as the Pico board. This replaces the hand-drawn module art. Source URL,
// license and the in-house-only + deferred-attribution TODO live in the asset's
// own header comment and in docs/DECISIONS.md.
//
// PIN MAPPING: this is the real module, so the engine's six-pin interface maps
// straight onto its silkscreen labels — no reuse, no relabelling:
//   in -> D, vcc -> +, gnd -> -  (the "Gravity 3P Interface" header, right)
//   com -> COM, no -> NO, nc -> NC (the 4-pin wiring terminal block, left)
// The block's N/A (not-available) terminal is literally silk-screened as such
// and has no engine pin; it is drawn but never wired.
//
// REAL-SIZE SCALING: the physical board is 38 x 33 x 20 mm (DFRobot DFR0473
// product page). It renders at the shared Wokwi-calibrated scale of 3.78 px/mm
// (docs/DECISIONS.md, "Shared component scale") — 38 mm -> 143.64 px wide.
// SIZE KNOB: rendered board width in mm (real DFR0473 board = 38mm). Raise it
// to scale the whole relay up uniformly — height and every pin anchor derive
// from RELAY_W, so nothing else needs to change (docs/DECISIONS.md).
export const RELAY_W_MM = 40; // 38mm real board width
export const RELAY_W = RELAY_W_MM * 3.78; // 143.64 px = the board's 38mm real width
// The vendored asset's viewBox crops the Inkscape A4 page to the module's
// drawing: "211 566 124 106.5" (the board spans 124 x 106.5 user units at
// origin 211,566). Height is DERIVED from the width through the asset's own
// 124:106.5 aspect — never set independently, so the artwork is never
// squished (the old independent 140x~120 pick widened the drawing ~1.16x).
export const RELAY_H = 106.5 * (RELAY_W / 124); // 123.37

const RELAY_VIEWBOX = { x: 211, y: 566, w: 124, h: 106.5 };
const RELAY_SCALE = RELAY_W / RELAY_VIEWBOX.w;

// Engine label -> centre of that pin's actual connection metal, measured from
// the asset itself (the module has no connectorNpin markup). These are
// area-weighted pixel centroids of the drawn pads/screws, computed by probing
// the served asset — screw-eye centroids for the four wiring-block terminals,
// solder-pad-pair centroids for the three header pins. Nothing is eyeballed;
// the numbers, the measuring probe and the method are recorded in
// docs/DECISIONS.md and re-verified by scripts/browser-verify.mjs against the
// served file's own pixels.
const RELAY_PIN_ANCHORS: Record<string, Vec> = {
  in: { x: 306.63, y: 626.688 }, // D header pad
  vcc: { x: 306.923, y: 618.791 }, // + header pad
  gnd: { x: 307.322, y: 611.203 }, // - header pad
  com: { x: 222.751, y: 636.986 }, // COM screw eye
  no: { x: 222.793, y: 615.392 }, // NO screw eye
  nc: { x: 222.768, y: 604.423 }, // NC screw eye
};

function buildRelayPinOffsets(): PinOffsetMap {
  const offsets: PinOffsetMap = {};
  for (const [label, center] of Object.entries(RELAY_PIN_ANCHORS)) {
    offsets[label] = {
      x: +((center.x - RELAY_VIEWBOX.x) * RELAY_SCALE).toFixed(3),
      y: +((center.y - RELAY_VIEWBOX.y) * RELAY_SCALE).toFixed(3),
    };
  }
  return offsets;
}

// Header pins sit on the right at x ≈ 110.78 and screw terminals on the left at
// x ≈ 13.62, each spread down the body (offset.y grows with the anchor's y).
export const relayPinOffsets: PinOffsetMap = buildRelayPinOffsets();

interface RelayArtProps {
  energized: boolean;
}

// Component body art: the vendored DFRobot 3V Relay Module alone (one unified
// visual — the hand-drawn board is gone), drawn at the asset's own viewBox so
// the pin markers land exactly on the module's drawn pads and screw eyes. The
// upstream part is static artwork, so `energized` is not painted here; the
// worker stays the single source of truth for it and RelayView mirrors it as
// data-energized. Exported for the palette preview.
export function RelayArt(_props: RelayArtProps) {
  return (
    <svg
      width={RELAY_W}
      height={RELAY_H}
      viewBox={`${RELAY_VIEWBOX.x} ${RELAY_VIEWBOX.y} ${RELAY_VIEWBOX.w} ${RELAY_VIEWBOX.h}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      <image
        href={relayArtUrl}
        x={RELAY_VIEWBOX.x}
        y={RELAY_VIEWBOX.y}
        width={RELAY_VIEWBOX.w}
        height={RELAY_VIEWBOX.h}
        preserveAspectRatio="none"
        style={{ pointerEvents: "none" }}
      />
    </svg>
  );
}

interface RelayViewProps {
  renderInfo: { type: "relay"; energized: boolean };
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
}

// Static view apart from the worker's state. Nothing to press, so (unlike
// ButtonView) there are no onPress/onRelease handlers; the worker is the single
// source of truth for `energized`, mirrored here as a data attribute.
export function RelayView({ renderInfo, selected }: RelayViewProps) {
  const { energized } = renderInfo;
  return (
    <div
      data-testid="relay"
      data-selected={selected ? "true" : "false"}
      style={{
        outline: selected ? "3px solid #ffd500" : "none",
        outlineOffset: 2,
      }}
    >
      <div data-testid="relay-body" data-energized={energized ? "true" : "false"}>
        <RelayArt energized={energized} />
      </div>
    </div>
  );
}