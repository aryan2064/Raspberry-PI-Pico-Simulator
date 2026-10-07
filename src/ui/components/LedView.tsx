import { useEffect, useRef } from "react";
import type { LEDElement } from "@wokwi/elements";
import type { PinOffsetMap } from "../types";

// The wokwi-led element renders its shadow SVG at a natural 40x50px. The
// rendered width in mm is the SIZE KNOB: bump LED_W_MM and every derived
// constant follows (heavier default = exactly how it re-derives from the
// natural size, so the default stays byte-identical to the natural art).
export const LED_W_MM = 40 / 3.78; // SIZE KNOB (mm) — 10.58mm natural width
const LED_NATURAL_W = 40;
const LED_NATURAL_H = 50;
const LED_F = +((LED_W_MM * 3.78) / LED_NATURAL_W).toFixed(4); // 1 at default
export const LED_W = +((LED_NATURAL_W * LED_F).toFixed(3));
export const LED_H = +((LED_NATURAL_H * LED_F).toFixed(3));

// wokwi-led pin geometry (from its pinInfo): both leads run out of the
// bottom edge — anode is the right lead, cathode the left. Scaled by LED_F so
// the canvas markers follow the resized art.
export const ledPinOffsets: PinOffsetMap = {
  anode: { x: +(25 * LED_F).toFixed(3), y: +(42 * LED_F).toFixed(3) },
  cathode: { x: +(15 * LED_F).toFixed(3), y: +(42 * LED_F).toFixed(3) },
};

interface LedViewProps {
  renderInfo: { type: "led"; isOn: boolean; brightness: number };
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
}

// Renders the real <wokwi-led> web component (registered in main.tsx). The
// boolean `value` AND the continuous `brightness` (0..1, default 1.0) are set
// as JS properties via a ref: LitElement @property reads attributes as
// strings, so even value="false" would be truthy and brightness="0.5" would
// be a string. brightness is a genuine wokwi-led capability (verified in the
// package source: the glow's opacity is 0.3 + brightness*0.7 and turns off
// entirely when value is false or brightness <= EPSILON), so a PWM duty is
// reflected visually with no workaround. The visible DOM (testid/state
// attributes) lives on THIS component's own elements so jsdom tests and the
// browser-verify state() queries keep working without the shadow-DOM
// internals.
export function LedView({ renderInfo, selected }: LedViewProps) {
  const { isOn, brightness } = renderInfo;
  const ledRef = useRef<LEDElement | null>(null);
  useEffect(() => {
    if (ledRef.current) {
      ledRef.current.value = isOn;
      ledRef.current.brightness = brightness;
    }
  }, [isOn, brightness]);
  return (
    <div
      data-testid="led"
      data-selected={selected ? "true" : "false"}
      data-brightness={brightness.toFixed(3)}
      style={{
        outline: selected ? "3px solid #ffd500" : "none",
        outlineOffset: 2,
      }}
    >
      <div
        data-testid="led-body"
        data-on={isOn ? "true" : "false"}
        style={{ position: "relative", width: LED_W, height: LED_H }}
      >
        <div
          style={{
            width: LED_NATURAL_W,
            height: LED_NATURAL_H,
            transform: `scale(${LED_F})`,
            transformOrigin: "top left",
          }}
        >
          <wokwi-led ref={ledRef} />
        </div>
      </div>
    </div>
  );
}