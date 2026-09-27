# exact-measure: exact geometry, multi-select and closed-form measurement

Package of wave 1 (spec section 12, P0). Reference for the APIs, formulas
and UI. Delivery evidence, open integration steps and gaps are in
`docs/viewer/package-exact-measure.md`.

## Principle

The server computes; the browser formats. Every value is a closed form over
the stored analytic parameters of the `.brep.json` revision (plane origin and
normal, cylinder/cone origin, axis, radius and angle, circle and line
parameters, vertex points), evaluated with `kernel.precise` and `kernel.real`
(double-F32 `Real` arithmetic in Bend). Display triangles and polylines are
never measured. Each value carries its exactness (spec section 8):

- `exact-parameters` with tolerance t: the recorded entity tolerance
  (`validation.toleranceMm`, `vertexTolerancesMm`), or the arithmetic guard
  (one unit in the last place of the stored precision times the body's
  coordinate magnitude), whichever is larger. A face takes the largest
  tolerance of its boundary vertices.
- Parallel, coaxial, coplanar and concentric decisions use the pair angular
  tolerance (below) and the larger entity tolerance t; each row echoes both.
- Relations are evaluated at points of the selected entities, never at the
  stored surface origin: a plane at the centroid of its face's boundary
  vertices (projected onto the plane), a cylinder or cone at the foot of that
  centroid on its axis, a circle at its center, a line at its start.
- `unsupported` with a reason when no closed form exists. Nothing is guessed.

Values print to the decade of their tolerance (`core/format.js`): t = 0.0003
mm gives four decimals, the planar F32 bracket (t = 4.8e-5 mm) five.

## Server

### `GET /api/models/:id/geometry[?aliases=B1.F3,B1.L2&page=N]`

`src/viewer/geometry.mjs` (`geometryEntities`), route
`src/viewer/routes/geometry.mjs`. Without `aliases`: one page of 500
entities (faces, then edges, then vertices), `page` counted from 0, `pages`
in the response. With `aliases`: exactly those entities (face `F`, edge `E`,
vertex `V`, logical face `L`). Unknown alias 404, malformed alias, body alias
or bad page 400, unknown model 404.

| Entity | Fields |
|---|---|
| face | `alias, bodyId, index, logical, fragments, surface, outwardNormal, hole, axisPointNearestOrigin, toleranceMm, exactness` |
| plane surface | `normal` (outward, `sameSense` applied), `offsetMm` (origin·normal), `frame {x, y}`, `originMm` |
| cylinder surface | `radiusMm, diameterMm, sense` (hole/boss from `sameSense`), `axis {direction, pointNearestOriginMm}`, `normalSense` |
| cone surface | `halfAngleDeg, radiusAtOriginMm, rimRadiiMm, apexMm, axis, sense` |
| edge | `curve` (line: `startMm, endMm, direction`; circle: `centerMm, normal, radiusMm, diameterMm, sweepDeg, full`), `range`, `lengthMm`, `class` (from `classifyEdges`), `start, end` |
| vertex | `point, toleranceMm` |
| `logicalFaces[]` | for `L` aliases: `fragments` and the support of the first fragment |

The response also carries `bounds` (union of the recorded body bounds, or
`minMm: null` with "not evaluated: Bn has no recorded bounds") and `bodies`
(per body tolerance and recorded bounds). The axis point nearest the world
origin is p = o − (o·a) a. Arc length of an ellipse has no closed form and
is `unsupported`. The edge `class` comes from `classifyEdges(model)`
(topology-classes, exact model only, cached per model), so the route never
prepares the display scene of a lazily loaded revision.

### `POST /api/models/:id/measure {entities, logical?}`

`src/viewer/measure.mjs` (`measureEntities`), route
`src/viewer/routes/measure.mjs`. `entities` (2 to 8 measured, in selection
order) are aliases, `{alias, modelId}` or selection references
`{modelId, bodyId, entityType, entityIndex}`. A face fragment is measured as
its logical face (`logicalFaces(model)` of topology-classes) unless
`logical: false`. Every pair gets the rows of its type pair:

| Pair | Rows |
|---|---|
| plane / plane | angle between outward normals; parallel (across both faces); parallel offset \|(o2 − c1)·n2\|, or the offset of the smaller face from the other plane when the planes are parallel across it only; coplanar; normals opposed or same |
| line / line | angle; distance between infinite lines; parallel; nearest endpoint gap |
| axis / axis (cylinder, cone, circle, line) | axis angle; axis distance; parallel; coaxial; concentric (circles); radii |
| hole / boss, boss circle inside the hole circle (d + r_boss ≤ r_hole) | coaxial: radial gap r_hole − r_boss and diametral clearance 2·(r_hole − r_boss); parallel: minimum radial clearance r_hole − r_boss − d |
| hole / boss of **one body**, hole circle inside the boss circle (d + r_hole ≤ r_boss) | wall thickness r_boss − r_hole (coaxial) or minimum wall thickness r_boss − r_hole − d (a tube wall, a screw hole in a standoff) |
| hole / boss of **two bodies**, hole circle inside the boss circle | radial gap or minimum radial clearance as above, negative, note "negative: interference of two bodies over X mm of axial overlap" |
| any parallel cylinder pair whose faces do not overlap axially (overlap ≤ t) | axial gap g; **minimum distance between the faces** `faceDistance` = √(D² + g²), D = max(\|r1 − r2\| − d, d − r1 − r2, 0), with exact witness points on the facing rims; or unsupported with the reason; no wall or interference is stated; coaxial pairs also keep the radius difference |
| wall or interference case with an unknown axial range (a boundary edge is not a rim) | coaxial: radius difference with the note; off-axis: unsupported with the reason |
| any two parallel cylinders with disjoint circles (d ≥ r1 + r2) | gap between the surfaces d − r1 − r2 ("Wall between holes", "Gap between cylinders", "Distance between cylinder surfaces") |
| coaxial hole/hole, boss/boss, circles | radius difference |
| one circle inside the other otherwise (non-coaxial) | minimum distance between cylinders r_big − r_small − d |
| crossing circles | no clearance row; the extrema row is unsupported unless the faces do not overlap axially (then `faceDistance`) |

d is the axis offset (0 for coaxial pairs); the containment tests use the
entity tolerance t. "Interference" is only claimed for two different bodies:
within one body the region between a hole and the boss around it is
material, so it is a wall. (Before the 2026-09-23 Regression review every hole/boss
pair used r_hole − r_boss − d, which read the 3 mm wall of the bored spacer
as a −3 mm interference and a separate boss 10 mm away as −16 mm.)

Trim checks (Regression review 2, 2026-09-23), both from exact edge data, never the
display mesh:

- **Axial overlap.** A wall thickness or an interference is only stated when
  the faces overlap along the axis by more than t. The axial range of a face
  is [min, max] of (v − p)·d over its vertices (p, d: the evaluated entity's
  axis), known only when every boundary edge is a line along the axis or a
  circle across it (a rim). Example: a washer resting on a plate over its Ø4
  hole (`scripts/viewer/qa/fixtures/stack-washer.fs`) was reported as a
  −4 mm "interference"; it now reads "Minimum distance between the faces
  4.0000 mm" (OCCT: 4.0000, common volume 0).
