# Kernel gaps for a native cad_khana

What the wonky Bend kernel and its JS host must provide so that cad_khana's
diagnostics (interference, clearance, printability, pick, drawings) run
natively, without OpenCascade. For every primitive: does it exist (where,
exactness, surface types, speed), is it partial, or missing, and what the Bend
implementation must look like. The minimum-distance primitive is designed in
detail (section 6), interference on top of it (section 7).

Scope and rules: research only; nothing in the kernel was changed. AGENTS.md
applies to every design below: geometry stays in Bend, unsupported cases raise
a capability error (also inside `try`), analytic curves are never silently
polygonized, approximations carry a stated tolerance and a label.

**Evidence labels.** *[read]* a statement about code, with file:line.
*[measured]* a command was run (appendix A). *[sibling]* measured by another
agent of this workflow, with its worklog. *[inferred]* my reasoning, not
checked by running anything.

**Line numbers** refer to the working tree on 2026-09-24 (HEAD `d917992` plus
about 98 uncommitted files of the paused r20-gate and fillet work). Files that
are uncommitted in that tree are marked **[U]**: `kernel/volume.bend`,
`src/volume.mjs`, `kernel/hybrid/**`, `kernel/proto/fillet-kpart/**` are
untracked; `kernel/analytic.bend` (adds Sphere and Torus), `kernel/ray.bend`,
`kernel/tessellate.bend`, `src/print-mesh.mjs`, `src/boolean.mjs`,
`src/library.mjs`, `src/queries.mjs`, `src/kernel.mjs`, `src/analytic.mjs` are
modified (`git status --short`, appendix A).

---

## 1. Summary

| # | primitive cad_khana needs | status | where | exactness today | surfaces covered | speed (JS target) | needs r20 hybrid first? |
|---|---|---|---|---|---|---|---|
| P1 | intersection volume `vol(A ∩ B)` (+ centroid) | **partial** | INTERSECTION arms in `src/boolean.mjs:307-350` [U], hybrid last arm `:196-200` [U]; volume `kernel/volume.bend` [U] | Boolean exact per arm; volume `exact` (closed form) or `quadrature` with bound | Boolean: planar, plane/cylinder convex tool, hybrid for the rest; volume: all 5 carriers | volume 0.6-0.8 ms per body [measured] | **yes** for general pairs (hybrid INTERSECTION, task 10), volume.bend itself is [U]; touching contact is refused by the hybrid by design |
| P2 | minimum distance / clearance between bodies | **missing** | only a threshold join over triangles in `kernel/hybrid/recover/clear.bend` [U] | F32 tri/tri distance with a heuristic allowance | mesh only | not measured | the exact path no; the mesh path reuses clear.bend [U] |
| P3 | ray hits on trimmed faces, every surface type | **partial** | supporting-surface roots `kernel/ray.bend:312-335`; trims only inside solid classification | certified roots (expansions) | plane, cylinder, cone; sphere/torus answer kind 4 (unresolved) [U] | part of classification cost | no (sphere/torus need Sphere/Torus in analytic.bend [U]) |
| P4 | point membership (`is_inside`) | **partial** | `kernel/solid-classification.bend:330-332`, host `src/queries.mjs:129-158` | exact decision or `Unresolved` | plane and cylinder faces only (`:145-152`); cone refused [measured] | 6-11 ms per point [measured] | no |
| P5 | face-typed tessellation with certified deviation | **partial** | `src/print-mesh.mjs:183-200` [U] (tags), `kernel/tessellate.bend` [U] | deviation computed in Bend, two-sided per its comments | planes, cyl/cone bands, sphere/torus zones with meridians; ellipse edges refused (`print-mesh.mjs:41-42`) | 1.4-6.1 ms, 64-632 triangles for an r5 cylinder at 0.1-0.001 mm [measured] | yes (task 7 print-mesh coverage is the [U] work) |
| P6 | face geometry queries (type, radius, axis, normal_at, center, bbox, area) | **partial** | carrier data in the body JSON; `A.surface_residual` `kernel/analytic.bend:108-129` | type/radius/axis exact; no normal/center/face-bbox query | all 5 carriers as data | – | no |
| P7 | per-solid volume, solids count, void detection | **partial** | `integrateVolume` `src/volume.mjs:104-138` [U]; one shell per body (`src/analytic.mjs:281`, `src/boolean.mjs:78-81` [U]) | `exact`/`quadrature` with bound | all 5 carriers | 0.6-0.8 ms [measured] | volume.bend is [U]; voids need a body-format change |
| P8 | edge convexity and dihedral angles | **missing** (proto) | `kernel/proto/fillet-kpart/ladder.bend:31-40` [U] (one point per edge) | exact sign possible | proto: plane/cyl/cone | – | no |
| P9 | per-face area and angular extent | **partial** | `ring_area` plane+cylinder in `kernel/ports/curved-metrics.bend:144-151` (internal, returns 0 for other carriers); sphere area inside `volume.bend:948` [U]; `winding` `curved-metrics.bend:153-158` | closed form where covered | plane, cylinder | – | no |
| P10 | tight bounding boxes (body and face) | **partial** | `validation.boundsMm` of frusta/polyhedra (`src/analytic.mjs:193-199`, `src/brep.mjs:194`); refused otherwise (`src/python.mjs:95-101`) | exact where present | polyhedra, frusta | – | no |
| P11 | HLR (visible/hidden edges, silhouettes) for `draw` | **missing** | nothing (no silhouette/HLR code in kernel or src) | – | – | – | no |
| P12 | stable topology indices for pick/hints | **exists (different model)** | `kernel/identity.bend:6-19`, `docs/topology-identity.md` | exact identities, not OCCT indices | all | – | no |

The shortest honest statement: wonky has the exact **building blocks**
(certified line/surface roots, trimmed-face membership for planes and
cylinders, an integrated volume with an error bound for all five carriers,
a tessellation whose deviation is proven in Bend, stable identities), but none
of the three primitives cad_khana calls most (`a & b` + volume, `distance_to`,
`find_intersection_points`) exists as a body-level query, and every
per-primitive coverage stops at plane + cylinder (sometimes cone).

---

## 2. What cad_khana asks of OpenCascade

Read from the upstream source (`~/Workspace/cad/cad-khana/src/cad_khana`,
read only). The semantics that a native version must reproduce or knowingly
improve are listed with each call.

| OCCT call (build123d) | used by | semantics that matter |
|---|---|---|
| `a & b` then `.volume`, `.center()` | `mechanism/assertions.py:17-32` (`_intersection_volume`), `mechanism/diagnostics.py:87-111` (`_interference`) | pass iff volume ≤ `INTERFERENCE_VOLUME_EPSILON_MM3 = 0.001` (`diagnostics.py:13`); centroid of the largest piece (`:100-108`) |
| `Shape.distance_to` (BRepExtrema) | `assertions.py:56` (clearance, `dist >= min_mm`, no epsilon), `mechanism/pick.py:102` (face-to-face distance) | boundary distance; touching gives 0 |
| `find_intersection_points(Axis)` | `printability/wall.py:11-25` | ray from each triangle centroid, offset `RAY_OFFSET_MM = 1e-4` inward (`wall.py:7`), hits closer than `SLIVER_HIT_DISTANCE_MM = 0.05` ignored (`:8`, `:23`) |
| `is_inside(point)` | `printability/holes.py:150` (bridge anchors 0.5 mm below, 0.5 mm beyond the span), `printability/structure.py:76,79` (convexity probes 0.2 mm off the edge) | boolean, no boundary answer |
| `tessellate(0.1, 0.3)` whole part and per face | `core/tessellation.py:7-8,28-32`, `printability/holes.py:79-105` | chord 0.1 mm, **angle 0.3 rad**: triangle normals on curved faces are off by up to about 0.15 rad (8.6°) from the surface normal [inferred], and every overhang angle, overhang area and support estimate is computed from triangle normals (`printability/overhangs.py:20-22,60-61`, `orientation.py:82-94`) |
| face geometry: `geom_type`, `center()`, `normal_at`, `bounding_box`, `BRepAdaptor_Surface.Cylinder()` axis/radius, U range | `holes.py:64-76,164-236`, `pins.py:36-60`, `pick.py:42-56,83-104` | a cylinder face counts as a pin when `LastU - FirstU >= 5.2 rad` (`pins.py:22,40`); bore vs boss from the normal at `face.center()` (`holes.py:71-75`), and for a cylinder face `center()` is the surface point at the parameter midpoint, not a centroid [sibling: local development evidence step 5] |
| `volume`, `area`, `center()`, `is_valid`, face/edge/vertex counts | `diagnostics.py:73-84`, `printability/inspect.py:138-139` | per placed part |
| `solids()`, `shells()` | `structure.py:39-48` | voids = inner shells; floating = extra solids and their volume |
| edge → face ancestor map, LINE/PLANE dihedral | `structure.py:51-81` | only line edges between two planar faces, length ≥ 2 mm (`:36,63`); convexity by two `is_inside` probes |
| HLR `Drawing(..., with_hidden=True)` | `draw.py:470-483`, conic keys `draw.py:109-150` | visible/hidden edges, circles/ellipses kept as conics |
| `BRepMesh_IncrementalMesh` + XCAF colors | `export.py:88-170` | GLB export |

