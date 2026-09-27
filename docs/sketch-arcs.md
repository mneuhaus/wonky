# Analytic line/three-point-arc sketch extrusion

`kernel/sketch-arcs.bend` assembles one simple closed 2D loop containing straight
segments and circular arcs. It interpolates each circle through its original
three points, computes finite native curve domains, and extrudes the loop into
a shared-edge plane/cylinder B-rep. Circle fitting, incidence decisions, ordering,
intersection checks, topology, area and volume execute in Bend. No boundary is
replaced by a polygon or mesh. OpenCascade only reads exported STEP artifacts
as an independent test oracle.

The frozen `M3_HYBRID_ARCS` in `fixtures/r10b/r10b.fs` is an admitted input. This
capability alone does not implement its subsequent Booleans, entry relief,
revolve or the complete `singleStepR10b` feature. FeatureScript `skArc`, mixed
`skLineSegment`/`skArc`, `skSolve` and normal `opExtrude` calls are integrated.
The unchanged `m3HybridTool` helper produces an exportable body with entry
relief disabled. Requesting entry relief still fails at its missing
`opRevolve` call after completing the analytic core; no operation is skipped.

## Admission

- 2–1024 entities (`entity_limit()`, see "Admission cost"), each a line or
  three-point circular arc with a distinct U32 source index. Coordinates are planar, finite, representable and within
  ±10,000 mm. The serializer keeps the evaluated SI binary64 identity words and
  separate millimetre Real prefix/remainder words used by the existing line
  profile contract.
- One closed connected walk, exactly two incident entities at every endpoint.
  Every original endpoint must have exactly one other incident endpoint within
  the predetermined native resolution, including when two candidates belong
  to the same other entity. Ambiguous junctions, missing endpoints,
  multiple loops, holes and zero or unresolved short entities are rejected.
- Noncollinear three-point arcs with positive resolved radius and a finite
  interval shorter than one turn. Major arcs are admitted. A full circle can be
  represented by two complementary arcs; equal start/end on a single arc is
  rejected.
- Analytic finite-domain line/line, line/circle and circle/circle pair tests must
  exclude crossings, overlapping intervals and non-endpoint contacts. Near
  parallel or near tangent cases without a resolved exclusion or a unique
  prescribed endpoint contact are rejected. A tangent prescribed contact is
  admitted when the analytic tangent point itself agrees with both original
  endpoints within the fixed resolution (except a cusp, which only the
  near-tangent join rule admits), or when it is a
  near-tangent join of the two adjacent entities under the rule in
  "Near-tangent joins" below (smooth joins; cusps at an exact join whose
  second contact is certified within `2^-36 * S` of it, the carriers' own
  error included, see "Conditioned cusps"). A square-root neighbourhood is used only to conservatively reject
  uncertain trim exclusions and to delimit that join rule, never to enlarge
  endpoint incidence. Almost coincident circular supports require disjoint finite
  parameter intervals; overlapping intervals are rejected.
- Lines that are parallel within the angular guard and lie within
  `resolution + drift` of one line are decided by their connected parameter
  intervals, with the containment margin widened by the drift
  (`drift = |cross(directions)| * longer length`); overlapping or touching
  intervals are rejected, disjoint ones are clear. Before 2026-09-24 only an
  exactly parallel pair (cross product 0) got the interval test and every
  other near-collinear pair was rejected. That refused the two radial edges of
  a 180° sector (R20 datums D03: `sin(180°)` leaves y = 1.66e-14 mm on one of
  them, 270 mm away from the other) and the opposite radial flanks of a gear.
- A finite nonzero extrusion parallel or antiparallel to the sketch normal.
  Bend normalizes the frame directions and checks orthogonality and the sweep.
  Zero depth, oblique sweeps and invalid frames are explicit unsupported paths.
  Construction entities are unsupported. Constraint solving and arbitrary
  spline geometry are outside this capability.

The two endpoints used to parameterize each line or circle are chosen
lexicographically. The walk begins at the least original endpoint and is
counterclockwise. Input permutation and independent reversal of entity
directions preserve the resulting geometry, including native curve frames and
topology order. Original source entities and direction provenance remain in
the solved profile.

## Near-tangent joins

