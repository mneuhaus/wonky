# OCCT Boolean Operations specification (General Fuse Algorithm)

- Kind: official specification document plus the implementing source. Canonical URL: https://occt3d.com/dev/doc/overview/html/specification__boolean_operations.html
- Other URLs: markdown source `dox/specification/boolean_operations/boolean_operations.md` in https://github.com/Open-Cascade-SAS/OCCT ; implementation https://github.com/Open-Cascade-SAS/OCCT/tree/master/src/ModelingAlgorithms/TKBO (BOPAlgo, BOPDS, BOPTools, IntTools, BRepAlgoAPI).
- Read: HTML snapshot `tmp/research/occt-docs/boolean_ops.html`, converted to text (`boolean_ops.txt`), plus TKBO source at commit `3d097a0328e71b826377d4814ab05ec3c3d23871` (`tmp/research/occt-intpatch/occt/src/ModelingAlgorithms/TKBO`). Source link base: `https://github.com/Open-Cascade-SAS/OCCT/blob/3d097a0328e71b826377d4814ab05ec3c3d23871/src/ModelingAlgorithms/TKBO/`.
- Authors/organization: OPEN CASCADE SAS (the GFA was introduced around OCCT 6.6-6.7, 2013-2014). The document is continuously updated; the snapshot is the 2026 dev docs.
- License: documentation ships with OCCT, LGPL-2.1 with the OCCT exception. Implication (INFERRED): the *specification* describes algorithms and data structures, and implementing them from the description in new Bend code is ordinary clean-room practice. Translating TKBO source (~54k lines: BOPAlgo 29.5k, IntTools 15.1k, BOPTools 6.3k, BOPDS 3.4k) would be a derivative work.
- Status: active (see the OCCT repo data in the ImpImp note: 2,904 stars, last commit 2026-08-24, V8.0.1 2026-07-30). TKBO has GTests (`TKBO/GTests/*`: BOP, CellsBuilder, MakePeriodic, OpenSolid, PaveFiller, Cut/Fuse/Common, FaceFace, History).

## What it is

The most complete public description of an industrial B-rep Boolean pipeline. It defines four operators on one shared engine:
- **GFA**, General Fuse: split all arguments against each other, `GF(S1,S2) = Sp1 + Sp2 + Sp12`.
- **BOA**, Boolean: Fuse/Common/Cut/Cut21 = selections from the GF result.
- **SPA**, Splitter: Objects split by Tools.
- **SA**, Section: vertices/edges only.

Additional builders are MakerVolume and CellsBuilder. All share one **Intersection Part** (`BOPAlgo_PaveFiller`, the "PaveFiller") that fills a data structure (`BOPDS_DS`), and differ only in the **Building Part**.

## How it works

### Core concepts (DOCUMENTED, spec "Terms and Definitions")
- **Interference:** two shapes interfere where the distance between their geometries is `<= Tol(S1) + Tol(S2)`. There are six B-rep kinds (V/V, V/E, V/F, E/E, E/F, F/F) and four "non-B-rep" containment kinds (V/Z, E/Z, F/Z, Z/Z) for a shape completely inside a solid without touching it.
- **Results and tolerance growth:**
  - V/V: a new vertex at the center of the sphere enclosing both tolerance spheres, radius = new tolerance.
  - V/E: `Tol(Vi) = max(Tol(Vi), D + Tol(Ej))` plus parameter `t` on the edge.
  - V/F: `Tol(Vi) = max(Tol(Vi), D + Tol(Fj))` plus `(u,v)`.
  - E/E and E/F: common parts (parameter ranges) or common points (new vertices, enclosing-sphere rule).
  - F/F: intersection curves `C_ijk` with their own `Tol(C_ijk)`, plus points.
- **Computation order:** V/V, V/E, E/E, V/F, E/F, F/F, V/Z, E/Z, F/Z, Z/Z. Lower dimensions come first so that higher-dimensional interferences already implied by lower ones are skipped.
- **Pave** = (vertex, parameter on curve). **Pave block** = the part of an edge or intersection curve between neighboring paves. The **shrunk range** `[t1S, t2S]` is the part of a pave block outside both end-vertex tolerance spheres; only it can interfere with other shapes. **Common block** = pave blocks of different edges that coincide geometrically (and/or lie on faces). **FaceInfo** = per face, the pave blocks and vertices that are In, On, or built from section curves.
- **Argument requirements:** each argument must be valid for `BRepCheck_Analyzer`, **not self-interfered**, and have geometry of continuity **at least C1** (DOCUMENTED, spec "Arguments").

