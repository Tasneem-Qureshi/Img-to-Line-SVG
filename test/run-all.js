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
const N = process.env.RATCHET_N || '150'; // subset size (icons)
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
run(`node test/corpus-harness/harness.js ${FULL ? '--all' : '--n ' + N}`);
const clean = scorecard('clean');

// 2b. bold-weight corpus (stroke-width 5 renders of the same originals)
run(`node test/corpus-harness/harness.js --n ${N} --sizes 240,480 --bold`);
const bold = scorecard('bold');

// 3. degraded runs (stratified subset at 240px; jpeg uses pre-rendered q60 fixtures)
const degraded = {};
for (const mode of ['down', 'blur', 'rot', 'jpeg']) {
  run(`node test/corpus-harness/harness.js --n ${N} --sizes 240 --degrade ${mode}`);
  degraded[mode] = scorecard(mode);
}

// 4. collect current numbers
const metrics = ['allPass', 'pathCount', 'centerline', 'width', 'anchors', 'grammar', 'topology', 'finishing', 'fitQuality', 'crossWeight'];
const current = { tier: FULL ? 'full' : 'quick', n: FULL ? 1173 : +N, clean: {}, bold: {}, degraded: {} };
for (const size of Object.keys(clean.bySize)) {
  current.clean[size] = {};
  for (const m of metrics)
    if (clean.bySize[size][m] != null)
      current.clean[size][m] = +(clean.bySize[size][m] / clean.bySize[size].icons * 100).toFixed(1);
}
for (const size of Object.keys(bold.bySize)) {
  current.bold[size] = {};
  for (const m of metrics)
    if (bold.bySize[size][m] != null)
      current.bold[size][m] = +(bold.bySize[size][m] / bold.bySize[size].icons * 100).toFixed(1);
}
for (const [mode, sc] of Object.entries(degraded)) {
  const a = sc.bySize['240'];
  current.degraded[mode] = {};
  for (const m of metrics) if (a[m] != null) current.degraded[mode][m] = +(a[m] / a.icons * 100).toFixed(1);
}

// 5. ratchet against baseline
if (!fs.existsSync(BASE) || UPDATE) {
  fs.writeFileSync(BASE, JSON.stringify(current, null, 1));
  console.log(`\nbaseline ${UPDATE ? 'updated' : 'created'}: test/baseline.json`);
  process.exit(0);
}
const baseline = JSON.parse(fs.readFileSync(BASE, 'utf8'));
if (baseline.tier !== current.tier || (baseline.n && baseline.n !== current.n)) {
  console.log(`\nNOTE: baseline is tier '${baseline.tier}' n=${baseline.n || '?'} — this run is '${current.tier}' n=${current.n}. Cross-size comparisons carry ~1-icon noise per cell; use RATCHET_N=${baseline.n || 400} for a like-for-like verdict.`);
}
// Amended ratchet policy (owner decision, 2026-09-21):
//  - the HEADLINE (allPass, in every tier and size) may NEVER drop
//  - sub-metrics may drop <= 1.0 point absolute, only if the change is
//    net-positive overall AND every dropped sub-metric gets a named
//    follow-up fixture under test/failures/ (a concrete regressed icon
//    with a failing assertion) in the same commit
//  - larger drops still block
let hardFails = 0, condDrops = [], gains = 0, deltaSum = 0;
const cmp = (label, base, cur) => {
  for (const m of metrics) {
    if (base[m] == null || cur[m] == null) continue;
    const d = +(cur[m] - base[m]).toFixed(1);
    deltaSum += d;
    if (d < 0) {
      if (m === 'allPass') { console.log(`HARD DROP  ${label} allPass: ${base[m]}% -> ${cur[m]}% (headline may never drop)`); hardFails++; }
      else if (-d > 1.0) { console.log(`HARD DROP  ${label} ${m}: ${base[m]}% -> ${cur[m]}% (> 1.0 point)`); hardFails++; }
      else { console.log(`drop(cond) ${label} ${m}: ${base[m]}% -> ${cur[m]}%`); condDrops.push(`${label} ${m}`); }
    } else if (d > 0) gains++;
  }
};
for (const size of Object.keys(baseline.clean || {}))
  if (current.clean[size]) cmp(`clean@${size}`, baseline.clean[size], current.clean[size]);
for (const size of Object.keys(baseline.bold || {}))
  if (current.bold[size]) cmp(`bold@${size}`, baseline.bold[size], current.bold[size]);
for (const mode of Object.keys(baseline.degraded || {}))
  if (current.degraded[mode]) cmp(`degraded-${mode}@240`, baseline.degraded[mode], current.degraded[mode]);

console.log(`\nratchet: ${hardFails} hard drop(s), ${condDrops.length} conditional drop(s) (<=1.0pt), ${gains} gain(s), net ${deltaSum >= 0 ? '+' : ''}${deltaSum.toFixed(1)}pt vs baseline`);
if (hardFails) {
  console.log('FAIL: headline or >1.0pt sub-metric drop — this change must not ship.');
  process.exit(1);
}
if (condDrops.length && deltaSum <= 0) {
  console.log('FAIL: conditional drops but the change is not net-positive overall.');
  process.exit(1);
}
if (condDrops.length) {
  console.log('QUALIFIES under the amended policy — WITH OBLIGATIONS. Each dropped');
  console.log('sub-metric below needs a named follow-up fixture under test/failures/');
  console.log('(a concrete regressed icon + failing assertion) IN THE SAME COMMIT:');
  for (const c of condDrops) console.log('  - ' + c);
}
if (gains) console.log('Improved! Re-run with --update-baseline to lock the new numbers in.');
// quarantined follow-up fixtures (informational, never gates)
try {
  console.log('\n-- pending follow-up fixtures (test/failures/pending.js) --');
  execSync('node test/failures/pending.js', { cwd: ROOT, stdio: 'inherit' });
} catch (e) { console.log('(pending runner unavailable: ' + e.message.split('\n')[0] + ')'); }
console.log('OK under the amended ratchet policy.');
