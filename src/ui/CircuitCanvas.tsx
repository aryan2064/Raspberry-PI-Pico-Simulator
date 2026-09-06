import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { Button, Component, Pin, Circuit, RenderInfo } from "../engine";
import type { PinMarkerStyle, PinOffsetMap, Vec } from "./types";
import { ButtonView, buttonPinOffsets } from "./components/ButtonView";
import { LedView, ledPinOffsets } from "./components/LedView";
import { PicoBoardView, picoPinOffsets } from "./components/PicoBoardView";

// One entry per RenderInfo variant. Adding a new component type means adding
// a key here — a compile error if forgotten, same as in the render switch.
const PIN_OFFSETS: Record<RenderInfo["type"], PinOffsetMap> = {
  led: ledPinOffsets,
  button: buttonPinOffsets,
  pico_board: picoPinOffsets,
};

// Pin marker appearance per component type (drawn centrally in the pins layer).
const PIN_STYLE: Record<RenderInfo["type"], PinMarkerStyle> = {
  led: { r: 5, fill: "#888", stroke: "#555" },
  button: { r: 5, fill: "#888", stroke: "#555" },
  pico_board: { r: 4, fill: "#d8b03c", stroke: "#4a3a0a" },
};

const WIRE_COLOR = "#1f8aff";
const WIRE_HOVER_COLOR = "#0056b3";
const WIRE_HIT_WIDTH = 14; // generously wide invisible line for easier clicking

// Simple fixed grid layout — drag-to-move is a follow-up, per the canvas spec.
function initialPositions(components: Component[]): Record<string, Vec> {
  const positions: Record<string, Vec> = {};
  components.forEach((c, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    positions[c.id] = { x: 40 + col * 360, y: 40 + row * 200 };
  });
  return positions;
}

// Screen position of a pin = its owning component's current canvas position
// + the pin's offset for that component type. Recomputed each render.
function pinScreenPos(pin: Pin, positions: Record<string, Vec>): Vec {
  const origin = positions[pin.owner.id] ?? { x: 0, y: 0 };
  const off = PIN_OFFSETS[pin.owner.getRenderInfo().type][pin.label] ?? { x: 0, y: 0 };
  return { x: origin.x + off.x, y: origin.y + off.y };
}

// Dispatches on the discriminated RenderInfo union. The `default` branch is
// unreachable today; if a new component type is added without a case here,
// TypeScript makes the assignment to `never` a compile error. Views render
// bodies only — pin markers live in their own layer (see render() below).
function renderComponentView(component: Component, position: Vec): ReactNode {
  const info = component.getRenderInfo();
  switch (info.type) {
    case "led":
      return <LedView key={component.id} renderInfo={info} position={position} />;
    case "button":
      return (
        <ButtonView
          key={component.id}
          component={component as Button}
          renderInfo={info}
          position={position}
        />
      );
    case "pico_board":
      return <PicoBoardView key={component.id} renderInfo={info} position={position} />;
    default: {
      const exhaustive: never = info;
      return exhaustive;
    }
  }
}

interface CircuitCanvasProps {
  circuit: Circuit;
}

export function CircuitCanvas({ circuit }: CircuitCanvasProps) {
  // UI-only state: canvas positions, the pending wire's source pin, and the
  // hovered wire. Everything else (components, pins, wires, values) is read
  // from the engine each render — never duplicated here as a source of truth.
  const [positions] = useState<Record<string, Vec>>(() =>
    initialPositions(circuit.components)
  );
  const [pendingPin, setPendingPin] = useState<Pin | null>(null);
  const [hoveredWireId, setHoveredWireId] = useState<string | null>(null);
  const [, setFrame] = useState(0);

  // ~60fps simulation loop: tick the engine, force a re-render so
  // getRenderInfo() is re-read every frame.
  useEffect(() => {
    const id = setInterval(() => {
      circuit.tick(1 / 60);
      setFrame((f) => f + 1);
    }, 1000 / 60);
    return () => clearInterval(id);
  }, [circuit]);

  function handlePinClick(pin: Pin) {
    if (pendingPin === null) {
      setPendingPin(pin);
      return;
    }
    if (pendingPin.id === pin.id) {
      // Same pin clicked twice cancels instead of connecting to itself.
      setPendingPin(null);
      return;
    }
    circuit.connect(pendingPin, pin);
    circuit.resolveNets();
    setPendingPin(null);
  }

  function handleWireClick(wireId: string) {
    circuit.disconnect(wireId);
    circuit.resolveNets();
    setHoveredWireId(null);
    setFrame((f) => f + 1);
  }

  const pendingPinId = pendingPin?.id ?? null;

  return (
    <svg
      width="100%"
      height="720"
      viewBox="0 0 1200 700"
      style={{ background: "#f7f7f9", border: "1px solid #d0d0d4" }}
    >
      {/* LAYER 1 — component bodies. Drawn first; wires go on top. */}
      <g data-layer="bodies">
        {circuit.components.map((c) =>
          renderComponentView(c, positions[c.id] ?? { x: 0, y: 0 })
        )}
      </g>

      {/* LAYER 2 — wires. Above every body so a wire is never hidden behind a
          component; below pin markers so pins stay clickable. Clicking a wire
          removes it. */}
      <g data-layer="wires">
        {circuit.wires.map((w) => {
          const a = pinScreenPos(w.a, positions);
          const b = pinScreenPos(w.b, positions);
          const hovered = hoveredWireId === w.id;
          return (
            <g
              key={w.id}
              onClick={() => handleWireClick(w.id)}
              onMouseEnter={() => setHoveredWireId(w.id)}
              onMouseLeave={() => setHoveredWireId(null)}
              style={{ cursor: "pointer" }}
              data-testid={`wire-${w.id}`}
            >
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="transparent"
                strokeWidth={WIRE_HIT_WIDTH}
              />
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={hovered ? WIRE_HOVER_COLOR : WIRE_COLOR}
                strokeWidth={2}
                pointerEvents="none"
              />
              <title>Click to remove wire</title>
            </g>
          );
        })}
      </g>

      {/* LAYER 3 — pin markers. On top of everything so they stay visible and
          clickable. */}
      <g data-layer="pins">
        {circuit.components.flatMap((c) => {
          const style = PIN_STYLE[c.getRenderInfo().type];
          return c.pins.map((pin) => {
            const pos = pinScreenPos(pin, positions);
            return (
              <g
                key={pin.id}
                transform={`translate(${pos.x} ${pos.y})`}
                onClick={() => handlePinClick(pin)}
                style={{ cursor: "pointer" }}
                data-testid={`pin-${pin.id}`}
              >
                <circle
                  r={style.r}
                  fill={pendingPinId === pin.id ? "#ffd500" : style.fill}
                  stroke={style.stroke}
                  strokeWidth={1}
                />
                <title>{`${pin.label} (${pin.value})`}</title>
              </g>
            );
          });
        })}
      </g>
    </svg>
  );
}