# Interactive and Robust Mesh Booleans (Cherchi, Pellacini, Attene, Livesu 2022)

- Kind: paper plus reference C++ implementation.
  - Repo: https://github.com/gcherchi/InteractiveAndRobustMeshBooleans
  - Paper: ACM TOG 41(6), SIGGRAPH Asia 2022, doi 10.1145/3550454.3555460. Preprint arXiv:2205.14151, https://www.gianmarcocherchi.com/pdf/interactive_exact_booleans.pdf.
  - Arrangement predecessor: Cherchi, Livesu, Scateni, Attene, "Fast and Robust Mesh Arrangements using Floating-point Arithmetic", TOG 2020, https://github.com/gcherchi/FastAndRobustMeshArrangements.
  - Predicate library: Attene, "Indirect Predicates for Geometric Constructions", CAD 126 (2020), https://github.com/MarcoAttene/Indirect_Predicates.
- Clone read: `tmp/research/interactive-and-robust-mesh-booleans-cherchi-et-al` at HEAD `7bd6c269` (2024-06-10). PDF: `tmp/research/pdf/cherchi2022-interactive-booleans.pdf`, text extract in `tmp/research/pdf/cherchi2022.txt`.
- Authors: G. Cherchi (Cagliari), F. Pellacini (Sapienza), M. Attene and M. Livesu (CNR IMATI). Contributors by commits: gcherchi 48, micheleFaedda 14, mlivesu 12, MarcoAttene 1.
- License (DOCUMENTED):
  - The Boolean code is **MIT** (`LICENSE`, file headers).
  - The vendored `arrangements/external/Indirect_Predicates` is **LGPL**: the `LICENSE` file says LGPL-2.1, the file headers say "LGPL v3 or later". Upstream `MarcoAttene/Indirect_Predicates` reports LGPL-2.1 via `gh api`.
  - Other bundled pieces: CinoLib (MIT), TBB, Abseil and parallel-hashmap (Apache-2.0).
  - Implication: transliterating the MIT Boolean/ray-casting logic is fine with attribution. The *generated predicate code* (`indirect_predicates.hpp`, 10.7k lines) is LGPL. Wonky should re-derive its predicates from the paper's formulas (math is not copyrightable) instead of translating that file.
- Status (DOCUMENTED, `gh api` 2026-09-22):
  - 244 stars (243 on 2026-09-22, re-checked 2026-09-24), 48 forks. Created 2022-07-14. Last commit 2024-06-10. `pushed_at` 2025-07-02 comes from open PR #34 (MSVC build fix).
  - 5 open issues/PRs, no releases.
  - The README now carries a "we do not currently have the resources to keep up" notice. Treat it as **research code in maintenance-only mode**.

## What it is

An exact, topologically guaranteed Boolean for **closed, manifold, self-intersection-free, consistently oriented triangle meshes**, fast enough for interactive rates up to about 200K triangles. It supports union, intersection, subtraction, XOR and variadic (N-ary) forms. It never builds explicit rational intersection coordinates:
- intersection points are *implicit*: tuples of input primitives;
- all decisions use filtered exact predicates;
- inside/outside labels come from **one exact ray cast per surface patch**, not from flooding over the arrangement.

Output: a triangle mesh plus a per-triangle **label bitset** of which inputs each output triangle came from. Output coordinates are rounded to doubles only at the very end.

## How it works

### Pipeline (`code/booleans.cpp`)

`booleanPipeline` → `customArrangementPipeline` → `customBooleanPipeline`:

