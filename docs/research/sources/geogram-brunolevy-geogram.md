# Geogram (BrunoLevy/geogram): mesh CSG, PCK predicates, expansion arithmetic, CDT with symbolic perturbation

- Kind: open-source C++ geometry library (code), plus the companion paper.
- Canonical URL: https://github.com/BrunoLevy/geogram
- Other URLs:
  - Paper: B. Lévy, "Exact predicates, exact constructions and combinatorics for mesh CSG", arXiv 2405.12949v2 (4 Jun 2025), https://arxiv.org/abs/2405.12949
  - PCK paper: Lévy 2016, CAD 72:3-12, https://doi.org/10.1016/j.cad.2015.10.004
  - Test corpus: https://github.com/BrunoLevy/thingiCSG (BSD-3, 12 stars)
  - Commercial kernel add-on "geogramplus" by Tessael: https://www.tessael.com
- Authors/organization, years: Bruno Lévy (Inria Saclay; earlier Inria Nancy ALICE), 2000-2026. 24 contributors on GitHub. DOCUMENTED (`gh api repos/BrunoLevy/geogram/contributors`, 2026-09-22).
- License: BSD 3-Clause, "Copyright (c) 2000-2022 Inria". GitHub reports "NOASSERTION" because of the custom header, but the LICENSE file is plain BSD-3. DOCUMENTED (LICENSE in clone at 6db8db2). Porting implication: porting algorithms and code into Bend is allowed with attribution. The multiprecision kernel from the paper (§2.4.2) is NOT in the open repo. It lives in the closed "geogramplus" add-on, enabled only when `src/lib/geogram/geogramplus/` exists. DOCUMENTED (`cmake/geogram.cmake` lines 38-56; `numerics/exact_geometry.h` "If Tessael's geogramplus is available, use exact_nt coordinates, else use expansion_nt coordinates. exact_nt coordinates makes the algorithm 10x to 20x faster and have no risk of underflow / overflow.").
- Status:
  - Very active: 2547 stars, 212 forks, 64 open issues. Last commit 6db8db2 "More documentation" on 2026-09-22. Releases v1.10.1 (2026-09-01), v1.10.0 (2026-05-27) and v1.9.9 (2026-04-08).
  - Created on GitHub 2022-02-23. The code itself is much older.
  - DOCUMENTED (`gh api repos/BrunoLevy/geogram`, `/commits?per_page=1`, `/releases`, 2026-09-22).
  - Re-checked 2026-09-24: 213 forks. Newest commit 5fc6bb0 on 2026-09-23, "additional points inserted in temporary vector to avoid reallocation". No release after v1.10.1. The CSG-relevant issues are unchanged: #233 (snap rounding), #268 (SOS thread safety) and #390 (expansion kernel) are open; #301, #382 and #391 are closed. The only issues updated since 2026-09-20 concern rendering (GLUP, SSAO) and PeriodicDelaunay3d. DOCUMENTED (`gh api`).

## What it is

- A general geometry-processing library. The Boolean part is `MeshSurfaceIntersection` in `src/lib/geogram/mesh/mesh_surface_intersection.cpp` (2311 lines) and `mesh_surface_intersection_internal.cpp`, plus `mesh_CSG*` for OpenSCAD `.csg` trees. DOCUMENTED (clone).
- Public entry points are `GEO::mesh_union`, `mesh_intersection`, `mesh_difference` and `mesh_boolean_operation(result, A, B, op, flags)`. DOCUMENTED (`mesh_surface_intersection.cpp` from line 2246).
- The supporting numerics are directly relevant to wonky's exact-predicate layer:
  - PCK predicate generator: `numerics/predicates/*.pck` plus `pck.sh`.
  - Shewchuk arithmetic expansions: `numerics/multi_precision.{h,cpp}` and `expansion_nt.{h,cpp}`.
  - Interval filters: `interval_nt`.
  - Homogeneous exact points: `exact_geometry.h`.
  - Symbolic perturbation: `PCK.h` `SOS()`.
  - A combinatorial constrained Delaunay core, `CDTBase2d`, with pluggable predicates.
  - DOCUMENTED (clone).
