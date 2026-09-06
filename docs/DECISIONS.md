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
