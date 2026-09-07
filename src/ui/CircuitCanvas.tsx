import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { RenderInfo } from "../engine";
import type { ComponentKind, PinRef, SnapshotMessage, TopologyConnection } from "../execution/messages";
import type { PinMarkerStyle, PinOffsetMap, Vec } from "./types";
import { COMPONENT_MIME } from "./ComponentPalette";
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

const PIN_STYLE: Record<RenderInfo["type"], PinMarkerStyle> = {
  led: { r: 5, fill: "#888", stroke: "#555" },
  button: { r: 5, fill: "#888", stroke: "#555" },
  pico_board: { r: 4, fill: "#d8b03c", stroke: "#4a3a0a" },
};

const WIRE_COLOR = "#1f8aff";
const WIRE_HOVER_COLOR = "#0056b3";
// A wire whose net has two (or more) drivers is a live short-circuit; it must
// read as a warning, not a normal connection. Kept visibly distinct so the
// user sees the problem without needing to know the engine internals.
const WIRE_CONFLICT_COLOR = "#d81b1b";
const WIRE_CONFLICT_HOVER_COLOR = "#a40000";
const WIRE_HIT_WIDTH = 14;

// A pointer-down only becomes a drag once it travels beyond this many stage
// pixels, so a plain click (e.g. pressing the button) doesn't nudge anything.
const DRAG_THRESHOLD = 4;

// The stage is a fixed 1:1 coordinate space; the container scales it to fit
// its (flex-bounded) width with a CSS transform. The wire/pin SVG overlays
// carry the SAME scale transform (with coordinates kept in stage units), so
// pin markers and wire endpoints stay glued to the scaled bodies. All
// interaction handlers convert client coords to stage coords through the
// stage's bounding rect, so drags/drops behave correctly at any scale. The
// jsdom fallback (zero rect) passes client coords straight through.
const STAGE_W = 1200;
const STAGE_H = 700;

// The PicoBoard view is still a hand-drawn SVG (no wokwi board element
// exists); it is hosted in its own svg wrapper sized to its intrinsic dims.
const PICO_BOARD_W = 320;
const PICO_BOARD_H = 120;

function clientToStagePoint(
  stage: HTMLElement | null,
  clientX: number,
  clientY: number
): Vec {
  const rect = stage?.getBoundingClientRect();
  if (rect && rect.width > 0 && rect.height > 0) {
    return {
      x: (clientX - rect.left) * (STAGE_W / rect.width),
      y: (clientY - rect.top) * (STAGE_H / rect.height),
    };
  }
  return { x: clientX, y: clientY };
}

// Stage position of a pin = its owning component's canvas position + the
// pin's offset for that component type. This canvas renders from snapshots
// (no engine objects), so pin positions come from the id-keyed positions map.
function pinScreenPos(
  componentId: string,
  pinLabel: string,
  kind: RenderInfo["type"],
  positions: Record<string, Vec>
): Vec {
  const origin = positions[componentId] ?? { x: 0, y: 0 };
  const off = PIN_OFFSETS[kind][pinLabel] ?? { x: 0, y: 0 };
  return { x: origin.x + off.x, y: origin.y + off.y };
}

function renderComponentView(
  componentId: string,
  renderInfo: RenderInfo,
  onPress: (componentId: string) => void,
  onRelease: (componentId: string) => void,
  selected: boolean
): ReactNode {
  switch (renderInfo.type) {
    case "led":
      return <LedView key={componentId} renderInfo={renderInfo} selected={selected} />;
    case "button":
      return (
        <ButtonView
          key={componentId}
          renderInfo={renderInfo}
          selected={selected}
          onPress={() => onPress(componentId)}
          onRelease={() => onRelease(componentId)}
        />
      );
    case "pico_board":
      return (
        <svg
          key={componentId}
          width={PICO_BOARD_W}
          height={PICO_BOARD_H}
          style={{ display: "block" }}
        >
          <PicoBoardView renderInfo={renderInfo} position={{ x: 0, y: 0 }} selected={selected} />
        </svg>
      );
    default: {
      const exhaustive: never = renderInfo;
      return exhaustive;
    }
  }
}

