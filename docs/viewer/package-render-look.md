# Package render-look: report

Status 2026-09-23. Reference documentation: `render-look.md`. Evidence is in
`out/viewer/render-look/` (screenshots, JSON results, QA scripts in
`qa-scripts/`).

## What it does

- Lighting: hemisphere ambient keyed to world +Z, a view-space key light, a
  weak fill and a low specular, in linear space with sRGB output, two-sided
  through the outward winding and `gl_FrontFacing`.
- Edges: instanced screen-space quads, 1.5 CSS px (setting 1 to 3),
  `#1d2721`, moved 1 CSS px of view depth toward the eye (`depthPerPixel`).
  They are drawn per exact class: sharp and unresolved opaque, tangent at
  45 %, seam and subdivision hidden. `Shift+E` shows seam and subdivision
  edges at 30 %, and `E` (view feature) turns all class edges off. Hovered,
  selected and outlined edges are drawn 2.5 px wide whatever their class.
- Style table: features write their own `display.*` key, and
  `features/display/display.js` composes them into one style and is the only
  caller of `renderer.setStyle()`. Body styles are keyed by body id with
  per-revision overrides by model id. Colors come from the model's
  `appearance`, otherwise from an 8-color viewer palette labelled "viewer
  colors", otherwise from a parts-tree override.
- Transparency: opaque pass, then transparent bodies back to front (back
  faces, then front faces, no depth writes), then their depth and a stencil
  mark. The edges of transparent bodies follow; hidden ones are drawn faint.
  `T` (x-ray) makes every body 50 % transparent. A per-body rank depth
  offset gives coplanar faces of different bodies a stable winner.
- Clip-plane uniforms (up to 3, same half-space as the picker), per-face
  overhang flags in the face state texture, overhang uniforms, and a per-body
  up axis and printed flag in the body style texture.
- Layer helpers `frame.drawLines()` (fat lines with depth bias) and
  `frame.drawBodies()` (stencil, culling, colorMask, depth options, another
  model such as a ghost).
- Legend in the status bar: "display mesh ±0.02 mm" plus the active
  display-only features.
- Settings: E (G), edge width (G), Shift+E (G) and x-ray (S, per source)
  survive a restart.

## How to use it

- Keys: `E` edges, `Shift+E` seam and subdivision edges dimmed, `T` x-ray (also
  the view action next to the edges button).
- Features: write `display.parts`, `display.section`, `display.fdm` and
  `display.ghost` in the shapes listed in `render-look.md`. Draw grids,
  plates, contours and ghosts with `renderer.addLayer({ id, order,
  draw(frame) })` and `frame.drawLines` / `frame.drawBodies`. Body swatches
  and labels come from `ctx.app.bodyColors(modelId)`.
- Debug in the browser: `wonkyViewer.app.debugLayer({ lines: { positions,
  widthPx, depthBias, color } })`, `wonkyViewer.app.debugStyle({ clipPlanes,
  overhang })`, `wonkyViewer.renderer.look(id)`,
  `wonkyViewer.renderer.stats()`.
- Tests: `nice node --test test/viewer-render-look.test.mjs` (14 tests).
- QA: `node out/viewer/render-look/qa-scripts/qa-look.mjs [section …]`
  against a private viewer on port 4357; `perf.mjs` and `perf-parts.mjs`
  against the 333k stress scene on port 4358; `persist.mjs set|check|reset`
  around a restart.

## Evidence

