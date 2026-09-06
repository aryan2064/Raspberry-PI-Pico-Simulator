import { webcrypto } from "node:crypto";

// jsdom's window.crypto may not implement randomUUID, which the engine uses to
// generate pin/component/wire ids at construction time. Prefer Node's webcrypto
// if the current global lacks randomUUID. Harmless no-op under the node/vitest
// default environment, where Node's crypto already has it.
if (
  typeof globalThis.crypto === "undefined" ||
  typeof globalThis.crypto.randomUUID !== "function"
) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

// jsdom has no PointerEvent, but the renderer's drag-to-move uses pointer
// events (so touch and mouse share one code path in real browsers). Let the
// testing-library fireEvent.pointerDown/Move/Up helpers fall back to
// jsdom's MouseEvent, which does understand clientX/clientY.
if (
  typeof window !== "undefined" &&
  typeof (window as { PointerEvent?: unknown }).PointerEvent === "undefined" &&
  typeof window.MouseEvent === "function"
) {
  (window as { PointerEvent?: typeof MouseEvent }).PointerEvent = window.MouseEvent;
}