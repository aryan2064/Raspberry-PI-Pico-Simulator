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
      Button.ts
  ui/           React + canvas. Imports from engine, never the reverse.
    (renders LED/button bodies via @wokwi/elements custom elements)
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
- `pull` — `UP | DOWN | NONE`, default `NONE`. A digital **fallback**
  value for `IN` pins, applied only when their net has no driver. It is
  not a driver: any single OUT pin in the net overrides it, UP and DOWN
  together with no driver still resolve `FLOATING`, and pulls never
  contribute to conflict detection. See "Circuit" below and
  `docs/DECISIONS.md`.
- `value` — `HIGH | LOW | FLOATING`. Computed by net resolution for
  `IN` pins; set directly by component logic (or the Python shim) for
  `OUT` pins.
- `analogValue` — `number | null`, default `null`. A separate, optional
  analog channel, independent of `value`. For an `OUT` pin it represents
  a PWM duty cycle (range 0–1); for an `IN` pin it's the analog value
  propagated from its net by `Circuit.tick()`. `null` means "not
  currently driving/carrying an analog signal" — deliberately distinct
  from digital `FLOATING`, which applies only to the digital channel. A
  pin can be digitally `FLOATING` while holding a valid `analogValue`,
  or vice versa. `LED.update()` is now its first consumer: a non-null
  anode `analogValue` becomes the LED's clamped brightness, with the
  digital HIGH/LOW uniform 1/0 as the fallback (see `machine.Pin`
  semantics below and `docs/DECISIONS.md`).
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

