import type { RenderInfo } from "../engine";
import type { PinMode, PinPull } from "../engine";

// The only things that cross the worker boundary are structured-clone-able
// messages — never JS object references. Every message shape in both
// directions lives here so worker and main thread stay in lockstep.

export type ComponentKind = "pico_board" | "led" | "button" | "relay" | "transistor" | "stepper" | "pir";

// A pin as seen from the main thread: component id + pin label. Pin OBJECTS
// live in the worker's Circuit; the main thread never holds a reference.
// A pin as seen from the main thread: component id + pin label. Pin OBJECTS
// live in the worker's Circuit; the main thread never holds a reference.
export interface PinRef {
  componentId: string;
  pinLabel: string;
}

// ---- Main thread -> Worker ----

export type MainToWorkerMessage =
  | AddComponentMessage
  | ConnectMessage
  | DisconnectMessage
  | PressReleaseMessage
  | RemoveComponentMessage
  | SetupPinMessage
  | RunMessage;

export interface AddComponentMessage {
  type: "addComponent";
  componentId: string;
  kind: ComponentKind;
}

// wireId is the main thread's identifier for this connection (drawn from its
// topology record). The worker maps it to the engine's internally-generated
// Wire id, so a later disconnect(wireId) resolves correctly.
export interface ConnectMessage {
  type: "connect";
  wireId: string;
  pinOwnerIdA: string;
  pinLabelA: string;
  pinOwnerIdB: string;
  pinLabelB: string;
}

export interface DisconnectMessage {
  type: "disconnect";
  wireId: string;
}

export interface RemoveComponentMessage {
  type: "removeComponent";
  componentId: string;
}

export type PressReleaseMessage =
  | { type: "press"; componentId: string }
  | { type: "release"; componentId: string };

// Pre-configures a board GPIO the way machine.Pin(id, mode, pull) would,
// WITHOUT running any Python. The app uses this in its initial topology
// setup / replay to configure demo pins (e.g. GPIO15 as IN with an internal
// pull-down so the button circuit reads LOW at rest). mode is the engine's
// vocabulary (not the numeric machine.Pin constants); pull is the engine's
// PinPull ("NONE" when omitted).
export interface SetupPinMessage {
  type: "setupPin";
  gpio: number;
  mode: PinMode;
  pull?: PinPull;
}

export interface RunMessage {
  type: "run";
  code: string;
}

// ---- Worker -> Main thread ----

export type WorkerToMainMessage =
  | SnapshotMessage
  | StdoutMessage
  | ErrorMessage
  | ReadyMessage;

// The worker re-reads every component's getRenderInfo() and posts the full
// set. The main thread renders purely from this; it never asks the worker for
// individual values.
export interface SnapshotMessage {
  type: "snapshot";
  components: SnapshotComponent[];
  // Every pin id whose net currently has more than one driver (a genuine
  // conflict/short between two outputs). The UI matches these against the
  // wire topology to flag the affected connections. Empty when nothing is
  // conflicted.
  conflictedPinIds: string[];
}

// A component as seen in a snapshot: its render info plus the identity of
// each of its pins (id + label). The topology record identifies wires by
// `componentId` + `pinLabel`, but conflict ids are engine pin uuids — this
// mapping is what lets the canvas resolve one to the other.
export interface SnapshotComponent {
  id: string;
  renderInfo: RenderInfo;
  pins: SnapshotPin[];
}

export interface SnapshotPin {
  id: string;
  label: string;
}

export interface StdoutMessage {
  type: "stdout";
  text: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

export interface ReadyMessage {
  type: "ready";
}

// ---- Main-thread topology record ----

// The main thread's authoritative record of what the user has built. Not used
// for rendering (snapshots are); it exists so a terminated worker's state can
// be rebuilt exactly (component set + every connection, replayed in order).
export interface TopologyComponent {
  id: string;
  kind: ComponentKind;
}

export interface TopologyConnection {
  wireId: string;
  from: PinRef;
  to: PinRef;
}

export interface Topology {
  components: TopologyComponent[];
  connections: TopologyConnection[];
  // Optional pin pre-configurations replayed alongside components/connections
  // (e.g. the demo's GPIO15 IN + pull-down). Same shape as the setupPin
  // message; the spawn/replay path posts them in order after the wires.
  pinSetups?: SetupPinMessage[];
}