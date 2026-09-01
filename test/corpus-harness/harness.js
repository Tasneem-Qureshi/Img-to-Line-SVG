// Round-trip harness: render corpus icons -> trace -> compare vs the original
// SVG in 24-unit space. Usage:
//   node test/corpus-harness/harness.js            (stratified subset, all 3 sizes)
//   node test/corpus-harness/harness.js --all      (all 1173 icons)
//   node test/corpus-harness/harness.js --n 60 --sizes 240,480
//   node test/corpus-harness/harness.js --degrade blur|jpeg|down|rot (phase 4)
// Outputs: test/corpus-report/scorecard.json + gallery.html (both gitignored)
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const SP = require('./svgpath.js');

const ROOT = path.join(__dirname, '..', '..');
const CORPUS = path.join(ROOT, 'test', 'corpus-untitled');
const FIX = path.join(ROOT, 'test', 'corpus-fixtures');
const REPORT = path.join(ROOT, 'test', 'corpus-report');

// --- tracer ------------------------------------------------------------------
const html = fs.readFileSync(path.join(ROOT, 'ui.html'), 'utf8');
const shim = { exports: {} };
new Function('module', html.match(/\/\* ===== TRACER-START =====[\s\S]*?TRACER-END ===== \*\//)[0])(shim);
const T = shim.exports;

function loadRender(key) {
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(FIX, key + '.rgba.gz')));
  const w = raw.readUInt32LE(0), h = raw.readUInt32LE(4);
  return { width: w, height: h, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset + 8, w * h * 4) };
}
function bicubicResize(img, W, H) {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(W * H * 4);
  const cr = (p0, p1, p2, p3, t) =>
    p1 + 0.5 * t * (p2 - p0 + t * (2*p0 - 5*p1 + 4*p2 - p3 + t * (3*(p1 - p2) + p3 - p0)));
  const gx = (x, y, ch) => data[(Math.min(h-1, Math.max(0, y)) * w + Math.min(w-1, Math.max(0, x))) * 4 + ch];
  for (let y = 0; y < H; y++) {
    const sy = (y + 0.5) * h / H - 0.5, y0 = Math.floor(sy), fy = sy - y0;
    for (let x = 0; x < W; x++) {
      const sx = (x + 0.5) * w / W - 0.5, x0 = Math.floor(sx), fx = sx - x0;
      for (let ch = 0; ch < 4; ch++) {
        const r = [];
        for (let j = -1; j <= 2; j++)
          r.push(cr(gx(x0-1, y0+j, ch), gx(x0, y0+j, ch), gx(x0+1, y0+j, ch), gx(x0+2, y0+j, ch), fx));
        out[(y * W + x) * 4 + ch] = Math.max(0, Math.min(255, cr(r[0], r[1], r[2], r[3], fy)));
      }
    }
  }
  return { width: W, height: H, data: out };
}
function traceRender(img) {
  const nat = Math.max(img.width, img.height);
  const target = Math.min(2600, Math.max(nat * 2, 1400));
  const up = bicubicResize(img, Math.round(img.width * target / nat), Math.round(img.height * target / nat));
  const traced = T.trace(up, { srcScale: target / nat });
  const r = T.buildSvg(traced.chains, up.width, up.height, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth, ink: traced.ink, stroke: '#111',
    outW: up.width, outH: up.height
  });
  return { svg: r.svg, weights: r.weights, pointCount: r.pointCount, traceW: up.width };
}

// --- traced svg -> normalized subpaths in 24-space ---------------------------
function parseTraced(svg, traceW) {
  const k = 24 / traceW;
  const subs = [];
  let cap = null, join = null, width = null;
  for (const m of svg.matchAll(/<path ([^>]*)\/?>/g)) {
    const attrs = m[1];
    const dm = attrs.match(/\bd="([^"]*)"/);
    if (!dm) continue;
    const isFill = /fill="#/.test(attrs);
    const wm = attrs.match(/stroke-width="([\d.]+)"/);
    if (wm && width == null) width = +wm[1] * k;
    const cm = attrs.match(/stroke-linecap="(\w+)"/);
    if (cm) cap = cap || cm[1];
    const jm = attrs.match(/stroke-linejoin="(\w+)"/);
    if (jm) join = join || jm[1];
    for (const s of SP.parsePathData(dm[1])) {
      // normalize to 24-space
      for (const seg of s.cmds)
        for (const p of seg.pts) if (p.length === 2) { p[0] *= k; p[1] *= k; }
      s.startPt = [s.startPt[0] * k, s.startPt[1] * k];
      s.poly = SP.flattenSubpath(s, 4);
      s.isFill = isFill;
      subs.push(s);
    }
  }
  return { subs, cap, join, width };
}

