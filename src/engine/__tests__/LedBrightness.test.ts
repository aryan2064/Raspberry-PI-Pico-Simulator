import { describe, it, expect, beforeEach } from "vitest";
import { Circuit, PicoBoard, LED } from "../index";

// LED brightness channel, driven by the anode pin's analogValue (set by
// machine.PWM duty via the bridge) or, in its absence, the plain digital
// value. Digital HIGH/LOW must keep behaving exactly as before (regression),
// and deinit-equivalent (clearing analogValue back to null) returns to that
// digital fallback.
describe("LED brightness channel", () => {
  let circuit: Circuit;
  let board: PicoBoard;
  let led: LED;

  beforeEach(() => {
    circuit = new Circuit();
    board = new PicoBoard();
    led = new LED();
    circuit.addComponent(board);
    circuit.addComponent(led);
    circuit.connect(board.pin("GPIO15"), led.pin("anode"));
    circuit.resolveNets();
  });

  it("plain digital HIGH still reports brightness 1 / isOn (regression)", () => {
    board.pin("GPIO15").mode = "OUT";
    board.pin("GPIO15").value = "HIGH";
    board.pin("GPIO15").analogValue = null;
    circuit.tick(1 / 60);
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: true, brightness: 1 });
  });

  it("plain digital LOW still reports brightness 0 / off (regression)", () => {
    board.pin("GPIO15").mode = "OUT";
    board.pin("GPIO15").value = "LOW";
    board.pin("GPIO15").analogValue = null;
    circuit.tick(1 / 60);
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: false, brightness: 0 });
  });

  it("reports the analogValue as brightness when it is set (PWM duty ~25%)", () => {
    board.pin("GPIO15").mode = "OUT";
    board.pin("GPIO15").value = "LOW";
    board.pin("GPIO15").analogValue = 0.25;
    circuit.tick(1 / 60);
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: true, brightness: 0.25 });
  });

  it("full duty → brightness 1; zero duty → off (still isOn: false)", () => {
    board.pin("GPIO15").mode = "OUT";
    board.pin("GPIO15").value = "LOW";

    board.pin("GPIO15").analogValue = 1;
    circuit.tick(1 / 60);
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: true, brightness: 1 });

    board.pin("GPIO15").analogValue = 0;
    circuit.tick(1 / 60);
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: false, brightness: 0 });
  });

  it("the analog channel wins over the digital value (dim/duty side of the pair)", () => {
    board.pin("GPIO15").mode = "OUT";
    board.pin("GPIO15").value = "HIGH"; // digitally HIGH, dimmed by duty
    board.pin("GPIO15").analogValue = 0.5;
    circuit.tick(1 / 60);
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: true, brightness: 0.5 });
  });

  it("clearing the analog channel (PWM.deinit() equivalent) returns to the digital fallback", () => {
    board.pin("GPIO15").mode = "OUT";
    board.pin("GPIO15").value = "LOW";
    board.pin("GPIO15").analogValue = 0.7;
    circuit.tick(1 / 60);
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: true, brightness: 0.7 });

    board.pin("GPIO15").analogValue = null;
    circuit.tick(1 / 60);
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: false, brightness: 0 });
  });
});