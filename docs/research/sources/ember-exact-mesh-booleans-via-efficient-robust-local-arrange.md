# EMBER: Exact Mesh Booleans via Efficient & Robust Local Arrangements (Trettner, Nehring-Wirxel, Kobbelt, SIGGRAPH 2022)

- Kind: journal paper (SIGGRAPH 2022 technical paper). Canonical: https://doi.org/10.1145/3528223.3530181 (ACM TOG 41(4), Article 39, 15 pp., July 2022; Crossref lists 40 citations as of 2026-09-22).
  - Author PDF: https://www.graphics.rwth-aachen.de/media/papers/339/ember_exact_mesh_booleans_via_efficient_and_robust_local_arrangements.pdf. Local copy: tmp/research/pdf/trettner2022-ember.pdf (text: trettner2022-ember.txt).
  - Project pages: https://www.vci.rwth-aachen.de/publication/03339/ and graphics.rwth-aachen.de/ember-exact-mesh-booleans (snapshots in tmp/research/ember-*.html).
- Authors/org: Philip Trettner (Shaped Code GmbH), Julius Nehring-Wirxel and Leif Kobbelt (Visual Computing Institute, RWTH Aachen). Year 2022.
- License: paper © ACM, author copy free. **No source code.** The project page says: "If you are interested in a binary implementation including various additional features, please contact the authors" (DOCUMENTED, tmp/research/ember-project.html). The method was commercialised as Solidean (proprietary SDK, see `solidean-shaped-code-gmbh-exact-boolean-sdk.md`).
  - Porting implication: a clean-room implementation from the paper is the only route, and it is licence-clean with respect to copyright.
  - A shallow web search found no patent by Trettner/Shaped Code on the method. This is not a freedom-to-operate check (INFERRED/HEARSAY level).