### Intersection Part (DOCUMENTED, spec + `BOPAlgo/BOPAlgo_PaveFiller.cxx` L254-L350)
The actual code order is:
1. **Init:** DS, bounding-box `BOPDS_Iterator` (AABB or optional OBB), `IntTools_Context` caches of classifiers/projectors.
2. **PerformVV:** pairs from the iterator, connexity chains of interfering vertices (`BOPAlgo_Tools::MakeBlocksCnx`), one new vertex per chain, "same-domain" (SD) mapping.
3. **PerformVE:** paves on edges, then split pave blocks.
4. **PerformEE:** shrunk data, then `IntTools_EdgeEdge` producing common parts. VERTEX parts become new vertices, merged by a recursive nested PaveFiller run on just those vertices. EDGE parts become common blocks by connexity chains.
5. **PerformVF, PerformEF:** same pattern with `IntTools_EdgeFace` and FaceInfo updates.
6. **RepeatIntersection** (`BOPAlgo_PaveFiller.cxx` L359-L423): every vertex whose tolerance was increased (tracked in `myIncreasedSS` by `UpdateVertex`, `BOPAlgo_PaveFiller_10.cxx` L105-L160) re-enters the VV/VE/VF passes. This is a fixed-point loop caused by tolerance inflation.
7. **ForceInterfEE, ForceInterfEF:** after vertex unification, re-look for common blocks among pave blocks with identical end vertices.
8. **PerformFF:** `IntTools_FaceFace` per face pair, run in parallel (`BOPAlgo_PaveFiller_6.cxx:529`). Then `MakeSplitEdges`.
9. **MakeBlocks:** "draft" section vertices and edges are created from section curves. Paves come from existing On/In vertices plus "technological" bound vertices with `Tol(C_ijk)`. Draft edges are kept only if In/On both faces and not coinciding with an existing pave block. Draft vertices and edges are then intersected again by another nested PaveFiller run (`PostTreatFF`).
10. **CheckSelfInterference, MakePCurves** (2D curves for every section edge and common block on both faces), **ProcessDE** (degenerated edges at poles/apexes).

### Building Part (DOCUMENTED, spec "General Fuse Algorithm" and "Boolean Operations Algorithm")
- Images are built bottom-up: vertices, edges, wires, faces, shells, solids, compsolids, compounds.
- **Faces:** collect split edges (orientation made coherent) plus section edges, then `BOPAlgo_BuilderFace` builds split faces. Loops are formed in UV by `BOPAlgo_WireSplitter`, which at each vertex takes the outgoing edge with the minimum **clockwise angle** computed from 2D tangents (`BOPAlgo_WireSplitter_1.cxx`: `Angle2D`, `ClockWiseAngle`, `RefineAngles`, 2D tolerances derived from vertex 3D tolerance via `UTolerance2D/VTolerance2D`). Then same-domain split faces are found (`BOPTools_AlgoTools::AreFacesSameDomain`), chained, and a representative is chosen.
- **Solids:** `FillIn3DParts` collects faces with 3D state IN each solid (state by one point: `BOPTools_AlgoTools::ComputeStateByOnePoint`, `BRepClass3d_SolidClassifier`). Then `BOPAlgo_BuilderSolid` assembles shells into split solids (growths vs holes).
- **BOA rules:**
  - Fuse keeps parts with state OUT relative to the other argument; dimension-3 Fuse also removes internal faces and rebuilds solids.
  - Common keeps IN and ON.
  - Cut12 keeps parts of S1 with OUT relative to S2.
  - Dimension rules: Fuse requires equal dimensions; Cut requires `Dim(S2) >= Dim(S1)`.
- **Open solids:** splitting of solids is bypassed; faces are selected by state per operation. The spec concedes correctness "cannot be always guaranteed" because face classification depends on the chosen test point.
- **History:** Modified/Generated/IsDeleted per input sub-shape (edges and faces can have Generated). This is the basis for OCAF naming.
- **Result simplification:** `SimplifyResult` via `ShapeUpgrade_UnifySameDom` merges tangent/coplanar faces and edges; history is merged.

### Options (DOCUMENTED, spec "Advanced Options")
- **Fuzzy:** an additional tolerance to treat touching, near-coincident and misaligned entities as coincident. The user must measure the gap and pass a slightly larger value. Examples: a box/cylinder shift of 5e-5; boxes 10 vs 10.000001; a 1e-5 gap; an edge overlap deviation of 5.28e-5 with fuzzy 6e-5.
- **Gluing:** `GlueShift` (partial coincidence) or `GlueFull` (full coincidence) skips F/F (and V/F, E/F) intersection. The user guarantees there are no real intersections, and the algorithm does not check this.
- **Safe mode:** `SetNonDestructive` copies instead of modifying input tolerances and pcurves.
- **CheckInverted** off skips classifying solids as negative volumes.
- **OBB** for tighter broad phase. **Parallel** mode. Errors and warnings go through `Message_Report` (`BOPAlgo_Alerts.hxx`).

