# Architecture

This doc explains how the pieces fit together and *why* they're shaped
the way they are. If you're about to change the shape of `Component`,
`Pin`, or `RenderInfo`, read this first.

## Layered structure

```
src/
  engine/       pure simulation. No DOM, no React, no Pyodide.
    Pin.ts
    Wire.ts
    Component.ts
    Circuit.ts
    components/
      LED.ts
      PicoBoard.ts
  ui/           React + canvas. Imports from engine, never the reverse.
  execution/    Pyodide + machine shim. Imports from engine, never the reverse.
```

The `engine` layer must be usable and testable with plain `node` and no
browser — no `window`, no `document`, no async loading. This was
validated early: a full `Pin → Wire → Circuit → LED` flow was compiled
and run from the command line before any UI existed, to prove the model
was correct independent of rendering.

Why this separation matters in practice: without it, canvas code
("where's the mouse," "what's the SVG path") gets tangled with circuit
logic ("what's this net's value"), and debugging becomes ambiguous —
you can't tell if a bug is in your simulation or your rendering. Keeping
them apart means a wiring bug and a click-detection bug are obviously
different files, different tests, different mental models.

## Core data model

### `Pin`

Represents one connection point on a component.

- `id` — internal stable UUID, identity only.
- `label` — human-readable name (e.g. `"GPIO15"`, `"anode"`, `"VCC"`).
  Two different concerns: `id` is for internal bookkeeping (union-find,
  Map keys), `label` is for lookup by humans, canvas rendering, and the
  eventual `machine.Pin` shim resolving e.g. pin number 15 to the
  physical GPIO15 pin object.
- `mode` — `IN | OUT | UNSET`. Determines whether a pin can drive a net
  or only listen to it.
- `value` — `HIGH | LOW | FLOATING`. Computed by net resolution for
  `IN` pins; set directly by component logic (or later, the Python
  shim) for `OUT` pins.
- `analogValue` — `number | null`, default `null`. A separate, optional
  analog channel, independent of `value`. For an `OUT` pin it represents
  a PWM duty cycle (range 0–1); for an `IN` pin it's the analog value
  propagated from its net by `Circuit.tick()`. `null` means "not
  currently driving/carrying an analog signal" — deliberately distinct
  from digital `FLOATING`, which applies only to the digital channel. A
  pin can be digitally `FLOATING` while holding a valid `analogValue`,
  or vice versa. No existing component uses it yet (`LED` is on/off
  only); it's the settled channel future analog components and the
  `machine.PWM` shim will build on. See `docs/DECISIONS.md`.
- `netId` — which net (group of connected pins) this pin currently
  belongs to. Set by `Circuit.resolveNets()`.

### `Wire`

Just a pair of `Pin` references (`a`, `b`) plus an id. No pixel/path
data — that's a UI-layer concern (the canvas derives where to draw a
wire from the positions of the components it connects, but that's UI
state, not stored on `Wire` itself).

### `Component` (abstract base)

```ts
abstract class Component {
  readonly id: string;
  readonly pins: Pin[];

  pin(label: string): Pin;      // named lookup, throws if missing
  abstract update(dt: number): void;
  abstract getRenderInfo(): RenderInfo;
}
```

- `pin(label)` throws on a missing label rather than returning
  `undefined`. A missing pin is a programming error (typo, wrong
  component), not a case to handle gracefully — better to fail loudly
  at the call site than propagate a silent `FLOATING` value that's
  confusing three steps later.
- `update(dt)` runs once per simulation tick, **after** net resolution
  and value propagation — so a component's `update()` can trust that
  its `IN` pins already reflect the current net state for this tick.
- `getRenderInfo()` returns a snapshot describing what the component
  currently looks like — it does not compute anything, just reports
  state that was already computed in `update()`. The canvas UI reads
  this and decides how to draw it; `Component` never touches pixels.

### `RenderInfo` — discriminated union, not a generic bag of fields

```ts
type RenderInfo =
  | { type: "led"; isOn: boolean }
  | { type: "pico_board" };
```

Considered and rejected: a generic `{ type: string; [key: string]: unknown }`
shape. Rejected because it leads to stringly-typed guessing in the
canvas code (`info.brightness as number`) and silent typo bugs at
runtime. The discriminated union means:

