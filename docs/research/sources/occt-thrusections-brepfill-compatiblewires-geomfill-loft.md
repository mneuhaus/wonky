# OCCT loft: `BRepOffsetAPI_ThruSections`, `BRepFill_CompatibleWires`, `GeomFill::Surface`, `GeomFill_Profiler`/`AppSurf`

- Kind: open-source code + issue tracker.
  - Repo: https://github.com/Open-Cascade-SAS/OCCT, read at `3d097a0328e71b826377d4814ab05ec3c3d23871` (2026-08-24). Sparse clone: `wonky-kernel/tmp/research/occt-loft/` (dirs `src/ModelingAlgorithms/TKOffset/BRepOffsetAPI`, `TKBool/BRepFill`, `TKGeomAlgo/GeomFill`).
  - Files: `BRepOffsetAPI_ThruSections.cxx` (1747 lines), `BRepFill_CompatibleWires.cxx` (2635), `BRepFill_Generator.cxx` (1239), `GeomFill.cxx` (`GeomFill::Surface`), `GeomFill_Profiler.cxx`, `GeomFill_SectionGenerator.cxx`, `GeomFill_AppSurf`.
  - Issues: https://github.com/Open-Cascade-SAS/OCCT/issues/1315 , /issues/1297 , /issues/567 ; Mantis https://tracker.dev.opencascade.org/view.php?id=28642 , id=26123 ; release notes 6.7.1 https://dev.opencascade.org/sites/default/files/documents/Release_Notes_6.7.1.pdf (via search result summary, HEARSAY-level).
- Authors/organization: Open Cascade SAS (Matra Datavision lineage, 1990s code, French comments remain).
- License: LGPL-2.1 with the OCCT exception. Studying and re-deriving algorithms is fine; transcribing code into wonky would make that part LGPL-derived. wonky is private and unlicensed, so keep to re-implementation from understanding.
- Status: active; 2910 stars; pushed 2026-09-05 (`gh api repos/Open-Cascade-SAS/OCCT`).

## What it is
The loft used by build123d, CadQuery and FreeCAD (`Part.makeLoft`). Two modes: `ruled=true` (one ruled face per matched edge pair and section gap) and `ruled=false` (one approximated B-spline surface through all sections, split back into faces).

