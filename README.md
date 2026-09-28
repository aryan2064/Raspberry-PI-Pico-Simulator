# Pico Sim

A browser-based, client-side circuit simulator for the **Raspberry Pi Pico**
(microcontroller, MicroPython) — similar in spirit to Wokwi. Place components
on a canvas, wire them up, write real MicroPython, and watch simulated
hardware react. No backend, no installed Python — everything runs in the
browser.

> Target board is the **Pico**, not the full Linux-based Raspberry Pi. We
> shim the `machine` module (`machine.Pin`, etc.) and run user code through
> Pyodide in a Web Worker. See `docs/DECISIONS.md` for the reasoning.

## Project status

This is an early-stage project. The **foundation is built and
verified**, the **canvas renders a live, editable circuit in-browser**,
and **MicroPython `machine.Pin` code runs against the live simulation in
a Web Worker**.

| Area | Status |
| --- | --- |
| Engine data model (`Pin`, `Wire`, `Component`, `Circuit`, `PicoBoard`, `LED`, `Button`, `Relay`, `Transistor`) | ✅ Built, split into `src/engine/`, unit-tested |
| Net resolution via union-find + `tick(dt)` simulation step | ✅ Built & tested |
| Analog channel (`Pin.analogValue`, 0–1 PWM duty) + analog propagation in `tick()` | ✅ Built & tested (digital behavior untouched) |
| Pin pulls (`Pin.pull`: UP/DOWN/NONE net fallback) + passive `Button` (4 legs, permanent strip pairs + press bridge via `getInternalConnections()`) | ✅ Built & tested |
| State-driven switches (`Relay` SPDT in/nc/com/no, `Transistor` base/collector/emitter — internal connections decided by a control input per tick) | ✅ Built & tested |
| Unit tests (Vitest) | ✅ 104 passing (18 Circuit / 7 PicoBoard / 6 LedBrightness / 4 analog / 6 button / 5 relay / 4 transistor / 20 CircuitHost / 25 canvas-jsdom / 9 App-level), plus 1 real-Pyodide integration test |
| Vite + React + TypeScript scaffold | ✅ Builds & runs |
| `@wokwi/elements` visuals (LED, button) + scaled HTML-stage canvas (pin markers aligned to element `pinInfo`); hand-drawn SVG for board/relay/transistor | ✅ Built & verified in-browser |
| Canvas rendering (snapshot renderer; click-to-wire, click-to-delete-wire) | ✅ Built & tested |
| Component palette + drag-to-place/drag-to-move (LED, Button, Relay, Transistor) + deleting placed parts | ✅ Built & tested (survives Stop/replay) |
| Pyodide in a Web Worker + `machine.Pin` shim (worker owns the live `Circuit`) | ✅ Built & verified (incl. real-Pyodide script driving a wired LED on/off) |
| `machine.PWM` (duty only) → LED brightness over the analog channel | ✅ Built & verified (a `duty_u16` fade sweeps a real `wokwi-led` noticeably dim→bright; `freq()` stored, never simulated) |
| Real Pico header pinout on the board (40 pins: 26 GPIOs, 8 GND pads as one ground plane, `3V3_OUT`, non-GPIO pins UNSET; GP23/24/25 absent) | ✅ Built & verified (markers sub-pixel on every checked pad in-browser) |
| Validation/error states (short-circuit conflicts: red dashed wires + banner) | ✅ Conflict detection built (diagnostic `hasConflict` flag) |
| Component library beyond `LED` | ◑ LED + Button + Relay + Transistor (more added only when a feature needs one) |

## Quick start

Requires **Node 18+** (`node --version` to check).

```bash
npm install      # install dependencies
npm run dev      # start the dev server, open the printed URL
```

## Tests & checks

```bash
npm test              # run all Vitest tests once (fast, no browser)
npm run test:watch    # run tests in watch mode
npm run typecheck     # TypeScript strict check, no emit
npm run build         # typecheck + production build to dist/
npm run preview       # preview the production build
npm run verify:python # OPTIONAL: real-Pyodide end-to-end check in Node
```

