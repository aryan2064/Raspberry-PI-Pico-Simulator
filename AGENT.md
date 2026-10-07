# AGENT.md — Start Here

This file is the entry point for any AI agent (or human) picking up this
project. Read this first. It links to deeper docs — don't skip to them
before reading this summary.

## What this project is

A browser-based circuit simulator for the **Raspberry Pi Pico**, similar
in spirit to Wokwi. A user places components on a canvas, wires them
together, writes MicroPython code, and sees simulated hardware behavior
— all client-side, no backend.

## Non-negotiable architecture rule

```
src/engine/     — pure simulation logic. NEVER imports from ui/ or execution/.
src/ui/         — React + canvas rendering. May import from engine/.
src/execution/  — Pyodide + machine shim. May import from engine/.
```

`engine/` has zero DOM, zero React, zero Pyodide dependencies. It must be
fully testable in plain Node with no browser. If you are about to import
anything from `ui/` or `execution/` into a file under `engine/`, stop —
that's the one rule this project cannot bend on. See
`docs/ARCHITECTURE.md` for why.

## Tech stack

- Vite + React + TypeScript (app shell, canvas UI)
- Vitest (engine unit tests in plain Node; canvas UI tests under jsdom)
- Pyodide, loaded inside a **Web Worker** (Python execution — must not
  block the UI thread). The worker **owns the live `Circuit`**; the UI
  renders from snapshot messages and relays wire/button/pin edits over
  postMessage. See `docs/ARCHITECTURE.md` → "Python execution model".
- Optional real-Pyodide verification in Node: `npm run verify:python`
  (skipped by default — see README "Tests & checks").

## Target hardware & simulation approach

- Target board: **Raspberry Pi Pico** (microcontroller, MicroPython) —
  explicitly NOT the full Linux-based Raspberry Pi. See
  `docs/DECISIONS.md` for why this matters architecturally.
- Simulation approach: **library shimming**, not hardware emulation. We
  fake the `machine` module; real user Python code runs against our
  fake `machine.Pin` etc. We do not emulate a CPU, memory, or boot
  process.
