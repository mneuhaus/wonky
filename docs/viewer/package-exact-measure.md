# Package exact-measure: delivery report

Wave 1, P0 (spec section 12). Reference for the APIs, formulas and UI:
`docs/viewer/exact-measure.md`. This file covers what the package delivers,
how to use it, the evidence for each acceptance criterion, the integration
steps it still needs, and the gaps.

## What it does

- **Exact geometry API.** `GET /api/models/:id/geometry[?aliases=…&page=N]`
  returns faces (outward normal with `sameSense` applied, plane offset and
  frame, cylinder/cone hole or boss, radius, axis direction, the axis point
  nearest the world origin, logical face and fragments), edges (line and
  circle parameters, parameter range, closed-form length, edge class) and
  vertices, in pages of 500 or by alias (`F`, `E`, `V`, logical `L`). Every
  value is a closed form over the stored analytic parameters with
  `kernel.precise` / `kernel.real`, labelled `exact-parameters` with the
  entity tolerance t. No display mesh is read.
- **Measure API.** `POST /api/models/:id/measure {entities, logical?}`
  measures 2 to 8 entities pairwise: plane/plane (angle, parallel offset,
  coplanar, normal sense), line/line (angle, distance between infinite lines,
  nearest endpoint gap), axis/axis (angle, axis distance, parallel, coaxial,
  concentric, radii; coaxial hole/boss: **radial gap** and **diametral
  clearance**; parallel non-coaxial hole/boss: **minimum radial clearance**;
  boss/boss and hole/hole: gap or wall), axis/plane, circle/plane,
  vertex/vertex (with ΔX/ΔY/ΔZ), vertex/plane (signed), vertex/axis and
  circle. Each row carries tolerance, angular tolerance, method, inputs
  (`B1.L3@<modelId>`) and a note for unbounded supports ("supporting planes",
  "supporting cylinders", "infinite lines"). A pair without a closed form gets
  `unsupported: general minimum distance between trimmed faces needs kernel
  extrema`; entities of another revision get `unsupported: entities from
  different revisions` and are never measured. A fragment alias is measured
  as its logical face unless `logical: false`.
- **Browser.** Pointer router with one 4 CSS px drag threshold for every
  press; Shift-, ⌘- or Ctrl-click adds or removes an entity from the
  multi-selection (`state.selectionSet`, primary first); the selection filter
  persists globally. Hover status line in the viewport status bar
  ("Cylinder hole Ø4.0000 mm · exact ±0.0003 · B1.F3"). Inspector sections
  **Exact geometry** (order 20) and **Measurement** (order 25, with removable
  entities, value rows, decisions, unsupported rows, methods and inputs, and
  **Copy measurement**). The primary row is drawn in the viewport as a
  dimension line with value, exactness chip and its anchor label. The model
  overview **Size** says `recorded`, `kernel` or `display ±0.02`.
- **Fixture.** `scripts/viewer/qa/fixtures/pin-in-bore.fs`: a block with a
  Ø8.4 mm bore and a separate Ø8.0 mm pin on the same axis.

## How to use it

In the viewer: hover a face, edge or point for the status line; click to
select (Exact geometry in the inspector); Shift-click or ⌘-click a second
entity to measure; Shift-click it again to remove it, or use × in the
Measurement list. Escape clears the selection. A drag of 4 px or more orbits
(pans with Shift, middle or right button) and keeps the selection. **Copy
measurement** first archives every revision involved, then copies the rows
and one `node bin/wonky-inspect.mjs "<archived path>" --revision <id>
--detail <alias>` per entity.

From a shell (any running viewer; `<id>` from `/api/workspace`):

```sh
curl -s "http://127.0.0.1:<port>/api/models/<id>/geometry?aliases=B1.F7,B2.F3"
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"entities":["B1.F7","B2.F3"]}' \
  "http://127.0.0.1:<port>/api/models/<id>/measure"
```

## Files

Server: `src/viewer/geometry.mjs`, `src/viewer/measure.mjs`,
`src/viewer/routes/geometry.mjs`, `src/viewer/routes/measure.mjs`.
Browser: `viewer/core/pointer.js`, `viewer/features/selection/selection.js`
and `.css`, `viewer/features/measure/{geometry-section,measure-section,`
`dimension-layer,hover-status}.js` and `measure.css`,
`viewer/features/inspector/overview-section.js`. Fixture:
`scripts/viewer/qa/fixtures/pin-in-bore.fs`. Tests:
`test/viewer-measure.test.mjs` (server, 17 tests),
`test/viewer-exact-measure.test.mjs` (browser logic in the fake environment,
12 tests). Docs: this file and `docs/viewer/exact-measure.md`.

## Integration steps (not owned by this package)

