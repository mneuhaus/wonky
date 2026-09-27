# trueform (polydera) and Sajovic and Knez 2026, "trueform: fast and robust mesh CSG via topological aggregation"

- Kind: header-only C++17 library (oneTBB; Python via nanobind, TypeScript via WASM) plus paper.
- Canonical URL: https://github.com/polydera/trueform
- Other URLs:
  - Paper: arXiv 2607.15905, https://arxiv.org/abs/2607.15905 (July 2026). LaTeX source in the repo: `research/uncertainty-aware-mesh-csg/sajovic-2026-mesh-csg.tex` (read in full for this note, clone HEAD 872775d, 2026-09-22). The tex is marked `\JournalSubmission` with "LOCAL COPY ONLY" footers, so it is a submitted manuscript, not a published journal paper.
  - Earlier preprint: Sajovic and Knez, "Real-Time Mesh Booleans that Commute with Mesh Idealization", TechRxiv, May 2025, https://doi.org/10.36227/techrxiv.174667714.42575478/v1. Not read: TechRxiv returned HTTP 403 on 2026-09-24. Its thesis is stated in the repo's research page (`docs/content/cpp/6.about/1.research.md`). DOCUMENTED:
    - "a mesh should be understood as an intended surface, observed through the noise of finite precision and prior processing".
    - Defects are "additive—they attach to the surface without creating holes".
    - "The goal is commutative correctness: operations that commute with mesh idealization. Chain operations freely on non-ideal meshes and clean up once at the end."
    - The same page describes the older kernel as "int32 or int64" scaled coordinates. The current ladder (T0/T1/T2 up to int256) postdates it.
    - INFERRED: "commutes with idealization" is a testable metamorphic property, idealize(op(noisy)) = op(idealize(noisy)). It is worth borrowing as a wonky test, but it is a design goal, not a proven property.
  - arXiv metadata re-checked 2026-09-24: only v1 (17 Jul 2026, cs.CG), title "trueform: Fast And Robust Mesh CSG Via Topological Aggregation". DOCUMENTED (https://arxiv.org/abs/2607.15905).
  - Docs: https://trueform.polydera.com. Live demo: https://trueform.polydera.com/live-examples/boolean. Product page: https://polydera.com/trueform.
  - Local clone: `tmp/research/trueform-polydera/repo` (shallow, 268 MB, 1297 headers, about 157k lines in `include/`).
- Authors/organization: Žiga Sajovic and Dejan Knez, Polydera; copyright holder XLAB d.o.o. (Ljubljana). Every commit on GitHub is by ZigaSajovic (261 contributions). DOCUMENTED (`gh api repos/polydera/trueform/contributors`, 2026-09-22).
- License: dual. PolyForm Noncommercial 1.0.0 for "evaluation, personal, and educational work"; "any revenue-generating, production, or for-profit deployment requires a commercial agreement with XLAB". Every header carries "Licensed for noncommercial use under the PolyForm Noncommercial License 1.0.0". The PolyForm license includes a patent grant limited to permitted (noncommercial) purposes. DOCUMENTED (`LICENSE`, `LICENSE.noncommercial`, `COMMERCIAL.md`; GitHub reports `NOASSERTION`).
  - Porting implication: translating the code into Bend would be a derivative work under a noncommercial licence. Any wonky part used commercially would put it outside the licence. Treat the code as read-only. The paper (arXiv) states the algorithms in enough detail to re-derive them independently. Ideas and math are not copyrightable. No patent is mentioned anywhere in the repo (INFERRED from grep), but the licence's patent clause shows the licensor reserves the possibility.
- Status: very active, single maintainer. Created 2026-01-19, 146 stars, 10 forks, 3 open issues. Last commit 872775d on 2026-09-22. Releases v0.9.0 (2026-05-17) through v0.10.5 (2026-09-21), about weekly. DOCUMENTED (`gh api repos/polydera/trueform`, `/releases`, 2026-09-22). Re-checked 2026-09-24: no release or commit after 872775d and v0.10.5. The tracker has 18 entries (#1-#17 and #21), 7 of them PRs. Three issues are open, all maintainer feature tasks: #4 sphere primitive, #5 wrapping tbb calls, #6 curve-mesh cutting. None of the entries is a CSG correctness report. So user-visible CSG failures are documented only in the release notes and in third-party benchmarks. DOCUMENTED (`gh api .../issues?state=all`).
  - OBB lists Trueform 0.7.0 as "R I S". The 0.7.0 runner manifest itself declares `accepts_self_intersections: false` and `supports_variadic_booleans: false`, which contradicts the S letter for that runner. DOCUMENTED (https://github.com/Open-Boolean-Benchmark/boolean-benchmark-runners/blob/main/trueform/0.7.0/runner.yaml, README table).

## What it is

A mesh arrangement and CSG engine whose design thesis is: "Mesh CSG output is consumed in floating point: however exact the computation, every emitted coordinate is materialised ... Only index-based topology survives materialisation." So it keeps the topology exact and treats every geometric reading as an observation of an intended geometry. DOCUMENTED (paper abstract and §1).

Four claimed contributions (paper §1.2), all DOCUMENTED:
1. Exact contact classification into five simplex-pair types (VV, VE, VF, EE, EF) on a bounded integer kernel, with no Simulation of Simplicity.
2. A locally computed arrangement: each cut face is arranged in its own 2D plane, and a two-level identity (topological name plus geometric merge) keeps faces consistent with no global structure. The radial order around intersection edges comes from the original input planes, "exact without exact constructions".
3. Classification by "topological aggregation": disagreeing orient3d observations within a topological unit (component orientation, radial order of a relation) are settled by a weighted majority vote.
4. Build once, query many: the arrangement stores per-domain operand-inclusion bitvectors, so any N-ary Boolean expression is a per-domain bit test.

Beyond Booleans it provides N-mesh arrangements, polygon-soup self-arrangement, volumetric domain extraction, open surfaces as "sheets", CDT, remeshing, spatial trees, ICP, SDF volumes and isosurfaces. DOCUMENTED (`agents/cpp_modules.md`).

## How it works

### Integer kernel (paper §2.1, `include/trueform/exact/`)
- The input floats are mapped onto one integer lattice over the union bounding box of all operands: `scale = 0.99 * INT_MAX / max_extent`, `int = round((x - center) * scale)`. DOCUMENTED (`exact/pt_converter.hpp`).
- Two ladders, chosen from the input type: float input uses T0 = int32, T1 = int64, T2 = int128. Double input uses int64, int128 and int256. The int256 is custom, built from two uint128 limbs with a 64x64 schoolbook multiply. DOCUMENTED (`exact/meta.hpp`, `exact/int256.hpp`, paper Table "precision").
- `conversion_ulp_bits = coordinate_bits - digits(real)`: for float that is 31 - 24 = 7. The lattice is 7 bits finer than a float over the bounding box, so "nothing inside that gap came from the model". DOCUMENTED (`meta.hpp`).
- Every predicate in the pipeline has total degree at most 3 in lattice coordinates (orient2d, orient3d, and the cross and dot products feeding them). A subtraction costs one bit (T0 to T1), and a product of differences doubles the width (T1 x T1 to T2). The ladder "closes after T2": no dynamic allocation, no filter, no fallback kernel. DOCUMENTED (paper §2.1).
- `orient3d_value` is the 3x3 determinant of T1 differences, evaluated in T2. `orient3d_plane` caches the T2 normal N = (b-a)x(c-a) per face, so each test is a T2 dot product. `orient3d_sos_presorted` exists: sort by vertex id, then a Shewchuk-style cascade of minors. It is used only where the paper says SoS decides no topology (ray casting, the `sos` intersect mode). DOCUMENTED (`exact/orient3d.hpp`).
- The degree-4 exception: the sign of `a*b - c*d` with T2 operands, used by the radial sort, has no rung on the ladder. `det2_sign` splits each operand into three limbs of `h = (t2_bits+1)/3` bits, accumulates 9 partial products per term into 5 accumulators, does one carry pass, and reads the sign off the top accumulator. DOCUMENTED (`exact/det2_sign.hpp`).
- Created points (EE, EF) are not exact rationals. The paper says `div_round` "snaps the true intersection to the nearest T2 cell: exact as a grid coordinate, inexact as a point". The current code names an edge-carried point by `(home_edge, exact_parameter)`: a dyadic parameter on the input edge, `dyadic_ratio(num, den)` rounded to nearest, then `snap_parameter_to_edge` rounds it to a step of about one source-float ulp along that edge. The point therefore lies on its home edge's chord up to that step, and two splits on one edge are the same split exactly when their snapped parameters are equal. DOCUMENTED (paper §2.2 stage one; `exact/edge_plane_parameter.hpp`, `exact/dyadic_ratio.hpp`, `exact/snap_parameter_to_edge.hpp`, `agents/cpp_modules.md` §5).

### Five-type contact classification (paper §2.1, Table "fan zero patterns")
- Inputs are convex polygons, fan-triangulated online from vertex A0. For fan triangle t = (A0, A_{t+1}, A_{t+2}) and segment (D,E), compute three signs: v1 = orient3d(A0, A_{t+1}, D, E), v2 = orient3d(A_{t+1}, A_{t+2}, D, E), v3 = orient3d(A0, A_{t+2}, D, E).
- Decision: no zeros with v1 = v2 != v3 gives EF (crosses the interior). One zero on a real polygon edge gives EE. One zero on a fan diagonal gives EF. Two zeros (at a face vertex) give VE.
- The real-edge predicate is `(v1 = 0 and t = 0) or v2 = 0 or (v3 = 0 and t + 3 = n)`. It is the only place the fan leaks structure.
- Separate routines handle on-plane primitives (VV, coplanar VE and EE) and vertex-in-face (VF). A degenerate chain of collinear vertices behaves as an edge automatically.
- DOCUMENTED (paper §2.1).

### Two-stage local arrangement (paper §2.2)
- **Stage one.**
  - A parallel dual AABB-tree descent produces candidate face pairs. Each pair emits flat records `(mesh, polygon, other polygon, simplex pair on each side, point identity)`.
  - The stream has no duplicates by construction, for two reasons. The decision tree fires exactly one type per contact (unlike Lévy's sort+unique). And each vertex and edge has one designated owner face, so only that face emits records for it.
  - A parallel sort by `(tag, polygon, tag', polygon')` plus offset blocks gives each face a contiguous slice.
  - DOCUMENTED.
- **Stage two, per face in its own 2D plane.**
  1. Segment extraction:
     - Insert intersection points into the face's base loop.
     - Record runs of the sorted slice classify in O(1) by size: 1 record means no edge, 2 means an intersection edge, 3 or more means a coplanar polygon-of-contact.
     - Every intersection edge has a canonical identity: its two endpoint identities.
  2. Segment arrangement:
     - Faces with fewer than 32 segments use a quadratic crossing check; larger ones use a segment tree.
     - A new crossing is named by its face triple, which all three faces that see it agree on. For coplanar contact the triple is ambiguous and is refined by the canonical edge pair.
     - Crossings are sorted by parameter t along each canonical edge. Equal t merges (VV).
     - Point ids are remapped in one parallel pass, so a point created on any face propagates to every face containing its canonical edge. "Cross-face consistency follows from identity, not from coordinate comparison."
  3. Region extraction:
     - If every path is a crossing path, split the base loop into sub-loops in linear time.
     - Otherwise do an exact planar walk: order half-edges radially with orient2d.
     - Holes and dangling paths are placed by an exact point-in-region test.
  - DOCUMENTED.
- The implementation has grown beyond the paper:
  - A `local_arrangement` identity tier, including coplanar faces "pooled" onto one plane identity, the "identity gate" that merges all identities occupying one lattice position, and "entrants".
  - A `plane_arrangement` tier: a preserve-mode CDT per plane carrier. If it "refuses", the carrier is rebuilt in resolve mode, and crossings and landings become new identities and splits. This repeats in "recovery waves until nothing new is stated".
  - `failed()` lists carriers still refusing, and is the documented completeness gate.
  - DOCUMENTED (`agents/cpp_core_architecture.md` §9, `agents/csg_pipeline_debugging.md` "Step 0", RELEASE_NOTES v0.10.0).

### Radial order from original planes (paper §2.3, `csg/graph/make_plane_radial_fans.hpp`)
- Around a non-manifold intersection edge, every incident face's wedge direction lies in its original (input) plane and is perpendicular to the edge line. Comparing two wedges therefore needs only the carriers' plane normals: T2 vectors, degree 2 in lattice coordinates, with the sign chosen by face winding and traversal direction.
- `ccw(a,b) = det2_sign(a[k0], b[k1], a[k1], b[k0]) * d_sign` projects onto the plane orthogonal to the edge line's dominant axis. Wedges are bucketed into angle classes relative to a reference wedge (0, (0,pi), pi, (pi,2pi)) and sorted.
- "Two wedges tie precisely when their original planes coincide ... so materialisation can neither create nor destroy an ordering: within the build, rho_e is exact." DOCUMENTED (paper §2.3).
- Exception in code: a piece whose definitions name no single carrier line ("several carrier lines welded into one canonical identity") falls back to the pages' own coordinates. The code comment calls this "an open question, not a fix", and says the fan counts it as `n_refused`. DOCUMENTED (comment in `make_plane_radial_fans.hpp`).

### Reduced graph, relations, vote (paper §2.3-2.4, Alg. 1, App. A)
- **MEL components.** These are connected components of the manifold-edge link. Uncut faces flood through the input mesh's link, cut sub-loops flood through the per-face cut graph, and a union-find joins the two across the boundary. Components are stored only as label arrays.
- **Coplanar packs** are collapsed to one face, and the component is re-oriented by area-weighted majority: the orientation vote.
- **Relations.** A relation is the set of non-manifold edges sharing (polyline, sorted incident-component set). Polylines come from a union-find on shared endpoints, with axes aligned to the traversal direction.
- **Canonical permutation.** Each edge's radial sequence is normalized: axis taken from the polyline, rotation starting at the smallest label.
- **Vote (Alg. 1).** Argsort by (relation key, permutation). The longest run of equal permutations wins, weighted by the minimum incident face area. Fans with a degenerate face get weight 0.
- **Merge pairs.** The winning representative emits merge pairs between fragment-sides `(component, side bit)` at each cyclic-adjacent wedge. An open (boundary-carrying) component contributes `(c,0) <-> (c,1)`. A dense equivalence-class map assigns domain ids, so `labels[f][s] = domain_of[2c+s]`.
- **Appendix A** frames the vote as the MAP estimate under a symmetric Dirichlet prior. It admits "the operative guarantee is definitional: the vote returns the intended permutation exactly when a majority of the relation's observations carry it."
- DOCUMENTED.

### Classification (paper §2.5)
- **Inclusion as a potential.** Each domain d has a bitvector b(d) in {0,1}^N. Crossing component c toggles `b(d') = b(d) XOR B(c)`, where B(c) is c's operand bit OR-ed with any coplanar duplicates folded into it.
- **Seeds.** Seeds come from the voted wedges: the interior side `domain_of[2c+1]` takes c's bit. No ray is needed inside one connected component.
- **Nesting across connected components:**
  - Per-domain signed volumes are scattered from integer-exact per-component contributions.
  - The outer environment of each connected component is its most negative-volume domain. The globally most negative one is anchored at b = 0.
  - Every other connected component casts one SoS-perturbed segment from a vertex to a far point, only against operands whose bounding box overlaps it. The crossing parity sets its outer environment's bits, and a multi-source XOR-BFS floods the rest.
  - In v0.10.5 the inclusion "now counts winding instead of crossing parity", so doubly covered regions read inside.
- **Sheets.** An open operand declared a sheet has a bit meaning "behind its normal". A component it never touches is classified by the sign of the sheet's generalized winding number.
- **Expressions.** An expression tree compiles to per-word masks over the bitvector. A face is emitted when its two sides select differently, oriented outward. Cut sub-faces are Delaunay-triangulated, and output is materialized to the requested real type, or kept as lattice integers.
- DOCUMENTED (paper §2.5-2.7, RELEASE_NOTES v0.10.5).

### Tolerance ("the door", v0.10.0)
- "A tolerance is the pitch the input's planes are quantized to; it never widens a predicate." Every face plane (direction and offset) is rounded to a grid of that pitch. Every original vertex is then moved by at most the tolerance onto the quantized planes of its own faces: the meet of three, the line of two, or its tangent plane. A certificate (`admits_placement`) checks the placement.
- After that, the pipeline runs exactly at zero tolerance on the moved mesh. At tolerance 0 nothing moves and the result is byte-identical to the exact arrangement.
- The release notes report that the retired band-on-predicates mechanism "left open arrangements at both bands and annihilated half of the union mass at 1e-5". DOCUMENTED (RELEASE_NOTES v0.10.0, `exact/door/`).

### Engineering style
The code is "arrays being shuffled": flat buffers, parallel sort by key, offsets, independent blocks, then dense remap or union-find. Hash maps, mutexes and coordinate comparison for topology are listed as "rare mechanisms that require proof". DOCUMENTED (`AGENTS.md`).

## Robustness and guarantees

- **Exact:** all predicates on lattice inputs, the contact type partition, the in-build radial order, and signed-volume nesting. DOCUMENTED (paper §2).
- **Rounded, by design:**
  - Input to lattice: about 1e-9 relative for float input, since 31-bit coordinates span the bounding box.
  - EE/EF created points: a dyadic parameter snapped to about one source ulp along the home edge.
  - Output materialization.

  The paper's stated invariant is "combinatorics kept exact over coordinates that are merely grid-rounded". The per-face 2D arrangements run exact predicates on those rounded 2D copies, so they are exact for the rounded configuration, not for the true one. INFERRED from §2.2 plus the code.
- **Heuristic, stated as such:**
  - "the vote is a majority estimator, and its guarantee is statistical, not worst-case ... a configuration can be built to defeat it".
  - "Materialising the output can introduce self-intersections the exact arrangement did not have ... we do not remove the crossing itself." Lossless snap rounding is left open.
  - DOCUMENTED (paper §4.1 Limitations).
- **Where the vote matters:** within the build the vote is essentially inert, because the radial order is exact. It earns its keep on materialized arrangements (`tf::make_domain_labels` on a float arrangement without provenance) and on inconsistently wound input sheets. DOCUMENTED (paper §2.4, §3 "What we measure", §3 Implementation).
- **Vote evaluation** (all on materialized readings; DOCUMENTED, paper Table 2 and Fig. "robustness"):
  - At epsilon = 0 (native materialization, double): the geological model splits 4 of 220 relations, and 59 self-intersecting Thingi10K models split 178 of 704 relations. Per-edge reading fails all of those; the vote fails none.
  - Two UV spheres swept over 191 offsets: materialized readings disagree at 54 offsets, and the vote is correct at all 191.
  - Under injected noise: per-edge collapses by epsilon of about 1e-3 of the bbox, while the vote stays exact through about 1e-5 and at least 78% correct at 1e-3.
- **Validity oracle** used in the comparisons: output must be closed, consistently oriented, and match the reference signed volume and area "to floating-point tolerance". On the 1000-pair corpus every library including trueform was valid on at least 999 of 1000. DOCUMENTED (paper §3.3, Table "pairwise").

## Parallelism and performance

All numbers are DOCUMENTED from the paper (Apple M4 Max, 12P+4E cores, TBB, "minimum over repeated runs"), trueform 0.9.8. They are vendor-run.

- **Pairwise, 1000 random Thingi10K pairs at 100k-1M triangles per operand.**
  - Protocol: arrays in, arrays out, including all structure builds.
  - Median times: trueform 15.7 ms, MeshLib 86.4 ms, Manifold 118.0 ms, EMBER/Solidean preview 143.8 ms, Cherchi 416.9 ms, CGAL EPICK corefine 493.6 ms, Geogram 1644.3 ms.
  - Geometric-mean slowdowns relative to trueform: 5.5x, 7.6x, 10.4x, 28.7x, 32.1x and 100.4x respectively.
  - CGAL ran for over 5 h on Thingi10K pair 844209/518083, which trueform did in 20 ms.
- **N-ary, 40 sets per N.** Median times at N = 4 / 16 / 64:
  - trueform: 6 / 25 / 103 ms.
  - EMBER: 61 / 352 / 1429 ms.
  - Manifold: 71 / 354 / 1467 ms.
  - Cherchi: 310 / 1711 / 4495 ms.
  - MeshLib: 234 / 1134 / 14158 ms, with 38/40 and 37/40 valid at N = 16 and 64.
  - Geogram: 688 / 5265 / 66637 ms.
- **Scaling, 1989 random N-ary unions.** Triangle count explains only 27% of build-time variance. Going from N = 2 to 128 at about 1M triangles raises build time about 10x. Per-domain cost falls from about 380 to about 115 µs.
- **Bunny swarm, N+1 operands, 2.8M-56M triangles.**
  - Build: 78 ms to 1.68 s, at 33-44 M triangles per second.
  - Pairwise intersection is 52-59% of the build; classification grows from 7% to 23%.
  - Extractions take 45-132 ms, 13-37x below the build.
  - Peak memory is 0.21-1.3 GB.
- **Other results.**
  - Bunny against 60 planes: 8665 domains in 59 ms.
  - Browser (WASM, Chrome 148): 21.9 ms median against Manifold-WASM at 303.4 ms, and three-bvh-csg at 978 ms (valid on 22/1000). WASM costs about 1.4x over native.
- **Independent-ish evidence (OBB/Solidean vendor posts, trueform 0.7.0, float build):**
  - Iterated cube grid, 1999 ops: 4.1 s, canonical.
  - 9-op chain: 85 ms.
  - Terrain carve: wrong, "kind of inverted (area 16.28, volume -0.8181)". A single missing triangle later misclassified whole patches: "local consistency is not enough: one unrecovered error is all it takes".
  - Dome carve: wrong from 250 steps, and "starts to fail around the 70% mark" of the 1000-step run. The double build did not fail at that step count.
  - DOCUMENTED (https://solidean.com/blog/2026/iterated-cube-grid-benchmark/, https://solidean.com/blog/2026/first-benchmark-results-iterated-csg/, https://solidean.com/blog/2026/terrain-carve-benchmark/, https://solidean.com/blog/2026/iterated-dome-carve-benchmark/).
  - Note the protocol clash: in trueform's pairwise protocol Solidean is 10.4x slower than trueform; in Solidean's iterated protocol trueform is 4.2x slower than Solidean. Each vendor wins its own benchmark. INFERRED.

## Known failures, limitations, war stories

- **Paper limitations (DOCUMENTED, §4.1):**
  - Convex faces only; non-convex input must be triangulated upstream.
  - Inputs beyond the int64 grid must be rescaled.
  - Output can self-intersect.
  - The vote can be defeated adversarially.
- **v0.10.3/0.10.4 regression:** an N-operand `within` build "lost every operand's membership ... every bounded domain read 'inside operand 0'". A second bug placed self split points of any operand past the first "on another operand's edges — geometrically impossible constraint sets that exhausted the recovery wave into silently missing wall pieces and, downstream, collapsed domains". Both were fixed in 0.10.5. Lesson: flat-id bookkeeping errors surface as silent geometry loss. DOCUMENTED (RELEASE_NOTES v0.10.5).
- **Silent failure mode by design of the data flow:** "a failed plane is silent downstream ... the empty triangle span becomes a hole nothing else reports". The debugging guide makes `failed()` the mandatory first check. DOCUMENTED (`agents/csg_pipeline_debugging.md`).
- **Radial fallback** for welded multi-line pieces reads materialized coordinates and is "an open question, not a fix". DOCUMENTED (code comment).
- **Old tolerance mechanism** annihilated half the union mass at a band of 1e-5. DOCUMENTED (RELEASE_NOTES v0.10.0).
- **Iterated-carve failures** in 0.7.0 float mode (terrain, dome), described above.
- **Deliberate exclusion of SoS** from the arrangement. The box split by a midpoint rectangle has 2^4 = 16 SoS outcomes, only one of which gives the intended two domains. This is a direct argument against the Manifold-style candidate for coplanar-by-construction CAD input. DOCUMENTED (paper Fig. "sos box divider").

## Relevance for wonky

- **Bit budget: the best Bend fit among the robust mesh Booleans.**
  - Predicates have degree 3 or less on input lattice coordinates only, plus one degree-4 sign via limb splitting.
  - On a 31-bit lattice (T2 = 128 bits) this is 1 U32 limb for T0, 2 for T1 and 4 for T2.
  - Bend's `u32_mul` returns the low word only (`tmp/research/bend/bend2/comp.ts` `OPERATIONS`, DOCUMENTED), so wonky needs 16-bit half-limbs.
    - A 31-bit lattice orient3d has 32-bit differences and a value of at most about 99 bits.
    - That is roughly 50-100 `u32_mul` plus carry handling, as a fixed, branch-free sequence. INFERRED count.
    - This is uniform GPU work, with no filter branch and no fallback to batch out.
  - A 24-bit lattice would make every input coordinate exact in F32 and shrink orient3d to about 78 bits. It costs 7 bits of lattice resolution: on a 256 mm FDM bed, about 15 nm instead of 0.1 nm. INFERRED.
  - Compare EMBER at degree 9 and 256 bits for 26-bit input, and Geogram/Cherchi's growing expansions.
  - Wonky's F32 input fits a 31-bit lattice with 7 spare bits, like trueform's float mode. INFERRED.
- **Point identity by name.** Naming a created point by its generating primitives (vertex anchor, (edge, parameter), face triple, with canonical-edge-pair refinement for coplanar packs) matches wonky's topology identity and provenance goals, and the hybrid "B-rep recovery" candidate.
  - With wonky's tessellation tagging triangles by analytic face, an EF record `(edge of face A, triangle of face B)` names the analytic surface pair whose exact intersection curve should replace the chord.
  - A face triple names the analytic vertex (three surfaces meet).
  - INFERRED.
- **Radial order from original planes** is exactly the move wonky needs at non-manifold intersection edges: decide cyclic order from face-plane data of the inputs, never from constructed points. For analytic recovery the analogue is surface normals along the exact intersection curve. INFERRED.
- **Fork-join fit.** Stages are sort-by-key, then offsets, then independent blocks, then union-find or dense remap. Bend has no mutation, so union-find must become a pure formulation (for example min-label propagation to a fixed point, or sort-based connected components). The rest maps to balanced fork-join over blocks. The per-face 2D arrangement with "<32 segments quadratic" is a small serial kernel per face; with a per-face segment cap it is GPU-uniform. INFERRED.
- **Build-once, query-many bitvector classification** fits wonky's review/diff tooling. One arrangement of all features of a part answers "which domain is inside which feature", and any Boolean expression over features, as bit tests. It also yields interference checks for free: domains with two operand bits set. INFERRED.
- **Tolerance door** is a concrete template for wonky's rule that approximations need explicit tolerances. The tolerance is a statement about input placement (quantize planes, move vertices by at most the tolerance, verify with a certificate); predicates stay exact downstream, and zero tolerance is the identity. INFERRED.
- **The vote conflicts with explicit failure.** Wonky should not silently take a majority. Within a build the vote is unnecessary, since the order is exact. For materialized re-reads, wonky can compute the same distribution but fail or flag when it is not unanimous, reporting the minority edges as a diagnostic. INFERRED.
- **SoS critique.** The 16-configuration box-divider argument applies to FDM CAD: flush faces and coplanar cuts are the common case. It favors exact type classification over SoS in the bake-off's Manifold-style candidate. INFERRED.
- **Watch-outs:**
  - Created points are snapped. Iterated use materializes to floats again, and 0.7.0 failed long carves in float mode.
  - Wonky's hybrid avoids iterated mesh re-reads by re-tessellating from the exact B-rep each operation, which removes the failure mode trueform's vote targets. INFERRED.

## Pointers worth studying (read, do not copy: PolyForm NC)

1. Paper §2.1 plus the fan zero-pattern table: a complete, exact contact classifier for convex polygons with no SoS.
2. Paper §2.2: point naming (VV/VE/VF reuse input identities; EE/EF are keyed by the primitive pair), face-triple naming of crossings, and canonical edges as endpoint-identity pairs.
3. Paper §2.3: radial order from original plane normals; `det2_sign` limb split for a degree-4 sign without a wider type. This is directly relevant to U32-limb Bend arithmetic.
4. Paper §2.4 Alg. 1 and App. A: relation keys (polyline, component set), canonical permutations, and the run-length vote. Reuse as a disagreement detector.
5. Paper §2.5: inclusion potential `b(d') = b(d) XOR B(c)`, wedge seeding, most-negative-volume outer environment, one ray per nested connected component, XOR-BFS.
6. RELEASE_NOTES v0.10.0 "Tolerance is a statement about the input", and `exact/door/`: the plane-quantize-then-place scheme.
7. `agents/csg_pipeline_debugging.md`: "one fact, one producer", a completeness gate before debugging, census counters per stage, and tracing by identity rather than coordinates. A good model for wonky's introspection and test harness.
8. `agents/cpp_execution_patterns.md` / `AGENTS.md`: the "records -> sort by key -> offsets -> independent blocks -> dense remap" execution shape. It is the same shape Bend needs.
9. Paper §3.3 protocol (arrays in, arrays out, oracle = closed + oriented + volume/area match) and its corpus ids (`research/uncertainty-aware-mesh-csg/data/*.json`) for wonky's benchmark set.

## Verdict: learn-from

The paper is the most Bend-compatible design for a robust mesh-Boolean topology layer found so far. Its predicates stay at degree 3 on input coordinates only, at 128 bits for a 31-bit lattice with a fixed width ladder. Points are named by provenance, the radial order comes from original planes, and classification is a bitvector potential. Most of this transfers to wonky's tagged-mesh stage and to B-rep recovery.

The code is PolyForm Noncommercial and cannot be ported into a kernel Marc may use commercially, so re-derive from the arXiv paper only.

Treat three parts as open problems, not solved ones:
- the majority vote, which is statistical and should become an explicit disagreement failure in wonky;
- the snapped created points;
- the recovery-wave machinery, which is complex and was the source of recent silent-loss bugs.
