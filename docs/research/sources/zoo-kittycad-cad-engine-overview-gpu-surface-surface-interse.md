# Zoo (KittyCAD) "Zoo CAD Engine Overview": GPU surface-surface intersection

- Kind: vendor research article (whitepaper-style blog post), read together with the patent it cites and Zoo's public issue tracker and KCL docs.
- Canonical URL: https://zoo.dev/research/zoo-cad-engine-overview (HTTP 200 on 2026-09-23).
- Other URLs:
  - Source file: https://github.com/KittyCAD/documentation/blob/main/content/research/zoo-cad-engine-overview.mdx. The local copy `tmp/research/zoo/zoo-cad-engine-overview.mdx` is byte-identical to `main` on 2026-09-23 and was read in full.
  - Patent: US 12,229,885 B1, "Surface-to-surface intersections in computer-aided graphics and modeling", https://patents.google.com/patent/US12229885B1/en. Local copy `tmp/research/zoo/US12229885B1.{html,txt}`; claims and full description read.
  - Launch post: "Zoo Design Studio v1: A New Stack for Mechanical CAD", Jessie Frazelle, 2025-05-21, https://zoo.dev/blog/zoo-design-studio-v1.
  - KCL reference docs (in https://github.com/KittyCAD/modeling-app): `docs/kcl-std/functions/std-solid-subtract.md`, `std-solid-fillet.md`, `docs/kcl-lang/migrating-to-kcl-3.md`.
  - Issue tracker: https://github.com/KittyCAD/modeling-app/issues. The engine repository `KittyCAD/engine` is private (GitHub API 404 on 2026-09-23), but engine failures are reported and triaged in the app tracker.
- Authors and organization: Mike Farrell and Alyn Rockwood, with Serena Gandhi as additional contributor; Zoo Corporation (formerly KittyCAD). Dated 2025-05-20. DOCUMENTED (mdx front matter). The patent names Alyn Rockwood as the sole inventor. DOCUMENTED (Google Patents).
- License and porting implications:
  - Article text: the `KittyCAD/documentation` repo is MIT-licensed (GitHub API: `license: MIT`, 6 stars, pushed 2026-09-22). The file was last changed 2026-06-30 ("Fix typos (#929)"). INFERRED: the MIT license covers the article content, so quoting and paraphrasing are unproblematic.
  - Engine: closed and proprietary. DOCUMENTED (v1 post): "Zoo Design Studio (the application layer, not the engine) is open source". The app `KittyCAD/modeling-app` is MIT, 1302 stars, pushed 2026-09-22.
  - Patent: **US 12,229,885 B1 is granted**. This resolves the earlier HEARSAY. DOCUMENTED (Google Patents):
    - application 18/662,056, filed and priority date 2024-05-13;
    - granted 2025-02-18; status "Active";
    - anticipated expiration 2044-05-13;
    - small-entity fees;
    - current assignee listed as "Individual" (Google warns the assignee list may be inaccurate).
  - The patent has 16 claims; claims 1, 6, 11 and 16 are independent (see "Pointers"). INFERRED, not legal advice: implementing the claimed pipeline in a distributed product would carry US patent risk until about 2044. Wonky is currently private and unlicensed, which reduces but does not remove this. Design-arounds are listed below.
- Status and activity:
  - The engine is actively developed. DOCUMENTED (modeling-app issues):
    - an SSI rewrite landed around March 2026 as private engine PR #4142, referenced in modeling-app #10710 (2026-03-31);
    - a `legacyMethod` flag ("If true, revert to older engine SSI algorithm") was added to `union`, `subtract`, `intersect`, `split`, `fillet` and `chamfer`;
    - `legacyMethod` was deprecated in KCL 2.0 (PR #11456, 2026-05-05) and removed in KCL 3.0 (#12982, closed 2026-08-13; #11699 "Remove opt-out of Austin's new SSI for CSG ops", closed 2026-09-03).
  - The article (May 2025) therefore describes the SSI generation *before* that rewrite. Whether the 2026 SSI still uses the patented point-cloud method is not public. INFERRED.
  - The article promises a companion paper: "A separate white paper details the research we have done into the evaluation of NURBS using GPUs". The zoo.dev research index lists five posts on 2026-09-23 and none of them is that paper, so it is unpublished. DOCUMENTED (research index JSON). Re-checked 2026-09-24 in the source repo: `content/research/` still holds exactly five files (`a-practical-overview-of-cad-file-formats`, `automating-your-workflow`, `introducing-kcl`, `zoo-cad-engine-overview`, `zookeeper`); the last commit touching the folder is 2026-08-28 (an author-image path fix).
  - `KittyCAD/modeling-app`: 1303 stars, pushed 2026-09-24 (GitHub API, 2026-09-24).

## What it is

A motivation-plus-case-study article about Zoo's in-house B-rep engine. DOCUMENTED (mdx §1-4). It covers five topics.

1. **GPU thesis.** CAD kernels predate GPUs; geometry and rendering are both "under-leveraged" on the GPU.
2. **"Combinatorial curse" of primitive types.** Every new surface type multiplies the pairwise operation implementations. Zoo's answer: "maintaining a minimal set of geometric primitives. Rather than implementing specialized representations for features like fillets, we represent these as B-splines with specific constraints. This way, operations only need to handle B-splines, allowing us to develop highly optimized, GPU-friendly algorithms like our surface-surface intersection method."
   - Tension: the v1 post claims "Exact NURBS & analytic surfaces" throughout the stack. INFERRED: analytic surfaces are probably kept as data but evaluated as NURBS inside SSI, since Zoo uses OpenNURBS (v1 post: "We leveraged open source libraries like OpenNURBS and Vulkan").
3. **API-first CAD-as-a-service.** No private fast path for the first-party app.
4. **Sweeps (§3.1).**
   - Definition: `S(u,v) = T(v) + M(v)·C(u)`, with profile C, trajectory T, and orientation M (3x3 orthonormal or quaternion).
   - NURBS form: tensor product with `P_ij = T_j + Q_i` and `w_ij = w_i^C · w_j^T`.
   - Lines and arcs in the trajectory reduce to extrusions and revolutions.
   - A decomposed sweep yields A x B untrimmed faces (A profile pieces x B trajectory pieces), plus two caps for open trajectories. These are joined "via a join algorithm which merges all faces with coincident edges". The figure shows 10 faces.
   - Foldover is avoided by segmenting the trajectory so that the curvature `κ = |r' × r''| / |r'|³` does not exceed the limit implied by the section size. The limit is not stated as a formula; INFERRED `κ_max ≈ 1 / (max section radius)`. Finite-difference curvature is shown to track the analytic one closely (Fig. 11).
5. **Patterns (§3.2)**, rendered as GPU instances.
6. **Case study: GPU-friendly SSI (§4)**, the core of this note.

## How it works (SSI pipeline)

All steps are DOCUMENTED from the article (§4.3) and the patent description (FIGs. 1-12, modules 1314-1319) unless labelled otherwise.

1. **Sample.** Evaluate both surfaces on a (u,v) grid into 5-tuples `(x, y, z, u, v)`. The patent mentions evaluating "parametric polynomial descriptions ... over a chosen or pre-established grid", Horner's method and "flood filling". Example: two perpendicular cylinders at 400 x 400 samples each (Fig. 20).
2. **Distance filter.** Take one surface as the **reference** (the patent says the "flatter surface may be selected as the reference surface" for a more accurate uv/object mapping).
   - Keep every reference point whose distance to *some* point of the other surface is below ε (or whose squared distance is below σ). This is an all-pairs O(N·M) test.
   - It is parallelized "per first-surface point against all second-surface points" (claims 3/8/13, FIG. 6).
   - Patent pseudo-code (`SSI_bspline(meshF, meshC, gridTol)`) is a doubly nested loop comparing squared distance to `gridTol`. It appends the *meshC* point, i.e. the non-reference point, contradicting the prose.
3. **Level of detail (LOD).** Start coarse (40 x 40), then super-sample 20 x 20 sub-patches around the hits. This gives an effective 800 x 800 density at a fraction of the pairs (Fig. 21). The patent adds quadtree/octree culling: a spatial cell is refined only if both surfaces have samples in it.
4. **Parameter-space processing on the reference ("master") surface.**
   - The hits form thick, "wiggly" bands in uv (Fig. 23). The band widens where branches cross, "because the surfaces lie closer to each other" (Fig. 20 caption).
   - The bands are rasterized and thinned by a medial-axis transform or skeletonization (Fig. 24).
5. **Branch detection** on the skeleton pixels (Python in §4.3.3):
   - Build a dense K x K squared-distance matrix over pixel coordinates.
   - Set adjacency to `dist² ≤ 2` (8-neighbourhood, self included).
   - Classify by row sum: a sum > 3 means a joint (≥ 3 neighbours); a sum == 2 means an endpoint (1 neighbour). Endpoints on the uv boundary get a separate tag. The boundary index 34 is hard-coded ("num patches-1 times res").
6. **Ordering and smoothing.**
   - Walk the adjacency from each endpoint until a joint or endpoint is reached.
   - Fold a weighted moving average (convolution, e.g. a hat filter) into the walk. Claimed effects: fewer outliers, gaps filled, fewer points, and points "straightened" for fitting.
   - "The kernel size and shape affect the value ... there is a fair amount of engineering ... specific heuristics to best choose the parameters."
7. **Fit and map back.** Fit a cubic interpolating B-spline per branch in the master surface's uv space, then map it to 3D by evaluating the master surface (Figs. 26-27).
   - Options: compute an SSI for each surface and average them ("should be even more accurate. Many tests are still needed"). The patent also mentions a "healing surface" between the two fitted curves.
8. **No intersection.** If no pair falls under the threshold, report "no intersection", *or* "the threshold may be adjusted for greater sensitivity" (patent). That is an implicit tolerance growth.

**Numeric model.** Not disclosed.
- No floating-point format, error bound or relation between ε and the model tolerance is given.
- The KCL docs separately state the engine tolerance for CSG and fillets: "Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar ... default value of 10^-7 millimeters". DOCUMENTED (`std-solid-subtract.md`, `std-solid-fillet.md`).
- INFERRED: 1e-7 mm on parts of about 100 mm needs better than F32 (F32 ulp at 100 mm is about 7.6e-6 mm). So either the SSI output is refined in f64 afterwards, or the tolerance is not actually met by the sampled curve.

**Contradiction worth noting.** The v1 post describes the SSI as "a parallelizable root-finding problem that runs on modern GPUs" and says "Legacy geometry engines handle SSI with thousands of if/else branches". The overview describes sampling plus a distance filter, not root finding. INFERRED: either a Newton-type refinement follows the seeding, or the description predates a change.

## Robustness and guarantees

- **Proven: nothing.** DOCUMENTED: no error bound, completeness claim or topological guarantee in the article or the patent. The authors call SSI inherently approximate: "SSI necessitates algorithms that are approximate".
- **Heuristic by design.** INFERRED, from the pipeline:
  - **Missed features.** Closed loops smaller than the sample spacing, isolated tangential contacts and short branches can fall between samples. LOD refinement only refines around *existing* hits, so it cannot recover a missed loop.
  - **Tangency and near-coincidence.** Where surfaces are nearly tangent, the ε-band becomes wide, and skeletonization of a wide band yields an arbitrary centreline. This is exactly the regime where topology matters most.
  - **Raster resolution.** Branch points and endpoints are found at pixel resolution in uv. A branch point's location is only as good as the grid.
  - **One-sided accuracy.** The fitted curve lies exactly on the master surface, but its distance to the other surface is uncontrolled. Downstream it behaves like a Jackson-style tolerant edge, without a recorded tolerance.
  - **Silent tolerance growth.** The patent's "adjust the threshold for sensitivity" fallback is exactly what wonky's rules forbid.

## Parallelism and performance

- DOCUMENTED:
  - The only numbers are sample sizes: 400 x 400 per cylinder; 40 x 40 + 20 x 20 LOD for an effective 800 x 800.
  - No timings. The v1 post: "We'll publish detailed benchmarks as further optimizations land". None were found on the research index on 2026-09-23.
  - The engine uses Vulkan (v1 post).
- INFERRED work estimate:
  - A flat 400 x 400 vs 400 x 400 all-pairs test is 1.6e5 x 1.6e5 = 2.56e10 distance evaluations per surface pair: brute force even for a GPU.
  - The LOD variant needs 1600 x 1600 = 2.56e6 coarse pairs plus small local blocks. That is uniform, cheap and embarrassingly parallel.
  - Steps 5-7 (skeleton, adjacency walk, fitting) are data-dependent and branchy. They are small (K pixels per branch) and INFERRED to run on the CPU.

## Known failures, limitations, war stories

All DOCUMENTED on https://github.com/KittyCAD/modeling-app/issues. Engine failures surface to users as "The Zoo engine cannot handle this 3D {union|subtraction|intersection} yet".

- **#7485** (2025-06-14, open), coplanar union fails.
  - Zoo's CEO: "this the coplanar bug, when things are perfectly aligned on the same [plane] csg will fail".
  - A user's workaround for FDM: skip the union and let the slicer merge the touching bodies.
  - This is the case ACIS glue and Parasolid matched regions exist for.
- **#10621** (2026-03-27, open): `intersect` of two coaxial revolved solids fails. The knob has cone and cylinder faces; the bevel tool is a revolved triangle giving a cone.
  - Zoo: "Looks like our recent SSI push didn't solve this one".
  - The reporter shows it is not coplanarity: moving the tool's bottom face away does not help.
  - INFERRED: coaxial cone/cylinder pairs intersect in circles, which is trivial analytically and hard for sampling. This is exactly the class wonky already handles by special case (coaxial revolves).
- **#13438** (2026-08-29, open): two box subtractions succeed in one order and fail in the reverse order. An order-dependent Boolean.
- **#11068** (2026-04-14, open): union of four swept tube segments that meet tangentially with coincident circular end caps fails.
  - Zoo staff prompted the in-app LLM agent (Zookeeper) to rewrite the model as one sectioned sweep as a workaround.
- **#12429** (2026-07-13, closed 2026-07-20): a 2 mm fillet on a box edge works for size 20 but fails for 18, 19, 21 and 22.
  - Root cause (Zoo engineer): "we had a bug detecting when surfaces were planar or not, and the small differences in our sketch solver caused by the start positions of the sketch not matching the final solved positions were causing this KCL to hit that bug."
  - Planarity was inferred from noisy solver coordinates.
- **#9100** (2025-11-27, open): chamfer or fillet on a revolved profile gives "Edge cut failed". The engine team later said the radius was too large; it works with fillet version 2 at a smaller radius and "Still need a better error for the too large case".
- **#13709** (2026-09-07; closed "not planned" 2026-09-23): the oversize-fillet regression test snapshots the full message "The Zoo engine cannot handle this 3D subtraction yet. / Edge cut failed".
  - INFERRED: fillets are executed as a CSG subtraction of an edge-cut tool.
  - The issue is that tests compared *prose* rather than a typed classification.
  - Maintainer resolution (DOCUMENTED, closing comment): "Full diagnostic snapshots are intentional simulation-test coverage ... the controlled message change demonstrates snapshot sensitivity, not an unresolved product bug." Zoo keeps prose snapshots as its failure contract.
- **#13200** (2026-08-21, open): adding only `kclVersion = 2.0` to the `field-monitor-stand` sample makes its four-edge 5 mm exterior fillet fail with "Edge cut failed" (0.5 mm fails too). Omitting the fillet changes volume by +0.1862%, area by +0.2730% and moves the centre of mass 0.0584 mm, so the sample was dropped from the KCL 2 migration. A language-version header switched algorithm generations and broke a building model.
- **#12578** (2026-07-23, open, "Flagging this on our engine board"): a flat 3 mm sheet-metal-style plate (150 x 70 mm, mounting holes, trapezoid notch, Ø16 cable notch) fails at the final `subtract` of the cable tool. An FDM/laser-scale prismatic part, i.e. exactly wonky's target class.
- **#10710** (2026-03-31): the new SSI changed the behaviour of several tests. One sample (`tooling_nest_block`, a fillet with `radius = nestSize * .99` after a negative, self-intersecting extrude) was declared "fundamentally flawed ... it should never have worked". Algorithm upgrades change which models succeed.
- **#13854** (2026-09-13, open): "Document getCommonEdge face provenance after Boolean operations". Topological naming across Booleans is still being specified.

## Relevance for wonky

1. **Bend fit of the uniform part.**
   - Steps 1-3 (grid evaluation, distance tests, LOD refinement) are the most GPU-uniform SSI formulation published by a commercial vendor. They map directly onto Bend: a balanced fork-join over grid tiles, and a GPU call tree with identical work per sample.
   - F32 is enough for *culling and seeding* only. At 1e-7 mm, wonky's contact bound (`local design note`, identical to Zoo's documented default), F32 cannot represent the answer.
   - Refinement must be F32x2 Newton. With a ~48-bit mantissa, the F32x2 ulp at 100 mm is 2^-41 ≈ 4.5e-13 mm, about 5.5 decimal orders below the 1e-7 mm bound.
   - Existence decisions (does a loop exist? is this a tangency?) need exact multi-limb predicates or analytic arguments. For example, discriminant signs for quadric pairs (see the quadric-intersection notes).
2. **Wonky already has a better seed source than point clouds.**
   - The leading hybrid (`docs/proto-recover.md`) runs a robust tagged mesh Boolean first. Its triangle-triangle intersection segments are tagged with source faces, and are already *ordered, branched and topologically decided*. They make the MAT, adjacency-matrix and threshold stages unnecessary. INFERRED.
   - Recovery then only has to lift each polyline vertex onto the exact SSI. Solve `F_A(p) = 0`, `F_B(p) = 0` and a third condition (plane orthogonal to the local chord) with F32x2 Newton.
   - This targets precisely the current refusals in `docs/proto-recover.md`:
     - "three space quartics" (pipe-tee, Steinmetz, `x-rod-cross-hole`);
     - `x-torus-tilted` spiric sections;
     - plane/cone hyperbolas and parabolas.
   - Status on 2026-09-24 (DOCUMENTED, `docs/hybrid-boolean-plan.md` plan steps 8-9, `local design note`): these refusals now fall back to `CertifiedMesh` bodies (e.g. R20 cases KT1 and KS08, a torus/stem union, pass "through a certified mesh"), and step 9 plans "space quartics of cylinder/cylinder as B-spline curves with a stated bound computed in Bend". The Newton lift described here is the way to compute that bound: the fitted B-spline is checked against lifted exact points, and its tolerance is stored on the edge (Jackson-style; see the Jackson note, item 7).
3. **Representation: follow Parasolid XT, not Zoo.**
   - Zoo outputs a fitted uv B-spline with no certificate.
   - Parasolid XT V35 §5.2.1.5 (`tmp/research/pdf/parasolid-xt-v35.txt`, lines ~1893-2080) publishes an *exact procedural* intersection curve. DOCUMENTED:
     - the two surfaces;
     - a chart of ordered `hvec`s (position, both surfaces' (u,v), tangent, parameter);
     - `chordal_error` and `angular_error`;
     - limits of type help (closed loop), terminator (singular point, stored with a nearby branch point) or limit;
     - a C1 parameterisation via `f_i = (cos b_i / cos a_i) f_{i-1}` and `t_i = t_{i-1} + C_{i-1} f_{i-1}`;
     - evaluation at t as the intersection of both surfaces with the plane through the interpolated chord point, orthogonal to the chord.
   - This is pure data plus a small Newton solve. It is Bend-friendly (immutable arrays, uniform per-query work) and avoids approximation in the stored geometry. Wonky's certified print-mesh deviation machinery can bound the chart's chordal error explicitly. INFERRED.
4. **Keep analytic types; get uniformity by bucketing, not by converting to NURBS.**
   - Zoo's "everything is a B-spline" buys uniform kernels but costs exactness. The rational NURBS circle needs weights like √2/2, which are not exact in F32 or F32x2.
   - Wonky can instead sort candidate face pairs by type pair (plane-plane, plane-cylinder, coaxial cylinders, general cylinder-cylinder, ...) and run each bucket as one uniform map. Only the residual general bucket needs sampling and seeding. INFERRED.
5. **Tolerance calibration.**
   - Zoo: default 1e-7 mm for CSG and fillets (DOCUMENTED).
   - Onshape FeatureScript std: `zeroLength` 1e-8 m = 1e-5 mm (see the Jackson note).
   - Parasolid: 1e-8 m in a 1e3 m box. ACIS: resabs 1e-6 model units.
   - Wonky's 1e-7 mm matches the strictest of these.
6. **Planarity from provenance, never from coordinates** (#12429).
   - Wonky's sketch solver output must be snapped or certified: "these points lie on sketch plane P" is known by construction and should be carried as provenance.
   - Where planarity must be decided from coordinates, use an exact orientation predicate on the F32x2 bit patterns. Never decide it with a float epsilon.
7. **Coplanar and coaxial cases need glue-style known-coincidence paths** (#7485, #10621). This confirms the ACIS glue / Parasolid matched-region recommendation (see the sibling notes). Wonky's existing coaxial-cylinder and planar special cases are a strength here.
8. **Algorithm versions pinned to language versions.**
   - Zoo pins algorithm generations to KCL versions: `legacyMethod` for the old SSI; fillet `version` 1 (original) vs 2 ("supports rolling ball fillets"); KCL 3.0 "always use the newest algorithm". DOCUMENTED (`std-solid-fillet.md`, `migrating-to-kcl-3.md`).
   - This is the same design wonky needs, keyed to the FeatureScript version header. See the ACIS checker note.
9. **Typed failures, not prose** (#13709, and generic "cannot handle this ... yet" messages). Wonky's named refusals should become the typed fault record from the PK/ACIS notes, so that tests and LLMs act on codes.
10. **LLM ergonomics.** Zoo (KCL plus the Zookeeper agent) is the closest competitor in code-plus-LLM CAD. In #11068 the LLM is used to *route around* kernel failures. Typed refusals with a witness (see the PK fault record) would let an LLM do this deliberately rather than by trial and error. INFERRED.
11. **Patent design-arounds.** INFERRED, not legal advice.
    - Claim 16 is broad: derive points from the first surface, and keep those whose distance to the second surface is below a threshold. Even "sample surface A, keep samples with |distance to B| < ε" reads on it literally. Claim 1 adds the all-pairs point-set distance and curve output.
    - Mechanisms that do not rely on a distance threshold between samples:
      - exact triangle-triangle intersection of the tagged mesh (mesh intersection is acknowledged prior art in the patent's own background);
      - sign-change bracketing of an implicit function along grid edges (intermediate value theorem, not a distance test);
      - interval or Bernstein subdivision with exclusion tests;
      - closed-form quadric-pair curves.
    - Claim 16, verbatim (re-read 2026-09-24 from `tmp/research/zoo/US12229885B1.txt`): "A computer-implemented method for determining a set of intersection points between first and second surfaces of one or more 3D models, comprising: receiving a description for each of the first and second surfaces; from the description of the first surface, deriving a set of points representing the first surface; and forming the set of intersection points from points representing the first surface which are distanced from the second surface by less than a threshold distance."
    - Check against wonky's current hybrid (`docs/proto-recover.md`): corefine computes intersection segments by exact triangle/triangle intersection (no distance threshold). `recover`'s clearance certificate does compare triangle pairs of two faces against h + h' + 1e-6 mm, but only to *refuse* or *verify* topology, not to *form* the intersection point set. Keep that separation explicit in code and docs; any future SSI seeding from "near pairs" should go through sign-change bracketing or exact triangle intersection instead. INFERRED, not legal advice.
    - Prior art cited by the examiner: Krishnamurthy, "Performing Efficient NURBS Modeling Operations on the GPU" (SPM 2008); Krishnamurthy, PhD thesis, UC Berkeley 2010; Hohmeyer, PhD thesis on robust surface intersection, UC Berkeley 1992.

## Pointers worth porting or studying

- Article §4.3.2-4.3.4:
  - the LOD scheme (coarse grid, then local super-sampling) as a GPU culling pattern;
  - the branch taxonomy (regular point, joint, end, boundary end) as a *vocabulary* for wonky's SSI output. Compare XT limit types help/terminator/limit.
- Article §3.1:
  - the sweep tensor formula;
  - A x B face decomposition plus join-by-coincident-edges. Wonky's sweep, when it comes, can emit exact extrusion and revolution faces for line and arc trajectory pieces;
  - curvature-bounded trajectory segmentation against self-intersection.
- Patent FIGs. 5, 6 and 9 (flows), claims 1 and 16 (scope to avoid), and the pseudo-code in the description (module 1315).
- KCL docs: the `tolerance` parameter semantics (1e-7 mm), `legacyMethod`, and fillet `version` 0/1/2, as a precedent for exposing algorithm versions and tolerances in a CAD language.
- Parasolid XT V35 §5.2.1.5 (intersection curve with chart and limits) as the representation to pair with seeding. Read it together with this source.
- Issues #7485, #10621, #11068, #12429, #12578, #13200, #13438 and #9100 as a free regression corpus. Every KCL snippet there is a small, FDM-scale model and can be transcribed into FeatureScript for wonky's acceptance tests.

## Verdict: learn-from

This is the only commercial B-rep engine that publicly builds SSI around uniform GPU work. Its seeding and LOD culling confirm that the first half of SSI fits Bend's GPU model.

The rest of the published pipeline is heuristic:
- raster skeleton, pixel-resolution branch points, tuned convolution;
- an uncertified fitted curve;
- silent threshold growth.

It is also patented until about 2044, and Zoo's own tracker shows it failing on coplanar, coaxial and order-dependent cases that are analytically easy.

What wonky should take from it:
- the uniform seeding and culling idea, implemented through the tagged-mesh intersection or sign-change bracketing (not a distance filter);
- XT-style exact procedural intersection curves;
- F32x2 Newton refinement;
- exact predicates for existence and tangency decisions;
- the language-version pinning of algorithms;
- the issue corpus as test cases.

Do not replicate the claimed distance-threshold pipeline step for step.
