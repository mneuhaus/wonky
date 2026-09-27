# Viewer data audit: what the model data offers

Stage: viewer rework, data audit (2026-09-22). Question: which data in a
`wonky-brep/1` model and which existing kernel functions can the new viewer use
for exact measurement, geometric diff, overhang analysis, sections and a
source-linked feature tree, and what is honest to show where they stop.

Everything below was read from real build output or measured with
`scripts/viewer/audit-data-probes.mjs` (report:
`out/viewer/audit-data/probes.json`). The probe builds the examples plus three
audit samples in `scripts/viewer/audit-data/*.fs` (pocket plate = planar
Boolean, arc slot = line/arc sketch extrusion, cross bore = through-hole
pierce) and calls only existing Bend functions. Other sources:
`out/r10b-retained.brep.json` (frozen Onshape imports),
`src/{geometry-summary,identity,construction-history,source-map,ray,section,review-scene,display-*}.mjs`,
`src/review-server.mjs`, `viewer/app.js`.

Exactness labels used in this document and proposed for the API:

| Label | Meaning |
| --- | --- |
| `exact-parameters` | Read from, or derived in closed form from, stored analytic parameters (F32 or F32x2 words). Uncertainty is the stored model tolerance, stated with the value. |
| `kernel-resolved` | Decided by an existing Bend function with its documented operational guards (ray roots, trim membership, section, edge bands). Can return an explicit unresolved result. |
| `recorded` | Copied from build-time metadata (volume, bounds, validation) together with its `scope` string. `null` stays unknown. |
| `design-parameter` | A value from the source call (`sourceMap` parameters). Intent, not measured geometry. |
| `source-reference` | Frozen external oracle values (Onshape `referenceMeasurements`). Not computed by wonky. |
| `display-approximation(±t)` | Derived from display triangles or polylines; `t` is the stated tessellation tolerance. |
| `identity` / `ancestry` | Matching labels for diff, see section 4. |
| `unsupported` | Explicit capability error, never a guessed value. |

## 1. What a model contains

Top level: `schema`, `units` (millimeter), `backend.precision`, `source`
(language, feature, imports), `modelingPolicy`, `operationEvidence`,
`sourceMap` (`wonky-source-map/1`) and `bodies[]`. Failed or diagnostic models
may carry `diagnostic.purpose` (for example the r10b first-failure operands).

There are **two body representations**. The viewer must handle both:

| | Legacy planar (`geometry` absent) | Analytic (`geometry: 'analytic'`) |
| --- | --- | --- |
| Produced by | polyline extrusion, box, transforms of these (bracket, tilted plate) | frustum/cylinder, line/arc sketch extrusion, all Booleans, frozen imports |
| Precision | F32 words | F32x2 (`precision: 'F32x2'`) |
| Edge curve | the string `"line"`; geometry = its two vertices | object: `line {origin, direction}`, `circle {origin, normal, x, radius}` (ellipse supported by the display code) |
| Edge range | none | `curveRange [t0, t1]` on sketch/Boolean edges; closed circles have `start === end` and no range |
| Face orientation | `surface.normal` **is** the outward normal | outward normal = `surface.normal * (sameSense === false ? -1 : 1)`; cylinders the same with the radial direction |
| Loops | one loop per face | several loops, `outer: [true, false, ...]` |
| Validation | computed in `src/brep.mjs` (volume, area, bounds, tolerance) | from Bend; `volumeMm3` / `boundsMm` may be `null` with a `scope` string |

### 1.1 Exact parameters per entity

| Entity | Stored parameters | Derived exactly (closed form) |
| --- | --- | --- |
| Plane face | `origin`, `normal`, `x` (+`sameSense`) | outward normal, plane offset `normal·origin`, in-plane frame `y = normal × x` |
| Cylinder face | `origin`, `axis`, `x`, `radius` (+`sameSense`) | diameter; `sameSense: false` = material outside = **hole**, `true` = boss/shaft; normal at angle `u` |
| Cone face | `origin`, `axis`, `x`, `radius`, `angle` (rad) | radius at axial height `z`: `radius + tan(angle)·z`; half angle |
| Line edge | legacy: vertex pair; analytic: `origin`, unit `direction`, `curveRange` | length = `t1 − t0` or `|end − start|`; midpoint; direction |
| Circle edge | `origin` (center), `normal`, `x`, `radius`, optional `curveRange` | center, diameter, arc sweep, arc length `radius·|t1 − t0|` (full circle `2πr`) |
| Vertex | `vertices[i]` `[x, y, z]` | – |
| Tolerances | `validation.toleranceMm` (legacy ≈ 2e-5 to 5e-5 mm; analytic 3e-4 mm), `vertexTolerancesMm[i]` (imports), `construction.allowanceMm` / `requiredIncidenceMm`, `constructionBudget.ceilingMm` | the uncertainty to print next to any exact value |

