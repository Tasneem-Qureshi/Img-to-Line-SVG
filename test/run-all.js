#!/usr/bin/env node
// THE ratchet: one command runs everything and compares against the checked-in
// baseline (test/baseline.json). Exits non-zero if ANY metric drops.
//
//   node test/run-all.js            quick tier: unit+scenario suite, corpus
//                                   subset (147 icons x 3 sizes), degraded
//                                   subset runs (~20 min)
//   node test/run-all.js --full     release tier: full 1173-icon corpus (~1 h)
//   node test/run-all.js --update-baseline
//                                   after an IMPROVED run: write the new
//                                   numbers as the baseline (never automatic)
'use strict';
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = path.join(__dirname, 'baseline.json');
const args = process.argv.slice(2);
const FULL = args.includes('--full');
const UPDATE = args.includes('--update-baseline');

function run(cmd) {
  console.log('\n$ ' + cmd);
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}
function scorecard(tag) {
  return JSON.parse(fs.readFileSync(
    path.join(__dirname, 'corpus-report', `scorecard-${tag}.json`), 'utf8')).scorecard;
}

// 1. unit + scenario suite (must be all-green, always)
run('node test/trace-test.js');

// 2. corpus harness, clean
run(`node test/corpus-harness/harness.js ${FULL ? '--all' : '--n 150'}`);
const clean = scorecard('clean');

// 3. degraded runs (stratified subset at 240px; jpeg uses pre-rendered q60 fixtures)
const degraded = {};
for (const mode of ['down', 'blur', 'rot', 'jpeg']) {
  run(`node test/corpus-harness/harness.js --n 60 --sizes 240 --degrade ${mode}`);
  degraded[mode] = scorecard(mode);
}

// 4. collect current numbers
const metrics = ['allPass', 'pathCount', 'centerline', 'width', 'anchors', 'grammar', 'topology', 'finishing'];
const current = { tier: FULL ? 'full' : 'quick', clean: {}, degraded: {} };
for (const size of Object.keys(clean.bySize)) {
  current.clean[size] = {};
  for (const m of metrics)
    current.clean[size][m] = +(clean.bySize[size][m] / clean.bySize[size].icons * 100).toFixed(1);
}
for (const [mode, sc] of Object.entries(degraded)) {
  const a = sc.bySize['240'];
  current.degraded[mode] = {};
  for (const m of metrics) current.degraded[mode][m] = +(a[m] / a.icons * 100).toFixed(1);
}

// 5. ratchet against baseline
if (!fs.existsSync(BASE) || UPDATE) {
  fs.writeFileSync(BASE, JSON.stringify(current, null, 1));
  console.log(`\nbaseline ${UPDATE ? 'updated' : 'created'}: test/baseline.json`);
  process.exit(0);
}
const baseline = JSON.parse(fs.readFileSync(BASE, 'utf8'));
if (baseline.tier !== current.tier) {
  console.log(`\nNOTE: baseline tier is '${baseline.tier}', this run is '${current.tier}' — comparing anyway.`);
}
let drops = 0, gains = 0;
const cmp = (label, base, cur) => {
  for (const m of metrics) {
    if (base[m] == null || cur[m] == null) continue;
    if (cur[m] < base[m]) { console.log(`DROP  ${label} ${m}: ${base[m]}% -> ${cur[m]}%`); drops++; }
    else if (cur[m] > base[m]) gains++;
  }
};
for (const size of Object.keys(baseline.clean || {}))
  if (current.clean[size]) cmp(`clean@${size}`, baseline.clean[size], current.clean[size]);
for (const mode of Object.keys(baseline.degraded || {}))
  if (current.degraded[mode]) cmp(`degraded-${mode}@240`, baseline.degraded[mode], current.degraded[mode]);

console.log(`\nratchet: ${drops} drop(s), ${gains} gain(s) vs baseline`);
if (drops) {
  console.log('FAIL: metrics dropped below baseline — this change must not ship.');
  process.exit(1);
}
if (gains) console.log('Improved! Re-run with --update-baseline to lock the new numbers in.');
console.log('OK: no metric below baseline.');
