# BRL-CAD libbrep NURBS Boolean evaluation (bool_eval development guide, boolean.cpp, intersect.cpp)

- Kind: kernel library plus developer guide. Canonical URL: https://github.com/BRL-CAD/brlcad/blob/main/doc/asciidoc/devguides/bool_eval_development.adoc
- Other URLs: https://github.com/BRL-CAD/brlcad/tree/main/src/libbrep ; https://github.com/BRL-CAD/brlcad/tree/main/src/libbrep/shape_recognition ; https://github.com/BRL-CAD/brlcad ; openNURBS upstream https://github.com/mcneel/opennurbs (branch 8.x)
- Read at commit `97920fbc90eee4e66aeaf71e060bd8a899822062` (2026-09-22). Link base: `https://github.com/BRL-CAD/brlcad/blob/97920fbc90eee4e66aeaf71e060bd8a899822062/`. Local sparse clone: `tmp/research/brlcad-libbrep/brlcad/`; openNURBS excerpts in `tmp/research/brlcad-libbrep/opennurbs/`.
- Authors/organization: U.S. Army Research Laboratory and the BRL-CAD open-source team. The guide is by Nicholas Reed. The Boolean code dates from 2013 (a GSoC-era branch `brep-debug`), libbrep headers "Copyright (c) 2013-2026"; shape_recognition is 2019-2026.
- License (DOCUMENTED, file headers and `COPYING`): libbrep, including `boolean.cpp`, `intersect.cpp` and `shape_recognition/*`, is **LGPL-2.1**; parts of BRL-CAD are BSD or public domain. openNURBS (vendored, used for all geometry) has McNeel's permissive license: copyright notice, "AS IS", no copyleft. The GitHub repo reports `NOASSERTION` because of the mix. Implication (INFERRED): as with OCCT, study and re-derive ideas; translated code would be LGPL-derived. openNURBS recognition routines (`IsCylinder` etc.) are permissive and could legally be adapted with attribution.
- Status (DOCUMENTED via `gh api`, 2026-09-22): primary language Tcl (overall repo), ~592 MB, 1,032 stars, 232 forks, ~141 contributors, pushed 2026-09-22, releases 7.44.0 (2026-07-24), 7.42.2 (2026-04-19). The Boolean files themselves are dormant: `boolean.cpp`'s only functional commit since 2023 is "Add inside/outside test function for ON_Brep" (2026-08-05, +21 lines); `intersect.cpp` has had only copyright bumps since a 2023 change disabling debug plotting.

## What it is

An evaluated Boolean on trimmed NURBS B-reps (openNURBS `ON_Brep`). It is exposed as the MGED/Archer command `brep <comb>`, which converts each CSG leaf to NURBS and folds the Boolean tree pairwise via `ON_Boolean()`. The guide is a candid developer handbook: algorithm outline, openNURBS pitfalls, tolerance conventions, and a step-by-step debugging method with `dplot` stage visualizations. `shape_recognition/` is a separate B-rep → CSG pipeline that recognizes planes, cylinders, cones, spheres and tori in NURBS faces and decomposes solids into implicit primitives ("islands" and "shoals").

## How it works

### Boolean pipeline (DOCUMENTED, guide §3 and `boolean.cpp`)
- It follows BOOLE (Krishnan et al. 1995): intersect, split, classify, stitch.
- `ON_Boolean` → `get_evaluated_faces` → `get_face_intersection_curves`. The SSI `ON_Intersect(surfA, surfB, …)` runs for every face pair with overlapping bounding boxes. `get_subcurves_inside_faces` clips SSI curves to each face's trim loops, and `link_curves` joins curves that share endpoints.
- Faces are split into loops by `split_trimmed_face` (L2812). 2D loop Booleans use Margalit & Knott 1989 polygon union/intersection/difference, adapted to curves (`loop_boolean`, L2112-L2235).
- Classification: `face_brep_location` (L3410-L3450) picks an interior UV point on a split face on a grid (`get_point_inside_trimmed_face`, L3369). It tests `is_point_on_brep_surface` (then the face is ON) or `is_point_inside_brep` (L3244-L3324). The latter casts **one ray** from the point along 1.5× the bbox diagonal, intersects it with every face surface, keeps hits inside the outer loop (inner loops ignored), dedups within `INTERSECTION_TOL`, and decides by **parity**.
- The design notes in the code (L2775-L2810) record the known weakness: 2D information alone cannot decide which split face survives (the two-spheres example), so an inside/outside test is unavoidable. The notes also suggest a "representative polygon + Clipper" approach, which was not implemented.

