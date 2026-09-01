// Node test harness for the centerline tracer embedded in ui.html.
// Run: node test/trace-test.js
'use strict';
const fs = require('fs');
const path = require('path');

// --- load the tracer straight out of ui.html so we test what ships ---
const html = fs.readFileSync(path.join(__dirname, '..', 'ui.html'), 'utf8');
const match = html.match(/\/\* ===== TRACER-START =====[\s\S]*?TRACER-END ===== \*\//);
if (!match) { console.error('FAIL: tracer block not found in ui.html'); process.exit(1); }
const shim = { exports: {} };
new Function('module', match[0])(shim);
const T = shim.exports;

// --- tiny raster helpers -------------------------------------------------
function makeImage(w, h, bg) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1];
    data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = bg[3];
  }
  return { width: w, height: h, data };
}
function stamp(img, cx, cy, r, rgba) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) {
    for (let x = Math.floor(cx - r); x <= cx + r; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 > r * r) continue;
      const o = (y * img.width + x) * 4;
      img.data[o] = rgba[0]; img.data[o + 1] = rgba[1];
      img.data[o + 2] = rgba[2]; img.data[o + 3] = rgba[3];
    }
  }
}
function drawSegment(img, x1, y1, x2, y2, thickness, rgba) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.ceil(len * 2);
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    stamp(img, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, thickness / 2, rgba);
  }
}
function drawCircle(img, cx, cy, radius, thickness, rgba) {
  const steps = Math.ceil(2 * Math.PI * radius * 2);
  for (let s = 0; s <= steps; s++) {
    const a = (s / steps) * 2 * Math.PI;
    stamp(img, cx + radius * Math.cos(a), cy + radius * Math.sin(a), thickness / 2, rgba);
  }
}

// --- assertion helpers ----------------------------------------------------
let failures = 0, checks = 0;
function check(name, cond, detail) {
  checks++;
  if (cond) console.log(`  ok  ${name}`);
  else { failures++; console.error(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;
function keptChains(traced, minLength) {
  return traced.chains.filter(c => c.points.length >= minLength);
}
function endpoints(chain) {
  return [chain.points[0], chain.points[chain.points.length - 1]];
}
function fillRect(img, x0, y0, x1, y1, rgba) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      const o = (y * img.width + x) * 4;
      img.data[o] = rgba[0]; img.data[o + 1] = rgba[1];
      img.data[o + 2] = rgba[2]; img.data[o + 3] = rgba[3];
    }
}
function bilinearResize(img, W, H) {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1.001, Math.max(0, (y + 0.5) * h / H - 0.5));
    const y0 = Math.floor(sy), fy = sy - y0, y1 = Math.min(h - 1, y0 + 1);
    for (let x = 0; x < W; x++) {
      const sx = Math.min(w - 1.001, Math.max(0, (x + 0.5) * w / W - 0.5));
      const x0 = Math.floor(sx), fx = sx - x0, x1 = Math.min(w - 1, x0 + 1);
      for (let ch = 0; ch < 4; ch++) {
        out[(y * W + x) * 4 + ch] =
          data[(y0 * w + x0) * 4 + ch] * (1 - fx) * (1 - fy) +
          data[(y0 * w + x1) * 4 + ch] * fx * (1 - fy) +
          data[(y1 * w + x0) * 4 + ch] * (1 - fx) * fy +
          data[(y1 * w + x1) * 4 + ch] * fx * fy;
      }
    }
  }
  return { width: W, height: H, data: out };
}
function parsePath(d) { // -> { anchors, ctrls (null for L segments) }
  const tokens = d.match(/[MLCZ]|-?[\d.]+/g) || [];
  const anchors = [], ctrls = [];
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i++];
    if (t === 'M') anchors.push([+tokens[i++], +tokens[i++]]);
    else if (t === 'L') { ctrls.push(null); anchors.push([+tokens[i++], +tokens[i++]]); }
    else if (t === 'C') {
      ctrls.push([[+tokens[i++], +tokens[i++]], [+tokens[i++], +tokens[i++]]]);
      anchors.push([+tokens[i++], +tokens[i++]]);
    }
  }
  return { anchors, ctrls };
}

const BLACK = [0, 0, 0, 255], WHITE = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

// --- 1. straight dark line on white ---------------------------------------
console.log('1. horizontal dark line on white');
{
  const img = makeImage(200, 100, WHITE);
  drawSegment(img, 15, 50, 185, 50, 5, BLACK);
  const traced = T.trace(img, {});
  check('auto mode = dark', traced.mode === 'dark', `got ${traced.mode}`);
  const chains = keptChains(traced, 4);
  check('exactly 1 chain', chains.length === 1, `got ${chains.length}`);
  if (chains.length === 1) {
    const [a, b] = endpoints(chains[0]);
    const xs = [a[0], b[0]].sort((p, q) => p - q);
    check('spans the segment', near(xs[0], 15, 8) && near(xs[1], 185, 8), `xs=${xs}`);
    check('stays on centerline', chains[0].points.every(p => near(p[1], 50.5, 2.5)));
    const { svg, pathCount } = T.buildSvg(traced.chains, 200, 100, { stroke: '#ff0000', strokeWidth: 3 });
    check('svg is stroke-based', svg.includes('fill="none"') && svg.includes('stroke="#ff0000"') && svg.includes('stroke-width="3"'));
    check('svg has 1 path group', pathCount === 1);
  }
}

// --- 2. polarity: light line on dark --------------------------------------
console.log('2. white line on black (auto-invert)');
{
  const img = makeImage(200, 100, BLACK);
  drawSegment(img, 15, 30, 185, 70, 5, WHITE);
  const traced = T.trace(img, {});
  check('auto mode = light', traced.mode === 'light', `got ${traced.mode}`);
  const chains = keptChains(traced, 4);
  check('exactly 1 chain', chains.length === 1, `got ${chains.length}`);
}

// --- 3. transparent PNG line art ------------------------------------------
console.log('3. white line on transparent background (alpha mode)');
{
  const img = makeImage(200, 100, CLEAR);
  drawSegment(img, 15, 50, 185, 50, 5, WHITE); // white ink: invisible without alpha handling
  const traced = T.trace(img, {});
  check('auto mode = alpha', traced.mode === 'alpha', `got ${traced.mode}`);
  const chains = keptChains(traced, 4);
  check('exactly 1 chain', chains.length === 1, `got ${chains.length}`);
}

// --- 4. circle -> single closed loop ---------------------------------------
console.log('4. circle outline -> closed loop');
{
  const img = makeImage(200, 200, WHITE);
  drawCircle(img, 100, 100, 60, 5, BLACK);
  const traced = T.trace(img, {});
  const chains = keptChains(traced, 4);
  check('exactly 1 chain', chains.length === 1, `got ${chains.length}`);
  if (chains.length === 1) {
    check('chain is closed', chains[0].closed === true);
    const radii = chains[0].points.map(p => Math.hypot(p[0] - 100.5, p[1] - 100.5));
    const rMin = Math.min(...radii), rMax = Math.max(...radii);
    check('sits on the ring centerline', near(rMin, 60, 4) && near(rMax, 60, 4), `r=[${rMin.toFixed(1)},${rMax.toFixed(1)}]`);
    const d = T.chainToPathData(T.simplifyChain(chains[0], 1), true);
    check('closed path data ends with Z', /Z$/.test(d.trim()));
  }
}

// --- 5. cross -> two continuous through-lines --------------------------------
console.log('5. plus/cross -> merges into 2 continuous lines');
{
  const img = makeImage(200, 200, WHITE);
  drawSegment(img, 20, 100, 180, 100, 5, BLACK);
  drawSegment(img, 100, 20, 100, 180, 5, BLACK);
  const traced = T.trace(img, {});
  const chains = keptChains(traced, 6);
  check('exactly 2 through-lines', chains.length === 2, `got ${chains.length}`);
  const spans = chains.map(c => {
    const xs = c.points.map(p => p[0]), ys = c.points.map(p => p[1]);
    return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  });
  check('each spans the full stroke', spans.every(s => s > 130), `spans ${spans.map(s => s.toFixed(0))}`);
}

// --- 6. speckle removal ------------------------------------------------------
console.log('6. speckles are filtered by min length');
{
  const img = makeImage(200, 100, WHITE);
  drawSegment(img, 15, 50, 185, 50, 5, BLACK);
  stamp(img, 30, 20, 2, BLACK); // noise blob
  stamp(img, 170, 80, 2, BLACK);
  const traced = T.trace(img, {});
  const { pathCount } = T.buildSvg(traced.chains, 200, 100, { minLength: 6 });
  check('only the line survives', pathCount === 1, `got ${pathCount}`);
}

