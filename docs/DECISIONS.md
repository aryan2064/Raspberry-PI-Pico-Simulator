www# Decision Log

Short "we chose X over Y, because Z" entries. Purpose: stop
re-litigating settled architectural arguments. If you're an agent
considering going against one of these, that's fine — but check here
first to understand what was already ruled out and why, so the same
reasoning doesn't get skipped.

Entries are in roughly the order the decisions were made.

---

**Target board: Raspberry Pi Pico, not full Raspberry Pi (4/5/etc.)**

The full Pi runs Linux; GPIO access goes through a kernel driver, and
"real" simulation would mean emulating an ARM Linux boot — a QEMU-scale
undertaking, far beyond this project's scope. The Pico is a bare
microcontroller running MicroPython directly with no OS layer, which
is a dramatically simpler and more tractable simulation target.

---

**Simulation approach: library shimming, not hardware emulation**

Rather than emulating a CPU/memory/bus at the hardware level, we run
the user's real Python code in a real interpreter and fake the
`machine` module underneath it. Every `machine.Pin(...)` call updates
our own simulation state instead of touching real hardware. This is
the same trick Wokwi-style tools use, and it avoids hardware emulation
entirely while still running genuinely valid MicroPython code.

---

**Circuit logic: net-based digital resolution, not a Kirchhoff/SPICE
solver**

A full circuit solver (numerically solving Kirchhoff's current/voltage
laws) is a hard, substantial engineering problem and unnecessary for
the target use cases (GPIO logic, LEDs, buttons, most digital
peripherals). Instead, connected pins are grouped into "nets" and each
net resolves to `HIGH` / `LOW` / `FLOATING` based on which pins are
currently driving (`OUT`) vs listening (`IN`). Analog math is added
per-component, only for the specific components that need it (e.g. LED
brightness, voltage dividers) — not as a general physics engine.

---

**Python execution: Pyodide (in-browser WASM), not a backend sandbox**

Considered running user code server-side in a sandboxed
container/subprocess. Rejected because: it requires standing up and
maintaining backend infrastructure; sandboxing arbitrary untrusted
Python safely is itself a significant security project (container
escape, resource limits, network egress); every code run incurs
network latency, hurting the fast iterate/test loop that's central to
this kind of tool; and no offline support. Pyodide avoids all of this —
the browser's own sandboxing protects the host for free, execution is
instant with no round trip, and there's no server to run or secure.
Trade-off accepted: not literally every CPython package will work, but
the shimmed `machine` module doesn't need obscure C-extension
dependencies anyway.

---

**Pyodide must run inside a Web Worker**

Pyodide executes on the main thread by default, which would freeze the
canvas/UI while user code runs. Running it in a Web Worker from the
start avoids this; retrofitting worker support after building the
execution module around main-thread assumptions would be significantly
more painful than designing for it up front.

---

**`RenderInfo` is a discriminated union, not a generic `{ type, [key]: unknown }` bag**

A generic shape leads to every component inventing its own field names
ad hoc, with the canvas doing untyped guessing (`info.brightness as
number`) and typos failing silently at runtime. A discriminated union
(one variant per component type) means TypeScript enforces exhaustive
handling in the renderer — forgetting to handle a new component type
is a compile error, not a missed-render bug discovered later.

---

**Components get a `label` on each `Pin`, separate from the pin's internal `id`**

`id` is an internal UUID for identity/bookkeeping (union-find, Map
keys). `label` is human-readable (`"GPIO15"`, `"anode"`, `"VCC"`) and
is what the canvas displays and what the `machine.Pin` shim will use to
resolve a numbered pin request to the actual `Pin` object. Added early
rather than retrofitted, since wiring lookups and shim code both depend
on it.

---

**One-way dependency rule: `engine/` never imports from `ui/` or `execution/`**

Building canvas rendering directly against ad hoc objects (instead of
against a pre-defined engine skeleton) risks tangling rendering
concerns (mouse position, SVG paths, hit-testing) with simulation
concerns (net values, pin state). Once tangled, later work (like
adding code execution) either has to reach into UI objects to find
real circuit state, or requires a disruptive refactor. Keeping engine
UI-agnostic from the start avoids this entirely, and was validated by
running the engine standalone in plain Node before any UI existed.

---

**Data model built and validated before canvas rendering**

Tempting to build the visual/canvas layer first since it's more
immediately satisfying, but rejected: canvas work is comparatively
well-trodden (mouse coordinates, dragging, hit-testing) and low-risk,
whereas the data model (nets, state resolution, driver conflicts) is
where real design mistakes are costly to unwind later. Do the
high-risk, foundational part first, in isolation, testable without a
mouse.

---

**Don't pre-build components speculatively (e.g. sensors)**

A `ProximitySensor` example was built early to prove the render-info
and stimulus-input shapes could handle more than a simple on/off LED.
It was then deliberately removed from the core model — the *pattern*
(the `HasStimulus` interface idea) is documented in
`docs/ARCHITECTURE.md`, but no sensor component is implemented until a
feature actually requires one. Building components ahead of need risks
guessing wrong about their shape and wasting the rework the "data model
before UI" decision was meant to avoid in the first place.

---

**First real component (LED) is deliberately minimal: on/off only, no brightness**

Brightness/PWM/color were discussed as eventual extensions but
explicitly deferred. First implementation of any new component should
be the simplest version that proves the pipeline (pin → net → update →
render) end to end; richer behavior gets added later, only when
actually needed, following the same "don't build ahead of need"
principle applied to sensors above.

---

**Analog values are a separate `analogValue` channel on `Pin`, not part of the digital `PinValue`**

Rather than overloading `Pin.value` or replacing the `PinValue` union,
`Pin` gains an independent optional field `analogValue: number | null`
(0–1 duty cycle for `OUT` pins; the propagated net value for `IN` pins;
`null` = no analog signal). Chosen over the alternatives because:
existing digital-only components like `LED` and the digital net
resolution stay completely unaffected (no behavior change, no type
churn — every component keeps working with zero edits); and it avoids
guessing at the full PWM design (frequency, resolution, duty semantics)
before `machine.PWM` actually exists, while still giving future analog
components a settled channel to build on. `null` is deliberately
distinct from digital `FLOATING` — the two channels are fully
independent; a pin can be digitally `FLOATING` while holding a valid
`analogValue`, or vice versa. Multi-driver analog nets mirror the
digital conflict placeholder (`null`) until the validation-states phase
adds real conflict handling.

---

**`tick()` re-propagates after `update()`, so self-driving components take effect within the same tick**

`Circuit.tick()` resolves and propagates each net's digital value and
`analogValue`, runs every component's `update(dt)`, then runs a
propagation-only pass again (no second `update()` call). Needed because
components that write their own output pins from inside `update()` —
such as `Button` setting its `signal` pin from `pressed` — must have
that value visible to listening pins in the **same** `tick()` they
changed it. Without the second pass, their output would only reach
listeners on the following tick, making interactive input feel one
frame late and complicating test assertions. Reordering was rejected: it
would break the documented guarantee that `IN` pins already reflect
this tick's net values by the time `update()` runs. The second pass is
pure propagation — drivers are re-read, listeners updated, and no
component logic runs again.

---

**The live `Circuit` lives inside the Web Worker, not the main thread**

A Worker cannot share JS references with the main thread; postMessage
deep-clones. `machine.Pin` writes must be synchronously visible to the
rest of the simulation and to later Python reads (e.g.
`Pin(15, OUT); Pin(15).value()`). If the engine `Circuit` lived on the
main thread, every Python write would need a message round-trip and
Python would read stale, cloned values. So the worker owns the live
`Circuit` (`CircuitHost`), the shim bridge calls
`setupPin/readPin/writePin` on the same thread with immediate
`tick()`, and the UI renders only from `snapshot` messages plus a
topology record it uses for replay. Trade-off: the UI no longer has a
real `Circuit` object — every interaction becomes a relayed message,
and anything needing interactive engine access goes through the
client-worker protocol. Accepted for simulation correctness.

---

**Stop = terminate the worker unconditionally + replay the topology, not a cooperative stop**

A script like `while True: pass` (or a busy-wait `sleep` without
Atomics) can never yield control to process a "stop" message — so any
cooperative-stop design is unsound the moment a user writes a stuck
loop. Instead Stop calls `worker.terminate()`, which destroys Pyodide
and worker state, and immediately spawns a fresh worker that replays
the recorded topology (`addComponent` + `connect`), so wiring never
visibly disappears and the sim restarts from the same state the user
built. This doubles as the app's normal initialization path — rebuild
and startup are the same code.

---

**The worker is a MODULE worker using Pyodide's npm package; classic workers are ruled out**

