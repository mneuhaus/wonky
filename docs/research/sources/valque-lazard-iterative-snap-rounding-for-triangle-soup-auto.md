# Valque & Lazard: iterative snap rounding for triangle-soup autorefinement (CGF/SGP 2025), and CGAL "Autorefine and snap"

- **Kind:** paper plus library implementation plus blog post.
- **Canonical URL (blog):** https://www.cgal.org/2025/06/13/autorefine-and-snap/ ("New in CGAL: Fixing Self-Intersections in Triangle Soups using Snap Rounding", Sébastien Loriot and Léo Valque, GeometryFactory, 2025-06-13).
- **Paper:** L. Valque, S. Lazard, "Resolving self-intersections in 3D meshes while preserving floating-point coordinates", Computer Graphics Forum 44(5), e70197, 2025 (SGP 2025). DOI https://doi.org/10.1111/cgf.70197.
  - Open copy: HAL hal-05242294, https://hal.science/hal-05242294v1, CC BY 4.0, 10 pages. Read in full; local copy tmp/research/pdf/valque-lazard-2025-snap.pdf.
  - The CGAL blog cites it as "Removing self-intersections in 3D meshes while preserving floating-point coordinates".
- **Code:** CGAL, package Polygon Mesh Processing / PMP_Boolean_operations:
  - `include/CGAL/Polygon_mesh_processing/internal/triangle_soup_snap_rounding.h` (585 lines, author Léo Valque, copyright 2025 GeometryFactory);
  - `include/CGAL/Polygon_mesh_processing/autorefinement.h` (1,773 lines).
  - Sparse clone at tmp/research/cgal-sparse, commit 4abd208, 2026-09-21.
  - Docs: https://doc.cgal.org/latest/Polygon_mesh_processing/index.html
- **Related:**
  - Zhou, Grinspun, Zorin, Jacobson, "Mesh arrangements for solid geometry", SIGGRAPH 2016: the predecessor heuristic.
  - Devillers, Lazard, Lenhart, "Rounding meshes in 3D", DCG 64(1), 2020: guaranteed, but impractical.
  - L. Valque, "3D Snap Rounding", PhD thesis, Université de Lorraine, Dec 2024, HAL tel-05016163. Access-blocked for automated fetch; not read.
- **Authors/organization:** Léo Valque and Sylvain Lazard (Inria Nancy / LORIA). Valque also implemented the CGAL version at GeometryFactory.
- **License:**
  - The HAL paper is CC BY 4.0, so ideas and equations are free to reimplement with attribution.
  - The CGAL code is `SPDX-License-Identifier: GPL-3.0-or-later OR LicenseRef-Commercial` (DOCUMENTED, file header).
  - Wonky is private and unlicensed. Copying or transliterating the CGAL code would pull GPL obligations onto any future distribution. **Reimplement from the paper.** The core loop is about 60 lines of logic, so nothing is lost.
- **Status:**
  - Published 2025; the paper says "new".
  - Shipped in CGAL 6.1 (tag v6.1, 2025-10-01) as `autorefine_triangle_soup(..., apply_iterative_snap_rounding(true))`. Maintained in 6.1.x and 6.2.x (v6.2.1 2026-09-04).
  - CGAL repo: 6,054 stars, pushed 2026-09-21.
  - Last functional change to the snap file: 2025-12-23 ("restore std::array as valid triangle"). The file moved packages on 2026-02-05.
  - All DOCUMENTED via `gh api`, 2026-09-22.

## What it is

It is a heuristic for one step: **rounding an exactly computed arrangement back to fixed precision without creating new self-intersections**.

**The pipeline**
- The input is a triangle soup with double coordinates.
- `autorefine_triangle_soup` (CGAL 6.0, Sept 2024) computes all triangle-triangle intersections exactly with the EPECK kernel. It subdivides triangles so that "no triangle intersects except along a shared edge or a shared vertex".
- The new intersection vertices are exact rationals and must be rounded back to doubles. Naive rounding re-creates intersections.

