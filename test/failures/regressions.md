# Conditional-drop obligations — v2.4 merge (2026-09-21)

The fit-quality branch merged under the amended ratchet policy with 12
conditional sub-metric drops (each <= 1.0 point at n=400, net +162.9pt,
zero headline drops). Per policy, every dropped cell has a named regressed
icon (verified: passed the metric on v2.3.1, fails on the merged build) with
a failing assertion in `pending.js` (quarantined; run via
`node test/failures/pending.js`, reported by run-all without gating).

| dropped cell | delta | named regressed icon |
|---|---|---|
| clean@96 centerline | 64.7 → 64.5 | general__bookmark-x |
| clean@96 grammar | 83.9 → 83.4 | editor__bezier-curve-01 |
| clean@240 anchors | 99.5 → 99.2 | arrows__switch-vertical-02 |
| clean@480 centerline | 64.7 → 63.9 | alerts-feedback__announcement-02 |
| bold@480 centerline | 37.3 → 37.1 | arrows__arrow-circle-broken-up-left |
| bold@480 grammar | 90.3 → 90.0 | charts__chart-breakout-circle |
| down@240 grammar | 85.2 → 84.9 | education__telescope |
| down@240 topology | 66.5 → 66.2 | finance-ecommerce__shopping-bag-02 |
| blur@240 grammar | 84.1 → 83.9 | maps-travel__train |
| blur@240 topology | 62.4 → 61.9 | charts__line-chart-down-02 |
| rot@240 pathCount | 78.5 → 78.0 | charts__bar-chart-square-plus |
| jpeg@240 topology | 67.3 → 66.5 | finance-ecommerce__credit-card-down |

(The corpus icons themselves are gitignored; these fixtures reference them
by name and run only when the corpus is present.)

## Bold-weight round (branch `bold-weight-v2.5`, 2026-09-22)

Suite state on the branch: **285/290**. The five failing checks are named
merge BLOCKERS (not conditional drops): the branch does not merge to main
until each is green in the gated suite.

| failing check | current | gate | mechanism owning the fix |
|---|---|---|---|
| test 47 — bold bottom edge is a 2-anchor straight | segs `LLLLC`, no bottom L | L with y≈15±0.5, left x ≤ 8.2, right ≈ 12.2±0.7 | straight-run X far-endpoint anchor at the rounded-corner transition stopped firing at bold after the litter-gate revert; the corner pivot (c2) also sits 0.5–0.8u past (12.2,15) |
| test 47 — bold handle ends on the body edge | right end (12.4,15.8) | within 0.7 of (11.8,15) | junction-end extension: the ray crossing lands on the ring's raw pool-sag points; the fitted ring is clean but not visible to mergeChains |
| test 47 — bold small wave flat ends AT the ink face | mean offset 0.74 | ≤ 0.70 (0.25·w) | one end's hygiene trim reaches the arc middle (stroke is only ~2.1w long); the probe cannot see a face from there and the restored end keeps ~0.3u of curl |
| test 42 — bell-480 phantom ≤ 3% | 3.0% (rounding edge) | < 3% | net cap/corner-geometry drift at 480px, ~0.1% over; appeared during this round |
| test 45 — lucide bell centerline max | 1.032 | ≤ 1.0 | the bell's bottom-right corner (21,17) rebuilds ~1.0u short; unaffected by spur/run/cap toggles in bisection — corner-rebuild arm geometry at this flank-to-edge joint |
