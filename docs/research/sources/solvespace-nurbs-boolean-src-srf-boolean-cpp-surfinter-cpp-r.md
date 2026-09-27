# SolveSpace NURBS Boolean (src/srf: boolean.cpp, surfinter.cpp, raycast.cpp, ratpoly.cpp)

- Kind: kernel source (C++), part of the SolveSpace parametric CAD program. Canonical URL: https://github.com/solvespace/solvespace/tree/master/src/srf
- Other URLs: https://github.com/solvespace/solvespace ; issues #1268 https://github.com/solvespace/solvespace/issues/1268 , #297 https://github.com/solvespace/solvespace/issues/297 , #1371 https://github.com/solvespace/solvespace/issues/1371 , tracking issue #738 https://github.com/solvespace/solvespace/issues/738 , #1291 https://github.com/solvespace/solvespace/issues/1291 , PR #1731 https://github.com/solvespace/solvespace/pull/1731 , PR #1760 https://github.com/solvespace/solvespace/pull/1760
- Read at commit `cbff7a9112bb7c8abe1851c56d413c0d8bc1ac84` (2026-09-16), the same commit wonky's `docs/port-solvespace.md` pins. Link base: `https://github.com/solvespace/solvespace/blob/cbff7a9112bb7c8abe1851c56d413c0d8bc1ac84/`. Local clone: `tmp/research/solvespace-srf/ss/`.
- Authors/organization: Jonathan Westhues (original author, "Copyright 2008-2013"). Maintained since by whitequark, phkahler (Paul Kahler, the de facto NURBS maintainer), ruevs, and others. 2008-2026.
- License: **GPL-3.0-or-later** (DOCUMENTED, `COPYING.txt`, README). Implication (INFERRED, not legal advice): a Bend translation of this code is a derivative work. The public wonky repository contains no SolveSpace-derived code. For further work, study ideas rather than transcribing code.
- Status (DOCUMENTED via `gh api`, 2026-09-22): C++, ~24.6 MB, 4,165 stars, 598 forks, ~108 contributors, last commit 2026-09-16, release v3.2 (2026-03-27), v3.1 (2022-06-01). 82 issues labeled NURBS (42 open). NURBS work is very active in 2026: PRs #1729, #1731, #1751 and #1760 are all tangency and coincidence fixes, some explicitly co-written with an LLM ("fallback fixes from Claude Opus 5", #1760).

## What it is

A compact, complete B-rep of trimmed **rational Bezier patches** (degree ≤ 3 in each direction, `SSurface::ctrl[4][4]`, `weight[4][4]`) with Booleans. The Boolean code is 1,100 lines in `boolean.cpp`, plus `surfinter.cpp` (641), `raycast.cpp` (807), `ratpoly.cpp` (790), `curve.cpp` (886) and `surface.cpp` (494), about 6.6k lines for all of `src/srf`. Extrudes, revolves (patches < 180° each), helices and planes are its only surface constructors. There are no fillet or offset operations; fillets are modeled by the user as Boolean difference with a sketch-extruded tool, which is why tangency dominates its bug tracker.

## How it works

