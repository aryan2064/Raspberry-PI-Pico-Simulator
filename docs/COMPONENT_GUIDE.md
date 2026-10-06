# How to Add a New Component

A practical checklist for adding the next component after `LED`, so new
components stay consistent with the established pattern instead of
each reinventing its own shape. Read `docs/ARCHITECTURE.md` first if
you haven't — this doc assumes you understand `Pin`, `Component`, and
`RenderInfo`.

## Before you start

- **Is this component actually needed right now** for a feature being
  built, or is it speculative? If speculative, don't build it yet —
  see the "don't pre-build" rule in `docs/DECISIONS.md` and
  `docs/ROADMAP.md`.
- **What is the absolute minimum version of this component** that
  proves it works end-to-end? Build that first. `LED` shipped as
  on/off only, with brightness/color explicitly deferred — follow that
  pattern.

## Steps

1. **Add a `RenderInfo` variant** in the union (currently in the
   engine's shared types). One new object type, tagged with a unique
   `type` string. Only include fields the canvas actually needs to
   draw this component's current state — not fields for behavior it
   doesn't have yet.

   ```ts
   | { type: "button"; isPressed: boolean }
   ```

2. **Create the component file** under `src/engine/components/`,
   extending `Component`:

   ```ts
   class Button extends Component implements HasInternalConnections {
     private closed = false;

     constructor(id: string) {
       super(id);
       // A real push button has two mechanical strips; each strip spans
       // two corners of the body and stays shorted, so it is modeled as
       // two duplicated legs (matching wokwi's 1.l/1.r and 2.l/2.r).
       this.addPin("leg1a", "UNSET");
       this.addPin("leg1b", "UNSET");
       this.addPin("leg2a", "UNSET");
       this.addPin("leg2b", "UNSET");
     }

     // Internal wiring the net resolver treats like a wire. The two
     // strip-pairs are permanent (a strip keeps its duplicated legs
     // coterminal even unpressed); pressing adds the strip-to-strip
     // bridge leg1a-leg2a. Because the button never drives,
     // opening/closing it can merge/split nets but never manufactures a
     // driver conflict.
     getInternalConnections(): Array<[Pin, Pin]> {
       const pairs: Array<[Pin, Pin]> = [
         [this.pin("leg1a"), this.pin("leg1b")],
         [this.pin("leg2a"), this.pin("leg2b")],
       ];
       if (this.closed) pairs.push([this.pin("leg1a"), this.pin("leg2a")]);
       return pairs;
     }

     update(_dt: number): void { /* state live off pins alone */ }

     getRenderInfo(): RenderInfo {
       return { type: "button", isPressed: this.closed };
     }

     // Component-specific method the UI calls on user interaction —
     // not part of the abstract base, since not all components need it.
     press(): void { this.closed = true; }
     release(): void { this.closed = false; }
   }
   ```

   Note the modern pattern: components are either **drivers** (e.g. the
   board's `OUT` GPIOs pump a `value`/`analogValue` onto their pins) or
   **passive** (e.g. LED, button — they listen, or swap internal
   wiring, and never drive a net). A passive switch implements
   `HasInternalConnections` instead of writing to a pin in `update()`;
   that is the hook the net resolver merges/splits nets from on every
   tick. Read `docs/ARCHITECTURE.md` for the full contract.

   **State-driven switches are the same pattern, flipped by an input.**
   `Relay` (`in/vcc/gnd/com/no/nc`) and `Transistor` (`base/collector/
   emitter`) also implement `HasInternalConnections`, but instead of
   `press()`/`release()` flipping a flag, `update()` reads an IN-mode
   control pin and sets the flag from it: the relay returns exactly
   `[[com,no]]` when `in === "HIGH"` else `[[com,nc]]` (a true SPDT —
   always one pair, never both); the transistor returns
   `[[collector,emitter]]` only while `base === "HIGH"` and `[]` in
   cutoff (LOW **or** FLOATING). All control-side pins read through a
   real wire in tests; the flag is never poked directly. Because the
   flag flips inside `update()`, a control change reaches the contacts
   on the **second** tick after it lands on the net (`tick()` groups
   nets before `update()` runs) — assert the settled state after two
   `tick()`s, and the old-contact break in between. See
   `Relay.test.ts` / `Transistor.test.ts` (and their `docs/DECISIONS.md`
   entries) for the walk-through.

   **Sequence-sensing components are a third pattern.** `StepperMotor`
   (`in1/in2/in3/in4/vcc/gnd`) models a 28BYJ-48 + ULN2003 driver module
   as the MCU sees it: four raw digital control inputs and two inert
   power pins. It is a pure *sensor* — it reads the four `IN` pins in
   `update()`, reconstructs the 4-bit pattern (IN1 = MSB), and matches
   it against the hardcoded full-step / half-step tables in
   `docs/DECISIONS.md`. Because it never drives a net and swaps no
   internal wiring, it implements neither `HasInternalConnections` nor
   a `value`. The first valid pattern only *anchors* position (no
   phantom movement); every subsequent pattern that is a valid
   next-state (forward or backward) in either table advances the angle
   by that table's step. Invalid patterns are ignored. This makes it
   the first component whose behavior is *cross-tick stateful* in a way
   the abstract base anticipates: it stores `angleDegrees`, direction,
   the locked table + index, and a `timeSinceStep` accumulator it uses
   to report a true `stepsPerSecond`. Tests drive the four inputs over
   real wires (see `StepperMotor.test.ts`); only ONE `tick()` after a
pattern write is needed because all four pins are MODE_IN (no second
    tick for an internal flip like the relay/transistor).

   **Passive analog producers & an RC timer are a fourth pattern.**
   `Potentiometer` (`terminal1`/`wiper`/`terminal2`) and `Resistor`
   (`terminal1`/`terminal2`) are **producers on the analog channel**:
   their active pin is MODE_IN (never OUT — a passive part shades a net,
   it never drives one) and its `analogValue` is set directly (in the
   constructor/setter AND every `update()` for immediacy). The
   `Capacitor` (`a`/`b`) is the active-timer consumer: `a` is MODE_IN,
   reads its net's resolved `analogValue` as a 0..1 "resistance
   fraction", accrues a linear charge clock against
   `maxChargeSeconds × fraction`, and OWNS its net's PULL (writes it
   every tick). While a real OUT driver holds the net (`a.digitallyDriven`)
   it force-adopts (DRIVE phase). Run-throughs: `Potentiometer.test.ts`
   / `Resistor.test.ts` / `Capacitor.test.ts`, plus the end-to-end RC
   pulse in `CircuitHost.test.ts`.

**A pulse-timing stimulus component is a fifth pattern.**
   `UltrasonicSensor` (`vcc/trig/echo/gnd`) is the second stimulus-in /
   pulse-out part (after `PIRSensor`): it has no ranging model — the
   *distance* is the simulated stimulus (set externally) and its only real
   behavior is the HC-SR04 TRIG/ECHO pulse. `echo` is an OUT driver that
   idles LOW, `trig` is MODE_IN; `update()` watches for a **rising edge**
   on `trig` (tracking the previous value across ticks) and, when a valid
   non-null distance in `[2, 400]` cm is set, drives `echo` HIGH for
   `distance × 58 µs` of accumulated `dt` then LOW — a *cross-tick timer*
   (private `elapsedSeconds`/`echoDurationSeconds`), the exact case step 6
   names. Retriggers mid-pulse are ignored; there is no ~38 ms no-echo
   timeout (see `docs/DECISIONS.md`). The stimulus is parametric (a
   distance, not a boolean), so unlike the PIR it does **not** ride the
   `press` gesture — it has its own `setSimulatedDistance(cm|null)` and its
   own worker message (`top-setSimulatedDistance`, routed by
   `CircuitHost.setSimulatedDistanceMessage`) — the real instantiation of
   the "parametric stimulus" idea `HasStimulus<T>` was documented for. The
   distance slice (the engine `[2,400]` range) is a linear slider under the
   body; dragging to/past the far end is `null` = "no object". Tests drive
   trig over a wire and assert the echo HIGH→LOW at `58 µs/cm` for several
   distances, the null/out-of-range no-echo cases, the ignored retrigger,
   and the end-to-end pulse through `CircuitHost`.

3. **Name every pin with a clear `label`.** Use names that will make
   sense both on a rendered canvas and in a `machine`-shim context if
   relevant (e.g. `"anode"`/`"cathode"` for LED, `"leg1a"`/`"leg1b"`/
   `"leg2a"`/`"leg2b"` for a 4-leg button, `"trigger"`/`"echo"` for an
   ultrasonic sensor). Pin mode
   (`IN` vs `OUT`) should reflect which side is expected to drive the
   net in normal use; passive components use `UNSET` (LED's pins are
   `IN`, since they only ever listen).

4. **Give the component a visual.** `ui/components/` holds one view per
   component. **Default: use the published `@wokwi/elements` package.**
   Where it ships an authentic part (`wokwi-led`, `wokwi-pushbutton`),
   the view wraps it (boolean props via refs — see
   `LedView.tsx`/`ButtonView.tsx`); otherwise it renders its own static
   SVG like `PicoBoardView.tsx` does (the board uses Raspberry Pi's
official Fritzing part, adopted as a repo asset). Vendor source only
    as a last resort if a real, confirmed blocker is found — and in that
    case document the specific blocker in `docs/DECISIONS.md`, not just
    "it didn't work." That is the stepper: `StepperMotorView.tsx`
    renders one vendored+modified element, `app-stepper-motor` (in
    `src/vendor/wokwi/`), because the published `wokwi-stepper-motor`
    exposes only 4 bipolar cosmetic pins while the module needs a 6-pin
    `in1`–`in4`/`vcc`/`gnd` surface (fed `angleDegrees` via its
    display-only `angle` property, per `docs/DECISIONS.md`). The
    potentiometer is a second interaction-driven vendor
    (`app-potentiometer` — the published element owns mousedown/drag and
    would steal canvas gestures from a knob-driven part); the resistor
    is a plain direct-use `<wokwi-resistor>` (no handlers, drive its
    `value` string); and the capacitor is hand-drawn SVG (`CapacitorView`,
    radial electrolytic) because `@wokwi/elements` has **no** capacitor
    element at all — all three decided in `docs/DECISIONS.md`. Vendored
    source compiled in-repo needs lit's decorators replaced by a static
    `properties` map + constructor defaults + `declare` fields under our
    `useDefineForClassFields` tsconfig, and must register under our own
    tag so the package's registration is untouched. Each view also exports its
   pin anchor offsets (`PinOffsetMap`, stage coordinates the canvas
   needs for wire and pin rendering — take the part's offsets from the
   element's `pinInfo`, mirroring its flip/geometry, as
`LedView`/`ButtonView` do; a static-SVG part with no wokwi element,
    like the board, extracts them from its asset's own geometry (the
    official part's `connector{N}pin` circles) mapped through the same
    transform the artwork ships with — see `PicoBoardView.tsx`) and keeps a stable outer
   `data-testid` plus `data-selected`/state attrs for tests.
   `renderComponentView` in `CircuitCanvas.tsx` switches on
   `renderInfo.type`, and `ComponentPalette.tsx` mirrors identical
   scaled previews. Engine code never imports these files.

5. **Decide if this component needs a stimulus input** (i.e., is it a
   sensor-like component with no natural "driver" of its own, needing
   a human or another component to feed it fake real-world data?).
   Sensor components have no input pin to react to — their stimulus
   travels the worker `press` message, so add a placeable kind and
   route `press` to a public stimulus method (e.g.
   `PIRSensor.triggerMotion()`), the concrete pattern `PIRSensor`
   established. Keep a future parametric sensor in mind: the generic
   `HasStimulus<T>` interface in `docs/ARCHITECTURE.md` is documented
   for when a stimulus has real parameters (distance, level) — don't
   force a parameterless gesture into it. A parametric stimulus — a
   value, not a boolean — gets its own top-level worker message routed
   to a public setter, like `top-setSimulatedDistance` →
   `CircuitHost.setSimulatedDistanceMessage` →
   `UltrasonicSensor.setSimulatedDistance()` (the PIR's parameterless
   gesture stays on `press`).
   Most components (anything that's driven purely by its pins, like
   `LED`) don't need this.

6. **Decide if this component needs cross-tick state.** Most simple
   components (LED, button) are effectively stateless between ticks —
   `update()` just reflects current pin values. Some components (e.g.
   an ultrasonic sensor timing a pulse) need to remember state across
   ticks (e.g. "waiting since tick N"). If so, store that as private
   fields on the component instance — don't push this kind of timing
   logic into `Circuit.tick()` itself, which should stay generic.

7. **Write a Vitest test**, following the pattern in the engine tests:
   build a small `Circuit`, wire the new
   component to a `PicoBoard` (or another component), call
   `tick(dt)`, and assert
   `getRenderInfo()` returns what you expect. Test both the "driven"
   and "undriven/floating" cases where relevant. For a passive switch,
   also test press/release changing net membership without any wire
   edit. For a **state-driven** switch (relay, transistor), drive the
   control pin over a wire and assert the settled contact pair after
   two ticks, plus the old-contact break (e.g. the de-energized nc
   path's rail disappearing when `in` goes HIGH) — see
   `Relay.test.ts`. UI tests then assert the new `data-testid`s appear
   and state attrs flip — position/selection assertions read the body
   wrapper's `style.left/top`, never `<g transform>` strings.

8. **Do not touch `ui/` or `execution/` to add a component.** If you
   find yourself needing to import something from those layers into
   the new component file, that's a sign the component is trying to do
   something outside the engine's responsibility — stop and reconsider
   rather than breaking the dependency rule. (The engine file is
   pure; the view/palette wiring from step 4 is UI code calling into
   the engine, never the reverse.)

## Checklist summary

- [ ] Confirmed this component is actually needed now, not speculative
- [ ] Built the minimal version first (no extra features "while I'm in there")
- [ ] Added one `RenderInfo` union variant
- [ ] Pins added with clear, meaningful `label`s and correct mode (`IN`/`OUT`/`UNSET`)
- [ ] Implemented `update(dt)` and `getRenderInfo()`
- [ ] Passive switch? Implements `HasInternalConnections`, not pin-driving
- [ ] State-driven switch? Control pin is MODE_IN, flag set in `update()`, decide between `[pair]` / `[pair]` or `[]` per state
- [ ] Sequence-sensing stateful part? Reads multi-pin pattern in `update()`, hardcoded telltale tables, anchors first contact, ignores garbage, stores angle/direction/rate as fields
- [ ] Passive analog producer / RC timer? Active pin is MODE_IN publishing `analogValue`, capacitor owns the net's PULL and reads the analog fraction as its charge rate
- [ ] Sensor (no input pin) part? Parameterless stimulus = route `press` to a public method like `PIRSensor.triggerMotion()`; parametric stimulus (a value, e.g. distance) = its own top-level message to a setter like `setSimulatedDistance`; drive the OUT pin / timer and mirror state for `getRenderInfo()`
- [ ] Added a view (`wokwi` element or static SVG, official part where one exists) with pin offsets + state testids
- [ ] Wired `renderComponentView` + palette preview
- [ ] Considered whether a stimulus input (`HasStimulus<T>` / a press-routed stimulus method / a parametric top-level message) applies
- [ ] Considered whether cross-tick state is needed
- [ ] Pulse-timing stimulus part? Rising-edge trigger detection, cross-tick echo timer at a documented µs/cm constant, null/out-of-range = no echo, retrigger ignored
- [ ] Wrote a Vitest test covering at least driven + floating cases
- [ ] No imports from `ui/` or `execution/` anywhere in the new file
