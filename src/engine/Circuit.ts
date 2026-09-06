import { Component, newId } from "./Component";
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

  // Groups all pins into nets using union-find over the wire list.
  // Call this whenever wiring changes — not every tick, only on edit.
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
  //   1. Resolve each net's digital value and propagate it to listening pins.
  //   2. Resolve each net's analogValue and propagate it to listening pins.
  //   3. Call update(dt) on every component so it can react / drive values.
  //   4. Propagate again (no second update()) — a component that writes its
  //      own output pin from update() (e.g. Button) has that value visible to
  //      listening pins within the same tick, not one tick later.
  tick(dt: number): void {
    this.propagate();

    for (const c of this.components) {
      c.update(dt);
    }

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
      }

      const conflict =
        drivers.length > 1 ||
        pins.filter((p) => p.mode === "OUT" && p.analogValue !== null).length > 1;

      for (const p of pins) {
        p.hasConflict = conflict;
        if (p.mode === "IN") {
          p.value = resolvedValue;
        }
      }
    }

    // Analog propagation — runs alongside the digital step above, on the
    // separate analogValue channel. Same conflict-handling placeholder as
    // the digital case: real conflict/short-circuit detection is deferred
    // to the validation-states phase, so multi-driver analog nets resolve
    // to null rather than a dedicated conflict state.
    for (const pins of this.nets.values()) {
      const analogDrivers = pins.filter(
        (p) => p.mode === "OUT" && p.analogValue !== null
      );

      let resolvedAnalog: number | null = null;
      if (analogDrivers.length === 1) {
        resolvedAnalog = analogDrivers[0].analogValue;
      } else if (analogDrivers.length > 1) {
        resolvedAnalog = null;
      }

      // Both channels count towards the conflict flag in both passes, so a
      // digital-only conflict is never cleared by the analog pass (or vice
      // versa) — the flag reflects the net, not the channel.
      const conflict =
        analogDrivers.length > 1 ||
        pins.filter((p) => p.mode === "OUT").length > 1;

      for (const p of pins) {
        p.hasConflict = conflict;
        if (p.mode === "IN") {
          p.analogValue = resolvedAnalog;
        }
      }
    }
  }
}

export { Circuit };
