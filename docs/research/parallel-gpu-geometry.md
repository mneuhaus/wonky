# Parallel and GPU geometry for CAD, and what runs well in Bend

- **Status:** catalog chapter, 2026-09-24. The product owner lowered this topic's priority, so it got no deep reads.
- **Contents:** this chapter has sections 1, 2, 5 and 7 only. The usual sections 3 (state of the art), 4 (war stories) and 6 (open questions) are folded briefly into sections 1 and 5.
- **Confidence:** every verdict in section 2 is provisional. Every proposal in section 5 is **unverified, from the sweep only**.
- **Re-checked for this chapter.** Several of the scout's claims were re-checked against local primary sources:
  - the BendRT paper (`tmp/research/bend/paper/BendRT.pdf`, text in `tmp/research/pdf/bendrt-paper.txt`);
  - Bend's `guide/SHADERS.md`, `bend2/comp.ts` and `bend2/base.bend` (`.tools/bend-source-2.0.25/`);
  - the Metal Shading Language Specification 4.1 (`tmp/research/pdf/msl-spec.txt`);
  - wonky's own measurements: [hardware-performance.md](../hardware-performance.md), [bakeoff.md](../bakeoff.md) "Results", [hybrid-boolean-plan.md](../hybrid-boolean-plan.md) sections 3, 6 and 8, and [proto-corefine.md](../proto-corefine.md);
  - repository metadata via `gh api` (2026-09-24);
  - two blog posts (Lalish 2022, Levien 2021).
- **Labels:**
  - **DOCUMENTED:** primary source, linked.
  - **INFERRED:** my reasoning from that evidence.
  - **HEARSAY:** secondhand.
  - **(sweep):** a claim from the scout's landscape pass that I did not re-read for this chapter.

## 1. Landscape

### 1.1 What Bend 2.0.25 is, and what it is not