Headless Chromium with Metal (Apple M5 Pro, ANGLE), 1536 × 900 CSS px, DPR 2
(canvas 2048 × 1496 device px, 4× MSAA). Private viewers on 4357 (fixtures,
r10b-retained, r10b-first-failure-inputs) and 4358 (stress-r10b-8x8: 332,920
triangles, 143,488 edge segments, 320 bodies). The machine was shared; the
load average is recorded in every JSON (15 to 31 on 18 cores).

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | Edges 1.5 CSS px on DPR 2 screenshots | 348 visible edge profiles (8 fixtures × 7 views, coverage integral across the line in encoded luma): median 1.500 CSS px, P10 1.470, P90 1.521. The darkest pixel of 346 of 348 profiles is exactly (29, 39, 33) = `#1d2721` | `qa-look.json` (edges), `a1-bracket-iso-dpr2.png` |
| 1 | ≥ 4.5:1 on every face shade | viewer palette: the darkest opaque face pixel of 56 renders (edges off, 8 fixtures × 7 views) has luminance 0.297, worst contrast 5.09:1; unit test: ≥ 4.5:1 for every palette color over 624 cameras × 400 normals. **Appearance colors**: dark model colors cannot reach it (r10b carriers 3.06 to 4.65:1, first-failure slate body 3.13 to 3.93:1), see gaps | `qa-look.json` (edges, appearance), test 1 |
| 1 | Seam and subdivision hidden; Shift+E dimmed; E all | bored-spacer seam: contrast to its face 1.01:1 hidden, 1.65:1 with Shift+E; pocket-plate subdivision edges 1.00:1 hidden, 1.63 to 1.78:1 dimmed; arc-slot tangent edges 2.33:1 (45 %), sharp 7.3 to 14.7:1; `E` sets `style.edges = false`, legend "edges off" | `a1-seams-hidden.png`, `a1-seams-dimmed-shift-e.png`, `a1-pocket-plate-subdivision-{hidden,dimmed}.png`, `a1-arc-slot-tangent-45.png`, `a1-edges-off-e.png` |
| 2 | Principal iso faces ≥ 1.3:1 | mean luminance +Z 0.677, −Y 0.495, +X 0.359; smallest pairwise ratio 1.332 (bracket), 1.330 (pocket-plate), 1.332 (cross-bore) | `a2-*-iso-faces-edges-off.png`, `qa-look.json` (iso) |
| 3 | r10b-retained appearance colors | all 5 bodies `colorSource: appearance`; floor and wall (140, 153, 179) render as (147, 161, 187) and (135, 148, 172), pickup plate (217, 110, 33) as (232, 119, 37), carriers (107, 122, 130) as (100, 115, 121) (grid means, iso) | `a3-r10b-retained-appearance.png`, `…-top.png` |
| 3 | Bodies without appearance use the labelled palette | pin-in-bore B1, B2 and r10b-first-failure-inputs B2: `viewer-palette`; legend "viewer colors" with the title "B1, B2: no appearance in the model; colors from the viewer palette, not model data." | `a3-pin-in-bore-colors.png`, `a3-legend-viewer-colors.png` |
| 4 | Coplanar edges continuous (r10b-first-failure-inputs) | 12 edges of B1 lie in the +X face of B2 (found geometrically from the draw model). Oblique zoomed view: 389 of 389 visible samples along them are edge-dark. The coplanar faces show one body, not noise | `a4-coplanar-crop.png`, `a4-coplanar-0.png`, `qa-look.json` (coplanar) |
| 5 | T: all bodies 50 % transparent, faint hidden edges | alpha 0.5 per surface (single layer 128, closed body front plus back 191); hidden edges 1.41 to 1.47:1 against the surface (1.00 without x-ray), visible edges unchanged; legend "x-ray 50 %", button pressed | `a5-bracket-xray-t.png`, `a5-r10b-retained-xray.png`, `a5-bored-spacer-xray.png` |
| 6 | Median frame ≤ 4 ms at 333k triangles, 5 runs | final run, orbiting, one viewer draw per frame: **3.95 ms** = GPU 3.85 ms (timer query, median of 5 run medians) + CPU 0.10 ms, load 27 to 30. Run medians are 2.9 or 3.9 ms (GPU clock states). Earlier runs: 3.76 ms (load 17) and 3.5 ms. Warm steady state (`perf-parts`): 2.26 to 2.28 ms, edges off 1.5 to 2.1 ms, empty frame 0.18 ms. Pessimistic bound with a 1-pixel readback per frame (MSAA resolve and round trip): 5.2 ms | `a6-perf-333k.json`, `a6-perf-parts.json`, `a6-stress-333k.png` |
| 7 | Debug layer: fat line with depth bias | `debugLayer({ lines: { positions, widthPx: 3, depthBias: 1 } })` on the bracket top face (coplanar): 535 of 535 centre samples red; the same line with `depthBias: 0`: 448 of 535, visibly thinner | `a7-debug-line-bias-1px{,-crop}.png`, `a7-debug-line-bias-0px{,-crop}.png` |
| 7 | Debug style: clip plane and per-face overhang flag | `debugStyle({ clipPlanes: [x = mid], overhang: { faces: { 'B1.F?': 'overhang' } } })`: half the bracket clipped, the top face tinted, legend "display section". Curved: bored spacer with up = +X, both cylinders flagged, and only the bands with −n·up > sin 45° tinted, legend "curved overhang sampled" | `a7-debug-style-clip-and-overhang.png`, `a7-debug-style-curved-overhang-up-x.png` |
| 8 | Legend | bracket "display mesh ±0.02 mm · viewer colors"; bored-spacer "… · smooth normals · seam edges hidden · viewer colors"; r10b-retained "… · smooth normals · seam edges hidden"; x-ray, section and overhang items as above | `a8-legend-r10b.png`, `qa-look.json` (legend) |
| 9 | VS 32/32, RV 7/7 | VS 32/32, RV 7/7; render-look 14/14; render-transport 15/15 unchanged | test runs |