// --- geometry ----------------------------------------------------------------
function gridIndex(polys) {
  const cell = 0.5, map = new Map();
  const key = (x, y) => ((x + 64) << 12) | (y + 64);
  for (const poly of polys)
    for (const p of poly) {
      const cx = Math.floor(p[0] / cell), cy = Math.floor(p[1] / cell);
      const k = key(cx, cy);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(p);
    }
  return q => {
    const cx = Math.floor(q[0] / 0.5), cy = Math.floor(q[1] / 0.5);
    let best = Infinity;
    for (let r = 0; r <= 8; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const arr = map.get(key(cx + dx, cy + dy));
        if (!arr) continue;
        for (const p of arr) {
          const d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
          if (d < best) best = d;
        }
      }
      if (best < ((r) * 0.5) ** 2) break; // ring guarantee
    }
    return Math.sqrt(best);
  };
}
const isDotSub = s => SP.polyLength(s.poly) < 0.6;

// --- evaluate one icon at one size --------------------------------------------
function evaluate(orig, tr, opts) {
  const o = opts || {};
  const CL_MEAN = o.clMean || 0.30, CL_MAX = o.clMax || 1.0;
  const W_TOL = o.wTol || 0.2, ANCH = o.anchMult || 1.5;
  const MERGE_SLACK = o.mergeSlack || 0, GAP_MARGIN = o.gapMargin != null ? o.gapMargin : 0.35;
  const origLines = orig.subpaths.filter(s => !isDotSub(s));
  const origDots = orig.subpaths.filter(isDotSub);
  const trLines = tr.subs.filter(s => !isDotSub(s) && !s.isFill);
  const trDots = tr.subs.filter(s => isDotSub(s) && !s.isFill);
  const trFills = tr.subs.filter(s => s.isFill);

  const nearTr = gridIndex(tr.subs.map(s => s.poly));
  const nearOr = gridIndex(orig.subpaths.map(s => s.poly));

  const M = {};
  // Ink ambiguity allowance: where an original subpath's END touches another
  // subpath's END and the directions continue tangentially, the rendered ink
  // is one smooth stroke — a tracer merging there is faithful to the pixels
  // even though the author split the path. Count such continuation pairs.
  let contPairs = 0;
  {
    const ends = [];
    for (const s of origLines) {
      if (s.closed) continue;
      const a = s.poly[0], b = s.poly[s.poly.length - 1];
      const dirA = [s.poly[Math.min(4, s.poly.length - 1)][0] - a[0],
                    s.poly[Math.min(4, s.poly.length - 1)][1] - a[1]];
      const dirB = [s.poly[Math.max(0, s.poly.length - 5)][0] - b[0],
                    s.poly[Math.max(0, s.poly.length - 5)][1] - b[1]];
      ends.push({ p: a, d: dirA }, { p: b, d: dirB });
    }
    for (let i = 0; i < ends.length; i++)
      for (let j = i + 1; j < ends.length; j++) {
        if ((i >> 1) === (j >> 1)) continue;
        const A = ends[i], B = ends[j];
        if (Math.hypot(A.p[0] - B.p[0], A.p[1] - B.p[1]) > 0.7) continue;
        const la = Math.hypot(A.d[0], A.d[1]) || 1, lb = Math.hypot(B.d[0], B.d[1]) || 1;
        const cos = (A.d[0] * B.d[0] + A.d[1] * B.d[1]) / (la * lb);
        if (cos < -0.7) contPairs++; // one heads out where the other heads in
      }
  }
  // 2. centerline accuracy (orig -> traced), per-subpath coverage
  let sum = 0, n = 0, mx = 0, missing = 0;
  for (const s of origLines) {
    let far = 0;
    for (const p of s.poly) {
      const d = nearTr(p);
      sum += d; n++; if (d > mx) mx = d;
      if (d > 1.0) far++;
    }
    if (far > s.poly.length * 0.3) missing++;
  }
  for (const s of origDots) if (nearTr(s.poly[0]) > 1.2) missing++;
  let phantom = 0;
  for (const s of trLines.concat(trFills)) {
    let far = 0;
    for (const p of s.poly) if (nearOr(p) > 1.0) far++;
    if (far > s.poly.length * 0.3) phantom++;
  }
  for (const s of trDots) if (nearOr(s.poly[0]) > 1.2) phantom++;
  M.centerline = { mean: sum / (n || 1), max: mx,
    pass: sum / (n || 1) <= CL_MEAN && mx <= CL_MAX };
  // 1. path count
  {
    const d = orig.subpaths.length - tr.subs.length;
    M.pathCount = {
      orig: orig.subpaths.length, traced: tr.subs.length, missing, phantom, contPairs,
      pass: missing === 0 && phantom === 0 && d >= 0 && d <= contPairs + MERGE_SLACK
    };
  }
  // 3. width
  M.width = { traced: tr.width, classes: (tr.weightsLen != null ? tr.weightsLen : 1),
    pass: tr.weightsLen === 1 && tr.width != null && Math.abs(tr.width - 2) <= W_TOL };
  // 4/5. anchors + grammar over matched pairs
  const origAnchors = orig.subpaths.reduce((a, s) => a + (isDotSub(s) ? 1 : s.anchors), 0);
  const trAnchors = tr.subs.reduce((a, s) => a + (isDotSub(s) ? 1 : s.anchors), 0);
  let circleOk = true, straightOk = true, angleOk = true;
  for (const s of origLines) {
    const cls = SP.classifySubpath(s);
    if (cls !== 'circle' && cls !== 'straight') continue;
    // nearest traced subpath by mean sample distance
    let best = null, bestD = Infinity;
    for (const t2 of trLines) {
      const idx = gridIndex([t2.poly]);
      let acc = 0;
      const step = Math.max(1, Math.floor(s.poly.length / 24));
      let cnt = 0;
      for (let i = 0; i < s.poly.length; i += step) { acc += idx(s.poly[i]); cnt++; }
      const d = acc / cnt;
      if (d < bestD) { bestD = d; best = t2; }
    }
    if (!best || bestD > 0.6) continue; // covered by missing-metric
    if (cls === 'circle') {
      if (best.anchors > 5) circleOk = false;
      let cx = 0, cy = 0;
      for (const p of best.poly) { cx += p[0]; cy += p[1]; }
      cx /= best.poly.length; cy /= best.poly.length;
      const rs = best.poly.map(p => Math.hypot(p[0] - cx, p[1] - cy));
      const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
      const cv = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length) / mean;
      if (cv > 0.02) circleOk = false;
    } else if (cls === 'straight') {
      const pureLine = best.cmds.length >= 1 && best.cmds.every(c2 => c2.c === 'L') && best.anchors === 2;
      // a traced subpath may legitimately span several original subpaths
      // (a crossing traced as one continuous stroke) — only flag when the
      // traced counterpart is dedicated to this straight
      const lenRatio = SP.polyLength(best.poly) / Math.max(0.01, SP.polyLength(s.poly));
      if (lenRatio < 1.3 && !pureLine) straightOk = false;
      if (lenRatio < 1.3 && pureLine) {
        const a = best.poly[0], b = best.poly[best.poly.length - 1];
        const oa = s.poly[0], ob = s.poly[s.poly.length - 1];
        const angT = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
        const angO = Math.atan2(ob[1] - oa[1], ob[0] - oa[0]) * 180 / Math.PI;
        const norm = v => ((v % 180) + 180) % 180;
        const gO = norm(angO), gT = norm(angT);
        const near = (v, t2) => Math.abs(v - t2) < 0.9 || Math.abs(v - t2 - 180) < 0.9;
        for (const g of [0, 45, 90, 135])
          if (near(gO, g) && !near(gT, g)) angleOk = false;
      }
    }
  }
  M.anchors = { orig: origAnchors, traced: trAnchors,
    pass: trAnchors <= Math.ceil(origAnchors * ANCH) + (o.anchSlack || 0) };
  M.grammar = { circleOk, straightOk, angleOk, pass: circleOk && straightOk && angleOk };
  // 6. topology
  const oc = origLines.filter(s => s.closed).length, oo = origLines.filter(s => !s.closed).length;
  const tc = trLines.filter(s => s.closed).length + trFills.length, to = trLines.filter(s => !s.closed).length;
  let gapsOk = true;
  for (const s of origLines) {
    if (s.closed) continue;
    for (const end of [s.poly[0], s.poly[s.poly.length - 1]]) {
      let bestD = Infinity, bestP = null;
      for (const t2 of orig.subpaths) {
        if (t2 === s) continue;
        for (const p of t2.poly) {
          const d = Math.hypot(p[0] - end[0], p[1] - end[1]);
          if (d < bestD) { bestD = d; bestP = p; }
        }
      }
      if (bestP && bestD >= 2.4 && bestD <= 6) {
        const mid = [(end[0] + bestP[0]) / 2, (end[1] + bestP[1]) / 2];
        if (nearTr(mid) < Math.min(bestD / 2 - GAP_MARGIN, 1.1)) gapsOk = false;
      }
    }
  }
  {
    // merges of tangent-continuing opens: m2 merges close a ring (open -2,
    // closed +1), m1 merges keep it open (open -1); both bounded by contPairs
    const m2 = tc - oc;
    const m1 = oo - to - 2 * m2;
    const consistent = m2 >= 0 && m1 >= 0 && m1 + m2 <= contPairs + MERGE_SLACK;
    M.topology = { origClosed: oc, tracedClosed: tc, origOpen: oo, tracedOpen: to, gapsOk,
      pass: consistent && gapsOk };
  }
  // 7. finishing (this corpus: round/round everywhere)
  M.finishing = { cap: tr.cap, join: tr.join,
    pass: (tr.cap === 'round' || tr.cap == null) && (tr.join === 'round' || tr.join == null) };

  M.pass = M.pathCount.pass && M.centerline.pass && M.width.pass &&
           M.anchors.pass && M.grammar.pass && M.topology.pass && M.finishing.pass;
  return M;
}

