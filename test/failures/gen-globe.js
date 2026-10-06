// Ground-truth "globe" icon in the proportions of the user's report
// (2026-10-06): outer circle r=10, two latitude lines at y = 12 ∓ 3.2, and a
// vertical lens (two arcs through the poles, half-width 4.6 at the equator).
// At each pole THREE strokes converge — the ring passing through plus both
// arc ends — and at bold weights the pole fuses into one blob. Rendered by
// disc stamping (all joins are overlapping round strokes), supersampled, on
// the padded 28-unit mapping: px = (u + 2) * S / 28.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const S = 480, SS = 960, span = 28, off = -2, k = SS / span;
const CX = 12, CY = 12, R = 10, LAT = 3.2, LENS = 4.6;
// lens arcs: chord 20 (pole to pole), sagitta LENS → radius & center offset
const AR = (LENS * LENS + 100) / (2 * LENS), ACX = AR - LENS;

const arcPts = (cx, cy, r, a0, a1, n) => {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return out;
};
const shapes = () => {
  const ring = arcPts(CX, CY, R, 0, 2 * Math.PI, 720);
  const half = Math.sqrt(R * R - LAT * LAT) + 0.3; // bury the line ends in the ring
  const lat1 = [[CX - half, CY - LAT], [CX + half, CY - LAT]];
  const lat2 = [[CX - half, CY + LAT], [CX + half, CY + LAT]];
  // right-bulging arc: center left of the globe; sweep through angle 0
  const th = Math.atan2(R, ACX);
  const right = arcPts(CX - ACX, CY, AR, -th, th, 360);
  const left = arcPts(CX + ACX, CY, AR, Math.PI - th, Math.PI + th, 360);
  return { ring, lat1, lat2, right, left };
};

function render(W, out) {
  const big = new Uint8Array(SS * SS);
  const r = W / 2 * k;
  const stamp = (x, y) => {
    const cx = (x - off) * k, cy = (y - off) * k;
    for (let yy = Math.floor(cy - r); yy <= cy + r; yy++)
      for (let xx = Math.floor(cx - r); xx <= cx + r; xx++)
        if (xx >= 0 && yy >= 0 && xx < SS && yy < SS && (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r) big[yy * SS + xx] = 1;
  };
  const stroke = pts => {
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * k / 1.5));
      for (let j = 0; j <= n; j++) stamp(ax + (bx - ax) * j / n, ay + (by - ay) * j / n);
    }
  };
  const sh = shapes();
  for (const p of Object.values(sh)) stroke(p);
  const img = new Uint8ClampedArray(S * S * 4).fill(255);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const cov = (big[(2*y) * SS + 2*x] + big[(2*y) * SS + 2*x+1] + big[(2*y+1) * SS + 2*x] + big[(2*y+1) * SS + 2*x+1]) / 4;
      const v = Math.round(255 - cov * 215);
      const o = (y * S + x) * 4;
      img[o] = img[o + 1] = img[o + 2] = v;
    }
  const buf = Buffer.alloc(8 + img.length);
  buf.writeUInt32LE(S, 0); buf.writeUInt32LE(S, 4);
  Buffer.from(img.buffer).copy(buf, 8);
  fs.writeFileSync(path.join(__dirname, out), zlib.gzipSync(buf));
}
render(0.8, 'globe-thin.rgba.gz');
render(1.3, 'globe-bold.rgba.gz');
const th = Math.atan2(R, ACX);
const f = v => +v.toFixed(3);
fs.writeFileSync(path.join(__dirname, 'globe.svg'),
`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<circle cx="${CX}" cy="${CY}" r="${R}" stroke="black" stroke-width="0.8"/>
<path d="M${f(CX - Math.sqrt(R*R-LAT*LAT))} ${CY - LAT}H${f(CX + Math.sqrt(R*R-LAT*LAT))}M${f(CX - Math.sqrt(R*R-LAT*LAT))} ${CY + LAT}H${f(CX + Math.sqrt(R*R-LAT*LAT))}" stroke="black" stroke-width="0.8"/>
<path d="M${CX} ${CY - R}A${f(AR)} ${f(AR)} 0 0 1 ${CX} ${CY + R}A${f(AR)} ${f(AR)} 0 0 1 ${CX} ${CY - R}Z" stroke="black" stroke-width="0.8"/>
</svg>
`);
console.log('wrote globe-thin.rgba.gz, globe-bold.rgba.gz + globe.svg (lens arc r=' + f(AR) + ')');
