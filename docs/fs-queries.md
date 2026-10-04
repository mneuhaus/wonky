# Geometric FeatureScript queries

`src/queries.mjs` evaluates the std `query.fs` filters `qCoincidesWithPlane`,
`qGeometry`, `qClosestTo` and `qParallelEdges`. The semantics come from the std doc comments
(query.fs, FeatureScript 2960, read from the public std library mirror):

- `qCoincidesWithPlane(queryToFilter, plane)`: "all entities (bodies, faces,
  edges, or points) in `queryToFilter` coinciding with a specified infinite
  plane". The std source carries `// TODO: tolerance`: Onshape publishes no
  tolerance for it.
- `qGeometry(queryToFilter, geometryType)`: "all entities in `queryToFilter`
  with a specified GeometryType".
- `qClosestTo(queryToFilter, point)`: "the entity in `queryToFilter` closest to
  a point. In the case of a tie, resolves to all entities within
  `TOLERANCE.zeroLength` of being the closest" (std math.fs: 1e-8 m).
- `qParallelEdges(queryToFilter, direction is Vector)`: "all linear edges in
  `queryToFilter` which are parallel (or anti-parallel) to the given
  `direction`"; `qParallelEdges(queryToFilter, edges is Query)`: the same
  against "any linear edge in `edges`". No tolerance is published. The
  one-argument `qParallelEdges(referenceEdges)` is marked `@internal`
  ("Unconventional semantics, not for general use") and refuses by name.

All four run on the Bend services from `loadModelingServices()` (face and
solid classifiers, `kernel/edge-plane.bend`). `src/index.mjs` loads them when
the source names one of these queries; without them (the native backend) the
queries refuse by name. The dataflow tracer (`src/lang/dataflow/fs-trace.mjs`)
keeps them symbolic and declares the same `GeometryType` members.

## Entities

Onshape (Parasolid) bodies have no seam edges and no vertices on closed edges.
wonky closes each periodic face with a seam edge the face uses twice, in
opposite directions, and starts each closed circle or ellipse at a seam vertex.
`qOwnedByBody(..., EDGE | VERTEX)` and `qAdjacent(..., EDGE, EDGE)` leave both
out (a seam vertex is the vertex of a closed edge that no open, non-seam edge
ends at). A cylinder therefore has two edges and no vertex, as in Onshape. A
vertex that only seam edges reach (the poles of a revolved sphere, a cone's
apex) is singular: whether Onshape has a vertex there is not documented, so a
vertex query over its body refuses by name. `qOwnedByBody(..., VERTEX)` is new
with this change; `evBox3d` over vertices gives the box of their points on any
body (over faces and edges of analytic bodies it still refuses).

## qCoincidesWithPlane

Coincidence is a relation of point sets: the plane's normal direction and a
face's orientation do not matter. Each face, edge and vertex is decided in
this order; what is left refuses by name.

1. **Exact yes**: a Bend certificate on the stored F32x2 words. A planar face
   by its carrier, `intersections.plane_plane` `CoincidentPlanes` (exact
   parallel and incidence certificates); an edge by `edge-plane.intersect`
   `Coincident` (exact curve and source-vertex certificates); a vertex by
   `coincidence_certificate` of `n . (p - o) = 0`.
2. **Exact no**: a face on a cylinder, cone, sphere or torus (no face of
   positive area lies in a plane); `ParallelPlanes` (farther apart than
   `TOLERANCE.zeroLength` plus the guard) and `CrossingPlanes` (sine above the
   kernel's default angular tolerance 1e-10, which is above std
   `TOLERANCE.zeroAngle` 1e-11); an edge that is `Disjoint`, `Crossing` or
   `Tangent`. A planar face is decided on its carrier, as a relation of
   surfaces: a sliver face within the zero length of a crossing plane is not
   selected.
