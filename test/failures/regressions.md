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
| ~~test 47 — bold bottom edge is a 2-anchor straight~~ **FIXED 2026-09-25** (rounded-corner veto round, see below) | ~~segs `LLLLC`, no bottom L~~ passes both weights | L with y≈15±0.5, left x ≤ 8.2, right ≈ 12.2±0.7 | root cause was neither of the suspects: run-fusion's width-scaled `maxGap` outgrew the icon's corner radii at bold, fusing whole AUTHORED rounded corners into fake sharp X's (0.9u off-ink), and the in-fit H/V/45° snap mutated span endpoints while neighbors kept the forced anchors (seam nubs / leaning bar) |
| test 47 — bold handle ends on the body edge | right end (12.4,15.8) | within 0.7 of (11.8,15) | junction-end extension: the ray crossing lands on the ring's raw pool-sag points; the fitted ring is clean but not visible to mergeChains |
| test 47 — bold small wave flat ends AT the ink face | mean offset 0.74 | ≤ 0.70 (0.25·w) | one end's hygiene trim reaches the arc middle (stroke is only ~2.1w long); the probe cannot see a face from there and the restored end keeps ~0.3u of curl |
| test 42 — bell-480 phantom ≤ 3% | 3.0% (rounding edge) | < 3% | net cap/corner-geometry drift at 480px, ~0.1% over; appeared during this round |
| test 45 — lucide bell centerline max | 1.032 → 1.027 (2026-09-25) | ≤ 1.0 | the bell's bottom-right corner (21,17) rebuilds ~1.0u short; unaffected by spur/run/cap toggles in bisection — corner-rebuild arm geometry at this flank-to-edge joint |

## Rounded-corner veto round (2026-09-25, on `bold-weight-v2.5`)

Suite: **285/290** (bottom-edge blocker fixed; the four rows above remain).
Mechanisms landed in the run-fusion stage: (1) Kasa circle-fit VETO on the
gap + ink probe 0.38w along the outer bisector past the would-be sharp X
(sharp joints stay inked ≥0.5w even round-join; an authored rounded contour
cuts away short) + per-run on-circle guard (an arc-continuation pair —
lens-ring chords, heart lobes — neither vetoes nor fuses); (2) veto anchors
at the TRUE tangent points (circle center projected onto each run line,
snapped to the polyline); (3) fused-X intersections from middle-half run
directions (endpoint chords tilt from smoothing sag → pivots 0.5–0.8u past
the joint); (4) in-fit snap no longer mutates endpoints — all H/V/45°
snapping moved to post-cleanup `axisSnapSegLines`, which moves every
occurrence of a shared anchor coherently (kills the seam-nub / duplicate
corner-anchor class).

Corpus vs the v2.4 floor, n=400 (NOTE: conflates this round with the
pre-existing v2.5-branch delta — the floor predates the branch):
- clean 240/480: allPass −0.5/−0.8 (within policy) with pathCount +5.9/+5.3,
  centerline +4.0/+4.4, fitQuality +5.6/+4.9, topology +1/+1
- clean 96: allPass 29.2 vs 33.2 (**blocks**) — fitQuality 50.4 vs 55: veto
  tangent anchors are treated as CORNERS by the fit (forced = corner by
  construction), so smoothness fails at every vetoed corner; fix = smooth-pin
  plumbing (forced split WITHOUT corner semantics + G1 alignment across it)
- bold 240: allPass 2.3 vs 4.3 (**blocks**); crossWeight 12.3/13.3 vs 21/22
  (**blocks**): the veto's 0.55×wEff radius floor is width-relative, so thin
  and bold veto DIFFERENT corners of the same icon, and tangent-anchor
  positions jitter across weights (polyline-snap differs). A sweep ceiling
  (≤1.9) was tried as a scale-free replacement and reverted: junction-carved
  gaps legitimately sweep 2.5+ rad around one corner (bullhorn bottom-left)
- suite fixture: camera-96 coverage 98→96.6 (test-first fixture = the
  already-failing check; residual fit sag at vetoed r≈1–2.4w corners at
  96px; arc-midpoint pinning fixes the sag but violates the 0.5w cluster
  rule and cross-weight anchor counts — needs the same smooth-pin plumbing)

## Arrowhead round (2026-10-05, on `bold-weight-v2.5`)

