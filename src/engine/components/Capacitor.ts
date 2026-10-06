import { Component, newId } from "../Component";
import type { RenderInfo } from "../RenderInfo";

export interface CapacitorOptions {
  // Charging everything is time-constant-free by design: the capacitor reaches
  // "charged" after maxChargeSeconds * resistanceFraction of accumulated
  // simulation time (linear timer, no exponential RC curve — see
  // docs/DECISIONS.md "RC timing"). A resistanceFraction of 1.0 charges in
  // maxChargeSeconds.
  maxChargeSeconds?: number;
}

// A capacitor implementing the classic GPIO RC-timing technique:
//
//   a  <- the ONLY active pin. IN: it LISTENS to its net's analogValue (the
//         resistance fraction a Resistor/Potentiometer on the same net
//         publishes) AND owns its net's pull, which is how it drives.
//   b  <- the ground lead. Present for wiring realism; inert.
//
// The two phases of the technique (see docs/COMPONENT_GUIDE.md for the full
// recipe):
//
//   DRIVE (discharge) — a real GPIO OUT pin holds the shared net. Capacitor.a
//         is digitallyDriven, so the cap forces itself to match: a HIGH driver
//         -> fully charged, pull UP; a LOW driver -> empty, pull DOWN. The
//         active driver always wins over the pull, so this adopts whatever the
//         GPIO says. This is what "discharge the cap before polling" means.
//
//   POLL (charge) — the GPIO is switched to IN: no OUT drivers remain on the
//         net, so digitallyDriven is false and the ONLY forces are the weak
//         pulls (the capacitor's own) and the analog fraction from the
//         resistor/pot. Each tick the cap accumulates chargeElapsedSeconds
//         until it crosses thresholdSeconds = maxChargeSeconds * fraction, then
//         flips its pull to UP. The net then resolves HIGH through the pull,
//         and the GPIO (in poll/read mode) sees the LOW->HIGH transition it has
//         been waiting for — a timing readout.
//
// The capacitor writes pin("a").pull on EVERY update tick (it is the sole
// owner of that pull), and pull = charged ? "UP" : "DOWN" in the poll phase.
export class Capacitor extends Component {
  static readonly DEFAULT_MAX_CHARGE_SECONDS = 2;

  readonly maxChargeSeconds: number;
  private chargeElapsedSeconds = 0;
  private charged = false;

  constructor(options: CapacitorOptions = {}, id?: string) {
    super(id ?? `capacitor-${newId()}`);
    this.maxChargeSeconds =
      options.maxChargeSeconds ?? Capacitor.DEFAULT_MAX_CHARGE_SECONDS;
    this.addPin("a", "IN"); // sole active pin — listens + owns the pull
    this.addPin("b", "UNSET"); // ground lead (wiring realism only)
  }

  update(dt: number): void {
    const a = this.pin("a");

    // Discharge/forced-adopt phase: a real OUT driver owns the net.
    if (a.digitallyDriven) {
      if (a.value === "HIGH") {
        this.charged = true;
        this.chargeElapsedSeconds = this.maxChargeSeconds;
        a.pull = "UP";
      } else {
        this.charged = false;
        this.chargeElapsedSeconds = 0;
        a.pull = "DOWN";
      }
      return;
    }

    // Poll phase: no drivers — the cap charges through the resistor/pot's
    // analog fraction and drives the net with its own pull when done.
    const resistanceFraction = a.analogValue ?? 0;
    const thresholdSeconds = this.maxChargeSeconds * resistanceFraction;

    if (this.charged) {
      a.pull = "UP"; // hold charged state; keep the pull owner in sync
      return;
    }

    this.chargeElapsedSeconds += dt;
    if (this.chargeElapsedSeconds >= thresholdSeconds) {
      this.charged = true;
      this.chargeElapsedSeconds = thresholdSeconds;
      a.pull = "UP";
    } else {
      a.pull = "DOWN";
    }
  }

  getRenderInfo(): RenderInfo {
    const chargeFraction =
      this.maxChargeSeconds > 0
        ? Math.min(1, Math.max(0, this.chargeElapsedSeconds / this.maxChargeSeconds))
        : this.charged
          ? 1
          : 0;
    return { type: "capacitor", chargeFraction, charged: this.charged };
  }
}