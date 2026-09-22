// Ground-truth bullhorn (mdi-light proportions) at TWO weights.
// Body = ONE closed path (rounded back, sharp shoulder, two sharp mouth
// corners, straight bottom edge); U handle; two sound-wave arcs with FLAT
// (butt) ends. Rendered supersampled on a padded canvas so both weights
// share one 24-grid mapping: px = (u + 2) * S / 28.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const SP = require(path.join(__dirname, '..', 'corpus-harness', 'svgpath.js'));

const BODY = 'M12.2 6.6L15.2 3.2L15.2 18.4L12.2 15\
H7.2C5.766 15 4.6 13.834 4.6 12.4V9.2C4.6 7.766 5.766 6.6 7.2 6.6Z';
const HANDLE = 'M7.8 15V17.4C7.8 18.503 8.697 19.4 9.8 19.4C10.903 19.4 11.8 18.503 11.8 17.4V15';
const WAVE_S = 'M18.59 9.13A2.6 2.6 0 0 1 18.59 12.47';
const WAVE_B = 'M20.42 5.91A6.2 6.2 0 0 1 20.42 15.69';
const svg = w => `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="${BODY}M${HANDLE.slice(1)}" stroke="black" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>
<path d="${WAVE_S}M${WAVE_B.slice(1)}" stroke="black" stroke-width="${w}" stroke-linecap="butt"/>
</svg>`;
fs.writeFileSync(path.join(__dirname, 'bullhorn.svg'), svg(1.4)); // ground truth (thin)

