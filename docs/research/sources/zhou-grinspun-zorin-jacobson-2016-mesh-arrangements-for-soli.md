# Zhou, Grinspun, Zorin, Jacobson 2016: Mesh Arrangements for Solid Geometry

- Kind: peer-reviewed paper plus reference implementation in libigl.
- Canonical URL: https://www.cs.columbia.edu/cg/mesh-arrangements/ (project page; local copy `tmp/research/zhou2016/page.html`).
- Other URLs:
  - DOI: https://doi.org/10.1145/2897824.2925901 (ACM returns 403 to scripts; metadata via Crossref).
  - Paper PDF: `tmp/research/pdf/zhou2016-mesh-arrangements.pdf`, text `tmp/research/pdf/zhou2016.txt`. Supplemental: `tmp/research/pdf/zhou2016-supplemental.pdf`.
  - Dataset paper: Zhou and Jacobson, "Thingi10K", arXiv:1605.04797 (`tmp/research/pdf/zhou2016-thingi10k.pdf`).
  - Implementation: `igl::copyleft::cgal::mesh_boolean` in libigl, https://github.com/libigl/libigl/tree/main/include/igl/copyleft/cgal. Sparse shallow clone of that directory at `tmp/research/zhou-grinspun-zorin-jacobson-2016-mesh-arrangements-for-soli/libigl`, HEAD `7100764` (2026-09-05).
  - Benchmark wrapper: Open-Boolean-Benchmark runner `mesh-arrangements-for-solid-geometry/2.6.0` (libigl v2.6.0), local `tmp/research/open-boolean-benchmark-boolean-benchmark-runners/mesh-arrangements-for-solid-geometry/`.
