// Minimal-but-complete SVG geometry kit for the icon corpus harness.
// Parses path data (M L H V C S Q T A Z, absolute + relative), converts
// primitives (<circle>/<rect>/<line>/<ellipse>) to subpaths, and flattens
// everything to polylines for metric comparison. Pure functions, no deps.
'use strict';

// --- path data -> subpaths [{closed, cmds:[{c, pts}], anchors, poly}] ------
function parsePathData(d) {
  const tokens = d.match(/[MmLlHhVvCcSsQqTtAaZz]|-?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi) || [];
  let i = 0;
  const num = () => +tokens[i++];
  const subpaths = [];
  let cur = [0, 0], start = [0, 0], sub = null, prevCmd = '', prevCtrl = null;
  const open = p => { sub = { closed: false, cmds: [], startPt: p.slice() }; subpaths.push(sub); };
  const seg = (c, pts) => sub.cmds.push({ c, pts });
  while (i < tokens.length) {
    let t = tokens[i];
    let cmd;
    if (/^[A-Za-z]$/.test(t)) { cmd = t; i++; }
    else cmd = prevCmd === 'M' ? 'L' : prevCmd === 'm' ? 'l' : prevCmd; // implicit repeats
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'M') {
      const x = num(), y = num();
      cur = rel && subpaths.length ? [cur[0] + x, cur[1] + y] : rel && sub ? [cur[0] + x, cur[1] + y] : rel ? [x, y] : [x, y];
      if (rel && !subpaths.length) cur = [x, y];
      start = cur.slice();
      open(cur);
      prevCmd = cmd; prevCtrl = null;
      continue;
    }
    if (!sub) open(cur);
    if (C === 'Z') {
      sub.closed = true;
      if (Math.hypot(cur[0] - start[0], cur[1] - start[1]) > 1e-9)
        seg('L', [cur.slice(), start.slice()]);
      cur = start.slice();
      prevCmd = cmd; prevCtrl = null;
      continue;
    }
    if (C === 'L') {
      const x = num(), y = num();
      const p = rel ? [cur[0] + x, cur[1] + y] : [x, y];
      seg('L', [cur.slice(), p]); cur = p; prevCtrl = null;
    } else if (C === 'H') {
      const x = num();
      const p = [rel ? cur[0] + x : x, cur[1]];
      seg('L', [cur.slice(), p]); cur = p; prevCtrl = null;
    } else if (C === 'V') {
      const y = num();
      const p = [cur[0], rel ? cur[1] + y : y];
      seg('L', [cur.slice(), p]); cur = p; prevCtrl = null;
    } else if (C === 'C') {
      const c1 = [num(), num()], c2 = [num(), num()], p = [num(), num()];
      if (rel) { c1[0] += cur[0]; c1[1] += cur[1]; c2[0] += cur[0]; c2[1] += cur[1]; p[0] += cur[0]; p[1] += cur[1]; }
      seg('C', [cur.slice(), c1, c2, p]); prevCtrl = c2; cur = p;
    } else if (C === 'S') {
      const c2 = [num(), num()], p = [num(), num()];
      if (rel) { c2[0] += cur[0]; c2[1] += cur[1]; p[0] += cur[0]; p[1] += cur[1]; }
      const c1 = prevCtrl && /[CS]/i.test(prevCmd)
        ? [2 * cur[0] - prevCtrl[0], 2 * cur[1] - prevCtrl[1]] : cur.slice();
      seg('C', [cur.slice(), c1, c2, p]); prevCtrl = c2; cur = p;
    } else if (C === 'Q') {
      const q = [num(), num()], p = [num(), num()];
      if (rel) { q[0] += cur[0]; q[1] += cur[1]; p[0] += cur[0]; p[1] += cur[1]; }
      seg('Q', [cur.slice(), q, p]); prevCtrl = q; cur = p;
    } else if (C === 'T') {
      const p = [num(), num()];
      if (rel) { p[0] += cur[0]; p[1] += cur[1]; }
      const q = prevCtrl && /[QT]/i.test(prevCmd)
        ? [2 * cur[0] - prevCtrl[0], 2 * cur[1] - prevCtrl[1]] : cur.slice();
      seg('Q', [cur.slice(), q, p]); prevCtrl = q; cur = p;
    } else if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), laf = num(), swf = num();
      const x = num(), y = num();
      const p = rel ? [cur[0] + x, cur[1] + y] : [x, y];
      seg('A', [cur.slice(), [rx, ry, rot, laf, swf], p]); cur = p; prevCtrl = null;
    } else {
      i++; // unknown, skip token
    }
    prevCmd = cmd;
  }
  for (const s of subpaths) {
    s.anchors = countAnchors(s);
    s.poly = flattenSubpath(s);
  }
  return subpaths;
}

