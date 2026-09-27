import { describe, it, expect, beforeEach } from "vitest";
import { Circuit, PicoBoard, LED } from "../index";

// The PicoBoard's pin set must mirror the real Raspberry Pi Pico 40-pin
// header (official board doc + Zephyr rpi-pico device-tree binding): 26 GPIOs
// (GP0-GP22, then GP26-GP28), 8 tied ground pads, and the non-GPIO pins.
describe("PicoBoard real-header pin set", () => {
  let board: PicoBoard;

  beforeEach(() => {
    board = new PicoBoard();
  });

  it("has exactly 40 pins: 26 GPIOs (no GP23/24/25), 8 GND, 6 non-GPIO", () => {
    expect(board.pins).toHaveLength(40);

    const gpios = board.pins.map((p) => p.label).filter((l) => l.startsWith("GPIO"));
    expect(gpios).toHaveLength(26);
    for (const n of [...Array(23).keys(), 26, 27, 28]) {
      expect(board.pin(`GPIO${n}`).label).toBe(`GPIO${n}`);
    }
    // GP23/24/25 exist on the die but are not exposed on the header.
    expect(() => board.pin("GPIO23")).toThrow(/no pin labeled "GPIO23"/);
    expect(() => board.pin("GPIO24")).toThrow(/no pin labeled "GPIO24"/);
    expect(() => board.pin("GPIO25")).toThrow(/no pin labeled "GPIO25"/);
  });

  it("exposes the real non-GPIO rail pins (VBUS/VSYS/3V3_EN/3V3_OUT/ADC_VREF/RUN)", () => {
    for (const label of ["VBUS", "VSYS", "3V3_EN", "3V3_OUT", "ADC_VREF", "RUN"]) {
      expect(board.pin(label).label).toBe(label);
    }
    // The historic "3V3" engine label was renamed to the real header name.
    expect(() => board.pin("3V3")).toThrow(/no pin labeled "3V3"/);
  });

  it("shows the 8 ground pads as GND + GND_1..GND_7", () => {
    const grounds = ["GND", ...Array.from({ length: 7 }, (_, i) => `GND_${i + 1}`)];
    for (const label of grounds) {
      expect(board.pin(label).label).toBe(label);
    }
  });

  it("defaults modes to match the real pads: rails driven, everything else UNSET", () => {
    expect(board.pin("GND").mode).toBe("OUT");
    expect(board.pin("GND").value).toBe("LOW");
    expect(board.pin("3V3_OUT").mode).toBe("OUT");
    expect(board.pin("3V3_OUT").value).toBe("HIGH");
    for (const label of ["GPIO0", "GPIO15", "GPIO28", "GND_1", "GND_7"]) {
      expect(board.pin(label).mode).toBe("UNSET");
    }
    for (const label of ["VBUS", "VSYS", "3V3_EN", "ADC_VREF", "RUN"]) {
      expect(board.pin(label).mode).toBe("UNSET");
    }
  });
});

describe("PicoBoard ground plane (HasInternalConnections)", () => {
  let circuit: Circuit;
  let board: PicoBoard;
  let led: LED;

  beforeEach(() => {
    circuit = new Circuit();
    board = new PicoBoard();
    led = new LED();
    circuit.addComponent(board);
    circuit.addComponent(led);
  });

  it("ties all 8 GND pads into one net with no wire", () => {
    circuit.resolveNets();
    const netIds = new Set(["GND", ...Array.from({ length: 7 }, (_, i) => `GND_${i + 1}`)]
      .map((label) => board.pin(label).netId));
    expect(netIds.size).toBe(1);
  });

  it("wiring a LED cathode to any GND pad grounds it identically", () => {
    for (const label of ["GND", "GND_1", "GND_4", "GND_7"]) {
      for (const w of [...circuit.wires]) circuit.disconnect(w.id);
      circuit.connect(board.pin("GPIO16"), led.pin("anode"));
      circuit.connect(board.pin(label), led.pin("cathode"));
      circuit.tick(1 / 60);
      // The cathode (an IN listener) sees the ground net's LOW regardless of
      // which physical GND pad the wire lands on.
      expect(led.pin("cathode").value).toBe("LOW");
      // Exactly one driver (the "GND" OUT pin) on the ground net -> no
      // multi-driver conflict flag anywhere across the plane.
      expect(board.pin("GND_1").hasConflict).toBe(false);
      expect(board.pin("GND_7").hasConflict).toBe(false);
      expect(led.pin("cathode").hasConflict).toBe(false);
    }
  });

  it("an IN pin wired to any GND pad reads LOW", () => {
    board.pin("GPIO0").mode = "IN";
    board.pin("GPIO1").mode = "IN";
    circuit.connect(board.pin("GND_5"), board.pin("GPIO0"));
    circuit.connect(board.pin("GPIO0"), board.pin("GPIO1"));
    circuit.tick(1 / 60);
    expect(board.pin("GPIO0").value).toBe("LOW");
    expect(board.pin("GPIO1").value).toBe("LOW");
  });
});