1. **Tag and flatten.** All input meshes go into one triangle soup. Each triangle gets `std::bitset<NBIT>` with bit i set for mesh i. `NBIT = 32` (`arrangements/code/common.h:41`), so by default at most 32 operands. The authors say they ran about 1K labels by raising the constant (issue #23).
2. **Scale.** `computeMultiplier` (`arrangements/code/processing.cpp:45`) multiplies all coordinates by a power of two, so max |coord| ≈ 1.1e10. The scaling is exact, since it is a power of two. It keeps coordinates in the range the predicate filters are tuned for. `initFPU()` sets the FPU state, because the interval stage needs directed rounding.
3. **Clean.** Merge bit-identical vertices with a parallel sort (`mergeDuplicatedVertices`). Drop exactly collinear triangles. Collapse duplicate triangles (same sorted vertex triple): labels are OR-ed, and each duplicate's winding relative to the kept copy is stored in `DuplTriInfo{t_id, l_id, w}` (`customRemoveDegenerateAndDuplicatedTriangles`).
4. **Detect.** Build an octree. For each leaf in parallel, run an AABB pre-test and then an exact triangle-triangle test (`customDetectIntersections`, TBB `parallel_for` over leaves, spin-mutex on the result list).
5. **Classify intersections** (`arrangements/code/intersection_classification.cpp`). Per intersecting pair, compute the three `orient3d` signs of A's vertices against B's plane and vice versa. Case-split the result: coplanar, single coplanar edge, vertex in plane, edge crossing. From these cases, create:
   - **LPI** points (line-plane intersection: edge `pq` × plane `rst`) for an edge crossing a triangle;
   - symbolic segments between the pair's intersection points (`addSymbolicSegment`).
6. **Triangulate** (`arrangements/code/triangulation.cpp`). Per triangle, in parallel:
   - insert points by a tree-based point location (`splitSingleTriangleWithTree`);
   - insert constraint segments (`addConstraintSegment`). This removes the triangles crossed by the segment and re-triangulates the two pockets with a linear-time earcut variant (Livesu et al. TVCG 2022, `earcutLinear`).
   - Where two constraint segments cross inside a triangle, a **TPI** point (three-plane intersection) is created from the host plane and the two other triangles' planes (`createTPI`).
   - Coplanar overlaps are handled by `solvePocketsInCoplanarTriangle`.
   - The result is a well-formed simplicial complex. Its patches are bounded by closed loops of non-manifold "intersection" edges.
7. **Patches** (`computeAllPatches`). Flood over triangles that share a manifold edge and have the same surface label.
8. **Inside/outside** (`computeInsideOut`, one TBB task per patch). See below.
9. **Select** (`boolUnion` / `boolIntersection` / `boolSubtraction` / `boolXOR`). These are pure bitset formulas per triangle:
   - union keeps `inside.count()==0`;
   - intersection keeps `(surface ^ inside).count()==num`;
   - subtraction keeps "surface of mesh 0 and inside nothing" or "not mesh 0, inside mesh 0 only", then **flips** the kept triangles of meshes ≠ 0;
   - XOR combines the two rules and flips.

   Subtraction with more than two operands is `M0 \ (M1 ∪ … ∪ Mn)`.
10. **Emit.** Write implicit points as approximate doubles (`getApproxXYZCoordinates`) and divide by the multiplier.

### Implicit points and indirect predicates (Attene 2020)

Every non-input vertex is one of the following. There are never "points built from points built from points":
- `implicitPoint3D_LPI(p,q; r,s,t)`: line pq ∩ plane(rst). In homogeneous form (`lambda3d_LPI_interval`, `indirect_predicates.hpp:7178`):
  - `λd = det[p−q, s−r, t−r]` (degree 3 in coordinates);
  - `n = det[p−r, s−r, t−r]` (degree 3);
  - `λ = λd·p − (p−q)·n` (degree 4);
  - the point is `λ/λd`.
- `implicitPoint3D_TPI(v1v2v3; w1w2w3; u1u2u3)`: intersection of three triangle planes. With normal degree 2 and offset degree 3, the denominator is degree 6 and the numerators degree 7 (INFERRED from the construction).
- `LNC`: linear combination of two points with a double parameter. It is not used by the Boolean.
- 2D `SSI` (segment-segment).

The predicates are generated in every mix of explicit (E) and implicit (I) arguments: `orient2d_indirect_{IEE,IIE,III}` (also the xy/yz/zx projections), `orient3d_indirect_{IEEE…IIII}`, `lessThanOn{X,Y,Z}_{IE,II}`, `incircle`, `inSphere`, `dotProductSign`. They substitute the homogeneous λ into the explicit predicate polynomial, keeping `λd > 0` by negating at construction.

Evaluation cascade (`orient3d_indirect_IEEE`, `indirect_predicates.hpp:9983`):
1. an **interval-arithmetic** stage, using the cached interval λ computed once per implicit point at construction with `setFPUModeToRoundUP()`;
2. then the **exact** stage, using Shewchuk expansions of doubles;
3. with a `bigfloat` fallback that exists for overflow.

Building the library requires `-frounding-math` (README).

Stage details verified in the vendored snapshot (DOCUMENTED, re-checked 2026-09-24):
- **Explicit-only predicates** (`dotProductSign2D_filtered`, `incircle_filtered`, `inSphere_filtered`, `indirect_predicates.hpp:38` onward) use a **semi-static filter**: `max_var = max |difference term|`, then `epsilon = max_var^deg · C` (for the 2D dot product `C = 8.881784197001253e-16 = 4u`), and the sign is certain when `|d| > epsilon`. This stage needs no directed rounding, so it is the template for an F32x2 filter in wonky (re-derive `C` for u ≈ 2^-48 plus the double-word error terms).
- **Implicit-argument predicates** in this snapshot skip the semi-static stage: `orient3d_indirect_IEEE` (L9983) is `_interval` then `_exact`. The interval λ is computed once per point under `setFPUModeToRoundUP()` and cached (`needsIntervalLambda()` checks a NaN sentinel in `implicit_point.h:320`).
- The `_exact` stage uses Shewchuk expansions in **fixed 64-double stack buffers** with heap spill (`double l1x_p[64]`, `Gen_Scale_With_PreAlloc`). With `CHECK_FOR_XYZERFLOWS` it tests `fetestexcept(FE_UNDERFLOW|FE_OVERFLOW)` after the exact evaluation and redoes it in `bigfloat` (L9975). For wonky, the equivalent is a fixed limb count per predicate derived from the degree bound; the fixed-buffer-plus-spill pattern shows that bounded storage covers real inputs.
- The TPI construction (`lambda3d_TPI_interval`, L7364) computes the three plane normals as 2×2 cross products of edge differences (degree 2), then the pairwise cross products of normals (degree 4). This confirms the degree-6 denominator and degree-7 numerators stated above.
- Upstream `MarcoAttene/Indirect_Predicates` (clone `tmp/research/indirect-predicates`, `7496059`, 2026-09-01) has since been rewritten as templates (`orient3d_indirect_IEEE_t<interval_number|bigfloat>`), with an interval stage followed directly by bigfloat. The Boolean repo still vendors the older generated code.

Explicit-only predicates are Shewchuk-style filtered `orient3d` (`hand_optimized_predicates.hpp:123`).

**Cached plane predicate** (paper §4): `orient3D(a,b,c,p) = −p_x·M_x + p_y·M_y − p_z·M_z + M_1`, where the M are the four 3×3 cofactor minors of the triangle. Cache the four minors per input triangle, and each orient3d becomes a 4D dot product. I could not find a dedicated cached-minors routine in this snapshot. The arrangement calls `cinolib::orient3d` directly (`intersection_classification.cpp:130`, INFERRED from grep), so treat the paper's cache as a described optimization.

**Jolly points** (`TriangleSoup::initJollyPoints`): five fixed off-axis points (tetrahedron vertices scaled by the multiplier). For each triangle, a jolly point *not coplanar* with it is picked (`noCoplanarJollyPointID`). Then orient2d-in-the-plane questions about implicit points become `orient3d(a, b, jolly, p)`, with no projection and no loss of exactness.

### Ray-cast classification (paper §5, `findRayEndpoints`, `pruneIntersectionsAndSortAlongRay`, `analyzeSortedIntersections`)

Per patch P:

1. **Ray origin.**
   - If P has an explicit input vertex not on an intersection curve (`vertInfo==0`), start there and cast along +X to `max_coords` (bbox max + 0.5).
   - Otherwise take a triangle of P and approximate its implicit vertices as doubles. Pick the axis of the largest normal component. Start the ray at the approximate barycenter pushed back 0.1 (scaled units) along that axis.
   - Then **verify exactly** that the ray crosses the true triangle: `orient3D` of both endpoints against the triangle's implicit plane must have opposite signs, plus a 3-tet inside test (`checkIntersectionInsideTriangle3DImplPoints`). If not, try the next triangle.
   - The paper's final fallback, an exact rational barycenter, is **not implemented**. The code prints "fully implicit patch that requires exact rationals … not supported" and calls `std::exit(EXIT_FAILURE)`.
2. **Candidates.** Query the octree with the ray's AABB, which is degenerate because the ray is axis-aligned. Skip triangles of the patch's own mesh(es) (`patch_surface_label[t_label]`).
3. **Hit test** against the *input* triangles (explicit coordinates), using 2D `orient2d` in the plane orthogonal to the ray (`fast2DCheckIntersectionOnRay`). Results: `INT_IN_TRI`, `INT_IN_V*`, `INT_IN_EDGE*`, `DISCARD` (ray coplanar with the triangle), `NO_INT`.
4. **Degenerate hits** (vertex or edge). Collect the one-ring or edge triangles and perturb only the far endpoint p∞ by one ulp (`std::nextafter`) in up to 8 directions (`perturbXRay` etc.). Re-test in 3D with three `orient3d` signs. The first ring triangle hit wins. If none of the 8 perturbations hits, the hit is **silently dropped** (`winner_tri == -1`), INFERRED from the code.
5. **Sort** hits along the axis with exact `lessThanOnX` on LPI points (ray line × triangle plane). Discard hits "before" the patch: for a generated ray, the test is the side of the patch triangle's plane; for an explicit origin, it is `lessThanOnX` against the origin.
6. **Classify.** For each other mesh, only the *first* hit counts. Inside iff `orient3d(t0,t1,t2,p∞) < 0` (`checkTriangleOrientation`). Write the per-mesh inside bit to every triangle of the patch.

Cost scales with #patches, not #triangles, and all patches are independent.

## Robustness and guarantees

- **Proven** (DOCUMENTED, paper §2.3 and §3): given valid inputs, the arrangement is an exact simplicial complex, since all predicates are exact and no coordinate is rounded until output. For inputs that do not touch tangentially, the result is manifold and watertight.
  - Validation: on 3,814 Thingi10K Booleans, the output's #components and Euler characteristic matched libigl/CGAL exactly (§6.2).
- **Input contract, not checked in the pipeline**: manifold, watertight, no self-intersections, globally outward.
  - A separate tool checks it (`main-inputcheck.cpp`). Its global-orientation test is a float signed-volume sum and is "correct only if the mesh has a single connected component".
  - Invalid input gives crashes or asserts, not errors: issues #19, #30, #32.
- **Heuristic parts:**
  - The ray-origin push-back is a fixed 0.1 in scaled units; it is safe only because the exact crossing test follows.
  - The ulp perturbation of p∞ is a concrete numeric nudge, not simulation of simplicity. It can in principle fail all 8 tries.
  - The rational fallback for fully implicit patches is missing: `exit(1)` (issue #8, #30).
- **Coplanar/tangent semantics are ambiguous.** Coincident patches get multiple label bits but no per-source orientation. So subtraction with an internal coplanar tangency leaves non-manifold zero-volume sheets (issue #13).
  - The authors refused to add a normal-based fix, because "triangle normals are not robust" and "would require a dedicated exact predicate that we don't have" (mlivesu, #13).
  - INFERRED: for *exactly coplanar* triangles the orientation agreement is decidable exactly by comparing `orient2d` signs in a shared axis projection, or via a common jolly point. The missing predicate is cheap.
- **Cascading is unsupported** (paper §7, issue #2):
  - outputs are rounded to doubles, which can create self-intersections, so a second Boolean has no guarantee;
  - keeping implicit points would compose into ever higher-degree expressions "for which the arithmetic filtering fails in virtually all cases".
- **Output rounding**: there is no snap rounding. Double conversion can create near-degenerate or intersecting triangles (paper §2.3).

## Parallelism and performance (all DOCUMENTED from the paper; MacBook M1 Pro 8P cores unless noted)

- **Rotation demo** (Table 1), per frame in seconds, min/max/avg:
  - 25K triangles: 0.01/0.04/0.02;
  - 100K: 0.03/0.11/0.07;
  - 200K: 0.06/0.19/0.14;
  - libigl (Zhou 2016) at 200K: 1.37/6.48/1.50.
- **ARAP + Boolean**: 0.032 s average at 25K, 0.195 s at 200K (Table 2).
- **Thingi10K** (12 cores): 3,814 Booleans in 4.5 min, against 28.3 min for libigl.
  - Arrangement: 4 min vs 22.5 min.
  - Classification: 0.47 min vs 5.8 min; per case up to 101× faster, 11.34× on average.
- **Huge meshes, 3.3M-21.6M triangles** (Table 3):
  - about 25× faster than libigl overall;
  - arrangement about 11× faster than libigl and about 5× faster than FastAndRobustMeshArrangements;
  - classification about 80× faster in 70% of cases, about 6× otherwise.
- **Ray statistics**: over 80K rays, only 2% needed approximate-barycenter origins. Of those, 97% succeeded on the first triangle, and at most 5 triangles were ever needed. The rational fallback was never hit, and edge/vertex perturbation never occurred on real data.
- **Variadic**: Fertility minus 700 spheres took 1.1 s both as a variadic op and as a pre-merged pairwise op. libigl took 6.8 s vs 38 s.
- **Parallel structure**:
  - per-leaf intersection detection;
  - per-triangle retriangulation, with shared maps under spin mutexes;
  - per-patch ray casting, fully independent;
  - parallel sort for vertex merge.

  Patch flooding and final extraction are serial: "requires fine-grained locking … meshlet-based approach likely needed". Supporting libraries: swiss tables (Abseil/phmap), arena allocators, small-vector adjacency.

## Known failures, limitations, war stories

- #8 and #30: "unable to calculate ray" / "fully implicit patch that requires exact rationals". The rational path was omitted "because the code was convoluted and it was also never necessary in all our tests" (gcherchi, #8). Users hit it on tubular meshes and on inputs with subtle self-intersections.
- #19: asserts in `addConstraintSegmentsInSingleTriangle` / `assert(intersected_edges.size() > 0)` (`triangulation.cpp`). One user hit it on 4 of 8,000 wild meshes; another hit it only on arm64/M1 with a box/sphere case. It stayed unresolved in-thread.
- #13 (BRL-CAD, starseeker): coplanar faces "bite" holes, giving non-manifold output. The authors call it correct by their definition. BRL-CAD shelved its integration branch over this (#23).
- #23 (OpenVSP): needs non-watertight operands, for example slicing by a plane. The authors say to use the arrangement alone and do custom filtering. The 32-label limit is a compile-time constant.
- #2: cascaded CSG (BRL-CAD tree evaluation) is explicitly not guaranteed.
- #31: the input checker crashes on unused vertices. #16, #10, PR #34: Windows build breakage. Also Indirect_Predicates API churn broke the sibling arrangements repo (#23).
- Truck issue #65 (https://github.com/ricosjp/truck/issues/65) suggested porting this into truck-shapeops. It is still open with no port.

## Relevance for wonky

**Main use: the mesh-Boolean layer of the "tagged mesh Boolean + analytic B-rep recovery" hybrid.** It competes with Manifold's symbolic-perturbation approach.

1. **Implicit points are provenance.** Every arrangement vertex is literally "edge e of face F_A × plane of triangle t of face F_B" (LPI) or "planes of three triangles" (TPI). With wonky's tessellation tagging each triangle by analytic face id, an LPI/TPI tuple names the analytic surface pair or triple. That is exactly the key needed to recover the exact vertex and edge curve (plane∩cylinder, etc.). Manifold-style symbolic perturbation gives topology but no such tuple for free. INFERRED.
2. **Bounded degree, no cascades inside one Boolean.** Predicates only ever see input coordinates.
   - If wonky quantizes tessellation vertices to an integer grid, for example 24-bit so that each is exact in F32 (`k·2^-e` mm), each predicate is a fixed polynomial with a static bit bound, which suits multi-limb U32 arithmetic with **no unbounded rationals**.
   - Rough INFERRED bounds with b-bit coordinates: LPI-involving `orient3d_IEEE` is degree about 6. `orient3d_IIII` with four TPI points is degree about 27, roughly 27·b plus a few bits: about 660 bits, or 21 limbs, at b=24.
   - Most calls resolve in the filter.
   - Cascading is avoided if each wonky Boolean re-tessellates from the exact B-rep instead of feeding a rounded output mesh back in, which the hybrid does anyway (INFERRED).
3. **Filter stage needs rethinking for Bend.** Attene's interval stage relies on directed rounding (`setFPUModeToRoundUP`, `-frounding-math`). Metal/Bend F32 has only round-to-nearest.
   - Alternatives: static or semi-static error-bound filters (Shewchuk/Meyer-Pion style) evaluated in F32x2, with an error bound derived for u ≈ 2^-48. Or error-free transformations (TwoSum/TwoProd via FMA) that work under round-to-nearest.
   - Filter failure falls back to exact U32 limbs. That branch is non-uniform on the GPU, so batch the uncertain predicates into a second pass on the CPU/C backend (INFERRED).
4. **Ray-per-patch classification is the most Bend-friendly part.**
   - Each patch is independent: fork-join over a balanced patch tree.
   - Rays are axis-aligned, so the octree/BVH test is 4 float comparisons, and the hit test is 3 `orient2d` in the dropped-axis projection. This is uniform work per candidate, and GPU-able as "one thread per (patch, candidate triangle)" plus a min-reduction along the axis.
   - The label result is a U32 bitmask when there are ≤ 32 operands, which fits wonky's U32-only world natively.
   - Replace the ulp nudge with a proper symbolic perturbation, SoS on the ray direction, to get a real guarantee (INFERRED).
5. **Arrangement construction is the hard part to port.** It uses per-triangle incremental retriangulation with hash maps, mutexes and pointer-based genericPoint arenas: mutation-heavy. A Bend version would be a per-triangle pure function taking (triangle, list of LPI/TPI points and constraint segments on it) and returning local triangles, followed by a global dedupe by sorted keys.
   - Pure and parallel if the per-triangle constraint lists are built first by a sort/group-by over intersecting pairs (INFERRED).
   - Degree-bounded CDT per triangle is the kernel. Livesu's linear earcut is only valid for their pocket shapes.
6. **FDM/CAD caveat.** Coplanar and tangent contacts are the *common* case in mechanical CAD: box-on-box, flush pockets, faces aligned by construction. Their unresolved coplanar semantics (#13) must be fixed in any adaptation.
   - Carry per-source orientation for coincident sub-triangles, which is decidable exactly for coplanar triangles.
   - Apply regularized-set rules: same orientation means keep one for union and intersection; opposite orientation means drop both for union and keep neither for intersection.
7. **Testing idea (DOCUMENTED method).** Compare topology invariants (#components, Euler characteristic) between two independent exact Booleans as a differential oracle. Wonky can do the same across its JS/C/Metal backends and bake-off prototypes.

## Pointers worth porting or studying

- Paper §4, "Cached Predicates": the orient3d cofactor split, which is plane-based caching like EMBER.
- Paper §5 and Alg. 1, Figs. 5-6: ray classification and degenerate hit cases.
- `code/booleans.cpp`:
  - `findRayEndpoints` (L475): origin selection plus exact crossing verification;
  - `fast2DCheckIntersectionOnRay` (L1024): the hit-type classifier;
  - `sortIntersectedTrisAlong{X,Y,Z}` (L1117+): exact ordering of LPI hits, and the "discard before patch" rule;
  - `bool{Union,Intersection,Subtraction,XOR}` (L1394-1487): bitset selection plus flips;
  - `customRemoveDegenerateAndDuplicatedTriangles`: duplicate-triangle winding bookkeeping.
- `arrangements/code/intersection_classification.cpp`: the complete tri-tri case analysis from orient3d sign triples (`allCoplanarEdges`, `singleCoplanarEdge`, `vtxInPlaneAndOppositeEdgeOnSameSide`, …). This is a good checklist for wonky's own tri-tri classifier.
- `arrangements/code/triangulation.cpp`: `createTPI` (where second-order points arise), `addConstraintSegment`, `solvePocketsInCoplanarTriangle`.
- `arrangements/external/Indirect_Predicates/include/indirect_predicates.hpp:7178`: LPI λ formulas, to re-derive rather than copy (LGPL); `implicit_point.h`: the point-type taxonomy.
- `TriangleSoup::initJollyPoints`: exact in-plane orientation without projection.
- Siblings: Cherchi et al. 2020 arrangements (`tmp/research/cherchi-livesu-scateni-attene-2020-fast-and-robust-mesh-arra`) and Attene's predicates (`tmp/research/indirect-predicates`).

## Verdict: adapt

This is the clearest published recipe for an *exact, construction-free* mesh Boolean with provenance-rich vertices and embarrassingly parallel classification. It is a strong candidate for the topology layer of wonky's analytic-recovery hybrid.

Adapt, do not port:
- re-derive the predicates for integer-grid inputs and U32 limbs, avoiding the LGPL code and the directed-rounding dependency;
- replace ulp nudging with SoS;
- implement the missing exact fallback as a hard error path;
- define coplanar semantics properly.

The mutation-heavy arrangement code needs a pure per-triangle reformulation. The MIT top layer can be followed closely.
