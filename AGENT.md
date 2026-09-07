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
- [x] `PicoBoard` component (GPIO0–GPIO28, 3V3, GND)
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
      demo button lights its LED: 3V3 → button.leg1a → button.leg2a →
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
      Current totals: **74 passing + 1 skipped** (18 Circuit / 4 analog /
      6 button / 14 CircuitHost / 23 canvas / 9 App /
      Pyodide.integration skipped by default — run it with
      `npm run verify:python`).
- [x] Analog value channel on `Pin` (`analogValue: number | null`, 0–1
      duty for OUT pins) + analog propagation step in `Circuit.tick()`,
      independent of the digital channel; covered by
      `src/engine/__tests__/Analog.test.ts` (4 tests passing).
      **Note:** `machine.PWM` shim and LED brightness are still
      separate, un-started work — committing to the channel does
      not do either of those.
- [x] Canvas rendering — in `src/ui/`
      (`CircuitCanvas.tsx` + `components/{LedView,PicoBoardView,
      ButtonView}.tsx`). Since the execution milestone it is a
      **snapshot renderer + relay** that owns no engine objects and
      never talks to the worker (the parent `App` relays). Since the
      wokwi milestone it renders a fixed 1200×700 HTML stage
      (`data-testid="circuit-stage"`) scaled by a CSS transform from a
      ResizeObserver, with component bodies as absolute-positioned divs
      (`data-testid="body-<id>"`) — real interactive DOM — under two SVG
      overlays (`data-layer="wires"|"pins"`, `pointer-events:none`
      svgs, `auto` on individual wire/pin groups). The overlays carry
      the **same `transform: scale()`** as the stage (both pin/wire SVG
      coords stay in stage units), and each marker sits at its body
      origin + the wokwi element offset (LED anode `(25,42)`/
      cathode `(15,42)`; button `1.l(0,13)`/`1.r(67,13)`/`2.l(0,32)`/
      `2.r(67,32)`; board GPIO0–28 `x = 14 + i*10`, `3V3`=304, `GND`=314,
      `y`=112) — asserted to sub-pixel in browser-verify step 1b. LED
      and button visuals are the **published `@wokwi/elements`** (MIT)
      package custom elements, registered once via the side-effect
      `import "@wokwi/elements"` in `main.tsx` and driven through refs
      — boolean props set as JS properties because LitElement reads
      attributes as strings. They are a normal npm dependency (a
      vendoring attempt was evaluated and reverted as unnecessary since
      the package ships pre-compiled JS; see `docs/DECISIONS.md`); the
      pin offsets come from the elements' `pinInfo`. The board stays a
      hand-drawn SVG. All client→stage
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
      Known limits: `machine.PWM`/`ADC`/`I2C`, pause/step debugging,
      and wakeable/precise sleeps are not implemented. The JSPI
      non-blocking `time.sleep` (responsive sim mid-sleep) works in
      Chrome/Edge; **Firefox has no JSPI, so it busy-waits** (script
      pauses the worker for the sleep duration). See DECISIONS.
- [x] Component palette + drag interaction
      (`src/ui/ComponentPalette.tsx`, `src/App.tsx`,
      `src/App.test.tsx`): the palette offers LED and Button (no second
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
      tests and a browser-verify step (3V3↔GND short → red dashed
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
- [ ] Validation / error states beyond conflict detection (undeclared
      pins, unmapped Python pin numbers, etc.) — not started.
- [ ] Component library beyond LED/Button/pulls — not started
      (intentionally; see "Don't pre-build" rule in `docs/ROADMAP.md`)

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
