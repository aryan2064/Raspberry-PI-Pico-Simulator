import { Component, newId } from "../Component";
import type { RenderInfo } from "../RenderInfo";

// Minimal LED: on/off only, driven directly by whatever its "anode" pin
// reads. No brightness, no color, no resistor math — add those later,
// only if/when actually needed.
export class LED extends Component {
  private isOn = false;

  constructor(id?: string) {
    super(id ?? `led-${newId()}`);
    this.addPin("anode", "IN"); // connects to a GPIO pin (driver)
    this.addPin("cathode", "IN"); // connects to GND — not used in logic yet
  }

  update(_dt: number): void {
    this.isOn = this.pin("anode").value === "HIGH";
  }

  getRenderInfo(): RenderInfo {
    return { type: "led", isOn: this.isOn };
  }
}
