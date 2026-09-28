import type { PinOffsetMap } from "../types";

// Hand-drawn NPN transistor in TO-92-ish outline: body with three axial leads
// hanging from the bottom. Lead order follows the common BC547 flat-side
// reading (left -> right: collector, base, emitter) — documented in
// docs/DECISIONS.md so the *visual* center lead is the control input. Pin
// offsets sit at the lead ends where the socket tin would receive them.
export const TRANSISTOR_W = 80;
export const TRANSISTOR_H = 40;
export const transistorPinOffsets: PinOffsetMap = {
  base: { x: 40, y: 40 },
  collector: { x: 25, y: 40 },
  emitter: { x: 55, y: 40 },
};

interface TransistorArtProps {
  conducting: boolean;
}

// Pure SVG body art, exported for reuse by the palette preview. `conducting`
// tints the epoxy body — the leads themselves never animate.
export function TransistorArt({ conducting }: TransistorArtProps) {
  return (
    <svg
      width={TRANSISTOR_W}
      height={TRANSISTOR_H}
      viewBox={`0 0 ${TRANSISTOR_W} ${TRANSISTOR_H}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* three leads (collector / base / emitter) */}
      {[25, 40, 55].map((x) => (
        <rect key={x} x={x - 1.6} y={22} width={3.2} height={TRANSISTOR_H - 22} rx={1} fill="#b9b9b9" />
      ))}
      {/* epoxy body */}
      <rect
        x={10}
        y={0}
        width={60}
        height={22}
        rx={5}
        fill={conducting ? "#f4c88a" : "#e7e2d6"}
        stroke="#b3a688"
      />
      {/* part label */}
      <text
        x={40}
        y={15}
        textAnchor="middle"
        fontSize={12}
        fontWeight={700}
        fill={conducting ? "#6b4a1f" : "#4a4235"}
        style={{ fontFamily: "inherit" }}
      >
        NPN
      </text>
      {/* terminal labels, bottom just under the lead ends */}
      <text x={25} y={38.5} textAnchor="middle" fontSize={5.5} fill="#6b6455">
        collector
      </text>
      <text x={40} y={38.5} textAnchor="middle" fontSize={5.5} fill="#6b6455">
        base
      </text>
      <text x={55} y={38.5} textAnchor="middle" fontSize={5.5} fill="#6b6455">
        emitter
      </text>
    </svg>
  );
}

interface TransistorViewProps {
  renderInfo: { type: "transistor"; conducting: boolean };
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
}

// Static hand-drawn view — no interactive terminals. The worker is the single
// source of truth for `conducting`; the view mirrors it as a data attribute
// plus body tint.
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