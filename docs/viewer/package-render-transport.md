# Package render-transport: report

Status 2026-09-23. Reference documentation: `render-transport.md`. Evidence
is in `out/viewer/render-transport/` (screenshots, JSON results, QA scripts
in `qa-scripts/`, integration diffs).

## What it does

- The server builds a binary draw payload (`wonky.draw/1`) per revision:
  center-relative float32 positions, exact per-vertex normals for planes,
  cylinders and cones evaluated in Bend, outward winding, per-vertex face and
  body, B-rep vertex points, edge polylines with their exact class, logical
  faces, and face-to-edge lists. It is served at `GET
  /api/models/:id/draw` (ETag, 304, gzip) and produced by the query pool's
  `draw` handler, or taken from live-server's build worker.
- The browser renders, picks and hovers only from that payload. A typed-array
  picker with a screen grid replaces the per-triangle object picker. A
  JSON-scene adapter gives identical results when only a JSON scene is loaded
  (VS, no WebGL2).
- An LRU cache holds draw models, JSON scenes and GPU buffers. Pins keep the
  displayed, compare, highlighted and annotated revisions; at most 8 others
  are kept; evicted buffers are deleted. A `webglcontextrestored` path
  rebuilds everything from the retained typed arrays.
- Highlight lives in the shader through a state texture. It expands to
  logical faces and takes any number of selected entities. Hover is drawn in
  the frame of the pick.
- WebGL2 with stencil is required. Without it the viewport shows an explicit
  capability message, and the inspector keeps working through the JSON path.

## How to use it

- Server: nothing to configure; `wonky-view` registers the route.
  `curl -s http://127.0.0.1:<port>/api/models/<id>/draw -o model.wkd` returns
  the payload.
- Features: `ctx.renderer.loadModel(id)`, `model(id)`, `bounds(id)`,
  `summary(id)`, `alias(reference)`, `entityPoints(reference)`,
  `pickDetail(x, y)`, `ctx.cache.loadScene(id)`, `ctx.cache.pin(owner, ids)`.
- Debug in the browser: `wonkyViewer.renderer.stats()` (GPU counters, cache,
  picker timings) and `wonkyViewer.renderer.highlightState(id)`.
- Tests: `nice node --test test/viewer-render-transport.test.mjs
  test/viewer-render-transport-server.test.mjs` (18 tests).

## Evidence

