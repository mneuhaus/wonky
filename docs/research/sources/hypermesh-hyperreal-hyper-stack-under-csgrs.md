# hypermesh (+ hyperreal, hyperlimit, hypercurve: the Hyper stack under csgrs)

- Kind: library stack (Rust).
  - hypermesh is the exact triangle-mesh Boolean: https://github.com/timschmidt/hypermesh
  - The layers below it:
    - hyperreal: exact rationals plus computable reals, https://github.com/timschmidt/hyperreal
    - hyperlimit: policy-aware predicates, https://github.com/timschmidt/hyperlimit
    - hyperlattice: points and matrices, https://github.com/timschmidt/hyperlattice
    - hypertri: exact CDT, https://github.com/timschmidt/hypertri
  - Siblings: hypercurve, a planar curve kernel (https://github.com/timschmidt/hypercurve). The consumer is csgrs, a CSG grammar (https://github.com/timschmidt/csgrs).
- Clones read:
  - `tmp/research/hypermesh-hyperreal-hyper-stack-under-csgrs/{hypermesh,hyperreal,hypercurve}`: hypermesh HEAD `d9db5c45` (2026-09-04), hyperreal `b518ffb9` (2026-09-17), hypercurve `13b193f1` (2026-09-17).
  - `tmp/research/csgrs-hyperlimit`: `d64c3b89` (2026-09-12).
  - `tmp/research/csgrs`: `4e5b9ebb` (2026-09-17).
- Author: Timothy Schmidt (sole committer; `Cargo.toml` authors).
  - Development is agent-driven. Every repo has an `AGENTS.md` with pre-push rules written for coding agents. The benchmark evidence reads like agent-authored phase reports ("Phase 10 … Phase 17", `benchmarks/ember-replacement/*.md`). DOCUMENTED for AGENTS.md; INFERRED for authorship.
  - hypercurve alone is 369,550 lines of Rust (`wc -l`), which is implausible for hand-written code (INFERRED).
- License (DOCUMENTED via `gh api` and the `LICENSE` files):
  - hypermesh MIT; hyperreal Apache-2.0 (README also ships `LICENSE-MIT`); hyperlimit "MIT or Apache-2.0" (README); hypercurve MIT; csgrs MIT.
  - Transliterating algorithms or code into wonky is allowed. Keep the copyright notice (MIT) and the NOTICE/license text (Apache) for anything copied closely.
- Status (DOCUMENTED, `gh api repos/...` on 2026-09-22; re-checked 2026-09-24, unchanged):

  | Repo | Created | Last push | Stars | Forks |
  |---|---|---|---:|---:|
  | hypermesh | 2026-05-11 | 2026-09-05 | 7 | 1 |
  | hyperreal | 2026-04-23 | 2026-09-17 | 12 | 3 |
  | hyperlimit | 2026-05-04 | 2026-09-15 | 2 | 2 |
  | hypercurve | 2026-05-15 | 2026-09-17 | 5 | 2 |
  | csgrs | 2025-01-05 | 2026-09-17 | 255 | 33 |

  - hypermesh crate version 0.1.0. It has no issues filed.
  - Maturity: extremely young and single-author. Its claims are self-measured and have no outside users except csgrs.

## What it is

hypermesh is an exact Boolean for closed triangle meshes whose coordinates are `hyperreal::Real`, in practice exact rationals. It accepts N operands and evaluates arbitrary Boolean expression DAGs over **one shared arrangement**. The output is a triangle set with per-triangle source provenance. The contract is "certified or typed error": the implementation never repairs output. The README pipeline (DOCUMENTED, https://github.com/timschmidt/hypermesh/blob/main/README.md):

```text
closed PWN TriangleMesh views
  -> exact validation and source-face construction
  -> shared face corefinement + compact radial cell complex
  -> absolute winding vectors and Boolean truth DAG
  -> oriented boundary selection + exact output certification
  -> BooleanMeshBatch { one shared Point3<Real> arena, per-result u32 triangles + provenance }
```

History (DOCUMENTED, `benchmarks/ember-replacement/phase10-inventory.md`, `phase16-atomic-production-cutover.md`, `PERFORMANCE.md`):
- Until August 2026 the engine was **EMBER-style**: subdivision, segment tracing and local BSP, 30,578 production lines plus 31,599 lines of tests.
- On 2026-08-03 it was replaced wholesale by a **Zhou-Grinspun-Zorin-Jacobson "Mesh Arrangements for Solid Geometry" (2016)** style surface arrangement with radial cells and winding propagation. The cutover commit removed 83,934 lines and added 2,279.
- This is a documented bake-off result between two of the exact families wonky is also comparing.

## How it works

### Numeric model

- The scalar is `hyperreal::Real`. It is an arbitrary-precision `Rational` combined with symbolic and computable-real structure: sqrt, pi and trig evaluate lazily to a requested binary precision (DOCUMENTED, hyperreal README).
- f32 and f64 import is exact: the IEEE value is decoded, not reinterpreted as a decimal.
- Mesh Booleans use rational inputs, so in practice every arrangement coordinate is an exact normalized rational (DOCUMENTED: `ArrangementPointArena` comments "Exact-rational points have a complete identity/fingerprint schedule").
- Predicates live in hyperlimit (https://github.com/timschmidt/hyperlimit/blob/main/src/resolve.rs, `src/predicate.rs`) and are a cascade:
  1. structural facts: known zero or sign;
  2. exact rational reducers;
  3. certified filters: interval or ball;
  4. bounded computable-real refinement down to 2^-512.
- Each outcome is `Decided{value, certainty ∈ {Exact, Filtered, Approximate…}, stage}` or `Unknown{needed}`.
- `PredicatePolicy` is one byte:
  - `STRICT` means refinement must certify the sign, otherwise the result is `Unknown`, which hypermesh turns into `HypermeshError::PredicateUndecided`.
  - `APPROXIMATE_512` means that after certification is exhausted, `approximate_real_sign` takes a certified dyadic interval at precision 2^-512 and returns `Zero` if it straddles 0. It then marks the result `Certainty::Approximate`.
  - `resolve_composite_policy` always tries STRICT first and replays with the approximate policy only on `Unknown`.
  - DOCUMENTED, `resolve.rs` lines ~180-240.
- **Correction to the brief.** The 512-bit terminal is *not* a 512-bit integer sign evaluation. It is an absolute-magnitude cutoff on a lazily refined real: |x| < 2^-512 is treated as zero.
  - For rational inputs every sign is decided exactly before this terminal is reached. The Phase 17 report states "All exact rational fixtures in this checkpoint remain `Certified` under both policies" (DOCUMENTED, `phase17-path-complete-performance-checkpoint.md`).
  - The terminal matters only when coordinates contain irrational Reals, for example a sphere tessellated with exact sqrt/trig coordinates in csgrs.
- `MeshCertainty {Certified, Approximate512Consumed}` is aggregated over the whole operation through an operation-local `DecisionContext` and returned in `MeshOutcome<T>` (DOCUMENTED, `src/context.rs`).
- Floats appear only as (a) approximate keys that *order* work, such as BVH partition centres and seed-ray axis order, and (b) explicit lossy GPU export (`gpu.rs`, `approximate_gpu_mesh_f32`). "Approximate data may organize work, but it must never decide topology" (DOCUMENTED, PERFORMANCE.md header).

### Input contract

- The input is a non-empty slice of finite, closed, consistently oriented **PWN** (piecewise-constant winding number) triangle meshes.
- Directed-edge balance is checked exactly, and degenerate triangles are rejected with an exact non-collinearity test.
- Disconnected, nested, coincident, "balanced non-manifold" and winding-multiplicity components are accepted.
- Every failure is a typed `HypermeshError`: index, degenerate, open, imbalance, program, overflow or undecided (DOCUMENTED, README "Supported input and output").

### Symbolic construction identity (`src/polygon.rs`, `src/surface_arrangement.rs`)

Every arrangement vertex carries a canonical *construction identity* in addition to its rational coordinates:

```text
ConstructionPlaneIdentity { mesh: u32, plane: u32 }             // a source face's support plane
ConstructionEdgeIdentity  = Source { mesh, endpoints:[u32;2] }  // an input edge
                          | Split  { planes: [Plane; 2] }       // intersection line of two source planes
ConstructionVertexIdentity= Source { mesh, vertex }
                          | SourceEdgePlane { mesh, endpoints, plane }   // input edge ∩ other plane
                          | PlaneTriple { planes: [Plane; 3] sorted }    // three source planes
```

- `ArrangementPointArena::insert` deduplicates first by identity (a hash map) and then numerically, with an exact rational point interner.
- Two identities that materialize at contradictory coordinates are a hard error ("one construction identity materialized at contradictory points").
- Identity precedence is explicit: source vertices are inserted before intersection points.
- The same idea as EMBER's plane-based points is used here as a naming and dedup key, while the actual coordinates are still materialized rationals (INFERRED).

### Pipeline (`boolean.rs` → `surface_arrangement.rs`, 6,934 lines)

1. **Soup and validation** (`build_polygon_soup_internal`). Each source triangle becomes a `ConvexPolygon` with an exact support plane, vertex and edge identities, and a per-operand winding transition vector `delta_w` (one i32 per operand).
2. **Pairwise intersections** (`intersection.rs`, 5,064 lines):
   - An exact BVH (`bvh.rs`) proposes candidate face pairs.
   - Each candidate pair is classified once into a closed enum `PairwiseIntersection {Disjoint, NonCoplanarPoint, NonCoplanarSegment, CoplanarPoint, CoplanarSegment, CoplanarOverlap}`, and the result is reused reversed for the other face.
   - Shared authored features (a common input edge or vertex of adjacent triangles in one operand) are recognized by identity and elided (`pairwise_intersection_is_shared_input_feature`).
3. **Corefinement** (`corefine_surface`, `corefine_face`):
   - Every intersection event becomes a per-face constraint segment (with a `ConstructionEdgeIdentity`) or a contact point.
   - Coplanar overlaps are overlaid once (`coplanar_overlay`, clipping with edge half-planes) and pushed to both faces.
   - Points on source edges are fanned out to every face incident to that edge (`propagate_retained_source_edge_points`), which prevents T-junctions.
   - Each changed face is projected to 2D along its dominant axis, and constraint crossings are computed exactly (`intersect_arrangement_lines`; crossings get `PlaneTriple` identities).
   - The face is then triangulated by a constrained Delaunay triangulation (hypertri) and the result is lifted back.
   - Unchanged faces keep their triangle with no allocation (`FaceWork::is_changed`).
4. **Radial cell complex** (`assemble_surface_cells`):
   - Coincident facets from several sheets are bundled first (`bundle_surface_facets`). The contributions of one geometric facet carry per-sheet orientation.
   - Every facet edge use goes into a sorted list `(edge, facet, sheet, opposite vertex)`.
   - Around each edge the facets are sorted **radially** by `compare_radial_rays`. The key is the exact `orient3(edge0, edge1, left, right)` sign. When it is zero the tie-break is the sign of `(d×l)·(d×r) = |d|²(l·r) − (d·l)(d·r)`, computed as one signed product-sum over rationals (`exact_radial_perpendicular_dot_ordering`).
   - Antipodal or degenerate rays are hard errors.
   - Consecutive facet sides in radial order are merged with union-find (`CellDisjointSets`) into volumetric cells.
5. **Winding** (`classify_surface_cells`):
   - For each connected component of cells, one seed facet is chosen and its absolute winding vector is computed by an exact ray cast (`seed_surface_cell_winding`).
   - Rays try the 3 axis directions (ordered by approximate distance to the bounding box) and then the moment-curve family `(1, t, t²)` for t = 1..2(#triangles+#edges)+1.
   - A ray is accepted only if it provably avoids every facet edge. The finite family is guaranteed to contain a valid direction.
   - If only undecided predicates blocked all candidates, the result is `PredicateUndecided`; otherwise it is `SurfaceArrangementFailed`.
   - Windings then propagate across facets by BFS: `w_neighbor = w_current ± delta_w(facet)`, with checked i32 arithmetic that errors on overflow.
   - This is the same deterministic moment-curve reshoot that `verified-3d-mesh-intersection` uses (independent convergence, INFERRED).
6. **Expression evaluation** (`classify_expressions`):
   - `BooleanProgram` is either a built-in variadic op or a topologically ordered DAG of `False | True | Operand(i) | Not | And | Or | Xor | Operation(op)` nodes with any number of roots.
   - Each cell's truth is evaluated once per node.
   - A facet is emitted with orientation +1 if (front out, back in), −1 if (front in, back out), and dropped otherwise.
   - `exterior_inside` records whether the unbounded cell satisfies the root. Such results cannot be converted to a finite mesh and raise `UnboundedBooleanOutput`.
7. **Certification** (`certify_selected_surface_output`), checked exactly per result:
   - no repeated vertex index and no geometrically degenerate triangle (exact);
   - no duplicate unoriented triangle;
   - per-edge forward and backward use counts must balance;
   - `boundary_edges == 0`.

   Non-manifold edges are counted and allowed if balanced. Any failure is `OpenOutput{...}` or `SurfaceArrangementFailed{reason}`. The result is never repaired.
8. **Output**: `BooleanMeshBatch { vertices: Vec<Point3<Real>>, results: Vec<BooleanMeshResult{ triangles: Vec<[u32;3]>, sources: Vec<TriangleSource{mesh, triangle, orientation}>, exterior_inside }> }`.
   - Only vertices used by some requested result are kept.
   - Several roots (A∪B, A∩B, A−B, B−A) share the arena and cost one arrangement.

### Testing design (DOCUMENTED)

- `fuzz/fuzz_targets/boolean_box_oracle.rs` is an **exact volume oracle** for 1-4 random integer axis-aligned boxes:
  1. Compress coordinates per axis.
  2. Take the centre of each grid cell (doubled, to stay integer).
  3. Compute its winding vector against every box.
  4. Sum the cell volumes where `op.contains(winding)`.

  The Boolean result's exact signed volume must match.
- There are 8 libFuzzer targets and more than 1,100 permanent seeds.
- `benchmarks/corpus/fixtures.toml` is a monotonic registry: a failing input can be minimized but never removed. The tiers are micro, regression, competitive, scaling, heap and fuzz-seed.
- A CGAL EPECK adapter is used "as a performance and differential signal; competitor output is never the sole correctness oracle".

### Sibling: hypercurve (exact 2D curve kernel, v0.3.1)

DOCUMENTED, https://github.com/timschmidt/hypercurve/blob/main/README.md at `13b193f1`.

- **Carriers**: lines, circular arcs (including a `from_bulge` constructor), quadratic, cubic and rational Béziers, polynomial B-splines and NURBS, all with `Real` coordinates.
  - Rational curves keep homogeneous `(X, Y, W)` Bernstein controls as the authoritative form. The affine view is optional, so zero-weight controls survive splitting and degree elevation.
- **Region type**: `CurveRegion2` is the single filled-region type. It is stored as oriented boundary fragments.
- **Region operations**:
  - `boolean_regions` returns union, intersection, difference and xor from one evaluation, the same multi-root pattern as hypermesh.
  - `offset` requires an explicit `OffsetCornerStyle2`.
  - `straight_skeleton` construction is staged.
  - `translation_obstacle_convex` builds configuration-space obstacles for convex contours.
- **Corner edits**: `CurvePath2::{fillet_vertex_by_radius, chamfer_vertex_by_setbacks}` "enumerate exact solutions from design setbacks or radius; callers do not supply a preselected trim/contact answer". The latest commit is "Resolve fillet tangent orientation at each exact contact".
- **Contract**: predicates return `Classification::Decided(v)` or `Classification::Uncertain(reason)`, and exact failures carry a named "blocker". "Support is deliberately operation-specific. A curve family being representable does not imply that every topology operation is decidable for every symbolic input." Preview tolerances (`CurvePreviewOptions`) are kept apart from topology and "never exact topology or construction provenance".
- **Validation claims**: a public-Boolean matrix, "fourth-generation offsets" regressions, PCB corpora, and fuzz targets (README "Validation and performance"). All are self-reported.
- **Size**: 369,550 lines of Rust. INFERRED: almost entirely agent-written, and far beyond what one person can review.

For wonky (INFERRED):
- hypercurve is the reference for the *2D layer* under FeatureScript sketches: sketch regions, 2D offsets for FDM clearances, and vertex fillets and chamfers in sketches.
- The line/arc subset is what wonky's sketch solver emits. Exact line/arc arrangement with rational coordinates plus bounded sqrt for arc-arc points is tractable in multi-limb U32. NURBS support is not needed.
- Porting it is out of the question at that size. Study the API contracts instead: `Decided | Uncertain(reason)`, the separation of preview tolerance from topology, and all four region Booleans from one arrangement.

## Robustness and guarantees

- **Proven**: nothing is machine-checked. The guarantee is by construction: every topology decision is an exact or certified predicate, and the output is certified closed and balanced after selection (DOCUMENTED, README and `lib.rs` docs).
- **Explicit failure modes** (all typed errors):
  - undecidable predicate (only possible with irrational Reals);
  - "finite exact seed direction family did not avoid every facet and edge", which should be impossible by counting (INFERRED);
  - antipodal or degenerate radial rays;
  - contradictory identity materialization;
  - open or unbalanced output;
  - i32 winding overflow;
  - u32 index capacity overflow.
- **Semantics**: the result is the regularized set from exact cell truth. Lower-dimensional contacts (edge-touching, vertex-touching, face-tangent) are regularized and may yield *balanced non-manifold* output, which is accepted and reported (DOCUMENTED, README and corpus README).
- **Not guaranteed**:
  - Bounded coordinate size. Output vertices are exact rationals of arbitrary height, and chained Booleans grow them. There is no snap rounding (INFERRED from the absence of any rounding stage; the csgrs 116 GiB RSS war story below is consistent with it).
  - Mesh quality. The CDT is per face, and there is no global remeshing.
- `APPROXIMATE_512` is a documented, labelled approximation: `Approximate512Consumed` propagates to the result, so a caller can reject it.

## Parallelism and performance

All numbers below are DOCUMENTED and self-measured on a Ryzen 7 5800X3D (single CPU pinned).

- **Two overlapping exact boxes** (all four results from one arrangement), Phase 17:
  - hypermesh: 1.033 ms (STRICT) and 1.042 ms (APPROXIMATE_512).
  - CGAL 6.0.3 EPECK: 130 µs for the same four results.
  - That is **7.9-8.1× slower than CGAL**; the report calls it "an open Phase 17 deficit, not parity".
  - Non-exact controls: Boolmesh 63.6 µs and Manifold-rust 56.7 µs for a union.
- **Earlier cube-pair union** (24 triangles): about 2.3 ms (PERFORMANCE.md 2026-07-28 table).
- **YeahRight rotated intersection**, 11,894 × 11,894 triangles:

  | Engine | Time | Peak RSS | Result |
  |---|---:|---:|---|
  | Old EMBER-style engine | 3,312.66 s | 329 MB | exact empty |
  | Current arrangement | 48.02 s | 203 MB | exact empty, Certified |
  | CGAL EPECK | 0.09 s | 15.5 MB | exact empty |

  - The arrangement is 69× faster than the old EMBER-style engine but still **534× slower than CGAL**.
  - The arrangement run retired 634 G instructions (`phase17-path-complete-performance-checkpoint.md`).
- **Large fixture**, 3,072 + 3,072 triangles → 2,410 vertices / 4,816 triangles: about 156-169 ms.
- **csgrs sphere/box ops**: warm, csgrs is reported 17-22× faster than CGAL on retained-arrangement difference. Cold, it roughly matches CGAL, for example 1.973 ms vs 2.095 ms (PERFORMANCE.md around lines 816-830 and 1099-1106). These rows measure csgrs primitive construction plus the Boolean, so they are not directly comparable with the rows above (INFERRED).
- **Parallelism**: none in the Boolean. `DecisionContext` uses `Cell`/`RefCell`. hyperlimit has optional Rayon batch predicates, but hypermesh does not use them (DOCUMENTED, source). EMBER's parallel work stealing was judged "architecture-inapplicable" (PERFORMANCE.md, 2026-07-15 section).

## Known failures, limitations, war stories

All DOCUMENTED in the files named.
- **EMBER-style engine abandoned** after about 60k lines. Traces showed every real workload completing in "one bound contraction and one completed leaf, with zero split searches", so EMBER's subdivision heuristics never engaged. The engine was also 3,312 s on the YeahRight case (PERFORMANCE.md 2026-07-15; phase 10/16 docs).
- **Memory blow-up**: the full-resolution YeahRight rotated-copy Boolean "previously reached about 116 GiB RSS" through csgrs (PERFORMANCE.md, "original full-resolution mesh measurements").
- **Fuzzer-found arrangement bugs** fixed in Phase 17 (`phase17-path-complete-performance-checkpoint.md`):
  - A coplanar-overlay vertex synthesized on a source edge was not fanned out to every incident face.
  - A same-operand non-coplanar segment whose endpoints lay on triangle boundaries was wrongly discarded as a shared feature. "Only a genuinely shared authored feature, proved by retained construction identity, is elided."
- **Test-generator bug**: "generic independently quantized barycentric refinement manufactured boundary edges at these scales". Independently rounded refinement of shared edges broke closure (PERFORMANCE.md around line 146). This is the same seam-crack failure as vcad's resampled rims.
- **Generalized Winding Numbers rejected**, because the contract requires exact PWN input and never thresholds a float field (PERFORMANCE.md, 2026-07-15 GWN audit).
- **csgrs scope**: csgrs has no analytic 3D surfaces. Curved solids are tessellated into exact triangle meshes before the Boolean (csgrs README "Primary types"), so STEP out of this stack is faceted (INFERRED).

## Relevance for wonky

**Where it plugs in.** It fills the "robust mesh Boolean decides topology" half of the leading hybrid, and it gives three ready-made pieces:
1. `TriangleSource` provenance per output triangle.
2. Symbolic vertex identities (`SourceEdgePlane`, `PlaneTriple`) that name *which source faces meet at each new vertex*.
3. Multi-root evaluation from one arrangement.

For wonky, tag every input triangle with its analytic face id. The output triangles then carry face ids for free. Each new vertex's identity lists the 2-3 source faces, and so the analytic surface pair whose SSI curve it lies on. That is exactly the input analytic recovery needs (INFERRED). hypermesh does not export vertex identities publicly, so a port should add them to the output.

**Compare and interference.** wonky lists these as missing. With one arrangement, A∩B, A−B and B−A come out together:
- Interference means A∩B is non-empty.
- Diff means A−B and B−A.
- Containment means A−B is empty.

`exterior_inside` handles complements cleanly (INFERRED).

**Bend fit** (INFERRED):
- *Numbers.* hypermesh uses unbounded rationals and GCD normalization, which Bend cannot afford uniformly. wonky should put inputs on an F32-derived integer grid (b ≈ 24-32 bits) and keep points *homogeneous* (numerator vector plus denominator) without normalization. Equality and ordering then use cross-multiplication.
- *Bit growth* (rough estimate, INFERRED):
  - Input plane normals: about 2b bits; offsets: about 3b bits.
  - A `PlaneTriple` point: numerators about 7b bits, denominator about 6b bits.
  - hypermesh's radial `orient3` on four materialized triple points: about 27b bits, which is roughly 21-28 U32 limbs for b = 24-32.
  - Reformulating the radial comparison from plane coefficients plus one combinatorial side bit per facet (EMBER-style) keeps it to roughly 16b bits.

  Either way the width is fixed. It suits uniform multi-limb U32 kernels as long as chained outputs are snap-rounded back to the grid with a checked tolerance, and nothing in hypermesh does that.
- *Structure.* The main stages map onto parallel primitives:
  - pairwise intersections: map over BVH candidate pairs;
  - per-face corefinement: map over faces; each face CDT is independent, but CDT itself is sequential and irregular;
  - radial sort: segmented sort by edge key;
  - facet classification and certification: map plus sort-and-count.

  Mutable parts need replacing:
  - union-find: connected components by min-label propagation or pointer jumping;
  - BFS winding: propagate along a spanning tree with a prefix scan, or cast one exact ray per cell (uniform work);
  - hash-map identity dedup: sort by canonical identity key, then segmented unique.
- *GPU.* Per-pair intersection and per-cell ray tests are uniform. CDT and radial sort are not.

**APPROXIMATE_512 pattern.** For wonky's mesh stage it is irrelevant: grid inputs are always exactly decidable. For analytic recovery (irrational radii, trig seam points in F32x2) the pattern transfers: *try exact or certified first, then allow an explicit, recorded tolerance terminal, and aggregate the weakest certainty into the result type* (INFERRED).

**Performance reality check.** The exact-rational-everything design is 8× slower than CGAL EPECK on toy cases and 534× on 12k-triangle meshes. wonky's FDM parts are usually below 50k triangles, but a Bend port without filters would be slower still. CGAL wins through lazy-exact filters (interval first, exact on demand). wonky needs the same cascade in F32x2 intervals before multi-limb evaluation (INFERRED).

**Testing.** The box-volume oracle, the monotonic fixture registry and the rule "competitor output is never the sole oracle" should be adopted directly into wonky's bake-off harness.

## Pointers worth porting or studying

- `hypermesh/src/polygon.rs` lines 18-68: the construction identity enums and `intersection_identity` (edge ∩ plane → `SourceEdgePlane` or sorted `PlaneTriple`).
- `hypermesh/src/surface_arrangement.rs`:
  - `ArrangementPointArena::insert` (lines ~134-162): identity-first dedup with a contradiction check.
  - `append_intersection_constraints` (~2693) and `propagate_retained_source_edge_points` (~2794).
  - `corefine_face` (~3250): the per-face exact CDT with the no-work fast path.
  - `assemble_surface_cells` (~576), `compare_radial_rays` and `radial_dot_classification` (~1745-1890): exact radial order around an edge.
  - `classify_surface_cells` (~2002) and `seed_surface_cell_winding` (~2163): axis rays first, then the moment curve `(1,t,t²)`, with an explicit finite candidate budget.
  - `classify_expressions` and `evaluate_cell_truth_nodes` (~332-428): the Boolean truth DAG over winding vectors.
  - `certify_selected_surface_output` (~4368): exact closure certificate.
- `hypermesh/src/winding.rs`: `BooleanOp::contains`, `classify_polygon_output`, checked winding transitions.
- `hypermesh/src/output.rs`: `TriangleSource`, `BooleanMeshBatch`, `BooleanMeshClosureEvidence` (boundary, unbalanced, non-manifold, degenerate and duplicate counts).
- `hyperlimit/src/resolve.rs` (`resolve_composite_policy`, `approximate_real_sign`) and `src/predicate.rs` (`PredicatePolicy`, `PredicateOutcome`, `Certainty`, `RefinementNeed`): the certainty-carrying predicate API shape.
- `hypermesh/fuzz/fuzz_targets/boolean_box_oracle.rs`: the exact box Boolean volume oracle. Port it verbatim as a wonky test.
- `hypermesh/benchmarks/ember-replacement/phase10-inventory.md`, `phase16-atomic-production-cutover.md`, `phase17-path-complete-performance-checkpoint.md`: why EMBER-style lost to arrangements in this codebase, with numbers.
- `hypermesh/PERFORMANCE.md`, 2026-07-15 sections: the EMBER and GWN applicability audits.
- `hypercurve/README.md` "Strings, paths, contours, and regions" and "Precision, guarantees, and boundaries": the 2D API contract (region Booleans, offsets with explicit corner style, fillet and chamfer by radius or setback, `Classification::Uncertain`) for wonky's sketch-region layer.

## Verdict: adapt

Adapt the *architecture and contracts*, not the numeric layer:
- one exact arrangement with multi-root truth-DAG evaluation;
- construction identities for vertices and edges;
- per-triangle provenance;
- certify-or-typed-error output with no repair;
- a certainty level carried in the result type;
- the box-volume oracle and a monotonic corpus.

These fit wonky's hybrid (topology from an exact mesh arrangement, analytic recovery from identities) better than anything else seen. Replace unbounded rationals with fixed-width homogeneous multi-limb integers on an F32 grid, preferably with plane-based radial predicates, and add snap rounding between chained operations.

Treat every performance and correctness claim as unverified self-report: 7 stars, one author, agent-written, and no external users besides csgrs. The documented 8-534× gap to CGAL shows the design is not fast yet.