Laser DXF files join lines and arcs tangentially, but the written
coordinates carry tangency noise: in the R20 top plate
(`fixtures/sketch/topplate-raw-dxf-loops.json`, 43 outline entities and 23
through loops, joins shared bit-identically) the tangent point F of a
line/arc pair lies up to 4.7e-10 mm off the shared join J (`CUT_OUTER` 8/9),
and with the coordinates rounded to 1e-9 mm up to 5.8e-9 mm off (up to 21 times the
resolution `1e-12 * S`). Until 2026-09-25 the pair test demanded
`|F - J| <= resolution` and refused such loops with `SelfIntersectionOrTouch`
(raw: `CUT_THROUGH[21]` (5,4); rounded: `CUT_OUTER[0]` (38,39),
`CUT_THROUGH` 14, 18, 21). The CAD side's exact-tangent rebuild
(`topplate-exact-tangent-loops.json`, joins moved at most 1.3e-10 mm) was
admitted.

Derivation. The pair test is in its near-tangent branch when the carriers'
distance at F is within resolution (`|gap| <= resolution`). The carriers meet
in J (an endpoint of both, within resolution) and in the second root
`X = 2F - J`, `|X - J| = 2 |F - J|`. Their roots are ill conditioned there:
a change of resolution in the data moves them anywhere within
`2 sqrt(resolution * relative)` of F, where `1 / relative` is the pair's
relative curvature (`1/r` line/circle, `1/r1 + 1/r2` external,
`|1/r1 - 1/r2|` internal tangency). `reach = 8 sqrt(resolution * relative)`
covers that neighbourhood seen from J when F lies within `reach / 2` of J,
and `reach < min radius` keeps it local. `kernel/sketch-arcs-intersections.bend`
`join_clear` admits the pair when J is shared within resolution, F is within
`reach / 2` of J (with the carriers' error bound added, see "Conditioned
cusps"), reach is local, neither interval comes back past J within
reach (no near-full arc wraps round), and either

- the join is **smooth**: the two finite segments leave J in opposite tangent
  directions. Inside the neighbourhood one segment lies before J and the
  other after it, so J is their only contact wherever the roots fall; X lies
  beyond J outside one finite interval. The loop encloses no sliver and its
  region is the given one. No length enters, so the decision is monotonic
  in the tangency error: a larger error leaves the near-tangent branch and
  becomes an ordinary corner, which the root test admits as before; or
- the join is a **cusp** (both leave J the same way, a horn tip like
  `CUT_OUTER` 10/11 and 30/31) and `|X - J| <= 2^-36 * S`, certified as
  `2 |F - J| + drift <= 2^-36 * S` with the computed F and the carriers'
  error bound `drift` ("Conditioned cusps"). X lies in both
  segments (a crossing) or in neither. The sliver between J and X is at most
  `|gap| <= resolution` wide and shorter than `2^-36 * S`, the kernel's
  length below which two points are one vertex (the hybrid Boolean's
  short-edge collapse and tie tolerance, `docs/proto-corefine.md`). The
  second contact is therefore the join at the kernel's length resolution, and
  the region is unchanged at resolution (sliver area below
  `resolution * 2^-36 * S`). Here S is the sketch scale of `solve` (maximum
  coordinate magnitude, at least 1; `short_length` recovers it as
  `resolution / angular_guard`). A cusp whose second contact lies farther
  away stays `SelfIntersectionOrTouch`, also when X happens to lie in neither
  segment, because the root positions are not resolved in this branch. The
  cusp case further needs an exact join (see "Join gap").

Join gap. `X = 2F - J` holds only when J is a root of both carriers. The
carriers are the line through a line's two points and the circle through an
arc's three points, so a join whose two endpoints are one input point lies on
both by definition (how well the computed F then locates X is the subject of
"Conditioned cusps"). "One input point" is the kernel's endpoint identity
(`L.point_equal`: equal SI words, F32x2 prefix and remainder,
`docs/sketch-lines.md`), not an equal prefix. Two different input doubles can
share a prefix and differ only in their remainders, a gap of up to about
`2^-48 * S`: before 2026-09-25 (round 4) the cusp rule compared prefixes
only and admitted a vertical line at x = 250.29999999999987 mm against an arc
of radius 20 starting at x = 250.3 mm (one prefix, gap 1.4e-13 mm), whose
carriers cross strictly inside both entities 655 times `2^-36 * S` from the
join; with the line's join 4 ulps away (a different prefix) it was refused, so
the verdict depended on F32x2 rounding. Such a join is a join gap. The
carriers the kernel builds from the prefixes lie within the remainders
(`<= 2^-48 * S`) of the input carriers, inside the carrier error `e` below.
When
the endpoints differ (joined within resolution, a join gap), the carriers are
separated at J by some g with `|g| <= resolution`, and the far root lies
`|F - J| + sqrt(|F - J|^2 + 2 relative |g|)` from J. Showing that below
`2^-36 * S` needs `|g| < (2^-36 * S)^2 / (2 relative)`, about `2^-73 * S` for
`relative ~ S`, far below the rounding of any computed distance. A cusp at a
join gap is therefore refused as `SelfIntersectionOrTouch` with its pair,
whether F lies near J or not (before 2026-09-25 the `shared` test admitted it
when F was within resolution of both endpoints). Example: a line `y = c`,
`c = 0.9 * resolution`, ending at `(0, c)` against an arc of radius 8 from
`(0, 0)` along +x; the carriers cross at `x = sqrt(16 c)`, 7.6e-6 mm or about
1.3e5 times `2^-36 * S` from the join at S = 4. Smooth joins do not use the
common root and stay admitted at a join gap. The R20 plate's joins are shared
bit-identically (raw, rounded and exact-tangent variants), so its cusps
qualify.

Conditioned cusps. At an exact join the second root is `X = 2F - J` of the
*exact* carriers, but the kernel computes F from its own carriers (F32x2
reals). A carrier whose tangent at J turns by t moves the foot of a circle
centre on a line by `r t`, and the line through two circle centres, where it
passes J, by `relative (t_a + t_b)` (external: J between the centres;
internal: J beyond both, the centre-line error extrapolated by
`r_i / |r1 - r2|`). Only this move along the common tangent changes X; an
error of F along the centre line only lengthens the computed `|F - J|`. So
`|X - J| <= 2 |F - J| + drift`, `drift = 2 relative_hi e (tilt_a + tilt_b)`:

- e is how far the computed carrier may lie from the exact carrier through
  its input points, as a displacement of those points: `2^-44 * S`, the
  kernel's F32x2 convention (each operation errs below `2^-44` of its
  operands, `kernel/hybrid/unify.bend`). The first operations subtract input
  coordinates of magnitude up to S and dominate.
