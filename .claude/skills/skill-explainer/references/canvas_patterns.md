# Canvas patterns

Four reusable animation recipes for the signature Canvas inside `.telemetry-frame`. **Pick one** that maps to the source skill's domain. Design it carefully. Do not stack two.

If none of the four fits, **omit the Canvas entirely** and lean harder on SVG. A poorly-motivated animation hurts more than no animation.

---

## Shared scaffolding (the skeleton provides this)

All four patterns share:
- A `<canvas id="sig-canvas">` (or rename per skill) inside `.telemetry-frame`.
- Width via CSS (100%), height in CSS at 320–400px.
- DPR-aware resize on `window.resize`.
- `requestAnimationFrame` loop.
- PAUSE/PLAY + 1×/2×/4× speed controls in the frame header.
- Four-cell stats grid below: a SIM TIME (or equivalent) cell + three metric cells.
- `prefers-reduced-motion` skips the animation; render a static keyframe instead.

The skeleton wires up the frame chrome + controls. You write the pattern-specific draw logic.

### Hardcoded color palette inside Canvas

Canvas can't read CSS variables. Use these literals:

```js
const PAL = {
  void:    '#05080F',
  panel:   '#0F1830',
  edge:    '#1F2A48',
  mist300: '#6E81A4',
  mist400: '#44557A',
  cobalt:  '#4A8FE7',
  cyan:    '#6EE0FF',
  frost:   '#B8E5FF',
  mint:    '#7DD3A0',
  ember:   '#FFB55A',
  coral:   '#FF7A7A',
};
```

---

## Pattern A · Timeline sweep

**Domain fit:** schedulers, cron-like processes, anything where "now" moves through queued items.

**Canonical example:** the stratus publisher — posts on a 24h timeline, a "NOW" line sweeps right, posts fire when reached.

**Visual recipe:**
- Horizontal track across most of the canvas width.
- Left edge: a "worker" indicator that pulses on each tick.
- Items as small rounded rectangles at their scheduled time.
- A 2px vertical sweep line with soft glow as "now".
- Items pulse + spawn particles when fired.
- Status colors: pending (cyan), success (mint), failure (coral), warning (ember).
- Hour ticks below, anchor bands above for emphasis.

**Loop behavior:** Compress a period (a day, an hour, a sprint) into ~30–40 s. At end, regenerate a fresh schedule and restart.

**Stats cells:** `SIM TIME · PENDING · SUCCESS · FAILED` (rename to fit).

**Reference implementation:** see the `publisherSim` IIFE in `stratus/.claude/skills/stratus/EXPLAINER.html`.

---

## Pattern B · State machine

**Domain fit:** review queues, approval flows, draft → posted, anything with a small set of named states and discrete transitions.

**Visual recipe:**
- 3–5 circular "state" nodes laid out horizontally or in a soft arc.
- Labels in mono caps (`DRAFT`, `REVIEW`, `APPROVED`, `POSTED`).
- Items (small dots) flow between nodes along curved cobalt paths.
- Each transition: a brief pulse on the destination node.
- Live counts inside each node (current population).

**Loop behavior:** Spawn items on the left at random intervals; each item has a probabilistic forward path. Cull items at the terminal state after a beat.

**Stats cells:** `SIM TIME · IN-FLIGHT · COMPLETED · REJECTED`.

**Skeleton sketch:**

```js
const nodes = [
  { id: 'draft',    x: 0.10, y: 0.5, pop: 0, pulse: 0, label: 'DRAFT'    },
  { id: 'review',   x: 0.35, y: 0.5, pop: 0, pulse: 0, label: 'REVIEW'   },
  { id: 'approved', x: 0.65, y: 0.5, pop: 0, pulse: 0, label: 'APPROVED' },
  { id: 'posted',   x: 0.90, y: 0.5, pop: 0, pulse: 0, label: 'POSTED'   },
];
const edges = [['draft','review'], ['review','approved'], ['review','draft'], ['approved','posted']];
const items = []; // { from, to, t, kind }

function spawn() {
  items.push({ from: 'draft', to: 'review', t: 0, kind: 'standard' });
  nodes[0].pop++;
}
function tick(dt) {
  for (const it of items) {
    it.t += dt * speed * 0.0008;
    if (it.t >= 1) {
      // arrive at destination
      const dst = nodes.find(n => n.id === it.to);
      dst.pulse = 1;
      dst.pop++;
      const src = nodes.find(n => n.id === it.from);
      src.pop = Math.max(0, src.pop - 1);
      // pick next edge or retire
      const next = edges.find(e => e[0] === it.to);
      if (next) { it.from = it.to; it.to = next[1]; it.t = 0; }
      else      { it.retire = true; }
    }
  }
  // cull retired
  for (let i = items.length - 1; i >= 0; i--) if (items[i].retire) items.splice(i, 1);
}
```