User report: `mdi-light:arrange-bring-forward` traced with swoopy corners, a
mushy arrowhead and curled ends — "even high Detail doesn't fix it" (correct:
these are junction-stage decisions made before fitting). Fixture
`test/failures/gen-arrange.js` → `arrange-thin` (0.7u, the reference weight)
and `arrange-bold` (1.4u) + `arrange.svg`; test 48 (26 checks, both weights).
Suite **311/316** — the five rows above remain the only failures.

Before (a4bdb9a) → after, same fixtures:
- thin: 5 paths, head = two separate CURVED pieces bent to the pool centroid
  (7.7,7.7), shaft stopping at 7.7 → 4 paths, head ONE 3-anchor L with the
  apex at (7.4,7.4), shaft a 2-anchor straight apex→tip, both squares exact
- bold: 2 paths — arrowhead deleted, back square broken open into a 9-anchor
  zigzag through the pierced corner → 4 paths, head L, shaft straight; only
  residue: the pierced corner of the back square rounds (5 anchors, not 4)

Mechanisms (mergeChains unless noted):
1. **corner + spoke** pre-pass (before the spur-fuse): two arms meeting
   ~perpendicular (|cos| ≤ 0.5) with free far ends + a third arm leaving the
   pool along their bisector → fuse the arms through their fitted lines'
   intersection (forced apex, ink-checked), aim the spoke's trim at it
   (`trim[e].apex`, honored by extTarget; corner-join skips such ends). The
   old behavior extended all three ends to the pool CENTROID, which sits
   down the spoke — hence the swoops. Arm directions via `armLine` (least
   squares beyond 0.6w from the junction: dirAt's 7-point tangent inside a
   pool curl reads a 90° corner as a bent continuation). The fused chain
   cuts each arm's pool curl.
2. **spur-fuse**: a spur candidate whose pool holds exactly ONE
   near-collinear partner (armLine dot < −0.95) and no other arm with
   dot < −0.75 is a through-stroke's tail (a shaft piercing a corner), not a
   corner-tip spur. Uniqueness matters: an acute corner's two legs are both
   ≈ −0.91 to its tip spur — a single-arm test vetoed every bullhorn mouth
   corner (bisected: 285 → 279).
3. **face-branch removal** (trace()): rings passing through the joint count
   as a real arm (skipping them deleted every stub past a crossing); sliver
   gate 1.6w → 1.0w (real slivers 0.5–0.7w; bold barbs retract to ~1.3w;
   width- and DT-midpoint-based thinness both failed on other fixtures);
   a short parent spanning two joints qualifies (a tail between a crossing
   and its own face); a parent end whose pool emptied of ≥ 2 slivers (a
   FACE) becomes a free end — for a lone sliver the corner-join still owns it.

**Corpus guardrail for this round: NOT YET RUN** (2026-10-05 — the n=400
runs exceeded the session's background time cap; two parallel slices slowed
each other past it). Before merging, run one slice at a time and compare to
`test/baseline.json` (and to the 2026-09-25 numbers above):
`node test/corpus-harness/harness.js --n 400 --sizes 96` (then 240, 480), and
`--bold --sizes 240` (then 480). Expect pathCount/topology gains wherever
icons carry arrowheads; any drop > 1.0 pt or headline drop blocks.


## Globe round (2026-10-06, on `bold-weight-v2.5`)

User report from the live site: a globe (ring + two latitude lines + a
meridian lens) traced with a bulge/dent at the poles, arcs landing beside the
pole, and a zigzag where a latitude line crosses an arc. Fixture
`test/failures/gen-globe.js` → `globe-thin` (0.8u) / `globe-bold` (1.3u) +
`globe.svg`; test 49 (14 checks, both weights). Suite **312/316** — bell-480
phantom now passes; camera-96, lucide bell, bullhorn handle-end and
small-wave remain.

