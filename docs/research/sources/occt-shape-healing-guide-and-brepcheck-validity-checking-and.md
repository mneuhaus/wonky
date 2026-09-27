# OCCT Shape Healing guide and BRepCheck (validity checking and repair)

- **Kind:** official user guide plus C++ source (validity analyzer, Boolean argument checker, healing toolkit).
- **Canonical URL:** https://occt3d.com/dev/doc/overview/html/occt_user_guides__shape_healing.html (OCCT 8.0.1 guide; local text copy `tmp/research/occt-healing/shape_healing.txt`).
- **Other URLs:**
  - Healing toolkit source: https://github.com/Open-Cascade-SAS/OCCT/tree/master/src/ModelingAlgorithms/TKShHealing (ShapeAnalysis, ShapeFix, ShapeUpgrade, ShapeCustom, ShapeProcess, ShapeBuild, ShapeExtend).
  - Validity analyzer: `src/ModelingAlgorithms/TKTopAlgo/BRepCheck/*` (local copies of `BRepCheck_{Analyzer,Vertex,Edge,Wire,Face,Shell,Solid}.cxx`, `BRepCheck_Status.hxx`, `BRepLib_ValidateEdge.cxx` in `tmp/research/occt-healing/`).
  - Boolean argument checker: `src/ModelingAlgorithms/TKBO/BOPAlgo/BOPAlgo_ArgumentAnalyzer.{hxx,cxx}`, `BOPAlgo_CheckStatus.hxx` (downloaded to the same folder).
  - Tolerance definitions: BRep format spec https://dev.opencascade.org/doc/overview/html/specification__brep_format.html, Boolean spec https://dev.opencascade.org/doc/overview/html/specification__boolean_operations.html (local `tmp/research/occt-docs/`).
  - FreeCAD UI on top of it: https://wiki.freecad.org/Part_CheckGeometry (local `part_checkgeometry.txt`).
  - Regression tests: `tests/heal/*` (e.g. `checkshape`, `fix_gaps`, `same_parameter`, `unify_same_domain`) in the OCCT repo (local `tmp/research/occt-tests/tests/heal`).
- **Authors/org:** Matra Datavision (1995-1999), then OPEN CASCADE SAS / OCCT3D (Capgemini). BRepCheck was written by Jacques Goussard in 1995 (file headers). DOCUMENTED.
- **License:** LGPL-2.1 with the OCCT exception, or a commercial license (file headers). Porting implication: wonky is private and unlicensed, so do not transcribe code. The *list of invariants* and the *check structure* are ideas and can be re-implemented freely. Linking OCCT as a backend is forbidden by wonky's rules anyway. INFERRED.
- **Status (gh api, 2026-09-22):** Open-Cascade-SAS/OCCT, C++, 2,904 stars, 684 forks, 222 open issues, last commit on master 2026-08-24, pushed 2026-09-05. Releases V8_0_0 (2026-05-07), V8_0_0_p1 (2026-06-17), V8.0.1 (2026-07-30). Actively maintained. DOCUMENTED.

## What it is

Three layers that together define "a valid B-rep" in OCCT and what to do when a shape is not one:

1. **BRepCheck_Analyzer** answers "is this shape valid?". It returns a list of `BRepCheck_Status` codes per sub-shape and per context (for example, an edge's status *in* a given face). FreeCAD's Part → Check Geometry is a thin UI over it, and it highlights the faulty sub-shape. DOCUMENTED.
2. **BOPAlgo_ArgumentAnalyzer** (public API `BRepAlgoAPI_Check`) answers "can this shape be a Boolean argument?". It catches self-interference that BRepCheck does not look for. FreeCAD exposes it as the optional "BOP check". DOCUMENTED.
3. **Shape Healing** (TKShHealing):
   - ShapeAnalysis detects problems without changing the shape.
   - ShapeFix repairs them.
   - ShapeUpgrade splits or unifies geometry.
   - ShapeCustom converts representations.
   - ShapeProcess runs a sequence of operators from a user-editable resource file.
   - The guide's canonical examples: a face on a periodic surface missing its seam edge, wrong wire orientation, a self-intersecting wire, and a lacking edge (a gap in a wire). DOCUMENTED (guide, "Examples of use").

## How it works

### Tolerance model (the thing everything else checks)

- Every vertex, edge and face stores a tolerance `t`, defined as the maximum distance from the entity to *each of its representations*. DOCUMENTED (BRep format spec, "vertex/edge/face data tolerance").
  - vertex: 3D point vs point-on-curve and point-on-surface parameters;
  - edge: 3D curve vs every pcurve-on-surface;
  - face: face vs surface.
- Geometrically, a vertex is a ball and an edge is a tube around its curve.
- Edge flags:
  - `SameParameter`: `C3d(t)` and `S(pc(t))` agree at the *same* parameter within `Tol(E)`;
  - `SameRange`: the pcurve range equals the 3D range;
  - `Degenerated`: the edge is a pole or apex with no 3D curve.
- Global constants: `Precision::Confusion()` = 1e-7 (3D), `PConfusion` = 1e-9 (parametric), `Angular` = 1e-12. ShapeFix default precision is 1e-7 (guide, "General Workflow"). DOCUMENTED.

### BRepCheck_Analyzer: two phases, per-context status lists

`BRepCheck_Analyzer.cxx`, DOCUMENTED:

- **Phase 1, `Put`:** recursively creates one result object per sub-shape (vertex, edge, wire, face, shell, solid) and runs its `Minimum()`, the *intrinsic* check.
- **Phase 2, `Perform`:** runs `InContext(parent)` for each sub-shape against each ancestor it is used in.
  - This is parallel: `OSD_Parallel::For` over chunks of about `NbThreads*10` tasks, at least 10 shapes each.
  - Results live in mutex-guarded per-shape maps (`myMutex`, `IsParallel()`).
- **Gating:** face-level wire orientation is evaluated only if no edge of the face reported `NoCurveOnSurface`, `InvalidCurveOnSurface`, `InvalidRange` or `InvalidCurveOnClosedSurface`, and no wire reported an error. Otherwise the face is marked `UnorientableShape`.
- **`IsValid(S)`** is a recursive AND over the status lists of S's sub-shapes in the context of S.

### The 37 status codes (`BRepCheck_Status.hxx`), grouped by entity and test

| Entity | Test (file) | Status | How it is decided |
|---|---|---|---|
| Vertex in edge | `BRepCheck_Vertex::InContext` | `InvalidPointOnCurve`, `InvalidPointOnCurveOnSurface` | `|P_V - C(t_first/last)|² > max(TolV,TolE)²`, also for every stored point-on-curve parameter and for `S(pc(t))` |
| Vertex in face | same | `InvalidPointOnSurface` | point-on-surface reps within `max(TolV,TolF)` |
| Edge (intrinsic) | `BRepCheck_Edge::Minimum` | `No3DCurve`, `Multiple3DCurve`, `InvalidDegeneratedFlag`, `InvalidRange`, `InvalidSameParameterFlag` | exactly one 3D curve; range `[First,Last]` non-empty, inside the curve's domain ±1e-9, at most one period; `SameParameter` without `SameRange` is invalid |
| Edge in face | `BRepCheck_Edge::InContext` | `InvalidSameParameterFlag`, `InvalidSameRangeFlag`, `InvalidCurveOnSurface`, `InvalidCurveOnClosedSurface`, `NoCurveOnSurface` | flags must be set; pcurve range = 3D range ±1e-9; deviation between `C3d` and `S(pc)` must be `< Tol(E) + ε`, measured by `BRepLib_ValidateEdge` (see below); both pcurves of a seam edge are checked; a planar face may omit the pcurve (projected on the fly) |
| Edge in shell/solid | same | `FreeEdge`, `InvalidMultiConnexity` | count faces that use the edge: `<2` (not degenerated) is free, `>2` is non-manifold |
| Wire (intrinsic) | `BRepCheck_Wire::Minimum` | `EmptyWire`, `NotConnected` | BFS over the vertex→edge map must reach all edges |
| Wire closure | `BRepCheck_Wire::Closed` | `RedundantEdge`, `NotClosed` | an edge used ≥3 times, or twice with the same orientation, is redundant; any vertex with odd incidence means not closed. Purely combinatorial |
| Wire in face (2D) | `Closed2d`, `IsDistanceIn2DTolerance` | `NotClosed` | consecutive pcurve endpoints must coincide in UV: quick accept if `|Δu| < 1%` of the u-range **and** `|Δv| < 1%` of the v-range, else `max(|Δu|,|Δv|) < 2·max(UResolution(tol), tol/|S_u|, tol/|S_v|)` at the midpoint |
| Wire self-intersection | `SelfIntersect` | `SelfIntersectingWire` | pairwise 2D pcurve intersection (`Geom2dInt_GInter`, tolerance 1e-10, bbox prefilter, O(n²)); an intersection interior to an edge is accepted only if its 3D image is within `1.1·Tol(V)` of an edge vertex, or, for edges sharing a vertex, if 8 samples of each edge lie within `2·Tol(E)` of the segment from the vertex to the intersection point (the "yawn" test) |
| Face | `BRepCheck_Face` | `NoSurface`, `IntersectingWires`, `InvalidImbricationOfWires`, `BadOrientation`, `UnorientableShape` | wires may not intersect each other; nesting (`ClassifyWires`) is decided per wire by building a face from that wire alone and classifying the point at infinity (`BRepTopAdaptor_FClass2d`, tolerance 1e-9): IN means the wire is a hole. One sample point of every other wire is then classified. Rule: exactly one wire contains all others and nothing else contains anything, or no wire contains anything (all holes in an infinite face) |
| Shell | `BRepCheck_Shell` | `EmptyShell`, `NotConnected`, `RedundantFace`, `NotClosed`, `InvalidMultiConnexity`, `BadOrientationOfSubshape` | BFS over edge→face must be connected; each oriented edge must appear in exactly two oriented faces (closed); an edge with >2 faces is allowed only if the shell has one connected set; adjacent faces must use their shared edge with opposite orientations |
| Solid | `BRepCheck_Solid::Minimum` | `InvalidImbricationOfShells`, `EnclosedRegion`, `SubshapeNotInShape`, `BadOrientationOfSubshape` | a face shared by two shells is invalid; non-shell children must be INTERNAL; per closed shell, classify infinity (`BRepClass3d_SolidClassifier`) to call it hole or growth; more than one growth is `EnclosedRegion`; for each pair of shells, classify a point at parameter 0.43213918 of the first non-degenerate edge to test nesting |
| Others | | `InvalidPolygonOnTriangulation`, `InvalidToleranceValue`, `CheckFail` | mesh polygons vs edge within `Deflection + Tol(E)`; exception inside a check |

### Curve-on-surface deviation (`BRepLib_ValidateEdge.cxx`), DOCUMENTED

- **Default ("approx") mode:**
  - It samples 23 parameters uniformly (`myControlPointsNumber = 22`, `i = 0..22`) and takes `max |C3d(t) - S(pc(t))|`.
  - If the ranges differ or `SameParameter` is false, it uses endpoints plus `Extrema_LocateExtPC` point-to-curve projections in both directions.
  - It exits early once the tolerance is exceeded.
- **Error allowance:** the check passes if `dist < Tol(E) + max(PrecCurve, PrecSurface)`. `PrecCurve`/`PrecSurface` are `Epsilon(|coordinate|)`, the ulp of the largest center coordinate or radius, and are non-trivial only for ellipses and cones (`BRepCheck.cxx`).
- **"Exact" mode** (`SetExactMethod`) delegates to `GeomLib_CheckCurveOnSurface`. Per knot interval it runs a particle-swarm global optimizer (`math_PSO`, about 310 evaluations) plus Newton polish (issue #1372). This is still sampling-based optimization, not a certified bound.

### BOPAlgo_ArgumentAnalyzer: what BRepCheck misses

`BOPAlgo_ArgumentAnalyzer.cxx`, `BOPAlgo_CheckStatus.hxx`, DOCUMENTED. The modes are:

| Check | Status | How it works |
|---|---|---|
| Argument types for the operation | `BadType` | |
| Self-interference | `SelfIntersect` | `BOPAlgo_CheckerSI` runs the General Fuse *intersection phase* non-destructively on one shape. Any interference between two *original* sub-shapes is reported, i.e. vertex/vertex, vertex/edge, edge/edge, edge/face and face/face contacts that are not topologically shared |
| Micro edges | `TooSmallEdge` | `IsMicroEdge` |
| Unrebuildable face | `NonRecoverableFace` | rebuild each face with `BOPAlgo_BuilderFace` |
| Merge vertices/edges/faces | `IncompatibilityOfVertex`, `IncompatibilityOfEdge`, `IncompatibilityOfFace` | |
| Continuity | `GeomAbs_C0` | C0 geometry |
| Curve on surface | `InvalidCurveOnSurface` | |
| Tangency | none | `TestTangent()` has body `// not implemented` |

The Boolean spec gives two textbook cases of shapes that are "valid in terms of BRepCheck_Analyzer" but self-interfered and therefore unusable as Boolean arguments. DOCUMENTED (Boolean spec):

- an edge whose two vertices have `Tol = 0.5` while lying 0.698 apart, so the balls overlap;
- a solid containing a vertex with `Tol(V) = 50.00008`.

### ShapeFix: repair policy (guide), DOCUMENTED

- **Parameters:** `Precision` (default 1e-7), `MinTolerance` (edges shorter than this may be removed), `MaxTolerance` (a fix that needs a larger tolerance fails).
- **Three repair mechanisms,** chosen by `ModifyTopologyMode` (default false) and `ModifyGeometryMode` (default true):
  1. increase a vertex or edge tolerance;
  2. change topology (add, remove or replace edges or vertices);
  3. change geometry (move a vertex, re-trim curves, recompute a pcurve or 3D curve).
- **Flags:** every fix has a `Fix...Mode` flag: `-1` = automatic, `1` = force, `0` = forbid.
- **Status:** a bitset `ShapeExtend_{OK, DONE1..8, FAIL1..8}` per method.
- **History:** kept by `ShapeBuild_ReShape` (a replace/remove map with `Apply`).
- **`ShapeFix_Wire::Perform` order:** `FixReorder` → `FixSmall` → `FixConnected` → `FixEdgeCurves` → `FixDegenerated` → `FixSelfIntersection` → `FixLacking`. All but the first assume an ordered wire.
  - `FixConnected` merges end vertices if they coincide within precision, and always copies edges.
  - `FixEdgeCurves` covers reversed pcurves, missing pcurves or 3D curves, seam pcurves, period shifts (`FixShifted`), and SameParameter (usually by *raising the edge tolerance*).
  - `FixSelfIntersection` either cuts edges or raises vertex tolerances up to `MaxTolerance`.
  - `FixLacking` inserts an edge where a wire is closed in 3D but open in UV.
- **Other entity-level tools:**
  - `ShapeFix_Face`: wire orientation, natural bounds for a face without wires, missing seam, small-area wires.
  - `ShapeFix_Shell`: coherent face orientation, split into several shells if non-orientable (Möbius).
  - `ShapeFix_Solid`: solid from shell.
  - `ShapeFix_FixSmallFace`: spot faces and strip faces.
  - `ShapeFix_Wireframe`: 2D/3D gap filling, and merging small edges with a limit angle.
- **Analysis-only tools:**
  - `ShapeAnalysis_Shell`: free and bad edges.
  - `ShapeAnalysis_FreeBounds`: with a sewing tolerance, *predicts* the free bounds after sewing.
  - `ShapeAnalysis_ShapeTolerance`: min, max and average tolerance per entity type.
  - `ShapeAnalysis_CanonicalRecognition`: recognizes B-spline curves and surfaces as line, circle, ellipse, plane, cylinder, cone or sphere within a maximum deviation.
- **Upgrade tools:**
  - `ShapeUpgrade_UnifySameDomain`: merge faces and edges lying on coincident geometry, with `Generated()` history.
  - Splitting by continuity, angle, area or closedness.
  - Conversion to Bézier.

## Robustness and guarantees

- **Nothing is certified.** All checks are IEEE double with fixed absolute tolerances (1e-7, 1e-9, 1e-10). Curve-on-surface consistency is sampled at 23 points by default, or optimized by PSO in "exact" mode. A deviation spike between samples is missed. DOCUMENTED (code). INFERRED consequence: `IsValid() == true` is evidence, not proof.
- **Heuristic accept rules are baked in.** Examples: 1% of the parametric range as a 2D closure quick-accept, a `1.1×` vertex tolerance, the 8-sample `2×Tol(E)` yawn test, and a single sample point per wire for nesting. DOCUMENTED (code). These make the analyzer permissive on some faces with large parametric ranges. INFERRED.
- **BRepCheck-valid is not Boolean-valid.** Self-interference is outside BRepCheck. DOCUMENTED (Boolean spec examples). The tangency argument check is unimplemented. DOCUMENTED (code).
- **Tolerance inflation.** Healing's default fix for most geometric inconsistencies is to raise tolerances, up to `MaxTolerance`. Tolerances then propagate: a vertex must cover `max(TolV, TolE)`. The result is shapes that are "valid" only because their tolerance balls have grown, which is exactly what makes them self-interfered for the next Boolean. INFERRED from the guide plus the Boolean spec examples, and consistent with issue #1541 below.

## Parallelism and performance

- `BRepCheck_Analyzer::Perform` runs the contextual checks in parallel via `OSD_Parallel::For` with per-shape mutexes. The `checkshape -parallel` DRAW command exists, and `tests/heal/checkshape` (bug 27814) measures single- vs multi-threaded time. DOCUMENTED. No numbers are published in the test scripts.
- FreeCAD's docs offer a "Single-threaded" option: "This is slower, but more stable". DOCUMENTED on the FreeCAD wiki, HEARSAY as to root cause. OCCT issue #1179 is a thread-safety investigation on arm64 macOS for 8.0.0-rc4.
- Cost hot spot:
  - Issue #1372 (2026-07): `GeomLib_CheckCurveOnSurface` is **17.9% of all instructions** in a `BRepAlgoAPI_Cut` of a 128×128×5 plate by 9 rounded-box tools. That is about 620 evaluations per knot sub-interval to measure a deviation of about 1e-16 for analytic line/circle on plane/cylinder pairs. DOCUMENTED (issue, callgrind).
  - INFERRED lesson: sampling or optimization checks on analytic pairs waste time that a closed-form bound avoids.

## Known failures, limitations, war stories

- https://github.com/Open-Cascade-SAS/OCCT/issues/1371 (open, 2026-07): `BRepFilletAPI_MakeFillet` on a closed B-spline rim returns `IsDone()` with zero faulty contours. `BRepCheck_Analyzer` rejects the result and `BRepAlgoAPI_Check` finds self-intersections and 8 small edges. "The silent success is the damaging part."
- https://github.com/Open-Cascade-SAS/OCCT/issues/1315 (open): a twisted, self-intersecting `ThruSections` ruled loft is reported **valid** by `BRepCheck_Analyzer`, and its volume is 9% of the expected value. This is a false negative of the validity check.
- https://github.com/Open-Cascade-SAS/OCCT/issues/1541 (open, 2026-09): `UnifySameDomain` on a *valid* box-minus-sphere cut makes it invalid. Vertex tolerance explodes to 0.6153 (the circle diameter) because of a 180° phase inversion between the 3D circle and the rebuilt pcurve. The root cause is argument order in `Geom2dConvert::ConcatC1`. So an upgrade tool breaks validity.
- https://github.com/Open-Cascade-SAS/OCCT/issues/666: the output of `ShapeFix_Shape` defeats `UnifySameDomain`.
- https://github.com/Open-Cascade-SAS/OCCT/issues/986: users ask for a way to track `TopoDS_Shape` identities through `ShapeFix_Shape`. Healing breaks naming.
- Crashes inside healing itself:
  - https://github.com/Open-Cascade-SAS/OCCT/issues/1322: `ShapeFix_Shape` heap corruption on a prism extruded from a self-intersecting face;
  - https://github.com/Open-Cascade-SAS/OCCT/issues/1409, https://github.com/Open-Cascade-SAS/OCCT/issues/1378: SIGSEGV on a null ReShape context;
  - https://github.com/Open-Cascade-SAS/OCCT/issues/1383: out-of-range exception while adding a planar pcurve.
- https://github.com/Open-Cascade-SAS/OCCT/issues/1496: `BRepAlgoAPI_Common` of two identical swept solids silently returns an empty or negative result with `IsDone() == true`.
- FreeCAD states "FreeCAD has no methods to automatically repair geometry." Faults must be fixed by editing the modelling steps. DOCUMENTED (Part_CheckGeometry wiki). That is the same stance wonky takes.

## Relevance for wonky

**Where it plugs in:** wonky's validator (today `kernel/ports/curved-validate.bend::audit`, which checks topology, an edge-gap `required` vs `allowance` budget, and positive volume), Boolean pre- and post-conditions, STEP import, and test-fixture generation.

1. **Use the status table as the invariant checklist.** Every BRepCheck row above becomes an explicit wonky check with a typed failure reason carrying the faulty entity ids. FreeCAD's "click the error, see the edge" UX becomes wonky's viewer/review highlight and a structured JSON finding for LLM authors. INFERRED.
2. **Split checks by numeric class, and make each exact or certified.**
   - *Combinatorial* checks need no geometry and are exact over U32 ids:
     - wire connectivity, even vertex incidence and redundant edges;
     - shell edge-use count = 2 with opposite orientation;
     - redundant faces, connected components, shell/face imbrication;
     - Euler characteristic.
     In Bend each is a fork-join map that emits `(key, use)` pairs, then a sort/group-by and a reduction. That is uniform work and GPU-friendly. Connectivity is label propagation (pointer jumping) in O(log n) rounds instead of BFS.
   - *Geometric consistency* (vertex on curve, curve on surface): wonky's edges are analytic (line, circle, ellipse) on analytic surfaces (plane, cylinder, cone). The residual `|C3d(t) − S(pc(t))|` is a low-degree trigonometric polynomial. `kernel/curve-band.bend` already computes certified interval bounds of curve-to-plane distance over a whole interval. Extend it to curve-to-cylinder/cone residuals instead of copying OCCT's 23-sample or PSO scheme. Issue #1372 shows the sampling approach is also the slow one.
   - *Nesting and orientation* (face wire nesting, shell nesting, hole vs growth): use exact orientation/winding predicates (multi-limb integers on F32x2 words, as in `robust-predicates.bend`) over trimming loops in parameter space. OCCT's single-sample-point classification is a known weak spot, and ties must fail explicitly.
3. **Adopt the BOP-level "self-interference" check as a first-class invariant.** Two things BRepCheck lacks should be mandatory in wonky before and after every Boolean or fillet:
   - no two topologically unconnected entities (vertex, edge or face) may come within their combined allowance;
   - no edge may be shorter than the sum of its end-vertex allowances (micro edge).
   The Boolean spec's two examples (overlapping vertex balls on one edge, a 50 mm vertex tolerance) become regression fixtures. INFERRED.
4. **Never heal silently; treat tolerance growth as an event.** ShapeFix mostly "fixes" by raising tolerances, and issue #1541 shows tolerance explosion from an upgrade step. Wonky's rule ("approximations need explicit tolerances, unsupported cases fail") implies:
   - (a) no automatic `FixSameParameter`-style growth;
   - (b) any allowance increase is a recorded provenance event with its cause;
   - (c) a `MaxTolerance` equivalent is a hard failure threshold, not a tuning knob.
   `ShapeBuild_ReShape`'s replace map is the right *shape* for recording such history. Issue #986 shows what happens without it: naming loss.
5. **STEP import path.** The guide's catalogue (missing seams, reversed pcurves, UV-open wires closed in 3D, small edges, strip faces) is exactly what imported STEP files contain.
   - A wonky importer should run a ShapeAnalysis-style *report* first.
   - Then it applies explicit, logged, opt-in repairs, in the style of the ShapeProcess resource file but deterministic and stored with the import provenance.
   - `ShapeAnalysis_CanonicalRecognition` (B-spline → plane, cylinder or cone within a deviation) is how imported freeform faces would map into wonky's analytic surface set.
6. **Testing.**
   - Build invalid fixtures for each status code: seam missing, reversed wire, self-intersecting wire, lacking edge, free edge, multi-connexity, enclosed region, and the two Boolean-spec self-interference cases.
   - Mine `tests/heal/*` group names (`fix_gaps`, `same_parameter`, `wire_tails_*`, `unify_same_domain`) for categories.
   - The false-negative issue #1315 (twisted loft reported valid) gives a test that wonky's validator must *reject*.
7. **Bend fit summary.** Everything here is per-entity independent work followed by reductions. There is no shared mutable state once statuses are values instead of mutex-guarded maps. The only non-uniform parts are pairwise wire self-intersection (do a sort-and-sweep or BVH pass first) and solid classification. INFERRED.

## Pointers worth porting or studying

- `BRepCheck_Status.hxx`: the complete failure vocabulary. Mirror it as wonky's validator enum, with dimension and context.
- `BRepCheck_Analyzer.cxx::Put/Perform/IsValid`: the Minimum-then-InContext two-phase structure and the gating rule (skip wire orientation when pcurves are bad).
- `BRepCheck_Wire.cxx`:
  - `Closed` (lines 283-429): combinatorial closure. Port directly as an idea.
  - `IsDistanceIn2DTolerance` (lines 440-520): the 1% heuristic, an example of what *not* to copy.
  - `SelfIntersect` (lines 1074-1741): the vertex-ball and yawn acceptance rules, i.e. what a tolerant kernel must decide about "intersections at a shared vertex".
- `BRepCheck_Face.cxx::ClassifyWires` (lines 306-460): the wire-nesting rule "one outer contains all, others contain none".
- `BRepCheck_Shell.cxx::Closed/Orientation`: edge-use parity and opposite-orientation rules.
- `BRepCheck_Solid.cxx::Minimum`: hole vs growth via classifying infinity; the `EnclosedRegion` rule.
- `BRepLib_ValidateEdge.cxx`: 23-sample deviation and ulp-based allowance (`correctTolerance`). Contrast with a certified bound.
- `BOPAlgo_ArgumentAnalyzer.cxx`: `TestSelfInterferences` via non-destructive General Fuse; `TestSmallEdge`.
- Boolean spec sections "Pave, Pave Block, Shrunk Range" (tolerance semantics of `Tol(V1) + Tol(C)`) and "Fuzzy Boolean Operation" (gap and embedding handling with measured gap values 5e-5, 1e-6, 1e-5, 6e-5; one case 45× faster with fuzzy).
- Guide sections "Repairing tool for wires" (fix order), "Flags Management", and "Analysis of shell validity and closure".

## Verdict: learn-from

Use BRepCheck's status taxonomy, the two-phase intrinsic/contextual structure, and the BOP argument checker's self-interference test as wonky's validator specification and fixture catalogue. Re-implement each check exact or certified in Bend: combinatorial checks over U32 ids, geometric residuals via analytic interval bounds rather than 23-point sampling, and nesting via exact predicates.

Do not adopt the healing philosophy:

- silent tolerance growth;
- heuristic accept rules;
- "valid" meaning "passed sampled checks".

The open issues (#1315 false valid, #1371 silent success, #1541 healing-induced invalidity) are the argument for wonky's explicit-failure stance.

LGPL code is not transcribed.
