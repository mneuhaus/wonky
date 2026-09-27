# Bake-off prototype `sdf`: implicit CSG, interval-pruned octree, feature-exact Manifold Dual Contouring

Status: 23 September 2026. Prototype of the Boolean bake-off (docs/bakeoff.md),
input `csg` (`<case>.csg.job`: CSG tree, primitives, face table; no meshes).
All geometry is computed in Bend (`kernel/proto/sdf/*.bend`); JS only runs,
validates and reports.

**The output is an approximation with a stated tolerance, never exact
geometry.** Every result carries, after the result's `end` line, a stats line
`sdf h_nm … devc_nm … devs_nm … vol_mm3 …` with the achieved deviation measured
in Bend (see "Numeric model"). A mesh is returned only when that deviation is
within the case deviation and every internal check holds; otherwise the case is
refused with the reason.

**Result (run.mjs, all 38 cases, js/cpu1/cpu18/Metal, `--repeat 3`):
35 pass, 2 expected refusals, 1 unresolved.** Every non-`brep` case with an
expected solid or empty result passes; the two tangent-contact cases are
refused with `non-manifold contact`; `r10b-g10-union` is refused because its
leaves are `brep` bodies with no analytic CSG form. All four targets return
byte-identical results. Planar results are exact to F32 rounding (volume
error vs manifold3d ≤ 3e-13, tier `exact`). Curved results are chordal
approximations: sampled deviation 0.8–3.9 µm against the case deviation of
10 µm (4 µm for fine-spheres-50k), volume error vs the exact OCCT volume
5e-6–3.4e-4 relative, always inside the `area × deviation` bound. Native
compute takes 18 ms–1.7 s on 18 threads (2–4x over one thread). Metal is
slower than the CPU on every case and runs out of its 1 GB heap on the four
largest (they run with `--gpu 8GB`, byte-identical, see "Parallel structure").

## Algorithm

`main.bend` (`run` = `show(solve(parse(job)))`):

1. **Implicit field** (`field.bend`, `setup.bend`). Each row of the face table
   becomes a 1-Lipschitz carrier function `g` (negative inside its leaf):
   plane `n·p − d`, cylinder `|radial| − r`, cone `(ρ − r − h tan a) cos a`
   (distance to the generator line), sphere `|p − o| − r`, torus
   `|p − core circle| − r`. A convex primitive is the max of its faces
   (box, cylinder, cone, sphere, torus, convex prism). A non-convex prism
   (gear) is `max(poly, bottom, top)` with `poly` the exact signed 2-D distance
   to its polygon: per edge the side face's own plane function where the
   nearest point is interior, `±|q − a|` at a vertex with the sign of the
   vertex pseudo-normal (Bærentzen & Aanæs 2005, in 2-D); per cell the polygon
   is pruned to the edges that can be nearest there, and a polygon pruned to
   one edge becomes that side face's plane leaf. The CSG is
   union = min, intersect = max, subtract = max(a, −b) with the negation pushed
   to the leaves (De Morgan). The field `f` is 1-Lipschitz but not the
   Euclidean distance (max of planes underestimates it outside edges); only its
   sign and zero set are used as geometry. Coincident carriers of different
   leaves (coplanar tops, coaxial cylinders, A ∪ A) get one canonical id
   (tolerance 1e-5 of the model scale).
2. **Tape pruning over an octree** (`field.bend` `prune`, `octree.bend`
   `classify`/`build`). Over a closed cube with centre c and half size s,
   every sub-expression's range is `[g(c) − w, g(c) + w]` with `w = s·Σ|nᵢ|`
   for planes (exact) and `w = s√3` otherwise (Lipschitz), widened by an F32
   rounding margin. A min/max child dominated over the whole cube is dropped
   (libfive's "choices"); a cube whose range excludes 0 is a homogeneous leaf.
   The recursion goes to a fine level of cell size `h`; a cube whose pruned tape
   is a single plane — also over the cube three times its size (grading) — stops
   early as a *coarse* leaf with one vertex (the projection of its centre).
3. **Manifold Dual Contouring cells** (`octree.bend` `fine_leaf`). Corner
   signs (inside = f < 0), one crossing per sign-changing edge (regula falsi
   with the Illinois modification, 12 steps, on the pruned tape), and at the
   crossing the leaf of the min/max tree that attains the value: its **tag**.
   Face pairings split the cell's Marching-Cubes polygon into cycles (a
   checkerboard face keeps its inside corners apart — a rule both neighbours
   evaluate identically), one vertex per cycle (Schaefer, Ju, Warren 2007).