Example, arc slot face `B1.F4` (created from `skArc(s, "right", ...)`, line 10)
and its start rim `B1.E2`:

```json
{ "surface": { "type": "cylinder", "origin": [10, 0, 0], "axis": [0, 0, 1], "x": [0, -1, 0], "radius": 5 },
  "sameSense": true,
  "loops": [[{ "edge": 1, "forward": true }, { "edge": 10, "forward": true },
             { "edge": 5, "forward": false }, { "edge": 9, "forward": false }]], "outer": [true] }

{ "start": 1, "end": 2,
  "curve": { "type": "circle", "origin": [10, 0, 0], "normal": [0, 0, 1], "x": [0, -1, 0], "radius": 5 },
  "curveRange": [0, 3.1415926535897967], "sameSense": true }
```

Example, bored spacer bore (a hole, therefore `sameSense: false`) and its
periodic seam `edge 4`, used twice by the same face:

```json
{ "surface": { "type": "cylinder", "origin": [0, 0, 0], "axis": [0, 0, 1], "x": [1, 0, 0], "radius": 2 },
  "sameSense": false,
  "loops": [[{ "edge": 0, "forward": false }, { "edge": 4, "forward": true },
             { "edge": 1, "forward": true }, { "edge": 4, "forward": false }]], "outer": [true] }
```

Values are stored as they came out of F32x2 arithmetic, so they carry visible
noise (`10.000000000000018`, direction `[-3.29e-15, 1, 0]`, bounds
`-5.68e-14`). A viewer must format to the tolerance decade, not print raw
doubles.

### 1.2 Body metadata

| Field | Content | Present on |
| --- | --- | --- |
| `id` | frontend body ID, deterministic from operation IDs (`model/pocket/0`) | all |
| `name`, `appearance` `{red, green, blue, alpha}` | from `setProperty` or a frozen import | r10b (all 5 bodies) and any FS model using `setProperty`; Python models never |
| `validation` | closed, counts, `toleranceMm`, `volumeMm3`, `boundsMm`, `scope` | all; volume and bounds `null` for frozen imports, bounds `null` for pierce results |
| `construction` | method, allowances, stats; Booleans: `faceOrigins`, `edgeOrigins` | analytic operations |
| `primitive` | `{type: 'frustum', bottom, top, r0, r1}` | cylinders/cones |
| `sketchProfile` | named 2D sketch entities with source lines | line/arc sketch extrusions |
| `operationHistory[].evidence` | inputs (full input identity + topology counts), method, status, stats, audits; `transformChain` | Booleans |
| `provenance`, `referenceMeasurements` | Onshape document/part IDs, face areas/perimeters (`source-reference`) | frozen imports |
| `identity` | section 4 | all built bodies |
| `debug` | `sourceOperation` (index into `sourceMap.operations`), source span, call stack | all built bodies |

r10b retained, body 3: `name: "R10 P01 pickup plate (retained, reuse print)"`,
`appearance: {red: 0.85, green: 0.43, blue: 0.13, alpha: 1}`, 66 faces,
`volumeMm3: null`, `boundsMm: null`. That is what a parts tree with colors
needs, and the current scene drops `appearance`.

## 2. Exact measurement

### 2.1 What can be computed from the data

All rows are closed forms over the section 1.1 parameters, so they are
`exact-parameters` with the entity tolerance attached. None is implemented yet:
today the inspector shows only `surfaceType`/`curveType` and vertex
coordinates, and the exact parameters reach the user only through "Copy
selected geometry" (`/entities/:alias`).