Measured OCCT behaviour that a native kernel should not copy blindly
[sibling: `inv-mechanism.md` step 4, `tmp/khana/oracle/probe/probe.json`]:

- a small cube placed **inside** a big cube: `distance_to` = 8.0 (boundary
  distance, `InnerSolution` false for Parts), so `assert_clearance(min_mm=5)`
  passes for nested parts;
- a Ø3 pin concentric in a Ø3.5 bore: distance `0.24999999999999983`, so
  `assert_clearance(min_mm=0.25)` fails on nominal geometry; corpus files work
  around this with `min_mm=0.20-1e-6` (`coupons.py:135`, `snap_coupon.py:59`);
- face, edge or vertex contact: volume 0, distance 0, so no-interference
  passes and clearance fails;
- the overlap that still passes is `0.001 mm³ / contact area` deep (10×10 mm
  contact: 1e-5 mm), so the interference tolerance depends on the contact
  size.

---

## 3. Baseline: representation and plumbing

### 3.1 The body model limits every primitive

- **Curves:** `Line | Circle | Ellipse` only (`kernel/analytic.bend:8-11`).
  **Surfaces:** `Plane | Cylinder | Cone | Sphere | Torus`
  (`analytic.bend:21-26`; Sphere and Torus are [U], HEAD has the first three).
  Hybrid-recovered bodies stay inside this set: the decoder accepts exactly
  these curves and surfaces (`src/hybrid.mjs:268-283` [U]); their edges carry
  `boundaryDeviationMm` and `certifiedBoundMm` (`src/hybrid.mjs:306`).
- **One connected shell per body.** `A.Solid{vertices, edges, faces}` has no
  shell list (`analytic.bend:37-38`); `validateAnalytic` rejects disconnected
  shells (`src/analytic.mjs:281`); a recovered body with an enclosed void is
  refused by name (`src/boolean.mjs:78-81` [U]). A void can therefore never
  exist in a wonky body.
- **Certified-mesh bodies** (`geometry: 'mesh'`, `src/hybrid-mesh.mjs:1-27`
  [U]) have faces with exact carriers but no exact edges or vertices; edge
  queries, `qContainsPoint`, `evBox3d` and transforms are refused on them.
- **Validation is the "is_valid".** A body that fails validation is never
  created (`fail()` in `validateAnalytic`, `src/analytic.mjs:223-287`,
  polyhedral `validateSolid`, `src/brep.mjs:141-195`); the certified scope is
  stated in `validation.scope`. `validateAnalytic` sets `volumeMm3: null,
  boundsMm: null` (`src/analytic.mjs:284-286`); constructors that know better
  fill them (frusta: `src/analytic.mjs:193-199`; polyhedra: area and volume by
  triangulation, `src/brep.mjs:184-194`).

### 3.2 Scalars and numerics

`R.Real` is a normalized F32 pair (about 48 significand bits) with no host
floating point in its arithmetic (`kernel/real.bend:3-6`). Exact sign
decisions use expansions (`kernel/intersections.bend:116-243`, e.g.
`perpendicular_certificate` `:243`, `coincidence_certificate` `:253`) and
signed base-4096 integers (`kernel/robust-predicates.bend:1-7`). Across the
native boundary `Real` is exactly two words, never binary64
(`docs/native-bridge.md` 5.5). Host views collapse Real to binary64
(`src/real.mjs:9`, native-bridge.md 6.3).

### 3.3 How a query reaches Bend

- The JS target loads one module per kernel area through the persistent Bend
  loader (`src/kernel.mjs:20-53` [U]); `kernel.volume` and `kernel.hybrid`
  are loaded there ([U], `:47`, `:50`).
- The face and solid classifiers are *services*, loaded lazily
  (`src/library.mjs:65-70`) and **never on the native backend**
  (`src/index.mjs:15-22`); `qContainsPoint` refuses without them
  (`src/queries.mjs:133`).
- Native backend: one bound entry `kcall(op, words)`; every new query is a
  generated wire op; entries not in the build throw `NativeCapabilityError`,
  kernel refusals travel as payload values (`docs/native-bridge.md` 5.1, 5.2,
  7). Known risk: Bend 2.0.25 cannot emit C for a module with an arity over 255
  (`docs/hybrid-boolean-plan.md:292-295`).
- FeatureScript evaluation queries that overlap with cad_khana are **not
  implemented**: only `evVolume` (`src/queries.mjs:354-384`), `evBox3d`
  (`:385-393`), `evLine` (`:394`) and `evOwnerSketchPlane`
  (`src/library.mjs:872`). `evDistance`, `evArea`, `evEdgeConvexity`,
  `evFaceTangentPlane`, `evSurfaceDefinition` appear only in tracing tables
  (`src/lang/dataflow/fs-trace.mjs:375-376`, `src/lang/wk/stage-fs.mjs:58-62`).
  Every primitive below should serve both frontends.
- Python bridge: the shim asks the host for `volume`, `bounds`, `edges`, ...
  (`src/python.mjs:86`); `volume` returns `body.validation.volumeMm3` only and
  refuses otherwise (`src/python.mjs:653-657`), so a recovered body whose
  volume is only integrable (quadrature) is a capability error in Python
  although `integrateVolume` could answer with a bound. `bounds` refuses every
  curved non-frustum body (`src/python.mjs:95-101`).

### 3.4 Bend 2.0.25 idioms every new module must follow

Names defined above their use, no mutual recursion, a `match` branch cannot
destructure a computed tuple (hence `*_of`/`*_done` helpers,
`docs/collections.md:157-160`); loops recurse on a list or a `Nat` fuel with a
capability refusal on exhaustion (`docs/laws.md:217`); a two-phase recursion
is written as one function with two fuel units per level
(`docs/proto-sdf.md:180-181`); duplicated arguments are marked `+`; dense
tables use `kernel/lib/id-vec.bend` (`IdVec`, O(1) get/set natively); a
decision is carried as a `Bool` parameter because Bend matches on parameters,
not computed values (`kernel/tessellate.bend:40-41`); long lists are walked
tail-recursively (`kernel/volume.bend:1408-1417`); parallel work forks
subtrees up to a fixed depth (`kernel/hybrid/recover/clear.bend:538-598`
[U]).

---

## 4. Per-primitive audit

### P1. Intersection volume

**cad_khana:** `a & b` + `volume` for every asserted pair and for every pair
in `compute()` (all `combinations(placed, 2)`, `diagnostics.py:117-121`), and
`center()` of the result.

**Exists.**
- INTERSECTION arms in the working tree [U]: planar/planar via
  `kernel.halfspace.intersect` or the native planar intersection
  (`src/boolean.mjs:307-325`); plane/cylinder "convex tool" bodies via
  `kernel.curvedIntersection.intersect` (`:327-350`); everything else goes to
  the hybrid corefine+recover arm (`:196-200`), policy `hybrid-last`
  (local design note task 10).
