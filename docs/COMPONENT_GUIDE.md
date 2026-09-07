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
   `LedView.tsx`/`ButtonView.tsx`); otherwise it stays a hand-drawn SVG
   like `PicoBoardView.tsx`. Per `docs/DECISIONS.md`, only vendor source
   as a last resort if a real, confirmed blocker is found — and in that
   case document the specific blocker in `docs/DECISIONS.md`, not just
   "it didn't work." Each view also exports its
   pin anchor offsets (`PinOffsetMap`, stage coordinates the canvas
   needs for wire and pin rendering — take the part's offsets from the
   element's `pinInfo`, mirroring its flip/geometry, as
   `LedView`/`ButtonView` do) and keeps a stable outer
   `data-testid` plus `data-selected`/state attrs for tests.
   `renderComponentView` in `CircuitCanvas.tsx` switches on
   `renderInfo.type`, and `ComponentPalette.tsx` mirrors identical
   scaled previews. Engine code never imports these files.

5. **Decide if this component needs a stimulus input** (i.e., is it a
   sensor-like component with no natural "driver" of its own, needing
   a human or another component to feed it fake real-world data?). If
   so, implement the `HasStimulus<T>` interface described in
   `docs/ARCHITECTURE.md` — don't invent a different pattern for this.
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
   edit. UI tests then assert the new `data-testid`s appear and state
   attrs flip — position/selection assertions read the body wrapper's
   `style.left/top`, never `<g transform>` strings.

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
- [ ] Added a view (`wokwi` element or hand-drawn SVG) with pin offsets + state testids
- [ ] Wired `renderComponentView` + palette preview
- [ ] Considered whether `HasStimulus<T>` applies
- [ ] Considered whether cross-tick state is needed
- [ ] Wrote a Vitest test covering at least driven + floating cases
- [ ] No imports from `ui/` or `execution/` anywhere in the new file
