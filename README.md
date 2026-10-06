# Image to Line SVG

Figma plugin that turns raster line art (PNG/JPG of fashion flats, sketches,
icons, doodles…) into **stroke-based vector paths** — so after import you can
change stroke color, weight, caps and dashes like any hand-drawn vector.

Unlike normal image tracers (which output *filled outlines*, where a drawn
line becomes a closed filled shape), this does **centerline tracing**: line
art is thinned to a 1px skeleton, walked into paths, and emitted as
`fill="none" stroke="…"` vectors.

## Install (development plugin)

1. In Figma desktop: **Plugins → Development → Import plugin from manifest…**
2. Pick `manifest.json` in this folder.
3. Run it from **Plugins → Development → Image to Line SVG**.

## Use

Drop / paste (⌘V) / open a line-art image — or select a layer and hit
**Use selected layer** — then **Add to canvas**. Everything is derived
from the image automatically.

- **Thickness**: 100% = every line exactly as thick as in the image; drag
  for uniformly thicker or thinner. It resets to 100% per image.
- **Copy SVG** puts the raw markup on the clipboard instead.
- **Adjust** (collapsed by default) is the rescue hatch for difficult
  sources — only needed when the automatic trace misses:
  - **Threshold** — offset around the auto-tuned ink threshold,
  - **Detail** — keep more anchors (right) or simplify harder (left),
  - **Gap bridge** — how far broken line fragments may heal, as a % of
    the line's own width (0 = off; dashes are never welded),
  - **Sharpen** — set automatically when blur is detected (the slider
    shows what was applied); adjustable or 0 to disable,
  - **Invert** — flip dark-on-light / light-on-dark detection,
  - **Show binarized** — see the intermediate black/white image the
    tracer actually worked from.

Tracing runs in a Web Worker with live progress and a **Cancel** button —
the UI never freezes, and slider changes supersede a running trace. If an
image needs preprocessing (denoise / sharpen / lighting correction) or
looks blurry or photo-like, the plugin says so under the result stats.
Very busy traces warn above ~300 paths and cap at the 900 longest lines
so the Figma import stays usable.

What the automatic pipeline does:

- traces at up to 2x the image's native resolution (capped at 2600px) —
  upsampling turns sub-pixel gaps between near-touching lines (stitch
  dashes hugging a seam) into gradients the threshold can separate,
- auto-detects dark-on-light / light-on-dark / transparent line art, then
  auto-tunes the threshold by skeleton topology: starting from Otsu's
  value, it tries stricter thresholds and keeps the one with the fewest
  fused lines (junctions), broken lines (endpoints), and stray dots,
- low-quality sources are detected and remediated automatically: denoise
  (speckle/JPEG noise), unsharp masking (soft or blurry images, radius
  scaled to measured blur), and background flattening + Sauvola adaptive
  thresholding with hysteresis (photographed sketches with uneven lighting
  or shadows) all compete in the same topology scoring and win only when
  the measured structure says they help — crisp fine detail is never
  blurred; severely blurry or photo-like sources produce an explicit
  warning instead of silent confetti,
- broken line fragments (blur, faint pencil) are healed by gap bridging
  scaled to each line's own width and requiring the two ends to continue
  in the same direction — dashed stitching is never welded,
- measures every line's own thickness (distance transform along clean
  interior spans only — ink pooling at junctions, corners and caps is
  excluded, pooled outliers clipped, the chamfer bias calibrated out) and
  groups lines into up to 6 weight classes, each emitted as its own path —
  thick outlines stay thick, fine stitching stays fine. Classes merge
  within ~22% (anti-aliasing alone skews axis-aligned vs diagonal
  measurements) and strokes too short to measure reliably inherit the
  nearest class instead of spawning their own: a uniform-weight icon
  always produces exactly one class,
- strokes shorter than ~4x their width are protected: conservative
  fitting, length-capped smoothing, no cap probing — a slim tapered arc
  stays a slim smooth arc,
- **merges lines back through junctions**: where lines cross or touch, the
  skeleton chops them apart; ends that continue straight through with
  matching widths are rejoined into continuous curves,
- **junction blobs are excised**: inside a crossing the ink is locally much
  wider and the skeleton wanders, bending every incoming line — chain ends
  are trimmed back until the strokes actually separate (covers tangential
  merges too), then bridged smoothly through the junction center;
  terminating lines extend straight into the joint,