**The failure it fixes** (blog; DOCUMENTED):
- Out of 9,997 valid Thingi10K files, only 9,425 were intersection-free after autorefine plus naive rounding, which leaves 572.
- The paper counts differently: of the 4,524 Thingi10K models that self-intersect, naive rounding fails on 527 (about 12%). The brief's "529" appears in neither source.

**The fix** is to snap the vertices of still-intersecting triangles onto a **coarse uniform grid** (default: about 24 significant bits per axis), re-autorefine exactly, round the new vertices to doubles, and iterate a bounded number of times.

## How it works

### Algorithm (paper section 3, steps i'-vii'; DOCUMENTED)

1. **Grid.** For each axis, compute a tight power-of-two bound `2^m_axis` on the absolute coordinates. The grid G is centered at the origin with spacing `2^(-24+m_axis)`, i.e. the largest scaling that maps max |coord| into [2^23, 2^24), so every grid point is exactly a float.
2. **Find.** Identify all pairs of *properly* intersecting triangles with exact predicates, without constructing the intersections. Let V be their vertices.
3. **Grow.** Add to V every vertex lying in a grid cell that already contains a vertex of V. This prevents the Fig. 9 failure: a neighbour left unrounded in the same cell creates a new crossing.
4. **Snap.** Round every vertex in V to the **center of its cell**: scale by `2^(24-m)`, round to the nearest integer, scale back.
5. **Refine.** Recompute all intersections exactly and subdivide (autorefine).
6. **Round.** Round the new vertices to doubles.
7. **Repeat** steps 2-6 at most 5 times, or until no proper intersections remain.

**Error bound.** Each snap moves a coordinate by at most half a cell, a relative error of `2^-25`, about 3e-8. The Hausdorff distance between input and output is at most (relative error) × (max |coord|) × (number of iterations).

### CGAL implementation details (triangle_soup_snap_rounding.h; DOCUMENTED by reading)

**Loop order** (`polygon_soup_snap_rounding_impl`). Repeat for i < `number_of_iterations` (default 5):
1. Round all points to double (parallel with TBB if `Parallel_tag`).
2. `repair_triangle_soup`: merge duplicate points, drop degenerate and duplicate triangles, drop isolated points.
3. `triangle_soup_self_intersections` finds the intersecting pairs. **If there are none, return `true`.**
4. Collect the snapped cell centers of all vertices of intersecting triangles, then `sort` and `unique`.
5. Snap **every** point whose snapped cell center is in that set (`binary_search`). This implements steps (3) and (4) together.
6. Repair again, then autorefine.

After the loop, return `false`. The caller therefore gets an explicit success flag.

**Scaling**
- The code computes `scale = 2^(gs - n - 1)`, where `n` is the `frexp` exponent of the axis's max |coord|. The documented parameter `snap_grid_size` (gs) defaults to 23 and is capped at 52.
- `frexp` gives max |coord| in [2^(n-1), 2^n). So scaled coordinates land in [2^(gs-2), 2^(gs-1)), i.e. [2^21, 2^22) for the default.
- That is a grid about 4x coarser than the paper's [2^23, 2^24), and it does not match the doc string "scale the points to [-2^gs, 2^gs]". **INFERRED** from reading the code; not verified by running it.

**Certified rounding** (`double_ceil`)
- The snap is `double_ceil(x*scale - 0.5)/scale`.
- `double_ceil` first uses the interval approximation of the lazy exact number. If both interval ends have the same ceiling, that is the answer.
- Otherwise it forces exact evaluation and retries. For a fraction type it falls back to `div_mod(num, den)`.
- This is the "filter, then exact" pattern applied to *rounding*, not to a sign.

**Variants.** Alternatives kept behind macros, used for the paper's claim that "all the minor variations we have experimented with do not perform as well":
- naive;
- snap-to-closest-input-point per cell;
- snap-to-barycenter per cell;
- round-to-float.

**Visitor.** A visitor maps output triangles back to input triangle ids: `new_subtriangle`, `verbatim_triangle_copy`, `delete_triangle`.

