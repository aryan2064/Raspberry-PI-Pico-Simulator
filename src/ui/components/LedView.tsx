import type { PinOffsetMap, Vec } from "../types";

const LED_W = 56;
const LED_H = 64;

// anode leads out the top, cathode out the bottom.
export const ledPinOffsets: PinOffsetMap = {
  anode: { x: LED_W / 2, y: 0 },
  cathode: { x: LED_W / 2, y: LED_H },
};

interface LedViewProps {
  renderInfo: { type: "led"; isOn: boolean };
  position: Vec;
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
}

// Purely presentational: renders the LED body only. Pin markers are drawn by
// CircuitCanvas in a dedicated layer above wires.
export function LedView({ renderInfo, position, selected }: LedViewProps) {
  const { isOn } = renderInfo;
  return (
    <g
      transform={`translate(${position.x} ${position.y})`}
      data-testid="led"
      data-selected={selected ? "true" : "false"}
    >
      <circle
        cx={LED_W / 2}
        cy={LED_H / 2}
        r={22}
        fill={isOn ? "#ff3b30" : "#e4e4e6"}
        stroke={selected ? "#ffd500" : isOn ? "#c22" : "#b8b8bc"}
        strokeWidth={selected ? 4 : 2}
        data-testid="led-body"
        data-on={isOn ? "true" : "false"}
      />
    </g>
  );
}