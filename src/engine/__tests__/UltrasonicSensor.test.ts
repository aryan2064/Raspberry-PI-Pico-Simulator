import { describe, it, expect, beforeEach } from "vitest";
import { Circuit, PicoBoard, UltrasonicSensor } from "../index";

// UltrasonicSensor test wiring: `trig` is driven by a board GPIO configured
// OUT (the MicroPython TRIG writer) and `echo` is read by a board GPIO
// configured IN (the ECHO listener), both over real wires. The rising edge on
// trig is detected during circuit.tick()'s update pass, and the echo duration
// is pure accumulated dt, so the sensor's own pins are the source of truth.

function wireSensor(
  circuit: Circuit,
  board: PicoBoard,
  sensor: UltrasonicSensor,
  trigGpio = 0,
  echoGpio = 1
): void {
  board.pin(`GPIO${trigGpio}`).mode = "OUT"; // drives TRIG
  board.pin(`GPIO${echoGpio}`).mode = "IN"; // listens to ECHO
  circuit.connect(sensor.pin("trig"), board.pin(`GPIO${trigGpio}`));
  circuit.connect(sensor.pin("echo"), board.pin(`GPIO${echoGpio}`));
  circuit.resolveNets();
}

function raiseTrig(board: PicoBoard, circuit: Circuit, gpio = 0): void {
  board.pin(`GPIO${gpio}`).value = "HIGH";
  // A zero-dt tick detects the rising edge without advancing the echo (the
  // edge is treated as occurring dt before update; dt=0 starts at 0 elapsed).
  circuit.tick(0);
}

// Drives a full measure cycle for a target and returns the measured echo
// duration in µs (the accumulated dt from the rising edge until echo drops
// LOW), or 0 if the echo never went HIGH.
function measureEchoUs(
  circuit: Circuit,
  board: PicoBoard,
  sensor: UltrasonicSensor,
  distanceCm: number | null,
  dtUs = 1,
  gpio = 0
): number {
  sensor.setSimulatedDistance(distanceCm);
  // Force a clean LOW baseline first (falling edge + zero-dt tick) so a
  // re-measure on the same run always produces a fresh rising edge even if
  // the previous pulse left trig HIGH.
  board.pin(`GPIO${gpio}`).value = "LOW";
  circuit.tick(0);
  circuit.resolveNets();
  raiseTrig(board, circuit, gpio);

  let us = 0;
  // Cap well past the 400cm max (23.2ms): a null/out-of-range target never
  // raises an echo, and this loop must terminate.
  for (let i = 0; i < 60000; i += 1) {
    if (sensor.pin("echo").value === "LOW") break;
    circuit.tick(dtUs / 1e6);
    us += dtUs;
  }
  return us;
}

describe("UltrasonicSensor (HC-SR04 TRIG/ECHO)", () => {
  let circuit: Circuit;
  let board: PicoBoard;
  let sensor: UltrasonicSensor;

  beforeEach(() => {
    circuit = new Circuit();
    board = new PicoBoard("board");
    sensor = new UltrasonicSensor("sensor");
    circuit.addComponent(board);
    circuit.addComponent(sensor);
  });

  it("idles LOW: pins are vcc/gnd (UNSET) + trig (IN) + echo (OUT), no distance", () => {
    expect(sensor.pin("vcc").mode).toBe("UNSET");
    expect(sensor.pin("gnd").mode).toBe("UNSET");
    expect(sensor.pin("trig").mode).toBe("IN");
    expect(sensor.pin("echo").mode).toBe("OUT");
    // A sensor output idles LOW, never floating.
    expect(sensor.pin("echo").value).toBe("LOW");
    expect(sensor.getRenderInfo()).toEqual({
      type: "ultrasonic",
      measuring: false,
      simulatedDistanceCm: null,
    });
  });

  it("echo stays HIGH for exactly 58µs/cm and drops LOW (10cm ~ 580µs)", () => {
    wireSensor(circuit, board, sensor);
    const us = measureEchoUs(circuit, board, sensor, 10);
    expect(us).toBeGreaterThan(580 - 5);
    expect(us).toBeLessThan(580 + 5);
    expect(sensor.getRenderInfo()).toEqual({
      type: "ultrasonic",
      measuring: false,
      simulatedDistanceCm: 10,
    });
    // The listening GPIO followed ECHO over the wire the whole way.
    expect(board.pin("GPIO1").value).toBe("LOW");
  });

  it("echo duration scales linearly with distance (100cm ~ 5800µs, 400cm ~ 23200µs)", () => {
    wireSensor(circuit, board, sensor);

    const us100 = measureEchoUs(circuit, board, sensor, 100);
    expect(us100).toBeGreaterThan(5800 - 5);
    expect(us100).toBeLessThan(5800 + 5);

    // Re-measure (measureEchoUs re-arms trig LOW->HIGH itself); the 400cm
    // boundary is in range, so a new echo comes back after ~23.2ms.
    const us400 = measureEchoUs(circuit, board, sensor, 400);
    expect(us400).toBeGreaterThan(23200 - 5);
    expect(us400).toBeLessThan(23200 + 5);
  });

  it("a null distance (no object) never raises an echo", () => {
    wireSensor(circuit, board, sensor);
    const us = measureEchoUs(circuit, board, sensor, null);
    expect(us).toBe(0);
    expect(sensor.getRenderInfo().type).toBe("ultrasonic");
    expect(board.pin("GPIO1").value).toBe("LOW");
  });

  it("out-of-range distances (1cm, 500cm) never raise an echo", () => {
    wireSensor(circuit, board, sensor);
    expect(measureEchoUs(circuit, board, sensor, 1)).toBe(0);
    expect(measureEchoUs(circuit, board, sensor, 500)).toBe(0);
  });

  it("a retrigger mid-echo is ignored — the original pulse is not restarted", () => {
    wireSensor(circuit, board, sensor);
    sensor.setSimulatedDistance(100); // 5800µs echo
    circuit.resolveNets();
    raiseTrig(board, circuit); // t=0

    // 1000µs in, force trig LOW then HIGH again (a second TRIG rise).
    for (let i = 0; i < 1000; i += 1) circuit.tick(1e-6);
    board.pin("GPIO0").value = "LOW";
    circuit.tick(0);
    board.pin("GPIO0").value = "HIGH";
    circuit.tick(0);

    // The pulse must still end ~5800µs after the FIRST edge, not 5800µs after
    // the ignored retrigger (which would be ~6800µs).
    let us = 1000;
    while (sensor.pin("echo").value === "HIGH" && us < 60000) {
      circuit.tick(1e-6);
      us += 1;
    }
    expect(us).toBeGreaterThan(5800 - 5);
    expect(us).toBeLessThan(5800 + 5);
  });

  it("setSimulatedDistance() updates the next pulse's duration (stimulus change)", () => {
    wireSensor(circuit, board, sensor);
    const us = measureEchoUs(circuit, board, sensor, 300);
    expect(us).toBeGreaterThan(17400 - 5);
    expect(us).toBeLessThan(17400 + 5);
  });
});