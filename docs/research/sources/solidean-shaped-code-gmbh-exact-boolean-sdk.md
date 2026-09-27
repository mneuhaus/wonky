# Solidean (Shaped Code GmbH), exact mesh Boolean SDK

- Kind: commercial closed-source C++ SDK (C API, Python bindings; C# and Rust announced), plus blog and docs.
- Canonical URL: https://solidean.com
- Other URLs: https://solidean.com/docs/concepts/exact-arithmetic/, https://solidean.com/blog/2025/from-ember-to-solidean/, https://solidean.com/blog/2026/building-your-own-u128/, https://solidean.com/docs/concepts/solid-vs-supersolid/, https://solidean.com/docs/concepts/export-philosophy/, https://solidean.com/docs/faq/, benchmark posts https://solidean.com/blog/2026/first-benchmark-results-iterated-csg/, https://solidean.com/blog/2026/iterated-cube-grid-benchmark/, https://solidean.com/blog/2026/terrain-carve-benchmark/, https://solidean.com/blog/2026/iterated-dome-carve-benchmark/. Research basis: Trettner, Nehring-Wirxel, Kobbelt, "EMBER: Exact Mesh Booleans via Efficient & Robust Local Arrangements", ACM TOG 41(4) art. 39, SIGGRAPH 2022 (local copy tmp/research/pdf/trettner2022-ember.pdf); Nehring-Wirxel, Trettner, Kobbelt, "Fast Exact Booleans for Iterated CSG using Octree-Embedded BSPs", CAD 2021 (tmp/research/pdf/nehringwirxel2021-octree-bsp.pdf).
- Authors/organization, years: Shaped Code GmbH (Philip Trettner, Julius Nehring-Wirxel and colleagues from RWTH Aachen, Kobbelt group; INFERRED from EMBER authorship plus the fact that Philip Trettner is the sole committer of the Open Boolean Benchmark runners, https://github.com/Open-Boolean-Benchmark/boolean-benchmark-runners). Product 2025-2026; release 2026.1. DOCUMENTED (https://solidean.com/blog/2025/from-ember-to-solidean/).
- License: proprietary. Community Edition free for learning, research, evaluation, personal and non-commercial use, no registration; commercial tiers Indie/Pro/Enterprise with flat annual licensing (https://solidean.com, https://solidean.com/blog/2026/licensing-simplified/). The OBB runner notes: "benchmarking/evaluation permitted; redistribution and commercial use prohibited" (https://github.com/Open-Boolean-Benchmark/boolean-benchmark-runners/blob/main/solidean/2026.1/runner.yaml). Porting implication: nothing to port from the product; only the published papers (EMBER, octree-BSP) and the public blog posts are usable as algorithm sources. DOCUMENTED.
- Status: active. Blog posts through 2026-07-02; ARM64 (macOS/iOS/Android) announced 2026-03-31; Blender addon 2026-05-13; SIGGRAPH 2026 paper on the "Antipodal Method" for generalized winding numbers (https://solidean.com/blog/2026/antipodal-method-siggraph-2026/). DOCUMENTED (https://solidean.com/blog/).

## What it is

A production mesh Boolean engine descended from EMBER: exact plane-based geometry with fixed-width integer homogeneous coordinates, generalized-winding-number classification, adaptive local arrangements, multithreaded. Claims: exact Booleans, intersections and topology updates; unlimited iterated Booleans without degradation; manifold watertight output from messy (self-intersecting, non-manifold) input; per-face ID and attribute transport; variadic Booleans through a command-buffer "Operation" API. DOCUMENTED (https://solidean.com, https://solidean.com/blog/2025/from-ember-to-solidean/). OBB self-reported capability letters: E R I S (all four). DOCUMENTED (https://github.com/Open-Boolean-Benchmark/boolean-benchmark-runners/blob/main/README.md).

### What EMBER lacked, per the vendor (the gap list)
From "From EMBER to Solidean" (2025-05-11; post text saved at `tmp/research/solidean-blog/2025_from-ember-to-solidean.txt`). "Many practical concerns were left as 'future work.'" The advances claimed beyond the paper, DOCUMENTED:
- a production codebase for Windows and Linux;
- performance tuning on real-world cases;
- "Empirical robustness testing far beyond theoretical guarantees";
- "Instant parallel scaling ... no burn-in phase";
- "True iteration-proofness: unlimited Boolean sequences without degradation";
- "Output-sensitive performance: subtracting a small part from a multi-million-triangle workpiece is no longer a bottleneck";
- "Flexible exports with topological guarantees: from fast triangle soups to halfedge-structured meshes with manifold guarantees and cleaned topology";
- provenance tracking and attribute transport;
- bindings;
- a comprehensive test and benchmark suite;
- an "Operation-based API, a command-buffer pattern that subsumes variadic booleans, CSG evaluation, exact materialization of intermediates".

Interpretation, INFERRED:
- EMBER already states that "as the output of our method can be used as its input again, iterated CSG operations can be performed without intermediate loss of precision" (EMBER §6, `tmp/research/pdf/trettner2022-ember.txt` ~L903). So the precision half of iteration-proofness was in the paper.
- What the product adds is the non-degradation half: bounded growth of fragmentation and tessellation over long chains (EMBER itself "generally produces more output faces and low-valence vertices"), output-sensitive cost, and clean manifold export.
- These are exactly the engineering gaps a wonky reimplementation of the EMBER idea would have to close itself. For wonky's hybrid the export gap matters less: its output is a recovered B-rep, not an exported mesh.

## How it works

### Arithmetic
- Default number format `Fixed256Pos26`: 26-bit vertex positions, 256-bit wide internal registers, "up to ~180 bits per coordinate" of subexpression exactness. Coordinates are treated "as if they were floating point with a shared exponent across the whole scene": the user supplies a bound on the maximum absolute coordinate, which fixes the global scale. Input/output conversion error about 1e-7 relative ("~7 decimal places ... comparable or better than single precision"). Everything between import and export is exact. DOCUMENTED (https://solidean.com/docs/concepts/exact-arithmetic/).
- Kernels come from an in-house "Surrat" compiler that picks "just enough bits for each subexpression", no dynamic allocation. DOCUMENTED (same page).
- Hand-rolled fixed-width integers (u128 from two u64 limbs with `_addcarry_u64`, `_subborrow_u64`, `_mulx_u64`; branch-free compare via the borrow flag; codegen "on par with builtin `__uint128_t`"). They use "256-bit integers in our hot paths and go up to 564 bits for certain edge cases"; division is avoided entirely by division-free predicate formulations; `_BitInt(N)` for N > 128 is slow in GCC (runtime-width libcalls). DOCUMENTED (https://solidean.com/blog/2026/building-your-own-u128/). No GPU or SIMD mention. DOCUMENTED (same).

### Why 26 bits (from the research papers)
- Nehring-Wirxel 2021 eq. 7-9: with b-bit integer ops, overflow-free exact predicates need `n+^4 * v+ <= (1/48) 2^(b-1)`; with normals from edge cross products (`n+ = 8 v+^2`) this gives `v+ <= 0.239 * 2^(b/9)`, i.e. about 2^(b/9 - 2). For b = 256, positions up to 8.73e7, "slightly above 26 bit". The key predicate (classify a three-plane intersection point against a fourth plane) is a 4x4 determinant `|p q r s|`, bounded via Hadamard by `16 n+^3 d+`, with `d+ <= 3 v+ n+`. DOCUMENTED (tmp/research/pdf/nehringwirxel2021-octree-bsp.pdf section 3.2).
- EMBER: input polygons with 26-bit integer coordinates; polygons represented by a supporting plane plus one plane per edge, integer coefficients (a,b,c,d); new vertices only as intersections of three input planes in 4D homogeneous integer coordinates (Cramer); `classify(x,s) = sign<x,s> * sign x4`. Bit widths chosen "such that ... no intermediate result later on exceeds 256 bit". Homogeneous points are not closed under subtraction (x4*x4' doubles the bits), so vertex arithmetic on constructed points is avoided. For a 1 m^3 scene 26 bits is about 15 nm. DOCUMENTED (tmp/research/pdf/trettner2022-ember.pdf sections 3, 3.2, 3.3).
- EMBER classification: generalized winding number vectors, tracked along segment traces through an adaptive subdivision; inputs must be PWN (piecewise-constant integer winding number) meshes. DOCUMENTED (EMBER 3.4).

### Representation and export
- "Solid" = winding number exactly 0/1, non-degenerate faces; "supersolid" = superposition of solids, piecewise-constant nonzero integer winding, degenerate faces and overlaps allowed. "All boolean operations produce solid meshes, even if the inputs are supersolid"; non-supersolid input needs `Operation::heal` first. DOCUMENTED (https://solidean.com/docs/concepts/solid-vs-supersolid/).
- No canonical internal mesh: "internally heterogeneous, fractured"; topology reconstructed on export. Export modes: unrolled triangle soup (keeps T-junctions, fastest), indexed triangles (resolves T-junctions, topological solid), or `exportMesh` with manifoldness, spurious-vertex removal, supporting planes and IDs. Export-then-import is called "usually an anti-pattern". DOCUMENTED (https://solidean.com/docs/concepts/export-philosophy/). Convex polygons retained internally, triangulated only on export. DOCUMENTED (https://solidean.com/blog/2026/iterated-dome-carve-benchmark/).
- Closure: "By duplicating vertices on output, Solidean can always bound a result by a collection of non-intersecting manifold meshes." DOCUMENTED (https://solidean.com/blog/2026/iterated-cube-grid-benchmark/).
- Failure reporting: `Result` (API misuse) vs `ExecuteResult` (data-quality diagnostics); execution may still produce a best-effort mesh on non-OK. DOCUMENTED (https://solidean.com/docs/faq/).

## Robustness and guarantees

- Exact inside the fixed-point world; the only rounding is at import/export. DOCUMENTED (exact-arithmetic page; EMBER section 6: "only exact if input and output are in integer homogeneous coordinates ... conversions ... might re-introduce tiny self-intersections").
- Hard precondition: all coordinates inside the declared extent (OBB runner uses `createExactArithmetic(max_abs of bounding box)`; manifest note "inputs must lie within this volume"). DOCUMENTED (https://github.com/Open-Boolean-Benchmark/boolean-benchmark-runners/blob/main/solidean/2026.1/src/main.cpp).
- Benchmarks (vendor-run, Ryzen 9 5900X, Windows 11; methodology and data open, https://github.com/solidean/bench-blog-data, MIT/CC BY 4.0):
  - Iterated cube grid (10x10x10 unit cubes, 1999 ops: union evens, union odds, subtract evens, subtract odds to empty): Solidean 980 ms, Trueform 4.1 s, Manifold 5.3 s, Carve 23 s, Mesh Arrangements 62 s, Geogram 1.10.0 112 s, CGAL Nef 280 s, Blender exact 294 s, Geogram 1.9.8 ~37 min all canonical; IARMB "residual solid", Blender fast "residual walls", CGAL corefine declined op 5 (non-manifold output), QuickCSG diverged ~op 996, MeshLib exit op 554, mcut no result, Cork crash op 5, both VTK filters empty intermediates. DOCUMENTED (https://solidean.com/blog/2026/iterated-cube-grid-benchmark/).
  - 9-op sphere/torus subtraction chain (~100K tris): Solidean 27 ms, Trueform 85 ms, MeshLib 109 ms, Manifold 332 ms, CGAL corefine 507 ms, Geogram 32.4 s, CGAL Nef 477.7 s. DOCUMENTED (https://solidean.com/blog/2026/first-benchmark-results-iterated-csg/).
  - Terrain carve (223 sphere-sweep subtractions, exactly coplanar seams): canonical only Solidean 205 ms, Manifold 525 ms, CGAL corefine 11 s, CGAL Nef 330 s; Trueform wrong (inverted), Geogram no result, IARMB exit ("needs rationals"). Reference = agreement of the three exact-construction methods to 4 decimals. DOCUMENTED (https://solidean.com/blog/2026/terrain-carve-benchmark/).
  - Dome carve (up to 200k capsule subtractions): Solidean canonical at 100k (~23 min), Manifold canonical at 10k (~20 min) and timeout at 17,257 of 100k, CGAL corefine 5000 ok, Trueform wrong at 250 ("32-bit float limitation"). DOCUMENTED (https://solidean.com/blog/2026/iterated-dome-carve-benchmark/).
- Caveat: all benchmark posts are vendor-authored; capability letters are self-reported. HEARSAY-level for claims about competitors until reproduced; the harness is open (see the OBB note).
- Counterpoint from another vendor's protocol. The trueform paper (arXiv 2607.15905) ran "Solidean Community ... preview build 2026-04-07-be517c" on an Apple M4 Max. Its protocol times arrays in to arrays out, rebuilds every structure per operation, and uses 1000 random Thingi10K pairs at 100k-1M triangles per operand. DOCUMENTED (paper §3.3, Tables "pairwise", "nary"):
  - Pairwise median: EMBER/Solidean 143.8 ms against trueform 15.7 ms (10.4x geometric mean), Manifold 118.0 ms, MeshLib 86.4 ms. Valid on 1000/1000.
  - N-ary medians at N = 4/16/64: 61/352/1429 ms against trueform 6/25/103 ms.
  - Solidean's iterated chains, where trueform 0.7.0 is 4.2x slower on the cube grid and wrong on the terrain and dome carves, show the opposite ranking.
  - Each vendor wins its own protocol. Import/export cost and persistence across operations decide the ranking. INFERRED.
- Marketing claim on the docs page: "up to ~38 orders of magnitude more precision than double precision". This is about 180 bits against 53 bits, and applies to intermediate subexpressions only. The declared I/O precision is ~1e-7. DOCUMENTED (https://solidean.com/docs/concepts/exact-arithmetic/, fetched 2026-09-22, saved at `tmp/research/solidean-blog/exact-arithmetic-2026-09-22.txt`).
- Blog activity: as of 2026-09-22 the newest post is still the dome-carve benchmark of 2026-07-02. DOCUMENTED (https://solidean.com/blog/, saved `tmp/research/solidean-blog/blog-index-2026-09-22.html`). Re-checked 2026-09-24: the blog index and the exact-arithmetic page are unchanged. `Fixed256Pos26` is still the only number format named; the page also mentions `BigInteger` and `BigRational` as contrasts. It says nothing about GPU, SIMD, determinism, or behaviour for coordinates outside the declared bound. DOCUMENTED (https://solidean.com/docs/concepts/exact-arithmetic/).

## Parallelism and performance

- Multicore "fully used immediately, no burn-in phase"; output-sensitive (small cuts on large workpieces are cheap). DOCUMENTED (https://solidean.com/blog/2025/from-ember-to-solidean/). 17 M tris/s claimed on a high-complexity intersection (Ryzen 5900X). DOCUMENTED (https://solidean.com).
- EMBER's design: adaptive space subdivision, purely local arrangements per leaf, work-stealing parallelism, memory reuse per recursion branch, AABB test before any exact intersection, reduced bit widths wherever axis-aligned coefficients are -1/0/1. DOCUMENTED (EMBER section 4-5).
- Memory-bound focus: blog post on linear memory access (https://solidean.com/blog/2026/how-much-linear-memory-access-is-enough/). DOCUMENTED (title only read).

## Known failures, limitations, war stories

- Input quantization to ~26 bits (about 1e-7 relative) is lossy and can re-introduce tiny self-intersections at export; EMBER calls this "basically a problem of every algorithm". DOCUMENTED (EMBER section 6).
- Homogeneous coordinates are not closed under vector arithmetic; you cannot freely translate or offset constructed points. DOCUMENTED (EMBER 3.2).
- A global scene extent must be known up front; large scenes with small features lose relative resolution. INFERRED from the shared-exponent design.
- Float exports differ bitwise from inputs; round-tripping through float is discouraged. DOCUMENTED (FAQ, export philosophy).
- Output tessellation: EMBER "generally produces more output faces and low-valence vertices". DOCUMENTED (EMBER section 5).
- Dome carve: 200k steps missed the 1-hour budget (~97 min). DOCUMENTED.
- Discrepancy: the OBB `runner.yaml` notes say every op re-imports float32 SSA data, but the current adapter `src/main.cpp` keeps `solidean::Mesh` handles in its SSA vector and passes them to `op.input(...)` directly, so chains stay exact. INFERRED: notes are stale (https://github.com/Open-Boolean-Benchmark/boolean-benchmark-runners/blob/main/solidean/2026.1/src/main.cpp).

## Relevance for wonky

- Solidean is the performance and robustness ceiling for the EMBER-style plane-based candidate in the bake-off. It shows that exact plane-based Booleans can be faster than float-based ones, and that iteration stability comes from never leaving the exact representation between ops. INFERRED.
- Bit-budget reality check for Bend: the plane-based classify predicate is degree 9 in input coordinates; 256-bit exactness is needed for 26-bit input. In Bend with U32 limbs that is 8-limb (U32x8) integers with 16-limb products; every hot predicate becomes tens to hundreds of U32 multiply-adds. Feasible as uniform, branch-free GPU work, but the product relies on 64x64->128 hardware multiply that Bend lacks. INFERRED (from Nehring-Wirxel eq. 9 and the u128 post).
- The "fixed-width, statically known bit budget per subexpression" approach (Surrat) matches wonky's multi-limb U32 predicates exactly: generate each predicate with a per-subexpression limb count instead of a generic bignum. INFERRED.
- Global shared exponent plus explicit extent is a clean fit for wonky's "explicit tolerances" principle: the extent and 26-bit grid become the declared model tolerance. INFERRED.
- The solid/supersolid split and "Booleans always output solids" is a good API contract for wonky's tagged mesh. INFERRED.
- Nothing can be linked or ported (closed source, non-commercial community licence). DOCUMENTED.

## Pointers worth porting or studying

1. Nehring-Wirxel 2021 section 3.2 bit-budget derivation (eqs. 7-9) to size wonky's U32 limb counts for plane-based predicates.
2. EMBER sections 3 and 3.4 (plane-based primitives, winding-number-vector tracking along segment traces) as the algorithm spec for the EMBER-style bake-off candidate.
3. The u128 blog post: carry/borrow chains and branch-free compare; translate to U32 limbs with 16x16 or 32x32->64 emulation in Bend.
4. Solid vs supersolid definitions and `heal` as the model for wonky's input classes.
5. Export philosophy: stay in exact representation between ops; export is a lossy boundary.
6. Benchmark scenarios (cube grid, terrain carve, dome carve) as wonky regression cases, using https://github.com/solidean/bench-blog-data (CC BY 4.0 meshes).
7. The Antipodal Method winding-number paper (SIGGRAPH 2026; local copy tmp/research/pdf/martens2026-antipodal-gwn.pdf) for fast classification.

## Verdict: learn-from

Closed-source commercial product with a non-commercial community licence: it cannot be linked or ported, so adopt/adapt are ruled out. It is still the best evidence that the EMBER-style plane-based exact approach achieves all four OBB properties (E R I S) with top speed, and its published bit budgets (26-bit input, 256-bit predicates, degree 9) are the numbers wonky needs to cost the plane-based candidate against U32-limb arithmetic. Use it as a reference bar and as a benchmark comparison through the open OBB harness (non-commercial evaluation use only).
