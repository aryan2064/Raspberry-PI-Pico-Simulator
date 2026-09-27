import { Component, newId } from "../Component";
import type { RenderInfo } from "../RenderInfo";

// LED with a brightness channel: driven by the "anode" pin's digital value
// and/or its analogValue (0..1). A non-null analogValue (set by machine.PWM
// via the duty channel) wins over the digital value — that's what a dimmed
// PWM-driven LED is made of. When the analog channel is absent the LED is
// the plain on/off device it always was: HIGH -> brightness 1, otherwise 0.
export class LED extends Component {
  private brightness = 0;

  constructor(id?: string) {
    super(id ?? `led-${newId()}`);
    this.addPin("anode", "IN"); // connects to a GPIO pin (driver)
    this.addPin("cathode", "IN"); // connects to GND — not used in logic yet
  }

  update(_dt: number): void {
    const anode = this.pin("anode");
    const analog = anode.analogValue;
    const brightness = analog !== null ? analog : anode.value === "HIGH" ? 1 : 0;
    this.brightness = Math.min(1, Math.max(0, brightness));
  }

  getRenderInfo(): RenderInfo {
    return { type: "led", isOn: this.brightness > 0, brightness: this.brightness };
  }
}