1. **Required, activates the feature.** `viewer/features/measure/measure.js`
   (frozen stub) must delegate to the package:

   ```js
   import { setupExactMeasure } from './measure-section.js';

   export const id = 'measure';
   export const legacy = false;

   export function setup(ctx) {
     return setupExactMeasure(ctx);
   }
   ```

   Ready-made copy:
   `tmp/viewer/exact-measure/integration/viewer/features/measure/measure.js`
   (diff: `tmp/viewer/exact-measure/integration/measure.diff`).
2. **Required for the labelled size (acceptance 7).**
   `viewer/features/inspector/inspector.js` (owner help-a11y): import
   `overviewSizeMarkup` from `./overview-section.js`, pass
   `app.modelBounds?.(scene.id)` into `overviewMarkup`, and replace the
   unlabelled `<dt>Size · mm</dt><dd>${size}</dd>` with
   `${overviewSizeMarkup(scene, bounds)}`. Copy and diff:
   `tmp/viewer/exact-measure/integration/viewer/features/inspector/inspector.js`,
   `tmp/viewer/exact-measure/integration/inspector.diff`. VS is unchanged
   with it (checked, see below).
3. **Recommended (spec section 4 order).** In the same `renderInspector`,
   render contributed sections with `order < 30` (Exact geometry,
   Measurement) directly after the selection heading instead of after Browse
   geometry. Diff on top of step 2:
   `tmp/viewer/exact-measure/integration-order/inspector-order-only.diff`;
   screenshot `out/viewer/exact-measure/14-recommended-inspector-order.png`.

Browser QA ran on an overlay of the working tree with steps 1 and 2 applied
(`tmp/viewer/exact-measure/make-overlay.mjs`, served by
`tmp/viewer/exact-measure/qa-entry.mjs`, which is `bin/wonky-view.mjs` with
the overlay viewer directory); every other file is the shared working tree.

## Evidence

Browser QA: `node tmp/viewer/exact-measure/qa.mjs --url
http://127.0.0.1:4341/viewer/` against the overlay on port 4341 (bored-spacer,
bracket, pin-in-bore, frame-with-tab, compare-before/after, conical-spacer,
arc-slot, pocket-plate), real mouse events through Playwright, 1536 × 900.
All checks passed with no console errors: `out/viewer/exact-measure/results.json`.
Screenshots are in `out/viewer/exact-measure/`.

| # | Acceptance | Result | Evidence |
|---|---|---|---|
| 1 | Hover bored-spacer bore; click shows axis and axis point | pass | status line `Cylinder hole Ø4.0000 mm · exact ±0.0003 · B1.F3`; section: Axis direction (0, 0, 1), Axis point nearest origin (0.0000, 0.0000, 0.0000). `01-hover-bore.png`, `02-bore-exact-geometry.png`, `02b-bore-exact-section.png` |
| 2 | Bracket walls: parallel offset 8 mm exact; 2 px jitter adds without pan; 4 px Shift-drag pans | pass, with a formatting note | `Parallel offset 8.00000 mm · exact ±0.00005`; camera unchanged after the jittery Shift-click, pan changed after the 4 px Shift-drag. `03-bracket-parallel-offset.png`, `03b-bracket-measurement.png`. See the first gap. |
| 3 | pin-in-bore radial gap 0.2000, clearance 0.4000, supporting cylinders | pass | `Radial gap 0.2000 mm exact ±0.0003`, `Diametral clearance 0.4000 mm exact ±0.0003`, note "supporting cylinders (trims and axial overlap are not considered)". `08-pin-in-bore-radial-gap.png`, `08b-pin-in-bore-measurement.png`, `08c-pin-in-bore-dimension.png` |
| 4 | Unsupported row; revisions row | pass | bracket top vs side wall: angle 90.000° plus `unsupported: general minimum distance between trimmed faces needs kernel extrema` (`05-unsupported-row.png`); compare-before vs compare-after side by side: `unsupported: entities from different revisions` (`09-different-revisions.png`, `09b-different-revisions-section.png`) |
| 5 | Dimension line with value, chip, "anchor: display pick" | pass | overlay markup `8.00000 mm` + `exact ±0.00005` + `anchor: display pick` (`04-dimension-line.png`, `04b-dimension-line-side.png`); pin-in-bore `0.2000 mm exact ±0.0003 anchor: display pick` at the clicked pin (`08c-pin-in-bore-dimension.png`) |
| 6 | Copied wonky-inspect command exits 0 after the server stops | pass | `copied-measurement.txt`; server on 4341 stopped, no answer on the port, both commands exit 0: `inspect-after-stop.txt` |
| 7 | Overview size labelled recorded / kernel / display ±0.02 | pass (needs integration step 2) | bracket `50 × 40 × 8 mm recorded` (`06-overview-recorded.png`); pin-in-bore has no recorded bounds: `≈ 20.00 × 20.00 × 20.00 mm display ±0.02` with the reason in the tooltip (`07-overview-display.png`) |
| 8 | Fragment alias accepted; frame-with-tab wall selects and measures the logical wall | pass for selection and measurement; the full-wall highlight belongs to render-transport | click on fragment B1.F22: section shows `Logical face B1.L9`, fragments B1.F22, B1.F34, B1.F40, B1.F56; Shift-click inner back wall: `B1.L9 ↔ B1.F36 Parallel offset 32.0000 mm`; outer back wall (Browse geometry) to inner back wall: `Parallel offset 8.0000 mm`, the wall thickness of audit task 3; the API with `['B1.F22','B1.F36']` answers entity `B1.L9`. `10-frame-with-tab-logical-wall.png`, `10b-frame-with-tab-measurement.png`, `11-frame-with-tab-wall-thickness.png` |
| 9 | VS 32/32 with no new request in the legacy seam; RV 7/7 | pass | VS 32/32 in the shared tree and with the integration copies applied; RV 7/7; see Tests |