## How it works (DOCUMENTED from code)
- **Compatibility (`BRepFill_CompatibleWires::Perform`, l.855):** counts edges per section and the minimum wire continuity. `report = (nbmax != nbmin || contS >= GeomAbs_C1)`. All closed: if `report` → `SameNumberByPolarMethod`, else `ComputeOrigin`. All open: `SearchOrigin`, then `SameNumberByACR` (cut by curvilinear abscissa). Mixed open/closed → `NotSameTopology`.
- **`SameNumberByPolarMethod` (l.1008):** every section's plane is found (`PlaneOfWire`); each vertex of wire i is mapped into the plane of wire i−1 by translating barycentre to barycentre and rotating between the plane normals (`Transform`, l.682), then a segment from the neighbour's barycentre through that point is intersected with the neighbour wire (`EdgeIntersectOnWire`, via `BRepExtrema_DistShapeShape`, i.e. a min-distance query, not an exact intersection) and a vertex is inserted unless an existing vertex lies within `myPercent` × (parameter range of the hit edge); `myPercent` is 0.1 from the constructor (the `SetPercent` header default of 0.01 applies only when the setter is called). Done backward then forward so all sections get the union of vertex rays. Correspondence chains are kept in `MapVLV`; a short chain now fails gracefully (the guard added after #1297).
- **`ComputeOrigin` (l.1793):** equal edge counts. For each section after the first, align barycentres (offset projected on the first plane), then try all n cyclic shifts × 2 directions and pick the minimum of Σ‖P_prev,k − P_cur,k+offset‖ over vertices, plus 3 interior samples per edge when a wire has ≤2 edges. O(n²) per section pair. This is the "proximity" heuristic in concrete form.
- **Ruled face geometry (`GeomFill::Surface`, GeomFill.cxx l.42):** special cases only (a) two trimmed lines that are parallel, same direction or opposite, **and whose trims project onto each other** (a parallelogram) → `Geom_Plane`; (b) two **untrimmed** coaxial circles → `Geom_CylindricalSurface` (equal radii) or `Geom_ConicalSurface` with `atan((r2−r1)/V)`. Two trimmed arcs hit an empty branch (`else if (Trim1 && Trim2) {}`), and trapezoids and skew lines fall through to `GeomFill_Generator` → B-spline surface (rational when a profile is a rational arc).
- **Smoothed loft (`TotalSurf`, l.1203):** each section's edges are converted to B-splines and concatenated into one curve (`GeomConvert_CompCurveToBSplineCurve`); `GeomFill_Profiler::Perform` raises all to the max degree, reparameterises to a common range and unifies knot vectors by inserting all knots (fallback: `UnifyBySettingMiddleKnots`) — the Piegl-Tiller compatibility step; `GeomFill_AppSurf(degmin 2, degmax myDegMax (6 in `Init`, 8 in the ctor), tol myPres3d=1e-6)` approximates across sections with `Approx_ChordLength` parameterisation and `GeomAbs_C2`; optional smoothing criterion weights. Point sections become degenerate degree-1 curves.

## Robustness and guarantees
Heuristic throughout: vertex insertion by ray casting from the barycentre, origin choice by summed distance, no check that the result is free of self-intersection. `BRepCheck_Analyzer` does not detect a twisted loft (#1315).

## Parallelism and performance
No numbers found. The matching is O(n²) per section pair; the approximation is a dense least-squares solve.

## Known failures, limitations, war stories
- **#1315 (open, 2026-06-16, OCCT 7.8):** two 9-edge closed wires (7 lines + 2 arcs, rounded-rectangle outlines, near-parallel, different size) are lofted with the wrong vertex correspondence; the band twists and self-intersects; `BRepCheck_Analyzer` says valid; sewn volume ≈1450 vs ≈15700 expected. Repro: https://github.com/KeithSloan/OpenSCAD_Workbench/tree/GeneralBrepLofts/OCCT/loft_error . Lesson: validity ≠ correctness; a loft needs its own twist check.
- **#1297 (open):** SIGSEGV in `SameNumberByPolarMethod` when the polar method fails to propagate a correspondence to every section (profiles with different vertex counts, not coaxial); unguarded iterator advance. The current code has a `More()` guard and returns `Failed`.
- **#567 (closed 2025):** title "BRepOffsetAPI_ThruSections cannot work for closed B-spline curve" (body not read).
- Mantis 28642: ThruSections/`BRepFill_Generator` modified the input sections (now `SetMutableInput`). Mantis 26123: wrong history. 6.7.1 release note: a regression twisting the loft between two wires was fixed in `ComputeOrigin` (search-result summary).
- Downstream (see the build123d note): trapezoid sides come out as BSPLINE not PLANE (#756); smoothed two-section lofts are degree-7 non-rational 8×2-pole surfaces whose arcs are approximated, and offsets of them fail (#1469, #1351, #545).

## Relevance for wonky
- The two heuristics (polar insertion for unequal counts, min-sum-distance origin for equal counts) are the best available written-down stand-in for Onshape's undocumented "proximity" rule. For the corpus's only unequal-count case (centred square to circle) both rays-from-centre and nearest-point give the 45° split (INFERRED).
- OCCT's simplification is weaker than Parasolid's (no trapezoid planes, no trimmed-arc cones). Using OCCT output as a parity oracle for wonky's carrier types would mislead; Onshape exports are the right oracle.
- Everything is f64 with tolerances like `Precision::Confusion()` (1e-7) and `myPercent`; in wonky the matching decisions should be exact predicates on F32x2/integer data with explicit ambiguity errors instead.
- Bend fit: ComputeOrigin is n shifts × n distances — a uniform map + reduce (fork-join friendly). Polar insertion is a ray–wire intersection per vertex, also a map.

## Pointers worth porting or studying
`BRepFill_CompatibleWires::ComputeOrigin` (min-sum-distance loop, barycentre offset), `SameNumberByPolarMethod` + `Transform` (plane-to-plane mapping), `GeomFill::Surface` (the list of ruled simplifications, to exceed), `GeomFill_Profiler::Perform` (compatibility), `BRepOffsetAPI_ThruSections::TotalSurf` (skinning pipeline).

## Verdict: learn-from
Good map of the steps (compatibility, origin, ruled/skin), weak as geometry: weaker simplification than Parasolid, approximated arcs, no twist certification. Re-derive the matching heuristics; do not copy code (LGPL).
