# GoTools (SINTEF): spline geometry library with intersections, compositemodel and topology modules

- **Kind:** C++ library (research-grade, industrial heritage). Canonical URL: https://github.com/SINTEF-Geometry/GoTools
- **Other URLs:**
  - Module: https://github.com/SINTEF-Geometry/GoTools/tree/master/intersections
  - Product page: https://www.sintef.no/en/software/gotools/
  - SISL (the older C spline/intersection library GoTools wraps; git submodule): https://github.com/SINTEF-Geometry/SISL
  - GAIA II background: T. Dokken, V. Skytt, "Intersection algorithms and CAGD", in *Geometric Modelling, Numerical Simulation, and Optimization*, Springer 2007, https://link.springer.com/chapter/10.1007/978-3-540-68783-2_3 (paywalled, not read). Also "The GAIA Project on Intersection and Implicitization", https://link.springer.com/chapter/10.1007/978-3-540-72185-7_1 (not read).
  - Read: J. B. Thomassen, "Self-Intersection Problems and Approximate Implicitization" (GAIA II, Springer 2005), http://www.ag.jku.at/compass/compasssample.pdf. Local copy: tmp/research/pdf/dokken-thomassen-selfint-approx-implicitization.pdf.
- **Authors/organization:** SINTEF Digital (formerly SINTEF ICT, Applied Mathematics), Oslo: Tor Dokken, Vibeke Skytt, Jan B. Thomassen, Sverre Briseid and others. Copyright lines run from 1998 to 2013 in the intersections module. GoTools 1.0 dates to 2007, 4.3.0 to 2013 (ChangeLog). The intersections design came out of the EU projects GAIA (2002-2005) and GAIA II (IST-2001-35512).
- **License:** AGPL-3.0 (commercial license available). The file headers add a section 7(b) clause: "a covered work must retain the producer line in every data file that is created or manipulated using GoTools".
  - SISL is also AGPL-3.0 (DOCUMENTED: `gh api repos/SINTEF-Geometry/SISL`).
  - Porting implication: copying or translating code makes wonky a covered work. Wonky would then fall under AGPL obligations as soon as it is distributed or offered over a network. Treat this as **study-only**. Re-derive algorithms from papers and the Patrikalakis-Maekawa text (which GoTools cites) and do not transliterate functions.