| Selection | Result | Formula / basis |
| --- | --- | --- |
| vertex | position | stored point |
| vertex–vertex | distance, Δx/Δy/Δz | `|p − q|` |
| vertex–plane face | signed distance to the supporting plane | `(p − o)·n_out`; whether the foot point lies on the trimmed face is a separate `kernel-resolved` membership query |
| plane–plane | angle; if parallel: distance | dihedral `acos(n1·n2)` with outward normals or plane angle `acos(|n1·n2|)`; parallel within angular tolerance → `|(o2 − o1)·n1|`; otherwise no distance, only the angle |
| line edge | length, direction | section 1.1 |
| line–line | angle; parallel: line distance; otherwise closest distance of the supporting lines and of the two segments (clamped closed form) | segment result is exact for straight edges |
| circle edge | center, radius, Ø, arc sweep and length, plane normal | section 1.1 |
| circle–circle / hole–hole | center distance, coaxiality (axis angle + offset), radius difference | circle centers and normals |
| cylinder face | radius, Ø, axis, hole vs boss | `sameSense` |
| cylinder–cylinder | axis angle; parallel: axis distance; coaxial check | axis lines |
| cylinder–plane | axis/plane angle; axis ∥ plane: axis-to-plane distance and support clearance `d − r` | labelled support clearance, not trimmed-face clearance |
| circle–plane | center-to-plane distance, normal angle | – |
| cone face | half angle, radius at a height, axis | – |
| body | volume, bounds | `recorded`; where `boundsMm` is `null`: exact bounds from Bend edge bands (section 2.2) |
| face area | planar faces bounded by lines and circular arcs: polygon plus circular segments; cylinder faces trimmed by rims and generators: `r·Δu·h` | not implemented anywhere yet; general trims `unsupported`; imports carry `source-reference` areas |

**Not available anywhere** (must be `unsupported`, not silently approximated):
minimum distance between two arbitrary trimmed faces, edges or bodies;
clearance/interference between bodies (only `comparison.coaxial` for two
coaxial cylinder primitives); centroid and mass properties beyond the recorded
volume; volume of frozen imports (`evVolume` itself raises for them).

Numerics: `review-scene.mjs` already evaluates frames with `kernel.precise`
(`G.sub`, `G.dot`, `G.cross`, `normalize`, F32x2). A measurement module
(`src/viewer/measure.mjs`) should do the same so the arithmetic stays in Bend
and the host only formats (`Math.acos` of a Bend-computed cosine is
formatting). The printed uncertainty is `max(entity tolerance, arithmetic
guard)`, for example `20.0000 mm ±0.0003 mm (model tolerance)`.

### 2.2 Existing kernel and host functions

| Function | Module | Viewer use | Measured (warm) | Limits |
| --- | --- | --- | --- | --- |
| `line_surface(origin, dir, surface)` | `src/ray.mjs` → `kernel/ray.bend` | exact pick point on the supporting surface under the cursor; ray casts for wall thickness | < 1 ms per face | supporting surface only; kinds 2–6 (tangent, coincident, unresolved, invalid, range) must be surfaced |
| `membership(solid, face, domains, point, …)` | `kernel/solid-classification.bend` (via `loadSolidClassifier`) | is a ray hit or a foot point on the **trimmed** face | ms | `FaceBoundary` / `FaceUnknown` must block, never count |
| `classifyPlanarFace`, `classifyCylinderFace` | `src/face-classification.mjs`, `src/cylinder-classification.mjs` | same for one face, with reasons | ms | planes and cylinders |
| `classifySolid(body, point)` | `src/solid-classification.mjs` | point inside/outside, section-cap sanity | 2.2 s on the 66-face r10b plate | 5-line parity vote; `Unresolved` possible |
| `sectionSolid(body, plane)` | `src/section.mjs` | exact clipping outline | 5–72 ms on samples, 32–53 ms on the r10b plate (first call ≈ 0.8 s load) | planes and cylinders only (cone → `FaceRejected`); plane touching a face or vertex → `FaceContact`; contours only, no cap fill, no outer/hole nesting |
| `intersectFacePlane`, `intersectEdgePlane`, `intersectCurvePlane` | `src/face-plane.mjs`, `src/edge-plane.mjs`, `src/curve-plane.mjs` | where an edge crosses a clipping plane; per-face section pieces | ms | building blocks of `sectionSolid` |
| `boundEdgePlaneBand(body, edge, plane)` | `src/curve-band.mjs` | exact min/max signed distance of an edge to a plane: exact body bounds, edge-to-bed distance | cross bore 15 edges × 3 axes: 689 ms incl. load; r10b plate 144 edges × 3 axes: 144 ms | resolved/unresolved per edge |
| `intersectSurfaces` | `src/intersections.mjs` | plane/plane and plane/cylinder support intersections | ms | unbounded supports |
| `A.curve_point`, `A.curve_parameter`, `A.curve_tangent`, `D.surface_point`, `D.surface_normal` | `kernel/analytic.bend`, `kernel/display.bend` | measurement points, normals on curved faces | – | – |
| `compareBodiesInBend` | `src/comparison.mjs` | added/removed/common volumes, clearance | – | two coaxial cylinder primitives only |
| `booleanInBend` | `src/boolean.mjs` | material diff (after − before, before − after) | pocket plate rebuild 2.8–4 s | planar union/subtraction, coaxial cylinders, admitted pierce; everything else raises |

