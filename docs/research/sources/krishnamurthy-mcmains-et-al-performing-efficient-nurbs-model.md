# Krishnamurthy, McMains et al.: GPU NURBS evaluation and surface-surface intersection

- **Kind:** research papers. No public code.
- **Main paper:** A. Krishnamurthy, R. Khardekar, S. McMains, K. Haller, G. Elber, "Performing Efficient NURBS Modeling Operations on the GPU", IEEE TVCG 15(4):530-543, 2009. DOI 10.1109/TVCG.2009.29. PDF: https://mcmains.me.berkeley.edu/pubs/TVCG09krishnamurthyMcMainsEtAl.pdf (local copy tmp/research/pdf/krishnamurthy-tvcg09-nurbs-gpu.pdf).
- **Conference version:** same authors, "GPU-Accelerated Surface-Surface Intersection (and trimming)", ACM Solid and Physical Modeling (SPM) 2008, pp. ~257-268. http://www.me.berkeley.edu/~mcmains/pubs/SPM08gpuSSI.pdf (local copy tmp/research/pdf/krishnamurthy-spm08-gpu-ssi.pdf).
- **Evaluation predecessor:** Krishnamurthy, Khardekar, McMains, "Direct Evaluation of NURBS Curves and Surfaces on the GPU", SPM 2007, pp. 329-334 (tmp/research/pdf/krishnamurthy-spm07-nurbs-eval.pdf). Follow-up: "Optimized GPU evaluation of arbitrary degree NURBS curves and surfaces", CAD 41(12):971-980, 2009.
- **Affiliations:** UC Berkeley (Krishnamurthy, Khardekar, McMains), SolidWorks (Haller), Technion (Elber).
- **License:** IEEE / ACM copyright on the papers; the algorithm itself is free to re-implement. There is no code release.
  - Krishnamurthy now runs the idealab-isu group at Iowa State. Its GitHub org has NURBSDiff (BSD-3, 55 stars, pushed 2025-12-15) and GPView (MIT), but no SSI code (DOCUMENTED: `gh api orgs/idealab-isu/repos`, 2026-09-22).
  - Porting implication: clean-room re-implementation from the paper is unproblematic.
- **Status:** finished academic work (2007-2011). The line continued into GPU Hausdorff distance, minimum distance/clearance and surface integrals (see Pointers).

## What it is

A GPU pipeline (fragment programs, pre-CUDA) for four NURBS operations:

- surface evaluation;
- inverse evaluation (point to (u,v));
- surface-surface intersection (SSI);
- self-intersection detection.

The central idea is to turn NURBS geometry into a uniform grid of guaranteed-enclosing axis-aligned boxes. After that, every query is data-parallel box work plus stream compaction. The target was interactive CAD feedback: sketching on surfaces, and live trimming at ACIS-level tolerance. (DOCUMENTED: TVCG09 abstract, sections 1 and 3.)

## How it works

**1. Grid evaluation** (TVCG09 section 3; SPM07)
- Each fragment evaluates one (u,v) sample with de Boor:
  - locate the knot span;
  - compute the nonzero basis functions;
  - multiply with the control-point submesh.
- Grids are 1024x1024 or finer, sized from the tolerance.
- Textures are full 32-bit float (SPM07). DOCUMENTED.
- First derivatives are exact:
  - basis-function derivatives are computed alongside the order k-1 basis functions de Boor already produces;
  - the quotient rule then gives the rational derivative.
  - Weights are assumed positive. DOCUMENTED (TVCG09 section 3.2).

**2. Guaranteed bounding boxes** (TVCG09 section 4)
- One AABB per grid cell, built from the 4 corner samples.
- It is expanded by the Filip, Magedson, Markot bound (CAGD 3(4), 1987): for a C2 surface sampled on an (n+1)x(m+1) grid, the deviation from the piecewise-linear interpolant is at most
  K = 1/8 (M1/n^2 + 2 M2/(n m) + M3/m^2).
  M1, M2, M3 are the max-norms of the second partials d2/du2, d2/dudv and d2/dv2 (eq. 12-15). DOCUMENTED.
- The second derivatives are approximated by central differencing on the grid. The maxima are found by a log(n)-pass max-reduction. DOCUMENTED (section 4).
- The paper says the boxes are "guaranteed to enclose the surface".
  - The M values come from central differences of samples, not from a rigorous bound over the continuous domain.
  - So the enclosure is only as good as that approximation. INFERRED (our critique, not discussed in the paper).
- Boxes get tighter automatically as the grid is refined.

**3. Inverse evaluation** (TVCG09 section 5)
- Test the query point or ray against all leaf boxes in one pass.
- Stream-compact the hits with a 2D prefix sum:
  - up-sweep and down-sweep over rows, then over columns;
  - scatter emulated by a vertex program writing to a VBO;
  - twice the storage.