- Each component type only carries the fields it actually needs.
- TypeScript forces exhaustive handling in the canvas's render switch —
  adding a new component type without updating the renderer is a
  compile error, not a silent visual bug.

Add one union member per new component, as that component is actually
built. Don't pre-add variants for components that don't exist yet.

### `Circuit`

Owns all components and wires. Two responsibilities, deliberately kept
separate:

1. **`resolveNets()`** — union-find over the wire list, grouping
   connected pins into nets. Called only when wiring changes (add/
   remove a wire), not every tick — recomputing this every frame would
   be wasted work since wiring is comparatively rare compared to ticks.
2. **`tick(dt)`** — the per-frame simulation step:
   a. For each net, look at all `OUT`-mode pins in it (the "drivers").
   b. If exactly one driver, the net's value is that driver's value.
   c. If zero drivers, the net is `FLOATING`.
   d. If more than one driver, this is a real conflict (two outputs
      fighting over one net) — currently this silently resolves to
      `FLOATING` as a placeholder. **This is a known, deliberate gap**,
      not an oversight: proper conflict/short-circuit detection belongs
      in the validation layer (see Roadmap), not baked into core net
      resolution.
   e. Propagate the resolved value to every `IN`-mode pin in the net.
   f. **Analog propagation (separate channel).** Mirrors steps a–e but on
      `analogValue`, not `value`. For each net, find pins where
      `mode === "OUT"` and `analogValue !== null`. If exactly one such
      pin, propagate its `analogValue` to every `IN`-mode pin in the
      net. If zero, leave `IN` pins' `analogValue` as `null`. If more
      than one, multiple analog drivers are fighting over one net — the
      same kind of conflict as the digital case, currently resolving to
      `null` as a placeholder for the same reason (real conflict/short-
      circuit handling belongs in the validation layer, not core net
      resolution).
   g. Call `update(dt)` on every component, in registration order.
   h. **Repeat the digital and analog propagation passes (only) — no second
      `update()` call.** A component that writes its own output pin from
      inside `update()` (e.g. `Button` setting its `signal` pin from
      `pressed`) has that value re-propagated to listening pins within the
      **same** `tick()`, rather than one tick later. This is why an input
      press is visible to net listeners before `tick()` returns.

## Why digital nets instead of a circuit solver

A true circuit simulator solves Kirchhoff's current/voltage laws
numerically (SPICE-style). This is substantial numerical-methods work
and is unnecessary for the vast majority of what this tool needs to
support: GPIO logic, buttons, LEDs, most digital peripherals.

Instead: pins are `HIGH` / `LOW` / `FLOATING`, resolved per-net from
whichever pins are currently driving. Where a specific component
genuinely needs analog behavior (e.g. LED brightness from a resistor
value, a potentiometer's voltage divider, a capacitor's charge curve),
that math is implemented **inside that component's own `update()`**,
as a local special case — never as a general physics engine applied to
every component.

## Sensors / stimulus inputs (not yet built, documented for later)

Sensor-style components (proximity, PIR, etc.) have a concern that
output-only components like LED don't: something has to supply a fake
real-world stimulus (distance, motion) since there's no physical world
to sense. The intended pattern, not yet implemented:

```ts
interface HasStimulus<TStimulus> {
  setStimulus(input: TStimulus): void;
}
```

An optional interface, not part of the `Component` base class, so
non-sensor components never need to stub out a meaningless method. Only
implement this when actually building the first sensor component — see
`docs/ROADMAP.md`.

## Python execution model (planned, not yet implemented)

- **Pyodide** (CPython compiled to WebAssembly) runs entirely
  client-side. Chosen over a sandboxed backend because: no server
  infra, no arbitrary-code-execution security surface to defend
  (browser sandboxing handles that for free), instant iteration with
  no network round trip, and works offline once loaded.
- Must run inside a **Web Worker**, not the main thread — otherwise a
  running simulation freezes the canvas/UI. This must be designed in
  from the start of the execution module, not retrofitted after
  noticing jank.
- The `machine` module (specifically `machine.Pin` first, later
  `machine.PWM`, `machine.ADC`, `machine.I2C` as needed) is shimmed:
  user calls like `machine.Pin(15, machine.Pin.OUT)` and
  `.value(1)` map directly onto reading/writing the corresponding
  `Pin` object on the `PicoBoard` component in the engine layer. User
  code is real, valid MicroPython — it's the library underneath that's
  fake.