Additional checks:

- Settings survive a restart. With Shift+E on, width 2.25, E off and x-ray on
  for the bracket, stopping and restarting `wonky-view` with the same reviews
  directory gives the same style and button states (`a10-persist-*.json`).
- Hover and selection tints on the lit face: CIE76 ΔE 31.1 and 40.4
  (≥ 20), `qa-look.json` (highlight).
- Wipe and side by side draw both panes with per-pane scissor
  (`a9-compare-*.png`). `WEBGL_lose_context` followed by a restore gives an
  identical image (0 of 10,813,440 bytes differ), with the line program
  rebuilt (`lookPrograms` 2).
- At 1150, 900 and 650 px the legend stays at 11 px and keeps the tolerance
  visible; the rest ellipsizes, and the full text is in the item titles and
  `aria-label` (`a11-width-*.png`).
- No console errors or warnings in any QA session.
- `check-format`, and `check-contracts` (static and live on 4357), pass.

## Gaps and follow-ups

- **Dark appearance colors are below 4.5:1.** The criterion holds for every
  viewer-palette shade. Model colors with a lit luminance around 0.2 (r10b
  carriers, the first-failure slate body) reach 3.1 to 4.7:1 against
  `#1d2721`. No single edge color can reach 4.5:1 on such a face: the
  maximum against black is 3.7:1 and against white 4.2:1. The appearance
  color is model data and is shown as is. A halo or outline pass would be a
  follow-up.
- **The frame-time margin is small.** 3.95 ms against 4 ms on a loaded
  machine, with GPU clock states moving the run medians between 2.9 and
  3.9 ms. The work itself is about 2.3 ms at full clock, and neither the
  fragment shading nor the extra texture fetches measurably change it (both
  tested). **X-ray on the 333k scene costs 7.0 ms**: 320 bodies sorted,
  2 draws each, full overdraw. It is not part of the criterion, but it is
  over the budget.
- No silhouette lines on curved faces (audit 7.5: outline pass or exact
  generators). Cylinder outlines against the background come only from
  shading contrast.
- Fat lines use square caps. A segment with an end behind the perspective eye
  is dropped, not clipped. The rank offset repeats every 8 bodies, so bodies
  whose indices differ by a multiple of 8 still z-fight if they overlap
  coplanarly. The winner of a coplanar overlap is the higher body index, not
  a semantic choice.
- Mixed opacity: the faint hidden edges of a transparent body can also show
  through an opaque body that lies behind a transparent front surface (the
  stencil mark is per pixel, not per layer).
- Hover now mixes in linear space: ΔE 31.1 against render-transport's 37.5
  (still ≥ 20).
- X-ray is per source (spec: S). Switching to another source restores that
  source's own value.
- Overhang is renderer support only. The printability API, the "no tint until
  the API answered" rule and the plate are fdm's.
- The legacy `features/view/view.js` is still the active view feature
  (camera-navigation's `navigation.js` awaits its integration request). Both
  write `display.edges`, so E works with either.
- File naming: the owned list said `test/viewer-look.test.mjs`. The package
  instruction asked for `test/viewer-render-look*.test.mjs`, so the tests are
  in `test/viewer-render-look.test.mjs`. `docs/viewer/render-look.md` and
  this report are both written.

## Integration requests

1. `viewer/render/picking.js`, so hidden bodies follow the full style table
   (per-revision overrides, opacity 0):
   ```js
   import { resolveBodyStyle } from './style.js';
   export function hiddenMask(model, style, modelId = model.id) {
     if (!style?.bodies && !style?.models) return null;
     let mask = null;
     model.bodies.forEach((body, index) => {
       if (!resolveBodyStyle(style, modelId, body, index).visible) {
         mask ??= new Uint8Array(model.bodies.length);
         mask[index] = 1;
       }
     });
     return mask;
   }
   ```
   and in `createPicker().detail`: `hidden: hiddenMask(model, style, pane.modelId)`.
2. `test/viewer-core.test.mjs`, "multi-selection …": apply
   `out/viewer/render-transport/integration-viewer-core-test.diff`. It is
   verified to pass against the render-look renderer (the layer line buffer
   is created lazily, so highlights still allocate no buffers).
3. live-client: give the trust chip in `statusBar.item` `flex-shrink: 0`. The
   display legend is `flex: 0 1 auto; max-width: 48%` and ellipsizes, but the
   chip should never be the item that shrinks.
4. help-a11y: render `slots.list('settings.item')`, which includes
   `display.edgeWidth` (number 1 to 3, step 0.25, CSS px) and
   `display.hiddenEdges` (boolean). List `Shift+E` and `T` in the help
   overlay (commands `display.hiddenEdges`, `display.xray`).