// --- 7. output scaling -------------------------------------------------------
console.log('7. stroke width compensates for viewBox scaling');
{
  const img = makeImage(200, 100, WHITE);
  drawSegment(img, 15, 50, 185, 50, 5, BLACK);
  const traced = T.trace(img, {});
  // traced at 200px wide but rendered at 400px: attr width must halve
  const { svg } = T.buildSvg(traced.chains, 200, 100, { strokeWidth: 4, outW: 400, outH: 200 });
  check('viewBox kept at trace size', svg.includes('viewBox="0 0 200 100"'));
  check('output size applied', svg.includes('width="400"') && svg.includes('height="200"'));
  check('stroke-width halved to 2', svg.includes('stroke-width="2"'), svg.match(/stroke-width="[^"]*"/)[0]);
}

// --- 8. loop anchored at a junction must survive simplification -------------
console.log('8. circle with attached spur keeps its ring');
{
  const img = makeImage(200, 200, WHITE);
  drawCircle(img, 80, 100, 50, 5, BLACK);
  drawSegment(img, 130, 100, 190, 100, 5, BLACK); // spur off the ring's right side
  const traced = T.trace(img, {});
  const simplified = keptChains(traced, 6).map(c => T.simplifyChain(c, 1));
  // the ring shows up as chain(s) whose points sweep the full circle
  const ringPts = simplified.flatMap(c => c.points)
    .filter(p => near(Math.hypot(p[0] - 80.5, p[1] - 100.5), 50, 5));
  const angles = ringPts.map(p => Math.atan2(p[1] - 100.5, p[0] - 80.5));
  const quadrants = new Set(angles.map(a => Math.floor((a + Math.PI) / (Math.PI / 2))));
  check('ring points cover all quadrants', quadrants.size >= 4, `got ${quadrants.size}`);
  check('ring not collapsed', ringPts.length >= 8, `got ${ringPts.length} pts`);
}

// --- 9. auto stroke width & color match the source -------------------------
console.log('9. measured stroke width and ink color match the drawing');
{
  const RED = [220, 30, 30, 255];
  const img = makeImage(200, 100, WHITE);
  drawSegment(img, 15, 50, 185, 50, 7, RED);
  const traced = T.trace(img, {});
  check('width ~7px', near(traced.avgStrokeWidth, 7, 1.5), `got ${traced.avgStrokeWidth.toFixed(2)}`);
  const r = parseInt(traced.inkColor.slice(1, 3), 16);
  const g = parseInt(traced.inkColor.slice(3, 5), 16);
  const b = parseInt(traced.inkColor.slice(5, 7), 16);
  check('color ~red', near(r, 220, 10) && near(g, 30, 10) && near(b, 30, 10), `got ${traced.inkColor}`);
}

// --- 10. fashion-flat: thick outline + fine dashed stitching + gray panel ---
console.log('10. fashion flat keeps fine details');
{
  const GRAY = [235, 235, 235, 255];
  const img = makeImage(600, 600, WHITE);
  // light gray fabric panel (like a back panel seen through a neckline)
  for (let y = 200; y < 400; y++)
    for (let x = 250; x < 350; x++) {
      const o = (y * 600 + x) * 4;
      img.data[o] = GRAY[0]; img.data[o + 1] = GRAY[1]; img.data[o + 2] = GRAY[2];
    }
  // thick garment outline
  drawCircle(img, 300, 300, 180, 5, BLACK);
  // fine dashed stitch line just inside it
  let dashCount = 0;
  {
    const r = 150, dashLen = 8, gapLen = 6;
    const step = (dashLen + gapLen) / r; // radians per dash+gap
    for (let a = 0; a < 2 * Math.PI - step / 2; a += step) {
      const a2 = a + dashLen / r;
      drawSegment(img,
        300 + r * Math.cos(a), 300 + r * Math.sin(a),
        300 + r * Math.cos(a2), 300 + r * Math.sin(a2), 2, BLACK);
      dashCount++;
    }
  }
  const traced = T.trace(img, {});
  check('gray panel not read as ink', traced.threshold < 230, `threshold ${traced.threshold}`);
  const inPanel = traced.chains.flatMap(c => c.points)
    .filter(p => p[0] > 255 && p[0] < 345 && p[1] > 205 && p[1] < 395);
  check('nothing traced inside the gray panel', inPanel.length === 0, `${inPanel.length} pts`);

  const dashes = traced.chains.filter(c => c.points.length >= 3 && c.points.length <= 14 && c.width < 3);
  check('dashes survive', near(dashes.length, dashCount, dashCount * 0.25), `${dashes.length}/${dashCount}`);

  const outline = traced.chains.filter(c => c.width > 3.2);
  check('outline measured thick (~5px)', outline.length >= 1 && outline.every(c => near(c.width, 5, 1.5)),
    `widths: ${outline.map(c => c.width.toFixed(1)).join(',')}`);

  const { svg, weights } = T.buildSvg(traced.chains, 600, 600, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth
  });
  check('two line weights in output', weights.length === 2, `got ${weights.length}: ${weights}`);
  if (weights.length === 2)
    check('thick/thin ratio preserved', weights[0] / weights[1] > 1.8, `ratio ${(weights[0] / weights[1]).toFixed(2)}`);
  const pathTags = svg.match(/<path /g) || [];
  check('one <path> per weight', pathTags.length === weights.length, `got ${pathTags.length}`);
}

// --- 11. spur pruning keeps real branches, drops hairs ----------------------
console.log('11. junction hairs pruned, real short branches kept');
{
  const img = makeImage(200, 200, WHITE);
  drawSegment(img, 20, 100, 180, 100, 8, BLACK);   // thick main line
  drawSegment(img, 100, 100, 100, 60, 8, BLACK);   // real 40px branch
  const traced = T.trace(img, {});
  const { pathCount } = T.buildSvg(traced.chains, 200, 200, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth
  });
  // the main line merges straight through the T junction; the branch stays
  check('T = through-line + branch (2 chains)', pathCount === 2, `got ${pathCount}`);
}

// --- 12. AA-bridged pokes are pruned ----------------------------------------
console.log('12. hair poking out of a thick line is pruned');
{
  const img = makeImage(200, 200, WHITE);
  drawSegment(img, 20, 100, 180, 100, 10, BLACK); // thick line (y 95..105)
  drawSegment(img, 90, 103, 90, 114, 2, BLACK);   // thin hair poking out ~9px
  const traced = T.trace(img, {});
  const { svg, pathCount } = T.buildSvg(traced.chains, 200, 200, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth
  });
  // the line merges back through the junction; the hair must be gone
  check('hair pruned, line continuous', pathCount === 1, `got ${pathCount}`);
  const ys = [...svg.matchAll(/<path d="([^"]*)"/g)]
    .flatMap(m => m[1].match(/-?[\d.]+/g).map(Number).filter((_, i) => i % 2 === 1));
  check('nothing pokes below the line', Math.max(...ys) < 108, `max y ${Math.max(...ys)}`);
}

// --- 13. round marks become dots, not random ticks --------------------------
console.log('13. roundish blobs render as dots');
{
  const img = makeImage(200, 100, WHITE);
  for (const x of [50, 100, 150]) stamp(img, x, 50, 3, BLACK); // ~7px blobs
  const traced = T.trace(img, {});
  const { svg, pathCount } = T.buildSvg(traced.chains, 200, 100, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth
  });
  check('3 dots kept', pathCount === 3, `got ${pathCount}`);
  check('rendered as dots', (svg.match(/l 0\.01 0/g) || []).length === 3,
    `got ${(svg.match(/l 0\.01 0/g) || []).length}`);
}

// --- 14. transparent margins do not force alpha mode ------------------------
console.log('14. image with transparent margins still traces by luminance');
{
  const img = makeImage(200, 100, WHITE);
  for (let y = 0; y < 100; y++) // left 40px: transparent margin
    for (let x = 0; x < 40; x++) img.data[(y * 200 + x) * 4 + 3] = 0;
  drawSegment(img, 60, 50, 180, 50, 5, BLACK);
  const traced = T.trace(img, {});
  check('mode = dark (not alpha)', traced.mode === 'dark', `got ${traced.mode}`);
  check('exactly 1 chain', keptChains(traced, 4).length === 1);
}

// --- 15. junction knot rings collapse, real loops stay -----------------------
console.log('15. tiny junction rings collapse, real loops stay');
{
  const ring = (r, width) => {
    const pts = [];
    for (let a = 0; a < Math.PI * 2; a += 0.2) pts.push([50 + r * Math.cos(a), 50 + r * Math.sin(a)]);
    return { closed: true, points: pts, width, geomLength: 2 * Math.PI * r, endDeg: [2, 2] };
  };
  // circumference 25 on a 10px-wide line = skeleton knot; 126 on 2px = drawn loop
  const { pathCount } = T.buildSvg([ring(4, 10), ring(20, 2)], 100, 100, { minLength: 3 });
  check('knot dropped, real loop kept', pathCount === 1, `got ${pathCount}`);
}

// --- 16. wobbly thick strokes get straight centerlines ----------------------
console.log('16. wobbly thick line straightens (width-adaptive simplify)');
{
  const img = makeImage(300, 100, WHITE);
  for (let x = 20; x <= 280; x++) stamp(img, x, 50 + 2 * Math.sin(x / 7), 6, BLACK);
  const traced = T.trace(img, {});
  const { pathCount, pointCount } = T.buildSvg(traced.chains, 300, 100, { simplify: 1, minLength: 3 });
  check('one chain', pathCount === 1, `got ${pathCount}`);
  check('centerline collapses to few points', pointCount <= 8, `got ${pointCount}`);
  // fine 2px line with the same wobble must KEEP its shape
  const img2 = makeImage(300, 100, WHITE);
  for (let x = 20; x <= 280; x++) stamp(img2, x, 50 + 4 * Math.sin(x / 12), 1.2, BLACK);
  const traced2 = T.trace(img2, {});
  const kept2 = keptChains(traced2, 4).map(c => T.simplifyChain(c, 1));
  const ys = kept2.flatMap(c => c.points.map(p => p[1]));
  check('thin wavy line keeps its wave', Math.max(...ys) - Math.min(...ys) > 5,
    `y-range ${(Math.max(...ys) - Math.min(...ys)).toFixed(1)}`);
}

// --- 17. REAL fashion flat (the user's actual image) -------------------------
console.log('17. real bodysuit flat traces cleanly');
{
  const zlib = require('zlib');
  const bmp = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'bodysuit.bmp.gz')));
  // minimal BMP reader (sips output: uncompressed, bottom-up, BGR)
  const dataOffset = bmp.readUInt32LE(10), bw = bmp.readInt32LE(18);
  let bh = bmp.readInt32LE(22);
  const bpp = bmp.readUInt16LE(28), bottomUp = bh > 0;
  bh = Math.abs(bh);
  const bytesPP = bpp / 8, stride = Math.ceil((bw * bpp) / 32) * 4;
  const raw = new Uint8ClampedArray(bw * bh * 4);
  for (let y = 0; y < bh; y++) {
    const srcY = bottomUp ? bh - 1 - y : y;
    for (let x = 0; x < bw; x++) {
      const s = dataOffset + srcY * stride + x * bytesPP, d = (y * bw + x) * 4;
      raw[d] = bmp[s + 2]; raw[d + 1] = bmp[s + 1]; raw[d + 2] = bmp[s];
      raw[d + 3] = bytesPP === 4 ? bmp[s + 3] : 255;
    }
  }
  // bilinear 2x upscale, mimicking the plugin's smoothed canvas upsampling
  const W = bw * 2, H = bh * 2;
  const up = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(bh - 1.001, Math.max(0, (y + 0.5) / 2 - 0.5));
    const y0 = Math.floor(sy), fy = sy - y0, y1 = Math.min(bh - 1, y0 + 1);
    for (let x = 0; x < W; x++) {
      const sx = Math.min(bw - 1.001, Math.max(0, (x + 0.5) / 2 - 0.5));
      const x0 = Math.floor(sx), fx = sx - x0, x1 = Math.min(bw - 1, x0 + 1);
      for (let ch = 0; ch < 4; ch++) {
        up[(y * W + x) * 4 + ch] =
          raw[(y0 * bw + x0) * 4 + ch] * (1 - fx) * (1 - fy) +
          raw[(y0 * bw + x1) * 4 + ch] * fx * (1 - fy) +
          raw[(y1 * bw + x0) * 4 + ch] * (1 - fx) * fy +
          raw[(y1 * bw + x1) * 4 + ch] * fx * fy;
      }
    }
  }
  const img = { width: W, height: H, data: up };
  const traced = T.trace(img, {});
  check('detected dark lines', traced.mode === 'dark', `got ${traced.mode}`);
  check('threshold tuned stricter than plain Otsu', traced.threshold < 136 && traced.threshold > 60,
    `got ${traced.threshold}`);
  const dashes = traced.chains.filter(c =>
    !c.closed && c.points.length >= 3 && c.geomLength < 30 && c.width < 6);
  check('stitching dashes survive (>=80)', dashes.length >= 80, `got ${dashes.length}`);
  const { pathCount, weights } = T.buildSvg(traced.chains, W, H, {
    simplify: 1, smooth: true, minLength: 3, stroke: traced.inkColor,
    strokeWidth: traced.avgStrokeWidth * (1254 / W),
    matchWeights: true, avgWidth: traced.avgStrokeWidth, outW: 1254, outH: 1254
  });
  check('reasonable line count', pathCount > 120 && pathCount < 400, `got ${pathCount}`);
  check('2-6 weight classes', weights.length >= 2 && weights.length <= 6, `got ${weights.length}`);
  const ratio = weights[0] / weights[weights.length - 1];
  check('outline much thicker than stitching', ratio > 2.5 && ratio < 12, `ratio ${ratio.toFixed(1)}`);
}