- Circuit logic: **net-based digital state resolution** (HIGH / LOW /
  FLOATING), not a full Kirchhoff/SPICE-style circuit solver. Analog
  math (Ohm's law, voltage dividers, etc.) is added per-component only
  when a specific component actually needs it — never as a general
  physics engine.

## Current state (update this section as work progresses)

- [x] Core data model built and verified: `Pin`, `Wire`, `Component`
  (abstract base), `Circuit` (union-find net resolution + `tick(dt)`)
- [x] `PicoBoard` component — **real Raspberry Pi Pico header pinout**:
      40 pins (26 GPIOs GPIO0–22 + GPIO26–28; 8 GND pads tied as one
      ground plane; VBUS/VSYS/3V3_EN/3V3_OUT/ADC_VREF/RUN). GP23/24/25
      are not on the header and don't exist on the engine (see the "real
      pinout" bullet below)
- [x] `LED` component (on/off only, no brightness — deliberately minimal)
- [x] `Button` component — a **passive switch**, not a driver: four
      `UNSET` legs (`leg1a`/`leg1b`/`leg2a`/`leg2b`). A real push button
      has two mechanical strips, each duplicated to two corners of the
      body, so `getInternalConnections()` **always** returns the two
      permanent pairs (`[leg1a,leg1b]`, `[leg2a,leg2b]` — each strip
      shorts its duplicated legs even unpressed) and while pressed adds
      `[leg1a,leg2a]` (strip-to-strip bridge, exactly the press action).
      The net resolver treats these like extra wires: presses merge
      nets, releases split them, with no wire edit and no way to create
      a driver conflict. Combined with `Pin.pull` (UP/DOWN/NONE net
      fallback; never a driver, never a conflict source) this is how the
      demo button lights its LED: 3V3_OUT → button.leg1a → button.leg2a →
      GPIO15 (IN, pull-down) → LED anode.
- [x] Vite + React + TypeScript project scaffolded (project root), builds
      and typechecks clean, `npm run dev` shows the interactive canvas
      (button → LED demo)
- [x] Data model split into `src/engine/` files: `Pin.ts`, `Wire.ts`,
      `Component.ts`, `Circuit.ts`, `RenderInfo.ts`, plus
      `src/engine/components/{PicoBoard,LED,Button}.ts` and an index barrel
- [x] Vitest tests: engine suites (13 passing, plain Node) + canvas UI
      suite under jsdom (12 passing, `src/ui/__tests__/CircuitCanvas.test.tsx`)
      + worker-message suite (6 passing,
      `src/execution/__tests__/CircuitHost.test.ts`) + App-level suite
      (4 passing, `src/App.test.tsx`) — 35 total.
      `Pyodide.integration.test.ts` exists but skips by default
      (real-Pyodide end-to-end; run with `npm run verify:python`).
      `src/test/setup.ts` patches jsdom's missing `crypto.randomUUID`
      (the engine's `newId()`), registered via `test.setupFiles`.
Current totals: **169 passing + 1 skipped** (18 Circuit / 7
PicoBoard / 7 analog / 6 LedBrightness / 6 button / 5 relay /
4 transistor / 6 stepper / 5 PIRSensor / 3 Potentiometer /
3 Resistor / 5 Capacitor / 7 UltrasonicSensor / 35 CircuitHost /
43 canvas / 9 App; Pyodide.integration skipped by default — run it
with `npm run verify:python`).
- [x] Analog value channel on `Pin` (`analogValue: number | null`, 0–1
      duty for OUT pins) + analog propagation step in `Circuit.tick()`,
      independent of the digital channel; covered by
      `src/engine/__tests__/Analog.test.ts` (4 tests passing). Built on
      top of it: **`machine.PWM` shim + LED brightness** (below), which
      make the channel actually consume duty values.
- [x] `machine.PWM` shim + LED brightness — `PWM` in
      `machine-shim.py` (`duty_u16()` sets/reads the pin's analog
      channel as `value/65535`; `freq()` is stored, never simulated;
      `deinit()` clears the channel), host bridge methods
      `initPwm`/`setAnalogDuty`/`deinitPwm` in `worker-core.ts`
      (each `resolveNow()` so writes are immediately visible, like the
      pull fix), and the worker bridge entries `pwmSetup`/`pwmDuty`/
      `pwmDeinit` (tick + snapshot in the same turn, mirroring `write`).
      `LED.update()` now maps an anode `analogValue` to a clamped
      `brightness` in `RenderInfo` (`{ type:"led", isOn: brightness>0,
      brightness }`, with the digital HIGH/LOW uniform 1/0 fallback), and
      `LedView` sets both `value` and `brightness` on the real
      `wokwi-led` (verified capability — see DECISIONS). Tests:
      `src/engine/__tests__/LedBrightness.test.ts` (6), CircuitHost PWM
      bridge block (5), Pyodide integration runs a duty sweep + fade
      `sleep` loop against the real engine, and a CDP browser probe
      observed intermediate brightness 0.250/0.625/1.000 on the live
      DOM with `wokwi-led.brightness` exactly 0.2500038147554742 at
      `duty_u16(16384)`. Script-only feature (no manual UI PWM control).
- [x] Canvas rendering — in `src/ui/`
      (`CircuitCanvas.tsx` + `components/{LedView,PicoBoardView,
      ButtonView}.tsx`). Since the execution milestone it is a
      **snapshot renderer + relay** that owns no engine objects and
      never talks to the worker (the parent `App` relays). Since the
      wokwi milestone it renders a fixed 4000×2800 HTML stage
      (`data-testid="circuit-stage"`) with component bodies as
      absolute-positioned divs (`data-testid="body-<id>"`) — real
      interactive DOM — under two SVG overlays
      (`data-layer="wires"|"pins"`, `pointer-events:none` svgs, `auto`
      on individual wire/pin groups). The overlays carry the
      **same `transform`** (`translate(panX,panY) scale(zoom)`,
      `transform-origin: top left`) as the stage — both pin/wire SVG
      coords stay in stage units — and each marker sits at its body
      origin + the component offset (LED anode `(25,42)`/
      cathode `(15,42)`; button `1.l(0,13)`/`1.r(67,13)`/`2.l(0,32)`/
      `2.r(67,32)`; board pads come from Raspberry Pi's **official
      Fritzing part** for the original Pico (see below), re-verified to
      sub-pixel in browser-verify step 1b). Since the pan/zoom milestone
      the stage is pannable (empty-canvas drag, `panRef`) and zoomable
      (wheel, cursor-centered, clamped ×0.25–×3, reset to ×1/no-pan on
      reload) with pin-click → body-click/drag → pan → wheel precedence
      and all drop/drag math routed through `clientToStagePoint()`. LED
      and button visuals are the **published `@wokwi/elements`** (MIT)
      package custom elements, registered once via the side-effect
      `import "@wokwi/elements"` in `main.tsx` and driven through refs
      — boolean props set as JS properties because LitElement reads
      attributes as strings. They are a normal npm dependency (a
      vendoring attempt was evaluated and reverted as unnecessary since
      the package ships pre-compiled JS; see `docs/DECISIONS.md`); the
      stepper, the PIR sensor, and the potentiometer are the justified
      vendoring exceptions so far (all covered in `docs/DECISIONS.md`). The
      pin offsets come from the elements' `pinInfo`. The board is a
      static SVG: Raspberry Pi's official `Pico-R3-Fritzing.fzpz`
      breadboard view (`svg.breadboard.rpi_pico-tht_1_breadboard.svg`,
      from `https://pip.raspberrypi.com/documents/RP-008310-DS`),
      shipped as `src/ui/assets/pico-breadboard.svg` with the root dims
      rewritten and its drawing group given the baked-in
      `matrix(0 0.16 0.16 0 0 0)` (landscape, USB right, 0.16 stage
      units per Fritzing unit). `picoPinOffsets` are **extracted from
      the part's own `connector{N}pin` circles** (43 connectors: pins
      1–40 + SWD debug) mapped through that same matrix — position =
      (0.16·cy, 0.16·cx). See the "real Pico header pinout" bullet
      below for the corrected engine↔pad mapping — the part's
      connector ids are **not** the header pin numbers on the right
      column, and an earlier build used them interchangeably (see
      `docs/DECISIONS.md`). Board renders via a bare `<image>`).
      All client→stage
      coordinate math goes through `clientToStagePoint()` (drop/drag
      robust at any scale). Click-to-wire pin connections, clickable
      wires with a wide transparent hit-area + hover highlight, and
      disconnect relay all still apply (wires/pins testids unchanged).
      Verified by updated jsdom UI tests. The ~60fps
      `circuit.tick(1/60)` loop lives **inside the worker**.