The engine test suites run in plain Node — no browser needed. This is
intentional: the engine layer must stay testable without any
DOM/React/Pyodide, per `docs/ARCHITECTURE.md`. Four engine suites:
`Circuit.test.ts` (digital net resolution, wire edits, conflict + pull
fallback semantics), `Analog.test.ts` (analog `analogValue` channel:
single-driver propagation, no-driver → `null`, multi-driver placeholder,
channel independence), `Button.test.ts` (passive switch with 4 legs — two permanent strip
pairs `leg1a`/`leg1b` + `leg2a`/`leg2b`, press adds `leg1a`–`leg2a`;
pull-down keeps the undriven net LOW, no conflict from pulls), and
`PicoBoard.test.ts` (real 40-pin header: 26 GPIOs, the eight tied GND
pads as one ground plane, non-GPIO pins present, `3V3_OUT` rail, and
GP23/24/25 throwing "no pin labeled…" — they're not on the header),
plus `Relay.test.ts` (SPDT: de-energized com–nc, energized com–no, the
old nc path breaking, coil vcc/gnd ignored) and `Transistor.test.ts`
(NPN: base HIGH conducts, LOW **or** FLOATING cuts off, end-to-end LED
drive). 42
tests total across those six suites.

The canvas layer is tested separately under **jsdom**
(`src/ui/__tests__/CircuitCanvas.test.tsx`, 25 tests): components/wires
render from a snapshot; the LED reflects snapshot state (`data-on`),
selection ring, press/release, connect, and disconnect; wire endpoints
track the body wrapper positions (`style.left/top`); a dropped palette
line places a component at the drop point (and non-palette payloads are
ignored); bodies drag to move past a threshold. Relay/transistor bodies
render with their `data-energized`/`data-conducting` state attributes and
their drops place like any other part. Palette placement
end-to-end (drop → worker message → pin wiring → Stop replay survival)
and placed-part deletion are covered in `src/App.test.tsx` (9 tests)
with a fake `Worker` stub. The worker's
message handling is plain-TS and tested in Node
(`src/execution/__tests__/CircuitHost.test.ts`, 20 tests) — no
Worker/Pyodide needed. Dev deps `jsdom` +
`@testing-library/react` are required for the jsdom suite only.

`npm run verify:python` runs the **real Pyodide** (npm package, a few
seconds) against the actual `src/execution/machine-shim.py` and
`CircuitHost`: a `machine.Pin` script drives a wired LED on and off
(asserted against the engine snapshot), IN pins read correctly, the
third `PULL_UP`/`PULL_DOWN` argument maps to `Pin.pull` and is live
immediately (via `Circuit.resolveNow()`), the JSPI
sleep path runs (Node 26 enables WebAssembly stack switching by
default), the busy-wait fallback is verified by temporarily forcing it,
`print()` reaches the output route, `machine.PWM` runs a `duty_u16`
sweep + fade `sleep` loop against the live engine (brightness asserted
from the snapshot), and `import machine.ADC` raises a clean
ImportError. It is skipped by `npm test` (it adds seconds); run it
when touching the shim or bridge. jsdom cannot run Web Workers or
Pyodide, so the worker boot in a real browser is covered by
`node scripts/browser-verify.mjs <url>` (headless Edge over CDP: canvas
render, button relay, Run-blink, Stop recovery, palette drop/wire/drag/
delete, Stop-survival, the 3V3_OUT↔GND conflict banner, and non-blocking
sleep mid-script) — see below.

## Project layout

```
src/
  engine/            pure simulation. No DOM, no React, no Pyodide.
    Pin.ts           connection point: id, label, mode (IN/OUT/UNSET),
                     value, pull (UP/DOWN/NONE), analogValue, netId
    Wire.ts          a pair of pins
    Component.ts     abstract base (pin lookup, addPin, update,
                     getRenderInfo, optional getInternalConnections)
    Circuit.ts       owns components/wires; resolveNets() + tick(dt)
                     + resolveNow()
    RenderInfo.ts    discriminated union the canvas switches on to draw
    components/
      PicoBoard.ts   real 40-pin Pico header: 26 GPIOs (GPIO0–22,
                     GPIO26–28), 8 GND pads one ground plane, 3V3_OUT
                     (+ VBUS/VSYS/3V3_EN/ADC_VREF/RUN UNSET)
      LED.ts         on/off only — deliberately minimal
      Button.ts      4-leg passive switch: 2 permanent strip pairs,
                     press bridges strips (leg1a–leg2a)
      Relay.ts       state-driven SPDT: in/vcc/gnd/com/no/nc, com–nc
                     unless in is HIGH (then com–no)
      Transistor.ts  NPN switch: base HIGH shorts collector–emitter,
                     LOW/FLOATING cuts off
    __tests__/       Vitest unit tests
  ui/                React + canvas rendering
    ComponentPalette.tsx  drag sources: LED + Button + Relay + Transistor
                          (+ scaled previews)
    CircuitCanvas.tsx     snapshot renderer + input relay; scaled HTML
                          stage (1200×700) under SVG wire/pin overlays
    ScriptPanel.tsx       MicroPython editor + Run/Stop + output
    components/           LedView, PicoBoardView, ButtonView, RelayView,
                          TransistorView (+ wokwi custom elements from the
                          published @wokwi/elements package, MIT)
    __tests__/            jsdom UI tests (CircuitCanvas.test.tsx)
  execution/         Pyodide + machine shim + worker
    messages.ts           client↔worker protocol (single source of truth)
    worker-core.ts        CircuitHost: owns the live Circuit, handles edits
    machine-shim.py       importable `machine` module (Pin w/ IN/OUT/
                          PULL_UP/PULL_DOWN + JSPI/busy-wait sleep)
    pyodide.worker.ts     Worker (module worker): Pyodide npm pkg + CDN
                          wasm assets via indexURL, shim install, 60fps snapshots
    __tests__/            CircuitHost + real-Pyodide integration tests
docs/
  AGENT.md           entry point: architecture rules, current state
  ARCHITECTURE.md    how pieces fit together and why
  DECISIONS.md       settled design decisions
  ROADMAP.md         agreed build order
  COMPONENT_GUIDE.md how to add a new component
```

## Architecture in one paragraph

Four layers with a **one-way dependency rule**: `engine/` never imports
from `ui/` or `execution/`. The engine is pure simulation logic — a
`Circuit` owns components and wires, groups connected pins into **nets**
(union-find), and resolves each net to `HIGH` / `LOW` / `FLOATING` based on
which pins are driving (`OUT`) vs listening (`IN`). It is deliberately not a
circuit solver (no Kirchhoff/SPICE); analog math happens inside a specific
component only when that component needs it. The execution layer owns the
**live `Circuit` inside a Web Worker**: `machine.Pin` calls hit a shim
bridge that writes engine pins on the same thread, and the worker streams
`snapshot` messages to the UI, which is a pure renderer + input relay
over postMessage (it holds only the latest snapshot and a topology record
used to rebuild a terminated worker). See `docs/ARCHITECTURE.md`.

## What works today

An runnable end-to-end proof: the **interactive canvas + Python demo** in
`src/App.tsx`. `npm run dev`, open the printed URL, and you get a live
circuit on a canvas:

- **Pico board, two LEDs, and a button** using the published (MIT)
  `@wokwi/elements` package for the LED/button and Raspberry Pi's
  official Fritzing breadboard part for the original Pico (vendored as
  a static SVG from `pip.raspberrypi.com/documents/RP-008310-DS`,
  pin offsets extracted from the part's own connector markup), all
  rendered from `getRenderInfo()` (read from worker
  snapshots).
- **All 40 real Pico header pins** are interactive: the board models
  26 exposed GPIOs (`GPIO0`–`GPIO22`, `GPIO26`–`GPIO28`), all eight
  GND pads tied as one ground plane (wire to any GND and they behave
  identically), the 3.3V rail (`3V3_OUT`, HIGH), and the
  non-GPIO pads (VBUS/VSYS/3V3_EN/ADC_VREF/RUN). GP23/24/25 don't exist
  on the header, so `machine.Pin(23)` throws "no pin labeled GPIO23".
  Pinout follows the official Pico header (see `docs/DECISIONS.md`).
- **Press and hold the green button** → its strips are permanently
  shorted (`leg1a`–`leg1b`, `leg2a`–`leg2b`); pressing bridges them
  (`leg1a`–`leg2a`), pulling 3V3_OUT onto the `GPIO15` pull-down net → the
  first LED lights; release → it goes off. The worker ticks
  `circuit.tick(1/60)` ~60 times a second.
- **Click-to-wire**: click a pin (it highlights), then click a pin on
  another component to create a wire; click the same pin twice to
  cancel. Try wiring the second LED's anode to a free GPIO — still works
  at runtime.
- **Click-to-delete-wire**: click any wire to remove it (hover shows a
  pointer + darker color). Wires and pins are drawn as SVG overlays
  above the HTML stage, so they always show on top of component bodies
  and pins stay visible/clickable over everything.
- **Palette + drag**: drag an LED, Button, Relay, or Transistor from the
  sidebar palette onto
  the canvas to place it (it lands where you drop it), drag any part's
  body to reposition it, and wire it like the demo parts. Placed parts
  survive Stop — the topology record replays them into the fresh worker,
  and their positions are plain UI state, so nothing jumps after a
  respawn. Select a part (ring highlight) and hit Delete/Backspace or
  the floating Delete button to remove it along with its wires. The
  **Relay** (a 6-pin SPDT module: `in`/`vcc`/`gnd` + `com`/`no`/`nc`)
  normally shorts `com`–`nc` and switches to `com`–`no` when its `in`
  pin goes HIGH (e.g. from a GPIO); the **NPN transistor**
  (`base`/`collector`/`emitter`) conducts `collector`–`emitter` only
  while `base` reads HIGH. Both are state-driven passive switches — wire
  the control input, and the contacts re-resolve automatically.
- **MicroPython**: click Run with the default blink program and the
  second LED (`GPIO16`) blinks on/off from `machine.Pin` writes; Stop
  kills the running script (even a stuck loop) and immediately rebuilds
  the wiring. `machine.Pin(id, IN/OUT, PULL_UP/PULL_DOWN?)` now supports
  the third pull argument.

**Browser support note — `time.sleep` and Firefox.** Where the browser
ships WebAssembly stack switching (JSPI) — Chrome and Edge — `time.sleep`
is non-blocking: the Python script blocks for its full duration but this
worker's JS event loop stays free, so the sim keeps ticking (LED1 still
responds to the button while the script sleeps). **Firefox does not ship
JSPI yet**, so there `time.sleep` falls back to a plain busy-wait: the
script still runs correctly and blocks for the requested time, but the
worker — and with it the sim tick — is paused until the sleep ends. The
worker detects support via `pyodide.ffi.can_run_sync()` and the shim
picks the implementation per call. See `docs/DECISIONS.md`.

The engine tests (`npm test`) prove the circuit logic headlessly, the
canvas suite proves render + relay under jsdom, and
`npm run verify:python` proves the real `machine.Pin` shim drives the
real circuit through actual Pyodide. For the whole stack in a real
browser (worker boot, Run/Stop, replay, palette placement, conflict
warnings, non-blocking sleep), run a dev
server and
`node scripts/browser-verify.mjs http://localhost:5173` — drives
headless Edge over CDP through the checks listed above.

## Build order & where things are headed

See `docs/ROADMAP.md`. The next milestones:

1. **Canvas rendering** — components drawn from `getRenderInfo()`, click
   between pins to create wires. ✅ Done (scaled HTML stage + SVG overlays,
   click-to-wire).
2. **Code execution** — Pyodide (in a Web Worker) + a `machine` shim so user
   MicroPython like `machine.Pin(15, machine.Pin.OUT).value(1)` flips engine
   pins. ✅ Done (`machine.Pin` + `machine.PWM` duty-only); Stop terminates +
   replays wiring; `ADC`/`I2C` and pause/step still open.
3. **Component palette / drag editing** — drop parts onto the canvas, drag
   them around, delete them. ✅ Done (drop-to-place + drag-to-move +
   delete, all Stop-survivable).
4. **Validation/error states** — short-circuit/conflict detection. ✅
   Diagnostic `hasConflict` flag → red dashed wires + `⚠ N wire
   conflicts` banner (warning, not prevention); other validation states
   (undeclared pins, unmapped Python pin numbers) still open.
5. **Component library growth** — one component at a time, only when a
   feature needs it. ◑ (LED + Button + Relay + Transistor done; more
   pending.)

## Ground rules for contributors (brief)

- `engine/` must never import from `ui/` or `execution/` — the engine stays
  pure and browser-free.
- Don't build components speculatively; the first version of any component
  should be the minimal one that proves the pipeline end-to-end (LED shipped
  as on/off only, no brightness).
- Real architectural decisions belong in `docs/DECISIONS.md`.