// --- 18. pen-tool-like anchors: few points, corners stay sharp ---------------
console.log('18. curve fitting uses few anchors, keeps corners sharp');
{
  // a big circle should fit with a handful of segments, not dozens
  const img = makeImage(400, 400, WHITE);
  drawCircle(img, 200, 200, 150, 9, BLACK);
  const traced = T.trace(img, {});
  const { pathCount, pointCount, svg } = T.buildSvg(traced.chains, 400, 400, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth
  });
  check('circle = 1 line', pathCount === 1, `got ${pathCount}`);
  check('circle uses few anchors (<= 8)', pointCount <= 8, `got ${pointCount}`);
  // fitted CURVE must lie on the ring (control points legitimately overshoot)
  const nums = (svg.match(/d="([^"]*)"/)[1].match(/-?[\d.]+/g) || []).map(Number);
  const rTrue = Math.hypot(nums[0] - 200.5, nums[1] - 200.5); // first anchor
  let maxDev = 0;
  let prev = [nums[0], nums[1]];
  for (let i = 2; i + 5 < nums.length; i += 6) {
    const c1 = [nums[i], nums[i + 1]], c2 = [nums[i + 2], nums[i + 3]], p3 = [nums[i + 4], nums[i + 5]];
    for (const t of [0.25, 0.5, 0.75]) {
      const u = 1 - t;
      const x = u*u*u*prev[0] + 3*u*u*t*c1[0] + 3*u*t*t*c2[0] + t*t*t*p3[0];
      const y = u*u*u*prev[1] + 3*u*u*t*c1[1] + 3*u*t*t*c2[1] + t*t*t*p3[1];
      maxDev = Math.max(maxDev, Math.abs(Math.hypot(x - 200.5, y - 200.5) - rTrue));
    }
    prev = p3;
  }
  check('fitted curve stays on the ring (<=4px dev)', maxDev <= 4, `max dev ${maxDev.toFixed(2)}`);

  // an L must keep its sharp corner as an anchor, with few points
  const img2 = makeImage(300, 300, WHITE);
  drawSegment(img2, 80, 60, 80, 220, 9, BLACK);
  drawSegment(img2, 80, 220, 230, 220, 9, BLACK);
  const t2 = T.trace(img2, {});
  const chains2 = keptChains(t2, 6);
  check('L merges to one chain', chains2.length === 1, `got ${chains2.length}`);
  const d = T.chainToPathData({ closed: false, points: chains2[0].points }, true, 2);
  const anchors = (d.match(/[MCL]/g) || []).length;
  check('L uses few anchors (<= 5)', anchors <= 5, `got ${anchors}: ${d.slice(0, 120)}`);
  // one anchor must sit at the corner (~80,220)
  const anchorPts = parsePath(d).anchors;
  check('corner kept sharp', anchorPts.some(p => Math.hypot(p[0] - 80.5, p[1] - 220.5) < 7),
    `anchors: ${anchorPts.map(p => p.map(Math.round).join(',')).join(' | ')}`);
}

// --- 19. anchors at extremes; true circles snap to perfect ------------------
console.log('19. anchors at extremes; true circles snap perfect');
{
  const img = makeImage(400, 400, WHITE);
  drawCircle(img, 200, 200, 150, 9, BLACK);
  const traced = T.trace(img, {});
  const { svg, pointCount } = T.buildSvg(traced.chains, 400, 400, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth
  });
  check('circle = 4 segments (5 anchor tokens)', pointCount === 5, `got ${pointCount}`);
  const nums = svg.match(/d="([^"]*)"/)[1].match(/-?[\d.]+/g).map(Number);
  const anchors = [[nums[0], nums[1]]];
  for (let i = 2; i + 5 < nums.length; i += 6) anchors.push([nums[i + 4], nums[i + 5]]);
  const c = [200.5, 200.5];
  const r = Math.hypot(anchors[0][0] - c[0], anchors[0][1] - c[1]);
  const cardinals = [[c[0], c[1] - r], [c[0] + r, c[1]], [c[0], c[1] + r], [c[0] - r, c[1]]];
  check('anchors sit at top/right/bottom/left',
    cardinals.every(cp => anchors.some(a => Math.hypot(a[0] - cp[0], a[1] - cp[1]) < 3)),
    `anchors: ${anchors.map(a => a.map(Math.round).join(',')).join(' | ')}`);
  check('radius matches the drawing', near(r, 150, 4), `r=${r.toFixed(1)}`);

  // open smile arc: middle anchor at its lowest point with horizontal handles
  const img2 = makeImage(300, 200, WHITE);
  for (let a = 0.35; a <= Math.PI - 0.35; a += 0.004)
    stamp(img2, 150 + 100 * Math.cos(a), 60 + 70 * Math.sin(a), 4.5, BLACK);
  const t2 = T.trace(img2, {});
  const chains2 = keptChains(t2, 6);
  check('smile = 1 chain', chains2.length === 1, `got ${chains2.length}`);
  const d2 = T.chainToPathData({ closed: false, points: chains2[0].points }, true, 2);
  const n2 = d2.match(/-?[\d.]+/g).map(Number);
  const anchors2 = [[n2[0], n2[1]]];
  const ctrls = [];
  for (let i = 2; i + 5 < n2.length; i += 6) {
    ctrls.push([[n2[i], n2[i + 1]], [n2[i + 2], n2[i + 3]]]);
    anchors2.push([n2[i + 4], n2[i + 5]]);
  }
  let low = 0;
  for (let i = 1; i < anchors2.length; i++) if (anchors2[i][1] > anchors2[low][1]) low = i;
  const bottom = anchors2[low];
  check('smile anchor at the lowest point', near(bottom[0], 150.5, 8) && near(bottom[1], 130.5, 4),
    `got ${bottom.map(v => v.toFixed(1)).join(',')}`);
  const hOk = (low === 0 || Math.abs(ctrls[low - 1][1][1] - bottom[1]) < 0.6) &&
              (low >= ctrls.length || Math.abs(ctrls[low][0][1] - bottom[1]) < 0.6);
  check('its handles are horizontal', hOk);
}

// --- 20. globe icon: lines stay true through multi-way junctions ------------
console.log('20. globe icon survives its junctions');
{
  const img = makeImage(600, 600, WHITE);
  drawCircle(img, 300, 300, 220, 18, BLACK); // outer rim
  // meridian ellipse through both poles (tangential junctions — worst case)
  {
    const steps = Math.ceil(2 * Math.PI * 220 * 2);
    for (let s = 0; s <= steps; s++) {
      const u = (s / steps) * 2 * Math.PI;
      stamp(img, 300 + 100 * Math.cos(u), 300 + 220 * Math.sin(u), 9, BLACK);
    }
  }
  drawSegment(img, 92, 190, 508, 190, 18, BLACK);  // upper bar (chord)
  drawSegment(img, 82, 410, 518, 410, 18, BLACK);  // lower bar (chord)
  const traced = T.trace(img, {});

  // each bar must come out as one straight through-chain, not bent fragments
  const bars = traced.chains.filter(c => {
    const xs = c.points.map(p => p[0]), ys = c.points.map(p => p[1]);
    return Math.max(...xs) - Math.min(...xs) > 300 &&
           Math.max(...ys) - Math.min(...ys) < 14;
  });
  check('2 straight through-bars', bars.length === 2, `got ${bars.length}`);
  for (const bar of bars) {
    const ys = bar.points.map(p => p[1]);
    const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
    const maxDev = Math.max(...ys.map(y => Math.abs(y - mean)));
    check('bar stays straight through junctions (<=5px)', maxDev <= 5, `dev ${maxDev.toFixed(1)}`);
  }

  // the outer rim must close into a round ring despite 6 junctions on it
  const rings = traced.chains.filter(c => c.closed && c.points.length > 100);
  const rim = rings.map(c => {
    const rs = c.points.map(p => Math.hypot(p[0] - 300.5, p[1] - 300.5));
    return { c, min: Math.min(...rs), max: Math.max(...rs) };
  }).filter(r => r.min > 180 && r.max < 260)[0];
  check('rim is a closed ring', !!rim);
  if (rim) check('rim stays round through junctions (<=9px dev)',
    rim.max - rim.min <= 18, `radius spread ${(rim.max - rim.min).toFixed(1)}`);
}

// --- 21. THICK-stroke globe (icon-style): junctions, few anchors, round rim --
console.log('21. thick-stroke globe stays clean and light');
{
  // drawn at 2x, matching the plugin's upsampled tracing resolution
  const S = 2048;
  const img = makeImage(S, S, WHITE);
  const cx = 1024, cy = 1024, R = 860, T2 = 46;
  const steps = Math.ceil(2 * Math.PI * R * 1.2);
  for (let s = 0; s <= steps; s++) {
    const a = (s / steps) * 2 * Math.PI;
    stamp(img, cx + R * Math.cos(a), cy + R * Math.sin(a), T2, BLACK);
    stamp(img, cx + 400 * Math.cos(a), cy + R * Math.sin(a), T2, BLACK);
  }
  const half = Math.sqrt(R * R - 430 * 430);
  for (let t = -1; t <= 1; t += 0.001) {
    stamp(img, cx + t * half, cy - 430, T2, BLACK);
    stamp(img, cx + t * half, cy + 430, T2, BLACK);
  }
  const traced = T.trace(img, {});
  const { svg, pathCount, pointCount } = T.buildSvg(traced.chains, S, S, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth
  });
  check('few lines (<= 8)', pathCount <= 8, `got ${pathCount}`);
  check('few anchors (<= 32)', pointCount <= 32, `got ${pointCount}`);
  // the rim must snap: 4 cardinal anchors equidistant from center
  const subs = svg.match(/d="([^"]*)"/g).join(' ').split('M ').filter(s => /Z/.test(s));
  const snapped = subs.some(s => {
    const nums = s.match(/-?[\d.]+/g).map(Number);
    const anchors = [[nums[0], nums[1]]];
    for (let i = 2; i + 5 < nums.length; i += 6) anchors.push([nums[i + 4], nums[i + 5]]);
    if (anchors.length > 6) return false;
    const rs = anchors.map(a => Math.hypot(a[0] - (cx + 0.5), a[1] - (cy + 0.5)));
    const mean = rs.reduce((x, y) => x + y, 0) / rs.length;
    return mean > 760 && rs.every(r => Math.abs(r - mean) < 4);
  });
  check('rim snapped to a perfect circle', snapped);
  // no stray mega-jumps outside closed rings (misrouted bridges)
  const stray = traced.chains.some(c => {
    if (c.closed) return false;
    for (let i = 1; i < c.points.length; i++)
      if (Math.hypot(c.points[i][0] - c.points[i - 1][0],
                     c.points[i][1] - c.points[i - 1][1]) > 520) return true;
    return false;
  });
  check('no misrouted bridges', !stray);
}

