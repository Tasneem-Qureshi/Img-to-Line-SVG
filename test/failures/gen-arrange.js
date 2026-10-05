// Ground-truth "arrange / bring-forward" icon (mdi-light proportions) at a
// thick weight with MITER joins and BUTT ends — the regime where sharp
// corners traced as swoops, stroke ends curled, and the arrow crossing was
// mangled (user report 2026-10-05). Rendered by polygon rasterization
// (disc stamping can't produce miter corners), supersampled, on the same
// padded 28-unit mapping as the bullhorn fixture: px = (u + 2) * S / 28.
//
//   (proportions measured from the user's reference render, 40px/unit)
//   back square   M4 4 H12 V12 H4 Z                (closed, 4 sharp corners)
//   front square  M13.4 7.5 H15.4 V15.4 H7.5 V13.4 (open; butt ends at the notch,
//                                                   which clears the back square by 1.4u)
//   shaft         M7.4 7.4 L13 13                  (45°, butt ends; passes THROUGH the
//                                                   back square's bottom-right corner)
//   arrowhead     M9.9 7.4 L7.4 7.4 L7.4 9.9       (two axis barbs, miter apex; 1u clear
//                                                   of the square's edges)
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// stroke ≈ 25px on a 320px (8u) square in the reference → 0.7u; a bold
// variant at 1.4u keeps the barbs line-like (1.8w) — at 2.4u the arrowhead
// fuses into a solid wedge, which is a different icon
const S = 480, SS = 960, span = 28, off = -2, k = SS / span;

function render(W, out) {
const H = W / 2;
const big = new Uint8Array(SS * SS);

function fillPoly(pts, val) { // scanline even-odd fill, pixel-center sampling
  const px = pts.map(p => [(p[0] - off) * k, (p[1] - off) * k]);
  let y0 = Infinity, y1 = -Infinity;
  for (const p of px) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  for (let y = Math.max(0, Math.floor(y0)); y <= Math.min(SS - 1, Math.ceil(y1)); y++) {
    const yc = y + 0.5, xs = [];
    for (let i = 0; i < px.length; i++) {
      const a = px[i], b = px[(i + 1) % px.length];
      if ((a[1] <= yc) !== (b[1] <= yc)) xs.push(a[0] + (yc - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2)
      for (let x = Math.max(0, Math.ceil(xs[i] - 0.5)); x <= Math.min(SS - 1, Math.floor(xs[i + 1] - 0.5)); x++)
        big[y * SS + x] = val;
  }
}
const rect = (x0, y0, x1, y1, val = 1) => fillPoly([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], val);

// back square ring: outer minus inner (miter corners for free)
rect(4 - H, 4 - H, 12 + H, 12 + H, 1);
rect(4 + H, 4 + H, 12 - H, 12 - H, 0);
// front square, three miter corners, butt ends at (13.4,7.5) and (7.5,13.4)
rect(13.4, 7.5 - H, 15.4 + H, 7.5 + H);
rect(15.4 - H, 7.5 - H, 15.4 + H, 15.4 + H);
rect(7.5 - H, 15.4 - H, 15.4 + H, 15.4 + H);
rect(7.5 - H, 13.4, 7.5 + H, 15.4 + H);
// shaft: rotated rectangle, butt ends, through the back square's corner (12,12)
{
  const P0 = [7.4, 7.4], P1 = [13, 13];
  const dx = P1[0] - P0[0], dy = P1[1] - P0[1], L = Math.hypot(dx, dy);
  const nx = -dy / L * H, ny = dx / L * H;
  fillPoly([[P0[0] + nx, P0[1] + ny], [P1[0] + nx, P1[1] + ny], [P1[0] - nx, P1[1] - ny], [P0[0] - nx, P0[1] - ny]], 1);
}
// arrowhead barbs: miter apex (outer corner at (6.2,6.2)), butt outer ends
rect(7.4 - H, 7.4 - H, 9.9, 7.4 + H);
rect(7.4 - H, 7.4 - H, 7.4 + H, 9.9);

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

render(0.7, 'arrange-thin.rgba.gz');
render(1.4, 'arrange-bold.rgba.gz');
fs.writeFileSync(path.join(__dirname, 'arrange.svg'),
`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M4 4H12V12H4Z" stroke="black" stroke-width="0.7" stroke-linejoin="miter"/>
<path d="M13.4 7.5H15.4V15.4H7.5V13.4" stroke="black" stroke-width="0.7" stroke-linecap="butt" stroke-linejoin="miter"/>
<path d="M7.4 7.4L13 13" stroke="black" stroke-width="0.7" stroke-linecap="butt"/>
<path d="M9.9 7.4L7.4 7.4L7.4 9.9" stroke="black" stroke-width="0.7" stroke-linecap="butt" stroke-linejoin="miter"/>
</svg>
`);
console.log('wrote arrange-thin.rgba.gz, arrange-bold.rgba.gz + arrange.svg');