- The OBB runner uses Geogram 1.10.0. It declares self-reported capabilities E R S (no I), requires closed meshes, and accepts neither self-intersections nor components. DOCUMENTED (https://github.com/Open-Boolean-Benchmark/boolean-benchmark-runners, `geogram/1.10.0/boolean/runner.yaml`).

## How it works

The pipeline follows Lévy 2024 §2. DOCUMENTED (arXiv 2405.12949, section references below).

1. **Prologue.**
   - Tessellate facets and tag each operand with an `operand_bit` bitmask. This is an `index_t`, which caps it at 32 operands; the code has the comment "TODO: not good, there might be more than 32 components".
   - Remove degenerate triangles and colocate duplicate vertices by lexicographic sort.
   - Switch SOS to `SOS_LEXICO` so coplanar overlaps triangulate identically. The comment says this is "Needed to get compatible triangulations on coplanar faces".
   - DOCUMENTED (`mesh_surface_intersection.cpp` lines 225-253).
2. **Candidate pairs (§2.1.1).**
   - A compact AABB: implicit children 2n/2n+1, and triangles permuted so each node owns a contiguous range.
   - Recursive dual traversal with `if e2 <= b1 return` to avoid symmetric duplicates.
   - A Zomorodian-Edelsbrunner alternative exists but is disabled as slower (issue #362).
   - DOCUMENTED (paper p.6; code lines 276-300).
3. **Triangle-triangle (§2.1.2).**
   - Each triangle is 7 open simplices (3 vertices, 3 open edges, open interior).
   - The output is a list of pairs (σ, σ') of simplex IDs 0..6, one pair per intersection point. It is purely combinatorial, no coordinates.
   - `edge_triangle` uses only orient3d. There is a 2D codepath when both edge ends are coplanar, and a 1D interval compare for collinear edges.
   - Duplicates are removed by sort+unique.
   - Coplanar polygon edges are found by testing all point pairs for a "same edge" relation (at most 15 pairs).
   - A "predicate cache" is keyed by sorted vertex indices, and the sign is flipped by permutation parity.
   - DOCUMENTED (paper p.7-9).
4. **Per-triangle CDT (§2.1.3).**
   - Project by dropping the dominant normal axis. The dominant axis must be chosen with exact arithmetic: the paper says "Invoking exact arithmetics for finding the dominant axis of a normal vector is not pedantic", citing Thingi10K #356074.
   - Sloan-style incremental CDT. Data lives only in `std::vector`s allocated once, with stack and queue as doubly linked lists in two more vectors. The goal is to avoid malloc locks under multithreading.
   - Edges are always addressed as "edge 0 of a rotated triangle". This lets the constraint-edge intersection test use one orient2d instead of four (4 configurations, Fig. 7).
   - Intersecting constraints (triple points) are inserted on the fly.
   - `incircle` is symbolically perturbed and never returns zero, so the triangulation is unique. That makes coplanar overlapping facets from different operands mesh identically, so duplicates can simply be filtered.
   - DOCUMENTED (paper p.9-12; `delaunay/CDT_2d.h` lines 62-73, 1035-1070).
5. **Exact constructions.**
   - Intersection points are homogeneous `vec3h` with exact scalars. Edge∩triangle: `mix(a/b, q1, q2) = (a q2 + (b−a) q1)/b`. Coplanar edge∩edge: 2×2 Cramer in 2D, then lift.
   - A triple point (two constraints crossing) is computed as the intersection of three triangle planes by 3×3 Cramer, avoiding nested `t` and `mix`.
   - A global vertex table `std::map<ExactPoint,index_t>` is ordered lexicographically on the rational Cartesian coordinates via `sign(w1)·sign(w2)·sign(w2·x1 − w1·x2)`. This merges intersections landing on the same point or on input vertices; the paper says "not academic paranoia", see Fig. 8.
   - Output vertices get `PCK::approximate(p)` (rounded to double).
   - DOCUMENTED (paper p.12-14; code lines 815-835).
6. **Weiler model (§2.2.1-2.2.2).**
   - A 3-map (darts, σ1, α2, α3). Every triangle is duplicated into two sheets linked by α3.
   - Bundles are found by sorting darts on their endpoint indices. Four darts means a manifold edge; more than four means a radial sort.
   - The radial sort uses orient3d on the two opposite vertices plus sign(n1·n2) to form quadrants.
   - The sort order is propagated along radial polylines, so only one bundle per polyline is sorted.
   - DOCUMENTED (paper p.14-15).
7. **Classification (§2.2.3).**
   - A flood fill over σ1/α2 (keep the inside-set) and α3 (XOR with the triangle's operand bits).
   - One ray cast per connected component, with random re-shoot on degeneracy. The paper recommends this over SoS for rays: "far simpler to implement".
   - The outer shell is the chart with the largest enclosed volume.
   - `d ∈ ∂O_E ⇔ not E(I(d)) and E(I(α3(d)))` for an arbitrary Boolean expression E over N operands.
   - DOCUMENTED (paper p.15-16).
8. **Simplify coplanar (§2.2.4).**
   - Greedily group coplanar facets with an exact normal-collinearity predicate.
   - Extract their borders, drop collinear border vertices not used elsewhere, and re-CDT with the same code.
   - This is "crucial when evaluating deep CSG trees ... Without this post-processing, the number of triangles would quickly explode". DOCUMENTED (paper p.17, p.24).
9. **PCK.**
   - Predicates are written once in a C-like `.pck` DSL. An example is `orient3d.pck`: coordinate differences, then `det3x3`, then `sign`.
   - `pck.sh` preprocesses the file per dimension and runs `mcc` (the FPG filtered-predicate generator) to emit a static floating-point filter with a derived error constant.
   - For orient3d the generated filter is `eps = 5.11071278299732992696e-15 * max1*max2*max3`, returning `FPG_UNCERTAIN_VALUE` outside [1.63e-98, 5.6e101]. It falls back to the exact expansion path.
   - SOS is a template `SOS(p0, lambda0, ..., p3, lambda3)`: points are sorted, then the lambda for each perturbed point is evaluated in order until one is nonzero.
   - DOCUMENTED (`numerics/predicates/orient3d.pck`, `orient3d.h`, `pck.sh`, `PCK.h` lines 142-210).

### What PCK actually generates (checked in the clone, `src/lib/geogram/numerics/`)
- Only the floating-point filter is generated. `pck.sh` preprocesses a `.pck` file per dimension (DIM2..DIM8) and pipes it through `mcc`, the external FPG compiler (Meyer-Pion), which is not in the repo. The output is the `predicates/*.h` headers (`orient_3d_filter` etc.). DOCUMENTED (`predicates/pck.sh`, `predicates/orient3d.pck`).
- The exact variant is hand-written in `predicates.cpp` with the same expression shape on expansions. For example, `orient_3d_exact` (L1245) uses `expansion_diff` then `expansion_det3x3`.
- The dispatcher is filter-then-exact: `orient_3d` at L1843: `result = orient_3d_filter(...); if(result == 0) result = orient_3d_exact(...)`.
- SoS is a separate template (`PCK.h` `SOS()`) applied to specific predicates (`orient_3d_SOS`).
- So "write once" really means one source expression plus two hand-mirrored implementations. This matches Lévy's own lesson of one expression each for filter, exact and SoS (paper conclusion). DOCUMENTED.

### A wonky generator in the PCK spirit (INFERRED design)
Input: a predicate as a polynomial DSL over integer-grid inputs, as in `.pck`. Emit three Bend functions from it:
1. **Static filter in F32x2.**
   - Error constant derived by forward error analysis with the double-word per-operation bounds (Joldes-Muller-Popescu 2017, Table 1: add 3u^2+13u^3, mul 7u^2 without FMA, since Bend has no FMA primitive).
   - Scaled by the input magnitude bounds, as FPG does with `max1*max2*max3`.
   - Returns +1, -1 or "uncertain".
2. **Exact U32 half-limb evaluation.**
   - The limb count per subexpression comes from the degree and bit analysis, in the style of Solidean's "Surrat" or trueform's T0/T1/T2 ladder.
   - Fixed width, branch-free, no allocation.
3. **SoS cascade**, generated from the same polynomial by symbolic expansion in the perturbation parameter. Geogram's `SOS()` template shows the runtime shape.

Because the inputs are grid integers, the exact tier needs no exponent at all. This avoids the expansion over- and underflow that bites Geogram's open kernel.

## Robustness and guarantees

- **Predicates and constructions.** All predicates are exact, and all intersection points are exact homogeneous rationals, so the co-refinement is exact and topologically valid internally. It handles triangle soups, coplanar overlaps and intersections landing on vertices. DOCUMENTED (paper §2.1 intro, "The output is a valid mesh that exactly represents the same geometry as the input mesh").
- **Output is rounded.** Vertices are rounded to double on output (`PCK::approximate`) and there is no snap rounding. The output can therefore contain new near-degenerate or self-intersecting triangles, and chained Booleans lose the exactness guarantee. That is why OBB lists no "I" letter. DOCUMENTED:
  - Code at line 831.
  - Paper conclusion: "the main missing component is a 'snap rounding' algorithm".
  - Issue #233 (open, 2025-02-22) plans Leo Valque's heuristic: scale to ±1e7, round the vertices of intersecting triangles to integers, re-intersect, repeat at most 3 times.
  - https://github.com/BrunoLevy/geogram/issues/233
- **The open-source kernel is not the robust one.** In open Geogram, `expansion_nt` can overflow or underflow on nested constructions. In that case the run aborts with "FATAL ERROR: Did not manage to sort a bundle ... (if you reached this point, you may need geogramplus, contact TESSAEL)". Lévy in the thread: the open-source kernel "may be subject to overflow/underflow in degenerate configurations"; the commercial one is "based on multiprecision arithmetics ... 10x faster". DOCUMENTED (https://github.com/BrunoLevy/geogram/issues/301).
- **Expansion length and exponent range.** Expansion lengths up to 65000 components were observed during Weiler-model construction (the paper says this "corresponds to 16 nested levels"). The expansion kernel succeeds on OpenSCAD example0001-0020.csg but "fails with all CSG trees between example0021.csg to example0024.csg". Thingi10K #101633 (skinny triangles near a pole) underflows. DOCUMENTED (paper p.21-22).
- **Failure mode.** Failure is explicit (FATAL ERROR, abort), not silent. DOCUMENTED (issue #301).

## Parallelism and performance

- **Parallel stages.**
  - AABB box-box traversal.
  - Triangle-triangle tests: `parallel_for` over candidate pairs, with a spinlock around appending results.
  - Per-triangle CDTs: `parallel_for_slice` over facet groups. `MeshInTriangle::commit()` locks the shared exact mesh and vertex table.
  - Colocated-vertex detection.
  - DOCUMENTED (`mesh_surface_intersection.cpp` lines 276-470, 545-680; `mesh_surface_intersection_internal.cpp` lines 352-380).
- **Paper timings, Thingi10K.**
  - The 4523 self-intersecting models are processed in 1h45.
  - #996816 takes 1271 s, with thousands of intersections per triangle.
  - The multiprecision kernel is usually faster than Cherchi et al. 2022 on the top-10 models.
  - Dropping Delaunay (plain CDT) is faster again, but uniqueness is lost.
  - DOCUMENTED (paper Table 1, §3.1).
- **Paper timings, versus Zhou 2016 and Cherchi 2022.**
  - dragon-bunny: 2.7 / 3.9 / 1.3 s.
  - cylUcyl: 3.7 / 25.8 / 28.2 s.
  - 20rods-20rods: 0.9 / 3.3 / 2.1 s, where Cherchi's result is "incorrect result".
  - Lévy concedes EMBER does 20rods in 4.5 ms and that integer-only methods are "50x to 100x" faster.
  - DOCUMENTED (paper Table 2, p.24, conclusion).
- **Paper timings, ThingiCSG.**
  - Manifold is "always the fastest", but it fails on nasty_gears and on fibo_sphere_500 ("many missing triangles").
  - CGAL corefine runs out of memory at 62.5M vertices.
  - DOCUMENTED (paper Tables 4-6, p.25).
- **Stage costs.** The breakdown in Table 3 shows the Weiler combinatorics and radial sort take up to about 10% of the total. DOCUMENTED.
- **OBB results, Ryzen 9 5900X.**
  - 9-op chain: 32.4 s.
  - Iterated cube grid (1999 ops): 112 s for 1.10.0, and about 37 min for 1.9.8.
  - Terrain carve: no result.
  - DOCUMENTED (https://solidean.com/blog/2026/first-benchmark-results-iterated-csg/, https://solidean.com/blog/2026/iterated-cube-grid-benchmark/, https://solidean.com/blog/2026/terrain-carve-benchmark/).

## Known failures, limitations, war stories

- The expansion overflow and underflow abort described above (issue #301, cylinder plus torus with a coplanar seam). Issue #390 (open, 2026-09-06) lists the still-unexplained expansion misbehaviors:
  - The "length" coordinate in MeshInTriangle and CDT2d needs exact rounding.
  - Tight intervals trigger floating-point exceptions (FPEs).
  - `expansion_problem.scad` "not the same behavior with multithread and without (sometimes co-planar triangles remain, detected in radial sort)". The author suspects the VertexMap misses duplicated vertices.
  - DOCUMENTED (https://github.com/BrunoLevy/geogram/issues/390).
- `SOS_mode_` is a global flag. Running `intersect_prologue()` on two meshes in parallel is not thread-safe. DOCUMENTED (https://github.com/BrunoLevy/geogram/issues/268, open). Lesson for wonky: perturbation mode must be a parameter, not global state.
- The 32-operand cap on `operand_bit` for flattened CSG. DOCUMENTED (code comment at line 236; https://github.com/BrunoLevy/geogram/issues/134 "use 64 bits instead of 32").
- Projection-axis choice in floating point created degenerate projections (Thingi10K #356074). DOCUMENTED (paper p.9 and footnote 6).
- There was a typo in Priest/Shewchuk's expansion `compress` algorithm (line 14 should be lowercase q). It went unnoticed because compression is rarely used outside cascaded constructions. DOCUMENTED (paper p.19, footnote 9).
- The OBB version jump from 1.9.8 (about 37 min) to 1.10.0 (112 s) shows performance is still moving. DOCUMENTED (cube-grid post).
- **FMA contraction broke the predicates on Apple Silicon.** The Linux platform files carried `-frounding-math -ffp-contract=off`, but `Darwin-clang.cmake` did not.
  - On arm64, clang contracts by default. `PCK::orient_3d` compiled to 5 fused operations and `side4_3d` to 25.
  - `Delaunay3d::locate_inexact` then hit its 2500-step guard, and a 9 s fTetWild run became 30 s to over 13 min, nondeterministically.
  - Fixed by adding the flag; closed 2026-08-18.
  - Lesson for wonky: FP-contraction and rounding-mode discipline is part of the predicate contract and must be tested. Bend already emits `#pragma clang fp contract(off)` and uses `MTLMathModeSafe` (`tmp/research/bend/bend2/comp.ts` L3324, L5020).
  - DOCUMENTED (https://github.com/BrunoLevy/geogram/issues/382).
- **A reported `expansion_nt` "bug" was a missing initialization.** An algebraic zero came out nonzero under MSVC. The cause was a missing `GEO::Expansion::initialize()` in the test program. Lévy is adding runtime checks for compiler flags and initialization (`basic/numeric.h`). The environment is itself a precondition to verify at startup. DOCUMENTED (https://github.com/BrunoLevy/geogram/issues/391).
- **Speed in another vendor's protocol.** Geogram 1.10 was slowest in the trueform paper:
  - 1644.3 ms pairwise median over 1000 Thingi10K pairs at 100k-1M triangles, 100.4x trueform at the geometric mean.
  - N-ary medians of 688 / 5265 / 66637 ms at N = 4/16/64.
  - Valid on every set.
  - DOCUMENTED (arXiv 2607.15905, Tables "pairwise", "nary"; vendor-run).

## Relevance for wonky

- **Architecture.** "Push the difficulty into predicates, keep the combinatorics textbook." Stages exchange only an indexed triangle mesh plus transient per-stage state. This fits Bend's no-mutation, fork-join style well: AABB pairs, then independent tri-tri, then independent per-triangle CDT, then a sort-based bundle build, then flood-fill classification. INFERRED.
- **Do not port expansion arithmetic.** Wonky's F32 has an 8-bit exponent (range about 1e±38) against double's 11 bits. Geogram's own experience is that double expansions already overflow and underflow on nested constructions. In F32 or F32x2 this would happen far sooner. INFERRED (from paper p.21 and issue #301 plus the IEEE formats).
  - The robust Tessael kernel is "mpz mantissa + 32-bit exponent, no trailing zeros". This is exactly a multi-limb U32 integer with a separate exponent, which matches wonky's multi-limb U32 predicates. INFERRED (paper §2.4.2).
- **Degree budget.** Geogram's vertex-based homogeneous points reach high algebraic degree:
  - Three-plane points are about degree 7 over 6 in input coordinates.
  - Perturbed in_circle on such points goes much higher.
  - With 24-bit F32 inputs this is well over 1000 bits for incircle. Unlike EMBER's 256-bit bound, it has no small fixed ceiling.
  - For uniform GPU work, wonky should either use EMBER-style plane-based points (bounded degree) or a non-Delaunay CDT (orient2d only, lower degree) with a different uniqueness mechanism for coplanar overlaps.
  - INFERRED (own degree count from the formulas on paper p.12-13 and p.20-21; not stated by the author).
- **Weiler 3-map plus bitmask classification.** This is a strong candidate for the bake-off's "B-rep recovery from tagged mesh" hybrid. The α3 twin sheets and operand bitvectors are exactly the tags, n-ary CSG expressions come for free, and radial sort is needed only at non-manifold bundles. INFERRED.
- **Explicit failure is good; silent rounding is not.** Wonky should keep Geogram's abort-on-unsortable-bundle stance. It should replace the unguarded `approximate()` on output with either exact persistent coordinates or a snap-rounding step that verifies non-intersection. INFERRED.
- **Benchmark caveat.** OBB shows Geogram 1.10.0 at 112 s on the cube grid versus Manifold at 5.3 s. The exact-construction vertex approach is correct but costly. Wonky should not expect speed from this path without bounded-width arithmetic. DOCUMENTED numbers, INFERRED conclusion.

## Pointers worth porting or studying

1. `CDTBase2d` (`delaunay/CDT_2d.{h,cpp}`, 2019 lines): combinatorics-only constrained Delaunay with three virtual hooks (`orient2d`, `incircle`, `create_intersection`). It includes intersecting-constraint handling, the one-orient2d flip classification (Fig. 7), vector-only storage, and the "edge 0 of rotated triangle" trick. This is the most portable unit.
2. The triangle-triangle simplex-pair encoding (7 open simplices, pairs (σ, σ')), plus `edge_triangle` and the "same edge" test for coplanar polygons (paper p.7-9). It is small, exhaustive and branch-light enough for uniform work.
3. `PCK.h` `SOS()` template and the `.pck` DSL: write each predicate once, then generate the filter, the exact version and the perturbation. For wonky, re-target the generator to F32x2 filter plus U32-limb exact. The FPG error-constant derivation must be redone for double-word arithmetic.
4. The predicate cache keyed by sorted vertex IDs, with the sign flipped by permutation parity.
5. The global vertex table with rational lexicographic compare `sign(w1)sign(w2)sign(w2x1−w1x2)`, plus the trick of canonical normalization (gcd, w>0, shift passed to the compare). Replace the std::map with a parallel sort-and-unique in Bend.
6. The Weiler 3-map and `classify_component` flood fill with XOR of operand bitmasks, one ray per connected component, and random re-shoot on degeneracy.
7. `simplify_coplanar_facets`: needed for any iterated-CSG mesh pipeline to prevent triangle explosion.
8. thingiCSG (BSD-3) plus the Thingi10K monsters #356074, #996816 and #101633 as regression cases.
9. Lessons list (paper conclusion): use one expression for the filter, another for exact evaluation and a third for SoS; compress often; assert 3-map consistency everywhere.

## Verdict: adapt

- BSD-3 permits porting, and the open repo contains the complete, well-factored reference pipeline for "exact co-refinement + Weiler model + n-ary classification", including a parallel-friendly CDT and a predicate generator.
- Adapt rather than adopt, for three reasons:
  - The open arithmetic kernel (double expansions) is exactly the part that fails in practice, and it would fail worse in F32. The robust kernel is closed (geogramplus).
  - Vertex-based homogeneous constructions have unbounded-ish degree, which is hostile to uniform U32-limb GPU work.
  - Output rounding without snap rounding breaks iterated use.
- Port: the combinatorial layers (tri-tri simplex pairs, CDTBase2d, Weiler 3-map, bitmask classification, coplanar simplification) and the PCK/SOS pattern.
- Swap in: wonky's own U32-limb exact kernel, ideally with EMBER-style bounded-degree plane-based points.