// --- 22. straight lines stay straight ----------------------------------------
console.log('22. ruler lines: 2 anchors, no swivel, axis-snapped');
{
  const img = makeImage(600, 300, WHITE);
  drawSegment(img, 30, 80, 570, 80, 7, BLACK);   // horizontal
  drawSegment(img, 30, 160, 570, 179, 7, BLACK); // deliberately tilted ~2°
  const traced = T.trace(img, {});
  const chains = keptChains(traced, 6).sort((a, b) => a.points[0][1] - b.points[0][1]);
  check('2 chains', chains.length === 2, `got ${chains.length}`);
  const dH = T.chainToPathData({ closed: false, points: chains[0].points }, true, 2.1);
  const h = parsePath(dH);
  check('horizontal: 2 anchors, straight L', h.anchors.length === 2 && h.ctrls[0] === null, dH);
  check('horizontal: perfectly level', h.anchors[0][1] === h.anchors[1][1],
    `y ${h.anchors[0][1]} vs ${h.anchors[1][1]}`);
  const dT = T.chainToPathData({ closed: false, points: chains[1].points }, true, 2.1);
  const t = parsePath(dT);
  check('tilted: still a straight L', t.anchors.length === 2 && t.ctrls[0] === null, dT);
  check('tilted: tilt preserved (no false snap)', Math.abs(t.anchors[1][1] - t.anchors[0][1]) > 12,
    `dy ${(t.anchors[1][1] - t.anchors[0][1]).toFixed(1)}`);

  // rectangle: 4 sharp corners, 4 straight sides, zero curve handles
  const img2 = makeImage(400, 300, WHITE);
  drawSegment(img2, 60, 60, 340, 60, 8, BLACK);
  drawSegment(img2, 340, 60, 340, 240, 8, BLACK);
  drawSegment(img2, 340, 240, 60, 240, 8, BLACK);
  drawSegment(img2, 60, 240, 60, 60, 8, BLACK);
  const t2 = T.trace(img2, {});
  const r2 = T.buildSvg(t2.chains, 400, 300, {
    minLength: 3, matchWeights: true, avgWidth: t2.avgStrokeWidth,
    strokeWidth: t2.avgStrokeWidth
  });
  check('rectangle = 1 closed chain', r2.pathCount === 1, `got ${r2.pathCount}`);
  const d2 = r2.svg.match(/d="([^"]*)"/)[1];
  check('4 straight sides, no curves', (d2.match(/L/g) || []).length === 4 && !/C/.test(d2),
    d2.slice(0, 140));
  const corners = [[60.5, 60.5], [340.5, 60.5], [340.5, 240.5], [60.5, 240.5]];
  const rectAnchors = parsePath(d2).anchors;
  check('anchors at the 4 corners',
    corners.every(cp => rectAnchors.some(a => Math.hypot(a[0] - cp[0], a[1] - cp[1]) < 5)),
    `anchors: ${rectAnchors.map(a => a.map(Math.round).join(',')).join(' | ')}`);
}

// --- 23. noisy source: pinholes inside strokes must not shred the trace ------
console.log('23. pinholes + rough edges (JPEG-style noise) stay clean');
{
  const S = 1400;
  const img = makeImage(S, S, WHITE);
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const cx = 700, cy = 700, R = 560, T2 = 32;
  const steps = Math.ceil(2 * Math.PI * R * 1.2);
  for (let s = 0; s <= steps; s++) {
    const a = (s / steps) * 2 * Math.PI;
    stamp(img, cx + R * Math.cos(a), cy + R * Math.sin(a), T2 + 3 * Math.sin(a * 73) * rnd(), BLACK);
    stamp(img, cx + 260 * Math.cos(a), cy + R * Math.sin(a), T2 + 3 * Math.sin(a * 61) * rnd(), BLACK);
  }
  const half = Math.sqrt(R * R - 280 * 280);
  for (let t = -1; t <= 1; t += 0.001) {
    stamp(img, cx + t * half, cy - 280, T2, BLACK);
    stamp(img, cx + t * half, cy + 280, T2, BLACK);
  }
  // punch light pinholes inside the ink (JPEG mottling)
  const LIGHT = [170, 170, 170, 255];
  for (let i = 0; i < 2500; i++) {
    const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
    if (img.data[(y * S + x) * 4] < 100) stamp(img, x, y, 1 + rnd() * 2, LIGHT);
  }
  const traced = T.trace(img, {});
  const { pathCount, pointCount } = T.buildSvg(traced.chains, S, S, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth
  });
  check('no ladder shredding (<= 9 lines)', pathCount <= 9, `got ${pathCount}`);
  check('anchors stay bounded (<= 60)', pointCount <= 60, `got ${pointCount}`);
}

// --- 24. nearest-neighbor upscaled icon: staircase edges must not add anchors
console.log('24. staircase (NN-upscaled) globe traces light and smooth');
{
  const s0 = 160;
  const small = makeImage(s0, s0, WHITE);
  const c0 = 80, R0 = 67, W0 = 3.6;
  for (let a = 0; a < 2 * Math.PI; a += 0.004) {
    stamp(small, c0 + R0 * Math.cos(a), c0 + R0 * Math.sin(a), W0, BLACK);
    stamp(small, c0 + 31 * Math.cos(a), c0 + R0 * Math.sin(a), W0, BLACK);
  }
  const half0 = Math.sqrt(R0 * R0 - 33 * 33);
  for (let t = -1; t <= 1; t += 0.004) {
    stamp(small, c0 + t * half0, c0 - 33, W0, BLACK);
    stamp(small, c0 + t * half0, c0 + 33, W0, BLACK);
  }
  // nearest-neighbor x8 (blocky upscale), then bilinear x2 like the plugin
  const s1 = s0 * 8, S = s1 * 2;
  const big = new Uint8ClampedArray(s1 * s1 * 4);
  for (let y = 0; y < s1; y++)
    for (let x = 0; x < s1; x++) {
      const so = (((y >> 3) * s0) + (x >> 3)) * 4, d = (y * s1 + x) * 4;
      big[d] = small.data[so]; big[d + 1] = small.data[so + 1];
      big[d + 2] = small.data[so + 2]; big[d + 3] = 255;
    }
  const up = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    const sy = Math.min(s1 - 1.001, Math.max(0, (y + 0.5) / 2 - 0.5));
    const y0 = Math.floor(sy), fy = sy - y0, y1 = Math.min(s1 - 1, y0 + 1);
    for (let x = 0; x < S; x++) {
      const sx = Math.min(s1 - 1.001, Math.max(0, (x + 0.5) / 2 - 0.5));
      const x0 = Math.floor(sx), fx = sx - x0, x1 = Math.min(s1 - 1, x0 + 1);
      for (let ch = 0; ch < 4; ch++)
        up[(y * S + x) * 4 + ch] =
          big[(y0 * s1 + x0) * 4 + ch] * (1 - fx) * (1 - fy) +
          big[(y0 * s1 + x1) * 4 + ch] * fx * (1 - fy) +
          big[(y1 * s1 + x0) * 4 + ch] * (1 - fx) * fy +
          big[(y1 * s1 + x1) * 4 + ch] * fx * fy;
    }
  }
  const traced = T.trace({ width: S, height: S, data: up }, {});
  const { pathCount, pointCount } = T.buildSvg(traced.chains, S, S, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth
  });
  check('few lines (<= 8)', pathCount <= 8, `got ${pathCount}`);
  check('staircase adds no anchor trains (<= 34)', pointCount <= 34, `got ${pointCount}`);
}

// --- 25. LOW-QUALITY source: fuzzy gray strokes + speckle noise --------------
console.log('25. low-quality icon (fuzz + pepper noise) auto-denoises');
{
  const S = 900;
  const img = makeImage(S, S, [235, 235, 235, 255]); // dingy background
  let seed = 3;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const GRAY = [110, 110, 110, 255];
  for (let a = 0; a < 2 * Math.PI; a += 0.002)
    stamp(img, 450 + 300 * Math.cos(a), 450 + 300 * Math.sin(a), 14, GRAY);
  for (let t = -1; t <= 1; t += 0.002) stamp(img, 450 + t * 290, 450, 14, GRAY);
  // fuzzy edge fringe + background pepper (bad screenshot / scan quality)
  for (let i = 0; i < 6000; i++) {
    const a = rnd() * 2 * Math.PI, edge = rnd() < 0.7;
    const px = edge ? 450 + (300 + (rnd() - 0.5) * 36) * Math.cos(a) : 450 + (rnd() * 2 - 1) * 290;
    const py = edge ? 450 + (300 + (rnd() - 0.5) * 36) * Math.sin(a) : 450 + (rnd() - 0.5) * 36;
    const v = 100 + rnd() * 60;
    stamp(img, px, py, 1 + rnd() * 1.6, [v, v, v, 255]);
  }
  for (let i = 0; i < 700; i++) {
    const v = 140 + rnd() * 60;
    stamp(img, rnd() * S, rnd() * S, 0.8 + rnd(), [v, v, v, 255]);
  }
  const traced = T.trace(img, {});
  const { pathCount, pointCount } = T.buildSvg(traced.chains, S, S, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth
  });
  check('denoise chosen automatically', traced.preprocess === 'blur', `got ${traced.preprocess}`);
  check('clean structure (<= 6 lines)', pathCount <= 6, `got ${pathCount}`);
  check('few anchors (<= 20)', pointCount <= 20, `got ${pointCount}`);
}