### Documented limitations (spec "Algorithm Limitations")
- Validity per `BRepCheck_Analyzer` is necessary but insufficient. The analyzer checks 3D curve against pcurve at a fixed number of points (e.g. 23). A split edge can therefore fail a check its parent passed.
- Self-interference: a compound of two overlapping edges, self-intersecting edges and faces, and revolution faces that overlap themselves are all invalid inputs. There are also self-interference "due to tolerances": vertex spheres of one edge overlapping (D = 0.698 < 2×0.5), or a vertex tolerance of 50 covering unrelated sub-shapes.
- **Parameterization at scale:** cylinder R=3 vs R=3000 (×1000). Beyond ScF ~1e6, sloped pcurves become near-vertical and `acos` loses angle accuracy, breaking face/solid building.
- Using vertex tolerances to bridge gaps leaves the trajectory undefined, which breaks face building.
- **Pure intersection vs common zone:** for curves of different analytic type (line/circle), the result is always a vertex, never a common block, even when the tolerance tube overlap is a zone. `IntPatch_Intersection` cannot consume curve/point common zones.
- Near-coincident edges (deviation 1e-6 > tolerance 1e-7) produce three spurious vertices and 8 edges instead of a common block. The advice is to raise tolerances or use a better model.
- Acquired self-interference: a vertex interfering with both ends of a short edge, or with two edges of a wire.

## Robustness and guarantees

- DOCUMENTED: no guarantee is claimed. The spec states failures come from "self-interfered arguments, inappropriate or ungrounded values of the argument tolerances, adverse mutual position of the arguments, tangency, etc." and from bugs in intersection, projection, approximation and classification.
- The data model is **tolerant**: geometry need not be consistent, only within `Tol`. The algorithm repairs locally by **growing** vertex and edge tolerances and repeats intersections for grown vertices (RepeatIntersection). Fuzzy mode lets users trade exactness for success.
- Heuristic parts: WireSplitter angle ordering in UV (float angles, 2D tolerances derived from 3D), point-state classification of split faces (single interior point, ray-based solid classifier), same-domain detection.

## Parallelism and performance

- DOCUMENTED (code): `BOPTools_Parallel::Perform(myRunParallel, …)` runs E/E (`BOPAlgo_PaveFiller_3.cxx:277`, `:1247`), F/F (`BOPAlgo_PaveFiller_6.cxx:529`), split-face building (`BOPAlgo_Builder_2.cxx:521`), split-solid preparation (`:805`) and in-3D-parts filling (`:990`) over vectors of independent tasks. Per-task `IntTools_Context` caches are used. Parallel mode is off by default.
- DOCUMENTED (spec) measured numbers: Fuzzy gave a **45×** speedup on the near-coincident-edge case (i5-3450). Gluing gave **~70%** time reduction for fusing 64 B-spline boxes and for sewing IGES faces, "in some case can go up to 90%". Disabling CheckInverted saves "up to 10 percent" with many input solids. Progress-step weights in code (`fillPISteps`, `BOPAlgo_PaveFiller.cxx` ~L460-L472) encode the relative cost estimates EE 5×, VF 5×, EF 10×, FF 30× per pair (INFERRED: a proxy for measured cost).

## Known failures, limitations, war stories

- #1496 (closed 2026-08-23): `BRepAlgoAPI_Common` of two geometrically identical swept solids (separately built) returns empty or negative volume with `IsDone() == true`. The trigger is a cylinder-torus-cylinder G1 junction from `MakePipeShell`. https://github.com/Open-Cascade-SAS/OCCT/issues/1496
- #1543 (open 2026-09-16): Cut with a helical sweep silently removes nothing depending on the cylinder seam angle. The same arguments give Common empty and Fuse two solids. `SetFuzzyValue(1e-6…1e-4)`, OBB, parallel and non-destructive modes do not help. https://github.com/Open-Cascade-SAS/OCCT/issues/1543
- #1041 (open 2026-02-01): Fuse fails for rotated copies of a shape (FreeCAD #27252). https://github.com/Open-Cascade-SAS/OCCT/issues/1041
- #245 (open 2025-01-06): Cut fails when argument and tool share a common edge, but works after a tiny rotation or offset. https://github.com/Open-Cascade-SAS/OCCT/issues/245
- #1360 (open, legacy 33090): access violation in fuzzy Booleans (`IntTools_SurfaceRangeLocalizeData`). https://github.com/Open-Cascade-SAS/OCCT/issues/1360
- #1385 (open): `BOPAlgo_ArgumentAnalyzer` self-interference check has unbounded runtime. https://github.com/Open-Cascade-SAS/OCCT/issues/1385
- Pattern (INFERRED from these): the silent wrong answer with `IsDone() == true` is the dominant failure class, and the triggers are seams, shared or coincident sub-shapes, and tangent junctions. These are exactly the "degenerate categories" in the spec.