function countAnchors(sub) {
  // pen-tool anchors: start point + one per segment end; closed paths do not
  // double-count the seam
  let n = 1 + sub.cmds.length;
  if (sub.closed) n -= 1;
  return Math.max(1, n);
}

function sampleArc(p0, [rx, ry, rot, laf, swf], p1, out) {
  // endpoint -> center parameterization (SVG spec appendix B)
  rx = Math.abs(rx); ry = Math.abs(ry);
  if (rx < 1e-9 || ry < 1e-9) { out.push(p1); return; }
  const phi = rot * Math.PI / 180, cosP = Math.cos(phi), sinP = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2, dy = (p0[1] - p1[1]) / 2;
  const x1 = cosP * dx + sinP * dy, y1 = -sinP * dx + cosP * dy;
  const L = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (L > 1) { rx *= Math.sqrt(L); ry *= Math.sqrt(L); }
  let sq = ((rx * rx * ry * ry) - (rx * rx * y1 * y1) - (ry * ry * x1 * x1)) /
           ((rx * rx * y1 * y1) + (ry * ry * x1 * x1));
  sq = Math.max(0, sq);
  let co = Math.sqrt(sq);
  if (laf === swf) co = -co;
  const cxp = co * rx * y1 / ry, cyp = -co * ry * x1 / rx;
  const cx = cosP * cxp - sinP * cyp + (p0[0] + p1[0]) / 2;
  const cy = sinP * cxp + cosP * cyp + (p0[1] + p1[1]) / 2;
  const ang = (ux, uy, vx, vy) => {
    const s = Math.sign(ux * vy - uy * vx) || 1;
    return s * Math.acos(Math.max(-1, Math.min(1,
      (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)))));
  };
  const th1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dth = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!swf && dth > 0) dth -= 2 * Math.PI;
  if (swf && dth < 0) dth += 2 * Math.PI;
  const steps = Math.max(8, Math.ceil(Math.abs(dth) * Math.max(rx, ry)));
  for (let s = 1; s <= steps; s++) {
    const th = th1 + dth * s / steps;
    const x = cx + rx * Math.cos(th) * cosP - ry * Math.sin(th) * sinP;
    const y = cy + rx * Math.cos(th) * sinP + ry * Math.sin(th) * cosP;
    out.push([x, y]);
  }
}

function flattenSubpath(sub, density) {
  const D = density || 1; // ~1 sample per unit length
  const poly = [];
  if (!sub.cmds.length) { poly.push(sub.startPt.slice()); return poly; }
  poly.push(sub.cmds[0].pts[0].slice());
  for (const seg of sub.cmds) {
    if (seg.c === 'L') {
      const [a, b] = seg.pts;
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * D));
      for (let s = 1; s <= n; s++) poly.push([a[0] + (b[0] - a[0]) * s / n, a[1] + (b[1] - a[1]) * s / n]);
    } else if (seg.c === 'C') {
      const [p0, c1, c2, p3] = seg.pts;
      const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]) +
        Math.hypot(c1[0] - p0[0], c1[1] - p0[1]) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]);
      const n = Math.max(4, Math.ceil(chord * D));
      for (let s = 1; s <= n; s++) {
        const u = s / n, q = 1 - u;
        poly.push([
          q*q*q*p0[0] + 3*q*q*u*c1[0] + 3*q*u*u*c2[0] + u*u*u*p3[0],
          q*q*q*p0[1] + 3*q*q*u*c1[1] + 3*q*u*u*c2[1] + u*u*u*p3[1]
        ]);
      }
    } else if (seg.c === 'Q') {
      const [p0, q1, p2] = seg.pts;
      const n = Math.max(4, Math.ceil((Math.hypot(q1[0]-p0[0], q1[1]-p0[1]) + Math.hypot(p2[0]-q1[0], p2[1]-q1[1])) * D));
      for (let s = 1; s <= n; s++) {
        const u = s / n, q = 1 - u;
        poly.push([q*q*p0[0] + 2*q*u*q1[0] + u*u*p2[0], q*q*p0[1] + 2*q*u*q1[1] + u*u*p2[1]]);
      }
    } else if (seg.c === 'A') {
      sampleArc(seg.pts[0], seg.pts[1], seg.pts[2], poly);
    }
  }
  return poly;
}

