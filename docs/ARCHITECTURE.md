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
- `hasConflict` — `boolean`, default `false`. Diagnostic flag set by
  `Circuit.propagate()`: true when this pin's net has **two or more
  driver pins** (either channel — digital `OUT` pins or pins carrying an
  `analogValue`). It never changes how the net resolves (`value`/`
  analogValue` still fall back to `FLOATING`/`null`); it exists so the
  UI can warn about a live short-circuit. See "Conflict detection"
  below.

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
  | { type: "button"; isPressed: boolean }
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
      fighting over one net) — the net resolves to `FLOATING` as a
      placeholder, and every pin in it is flagged `hasConflict = true`
      (diagnostic only; see "Conflict detection" below). Value
      resolution itself is untouched.
   e. Propagate the resolved value to every `IN`-mode pin in the net.
   f. **Analog propagation (separate channel).** Mirrors steps a–e but on
      `analogValue`, not `value`. For each net, find pins where
      `mode === "OUT"` and `analogValue !== null`. If exactly one such
      pin, propagate its `analogValue` to every `IN`-mode pin in the
      net. If zero, leave `IN` pins' `analogValue` as `null`. If more
      than one, multiple analog drivers are fighting over one net — the
      same kind of conflict as the digital case, currently resolving to
      `null` as a placeholder (and flagging the net, like the digital
      pass).
   g. Call `update(dt)` on every component, in registration order.
   h. **Repeat the digital and analog propagation passes (only) — no second
      `update()` call.** A component that writes its own output pin from
      inside `update()` (e.g. `Button` setting its `signal` pin from
      `pressed`) has that value re-propagated to listening pins within the
      **same** `tick()`, rather than one tick later. This is why an input
      press is visible to net listeners before `tick()` returns.

### Conflict detection (`hasConflict`)

Both propagation passes compute the conflict condition as
`digital drivers > 1 || analog drivers > 1` per net (each pass re-reads
*both* channel counts, so a digital-only conflict survives the analog
pass and vice versa) and stamp `hasConflict` onto every pin in the net.
The resolved `value`/`analogValue` semantics are unchanged — the flag is
purely diagnostic, which is why it lives in the engine's `Pin` and not
as a new `PinValue` variant: components and the `machine` shim need zero
changes and keep reading `FLOATING`/`null` exactly as before. The worker
surfaces the flag in every snapshot as `conflictedPinIds` (the uuid of
each flagged pin) plus each component's `pins` (`id` + `label`); the
canvas resolves those uuids back to wire endpoints through that `pins`
mapping and renders conflicted connections as red, dashed wires with a
conflict-count banner. The user can still wire anything — the goal is to
surface the mistake, not prevent it (`docs/DECISIONS.md`).

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

## Python execution model (implemented)

- **Pyodide** (CPython compiled to WebAssembly) runs entirely
  client-side. Chosen over a sandboxed backend because: no server
  infra, no arbitrary-code-execution security surface to defend
  (browser sandboxing handles that for free), instant iteration with
  no network round trip, and works offline once loaded (cached).
- Runs inside a **Web Worker**, not the main thread — otherwise a
  running simulation freezes the canvas/UI.
