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
   reading/writing `PicoBoard` pins. ⬜ Not started.
4. **Validation / error states** — e.g. proper conflict/short-circuit
   detection on nets with multiple drivers (currently a known gap,
   silently resolves to `FLOATING` — see `docs/ARCHITECTURE.md`). ⬜
   Not started.
5. **Expand component library** — add components one at a time, as
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
  - Demo (`src/App.tsx`): button → `GPIO15` → LED anode, cathode → GND;
    press and hold the green button to light the LED. Note: the board
    GPIO pin defaults to `UNSET` mode, so the demo sets
    `board.pin("GPIO15").mode = "IN"` (mirrors the machine.Pin shim) —
    this is why the LED test asserted against `data-on`/anode rather
    than relying on GPIO15 alone.

- `Button` is the second real component, built for a stated, concrete
  reason: to exercise the **driver side** of net resolution ahead of
  canvas work. Its `signal` pin is `OUT`, so it drives nets rather than
  listening to them — exactly the role a user-interactive input
  component plays in the upcoming canvas editor. It follows the pattern
  documented in `docs/COMPONENT_GUIDE.md`.
- `README.md` maintained at project root with current status and run
  instructions. Keep it updated as work progresses.
- Next up: code execution (Roadmap step 3) — Pyodide in a Web Worker
  plus the `machine.Pin` shim reading/writing `PicoBoard` pins.

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

- Multi-driver net conflicts (two `OUT` pins fighting over one net)
  currently silently resolve to `FLOATING`. Intended to become a real
  conflict/short-circuit state — deferred to the validation-states
  phase, not fixed ad hoc before then.
- The `HasStimulus<T>` interface pattern for sensor-style components is
  documented (`docs/ARCHITECTURE.md`) but not implemented. Implement it
  only alongside the first real sensor component.
- Canvas is a single fixed demo layout so far: no drag-to-move, no
  component palette, and no way to delete a wire/component. Interaction
  is click-to-wire only, by design for this milestone. Drag-based
  editing (and the layout/styling polish that goes with a real editor)
  is deferred.
- Some components (e.g. an ultrasonic distance sensor with
  trigger/echo timing) will need to track internal state across ticks,
  not just react statelessly each `update()` call. No component
  needing this exists yet, but `update(dt)` already takes a `dt`
  parameter in anticipation of timing-based logic.

## Resolved / closed items

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