- **Status:** maintained, low activity.
  - Last commit 2025-11-25 (PR #397, cmake export). 82 stars, 39 forks, 10 contributors per GitHub API, 13 open issues. Only tag: GoTools-4.3.0.
  - Recent work (2024-2025) is on build/CMake, LR-splines, viewer, and a large new reverse-engineering module (PRs #381 "Changes from RevEng", #384 "Reveng store").
  - Repo total about 569k lines of C++ (.C/.h); intersections module about 48k. SISL was last pushed 2026-09-21.
  - All DOCUMENTED (gh api, 2026-09-22; shallow clone at tmp/research/gotools, commit 9b58396).

## What it is

GoTools is a modular spline toolkit:

- gotools-core: spline curves and surfaces, plus elementary surfaces (Plane, Cylinder, Cone, Sphere, Torus as `ElementarySurface`), `BoundedSurface` for trimmed surfaces, `CurveOnSurface`;
- `intersections`: a recursive subdivision intersector framework for curve/curve, curve/surface, surface/surface, self-intersection and functions;
- `implicitization`: approximate implicitization, Bernstein polynomials on tetrahedra;
- `topology` and `compositemodel`: face sets with adjacency analysis, `SurfaceModel`/`Body`, splitting two models against each other, and reverse engineering from triangulated scans (`RevEng*`);
- `trivariate`, `lrsplines2D/3D`, `isogeometric_model`: IGA volumes and LR B-splines;
- `qualitymodule`, `igeslib`, `viewlib`.

It is not a solid modeler with Booleans. `SurfaceModel::booleanIntersect(SurfaceModel)` is commented out in the header. Only plane trimming (`booleanIntersect(const ftPlane&)`) and the classification step `splitSurfaceModels(model2)` exist (DOCUMENTED: compositemodel/include/GoTools/compositemodel/SurfaceModel.h lines 400-452).

Correction to the brief: there is **no analytic closed-form plane/cylinder/cone/sphere/torus intersection** in the intersections module.

- `ConeInt.h` and `TorusInt.h` are empty include-guard stubs (DOCUMENTED).
- `PlaneInt`, `CylinderInt` and `SphereInt` are *implicit algebraic objects* (`AlgObj3DInt`, power-basis terms). They are only used to substitute a spline surface into an implicit equation (`IntersectorAlgPar` -> `insertSurfaceInAlgobj` -> a functional zero-set problem, `Par2FuncIntersector`).
- Their only users outside the module are test apps. Some compositemodel and trivariate code includes them for BoundedUtils-style helpers (DOCUMENTED by grep).

The production path for elementary surfaces is different. It lives in `gotools-core/src/geometry/BoundedUtils.C`:

1. Convert the non-elementary partner to a spline, `asSplineSurface()`. If both surfaces are elementary, one of them gets converted.
2. Hand it to SISL's implicit-vs-parametric routines:
   - plane `s1851`, sphere `s1852`, cylinder `s1853`, cone `s1854`, torus `s1369` find the topology;
   - `s1314` to `s1318` march the curves.
3. For spline/spline pairs, use `s1859` for topology plus `s1310` for marching.

(DOCUMENTED: BoundedUtils.C lines 2148-2800 and 3003-3345.)

## How it works

### 1. Recursive intersector framework (`intersections` module)

**The driver**, `Intersector::compute()` in intersections/src/Intersector.C lines 73-220, runs this sequence on every (sub)problem:

1. `int_results_->synchronizePool()` drops points that sibling sub-intersectors removed.
2. `getBoundaryIntersections()` solves all *lower-dimensional* problems on the boundary first. For surface/surface, that means curve/surface intersections of each boundary curve with the other surface. Results go into the shared `IntersectionPool`.
3. `performInterception()` is an exclusion test:
   - composite-box overlap within `0.5*epsge`;
   - if both boxes fit in one tolerance cube, the problem is a "micro case" (status 2);
   - a box test shrunk at the boundary;
   - when at most one boundary point is known, a rotated-box test (Intersector2Obj.C lines 157-280).
4. Branches:
   - **micro case:** `microCase()` connects the boundary points, possibly via an artificial midpoint branch point (SfSfIntersector.C lines 885-935).
   - **degenerate triangle** simple case.
   - **coincidence:** `checkCoincidence()`. If the boundary intersection points form a closed loop, the enclosed region is tested for a "partial coincidence area (PAC)" (SfSfIntersector.C lines 807-880).
   - **simple case:** `simpleCase()` is Sinha's theorem on normal/tangent *direction cones*. If the two cones do not overlap, there is no closed intersection loop inside, so the intersection is connected via the boundary points. Otherwise it tries reduced cones and a `simpleCase2` variant (Intersector2Obj.C lines 402-555).
   - **linear** case.
   - **implicitization-based exclusion:** `complexIntercept()`. Implicitize one Bezier patch approximately and test whether the other's coefficients stay on one side. It also tries a "separation surface" through a shared boundary curve (SfSfIntersector.C lines 342-640).
   - **implicitization-based simple case:** `complexSimpleCase()`.
   - **`complexityReduced()`:** after at least 6 recursion levels, give up subdividing if box overlap and cone overlap did not shrink and the counts of points and singular points did not drop. Stop at `handleComplexity()` (SfSfIntersector.C lines 3766-3838).
   - **otherwise `doSubdivide()`:** rank the parameter directions (`sortParameterDirections`) and pick subdivision values with a `SubdivisionClassification`: `DIVIDE_DEG`, `DIVIDE_CRITICAL`, `DIVIDE_HIGH_SING`, `DIVIDE_SING`, `DIVIDE_KNOT`, `DIVIDE_INT`, `DIVIDE_PAR`. The splits avoid existing intersection points and prefer singularities and knots. The children receive the parent's pool points via `includeCoveredNeighbourPoints()` and recurse.
5. Post-processing:
   - `doPostIterate()`;
   - `repairIntersections()`: repairs singularity boxes, false branch points, missing links and crossing links, and removes isolated points (SfSfIntersector.C lines 1703-2800);
   - finally `IntersectionPool::makeIntersectionCurves()`.

**Data model**
- `IntersectionPoint`: parameters in both objects plus a `SingularityType`: ORDINARY, TANGENTIAL, ISOLATED, BRANCH, HIGHER_ORDER.
- `IntersectionLink`: an edge between two points, with a `LinkType` enum of 30 provenance tags such as `SIMPLE_CONE`, `SIMPLE_IMPLICIT`, `COINCIDENCE_SFCV`, `MICRO_SFSF`, `BRANCH_CONNECTION`, `REPAIRED_MISSING_LINK`, `INSIDE_OUTSIDE_SINGULARITY_BOX`. Each link records *which rule created it*.
- Intersection curves are built from linked point chains: `InterpolatedIntersectionCurve`, `IsoparametricIntersectionCurve`, `CoinCurveIntersectionCurve` (coincident), `DegeneratedIntersectionCurve`, `NonEvaluableIntersectionCurve`. (DOCUMENTED: intersections/include/GoTools/intersections/*.h.)

**Tolerance model**
- `GeoTol` (GeoTol.h/.C) has a single constant `epsge` plus:
  - `rel_par_res = 1e-12` (relative parameter resolution);
  - `numerical_tol = 1e-16`;
  - `ang_tol = 0.01` rad;
  - `eps_bracket = 0.1`;
  - `ref_ang` stepped by `epsge`: 0.01 if epsge <= 1e-4, 0.1 if <= 1e-2, else 0.5.
- A comment says a parameter-dependent tolerance was planned but never built.
- Topology uses separate `tpTolerances {gap, neighbour, kink, bend}` (topology/include/GoTools/topology/tpTolerances.h).
- Everything is `double`. There are no exact predicates or interval arithmetic anywhere (DOCUMENTED by reading; INFERRED "nowhere" from grep for interval/exact types).

### 2. Tangential/singular point classification (the most portable piece)

`IntersectionPoint::calculate_tangent_at_singular_point()` (IntersectionPoint.C lines 1350-1490) follows Patrikalakis-Maekawa section 6.4.1 (cited in the code):

- **When it runs:** the normals are parallel, which makes the point singular.
- **Setup:**
  - orient N2 like N1;
  - take the first fundamental forms (E, F, G) and second fundamental forms (L, M, N) of both surfaces;
  - express B's parameter derivatives in A's tangent frame via a_ij = det(r*, r*, N)/sqrt(E_B G_B - F_B^2).
- **Quadratic form:** the difference of the second fundamental forms, b11, b12, b22, gives the equation for the tangent directions of the intersection: b11 w^2 + 2 b12 w + b22 = 0.
- **Classification:**
  - all b's below EPS = 1e-5 -> HIGHER_ORDER_POINT (osculating contact; there is no computable tangent);
  - discriminant b12^2 - b11 b22 < -EPS -> ISOLATED_POINT (the surfaces touch at one point);
  - discriminant > EPS -> BRANCH_POINT, with two tangent directions;
  - otherwise TANGENTIAL_POINT, with a unique tangent (a tangential intersection curve).
- `isNearSingular()` flags points where |N1 x N2|^2 < 100*tol^2 with tol = 1e-8/ang_tol, and 100x looser on boundaries.

### 3. Approximate implicitization (Thomassen/Dokken)

- **Equation:** for a Bezier patch p of degree n and an implicit degree d, q(p(t)) = B(t)^T D b, so the implicit coefficients b span the null space of the matrix D. Solve with an SVD.
- **Approximate implicitization:** take the right singular vector of the smallest singular value (paper eq. 6-9).
- **Basis:** barycentric Bernstein over an enclosing simplex, for stability.
- **Choices:**
  - d = 4 for surfaces in self-intersection work;
  - about 100x100 samples in (u,v);
  - 1e-12 as the null-space threshold in `performInterceptionByImplicitization`.
- **Use:** exclusion tests (all coefficients of the other patch on one side of q = 0 means no intersection), simple-case tests, and self-intersection candidates as roots of grad q(p(u,v)) . n(u,v).
- (DOCUMENTED: paper pp. 157-162; SfSfIntersector.C `createApproxImplicit`, `performInterceptionByImplicitization`.)

### 4. Model-level splitting (`compositemodel`)

`SurfaceModel::splitSurfaceModels(model2)` (compositemodel/src/SurfaceModel_intersections.C lines 684-900) works like this:

1. **Intersect all face pairs.** An O(n*m) double loop with a bbox prefilter, `intersectFaceSet` (line 2270), calls `BoundedUtils::getSurfaceIntersections` per pair.
2. **Split** each face by its intersection curves (`BoundedUtils::splitWithTrimSegments`, then `simplifyBdLoops`).
3. **Classify** each piece: take an interior point with `getInternalPoint`, then run a ray/normal inside test with `model2->isInside(pnt, normal, dist)`.
4. **Return** four face sets: inside1, outside1, inside2, outside2.

This is the classic "split, classify one sample per piece" pattern, as in ESOLID stage 2, but classification uses floating point and a single sample.

### 5. Reverse engineering (`RevEng`, about 38k lines)

The input is a triangulated scan (`ftPointSet`). The pipeline, as documented in the RevEng.h method comments:

1. `enhancePoints`: estimate normals and curvature.
2. `classifyPoints`: label points by mean and Gauss curvature signs: edge, peak, ridge, flat, pit, valley and so on.
3. `segmentIntoRegions`.
4. `initialSurfaces`: fit planes, cylinders and cones.
5. `growSurfaces`.
6. `updateAxesAndSurfaces` / `adaptToMainAxis`: snap to model main axes when the error allows.
7. `firstEdges`: intersection edges between neighbouring surfaces.
8. `surfaceCreation`, which also recognizes spheres and tori.
9. `smallRegionSurfaces`.
10. `manageBlends1/2`: cylinder and torus edge blends with radius harmonization, torus and 4-sided corner blends.
11. Trimming and a B-rep output.

## Robustness and guarantees

- **Nothing is exact.**
  - All decisions are `double` comparisons against `epsge`, `ang_tol`, `EPS = 1e-5` and similar.
  - The sign-of-discriminant classification above uses a hard-coded 1e-5 on unnormalized second-form differences, so it is scale-dependent (INFERRED).
  - Sinha's theorem, box and cone tests are conservative *if* cones and boxes enclose, which they do for B-spline control polygons (convex hull property). The decisions made on them are still floating point (INFERRED).
- **Completeness depends on termination heuristics.**
  - When `complexityReduced()` returns false, the code only "writes documentation of the situation to a file" (`handleComplexity`) and returns. The result may be incomplete, and no structured error reaches the caller (DOCUMENTED comment in Intersector.C line 152).
  - Micro cases join boundary points through an invented midpoint. That is topologically plausible but not verified (DOCUMENTED).
- **Silent failure in the model-level path:**
  - `getSurfaceIntersections` catches exceptions from `intersectWithSurfaces` with the THROW commented out: `catch (...) { //THROW("Failed intersecting the two spline surfaces."); }` (BoundedUtils.C line 778).
  - `splitSurfaceModels` catches `splitWithTrimSegments` failures and keeps going ("Trimmed surfaces missing" only in DEBUG).
  - These are exactly the silent-degradation patterns wonky's rules forbid (DOCUMENTED).
- **SISL retry heuristic:** if `s1859` returns only points and no curves, `getIntersectionCurve` reruns with `epsgeo2 = max(0.5*mindist, 1e-6)` (BoundedUtils.C line 3084). This is tolerance fiddling rather than classification (DOCUMENTED).
- **Seams:** for closed elementary surfaces, intersection curves are split at the seam by closest-point tests with `epsgeo`, and re-merged if position and tangent match within `angtol = 0.01` (BoundedUtils.C lines 2860-2990) (DOCUMENTED).

## Parallelism and performance

- No published benchmark numbers were found for the intersections module (DOCUMENTED absence, based on the repo and product page).
- OpenMP appears only in LR-spline approximation, `ClosestPointUtils` and `RegistrationUtils`. It is not used in intersections or compositemodel (DOCUMENTED by grep for `pragma omp`).
- The recursion is serial and shares one mutable `IntersectionPool` across siblings (`synchronizePool`, `includeCoveredNeighbourPoints`). Siblings are therefore not independent tasks as written (INFERRED from Intersector.C).

## Known failures, limitations, war stories

- Open issues are few and old (the tracker is not the main support channel):
  - #332 `CvCvIntersector` assertion in `IsoparametricIntersectionCurve.C` line 97 for some spline curves (https://github.com/SINTEF-Geometry/GoTools/issues/332);
  - #331 dimension-mismatch exception for 2D rational curves (https://github.com/SINTEF-Geometry/GoTools/issues/331);
  - #52 circle-to-spline conversion gives non-interpolating endpoints because weights are not 1 at the ends (https://github.com/SINTEF-Geometry/GoTools/issues/52).
- The code is full of `getenv("DEBUG_*")` switches, `@@@` / "VSK 0609" TODO comments and commented-out alternatives. It reads as a research code base whose heuristics were tuned case by case (DOCUMENTED: Intersector.C, SfSfIntersector.C).
- There is no general solid Boolean in the library. The model-model `booleanIntersect` is commented out, so SINTEF itself never closed the loop from SSI to a validated solid Boolean in the open code (DOCUMENTED).
- The GAIA papers themselves say tangential (self-)intersections are "in general difficult and will not be considered" (Thomassen, p. 157) (DOCUMENTED).

## Relevance for wonky

INFERRED unless marked.

**SSI for plane/cylinder/cone.** GoTools does not help directly. It turns elementary surfaces into splines and marches. That is the opposite of what wonky should do: closed-form conics and degree-4 quadric-quadric curves with exact classification. The GTE and QI notes are better sources for that.

**Where it does help: classification vocabulary and structure for explicit failure.**
- `SingularityType` {ORDINARY, TANGENTIAL, ISOLATED, BRANCH, HIGHER_ORDER} plus `LinkType` provenance tags is a good schema for wonky's SSI result type. Every intersection vertex or edge should carry which rule produced it, which feeds the viewer's review and diff.
- Wonky's version should turn "HIGHER_ORDER" and "could not reduce complexity" into typed errors instead of files on disk.
- For plane/cylinder/cone, the second-fundamental-form discriminant can be computed **exactly**:
  - the forms are constant (plane) or depend only on the radius (cylinder) or on the radius and angle (cone);
  - so b11, b12, b22 are low-degree polynomials in the input rationals;
  - the discriminant sign becomes a multi-limb U32 predicate with no EPS.
  - This covers wonky's hard FDM cases: a plane tangent to a cylinder (TANGENTIAL line), two equal-radius cylinders with crossing axes (BRANCH points), and a sphere touching a plane (ISOLATED).

**Boundary-first recursion is fork-join friendly once restructured.** The parent computes the lower-dimensional intersections on the split line (curve/surface) *before* recursing and passes them to both children as immutable inputs. Children then agree on shared boundary points by construction. In Bend:
- `split(problem)` returns `(boundaryPoints, left, right)`;
- `a b = solve(left, bp) solve(right, bp)`;
- merge the link lists keyed by boundary point id.
- Remove the shared mutable pool (`synchronizePool` becomes a pure merge).

**Box, cone and complexity heuristics.**
- Sinha's direction-cone test is a cheap, uniform, data-parallel exclusion test (a max-angle reduction over control-net normals), which suits GPU/fork-join.
- The "complexity not reduced after 6 levels" rule is a practical termination rule. Wonky should make it an explicit capability error with the region attached.

**Model split and classify** matches the leading hybrid's last stage. GoTools' single-sample float `isInside` is the weak point. Wonky should classify via mesh adjacency propagation plus exact point-in-solid on the analytic model.

**RevEng is relevant beyond Booleans.**
- (a) It has a worked pipeline for "recognize plane/cylinder/cone/sphere/torus and blends from a triangle mesh". That is adjacent to analytic B-rep recovery, although wonky's tags make recognition mostly unnecessary.
- (b) It is directly relevant to Marc's scan-reverse-engineering workflow: main-axis snapping, blend-radius harmonization.
- (c) Its blend recognition (cylinder and torus edge blends, corner blends) shows the surface vocabulary wonky's fillets will need.

**Bend fit.**
- Recursive subdivision on Bezier patches is a natural fork-join tree, but its depth is data-dependent: poor uniform-GPU fit, fine for CPU fork-join.
- The SVD-based implicitization needs f64-level conditioning. Degree 4 over a tetrahedron gives 35 unknowns. F32x2 (about 48-bit mantissa) is probably adequate for the null-space test at the 1e-12 threshold only if inputs are pre-scaled. This needs verification before relying on it.

**AGPL:** study only. Everything above is described in the literature (Sinha 1985; Patrikalakis-Maekawa ch. 5-6; Dokken's approximate implicitization papers), so wonky can re-derive it without touching GoTools code.

## Pointers worth porting or studying

(As ideas, not code.)

- `intersections/src/Intersector.C` `Intersector::compute()`, lines 73-220: the canonical decision ladder (intercept, micro, coincidence, simple, linear, implicit, complexity, subdivide).
- `intersections/src/Intersector2Obj.C` `performInterception()` and `simpleCase()`, lines 157-555: box plus rotated box, then direction cones (Sinha), then reduced cones.
- `intersections/src/IntersectionPoint.C` `calculate_tangent_at_singular_point()`, lines 1350-1490: the fundamental-form classification of tangential contact. Pair it with Patrikalakis-Maekawa section 6.4.1 (see the patrikalakis notes in this directory).
- `intersections/src/SfSfIntersector.C`:
  - `checkCoincidence()`, lines 807-880: PAC detection from closed boundary loops;
  - `complexityReduced()`, lines 3766-3838: the termination heuristic;
  - `repairIntersections()` and its sub-repairs, lines 1703-2800: a catalogue of what goes wrong in subdivision SSI (false branch points, missing links, crossing links, singularity boxes).
- `intersections/include/GoTools/intersections/LinkType.h`, `SingularityType.h`, `SubdivisionClassification.h`: enums worth mirroring as typed result and provenance tags.
- `gotools-core/src/geometry/BoundedUtils.C`:
  - `getSurfaceIntersections()`, lines 610-800: domain reduction before SSI (domainfac 1.5);
  - `getIntersectionCurveElem()`, lines 2800-3000: seam splitting and re-merging for closed elementary surfaces. Useful checklist for wonky's cylinder and cone seams.
- `compositemodel/src/SurfaceModel_intersections.C` `splitSurfaceModels()`, lines 684-900: split and classify skeleton.
- `compositemodel/include/GoTools/compositemodel/RevEng.h`: the documented stage list of the scan-to-B-rep pipeline.
- Thomassen, "Self-Intersection Problems and Approximate Implicitization", eq. 6-12: implicitization as a null-space problem, and the grad q . n candidate function.

## Verdict: learn-from

Study it for the SSI decision ladder, the singular-point classification and the result-type vocabulary. Rebuild the tangency discriminant exactly for wonky's surface set.

- **Do not port code:** AGPL, double-only heuristics, silent catch-and-continue.
- **Do not adopt its approach for elementary surfaces:** spline conversion plus marching, where wonky needs closed forms plus exact predicates.
- RevEng is a secondary reference for mesh-to-analytic recognition and blend vocabulary.