// --- 26. finishing: cap and join styles measured from the ink ---------------
console.log('26. flat/round caps and miter/round joins detected');
{
  // flat-capped bar (filled rectangle) and round-capped bar (disc pen),
  // each traced alone so the path attribution is unambiguous
  const traceBar = draw => {
    const im = makeImage(400, 120, WHITE);
    draw(im);
    const tr = T.trace(im, {});
    const { svg } = T.buildSvg(tr.chains, 400, 120, {
      minLength: 3, matchWeights: true, avgWidth: tr.avgStrokeWidth,
      strokeWidth: tr.avgStrokeWidth, ink: tr.ink
    });
    const m = svg.match(/<path d="([^"]*)"[^>]*stroke-linecap="([^"]*)"/);
    const xs = m[1].match(/-?[\d.]+/g).map(Number).filter((_, i) => i % 2 === 0);
    return { cap: m[2], span: Math.max(...xs) - Math.min(...xs) };
  };
  const flat = traceBar(im => fillRect(im, 60, 56, 340, 65, BLACK));
  const round = traceBar(im => drawSegment(im, 60, 60, 340, 60, 9, BLACK));
  check('flat bar -> butt cap', flat.cap === 'butt', flat.cap);
  check('round bar -> round cap', round.cap === 'round', round.cap);
  check('flat bar reaches its faces', flat.span > 274, `span ${flat.span.toFixed(1)}`);

  // sharp-cornered frame (miter) vs disc-pen rectangle (round joins)
  const img2 = makeImage(320, 260, WHITE);
  fillRect(img2, 60, 60, 260, 200, BLACK);
  fillRect(img2, 69, 69, 251, 191, WHITE); // 9px frame, sharp corners
  const t2 = T.trace(img2, {});
  const r2 = T.buildSvg(t2.chains, 320, 260, {
    minLength: 3, matchWeights: true, avgWidth: t2.avgStrokeWidth,
    strokeWidth: t2.avgStrokeWidth, ink: t2.ink
  });
  check('sharp frame -> miter join', /stroke-linejoin="miter"/.test(r2.svg),
    (r2.svg.match(/stroke-linejoin="[^"]*"/g) || []).join(' '));
  const img3 = makeImage(320, 260, WHITE);
  drawSegment(img3, 60, 60, 260, 60, 9, BLACK);
  drawSegment(img3, 260, 60, 260, 200, 9, BLACK);
  drawSegment(img3, 260, 200, 60, 200, 9, BLACK);
  drawSegment(img3, 60, 200, 60, 60, 9, BLACK);
  const t3 = T.trace(img3, {});
  const r3 = T.buildSvg(t3.chains, 320, 260, {
    minLength: 3, matchWeights: true, avgWidth: t3.avgStrokeWidth,
    strokeWidth: t3.avgStrokeWidth, ink: t3.ink
  });
  check('round-pen rectangle -> round join', !/stroke-linejoin="miter"/.test(r3.svg),
    (r3.svg.match(/stroke-linejoin="[^"]*"/g) || []).join(' '));
}

// --- 27. LOW-RES icon: upscale-then-trace keeps it crisp ---------------------
console.log('27. low-res technical icon (320px) traces sharp, not blobby');
{
  // crisp icon drawn small: flat-capped bars, sharp frame corner, wall line,
  // dots — like a downloaded 300px pictogram
  const s0 = { width: 320, height: 280, data: null };
  const img = makeImage(320, 280, WHITE);
  fillRect(img, 200, 40, 216, 120, BLACK);   // upper plug arm
  fillRect(img, 200, 160, 216, 240, BLACK);  // lower plug arm
  fillRect(img, 60, 132, 208, 148, BLACK);   // nail shaft (flat left end)
  fillRect(img, 280, 30, 288, 250, BLACK);   // wall line
  stamp(img, 250, 60, 4, BLACK);             // debris dots
  stamp(img, 252, 140, 4, BLACK);
  stamp(img, 248, 220, 4, BLACK);
  // mimic the plugin: low-res source upscaled to the 1400px working size
  const up = bilinearResize(img, 1400, 1225);
  const traced = T.trace(up, {});
  const { svg, pathCount, pointCount } = T.buildSvg(traced.chains, up.width, up.height, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth, ink: traced.ink
  });
  check('structure preserved (4-9 lines)', pathCount >= 4 && pathCount <= 9, `got ${pathCount}`);
  check('anchors stay low (<= 40)', pointCount <= 40, `got ${pointCount}`);
  check('flat caps detected', /stroke-linecap="butt"/.test(svg),
    (svg.match(/stroke-linecap="[^"]*"/g) || []).join(' '));
  check('straight bars stay straight (has L segments)', / L /.test(svg));
  const dotCount = (svg.match(/l 0\.01 0/g) || []).length;
  check('dots survive the upscale', dotCount >= 2, `got ${dotCount}`);
}

// --- 28. skeleton breaks at sharp corners are rejoined with a sharp apex ----
console.log('28. flared shape: broken corners rejoined, apex kept sharp');
{
  // flared trapezoid head drawn crisp, degraded to 340px, retraced at ~4x —
  // thinning retracts from the sharp flare corners and breaks the ring
  const art = makeImage(680, 600, WHITE);
  drawSegment(art, 120, 140, 120, 460, 12, BLACK);
  drawSegment(art, 120, 140, 230, 200, 12, BLACK);
  drawSegment(art, 120, 460, 230, 400, 12, BLACK);
  drawSegment(art, 230, 200, 230, 400, 12, BLACK);
  const low = bilinearResize(art, 340, 300);
  const up = bilinearResize(low, 1400, 1235);
  const traced = T.trace(up, {});
  const ring = traced.chains.filter(c => c.closed && (c.geomLength || 0) > 1200);
  check('head ring closed through its corners', ring.length === 1, `got ${ring.length}`);
  const { svg } = T.buildSvg(traced.chains, up.width, up.height, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth, ink: traced.ink
  });
  const sub = svg.match(/d="([^"]*)"/)[1].split('M ').filter(Boolean)
    .sort((a, b) => b.length - a.length)[0];
  const { anchors } = parsePath('M ' + sub);
  let straightSide = false;
  for (let i = 1; i < anchors.length; i++) {
    if (Math.abs(anchors[i][0] - anchors[i - 1][0]) < 5 &&
        Math.abs(anchors[i][1] - anchors[i - 1][1]) > 550) straightSide = true;
  }
  check('left side is one straight vertical segment', straightSide,
    `anchors: ${anchors.map(a => a.map(Math.round).join(',')).join(' | ')}`);
  const apexTop = anchors.some(a => Math.hypot(a[0] - 250, a[1] - 293) < 20);
  const apexBot = anchors.some(a => Math.hypot(a[0] - 250, a[1] - 941) < 20);
  check('sharp anchors at both rebuilt apexes', apexTop && apexBot);
}

// --- 29. keyline primitives: rectangles snap sharp or uniformly rounded -----
console.log('29. rectangles snap to the keyline primitive');
{
  const img = makeImage(320, 260, WHITE);
  fillRect(img, 60, 60, 260, 200, BLACK);
  fillRect(img, 69, 69, 251, 191, WHITE); // sharp 9px frame
  const t1 = T.trace(img, {});
  const r1 = T.buildSvg(t1.chains, 320, 260, {
    minLength: 3, matchWeights: true, avgWidth: t1.avgStrokeWidth,
    strokeWidth: t1.avgStrokeWidth, ink: t1.ink
  });
  const d1 = r1.svg.match(/d="([^"]*)"/)[1];
  check('sharp frame = 4 straight sides, no curves',
    (d1.match(/L/g) || []).length === 4 && !/C/.test(d1), d1.slice(0, 120));
  const a1 = parsePath(d1).anchors;
  const axisAligned = a1.every((p, i) => {
    if (!i) return true;
    return Math.abs(p[0] - a1[i - 1][0]) < 0.01 || Math.abs(p[1] - a1[i - 1][1]) < 0.01;
  });
  check('sides exactly axis-aligned', axisAligned,
    a1.map(p => p.map(v => v.toFixed(1)).join(',')).join(' | '));

  // rounded rectangle (radius 30) must keep its uniform rounding
  const img2 = makeImage(340, 280, WHITE);
  const rr = 30;
  for (const [x0, y0, x1, y1] of [[70 + rr, 60, 270 - rr, 60], [70 + rr, 220, 270 - rr, 220]])
    drawSegment(img2, x0, y0, x1, y1, 9, BLACK);
  for (const [x0, y0, x1, y1] of [[70, 60 + rr, 70, 220 - rr], [270, 60 + rr, 270, 220 - rr]])
    drawSegment(img2, x0, y0, x1, y1, 9, BLACK);
  for (const [cx, cy, a0] of [[70 + rr, 60 + rr, Math.PI], [270 - rr, 60 + rr, 1.5 * Math.PI],
                              [270 - rr, 220 - rr, 0], [70 + rr, 220 - rr, 0.5 * Math.PI]])
    for (let a = a0; a <= a0 + Math.PI / 2; a += 0.01)
      stamp(img2, cx + rr * Math.cos(a), cy + rr * Math.sin(a), 4.5, BLACK);
  const t2 = T.trace(img2, {});
  const r2 = T.buildSvg(t2.chains, 340, 280, {
    minLength: 3, matchWeights: true, avgWidth: t2.avgStrokeWidth,
    strokeWidth: t2.avgStrokeWidth, ink: t2.ink
  });
  const d2 = r2.svg.match(/d="([^"]*)"/)[1];
  check('rounded rect = 4 sides + 4 arc corners',
    (d2.match(/L/g) || []).length === 4 && (d2.match(/C/g) || []).length === 4,
    `L=${(d2.match(/L/g) || []).length} C=${(d2.match(/C/g) || []).length}`);
}

// --- 30. icon angles: 45° diagonals snap; acute tips stay sharp -------------
console.log('30. diagonals snap to 45°, chevron tips come to a point');
{
  const img = makeImage(300, 200, WHITE);
  drawSegment(img, 40, 60, 100, 1.5 + 60 + 57, 7, BLACK);  // ~43.6°
  drawSegment(img, 130, 60, 190, 60 + 61.5, 7, BLACK);     // ~45.7°
  const traced = T.trace(img, {});
  const { svg } = T.buildSvg(traced.chains, 300, 200, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth, ink: traced.ink
  });
  let snapped = 0;
  for (const sub of svg.match(/d="([^"]*)"/)[1].split('M ').filter(Boolean)) {
    const nums = sub.match(/-?[\d.]+/g).map(Number);
    if (nums.length === 4 && Math.abs(Math.abs(nums[2] - nums[0]) - Math.abs(nums[3] - nums[1])) < 0.02)
      snapped++;
  }
  check('both near-45° ticks snap to exactly 45°', snapped === 2, `got ${snapped}`);

  // free-standing chevron: acute tip must be a sharp apex, not an arch
  const img2 = makeImage(260, 240, WHITE);
  drawSegment(img2, 70, 60, 160, 120, 12, BLACK);
  drawSegment(img2, 70, 180, 160, 120, 12, BLACK);
  const t2 = T.trace(img2, {});
  const chains2 = keptChains(t2, 6);
  check('chevron = one chain', chains2.length === 1, `got ${chains2.length}`);
  const r2 = T.buildSvg(t2.chains, 260, 240, {
    minLength: 3, matchWeights: true, avgWidth: t2.avgStrokeWidth,
    strokeWidth: t2.avgStrokeWidth, ink: t2.ink
  });
  const anchors2 = parsePath(r2.svg.match(/d="([^"]*)"/)[1]).anchors;
  check('tip apex anchor at the point', anchors2.some(p => Math.hypot(p[0] - 160.5, p[1] - 120.5) < 9),
    anchors2.map(p => p.map(Math.round).join(',')).join(' | '));
}

