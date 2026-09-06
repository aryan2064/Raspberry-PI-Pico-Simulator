// Headless-browser integration verification of the whole Pyodide-worker flow —
// the checks that jsdom cannot do (real Web Worker + Pyodide + real React).
//
//   Usage:  node scripts/browser-verify.mjs <url> [edgePath]
//
// Requires Microsoft Edge (default path below) and Node >= 22 (global WebSocket).
// Drives the page over the Chrome DevTools Protocol:
//   1. Canvas renders board/LEDs/button + all five demo wires on load.
//   2. Press/release of the button lights LED1 via worker relay.
//   3. Run executes the default script -> LED2 visibly blinks then stays on.
//   4. Run a while True loop, Stop it -> wiring reappears, button still works.
//   5. Palette: drop a new LED, wire it, drag it, Stop -> the placed part and
//      its wire survive the worker replay at the dragged position.
//   6. Delete: select -> Delete button / Delete key / editor-focus guard /
//      Board exemption; deleted parts never reappear after Stop.
//   7. Conflict: wiring two OUT pins (board 3V3 <-> GND) flags the affected
//      wires red/dashed + a conflict banner; unwiring clears both.
//   8. Non-blocking sleep (JSPI): during a time.sleep() blink script the button
//      relay still lights LED1 promptly (worker event loop free mid-sleep) and
//      the script still completes.
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

const parseTransform = (t) => {
  const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(t ?? "");
  return m ? { x: +m[1], y: +m[2] } : null;
};