// --- svg text -> {strokeWidth, cap, join, viewBox, subpaths[]} --------------
function parseIconSvg(svg) {
  const vb = svg.match(/viewBox="([\d.\s-]+)"/);
  const viewBox = vb ? vb[1].trim().split(/\s+/).map(Number) : [0, 0, 24, 24];
  const sw = [...svg.matchAll(/stroke-width="([\d.]+)"/g)].map(m => +m[1]);
  const caps = [...svg.matchAll(/stroke-linecap="(\w+)"/g)].map(m => m[1]);
  const joins = [...svg.matchAll(/stroke-linejoin="(\w+)"/g)].map(m => m[1]);
  const subpaths = [];
  const prims = { path: 0, circle: 0, rect: 0, line: 0, ellipse: 0 };
  for (const m of svg.matchAll(/<path[^>]*\sd="([^"]+)"[^>]*>/g)) {
    prims.path++;
    for (const s of parsePathData(m[1])) subpaths.push(s);
  }
  const K = 0.5522847498;
  for (const m of svg.matchAll(/<circle[^>]*>/g)) {
    prims.circle++;
    const at = n => { const r = m[0].match(new RegExp(n + '="([\\d.-]+)"')); return r ? +r[1] : 0; };
    const cx = at('cx'), cy = at('cy'), r = at('r');
    const d = `M${cx + r} ${cy} C${cx + r} ${cy + K * r} ${cx + K * r} ${cy + r} ${cx} ${cy + r} ` +
      `C${cx - K * r} ${cy + r} ${cx - r} ${cy + K * r} ${cx - r} ${cy} ` +
      `C${cx - r} ${cy - K * r} ${cx - K * r} ${cy - r} ${cx} ${cy - r} ` +
      `C${cx + K * r} ${cy - r} ${cx + r} ${cy - K * r} ${cx + r} ${cy} Z`;
    for (const s of parsePathData(d)) { s.isCirclePrim = true; subpaths.push(s); }
  }
  for (const m of svg.matchAll(/<rect[^>]*>/g)) {
    prims.rect++;
    const at = (n, d0) => { const r = m[0].match(new RegExp('\\b' + n + '="([\\d.-]+)"')); return r ? +r[1] : d0; };
    const x = at('x', 0), y = at('y', 0), w = at('width', 0), h = at('height', 0), rx = at('rx', 0);
    let d;
    if (rx > 0) {
      d = `M${x + rx} ${y} H${x + w - rx} A${rx} ${rx} 0 0 1 ${x + w} ${y + rx} V${y + h - rx} ` +
          `A${rx} ${rx} 0 0 1 ${x + w - rx} ${y + h} H${x + rx} A${rx} ${rx} 0 0 1 ${x} ${y + h - rx} ` +
          `V${y + rx} A${rx} ${rx} 0 0 1 ${x + rx} ${y} Z`;
    } else {
      d = `M${x} ${y} H${x + w} V${y + h} H${x} Z`;
    }
    for (const s of parsePathData(d)) { s.isRectPrim = true; subpaths.push(s); }
  }
  for (const m of svg.matchAll(/<line[^>]*>/g)) {
    prims.line++;
    const at = n => { const r = m[0].match(new RegExp(n + '="([\\d.-]+)"')); return r ? +r[1] : 0; };
    for (const s of parsePathData(`M${at('x1')} ${at('y1')} L${at('x2')} ${at('y2')}`)) subpaths.push(s);
  }
  return {
    viewBox,
    strokeWidth: sw.length ? sw[0] : null,
    strokeWidths: [...new Set(sw)],
    cap: caps[0] || null, caps: [...new Set(caps)],
    join: joins[0] || null, joins: [...new Set(joins)],
    fillNone: /fill="none"/.test(svg),
    prims, subpaths
  };
}

// --- geometry helpers -------------------------------------------------------
function polyLength(poly) {
  let L = 0;
  for (let i = 1; i < poly.length; i++) L += Math.hypot(poly[i][0] - poly[i-1][0], poly[i][1] - poly[i-1][1]);
  return L;
}
function classifySubpath(sub) {
  const poly = sub.poly;
  const len = polyLength(poly);
  if (len < 0.2) return 'dot';
  const allLines = sub.cmds.every(s => s.c === 'L');
  if (allLines && !sub.closed) {
    // straight if every point is on the first-last chord
    const a = poly[0], b = poly[poly.length - 1];
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const dx = (b[0] - a[0]) / chord, dy = (b[1] - a[1]) / chord;
    let maxD = 0;
    for (const p of poly) maxD = Math.max(maxD, Math.abs(dy * (p[0] - a[0]) - dx * (p[1] - a[1])));
    if (maxD < 0.02) return 'straight';
    return 'polyline';
  }
  if (sub.closed) {
    // circle: uniform radius about centroid
    let cx = 0, cy = 0;
    for (const p of poly) { cx += p[0]; cy += p[1]; }
    cx /= poly.length; cy /= poly.length;
    const rs = poly.map(p => Math.hypot(p[0] - cx, p[1] - cy));
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    const dev = Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length) / mean;
    if (dev < 0.01) return 'circle';
    const hasArcOrCurve = sub.cmds.some(s => s.c !== 'L');
    const hasLine = sub.cmds.some(s => s.c === 'L');
    if (hasArcOrCurve && hasLine) return 'rounded-rect-or-blob';
    if (!hasArcOrCurve) return 'polygon';
    return 'closed-curve';
  }
  return 'curve';
}

module.exports = { parsePathData, parseIconSvg, flattenSubpath, classifySubpath, polyLength, sampleArc };