interface CircuitCanvasProps {
  // The latest worker snapshot — the ONLY source of what gets drawn.
  snapshot: SnapshotMessage;
  // Main-thread topology record: what's wired to what. Wire segments are
  // drawn from this; endpoint positions come from PIN_OFFSETS.
  connections: TopologyConnection[];
  // Main-thread (UI-only) position per component — the worker/engine has no
  // concept of position, so the canvas never derives these from snapshots.
  positions: Record<string, Vec>;
  onConnect: (from: PinRef, to: PinRef) => void;
  onDisconnect: (wireId: string) => void;
  onPress: (componentId: string) => void;
  onRelease: (componentId: string) => void;
  onMoveComponent: (componentId: string, position: Vec) => void;
  onPlaceComponent: (position: Vec, kind: ComponentKind) => void;
  // Called when the user deletes a selected component. The canvas only tracks
  // which component is selected; the actual removal (worker message + topology
  // record + positions) belongs to the parent.
  onDeleteComponent: (componentId: string) => void;
}

export function CircuitCanvas({
  snapshot,
  connections,
  positions,
  onConnect,
  onDisconnect,
  onPress,
  onRelease,
  onMoveComponent,
  onPlaceComponent,
  onDeleteComponent,
}: CircuitCanvasProps) {
  // UI-only state: the pending wire source, the hovered wire, whether the
  // user is dragging a palette item over the canvas, and which (if any)
  // component is selected for deletion. Everything else comes from the
  // snapshot / topology / positions props — this canvas owns no engine
  // objects and never talks to the worker itself.
  const [pendingPin, setPendingPin] = useState<PinRef | null>(null);
  const [hoveredWireId, setHoveredWireId] = useState<string | null>(null);
  const [draggingOver, setDraggingOver] = useState(false);
  const [selectedComponentId, setSelectedComponentId] = useState<string | null>(null);

  // How much the fixed 1200x700 stage is scaled to fit its container width
  // (1 in jsdom, where there is no layout/ResizeObserver at all).
  const [scale, setScale] = useState(1);

  // The selected id, mirrored into a ref so the window keydown listener (which
  // is attached once) always sees the latest selection.
  const selectedIdRef = useRef<string | null>(null);
  function updateSelection(id: string | null) {
    selectedIdRef.current = id;
    setSelectedComponentId(id);
  }

  const containerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  // In-progress body drag. Pointer-down records a candidate; nothing moves
  // until the pointer travels past DRAG_THRESHOLD, so button presses and pin
  // clicks keep working untouched.
  const dragRef = useRef<{
    componentId: string;
    startStage: Vec;
    startPosition: Vec;
    moved: boolean;
  } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return undefined;
    const update = () => {
      const w = container.clientWidth;
      if (w > 0) setScale(w / STAGE_W);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  const infoByComponent = useMemo(
    () => new Map(snapshot.components.map((c) => [c.id, c.renderInfo])),
    [snapshot.components]
  );

  // Snapshot pins carry the engine's uuid for each pin; the wire topology only
  // knows `componentId:pinLabel`. This map bridges the two so a conflicted pin
  // id can be matched back to the wires that touch it.
  const pinIdByKey = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of snapshot.components) {
      for (const p of c.pins) {
        map.set(`${c.id}:${p.label}`, p.id);
      }
    }
    return map;
  }, [snapshot.components]);

  const conflictedPinIds = useMemo(
    () => new Set(snapshot.conflictedPinIds),
    [snapshot.conflictedPinIds]
  );

  // Number of connections touching at least one conflicted pin. Two fighting
  // pins are one conflicted net, but may span several visible wires (a net is
  // everything transitively connected); the banner counts connections because
  // that is what the user sees as wires.
  const conflictedWireCount = useMemo(() => {
    let count = 0;
    for (const conn of connections) {
      const aId = pinIdByKey.get(`${conn.from.componentId}:${conn.from.pinLabel}`);
      const bId = pinIdByKey.get(`${conn.to.componentId}:${conn.to.pinLabel}`);
      if (
        (aId !== undefined && conflictedPinIds.has(aId)) ||
        (bId !== undefined && conflictedPinIds.has(bId))
      ) {
        count++;
      }
    }
    return count;
  }, [connections, pinIdByKey, conflictedPinIds]);

  function handlePinClick(ref: PinRef) {
    if (pendingPin === null) {
      setPendingPin(ref);
      return;
    }
    if (pendingPin.componentId === ref.componentId && pendingPin.pinLabel === ref.pinLabel) {
      // Same pin clicked twice cancels instead of connecting to itself.
      setPendingPin(null);
      return;
    }
    onConnect(pendingPin, ref);
    setPendingPin(null);
  }

  function handleWireClick(wireId: string) {
    onDisconnect(wireId);
    setHoveredWireId(null);
  }

  // ---- body drag-to-move (pointer events; pin circles are in another layer
  //      and never trigger this) ----

  function handleBodyPointerDown(e: React.PointerEvent, componentId: string) {
    if (e.button !== 0) return; // primary button only
    dragRef.current = {
      componentId,
      startStage: clientToStagePoint(stageRef.current, e.clientX, e.clientY),
      startPosition: positions[componentId] ?? { x: 0, y: 0 },
      moved: false,
    };
  }

  function handleContainerPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const current = clientToStagePoint(stageRef.current, e.clientX, e.clientY);
    const dx = current.x - drag.startStage.x;
    const dy = current.y - drag.startStage.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.moved = true;
      // Committing to a drag cancels any button press that started on this
      // pointer-down, so a button never ends up visually stuck pressed while
      // being dragged around.
      if (infoByComponent.get(drag.componentId)?.type === "button") {
        onRelease(drag.componentId);
      }
      // Capture the pointer so moves outside the canvas still track.
      if (typeof e.currentTarget.setPointerCapture === "function") {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // ignore — e.g. jsdom / synthetic events / already-released pointer
        }
      }
    }
    onMoveComponent(drag.componentId, {
      x: drag.startPosition.x + dx,
      y: drag.startPosition.y + dy,
    });
  }

  function handleContainerPointerUp(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    if (drag.moved) {
      // Commit exactly where the pointer landed (in case no move event existed
      // for the final lift).
      const current = clientToStagePoint(stageRef.current, e.clientX, e.clientY);
      onMoveComponent(drag.componentId, {
        x: drag.startPosition.x + (current.x - drag.startStage.x),
        y: drag.startPosition.y + (current.y - drag.startStage.y),
      });
      if (typeof e.currentTarget.releasePointerCapture === "function") {
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          // ignore
        }
      }
    } else {
      // A plain click (no drag threshold crossed) selects the component body.
      // Pin clicks live in another layer and never set dragRef, so they don't
      // change the selection here.
      updateSelection(drag.componentId);
    }
  }

  function handleContainerPointerCancel() {
    dragRef.current = null;
  }

  // ---- drop (native HTML5 drag-and-drop from the palette) ----

  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDraggingOver(false);
    const kind = e.dataTransfer?.getData(COMPONENT_MIME) as ComponentKind | "";
    if (kind !== "led" && kind !== "button") return; // not a palette drop
    onPlaceComponent(clientToStagePoint(stageRef.current, e.clientX, e.clientY), kind);
  }

  // The single shared delete trigger used by both the visible Delete button
  // and the Delete/Backspace key. Does nothing when nothing is selected or the
  // selection is the PicoBoard (which is exempt from removal).
  function handleDeleteSelected() {
    const id = selectedIdRef.current;
    if (id === null) return;
    if (infoByComponent.get(id)?.type === "pico_board") return;
    // Drop any in-progress wire sourced from a pin of the deleted component.
    if (pendingPin && pendingPin.componentId === id) {
      setPendingPin(null);
    }
    onDeleteComponent(id);
    updateSelection(null);
  }

  // Latest snapshot's component type per id, so the Delete affordances know
  // whether the current selection is the (undeletable) board.
  const canDeleteSelected =
    selectedComponentId !== null &&
    infoByComponent.get(selectedComponentId) !== undefined &&
    infoByComponent.get(selectedComponentId)!.type !== "pico_board";

  // Keep a ref to handleDeleteSelected so the once-attached window listener
  // below always calls the latest closure (fresh props/state per render).
  const deleteSelectedRef = useRef<() => void>(() => {});
  deleteSelectedRef.current = handleDeleteSelected;

  useEffect(() => {
    // Delete/Backspace on the body (i.e. no canvas selection interactions in
    // focus) removes the selected component. Typing the same keys inside a
    // text field — the code editor, for example — must keep working untouched.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const el = document.activeElement;
      if (
        el instanceof HTMLElement &&
        (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      deleteSelectedRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const pendingPinId = pendingPin ? `${pendingPin.componentId}:${pendingPin.pinLabel}` : null;

  return (
    <div
      ref={containerRef}
      data-testid="circuit-canvas"
      style={{
        position: "relative",
        background: "#f7f7f9",
        border: draggingOver ? "2px dashed #1f8aff" : "1px solid #d0d0d4",
        borderRadius: 4,
        overflow: "hidden",
        height: STAGE_H * scale,
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setDraggingOver(true);
      }}
      onDragEnter={() => setDraggingOver(true)}
      onDragLeave={() => setDraggingOver(false)}
      onDrop={handleDrop}
      onClick={(e) => {
        // A click landing on the bare canvas (container or stage, not on a
        // body/pin/wire) clears the selection. Overlays are pointer-events:none
        // so empty-canvas clicks resolve their target to the stage/container.
        if (e.target === containerRef.current || e.target === stageRef.current) {
          updateSelection(null);
        }
      }}
      onPointerMove={handleContainerPointerMove}
      onPointerUp={handleContainerPointerUp}
      onPointerCancel={handleContainerPointerCancel}
    >
      {/* LAYER 1 — component bodies. HTML absolutely-positioned at stage
           coords, so each view can render a real web component (<wokwi-led>,
           <wokwi-pushbutton>) or an SVG (board). The wrapper div carries the
           drag-to-move handlers (body-only: pin circles live in layer 3). */}
      <div
        ref={stageRef}
        data-testid="circuit-stage"
        data-layer="bodies"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: STAGE_W,
          height: STAGE_H,
          transformOrigin: "top left",
          transform: scale !== 1 ? `scale(${scale})` : undefined,
        }}
      >
        {snapshot.components.map((c) => (
          <div
            key={c.id}
            data-testid={`body-${c.id}`}
            onPointerDown={(e) => handleBodyPointerDown(e, c.id)}
            style={{
              position: "absolute",
              left: positions[c.id]?.x ?? 0,
              top: positions[c.id]?.y ?? 0,
              cursor: "move",
            }}
          >
            {renderComponentView(
              c.id,
              c.renderInfo,
              onPress,
              onRelease,
              selectedComponentId === c.id
            )}
          </div>
        ))}
      </div>

      {/* LAYER 2 — wires. SVG overlay above every body, below pin markers.
           The <svg> is pointer-events:none so clicks pass through to the
           stage; only each wire group opts back in. */}
      <svg
        data-layer="wires"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: STAGE_W,
          height: STAGE_H,
          pointerEvents: "none",
          transformOrigin: "top left",
          transform: scale !== 1 ? `scale(${scale})` : undefined,
        }}
      >
        {connections.map((conn) => {
          const kindA = infoByComponent.get(conn.from.componentId)?.type;
          const kindB = infoByComponent.get(conn.to.componentId)?.type;
          if (!kindA || !kindB) return null;
          const a = pinScreenPos(conn.from.componentId, conn.from.pinLabel, kindA, positions);
          const b = pinScreenPos(conn.to.componentId, conn.to.pinLabel, kindB, positions);
          const hovered = hoveredWireId === conn.wireId;
          const aId = pinIdByKey.get(`${conn.from.componentId}:${conn.from.pinLabel}`);
          const bId = pinIdByKey.get(`${conn.to.componentId}:${conn.to.pinLabel}`);
          const conflicted =
            (aId !== undefined && conflictedPinIds.has(aId)) ||
            (bId !== undefined && conflictedPinIds.has(bId));
          return (
            <g
              key={conn.wireId}
              onClick={() => handleWireClick(conn.wireId)}
              onMouseEnter={() => setHoveredWireId(conn.wireId)}
              onMouseLeave={() => setHoveredWireId(null)}
              style={{ cursor: "pointer", pointerEvents: "auto" }}
              data-testid={`wire-${conn.wireId}`}
              data-conflicted={conflicted ? "true" : undefined}
            >
              {/* generous invisible hit area — a 1px target is too small */}
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke="transparent"
                strokeWidth={WIRE_HIT_WIDTH}
                pointerEvents="auto"
              />
              <line
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={
                  conflicted
                    ? hovered
                      ? WIRE_CONFLICT_HOVER_COLOR
                      : WIRE_CONFLICT_COLOR
                    : hovered
                      ? WIRE_HOVER_COLOR
                      : WIRE_COLOR
                }
                strokeWidth={2}
                strokeDasharray={conflicted ? "8 5" : undefined}
                pointerEvents="none"
              />
              <title>Click to remove wire</title>
            </g>
          );
        })}
      </svg>

      {/* LAYER 3 — pin markers. On top of everything. Pin labels come from the
           offset maps (pin objects live in the worker, never here). Same
           pointer-events strategy as the wires overlay. */}
      <svg
        data-layer="pins"
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: STAGE_W,
          height: STAGE_H,
          pointerEvents: "none",
          transformOrigin: "top left",
          transform: scale !== 1 ? `scale(${scale})` : undefined,
        }}
      >
        {snapshot.components.flatMap((c) => {
          const offsets = PIN_OFFSETS[c.renderInfo.type];
          const style = PIN_STYLE[c.renderInfo.type];
          return Object.keys(offsets).map((label) => {
            const pos = pinScreenPos(c.id, label, c.renderInfo.type, positions);
            const isPending = pendingPinId === `${c.id}:${label}`;
            return (
              <g
                key={`${c.id}:${label}`}
                transform={`translate(${pos.x} ${pos.y})`}
                onClick={() => handlePinClick({ componentId: c.id, pinLabel: label })}
                style={{ cursor: "pointer", pointerEvents: "auto" }}
                data-testid={`pin-${c.id}-${label}`}
              >
                <circle
                  r={style.r}
                  fill={isPending ? "#ffd500" : style.fill}
                  stroke={style.stroke}
                  strokeWidth={1}
                />
                <title>{label}</title>
              </g>
            );
          });
        })}
      </svg>

      {conflictedWireCount > 0 && (
        <div
          role="status"
          data-testid="conflict-banner"
          style={{
            marginTop: "0.5rem",
            padding: "0.4rem 0.75rem",
            background: "#ffe3e3",
            color: "#a40000",
            border: "1px solid #a40000",
            borderRadius: 4,
            fontWeight: 600,
          }}
        >
          ⚠{" "}
          {conflictedWireCount === 1
            ? "1 wire conflict"
            : `${conflictedWireCount} wire conflicts`}{" "}
          — multiple outputs are driving the same connection
        </div>
      )}
      {canDeleteSelected && (
        <button
          data-testid="delete-component"
          onClick={handleDeleteSelected}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            padding: "0.35rem 0.75rem",
            background: "#ffe3e3",
            border: "1px solid #a40000",
            borderRadius: 4,
            color: "#a40000",
            fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Delete
        </button>
      )}
    </div>
  );
}