### SSI (DOCUMENTED, `intersect.cpp` L2204-L2244, L3515-L3700; guide §3)
- Based on Krishnamurthy et al., "Performing efficient NURBS modeling operations on the GPU" (SPM 2008). There is a separate note: `krishnamurthy-mcmains-et-al-performing-efficient-nurbs-model.md`.
- **Stage 1, overlaps:** "the boundary of any overlap region must be formed from isocurves of the overlapping surfaces". Rationale (L3515-L3536): a NURBS surface decomposes into Bezier patches along its Bezier knots, and the boundary of the overlap of two Bezier patches is formed from patch boundaries (Theorem 3 of a cited CAD 1997 paper). So: intersect isocurves at Bezier knots of A with B and vice versa, keep overlap subcurves that are coincident on one side only, split them at mutual intersections, retest, drop contained ones, merge at shared endpoints, keep closed loops, and orient them into overlap events.
- **Stage 2, transversal curves:** quad-subdivide both surfaces to `MAX_SSI_DEPTH = 8`, keeping pairs with intersecting bboxes and discarding subsurfaces inside overlap regions. Approximate each leaf by two triangles, intersect the triangles, and use the average hit as the seed for a Newton solve of the under-determined system `S_A(u,v) = S_B(s,t)` (`newton_ssi`). Points inside overlaps are dropped. Seam copies are added for closed surfaces. Points are linked into polylines (distance threshold), then **line and conic fitting** replaces polylines where possible.
- Events are typed `ssx_overlap`, `ssx_tangent` (normals parallel along the curve), `ssx_transverse`, `ssx_tangent_point`, `ssx_transverse_point` (openNURBS `ON_SSX_EVENT`, plus BRL-CAD's `ON_PX_EVENT` for point events).
- Constants (`brep_defines.h`): `NR_MAX_DEPTH 8`, `NR_MAX_ITERATIONS 100`, `NR_DEFAULT_TOLERANCE 0.001`, `INTERSECTION_TOL 1e-4`, `ANGLE_TOL π/1800`. The overlap test samples 16 points for curve/curve and 2 points for curve/surface (comments at L973, L1533).

### Tolerance conventions (DOCUMENTED, guide "Intersection Tolerances", "Accumulated Error")
- 2D tolerances are derived from the 3D tolerance via `tolerance_2d_from_3d`: `tol_2d = tol_3d · (domain length / bbox-diagonal length)` (DOCUMENTED, `intersect.cpp` L1060-L1076 for curves, L1602+ for surfaces). The guide states the intent: "two points … `isect_tolA` apart in 2D will evaluate to … `isect_tol` apart in 3D". This is a global linear estimate, not a bound, and it is wrong where the parameterization is strongly non-uniform (INFERRED).
- **Clamping:** a curve found closed within tolerance gets its end point set equal to its start point. A sub-interval within tolerance of a domain end is snapped to the domain end, and `sub_curve()` wraps `Split()` with that clamping.
- **Avoid iterated solutions for classification:** "It's tempting to test curve characteristics or make inside/outside determinations … by using the `ON_Intersect()` functions. However, there's a persistent risk that the error in the iteratively solved results will cause incorrect determinations that cascade … should be avoided whenever possible."
- **2D vs 3D discipline:** the naming convention is 3D unadorned, 2D suffixed A/B or 1/2. Different surfaces' parameterizations never correspond; direction and start of closed curves are arbitrary.

### Shape recognition (DOCUMENTED, `shape_recognition/*.cpp`, openNURBS `opennurbs_revsurface.cpp`)
- `GetSurfaceType` (`sr_util.cpp` L243-L283): duplicate the surface, scale ×1000 "so small surfaces can be identified", then test in order `IsPlanar`, `IsSphere`, `IsCylinder`, `IsCone`, `IsTorus`, each with tolerance 0.05 (`BREP_*_TOL`, effective 5e-5 in original units), else `SURFACE_GENERAL`.
- openNURBS `ON_Surface::IsCylinder` (mcneel/opennurbs 8.x `opennurbs_revsurface.cpp` L1835-L1936) is **hypothesize-and-verify by sampling**:
  - A revolution surface is delegated to `ON_RevSurface::IsCylindrical`.
  - Otherwise take the mid isocurves in u and v, and require one `IsArc` and the other `IsLinear` within tolerance. Build the cylinder from the arc.
  - Check both line endpoints' distance to the arc axis equals the radius within `tol = max(tolerance, 0.5·sqrt(ε)·r)`.
  - Then sample 5 points per Bezier span in both directions (`GetSpanVector`) and reject if any point's axis distance deviates from `r` by more than `tol`.

  `IsSphere` uses the same pattern with two arcs and a sphere fit. The verification is point sampling, not a bound.
- The pipeline splits the B-rep into "islands" (connected face sets separated by planar loops) and "shoals". It emits CSG (ARB/RCC/TRC/SPH/TOR + booleans) with convexity decided by `negative_cylinder` / `negative_cone` / `negative_sphere` and "implicit planes" that bound partial cylinders. Sphere and torus shoals currently `return 0` (unhandled) in `shoal_csg` (`pipeline.cpp`). The guard `CSG_BREP_MAX_OBJS = 1500` bails out on over-fragmentation.

## Robustness and guarantees

- DOCUMENTED limitations (guide §2): "May produce incorrect output due to unhandled intersection cases", "Unoptimized performance resulting in potentially significant runtimes", material properties discarded, some primitive conversions undefined, "Hollow objects are not built topologically continuous".
- Everything is f64 with fixed tolerances (1e-4, 1e-3, `ON_ZERO_TOLERANCE`). SSI completeness depends on a fixed subdivision depth of 8 with bbox tests, so small loops below leaf size can be missed (INFERRED). Classification is single-ray parity with tolerance dedup, which is known to be fragile for rays grazing edges or tangent surfaces (INFERRED; a single ray, no retry). Shape recognition is sampled verification at tolerance 0.05 on a 1000× scaled copy.

## Parallelism and performance

- No parallelism in `boolean.cpp`/`intersect.cpp` (serial loops over face pairs; INFERRED from code, no OpenMP or threads found). The GPU paper it is based on is data-parallel, but BRL-CAD's port is CPU-serial.
- No measured numbers are published. The guide explicitly calls performance unoptimized. The 2023 commit "Turn off brep boolean debug plotting … generating too many files" shows the debug machinery was on by default until then.

## Known failures, limitations, war stories

- Issue #33 (open, 2022-04-24): the union of two arb8 boxes sharing a coplanar face (y = 0 plane) loses surfaces in `brep`. https://github.com/BRL-CAD/brlcad/issues/33
- Issue #34 (open, 2022-04-24): a union of two spheres and a box loses an entity. https://github.com/BRL-CAD/brlcad/issues/34
- Guide "Historical Debugging Example": the "X" of two perpendicular plates from `axis.g`. An overlap event was found correctly per isocurve but broken during `split_overlaps_at_intersections` / linking. This illustrates that failures occur in *curve linking and stitching*, not in the geometric intersection itself.
- The guide warns about openNURBS API traps: `ON_Line::InPlane` constructs a plane instead of testing; `ON_Line::MinimumDistanceTo` silently assumes non-coincident lines; `PointAt` does not check the domain; arrays are not bounds-checked; `ON_Interval` may be reversed.

## Relevance for wonky

- **Hybrid prototype (mesh Boolean decides topology, analytic recovery):** shape recognition is the closest open precedent for "given a piece of geometry, recover which analytic surface it is". The method (probe isocurves → hypothesize the primitive → verify on a sample grid within tolerance) transfers. In wonky it should be strengthened, because the tagged mesh already carries the source face ID (provenance). Recovery is then not guessing but **verification against a known candidate**: the tag says "this triangle came from cylinder #7", and wonky must only certify that the recovered boundary lies on that cylinder and on the other tagged surface within a stated bound. Use BRL-CAD's hypothesize/verify only for untagged or imported geometry (STEP import). Replace sampled verification by bounds: for a plane, exact vertex residuals suffice; for a cylinder or cone, bound the radial residual over each mesh edge using convexity (INFERRED).
- **Tolerance mapping 3D → 2D** (bbox diagonal / domain length) is the right first-order rule for F32x2 parameter spaces. With the SolveSpace variant (scale UV by `|∂S/∂u|, |∂S/∂v|` locally) it yields model-unit tolerances in parameter space. For wonky's analytic surfaces this is exact: cylinder `|∂S/∂u| = r`, `|∂S/∂v| = |a|`. It needs no heuristics, so do it analytically per surface type.
- **Lesson "do not use iterative solvers for inside/outside decisions"** matches wonky's rule: topology decisions from exact or certified predicates; iterative solvers only for embedding. Also: **clamp and snap known-equal quantities** (closed-curve endpoints, domain ends) *by construction*. wonky can do better by never computing them twice: shared vertex objects instead of recomputed endpoints (topology identity).
- **Overlap-boundary theorem** (overlap regions of Bezier patches are bounded by patch boundaries): for wonky's analytic surfaces the analogue is trivial, since coincident analytic surfaces are the *same* surface (same plane or same cylinder). Coincidence must be decided exactly on surface parameters (same axis and radius), then the overlap is a 2D Boolean of trim regions in the shared parameter space. That is the right way to handle coplanar and co-cylindrical faces (the BRL-CAD #33 class).
- **Bend fit (INFERRED):** the quad-subdivision bbox SSI (fixed depth 8 → at most 4^8 leaves per surface, pairs filtered by bbox) is a uniform, GPU-friendly tree traversal and exactly the Krishnamurthy GPU design. For wonky's analytic pairs it is unnecessary except as a *certified exclusion* step (interval bboxes proving no intersection) for general or recovered surfaces. The Newton polishing, polyline linking and conic fitting are per-curve sequential steps.
- **Debug tooling idea:** the `dplot` stage visualizations (ssx pairs, isocurve intersections, face-clipped curves, linked curves, split faces with keep/discard highlighting) are a template for wonky's viewer diff/review. Emit per-stage artifacts (SSI events, clipped curves, loops, classified faces) keyed by stable IDs so a failing Boolean can be bisected by stage. This fits wonky's introspection goal and LLM-driven debugging.

## Pointers worth porting or studying

- Guide sections "Technical Approach", "Intersection Tolerances", "Accumulated Error" (clamping, iterated solutions), "Debugging with the dplot Command".
- `src/libbrep/intersect.cpp` L2204-L2244 (SSI outline), L3515-L3536 (overlap-boundary argument), L3645-L3700 (SSI algorithm overview); `src/libbrep/boolean.cpp` L2112-L2235 (Margalit-Knott loop Boolean), L2775-L2810 (design notes on why 2D is insufficient), L3244-L3324 (single-ray parity: an anti-pattern), L3410-L3450 (face location); `src/libbrep/brep_defines.h` (constants).
- `src/libbrep/shape_recognition/sr_util.cpp` L243-L283 (`GetSurfaceType`), `shape_recognition.h` (types, tolerances), `cylinder.cpp` (implicit planes, negative cylinders); openNURBS `opennurbs_revsurface.cpp` L1642-L1833 (IsSphere), L1835-L1936 (IsCylinder), L1939+ (IsCone), L2077+ (IsTorus); `opennurbs_surface.cpp` L332 (IsPlanar).
- Paper: Krishnan et al. 1995 (BOOLE); Krishnamurthy et al. SPM 2008 (see separate note); Margalit & Knott 1989 (loop Booleans).

## Verdict: learn-from

This is not a robust or maintained Boolean: its authors document incorrect output and unoptimized performance, and the code has been dormant since 2023. Its value for wonky is the lessons (3D→2D tolerance mapping, clamping, no iterative solvers in classification, stage-wise debug plots) and the analytic-recognition pattern (isocurve hypothesis + verify) for the hybrid prototype's recovery step. There, provenance tags should turn recognition into certified verification.
