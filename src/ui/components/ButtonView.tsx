import type { PinOffsetMap, Vec } from "../types";

const BTN_W = 48;
const BTN_H = 56;
const PIN_R = 5;

// The signal pin leads out the top of the button body.
export const buttonPinOffsets: PinOffsetMap = {
  signal: { x: BTN_W / 2, y: PIN_R },
};

interface ButtonViewProps {
  renderInfo: { type: "button"; isPressed: boolean };
  position: Vec;
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
  // Press/release are relayed to the worker (the engine Button lives there),
  // not called on a local engine object.
  onPress: () => void;
  onRelease: () => void;
}

export function ButtonView({ renderInfo, position, selected, onPress, onRelease }: ButtonViewProps) {
  const { isPressed } = renderInfo;
  return (
    <g
      transform={`translate(${position.x} ${position.y})`}
      data-testid="button"
      data-selected={selected ? "true" : "false"}
    >
      <rect
        x={0}
        y={PIN_R + 8}
        width={BTN_W}
        height={BTN_H - PIN_R - 8}
        rx={6}
        fill={isPressed ? "#2f7d32" : "#4caf50"}
        stroke={selected ? "#ffd500" : "#1b5e20"}
        strokeWidth={selected ? 4 : 2}
        onMouseDown={onPress}
        onMouseUp={onRelease}
        onMouseLeave={onRelease}
        style={{ cursor: "pointer", userSelect: "none" }}
        data-testid="button-body"
        data-pressed={isPressed ? "true" : "false"}
      />
      <text
        x={BTN_W / 2}
        y={PIN_R + 26}
        textAnchor="middle"
        fill="#fff"
        fontSize={11}
        fontWeight={700}
      >
        {isPressed ? "PRESSED" : "Button"}
      </text>
    </g>
  );
}