- [x] Code execution: Pyodide in a Web Worker with a `machine.Pin`
      shim. The worker owns the live `Circuit` (`CircuitHost` in
      `src/execution/worker-core.ts`, no Worker/Pyodide APIs — unit
      tested in plain Node); the UI (`src/App.tsx`) keeps only a
      topology record + the latest `snapshot` message. The worker is a
      **module worker** that imports Pyodide's JS runtime from its
      **npm package** (`pyodide` v0.314) and fetches only the static
      WebAssembly/stdlib assets from the jsDelivr CDN
      (`v314.0.6/full`) via the loader's `indexURL`. It installs
      `src/execution/machine-shim.py` as the importable `machine`
      module (Pin only; `time.sleep` is JSPI non-blocking where
      available, busy-wait fallback), and posts
      `{type:"snapshot"}` ~60fps — so the canvas reacts even while a
      Python loop holds the worker. The bridge lives on `globalThis`
      (`from js import __pico_bridge`) — setting it only via
      `pyodide.globals` breaks the import (verified by
      `npm run verify:python`). **Stop is non-cooperative**:
      `worker.terminate()` unconditionally, then a fresh worker is
      spawned and the recorded topology is replayed so wiring never
      disappears. Worker failures are never silent: `worker.onerror`/`
      onmessageerror` and the worker's own error/unhandledrejection
      listeners route to the output + a red banner, and a 5s
      first-snapshot watchdog reports "Worker did not respond".
      Verified: engine tests unaffected (13), 35 unit + integration
      tests total, typecheck + build clean, real-Pyodide script drives
      a wired LED on/off, and `scripts/browser-verify.mjs` runs the
      full flow (canvas renders, Run blinks LED2, Stop recovers from
      `while True`, palette drop/wire/drag/Stop-survival) against dev
      AND production build in headless Edge.
      Known limits: `machine.ADC`/`I2C` and any analog *streaming*
      (PWM frequency timing stays out of scope — duty only), pause/step
      debugging, and wakeable/precise sleeps are not implemented. The JSPI
      non-blocking `time.sleep` (responsive sim mid-sleep) works in
      Chrome/Edge; **Firefox has no JSPI, so it busy-waits** (script
      pauses the worker for the sleep duration). See DECISIONS.