- Volume of the result: `integrateVolume` (`src/volume.mjs:104-138` [U]):
  divergence theorem per face, closed form on plane, cylinder and cone faces
  and on whole spheres/tori, adaptive Gauss-Legendre on partial sphere/torus
  faces with the quadrature error as bound (`kernel/volume.bend:6-37`); result
  `Measured{volume, bound, quadrature, faces} | Refused{code, face}`
  (`:115-117`, refusal codes `:101-114`). Label `exact` only when no face
  needed quadrature (`src/volume.mjs:117`). Certified-mesh bodies use the
  carrier method (`integrateMeshVolume`, `src/volume.mjs:195-219`).
  [measured] box, cylinder, cone frustum: 0.58-0.79 ms per uncached call, bound
  about 1e-9 mm³, equal to the constructors' volumes.

**Gaps.**
1. **Empty and touching intersections.** The FeatureScript path refuses an
   empty INTERSECTION (`src/library.mjs:90-92`, Onshape no-op semantics). A
   diagnostics call must instead read "empty" as volume 0, which needs a
   kernel answer "empty" that is certified, not an exception. The hybrid
   refuses face-touching intersections ("a face-touching intersect is refused,
   not returned empty", `docs/hybrid-boolean-plan.md:304`) and tangent contact
   by design (KS04, `local design note,149`). Touching is exactly the case
   cad_khana passes most often. Section 7 answers it without a Boolean.
2. **No centroid.** `volume.bend` integrates only the zeroth moment. The first
   moments `∫x dV` are the fluxes of `F = (x²/2, 0, 0)` etc.: the same boundary
   machinery with polynomial fields of degree 2 (closed form on lines and
   conics on planes; cylinder and cone patches need the degree-2 analogue of
   `piece_j`, `volume.bend:440-490`; sphere/torus through the existing
   quadrature `volume.bend:645-840`) [inferred].
3. Every overlapping curved pair that is not plane/cylinder convex depends on
   the hybrid INTERSECTION; its result may be a certified-mesh body (label
   `approximation`), whose volume is `carrier-quadrature` or `mesh-estimate`
   (`src/volume.mjs:195-233`).

**Bend shape.** No new Boolean. A diagnostics entry
`intersection_volume(a, b, tol) -> Overlap` composes P2 (distance, section 6),
the contact certificate (section 7) and the existing INTERSECTION +
`volume`. It never raises for "empty": `Overlap = Disjoint{distance} |
Contact{certificate} | Overlapping{volume, bound, centroid, label} |
Refused{code, stage}`.

### P2. Minimum distance and clearance

**cad_khana:** `assert_clearance` (`assertions.py:46-66`) and
`face_relations(...)["min_distance_mm"]` (`pick.py:102`).

**Exists:** nothing that returns a distance between two B-reps.
- `kernel/hybrid/recover/clear.bend` [U] is a **threshold** join: triangles
  carry their exact positions and a deviation `h`, a Morton-sorted balanced
  BVH is joined with itself (`self`, `:564-598`) or with a second tree
  (`close2`, `:682-699`), pairs closer than `h + h' + 1e-6 mm` are reported
  (`hit.of`, `:456-463`). The triangle/triangle distance is computed in F32
  local coordinates with an allowance of `1e-6 × largest local coordinate`
  ("about 8 ulps", `:413-416`, `:440-446`). That allowance is stated, not
  proven.
- `docs/hybrid-boolean-plan.md:305` lists "a two-body variant reports the
  minimum distance with the deviation as uncertainty" as **conjecture**.
- Per-carrier residuals exist but are not distances for every carrier:
  `surface_residual` is the true distance for plane, cylinder and sphere, but
  the radial residual for a cone (`analytic.bend:115-120`) and the tube
  distance for a torus (`:124-129`).

**Design:** section 6.

### P3. Ray hits on trimmed faces

**cad_khana:** `find_intersection_points` along the inward normal of every
triangle (`wall.py:11-25`); indirectly `is_inside`.

**Exists.**
- `line_surface(origin, direction, surface) -> Roots{kind, values}`
  (`kernel/ray.bend:334-335`): infinite oriented line against the supporting
  surface; kinds 0 miss, 1 transverse roots, 2 certified double root, 3
  coincident, 4 unresolved, 5 invalid, 6 range (`:7-12`). Plane
  (`plane_intersection :174`), cylinder (`:292`, exact polynomial via
  expansions `:211-222`), cone with branch filter (`:246-310`). Sphere and
  torus return kind 4 so that every caller refuses (`:320-325` [U]). No trims,
  no positive-parameter selection (`docs/ray.md:8-10`).
- Trims appear only inside the solid classifier: each root is classified on
  its trimmed face (`count_roots`, `solid-classification.bend:244-261`) with a
  margin, but the hit list is not returned.

**Gaps.** (a) sphere: a certified quadratic exactly like the cylinder path;
(b) torus: a quartic; needs certified isolation (section 6.5 gives the
generic 1-D certified search, which also isolates quartic roots); (c)
trimmed-face membership for cone, sphere and torus faces (P4); (d) a
`ray_hits` entry that returns sorted hits with face, parameter and contact
kind (`Transverse | Tangent | OnEdge{edge} | OnVertex{vertex}`), deduplicated
where one crossing hits two faces at their common edge.

**Bend shape.**
```
type Hit is Data:
  Hit{t: R.Real, face: U32, contact: Contact}
type Hits is Data:
  Hits{items: List<&2, Hit>}
  HitsRefused{face: U32, reason: U32}
def ray_hits(solid: A.Solid, domains: List<&2, F.DomainChoice>, +origin: G.Vec3,
  +direction: G.Vec3, +t_min: R.Real, +tolerance: I.Tolerance, +source_budget: R.Real) -> Hits
```
It reuses `line_surface` and the per-face classifiers of
`solid-classification.bend` (`membership`, `:200-202`), sorts the accepted
roots, and merges hits within the margin that the classifier already computes
(`after_boundary`, `:302-311`). A root classified `Boundary` becomes
`OnEdge`/`OnVertex`; kind 2 becomes `Tangent`. Wall thickness then is "first
hit with `t > 0.05`" as in `wall.py:23`, from exact surface samples with
analytic normals instead of triangle centroids (section 8, idea 6).

### P4. Point membership

**Exists.** `classify(solid, domains, point, tolerance, source_budget)`
(`kernel/solid-classification.bend:330-332`): checks edge-use closure
(`edges_closed :134-135`), tests the point against every trimmed face first
(`boundary_faces :222-227`, so `Boundary` is exact), then casts 5 fixed
directions (`:308`) and needs at least two agreeing votes, any conflict is
`Unresolved{ConflictingRays}` (`finish_votes :294-300`). Faces: plane and
cylinder only (`supported :145-152`), via `face-classification.bend:645` (planar
trimmed faces with line, circle and ellipse edges, no polygonization,
`:1-3`) and `cylinder-classification.bend:456` (parity along the axial
meridian, `:3-5`). Host: body, face (plane/cylinder) and edge membership in
`qContainsPoint` (`src/queries.mjs:129-175`); vertices refused (`:147`).

[measured] 6.3 ms per point on a 3-face cylinder, 10.6 ms on a 6-face box
(mixed inside/outside/boundary points, JS target); the first call loads both
classifiers (2.5 s); a cone frustum answers `Unresolved UnsupportedSurface`
on its cone face.

**Gaps.** Cone, sphere and torus faces; the native backend (services not
loaded, `src/index.mjs:15-22`); speed for sampled uses (wall rays over
thousands of samples) [inferred: at 6-11 ms per point the JS target needs
tens of seconds per part; the native target is the realistic host for
sampled checks].

**Bend shape.** `cone-classification.bend`, `sphere-classification.bend`,
`torus-classification.bend` following `cylinder-classification.bend`: parity
along the meridian through the query point; boundary curves crossing a
meridian are closed-form: a parallel (circle about the axis) crosses it once,
a ruling (cone line) or meridian circle never crosses transversally (it is
parallel to it and is handled as a seam/boundary case), a plane section
(ellipse on a cone, general circle on a sphere) crosses where the plane meets
the meridian curve (line or circle): a quadratic. The sphere poles are
avoided like `volume.bend` does for its area chart (`candidate_axes :840`,
`best_axis :894`). The solid classifier then only extends `supported()` and
`membership()` (`:145-202`); its ray casting already works for cones and
needs sphere/torus roots (P3).

### P5. Face-typed tessellation with certified deviation

**Exists** [U]. `printMesh(kernel, body, deviationMm, {tags})`
(`src/print-mesh.mjs:183-200`): every edge sampled once and shared (watertight
by construction), all points from Bend (`ring`, `arc_interior`,
`row_interior`, `kernel/tessellate.bend:78,115,139`), the achieved deviation
is the maximum of Bend bounds: sagitta for arcs (`:21,145`), band bound for
cylinder/cone bands, `grid_bound` for sphere/torus zones, which is explicitly
**two-sided** (Hausdorff) (`:147-174`). `tags` gives the face index of every
triangle (`print-mesh.mjs:189,198,211,222`). Refused by name: ellipse and
intersection-curve edges, B-spline faces, sphere/torus zones without a
meridian (`:41-42`). A certified-mesh body returns its own snapped mesh
(`:184-189`); a recovered body may fall back to its attached hybrid mesh
(`:191-198`).

[measured] r5 × 10 cylinder: 64 / 200 / 632 triangles at 0.1 / 0.01 / 0.001
mm, achieved 0.096 / 0.0099 / 0.00099 mm, 1.4 / 2.2 / 6.1 ms, tags cover the
3 faces. The cone frustum gives the same counts.

**Gaps for cad_khana.** (a) Ellipse edges (an oblique plane cut of a
cylinder is common in brackets); (b) per-vertex **analytic normals** (the mesh
has positions only; overhang must use the carrier normal, not the triangle
normal); (c) edge and vertex provenance per mesh edge/vertex (for mapping a
closest mesh pair back to a B-rep cell, section 6.3); (d) a
**non-watertight per-face mode**: distance bounds need a two-sided deviation
per face, not a shared division, so one small fillet no longer forces the
whole body's count up (`bodyCount`, `print-mesh.mjs:148-165`) [inferred].

**Deviation direction matters.** A lower distance bound needs "every surface
point is within δ of the mesh", an upper bound "every mesh point is within δ
of the surface". `grid_bound` states both; the sagitta of a circular arc and
the band bound of a ruled strip are symmetric by construction [inferred from
the formulas]; planar faces bounded by arcs lose or gain slivers within the
arc sagitta, also symmetric [inferred]. This must become a test per face
kind before the mesh path in section 6.4 is called certified.

### P6. Face geometry queries

| query | cad_khana use | exists | missing / design |
|---|---|---|---|
| surface type, radius, axis, cone angle, torus radii | `geom_type` everywhere; `BRepAdaptor...Cylinder()` (`holes.py:64-76`) | exact data in the body (`face.surface`, `analytic.bend:21-26`) | nothing |
| outward normal at a point | `normal_at` (`holes.py:71,93`, `structure.py:69`, `pick.py:52`) | only inside modules (e.g. `section.bend:208`, `print-mesh.mjs:55-81` orientation in the host) | a Bend `normal_at(surface, same_sense, point)`: plane `±n`; cylinder/cone/sphere/torus closed form; refusal on the axis/apex/centre (as `print-mesh.mjs:60,65`) |
| face centre | `center()` (`holes.py:70`, `pick.py:44`) | – | define wonky's centre as the **area centroid** (first area moments by boundary integrals, same machinery as P9), not OCCT's parameter-midpoint surface point; keep an explicit "differs from OCCT" note (open question O5) |
| face bounding box | `bounding_box` (`holes.py:92`, `pins.py:61`) | – | P10 |
| face area | `describe_face` `area_mm2` (`pick.py:46`) | partial | P9 |
| plane offset, parallel, coplanar, angle | `face_relations` (`pick.py:83-104`) | – | exact from carrier data; parallel/coplanar decided with the existing certificates (`intersections.bend:243,253`) instead of `_EPS_DOT = 1e-3` / `_EPS_MM = 0.02` (`pick.py:20-21`), with the tolerance stated in the answer |
| angular extent / "full sweep" | `LastU - FirstU ≥ 5.2` (`pins.py:22,40`) | `winding` for cylinders (`curved-metrics.bend:153-158`) | P9 |

### P7. Per-solid volume, solids, voids

- Volume: exists (P1). The Python `volume` request must fall back to
  `integrateVolume` with its label instead of refusing
  (`src/python.mjs:653-657`) [inferred fix, host only].
- Solids count and floating solids: a wonky part is a list of bodies, each one
  connected shell, so `floating_solids` = bodies per part minus one plus their
  volumes, host only.
- **Voids: impossible today.** A Boolean that would create one is refused
  (`src/boolean.mjs:78-81`), so `enclosed_voids` can only ever report 0 for a
  body that exists. A real check needs a multi-shell body: `Solid{vertices,
  edges, faces, shells: List<&2, List<&2, U32>>}` or a shell index per face.
  Solid classification is even/odd over all faces and works unchanged for
  inner shells [inferred from `line_faces :263-270`]; `volume.bend` sums face
  fluxes and gives inner shells a negative contribution automatically
  [inferred from `faces_sum :1312-1326`]; `validateAnalytic`
  (`src/analytic.mjs:278-281`), identity and STEP export must change. This is a
  body-format decision, independent of cad_khana (open question O7).

### P8. Edge convexity and dihedral angles

**cad_khana:** sharp vertical and rim edges: only line edges between planar
faces, dihedral from face normals at the midpoint, convexity from two
`is_inside` probes 0.2 mm off the edge (`structure.py:51-81`).

**Exists:** only the fillet proto [U]: `classify.geo`
(`kernel/proto/fillet-kpart/ladder.bend:31-40`) takes the edge start point,
outward normals `n1, n2`, `sin = |n1 × n2|`, `cos = n1·n2`, convex =
`(n1 × n2)·t > 0`, smooth when `sin` is near zero. One point per edge.

**Design.** `edge_convexity(solid, edge) -> Convexity`
```
type Convexity is Data:
  Convex{min_angle: R.Real, max_angle: R.Real}     # interior angle range along the edge
  Concave{min_angle: R.Real, max_angle: R.Real}
  Smooth{}                                          # tangent faces, certified
  Mixed{}                                           # sign changes along the edge
  ConvexityRefused{reason: U32}
```
- Orientation: the two coedges of a valid two-manifold edge are used once
  forward and once backward (`edges_closed`, `solid-classification.bend:134`);
  take the tangent `t` in face 1's traversal direction and the **outward**
  normals (carrier normal times `same_sense`). The sign of `(n1 × n2)·t` is
  decided exactly with an expansion sign, not a threshold; zero is `Smooth`
  (certified coincidence) or `ConvexityRefused` when undecided.
- Constant along the edge (exact from one point, [inferred] by symmetry): line
  between planes; ruling of a cylinder/cone against a plane containing it;
  circle between a plane and a coaxial cylinder/cone/sphere/torus; circle
  between two coaxial revolution surfaces. Varies along the edge: ellipse
  between a plane and a cylinder/cone (the angle is `acos` of a
  trigonometric function of the curve parameter: its extremes are closed
  form); anything else: the certified 1-D search of 6.5.
- This replaces both probes and extends the checks to curved rims (a
  cylinder boss meeting the plate has a circular sharp rim that cad_khana
  never sees because it only looks at LINE edges, `structure.py:63`).
  FeatureScript `evEdgeConvexity` gets the same entry.

### P9. Per-face area and angular extent

**Exists.** Polyhedral total area by triangulation (`src/brep.mjs:184-193`);
`ring_area` for plane and cylinder loops (`kernel/ports/curved-metrics.bend:144-151`),
which **returns 0 for cone, sphere and torus** (`case _: zero()`), used by the
curved port validators (`curved-validate.bend:100,114`,
`curved-faces.bend:100`); spherical face area by Green's theorem inside the
volume flux (`volume.bend:948-981` [U]); cylinder winding
(`curved-metrics.bend:153-158`).

**Design.** One `area.bend` (or an `area` mode in `volume.bend`, which owns the
`Piece`/`sample`/quadrature infrastructure, `volume.bend:284-840`):

| carrier | area as a boundary integral | exact? |
|---|---|---|
| plane | `½ ∮ ((p − o) × dp)·n` | closed form on lines, circle and ellipse arcs |
| cylinder | `r ∮ h dθ` (`h` height along the axis) | closed form on rulings, parallels and plane sections (`h = a + b cos θ + c sin θ`, `display.bend:14-20`) |
| cone | `∮ (ρ²/(2 sin α)) dθ` in the (θ, ρ) chart | closed form on rulings and parallels; plane sections through the quadrature (bounded) |
| sphere | existing Green's theorem in a pole-free frame | quadrature, bounded (as today) |
| torus | `∮ r(R u + r sin u) dv` | closed form on parallels and meridians; other loops quadrature |

Area centroid (P6) uses the same integrands times position. **Angular
extent** about the axis for cylinder/cone/torus faces: exact from the
θ-ranges of the boundary edges (parallels span their arc range; rulings and
meridians are single angles; plane sections span their full ellipse range).
The pin test becomes topological: the face has two boundary loops that both
wind once around the axis (winding ≠ 0), instead of `U range ≥ 5.2 rad`.

### P10. Tight bounding boxes

**Exists** for polyhedra (vertex box, `src/python.mjs:89-90,96`) and frusta
(`frustum_bounds`, `analytic.bend:422-426`); `evBox3d` and the Python
`bounds` request refuse everything else (`src/queries.mjs:388-389`,
`src/python.mjs:98-100`).

**Design** (exact): the extreme of a linear function `e·p` over a trimmed
face lies on its boundary or at an interior critical point where the outward
normal is `±e`. Plane, cylinder and cone faces have no isolated interior
critical points (a linear function is monotone along every ruling unless `e`
is perpendicular to the ruling, and then the whole ruling is critical and
ends on the boundary) [inferred], so their box is the union of their edge
boxes: line endpoints; circle/ellipse arcs: `c·e ± sqrt((x·e)² a² + (y·e)² b²)`
at a closed-form parameter, kept if it lies in the arc range. Sphere: add
`c ± r e` if that point is inside the face (P4); torus: the up to four points
with normal `±e` (for `e` along the axis, two parallel circles: continua that
end on the boundary or are whole circles) with membership. One entry
`face_bounds(solid, face) -> Bounds | Refused` gives both body boxes and the
per-face boxes cad_khana needs (bridge spans, pin lengths, plate level).

### P11. HLR for `draw`

Nothing exists. Needs (for orthographic views): silhouette curves where
`n·v = 0` (cylinder and cone: rulings, closed form; sphere: a great circle;
torus: a curve of degree 4 in general, not a conic), projection of circles
to ellipses (exact under orthographic projection), and visibility of every
edge piece by rays toward the viewer against trimmed faces (P3), split at the
parameters where visibility changes. A drawing is presentation: a torus
silhouette approximated with a stated tolerance and a label satisfies
AGENTS.md; nothing here may feed geometry back into modeling. Low priority.

### P12. Stable indices for pick and hints

cad_khana resolves viewer selections by OCCT `TopExp.MapShapes` order
(`pick.py:28-39`), stable only per pushed snapshot (`pick.py:9`). wonky does
not reproduce OCCT's edge order or direction (`python/_b3d_query.py:34-45`),
so OCCT indices cannot be matched, but wonky has something better: every
body, face, edge and vertex carries an identity with origin, instance,
revision, role and lineage (`kernel/identity.bend:6-19`,
`docs/topology-identity.md`). `describe_face/edge/vertex` and
`face_relations` should take identities (or viewer indices into wonky's own
topology order plus the body revision) and answer with P6, P9 and P2.
`match_hint` is a regex table over error text (`hints.py:1-44`) and needs no
kernel.

---

## 5. What is exact, what is bounded

Proposed unified labels for every cad_khana measurement (they extend, and must
stay compatible with, `src/volume.mjs` labels `exact | quadrature |
carrier-quadrature | mesh-estimate` and the body labels `regularized |
quantized | approximate` of `src/exactness.mjs:1-17`):

| label | meaning | examples |
|---|---|---|
| `exact` | closed form evaluated in F32x2; the answer carries an arithmetic allowance (rule stated, as `boundRule` in `src/volume.mjs:121`) | plane/cylinder/sphere distances, coaxial clearances, volume of plane/cyl/cone bodies, convexity of a line between planes |
| `bounded` | a certified interval `[lo, hi]`; width stated; no point estimate is ever called exact | 1-D certified search (circle–circle), mesh branch-and-bound, quadrature volumes/areas |
| `approximation` | computed on an approximate representation (a certified-mesh body); deviation stated | distance to a `geometry: 'mesh'` body |
| `estimate` | sampled, no certificate (allowed only for advisory printability numbers, never for an assertion) | ray-sampled wall thickness |
| refused | capability error naming the stage and the face/edge | torus faces without a meridian, undecided near-tangency |

Every record also lists the input bodies' own labels: a distance between two
`quantized` bodies is exact *for the bodies as represented*.

**Assertion decisions** (cad_khana compares raw floats): with an interval,
`clearance ≥ min` passes when `lo ≥ min − ε`, fails when `hi < min − ε`, and is
undecided otherwise; `ε` is a stated decision tolerance (open question O2,
proposal: build123d's `TOLERANCE = 1e-6 mm`). An undecided result refines (6.4)
and then refuses with the interval in the message. This makes
`min_mm=0.20-1e-6` workarounds unnecessary: the coaxial pin/bore gap is the
closed form `1.75 − 1.5 = 0.25` exactly.

---

## 6. Design: minimum distance

### 6.1 Semantics

`distance(A, B)` is the **solid** distance: 0 when the closed solids
intersect, including when one contains the other; otherwise the boundary
distance. This deliberately differs from OCCT's Part behaviour (nested cube:
8.0, section 2) and is decided with one extra membership test (6.2 step 4).
The answer:

```
type Cell is Data:
  VertexCell{vertex: U32}
  EdgeCell{edge: U32, parameter: R.Real}
  FaceCell{face: U32}

type Relation is Data:
  Separated{}          # lo > 0
  Crossing{}           # boundaries intersect transversally somewhere (distance 0)
  Contact{}            # distance 0, no transversal crossing found (section 7 decides)
  Nested{inner: U32}   # 0 = A inside B, 1 = B inside A

type Distance is Data:
  Measured{lo: R.Real, hi: R.Real, a: G.Vec3, b: G.Vec3, cell_a: Cell, cell_b: Cell,
    relation: Relation, method: U32, pairs: U32}
  DistanceRefused{code: U32, cell_a: U32, cell_b: U32}
```
`method`: 0 closed form over every surviving candidate (`exact`), 1 some
candidate needed the certified 1-D search (`bounded`), 2 mesh bounds only
(`bounded`), 3 certified-mesh body (`approximation`). The witness points
`a`, `b` are real surface points of A and B (an upper bound is always the
distance of an actual pair), with the cells mapped to identities by the host
for the viewer and for `describe_*`.

### 6.2 Exact path: stratified enumeration

On compact stratified sets the minimum of the distance is attained at a pair
of points `(p, q)` whose cells (open face, open edge, vertex) make `(p, q)` a
local minimum of the distance restricted to those cells [inferred, standard
Lagrange argument]. Hence:

1. **Cells** of each body: vertices, edges (curve + parameter range: the
   `curveRange` or the vertex parameters, `analytic.bend:283-289`), faces
   (carrier + trim).
2. **Broad phase**: a BVH over cells of A and B with conservative boxes
   (P10 boxes, or carrier-bounded boxes grown by the arithmetic allowance) and
   branch-and-bound on the current upper bound `hi`: a cell pair whose box
   distance exceeds `hi` is dropped. `hi` starts from any vertex pair or from
   the mesh path (6.4). The BVH is `clear.bend`'s Morton tree (`:255-355` [U])
   generalized from triangles to cells, with the join changed from "all pairs
   under a fixed threshold" (`cross`, `:519-560`) to "pairs under the shrinking
   best bound" (one more accumulator field).
3. **Narrow phase** per cell pair: the local minima of the carrier-level
   distance (table 6.3), kept only when every point lies in its cell (edge
   parameter in range; face point inside the trimmed face, P4). A continuum
   of equal-distance pairs (parallel planes, coaxial cylinders, concentric
   circles/spheres, a line parallel to a plane) is **not** enumerated: if the
   continuum meets both cells, its minimum distance is also attained on a
   lower-dimensional pair (a vertex over the other face, or two crossing
   boundary curves), which the enumeration visits anyway [inferred: the region
   of the continuum inside both trims is closed and its relative boundary lies
   on a trim boundary]. The only exception is a pair of faces without any
   boundary (whole sphere, whole torus), answered directly.
4. **Nesting and crossing**: if `lo > 0`, one membership test of any vertex
   (or face point) of A against B and of B against A decides Separated vs
   Nested (P4). If some pair has distance 0, the pair's local configuration
   (transversal crossing vs tangency/coincidence, decided by the exact
   certificates `intersections.bend:243,253`) gives `Crossing` or `Contact`.
5. Result: `lo = hi = min candidate` when every surviving pair was closed
   form (method 0), else `[min lo, min hi]` (method 1).

> **Correction (task `revise`, 2026-09-24).** Steps 3 and 4 do not hold as
> written. A transversal crossing along a closed curve inside both faces
> touches no lower stratum, so `lo > 0` and the vertex test can report
> `Separated` for overlapping bodies (boss r 10 and pin r 3 clipping 2 mm,
> seams at +x and +z: every edge at least 1.0 mm from the other body;
> review-exactness.md B2, measured). The design therefore runs an explicit
> face-face crossing test before the nesting test and decides contact with
> tolerant families instead of the exact certificates (design.md 4.2 Q7, Q13;
> 5.1). The measurements of this section stand.

### 6.3 Closed forms, pair by pair

Every carrier pair reduces to few cases because three carriers are offsets
of simpler ones: a cylinder is the `r`-offset of its axis line, a sphere of its
centre, a torus of its core circle. For the local minimum outside the offset
tube, `dist(X, offset_r(C)) = dist(X, C) − r`, and the foot point moves from
`C` along the connecting segment by `r` [inferred; valid while the result is
positive and the foot lies on the offset side facing `X`; the torus needs
`minor < major`, which the recovered ring tori satisfy, spindle tori are
refused like `volume.bend` code 3, `:104`].

Local minima of the squared distance on each **carrier** (one per carrier
outside degenerate continua):

| from a point to | foot point | exact? | continuum when |
|---|---|---|---|
| line | `o + ((p − o)·d) d` | closed form | – |
| circle | radial projection in the circle plane | closed form | `p` on the axis |
| ellipse | root of a quartic in the half-angle | **bounded** (6.5) | `p` on an axis (several local minima) |
| plane | `p − ((p − o)·n) n` | closed form | – |
| cylinder | axis foot + `r` radially | closed form (offset of line) | `p` on the axis |
| cone | nearest point on the generator in the meridian half-plane of `p`, or the apex | closed form (2-D point–segment in (ρ, h)) | `p` on the axis |
| sphere | centre + `r` toward `p` | closed form | `p` = centre |
| torus | nearest point of the core circle + `minor` toward `p` | closed form (offset of circle) | `p` on the axis or on the core circle |

Pairs (V–V, V–E, V–F from the table; the rest):

| pair | closed form | reduces to | otherwise |
|---|---|---|---|
| line–line | skew: common perpendicular; parallel: continuum | – | – |
| line–circle | coplanar or through the axis: closed | – | quartic: **bounded** (6.5) |
| circle–circle | coaxial, coplanar, or one centre on the other's axis: closed | – | degree 8 in general: **bounded** (6.5) |
| ellipse–anything | ellipse–plane (extremes of a linear function on an ellipse): closed | – | **bounded** (6.5) |
| line / circle / ellipse – plane | closed (line parallel: continuum; circle: `abs(d) − R·sqrt(1 − (a·n)²)`) | – | – |
| edge – sphere | point–edge distance of the centre, minus `r` | V–E | – |
| edge – cylinder | edge – axis line, minus `r` | E–E with a line | circle–cylinder skew: line–circle (bounded) |
| edge – torus | edge – core circle, minus `minor` | E–E with a circle | line/circle–torus: bounded |
| edge – cone | coaxial circle: closed | – | 1-D over the edge parameter with the point–cone closed form: **bounded** |
| plane–plane | parallel: continuum; else they meet | – | – |
| plane–cylinder / sphere / torus | axis-parallel cylinder, sphere, torus: closed | offset reduction | cylinder not parallel: meets the plane |
| plane–cone | closed (distance to the generator nearest the plane) | – | – |
| cylinder–cylinder | axes skew or parallel: `d(axes) − r1 − r2` | line–line | – |
| cylinder–sphere, sphere–sphere, sphere–cone, sphere–torus | closed | point–carrier | – |
| cylinder–torus | coaxial: closed | line–circle − r − minor | bounded |
| torus–torus | coaxial: closed | circle–circle − minor1 − minor2 | bounded |
| cone–cylinder, cone–cone, cone–torus | coaxial: closed | – | 1-D over one generator angle with the line–X closed form: **bounded** |

So the only non-closed-form kernels are: point–ellipse, line–circle,
circle–circle, ellipse pairs and the cone generator families. All are 1-D
problems over one curve parameter (or one generator angle) with a closed-form
inner function.

> **Correction (task `revise`, 2026-09-24).** The last row and the sentence
> above are wrong for cone–cone and cone–torus: there is no closed-form
> line–cone or line–torus distance (this table itself makes edge–cone a 1-D
> search), so the face-interior minimum is a 2-D search. Cone–cylinder stays
> 1-D (the inner function is the closed-form line–cylinder distance). The
> design leaves face-interior cone–cone pairs `unresolved` in v1 and cone–torus
> to K17b (design.md 4.2 Q6, 5.1; review-exactness.md M2).

Internal (nested-surface) configurations, a pin inside a bore, are not the
offset's "outside" case: the local minimum there is `r_bore − (d(axes) + r_pin)`
for parallel axes (closed form), and in general the far foot of the offset
[inferred]; the table's reductions must carry the side (outside/inside) as a
parameter, which the outward normals of the two faces fix.

### 6.4 Bounded path: certified tessellation + BVH + refinement

Available whenever `printMesh` covers both bodies (P5), and the only path for
certified-mesh bodies.

1. Per-face certified meshes with two-sided deviations `δ_f` (P5 (d): per face,
   not watertight).
2. `clear.bend`'s two-tree join (`close2`, `:682-699`), changed to a
   minimum query: track the best `d_mesh`, prune node pairs whose box
   distance minus `δ_max` exceeds it.
3. `lo = d_mesh − δ_a − δ_b − ε_tri`, `hi` = exact distance of the two mesh
   points projected back onto their tagged faces (a real pair, so an upper
   bound) when both projections land inside their faces, else
   `d_mesh + δ_a + δ_b + ε_tri`.
4. `ε_tri`, the rounding of the triangle/triangle distance: clear.bend's F32
   allowance (`1e-6 ×` extent, `:413-416`) is not proven. For a certificate the
   final candidates must be recomputed in F32x2 (`R.Real`), keeping F32 only
   for culling with boxes grown by a proven bound [inferred requirement].
5. **Narrow-phase selector**: every face pair with `triangle lo < hi` goes to
   the exact path (6.2 step 3). When all of them are closed form the result
   is `exact` (method 0) although it started from a mesh. When a face pair is
   not covered, refine: re-mesh only those faces at `δ/4`, repeat with fuel;
   exhaustion refuses with the interval.

Watertightness is irrelevant for distance, so the shared-count rule of
`printMesh` (`print-mesh.mjs:13-20`) does not apply here [inferred].

### 6.5 The certified 1-D search

For `f(t) = dist(c(t), X)` (or the squared distance) on `[t0, t1]` with a
closed-form `f` and a computable Lipschitz or interval bound: branch and bound
by bisection, an interval is dropped when its lower bound exceeds the best
upper bound found so far (a sample value), fuel `Nat` (for example 40 levels:
`2^-40` of the range), all evaluation in F32x2. Output `[lo, hi]` with the
remaining width. Lower bounds per interval: `f(mid) − L·w/2` with `L` from the
curve's speed (a circle: `R`; an ellipse: its major radius) and the inner
function's 1-Lipschitz property (a distance is 1-Lipschitz in the point)
[inferred]. The same routine isolates the torus quartic roots for P3 (search
sign changes of the implicit function along the line). This is simpler under
Bend limits than Sturm sequences or Bernstein subdivision (no polynomial
algebra, no mutual recursion, one fuel parameter), and `volume.bend`'s
`adapt`/`judge` (`:696-735`) already shows the pattern.

### 6.6 Bend layout and limits

| module | content | size hint |
|---|---|---|
| `kernel/measure/foot.bend` | point→carrier and point→curve feet (6.3 first table), `normal_at` (P6) | small |
| `kernel/measure/search.bend` | the certified 1-D search (6.5) | small |
| `kernel/measure/pairs.bend` | cell-pair narrow phase: closed forms, offset reduction, calls into search | medium; split by pair family so no definition approaches the "arity over 255" limit |
| `kernel/measure/cells.bend` | cells, boxes, Morton BVH, best-bound join (from `clear.bend`) | medium |
| `kernel/measure/distance.bend` | `distance(a, b, tol) -> Distance`, nesting/contact (6.2 step 4) | small |
| `kernel/{cone,sphere,torus}-classification.bend` | P4 | as cylinder-classification (458 lines) |

Performance [inferred]: cells per simple part are tens to hundreds; the broad
phase leaves tens of narrow pairs; each closed form is a few hundred F32x2
operations, cheaper than one solid classification (6-11 ms measured for 5
rays × all faces). Assemblies: `n(n − 1)/2` pairs, first rejected by body
boxes separated by more than the requested clearance (the rule wonky already
uses for n-ary Booleans, `src/python.mjs:103-116`), then cached by the pair of
body revisions (`body.identity.revision`, `docs/topology-identity.md`), so a
rebuild re-checks only changed parts. Measure JS and native separately
(AGENTS.md).

---

## 7. Design: interference and contact

`interference(A, B)` built from section 6:

1. Body boxes separated → `Disjoint`, volume 0, `exact`.
2. `distance(A, B)`: `Separated` → volume 0 `exact` with the distance as
   evidence. No Boolean runs for the common case of non-touching parts.
3. `Nested` → the inner body's volume (P7), `exact`/`quadrature`.
4. `Crossing` → INTERSECTION Boolean (P1) + volume (+ centroid, P1 gap 2).
   The Boolean may be the hybrid (task 10) and return a certified-mesh body
   (label `approximation`).
5. `Contact` → the **contact certificate**: the interiors are disjoint iff
   every zero-distance pair is a coincident or tangent contact with opposite
   outward normals and no transversal crossing exists [inferred for regular
   closed solids with manifold boundary]. Decided exactly for the analytic
   contact families: coplanar faces with opposite normals (face contact),
   cylinder or cone tangent to a plane along a ruling, parallel cylinders
   touching, a pin in a bore of equal radius (coaxial coincident cylinders),
   sphere tangencies, all with the existing exact certificates. Certified →
   volume `[0, 0]` `exact`. Undecided (near tangency) → refuse with the
   stage, never a guess.

cad_khana's `0.001 mm³` epsilon can be kept for parity (pass when
`hi ≤ 0.001`), but the kernel reports the interval and whether the contact is
certified; a wonky assertion should prefer "certified disjoint interiors" over
an epsilon whose depth tolerance depends on contact area (section 2).