---

## Pattern C · Network pulse

**Domain fit:** orchestrators, agent systems, MCP servers, anything with a graph of related nodes.

**Visual recipe:**
- 6–12 nodes laid out using fixed positions or a gentle force-directed drift.
- Edges drawn as thin cobalt lines.
- A pulse fires from one node to another along an edge at irregular intervals.
- Pulses leave brief afterglow on the destination node.
- One node designated as the "core" — slightly larger, cyan-filled.
- Nodes drift with low-amplitude noise so the field never feels static.

**Loop behavior:** Continuous. No reset.

**Stats cells:** `SIM TIME · NODES · ACTIVE EDGES · PULSES/MIN`.

**Skeleton sketch:**

```js
const nodes = Array.from({length: 9}, (_, i) => ({
  x: 0.2 + 0.6 * Math.random(),
  y: 0.2 + 0.6 * Math.random(),
  px: 0, py: 0,
  core: i === 0,
}));
const edges = [[0,1],[0,2],[0,3],[1,4],[2,5],[3,6],[4,7],[5,8],[1,2],[3,5]];
const pulses = []; // { edge, t }

function maybeFire() {
  if (Math.random() < 0.04 * speed) {
    pulses.push({ edge: edges[Math.floor(Math.random()*edges.length)], t: 0 });
  }
}
```

Draw pulses as bright dots interpolated along the edge with `t in [0,1]`. When `t >= 1`, set destination node `pulse = 1` and remove the pulse from the list.

---

## Pattern D · Data stream

**Domain fit:** metrics pipelines, log processors, anything where data flows continuously and is sampled or measured.

**Visual recipe:**
- 3–5 horizontal lanes, each a stream of small data glyphs flowing right-to-left.
- A vertical "sampling" line on the right with a soft gradient.
- As glyphs cross the sampling line, they brighten and contribute to a live count in the stats.
- Optional: a small histogram column on the far right showing density per lane.

**Loop behavior:** Continuous, no reset.

**Stats cells:** `SIM TIME · LANES · SAMPLED · DROPPED`.

**Skeleton sketch:**

```js
const LANES = 4;
const glyphs = []; // { lane, x, kind, sampled }
function spawn() {
  glyphs.push({
    lane: Math.floor(Math.random() * LANES),
    x: W + 10,
    kind: Math.random() < 0.85 ? 'standard' : 'flagged',
    sampled: false,
  });
}
function tick(dt) {
  if (Math.random() < 0.2 * speed) spawn();
  for (const g of glyphs) {
    g.x -= 0.6 * speed;
    if (!g.sampled && g.x < SAMPLE_X) { g.sampled = true; sampledCount++; }
  }
  for (let i = glyphs.length - 1; i >= 0; i--) if (glyphs[i].x < -20) glyphs.splice(i, 1);
}
```

---

## Implementation notes

- One `ctx.setTransform(DPR, 0, 0, DPR, 0, 0)` after every resize. Don't set it per frame.
- Cache strokeStyle / fillStyle outside the hot loop where possible.
- Keep particle counts modest (< 60 alive at a time).
- Inside-canvas text: `'500 9px "JetBrains Mono", monospace'` matches the surrounding type.
- Use `ctx.shadowColor + shadowBlur` only on key live elements (active items, the sweep line). Excessive shadow blur tanks frame rate.
- Use `roundRect` helper for rounded glyphs:

```js
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
```

---

## What not to do

- **No "particle flames" or "matrix rain"** decorative effects. The aesthetic is instrument panel, not screensaver.
- **No scrolling 3D scenes.** No WebGL. No three.js.
- **No clutter.** Fewer animated elements with clear meaning beat a busy field of motion.
- **No Canvas without stats.** It must read as data, not decoration.
- **No music or sound.** Ever.
- **No mouse-following effects.** The Canvas is observed, not played with.