- [x] Component palette + drag interaction
      (`src/ui/ComponentPalette.tsx`, `src/App.tsx`,
`src/App.test.tsx`): the palette offers LED, Button, Relay,
       Transistor, Stepper, PIR, Potentiometer, Resistor, Capacitor, and Ultrasonic (no second
       board — PicoBoard stays a singleton) as HTML5 drag sources; dropping
      on the canvas converts client coords to stage coords via
      `clientToStagePoint()` (`getBoundingClientRect`-based, with a
      client-coords pass-through fallback where no usable rect exists,
      e.g. jsdom) and appends the component to the topology record under a
      fresh `placed-N` id, posting the same `addComponent` message the
      init/replay path uses — the worker treats it identically whenever
      it arrives. Positions are **UI-only** React
      state
      (`Record<componentId, {x,y}>`), never sent to the worker, so they
      survive Stop/respawn untouched. Existing component bodies drag to
      move via pointer events past a 4px threshold (below which button
      presses / pin clicks work untouched); wires re-render from the
      moved positions automatically since wire geometry is derived from
      positions + snapshot. Verified: 3 new canvas jsdom tests (drop
      placement + kind, ignore non-palette drops, drag-threshold + move
      + commit, wires following repositions) and 4 new App-level jsdom
      tests (palette contents, drop→worker message, pin-click wiring,
      Stop replay survival of placed parts) with a FakeWorker protocol
      stub; plus a palette step (drop → wire → drag → Stop) in
      `scripts/browser-verify.mjs` against dev AND the production build.
- [x] Deleting placed components (and their wires): engine
      `Circuit.removeComponent` cascade + `removeComponent` worker
      message (PicoBoard removal refused → error post; wireId→engineWireId
      map pruned), canvas selection (plain click, `#ffd500` highlight) +
      Delete button + Delete/Backspace with a text-field focus guard,
      and topology/position cleanup in `App` so a deleted part never
      reappears after Stop. Verified by engine/CircuitHost/canvas/App
      tests + a browser-verify step (button delete, key delete,
      editor-focus guard, board undeletable, no reappear after Stop).
- [x] Conflict / short-circuit detection (validation-states, this
      scope): `Pin.hasConflict` is a diagnostic-only flag set by
      `Circuit.propagate()` on every pin of a net with more than one
      driver (`digital > 1 || analog > 1`, stamped in both passes); the
      snapshot now carries `conflictedPinIds` (pin uuids) and per-
      component `pins: [{ id, label }]` so the canvas can map uuid →
      topology wire endpoints; conflicted wires render red + dashed with
      a `⚠ N wire conflicts` banner (warning, not prevention — see
      DECISIONS). Net resolution itself is unchanged (still
      `FLOATING`/`null`). Verified by engine + CircuitHost + canvas
      tests and a browser-verify step (3V3_OUT↔GND short → red dashed
      wires + "4 wire conflicts" banner; disconnect → cleared). A
      passive button press can merge two already-conflicting nets, but
      the button itself can never create a conflict.
- [x] Pin pulls + passive button (see the `Button` bullet above) — the
      `machine.Pin(..., PULL_UP|PULL_DOWN)` third argument and the app's
      `setupPin` replay both resolve immediately via the new
      `Circuit.resolveNow()` (a pull must be live the instant it's
      configured; a busy-waiting script froze the tick loop, so waiting a
      tick was not an option). Verified by CircuitHost tests + the real
      Pyodide integration test (`npm run verify:python`).
