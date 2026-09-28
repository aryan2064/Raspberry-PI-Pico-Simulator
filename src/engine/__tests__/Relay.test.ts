import { describe, it, expect, beforeEach } from "vitest";
import { Circuit, PicoBoard, Relay, LED } from "../index";

// State-driven internal connection -> ALL contact-swap tests drive the control
// input over an actual wire (net merge/split) and then step the circuit. Per
// Circuit.tick()'s ordering the flip takes two ticks:
//   tick 1: nets grouped with the OLD contact; propagate; relay.update() sees
//           the fresh `in` value and flips `energized`; propagate.
//   tick 2: nets grouped with the NEW contact; propagate.
describe("Relay (in/vcc/gnd/com/no/nc, state-driven SPDT)", () => {
  let circuit: Circuit;
  let board: PicoBoard;
  let relay: Relay;
  let led: LED;

  beforeEach(() => {
    circuit = new Circuit();
    board = new PicoBoard();
    relay = new Relay();
    led = new LED();
    circuit.addComponent(board);
    circuit.addComponent(relay);
    circuit.addComponent(led);
  });

  it("is de-energized by default: com–nc closed, com–no open", () => {
    circuit.resolveNets();
    expect(relay.getRenderInfo()).toEqual({ type: "relay", energized: false });
    // The SPDT contact is always EXACTLY one pair — never zero, never both.
    expect(relay.pin("com").netId).toBe(relay.pin("nc").netId);
    expect(relay.pin("com").netId).not.toBe(relay.pin("no").netId);
    expect(relay.pin("com").netId).not.toBe(relay.pin("in").netId);
    expect(relay.pin("com").netId).not.toBe(relay.pin("vcc").netId);
    expect(relay.pin("com").netId).not.toBe(relay.pin("gnd").netId);
  });

  it("energizes com–no and BREAKS the old com–nc path when in goes HIGH", () => {
    // Control input driven by GPIO16; both switch rails sensing via GPIO pins.
    circuit.connect(board.pin("3V3_OUT"), relay.pin("com"));
    circuit.connect(relay.pin("no"), board.pin("GPIO0"));
    circuit.connect(relay.pin("nc"), board.pin("GPIO1"));
    circuit.connect(board.pin("GPIO16"), relay.pin("in"));
    circuit.resolveNets();

    board.pin("GPIO16").mode = "OUT";
    board.pin("GPIO0").mode = "IN";
    board.pin("GPIO1").mode = "IN";

    // At rest the coil is off: com–nc closed, so the nc rail reads 3V3_OUT.
    circuit.tick(1 / 60);
    expect(board.pin("GPIO1").value).toBe("HIGH");
    expect(board.pin("GPIO0").value).toBe("FLOATING");
    expect(relay.getRenderInfo()).toEqual({ type: "relay", energized: false });

    board.pin("GPIO16").value = "HIGH";
    circuit.resolveNow(); // propagates to `in` (relay.update has NOT run yet)
    circuit.tick(1 / 60);
    // First tick: nets were grouped with the OLD contact — nc still pulled.
    expect(board.pin("GPIO1").value).toBe("HIGH");
    expect(relay.getRenderInfo()).toEqual({ type: "relay", energized: true });

    circuit.tick(1 / 60);
    // Second tick: com–no merged, com–nc SPLIT. The nc net lost its rail ->
    // GPIO1 falls back to FLOATING; the no net gains it -> GPIO0 HIGH.
    expect(board.pin("GPIO1").value).toBe("FLOATING");
    expect(board.pin("GPIO0").value).toBe("HIGH");
    expect(relay.pin("com").netId).toBe(relay.pin("no").netId);
    expect(relay.pin("com").netId).not.toBe(relay.pin("nc").netId);
  });

  it("de-energizing restores com–nc and drops com–no (reverse switch)", () => {
    circuit.connect(board.pin("3V3_OUT"), relay.pin("com"));
    circuit.connect(relay.pin("no"), board.pin("GPIO0"));
    circuit.connect(relay.pin("nc"), board.pin("GPIO1"));
    circuit.connect(board.pin("GPIO16"), relay.pin("in"));
    circuit.resolveNets();
    board.pin("GPIO16").mode = "OUT";
    board.pin("GPIO0").mode = "IN";
    board.pin("GPIO1").mode = "IN";

    board.pin("GPIO16").value = "HIGH";
    circuit.resolveNow();
    circuit.tick(1 / 60);
    circuit.tick(1 / 60);
    expect(board.pin("GPIO0").value).toBe("HIGH");
    expect(board.pin("GPIO1").value).toBe("FLOATING");

    board.pin("GPIO16").value = "LOW";
    circuit.resolveNow();
    circuit.tick(1 / 60);
    circuit.tick(1 / 60);
    // Contacts returned: nc rail reads HIGH again, no net is dead.
    expect(board.pin("GPIO0").value).toBe("FLOATING");
    expect(board.pin("GPIO1").value).toBe("HIGH");
    expect(relay.getRenderInfo()).toEqual({ type: "relay", energized: false });
  });

  it("end-to-end demo: GPIO energization switches a rail to a second LED", () => {
    //   GPIO16(OUT) -> relay.in
    //   3V3_OUT      -> relay.com
    //   relay.no     -> LED2.anode
    //   relay.nc     -> GPIO10(IN, pull DOWN)
    //   LED2.cathode -> GND
    circuit.connect(board.pin("GPIO16"), relay.pin("in"));
    circuit.connect(board.pin("3V3_OUT"), relay.pin("com"));
    circuit.connect(relay.pin("no"), led.pin("anode"));
    circuit.connect(relay.pin("nc"), board.pin("GPIO10"));
    circuit.connect(led.pin("cathode"), board.pin("GND"));
    circuit.resolveNets();
    board.pin("GPIO16").mode = "OUT";
    board.pin("GPIO10").mode = "IN";
    board.pin("GPIO10").pull = "DOWN";

    circuit.tick(1 / 60);
    // Coil off: com–nc is closed, so 3V3_OUT reaches the nc GPIO (active
    // driver beats the pull-down); LED2 sits on the dead `no` net -> off.
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: false, brightness: 0 });
    expect(board.pin("GPIO10").value).toBe("HIGH");

    board.pin("GPIO16").value = "HIGH";
    circuit.resolveNow();
    circuit.tick(1 / 60);
    circuit.tick(1 / 60);
    // Energized: com–no merges 3V3_OUT onto the LED anode net -> lit. The
    // com–nc split STRANDED GPIO10 (now just its own net) -> pull-down LOW.
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: true, brightness: 1 });
    expect(board.pin("GPIO10").value).toBe("LOW");

    board.pin("GPIO16").value = "LOW";
    circuit.resolveNow();
    circuit.tick(1 / 60);
    circuit.tick(1 / 60);
    // De-energized: LED2 dark again, nc reconnected to the rail -> HIGH.
    expect(led.getRenderInfo()).toEqual({ type: "led", isOn: false, brightness: 0 });
    expect(board.pin("GPIO10").value).toBe("HIGH");
  });

  it("ignores vcc/gnd/coil wiring: the control input alone sets the contacts", () => {
    // vcc tied to a rail, gnd tied to a rail — the coil channel is inert, so
    // with `in` FLOATING the relay must stay de-energized (no coil modeling).
    circuit.connect(board.pin("3V3_OUT"), relay.pin("vcc"));
    circuit.connect(relay.pin("gnd"), board.pin("GPIO0"));
    circuit.resolveNets();
    board.pin("GPIO0").mode = "OUT";
    board.pin("GPIO0").value = "LOW";

    circuit.tick(1 / 60);
    circuit.tick(1 / 60);
    expect(relay.getRenderInfo()).toEqual({ type: "relay", energized: false });
    expect(relay.pin("com").netId).toBe(relay.pin("nc").netId);
  });
});