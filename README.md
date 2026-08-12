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
**Use selected layer** — then **Add to canvas**. There are no settings:
everything is derived from the image automatically.

- **Thickness** is the only control: 100% = every line exactly as thick as
  in the image; drag for uniformly thicker or thinner. It resets to 100%
  per image.
- **Copy SVG** puts the raw markup on the clipboard instead.

What the automatic pipeline does:

- traces at up to 2x the image's native resolution (capped at 2600px) —
  upsampling turns sub-pixel gaps between near-touching lines (stitch
  dashes hugging a seam) into gradients the threshold can separate,
- auto-detects dark-on-light / light-on-dark / transparent line art, then
  auto-tunes the threshold by skeleton topology: starting from Otsu's
  value, it tries stricter thresholds and keeps the one with the fewest
  fused lines (junctions), broken lines (endpoints), and stray dots,
- low-quality sources (fuzzy edges, speckle/JPEG noise, low contrast) are
  detected and denoised automatically: a Gaussian-blurred variant competes
  in the same topology scoring and is used only when it wins decisively —
  crisp fine detail is never blurred,
- measures every line's own thickness (distance transform along the
  skeleton) and groups lines into up to 6 weight classes, each emitted as
  its own path — thick outlines stay thick, fine stitching stays fine,
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
  segments (no curve handles, no swivel), and near-horizontal/vertical
  ruler lines snap exactly straight — a rectangle is 4 corners and 4
  handle-free sides,
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

48 checks over synthetic images (lines, circles, junctions, crossings,
dashed stitching, dots, wobbly strokes, transparent/inverted variants,
pokes, knots, collapsed loops, weight fidelity) plus a regression test on
a real AI-generated fashion flat (`test/fixtures/bodysuit.bmp.gz`) —
asserting threshold tuning, dash survival, and weight ratios.
