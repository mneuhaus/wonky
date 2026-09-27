# Cherchi, Livesu, Scateni, Attene 2020: Fast and Robust Mesh Arrangements using Floating-point Arithmetic

- Kind: peer-reviewed paper plus reference C++ implementation (header-only).
- Canonical URL: https://doi.org/10.1145/3414685.3417818 (ACM returns 403 to scripts; metadata via Crossref).
- Other URLs:
  - Code: https://github.com/gcherchi/FastAndRobustMeshArrangements. Shallow clone at `tmp/research/cherchi-livesu-scateni-attene-2020-fast-and-robust-mesh-arra`, HEAD `bf7eb71` (2024-04-18, "Merge pull request #23 from gcherchi/dev-mf").
  - Paper PDF (author copy) with text extracts: `tmp/research/pdf/cherchi2020-mesh-arrangement.pdf`, `cherchi2020-raw.txt` (reading order is better), `cherchi2020.txt`.
  - Predicate library it builds on: Attene, "Indirect Predicates for Geometric Constructions", CAD 126 (2020) 102856, https://doi.org/10.1016/j.cad.2020.102856, code https://github.com/MarcoAttene/Indirect_Predicates (clone at `tmp/research/indirect-predicates`, HEAD `7496059`, 2026-09-01).
  - Successor that adds Boolean classification on top of this arrangement: Cherchi, Pellacini, Attene, Livesu 2022, "Interactive and Robust Mesh Booleans" (see `interactive-and-robust-mesh-booleans-cherchi-et-al.md`).
  - Linear-time earcut used for re-triangulation: Livesu et al., TVCG 28(12) 2022, https://doi.org/10.1109/TVCG.2021.3070046.
- Authors/organization, year: Gianmarco Cherchi and Riccardo Scateni (Univ. Cagliari), Marco Livesu and Marco Attene (CNR IMATI Genova). 2020. DOCUMENTED (paper header).
- Venue: ACM Transactions on Graphics 39(6), SIGGRAPH Asia 2020, 16 pages. Crossref: 56 citations (queried 2026-09-23). DOCUMENTED.
- License and porting implications (DOCUMENTED from `LICENSE`, file headers, CMakeLists):
  - Arrangement code: **MIT** (Cherchi, Livesu, Scateni, Attene 2020). Transliterating the pipeline logic into Bend is allowed with attribution.
  - Fetched at build time: Indirect_Predicates (file headers say LGPL-3.0-or-later; the repo `LICENSE` file is the LGPL-2.1 text; `gh api` reports LGPL-2.1), CinoLib (MIT), plus vendored oneTBB, Abseil and parallel-hashmap (Apache-2.0).
  - Implication: the generated predicate code (`indirect_predicates.hpp`) and the predicate compiler `JPCK_V2/jpck.cpp` are LGPL. Re-derive the predicate polynomials from the paper's appendix (the math is not copyrightable) instead of translating those files. INFERRED.
- Status and activity (DOCUMENTED, `gh api` 2026-09-23; re-checked 2026-09-24, unchanged):
  - 172 stars, 34 forks, 1 open issue, created 2020-09-03, last push 2024-04-18.
  - Contributors: gcherchi 103 commits, micheleFaedda 57, MarcoAttene 11, mlivesu 10, three one-commit contributors.
  - No releases. The README opens with a notice that the authors "do not currently have the resources to keep up with the amount of requests". Treat it as research code in maintenance-only mode.

## What it is

An algorithm that turns **any** set of 3D triangles (a soup with intersections, self-intersections, coplanar overlaps, duplicates) into a well-formed simplicial complex: the output triangles cover exactly the input point set, and any two of them are disjoint or share one vertex or one edge. It does not label cells or compute Booleans; it is the arrangement stage. Booleans, Minkowski sums and tetrahedralization are shown as applications on top of it. DOCUMENTED (§3, §6.1).

The core claim: it never uses coordinates of intersection points to make a decision. Every new vertex is kept *implicit*, as a tuple of input vertices, and every geometric test is an exact *indirect predicate* evaluated on input coordinates only, with a floating-point filter cascade. The output connectivity is "provably the same as the one obtained by using rationals" (§1). It runs about as fast as unfiltered float code and parallelizes, unlike CGAL lazy rationals, which are not thread safe. DOCUMENTED.