3. **Rounding**: the query plane is computed by FeatureScript in binary64
   metres, the entity by the kernel in F32x2 millimetres (48-bit
   significands). One exact plane then differs by rounding only, a few units of
   2^-48 relative to the coordinates. When every extreme point of the entity
   lies within the kernel margin `16 x 1e-13 x max(1, |coordinates|)` of the
   plane, the entity coincides at the kernel's resolution. The margin is
   face-plane.bend's exclusion margin (sixteen times `intersections.bend
   guard`), an operational guard, not a certified interval bound. The extreme
   points are the vertices and, on a circle or ellipse, the parameters
   `t* = atan2(b n.y, a n.x)` and `t* + pi` inside the edge's range; a partial
   arc without a stored range has unknown extremes and cannot use this step.
   A planar face whose carrier `plane_plane` certifies exactly parallel to
   the plane (it answers `NearCoincidentPlanes` only after its exact parallel
   certificate) has one distance `|n . (carrier origin - plane origin)|` at
   every point, so it is decided on that distance first, with the margin at
   `plane_plane`'s scale `max(1, |carrier origin|, |plane origin|)`; a
   margin of the zero length or more (scale above 6.25e6 mm) accepts nothing.
4. **Clearly off**: a point of the entity farther than `TOLERANCE.zeroLength`
   (1e-5 mm) plus the margin plus the body's source allowance does not
   coincide.

Between the kernel margin and the zero length wonky cannot know Onshape's
answer (no published tolerance) and refuses: `qCoincidesWithPlane: <entity>
lies within 0.00001 mm (TOLERANCE.zeroLength) of the plane but is neither
certified to lie in it nor within the kernel's resolution (...)`. So a plane
one linear resolution unit of the kernel (1e-7 mm, the intersections default)
off a face never selects it, and 2e-5 mm off gives an empty result.

The rounding step is what real models need: edge.fs builds its top face from
the same `cutPlane` value the query uses, and `plane_plane` answers
`NearParallelPlanes` because the carrier's normal was normalized on the other
path.

Bodies refuse: whether Onshape tests the body or its faces is not documented.

## qGeometry

| Entity | wonky geometry | GeometryType |
| --- | --- | --- |
| face | plane, cylinder, cone, sphere, torus carrier | PLANE, CYLINDER, CONE, SPHERE, TORUS |
| edge | line | LINE |
| edge | circle, one seam vertex, no range (the whole circle) | CIRCLE |
| edge | circle between two vertices | ARC |
| edge | ellipse | OTHER_CURVE |

`REVOLVED`, `EXTRUDED` and `OTHER_SURFACE` never match: every wonky revolve and
extrude builds one of the five simple carriers. `ALL_MESH`, `MIXED_MESH` and
`MESH` name Onshape mesh entities and never match: a certified-mesh body stands
for the exact B-rep Onshape builds, so its faces take the type of their
recorded carrier. Vertices, and bodies with a non-mesh type, refuse: the docs
give them no geometry type. A circle with one vertex and a stored range is an
edge the kernel rejects and refuses.

## qClosestTo

Distances are computed with Bend reals. Each carries an uncertainty `u`, the
kernel margin above plus the body's source allowance (an imported Onshape
body's vertex tolerance, 3e-4 mm, dominates it). Each entity is compared with
the OTHER entities only: with `lo'` and `hi'` the smallest `d - u` and `d + u`
among them, it is kept when `d + u <= lo' + zeroLength` (it is within
`zeroLength` of the closest for every value in the intervals) and dropped when
`d - u > hi' + zeroLength` (another entity is certainly closer by more);
otherwise the tie is undecided and refuses by name. A single entity, or one
whose upper bound lies below every other lower bound, is always kept, also on
an imported body; a real tie on an imported body (`2u > zeroLength`) refuses.

- vertex: the distance to its point;
- line edge: to the segment between its vertices;
- circle edge: `sqrt(h^2 + (rho - r)^2)` (h the height over the circle's plane,
  rho the radius of the projection) when the projection's angle lies in the
  edge's range, a whole circle always; the end vertices are candidates too
  (along a circle the distance has one minimum and one maximum, so outside the
  range it is smallest at an end);
