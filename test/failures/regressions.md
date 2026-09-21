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