Also checked: the hover line stays visible at 1150, 900 and 650 px
(`12-breakpoint-*.png`); the selection filter (spec section 6, scope G,
owner exact-measure) survives a reload and a server restart
(`13-selection-filter-after-restart.png`, `selection-filter-persistence.json`,
QA on port 4342).

### Tests

- `nice node --test test/viewer-measure.test.mjs`: 17/17.
- `nice node --test test/viewer-exact-measure.test.mjs`: 12/12 (threshold,
  jitter and Shift-drag through real pointer events, ⌘/Ctrl toggles, display
  anchors, measure request, Copy with archive first, hover status, dimension
  endpoints including pick over centroid, formatters, labelled size, the
  selection filter, and no request from selection in the legacy seam).
- `test/review.test.mjs` (RV): 7/7.
- `test/viewer-state.test.mjs` (VS): 32/32 in the shared tree, and 32/32
  with the integration copies of `measure.js` and `inspector.js` applied
  (`node tmp/viewer/exact-measure/make-vs-check.mjs integration`, then VS in
  `tmp/viewer/exact-measure/vs-check`). No VS test issues a geometry or
  measure request (VS dispatchers throw on unexpected requests). During the
  run VS was briefly 31/32 ("side-by-side annotations keep their pane
  projection…", camera-navigation files mid-change); it failed the same way
  with this package's `pointer.js` and `selection.js` reverted to the
  foundation versions, and passed once camera-navigation's change landed.
- `test/viewer-core.test.mjs` 7/10 and `test/viewer-server.test.mjs` 11/12
  in the shared tree: the failures are the camera tests (camera-navigation),
  the per-entity highlight buffer count (render-transport replaced the
  highlight path; the selection assertions of that test pass) and the frozen
  stub test (topology-classes and render-transport filled those stubs).
- `node scripts/viewer/check-format.mjs` and
  `node scripts/viewer/check-contracts.mjs`: ok.

## Gaps and notes

- **The bracket value prints 8.00000, not 8.0000.** The bracket records
  `validation.toleranceMm = 4.77e-5 mm` (50 mm × 2⁻²⁰, F32 planar build).
  Spec section 8 prints values to the decade of their tolerance, so the row
  reads `8.00000 mm · exact ±0.00005`. The acceptance text assumed
  t = 0.0003; models with t = 0.0003 print four decimals (frame-with-tab
  wall: `8.0000 mm exact ±0.0003`). The tolerance is not inflated to make the
  text match.
- **Logical highlight.** Picking and highlighting still address the clicked
  fragment; measurement and the exact section use the logical face. The
  whole-wall highlight comes with render-transport's shader expansion at the
  wave gate.
- **Section order.** Exact geometry and Measurement render after Browse
  geometry until integration step 3 (or help-a11y) moves them under the
  heading.
- **No kernel extrema.** Distances between trimmed faces, the axial overlap
  of cylinders and the minimum distance of non-parallel supports are
  `unsupported`, as the spec requires. A cylinder perpendicular to a plane
  gets the angle and the unsupported row.
- **Limits.** At most 8 entities are measured (a note row says so); cone
  faces take part through their axis only (no cone-specific gap); ellipse
  arc length is `unsupported`; B-spline and other surfaces answer
  `unsupported` in both APIs.
- **Kernel bounds.** The overview shows `kernel` when a package supplies
  kernel-resolved bounds through `app.modelBounds`; no package does yet, so
  models show `recorded` or the display envelope.
- **Dimension line.** Only the primary row of the first pair is drawn. Its
  position comes from the display pick, or from the centroid of an entity
  chosen without a click (labelled `anchor: display centroid`); a pair
  without a length row draws nothing.