Probe results (`probes.json`):

**Wall thickness** = nearest positive `line_surface` root whose point is
`FaceInside` by `membership`; any `FaceBoundary`, `FaceUnknown`, tangent or
coincident root at or before it refuses the measurement.

| Model | Ray origin → direction | Result |
| --- | --- | --- |
| bored spacer | (2, 0, 5) → +X | 3 mm (bore wall to Ø10 skin), 7 ms |
| bracket | (30, 6, 0) → +Z | 8 mm |
| bracket | (30, 0, 4) → +Y | 12 mm (foot height) |
| bracket | (18, 0, 4) → +Y, inside a face plane | **unresolved**: two `FaceBoundary` hits and one coincident face (root kind 3) |
| arc slot | (0, −5, 2) → +Y | 10 mm |
| pocket plate | (20, 15, 3) → −Z | 3 mm pocket floor |
| cross bore | (15, 0, 14) → +Z | 6 mm above the bore |

**Section** (`sectionSolid`): bracket z = 4 → 1 contour of 6 lines; bracket
x = 18 (coplanar with a side face) → `Failed FaceContact face 0`; bored spacer
z = 5 → 2 circles; arc slot z = 2 → lines and circles; pocket plate z = 4.5 →
2 contours, 16 edges (the outer ring still contains the Boolean face
fragments); cross bore x = 15 → rectangle plus circle; conical spacer →
`FaceRejected` (cones unsupported).

Consequence for clipping: GPU clip planes plus stencil caps on the display mesh
are the always-available mode (`display-approximation`). The exact contour from
`sectionSolid` is an optional overlay that can be measured; its failures
(`FaceContact` when the plane lies on a face, cones) must be shown, and the
viewer must not silently nudge the plane to avoid them.

**Exact bounds**: on solids bounded by planes, cylinders and cones every
directional extreme lies on an edge (an interior extreme needs a generator
along which the height is constant, and that generator reaches the boundary).
The union of `boundEdgePlaneBand` extremes along X, Y, Z is therefore the exact
box. Cross bore (recorded `boundsMm: null`) → `[0, −10, 0]..[30, 10, 20]`;
bored spacer reproduces its recorded bounds exactly. Today the viewer computes
"Size" from display points (chord polylines), which is a
`display-approximation`.

## 3. Overhang and build plate

Data available:

* Planar faces: exact outward normal (section 1). Overhang when
  `n_out·up < −sin θ` (θ = overhang angle from vertical, default 45°, printed
  with the result).
* Cylinders: the outward normal at angle `u` is `s·(cos u·x + sin u·y)` with
  `y = axis × x` and `s = ±1` from `sameSense`. With `R = hypot(x·up, y·up)`
  and `φ = atan2(y·up, x·up)` the overhang set is an exact angular band of
  half width `acos(sin θ / R)` centered at `φ` (hole, `s = −1`) or `φ + π`
  (boss). No band when `R ≤ sin θ` (axis within θ of vertical). The band edges
  are generator lines, exact.
* Cones: same construction with the constant normal tilt; not probed.
* Bed contact: a planar face with `n_out = −up` whose plane offset equals the
  body minimum along `up`. Needs `validation.boundsMm` or the edge-band bounds;
  if neither resolves, bed contact is reported as unknown.

Probe (`up = +Z`, θ = 45°): cross bore → bottom face is the bed candidate, the
bore ceiling band is `u ∈ [45°, 135°]` (z > 12.83 mm); bracket and arc slot →
only the bed face; pocket plate → **9 bed-candidate faces**, all fragments of
one bottom face (section 4.3).

Shading honesty: planar display triangles carry the exact plane normal, so a
per-face color is exact. Cylinder display strips carry the Bend-evaluated
normal at the strip mid-angle; `displayTessellation.maxAngularSpanRad` (0.1745
rad = 10° on the arc slot) bounds the normal error of a strip to half that
span. Either add the band angles as tessellation events so strips never
straddle the threshold, or state "band boundary ±5° (display)". Legacy F32
normals (tilted plate: `0.7071067690849304`) are exact stored words.

## 4. Identity, lineage and geometric diff

### 4.1 Identity data

Every body and every face/edge/vertex carries `originId`, `instanceId`,
`revision` (sha256 of the geometry), `kind`, `role`, `stability`
(`semantic` | `source` | `revision-local`), `operationId`, and
`lineage {relation, matching, parents[]}`. Boolean bodies add
`lineage.ambiguity` and `lineage.history`. `matchTopologyReference(bodies,
reference)` returns `matched`, `missing`, `ambiguous` or `unsupported`; it never
falls back to proximity or array index.