// --- 31. rectangle snap must never swallow structure (notches, bites) -------
console.log('31. notched ring keeps its notch (no over-snap to rectangle)');
{
  const pts = [];
  const push = (x1, y1, x2, y2) => {
    const n = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
    for (let i = 0; i < n; i++) pts.push([x1 + (x2 - x1) * i / n, y1 + (y2 - y1) * i / n]);
  };
  push(100, 100, 200, 100); push(200, 100, 200, 500); push(200, 500, 100, 500);
  push(100, 500, 100, 345); push(100, 345, 140, 345); push(140, 345, 140, 255);
  push(140, 255, 100, 255); push(100, 255, 100, 100);
  const d = T.chainToPathData({ closed: true, points: pts }, true, 3);
  check('not flattened to a plain rectangle',
    /C/.test(d) || (d.match(/L/g) || []).length > 5, d.slice(0, 100));
  const a = parsePath(d).anchors;
  check('notch corners preserved',
    a.some(p => Math.hypot(p[0] - 140, p[1] - 345) < 8) &&
    a.some(p => Math.hypot(p[0] - 140, p[1] - 255) < 8),
    a.map(p => p.map(Math.round).join(',')).join(' | '));
}

// --- 32. small icon with a FILLED arrowhead (mdi-style) ----------------------
console.log('32. 96px icon: filled arrowhead becomes a sharp filled triangle');
{
  function fillTri(img, a, b, c, rgba) {
    const s = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
    for (let y = 0; y < img.height; y++)
      for (let x = 0; x < img.width; x++) {
        const p = [x + 0.5, y + 0.5];
        const d1 = s(a, b, p), d2 = s(b, c, p), d3 = s(c, a, p);
        if ((d1 >= 0 && d2 >= 0 && d3 >= 0) || (d1 <= 0 && d2 <= 0 && d3 <= 0)) {
          const o = (y * img.width + x) * 4;
          img.data[o] = rgba[0]; img.data[o + 1] = rgba[1];
          img.data[o + 2] = rgba[2]; img.data[o + 3] = rgba[3];
        }
      }
  }
  const icon = makeImage(96, 96, WHITE);
  fillRect(icon, 10, 10, 60, 13, BLACK); fillRect(icon, 10, 10, 13, 60, BLACK);
  fillRect(icon, 10, 57, 38, 60, BLACK); fillRect(icon, 57, 10, 60, 34, BLACK);
  fillRect(icon, 36, 84, 86, 87, BLACK); fillRect(icon, 83, 40, 86, 87, BLACK);
  for (let t = 0; t <= 1; t += 0.005) { // shaft
    const cx = 44 + t * 30, cy = 44 + t * 30;
    fillRect(icon, Math.round(cx - 1.7), Math.round(cy - 1.7), Math.round(cx + 1.7), Math.round(cy + 1.7), BLACK);
  }
  fillTri(icon, [27, 27], [47, 31], [31, 47], BLACK);
  const up = bilinearResize(icon, 1400, 1400);
  const traced = T.trace(up, {});
  const { svg, pathCount } = T.buildSvg(traced.chains, 1400, 1400, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth, ink: traced.ink, stroke: '#111'
  });
  const fd = (svg.match(/<path d="([^"]*)" fill="#111" stroke="none"/) || [])[1] || '';
  check('filled head emitted as a fill', fd.length > 0);
  const fa = parsePath(fd).anchors;
  check('head is a sharp polygon (<= 5 anchors, straight sides)',
    fa.length <= 5 && !/C/.test(fd), `anchors ${fa.length}: ${fd.slice(0, 120)}`);
  check('head tip near the drawn apex', fa.some(p => Math.hypot(p[0] - 394, p[1] - 394) < 25),
    fa.map(p => p.map(Math.round).join(',')).join(' | '));
  // the notched square must stay straight and axis-aligned
  const subs = svg.match(/d="([^"]*)" fill="none"/);
  check('structure intact (4-7 lines)', pathCount >= 4 && pathCount <= 7, `got ${pathCount}`);
}

// --- 33. very thick strokes (small icon upscaled): scale invariance ----------
console.log('33. 100px camera icon: straight sides, clean joints at 14x');
{
  const icon = makeImage(100, 76, WHITE);
  const t = 6, R = 8;
  drawSegment(icon, 12 + R, 12, 64 - R, 12, t, BLACK);
  drawSegment(icon, 12 + R, 64, 64 - R, 64, t, BLACK);
  drawSegment(icon, 12, 12 + R, 12, 64 - R, t, BLACK);
  drawSegment(icon, 64, 12 + R, 64, 64 - R, t, BLACK);
  for (const [cx, cy, a0] of [[12 + R, 12 + R, Math.PI], [64 - R, 12 + R, 1.5 * Math.PI],
                              [64 - R, 64 - R, 0], [12 + R, 64 - R, 0.5 * Math.PI]])
    for (let a = a0; a <= a0 + Math.PI / 2; a += 0.02)
      stamp(icon, cx + R * Math.cos(a), cy + R * Math.sin(a), t / 2, BLACK);
  drawSegment(icon, 66, 38, 88, 18, t, BLACK);
  drawSegment(icon, 66, 38, 88, 58, t, BLACK);
  drawSegment(icon, 88, 18, 88, 58, t, BLACK);
  const up = bilinearResize(icon, 1400, 1064);
  const traced = T.trace(up, {});
  const { svg, pathCount, pointCount } = T.buildSvg(traced.chains, 1400, 1064, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth, ink: traced.ink
  });
  check('few clean elements (<= 4 lines)', pathCount <= 4, `got ${pathCount}`);
  check('anchors stay low (<= 22)', pointCount <= 22, `got ${pointCount}`);
  // no hooks/overshoots: every anchor within the drawn icon bounds + margin
  let inBounds = true;
  for (const m of svg.matchAll(/d="([^"]*)"/g)) {
    const nums = m[1].match(/-?[\d.]+/g).map(Number);
    for (let i = 0; i + 1 < nums.length; i += 2)
      if (nums[i] < 60 || nums[i] > 1340 || nums[i + 1] < 60 || nums[i + 1] > 1010) inBounds = false;
  }
  check('no overshoot hooks past the artwork', inBounds);
}