### Why it works (paper section 5; the authors call it insight, not proof)

**Merging.** Coarse snapping merges nearby vertices and removes tiny triangles. On its own that "solves fewer problems than it causes".

**Flips are the main propagation mechanism** (Fig. 8). The authors bound the flip risk as follows:
- A segment-triangle intersection point has rational coordinates with numerator degree 4 and denominator degree 3 in the input coordinates.
- Its axis-projected distance to the triangle boundary has a numerator of 144 degree-5 monomials with coefficients ±1, and a denominator of 36 degree-3 monomials times a sqrt.
- With coordinates bounded by `2^m` on a grid of fineness `2^-k`, that distance is either 0 or at least **Delta = 2^(-5k-4m-7)**.

**What the bound implies**
- Snapped vertices sit on a 24-bit grid, and new vertices are rounded to 53-bit doubles. Flips are impossible only if the snap significand has p <= 9 bits.
- So there is **no guarantee** at p = 24. But the 29-bit gap between the snap grid and double spacing makes flips rare in practice.

**Why Zhou et al. fail.** Zhou et al. round to *floats* rather than a uniform grid, so spacing is much finer near 0. As evidence, 44 of the 48 models on which Zhou fails succeed after translating the model so all coordinates are > 1. Translating back re-rounds and breaks 30 of them.

## Robustness and guarantees

- **Certified output when it returns `true`:** the result is intersection-free under exact predicates (DOCUMENTED, paper section 4.1 and CGAL doc).
- **Bounded drift:** Hausdorff distance ≤ `M * 2^-gs * k`, with M the max |coord| and k the iterations (CGAL doc comment; paper section 3).
- **No termination guarantee.** The blog: "Even if there is no theoretical guarantee for successful termination, it performs well in practice." The paper: the insight "is far from yielding a guaranteed practical algorithm" (DOCUMENTED). The iteration cap turns non-termination into an explicit `false`.
- **No topology guarantee.**
  - Snapping can collapse small triangles and merge vertices.
  - The output is a soup and may be non-manifold.
  - CGAL issue #9192 (open, 2025-12-17): on two tetrahedra touching at a point, autorefine resolves the self-touch by producing non-manifold structure, and snap rounding can then no longer separate them. https://github.com/CGAL/cgal/issues/9192
- **The guaranteed alternatives are impractical:**
  - DLL20 (Hausdorff ≤ 3/2 grid units, topology preserved "up to collapse") is too complex to run on real models.
  - Valque's 2024 implementation of it fails on 35% (187) of the non-trivial models, or 6% (33) with relaxed guarantees. It processes about 100 vertices/s (paper section 2).
  - Goodrich et al. 1997 and Fortune 1999 are flawed or grid-size dependent. Fig. 3 gives a counter-example.

## Parallelism and performance

All measured on an Intel Xeon E5-1650 v4 (6 cores), serial implementation, CGAL EPECK (DOCUMENTED, paper section 4).

**Success rates on the 527 non-trivial models**
- Iterative naive rounding: 273 still fail after 1 h each. For 237 of those, intersections *grew*.
- Zhou et al.: fail on 48 (9%), capped at 20 iterations or 10 h. Only 5 of the 48 finish uncapped; 37 grow and 6 cycle.
- Valque & Lazard: 0 failures. 26 models needed 2 iterations and 3 needed 3.
- **Rounding everything to floats after autorefine is worse than naive rounding:** 42% of the 4,524 fail, 24% after iterating.

**Time**
- Linear in the size of the input arrangement:
  - trivial models: 7.5 ms per 1k arrangement vertices;
  - non-trivial models: 19 ms per 1k, i.e. about 53k vertices/s, versus 38k/s for Zhou and 29k/s for iterative naive (Table 2).
- Output size tracks the arrangement size, and is sometimes much smaller.

**Examples (Table 1)**