4. **Feature-exact vertices** (`solve`, `vertex`, `rediscover`, `fallback`).
   The vertex of a cycle is solved onto *every* distinct carrier that crosses
   the cycle: one carrier by Newton projection, two or three by damped
   Gauss–Newton (Levenberg–Marquardt, λ = 1e-3, 16 steps) from the mass point
   of the crossings. Accepted when the residual on all carriers and the CSG
   field there are below `tol` (1 % of the case deviation) and the point lies
   in the cell expanded by one cell (two for three-carrier corners). If the
   field is not ~0 at the solution, the leaf active there is added to the
   carriers and the vertex is solved again (a corner seen through two of its
   three faces; two rounds). Where three carriers meet in a double root (a
   face that pinches to zero width) each pair is tried and the best point
   within half the case deviation of all three is kept as an *approximate*
   vertex (counted in `approx`). Because each triangle is tagged with the
   crossing on its dual edge and each of its corners belongs to a cycle
   containing that edge, **every triangle corner lies on its tagged carrier by
   construction** (validator check `offSurfaceCorners` = 0 on every case).
5. **Corner and crease clustering** (`contour.bend` `merge_corners`). All
   cells whose cycles see the same three carriers solve to the same corner (up
   to an ulp); two cells can also put crease points 0.01 h apart. Corners are
   merged within `tol`, crease points within 0.1 h (creases only with creases,
   so a corner never moves). Collapsed quads become triangles or vanish. This
   is the vertex clustering of Manifold Dual Contouring restricted to exact
   features.
6. **Octree dual contouring** (`contour.bend`: `cell_proc`/`face_proc`/
   `edge_proc` of Ju, Losasso, Schaefer, Warren 2002). For every minimal edge
   with a sign change, the deepest of the four cells gives the orientation and
   the tag, each cell the vertex of its cycle containing the edge; the quad is
   split along the diagonal whose worse triangle agrees best with the tagged
   face's normal (no crease slivers). A homogeneous cell stops the recursion:
   its closed box has no sign change.
7. **Checks and retry** (`main.bend` `verdict`). Per triangle, the distance to
   its tagged carrier at the corners (`devc`) and at the edge midpoints and
   centroid (`devs`), folds (non-sliver triangles whose normal is > ~100° from
   the tagged face normal, or with coincident corners), gaps (a sign-changing
   dual edge without a vertex), vertex failures and contacts. A contact (two
   carriers of a cycle with opposite oriented normals at its vertex:
   zero-thickness wall or gap) refuses the case (`non-manifold contact`). Any
   other failure halves `h` (at most twice), then refuses with the reason.
8. **Grid choice.** `h = min(extent/64, √(r_min · deviation))`, `r_min` the
   smallest curvature radius among cylinder/sphere/torus minor radii and cone
   radii `min(r1, r2)/cos a`. The root cube (`h·2^D`) is centred on the CSG
   bounding box and shifted by 0.318 h, so grid planes avoid the "nice"
   coordinates of the models: measure-zero sets (a shared face of touching
   boxes, the zero set of A − A) are never sampled, which regularises the
   Boolean for free.

`fdm.bend` adds the FDM analyses (below); `native.bend` / `fdm-native.bend` are
the native drivers. `tools/` holds test infrastructure only (results table,
FDM demo runner and its OCCT oracle, the dense-sampling micro-benchmark).

### What each target runs

| target | build (octree) | contour, clustering, lists | FDM ray kernel |
|---|---|---|---|
| JS | sequential | sequential | sequential |
| cpu1 / cpu18 | `O.build!` on the CPU pool (`--gpu off`) | 8-way / 26-way fork trees | `trace!` on the CPU pool |
| Metal | `O.build!` on the GPU (one pass) | CPU | `trace!` on the GPU (one pass) |

All four targets produced byte-identical results (the harness checks
`targetsAgree`; only `+ − × ÷ √` in F32 are used, and the emitted C has
`#pragma clang fp contract(off)`).

## Upstream sources and licences

No code was copied; everything was written from the papers and from reading
the libfive sources, in Bend. libfive's core is MPL-2.0 (file-level
copyleft): had code been ported, the ported files would have to stay MPL-2.0.

