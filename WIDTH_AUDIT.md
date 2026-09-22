# Width-invariance audit

Every threshold in the tracer (`ui.html`, TRACER block), audited 2026-09-21.
The repo's standing lesson: *every fixed pixel constant is a latent bug when
a new stroke-width regime appears.* Statuses:

- ✅ **width-relative** — scales with the stroke, no action
- 🔴 **latent (fixed px / capped)** — breaks at bold; fixed this round
- ⚖️ **justified constant** — cannot/should not scale; justification given

`w` = the chain's measured stroke width (trace px). `avgW` = the drawing's
length-weighted average width. **`wEff = min(w, 1.5·avgW)`** is the new
capping idiom introduced this round: geometry windows scale with the stroke,
but a degenerately fat measurement (fused blob, w ≫ avgW) is capped against
the drawing's own weight instead of against absolute pixels.

## Fitting & cleanup

| threshold | previous definition | disposition |
|---|---|---|
| fit tolerance (eps) | `min(26px, 0.2·w)·detail` | 🔴 26px cap ≈ 0.16·w at bold → anchor spam. Now `0.2·wEff·detail`, no px cap |
| filled-shape fitTol | `max(1.5, min(45px, 0.45·w))·detail` | 🔴 same. Now `max(1.5, 0.45·wEff)·detail` |
| smoothing radius | `0.4·w`, internal cap 40px | 🔴 cap ≈ 0.25·w at bold → under-smoothing. Now `0.4·wEff`, guard cap 160px |
| fitCubic split-tangent window | `max(4, min(40px, 0.5·w))` | 🔴 cap ≈ 0.25·w at bold → lumpy split handles. Now `max(4, 0.5·wEff)` |
| fitArc terminal-tangent window | `max(10, min(30px, 0.25·w))` | 🔴 same. Now `max(10, 0.25·wEff)` |
| corner-detect window | `max(2, min(120px, tol·4, n>>3))` | 🔴 120px cap under-scales once tol is uncapped. Cap raised to 200px (guard only); `tol·4` and `n>>3` carry the scaling |
| corner turn threshold 0.95 rad; concentration 0.68; curl ceiling 2.1 rad | angle constants | ⚖️ angles are scale-free by definition |
| corner apex reach ≤ 1.5·window; leg-tangent windows w..3w | window-relative | ✅ (fixed transitively by the window fix) |
| straightness gate | `max(1.5, min(0.9·tol, max(0.12·w, 0.04·chord)))` | 🔴 the 0.12·w wobble floor exceeds a genuine arc span's sagitta at bold (bold wave → LLLL). Now sign-aware: the wobble floor applies only when deviations alternate (mean signed dev ≤ `0.03·chord+1.5`); a one-signed bulge (an arc) never passes via the floor |
| cleanup cluster limit | `max(2px, w/2)` | ✅ (2px = sub-pixel floor ⚖️) |
| cleanup merge tol | 0.6·tol regular / 1.15·tol clusters / 1.6·tol terminal | ✅ ratios of a width-relative tol |
| G1 gates cos 0.966 / corner-keep 0.55 | angle constants | ⚖️ |
| mergeSegPair dense validation, 2px sampling, 48 samples | resolution constants | ⚖️ sampling density, not geometry |
| extreme prominence `max(1.5, tol·1.2)`; extreme-skip span `< max(16, 3.5·w)` | ✅ |
| RDP epsilon | width-scaled via eps | ✅ |

## Junction machinery

