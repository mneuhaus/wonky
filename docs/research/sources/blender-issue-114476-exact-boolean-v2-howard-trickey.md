# Blender issue #114476 "Exact Boolean V2" (Howard Trickey's EMBER port)

- Kind: issue tracker thread plus an unfinished implementation branch. Includes the companion design thread #120182 "More Boolean Solvers" and the shipped Blender solvers it compares against.
- Canonical URL: https://projects.blender.org/blender/blender/issues/114476
- Other URLs:
  - Companion thread: https://projects.blender.org/blender/blender/issues/120182
  - Branch: https://projects.blender.org/howardt/blender/src/branch/exactboolv2
  - EMBER source: https://projects.blender.org/howardt/blender/raw/branch/exactboolv2/source/blender/geometry/intern/mesh_boolean_ember.cc
  - Fixed-width integers: https://projects.blender.org/howardt/blender/raw/branch/exactboolv2/source/blender/blenlib/BLI_fixed_width_int.hh
  - Shipped solvers (GitHub mirror): https://github.com/blender/blender/blob/main/source/blender/blenlib/intern/mesh_boolean.cc, `mesh_intersect.cc`, `math_boolean.cc`, and https://github.com/blender/blender/blob/main/source/blender/geometry/intern/mesh_boolean_manifold.cc
  - The paper being ported: Trettner, Nehring-Wirxel, Kobbelt, "EMBER", SIGGRAPH 2022, https://dl.acm.org/doi/10.1145/3528223.3530181
- Authors/organization, year(s): Howard Trickey, Blender modeling module. Issue opened 2023-11-03. Last branch commit 1bdb937 on 2024-03-13 ("Fix: splitting didn't consider parent's middle soup"). Trickey put the work on hold on 2025-02-25. Fixed-width integer library by Jacques Lucke. DOCUMENTED (Gitea API `/api/v1/repos/howardt/blender/branches/exactboolv2`; issue comments linked below).
- License: Blender is GPL-2.0-or-later (SPDX headers in every file; the GitHub mirror reports NOASSERTION). Porting implication: do not copy code into wonky (license choice pending). Study it, then re-derive from the EMBER paper, which carries no code license.
- Status and activity:
  - #114476 is still `open`, last updated 2025-10-14, 11 comments. #120182 closed 2025-08-07.
  - The branch is abandoned: its last commit is from 2024-03.
  - Blender 4.5 shipped the Manifold-based solver instead. The 4.5 release notes (Modeling, commit `dd559259d`): 'The "Manifold" solver is based on the Manifold Library. It is much more robust than the float solver … It only works when all the arguments are manifold -- i.e., each edge is adjacent to exactly two faces. As an exception, the case of subtracting a plane from a manifold mesh should work.' https://developer.blender.org/docs/release_notes/4.5/modeling/ DOCUMENTED (fetched 2026-09-24).
  - GitHub mirror blender/blender: 20,481 stars, pushed 2026-09-22 (20,507 stars, pushed 2026-09-23 on re-check 2026-09-24).
  - DOCUMENTED (Gitea API JSON saved at `tmp/research/blender/issue-114476*.json`).
  - Re-checked 2026-09-23 and again 2026-09-24 via the Gitea API: #114476 still `open`, 11 comments, last comment 2025-02-26, `updated_at` 2025-10-14. Both shipped solvers are still maintained on main: `mesh_boolean.cc` last touched 2026-06-15 (header refactor), `mesh_boolean_manifold.cc` 2026-09-03. DOCUMENTED (`gh api repos/blender/blender/commits?path=…`).
  - Related notes: the "Exact" solver is a port of Zhou et al. 2016 (`zhou-grinspun-zorin-jacobson-2016-mesh-arrangements-for-soli.md`); the EMBER paper is in `ember-exact-mesh-booleans-via-efficient-robust-local-arrange.md`.

## What it is

This is the only public attempt I found to take the EMBER paper (exact plane-based mesh Booleans with fixed-width integers) and turn it into a production mesh Boolean inside a large DCC tool. It started as a replacement for Blender's slow "Exact" solver, which is a mesh-arrangements (Zhou et al. 2016) port on GMP rationals. The attempt stalled. In Trickey's words (2025-02-25): "I ended up putting the Ember solver on hold because it was turning out to be quite difficult to get a reasonable, connected mesh after the algorithm of the paper is done". https://projects.blender.org/blender/blender/issues/114476#issuecomment-1505401 DOCUMENTED.