Root cause (found by dumping the merged ring's points): the "dent" was a
FORCED CHEVRON APEX at (12.9,2.9), 0.9u inside the ring. The pair-merge's
bent-continuation probe (cos −0.97..−0.5) walked the bisector from the seam
down the ink of a meridian arc leaving the pole and planted the "wedge tip"
there; the same false apex produced the latitude-line zigzag at the arc
crossing. Not sagging skeleton points — two attempts to straighten the pole
link (chord through the nodes, node merging) were wrong and reverted; they
broke the bullhorn's bottom edge because T-nodes sit off the stroke.

Mechanisms (mergeChains):
1. **chevron apex consistency**: a bend of (π−φ) between ends `gap` apart puts
   its tip (gap/2)·tan(bend/2) off their chord; an apex farther than 1.5× that
   (+0.1w) ran down another stroke's ink and is rejected. Plus a wedge check
   (ink must narrow along the probe).
2. **straight-continuation seam** projected onto the chord between the two
   trimmed ends (the junction node is displaced toward extra arms).
3. **terminating ends land at the partner's point nearest the junction node**
   (the ray along a curved arm's end tangent lands beside the true foot).
4. **converging terminating arms** (two arcs at a pole): end tangents meet at
   X; if a through-stroke passes within 1.2w of X (an interior point of it),
   both arms end at a common apex pushed (w/2)(1/sin(φ/2) − 1) (≤ 0.45w)
   INTO the through-stroke along the outward normal, with FLAT caps
   (`poleEnd` → butt in the cap pass): the arms' inner edges then meet at the
   ring's inner edge, as authored icons do — on the centerline they cross
   below it and leave a notch ("not connected at the top"); a fused vertex
   with a round join (tried) bumps outward by the same amount. Guards: both
   arms ≥ 3w (a bell rim's end hook beside a corner is not an arm — unguarded
   it bent the body and ate 1.5u of the rim), foot ≥ 1w from the
   through-stroke's own ends.

Corpus (n=400) so far for this round: clean 240 all-pass **34.8% vs 30.9%
floor**, every sub-metric ≥ floor (pathCount 75.2 vs 65.2, centerline 66.8
vs 58.1, topology 60.6 vs 55.0, finishing 87.5 vs 85.7, fitQuality 59.8 vs
54.2). Remaining slices: clean 96 / 480, bold 240 / 480.

Website: the home-page example is now this globe (`web/example.png`).

### Globe round — final (92cdd82, 2026-10-06 evening; live on the site, zip v2.5.6)

User check of the live site (6a86a88): still "not perfect" — a flat seam at the
top of the lens and the two arcs crossing past the ring at the bottom. The
browser's input bitmap was captured (page-side replay of getImageData → PNG →
local receiver) and traced in Node: the skeleton is IDENTICAL to the bicubic
fixture's, so the pole structure is deterministic; the remaining defects were
design, not resampling. Mechanism 4 above (extension into the ring with flat
caps) is REPLACED:

1. **One closed lens, vertex ON the ring, round join** — the authored
   geometry (an icon set's globe is a path whose pole vertex sits on the rim
   with a round join; its arcs' inner edges meet (w/2)/sin(φ/2) below the
   vertex, a small filled wedge under the rim's inner edge that IS the
   authored look). Both pairing routes end here: converging arms fuse through
   the foot; a lens the pairing already closed along the ring collapses its
   shared run to the foot. The raw foot sits ~0.1w inside the true circle
   (skeleton pulled toward the arcs) and is kept: the fitted rim is pulled
   the same way, so vertex and rim stay within 0.03–0.08u; a vertex pushed
   outward bumps (round) or ledges (bevel) the rim silhouette, a miter spikes
   0.27w.
2. **Round-join tagging**: the class miter/round probe at a pole runs out
   through the ring's ink and votes MITER. Joins known round by construction
   (`roundJoins`) tag their corners: they vote round, are never probed, and
   when the class still votes miter such chains get their own
   `stroke-linejoin="round"` path.
3. **Seam-aware run fusion**: the rim reaches the fit with a ~1.2w single-step
   chord at each latitude line's T (junction cut + seam). The rounded-corner
   VETO fit a small circle to that chord and planted tangent anchors → a
   5-anchor rim with a straight piece to the equator (no circle snap).
   mergeChains now records straight-continuation `seams` (straightness
   judged on the strokes' own geometry 1.5w back from each end — the
   pairing's direction read calls a corner's pool curl straight), and the
   fusion stage skips a would-be corner X only when it sits within 0.5w of a
   seam. Skipping any gap that HOLDS a seam shielded the bullhorn's body
   corners beside the handle's T (bottom edge LCCCCC; bisected) — gaps run up
   to 3.2w.
   Tried and reverted: resampling every over-long step before smoothing (all
   chains) also restored the circle snap — and lifted corpus centerline
   66.8→72.4 — but cost 6 suite checks (bullhorn edges, face circle, arrange
   corner: the corner fusion's gap semantics are index-based) and finishing
   87.7→84.4. A junction-chord-only variant remains a lead for centerline.
4. **Fixtures**: globe-thin/bold are now the stroke-authored icon (lens vertex
   on the ring; latitude lines ending ON the ring — the +0.3 "bury" put round
   caps 0.3u past the rim, visible as bumps on the website example); the
   filled-notch variants are dropped. Test 49: one closed 4-anchor lens through
   the equator points, vertices on or just inside the ring at both poles, round
   joins everywhere, 4-anchor rim, 2-anchor lines, 0.5w anchor spacing.

Suite **328/332** — only the four pre-existing rows fail (camera-96 coverage,
lucide bell centerline, bullhorn bold handle end, bullhorn bold small wave).

Corpus clean@240, n=400 (same icons, one slice at a time):

| build | ALL | pathCount | centerline | width | anchors | grammar | topology | finishing | fitQuality |
|---|---|---|---|---|---|---|---|---|---|
| v2.4 floor (baseline.json) | 30.9 | 65.2 | 58.8 | 99.5 | 99.2 | 84.7 | 55.0 | 90.8 | 58.8 |
| 6a86a88 extension + flat caps (was live) | 30.2 | 76.2 | 67.0 | 99.7 | 99.5 | 84.7 | 60.9 | 86.4 | 55.0 |
| 38b9101 fusion (vertex at foot) | 34.8 | 75.2 | 66.8 | 99.7 | 99.5 | 84.7 | 60.6 | 87.5 | 59.8 |
| densification experiment (reverted) | 34.0 | 75.4 | 72.4 | 99.7 | 99.5 | 84.7 | 60.6 | 84.4 | 59.8 |
| **92cdd82 final** | **34.8** | 75.2 | 66.8 | 99.7 | 99.5 | 84.9 | 60.6 | 87.7 | 59.8 |

Finishing sits below the v2.4 floor on every build of this branch since the
2026-09-25 veto round (90.8 → 86–88); it is not new to this round and stays a
ledgered debt. Clean@480, n=400, 92cdd82 vs the v2.4 floor: **ALL 36.1 vs 34.0**, pathCount
79.0 vs 71.4, centerline 75.2 vs 63.9, width 99.7 = 99.7, anchors 99.5 vs
99.2, grammar 85.2 vs 85.4 (−0.2, within policy), topology 63.2 vs 59.1,
finishing 88.0 vs 91.8 (the ledgered debt), fitQuality 62.9 vs 61.6.
Clean@96, n=400, 92cdd82: **ALL 30.9 vs 33.2 floor** — the branch's known
clean-96 deficit from the 2026-09-25 veto round (29.2 then; +1.7 this round),
NOT new: fitQuality 51.9 (50.4 on 09-25, floor 58.1 — veto tangent anchors
read as corners, needs the smooth-pin plumbing) and finishing 83.6 (floor
88.5) carry it; everything else is up: pathCount 77.7 vs 70.3, centerline
77.5 vs 64.5, anchors 99.5 vs 99.2, grammar 84.9 vs 83.4, topology 58.6 vs
55.5. Still the merge BLOCKER it was.
Bold@240, n=400, 92cdd82: **ALL 2.8 vs 4.3 floor; crossWeight 13.3 vs 21**
— both the 2026-09-25 veto-round blockers (2.3 / 12.3 then; +0.5 / +1.0 this
round), not new. Sub-metrics: pathCount 24.8 vs 23.0, centerline 34.0 vs 35.3
(−1.3), width 70.3 vs 69.3, anchors 97.7 vs 96.9, grammar 91.0 vs 91.8 (−0.8),
topology 22.0 vs 22.5 (−0.5), finishing 85.7 vs 82.4 (+3.3), fitQuality 28.4
vs 23.3 (+5.1). The bold tier's absolute level (≤5% all-pass) is the
width-relative-veto problem ledgered on 09-25, unchanged in kind.
Bold@480, n=400, 92cdd82: **ALL 4.1 = 4.1 floor** (headline holds); crossWeight
14.6 vs 22 (the 09-25 blocker: 13.3 then, +1.3 this round). pathCount 26.1 vs
23.8, centerline **34.3 vs 37.1 (−2.8 — UNATTRIBUTED: no 09-25 bold@480
centerline measurement exists; being measured on 6a86a88, the previous live
build, to attribute)**, width 70.8 vs 69.1, anchors 98.0 = 98.0, grammar 89.5
vs 90.0 (−0.5), topology 22.3 = 22.3, finishing 83.1 vs 82.6, fitQuality 28.6
vs 24.3 (+4.3).
All five slices run for 92cdd82. Merge-to-main blockers unchanged in kind:
clean-96 allPass, bold-240 allPass, bold crossWeight (all from the 09-25 veto
round), plus finishing below floor on every clean tier since that round.
