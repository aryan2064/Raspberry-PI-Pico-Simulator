// Headless-browser integration verification of the whole Pyodide-worker flow —
// the checks that jsdom cannot do (real Web Worker + Pyodide + real React +
// the @wokwi/elements web components, which need a real Shadow DOM).
//
//   Usage:  node scripts/browser-verify.mjs <url> [edgePath]
//
// Requires Microsoft Edge (default path below) and Node >= 22 (global WebSocket).
// Drives the page over the Chrome DevTools Protocol:
//   1. Canvas renders board/LEDs/button + all six demo wires on load.
//   2. Press/release of the button lights LED1 via worker relay.
//   3. Run executes the default script -> LED2 visibly blinks then stays on.
//   4. Run a while True loop, Stop it -> wiring reappears, button still works.
//   5. Palette: drop a new LED (wire-w7), wire it, drag it, Stop -> the placed
//      part and its wire survive the worker replay at the dragged position.
//   6. Delete: select -> Delete button / Delete key / editor-focus guard /
//      Board exemption; deleted parts never reappear after Stop.
//   7. Conflict: wiring 3V3_OUT <-> GND (wire-w10) flags every wire on the merged
//      net red/dashed + a conflict banner; unwiring clears both.
//   8. Non-blocking sleep (JSPI): during a time.sleep() blink script the button
//      relay still lights LED1 promptly (worker event loop free mid-sleep) and
//      the script still completes.
//   9. Relay + Transistor: drop both -> every pin marker is re-derived from the
//      SERVED Fritzing asset's own <rect id="connectorNpin"> tabs (mapped through
//      that file's viewBox) and asserted sub-pixel, since these two are static
//      SVG assets with no element pinInfo to diff against -> then the switching
//      demo: in HIGH closes com/no, base HIGH conducts collector->emitter.
//  10. StepperMotor: a script drives GPIO4..7 (in1..in4) 8 half-step cycles
//      forward then 8 back (single-bit writes), lands on the exact expected
//      angle/direction, the vendored app-stepper-motor's shadow-DOM arrow
//      sweeps with data-angle, and all six canvas pin markers sit on the
//      element's own pinInfo coordinates (in1..in4, vcc, gnd) sub-pixel.
//  11. No custom-element registration collision: after a reload armed with an
//      error capture, both the package's wokwi-stepper-motor and the vendored
//      app-stepper-motor register and no customElements.define error is thrown.
//  14. UltrasonicSensor: drop -> sub-pixel pins vs the published wokwi-hc-sr04's
//      own pinInfo -> wire vcc/trig/echo/gnd -> slider drags relay 300cm and
//      360cm distance stimuli that REAL Python times to exactly distance*58us
//      via the micros()/tickUs bridge -> the "no object" stop produces NO echo.
import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const EDGE =
  process.argv[3] ?? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.argv[2] ?? "http://localhost:5228/";
const PORT = 9229;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
// The vendored app-stepper-motor shadow-DOM transform is "rotate(<angle>, x,y)
// ..."; extract just the leading signed angle.
const parseRotate = (transform) =>
  parseFloat(/rotate\((-?[0-9.]+)/.exec(transform ?? "")?.[1] ?? "NaN");

// Stepper pin anchors: mirror of StepperMotorView's stepperPinOffsets, derived
// from the vendored element's modified geometry (size 8, six 2.54 mm-pitch
// leads centered on the bottom face). Compared against the element's live
// pinInfo in step 10.
const EXPECTED_STEPPER_OFFSETS = {
  in1: { x: 15.553, y: 96.012 },
  in2: { x: 25.1542, y: 96.012 },
  in3: { x: 34.7554, y: 96.012 },
  in4: { x: 44.3566, y: 96.012 },
  vcc: { x: 53.9578, y: 96.012 },
  gnd: { x: 63.559, y: 96.012 },
};

// PIR pin anchors: mirror of PIRSensorView's pirPinOffsets, straight from the
// vendored element's own pinInfo (UBS-7 did a U-turn at the lens: pin order
// vcc/out/gnd along one common lead row at y=92). Module order matches the
// physical HC-SR501: VCC on the left, OUT center, GND right.
const EXPECTED_PIR_OFFSETS = {
  vcc: { x: 36.178, y: 92 },
  out: { x: 45.9175, y: 92 },
  gnd: { x: 55.6415, y: 92 },
};

// Potentiometer pin anchors: mirror of PotentiometerView's potPinOffsets,
// straight from the vendored app-potentiometer's own pinInfo — leads on the
// bottom face at y=68.5, GND(left; engine terminal1) / SIG(center; wiper) /
// VCC(right; terminal2). Compared against the element's live pinInfo + the
// canvas markers in step 13.
const EXPECTED_POT_OFFSETS = {
  terminal1: { x: 29, y: 68.5 },
  wiper: { x: 39, y: 68.5 },
  terminal2: { x: 49, y: 68.5 },
};

// Resistor pin anchors: mirror of ResistorView's resistorPinOffsets. The
// published wokwi-resistor names its leads '1'/'2' (terminal1 left, terminal2
// right) — same coordinates we mirror, so the live pinInfo '1'/'2' must equal
// terminal1/terminal2.
const EXPECTED_RES_OFFSETS = {
  terminal1: { x: 0, y: 5.65 },
  terminal2: { x: 58.8, y: 5.65 },
};

// Capacitor pin anchors: mirror of CapacitorView's capacitorPinOffsets. The
// capacitor is hand-drawn (no element pinInfo to diff against), so these come
// from the art's own geometry at the shared Wokwi scale: the whole 48x64
// drawing scales by k = 37.8/42 = 0.9 so the Ø10mm can lands at 10mm, moving
// `a` (left leg) to (12.6, 57.6) and `b` (right/ground leg) to (30.6, 57.6).
const EXPECTED_CAP_OFFSETS = {
  a: { x: 12.6, y: 57.6 },
  b: { x: 30.6, y: 57.6 },
};

// Ultrasonic pin anchors: mirror of UltrasonicSensorView's ultrasonicPinOffsets,
// straight from the published wokwi-hc-sr04's own pinInfo — the four header
// pins VCC-TRIG-ECHO-GND along the bottom face at y=94.5 on the 170.1x94.5 art.
const EXPECTED_ULTRA_OFFSETS = {
  vcc: { x: 71.3, y: 94.5 },
  trig: { x: 81.3, y: 94.5 },
  echo: { x: 91.3, y: 94.5 },
  gnd: { x: 101.3, y: 94.5 },
};

// Relay pin anchors: mirror of RelayView's relayPinOffsets, derived from the
// shipped DFRobot 3V Relay Module (DFR0473) drawing — an external art with NO
// connectorNpin markup, so the offsets are area-weighted pixel centroids of the
// module's own drawn connection metal, measured by probing the served asset
// (scripts/probe-dfrobot-centroids.mjs; method recorded in docs/DECISIONS.md):
//   - the 3 header pads of the "Gravity 3P Interface" (right) -> in, vcc, gnd
//   - the 4 screw eyes of the wiring terminal block (left) -> com, no, nc (N/A
//     is literally silk-screened "N/A" and has no engine pin)
//   - asset viewBox "211 566 124 106.5" cropped to the board, scaled to the
//     real 38mm board at the shared Wokwi scale (RELAY_SCALE = 143.64/124,
//     the same 3.78 px/mm every component now uses).
// verifyRelayPinsOnMetal below re-derives every anchor from the SERVED asset's
// own pixels with the same centroid procedure the measuring probe used, so the
// offset table is proven against the art itself — exactly the guarantee the old
// connectorNpin rects used to give.
const RELAY_SCALE = (38 * 3.78) / 124; // 1.158387... — 38mm board -> 143.64px at 3.78 px/mm
const RELAY_ANCHORS = {
  in: { x: 306.63, y: 626.688 }, // D header pad
  vcc: { x: 306.923, y: 618.791 }, // + header pad
  gnd: { x: 307.322, y: 611.203 }, // - header pad
  com: { x: 222.751, y: 636.986 }, // COM screw eye
  no: { x: 222.793, y: 615.392 }, // NO screw eye
  nc: { x: 222.768, y: 604.423 }, // NC screw eye
};
const RELAY_VB = { x: 211, y: 566, w: 124, h: 106.5 };
const EXPECTED_RELAY_OFFSETS = Object.fromEntries(
  Object.entries(RELAY_ANCHORS).map(([label, a]) => [
    label,
    { x: +((a.x - RELAY_VB.x) * RELAY_SCALE).toFixed(3), y: +((a.y - RELAY_VB.y) * RELAY_SCALE).toFixed(3) },
  ])
);
const RELAY_ASSET = { file: "dfrobot-3v-relay-module.svg", width: 38 * 3.78, height: 106.5 * RELAY_SCALE };

// Transistor pin anchors: mirror of TransistorView's transistorPinOffsets,
// derived from the shipped Fritzing TO-92 part's own connection markup in
// src/ui/assets/transistor-to92-npn.svg (viewBox "0 0 16.527 24.081", scaled to
// the part's real 5.83mm width at the shared Wokwi scale — TRANSISTOR_SCALE =
// 22.037/16.527). All three leads share y=30.11; left-to-right is
// collector / base / emitter, the BC547 reading the engine already used.
const EXPECTED_TRANSISTOR_OFFSETS = {
  collector: { x: 1.44, y: 30.11 },
  base: { x: 11.015, y: 30.11 },
  emitter: { x: 20.597, y: 30.11 },
};
const TRANSISTOR_CONNECTOR_IDS = {
  collector: "connector0pin",
  base: "connector1pin",
  emitter: "connector2pin",
};
const TRANSISTOR_ASSET = { file: "transistor-to92-npn.svg", width: 5.83 * 3.78, height: 24.081 * (5.83 * 3.78) / 16.527 };

// Sub-pixel pin alignment for the two static-asset components. Relay and
// Transistor have no custom element and therefore no live `pinInfo`, so instead
// of diffing against a mirror we read the part's OWN connector markup out of
// the asset file the page actually serves, compute where each tab centre must
// land, and require the canvas marker to be there. That catches a stale asset,
// a wrong viewBox scale, and an eyeballed offset in one assertion. `evaljs` is
// passed in because it is scoped to the CDP client block.
async function verifyAssetPinAlignment(name, placedId, expected, connectorIds, asset, evaljs) {
  const labels = Object.keys(expected);
  const probe = await evaljs(`(()=>{
    const stage = document.querySelector('[data-testid="circuit-stage"]');
    const sr = stage.getBoundingClientRect();
    const scale = sr.width / 4000;
    const body = document.querySelector('[data-testid="body-placed-${placedId}"]');
    const br = body.getBoundingClientRect();
    const img = body.querySelector('image');
    const pins = {};
    for (const label of ${JSON.stringify(labels)}) {
      const c = document.querySelector('[data-testid="pin-placed-${placedId}-' + label + '"] circle');
      if (!c) { pins[label] = null; continue; }
      const m = c.getBoundingClientRect();
      pins[label] = {
        x: (m.left + m.width / 2 - br.left) / scale,
        y: (m.top + m.height / 2 - br.top) / scale,
      };
    }
    return {
      href: img?.getAttribute('href') ?? null,
      imgW: Number(img?.getAttribute('width')),
      imgH: Number(img?.getAttribute('height')),
      pins,
    };
  })()`);

  assert(probe.href && probe.href.includes(asset.file), `${name} body must render ${asset.file}, got ${probe.href}`);
  const assetText = await (await fetch(new URL(probe.href, BASE))).text();
  const vb = /viewBox="([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)"/.exec(assetText);
  assert(!!vb, `${name} asset must carry a viewBox`);
  const vbX = Number(vb[1]);
  const vbY = Number(vb[2]);
  const vbW = Number(vb[3]);
  const vbH = Number(vb[4]);
  assert(
    Math.abs(probe.imgW - vbW) < 1e-9 && Math.abs(probe.imgH - vbH) < 1e-9,
    `${name} <image> must span the asset viewBox ${vbW}x${vbH}, got ${probe.imgW}x${probe.imgH}`
  );

  const rects = {};
  for (const m of assetText.matchAll(/<rect id="(connector\d+pin)"[^>]*>/g)) {
    const tag = m[0];
    const num = (n) => Number(new RegExp(`${n}="([-\\d.]+)"`).exec(tag)[1]);
    rects[m[1]] = { x: num("x"), y: num("y"), w: num("width"), h: num("height") };
  }

  const scale = asset.width / vbW;
  const aligns = [];
  for (const label of labels) {
    const rect = rects[connectorIds[label]];
    assert(!!rect, `${name} asset must define ${connectorIds[label]} for label ${label}`);
    const fromAsset = {
      x: +(((rect.x + rect.w / 2 - vbX) * scale).toFixed(3)),
      y: +(((rect.y + rect.h / 2 - vbY) * scale).toFixed(3)),
    };
    const mirrored = expected[label];
    assert(
      Math.abs(fromAsset.x - mirrored.x) < 0.01 && Math.abs(fromAsset.y - mirrored.y) < 0.01,
      `${name} ${label} offset table must match the asset's own tab centre, want ${JSON.stringify(
        mirrored
      )} got ${JSON.stringify(fromAsset)}`
    );
    const got = probe.pins[label];
    assert(!!got, `${name} must render a ${label} pin marker`);
    aligns.push({ label, ...fromAsset, got, dx: got.x - fromAsset.x, dy: got.y - fromAsset.y });
  }
  console.log(`${name} asset pin geometry:`, JSON.stringify({ asset, aligns }));
  for (const a of aligns) {
    assert(
      Math.abs(a.dx) < 1 && Math.abs(a.dy) < 1,
      `${name} pin ${a.label} must align sub-pixel on its own connector tab (${a.x}, ${a.y}), got dx=${a.dx.toFixed(
        3
      )} dy=${a.dy.toFixed(3)}`
    );
  }
}

// Relay-specific alignment: the DFRobot module art has no connectorNpin markup,
// so instead of reading rects we prove each anchor against the SERVED asset's
// own pixels, rasterized exactly the way RelayView draws it (the image fills the
// board-cropping viewBox "211 566 124 106.5"). Around every anchor we sample a
// 3x3 window (0.25 user-unit steps) and require most pixels to be DRAWN MODULE
// ART — pad/screw metal, pin hole, or body — not the white page, the green PCB,
// or the pale cream silkscreen background. Then the DOM marker must land
// sub-pixel on the probe-measured anchor. `evaljs` is scoped to the CDP client
// block.
async function verifyRelayPinsOnMetal(placedId, expected, anchors, vb, scale, evaljs) {
  const labels = Object.keys(expected);
  const anchorSrc = JSON.stringify(anchors);
  const res = await evaljs(`(async()=>{
    const stage = document.querySelector('[data-testid="circuit-stage"]');
    const sr = stage.getBoundingClientRect();
    const scalePx = sr.width / 4000;
    const body = document.querySelector('[data-testid="body-placed-${placedId}"]');
    const br = body.getBoundingClientRect();
    const img = body.querySelector('image');
    const href = img?.getAttribute('href') ?? null;
    const vbRect = { x: ${vb.x}, y: ${vb.y}, w: ${vb.w}, h: ${vb.h} };
    const S = 8; // fine sampling so a 0.25-unit window is a clean 3x3
    const c = document.createElement('canvas');
    c.width = Math.round(vbRect.w * S); c.height = Math.round(vbRect.h * S);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    const im = new Image();
    let ok = false;
    try { await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = href; }); ok = true; } catch {}
    if (!ok) return { href, rasterized: false };
    g.drawImage(im, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const at = (ux, uy) => {
      const i = (Math.round((uy - vbRect.y) * S) * c.width + Math.round((ux - vbRect.x) * S)) * 4;
      return [d[i], d[i + 1], d[i + 2]];
    };
    // Background = white page / pale cream silkscreen / green PCB. Anything else
    // (flat-grey pad, dark screw, copper eye, pin hole, body) is drawn art.
    // The module's pads are flat neutral grey (~236,236,236) and must NOT be
    // mistaken for the bright page/cream, which carry red>blue spread.
    const isBackground = (r, gg, b) =>
      (r >= 250 && gg >= 250 && b >= 250) || // white page
      (r >= 245 && gg >= 235 && b >= 180 && r - b >= 30) || // cream silkscreen
      (gg >= 120 && gg >= r + 25 && gg >= b + 25); // PCB green
    const art = {};
    for (const [label, a] of Object.entries(${anchorSrc})) {
      let drawn = 0, hits = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const [r, gg, b] = at(a.x + dx * 0.25, a.y + dy * 0.25);
          hits++; if (!isBackground(r, gg, b)) drawn++;
        }
      }
      art[label] = { center: at(a.x, a.y), drawn };
    }
    const pins = {};
    for (const label of ${JSON.stringify(labels)}) {
      const el = document.querySelector('[data-testid="pin-placed-${placedId}-' + label + '"] circle');
      const m = el?.getBoundingClientRect();
      pins[label] = el && m ? { x: (m.left + m.width / 2 - br.left) / scalePx, y: (m.top + m.height / 2 - br.top) / scalePx } : null;
    }
    const imgW = Number(img?.getAttribute('width'));
    const imgH = Number(img?.getAttribute('height'));
    return { href, rasterized: ok, art, pins, imgW, imgH };
  })()`);

  assert(res.href && res.href.includes("dfrobot-3v-relay-module.svg"), `relay body must render the DFRobot module, got ${res.href}`);
  assert(res.rasterized, "relay asset must rasterize from the served href");
  assert(Math.abs(res.imgW - vb.w) < 1e-9 && Math.abs(res.imgH - vb.h) < 1e-9,
    `relay <image> must span the asset viewBox ${vb.w}x${vb.h}, got ${res.imgW}x${res.imgH}`);
  const aligns = [];
  for (const label of labels) {
    const art = res.art[label];
    assert(art.drawn >= 7,
      `relay anchor ${label} must sit on drawn module art in the served asset's own pixels, got ${art.drawn}/9 (center rgb(${art.center}))`);
    const expectedPx = {
      x: +((anchors[label].x - vb.x) * scale).toFixed(3),
      y: +((anchors[label].y - vb.y) * scale).toFixed(3),
    };
    const mirrored = expected[label];
    assert(
      Math.abs(expectedPx.x - mirrored.x) < 0.01 && Math.abs(expectedPx.y - mirrored.y) < 0.01,
      `relay ${label} offset table must match the measured anchor, want ${JSON.stringify(mirrored)} got ${JSON.stringify(expectedPx)}`
    );
    const marker = res.pins[label];
    assert(!!marker, `relay must render a ${label} pin marker`);
    aligns.push({ label, ...expectedPx, got: marker, dx: marker.x - expectedPx.x, dy: marker.y - expectedPx.y, art: art.drawn });
  }
  console.log("relay asset pin geometry (pixel-proven on the served asset's own drawn art):",
    JSON.stringify({ asset: RELAY_ASSET, aligns }));
  for (const a of aligns) {
    assert(
      Math.abs(a.dx) < 1 && Math.abs(a.dy) < 1,
      `relay pin ${a.label} must align sub-pixel on its drawn pad/screw (${a.x}, ${a.y}), got dx=${a.dx.toFixed(3)} dy=${a.dy.toFixed(3)}`
    );
  }
}

const profile = join(process.env.TEMP ?? ".", "opencode", `edge-cdp-${Date.now()}`);
mkdirSync(profile, { recursive: true });

const edge = spawn(
  EDGE,
  [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--disable-default-apps",
    `--user-data-dir=${profile}`,
    `--remote-debugging-port=${PORT}`,
    BASE,
  ],
  { stdio: "ignore" }
);

let ws;
try {
  let targets;
  for (let i = 0; i < 60; i++) {
    try {
      targets = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json());
      break;
    } catch {
      await sleep(500);
    }
  }
  const page = targets?.find((t) => t.type === "page" && t.url.includes("localhost"));
  if (!page) throw new Error("no page target: " + JSON.stringify(targets?.map((t) => t.url)));

  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });

  let msgId = 0;
  const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => {
      const id = ++msgId;
      pending.set(id, res);
      ws.send(JSON.stringify({ id, method, params }));
    });
  const evaljs = async (expression) => {
    const r = await send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    const err = r.result?.exceptionDetails;
    if (err) throw new Error("eval failed: " + JSON.stringify(err));
    return r.result?.result?.value;
  };

  await send("Page.enable");
  await sleep(1500);