| idea | source | here |
|---|---|---|
| interval evaluation with per-cell tape pruning ("choices" recorded at min/max, a shorter tape pushed for the subtree) | libfive `libfive/src/eval/eval_interval.cpp`, `tape.cpp` (`Tape::push`), Keeter 2020 "Massively Parallel Rendering of Complex Closed-Form Implicit Surfaces" (SIGGRAPH) | `field.bend` `prune`, `prune_min.k`, `prune_max.k`; Lipschitz bounds instead of full interval arithmetic |
| octree subdivision with early termination of empty/full cells | libfive `libfive/src/render/brep/xtree.cpp` | `octree.bend` `classify`, `build` |
| dual contouring on octrees: cellProc / faceProc / edgeProc, minimal edges | Ju, Losasso, Schaefer, Warren 2002 "Dual Contouring of Hermite Data" | `contour.bend` `cell_proc`, `face_proc`, `edge_proc`, `process_edge` |
| one vertex per MC surface component (manifold cells), vertex clustering | Schaefer, Ju, Warren 2007 "Manifold Dual Contouring" (IEEE TVCG; the brief calls it Lin/Schaefer); libfive's DC mesher `libfive/src/render/brep/dc/` | `octree.bend` `face_pairs`, `comps`, `cycle_vertices`; `contour.bend` `merge_corners` |
| sharp-feature vertices | QEF of DC / Extended MC (Kobbelt et al. 2001) | replaced by an exact solve onto the analytic carriers (tags make the planes exact, no QEF approximation) |
| fold-free adaptive contouring | Ju & Udeshi 2006 "Intersection-free contouring on an octree grid" (not implemented) | mitigated by grading and the quality diagonal |
| signed polygon distance with angle-weighted (here: 2-D) pseudo-normals | Bærentzen & Aanæs 2005 "Signed distance computation using the angle weighted pseudonormal" (IEEE TVCG) | `field.bend` `poly_eval`, `poly_keep`; `setup.bend` `poly_tape` |
| Lipschitz sphere tracing | Hart 1996 "Sphere Tracing" | `fdm.bend` `march` |

## Numeric model and guarantees

- All field and mesh arithmetic is F32 (correctly rounded, no FMA
  contraction), identical on JS, CPU and Metal. Reals from the wire are rounded
  once (`R.approx`); plane offsets `n·o` are formed in F32x2 first. Volumes
  are summed in F32x2 (`contour.bend` `triple`).
- Signs at grid corners are consistent between neighbours of any size:
  corner coordinates come from integer indices (`o + i·s`), and a pruned tape
  equals the full field bit for bit wherever it is valid (a dropped branch is
  dominated by more than the rounding margin).
- **Guaranteed by construction** (and confirmed by the validator on every
  returned mesh): watertight, consistently oriented (orientation from the edge
  sign), every triangle corner within `tol` (1 % of the case deviation; half
  the deviation for counted approximate vertices) of its tagged carrier.
- **Checked, not proven:** 2-manifoldness (MDC cycles give manifold cells;
  clustering and coarse/fine transitions are checked by the harness validator),
  absence of self-intersections (in Bend only a local fold test), the chordal
  deviation (sampled at corners, edge midpoints and centroids: `devs`; a
  sampled estimate, not a bound). Topology can be wrong where a feature is
  thinner than a cell; the harness compares components and Euler
  characteristic against manifold3d, and every returned mesh so far matched.
- **Volume:** the mesh is inscribed on convex curved faces and circumscribed
  on concave ones; the volume error against the exact OCCT value stays within
  `area × deviation` (the harness's analytic bound) on every passing case;
  planar results are exact to F32 rounding (tier `exact`).
- **Refusals** (`unresolved <reason>`): brep leaves (no analytic form on the
  csg wire), non-manifold contact, offsets/shells of non-convex prisms (FDM
  only), and any cell whose vertex cannot be placed within tolerance after
  two refinements (the reason lists the counts and the first failure).

## Parallel structure

- `O.build` forks 8 ways per internal cell (one 8-way parallel let per def;
  sequential lets per level made the CPU pool 15x *slower* in a probe). The
  classification of a child is computed by the child's own task (two fuel
  units per level, because Bend has no mutual recursion).
- `C.number` forks 8 ways (vertex bases from subtree counts), `C.cell_proc`
  forks its 8 children, 12 faces and 6 edges; `face_proc` 8 ways, `edge_proc`
  2 ways. `merge_corners` collects features with an 8-way fork, then sorts the
  few features sequentially.
