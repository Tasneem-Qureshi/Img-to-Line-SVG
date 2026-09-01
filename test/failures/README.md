# Test-first bug policy

Every future bad trace starts HERE, before any fix is written:

1. Save the source image in this folder (PNG, or `.rgba.gz` in the harness's
   raw format) with a short slug, e.g. `2026-09-03-welded-badge.png`.
2. Add an assertion to `test/trace-test.js` that loads it and FAILS on the
   current build, stating the expected behavior (paths, weights, gaps,
   corners...).
3. Only then fix the mechanism (never special-case the image).
4. `node test/run-all.js` must go green with the new test AND no baseline
   metric may drop (`test/baseline.json`). If a number improved, lock it in
   with `--update-baseline`.
