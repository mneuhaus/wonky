# Cherchi, Pellacini, Attene, Livesu 2022: Interactive and Robust Mesh Booleans

- Kind: paper plus reference C++ implementation.
- Canonical URL: https://arxiv.org/abs/2205.14151 (ACM TOG 41(6), SIGGRAPH Asia 2022, doi 10.1145/3550454.3555460).
- Other URLs:
  - Code: https://github.com/gcherchi/InteractiveAndRobustMeshBooleans ("IARMB" in the Open Boolean Benchmark).
  - Arrangement predecessor: Cherchi, Livesu, Scateni, Attene, TOG 2020, https://github.com/gcherchi/FastAndRobustMeshArrangements.
  - Predicate library: Attene, "Indirect Predicates for Geometric Constructions", CAD 126 (2020), https://github.com/MarcoAttene/Indirect_Predicates.
  - Local copies: PDF `tmp/research/pdf/cherchi2022-interactive-booleans.pdf`, text `tmp/research/pdf/cherchi2022.txt`, clone `tmp/research/interactive-and-robust-mesh-booleans-cherchi-et-al` (HEAD 7bd6c26), predicates clone `tmp/research/indirect-predicates`.
- **Sibling note:** a longer, code-line-level note on the same source exists at `docs/research/sources/interactive-and-robust-mesh-booleans-cherchi-et-al.md`, written in another batch. This note is self-contained for porting decisions. It adds the iterated-benchmark evidence, the later Indirect_Predicates cascade work, and the arithmetic mapping to F32x2 and U32 limbs. Use the sibling for exact file and line pointers.
- Authors/organization: Gianmarco Cherchi (Univ. Cagliari), Fabio Pellacini (Sapienza Rome), Marco Attene and Marco Livesu (CNR IMATI Genova). 2022.
- License:
  - Boolean code: MIT.
  - Vendored `arrangements/external/Indirect_Predicates`: LGPL. The LICENSE file says 2.1; the file headers say "v3 or later". Upstream `gh api` reports LGPL-2.1.
  - Porting implication: the MIT Boolean and ray-casting logic may be transliterated with attribution. The generated predicate code (`indirect_predicates.hpp`) is LGPL and must not be translated into a closed wonky. Re-derive the predicates from the paper's formulas instead.
  - DOCUMENTED (LICENSE files; `gh api repos/MarcoAttene/Indirect_Predicates`).
- Status:
  - Boolean repo: 244 stars, 48 forks, 5 open issues, 34 issues and PRs ever filed, no releases. Last commit 7bd6c26 on 2024-06-10; `pushed_at` 2025-07-02 from open PR #34 (VS2022 build fix). The README says the authors "do not currently have the resources to keep up". Maintenance-only research code.
  - Indirect_Predicates: still active. 51 stars. Last commit 7496059 on 2026-09-01, with new "cascaded implicit points" work in Aug 2026 (see failures).
  - DOCUMENTED (`gh api`, re-checked 2026-09-24).

## What it is

An exact Boolean for closed, manifold, self-intersection-free, outward-oriented triangle meshes. It is fast enough for interactive use up to about 200K triangles. It never constructs rational coordinates:
- New vertices are implicit points, i.e. tuples of input primitives.
- All decisions use filtered exact predicates on those tuples.
- Inside/outside is decided by one exact ray cast per surface patch, instead of flooding labels over the arrangement.

Output is a triangle mesh with per-triangle label bitsets, and coordinates are rounded to double only at the end. DOCUMENTED (paper §1-5).

The whyRelevant line "output is snap-rounded to floats after each operation" is, precisely, plain rounding to double (`getApproxXYZCoordinates`). It is not a snap-rounding algorithm. The paper: "after each frame we snap exact coordinates to floating points, possibly introducing small mesh defects". DOCUMENTED (paper §7.1; `code/booleans.cpp` L1345-1350).

## How it works

