# Roadmap

## Agreed build order

1. **Data model** — `Pin`, `Wire`, `Component`, `Circuit` (net
   resolution + `tick`), `PicoBoard`, one real component (`LED`). ✅
   Built and verified running standalone in plain Node, with no UI.
2. **Canvas rendering**, built against the existing engine skeleton —
   the canvas asks components for `pins` and `getRenderInfo()`, and
   creates a `Wire` when the user clicks between two pins. The canvas
   must never invent its own idea of what a connection or component
   is — it only visualizes what the engine already models. ✅ First
   layer built & verified (see "Canvas rendering" under Current status
   detail).
3. **Code execution** — Pyodide in a Web Worker, `machine.Pin` shim
   reading/writing `PicoBoard` pins. ✅ Built & verified (see "Code
   execution" under Current status detail). Limits: Pin-only shim,
   busy-wait `sleep`, non-cooperative Stop-by-replay. `machine.PWM`,
   `ADC`, `I2C`, pause/step debugging still open.
4. **Component palette / drag editing** — user-placed parts: drop a
   palette component onto the canvas, drag it around, then wire it like
   the demo parts. ✅ Built & verified (see "Component palette + drag"
   under Current status detail). Deferred next item: **deleting placed
   components** (and the wires on them).
5. **Validation / error states** — e.g. proper conflict/short-circuit
   detection on nets with multiple drivers (currently a known gap,
   silently resolves to `FLOATING`). ✅ **Conflict detection built for
   this scope** (see "Conflict detection" under Current status detail):
   multi-driver nets still resolve to `FLOATING`/`null`, but every pin
   on such a net now carries a `hasConflict` diagnostic flag, the worker
   lists the conflicted pin ids in each snapshot, and the canvas paints
   the affected wires as red/dashed with a conflict banner. Un-started
   within step 5: other validation states (undeclared pins, unmapped
   Python pin numbers, etc.).
6. **Expand component library** — add components one at a time, as
   actually needed by a feature or example being built, not
   speculatively. ◐ Beyond `LED` only by `Button` (see "Current status
   detail" — built for a stated, concrete reason). Not otherwise
   started.

Work should generally proceed in this order. Skipping ahead (e.g.
building canvas polish before the data model is solid, or building
sensor components before any feature needs them) has already been
explicitly discussed and rejected once — see `docs/DECISIONS.md`
before deciding to skip ahead again.

## Current status detail

- Engine code is split into the intended `src/engine/{Pin,Wire,
  Component,Circuit,RenderInfo}.ts` + `src/engine/components/{LED,
  PicoBoard,Button}.ts` structure, with an index barrel
  (`src/engine/index.ts`). See `docs/ARCHITECTURE.md` for the file
  layout.
- Vite + React + TypeScript scaffolded at project root (`package.json`,
  `vite.config.ts`, minimal placeholder `App.tsx` that runs a real
  engine circuit in-browser). Build, typecheck, and dev server all
  verified working.
- Engine unit tests written and passing (5 tests in
  `src/engine/__tests__/Circuit.test.ts`, run via `npm test` with
  Vitest, no DOM/browser needed). Covers: LED on/off from a driven GPIO,
  floating (undriven) nets, multi-driver conflict placeholder, and net
  grouping/transitive wiring. A second suite in
  `src/engine/__tests__/Analog.test.ts` (4 tests) covers the analog
  `analogValue` channel: single-driver propagation, no-driver → `null`,
  multi-driver `null` placeholder, and independence of the analog vs
  digital channels. A third suite in
  `src/engine/__tests__/Button.test.ts` (3 tests) covers the `Button`
  component: drives a connected IN pin HIGH while pressed / LOW after
  release, and reflects `isPressed` in `getRenderInfo()`.

- **Canvas rendering** (Roadmap step 2) — first layer built and
  verified. Live in `src/ui/`:
  - `CircuitCanvas.tsx` — the SVG root (viewBox 1200×700). Renders in
    three explicit layers, painted bodies → wires → pins, so a wire can
    never be hidden behind a component body and pin markers stay
    visible/clickable on top of everything. Renders every engine
    component via an exhaustive `switch (info.type)`
    dispatch over `RenderInfo` (a newly-added `RenderInfo` variant is a
    compile error until a view handles it), plus engine wires as SVG
    lines between pin screen positions. Runs the simulation loop with
    `setInterval(..., 1000/60)` calling `circuit.tick(1/60)` then
    bumping a frame counter to re-render.
  - `components/LedView.tsx`, `PicoBoardView.tsx`, `ButtonView.tsx` —
    purely presentational SVG bodies (pin markers are drawn centrally by
    `CircuitCanvas` in the pins layer, off the `PIN_OFFSETS` maps each
    view exports). `ButtonView` is the
    one documented exception to pure presentation: it calls
    `component.press()` / `component.release()` on the body
    mousedown/mouseup so the button behaves like the real thing.
  - **Click-to-wire**: first pin click stores a pending source in UI
    state, second click on a different pin calls
    `circuit.connect(pending, pin)` + `circuit.resolveNets()` (only on
    wiring change, never per-tick), same pin twice cancels.
  - **Click-to-delete-wire**: each wire is wrapped in a clickable group
    with a generous transparent hit line (14px) behind the visible 2px
    line, plus a hover highlight + pointer cursor. Clicking calls
    `circuit.disconnect(id)` + `circuit.resolveNets()` and re-renders.
  - **UI-only state rule**: the canvas stores only genuinely UI state —
    component positions, the pending wire, and the hovered wire.
    Wires/components/pins/values are always read from the
    engine each render.
  - Tested via `src/ui/__tests__/CircuitCanvas.test.tsx` (5 tests,
    `// @vitest-environment jsdom` with fake timers): components and
    existing wires render; press-and-hold drives `GPIO15` HIGH and the
    LED `data-on` flips to `true` (release → `false`); clicking LED
    anode then `GPIO16` creates a fourth wire; same-pin double-click
    cancels; clicking a wire removes it from the DOM and the circuit,
    leaving its pins in a driverless net. Deps added: `jsdom`,
    `@testing-library/react`,
    `@testing-library/dom`; `src/test/setup.ts` patches jsdom's missing
    `crypto.randomUUID` (the engine's `newId()`) and is registered via
    vite.config `test.setupFiles`. The engine gained exactly one method
    for this step, `Circuit.disconnect(wireId)` (engine tests: 13
    passing).
  - Demo (`src/App.tsx`): two independent demo nets so the interactive
    and Python demos never fight —
    *button → `GPIO15` → LED* (press and hold the green button to light
    it) and *LED2 anode ↔ `GPIO16`* (driven by the default MicroPython
    blink script; cathode → GND). An OUT pin may not share a net with
    the button's `signal` OUT pin, or the engine's multi-driver conflict
    placeholder resolves the net to `FLOATING`. Board GPIO pins default
    to `UNSET` mode and only "hear" propagated values once set `IN` by
    the `machine.Pin` shim — the LED anode works because it's an `IN`
    listener on its net.

- `Button` is the second real component, built for a stated, concrete
  reason: to exercise the **driver side** of net resolution ahead of
  canvas work. Its `signal` pin is `OUT`, so it drives nets rather than
  listening to them — exactly the role a user-interactive input
  component plays in the upcoming canvas editor. It follows the pattern
  documented in `docs/COMPONENT_GUIDE.md`.

- **Code execution** (Roadmap step 3) — built and verified. Live in
  `src/execution/` + rewired canvas:
  - `worker-core.ts` — `CircuitHost`, a plain-TS class that **owns the
    live `Circuit`** and handles every edit message
    (`addComponent`/`connect`/`disconnect`/`press`/`release`, plus
    `tick`, `setupPin`/`readPin`/`writePin` bridge methods, and
    `getSnapshot`). It has zero Worker/Pyodide APIs so it's unit-testable
    in plain Node (`src/execution/__tests__/CircuitHost.test.ts`, 6
    tests).
  - `messages.ts` — the whole client↔worker protocol (main→worker:
    addComponent/connect/disconnect/press/release/run; worker→main:
    snapshot/stdout/error/ready). Topology types shared with the app so
    the replay and the render data literally cannot drift apart.
  - `machine-shim.py` — the importable `machine` module (Pin with
    IN/OUT + value/high/low/on/off/toggle; `time.sleep` busy-wait).
    Installed into Pyodide via `exec` into a `types.ModuleType`.
  - `pyodide.worker.ts` — the Worker entry: a **module worker** that
    imports Pyodide's JS runtime from the **npm package** (`pyodide`
    v0.314) and fetches only the static WebAssembly/stdlib assets
    from the jsDelivr CDN (`v314.0.6/full`) via the loader's
    `indexURL` (no `importScripts` — a classic worker would be a
    syntax-error in dev and is rejected outright by the npm loader).
    Installs the shim + bridge, runs its own ~60fps tick/snapshot
    loop, routes stdout/stderr/errors, and runs user code with
    try/catch → `{type:"error"}`. Bridge is attached to
    `globalThis` (see DECISIONS — `from js import` proxies the JS
    global scope).
  - `src/App.tsx` — worker lifecycle: spawns the worker, keeps the
    authoritative **topology record** + latest **snapshot** (not engine
    objects), relays canvas interactions to the worker, and on **Stop**
    terminates the worker **and** immediately respawns + replays the
    topology (non-cooperative stop — see DECISIONS). UI state is only
    the snapshot, the connection list, and the output log. Worker
    failures are surfaced (`worker.onerror`/`onmessageerror`, a
    `worker-issue` banner, and a 5s first-snapshot watchdog), so a
    dead worker is never silently blank.
  - `CircuitCanvas.tsx` — rewritten as a pure **snapshot renderer +
    relay**: draws bodies→wires→pins from the snapshot message (no
    engine objects), emits `onPress`/`onRelease`/`onConnect`/`onDisconnect`.
  - `ScriptPanel.tsx` — MicroPython editor (blink demo), Run/Stop, and
    a scrolling output panel.
  - Verification: engine tests untouched (13); 27 Vitest tests total
    (13 engine / 8 canvas jsdom / 6 CircuitHost); typecheck + build
    clean; `npm run verify:python` runs the **real Pyodide** (npm
    package) against the real `machine-shim.py` + `CircuitHost` in Node
    — machine.Pin drives a wired LED on/off, IN pins read correctly,
    busy-wait `time.sleep` actually blocks, stdout routes, and
    out-of-scope `machine.PWM` raises a clean ImportError. Real-browser
    coverage is automated too: `node scripts/browser-verify.mjs
    <url>` drives headless Edge over CDP through canvas-render, button
    relay, Run-blinking-LED2, and Stop-mid-`while True` recovery — run
    against both `npm run dev` and the production build, all green.

- **Component palette + drag editing** (Roadmap step 4) — built and
  verified. Live in `src/ui/ComponentPalette.tsx`, `src/ui/CircuitCanvas.tsx`,
  `src/App.tsx`:
  - `ComponentPalette.tsx` — sidebar drag sources for LED and Button
    only (no second PicoBoard; the board stays a singleton from the demo
    topology). Drag payloads use a custom MIME type
    (`application/x-pico-component`).
  - Drop-to-place: `CircuitCanvas` converts the drop's client coords into
    SVG coords via `getScreenCTM().inverse()` (falling back to client
    coords when no usable screen transform exists, e.g. jsdom), then
    `App` records the part in the topology record under a fresh `placed-N`
    id and posts the same `addComponent` message the init/replay path
    uses — worker-side, a palette part is indistinguishable from a demo
    part (verified live, worker stays engine-only). Positions are
    **UI-only** React state (`Record<componentId,{x,y}>`), never sent to
    the worker, so Stop/respawn never moves anything.
  - Drag-to-move: body pointers move a part only after a 4px threshold,
    so button presses and pin clicks below it are untouched; a committed
    drag cancels an in-flight button press so a button never sticks
    pressed mid-drag.
  - Verification: 3 new canvas jsdom tests (drop places at the drop
    point with the right kind, non-palette payloads ignored, drag
    threshold + move + final position, wires re-render from moved
    positions) and 4 new App-level tests with a fake `Worker` stub
    (palette contents, drop → worker message, pin-click wiring of a
    placed part, Stop replay survival of a placed part + its wire).
    `scripts/browser-verify.mjs` gained a palette step (drop → pin-wire →
    drag → Stop) run against dev and the production build — green.
  - Immediate next item (deferred by design): **deleting placed
    components** and the wires attached to them.

- **Deleting placed components** (Roadmap step 4 follow-up) — built and
  verified: `Circuit.removeComponent(componentId)` cascades every wire
  touching the removed component's pins; `CircuitHost` exposes a
  `removeComponent` message that refuses the PicoBoard (engine-level
  error → `{type:"error"}` post) and prunes the wireId→engineWireId map
  so a later `disconnect` can't target a ghost id; the canvas supports
  plain-click selection with a highlighted ring + a floating Delete
  button and the Delete/Backspace keys (guarded so they never fire while
  a text field has focus); `App` drops the part from the topology record
  + positions so it can't reappear after a Stop respawn. Verified by 3
  engine tests, 3 CircuitHost tests, 8 canvas tests, 5 App tests, and a
  new browser-verify step (select → Delete button, Delete key,
  editor-focus guard, non-reappearance after Stop) against dev and the
  production build.

- **Conflict detection** (Roadmap step 5, this scope) — built and
  verified. `Pin.hasConflict` is a diagnostic-only flag set by
  `Circuit.propagate()` on every pin of any net with
  `digital drivers > 1 || analog drivers > 1` in both passes; value/
  analogValue resolution is unchanged (`FLOATING`/`null`). The worker's
  snapshot now carries `conflictedPinIds` (uuids of flagged pins) and
  per-component `pins: [{ id, label }]`, so the canvas can resolve the
  uuids back to the `componentId:pinLabel` endpoints of the wire
  topology. The canvas paints conflicted wires red + dashed
  (`data-conflicted`) and shows a `⚠ N wire conflicts` banner counting
  the affected connections; the count and wiring stay fully user-driven
  (warning, not prevention — see DECISIONS). Verified by 3 engine tests
  (digital conflict, single driver, two analog drivers), 2 CircuitHost
  tests (GPIO15-as-OUT wired to the button's OUT signal surfaces both
  pin ids; disconnect clears them), 3 canvas tests (single-wire banner,
  plural banner, clear-on-resolve), all green in `npm test` (60 passed +
  1 skipped), typecheck + build clean, and a new browser-verify step
  (wire an OUT board pin to the button's output → red dashed wire +
  banner; disconnect → cleared) against dev and the production build.

- `README.md` maintained at project root with current status and run
  instructions. Keep it updated as work progresses.
- Next up: remaining validation/error states or `machine.PWM` + LED
  brightness once the analog channel has a consumer (bottom of
  "Resolved / closed items").

## Explicit anti-patterns (already discussed and rejected — don't reintroduce)

- **Don't build UI before the data model it renders.** Already
  reversed once early in the project; see `docs/DECISIONS.md`.
- **Don't pre-build components speculatively** (sensors, advanced
  peripherals) before a concrete feature needs them. A
  `ProximitySensor` was built early as a proof-of-shape exercise and
  then deliberately stripped back out for this reason.
- **Don't give a new component full functionality on first pass**
  (e.g. LED brightness, color). Build the minimal version that proves
  the pipeline works end-to-end first; extend only when something
  actually requires the richer behavior.
- **Don't let `engine/` import from `ui/` or `execution/`, ever.** See
  `docs/ARCHITECTURE.md` and `docs/DECISIONS.md`.
- **Don't recompute `resolveNets()` every tick.** It's only needed
  when wiring actually changes; `tick()` should assume nets are
  already current.
- **Don't build a general circuit solver "just in case."** Analog
  behavior is added per-component, only when that specific component
  needs it.

## Open / deferred items worth remembering

- Multi-driver net conflicts (two `OUT` pins fighting over one net) still
  resolve to `FLOATING` (analog: `null`) — the placeholder semantics are
  unchanged. What exists now is the diagnostic layer on top: `hasConflict`
  flag + `conflictedPinIds` in snapshots + red/dashed wire styling + a
  conflict banner (Roadmap step 5, this scope). A stricter dedicated
  `CONFLICT`/short state (and any "forbidden wiring" enforcement) remains
  deferred.
- The `HasStimulus<T>` interface pattern for sensor-style components is
  documented (`docs/ARCHITECTURE.md`) but not implemented. Implement it
  only alongside the first real sensor component.
- Canvas editor polish (measured auto-layout, richer styling for the
  palette/first-run tutorial) is still deferred; deleting placed
  components is done, so the remaining editor concern is aesthetics, not
  missing capability.
- Some components (e.g. an ultrasonic distance sensor with
  trigger/echo timing) will need to track internal state across ticks,
  not just react statelessly each `update()` call. No component
  needing this exists yet, but `update(dt)` already takes a `dt`
  parameter in anticipation of timing-based logic.
- Python execution limits (see DECISIONS): `machine.PWM`/`ADC`/`I2C`
  raise ImportError on purpose; `time.sleep` is non-blocking where JSPI
  (stack switching) is available — Chrome/Edge — and busy-waits otherwise
  (Firefox has no JSPI, so the sim pauses mid-sleep); a precise
  *wakeable* sleep — interrupt it from the main thread mid-sleep — would
  still need SharedArrayBuffer + Atomics and cross-origin isolation); Stop
  is terminate-and-replay, so unsaved Python globals never survive a stop;
  there is no pause/step debugging of running scripts. Browser-only
  flows (Run button end-to-end, Stop-mid-loop recovery) are automated
  via `scripts/browser-verify.mjs` (headless Edge over CDP) — green
  against dev and the production build.