- Sequential: parsing, setup, the vertex and triangle lists of the output mesh
  (`collect`, `flatten`) and the printer.
- Measured phase split (pipe-tee, 1 → 18 threads, idle machine): build 528 →
  130 ms, number 21 → 6, merge 44 → 40, contour 271 → 68, lists 66 → 69 ms.
  The octree is sparse and its 8-way forks are unbalanced (most children are
  homogeneous leaves), so build and contour scale ~4–5x on 18 threads; the
  serial list building then dominates.
- **Metal.** Shipping the whole solve to the device ran 100x slower or faulted
  (`memory fault (machine stack overflow?)`); the build alone (`O.build!`) runs
  in one pass and gives byte-identical meshes but is 2.5–65x slower than 18
  CPU cores: tape pruning is a recursive, divergent tree fold with list
  allocation per cell. Any non-tail recursion over a long list overflows the
  device stack (the 240-edge gear polygon did until `poly_keep` was made
  tail-recursive). The harness caps the device heap at 1 GB; the four largest
  octrees need `--gpu 8GB`. The FDM ray kernel (`trace!`, balanced tree of
  64-ray batches, flat loops at the leaves, the tape only read) is the uniform
  part: on Metal it is ~5x faster than one core but still slower than 18 cores
  (recursive tape evaluation per lane). A Metal-worthy version needs the tape
  flattened into a linear instruction list with a fixed register file (as
  libfive's evaluators do) and dense per-brick sampling; the micro-benchmark
  below shows that even then the M5 Pro's GPU only matches its 18 CPU cores.

Metal measurements (M5 Pro, `wonky_metal_passes` confirmed, compute phase in
ms):

| workload | cpu1 | cpu18 | Metal | note |
|---|---|---|---|---|
| sdf solve, pipe-tee (`O.build!`, 289k tris) | 1129 | 344 | 8653 (1 pass) | harness run, 1 GB heap |
| sdf solve, gear-48-bore (`O.build!`, 240-edge polygon) | 1075 | 323 | 20733 (1 pass) | ran only after `poly_keep` became tail-recursive (device stack overflow before) |
| sdf solve, hex-nut (406k tris, 3 grid tries) | 2249 | 739 | OOM at 1 GB; 3105 at 8 GB | 8 GB result byte-identical to cpu18 |
| sdf solve, enclosure-shell (1.14M tris) | 5224 | 1655 | OOM at 1 GB; 4148 at 8 GB | byte-identical |
| sdf solve, pin-array-chain-20 | 1383 | 419 | OOM at 1 GB; 1758 at 8 GB | byte-identical |
| sdf solve, plate-hole-grid-10x10 (959k tris) | 5735 | 1521 | OOM at 1 GB; 75634 at 8 GB | byte-identical |
| FDM thickness rays, enclosure-shell (`trace!`, 1.14M rays) | 17985 | 2751 | 3669 (1 pass) | uniform kernel, tape read-only |
| dense field sampling 512³ (`tools/bench-dense.bend`, 8⁵ bricks × flat 16³ loop, one `!` call) | 133–144 | 28–30 | 59–63 | 2²⁷ samples of sphere − box, hand-inlined field |
| dense field sampling 1024³ (same, `grid(6n, …, 24/1024)`) | 1090–1127 | 201–244 | 250–273 | 2³⁰ samples |

Even the ideal uniform kernel (dense bricks, straight-line field, no tape)
only reaches parity with 18 CPU cores at 2³⁰ samples on this machine; the
adaptive octree solve is 2.5–65x slower on the device than on the CPU pool (the gap is smallest on the largest octrees). The Metal
build of this prototype is therefore a correctness demonstration
(byte-identical output), not a speedup.

## Supported and unsupported

Supported: box, cylinder, cone (no apex on the result surface), sphere, torus,
convex and non-convex prisms, any rigid placement, union/subtract/intersect
trees of any depth, coplanar/coaxial/identical operands, touching faces,
internal voids, disjoint components, empty results. Faces that pinch to zero
width (hex-nut: the chamfer cone's top circle is tangent to the hex sides, so
the chamfer face has zero width at six points) are handled by the
approximate three-carrier vertex (within half the deviation, counted as
`approx` in the stats line: 114 of 203157 vertices on hex-nut), which needed
two grid refinements there (h = 46 µm, the most expensive case).

Not supported (explicit refusal): `brep` leaves (r10b); tangent/touching
contact (the expected refusals); offsets/shells of non-convex prisms (the
face-wise offset of the polygon distance is not implemented). Not detected in
general: features thinner than a cell (they vanish or merge; the retry only
reacts to failed vertices, gaps and folds). Dense fine-level surfaces cost
`area / h²` cells (no curvature adaptivity beyond the single-plane coarse
leaves).

## Results (run.mjs, M5 Pro 18 cores, `--repeat 3`)

`out/bakeoff/sdf/report.json` of 23 September 2026 (table via
`node kernel/proto/sdf/tools/table.mjs`). Times are the compute phase in ms (native: median
IO.now inside the binary; JS: warm median). Parse is 0–1 ms natively for the
csg job. The other teams ran their benchmarks at the same time, so absolute
times are noisy by up to ~2x (an earlier run on an idle machine: hex-nut JS
18.2 s instead of the 120 s timeout here, cpu18 pipe-tee 260 ms instead of
344). `h` is the fine cell size, `devs` the sampled chordal deviation
measured in Bend. The manifold3d tier is `off` on curved cases because
manifold3d Booleans the harness's own tessellation, a different chordal
approximation of the same surfaces; the analytic OCCT comparison is the
relevant one for this prototype. "error (OOM)" is the 1 GB Metal heap of the
harness; see the Metal table above for the same cases at 8 GB.

| case | verdict | h µm | tris | devs µm | vol err vs OCCT: abs mm³ / rel (bound mm³) | vs manifold3d rel (tier) | JS warm | cpu1 | cpu18 | Metal 1GB (passes) | cpu1/cpu18 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| leaf-cylinder | pass | 188 | 39732 | 0.92 | 0.157 / 1.2e-4 (6.8) | 2.0e-3 (off) | 945 | 121 | 40 | 1960 (1) | 3.0 |
| box-union-overlap | pass | 469 | 20998 | 0.00 | 0.000 / 3.5e-16 (32.0) | 3.5e-16 (exact) | 340 | 55 | 25 | 891 (1) | 2.2 |
| box-subtract-overlap | pass | 313 | 31302 | 0.00 | 0.000 / 2.8e-13 (27.0) | 2.8e-13 (exact) | 484 | 88 | 39 | 1360 (1) | 2.3 |
| box-intersect-overlap | pass | 234 | 16260 | 0.00 | 0.000 / 0.0e+0 (8.0) | 0.0e+0 (exact) | 320 | 53 | 84 | 784 (1) | 0.6 |
| box-rotated-intersect | pass | 313 | 41804 | 0.00 | 0.000 / 5.2e-9 (18.4) | 5.2e-9 (exact) | 889 | 116 | 39 | 1718 (1) | 3.0 |
| box-coplanar-union | pass | 469 | 18498 | 0.00 | 0.000 / 1.0e-15 (28.0) | 8.1e-16 (exact) | 305 | 49 | 25 | 1040 (1) | 2.0 |
| box-coplanar-subtract | pass | 313 | 25028 | 0.00 | 0.000 / 1.1e-13 (22.0) | 1.1e-13 (exact) | 456 | 78 | 32 | 1119 (1) | 2.4 |
| box-touching-merge | pass | 313 | 15044 | 0.00 | 0.000 / 1.1e-13 (10.0) | 1.1e-13 (exact) | 253 | 45 | 18 | 1038 (1) | 2.5 |
| box-touching-partial | pass | 250 | 16638 | 0.00 | 0.000 / 9.1e-14 (7.2) | 9.1e-14 (exact) | 283 | 47 | 25 | 820 (1) | 1.9 |
| plate-through-hole | pass | 179 | 67030 | 1.56 | 0.060 / 1.0e-5 (31.4) | 1.0e-4 (off) | 1362 | 162 | 55 | 2842 (1) | 2.9 |
| plate-blind-hole | pass | 158 | 62310 | 1.57 | 0.027 / 5.1e-6 (25.7) | 5.1e-5 (agree) | 1160 | 149 | 58 | 3372 (1) | 2.6 |
| plate-blind-pocket | pass | 625 | 16052 | 0.00 | 0.000 / 2.1e-14 (33.0) | 2.1e-14 (exact) | 262 | 47 | 20 | 860 (1) | 2.4 |
| plate-counterbore | pass | 130 | 93206 | 1.50 | 0.051 / 7.2e-6 (28.5) | 8.7e-5 (agree) | 1876 | 237 | 79 | 3423 (1) | 3.0 |
| plate-countersink | pass | 148 | 86188 | 1.59 | 0.047 / 9.1e-6 (25.6) | 9.4e-5 (agree) | 1755 | 222 | 82 | 2857 (1) | 2.7 |
| plate-4-holes | pass | 130 | 151826 | 1.54 | 0.103 / 1.3e-5 (48.2) | 1.1e-4 (off) | 3180 | 373 | 111 | 10573 (1) | 3.4 |
| plate-hole-grid-10x10 | pass | 122 | 959434 | 1.61 | 1.693 / 2.4e-4 (81.2) | 2.3e-3 (off) | timeout | 5735 | 1521 | error (OOM) | 3.8 |
| tilted-holes-17deg | pass | 141 | 147966 | 1.97 | 0.162 / 1.7e-5 (43.7) | 2.0e-4 (off) | 4021 | 450 | 150 | 8350 (1) | 3.0 |
| pipe-tee | pass | 173 | 289432 | 2.07 | 0.009 / 5.4e-6 (34.3) | 1.2e-3 (off) | 11234 | 1129 | 344 | 8653 (1) | 3.3 |
| steinmetz-intersect | pass | 156 | 42118 | 1.78 | 0.114 / 1.7e-4 (4.0) | 3.5e-3 (off) | 1626 | 174 | 72 | 2107 (1) | 2.4 |
| steinmetz-union | pass | 224 | 52466 | 2.99 | 0.516 / 2.1e-4 (11.7) | 1.9e-3 (off) | 2002 | 242 | 112 | 1587 (1) | 2.2 |
| coaxial-cylinder-stack | pass | 250 | 37654 | 1.23 | 0.349 / 1.2e-4 (11.6) | 1.5e-3 (off) | 1202 | 201 | 109 | 1022 (1) | 1.8 |
| sphere-minus-box | pass | 313 | 28090 | 3.86 | 1.013 / 3.4e-4 (11.0) | 1.2e-3 (off) | 922 | 107 | 47 | 1156 (1) | 2.3 |
| sphere-intersect-cylinder | pass | 265 | 37988 | 2.19 | 0.698 / 2.6e-4 (9.9) | 1.8e-3 (off) | 1140 | 133 | 48 | 1943 (1) | 2.8 |
| box-minus-sphere-cavity | pass | 250 | 51158 | 3.52 | 0.539 / 2.3e-4 (17.9) | 9.5e-4 (off) | 1878 | 204 | 103 | 482 (1) | 2.0 |
| hex-nut | pass | 46 | 406204 | 3.20 | 0.005 / 6.8e-6 (6.4) | 1.1e-3 (off) | timeout | 2249 | 739 | error (OOM) | 3.0 |
| enclosure-shell | pass | 112 | 1135894 | 1.68 | 0.169 / 8.9e-6 (187.1) | 5.4e-4 (off) | timeout | 5224 | 1655 | error (OOM) | 3.2 |
| gear-48-bore | pass | 200 | 237020 | 1.51 | 0.119 / 9.1e-6 (62.3) | 7.9e-5 (agree) | 18492 | 1075 | 323 | 20733 (1) | 3.3 |
| cylinder-tangent-box-face | expected-refusal | – | – | – | – | – | 2591 | 301 | 143 | 1265 (1) | 2.1 |
| hole-tangent-edge | expected-refusal | – | – | – | – | – | 1132 | 134 | 52 | 222 (1) | 2.6 |
| self-union | pass | 156 | 45636 | 0.77 | 0.091 / 1.2e-4 (4.7) | 2.3e-3 (off) | 1585 | 247 | 76 | 3252 (1) | 3.3 |
| self-subtract | pass | 156 | 0 | 0.00 | 0.000 / – (0.0) | 0.0e+0 (exact) | 354 | 81 | 31 | 1208 (1) | 2.6 |
| self-intersect | pass | 156 | 45636 | 0.77 | 0.091 / 1.2e-4 (4.7) | 2.3e-3 (off) | 1896 | 319 | 98 | 3070 (1) | 3.3 |
| internal-void | pass | 313 | 31416 | 0.00 | 0.000 / 2.9e-13 (30.0) | 2.9e-13 (exact) | 720 | 103 | 46 | 1509 (1) | 2.2 |
| disjoint-union | pass | 200 | 35148 | 1.62 | 0.150 / 1.0e-4 (9.5) | 8.6e-4 (off) | 1009 | 108 | 51 | 206 (1) | 2.1 |
| pin-array-chain-20 | pass | 100 | 378444 | 1.60 | 0.526 / 1.5e-4 (33.0) | 1.3e-3 (off) | 15700 | 1383 | 419 | error (OOM) | 3.3 |
| fine-spheres-50k | pass | 200 | 131128 | 1.62 | 0.861 / 1.3e-4 (7.0) | 4.3e-4 (off) | 5055 | 471 | 149 | 4259 (1) | 3.2 |
| torus-minus-box | pass | 173 | 86096 | 2.08 | 0.359 / 3.4e-4 (11.6) | 2.2e-3 (off) | 2594 | 363 | 115 | 1606 (1) | 3.2 |
| r10b-g10-union | unresolved | – | – | – | – | – | 0 | 0 | 0 | 0 (0) | – |

## FDM operations (`fdm.bend`)

| operation | field | notes |
|---|---|---|
| offset `r` | `f − r` | face-wise (mitered) offset: planes shift, radii grow by r; convex edges stay sharp (intersection-join offset in CAD). Exact identity, since min/max commute with `− r`. r < 0 opens holes and shrinks pins (print clearance). |
| shell `t` | `max(f, −(f + t))` | closed hollow body with walls of normal thickness t (inner carriers tagged `tag + F`) |
| interference | `max(f_A, f_B)` | the two operands of the root node intersected; its mesh volume is the overlap |
| thickness `t` | rays | from each triangle centroid inward along its normal, two-phase sphere tracing (steps `max(|f|, 1e-4)`, safe because f is 1-Lipschitz) to the exit; the exit face must face along the ray (grazing rays at rims are rejected and counted). Minimum and area thinner than t. A sampled estimate of local wall thickness, not a certified medial-axis minimum. |

Demonstrations (`kernel/proto/sdf/tools/fdm-demo.mjs`, native `fdm-native.bend`; OCCT references from `tools/fdm-oracle.py` (build123d/OCP via uv, test oracle only) on the intersection-join offset, shell and common solids; meshes checked with the harness validator against the job with shifted carriers; thickness times are prep (mesh) + trace (rays)):

| operation | case | parameter | result (sdf) | reference | mesh check | cpu1 ms | cpu18 ms | metal ms (passes) |
|---|---|---|---|---|---|---|---|---|
| offset | plate-through-hole | 0.3 mm | 6809.320 mm³ | 6809.260 mm³ (OCCT) | valid, 68076 tris, 1 comp., genus 1, max corner dist 0.00 µm | 399 | 130 | 3391 (1) |
| offset | enclosure-shell | -0.2 mm | 15349.289 mm³ | 15349.493 mm³ (OCCT) | valid, 1049532 tris, 1 comp., genus 1, max corner dist 0.00 µm | 11579 | 3264 | 6420 (1) |
| shell | box-union-overlap | 2 mm | 5264.000 mm³ | 5264.000 mm³ (exact, by hand) | valid, 48388 tris, 2 comp., genus 0, max corner dist 0.00 µm | 362 | 84 | 2434 (1) |
| shell | leaf-cylinder | 1 mm | 571.744 mm³ | 571.770 mm³ (OCCT) | valid, 74206 tris, 2 comp., genus 0, max corner dist 0.00 µm | 540 | 129 | 4233 (1) |
| interference | box-union-overlap | – | 1500.000 mm³ | 1500.000 mm³ (OCCT) | valid, 16260 tris, 1 comp., genus 0, max corner dist 0.00 µm | 106 | 40 | 952 (1) |
| interference | steinmetz-union | – | 666.551 mm³ | 666.667 mm³ (OCCT) | valid, 42118 tris, 1 comp., genus 0, max corner dist 0.06 µm | 580 | 82 | 2352 (1) |
| thickness | plate-blind-pocket | 2.5 mm | min 1.999 mm; 2848 of 16052 triangles (561.250 mm²) thinner than 2.5 mm; 0 grazing rays rejected | 2 mm (pocket floor 2 mm (exact)) | – | 63 + 109 | 27 + 7 | 991 + 157 (2) |
| thickness | enclosure-shell | 1.5 mm | min 0.999 mm; 2894 of 1135894 triangles (39.429 mm²) thinner than 1.5 mm; 204 grazing rays rejected | 1 mm (blind vent leaves a 1 mm membrane in the 2 mm wall) | – | 6129 + 17985 | 2406 + 2751 | 6304 + 3669 (2) |
| thickness | pipe-tee | 1.2 mm | min 0.999 mm; 281108 of 289432 triangles (3316.426 mm²) thinner than 1.2 mm; 1278 grazing rays rejected | 1 mm (pipe walls 1 mm (6-5 and 4-3)) | – | 1794 + 854 | 740 + 152 | 9290 + 264 (2) |

## Three ideas a hybrid should take from this prototype

1. **Tags make dual contouring exact on features.** Solving each cell's
   vertex onto the analytic carriers of the faces that cross it (instead of a
   QEF of sampled normals) puts every triangle corner on its tagged surface to
   1 % of the deviation, reproduces planar results exactly (box cases volume
   error 0) and gives the recovery stage exact per-tag regions and exact
   corner/crease points for free. With carrier discovery (add the face that is
   active where the vertex landed) the method finds corners the sampling
   missed. A hybrid's tagged mesh oracle could use this as a *second,
   independent* topology oracle for analytic CSG: grid sampling regularises
   coplanar, coincident and touching cases without symbolic perturbation, and
   a contact test (two carriers with opposite normals meeting) refuses exactly
   the non-manifold cases.
2. **Interval/Lipschitz tape pruning as a spatial index for surface–surface
   work.** The pruned tape of a cell is the exact list of faces that can matter
   there; cells with a single plane need no work, cells with two carriers are
   crease candidates, three carriers are corner candidates. This is the
   pair/triple candidate generator that analytic B-rep recovery needs (which
   tag pairs meet, where, and which ones pinch or touch), with conservative
   F32 bounds and no mesh at all.
3. **Implicit FDM analyses on the same tape.** Clearance offsets, closed
   shells and interference are one-line tape transforms that keep exact
   carriers (so the recovered B-rep can stay analytic: an offset plane is a
   plane, an offset cylinder a cylinder), and the Lipschitz field gives safe
   sphere-traced wall thickness (it found the enclosure's blind vent: a
   1.0 mm membrane) — cheap checks the kernel can offer before slicing. The
   ray kernel is the one uniform, embarrassingly parallel part of this
   prototype; on the M5 Pro it still does not beat 18 CPU cores, so the CPU
   fork tree should stay the default and Metal an option for larger GPUs.

## Reproduce

```sh
npm run bakeoff -- --proto sdf                                   # all cases, js,cpu1,cpuN,metal
npm run bakeoff -- --proto sdf --cases pipe-tee,hex-nut --targets js,cpu1
node --test test/proto-sdf.test.mjs                              # ~20 s
BEND_NO_TELEMETRY=1 .tools/bend-2.0.25/bin/bend kernel/proto/sdf/fdm-native.bend -o tmp/sdf/fdm-cpu
tmp/sdf/fdm-cpu --threads 18 --gpu off -- thickness 1200 fixtures/bakeoff/jobs/enclosure-shell.csg.job tmp/sdf/th.out
tmp/sdf/fdm-cpu --threads 18 --gpu off -- offset -200 fixtures/bakeoff/jobs/plate-through-hole.csg.job tmp/sdf/off.out
# Metal at a larger heap than the harness 1 GB (the four OOM cases), after a run built the binary:
out/bakeoff/sdf/build/metal --threads 18 --gpu 8GB -- fixtures/bakeoff/jobs/hex-nut.csg.job tmp/sdf/hex-nut.m8.r
node kernel/proto/sdf/tools/table.mjs        # results table from out/bakeoff/sdf/report.json
uv run kernel/proto/sdf/tools/fdm-oracle.py  # OCCT references for the FDM demos -> tmp/sdf/fdm-oracle.json
node kernel/proto/sdf/tools/fdm-demo.mjs     # FDM demos on cpu1/cpu18/metal, validated
BEND_NO_TELEMETRY=1 .tools/bend-2.0.25/bin/bend kernel/proto/sdf/tools/bench-dense.bend -o tmp/sdf/bench-dense.c   # then clang -DBEND_METAL=1 … as in docs/bakeoff.md
```
