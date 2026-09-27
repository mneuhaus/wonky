# verified-3d-mesh-intersection (Lean 4)

- Kind: library + web demo (formally verified exact 3D mesh intersection). Canonical: https://github.com/schildep/verified-3d-mesh-intersection . Demo: https://schildep.github.io/verified-3d-mesh-intersection . Predecessor (2D): https://github.com/schildep/verified-polygon-intersection (MIT, 48 stars, 2026-05).
- Authors: P. Schilde (single committer `schildep`), with Claude Opus 4.8 and Fable 5 agents writing implementation and proofs (DOCUMENTED, README "Development"). 2026.
- License: MIT (DOCUMENTED, `LICENSE`, `gh api` spdx=MIT). Porting implication: code and algorithm may be transliterated into wonky with the MIT notice kept. A Bend port loses the Lean proof: the guarantee does not travel with the code, only the case analysis does.
- Status: one squashed commit "initial release" `c537025f` (2026-07-27), last push 2026-08-01 (re-checked 2026-09-24: no new commits), 106 stars, 2 forks, 1 open issue (#1 "Which 93 lines constitute the spec?"). Lean `v4.15.0` + Mathlib (DOCUMENTED, `lean-toolchain`, `gh api repos/schildep/verified-3d-mesh-intersection`). Clone read: `tmp/research/verified-3d-mesh-intersection-lean-4/repo`. Nothing was built (benchmark running).

## What it is

An exact rational triangle-mesh intersection `meshIntersect : Mesh → Mesh → Mesh` with a machine-checked proof that, for well-formed inputs, `solid (meshIntersect M₁ M₂) = solid M₁ ∩ solid M₂` and the output is itself well-formed. A wrapper `meshIntersectWithPreconditionCheck : Mesh → Mesh → Except String Mesh` decides well-formedness of both inputs at runtime and returns one of four canonical error strings. Four theorems specify it (DOCUMENTED, `CSG/MeshIntersectWithPreconditionCheck.lean`):

- `_ok_spec`: an `ok M` result implies `solid M = solid M₁ ∩ solid M₂ ∧ WellFormedMesh M`, with no hypotheses on the inputs.
- `_ok_of_wellFormed`: well-formed inputs are always accepted.
- `_error_sound`: an error names a condition that at least one input really violates.
- `_error_of_not_wellFormed`: any ill-formed input produces an error.

All four depend only on the axioms `[propext, Classical.choice, Quot.sound]` (DOCUMENTED, README "Building and checking").

Size (DOCUMENTED by `wc -l`):
- Trusted spec: 4 files, "93 lines" excluding comments and imports; the author concedes 101 with imports (issue #1 reply).
- Implementation (`CSG/Impl/`): 2 353 lines. `MeshIntersect.lean` 1 168, `BVH.lean` 585, `WellFormedCheck.lean` 560, wrapper 40.
- Proofs (`CSG/Proof/`): about 100k lines in total. The README's "over 60,000" undercounts the current tree.
- Only **intersection** is implemented and verified. There is no union or difference (DOCUMENTED by grep: no such op in `CSG/Impl`, `Web.lean` or the web UI).

## How it works

### Specification semantics (`CSG/Def.lean`, trusted)

- `Point = Fin 3 → ℚ`, `Triangle = (v₀,v₁,v₂)` oriented by winding, `Mesh = Array Triangle` (a triangle soup; no indexed vertices).
- `faceNormal t = (v₁−v₀)×(v₂−v₀)`.
- `AdmissibleRay M Q d` means `d ≠ 0` and the open ray `Q + s·d, s > 0` avoids every face's `edgeSet`, so every face it meets is crossed transversally in its relative interior.
- `crossingCount M Q d = Σ_faces hit sign(⟨faceNormal, d⟩)`.
- `solid M = {Q | ∀ admissible d, crossingCount ≠ 0}`. This is the open convention: the surface is not in the solid.
- `WellFormedMesh` is the conjunction of four conditions:
  1. `IsClosedOrientedSurface`: the directed-edge multiset equals its swap. Each `a→b` occurs as often as `b→a`, so multiplicity 2, 4, 6 … along an edge is allowed. Edges subdivided differently on the two sides do NOT match, which forbids T-junctions.
  2. `WindingZeroOrOne`: every admissible ray from every point counts 0 or 1.
  3. `NoFaceInteriorContact`: two distinct triangles meet only inside their edge sets.
  4. `NoDegenerateFaces`: `faceNormal ≠ 0`.

  Together these allow self-touching along edges and vertices, not in face interiors. The README shows why this relaxation is forced: the exact intersection of two rotated "cubes with holes" is non-manifold at a point, so "If we imposed a manifoldness condition, no algorithm would be able to satisfy our specification" (DOCUMENTED, README "Why we cannot have manifold output meshes").

### Numeric model (`CSG/Impl/MeshIntersect.lean`)

Every quantity is an exact number: Lean `Rat` (always normalized, so value equality is field equality) and `Int` (arbitrary precision). There are no floats: "using hardware-accelerated floats would require additional axioms" (README "Performance").

Each vertex carries two representations:
- `P3`, three normalized rationals.
- A homogeneous integer mirror `H4 = (x,y,z,w)` with `w > 0` equal to the lcm of the three denominators (`toH4`).

Planes are `IPlane (a,b,c,d)` meaning `a·x+b·y+c·z−d`, integer-cleared. Two canonical keys exist:
- `primDir` divides by the gcd and keeps the sign: the oriented plane key.
- `prim` also normalizes the sign of the first nonzero entry: the unoriented key.

`iFacePlaneH` computes a face's carrier from the H4 mirrors. The docstring gives the scaling proof `(a,b,c,d) = λ·(n, ⟨n,V₀⟩)` with `λ = w₀³w₁w₂ > 0`. All sign tests are `evalI g q = a·qx + b·qy + c·qz − d·qw`.

### Pipeline (`meshIntersectPre`, lines 1087-1161)

The pipeline is symmetric in A and B:

1. **Prep** (`prepOf`): materialize faces, precompute `PFace` (the normal `nrmI`, edge vectors `e01, e12, e20` and `nd0 = ⟨nrmI, h0⟩`), and build one BVH per mesh that serves every query.
2. **Candidates**: for each face, a BVH box query against the opponent, then an exact `boxesOverlap` filter.
3. **Candidate-free clustering** (`clusterFree`): faces with no candidate are grouped by BFS over reversed directed edges (hash map keyed by exact coordinates). The opponent winding is constant over such a component, so **one ray cast per component** classifies all of its faces.
4. **Scoped clipping** (`clipFaceScoped`, `planesForScoped`, `scopeBoxSEG`): each face, as a convex fragment, is cut successively by the carrier plane of every candidate opponent face.
   - Each cut is scoped to the AABB of `tri(g) ∩ plane(P)` (its "section points") and skipped when the fragment's AABB is disjoint from that box. Without scoping, an unbounded carrier plane would slice the whole face along a chord line.
   - Candidates strictly on one side of P are dropped (`dropByPlane`).
   - `clipFrag` is a one-pass Sutherland-Hodgman-style walk. Zero-sign vertices go to both sides, and a strict sign change computes `cutVtx` with `t = (Ea·wB)/(Ea·wB − Eb·wA)`, all-integer until the final rational.
5. **Classification**. Faces whose unoriented carrier key appears among the opponent's (`memPrim`: binary search over sorted `prim` keys) are *coplanar*; their fragments go to step 6. All other fragments are kept iff the opponent winding at the fragment's vertex centroid equals 1 (`keepFragB`).
6. **Coplanar resolution** (`resolveCoplanar`, `resolveFrag`, `coplanarClip`). A 2D convex Boolean by successive clipping against the opponent fragment's *lifted edge half-planes*: planes perpendicular to the carrier through each directed edge, with the interior on the non-positive side (`edgePlane`).
   - A same-orientation overlap is kept once, as the M₁ copy (the M₂ side drops it, `resolveFragB`).
   - An opposite-orientation overlap is dropped on both sides. This is the zero-volume touching case; the README says many tools "randomly produce double-membrane artifacts" there.
   - Uncovered leftovers use the winding fallback.
   - It is order-independent because `NoFaceInteriorContact` of the opponent forbids overlapping coplanar opponent fragments.
7. **Atomization / seam repair** (`vertexUniverse`, `hitsOnB`, `atomizeFragB`). Collect all kept fragment vertices, sort them lexicographically and deduplicate by exact equality. Then split every kept polygon edge at every universe vertex strictly inside it: a BVH query with the edge box, an exact collinearity test `(v−a)×(b−a) = 0`, and strict betweenness `0 < ⟨u,w⟩ < ⟨u,u⟩`, ordered by the exact parameter. "No new coordinate values are created, so one pass suffices."
8. **Emission** (`emitFrag`):
   - A polygon that is still a bare triangle is emitted as is.
   - A polygon with more than 3 vertices is fanned from its **vertex average** (a new Steiner point), not from a polygon vertex. Fanning from a vertex "would absorb subdivision points asymmetrically and re-break the edge balance".
   - Triangles with repeated vertices are dropped, which is cycle-neutral.

### Point classification without perturbation (`windingAtH`, `rayFaceCrossW`)

- Ray directions come from the moment curve `d_j = (1, j, j²)`, `j = 0, 1, 2, …`. The Vandermonde determinant of any three is nonzero, so no three are coplanar and each opponent edge line can be grazed by at most two directions.
- Per face the test is exact integer arithmetic:
  - `Dn = ⟨n, d⟩` and the signed plane offset `N`.
  - The fast path uses three wedge triple products `W_k = ⟨(V_k − Q) × E_k, d⟩` (sign-equivalent to the edge tests).
  - If any `W_k = 0`, an exact hit-point fallback (`edgeDetsI`) decides between a clean crossing, a graze (`none`, so reshoot), and a miss.
- The first graze-free direction wins. The fuel is `16·|W| + 16` attempts, and the result is 0 on exhaustion, which only happens for degenerate faces.
- `d = (1,0,0)` has a specialized cheaper kernel (`rayFaceCrossW1`) because it succeeds almost always.
- This is a deterministic, randomness-free replacement for Simulation-of-Simplicity-style perturbation (INFERRED characterization).

### Well-formedness check (`CSG/Impl/WellFormedCheck.lean`)

A short-circuit cascade whose order matters for the proofs:
1. `checkIsCycle`: a hash map of signed directed-edge counts, all zero.
2. `checkNonDegenerate`: `nrmI ≠ 0`.
3. `checkNoSelfIntersection`: BVH-enumerated box-overlapping face pairs, each decided by the exact `triPairOK`. The non-coplanar case uses dominant-axis interval overlap of the two triangles' sections on the plane-plane line; the coplanar case uses SAT.
4. `checkNormalCond`: per face, **one** ray from the face barycenter. The face itself contributes 0 for a transverse `d`, so the count `w` is the winding on the side `d` points to, and the other side is `w ± 1` depending on `sign⟨n,d⟩`. Both must lie in {0,1}.

### BVH (`CSG/Impl/BVH.lean`)

- Node boxes are stored as **outward-rounded dyadic mantissas on an anchored grid**: `a + m·2^e`, with anchor `a` = the root lo corner and `e` chosen so the root span fits in `cellBits = 24` bits.
- Queries therefore return supersets, and leaves are decided exactly.
- Build order is Morton with `mortonBits = 21` per axis (63-bit keys). All recursion is structural on Nat fuel.
- The scheme is translation-equivariant (DOCUMENTED, header comment).

### Legacy chain formulation (`CSG/Legacy/`, not used at runtime)

This is Feito & Rivero, "Geometric modelling based on simplicial chains", Computers & Graphics 22(5), 1998, https://doi.org/10.1016/S0097-8493(98)00067-3.
- Each triangle defines the origin-apex tetrahedron `simplex t`.
- A solid is an integer-weighted chain whose characteristic function is the weighted sum of tetrahedron memberships.
- Intersection is the product chain: for every pair `(sᵢ, tⱼ)`, emit the origin-apex triangulation of `simplex sᵢ ∩ simplex tⱼ` weighted `aᵢ·bⱼ` (`CSG/Impl/Legacy/ChainIntersectionAlgorithm.lean`, a 5-line flatMap).
- Correct only "off finitely many planes" (`EqOffPlanes`), and it produced overlapping triangles. That is why the author moved to the mesh spec (DOCUMENTED, README "Development").

## Robustness and guarantees

- **Proven** (DOCUMENTED): solid equality and output well-formedness for all inputs that pass the check, plus a sound and complete precondition check. It is also total and panic-free: index accesses use `getD`, and `Rat` division by zero is defined as 0 ("Ill-formed inputs flow through; they simply carry no theorem", `MeshIntersect.lean` header).
- **Not proven or not specified** (DOCUMENTED, README "Comparison to vibecoding"): runtime complexity, and triangulation quality ("may produce a mesh that is finer than necessary").
- **Trust caveats**:
  - `Web.lean` string (de)serialization is trusted glue with no proof.
  - The README asks reviewers to `rg 'implemented_by|extern|csimp|…'` to make sure the compiled code is the verified code.
  - The compiled WASM relies on Lean's compiler being correct. The kernel checks the definitions, not the emitted C/WASM (INFERRED; standard Lean caveat).
- **Semantics subtlety**: `solid` is a set of *rational* points and uses "every admissible ray". It is equivalent to "some admissible ray" for well-formed meshes (`solid_eq_exists_ray` in `CSG/Example.lean`, referenced from `Def.lean`).
- **Coordinate growth** (INFERRED from the code):
  - Cut vertices are canonical rationals, each the intersection of a carrier plane with two further planes (opponent carriers or input edges), so their size is bounded by a Cramer determinant of input data.
  - The fan apex (vertex average of up to r such points) is *not* a three-plane point, and its denominator is up to the lcm of r denominators.
  - Feeding outputs back as inputs (chained Booleans) therefore grows coordinate size without bound. There is no snap rounding.
- **LLM comparison** (DOCUMENTED, README): an Opus-written C++ equivalent built from an informal spec had 3 reproduced bugs:
  1. A vertex lying on both an edge of one part of the mesh and a face of the other mesh.
  2. Cascades of ray tests all hitting triangle edges.
  3. A large face cut by several small features.

  All "almost impossible to catch by black box testing".

## Parallelism and performance

- 24 s, single-threaded on an M4 Pro, for the exact intersection of two closed 70k-triangle Stanford bunnies. The input well-formedness check "makes up a substantial fraction of the total runtime" (DOCUMENTED, README "Performance"). No other numbers are published.
- Sequential by construction (folds, `Id.run do` loops with mutable hash maps in `clusterFree`). The face-major loop (clip, then classify per face) is embarrassingly parallel, and so are the per-fragment winding casts and the per-edge atomization queries (INFERRED).
- The legacy Feito-Rivero product chain is O(n·m) independent pair kernels, which gives perfectly uniform work (INFERRED).

## Known failures, limitations, war stories

- Intersection only. Difference and union cannot be expressed by complementing an input: a flipped mesh has winding −1 inside and fails `WindingZeroOrOne` (INFERRED from `Def.lean`).
- Rejects non-watertight input: the original Stanford bunny had to be closed first (DOCUMENTED).
- Output can be non-manifold at edges and vertices (4 faces on one edge) by design. Downstream consumers that require 2-manifolds (slicers, half-edge structures) must handle this (DOCUMENTED + INFERRED).
- Output is over-refined: every polygon with more than 3 vertices becomes a centroid fan (DOCUMENTED, `emitFrag`).
- Issue #1 (https://github.com/schildep/verified-3d-mesh-intersection/issues/1): a reader could not reproduce the "93 lines" claim. The author's answer: 93 lines of Lean without comments and imports (101 with imports), relying on trusted Mathlib definitions (`convexHull`, `segment`, `Multiset`). The trusted base therefore includes Mathlib's definitions, not only those lines.
- Code quality: every Impl/Proof file carries a "generated by AI and never reviewed by a human" header (added by `scripts/ensure_ai_caution_header.py`). Comments in them may be wrong (DOCUMENTED).

## Relevance for wonky

- **Test oracle (strongest fit).** The four `WellFormedMesh` conditions plus winding-based `solid` membership are a complete, precise definition of "a valid tagged-mesh Boolean result". wonky's bake-off prototypes (Manifold-style, EMBER-style, analytic recovery) should all be graded by a Bend port of `checkMeshWF` plus a point-membership comparison `winding(out, Q) == [winding(A,Q) op winding(B,Q)]` on sampled rational points. That is stronger than vcad's volume heuristics. The checks are exact integer predicates: directed-edge balance, exact normal, exact triangle-pair contact, and one barycenter ray per face.
- **Reference implementation.** The 1 168-line `MeshIntersect.lean` is a complete, proven-correct case analysis for exact mesh intersection. It covers coplanar same and opposite overlaps, vertices on faces, rays through edges, T-junction repair, and BVH boundary inequalities. Transliterating it to Bend yields a slow but correct reference Boolean for differential testing. Generalize the keep rules for difference and union carefully, because those are unverified (INFERRED).
- **Precision mapping to F32/U32** (INFERRED):
  - Input F32 coordinates are dyadic rationals. Put them on a common integer grid (for example a 2^-20 mm unit with a ±2^11 mm range, which gives 32-bit integers).
  - Carrier normals are then about 65 bits and offsets about 98 bits.
  - A three-plane cut vertex in homogeneous form has numerators around 230 bits and a denominator around 200 bits.
  - A plane sign test at such a point needs about 300 bits, which is 10 U32 limbs. That is bounded and uniform, so it suits multi-limb U32 in Bend.
  - Two things break the bound: the centroid-fan apex and chaining. Keep outputs as convex polygons (plane-based, as in EMBER or Bernstein-Fussell), triangulate only at export, and snap-round between chained operations with an explicit, checked tolerance.
  - Rationals need canonical form for dedup and hashing. In Bend, use exact cross-multiplied comparison for sorting and equality, and avoid gcd normalization in the hot path.
- **Deterministic ray casting.** The moment-curve direction sequence `(1, j, j²)` with an exact graze test and reshoot is a clean fit for Bend: no RNG, no perturbation bookkeeping, a bounded retry loop. On the GPU the common `d = (1,0,0)` path is uniform, and divergence occurs only on rare grazes.
  - hypermesh (`sources/hypermesh-hyperreal-hyper-stack-under-csgrs.md`, `seed_surface_cell_winding`) converged on the same family independently: axis rays first, then `(1, t, t²)` with an explicit finite candidate budget.
  - Two unrelated exact Booleans chose the same scheme, which supports adopting it in wonky (INFERRED).
- **Scale reference.** This verified intersector takes 24 s for 70k × 70k triangles. hypermesh's unverified exact arrangement takes 48 s for 12k × 12k, and CGAL EPECK 0.09 s (both DOCUMENTED in their sources, different machines). Exact-rational Booleans without lazy filters are 2-3 orders of magnitude off CGAL (INFERRED).
- **BVH design.** Conservative node boxes on a 24-bit-mantissa dyadic grid with 21-bit-per-axis Morton keys map one-to-one onto F32 boxes rounded outward (conservative) and two U32 Morton words. Exact tests happen only at leaves. This is the right split for Bend: F32 for culling, multi-limb only for decisions.
- **Candidate-free clustering.** One classification per connected component of untouched faces is a large practical saving for the tagged-mesh Boolean. It applies to wonky's print mesh, where most faces of a part are far from the cut.
- **Non-manifold output is legitimate.** wonky's B-rep and STEP export must represent edge-touching results (multiplicity-4 edges) or reject them explicitly. It must not "fix" them silently. For FDM, flag them, because two bodies touching along an edge slice ambiguously.
- **LLM ergonomics.** The workflow is: a small human-owned spec, agent-written implementation and proof, general position first and then removed, and milestones that grow the spec. That is a template for how wonky could use agents on Boolean code. Lean itself cannot run in Bend, but the discipline of spec-as-oracle transfers to property tests.

## Pointers worth porting or studying

- `CSG/Def.lean` (all of it, about 60 lines): the definitions of solid and well-formedness to adopt verbatim as wonky's mesh-validity contract.
- `CSG/Impl/MeshIntersect.lean`:
  - `iFacePlaneH`: integer carrier planes with the scaling proof in the docstring.
  - `clipFrag`: zero-sign vertices go to both sides.
  - `cutVtx`.
  - `rayFaceCrossW` / `rayFaceCrossW1` / `edgeDetsI`: exact ray-triangle crossing with graze detection.
  - `windingAtH`: moment-curve reshoot.
  - `scopeBoxSEG` / `clipFaceScoped`: scoped plane cuts.
  - `coplanarClip` / `resolveFrag`: the coplanar keep-one or drop-both rule.
  - `clusterFree`.
  - `hitsOnB` / `atomizeFragB`: one-pass T-junction saturation.
  - `emitFrag`: why a centroid fan and not a vertex fan.
- `CSG/Impl/WellFormedCheck.lean`:
  - `checkIsCycle`.
  - `triPairOK`: the exact triangle-triangle interior-contact test.
  - `faceSideWindings`: both side windings from one ray.
- `CSG/Impl/BVH.lean`: `mboxOfBox`, `gridExp`, `cellBits`, `mortonOrderM` (dyadic outward-rounded boxes).
- README sections "Special cases" and the three C++ bugs. Turn each into a wonky torture case.
- Feito & Rivero 1998 (`CSG/Legacy/ChainDef.lean`): the origin-apex simplicial chain model as a uniform-work O(nm) GPU formulation worth knowing.

## Verdict: adapt

Adapt it as wonky's **mesh-validity contract and slow exact reference Boolean**. Port `Def.lean`'s conditions and the `checkMeshWF` cascade to Bend as the grader for every bake-off prototype. Transliterate `meshIntersect` (MIT) onto multi-limb U32 integers for differential testing on grid-snapped inputs. Do not use it as the production Boolean:
- Rationals.
- Intersection only.
- 24 s per 70k-triangle pair.
- Unbounded coordinate growth when chained, caused by the fan apex.
- The proof does not survive the port.
