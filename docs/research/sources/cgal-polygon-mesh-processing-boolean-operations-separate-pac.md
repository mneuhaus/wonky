# CGAL Polygon Mesh Processing: Boolean Operations (corefinement; its own package since CGAL 6.2)

- **Kind:** C++ header-only library package plus user manual.
- **Canonical URL:** https://doc.cgal.org/latest/PMP_Boolean_operations/index.html
- **Other URLs:**
  - Source: https://github.com/CGAL/cgal/tree/main/PMP_Boolean_operations. Shallow sparse clone at `tmp/research/cgal-sparse/PMP_Boolean_operations`, commit 4abd208f (2026-09-21).
  - Snap-rounding paper: Valque & Lazard, "Resolving self-intersections in 3D meshes while preserving floating-point coordinates", CGF 44(5) e70197 (SGP 2025), https://hal.science/hal-05242294. Local copy `tmp/research/pdf/valque-lazard-2025-snap.pdf` (+ `.txt`).
  - CGAL news entry for autorefine plus snap: https://www.cgal.org/2025/06/13/autorefine-and-snap/
  - Open PR "Boolean operations on triangle soups (non-manifold)": https://github.com/CGAL/cgal/pull/9363
- **Authors/org:** Sébastien Loriot, Léo Valque, Ilker O. Yaz (GeometryFactory, France), per the manual. Corefinement arrived in CGAL 4.10 (2017, Loriot). Iterative snap rounding came in CGAL 6.1 (Sept 2025, Valque/Lazard). The code moved out of `Polygon_mesh_processing` into its own package `PMP_Boolean_operations` in CGAL 6.2 (June 2026). DOCUMENTED (manual "Implementation History", `Installation/CHANGES.md`).
- **License:**
  - Every header carries `SPDX-License-Identifier: GPL-3.0-or-later OR LicenseRef-Commercial`, and `package_info/.../license.txt` says "GPL (v3 or later)". A commercial license is available from GeometryFactory. DOCUMENTED.
  - The CGAL repository as a whole reports `NOASSERTION` because it mixes GPL and LGPL packages.
  - Porting implication: transcribing or translating code would make wonky a GPL derivative. Treat it as **study-only**. The algorithmic ideas (patch classification around intersection edges, coplanar handling, and the snap-rounding heuristic from a CC-BY paper) can be re-derived. The test meshes under `test/.../data-coref/` are GPL data too, so use them for local testing only and do not commit copies into wonky. INFERRED.
- **Status (gh api, 2026-09-22):**
  - CGAL/cgal: 6,054 stars, 1,595 forks, 691 open issues, about 338 contributors (including anonymous).
  - Last push 2026-09-21. Releases v6.2 (2026-06-11), v6.2.1 and v6.1.3 (2026-09-04). CHANGES.md already lists 6.3 for December 2026.
  - Package size: about 20k lines of headers, 79k lines including tests, benchmarks and OFF test data.
  - Maturity: production. It is used by OpenSCAD (fast-csg, before Manifold), compas_cgal (Rhino/Python), and many research pipelines. DOCUMENTED (gh, issues).

## What it is

Boolean operations (union, intersection, both differences) on **volumes bounded by closed, oriented, self-intersection-free triangle meshes**, built on *corefinement*. The two meshes are refined until their intersection polylines are edges of both. The same core is reused for:

- `clip`/`split` by a plane, a box or a mesh;
- `intersection_polylines` (renamed from `surface_intersection` in 6.2);
- `autorefine_triangle_soup`, which resolves the self-intersections of one soup;
- mesh slicing;
- a mesh "kernel" (visibility kernel) computation.

DOCUMENTED (manual).

Hard input/output contract (DOCUMENTED, manual "Input and Output Requirements" and `corefinement.h` preconditions):

- **Preconditions:** `!does_self_intersect(tm)` and `does_bound_a_volume(tm)` for both inputs.
- **Manifold output only.** The output must be boundable by a manifold triangle mesh, so zero-thickness regions are rejected. "It is not possible to compute the union of two cubes that are disjoint but share an edge."
  - Such cases return `false` for that operation (the return value is `std::array<bool,4>`, one flag per operation).
  - If the output was meant to replace an input in place, the input is **left corefined** but not Booleaned.
  - Alternatives: `Nef_polyhedron_3`, or the `Non_manifold_output_visitor`, which returns a triangle soup.