- Status: published and cited. The research line continues as Solidean, with blog posts through 2026-07 and a SIGGRAPH 2026 winding-number paper (DOCUMENTED, https://solidean.com/blog/).

## What it is

An exact, parallel Boolean for polygon meshes that are PWN (piecewise-constant integer generalized winding number; closed but possibly self-intersecting, non-manifold or degenerate). It combines three things:
1. Plane-based geometry with fixed-width homogeneous integer coordinates, taken from Nehring-Wirxel et al. 2021 (see `nehring-wirxel-trettner-kobbelt-2021-fast-exact-booleans-for.md`).
2. Generalized winding number vectors (WNV) for classification, as in Mesh Arrangements (Zhou et al. 2016).
3. A single adaptive kd-type subdivision that carries a reference point with known WNV down the recursion, so every leaf is solved completely locally. There is no global acceleration structure and no global ray casting.

All predicates and constructions between import and export are exact (DOCUMENTED, abstract, sections 3 and 4).

## How it works

### Numeric model (section 3, DOCUMENTED)
- **Input.** Polygons with 26-bit integer vertex coordinates, "or that our method previously produced".
  - A polygon is a supporting plane plus one plane per edge.
  - A plane has integer coefficients (a,b,c,d), with a x + b y + c z + d = 0 and normal n = (a,b,c).
  - Bit widths are chosen "such that we can construct plane-based triangles for any input mesh and no intermediate result later on exceeds 256 bit".
- **Parallel test.** Planes p and q are parallel iff n_p × n_q = 0 (eq. 2).
- **Point construction** (eq. 3). The point x = intersect(p,q,r) is four 3×3 determinants (Cramer), stored as a homogeneous integer point (x1,x2,x3,x4). x4 = 0 means the three planes have no unique intersection point.
- **Classification** (eq. 4). classify(x,s) = sign<x,s> · sign(x4) ∈ {-1, 0, 1}. For an integer 3D point this reduces to <n_s,p> + d_s. This one 4D dot product is the workhorse predicate.
- **Primitives as plane tuples** (section 3.1, fig. 2):
  - line = (p,q), with no computation needed to form it;
  - ray = (l0,l1,r);
  - segment = (l0,l1,r0,r1);
  - convex polygon = supporting plane s plus edge planes e1..en. A point x lies in the polygon iff classify(s,x) = 0 and classify(e_i,x) <= 0 for all i; it is interior iff all those inequalities are strict.
  - Line/segment vs polygon: x = intersect(l0,l1,s), then check the edge planes and the delimiting planes. The collinear-in-plane case is handled by clipping the line against the edge planes.
- **Not closed under vector arithmetic** (section 3.2). The difference of two homogeneous points has denominator x4·x4', which doubles the bit width. Consequences:
  - no midpoints;
  - no segment between two constructed points;
  - **no re-triangulation** of polygons whose corners are constructed points, because that would need new planes that are not input planes.
  - Every plane that ever appears is an input plane or an axis-aligned AABB plane, so bit width never grows with CSG depth.
- **Accuracy** (section 3.3). Import scales and rounds to the full 26-bit range, which is about 15 nm for a 1 m³ scene ("almost 8 decimal digits"). Export rounds to float or double. That rounding is the only inexact step.

### Winding numbers (section 3.4, DOCUMENTED)
- **WNV.** w ∈ Z^n per non-surface point; w_i counts how often mesh i was entered.
- **WNTV.** Δw = w_B − w_F (behind minus front) per input polygon, usually the unit vector e_j for mesh j.
- **Propagation along a segment (x,y)**, valid when x and y are off-surface and every crossing is in a polygon interior:
  w_y = w_x + Σ_{t∈T} sign<n_t, x − y> · Δw_t.
- **y on a surface** (not on an edge): split T into the polygons T' that contain y and the rest. Compute w_y from T \ T', and Δw_y from T'. Then assign (w_F, w_B) by sign<n_ref, x−y>.
- **Boolean as an indicator function** f_op: WNV → {in, out}. For example, union is "in iff any w_i ≠ 0". Arbitrary variadic CSG trees work the same way.
  - Output polygons with (f(w_F), f(w_B)) = (out,in) are emitted as-is.
  - (in,out) polygons are emitted reversed.
  - (in,in) and (out,out) polygons are dropped.
- **Output guarantees:**
  - (P1) output polygons are disjoint and cover the same surface as the input;
  - (P2) each output polygon has one well-defined (w_F, w_B) valid over its whole interior.

### Recursion (section 4, DOCUMENTED)
- **Subdivision task.**
  - Split the integer AABB at an integer coordinate.
  - Clip every polygon (fig. 6). Classify its vertices as -1/0/+1. Split each edge that goes from −1 to +1 with intersect(supporting plane, edge plane, split plane). The result always has exactly two 0-vertices on the cut, even when the plane hits vertices. The non-positive side goes left, the non-negative side goes right, and all-zero goes left.
  - If x_ref is outside the child box, compute a new reference point and its WNV by segment tracing inside the parent box.
  - Recurse.
- **Leaf** (fig. 5), used when a subproblem has few polygons (optimum threshold ~25, fig. inset in 4.5.3). For each polygon t, build a **face-local BSP** of t by adding the intersection segments with every other polygon t' in the leaf. The intersection cases are:
  - (C1) none;
  - (C2) a point: ignore;
  - (C3) a segment (v0, v1, s_t'): add it recursively. At an inner node with plane q, classify both endpoints. Stop if both are 0. Otherwise send the segment left, right, or split it at v' = intersect(s, q, s_t).
  - (C4) a coplanar overlap: add all edges of t', then **disable** the overlapped leaves of t if index(t) > index(t'). Under a total order on polygons, "only the polygon with the minimal index emits output polygons".
  - The BSP is a representation of t's partition, not an acceleration structure. Splits are conservative (longer than needed), which keeps cells convex (fig. 7).
- **Classification of each enabled leaf polygon** (section 4.4):
  - *Fast path.* Take the float centroid, round it to an integer point c, and cast an axis-aligned line along the axis closest to t's normal. Intersect it exactly with t, then follow an axis-aligned path of at most 3 segments to x_ref.
  - *Fallback, interior point.* Take a vertex defined by (s_t, e0, e1). Replace e0 and e1 by (a,b,c,d+i) with random positive integer offsets i0 and i1, after scaling the plane coefficients up toward the precision limit. Intersect, and retry until the point is interior.
  - *Fallback, path.* With x = (s0,s1,s2) and x_ref = (r0,r1,r2), use the path x → (s0,s1,r2) → (s0,r1,r2) → x_ref. Each leg keeps two planes, so every leg is a representable segment. The path is clipped to the AABB. If it hits an edge or vertex, choose another plane order or offset. Exact arithmetic detects when a path is invalid.
- **Early termination** (section 4.5.2, fig. 12). For A − B, a subproblem whose reference WNV is (0,b) and that contains only polygons of B can never reach (a≠0, 0), so it is discarded without further work. The rules are "mechanically computed, quite similar to a reachability analysis on a finite automaton". Milling W − T1 − … − Tn gives two rules:
  - discard if outside W and the subproblem does not contain W;
  - discard if inside some T_i that is not part of the subproblem.
- **Input flags per WNTV class** (section 4.5.1): NSI (no self-intersections) and NNC (no nested components).
  - A single-class leaf with NSI skips the BSP.
  - NSI+NNC classifies only one polygon.
  - Every EMBER output satisfies both flags.
- **Split strategy** (section 4.5.3).
  - Keep sub-soups S_i per WNTV and compute each centroid c_i.
  - Candidate planes are the AABB planes of another S_j that separate c_i from S_j. Take the one with the largest separation, which guarantees one child lacks S_j and so triggers early-outs.
  - Fall back to the largest-variance split.

## Robustness and guarantees

- **Exact under stated preconditions** (DOCUMENTED, sections 3.3 and 6):
  - input and output must be integer-homogeneous within the fixed widths;
  - input must be PWN;
  - "Technically, our method can only be considered exact if input and output are in integer homogeneous coordinates … conversions … might re-introduce tiny self-intersections".
- **Heuristic parts are performance-only.** The float centroid and the random offsets affect speed, not correctness, because each path is validated exactly and retried (DOCUMENTED, section 4.4: "we can accurately decide when a construction was insufficient").
  - Termination of the retry loop is argued informally: "Only specifically constructed corner cases require more than one iteration". There is no proof (DOCUMENTED absence).
- **Coplanar overlaps are resolved combinatorially** by the total order on polygons, with no epsilon. Fig. 25 has up to 20 coplanar polygons at one location (DOCUMENTED).
- **Iterated CSG without precision growth**, because outputs reuse input planes (DOCUMENTED, section 6: "iterated CSG operations can be performed without intermediate loss of precision").
- There is no tolerance anywhere inside the method.

## Parallelism and performance

(DOCUMENTED, section 5: i9-9900K, 8 cores, clang-12 -O3.)
- **Thingi10K benchmark.** 1000 random pairs of solid manifold meshes with 1k-100k faces, randomly transformed to overlap. Geometric mean **1.6 ms** per Boolean at about 20k input faces, about **15 M input triangles/s**. That is "roughly one order of magnitude faster than the fastest inexact CSG method" (QuickCSG) (fig. 13).
- **Headline case:** 1.2 M triangles in **34 ms**, vs QuickCSG 1010 ms and Mesh Arrangements 141 s (fig. 1).
- **Other cases:**
  - Fig. 15: 29,472 − 2,568 faces in 3.86 ms (QuickCSG 36.46 ms, Mesh Arrangements 9578 ms).
  - Fig. 24, 20×20 beams (quadratic output): 4.5 ms (Mesh Arrangements 18,018 ms, FP Mesh Arrangements 1556 ms, CGAL 4.12 6465 ms, CGAL 5.4 941 ms).
  - Fig. 25, 20 cubes sharing top and bottom planes (240 triangles): 5.9 ms (Mesh Arrangements 58,280 ms, FP Mesh Arrangements 5620 ms).
  - Fig. 22, dense cube grid of 350k triangles: 43 ms.
  - Fig. 21, a 32k-triangle multi-layer extraction: 15 ms.
- **Iterated milling** (fig. 14, the Nehring-Wirxel 2021 drill case) beats the persistent octree-BSP "even if the subdivision structure has to be recomputed in each step".
- **Profile** (fig. 16):
  - leaves cost about 2× the subdivision;
  - the subdivision is dominated by polygon splitting;
  - in leaves, classification tracing costs about 2× pairwise intersection plus BSP.
  - Ablation (fig. 17): the classify fast paths and the subdivision early-outs are the two largest wins.
- **Parallelism** (section 4.5.4). "Each subdivision step is basically a pure function"; parallelism comes from work stealing (continue with one child, enqueue the other).
  - 5.5× speed-up on 8 cores (fig. 18), limited by memory bandwidth and a burn-in phase at the root.
  - Implementation tricks: memory reuse per recursion branch, statically typed reduced bit widths for axis-aligned planes (coefficients −1/0/1), and AABB pre-checks before any exact test.

## Known failures, limitations, war stories

(DOCUMENTED, section 6, unless marked.)
- **Output shape:**
  - The output is a soup of **convex polygons with T-junctions**, not triangulated. Triangulation "is not possible in general" in the fixed-width model.
  - It has more faces and more low-valence vertices than other methods (fig. 26).
  - Topology must be recovered in post-processing. Solidean later moved this reconstruction to export, with T-junction resolution and optional manifold duplication (DOCUMENTED, https://solidean.com/blog/2026/iterated-cube-grid-benchmark/).
- **Float export can create self-intersections.** Finding a topology-preserving rounding is NP-hard (Milenkovic-Nackman 1990, cited in NW2021, section 4.6).
- **Fixed input budget.** 26 bits, fixed input extent; everything must lie inside the declared box (the Solidean runner uses `createExactArithmetic(max_abs of bbox)`, see the Solidean SDK note).
- **Scalability limits.** The WNV dimension grows with the number of operands ("might become so large that it warrants further optimization"), and parallelism has a burn-in phase.
- **Input must be PWN.** Self-intersecting but closed input is fine; open input is not. Solidean adds `Operation::heal` for non-supersolid input (DOCUMENTED, Solidean docs, via the SDK note).
- No public issue tracker, since there is no public code.
- **Later evidence** (DOCUMENTED, vendor-run, https://solidean.com/blog/2026/iterated-dome-carve-benchmark/): the EMBER-derived Solidean is the only engine that finishes 100k iterated subtractions within 1 h. The authors credit output-sensitive internal data structures beyond EMBER for this. Plain EMBER rebuilds its subdivision every operation (section 5.1).

## Relevance for wonky

**Where it plugs in.** EMBER is the blueprint for bake-off prototype 2 (`kernel/proto/exact-plane/`, whose header cites EMBER and Campen-Kobbelt 2010). It is also a candidate topology oracle for prototype 4 (analytic recovery). Each EMBER output polygon lies in exactly one input polygon (section 5.4: "each result polygon is a subset of an input polygon"). The input polygon's face tag therefore maps back to the analytic surface for free.

**Numeric fit (INFERRED unless noted):**
- **Integer grid and limb counts.** The integer-vertex bit budget is 9·B + ~18 bits plus sign for B-bit coordinates (NW2021 eq. 7-9, which EMBER inherits). Grid size vs limb count:

  | B | budget | 16-bit limbs | grid at ±1024 mm | grid at ±128 mm |
  |---|---|---|---|---|
  | 20 | ~198 bits | 13 | ~1 µm | ~0.12 µm |
  | 24 | ~235 bits | 15 | 61 nm | 7.6 nm |
  | 26 | ~253 bits | 16 | 15 nm | 1.9 nm |
  | 34 | 325 bits | 21 | 0.06 nm | |

  B = 34 is wonky's current prototype, whose header states G = 24, ±1024 mm, "9 B + 19 bits … 325 bits at B = 34 … 21 limbs" (DOCUMENTED, kernel/proto/exact-plane/big.bend and geom.bend).
  - FDM needs about 10 µm, and tessellation chord error is already about 10 µm. So **B ≈ 24 at ±1024 mm (or B = 20 at bed scale) cuts the worst predicate from 21 to 13-15 limbs**, roughly halving its multiply count.
  - The observed maxima on the 38-case corpus are far below the worst case: vertex X/Y/Z ≤ 192 bits, W ≤ 160, plane normals ≤ 64, offsets ≤ 96, i.e. about 256-bit predicates (DOCUMENTED, docs/proto-exact-plane.md "Bit widths" table). That is EMBER's own 256-bit budget.
- **Limb width.** Bend has no widening multiply (DOCUMENTED, verified 2026-09-24 in the Bend clone ff7a40c):
  - `u32_mul` lowers to `U32_BIN($0, *, $1)` = `(u64)((u32)a * (u32)b)` in C and `Math.imul(a, b) >>> 0` in JS (bend2/comp.ts:187-190). `U32.mul` is `Word.mul(32n, …)` (bend2/base.bend:1364).
  - README.md:227: "Numbers are Nat, U32 and F32 only: no U64, I64 or F64 (Metal has no f64)".
  - So limbs must be 16-bit so that a limb product plus carry fits below 2^32, as big.bend already does.
  - A 256×256-bit product is then 256 16×16 multiplies, vs 16 `mulx` on x64: **about 16× the multiply count** of the paper's implementation.
  - The real classify is x·s with x_i ~196 bits × n ~55 bits, about 220 16-bit multiplies vs about 18 `mulx`.
  - A U32 mul-hi primitive in Bend would cut this 4×. This is worth raising upstream with HigherOrderCO.
- **Fixed vs variable width.** EMBER's statically sized integers ("all these constraints are known statically and are implemented using individual types", section 4.5.5) suit Bend's GPU model (uniform work per predicate) far better than big.bend's variable-length `List<U32>`. The list version allocates per limb and branches on length.
  - A fixed-width record, e.g. 16 U32 words for 256 bits, gives predicates identical instruction streams. They can be GPU-batched, for example all vertex/plane classifications of one clipping pass.
  - The F32x2 pre-filter in geom.bend stays useful on the JS and CPU targets.
- **Iterated CSG.** Output planes are input planes, so wonky can keep plane-based results in the exact representation between features. A FeatureScript part is a long chain of Booleans. It must never round-trip through floats mid-chain, as Solidean's "export-then-import is usually an anti-pattern" also warns (DOCUMENTED, SDK note).

**Parallel and immutable fit (INFERRED):**
- The recursion maps directly onto Bend fork-join: `(l, r) = (ember(soupL, refL), ember(soupR, refR))`. There is no shared mutable state, because the paper already made each step a pure function of (soup, box, x_ref, w_ref).
- Face-local BSP insertion is a pure recursive tree insert, which is idiomatic for immutable trees.
- Work per leaf is non-uniform (polygon counts, BSP depth, retries), so the recursion belongs on the native multi-core CPU target. The GPU target fits batched fixed-width predicates, not the recursion.
- The random offsets (i0, i1) must become a deterministic sequence, e.g. 1, 2, 3 … or a hash of the polygon id, to keep JS/C/Metal results bit-identical.

**Algorithmic gap vs the current prototype** (INFERRED from reading classify.bend and setup.bend):
- exact-plane uses a *global* BVH and casts an axis ray per piece against every other leaf.
- EMBER's key performance idea is the *local reference point with known WNV* propagated through the subdivision. Its classification fast path and early-out rules gave the largest ablation wins.
- Adopting reference propagation plus the finite-automaton early-outs is the most direct speed-up path for prototype 2.
- WNVs also give **variadic CSG in one pass**. A FeatureScript Boolean with many tools, or a whole CSG tree, is one indicator function, with no intermediate results at all.

**What the EMBER-style prototype measured in wonky's bake-off** (DOCUMENTED, docs/proto-exact-plane.md, docs/bakeoff.md "Results", docs/hybrid-boolean-plan.md, judge round 2, 2026-09-23, M5 Pro):
- **Correctness.** Corpus 36 of 38 plus 2 expected refusals, byte-identical on JS, CPU1, CPU18 and Metal. Volume within 5.5e-9 relative of manifold3d; the difference comes entirely from the input quantization.
- **Adversarial (216 cases).** 170 good, 20 refused, **26 wrong `ok`**, more than corefine's 18. The critical classes are EMBER's documented preconditions showing up on CAD input:
  - quantization to the 2^-24 mm grid *changes topology below the grid*: it seals rotated coplanar pockets into voids, turns 1e-9 mm gaps into point contacts, and misjudges sub-micron skins by up to 19 %;
  - point contact is returned as `ok`, because the self-check tests only edges.
  - This is section 3.3's "exact only if input and output are integer-homogeneous", now measured: the Boolean is exact, but the quantized problem is a different problem.
- **Speed.** 2.5x (18 threads) to 5.6x (1 thread) slower than corefine, and 3.7x on JS. The common-set sums are 34,389 / 10,593 / 114,400 ms at cpu1 / cpu18 / JS. It scales best of the mesh engines, with a cpu1/cpu18 geo-mean of 3.30 (corefine 1.46), which supports the pure fork-join recursion argument above.
- **Filter and exact costs.** The F32x2 filter certifies 60-100 % of signs, 85-96 % on most cases. The low values are coplanar box cases, where most signs are exact zeros. Non-zero exact fallbacks are at most 33 per case.
  - Per plane-side evaluation (native, 1 thread): 0.10 µs filtered vs 1.3 µs exact for a grid point, and 0.20 µs filtered vs 6.0 µs exact for a constructed vertex.
  - On hex-nut, 7 % of signs (the exact zeros) cost about as much as all filtered ones together. The prototype's own conclusion: the next win is more *symbolic* zeros (carrying "vertex lies on plane p" through splits) and fixed-width limbs for the common 1-4-limb operands, not a sharper filter.
- **Decision.** exact-plane is not the production Boolean. It stays as the independent differential topology oracle (CI and an opt-in "paranoid" mode) next to the corefine + recover hybrid.
- **Implication for a future EMBER port (INFERRED).** Quantization must be treated like any other approximation with a refusal rule. Detect when rounding to the grid flips or zeroes an orientation that was non-zero in the unquantized input: check each tagged coplanar/touching pair in F32x2 against its quantized counterpart. Refuse then, instead of silently solving the neighbouring problem.

**Other connections (INFERRED):**
- **FDM print mesh.** The output needs T-junction resolution and rounding before wonky's certified watertight print mesh. The rounding step is the snap-rounding problem (see `valque-lazard-iterative-snap-rounding-for-triangle-soup-auto.md`).
- **Diff/compare.** Exactness makes A == B decidable: A xor B must produce no polygons. This is useful for wonky's diff/review and for regression oracles.
- **Curved faces.** EMBER is exact only for the *tessellated* problem. Curved B-rep faces still need SSI for exact recovery (prototype 4).

## Pointers worth porting or studying

- Eq. 3-4 (intersect, classify) and section 3.1 (plane-tuple primitives, segment/polygon test). These are the complete predicate set.
- Section 3.2: the list of forbidden operations. It is a design constraint for all exact-plane code.
- Section 3.4: the WNV/WNTV propagation formula and the on-surface variant, which is the classification core.
- Section 4.2.1 plus fig. 6: exact convex polygon clipping (always two 0-vertices).
- Section 4.2.2 plus section 4.4 plus figs. 9-10: reference point update, the interior-point construction by edge-plane offset, and the 3-segment plane-swap path.
- Section 4.3 plus figs. 7-8: face-local BSP `add(segment)` and coplanar overlap disabling by total order.
- Section 4.5.1-4.5.3: NSI/NNC flags, the automaton-derived early-out rules, and the separating split-plane heuristic with a leaf threshold of about 25.
- Figs. 23-25 as regression cases: coplanar and exact edge hits, beams with quadratic output, and 20 stacked coplanar cubes.

## Verdict: adapt

EMBER is the best match to wonky's scalar model: fixed-width integer predicates, no floats inside, bit width bounded across iterated CSG, and a recursion that is already a pure fork-join function. Port it clean-room from the paper, since no code is available.
- Replace variable-length Bigs with statically sized 16-bit-limb records.
- Shrink B to FDM needs.
- Add reference-point propagation and early-outs to prototype 2.
- Keep the float export and the T-junction handling as explicit, tolerance-stated steps.
- Do not expect it to handle curved surfaces exactly: it decides topology of tessellations.

Status in wonky (2026-09-24): adapted as `kernel/proto/exact-plane`. It lost the bake-off on speed (2.5-5.6x slower than corefine) and on quantization-induced wrong answers, and is kept as the differential oracle. The EMBER ideas it has not yet adopted are local reference-point propagation, the automaton early-outs, fixed-width limbs and a quantization refusal rule. These are the path back if exactness ever has to move into the production path.