The first working version booted Pyodide via `importScripts` of a CDN
`pyodide.js` in a **classic** worker. Two problems, one fatal: (1) in
dev, Vite serves classic workers (`?worker_file&type=classic`) as a
script that starts with `importScripts("/@vite/env")` followed by
top-level `import` statements — a syntax error in a classic worker, so
the worker died silently on boot (blank canvas, dead Run/Stop, no
error on the main thread); (2) Pyodide's own npm loader (v0.314)
explicitly throws `"Classic web workers are not supported"` — it boots
via `fetch` + dynamic `import()` of ESM assets, which classic workers
lack. Fix: construct the worker with `{ type: "module" }` and `import
{ loadPyodide } from "pyodide"` (bundled from the npm package; only
the static wasm/stdlib assets come from the CDN via the loader's
`indexURL`). Rollup then needs code-splitting for the loader's guarded
dynamic imports, so `vite.config.ts` sets `worker.format: "es"`.
Corollary: the producer of a dead-feeling worker is almost always a
silent boot failure — see the next entry.

---

**Worker failures must never be silent**

The blank-canvas/dead-buttons symptom above was invisible because
nothing listened for worker failure. Rules now: the worker routes
`error`/`unhandledrejection` back to the main thread as
`{type:"error"}` messages; `App` attaches `worker.onerror` and
`worker.onmessageerror` (rendered to the output log + a red
`worker-issue` banner); and a 5s watchdog flags a worker that never
posts its first snapshot ("Worker did not respond"). A genuinely dead
worker should be loudly visible, not a subtly broken canvas.

---

**`machine` bridge imports (`from js import ...`) must be attached to `globalThis`, not `pyodide.globals`**

Pyodide's `js` module is a proxy of the JS global scope (`globalThis`),
while `pyodide.globals.set` writes only to Python's main namespace. The
shim imports its bridge as `from js import __pico_bridge`; attaching
the bridge only via `pyodide.globals` therefore raises ImportError.
This was a real bug caught and fixed while writing the integration
test (`npm run verify:python`).

---

**`time.sleep` is non-blocking where JSPI exists, busy-wait otherwise**

Python `sleep()` runs through `pyodide.ffi.run_sync(asyncio.sleep(seconds))`
(JS Promise Integration / stack switching) whenever the runtime and browser
support it — the worker probes `pyodide.ffi.can_run_sync()` at boot and
passes the result to the shim via the bridge (`canRunSync`). Under JSPI the
Python program blocks for the full duration, but the worker's JS event loop
(sim tick loop, button relay) keeps running underneath, so the sim and UI
stay live mid-sleep — with **no** SharedArrayBuffer, Atomics, or
cross-origin isolation headers. User code must run under
`pyodide.runPythonAsync` (not `runPython`) for `run_sync` to have a stack
it can suspend, so the worker also switched to that. Where JSPI is
unavailable (browsers without stack switching — e.g. Firefox or older
webviews — or an absent `ffi` API) `sleep()` falls back to the historical
busy-wait spin on `time.monotonic()`, which blocks only the worker thread —
that thread
exists to run Python, so this was always acceptable. The precise
*wakeable* sleep (interrupt it from the main thread mid-sleep) would still
need SharedArrayBuffer + Atomics and cross-origin isolation; JSPI bought
the part that mattered (sim responsive during a sleep) without the hosting
cost, and a wakeable sleep is not needed by the supported scripts. All of
this lives in `src/execution/` (worker detection + shim); the engine and UI
are untouched.

---

**Canvas positions are UI-only state, never part of the topology**

Component *wiring* lives in the topology record (worker owns the live
`Circuit`); component *positions* live only in React state
(`Record<componentId, {x,y}>`). The worker and engine have no concept
of layout, and nothing needs one there — wires are re-derived in the
canvas from positions + snapshots each render. Keeping positions out
of the topology means Stop/respawn (terminate + replay) never touches
them, and palette placement + drag-to-move stay free of the
worker-message protocol entirely. The demo's initial layout is
computed once into state, next to `INITIAL_TOPOLOGY`, so the two stay
in one place in `App.tsx`.

---

**Palette placement reuses `addComponent`; components are deleted only in a later milestone**

A palette drop is just `{type:"addComponent"}` plus an id from the
same `placed-N` sequence and a topology-record append — identical to
the init/replay path, so the worker needs no new message kind and
behaves the same whenever the message arrives (verified live).
Deleting placed parts (and their wires) is deliberately the *next*
milestone rather than part of this one; leaving it out keeps the
position/topology-integrity question (what happens to pins, wires, and
nets when a live wiring target disappears) a single, focused problem
instead of an unexamined side effect.

---

**Short-circuit detection is a diagnostic `hasConflict` flag on `Pin`, not a new in-net state**

Multi-driver nets are still the one case net resolution deliberately does
*not* try to "solve": digital resolves to `FLOATING`, analog to `null` —
and that placeholder stays exactly as-is. What changed is that every pin
in such a net now also gets `hasConflict = true` (set in **both**
propagation passes, from the combined `digital drivers > 1 || analog
drivers > 1` condition, so a digital-only conflict is never cleared by
the analog pass or vice versa). The flag is purely diagnostic: it never
changes the resolved `value`/`analogValue`. Chosen over inventing a real
`CONFLICT`/`SHORT` pin state because a new state would ripple through
every component's logic + the Python shim + the canvas renderer for no
behavioral gain yet — the flag gives the UI everything it needs to warn
the user, and nothing stops us from upgrading to a stricter state later
if a feature actually needs one. The conflict is **surfaced, not
prevented**: wiring two outputs together is still allowed. On real
hardware that's the user's classic mistake — the tool's job is to make
the problem loud (red dashed wires + a conflict banner), not to refuse an
edit mid-drag. Since the worker owns the live `Circuit`, the snapshot
carries not just the conflicted pin uuids (`conflictedPinIds`) but also
each component's `pins` (`id` + `label`), so the main thread can resolve
those uuids back to the `componentId:pinLabel` endpoints the wire
topology uses. This is foundational work for whatever real visualization
the validation-states phase eventually wants.

---

**Pin pulls are a fallback, not a driver: `PinPull = "UP" | "DOWN" | "NONE"`**

`Pin.pull` is a digital fallback applied only when a net has **zero OUT
drivers** (`pins.length > 0 && !drivers.length` → `UP`→HIGH, `DOWN`→LOW,
`NONE`→FLOATING). A single active driver always wins; UP and DOWN together
with no driver still resolve FLOATING; and pulls **never create a
conflict** (multi-driver detection explicitly ignores non-drivers), so a
cloud of pulled-up listener pins can never flag a short. `connect()` and
`disconnect()` re-group nets but deliberately do **not** resolve values —
resolution happens on every `tick()` so a passive switch's press/release
(toggle of its internal connection) is reflected without any wire edit.
Critically for the `machine.Pin` bridge, a pin's pull must be *live
immediately* after setup, not one tick later (a busy-waiting script froze
the tick loop, so `Pin(17, IN, PULL_UP); pin.value()` would have read the
stale pre-pull value forever). That's what `Circuit.resolveNow()`
(`resolveNets()` + `propagate()` only, no `update()`/time advance) is
for: both `CircuitHost.setupPin` and `setupPinMessage` call it so a pull
lands the instant it's configured. This was a real bug — the pull
assertions in the Pyodide integration test only fail under
`npm run verify:python` (the test is skipped in the normal run), so the
gap in `CircuitHost.setupPin` shipped unnoticed until that was run.

---

**Button is a passive switch: permanent strip pairs + a dynamic bridge**

The button does not drive or pull anything. Its four pins (`leg1a`,
`leg1b`, `leg2a`, `leg2b`) are `"UNSET"`-mode;
`getInternalConnections()` always returns the two mechanical strip
pairs (`[leg1a,leg1b]`, `[leg2a,leg2b]` — a strip is a short between
its duplicated legs even unpressed) and appends `[leg1a,leg2a]` while
pressed (the strip-to-strip bridge). Net resolution treats those like
extra wires connecting groups of pins, so a press can merge two
otherwise-separate nets (e.g. closing the demo circuit between 3V3_OUT and
GPIO15) and a release can split them — no wire edit message involved,
exactly how `tick()` re-resolves nets every step. The strips can never
create a driverless shortcut, and since the button can't drive, pressing
it can never manufacture a new conflict.

---

**Visuals use the published `@wokwi/elements` (MIT) package — vendoring was evaluated, found unnecessary, and reverted**