// Optional; built-in wires hidden from the user's wire list.
interface HasInternalConnections {
  getInternalConnections(): Array<[Pin, Pin]>;
}
```

- `pin(label)` throws on a missing label rather than returning
  `undefined`. A missing pin is a programming error (typo, wrong
  component), not a case to handle gracefully — better to fail loudly
  at the call site than propagate a silent `FLOATING` value that's
  confusing three steps later.
- `getInternalConnections()` (via `HasInternalConnections`) is a
  component's own internal wiring — `Circuit` treats the returned pin
  pairs exactly like additional wires when grouping nets, so a passive
  component can merge/split nets without touching the wire list or
  emitting an edit. Currently only
  the button uses it: always `[["leg1a","leg1b"],["leg2a","leg2b"]]`
  (each mechanical strip is a short between its duplicated legs, so a
  strip keeps both legs coterminal even unpressed) plus
  `["leg1a","leg2a"]` while pressed (the strip-to-strip bridge).
  Because the button never drives, opening/closing it can
  never fabricate a new driver conflict — at most it merges two
  already-conflicting nets together (the "4 wire conflicts" case in the
  demo).
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

1. **`resolveNets()`** — union-find over the wire list **plus every
   component's `getInternalConnections()`**, grouping connected pins into
   nets. Called on every `tick()`, not just when wiring changes: a
   passive switch can merge or split nets between ticks without any
   wire edit, so net membership can never be assumed current. (It also
   runs directly after `connect`/`disconnect`/`removeComponent` via
   `CircuitHost`, and on pull setup — see `resolveNow()` below.)
2. **`tick(dt)`** — the per-frame simulation step:
   a. For each net, look at all `OUT`-mode pins in it (the "drivers").
   b. If exactly one driver, the net's value is that driver's value.
   c. If zero drivers, the net resolves from pins' **pull** settings:
      at least one `pull: "UP"` → `HIGH`; else at least one
      `pull: "DOWN"` → `LOW`; else `FLOATING`. A pull is purely a
      fallback — it never acts as a driver, one UP and one DOWN with
      no driver still resolve `FLOATING`, and pulls contribute nothing
      to conflict detection.
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

   **`resolveNow()`** — `resolveNets()` + `propagate()` only, no
   `update()` and no time advance. It exists for callers that mutate pin
   properties directly and need the result live immediately instead of
   on the next tick. `CircuitHost` calls it from both `setupPin` (the
   `machine.Pin` bridge) and `setupPinMessage` (the app's replay path):
   otherwise `Pin(17, IN, PULL_UP)` would only take effect on the next
   tick — and under a busy-waiting script there are no ticks, so the
   pull would never land.

### Conflict detection (`hasConflict`)

Both propagation passes compute the conflict condition as
`digital drivers > 1 || analog drivers > 1` per net (each pass re-reads
*both* channel counts, so a digital-only conflict survives the analog
pass and vice versa) and stamp `hasConflict` onto every pin in the net.
Non-driver pins — including any with a `pull` set — never count toward
the driver total, so pulls cannot manufacture a conflict. The resolved
`value`/`analogValue` semantics are unchanged — the flag is
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

## Sensors / stimulus inputs (implemented: PIRSensor)

Sensor-style components (proximity, PIR, etc.) have a concern that
output-only components like LED don't: something has to supply a fake
real-world stimulus (distance, motion) since there's no physical world
to sense. The intended pattern:

```ts
interface HasStimulus<TStimulus> {
  setStimulus(input: TStimulus): void;
}
```

An optional interface, not part of the `Component` base class, so
non-sensor components never need to stub out a meaningless method.

`PIRSensor` is the first real sensor and shows the concrete shape: it
has no input pins to react to — the stimulus arrives as a **user
gesture** reaching the engine through the existing worker `press`
message. Its public `triggerMotion()` is the stimulus entry point
(a one-shot "motion detected" — no booleans to hold or ranges to set),
kept as a named method rather than a generic `setStimulus(undefined)`
since it carries the domain meaning. The generic `HasStimulus<T>`
interface remains the documented target for a FUTURE sensor whose
stimulus is genuinely parametric (e.g. distance in cm) when one is
built — `PIRSensor` deliberately does not implement it yet rather than
fit a parameterless gesture into a generic shape. The `press` message
stays the shared out-of-band input path (Button's press, PIR's
trigger), and `triggerMotion()` writes `out` immediately so a net
resolve reveals the HIGH the same instant it is called.

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
- The `machine` module — `machine.Pin` done, `machine.PWM` done (duty
  only), `machine.ADC`, `machine.I2C` etc. still deferred — is shimmed:
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
- `{ type: "setupPin", gpio, mode, pull? }` — pre-configure a board GPIO
  (`IN`/`OUT` mode, optional `UP`/`DOWN`/`NONE` pull) without running
  Python. The app's replay path sends one per `topology.pinSetups`
  entry; same shape as the `machine.Pin` bridge's setup.
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

- `machine.Pin(id, machine.Pin.IN|OUT, machine.Pin.PULL_UP|PULL_DOWN?)`
  maps id → board GPIO (`GPIO0..GPIO22`, `GPIO26..GPIO28` — the 26 pins
  actually exposed on the real 40-pin header; GP23/24/25 are not exposed
  on the board and have no engine pins, so `machine.Pin(23)` etc. throw);
  the optional third argument
  sets the pin's internal pull (anything omitted/null →
  no pull). The shim's bridge calls `CircuitHost.setupPin`, which — like
  the app's own setup-pin replay path — applies mode/pull then calls
  `Circuit.resolveNow()` so the pull is live immediately, even mid-script
  under a frozen busy-wait tick loop. `value()` reads (`IN`) or writes
  (`OUT`) the pin's `PinValue`. Writes go through the bridge to
  `CircuitHost.writePin` and immediately `tick()` the circuit, so a wired
  LED lights without the frame loop running.

`machine.PWM(pin)` builds directly on the analog channel: it flips the
pin OUT, then `duty_u16(value)` writes `value/65535` onto the engine
pin's `analogValue` (read with no argument returns the pin's current
duty), and `deinit()` clears it back to `null`. `freq()` is stored on the
Python object and deliberately never used for timing — the sim animates
in frames and LED brightness is a per-frame render target, so a single
duty value is the correct representation; there is no waveform timing.
Each duty transition is immediately visible to the sim and to later
Python reads because the host bridge methods (`initPwm`,
`setAnalogDuty`, `deinitPwm` in `worker-core.ts`) call
`Circuit.resolveNow()` — the same immediacy requirement as the pull
fix — and the worker bridge entries (`pwmSetup`/`pwmDuty`/`pwmDeinit`)
tick + post a snapshot in the same turn, mirroring the `write` path.
Consumers pick up the duty through the analog propagation step:
`LED.update()` treats a non-null anode `analogValue` as its clamped
brightness (digital HIGH/LOW is the uniform 1/0 fallback) and
`LedView` sets both `value` and `brightness` on the real `wokwi-led`
(attribute-passing won't work for a 0..1 prop, so both go in via the
ref as JS properties).

### The UI render layer (published `@wokwi/elements` + scaled HTML stage)

The `ui` layer renders engine snapshot data, never the engine itself.
Two structural choices from the wokwi-visuals + pin-layout milestones:

1. **Component bodies are real DOM, wires/pins are an SVG overlay, all
   under one CSS scale.** The `CircuitCanvas` stage is a fixed 1200×700
   HTML `div` (`data-testid="circuit-stage"`) scaled by a CSS
   `transform` measured from a `ResizeObserver` (`300px` wide container
   → 0.25 scale, so interactive targets stay sanely sized at any window
   width). Component bodies sit inside it as absolutely-positioned divs
   (`data-testid="body-<id>"`, `style.left/top` in stage units) — real,
   hoverable, draggable DOM. Two `<svg>` overlays (`data-layer="wires"`,
   `data-layer="pins"`, each `pointer-events: none` with `auto` enabled
   only on individual wire/pin groups) draw the connecting lines and pin
   markers above the bodies. Both overlays carry the **same `transform:
   scale()` (with `transform-origin: top-left`) as the stage**, so SVG
   user coordinates stay in stage units throughout. Each marker sits at
its body origin + the component pin offset (LED anode
`(25,42)` / cathode `(15,42)`; button `1.l(0,13)` / `1.r(67,13)` /
     `2.l(0,32)` / `2.r(67,32)`; board pins sit on the part's own
    16-stage-unit-pitch grid (0.100" pads at 0.16 stage units per
    Fritzing unit)
    across the two long edges, **extracted from the official part's own
    connector markup** (`GPIO0` `(21.21,10.15)` … `GPIO15` `(325.22,10.08)`
    top, `GPIO16` `(21.22,122.08)` … `GND` `(53.22,122.08)` /
    `3V3_OUT` `(85.22,122.08)` / `VBUS` `(325.22,122.08)` bottom), with
    every one of the 40 header pads now mapped. The pin labels follow
    the **real Raspberry Pi Pico pinout** (Zephyr `rpi-pico` binding), not
    the part's connector ids — the two differ on the right column, and the
    first board build used the ids for labels, placing its right-column
    markers a few pads off the true positions (see `docs/DECISIONS.md`). A previous version
   left the overlays unscaled, so every marker and wire endpoint
   rendered ~`1/scale − 1` away from its body at any zoom — the fix
   snaps them to sub-pixel agreement (asymptotically asserting in
   browser-verify step 1b against the real browser, which also proves
   the overlays track the bodies while dragging). All client→stage
   coordinate math goes through `clientToStagePoint()`
   (`getBoundingClientRect`-based), so drop and drag deltas stay correct
   under any scale.
2. **LED and button visuals come from the published `@wokwi/elements`.**
   `wokwi-led` and `wokwi-pushbutton` (MIT) are a normal npm dependency
   and register themselves via the side-effect `import "@wokwi/elements"`
   in `main.tsx`. The `LedView`/`ButtonView` components drive them
   through refs, setting boolean props (`value`, `pressed`) as JS
   properties (LitElement parses DOM attributes as strings, so
   attributes can't carry a truthful `false`) and string props (`color`)
   as attributes via `useEffect`. Both views (and the palette previews)
   `import type` the classes from `@wokwi/elements` only, so the element
   runtime never loads inside jsdom tests. A vendoring attempt
   (`src/vendor/wokwi/`) was evaluated and reverted as unnecessary — the
   package ships pre-compiled JS (`__decorate` output), so tsconfig
   settings like `useDefineForClassFields` never execute against it; see
`docs/DECISIONS.md`. Pin geometry comes from the elements' `pinInfo`,
    verified identical between published `1.9.2` and the source clone
    that informed the offsets. The Pico board has no Wokwi element, so it
    is a static SVG: Raspberry Pi's **official Fritzing breadboard part**
    for the original Pico (`Pico-R3-Fritzing.fzpz` →
    `svg.breadboard.rpi_pico-tht_1_breadboard.svg`, from
    `https://pip.raspberrypi.com/documents/RP-008310-DS`), adopted as
    `src/ui/assets/pico-breadboard.svg` with only the root `svg` dims
    rewritten and the drawing group given the baked-in
    `matrix(0 0.16 0.16 0 0 0)` (landscape, USB right, 0.16 stage units
    per Fritzing unit) — rendered by `PicoBoardView` as a bare `<image>`
    inside a sized wrapper, with pin-offset coordinates drawn from the
    part's own `connector{N}pin` circles through that same matrix.
    The engine `PicoBoard` mirrors every one of the 40 header pads:
    26 GPIOs (GP0..GP22, GP26..GP28), 8 GND pads tied as one ground plane
    via `HasInternalConnections` (single `OUT LOW` driver at `GND`), and
    the non-GPIO pins (VBUS/VSYS/3V3_EN/3V3_OUT/ADC_VREF/RUN). GPIO23/24/25
    deliberately render no marker (RP2040-internal + onboard LED; no
    connector in the part and not exposed on the header). See
   `docs/COMPONENT_GUIDE.md` for the visual representations.
- `machine.PWM` (duty only; `freq()` stored, never timed),
  `machine.ADC`, `machine.I2C`, and `machine.time` beyond
  `sleep()` — PWM is built, the rest are **out of scope for now** —
  importing the unimplemented ones raises a normal Python
  `ImportError`, surfaced to the output panel.
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
