# Package fdm: report

Status 2026-09-23. Reference documentation: `fdm.md`. Evidence is in
`out/viewer/fdm/` (screenshots, `qa-results.json`, `perf.json`,
`check-normals.txt`; scripts in `qa-scripts/`).

## What it does

- **Build plate** (`G`): a 256 × 256 mm plate at Z = 0, centred on the world
  origin, drawn as grid lines (10 mm, 1 mm when zoomed in), outline and
  origin axes. On by default for live sources, off for `.brep.json` inputs,
  persisted per source. Plate size is a global setting.
- **Printability API** (`POST /api/models/:id/printability`, query worker):
  per body, with its own up axis and printed flag. Planar faces are
  classified exactly (α from the stored normal), cylinders and cones get
  exact angular bands (supporting band intersected with the face's circle
  edge coverage), bed faces are detected at the body minimum along up, hole
  cylinders with Ø ≤ 12 mm are exempt (cad-khana `SMALL_BORE_MM`), and the
  answer echoes α, β = 90° − α, the conventions and the exemptions (bridge
  exemption "not applied"). Body extents are recorded bounds or kernel edge
  bands, labelled.
- **Per-body settings**: printed (default on) and up axis (default +Z),
  persisted by source + body name (or body id). "Print on selected face"
  (`Shift+B`, inspector button, panel button) sets up = −n of the selected
  planar face's exact outward normal. The geometry never moves.
- **Plate relation**: status bar for exactly one visible body ("on plate",
  "floats 3.2000 mm above the plate", "cuts 4.0000 mm into the plate",
  "bed faces: B1.L4", "footprint exceeds plate", each with its exactness
  chip); with several visible bodies a badge per parts-tree row.
- **Overhang tint** (`Shift+G`): only after the API answered for the
  displayed revision and the current settings ("pending" before, also after
  a live swap); legend card with "overhang α > 45° from vertical (slicer
  threshold β = 45°)", the small-bore and bed outlines, "bridge exemption
  (≤ 10 mm) not applied" and the curved band-edge bound ("curved band edges
  ±4.1° (display strips)"); "exempt: small bore Ø8" labels.
- **Print check panel** (view action): plate on/off and size, overhang on/off,
  α_max with the live β, small-bore exemption, per body printed + up axis +
  relation badge.

## How to use it

- `G` plate, `Shift+G` overhang shading, `Shift+B` print on the selected
  planar face. The sliders icon in the view actions opens Print check.
- In the parts tree, expand a row for "printed" and "up"; the relation badge
  sits in the row.
- API: see `fdm.md`. From a shell:
  `curl -X POST -H 'Content-Type: application/json' -d '{"alphaDeg":45}'
  http://127.0.0.1:<port>/api/models/<id>/printability`.
- Tests: `nice node --test test/viewer-fdm.test.mjs` (17 tests).
- QA: `node scripts/viewer/qa/fixtures.mjs --only chamfer-45,cross-bore-16`,
  then `nice node out/viewer/fdm/qa-scripts/qa-fdm.mjs [section …]`
  (sections plate relation overhang exempt pending settings compare widths
  live; it starts viewers on 4363 and 4366 and stops them) and
  `nice node out/viewer/fdm/qa-scripts/perf.mjs`.

## Evidence

Headless Chromium with Metal (ANGLE), 1536 × 900 CSS px, DPR 1, private
viewers on 4363 (fixtures, restart with the same reviews directory) and 4366
(live copy of chamfer-45 in `tmp/viewer/live/fdm/`). Load average 14 to 24.
Final QA pass: 28 of 28 checks, no console errors or warnings
(`qa-results.json`). Tint checks read the WebGL canvas right after a draw
at projected points and confirm with the picker that the pixel belongs to
the expected face.

