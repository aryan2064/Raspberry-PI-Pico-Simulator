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
   class Button extends Component {
     private pressed = false;

     constructor(id: string) {
       super(id);
       this.addPin("signal", "OUT"); // a button drives its signal pin
     }

     update(_dt: number): void {
       this.pin("signal").value = this.pressed ? "HIGH" : "LOW";
     }

     getRenderInfo(): RenderInfo {
       return { type: "button", isPressed: this.pressed };
     }

     // Component-specific method the UI calls on user interaction —
     // not part of the abstract base, since not all components need it.
     press(): void { this.pressed = true; }
     release(): void { this.pressed = false; }
   }
   ```

3. **Name every pin with a clear `label`.** Use names that will make
   sense both on a rendered canvas and in a `machine`-shim context if
   relevant (e.g. `"anode"`/`"cathode"` for LED, `"signal"` for a
   button, `"trigger"`/`"echo"` for an ultrasonic sensor). Pin mode
   (`IN` vs `OUT`) should reflect which side is expected to drive the
   net in normal use.

4. **Decide if this component needs a stimulus input** (i.e., is it a
   sensor-like component with no natural "driver" of its own, needing
   a human or another component to feed it fake real-world data?). If
   so, implement the `HasStimulus<T>` interface described in
   `docs/ARCHITECTURE.md` — don't invent a different pattern for this.
   Most components (anything that's driven purely by its pins, like
   `LED`) don't need this.

5. **Decide if this component needs cross-tick state.** Most simple
   components (LED, button) are effectively stateless between ticks —
   `update()` just reflects current pin values. Some components (e.g.
   an ultrasonic sensor timing a pulse) need to remember state across
   ticks (e.g. "waiting since tick N"). If so, store that as private
   fields on the component instance — don't push this kind of timing
   logic into `Circuit.tick()` itself, which should stay generic.

6. **Write a Vitest test**, following the pattern in the original
   `circuit-model.ts` demo: build a small `Circuit`, wire the new
   component to a `PicoBoard` (or another component), call
   `resolveNets()` once, then `tick(dt)`, and assert
   `getRenderInfo()` returns what you expect. Test both the "driven"
   and "undriven/floating" cases where relevant.

7. **Do not touch `ui/` or `execution/` to add a component.** If you
   find yourself needing to import something from those layers into
   the new component file, that's a sign the component is trying to do
   something outside the engine's responsibility — stop and reconsider
   rather than breaking the dependency rule.

## Checklist summary

- [ ] Confirmed this component is actually needed now, not speculative
- [ ] Built the minimal version first (no extra features "while I'm in there")
- [ ] Added one `RenderInfo` union variant
- [ ] Pins added with clear, meaningful `label`s and correct `IN`/`OUT` mode
- [ ] Implemented `update(dt)` and `getRenderInfo()`
- [ ] Considered whether `HasStimulus<T>` applies
- [ ] Considered whether cross-tick state is needed
- [ ] Wrote a Vitest test covering at least driven + floating cases
- [ ] No imports from `ui/` or `execution/` anywhere in the new file
