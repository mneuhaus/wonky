# Levy 2024: Exact predicates, exact constructions and combinatorics for mesh CSG

- Kind: paper.
  - Canonical: https://arxiv.org/abs/2405.12949 (v1 2024-05-21, v2 2025-06-04, 28 pages, 21 figures).
  - Journal version: ACM Transactions on Graphics 44(5), 2025, https://doi.org/10.1145/3744642 (Crossref: published 2025-07-10, 5 citations as of 2026-09-22).
  - Local copies: tmp/research/pdf/levy2024-mesh-csg.pdf, text levy2024.txt (from arXiv v2).
- Author/org: Bruno Lévy, Inria Saclay / Université Paris-Saclay / CNRS (Laboratoire de Mathématiques d'Orsay).
- License:
  - Paper © author/ACM.
  - Code: "The main algorithm, expansion-based kernel and OpenSCAD CSG parser are available in the GEOGRAM library" (paper, appendix A), which is BSD-3-Clause (see `geogram-brunolevy-geogram.md`).
  - **The multi-precision kernel of section 2.4.2 is not open.** The paper anonymises its user as "Yoyodine Corp". Geogram's `numerics/exact_geometry.h` says: "If Tessael's geogramplus is available, use exact_nt coordinates, else use expansion_nt coordinates. exact_nt coordinates makes the algorithm 10x to 20x faster and have no risk of underflow / overflow" (DOCUMENTED, clone at 6db8db2).
  - Test corpus ThingiCSG: https://github.com/BrunoLevy/thingiCSG, BSD-3-Clause, 12 stars, created 2023-12-31, last push 2025-08-22 (DOCUMENTED, `gh api`).
  - Porting implication: algorithms and the open expansion kernel can be ported with attribution; the GMP-style kernel must be designed from the paper's description.
- Status: new (2024-2025), published in TOG. arXiv v2 (2025-06-04) is still the latest version (re-checked 2026-09-24 via the arXiv API). The Geogram implementation is actively maintained (repo pushed 2026-09-23). ThingiCSG's last commit (2025-08-22) is "Added an example with elements translated far far away", a scale/exponent stress case. In the 2026 Solidean benchmarks, Geogram 1.10.0 was canonical on the cube grid (112 s) but gave "no result" on terrain carve and dome carve (DOCUMENTED, see `solidean-iterated-csg-benchmark-series-2026.md`).

## What it is

An exact-geometry mesh CSG pipeline. It covers co-refinement of a triangle soup, construction of the Weiler model (3D arrangement) by radial sorting, and classification for arbitrary multi-operand Boolean expressions, plus mesh repair uses.

Its design stance is "simply implement the math": push all degeneracy handling into exact predicates and exact **constructions**, and keep the combinatorial interfaces between stages minimal (DOCUMENTED, abstract and section 2.3).

The core empirical question is which exact number type can carry *chained constructions*. Levy compares Shewchuk-style arithmetic expansions against a multi-precision float (mpz mantissa + 32-bit exponent). The paper also introduces the ThingiCSG corpus.

## How it works

### Co-refinement (section 2.1, DOCUMENTED)
1. **Preprocessing.** Merge duplicate vertices and discard duplicate facets via lexicographic sort.
2. **Candidate pairs.**
   - Balanced AABB tree with an implicit layout: facets permuted into balanced Morton order via `nth_element`, node n has children 2n and 2n+1, and node n owns a contiguous facet range [b,e). Only the box array is stored.
   - The recursive pair traversal `intersect(n1,b1,e1,n2,b2,e2)` skips symmetric pairs (`e2 ≤ b1`) and always splits the larger node.
3. **Triangle-triangle intersection with combinatorics:**
   - A triangle is a simplicial set of 7 *open* simplices {P1,P2,P3,E1,E2,E3,T}. Every intersection point is output as the unique pair (σ, σ') of simplices containing it.
   - `edge_triangle(E,T)` uses orient3d signs s1 and s2 of the edge endpoints against T's plane:
     - same sign: no intersection;
     - both zero: go to `edge_triangle_2D`, with a 1D interval path for collinear edges;
     - otherwise compute o1..o3 = orient3d(Q1,Q2,Pi,Pi+1) for the edges of T; mixed signs mean the point is outside T;
     - zeros select a vertex or edge region.
   - Deduplicate by sort+unique.
   - A polygon intersection's boundary edges are found by testing all ≤ 15 point pairs with a purely combinatorial "same edge" test.
   - A **predicate cache** keyed by sorted point indices, with a parity sign flip, avoids recomputation.
4. **Projection axis must be chosen exactly.** "Comparing the magnitudes of the components of the normal vector needs to be done in exact arithmetics". Thingi10K mesh #356074 (a skinny triangle with normal near (1,1,1)) degenerated otherwise (DOCUMENTED, section 2.1.3).
5. **Constrained Delaunay triangulation per intersected triangle** (Sloan 1992 flip algorithm):
   - multithreaded, with no dynamic allocation after warm-up (`std::vector`s plus doubly-linked lists for the stack and queue);
   - a constraint walk that handles vertices exactly on the constraint, overlapping collinear constraints (chained per segment) and constraint-constraint crossings (insert the crossing, re-Delaunay, then continue);
   - **Optimisation:** because every edge is addressed through a rotated triangle, the "does the flipped edge still cross (i,j)" test needs 1 orient2d plus combinatorics instead of up to 4 (fig. 7, configs A-D);
   - `incircle` is symbolically perturbed (Simulation of Simplicity) so the triangulation is **unique**. Overlapping coplanar facets therefore produce identical triangles, and duplicates are removed by equality instead of by an auxiliary overlap structure.
6. **Exact constructions in homogeneous coordinates:**
   - edge∩triangle: t = ((p1−q1)·N)/((q2−q1)·N) with N = (p2−p1)×(p3−p1), and I = mix(a/b, q1, q2) = (a·q2 + (b−a)·q1)/b;
   - coplanar edge∩edge: 2×2 Cramer in 2D, lifted by mixing the 3D endpoints;
   - constraint∩constraint = **intersection of three triangle planes** via 3×3 Cramer with B = [N1·p1, N2·q1, N3·r1]. This is shallower than nested t-mixing, which matters a lot for expansions.
7. **Global vertex table keyed by exact coordinates.** The order compares x/w lexicographically via `ratio_compare = sign(w1)·sign(w2)·sign(w2·x1 − w1·x2)`, with fast exits when both are zero, the signs differ, or w1 = w2.
   - It is needed because "two different intersections may land exactly on the same point" and "an intersection may land exactly on a vertex … very likely to appear in CAD objects generated by CSG" (fig. 8, three rods meeting at a corner).
   - Input vertices are merged against the table at the end.

### Weiler model and classification (section 2.2, DOCUMENTED)
- **3-map.**
  - Darts: 3 per triangle, d = 3t+k, with σ1(d) = d − d mod 3 + (d+1) mod 3 implicit.
  - Stored involutions: α2 (neighbour in the same sheet) and α3 (twin sheet). All triangles are duplicated into two opposite sheets.
  - Bundles = darts sharing both endpoints, found by sorting. A bundle with 4 darts is a manifold edge; one with more than 4 darts needs a radial sort.
- **Radial sort.** orient(h1,h2) = orient3d(p1,p2,p3,p4) together with Norient = sign(n1·n2) gives four quadrants around the edge; within a quadrant, orient decides the order. Predicates are interval-filtered. The order is **propagated along radial polylines** and recomputed only at vertices with more than 2 bundles.
- **Classification:**
  - B(t) is a bitvector of operands whose boundary contains t (ORed when duplicate triangles merge). I(d) is the set of operands containing dart d.
  - Flood fill: crossing σ1 or α2 keeps I; crossing α3 XORs with B(t).
  - Dart d is on ∂O_E iff ¬E(I(d)) ∧ E(I(α3(d))), for an arbitrary Boolean expression E.
  - Per connected component: take the shell enclosing the largest volume as the outside. Then cast **one ray per component**, with random directions until no degeneracy. Levy recommends this over SoS because it is "far simpler". Ray leakage cannot occur because intersections are exact.
- **Coplanar simplification** (section 2.2.4):
  1. find coplanar regions by an exact normal-collinearity test;
  2. extract the borders;
  3. drop border vertices that are collinear and unused elsewhere;
  4. re-CDT with the same code.
  - "Removing unnecessary vertices in flat zones is crucial when evaluating deep CSG trees … Without this post-processing, the number of triangles would quickly explode when chaining boolean operations" (section 3.2).
- **Other use:** removing internal "garbage" after naive offsetting by keeping outer shells (fig. 10).

### Arithmetic kernels (section 2.4, DOCUMENTED)
- **Expansion kernel** (open, in Geogram):
  - Shewchuk expansions used for *stored constructions*, with interval filters.
  - Compression (a two-sweep, Shewchuk section 2.8) is called before every expensive operation and before storing a point. Levy notes a typo in Shewchuk's published algorithm (line 14 should read h_top ← q).
  - `in_circle_l` trick: pass l_i = round(x_i² + y_i²). This yields a *regular* triangulation that is still unique under consistent l and SoS, at lower degree.
  - SoS uses the lexicographic order of points.
- **Multi-precision float kernel** (closed geogramplus):
  - A number is m · 2^e with m a GMP `mpz_t` and e a 32-bit integer; m is odd (no trailing zeros) for uniqueness, and 0 is 0·2^0.
  - Optimised equality and comparison.
  - Homogeneous points are normalised (divide by gcd, w > 0, the exponent of w handled by passing shifts to comparisons), so the plain lexicographic order on (x,y,z,w) is a valid total order.

## Robustness and guarantees

- **Exact predicates and exact constructions throughout.** Degeneracies are handled by exact tests plus SoS (incircle) and random-direction retries (ray casting).
  - The output coordinates stay exact (homogeneous rationals).
  - Snap rounding to floats is **explicitly out of scope** ("I do not address the (difficult) problem of converting these exact points into standard floating-point coordinates", section 1.2; future work cites Devillers-Lazard-Lenhart 2018 and Valque 2019) (DOCUMENTED).
- **Expansion-kernel failures are hard limits, not bugs** (DOCUMENTED, section 2.4.1 and table 1):
  - Expansions reached **65,000 components**, i.e. about 16 nested doublings. Compression makes this rare ("no more than a few times in multi-million element meshes").
  - The 11-bit double exponent **overflows or underflows**. ThingiCSG OpenSCAD cases example0021-example0024 fail, and Thingi10K model 101633 (very skinny triangles intersecting near a pole) fails with underflow.
  - Expansion arithmetic is "40 to 100 times slower than with standard double-precision numbers" even with FMA (section 1.3).
  - Conclusion (section 4): "arithmetic expansions can be pushed a little bit, but soon one reaches their two limitations: (1) with cascaded constructions / predicates, exponents can overflow; (2) operations start to cost a lot with expansions longer than a few tenths of components. **As soon as constructions are involved, multi-precision seems to be a better solution**".
- **Lessons stated** (section 4): non-regression tests and "assertion checks everywhere" (3-map consistency, Delaunay property). "A predicate can have different equivalent expressions. One can use one of them for the filter, another one for the exact evaluation and a third one for the symbolic perturbation."

## Parallelism and performance

(DOCUMENTED, section 3.)
- **Thingi10K.** 4523 of 10,000 models have self-intersections, and all were processed in 1 h 45 min. #996816, a "3D grid of triangles" with thousands of intersections per triangle, takes 1271 s. The table 1 columns compare expansions, multi-precision with CDT, multi-precision with plain constrained triangulation, and Cherchi 2020.
- **Table 2** (seconds; ours / Zhou 2016 / Cherchi 2022):
  - dragon-bunny: 2.7 / 3.9 / 1.3;
  - buddhaUlion: 11.5 / 16.1 / 5.8 (Cherchi "sometimes crashes");
  - cylUcyl: 3.7 / 25.8 / 28.2;
  - 20rods-20rods: 0.9 / 3.3 / 2.1 (Cherchi gives an incorrect result with hanging facets).
  - So Levy is up to 6× faster on coplanar-heavy input and slower on generic dense input.
- **Comparison with EMBER.** "The integer-based method EMBER is still spectacularly more efficient": 4.5 ms on 20rods-20rods and 5.9 ms on a rot_cube_20-like case. Integer-only methods give "a spectacular acceleration factor (50x to 100x)" (sections 3.2 and 4).
- **ThingiCSG vs OpenSCAD's kernels** (CGAL Nef, CGAL corefinement, Manifold):
  - "**the 'manifold' kernel is always the fastest**"; Levy is often faster than corefinement; Nef is far slower.
  - **Manifold fails on nasty_gears_1** (difference of two sets of 50 rotated cubes, heavily coplanar) "as well as other ones with similar co-planar configurations or high mesh density".
  - On fibo_sphere_500 (62.5 M input vertices), CGAL corefinement ran out of memory, and Manifold output a result in 385 s "but this result has many missing triangles". Levy took 2225 s (table 6; the Manifold version is not stated).
- **Profile** (table 3): radial sort plus Weiler combinatorics take up to about 10% of the total; the CDT is small; triangle-triangle and AABB dominate on generic input.
- **Parallelism:** per-triangle CDTs are independent and run multithreaded with an allocation-free design. The Weiler and classification steps are mostly combinatorial and sequential in the paper (DOCUMENTED).

## Known failures, limitations, war stories

- **Expansion overflow and underflow** on ThingiCSG example0021-0024 and Thingi10K #101633; expansion length blow-up (DOCUMENTED, above).
- **Pathological intersection density:** #996816 takes 20 min (DOCUMENTED).
- **CDT corner cases** are "much subtler than one would think": vertices on constraints, collinear overlapping constraints, crossing constraints (DOCUMENTED, section 4).
- **No snap rounding**, so the output is not a float mesh with guarantees (DOCUMENTED).
- **Iterated benchmarks** (vendor-run, DOCUMENTED in the Solidean posts): Geogram 1.9.8 took 32.4 s on the 9-op chain and ~37 min on the 1999-op cube grid. 1.10.0 took 112 s on the cube grid. Terrain carve and dome carve gave "no result". The cause is not stated; overflow in the open expansion kernel is a plausible but unverified explanation (INFERRED).

## Relevance for wonky

**The negative result applies to wonky's scalars even more strongly** (INFERRED):
- Expansions built from F32 components have an 8-bit exponent: finite range 2^−149..2^127, about 276 binades vs about 2098 for double. A degree-d construction chain over 24-bit mantissas spans about 24·d bits, so exponent exhaustion arrives around 7-8× sooner than in Levy's double experiments.
- F32x2 does not help: its exponent *is* F32's.
- So **no Shewchuk-style expansion constructions in Bend.** This confirms wonky's existing choice. `kernel/robust-predicates.bend` already decodes both F32x2 words into signed dyadic integers (base-4096 digits) instead of expansions (DOCUMENTED, docs/robust-predicates.md).
- **Mapping Levy's mpz+e32 to Bend:** a sign, a `List<U32>` magnitude of 16-bit limbs (as in `kernel/proto/exact-plane/big.bend`), and a U32 exponent word. Normalise to an odd mantissa for canonical equality.
  - 16-bit limbs are forced: Bend's `u32_mul` returns only the low 32 bits (`(u32)a * (u32)b` in C, `Math.imul` in JS; bend2/comp.ts:187-190, verified 2026-09-24), and there is no U64 (README.md:227).
  - This gives general rationals and homogeneous points with unbounded depth, but it is variable-length: allocation per limb and non-uniform GPU work.
  - Measured cost of exactly this variable-length layout (without the exponent) in wonky's exact-plane: 1.3 µs (grid point) and 6.0 µs (constructed vertex) per exact plane-side evaluation, vs 0.10 and 0.20 µs for the F32x2 filter, native, 1 thread (DOCUMENTED, docs/proto-exact-plane.md). That is 13-30×, the same order as Levy's "40 to 100 times slower" for expansions vs plain double.
  - Wherever a bound is provable (plane-based, NW2021 eq. 7-9), EMBER's fixed width is preferable. Keep mpz-style numbers for the rare deep constructions, such as three-triangle intersections of constructed points, or as a verified fallback.
- **Exact zeros dominate on CAD input** (DOCUMENTED, docs/proto-exact-plane.md). On wonky's corpus, the float filter certifies 60-100 % of signs, and nearly all exact evaluations are zeros from coplanar or touching faces; non-zero exact signs are at most 33 per case. This is Levy's "one expression for the filter, another for exact evaluation, a third for SoS" lesson in practice. The cheapest exact sign is one known *symbolically* (the vertex was built from that plane), so carry such incidence facts instead of re-deriving them.

**Transferable algorithms** (INFERRED):
- **Exact projection-axis choice.** wonky's exact-plane picks the dominant axis "from the approximations" but requires the chosen component to be nonzero (DOCUMENTED, kernel/proto/exact-plane/geom.bend comment). That nonzero condition is exactly what prevents Levy's #356074 failure; keep it as an asserted invariant.
- **Unique CDT via SoS.** Identical input gives identical triangles, and overlapping coplanar facets give duplicates removable by exact equality. This gives wonky deterministic, canonical triangulations, which supports stable provenance IDs and meaningful mesh diffs.
- **Bitvector plus XOR flood classification with one ray per connected component.** Operand sets fit in U32 masks for up to 32 operands per word, which suits variadic FeatureScript Booleans. It needs far fewer exact ray casts than wonky exact-plane's per-piece axis ray (INFERRED from reading kernel/proto/exact-plane/classify.bend).
- **Coplanar simplification after every Boolean.** In a FeatureScript chain, each feature's output is the next input, so this is mandatory to avoid triangle blow-up. For prototype 4, merging by source face tag is the natural analytic version.
- **Global exact vertex table.** Coincident constructed points are merged by exact comparison. Under immutability this is a sort-and-deduplicate pass (fork-join merge sort on the exact key), not a mutable map.
- **Minimal stage interfaces.** An indexed triangle mesh plus streams between stages, with complexity pushed into a small predicate/construction kernel, matches wonky's introspection goals: every stage output is inspectable and unit-testable. It also suits LLM-written code, because the hard part is confined to a few well-specified functions.

**Parallel fit** (INFERRED):
- Triangle-pair tests are near-uniform and can be GPU-batched with fixed-width predicates.
- The per-triangle CDTs are independent but highly non-uniform (1 to thousands of constraints), so they need CPU fork-join.
- The Weiler sort is a sort-by-key plus segmented passes. The flood fill needs label propagation instead of a stack.

**Testing** (INFERRED): ThingiCSG (83 OpenSCAD files in Basic, Presentation and Large collections, with a flat `.csg` format) is a second external corpus next to the Solidean cases.
- Its primitives (cube, sphere, cylinder, polyhedron; multmatrix) map to wonky's bake-off CSG leaves, and the analytic versions can be checked against the OCCT oracle.
- nasty_gears_* and seven_sins_* are the coplanar-heavy cases where Manifold failed, so they are a direct test for prototype 1.
- The bake-off confirmed the risk class but used none of these files (DOCUMENTED, docs/bakeoff.md). corefine, the Manifold port, returned invalid `ok` meshes on 4 of 13 rotated coplanar cases, and wonky added carrier unification (2^-44) and exact output gates to fix it (commit aa84b76, 2026-09-24; rotated coplanar now 14/14 exact on the hybrid path). nasty_gears_1 (two sets of 50 rotated cubes) is the natural scale-up of those 13 cases and the next test to run (INFERRED).

## Pointers worth porting or studying

- Section 2.1.1: implicit balanced AABB plus pair traversal pseudo-code. It is a clean functional recursion and ports directly to Bend.
- Section 2.1.2: the simplicial-set intersection encoding (`triangle_triangle`, `edge_triangle`) and the predicate cache. Code: `src/lib/geogram/mesh/triangle_intersection.cpp` (976 lines).
- Section 2.1.3 plus fig. 7: the CDT constraint walk with a single orient2d per flip. Code: `src/lib/geogram/delaunay/CDT_2d.cpp` (2019 lines) and `mesh/mesh_surface_intersection_internal.{h,cpp}` (`MeshInTriangle`, `CoplanarFacets`).
- Constructions: three-plane Cramer for constraint crossings, and homogeneous `mix`. Code: `numerics/exact_geometry.cpp` (765 lines).
- Section 2.2.1-2.2.3: 3-map layout (σ1 implicit), radial sort quadrants and polyline propagation, bitvector classification. Code: `mesh/mesh_surface_intersection.cpp` (`RadialSort`).
- Section 2.4.2: canonical mpz+exponent layout and normalised homogeneous points giving a total order. This is the design reference for a variable-width fallback number type in Bend.
- Section 4: the lessons list, especially "one expression for the filter, another for exact evaluation, a third for SoS".
- Tables 4-6 plus fig. 18: ThingiCSG cases where Manifold fails (nasty_gears_1, fibo_sphere_500).

## Verdict: learn-from

This is the key *negative* result for wonky's numerics: expansion-based exact constructions die on exponent range, and F32 makes that worse. The alternative is a canonical multi-limb integer with an explicit exponent, or better, EMBER-style fixed widths where bounds are provable.

Adopt the ThingiCSG corpus. Study the unique-CDT, exact-vertex-table, bitvector classification and coplanar-simplification patterns as components for prototypes 2 and 4. Do not port the expansion kernel. The full Weiler-model pipeline is slower than integer plane-based methods by the author's own account (50-100×), so it is not the primary Boolean for wonky.