| threshold | previous definition | disposition |
|---|---|---|
| through-pair proximity `lim = max(4, 0.75·(jrA+jrB))` | ✅ (4px floor ⚖️) |
| near/far pair gate `dist > 6px` | 🔴 fixed px: at bold, same-junction trim points sit farther apart than 6px, so every pair is judged by the stricter far gate. Now `dist > max(6, 0.15·(jrA+jrB))` |
| pair width-ratio 1.35 (far) / 1.7 (near) | ratios | ⚖️ |
| knot-fragment tag `< 0.5·w`; sort penalty +0.12 cos | ✅ / ⚖️ |
| corner-join baseLim `max(6, 0.75·(wA+wB))`; acute-tip 1.4·(wA+wB), len ≥ 3w, det ≥ 0.3, reach 1.6·(wA+wB) | ✅ (6px floor ⚖️) |
| jointInked walk step 3px, holes `max(2, 12%)` | ⚖️ pixel-space sampling density |
| coveredByOthers: cell 16px, radius 0.3·(wA+wB), own-body guard 1.5·w, 75% | ✅ (cell size = index resolution ⚖️) |
| seam ink-apex probe: fire 0.55·w..4·w | ✅ |
| ring closes: pair-close len ≥ 4·w; standalone len ≥ 10·w & ends < 0.15·len | ✅ |
| junction trim: minTrim 1.15·jr, maxTrim min(0.35·len, 8·jr), wLimit max(1.35·w, w+2) | ✅ |
| trim-eligibility `len ≥ 2.5·minTrim` | ✅ |
| bridge (degraded only): reach 1.5·pairW, cap-retract (wA+wB)/2, cos −0.85 | ✅ |

## Caps & ends (classifier rebuilt this round)

| mechanism | definition | disposition |
|---|---|---|
| flat-cap hygiene trim | free ends trimmed while local ink radius `dist/3 < 0.75·wHalf` (max cut 1.2·w): the face's own medial branch tapers into the corner and sits closer to background than a true centerline point | ✅ width-relative ("trim ~w/2 from the face") |
| sub-face-scale routing | `w < 8px`: no trim, caps default round — the whole cap zone is a few quantized pixels and butt-vs-round is not measurable | ⚖️ absolute floor: pixels, not geometry |
| straight ends (`R_fit > 6·w`) | classic probe: 1-ray (w<14) / 3-ray (`0, ±0.5·wHalf`) run to the face, flat probes ±0.5/0.8·wHalf at 0.75·L (3-of-4), wide guard 1.7·wHalf, early-butt `< max(2, 0.4·wHalf)` | ✅ |
| curved ends | Kasa least-squares circle over `min(len, 2.5·w)` of the end; walk ALONG the fitted circle (2px steps, max `2.2·wHalf+6`) watching the cross-section (cap 1.4·wHalf/side); stop when the section collapses below `0.5·secMax`; classify by FACE WIDTH at the stop (`min lat ≥ 0.35·wHalf` after one lateral re-centering) — butt anchors extend along the arc to the face | ✅ every gate in wHalf units |
| cap-vs-corner guard | `nearOther < 1.4·(wA+wB)` AND the joint between the two ends is inked (`holes ≤ max(2, 12%)`) — parallel neighbor strokes at bold come near each other across background and keep their own caps | ✅ |
| face-branch removal | a chain end whose junction is populated ONLY by short (`< 1.6·w`) free-tailed slivers loses them (the flat face's own medial branch); the end is then downgraded to free and re-enters cap classification | ✅ |
| intra-cap debris | free-ended chains fully inside `0.8·w` of another chain's free end pruned before merging | ✅ |

## Bold assembly (new mechanisms this round)

| mechanism | definition | disposition |
|---|---|---|
| corner-tip spur consumption | short (`< 1.25·W`) one-junction chains whose tip bisects two arms (arm-dir dot ≥ −0.75, bisector alignment ≥ 0.88, arm width ratio ≤ 1.6, arms ≥ 1.2·w long) are corner APEX evidence: the arms fuse through the tip as a forced corner | ✅ all gates angle- or width-relative |
| armPrep (tail cut) | fuse arms cut back to the first tangent-STABLE point (adjacent 0.15·w windows, cos > 0.98) whose leg to the apex is inked AND centered (balance ≤ 20%, both sides ≥ 0.28·w, capped 0.8·w) | ✅ |
| second-corner rebuild (corner2) | when no arm depth aims at the apex, the missing leg was swallowed whole by the pool: slide along the arm's tangent (≤ 3·w) for the pivot whose apex leg is inked+centered; pivot judged on the leg's middle (0.4/0.55/0.7) | ✅ |
| straight-run corner synthesis | confident straight runs (`≥ max(1.2·w, 30px)`, lateral ≤ `max(1.5, 0.08·w)`, one-signed mean ≤ `max(0.6, 0.015·len, 0.012·w)`) meeting across a short gap (≤ 1.6·w) at 12°–105° with pool-litter evidence (gap points straying > 0.28·w off the wedge) fuse at the line intersection: ONE forced corner anchor | ✅ |
| smoothing pins | forced apexes pin `smoothChain` (window tapers to zero toward them, like open ends) and `recenterOnInk` avoids `1.2·w` around them — a corner wedge's ink median is not the centerline | ✅ |
| forced-corner authority | fitChain: a forced apex displaces detections within the corner window and never merges away or defers; duplicate corner indices dedupe (closed-path rotation safety) | ✅ |
| junction-end extension | terminating ends extend along a width-deep (`0.35·w`) tangent to the first crossing of a partner's segment INTERIOR (a sibling's retracted end within `0.8·w` of its own tip does not count); fallback: the junction pool center | ✅ |

