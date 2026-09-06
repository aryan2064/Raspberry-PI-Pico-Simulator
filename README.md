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

This is an early-stage project. The **foundation is built and verified**,
and the **first canvas rendering layer works in-browser**; Python
execution is next.

| Area | Status |
| --- | --- |
| Engine data model (`Pin`, `Wire`, `Component`, `Circuit`, `PicoBoard`, `LED`, `Button`) | ✅ Built, split into `src/engine/`, unit-tested |
| Net resolution via union-find + `tick(dt)` simulation step | ✅ Built & tested |
| Analog channel (`Pin.analogValue`, 0–1 PWM duty) + analog propagation in `tick()` | ✅ Built & tested (digital behavior untouched) |
| `Button` (drives nets HIGH/LOW via `press()`/`release()`; exercises the driver side of net resolution) | ✅ Built & tested |
| Unit tests (Vitest) | ✅ 18 passing (13 engine / 5 UI-jsdom) |
| Vite + React + TypeScript scaffold | ✅ Builds & runs |
| Canvas rendering (SVG; components from `getRenderInfo()`, click-to-wire, click-to-delete-wire, 60fps sim loop) | ✅ First layer built & tested |
| Pyodide in a Web Worker + `machine` shim | ⬜ Next up |
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
npm test              # run all Vitest engine tests once
npm run test:watch    # run tests in watch mode
npm run typecheck     # TypeScript strict check, no emit
npm run build         # typecheck + production build to dist/
npm run preview       # preview the production build
```

The engine test suites run in plain Node — no browser needed. This is
intentional: the engine layer must stay testable without any
DOM/React/Pyodide, per `docs/ARCHITECTURE.md`. Three engine suites:
`Circuit.test.ts` (digital net resolution, 5 tests), `Analog.test.ts`
(analog `analogValue` channel: single-driver propagation, no-driver →
`null`, multi-driver placeholder, channel independence, 4 tests) and
`Button.test.ts` (drives HIGH while pressed / LOW after release,
`getRenderInfo()` reflects `isPressed`, 3 tests).

The canvas layer is tested separately under **jsdom**
(`src/ui/__tests__/CircuitCanvas.test.tsx`, 5 tests) with fake timers
driving the sim loop: components/wires render; pressing the button
drives `GPIO15` HIGH and lights the LED, release turns it off;
click-to-wire creates and renders a fourth wire; same-pin double-click
cancels; clicking a rendered wire removes it from the DOM and breaks
the underlying connection. Dev deps `jsdom` + `@testing-library/react`
are required for this suite only.

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
  ui/                React + SVG canvas rendering (first layer built)
    CircuitCanvas.tsx     SVG root: exhaustive RenderInfo dispatch,
                          click-to-wire, 60fps sim loop, wire rendering
    components/           LedView, PicoBoardView, ButtonView (presentational)
    __tests__/            jsdom UI tests (CircuitCanvas.test.tsx)
  execution/         Pyodide + machine shim    (not started)
docs/
  AGENT.md           entry point: architecture rules, current state
  ARCHITECTURE.md    how pieces fit together and why
  DECISIONS.md       settled design decisions
  ROADMAP.md         agreed build order
  COMPONENT_GUIDE.md how to add a new component
```

## Architecture in one paragraph

Three layers with a **one-way dependency rule**: `engine/` never imports
from `ui/` or `execution/`. The engine is pure simulation logic — a
`Circuit` owns components and wires, groups connected pins into **nets**
(union-find), and resolves each net to `HIGH` / `LOW` / `FLOATING` based on
which pins are driving (`OUT`) vs listening (`IN`). It is deliberately not a
circuit solver (no Kirchhoff/SPICE); analog math happens inside a specific
component only when that component needs it. The UI layer only draws what
the engine models via `getRenderInfo()`, and the execution layer fakes
`machine.Pin` so genuine MicroPython code drives engine pins directly.

## What works today

An runnable end-to-end proof: the **interactive canvas demo** in
`src/App.tsx`. `npm run dev`, open the printed URL, and you get a live
circuit on an SVG canvas:

- **Pico board, LED, and button** drawn from engine `getRenderInfo()`.
- **Press and hold the green button** → `GPIO15` goes HIGH → the LED
  lights; release → it goes off. The sim loop ticks `circuit.tick(1/60)`
  ~60 times a second in the browser.
- **Click-to-wire**: click a pin (it highlights), then click a pin on
  another component to create a wire; click the same pin twice to
  cancel. Try wiring the LED anode to `GPIO16` — still works at runtime.
- **Click-to-delete-wire**: click any wire to remove it (hover shows a
  pointer + darker color). The canvas paints bodies → wires → pins in
  three layers, so wires always show on top of component bodies and pins
  stay visible/clickable over everything.

The engine tests (`npm test`) prove the same behavior headlessly, and
the canvas suite (`src/ui/__tests__/CircuitCanvas.test.tsx`) proves the
click-to-wire + press/release interaction end-to-end under jsdom.

## Build order & where things are headed

See `docs/ROADMAP.md`. The next milestones:

1. **Canvas rendering** — components drawn from `getRenderInfo()`, click
   between pins to create wires. ✅ First layer done (fixed layout, no
   drag-to-move yet — see ROADMAP "Open / deferred items").
2. **Code execution** — Pyodide (in a Web Worker) + a `machine` shim so user
   MicroPython like `machine.Pin(15, machine.Pin.OUT).value(1)` flips engine
   pins. ⬜
3. **Validation/error states** — real short-circuit/conflict detection. ⬜
4. **Component library growth** — one component at a time, only when a
   feature needs it. ⬜

## Ground rules for contributors (brief)

- `engine/` must never import from `ui/` or `execution/` — the engine stays
  pure and browser-free.
- Don't build components speculatively; the first version of any component
  should be the minimal one that proves the pipeline end-to-end (LED shipped
  as on/off only, no brightness).
- Real architectural decisions belong in `docs/DECISIONS.md`.