Bend 2.0.25 is **not** an interaction-net runtime. The BendRT paper says it "keeps the goals and drops the mechanism" of HVM. Affine ownership replaces the interaction graph and its duplication machinery (DOCUMENTED, BendRT §11, [bendlang/bend `paper/`](https://github.com/bendlang/bend)).

- **Scheduling.** Execution is bulk-synchronous. The work phases are "bursts of exponential fork, then deep sequential focus, then the next wave". There is "no shared deque, no lock on the task path, no migration, no rebalance".
  - The paper states the consequence plainly: "If a program forks unequal parts, lanes idle at the end of a work turn, and the runtime declines to correct that: balance is the program's job" (DOCUMENTED, BendRT §6.3-6.4).
- **One C file** serves both targets. It runs as the host thread pool or as a Metal/CUDA kernel. "The CPU and the GPU never compute at the same time" (DOCUMENTED, BendRT §7).
- **The GPU call `f!(x)`** ships a whole call to the device. That device is a cube of 16,384 lanes. The guide says to "aim for 4^7 leaves per bang, one per lane". Fewer leaves leave lanes idle: "256 of 16384 busy" is the documented bad case (DOCUMENTED, `guide/SHADERS.md` lines 14-28).
- **Parallelism the program must create itself.** It comes only from a balanced fork `a b = f(x) g(y)` and a uniform `!` call tree (DOCUMENTED).
- **HVM1/HVM2/HVM4 are history**, not a model for wonky's code (INFERRED from the above).

### 1.2 Where each executor wins: five independent measurements

| Source | Uniform, flat numeric work | Divergent, list-heavy or topological work |
|---|---|---|
| BendRT Table 1 (Apple GPU, 16 threads) | GPU is 52-67x the sequential build. Examples: game of life 0.48 s on 16 threads vs 0.08 s on the GPU; n-body 0.43 vs 0.08 s | GPU loses to 16 threads: n-queens 0.46 vs 1.24 s, symbolic regression 0.29 vs 0.54 s. Sorts gain little: tree radix sort 0.36 vs 0.25 s (DOCUMENTED, BendRT §10) |
| Bend `guide/SHADERS.md` | Tile-binned raster with 4^7 = 16,384 tiles is the intended shape | Meshing, projection, lighting and culling take 0.6-1.6 ms on the host and 14-33 ms on the GPU; "a P-core is ~75x a lane on serial work" (DOCUMENTED, lines 217-218, 254) |
| wonky [hardware-performance.md](../hardware-performance.md) (M5 Pro, 2026-09-21) | 262,144 cylinder comparisons split 16,384 × 16: Metal 2-3 ms vs 9 ms on 18 threads | 16,384 through-hole Booleans. Split 64 × 256: Metal 777 ms vs 21 ms on 18 threads (about 35x slower). Split 4,096 × 4: 17 vs 21 ms. Other Metal costs: 18.97 s compile and 32 ms process start (DOCUMENTED) |
| wonky bake-off, judge round 2 (2026-09-23), [bakeoff.md](../bakeoff.md) "Results" | The only uniform kernels measured (sdf dense sampling, thickness rays) reach roughly parity with 18 cores | Metal is slower than 18 threads for **every** prototype. Metal/cpu18 geo-mean: corefine 2.40, exact-plane 2.09, sdf 30.94, recover 2.77. No case with at least 20 ms of cpu1 compute runs faster on Metal (smallest ratio 1.04). sdf runs out of memory at 1 GB on 4 cases. **Production default: `--gpu off`** (DOCUMENTED, [hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §6) |
| Manifold (Lalish 2022 blog; issue tracker) | On the GPU, intersections were ">20x" faster, sorting also sped up | Overall speed-up was only an "extra factor of two", because triangulation "is not conducive to GPU-scale parallelization" (DOCUMENTED, [blog](https://elalish.blogspot.com/2022/03/manifold-performance.html), GTX 1070 vs i7-3930K). CUDA/OMP were deprecated ([#524](https://github.com/elalish/manifold/issues/524), closed 2023-08-12) and replaced by custom TBB algorithms ([#857](https://github.com/elalish/manifold/pull/857), 2024-07-13) |

**Reading (INFERRED).** The GPU pays only for work that is:
- uniform and fixed-cost;
- branch-light, on flat F32 records;
- batched to at least 4^7 leaves in a split shape that is built once.

Boolean topology is none of these. Wonky's own end-to-end bake-off confirms this for all four prototypes. The hybrid's real parallel limit is on the CPU:
- **Poor thread scaling.** The cpu1/cpu18 geo-mean speed-up is 1.46 for corefine and 1.10 for recover.
- **Sequential stages.** Union-find, the assembly walks, the weld and recover's finish stage all run in sequence.
- **Two Bend CPU-pool traps** (DOCUMENTED, [proto-corefine.md](../proto-corefine.md), `tmp/corefine/prof/micro.bend`):
  - Sharing forces atomic reference counts.
  - A non-tail call that forked serializes every later parallel let in the same frame: 188 ms at 1 thread and 190 ms at 18, against 190 / 35 ms without the call.

### 1.3 Lineages

1. **GPU evaluation and intersection of NURBS.**
   - The line runs from Guthe, Balázs and Klein 2005 (trim textures), through Krishnamurthy, Khardekar and McMains 2007 (per-fragment de Boor evaluation), to Krishnamurthy et al. TVCG 2009.
   - The TVCG 2009 paper is the only real GPU NURBS Boolean: an SSI over guaranteed-enclosing box grids plus stream compaction. Its output is tolerance-bounded, with **no topological guarantee**: "they will fail to recreate the correct topology when two unrelated intersection curves are very close" (DOCUMENTED, [note](sources/krishnamurthy-mcmains-et-al-performing-efficient-nurbs-model.md)).
   - Descendants:
     - GPU Hausdorff distance, minimum distance and moment integrals (2011);
     - NURBS-Diff (2021);
     - B-spline evaluation as batched matrix products (2025).
   - The only commercial follower is Zoo's GPU SSI (2025). It is patented: US 12,229,885 B1, expected to expire in 2044 (DOCUMENTED, [note](sources/zoo-kittycad-cad-engine-overview-gpu-surface-surface-interse.md)).
   - Every entry in this line either only evaluates geometry or produces tolerance-bounded results.
2. **GPU mesh Booleans.**
   - LDNI (2010) works on a sampled ray representation (three orthogonal layered depth-normal images).
   - Manifold's CUDA/Thrust path (about 2019-2023) was abandoned. Manifold also moved from float to double in v3.0; "float was mostly due to CUDA" (DOCUMENTED, [note](sources/manifold-elalish-manifold.md)).
   - Nothing in this line is exact.
3. **Exact mesh CSG on multicore CPUs.** Wonky's corefine and exact-plane prototypes follow this line.
   - 3D-EPUG-Overlay (2020): rationals, a uniform grid, OpenMP.
   - Cherchi et al. 2022: indirect predicates, an octree, parallel work per leaf and per triangle ([note](sources/cherchi-pellacini-attene-livesu-2022-interactive-and-robust-.md)).
   - Lévy 2024 / Geogram: multithreaded per-triangle CDT, allocation-free after warm-up ([note](sources/levy-2024-exact-predicates-exact-constructions-and-combinato.md)).
   - EMBER (2022): plane-based ([note](sources/ember-exact-mesh-booleans-via-efficient-robust-local-arrange.md)).
4. **Industrial CPU parallelism (SMP).**
   - Parasolid:
     - at most 8 threads;
     - parallel only in sub-algorithms: face-level checking and the "face-face clashing portion" of Booleans;
     - scaling "not expected to be linear";
     - isolated calls can get "slightly slower with SMP enabled" (DOCUMENTED, [note](sources/overview-of-parasolid-v35-july-2022.md)).
   - OCCT `BOPTools_Parallel` runs the edge/edge and face/face intersections and split-face building in parallel (DOCUMENTED, [note](sources/occt-boolean-operations-specification-general-fuse-algorithm.md)).
   - Neither kernel uses a GPU.
5. **GPU primitives.**
   - Karras 2012 LBVH: Morton sort, then a radix tree whose internal nodes are built independently.
   - Onesweep 2022: decoupled look-back scan and sort.
   - Levien 2021: decoupled look-back cannot run on Metal. `threadgroup_barrier(mem_flags::mem_device)` "turns out to actually have threadgroup (workgroup) scope", and Apple GPUs "exhibit failures of forward progress". The exception is a payload that packs into 32 bits (DOCUMENTED, [blog](https://raphlinus.github.io/gpu/2021/11/17/prefix-sum-portable.html)).
   - Vello: multi-pass scan and binning pipelines, running on Metal.
6. **SDF and interval arithmetic.**
   - Keeter's MPR (2020) and Fidget: per-tile tape pruning, with every thread of a warp running the same shortened tape. This is the cleanest uniform GPU geometry kernel published (DOCUMENTED, [note](sources/fidget-matt-keeter.md)).
   - Wonky's sdf prototype took this path. As a Boolean it lost: 47 of 216 adversarial cases came back wrong-but-`ok`, and Metal was 30.9x slower than 18 threads.
7. **Parallel languages and runtimes.**
   - HVM1/2/4: interaction nets, the Bend 1 backend.
   - Futhark: incremental flattening picks among code versions by runtime size thresholds.
   - parlaylib/ParGeo: fork-join scan, sort and pack, and geometry built on them.
   - Blelloch, Gu, Shun and Sun (2020): randomized incremental Delaunay, LP and closest pair have shallow dependence depth.

### 1.4 Division of labour for wonky (provisional, INFERRED)

The production default is already decided: **CPU pool, `--gpu off`**. A kernel may try Metal only if it meets all three conditions of [hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §6:
- flat SoA F32 records;
- batched across all Booleans of an operation or tree level;
- measured faster than cpu18, including start-up (about 57 ms) and per-pass cost (35-60 ms).

Under that gate the split looks like this.

**Metal candidates**
- grid evaluation of analytic surfaces at fixed (u,v) lattices (and, later, NURBS via fixed-degree per-span matrix forms);
- curvature- or Lipschitz-expanded boxes and normal cones per patch, and patch-pair filtering in fixed tiles (the Krishnamurthy 2009 and Li 2026 pattern (sweep));
- Morton code generation;
- batched F32/F32x2 predicate filters that label a pair "certain" or "uncertain";
- SDF/interval tape evaluation per tile;
- per-ray interval merges;
- far-field winding-number quadrature.

**CPU fork-join**
- BVH build as a top-down split of a sorted Morton list, and every per-query traversal;
- SSI tracing and curve fitting;
- exact U32 multi-limb fallbacks;
- face splitting, loop and shell assembly, CDT;
- corefine's winding and weld;
- all of recover.

**Scans and compaction** must be multi-pass reduce-then-scan or fork-join tree reductions. Onesweep and decoupled look-back do not port to Metal (DOCUMENTED, Levien).

**Every `!` call needs a minimum-work guard with a CPU fallback:**
- A bang with no parallelism can hold the GPU indefinitely and crash macOS's WindowServer ([bend#942](https://github.com/bendlang/bend/issues/942), open).
- Tree arity decides lane load: the same leaves take 3 ms two-way, 12 ms four-way and 23-34 ms four-way pruned ([bend#925](https://github.com/bendlang/bend/issues/925), open).
- Fork depth changes GPU frame time by up to 8x ([bend#828](https://github.com/bendlang/bend/issues/828)).

### 1.5 Precision on Metal and in Bend

- **Metal does not promise the float model that F32x2 needs.** MSL 4.1 has no `double`, `long long` or `unsigned long long` (DOCUMENTED, spec §2.1).
  - "Denormalized single-precision ... numbers ... may be flushed to zero" (§8.1).
  - "Either round ties to even or round toward zero rounding mode may be supported" (§8.2).
  - `+ - * /` are "correctly rounded" (Table 8.1), in whichever of those modes the device implements.
  - With fast math, NaN/INF handling is undefined (§8.1). Source: [Apple MSL spec PDF](https://developer.apple.com/metal/Metal-Shading-Language-Specification.pdf).
- **Bend pins what it can.**
  - It compiles with `#pragma clang fp contract(off)` (`comp.ts:3323`) and `MTLMathModeSafe` (`comp.ts:5019`).
  - Math functions are `precise::`, except `sin`, `cos` and `tan`, which are `fast::` (`comp.ts:392-395`).
  - The runtime's contract is "one semantics on every executor", checked by byte-comparing outputs (DOCUMENTED, BendRT §7).
- **The gap (INFERRED).** F32x2 error-free transforms (TwoSum; Dekker/Veltkamp TwoProd, split constant 4097 in `kernel/real.bend`) and the Joldes-Muller-Popescu error bounds assume round-to-nearest and gradual underflow. Nobody has published whether the M5 Pro GPU gives both under `MTLMathModeSafe`.
  - Wonky's byte-identical JS/CPU/Metal runs (hardware benchmark: 36/36 configurations; bake-off: all runs) are evidence for the inputs tested. They are not a proof, and they probably do not probe subnormal or near-underflow operands.
- **Bend base gaps** (DOCUMENTED by absence in `bend2/base.bend`):
  - no `fma`, so TwoProd needs Veltkamp splitting;
  - no `clz`: `U32.log2` is a recursive software search (line 1451);
  - `U32.mul` returns only the low word (line 1364), so multi-limb products need 16-bit half-limbs.
  - The hardware does have a 32×32→64 integer multiply ("IMUL(32x32=64)", [philipturner/metal-benchmarks](https://github.com/philipturner/metal-benchmarks)). The missing `mulhi` is therefore a Bend library gap, not a hardware limit (INFERRED).
  - The same source measures emulated FP59 (e11m48) at 1:36 (add) and 1:52 (mul) of native F32 throughput. That is a ceiling estimate for F32x2-heavy GPU kernels (DOCUMENTED; transfer to F32x2 INFERRED).
- **Differential testing.** [bend#824](https://github.com/bendlang/bend/issues/824) was a Metal-only wrong U32 remainder (4294967294 % 3). It is fixed, but it argues for CPU-vs-Metal testing of every limb and real routine (INFERRED).
- **The right shape is a filter cascade.** Bulk F32/F32x2 filters run with explicit error bounds, and exact U32 resolution is kept for the small uncertain set on CPU cores. Cherchi 2022, Lévy 2024 and gDel3D (GPU near-Delaunay, then exact CPU star splaying) all use this pattern.
  - Wonky's exact-plane prototype already works this way (DOCUMENTED, [proto-exact-plane.md](../proto-exact-plane.md)). A static-bound F32x2 filter decides most signs: 0.10-0.20 µs, against 1.3-6.0 µs on the exact `Big` path. A certified pair filter even runs as one Metal pass per case.
  - Its residue is **not** hard near-degenerate signs. It is exact **zeros** from coplanar and touching CAD input, and a float filter can never certify a zero. On `hex-nut`, 85k exact zeros (7 % of signs) cost about as much as 1.07M filtered signs. The document's own conclusion: the next gain comes from symbolic zeros and fixed-width limbs, not a sharper filter.

### 1.6 Trends and what is missing

- **No exact curved B-rep Boolean on a GPU exists** (as far as the sweep found). The 2024-2026 work is CPU-first or evaluation-only:
  - Yang et al., TOG 2025: a hybrid mesh/B-rep Boolean, the closest relative of wonky's corefine+recover. It reports no parallelism ([note](sources/yang-jia-wang-yang-xin-yan-2025-boolean-operation-for-cad-mo.md)).
  - Li et al., TOG 2026: precision-controlled NURBS SSI with a-priori bounds (sweep).
  - Spainhour & Weiss, TOG 2026: GWN containment queries over trimmed NURBS ([arXiv 2504.11435](https://arxiv.org/abs/2504.11435)).
  - Batched B-spline matrix evaluation (2025).
  - Exact mesh CSG by Cherchi (2022) and Lévy (2024), both on multicore CPUs.
- **Missing entirely, so wonky would have to create them:**
  - a geometry library for Bend;
  - published measurements of F32x2 (double-word) arithmetic on Apple GPUs;
  - a GPU-friendly exact-predicate package for F32/U32-only targets.
- **Wonky's data is already novel.** Its bake-off data on JS/cpu1/cpu18/Metal, with byte-identical results, is the only published end-to-end CPU-vs-GPU comparison of exact Boolean prototypes in one language that the sweep found (INFERRED).

### 1.7 Licensing (wonky is private and unlicensed)

- **Permissive; port with attribution:**
  - Bend (Apache-2.0), Manifold (Apache-2.0), Vello (Apache-2.0);
  - Futhark (ISC);
  - ParGeo and parlaylib (MIT), metal-benchmarks (MIT);
  - Geogram (BSD-3), applegpu (BSD-3).
  - **Corrections to the sweep** (DOCUMENTED, 2026-09-24):
    - [gDel3D](https://github.com/ashwin/gDel3D): the GitHub API reports no license, but the README carries a BSD-3-style NUS license.
    - [GPUPrefixSums](https://github.com/b0nes164/GPUPrefixSums): the API says NOASSERTION, but the file is MIT plus CUB's BSD-3 for derived parts.
- **Weak copyleft; ideas only or clean-room:** OCCT (LGPL-2.1) and Fidget (MPL-2.0, file-level).
- **No license; study only:**
  - [MeshIntersection](https://github.com/sallesviana/MeshIntersection), the 3D-EPUG code. It also depends on CGAL and GMP.
  - [HVM4](https://github.com/HigherOrderCO/HVM4).
- **Patent:** Zoo's GPU SSI, US 12,229,885 B1, active until about 2044. Avoid its claimed pipeline, or design around it (see the note).
- **Papers:** the algorithms are free to implement.

## 2. Comparison table (verdicts provisional, from the sweep)

Verdict key:
- **ADOPT-PATTERN:** take the algorithmic shape.
- **RULE:** a constraint wonky must obey.
- **STUDY:** read before building the matching feature.
- **REFERENCE:** data or spec to cite.
- **AVOID:** not suitable for wonky.
- **HISTORICAL:** background only.

"Note" links an existing deep-read note from another chapter where one exists. Otherwise it gives the primary URL.

| Source | Kind | Status (2026-09-24) | License | Verdict | Key idea | Note |
|---|---|---|---|---|---|---|
| Bend 2 / BendRT, v2.0.25 | library + paper | active; 22,610 stars; last commit 2026-09-23 ("The flake names 2.0.27"; wonky pins 2.0.25) | Apache-2.0 | RULE | Balanced fork-join and uniform `!` trees; no work stealing; one C file for CPU pool and Metal; the program must balance its own work | [repo](https://github.com/bendlang/bend); [hardware-performance.md](../hardware-performance.md) |
| Metal Shading Language Spec 4.1 | docs | maintained (2026-06-04) | Apple docs | RULE | No fp64; denormals may flush; RTNE or RTZ; `+ - * /` correctly rounded | [PDF](https://developer.apple.com/metal/Metal-Shading-Language-Specification.pdf) |
| Manifold | library | very active (v3.5.3, 2026-09-07) | Apache-2.0 | ADOPT-PATTERN (CPU), AVOID (its GPU history) | Parallel maps over candidate pairs; the serial triangulation and assembly capped the GPU's win; CUDA dropped | [note](sources/manifold-elalish-manifold.md) |
| Karras, LBVH (HPG 2012) | paper | historical | paper | ADOPT-PATTERN | Sort 30-bit Morton codes; every internal node from common-prefix lengths. In Bend: a top-down radix split of the sorted list | [PDF](https://research.nvidia.com/sites/default/files/pubs/2012-06_Maximizing-Parallelism-in/karras2012hpg_paper.pdf) |
| Levien, portable prefix sum (2021) | blog | historical | n/a | RULE | Metal lacks device-scope barriers and forward progress, so no decoupled look-back; use reduce-then-scan (about 1.5x slower) | [blog](https://raphlinus.github.io/gpu/2021/11/17/prefix-sum-portable.html) |
| Krishnamurthy, McMains et al. (SPM 2007/2008, TVCG 2009) | papers | historical | papers | ADOPT-PATTERN (box grids, pair culling), AVOID (proximity topology) | Uniform grid of enclosing boxes, then data-parallel box-pair culling and compaction; tolerance-bounded, no topology guarantee | [note](sources/krishnamurthy-mcmains-et-al-performing-efficient-nurbs-model.md) |
| Zoo GPU SSI (2025) + US 12,229,885 B1 | vendor article + patent | engine active, closed | article MIT; patent active | STUDY (patent risk) | GPU point-cloud seeding with LOD refinement for SSI | [note](sources/zoo-kittycad-cad-engine-overview-gpu-surface-surface-interse.md) |
| Yang et al., hybrid Boolean (TOG 2025) | paper | new | paper (text CC BY-NC) | STUDY | Robust mesh Boolean coupled to the B-rep, then exact-ish B-rep recovery; no parallelism reported | [note](sources/yang-jia-wang-yang-xin-yan-2025-boolean-operation-for-cad-mo.md) |
| Li et al., precision-controlled SSI (TOG 2026) | paper | new | paper | STUDY | A-priori Hausdorff bounds (Lipschitz, convex hull), fast OBB, normal-range classification of patch pairs (sweep) | [DOI](https://dl.acm.org/doi/10.1145/3806045) |
| Keeter MPR (TOG 2020) / Fidget | paper + library | active (v0.5.0) | MPL-2.0 | ADOPT-PATTERN (ideas only) for FDM analyses | Tile hierarchy with tape pruning so every lane of a warp runs the same tape | [note](sources/fidget-matt-keeter.md) |
| Cherchi et al. 2022; Lévy 2024 (Geogram) | papers + library | active (Geogram) | BSD-3 (Geogram) | ADOPT-PATTERN | Filter cascade (floating filter, exact residue); per-leaf / per-triangle parallel work; parallel sort-unique weld | [Cherchi](sources/cherchi-pellacini-attene-livesu-2022-interactive-and-robust-.md), [Lévy](sources/levy-2024-exact-predicates-exact-constructions-and-combinato.md), [Geogram](sources/geogram-brunolevy-geogram.md) |
| OCCT BOP parallel mode; Parasolid SMP | docs + code | active | LGPL-2.1; proprietary | STUDY (ideas only) | Parallelize per interference pair and per face on CPU threads; scaling non-linear, 8 threads max in Parasolid | [OCCT](sources/occt-boolean-operations-specification-general-fuse-algorithm.md), [Parasolid](sources/overview-of-parasolid-v35-july-2022.md) |
| Futhark + incremental flattening (PPoPP 2019) | language + paper | active; 2,802 stars; last commit 2026-09-23 | ISC | ADOPT-PATTERN | Several code versions per nested-parallel site, picked by runtime size thresholds; in Bend: measured per-site split thresholds | [repo](https://github.com/diku-dk/futhark) |
| ParGeo + parlaylib | libraries | ParGeo abandoned (2022-09-12), parlaylib active (2026-03-12) | MIT | ADOPT-PATTERN | Work-efficient fork-join scan, sort, pack; geometry (kd-tree, hull, closest pair) on top | [ParGeo](https://github.com/ParAlg/ParGeo), [parlaylib](https://github.com/cmuparlay/parlaylib) |
| Blelloch, Gu, Shun, Sun (JACM 2020) | paper | historical | paper | STUDY | Randomized incremental algorithms (Delaunay, LP, closest pair) have shallow dependence depth, so they parallelize work-efficiently | [DOI](https://dl.acm.org/doi/abs/10.1145/3402819) |
| gDel3D | library | abandoned (2018-08-01), 187 stars | BSD-3-style (README) | ADOPT-PATTERN (heterogeneous repair) | Parallel near-Delaunay first, then exact CPU star splaying | [repo](https://github.com/ashwin/gDel3D) |
| philipturner/metal-benchmarks | dataset | maintained (2024-09-22), 632 stars | MIT | REFERENCE | Apple GPU throughput: IMUL 32×32→64 exists; FP59 emulation cost | [repo](https://github.com/philipturner/metal-benchmarks) |
| Onesweep + GPUPrefixSums | paper + library | historical; repo 2025-01-29 | MIT (+ CUB BSD-3) | AVOID on Metal | Single-pass LSD radix sort on decoupled look-back | [arXiv](https://arxiv.org/abs/2206.01784), [repo](https://github.com/b0nes164/GPUPrefixSums) |
| HVM1/HVM2/HVM4 | runtimes | historical for Bend 2 | MIT (HVM1), Apache-2.0 (HVM2), none (HVM4) | HISTORICAL | Interaction-combinator parallel runtime of Bend 1; BendRT drops the mechanism | [HVM2](https://github.com/HigherOrderCO/HVM2) |
| LDNI (Wang, Leung, Chen 2010) | paper | historical | paper | AVOID for Booleans | GPU Booleans on three layered depth-normal images; sampled, not exact | [arXiv](https://arxiv.org/abs/1009.0794) |

## 5. What wonky should take (unverified, from sweep only)

**Context.** These proposals were ranked after the bake-off's judge round 2, which already chose corefine + recover and set Metal to off.

**Why the CPU comes first.** The measured ceiling is the hybrid's CPU scaling (1.46 / 1.10), not a missing GPU. Proposals that raise it therefore rank above every Metal idea.

**Common gate.** Every proposal inherits the project's rules:
- geometry is computed in Bend;
- results are byte-identical across JS, cpu1, cpu18 and (where used) Metal;
- unsupported cases fail explicitly.

### P1. Level-synchronous operation scheduler

- **Idea.** Run all ready Booleans of one CSG level, and all independent parts, in one balanced fork tree. A tail-recursive driver steps from level to level. This is the only parallelism with clear headroom: OCCT and Parasolid parallelize per pair and per face, and wonky's per-Boolean fork trees are already saturated by their sequential stages.
- **Plugs in.** The hybrid CSG evaluator (`kernel/hybrid/`) and n-ary batching in `src/boolean.mjs`. This is [hybrid-boolean-plan.md](../hybrid-boolean-plan.md) step 12.
- **Bend fit.** Good, if the tree is built before any heavy fork. It must avoid the documented trap: a non-tail call that forked serializes every later parallel let in the same frame. Operands must stay uniquely owned (no sharing, so no atomic counts).
- **Benefit.** Multi-body FDM models (brackets plus inserts, print-in-place pairs) would scale roughly with the number of independent operations.
- **Risk.** Memory peaks, because a whole level is live at once. Unequal Booleans in one level leave lanes idle, since there is no work stealing.
- **First acceptance test.** From plan step 12:
  - a FeatureScript model with 20 bosses makes exactly 1 hybrid call;
  - a two-part model shows cpu18/cpu1 > 2x on the pair;
  - outputs are byte-identical to sequential evaluation.

### P2. One shared Bend spatial module: Morton sort, balanced BVH, forked pair and self join

- **Idea.** Wonky already has three Morton/BVH implementations:
  - `kernel/hybrid/corefine/inter.bend`: a bottom-up pairing tree;
  - `kernel/hybrid/corefine/gate.bend`;
  - `kernel/hybrid/recover/clear.bend`: a halving tree plus a forked self-join.

  Merge them into one module (`kernel/lib/spatial.bend`). It would provide Morton codes, a parallel stable merge sort, a top-down radix split (Karras in fork-join form, INFERRED), and forked pair and self joins with pluggable leaf tests.
- **Plugs in.**
  - the corefine broad phase;
  - the self-intersection gate (plan step 1);
  - clearance and interference checks (plan step 13);
  - recover's clearance certificate.
- **Bend fit.** Excellent. It is pure fork-join over sorted lists. Box and Morton arrays are also the first flat SoA candidate for a batched Metal pass.
- **Benefit.** One tested broad phase instead of three. It is also the seed of the missing "geometry library for Bend".
- **Risk.** Churn in the uncommitted hybrid code. Joins must not share the tree; otherwise the atomic counts come back.
- **First acceptance test.**
  - All three consumers produce byte-identical results on the 38-case corpus and the 216 adversarial cases (js, cpu1, cpu18).
  - Broad-phase time is at most the best of the three current implementations, per case.

### P3. Parallelize the hybrid's sequential stages

- **Idea.** Parallelize the three stages that are still sequential:
  - Replace corefine's winding union-find with a deterministic fork-join connected-components pass (min-label propagation, or a tree contraction over the sorted edge list).
  - Replace the weld with a parallel sort-and-unique of bit-identical vertices (the Cherchi and Geogram pattern).
  - Fork recover's finish stage per face or patch.
- **Plugs in.** `kernel/hybrid/corefine/{assemble,weld,zip}.bend` and `kernel/hybrid/recover/topo.bend`.
- **Bend fit.** Good for sort-unique and per-face work. Connected components need a fixed number of rounds or a pointer-jumping formulation; there is no mutation, so each round is a new list.
- **Benefit.** recover is 48 % of the hybrid's cpu18 time and scales 1.10x. This proposal attacks exactly that.
- **Risk.** Determinism. Manifold's atomic index allocation broke bitwise reproducibility (#1848, #1320). Bend avoids that only if merges are ordered. Pointer jumping may cost more work than the serial union-find on small cases.
- **First acceptance test.**
  - recover's cpu1/cpu18 geo-mean (cases with at least 20 ms) rises from 1.10 to at least 2.0;
  - corefine's rises from 1.46 to at least 2.0;
  - output is byte-identical;
  - cpu1 time grows by no more than 10 %.

### P4. Finish the filter cascade: symbolic zeros and fixed-width limbs

- **Idea.** The float filter already exists (section 1.5), so this proposal extends it.
  - Carry incidence facts through splits ("vertex v was built on plane p"). The exact zeros that coplanar and touching CAD input produces then become symbolic answers, not `Big` evaluations.
  - Give the common 1-4-limb operands a fixed-width U32 limb path instead of the variable-length `List<U32>`.
  - Fixed width is also the only exact-arithmetic shape with uniform per-lane work. It is therefore the one exact kernel that could ever be a Metal candidate, after P5 (INFERRED).
- **Plugs in.**
  - exact-plane (kept as the differential oracle);
  - `kernel/robust-predicates.bend`;
  - corefine's tie handling in `shadow.bend`, where carrier unification already produces the same kind of exact ties.
- **Bend fit.** Good on the CPU.
  - Limbs must be 16-bit halves: `U32.mul` returns only the low word (`comp.ts:187-190`, per the [Lévy note](sources/levy-2024-exact-predicates-exact-constructions-and-combinato.md)).
  - Normalization needs a software `clz`.
  - Incidence facts are plain data carried in the vertex records; no mutation is needed.
- **Benefit.** Exact-plane is 2.5-5.6x slower than corefine. On `hex-nut` the exact zeros alone cost an estimated 0.1-0.5 s ([proto-exact-plane.md](../proto-exact-plane.md)). A cheaper oracle can run on every CI job and in the "paranoid" mode (INFERRED).
- **Risk.**
  - A wrong incidence fact silently asserts a zero, so every symbolic zero needs an exact re-check in a debug mode.
  - Fixed-width limbs need a proven bit bound per predicate. EMBER/NW2021 give one for plane-based inputs.
- **First acceptance test.**
  - On the corpus, at least 90 % of exact zeros are answered symbolically.
  - A debug build re-evaluates every symbolic zero exactly and finds no mismatch on the corpus and the 216 adversarial cases.
  - Exact-plane's `hex-nut` predicate time falls by at least 2x.
  - Output is byte-identical.

### P5. Metal numeric conformance probe and CPU-vs-Metal differential test

- **Idea.** Before any tolerance-bearing F32x2 decision runs on the GPU, measure what the M5 Pro GPU actually does under Bend's `MTLMathModeSafe`:
  - rounding mode;
  - flush-to-zero of subnormals;
  - TwoSum and Veltkamp exactness;
  - renormalization;
  - every U32 limb op.

  Run large vector batches through one `!` and compare bytes against the CPU build.
- **Plugs in.** A test harness next to `scripts/benchmark-hardware.mjs`, covering `kernel/real.bend`, `kernel/precise.bend` and `kernel/robust-predicates.bend`.
- **Bend fit.** Ideal. It is a uniform 4^7-leaf `!` over test vectors.
- **Benefit.** It closes a gap nobody has published. It is a precondition for P4-on-Metal and P7, and it guards against another bend#824.
- **Risk.** Tests show the presence of bugs, never their absence. Metal builds cost about 19 s.
- **First acceptance test.**
  - 2^24 vectors per routine, including subnormal, near-overflow and tie cases, are byte-identical CPU vs Metal.
  - Any mismatch becomes a Bend issue and blocks that routine from the Metal lane.
  - The results are recorded in [hardware-performance.md](../hardware-performance.md).

### P6. A guarded `!` helper with per-site split thresholds

- **Idea.** Every GPU call site goes through one helper, for example `par.bang`. It requires a minimum leaf count (4^7) and uniform leaf work, and it falls back to the CPU pool otherwise. Split arity and depth are chosen from a measured per-site table: the Futhark incremental-flattening idea applied by hand.
- **Plugs in.** A small `kernel/lib/par.bend`, the hardware runner, and any Metal kernel from P7.
- **Bend fit.** Good. The helper is itself balanced fork-join code.
- **Benefit.**
  - avoids the measured 35x loss of a bad split (64 × 256 vs 4,096 × 4);
  - avoids bend#942's GPU hang and WindowServer crash;
  - avoids bend#925/#828's arity and depth sensitivity.
- **Risk.** Thresholds are specific to machine and Bend version. They must be re-measured on every Bend bump.
- **First acceptance test.**
  - Every `!` in `kernel/` goes through the helper (a grep gate).
  - The bend#942 repro cannot be triggered through it.
  - A per-site sweep table is stored under `out/hardware/`.

### P7. Metal trials that meet the hybrid-plan §6 gate

- **Idea.** Try only kernels that are flat SoA F32 and batched model-wide:
  - (a) a whole-model broad phase: box expansion, Morton codes and the box-pair filter over all Booleans of a level (with P1 and P2);
  - (b) sdf dense sampling and thickness rays for the FDM checks (plan step 13);
  - (c) fixed-lattice evaluation of analytic surfaces for viewer, compare and Hausdorff tooling (the Krishnamurthy grid pattern).
- **Plugs in.** Plan step 13 (FDM checks); later, compare and diff.
- **Bend fit.** Uniform leaves are possible; the lists must be flattened first.
- **Benefit.** At best modest. The only uniform kernels measured so far reached roughly parity with 18 cores.
- **Risk.** High odds of another measured loss, once device start-up (about 57 ms) and per-pass cost (35-60 ms) are counted.
  - (a) has partly been tried already. Exact-plane's certified pair filter runs as one Metal pass per case, but it takes only about 1 ms on the CPU pool, so the pass cost dominates ([hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §6).
  - Only batching across a whole model or level changes that arithmetic.
- **First acceptance test.** Plan step 13: faster than cpu18 end-to-end on a model-sized batch, including start-up and passes, with byte-identical output. Otherwise the trial is dropped.

### P8. Precision-controlled sampled SSI for future freeform faces (deferred)

- **Idea.** For future freeform faces only (fillets, sweeps, NURBS import): seed and cull patch pairs with bounded boxes and normal cones (Krishnamurthy grid, Li 2026 bounds (sweep)). Trace and fit on the CPU. Take connectivity from exact analytic topology or mesh adjacency, **never** from proximity chaining.
- **Plugs in.** A future curved general Boolean (after the plane/cylinder/cone closed forms) and the fillet work.
- **Bend fit.** Seeding is uniform; tracing is divergent and stays on the CPU.
- **Benefit.** An explicit-tolerance path for surfaces with no closed-form intersection.
- **Risk.** The Zoo patent (US 12,229,885 B1) covers a GPU point-cloud SSI pipeline; stay clear of its claims. Tolerance semantics must be explicit.
- **First acceptance test** (when it becomes relevant): on a torus-cylinder and a freeform-plane set, every traced curve lies within the stated a-priori bound of an independent high-precision reference. Also, no missed branch on the 2 corpus tangent cases (they must refuse, not guess).

**Ranking rationale (INFERRED).**
- P1-P3 target the bake-off winner's measured bottleneck.
- P4 attacks the exact-plane oracle's measured residue (exact zeros), not a guessed one.
- P5 and P6 are cheap safety work that any GPU use presupposes.
- P7 and P8 are speculative until the gate and a curved Boolean exist.

## 7. Catalog of the remaining sources

None of these were deep-read. Metadata comes from `gh api` or the publisher page on 2026-09-24 unless marked (sweep).

- **Krishnamurthy, Khardekar, McMains, "Direct Evaluation of NURBS Curves and Surfaces on the GPU"** (SPM 2007). [PDF](https://mcmains.me.berkeley.edu/pubs/SPM07KrishnamurthyKhardMcMains.pdf), local `tmp/research/pdf/krishnamurthy-spm07-nurbs-eval.pdf`.
  - Per-point rational de Boor evaluation with derivatives in fragment programs.
  - Covered by the 2009 [note](sources/krishnamurthy-mcmains-et-al-performing-efficient-nurbs-model.md). HISTORICAL.
- **Krishnamurthy, McMains, Hanniel, GPU Hausdorff distance between NURBS surfaces** (CAD 43(11), 2011). [Publisher](https://www.sciencedirect.com/science/article/abs/pii/S0010448511002211).
  - Box culling on the GPU, refinement on the CPU.
  - Relevant later for compare/diff tooling (exact model vs print mesh). STUDY when compare is built.
- **Guthe, Balázs, Klein, "GPU-based Trimming and Tessellation of NURBS and T-Spline Surfaces"** (SIGGRAPH 2005), plus Schollmeyer & Fröhlich 2009 (direct per-fragment trimming with monotone segments). [DOI](https://dl.acm.org/doi/10.1145/1073204.1073305), local `tmp/research/pdf/guthe-2005-gpu-trim.pdf`.
  - Viewer-side trimming only; no modelling value. HISTORICAL.
- **NURBS-Diff** (Prasad, Krishnamurthy et al. 2021). [arXiv 2104.14547](https://arxiv.org/abs/2104.14547).
  - Batched, differentiable NURBS evaluation for deep learning. Code: idealab-isu/NURBSDiff, BSD-3 (per the Krishnamurthy note).
  - Only relevant if wonky ever fits surfaces by gradient descent. HISTORICAL.
- **GPU-optimized parallel B-spline matrix representation** (arXiv 2504.11498, 2025). [arXiv](https://arxiv.org/abs/2504.11498), local `tmp/research/pdf/gpu-bspline-matrix-2025.pdf`.
  - Evaluation as batched fixed-size matrix products: the uniform-leaf shape a Bend `!` wants.
  - STUDY when NURBS evaluation lands (P7c).
- **Magalhães, Franklin, Andrade, 3D-EPUG-Overlay** (CAD 2020). [Publisher](https://www.sciencedirect.com/science/article/abs/pii/S0010448519305330).
  - Code: [MeshIntersection](https://github.com/sallesviana/MeshIntersection): no license, C++, 49 stars, last push 2017-12-19, needs CGAL + GMP + OpenMP. README: "assumes the input meshes are valid".
  - Exact rational mesh intersection with a two-level uniform grid for bounded per-cell work.
  - A multicore data point for "exact + uniform grid". STUDY only.
- **Spainhour & Weiss, "Robust Containment Queries over Collections of Trimmed NURBS Surfaces via Generalized Winding Numbers"** (TOG 45(3), 2026). [arXiv 2504.11435](https://arxiv.org/abs/2504.11435), [DOI](https://doi.org/10.1145/3797957).
  - GWN via boundary-formulation quadrature, robust to non-watertight input, with memoized batched queries.
  - Found in this pass; not in the sweep catalog. Related: [arXiv 2510.25159](https://arxiv.org/html/2510.25159) (fast containment on trimmed surfaces) and [arXiv 2605.01536](https://arxiv.org/pdf/2605.01536) (antipodal method for 3D GWN).
  - STUDY for point classification of imported, not-quite-closed STEP.
- **Vello** (linebender/vello). [repo](https://github.com/linebender/vello): Apache-2.0, Rust, 4,366 stars, last commit 2026-09-24 ("add CPU/GPU differential fuzz testing (#1947)").
  - Multi-pass scan, binning and sort-middle pipelines that run on Metal via wgpu.
  - Its new CPU/GPU differential fuzzing is the same discipline as P5. REFERENCE.
- **Onesweep** (Adinets & Merrill 2022). [arXiv 2206.01784](https://arxiv.org/abs/2206.01784).
  - State-of-the-art CUDA radix sort on chained scan with decoupled look-back. Not portable to Metal (Levien). AVOID.
- **HVM1 / HVM2 / HVM4.**
  - [HigherOrderCO/HVM](https://github.com/HigherOrderCO/HVM) is now "HVM1": MIT, 11,348 stars.
  - [HVM2](https://github.com/HigherOrderCO/HVM2): Apache-2.0.
  - [HVM4](https://github.com/HigherOrderCO/HVM4): no license, C, 120 stars, last push 2026-05-30.
  - Interaction-combinator runtimes. BendRT keeps their goals but not their mechanism. HISTORICAL.
- **applegpu** (dougallj). [repo](https://github.com/dougallj/applegpu): BSD-3, 707 stars, last push 2026-07-01 (merged "DoubleRound" PR #65); local clone `tmp/research/applegpu`.
  - Reverse-engineered Apple GPU ISA with a hardware test bed (`hwtestbed.py`).
  - Found in this pass; not in the sweep catalog. The most direct tool for P5-style probes below the MSL level. REFERENCE.
- **Zoo NURBS-on-GPU white paper.** Promised in Zoo's engine overview but unpublished as of 2026-09-23 (DOCUMENTED in the [Zoo note](sources/zoo-kittycad-cad-engine-overview-gpu-surface-surface-interse.md)). Watch.
- **Li, Yang, Jia, "Advances and challenges in surface-surface intersection computation"** (CAD 2026 survey). [note](sources/li-yang-jia-2026-advances-and-challenges-in-surface-surface-.md).
  - A different paper from the Li et al. TOG 2026 SSI in section 2. It maps the SSI field, including sampling methods. Background.