- Authors/organization, year: Qingnan Zhou and Denis Zorin (NYU), Eitan Grinspun and Alec Jacobson (Columbia). SIGGRAPH 2016. DOCUMENTED (paper header).
- Venue: ACM Transactions on Graphics 35(4), Article 39, 15 pages. Crossref: 141 citations (queried 2026-09-23). DOCUMENTED.
- License and porting implications:
  - libigl files carry MPL-2.0 headers. The licensing page says files under `include/igl/copyleft/cgal` are MPL-2.0 **and** subject to the licenses of the external library, here CGAL. Per the `package_info/*/license.txt` files on CGAL main, `Triangulation_2` and `Box_intersection_d` are "GPL (v3 or later)" and `Kernel_23` is LGPL v3+ (DOCUMENTED). "Only include these headers if you accept the licensing terms of the corresponding external library" (https://libigl.github.io/license/). DOCUMENTED.
  - GitHub reports the repo as GPL-3.0 because of `LICENSE.GPL`. DOCUMENTED (`gh api`).
  - Implication: transliterating libigl files into Bend would make them MPL-2.0 (file-level copyleft) and arguably CGAL-derivative. The paper is a complete, precondition/postcondition-style spec, so re-implement from the paper and treat libigl as a behavioural reference only. INFERRED.
  - Blender's "Exact" solver (`source/blender/blenlib/intern/mesh_boolean.cc`, GPL-2.0+) is an independent port of this paper on GMP `mpq3` (see `blender-issue-114476-exact-boolean-v2-howard-trickey.md`).
- Status and activity:
  - Research finished. libigl is active: 5,090 stars, 1,217 forks, 155 open issues, last push 2026-09-21, latest release v2.6.4 (2026-09-15). DOCUMENTED (`gh api` 2026-09-23).
  - The Boolean code itself is stable and only touched by refactors (e.g. `mesh_boolean.cpp` 2024-12-20 "PlainObject -> MatrixBase"). DOCUMENTED (`gh api .../commits?path=`). Re-checked 2026-09-24: unchanged (libigl 5,090 stars, pushed 2026-09-21; last `mesh_boolean.cpp` commit still 2024-12-20).
  - The project page says the method is "now implemented in Blender and available to Blender's 1-3 million users". DOCUMENTED.

## What it is

A two-stage, **variadic**, exact CSG method for triangle meshes:

1. **Arrangement construction** (independent of the operation). Resolve all intersections of all input meshes exactly, split the result into manifold patches, build the cell/patch incidence graph of the space partition, and label every cell with a **winding-number vector** `w = [w_1..w_n]`, one entry per input mesh.
2. **Extraction.** Keep the boundary between cells where an extraction function `f(w)` changes value.

Union, intersection, difference, XOR, "inside at least k of n", self-union (repair) and outer hull are all just different `f`. DOCUMENTED (§1, §3.2, §4).

Input class: **PWN** meshes, whose generalized winding number is piecewise constant and integer. This allows self-intersections, non-manifold edges and vertices, multiple and nested components, |w| > 1, coplanar and duplicate faces, degenerate triangles, and open boundaries that meet geometrically ("seams"). Not allowed: true open boundaries and non-manifold "flaps". Output: a **solid** mesh, i.e. self-intersection free, no degenerate or duplicate triangles, winding number 0 or 1 everywhere. It may be non-manifold (two cubes kissing along an edge give a non-manifold union by design). The output is exact in rational coordinates. DOCUMENTED (§3.1, §3.3).

## How it works

### Numeric model (§5 Preconditions, Appendix, §6, DOCUMENTED)

- Vertices live in Q³. Double input casts losslessly into Q³; segments and convex polygons with endpoints in Q³ are closed under intersection.
- Implementation: CGAL `Epeck` (lazy exact: a double-interval approximation with a GMP rational fallback) for every construction and predicate: tri-tri intersection, 2D CDT, closest point, point-plane.
- The output can stay exact (CSGTree) or be rounded to double in a post-process (§6.1).
- No general-position assumption and no numerical perturbation. The only symbolic perturbation is index-based tie breaking between exact duplicate triangles in the edge sort (§5.5.3).

### Stage 1a: intersection resolution (§5.1, libigl `remesh_self_intersections`, `SelfIntersectMesh.h`, `remesh_intersections.cpp`)

1. Drop exactly zero-area triangles; they do not affect the winding number.
2. Candidate pairs from CGAL `box_self_intersection_d` with a cutoff. Exact tri-tri intersection gives empty, a point, a segment, or a convex polygon.
3. Group triangles into **coplanar clusters** connected by non-trivial coplanar overlaps. For each cluster, compute **one** 2D constrained Delaunay triangulation of the convex hull of all constraints (cluster triangle edges plus every point, segment and polygon from intersections with any triangle), with constraints pre-split at their mutual intersections.
   - A single CDT per cluster guarantees identical sub-triangulations of overlapping coplanar triangles. Per-triangle triangulation (Attene 2014, Jacobson 2013, Barki 2015) can produce conflicting triangulations, which break the next stage (Fig. 10).
4. Replicate: for each original triangle t, take the CDT sub-triangles not strictly outside t (exact 2D predicates), orient them like t, and tag each with a reference to t (the birth-parent index `J`, which also serves attribute transfer, Fig. 11).
5. Merge geometrically duplicate vertices by lexicographic sort and unique on exact coordinates. **Keep duplicate triangles**: removing them needs the extraction function. Postcondition: an exact PWN mesh with no self-intersections and the same winding field.

### Stage 1b: cells (§5.2, libigl `extract_cells.cpp`, `extract_cells_single_component.cpp`, `order_facets_around_edge(s).cpp`, `closest_facet.cpp`, `outer_facet.cpp`)

- **Patches:** maximal sets of triangles connected across manifold edges (`igl::extract_manifold_patches`). Patch boundaries are non-manifold edges.
- **Per connected component:** for each pair of incident patches, take one representative non-manifold edge, **sort the incident facets cyclically** around it, and walk consecutive pairs (r_i, r_{i+1}), unifying the cell above one with the cell below the next. The result is a bipartite cell/patch graph; each patch has exactly one cell above and one below.
- **Nesting** across components: for component K_i, pick a point p on it. Candidates are components K_j whose ambient cell does not contain p. If there are candidates, merge K_i's ambient cell with the cell of the closest K_j containing p (point location); otherwise merge it with the global ambient cell C0.
- **Point location** (§5.5.1): find the closest point c on the mesh.
  - If c is on an edge or inside a face, insert a dummy facet (edge, q) into the sorted fan around that edge; the neighbouring facet identifies the cell.
  - If c is at a vertex, pick a convex-hull edge at that vertex.
  - Only edges give robust answers, because duplicate-triangle stacks make face interiors ambiguous.
- **Ambient cell** (§5.5.2): take the vertex v with maximal |x|. Then q = v + (1,0,0) is outside, with closest point v. Pick the incident edge of maximal projected slope |e_y/e_x| (it lies on the convex hull) and sort facets around it. The paper points out a counterexample to Attene 2014's "largest normal x-component" rule at non-manifold vertices (Fig. 12).
- **Edge sort** (§5.5.3), divide and conquer:
  - Partition the facets around edge {i,j} relative to t0 into four groups: (1) coplanar, same side; (2) coplanar, opposite side; (3) below; (4) above.
  - Recurse on groups (3) and (4).
  - Order groups (1) and (2) by **simulation of simplicity**: a global index ε_k, **signed by the triangle's incidence orientation on the edge**, so that duplicate stacks are ordered consistently from all three of their edges (Fig. 13).
  - libigl implements this with an exact `Plane_3` through (s, d, o) plus `coplanar_orientation`, and throws on degenerate facets.

### Stage 1c: winding numbers (§5.3, libigl `propagate_winding_numbers.cpp`)

- Seed the ambient cell with `w = 0`.
- BFS over the cell graph: crossing patch p that originates from mesh A_i changes `w_i` by ±1 depending on orientation, `w_n = w_c + s_p·e_i` (Eq. 7).
- Complements: `w_j = 1 − |w_i|` (orientation-insensitive) or `1 − w_i` (sensitive), Eq. 8, with infinity seeded at 1.
- PWN check: after resolution, the total signed incidence of every edge must be zero (§3.1 "Verification"; libigl `igl::piecewise_constant_winding_number`, which returns `valid = false` and asserts in debug builds).

### Stage 2: extraction (§5.4, libigl `mesh_boolean.cpp`)

- Flag cells with `f(w)` true. Output every patch that separates a flagged cell from an unflagged one, flipped when the flagged cell is above.
- Remove zero-volume symbolic cells by deleting triangles whose total signed occurrence is 0.
- Classic operations (Eqs. 3-6):
  - union: `∃i: w_i ≠ 0`;
  - intersection: `∀i: w_i ≠ 0`;
  - minus: `w_1 ≠ 0 ∧ w_2 = 0`;
  - "min-2": at least two nonzero.
  - Using `> 0` instead of `≠ 0` makes the operation orientation-sensitive.
- libigl encodes the Boolean as `wind_num_op(w)` evaluated on both sides of each face plus `keep(w_out, w_in)` (`mesh_boolean_type_to_funcs.cpp`). It then runs `resolve_duplicated_faces` (unconditional: coincident opposite faces cancel) and finally `assign_scalar`, which rounds the exact coordinates to the output scalar type (`mesh_boolean.cpp` lines 359-409, DOCUMENTED).

### Compile-time switches in the libigl implementation (DOCUMENTED from code, re-checked 2026-09-24)

Correction of an earlier version of this note, which claimed the small-cell relabel always runs. It does not. `mesh_boolean.cpp` lines 34-36 on main (`7100764`) and at tag v2.6.0 read:

```
//#define MESH_BOOLEAN_TIMING
//#define DOUBLE_CHECK_EXACT_OUTPUT
//#define SMALL_CELL_REMOVAL
```

- **`SMALL_CELL_REMOVAL` (off by default).** When defined, `relabel_small_immersed_cells(V, F, …, 1e-3, Wr)` runs before extraction (line 314-317). It converts the exact vertices to double, computes each cell's volume, and relabels any cell with volume < 1e-3 (absolute, model units; a 0.1 mm cube in mm) whose neighbours all carry one label to that label, i.e. it silently fills tiny voids and deletes tiny islands. Its loop prints every cell volume with `std::cout`. The define was commented out from the very first commit (`144527c6`, 2016-01-13, "Added the ability to remove small immersed cells"; the diff adds `//#define SMALL_CELL_REMOVAL`). The paper presents small-cell removal only as an optional application (Fig. 32). So this is a dormant option, not a hidden default.
- **`DOUBLE_CHECK_EXACT_OUTPUT` (off by default).** The exact output self-intersection check (`SelfIntersectMesh` with `detect_only`, throwing `"Self-intersection not fully resolved."`, lines 366-388) is also compiled out. A default libigl build therefore does **not** verify the postcondition "no self-intersections" at run time; it relies on the algorithm being correct.
- **The `bool` return is the only failure signal.** `mesh_boolean` returns `valid`, which is the result of `propagate_winding_numbers`. On non-PWN input that function hits `assert(false && "Input mesh is not PWN")` in debug builds; in release builds it sets `valid = false` and **extraction continues**, so the caller gets a mesh plus `false` (`propagate_winding_numbers.cpp` lines 125-130, `mesh_boolean.cpp` lines 274-278, 414). A caller that ignores the flag uses garbage silently.
- **Rounding invariant.** The fast `assign_scalar` path is `CGAL::to_double(rhs.exact())`, not the interval midpoint. The code comment explains why: `remesh_intersections` runs `unique` *after* rounding, which is only correct if `a = b ⇒ double(a) = double(b)`; `CGAL::to_double(1/3) ≠ CGAL::to_double(1 − 2/3)` on the lazy approximation breaks that (https://github.com/CGAL/cgal/discussions/6000). `assign_scalar.cpp`, DOCUMENTED. INFERRED lesson for wonky: any dedup-after-rounding step needs a rounding function that is a function of the exact value, not of its computation history. exact-plane's `floor(X·2^12 / W)` with exact remainder correction has that property.

## Robustness and guarantees

- **Claimed and demonstrated:** for every PWN input, the output is an exact solid mesh (§5 postconditions).
  - Self-union of all 8,616 PWN meshes of Thingi10K: 100% success on every checked criterion (output produced, no self-intersections, no open boundaries, zero total signed edge incidence).
  - CGAL Nef, Carve, Cork, QuickCSG and Attene 2014 each failed at least one criterion (Fig. 16).
  - Barki et al.'s benchmark expanded to all 1,404 pairwise operations on 26 models: all valid (Fig. 22).
  - DOCUMENTED.
- **Third-party failure data on predecessors** (§7.2, DOCUMENTED): the no-longer-maintained Bernstein–Fussell 2009 implementation "failed on most examples"; the web-service implementation of Campen–Kobbelt 2010 failed to produce a result about 40% of the time. Methods assuming general position or using perturbation (Cork, QuickCSG) struggle with coplanar intersections.
- **Heuristic parts:**
  - Rounding to floating point (§6.1): naive rounding breaks solidity in 2.19% of outputs. The heuristic iterates four steps, with no convergence guarantee:
    1. round everything to double;
    2. find the triangles in self-intersections;
    3. round their vertices to **single** precision;
    4. recompute the self-union.

    It succeeds on all but 5 of 8,616 meshes (99.95%) within 20 iterations. DOCUMENTED. The heuristic is not integrated into libigl (maintainer, 2017: "We have been meaning to integrate this", https://github.com/libigl/libigl/issues/457).
  - Rounding between chained operations: libigl `mesh_boolean` returns doubles by default. Iterating it rounds between steps and degrades: a roof-tile union loop self-intersects more with each step (https://github.com/libigl/libigl/issues/1116). The maintainer's advice: keep exact scalars or use `CSGTree` and round once at the end. Exact chaining costs roughly doubling "the size and cost of doing arithmetic on each mesh vertex position" per operation (Jacobson, https://github.com/libigl/libigl/issues/2377). DOCUMENTED.
  - The 1e-3 small-cell relabel exists as an absolute tolerance inside an "exact" pipeline, but only behind the compile-time switch `SMALL_CELL_REMOVAL`, which is off in every released libigl. The output self-intersection check is also compiled out by default. DOCUMENTED (code).
  - Non-PWN input in a release build returns `false` *and* a mesh (see above). DOCUMENTED (code).
- **Out of scope:** open boundaries and non-manifold flaps, which is 18% of Thingi10K (§8). Generalized winding numbers would extend the idea, but the combinatorial subroutines would need robust GWN evaluation. DOCUMENTED.

## Parallelism and performance

- **Paper** (8-core Xeon 3 GHz, 16 GB; self-union of 8,616 meshes; Fig. 17 violin plot, geometric means read from a low-resolution figure, approximate):
  - ours ≈ 0.2–0.3 s, CGAL Nef ≈ 1.7 s, Carve ≈ 0.2 s, QuickCSG ≈ 0.06 s, Cork ≈ 0.08 s;
  - "while ours is not the fastest, it is competitive";
  - the profile is dominated by triangle–triangle intersection detection and exact construction (Fig. 18). DOCUMENTED.
- **Parallelism:** only candidate pair processing is parallel. CGAL `Lazy_exact_nt` reference counting makes even reads thread-unsafe, so a mutex guards "every mesh vertex" (§6). libigl `SelfIntersectMesh.h` splits pairs into `num_threads` chunks with `std::thread` and a mutex on the offending list. The per-cluster CDTs run under `igl::parallel_for` (`remesh_intersections.cpp:387`). DOCUMENTED.
- **Variadic vs binary:**
  - 10-tet union is about 2× faster than a balanced binary tree and 6.5× faster than a linear chain, with 384 vs 1,000 output triangles.
  - "Inside ≥ 5 of 10" costs about the same as the union, where a binary decomposition needs 1,259 operations (§7.3). DOCUMENTED.
- **Later third-party numbers:**
  - Cherchi et al. 2020: the arrangement stage alone, 4,407 Thingi10K models, 12 cores: libigl 5.7 h serial / 4.6 h parallel, vs < 1 h for the float-filtered implicit method. It ran out of memory at 22 GB on a 170K-triangle model with ~40M intersections (see `cherchi-livesu-scateni-attene-2020-fast-and-robust-mesh-arra.md`).
  - Cherchi et al. 2022: 3,814 Thingi10K Booleans take 28.3 min with libigl vs 4.5 min with IARMB. libigl's classification stage is on average 11.34× slower (up to 101×).
  - Blender (M3 Max): the mesh-arrangements port averages 95 ms vs Manifold 15 ms on the EMBER Thingi10K protocol (see the Blender note).
  - Vendor-run iterated CSG (Solidean blog, libigl v2.6.0, which **rounds to double between steps** in the OBB runner; `runner.yaml` notes "Mesh type: Eigen::MatrixXd"):
    - 9-op sphere/torus chain: correct, 5.6 s (Manifold 332 ms);
    - terrain carve: crashed at op 184 after ~19 min;
    - 1,999-op cube grid: canonical in 62 s (Manifold 5.3 s, Solidean 0.98 s);
    - dome carve: 47 s at 100 steps, timeout at 1,000.
    - DOCUMENTED there (`solidean-iterated-csg-benchmark-series-2026.md`), HEARSAY until reproduced.
  - OBB self-rating for Mesh Arrangements: E R S (exact, robust, self-intersection input). DOCUMENTED (OBB README).

## Known failures, limitations, war stories

- **Rounded outputs create degenerate or self-intersecting triangles.** "The output of mesh_boolean are coordinates in the space of rational numbers … when they're naively cast to float … triangles may become degenerate" (https://github.com/libigl/libigl/issues/457). DOCUMENTED.
- **Exact but non-manifold output surprises users** ("mesh_boolean Creates Non-Manifold Mesh", https://github.com/libigl/libigl/issues/815). The answer is "that's the exact result"; `igl::decimate` then asserts on it. DOCUMENTED.
- **STL input:** STL loses connectivity, so every shared edge must be rediscovered as an intersection. One user reported 20 min to hours; after deduplicating vertices and building in release mode it took about 4.7 s (https://github.com/libigl/libigl/issues/1685). Windows builds remained anomalously slow in 2024 (same thread). DOCUMENTED.
- **Memory:** "libigl's boolean take very large memory" (https://github.com/libigl/libigl/issues/270); Cherchi 2020's > 100 GB case above. DOCUMENTED.
- **Chained rounding** degrades results (#1116, #2322, #2377, above).
- **Iterated CSG crashes:** Nehring-Wirxel et al. 2021 report both mesh-arrangement implementations crashing after 71 steps of a milling simulation (see `campen-kobbelt-2010-exact-and-robust-self-intersections-for--mesh-bool.md` for the citation). DOCUMENTED there.

## Relevance for wonky

1. **Winding-number labelling of arrangement cells is the reusable core** (INFERRED).
   - It gives wonky variadic, n-ary CSG over a whole feature tree in one arrangement. Wonky's bake-off jobs are CSG trees, and the `many operands` case is a 20-union chain.
   - Result selection becomes a pure function `f(w)` per face side, trivially uniform and GPU-friendly.
   - Per operand, `w_i` can be an I32 (or an offset U32), and the vector for ≤ 32 operands fits a few U32s.
   - Labelling is a BFS over the cell graph. In Bend, express it as label propagation to a fixpoint, or as union-find plus prefix sums over a spanning tree: fork-join friendly, no mutation.
2. **Consistent coplanar handling is a hard requirement for FDM CAD** (INFERRED). Flush faces, stacked boxes and pockets aligned by construction are the normal case (wonky's `coplanar and touching faces` cases). Zhou's rule, one CDT per coplanar cluster plus duplicate triangles kept until extraction plus signed-index SoS in the edge sort, is the reference behaviour. Cherchi 2020 reaches the same end by deduplicating pockets.
3. **The edge-fan sort with signed-index SoS** (§5.5.3) is directly needed by any wonky classifier that works at non-manifold edges: prototype 1's patch classification and prototype 2's output assembly. It needs only orient3d plus an in-plane orientation on input or plane-triple points. That is uniform work per edge, and the four-group divide and conquer is a natural fork-join. INFERRED.
4. **Do not copy the numeric model** (INFERRED). EPECK lazy rationals mean heap DAGs, reference counting, GMP and mutexes. None of that exists in Bend, and they grow per chained operation. Use fixed-width integer or plane-based predicates (exact-plane) and never round between operations, or snap-round with validation.
5. **Precondition design:** PWN is the right input contract for wonky (INFERRED).
   - Wonky's own tessellations are closed and oriented by construction.
   - Imported meshes can be checked exactly with the signed-edge-incidence test after resolution.
   - Anything non-PWN must fail explicitly, never go to a raycast fallback like Blender's, and never return "a mesh plus a false flag" like libigl's release build. In Bend the result type makes that impossible if the Boolean returns `Unresolved{reason}` instead of a mesh.
   - If wonky ever removes small cells or slivers (libigl's dormant `SMALL_CELL_REMOVAL`), the threshold must be an explicit, reported tolerance in mm tied to the FDM nozzle and layer size, and the result must say it was applied. recover's sliver absorption was exactly this kind of silent step and was the source of wrong "exact" answers in the bake-off (`docs/hybrid-boolean-plan.md` §7, plan step 2).
   - Run-time postcondition checks must be on by default. libigl compiles its output self-intersection check out; wonky's corefine had the same gap until plan step 1 added `kernel/hybrid/corefine/gate.bend` (vertex-link plus exact self-intersection gate, +10.6-10.8 % cpu18 compute on the corpus, measured).
7. **Update 2026-09-24: how the bake-off used these ideas** (DOCUMENTED from `docs/proto-exact-plane.md`, `docs/proto-corefine.md`, `docs/hybrid-boolean-plan.md`; INFERRED mapping to this paper):
   - exact-plane already implements Zhou-style labelling in a reduced form: each kept piece is classified by an exact axis ray that yields a per-leaf **parity** vector, and the CSG tree is evaluated on both sides of the piece ("keep if the two results differ, flip if above is inside"). That is `f(w)` with `w_i ∈ {0,1}`. It is sufficient for closed, non-self-intersecting leaves; full PWN input (|w| > 1, self-overlapping leaves) would need integer winding numbers instead of parity.
   - exact-plane keeps one of two coincident faces by a leaf-index rule ("a coplanar triangle of a lower-numbered leaf marks the piece as a duplicate"), the same idea as Zhou's signed-index tie break for duplicate stacks.
   - corefine flattens union chains into operand lists before any Boolean (`pin-array-chain-20`: 20 Booleans become 1). That is a restricted form of Zhou's variadic CSG; the general form (one arrangement for a whole CSG tree plus `f(w)`) remains the natural next step if chain cost matters.
   - Non-manifold contact policy: wonky chose **refusal** (expected-refusal cases `cylinder-tangent-box-face`, `hole-tangent-edge`; point contacts refused by the corefine gate since plan step 1). Zhou deliberately outputs non-manifold solids. Both are consistent; wonky's choice matches the CGAL contract (see `cgal-polygon-mesh-processing-corefinement-booleans.md`).
6. **Testing** (DOCUMENTED method, INFERRED use):
   - Thingi10K and Zhou's postcondition checks (no self-intersections, no open boundaries, zero signed edge incidence) are good validator checks for `scripts/bakeoff/validate.mjs`.
   - A-union-rotated-A with 10 clones (Fig. 23), intersect-with-own-clone (Fig. 21, which kills perturbation methods) and the 26-model Barki pairs are cheap adversarial fixtures.

## Pointers worth porting or studying

- Paper §3 (PWN definition, extraction functions Eqs. 3-8), §5 (every subroutine with pre- and postconditions: a ready-made spec), §5.5.3 with Fig. 13 (signed-index SoS for duplicate stacks), §5.5.2 with Fig. 12 (ambient-cell counterexample), §6.1 (rounding heuristic), Table 1 (input-restriction chart of prior methods).
- libigl `include/igl/copyleft/cgal/`:
  - `mesh_boolean.cpp` 182-420: the full pipeline;
  - `order_facets_around_edge.cpp`: the 2-facet base case plus the separator-plane split;
  - `propagate_winding_numbers.cpp`: BFS, and the odd-cycle consistency check behind a debug macro;
  - `extract_cells_single_component.cpp`, `closest_facet.cpp`: point location by dummy facet insertion;
  - `remesh_intersections.cpp`: per-coplanar-cluster CDT;
  - `relabel_small_immersed_cells.cpp` plus the `SMALL_CELL_REMOVAL` / `DOUBLE_CHECK_EXACT_OUTPUT` switches at the top of `mesh_boolean.cpp`: a dormant absolute tolerance and a disabled postcondition check, as anti-patterns;
  - `assign_scalar.cpp`: the `a = b ⇒ round(a) = round(b)` requirement for dedup after rounding;
  - `CSGTree.h`: exact chaining.
- OBB runner `mesh-arrangements-for-solid-geometry/2.6.0/src/main.cpp`: a minimal harness wrapper, for reproducing the vendor numbers locally.

## Verdict: learn-from

This is the conceptual baseline of exact mesh CSG. Take over its ideas: arrangement plus per-operand winding-number vectors, PWN as the input contract, variadic extraction functions, one triangulation per coplanar cluster, SoS-signed edge sorting, and pre/postcondition-driven subroutine specs. Do not port it. The EPECK/GMP numeric model is incompatible with Bend and slow (5.7 h vs < 1 h for Cherchi 2020 on the same arrangements). libigl rounds between chained operations, compiles its output self-intersection check out by default, and in release builds returns a mesh even when the input fails the PWN check. The implementation is MPL-2.0 plus CGAL-copyleft. wonky's exact-plane prototype already carries the core idea in parity form (per-leaf ray parity plus CSG-tree evaluation per piece); integer winding vectors are the upgrade if PWN input with self-overlaps must be accepted.