## Resolved / closed items

- **Deleting placed components — done.** `Circuit.removeComponent`
  (boarding-cascade), the `removeComponent` worker message (board
  refused, ghost wireIds pruned), canvas selection + Delete button +
  Delete/Backspace-with-focus-guard, and topology/position cleanup in
  `App` — covered by engine/CircuitHost/canvas/App tests and a
  browser-verify step, dev + production build.
- **Conflict/short-circuit detection (validation states, this scope) —
  done.** Diagnostic-only `Pin.hasConflict`, `conflictedPinIds` +
  per-pin ids in the snapshot, red/dashed conflicted wires and a
  `⚠ N wire conflicts` banner. See `docs/DECISIONS.md`. A stricter
  conflict *state* (not just a flag) and other validation states remain
  open.

- **PWM's data-model representation — resolved.** `Pin` now has a
  separate `analogValue: number | null` channel (0–1 duty for `OUT`
  pins), independent of the digital `PinValue`, and `Circuit.tick()`
  implements the matching analog propagation step (single driver → copy
  to all `IN` pins; none → `null`; multiple drivers → `null` placeholder,
  mirroring the digital conflict case). Covered by Vitest tests in
  `src/engine/__tests__/Analog.test.ts`. See `docs/DECISIONS.md`.
- **Still pending, deliberately separate from the above:** implementing
  `machine.PWM` itself, and adding brightness behavior to `LED`. The
  analog channel exists so those features have something to build on —
  it does not implement them.