### Data model (`surface.h`)
- `SShell` = `IdList<SCurve>` + `IdList<SSurface>`, plus a `booleanFailed` flag.
- `SCurve` = trim curve shared by two surfaces (`surfA`, `surfB`). It has `isExact` + `SBezier exact` (rational Bezier, degree 1-3) **and always** a piecewise-linear `pts` list (`SCurvePt{p, vertex}`). It also records `source` ∈ {A, B, INTERSECTION} and `newH` for renaming into the result.
- `SSurface.trim` = list of `STrimBy{curve, backwards, start, finish}`. The trim region is *derived*: a UV polygon from the PWL curve points (`MakeEdgesInto`) and a 2D BSP (`SBspUv`) for point and edge classification.
- **All topology and classification is done on the PWL.** `exact` is used to refine points (Newton projection onto the exact curve) and for export (INFERRED from `MakeCopySplitAgainst`, `EdgeNormalsWithinSurface`). This is why results depend on the chord tolerance (#297).

### Surface/surface intersection (`surfinter.cpp` `SSurface::IntersectAgainst`, L120-L555; DOCUMENTED)
Bounding-box reject, then special cases in order:
1. **Plane/plane** (both `degm==degn==1`, L137-L196): line from `AtIntersectionOfPlanes`, clipped to both patches' `[0,1]²` parameter boxes, emitted as an exact degree-1 `SBezier`. `|na×nb| < LENGTH_EPS` means parallel, and nothing is emitted.
2. **Plane / surface of extrusion** (L197-L297; extrusion detected by `IsExtrusion`, `surface.cpp` L29-L54: `degn==1` and every row translated by the same `along` with equal weights):
   - Extrusion direction ∥ plane (`|n·along| < LENGTH_EPS`): zero or more lines. The code intersects one line (in the plane, ⊥ `along`) with the surface via `AllPointsIntersecting` (closed form for cylinders, subdivision+Newton otherwise), and each hit gives an exact line segment of length `|along|`. Since issue #1291, trim curves of the extrusion that lie in the plane (`ContainsPlaneCurve`, all control points within `LENGTH_EPS` of the plane) are added directly as exact curves, and numeric duplicates are suppressed. This handles a fillet-like surface tangent to the plane.
   - Otherwise: the intersection is **the parallel projection of the directrix Bezier along `along` onto the plane**. Each control point is projected with `AtIntersectionOfPlaneAndLine`, and the weights are unchanged. This is exact because parallel projection is affine and rational Beziers are affinely invariant. For a circular cylinder this yields the ellipse as a rational quadratic Bezier with no conic classification at all.
3. **Two extrusions along parallel axes** (L298-L361): PWL of one directrix, shifted to the axis midpoint. The other surface is intersected with each segment. Each hit is refined to lie on both surfaces plus a plane ⊥ axis (`PointOnSurfaces`) and emitted as an exact line of the common axial extent.
4. **Plane vs other curved surface** (L363-L399): if trim curves of the curved surface lie entirely in the plane (e.g. cutting a lathe shell on its seam), use them and skip marching.
5. **General case: marching** (L401-L553). Start points come from intersecting every PWL trim edge of each surface with the other surface (`AllPointsIntersecting` segment mode, trimmed, no tangents), refined onto the three-surface point (`PointOnSurfaces`) or onto the exact trim curve (`PointOnCurve`). The march steps along `nb × na` (direction chosen at the first step so it heads inward relative to the edge normal). Each step is corrected by `ClosestPointOnThisAndSurface`, with adaptive step size ×0.9 / ÷0.9 until the chord error is in `[maxtol/2, maxtol]`, where `maxtol = ChordTolMm`. It stops when another start point lies on the new segment within `2·ChordTol`, or after `max(300, 3·MaxSegments)` steps. The result is an inexact `SCurve` (PWL only).
- Every new curve goes through `AddExactIntersectionCurve` (L14-L118). It reuses the PWL of an identical exact curve already present (so both sides share vertices), otherwise it builds `MakePwlInto` and splits it with `MakeCopySplitAgainst`. The curve is dropped if no PWL point projects into `[−0.01, 1.01]²` of both patches.

### Line/surface intersection (`raycast.cpp` `AllPointsIntersecting`, L249-L381; DOCUMENTED)
- Plane: closed form.
- Cylinder (`IsCylinder`: extrusion of a circular-arc Bezier, `surface.cpp` L56-L66): closed form in a frame where the line is horizontal, `x = ±sqrt(r²−y²)`. Tangent if `||y|−r| < LENGTH_EPS`. Arc membership is tested by `atan2` with `tol = LENGTH_EPS/r`.
- Otherwise: recursive subdivision (`SplitInHalf`, alternating u/v) until `DepartureFromCoplanar() < 0.2·ChordTol`, then Newton (`PointIntersectingLine`, 20 iterations). The subdivision budget is 2000 cells ("too many subdivisions" is only logged).
- Duplicates are removed by point equality. Hits are filtered to the open segment and to the trim region via the BSP (`onEdge = class != INSIDE`).

### Boolean driver (`boolean.cpp` `SShell::MakeFromBoolean`, L850-L898; DOCUMENTED)
1. `MakeClassifyingBsps` for both shells (UV BSP of each surface's trim polygon, plus XYZ edge lists).
2. `CopyCurvesSplitAgainst`: every original trim curve's PWL is split wherever a segment crosses a surface of the other shell. Tangent hits are included, and hits are kept if inside the trim or within ChordTol of it. Each split point is refined onto the exact curve or the three-surface point. Shell vertices lying on an exact curve are inserted as extra split points (`FindVertsOnCurve`, L39-L68, which uses trim endpoints, not curve endpoints, to avoid phantom T-junctions, #1452).
3. `MakeIntersectionCurvesAgainst`: all surface pairs A×B run `IntersectAgainst` (OpenMP `parallel for` over A's surfaces).
4. `RemoveShortSegments`, rebuild the BSPs with the split curves.
5. `CopySurfacesTrimAgainst` → `MakeCopyTrimAgainst` (L497-L748) per surface, which does the following:
   - For a DIFFERENCE with B, reverse the surface.
   - Build `orig` (the surface's own trim edges in UV) and `inter` (INTERSECTION-curve PWL edges lying in the other surface's trim), each oriented by `sign((n_this × (b−a)) · n_other)`, with inversions for DIFFERENCE-B and INTERSECTION. **If `|dot| < DOTP_TOL·|..||..|` (surfaces tangent along the curve), both orientations are added** and classification discards the wrong one (L569-L580).
   - "Choosing points" are points where ≠ 2 edges meet. Maximal chains between choosing points (`FindChainAvoiding`) are classified once, at the middle edge's midpoint.
   - Classification per chain: `EdgeNormalsWithinSurface` gives the midpoint (refined onto the exact curve or the surface pair) and the in-surface inner and outer normals. The probe distance is `min(ChordTol, |edge|/10)`. Then `agnst->ClassifyEdge` gives the region class left and right of the edge relative to the other shell: INSIDE, OUTSIDE, COINC_SAME or COINC_OPP.
   - `KeepEdge(type, opA, indir, outdir, …)` keeps an edge iff exactly the inner side is kept, per `KeepRegion` (L274-L309):
     - UNION: A keeps OUTSIDE, B keeps OUTSIDE ∪ COINC_SAME.
     - DIFFERENCE: A keeps OUTSIDE ∪ COINC_OPP, B keeps INSIDE.
     - INTERSECTION: A keeps INSIDE, B keeps INSIDE ∪ COINC_SAME.

     The asymmetry between A and B deduplicates coincident faces.
   - Intersection edges collinear and same-direction with an original trim edge (`EDGE_PARALLEL` in the original BSP) are discarded (#1452).
   - `CullExtraneousEdges` removes duplicate and antiparallel pairs. `TrimFromEdgeList` merges consecutive edges of the same curve into `STrimBy`. `AssemblePolygon` failure sets `booleanFailed` ("failed to assemble polygon to trim nurbs surface in uv space").
6. `RewriteSurfaceHandlesForCurves`.

### Point, edge and region classification (`raycast.cpp` `SShell::ClassifyEdge`, L463-L805; DOCUMENTED)
- **Edge-on-edge** (the probe point lies on an edge of exactly two shell faces): classify from the direction cosines `dotp[i] = edge_n_out · n_face_i` against `DOTP_TOL = 1e-5`. Tangent faces (`|dotp| < DOTP_TOL`) are resolved since #1291 / PR #1731 by `ProbeTangentFace`: step into the face by `max(size/20, 100·LENGTH_EPS)` and measure the deviation from the tangent plane. This is a second-order probe that separates "coincident" from "tangent and curving away". Knife edges with ≥4 faces meeting are resolved by the angularly closest face (#1091).
- **Edge-on-face:** `ClassifyRegion` by the sign of `edge_n · n_face` (coincident if `|cos| < DOTP_TOL`).
- **Otherwise ray casting** in fixed pseudo-random directions (`Random[8]` table). The nearest hit's normal sign decides in or out. The ray is recast if it hits on an edge, up to 5 times, then the edge is marked naked.
- `SBspUv` (L925-L1098): a 2D BSP over trim segments inserted longest first. Distances are measured after **scaling UV by `|∂S/∂u|, |∂S/∂v|` at the query point**, so the `LENGTH_EPS` (1e-6 mm) tests are approximately in XYZ units. Collinear segments share a node (`more` list). Classes are INSIDE, OUTSIDE, EDGE_PARALLEL, EDGE_ANTIPARALLEL and EDGE_OTHER; the last retries at t=0.294 along the edge.

### Numerics (DOCUMENTED)
- f64 throughout. `LENGTH_EPS = 1e-6` (`src/defs.h`). `RATPOLY_EPS = LENGTH_EPS/100` (Newton convergence, `ratpoly.cpp` L16). `DOTP_TOL = 1e-5`. `ChordTolMm` is user-set (the chord tolerance; also used as marching tolerance, split slop and probe distance).
- Newton: point to surface (`ClosestPointNewton`, grid seed 7×7 or 20×20, cached last `(u,v)`), three-surface point (`PointOnSurfaces`: intersect the three tangent planes, 20 iterations, and fall back to the centroid if the planes are parallel, which is the tangent case), point on curve, line/surface (20 iterations). Non-convergence is logged (`dbp`) and computation continues.
- PWL of Beziers: recursive bisection until the midpoint chord deviation is below `chordTol` or the step is below `1/MaxSegments` (`MakePwlWorker`, L258-L306).

## Robustness and guarantees

- None are formal. Every decision is an epsilon test (`LENGTH_EPS`, `DOTP_TOL`, `ChordTol`), and Newton failures are logged, not propagated. Failure detection is limited to "UV polygon did not assemble" (`booleanFailed`) and the naked-edge check on the triangulated result. Both are good end-to-end *oracles* but do not locate or prevent errors.
- Tangency and coincidence are handled by a growing set of special cases: both-direction edges, `ProbeTangentFace`, EDGE_PARALLEL discard, exact-in-plane trim curves. Each came from a user model. The maintainers' own taxonomy of failure sources (phkahler, 2023-09-22, #297) is: (1) curve/curve intersection not creating a vertex, (2) tangent surfaces (curved surface tangent at the intersection), (3) intersection of two curved surfaces, (4) coincident surfaces.

## Parallelism and performance

- DOCUMENTED: OpenMP `#pragma omp parallel for` over surfaces for curve splitting, SSI (per A surface), trimming and BSP construction. Critical sections guard `into->curve` insertion (a race fix is referenced in PR #1731).
- HEARSAY/DOCUMENTED: #1371 (2023) states "meshes are also much slower than NURBS operations these days" in SolveSpace. No published timing numbers were found.
- `bench/harness.cpp` exists but produces no committed numbers.

## Known failures, limitations, war stories

- **#1268 (open, 2022-07-10): "NURBS failure on simple union of cube and cylinder."** In the reporter's words, "a same-sized cube and cylinder extruded from the same plane in different directions". The union produces naked edges on 2 of 4 facets. The only workaround besides forcing a triangle mesh is "changing the dimensions of one of the objects so they no longer meet tangentially". So the cylinder is tangent to the cube's side faces, and the two share the sketch plane. phkahler (maintainer): rotating the workplane changes nothing, a difference also fails, an intersection works. This is **the same configuration class as wonky's blocker**: a plane/cylinder union with tangent contact plus a shared planar boundary.
- #297 (open, 2017): Boolean success depends on chord tolerance, and users were unaware of it. The maintainer keeps the model from that issue as a regression test that "manages to hit many different bugs". https://github.com/solvespace/solvespace/issues/297
- #1291 (closed 2026-08-22 after 4 years, 25 comments): a fillet-shaped difference tool tangent to cube faces fails. It was fixed by #1729 + #1731 (five independent defects: tangent-fold misclassification in `ClassifyEdge`, grazing line/surface intersections, orientation of tangent intersection curves, …, one naked-edge-checker false positive). https://github.com/solvespace/solvespace/issues/1291 , https://github.com/solvespace/solvespace/pull/1731
- #1751/#1755/#1760 (2026-08): the fix for grazing tangency (fall back to a curve/curve test against the nearest surface edge) breaks the opposite face. "Coincident fillet cut fails" when a point is exactly coincident with the box extent. https://github.com/solvespace/solvespace/pull/1760
- #1452 (closed 2026-07-09): an all-90° model of rectangles and extrusions loses an entire face. Causes: phantom split points from padded coincident surfaces, and duplicate collinear intersection edges. https://github.com/solvespace/solvespace/issues/1452
- #1091 (open): countersunk holes (a cone meeting a cylinder, coaxial, stacked differences) fail to assemble a trim polygon. #1124: an extrude and a revolve with the same circle profile fail. #171: coincident edges.
- #1371 (open): SolveSpace evaluates Manifold for mesh Booleans because the triangle-mesh Boolean has remaining bugs. The project keeps NURBS and mesh as two separate Boolean paths.

## Relevance for wonky

- **Closest open-source analogue in scale and ambition** (DOCUMENTED size, INFERRED fit): a one-maintainer-sized kernel with analytic special cases first, marching second, and end-to-end oracles (watertight mesh + volume). wonky's current capabilities (exact analytic plane/cylinder/cone B-rep, special-case Booleans) roughly correspond to SolveSpace's special cases 1-4, but with exact trim curves instead of PWL-defined topology.
- **Where wonky's plane/cylinder path will break**, predicted from SolveSpace's history (INFERRED):
  - tangent contact (a cylinder side tangent to a box face: the #1268 / #1291 class);
  - coincident faces meeting edge-on-edge across successive unions (#1452);
  - a curve passing exactly through an existing vertex without being split there (#297 bug 1, `FindVertsOnCurve`);
  - seams of revolved patches lying in a cutting plane (`ContainsPlaneCurve`);
  - coaxial cone/cylinder stacks (#1091).

  wonky's acceptance tests should include each of these as fixtures before claiming a general plane/cylinder union.
- **Ideas worth adapting:**
  - Parallel projection of the directrix for plane ∩ general extrusion: exact, affine, no conic case analysis. It fits wonky's extrusion-built cylinders and gives a rational representation that can be checked against the analytic ellipse. It is a cheap, uniform GPU-friendly construction, being per control point.
  - Share one discretization per intersection curve between both faces (`AddExactIntersectionCurve` reuses an existing identical curve's PWL). In wonky terms, share one curve object and one vertex set, identified by curve identity (topology identity/provenance).
  - Chain classification between "choosing points": classify one representative per maximal chain. This reduces classification calls and guarantees chain-consistency. As a data-parallel pattern it is "label chains, then map-classify per chain".
  - KeepRegion/KeepEdge tables with asymmetric COINC_SAME/COINC_OPP handling for coincident faces. This is a compact and correct rule set for regularized Booleans with coplanar faces.
  - Second-order probing for tangent faces (`ProbeTangentFace`): when first-order normals are parallel, decide by which side the face curves to. wonky should do the same with exact curvature signs (plane: zero curvature; cylinder: sign of `(p − axis)·n`), not a finite probe step.
  - UV distances scaled by `|∂S/∂u|` so that tolerances are in model units. This matches BRL-CAD's 3D-to-2D tolerance lesson and applies to F32x2 parameter space.
  - Regression tests `test/group/boolean_{coplanar_union,knife_edge,tangent_crossing,tangent_edge,tangent_fillet,tangent_spline}` check that the display mesh has no naked or self-intersecting edges and that its **volume** matches a closed-form value (e.g. prism minus fillet sliver `/0.9730161212`). Port the *scenarios* (geometry recipes) into wonky fixtures. Not the `.slvs` files verbatim: they are GPL test data, and recreating the geometry in FeatureScript is cleaner.
- **What not to adopt:** PWL-defined topology whose correctness depends on chord tolerance; `dbp`-and-continue on Newton non-convergence; random-direction ray recasting with a retry cap; `LENGTH_EPS` absolute epsilons (1e-6 mm is above F32x2 resolution at FDM scales and would be *representable*, but it is a policy, not a certificate).
- **Bend fit (INFERRED):** the per-surface-pair SSI and the per-surface trimming are independent maps (SolveSpace already runs them in OpenMP). Marching is inherently sequential per curve, and each start point is a separate task. The BSP is a recursive immutable tree: wonky's `solvespace-bsp.bend` already ported it as immutable recursive splitting. Everything is f64 today. The special cases need only dot and cross products and one plane-line intersection per control point, which map to F32x2 plus exact sign predicates.
- **Plugs into:** Boolean (special cases, classification rules), testing (scenario corpus, naked-edge plus volume oracle), LLM ergonomics (SolveSpace's recent fixes were developed with LLM assistance and extensive test models, showing the value of minimal failing fixtures).

## Pointers worth porting or studying

- `src/srf/surfinter.cpp` L197-L297 (plane/extrusion incl. directrix projection), L298-L361 (parallel extrusions), L363-L399 (in-plane trim curves), L401-L553 (marching loop and step control), L14-L118 (curve sharing).
- `src/srf/boolean.cpp` L39-L68 (`FindVertsOnCurve`), L78-L204 (`MakeCopySplitAgainst`), L274-L321 (`KeepRegion`/`KeepEdge` truth table), L497-L748 (`MakeCopyTrimAgainst`, including tangent both-direction edges L569-L580 and the EDGE_PARALLEL discard L687-L702), L925-L1098 (`SBspUv`).
- `src/srf/raycast.cpp` L279-L334 (closed-form line/cylinder), L395-L413 (`ClassifyRegion`), L440-L461 (`ProbeTangentFace`), L463-L805 (`ClassifyEdge` decision tree).
- `src/srf/ratpoly.cpp` L679-L733 (three-surface Newton), L258-L306 (adaptive PWL), `src/srf/surface.cpp` L29-L112 (extrusion/cylinder recognition, revolve patch construction with middle weight `cos(Δθ/2)`).
- Tests: `test/group/boolean_*/test.cpp`. Tracking issue #738 has the table of all NURBS bug models and their fixing commits.

## Verdict: learn-from

SolveSpace is the most instructive small-kernel precedent: its special cases, KeepRegion rules, curve sharing, chain classification and tangency probes are directly useful. Its bug tracker is an ordered list of the failures wonky will meet next, starting with #1268, which is wonky's blocker class. It is GPL-3 and its topology depends on a PWL chord tolerance, so wonky should re-derive the ideas with exact trims and certified predicates rather than transcribe code. The already-ported GPL files need a licensing decision before any publication.
