import { useEffect, useRef } from "react";
import type { PIRMotionSensorElement } from "../../vendor/wokwi/pir-motion-sensor-element";
import type { PinOffsetMap } from "../types";

// The PIR dome is our VENDORED, modified copy of @wokwi/elements'
// wokwi-pir-motion-sensor, <app-pir-motion-sensor> (registered in main.tsx).
// Vendoring is a deliberate, documented exception (docs/DECISIONS.md, "PIR
// Motion Sensor"): the published element is a purely static SVG with no
// properties at all, so we compile the source ourselves with a `motionActive`
// display property (dome/lens glow warm amber/red) and the three leads
// relabeled vcc/out/gnd. The engine's hold timer is the single source of
// truth; the element merely mirrors the trigger state it is given.
export const PIR_W = 90.72; // 24mm @ 3.78 px/mm
export const PIR_H = 92.41; // 24.448mm @ 3.78 px/mm

// Pin offsets, straight from the modified source's own pinInfo — the three
// lead tips on the bottom face of the 90.7x92.4 viewBox, in module order
// VCC-OUT-GND (a real HC-SR501's left-to-right header):
//   vcc: x=36.178  out: x=45.9175  gnd: x=55.6415  (all y=92)
// The canvas markers sit on these exact coordinates, and browser-verify
// asserts they match the live element's `pinInfo` to sub-pixel tolerance.
export const pirPinOffsets: PinOffsetMap = {
  vcc: { x: 36.178, y: 92 },
  out: { x: 45.9175, y: 92 },
  gnd: { x: 55.6415, y: 92 },
};

// Component body art: the vendored PIR element alone. `motionActive` is
// mirrored onto the element's property via a ref (the same ref-property
// pattern LedView uses for wokwi-led.value/brightness), so a detected motion
// lights the dome warm amber/red. Exported for the palette preview like
// StepperArt/RelayArt.
export function PIRArt({ motionActive }: { motionActive: boolean }) {
  const pirRef = useRef<PIRMotionSensorElement | null>(null);
  useEffect(() => {
    if (pirRef.current) pirRef.current.motionActive = motionActive;
  }, [motionActive]);
  return (
    <div style={{ position: "relative", width: PIR_W, height: PIR_H }}>
      {/* Vendored PIR (registered in main.tsx, browser only). In jsdom tests it
          is an unrecognised tag — harmless, nothing reads its shadow DOM. */}
      <app-pir-motion-sensor ref={pirRef} />
    </div>
  );
}

interface PIRSensorViewProps {
  renderInfo: { type: "pir"; motionActive: boolean };
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
  // A click on the dome is the motion stimulus — relayed to the worker (the
  // engine PIRSensor lives there), not fired on a local engine object.
  onTrigger: () => void;
}

export function PIRSensorView({ renderInfo, selected, onTrigger }: PIRSensorViewProps) {
  const { motionActive } = renderInfo;
  return (
    <div
      data-testid="pir"
      data-selected={selected ? "true" : "false"}
      data-motion-active={motionActive ? "true" : "false"}
      style={{
        outline: selected ? "3px solid #ffd500" : "none",
        outlineOffset: 2,
      }}
    >
      <div
        data-testid="pir-body"
        data-motion-active={motionActive ? "true" : "false"}
        onMouseDown={onTrigger}
        style={{ cursor: "pointer", userSelect: "none" }}
      >
        <PIRArt motionActive={motionActive} />
      </div>
    </div>
  );
}