import { Component, newId } from "./Component";
import type { HasInternalConnections } from "./Component";
import type { PinValue } from "./Pin";
import type { Pin } from "./Pin";
import { Wire } from "./Wire";

class Circuit {
  components: Component[] = [];
  wires: Wire[] = [];

  private nets: Map<string, Pin[]> = new Map(); // netId -> pins in that net

  addComponent(c: Component) {
    this.components.push(c);
  }

  connect(pinA: Pin, pinB: Pin): Wire {
    const wire = new Wire(newId(), pinA, pinB);
    this.wires.push(wire);
    return wire;
  }

  // Removes the wire with the given id. Like connect(), this does not call
  // resolveNets() — the caller does that after wiring changes.
  disconnect(wireId: string): void {
    this.wires = this.wires.filter((w) => w.id !== wireId);
  }

  // Removes the component with the given id, together with every wire that
  // touches any of its pins (the other end of each such wire simply stops
  // being connected to the removed component's pin). Like connect() and
  // disconnect(), this does not call resolveNets() — the caller does that
  // after the edit.
  removeComponent(componentId: string): void {
    this.components = this.components.filter((c) => c.id !== componentId);
    this.wires = this.wires.filter(
      (w) => w.a.owner.id !== componentId && w.b.owner.id !== componentId
    );
  }

  // Groups all pins into nets using union-find over the wire list, plus every
  // HasInternalConnections component's current internal pairs (a button's
  // permanent strip shorts leg1a-leg1b / leg2a-leg2b, the leg1a-leg2a bridge
  // while pressed, a closed switch, a jumper). Called on every
  // wiring edit AND at the top of tick() — after this task's Button rewrite
  // a net's membership can change on press/release without any wire edit, so
  // nets must be re-grouped per tick for passive/dynamic connections to take
  // effect. At current component counts this is cheap (one re-run of
  // union-find per tick); revisit only if profiling ever shows it as a real
  // bottleneck.
  resolveNets(): void {
    const allPins: Pin[] = this.components.flatMap((c) => c.pins);
    const parent = new Map<string, string>(); // pin.id -> pin.id (union-find)

    const find = (id: string): string => {
      if (parent.get(id) !== id) {
        parent.set(id, find(parent.get(id)!));
      }
      return parent.get(id)!;
    };
    const union = (idA: string, idB: string) => {
      const rootA = find(idA);
      const rootB = find(idB);
      if (rootA !== rootB) parent.set(rootA, rootB);
    };

    for (const p of allPins) parent.set(p.id, p.id);
    for (const w of this.wires) union(w.a.id, w.b.id);

    // Internal connections participate in net grouping exactly like wires:
    // while closed they merge the two pins' nets, and when open (no pairs
    // returned) each leg goes back to its own net.
    for (const c of this.components) {
      const withInternal = c as Component & HasInternalConnections;
      if (typeof withInternal.getInternalConnections === "function") {
        for (const [pinA, pinB] of withInternal.getInternalConnections()) {
          union(pinA.id, pinB.id);
        }
      }
    }

    // Group pins by their root — each root becomes one net.
    const grouped = new Map<string, Pin[]>();
    for (const p of allPins) {
      const root = find(p.id);
      if (!grouped.has(root)) grouped.set(root, []);
      grouped.get(root)!.push(p);
      p.netId = root;
    }

    this.nets = grouped;
  }

  // One simulation step:
  //   0. Re-group nets (resolveNets()) — a passive switch's press/release can
  //      merge or split nets without any wire edit, so nets cannot be assumed
  //      current just because wiring hasn't changed.
  //   1. Resolve each net's digital value and propagate it to listening pins.
  //   2. Resolve each net's analogValue and propagate it to listening pins.
  //   3. Call update(dt) on every component so it can react / drive values.
  //   4. Propagate again (no second update()) — a component that writes its
  //      own output pin from update() has that value visible to listening
  //      pins within the same tick, not one tick later.
  tick(dt: number): void {
    this.resolveNets();
    this.propagate();

    for (const c of this.components) {
      c.update(dt);
    }

    this.propagate();
  }

