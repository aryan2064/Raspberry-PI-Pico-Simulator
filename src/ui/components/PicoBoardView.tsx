import type { PinOffsetMap, Vec } from "../types";

const BOARD_W = 320;
const BOARD_H = 120;

// 29 GPIO pins + 3V3 + GND laid out in a single row along the bottom edge.
// Pin markers are drawn by CircuitCanvas from these offsets.
function buildPinOffsets(): PinOffsetMap {
  const offsets: PinOffsetMap = {};
  for (let i = 0; i <= 28; i++) {
    offsets[`GPIO${i}`] = { x: 14 + i * 10, y: BOARD_H - 8 };
  }
  offsets["3V3"] = { x: 14 + 29 * 10, y: BOARD_H - 8 };
  offsets["GND"] = { x: 14 + 30 * 10, y: BOARD_H - 8 };
  return offsets;
}

export const picoPinOffsets: PinOffsetMap = buildPinOffsets();

interface PicoBoardViewProps {
  renderInfo: { type: "pico_board" };
  position: Vec;
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
}

// Purely presentational: renders the board body only.
export function PicoBoardView({ position, selected }: PicoBoardViewProps) {
  return (
    <g
      transform={`translate(${position.x} ${position.y})`}
      data-testid="pico-board"
      data-selected={selected ? "true" : "false"}
    >
      <rect
        width={BOARD_W}
        height={BOARD_H}
        rx={10}
        fill="#1c3a1f"
        stroke={selected ? "#ffd500" : "#0d2410"}
        strokeWidth={selected ? 4 : 2}
      />
      <text x={16} y={30} fill="#d7ffd9" fontFamily="monospace" fontSize={14} fontWeight={700}>
        Raspberry Pi Pico
      </text>
      <text x={picoPinOffsets["3V3"].x - 5} y={BOARD_H - 18} fill="#d7ffd9" fontSize={8}>
        3V3
      </text>
      <text x={picoPinOffsets["GND"].x - 5} y={BOARD_H - 18} fill="#d7ffd9" fontSize={8}>
        GND
      </text>
    </g>
  );
}