- tilt (`P.Segment`, first order in e): a line through a and b turns by at
  most `2e / |ab|`, so tilt `= 2 / |ab|`. The circle through a, m, b meets
  the chord ab at a or b under the angle `pi - angle(a m b)`, so its tangent
  there turns by at most `2e (1/|ab| + 1/|am| + 1/|mb|)`.
- relative_hi is the relative radius with every radius moved by its error
  bound the unfavourable way: `R = |ab| / (2 sin angle(a m b))` changes by at
  most `e * stretch`, `stretch = (2R/|ab|) (1 + 2R (1/|am| + 1/|mb|))`
  (lines 0). For a line/arc pair `relative_hi = r + e * stretch`; for two
  arcs `(r1 + e s1)(r2 + e s2) / (D - e (s1 + s2))` with D the radius sum
  (external) or difference (internal). When `e (s1 + s2) >= D` it is
  unbounded and the join is refused. `reach` uses relative_hi too, so the
  smooth case's neighbourhood also covers an uncertain relative curvature.

The cusp case admits when `2 |F - J| + drift <= 2^-36 * S`; `local` uses the
same sum against reach. drift in units of `2^-36 * S` is
`relative_hi (tilt_a + tilt_b) / 128`, independent of S. It grows like
`relative / chord`: flat arcs (tilt `~ 10 / chord` for a centred middle
point, stretch `~ 16 R^2 / chord^2`) and internal pairs with nearly equal
radii. Such cusps are refused as `SelfIntersectionOrTouch` with their pair
although their exact second contact may lie within `2^-36 * S` (a
conservative refusal). For a line/arc cusp with a centred middle point and a
long line, drift alone reaches `2^-36 * S` at `r / chord` about 13, so
flatter cusps are always refused. Before 2026-09-25 the cusp case compared the computed
`2 |F - J|` alone ("F well conditioned") and admitted real second contacts on
both entities: a line against an arc of radius 3000 and chord 0.3 at S 250
(`|X - J|` 8.7 times `2^-36 * S`), radius 1000 and chord 0.1 at S 9600 (10.7
times), internal arcs of radius 10 and 9.99 at S 5 (4.7 times), all at
bit-identical joins; the `shared` test admitted a line against an arc of
radius 1e5 and chord 0.5 at S 9600 (58 times, computed F within resolution of
J), which is why that test now excludes every cusp. The R20 plate's two
cusps (`CUT_OUTER` 10/11 and 30/31) have drift 0.055 times `2^-36 * S`, their
exact second roots at most 0.38 times (rounded plate), so they stay admitted.
Measured on 2026-09-25 with exact rationals over the kernel's input reals
(a sweep, not a test): 1,280 random exact-join line/arc cusps at S 250 and
9600 (radius 100 to 3000, chord 0.05 to 1) and 1,440 at S 1 to 12,346
(radius 10 to 1e5, chord 0.1 and 0.5), exact `|X - J|` between 0 and 10
times `2^-36 * S`: no admission with the exact second contact on both
entities beyond `2^-36 * S` (the previous rule: 8 of the 1,440), and every
case refused, also those whose exact contact lies within (the conservative
refusals above).