const state = () =>
  evaljs(`(async()=>{
      const q = (s) => document.querySelector(s);
      const qa = (s) => [...document.querySelectorAll(s)];
      return {
        wires: qa('[data-testid^="wire-"]').map((el) => el.getAttribute('data-testid')).sort(),
        boards: qa('[data-testid="pico-board"]').length,
        leds: qa('[data-testid="led-body"]').map((el) => el.getAttribute('data-on')),
        pressed: q('[data-testid="button-body"]')?.getAttribute('data-pressed') ?? null,
        pins: qa('[data-testid^="pin-"]').length,
        issue: q('[data-testid="worker-issue"]')?.textContent ?? null,
        paletteItems: qa('[data-testid^="palette-"]').map((el) => el.getAttribute('data-testid')).sort(),
        placedLed: q('[data-testid="body-placed-1"] > g[data-testid="led"]')?.getAttribute('transform') ?? null,
        placed2: q('[data-testid="body-placed-2"] > g[data-testid="led"]')?.getAttribute('transform') ?? null,
        placed3: q('[data-testid="body-placed-3"] > g[data-testid="led"]')?.getAttribute('transform') ?? null,
        placedBodies: qa('[data-testid^="body-placed-"]').length,
        deleteButton: q('[data-testid="delete-component"]')?.textContent ?? null,
        wire6: (() => {
          const g = q('[data-testid="wire-w6"]');
          if (!g) return null;
          const l = g.querySelectorAll('line')[1] ?? g.querySelector('line');
          return l ? { x1: +l.getAttribute('x1'), y1: +l.getAttribute('y1'), x2: +l.getAttribute('x2'), y2: +l.getAttribute('y2') } : null;
        })(),
        conflictBanner: q('[data-testid="conflict-banner"]')?.textContent ?? null,
        conflictedWires: qa('[data-testid^="wire-"][data-conflicted="true"]')
          .map((el) => el.getAttribute('data-testid')).sort(),
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
  assert(s.pins >= 10, "pins should render");
  assert(
    s.wires.join(",") === ["wire-w1", "wire-w2", "wire-w3", "wire-w4", "wire-w5"].join(","),
    "expected demo wires wire-w1..wire-w5, got " + s.wires
  );
  assert(!s.issue, "unexpected worker issue banner: " + s.issue);

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

  await evaljs(
    `(()=>{ document.querySelector('[data-testid="button-body"]')
       .dispatchEvent(new MouseEvent('mouseup',{bubbles:true})); return true; })()`
  );
  s = await waitFor(
    "release should turn LED1 off",
    (x) => x.leds[0] === "false" && x.pressed === "false"
  );
  console.log("step2 released OK:", JSON.stringify(s));

  // ---- 3. Run the default script: LED2 blinks (0.5s) then stays on ----
  await evaljs(
    `(()=>{ [...document.querySelectorAll('button')]
       .find((x)=>x.textContent.trim()==='Run').click(); return true; })()`
  );
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
    (x) => x.boards === 1 && x.wires.length === 5 && x.leds[1] === "false"
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
    s.paletteItems.includes("palette-led") && s.paletteItems.includes("palette-button"),
    "palette should list LED and Button, got " + s.paletteItems
  );
  assert(
    !s.paletteItems.includes("palette-pico_board"),
    "palette must not offer a second board"
  );

  // Convert a desired SVG point into client coords so the app's own screen->SVG
  // inverse maps the drop back to (900,200).
  await evaljs(`(()=>{
    const svg = document.querySelector('[data-testid="circuit-canvas"]');
    const dt = new DataTransfer();
    dt.setData('application/x-pico-component', 'led');
    const p = svg.createSVGPoint(); p.x = 900; p.y = 200;
    const c = p.matrixTransform(svg.getScreenCTM());
    svg.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, dataTransfer: dt,
    }));
    return true;
  })()`);
  s = await waitFor(
    "dropped palette LED should render as placed-1",
    (x) => x.placedLed !== null && x.placedLed.includes("translate")
  );
  console.log("step5 placed:", JSON.stringify(s));
  let placedPos = parseTransform(s.placedLed);
  assert(
    placedPos && Math.abs(placedPos.x - 900) < 5 && Math.abs(placedPos.y - 200) < 5,
    "placed LED should land near the drop point, got " + s.placedLed
  );

  // Wire the placed LED to a free board pin through the usual pin-click flow.
  // Each click must be its own task: React flushes the pending-pin state
  // between events (last state is read by the next click's handler).
  await evaljs(`(()=>{ const e = document.querySelector('[data-testid="pin-placed-1-anode"]'); e.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  await sleep(100);
  await evaljs(`(()=>{ const e = document.querySelector('[data-testid="pin-board-GPIO17"]'); e.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  s = await waitFor(
    "placed LED should be wired as wire-w6",
    (x) => x.wires.includes("wire-w6")
  );
  const wire6Before = s.wire6;
  assert(wire6Before, "wire-w6 should have renderable endpoints");

  // Drag the placed LED's body 150 units right and down; the wire endpoints
  // must follow. The handler adds raw client deltas to the SVG-space start
  // position, so the new transform is exactly start + client delta.
  const drag = await evaljs(`(()=>{
    const svg = document.querySelector('[data-testid="circuit-canvas"]');
    const body = document.querySelector('[data-testid="body-placed-1"]');
    const toClient = (x, y) => { const p = svg.createSVGPoint(); p.x = x; p.y = y; const c = p.matrixTransform(svg.getScreenCTM()); return { x: c.x, y: c.y }; };
    const a = toClient(900, 200);
    const b = toClient(1050, 350);
    body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: a.x, clientY: a.y, button: 0, pointerId: 7, pointerType: 'mouse', pointercancel: true }));
    svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: b.x, clientY: b.y, pointerId: 7, button: 0 }));
    svg.dispatchEvent(new PointerEvent('pointerup',   { bubbles: true, clientX: b.x, clientY: b.y, pointerId: 7, button: 0 }));
    return { dx: b.x - a.x, dy: b.y - a.y };
  })()`);
  s = await waitFor(
    "placed LED should end at the dragged position",
    (x) => {
      const p = parseTransform(x.placedLed);
      return (
        p &&
        Math.abs(p.x - (900 + drag.dx)) < 3 &&
        Math.abs(p.y - (200 + drag.dy)) < 3
      );
    }
  );
  console.log("step5 dragged:", JSON.stringify(s));
  assert(
    s.wire6 &&
      Math.abs(s.wire6.x1 - wire6Before.x1 - drag.dx) < 3 &&
      Math.abs(s.wire6.y1 - wire6Before.y1 - drag.dy) < 3,
    "wire-w6 endpoint should follow the dragged LED"
  );

  // Stop must replay the whole topology into a fresh worker — including the
  // placed LED and its wire — while the dragged position (UI state) persists.
  await evaljs(
    `(()=>{ [...document.querySelectorAll('button')]
       .find((x)=>x.textContent.trim()==='Stop').click(); return true; })()`
  );
  s = await waitFor(
    "placed LED + its wire should survive Stop",
    (x) => {
      const p = parseTransform(x.placedLed);
      return (
        x.boards === 1 &&
        x.wires.includes("wire-w6") &&
        x.wires.length >= 6 &&
        p !== null &&
        Math.abs(p.x - (900 + drag.dx)) < 3 &&
        Math.abs(p.y - (200 + drag.dy)) < 3
      );
    }
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
    (x) => x.placedLed === null && !x.wires.includes("wire-w6") && x.placedBodies === 0
  );
  assert(s.pins >= 36, "pins should drop back to the demo count after deletion, got " + s.pins);
  console.log("step6b deleted via button:", JSON.stringify(s));

  const dropLedAt = (svgX, svgY) => evaljs(`(()=>{
    const svg = document.querySelector('[data-testid="circuit-canvas"]');
    const dt = new DataTransfer();
    dt.setData('application/x-pico-component', 'led');
    const p = svg.createSVGPoint(); p.x = ${svgX}; p.y = ${svgY};
    const c = p.matrixTransform(svg.getScreenCTM());
    svg.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientX: c.x, clientY: c.y, dataTransfer: dt }));
    return true;
  })()`);

  // 6c — place a second LED, wire it, select it, delete via the Delete key.
  await dropLedAt(900, 200);
  s = await waitFor("second placed LED should render as placed-2", (x) => x.placed2 !== null);
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-placed-2-anode"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  await sleep(100);
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-board-GPIO18"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  s = await waitFor("placed-2 should be wired as wire-w7", (x) => x.wires.includes("wire-w7"));
  await select('body-placed-2');
  s = await waitFor("selecting placed-2 should reveal the Delete button", (x) => x.deleteButton !== null);
  await evaljs(`(()=>{ window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true })); return true; })()`);
  s = await waitFor(
    "Delete key should remove placed-2 and wire-w7",
    (x) => x.placed2 === null && !x.wires.includes("wire-w7")
  );
  console.log("step6c deleted via key:", JSON.stringify(s));

  // 6d — Backspace while the code editor has focus must NOT delete (the
  // selection and the component both survive); once focus leaves, it does.
  await dropLedAt(900, 200);
  s = await waitFor("third placed LED should render as placed-3", (x) => x.placed3 !== null);
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-placed-3-anode"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  await sleep(100);
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-board-GPIO19"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  s = await waitFor("placed-3 should be wired as wire-w8", (x) => x.wires.includes("wire-w8"));
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
  assert(s.wires.includes("wire-w8"), "wire-w8 must survive editor Backspace");
  assert(s.deleteButton !== null, "selection must survive editor Backspace");
  await evaljs(`(()=>{ document.activeElement?.blur?.(); return true; })()`);
  await evaljs(`(()=>{ window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })); return true; })()`);
  s = await waitFor(
    "Backspace on the body should remove placed-3 and wire-w8",
    (x) => x.placed3 === null && !x.wires.includes("wire-w8")
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
      x.wires.length === 5 &&
      x.wires.every((w) => w.includes("wire-w")) &&
      x.placedLed === null &&
      x.placed2 === null &&
      x.placed3 === null &&
      x.placedBodies === 0
  );
  console.log("step6e after stop (deleted stay gone):", JSON.stringify(s));
  assert(!s.issue, "unexpected issue banner after delete/Stop: " + s.issue);

  // ---- 7. Conflict detection: two OUT pins wired together flag the affected
  //         wires (red, dashed) and show a warning banner; unwiring clears
  //         both. board.3V3 (OUT HIGH) <-> board.GND (OUT LOW) needs no Python
  //         to be a genuine two-driver short-circuit.
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-board-3V3"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  await sleep(100);
  await evaljs(`(()=>{ document.querySelector('[data-testid="pin-board-GND"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  s = await waitFor(
    "wiring 3V3 to GND should flag conflicted wires and show the banner",
    (x) =>
      x.wires.includes("wire-w9") &&
      x.conflictBanner !== null &&
      x.conflictedWires.length > 0
  );
  assert(
    s.conflictedWires.join(",") === ["wire-w3", "wire-w5", "wire-w9"].join(","),
    "expected wires w3/w5/w9 on the shorted net to be flagged, got " + s.conflictedWires
  );
  assert(
    s.conflictBanner.includes("3 wire conflicts"),
    "expected the banner to count 3 conflicted wires, got " + s.conflictBanner
  );
  console.log("step7 conflicted:", JSON.stringify(s));

  // The conflicted wire is visibly a warning (red + dashed), unlike normal wires.
  const w9Style = await evaljs(`(()=>{
    const g = document.querySelector('[data-testid="wire-w9"]');
    const l = g?.querySelectorAll('line')[1];
    return l ? { stroke: l.getAttribute('stroke'), dash: l.getAttribute('stroke-dasharray') } : null;
  })()`);
  assert(
    w9Style && w9Style.stroke === "#d81b1b" && w9Style.dash === "8 5",
    "conflicted wire should be red/dashed, got " + JSON.stringify(w9Style)
  );

  // Remove the short by clicking the conflicted wire: conflict resolves, the
  // banner disappears and every wire returns to its normal style.
  await evaljs(`(()=>{ document.querySelector('[data-testid="wire-w9"]').dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`);
  s = await waitFor(
    "removing the short should clear the banner and restore the wires",
    (x) => !x.wires.includes("wire-w9") && x.conflictBanner === null && x.conflictedWires.length === 0
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
    setter.call(ta, 'import machine, time\\n\\nled = machine.Pin(16, machine.Pin.OUT)\\nfor _ in range(5):\\n    led.value(1)\\n    time.sleep(0.5)\\n    led.value(0)\\n    time.sleep(0.5)\\nled.value(1)\\n');
    ta.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`);
  await evaljs(
    `(()=>{ [...document.querySelectorAll('button')]
       .find((x)=>x.textContent.trim()==='Run').click(); return true; })()`
  );
  await waitFor("blink script should start (LED2 first on)", (x) => x.leds[1] === "true");
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
  s = await state();
  assert(!s.issue, "unexpected issue banner after step8: " + s.issue);
  console.log("step8 non-blocking sleep OK:", JSON.stringify(s));

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