- planar face: the projection classified by the planar face classifier; inside
  or on the boundary gives the height, outside the closest boundary edge;
- cylindrical face: the radial foot classified by the cylinder classifier, then
  as for planes. A point on the axis refuses (every generator is equally far).

Ellipse edges, cone, sphere and torus faces, bodies and certified-mesh bodies
refuse by name.

## qParallelEdges

Entities of `queryToFilter` that are not linear edges (faces, bodies,
circles, ellipses) are not selected; non-linear reference edges give no
direction. A line's direction is its carrier's (`analytic.mjs` Line) or, for
a plain segment, end minus start vertex. The direction vector may be unitless
or of one unit (std `normalize` divides it out); a zero vector is an error.
Each pair is decided like `plane_plane` decides plane normals:

1. **Exact yes**: `intersections.parallel_certificate`, the exact cross
   product of the stored words is zero.
2. **Rounding**: the sine between the unit directions is at most the kernel's
   angular guard (`intersections.bend angular_guard`, 1e-12). One direction
   computed on two paths (FeatureScript binary64, kernel F32x2) differs by a
   few units of 2^-48; std `TOLERANCE.zeroAngle` is 1e-11, so such a pair is
   parallel for Onshape too. A 30 degree edge sketched from FeatureScript
   points is decided here (sine 0 to 9e-16, no exact certificate).
3. **Exact no**: the sine exceeds the kernel's default angular tolerance
   1e-10 plus the guard (the bound `plane_plane`'s `CrossingPlanes` uses).

Between 1e-12 and 1e-10 wonky cannot know Onshape's answer and refuses by
name. The R20 return module calls the vector form (return.fs:1022, 1032, 1148,
1268).

## Certified-mesh bodies

A certified-mesh body (docs/hybrid-mesh-bodies.md) has faces with a recorded
exact carrier but no exact edges or vertices.

- `qCoincidesWithPlane` over its faces: steps 1 and 2 on the carrier, and
  step 3 on an exactly parallel carrier (its one distance); a carrier farther
  than the margin but within the zero length refuses as the undecided band,
  and a near-parallel carrier (`NearParallelPlanes`) refuses because steps 3
  and 4 need exact boundary points. The real T01 rim face (carrier z
  184.81499999999983, 1.7e-13 mm below the rim plane) is decided by step 3.
- `qGeometry` over its faces: the carrier's type.
- Its edges and vertices (`qOwnedByBody(..., EDGE | VERTEX)`), `qClosestTo` and
  `qParallelEdges` over its edges refuse.

The R20 tray's T01 is a certified mesh already after its cavity cut (recover:
a cylinder/cylinder space quartic), so `r20TrayBlends` finds its two end-wall
faces by carrier, but the edge queries built on them refuse at `qAdjacent`.

## Sketch regions on the Rust port

On `WONKY_BACKEND=rust` a sketch-region query (`qSketchRegion(id)` of a line
sketch, CAD-Acid AC99) is a lazy set of regions, evaluated exactly when
`opExtrude` consumes it (`src/native/rust-host.mjs`, `src/queries.mjs`,
`rust/wonky-ops/src/region_query.rs`). `test/rust-region-queries.test.mjs`
sweeps every query builtin against a plain and a point-selected region and
checks each build against a closed-form volume or a named refusal.

Implemented, following std `query.fs` and the Onshape query reference:

- `qUnion` keeps the operands' precedence order, `qIntersection` the first
  operand's order, `qSubtraction` the first query's; a region is never in a
  set twice. `qNothing()` operands are the empty set.
