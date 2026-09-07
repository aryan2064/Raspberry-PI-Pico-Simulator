import { useEffect, useRef } from "react";
import type { PushbuttonElement } from "@wokwi/elements";
import type { PinOffsetMap } from "../types";

// wokwi-pushbutton pin geometry (from its own pinInfo): four legs, one per
// corner of the 17.802mm-wide SVG — top strip (1.l / 1.r, y=13) and bottom
// strip (2.l / 2.r, y=32). Engine mapping: leg1a=<1.l>, leg1b=<1.r>,
// leg2a=<2.l>, leg2b=<2.r>. Each strip is permanently shorted internally; the
// press bridges leg1a-leg2a.
export const buttonPinOffsets: PinOffsetMap = {
  leg1a: { x: 0, y: 13 },
  leg1b: { x: 67, y: 13 },
  leg2a: { x: 0, y: 32 },
  leg2b: { x: 67, y: 32 },
};

interface ButtonViewProps {
  renderInfo: { type: "button"; isPressed: boolean };
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
  // Press/release are relayed to the worker (the engine Button lives there),
  // not called on a local engine object.
  onPress: () => void;
  onRelease: () => void;
}

// Renders the real <wokwi-pushbutton> web component (registered in
// main.tsx). engine state drives `pressed` via a ref property (LitElement
// @property reads attributes as strings, so "false" would be truthy); the
// element's own internal press handling runs in parallel and stays in sync.
// Mouse handlers live on this component's wrapper so relay + state attributes
// are testable without the shadow-DOM internals.
export function ButtonView({ renderInfo, selected, onPress, onRelease }: ButtonViewProps) {
  const { isPressed } = renderInfo;
  const btnRef = useRef<PushbuttonElement | null>(null);
  useEffect(() => {
    if (btnRef.current) btnRef.current.pressed = isPressed;
  }, [isPressed]);
  return (
    <div
      data-testid="button"
      data-selected={selected ? "true" : "false"}
      style={{
        outline: selected ? "3px solid #ffd500" : "none",
        outlineOffset: 2,
      }}
    >
      <div
        data-testid="button-body"
        data-pressed={isPressed ? "true" : "false"}
        onMouseDown={onPress}
        onMouseUp={onRelease}
        onMouseLeave={onRelease}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        <wokwi-pushbutton ref={btnRef} color="#4caf50" />
      </div>
    </div>
  );
}