Measured coverage when re-matching every entity of revision A in revision B
(`identity-matching` probe):

| Model, edit | Faces | Edges | Vertices |
| --- | --- | --- | --- |
| arc slot (named line/arc sketch), depth 4 → 6 | 6/6 matched | 12/12 | 8/8 |
| arc slot, arc bulge 15 → 17 | 6/6 | 12/12 | 8/8 |
| bracket (polyline extrusion), thickness 8 → 12 | 2/8 (caps); 6 `unsupported` | 0/18 | 0/12 |
| pocket plate (planar Boolean), pocket 20 → 22 wide | 0/46 | 0/92 | 0/48 |
| bored spacer (coaxial Boolean), bore r 2 → 2.5 | 0/4 | 0/6 | 0/4 |
| r10b imports | `source` stability: matched while the frozen input is unchanged | | |

Boolean result **bodies** are `revision-local` too (`boolean-result/0`), so
even body-level matching needs a labelled fallback: the same `body.id` string
(`matched by body id`, not identity).

### 4.2 Construction ancestry (recorded, unused by the viewer)

Planar arrangement Booleans (and the curved/solid intersection paths) record
per output face a `FaceOrigin {owner, contributors[]}` pointing at input faces
(`operand`, `index`), and per output edge one of `OriginalEdge`,
`FaceIntersection {first, second}`, `SurfaceSeam`, `FaceSubdivision`.
`geometry-summary` `detail()` already resolves these to the input face
identity through `operationHistory[].evidence.inputs` (pocket plate `B1.F3`):

```json
"constructionOrigin": {
  "method": "native Bend planar arrangement subtraction",
  "origin": { "$": "FaceOrigin", "owner": { "operand": 1, "index": 5 }, "contributors": "[{operand: 1, index: 5}]" },
  "references": [ { "operand": 1, "kind": "face", "index": 5, "reversed": true,
    "status": "recorded-input-reference", "bodyId": "model/pocketTool",
    "identity": { "role": "side/x-min", "stability": "semantic", "operationId": "model/pocketTool" } } ]
}
```

Grouping output faces by the semantic identities of their contributors gives
**ancestry groups**. Pocket plate: 46 faces fold into **11 groups**, exactly
the 11 faces of a plate with a pocket, and **11/11 groups match** between the
two revisions although 0/46 faces match by identity.

Gaps: the through-hole `pierce` path and the coaxial-cylinder Boolean record no
`faceOrigins`, so their outputs have no ancestry (cross bore, bored spacer).
Adding it belongs to the kernel/Boolean owners, not the viewer.

### 4.3 Boolean face fragmentation and edge classes

The planar arrangement leaves coplanar fragments: pocket plate has 46 faces
and 92 edges for an 11-face part; **48 edges are `FaceSubdivision`** edges
between coplanar same-orientation fragments. They are artefacts, not feature
edges. The viewer should:

* draw only `sharp` edges as crisp black edges, hide `FaceSubdivision` and
  seam edges, and draw tangent edges lighter or not at all;
* pick, measure and diff **logical faces** (ancestry groups with identical
  oriented support) instead of fragments, while keeping fragment aliases
  addressable for exact references;
* report face counts both raw and logical, otherwise a face-count delta is
  meaningless.

Edge classes from exact data (`edge-classes` probe):

| Model | Edges | Classes |
| --- | --- | --- |
| bracket | 18 | 18 sharp |
| bored spacer | 6 | 2 seam, 4 circle rims (normals need Bend evaluation) |
| arc slot | 12 | 4 sharp, 4 **tangent** (line/arc transitions), 4 circle rims |
| pocket plate | 92 | 44 sharp, **48 subdivision** |
| cross bore | 15 | 12 sharp, 1 seam, 2 circle rims |

Seam = both coedge uses on one face. Tangent/sharp compares outward normals at
the edge midpoint; for circle rims `D.surface_normal` gives the cylinder
normal in Bend.

### 4.4 What is honest to show in a diff

Per entity of the earlier revision, exactly one status, in this order:

1. **identity match** (`semantic`/`source`): same entity. Show exact parameter
   deltas (plane offset +2.000 mm, radius 2.000 → 2.500 mm, arc sweep).
2. **ancestry group match**: same contributing input faces. Compare the group
   as a whole (support parameters, logical face); label "matched by
   construction ancestry, may be split or merged".
3. **support coincident**: an unmatched face whose supporting surface equals,
   within tolerance, an unmatched face of the other revision. Label "same
   supporting surface (geometry), identity unknown". Trims can differ.