- `qContainsPoint` / `qClosestTo` decide among the regions of their subquery
  (nested selections and set algebra included), in the frame of the
  extrusion that consumes them. A region's distance to the point is the height
  over its plane when the foot lies in or on the loop, else the distance to its
  nearest boundary segment. `qContainsPoint` is a closed set within
  `TOLERANCE.zeroLength` (a point that `toWorld` rounded off a rotated plane
  still lies in its region); `qClosestTo` keeps every region within that tie
  of the closest. The Rust kernel receives the candidate indices of the
  subquery and answers among them only.
  Over a sketch with circles, arcs or crossing or nested closed chains (the
  wonky-curve arrangement, `rust/wonky-ops/src/sketch_pick.rs`, host op
  `SKETCH_PICK`) the point is taken to the sketch plane exactly, membership
  is the exact winding number and `Trimmed::contains` of each cell's
  boundary, and the distance is a certified interval to the cell's boundary
  pieces (curved regions, crescents and lenses included). A point on the edge
  of two or more cells refuses `point-on-boundary`.
- A sketch region is a planar face: `qGeometry(..., PLANE)` and
  `qEntityFilter(..., FACE)` keep the set, every other geometry or entity
  type selects nothing.
- `qNthElement` is zero-based with negative indexing. Onshape orders its
  result "deterministically but arbitrarily", so only a single-region set is
  decided.
- `evaluateQuery(context, regions)` returns one query per region, in wonky's
  arrangement order. Onshape's order is the same "deterministic but
  arbitrary" one as for `qNthElement`, so iterating over the result or taking
  its `size` matches Onshape, but indexing one element of a multi-region
  result (`evaluateQuery(context, regions)[0]`) is not guaranteed to pick the
  region Onshape picks. This is not refused: nothing here can tell an index
  from an iteration.
- Selecting nothing is the `opExtrude` refusal `empty-region`.

Named refusals (each carries a hint; `sketch-region/...` codes are the CLI
`code`):

- `multiple-sketches`, `multi-sketch-point-selection`: regions of several
  sketches in one extrusion or one point selection.