| # | Criterion | Result | Evidence |
|---|---|---|---|
| 1 | `G` shows the 256 × 256 plate as grid lines with origin axes; on by default for live sources | `.brep.json` input: off, `G` on, plate 256 × 256, 1397 segments (depth-clamped). Live chamfer-45: plate on at r1 without a key | `a1-plate-iso.png`, `a1-plate-top-full.png`, `a1-live-plate-default.png` |
| 1 | Bottom view shows the model through the plate | bottom preset: between grid lines the bed face is picked and face-colored (175, 204, 177); on the X axis at (15, 0, 0) the red plate line is drawn in front of it. Model bounds unchanged. Key `2` is not bound in the integrated tree yet (camera-navigation's `navigation.js` awaits integration), so the QA sets the same `bottom` preset through `render/camera.js` | `a1-plate-bottom-view.png` |
| 2 | One visible body: "on plate" / "floats … mm" / "cuts … mm" with its label | chamfer-45 "B1 on plate · recorded"; floating block "B1 floats 3.20000 mm above the plate · recorded" (F32 body, tolerance 2.9e-5 mm, so five decimals); pin-in-bore with B1 hidden "B2 cuts 4.0000 mm into the plate · recorded" | `a2-status-on-plate.png`, `a2-status-floats.png`, `a2-status-cuts-one-visible.png` |
| 2 | Several bodies: badges per parts-tree row | pin-in-bore: status "2 visible bodies: plate relation per body"; rows "on plate · kernel" (B1 has no recorded bounds, edge bands) and "cuts 4.0000 mm · recorded" | `a2-parts-badges.png` |
| 3 | `Shift+G`: 45° chamfer not tinted at α_max 45°, 50° face tinted | chamfer B1.F4 (145, 169, 147) untinted, 50° face B1.F8 (164, 105, 96) tinted; API α 45.000° (ok) and 50.000° (overhang) | `a3-chamfer-alpha45.png` |
| 3 | Legend "overhang α > 45° from vertical (slicer threshold β = 45°)"; α_max 60° reads β = 30° | both texts exact; α set to 60 in the panel input: "overhang α > 60° from vertical (slicer threshold β = 30°)", the 50° face untinted (131, 153, 133) | `a3-chamfer-alpha60-panel.png`, `a3-chamfer-alpha60.png` |
| 4 | Ø8 cross bore outlined "exempt: small bore" | kind `exempt-small-bore` (band 45°–135° not tinted), purple outline, label "exempt: small bore Ø8" | `a4-cross-bore-exempt.png` |
| 4 | cross-bore-16 (Ø16): band 45°–135° | API band [45.000001°, 134.999999°] (1e-6° slack) on the full-turn coverage; canvas samples on the bore face (picked B1.F7) at u = 55°, 90°, 125° tinted, at 20°, 35°, 145°, 160° not | `a4-cross-bore-16-band.png`, `a4-cross-bore-16-band-other-side.png` |
| 4 | Legend "bridge exemption (≤ 10 mm) not applied" | present on every overhang legend | all a3/a4 shots |
| 5 | No tint before the API answers; a live swap shows "pending" | printability request held by the QA: renderer style has no flags for the model, legend "overhang pending · r1: no tint until the printability API answers"; released: flags for B1.F7 (overhang band) and B1.F1 (bed). Live: after saving an edit, r2 shows "overhang pending · r2" and "plate relation pending · r2" until its answer, then "1 overhang · … · r2" and "on plate" | `a5-pending-no-tint.png`, `a5-answered-tint.png`, `a5-live-swap-pending.png`, `a5-live-swap-answered.png` |
| 6 | Not printed removes tint and relation | cross-bore-16 B1 not printed: no flags in the renderer style, status "B1 not printed" | `a6-not-printed.png` |
| 6 | `Shift+B` on a planar face sets up = −n | chamfer face B1.F4 selected, `Shift+B`: up = (−0.70711, 0, 0.70711) from the exact normal, status "B1 bed faces: B1.L4 · kernel", inspector "bed face (excluded, outlined)" | `a6-print-on-face.png` |
| 6 | Both survive a restart; geometry never moves | `wonky-view` stopped and started with the same reviews directory: printed false and up from B1.F4 restored, relation recomputed; display bounds identical before and after | `a6-after-restart.png` |
| 7 | VS 32/32, RV 7/7 | VS 32/32, RV 7/7; DC 5/5, DE 2/2, GS 11/11; `test/viewer-fdm.test.mjs` 17/17 | test runs |

Additional checks:

- Compare side by side: each pane has the plate and its own revision's flags
  (cross-bore exempt label left, cross-bore-16 band right)
  (`a8-compare-side-by-side.png`).
- Widths 1536, 1150, 900 and 650 px: legend clear of the view actions,
  panel on screen, text 11 px (`a7-width-*.png`).
- Frame cost (`perf.json`, r10b-retained and cross-bore-16, 5 runs of 120
  frames of `app.draw()` while orbiting): plate and overhang on vs off differ
  by less than the measurement noise (0.03 to 0.16 ms per frame, load 14 to
  23). The label anchors are cached per answer; the plate clamping works on
  scalars.
- Printability timings (in-process probe and curl): the first query of a
  server session includes the worker fork and the kernel and curve-band
  loads (1.76 s for cross-bore-16 over curl); after that 1 to 11 ms per
  model, including edge bands for bodies without recorded bounds.
- The closed-form normal equals the kernel's `surface_normal` for the QA
  cylinders and cone (`check-normals.txt`).
- `check-format` and `check-contracts` pass; `test/viewer-core.test.mjs`
  "every feature loads and no two commands bind the same key" passes.

## Gaps

- **Bridge exemption not applied** (spec D20): flat ceilings up to 10 mm are
  tinted; the legend and the API say so.
- **Curved band edges are display-accurate only.** The band is exact on the
  stored parameters; the tint follows exact per-vertex normals across
  display strips, bounded by half a strip (±4.1° on cross-bore-16). For
  cones no numeric bound is given ("curved band edges follow the display
  strips").
- **Face coverage needs circle edges.** A cylinder or cone face bounded by
  other curves keeps the band of its supporting surface (`band.scope` says
  so); such a face may be flagged although its trimmed part lies outside.
- **Cones are never small-bore exempt** (cad-khana exempts cylinders only).
- **Per logical face, no areas.** cad-khana reports overhang area; the API
  counts logical faces and gives angles and bands, not areas (no Bend area
  function).
- **Tilted up axes**: the plate relation is the body minimum along up and its
  bed faces; the drawn plate stays at Z = 0 and there is no preview of the
  body lying on its bed face. The footprint check is for up = +Z only.
- **Key `2`** is not bound in the integrated tree (camera-navigation
  integration pending); the bottom view was checked through the camera API.
- **Parts tree** is being built in parallel (wave 3). Badges and the row
  detail were verified against its current working-tree state; they rely on
  `parts.rowBadge` `render({ modelId, bodyId })`, `parts.rowDetail`
  `render`/`bind({ element, modelId, bodyId })` and `app.renderParts()`.
- The legend counts refer to the `after` model in compare mode; both panes
  are tinted.
- Labels "exempt: small bore" sit at the display centre of the face and are
  not occlusion-tested.
- `test/viewer-server.test.mjs` "the query pool runs frozen handlers …"
  still expects the `printability` stub to answer 501; see integration
  request 1. Its "frozen stubs" test and `test/viewer-core.test.mjs` camera
  and multi-selection tests fail for reasons outside this package
  (topology-classes, camera-navigation, render-look integration).

## Integration requests

1. `test/viewer-server.test.mjs`, test "the query pool runs frozen handlers
   with latest-wins, timeouts and capability errors": apply
   `out/viewer/fdm/integration-viewer-server-test.diff`:
   ```js
   // fdm implements printability: a model without bodies has nothing to check.
   assert.deepEqual((await pool.query('printability', 'known', {})).bodies, []);
   for (const kind of Object.keys(QUERY_HANDLERS).filter(kind => kind !== 'printability')) {
     await assert.rejects(pool.query(kind, 'known', {}), error => error.status === 501, kind);
   }
   ```
   (verified: the test passes with it).
2. help-a11y: render the `settings.item` entries `fdm.alpha`,
   `fdm.smallBore`, `fdm.plateWidth`, `fdm.plateDepth` (the feature reacts to
   `settings.onChange`); list `G`, `Shift+G`, `Shift+B` in the help overlay;
   describe plate, overhang shading, Print check and Print on selected face
   in the German `docs/viewer-ui.md`.
3. Optional, `viewer/core/slots.js`: add `parts.rowDetail` to `LIST_SLOTS`
   and a `slots.parts.rowDetail` helper (today fdm registers it with
   `slots.add('parts.rowDetail', …)`, which works because an item without
   `html` is only stored).
4. Optional, `viewer/render/renderer.js`: let a layer extend the pane's depth
   window (`addLayer({ bounds(pane) })`, unioned into `bounds` in
   `drawPane`). The plate layer could then drop its CPU depth clamping.