// --- main ---------------------------------------------------------------------
// Phase 4: degrade a render before tracing. Applied in 24-unit-space-agnostic
// raster ops so the same ground truth serves.
function degrade(img, mode) {
  const { width: w, height: h, data } = img;
  if (mode === 'down') { // 2x downscale then 2x nearest re-upscale (detail loss)
    const hw = w >> 1, hh = h >> 1;
    const half = new Uint8ClampedArray(hw * hh * 4);
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++)
      for (let c = 0; c < 4; c++)
        half[(y * hw + x) * 4 + c] = (data[((2*y) * w + 2*x) * 4 + c] + data[((2*y) * w + 2*x+1) * 4 + c] +
          data[((2*y+1) * w + 2*x) * 4 + c] + data[((2*y+1) * w + 2*x+1) * 4 + c]) / 4;
    return { width: hw, height: hh, data: half };
  }
  if (mode === 'blur') { // ~1px gaussian (triple box r=1)
    let cur = { width: w, height: h, data: new Uint8ClampedArray(data) };
    for (let pass = 0; pass < 3; pass++) {
      const out = new Uint8ClampedArray(cur.data.length);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
        for (let c = 0; c < 4; c++) {
          let acc = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const yy = y + dy, xx = x + dx;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h) { acc += cur.data[(yy * w + xx) * 4 + c]; n++; }
          }
          out[(y * w + x) * 4 + c] = acc / n;
        }
      cur = { width: w, height: h, data: out };
    }
    return cur;
  }
  if (mode === 'rot') { // 0.5 degree rotation, bilinear
    const a = 0.5 * Math.PI / 180, cos = Math.cos(a), sin = Math.sin(a);
    const cx = w / 2, cy = h / 2;
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = cos * (x - cx) + sin * (y - cy) + cx;
      const sy = -sin * (x - cx) + cos * (y - cy) + cy;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx - x0, fy = sy - y0;
      if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) continue;
      for (let c = 0; c < 4; c++)
        out[(y * w + x) * 4 + c] =
          data[(y0 * w + x0) * 4 + c] * (1-fx) * (1-fy) + data[(y0 * w + x0+1) * 4 + c] * fx * (1-fy) +
          data[((y0+1) * w + x0) * 4 + c] * (1-fx) * fy + data[((y0+1) * w + x0+1) * 4 + c] * fx * fy;
    }
    return { width: w, height: h, data: out };
  }
  return img;
}