- Refine locally until the parameter-space box is below 1e-6 absolute and the model-space box below 1e-3 relative, usually in 2-3 iterations. DOCUMENTED.

**4. Surface-surface intersection** (TVCG09 section 6.1; SPM08)
- *Box hierarchy:* each surface's leaf boxes are merged 4-to-1 into a hierarchy.
- *Traversal:*
  - the top level is tested on the CPU;
  - each deeper level is one GPU pass over the surviving box pairs;
  - pair addresses (u1,v1,u2,v2) are stored in "address textures" in 4x4 blocks;
  - survivors are compacted before the next level, whose size depends on how many pairs survived.
- *Leaves:*
  - each cell is split into 2 triangles;
  - triangle-triangle intersection is run on overlapping leaf pairs;
  - the segment midpoint is kept only if it lies inside the overlap of the two boxes; multiple hits in a cell are reduced to their centroid.
- *7-tuples:* every kept point carries (x, y, z, u1, v1, u2, v2), with the parameters obtained by barycentric interpolation on both triangles. DOCUMENTED.
- *Polyline assembly* happens in R^7 on the CPU:
  - Algorithm 3, greedy nearest neighbour, O(n^2): 0.20 s for 7,000 points at tolerance 2e-3 in TVCG09 (0.1 s in SPM08).
  - Algorithm 4, one-ring grid neighbourhood, O(n): 0.02 s. It left 320 single-point "polylines", which were discarded. DOCUMENTED.
- *Guarantee claim:* "if the arbitrary user-defined bounds are small enough, we are guaranteed not to miss any portion of the intersection curve" (TVCG09 p. 541). DOCUMENTED.

**5. Self-intersection** (TVCG09 section 6.2)
- Two instances of one surface's hierarchy are intersected against each other.
- Leaf pairs from the same subpatch are dropped. Any other surviving pair means the surface self-intersects.
- Timings: 0.42 s and 0.97 s at 2e-3. DOCUMENTED.

## Robustness and guarantees

- The output is a tolerance-bounded approximation, not an exact result. Points lie inside their box pair in both model and parameter space, so there is a positional bound. DOCUMENTED.
- There is no topological guarantee: "they will fail to recreate the correct topology when two unrelated intersection curves are very close on both surfaces", for example at branch points or where surfaces touch while locally flat. The authors suggest a CPU topology method. DOCUMENTED (p. 541).
- "Not missing" depends on K. K depends on approximated M values and on the C2 assumption, which fails at knots with lower continuity (INFERRED).
- Self-intersections smaller than the tolerance are rejected by design. DOCUMENTED.
- Precision: F32 textures throughout. The authors target ACIS's standard tolerance, 1e-3 relative, which F32 handles for moderate coordinate ranges (DOCUMENTED tolerance; INFERRED adequacy).

## Parallelism and performance

**Setup** (TVCG09 section 6.3, Table 1; SPM08 p. 266)
- 3 GHz CPU, 2 GB RAM, Quadro FX4500 512 MB, Windows XP.
- Two bicubic NURBS surfaces with 403x199 and 298x313 control points.

**Timing at 1e-3**
- 0.34 s total: 0.27 s evaluation, 0.05 s box tests, 0.02 s generating dense points.
- More than 40x faster than ACIS v18 while producing about 40x (TVCG09) or about 50x (SPM08) more curve points. DOCUMENTED.
- Evaluation dominates the cost. Box culling itself is cheap.

**Evaluation speedup** (SPM07)
- About 50x faster than the CPU for large grids.
- Slower than the CPU below about 16 points (transfer overhead). DOCUMENTED.

**Parallel shape**
- The work is perfectly uniform: per-sample evaluation, per-cell boxes, per-pair tests, prefix-sum compaction.
- Two steps are irregular and stay on the CPU:
  - top-level culling;
  - polyline assembly. The O(n) variant needs a spatial hash; the O(n^2) one is a scan.

## Known failures, limitations, war stories

- Wrong topology for close or branching intersection curves, and for tangential contact (above).
- Tiny self-intersection loops are missed.
- Algorithm 4 fragments the curve (320 orphan points), and the fix is simply to discard them. Proximity-based assembly is fragile.
- The C2 assumption and the approximated second derivatives make the "guaranteed" enclosure a practical rather than rigorous guarantee (INFERRED).
- No trimming-aware topology output: the result is polylines plus (u,v) correspondence, not B-rep edges.
- **Downstream CPU port (BRL-CAD libbrep).** BRL-CAD's NURBS SSI is explicitly "based on the 'NURBS Intersection Curve Evaluation' section" of this paper (DOCUMENTED: `doc/asciidoc/devguides/bool_eval_development.adoc` line 51; `src/libbrep/intersect.cpp` comment block around lines 2203-2244; local clone tmp/research/brlcad-libbrep, commit 97920fb).
  - The CPU adaptation works like this:
    1. Recursive 4-way surface split with bbox tests.
    2. Leaf patches become two triangles, intersected triangle-triangle in 3D and both UV spaces.
    3. Newton-Raphson refinement when a point is outside tolerance.
    4. Fit points to polylines by `max_dist` proximity, then to NURBS curves, with linear and conic simplification fits.
    5. Overlap cases are handled up front.
  - Its `triangle_intersection` treats coplanar triangles with `ON_NearZero` and averages the segment hits into a "center". These are the same tolerance- and proximity-based steps this note flags as the weak points (INFERRED).