---

## 8. Improvement ideas at kernel level

1. Clearance as an interval with a stated decision tolerance: nominal fits
   (0.25 mm gap) pass on nominal geometry; no `min_mm − 1e-6` workarounds.
2. Solid semantics: nested parts have distance 0 (OCCT Parts report the
   boundary distance and let `assert_clearance` pass).
3. Contact certificate: touching faces give interference `[0, 0]` exactly, not
   "below 0.001 mm³".
4. Closest-point witnesses with identities (face/edge/vertex of each part),
   ready for the viewer and for `describe_*`.
5. Convexity from coedge orientation, exact, for every edge type: sharp rims
   of cylinder bosses and bore edges become visible (cad_khana checks LINE
   edges between planes only).
6. Printability from exact geometry: overhang angle and area per face from
   carrier normals (planes exact; cylinder/cone overhang regions are bounded by
   rulings, sphere regions by a parallel: exact areas), wall rays from exact
   surface samples with analytic normals, exact wall thickness for opposing
   parallel planes and coaxial cylinders, bores (concave cylinder:
   `same_sense` against the radial direction, no `center()` probe), pins
   (two loops winding around the axis, no 5.2 rad heuristic), bridges anchored
   by face adjacency instead of `is_inside` probes.
7. One tessellation (printMesh with tags + analytic normals) for display,
   export, GLB and analysis, with its deviation stated.
