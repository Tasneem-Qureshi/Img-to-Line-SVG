# Line-icon construction rules

Measured from a private ground-truth corpus of 1,173 professionally crafted
line icons (Untitled UI, 19 categories — corpus files live in
`test/corpus-untitled/`, which is **gitignored and never committed**; only
these aggregate measurements are recorded). Every rule below is a measured
number, range, or boolean; the round-trip harness
(`test/corpus-harness/`) turns them into assertions.

## 1. Stroke-based structure — absolute (1173/1173 icons)

| property | value | share |
|---|---|---|
| `viewBox` | `0 0 24 24` | 100% |
| `fill` | `none` (root + every path) | 100% |
| `stroke-width` | `2` (one weight per icon, never mixed) | 100% |
| `stroke-linecap` | `round` | 100% |
| `stroke-linejoin` | `round` | 100% |
| element types | `<path>` only — zero `<circle>`, `<rect>`, `<line>` | 100% |

Stroke-to-canvas ratio: 2/24 = **8.3% of the icon size**. Everything the
drawing needs is stroke centerline geometry; the renderer's round caps and
joins do all finishing.

## 2. Path organization

- Paths per icon: median **1**, p90 = 1, max 9. Nearly every icon is ONE
  `<path>` element containing several subpaths.
- Subpaths per icon: median **3**, p90 = 7, max 24. One subpath per
  continuous line — a stroke is never split mid-run.
- Topology across the corpus: 3,097 open subpaths, 1,135 closed, 302 dots.
  Closed shapes always use `Z`; open ends stay open.

## 3. Anchor economy (per classified subpath)

| shape | anchors: median | p90 | rule |
|---|---|---|---|
| straight segment | **2** | 2 | never subdivided |
| dot | **2** | 2 | drawn as a 0.01-unit dash (`H x+.01`), round cap renders the disc |
| full circle | **4** | 4 | 96% exactly 4 (cardinal anchors); 4% use 8 |
| closed curve (ellipse-ish) | 4 | 6 | |
| open arc | 2–6 typical | 14 | one cubic per ≤90° of turn |
| rounded rectangle | **16** | 24 | 2 anchors per corner + 2 per side; peak at exactly 16 (271 shapes) |
| open polyline (chevrons etc.) | 3 | 3 | corner anchors only |

- Circle curves use the standard cubic circle constant: control-arm /
  radius = **0.5523 (kappa)** in 400 of 432 measured quarter-arcs (92.6%).

## 4. Straightness and angle grammar

Of 1,653 straight segments:

- **75.1% axis-aligned** (within 0.5° of 0°/90°)
- **18.8% at exactly 45°** (within 0.5°)
- 6.2% other deliberate angles
- **35% of icons (413/1173) are mirror-symmetric** about the vertical
  centerline x = 12 (max deviation ≤ 0.3 units).

## 5. Continuity and gaps

- One subpath per continuous line; crossings are drawn as overlapping
  subpaths (ink crosses ink) — the path is never broken at a crossing.
- Cutout gaps (badge notches, where one stroke visually yields to another)
  are real geometric gaps between subpaths: median nearest-ink gap 0.21
  units, p90 = 4.5. **643 icons contain an inter-subpath gap below 3 units
  (1.5× stroke width)** — a tracer must never weld these.

## 6. Corner treatment

- `stroke-linejoin="round"` universally: corner ANCHORS are geometrically
  sharp (a polyline vertex), and the round join renders the outer radius —
  the corner radius equals half the stroke width (1 unit).
- Larger deliberate corner rounds are drawn as curve segments (rounded
  rects, kappa-based), not by join tricks. No `A` (arc) commands appear —
  all curves are cubic Béziers.

## 7. Coordinate hygiene

Of 116,394 numeric coordinates:

- **35.7% integers** (grid points), 3.6% halves, 0.4% quarters
- The remaining 60% carry 3–5 decimals and are **derived values** (kappa
  arms, arc intersections), not sloppiness: 4–5 decimal places dominate
  (58,845 coords), consistent with exact-math exports.
- Design grid: 24-unit canvas, structural landmarks on integers/halves.

## 8. What this means for the tracer

1. Uniform-weight assumption is exact: one weight class, width = 2/24 of
   the icon, ±0 by construction.
2. Circles must come out as 4-anchor kappa circles; straights as 2-anchor
   segments on the 0/45/90 grammar; dots as dots.
3. Rounded rects: sharp-side + kappa-corner construction, ~16 anchors.
4. Caps and joins are ALWAYS round in this style; flat ends in a render
   are corners/joins, not butt caps.
5. Sub-1.5×-width gaps between strokes are intentional — gap bridging and
   junction merging must respect them.
6. Anchor budget: a faithful trace should land within ~1.5× the original's
   anchor count.