function main() {
  const args = process.argv.slice(2);
  const flag = n => args.includes('--' + n);
  const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
  const sizes = opt('sizes', '96,240,480').split(',').map(Number);
  const all = flag('all');
  const N = +opt('n', 150);
  const degradeMode = opt('degrade', null);
  // thresholds are CHECKED IN (test/corpus-harness/thresholds.json): the
  // clean tier for pristine renders, the degraded tier for --degrade runs
  const TH = JSON.parse(fs.readFileSync(path.join(__dirname, 'thresholds.json'), 'utf8'));
  const evalOpts = degradeMode ? TH.degraded : TH.clean;
  const names = fs.readdirSync(CORPUS).filter(f => f.endsWith('.svg')).map(f => f.replace(/\.svg$/, '')).sort();
  const subset = all ? names : names.filter((_, i) => i % Math.ceil(names.length / N) === 0);
  fs.mkdirSync(REPORT, { recursive: true });

  const rows = [];
  const t0 = Date.now();
  for (const name of subset) {
    const orig = SP.parseIconSvg(fs.readFileSync(path.join(CORPUS, name + '.svg'), 'utf8'));
    for (const sub of orig.subpaths) sub.poly = SP.flattenSubpath(sub, 4);
    for (const size of sizes) {
      let tr, M;
      try {
        const render = degradeMode === 'jpeg'
          ? loadRender(name + '@' + size + 'jpeg')  // pre-rendered JPEG q60 roundtrip (240px only)
          : degradeMode ? degrade(loadRender(name + '@' + size), degradeMode)
          : loadRender(name + '@' + size);
        const res = traceRender(render);
        tr = parseTraced(res.svg, res.traceW);
        tr.weightsLen = res.weights.length;
        tr.pointCount = res.pointCount;
        tr.svg = res.svg; tr.traceW = res.traceW;
        M = evaluate(orig, tr, evalOpts);
      } catch (e) {
        M = { pass: false, error: String(e && e.message || e) };
      }
      rows.push({ name, size, M, svg: M.pass ? null : tr && tr.svg, traceW: tr && tr.traceW });
    }
    if (rows.length % 90 === 0)
      process.stderr.write(`  ${rows.length}/${subset.length * sizes.length} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
  }

  // scorecard
  const metrics = ['pathCount', 'centerline', 'width', 'anchors', 'grammar', 'topology', 'finishing'];
  const bySize = {};
  for (const size of sizes) {
    const rs = rows.filter(r => r.size === size);
    const agg = { icons: rs.length, allPass: rs.filter(r => r.M.pass).length };
    for (const m of metrics) agg[m] = rs.filter(r => r.M[m] && r.M[m].pass).length;
    agg.errors = rs.filter(r => r.M.error).length;
    bySize[size] = agg;
  }
  const scorecard = { when: new Date().toISOString(), subset: subset.length, sizes, degrade: degradeMode, bySize };
  const tag = (degradeMode || 'clean') + (all ? '-full' : '');
  fs.writeFileSync(path.join(REPORT, `scorecard-${tag}.json`),
    JSON.stringify({ scorecard, rows: rows.map(r => ({ name: r.name, size: r.size, M: r.M })) }, null, 1));

  // console table
  console.log(`corpus harness — ${subset.length} icons x [${sizes}]  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  console.log('size  ALL    ' + metrics.map(m => m.slice(0, 7).padEnd(8)).join(''));
  for (const size of sizes) {
    const a = bySize[size];
    const pct = v => (v / a.icons * 100).toFixed(1).padStart(5) + '%';
    console.log(String(size).padEnd(5) + pct(a.allPass) + ' ' +
      metrics.map(m => pct(a[m]).padEnd(8)).join('') + (a.errors ? ` errors:${a.errors}` : ''));
  }

  // worst-10 gallery (by highest fail count then centerline mean)
  const failing = rows.filter(r => !r.M.pass && !r.M.error);
  failing.sort((a, b) => {
    const fa = metrics.filter(m => a.M[m] && !a.M[m].pass).length;
    const fb = metrics.filter(m => b.M[m] && !b.M[m].pass).length;
    return fb - fa || (b.M.centerline ? b.M.centerline.mean : 9) - (a.M.centerline ? a.M.centerline.mean : 9);
  });
  const worst = failing.slice(0, 10);
  let cells = '';
  for (const r of worst) {
    const origSvg = fs.readFileSync(path.join(CORPUS, r.name + '.svg'), 'utf8');
    const fails = metrics.filter(m => r.M[m] && !r.M[m].pass)
      .map(m => `${m}: ${JSON.stringify(r.M[m]).slice(0, 130)}`).join('<br>');
    cells += `<div class="row"><h3>${r.name} @${r.size}px</h3>
      <div class="pair"><figure>${origSvg}<figcaption>original</figcaption></figure>
      <figure>${r.svg || ''}<figcaption>trace</figcaption></figure></div>
      <p class="f">${fails}</p></div>`;
  }
  fs.writeFileSync(path.join(REPORT, `gallery-${tag}.html`), `<!doctype html><meta charset="utf-8">
  <style>body{font:13px sans-serif;background:#fff;color:#111;margin:16px}
  .pair{display:flex;gap:10px} figure{margin:0;border:1px solid #ddd;padding:6px}
  figure svg{width:200px;height:200px;display:block} .f{color:#a33;font-size:11px;max-width:640px}
  h3{margin:18px 0 6px}</style><h1>Worst failures</h1>` + cells);
  return scorecard;
}
if (require.main === module) main();
module.exports = { evaluate, parseTraced, traceRender, loadRender };