## Relevance for wonky

- **Checklist of degenerate categories** that any wonky Boolean must handle or reject explicitly (INFERRED from the spec): V on V, V on E, V on F, E∥E overlap (common block), E in F, F∥F coincident (same domain), shapes completely inside another solid (non-B-rep interferences), seams of periodic faces, degenerated edges at apexes and poles, open solids. wonky's bake-off prototypes should each report a classified outcome per category.
- **What to adopt structurally:** computation by increasing dimension; paves and pave blocks shared by both faces (wonky's `ports/occt.bend` already does this for one plane); common blocks as the canonical representation of overlapping edges; same-domain face chains; history (Modified/Generated/Deleted), which maps directly onto wonky's provenance and topology identity; nested re-intersection of newly created vertices and edges.
- **What not to adopt:** tolerance growth (`Tol = max(Tol, D + Tol')`), RepeatIntersection and Fuzzy. wonky's rule is explicit, certified tolerances plus explicit failure. INFERRED consequence: with exact/certified incidence decisions and no tolerance inflation, the RepeatIntersection fixed point disappears. The pipeline becomes a fixed DAG: map over V/V candidates, merge; map V/E, merge; …; map F/F, merge. That is exactly balanced fork-join (per-class `map` over bbox pairs, with the merge as a sorted reduction keyed by entity ID).
- **Pure intersection rule** ("different analytic curve types give vertices, never common blocks"). For exact inputs a line and a circle can only meet in points, so this rule is *true* for wonky rather than a limitation. Keep it as an invariant.
- **Face building:** WireSplitter's minimum-clockwise-angle rule in UV is the standard loop-tracing rule. Floating angles are its weak point (spec: acos at scale 1e6). In wonky, order edges around a vertex by exact orientation predicates on 3D tangent directions projected into the face tangent plane. For tangent edges (equal first-order direction) compare curvature, i.e. second order, or return `Unresolved`. Never use UV angles of periodic parameterizations.
- **Classification:** OCCT classifies each split face by one interior point against the other solid (ray classifier). wonky can do the same with an exact/certified ray-parity or winding-number predicate. Its hybrid (mesh Boolean decides topology) can alternatively inherit face states from the tagged mesh.
- **GPU fit:** F/F intersection is a batch of heterogeneous tasks. Sort pair tasks by surface-type pair (the ImpImp table) to get uniform GPU work per bucket (INFERRED).
- **Testing:** the spec examples (fuzzy cases 1-4, gluing boxes, the limitation figures) are ready-made regression scenarios. The DRAW scripts in the spec (`bfillds`, `bbop`, `savehistory`, `isdeleted`, `modified`, `generated`) define the expected history semantics.

## Pointers worth porting or studying

- Spec sections: "Terms and Definitions" (interference formulas, paves, shrunk range, common blocks), "Intersection Part" tables (implementation class per step), "Build Images for Faces/Solids", "Boolean Operations Algorithm: Results. General Rules", "Algorithm Limitations", "History Information".
- Code: `BOPAlgo/BOPAlgo_PaveFiller.cxx` L254-L350 (true step order), L359-L423 (RepeatIntersection: the feedback loop to eliminate); `BOPAlgo/BOPAlgo_PaveFiller_10.cxx` L63-L160 (tolerance updates); `BOPAlgo/BOPAlgo_WireSplitter_1.cxx` (loop tracing by angle); `BOPDS/BOPDS_PaveBlock.cxx`, `BOPDS/BOPDS_CommonBlock.cxx` (data structures); `BOPTools/BOPTools_AlgoTools.cxx` L623-L760 (state by one point); `TKBO/GTests/BOPAlgo_PaveFiller_Test.cxx`, `BRepAlgoAPI_*_Test.cxx`, `BRepTools_History_Test.cxx` (test ideas).

## Verdict: learn-from

This is the best available specification and checklist for a general B-rep Boolean, and wonky has already adapted parts of it. Adopt its decomposition (ordered interference classes, pave and common blocks, same-domain faces, history) and its list of degenerate categories. Reject its numeric philosophy (tolerance growth, fuzzy, repeat-until-stable), which contradicts wonky's certified-tolerance, fail-explicitly rules and is the root of the "IsDone but wrong" failures visible in the 2025-2026 issue tracker.
