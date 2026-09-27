# Region semantics elsewhere: FreeCAD face makers (Bullseye, Cheese, BuildFace, Unified 2026) and SolveSpace loop nesting

- Kind: open-source CAD code (two projects) as behavioural references for "which faces does a sketch make".
  - **FreeCAD:** [FreeCAD/FreeCAD `src/Mod/Part/App`](https://github.com/FreeCAD/FreeCAD/tree/main/src/Mod/Part/App): `FaceMakerBullseye.{h,cpp}`, `FaceMakerCheese.cpp`, `FaceMakerBuildFace.{h,cpp}`, `WireJoiner.h`, plus the tests `src/Mod/Part/parttests/TestFaceMakerUnifiedPlanar.py` (554 lines). Fetched via `gh api` into `tmp/research/freecad-facemaker/`. PR [#28788 "add FaceMakerUnified"](https://github.com/FreeCAD/FreeCAD/pull/28788) (xorza, merged 2026-06-22) read.
  - **SolveSpace:** `src/srf/curve.cpp` `SBezierLoopSetSet::FindOuterFacesFrom` l.578-680, `src/polygon.cpp` `SPolygon::FixContourDirections` l.706-736, `src/groupmesh.cpp` l.712-729 (error texts), in the local clone `tmp/research/solvespace-srf/ss` (commit `cbff7a9`, 2026-09-16).
- Organizations: FreeCAD project (FaceMakerBullseye by DeepSOIC 2016, WireJoiner by Zheng Lei/realthunder 2022, BuildFace/Unified by xorza 2026); SolveSpace (Jonathan Westhues et al.).
- License: FreeCAD **LGPL-2.1+** (33,740 stars, pushed 2026-09-24); SolveSpace **GPL-3.0**. Behaviour and test *ideas* are free to re-derive; do not copy code into wonky.
- Status: FreeCAD's face-maker defaults changed in 2026 (FaceMakerBuildFace, Toponaming fix 2026-04-06; Sketcher fix for self-intersecting B-splines and dangling edges 2026-04-13; FaceMakerUnified as new default 2026-06-22). SolveSpace's scheme is long-stable.

## What it is

Three different answers to "closed sketch curves → planar faces":

1. **Loop nesting, even-odd** (SolveSpace; FreeCAD Bullseye and Cheese): curves must already form closed, non-intersecting loops. Nesting depth decides outer vs hole.
2. **Arrangement faces, keep all** (Onshape; FreeCAD FaceMakerBuildFace): split all edges at mutual intersections and return *every bounded face* ([Onshape note](onshape-sketch-regions-sksolve-qsketchregion-semantics.md)).
3. **Arrangement faces + even-odd fill** (FreeCAD FaceMakerUnified, default since 2026-06): arrangement faces, then keep only faces at odd nesting depth, after fusing overlapping closed wires into union outlines.

## How it works

- **SolveSpace (DOCUMENTED, code).**
  - `SBezierLoopSet::From` assembles curves into closed loops. Failure produces the messages "not closed contour, or not all same style!", "points not all coplanar!", "contour is self-intersecting!", "zero-length edge!".
  - Nesting is computed on the **chord-tolerance polyline** (`chordTol`). `FixContourDirections` counts, for an edge midpoint of each contour, how many other contours contain it (`timesEnclosed`), toggling `outer`. It then reverses contours so that outers are CCW and holes CW.
  - Outer loops that contain other outer loops are processed last, so they do not "steal their holes".
  - `SPolygon::SelfIntersecting` (`polygon.cpp` l.750-771) tests every edge of *all* contours against a kd-tree of all edges. So crossings **between** loops (two overlapping circles) are rejected too, with `PolyError::SELF_INTERSECTING` (`groupmesh.cpp` l.80).
- **FreeCAD Bullseye (DOCUMENTED, header):** "planar faces with holes, where there can be additional faces inside holes and they can have holes too". Wires are sorted by bounding-box diagonal and added one by one; a hit test decides whether a wire drills a hole into an existing face or starts a new face. Requires closed wires ("Wire is not closed.") on one plane. **Cheese:** "holes, but no islands inside holes". **FaceMakerRing:** every wire becomes an outer with first-level holes, "Nested inner wires are ignored".
- **FreeCAD BuildFace (DOCUMENTED, header):** "splitting all edges at mutual intersections, then finding all bounded planar face regions". It runs OCCT `BOPAlgo_BuilderFace` against a base face larger than the geometry, with `SetAvoidInternalShapes(true)`, and filters the outer face.
- **FreeCAD Unified (DOCUMENTED, PR #28788):**
  - Pipeline: `splitSelfIntersecting` → `fuseOverlaps` ("merge partially overlapping closed wires") → `BRepAlgoAPI_BuilderAlgo` (split) → `BOPAlgo_BuilderFace` → "even-odd classify: pick faces inside odd nesting depth".
  - Dangling edges are pruned.
  - 110 planar tests (3 planes × cases).

## Robustness and guarantees

- SolveSpace nests on linearized geometry, so containment near tangency depends on `chordTol` (INFERRED). It refuses crossings outright.
- FreeCAD relies on OCCT's fuzzy Boolean machinery (tolerances on edges/vertices). There is no exactness claim; the tests use area comparisons with `places=1` or `delta=1.0` tolerances.

## Parallelism and performance

Not measured here. One data point: FreeCAD commit "Part: speed up text sketch extrusion by ~37% (#28344)" (2026-04) shows that text sketches (many nested glyph loops) are a real performance case.

## Known failures, limitations, war stories

- FreeCAD needed a 2026 Sketcher fix "fix internal faces for self-intersecting BSplines and dangling edges" (#28964) and a Toponaming fix for BuildFace (#29043). A new face maker immediately touched naming stability. Changing region semantics is a **topological-naming event**.
- SolveSpace users hit "contour is self-intersecting!" for any crossing sketch (the error path above); overlapping-circle sketches are unsupported by design.

## Same inputs, three semantics (DOCUMENTED expectations from `TestFaceMakerUnifiedPlanar.py`; Onshape column INFERRED from its documented rule)

| input | FreeCAD Unified | Onshape `qSketchRegion(id)` | Onshape `qSketchRegion(id, true)` | SolveSpace |
|---|---|---|---|---|
| two concentric circles | 1 face (annulus) | 2 faces (annulus, disk) | 1 (annulus) | 1 face with hole |
| three nested squares | 2 faces (outer ring, inner square) | 3 faces | 1 (outer ring only) | 2 faces (even-odd) |
| two overlapping circles r=10, d=12 | 3 faces (two crescents, lens), area = union | 3 faces | 3 (none contained) | error: self-intersecting |
| circle + dangling radius line | 1 face, dangling line pruned | 1 face (INFERRED) | 1 | error: not closed |
| circle + chord line through | 2 faces | 2 faces | 2 | error |
| bowtie from two triangles sharing a vertex | 2 faces | 2 faces | 2 | depends on loop assembly |

The FS corpus (230 explicit `true` calls) relies on Onshape's column, not FreeCAD's. A wonky implementation must not borrow FreeCAD's even-odd default for FS input.

## Relevance for wonky

- **The semantics decision is the main design risk (INFERRED):**
  - FS compatibility requires "all bounded faces" plus Onshape's single-level `filterInnerLoops`.
  - A build123d/Python frontend or text rendering may want even-odd fill (FreeCAD Unified, TrueType non-zero/even-odd).
  - Both can be computed from the **same arrangement** by different face-selection rules over the nesting tree. Make the rule an explicit, named parameter.
- **Tests:** FreeCAD's 42 planar case names (rectangle, shared edge, shared corner, circle inside rectangle, concentric, triple nesting, four concentric circles, two circles, cross pattern, T-junction, dangling chain, floating line, circle with line through, three/four circles, overlapping rects with hole, crossing edges, bowtie, figure-8 polygon, letters A/B/O/D, digit 8) are a ready checklist. Re-derive the geometry and expectations in wonky's own fixtures, including Onshape-semantics expectations.
- **Naming:** faces must get stable identities from their bounding sketch entities and their side, not from traversal order (Onshape's `V87_SKETCH_REGION_ORDERING` changed order once; FreeCAD's face-maker switch needed a Toponaming fix).
- **Bend fit:** the arrangement + nesting-tree + selection-rule structure is pure. SolveSpace's per-contour containment counting is an O(n²) map, trivially parallel, and fine for sketch sizes.

## Pointers worth porting or studying

- `TestFaceMakerUnifiedPlanar.py` test list and area oracles (union areas via OCCT fuse as ground truth).
- SolveSpace `FixContourDirections` (edge-midpoint containment count; it deliberately avoids vertices because "they may share vertices").
- FreeCAD `FaceMakerBuildFace.cpp` l.234-262: base face larger than geometry plus `BOPAlgo_BuilderFace`. That is the OCCT route to arrangement faces, useful as an independent oracle next to OCCT's STEP-reading test role.

## Verdict: **learn-from**

Two useful things come from these projects: a vocabulary of region semantics with concrete expected outputs, and a test checklist. For FS input, Onshape's rule wins; the FreeCAD 2026 even-odd default is a documented counter-model and a warning that semantics changes break naming.