### Pipeline (`code/booleans.cpp`: `booleanPipeline` -> `customArrangementPipeline` -> `customBooleanPipeline`)
1. **Flatten.** All inputs go into one triangle soup with a `std::bitset<NBIT>` label per triangle. `NBIT = 32` by default (`arrangements/code/common.h:41`).
2. **Exact power-of-two scaling.** `computeMultiplier` scales coordinates so that max |coord| ≈ R = 11259470696 ≈ 1.1e10. The multiplier is the closest power of 2, so the scaling is exact (`arrangements/code/processing.cpp:45-57`).
3. **Clean.**
   - Merge bit-identical vertices with a parallel sort.
   - Drop exactly degenerate triangles.
   - Fold duplicate triangles, OR-ing their labels and recording relative winding.
4. **Detect.** An octree; per leaf, an AABB test then an exact tri-tri test. Parallel over leaves.
5. **Classify each intersecting pair** from the six orient3d signs (three vertices of A against B's plane, and vice versa). The cases: coplanar, a single coplanar edge, a vertex in the plane, or an edge crossing. This emits:
   - LPI points: edge pq intersected with the plane of triangle rst.
   - Symbolic segments between a pair's intersection points.
6. **Triangulate per triangle, in parallel.**
   - Insert points via a point-location tree.
   - Insert constraint segments by removing the crossed triangles and re-triangulating the two pockets with a linear earcut.
   - Where two constraints cross, create a TPI point (three-plane intersection).
   - Coplanar overlaps get a dedicated pocket solver.
   - Result: an exact simplicial complex whose patches are bounded by intersection curves.
7. **Patches.** Flood over manifold edges with equal surface label.
8. **Inside/outside.** One ray per patch; see below.
9. **Select** per triangle with bitset formulas:
   - union: `inside.count()==0`;
   - intersection: `(surface ^ inside).count()==num`;
   - subtraction: "mesh 0 and inside nothing" or "not mesh 0 and inside mesh 0 only", with flips;
   - XOR.
   - N-ary subtraction means M0 \ (M1 ∪ ... ∪ Mn).
10. **Emit.** Approximate doubles, divided back by the multiplier.

DOCUMENTED (code; paper §3-5).

### Implicit points (Attene 2020), homogeneous form (lambda_x, lambda_y, lambda_z, lambda_d), all DOCUMENTED
- **LPI** (line pq intersected with plane rst):
  - `lambda_d = det[p-q, s-r, t-r]`, degree 3 in input coordinates.
  - `n = det[p-r, s-r, t-r]`, degree 3.
  - `lambda = lambda_d * p - (p-q) * n`, degree 4.
  - The point is `lambda / lambda_d`, and lambda_d is kept positive by negation at construction.
  - Source: `indirect_predicates.hpp:7178`, `lambda3d_LPI_*`.
- **TPI** (intersection of three triangle planes): Cramer's rule on plane normals (degree 2) and offsets (degree 3). Denominator degree 6, numerators degree 7. INFERRED from the construction.
- **Indirect predicates.** Explicit predicates are evaluated with implicit arguments substituted: `orient3d_indirect_{IEEE, IIEE, IIIE, IIII}`, `orient2d_indirect_*` including axis projections, `lessThanOn{X,Y,Z}`, `incircle`, `inSphere`.
- **Evaluation cascade.**
  1. An interval-arithmetic filter using a per-point interval lambda cached at construction. It requires directed rounding: `setFPUModeToRoundUP`, compiled with `-frounding-math` / `/fp:strict`.
  2. Shewchuk expansions of doubles.
  3. A bigfloat fallback.
  - DOCUMENTED (Indirect_Predicates README; `indirect_predicates.hpp:9983`).
- **Cached plane predicate** (paper §4): `orient3d(a,b,c,p) = -p_x*M_x + p_y*M_y - p_z*M_z + M_1`, with the four 3x3 cofactor minors cached per input triangle. This is the plane-based trick of EMBER in another guise. DOCUMENTED (paper §4); the sibling note could not find it wired in this code snapshot (INFERRED there).
- **Jolly points.** Five fixed off-axis points. Each triangle picks one that is not coplanar with it, so in-plane orient2d on implicit points becomes `orient3d(a, b, jolly, p)`, avoiding projection. DOCUMENTED (`TriangleSoup::initJollyPoints`).

### Ray-per-patch classification (paper §5, Alg. 1)
1. **Choose the ray.** If the patch has an explicit input vertex not on an intersection curve, cast from it along +X. Otherwise:
   - approximate a triangle's barycenter in doubles;
   - push it back 0.1 scaled units along the dominant normal axis;
   - verify exactly that the ray crosses that triangle (the endpoints' orient3d signs differ, plus a 3-tet containment test);
   - on failure try the next triangle, up to 5 in practice.
   - The paper's final fallback, an exact rational barycenter, is not implemented: the code prints "requires exact rationals" and calls `exit(EXIT_FAILURE)` (`code/booleans.cpp:543-545`).
2. **Hit tests.** Test only against input triangles with explicit coordinates, using 2D orient2d in the plane orthogonal to the axis-aligned ray. Degenerate hits on an edge or vertex nudge p_infinity by one ulp (`nextafter`) in up to 8 directions.
3. **Order and classify.** Sort hits with exact `lessThanOnX` on LPI points (ray intersected with triangle plane). For each other mesh, the first hit decides: inside iff `orient3d(t0,t1,t2,p_inf) < 0`. The result is written as a per-mesh inside bit on the whole patch.

Measured: 2% of about 80K rays needed the approximate origin, 97% of those succeeded on the first triangle, and the rational fallback and ulp perturbation never triggered on real data. DOCUMENTED (paper §5, §6).

## Robustness and guarantees

- **Proven, given valid input:** the arrangement is an exact simplicial complex. For inputs that do not touch tangentially, the result is manifold and watertight. Validated on 3814 Thingi10K Booleans, where component counts and Euler characteristic matched libigl exactly. DOCUMENTED (paper §2.3, §6.2).
- **Not checked by the pipeline:** the input contract (manifold, watertight, no self-intersections, outward). Invalid input crashes or asserts instead of returning an error (issues #19, #30, #32). DOCUMENTED.
- **Heuristic or incomplete:**
  - the ray-origin push-back (safe only because an exact check follows);
  - the ulp nudge in place of SoS;
  - the missing rational fallback (`exit(1)`);
  - coincident patches, which carry no per-source orientation, so subtraction with internal coplanar tangency leaves zero-volume sheets (issue #13, not fixed by design).
  - DOCUMENTED (code; issues).
- **Cascading is explicitly unsupported.** From the paper, §7.1:
  - "no guarantees on the result can be given because after each frame we snap exact coordinates to floating points".
  - "the repeated composition of implicit points would soon lead to complex polynomial expressions for which the arithmetic filtering fails in virtually all cases, introducing major slowdowns, and eventually running out of memory".
  - The authors also note: "the output of a Boolean operation is always a subset of the input (ground truth) primitives, but we lack a proper mechanism to update the definition of implicit intersection points so as to avoid second level constructions". This is the idea EMBER and trueform exploit (planes or original primitives as the persistent currency).
  - DOCUMENTED.
- **Precision model.**
  - Input is double, scaled exactly by a power of 2.
  - The filters assume IEEE double with directed rounding.
  - The exact tier uses double expansions, with a bigfloat escape for exponent overflow.
  - Nothing is float32.
  - DOCUMENTED.

## Parallelism and performance

All numbers DOCUMENTED from the paper unless noted.

- **Thingi10K** (12 cores): 7628 clean meshes paired into 3814 Booleans.
  - Total: 4.5 min against 28.3 min for libigl/Zhou 2016.
  - Arrangement: 4 vs 22.5 min, 5.5x.
  - Boolean stage: 0.47 vs 5.8 min, 12.2x.
  - Inside/outside step: up to 101x, 11.34x on average.
- **Huge meshes, 1.3M-14.4M triangles.**
  - Arrangement is about 10x faster than Zhou and about 5x faster than Cherchi 2020.
  - The Boolean stage is about 80x faster than Zhou in 70% of cases, about 6x otherwise. The whole pipeline averages about 25x.
  - So the "80x" in the brief is the huge-mesh Boolean-stage figure, not the Thingi10K one.
- **Interactive rotation demo** (M1 Pro): 200K triangles in 0.06-0.19 s per frame, against 1.37-6.48 s for libigl.
- **Variadic:** Fertility minus 700 spheres in 1.1 s.
- **Parallel structure:**
  - per octree leaf: detection;
  - per triangle: retriangulation, with spin-mutexed shared maps;
  - per patch: ray cast, fully independent;
  - serial: patch flooding and extraction.
- **Third-party comparisons:**
  - trueform paper (M4 Max, 1000 pairs at 100k-1M triangles): Cherchi median 416.9 ms against trueform 15.7 ms (28.7x geomean), Manifold 118 ms and Geogram 1644 ms. N-ary medians at N = 4/16/64: 310/1711/4495 ms. Valid 1000/1000 and 40/40. DOCUMENTED (arXiv 2607.15905, Tables "pairwise", "nary"; vendor-run).
  - Solidean/OBB iterated benchmarks (IARMB 2024-6, Ryzen 5900X):
    - iterated cube grid, 1999 ops: 38 s, "wrong (residual solid)";
    - 9-op sphere/torus chain: "no result";
    - terrain carve: "exit (needs rationals)".
  - DOCUMENTED (https://solidean.com/blog/2026/iterated-cube-grid-benchmark/, https://solidean.com/blog/2026/first-benchmark-results-iterated-csg/, https://solidean.com/blog/2026/terrain-carve-benchmark/; vendor-run).

## Known failures, limitations, war stories

- **#8, #30:** "unable to calculate ray" / "fully implicit patch that requires exact rationals". The fallback was omitted "because the code was convoluted and it was also never necessary in all our tests". It is hit by tubular meshes and by the terrain carve. DOCUMENTED.
- **#2 (BRL-CAD, Dec 2022): the authors on why cascading fails and what would fix it.** BRL-CAD evaluates deep CSG trees by feeding each intermediate mesh into the parent Boolean. Livesu (co-author) replied with the key statements. DOCUMENTED (https://github.com/gcherchi/InteractiveAndRobustMeshBooleans/issues/2):
  - The mechanism: "the Indirect Predicates do not permit to construct a new implicit point as the intersection of mesh elements that already contain some other implicit point (this is exactly what would happen if you cascade), making robust cascading not currently possible."
  - What survives rounding: "the approximation error affects only the vertex coordinates and not the mesh connectivity ... if the two shapes are not tangent, the output mesh will be guaranteed to be manifold watertight." Rounding can still add "zero area triangles, intersections, and points that move far away from where they should be".
  - A heuristic workaround: Diazzi and Attene's volume-mesh Boolean can absorb rounded intermediates through its repair step, "but we are talking about very shallow CSG trees" and it can "fail because of badly rounded coordinates that create sort of artificial spikes".
  - The unbuilt fix: since every output is a subset of the input primitives, "it should always be possible to express all intersection points as the intersection of input primitives natively expressed with floating points. What we miss right now is the ability to do a backtracking". Livesu called this funding-limited, and it was still not built as of 2026-09.
  - INFERRED relevance: this missing backtracking is the premise of EMBER's planes and trueform's original-plane predicates. In wonky's hybrid it comes free: each operation re-tessellates the exact B-rep with per-triangle analytic face tags, so every intersection point is, by construction, a function of original primitives. Wonky never needs second-level implicit points.
- **#19:** `assert(intersected_edges.size() > 0)` in constraint insertion. Rare, and one report is arm64-only. Unresolved. DOCUMENTED.
- **#13 (BRL-CAD):** coplanar faces bite holes, giving non-manifold output. The authors refused a normal-based fix because "triangle normals are not robust". BRL-CAD shelved its integration. DOCUMENTED.
- **#23 (OpenVSP):** open operands are not supported; 32 labels is a compile-time cap. DOCUMENTED.
- **Cascaded implicit points are fragile in practice.** In Aug 2026 Indirect_Predicates gained cascaded implicit points (LNC/BPT/TBC built from implicit points). PR #15 showed that their interval filters reported an undecided denominator sign as usable. That made `orient3D` wrong in 233,200 of 355,200 filtered queries (66%) in a reproducer, with 19,558 of 150,705 affected vertices in a 10.5M-tet VolumeRemesher run. The fix is gated behind `#ifdef CASCADED_IMPLICIT_POINTS`. This supports the paper's warning that composed implicit points are where filters break. DOCUMENTED (https://github.com/MarcoAttene/Indirect_Predicates/pull/15, commits 4819c5e and c7b5dd2).
- **Compiler-flag fragility is shared with every filtered-float predicate library.** Geogram on Apple Silicon: clang's default FMA contraction silently broke its predicates; the fix was `-ffp-contract=off`. Indirect_Predicates demands `-frounding-math -O2` or `/fp:strict`. DOCUMENTED (https://github.com/BrunoLevy/geogram/issues/382; Indirect_Predicates README).

## Relevance for wonky

- **Implicit points as provenance, the main asset.** An LPI is "edge e of triangle t_A crossing the plane of triangle t_B". A TPI is "the planes of three triangles". If each triangle carries its analytic face id, these tuples name exactly the surface pair or triple needed for analytic B-rep recovery in the leading hybrid. INFERRED.
- **Single-op engine, not persistent representation.** Per the paper's own §7.1, and the IARMB failures on all three iterated benchmarks, the output mesh cannot be fed back safely. The wonky hybrid fits this naturally: each Boolean re-tessellates from the exact B-rep, runs one arrangement, recovers analytic topology, and discards the mesh. The per-op rounding is then irrelevant because the mesh is never the persistent state. If wonky ever did feed meshes forward, it would need an explicit tolerance plus a validity check (self-intersection test), and would have to fail explicitly. INFERRED.
- **Arithmetic mapping to Bend (INFERRED unless noted).**
  - **Input.** If wonky's tessellation vertices are quantized to a b-bit integer grid, for example b = 24 so each coordinate is exact in F32, or a trueform-style 31-bit lattice, then every predicate is a fixed polynomial with a static bit bound. Examples:
    - explicit orient3d: degree 3, about 3b + 5 bits;
    - LPI-involving orient3d_IEEE: degree about 6;
    - three LPI plus one explicit: degree about 13;
    - orient3d on four TPI points: degree about 27, i.e. about 27b + 20 bits, or 21 U32 limbs at b = 24.
    - Most calls resolve in the filter, but the worst-case limb count sets the exact kernel's size.
  - **Filter.** Attene's interval filter needs directed rounding. Metal has round-to-nearest only, and its default math mode "fast" allows contraction "across statements". DOCUMENTED (`tmp/research/pdf/msl-spec.txt` lines 614-690).
    - Use static or semi-static error bounds computed for F32x2 instead. Joldes-Muller-Popescu give relative bounds for double-word add (Alg. 6: 3u^2 + 13u^3) and multiply (Alg. 12: 5u^2 with FMA; Alg. 10: 7u^2 without), DOCUMENTED (`tmp/research/pdf/joldes2017-hal.pdf`, Table 1).
    - With u = 2^-24 for F32 pairs, that is about 2^-45 to 2^-46 per operation, i.e. about 45 effective bits, not 48, after a few operations. INFERRED.
    - Bend 2 already pins contraction: `#pragma clang fp contract(off)`, `MTLMathModeSafe`, CUDA `--fmad=false` (`tmp/research/bend/bend2/comp.ts` L3324, L5020, L5162). DOCUMENTED.
    - Bend exposes no FMA primitive, so double-word products must use Dekker splitting (7u^2 bound). DOCUMENTED (comp.ts `OPERATIONS`).
    - Metal may flush denormals and may use round-toward-zero (MSL §8.1-8.2), and both break error-free transforms. Keep inputs on a grid well inside the normal range, and self-test the rounding mode at startup. INFERRED.
  - **Exact tier.** U32-limb fixed-width integers with the limb count set per predicate from its degree. This follows the trueform and EMBER pattern, not Attene's expansions: F32's 8-bit exponent would overflow expansions quickly. Bend's `u32_mul` returns only the low word, so products need 16-bit half-limbs. A 670-bit TPI predicate therefore costs about 42 half-limbs per operand and on the order of 10^3 `u32_mul` per product. Keep implicit-point degree low: prefer LPI, and push TPI-heavy predicates to a rare exact path. INFERRED.
- **Bend fit by stage (INFERRED):**
  - Detection: fork-join over a sorted pair list.
  - Tri-tri classification: uniform, a sign table.
  - Per-triangle retriangulation: needs a pure reformulation. Group constraints per triangle by sort, then run a pure per-triangle CDT or earcut returning local triangles, then dedupe by sorted keys.
  - Ray per patch: independent, axis-aligned, U32 bitmask labels.
  - Patch flooding: sort-based connected components instead of a serial flood.
- **Coplanar semantics.** Mechanical CAD is full of flush faces, so #13 must be fixed in any adaptation. For exactly coplanar triangles, orientation agreement is decidable exactly with orient2d on a shared projection or jolly point. INFERRED.
- **Testing idea.** Use topology invariants (component count, Euler characteristic) from two independent exact implementations as a differential oracle, as the paper does against libigl. Apply it across wonky's JS, C and Metal backends and across bake-off candidates. DOCUMENTED method, INFERRED use.

## Pointers worth porting or studying

1. Paper §3-4 plus `arrangements/code/intersection_classification.cpp`: the exhaustive tri-tri case analysis from orient3d sign triples (MIT).
2. Attene 2020 LPI/TPI homogeneous formulas: re-derive, do not copy the LGPL-generated code. Use them to size limb counts per predicate.
3. Paper §4, cached cofactor minors per triangle: orient3d as a 4D dot product.
4. Paper §5 / Alg. 1 and `findRayEndpoints`, `fast2DCheckIntersectionOnRay`, `sortIntersectedTrisAlong{X,Y,Z}` in `code/booleans.cpp`: per-patch ray classification with exact verification of the ray origin.
5. `bool{Union,Intersection,Subtraction,XOR}` in `code/booleans.cpp`: bitset selection plus flips.
6. `TriangleSoup::initJollyPoints`: exact in-plane orientation without projection.
7. Paper §7.1: the cascading discussion, the clearest statement of why implicit-point pipelines must reset between operations.
8. Sibling note `interactive-and-robust-mesh-booleans-cherchi-et-al.md` for line-level pointers.

## Verdict: adapt

Adapt it as the single-operation topology engine for wonky's analytic-recovery hybrid. Implicit points give provenance tuples for free, predicates only touch input coordinates within one operation, and per-patch ray classification is embarrassingly parallel. The MIT top layer may be followed closely.

Do not adopt it as a persistent representation: the authors say cascading fails, and IARMB failed all three vendor iterated benchmarks.

Required changes:
- re-derive the predicates for an integer grid with U32-limb exact arithmetic and F32x2 static filters, avoiding the LGPL code, directed rounding and FMA-contraction hazards;
- replace the ulp nudge with SoS;
- turn the missing rational fallback into an explicit error;
- define coplanar orientation semantics.
