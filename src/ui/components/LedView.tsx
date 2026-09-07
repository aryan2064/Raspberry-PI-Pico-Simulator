import { useEffect, useRef } from "react";
import type { LEDElement } from "@wokwi/elements";
import type { PinOffsetMap } from "../types";

// wokwi-led pin geometry (from its pinInfo): both leads run out of the
// bottom edge — anode is the right lead, cathode the left.
export const ledPinOffsets: PinOffsetMap = {
  anode: { x: 25, y: 42 },
  cathode: { x: 15, y: 42 },
};

interface LedViewProps {
  renderInfo: { type: "led"; isOn: boolean };
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
}

// Renders the real <wokwi-led> web component (registered in main.tsx). The
// boolean `value` is set as a JS property via a ref: LitElement @property
// reads attributes as strings, so even value="false" would be truthy.
// The visible DOM (testid/state attributes) lives on THIS component's own
// elements so jsdom tests and the browser-verify state() queries keep
// working without the shadow-DOM internals.
export function LedView({ renderInfo, selected }: LedViewProps) {
  const { isOn } = renderInfo;
  const ledRef = useRef<LEDElement | null>(null);
  useEffect(() => {
    if (ledRef.current) ledRef.current.value = isOn;
  }, [isOn]);
  return (
    <div
      data-testid="led"
      data-selected={selected ? "true" : "false"}
      style={{
        outline: selected ? "3px solid #ffd500" : "none",
        outlineOffset: 2,
      }}
    >
      <div data-testid="led-body" data-on={isOn ? "true" : "false"}>
        <wokwi-led ref={ledRef} />
      </div>
    </div>
  );
}