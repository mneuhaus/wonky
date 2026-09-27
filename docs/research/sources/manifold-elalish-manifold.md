# Manifold (elalish/manifold)

- Kind: open-source C++ geometry library (mesh Booleans, CSG tree, 2D CrossSection). Canonical: https://github.com/elalish/manifold. Also: wiki https://github.com/elalish/manifold/wiki/Manifold-Library, docs https://manifoldcad.org/docs/html/, design PDFs in `docs/` (RobustBoolean.pdf = Smith thesis, ParallelBVH.pdf = Karras 2012, Boolean2.md).
- Authors/org: Emmett Lalish (elalish, ex-Google) with Chun Kit Lam (pca006132), Geoff deRosa, zmerlynn and 91 contributors in total. Started 2019-02-27.
- License: Apache-2.0 (DOCUMENTED, `gh api repos/elalish/manifold`). This is permissive. Wonky can port the algorithms and even transliterate code into Bend. Apache-2.0 section 4 needs attribution/NOTICE only when *distributing* a derivative. Wonky is private and unlicensed, so today there is no obligation. Keep a provenance comment in any transliterated Bend file so that later publication stays clean.
- Status: very active. 2288 stars, 253 forks, 32 open issues and PRs, repo size ~70 MB, pushed 2026-09-23T21:22Z (re-checked with `gh api` on 2026-09-24). HEAD 213b655 (a dependabot bump); the last functional commit is 36d0aab "Fix infinite recursion in edge swap (#1842)", 2026-09-22. Latest release v3.5.3 (2026-09-07). v3.0.0 (2024-11-18) moved to double precision. v3.5.0 (2026-05-23) added cross-platform determinism. The README "Users" list names OpenSCAD, Blender, Godot, Nomad Sculpt, IFCjs, Grid.Space, bitbybit.dev and ManifoldCAD (DOCUMENTED). What exactly each integration uses it for, e.g. OpenSCAD's backend choice or Blender's solver, is HEARSAY here and was not verified.

## What it is

Manifold is a parallel mesh-Boolean library built on the "shadow function" algorithm of Julian Smith's thesis (Smith & Dodgson 2007, see `smith-dodgson-2007-a-topologically-robust-algorithm-for-bool.md`). The inputs are closed oriented triangle meshes (`MeshGL`/`MeshGL64`). The output is a guaranteed manifold triangle mesh. It carries per-triangle provenance (`originalID`, `faceID`) and interpolated vertex properties. It uses plain floating point (double since v3.0) with no exact arithmetic anywhere. Robustness comes entirely from symbolic perturbation plus a strict "ask each geometric question once" dependency chain (DOCUMENTED, wiki "Manifold-Library": "each geometric computation is based on those before it, in such a way that the same question is never asked in two different ways").

## How it works

The core is `src/boolean3.cpp` (656 lines) and `src/boolean_result.cpp` (975 lines). Reading the code at HEAD 36d0aab:

1. **Broad phase** (DOCUMENTED, `src/collider.h`, `Intersect12_`). A radix-tree BVH over Morton-coded triangle boxes of Q (Karras 2012). Every edge box of P is queried against it. The output is a stable-sorted list of candidate (edge of P, face of Q) pairs `p1q2`, and the symmetric pass gives `p2q1`.
2. **Kernel cascade** (DOCUMENTED, `boolean3.cpp`). All predicates come from one scalar primitive in `src/shared.h`:
   `Shadows(p, q, dir) = p == q ? dir < 0 : p < q`.
   Ties are broken by a *symbolic* perturbation direction. For vertices this is the x/y/z component of `vertNormal_`. For edges it is the sum of the two adjacent `faceNormal_` components.
   - `Shadow01` (vertex vs edge in x, then y check).
   - `Kernel11` (edge vs edge in xy, gives `s11` and `xyzz11`).
   - `Kernel02` (vertex vs face in xy with a z shadow, gives `s02`, `z02`).
   - `Kernel12` (edge vs face, gives `x12` and the 3D intersection point `v12`).

   Each higher kernel is a signed sum of lower-kernel results, exactly Smith's table 4.1. Interpolation (`Interpolate`, `Intersect` in shared.h) always interpolates from the *nearer* endpoint (`useL = |x-aL.x| < |x-aR.x|`). It projects along the dominant normal axis (`GetAxisAlignedProjection`) to keep rounding small. Non-finite lambdas fall back to an endpoint.
