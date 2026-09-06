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
  block the UI thread)
- No backend. Everything runs in the user's browser.

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
- [x] `Button` component (drives `signal` HIGH/LOW from `press()`/`release()`;
      second real component, built to exercise the driver side of net
      resolution — an `OUT` pin driving nets — ahead of the canvas work
      that will need a user-interactive input component)
- [x] Vite + React + TypeScript project scaffolded (project root), builds
      and typechecks clean, `npm run dev` shows the interactive canvas
      (button → LED demo)
- [x] Data model split into `src/engine/` files: `Pin.ts`, `Wire.ts`,
      `Component.ts`, `Circuit.ts`, `RenderInfo.ts`, plus
      `src/engine/components/{PicoBoard,LED,Button}.ts` and an index barrel
- [x] Vitest tests: engine suites (13 passing, plain Node) + canvas UI
      suite under jsdom (5 passing, `src/ui/__tests__/CircuitCanvas.test.tsx`)
- [x] Analog value channel on `Pin` (`analogValue: number | null`, 0–1
      duty for OUT pins) + analog propagation step in `Circuit.tick()`,
      independent of the digital channel; covered by
      `src/engine/__tests__/Analog.test.ts` (4 tests passing).
      **Note:** `machine.PWM` shim and LED brightness are still
      separate, un-started work — committing to the channel does
      not do either of those.
- [x] Canvas rendering (first layer) — SVG in `src/ui/`       \
      (`CircuitCanvas.tsx` + `components/{LedView,PicoBoardView,
      ButtonView}.tsx`). Three explicit SVG layers, painted
      bodies → wires → pins (so wires always sit on top of component
      bodies and pins stay visible/clickable on top of everything).
      Components drawn from `getRenderInfo()` via exhaustive render
      dispatch; click-to-wire pin connections (first click = pending
      source, second click on a different pin = connect, same pin twice
      = cancel); wires are clickable with a wide transparent hit-area +
      hover highlight, and clicking a wire calls
      `circuit.disconnect(id)` + `resolveNets()`; ~60fps simulation
      loop driving `circuit.tick(1/60)`. Canvas positions, the pending
      wire, and hovered wire are the only UI-owned state —
      wires/components/pins/values always read from the engine each
      render. Verified by jsdom UI tests.
- [ ] Pyodide + `machine` shim — not started
- [ ] Validation / error states (e.g. short-circuit detection) — not
      started; known gap flagged in code comments (see `tick()` in
      `src/engine/Circuit.ts` — conflicting drivers on a net currently
      silently resolve to FLOATING instead of raising a conflict state)
- [ ] Component library beyond LED — not started (intentionally; see
      "Don't pre-build" rule in `docs/ROADMAP.md`)

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