The hand-drawn canvas SVG got LED and button right-to-left wrong, and
shouldn't ship "fake hardware" if a real, MIT-licensed hardware
renderer exists. `@wokwi/elements` provides `wokwi-led` and
`wokwi-pushbutton` as custom elements with Wokwi's authentic parts
library visuals; a hand-drawn Pico board not being available there is
why the board stays as our own SVG. The LED/button visuals are a normal
**npm dependency** on the published `@wokwi/elements` package.

Vendoring was tried first: one pass copied `led-element.ts`,
`pushbutton-element.ts` and their `pin.ts`/`keys.ts` deps into
`src/vendor/wokwi/`, on the belief that our tsconfig
(`useDefineForClassFields: true`) breaks lit's decorator pattern in raw
source. That was **reverted as unnecessary.** An isolated probe under
our actual Vite build showed the published package works unchanged: it
ships pre-compiled JS where lit's `@property`/`@customElement` are
already emitted as `__decorate(...)` calls, so
`useDefineForClassFields` (which only affects TypeScript's own
class-field emission) never executes against it. The decorator concern
applies only when *compiling raw wokwi source with our tsconfig*, which
is not what the package does. Forward rule: **use the published package
by default; vendor source only as a last resort if a real, confirmed
blocker is found — and in that case document the specific blocker here,
  not just "it didn't work."** The stepper motor later became exactly
  such a case: its published element exposes only four bipolar cosmetic
  pins (no `vcc`/`gnd`, no `in1`–`in4`), so its source is vendored and
  modified — with the decorator fix described above — under our own tag;
  see the Stepper decision below. The PIR motion sensor is the second
  such case (published part is purely static — no state to reflect);
  see the PIR decision below.

