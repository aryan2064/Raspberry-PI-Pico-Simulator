import type { CSSProperties } from "react";
import type { ComponentKind } from "../execution/messages";
import { RelayArt, RELAY_W, RELAY_H } from "./components/RelayView";
import { TransistorArt, TRANSISTOR_W, TRANSISTOR_H } from "./components/TransistorView";
import { StepperArt } from "./components/StepperMotorView";
import { PIRArt, PIR_W, PIR_H } from "./components/PIRSensorView";
import { PotentiometerArt, POT_W, POT_H } from "./components/PotentiometerView";
import { ResistorArt, RESISTOR_W, RESISTOR_H } from "./components/ResistorView";
import { CapacitorArt, CAP_W, CAP_H } from "./components/CapacitorView";
import { UltrasonicArt, ULTRA_W, ULTRA_H } from "./components/UltrasonicSensorView";

// Custom MIME type used for palette -> canvas native-drag payloads. Using a
// non-standard type (rather than e.g. "text/plain") keeps unrelated page
// drops (links, files, selected text) from being misread as placements.
export const COMPONENT_MIME = "application/x-pico-component";

type PaletteKind = Extract<
  ComponentKind,
  "led" | "button" | "relay" | "transistor" | "stepper" | "pir" | "potentiometer" | "resistor" | "capacitor" | "ultrasonic"
>;

const PALETTE_ITEMS: Array<{ kind: PaletteKind; label: string; hint: string }> = [
  { kind: "led", label: "LED", hint: "anode / cathode" },
  { kind: "button", label: "Button", hint: "bridges both strips while pressed" },
  { kind: "relay", label: "Relay", hint: "NC→COM normally; NO when in is HIGH" },
  { kind: "transistor", label: "NPN", hint: "conducts when base is HIGH" },
  { kind: "stepper", label: "Stepper", hint: "28BYJ-48 + ULN2003; IN1–IN4 sequences spin it" },
  { kind: "pir", label: "PIR", hint: "click the dome to simulate motion; OUT HIGH while detected" },
  { kind: "potentiometer", label: "Potentiometer", hint: "drag the knob; wiper follows 0..1" },
  { kind: "resistor", label: "Resistor", hint: "10kΩ (5.0); charges a cap in maxCharge × fraction" },
  { kind: "capacitor", label: "Capacitor", hint: "RC timing: charges through a parallel resistor/pot" },
  { kind: "ultrasonic", label: "HC-SR04", hint: "TRIG rise → ECHO high for 58µs/cm; drag slider for distance" },
];

// Small live previews of the real wokwi elements (led/button) plus the
// vendored static SVG assets (relay/transistor, from fritzing-parts). The
// custom elements are registered in main.tsx (browser only); in tests they
// simply render as unrecognized tags, which is harmless here.
function PalettePreview({ kind }: { kind: PaletteKind }) {
  const previewStyle: CSSProperties = {
    transform: "scale(0.6)",
    transformOrigin: "top left",
    pointerEvents: "none",
  };
  if (kind === "relay") {
    return (
      <div
        style={{
          ...previewStyle,
          width: RELAY_W * 0.6,
          height: RELAY_H * 0.6,
          marginBottom: 4,
        }}
      >
        <RelayArt energized={false} />
      </div>
    );
  }
  if (kind === "transistor") {
    return (
      <div
        style={{
          ...previewStyle,
          width: TRANSISTOR_W * 0.6,
          height: TRANSISTOR_H * 0.6,
          marginBottom: 4,
        }}
      >
        <TransistorArt conducting={false} />
      </div>
    );
  }
  if (kind === "stepper") {
    return (
      <div
        style={{
          ...previewStyle,
          width: 144,
          height: 66,
          marginBottom: 4,
        }}
      >
        <StepperArt angleDegrees={0} />
      </div>
    );
  }
  if (kind === "pir") {
    return (
      <div
        style={{
          ...previewStyle,
          width: PIR_W * 0.6,
          height: PIR_H * 0.6,
          marginBottom: 4,
        }}
      >
        <PIRArt motionActive={false} />
      </div>
    );
  }
  if (kind === "potentiometer") {
    return (
      <div
        style={{
          ...previewStyle,
          width: POT_W * 0.6,
          height: POT_H * 0.6,
          marginBottom: 4,
        }}
      >
        <PotentiometerArt knobPosition={0.3} />
      </div>
    );
  }
  if (kind === "resistor") {
    return (
      <div
        style={{
          ...previewStyle,
          width: RESISTOR_W * 0.6,
          height: RESISTOR_H * 0.6,
          marginBottom: 4,
        }}
      >
        <ResistorArt resistanceOhms={10000} />
      </div>
    );
  }
  if (kind === "capacitor") {
    return (
      <div
        style={{
          ...previewStyle,
          width: CAP_W * 0.6,
          height: CAP_H * 0.6,
          marginBottom: 4,
        }}
      >
        <CapacitorArt chargeFraction={0} charged={false} />
      </div>
    );
  }
  if (kind === "ultrasonic") {
    return (
      <div
        style={{
          ...previewStyle,
          width: ULTRA_W * 0.6,
          height: ULTRA_H * 0.6,
          marginBottom: 4,
        }}
      >
        <UltrasonicArt />
      </div>
    );
  }
  return (
    <div
      style={{
        ...previewStyle,
        width: kind === "led" ? 24 : 40,
        height: kind === "led" ? 30 : 27,
        marginBottom: 4,
      }}
    >
      {kind === "led" ? <wokwi-led /> : <wokwi-pushbutton color="#4caf50" />}
    </div>
  );
}

// Sidebar of draggable part types. Purely presentational: each entry only
// publishes its component KIND into the native drag payload — the canvas owns
// drop handling, coordinate conversion, id generation, and the worker message.
// The PicoBoard is deliberately absent: it is the singleton board, not a
// placeable part.
export function ComponentPalette() {
  return (
    <aside
      aria-label="Component palette"
      data-testid="component-palette"
      style={{
        width: 190,
        flexShrink: 0,
        border: "1px solid #d0d0d4",
        borderRadius: 8,
        padding: "0.75rem",
        background: "#fff",
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
      }}
    >
      <h2 style={{ margin: 0, fontSize: 14 }}>Parts</h2>
      {PALETTE_ITEMS.map((item) => (
        <div
          key={item.kind}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(COMPONENT_MIME, item.kind);
            e.dataTransfer.effectAllowed = "copy";
          }}
          data-testid={`palette-${item.kind}`}
          style={{
            border: "1px solid #b8b8bc",
            borderRadius: 6,
            padding: "0.5rem",
            cursor: "grab",
            userSelect: "none",
            background: "#f7f7f9",
          }}
>
            <PalettePreview kind={item.kind} />
            <div style={{ fontWeight: 700 }}>{item.label}</div>
            <div style={{ fontSize: 11, color: "#555" }}>{item.hint}</div>
          </div>
      ))}
      <p style={{ fontSize: 11, color: "#666", margin: "0.5rem 0 0" }}>
        Drag a part onto the canvas, then click pins to wire it. Drag a part's
        body to move it. The board stays put.
      </p>
    </aside>
  );
}