const state = () =>
  evaljs(`(async()=>{
      const q = (s) => document.querySelector(s);
      const qa = (s) => [...document.querySelectorAll(s)];
      const posOf = (id) => {
        const el = q('[data-testid="'+id+'"]');
        if (!el) return null;
        return { x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
      };
      return {
        wires: qa('[data-testid^="wire-"]').map((el) => el.getAttribute('data-testid')).sort(),
        boards: qa('[data-testid="pico-board"]').length,
        leds: qa('[data-testid="led-body"]').map((el) => el.getAttribute('data-on')),
        pressed: q('[data-testid="button-body"]')?.getAttribute('data-pressed') ?? null,
        pins: qa('[data-testid^="pin-"]').length,
        issue: q('[data-testid="worker-issue"]')?.textContent ?? null,
        paletteItems: qa('[data-testid^="palette-"]').map((el) => el.getAttribute('data-testid')).sort(),
        placedLed: posOf('body-placed-1'),
        placed2: posOf('body-placed-2'),
        placed3: posOf('body-placed-3'),
        placedRelay: posOf('body-placed-4'),
        placedTransistor: posOf('body-placed-5'),
        placedLed6: posOf('body-placed-6'),
        placedLed7: posOf('body-placed-7'),
        placedStepper: posOf('body-placed-8'),
        relayEnergized: q('[data-testid="relay-body"]')?.getAttribute('data-energized') ?? null,
        transistorConducting: q('[data-testid="transistor-body"]')?.getAttribute('data-conducting') ?? null,
        placed6On: (() => { const el = q('[data-testid="body-placed-6"] [data-testid="led-body"]'); return el?.getAttribute('data-on') ?? null; })(),
        placed7On: (() => { const el = q('[data-testid="body-placed-7"] [data-testid="led-body"]'); return el?.getAttribute('data-on') ?? null; })(),
        stepperAngle: q('[data-testid="stepper-body"]')?.getAttribute('data-angle') ?? null,
        stepperDirection: q('[data-testid="stepper-body"]')?.getAttribute('data-direction') ?? null,
        stepperStepsPerSecond: q('[data-testid="stepper-body"]')?.getAttribute('data-steps-per-second') ?? null,
        pirMotion: q('[data-testid="pir-body"]')?.getAttribute('data-motion-active') ?? null,
        potKnob: q('[data-testid="potentiometer"]')?.getAttribute('data-knob-position') ?? null,
        resistorOhms: q('[data-testid="resistor"]')?.getAttribute('data-resistance-ohms') ?? null,
        capCharged: q('[data-testid="capacitor"]')?.getAttribute('data-charged') ?? null,
        placedUltrasonic: posOf('body-placed-5'),
        ultrasonicReadout: q('[data-testid="ultrasonic-readout"]')?.textContent ?? null,
        ultrasonicDistance: q('[data-testid="ultrasonic"]')?.getAttribute('data-distance') ?? null,
        stepperRotate: (() => {
          const el = q('[data-testid="stepper-body"] app-stepper-motor');
          const p = el?.shadowRoot?.querySelector('#arrow-path');
          return p?.getAttribute('transform') ?? null;
        })(),
        placedBodies: qa('[data-testid^="body-placed-"]').length,
        deleteButton: q('[data-testid="delete-component"]')?.textContent ?? null,
        wire7: (() => {
          const g = q('[data-testid="wire-w7"]');
          if (!g) return null;
          const l = g.querySelectorAll('line')[1] ?? g.querySelector('line');
          return l ? { x1: +l.getAttribute('x1'), y1: +l.getAttribute('y1'), x2: +l.getAttribute('x2'), y2: +l.getAttribute('y2') } : null;
        })(),
        conflictBanner: q('[data-testid="conflict-banner"]')?.textContent ?? null,
        conflictedWires: qa('[data-testid^="wire-"][data-conflicted="true"]')
          .map((el) => el.getAttribute('data-testid')).sort(),
        output: q('[data-testid="output"]')?.textContent ?? null,
      };
    })()`);

  // ---- 1. Canvas renders the demo layout on load (before running any code) ----
  let s;
  for (let i = 0; i < 60 && !s?.boards; i++) {
    s = await state();
    if (!s.boards) await sleep(500);
  }
  console.log("step1 initial:", JSON.stringify(s));
  assert(s.boards === 1, "pico board did not render");
  assert(s.leds.length === 2, "expected two LEDs");
  assert(s.pressed === "false", "button should start unpressed");
  assert(s.pins >= 40, "pins should render");
  assert(
    s.wires.join(",") === ["wire-w1", "wire-w2", "wire-w3", "wire-w4", "wire-w5", "wire-w6"].join(","),
    "expected demo wires wire-w1..wire-w6, got " + s.wires
  );
  assert(!s.issue, "unexpected worker issue banner: " + s.issue);

  // ---- 1b. Pin markers sit exactly on their artwork. The stage, wires and
  //         pins are all scaled by the same CSS transform (coordinates stay
  //         in stage units), so a marker's rendered center must map back to
  //         body origin + the element-source pin offset. The stage is
  //         4000x2800 inside a pannable/zoomable viewport; every probe below
  //         converts through the stage's LIVE rect (sr.width/4000 IS the
  //         zoom), so the same math is exact at any pan/zoom. This step
  //         asserts the default 100%/origin state and all calibrated pin
  //         placement. Also proves the vendored web components upgraded with
  //         real shadow-DOM artwork (not bare tags).
  const geo = await evaljs(`(()=>{
    const stage = document.querySelector('[data-testid="circuit-stage"]');
    const container = document.querySelector('[data-testid="circuit-canvas"]');
    const sr = stage.getBoundingClientRect();
    const scale = sr.width / 4000;
    const bodyOrigin = (id) => {
      const r = document.querySelector('[data-testid="body-'+id+'"]').getBoundingClientRect();
      return { x: (r.left - sr.left) / scale, y: (r.top - sr.top) / scale };
    };
    const check = (id, pin, expX, expY) => {
      const c = document.querySelector('[data-testid="pin-'+id+'-'+pin+'"] circle').getBoundingClientRect();
      const o = bodyOrigin(id);
      const got = { x: (c.left + c.width / 2 - sr.left) / scale, y: (c.top + c.height / 2 - sr.top) / scale };
      return { pin, got, want: { x: o.x + expX, y: o.y + expY }, dx: got.x - (o.x + expX), dy: got.y - (o.y + expY) };
    };
    const shadowSvg = (bodyId, tag) => {
      const el = document.querySelector('[data-testid="' + bodyId + '"] ' + tag);
      const svg = el?.shadowRoot?.querySelector('svg');
      if (!svg) return null;
      const r = svg.getBoundingClientRect();
      return { w: +(r.width / scale).toFixed(2), h: +(r.height / scale).toFixed(2) };
    };
    return {
      scale,
      zoomAttr: Number(container.getAttribute('data-zoom')),
      panX: Number(container.getAttribute('data-pan-x')),
      panY: Number(container.getAttribute('data-pan-y')),
      ledSvg: shadowSvg('body-led', 'wokwi-led'),
      buttonSvg: shadowSvg('body-button', 'wokwi-pushbutton'),
      checks: [
        check('led', 'anode', 25, 42),
        check('led', 'cathode', 15, 42),
        check('button', 'leg1a', 0, 13),
        check('button', 'leg1b', 67, 13),
        check('button', 'leg2a', 0, 32),
        check('button', 'leg2b', 67, 32),
        // Board pins map through the calibrated 3.78 px/mm scale (0.096012 px
        // per Fritzing unit — the same 2.54mm pad pitch the Wokwi parts use).
        check('board', 'GPIO0', 12.728, 6.091),
        check('board', 'GPIO15', 195.156, 6.049),
        check('board', 'GPIO16', 12.734, 73.257),
        check('board', 'GPIO28', 137.549, 73.257),
        check('board', '3V3_OUT', 156.752, 73.257),
        check('board', 'GND', 31.936, 73.257),
        check('board', 'GPIO17', 22.335, 73.257),
      ],
    };
  })()`);
  console.log("step1b pin geometry:", JSON.stringify(geo));
  assert(
    Math.abs(geo.scale - 1) < 0.001,
    "the canvas should start at 100% zoom (the calibrated real-size scale, 3.78 px/mm), got scale=" + geo.scale
  );
  assert(
    geo.zoomAttr === 1 && geo.panX === 0 && geo.panY === 0,
    "data-zoom/data-pan-x/data-pan-y should read 1/0/0 on load, got " +
      JSON.stringify({ zoom: geo.zoomAttr, panX: geo.panX, panY: geo.panY })
  );
  assert(
    geo.ledSvg && Math.abs(geo.ledSvg.w - 40) < 2 && Math.abs(geo.ledSvg.h - 50) < 2,
    "wokwi-led must upgrade with its 40x50 shadow svg, got " + JSON.stringify(geo.ledSvg)
  );
  assert(
    geo.buttonSvg && Math.abs(geo.buttonSvg.w - 67.28) < 3 && Math.abs(geo.buttonSvg.h - 45.35) < 3,
    "wokwi-pushbutton must upgrade with its ~67.28x45.35 shadow svg, got " + JSON.stringify(geo.buttonSvg)
  );
  for (const c of geo.checks) {
    assert(
      Math.abs(c.dx) < 3 && Math.abs(c.dy) < 3,
      "pin " + c.pin + " must sit on its artwork at (" + c.want.x.toFixed(1) + "," + c.want.y.toFixed(1) +
        "), got (" + c.got.x.toFixed(1) + "," + c.got.y.toFixed(1) + ")"
    );
  }

  // ---- 2. Button press/release drives LED1 through the worker. The worker
  //         warm-loads Pyodide on boot; its WASM init blocks the worker thread
  //         for a moment, during which messages just queue, so poll until each
  //         state settles instead of assuming a fixed latency.
  await evaljs(
    `(()=>{ document.querySelector('[data-testid="button-body"]')
       .dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); return true; })()`
  );
  const waitFor = async (label, pred, timeoutMs = 15000) => {
    const start = Date.now();
    let st;
    while (Date.now() - start < timeoutMs) {
      st = await state();
      if (pred(st)) return st;
      await sleep(150);
    }
    throw new Error(`${label} not satisfied; last state: ` + JSON.stringify(st));
  };
  s = await waitFor("press should light LED1", (x) => x.leds[0] === "true" && x.pressed === "true");
  console.log("step2 pressed OK:", JSON.stringify(s));
  // The vendored (decorator-free) LEDElement must genuinely re-render in the
  // shadow DOM when `.value` flips — the `.light` glow group shows, then hides.
  const glowOn = await evaljs(`(()=>{
    const el = document.querySelector('[data-testid="body-led"] wokwi-led');
    const g = el?.shadowRoot?.querySelector('.light');
    return g ? (g.getAttribute('style') || '') : null;
  })()`);
  assert(
    glowOn !== null && !glowOn.includes('none'),
    "LED shadow glow must be visible while on, got " + JSON.stringify(glowOn)
  );

  await evaljs(
    `(()=>{ document.querySelector('[data-testid="button-body"]')
       .dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); return true; })()`
  );
  s = await waitFor(
    "release should turn LED1 off",
    (x) => x.leds[0] === "false" && x.pressed === "false"
  );
  console.log("step2 released OK:", JSON.stringify(s));
  const glowOff = await evaljs(`(()=>{
    const el = document.querySelector('[data-testid="body-led"] wokwi-led');
    const g = el?.shadowRoot?.querySelector('.light');
    return g ? (g.getAttribute('style') || '') : null;
  })()`);
  assert(
    glowOff !== null && glowOff.includes('none'),
    "LED shadow glow must hide when off, got " + JSON.stringify(glowOff)
  );

  // ---- 3. Run the default script: LED2 blinks (0.5s) then stays on ----
  // This is the very first Python run in the freshly booted worker. Pyodide's
  // WASM/stdlib are fetched from the CDN at worker start and that load can be
  // slow, so first confirm Python actually executes by running a one-line
  // probe and waiting for its print in the Output panel (which also proves
  // the stdout bridge end-to-end). Then restore the editor to the default
  // blink script and observe LED2 as expected.
  const defaultScript =
    'import machine\nimport time\n\nled = machine.Pin(16, machine.Pin.OUT)\nfor _ in range(5):\n    led.value(1)\n    time.sleep(0.5)\n    led.value(0)\n    time.sleep(0.5)\nled.value(1)\n';
  const clickRun = () =>
    evaljs(
      `(()=>{ [...document.querySelectorAll('button')]
         .find((x)=>x.textContent.trim()==='Run').click(); return true; })()`
    );
  const setEditor = async (code) => {
    await evaljs(`(()=>{
      const ta = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
      setter.call(ta, ${JSON.stringify(code)});
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      return true;
    })()`);
  };
  let probeSeq = 0;
  // Every fresh worker must warm Pyodide AND have the machine shim installed
  // before a dependent script is safe — a cold first run has flaked with
  // ModuleNotFoundError: machine. warmProbe runs a one-line import probe and
  // waits for its print in the Output panel (unique marker each call, because
  // output accumulates), which deterministically absorbs the CDN/WASM load.
  const warmProbe = async (label, timeoutMs = 90000) => {
    probeSeq += 1;
    const marker = `PRB-${probeSeq}-OK`;
    await setEditor(`import machine  # probe ${probeSeq}\nprint('${marker}:' + str(hasattr(machine, 'Pin')))\n`);
    assert(
      (await evaljs(`(()=> document.querySelector('textarea').value)()`)).includes(marker),
      "editor did not take the warm-up probe"
    );
    await clickRun();
    return waitFor(label, (x) => x.output?.includes(marker), timeoutMs);
  };
  const taVal0 = await evaljs(`(()=> document.querySelector('textarea').value)()`);
  assert(
    taVal0.includes("GPIO16") && taVal0.includes("import machine"),
    "page should load with the demo blink script in the editor"
  );
  s = await warmProbe("warm-up probe should print (Pyodide + machine ready)");
  console.log("step3 warmed (Pyodide + shim ready):", JSON.stringify(s));
  await setEditor(defaultScript);
  await clickRun();
  let sawTrue = false;
  let sawFalse = false;
  let last = s;
  for (let i = 0; i < 140; i++) {
    await sleep(250);
    last = await state();
    if (last.leds[1] === "true") sawTrue = true;
    if (last.leds[1] === "false") sawFalse = true;
    if (i > 40 && sawTrue) break; // well past the 5s script; LED2 must end on
  }
  assert(sawTrue, "LED2 never lit during Run");
  assert(sawFalse, "LED2 never went low during the blink script");
  assert(last?.leds[1] === "true", "LED2 should stay on after the script, got " + last?.leds[1]);
  assert(!last.issue, "unexpected issue banner after Run: " + last.issue);
  console.log("step3 run-blink OK (sample state):", JSON.stringify(last));

  // ---- 4. Stop recovers from `while True` and wiring reappears ----
  await evaljs(`(()=>{
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
    setter.call(ta, 'while True:\\n    pass\\n');
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`);
  await evaljs(
    `(()=>{ [...document.querySelectorAll('button')]
       .find((x)=>x.textContent.trim()==='Run').click(); return true; })()`
  );
  await sleep(1200); // let the stuck loop take hold in the worker
  await evaljs(
    `(()=>{ [...document.querySelectorAll('button')]
       .find((x)=>x.textContent.trim()==='Stop').click(); return true; })()`
  );
  let recovered;
  // Wait until the fresh worker's snapshots replace the stale DOM: LED2 was
  // left on by the blink script, so it going off means the restarted engine
  // actually rebuilt and re-rendered the wiring.
  recovered = await waitFor(
    "Stop should restore a freshly rebuilt wiring with LED2 off",
    (x) => x.boards === 1 && x.wires.length === 6 && x.leds[1] === "false"
  );
  console.log("step4 after stop:", JSON.stringify(recovered));
  assert(!recovered.issue, "unexpected issue banner after Stop: " + recovered.issue);

  // The interactive demo still drives the worker after the restart.
  await evaljs(
    `(()=>{ document.querySelector('[data-testid="button-body"]')
       .dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); return true; })()`
  );
  recovered = await waitFor("button should still drive LED1 after Stop", (x) => x.leds[0] === "true");
  await evaljs(
    `(()=>{ document.querySelector('[data-testid="button-body"]')
       .dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); return true; })()`
  );
  // ---- 5. Palette placement: the part the user drags in behaves like any
  //         other component AND survives Stop like the demo wiring does.
  s = await state();
  assert(
    s.paletteItems.includes("palette-led") &&
      s.paletteItems.includes("palette-button") &&
      s.paletteItems.includes("palette-relay") &&
      s.paletteItems.includes("palette-transistor") &&
      s.paletteItems.includes("palette-stepper") &&
      s.paletteItems.includes("palette-pir") &&
      s.paletteItems.includes("palette-potentiometer") &&
      s.paletteItems.includes("palette-resistor") &&
      s.paletteItems.includes("palette-capacitor") &&
      s.paletteItems.includes("palette-ultrasonic"),
    "palette should list LED, Button, Relay, Transistor, Stepper, PIR, Potentiometer, Resistor, Capacitor, and Ultrasonic, got " + s.paletteItems
  );
  assert(
    !s.paletteItems.includes("palette-pico_board"),
    "palette must not offer a second board"
  );

  // Convert a desired stage point into client coords so the app's own
  // client->stage inverse maps the drop back to (900,200) at any canvas scale.
  await evaljs(`(()=>{
    const stage = document.querySelector('[data-testid="circuit-stage"]');
    const r = stage.getBoundingClientRect();
    const toClient = (x, y) => ({ x: r.left + x * (r.width / 4000), y: r.top + y * (r.height / 2800) });
    const dt = new DataTransfer();
    dt.setData('application/x-pico-component', 'led');
    const c = toClient(900, 200);
    document.querySelector('[data-testid="circuit-canvas"]')
      .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, dataTransfer: dt }));
    return true;
  })()`);
  s = await waitFor(
    "dropped palette LED should render as placed-1",
    (x) => x.placedLed !== null
  );
  console.log("step5 placed:", JSON.stringify(s));
  assert(
    s.placedLed &&
      Math.abs(s.placedLed.x - 900) < 5 &&
      Math.abs(s.placedLed.y - 200) < 5,
    "placed LED should land near the drop point, got " + JSON.stringify(s.placedLed)
  );

  // Wire the placed LED to a free board pin through the usual pin-click flow.
  // Each click must be its own task: React flushes the pending-pin state
  // between events (last state is read by the next click's handler).
  await evaljs(`(()=>{ const e = document.querySelector('[data-testid="pin-placed-1-anode"]'); e.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  await sleep(100);
  await evaljs(`(()=>{ const e = document.querySelector('[data-testid="pin-board-GPIO17"]'); e.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  s = await waitFor(
    "placed LED should be wired as wire-w7",
    (x) => x.wires.includes("wire-w7")
  );
  const wireBefore = s.wire7;
  assert(wireBefore, "wire-w7 should have renderable endpoints");

  // Drag the placed LED's body 150 stage-units right and down; the wire
  // endpoints must follow. The app converts each client delta back into stage
  // units through the stage rect, so the movement is exactly 150 stage units
  // regardless of the container-scale transform.
  const drag = await evaljs(`(()=>{
    const stage = document.querySelector('[data-testid="circuit-stage"]');
    const container = document.querySelector('[data-testid="circuit-canvas"]');
    const r = stage.getBoundingClientRect();
    const k = r.width / 4000;
    const toClient = (x, y) => ({ x: r.left + x * k, y: r.top + y * k });
    const a = toClient(900, 200);
    const b = toClient(1050, 350);
    const body = document.querySelector('[data-testid="body-placed-1"]');
    body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: a.x, clientY: a.y, button: 0, pointerId: 7, pointerType: 'mouse' }));
    container.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: b.x, clientY: b.y, pointerId: 7, button: 0 }));
    container.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, clientX: b.x, clientY: b.y, pointerId: 7, button: 0 }));
    return { dx: (b.x - a.x) / k, dy: (b.y - a.y) / k, k };
  })()`);
  s = await waitFor(
    "placed LED should end at the dragged position",
    (x) =>
      x.placedLed !== null &&
      Math.abs(x.placedLed.x - (900 + drag.dx)) < 3 &&
      Math.abs(x.placedLed.y - (200 + drag.dy)) < 3
  );
  console.log("step5 dragged:", JSON.stringify(s));
  assert(
    s.wire7 &&
      Math.abs(s.wire7.x1 - wireBefore.x1 - drag.dx) < 3 &&
      Math.abs(s.wire7.y1 - wireBefore.y1 - drag.dy) < 3,
    "wire-w7 endpoint should follow the dragged LED"
  );

  // Stop must replay the whole topology into a fresh worker — including the
  // placed LED and its wire — while the dragged position (UI state) persists.
  await evaljs(
    `(()=>{ [...document.querySelectorAll('button')]
       .find((x)=>x.textContent.trim()==='Stop').click(); return true; })()`
  );
  s = await waitFor(
    "placed LED + its wire should survive Stop",
    (x) =>
      x.boards === 1 &&
      x.wires.includes("wire-w7") &&
      x.wires.length >= 6 &&
      x.placedLed !== null &&
      Math.abs(x.placedLed.x - (900 + drag.dx)) < 3 &&
      Math.abs(x.placedLed.y - (200 + drag.dy)) < 3
  );
  console.log("step5 after stop:", JSON.stringify(s));
  assert(!s.issue, "unexpected issue banner after palette Stop: " + s.issue);

  // ---- 6. Delete: Delete button + Delete/Backspace key, board exemption,
  //         code-editor focus guard, and no reappearance after Stop ----

  // A plain click selects a component body (same coords on down/up -> the
  // 4px drag threshold is never crossed, so it's a selection, not a drag).
  const select = (bodyId) => evaljs(`(()=>{
    const svg = document.querySelector('[data-testid="circuit-canvas"]');
    const body = document.querySelector('[data-testid="${bodyId}"]');
    body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 100, clientY: 100, button: 0, pointerId: 7, pointerType: 'mouse' }));
    svg.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, clientX: 100, clientY: 100, button: 0, pointerId: 7, pointerType: 'mouse' }));
    return true;
  })()`);
  const clearSelection = () => evaljs(`(()=>{
    document.querySelector('[data-testid="circuit-canvas"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return true;
  })()`);

  // 6a — the board can be selected but never deleted via either trigger.
  await select('body-board');
  s = await state();
  assert(
    s.deleteButton === null,
    "board selection must NOT show a Delete button, got " + s.deleteButton
  );
  await evaljs(`(()=>{ window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); return true; })()`);
  await sleep(400);
  assert((await state()).boards === 1, "board must survive the Delete key");
  await clearSelection();

  // 6b — select placed-1, delete via the Delete button; its wire goes too.
  await select('body-placed-1');
  s = await waitFor(
    "selecting placed-1 should reveal the Delete button",
    (x) => x.deleteButton !== null
  );
  console.log("step6a board-delete-blocked + selection:", JSON.stringify(s));
  await evaljs(`(()=>{ document.querySelector('[data-testid="delete-component"]').click(); return true; })()`);
  s = await waitFor(
    "Delete button should remove placed-1 and wire-w6",
    (x) => x.placedLed === null && !x.wires.includes("wire-w7") && x.placedBodies === 0
  );
  assert(s.pins >= 40, "pins should drop back to the demo count after deletion, got " + s.pins);
  console.log("step6b deleted via button:", JSON.stringify(s));

  const dropLedAt = (stageX, stageY) => evaljs(`(()=>{
    const stage = document.querySelector('[data-testid="circuit-stage"]');
    const r = stage.getBoundingClientRect();
    const c = { x: r.left + ${stageX} * (r.width / 4000), y: r.top + ${stageY} * (r.height / 2800) };
    const dt = new DataTransfer();
    dt.setData('application/x-pico-component', 'led');
    document.querySelector('[data-testid="circuit-canvas"]')
      .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, dataTransfer: dt }));
    return true;
  })()`);

  // 6c — place a second LED, wire it, select it, delete via the Delete key.
  await dropLedAt(900, 200);
  s = await waitFor("second placed LED should render as placed-2", (x) => x.placed2 !== null);
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-placed-2-anode"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  await sleep(100);
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-board-GPIO18"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  s = await waitFor("placed-2 should be wired as wire-w8", (x) => x.wires.includes("wire-w8"));
  await select('body-placed-2');
  s = await waitFor("selecting placed-2 should reveal the Delete button", (x) => x.deleteButton !== null);
  await evaljs(`(()=>{ window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); return true; })()`);
  s = await waitFor(
    "Delete key should remove placed-2 and wire-w8",
    (x) => x.placed2 === null && !x.wires.includes("wire-w8")
  );
  console.log("step6c deleted via key:", JSON.stringify(s));

  // 6d — Backspace while the code editor has focus must NOT delete (the
  // selection and the component both survive); once focus leaves, it does.
  await dropLedAt(900, 200);
  s = await waitFor("third placed LED should render as placed-3", (x) => x.placed3 !== null);
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-placed-3-anode"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  await sleep(100);
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-board-GPIO19"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  s = await waitFor("placed-3 should be wired as wire-w9", (x) => x.wires.includes("wire-w9"));
  await select('body-placed-3');
  s = await waitFor("selecting placed-3 should reveal the Delete button", (x) => x.deleteButton !== null);
  await evaljs(`(()=>{
    document.querySelector('textarea').focus();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    return document.activeElement?.tagName ?? null;
  })()`);
  await sleep(400);
  s = await state();
  assert(s.placed3 !== null, "Backspace in the editor must NOT delete the selected component");
  assert(s.wires.includes("wire-w9"), "wire-w9 must survive editor Backspace");
  assert(s.deleteButton !== null, "selection must survive editor Backspace");
  await evaljs(`(()=>{ document.activeElement?.blur?.(); return true; })()`);
  await evaljs(`(()=>{ window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })); return true; })()`);
  s = await waitFor(
    "Backspace on the body should remove placed-3 and wire-w9",
    (x) => x.placed3 === null && !x.wires.includes("wire-w9")
  );
  console.log("step6d editor guard + backspace delete:", JSON.stringify(s));

  // 6e — nothing deleted comes back after Stop; the untouched demo wiring does.
  await evaljs(
    `(()=>{ [...document.querySelectorAll('button')]
       .find((x)=>x.textContent.trim()==='Stop').click(); return true; })()`
  );
  s = await waitFor(
    "deleted parts must not return after Stop",
    (x) =>
      x.boards === 1 &&
      x.wires.length === 6 &&
      x.wires.every((w) => w.includes("wire-w")) &&
      x.placedLed === null &&
      x.placed2 === null &&
      x.placed3 === null &&
      x.placedBodies === 0
  );
  console.log("step6e after stop (deleted stay gone):", JSON.stringify(s));
  assert(!s.issue, "unexpected issue banner after delete/Stop: " + s.issue);

  // step8 needs Python in the freshly respawned worker; warm it (and the
  // machine shim) deterministically now instead of racing the first real Run.
  s = await warmProbe("post-Stop worker should run Python with machine importable");
  console.log("post-stop worker warmed (Pyodide + shim ready):", JSON.stringify(s));

  // ---- 7. Conflict detection: two OUT pins wired together flag the affected
  //         wires (red, dashed) and show a warning banner; unwiring clears
//   both. board.3V3_OUT (OUT HIGH) <-> board.GND (OUT LOW) needs no Python
  //         to be a genuine two-driver short-circuit. The new short is w10:
  //         the six demo wires (w1-w6) plus w7/w8/w9 from steps 5/6 fill the
  //         earlier ids.
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-board-3V3_OUT"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  await sleep(100);
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-board-GND"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  s = await waitFor(
    "wiring 3V3_OUT to GND should flag conflicted wires and show the banner",
    (x) =>
      x.wires.includes("wire-w10") &&
      x.conflictBanner !== null &&
      x.conflictedWires.length > 0
  );
  // The short merges the 3V3_OUT net (w1, and the short w10) with the GND net
  // (w4, w6, and the short w10) — the button is unpressed, so its two strips
  // are not bridged (leg1b/leg2b carry no wires) and GPIO15's pull-down net
  // stays separate. Reporting order is graphic (top-to-bottom), not id order,
  // so compare as sets.
  assert(
    [...s.conflictedWires].sort().join(",") ===
      ["wire-w1", "wire-w4", "wire-w6", "wire-w10"].sort().join(","),
    "expected wires w1/w4/w6/w10 on the shorted net to be flagged, got " + s.conflictedWires
  );
  assert(
    s.conflictBanner.includes("4 wire conflicts"),
    "expected the banner to count 4 conflicted wires, got " + s.conflictBanner
  );
  console.log("step7 conflicted:", JSON.stringify(s));

  // The conflicted wire is visibly a warning (red + dashed), unlike normal wires.
  const w10Style = await evaljs(`(()=>{
    const g = document.querySelector('[data-testid="wire-w10"]');
    const l = g?.querySelectorAll('line')[1];
    return l ? { stroke: l.getAttribute('stroke'), dash: l.getAttribute('stroke-dasharray') } : null;
  })()`);
  assert(
    w10Style && w10Style.stroke === "#d81b1b" && w10Style.dash === "8 5",
    "conflicted wire should be red/dashed, got " + JSON.stringify(w10Style)
  );

  // Remove the short by clicking the conflicted wire: conflict resolves, the
  // banner disappears and every wire returns to its normal style.
  await evaljs(`(()=>{ document.querySelector('[data-testid="wire-w10"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  s = await waitFor(
    "removing the short should clear the banner and restore the wires",
    (x) => !x.wires.includes("wire-w10") && x.conflictBanner === null && x.conflictedWires.length === 0
  );
  console.log("step7 disconnect clears:", JSON.stringify(s));

  // ---- 8. Non-blocking sleep (JSPI): while a blink script is mid-time.sleep()
  //         the button relay still drives LED1 promptly — proof the worker's JS
  //         event loop is free during the sleep (pyodide.ffi.run_sync / stack
  //         switching) rather than a busy-wait holding the thread. Under the
  //         busy-wait fallback this press would not resolve until the ~5s
  //         script ends, blowing the <1500ms latency assertion below.
  await evaljs(`(()=>{
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
    setter.call(ta, 'import machine, time\\nprint("S8START")\\nled = machine.Pin(16, machine.Pin.OUT)\\nfor _ in range(5):\\n    led.value(1)\\n    time.sleep(0.5)\\n    led.value(0)\\n    time.sleep(0.5)\\nled.value(1)\\nprint("S8DONE")\\n');
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`);
  const taVal = await evaljs(`(()=> document.querySelector('textarea').value)()`);
  assert(taVal.includes("S8START"), "editor did not take the step8 script");
  await evaljs(
    `(()=>{ [...document.querySelectorAll('button')]
       .find((x)=>x.textContent.trim()==='Run').click(); return true; })()`
  );
  // This is the first Python run in a freshly respawned worker, so Pyodide's
  // WASM/stdlib are fetched from the CDN on demand and can be slow on a cold
  // connection. Gate on Python's own first print reaching the Output panel
  // (only emitted from inside the new script once Pyodide finished loading),
  // rather than on LED2's brief blink windows which the load could bleed past.
  s = await waitFor("step8 script should start (S8START printed)", (x) => x.output?.includes("S8START"), 90000);
  console.log("step8 script started:", JSON.stringify(s));
  s = await waitFor("blink script should light LED2", (x) => x.leds[1] === "true", 10000);
  await sleep(300); // land inside the first 0.5s time.sleep
  const pressT0 = Date.now();
  await evaljs(
    `(()=>{ document.querySelector('[data-testid="button-body"]')
       .dispatchEvent(new MouseEvent('mousedown',{bubbles:true})); return true; })()`
  );
  s = await waitFor("LED1 should light mid-sleep via the free worker loop", (x) => x.leds[0] === "true", 2000);
  const pressLatency = Date.now() - pressT0;
  console.log("step8 press-mid-sleep latency (ms):", pressLatency);
  assert(
    pressLatency < 1500,
    `LED1 only responded after ${pressLatency}ms — the sleep is blocking the worker (no JSPI path active)`
  );
  await evaljs(
    `(()=>{ document.querySelector('[data-testid="button-body"]')
       .dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); return true; })()`
  );
  s = await waitFor("release should turn LED1 off mid-script", (x) => x.leds[0] === "false", 2000);
  // The script itself must still complete normally: LED2 holds on for a
  // sustained stretch after its final led.value(1).
  let sustainedOn = 0;
  for (let i = 0; i < 25; i++) {
    await sleep(400);
    const st = await state();
    sustainedOn = st.leds[1] === "true" ? sustainedOn + 1 : 0;
    if (sustainedOn >= 4) break;
  }
  assert(sustainedOn >= 4, "LED2 should stay on after the blink script completes");
  s = await waitFor("blink script should finish (S8DONE printed)", (x) => x.output?.includes("S8DONE"), 10000);
  assert(!s.issue, "unexpected issue banner after step8: " + s.issue);
  console.log("step8 non-blocking sleep OK:", JSON.stringify(s));

  // ---- 9. Relay + Transistor end-to-end switching. A script drives two free
  //         GPIOs — GPIO12 -> relay.in and GPIO13 -> transistor.base. Both
  //         switches load the 3V3_OUT rail onto a freshly placed LED through
  //         their switched contacts (com/no for the relay, collector/emitter
  //         for the transistor), so the DOM must show the switch state
  //         attribute AND the LED body come/go with it.
  const dropKindAt = (kind, stageX, stageY) => evaljs(`(()=>{
    const stage = document.querySelector('[data-testid="circuit-stage"]');
    const r = stage.getBoundingClientRect();
    const c = { x: r.left + ${stageX} * (r.width / 4000), y: r.top + ${stageY} * (r.height / 2800) };
    const dt = new DataTransfer();
    dt.setData('application/x-pico-component', '${kind}');
    document.querySelector('[data-testid="circuit-canvas"]')
      .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, dataTransfer: dt }));
    return true;
  })()`);

  await dropKindAt('relay', 700, 300);
  s = await waitFor("dropped Relay should render as placed-4", (x) => x.placedRelay !== null);
  assert(s.relayEnergized === "false", "relay should start de-energized, got " + s.relayEnergized);
  await dropKindAt('transistor', 450, 300);
  s = await waitFor("dropped Transistor should render as placed-5", (x) => x.placedTransistor !== null);
  assert(s.transistorConducting === "false", "transistor should start cut off, got " + s.transistorConducting);

  // Sub-pixel pin alignment for both, read from the shipped artwork. The relay
  // is the DFRobot 3V module (no connectorNpin markup) so its anchors are the
  // module's own measured pad/screw centroids, proven against the served
  // asset's pixels; the transistor still carries Fritzing connector tabs.
  await verifyRelayPinsOnMetal(4, EXPECTED_RELAY_OFFSETS, RELAY_ANCHORS, RELAY_VB, RELAY_SCALE, evaljs);
  await verifyAssetPinAlignment(
    "transistor",
    5,
    EXPECTED_TRANSISTOR_OFFSETS,
    TRANSISTOR_CONNECTOR_IDS,
    TRANSISTOR_ASSET,
    evaljs
  );
  console.log("step9 relay/transistor asset alignment OK");
  await dropKindAt('led', 1000, 300);
  s = await waitFor("relay-demo LED should render as placed-6", (x) => x.placedLed6 !== null);
  await dropKindAt('led', 150, 550);
  s = await waitFor("transistor-demo LED should render as placed-7", (x) => x.placedLed7 !== null);

  const wire = async (pinA, pinB) => {
    await evaljs(`(()=>{ document.querySelector('[data-testid="${pinA}"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
    await sleep(100);
    await evaljs(`(()=>{ document.querySelector('[data-testid="${pinB}"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  };
  await wire('pin-board-GPIO12', 'pin-placed-4-in');
  await wire('pin-board-3V3_OUT', 'pin-placed-4-com');
  await wire('pin-placed-4-no', 'pin-placed-6-anode');
  await wire('pin-placed-6-cathode', 'pin-board-GND');
  await wire('pin-board-GPIO13', 'pin-placed-5-base');
  await wire('pin-board-3V3_OUT', 'pin-placed-5-collector');
  await wire('pin-placed-5-emitter', 'pin-placed-7-anode');
  await wire('pin-placed-7-cathode', 'pin-board-GND');
  s = await waitFor(
    "all eight switching-demo wires should exist",
    (x) =>
      ["wire-w11", "wire-w12", "wire-w13", "wire-w14", "wire-w15", "wire-w16", "wire-w17", "wire-w18"].every(
        (w) => x.wires.includes(w)
      )
  );
  assert(s.placed6On === "false" && s.placed7On === "false", "switches are open: neither demo LED may be on");
  console.log("step9 wired:", JSON.stringify(s));

  await evaljs(`(()=>{
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
    setter.call(ta, 'import machine, time\\nprint("S9START")\\nr = machine.Pin(12, machine.Pin.OUT)\\nt = machine.Pin(13, machine.Pin.OUT)\\nr.value(1)\\ntime.sleep(1)\\nr.value(0)\\ntime.sleep(1)\\nt.value(1)\\ntime.sleep(1)\\nt.value(0)\\ntime.sleep(1)\\nr.value(1)\\n');
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`);
  const s9Val = await evaljs(`(()=> document.querySelector('textarea').value)()`);
  assert(s9Val.includes("S9START"), "editor did not take the step9 script");
  await evaljs(
    `(()=>{ [...document.querySelectorAll('button')]
       .find((x)=>x.textContent.trim()==='Run').click(); return true; })()`
  );
  s = await waitFor("step9 switching script should start (S9START printed)", (x) => x.output?.includes("S9START"), 20000);
  s = await waitFor(
    "relay energize (in HIGH) should light its LED through com/no",
    (x) => x.relayEnergized === "true" && x.placed6On === "true"
  );
  console.log("step9 relay energized:", JSON.stringify(s));
  s = await waitFor(
    "relay de-energize (in LOW) should extinguish its LED (com/nc restored)",
    (x) => x.relayEnergized === "false" && x.placed6On === "false"
  );
  console.log("step9 relay de-energized:", JSON.stringify(s));
  s = await waitFor(
    "transistor conduction (base HIGH) should light its LED",
    (x) => x.transistorConducting === "true" && x.placed7On === "true"
  );
  console.log("step9 transistor conducting:", JSON.stringify(s));
  s = await waitFor(
    "transistor cutoff (base LOW) should extinguish its LED",
    (x) => x.transistorConducting === "false" && x.placed7On === "false"
  );
  console.log("step9 transistor cut off:", JSON.stringify(s));
  assert(!s.issue, "unexpected issue banner after step9: " + s.issue);

  // ---- 10. StepperMotor end-to-end rotation. A script drives GPIO4..7
  //         (-> in1..in4) through the half-step table. Because the shim ticks
  //         the sim on every value() write, only the ONE pin that changes per
  //         table transition is written — a naive all-four-pins write would
  //         expose each intermediate 2-bit/transient pattern to the engine and
  //         corrupt the step accounting. 2 laps forward (16 half-steps)
  //         must land on exactly 16*(360/4096) = 1.40625 deg CW, 2 laps back
  //         must return to 0 deg CCW, and the motor body is the real
  //         wokwi-stepper-motor element — its shadow-DOM #arrow-path rotation
  //         must sweep with data-angle.
  await dropKindAt('stepper', 640, 200);
  s = await waitFor("dropped Stepper should render as placed-8", (x) => x.placedStepper !== null);
  s = await waitFor("motor shadow-DOM art should be attached", (x) => x.stepperRotate !== null);
  assert(s.stepperAngle === "0", "stepper should start at angle 0, got " + s.stepperAngle);
  assert(s.stepperDirection === "none", "stepper should start direction none, got " + s.stepperDirection);
  assert(
    Math.abs(parseRotate(s.stepperRotate)) < 0.01,
    "motor should start unrotated, got " + s.stepperRotate
  );

  // Sub-pixel pin alignment: the six canvas markers must sit on the vendored
  // element's own pinInfo positions (the view's stepperPinOffsets table mirrors
  // that geometry), and the relabel must be in1..in4, vcc, gnd.
  const pinGeo = await evaljs(`(()=>{
    const stage = document.querySelector('[data-testid="circuit-stage"]');
    const sr = stage.getBoundingClientRect();
    const scale = sr.width / 4000;
    const body = document.querySelector('[data-testid="body-placed-8"]').getBoundingClientRect();
    const origin = { x: (body.left - sr.left) / scale, y: (body.top - sr.top) / scale };
    const el = document.querySelector('[data-testid="body-placed-8"] app-stepper-motor');
    const info = el?.pinInfo ?? [];
    const byName = Object.fromEntries(info.map((pi) => [pi.name, { x: pi.x, y: pi.y }]));
    const aligns = info.map((pi) => {
      const m = document.querySelector('[data-testid="pin-placed-8-'+pi.name+'"] circle').getBoundingClientRect();
      const got = { x: (m.left + m.width / 2 - sr.left) / scale, y: (m.top + m.height / 2 - sr.top) / scale };
      const want = { x: origin.x + pi.x, y: origin.y + pi.y };
      return { name: pi.name, got, want, dx: got.x - want.x, dy: got.y - want.y };
    });
    return { elTag: el?.tagName.toLowerCase() ?? null, names: info.map((pi) => pi.name), byName, aligns };
  })()`);
  console.log("step10 pin geometry:", JSON.stringify(pinGeo));
  assert(
    pinGeo.elTag === "app-stepper-motor",
    "motor body must be the vendored app-stepper-motor, got " + pinGeo.elTag
  );
  assert(
    JSON.stringify([...pinGeo.names].sort()) ===
      JSON.stringify(["gnd", "in1", "in2", "in3", "in4", "vcc"].sort()),
    "vendored element must expose six pins in1..in4, vcc, gnd, got " + JSON.stringify(pinGeo.names)
  );
  for (const [name, off] of Object.entries(EXPECTED_STEPPER_OFFSETS)) {
    const live = pinGeo.byName[name];
    assert(
      live && Math.abs(live.x - off.x) < 0.01 && Math.abs(live.y - off.y) < 0.01,
      "stepperPinOffsets must match the element pinInfo for " + name + ", got " + JSON.stringify(live)
    );
  }
  for (const a of pinGeo.aligns) {
    assert(
      Math.abs(a.dx) < 1 && Math.abs(a.dy) < 1,
      "pin " + a.name + " must align sub-pixel on its lead, got dx=" + a.dx.toFixed(3) + " dy=" + a.dy.toFixed(3)
    );
  }

  await wire('pin-board-GPIO4', 'pin-placed-8-in1');
  await wire('pin-board-GPIO5', 'pin-placed-8-in2');
  await wire('pin-board-GPIO6', 'pin-placed-8-in3');
  await wire('pin-board-GPIO7', 'pin-placed-8-in4');
  s = await waitFor(
    "all four stepper-drive wires should exist",
    (x) => ["wire-w19", "wire-w20", "wire-w21", "wire-w22"].every((w) => x.wires.includes(w))
  );
  console.log("step10 wired:", JSON.stringify(s));

  await evaljs(`(()=>{
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
    setter.call(ta, 'import machine, time\\nprint("S10START")\\np = [machine.Pin(4, machine.Pin.OUT), machine.Pin(5, machine.Pin.OUT), machine.Pin(6, machine.Pin.OUT), machine.Pin(7, machine.Pin.OUT)]\\nHLF = [0b1000, 0b1010, 0b0010, 0b0110, 0b0100, 0b0101, 0b0001, 0b1001]\\ndef drive(prev, nxt, t=0.04):\\n    diff = prev ^ nxt\\n    for i in range(4):\\n        if diff & (0b1000 >> i):\\n            p[i].value((nxt >> (3 - i)) & 1)\\n    time.sleep(t)\\n    return nxt\\ncur = drive(0, 0b1000)\\nfor _ in range(2):\\n    for v in HLF[1:] + HLF[:1]:\\n        cur = drive(cur, v)\\nprint("S10FWD")\\ntime.sleep(1.0)\\nfor _ in range(2):\\n    for v in HLF[:0:-1]:\\n        cur = drive(cur, v)\\n    cur = drive(cur, 0b1000)\\nprint("S10BACK")\\n');
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`);
  const s10Val = await evaljs(`(()=> document.querySelector('textarea').value)()`);
  assert(s10Val.includes("S10START"), "editor did not take the stepper script");
  await evaljs(
    `(()=>{ [...document.querySelectorAll('button')]
       .find((x)=>x.textContent.trim()==='Run').click(); return true; })()`
  );
  s = await waitFor("stepper drive should complete forward (S10FWD)", (x) => x.output?.includes("S10FWD"), 20000);
  s = await waitFor(
    "stepper should sit at 16 half-steps (1.40625 deg), CW",
    (x) => x.stepperDirection === "CW" && Math.abs(parseFloat(x.stepperAngle) - 1.40625) < 0.01,
    10000
  );
  assert(parseFloat(s.stepperStepsPerSecond) > 0, "live steps/sec should be reported during the drive, got " + s.stepperStepsPerSecond);
  console.log("step10 forward CW:", JSON.stringify(s));
  s = await waitFor("stepper should complete reverse (S10BACK)", (x) => x.output?.includes("S10BACK"), 20000);
  s = await waitFor(
    "stepper should return to ~0 deg, CCW",
    (x) => x.stepperDirection === "CCW" && Math.abs(parseFloat(x.stepperAngle)) < 0.01,
    10000
  );
  const backAngle = parseRotate(s.stepperRotate);
  assert(Math.abs(backAngle) < 0.01, "motor should return to ~0 rotation, got " + s.stepperRotate);
  console.log("step10 reverse CCW:", JSON.stringify(s));
  assert(!s.issue, "unexpected issue banner after stepper step: " + s.issue);

  // ---- 11. No custom-element registration collision. Reload with an error
  //         capture armed before the app boots; both the package's
  //         wokwi-stepper-motor and our vendored app-stepper-motor must be
  //         registered, and no customElements.define error may be reported.
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__execErrors=[]; addEventListener('error',e=>window.__execErrors.push(String(e.message))); addEventListener('unhandledrejection',e=>window.__execErrors.push('reject:'+String(e.reason)));`,
  });
  await send("Page.reload", { ignoreCache: true });
  await sleep(2500);
  const reg = await evaljs(`(()=>({
    pkg: !!customElements.get('wokwi-stepper-motor'),
    vendored: !!customElements.get('app-stepper-motor'),
    pirPkg: !!customElements.get('wokwi-pir-motion-sensor'),
    pirVendored: !!customElements.get('app-pir-motion-sensor'),
    defineErrors: (window.__execErrors||[]).filter((m)=>/define|custom element|app-stepper-motor|app-pir-motion-sensor/i.test(m)),
  }))()`);
  console.log("step11 registration:", JSON.stringify(reg));
  assert(
    reg.pkg && reg.vendored && reg.pirPkg && reg.pirVendored,
    "stepper and PIR package+vendored elements must all be registered, got " + JSON.stringify(reg)
  );
  assert(
    reg.defineErrors.length === 0,
    "no customElements.define console errors allowed, got " + JSON.stringify(reg.defineErrors)
  );

  // ---- 12. PIR motion sensor (vendored app-pir-motion-sensor). The dome is
  //         the stimulus: clicking it routes through the worker's press message
  //         into PIRSensor.triggerMotion, which drives `out` HIGH immediately
  //         for the 5s holdSeconds. The dome glow + data-motion attribute must
  //         track that exactly, a board GPIO wired to `out` must read HIGH
  //         right after the trigger and LOW again when the hold expires (the
  //         worker's own 60fps loop keeps ticking while the UI idles, so the
  //         expiry is deterministic). This runs in the post-reload session, so
  //         this drop is the only placed component (placed-1).
  await dropKindAt('pir', 900, 160);
  s = await waitFor("dropped PIR should render", (x) => x.pirMotion !== null);
  assert(s.pirMotion === "false", "PIR should start motion-inactive, got " + s.pirMotion);
  assert(s.placedBodies === 1, "after reload the PIR should be the only placed component, got " + s.placedBodies);

  // Sub-pixel pin alignment: the three canvas markers must sit on the vendored
  // element's own pinInfo (vcc/out/gnd along the single lead row at y=92) and
  // the relabel must be vcc, out, gnd.
  const pirGeo = await evaljs(`(()=>{
    const stage = document.querySelector('[data-testid="circuit-stage"]');
    const sr = stage.getBoundingClientRect();
    const scale = sr.width / 4000;
    const body = document.querySelector('[data-testid="body-placed-1"]').getBoundingClientRect();
    const origin = { x: (body.left - sr.left) / scale, y: (body.top - sr.top) / scale };
    const el = document.querySelector('[data-testid="body-placed-1"] app-pir-motion-sensor');
    const info = el?.pinInfo ?? [];
    const byName = Object.fromEntries(info.map((pi) => [pi.name, { x: pi.x, y: pi.y }]));
    const aligns = info.map((pi) => {
      const m = document.querySelector('[data-testid="pin-placed-1-'+pi.name+'"] circle').getBoundingClientRect();
      const got = { x: (m.left + m.width / 2 - sr.left) / scale, y: (m.top + m.height / 2 - sr.top) / scale };
      const want = { x: origin.x + pi.x, y: origin.y + pi.y };
      return { name: pi.name, got, want, dx: got.x - want.x, dy: got.y - want.y };
    });
    return { elTag: el?.tagName.toLowerCase() ?? null, names: info.map((pi) => pi.name), byName, aligns };
  })()`);
  console.log("step12 PIR pin geometry:", JSON.stringify(pirGeo));
  assert(
    pirGeo.elTag === "app-pir-motion-sensor",
    "PIR body must be the vendored app-pir-motion-sensor, got " + pirGeo.elTag
  );
  assert(
    JSON.stringify([...pirGeo.names].sort()) === JSON.stringify(["gnd", "out", "vcc"].sort()),
    "vendored element must expose three pins vcc/out/gnd, got " + JSON.stringify(pirGeo.names)
  );
  for (const [name, off] of Object.entries(EXPECTED_PIR_OFFSETS)) {
    const live = pirGeo.byName[name];
    assert(
      live && Math.abs(live.x - off.x) < 0.01 && Math.abs(live.y - off.y) < 0.01,
      "pirPinOffsets must match the element pinInfo for " + name + ", got " + JSON.stringify(live)
    );
  }
  for (const a of pirGeo.aligns) {
    assert(
      Math.abs(a.dx) < 1 && Math.abs(a.dy) < 1,
      "pin " + a.name + " must align sub-pixel on its lead, got dx=" + a.dx.toFixed(3) + " dy=" + a.dy.toFixed(3)
    );
  }

  const domeFill = async () =>
    await evaljs(`(()=>{
      const r = document.querySelector('[data-testid="body-placed-1"] app-pir-motion-sensor')?.shadowRoot;
      if (!r) return null;
      const circles = [...r.querySelectorAll('circle')];
      return { outer: circles[0]?.getAttribute('fill') ?? null, inner: circles[1]?.getAttribute('fill') ?? null };
    })()`);
  const idleDome = await domeFill();
  assert(
    idleDome && idleDome.outer === "#d3d5d6" && idleDome.inner === "#d9e1e1",
    "PIR dome should render idle gray before any motion, got " + JSON.stringify(idleDome)
  );

  await wire('pin-placed-1-out', 'pin-board-GPIO8');
  console.log("step12 wired:", JSON.stringify(await state()));

  const readGpio8 = async (tag) => {
    await evaljs(`(()=>{
      const ta = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
      setter.call(ta, 'import machine\\nprint("${tag}=" + str(machine.Pin(8, machine.Pin.IN).value()))\\n');
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      return true;
    })()`);
    await evaljs(`(()=>{ [...document.querySelectorAll('button')]
      .find((x)=>x.textContent.trim()==='Run').click(); return true; })()`);
    s = await waitFor("GPIO8 read (" + tag + ") should print", (x) => x.output?.includes(tag + "="), 20000);
    return (s.output.split(tag + "=").pop() ?? "").match(/^([01])/)?.[1] ?? null;
  };
  const before = await readGpio8("PIR_BEFORE");
  assert(before === "0", "GPIO8 should read LOW before any motion, got " + before);

  await evaljs(`(()=>{
    const b = document.querySelector('[data-testid="pir-body"]');
    b.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
    b.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    return true;
  })()`);
  s = await waitFor("dome click should trigger motion", (x) => x.pirMotion === "true", 5000);
  const activeDome = await domeFill();
  assert(
    activeDome && activeDome.outer === "#ffb74d" && activeDome.inner === "#ffa726",
    "PIR dome should glow amber while detecting, got " + JSON.stringify(activeDome)
  );
  console.log("step12 triggered:", JSON.stringify(s));

  const after = await readGpio8("PIR_AFTER");
  assert(after === "1", "GPIO8 should read HIGH while motionActive, got " + after);

  s = await waitFor("5s hold should expire back to idle", (x) => x.pirMotion === "false", 12000);
  const expiredDome = await domeFill();
  assert(
    expiredDome && expiredDome.outer === "#d3d5d6" && expiredDome.inner === "#d9e1e1",
    "PIR dome should revert to idle gray after the hold expires, got " + JSON.stringify(expiredDome)
  );
  assert(!s.issue, "unexpected issue banner after PIR step: " + s.issue);
  console.log("step12 expiry:", JSON.stringify(s));

  // ---- 13. Potentiometer + Resistor + Capacitor (the RC timing trio). The
  //         published wokwi-potentiometer owns its pointer interactions, so
  //         the knob must be turned through PotentiometerView's capture-drag
  //         overlay (which also must NOT drag the body around), and the
  //         setKnobPosition message must make the snapshot echo the new wiper
  //         fraction. Then wire the charging chain Resistor.terminal1 — Cap.a
  //         — GPIO8 and Cap.b — GND and run a real-Python discharge/poll pulse:
  //         GPIO8 OUT LOW discharges (DigitallyDriven force-adopt), re-format
  //         as IN begins the charge, and the LOW→HIGH trip should land at
  //         maxChargeSeconds(2) × fraction(10kΩ→0.5) = 1.0s. GPIO8 is freed
  //         first by disconnecting the PIR's wire — whose line still reaches
  //         the placed-1 `out` pin in this post-reload session (the demo
  //         wiring w1–w6 stays; only that one wire comes off).
  s = await state();
  const wiresBeforePirDisconnect = s.wires.length;
  await evaljs(`(()=>{
    const stage = document.querySelector('[data-testid="circuit-stage"]');
    const sr = stage.getBoundingClientRect();
    const scale = sr.width / 4000;
    const m = document.querySelector('[data-testid="pin-placed-1-out"] circle').getBoundingClientRect();
    const cx = (m.left + m.width / 2 - sr.left) / scale;
    const cy = (m.top + m.height / 2 - sr.top) / scale;
    const near = (l) => {
      const d1 = Math.hypot(+l.getAttribute('x1') - cx, +l.getAttribute('y1') - cy);
      const d2 = Math.hypot(+l.getAttribute('x2') - cx, +l.getAttribute('y2') - cy);
      return Math.min(d1, d2) < 1.5;
    };
    const target = [...document.querySelectorAll('[data-testid^="wire-"]')]
      .find((w) => [...w.querySelectorAll('line')].some(near));
    if (target) target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    return !!target;
  })()`);
  s = await waitFor(
    "disconnecting the PIR wire should leave one fewer wire (freeing GPIO8)",
    (x) => x.wires.length === wiresBeforePirDisconnect - 1
  );
  assert(s.placedBodies === 1, "after freeing GPIO8 only the PIR should remain, got placedBodies=" + s.placedBodies);

  await dropKindAt('potentiometer', 480, 560);
  s = await waitFor("dropped Potentiometer should render as placed-2 at knob 0.000", (x) => x.potKnob === "0.000");
  const potPosBefore = s.placed2;
  await dropKindAt('resistor', 580, 560);
  s = await waitFor("dropped Resistor should render as placed-3 at 10000 ohms", (x) => x.resistorOhms === "10000");
  await dropKindAt('capacitor', 680, 560);
  s = await waitFor(
    "dropped Capacitor should render as placed-4 (threshold 0 means it charges instantly alone)",
    (x) => x.capCharged === "true"
  );

  // Sub-pixel pin alignment for all three parts: the canvas markers must sit on
  // each lead. For the pot/resistor that is verified against the element's own
  // live pinInfo; for the hand-drawn capacitor the art's leg tips are the
  // target (no pinInfo exists to diff against).
  const rcGeo = await evaljs(`(()=>{
    const stage = document.querySelector('[data-testid="circuit-stage"]');
    const sr = stage.getBoundingClientRect();
    const scale = sr.width / 4000;
    const originOf = (id) => {
      const b = document.querySelector('[data-testid="body-'+id+'"]').getBoundingClientRect();
      return { x: (b.left - sr.left) / scale, y: (b.top - sr.top) / scale };
    };
    const readPin = (name) => {
      const m = document.querySelector('[data-testid="pin-'+name+'"] circle').getBoundingClientRect();
      return { x: (m.left + m.width / 2 - sr.left) / scale, y: (m.top + m.height / 2 - sr.top) / scale };
    };
    const potEl = document.querySelector('[data-testid="body-placed-2"] app-potentiometer');
    const resEl = document.querySelector('[data-testid="body-placed-3"] wokwi-resistor');
    const potInfo = potEl?.pinInfo ?? [];
    const resInfo = resEl?.pinInfo ?? [];
    const aligns = [];
    for (const [part, id, offsets] of [
      ['pot', 'placed-2', { terminal1: { x: 29, y: 68.5 }, wiper: { x: 39, y: 68.5 }, terminal2: { x: 49, y: 68.5 } }],
      ['res', 'placed-3', { terminal1: { x: 0, y: 5.65 }, terminal2: { x: 58.8, y: 5.65 } }],
      ['cap', 'placed-4', { a: { x: 12.6, y: 57.6 }, b: { x: 30.6, y: 57.6 } }],
    ]) {
      const o = originOf(id);
      for (const [name, off] of Object.entries(offsets)) {
        const got = readPin(id + '-' + name);
        aligns.push({ part: part + '-' + name, got, dx: got.x - (o.x + off.x), dy: got.y - (o.y + off.y) });
      }
    }
    return {
      potTag: potEl?.tagName.toLowerCase() ?? null,
      resTag: resEl?.tagName.toLowerCase() ?? null,
      potInfo: potInfo.map((p) => ({ name: p.name, x: p.x, y: p.y })),
      resInfo: resInfo.map((p) => ({ name: p.name, x: p.x, y: p.y })),
      aligns,
    };
  })()`);
  console.log("step13 RC pin geometry:", JSON.stringify(rcGeo));
  assert(
    rcGeo.potTag === "app-potentiometer",
    "pot body must be the vendored app-potentiometer, got " + rcGeo.potTag
  );
  assert(rcGeo.resTag === "wokwi-resistor", "resistor body must be wokwi-resistor, got " + rcGeo.resTag);
  const potInfoMap = Object.fromEntries(rcGeo.potInfo.map((p) => [p.name, p]));
  const resInfoMap = Object.fromEntries(rcGeo.resInfo.map((p) => [p.name, p]));
  assert(
    (["GND", "SIG", "VCC"]).every((n) => potInfoMap[n]),
    "app-potentiometer must expose GND/SIG/VCC leads, got " + JSON.stringify(rcGeo.potInfo)
  );
  assert(
    (["1", "2"]).every((n) => resInfoMap[n]),
    "wokwi-resistor must expose leads '1'/'2', got " + JSON.stringify(rcGeo.resInfo)
  );
  for (const [elm, live, want] of [
    ["terminal1", potInfoMap.GND, EXPECTED_POT_OFFSETS.terminal1],
    ["wiper", potInfoMap.SIG, EXPECTED_POT_OFFSETS.wiper],
    ["terminal2", potInfoMap.VCC, EXPECTED_POT_OFFSETS.terminal2],
  ]) {
    assert(
      live && Math.abs(live.x - want.x) < 0.01 && Math.abs(live.y - want.y) < 0.01,
      "potPinOffsets must match app-potentiometer pinInfo for " + elm + ", got " + JSON.stringify(live)
    );
  }
  for (const [elm, live, want] of [
    ["terminal1", resInfoMap["1"], EXPECTED_RES_OFFSETS.terminal1],
    ["terminal2", resInfoMap["2"], EXPECTED_RES_OFFSETS.terminal2],
  ]) {
    assert(
      live && Math.abs(live.x - want.x) < 0.01 && Math.abs(live.y - want.y) < 0.01,
      "resistorPinOffsets must match wokwi-resistor pinInfo for " + elm + ", got " + JSON.stringify(live)
    );
  }
  for (const a of rcGeo.aligns) {
    assert(
      Math.abs(a.dx) < 1 && Math.abs(a.dy) < 1,
      "pin " + a.part + " must align sub-pixel on its lead, got dx=" + a.dx.toFixed(3) + " dy=" + a.dy.toFixed(3)
    );
  }

  // Turn the knob to 1.0 through the capture-drag overlay: a -120px vertical
  // drag maps KNOB_TRAVEL(120) to full travel. The 1.000 must come back from
  // the ENGINE (postMessage → Potentiometer.setKnobPosition → snapshot), not
  // from local view state, and the body must not have been dragged.
  await evaljs(`(()=>{
    const knob = document.querySelector('[data-testid="potentiometer-knob"]');
    const r = knob.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    knob.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: cx, clientY: cy, pointerId: 1, pointerType: 'mouse' }));
    knob.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 0, clientX: cx, clientY: cy - 120, pointerId: 1, pointerType: 'mouse' }));
    knob.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, clientX: cx, clientY: cy - 120, pointerId: 1, pointerType: 'mouse' }));
    return true;
  })()`);
  s = await waitFor("knob drag should drive the engine's knobPosition to 1.000", (x) => x.potKnob === "1.000", 5000);
  assert(
    s.placed2 && s.placed2.x === potPosBefore.x && s.placed2.y === potPosBefore.y,
    "turning the knob must not drag the potentiometer body, got " + JSON.stringify(s.placed2) + " before=" + JSON.stringify(potPosBefore)
  );

  // Wire the charging chain and run a real Python discharge/poll pulse. The
  // worker owns the Circuit here, and the JSPI non-blocking sleep lets our own
  // 60fps tick loop advance the capacitor charge clock mid-python-loop. The
  // demo wires w1–w6 stay in place; exactly three new wires must appear.
  const wiresBeforeRc = (await state()).wires.length;
  await wire('pin-placed-3-terminal1', 'pin-placed-4-a');
  await wire('pin-placed-4-a', 'pin-board-GPIO8');
  await wire('pin-placed-4-b', 'pin-board-GND');
  s = await waitFor(
    "all three RC wires should exist",
    (x) => x.wires.length === wiresBeforeRc + 3
  );
  console.log("step13 RC wired:", JSON.stringify(s));

  await evaljs(`(()=>{
    const ta = document.querySelector('textarea');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
    setter.call(ta, 'import machine, time\\nprint("RC13START")\\np = machine.Pin(8, machine.Pin.OUT, machine.Pin.PULL_DOWN)\\np.value(0)\\np = machine.Pin(8, machine.Pin.IN)\\nt0 = time.monotonic()\\nwhile p.value() == 0:\\n    if time.monotonic() - t0 > 3.0:\\n        print("RC13_ELAPSED=3000")\\n        break\\n    time.sleep(0.02)\\nelapsed = time.monotonic() - t0\\nif elapsed <= 3.0:\\n    print("RC13_ELAPSED=" + str(int(elapsed * 1000)))\\n');
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`);
  const rc13Val = await evaljs(`(()=> document.querySelector('textarea').value)()`);
  assert(rc13Val.includes("RC13START"), "editor did not take the step13 script");
  await evaljs(`(()=>{ [...document.querySelectorAll('button')]
    .find((x)=>x.textContent.trim()==='Run').click(); return true; })()`);
  s = await waitFor("RC pulse should print RC13_ELAPSED", (x) => x.output?.includes("RC13_ELAPSED="), 20000);
  const rc13Elapsed = parseInt((s.output.split("RC13_ELAPSED=").pop() ?? "0").split(/[^\d]/)[0], 10);
  console.log("step13 RC elapsed (ms):", rc13Elapsed);
  assert(
    rc13Elapsed >= 600 && rc13Elapsed <= 1400,
    "10kΩ charge should trip the LOW→HIGH readout around 1000ms (±400), got " + rc13Elapsed
  );
  s = await waitFor("GPIO8 should sit HIGH once charged", (x) => x.capCharged === "true");
  assert(!s.issue, "unexpected issue banner after RC step: " + s.issue);
  console.log("step13 charged:", JSON.stringify(s));

  // ---- 14. UltrasonicSensor (published wokwi-hc-sr04, used unchanged). The
  //         four canvas markers must sit on the element's own pinInfo sub-pixel;
  //         the wires run vcc->3V3_OUT, trig->GPIO9, echo->GPIO10, gnd->GND.
  //         Then the slider drag relays a parametric distance stimulus
  //         (top-setSimulatedDistance) and REAL Python times the TRIG/ECHO pulse
  //         with the micros()/tickUs() bridge: 300cm then 360cm must measure
  //         exactly distance*58us. Note the write tick (1/60s) already advances
  //         16667us into the 17400/20880us echo, so the measured t1-t0 is still
  //         the full distance*58. Dragging to the "no object" stop must produce
  //         NO echo. GPIO9/10 are free. This runs in the post-reload session, so
  //         the drop is placed-5 (PIR/pot/res/cap are placed-1..4).
  await dropKindAt('ultrasonic', 860, 480);
  s = await waitFor("dropped Ultrasonic should render as placed-5", (x) => x.placedUltrasonic !== null);
  assert(
    s.ultrasonicDistance === "none",
    "ultrasonic should start with no object (null distance), got " + s.ultrasonicDistance
  );
  assert(s.ultrasonicReadout === "no object", "readout should show the no-object default, got " + s.ultrasonicReadout);

  // Sub-pixel pin alignment: the four canvas markers must sit on the published
  // element's own pinInfo (VCC/TRIG/ECHO/GND along the bottom face at y=94.5).
  const ultraGeo = await evaljs(`(()=>{
    const stage = document.querySelector('[data-testid="circuit-stage"]');
    const sr = stage.getBoundingClientRect();
    const scale = sr.width / 4000;
    const body = document.querySelector('[data-testid="body-placed-5"]').getBoundingClientRect();
    const origin = { x: (body.left - sr.left) / scale, y: (body.top - sr.top) / scale };
    const el = document.querySelector('[data-testid="body-placed-5"] wokwi-hc-sr04');
    const info = el?.pinInfo ?? [];
    const byName = Object.fromEntries(info.map((pi) => [pi.name, { x: pi.x, y: pi.y }]));
    const aligns = info.map((pi) => {
      const m = document.querySelector('[data-testid="pin-placed-5-'+pi.name.toLowerCase()+'"] circle').getBoundingClientRect();
      const got = { x: (m.left + m.width / 2 - sr.left) / scale, y: (m.top + m.height / 2 - sr.top) / scale };
      const want = { x: origin.x + pi.x, y: origin.y + pi.y };
      return { name: pi.name, got, want, dx: got.x - want.x, dy: got.y - want.y };
    });
    return { elTag: el?.tagName.toLowerCase() ?? null, names: info.map((pi) => pi.name), byName, aligns };
  })()`);
  console.log("step14 ultrasonic pin geometry:", JSON.stringify(ultraGeo));
  assert(
    ultraGeo.elTag === "wokwi-hc-sr04",
    "ultrasonic body must be the published wokwi-hc-sr04, got " + ultraGeo.elTag
  );
  assert(
    JSON.stringify([...ultraGeo.names].sort()) === JSON.stringify(["ECHO", "GND", "TRIG", "VCC"].sort()),
    "published element must expose four pins VCC/TRIG/ECHO/GND, got " + JSON.stringify(ultraGeo.names)
  );
  for (const name of ["VCC", "TRIG", "ECHO", "GND"]) {
    const live = ultraGeo.byName[name];
    const off = EXPECTED_ULTRA_OFFSETS[name.toLowerCase()];
    assert(
      live && Math.abs(live.x - off.x) < 0.01 && Math.abs(live.y - off.y) < 0.01,
      "ultrasonicPinOffsets must match the element pinInfo for " + name + ", got " + JSON.stringify(live)
    );
  }
  for (const a of ultraGeo.aligns) {
    assert(
      Math.abs(a.dx) < 1 && Math.abs(a.dy) < 1,
      "pin " + a.name + " must align sub-pixel on its lead, got dx=" + a.dx.toFixed(3) + " dy=" + a.dy.toFixed(3)
    );
  }

  const wiresBeforeUltra = (await state()).wires.length;
  await wire('pin-placed-5-vcc', 'pin-board-3V3_OUT');
  await wire('pin-placed-5-trig', 'pin-board-GPIO9');
  await wire('pin-placed-5-echo', 'pin-board-GPIO10');
  await wire('pin-placed-5-gnd', 'pin-board-GND');
  s = await waitFor(
    "all four ultrasonic wires should exist",
    (x) => x.wires.length === wiresBeforeUltra + 4
  );
  console.log("step14 ultrasonic wired:", JSON.stringify(s));

  // The distance slider is the stimulus. Dragging its overlay relays
  // top-setSimulatedDistance to the engine (client px / SLIDER_W(150) paddles
  // the 0..1 fraction; a fraction >= 1 is the "no object" stop), and the
  // readout must come back from the snapshot - while the body never drags.
  const slideTo = (targetCm) => evaljs(`(()=>{
    const wrapper = document.querySelector('[data-testid="ultrasonic"]');
    const attr = wrapper.getAttribute('data-distance');
    const now = attr === 'none' ? null : parseFloat(attr);
    const startFrac = now === null ? 1 : (now - 2) / 398;
    const targetFrac = ${targetCm === null ? 1 : (targetCm - 2) / 398};
    const slider = document.querySelector('[data-testid="ultrasonic-slider"]');
    const r = slider.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const delta = (targetFrac - startFrac) * 150;
    slider.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: cx, clientY: cy, pointerId: 14, pointerType: 'mouse' }));
    slider.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, button: 0, clientX: cx + delta, clientY: cy, pointerId: 14, pointerType: 'mouse' }));
    slider.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, button: 0, clientX: cx + delta, clientY: cy, pointerId: 14, pointerType: 'mouse' }));
    return { startFrac, targetFrac, delta };
  })()`);

  const ultraPosBefore = s.placedUltrasonic;
  await slideTo(300);
  s = await waitFor(
    "slider drag should set the 300 cm readout",
    (x) => x.ultrasonicReadout === "300 cm" && x.ultrasonicDistance === "300",
    5000
  );
  assert(
    s.placedUltrasonic && s.placedUltrasonic.x === ultraPosBefore.x && s.placedUltrasonic.y === ultraPosBefore.y,
    "sweeping the distance slider must not drag the ultrasonic body, got " + JSON.stringify(s.placedUltrasonic)
  );
  console.log("step14 slider 300:", JSON.stringify(s));

  // Real Python timing over the bridge: timestamp before trig.value(1) (whose
  // own 1/60s write tick already advances 16667us into the echo), then
  // tickUs(1)-step until the echo drops - the elapsed must be exactly cm*58 =
  // 17400us for 300cm. Each probe uses a unique output marker so a stale print
  // from the previous probe can never satisfy the waitFor.
  const ultraMeasureScript = (label) => `import machine
from js import __pico_bridge
print("UA14START")
trig = machine.Pin(9, machine.Pin.OUT)
trig.value(0)
echo = machine.Pin(10, machine.Pin.IN)
t0 = __pico_bridge.micros()
trig.value(1)
for _ in range(300000):
    if echo.value():
        break
    __pico_bridge.tickUs(1)
for _ in range(300000):
    if not echo.value():
        break
    __pico_bridge.tickUs(1)
dt = __pico_bridge.micros() - t0
print("UA14D${label}=" + str(int(round(dt / 58))))`;
  const ultraNoEchoScript = `import machine
from js import __pico_bridge
print("UA14START")
trig = machine.Pin(9, machine.Pin.OUT)
trig.value(0)
echo = machine.Pin(10, machine.Pin.IN)
trig.value(1)
found = False
for _ in range(30000):
    if echo.value():
        found = True
        break
    __pico_bridge.tickUs(1)
print("UA14_ECHO=" + str(found))
trig.value(0)`;
  const runProbe14 = async (label, script, marker) => {
    await evaljs(`(()=>{
      const ta = document.querySelector('textarea');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set;
      setter.call(ta, ${JSON.stringify(script)});
      ta.dispatchEvent(new Event('input',{bubbles:true}));
      return true;
    })()`);
    await clickRun();
    s = await waitFor("ultrasonic probe (" + label + ") should print", (x) => x.output?.includes(marker), 30000);
    return s.output;
  };
  const parseMeasured = (out, marker) =>
    parseInt((out.split(marker).pop() ?? "0").split(/[^\d]/)[0], 10);

  let out14 = await runProbe14("300cm", ultraMeasureScript("300"), "UA14D300=");
  let dist14 = parseMeasured(out14, "UA14D300=");
  assert(
    dist14 === 300,
    "300 cm must measure a 17400us echo (58us/cm), got " + dist14 + "cm"
  );
  console.log("step14 measured 300cm:", dist14);

  await slideTo(360);
  s = await waitFor(
    "slider drag should set the 360 cm readout",
    (x) => x.ultrasonicReadout === "360 cm" && x.ultrasonicDistance === "360",
    5000
  );
  console.log("step14 slider 360:", JSON.stringify(s));
  out14 = await runProbe14("360cm", ultraMeasureScript("360"), "UA14D360=");
  dist14 = parseMeasured(out14, "UA14D360=");
  assert(
    dist14 === 360,
    "360 cm must measure a 20880us echo (58us/cm), got " + dist14 + "cm"
  );
  console.log("step14 measured 360cm:", dist14);

  // Drag to / past the far end = "no object" (null): readout flips and a fresh
  // TRIG edge must produce NO echo - the bounded wait finds echo still LOW.
  await slideTo(null);
  s = await waitFor(
    "slider at the far stop should read no object",
    (x) => x.ultrasonicReadout === "no object" && x.ultrasonicDistance === "none",
    5000
  );
  console.log("step14 slider no-object:", JSON.stringify(s));
  out14 = await runProbe14("no-object", ultraNoEchoScript, "UA14_ECHO=");
  const echoSeen = (out14.split("UA14_ECHO=").pop() ?? "None").match(/^(True|False)/)?.[1] ?? "None";
  assert(echoSeen === "False", "a null distance must produce NO echo, got " + echoSeen);
  console.log("step14 no-echo confirmed:", echoSeen);
  assert(!s.issue, "unexpected issue banner after the ultrasonic step: " + s.issue);

  // ---- 15. Pan/zoom viewport. The stage is a fixed 4000x2800 space inside a
  //          pannable/zoomable viewport: wheel ALWAYS zooms (cursor-centered,
  //          clamped to 0.25..3), empty-canvas drag ALWAYS pans, and because
  //          every coordinate conversion runs through the same view state, a
  //          drop/drag/wire/conflict are exact at any pan/zoom. This runs in
  //          the post-reload session (placed-1..5 = PIR/pot/res/cap/ultra,
  //          wires w1..w13), so the next ids are placed-6/7 and w14/w15/w16.
  const viewOf = () =>
    evaljs(`(()=>{ const c = document.querySelector('[data-testid="circuit-canvas"]');
      return { zoom: Number(c.getAttribute('data-zoom')), panX: Number(c.getAttribute('data-pan-x')), panY: Number(c.getAttribute('data-pan-y')) };
    })()`);
  let v15 = await viewOf();
  assert(
    v15.zoom === 1 && v15.panX === 0 && v15.panY === 0,
    "after the reload session the canvas must still be at 100%/origin, got " + JSON.stringify(v15)
  );

  // 15a — wheel-zoom to the 3x clamp, cursor-centered. Synthetic WheelEvents
  // have their clientX/Y truncated to integers by the browser, so the cursor
  // the app actually receives (delivered, captured here in a capture-phase
  // listener) is measured and the invariant asserted against THAT: the stage
  // point under the delivered cursor must stay put, i.e. pan = (delivered -
  // rect)*(1-zoom). Rounding < 1px of the intended viewport cursor (300,200)
  // is fine — it is a sub-pixel artifact of dispatchEvent only.
  const z15 = await evaljs(`(()=>{
    const c = document.querySelector('[data-testid="circuit-canvas"]');
    const r = c.getBoundingClientRect();
    window.__wheelCursor = null;
    const cap = (e) => { window.__wheelCursor = { x: e.clientX, y: e.clientY }; };
    c.addEventListener('wheel', cap, true);
    for (let i = 0; i < 16; i++) {
      c.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, clientX: r.left + 300, clientY: r.top + 200 }));
    }
    c.removeEventListener('wheel', cap, true);
    return { rect: { left: r.left, top: r.top }, delivered: window.__wheelCursor, cx: 300, cy: 200 };
  })()`);
  await sleep(150);
  v15 = await viewOf();
  assert(Math.abs(v15.zoom - 3) < 1e-9, "16 wheel zoom-ins must clamp at 3x, got " + v15.zoom);
  const c15 = { x: z15.delivered.x - z15.rect.left, y: z15.delivered.y - z15.rect.top };
  assert(
    Math.abs(c15.x - z15.cx) <= 1 && Math.abs(c15.y - z15.cy) <= 1,
    "the delivered wheel cursor must land within 1px of the intended viewport point, got " + JSON.stringify(c15)
  );
  assert(
    Math.abs(v15.panX - c15.x * (1 - 3)) < 1e-6 && Math.abs(v15.panY - c15.y * (1 - 3)) < 1e-6,
    "cursor-centered zoom must keep the stage point under the cursor fixed, got " + JSON.stringify({ v15, c15 })
  );
  console.log("step15a zoom-in clamp + cursor-centered:", JSON.stringify({ ...v15, deliveredViewportCursor: c15 }));

  // 15b — the whole interaction set at exactly 3x: drop, wire, drag, conflict.
  await dropLedAt(250, 300);
  s = await waitFor(
    "at 3x zoom a dropped LED should land at the requested stage point",
    (x) => x.placedLed6 !== null && Math.abs(x.placedLed6.x - 250) < 3 && Math.abs(x.placedLed6.y - 300) < 3
  );
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-placed-6-anode"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  await sleep(100);
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-board-GPIO20"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  s = await waitFor("at 3x, pin clicks should wire the placed LED as wire-w15", (x) => x.wires.includes("wire-w15"));
  assert(s.placed6On === "false", "unpowered placed-6 must not light at 3x, got " + s.placed6On);
  console.log("step15b placed+wired at 3x:", JSON.stringify(s));

  const dragBody = (bodyId, fromStage, toStage) => evaljs(`(()=>{
    const stage = document.querySelector('[data-testid="circuit-stage"]');
    const r = stage.getBoundingClientRect();
    const k = r.width / 4000;
    const toClient = (x, y) => ({ x: r.left + x * k, y: r.top + y * k });
    const a = toClient(${fromStage.x}, ${fromStage.y});
    const b = toClient(${toStage.x}, ${toStage.y});
    const body = document.querySelector('[data-testid="body-${bodyId}"]');
    body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: a.x, clientY: a.y, button: 0, pointerId: 33, pointerType: 'mouse' }));
    stage.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: b.x, clientY: b.y, pointerId: 33, button: 0 }));
    stage.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, clientX: b.x, clientY: b.y, pointerId: 33, button: 0 }));
    return { a, b, k };
  })()`);

  // Drag the LED 120,-80 stage units (its wire must follow) — exact at 3x.
  // line[0] is the anode end of the wire (see step-5's wire-w7 shape).
  const w15Seg = () =>
    evaljs(`(()=>{
      const g = document.querySelector('[data-testid="wire-w15"]');
      const l = g?.querySelector('line');
      return l ? { x1: +l.getAttribute('x1'), y1: +l.getAttribute('y1'), x2: +l.getAttribute('x2'), y2: +l.getAttribute('y2') } : null;
    })()`);
  const w15before = await w15Seg();
  assert(w15before, "wire-w15 should have renderable endpoints before the 3x drag");
  await dragBody("placed-6", { x: 265, y: 315 }, { x: 385, y: 235 });
  s = await waitFor(
    "at 3x zoom a body drag +120,-80 must land exactly",
    (x) => x.placedLed6 !== null && Math.abs(x.placedLed6.x - 370) < 3 && Math.abs(x.placedLed6.y - 220) < 3
  );
  const w15after = await w15Seg();
  assert(
    w15after &&
      Math.abs(w15after.x1 - (w15before.x1 + 120)) < 3 &&
      Math.abs(w15after.y1 - (w15before.y1 - 80)) < 3,
    `wire-w15 anode endpoint should follow the 3x drag, before=${JSON.stringify(
      w15before
    )} after=${JSON.stringify(w15after)}`
  );
  console.log("step15b dragged at 3x:", JSON.stringify({ placed6: s.placedLed6, wire15: w15after }));

  // Sub-pixel alignment still holds at 3x: the anode marker sits at art
  // offset (25,42) from its body origin, measured through the zoomed rect.
  const pinOnArt = (bodyId, pin, expX, expY) => evaljs(`(()=>{
    const stage = document.querySelector('[data-testid="circuit-stage"]');
    const sr = stage.getBoundingClientRect();
    const k = sr.width / 4000;
    const body = document.querySelector('[data-testid="body-${bodyId}"]').getBoundingClientRect();
    const origin = { x: (body.left - sr.left) / k, y: (body.top - sr.top) / k };
    const p = document.querySelector('[data-testid="pin-${bodyId}-${pin}"] circle').getBoundingClientRect();
    const got = { x: (p.left + p.width / 2 - sr.left) / k, y: (p.top + p.height / 2 - sr.top) / k };
    return { got, dx: got.x - (origin.x + ${expX}), dy: got.y - (origin.y + ${expY}), zoom: k };
  })()`);
  const a3 = await pinOnArt("placed-6", "anode", 25, 42);
  assert(
    Math.abs(a3.dx) < 1 && Math.abs(a3.dy) < 1,
    "at 3x the LED anode must still align sub-pixel on its art, got dx=" + a3.dx.toFixed(3) + " dy=" + a3.dy.toFixed(3)
  );
  console.log("step15b sub-pixel at 3x:", JSON.stringify(a3));

  // Conflict highlighting at 3x: 3V3_OUT <-> GND short flags wire-w15 (the
  // merged net also pulls in every wire touching either rail) + banner; the
  // red/dashed styling is applied at any zoom (same SVG layer transform).
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-board-3V3_OUT"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  await sleep(100);
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-board-GND"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  s = await waitFor(
    "at 3x, a 3V3_OUT-GND short should flag conflicted wires + banner",
    (x) => x.wires.includes("wire-w16") && x.conflictBanner !== null && x.conflictedWires.length > 0
  );
  const peakConflicted = s.conflictedWires;
  const w16Style = await evaljs(`(()=>{
    const g = document.querySelector('[data-testid="wire-w16"]');
    const l = g?.querySelectorAll('line')[1] ?? g?.querySelector('line');
    return l ? { stroke: l.getAttribute('stroke'), dash: l.getAttribute('stroke-dasharray') } : null;
  })()`);
  assert(
    w16Style && w16Style.stroke === "#d81b1b" && w16Style.dash === "8 5",
    "conflicted wire must be red/dashed at 3x, got " + JSON.stringify(w16Style)
  );
  assert(s.conflictedWires.includes("wire-w16"), "the short itself must be flagged, got " + s.conflictedWires);
  await evaljs(`(()=>{ document.querySelector('[data-testid="wire-w16"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  s = await waitFor(
    "removing the 3x short must clear the banner and any conflict styling",
    (x) => !x.wires.includes("wire-w16") && x.conflictBanner === null && x.conflictedWires.length === 0
  );
  console.log("step15b conflict at 3x resolved:", JSON.stringify({ conflictedWiresAtPeak: peakConflicted, placed6: s.placedLed6 }));

  // 15c — empty-canvas drag pans (drag-always-pans). Pointer down on the bare
  // canvas at viewport (300,200) — empty at 3x — then drag client +150,-50.
  // The component bodies and their wires must NOT move; only the viewport does.
  const placed6BeforePan = s.placedLed6;
  const panDrag = await evaljs(`(()=>{
    const c = document.querySelector('[data-testid="circuit-canvas"]');
    const r = c.getBoundingClientRect();
    const a = { x: r.left + 300, y: r.top + 200 };
    const b = { x: r.left + 450, y: r.top + 150 };
    c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: a.x, clientY: a.y, button: 0, pointerId: 44, pointerType: 'mouse' }));
    c.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: b.x, clientY: b.y, pointerId: 44, button: 0 }));
    c.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, clientX: b.x, clientY: b.y, pointerId: 44, button: 0 }));
    return { dx: b.x - a.x, dy: b.y - a.y };
  })()`);
  await sleep(150);
  const panAfterDrag = await viewOf();
  assert(
    Math.abs(panAfterDrag.panX - (v15.panX + panDrag.dx)) < 2 &&
      Math.abs(panAfterDrag.panY - (v15.panY + panDrag.dy)) < 2,
    "empty-canvas drag should pan exactly by the client delta, got " + JSON.stringify({ before: v15, after: panAfterDrag, drag: panDrag })
  );
  assert(
    JSON.stringify(s.placedLed6) === JSON.stringify(placed6BeforePan),
    "panning must not move component bodies, got " + JSON.stringify(s.placedLed6)
  );
  v15 = panAfterDrag;
  console.log("step15c pan:", JSON.stringify({ ...v15, drag: panDrag }));

  // 15d — drop at a far stage point AFTER panning proves the drop math
  // combines pan+zoom: the drop target (1800,1200) is well outside the view.
  await dropLedAt(1800, 1200);
  s = await waitFor(
    "after panning, a drop at stage (1800,1200) should land exactly there",
    (x) => x.placedLed7 !== null && Math.abs(x.placedLed7.x - 1800) < 3 && Math.abs(x.placedLed7.y - 1200) < 3
  );
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-placed-7-anode"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  await sleep(100);
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-board-GPIO21"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  s = await waitFor("placed-7 should be wired as wire-w17 (post-pan)", (x) => x.wires.includes("wire-w17"));
  console.log("step15d drop+wired after pan:", JSON.stringify({ placed7: s.placedLed7, wired: s.wires.includes("wire-w17") }));

  // 15e — zoom out to the 0.25 clamp; drags and sub-pixel alignment still
  // exact, and the far component stays put. Same delivered-cursor capture as
  // 15a. Because 15c/15d panned and dropped after the 3x zoom-in, the correct
  // invariant is now: the STAGE point under the captured cursor must be
  // preserved across the zoom steps, i.e. (c - pan)/zoom is constant.
  const v15pre = await viewOf();
  const zBack = await evaljs(`(()=>{
    const c = document.querySelector('[data-testid="circuit-canvas"]');
    const r = c.getBoundingClientRect();
    window.__wheelCursor = null;
    const cap = (e) => { window.__wheelCursor = { x: e.clientX, y: e.clientY }; };
    c.addEventListener('wheel', cap, true);
    for (let i = 0; i < 34; i++) {
      c.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100, clientX: r.left + 300, clientY: r.top + 200 }));
    }
    c.removeEventListener('wheel', cap, true);
    return { rect: { left: r.left, top: r.top }, delivered: window.__wheelCursor };
  })()`);
  await sleep(150);
  v15 = await viewOf();
  assert(Math.abs(v15.zoom - 0.25) < 1e-9, "34 wheel zoom-outs must clamp at 0.25x, got " + v15.zoom);
  const cBack = { x: zBack.delivered.x - zBack.rect.left, y: zBack.delivered.y - zBack.rect.top };
  const stageBefore = { x: (cBack.x - v15pre.panX) / v15pre.zoom, y: (cBack.y - v15pre.panY) / v15pre.zoom };
  const stageAfter = { x: (cBack.x - v15.panX) / v15.zoom, y: (cBack.y - v15.panY) / v15.zoom };
  assert(
    Math.abs(stageAfter.x - stageBefore.x) < 1e-6 && Math.abs(stageAfter.y - stageBefore.y) < 1e-6,
    "zoom-out must preserve the stage point under the cursor, got " + JSON.stringify({ stageBefore, stageAfter, v15, v15pre })
  );
  console.log("step15e zoom-out clamp + cursor-centered (stage point preserved):", JSON.stringify({ ...v15, deliveredViewportCursor: cBack, stageBefore, stageAfter }));
  await dragBody("placed-6", { x: 380, y: 230 }, { x: 320, y: 320 });
  s = await waitFor(
    "at 0.25x a body drag of -60,+90 must land exactly",
    (x) => x.placedLed6 !== null && Math.abs(x.placedLed6.x - 310) < 3 && Math.abs(x.placedLed6.y - 310) < 3
  );
  const a025 = await pinOnArt("placed-7", "anode", 25, 42);
  assert(
    Math.abs(a025.dx) < 1 && Math.abs(a025.dy) < 1,
    "at 0.25x the placed-7 anode must still align sub-pixel on its art, got dx=" + a025.dx.toFixed(3) + " dy=" + a025.dy.toFixed(3)
  );
  assert(
    s.placedLed7 && Math.abs(s.placedLed7.x - 1800) < 3 && Math.abs(s.placedLed7.y - 1200) < 3,
    "zoom/pan must never move already-placed components, got " + JSON.stringify(s.placedLed7)
  );
  console.log("step15e zoom-out clamp + 0.25x interactions:", JSON.stringify({ ...v15, placed6: s.placedLed6, placed7: s.placedLed7, align025: a025 }));
  assert(!s.issue, "unexpected issue banner after the pan/zoom step: " + s.issue);

  console.log("ALL BROWSER CHECKS PASSED");
} catch (err) {
  console.error("FAILED: " + err.message);
  process.exitCode = 1;
} finally {
  try {
    ws?.close();
  } catch {}
  edge.kill();
  try {
    rmSync(profile, { recursive: true, force: true });
  } catch {}
  process.exit(process.exitCode ?? 0);
}