- `point-on-boundary`: a `qContainsPoint` point that lies on the boundary
  of more than one candidate cell (within `TOLERANCE.zeroLength`, exact in the
  sketch plane). std `query.fs` documents only "all entities ... containing a
  specified point", not whether a point on an edge shared by two regions is
  contained by both (the gear plan's OM5 probe is unmeasured), so wonky picks
  neither one side nor both. A point on the edge of exactly one candidate
  selects it (closed set).
- `tie-undecided`: the certified distance interval cannot separate a
  `qContainsPoint` boundary test or a `qClosestTo` tie from the tolerance.
- `point-selection-legacy-numbering`: a sketch with arcs or circles whose
  regions came from the loose-edge solvers, not the arrangement, so a region
  index would mean something else in the pick.
- `point-selection-outside-extrude`, `query-outside-extrude`,
  `topology-query-not-extrudable`, `not-a-topology-query`: any other consumer
  (such as `opRevolve` or `opLoft`), which would otherwise use every region, or
  a topology query given to `opExtrude`.
- `mixed-with-topology`: a set operation combining regions with a non-empty
  topology query.
- `nth-element-order-unspecified`, `nth-element-out-of-range`: the two cases
  `qNthElement` leaves undocumented.
- `owner-body-type-undocumented` (`qBodyType`), `owner-body-undocumented`
  (`qOwnedByBody`), `adjacency-unavailable` (`qAdjacent`),
  `coincidence-tolerance-unpublished` (`qCoincidesWithPlane`),
  `parallel-edges-of-faces-undocumented` (`qParallelEdges`),
  `robust-query-unavailable` (`makeRobustQuery`): Onshape does not document
  what the query means for a sketch region (or wonky does not compute it), so
  no answer is guessed. Regions as the second query argument
  (`qOwnedByBody(queryToFilter, regions)`, `qParallelEdges(queryToFilter,
  regions)`) refuse the same way.
- `invalid-candidates`: the host request named a candidate outside the
  arrangement (a bug in the caller, never a geometry result).

`qEntityFilter` and `qNthElement` over topology queries refuse with
`query/entity-filter-topology-not-implemented` and
`query/nth-element-topology-not-implemented`. `qContainsPoint` over topology
stays unported on the Rust port.

## Validation

```sh
node --test test/r20-queries.test.mjs test/hybrid-mesh.test.mjs
```

The tests (with `test/lang-dataflow.test.mjs` for the tracer) cover planar, cylindrical and conical faces, line, circle, arc and
ellipse edges, vertices, empty queries and ties, planted negatives (a plane
one kernel resolution unit and twice the zero length off, a crossing plane, the
plane through a bore's axis, every other GeometryType), synthetic
reproductions of the edge.fs and tray.fs call sites, qParallelEdges in both
forms (anti-parallel, a rotated box, the undecided band, circles and faces),
and mesh faces (a rounding-offset parallel carrier selected, one resolution
unit refused).

## Curve evaluators and local boxes

The std contracts are `evaluate.fs`, `curveGeometry.fs` and `coordSystem.fs`
at the public std mirror commit
[`a2a7b13ea823f144b20d27198043aea35a64d928`](https://github.com/javawizard/onshape-std-library-mirror/tree/a2a7b13ea823f144b20d27198043aea35a64d928).
The returned curve **type tags** are `Line`, `Circle` and `Ellipse`; std does
not define a `curveType` map field. Lines have `origin` and unit `direction`.
Circles have `coordSystem` and `radius`; ellipses have `coordSystem`,
`majorRadius` and `minorRadius`. `CoordSystem` stores `origin`, `xAxis`,
`zAxis`; y is z cross x. Origins/radii carry length units, axes are unitless.
`evCurveDefinition` reads the first resolved edge's carrier, not its trim.

`evEdgeTangentLine` runs in `kernel/evaluate.bend`. For finite linear segments
and circle arcs the 0..1 parameter is oriented arc length. The existing edge
preparer validates the stored trim, endpoints and sense before evaluation.
Circles use radians internally; a closed circle starts at its represented
seam vertex and traverses one turn in the edge's sense. Natural and arc-length
parameterization coincide for these constant-speed carriers. Exact here means
analytic carriers, not symbolic or certified exact arithmetic: evaluation uses
Bend F32x2 reals. There is no polygonal tangent approximation.

Named capability refusals:

- `EllipseArcLengthUnsupported`: ellipse tangent evaluation, including the
  `arcLengthParameterization: false` option (not implemented either).
- `FaceOrientationUnsupported`: any supplied `face` orientation option.
- `MissingTrim`, `InputGap`, and other named edge-preparation failures: no
  guessed arc span or silently repaired orientation.
- `BendEvaluationUnavailable`: these services are absent on the native-only
  backend; JS-target evaluation is not evidence of native/Metal support.

`evBox3d` with `cSys` subtracts its origin, projects actual polyhedral vertices
onto x/y/z and computes local extrema in Bend. An analytic body's vertices may
also be selected individually. It never rotates a world bounding box as a
substitute. Analytic body/face/edge local bounds currently refuse with
`AnalyticLocalBoundsUnsupported`; world-space behavior is unchanged. A tight
box also satisfies `tight: false` (which permits a larger box).

`test/return-evaluators.test.mjs` owns these contracts. Its frozen Return
excerpts and SHA256 provenance are in `fixtures/return-evaluators/`.
The ARM window fixture isolates that boundary from the full ARM_R Boolean
union; it is not acceptance of the six rounded seat/plate seam edges or of
the complete Blend chain. The plain RET_HUB revolve uses unchanged frozen
setup and selection statements. The independent export oracle is run with:

```sh
node scripts/return-evaluators-oracle.mjs out/return-evaluators/oracle
uv run --no-project --python out/build123d-performance/reference-venv/bin/python \
  scripts/return-evaluators-oracle.py out/return-evaluators/oracle
```

The oracle checks STEP validity, the two hub rings (r 25 at x 133.8 mm, r 11
at x 152.3 mm), circle frames/parameters, and local box bounds against OCCT
and closed forms. OCCT never constructs production geometry.