Scope discipline: adopted only for LED + button, never to become "mix
every visual language", and the canvas CSS is kept to
positioning/scaling only, not restyling the parts. Web components
register once via the side-effect `import "@wokwi/elements"` in
`main.tsx` (a registry call, not per-component glue). LitElement parses
DOM attributes as **strings**, so boolean props (`value`, `pressed`)
are set as JS properties through refs while string props (`color`) go
in as attributes. jsdom (vitest's DOM) doesn't know custom elements, so
unit tests never touch them — views `import type` the classes from
`@wokwi/elements` and the element-runtime import lives in `main.tsx`,
keeping the element runtime out of test scope. The pin-marker offsets
still come from the elements' `pinInfo`, verified identical between the
published `1.9.2` and the cloned source that informed the offsets.
**The Pico board visual is Raspberry Pi's official Fritzing breadboard part — adopted as a static asset; pin offsets come from the part's own markup**

Checked the installed `@wokwi/elements` package (`1.9.2`) directly:
enumerating every `customElement('wokwi-…')` tag in `dist/esm/*.js`
yields exactly 50 elements and none is a Pi Pico; `grep` over the whole
`dist/` for `pi-pico|rp2040|pico-board` matches only
`wokwi-nano-rp2040-connect` (the Arduino Nano RP2040 Connect — a
different board). Wokwi's `wokwi-pi-pico` is a *part* in the
simulator's own library (used in `diagram.json` at wokwi.com), not a
web component shipped by the npm package. So the board is our own
static SVG — but instead of an approximate hand-drawn recreation, it is
Raspberry Pi's own Fritzing part for the **original** Pico:
`src/ui/assets/pico-breadboard.svg`, extracted from the official
`Pico-R3-Fritzing.fzpz` at
`https://pip.raspberrypi.com/documents/RP-008310-DS` (linked from
`https://www.raspberrypi.com/documentation/microcontrollers/raspberry-pi-pico.html`).
The fzpz's breadboard-view SVG is
`Pico-R3-Fritzing.fzpz/svg.breadboard.rpi_pico-tht_1_breadboard.svg`
(part title "Raspberry Pi Pico", author "Alasdair Allan/Jack Wills
(modified by vanepp Jan 2021)", Fritzing 0.9.4).

Official license terms from the documentation page (log for provenance;
no attribution is required by them, but we record it anyway):

> Design files for Raspberry Pi Pico and Pico H are openly available
> with no limitations. Raspberry Pi grants permission to use, copy,
> modify, and distribute the following designs for any purpose, with
> or without fee. Designs are provided 'as-is' and the author disclaims
> all warranties with regard to the design, including all implied
> warranties of merchantability and fitness. In no event shall the
> author be liable for any special, direct, indirect, or consequential
> damages or any damages whatsoever resulting from loss of use, data,
> or profits, whether in an action of contract, negligence, or other
> tortious action, arising out of or in connection with the use or
> performance of the design.

Ship-it changes are deliberately minimal: only the root `<svg>` dims
(`width`/`height`/`viewBox`/`overflow`) are rewritten and Raspberry
Pi's drawing group gets `transform="matrix(0 0.16 0.16 0 0 0)"` baked
in. That matrix maps the part's native portrait 0.827"×2.087" drawing
into our landscape stage space — long edge horizontal, USB on the right,
matching the physical Pico's pad order — at 0.16 stage units per
Fritzing unit, so the part's 0.100" pad pitch (100 Fritzing units) is
exactly the 16-stage-unit grid the pin overlay uses.

The pin-offset map is **extracted from the part's own markup, not
eyeballed**: each physical pad is an invisible
`<circle id="connector{N}pin" cx cy r="16"/>` in the breadboard SVG
(43 connectors: pins 1–40 plus the SWD debug header), and
`PicoBoardView` derives every `picoPinOffsets` entry by mapping that
(cx, cy) through the same matrix — position = (0.16·cy, 0.16·cx).
Pins 1..20 run down the left edge (cx = 63.437519 for 1–8, 63.000015
for 9–20), pins 21..40 up the right edge (cx = 763.00024). The `.fzp`
labels the connectors, so the map's offsets aren't inferred from
pin-name position heuristics; the `connector25 = "CP20"` typo in the
part (GP20) is on the header's own silkscreen and irrelevant to the map.

Engine-to-pad mapping (`PicoBoard` now models the **real header
pinout** — 40 pins): each engine label below is placed on its actual
physical pad, per the official board doc + the Zephyr `rpi-pico`
device-tree binding, and every pad on the part now has a marker.
Left column (pins 1–20): GPIO0, GPIO1, GND, GPIO2, GPIO3, GPIO4, GPIO5,
GND, GPIO6, GPIO7, GPIO8, GPIO9, GND, GPIO10, GPIO11, GPIO12, GPIO13,
GND, GPIO14, GPIO15. Right column (pins 21–40, running up from the USB
end): VBUS, VSYS, GND, 3V3_EN, 3V3_OUT, ADC_VREF, GPIO28, GND, GPIO27,
GPIO26, RUN, GPIO22, GND, GPIO21, GPIO20, GPIO19, GPIO18, GND, GPIO17,
GPIO16.

The **part's own connector ids are not the real pin numbers**, and the
first board build used them interchangeably for the right column. That
put its markers a few pads off the true positions (e.g. the old "3V3"
landed on pin 36 — which is actually GPIO19 — and old GPIO16 on pin 21,
which is VBUS). The right column corrected: connector 20…39 ↔ header
pins 21…40 respectively, so connector20 (the pad next to GPIO15, at the
USB end) is VBUS and connector39 (the far corner) is GPIO16. This table
is the corrected one; the old marker coordinates for the right column
were wrong and are not preserved.

The eight **GND pads are one continuous plane** on the real board and
are modeled as 8 pins (`GND` at physical pin 38, `GND_1`…`GND_7` at pins
3, 8, 13, 18, 23, 28, 33) permanently tied via `HasInternalConnections`
— the same net-merge mechanism the button's leg pairs use, so wiring to
any GND pad behaves identically. Exactly one of them (`GND`) is `OUT
LOW` and drives the ground net; the other seven are `UNSET` listeners, so
a normally-grounded circuit never looks like a multi-driver short.
`3V3_OUT` keeps the historic "3V3" rail (`OUT HIGH`) so the demo button
circuit still has a supply; the other non-GPIO pins (VBUS, VSYS, 3V3_EN,
ADC_VREF, RUN) are ordinary `UNSET` pins with no simulated behavior —
they exist and participate in wiring, but nothing drives or listens on
them (no `machine.ADC`/reset simulation yet).

Mismatch flagged rather than silently resolved: **GPIO23, GPIO24, and
GPIO25 are absent from the engine** — they exist on the RP2040 die
(QSPI flash + clock) and as the onboard LED, but none is on the exposed
header, and the official part correctly has no pad for them. The first
board build (like the older hand-drawn board before it) modeled them as
if they were exposed; now they are gone from `PicoBoard` entirely, and
`machine.Pin(23/24/25)` throws "no pin labeled GPIO…" just as the real
header has no such pin.

Sub-pixel alignment of the overlay pins against the part's own
connectors is asserted in browser-verify step 1b (board pins GPIO0,
GPIO15, GPIO16, GPIO17, GPIO28, 3V3_OUT, GND checked against the exact
extracted coordinates), same as the LED/button offset fix.

---

**`machine.PWM` is a duty-only shim: duty lands on the analog channel, frequency is stored, never simulated**

`machine.PWM` covers duty-cycle control and nothing else. `PWM(Pin)`
sets the pin `OUT`; `duty_u16()` sets/reads the pin's existing
`analogValue` channel (0 → 0.0, 65535 → 1.0 — the `value/65535` mapping
matches MicroPython's duty_u16 semantics), and `deinit()` clears the
channel back to `null` so the LED falls back to its digital value.
`freq()` is **stored on the object and never used for timing**: a
real PWM waveform at a given frequency would need a cycle-accurate
timing model (per-wavelength state in `tick(dt)`, waveform generation,
per-peripheral clocks) that no component currently consumes, and the
LED only needs which brightness to render, not *when* it pulses. Frames
are the atomic unit; duty is a per-frame render target, so a single
duty value is correct for the sim. `machine.ADC`, `I2C`, etc. remain
out of scope. All duty writes are **immediately** visible to the rest of
the sim and to later Python reads — same constraint as the pull-resistor
fix — so every `pwmSetup`/`pwmDuty`/`pwmDeinit` bridge call goes
through `Circuit.resolveNow()`; the worker bridge additionally ticks and
posts a snapshot in the same turn, mirroring the existing `write` path.

The LED brightness model is the analog-channel fallback: when the LED's
anode has an `analogValue`, brightness is that value (clamped 0–1) and
`isOn = brightness > 0`; otherwise brightness is the uniform
`1.0 / 0.0` from the digital value. `RenderInfo`'s led variant gained
`brightness: number` (all exact-shape assertions updated). This is a
script-only feature — there's no manual PWM control in the UI; a loop
of `duty_u16` + `sleep` (the JSPI/non-blocking path) is the supported
way to animate brightness.

`wokwi-led` genuinely supports continuous brightness — verified in the
published package source (`led-element.js`:
`this.brightness = 1.0`, rendered as glow `opacity = 0.3 +
brightness*0.7`, light off when `value` false or `brightness <=
EPSILON`), not assumed from its API. So `LedView` sets both the boolean
`value` and `brightness` as JS properties via the ref (LitElement reads
attributes as strings, so `brightness="0.5"` as an attribute would be a
string — the same reason `value` is a property). No workaround, fake
glow logic, or vendored CSS needed. The brightness of a real
`wokwi-led` DOM element and the intermediate snapshot values during a
fade were both confirmed live in the browser (CDP probe driving the
real worker: distinct brightness values 0.250 / 0.625 / 1.000 observed,
with `wokwi-led.brightness` exactly `0.2500038147554742` at
`duty_u16(16384)`).

---

**`CircuitCanvas` is an HTML stage under SVG overlays; hit-testing is the DOM, not math**

`CircuitCanvas` no longer draws every graphic in one SVG. The stage is a
fixed 1200×700 HTML `div` (`data-testid="circuit-stage"`) scaled by CSS
`transform` from a ResizeObserver measurement, so component bodies stay
real interactive DOM (drags, mouse press/release) while wires and pins
are absolute-positioned SVG overlays (`data-layer="wires"`/`"pins"`,
`pointer-events:none` at the svg, `auto` on individual wire/pin
groups). `clientToStagePoint()` converts via `getBoundingClientRect` so
drop/drag math is robust at any zoom (jsdom's zero rect falls back to
pass-through client coords, which is exactly what vitest wants).
Component bodies keep `data-testid="body-<id>"` wrappers; hit targets
remain the component-named testids (`led`, `led-body`, `button`,
`button-body`). Tests assert on element testids and wrapper
`style.left/top` for position, never on `<g transform>` strings.

---

**Relay is a hand-drawn module, not the `wokwi-ks2e-m-dc5` element: the SPDT-switch module API is `in/vcc/gnd/com/no/nc`, and the KS2E is a bare contactor**

The installed `@wokwi/elements` does ship a relay — `wokwi-ks2e-m-dc5`,
a bare electromagnetic DPDT relay (8 pads: `NO1`/`NC1`/`P1`/`COIL1` and
`NO2`/`NC2`/`P2`/`COIL2`, two independent SPDT poles + a coil —
`01_Relay-elec_symbol` style body, no state/actuation animation). Two
reasons it was rejected:

1. **Interface mismatch.** The task's relay is a **relay module** with
   six logical pins, `in`/`vcc`/`gnd` being the coil side and `com`/`no`
   `/nc` the signal side. The KS2E's real geometry has no such pins —
   its coil has two pads (`COIL1`/`COIL2`), no `in` (the module's `in`
   is its *driver transistor's* input, which the bare part doesn't have
   as a pad), and it has *two* poles, not one SPDT. Mapping our six
   logical pins onto its physical pads would mean inventing coordinate
   geometry that isn't in the element — exactly the "no guessing"
   rule established for the Pico board's pad offsets.
2. **Visual mismatch.** The task draws a relay as a **module** (screw
   terminal strips). The KS2E's schematic-style body would read as a
   component symbol, not a placeable module, and it has no coil
   energization state our canvas could reflect.

So the relay is hand-drawn SVG (generic module visual language, no
commercial-part imitation): 140×52, screw strips on both long edges,
coil zigzag + status LED. Both NO and NC are modeled so a de-energized
relay demonstrably blocks the NC path when energized — nothing is
guessed, the contact geography is just our own. **Superseded:** the relay
artwork is now the real Fritzing `basic-relay-6p_1c569ac_002` part — see
"Relay artwork is now the real Fritzing part" at the end of this file.

Also audited for this task: `@wokwi/elements` 1.9.2 registers exactly
**50** custom-element tags — one per element file under
`dist/esm/*-element.js`, each tag extracted from its Lit
`customElement("wokwi-…")` decorator call:

  wokwi-7segment, wokwi-analog-joystick, wokwi-arduino-mega,
  wokwi-arduino-nano, wokwi-arduino-uno, wokwi-biaxial-stepper,
  wokwi-big-sound-sensor, wokwi-buzzer, wokwi-dht22,
  wokwi-dip-switch-8, wokwi-ds1307, wokwi-esp32-devkit-v1,
  wokwi-flame-sensor, wokwi-franzininho, wokwi-gas-sensor, wokwi-hc-sr04,
  wokwi-heart-beat-sensor, wokwi-hx711, wokwi-ili9341, wokwi-ir-receiver,
  wokwi-ir-remote, wokwi-ks2e-m-dc5, wokwi-ky-040, wokwi-lcd1602,
  wokwi-lcd2004, wokwi-led, wokwi-led-bar-graph, wokwi-led-ring,
  wokwi-membrane-keypad, wokwi-microsd-card, wokwi-mpu6050,
  wokwi-nano-rp2040-connect, wokwi-neopixel, wokwi-neopixel-matrix,
  wokwi-ntc-temperature-sensor, wokwi-photoresistor-sensor,
  wokwi-pir-motion-sensor, wokwi-potentiometer, wokwi-pushbutton,
  wokwi-pushbutton-6mm, wokwi-resistor, wokwi-rgb-led,
  wokwi-rotary-dialer, wokwi-servo, wokwi-slide-potentiometer,
  wokwi-slide-switch, wokwi-small-sound-sensor, wokwi-ssd1306,
  wokwi-stepper-motor, wokwi-tilt-switch

A recursive content scan of the **entire** package for
`relay`, `transistor`, `bjt`, `npn`, `pnp`, `mosfet`, and `regulator`
returns **zero occurrences each** — there is no NPN/PNP/MOS transistor
element and no relay-element beyond the bare-pad `wokwi-ks2e-m-dc5`
above, which is why the transistor was also hand-drawn. **Superseded:**
both parts now use real Fritzing artwork — see "Relay artwork is now the
real Fritzing part" and "Transistor artwork is now a real Fritzing TO-92
part" at the end of this file.

---

**Relay `vcc`/`gnd` are present-but-inert coil pins, not simulated drive**

The relay's control side is only `in` (MODE_IN). `vcc` and `gnd` exist
for wiring realism — a real module's coil-driver circuit needs them —
but are UNSET pins with no behavior: no coil current, no pull-in
threshold, no wire-between-vcc-and-gnd modeling. The energization
decision is strictly `pin("in").value === "HIGH"` each `update()`. This
keeps the relay a pure state-driven `HasInternalConnections` switch
(exactly the Button pattern, with the flip driven by an input state
instead of a user press) and avoids simulating the driver circuit no
component in the sim consumes. Wiring `vcc`/`gnd` to rails is legal and
visually correct; it just doesn't influence the contacts.

**Transistor is a base-controlled switch with no analog network: HIGH = saturated short, LOW/FLOATING = cutoff**

The NPN (`base`/`collector`/`emitter`) deliberately has **no**
base-resistor, Vbe-threshold, current-gain, or leakage modeling — those
would require per-pair resistance/voltage math the net model doesn't
do. Instead: `base` reads `HIGH` → collector-emitter is a dead short
(saturation); `LOW` **or FLOATING** → open. `getInternalConnections()`
returns `[[collector, emitter]]` or `[]` respectively (cutoff returns
zero pairs, so the two switch terminals are never on a shared net).
This is the same deliberate simplification as the relay's in-pin: it
gives fully correct *digital control* behavior for the target use
(switching a load rail on/off with a GPIO) while deferring any analog
semiconductor model until a feature actually needs it. The BC547-style
lead order (left→right **collector, base, emitter**) is documented so
the *visual* center lead (base) matches the control terminal.

**State-driven `HasInternalConnections` follows the same two-tick latency as the button's press, because the state flip only lands in `update()`**

A state-driven connection (`energized`/`conducting`) is decided in
`update()`, which runs after a tick's net grouping — so a change on the
control net takes exactly two `tick()`s to reach the contacts, mirroring
how net membership settles after any passive-switch change. Tests drive
control inputs over real wires (never by poking the private flag) and
assert the settled state after the two ticks, plus the broken-old-contact
behavior in between. This is inherent to `tick()`'s ordering (the
"re-propagate after update" decision), not a relay- or transistor-specific
quirk.

---

**Stepper view vendors + modifies `@wokwi/elements`' stepper as `app-stepper-motor` — the first justified vendoring exception (the PIR sensor is the second)**

The motor component models the **module** the MCU drives: a 28BYJ-48
unipolar stepper wired through a ULN2003 darlington board, exposed as
four raw digital control inputs (`in1`–`in4`) plus inert `vcc`/`gnd`.
Neither upstream library ships a genuine 28BYJ-48 + ULN2003 part, but
we don't need the *whole* module from one source:

- `wokwi-stepper-motor` (in `@wokwi/elements` 1.9.2) is a **generic
  bipolar NEMA** unit (pins `A+`/`A-`/`B+`/`B-`). Verified live in the
  real renderer (not by label-guessing) it is a **pure props→visual
  display**: its shadow DOM contains only `defs` + `g`, the *only*
  nodes rotated by `angle` are `#arrow-path` and `#shaft-path`, it
  registers **no interactive attributes**, and its four pins are
  cosmetic `pinInfo` with empty `signals`. So there is no bipolar
  logic, pin semantics, or step grammar to leak — it can be repurposed
  as a rotating motor-body display the same way `wokwi-led` is used as
  a brightness display.
- `wokwi-biaxial-stepper` is a **dual bipolar** part (8 pins
  `A1+`/`A1-`/`B1+`/`B1-`…`B2-`), further removed.
- `fritzing/fritzing-parts` (develop branch) has **zero `28BYJ`
  matches in the entire repo tree**. Core ships only
  `stepper_motor_unipolar.fzp` — a generic **square NEMA-style
  housing** with 6 connectors `A/B/C/D/COMMON_1/COMMON_2` (no
  `vcc`/`gnd`, no IN1–IN4) — and `ULN2003A.fzp`, a **bare DIP-16 chip**
  with no board, no header, and no motor.

So the view is a **vendored, modified** element — one visual, not two
(`StepperMotorView.tsx`, single `app-stepper-motor` at size 8, ~81×96
px). This is the confirmed-blocker vendoring the "use the published
package" rule above allows: the module needs a 6-pin wireable surface,
and no upstream part ships one with the right pins (`wokwi-stepper-motor`
stops at 4 bipolar leads; `wokwi-biaxial-stepper` is dual-bipolar;
Fritzing has no 28BYJ and no IN1–IN4/VCC/GND module). The hybrid it
replaced (real element as rotating body + a separate hand-drawn driver
strip for the pins) was dropped in favor of a single unified visual.
`src/vendor/wokwi/` carries `stepper-motor-element.ts` plus its
`pin.ts`/`utils/units.ts` deps, registered under **our own tag
`app-stepper-motor`** so the package's `wokwi-stepper-motor`
registration is untouched (no collision — asserted in browser-verify
step 11). Because we compile the raw source with
`useDefineForClassFields: true`, lit's `@property()`/`@customElement`
decorators are replaced with a static `properties` map + constructor
defaults + `declare` fields, plus an explicit
`customElements.define('app-stepper-motor', …)` — the same fix the
LED/button vendoring evaluation identified; the vendored source imports
`lit`, so it is now a direct npm dependency (`^3.3.3`).

Source changes vs upstream: the four `A-/A+/B+/B-` cosmetic leads are
relabeled `in1`…`in4` and **two leads `vcc`/`gnd` are added** — a
centered 6-lead strip at 2.54 mm pitch on the bottom face, mirroring
the module's IN1–IN4/VCC/GND header (size-8 footprint 80.892×96.012;
lead x = 15.553…63.559, y = 96.012). `pinInfo` reports the six
names/coordinates — it is the canvas marker surface and
`stepperPinOffsets` — and the `angle`/`arrow`/`value`/`units`/`size`
behavior is unchanged: the `angle` property still rotates just
`#arrow-path`/`#shaft-path`. There are **no text captions under the
leads**: they would collide with canvas markers, so labels surface via
`pinInfo` + marker tooltips instead. The element remains display-only;
the engine's unipolar tables stay the single source of truth for
behavior. Wokwi's MIT license is preserved, and a `TODO` at the top of
the vendored file requires adding explicit attribution before any
public release/sharing.

**Stepper sequences are hardcoded telltale tables, not derived — 4096 half-step / 2048 full-step per revolution**

The two pattern tables came from the task itself and were verified as
the real 28BYJ-48 sets rather than recomputed at runtime:

    Full-step:   1010  0110  0101  1001        (2048 steps/rev)
    Half-step:   1000  1010  0010  0110  0100  0101  0001  1001
                                               (4096 steps/rev)

Bit order is IN1 IN2 IN3 IN4 (**IN1 = most significant**), `1` =
winding excited (the ULN2003 sinks a coil when its input goes HIGH).
Structural fact exploited by the angle math: the four full-step states
sit at **every other position** of the half-step table, so a full step
advances 2× a half step (360/2048 per state vs 360/4096). Every pair
of adjacent states is adjacent in **exactly one** table, so a
transition can never ambiguously match both — the motor can always
decide which table it was driving. The tables are declared once and
any further verification edits both lists in lockstep.

---

**PIR motion sensor vendors + modifies `@wokwi/elements`' PIR as `app-pir-motion-sensor` — a second justified vendoring exception**

The HC-SR501-style module needs `vcc`/`out`/`gnd` surface pins and a
motion-detected visual state. The published parts were checked before
vendoring anything:

- `wokwi-pir-motion-sensor` (in `@wokwi/elements` 1.9.2) is an **exact
  physical match** for the HC-SR501 module: three leads in module order
  (bottom row, left→right `VCC` x=36.178 / `OUT` x=45.9175 / `GND`
  x=55.6415, all at y=92), viewBox 90.7×92.4 (24mm×24.448mm). But it
  is a **purely static SVG** — zero reactive properties, no state, no
  interactive anything — so it cannot reflect the engine's
  "motion detected" OUT-HIGH condition at all. Verified by reading the
  source and the installed package side by side: no other candidate in
  the library is closer.
- No near-adjacent wokwi part or Fritzing part ships a PIR with a
  state visual; hand-drawing would forfeit the module-accurate dome art
  (and the established "official part where one exists" rule).

So the view is the **published element's source, vendored + extended**:
same consequence as the stepper — the base art is right, the needed
capability (a `motionActive` display property) is not. Therefore we
compile `pir-motion-sensor-element.ts` ourselves under our own tag
`app-pir-motion-sensor` (the package's `wokwi-pir-motion-sensor`
registration stays untouched), applying the same decorator fix the
stepper documented: lit's `@customElement` removed, the added
`motionActive` Boolean lives in a static `properties` map + constructor
default + `declare` field, registration is an explicit
`customElements.define`. The three leads are relabeled `VCC`/`OUT`/`GND`
→ `vcc`/`out`/`gnd` (engine names), coordinates unchanged — the element
`pinInfo` IS the canvas marker surface (`pirPinOffsets`). When
`motionActive` is set the dome/lens recolor to a warm amber/red alert
glow (idle colors are upstream's exact values). Wokwi's MIT license is
preserved with a `TODO` for public attribution, as with the stepper.

**PIR sensor model: one boolean stimulus held for a configurable time — no sensing physics**

The detection model is deliberately minimal (the point is teaching pin
logic, not IR sensitivity):

- Pins: `vcc`/`gnd` are inert UNSET (wiring realism, relay precedent);
  `out` is an active-high OUT driver that **idles LOW** (never
  floating) and goes HIGH only while motion is detected.
- `triggerMotion()` is the entire stimulus: sets "detecting", starts a
  `holdSeconds`-long hold (default **5 s**, a typical HC-SR501 trimmer
  setting) and writes `out` HIGH **immediately** — a net resolve right
  after the call already reads HIGH, the same immediacy requirement as
  the pull-resistor and PWM fixes. No sensitivity/detection-distance
  model, no warm-up, no ambient sensing.
- The hold is burned down by accumulated `update(dt)` simulated time.
  `retriggerable` (default **true**, like the HC-SR501's repeat
  setting) restarts the full hold from a NEW trigger instant even
  mid-hold; non-retriggerable ignores any trigger while already active
  and just lets the original hold expire.

**PIR stimulus rides the shared `press` gesture — and stays a named method, not `HasStimulus<T>`**

The worker's `press` message is now a **press-able-anything** gesture:
a `Button` closes its contacts, a `PIRSensor` sees motion. Each
component owns its semantics; `release` remains button-only (a PIR has
nothing to release). The PIR keeps its stimulus as a public
`triggerMotion()` method rather than implementing the documented
`HasStimulus<T>` interface — a parameterless one-shot gesture doesn't
fit a `setStimulus(input)` shape (there is no input value to set), and
forcing it in would trade honest meaning for interface completeness. A
future genuinely-parametric sensor (distance, level) is the place to
introduce `HasStimulus<T>` for real (see `docs/ARCHITECTURE.md`).

**Stepper semantics: anchor on first contact, re-lock on the adjacent table, ignore anything else**

The four control pins are MODE_IN (pure sensor — no
`HasInternalConnections`, no driving value, so no two-tick contact
latency like the relay/transistor; one `tick()` after a pattern write
lands it). Recognition state per `update()`: rebuild the 4-bit
pattern; if it changed since last tick, first match anchors onto the
table that contains it *without moving* (a real driver can't know its
shaft position until it starts stepping, so we don't invent one);
thereafter a pattern that is the next or previous state in the locked
table advances by that table's step, and a pattern only adjacent in
the *other* table re-locks onto it (that is how half-step driving
folds in cleanly after a full-step anchor, and vice versa). Any other
pattern — all-low, all-high, misordered jumps — is ignored: no move,
no error, lock survives. `direction` is `"CW"`/`"CCW"` on step and
`"none"` until the first real step; `stepsPerSecond` is `1 / real
elapsed time since the last recognized step`, updating every tick so a
stationary shaft's rate decays toward 0 (and stays 0 until the first
step). `vcc`/`gnd` are UNSET and inert, mirroring the relay's coil
pins — wiring realism only.

One practical consequence for verification: the Pyodide bridge in
`pyodide.worker.ts` ticks the sim (and posts a snapshot) on **every**
`machine.Pin.value(...)` write, so a naive four-pin write from Python
lets each intermediate pattern reach the engine for a tick (e.g. going
`1010 -> 0110` by writing IN1 then IN2 exposes `0010`, a genuine half
step). The engine faithfully consuming those transients is correct
behaviour — the sim is digital and pin writes are discrete events. The
CircuitHost e2e batches the four writes into one tick, while
browser-verify step 10 writes **only the pin that changes** per half
table transition (the half table is a one-bit walk), so each write is
exactly one recognized step and the angle math stays deterministic.

---

**RC timing keeps the sim digital — a linear clock, not an RC curve**

The potentiometer/resistor/capacitor trio reproduces the teaching
technique "measure time with a capacitor and a GPIO" (the one-pin
charging measurement), not capacitor physics:

- `Potentiometer` and `Resistor` are **passive analog producers**: their
  active pin is MODE_IN (never OUT), and they publish a dimensionless
  "resistance fraction" on the `analogValue` channel. The pot publishes
  `knobPosition` (0..1); a resistor publishes `resistanceOhms /
  FULL_SCALE_OHMS` (full scale = **20 kΩ** by convention), defaulting to
  **10 kΩ** → 0.5. Their other leads are UNSET and inert (wiring
  realism only, the relay-coil-pin precedent).
- `Capacitor` is the only new *active-timer* part. Its `a` pin is MODE_IN
  and **owns its net's pull**; `b` is an inert ground lead. The two
  phases of the technique:
  - **DRIVE/discharge**: a real OUT GPIO holds the net, so `a` is
    `digitallyDriven` and the cap forces itself to match — HIGH ⇒ fully
    charged + pull UP, LOW ⇒ empty + pull DOWN. This is what
    "discharge the cap before polling" means, and it is why the cap
    never misreads its own earlier pull as a driver (see the dedicated
    `digitallyDriven` distinguish test).
  - **POLL/charge**: the GPIO flips to IN, no OUT drivers remain, and the
    ONLY forces on the net are the weak pulls (the cap's own) and the
    resistor/pot's analog fraction. Each tick the cap accumulates
    `dt × fraction` against a **linear** threshold
    `thresholdSeconds = maxChargeSeconds × fraction` (default
    `maxChargeSeconds` **2 s**). When crossed, the pull flips UP and the
    net resolves HIGH through the pull — the GPIO reads the awaited
    LOW→HIGH transition. No exponential charging curve, no ohms↔seconds
    calibration: `maxChargeSeconds × fraction` IS the documented model,
    exactly (and therefore the same RC voltage-divider question the
    recipe teaches — the capacitor charges slower for a bigger
    resistance).
- Fraction contributions keep the existing net rules: one analog source
  per net (two resistors on one net = an analog conflict), and the
  analog `analogValue` channel is unchanged — only *who may produce it*
  widened (see the engine `analogDelivered` marker + the "mode-IN analog
  sources" decision below).
- `setKnobPosition(...)` publishes the wiper fraction immediately (the
  PIR/PWM immediacy precedent) so a knob turn is live in the snapshot
  the turn's message returns, not one tick later.

---

**Analog sources may be MODE_IN pins — the `analogValue` channel is not
limited to OUT/PWM producers**

The pot wiper and the resistor's terminal1 are IN by design (a passive
element is a *producer of a voltage, not a driver of a level*). Before
this change the analog pass only ever let wave-generating OUT pins be
sources, so these parts had no channel to publish on. Two small engine
additions make it safe:

- `Pin.analogDelivered` — set only when the resolver **delivers a real
  (non-null) analog value** into a listener (null writes simply clear
  stale values and never stamp it). This is what keeps such a producer
  from being re-scored as a source on later passes: a delivered
  listener can never phantom-conflict with the true source, while a
  producer's own freshly-published value is always eligible.
- A source skips the write loop, so a component-driven IN producer keeps
  its own value (and its lack of the delivered marker) intact.
- The multi-source rule is unchanged: more than one eligible producer —
  or any OUT pin — on a net still marks the net as an analog conflict.

---

**Potentiometer view vendors + modifies `@wokwi/elements`' potentiometer as `app-potentiometer` — a third justified vendoring exception**

`wokwi-potentiometer` was actually the FIRST vendor candidate to be held
back by interaction, not pins: its own `down()`/`move()` handlers call
`stopPropagation()`/`preventDefault()` on mousedown and then rotate via
a circular `getScreenCTM` drag feeding a hidden `<input type=range>`
through `InputEvent`s. Under our snapshot engine the element must be a
**passive display** of `knobPosition` (the engine is the source of
truth), and its handlers would swallow canvas-level clicks and drags —
drag a knob and the component would never move, and knob motion would
fight the snapshot. So the source is vendored and modified (verified
there is no alternative: `slide-potentiometer` is a different form
factor with the same ownership problem):

- all interaction machinery and the hidden input removed; `knobPosition`
  (0..1) is the single property, with the upstream startDegree −135 /
  endDegree 135 constants folded into the knob-angle math;
- registered as **`app-potentiometer`** under our own tag (the package's
  `wokwi-potentiometer` registration stays untouched), with the same
  decorator fix (`static properties` + constructor default + `declare` +
  explicit `customElements.define`) as the stepper/PIR vendors;
- `pinInfo` unchanged — `GND`/`SIG`/`VCC` at (29/39/49, 68.5) — it IS
  the canvas marker surface (`potPinOffsets`), asserted to sub-pixel
  tolerance in browser-verify step 13 alongside the PIR/stepper checks;
- the knob TURN is a pointer-capture drag on an overlay sized to the
  knob ellipse in `PotentiometerView` (vertical travel maps 0..1 over a
  fixed client-pixel range; `stopPropagation` on the overlay's
  pointerdown keeps the canvas body-drag out), and the result relays as
  a top-`setKnobPosition` message → `CircuitHost.setKnobPositionMessage`
  → engine, which publishes the snapshot immediately.
- Wokwi's MIT license is preserved with a `TODO` for public attribution,
  as with the other vendors.

---

**Resistor uses the published `wokwi-resistor` unchanged — no vendoring**

Keyboard-row reality: the resistor is the only new part whose published
element fits as-is. `wokwi-resistor` has **no interaction handlers at
all** (a leaf display whose `value` string is reflected as the four
standard color bands), so the ref-property pattern (`LedView`) drives
`value = String(resistanceOhms)` from the snapshot with zero conflict.
Its `pinInfo` — terminal1 (0, 5.65) / terminal2 (58.8, 5.65) at the
natural 59.14×11.34 px size — is the canvas marker surface
(`resistorPinOffsets`), kept under the "use the published package by
default" rule with no exception.

---

**Capacitor is hand-drawn SVG — `@wokwi/elements` has no capacitor at all**

Verified directly in the installed `@wokwi/elements` 1.9.2 package:
enumerating `dist/esm/*.js` yields **50** registered elements and none
is a capacitor (the only passives are `resistor`, `potentiometer`,
`slide-potentiometer`, and `photoresistor-sensor`); a recursive grep
for `capacitor`/`CapacitorElement` confirms zero matches. The Fritzing
parts repo has candidate SVGs, but they are static third-party assets
outside the "official part where one exists" rule, and there is no
published element whose art the engine could drive anyway — so, per the
relay/transistor precedent, `CapacitorView` draws a radial electrolytic
can by hand (blue body, orange polarity stripe, top plate symbol) whose
charge state is shown as a green→amber fill rising through the can plus
an amber vent/rim glow + status dot when `charged`. The `a`/`b` leg tips
in the art ARE the canvas markers (`capacitorPinOffsets`). Browser-verify
asserts the offsets against the art's own geometry (there is no
`pinInfo` to diff against; the PIR/stepper/pot checks already cover that
pattern for element-backed parts).

---

**Ultrasonic sensor uses the published `wokwi-hc-sr04` unchanged — a third
passive/published part, and the newest Resistor situation, not a vendoring
exception**

Verified three tiers before touching anything (same evidence standard as the
PIR/stepper/pot vendors):

- The registered-tags audit already lists `wokwi-hc-sr04` among the 50
  elements in `@wokwi/elements` 1.9.2, and the package's index requires
  `./hc-sr04-element`, so the tag is already live via main.tsx's single
  `import "@wokwi/elements"`.
- The compiled `dist/cjs/hc-sr04-element.js` source has **zero interaction
  handlers** — a recursive search finds no `mousedown`/`mousemove`/
  `mouseup`/`touchstart`/`click`, no hidden `<input>`, no
  `stopPropagation`/`preventDefault`, and no stateful properties at all
  (its `.d.ts` exposes only `pinInfo` + `render()`). It is pure static SVG,
  exactly passive like `wokwi-resistor`, so there is nothing to fight the
  snapshot engine and no state to mirror — no vendoring, no `main.tsx`
  edit (VCC/TRIG/ECHO/GND pinInfo at (71.3, 81.3, 91.3, 101.3, 94.5) on the
  natural 170.1×94.5 px at 3.78 px/mm IS the canvas marker surface,
  `ultrasonicPinOffsets`, asserted sub-pixel in browser-verify step 14).

Part of the visual audit is doing the economics: the stepper/PIR/pot
vendors exist because their published elements *drive* or *own* state; an
element that does neither is the default-path case the "use the published
package" rule was written for.

---

**Ultrasonic sensor model: TRIG/ECHO time-of-flight pulse, distance is a
simulated stimulus — no ranging physics, no echo timeout**

The HC-SR04 is the second stimulus-in / pulse-out component (after the
PIR): the stimulus comes from OUTSIDE the circuit (`setSimulatedDistance`,
driven by the slider) and the response is the sensor's only real behavior —
the round-trip pulse.

- Pins: `vcc`/`gnd` inert UNSET (relay/PIR precedent); `trig` MODE_IN; `echo`
  is an active-high OUT driver that **idles LOW** (never floating).
- A **rising edge** on `trig` arms a measurement. `echo` goes HIGH the
  moment the edge lands (the edge is treated as occurring one `dt` before
  `update()`, so a zero-dt tick starts the echo at 0 elapsed) and stays HIGH
  for `simulatedDistanceCm × 58 µs` — the vendor's standard speed-of-sound
  round-trip constant (174 m/s of flight at 343 m/s = 58 µs/cm). When the
  accumulated `update(dt)` time reaches the duration, the echo drops LOW.
- Range: distances outside `[2, 400]` cm (the real factory spec) and
  `null` ("no object in front") **never start an echo** — no pulse at all,
  matching a real module whose target is out of range or absent.
- Simplifications, all deliberate (teaching pin-logic, not acoustics):
  only the RISING edge is honored — no minimum TRIG pulse-width validation,
  no sub-µs width timing; a rising edge **while an echo is already in
  flight is ignored** (a real module does not restart an in-progress pulse);
  and there is **no internal ~38 ms "no echo" timeout pulse** — the module's
  documented busy-timeout exists to handle a broken target, and modeling it
  would only produce an echo where the digital contract says "no object".

**The distance slide is one linear control (2..400 cm), and dragging to/past
its far end means "no object"**

The slider is a single horizontal track under the body (not a second canvas
obstacle): fraction p∈[0,1) maps to cm = 2 + p×398; **p ≥ 1.0 (dragged to or
past the far end) is `null`** — "nothing in front", the real sensor's
>max-range meaning. The thumb sits at the far end for `null` and a
left-drag from there picks a real distance again. The overlay
pointer-captures and `stopPropagation()`s exactly like the pot knob, so the
sweep can never drag the body around the canvas. The engine range `[2,400]`
is the slider's full travel, so 400 cm exactly is engine-reachable but not
slider-reachable (the stop above it is "no object") — documented, tested.

**A single sim tick is ~287 cm of HC-SR04 round-trip — so browser-verified
pulse math is driven by two host bridge primitives, not a new tick rate**

`pyodide.worker.ts` steps the sim at fixed `1/60`s (16.67 ms) per tick — the
RC/stepper timing was built against that cadence and it must not change. But
an HC-SR04 echo at teaching distances (2–400 cm → 116 µs–23.2 ms) is mostly
**shorter than one tick**: a naive real-Python `value()` poll under the
busy-wait (which freezes the sim) or the JSPI sleep (which advances only in
16.67 ms quanta) can only ever see pulses ≳287 cm, and never measure one.
Rather than retarget the global tick:

- `CircuitHost` now owns a **shared sim clock** (`simTimeSeconds`, advanced
  only by `tick()`, never wall-clock) exposed as `getSimTimeMicros()`;
- the worker bridge gains **`micros()`** (read the sim clock) and
  **`tickUs(us)`** (step the circuit in µs without snapshot spam) — the
  verification-only primitives browser-verify's step 14 uses to time TRIG
  high→ECHO low in real Python;
- `machine-shim.py` is **untouched**; no Python the UI runs needs these
  primitives. The pulse math stays exact: `t_start = micros()` before the
  `write(1)` (whose own tick adds exactly 16667 µs of echo in-flight), then
  `tickUs(1)`-stepping until the echo drops gives `t1 − t_start` =
  `cm × 58` µs to the µs — 300 cm → 17400 µs, verified live.

---

**Relay artwork is now the real Fritzing part `basic-relay-6p_1c569ac_002`, and `gnd` deliberately lands on the spare second common `C2`**

The relay is no longer hand-drawn. The artwork is the breadboard view of
fritzing/fritzing-parts' 6-pin generic SPDT relay, shipped as a static asset
(`src/ui/assets/basic-relay-6p.svg`) the same way the Pico board is:

- part: `core/basic-relay-6p_1c569ac_002.fzp` ("Relay", SPDT, THT)
- art: `svg/core/breadboard/basic-relay-6p_1c569ac_002.svg`
- <https://github.com/fritzing/fritzing-parts/blob/develop/svg/core/breadboard/basic-relay-6p_1c569ac_002.svg>

**The originally audited path does not exist.** `core/basic-relay.fzp` and
`svg/core/breadboard/relay_reloaded.svg` both 404 on `develop`. The upstream
file's own `<desc>` records its origin as `relay_reloaded.svg`, so that is the
name the part shipped under before fritzing-parts renamed it — the audited
candidate is this same part under its current name. Pin geometry is read from
the asset's own `<rect id="connectorNpin">` tabs, never eyeballed, at the
part's own `viewBox="-20 -10 560 445"` scaled to the previous 140-wide body
(scale 0.25 → 140×111.25, aspect preserved exactly).

**The pin mapping is deliberate, and one entry is a simplification:**

| engine label | part connector | why |
|---|---|---|
| `in` | `COIL1` (`connector1pin`) | coil control |
| `vcc` | `COIL2` (`connector4pin`) | coil supply |
| `com` | `C1` (`connector2pin`) | switch common |
| `no` | `A` (`connector0pin`) | normally open |
| `nc` | `B` (`connector5pin`) | normally closed |
| `gnd` | `C2` (`connector3pin`) | **spare second common** |

A bare SPDT relay has a **two-lead coil and no ground lead at all**, while the
engine models a relay *module* whose control side is `in`/`vcc`/`gnd`. Fritzing
ships no module-style relay to match: every relay in `core/` is either a bare
relay (`sparkfun-electromechanical-relay-pth*` = 5 pins, `TE_RELAY` = 4,
`DIP_Relay_D31A` = 8, WeMos shields = 19) or this 6-pin bare part, and
`contrib/` contains no relay module at all. This part is the only structural
match (6 connectors for 6 logical pins), so `gnd` is placed on `C2`, the
part's second switch common. That single reuse is a **documented
simplification, not an error**: it keeps all six engine pins wireable, the
engine's pin semantics are untouched, and no pin label changed. Verified
sub-pixel in browser-verify step 9 (worst |dx| = 0.015, |dy| = 0.016 stage
units, the same residual every other component shows).

---

**Transistor artwork is the real Fritzing `transistor_signal_NPN_TO92_CBE` — a generic TO-92, so the SOT-23 fallback was not needed**

The earlier audit had only identified a surface-mount
`sparkfun-discretesemi-transistor_npn-sot23.fzp` as a fallback. Searching
`core/` specifically for a generic through-hole package turned up a proper
one, so the fallback was **not** used:

- part: `core/transistor_signal_NPN_TO92_CBE.fzp` ("NPN-Transistor", `TO92 [THT]`)
- art: `svg/core/breadboard/transistor_npn.svg` (shared generic TO-92 art)
- <https://github.com/fritzing/fritzing-parts/blob/develop/svg/core/breadboard/transistor_npn.svg>

Chosen over SOT-23 for two reasons: it is the classic black 3-legged TO-92
silhouette the component is meant to look like, and — decisively — its real
left-to-right lead order **already matches** the BC547 reading the engine was
using, so `collector`/`base`/`emitter` stayed exactly as they were. The
`.fzp`'s breadboard mapping is the legacy-scrambled kind (`connector0`, named
`E`, points at `connector2pin`), so lead identity was resolved from the part's
geometry, not from the connector names: `connector0pin` (x=0) = left =
**collector**, `connector1pin` (x=7.181) = centre = **base**,
`connector2pin` (x=14.367) = right = **emitter**. Offsets come from those
rects at the part's own `viewBox="0 0 16.527 24.081"` scaled to the previous
80-wide body (→ 80×116.566 — a TO-92 with its leads is taller than it is
wide). Verified sub-pixel in browser-verify step 9 (worst |dx| = 0.015,
|dy| = 0.016).

---

**Fritzing assets are CC BY-SA 3.0 — share-alike is stricter than MIT, and attribution stays deferred on both files**

Both new assets come from fritzing-parts, which is **CC BY-SA 3.0**. That
matters more than the MIT terms covering `@wokwi/elements`: CC BY-SA's
**share-alike** term can reach derivative works, so it applies to these two
files specifically, not to the project as a whole. Both files carry a
one-line `TODO: add Fritzing CC BY-SA 3.0 attribution before any public
release/sharing` in their header, matching the standing deferred-attribution
policy already applied to the vendored stepper/PIR/potentiometer elements —
deliberately **deferred, not forgotten**. The only change to either file is
that header comment (the drawing markup is byte-identical to upstream, verified
by diffing against a fresh fetch), and each asset's XML declaration was
dropped because a comment ahead of `<?xml?>` is a fatal XML parse error when
an SVG is loaded through `<image>`. A full attribution file is not written yet,
consistent with the rest of the project; add it before any public release.

---

**Relay artwork is now the real DFRobot 3V Relay Module (DFR0473) — GPL-3.0, in-house only, and the pin mapping is now the module's own silkscreen, not a reuse**

The Fritzing `basic-relay-6p` part above was, by definition, a **bare SPDT
relay** — so the module-style engine interface (`in`/`vcc`/`gnd` +
`com`/`no`/`nc`) had to be forced onto it, including the awkward `gnd` → spare
common `C2` reuse. The task's target is a relay *module* with screw terminals
and a 3-pin control header, and DFRobot ships exactly that as a product
drawing, so the relay visual is replaced with the real module:

- repo: <https://github.com/DFRobot/DFRobot_3V-Relay-Module>
- file: `3V Relay Module V1.0 SVG.svg`, product **DFR0473** (Gravity 3V Relay
  Module, 38 × 33 × 20 mm board), schematic coil label **HF3FD** (the relay
  packages HC part number)
- vendored: `src/ui/assets/dfrobot-3v-relay-module.svg`

**License notes — this one is different from everything else shipped so far.**
The DFRobot repo carries a **GNU GPL v3 LICENSE** (2007-06-29), which is *not*
MIT (`@wokwi/elements`) and *not* CC BY-SA 3.0 (fritzing-parts). GPL-3.0's
copyleft can reach derivative files, so this single asset is **in-house use
only and is not publicly distributed**. The vendored file's header carries:
`GPL-3.0`, the upstream URL, an explicit "in-house only, not publicly
distributed" note, and `TODO: revisit this license (or add required
attribution) before ANY public release`. Same deferred-not-forgotten policy as
the other sourced art, but the license is heavier, so the TODO is marked
stronger.

**Artwork adaptation.** The upstream SVG is a full Inkscape A4 page
(744.09 × 1052.36) with **no viewBox** and the module drawn at x 211–335,
y 566–672.5. The vendored file adds `viewBox="211 566 124 106.5"` (crops the
page to the board; aspect preserved exactly) and drops the XML declaration so a
comment can lead the file (same fatal-parse fix as the Fritzing assets). No
drawing geometry changed; the only other edits are the leading comment.

**Pin geometry — measured, not eyeballed.** The module has **no
`connectorNpin` markup**, so `RelayView`'s offsets are area-weighted **pixel
centroids** of the module's own drawn connection metal, computed by probing the
served asset (`scripts/probe-dfrobot-centroids.mjs`): the 3 solder-pad-pair
centroids of the 3-pin "Gravity 3P Interface" header on the right and the 4
screw-eye centroids of the wiring terminal block on the left. Anchor points
(asset units, origin 211,566):

| engine label | part contact | asset anchor (x, y) |
|---|---|---|
| `in` | `D` header pad | (306.63, 626.688) |
| `vcc` | `+` header pad | (306.923, 618.791) |
| `gnd` | `-` header pad | (307.322, 611.203) |
| `com` | `COM` screw eye | (222.751, 636.986) |
| `no` | `NO` screw eye | (222.793, 615.392) |
| `nc` | `NC` screw eye | (222.768, 604.423) |
| (none) | `N/A` screw eye | (222.676, 626.043) |

The `N/A` terminal is silk-screened "N/A" (not available) as the real module's
quirk; it is drawn but has **no engine pin** — the engine only ever wires six.

This mapping is the module's real silkscreen, so the earlier `gnd`→spare-common
simplification is **gone**: each engine label now sits on the contact its name
means. No engine logic changes, no pin label changes — only the art and the
offset sources.

**Verification.** browser-verify step 9 proves the anchors against the *served
asset's own pixels* — the module art is rasterized offscreen exactly as
RelayView draws it (the image fills the board-cropping viewBox "211 566 124
106.5"), and every anchor's 3×3 neighbourhood must be drawn module art (pad
grey, dark screw, copper eye, pin hole — not white page, not green PCB, not
pale-cream silkscreen); then the DOM pin marker must land sub-pixel on that
anchor. This is the same guarantee the old Fritzing `connectorNpin` tabs
provided, adapted to an asset that carries none of its own.

The Fritzing relay/transistor sections above remain as historical record: the
transistor is unchanged, and the bare-relay reading (`in`→`COIL1`,
`gnd`→spare `C2`) still applies to *that* part — it just no longer ships.
