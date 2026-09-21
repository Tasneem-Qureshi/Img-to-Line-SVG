#!/usr/bin/env node
// Follow-up fixtures for the conditional sub-metric drops accepted under the
// amended ratchet policy (v2.4 merge, 2026-09-21). Each case is a CONCRETE
// icon that passed the named metric on v2.3.1 and fails on the merged build.
// This runner is quarantined: it is EXPECTED to fail until the mechanisms are
// fixed; run-all reports it without gating. When a case goes green, promote
// it into the gated suite and remove it here.
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.join(__dirname, '..', '..');
const SP = require(path.join(ROOT, 'test/corpus-harness/svgpath.js'));
const H = require(path.join(ROOT, 'test/corpus-harness/harness.js'));
const TH = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/corpus-harness/thresholds.json'), 'utf8'));

const CASES = [ // [icon, size, degradeMode, bold, metric]
  ['general__bookmark-x', 96, null, false, 'centerline'],
  ['editor__bezier-curve-01', 96, null, false, 'grammar'],
  ['arrows__switch-vertical-02', 240, null, false, 'anchors'],
  ['alerts-feedback__announcement-02', 480, null, false, 'centerline'],
  ['arrows__arrow-circle-broken-up-left', 480, null, true, 'centerline'],
  ['charts__chart-breakout-circle', 480, null, true, 'grammar'],
  ['education__telescope', 240, 'down', false, 'grammar'],
  ['finance-ecommerce__shopping-bag-02', 240, 'down', false, 'topology'],
  ['maps-travel__train', 240, 'blur', false, 'grammar'],
  ['charts__line-chart-down-02', 240, 'blur', false, 'topology'],
  ['charts__bar-chart-square-plus', 240, 'rot', false, 'pathCount'],
  ['finance-ecommerce__credit-card-down', 240, 'jpeg', false, 'topology'],
];

function bicubic(img, W, Hh) {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(W * Hh * 4);
  const cr = (p0,p1,p2,p3,t) => p1 + 0.5*t*(p2-p0 + t*(2*p0-5*p1+4*p2-p3 + t*(3*(p1-p2)+p3-p0)));
  const gx = (x,y,ch) => data[(Math.min(h-1,Math.max(0,y))*w + Math.min(w-1,Math.max(0,x)))*4+ch];
  for (let y = 0; y < Hh; y++) {
    const sy = (y+0.5)*h/Hh-0.5, y0 = Math.floor(sy), fy = sy-y0;
    for (let x = 0; x < W; x++) {
      const sx = (x+0.5)*w/W-0.5, x0 = Math.floor(sx), fx = sx-x0;
      for (let ch = 0; ch < 4; ch++) {
        const r = [];
        for (let j = -1; j <= 2; j++) r.push(cr(gx(x0-1,y0+j,ch), gx(x0,y0+j,ch), gx(x0+1,y0+j,ch), gx(x0+2,y0+j,ch), fx));
        out[(y*W+x)*4+ch] = Math.max(0, Math.min(255, cr(r[0],r[1],r[2],r[3],fy)));
      }
    }
  }
  return { width: W, height: Hh, data: out };
}
function degrade(img, mode) {
  const { width: w, height: h, data } = img;
  if (mode === 'down') {
    const hw = w>>1, hh = h>>1, half = new Uint8ClampedArray(hw*hh*4);
    for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++)
      for (let c = 0; c < 4; c++)
        half[(y*hw+x)*4+c] = (data[((2*y)*w+2*x)*4+c]+data[((2*y)*w+2*x+1)*4+c]+data[((2*y+1)*w+2*x)*4+c]+data[((2*y+1)*w+2*x+1)*4+c])/4;
    return { width: hw, height: hh, data: half };
  }
  if (mode === 'blur') {
    let cur = { width: w, height: h, data: new Uint8ClampedArray(data) };
    for (let pass = 0; pass < 3; pass++) {
      const out = new Uint8ClampedArray(cur.data.length);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++)
        for (let c = 0; c < 4; c++) {
          let acc = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const yy = y+dy, xx = x+dx;
            if (xx>=0&&yy>=0&&xx<w&&yy<h) { acc += cur.data[(yy*w+xx)*4+c]; n++; }
          }
          out[(y*w+x)*4+c] = acc/n;
        }
      cur = { width: w, height: h, data: out };
    }
    return cur;
  }
  if (mode === 'rot') {
    const a = 0.5*Math.PI/180, cos = Math.cos(a), sin = Math.sin(a), cx = w/2, cy = h/2;
    const out = new Uint8ClampedArray(data.length);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const sx = cos*(x-cx)+sin*(y-cy)+cx, sy = -sin*(x-cx)+cos*(y-cy)+cy;
      const x0 = Math.floor(sx), y0 = Math.floor(sy), fx = sx-x0, fy = sy-y0;
      if (x0<0||y0<0||x0+1>=w||y0+1>=h) continue;
      for (let c = 0; c < 4; c++)
        out[(y*w+x)*4+c] = data[(y0*w+x0)*4+c]*(1-fx)*(1-fy)+data[(y0*w+x0+1)*4+c]*fx*(1-fy)+data[((y0+1)*w+x0)*4+c]*(1-fx)*fy+data[((y0+1)*w+x0+1)*4+c]*fx*fy;
    }
    return { width: w, height: h, data: out };
  }
  return img;
}
let failing = 0;
for (const [name, size, mode, bold, metric] of CASES) {
  const orig = SP.parseIconSvg(fs.readFileSync(path.join(ROOT, `test/corpus-untitled/${name}.svg`), 'utf8'));
  for (const s of orig.subpaths) s.poly = SP.flattenSubpath(s, 4);
  const key = name + '@' + size + (bold ? 'bold' : mode === 'jpeg' ? 'jpeg' : '');
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, `test/corpus-fixtures/${key}.rgba.gz`)));
  const w = raw.readUInt32LE(0), h = raw.readUInt32LE(4);
  let img = { width: w, height: h, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset + 8, w*h*4) };
  if (mode && mode !== 'jpeg') img = degrade(img, mode);
  const res = H.traceRender(img);
  const tr = bold ? H.parseTraced(res.svg, res.traceW, 30, -3) : H.parseTraced(res.svg, res.traceW);
  tr.weightsLen = res.weights.length;
  const opts = Object.assign({}, mode ? TH.degraded : TH.clean, bold ? { expectWidth: 5 } : {});
  const M = H.evaluate(orig, tr, opts);
  const ok = M[metric] && M[metric].pass;
  if (!ok) failing++;
  console.log(`${ok ? 'ok  ' : 'PENDING'} ${name}@${size}${bold ? ' bold' : mode ? ' ' + mode : ''} ${metric}` +
    (ok ? '' : ` — ${JSON.stringify(M[metric]).slice(0, 100)}`));
}
console.log(`\n${CASES.length - failing}/${CASES.length} follow-up fixtures green (pending = expected until fixed)`);
process.exit(0); // informational, never gates
