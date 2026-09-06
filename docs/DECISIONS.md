# Decision Log

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
