import { Component, newId } from "../Component";
import type { HasInternalConnections } from "../Component";
import type { RenderInfo } from "../RenderInfo";
import type { Pin } from "../Pin";

// The Pico board itself — a component like any other, just with a lot of
// pins and no interesting update() logic of its own. The `machine.Pin` shim
// reads/writes the GPIO pins directly by label.
//
// Pin set and physical layout match the real Raspberry Pi Pico's 40-pin
// header exactly (official board doc + Zephyr's rpi-pico device-tree binding):
//
//   Left column (pins 1-20, GPIO rail)         Right column (pins 21-40)
//   pin  GPIO rail       row        pin  function        row
//    1   GPIO0            1         21   VBUS             1
//    2   GPIO1            2         22   VSYS             2
//    3   GND_1            3         23   GND_5            3
//    4   GPIO2            4         24   3V3_EN           4
//    5   GPIO3            5         25   3V3_OUT          5
//    6   GPIO4            6         26   ADC_VREF         6
//    7   GPIO5            7         27   GPIO28           7
//    8   GND_2            8         28   GND_6            8
//    9   GPIO6            9         29   GPIO27           9
//   10   GPIO7           10         30   GPIO26          10
//   11   GPIO8           11         31   RUN             11
//   12   GPIO9           12         32   GPIO22          12
//   13   GND_3           13         33   GND_7           13
//   14   GPIO10          14         34   GPIO21          14
//   15   GPIO11          15         35   GPIO20          15
//   16   GPIO12          16         36   GPIO19          16
//   17   GPIO13          17         37   GPIO18          17
//   18   GND_4           18         38   GND             18
//   19   GPIO14          19         39   GPIO17          19
//   20   GPIO15          20         40   GPIO16          20
//
// The eight GND pads are one continuous plane on the real board; they are
// modeled as 8 pins permanently tied via getInternalConnections(), exactly
// like the Button's always-shorted leg pairs. Exactly one of them (the "GND"
// pad at physical pin 38) is set OUT LOW so the ground net has one driver —
// the other seven stay UNSET and simply ride along on that net, so wiring to
// any GND pad behaves identically and the net is never a multi-driver short.
//
// GPIO23/24/25 exist on the RP2040 die (flash chip-select, VBUS sense, onboard
// LED) but are NOT exposed on the header, so they have no pins here — the
// usable ADC pins are GP26/27/28.
export class PicoBoard extends Component implements HasInternalConnections {
  constructor(id?: string) {
    super(id ?? `board-${newId()}`);
    // 26 user-wireable GPIO pins: GP0-GP22, then GP26/27/28.
    const GPIO: number[] = [...Array(23).keys(), 26, 27, 28];
    for (const n of GPIO) {
      this.addPin(`GPIO${n}`, "UNSET"); // mode gets set by user code (IN/OUT) at runtime
    }
    // 8 ground pads, all one net (see getInternalConnections). "GND" is the
    // single driver instance (physical pin 38, matching the pre-existing pad);
    // GND_1..GND_7 (pins 3, 8, 13, 18, 23, 28, 33) are tied listeners.
    this.addPin("GND", "OUT").value = "LOW"; // always-on ground
    for (let i = 1; i <= 7; i++) {
      this.addPin(`GND_${i}`, "UNSET");
    }
    // Real non-GPIO header pins. Present and labelled realistically, but with
    // no simulated behavior yet: VBUS/VSYS/3V3_EN/ADC_VREF/RUN are ordinary
    // UNSET pins (passive whenever wired); 3V3_OUT keeps the historic "3V3"
    // rail behavior (OUT HIGH) so the demo button circuit still has a supply.
    this.addPin("VBUS", "UNSET");
    this.addPin("VSYS", "UNSET");
    this.addPin("3V3_EN", "UNSET");
    this.addPin("3V3_OUT", "OUT").value = "HIGH"; // always-on 3.3V rail
    this.addPin("ADC_VREF", "UNSET");
    this.addPin("RUN", "UNSET");
  }

  // The 8 ground pads are permanently connected to each other (the real
  // board's ground plane). A chain of pairs unions all 8 into one net; any
  // external wire to any GND pin merges into that same ground net.
  getInternalConnections(): Array<[Pin, Pin]> {
    const ground: Pin[] = [this.pin("GND"), ...Array.from({ length: 7 }, (_, i) => this.pin(`GND_${i + 1}`))];
    const pairs: Array<[Pin, Pin]> = [];
    for (let i = 0; i < ground.length - 1; i++) {
      pairs.push([ground[i], ground[i + 1]]);
    }
    return pairs;
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