## How it works

### Point taxonomy (§4.1, DOCUMENTED)

| Type | Definition | Stored as |
|---|---|---|
| E, explicit | input vertex | 3 doubles |
| L, LPI | line of an edge `(q1,q2)` ∩ plane of a triangle `(r,s,t)` | 5 explicit points |
| T, TPI | intersection of the planes of three linearly independent triangles | 9 explicit points |

- The same geometric point can have many definitions (n > 3 triangles through one point). Coincidence and ordering therefore need exact predicates, not tuple equality.
- Coplanar intersections cannot be written as LPI (the edge lies in the plane). The code adds an **auxiliary tetrahedron** of 4 "jolly points" around the origin, scaled by the multiplier (`TriangleSoup::initJollyPoints`, `code/triangle_soup.cpp:382`). The intersection of coplanar edges e1 and e2 becomes LPI(line e1, plane(e2 endpoints, jolly point not coplanar with them)) (§5.4, Fig. 9). A fifth "jolly" slot stores the multiplier (issue #11). These are the "-5" extra points at the end of the output vertex list (`processing.cpp:146`).

### Homogeneous forms (§4.2.2, DOCUMENTED; degrees INFERRED from the formulas)

- LPI: `d_L = det[q1−q2; s−r; t−r]`, `n = det[q1−r; s−r; t−r]`, `λ_L = d_L·q1 + n·(q2−q1)`. The point is `λ_L / d_L`. Degree 3 for `d_L`, degree 4 for `λ_L`.
- TPI: per plane `n_v = (v2−v1)×(v3−v2)` (degree 2) and `p_v = n_v·v1` (degree 3). `d_T = det[n_v; n_w; n_u]` (degree 6). `λ_T` = Cramer determinants with one column replaced by `(p_v,p_w,p_u)` (degree 7). The point is `λ_T / d_T`.
- Every predicate substitutes these into the explicit formula and clears denominators. Example, `orient2d_XY_LTE`:
  - numerator `Δ = (d_L λ_Tx − d_T λ_Lx)(d_L p_Ey − λ_Ly) − (d_L λ_Ty − d_T λ_Ly)(d_L p_Ex − λ_Lx)`;
  - denominator `d_L² d_T`, so sign = sign(Δ)·sign(d_T).
- Full list: orient2d in XY/YZ/ZX for all 10 type combinations up to permutation (EEE, LEE, TEE, LLE, LTE, TTE, LLL, LLT, LTT, TTT), plus `pointCompare_on_{X,Y,Z}` for EE, LE, TE, LL, LT, TT (Appendices A and B).
- Filter degrees read off the appendix (`ε_Δ = c·δ^k`, k = homogeneous degree): orient2d_EEE 2, LEE 5, TEE 8, LLE 11, LTE 14, LLL 14, LLT 17, LTT 20, TTE 20, TTT **26**; pointCompare LE 4, TE 7, LL 7, LT 10, TT 13.

### Filter cascade (§4.1, §6, DOCUMENTED)

1. **Semi-static filter.** Evaluate in double. The bound is `ε = c·δ^k`, with `δ` the max magnitude of the input coordinates and coordinate differences involved. Example constants: `ε_dL = 4.884981308350689e-15 δ_L³`, `ε_dT = 8.704148513061234e-14 δ_T⁶`, `ε_Δ(orient2d_LTE) = 2.184958117212875e-10 δ^14`, `ε_Δ(orient2d_TTT) = 3.103174776697444e-6 δ^26`. `d_L`, `d_T` and `Δ` are each checked against their own filter.
2. **Interval arithmetic** if any filter fails. It needs directed rounding (`initFPU()`, compiled with `-frounding-math`; MSVC `/fp:strict`).
3. **Shewchuk expansions** (exact), with a bigfloat fallback for overflow.

- The constants were generated by Attene's predicate compiler: forward error analysis per operation, `error = e1·e2 + e1·v2 + e2·v1 + ½ulp(value)` for a product (`JPCK_V2/jpck.cpp` lines 760-823), "with FP rounding set to +∞ to be conservative" (§6).
- Predicates are written in a small DSL, e.g. `JPCK_V2/predicates/indirect/lessThanOnX_II.txt` is `k = d2·l1x − d1·l2x` with sign correction `d1 d2`. Porting only these ~70 short DSL files is a cheap way to get every formula. INFERRED (the DSL files themselves are LGPL; re-derive or treat as math).
- **Input scaling.** `computeMultiplier` (`code/processing.cpp:47`) multiplies all coordinates by the power of two that brings max |coord| near `R = 11259470696` (≈2^33.4), to keep the filters away from underflow. Power-of-two scaling is exact.
- **Robust projection** (§4.2.1). An in-plane orient2d drops the coordinate of the largest normal component. That component is found with its own filter `ε_n = 8.88395e-16 δ²` and an exact fallback, so nearly degenerate triangles never project to a segment.

### Pipeline (§5, `code/solve_intersections.cpp:meshArrangementPipeline`)

1. **Clean.** Merge bit-identical vertices (parallel sort, `mergeDuplicatedVertices`). Drop exactly collinear triangles. Merge duplicate triangles by sorted vertex triple, OR-ing their labels (`removeDegenerateAndDuplicatedTriangles`).
2. **Detect** (§5.1). The paper uses a kd-tree: split the fullest cell at its longest-axis midpoint until cells hold < 10K triangles or 10K cells exist. The current code uses `cinolib::Octree(8, 1000)`, max 1000 items per leaf. Per leaf: all pairs, AABB reject, then an exact tri-tri test (Guigue–Devillers), `tbb::parallel_for` over leaves with a spin mutex on the pair list (`find_intersections`, `intersection_classification.cpp:47`).
3. **Classify each pair** (`checkTriangleTriangleIntersections`, line 119). Three `orient3d` signs of B's vertices against A's plane, and vice versa. The sign triple selects the case (`allCoplanarEdges`, `singleCoplanarEdge`, `vtxInPlaneAndOppositeEdgeOnSameSide`, `vtxOnASideAndOppositeEdgeOnTheOther`, …). The pair emits LPI points, existing vertices inserted into the other triangle or edge, and a symbolic segment. Coplanar pairs are flagged for §5.4.
4. **Deduplicate implicit points globally.** `AuxiliaryStructure::v_map` is a `phmap::btree_map` keyed by `genericPoint::lessThan`, i.e. an exact lexicographic order on implicit points (`aux_structure.h`). A newly created LPI/TPI that compares equal to an existing one reuses its id.
5. **Insert points per triangle** (§5.2).
   - Points strictly inside: split the containing sub-triangle 1→3, located via a split tree rooted at the input triangle (`splitSingleTriangleWithTree`). Point-in-triangle tests use the mixed-type orient2d.
   - Points on an input edge: sort them along the edge with `pointCompare` and split in order. No per-point search is needed.
6. **Insert constraint segments per triangle** (§5.3, Algorithm 1 `addSegment`).
   - Walk from `v_beg` through crossed edges, collecting the left and right chains. Remove the crossed triangles and earcut both pockets. Dangling constrained edges are kept by repeating a vertex in the chain (Fig. 8).
   - If the walk crosses a previously inserted **constrained** edge, the crossing is a new point shared by three triangles. Create a TPI from the host plane and the two other triangles (`createTPI`, `triangulation.cpp:1012`, under the global mutex), split the edge, and recurse on both halves.
   - If the walk hits a vertex on the segment, split the segment there and recurse.
7. **Coplanar pockets** (§5.4). Overlapping coplanar triangles share polygonal pockets of up to 6 sides. Each triangle is refined independently, so the pockets may be triangulated differently. A global map keyed by the sorted corner list keeps the first triangulation and discards later ones, OR-ing labels into it (`solvePocketsInCoplanarTriangle`, `triangulation.cpp:1231`).
8. **Output.** Triangles with per-triangle label bitsets (`std::bitset<NBIT>`, NBIT = 32). Coordinates of implicit points are rounded to double at the very end (`computeApproximateCoordinates`), or the implicit points themselves are returned (`solveIntersections` overload with `genericPoint*`).

Arrangement *cells* (volumes) are not built by this code. The paper only sketches region growing with radial sorting around non-manifold edges (§5.5, issue #11). Cells arrive with the 2022 Boolean paper, which uses ray casting per patch instead.

## Robustness and guarantees

- **Proven:** exact combinatorics. All decisions are exact signs of polynomials in the input coordinates, so the resulting complex equals the one computed with rationals (§1, §4). DOCUMENTED.
- **Validation:** on 4,407 intersecting Thingi10K models the vertex, edge and triangle counts always matched libigl's rational implementation (§6). DOCUMENTED.
- **Not guaranteed: the rounded output.** Rounding implicit points to double can create flipped or intersecting triangles. The authors call this "the weak ring of the chain" (§7.1).
  - Naive double rounding gives a valid complex in 85.2% of the 4k models.
  - Their heuristic (cast offending coordinates to **single** precision, re-run the arrangement, convert back) fixes 96% of the remaining failures, and 99.95% if iterated (§5.6). This is the same coarse/fine grid idea as Zhou et al. 2016 §6.1 and later Valque–Lazard 2025 (see `valque-lazard-iterative-snap-rounding-for-triangle-soup-auto.md`).
  - Degenerate output triangles after rounding are expected (maintainer answer to Qingnan Zhou, issue #11). DOCUMENTED.
- **Heuristic, numeric side:** the multiplier and the filter constants assume IEEE double, a working directed-rounding mode, and inputs that do not overflow degree-26 products. Clang long ignored `-frounding-math`; in 2020 the only safe clang build was `-O0` (issue #8, https://github.com/gcherchi/FastAndRobustMeshArrangements/issues/8). DOCUMENTED.
- **Input contract, not checked:** the pipeline assumes triangles. A quad-mesh OBJ fed directly produced repeated asserts in triangulation (issue #22). There is no validation layer. DOCUMENTED.

## Parallelism and performance

All numbers DOCUMENTED from §6 and Table 1. Hardware: cluster node with 12 cores and 128 GB RAM. Dataset: the 4,407 Thingi10K models with at least one intersection. Baseline: libigl `remesh_self_intersections` on CGAL lazy rationals.

| Comparison | Faster on | Total time |
|---|---|---|
| ours serial vs libigl serial | 99.3% of models | 2.5 h vs 5.7 h |
| ours serial vs libigl parallel | 63.6% of models | 2.5 h vs 4.6 h |
| ours parallel vs libigl parallel | 94.7% of models | < 1 h vs 4.6 h |

- **Ten hardest models (parallel):** 4–63% of libigl's time (mean 18.1%) and 23–78% of its memory (mean 38.6%). Examples:
  - model 252784: 2,074,680 intersections, 104.66 s / 2.5 GB vs 1,162 s / 10.6 GB;
  - model 101633: 1.7M implicit points, almost all TPI. Here segment insertion "heavily enters recursion": parallel 868 s vs 1,378 s, and serial 2,350 s vs 1,350 s, the one case where libigl serial wins.
- **Teaser model** (76K vertices, 170K triangles, ~40M intersections): < 1 h and 23 GB parallel. libigl ran out of memory after < 4 h at 22 GB serial, or took 7 h and > 100 GB parallel. This is Thingi10K 996816, the same model CGAL's snap-rounding paper needed gs = 14 for.
- **Time profile** (serial, whole dataset): segment insertion 44.3%, kd-tree 24.2%, intersection classification and creation 13.8%, point insertion 5.6%, other 12.1%. The kd-tree was the top cost on 3,914 of 4,407 models; refinement dominates only on heavily intersecting models.
- **Filter hit rates:** model 105693 made 3,102,360 `orient2d_EEE` calls with 71 FP-filter failures (0.002%). On model 66112, `orient2d_TTT` was called twice and the FP filter failed both times; the interval stage never failed.
- **Applications:** Boolean arrangement 0.23 s vs libigl 2.04 s; Minkowski sum 0.81 s vs 2.37 s; tetrahedralization pre-pass 0.36 s vs 2.13 s.
- **Parallel structure** (code, DOCUMENTED): per-leaf detection; per-triangle refinement (`tbb::parallel_for` over triangles to split, `triangulation.cpp:165`) with shared state under one `tbb::spin_mutex` (TPI creation, output append); a parallel sort for vertex merging. The 2022 Boolean work pushed parallelism further and, per the authors, "introduced memory issues" (issue #22).

## Known failures, limitations, war stories

- #19 (Sébastien Loriot, CGAL): segfault on Thingi10K 996816 after 4 min. The authors needed ≥ 23 GB and 4 h for the paper. It turned out to be a third-party (Indirect_Predicates) breakage and disappeared after a dependency update. https://github.com/gcherchi/FastAndRobustMeshArrangements/issues/19
- #21: assert in `findIntersectingElements` (`triangulation.cpp`), reproduced on Linux, Ubuntu and Windows debug builds. Traced by a user to the SIMD `interval_number` class in Indirect_Predicates. https://github.com/gcherchi/FastAndRobustMeshArrangements/issues/21
- #22: "General instability on complex meshes". The cause was quad input; the authors also acknowledge known memory bugs from the aggressive parallelization and consider reverting to the less parallel version. https://github.com/gcherchi/FastAndRobustMeshArrangements/issues/22
- #24: endless loop, fixed by the 2024 rewrite (PR #23). The fixed output still had 2 intersections "due to a snap rounding problem". https://github.com/gcherchi/FastAndRobustMeshArrangements/issues/24
- #25 (open): three of the four public `solveIntersections` overloads call a `meshArrangementPipeline` signature that is declared but never defined, so they do not link. Visible in `code/solve_intersections.cpp` vs `.h`. https://github.com/gcherchi/FastAndRobustMeshArrangements/issues/25
- Arrangement cells are not extracted (#11). The label limit is 32 (compile-time `NBIT`).
- Output triangles come from plain earcut and "may be arbitrarily badly shaped". A CDT was left as future work (§7.1).
- Dependency churn: an Indirect_Predicates header-layout change broke builds in 2023 (#19 thread).
- **Latent scaling bug in `computeMultiplier`** (INFERRED from code, `code/processing.cpp` lines 47-63, not reported in the issue tracker as of 2026-09-24). The power of two is built as `static_cast<double>(1 << e)` with a 32-bit `int`. The target is max |coord| ≈ R = 1.126e10, so e = round(log2(R / max|coord|)) reaches 31 as soon as max |coord| is below about 7.4 model units (a part modelled in metres, or a small part in cm). `1 << 31` is negative and the "temporary fix" `if(multiplier < 0) multiplier = 1.0` silently drops the scaling; `1 << 32` and above are undefined behaviour in C++ (on x86 the shift count is masked, so 2^33 becomes 2). The semi-static filter constants assume the rescaled range, so small models run with an unintended scale. Because the filters fall through to interval and exact stages, INFERRED: this costs speed or underflow safety margin rather than correctness, but it is exactly the kind of silent fallback wonky's "fail explicitly" rule forbids. A Bend port should compute the power of two by exponent arithmetic (F32 bit manipulation or `ldexp`-style), and refuse input outside the declared range.

## Relevance for wonky

Where it plugs in:
- the arrangement stage of bake-off prototype 1 (`kernel/proto/corefine`) and of the hybrid prototype 4 (`kernel/proto/recover`), whenever wonky resolves intersections of tagged tessellations;
- importing dirty STL meshes (self-union);
- a differential oracle for any wonky arrangement: compare V/E/F counts, as the paper did against libigl.

1. **Implicit points are free provenance** (INFERRED). An LPI names (edge of triangle a, plane of triangle b), a TPI names three triangle planes. With every leaf triangle tagged by its analytic face id, each arrangement vertex directly names the analytic surface pair or triple it lies on. That is exactly the key prototype 4 needs to recover exact vertices and edge curves. Wonky should keep these tuples through output, not just the rounded coordinates.
2. **The numeric model does not transfer to F32x2** (INFERRED, important).
   - The filters are *semi-static in IEEE double*. They depend on an 11-bit exponent (degree-26 predicates on 2^33-scaled inputs reach ~2^860) and on directed rounding.
   - F32x2 has the F32 exponent range (about 2^±127) and Metal has round-to-nearest only. A degree-26 product overflows as soon as coordinates exceed ~2^4.9, and small differences underflow, which makes the filter unsound.
   - So in Bend only the **low-degree** predicates (orient3d/orient2d EEE, LEE, TEE, pointCompare LE/TE, roughly degree ≤ 8) can get an F32x2 filter, with constants re-derived from double-word error bounds (Joldes, Muller, Popescu 2017, ACM TOMS). Any filter also needs a per-predicate power-of-two rescale to keep the exponent in range.
   - Everything else should go straight to multi-limb U32 integers on integer-grid input.
3. **Bit budgets on an integer grid** (INFERRED). With b-bit grid coordinates, differences need b+1 bits:
   - `d_L` about 3b+6 bits, `λ_L` about 4b+8, `d_T` about 6b+12, `λ_T` about 7b+14;
   - `pointCompare_TT` (degree 13) about 13b+25;
   - `orient2d_TTT` (degree 26) about 26b+50: about 675 bits at b = 24, i.e. 43 of wonky's 16-bit limbs (the `kernel/proto/exact-plane/big.bend` radix).
   - Compare exact-plane's worst plane-side predicate: 9B+19 = 325 bits at B = 34.
   - The difference comes from representation. A TPI defined by 9 input points recomputes each plane (degree 3) inside every predicate. Storing each input triangle's **plane as exact integers once** (EMBER-style) makes an LPI the plane triple (plane b, plane a, edge plane of a through a jolly point) and a TPI a plane triple. Every predicate is then a plane-triple determinant with EMBER's much smaller budget.
   - Recommendation: use Cherchi's *pipeline* (implicit points, per-triangle refinement, pocket dedup, sorting along edges) with EMBER's *representation* (integer planes). That is a natural merge of prototypes 1 and 2.
4. **Bend shape of the pipeline** (INFERRED).
   - Detection: fork-join over octree leaves with uniform per-pair work (6 orient3d, a sign-table case split). Good for GPU call trees.
   - Pair classification: a map over pairs emitting `(triangle id, point)` and `(triangle id, segment)` records. Grouping by triangle is a sort, with no mutation.
   - Global dedup: replace the mutex-guarded btree with a fork-join merge sort under an exact comparator (`pointCompare` X, then Y, then Z) followed by unique. Comparisons are not uniform in cost (filter misses), so run it on the CPU/C backend.
   - Per-triangle refinement: a pure function (triangle, its points, its segments) → local triangles. The one non-local step is TPI discovery inside a triangle. Do it in two passes: pass 1 emits candidate TPIs keyed by the sorted triple of input triangle ids; pass 2 dedups exactly and re-runs refinement with the full point set. Each TPI appears in all three host triangles, so every triangle sees it.
   - Coplanar pockets: keyed by sorted corner ids, again a sort and dedup, with no global map.
5. **Output rounding must be a separate, validated step** (INFERRED). Use Valque–Lazard-style snap rounding onto an F32-exact grid with an explicit iteration cap and failure result. Their own float-cast heuristic is the ancestor of that method. This matches wonky's rule that approximations carry explicit tolerances.
6. **Testing** (DOCUMENTED method, INFERRED use): the V/E/F-count agreement check against an independent exact implementation is a cheap differential oracle for wonky's JS, C and Metal targets and the bake-off prototypes. The paper also used Thingi10K's 4,407 intersecting models; its hardest cases (996816, 101633, 252784) make good stress fixtures.
7. **Update 2026-09-24: where the bake-off landed and what that means for this paper** (DOCUMENTED from `docs/hybrid-boolean-plan.md`, `docs/proto-corefine.md`; mapping INFERRED).
   - Production path: corefine (a Bend port of Manifold's Boolean3 with symbolic perturbation over F32x2) decides topology, recover rebuilds the exact B-rep. corefine lives in `kernel/hybrid/corefine/` now. exact-plane stays as a differential oracle ("CI and paranoid mode": corefine and exact-plane must agree on components, Euler characteristic and volume within 1e-7 relative).
   - **Cherchi's filter cascade is already in wonky, in F32 form.** Plan step 1 added `kernel/hybrid/corefine/gate.bend`: an exact self-intersection gate over all pairs of result triangles with different tags (BVH self-join), decided in three tiers: F32 tests on local differences with certified error bounds, then structural shortcuts (a triangle on one closed side of the other's plane; axis-aligned triangles know their plane exactly, zeros included), then a Real (F32x2) filter and big integers. That is the semi-static → interval → exact ladder of this paper re-derived for F32 and without directed rounding. Measured cost: +10.6-10.8 % cpu18 compute on the corpus; it turned the 10 point-contact and 4 rotated-coplanar invalid `ok` results into named refusals.
   - **The open gap is exactly Cherchi's implicit points.** The plan (§2.2, step 9) wants corefine to emit "exact provenance per new edge (its tag pair)" so recover can take curve assignments from the Boolean instead of re-deriving them from patch adjacency, and so recover's sliver heuristics (the source of its wrong "exact" answers) become unnecessary. An LPI is (edge of triangle a, plane of triangle b), i.e. a (tag a edge, tag b) pair; a TPI is a tag triple. Carrying these tuples through the result format is the concrete porting target from this paper, not the arrangement code itself.
   - **Rotated coplanar input is the case where Cherchi's exact arrangement would be "right" and still unhelpful.** After a rotation rounded to F32x2, coplanar carriers differ by about 1e-14 mm; an exact arrangement then resolves the real (tiny) intersections and emits slivers, as it does for any input. wonky fixed this upstream with carrier unification on the face table (`kernel/hybrid/unify.bend`, 2^-44·scale, never for exactly axis-aligned carriers). A Cherchi-style arrangement in wonky would need the same unification step before it, or plane-id sharing so coplanarity is known symbolically.

## Pointers worth porting or studying

- Paper §4.1 Fig. 3 (point types), §4.2.2 (LPI/TPI formulas), Appendix A/B (all orient2d and pointCompare numerators and filter degrees).
- §5.3 Algorithm 1 (`addSegment`) and Figs. 6 and 8: constrained-segment insertion with crossing-constraint TPI creation and dangling edges.
- §5.4 Fig. 9: jolly-point trick for coplanar LPIs; Fig. 7: pocket dedup.
- `code/intersection_classification.cpp` lines 119-930: complete tri-tri case analysis from orient3d sign triples. It is a checklist for wonky's own classifier.
- `code/triangulation.cpp`: `splitSingleTriangleWithTree` (417), `addConstraintSegment` / `findIntersectingElements` (602-800), `earcutLinear` (917), `createTPI` (1012), `solvePocketsInCoplanarTriangle` (1231).
- `code/processing.cpp`: `computeMultiplier`, `mergeDuplicatedVertices` (sort-based variant), `removeDegenerateAndDuplicatedTriangles` (label OR on duplicates).
- `code/aux_structure.h`: exact-ordered implicit-point map, and the disabled epsilon variant `PREDICATES_NO`, which shows the authors tried and dropped approximate keys.
- Indirect_Predicates `JPCK_V2/predicates/indirect/*.txt`: compact DSL specs of every indirect predicate. `jpck.cpp` lines 730-830: the forward error-bound propagation rules, to re-derive for F32x2.

## Verdict: adapt

The pipeline (implicit points with provenance, per-triangle refinement, exact dedup, pocket consistency) is MIT, well specified, measured on 4k hard models, and maps onto sort/map/fork-join once the mutex-guarded global maps become sorts. Adapt the structure. Do not adopt the numerics: the double semi-static filters, directed rounding and degree-26 TPI predicates do not fit F32x2 or U32 limbs well. Re-express implicit points as integer plane triples (EMBER-style) so the predicates stay within the exact-plane bit budget. Treat output rounding as a separate validated snap-rounding step. Do not copy the LGPL predicate code. After the bake-off (2026-09-24) the most valuable piece to adapt is narrower than the whole pipeline: the implicit-point tuples (LPI = edge × plane, TPI = plane triple) as **provenance records in corefine's result**, which is the open "exact provenance per new edge" item of the hybrid plan. A full Cherchi-style arrangement becomes relevant again only for dirty STL import (self-union) or as a third differential oracle.