For wonky this is the most useful negative example available for bake-off prototype 2 (the EMBER-style exact plane-based Boolean).

## How it works

### Motivation (issue body, 2023-11-03, DOCUMENTED)

Trickey names three obstacles in the old exact solver:

1. GMP rational numerators and denominators grow, which means many allocations.
2. Every face is converted to multiprecision, even faces far from any intersection.
3. The cell-based inside/outside logic is "quite complicated and somewhat slow".

The EMBER plan to get around them: 256-bit fixed-width integers, input scaled to 26-bit integers, bisecting planes down to about 20 faces per leaf, and reference points with known insideness per subproblem. https://projects.blender.org/blender/blender/issues/114476

### Bit budget (`mesh_boolean_ember.cc`, lines 51-110, DOCUMENTED)

| Constant | Value | Meaning |
|---|---|---|
| `LEAF_PROBLEM_SIZE` | 25 | Faces per leaf (a 100 variant is commented out). |
| `SIBits` | 26 | Scaled input coordinates, stored in `int32`. Differences need 27 bits. |
| `PNBits` | 2*26+3 = 55 | Plane normals, stored in `int64`. |
| `PCBits` | SIBits+PNBits+3 = 84 | Plane constant, stored in `Int128`. |
| `MaxProbBits` | 4+3*PNBits+PCBits = 253 | Homogeneous vertex coordinates, stored in `Int256`. |

The last bound follows the EMBER tech report (16·n³·d).

### Representation (DOCUMENTED, same file)

