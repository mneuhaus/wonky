# Implicit, F-rep and SDF modeling, and what wonky keeps from it

- **Status:** catalog chapter, 2026-09-24. The product owner lowered this topic's priority, so it got no deep reads of its own.
- **Contents:** sections 1, 2, 5 and 7 only. The usual sections 3 (state of the art), 4 (war stories) and 6 (open questions) are folded briefly into sections 1.3-1.5, 5.9 and 5.8.
- **Confidence:** every verdict in section 2 is provisional. Every proposal in section 5 is **unverified, from the sweep only**.
- **What was re-checked for this chapter:**
  - wonky's own prototype and verdict: [../proto-sdf.md](../proto-sdf.md), [../bakeoff.md](../bakeoff.md) "Results", [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) sections 1, 5 and 8;
  - deep-read notes written for other chapters: [Fidget](sources/fidget-matt-keeter.md), [libfive](sources/libfive.md), [Curv](sources/curv.md), [Manifold](sources/manifold-elalish-manifold.md);
  - repository metadata via `gh api` (2026-09-24);
  - spot checks of three primary sources: Barbier et al. 2025 pp. 1-3 (`tmp/research/pdf/barbier_lipschitz_pruning_eg25.pdf`), Plantinga & Vegter 2004 p. 245 (`tmp/research/pdf/plantinga_vegter_2004.pdf`), and the `Manifold::LevelSet` doc comment (`tmp/research/manifold/src/sdf.cpp`, clone `36d0aab`, 2026-09-22).
- **Labels:**
  - **DOCUMENTED:** primary source, linked.
  - **INFERRED:** my reasoning from that evidence.
  - **HEARSAY:** secondhand.
  - **(sweep):** a claim from the scout's landscape pass that I did not re-read.
- **No Codex JSON notes exist for this topic** in `tmp/research/notes/` (checked 2026-09-24), so no source notes had to be published first.

## 1. Landscape

### 1.1 Where wonky already stands (read this first)

The brief says the Boolean bake-off is "running right now". It is not: judge round 2 ended on 2026-09-23 (DOCUMENTED, [../bakeoff.md](../bakeoff.md) "Verdict").

- **The winner is corefine + recover.** A tagged mesh Boolean decides the topology, and recover rebuilds the exact B-rep from the tags.
- **sdf is "not a Boolean candidate".** It returned 47 of 216 adversarial cases as `ok` with wrong geometry. "Its field and tape machinery is kept for FDM analyses" (DOCUMENTED, same section).
- **The FDM uses are already planned.** [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md):
  - §5 routes wall thickness to "sdf rays: sphere tracing on the 1-Lipschitz field … a sampled estimate, labelled as such, never a certificate";
  - §5 routes offsets, shells and clearance holes to "sdf face-wise (mitred) offset `f − r`";
  - step 13 adds `wallThickness(body, t)`.

  [fdm-geometry.md](fdm-geometry.md) treats the sdf field as an `estimate` channel that "can prove a violation, never a pass".

The proposals in section 5 therefore target the **retained pieces**: the field, the tape and the rays. They do not target a Boolean.

**What wonky's sdf prototype is** (DOCUMENTED, [../proto-sdf.md](../proto-sdf.md)):
- **Field.** Each face of the CSG job becomes a 1-Lipschitz carrier function (plane, cylinder, cone, sphere, torus, exact signed 2D polygon distance). CSG is `min`/`max`, with negation pushed to the leaves.
- **Pruning.** Range bounds are Lipschitz-based (exact for planes) and widened by an F32 rounding margin. Pruning over an octree records the min/max choices, as libfive does.
- **Meshing.** Manifold Dual Contouring. Each vertex is **solved onto the analytic carriers** that cross its cycle, by Newton or Levenberg-Marquardt; there is no QEF.
- **Grid.** The grid is shifted by 0.318 h so that measure-zero coincidences are never sampled.
- **Numerics.** F32 only, `fp contract(off)`. Output is byte-identical on JS, cpu1, cpu18 and Metal.

**Measured:**
- **Corpus:** 35 pass, 2 expected refusals, 1 unresolved (`brep` leaves). The 11 planar cases are exact to F32 rounding. Curved cases show a sampled chordal deviation of 0.8-3.9 µm against a 10 µm case deviation.
- **Adversarial (216):** 128 good, 35 refused, 47 wrong, 3 errors.
- **Speed:** Metal is 30.94x (geo-mean) slower than 18 CPU threads. The four largest octrees run out of the 1 GB device heap.

**The scout's predictions against wonky's measurements:**