## Pruning, dots, debris

| threshold | previous definition | disposition |
|---|---|---|
| hair prune `min(max(32px, 2.4·jw), lim)`, lim = `max(1.5·w, 2.2·jw)` / `1.5·w+2` | ✅ (32px floor: minimum meaningful hair at any scale ⚖️) |
| both-junction stub `max(20px, 2·jw)` / `min(20px, 1.5·w)` | ⚖️ the 20px cap *protects* short real connectors; at bold it only prunes less (safe direction) |
| realStub rescue: `w ≥ 0.45·avgW`, `len > 0.6·jw`, `len ≥ 0.85·avgW` | ✅ |
| dot rules: `len < 1.3·w`, ring `len < 3.5·w`, disc `len < 1.15·maxW+2`; isolation-probe pad +3px | ✅ (+3px = just-outside-ink pad; now `max(3, 0.1·w)` for bold) |
| debris ray-cast max run 80px | 🔴 at bold `w > 80px`: rays can't even cross one stroke. Now `max(80, 3·w)` |
| fusion-remnant drop `len < 0.9·(ew0+ew1)/2` | ✅ |

## Width measurement & classes

| threshold | previous definition | disposition |
|---|---|---|
| interior margin 1.5·w; outlier clip 1.25·med (keep ≥60%) | ✅ |
| chamfer scale DSC=3; width `2·r/3−1` | ⚖️ metric constants of the 3-4 chamfer |
| class greedy 1.25·minW+0.6; class merge 1.22·+0.6 | ✅ (+0.6px sub-pixel floor ⚖️) |
| short-chain seeding `len ≥ 4·w` | ✅ |
| filled-shape: core `max(2.5, 0.95·w)`, compactness 3.2·thick, passers ≥ 2 | ✅ (2.5px floor ⚖️) |

## Raster stage (resolution/statistics space — not width space)

| threshold | value | justification |
|---|---|---|
| proxy cutoff 700²; ladder factors 1/.85/.7/.55; topo weights 12/3/8; economy 0.05; gate 1.3×+120 / 0.85×; blur grades 0.5/0.22 (srcScale-corrected); Sauvola win `min(w,h)/16` clamp 15..90, k 0.28; fillHoles `min(150, max(24, 0.02%))`; photo tell CV 0.62; upscale target `min(2600, max(2·nat, 1400))` | ⚖️ these operate on image statistics and working resolution, not on stroke geometry; the whole candidate competition is tuned at this proxy resolution (see the code comment at the proxy) — changing them reshuffles every scenario |

**Summary: 8 latent thresholds fixed via the `wEff` idiom + sign-aware
straightness** (fit tol, filled fitTol, smooth radius, two tangent windows,
corner window cap, straightness floor, near/far pair gate, debris ray), the
cap classifier rebuilt around ink-face evidence (hygiene trim + straight/curved
routing), and seven new width-relative assembly mechanisms for fused-pool
reconstruction at bold weights. Every remaining constant is either an angle
(scale-free), a sampling density (pixel-space by nature), a sub-pixel floor,
or a raster-stage statistic — each justified in place.
