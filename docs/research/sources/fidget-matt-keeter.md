# Fidget (Matt Keeter)

- Kind: library (Rust workspace) for closed-form implicit surfaces.
  - Canonical: https://github.com/mkeeter/fidget
  - Other URLs:
    - Writeup: https://mattkeeter.com/projects/fidget
    - Demo: https://mattkeeter.com/projects/fidget/demo
    - Docs: https://docs.rs/fidget
    - MPR paper: https://www.mattkeeter.com/research/mpr/ (PDF in `tmp/research/pdf/keeter_mpr20.pdf`)
    - Adversarial meshing blog: https://www.mattkeeter.com/blog/2023-04-23-adversarial/
- Clone read: `tmp/research/fidget` (shallow, HEAD `0c89e87e`, 2026-09-12, "Lazy compute pipeline construction (#492)").
- Author/org: Matthew Keeter, sole author. The GitHub API lists 8 contributors in total. Repo 2022-06 to 2026-09. MPR paper: M. J. Keeter, "Massively Parallel Rendering of Complex Closed-Form Implicit Surfaces", ACM TOG 39(4), Article 141, SIGGRAPH 2020.
- License: MPL-2.0 (DOCUMENTED, `LICENSE.txt` plus README; issue https://github.com/mkeeter/fidget/issues/460 confirms that the license text includes "Exhibit B" (the SPDX text keeps it), and the author says the repo is correct as is).
  - MPL is file-level copyleft. Translating a Fidget source file into Bend makes that file MPL-covered, and its source must be offered if wonky is ever distributed.
  - Re-implementing the ideas (tapes, interval pruning, the MPR algorithms, Manifold Dual Contouring) carries no obligation.
- Status (DOCUMENTED, `gh api repos/mkeeter/fidget`, re-checked 2026-09-24):
  - active; 494 stars, 42 forks, 23 open issues;
  - 1,356 commits, last push 2026-09-12;
  - releases: v0.5.0 (2026-08-03) and v0.4.1-0.4.3 (2026-04-26); `CHANGELOG.md` has an unpublished 0.5.1 section;
  - the newest issue is #494 (2026-09-23), "Consider using `fearless_simd` for VM evaluator".
  - The 0.5.1 GPU work was co-designed with Halfspace (https://github.com/mkeeter/halfspace) to move rendering fully onto the GPU for the web (CHANGELOG).
- LLM policy (DOCUMENTED, README "LLM usage"): no LLM-written non-trivial code. LLMs are used only for review and brainstorming, and v0.4.1 is recommended for anyone avoiding "LLM taint". This is rare among the sources in this batch.
- Size (DOCUMENTED, `wc -l` of `.rs`/`.wgsl` per crate):

  | Crate | Lines |
  |---|---:|
  | fidget-core | 14,570 |
  | fidget-wgpu | 8,614 |
  | fidget-jit | 8,001 |
  | fidget-mesh | 3,180 |
  | fidget-raster | 2,291 |
  | fidget-rhai | 1,927 |
  | fidget-shapes | 1,418 |
  | fidget-solver | 636 |
  | fidget-bytecode | 481 |

## What it is

"Experimental infrastructure for complex closed-form implicit surfaces". A shape is a scalar expression f(x,y,z) with f < 0 inside. Fidget covers the path from expression to evaluation, rendering and meshing:

- hash-consed expression graphs;
- flattening into straight-line "tapes";
- interval evaluation that proves regions inside or outside *and* records which `min`/`max` branch was taken;
- tape simplification from those choices;
- fast evaluators: a VM, a hand-written aarch64/x86-64 JIT, and, since 0.5, a WebGPU (WGSL) interpreter;
- 2D/3D rasterization;
- Manifold Dual Contouring (MDC) meshing to STL;
- a small Levenberg-Marquardt-style solver over the same tapes (`fidget-solver`).

The README calls the project "Lego-kit-without-a-manual" and "personal-scale" (DOCUMENTED).

## How it works

### Expression graph → SSA tape → register tape → bytecode (`fidget-core`, `fidget-bytecode`)

- **`Context`** is an arena `IndexMap<Op, Node>`, so every `(opcode, args)` combination exists exactly once. Commutative ops (add, mul, min, max) sort their operands before lookup, and constants are folded (`context/mod.rs` lines ~185-320). `Tree` is the non-deduplicated user-facing builder; converting it to a `Node` in a `Context` performs the deduplication (DOCUMENTED).
- **`SsaTape`** is a topological flattening. It is "stored in reverse order, such that the root of the tree is the first item", with `choice_count` equal to the number of min/max/and/or ops (`compiler/ssa_tape.rs`).
- **`RegisterAllocator<N>`** is a "cheap and cheerful single-pass" reverse linear scan with an LRU register list and spill to memory slots through `Load`/`Store` ops (`compiler/alloc.rs`).
  - N = 255 for the VM and bytecode (register 255 is reserved as the immediate flag).
  - N = 12 physical registers for the x86-64 JIT and 24 for aarch64 (writeup).
  - The MPR paper's Table 2 shows how few slots real models need: "Hello, world" 328 clauses / 26 slots, architectural model 961 / 75, 2D text 6,056 / 84.
- **Bytecode** (`fidget-bytecode/src/lib.rs`, DOCUMENTED) is a list of little-endian u32 word *pairs*:
  - Word 0 packs `[opcode u8, out reg u8, lhs reg u8, rhs reg u8]`.
  - Word 1 is an immediate: an f32 bitcast, or a memory slot for `Mem`.
  - A register byte of `0xFF` means "use the immediate".
  - The tape starts with `0xFFFFFFFF 0x00000000` and ends with `0xFFFFFFFF 0xFFFFFFFF`.
  - The fixed width allows walking forwards (evaluation) and backwards (simplification).
  - There are 34 opcodes: Output, Input, Copy, Neg, Abs, Recip, Sqrt, Square, Floor, Ceil, Round, Not, Rand, Sin … Ln, Add, Sub, Mul, Div, Atan2, Compare, Mix, Mod, Min, Max, And, Or, Mem.
  - The format is explicitly "not stable".
- **Determinism across backends** (DOCUMENTED, CHANGELOG "0.5.1 (unpublished)" at HEAD `0c89e87`): "Switch to using `f32` everywhere … the evaluator test suite now confirms that evaluators **agree exactly** with the canonical operator definition. This required removing the JIT implementation for `modulo`, which was not exactly in agreement."

### Evaluators

- Four evaluator kinds:
  - point (`f32`);
  - interval (`[lo, hi]` f32);
  - float slice (SIMD: 4 lanes on ARM, 8 on x86);
  - gradient slice: forward-mode AD packing value plus ∂x, ∂y, ∂z into one 4×f32 register (writeup).
- **Interval semantics**:
  - An interval is either valid `[lo, hi]` with lo ≤ hi, or `(NaN, NaN)`, meaning "could be anything, including NaN" (issue https://github.com/mkeeter/fidget/issues/248).
  - `mul` takes the min and max of the four products. `div` returns NaN if the divisor contains 0. `sqrt` returns NaN if lo < 0. `sin`/`cos` return [-1, 1] unless the interval is degenerate.
- **No outward rounding**: "This implementation does not set rounding modes, so it may not be _perfect_" (DOCUMENTED, `fidget-core/src/types/interval.rs` line 9). The GPU WGSL ops (`fidget-wgpu/src/shaders/interval_ops.wgsl`) likewise use plain f32 min/max of products.
  - The MPR paper (§3, p.4) reports that switching its CUDA interval library from rounded intrinsics to "normal operations showed the same performance and identical output".
  - Open issue https://github.com/mkeeter/fidget/issues/442 considers the `maryada` crate for "Actually Correct Interval Arithmetic, versus the best-effort stuff currently in Fidget".

### Interval pruning ("One Weird Trick", MPR Alg. 1 and 2)

1. **Forward interval pass** (`run_tape` with a choice stack):
   - At each `min(a,b)`: if a.hi < b.lo, push LEFT; else if b.hi < a.lo, push RIGHT; else push BOTH. `max` is symmetric. `and`/`or` work the same way.
   - The result classifies the region: hi < 0 means full, lo > 0 means empty, anything else is ambiguous.
2. **Backward simplification pass** (`simplify_tape`):
   - Walk the tape in reverse with a `live[reg]` bitset. Only the output is live initially.
   - A dead op is skipped, but if it is a choice op its choice is still popped.
   - A live min/max with LEFT or RIGHT becomes a `Copy` of the chosen argument, or disappears entirely if it would copy a register onto itself.
   - A live op marks its inputs live and its output dead.
   - The output tape is emitted back to front.

- Numbers (DOCUMENTED):
  - MPR text benchmark, 6,056 clauses, of which 2,354 are min/max: the average tape is 356 ± 125 clauses in 64² tiles and 28 ± 13 in 8² subtiles, a 17× and 216× reduction (MPR Fig. 6).
  - Fidget writeup, 254-clause tape: 73 clauses at 32² tiles and 20 at 8².
  - The bear sculpt is the counterexample: few CSG clauses and many smooth blends (exp/log) that "cannot be culled like min and max". It is the slowest model in every table.

### GPU rendering (MPR and `fidget-wgpu`)

- **MPR (CUDA)**:
  - Each 8-byte clause is (opcode, out slot, lhs/rhs slot or f32 immediate).
  - Every thread gets a 128-slot array.
  - The choice stack stores 2 bits per choice (4,096 choices in 256 u32).
  - Shortened tapes are unrolled linked lists of 64-clause chunks, allocated by atomic bump in a 1 GB scratch buffer.
  - 2D uses tiles of 64², then 8², then pixels. 3D uses 64³, 16³, 4³, then voxels.
  - Every level subdivides by 64×, "ensur[ing] that exactly two warps are mapped to each subdivided tile … This prevents thread divergence, because every thread in the warp is evaluating the same shortened tape" (MPR §4).
- **`fidget-wgpu` (0.5)**:
  - Same hierarchy (64³ → 16³ → 4³ → voxels) with indirect dispatch computed on the GPU.
  - Z-sorted **strata**: 64³ slabs processed front to back. This cuts tile storage from N³ to N², and each pass bails out if the heightmap already covers the tile.
  - When the tape buffer runs out, the renderer falls back to the unsimplified tape (`voxel/mod.rs` header).
  - Tape chunks are 64 words linked by `OP_JUMP` words (`shaders/tape_simplify.wgsl`).
  - Output is a heightmap plus normals, not a mesh. GPU meshing does not exist.

### Meshing (`fidget-mesh`, Manifold Dual Contouring after Schaefer, Ju, Warren 2007)

- **Setup**: the region is fixed to [-1, 1]³. The caller must supply `world_to_model` so that the model fits inside. Settings: `depth`, a thread pool, a cancel token (`lib.rs`; issue https://github.com/mkeeter/fidget/issues/355).
- **`OctreeBuilder::recurse`** (`octree.rs` ~521):
  - Interval-evaluate the cell. hi < 0 marks it Full and lo > 0 marks it Empty.
  - Otherwise simplify the tape from the trace (`simplify_tree_during_meshing(depth)` is a per-evaluator hint, default always) and recurse into 8 children, or build a leaf at `max_depth`.
- **Leaf** (`octree.rs` ~590):
  1. Point-evaluate the 8 corners and form an 8-bit inside mask.
  2. Look up the active edges and cell vertices in a build-time generated table `CELL_TO_VERT_TO_EDGES` (`build.rs`, `codegen`).
  3. Find each edge root by a **16-ary search, 4 rounds**, on u16 fixed-point positions within the cell. That is 16 samples per edge per round, 16⁴ = 65,536 positions, so about 2^-16 of the cell size. It is uniform, branch-free batched evaluation.
  4. Evaluate the gradient at each root.
  5. Accumulate a QEF per cell vertex.
- **QEF** (`qef.rs`):
  - It stores AᵀA (3×3), Aᵀb, bᵀb and a homogeneous mass point, so QEFs add componentwise.
  - The solve is a 3×3 SVD about the mass point. Singular values below `1e-3 × σ_max` are dropped; the constant is "very much a tuned value (alas!)". The cone test needs rank 3 at a dynamic range of about 2e3, and the bear needs rank 2 at about 1e7.
  - The error is clamped to at least 1e-6.
- **Collapse** (`try_collapse`):
  - Merge 8 children only if they pass the topology predicates of Ju et al. 2002 §4.1 (`collapsible`), the merged QEF error is below 2× the child error, and the vertex stays inside the cell.
- **Threading**: breadth-first expand to about 10× the thread count of subtrees, build them in parallel, then fix up (`build_inner_mt`).
- **Dual walk** (`walk_dual`) emits the triangles.

### Constraint solver (`fidget-solver/src/lib.rs`, 636 lines incl. tests)

DOCUMENTED from the source:

- `solve(eqs: &[F: Function], vars: HashMap<Var, Parameter{Free(f32) | Fixed(f32)}>) -> Result<HashMap<Var, f32>, SingularMatrix>` minimizes Σ fᵢ² over the free variables.
- Each constraint is an ordinary Fidget expression compiled to two tapes: a gradient-slice tape for the Jacobian and a point tape for the error.
- **Jacobian by batched forward-mode AD**: the gradient evaluator carries 3 partials per lane, so free variable `gi` is seeded in lane `gi / 3`, component `gi % 3`. One slice evaluation of `ceil(n_free / 3)` lanes yields a full Jacobian row per constraint.
- **Levenberg-Marquardt with Marquardt scaling**:
  - Solve `(JᵀJ + λ·diag(JᵀJ)) δ = Jᵀr` with an f32 SVD at `f32::EPSILON`.
  - Reject the step and set λ ×= 1.5 while the error rises; on acceptance set λ /= 3.
  - Stop when no variable changes bitwise, when the error is 0 or λ is 0, or when the last 4 errors are identical.
  - All arithmetic is f32 via nalgebra.
- The tests cover linear systems, the Rosenbrock "banana", a circle constraint (`sqrt(x²+y²)`) and `one_var_no_solution`. There is no rank or DOF analysis and no over-/under-constrained diagnosis.

## Robustness and guarantees

- **Rendering**: interval results are conservative up to f32 rounding, with no directed rounding (DOCUMENTED above). NaN intervals propagate as ambiguous. Choice pruning is exact *given* the interval results.
- **Meshing** claims (DOCUMENTED, `fidget-mesh/src/lib.rs`): meshes "should be manifold, watertight, preserving sharp features". They "may contain self-intersections, and are not guaranteed to catch thin features (below the sampling grid resolution)".
  - The writeup adds that "vertex positioning is susceptible to adversarial cases" and that "good meshing of arbitrary implicit surfaces remains an unsolved problem".
  - The adversarial blog shows constructions that defeat sharp-feature capture at any resolution.
- **No geometric error bound**: there is no certified deviation between the mesh and the true zero set. The QEF vertex can leave its cell (https://github.com/mkeeter/fidget/issues/53), and gradients are required to be meaningful at the surface.
- **SDF quality is not required**: MPR "only requires C0 continuity". Fidget treats f as an implicit function, not a true distance, so `min`/`max` CSG yields a distance *bound*, not a distance. Offsets by `f - r` are therefore exact only for true SDFs (INFERRED; standard f-rep caveat).

## Parallelism and performance

All DOCUMENTED.

- **README rasterization benchmark** (M1 Max CPU; MPR on a GTX 1080 Ti):

  | Size | libfive | MPR | Fidget VM | Fidget JIT |
  |---|---:|---:|---:|---:|
  | 1024³ | 66.8 ms | 22.6 ms | 61.7 ms | 23.6 ms |
  | 1536³ | 127 ms | 39.3 ms | 112 ms | 45.4 ms |
  | 2048³ | 211 ms | 60.6 ms | 184 ms | 77.4 ms |

- **Writeup**:
  - Brute-force evaluation of a 7,867-clause expression at 1024²: bytecode 5.8 s, JIT 182 ms (31×).
  - With interval pruning: bytecode 6 ms, JIT 4.6 ms, only about 25% apart.
  - *Pruning dominates backend choice.*
- **MPR paper**:
  - Its interpreter is 19× slower than a compiled CUDA kernel per pixel (58 vs 3 ms/MP brute force). With pruning it beats the compiled kernel from about 1536², staying below 8 ms per frame even at 4096² (Fig. 5).
  - 3D heightmap plus normals at 1024³:

    | Model | GT 750M | GTX 1080 Ti | Tesla V100 |
    |---|---:|---:|---:|
    | Architectural | 189.9 ms | 22.6 ms | 12.2 ms |
    | Gears | 426.2 ms | 40.3 ms | 23.1 ms |
    | Bear | 2,352 ms | 191.0 ms | 88.3 ms |

    (Table 5.)
  - Tape generation on the CPU takes 1-7 ms.
- **Meshing**: no published throughput numbers found. It is multi-threaded on the CPU only.

## Known failures, limitations, war stories

All issue links DOCUMENTED.
- **Meshing**:
  - Back-facing triangles and non-manifold edges reported by MeshLab on the bear at depth 7 (https://github.com/mkeeter/fidget/issues/234, open).
  - Wrong-winding triangles on a sphere (https://github.com/mkeeter/fidget/issues/198, open). The author: "the mesh should always be topologically manifold and watertight, but may have self-intersections if vertices escape their octree cells".
  - Vertices far outside their cells (https://github.com/mkeeter/fidget/issues/53).
  - A cylinder mesh defect (https://github.com/mkeeter/fidget/issues/225, fixed by #232). The thread discusses mesh fuzzing; the author says fuzzing "would find more issues than we could resolve".
  - NaN vertices when meshing a box (https://github.com/mkeeter/fidget/issues/15).
  - Empty mesh for a translated box (https://github.com/mkeeter/fidget/issues/47).
  - A partial mesh when the model leaves the ±1 region (https://github.com/mkeeter/fidget/issues/355).
- **Gradient singularities**: `sqrt(0)` at the pole of a revolved Reuleaux solid gives NaN or garbage gradients, so the QEF misplaces vertices. The user workaround is adding an epsilon inside the sqrt (https://github.com/mkeeter/fidget/issues/284, https://github.com/mkeeter/fidget/issues/258). For CAD this is a systematic hazard: revolve axes, cone apexes and `abs` creases (INFERRED).
- **Interval correctness**: NaN handling of `[-1,1] × [1,∞]` was wrong (https://github.com/mkeeter/fidget/issues/248, open), and there is no directed rounding (#442).
- **JIT**: a large-shape crash, "assertion failed: self.mem_offset < 4096" on aarch64 (https://github.com/mkeeter/fidget/issues/235). JIT `modulo` was removed for non-bit-exactness (CHANGELOG).
- **GPU**: an external reviewer criticized per-thread register arrays that spill to global memory (`var reg: array<vec4f,256>`) combined with divergence (https://github.com/mkeeter/fidget/issues/243). This is the practical cost of an interpreter on the GPU.

## Relevance for wonky

**Main use: the libfive-style SDF prototype in the Boolean bake-off.** Fidget is the best-engineered reference for exactly that design, and most of it maps onto Bend (INFERRED):
- **Tape as data**: a tape is a Bend list or affine array of `(U32 op word, U32 imm)` pairs.
- **Interpreter**: a pure fold with a register file. Use a balanced tree or an affine array of 255 slots, updated functionally.
- **Choice stack**: a list of 2-bit choices packed into U32 words.
- **Simplification**: a reverse fold with a liveness bitset of 8 U32 words for 255 registers.
- **Hierarchical subdivision** is the fork-join shape Bend wants. One tile evaluates its interval, simplifies, then forks 64 (or 8) children that all run the *same* shortened tape. This is the uniform-work call tree the Metal backend needs, and MPR's 64× fan-out rule exists precisely to keep warps on one tape.
- **Not portable**: the JIT (no codegen in Bend) and atomic bump allocation of tape chunks (use per-tile owned lists).
- **Evaluation budget**: MPR shows a pruned interpreter beats a compiled brute-force kernel, so losing the JIT is acceptable.

**F32 and rounding.** Fidget's f32-only design matches Bend's scalar set, but its intervals are not certified. wonky's "approximations need explicit tolerances" rule requires outward rounding. In Bend, with no rounding-mode control, widen each bound by one ulp through U32 bit manipulation (`lo = nextDown(lo)`, `hi = nextUp(hi)`), or evaluate the bounds in F32x2 and round outward once at the end. Either way the Full/Empty cell classification becomes a proof (INFERRED).

**Canonical bytecode for introspection and diff.** Hash-consed `Context` plus canonical bytecode gives a deterministic, content-addressable form of a shape. It is useful for wonky's provenance, diff and cache keys and for LLM-readable dumps. Fidget's "all backends agree exactly with the canonical operator definition" test discipline is directly applicable to wonky's three Bend targets (JS, C, Metal). Enforce bit-identical F32 results per op and drop any op that cannot be made identical, as Fidget did with JIT `modulo` (INFERRED).

**Where SDF does not fit wonky's main line** (INFERRED):
1. The output is a mesh with no analytic faces. STEP needs recovery, and MDC vertices are QEF-placed, not on exact surfaces.
2. There is no deviation certificate, and self-intersections are possible. This conflicts with wonky's certified print mesh.
3. Gradient singularities at revolve axes, apexes and creases are common in CAD parts.
4. FeatureScript bodies are B-reps. Using SDF requires exact distance or implicit functions for trimmed planar and cylindrical faces, and `min`/`max` CSG destroys the distance property that offsets and shells rely on.

SDF therefore fits as (a) a robust *preview* and fallback Boolean with an explicit tolerance label, (b) FDM-specific operations where a bound is enough (clearance checks, infill and lattice fields, variable-thickness shells, "is this wall thicker than 0.8 mm" queries through interval pruning), and (c) an interference and containment *classifier*: interval-classify octree cells against two solids' implicit forms to find overlap regions quickly, then hand them to the exact pipeline.

**Sketch solver** (INFERRED): `fidget-solver` shows that a tape-based expression engine doubles as a constraint-solver backend. Residuals are tapes, Jacobians come from lane-packed forward AD, and the solver is plain f32 LM.
- For wonky's sketch solver (lines and arcs today) the transferable part is *residuals as canonical tapes with forward-mode AD*. It gives one representation for constraints, SDF queries and introspection. It is also pure and fork-join friendly: rows of the Jacobian are independent.
- The f32-only LM without rank analysis is too weak for CAD sketches. It needs F32x2 residuals near convergence, DOF and redundancy detection (QR or SVD rank with an explicit threshold), and explicit "over-constrained" or "no solution" results instead of silently returning the last iterate.
- The variable-to-column map comes from `HashMap` iteration, so column order is not stable across runs. A Bend port should order columns by variable id.

**Meshing kernel details worth reusing even outside SDF**: the u16 fixed-point 16-ary root search (uniform, GPU-friendly), additive QEF records, and the collapse criterion (error < 2× children and vertex inside the cell).

## Pointers worth porting or studying

- `fidget-core/src/context/mod.rs` (`Context`, `op_binary_commutative`, constant folding): hash-consing with canonical operand order.
- `fidget-core/src/compiler/ssa_tape.rs`, `alloc.rs` (`RegisterAllocator`, LRU), `reg_tape.rs`: graph → SSA → register tape.
- `fidget-bytecode/src/lib.rs`: the u32-pair bytecode layout, 0xFF immediate flag and sentinel words. The layout is directly usable in Bend.
- `fidget-wgpu/src/shaders/tape_interpreter.wgsl` (`run_tape`), `tape_simplify.wgsl` (`simplify_tape`), `interval_ops.wgsl` (`op_min`/`op_max` choice push, `op_mul`, `op_div`, NaN semantics): the smallest complete reference for a GPU interpreter plus pruner. Transliterate the ideas, not the MPL text.
- `fidget-wgpu/src/voxel/mod.rs` header: the strata scheme, 64³/16³/4³ hierarchy and fallback to the unsimplified tape.
- `fidget-core/src/types/interval.rs`: the operator-by-operator interval rules. Add outward rounding.
- `fidget-mesh/src/octree.rs`: `recurse` (~521), `leaf` (~590, the 16-ary edge search), `try_collapse` (~315), `collapsible` (Ju 2002 §4.1). `qef.rs`: additive QEF and the SVD rank cutoff. `build.rs`: table generation.
- `fidget-solver/src/lib.rs` (`Solver::get_jacobian` lane packing, `solve` LM loop): a compact reference for AD-over-tapes constraint solving.
- MPR paper (`tmp/research/pdf/keeter_mpr20.pdf`): Alg. 1-3 (pp. 5-6), §3.3 data structures, Tables 4-5, Fig. 6.
- https://www.mattkeeter.com/blog/2023-04-23-adversarial/: adversarial cases for sharp-feature meshing, to use as torture tests.

## Verdict: learn-from

Adopt the *architecture* (hash-consed DAG → canonical tape → interval evaluation with choice tracing → pruned tapes on a 64×-fan-out hierarchy) for wonky's SDF prototype and for fast interval classification queries. Add outward rounding, which Fidget lacks. Do not port code: it is MPL, the value is in a JIT Bend cannot have, and the meshing has open correctness issues.

As the production Boolean the SDF route stays secondary: it produces mesh-only output with no deviation bound and no analytic faces. Use it for previews, FDM field operations and interference culling, with explicit tolerance labels.