4. **unmatched, revision-local**: neutral hatch, no added/removed/changed
   color. Tooltip: "Revision-local identity; correspondence is not supported
   for this operation (`<operation type>`)".
5. **ambiguous** (patterned copies with `byOrigin`): list the candidates.

Body-level numeric deltas are always honest when labelled: raw and logical
face/edge/vertex counts, `volumeMm3` delta (`recorded`; `null` → "not
evaluated" with the validation scope), bounds delta (recorded or edge-band
exact). A material diff (added/removed solids and volumes via `booleanInBend`
in both directions) is `kernel-resolved`, on demand, takes seconds on planar
arrangements, and raises for unsupported pairs; show that capability error.

Auto-compare against the previous live revision is cheap: identity matching
and parameter deltas take milliseconds; ancestry grouping is one pass over
`construction`.

## 5. Construction history and source links

Available today:

* `sourceMap.operations[]` (one per observed modeling call, in execution
  order): `sequence`, `operationId` (null for `sk*` calls, which reference
  their sketch through `parameters[0].id`), `name`, `status`
  (`completed`/`failed`), `source {file, sha256, url, span {line, column},
  excerpt}`, `callStack [{name, calledAt, declaration}]`, `parameters`
  (bounded snapshot, quantities in SI base units: `endDepth 0.008` = 8 mm),
  `outputs [{bodyId, identity}]`, `removedBodies [bodyId]`.
* `body.debug.sourceOperation` links a body to its operation record.
* `identity.operationId` on every entity links faces/edges/vertices to the
  operation that created them; Boolean outputs link to the Boolean and,
  through `constructionOrigin`, to the input faces and their operations.
* Face-level source for line/arc sketch extrusions:
  `identity.topology.faces[i].source = {kind: 'sketch-entity', sketchId,
  entityId: 'right', span: {line: 10}, curveType: 'arc'}`; edges carry the same
  for their cap roles.
* `identity.lineage.history` (earlier body operations) and
  `operationHistory[].evidence` (`method`, `status`, `stats`, `audits`,
  input identities and topology counts).
* `sketchProfile` with named 2D entities for line/arc sketches; other sketches
  can be drawn only from `design-parameter` values (`skPolyline` points,
  `newSketchOnPlane` plane).

Example operation record (bracket, abbreviated):

```json
{ "sequence": 3, "operationId": "model/extrusion", "name": "opExtrude", "status": "completed",
  "source": { "file": ".../examples/bracket.fs", "sha256": "ff0e0e91…", "url": "/api/source/ff0e0e91…",
              "span": { "line": 31, "column": 9 }, "excerpt": { "firstLine": 29, "text": "…" } },
  "callStack": [ { "name": "bracket", "calledAt": null, "declaration": { "line": 7, "column": 38 } },
                 { "name": "bracket", "calledAt": null, "declaration": { "line": 7, "column": 38 } } ],
  "parameters": [ { "type": "Id", "value": "model/extrusion" },
                  { "endDepth": { "type": "Quantity", "value": 0.008, "lengthPower": 1 } } ],
  "outputs": [ { "bodyId": "model/extrusion", "identity": { "originId": "wk1/6:…", "revision": "sha256:8d87…" } } ],
  "removedBodies": [] }
```

A feature tree can be built as: operations grouped by call stack (collapse
consecutive duplicate frames; `defineFeature` wrappers appear twice), sketch
calls grouped under their sketch ID, each node linked to its produced and
consumed bodies, and each face linked back by `identity.operationId` (plus
sketch-entity sources and Boolean ancestry). Clicking a face can then jump to
the `skArc` line instead of the extrude line.

**Current bug:** `viewer/app.js` `sourceFor()` prefers `entity.source`, and
`review-scene.mjs` sets every face and edge `source` to the body operation
source. The sketch-entity span in `entity.identity.source` is therefore never
shown: selecting the arc face shows line 14 (`opExtrude`), not line 10
(`skArc`). `identity.source` also means an *external* entity record on imports
(Onshape IDs, no span); the new API needs distinct fields for the two meanings.

Not available: intermediate geometry per operation (rollback). Only final
bodies are returned. A viewer build runner could snapshot `engine.bodies` in
the interpreter call observer after each operation (the way
`scripts/check-acceptance.mjs` captures failing Boolean operands), but
`build()` exposes no observer hook; either re-compose `build()` in
`src/viewer/` from the public modules or ask the kernel owner for a hook.

### 5.1 Failures (live loop error panel)