  // Re-groups nets and re-propagates values without running any component
  // update() or advancing time. For callers that change pin properties
  // directly (e.g. the machine.Pin bridge applying a pull on setup) and need
  // the effect visible immediately instead of on the next tick.
  resolveNow(): void {
    this.resolveNets();
    this.propagate();
  }

  // Re-resolve every net's digital value and analogValue from the current
  // driver pins and propagate to listening pins. Does not call update().
  private propagate(): void {
    for (const pins of this.nets.values()) {
      const drivers = pins.filter((p) => p.mode === "OUT");

      let resolvedValue: PinValue = "FLOATING";
      if (drivers.length === 1) {
        resolvedValue = drivers[0].value;
      } else if (drivers.length > 1) {
        // Multiple outputs driving the same net — a real conflict.
        // Flagging as FLOATING for now; proper "CONFLICT/short" state is a
        // validation-layer concern for later, not solved here.
        resolvedValue = "FLOATING";
      } else {
        // No active driver — fall back to any internal pull resistors
        // configured on pins in this net (e.g. the RP2040's weak internal
        // pulls, set via machine.Pin(id, mode, pull) or the demo topology).
        // An active driver always wins over a pull; only a driverless net
        // consults pulls.
        const hasUp = pins.some((p) => p.pull === "UP");
        const hasDown = pins.some((p) => p.pull === "DOWN");
        if (hasUp && !hasDown) {
          resolvedValue = "HIGH";
        } else if (hasDown && !hasUp) {
          resolvedValue = "LOW";
        }
        // Both UP and DOWN pulls with no driver -> FLOATING. Documented
        // simplification (a real fight between opposing pulls is not modeled).
      }

      const conflict =
        drivers.length > 1 ||
        pins.filter((p) => p.mode === "OUT" && p.analogValue !== null).length > 1;

      for (const p of pins) {
        p.hasConflict = conflict;
        // Whether some OUT pin is actively driving this net (a real driver,
        // conflict nets included). A pull is never a driver.
        p.digitallyDriven = drivers.length > 0;
        if (p.mode === "IN") {
          p.value = resolvedValue;
        }
      }
    }

    // Analog propagation — runs alongside the digital step above, on the
    // separate analogValue channel. Same conflict-handling placeholder as
    // the digital case: real conflict/short-circuit detection is deferred
    // to the validation-states phase, so multi-source analog nets resolve
    // to null rather than a dedicated conflict state.
    //
    // Sources are ANY pin carrying a non-null analogValue (mode no longer
    // matters — passive analog producers like a Potentiometer's wiper or a
    // Resistor's terminal1 are IN pins), EXCLUDING pins whose analogValue was
    // delivered by THIS pass on an earlier tick (Pin.analogDelivered). The
    // exclusion is what stops a delivered listener value (e.g. a Capacitor's
    // `a`) from re-qualifying as a second source and phantom-conflicting with
    // the resistor that actually produced it.
    for (const pins of this.nets.values()) {
      const analogSources = pins.filter(
        (p) => p.analogValue !== null && !p.analogDelivered
      );

      let resolvedAnalog: number | null = null;
      if (analogSources.length === 1) {
        resolvedAnalog = analogSources[0].analogValue;
      } else if (analogSources.length > 1) {
        resolvedAnalog = null;
      }

      // Both channels count towards the conflict flag in both passes, so a
      // digital-only conflict is never cleared by the analog pass (or vice
      // versa) — the flag reflects the net, not the channel.
      const conflict =
        analogSources.length > 1 ||
        pins.filter((p) => p.mode === "OUT").length > 1;

      for (const p of pins) {
        p.hasConflict = conflict;
        // Write resolvedAnalog only into IN *listener* pins. Source pins are
        // skipped so a component-driven IN producer keeps its OWN value and
        // never gets the analogDelivered marker (which would wrongly retire
        // it from producing on the next pass).
        if (p.mode === "IN" && !(p.analogValue !== null && !p.analogDelivered)) {
          p.analogValue = resolvedAnalog;
          // Stamp the marker only when DELIVERING a real signal. A null write
          // (net has no source) just clears stale values; stamping it here
          // would poison a component-driven producer whose first update() had
          // not run yet when this pass saw it as a null IN pin.
          if (resolvedAnalog !== null) {
            p.analogDelivered = true;
          }
        }
      }
    }
  }
}

export { Circuit };
