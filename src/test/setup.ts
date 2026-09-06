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