function render(w, out) {
  const S = 480, SS = 960, span = 28, off = -2;
  const k = SS / span, r = w / 2 * k;
  const big = new Uint8Array(SS * SS);
  const stamp = (cx, cy, rr) => {
    for (let y = Math.floor(cy - rr); y <= cy + rr; y++)
      for (let x = Math.floor(cx - rr); x <= cx + rr; x++)
        if (x >= 0 && y >= 0 && x < SS && y < SS && (x - cx) ** 2 + (y - cy) ** 2 <= rr * rr)
          big[y * SS + x] = 1;
  };
  const icon = SP.parseIconSvg(svg(w));
  for (const sub of icon.subpaths) {
    const poly = SP.flattenSubpath(sub, 16);
    // butt-cap paths: stamp segment-by-segment with square-ish ends by
    // shortening nothing — discs along the path INCLUDING endpoints gives
    // round caps; for butt paths, clip the end discs flat by masking beyond
    // the endpoint along the end tangent
    for (const p of poly) stamp((p[0] - off) * k, (p[1] - off) * k, r);
    if (sub.isButt) {
      for (const e of [0, poly.length - 1]) {
        const p = poly[e], q = poly[e === 0 ? Math.min(6, poly.length - 1) : Math.max(0, poly.length - 7)];
        let tx = p[0] - q[0], ty = p[1] - q[1];
        const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl; // outward
        const px = (p[0] - off) * k, py = (p[1] - off) * k;
        // erase everything beyond the flat face through the endpoint
        for (let y = Math.floor(py - r * 1.6); y <= py + r * 1.6; y++)
          for (let x = Math.floor(px - r * 1.6); x <= px + r * 1.6; x++)
            if (x >= 0 && y >= 0 && x < SS && y < SS &&
                (x - px) * tx + (y - py) * ty > 0) big[y * SS + x] = 0;
      }
    }
  }
  const img = new Uint8ClampedArray(S * S * 4).fill(255);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const cov = (big[(2*y) * SS + 2*x] + big[(2*y) * SS + 2*x+1] +
                   big[(2*y+1) * SS + 2*x] + big[(2*y+1) * SS + 2*x+1]) / 4;
      const v = Math.round(255 - cov * 215);
      const o = (y * S + x) * 4;
      img[o] = img[o + 1] = img[o + 2] = v;
    }
  const buf = Buffer.alloc(8 + img.length);
  buf.writeUInt32LE(S, 0); buf.writeUInt32LE(S, 4);
  Buffer.from(img.buffer).copy(buf, 8);
  fs.writeFileSync(path.join(__dirname, out), zlib.gzipSync(buf));
}
// tag butt subpaths: parse per <path>, mark by element
function renderWeight(w, out) {
  // monkey: parseIconSvg loses per-element caps; re-parse manually
  const icon = { subpaths: [] };
  for (const d of [BODY + 'M' + HANDLE.slice(1)])
    for (const s of SP.parsePathData(d)) { s.isButt = false; icon.subpaths.push(s); }
  for (const d of [WAVE_S + 'M' + WAVE_B.slice(1)])
    for (const s of SP.parsePathData(d)) { s.isButt = true; icon.subpaths.push(s); }
  // inline render (duplicated from render() but with our subpaths)
  const S = 480, SS = 960, span = 28, off = -2;
  const k = SS / span, r = w / 2 * k;
  const big = new Uint8Array(SS * SS);
  const stamp = (cx, cy, rr) => {
    for (let y = Math.floor(cy - rr); y <= cy + rr; y++)
      for (let x = Math.floor(cx - rr); x <= cx + rr; x++)
        if (x >= 0 && y >= 0 && x < SS && y < SS && (x - cx) ** 2 + (y - cy) ** 2 <= rr * rr)
          big[y * SS + x] = 1;
  };
  for (const sub of icon.subpaths) {
    const poly = SP.flattenSubpath(sub, 16);
    for (const p of poly) stamp((p[0] - off) * k, (p[1] - off) * k, r);
  }
  for (const sub of icon.subpaths) {
    if (!sub.isButt) continue;
    const poly = SP.flattenSubpath(sub, 16);
    for (const e of [0, poly.length - 1]) {
      const p = poly[e], q = poly[e === 0 ? Math.min(8, poly.length - 1) : Math.max(0, poly.length - 9)];
      let tx = p[0] - q[0], ty = p[1] - q[1];
      const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
      const px = (p[0] - off) * k, py = (p[1] - off) * k;
      for (let y = Math.floor(py - r * 1.7); y <= py + r * 1.7; y++)
        for (let x = Math.floor(px - r * 1.7); x <= px + r * 1.7; x++)
          if (x >= 0 && y >= 0 && x < SS && y < SS &&
              (x - px) * tx + (y - py) * ty > 0.5) big[y * SS + x] = 0;
    }
  }
  const S2 = S;
  const img = new Uint8ClampedArray(S2 * S2 * 4).fill(255);
  for (let y = 0; y < S2; y++)
    for (let x = 0; x < S2; x++) {
      const cov = (big[(2*y) * SS + 2*x] + big[(2*y) * SS + 2*x+1] +
                   big[(2*y+1) * SS + 2*x] + big[(2*y+1) * SS + 2*x+1]) / 4;
      const v = Math.round(255 - cov * 215);
      const o = (y * S2 + x) * 4;
      img[o] = img[o + 1] = img[o + 2] = v;
    }
  const buf = Buffer.alloc(8 + img.length);
  buf.writeUInt32LE(S2, 0); buf.writeUInt32LE(S2, 4);
  Buffer.from(img.buffer).copy(buf, 8);
  fs.writeFileSync(path.join(__dirname, out), zlib.gzipSync(buf));
}
renderWeight(1.4, 'bullhorn-thin.rgba.gz');
renderWeight(2.8, 'bullhorn-bold.rgba.gz');
// clearance report: min ink gaps between distinct subpaths at bold
{
  const w = 2.8;
  const subs = [];
  for (const s of SP.parsePathData(BODY + 'M' + HANDLE.slice(1))) subs.push(s);
  for (const s of SP.parsePathData(WAVE_S + 'M' + WAVE_B.slice(1))) subs.push(s);
  for (const s of subs) s.poly = SP.flattenSubpath(s, 8);
  for (let a = 0; a < subs.length; a++)
    for (let b = a + 1; b < subs.length; b++) {
      let mind = 1e9;
      for (const p of subs[a].poly)
        for (const q of subs[b].poly) {
          const d = Math.hypot(p[0]-q[0], p[1]-q[1]);
          if (d < mind) mind = d;
        }
      const inkGap = mind - w;
      if (inkGap < 1.0) console.log(`clearance ${a}-${b}: centerline ${mind.toFixed(2)}, ink gap ${inkGap.toFixed(2)}`);
    }
  console.log('clearance check done (bold w=2.8)');
}
