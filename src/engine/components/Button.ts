import { Component, newId } from "../Component";
import type { RenderInfo } from "../RenderInfo";

// A push button: it drives its "signal" pin HIGH while pressed, LOW while
// released. The press/release methods are how the UI (or tests) trigger
// interaction — they are not part of the abstract Component base, since
// not every component is user-interactive.
export class Button extends Component {
  private pressed = false;

  constructor(id?: string) {
    super(id ?? `button-${newId()}`);
    this.addPin("signal", "OUT"); // a button drives its signal pin
  }

  update(_dt: number): void {
    this.pin("signal").value = this.pressed ? "HIGH" : "LOW";
  }

  getRenderInfo(): RenderInfo {
    return { type: "button", isPressed: this.pressed };
  }

  press(): void {
    this.pressed = true;
  }

  release(): void {
    this.pressed = false;
  }
}