// ============ SCENARIO MATRIX (real-world robustness acceptance) ============
function gaussBlur(img, sigma) {
  const r = Math.max(1, Math.round(sigma * 1.2));
  let cur = img;
  for (let pass = 0; pass < 3; pass++) {
    const { width: w, height: h, data } = cur;
    const tmp = new Float32Array(data.length);
    const out = new Uint8ClampedArray(data.length);
    const span = 2 * r + 1;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let ch = 0; ch < 4; ch++) {
        let acc = 0;
        for (let x = -r; x <= r; x++) acc += data[(row + Math.min(w - 1, Math.max(0, x))) * 4 + ch];
        for (let x = 0; x < w; x++) {
          tmp[(row + x) * 4 + ch] = acc / span;
          acc += data[(row + Math.min(w - 1, x + r + 1)) * 4 + ch] - data[(row + Math.max(0, x - r)) * 4 + ch];
        }
      }
    }
    for (let x = 0; x < w; x++) {
      for (let ch = 0; ch < 4; ch++) {
        let acc = 0;
        for (let y = -r; y <= r; y++) acc += tmp[(Math.min(h - 1, Math.max(0, y)) * w + x) * 4 + ch];
        for (let y = 0; y < h; y++) {
          out[(y * w + x) * 4 + ch] = acc / span;
          acc += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 4 + ch] - tmp[(Math.max(0, y - r) * w + x) * 4 + ch];
        }
      }
    }
    cur = { width: w, height: h, data: out };
  }
  return cur;
}
function flattenPathD(d) {
  const tokens = d.match(/[MLCZzlm]|-?[\d.]+(?:e-?\d+)?/g) || [];
  const polys = [];
  let poly = null, cur = [0, 0], startPt = null, i = 0;
  const num = () => +tokens[i++];
  while (i < tokens.length) {
    const t = tokens[i++];
    if (t === 'M') {
      if (poly && poly.length > 1) polys.push(poly);
      cur = [num(), num()]; startPt = cur; poly = [cur];
    } else if (t === 'L') { cur = [num(), num()]; poly.push(cur); }
    else if (t === 'l') { cur = [cur[0] + num(), cur[1] + num()]; poly.push(cur); }
    else if (t === 'C') {
      const c1 = [num(), num()], c2 = [num(), num()], p = [num(), num()];
      const p0 = cur;
      for (let s = 1; s <= 16; s++) {
        const u = s / 16, q = 1 - u;
        poly.push([
          q*q*q*p0[0] + 3*q*q*u*c1[0] + 3*q*u*u*c2[0] + u*u*u*p[0],
          q*q*q*p0[1] + 3*q*q*u*c1[1] + 3*q*u*u*c2[1] + u*u*u*p[1]
        ]);
      }
      cur = p;
    } else if (t === 'Z' || t === 'z') { if (startPt) poly.push(startPt); }
  }
  if (poly && poly.length > 1) polys.push(poly);
  return polys;
}
function overlayMetric(svg, srcImg, inkThreshold) {
  const W = srcImg.width, H = srcImg.height;
  const truthMask = inkThreshold instanceof Uint8Array ? inkThreshold : null;
  const thr = truthMask ? 128 : (inkThreshold || 128);
  const ink = truthMask || new Uint8Array(W * H);
  if (!truthMask)
    for (let i = 0; i < W * H; i++) {
      const o = i * 4;
      const lum = 0.2126 * srcImg.data[o] + 0.7152 * srcImg.data[o + 1] + 0.0722 * srcImg.data[o + 2];
      const a = srcImg.data[o + 3] / 255;
      if (lum * a + 255 * (1 - a) < thr) ink[i] = 1;
    }
  const dil = new Uint8Array(ink);
  for (let pass = 0; pass < 3; pass++) {
    const prev = new Uint8Array(dil);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (prev[y * W + x]) continue;
      if ((x > 0 && prev[y * W + x - 1]) || (x < W - 1 && prev[y * W + x + 1]) ||
          (y > 0 && prev[(y - 1) * W + x]) || (y < H - 1 && prev[(y + 1) * W + x])) dil[y * W + x] = 1;
    }
  }
  const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
  const k = vb ? W / +vb[1] : 1;
  const mask = new Uint8Array(W * H);
  for (const m of svg.matchAll(/<path d="([^"]*)"([^>]*)>/g)) {
    const attrs = m[2];
    const isFill = /fill="#/.test(attrs);
    const wm = attrs.match(/stroke-width="([\d.]+)"/);
    const r = isFill ? 1 : (wm ? +wm[1] * k / 2 : 1);
    for (const poly0 of flattenPathD(m[1])) {
      const poly = poly0.map(p => [p[0] * k, p[1] * k]);
      for (let kk = 0; kk + 1 < poly.length; kk++) {
        const [x1, y1] = poly[kk], [x2, y2] = poly[kk + 1];
        const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
        for (let s = 0; s <= steps; s++) {
          const cx2 = x1 + (x2 - x1) * s / steps, cy2 = y1 + (y2 - y1) * s / steps;
          const rr = Math.max(1, r);
          for (let y = Math.floor(cy2 - rr); y <= cy2 + rr; y++)
            for (let x = Math.floor(cx2 - rr); x <= cx2 + rr; x++)
              if (x >= 0 && y >= 0 && x < W && y < H && (x + 0.5 - cx2) ** 2 + (y + 0.5 - cy2) ** 2 <= rr * rr)
                mask[y * W + x] = 1;
        }
      }
      if (isFill) {
        let minY = 1e9, maxY = -1;
        for (const p of poly) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
        for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, maxY); y++) {
          const xs = [];
          for (let kk = 0; kk + 1 < poly.length; kk++) {
            const [x1, y1] = poly[kk], [x2, y2] = poly[kk + 1];
            if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + (y - y1) / (y2 - y1) * (x2 - x1));
          }
          xs.sort((a, b) => a - b);
          for (let kk = 0; kk + 1 < xs.length; kk += 2)
            for (let x = Math.max(0, Math.ceil(xs[kk])); x <= Math.min(W - 1, xs[kk + 1]); x++)
              mask[y * W + x] = 1;
        }
      }
    }
  }
  let inkN = 0, cov = 0, maskN = 0, phantom = 0;
  for (let i = 0; i < W * H; i++) {
    if (ink[i]) { inkN++; if (mask[i]) cov++; }
    if (mask[i]) { maskN++; if (!dil[i]) phantom++; }
  }
  return { coverage: inkN ? cov / inkN : 1, phantom: maskN ? phantom / maskN : 0 };
}
function traceScenario(img) {
  const nat = Math.max(img.width, img.height);
  const scale = Math.min(2600, Math.max(nat * 2, 1400)) / nat;
  const up = bilinearResize(img, Math.round(img.width * scale), Math.round(img.height * scale));
  const traced = T.trace(up, { srcScale: scale });
  const r = T.buildSvg(traced.chains, up.width, up.height, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth, ink: traced.ink, stroke: '#111',
    outW: img.width, outH: img.height
  });
  return { traced, r };
}
function crispScene() {
  const img = makeImage(700, 520, WHITE);
  drawSegment(img, 80, 80, 420, 80, 7, BLACK);
  drawSegment(img, 420, 80, 420, 300, 7, BLACK);
  drawSegment(img, 420, 300, 80, 300, 7, BLACK);
  drawSegment(img, 80, 300, 80, 80, 7, BLACK);
  for (let a = 0; a < 2 * Math.PI; a += 0.004)
    stamp(img, 560 + 90 * Math.cos(a), 190 + 90 * Math.sin(a), 3.5, BLACK);
  drawSegment(img, 120, 380, 620, 380, 6, BLACK);
  drawSegment(img, 120, 440, 380, 470, 6, BLACK);
  return img;
}
function truthOf(img) {
  const t = new Uint8Array(img.width * img.height);
  for (let i = 0; i < t.length; i++) {
    const o = i * 4;
    if (0.2126 * img.data[o] + 0.7152 * img.data[o + 1] + 0.0722 * img.data[o + 2] < 128) t[i] = 1;
  }
  return t;
}

console.log('34. scenario E: photographed sketch (uneven lighting)');
{
  const img = makeImage(700, 520, WHITE);
  const truth = new Uint8Array(700 * 520);
  for (let y = 0; y < 520; y++)
    for (let x = 0; x < 700; x++) {
      const v = 250 - (x + y) / 1220 * 82;
      const o = (y * 700 + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
    }
  let seed = 5;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 9000; i++) {
    const x = Math.floor(rnd() * 700), y = Math.floor(rnd() * 520);
    const o = (y * 700 + x) * 4;
    const v = Math.max(0, Math.min(255, img.data[o] + (rnd() - 0.5) * 14));
    img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
  }
  const dark = (x, y) => 250 - (x + y) / 1220 * 82 - 58;
  const stampT = (x, y, r) => {
    stamp(img, x, y, r, [dark(x, y), dark(x, y), dark(x, y), 255]);
    for (let yy = Math.floor(y - r); yy <= y + r; yy++)
      for (let xx = Math.floor(x - r); xx <= x + r; xx++)
        if (xx >= 0 && yy >= 0 && xx < 700 && yy < 520 && (xx - x) ** 2 + (yy - y) ** 2 <= r * r)
          truth[yy * 700 + xx] = 1;
  };
  for (let t2 = 0; t2 <= 1; t2 += 0.002) stampT(100 + t2 * 480, 120 + Math.sin(t2 * 5) * 40, 3);
  for (let a = 0; a < 2 * Math.PI; a += 0.004) stampT(350 + 100 * Math.cos(a), 330 + 80 * Math.sin(a), 3);
  for (let t2 = 0; t2 <= 1; t2 += 0.002) stampT(480 + t2 * 160, 250 + t2 * 180, 3);
  const { r } = traceScenario(img);
  const om = overlayMetric(r.svg, img, truth);
  check('sketch coverage >= 85%', om.coverage >= 0.85, (om.coverage * 100).toFixed(1) + '%');
  check('sketch phantom <= 10%', om.phantom <= 0.10, (om.phantom * 100).toFixed(1) + '%');
}

console.log('35. scenario F: soft blur recovers the true drawing');
{
  const crisp = crispScene();
  const { traced, r } = traceScenario(gaussBlur(crisp, 3));
  const om = overlayMetric(r.svg, crisp, truthOf(crisp));
  check('soft blur: preprocessing engaged', traced.preprocess !== 'none', traced.preprocess);
  check('soft blur coverage >= 90%', om.coverage >= 0.90, (om.coverage * 100).toFixed(1) + '%');
  check('soft blur phantom <= 5%', om.phantom <= 0.05, (om.phantom * 100).toFixed(1) + '%');
}

console.log('36. scenario F: severe blur is best-effort WITH a warning');
{
  const crisp = crispScene();
  const { traced, r } = traceScenario(gaussBlur(crisp, 7));
  const om = overlayMetric(r.svg, crisp, truthOf(crisp));
  check('severe blur warns', traced.warnings.some(w => /blurry/i.test(w)));
  check('severe blur still covers >= 85%', om.coverage >= 0.85, (om.coverage * 100).toFixed(1) + '%');
  check('no confetti explosion (<= 60 paths)', r.pathCount <= 60, `got ${r.pathCount}`);
}

console.log('37. scenario I: crosshatch lines stay separate');
{
  const img = makeImage(600, 400, WHITE);
  for (let i = 0; i < 12; i++) drawSegment(img, 60 + i * 24, 60, 60 + i * 24 + 160, 220, 5, BLACK);
  for (let i = 0; i < 12; i++) drawSegment(img, 60 + i * 24 + 160, 60, 60 + i * 24, 220, 5, BLACK);
  for (let i = 0; i < 8; i++) drawSegment(img, 80, 280 + i * 12, 520, 280 + i * 12, 5, BLACK);
  const { r } = traceScenario(img);
  const om = overlayMetric(r.svg, img, 128);
  check('crosshatch coverage >= 85%', om.coverage >= 0.85, (om.coverage * 100).toFixed(1) + '%');
  check('crosshatch phantom <= 7%', om.phantom <= 0.07, (om.phantom * 100).toFixed(1) + '%');
  check('lines not mass-merged (>= 22)', r.pathCount >= 22, `got ${r.pathCount}`);
}

console.log('38. scenario M: colored lines on colored background');
{
  const img = makeImage(600, 400, [236, 226, 198, 255]);
  drawSegment(img, 80, 80, 520, 80, 7, [40, 70, 180, 255]);
  for (let a = 0; a < 2 * Math.PI; a += 0.004)
    stamp(img, 300 + 90 * Math.cos(a), 240 + 90 * Math.sin(a), 3.5, [40, 70, 180, 255]);
  const { traced, r } = traceScenario(img);
  const om = overlayMetric(r.svg, img, 170);
  check('color coverage >= 95%', om.coverage >= 0.95, (om.coverage * 100).toFixed(1) + '%');
  check('color phantom <= 5%', om.phantom <= 0.05, (om.phantom * 100).toFixed(1) + '%');
  const rr = parseInt(traced.inkColor.slice(1, 3), 16), bb = parseInt(traced.inkColor.slice(5, 7), 16);
  check('ink color sampled bluish', bb > rr + 40, traced.inkColor);
}

console.log('39. scenario O: photos are flagged, never silent');
{
  const img = makeImage(500, 400, WHITE);
  for (let y = 0; y < 400; y++)
    for (let x = 0; x < 500; x++) {
      const v = 120 + 90 * Math.sin(x / 90) * Math.cos(y / 70) + (x / 500) * 40;
      const o = (y * 500 + x) * 4;
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
    }
  for (let a = 0; a < 2 * Math.PI; a += 0.002)
    for (let rr = 0; rr < 70; rr++)
      stamp(img, 250 + rr * Math.cos(a), 200 + rr * Math.sin(a), 1, [60 + rr, 60 + rr, 60 + rr, 255]);
  const { traced } = traceScenario(img);
  check('photo gets an explicit warning', traced.warnings.length > 0, JSON.stringify(traced.warnings));
}

