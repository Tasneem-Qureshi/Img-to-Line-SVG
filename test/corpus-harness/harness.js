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
function parseTraced(svg, traceW, span, off) {
  const k = (span || 24) / traceW;
  const o0 = off || 0;
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
    const capsAttr = attrs.match(/data-caps="([^"]*)"/);
    const capList = capsAttr ? capsAttr[1].split(' ') : [];
    let subIdx = 0;
    for (const s of SP.parsePathData(dm[1])) {
      s.endCaps = capList[subIdx++] || null; // 'r:b' | 'z:z' | null
      // normalize to 24-space
      for (const seg of s.cmds)
        for (const p of seg.pts) if (p.length === 2) { p[0] = p[0] * k + o0; p[1] = p[1] * k + o0; }
      s.startPt = [s.startPt[0] * k + o0, s.startPt[1] * k + o0];
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
  // all thresholds are defined for the corpus's stroke width 2 and scale
  // with the EXPECTED width (bold renders override stroke-width)
  const EW = o.expectWidth || 2, ws = EW / 2;
  const CL_MEAN = (o.clMean || 0.30) * ws, CL_MAX = (o.clMax || 1.0) * ws;
  const W_TOL = (o.wTol || 0.2) * ws, ANCH = o.anchMult || 1.5;
  const MERGE_SLACK = o.mergeSlack || 0, GAP_MARGIN = (o.gapMargin != null ? o.gapMargin : 0.35) * ws;
  const FAR = 1.0 * ws;
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
    const endUsed = new Set();
    for (let i = 0; i < ends.length; i++)
      for (let j = i + 1; j < ends.length; j++) {
        if ((i >> 1) === (j >> 1)) continue;
        const A = ends[i], B = ends[j];
        if (Math.hypot(A.p[0] - B.p[0], A.p[1] - B.p[1]) > 0.35 * EW) continue;
        const la = Math.hypot(A.d[0], A.d[1]) || 1, lb = Math.hypot(B.d[0], B.d[1]) || 1;
        const cos = (A.d[0] * B.d[0] + A.d[1] * B.d[1]) / (la * lb);
        if (cos < -0.7) { contPairs++; endUsed.add(i); endUsed.add(j); } // continuation
      }
    // an open end can also continue INTO another subpath's ink ALONG its
    // local direction (a bar ending flush on an outline's straight run):
    // the rendered stroke flows straight through — the authored split is
    // unrecoverable from pixels, so merging there is equally legitimate
    for (let i = 0; i < ends.length; i++) {
      if (endUsed.has(i)) continue;
      const E = ends[i];
      const el = Math.hypot(E.d[0], E.d[1]) || 1;
      let counted = false;
      for (const t2 of orig.subpaths) {
        if (counted) break;
        const poly = t2.poly;
        for (let k = 1; k < poly.length - 1; k++) {
          if (Math.hypot(poly[k][0] - E.p[0], poly[k][1] - E.p[1]) > 0.7) continue;
          if (t2 === origLines[i >> 1]) continue; // own subpath
          const dx = poly[k + 1][0] - poly[k - 1][0], dy = poly[k + 1][1] - poly[k - 1][1];
          const dl = Math.hypot(dx, dy) || 1;
          const cos = Math.abs((E.d[0] * dx + E.d[1] * dy) / (el * dl));
          if (cos > 0.85) { contPairs++; counted = true; break; }
        }
      }
    }
  }
  // 2. centerline accuracy (orig -> traced), per-subpath coverage
  let sum = 0, n = 0, mx = 0, missing = 0;
  for (const s of origLines) {
    let far = 0;
    for (const p of s.poly) {
      const d = nearTr(p);
      sum += d; n++; if (d > mx) mx = d;
      if (d > FAR) far++;
    }
    if (far > s.poly.length * 0.3) missing++;
  }
  for (const s of origDots) if (nearTr(s.poly[0]) > 1.2 * ws) missing++;
  let phantom = 0;
  for (const s of trLines.concat(trFills)) {
    let far = 0;
    for (const p of s.poly) if (nearOr(p) > FAR) far++;
    if (far > s.poly.length * 0.3) phantom++;
  }
  for (const s of trDots) if (nearOr(s.poly[0]) > 1.2 * ws) phantom++;
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
    pass: tr.weightsLen === 1 && tr.width != null && Math.abs(tr.width - EW) <= W_TOL };
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
      // "dedicated" counterpart: its endpoints sit at the original's ends
      // (a chain legitimately spanning several originals is never judged)
      const oa = s.poly[0], ob = s.poly[s.poly.length - 1];
      const ta = best.poly[0], tb = best.poly[best.poly.length - 1];
      const near2 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.2;
      const dedicated = (near2(ta, oa) && near2(tb, ob)) || (near2(ta, ob) && near2(tb, oa));
      if (dedicated && !pureLine) straightOk = false;
      if (dedicated && pureLine) {
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
      if (bestP && bestD >= 1.2 * EW && bestD <= 3 * EW) {
        const mid = [(end[0] + bestP[0]) / 2, (end[1] + bestP[1]) / 2];
        if (nearTr(mid) < Math.min(bestD / 2 - GAP_MARGIN, 0.55 * EW)) gapsOk = false;
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
  // 8. fit quality: (a) no two adjacent anchors closer than half the stroke
  // width unless a true corner sits there; (b) no tangent break where the
  // original ink is smooth
  {
    let clusterOk = true, smoothOk = true;
    const origTurnAt = q => {
      // local turn of the ORIGINAL geometry near q (24-space)
      let best = 1e9, sub = null, idx = 0;
      for (const os of orig.subpaths) {
        for (let i = 0; i < os.poly.length; i++) {
          const d = (os.poly[i][0]-q[0])**2 + (os.poly[i][1]-q[1])**2;
          if (d < best) { best = d; sub = os; idx = i; }
        }
      }
      if (!sub || best > 1.44) return Math.PI; // off-ink or at a free end: don't judge
      const n = sub.poly.length;
      const w2 = Math.max(2, Math.round(n * 0.5 / SP.polyLength(sub.poly))); // ~0.5 unit
      const a = sub.poly[Math.max(0, idx - w2)], b = sub.poly[idx],
            c = sub.poly[Math.min(n - 1, idx + w2)];
      let da = Math.atan2(c[1]-b[1], c[0]-b[0]) - Math.atan2(b[1]-a[1], b[0]-a[0]);
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      return Math.abs(da);
    };
    const wHalf = Math.max(0.15, (tr.width || 2) / 2);
    for (const s of trLines) {
      const joints = [];
      for (let i = 0; i + 1 < s.cmds.length; i++) {
        const a = s.cmds[i], b = s.cmds[i + 1];
        const p = a.pts[a.pts.length - 1];
        const d1 = a.c === 'L' ? [p[0]-a.pts[0][0], p[1]-a.pts[0][1]]
          : [p[0]-a.pts[2][0], p[1]-a.pts[2][1]];
        const d2 = b.c === 'L' ? [b.pts[1][0]-p[0], b.pts[1][1]-p[1]]
          : [b.pts[1][0]-p[0], b.pts[1][1]-p[1]];
        const l1 = Math.hypot(d1[0], d1[1]) || 1, l2 = Math.hypot(d2[0], d2[1]) || 1;
        const cos = (d1[0]*d2[0] + d1[1]*d2[1]) / (l1 * l2);
        joints.push({ p, corner: cos < 0.866 }); // >30 deg break
      }
      // clusters — corner-doubling rule: a corner is ONE anchor, so two
      // anchors within half a stroke width fail even AT a corner
      const ap = [s.cmds.length ? s.cmds[0].pts[0] : s.startPt];
      for (const c of s.cmds) ap.push(c.pts[c.pts.length - 1]);
      const lim = s.closed ? ap.length - 1 : ap.length;
      for (let i = 1; i < lim; i++) {
        const g = Math.hypot(ap[i][0]-ap[i-1][0], ap[i][1]-ap[i-1][1]);
        if (g < wHalf) clusterOk = false;
      }
      // smoothness: traced corner where the original is smooth
      for (const j of joints)
        if (j.corner && origTurnAt(j.p) < 0.35) smoothOk = false;
    }
    // overshoot: a traced open end must not extend past the ground-truth
    // centerline endpoint by more than 0.25x width
    let overshootOk = true;
    for (const s of trLines) {
      if (s.closed) continue;
      for (const te of [s.poly[0], s.poly[s.poly.length - 1]]) {
        let best = null, bd = Infinity;
        for (const os of origLines) {
          if (os.closed) continue;
          for (const oe of [{ p: os.poly[0], q: os.poly[Math.min(6, os.poly.length - 1)] },
                            { p: os.poly[os.poly.length - 1], q: os.poly[Math.max(0, os.poly.length - 7)] }]) {
            const d = Math.hypot(te[0] - oe.p[0], te[1] - oe.p[1]);
            if (d < bd) { bd = d; best = oe; }
          }
        }
        if (!best || bd > 1.2 * EW) continue; // unmatched ends are pathCount's problem
        let ux = best.p[0] - best.q[0], uy = best.p[1] - best.q[1];
        const ul = Math.hypot(ux, uy) || 1;
        const over = ((te[0] - best.p[0]) * ux + (te[1] - best.p[1]) * uy) / ul;
        if (over > 0.25 * EW) overshootOk = false;
      }
    }
    // cap type: per-end butt/round must match the original path's linecap
    let capOk = true;
    const wantCap = (orig.cap || 'round')[0];
    for (const s of trLines) {
      if (s.closed || !s.endCaps || s.endCaps === 'z:z') continue;
      for (const cch of s.endCaps.split(':'))
        if (cch !== 'x' && cch !== wantCap) capOk = false;
    }
    M.fitQuality = { clusterOk, smoothOk, overshootOk, capOk,
      pass: clusterOk && smoothOk && overshootOk && capOk };
  }
  // 7. finishing (this corpus: round/round everywhere)
  M.finishing = { cap: tr.cap, join: tr.join,
    pass: (tr.cap === 'round' || tr.cap == null) && (tr.join === 'round' || tr.join == null) };

  if (tr.crossWeight) M.crossWeight = tr.crossWeight;
  M.pass = M.pathCount.pass && M.centerline.pass && M.width.pass &&
           M.anchors.pass && M.grammar.pass && M.topology.pass && M.finishing.pass &&
           M.fitQuality.pass && (!M.crossWeight || M.crossWeight.pass);
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
  const BOLD = flag('bold'); // stroke-width-5 renders of the same originals
  // thresholds are CHECKED IN (test/corpus-harness/thresholds.json): the
  // clean tier for pristine renders, the degraded tier for --degrade runs
  const TH = JSON.parse(fs.readFileSync(path.join(__dirname, 'thresholds.json'), 'utf8'));
  const evalOpts = Object.assign({}, degradeMode ? TH.degraded : TH.clean,
    BOLD ? { expectWidth: 5 } : {});
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
        const key = name + '@' + size + (BOLD ? 'bold' : degradeMode === 'jpeg' ? 'jpeg' : '');
        const render = degradeMode && degradeMode !== 'jpeg'
          ? degrade(loadRender(key), degradeMode)
          : loadRender(key);
        const res = traceRender(render);
        // bold renders use a padded viewBox (-3 -3 30 30) so stroke-5 fits
        tr = BOLD ? parseTraced(res.svg, res.traceW, 30, -3) : parseTraced(res.svg, res.traceW);
        if (BOLD) {
          // cross-weight consistency: same icon, same dots, at any weight —
          // the bold trace must match the THIN trace's geometry and anchors
          const resT = traceRender(loadRender(name + '@' + size));
          const trT = parseTraced(resT.svg, resT.traceW);
          const all = [];
          for (const s of tr.subs) for (const p of s.poly) all.push(p);
          let sum = 0, cnt = 0, mx = 0;
          for (const s of trT.subs)
            for (let i = 0; i < s.poly.length; i += 3) {
              let bd = Infinity;
              for (const q of all) {
                const d = (q[0]-s.poly[i][0])**2 + (q[1]-s.poly[i][1])**2;
                if (d < bd) bd = d;
              }
              bd = Math.sqrt(bd); sum += bd; cnt++; if (bd > mx) mx = bd;
            }
          const nT = trT.subs.reduce((a, s) => a + s.anchors, 0);
          const nB = tr.subs.reduce((a, s) => a + s.anchors, 0);
          tr.crossWeight = {
            mean: cnt ? sum / cnt : 0, max: mx, anchorsThin: nT, anchorsBold: nB,
            pass: (cnt ? sum / cnt : 0) <= 0.30 &&
                  Math.abs(nT - nB) <= Math.max(2, Math.round(nT * 0.25))
          };
        }
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
  const metrics = ['pathCount', 'centerline', 'width', 'anchors', 'grammar', 'topology', 'finishing', 'fitQuality']
    .concat(BOLD ? ['crossWeight'] : []);
  const bySize = {};
  for (const size of sizes) {
    const rs = rows.filter(r => r.size === size);
    const agg = { icons: rs.length, allPass: rs.filter(r => r.M.pass).length };
    for (const m of metrics) agg[m] = rs.filter(r => r.M[m] && r.M[m].pass).length;
    agg.errors = rs.filter(r => r.M.error).length;
    bySize[size] = agg;
  }
  const scorecard = { when: new Date().toISOString(), subset: subset.length, sizes, degrade: degradeMode, bySize };
  const tag = (BOLD ? 'bold' : degradeMode || 'clean') + (all ? '-full' : '');
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