8. Shared primitives with FeatureScript: `evDistance`, `evArea`,
   `evEdgeConvexity`, `evFaceTangentPlane`, `evSurfaceDefinition` become thin
   wrappers of P2, P9, P8, P6.
9. Exact tight boxes for curved bodies (today refused in Python and
   `evBox3d`).
10. Pair cache keyed by body revisions: an assembly re-check after an edit
    touches only the pairs with a changed part.
11. A multi-shell body format so that enclosed voids are a real finding
    instead of a refused Boolean.

---

## 9. Dependencies on the r20-gate hybrid Boolean

| item | depends on | why |
|---|---|---|
| interference volume of overlapping curved non-convex pairs | **task 10** (hybrid INTERSECTION, `local design note`, `:498`) [U] | only the hybrid covers them; results may be certified-mesh bodies (task 11) |
| any volume of a recovered or intersection body | `kernel/volume.bend`, `src/volume.mjs` [U, untracked] | P1, P7 |
| certified-mesh bodies (`approximation` label) | task 11 [U] | distance/volume on `geometry: 'mesh'` |
| mesh distance path, face-typed tessellation for arcs and sphere/torus zones | task 7 (`kernel/tessellate.bend`, `src/print-mesh.mjs` [U]) | P5 |
| BVH and triangle distance reuse | `kernel/hybrid/recover/clear.bend` [U] | 6.4 |
| sphere/torus support anywhere | Sphere/Torus in `kernel/analytic.bend` [U] | carrier data |
| tangent contact | task 12a `prism-boolean` / KS04 (`local design note,487`; recover refuses by design) | the contact certificate (section 7) must come from the distance module, not from the hybrid |

