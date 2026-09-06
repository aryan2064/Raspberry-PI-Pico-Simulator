import { Component, newId } from "../Component";
import type { RenderInfo } from "../RenderInfo";

// The Pico board itself — a component like any other, just with a lot of
// pins and no interesting update() logic of its own. The eventual
// `machine.Pin` shim will read/write these pins directly by label.
export class PicoBoard extends Component {
  constructor(id?: string) {
    super(id ?? `board-${newId()}`);
    // Real Pico has GPIO0-GPIO28 (minus a few reserved ones) — using the
    // full simple range for now, refine later against the real pinout.
    for (let i = 0; i <= 28; i++) {
      this.addPin(`GPIO${i}`, "UNSET"); // mode gets set by user code (IN/OUT) at runtime
    }
    this.addPin("3V3", "OUT").value = "HIGH"; // always-on power pin
    this.addPin("GND", "OUT").value = "LOW"; // always-on ground
  }

  update(_dt: number): void {
    // The board itself doesn't "do" anything each tick — it's a passive
    // provider of pins. GPIO pin values get set externally by the
    // machine.Pin shim when user code calls pin.value(1) etc.
  }

  getRenderInfo(): RenderInfo {
    return { type: "pico_board" };
  }
}