- `Plane { Int128 plane_const; int64 norm[3]; }`. `AAPlane` covers axis-aligned planes, and `PlaneChoice` is a variant of the two.
- A vertex is never stored as coordinates. `HVertex = VecBase<Int256,4>` is the homogeneous intersection of three planes: `intersect_planes` evaluates four 3×3 determinants (Cramer's rule with -d substituted).
- `classify_plane_intersect` uses Rouché–Capelli rank tests. w=0 and xyz=0 means the planes meet in a line; w=0 otherwise means no intersection.
- `HFace` = support plane + edge planes + cached hvertices. The face must be strictly convex, with outward edge-plane normals.

### Algorithm (DOCUMENTED, same file)

1. **Scale.** Scale and offset all input to 26-bit integers.
2. **Build the soup.** Each operand mesh becomes its own sub-soup.
3. **Subdivide.** `find_good_split` (line 2291) picks the largest-variance axis at the soup's centre of gravity. It adds `SVertex(1,1,1)` "to avoid symmetric degeneracies", with a TODO attached. Faces are cut with `split_face_aa` / `split_hface`. The recursion is parallel: `threading::parallel_invoke` at line 4666, and `tbb::parallel_reduce` in `DivideSubSoupBody` at line 3386.
4. **Propagate reference points.** Each new subproblem gets a reference point. Its winding-number vector (WNV, one int per operand) comes from tracing a path from the parent's reference point and counting the faces it crosses.
5. **Solve leaves.** Leaves are solved with a small BSP (`BSP_Node::add_segment`) plus a purpose-built `intersect_hfaces` triangle–triangle routine.
6. **Classify faces.** Each fragment is traced to the leaf reference point, which gives front and back WNVs (WNTV). `get_indicator(wnv, mode)` / `face_boolean_status` then keep or drop the fragment for UNION, INTERSECT or DIFFERENCE.

**Trace degeneracy handling is dithering, not symbolic perturbation** (lines 3744-3765):

- `TracePathIter` first tries orthogonal axis-by-axis paths from the face centroid. The centroid is computed in doubles and then rounded.
- It tries all 6 axis permutations × 5 dither deltas `{0,0},{2,3},{3,2},{5,7},{7,5}`.
- Then it tries non-orthogonal paths through pushed-in face corners.
- `trace_wnv` can return failure if every path hits an edge.
- Line 4002 has `/* HACK: FIXME - I need an axis that is mostly aligned ...`, with the leg axis chosen in doubles.

DOCUMENTED (code), https://projects.blender.org/howardt/blender/raw/branch/exactboolv2/source/blender/geometry/intern/mesh_boolean_ember.cc

### Output stage (where it broke, DOCUMENTED)

- Line 4991: `/* TODO: Complete redo of output stuff. */`
- `compress_and_remap_equals` (line 5209) welds vertices with an O(n²) scan using `float3` equality. Its comment says "TODO: perhaps use sorting or a VectorSet".
- `OverlapEdgeClusters` (line 5283): "This is a hack, using floating point coordinates, and that may cause problems later, in which case we can redo this to use HVertex's and lines defined by two Planes." Line 5366: "we hackily use approximate collinearity using an epsilon test".
- `repair_edge_cracks` (line 5518) splits overlapping edges and rebuilds the output each time.

The exact core therefore hands its output to float/epsilon welding, which defeats the exactness premise at the last step.

### Fixed-width integers (`BLI_fixed_width_int.hh`, DOCUMENTED)

- `UIntF<T,S>` / `IntF<T,S>` store limbs in a `std::array`.
- `Int256` is 4×u64 limbs, or 8×u32 on MSVC.
- `generic_add`, `generic_sub` and `generic_unsigned_mul` are schoolbook routines that need a double-width type for carries and products (u32→u64, u64→`__uint128_t`).
- The header still includes `<gmpxx.h>` for conversions.

### Shipped Blender solvers used as comparison (DOCUMENTED, blender/blender main)

- **"Exact" (mesh arrangements).** `mesh_boolean.cc` works on `mpq3` coordinates and builds patches, cells, `sort_tris_around_edge` and `find_ambient_cell`. `is_pwn` (line 1352) tests for piecewise-winding-number input. Non-PWN input falls back to `raycast_tris_boolean` / `raycast_patches_boolean` (lines 2734, 2806, 3595), which use BVH ray casts and are not exact.
- **Float filter in `mesh_intersect.cc`.** Burnikel–Funke–Seel semi-static filter (line 954):

  |E_exact − E| ≤ sup(E)·ind(E)·DBL_EPSILON

  Index rules: 1+max for ±, 1+i+j for ×. Constants: `index_dot_plane_coords = 15`, `index_dot_cross = 11`, `index_plane_side = 3+2*15`. `filter_plane_side` (line 1021) returns 0 ("unsure") and triggers the mpq fallback.
- **Manifold solver (`mesh_boolean_manifold.cc`).** Converts Mesh to MeshGL with runIndex/runOriginalID and back, then merges coplanar triangles back into n-gons. `clean_meshgl` (line 387) deletes triangles with out-of-range or repeated vertex indices, because this "happens sometimes in Manifold library v3.2.0" (issue #155657, https://projects.blender.org/blender/blender/issues/155657, a hang when duplicating specific geometry; closed 2026-03-14).

## Robustness and guarantees

**The exact core is exact only in the scaled space.** Trickey (#120182, 2024-04-16): "it is only exact in the space where all vertex positions are converted to 26-bit integers". His example: a cube rotated by what feels like 90° is not exactly coplanar after the rotation matrix, so the result is "an almost-zero-area face instead". https://projects.blender.org/blender/blender/issues/120182#issuecomment-1169358 DOCUMENTED.

**Ember cons as listed by Trickey** (#120182 body, 2024-04-02, https://projects.blender.org/blender/blender/issues/120182). DOCUMENTED:
- Speed tests "not all that encouraging".
- Turning the disconnected face set into a connected Mesh is "a lot more complicated than anticipated", at least efficiently.
- "T-junctions all over the place".
- "Long skinny faces (almost zero-area)".
- Input topology restrictions similar to the old exact solver.
- Fixing T-junctions "goes against the paper's desire to keep within a certain precision budget".

**Manifold, per Trickey (same comment):** a "robust float solver" that perturbs coplanar and edge–edge cases, so it can emit zero-area faces, which a cleanup pass removes. DOCUMENTED.

**Manifold, per its maintainer Emmett Lalish** (#120182). DOCUMENTED:
- Booleans on non-closed meshes are "not well-defined … the result will always be heuristic".
- His recommended workaround for open meshes: fill holes with arbitrary triangle fans tagged with a special OriginalID, run the Boolean, then delete those faces.
- `TrimByPlane` turns the plane into a large box.
- Sources: https://projects.blender.org/blender/blender/issues/120182#issuecomment-1183812, https://projects.blender.org/blender/blender/issues/120182#issuecomment-1184738

**Determinism.** Blender developers treated run-to-run determinism as a requirement (the argument being that node setups depend on element indices). Manifold was made deterministic in manifold PR #1187 (https://github.com/elalish/manifold/pull/1187). https://projects.blender.org/blender/blender/issues/120182#issuecomment-1519503 DOCUMENTED.

**Multiple solvers.** A user argues for keeping several solvers because "when one fails most of the times another succeeds". https://projects.blender.org/blender/blender/issues/114476#issuecomment-1505904 DOCUMENTED (user opinion).

## Parallelism and performance

All numbers are DOCUMENTED by Trickey in #120182, on a MacBook Pro M3 Max with 12P+4E cores unless noted.

**Sphere–sphere difference, 200k and 500k faces** (https://projects.blender.org/blender/blender/issues/120182#issuecomment-1170155):

| Solver | Time |
|---|---|
| exact (mesh arrangements) | 1281 ms |
| float | 422 ms |
| manifold | 327 ms |

The EMBER branch was never benchmarked publicly.

**sphere1024 (1,046,528 tris per sphere)** (https://projects.blender.org/blender/blender/issues/120182#issuecomment-1401115):

| Test | float | manifold | exact |
|---|---|---|---|
| sphere1024 | 580 ms* | 594 ms | 2176 ms |
| sphere1024_attrs | 956 ms* | 656 ms | 3057 ms |

\* float gives incorrect results.

Manifold phase split: Mesh→Manifold about 186 ms, Boolean 247 ms, MeshGL→Mesh 231 ms (of which face merging is 105 ms). After optimizations the manifold time dropped to 554 ms (#issuecomment-1534210). The conversion and n-gon recovery cost about as much as the Boolean itself.

**EMBER-paper protocol on Thingi10k** (1000 random pairs, 1k–100k faces, about 21k tris average; https://projects.blender.org/blender/blender/issues/120182#issuecomment-1502760), average ms:

| Solver | Difference | Intersect | Union |
|---|---|---|---|
| manifold | 15.07 | 12.22 | 17.57 |
| float | 16.70 | 16.98 | 16.43 |
| mesh arrangements | 95.52 | 92.72 | 98.46 |

No solver crashed.

**Thread scaling, difference, Thingi10k 100k–1M faces** (https://projects.blender.org/blender/blender/issues/120182#issuecomment-1515065):

| Solver | 1 thread | 12 threads | Speedup |
|---|---|---|---|
| manifold | 311.7 ms | 80.6 ms | 3.9× |
| float | 155.9 ms | 116.0 ms | 1.3× |
| exact | 1149 ms | 515 ms | 2.2× |

At 1k–100k faces, manifold saturates at about 3.7 ms from 6 threads onward.

**Short-circuiting (Lalish).** Manifold "used to have a short circuit to avoid computing the winding numbers of the non-intersecting verts, but it turned out the parallel computation … was faster" (#issuecomment-1183812, DOCUMENTED). INFERRED: EMBER's main selling point (skipping unaffected regions) matters less than uniform parallel work, which is favourable to Bend's fork-join model.

## Known failures, limitations, war stories

- **Stalled after about 3 months.**
  - 2024-02-14: "harder than I expected to get over the finish line" (#issuecomment-1123814).
  - 2024-06-18: "running into a number of hard-to-fix issues" (#issuecomment-1217246).
  - 2025-02-25: put on hold (#issuecomment-1505401).
  - DOCUMENTED.
- **Branch status at abandonment** (issue body plus code; DOCUMENTED):
  - Output was a set of unconnected faces.
  - No attribute propagation.
  - Coplanar faces not handled.
  - The output stage uses float epsilon hacks (lines 4991, 5209, 5283, 5366).
- **Traces can fail.** Trace degeneracies are handled by dithered retries (lines 3746-3765) and can still fail. DOCUMENTED (code). INFERRED: this is exactly where symbolic perturbation (SoS) would give a guaranteed answer.
- **Manifold solver limits in Blender:**
  - Errors on non-manifold input, with one special case: difference of a manifold minus a plane-like shape, done via trim (#issuecomment-1495945).
  - No self-intersecting input.
  - Occasional bad triangles from Manifold v3.2.0 (issue #155657), cleaned by `clean_meshgl`.
  - DOCUMENTED.
- **Kigumi.** pca006132 suggested unageek/kigumi (a fast exact CGAL-based solver). Trickey declined because of the CGAL dependency (#issuecomment-1499593, #issuecomment-1502754). DOCUMENTED.

## Relevance for wonky

1. **Prototype 2 (EMBER-style).** The Blender attempt shows the exact core is the easy part. INFERRED: the hard part is exact output assembly:
   - vertex identity across fragments;
   - T-junction removal and crack repair;
   - sliver faces;
   - connectivity;
   - attribute and face-ID provenance.

   Budget for these explicitly, and do them exactly: vertex identity by canonical plane triples or by hashing reduced homogeneous coordinates, and collinearity via `HVertex` plus plane-pair lines, as Trickey's own TODO suggests. Never fall back to float epsilons (that also violates the project rule "approximations need explicit tolerances").
2. **Bend fit of the arithmetic.** Int256 = 8×U32 limbs maps onto Bend. But Blender's `generic_unsigned_mul` needs a double-width product, and Bend has no u64. INFERRED: implement 16×16→32 partial products (or a mul-hi emulation over U32) and count the extra cost. With a 253-bit worst case, an HVertex coordinate is 8 limbs and a 3×3 determinant of mixed 55/84-bit entries is a fixed-shape tree. That is uniform work, which is good for GPU call trees.
3. **Filter first, then exact.** INFERRED: the Burnikel–Funke–Seel sup/index scheme from `mesh_intersect.cc` can be re-derived with the F32x2 unit roundoff (about 2^-48) instead of DBL_EPSILON. Only "unsure" results then go to multi-limb U32. Index constants must be recomputed for F32x2 error behaviour, which is not IEEE double.
4. **Parallel structure.** Bisection subdivision into about 25-face leaves is balanced fork-join if splits are balanced. Trickey's split heuristic (variance axis at the centroid, plus a TODO about degeneracies) is not balanced-by-construction. INFERRED: use median splits for Bend.
5. **Hybrid prototype 4 (analytic B-rep recovery from a tagged mesh).** Blender's Manifold integration spends about as much time on n-gon recovery and attribute remapping as on the Boolean. The same cost will show up in wonky's recovery step. Measure it separately.
6. **Open inputs must fail explicitly.** Wonky should reject open or non-PWN input with an explicit error rather than use Blender-style raycast fallbacks. This matches the project rule "unsupported cases must fail explicitly" and Lalish's position that such Booleans are heuristic.
7. **Update 2026-09-24: wonky's EMBER-style prototype got past Trickey's wall, and paid for it.** The bake-off prototype `exact-plane` (`kernel/proto/exact-plane/`, `docs/proto-exact-plane.md`) is the direct counter-experiment to this branch. DOCUMENTED (wonky docs, measured by the wonky judge round 2 on 2026-09-23); the mapping to Trickey's failures is INFERRED.

   | Trickey's blocker | exact-plane's answer (file) |
   |---|---|
   | disconnected output faces, "reasonable, connected mesh" | the arrangement cell is **one input triangle** (with axis-aligned integer bisection inside it above 16 cutting candidates), so every fragment of a triangle is built in one place; output points are sorted and deduplicated by rounded position with an exact identity check (`arrange.bend`, `assemble.bend`, `psort.bend`) |
   | "T-junctions all over the place" | every output point on the open edge of a kept piece is inserted into that edge, found and ordered with exact plane tests (support plane, edge plane, neighbouring edge planes) (`assemble.bend`) |
   | "long skinny faces (almost zero-area)" | **segment-bounded cuts**: a piece is first cut by the other triangle's edge planes through the segment ends, then by its support plane. Unbounded BSP cuts made hair-thin wedges between nearly parallel cuts of sphere tessellations that the export grid could not represent; bounded cuts removed all of them and halved the piece count (`arrange.cut_one/cut_str`) |
   | float/epsilon welding in the output stage | none: exact vertices are rounded **once** (`floor(X·2^12/W)` onto a 2^-36 mm grid, exact remainder correction), triangles are ear-clipped at strict corners with an exact flip check on the rounded coordinates and an O(m³) max-min-height fallback; any collapse or flip that cannot be avoided is a named refusal (`assemble.bend`, `finish.bend`) |
   | trace degeneracies handled by dithering | classification by an exact axis ray from a dyadic interior point; degenerate hits move to the next candidate point (2^-8, 2^-24, 2^-40 grid units), and exhaustion is `unresolved`, not a guess (`classify.bend`) |
   | u64 double-width products for `Int256` | variable-length signed Big integers in **16-bit limbs stored in U32**, so a limb product plus carry stays below 2^32 (`big.bend`) |

   Measured outcome: 36 pass + 2 expected refusals on the 38-case corpus, byte-identical across JS, native 1/18 threads and Metal. Costs, also measured: 2.5× (18 threads) to 5.6× (1 thread) slower than the Manifold-style `corefine` prototype; exact fallbacks are only 7 % of signs but about half of predicate time, because they are mostly **exact zeros** from coplanar CAD input that no float filter can certify.

   Trickey's second warning, "only exact in the space where all vertex positions are converted to 26-bit integers", reproduced exactly: exact-plane quantizes input to a 2^-24 mm grid, and under the adversarial suites that quantization **sealed rotated coplanar pockets into voids, closed 1e-9 mm gaps into point contacts and missed sub-micron skins by up to 19 %** (`docs/hybrid-boolean-plan.md` §1 and §7). The judge therefore kept exact-plane only as an independent differential oracle and chose corefine (Manifold-style symbolic perturbation) plus analytic recovery for production, the same choice Blender made. INFERRED lesson: an EMBER-style Boolean can be made to emit a clean connected mesh in Bend, but its topology is exact only relative to the quantized input; for CAD input produced by rotations, the quantization step itself decides the hard cases.

## Pointers worth porting or studying

- `mesh_boolean_ember.cc` lines 51-110: bit-budget derivation. Reuse the method, and recompute for wonky's own input quantization.
- `intersect_planes` / `classify_plane_intersect`: plane-triple vertices plus a rank classification.
- `TracePathIter` (lines 3744-3765): a clear specification of what a trace needs. Study it, then replace the dithering with SoS on the trace endpoint.
- `get_indicator` / WNV-per-operand face classification: a clean n-ary Boolean indicator.
- `BLI_fixed_width_int.hh`: schoolbook limb arithmetic as a reference for a Bend `U32xN` module.
- `mesh_intersect.cc` lines 954-1021: sup/index filter bookkeeping.
- `mesh_boolean_manifold.cc`: MeshGL run/originalID provenance and the coplanar-triangle merge. Relevant to prototype 1 and prototype 4.
- The EMBER-protocol Thingi10k benchmark (random pairs, randomized overlapping transforms). Contributed to Manifold as PR #1184 (https://github.com/elalish/manifold/pull/1184). Reuse it as wonky's bake-off harness protocol.

## Verdict: learn-from

Learn from it; do not port it. It is GPL code, it is unfinished, and its output stage relies on float epsilon hacks. As evidence it is very valuable: it pins down exactly where an EMBER-style exact Boolean costs its engineering time (output assembly and trace degeneracies, not the predicates). It also provides real timing data showing a symbolic-perturbation float solver (Manifold) beating the exact arrangements solver by about 6× with good thread scaling. Bake-off prototype 2 should adopt the EMBER numerics but must design exact output assembly from day one. Update 2026-09-24: that is what wonky's `exact-plane` did (per-triangle cells, segment-bounded cuts, exact T-junction insertion, one exact rounding with a flip check), and it produced valid connected meshes on the whole corpus. It still lost the bake-off to the Manifold-style corefine on speed (2.5-5.6×) and on quantization-induced topology changes, mirroring Blender's own decision. Keep this note as the reference for why the exact plane-based route is an oracle, not the production path.