The smooth case needs no length: in the rounded top plate the second root of
smooth joins lies up to 1.46 times `2^-36 * S` from J, and any fixed length
would refuse a small tangency error while the root test admits a larger one.
The cusp case needs one; the rounded plate's cusps reach 0.38 times
`2^-36 * S`. Unchanged: non-adjacent near touches (no shared join), crossings
outside the near-tangent branch, collinear overlaps, and the exact-tangent
case (F within resolution of J, the `shared` test) except a cusp, which only
`join_clear` admits. The new refusals (a cusp at a join gap, a cusp or
smooth join whose carriers' error bound is not certified) are all refusals of
the tangent test, whose point lies in both segments within the exclusion, so
the broad-phase window argument in "Admission cost" (every pair `P.clear`
refuses lies within the window) still holds.

Evidence (`test/sketch-arcs-limit.test.mjs`): all 24 loops of the raw, the
1e-9 mm rounded and the exact-tangent plate are admitted with every entity
kept; each loop's area differs from the exact-tangent rebuild by less than
`sum h (L + (L + L')/2) + resolution * perimeter` (h the pointwise
displacement bound of each entity). Refused with their pair: the plate's cusp
10/11 with its tangency error scaled until `|X - J|` is 6 times `2^-36 * S`
(at 0.6 times it is admitted); planted cusps of a line, an internal and an
external arc against an arc (radii 5 and 20, sweeps 0.8 and 1.4 rad, a 10 mm
line: well conditioned, drift at most 0.13 times `2^-36 * S`), each with its
second contact on both entities at 1.25 times `2^-36 * S` (at 0.8 times they
are admitted); the admitted exact-join cusps of all three kinds (at 0 and 0.8
times) with the first entity moved half a resolution across, so the join has
a gap and the carriers cross on both entities more than 1000 times
`2^-36 * S` from it; the four ill-conditioned exact-join cusps of
"Conditioned cusps" (flat arcs at S 250 and 9600, the `shared` case at
radius 1e5, internal radii 10 and 9.99), each with its second contact
strictly inside both entities beyond `2^-36 * S` by an exact rational check;
line/arc cusps at S 250 and 9000 whose two join x values are different input
doubles with one F32x2 prefix, with the carriers' crossing strictly inside
both entities beyond `2^-36 * S` by an exact rational check (the same cusp
with one input join point is admitted); a line crossing an
arc 1e-6 mm from their join; two non-adjacent arcs kissing at their middles;
at pair level, a near-full arc wrapping back past a smooth join and a
smooth-looking pair without a shared join. The same scaled error on the
smooth join `CUT_THROUGH[21]` 4/5 (`|X - J|` 12 times `2^-36 * S`) stays
admitted.

## Fixed numeric contract

The construction source budget is always **0 mm**. It is not adjusted after a
failure. Source endpoint incidence and circle residual checks use the existing
native convention:

```text
sourceResolution = intersections.angular_guard() * max(1, maximum input coordinate magnitude)
angular_guard() = F32 representation of 1e-12
```

The final B-rep uses `ports/curved-validate.bend` unchanged. Its resolution is the
same angular guard multiplied by the maximum magnitude of the nominal vertex,
curve and surface data, including radii and the world placement. Native carrier
and endpoint residuals must not exceed `source_budget + resolution`. The
budget is therefore still zero; numerical resolution is separately recorded.
These are the repository's operational F32x2 guards, not interval-arithmetic
certificates or exact-real arithmetic claims.

The unchanged M3 source contains adjacent endpoint differences around
`7.02e-16 mm` after evaluated SI conversion. A common vertex uses the
lexicographically least of the two original represented endpoints. No source
point, middle point or fitted circle is moved to close the loop. Both source
points, their SI words and their mm remainder words remain in the native
profile. All vertices and curves retain F32x2 precision; no F32 polygon boundary
is introduced.

The native result records source endpoint gap, maximum three-point fit error,
source resolution, final required incidence and final resolution. Its area is
the analytic Green integral of the finite lines/arcs. Volume is area times
normal depth and must agree with the existing independent native surface
integral within `finalResolution * analyticSurfaceArea`. An inconsistent mass
result is rejected. The resulting `constructionBudget` has ceiling 0.

The existing analytic serializer's `0.0003 mm` reader allowance remains a
separate export allowance. It cannot become a source construction budget.
Cylinder STEP pcurves use the existing explicit native UV approximation budget;
the 3D STEP carriers remain exact analytic `CIRCLE`, `LINE`, `PLANE` and
`CYLINDRICAL_SURFACE` entities with finite trimmed domains.

## Admission cost

Admission compares every endpoint with every endpoint (degrees), walks the
loop and tests every pair of entities. Until 2026-09-24 all three were
pairwise and quadratic (about 50 µs per pair on the JS target), which is why
the limit was 256. They now run on a sort-and-sweep broad phase in
`kernel/sketch-arcs.bend`:
- every endpoint and every entity gets an axis-aligned box. An arc's box holds
  its end points and each axis extreme its finite interval contains (with the
  resolution margin, so the box only grows). Boxes grow by half a window on
  every side and are merge-sorted by low x (`sorted`; tail recursive, the JS
  stack is bounded);
- a sweep selects the pairs whose boxes overlap in x and y. Only those run
  the unchanged exact tests: `near` for endpoints, `P.clear(earlier, later)`
  in walk order for entities. The least failing (earlier, later) pair is
  reported, as the pairwise loop reported it;
- the endpoint window is `2 * (resolution + max remainder)`: two endpoints
  within resolution differ in their stored values by at most resolution plus
  both remainders;
- the pair window is `8 * sqrt(resolution * max(1, max radius)) + 4 * resolution`:
  the two entities of a pair `P.clear` rejects come within `2 * resolution`
  of each other (a candidate point in both intervals), within
  `resolution + 2 * drift` (near-collinear lines) or within
  `2 * 4 * sqrt(resolution * size) + resolution` (tangent exclusion);
  `drift` is at most the angular guard times 20,000 mm = 2e-8 mm, far below
  the window (at least 8e-6 mm). A skipped pair is farther apart than every
  neighbourhood the exact tests look at, so it has no contact at the admission
  resolution; a rejection of such a pair could only be a rounding artefact
  (none occurred in the equivalence run below);
- each endpoint's degree is 1 plus its near hits. With every degree 2, each
  endpoint has one partner, and the walk takes the original first use (the
  earliest entity in source order incident to the least endpoint) and then
  follows the partner of each exit endpoint (`chain`). Reaching the first
  entity early is `MultipleRegions`, as before.

Evidence that nothing but the cost changed: 765 seeded random profiles
(3–43 lines and arcs at 1, 20 and 300 mm scale, permuted and reversed, with
crossings, touching vertices and near-degenerate edges; 371 Solved, 336
`SelfIntersectionOrTouch`, 52 `AmbiguousEndpoint`, 6 `UnresolvedArc`) give
byte-identical `solve` results (JSON) against the previous admission with
the same pair test and against HEAD `48c025c`
(`tmp/r20/sketch-limit/equiv.mjs`, seeds 1, 3, 7).
`test/sketch-arcs-limit.test.mjs` checks every pair of every Solved random
profile with `P.clear` directly.

CPU time of `solve()` on the JS target (`process.cpuUsage`, node 22, Apple
M-series under load average 30-100 from other sessions; new: least of 3,
old: one run; 2000 measured with the limit lifted to 2048;
`tmp/r20/sketch-limit/bench.mjs`, logs
local development evidence):

| profile | n | old pairwise (HEAD, limit lifted) | sort and sweep |
|---|---:|---:|---:|
| polygon | 256 | 1304 ms | 83 ms |
| polygon | 480 | 3752 ms | 60 ms |
| polygon | 1000 | 17170 ms | 120 ms |
| polygon | 2000 | 69535 ms | 206 ms |
| gear | 256 | 1172 ms | 19 ms |
| gear | 480 | 3884 ms (refused) | 38 ms |
| gear | 1000 | 16363 ms (refused) | 90 ms |
| gear | 2000 | 66994 ms (refused) | 224 ms |
| arcs | 256 | 862 ms | 190 ms |
| arcs | 480 | 2701 ms | 242 ms |
| arcs | 1000 | 12160 ms | 491 ms |
| arcs | 2000 | 44356 ms | 949 ms |
| star | 256 | 960 ms | 48 ms |
| star | 480 | 3064 ms | 154 ms |
| star | 1000 | 14344 ms | 589 ms |
| star | 2000 | 57934 ms | 2256 ms |

- polygon: regular n-gon, R 20 mm;
- gear: the KT5 involute construction with n/20 teeth, 20 segments per tooth.
  The old admission refused it from 480 entities on
  (`SelfIntersectionOrTouch` between opposite radial flanks, the D03 defect);
- arcs: n three-point arcs bulging 0.2 chord outward on a 20 mm circle;
- star: alternating radii 20/12 mm, long radial spokes whose boxes overlap
  about 8 % of all others. This is the worst case of an axis-aligned broad
  phase and stays quadratic, with a small constant.

The limit is not set by admission (it runs past 2500 entities; at 4096 the
existing non-tail `fit_inputs` exhausts the JS stack) but by the rest of the
JS pipeline (`tmp/r20/sketch-limit/fs-probe.mjs`, FeatureScript sketch,
`skSolve`, `opExtrude`, validation):
- line-only prism: 1000 segments build in 2.7 s CPU with the exact polygon
  volume, 1280 build, 1536 exhaust the stack in the prism identity roles
  (`kernel/identity.bend local_roles`). Hence `entity_limit() = 1024` =
  `SKETCH_ENTITY_LIMIT` in `src/library.mjs`; the 1025th `skLineSegment` or
  `skArc` refuses: "A line/arc profile supports at most 1024 entities";
- profile with arcs: before the R20 gate integration, 768 entities extruded
  in 6.0 s CPU, 900 in 12.9 s, and 1000 exhausted the stack in
  `kernel/ports/curved-validate.bend edges_required` (non-tail over all
  edges, `List.get` by index, so quadratic), so opExtrude had its own limit
  of 768. `edges_required` now walks edges and domains in lockstep, tail
  recursive: 1000 entities (lines and arcs alternating) extrude in 5.9 s CPU,
  1024 in 6.0 s, also three FeatureScript calls deep. The separate limit is
  gone; every line/arc profile has the one limit of 1024 entities.

Line-only sketches keep their polygon prism at every size. Up to 256 segments
`kernel/sketch-lines.bend` admits them as before; above that
(`SKETCH_LINES_SEGMENT_LIMIT`, the limit in its `solve`, whose admission is
also pairwise: 2.7 s at 256, 18 s at 1000 wall under load) this solver does,
and the prism is built from the segments' own binary64 endpoints in the solved
order, exactly as below the limit. `sketchProfile.solver` names the solver.

## Native and serialization API

`src/sketch-arcs.mjs` only serializes and decodes:

```js
const native = await loadSketchArcs();
const entities = [
  {type: 'arc', index: 0, startMeters: [0.002, 0],
   midMeters: [0, 0.002], endMeters: [-0.002, 0]},
  {type: 'line', index: 1, startMeters: [-0.002, 0], endMeters: [0.002, 0]},
];
const profile = solveSketchArcs(native, entities, loc);
const body = extrudeSketchArcs(native, kernel, profile, id, plane,
  deltaMm, startOffsetMm, loc);
```

Use one insertion-order array for mixed lines and arcs. An omitted index is
the entry's array index. The frontend owns FeatureScript entity IDs, source
locations and operation identity. Existing pure-line sketches keep their
original exact represented endpoint-equality path.

The native identity module assigns the extruded side and rim roles from the
original FeatureScript entity names, and sweep junctions from their named
endpoint pairs. Insertion order and radius changes preserve these roles.
Start/end caps follow the signed sweep even though a negative extrusion stores
the lower ring first. Reversing an author's named start/end endpoints can
change endpoint-pair identities; no arbitrary split/merge matching is inferred.
Each side face records its sketch entity and actual `skArc`/`skLineSegment`
call location. Rigid transforms retain the original profile and identity
references, source budget and native volume. Tight transformed bounds remain
unevaluated.

The underlying entrypoints are:

```text
solve(List<Entity>) -> Solved | Rejected{reason}
extrude(profile, origin, normal, x, delta) -> Extruded | Unsupported{reason}

Entity = Line{index,start,end} | Arc{index,start,mid,end}
Point = sketch-lines.Point{value,remainder,source}
Solved = {uses,source,area,resolution,endpoint_gap,fit_error,source_budget}
Use = {fit,forward}
Fit = {source,curve,first,last,sense,error}
Extruded = {solid,domains,profile,audit,volume,depth,source_budget}
```

`origin`, `normal`, `x` and `delta` are precise Bend Vec3 values; model lengths
are in millimetres. `domains` contains a finite `GivenDomain{Interval}` for
every edge. `source` remains in insertion order and `uses` records the canonical
walk. `forward` refers to the source entity; `fit.sense` refers to that entity's
original traversal against its carrier's parameter direction. They are
independent.

`decodeSketchArcExtrusion` attaches finite `curveRange` values, the immutable
construction budget, native residual diagnostics and the full native profile
under `sketchProfile.schema = 'wonky-line-arc-sketch/1'`. Unsupported native
results throw `UnsupportedFeatureError`. Tight world bounds are not computed.

## Validation

The focused native suite covers the unchanged 12 M3 arcs; semicircle, lens,
two-arc circle, major arc, capsule and rectangle formulas; source preservation;
ordering and direction reversal; negative depth; a translated rigid frame;
finite domains; topology; malformed native data; unsupported incidence,
self-intersection and sweep cases; and count limits.

The independent M3 area oracle solves a 3×3 circle system with mpmath at 80
decimal digits and adaptively integrates Green's formula directly from the
unchanged original evaluated points. It never reads Bend-fitted circles:

```text
independent area: 9.648054371424785598135941652668 mm²
native area:     9.648054371424848 mm²
independent volume at 5 mm: 48.24027185712393 mm³
native volume at 5 mm:      48.2402718571243 mm³
```

Nine STEP artifacts pass `BRepCheck_Analyzer` with exact CurveOnSurface checking.
Every face area is compared against an independent oracle. None acquires
additional seams or vertices. The M3 solid has 24 vertices, 36 shared edges and
14 faces; its independent STEP volume is about `48.24027185712424 mm³`.

```sh
.tools/bend-2.0.25/bin/bend kernel/sketch-arcs.bend
node --test test/sketch-arcs-native.test.mjs
uv run out/sketch-arcs/area-oracle.py
uv run scripts/validate-step.py out/sketch-arcs/rectangle out/sketch-arcs/semicircle \
  out/sketch-arcs/lens out/sketch-arcs/circle-two-arcs out/sketch-arcs/major-arc \
  out/sketch-arcs/capsule out/sketch-arcs/m3-original out/sketch-arcs/m3-negative \
  out/sketch-arcs/m3-rigid
```

Focused evidence is retained in `out/sketch-arcs/tests.tap`, `bend-check.txt`,
`step-validation.json`, `area-oracle.py`, `area-oracle.json` and the STEP/B-rep
pairs. The lead integration run owns full `npm test`, FeatureScript acceptance
and the unchanged r10b input check.