- **Coplanar triangles:** "it is guaranteed that the triangulations of those triangles in the two corefined meshes will be identical", and all their edges are reported as intersection edges.

## How it works

The code paths below are all under `PMP_Boolean_operations/include/CGAL/Polygon_mesh_processing/`. Descriptions are DOCUMENTED from code and comments unless marked.

### 1. Broad phase

In `internal/Corefinement/intersection_impl.h`, `Intersection_of_triangle_meshes`:

- Face boxes of mesh B are intersected with edge boxes of mesh A, and vice versa. This uses `Box_intersection_d`, the Zomorodian-Edelsbrunner hybrid streamed segment tree with a cutoff.
- A comment says passing pointers into `box_intersection_d` is "about 10% faster".
- Identical faces and edges shared by both meshes are detected first and skipped (lines 1761-1900).

### 2. Narrow phase per (segment, triangle) pair

`intersect_triangle_and_segment_3.h` classifies the pair with exact orientation predicates into one of:

- the segment pierces the triangle interior;
- it hits a triangle edge;
- it hits a triangle vertex;
- it is coplanar.

The point is then associated with **all faces incident to the edge**, and for edge or vertex hits with all faces incident to the hit edge or vertex, so every face pair sharing the point agrees on one node id (lines 49-80).

Coplanar triangle pairs are filtered out and handled separately in `intersection_of_coplanar_triangles_3.h`. Their intersection boundary can have several segments, so a separate `Face_pair_and_int` key is used.

### 3. Intersection nodes are exact

This is the key numeric design, in `intersection_nodes.h`:

- Every new vertex is `Exact_kernel::Construct_plane_line_intersection_point_3(a,b,c, p,q)`: the plane through the three **input** triangle vertices, intersected with the line through the two **input** edge endpoints. It is never built from other constructed points.
- `Exact_kernel` is EPECK: a lazy DAG with a double-interval approximation and GMP rational fallback.
- In `add_new_node`, if the interval approximation of any coordinate is not within `Lazy_exact_nt::get_relative_precision_of_to_double()`, `p.exact()` is forced immediately.
- Only when writing the output are nodes rounded with `exact_to_double`. The comment on `call_put` says the rounded intermediate put "is useless and only useful to see something in debug".
- So with an EPICK input kernel (double points plus exact predicates), **all topology decisions involving constructed points are made on exact values**. Only the final embedding is rounded. sloriot confirms this: "For parts using only input points, EPICK is used. As soon as a construction occurs, an internal exact representation is stored and used for answering exactly predicates involving those points." (https://github.com/CGAL/cgal/issues/9154).
- **Algebraic degree** (INFERRED, confirmed for the rational form in Valque-Lazard §5): a node coordinate is a rational with numerator degree 4 and denominator degree 3 in the input coordinates.
- **Autorefinement only:** it also creates triple-plane nodes, the intersection of three input triangle planes, in `add_new_node(h1,h2,h3)`. The code carries a "TODO AUTOREF_TAG handle 4 and more faces intersecting (only 3 right now)" (intersection_impl.h line 1257).

### 4. Polylines

The node/edge graph is turned into polylines, cycles and isolated points using degree counting.

Special case: nodes created by "pinchements along an edge" have degree 2 in the graph but should have degree 3 (intersection_impl.h lines 1498-1600).

### 5. Split and retriangulate

`Visitor.h` (`Surface_intersection_visitor_for_corefinement`):

- **Edge split.** Each input edge is split at its nodes, sorted with `Less_along_a_halfedge`. That is `collinear_are_strictly_ordered_along_line` on exact nodes (`predicates.h`).
- **Face retriangulation.** Each intersected face is retriangulated independently with a `Constrained_Delaunay_triangulation_2<Projection_traits_3<EK>>`, i.e. a 2D CDT in the exact kernel, projected along the face's supporting plane, with the intersection segments inserted as constraints (Visitor.h lines 616-625, 1162-1661).
- Face work is independent per face. INFERRED: this is parallelizable, although the code is sequential.

### 6. Patch classification

`Face_graph_output_builder.h` does this in two steps.

**Step 1, patch ids.** A *patch* is a connected component of faces bounded by intersection edges (step "(1)", line 1059). Classification is **per patch, not per face**, stored in `boost::dynamic_bitset` masks (`is_patch_inside_tm1/2`, `coplanar_patches_of_tm1/2`).

**Step 2-a, around each intersection edge.** Take the incident triangles, 4 in the generic case: p1 and p2 from A, q1 and q2 from B. Sort them around the edge with the exact predicate `sorted_around_edge(o', o, p1, p2, q)`. It is built from two to three `orientation(o', o, ·, ·)` calls (predicates.h lines 60-100).

The comments say "the exterior of the volume is indicated by counterclockwise oriented faces (corrected by is_tmi_inside_tmi)". The cyclic order decides which of A's patches lie inside B and vice versa.

Coplanar coincidences (p1==q1, p1==q2, p2==q1, p2==q2) are enumerated as 8 explicit cases. "A coplanar patch is classified like the other incident patch since they bound the same volume."

Non-manifold outcomes are enumerated as cases (a4)-(f4). Each sets a bit in `impossible_operation` for exactly the operations that would be non-manifold. For example, case (e4) sets `UNION` when `poly_first ∩ poly_second = {0}` but they touch along the edge (lines 1640-1790).

Edges with 3 incident triangles (coincident faces) are handled separately, and 2 incident triangles means "no restriction".

**Step 2-b, isolated patches.** A patch with no intersection edge, i.e. a whole connected component that does not touch the other mesh, is classified by `Side_of_triangle_mesh<…, Exact_kernel>`. This is an AABB-tree ray-parity point-in-mesh test on the exact centroid of one face. `CGAL_assertion(position != ON_BOUNDARY)` guards it (lines 1840-2060).

- If a mesh is not closed, isolated components of the other mesh are all considered outside or inside, depending on orientation.
- Inside-out inputs, meaning closed but inward oriented, are detected with `is_outward_oriented` and flip the meaning of "inside".

### 7. Assemble

Per operation, bitsets pick which patches of A and B to keep and whether to reverse orientation (lines 2207-2290). Operations are scheduled so that out-of-place outputs are built before tm1, then tm2, are modified in place.

**Output coordinates are the double rounding of exact nodes.**

### 8. Chained operations

`corefinement_consecutive_bool_op.cpp` keeps a vertex property map of EPECK points next to the double mesh, so that the next Boolean reuses exact coordinates. The manual: "for consecutive operations, it is recommended to use a kernel with exact predicates and exact constructions." DOCUMENTED.

### 9. Iterative snap rounding (autorefine)

The `apply_iterative_snap_rounding` option is implemented in `internal/triangle_soup_snap_rounding.h` (Valque & Lazard 2025):

1. Round all points to double, repair the soup, and find all intersecting triangle pairs with exact predicates. If there are none, return `true`.
2. Snap grid:
   - Per axis, compute scale `s = 2^(gs − e − 1)`, where `e` is the binary exponent of the max |coordinate| on that axis and `gs = snap_grid_size`. The default is **23** and the maximum is 52.
   - Snap `x ↦ ceil(x·s − 0.5)/s`. This is a certified ceiling of an exact number: it refines the lazy interval and falls back to exact division if needed.
3. Snap every vertex of every intersecting pair. Also snap **every other vertex whose snapped image coincides with one of those snapped points** ("also round all vertices located in these cells"). Then repair the soup: merge duplicates, drop degenerate triangles.
4. Autorefine exactly, which adds intersection vertices, and round the new vertices to double. Iterate at most `number_of_iterations` times (default **5**). Return `false` if intersections remain.

The documented Hausdorff bound is `M · 2^-gs · k` for max coordinate M and k iterations.

INFERRED: with gs = 23 every snapped coordinate is `k·2^(e+1−23)` with |k| < 2^22, i.e. **exactly representable in F32**. The paper chose 24 ("finest grid on which rounded coordinates are exactly representable as floats"). The CGAL default of 23 leaves one bit of headroom.

Paper results on Thingi10K (DOCUMENTED, Valque-Lazard §4):

- Of 4,524 self-intersecting models, naive rounding fails on 527.
- On those 527:
  - iterative naive rounding fails on 273 after 1 h;
  - Zhou et al. 2016 fails on 48 (9%);
  - the new heuristic resolves all of them except model 996816, which needs gs = 14. On that model the relative error is 3·10⁻⁵, the L∞ Hausdorff distance is 3.1·10⁻³, it takes 38 s, and the exact arrangement would have 240M faces.
- Rounding *all* coordinates to float after autorefinement is much worse: 42% failures.
- The paper's non-flip argument:
  - The distance from a segment-triangle intersection point to the triangle boundary, in axis projections, is either 0 or ≥ Δ = 2^(−5k−4m−7) for a 2^-k grid bounded by 2^m.
  - The numerator has 144 monomials of degree 5 and the denominator 36 monomials of degree 3.
  - The coarse grid for the snapped vertices, versus the fine double grid for new vertices, makes flips "unlikely", but this is **not a proof**.

## Robustness and guarantees

DOCUMENTED (manual "Kernel Choice and Output Validity"):

| Kernel | Guarantee |
|---|---|
| exact predicates, inexact constructions (EPICK) | Terminates without crashing, and the graph has the right topology because exact constructions are used internally. The **embedding may self-intersect** after rounding. |
| EPECK | The embedding is exact as well. Needed for reliable chains of operations. |
| autorefine plus snap rounding | If it returns `true`, the output is **certified intersection-free**, because the intersection test uses exact predicates. It is heuristic in the sense that it may return `false`. |

Heuristic or unguaranteed parts:

- **Termination of snap rounding** is not proven. It is bounded by the iteration count and reports failure. DOCUMENTED.
- **Non-manifold results** are refused per operation. The failure is explicit (a flag), but the in-place input is left corefined. DOCUMENTED.
- **Input validity is a precondition, not a check.** Self-intersecting or non-volume inputs are UB-ish. Only `throw_on_self_intersection` checks, and only the triangles near the intersection. DOCUMENTED (named parameter doc).
- **Output order is not deterministic across builds.** Debug and release produce different vertex and face orders from the same input, attributed to `unordered_map` iteration order (https://github.com/CGAL/cgal/issues/6363, open). DOCUMENTED (issue).

## Parallelism and performance

- **Core corefinement is sequential C++.** Parallelism exists only in:
  - the self-intersection/autorefinement tests and the snap-rounding loops (`tbb::parallel_for` behind `Parallel_tag`);
  - user-level parallelism over independent Booleans. `corefinement_parallel_union_meshes.cpp` does a **balanced pairwise-reduction union tree** of 100 translated copies with `tbb::parallel_for` per level.
  - DOCUMENTED (code).
- **Snap rounding throughput** (Valque-Lazard Table 2, serial Xeon E5-1650 v4, DOCUMENTED):
  - about 133k input-arrangement vertices/s on trivial models and 53k/s on non-trivial models;
  - fits of 7.5 ms and 19 ms per 1000 arrangement vertices;
  - corefinement/autorefine intersection computation dominates.
- **Versus Nef polyhedra** (OpenSCAD fast-csg author's gist, https://gist.github.com/ochafik/2db96400e3c1f73558fcede990b8a355, which the author says "needs updating"):
  - 27x-178x on most models; 5x on chainmail; 12x on issue2342;
  - maze: >10 h vs 5 min 15 s.
  - DOCUMENTED as the author's measurements. fast-csg also skips Booleans between disjoint operands, so not all of the gain is corefinement. INFERRED.
  - Context PR: https://github.com/openscad/openscad/pull/4087
- **Third-party iterated-CSG numbers** (vendor-run Solidean blog; see `solidean-shaped-code-gmbh-exact-boolean-sdk.md`, HEARSAY until reproduced):

  | Benchmark | CGAL corefine | Others |
  |---|---|---|
  | 9-op sphere/torus chain, ~100k tris | 507 ms | Manifold 332 ms, Nef 477.7 s |
  | terrain carve, coplanar seams | 11 s | Manifold 525 ms, Nef 330 s |
  | iterated cube grid | declined at op 5 (non-manifold intermediate) | |

  Sources: https://solidean.com/blog/2026/first-benchmark-results-iterated-csg/, https://solidean.com/blog/2026/terrain-carve-benchmark/, https://solidean.com/blog/2026/iterated-cube-grid-benchmark/
- **Memory:** CGAL corefine runs out of memory at 62.5M vertices in Lévy 2024's ThingiCSG tables. See `geogram-brunolevy-geogram.md`. DOCUMENTED there.

## Known failures, limitations, war stories

- **Rounded embedding self-intersects** even with valid inputs. The maintainer's workaround is `remove_almost_degenerate` (threshold 100). https://github.com/CGAL/cgal/issues/9154
- **Chained EPICK differences crash; EPECK works.** Three axis-aligned cylinder subtractions meeting exactly at the origin segfault on the third call with EPICK, and "well under a second" with EPECK. https://github.com/CGAL/cgal/issues/9455. Also https://github.com/CGAL/cgal/issues/6481 ("can only do two steps", assertion `oxz_pqr != COLLINEAR`) and https://github.com/CGAL/cgal/issues/9282 ("works until it does not").
- **~1e-14 near-coplanar cutter faces produce a non-manifold result, and difference returns `false`.** Coordinates came from double transforms, e.g. `-80.000000000000043`. Shifting by 0.1 fixes it. Maintainer: a non-manifold connection between two volumes; "there is no magic way to resolve these tolerance issues". A snapping pre-process was prototyped in https://github.com/CGAL/cgal/pull/7994 (open since 2024). A soup Boolean handling non-manifold output is https://github.com/CGAL/cgal/pull/9363 (open). Main issue: https://github.com/CGAL/cgal/issues/9497
- **Collinear facets in union output** (not merged): https://github.com/CGAL/cgal/issues/5900. Exceptions in union: https://github.com/CGAL/cgal/issues/6273
- **Autorefinement handles at most triple-plane nodes.** Code TODOs note that tangency points "not handling it is a bug" (intersection_impl.h lines 1257-1300). DOCUMENTED.
- **Test catalogue.** `test/PMP_Boolean_operations/test_corefinement_bool_op.cmd` lists pairs with the *expected* manifold-feasibility flags for union / intersection / A−B / B−A. Examples: `star_tgt1-* × star_tgt2-*` tangencies, `cube_on_cube_edge`, `cube_on_cube_corner`, `edge_tangent_to_cube`, `coplanar_with_cube*`, `floating_squares × hexa`. The `data-snap_rounding/*.off` cases include `collapse_*`, `intersection_when_rounded_*`, `coplanar_cubes`. DOCUMENTED.

## Relevance for wonky

**Where it plugs in:** the leading bake-off design, a robust mesh Boolean deciding topology plus analytic recovery. Wonky's `kernel/proto/corefine` (Manifold-style symbolic perturbation) and `kernel/proto/exact-plane` (EMBER-style) are the two alternatives CGAL sits between. CGAL is the canonical reference for "exact predicates, exact nodes, rounded output". INFERRED throughout.

1. **Separate the three numeric roles explicitly.** CGAL has three:
   - (a) predicates on input points: filtered doubles, exact fallback;
   - (b) constructed nodes kept exact while topology is decided;
   - (c) a final rounded embedding that may be invalid.

   Wonky's constraints map this as follows:
   - (a) F32x2 interval filter plus multi-limb U32 exact fallback, as in `robust-predicates.bend`;
   - (b) nodes kept **symbolically** as (triangle-plane id, edge id) pairs, or as plane triples in exact-plane, instead of EPECK DAGs, which need heap-allocated lazy nodes and mutation. Predicates on nodes are evaluated as fixed-degree homogeneous polynomials in input integers (Attene-style indirect predicates; see `tmp/research/indirect-predicates`).
     - Degree budget: a segment/plane node is degree (4 numerator, 3 denominator). An `orientation` of four such nodes is a 4x4 homogeneous determinant of total degree ≤ 16.
     - With 24-bit grid inputs that is roughly 16·24 + log2(terms) ≈ 400 bits, about 13 U32 limbs. That is uniform fixed-width work per predicate and GPU-friendly.
     - EMBER's plane-based representation keeps this lower, 325 bits at B = 34 per `kernel/proto/exact-plane/big.bend`.
   - (c) rounding is an explicit, validated step with its own failure mode.
2. **Adopt the patch-classification structure.** Label connected components ("patches") bounded by intersection edges, and decide inside/outside **once per patch**:
   - from the cyclic order of the 4 triangles around an intersection edge (two `orient3d` calls per edge);
   - with one exact point-in-mesh query only for components with no intersection edge.

   In Bend:
   - patch ids are union-find or label propagation over face adjacency cut at intersection edges;
   - per-edge sorting is a map over intersection edges;
   - both are fork-join with no mutation.

   Wonky's corefine prototype already does union-find plus one vertical ray per component (Winding03). CGAL's edge-local rule is a cheaper, purely local alternative. The two agreeing is a free self-check.
3. **Coplanar and non-manifold policy.** CGAL's case table, the 8 coplanar cases and the (a4)-(f4) non-manifold cases each flagging the affected operations, is exactly the "explicit, per-operation failure" wonky needs. For FDM, the touching-cube cases (`cube_on_cube_edge`) are real: parts sharing an edge in a slicer means a zero-thickness joint. Wonky should return a typed `NonManifoldResult{op, edge ids}` rather than CGAL's silent `false` plus a corefined input.
4. **Identical triangulation of coplanar faces.** For recovery of exact analytic faces this is important. Two coplanar planar faces must be split identically, so the recovered B-rep has one shared face region with consistent provenance tags from both operands.
5. **Snap rounding onto an F32 grid (high value).** Valque-Lazard with gs ≤ 23 outputs coordinates **exactly representable in F32**. That is the right shape for wonky's F32 mesh outputs, meaning the print mesh, the viewer mesh and the tagged mesh fed to recovery:
   - snap only the vertices of intersecting pairs, plus co-cell vertices, onto the coarse grid;
   - keep new vertices on the fine grid;
   - iterate at most k times, with an explicit failure flag;
   - Hausdorff bound M·2^-gs·k, which is an explicit tolerance as wonky requires.

   Bend fit: the per-vertex snap and the co-cell propagation are map plus sort-unique (CGAL itself uses `sort` + `binary_search`). Intersecting-pair detection is the broad phase wonky already has. Only autorefinement is heavy.

   For wonky's F32x2 world the natural pair is **coarse grid = F32 (2^-24 relative) for snapped vertices, fine grid = F32x2 for constructed vertices**. That is the same coarse/fine discrepancy the paper credits for success. INFERRED.
6. **Chained operations.** The CGAL issues show that rounding between chained Booleans is where corefinement breaks (#6481, #9282, #9455). Wonky evaluates whole CSG trees (the bake-off jobs are CSG trees). Either keep symbolic/exact nodes through the tree (exact-plane does) or snap-round with validation after every level. Never feed a rounded, unvalidated mesh to the next level.
7. **Determinism.** Issue #6363 (debug vs release output differs) is a warning for wonky's diff/review tooling. Output order must be a pure function of input order, e.g. sort by (tag, canonical vertex key), never by hash-map iteration. Bend's lack of mutable hash maps helps here.
8. **Balanced union trees.** The `corefinement_parallel_union_meshes.cpp` pattern (pairwise reduction per level) is exactly Bend's fork-join shape for n-ary unions (patterns, fasteners, vent grids). It also keeps operand sizes balanced.

## Pointers worth porting or studying

- `internal/Corefinement/predicates.h`: `sorted_around_edge`, `p_is_below_q`, `are_triangles_coplanar_same_side`. These are the whole local classification kernel, about 200 lines.
- `internal/Corefinement/Face_graph_output_builder.h`:
  - lines 1059-1100: patch ids;
  - lines 1130-1790: edge-local classification including the coplanar cases 1-8 and non-manifold cases (a4)-(f4);
  - lines 1840-2060: isolated patches via exact point-in-mesh;
  - lines 2207-2290: per-operation bitsets.
- `internal/Corefinement/intersection_nodes.h`: the three specializations (double only / exact copy / exact kernel) and the "force exact if interval too wide" rule.
- `internal/Corefinement/intersection_impl.h`: lines 49-80 for the case analysis of segment/triangle hits and point-to-face propagation; lines 1498-1600 for polyline extraction.
- `internal/Corefinement/Visitor.h`: lines 1162-1661, per-face exact CDT retriangulation.
- `internal/triangle_soup_snap_rounding.h`: the complete snap-rounding loop, about 580 lines. It is simple enough to re-derive from the paper (§3 steps i'-vii').
- Valque-Lazard §5: the Δ = 2^(−5k−4m−7) non-flip bound and its degree counts, useful for sizing wonky's grids.
- Tests: `test_corefinement_bool_op.cmd` (expected feasibility flags), `data-coref/`, `data-snap_rounding/`, `test_coref_epic_points_identity.cpp` (input points preserved bit-exactly).

## Verdict: learn-from

CGAL's corefinement is the clearest documented statement of which guarantees need exact predicates and which need exact constructions. Its patch classification around intersection edges and its per-operation non-manifold flags are worth re-deriving. The Valque-Lazard snap rounding onto an F32-representable grid is the most directly adoptable idea: re-implement from the CC-BY paper.

Do not port code. It is GPL, and the EPECK lazy-DAG plus GMP model does not fit Bend: it needs heap DAGs, mutation and unbounded rationals. In wonky, exact nodes should be symbolic (input-plane/edge ids) with fixed-width multi-limb predicates.
