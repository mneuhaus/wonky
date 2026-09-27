# Yang, Jia, Wang, Yang, Xin, Yan 2025: Boolean Operation for CAD Models Using a Hybrid Representation

- Kind: journal paper, ACM TOG 44(4), Article 114, 17 pages (SIGGRAPH 2025).
- Canonical URL: https://doi.org/10.1145/3730908.
- Full text, read in full on 2026-09-22 from the RWTH open-access copy https://publications.rwth-aachen.de/record/1016540/files/1016540.pdf (DOI 10.18154/RWTH-2025-06943). Local copy: `tmp/research/pdf/yang2025-hybrid-boolean.pdf` and `.txt`.
- Access notes:
  - The RWTH page sits behind a JS proof-of-work challenge, which a headless browser passes.
  - The ACM copy returns 403 to scripted clients.
- Talk slides, 38 pp.: https://yangjieyin.github.io/homepage/SIG2025/SIG25_slides.pdf (local `yang2025-hybrid-boolean-slides.pdf`).
- Authors/org, year:
  - Yingyu Yang and Xiaohong Jia (corresponding author), AMSS, Chinese Academy of Sciences / UCAS.
  - Bolun Wang, RWTH Aachen (Visual Computing Institute).
  - Jieyin Yang, AMSS.
  - Shiqing Xin, Shandong University.
  - Dong-Ming Yan, CASIA.
  - Published August 2025. Crossref lists 43 references and 6 citing works. DOCUMENTED (https://api.crossref.org/works/10.1145/3730908).
- License and porting implications:
  - The paper is **CC BY-NC 4.0**, printed on page 1. DOCUMENTED.
  - The paper states "The source code and the dataset will be released publicly upon acceptance" (sec. 5). As of 2026-09-24 **no code is published**. DOCUMENTED.
    - The first author holds a placeholder repository, https://github.com/ying-yu-yang/SolidBoolean: README "The code will be available soon", one "Initial commit" on 2025-04-29, 5 stars, and one open issue (#1, 2025-07-07) asking for the code.
    - The repository is already licensed **GPL-3.0**. If code appears under that licence, porting it (as opposed to re-implementing from the paper) would impose GPL on wonky.
    - Nothing under yangjieyin or wangbolun300.

    DOCUMENTED (`gh api repos/ying-yu-yang/SolidBoolean`, contents, commits, issues).
  - The algorithms themselves are not covered by CC BY-NC. A clean Bend re-implementation from the paper is unencumbered, but figures and text may not be copied into a commercial product. INFERRED.
  - Their implementation depends on:
    - Cherchi et al. 2022 mesh Booleans. Cinolib is MIT; Cherchi's InteractiveAndRobustMeshBooleans is GPL-3. HEARSAY from their repositories, not re-checked here.
    - CGAL 6.0.1 CDT, which is GPL/commercial.

    wonky would not link any of these anyway.
- Status: new, and the latest in a line of work by the Jia group:
  - "Topology Guaranteed B-Spline Surface/Surface Intersection", TOG 42(6) 2023 (https://doi.org/10.1145/3618349).
  - "Overlap Region Extraction of Two NURBS Surfaces", SIGGRAPH Asia 2025 (https://doi.org/10.1145/3763308).

  Slides for both were read. Another open-source kernel project, sequoia-hope/waffle-iron (Rust, MIT), considered the method and rejected it as "very high effort, requires bijective mesh-to-BREP mapping infrastructure" (https://github.com/sequoia-hope/waffle-iron/blob/main/MARCH-ALGO-WORK.md). DOCUMENTED.

## What it is

A B-rep Boolean that keeps a **hybrid representation**: every B-rep face has a triangle discretisation with a certified surface-to-mesh distance dε and a bijective patch-to-mesh map. The pipeline:

1. Discretise within dε (sec. 4.1).
2. Detect all candidate intersections conservatively on the meshes (sec. 4.2).
3. Refine every intersection point onto the true surfaces by numerical optimisation (sec. 4.3).
4. Re-triangulate so that the refined curves are mesh edges again (sec. 4.4.1).
5. Run a mesh Boolean (inside/outside classification of Cherchi 2022).
6. Segment the result by source face and map each patch plus its boundary curves back to the parametric surfaces (sec. 4.4.2).
7. Handle failures separately (sec. 4.5).

Topology comes from the mesh Boolean, geometry from the surfaces. All input surfaces, including planes and quadrics, are **converted to NURBS** for discretisation (sec. 4.1.1). DOCUMENTED.

## How it works

### 4.1 Error-bounded discretisation
- Split each NURBS into rational Bézier sub-patches.
- The initial mesh per sub-patch is two triangles on the corner control points: △p00 p0n pm0 and △p0n pm0 pmn.
- If the patch-to-triangle distance exceeds dε, split the patch into 4 and repeat. Each iteration doubles the mesh density, which is uniform refinement rather than adaptive, by design, to "avoid combinatorial problems".
- Termination follows because control nets converge to the surface under subdivision (Prautzsch-Kobbelt 1994).
- Vertices are sampled on the surface, so every vertex has exact (u,v).

DOCUMENTED.

**Theorem A.1.** If all control points of each sub-patch lie within dε of a planar convex polygon Pᵢ in M, then the patch lies within dε of M. This follows from the convex hull property and the convexity of the dε envelope. DOCUMENTED.

**Theorem A.2** (the tighter test actually used):
- Project the 4 corners onto the plane through the 4 edge midpoints of the corner quad, giving the planar quad w0..w3. d is the quad-to-mesh distance.
- If the quad is convex and all control points lie within ω of it, with ω + d < dε, the patch is within dε of the two triangles.
- Concave quads (10 of 33,502 patches in their data) fall back to A.1 with one triangle.

DOCUMENTED (Figs. 3-4).

**Trimmed faces and adjacency:**
- Each face is triangulated independently on its untrimmed (u,v) rectangle.
- Boundary curves are re-sampled, and CDT (CGAL) re-triangulates the adjacent faces around each boundary curve. The trimmed region is removed as in Diazzi 2023.
- No global watertight parameterisation is needed.

DOCUMENTED (sec. 4.1.2).

**Boundary triangles get their own bound:**
- For triangle T, find the minimal (u,v) rectangle covering its vertices.
- Subdivide the NURBS to that rectangle and take d(T) = max distance of its control points to T.
- dε(T) = dε for inner triangles and d(T) otherwise.

DOCUMENTED (Fig. 6).

**Practical setting:** dε = 10⁻² × AABB diagonal. DOCUMENTED.

**Validation (Table 1):** with 100k surface samples, the maximum dₛ/dε was 0.051 to 0.79 across four models. The bound held in all cases. DOCUMENTED.

### 4.2 Conservative intersection detection
- **Distance filter (eq. 1).** If p_AB is a true intersection point, the closest triangles satisfy Dis(△A, △B) ≤ Dis(p_AB, △A) + Dis(p_AB, △B) < 2dε. Every triangle AABB is inflated by dε (or d(T) on boundaries) and inserted in an **octree**. Pairs whose inflated boxes overlap are candidates. This removes false negatives, Case III in Fig. 8. DOCUMENTED.
- **Gauss-map filter (Theorem 4.1).**
  - A small closed loop always contains a point pair with collinear normals (Sederberg-Christiansen-Katz 1989).
  - The u- and v-difference vectors of the control net are bounded by half-cones C1 (axis a1) and C2 (axis a2) with common apex o.
  - All normals then lie in a circular cone C3 with axis d = a1 × a2/|a1 × a2| and half-angle θ = arccos(n·d). Here n is the normal of a plane through o tangent to both C1 and C2 with (a1·n)(a2·n) < 0.
  - Precondition: a plane separates the half-cones and C1 ∩ C2 = {o}. Otherwise the patch is refined.
  - Candidates whose Gauss maps do not overlap are dropped. This cut invalid detections by 40.7% and optimisation time by 34.9%.

  DOCUMENTED (Fig. 9, App. B).
- **Seeds for non-crossing candidate pairs:** the barycentre of △A and its closest point on M_B. Points that fall on an already-solved curve are discarded as redundant. DOCUMENTED (Fig. 10).
- **Seeds for crossing pairs:** the mesh intersection is computed with Cherchi 2022 **implicit points** (indirect predicates). Each intersection vertex maps back to both surfaces by barycentric (u,v) interpolation. DOCUMENTED (sec. 4.2.3).

### 4.3 Intersection optimisation
The tolerance is dp = 10⁻⁷ (model units after scaling) and the angular tolerance is 10⁻⁶ rad. Iteration stops when |S_A(u,v) − S_B(s,t)| < dp. DOCUMENTED (sec. 4.3, 5).
- **Newton, minimum-norm (App. C).** D(u,v,s,t) = s1(u,v) − s2(s,t) is a 3x4 system. With Δ = ∇Dᵀa, solve (∇D ∇Dᵀ) a = s2 − s1 and set x ← x + ∇Dᵀa. This is the minimum-norm Gauss-Newton step. Used for **tangent points and for points gliding on boundary curves**, where the step is restricted to the curve. DOCUMENTED.
- **Geometric method (sec. 4.3.2).**
  - Linearise both surfaces as tangent planes P_A^k and P_B^k.
  - Project the current point onto the line L_k = P_A ∩ P_B.
  - Take the parameters from the linearisations.
  - Valid only when the tangent planes are not parallel.
  - It reduced out-of-domain steps by 46.2% compared with Newton, and is used for **points on transversal loops**.

  DOCUMENTED.
- **Failure means absence.** If either parameter domain has no solution, the candidate is a false positive (Case IV) and is dropped. DOCUMENTED.
- **Tangent point vs. small loop.** After deduplication, a lone converged point is classified by its normals:
  - collinear normals: a **tangent point**
  - otherwise: a loop point, which seeds **tracing** (Bajaj-Hoffmann-Lynch-Hopcroft 1988) of the whole loop

  DOCUMENTED (sec. 4.3.3).
- **Curve refinement (sec. 4.3.4).**
  - For consecutive points p, q, re-optimise from the parametric midpoints to get m.
  - Accept the segment when the arc height h(m, pq) < 10²·dp, the chord l = max(|pm|, |mq|) < 10³·dp, and the turning angle α(pm, mq) < π/18.
  - Otherwise recurse into pm and mq.

  DOCUMENTED.

### 4.4 Mesh update and Booleans
- **Mesh update.**
  - Snap both meshes' curve points to the refined point: r_A = r_B = r.
  - CDT **in the parametric domain** with the curve as constraint.
  - A boundary-curve crossing q splits its constrained edge, and near vertices are merged into q.
  - Mesh vertices too close to the curve are removed.
  - **One interior point is inserted into any loop that contains no vertex.**
  - d(T) is recomputed for the new boundary triangles.

  DOCUMENTED (Fig. 11).
- **Mesh Boolean:** standard inside/outside labelling of Cherchi 2022. DOCUMENTED.
- **B-rep reconstruction.**
  - Flood-fill patches from inner triangles until boundary triangles are reached.
  - Collect the boundary curves and "map back to the parametric surfaces by fitting the curve in the parametric domain".
  - Intersection curves are carried **as polylines** during the Boolean.

  DOCUMENTED (sec. 4.4.2, 5.2).
- **Watertightness** is inherited from the mesh Boolean output. The topology is "correct" because the mesh topology matches the B-rep after the update. DOCUMENTED (sec. 4.4.3). This is argued, not proven.

### 4.5 Failure handling
- **Optimise across boundaries (Fig. 12).**
  - Applies when failed points lie between two converged points v0 and v1 on the same surface.
  - Replace the failed points by their midpoint and use the geometric step, **truncated at the face boundary curve** C_b.
  - Continue in the neighbouring face's parameterisation, which needs no reparameterisation.
  - Then solve the curve/C_b crossings q1 and q2.
- **Local refinement (Fig. 14).**
  - Applies otherwise, for example near corners where more than 2 faces meet (Fig. 13).
  - Refine the faces traversed by the failed segment plus their 1-ring.
  - Recompute the mesh intersection only there, splice the new segment between the bounding points p_f and p_b, and re-optimise.
  - Termination is claimed because the mesh intersection converges to the spline intersection under refinement.
- **Reversed-order detection (Fig. 15, eq. 2).**
  - Discrete tangent t̃ = p_b p_r/|p_b p_r| + p_r p_n/|p_r p_n|, exact tangent t = n_A × n_B.
  - An angle between them in (45°, 135°) means a reversal. Degenerate t̃ for collinear points is also treated as a reversal.
  - Repair: repeatedly drop the next point and reconnect.
- **Illegal intersections** from discretisation or updating trigger local refinement.
- **Coplanarity (sec. 4.5.5, Fig. 16, Fig. 20).**
  - Detected **before discretisation**. A 2D Boolean of the coplanar trimmed faces splits each pair into 3 parts.
  - The overlap is replaced by **one shared trimmed planar face**, meshed identically for both models.
  - Coincident edges and vertices are merged in the 2D stage.
  - The overlap boundary is treated as an intersection curve.

DOCUMENTED.

## Robustness and guarantees

- **Proven:**
  - the surface-to-mesh bound (Theorems A.1, A.2)
  - the normal-cone bound (Theorem 4.1)
  - the 2dε proximity necessity (eq. 1)

  DOCUMENTED.
- **Claimed:**
  - termination of discretisation and of local refinement, by convergence arguments
  - watertight, topologically correct output
  - zero failures on their test sets

  DOCUMENTED claims, not formal proofs.
- **Explicit correctness boundary**, in the authors' words: "we can only guarantee the correctness of Boolean operations when there are no small loops whose size and distance are both smaller than the mesh resolution". Only **one seed** is created per non-intersecting triangle pair within dε, so several small loops in one region may be missed. DOCUMENTED (sec. 6). Local subdivision would find them, but at unbounded depth (Krishnan-Manocha 1997).
- **Accuracy vs. ACIS (Table 2, 100 pairs):**
  - their points to ACIS curves: max 4.06e-7, mean 6.8e-12
  - ACIS curves to their polylines: max 9.40e-5, mean 1.37e-7

  Both are relative to the AABB diagonal. The second number is polyline chordal error, not point error. DOCUMENTED.
- **Tolerance semantics:** dε is a discretisation certificate, and dp is a point residual. No per-entity modelling tolerance is stored, and there is no link between dp and the output B-rep edge tolerance. The curve-to-pcurve fit error in reconstruction is not reported. INFERRED.
- **Not handled:**
  - multi-body simultaneous Booleans. They proceed pairwise, and common intersection points of several bodies are the stated limitation.
  - interactive rates

  DOCUMENTED (sec. 6).
- **Floating point everywhere** except the mesh-arrangement predicates, which are Cherchi's indirect predicates (exact). INFERRED from sec. 4.2.3 and 5.

## Parallelism and performance

Hardware: i9-13900, 64 GB, Windows. Implementation in C++. DOCUMENTED.

- **Set A, 10,000 random rotated ABC pairs**, average (max) time per single Boolean:

  | Engine | Avg (s) | Max (s) |
  |---|---|---|
  | This method | 0.06 | 2.34 |
  | ACIS | 0.14 | 7.17 |
  | Rhino | 0.14 | 3.69 |
  | OCCT | 1.06 | 19.43 |

  That is **17x faster than OCCT** and **2.3x faster than ACIS/Rhino**. DOCUMENTED (Fig. 19).
- **Set B, 100 complex pairs x 4 operations** (Table 5):

  | Engine | Total (s) | Max (s) | Max mem (GB) | Failures |
  |---|---|---|---|---|
  | OCCT | 1344.08 | 52.38 | 1.19 | 10 |
  | Rhino | 224.02 | 8.99 | 0.21 | 8 |
  | ACIS | 136.60 | 9.55 | 0.11 | 1 |
  | This method | 65.81 | 1.59 | 0.58 | 0 |

  94% of operations finish within 0.4 s, against 80.5% (ACIS), 65.25% (Rhino) and 31% (OCCT). DOCUMENTED.
- **dε sweep (Table 3).**

  | dε | Triangles | Resolution increases | Time (s) |
  |---|---|---|---|
  | 5e-2 | 13.2M | 14 | 101.85 |
  | 3e-2 | 14.0M | 11 | 81.88 |
  | 1e-2 | 15.8M | 4 | 65.81 |
  | 7e-3 | 17.4M | 4 | 79.14 |
  | 5e-3 | 20.0M | 3 | 90.54 |
  | 3e-3 | 27.2M | 2 | 113.01 |
  | 1e-3 | 60.2M | 1 | 192.22 |

  All with 0 failures. The optimum is near 1e-2. DOCUMENTED.
- **Time breakdown (Fig. 18):**
  - mesh intersection (Cherchi 2022): ~50%
  - mesh Boolean: next largest; together with mesh intersection, >70%
  - optimisation: ~8-9%
  - discretisation: ~14-17%
  - B-rep reconstruction: <3%

  "does not exceed twice the time taken for Boolean operations on the corresponding triangle meshes". DOCUMENTED.
- **Showcases** (this method / ACIS / Rhino / OCCT, seconds):

  | Case | This method | ACIS | Rhino | OCCT |
  |---|---|---|---|---|
  | 400 balls subtraction | 3.5 | 7.6 | 13.1 | 47.8 |
  | 234 cylinders subtraction | 1.2 | 3.3 | 3.9 | 10.7 |
  | SIG letters union | 1.4 | 2.0 | 2.8 | 387.5 |
  | Apple, 7 subtractions | 0.4 | 0.9 | 2.1 | 189.5 |

  Fitted cow, 405 patches: 2.3 s, against OCCT 180.3 s; Rhino and ACIS fail. DOCUMENTED.
- **No parallelism reported.** Structurally (INFERRED):
  - per-patch discretisation and certificate tests, per-candidate Gauss-cone tests, and per-point optimisation are uniform, independent work
  - octree build, CDT, mesh arrangement and classification are irregular
  - the sequential bottleneck is exactly the mesh-arrangement stage, which is also their dominant cost

## Known failures, limitations, war stories

- **Author-stated:**
  - multi-body common points
  - multiple small loops within one dε region
  - no interactive rates

  DOCUMENTED.
- **Competitor failures they document:**
  - OCCT misses a narrow face and returns a non-watertight result, or misses a solid (53 of 54).
  - Rhino returns an empty result or misses a solid.
  - ACIS fails on the 216-sphere union x bird model (Fig. 1).
  - Small-loop cases (Fig. 26): Rhino and OCCT return empty sets, and ACIS solves 1 of 2.

  DOCUMENTED.
- **The coplanar branch is plane-only.** Coincident cylinders, cones or spheres are not handled as overlaps in this paper. The later SIGA 2025 overlap paper addresses NURBS overlap with an explicit ε: overlap = {(u,v) : dist(r1(u,v), S2) ≤ ε}. DOCUMENTED (sec. 4.5.5; SigA25 slides). For wonky's coaxial-cylinder and shared-cylinder contact cases, this matters. INFERRED.
- **"Bijective" requires regularly defined NURBS** (sec. 4.1.2). Degenerate patches such as cone apices and sphere poles are exactly where the Gauss-cone precondition and the bilinear-quad test get weak. The paper does not discuss them. INFERRED.
- **The output curves are polylines fitted in the parametric domain.** Exactness is lost at the output: the result B-rep carries fitted trims, not exact analytic intersection curves. INFERRED from sec. 4.4.2 and 5.2. This conflicts with wonky's analytic-first stance unless the recovery step is replaced.

## Relevance for wonky

- **This is the published, benchmarked version of wonky's leading bake-off hybrid.** A robust mesh Boolean decides topology, and the true surfaces provide the curves. It shows that the architecture beats ACIS, Rhino and OCCT on both speed and failure count on ~10k real models. INFERRED.
- **What to take for wonky's analytic surface set** (plane, cylinder, cone, then sphere and torus) (INFERRED):
  1. **The dε certificate.** For quadrics no Bézier conversion is needed: the exact chord and sagitta bounds of circles and ellipses give an analytic dε per triangle. wonky's certified print mesh already has this. Reuse it as the Boolean scaffold mesh so that one certificate serves both.
  2. **The 2dε candidate rule with dε-inflated AABBs.** A cheap, GPU-uniform generator with no false negatives.
  3. **A Gauss-map overlap filter.** For quadrics the normal set of a face patch is analytic: an arc of a great circle for a cylinder strip, a small-circle band for a cone. It does not need Theorem 4.1's control-net cones.
  4. **The tangent-point vs. loop decision by normal collinearity.** It must be wonky-banded: Resolved when clearly transversal, Unresolved(NearTangency) inside the band.
  5. **Coplanar pre-pass.** 2D Boolean of coplanar faces before meshing, and one shared face for the overlap. This is the mechanism wonky's g10 contact case needs, generalised to coaxial cylinders and cones via the SIGA 2025 ε-overlap definition.
  6. **Across-boundary continuation.** A truncated step onto the face boundary, then a switch to the neighbour parameterisation. Relevant for the multi-face cylinders in the g2/P10 corpus.
- **What to replace:**
  - Newton and geometric optimisation plus tracing become **analytic curve identification** for quadric pairs (Miller-Goldman table, Miller 1987 closed-form QSIC branches; see `miller-goldman-1995-geometric-algorithms-for-detecting-and-c.md`).
  - Polyline trims fitted in (u,v) become **exact curves**: conics, or the XT-style chart intersection curve for the rest.

  The mesh then decides only *which* analytic branch and *which* interval, never the geometry. INFERRED.
- **Bend fit** (INFERRED):
  - Discretisation certificate, box/cone filters and per-point refinement are uniform F32x2 work: fork-join over patches and candidate pairs, GPU lanes per point.
  - The mesh-arrangement stage needs exact orientation predicates (Cherchi-style implicit points), i.e. the multi-limb U32 path. EMBER-style plane-based points are the alternative already in the bake-off.
  - CDT in (u,v) and flood-fill segmentation are sequential rebuilds between parallel phases: persistent arrays, no mutation.
  - dp = 1e-7 relative fits comfortably inside F32x2's ~1e-14 relative precision. The paper's 1e-6 rad angular tolerance is far looser than wonky's 1e-10 default.
- **Policy fit:**
  - The mesh is internal scaffolding and never escapes into the output, so wonky's no-silent-faceting rule holds.
  - The "increase resolution" loop needs an explicit cap and a typed failure when the cap is hit. The paper has neither.
  - Each output curve should carry its residual and dε in provenance.

  INFERRED.

## Pointers worth porting or studying

1. Theorem A.2 (bilinear-quad certificate) and the d(T) rule for boundary triangles (Fig. 6). Use them for future B-spline faces, and as a template for per-triangle certificates on quadrics.
2. Eq. 1 plus octree over dε-inflated AABBs (sec. 4.2.1). This is the candidate generator.
3. Theorem 4.1 normal-cone bound (App. B), for B-spline faces. For quadrics, use analytic Gauss images instead.
4. App. C minimum-norm Gauss-Newton: Δ = ∇Dᵀ(∇D∇Dᵀ)⁻¹(s2 − s1), a 3x3 solve per step. Use it as the refiner for non-analytic pairs, with an iteration cap.
5. Sec. 4.3.2 tangent-plane-line projection step. It is more robust near domain boundaries.
6. Sec. 4.3.4 refinement acceptance: h < 100·dp, l < 1000·dp, α < 10°. This is a ready-made chart-density rule for an XT-style chart.
7. Sec. 4.5.3 reversal detection (angle between the discrete tangent and n_A × n_B in (45°, 135°)). Use it as a validator on any chained intersection polyline, including the mesh-seeded chains in the bake-off.
8. Sec. 4.5.5 and Fig. 20: coplanar 2D Boolean pre-pass with merged coincident edges and vertices.
9. Benchmark protocol:
   - 10k random rotated ABC pairs x 4 operations
   - a 100-pair "complex" set
   - failure counts plus a slow-case CDF against OCCT

   Reuse it for the bake-off report.

## Verdict: adapt

This is the reference design for wonky's leading hybrid prototype. Adapt the certificate, the conservative candidate conditions, the tangent/loop classification, the across-boundary continuation and the coplanar pre-pass natively in Bend. Replace its NURBS-and-polyline geometry path with exact analytic curve recovery for wonky's quadric faces. Keep its benchmark protocol as the yardstick. There is no code to port, the licence is CC BY-NC for the text only, and no independent reproduction of the results has been published. The announced code repository is an empty GPL-3.0 placeholder (ying-yu-yang/SolidBoolean). If it is ever filled, clean-room re-implementation from the paper remains the licence-safe route.