Independent of r20 (can start on committed HEAD): exact distance for plane,
cylinder and cone bodies (6.2-6.3, 6.5); cone/sphere/torus membership (sphere
and torus need the carrier types); `ray_hits`; edge convexity; face area,
centroid and angular extent; tight boxes; identity-based pick.

---

## 10. Coverage of every public cad_khana name

Public names from `grep` over the upstream modules (appendix A). "kernel" is
the primitive of section 4 the name needs; "host" means no kernel primitive
(serialization, CLI, files, viewer); wonky's current behaviour is in
`docs/python-khana.md`.

| module | public names | kernel primitives |
|---|---|---|
| `mechanism.assembly` | `Assembly`, `PlacedPart`, `SubAssembly`, `RevoluteJoint`, `DetailOverride` | host (placement is build123d `Location` in the shim; exact Bend copies) |
| `mechanism.assertions` | `NoInterference`, `ExpectedInterference`, `evaluate` | P1, P2, section 7 |
| | `Clearance` | P2 |
| `mechanism.diagnostics` | `compute`, `Interference` | P1 (+ centroid), P2 broad phase |
| | `PartDiagnostics`, `BBox` | P10, P7, P9 (area), P1 gap 2 (centre of mass), counts (host), `is_valid` = validation scope (3.1) |
| | `Diagnostics`, `AssertionResult`, `SCHEMA_VERSION` | host |
| | `INTERFERENCE_VOLUME_EPSILON_MM3` | section 7 decision |
| `mechanism.check` | `check`, `CheckResult` | P1, P2 via assertions; exports host |
| `mechanism.pick` | `describe_face` | P6, P9, P12 |
| | `describe_edge` | curve data (exists), length (host has it for Python `edges`), P12 |
| | `describe_vertex` | P12 |
| | `face_relations` | P6 (certificates), P2 face–face |
| `mechanism.hints` | `match_hint` | host (regex) |
| `printability.inspect` | `inspect`, `PrintabilityDiagnostics`, `EPS` | all printability rows below; `volume_mm3` P7, `surface_area_mm2` P9 |
| `printability.methods` | `FDM` | host |
| `printability.wall` | `min_wall`, `min_wall_mm` | P3 (`ray_hits`), P5 samples, P6 normals |
| | `RAY_OFFSET_MM`, `SLIVER_HIT_DISTANCE_MM` | P3 parameters |
| `printability.overhangs` | `detect_overhang`, `Overhang` | P5 (tags), P6 normals, P10 (plate level), idea 6 exact areas |
| | `BUILD_PLATE_EPSILON_MM` | P10 |
| `printability.holes` | `detect_bores`, `Bore`, `bore_face_radius` | P6 (carrier, concavity from `same_sense`), P10 (face box) |
| | `tessellate_tagged`, `FaceTag` | P5 + P6 + P10 per face |
| | `self_supporting` | P10 (face box), P4 (anchor probes) or face adjacency (idea 6) |
| | `VERTICAL_DOT`, `HORIZONTAL_DOT`, `SMALL_BORE_MM`, `BRIDGE_MAX_MM`, `CEILING_DOT`, `PLATE_TOUCH_MM` | thresholds (host) |
| `printability.pins` | `detect_pins`, `Pin` | P6, P9 (angular extent/winding), P10 |
| | `MIN_PIN_DIA_MM`, `SLENDER_RATIO`, `FULL_SWEEP_RAD` | thresholds; `FULL_SWEEP_RAD` replaced by winding (P9) |
| `printability.structure` | `enclosed_voids` | P7 (needs multi-shell format; today 0 by construction) |
| | `floating_solids` | P7 (bodies per part + volumes) |
| | `sharp_vertical_edges`, `sharp_rim_edges` | P8 |
| | `VERTICAL_DOT`, `HORIZONTAL_DOT`, `SHARP_INTERIOR_DEG`, `MIN_EDGE_LEN_MM` | thresholds (host) |
| `printability.orientation` | `suggest_orientation`, `score_orientation`, `OrientationScore` | P5, P6, P10, detect_bores |
| | `CANDIDATES`, `PLATE_TOL_MM` | host |
| `core.tessellation` | `Triangle`, `TESSELLATION_TOLERANCE_MM`, `TESSELLATION_ANGULAR_TOLERANCE` | P5 (wonky states an achieved deviation instead of an angular tolerance) |
| `draw` | `draw`, `View` | P11, P5 |
| | `set_auto`, `auto_enabled`, `auto_out`, `auto_fmt`, `auto_themeable`, `auto_views`, `auto_part`, `VIEW_PRESETS`, `DEFAULT_VIEW_NAMES`, `STANDARD_VIEWS`, `CAMERA_DISTANCE_FACTOR`, `IMAGE_SIZE_PX`, `SUPERSAMPLE`, `MARGIN_FRACTION`, `VISIBLE_COLOR`, `HIDDEN_COLOR`, `LINE_WIDTH_PX`, `CURVE_SAMPLES` | host (settings, raster); `CURVE_SAMPLES` is a polygonization of conics for display only |
| `export` | `export_assembly` | host (wonky STEP/STL writers exist) |
| | `export_glb`, `export_animated_glb` | P5 (+ tags, colors); animation host |
| `viewer` | `push`, `set_auto`, `auto_enabled` | host (wonky viewer), P5 |
| `environment` | `probe`, `ViewerStatus`, `EnvironmentReport` | host |
| `diff` | `diff` | host (compares JSON); idea 10 makes it identity-aware |
| `cli` | `build`, `check`, `view`, `draw`, `pick`, `status`, `diff`, `main` | host (commands over the above) |
| `_paths` | `resolve_out` | host |

