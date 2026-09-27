# OCCT BRepCheck_Status and BOPAlgo_ArgumentAnalyzer

- Kind: C++ validation API, implementation and documentation. Canonical [BRepCheck_Status reference](https://occt3d.com/dev/doc/refman/html/_b_rep_check___status_8hxx.html); [repository](https://github.com/Open-Cascade-SAS/OCCT). Read source pinned to [3d097a0328e71b826377d4814ab05ec3c3d23871](https://github.com/Open-Cascade-SAS/OCCT/commit/3d097a0328e71b826377d4814ab05ec3c3d23871).
- Authors/organization: Open CASCADE SAS and earlier Matra Datavision; BRepCheck header credits Jacques Goussard (1995), ArgumentAnalyzer header Oleg Fedyaev (2004), CheckStatus Peter Kurnev. DOCUMENTED: source headers linked below.
- License: LGPL-2.1 with OCCT exception, alternatively commercial license. The [exception](https://github.com/Open-Cascade-SAS/OCCT/blob/master/OCCT_LGPL_EXCEPTION.txt) permits specified header material in object-code works using the library with notice; it is not a blanket permission to copy implementation into a proprietary kernel. INFERRED recommendation: independently implement the validation concepts and own diagnostic schema; do not translate implementation text without a licensing decision. Private study is different from redistribution.
- Status/activity, observed 2026-09-24: DOCUMENTED [GitHub API](https://api.github.com/repos/Open-Cascade-SAS/OCCT): C++, repository size 217226 KiB (GitHub repository-size metric, not source LOC), 2910 stars, 684 forks, not archived. [Latest default-branch commit](https://api.github.com/repos/Open-Cascade-SAS/OCCT/commits?per_page=1) dated 2026-08-24; pushed_at 2026-09-05 is not that commit date. 219 contributor records counted from [paginated contributors including anonymous](https://api.github.com/repos/Open-Cascade-SAS/OCCT/contributors?per_page=100&anon=true). Latest [release V8.0.1](https://github.com/Open-Cascade-SAS/OCCT/releases/tag/V8.0.1), 2026-07-30. Mature industrial library; that does not make its validation complete.

## What it is

DOCUMENTED: two different layers, not interchangeable certificates. `BRepCheck_Analyzer` checks topology and geometric representation consistency of a shape and subshapes in context. `BOPAlgo_ArgumentAnalyzer` performs selected operation-dependent Boolean input checks and returns localized fault records. [Analyzer contract](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKTopAlgo/BRepCheck/BRepCheck_Analyzer.hxx), [ArgumentAnalyzer contract](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKBO/BOPAlgo/BOPAlgo_ArgumentAnalyzer.hxx).

Important corrections to the brief: DOCUMENTED there are **37 enum values including NoError**, not 37 distinct failure types. All nine ArgumentAnalyzer modes default **false**. `TangentMode` exists publicly but `TestTangent()` is **not implemented**. Face-merge checking also has a not-implemented branch; there is no public MergeFaceMode here. Merely constructing the analyzer and calling `Perform()` is not a meaningful validation gate. [Actual implementation](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKBO/BOPAlgo/BOPAlgo_ArgumentAnalyzer.cxx).

## How it works

DOCUMENTED [status header](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKTopAlgo/BRepCheck/BRepCheck_Status.hxx), grouped here by concept (prefix BRepCheck_ omitted):

- Success: NoError.
- Point/support consistency: InvalidPointOnCurve, InvalidPointOnCurveOnSurface, InvalidPointOnSurface.
- Curve/surface representation: No3DCurve, Multiple3DCurve, Invalid3DCurve, NoCurveOnSurface, InvalidCurveOnSurface, InvalidCurveOnClosedSurface, NoSurface.
- Parametric/degeneracy metadata: InvalidSameRangeFlag, InvalidSameParameterFlag, InvalidDegeneratedFlag, InvalidRange.
- Edge/wire incidence: FreeEdge, InvalidMultiConnexity, EmptyWire, RedundantEdge, SelfIntersectingWire, InvalidWire, RedundantWire, IntersectingWires, InvalidImbricationOfWires.
- Shell/solid incidence and orientation: EmptyShell, RedundantFace, InvalidImbricationOfShells, UnorientableShape, NotClosed, NotConnected, SubshapeNotInShape, BadOrientation, BadOrientationOfSubshape, EnclosedRegion.
- Other: InvalidPolygonOnTriangulation, InvalidToleranceValue, CheckFail.

DOCUMENTED: BRepCheck builds a shape-to-result indexed map, recursively adds subshapes, then checks relationships in context (vertex on edge, edge/wire on face, shell on solid). Thus an entity may be valid by itself but fail on a particular support face. For an edge C and pcurve P on surface S, the key geometric contract is `||C(t) - S(P(t))|| <= edgeTolerance`, with matching ranges and SameParameter/SameRange flags. Closed face wires, hole nesting, shell closure and orientation are additional contracts. [Implementation](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKTopAlgo/BRepCheck/BRepCheck_Analyzer.cxx), [contract](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKTopAlgo/BRepCheck/BRepCheck_Analyzer.hxx).

DOCUMENTED concrete pre-Boolean modes, from [ArgumentAnalyzer.cxx](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKBO/BOPAlgo/BOPAlgo_ArgumentAnalyzer.cxx):

1. **ArgumentType**: reject missing/empty operands as applicable. FUSE requires each operand to be homogeneous in dimension and both dimensions equal. CUT rejects `maxDim(A) > minDim(B)`; CUT21 uses the reversed test. COMMON is exempt from these dimension comparisons. A single nonempty shape is allowed only with UNKNOWN operation.
2. **SelfInter**: run `BOPAlgo_CheckerSI` separately on both inputs, non-destructively, forwarding parallel and fuzzy-tolerance settings. Convert interference pairs of original shapes (ignore new generated shapes) into SelfIntersect records. Checker errors become OperationAborted.
3. **SmallEdge**: skip explicitly degenerate edges, call `IsMicroEdge`. SECTION has a special filter: only keep a short-edge fault if an endpoint is within the summed endpoint/support tolerance of the other operand. This is not a single global edge-length cutoff.
4. **RebuildFace**: skip SECTION and UNKNOWN. Collect face boundary edges; represent INTERNAL edges with both directions; run `BOPAlgo_BuilderFace`. Require exactly one resulting area and preservation of boundary-edge occurrence count. Failure is NonRecoverableFace. This is a dry-run reconstruction invariant.
5. **Tangent**: no-op in inspected version.
6. **MergeVertex/MergeEdge**: deduplicate input subshapes, evaluate an all-pairs compatibility matrix and flag any row or column with more than one match. Vertices match if Euclidean distance is at most the sum of their tolerances. Edges match if `IntTools_EdgeEdge` finds an EDGE common part. This detects ambiguous many-to-one merging, not merely proximity.
7. **Continuity**: report supporting curves or surfaces whose own continuity is C0; it is not a prohibition on ordinary sharp intersections between two smooth faces.
8. **CurveOnSurface**: `ComputeTolerance(face, edge, maxDistance, parameter)`; if successful and distance exceeds edge tolerance, emit InvalidCurveOnSurface and retain face, edge, offending parameter and maximum distance. No fault is added by this routine when ComputeTolerance returns false: the absence of a reported discrepancy is not proof that the discrepancy was computed.

DOCUMENTED: [BOPAlgo_CheckStatus](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKBO/BOPAlgo/BOPAlgo_CheckStatus.hxx) has 12 values including CheckUnknown and NotValid; not every listed value is emitted by this class. [BOPAlgo_CheckResult](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKBO/BOPAlgo/BOPAlgo_CheckResult.hxx) stores operand identities, lists of faulty subshapes on each side, status, and max-distance/parameter witnesses. Numeric computations use double and shape-local tolerances, not exact arithmetic.

## Robustness and guarantees

DOCUMENTED: default BRepCheck geometric checking samples a finite number of points and its header explicitly warns the result can be incorrect. `theIsExact=true` uses `BRepLib_CheckCurveOnSurface` only for SameParameter edges; this is the name of a more complete floating-point distance method, **not an exact-rational predicate proof**. InvalidTolerance checks are marked NYI for several entity classes. Read the constructor parameters as part of the result's provenance. [Header](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKTopAlgo/BRepCheck/BRepCheck_Analyzer.hxx).

DOCUMENTED: ArgumentAnalyzer catches Standard_Failure and appends CheckUnknown. `HasFaulty()` means only that the result list is nonempty. Some cancellation checks return early, and StopOnFirst is applied unevenly (the initial type and self-interference phases are not globally short-circuited by it). No completeness theorem, fixed universal epsilon or certified Boolean-success implication was found in the inspected sources. INFERRED: wonky must keep `passed`, `failed`, `not-run`, `unsupported`, `cancelled`, `numeric-uncertain` distinct instead of treating an empty fault list as success. [Implementation](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKBO/BOPAlgo/BOPAlgo_ArgumentAnalyzer.cxx).

## Parallelism and performance

DOCUMENTED: BRepCheck partitions the indexed map into tasks, initially ten times thread count with a minimum task size of ten, and calls `OSD_Parallel::For`; contextual results use mutex protection. ArgumentAnalyzer forwards parallel mode to CheckerSI but its top-level modes and merge matrices are sequential loops. The all-pairs merge matrix requires O(n*m) storage and comparisons by inspection, before cost of individual geometric tests. [BRepCheck implementation](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKTopAlgo/BRepCheck/BRepCheck_Analyzer.cxx), [argument implementation](https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKBO/BOPAlgo/BOPAlgo_ArgumentAnalyzer.cxx).

No general validation throughput benchmark was found. DOCUMENTED, reporter measurement, not reproduced: [issue #1385](https://github.com/Open-Cascade-SAS/OCCT/issues/1385) records 619 seconds CPU before external termination despite a 30-second cooperative deadline on OCCT 8.0.0p1, with roughly 80% sampled time in linked-sequence indexing inside tangent-zone insertion. A proposed fix reports 0.547 seconds for a 0.5-second deadline and 30.1 seconds for 30 seconds; this is cancellation latency, not algorithm completion time. Issue was open when read.

## Known failures, limitations, war stories

- DOCUMENTED first-person report [#1385](https://github.com/Open-Cascade-SAS/OCCT/issues/1385): a degenerate self-intersecting single-face shell defeats coarse cancellation; validation itself needs bounded work and deep progress checks.
- DOCUMENTED report [#1315](https://github.com/Open-Cascade-SAS/OCCT/issues/1315): twisted ruled loft is reported valid by BRepCheck; measured volume about 1450 instead of expected convex-hull volume about 15700. This illustrates local consistency versus intended solid semantics, not a measured global false-negative rate.
- DOCUMENTED report [#1371](https://github.com/Open-Cascade-SAS/OCCT/issues/1371): fillet returns IsDone=true and no faulty contours/vertices, while independent BRepCheck and BRepAlgoAPI_Check find an invalid solid, self-intersections and eight sub-tolerance edges. Validate after success.
- DOCUMENTED report [#1193](https://github.com/Open-Cascade-SAS/OCCT/issues/1193): coplanar-wedge fuse passes ArgumentAnalyzer, then UnifySameDomain introduces self-intersections. Check after simplification/healing too. These reports were read, not locally reproduced.

## Relevance for wonky

INFERRED design adapted from the contracts above:

1. Add an immutable `ValidationReport` containing check set/version, operation, operand/provenance IDs, tolerances, completion state and a stable sorted array of fault witnesses. Use separate cheap structural, representation-consistency and expensive self-interference passes.
2. Before Boolean topology changes, validate closure/incidence, supported surface pairs, parameter-range legality and ambiguous merging; after Boolean, analytic recovery, face unification and STEP re-import, rerun appropriate passes. Validate operation semantics separately with volume/set identities: OCCT-style validity is necessary, not sufficient.
3. For pcurves record edge ID, face ID, parameter interval, measured upper bound and tolerance. F32x2 arithmetic can improve evaluation precision but does not extend F32 exponent range or automatically certify extrema. Use analytic bounds or interval subdivision for plane/cylinder/cone support; return explicit uncertainty when the bound cannot be established.
4. Do not translate mutable TopoDS maps, linked lists or locks. Map independent entity/support pairs into pure checks and balanced fork-join reductions; merge/deduplicate witness arrays deterministically. GPU batches should be grouped by entity/support type and bounded subdivision depth. Ragged general self-intersection belongs in scheduled/bucketed CPU fork-join work rather than one divergent GPU tree.
5. U32 supports statuses, IDs, incidence counts and bitsets. Exact multi-limb predicates help combinatorial classification; distance/tolerance checks still require a declared metric and numeric error bound. No f64 dependency is inherent in the taxonomy.
6. LLM ergonomics: distinguish a bad user sketch, unsupported surface class, inconsistent recovered pcurve and exhausted validation budget. Include reconstructible offending geometry, not only `BooleanFailed`. FDM acceptance additionally needs watertight mesh, certified tessellation deviation and minimum-feature policy, none of which this API alone guarantees.

## Pointers worth porting or studying

DOCUMENTED: `BRepCheck_Analyzer.hxx` validity definition and sampled-versus-exact caveat; `BRepCheck_Status.hxx` grouped error concepts; `BOPAlgo_ArgumentAnalyzer.cxx` constructor, TestTypes, TestRebuildFace, TestMergeSubShapes, TestCurveOnSurface and empty TestTangent; `BOPAlgo_CheckResult.hxx` witness payload. All reside in the pinned [TKTopAlgo/BRepCheck](https://github.com/Open-Cascade-SAS/OCCT/tree/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKTopAlgo/BRepCheck) and [TKBO/BOPAlgo](https://github.com/Open-Cascade-SAS/OCCT/tree/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKBO/BOPAlgo) directories.

## Verdict: adapt

Adopt the layered checking vocabulary and localized witness design, independently implemented in Bend. Do not copy the implementation, assume all advertised checks exist, equate sampled checks with proof, or promise that preflight acceptance guarantees Boolean success. Highest-value immediate pieces are explicit completion states, contextual pcurve witnesses, many-to-one merge diagnostics, and validation after analytic recovery and unification.

