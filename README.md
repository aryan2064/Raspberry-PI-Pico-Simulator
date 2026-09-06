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
| Engine data model (`Pin`, `Wire`, `Component`, `Circuit`, `PicoBoard`, `LED`, `Button`) | ✅ Built, split into `src/engine/`, unit-tested |
| Net resolution via union-find + `tick(dt)` simulation step | ✅ Built & tested |
| Analog channel (`Pin.analogValue`, 0–1 PWM duty) + analog propagation in `tick()` | ✅ Built & tested (digital behavior untouched) |
| `Button` (drives nets HIGH/LOW via `press()`/`release()`; exercises the driver side of net resolution) | ✅ Built & tested |
| Unit tests (Vitest) | ✅ 35 passing (13 engine / 12 canvas-jsdom / 6 worker-message / 4 App-level), plus 1 real-Pyodide integration test |
| Vite + React + TypeScript scaffold | ✅ Builds & runs |
| Canvas rendering (SVG snapshot renderer; click-to-wire, click-to-delete-wire) | ✅ Built & tested |
| Component palette + drag-to-place/drag-to-move (LED, Button) | ✅ Built & tested (survives Stop/replay; deleting parts is the next task) |
| Pyodide in a Web Worker + `machine.Pin` shim (worker owns the live `Circuit`) | ✅ Built & verified (incl. real-Pyodide script driving a wired LED on/off) |
| Validation/error states (short-circuit conflicts, etc.) | ⬜ Planned |
| Component library beyond `LED` | ◐ Extends via `Button` (built for a stated, concrete reason) |

Note: `Button` was built to exercise the driver side of net resolution ahead of canvas work, which will need a user-interactive input component.

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
DOM/React/Pyodide, per `docs/ARCHITECTURE.md`. Three engine suites:
`Circuit.test.ts` (digital net resolution, 6 tests incl.
`disconnect()`), `Analog.test.ts` (analog `analogValue` channel:
single-driver propagation, no-driver → `null`, multi-driver placeholder,
channel independence, 4 tests) and `Button.test.ts` (drives HIGH while
pressed / LOW after release, `getRenderInfo()` reflects `isPressed`,
3 tests). 13 total.

The canvas layer is tested separately under **jsdom**
(`src/ui/__tests__/CircuitCanvas.test.tsx`, 12 tests): components/wires
render from a snapshot; the LED reflects snapshot state; press/release,
connect, and disconnect events relay to the parent with the right
payloads; same-pin double-click cancels; a removed wire disappears;
layer order is enforced; a dropped palette line places a component at
the drop point (and non-palette payloads are ignored); bodies drag to
move past a 4px threshold. Palette placement end-to-end (drop → worker
message → pin wiring → Stop replay survival) is covered in
`src/App.test.tsx` (4 tests) with a fake `Worker` stub. The worker's
message handling is plain-TS and tested in Node
(`src/execution/__tests__/CircuitHost.test.ts`, 6 tests) — no
Worker/Pyodide needed. Dev deps `jsdom` +
`@testing-library/react` are required for the jsdom suite only.

`npm run verify:python` runs the **real Pyodide** (npm package, a few
seconds) against the actual `src/execution/machine-shim.py` and
`CircuitHost`: a `machine.Pin` script drives a wired LED on and off
(asserted against the engine snapshot), IN pins read correctly, the JSPI
sleep path runs (Node 26 enables WebAssembly stack switching by
default), the busy-wait fallback is verified by temporarily forcing it,
`print()` reaches the output route, and `import machine.PWM` raises a
clean ImportError. It is skipped by `npm test` (it adds seconds); run it
when touching the shim or bridge. jsdom cannot run Web Workers or
Pyodide, so the worker boot in a real browser is covered by
`node scripts/browser-verify.mjs <url>` (headless Edge over CDP: canvas
render, button relay, Run-blink, Stop recovery, palette drop/wire/drag/
delete, Stop-survival, conflict detection, and non-blocking sleep
mid-script) — see below.

## Project layout

