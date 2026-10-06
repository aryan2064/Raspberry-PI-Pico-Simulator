// Centroid probe: locate the exact drawn connection metal for the DFRobot
// relay module — the 3 light-grey header pads (right) and the 4 dark screw
// eyes (left) — as area-weighted pixel centroids. This is the ground truth
// that browser-verify will re-check against the served asset.
//   Usage: node scripts/measure-dfrobot.mjs <path-to-svg>
import { spawn } from "node:child_process";
import { readFileSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const EDGE =
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const svgPath = process.argv[2];
const svg = readFileSync(svgPath, "utf8");
const profile = join(process.env.TEMP ?? ".", "opencode", `edge-centroid-${Date.now()}`);
mkdirSync(profile, { recursive: true });
const edge = spawn(EDGE, ["--headless=new", "--disable-gpu", "--remote-debugging-port=0",
  "--user-data-dir=" + profile, "--window-size=1600,1600", "about:blank"]);
edge.stderr.on("data", () => {});
const wsUrl = await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error("no devtools port")), 30000);
  edge.stderr.on("data", (b) => { const m = /ws:\/\/[^\s]+/.exec(String(b)); if (m) { clearTimeout(t); res(m[0]); } });
});
const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener("open", r));
let msgId = 0, sessionId = null;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result); pending.delete(m.id); }
});
const send = (method, params = {}) => new Promise((res) => {
  const id = ++msgId; pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
const evaljs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r?.exceptionDetails) throw new Error("eval failed: " + JSON.stringify(r.exceptionDetails));
  return r?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { targetId } = await send("Target.createTarget", { url: "about:blank" });
sessionId = (await send("Target.attachToTarget", { targetId, flatten: true })).sessionId;
await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: "about:blank" });
await sleep(600);
await evaljs(`(()=>{document.body.innerHTML=${JSON.stringify(svg)};return 1;})()`);
await sleep(300);

const out = await evaljs(`(async () => {
  const svgEl = document.querySelector('svg');
  const W = Number(svgEl.getAttribute('width')), H = Number(svgEl.getAttribute('height'));
  const url = URL.createObjectURL(new Blob([${JSON.stringify(svg)}], { type: 'image/svg+xml' }));
  const img = new Image(); img.src = url; await img.decode();
  const S = 4.0;                       // 4 samples per user unit
  const c = document.createElement('canvas');
  c.width = Math.round(W * S); c.height = Math.round(H * S);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(img, 0, 0, c.width, c.height);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  const centroid = (x0, y0, x1, y1, isTarget) => {
    let sx = 0, sy = 0, n = 0;
    for (let py = Math.round(y0 * S); py <= Math.round(y1 * S); py++) {
      for (let px = Math.round(x0 * S); px <= Math.round(x1 * S); px++) {
        const i = (py * c.width + px) * 4;
        const r = d[i], gg = d[i + 1], b = d[i + 2];
        if (isTarget(r, gg, b)) { sx += px / S; sy += py / S; n++; }
      }
    }
    return n ? { x: +(sx / n).toFixed(3), y: +(sy / n).toFixed(3), n } : null;
  };
  const lightGrey = (r, gg, b) => Math.abs(r - 236) <= 12 && Math.abs(gg - 236) <= 12 && Math.abs(b - 236) <= 12;
  const dark = (r, gg, b) => Math.abs(r - 56) <= 30 && Math.abs(gg - 56) <= 30 && Math.abs(b - 56) <= 30;
  return {
    board: { x0: 211, y0: 566, x1: 335, y1: 672.5 },
    headerAHdr: { /* around the 3 header pins, x 300-320 */ search: [300, 606, 320, 630] },
    headerA: centroid(300, 608, 316, 615, lightGrey),
    headerB: centroid(300, 616, 316, 623, lightGrey),
    headerC: centroid(300, 624, 316, 631, lightGrey),
    // screw eyes: dark #383838 eyes around each terminal, x 219-229
    nc: centroid(219, 602, 229, 610, dark),
    no: centroid(219, 613, 229, 621, dark),
    na: centroid(219, 624, 229, 632, dark),
    com: centroid(219, 635, 229, 643, dark),
  };
})()`);

console.log(JSON.stringify(out, null, 1));
ws.close(); edge.kill(); await sleep(400);
try { rmSync(profile, { recursive: true, force: true }); } catch {}
process.exit(0);