- [x] Real Pico header pinout on `PicoBoard` + `PicoBoardView` — the
      board now models **all 40 physical header pins** instead of a
      reduced GPIO-only set. Engine (`src/engine/components/PicoBoard.ts`):
      26 GPIOs (GPIO0..GPIO22, GPIO26..GPIO28) as `UNSET`; the eight GND
      pads (`GND` at pin 38 + `GND_1`..`GND_7` at pins
      3,8,13,18,23,28,33) form **one ground plane** via
      `HasInternalConnections` (the Button's net-merge trick), with the
      single `GND` driver `OUT LOW` and the rest `UNSET` so wiring to any
      GND pad behaves identically and never looks like a multi-driver
      short; `3V3_OUT` keeps the historic "3V3" rail (`OUT HIGH`) so the
      demo button still has a supply; VBUS/VSYS/3V3_EN/ADC_VREF/RUN are
      `UNSET` (exist + wireable, no simulated behavior). **GP23/24/25 are
      gone from the engine** (`machine.Pin(23)` throws "no pin labeled
      …"); each marker now sits on its true pad — right-column labels
      follow the connector↔pin mapping (connector20=pin21 VBUS …
      connector39=pin40 GPIO16), fixing where the old build drew its
      right-column markers (see `docs/DECISIONS.md`). Verified by 7 new
      engine tests, updated LED/Button/CircuitHost/App/canvas tests
      (`3V3` renamed to `3V3_OUT`), typecheck + build, real Pyodide, and
      browser-verify step 1b (GPIO16, GPIO28, 3V3_OUT, GND, GPIO17
      sub-pixel against extracted connector coords) + step 7
      (`3V3_OUT`↔GND conflict).
- [x] `Relay` + `Transistor` components — two more **state-driven
      passive switches** (the Button's `HasInternalConnections` pattern,
      with the contact state flipped by an input pin instead of a user
      gesture). Relay (`src/engine/components/Relay.ts`): pins
      `in`/`vcc`/`gnd`/`com`/`no`/`nc`; `getInternalConnections()`
      returns exactly `[com,no]` while `in === "HIGH"` (energized) and
      `[com,nc]` otherwise — a true SPDT, one pair at a time, so an
      energize demonstrably *breaks* the old nc path (`vcc`/`gnd` are
      inert UNSET pins for wiring realism only — no coil model).
      Transistor (`src/engine/components/Transistor.ts`): pins
      `base`/`collector`/`emitter`; conducts (`[collector,emitter]`)
      only while `base === "HIGH"`, `[]` in cutoff (LOW **or**
      FLOATING) — no base-resistor/Vbe/leakage analog model. Both are
      MODE_IN control pins, so the state flip lands in `update()` and
      reaches the contacts on the second tick after the control net
      changes (see `docs/DECISIONS.md`). Views render **real parts
      vendored as static SVG assets** — `RelayView.tsx`
      (`dfrobot-3v-relay-module.svg`, the actual DFRobot 3V Relay Module
      DFR0473 with screw terminals + 3-pin header, GPL-3.0 in-house-only,
      140×~120.24, `data-energized`) and `TransistorView.tsx`
      (`transistor-to92-npn.svg`, generic TO-92 NPN, 80×116.566,
      BC547 lead order, `data-conducting`) — because `@wokwi/elements`
      has no usable relay or transistor (the only relay it ships,
      `wokwi-ks2e-m-dc5`, is a bare 8-pad DPDT contactor with no `in`
      pin — wrong interface AND wrong visuals — see `docs/DECISIONS.md`).
      Relay pin offsets come from pixel centroids of the module's own
      drawn pads/screws (no `connectorNpin` markup in the DFRobot art);
      transistor offsets come from that part's own `connectorNpin` rects
      at its own viewBox. browser-verify step 9 re-derives both — the
      relay's anchors are pixel-proven against the served asset's own
      metal — and asserts sub-pixel alignment. The relay asset is GPL-3.0
      with an in-house-only + deferred-attribution TODO in its header;
      the transistor file is CC BY-SA 3.0 with a deferred-attribution TODO.
      Palette entries,
      canvas `PIN_OFFSETS`/`PIN_STYLE`/render cases + drop acceptance,
      and worker `addComponent` cases all wired. Verified by
`Relay.test.ts` (5) + `Transistor.test.ts` (4) — driving control
       pins over real wires, settled-state + old-contact-break asserts —
       plus CircuitHost snapshot/pins tests, canvas render + drop tests,
       and updated App palette test.
- [x] `StepperMotor` + ULN2003 module — the first **sequence-sensing
       stateful** component (`src/engine/components/StepperMotor.ts`):
       pins `in1`/`in2`/`in3`/`in4` (MODE_IN) + inert `vcc`/`gnd`
       (UNSET, wiring realism — same rule as the relay's coil pins). It
       is a pure sensor: `update()` rebuilds the 4-bit pattern (IN1 =
       MSB) and matches it against the **hardcoded** 28BYJ-48 telltale
       tables (full-step `1010 0110 0101 1001` = 2048 steps/rev;
       half-step `1000 1010 0010 0110 0100 0101 0001 1001` = 4096) —
       see `docs/DECISIONS.md` for the derivation. The first valid
       pattern anchors (no phantom movement); the locked table re-locks
       onto the other table on a valid-but-opposite-table transition
       (how half-stepping folds into a full-step anchor and vice versa);
       any other pattern is ignored (no crash, no move, lock survives).
       Reports `{ type:"stepper", angleDegrees, direction:
       "CW"|"CCW"|"none", stepsPerSecond }`, where the rate is `1 /
       real elapsed time since the last recognized step` and decays to 0
       on holds. Implements neither `HasInternalConnections` nor a
       driver — one `tick()` after a pattern write settles it (no
two-tick contact latency). View is a vendored+modified element
         `app-stepper-motor` (in `src/vendor/wokwi/`, size 8, ~81×96
         px): the published `wokwi-stepper-motor` exposes only 4 bipolar
         cosmetic pins with no `vcc`/`gnd`, so its source is vendored
         (with `pin.ts`/`utils/units.ts`), relabeled `in1`–`in4` + added
         `vcc`/`gnd` (centered 6-lead strip at 2.54 mm pitch),
         re-decorated for our `useDefineForClassFields` tsconfig, and
         registered under our own tag — the package's registration is
         untouched (see `docs/DECISIONS.md`). Fed `angleDegrees` via its
         display-only `angle` property; probe-verified to rotate just
         `#arrow-path`/`#shaft-path`. The six `pinInfo` coords are the
         wireable canvas surface (`data-angle`/`data-direction`/
         `data-steps-per-second`). Palette
       entry, canvas offsets/render/drop, and worker `addComponent`
       case wired. Verified by `StepperMotor.test.ts` (6: anchor+advance,
       table re-lock + 2× angle, reverse/CCW subtraction, pure
half-step, garbage tolerance, real-time rate incl. decay), a
        CircuitHost e2e (2 full cycles forward + 2 back through GPIO0–3
        over real wires), canvas render + drop tests, the App palette
test, and `browser-verify.mjs` steps 10–11 (drop + wire 4
         GPIOs, half-step drive 2 laps forward to exactly 1.40625° CW /
         2 back to 0° CCW; live steps/sec asserted and the element's
         shadow-DOM `#arrow-path` transform tracked from
         `rotate(0,10.2,10.2)` through `rotate(1.40625,10.2,10.2)` and
         back; the six pins align to `bodyOrigin + pinInfo` sub-pixel,
and both `wokwi-stepper-motor`/`app-stepper-motor` register
          with no define errors).
- [x] `PIRSensor` — an HC-SR501-style motion module and the first
       **stimulus-driven** component
       (`src/engine/components/PIRSensor.ts`): pins `vcc`/`gnd` (UNSET,
       wiring realism — same rule as the relay's coil pins) + `out`
       (active-high OUT driver, idles LOW). It has no input pin to react
       to — the stimulus is a user gesture delivered through the worker
       `press` message (the shared press-able-anything path Button uses):
       `triggerMotion()` marks motion detected, starts a `holdSeconds`
       hold (default 5 s, configurable) and writes `out` HIGH
       **immediately**, so a net resolve right after the call already
       reads HIGH (pull-resistor/PWM immediacy precedent). The hold is
       burned down by accumulated `update(dt)`; `retriggerable`
       (default true) restarts the full hold from a new trigger even
       mid-hold, otherwise a mid-hold trigger is ignored. Reports
       `{ type:"pir", motionActive }`. Does NOT implement
       `HasStimulus<T>` yet — a parameterless gesture isn't a
       parameterizable stimulus (see `docs/ARCHITECTURE.md`). View is a
       vendored+modified element `app-pir-motion-sensor` (in
       `src/vendor/wokwi/`): the published `wokwi-pir-motion-sensor` is
       a purely static SVG with no state properties, so its source is
       vendored + extended with a `motionActive` Boolean (dome/lens glow
       warm amber/red while detecting), re-decorated for our
       `useDefineForClassFields` tsconfig, and registered under our own
tag; the three leads are relabeled `vcc`/`out`/`gnd` with the
      upstream coordinates intact (the `pinInfo` coords ARE the
      `pirPinOffsets` canvas surface). The body is clickable
      (`data-motion-active` attribute). Palette entry, canvas
      offsets/render/drop, and worker `addComponent` + `press` dispatch
      wired. Verified by `PIRSensor.test.ts` (5: idle pin modes + LOW,
      immediate HIGH through resolveNow, hold expiry via accumulated dt,
      retriggerable extension past original expiry, non-retriggerable
      ignore), a CircuitHost e2e (press → OUT HIGH on a wired GPIO0 IN
      → expire back to LOW), canvas render/click + drop tests, the
      App palette test, and `browser-verify.mjs` step 12 (post-reload
      drop → sub-pixel pins vs pinInfo → dome click → GPIO8 read HIGH
      → 5 s hold expires → dome glow reverts; registration check
      includes `app-pir-motion-sensor`).
- [x] `Potentiometer`/`Resistor`/`Capacitor` — the **RC timing trio**
      (the one-GPIO capacitor-charge measurement recipe; see
      `docs/DECISIONS.md` for the exact linear model). Potentiometer
      (`terminal1`/`wiper`/`terminal2`) and Resistor
      (`terminal1`/`terminal2`) are the first **passive analog
      producers**: their active pin is MODE_IN (never OUT — a passive
      part shades a net, it doesn't drive one) and it publishes a 0..1
      "resistance fraction" directly on the `analogValue` channel
      (resistor: `resistanceOhms / 20000`, default 10 kΩ → 0.5;
      potentiometer: `knobPosition`), set in the constructor/setter AND
      every `update()` so a dropped part or a knob turn is live in the
      snapshot immediately. That widening of who may produce analog is
      made safe by `Pin.analogDelivered` (only stamps when the resolver
      delivers a real non-null value, so a delivered listener can never
      phantom-conflict with the true producer) — see `docs/ARCHITECTURE.md`,
      "`Circuit`". Capacitor (`a`/`b`) is the active-timer consumer: `a`
      is MODE_IN and OWNS its net's PULL (writes it every tick); in the
      DRIVE phase (`a.digitallyDriven`, a real OUT GPIO holds the net) it
      force-adopts (HIGH ⇒ charged+pull UP / LOW ⇒ empty+pull DOWN), in
      the POLL phase it accrues `dt × fraction` against a **linear**
      `maxChargeSeconds × fraction` threshold (default `maxChargeSeconds`
      **2 s**) then flips its pull UP — the GPIO watches LOW→HIGH. See
      `src/engine/components/{Potentiometer,Resistor,Capacitor}.ts` and
      their tests (`Potentiometer.test.ts` 3, `Resistor.test.ts` 3,
      `Capacitor.test.ts` 5). Views: the potentiometer is a **third
      vendoring exception** (`app-potentiometer` in `src/vendor/wokwi/`,
      interaction-stripped — the published element owns
      mousedown/drag + a hidden input, which would steal canvas
      gestures; knob turns are a pointer-capture overlay drag in
      `PotentiometerView` relaying `setKnobPosition`), the resistor uses
      the **published `<wokwi-resistor>` directly** (no handlers; drive
      its `value` string via ref), and the capacitor is **hand-drawn
      SVG** (`CapacitorView`, radial electrolytic) because
      `@wokwi/elements` has **no** capacitor element at all. All three
      per `docs/DECISIONS.md`. Palette entries, canvas
      offsets/render/drop, `setKnobPosition` worker message +
      `addComponent` cases (Resistor `DEFAULT_RESISTANCE_OHMS`,
      Capacitor `{}` options, Potentiometer none) wired. Verified by the
      engine suites above, a CircuitHost e2e (full RC pulse: 10 kΩ →
      ~1.0 s charge to HIGH, asserted [0.85, 1.15); knob 0.25 → ~0.5 s),
      canvas render/drop/knob-drag tests, and `browser-verify.mjs` step
      13 (real Python discharge/poll a wired RC on GPIO8, assert the LOW→HIGH
      trip lands ≈ [0.6, 1.4] s; sub-pixel pin assertions for all three
      new parts).
- [x] `UltrasonicSensor` (HC-SR04) — the second **stimulus-in /
       pulse-out** part and the first with a *parametric* stimulus
       (`src/engine/components/UltrasonicSensor.ts`): pins `vcc`/`gnd`
       (inert UNSET, wiring realism) + `trig` (MODE_IN) + `echo` (OUT
       driver, idles LOW). No ranging model — the distance is the
       simulated stimulus (`setSimulatedDistance(cm | null)`, valid range
       `[2, 400]` cm at the factory-spec `58 µs/cm` round-trip) and the
       only real behavior is the TRIG/ECHO pulse: `update()` watches for a
       **rising edge** on `trig` (previous-value tracking across ticks)
       and drives `echo` HIGH for `distance × 58 µs` of accumulated `dt`
       then LOW — a cross-tick timer (`elapsedSeconds`/`echoDurationSeconds`).
       Mid-pulse retriggers are ignored; `null` or out-of-range ⇒ **no
       echo at all** (no ~38 ms no-echo timeout — see `docs/DECISIONS.md`).
       Unlike the PIR, the parametric stimulus does **not** ride `press`:
       it has its own `top-setSimulatedDistance` message routed by
       `CircuitHost.setSimulatedDistanceMessage` — the real instantiation
       of the `HasStimulus<T>` "parametric stimulus" note. View uses the
       **published `wokwi-hc-sr04` unchanged** (no interaction handlers at
       all — a third direct-use part after the resistor; the element's
       `pinInfo` ARE the `ultrasonicPinOffsets` canvas surface): static
       art + a linear distance slider under the body (2..400 cm; dragging
       to/past the far end = `null` = "no object"), relayed as
       `setSimulatedDistance`. Palette entry, canvas
       offsets/render/drop, and worker `addComponent` +
       `setSimulatedDistance` cases wired. The bridge gains
       `micros()`/`tickUs(us)` on top of a new `CircuitHost` sim clock
       (`simTimeSeconds`/`getSimTimeMicros()`) so real Python can time a
       TRIG pulse in µs despite the fixed 1/60 s tick. Verified by
       `UltrasonicSensor.test.ts` (7), CircuitHost e2e (routed ECHO on
       GPIO10 IN: 300 cm → 17.4 ms HIGH; null → no echo; sim clock
       reading), canvas render/slider/drop tests (34 total), and
       `browser-verify.mjs` step 14 (real Python TRIG/ECHO over
       GPIO9/GPIO10 measuring 300/360 cm to the µs + NO_ECHO at the
       null-stop).
- [x] **Wokwi-style UI polish** ("Blueprinted Bench", applied from the
       installed `frontend-design` / `designing-frontend-interfaces`
       opencode skills — token layer before component code):
       code editor left, canvas **+ output console right**, parts added
       through the blue **"+" button / `A` key** picker (land at the
       stage point under the viewport's top-left, then dragged). Chrome:
       `index.css` token layer (IBM Plex Sans + IBM Plex Mono, one
       `#1f8aff` accent, 4px space scale) + `.app-shell`/`.topbar`/
       `.workspace`/`.pane`/`.console` classes; `ComponentPalette` →
       `ComponentPicker` (popover `role="listbox"`, items always
       mounted); `ScriptPanel` editor-only; new `OutputConsole`
       (`data-testid="output"` below the canvas); canvas toolbar with
       zoom −/+ (1.1×, clamp 0.25–3, window-centered), reset view, grid +
       mm ruler toggle (`G`, ticks at 3.78 px/mm, on by default), and
       Delete (moved into the toolbar, disabled without a selection).
       Drag-and-drop (`COMPONENT_MIME` + canvas `handleDrop`) kept as a
       hidden compat path so every existing drop jsdom test and
       browser-verify drag step is untouched. Gates green: typecheck,
       **169 pass + 1 skipped**, build, browser-verify ALL CHECKS PASS
       (sub-pixel pin asserts intact on every part).
- [ ] Validation / error states beyond conflict detection (undeclared
       pins, unmapped Python pin numbers, etc.) — not started.
- [ ] Component library beyond LED/Button/Relay/Transistor/Stepper/PIR/Potentiometer/Resistor/Capacitor/Ultrasonic — not
       started (intentionally; see "Don't pre-build" rule in
       `docs/ROADMAP.md`)

## Where to go next

- **Why we made the decisions we did** → `docs/DECISIONS.md`
- **How the pieces fit together, in depth** → `docs/ARCHITECTURE.md`
- **What order to build things in, and what's done** → `docs/ROADMAP.md`
- **How to add a new component correctly** → `docs/COMPONENT_GUIDE.md`

## Ground rules for any agent working on this codebase

1. Follow the one-way dependency rule above. No exceptions without
   discussing it with the project owner first.
2. Don't build components speculatively (e.g. sensors) before they're
   actually being wired into a feature. See `docs/ROADMAP.md`.
3. Keep new components as minimal as possible on first implementation
   (see `LED` — on/off only, no brightness). Extend later, only when
   needed.
4. Any change to the engine's public shape (e.g. `Component`,
   `RenderInfo`) should be checked against `docs/ARCHITECTURE.md` to
   make sure it doesn't contradict a documented reason something is
   built the way it is.
5. If you make a real architectural decision, add it to
   `docs/DECISIONS.md` rather than letting it live only in commit
   history or chat logs.
