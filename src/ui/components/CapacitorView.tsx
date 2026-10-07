import type { PinOffsetMap } from "../types";

// The capacitor is hand-drawn, not vendored: @wokwi/elements has NO capacitor
// element at all (verified in the 1.9.2 package — the only passives it ships
// are resistor, potentiometer, slide-potentiometer, photoresistor-sensor), and
// the Fritzing part is a static third-party SVG. Per the relay/transistor
// precedent (hand-drawn art when no real element fits), this radial
// electrolytic can is plain SVG with a charge-state fill driven by the engine's
// snapshot. See docs/DECISIONS.md ("Capacitor") for the full reasoning.
// REAL-SIZE SCALING: the drawn can (42 x 52 art units) is pitched at a standard
// Ø10 x 12.5mm radial electrolytic case (e.g. the Vishay 046 RSL family, whose
// "Ø10 x 12" nominal case covers e.g. 100µF/40V and 220µF/16V). At the shared
// Wokwi-calibrated scale of 3.78 px/mm (docs/DECISIONS.md "Shared component
// scale"), a 10mm can is 37.8 px — the drawing's can is 42 units, so the whole
// drawing scales by k = 37.8/42 = 0.9. The SVG keeps its own 48x64 viewBox and
// the exported size reports the real dimensions.
const CAP_ART_W = 48;
const CAP_ART_H = 64;
// SIZE KNOB: rendered width in mm (the full 48-unit drawing, leads included).
// Raise it to scale the whole capacitor up uniformly — CAP_SCALE, the size,
// and the a/b leg offsets all follow (docs/DECISIONS.md).
export const CAP_W_MM = (43.2 / 3.78) + 7; // 11.4286mm rendered width at default
const CAP_SCALE = (CAP_W_MM * 3.78) / CAP_ART_W; // 0.9 at default
export const CAP_W = CAP_ART_W * CAP_SCALE; // 43.2 px
export const CAP_H = CAP_ART_H * CAP_SCALE; // 57.6 px

// Leg tips (matching the two leads drawn below): `a` is the ACTIVE net pin
// (left leg — the one the resistor/pot and GPIO usually share), `b` the
// decorative ground-side lead (right leg). Scaled by the same CAP_SCALE as the
// art, so they still land on the drawn leg circles.
export const capacitorPinOffsets: PinOffsetMap = {
  a: { x: 14 * CAP_SCALE, y: 64 * CAP_SCALE }, // 12.6, 57.6
  b: { x: 34 * CAP_SCALE, y: 64 * CAP_SCALE }, // 30.6, 57.6
};

// Hand-drawn radial electrolytic. `chargeFraction` (0..1) fills the can with a
// green->amber charge gradient rising from the bottom; `charged` adds an amber
// vent glow + status dot so the timing trip is obvious at a glance.
export function CapacitorArt({ chargeFraction, charged }: { chargeFraction: number; charged: boolean }) {
  const fillTop = 56 - chargeFraction * 44;
  const fillHeight = Math.max(0, 56 - fillTop);
  return (
    <svg
      width={CAP_W}
      height={CAP_H}
      viewBox={`0 0 ${CAP_ART_W} ${CAP_ART_H}`}
      style={{ display: "block" }}
    >
      <defs>
        <linearGradient id={`cap-charge-${charged}`} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#34e052" />
          <stop offset="1" stopColor="#ffb400" />
        </linearGradient>
      </defs>

      {/* leads */}
      <line x1="14" y1="56" x2="14" y2="64" stroke="#b0b8c0" strokeWidth="3" />
      <line x1="34" y1="56" x2="34" y2="64" stroke="#b0b8c0" strokeWidth="3" />
      <circle cx="14" cy="64" r="2.4" fill="#8f989f" />
      <circle cx="34" cy="64" r="2.4" fill="#8f989f" />

      {/* can */}
      <rect x="3" y="6" width="42" height="52" rx="5" fill="#24537f" stroke="#16354f" strokeWidth="1.5" />
      {/* top vent */}
      <rect x="21.5" y="10" width="5" height="7" rx="1" fill="#16354f" />
      <rect x="23" y="10" width="2" height="7" fill="#0d2a44" />

      {/* + polarity stripe (left side, cathode side marking) */}
      <rect x="3" y="20" width="3.2" height="28" fill="#ff8a3d" />

      {/* capacitor symbol plates near the top */}
      <rect x="18.4" y="16" width="1.8" height="9" fill="#cfe3f5" />
      <rect x="27.8" y="16" width="1.8" height="9" fill="#cfe3f5" />

      {/* charge fill */}
      <rect
        x="4.5"
        y={fillTop}
        width="39"
        height={fillHeight}
        rx="3"
        fill={`url(#cap-charge-${charged})`}
        opacity={fillHeight > 0 ? 0.6 : 0}
      />

      {/* charged glow: amber rim + status dot */}
      {charged && (
        <rect
          x="3"
          y="6"
          width="42"
          height="52"
          rx="5"
          fill="none"
          stroke="#ffb400"
          strokeWidth="3"
        />
      )}
      <circle cx="41" cy="12" r="3" fill={charged ? "#ffb400" : "#16354f"} />

      {/* + marking */}
      <text x="8" y="33" fontSize="8" fill="#fff" textAnchor="middle" style={{ fontFamily: "monospace" }}>
        +
      </text>
    </svg>
  );
}

interface CapacitorViewProps {
  renderInfo: { type: "capacitor"; chargeFraction: number; charged: boolean };
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
}

export function CapacitorView({ renderInfo, selected }: CapacitorViewProps) {
  const { chargeFraction, charged } = renderInfo;
  return (
    <div
      data-testid="capacitor"
      data-selected={selected ? "true" : "false"}
      data-charged={charged ? "true" : "false"}
      data-charge-fraction={chargeFraction.toFixed(3)}
      style={{
        outline: selected ? "3px solid #ffd500" : "none",
        outlineOffset: 2,
      }}
    >
      <CapacitorArt chargeFraction={chargeFraction} charged={charged} />
    </div>
  );
}