| Scout's prediction (INFERRED in the sweep) | What wonky measured (DOCUMENTED) |
|---|---|
| "The SDF + DC prototype will reproduce this exact failure profile" (tuned QEF cutoffs, feature damage) | **Partly wrong.** Solving each vertex onto the tagged carriers replaced the QEF and its tuned cutoff. Every triangle corner lies on its carrier (validator `offSurfaceCorners` = 0), and planar results are exact ([../proto-sdf.md](../proto-sdf.md) steps 4-7) |
| Grid-bound topology | **Confirmed, and it dominates.** Several losses were all returned `ok`: 0.1-1.2 mm walls, membranes and ribs; a 3 mm plate; a 0.4 mm slot and 0.02-0.5 mm gaps; a needle hole; two 5 mm cubes 500 mm apart (empty result) ([../bakeoff.md](../bakeoff.md) "Verifier defects") |
| Certification fails at creases, so a depth cap with an "uncertified" result is needed | **Confirmed indirectly.** A global cell size `h = min(extent/64, √(r_min·dev))` gave timeouts on tiny radii and `h = 0` (an empty `ok`) at a pointed cone apex. There was no uncertified label |
| Contacts | Invalid meshes were returned `ok` in 3 cases, despite the prototype's contact test: an edge contact, a corner contact, and a rotated pipe tee (orientation and self-intersection) |
| A pure-functional implicit evaluator is very Bend-friendly | **True on the CPU:** byte-identical, cpu1/cpu18 = 3.57. **False on Metal:** the octree build is 2.5-65x slower than 18 cores; even dense brick sampling only reaches parity at 2^30 samples ([../proto-sdf.md](../proto-sdf.md) "Parallel structure") |
| Min/max choice records are free per-region face labels for analytic recovery | **Not realized.** The judge found that sdf output does not feed recover: "a new vertex set with no tag pairs" ([../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §1 table). The census idea (proto-sdf "idea 2") is untested (proposal S3) |

### 1.2 Two camps

- **Graphics and artist camp:** Quilez, Dreams, MagicaCSG, Womp, Bauble, fogleman/sdf, hg_sdf. It optimises speed and looks. Bound fields and smooth blends are fine there, because only the zero set is drawn (sweep).
- **Engineering camp:** libfive, Fidget and Halfspace, Curv, sdfx, ImplicitCAD, nTop, OpenVDB-style level sets, `Manifold::LevelSet`. It cares about solids and export, which in practice means STL.
- **No open member of either camp exports an exact B-rep.** libfive has "no exact B-rep, no STEP, and no analytic face identity" ([note](sources/libfive.md)). Curv has "no B-rep and no STEP" ([note](sources/curv.md)). Both DOCUMENTED.

### 1.3 The converged evaluation core (state of the art, part 1)

All four steps below are DOCUMENTED in the [Fidget note](sources/fidget-matt-keeter.md) and the [libfive note](sources/libfive.md) unless marked otherwise.

1. **DAG to tape.**
   - A hash-consed expression DAG is flattened to a straight-line register tape.
   - In Fidget, commutative operands are sorted and constants folded.
   - Fidget's bytecode is u32 word pairs with a `0xFF` immediate flag. A Bend list can hold this directly (INFERRED).
2. **Range evaluation per region.** Interval arithmetic (libfive, MPR, Fidget) or, since 2025, plain Lipschitz bounds.
   - Barbier et al. prune "without the overhead of interval arithmetic". The method works with hard and smooth CSG, and reaches "×629 on this scene made of 6023 nodes" (DOCUMENTED, EG 2025 pp. 1-2).
   - wonky's prototype already uses Lipschitz widths: `s·Σ|nᵢ|` for planes, `s√3` otherwise.
3. **Tape simplification from the recorded choices.** At each `min`/`max`, record LEFT, RIGHT or BOTH; a backward pass drops the dead branches.
   - The MPR text benchmark shrinks from 6,056 clauses to 356 ± 125 at 64² tiles and to 28 ± 13 at 8² (17x and 216x).
   - **Pruning dominates the choice of backend.** Brute force takes 5.8 s in bytecode and 182 ms JIT-compiled. After pruning, bytecode takes 6 ms and the JIT 4.6 ms.
   - The counterexample is Fidget's bear: its smooth exp/log blends "cannot be culled like min and max".
4. **Uniform GPU work from fixed hierarchical splits.**
   - MPR: 64² → 8² → pixels (2D) and 64³ → 16³ → 4³ → voxels (3D). The 64x fan-out puts "exactly two warps" on one shortened tape.
   - Dreams uses hierarchical 4x4x4 culling (sweep).

**Precision.**
- Fidget moved to "`f32` everywhere", with every evaluator agreeing bit-exactly with the canonical operator definition. JIT `modulo` was removed because it did not agree.
- Fidget does **not** round outward (`interval.rs` line 9, "may not be _perfect_").
- MPR saw "identical output" with and without rounded intrinsics.
- libfive does round outward: `boost::numeric::interval<float>` with `save_state`. Its QEF runs in double.
- **For wonky (INFERRED):** F32 fits Bend. But a range used as a *proof*, such as a full or empty cell or a thickness violation, needs a derived outward margin. On Metal and in Bend there is no rounding-mode control (proposal S2).

### 1.4 Meshing: the admitted weak spot (state of the art, part 2)

- **Keeter** writes that "good meshing of arbitrary implicit surfaces remains an unsolved problem". Curv's `issues/Meshing` says: "Artifact-free #sharp meshing is seemingly an unsolved research problem" (both DOCUMENTED in the notes).
- **Two families with opposite guarantees:**
  - **Topology-safe, features rounded.**
    - Curv `#smooth`: OpenVDB volume-to-mesh; claims "watertight, manifold, no self intersections".
    - `Manifold::LevelSet`: marching tetrahedra on a body-centred cubic grid. It has an explicit `tolerance` ("Ensure each vertex is within this distance of the true surface"). It needs no true distance and not even continuity (DOCUMENTED, `src/sdf.cpp`).
    - Isosurface stuffing (sweep).
    - Plantinga-Vegter isotopic subdivision (below).
  - **Feature-preserving, topology at risk.**
    - Ju 2002 DC and Schaefer-Ju-Warren 2007 MDC, as implemented in libfive and Fidget.
    - The output is manifold and watertight "but may have self-intersections if vertices escape their octree cells" (Fidget [#198](https://github.com/mkeeter/fidget/issues/198); libfive #150, #284).
    - Both rely on a **tuned rank cutoff**: Fidget `1e-3 × σ_max`, "very much a tuned value (alas!)"; libfive `EIGENVALUE_CUTOFF = 0.1`.
- **Resolution tied to the bounding box.** libfive [#562](https://github.com/libfive/libfive/issues/562), still open on 2026-09-24: a cube minus a cube meshes broken or fine depending only on the bounds. wonky's `extent/64` rule failed the same way on the far-apart small cubes.
- **Plantinga-Vegter (SGP 2004)** gives isotopy by interval subdivision for smooth surfaces. The paper itself proposes that "a maximal subdivision level could be used … to handle surfaces with singularities", and "colour coding of the mesh could be used to identify the (arbitrarily small) regions where the approximation might be topologically incorrect" (DOCUMENTED, p. 245).
  - This is the "depth cap plus explicit uncertified result" pattern.
  - CSG creases are such singularities: the gradient jumps at a `min`/`max` switch, so the gradient test cannot pass there (INFERRED).
- **Bridging work, 2023-2024 (sweep):**
  - Ju-Udeshi intersection-free contouring (2006);
  - occupancy-only DC (Hwang & Sung 2024), which needs only inside/outside queries;
  - the feature-preserving offset line: Zint et al. 2023 (100% watertight 2-manifold on Thingi10k), Topological Offsets 2024, Cao et al. 2024 (mitred offsets that keep sharp features).
- **No published method certifies sharp features.** wonky's carrier solve comes closest for CSG of analytic primitives, and the thin-feature failures show its limit: nothing makes a fixed sampling grid see sub-cell features (INFERRED from section 1.1).

### 1.5 Exact fields versus bound fields (state of the art, part 3)

- **Min/max CSG gives a correct exterior but a wrong interior.** Quilez shows that `min`/`max` Booleans give correct exterior and wrong interior distances, and that this breaks offsets, rounding and shells (sweep, [article](https://iquilezles.org/articles/interiordistance/)).
- **Curv classifies fields formally** (DOCUMENTED, [note](sources/curv.md), `docs/Theory.rst`):
  - exact;
  - approximate, i.e. a Lipschitz-1 bound;
  - mitred.
  - The sweep adds "bad" and "discontinuous".
  - `union = min` maps exact fields to approximate ones. `lipschitz k` is a user-declared contract, and a wrong value gives rendering holes, not an error.
- **Hart 1996** derives the Lipschitz constants of CSG, blends and deformations (sweep).
- **Smooth-min blends are not fillets.** They have "Constant Maximum Thickness"; a CAD fillet has constant radius (DOCUMENTED, Curv `docs/articles/const_max_thickness_blends.rst`).
- **wonky's field is carrier-wise.** Each leaf is an exact signed distance to its *carrier surface*, and the `min`/`max` tree is a 1-Lipschitz bound with an exact sign.
  - Its one exact offset identity is **`f − r` = the intersection-join offset**, "since min/max commute with `− r`". Planes shift and radii grow by r (DOCUMENTED, [../proto-sdf.md](../proto-sdf.md) "FDM operations").
  - A rounded (arc-join, Minkowski) offset, a true clearance *distance*, or a uniform shell at reflex edges needs a Euclidean field. That field does not exist today (INFERRED).
- **R-functions** (Rvachev; Shapiro, Acta Numerica 2007) are the principled theory. They give smooth, normalised implicit Booleans and address the "inverse problem" of building one implicit from a B-rep or CSG (sweep).
  - This is relevant to open question O1: a field for B-rep bodies.

### 1.6 Lineages

1. **Sphere tracing to pruned SDF trees.** Hart 1996 → the Quilez catalogue → Dreams (Evans 2015: GPU edit lists, hierarchical culling, fp16 83³ blocks, compute-shader marching cubes; sweep) → Barbier et al. 2025 (Lipschitz pruning plus far-field culling to constant lower bounds).
2. **F-rep kernels.** Pasko et al. 1995 / HyperFun → Keeter's kokopelli and Antimony (2013-2016) → libfive (2015-) → MPR (2020) → Fidget (2022-) → Halfspace (2025-).
3. **Contouring.**
   - Kobbelt Extended Marching Cubes 2001 → Ju DC 2002 → Dual Marching Cubes / Plantinga-Vegter 2004 → Ju-Udeshi 2006 → MDC 2007 → occupancy DC 2024.
   - The offset branch: Zint 2023 → Topological Offsets 2024 → Cao 2024.
   - wonky's prototype is an MDC descendant with carrier-exact vertices.
4. **Semi-analytic implicits.** Rvachev R-functions → Shapiro 2007 → HyperFun.
5. **Sampled fields.** Frisken ASDF 2000 → OpenVDB (2012-) → `Manifold::LevelSet`. The max-norm voxelization of Varadhan et al. is a side branch.
6. **Range analysis.** Interval arithmetic (Duff 1992, cited by Barbier) → affine arithmetic (Stolfi & de Figueiredo) → Sharp & Jacobson 2022 (guaranteed queries on neural implicits).

### 1.7 Trends, 2023-2026

- **Bit-agreement across backends as a test discipline** (Fidget 0.5.1, DOCUMENTED). wonky already enforces this for all prototypes.
- **GPU pruning without interval arithmetic** (Barbier 2025, DOCUMENTED).
- **Interactive IDEs on implicit kernels:** Halfspace on Fidget, active; last commit 2026-09-12.
- **Meshing research moves to offsets and to occupancy-only extraction** (sweep).
- **Implicit geometry in 3MF.** The Volumetric extension is active but unconsumed by slicers (DOCUMENTED in [fdm-geometry.md](fdm-geometry.md)).
- **nTop 5 (2024-06)** shipped a new implicit kernel and `.implicit` interop. All claims are marketing (sweep).

### 1.8 What is conspicuously missing

- **Implicit-to-exact-B-rep recovery.** Point2CAD fits primitives to point clouds. Nobody publishes turning an f-rep CSG result back into an exact analytic B-rep (sweep). wonky's recover does it from *tagged meshes*, not from fields.
- **Certified sharp-feature meshing** (section 1.4).
- **An open, CAD-grade implicit kernel at nTop's level** (sweep).
- **Explicit tolerance budgets** in QEF and root solving, and any use of double-word precision. Fidget and libfive use magic constants (DOCUMENTED in the notes).
- **Field-quality metadata carried through operations.** Only Curv has a user-declared `lipschitz k`, and it is unchecked. No kernel tracks exact vs bound vs carrier-wise per node (INFERRED from the notes).

### 1.9 Licensing (wonky is private and unlicensed)

Licence data is DOCUMENTED from `gh api` or README text on 2026-09-24 unless marked (sweep).

- **MPL-2.0 (file-level copyleft):** Fidget, libfive core and stdlib, Halfspace.
  - The MPR code has no LICENSE file, but its README declares MPL-2.0 "with a similar strategy as libfive". This corrects the sweep's "no license".
  - Re-implementing the ideas is free. A transliterated file stays MPL.
- **GPL or AGPL, never copy:** Studio and libfive-guile (GPL-2.0+), ImplicitCAD (AGPL-3.0).
- **CC BY-NC, never copy:** hg_sdf (Mercury), "Released as Creative Commons Attribution-NonCommercial" (local `tmp/research/hg_sdf.glsl` line 16). Curv's blend library cites Mercury kernels, so check each kernel's provenance before borrowing from `lib.blend` (INFERRED).
- **Permissive:**
  - Curv (Apache-2.0), Manifold (Apache-2.0), OpenVDB (Apache-2.0), Point2CAD (Apache-2.0);
  - sdfx (MIT), fogleman/sdf (MIT), Bauble (MIT), the Lipschitz Pruning code (MIT), Antimony (MIT per README; no LICENSE file);
  - saft (MIT OR Apache-2.0; upstream repository gone);
  - emilk/Dual-Contouring (public domain per README);
  - nickgildea/DualContouringSample: no licence file; README says "free for any purpose".
- **Unclear:** AbFab3D (NOASSERTION, abandoned 2022-09).

### 1.10 Bend fit at a glance (INFERRED unless marked)

| Component | Fit | Note |
|---|---|---|
| Tape as a list of U32 word pairs; interpreter as a fold with a register file | good | Fidget layout; wonky's `field.bend` uses a tree, not bytecode |
| Range pruning with recorded choices | good on the CPU fork; poor on Metal | measured: octree build 2.5-65x slower on Metal (a recursive, divergent tree fold with list allocation per cell) |
| MPR-style 64x uniform splits | good shape for `!` (4^7 leaves) | measured: even the ideal dense kernel only matches 18 cores at 2^30 samples |
| Atomic tape-chunk allocation (MPR, `fidget-wgpu`) | not expressible | use owned per-cell lists or prefix-sum compaction. Atomic index allocation also broke determinism in Manifold ([#1848](https://github.com/elalish/manifold/pull/1848), DOCUMENTED) |
| JIT | none in Bend | a pruned interpreter is within ~25% of a JIT (6 vs 4.6 ms, DOCUMENTED) |
| Directed rounding | none | derive margins with U32 `nextUp`/`nextDown`, or bound in F32x2 and round once (S2) |
| QEF (3x3 SVD) | fine in F32 in cell-local coordinates | wonky replaced it with a carrier solve |
| Dual-contour emission | fork-join works | measured: serial list building dominates (pipe-tee: 66 → 69 ms, no scaling) |

## 2. Comparison table (verdicts provisional, from the sweep)

Verdict key:
- **KEEP:** already in wonky; retain it.
- **ADOPT-PATTERN:** take the algorithmic shape, not the code.
- **RULE:** a constraint wonky must obey.
- **STUDY:** read before building the matching feature.
- **REFERENCE:** data or spec to cite.
- **AVOID:** not suitable for wonky.
- **HISTORICAL:** background only.

"Note" links an existing deep-read note from another chapter where one exists. Otherwise it gives the primary URL.

| Source | Kind | Status (2026-09-24) | License | Verdict | Key idea | Note |
|---|---|---|---|---|---|---|
| wonky `sdf` prototype | prototype | judged 2026-09-23; retained for FDM analyses | private | KEEP (field, tape, rays); AVOID as a Boolean | Carrier-wise 1-Lipschitz field, Lipschitz tape pruning, MDC with vertices solved onto tagged carriers; 47/216 wrong `ok` | [../proto-sdf.md](../proto-sdf.md) |
| Fidget (Keeter) | library | active; 494 stars; last push 2026-09-12; v0.5.0 | MPL-2.0 | ADOPT-PATTERN (ideas only) | Hash-consed DAG → u32 bytecode → interval pass with a choice stack → backward simplification; all backends bit-agree | [note](sources/fidget-matt-keeter.md) |
| MPR (Keeter, SIGGRAPH 2020) | paper + code | code last commit 2020-07-25; 220 stars | code MPL-2.0 per README (no LICENSE file) | ADOPT-PATTERN | 64x fan-out per level so every warp runs one shortened tape; tapes 17x/216x shorter at 64²/8² | [page](https://www.mattkeeter.com/research/mpr/); local `tmp/research/pdf/keeter_mpr20.pdf` |
| libfive + Studio | kernel | maintenance mode; last push 2025-11-12; 1,666 stars | MPL-2.0 core; GPL-2.0+ Studio, Guile | ADOPT-PATTERN (Feature tie evaluator, collapse tests); AVOID code | Directed-rounding float intervals; epsilon-cone `Feature` resolves min/max ties at f = 0; MDC mesher | [note](sources/libfive.md) |
| Lipschitz Pruning (Barbier et al., EG 2025) | paper + code | code 27 stars, last commit 2026-04-08 | MIT (code); paper CC BY | ADOPT-PATTERN | Hierarchical per-cell pruning from 1-Lipschitz bounds only, hard and smooth CSG; far-field subtrees become constant lower bounds; up to 629x | [page](https://wbrbr.org/publications/LipschitzPruning/); local PDF |
| Manifold Dual Contouring (Schaefer, Ju, Warren 2007) | paper | historical | paper | KEEP (in proto-sdf) | One vertex per surface component in a cell; topology-safe clustering | [PDF](https://people.engr.tamu.edu/schaefer/research/dualsimp_tvcg.pdf); local `schaefer_mdc_tvcg07.pdf` |
| Dual Contouring of Hermite Data (Ju et al. 2002) | paper | historical | paper | HISTORICAL (used) | QEF vertex per cell; octree cell/face/edge procedures | [PDF](https://www.cs.wustl.edu/~taoju/research/dualContour.pdf); local `ju_dc02.pdf` |
| Plantinga & Vegter, isotopic approximation (SGP 2004) | paper | historical | paper | ADOPT-PATTERN (depth cap + uncertified label) | Interval subdivision gives isotopy for smooth surfaces; the paper proposes a max level plus colour-coded uncertified regions | [PDF](https://pure.rug.nl/ws/files/2952308/2004ProcGeomProcPlantinga.pdf); local |
| Curv | kernel | Codeberg active (2026-09); GitHub archived 2023-09-27 | Apache-2.0 | RULE (field taxonomy); AVOID its meshers | exact / bound / mitred field classes; user-declared `lipschitz k`; megakernel register cliff; union seams (#145) | [note](sources/curv.md) |
| Quilez, distance functions | blog | maintained | article | REFERENCE | Catalogue of primitives and operators, each labelled exact or bound | [article](https://iquilezles.org/articles/distfunctions/) |
| Quilez, interior SDFs | blog | maintained | article | RULE | min/max CSG: correct exterior, wrong interior; breaks offsets and shells | [article](https://iquilezles.org/articles/interiordistance/) |
| Hart, Sphere Tracing (1996) | paper | historical | paper | RULE (used in `fdm.bend`) | Lipschitz step bounds; Lipschitz constants for CSG, blends, deformations | [PDF](https://graphics.stanford.edu/courses/cs348b-20-spring-content/uploads/hart.pdf) |
| Shapiro, R-functions (Acta Numerica 2007) | paper | historical | paper | STUDY (for O1) | Smooth, normalised implicit Booleans; implicit from B-rep or CSG ("inverse problem") | [PDF](https://spatial.engr.wisc.edu/wp-content/uploads/sites/715/2014/04/2007-1.pdf); local `shapiro_rfunctions_2007.pdf` |
| Dreams renderer (Evans, SIGGRAPH 2015) | talk | historical (shipped) | talk | STUDY (war stories) | 1 to 100k soft-min edits; hierarchical 4x4x4 culling; fp16 83³ blocks; many abandoned renderers (sweep) | [PDF](http://advances.realtimerendering.com/s2015/AlexEvans_SIGGRAPH-2015-sml.pdf); local `evans_dreams_s2015.pdf` |
| `Manifold::LevelSet` | library | very active (last push 2026-09-24) | Apache-2.0 | REFERENCE | BCC marching tetrahedra; explicit per-vertex `tolerance`; no true-distance or continuity requirement | [note](sources/manifold-elalish-manifold.md) |
| Zint et al., feature-preserving offsets (SGP 2023) | paper | new-ish | paper | STUDY (if B-rep offsets ever need meshing) | Topology-adapted octree; 100% watertight 2-manifold on Thingi10k (sweep) | [DOI page](https://diglib.eg.org/items/4cf0d574-5939-405c-8352-66a987c0b235) |
| Topological Offsets (Zint et al. 2024) | paper | new | paper | STUDY | Combinatorial offset in a background tet mesh, then moved to the target distance (sweep) | [arXiv](https://arxiv.org/abs/2407.07725) |
| Cao et al., robust feature-preserving offsets (2024) | paper | new | paper | STUDY | Geometry before connectivity; claims the first sharp-feature mitred offset, both directions (sweep) | [arXiv](https://arxiv.org/abs/2412.15564) |
| Occupancy-based DC (Hwang & Sung 2024) | paper | new | paper | STUDY | DC from inside/outside queries only; GPU-parallel; watertight (sweep) | [arXiv](https://arxiv.org/abs/2409.13418) |
| Ju & Udeshi, intersection-free contouring (2006) | paper | historical | paper | STUDY (only if meshing returns) | Constrained vertex placement plus triangle subdivision, no self-intersections (sweep) | [PDF](https://www.cs.wustl.edu/~taoju/research/interfree_paper_final.pdf) |
| Dual Marching Cubes (Schaefer & Warren 2004) | paper | historical | paper | HISTORICAL | Marching cubes on the dual grid of a feature-adapted octree (sweep) | [PDF](https://people.engr.tamu.edu/schaefer/research/dmc.pdf); local `schaefer_dmc.pdf` |
| Affine arithmetic (Stolfi & de Figueiredo) | docs | historical | docs | STUDY (O3) | Noise symbols track linear correlation; tighter than intervals (sweep) | [page](https://www.ic.unicamp.br/~stolfi/EXPORT/projects/affine-arith/) |
| Sharp & Jacobson, Spelunking the Deep (2022) | paper + code | historical | code MIT (sweep) | STUDY | Interval/affine range analysis for guaranteed ray casting, closest point, intersection | [page](https://nmwsharp.com/research/interval-implicits/) |
| sdfx (deadsy) | library | active; last commit 2026-08-29; 631 stars | MIT | STUDY (FDM part library) | Go SDF CAD for 3D printing: screws, flanges, gears; MC and two octree DC renderers | [repo](https://github.com/deadsy/sdfx) |
| Point2CAD (CVPR 2024) | library | last push 2024-09-24; 458 stars | Apache-2.0 | STUDY (scan reverse engineering only) | Segment → fit analytic or INR patches → pairwise intersection for edges and corners | [repo](https://github.com/prs-eth/point2cad) |
| Keeter, QEF notes | blog | historical | n/a | HISTORICAL | Numerically stable QEF solving for DC (sweep); superseded by the carrier solve | [page](https://www.mattkeeter.com/projects/qef/) |
| Prospero challenge (Keeter 2025) | dataset | new | n/a | REFERENCE | Public benchmark: render a large text-as-SDF expression fast (sweep) | [page](https://www.mattkeeter.com/projects/prospero/) |
| ImplicitCAD | kernel | active (last push 2026-04-13); 1,578 stars | AGPL-3.0 | AVOID (license) | Haskell implicit CAD with a long meshing issue tail (sweep) | [repo](https://github.com/Haskell-Things/ImplicitCAD) |

## 5. What wonky should take (unverified, from sweep only)

**Context.** These proposals come after judge round 2. sdf produces no Boolean results, and Metal is off by default. The proposals target the retained field, tape and rays, and the hybrid's validators.

**Common gate.** Every proposal inherits the project rules:
- geometry is computed in Bend;
- results are byte-identical on JS, cpu1, cpu18 and, where used, Metal;
- approximations carry an explicit tolerance;
- unsupported cases fail explicitly.

Ranked by value for Marc's FDM parts per unit of effort (INFERRED).

### S1. Field-quality classes on every node, and explicit offset kinds

- **Idea.** Every field node carries three pieces of metadata:
  - a Lipschitz bound;
  - a sign class: exact or approximate;
  - a distance class:
    - `euclid`: a true distance;
    - `carrier-wise`: the current field, where each leaf is exact to its carrier and `min`/`max` combines them;
    - `bound`.

  Every operation declares what it needs:
  - Sphere tracing needs the Lipschitz bound.
  - The intersection-join offset `f − r` needs `carrier-wise` or better and is exact there.
  - A rounded (arc-join) offset, a numeric clearance distance, or a uniform-thickness shell needs `euclid`. Otherwise it refuses, or reports its error bound.

  Every FDM result carries its class.
- **The error of an intersection-join offset** relative to the rounded offset (INFERRED, elementary geometry):
  - **Where the error sits.** It is confined to edges that are convex *as seen from the side the offset grows into*. That means convex edges of the solid for an outward offset, and reflex edges for an inward offset (shell, shrink).
  - **Size.** With θ the wedge angle on that side, the join overshoots by up to r·(1/sin(θ/2) − 1):
    - 0.414 r at a 90° edge;
    - unbounded as θ → 0, i.e. spikes at knife edges;
    - at a trihedral cube corner, (√3 − 1) r = 0.732 r.
  - **Direction.** The error always adds material on the growing side:
    - An outward clearance grown on a tool and then subtracted leaves at least r everywhere. That is safe for fit.
    - An inner shell wall is at least t everywhere. That is conservative for thickness.
- **Where it plugs in.**
  - `kernel/proto/sdf/fdm.bend` → the production FDM module ([../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §5 rows "wall thickness" and "offset / shell / clearance hole", step 13).
  - The FeatureScript mapping of offset and shell requests, which must say which join the caller expects.
- **Bend fit.** A U32 class code and an F32 Lipschitz constant per node, propagated by the fold that already builds the tape. There is no per-sample cost.
- **Expected benefit.**
  - Quilez's interior bug can no longer hide in shells or clearances.
  - Every FDM number states its class and bound.
  - The khana-style "estimate" label ([fdm-geometry.md](fdm-geometry.md)) becomes machine-checked.
- **Risk.**
  - Users and LLMs coming from Onshape or OCCT may expect rounded offsets. Producing those exactly needs new B-rep geometry (cylinders, spheres and tori at edges and vertices; Rossignac & Requicha 1986, local `tmp/research/pdf/rossignac-requicha-1986-offsetting.pdf`), which is outside this topic.
  - The spikes at sharp convex edges (countersinks, gear tips) must be reported, not silently accepted.
- **First acceptance test.**
  1. With the existing OCCT oracle (`kernel/proto/sdf/tools/fdm-oracle.py`, test-only), build intersection-join and arc-join offsets for plate-through-hole +0.3 mm, enclosure-shell −0.2 mm, a unit cube +1 mm and a 30° wedge +1 mm.
  2. The sdf result matches the intersection-join reference within the mesh bound.
  3. The Hausdorff distance between the two OCCT offsets never exceeds the bound the label predicts: 0.732 mm for the cube, 2.86 mm for the wedge.
  4. A request for a rounded offset or a clearance distance on a `carrier-wise` field is refused with a named reason.

### S2. Certified F32 range bounds (a prerequisite for anything called a proof)

- **Idea.** Every range bound that decides something must be a proof. That covers a full or empty cell, a dominated branch, a sphere-tracing step, and a thickness violation.
  - **Derive the margin per operation and per carrier type** and document it as a lemma. [../proto-sdf.md](../proto-sdf.md) widens bounds "by an F32 rounding margin" but does not state the derivation.
  - **Implement** outward steps as U32 `nextUp`/`nextDown` on the bit pattern, or bound in F32x2 and round outward once.
  - **Metal may flush denormals** ([parallel-gpu-geometry.md](parallel-gpu-geometry.md) §2). Treat subnormal results as zero and widen the bound accordingly.
- **Where it plugs in.** `field.bend` `prune`, `octree.bend` `classify` and `fdm.bend` `march`. Also the interval-certified probe filter of the exact membership oracle, [fringe-kernels.md](fringe-kernels.md) F5.
- **Bend fit.** Pure U32 bit operations. They are identical on every target and need no rounding-mode control.
- **Expected benefit.** S3, F5 and the thickness violations become certified. This meets the rule "approximations need explicit tolerances". Fidget has no outward rounding, and libfive relies on a host FPU mode that Metal lacks (DOCUMENTED in the notes).
- **Risk.** A small slowdown, and wider bounds prune slightly less. MPR's "identical output" result is about rendering, not proofs, so it does not settle this.
- **First acceptance test.**
  1. A randomized differential test: 10^6 random cells for each carrier type (plane, cylinder, cone, sphere, torus, polygon prism), with coordinates up to 10^3 mm and cell sizes down to 2^-20 mm.
  2. At dyadic sample points in each cell, the exact value, computed in multi-limb arithmetic, lies inside the certified range. Zero violations.
  3. Byte-identical on all four targets.
  4. The change in pruning rate on the corpus is reported.

### S3. Pruned-tape census: a mesh-free broad phase and validator

- **Idea.** Run only the octree classification over a body's CSG field, with no meshing. For every ambiguous fine cell, emit the set of carriers that survive pruning. This is the realistic form of the scout's "choice records are free face labels" after the verdict. The census serves three uses:
  - **(a) A necessary-condition validator for recover.**
    - A recovered edge point with tags {a, b} must lie in a cell whose surviving set contains both a and b. A vertex with {a, b, c} needs all three.
    - The check is sound given S2: a face that is active at a point cannot be dominated over the cell containing it (INFERRED).
  - **(b) A thin-wall and thin-gap broad phase for [fdm-geometry.md](fdm-geometry.md)'s exact pair checks.** A cell where two carriers with opposite normals survive, and whose analytic separation is below t, is a candidate.
    - This sees the features the sdf mesher lost. The mesher decided topology from corner *samples*. The census decides from a *range*, and a sub-cell wall makes the range straddle zero (INFERRED).
  - **(c) Interference candidates.** Cells where the range of `max(f_A, f_B)` reaches below zero.
- **Where it plugs in.**
  - The recover certificate and the verifier-defect steps 1-3 ([../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §7-8).
  - fdm-geometry's exact wall and gap checks.
  - The step-13 `interference` and `clearance` pre-checks.
- **Bend fit.** The existing 8-way `O.build` fork on the CPU pool. Emit the census by prefix-sum compaction, not atomics. The sparse octree scaled only about 4-5x on 18 threads (measured).
- **Expected benefit.** An independent check of recover's tags that does not share corefine's tessellation. It also finds sub-cell features without meshing.
- **Risk.**
  - It covers CSG of primitives only; `brep` leaves have no field (O1).
  - `s√3` bounds on curved carriers are loose, so there will be many spurious pairs near cylinders.
  - The fine-cell memory on large parts is the same one that caused the Metal OOMs.
- **First acceptance test.**
  1. Zero necessary-condition violations on the 32 exact-STEP corpus results.
  2. Run the census on recover's 15 wrong "exact" STEP results from its adversarial suite and report how many it catches. Each catch is a certified WRONG.
  3. Each lost feature among the judge's sdf thin-feature cases yields at least one thin-wall or thin-gap candidate at its location. The cases: `adv-sdf-membrane-0.3`, `adv-sdf-rib-0.1`, `adv2-sdf-slot-0.4`, `adv-sdf-gap-0.02`, `adv2-sdf-enclosure-wall-1.2`, `adv-sdf-needle-hole`.
  4. Byte-identical on all targets.

### S4. Barbier-style per-cell tapes inside the thickness tracer

- **Idea.** `fdm.bend` sphere-traces thickness rays on the full tape. Instead:
  1. Build per-cell pruned tapes once, using the S3 octree or a coarse grid.
  2. Replace subtrees far from the surface by Barbier's constant lower bound.
  3. Evaluate the local tape and clamp each step to the cell exit.
- **Where it plugs in.** `fdm.bend` `march` / `trace!`, and `wallThickness` in plan step 13.
- **Bend fit.** The ray kernel stays a balanced tree of 64-ray batches. The cell lookup is a short descent: divergent, but cheap on the CPU pool.
- **Expected benefit.**
  - enclosure-shell now takes 2,406 ms (prep) + 2,751 ms (trace) on cpu18 for 1.14M rays (measured). Each step pays for every vent carrier.
  - Barbier reports up to 629x on 6,023-node scenes. wonky's tapes are small, so expect single-digit factors (INFERRED).
- **Risk.**
  - Cell-boundary stepping bugs: a pruned tape is valid only inside its cell.
  - The far-field constant must remain a lower bound, which needs S2.
  - The gain on small tapes is small.
- **First acceptance test.**
  1. The thickness output is byte-identical to today's (minimum, flagged triangle set and grazing count) on plate-blind-pocket, enclosure-shell and pipe-tee.
  2. Carrier evaluations per ray drop at least 3x on enclosure-shell.
  3. cpu1 and cpu18 trace times are reported.

### S5. Depth cap and uncertified regions for any implicit meshing

- **Idea.** If a mesher on the field is used again (previews, lattices, demos), follow Plantinga-Vegter:
  - Refine locally where the S3 census shows two or more carriers, or opposite normals.
  - Cap the depth in absolute millimetres, not as a fraction of the bounding box (libfive #562).
  - Return cells still ambiguous at the cap as an explicit uncertified set, never as `ok`.
  - PV's gradient test (0 ∉ ⟨∇F(C), ∇F(C)⟩) can certify single-carrier cells. At creases the carrier solve supplies exactness instead.
- **Where it plugs in.** `octree.bend` and a possible viewer preview path.
- **Bend fit.** The same 8-way fork.
- **Expected benefit.** It turns the sdf "returned `ok`" critical defects into labelled results.
- **Risk.** Low value while sdf meshing is retired. Do it only if a preview mesher is wanted.
- **First acceptance test.**
  1. The 12 mismatches (thin features, the far-apart small cubes, the cone apex, the needle hole) and the 2 global-cell timeouts in [../bakeoff.md](../bakeoff.md) "Verifier defects" all return `unresolved` or uncertified with a cell list.
  2. The 35 passing corpus cases still pass.

### S6. Canonical hash-consed field tape as a content address

- **Idea.** Adopt Fidget's `Context`:
  - dedupe by (op, sorted operands);
  - fold constants;
  - keep float constants as exact bit patterns;
  - emit a canonical tape and hash it into multi-word U32.

  Use the hash as a cache key for FDM analyses, as a diff unit for the viewer's review, and as an LLM-readable dump.
- **Where it plugs in.** Building CSG jobs from FeatureScript, FDM analysis caching, and [../topology-identity.md](../topology-identity.md) (provenance).
- **Bend fit.** Hashing in U32 is trivial. Hash-consing is canonicalization, not geometry, so it can live in the JS front end (INFERRED under the project rule).
- **Expected benefit.** Repeated subexpressions are evaluated once, and cache keys are stable across equivalent sources.
- **Risk.** proto-sdf merges coincident carriers with a tolerance (1e-5 of model scale). That is a geometric decision, not hash-consing. Keep it separate and labelled.
- **First acceptance test.**
  1. Two FeatureScript sources that differ only in operand order or local variable names give the same hash.
  2. `A ∪ A` canonicalizes to `A`.
  3. Changing any constant by one ulp changes the hash.

### S7. libfive's `Feature` tie evaluator as an add-on to the F5 oracle

- **Idea.** [fringe-kernels.md](fringe-kernels.md) F5 discards probes near a carrier. libfive's epsilon-cone `Feature` evaluator decides inside or outside *at* exact `min`/`max` ties: flush and coplanar faces, where corefine's wrong answers cluster. It uses a small symbolic perturbation and returns the set of normals at the edge.
- **Where it plugs in.** `scripts/bakeoff/arbiter.mjs` and the F5 oracle.
- **Bend fit.** Branchy but local. The cones are short lists of unit directions, and the signs are exact in multi-limb arithmetic.
- **Expected benefit.** The oracle answers exactly in the degenerate cases where it matters most.
- **Risk.** The perturbation convention must match corefine's (Manifold's `expandP`). Otherwise the two disagree by convention, not by error.
- **First acceptance test.**
  1. On the coplanar and flush corpus and adversarial cases, the oracle agrees with every arbitrated decision.
  2. Any convention-only disagreement is listed and explained.

### 5.8 Open questions worth a prototype (section 6, folded)

- **O1. A field for B-rep bodies.**
  - **The gap.** Production bodies are hybrid B-reps. The field exists only for CSG of primitives, which is why r10b is refused. `wallThickness` on an arbitrary body therefore has no field today.
  - **Options:**
    - Keep the FeatureScript feature tree as CSG wherever it is one.
    - Use an exact unsigned distance to the recovered faces, via a BVH, with the sign from membership. This is 1-Lipschitz but not smooth.
    - Use R-functions (Shapiro 2007). They need a Boolean formula for the B-rep, which is easy for convex decompositions and hard in general.
  - **Prototype.** Build a distance-to-B-rep field on the 32 recovered corpus results and compare its thickness rays with the CSG-field rays.
- **O2. Can range analysis certify a thickness *pass*?**
  - **Background.** A 1-Lipschitz bound field never overestimates distance, so −f(p) is an inscribed-ball radius at any inside point (INFERRED).
  - **Question.** Does covering every boundary point by an inscribed ball of diameter ≥ t turn some "estimate" results into proofs?
  - **Prototype.** plate-blind-pocket (2 mm floor, exact).
- **O3. Affine arithmetic versus Lipschitz widths for cylinders and cones.** Tighter bounds mean fewer spurious S3 pairs. Measure the census size both ways.
- **O4. Rays versus exact pairs as the violation finder.** This is [fdm-geometry.md](fdm-geometry.md) open question 7. S3 and S4 supply the data.

### 5.9 War stories and anti-proposals (section 4, folded)

- **Do not reopen SDF Booleans.**
  - The judge measured the losses: a 1.2 mm enclosure wall and a 3 mm base plate lost; a 0.4 mm slot and a 0.5 mm clearance closed; two 5 mm cubes 500 mm apart returned as empty. All of them came back `ok`.
  - "FDM parts are full of such features" ([../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §1, DOCUMENTED).
- **Do not use smooth-min blends as fillets.** They have constant maximum thickness, not constant radius (Curv article, DOCUMENTED).
- **Do not trust sampled meshers on coincident faces.**
  - Curv `#smooth` leaves internal seams in a union of two touching cubes ([#145](https://github.com/curv3d/curv/issues/145)). Moen: "I do not fully grok why union seams appear".
  - wonky's grid shift of 0.318 h is a workaround, not a proof.
- **Do not build a megakernel or ship the octree to Metal.**
  - Curv documents the register and I-cache "performance cliff".
  - proto-sdf measured 2.5-65x slowdowns and device stack overflows on non-tail recursion.
- **Do not tune QEF cutoffs.** Fidget's `1e-3` "alas" and libfive's `0.1` are the anti-pattern. Solve onto the known carriers instead.
- **Do not derive resolution from the bounding box.** libfive #562 is open, and wonky's `extent/64` emptied the far-apart cubes.
- **Do not allocate indices with atomics.** Manifold's `LevelSet` gave a different mesh in about 1 in 4 runs ([#1848](https://github.com/elalish/manifold/pull/1848)).
- **Do not read |f| of a min/max field as a distance.** It is a bound, and its interior is wrong (Quilez).
- **Do not copy MPL, GPL, AGPL or CC BY-NC code** (section 1.9).

## 7. Catalog of the remaining sources

None of these were deep-read. Metadata comes from `gh api` on 2026-09-24 where a repository exists; otherwise it is from the sweep.

- **Kobbelt et al., Extended Marching Cubes** (SIGGRAPH 2001). [PDF](https://www.graphics.rwth-aachen.de/media/papers/feature1.pdf).
  - Directed distances and normals per cell, with feature vertices. It is the precursor of DC's sharp features. HISTORICAL.
- **OpenVDB.** [repo](https://github.com/AcademySoftwareFoundation/openvdb): Apache-2.0, C++, 3,416 stars, last push 2026-09-23.
  - Sparse VDB tree with narrow-band level sets: CSG, offsets, dilate/erode filleting, mesh↔volume. Curv's `#smooth` mesher uses it.
  - Sampled, so it has no exact features. HISTORICAL for wonky.
- **Frisken et al., Adaptively Sampled Distance Fields** (SIGGRAPH 2000). [PDF](https://www.merl.com/publications/docs/TR2000-15.pdf).
  - Detail-directed octree sampling supporting CSG, offsets and carving. HISTORICAL.
- **Varadhan et al., max-norm distance and reliable voxelization** (2003-2004). [PDF](http://gamma.cs.unc.edu/RECONS/maxnorm.pdf).
  - L∞ cell-surface tests with topology guarantees for Boolean extraction.
  - STUDY only if S3's cell tests prove too loose; max-norm bounds on planes are what wonky already computes exactly.
- **Halfspace** (Keeter). [repo](https://github.com/mkeeter/halfspace): MPL-2.0, Rust, 35 stars, last commit 2026-09-12 ("borrow bytes in export path").
  - An IDE for distance-field solid modeling on Fidget; it co-designed Fidget 0.5.1's GPU pipeline. STUDY for UI ideas.
- **fogleman/sdf.** [repo](https://github.com/fogleman/sdf): MIT, Python, 2,006 stars, last push 2024-08-10 (inactive).
  - numpy batch evaluation plus marching cubes, with a popular gallery of printable examples. REFERENCE for the printable-part vocabulary.
- **saft** (Embark Studios). [docs.rs](https://docs.rs/saft/latest/saft/): MIT OR Apache-2.0. Last release 0.34.1 (2024-02). `gh api repos/EmbarkStudios/saft` returns 404.
  - SDF graph to bytecode interpreter plus GLSL codegen, about 3.2k lines of Rust (sweep).
  - A cautionary tale: the upstream vanished. HISTORICAL.
- **nTop implicit kernel** (nTop 5, 2024-06). [blog](https://resources.ntop.com/resources/blog/implicit-modeling-for-mechanical-design/).
  - Commercial; lattices, field-driven design, `.implicit` interop. All claims are marketing (sweep). Watch.
- **HyperFun / F-rep** (Pasko, Adzhiev, Sourin, Savchenko 1995). [site](https://hyperfun.org/).
  - The formal definition of F-rep on R-functions; largely inactive. HISTORICAL; read Shapiro 2007 instead.
- **Labelle & Shewchuk, Isosurface Stuffing** (SIGGRAPH 2007). [PDF](https://people.eecs.berkeley.edu/~jrs/papers/stuffing.pdf).
  - BCC tetrahedral meshing of implicit volumes with dihedral-angle bounds; rounds sharp features.
  - STUDY only if FEM meshing ever enters wonky (see [../simulation.md](../simulation.md)).
- **DC reference implementations.** [nickgildea/DualContouringSample](https://github.com/nickgildea/DualContouringSample): C++, 174 stars, last commit 2015-03-11, no licence file, README "free for any purpose". [emilk/Dual-Contouring](https://github.com/emilk/Dual-Contouring): public domain, last commit 2019-04-09.
  - Widely copied small DC codebases. HISTORICAL (wonky has its own).
- **Womp.** [site](https://womp.com/).
  - A commercial browser SDF modeller for consumers, with GPU raymarched soft Booleans. Out of scope.
- **MagicaCSG** (ephtracy). [site](https://ephtracy.github.io/index.html?page=magicacsg).
  - A closed, free non-commercial Windows SDF/CSG modeller with path tracing and mesh export. Out of scope.
- **AbFab3D** (Shapeways). [repo](https://github.com/AbFab3D/AbFab3D): NOASSERTION, Java, 73 stars, last push 2022-09-23.
  - Voxel and implicit toolkit behind ShapeJS. Abandoned; licence unclear. AVOID.
- **Antimony and kokopelli** (Keeter). [Antimony repo](https://github.com/mkeeter/antimony): MIT per README (no LICENSE file), C++, 2,190 stars, last commit 2025-10-12.
  - Node-graph and Python-scripted f-rep CAD, the predecessors of libfive. HISTORICAL.
- **Bauble** (Ian Henry). [repo](https://github.com/ianthehenry/bauble): MIT, Janet, 594 stars, last push 2026-05-25.
  - Live-coded SDF playground compiling to GLSL. HISTORICAL for wonky; a pleasant example of live parameter editing.
- **hg_sdf** (Mercury, 2016). Local copy `tmp/research/hg_sdf.glsl`.
  - Found in the local research tree; not in the sweep catalog.
  - A GLSL library of distance *bounds* and blend operators.
  - **CC BY-NC** (header line 16), so never copy it. AVOID code; REFERENCE for operator names.