- prunes artifacts: dead-end hairs off junctions (sized by the parent
  line's thickness), tiny junction knot-rings, and specks — while keeping
  isolated dashes and dots (roundish marks render as dots),
- curves are built with least-squares Bézier fitting (Schneider's
  algorithm) — the fewest pen-tool-like anchor points that stay within a
  width-adaptive tolerance, with real corners detected and kept sharp,
- anchors are placed the way a designer would: at curve extremes
  (top/bottom/left/right) with horizontal/vertical handles, and closed
  loops that measure as circles/ellipses snap to mathematically perfect
  ones — a circle is exactly 4 anchors at its cardinal points,
- straight strokes are detected and emitted as true 2-anchor line
  segments (no curve handles, no swivel); near-horizontal/vertical lines
  snap exactly straight and near-45° diagonals snap to exactly 45° —
  the angle grammar of icon design,
- closed shapes that measure as axis-aligned rectangles snap to perfect
  keyline rectangles — sharp-cornered, or uniformly rounded when the
  source is genuinely rounded — and acute tips (chevrons, arrowheads)
  are rebuilt to a sharp apex,
- corners INSIDE continuous strokes are reconstructed too: thinning
  retracts from every convex corner (~w/2) and smoothing rounds it
  further, so the true apex is rebuilt at the intersection of the legs'
  tangents (measured outside the rounded zone, clamped clear of
  neighboring corners, validated against the ink) and pinned sharp;
  L-joints where exactly two strokes meet fuse into one sharp corner,
- stroke finishing is measured from the ink: flat line ends become butt
  caps with the anchor moved to the true ink face (round ends stay round),
  and sharp corners emit miter joins while soft ones stay round —
  per weight class, by majority vote of its ends and corners,
- small/low-res images are upscaled to a ~1400px working resolution
  (up to 6x) before tracing — a 300px icon traces blocky at 2x but
  cleanly at 4-5x — and filled dots that survive as tiny remnants are
  recognized and kept as dots,
- stroke color is sampled from the line centers.

## Tips

- Works best on clean line art with roughly consistent weight per line
  type. Solid filled areas get skeletonized into their "spine" — inherent
  to centerline tracing.
- The result imports as one vector per weight class inside a frame (or a
  single vector when there's one weight) — restyle each class in one click.

## Development

The whole tracer (binarize → thin → walk → measure → merge → prune →
simplify → smooth → SVG) lives in a marked script block in `ui.html`. The
test harness extracts and runs that exact block in Node:

```sh
node test/trace-test.js
```

### The ratchet — no change ships below baseline

One command runs everything: the unit/scenario suite, the icon-corpus
round-trip harness (clean), and the degraded runs (downscale, JPEG q60,
1px blur, 0.5-degree rotation), then compares every pass rate against the
checked-in `test/baseline.json`:

```sh
node test/run-all.js
```

- quick tier by default (stratified 147-icon subset, ~20 min);
  `--full` runs all 1,173 corpus icons (~1 h) for release gating
- **the ratchet policy** (amended 2026-09-21 by the owner):
  - the headline — **allPass, in every tier (clean / degraded / bold) and
    size — may NEVER drop**
  - sub-metrics may drop **at most 1.0 point absolute**, and only if the
    change is net-positive overall AND every dropped sub-metric gets a
    named follow-up fixture under `test/failures/` (a concrete regressed
    icon with a failing assertion) **in the same commit**
  - larger drops still block (`run-all` exits non-zero and prints them)
- when a run improves, lock the new numbers in with `--update-baseline`
- pass thresholds are checked in at `test/corpus-harness/thresholds.json`
  (a stricter clean tier and a documented degraded tier)
- every run regenerates `test/corpus-report/gallery-<mode>.html` — the
  worst-10 side-by-side gallery, so visual drift is one glance away
- every bad trace found in the wild follows the test-first policy in
  `test/failures/README.md`: check in the image + a failing assertion
  BEFORE the fix

The corpus itself (`test/corpus-untitled/`, private Untitled UI icons) is
gitignored and never committed; the committed ground-truth fixtures come
from Lucide (ISC) in `test/fixtures/lucide/`. Aggregate corpus statistics
live in `CONSTRUCTION_RULES.md`.

201 checks over synthetic images (lines, circles, junctions, crossings,
dashed stitching, dots, wobbly strokes, transparent/inverted variants,
pokes, knots, collapsed loops, weight fidelity, icon-rule snapping, filled
shapes, scale invariance) plus a regression test on a real AI-generated
fashion flat (`test/fixtures/bodysuit.bmp.gz`) and a real-world scenario
matrix with overlay acceptance metrics (ink coverage / phantom strokes):
photographed sketch under uneven lighting, soft and severe blur, crosshatch
separation, colored lines on colored background, photo detection, and
gap-bridging semantics (heals breaks, never welds dashes). A dozen real
Material Design Icons renders (`test/fixtures/icons/`, two export sizes
each, exactly one stroke weight by construction) assert the uniform-weight
guarantees: one class, sharp classification, no warnings, coverage/phantom
bounds, straight-bar and miter-corner geometry, and a 25%–400% thickness
sweep.

## Website

The same tracer runs as a standalone web page — nothing is uploaded, the
whole pipeline executes in the visitor's browser (a Web Worker), exactly as in
the plugin.

`web/index.html` is **generated** from `ui.html` so there is one source of
truth: the plugin's styles, markup, tracer block and UI script are copied
verbatim, then adapted for the web at build time — the Figma-only "Use
selected layer" button is hidden, "Add to canvas" becomes "Download SVG", and
web-only actions are added (Upload image, Try an example, Download PNG,
Share…, and an opt-in "send us this trace" form). A host shim at the end of the
page answers the messages the UI would normally send to Figma (`import-svg` →
file download, `notify` → toast). Images enter through the plugin's own
`selection-image` channel; results are read back from the preview's blob URL,
so the UI script itself needs no web-specific code.

```sh
node web/build-web.js                           # rebuild after any change to ui.html
python3 -m http.server 8765 --directory web     # then open http://localhost:8765/
```

### Hosting (free)

The site is static files. **Netlify** is the recommended free host: drag the
`web` folder onto <https://app.netlify.com/drop> and it is live with HTTPS;
`netlify.toml` is included for a Git-connected site (publish dir `web`, build
command `node web/build-web.js`). The "send us this trace" form uses
**Netlify Forms** (free tier: 100 submissions/month, file uploads included) —
after the first deploy, open the site's *Forms* tab and add an email
notification for the `trace-report` form to receive each image + SVG + note.
On hosts without form handling the rest of the site works; only that form
reports an error when submitted.

Other free options: Vercel / Cloudflare Pages (import the repo, no build
command, output directory `web`) or GitHub Pages
(`git subtree push --prefix web origin gh-pages`).