`build()` throws with `line`/`column`, `name`, `modelTrace` (the source map up
to and including the failed call) and `completedOperationEvidence`
(`failure` probe, bored spacer variants):

| Case | `error.name` | Location | Trace |
| --- | --- | --- | --- |
| unsupported Boolean | `UnsupportedFeatureError` (= capability error) | 21:5 | 9 ops, op 8 `opBoolean model/bore` failed |
| syntax error | `FeatureScriptError` | 11:5 | none (parse stage) |
| negative radius | `FeatureScriptError` | 17:5 | 6 ops, op 5 `skCircle` failed |

No partial bodies are returned, so the viewer cannot accidentally present an
incomplete model; it keeps the last good revision and shows the error with its
source line. Operands of a failing Boolean are only reachable through an
interpreter hook (see above) and must then be shown as a `diagnostic` model
("inputs to the failed operation, not a model"), the convention already used
by `out/r10b-first-failure-inputs.brep.json`.

### 5.2 Live loop facts from the data side

* Build cost (in-process, warm): bracket 3 ms, arc slot 10 ms, bored spacer
  4 ms, **pocket plate 2.8–4 s** (planar arrangement). Cold kernel load
  ≈ 0.8 s. Bend runs synchronously on the JS thread, so builds must run in a
  worker thread or child process or the review server stalls. Cancelling a
  superseded build means terminating that worker (and re-warming it), since the
  interpreter has a step budget but no cancellation.
* Watch set, FeatureScript: the source file, a sibling `modules.json` and the
  module files it lists (sha-verified; the manifest is bound to the source
  sha256). `onshape/std/*` imports are built in; there are no local `.fs`
  imports to follow.
* Watch set, Python: the single file. `python/runner.py` runs with `-I -S` and
  receives the source over a pipe, so local Python imports are not part of the
  model. The Python executable must be a `uv run` based wrapper (project
  rule); `buildPython` defaults to `python3`.
* The review server loads and scene-prepares every archived revision in
  `reviews/models/` at startup (18 files, 11 MB today, for one review). Live
  revisions must stay in memory and be archived only when a review references
  them, otherwise startup time grows with every save.

## 6. What the viewer receives today versus what it could use

`GET /api/models/:id` returns the review scene. Measured JSON sizes: arc slot
118,954 bytes, of which 29,610 are needed to draw; **pocket plate 1,479,149
bytes, of which 20,247 are needed to draw (98.6 % are repeated identity,
source and debug copies)**. Identity is copied into the scene body and again
into every face, edge and vertex.

| Available in the model | Used by the viewer today |
| --- | --- |
| exact surface/curve parameters, `sameSense`, `curveRange` | no (type names only; exact data only via "Copy selected geometry") |
| `appearance` | no (not in the scene) |
| `validation.boundsMm`, `toleranceMm`, `scope`, `vertexTolerancesMm` | no ("Size" uses display bounds) |
| `construction.faceOrigins` / `edgeOrigins` | only inside the copied detail packet |
| face-level sketch sources | no (shadowed, see section 5) |
| `operationHistory` evidence, `referenceMeasurements`, `provenance` | no |
| `displayTessellation` error bounds | no |
| `sourceMap` | yes, for the selected body's operation and parameters |
| `displayWarning`, `diagnostic.purpose` | yes |

## 7. Proposed API for the new viewer

Existing routes stay (backward compatible): `GET /api/workspace`,
`GET /api/models/:id` (scene), `GET /api/models/:id/summary`,
`GET /api/models/:id/entities/:alias`, `GET /api/source/:sha256`,
`GET /api/reports/…`, `GET|POST /api/feedback…`. The static route currently
serves only `index.html`, `app.js` and `style.css`; native ES modules need
`/viewer/**/*.js` with path validation. New POST routes keep the existing
same-origin check.