| Model | Input V | Output V | Iterations | Time |
|---|---|---|---|---|
| Medieval castle | 1.2M | 2.5M | 3 | 5 min 12 s |
| Spider cube | 355k | 2.1M | 1 | 2 min 26 s |
| Turbo Entabulator | 528 | 524 | 1 | < 0.01 s |

Both baselines fail on Turbo Entabulator.

**Model 996816** (76k V, 171k T; 25M intersecting pairs and triplets; exact arrangement of 30M V and 240M F)
- It fails at the default grid.
- It succeeds in 38 s with grid constant 14 instead of 24: relative error 3e-5, L∞ Hausdorff ≤ 3.1e-3, output 100k V and 245k F.
- Constant 15: 1 min 26 s and 280k V. Constant 16: 19 min and 4.8M V. Constant 17: over 1 h.

**Rotated cubes** (iterated Boolean intersection of randomly rotated unit cubes, 16 seeds)
- Iterative naive stops at 150 ± 96 cubes and Zhou at 288 ± 163.
- Valque & Lazard reaches 1090 ± 457 cubes after 40 h, with 7 of 16 runs still going at about 4 min per cube (≈750k V).

**Parallelism in CGAL.** The snap loop is TBB-parallel for rounding and membership. The pairwise-intersection step inside autorefine is sequential. Issue #8600 reports model 252786: 107 s total, 2.2M points and 11.5M triangles, with 29 s in that sequential step. https://github.com/CGAL/cgal/issues/8600

## Known failures, limitations, war stories