3. **Expansion vs contraction** (DOCUMENTED, Boolean3 constructor comment). "Union -> expand inP, expand inQ; Difference, Intersection -> contract inP, expand inQ". The perturbation sign is chosen per operation. As a result, touching cubes merge, equal-height differences produce through-holes, and `A - A` is empty (DOCUMENTED, wiki).
4. **Winding numbers** (DOCUMENTED, `Winding03_`). A union-find (`DisjointSets`) over P's edges that are *not* broken by any intersection gives connected components. Exactly one `Kernel02` ray query is made per component representative, and the result is flood-filled. This is the "each question once" trick applied to point containment.
5. **Inclusion and sizing** (DOCUMENTED, `Boolean3::Result`):
   - c1 = Intersect?0:1, c2 = Add?1:0, c3 = Intersect?1:-1.
   - i03 = c1 + c3·w03, i30 = c2 + c3·w30, i12 = c3·x12 (Smith eq. 4.7-4.13).
   - An exclusive scan with `AbsSum` sizes the output vertex array. Vertices with |inclusion| > 1 are duplicated, which is how self-overlapping or invalid input degrades gracefully.
6. **Assembly** (DOCUMENTED). `AddNewEdgeVerts`, `PairUp`, `AppendPartialEdges`, `AppendNewEdges`, `AppendWholeEdges`. Source comment: "At this point the calculation switches from parallel to serial". It uses a `concurrent_map` keyed by face pairs. `PairUp` sorts start/end verts along the edge direction (Smith eq. 4.14-4.16). The comment notes that any pairing preserves manifoldness, but ordered pairing is needed for geometric validity, "otherwise ... becomes a heuristic".
7. **Face2Tri** (DOCUMENTED, `polygon.cpp`, 1102 lines). Retained faces are polygons with holes, and ear clipping is adapted for epsilon-valid input: epsilon walks, the O(n^2) worst case, and a fallback to *some* triangulation to keep topology.
8. **Cleanup** (DOCUMENTED, `edge_op.cpp`, 1136 lines). `RemoveDegenerates` does edge collapse and edge swap of triangles shorter than epsilon. `SortGeometry` reorders by Morton code for locality.
9. **Epsilon bookkeeping** (DOCUMENTED, PR #1836 merged 2026-09-22):
   - `SetTolerance`/`tolerance_` are gone.
   - `epsilon_ = Quality::GetRelativePrecision() * bBox_.Scale()`, with a default relative precision `kPrecision = 1e-12` (`src/utils.h`).
   - Epsilon depends only on the current bounding box. The old "precision grows with operation history" tracking was removed.
10. **2D engine Boolean2** (DOCUMENTED, `docs/Boolean2.md`, `src/boolean2.h`). The new CrossSection engine replaces Clipper2 and implements Smith chapter 7: a Bentley-Ottmann sweep with the 7.6.2 block rule. It uses `kU = 1.11e-16`, `kAlphaCoeff = 12.37` and `EpsilonFromScale(L, k=1000) = (k+1)·alpha`, with alpha = sqrt(153)·u·L (Smith section 8.2). An earlier pairwise, parallel attempt failed on dense near-concurrent clusters (DOCUMENTED, Boolean2.md). A sweep is inherently sequential.

## Robustness and guarantees

- **Topology is guaranteed.** Output is manifold for any closed-manifold input, "irrespective of numerical errors". Proven in Smith's thesis, theorems 1-4, section 4.9, for the polygon variant. Manifold relies on the triangle variant plus a topology-only triangulator (DOCUMENTED, wiki and thesis).
- **Geometry is not guaranteed.** Manifold defines "epsilon-valid" output: some vertex perturbation smaller than epsilon makes the mesh non-self-intersecting. The wiki states this "cannot be mathematically proven ... any example to the contrary will be taken as a serious bug" (DOCUMENTED). So there is no proof, only a strong engineering contract.
- **Coplanar and degenerate cases** resolve by symbolic perturbation, not by snapping. Results are consistent but can contain zero-area or sliver triangles. Those are removed afterwards when shorter than epsilon, but "cannot guarantee removal of all degenerate triangles" (DOCUMENTED, wiki).
- **Determinism.** Since v3.5.0, a CI job hashes OBJ output across Linux/macOS/Windows with `MANIFOLD_PAR=OFF` (PR #1594). Transcendental functions are musl-derived (PR #1606). Parallel runs are not bitwise reproducible across thread counts (INFERRED from the job disabling PAR).
- **Precision history** (DOCUMENTED, issue #542, PR #895). Manifold ran in **single-precision float** for its first years; "float was mostly due to CUDA". elalish: "double precision is not at all about robustness, but just coordinate accuracy". The move to double came from Rhino/engineering users needing large coordinate ranges. INFERRED: the algorithm's topological robustness is precision-independent. This is strong evidence that an F32x2 (~48-bit) port is viable, and that even plain F32 kept topology valid.

## Parallelism and performance

- **Parallel stages** (DOCUMENTED, `src/parallel.h`, TBB or serial fallback): the BVH build (Morton sort plus radix tree), collider queries, all four kernels, the inclusion scans and the Morton-order geometry sort. Kernels are pure maps over candidate pairs, with O(1) work per pair plus small loops over the three edges of a triangle.
- **Serial stages** (DOCUMENTED): the union-find in Winding03 (DisjointSets uses atomics but is effectively a sequential structure), edge assembly via concurrent_map, Face2Tri per face (parallel across faces, serial inside), and edge collapse.
- **Benchmarks.** The README and wiki claim orders-of-magnitude speed-ups over CGAL Nef and Carve. The Menger sponge (genus 26,433) is the stress test (DOCUMENTED, wiki).
- **Iterated CSG, Manifold 3.4.0** (vendor-run Solidean series, Ryzen 9 5900X; DOCUMENTED and cross-checked in `solidean-iterated-csg-benchmark-series-2026.md`):
  - 9-op sphere/torus chain: correct, 332 ms (Solidean 27 ms, Trueform 85 ms, CGAL corefine 507 ms).
  - 223-op terrain carve with exactly coplanar seams: **canonical, 525 ms**, the only engine without exact constructions among the 4 survivors of 17.
  - 1999-op cube grid (non-manifold intermediates, exact per-step oracle): canonical, 5.3 s.
  - Dome carve: canonical at 100/250/1000/5000/10k steps (1.1 s, 5.5 s, 34 s, 442 s, ~20 min), agreeing with the exact engines to 1e-4 relative. At 100k steps it timed out at op 17,257 within the 1 h budget. It is the lowest-memory survivor (203 MiB at 10k vs Solidean 1.1 GiB).
  - Cost per cut grows with the running mesh, so total time is superlinear in step count.
- **ThingiCSG** (Levy 2024, see `levy-2024-exact-predicates-exact-constructions-and-combinato.md`): Manifold as an OpenSCAD backend "is always the fastest" of Manifold, CGAL Nef, CGAL corefinement and Levy's exact pipeline. It is rarely over 1 s per CSG (DOCUMENTED, the Manifold version is not stated).

## Known failures, limitations, war stories

- **#1706 slivers** (DOCUMENTED, issue text). Near-coincident inputs give sliver triangles, e.g. 615 tris with area < 1e-9 on a 25,400-unit mesh. elalish says these are "very much expected to be produced by Smith's Boolean due to symbolic perturbation". Snapping inside the kernels "would likely break manifoldness". `SimplifyTopology` is too conservative, and edge_op.cpp has "grown unruly". Terrain workflows fail downstream.
- **#1516 TrimByPlane** (DOCUMENTED). Slices produced by two separate operations cannot be re-unioned watertight, because their intersection vertices are recomputed: "if it's anything other than float identical, it won't work". `Split` works because it computes the cut once. **Lesson:** identical-bits reuse is part of the robustness contract. Wonky's operation-scoped decision record (docs/boolean-strategy.md) targets exactly this.
- **#289 self-overlap removal is impossible** (DOCUMENTED) with Smith's parallel pairing. Triplet dependencies arise (an XOR-SAT formulation was tried and abandoned), so it needs Smith chapter 7's sweep. This led to Boolean2, which is 6-46x slower than Clipper2 at the time of the thread. elalish: "Once upon a time I considered writing this whole library in fixed precision, but I'm glad I went with the decision I did."
- **PR #895 double precision** (DOCUMENTED). Tightening kTolerance made more tests fail. Symptoms: BigSponge triangle counts changed under rotation, Hull.Tictac was flaky, Zebra triangulation failed on CI. **Lesson:** the epsilon cleanup and the triangulator are the fragile half, not the kernels.
- **PR #1836** (DOCUMENTED). The float-vs-double concept is gone. elalish wants a single-precision default "but that's not trivially working". The PR body names the cost: non-axis-aligned coplanar faces in double input "likely wouldn't get those coplanar faces collapsed after operations". The relative tolerance is now a global getter/setter in the `Quality` settings.
- **#1838 / #1842: the cleanup pass did not terminate** (DOCUMENTED, https://github.com/elalish/manifold/issues/1838, https://github.com/elalish/manifold/pull/1842).
  - An intersection of two real meshes (`test/models/r1.obj`, `r2.obj`, coordinates near 900 with z = 100.0002) sent `RecursiveEdgeSwap` inside `RemoveDegenerates()` into unbounded recursion. The triangle ids cycled 1907, 1308, 1907, 1309, 1904, …
  - The reporter traced it to the symmetric condition `length2(next - last) < epsilon_ * epsilon_`, which swaps a diagonal back and forth. A one-way condition `length2(next - last) < length2(edgeVec)` fixed it.
  - The merged fix only adds `if (depth > 100) return 0;` plus the test `BooleanComplex.InfiniteRecursion`. elalish: the test "was reproducing the problem until #1836 landed", and the guard is defensive "in case the underlying issue isn't completely solved (as it may well be a floating point error)".
  - **Lesson (INFERRED):** every epsilon-driven rewrite rule in cleanup needs a strictly decreasing measure (a termination argument), not a symmetric threshold. A depth cap turns non-termination into silently unfinished cleanup, which wonky should report as `Unresolved`.
- **#1834: faceID round trip** (DOCUMENTED, https://github.com/elalish/manifold/pull/1834). Triangle ids were copied into `faceID` on MeshGL export. On re-import this "would now stop coplanar triangles from being collapsed", so the same mesh behaved differently after a round trip. **Lesson (INFERRED):** provenance tags that also steer geometric cleanup must be round-trip stable, or tag changes silently change geometry.
- **#1848: atomic index allocation breaks determinism** (DOCUMENTED, https://github.com/elalish/manifold/pull/1848, open). With `MANIFOLD_PAR=ON`, `LevelSet` handed out vertex and triangle indices with `AtomicAdd`. About 1 in 4 runs gave a different mesh, sometimes with different topology, because `CleanupTopology()` repairs in index order before `SortGeometry`. The fix assigns deterministic keys and sorts before cleanup, for about 1% extra time. The PR notes that "Booleans also use `AtomicAdd` in places (e.g. `AppendWholeEdges`)". **Lesson (INFERRED):** Bend has no atomics in user code, so indices come from prefix sums and are deterministic by construction. Wonky's corefine port was byte-identical on JS, CPU1, CPU18 and Metal on all 38 corpus and 216 adversarial cases (DOCUMENTED, docs/hybrid-boolean-plan.md section 1).
- **Other open issues** (DOCUMENTED): #1652 SIGSEGV in AssembleHalfedges on broken topology (so input validation matters), #1193 radial sort for non-2-manifold edges, #1553 dual BVH traversal, #745 negative-volume meshes, #1785 hull on non-convex input.
- **#1430 and #1656: coincident faces.** The symbolic perturbation mishandles exactly coincident but *non-axis-aligned* faces (DOCUMENTED, https://github.com/elalish/manifold/issues/1430, https://github.com/elalish/manifold/issues/1656).
  - #1430: an axis-aligned octagon-with-bars subtraction leaves flat shards. pca006132 calls it "a known issue. Sadly we don't have a good way to fix it"; the result "is still topologically valid, so the plan is to solve this via mesh simplification" (PR #1347 "Simplify 180° Edges", since closed).
  - elalish: "our symbolic perturbation has been more of a best-effort feature since it can't work with floating-point errors anyway". The current perturbation "effectively perturbs toward one of the 8 octants", which is insufficient for acute vertices. Tilings of volumes sharing identical vertices easily produce shards, a problem that surfaced in the Minkowski work (#666).
  - #1656: union of two random tetrahedra sharing an exact face keeps the duplicate internal faces in about 1.4% of 1000 trials. By dominant axis of the shared face normal the failure rate is 3.0% for X, 1.2% for Y and 0% for Z, which matches the X→Y→Z kernel cascade (zmerlynn's measurement).
  - elalish: always manifold, but "I don't believe the problem is solvable if you want pretty output for all possible marginal inputs".
  - A candidate fix exists only in the Rust port https://github.com/luisfonsivevo/meshbool (Apache-2.0, 7 stars, pushed 2026-08-30). PR #11 "Rewrite symbolic perturbation algorithm" is still open; its author says it is "not tested very thoroughly".
  - **Lesson for wonky:** flush and touching faces are the common case in CAD/FDM code, not a marginal one. Prototype 1 needs either an exact coincidence pre-pass (mark exactly-equal vertex and face pairs before perturbing) or a fallback to exact-plane for those pairs.
- **#1320 nondeterminism** (DOCUMENTED, https://github.com/elalish/manifold/issues/1320): a union of 19 partly coplanar cubes gives different triangles on repeated runs with `MANIFOLD_PAR` on. Vertex positions are identical but triangulations differ; the issue is still open. Parallel execution breaks bitwise reproducibility. Wonky's fork-join must fix a deterministic reduction order.
- **Levy 2024 ThingiCSG failures** (DOCUMENTED, arXiv 2405.12949 section 3.3, fig. 18, table 6):
  - fails on nasty_gears_1 (difference of two sets of 50 rotated cubes) "as well as other ones with similar co-planar configurations or high mesh density";
  - fibo_sphere_500 (62.5 M input vertices) produced output in 385 s "but this result has many missing triangles".
- **Curved input** (DOCUMENTED, wiki). The Boolean works only on flat triangles, so curved surfaces must be refined first. Provenance (`faceID` = the largest-area triangle of each coplanar face) is the only link back to analytic surfaces.

## Relevance for wonky

This is the direct reference for bake-off prototype 1 (tagged mesh Boolean with symbolic perturbation). It became the front half of the chosen hybrid, feeding prototype 4 (analytic B-rep recovery from a tagged mesh), because the Manifold algorithm carries per-triangle source tags (`faceID`/`originalID`) through the Boolean.

**Current wonky state** (DOCUMENTED; re-checked 2026-09-24): the port moved from `kernel/proto/corefine/` to `kernel/hybrid/corefine/shadow.bend` (uncommitted working tree). It ports `shadow01`, `kernel11`, `kernel02`, `kernel12` and `expandP` from boolean3.cpp and shared.h over F32x2 Reals, with Apache-2.0 attribution in the header.

**Bake-off outcome** (DOCUMENTED, docs/bakeoff.md "Results" and docs/hybrid-boolean-plan.md, judge round 2, 2026-09-23, M5 Pro):
- corefine won the topology stage of the chosen hybrid (corefine decides topology, recover rebuilds the exact B-rep from face tags). commit 0f17ee2.
- Corpus: 36 of 38 pass, plus 2 expected tangent refusals. The volume matches manifold3d on the same leaves to at most 3.6e-14 relative.
- Speed: fastest of the four prototypes on every target. Over the 35-case common set it took 6,157 ms at 1 thread, 4,187 ms at 18 threads and 30,974 ms on JS, vs exact-plane 34,389 / 10,593 / 114,400 ms. It scales worst: the cpu1/cpu18 geo-mean is 1.46, because union-find, assembly walks and welding are sequential.
- Adversarial (216 cases): 181 good, 17 refused, **18 wrong `ok`**. They split into 10 point contacts, 4 self-intersections of about 1e-10 mm on rotated coplanar input, 2 grazing tools below the deviation and 2 oracle disagreements. The rotated coplanar cases (`adv-ep2-rot-coplanar-pocket`, `adv-ep2-sweep-pocket-3/5`, `adv-ep2-sweep-touch-union-5`) are Manifold's #1430/#1656 weakness reproduced in F32x2.
- Wonky's counter-measure is **carrier unification**: plane carriers of different leaves within 2^-44·scale become one class, and comparisons within 2^-36·scale between elements touching a class are ties. Exactly axis-aligned pairs are never unified. Two gate verifiers found that the first tolerances merged real geometry: a sealed void under a 2e-11 mm skin, then a 1e-11 mm skin under a tilted face, came back as an opened pocket. Both were fixed on 2026-09-23/24 by tightening to 2^-44. **Lesson:** any coplanarity snap on top of symbolic perturbation is itself a new source of wrong answers and needs its own adversarial suite.
- **Output gates added after the judge round** (DOCUMENTED, commit aa84b76, 2026-09-24, plan section 8 steps 1-4 "done"):
  - `gate.bend` runs on every result. It has a vertex-link check that refuses with "non-manifold contact (point)", and an exact BVH self-intersection gate (F32 filter with certified bounds, then Reals, then big integers) that refuses with "result self-intersects".
  - corefine's wrong `ok` count fell from 18 to 3, all grazing tools, which recover's pre-certificate refuses on the hybrid path. recover's fell from 15 to 0. Rotated coplanar input is exact on 14 of 14. Corpus results stayed byte-identical.
  - The gate costs about +11 % cpu18 compute on the corpus (one loaded run at +22.8 %).
  - **Lesson:** Manifold's "always return something" philosophy needs an exact post-check on top before it can serve a refuse-rather-than-lie kernel. The check was cheap relative to the Boolean.

The remaining open questions:
- whether F32x2's ~48-bit mantissa keeps the observed iterated-CSG survival. The Solidean evidence is for double. The float32-internal Trueform failed the terrain and dome chains while its double build survived (INFERRED transfer, DOCUMENTED data). The bake-off only ran 3-6-step iterated chains, so this is still unmeasured.
- The Open Boolean Benchmark self-rating "R I" (robust, stable under iteration), not "E" (exact), is the honest claim prototype 1 can inherit (DOCUMENTED, OBB README).

Fit against wonky constraints (INFERRED unless noted):
- **F32/U32 only, F32x2 reals.** Kernels need only compare, add, mul and div on coordinates. Port them to `Real{hi,lo}` from `kernel/real.bend`. `Shadows(p,q,dir)` needs an exact `p == q` on F32x2, so values must be canonically renormalized (hi = fl(hi+lo)) before comparison. Otherwise two encodings of the same number break the tie rule and, with it, the "ask once" invariant. corefine does this: "Reals are canonical and (hi, lo) compares lexicographically", and constructed points are snapped to double representability so that equal Reals are equal doubles on the wire (DOCUMENTED, docs/proto-corefine.md "Numeric model").
  - Dekker splitting (4097) in real.bend requires no FMA contraction and no fast-math. The Metal runtime of Bend 2.0.25 compiles with `MTLMathModeSafe` and CUDA with `--fmad=false` (DOCUMENTED, docs/proto-exact-plane.md "Numeric model"). The risk is handled for these backends, but it must stay a checked backend property.
  - real.bend's `add` is the sloppy double-word add: TwoSum on the high words, then a plain F32 sum of the TwoSum error and both low words, then Fast2Sum (DOCUMENTED, kernel/real.bend, unchanged since cd9ba68). Joldes, Muller & Popescu (ACM TOMS 44(2), 2017, section 3; local tmp/research/pdf/joldes2017-hal.pdf) show that this Algorithm 5 ("SloppyDWPlusDW") has no relative-error bound for opposite-sign operands, with an example whose relative error is 1. Their advice: "never use Algorithm 5, unless you are certain that both operands have the same sign" (DOCUMENTED). Algorithm 6 ("AccurateDWPlusDW", 20 flops vs 11) is bounded by 3u²/(1−4u), about 3·2^-48 ≈ 1.1e-14 for F32 words (Theorem 3.1). Manifold's interpolation computes differences of nearly equal coordinates constantly, so switch the subtractions in the kernels to Algorithm 6 before quoting any epsilon bound (INFERRED). corefine's stated "about 2^-44 relative" per constructed point assumes the accurate case.
  - Unit roundoff u ~ 2^-48, i.e. 32x coarser than double. Manifold's relative 1e-12 is ~9000 ulps in double but only ~280 ulps in F32x2. A wonky default near 1e-11..1e-10 relative is safer, and Smith's alpha = 12.37·u·L gives a principled floor. corefine uses 2^-36·scale (about 1.5e-11 relative) for its short-edge collapse (DOCUMENTED, docs/proto-corefine.md).
- **No mutation, fork-join, uniform GPU work.**
  - Kernels are embarrassingly parallel maps over candidate pairs with near-uniform work, which suits GPU call trees.
  - The BVH needs a Morton sort (radix or merge sort as a balanced fork-join) plus Karras' radix-tree build. The build is uniform per internal node.
  - Union-find in Winding03 must become label propagation or pointer jumping (Shiloach-Vishkin style, log rounds of pure maps), or a sort-based connected-components pass.
  - concurrent_map assembly becomes sort-by-key plus segmented scans.
  - Ear clipping stays per-face serial, but faces are independent, so it is fork-join friendly. The work per face is non-uniform, so it is CPU-only.
  - Edge collapse must run in rounds over maximal independent sets, not as in-place mutation.
- **Determinism** across JS/C/Metal is achievable because there are no transcendental functions in the Boolean path, and it was achieved: byte-identical results on all four targets (DOCUMENTED, bake-off). Manifold's own cross-OS hash CI is a model worth copying. Keep it a CI gate, because #1320 and #1848 show how easily parallel index allocation breaks it.
- **Refusal semantics.** The bake-off contract (kernel/proto/mesh.bend, now kernel/hybrid/mesh.bend) declares that a prototype must return `Unresolved` rather than an approximate mesh. Manifold's philosophy is the opposite: always return a topologically valid, possibly sliver-laden mesh. Wonky needs a post-check that converts "suspicious" into `Unresolved` instead of shipping slivers. The vertex-link and exact self-intersection gates above are that post-check. A sliver/epsilon-validity check is still open.
- **Licensing.** Apache-2.0, no blocker.

## Pointers worth porting or studying

- `src/shared.h`: `Shadows`, `Interpolate`, `Intersect`, `GetAxisAlignedProjection`. These are the whole numerical core, under 100 lines.
- `src/boolean3.cpp`: `Shadow01`, `Kernel11`, `Kernel02`, `Kernel12`, the `expandP` sign logic and `Winding03_`.
- `src/boolean_result.cpp`: inclusion numbers, the `AbsSum` scan sizing, `PairUp` ordering and the half-edge assembly.
- `src/collider.h` and `docs/ParallelBVH.pdf` (Karras 2012 LBVH). Also on disk as tmp/research/pdf/karras-2012-lbvh.pdf.
- `src/polygon.cpp`: epsilon-aware ear clipping. Study its failure modes before porting; consider a CDT alternative.
- `src/edge_op.cpp`: study only. It is the self-admitted "unruly" part.
- `docs/Boolean2.md`, `src/boolean2.h`: the 2D sweep and the explicit alpha error budget `EpsilonFromScale`. Useful for wonky sketch/section code.
- The CI determinism job from PR #1594, as a template for cross-backend hashing.
- Issues #1706, #1516, #289, #542 as design rationale. #1430 and #1656 (coincident-face perturbation) plus the reproducer in #1430 (octagon with two bars) and #1656's random shared-face tetrahedra make ready-made regression tests for prototype 1.
- `test/models/r1.obj` + `r2.obj` with `BooleanComplex.InfiniteRecursion` (#1842): a real-world XOR that drives the cleanup into oscillation. It is a cheap termination test for any wonky cleanup pass.
- External test sets where Manifold's behaviour is documented: Solidean cases 1-4 (all canonical at finished scales) and ThingiCSG nasty_gears_1 and fibo_sphere_500 (failures per Levy 2024).

## Verdict: adapt

Port the kernel cascade, the winding flood fill and the inclusion/scan sizing into Bend with F32x2 reals. Rebuild the serial parts as sort/scan/label-propagation passes. Replace "always return something" with an explicit epsilon-validity post-check that yields `Unresolved`. Do not copy edge_op.cpp's cleanup wholesale; design a round-based collapse.

Treat exactly coincident, non-axis-aligned faces as the known weak spot (#1430, #1656). Detect exact coincidences before perturbing, or route those pairs to exact predicates. Fix a deterministic reduction order (#1320). The Apache-2.0 license allows transliteration.

The 2026 iterated-CSG data (canonical on 223-op coplanar-seam and 1999-op cube-grid chains, 1e-4 agreement through 10k carve steps, all in double) is the strongest empirical support for this family. Whether it transfers to F32x2 is still unmeasured: the bake-off ran no chain longer than 6 steps.

Status in wonky (2026-09-24): adapted. The port is the topology stage of the chosen hybrid. It is the fastest prototype and byte-identical across targets. With exact output gates it is down to 3 wrong `ok` answers (grazing) on 216 adversarial cases, and those are refused on the hybrid path. Production dispatch is the next plan step.