| Method | Path | Response | Exactness |
| --- | --- | --- | --- |
| GET | `/api/live` (SSE) | events `build-queued`, `build-started {sources [{path, sha256}]}`, `build-succeeded {modelId, previousModelId, durationMs}`, `build-failed {error {kind: capability / syntax / runtime / internal, name, message, file, line, column}, failedOperation {sequence, name, operationId, span}, trace [statuses], lastGoodModelId}`, `build-cancelled {supersededBy}` | status only |
| GET | `/api/live/state` | the same state as a snapshot for reconnects: building flag, last attempt, last good model, watched files | status only |
| GET | `/api/models/:id/draw` | compact render payload: per body `{alias, id, name, color, faces [{alias, surfaceType, triangle range, planar outward normal}], edges [{alias, class: sharp / tangent / seam / subdivision, polyline}], vertices}`, typed-array buffers, `display {toleranceMm, per-face displayTessellation bounds, warnings}`; no identity copies | `display-approximation(±toleranceMm; per face maxChordalErrorBoundMm)` |
| GET | `/api/models/:id/geometry` | exact tables: faces `{alias, surface, outwardSign, loops, logicalFace}`, edges `{alias, curve, range, lengthMm, uses, class}`, vertices `{alias, point, toleranceMm}`, body tolerances | `exact-parameters` |
| GET | `/api/models/:id/parts` | bodies `{alias, id, name, appearance, representation, precision, counts {raw, logicalFaces}, volumeMm3, boundsMm, operation {id, type, source}, provenance}` | `recorded` (bounds may be edge-band `kernel-resolved`) |
| POST | `/api/models/:id/measure` `{entities: [alias, …]}` | `{measurements [{quantity, value, unit, exactness, toleranceMm, method, basis}], unsupported [{quantity, reason}]}` | `exact-parameters`, `kernel-resolved` or `unsupported` per row |
| POST | `/api/models/:id/pick` `{face: alias, ray {origin, direction}}` | exact point on the supporting surface plus membership (`inside` / `boundary` / `outside` / `unresolved`) | `kernel-resolved` (the point depends on the cursor ray) |
| POST | `/api/models/:id/thickness` `{origin, direction}` or `{face, point}` | `{status: measured / unresolved / no-hit, mm, hit {alias, point}, blocking [...]}` | `kernel-resolved` |
| POST | `/api/models/:id/section` `{origin, normal}` | `{status, reason?, face?, contours [{edges [{curve params, displayPoints}]}]}` | contours `kernel-resolved`; polylines `display-approximation`; no cap nesting claimed |
| GET | `/api/models/:id/printability?up=0,0,1&angleDeg=45` | per logical face: planar `{nz, kind: ok / overhang / bed / bed-unknown}`; cylinder `{bandDeg [u0, u1], generators}`; cone likewise; others `unsupported`; echoes `up` and `angleDeg` | `exact-parameters`; trimmed shading `display-approximation` |
| GET | `/api/models/:id/history` | operation tree: nodes `{sequence, name, operationId, status, span, excerpt, callPath, parameters (mm/deg plus SI original), outputs, removedBodies, evidence {method, status, stats}}`; links body→op, entity→op, face→sketch entity, Boolean face→input faces | `recorded` / `design-parameter` |
| GET | `/api/compare?before=:id&after=:id` | `{counts {raw, logical} Δ, volume Δ, bounds Δ, bodies [{before, after, matchedBy: identity / body-id}], entities [{alias, status: identity / ancestry / support-coincident / revision-local / ambiguous / missing, target?, parameterDeltas?}], tallies}` | per row: `identity`, `ancestry`, `exact-parameters`, `recorded` |
| POST | `/api/compare/material` `{before, after}` | added/removed/common bodies and volumes, or 422 with the capability error | `kernel-resolved`, on demand |

Implementation notes for the spec stage:

* Everything above fits in `src/viewer/*` modules that import production
  code; nothing needs a new npm dependency.
* Heavy calls (`classifySolid`, material diff, the first kernel load) belong in
  the same worker as the builds, with request cancellation.
* Aliases (`B1.F3`) are bound to one `modelId`; cross-revision references must
  use `topologyReference`, never aliases or indices.

## 8. Traps for implementers

1. `surface.normal` is not the outward normal on analytic faces with
   `sameSense: false` (bored spacer bottom cap: stored `+Z`, faces `−Z`).
   Return `outwardSign` or the outward normal explicitly.
2. Legacy edges are the string `"line"`; analytic edges are objects. Summary
   code already switches on `typeof edge.curve`.
3. Closed circles have `start === end` and usually no `curveRange`.
4. `validation.volumeMm3` / `boundsMm` can be `null`; that means "not
   evaluated", not zero.
5. Boolean outputs are fragmented; counts, bed detection and picking need
   logical faces.
6. `sourceMap` parameters are SI (meters, radians).
7. Two meanings of "source": code call site (`operation.source`,
   `debug.source`, sketch-entity `identity.source` with `span`) versus external
   entity (`identity.source` on imports, no span).
8. `measureGeometrySummaryTokens` and `wonky-inspect --tokens` default to
   `python3`; under the project rules they must be given a `uv run` wrapper.

## Reproduce

```sh
node scripts/viewer/audit-data-probes.mjs --out out/viewer/audit-data/probes.json
```

The script builds five small models (the pocket plate twice, about 6–8 s in
total), runs every probe once and writes nothing besides the optional report.
