import type { PinOffsetMap, Vec } from "../types";
import picoBreadboardUrl from "../assets/pico-breadboard.svg";

// The board artwork is Raspberry Pi's official Fritzing breadboard part for
// the original Pico (Pico-R3-Fritzing, from pip.raspberrypi.com/documents/
// RP-008310-DS), shipped here as a static asset. The asset has Raspberry Pi's
// own drawing baked in as a <g transform="matrix(0 0.16 0.16 0 0 0)"> around
// its native portrait 0.827" x 2.087" drawing: the matrix swaps the axes
// (long edge -> horizontal, so the USB end lands on the right). The old build
// rendered it at 0.16 per Fritzing unit (0.100" pad pitch = 16 stage units),
// which made the board render at ~6.3 px/mm — bigger than every Wokwi element.
//
// REAL-SIZE SCALING: the board is 2.087" x 0.827" = 53.01 x 21.0mm (official
// Pico dimensioned drawing, RP-008310-DS, also the Fritzing part's own size).
// At the shared Wokwi-calibrated scale of 3.78 px/mm (docs/DECISIONS.md
// "Shared component scale") the long edge renders 200.38 px, and the baked
// pin matrix maps each 0.100" pad pitch to 2.54mm = 9.6012 stage px — the same
// pad pitch the Wokwi-native parts use (e.g. stepper, 9.6012 px per 0.1in).
// SIZE KNOB: rendered long-edge width in mm (2.087" = 53.01mm). Raise it to
// scale the whole board up uniformly for human legibility — the SCALE below
// follows it so every pad stays glued to the art (docs/DECISIONS.md).
export const PICO_BOARD_W_MM = 2.087 * 25.4 + 30; // 53.01mm true long edge
const BOARD_SCALE = 3.78 * (PICO_BOARD_W_MM / (2.087 * 25.4)); // effective px/mm
export const PICO_BOARD_W = 2.087 * 25.4 * BOARD_SCALE; // 200.377 px (53.01mm true width)
export const PICO_BOARD_H = PICO_BOARD_W * (0.827 / 2.087); // 79.401 px (21.0mm true depth, aspect preserved)

// Exact connection-point positions, extracted from the part's own markup (not
// eyeballed): each physical pad is an invisible <circle id="connector{N}pin"
// cx cy r="16"/> in the breadboard SVG. In the portrait file pins 1..20 run
// down the left edge (cx = 63.437519 for pins 1-8, 63.000015 for 9-20) and
// pins 21..40 run up the right edge (cx = 763.00024). Each (cx, cy) below is
// mapped through the same matrix the artwork uses: (scale * cy, scale * cx)
// where scale = 0.100" * 3.78 px/mm / 100 units = 2.54 * 3.78 / 100 = 0.096012.
//
// Engine pin                          physical pin    connector    real pinout
//   GPIO0..GPIO15 (with GND on 3,8,13,18) -> pins 1-20                 GPIO0-15
//   VBUS, VSYS, GND, 3V3_EN, 3V3_OUT, ADC_VREF, GPIO28, GND, GPIO27,
//   GPIO26, RUN, GPIO22, GND, GPIO21, GPIO20, GPIO19, GPIO18, GND,
//   GPIO17, GPIO16                      -> pins 21-40               (right col)
//
// The engine pin set below is the REAL Raspberry Pi Pico header pinout
// (official board doc + Zephyr rpi-pico device-tree binding), not the
// Fritzing connector numbering: the part's connector {20..39} land on real
// header pins {21..40} respectively (connector20 = VBUS next to GPIO15,
// connector39 = GPIO16 at the far end). The earlier build placed GPIO16/26/27/
// 28 and the power pins by connector index instead, which put their markers a
// few pads away from their true positions; this table is the corrected one.
const SCALE = (2.54 * BOARD_SCALE) / 100; // px per Fritzing unit (0.001"); scales with the knob so pads stay on the art
const conn = (cx: number, cy: number): Vec => ({
  x: +(cy * SCALE).toFixed(3),
  y: +(cx * SCALE).toFixed(3),
});