```
src/
  engine/            pure simulation. No DOM, no React, no Pyodide.
    Pin.ts           connection point: id, label, mode (IN/OUT/UNSET), value
    Wire.ts          a pair of pins
    Component.ts     abstract base (pin lookup, addPin, update, getRenderInfo)
    Circuit.ts       owns components/wires; resolveNets() + tick(dt)
    RenderInfo.ts    discriminated union the canvas switches on to draw
    components/
      PicoBoard.ts   GPIO0–GPIO28, 3V3, GND
      LED.ts         on/off only — deliberately minimal
      Button.ts      drives HIGH/LOW from press()/release()
    __tests__/       Vitest unit tests
  ui/                React + SVG canvas rendering
    ComponentPalette.tsx  drag sources: LED + Button
    CircuitCanvas.tsx     snapshot renderer + input relay (3 SVG layers,
                          click-to-wire, click-to-delete-wire, drop-to-place,
                          drag-to-move)
    ScriptPanel.tsx       MicroPython editor + Run/Stop + output
    components/           LedView, PicoBoardView, ButtonView (presentational)
    __tests__/            jsdom UI tests (CircuitCanvas.test.tsx)
  execution/         Pyodide + machine shim + worker
    messages.ts           client↔worker protocol (single source of truth)
    worker-core.ts        CircuitHost: owns the live Circuit, handles edits
    machine-shim.py       importable `machine` module (Pin + JSPI/busy-wait sleep)
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
circuit on an SVG canvas:

- **Pico board, two LEDs, and a button** drawn from engine
  `getRenderInfo()` (read from worker snapshots).
- **Press and hold the green button** → `GPIO15` goes HIGH → the first
  LED lights; release → it goes off. The worker ticks
  `circuit.tick(1/60)` ~60 times a second.
- **Click-to-wire**: click a pin (it highlights), then click a pin on
  another component to create a wire; click the same pin twice to
  cancel. Try wiring the second LED's anode to a free GPIO — still works
  at runtime.
- **Click-to-delete-wire**: click any wire to remove it (hover shows a
  pointer + darker color). The canvas paints bodies → wires → pins in
  three layers, so wires always show on top of component bodies and pins
  stay visible/clickable over everything.
- **Palette + drag**: drag an LED or Button from the sidebar palette onto
  the canvas to place it (it lands where you drop it), drag any part's
  body to reposition it, and wire it like the demo parts. Placed parts
  survive Stop — the topology record replays them into the fresh worker,
  and their positions are plain UI state, so nothing jumps after a
  respawn. Deleting placed parts is the next milestone.
- **MicroPython**: click Run with the default blink program and the
  second LED (`GPIO16`) blinks on/off from `machine.Pin` writes; Stop
  kills the running script (even a stuck loop) and immediately rebuilds
  the wiring. The button demo stays wired to `GPIO15` so Python `OUT`
  pins never share a net with the button's signal pin (two drivers on
  one net resolve to `FLOATING`).

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
browser (worker boot, Run/Stop, replay, palette placement), run a dev
server and
`node scripts/browser-verify.mjs http://localhost:5173` — drives
headless Edge over CDP through the same five checks listed above.

## Build order & where things are headed

See `docs/ROADMAP.md`. The next milestones:

1. **Canvas rendering** — components drawn from `getRenderInfo()`, click
   between pins to create wires. ✅ Done (fixed demo layout, click-to-wire).
2. **Code execution** — Pyodide (in a Web Worker) + a `machine` shim so user
   MicroPython like `machine.Pin(15, machine.Pin.OUT).value(1)` flips engine
   pins. ✅ Pin-only shim; Stop terminates + replays wiring; `PWM`/`ADC`/`I2C`
   and pause/step still open.
3. **Component palette / drag editing** — drop parts onto the canvas, drag
   them around. ✅ Done (drop-to-place + drag-to-move, Stop-survival);
   **deleting placed parts** is the immediate next item.
4. **Validation/error states** — real short-circuit/conflict detection. ⬜
5. **Component library growth** — one component at a time, only when a
   feature needs it. ⬜

## Ground rules for contributors (brief)

- `engine/` must never import from `ui/` or `execution/` — the engine stays
  pure and browser-free.
- Don't build components speculatively; the first version of any component
  should be the minimal one that proves the pipeline end-to-end (LED shipped
  as on/off only, no brightness).
- Real architectural decisions belong in `docs/DECISIONS.md`.