- **Faces without axial overlap** (Regression review 3). Every parallel pair whose
  faces do not overlap by more than t gets the axial gap g and the exact
  minimum distance between the trimmed faces, `faceDistance`, the first
  primary quantity. Proof: on a cylinder the height is linear in the surface
  parameters, so every face point lies within the face's vertex range, and
  |p − q|² splits into the cross-section part (≥ D², D the distance between
  the full circles) and the axial part (≥ g²): √(D² + g²) is a lower bound.
  It is stated only when it is attained: the closest points of the circles
  (along the axis offset u; for crossing circles one of the two intersection
  points; for coaxial pairs a direction both rims cover) must lie on the
  facing rim edges (the ones at the facing ends of the two ranges, chosen by
  the range midpoints, so an overlap between 0 and t still joins the near
  rims). Those points are the witness (`segment`, exact anchors, selection
  order); the witness length must equal the value within t. Otherwise the
  pair is refused with a named reason: no rim at the facing end, closest
  points not on the facing rims, axes deviating by more than t over the span
  of the faces, or a witness self-check failure. Before, the coaxial formula
  √((r1 − r2)² + g²) was applied to off-axis pairs too: a Ø4 hole under a
  Ø12 washer offset by 1 mm read 4.0000 with a witness point off the washer
  (`offset-washer.fs`; now 3.0000 between (−2, 0, 6) and (−5, 0, 6), as
  OCCT BRepExtrema). `crossing-stack.fs`: 2.0000 at (2/3, √32/3, 6) and
  (…, 8), as OCCT. `offset-half-boss.fs`: refused ("… not on the facing
  rims of B1.F7 and B2.F3"; OCCT 4.0828 at the arc ends). Corpus check
  (147 models, 24 with STEP): 771 face distances, all within 1e-9·t of
  BRepExtrema, every witness point on its face.
- **Angular coverage.** An off-axis relation (minimum radial clearance,
  minimum wall, gap between cylinders, minimum distance between cylinders)
  needs its closest points, along the axis offset, on the angular coverage
  of both faces (slack t / r); a coaxial relation (radial gap, wall,
  interference) needs a direction both faces cover. Otherwise the row is
  dropped and the extrema row says why ("… lie outside the trimmed arc of
  B1.F4"). Example: the two end caps of the arc slot face away from each
  other; the 10 mm between their supporting circles is solid material
  (OCCT: 20.0000 mm between the faces).
  *Refix 2:* where the faces overlap axially (by more than t), the coverage
  is taken **at one common height of the overlap** (`coverageAt`), not as
  the union of every circle edge of the face. Unrolled, a face bounded by
  rims and axial lines is a rectilinear region of the (angle, height)
  strip; at a height between its vertex heights its coverage is the set of
  intervals between the cut angles (axial lines spanning the height, arc
  ends) whose middle has an odd number of rims above it, at a vertex height
  the union of the bands below and above (the closure). Coverages only
  change at vertex heights, so the check runs at the vertex heights of both
  faces inside the overlap, its ends and the midpoints between them. Faces
  without overlap keep the union of their rim arcs (the rows are relations
  of the supporting cylinders there, next to `faceDistance`). An off-axis
  relation of a face with an unknown axial range (a boundary edge that is
  not a rim or an axial line) is refused with that reason (before, the
  circle edges alone were trusted). Example: `notch-base.fs` with B1.F3
  given an end notch in memory (missing for |angle| < 30° above z 6; the
  kernel cannot cut it yet): the notch-floor arc at z 6 covers the
  direction toward B2.F3, but the faces overlap only at z 7..10. Before,
  "Gap between cylinders 2.0000" exact; now unsupported ("… lie outside the
  trimmed arc of B1.F3 at every height of the axial overlap of the faces");
  OCCT BRepExtrema on the same geometry: 2.2360680 between (5, 0, 6) and
  (7, 0, 7). With the notch floor at z 7 the gap is 2.0000 again (the face
  reaches the direction where B2.F3 starts). Corpus (147 models, 3888
  parallel cylinder pair orders): no row gained or lost; 288 refusals only
  name the overlap in their reason.

Parallel and coaxial decisions use `pairAngularTolerance(bodies, t,
span)` from `geometry.mjs`: max(1e-9 rad, the stored-precision guard of
both bodies, t / max(1 mm, span)). For two planes or two axes (cylinder,
cone, circle, line) the span is the bounding-box diagonal of **both**
entities together (faces: vertices plus the exact boxes of their circle
edges; a face with another curve is padded by its body's extent); for an
axis/plane pair it is the extent of the axis entity, since that relation is
read along the axis. Values are still read at the smaller entity (the
evaluated entity: the smaller of two planes or two axes by extent, ties by
body and alias, never by selection order; the axis of an axis/plane pair),
against the other's support. The decision rows carry `toleranceMm` =
max(t, angular tolerance × span), which exceeds t only when the precision
guard dominates, and a note "decided across both entities (bounding-box
diagonal X mm): the planes deviate from parallel by at most Y mm across
them", Y = |n1 ∓ n2| × span (the chord bounds how far any reading moves over
the span). So:

- **Parallel yes** means: at every point of both faces the distance to the
  other plane lies within the decision tolerance of the stated offset. The
  parallel offset |(o2 − c1)·n2| is exact at c1, the smaller face's centroid
  on its plane (note "evaluated at the centroid of <alias>, varies by at most
  Y mm across both faces").
- **Coplanar** needs offset + Y ≤ the decision tolerance, **coaxial** axis
  distance (at the evaluated entity) + Y ≤ it, so both hold across both
  entities.
- Planes that are parallel within t across the smaller face only (a small,
  slightly tilted pad far out on a large plate) read **Parallel no** and get
  the scoped row `faceToPlaneOffset`, "Offset of <smaller> from the plane of
  <other>", exact at the centroid, with the note "the planes are not parallel
  within t across both faces; … varies by at most Z mm across it" (Z over the
  smaller face's extent, never more than t). It is a supporting-plane
  distance and primary after the parallel offset.
- Two cylinder or cone faces whose axes are parallel within t across the
  smaller face only get no parallel or coaxial relation; the unsupported row
  says so: "(the axes of B2.F3 and B1.F3 are parallel within t across B2.F3
  but deviate by up to 1.02e-2 mm across both faces)".

Each row reports the angular tolerance it used; the response's
`angularToleranceRad` is the largest of them (`angularToleranceFloorRad`
1e-9) and `angularToleranceRule` names the rule. History: before Regression review 3
the decision took t / diagonal of the smaller body but measured at the stored
origins, up to 500 mm from the faces (a pad 2e-5 rad off the plate read
5.0000500 or 5.0056500 by selection order; 32 of 346 corpus plane pairs off
by more than t between the orders). Regression review 3 read the values at the
smaller entity with t / (its extent), which made the rows order-free, but
the decision still covered only the smaller entity: a 5 × 5 pad 1000 mm
beside a plate, tilted by 2e-5 rad, read "Parallel yes · offset 7.0000"
although at the plate the pad's plane is 7.0200 away (21 t), and two
cylinders 500 mm apart read "Coaxial yes" with the axes 0.0099 mm apart at
the other face (33 t); the corpus model direct-mount had 8 of 360 parallel
pairs whose readings at the two faces differed by more than t (refix 1,
2026-09-23; `tilt-pad.fs`, `coax-far.fs`). Faces of a tilted part that are
parallel within t across both (|n1×n2| = 2.9e-8 rad on `tilted-pocket`,
15 pairs) keep their parallel offset.

A trim check that refuses a relation is always reported, also next to a
row between the supporting surfaces: a coaxial pair without axial overlap
whose face distance is refused keeps its radius difference and gets the
unsupported extrema row with the reason (`coaxial-arcs.fs`; before, the
radius difference counted as a surface distance and the reason vanished).
Next to an exact `faceDistance`, a refused relation (for example a minimum
radial clearance outside the trimmed arc) is listed as an unsupported
`relation` with its reason.
| axis / plane | angle; for a parallel axis the distance and, for a cylinder, the cylinder to plane gap |
| circle / plane | plane offset of the circle center when the circle is parallel |
| vertex / vertex | distance with ΔX, ΔY, ΔZ |
| vertex / plane | signed distance along the outward normal |
| vertex / axis, circle | distance to the axis or line; to the circle center; to the cylinder surface |

Every row: `quantity, label, value, unit, exactness, toleranceMm,
angularToleranceRad, method, inputs (B1.L3@<modelId>), note, pair` and, for
drawable lengths, a `witness` that tells the viewer where to draw the line.
Notes name unbounded supports: "supporting planes (trims not considered)",
"supporting cylinders (trims and axial overlap are not considered)" (point
to cylinder, cylinder to plane), "infinite lines". Cylinder-pair rows say what
the trims decided: "supporting cylinders over X mm of axial overlap of the
faces", "(the faces do not overlap axially)" or "(axial extent not evaluated:
a boundary edge is not a rim)", plus "; parallel axes" off the axis. A face pair without a closed-form distance gets
`unsupported: general minimum distance between trimmed faces needs kernel
extrema`; an entity of another revision gets `unsupported: entities from
different revisions` and is never measured. `primary` is the index of the
first length row of the first pair (radial gap, clearance, parallel offset,
distance, …); angles and flags are never primary.

Both routes run inline; `loadKernel()` is shared with the rest of the
server. Measured on the shared machine (`tmp/viewer/exact-measure/timing.mjs`):
r10b-retained (842 entities, 2 pages) 28.6 ms for the first, cold page and
3.5 ms for the second, 11.9 ms for the one-time edge classes and logical
faces; frame-with-tab 1.8 ms per page; a measure request well under 1 ms.

## Browser

### Pointer and selection (`viewer/core/pointer.js`, `features/selection/`)

- One drag threshold for every press: `DRAG_THRESHOLD_PX = 4` CSS px. Below
  it the press is a click, at or above it a drag (orbit, or pan with Shift,
  middle or right button). Movement below the threshold is not lost: the
  first navigation step starts at the press point.
- Shift-click, ⌘-click or Ctrl-click (below the threshold) adds the picked
  entity to `state.selectionSet` or removes it; the primary
  (`state.selection`) stays the first entry. A plain click replaces the set.
  A Shift-drag of 4 px pans and keeps the selection.
- Each click records a display anchor (the point on the display mesh, edge
  polyline or vertex under the cursor); `app.selectionAnchor(reference)`
  returns `{point, source: 'pick'}`, or the centroid of the display points
  (`source: 'centroid'`) for entities selected without a click (Browse
  geometry). Selection makes no requests (it is a legacy feature).

### Measure feature (`features/measure/`)

- `geometry-section.js`: client cache of the geometry API (displayed models
  are loaded page by page in the background, missing aliases fetched on
  demand), the formatters, and the **Exact geometry** inspector section
  (order 20): summary line, logical face with its fragments (clickable),
  rows per spec 3.2 (plane: outward normal, offset, frame; cylinder: hole or
  boss, Ø, r, axis direction, axis point nearest the origin; cone: half
  angle, rim radii, apex; line: endpoints, length, direction; circle: center,
  normal, Ø, sweep, arc length; vertex: point), with the exactness chip.
- `hover-status.js`: the hover status line in the viewport status bar, e.g.
  `Cylinder hole Ø4.0000 mm · exact ±0.0003 · B1.F3`, with the logical face
  and fragment count when a face is a fragment of a larger logical face.
- `measure-section.js`: the **Measurement** section (order 25) for two or
  more selected entities: the entity list (each removable), per pair the
  length rows with chip and note, the decisions in one line, unsupported
  reasons, methods and inputs on demand, and **Copy measurement**. Copy first
  archives every revision involved (`POST /api/models/:id/archive`) and only
  then copies the rows plus `node bin/wonky-inspect.mjs "<archived path>"
  --revision <id> --detail <alias>` for each selected fragment, so the
  commands resolve after the server stops. Requests are latest-wins.
- `dimension-layer.js`: SVG overlay layer `measure.dimension` (order 60)
  drawing the primary row as a dimension line with value, exactness chip and
  the anchor label: `anchor: display pick`, `anchor: display centroid`, or
  `anchors: exact points` (vertex to vertex, vertex to its foot). The value
  is the closed form; only the line's position comes from the display.
  Witnesses: plane offset along the exact normal from the pick; radial gap
  along the radial direction through the pick; parallel axes across both
  axes at the pick height; skew lines between their exact closest points.
  A clicked entity's pick is preferred over the centroid of an entity chosen
  without a click (Browse geometry): a plane offset then starts on the
  clicked plane and runs back to the other one.
- `features/inspector/overview-section.js`: the model overview **Size** with
  its provenance: `recorded` (union of recorded body bounds from the geometry
  API), `kernel` (when a package supplies kernel-resolved bounds), else
  `≈ … mm display ±0.02` (envelope of display edges and vertices), with the
  reason in the tooltip. A missing recorded value never reads as 0.

`ctx.app` additions: `select`, `toggleSelection`, `selectionAnchor`
(selection); `exactGeometry(modelId, alias)`, `modelBounds(modelId)`,
`measureSelection()`, `copyMeasurement()` (measure).

## Fixture

`scripts/viewer/qa/fixtures/pin-in-bore.fs`: a 20 × 20 × 12 mm block with a
Ø8.4 mm through bore (B1.F7) and a separate Ø8.0 mm pin (B2.F3) on the same
axis. Expected: radial gap 0.2000 mm, diametral clearance 0.4000 mm,
"supporting cylinders". Build with `node scripts/viewer/qa/fixtures.mjs
--only pin-in-bore`.

## Tests

- `test/viewer-measure.test.mjs`: geometry and measure functions on built
  models (bored spacer, bracket, pin-in-bore, hole-boss, stack-washer, arc
  slot, offset-washer, crossing-stack, offset-half-boss, tilt-pad, axis-far,
  coax-far, coaxial-arcs, notch-base with trims set in memory: an end-notched
  boss and a windowed pin in a windowed bore), both HTTP routes, every face pair of six fixtures
  in both orders, and, for every plane and cylinder pair of nine models, the
  parallel, coaxial and scoped claims checked at every vertex of both faces.
- Independent checks: `scripts/viewer/qa/occt-face-distance.py` (OCCT
  BRepExtrema on the exported STEP, by alias; run with `uv run --no-project
  --python ~/Workspace/cad/cad-khana/.venv/bin/python python …`).
- `test/viewer-exact-measure.test.mjs`: the 4 px threshold, Shift/⌘-click,
  anchors, the measure feature in the fake browser (measure request, Copy
  with archive first, hover status, dimension line), formatters, the
  labelled size, and no requests in the legacy seam.