- Because user code runs via **`pyodide.runPythonAsync`** (not
  `runPython`), a script's `time.sleep` can free the worker's JS event
  loop for the whole duration *without* the script yielding control in
  any Python-visible way: Pyodide's JSPI
  (`pyodide.ffi.run_sync(asyncio.sleep(...))`) suspends the Python
  task itself. At boot the worker probes
  `pyodide.ffi.can_run_sync()` — from inside a `runPythonAsync` call
  stack, because a top-level call reports `False` even in a JSPI-capable
  runtime (that is run_sync's precondition) — and passes the result to
  the shim bridge as `canRunSync`; where it is false the shim falls back
  to the historical busy-wait `time.sleep` (see `` `machine.Pin`
  semantics and limits``).
- The `machine` module (specifically `machine.Pin` first, later
  `machine.PWM`, `machine.ADC`, `machine.I2C` as needed) is shimmed:
  user calls like `machine.Pin(15, machine.Pin.OUT)` and
  `.value(1)` map directly onto reading/writing the corresponding
  `Pin` object on the `PicoBoard` component in the engine layer. User
  code is real, valid MicroPython — it's the library underneath that's
  fake.

### Why the Circuit physically lives inside the worker

`machine.Pin` writes must be *immediately* visible to the rest of the
simulation **and** to subsequent Python reads. A Web Worker cannot share
JS object references with the main thread — postMessage deep-clones
state. If the engine `Circuit` lived on the main thread, every Python
`Pin.value(1)` would have to round-trip through a message and the Python
code would read stale values from behind the clone boundary. Instead
the **worker owns the live `Circuit`** (`CircuitHost` in
`src/execution/worker-core.ts`); the shim's bridge calls
`host.setupPin/readPin/writePin` directly on the same thread, which do
`circuit.tick()` in place. Worker and UI then communicate only via small,
structured `postMessage` payloads — never shared objects.

### Message protocol (single source of truth: `src/execution/messages.ts`)

Main thread → worker:

- `{ type: "addComponent", componentId, kind }` — create a component
  with an id the main thread chose (the engine constructors accept an
  optional id).
- `{ type: "connect", wireId, pinOwnerIdA, pinLabelA, pinOwnerIdB, pinLabelB }`
  — `wireId` is the main thread's connection id; the worker maps it to
  the engine's internally-generated `Wire.id` because
  `Circuit.connect()` generates its own.
- `{ type: "disconnect", wireId }` — remove that connection.
- `{ type: "press" | "release", componentId }` — button input relay.
- `{ type: "removeComponent", componentId }` — delete a placed component;
  the worker removes it (cascading every wire touching its pins) and
  refuses the PicoBoard with an error.
- `{ type: "run", code }` — run MicroPython in Pyodide.

Worker → main thread:

- `{ type: "snapshot", components: [{ id, renderInfo, pins: [{ id, label }] }], conflictedPinIds: string[] }`
  — posted after every edit, after every bridge write, and continuously
  by the worker's own 60fps tick loop. This is the **only** render data
  the UI sees. `pins` gives the main thread each pin's engine uuid +
  label; `conflictedPinIds` lists every pin whose net currently has
  multiple drivers (see "Conflict detection" above) so the canvas can
  flag the affected wires.
- `{ type: "stdout", text }` / `{ type: "error", message }` — batched
  script output routed to the output panel.
- `{ type: "ready" }` — Pyodide + shim installed.

### Topology replay — how wiring survives a terminated worker

The main thread keeps an authoritative **topology record** (just ids +
pin labels, not engine objects). Why: **Stop is deliberately
non-cooperative.** A genuinely stuck script (`while True:` with no
yield, or `sleep()` spinning) could never process a "stop" message, so
Stop calls `worker.terminate()` unconditionally. `terminate()` destroys
Pyodide and everything in worker memory — so the UI immediately spawns
a fresh worker and replays every `addComponent` + `connect` message from
the topology record. This is also exactly how the app initializes, so a
rebuild is just "start from scratch, same wiring." Palette-placed parts
are appended to the same record, so they survive Stop like the demo
wiring; their canvas **positions** are plain React UI state, kept
separately from the topology and never sent to the worker — a respawn
never moves a placed part.

### `machine.Pin` semantics and limits

- `machine.Pin(id, machine.Pin.IN|OUT)` maps id → board GPIO
  (`GPIO0..GPIO28`); `value()` reads (`IN`) or writes (`OUT`) the pin's
  `PinValue`. Writes go through the bridge to `CircuitHost.writePin` and
  immediately `tick()` the circuit, so a wired LED lights without the
  frame loop running.
- `machine.PWM`, `machine.ADC`, `machine.I2C`, and `machine.time` beyond
  `sleep()` are **out of scope for now** — importing them
  raises a normal Python `ImportError`, surfaced to the output panel.
- `time.sleep()` is non-blocking where JSPI (stack switching) is
  available: the shim calls
  `pyodide.ffi.run_sync(asyncio.sleep(seconds))`, which suspends the
  Python task and leaves the worker's JS event loop (sim tick, button
  relay) running for the whole sleep — so the sim stays live. Where
  JSPI is unavailable (non-JSPI browsers — e.g. Firefox or older
  webviews) it falls back to the
  busy-wait on `time.monotonic()`, which blocks only the worker thread
  but also blocks the sim loop — acceptable for the supported scripts,
  and the same behavior the app had before JSPI. A precise *wakeable*
  sleep (interrupt it from the main thread mid-sleep) would still need
  SharedArrayBuffer + Atomics and cross-origin isolation; JSPI bought
  the part that matters without the hosting cost. See
  `docs/DECISIONS.md`.
- Bridge install detail (a real bug we caught and fixed): the shim
  imports the bridge as `from js import __pico_bridge`, and Pyodide's
  `js` module proxies the JS **global scope**, not Python's main
  namespace. The bridge must therefore be attached to `globalThis`
  (setting it only via `pyodide.globals` raises ImportError). Verified
  by `npm run verify:python`, which runs the real shim against a real
  Pyodide in Node.

### Throttling & frame timing

The worker runs its own `setInterval(..., 1000/60)` tick loop (plus a
snapshot immediately after each edit and after each Python `Pin`
write). The UI thread never ticks the engine — it has none. This keeps
the paint-side React work cheap and decoupled: the canvas just renders
whatever snapshot it was last sent.