---

## 11. Open questions

- **O1** Clearance semantics: solid distance (nested = 0, proposed) or OCCT
  parity (boundary distance)? Parity oracle: `tmp/khana/oracle/probe/`.
- **O2** Decision tolerance for clearance/interference comparisons
  (proposal 1e-6 mm, build123d `TOLERANCE`), and whether undecided results
  refine automatically or refuse at once.
- **O3** Keep `0.001 mm³` for parity, or make certified contact the pass
  criterion (and report both)?
- **O4** The F32 triangle/triangle allowance in `clear.bend` (`:413-416`) is
  unproven; certify it or recompute final candidates in F32x2.
- **O5** Face centre: area centroid (proposed, exact) vs OCCT's
  parameter-midpoint point (not reproducible without OCCT's
  parameterization).
- **O6** The two-sided deviation claim of every `printMesh` face kind needs a
  test before the mesh distance path is called certified.
- **O7** Multi-shell bodies (voids): body format change owned by the modeling
  side, not by cad_khana.
- **O8** Native build: which new ops go into the wire first, and whether the
  services (classifiers) finally join the native build (today they never
  load there, `src/index.mjs:15-22`).
- **O9** The offset reductions of 6.3 and the "continuum is covered by lower
  strata" argument of 6.2 are reasoning, not tests; each needs a property
  test against the parity oracle (real cad-khana on copies, never feeding the
  kernel).