Browser QA ran on private instances: 4353 (r10b-retained), 4359 (333k stress
scene) and 4360 (fixtures, `wall-rib`, far1e5, 12 bracket revisions). Chromium
headless ran with Metal at 1536 × 900. The load average is recorded with each
result; the machine was shared and loaded (22 to 107 on 18 cores). Unless a
row says otherwise, the browser runs had the integration patch below applied
in-session with Playwright `page.route`. The repo files of other packages were
not changed.

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | r10b-retained `/draw` ≤ 0.3 MB | 288,244 B raw, 73,673 B gzip on the wire | `a1-transport.json` |
| 1 | no JSON scene request until a face is inspected | requests after opening: settings, workspace, compare/revisions, `/draw`; the first click on a face adds `/api/models/<id>` | `a1-transport.json`, `a1-opened-draw-only.png`, `a1-inspected-json-loaded.png` |
| 1 | JS heap after open ≤ 15 MB above an empty page | +2.14 MB after open, +2.71 MB after the first hover (V8 used size plus ArrayBuffer backing stores, after GC, against `about:blank`) | `a1-transport.json` |
| 2 | hover pick median ≤ 2 ms at 333k triangles, 5 runs | 5 runs × 96 real mouse moves: median < 0.1 ms in every run (timer resolution 0.1 ms), p95 0.1 ms; batched 9,600 picks: 0.024 ms per pick; one projection plus binning per camera change: 32 ms; load 36 to 37 | `a2-stress-pick.json`, `a2-stress-hover-crop.png` |
| 2 | highlight drawn in the frame of the pick | 247 of 247 hover changes were drawn in the same animation frame (rAF timestamp) | `a2-stress-pick.json` |
| 3 | VS picking tests pass | VS 32/32 | test run |
| 3 | JSON adapter and draw payload agree on 96 points | in the browser: 4 models × 4 views × 5 modes × 96 points = 7,680 picks, all identical, also identical to the live `renderer.pick`; unit test on 3 models × 3 views × 5 modes; the grid picker matches the previous linear scan on 96,000 random picks | `qa-models.json` (parity), `grid-vs-linear-parity.txt` |
| 4 | bored-spacer bores smooth | looking into the bore: with exact normals the largest luminance step between neighboring pixels is 0.93 (bore) and 0.79 (outer wall) of 8-bit, 0 bands; the same view with display normals has 15 and 24 steps of up to 3 levels | `a4-bored-spacer-exact-normals.png` vs `a4-bored-spacer-display-normals.png` |
| 4 | an edge behind a 1 mm wall cannot be hovered | `wall-rib` fixture (1 mm wall, rib behind), front view: hovering the midpoints of all 12 rib edges hovers the wall face; `pick(…, 'edge')` returns null; the wall's own front edge is hoverable | `qa-models.json` (wall), `a4-wall-rib-*.png` |
| 5 | with the topology stub each fragment highlights alone | the JSON adapter (one logical face per fragment, the stub's semantics) highlights 1 of the 9 floor fragments; unit test with a lone grouping | `a5-pocket-plate-stub-fragment.png` |
| 5 | one click on the pocket-plate floor highlights the whole floor | already integrated with topology-classes: 46 faces, 11 logical faces; one real click from below highlights all 9 fragments of `B1.L10` | `a5-pocket-plate-logical-floor.png`, `qa-models.json` (logical) |
| 6 | image identical after `WEBGL_lose_context` and restore | 0 of 765,952 pixels differ (threshold 0); the "interrupted" message is hidden again | `a6-before-context-loss.png`, `a6-after-context-restore.png`, `a6-context-restore-diff.png` |
| 6 | 12 revisions keep ≤ 8 unpinned and delete their buffers | the unpinned count never exceeded 8; 8 evictions; `buffersDeleted`, `vertexArraysDeleted` and `texturesDeleted` grow with every eviction of an uploaded model (8 buffers, 3 VAOs, 2 textures each) | `qa-models.json` (revisions); unit test |
| 7 | WebGL2 disabled: capability message, inspector works | `getContext('webgl2') = null` and `--disable-webgl2`: viewport shows the WebGL2 message; the body row and Browse geometry open Body and Face 2 details | `a7-*-message.png`, `a7-*-inspector.png`, `a7-webgl2-disabled.json` |
| 8 | 1e5 mm offset: no gap between face and selection line | far1e5 bored spacer at the physical zoom limit (1000 px/mm): the GPU path (float32 relative positions and matrix) and the SVG line (float64) differ by at most 0.0005 px (0.09 px at 200,000 px/mm, numeric only); absolute float32 coordinates would be off by 10.3 px | `a8-far1e5-rim-selected-1000px-per-mm.png`, `qa-models.json` (offset) |
| 9 | VS 32/32, RV 7/7 | VS 32/32, RV 7/7, DE 2/2, DC 5/5, GS 11/11; VS is also 32/32 with the integration patch applied | test runs |

Without the integration patch (the tree as it is): the viewer opens with the
JSON path, draws the adapter and swaps to the payload. Wipe, side by side,
hover and the SVG edge overlays (`hover-after-clip`, `selection-after-clip`)
work, with no console errors (`legacy-path.json`, `legacy-path-*.png`).
Highlight contrast: `highlight-colors.json`.

Unit tests (`test/viewer-render-transport*.test.mjs`, 18): layout and
alignment, exact normals and winding, oct16 error, adapter parity, the 1 mm
wall, hidden bodies and clip planes, the 1e5 offset, highlight states
(logical, lone fragments, multi-selection, hover outline), the WebGL2
requirement, LRU eviction with pins and GPU deletion, context restore, the
JSON-to-payload swap, hover in the same call, cache Map compatibility, grid
against brute force, the route (ETag, 304, gzip, 404), shared production and
capability errors.

## Gaps and follow-ups

- Integration requests (files of other packages, exact diff in
  `out/viewer/render-transport/integration.diff`, 7 files):
  `features/compare/load-models.js` and `compare.js` (model-first-compare),
  `features/inspector/inspector.js` (help-a11y),
  `features/measure/hover-status.js`, `measure-section.js`,
  `features/selection/selection.js` (exact-measure),
  `features/annotations/annotations.js` (reviews-context). Until they land,
  criterion 1 (no JSON until inspection) and the WebGL2 wording in criterion
  7 hold only with the patch. The tree loads the JSON scene at open, and
  load-models replaces the capability text with "Enable WebGL …".
- `test/viewer-core.test.mjs` "multi-selection …" counts one GL buffer per
  highlight, which the shader highlight removes (0 buffers). The replacement
  assertions are in `out/viewer/render-transport/integration-viewer-core-test.diff`
  (verified to pass).
- `viewer/app.js` (frozen): on context loss it still says "Reload this page
  to restore the view", although the view now restores itself. Suggested
  text: "Restoring the view…".
- Other packages' failures seen during this work: viewer-core camera tests 3
  and 4 (camera-navigation, in progress) and viewer-server test 12 (the
  topology stub assertion versus the real logical faces). They are not caused
  by this package.
- The first pick after a camera change projects and bins everything: 32 ms at
  333k triangles, under 1 ms on r10b. Orbiting is not affected; only the
  first hover after it.
- Payload production runs in-process in the foundation query pool. The
  normals yield every 15 ms, but review-scene preparation for archived
  `.brep.json` snapshots does not. live-server's query worker takes this over.
  The 333k stress payload took about 15 s at load 73.
- The edge highlight on the GPU is 1 device pixel wide. Fat classified edges,
  hiding seam and subdivision edges, and the hover and selection styling of
  the SVG overlay belong to render-look (wave 2).
- `frame.drawLines` and `frame.drawBodies` still throw; render-look fills them
  in. Layers get the model-relative `frame.viewProjection` plus
  `frame.origin` and `frame.matrixFor(origin)`.
