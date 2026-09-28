import type { PinOffsetMap } from "../types";

// Hand-drawn SPDT relay-module art: a generic rectangular module with two
// screw-terminal strips — the SWITCH side on top (nc/com/no) and the CONTROL
// side below (in/vcc/gnd). Standard module visual language only; not modeled
// on any specific commercial part (see docs/DECISIONS.md for why the wokwi
// relay element wasn't used). Pin offsets sit on the screw-hole centers, which
// is exactly where the module's hookup wires land.
export const RELAY_W = 140;
export const RELAY_H = 52;
export const relayPinOffsets: PinOffsetMap = {
  nc: { x: 25, y: 5 },
  com: { x: 70, y: 5 },
  no: { x: 115, y: 5 },
  in: { x: 25, y: 47 },
  vcc: { x: 70, y: 47 },
  gnd: { x: 115, y: 47 },
};

interface RelayArtProps {
  energized: boolean;
}

// Pure SVG body art, exported for reuse by the palette preview. `energized`
// only changes the status LED fill — the contact strip layout never moves.
export function RelayArt({ energized }: RelayArtProps) {
  return (
    <svg
      width={RELAY_W}
      height={RELAY_H}
      viewBox={`0 0 ${RELAY_W} ${RELAY_H}`}
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* switch-side terminal strip (top) */}
      <rect x={0} y={0} width={RELAY_W} height={10} rx={2} fill="#cfc9b8" stroke="#a89a6a" />
      {/* control-side terminal strip (bottom) */}
      <rect x={0} y={RELAY_H - 10} width={RELAY_W} height={10} rx={2} fill="#cfc9b8" stroke="#a89a6a" />
      {/* module body */}
      <rect x={4} y={10} width={RELAY_W - 8} height={RELAY_H - 20} rx={4} fill="#f6f1e3" stroke="#a89a6a" />
      {/* switch-side screw terminals: nc / com / no */}
      {[25, 70, 115].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={5} r={4} fill="#4a4235" />
          <circle cx={cx} cy={5} r={1.8} fill="#8a857a" />
        </g>
      ))}
      {/* control-side screw terminals: in / vcc / gnd */}
      {[25, 70, 115].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={RELAY_H - 5} r={4} fill="#4a4235" />
          <circle cx={cx} cy={RELAY_H - 5} r={1.8} fill="#8a857a" />
        </g>
      ))}
      {/* coil symbol (left) */}
      <path
        d="M 16 31 L 18 20 L 22 31 L 26 20 L 30 31"
        fill="none"
        stroke="#6b6b6b"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {/* coil supply stubs (vcc/gnd realism) */}
      <line x1={16} y1={32} x2={16} y2={37} stroke="#6b6b6b" strokeWidth={1.5} />
      <line x1={30} y1={32} x2={30} y2={37} stroke="#6b6b6b" strokeWidth={1.5} />
      {/* status LED: green when the coil is energized */}
      <circle cx={52} cy={21} r={3.4} fill={energized ? "#2ecc40" : "#a09a8a"} />
      <circle cx={52} cy={21} r={1.4} fill={energized ? "#b8ffb8" : "#cfc9b8"} />
      {/* part label */}
      <text
        x={98}
        y={28}
        textAnchor="middle"
        fontSize={13}
        fontWeight={700}
        fill="#4a4235"
        style={{ fontFamily: "inherit" }}
      >
        RELAY
      </text>
      {/* contact labels */}
      <text x={25} y={40} textAnchor="middle" fontSize={6} fill="#6b6455">
        nc
      </text>
      <text x={70} y={40} textAnchor="middle" fontSize={6} fill="#6b6455">
        com
      </text>
      <text x={115} y={40} textAnchor="middle" fontSize={6} fill="#6b6455">
        no
      </text>
      <text x={25} y={12} textAnchor="middle" fontSize={6} fill="#6b6455">
        in
      </text>
      <text x={70} y={12} textAnchor="middle" fontSize={6} fill="#6b6455">
        vcc
      </text>
      <text x={115} y={12} textAnchor="middle" fontSize={6} fill="#6b6455">
        gnd
      </text>
    </svg>
  );
}

interface RelayViewProps {
  renderInfo: { type: "relay"; energized: boolean };
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
}

// Static hand-drawn view — nothing to press, so (unlike ButtonView) there are
// no onPress/onRelease handlers. The worker is the single source of truth for
// `energized`; the view just mirrors it as a data attribute + LED color.
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