---

## Appendix A. Evidence

Commands (2026-09-24, load average about 5 on 18 cores):

```sh
git -C <repo> log --oneline -1   # d917992
git status --short kernel/volume.bend src/volume.mjs kernel/hybrid kernel/proto/fillet-kpart \
  kernel/analytic.bend kernel/ray.bend kernel/tessellate.bend src/print-mesh.mjs src/kernel.mjs src/analytic.mjs
#  M kernel/analytic.bend, M kernel/ray.bend, M kernel/tessellate.bend, M src/print-mesh.mjs,
#  M src/kernel.mjs, M src/analytic.mjs, ?? kernel/hybrid/, ?? kernel/proto/fillet-kpart/,
#  ?? kernel/volume.bend, ?? src/volume.mjs
node tmp/khana/kernel-gaps/perf-probe.mjs   # log: local-development-evidence
```

`tmp/khana/kernel-gaps/perf-probe.mjs` output (JS target, warm unless
stated):

| measurement | result |
|---|---|
| `loadKernel()` with the Bend cache | 985 ms |
| first `classifySolid` (loads face + solid classifier) | 2462 ms |
| `classifySolid`, 6-face box, 4 mixed points | 10.6 ms per call (n = 20) |
| `classifySolid`, cylinder r5 (2 planes + 1 cylinder) | 6.3 ms per call (n = 20) |
| `classifySolid`, cone frustum | `Unresolved UnsupportedSurface` on face 2 |
| `integrateVolume` box / cylinder / cone frustum (fresh copy, uncached) | 0.73 / 0.79 / 0.58 ms; 192.000000000000 / 785.398163397447 / 408.407044966673 mm³, bounds 7e-10 / 2.9e-9 / 1.5e-9 mm³, label `exact` |
| `printMesh` cylinder r5 × 10, deviation 0.1 / 0.01 / 0.001 mm | 64 / 200 / 632 triangles, achieved 0.0961 / 0.00987 / 0.000988 mm, 1.4 / 2.2 / 6.1 ms, tags on 3 faces |
| `printMesh` cone frustum, same deviations | same counts and deviations, 1.0 / 2.3 / 6.1 ms |

Upstream public names: `grep -E "^(def|class) [A-Za-z]|^[A-Z][A-Z0-9_]+ *[:=]"`
over every module of `~/Workspace/cad/cad-khana/src/cad_khana` (read only);
the list is section 10.

Sibling evidence used: local development evidence steps 4-5
(OCCT numeric probes with the installed `khana` 0.0.2, outputs in
`tmp/khana/oracle/probe/` and `tmp/khana/oracle/pick/`).
