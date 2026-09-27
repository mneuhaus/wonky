# libfive

- Kind: f-rep (implicit-function) solid modeling kernel, standard library, bindings, and the Studio GUI.
  - Repo: https://github.com/libfive/libfive
  - Homepage: https://libfive.com. Guide: `doc/guide.md`.
  - GPU successor research: MPR (Keeter, SIGGRAPH 2020, https://www.mattkeeter.com/research/mpr/, local `tmp/research/pdf/keeter_mpr20.pdf`). Evaluation successor: Fidget (see `fidget-matt-keeter.md`).
- Clone read: `tmp/research/libfive` at HEAD `c9e9734` (2025-11-12). About 45.5k lines of C++ in `libfive/`.
- Author: Matt Keeter, 2015-2021 (README). He has 2,216 of roughly 2,350 commits; next is omgitsraven with 26.
- License (DOCUMENTED, README "License" plus file headers):
  - `libfive` core, `libfive-stdlib` and the Python bindings: **MPL-2.0**.
  - `libfive-guile` and Studio: **GPL-2.0-or-later**.
  - The GitHub API shows no SPDX id because the repo mixes licenses.
  - MPL-2.0 is file-level copyleft. Transliterating a core file such as `dc_tree.inl` into Bend would make that wonky file MPL-2.0 if ever distributed (INFERRED). Re-implementing the published algorithms (Ju et al. 2002 DC, QEF, topology-safety tests) from the papers avoids that.
  - Never take code from Studio or the Guile bindings (GPL).
- Status (DOCUMENTED, `gh api` 2026-09-22):
  - 1,666 stars (re-checked 2026-09-24), 177 forks, 116 open issues. Created 2015-12-12. Last push 2025-11-12 (Eigen-5 compile fix PR #601).
  - 2025 activity is community PR merges only. No releases; tags `rip-dmc` and `last-chance`.
  - Mature but **in maintenance mode**. The author's active work moved to Fidget.

## What it is

A CAD kernel where a solid is a closed-form scalar function f(x,y,z): f < 0 inside, f > 0 outside.
- f is an expression DAG (`Tree`) of arithmetic, min/max, transcendental ops and `Oracle` black boxes.
- It is evaluated with:
  - interval arithmetic, for spatial pruning;
  - SIMD point arrays of 256 points;
  - forward-mode derivatives;
  - a "feature" evaluator, for exact-zero ambiguity at min/max ties.
- Meshing is octree-based **manifold dual contouring** with sharp-feature QEF vertices and topology-safe cell collapse. Two experimental meshers exist, `ISO_SIMPLEX` and `HYBRID`.
- Studio is a live-coding GUI (Scheme/Python) with "direct modeling": dragging the surface solves for script variables.

## How it works

### Expression and evaluation (`libfive/src/tree`, `libfive/src/eval`)

- **`Tree`**: a hash-consed DAG.
  - `Tree::optimized()` (`tree.cpp:612`) deduplicates logically identical subexpressions via a canonical map keyed by `Data::Key`.
  - It also collapses nested affine forms into one weighted sum (an `AffineMap`).
  - `remap(x', y', z')` substitutes coordinates, which implements transforms. `flatten()` applies the pending remaps.
- **`Deck` / `Tape`**: the DAG is flattened into a linear SSA tape of clauses (`op, id, a, b`).
  - `Tape::push` (`tape.cpp:23`) walks the tape with a `KeepFunction`. For each min/max, it decides from the interval result whether only A, only B, or both branches matter. It then emits a shorter tape with `remap[id] = a|b`.
  - Child cells recurse with the pruned tape. Pruning, not raw evaluation speed, is what makes f-rep fast (the same idea as Fidget and MPR).
- **Numeric model**: everything is **float32**.
  - `Interval` wraps `boost::numeric::interval<float>` with `rounded_transc_std` and `save_state` (`interval.hpp:383`), which gives directed rounding. It carries a `maybe_nan` flag.
  - Point evaluation uses float arrays of `LIBFIVE_EVAL_ARRAY_SIZE = 256`.
  - The DC QEF math is double (Eigen `Matrix<double,N,N>`).
- **Ambiguity handling** (`eval_feature.cpp`, `feature.cpp`): at a point where f == 0 exactly and some min/max has a tie, a `Feature` is a candidate gradient plus a set of unit "epsilon" directions, i.e. the infinitesimal displacements under which this branch is the one taken.
  - `OP_MIN`/`OP_MAX` with tied values: combine both features' epsilon sets, then push `±(∇b−∇a)` to choose a branch. A feature is dropped if its epsilon set becomes infeasible (`Feature::check` tests compatibility of the displacement cone).
  - `isInside(p)` returns outside iff every surviving feature has `ε·∇ > 0` for its own gradient direction and none has the opposite (`pos && !neg`).

  This is a small, exact-in-spirit **symbolic perturbation for min/max trees**. It decides inside/outside and the set of normals at sharp edges and corners.

### Meshing: dual contouring (`libfive/src/render/brep/dc/*`)

Settings (`settings.hpp`): `min_feature = 0.1` (octree subdivision stops when the cell edge is below it), `max_err = 1e-8` (QEF collapse threshold), `workers = 8`, `alg = DUAL_CONTOURING`.

**Build phase** (`DCTree<N>`, `dc_tree.inl`), per cell:

1. `evalInterval` (L94): `intervalAndPush` over the cell. FILLED or EMPTY means a singleton leaf, and the pruned tape is passed to children.
2. `evalLeaf` (L131), at minimum size, classifies the 8 corners in three phases:
   - (1) the value's sign;
   - (2) for exact zeros that are not ambiguous, a nonzero gradient means FILLED;
   - (3) for ambiguous zeros, use `isInside` (the feature evaluator above).

   Corners already evaluated by neighbors are reused (`neighbors.check`).
3. Vertices: one per manifold patch, taken from `MarchingTable<N>::v(corner_mask)`. This means one to several vertices per leaf, which is the "manifold DC" of Schaefer, Ju and Warren 2007.
4. Edge crossings: a **4-stage × 16-point search** along each sign-changing edge (`SEARCH_COUNT=4, POINTS_PER_SEARCH=16`). That gives 16⁴ refinement, about 16 bits of the edge length. It is evaluated in batches of 16 × #edges points. Crossings shared with neighbors are reused.
5. At each bracketing sample pair, evaluate value and gradient. If ambiguous, *all* feature gradients are pushed (`eval->features`).
6. `Intersection::push` (`intersection.hpp`) normalizes the gradient n = ∇f/|∇f| and the value, then accumulates:
   - `AtA += n nᵀ`;
   - `AtB += n·b` and `BtB += b²`, where `b = n·p − f(p)/|∇f|` (a first-order correction for sampling off the surface);
   - a mass point.
7. **Rank** = number of eigenvalues of AtA above `EIGENVALUE_CUTOFF = 0.1` (`dc_flags.hpp`). The mass point averages only the intersections of maximal rank ("DC: The Secret Sauce").
8. `findVertex` (L740): eigen-decompose AtA and zero the eigenvalues below 0.1. Then
   - `v = pinv(AtA)·(AtB − AtA·c) + c`, with c the mass point;
   - `error = vᵀ AtA v − 2vᵀ AtB + BtB`.

   The vertex **may leave its cell**.

**Collapse phase** (`collectChildren`, L581). The parent of 8 leaf children becomes a single-vertex leaf iff all of the following hold:
- no child is a branch;
- `cornersAreManifold(mask)`, a 256-entry table (`dc_tree3.cpp:112`, generator script in the comment);
- all children are manifold;
- `leafsAreManifold` holds: Ju et al. 2002's three sign-agreement tests on the coarse edge, face and cube midpoints (`dc_tree3.cpp:17`);
- the QEF error is below `max_err`;
- the vertex lies inside the cell (tolerance 1e-6);
- `|f(v)| < max_err`.

The QEFs of children are summed. The rank is the max of the children's ranks.

**Output phase** (`dc_mesher.cpp`):
- For every minimal octree edge with a sign change, the 4 incident cells give one quad (`load<A,D>`). The vertex is chosen per patch when the leaf is at level 0.
- The quad is split along the diagonal whose corner normals agree more (`norms[0]·norms[3] > norms[1]·norms[2]`). Degenerate triangles are skipped.
- `DCMesher` produces a `Mesh` with `branes` (triangles). Work is distributed over a lock-free-ish worker pool (`worker_pool.inl`, atomics on child counters `pending`).

**ISO_SIMPLEX / HYBRID** (`render/brep/simplex`, `render/brep/hybrid`):
- The octree cells are subdivided into simplices, with a QEF per subspace (vertex, edge, face, cell: 3^N subspaces per leaf, shared via ref-counted `SimplexLeafSubspace`).
- Vertices are constrained to their subspace, which prevents self-intersection but loses sharp features. The author calls both "mostly for my personal debugging" (issue #284).

### Other kernel pieces

- **Direct modeling solver** (`solve/solver.cpp`): `findRoot` does gradient descent on the free variables v to drive f(p; v) → 0 at the dragged point p.
  - Gradients come from a `JacobianEvaluator` (∂f/∂v). There is a backtracking line search with the Armijo condition, `EPSILON = 1e-6`, and a `gas` iteration budget.
- **stdlib** (`stdlib/stdlib_impl.cpp`):
  - `offset(a,r) = a − r`, `clearance`, `shell(a,t)`;
  - `blend_expt(a,b,m) = −log(e^{−ma} + e^{−mb})/m`, a global exponential smooth-min;
  - `blend_difference`, `morph` (linear interpolation of fields), `loft` (z-interpolated);
  - both `box_mitered` and `box_exact`, since min/max boxes are not true SDFs, so offsetting them gives mitered rather than rounded corners.

## Robustness and guarantees

- **Claimed** (mkeeter, issue #150 and #284): DC output is manifold, watertight, hierarchical and sharp-feature preserving. It is **not self-intersection free**: "DC will have self-intersections", the "whole Dual Contouring family" has this problem. Ju's intersection-free paper was "on my list" and never merged.
  - The `dc-vertex-sliding` branch was an attempt.
- **Input requirement**: f must be C0-continuous. Discontinuities break the inside/outside concept, for example the `atan` branch cut gives "crazy wings" (issue #359).
- **Heuristic tolerances everywhere**:
  - eigenvalue cutoff 0.1 on normalized normals;
  - collapse error 1e-8;
  - cell containment 1e-6;
  - gradient norm floor 1e-12;
  - fixed 16⁴ edge search depth;
  - `Feature` duplicate test `e·i > 1 − 1e-8`.

  There is **no certified bound** on the Hausdorff distance between the mesh and the zero set, and features smaller than `min_feature` can vanish.
- **Resolution depends on the bounding box, not on units** (issue #562, open): `Region::withResolution` derives the octree depth from the *smallest* bbox dimension, so changing the bounds changes the mesh quality. In one report a cube-minus-cube meshes broken or fine depending only on the bounds.
- **Interval arithmetic is conservative** only thanks to directed rounding (boost `save_state`). Pruning is exact in the sense of never dropping a needed branch; ties are left to the feature evaluator.

## Parallelism and performance

- **Meshing**: an octree work-stealing pool with `workers` threads (default 8). Subtrees are independent; parents are collapsed bottom-up via atomic `pending` counters. The CHANGELOG notes "Much faster meshing, which uses thread more effectively".
- **Rendering baseline** (DOCUMENTED, Fidget README via `fidget-matt-keeter.md`), 2D/3D rasterization on an M1 Max:
  - libfive 66.8 ms at 1024³, 127 ms at 1536³, 211 ms at 2048³;
  - Fidget JIT 23.6/45.4/77.4 ms;
  - MPR on a GTX 1080 Ti 22.6/39.3/60.6 ms.

  libfive is 3× slower than the JIT/GPU successors.
- No published meshing benchmark numbers were found in the repo or docs (INFERRED: absent).
- Issue #550: "Unioning nothing at the top level causes things to mesh very slow". This is a pruning pathology where an `EMPTY` operand defeats tape simplification.

## Known failures, limitations, war stories

- #150, #284: self-intersecting triangles and "garbage polygons … doubled up" at sharp edges, from DC vertices escaping their cells. FreeCAD's mesh checker flags libfive STLs (#284 comment).
- #562: resolution coupled to bbox size (open since 2024-02, confirmed 2025).
- #359: discontinuous functions (atan branch cut) produce spurious sheets.
- #579, #586, #543, #166: crashes and double frees in DC or at Mesh destruction via the C API. #290: a SimplexTree collapse bug that depends on the compiler.
- #209 (26 comments): generalized sweeps were never implemented in closed form, a known f-rep weakness for CAD.
- There is no exact B-rep, no STEP, and no analytic face identity. A mesh is the only exportable geometry.

## Relevance for wonky

**Main use: the reference for the "libfive-style SDF with dual contouring" bake-off prototype.** It also serves as a source of offset and shell semantics.

1. **Evaluation**: Fidget supersedes libfive's evaluator: same interval-pruned tape idea, better engineered. Port from the Fidget note.
   - libfive-specific extra worth keeping: the **`Feature` epsilon-cone evaluator**, i.e. exact inside/outside at f == 0 on min/max ties, plus the list of normals at sharp edges. It is small, deterministic and branchy but local, and fits a pure Bend function over a tape (INFERRED).
2. **Meshing to port conceptually** (this is where libfive is still the reference):
   - The QEF accumulation is a fixed-size pure reduction: `AtA` (6 unique floats), `AtB` (3), `BtB` (1), mass point (4). It is associative, so octree collapse is a balanced **fork-join sum**, a perfect Bend fit.
   - The 3×3 symmetric eigen-solve plus truncated pseudo-inverse is a fixed Jacobi iteration. It is uniform GPU work in F32. F32x2 is only needed for large coordinates; QEFs should be in cell-local coordinates anyway (INFERRED).
   - `cornersAreManifold` is a 256-bit table, i.e. 8 U32 words.
   - The Ju 2002 midpoint sign checks and the marching tables are table lookups, so U32-friendly.
   - The 16-point × 4-stage edge search is uniform batched evaluation, which is GPU-ideal. It is fixed-depth, hence data-independent control flow.
3. **Gaps wonky must close to meet its rules**:
   - (a) **self-intersections**: adopt vertex clamping to cells or the Ju intersection-free variant, or accept the ISO_SIMPLEX trade-off. Any mesh that feeds a Boolean must be intersection-free (see the Cherchi note's input contract);
   - (b) **explicit tolerances**: replace the magic constants with a certified bound, for example interval-evaluated |f| over each output triangle plus a Lipschitz bound, giving a Hausdorff bound. This is compatible with wonky's "certified deviation" print mesh (INFERRED);
   - (c) **resolution in absolute units** (mm), not bbox-relative (#562);
   - (d) **no directed rounding on Metal**: interval F32 must widen results by 1 ulp per op (nextafter-style) or use F32x2 with explicit error terms (INFERRED).
4. **Offsets, shells, clearances, blends**: trivially exact on true SDFs (`f − r`), but only a *distance bound* after min/max CSG. libfive itself needs `box_exact` vs `box_mitered`. For FDM clearances such as `clearance(a,b,0.2)` this matters: with non-exact fields the clearance is not uniform. `blend_expt` is a global smooth-min, not a CAD constant-radius fillet, so it cannot replace B-rep fillets (INFERRED).
5. **Direct modeling solver**: a small, portable idea for LLM and interactive ergonomics. Given a picked surface point and a target, solve the script parameters by gradient descent on ∂f/∂params. Wonky's FeatureScript parameters could be solved the same way against its exact B-rep distance queries (INFERRED).
6. **Not a production path** under wonky's rules: there is no exact geometry, no analytic identity, and meshing-only export. Keep SDF as a preview, offset or robust-fallback track and as a bake-off baseline.

## Pointers worth porting or studying

- `libfive/src/render/brep/dc/dc_tree.inl`:
  - `evalLeaf` (L131): 3-phase corner classification, 4×16 edge search;
  - `collectChildren` (L581): topology-safe collapse criteria;
  - `findVertex` (L740): truncated pseudo-inverse QEF plus rank.
- `libfive/include/libfive/render/brep/dc/intersection.hpp`: QEF accumulation with the `f/|∇f|` correction.
- `libfive/src/render/brep/dc/dc_tree3.cpp`: `leafsAreManifold` (Ju 2002 midpoint tests), `cornersAreManifold` (table plus generator).
- `libfive/src/render/brep/dc/dc_mesher.cpp`: dual quad emission across octree levels ("look at corners of the smallest cell") and the normal-based diagonal choice.
- `libfive/src/eval/eval_feature.cpp` (L171 onward) and `feature.cpp`: epsilon-cone feature propagation through min/max.
- `libfive/src/eval/tape.cpp:23`: tape push and pruning.
- `libfive/src/tree/tree.cpp:612`: hash-consing plus affine collapse.
- `libfive/src/solve/solver.cpp`: parameter solve for direct manipulation.
- Papers: Ju, Losasso, Schaefer, Warren 2002 "Dual Contouring of Hermite Data" (`tmp/research/pdf/ju_dc02.pdf`); Schaefer, Ju, Warren 2007 "Manifold Dual Contouring" (`pdf/schaefer_mdc_tvcg07.pdf`); Keeter 2020 MPR (`pdf/keeter_mpr20.pdf`).

## Verdict: learn-from

libfive is the canonical, battle-tested reference for f-rep meshing: manifold DC, QEF rank tricks, topology-safe collapse, and feature-aware inside tests. Wonky's SDF bake-off prototype should reproduce its pipeline shape.

But:
- evaluation is superseded by Fidget;
- the MPL-2.0 core should be re-implemented from the papers rather than transliterated;
- its known self-intersections and uncertified tolerances violate wonky's rules unless fixed;
- it offers no path to exact B-rep or STEP.