console.log('40. gap bridging: heals breaks, never welds dashes');
{
  // a BLURRY line broken by small gaps (~0.4x width of clear space) must
  // heal — auto-bridging only fires on measured-degraded sources; on a
  // sharp image a clear gap between collinear strokes is authored (a dash,
  // a badge cutout) and must never be welded
  const imgSharp = makeImage(500, 120, WHITE);
  for (const [a, b] of [[40, 150], [164, 290], [304, 440]])
    drawSegment(imgSharp, a, 60, b, 60, 10, BLACK);
  const img = gaussBlur(imgSharp, 2.2);
  const t1 = T.trace(img, {});
  check('broken blurry line healed to 1 chain', keptChains(t1, 6).length === 1,
    `got ${keptChains(t1, 6).length}`);
  const tSharp = T.trace(imgSharp, { srcScale: 3 });
  check('same gaps on a SHARP source stay authored (3 chains)',
    keptChains(tSharp, 6).length === 3, `got ${keptChains(tSharp, 6).length}`);
  // dashes (clear gaps ~3x width) must NOT weld
  const img2 = makeImage(500, 120, WHITE);
  for (const [a, b] of [[40, 110], [150, 220], [260, 330], [370, 440]])
    drawSegment(img2, a, 60, b, 60, 10, BLACK);
  const t2 = T.trace(img2, {});
  check('dashes stay separate (4 chains)', keptChains(t2, 6).length === 4,
    `got ${keptChains(t2, 6).length}`);
  // bridge = 0 disables healing entirely (on the blurry source)
  const t3 = T.trace(img, { bridge: 0 });
  check('bridge=0 keeps fragments', keptChains(t3, 6).length === 3,
    `got ${keptChains(t3, 6).length}`);
}

console.log('41. threshold choice never erodes legitimate dots');
{
  // circle with a center dot (e.g. a dial icon): erosion-rewarding threshold
  // scoring once picked a threshold strict enough to thin the dot to nothing
  const img = makeImage(700, 520, WHITE);
  for (let a = 0; a < 2 * Math.PI; a += 0.004)
    stamp(img, 350 + 90 * Math.cos(a), 260 + 90 * Math.sin(a), 3.5, BLACK);
  stamp(img, 350, 260, 4, BLACK);
  drawSegment(img, 80, 80, 620, 80, 7, BLACK);
  const up = bilinearResize(img, 1400, 1040);
  const t = T.trace(up, {});
  const dot = t.chains.filter(c => c.points.every(p => Math.hypot(p[0] - 700, p[1] - 520) < 40));
  check('center dot survives tracing', dot.length === 1, `got ${dot.length}`);
}

// ============ UNIFORM-WEIGHT ICON FIXTURES (mdi-light ground truth) =========
// Every fixture has exactly ONE stroke weight by construction, at two export
// sizes — the ground truth for weight classing, corner finishing, and the
// sharpness gate. Rendered from the Iconify API to raw RGBA (alpha = ink).
function loadIconFixture(name) {
  const zlib = require('zlib');
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'fixtures', 'icons', name + '.rgba.gz')));
  const w = raw.readUInt32LE(0), h = raw.readUInt32LE(4);
  return { width: w, height: h, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset + 8, w * h * 4) };
}
// Catmull-Rom bicubic — the plugin upscales via canvas smoothing 'high'
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
function traceIconFixture(img, thickness) {
  const nat = Math.max(img.width, img.height);
  const target = Math.min(2600, Math.max(nat * 2, 1400));
  const up = bicubicResize(img, Math.round(img.width * target / nat), Math.round(img.height * target / nat));
  const traced = T.trace(up, { srcScale: target / nat });
  const r = T.buildSvg(traced.chains, up.width, up.height, {
    minLength: 3, matchWeights: true, avgWidth: traced.avgStrokeWidth,
    strokeWidth: traced.avgStrokeWidth * (img.width / up.width) * (thickness || 1),
    ink: traced.ink, stroke: '#111', outW: img.width, outH: img.height
  });
  return { traced, r };
}
function iconAlphaTruth(img) {
  const t = new Uint8Array(img.width * img.height);
  for (let i = 0; i < t.length; i++) if (img.data[i * 4 + 3] > 128) t[i] = 1;
  return t;
}

console.log('42. uniform-weight icon set: one class, sharp, covered');
{
  // per-fixture floors; the ≥95%-coverage target is met by most — the ones
  // below carry sub-pixel fit residue at stroke-scale features (documented)
  const CASES = [
    ['bullhorn-480', 94], ['bullhorn-96', 97],
    ['home-480', 95], ['home-96', 95],
    ['camera-480', 95], ['camera-96', 98],
    ['heart-480', 93.5], ['heart-96', 97],
    ['cog-480', 95], ['cog-96', 95.5],
    ['bell-480', 93.5], ['bell-96', 90.5],
  ];
  for (const [name, coverFloor] of CASES) {
    const img = loadIconFixture(name);
    const { traced, r } = traceIconFixture(img);
    const om = overlayMetric(r.svg, img, iconAlphaTruth(img));
    check(`${name}: ONE weight class`, r.weights.length === 1,
      `got ${r.weights.length}: ${JSON.stringify(r.weights)}`);
    check(`${name}: classified sharp, no preprocessing`,
      traced.preprocess === 'none' && (!traced.tuning || traced.tuning.grade === 'sharp'),
      `${traced.preprocess} / ${traced.tuning && traced.tuning.grade}`);
    check(`${name}: no warnings`, traced.warnings.length === 0, JSON.stringify(traced.warnings));
    check(`${name}: coverage >= ${coverFloor}%`, om.coverage * 100 >= coverFloor,
      (om.coverage * 100).toFixed(1) + '%');
    check(`${name}: phantom <= 3%`, om.phantom <= 0.03, (om.phantom * 100).toFixed(1) + '%');
  }
}

console.log('43. bullhorn specifics: straight bar, lean arcs, sharp corners');
{
  const img = loadIconFixture('bullhorn-480');
  const { r } = traceIconFixture(img);
  check('4 paths', r.pathCount === 4, `got ${r.pathCount}`);
  check('anchor economy (<= 26)', r.pointCount <= 26, `got ${r.pointCount}`);
  // the mouth bar must be a dead-straight vertical 2-anchor segment
  const vertBar = [...r.svg.matchAll(/L ([\d.]+) ([\d.]+)/g)].some(m => {
    const d = r.svg.slice(0, m.index);
    const prev = d.match(/M ([\d.]+) ([\d.]+)\s*$/) || d.match(/([\d.]+) ([\d.]+)\s*$/);
    return prev && Math.abs(+prev[1] - +m[1]) < 0.01 && Math.abs(+prev[2] - +m[2]) > 700;
  });
  check('mouth bar = dead-straight vertical segment', vertBar);
  check('sharp corners render as miter', /stroke-linejoin="miter"/.test(r.svg),
    (r.svg.match(/stroke-linejoin="[^"]*"/g) || []).join(' '));
}

console.log('44. thickness sweep keeps structure at 25% and 400%');
{
  const img = loadIconFixture('bullhorn-480');
  const base = traceIconFixture(img, 1);
  for (const th of [0.25, 4]) {
    const { r } = traceIconFixture(img, th);
    check(`x${th}: same paths/classes/anchors`,
      r.pathCount === base.r.pathCount && r.weights.length === 1 &&
      r.pointCount === base.r.pointCount,
      `paths ${r.pathCount} classes ${r.weights.length} anchors ${r.pointCount}`);
    check(`x${th}: widths scale uniformly`,
      Math.abs(r.weights[0] / base.r.weights[0] - th) < th * 0.02,
      `${r.weights[0]} vs base ${base.r.weights[0]}`);
    check(`x${th}: corners stay miter`, /stroke-linejoin="miter"/.test(r.svg));
  }
}

console.log('45. round-trip vs open-licensed originals (Lucide, ISC)');
{
  // the corpus-harness metrics run against committed ground-truth SVGs:
  // trace the 240px render and compare with the original vector source.
  // Per-icon floors reflect what the tracer achieves today - regressions
  // in any mechanism (junction routing, corners, width classing, votes)
  // show up here against REAL professional icons.
  const H = require(path.join(__dirname, 'corpus-harness', 'harness.js'));
  const SP = require(path.join(__dirname, 'corpus-harness', 'svgpath.js'));
  const zlib = require('zlib');
  const CASES = {
    heart: 'ALL', house: 'ALL', megaphone: 'ALL', scissors: 'ALL',
    camera: ['pathCount', 'centerline', 'width', 'anchors', 'topology', 'finishing'],
    settings: ['pathCount', 'centerline', 'width', 'anchors', 'topology', 'finishing'],
    bell: ['pathCount', 'centerline', 'width', 'anchors', 'grammar'],
    'square-arrow-up': ['width', 'anchors', 'grammar'],
  };
  for (const [name, want] of Object.entries(CASES)) {
    const dir = path.join(__dirname, 'fixtures', 'lucide');
    const orig = SP.parseIconSvg(fs.readFileSync(path.join(dir, name + '.svg'), 'utf8'));
    for (const s of orig.subpaths) s.poly = SP.flattenSubpath(s, 4);
    const raw = zlib.gunzipSync(fs.readFileSync(path.join(dir, name + '@240.rgba.gz')));
    const w = raw.readUInt32LE(0), h = raw.readUInt32LE(4);
    const img = { width: w, height: h, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset + 8, w * h * 4) };
    const res = H.traceRender(img);
    const tr = H.parseTraced(res.svg, res.traceW);
    tr.weightsLen = res.weights.length;
    const M = H.evaluate(orig, tr);
    const metrics = want === 'ALL'
      ? ['pathCount', 'centerline', 'width', 'anchors', 'grammar', 'topology', 'finishing']
      : want;
    for (const m of metrics)
      check(`lucide ${name}: ${m}`, M[m].pass, JSON.stringify(M[m]).slice(0, 120));
  }
}

// --- write a sample SVG for eyeballing -------------------------------------
{
  const img = makeImage(300, 200, WHITE);
  drawCircle(img, 90, 100, 55, 6, BLACK);
  drawSegment(img, 150, 100, 280, 40, 6, BLACK);
  drawSegment(img, 150, 100, 280, 160, 6, BLACK);
  drawSegment(img, 145, 100, 90, 100, 6, BLACK);
  const traced = T.trace(img, {});
  const { svg } = T.buildSvg(traced.chains, 300, 200, { strokeWidth: 3, stroke: '#0d99ff' });
  const out = path.join(__dirname, 'sample-output.svg');
  fs.writeFileSync(out, svg);
  console.log(`\nsample written to ${out}`);
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