## Relevance for wonky

- **The uniform pattern fits Bend:**
  - grid evaluation;
  - per-cell guaranteed boxes;
  - level-synchronous pair culling with a scan-based compaction between levels.
- Each stage is a map, a reduce (max of M) or a scan. These are balanced fork-join primitives with no mutation, and they suit the "uniform GPU work" allowance.
  - Compaction is an exclusive prefix sum followed by a gather. In Bend that is a tree scan, not a scatter; this avoids the VBO trick.
- **Rigorous K is cheap for wonky's surface types.** Plane, cylinder and cone have closed-form second derivatives.
  - Plane: M = 0.
  - Cylinder of radius r over angle span a, with u normalised to [0,1] (theta = a u) and z linear in v: M1 = r a^2, M2 = M3 = 0.
  - Cone: similar, bounded by the largest radius.
  - So wonky can state the enclosure as a theorem instead of relying on central differencing. Add an F32x2 rounding slack and the boxes are conservative (INFERRED).
- **The 7-tuple is the tagging wonky needs.** A point carries (x, y, z, u1, v1, u2, v2).
  - It matches the leading bake-off direction: a tagged mesh Boolean plus analytic B-rep recovery.
  - Every intersection vertex of the mesh Boolean should carry the source face ids plus both (u,v) values. Recovery can then fit or snap to the exact analytic curve: line, circle, ellipse, or a quartic plane-curve in (u,v) (INFERRED).
- **Do not copy the topology step.** Proximity polyline assembly is exactly where this approach fails.
  - Wonky should take curve connectivity from mesh adjacency (shared triangle edges after corefinement) or from exact analytic topology. It should never take it from nearest-neighbour chaining (INFERRED from the documented failure).
- **Precision:** 1e-3 relative is ample for FDM. F32 samples would do; F32x2 leaves headroom for the recovery fit. Exact decisions (which side, same curve or not) still belong to the multi-limb predicate layer.
- **Scope limit:** for plane/cylinder/cone pairs wonky should intersect in closed form. The sampling SSI earns its keep only for freeform or blended surfaces (future fillets, sweeps) and for compare/diff tooling (Hausdorff distance between the exact model and a mesh).

## Pointers worth porting or studying

- **TVCG09 section 4:** the Filip et al. bound, eq. 12-15. Re-derive it per surface type with analytic M.
- **TVCG09 section 5:** 2D prefix-sum stream compaction. Replace it with a Bend tree scan.
- **TVCG09 section 6.1:**
  - hierarchical box-pair culling with address textures, i.e. a pair-list representation per level;
  - the leaf triangle-triangle test with the "midpoint must lie in the box overlap" filter;
  - barycentric (u,v) tagging.
- **Filip, Magedson, Markot, "Surface algorithms using bounds on derivatives", CAGD 3(4):295-311, 1986/87:** the underlying bound; worth reading for curve and subdivision variants.
- **Follow-ups for tooling:**
  - Krishnamurthy, McMains, Hanniel, "GPU-Accelerated Hausdorff Distance Computation Between Dynamic Deformable NURBS Surfaces", CAD 43(11), 2011 (GD/SPM 2011).
  - "Hausdorff distance between NURBS surfaces using numerical iteration on the GPU", GMP 2012 / Graphical Models 74(4).
  - Krishnamurthy, McMains, Haller, "GPU-Accelerated Minimum Distance and Clearance Queries", TVCG 17(6), 2011.
  - "Accurate GPU-Accelerated Surface Integrals for Moment Computation", CAD 43(10):1284-1295, 2011. Relevant to mass properties.
  - All listed on https://mcmains.me.berkeley.edu/pubs.html.

## Verdict: learn-from

- Take the data-parallel structure:
  - analytic-bound boxes;
  - level-synchronous pair culling with scan compaction;
  - leaf triangle-triangle intersection;
  - 7-tuple (x, y, z, u1, v1, u2, v2) tagging.
- Replace the heuristic parts with analytic curvature bounds for plane/cylinder/cone.
- Reject proximity-based curve assembly.
- There is no code to adopt, and the target (interactive NURBS feedback at 1e-3) differs from wonky's exact-B-rep goal.
