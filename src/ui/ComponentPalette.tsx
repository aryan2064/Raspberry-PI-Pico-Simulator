import type { ComponentKind } from "../execution/messages";

// Custom MIME type used for palette -> canvas native-drag payloads. Using a
// non-standard type (rather than e.g. "text/plain") keeps unrelated page
// drops (links, files, selected text) from being misread as placements.
export const COMPONENT_MIME = "application/x-pico-component";

type PaletteKind = Extract<ComponentKind, "led" | "button">;

const PALETTE_ITEMS: Array<{ kind: PaletteKind; label: string; hint: string }> = [
  { kind: "led", label: "LED", hint: "anode / cathode" },
  { kind: "button", label: "Button", hint: "signal HIGH while pressed" },
];

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