function buildPinOffsets(): PinOffsetMap {
  const offsets: PinOffsetMap = {};
  // Engine label -> [cx, cy] of that pin's pad in the Fritzing part.
  const enginePins: Record<string, [number, number]> = {
    // Left column (pins 1-20), GPIO rail.
    GPIO0: [63.437519, 132.56255],
    GPIO1: [63.437519, 232.62508],
    GND_1: [63.437519, 332.62512],
    GPIO2: [63.437519, 432.62515],
    GPIO3: [63.437519, 532.62512],
    GPIO4: [63.437519, 632.62518],
    GPIO5: [63.437519, 732.62518],
    GND_2: [63.437519, 832.62524],
    GPIO6: [63.000015, 932.62524],
    GPIO7: [63.000015, 1032.6254],
    GPIO8: [63.000015, 1132.6254],
    GPIO9: [63.000015, 1232.6254],
    GND_3: [63.000015, 1332.6254],
    GPIO10: [63.000015, 1432.6255],
    GPIO11: [63.000015, 1532.6255],
    GPIO12: [63.000015, 1632.6255],
    GPIO13: [63.000015, 1732.6255],
    GND_4: [63.000015, 1832.6256],
    GPIO14: [63.000015, 1932.6256],
    GPIO15: [63.000015, 2032.6256],
    // Right column (pins 21-40), running up from the USB end.
    VBUS: [763.00024, 2032.6256],
    VSYS: [763.00024, 1932.6256],
    GND_5: [763.00024, 1832.6256],
    "3V3_EN": [763.00024, 1732.6255],
    "3V3_OUT": [763.00024, 1632.6255],
    ADC_VREF: [763.00024, 1532.6255],
    GPIO28: [763.00024, 1432.6255],
    GND_6: [763.00024, 1332.6254],
    GPIO27: [763.00024, 1232.6254],
    GPIO26: [763.00024, 1132.6254],
    RUN: [763.00024, 1032.6254],
    GPIO22: [763.00024, 932.62524],
    GND_7: [763.00024, 832.62524],
    GPIO21: [763.00024, 732.62518],
    GPIO20: [763.00024, 632.62518],
    GPIO19: [763.00024, 532.62512],
    GPIO18: [763.00024, 432.62515],
    GND: [763.00024, 332.62512],
    GPIO17: [763.00024, 232.62508],
    GPIO16: [763.00024, 132.62505],
  };
  for (const [label, [cx, cy]] of Object.entries(enginePins)) {
    offsets[label] = conn(cx, cy);
  }
  return offsets;
}

export const picoPinOffsets: PinOffsetMap = buildPinOffsets();

interface PicoBoardViewProps {
  renderInfo: { type: "pico_board" };
  position: Vec;
  // UI-only selection highlight, driven by CircuitCanvas's selected state.
  selected?: boolean;
}

// Purely presentational: renders the official board artwork only (the
// interactive pin markers live in CircuitCanvas's own overlay from
// picoPinOffsets, which land exactly on the part's own connection points).
export function PicoBoardView({ position, selected }: PicoBoardViewProps) {
  return (
    <g
      transform={`translate(${position.x} ${position.y})`}
      data-testid="pico-board"
      data-selected={selected ? "true" : "false"}
    >
      <image
        x={0}
        y={0}
        width={PICO_BOARD_W}
        height={PICO_BOARD_H}
        href={picoBreadboardUrl}
        preserveAspectRatio="none"
        style={{ pointerEvents: "none" }}
      />
      {selected && (
        <rect
          x={0}
          y={0}
          width={PICO_BOARD_W}
          height={PICO_BOARD_H}
          rx={5}
          fill="none"
          stroke="#ffd500"
          strokeWidth={4}
        />
      )}
    </g>
  );
}
