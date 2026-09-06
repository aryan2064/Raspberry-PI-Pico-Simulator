import type { Button } from "../../engine";
import type { PinOffsetMap, Vec } from "../types";

const BTN_W = 48;
const BTN_H = 56;
const PIN_R = 5;

// The signal pin leads out the top of the button body.
export const buttonPinOffsets: PinOffsetMap = {
  signal: { x: BTN_W / 2, y: PIN_R },
};

interface ButtonViewProps {
  component: Button;
  renderInfo: { type: "button"; isPressed: boolean };
  position: Vec;
}

// Note: this view is the documented exception to pure-presentational views —
// the interaction with the engine's Button (press()/release()) lives here, on
// the button's own mouse events, per the canvas milestone spec. Pin markers
// are drawn by CircuitCanvas in a dedicated layer above wires.
export function ButtonView({ component, renderInfo, position }: ButtonViewProps) {
  const { isPressed } = renderInfo;
  return (
    <g transform={`translate(${position.x} ${position.y})`} data-testid="button">
      <rect
        x={0}
        y={PIN_R + 8}
        width={BTN_W}
        height={BTN_H - PIN_R - 8}
        rx={6}
        fill={isPressed ? "#2f7d32" : "#4caf50"}
        stroke="#1b5e20"
        strokeWidth={2}
        onMouseDown={() => component.press()}
        onMouseUp={() => component.release()}
        onMouseLeave={() => component.release()}
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