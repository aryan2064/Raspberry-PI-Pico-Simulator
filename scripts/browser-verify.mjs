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
//  10. StepperMotor: a script drives GPIO4..7 (in1..in4) 8 half-step cycles
//      forward then 8 back (single-bit writes), lands on the exact expected
//      angle/direction, the vendored app-stepper-motor's shadow-DOM arrow
//      sweeps with data-angle, and all six canvas pin markers sit on the
//      element's own pinInfo coordinates (in1..in4, vcc, gnd) sub-pixel.
//  11. No custom-element registration collision: after a reload armed with an
//      error capture, both the package's wokwi-stepper-motor and the vendored
//      app-stepper-motor register and no customElements.define error is thrown.
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
  //         body origin + the element-source pin offset. Before the overlay
  //         scale was fixed, the markers rendered at unscaled offsets and
  //         landed ~30% away from every body. Also proves the vendored web
  //         components upgraded with real shadow-DOM artwork (not bare tags).
  const geo = await evaljs(`(()=>{
    const stage = document.querySelector('[data-testid="circuit-stage"]');
    const sr = stage.getBoundingClientRect();
    const scale = sr.width / 1200;
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
      ledSvg: shadowSvg('body-led', 'wokwi-led'),
      buttonSvg: shadowSvg('body-button', 'wokwi-pushbutton'),
      checks: [
        check('led', 'anode', 25, 42),
        check('led', 'cathode', 15, 42),
        check('button', 'leg1a', 0, 13),
        check('button', 'leg1b', 67, 13),
        check('button', 'leg2a', 0, 32),
        check('button', 'leg2b', 67, 32),
        check('board', 'GPIO0', 21.21, 10.15),
        check('board', 'GPIO15', 325.22, 10.08),
        check('board', 'GPIO16', 21.22, 122.08),
        check('board', 'GPIO28', 229.22, 122.08),
        check('board', '3V3_OUT', 261.22, 122.08),
        check('board', 'GND', 53.22, 122.08),
        check('board', 'GPIO17', 37.22, 122.08),
      ],
    };
  })()`);
  console.log("step1b pin geometry:", JSON.stringify(geo));
  assert(geo.scale < 1, "canvas should be scaled down to fit its container, got scale=" + geo.scale);
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
      s.paletteItems.includes("palette-transistor"),
    "palette should list LED, Button, Relay, and Transistor, got " + s.paletteItems
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
    const toClient = (x, y) => ({ x: r.left + x * (r.width / 1200), y: r.top + y * (r.height / 700) });
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
    const k = r.width / 1200;
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
    const c = { x: r.left + ${stageX} * (r.width / 1200), y: r.top + ${stageY} * (r.height / 700) };
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
    const c = { x: r.left + ${stageX} * (r.width / 1200), y: r.top + ${stageY} * (r.height / 700) };
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
    const scale = sr.width / 1200;
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
    defineErrors: (window.__execErrors||[]).filter((m)=>/define|custom element|app-stepper-motor/i.test(m)),
  }))()`);
  console.log("step11 registration:", JSON.stringify(reg));
  assert(
    reg.pkg && reg.vendored,
    "both wokwi-stepper-motor and app-stepper-motor must be registered, got " + JSON.stringify(reg)
  );
  assert(
    reg.defineErrors.length === 0,
    "no customElements.define console errors allowed, got " + JSON.stringify(reg.defineErrors)
  );

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