- **Coarse grid needed.** Model 996816 required a much coarser grid; the default fails.
- **#9192:** self-touching manifold input becomes non-manifold output, and the snap cannot undo it (see above).
- **#9497** (2026-05): consecutive Boolean differences fail when a cutter's coordinates carry ~1e-14 noise from Python double transforms, i.e. near-collinear or near-coplanar edges. `apply_iterative_snap_rounding(true)` "does not help". The cause is a non-manifold connection created by the subtraction, not a rounding issue. https://github.com/CGAL/cgal/issues/9497
- **No output-topology control.** The method fixes intersections, not orientation, manifoldness or solidity. Post-processing repair functions are "not yet ready to be released" (sloriot, #9192).
- **Doc vs code.** The scaling appears to differ between the doc string and the code (see above; INFERRED).

## Relevance for wonky

INFERRED unless marked.

### Where rounding from exact to finite precision happens in wonky

1. **Print mesh export.**
   - Binary STL stores **F32**. The certified-deviation print mesh must stay self-intersection-free *after* rounding to F32.
   - The paper's safety argument depends on a large gap between the snap grid (24 bits) and the output format (53 bits). With F32 output the same flip bound needs a snap significand of p ≤ 3 bits (solve `2^-(q+1-m) < 2^-(5p+7-m)` with q = 24). So the heuristic loses its main reason to work.
   - Mitigations:
     - (a) Export coordinates on a deliberately coarse FDM grid, e.g. 2^-10 mm ≈ 1 µm, which is far below printer resolution. On a ±256 mm bed that is 19 bits, exactly representable in F32. Validate the rounded mesh with exact predicates, and apply the snap-and-refine loop only on failures.
     - (b) Prefer 3MF, whose coordinates are decimal text and can carry more than F32 precision (HEARSAY/INFERRED: slicer-side parsing precision unverified).
   - Either way, the final rounded mesh gets an **exact self-intersection check**. Its F32 coordinates are exact rationals, so wonky's multi-limb predicates apply directly. The result is an explicit pass or fail, matching the "fail explicitly" rule.
2. **Hybrid Boolean** (tagged mesh decides topology, analytic recovery).
   - If intersection vertices of the mesh Boolean are exact (rational or homogeneous integers) and must be stored as F32x2 (about 48 bits), use a 24-bit-relative snap grid and 48-bit storage. That reproduces the paper's ~24-bit gap, so the heuristic should behave similarly.
   - Better: store Boolean-produced vertices exactly, EMBER-style plane-based or homogeneous integers, until an export boundary. Rounding then happens only once, at export.
3. **Repair of imported meshes** (scan-reverse-engineering workflow, Thingi-style STL inputs). The same loop is a practical self-intersection repair step.

### Bend fit

**Data-parallel, uniform stages** (fork-join maps plus a sort):
- round all points: a map;
- broad phase plus exact triangle-triangle predicates over candidate pairs: a map. The predicates have fixed limb counts because the coordinates are grid integers.
- snapped-cell key set: map, then merge sort, then unique;
- membership by binary search: a map;
- repair: sort-based duplicate merge.

**Non-uniform stage.** Autorefine is a per-triangle 2D constrained triangulation of its intersection segments.
- Triangles are independent, so it is a fork-join map with irregular work per element. Suited to CPU fork-join, not GPU.
- The data is immutable: each iteration produces a new soup, and ids are carried through for provenance, as with the visitor.

**The iteration cap** (5) keeps control flow bounded. That fits Bend and wonky's explicit-failure policy.

### Numbers for Bend (with B-bit grid coordinates)

- Intersection points: numerator degree 4 (about 4B+c bits), denominator degree 3 (about 3B+c bits). At B = 24 that is about 100 and 75 bits: 4 and 3 U32 limbs, or 7 and 5 16-bit limbs.
- Rounding a rational to the grid needs `floor(num/den)`, via:
  - an F32x2 interval filter first: same cell at both ends means done;
  - then an exact multi-limb division. Wonky's big.bend already has `div`.
- This mirrors `double_ceil` exactly.

### Tolerance policy

The Hausdorff bound `k × half-cell × sqrt(3)` is an explicit, reportable tolerance. Wonky should choose the snap cell from FDM tolerance, not from float bit counts, and report it in the export certificate.

### Testing

- **Thingi10K** (3D-printing models) is the standard corpus. The non-trivial IDs are torture tests for any wonky export or rounding step: 996816, 252786, 105867, 113422, 521600, 86324, 128001, 496388, 106838, 78227, and the Table 1 models.
- The **rotated-cubes** benchmark (count cubes until failure; CGAL has `benchmark/rotated_cubes_autorefinement.cpp` and `coplanar_cubes_autorefinement.cpp`) is a cheap, quantitative stress test to add to wonky's Boolean bake-off.

## Pointers worth porting or studying

- Paper section 3, steps (i')-(vii'): the whole algorithm. Step (iii') (grow V by shared cells) matters; without it one extra model fails and 46 need more iterations.
- Paper section 5: the Delta = 2^(-5k-4m-7) flip bound and the "uniform grid, not float grid" argument (Zhou's failures vanish after translation). Use it to reason about wonky's own grid-versus-storage precision gap.
- Paper Fig. 3: the Goodrich et al. counter-example, a unit test for any 3D snap scheme.
- Paper Tables 1-2 and sections 4.5-4.6: baseline numbers to compare against.
- CGAL `internal/triangle_soup_snap_rounding.h`:
  - `polygon_soup_snap_rounding_impl`: loop order, frexp scaling, the sort/unique/binary_search snap, and the macro variants;
  - `double_ceil`: certified rounding with a filter plus exact fallback.
  - Study only (GPL).
- CGAL `autorefinement.h` lines ~1600-1700: API contract (soup in, soup out, duplicate removal when snapping).
- CGAL benchmarks under `PMP_Boolean_operations/benchmark/` (Robustness, Quality, Performance scripts; rotated and coplanar cubes): a harness shape wonky can copy for its bake-off.

## Verdict: adapt

Reimplement the heuristic from the CC-BY paper, never from the GPL code, as wonky's **export-boundary and repair step**:
- exact check;
- snap the offending vertices plus same-cell vertices to an FDM-sized grid;
- exact re-refine;
- bounded iterations;
- explicit failure and a reported Hausdorff bound.

It is not a Boolean algorithm and gives no termination or topology guarantee. Wonky should prefer keeping Boolean results exact internally and round once. Note that the paper's success argument relies on a 24-vs-53-bit precision gap that F32 STL output does not have. That makes an exact post-rounding validation mandatory for wonky's print mesh.
