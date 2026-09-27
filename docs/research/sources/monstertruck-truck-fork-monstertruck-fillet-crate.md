# monstertruck (truck fork): `monstertruck-fillet` crate + `rolling_ball_fillet` / `approximate_fillet_surface` decorators

- **Kind / URLs:** Rust repository (Cargo workspace), read as a shallow clone at commit `e6520c2` ("release: 0.4.1", 2026-09-19).
  - Fillet crate: https://github.com/virtualritz/monstertruck/tree/master/monstertruck-fillet
  - Exact procedural surfaces: https://github.com/virtualritz/monstertruck/tree/master/monstertruck-geometry/src/decorators
  - Local copy: `tmp/research/monstertruck/repo`
- **Authors / org / year:**
  - Moritz Moeller (virtualritz) forked it in 2023. The repo was created 2023-02-23; the fillet crate was extracted in 0.4.x (2026). DOCUMENTED: `monstertruck-fillet/Cargo.toml`, `CHANGELOG.md` ("New crate `monstertruck-fillet`").
  - The code descends from RICOS's `truck` (truck-shapeops v0.4.0 fillet prototype). DOCUMENTED: crate README and `lib.rs`. Upstream is https://github.com/ricosjp/truck.
- **License and porting:** Apache-2.0 (DOCUMENTED: `Cargo.toml`, GitHub API `license.spdx_id`). Wonky can port or re-derive it freely. Keep the NOTICE/attribution if code is transcribed. No FFI is involved: we only read it.
- **Status / activity:**
  - Active: pushed 2026-09-19. About 29 stars, 6 forks, 1 open issue (GitHub API, 2026-09-22; re-checked 2026-09-23, unchanged, HEAD still `e6520c2`).
  - Re-checked 2026-09-24: still 29 stars, 6 forks, HEAD `e6520c2`. The only open issue is #4 "design: bounded high-order NURBS boundary continuity" (2026-07-31). The last commits (#25–#27, 2026-09-08 to 2026-09-19) touch B-spline least-squares fitting, the toolchain and meshing trim projection, not the fillet crate. DOCUMENTED: `gh api repos/virtualritz/monstertruck/commits`, `…/issues?state=open`.
  - Contributors (GitHub API): ytanimura 2453 commits (the inherited truck history), virtualritz 174, everyone else ≤5. In practice it is a one-maintainer side project on top of RICOS's code. The maintainer calls it "a side project so no ETA" (issue #24, see below).
  - The fillet crate is 5,193 lines of Rust including tests.
  - `TRUCK-PARITY.md` says the old truck fillet branches are "reference-only … do not resurrect old fillet architecture". DOCUMENTED: https://github.com/virtualritz/monstertruck/blob/master/TRUCK-PARITY.md

## What it is

It is two separate things, and they are easy to conflate.

1. **`monstertruck-fillet`: the practical operation.**
   - Rolling-ball fillets, chamfers, "ridge" profiles and custom 2D-profile blends on edges of a B-rep `Shell`.
   - The README calls it a **post-CSG** pass that is "kernel-independent": it runs on whatever shell the Boolean produced. DOCUMENTED: https://github.com/virtualritz/monstertruck/blob/master/monstertruck-fillet/src/lib.rs
   - API:
     - `fillet(face0, face1, edge_id, opts)`, `fillet_along_wire(shell, wire, opts)`, `fillet_edges(shell, edge_ids, opts)`.
     - Options: `FilletOptions{radius: RadiusSpec::{Constant, Variable(Fn(t)), PerEdge(Vec)}, divisions (default 5), profile: FilletProfile::{Round, Chamfer, Ridge, Custom(BsplineCurve<Point2>)}}`.
     - DOCUMENTED: https://github.com/virtualritz/monstertruck/blob/master/monstertruck-fillet/src/params.rs
2. **`monstertruck-geometry` decorators: the exact procedural fillet surface.**
   - `RollingBallFilletSurface<C,S0,S1,R>` is evaluated exactly (to Newton tolerance) at any (u,v) and has analytic derivatives.
   - `approximate_rolling_ball_fillet` converts it adaptively into a rational-cubic `ApproximateFilletSurface`.
   - DOCUMENTED:
     - https://github.com/virtualritz/monstertruck/tree/master/monstertruck-geometry/src/decorators/rolling_ball_fillet
     - https://github.com/virtualritz/monstertruck/tree/master/monstertruck-geometry/src/decorators/approximate_fillet_surface
   - **The fillet crate's `ops` do not use this exact path.** They build their own approximate NURBS (see below). INFERRED from grep: only `decorators/*` and `monstertruck-geometry/tests/{rbf_surface,af_surface}.rs` reference `approximate_rolling_ball_fillet` / `RollingBallFilletSurface::new`.

## How it works

### A. The fillet crate's "relay sphere" construction

Source: `monstertruck-fillet/src/geometry.rs`, https://github.com/virtualritz/monstertruck/blob/master/monstertruck-fillet/src/geometry.rs. All items below are DOCUMENTED from that file unless noted.

- **Inputs.** Everything is converted to `NurbsSurface<Vector4>`.
  - `convert.rs` refuses non-exact *curves* with `UnsupportedGeometry` ("must never be papered over").
  - For *surfaces* it silently falls back to `sample_surface_to_nurbs(…, 64)`, a 64×64 **degree-1 bilinear** control grid (`convert.rs:9,28,70`). DOCUMENTED: https://github.com/virtualritz/monstertruck/blob/master/monstertruck-fillet/src/convert.rs
- **Contact solve at one station** (`contact_point`, `next_point`, `generate`):
  - Given a point p on the edge and current contact guesses p0 on S0 and p1 on S1 with unit normals n0, n1, solve a **3×3 linear system**.
    - Rows: `n = n0×n1`, `n0`, `n1`.
    - Right-hand side: `(n·p, n0·p0 − s·r, n1·p1 − s·r)`.
    - Result: ball center c. The sign s is chosen from `sign(n·edge_tangent)` and a side flag.
  - Target contact points are `q0 = c + s·r·n0` and `q1 = c + s·r·n1`.
  - Each surface is then projected onto its target by a **Gauss-Newton step using the first fundamental form**: `[Su·Su Su·Sv; Su·Sv Sv·Sv] Δ = [Su·d, Sv·d]`.
  - Iterate up to 100 times until p0≈q0 and p1≈q1.
  - The "transit" (mid-arc) point is `c + r·(p−c)/|p−c|`.
- **Stations.**
  - `relay_spheres` samples `divisions+1` stations along the edge, or −1…divisions+1 when extending past the ends.
  - If a station fails to converge it retries with parameter jitter of ±0.25/div and ±0.5/div.
- **Surface assembly** (`expand_fillet`):
  - Between consecutive stations the contact traces are assumed to be **straight lines in each surface's (u,v) domain**.
  - A line composed with a NURBS patch is exactly a Bezier curve of degree `udeg+vdeg` in homogeneous coordinates. `composite_line_bezier` gets its control points by interpolating that many samples.
  - For each pair of corresponding control points a circular arc through (p0, transit, p1) is built (`circle_arc_by_three_points`).
  - Result: a surface that is a circle (rational quadratic, 6 control points) in u times a Bezier in v, concatenated over segments and knot-normalized.
  - Chamfer is a degree-1 cross-section. Ridge is p0→transit→p1 at degree 1. `Custom` maps 2D profile control points as `p0 + x(p1−p0) + y(transit−mid)`.
- **Topology** (`ops.rs`, `topology.rs`):
  - `fillet` tries `flip_side=false`, then `true`, because the comment notes Boolean output arrives with both winding conventions. It tries `extend=true`, then `false`.
  - Adjacent faces are trimmed by the fillet boundary curves: `cut_face_by_bezier` uses a closest-point search against adjacent edges.
  - Side faces get new edges carrying an `IntersectionCurve(side_surface, fillet_surface, pcurve)`.
  - The fillet faces and the rebuilt shared face are created with `Face::new_unchecked` (`ops.rs:111,323,394,459,537,605,636`). Only the rebuilt side faces go through `Face::try_new` (`topology.rs:137,204`). DOCUMENTED (grep, 2026-09-24).
  - Each edge's arc cross-section is built through the **control points** of the two contact Béziers and a point on a straight 3D line between consecutive transit points (`expand_fillet`, `geometry.rs:300–350`). So interior cross-sections are exact circles only at the stations themselves. DOCUMENTED (code) / INFERRED (consequence).
  - DOCUMENTED: https://github.com/virtualritz/monstertruck/blob/master/monstertruck-fillet/src/ops.rs and https://github.com/virtualritz/monstertruck/blob/master/monstertruck-fillet/src/topology.rs
- **Multi-edge** (`fillet_along_wire`, `fillet_edges`):
  - A wire fillet needs **one face shared by every edge of the wire**, for example the top face of a box. `find_shared_face_with_front_edge` otherwise returns `SharedFaceNotFound`. Each edge's second support is its own neighbouring face. DOCUMENTED: `ops.rs:169–190`, `topology.rs:228–246`.
  - Adjacent patches are made **C0 by averaging their shared boundary control rows**, including wrap-around for closed wires. The code is `(p + q) / 2.0` on homogeneous `Vector4` control points, in the "Interior seam averaging" and "Wrap-around seam averaging" blocks of `ops.rs` (about l.246–270). DOCUMENTED.
  - **Wire corners are averaged, not mitred.** Worked example, INFERRED from the code by hand calculation:
    - Take a box corner at the origin with material in x, y, z ≤ 0, and fillet the two top edges with radius r. Edge i runs along x (side face y = 0), edge i+1 along y (side face x = 0), and the shared face is the top z = 0.
    - At the corner station, edge i's ball touches the top at (0, −r, 0) and the side at (0, 0, −r). Edge i+1's ball touches the top at (−r, 0, 0) and the side at (0, 0, −r).
    - After averaging, the corner cross-section runs from (0, 0, −r) to **(−r/2, −r/2, 0)**.
    - The exact result (the two cylinders meeting in the diagonal plane x = y) has its top trim point at **(−r, −r, 0)**.
    - So the fillet boundary on the top face misses the true corner point by r/√2 ≈ 0.71 r, and the cross-section at the seam is not a circular arc.
    - No test catches this. `fillet_closed_wire_box_top` and `fillet_edges_cuboid_top_4` assert only face counts (`tests/edges.rs:226,553`), and the only geometric accuracy test is single-edge (`tests/accuracy.rs`). DOCUMENTED (tests).
    - Lesson for wonky: a corner where two fillets meet needs an explicit miter (for plane/plane, the two cylinders cut by their bisector plane) or a vertex blend. Averaging seam control points is not a substitute. Wonky's fillet tests must sample geometry near corners, not only count faces.
  - `fillet_edges` validates:
    - manifoldness: exactly 2 faces per edge
    - the per-edge radius count
    - edge length ≥ 2r (`DegenerateEdge`)
  - It then groups the selection into chains of contiguous runs and processes them longest-first. Before each chain it clones the shell as a checkpoint.
  - After earlier chains mutate the shell, it re-finds edges by sampling the original curve at 1e-6.
  - DOCUMENTED: https://github.com/virtualritz/monstertruck/blob/master/monstertruck-fillet/src/edge_select.rs

### B. The exact procedural rolling-ball surface

Source: `decorators/rolling_ball_fillet/{mod.rs, contact_circle.rs, algo.rs}`, https://github.com/virtualritz/monstertruck/tree/master/monstertruck-geometry/src/decorators/rolling_ball_fillet. All items below are DOCUMENTED from that directory.

- **Definition.** `RollingBallFilletSurface{edge_curve, surface0, surface1, radius: RadiusFunction}`.
  - For each v (edge parameter), the ball center lies in the plane through `edge_curve(v)` normal to `edge_curve'(v)`.
  - The same 3×3 system is used, with row 0 = `c'` (the edge tangent) instead of `n0×n1`, and the same Newton projection.
  - The result is a `ContactCircle{center, axis, angle, contact_point0/1}`.
  - u is the fraction of the arc angle. The circle's NURBS form is a rational quadratic Bezier with middle weight `cos(angle/2)`.
- **Derivatives.**
  - v-derivatives of any order come from differentiating the linear system with **Leibniz/binomial expansion**: `[c'; n0; n1]·center⁽ⁿ⁾ = b⁽ⁿ⁾ − Σ binom(n,k)·rows⁽ᵏ⁾·center⁽ⁿ⁻ᵏ⁾`.
  - Contact uv derivatives come from the implicit-function theorem on the projection conditions (`SurfaceInfo.routine`).
  - Axis and angle derivatives come from `rot_der_n`.
  - Tests check u, v, uu, uv and vv derivatives against finite differences, and check a **sphere-sphere fillet against its closed form** (`tests/rbf_surface.rs`). DOCUMENTED: https://github.com/virtualritz/monstertruck/blob/master/monstertruck-geometry/tests/rbf_surface.rs
- **Tessellation.** `parameter_division_u` uses `n = angle / (2·acos(1 − tol/r))`, the classic chord-height bound for a circle.
- **Adaptive approximation** (`approximate_rolling_ball_fillet(rbf, (v0,v1), tol)`):
  1. Start with contact circles at v0, the midpoint and v1.
  2. Interpolate cubic B-splines for the side pcurves (in uv) and for the tangent handles, expressed in a local frame `(c'×n, c', n)`, plus the middle weight.
  3. Evaluate each span midpoint at u ∈ {0, 0.5, 1} against the exact surface.
  4. Insert circles where the error exceeds tol, and repeat for at most 16 iterations. If still not within tol, return `None`.
  - The cross-section is a degree-elevated rational cubic arc.
  - DOCUMENTED: https://github.com/virtualritz/monstertruck/blob/master/monstertruck-geometry/src/decorators/approximate_fillet_surface/mod.rs
- **Also present:**
  - `EdgeBlendSurface`: two pcurves plus tangent-magnitude functions, with a cubic Bezier cross-section. This is a general G1 blend.
  - `OffsetCurve` / `OffsetSurface` / `NormalOffsetField`.
  - Tests for double projection onto intersection curves.
  - DOCUMENTED: https://github.com/virtualritz/monstertruck/tree/master/monstertruck-geometry/src/decorators

## Robustness and guarantees

- **Accuracy of crate A is not bounded.**
  - The only accuracy test is `radius_error_bounds`: unit box, r = 0.3, and it asserts contact points lie within **tol = 0.01, i.e. about 3% of r** (`src/tests/accuracy.rs:9–40`).
  - Accuracy is governed by `divisions` (default 5). Nothing adapts divisions to a requested tolerance.
  - The uv-straight-line assumption between stations is exact only when the contact traces really are straight in parameter space. That holds for plane/plane and plane/cylinder-parallel cases, not in general.
  - DOCUMENTED (test) plus INFERRED (assumption analysis): https://github.com/virtualritz/monstertruck/blob/master/monstertruck-fillet/src/tests/accuracy.rs
- **Silent partial success.** This is the most important finding for wonky. `fillet_edges`:
  - swallows `GeometryFailed` with `continue` (`edge_select.rs:575`)
  - falls back per edge when a wire fails
  - on chain failure restores the checkpoint (`*shell = shell_checkpoint; continue;`, lines 700–701)
  - otherwise reports only through `MT_FILLET_DEBUG` stderr logging
  - uses `MT_FILLET_STRICT_CLOSED`, an env var, to roll back non-closed results

  So the caller can get back a shell in which some requested fillets are simply missing. DOCUMENTED: https://github.com/virtualritz/monstertruck/blob/master/monstertruck-fillet/src/edge_select.rs
- **Inconsistent approximation policy.** Curves must be exact, but surfaces silently degrade to a 64×64 bilinear grid (`convert.rs`). This contradicts wonky's "approximations need explicit tolerances" rule. DOCUMENTED: https://github.com/virtualritz/monstertruck/blob/master/monstertruck-fillet/src/convert.rs
- **Continuity.** C0 comes from seam averaging. The `continuity_at_wire_joins` test only checks approximately G1 at joins. There is no G1 construction across patches. DOCUMENTED: https://github.com/virtualritz/monstertruck/tree/master/monstertruck-fillet/src/tests
- **Existence assumptions.** Path B contains `unwrap()`s annotated SAFETY that assume a contact circle always exists. When the ball does not fit (radius larger than local concavity, or faces too far apart), this panics instead of returning an error. DOCUMENTED: https://github.com/virtualritz/monstertruck/tree/master/monstertruck-geometry/src/decorators/rolling_ball_fillet
- **No vertex blends.**
  - There is no setback/corner-patch logic where three or more filleted edges meet, beyond updating side faces.
  - The tested multi-edge cases are the semi-cube, closed box top, cuboid top-4 and top-and-bottom. All multi-edge fixtures are planar boxes.
  - The only curved-face fillet test is `fillet_to_nurbs` in `src/tests/surface.rs`: a plane face plus a quarter-cylinder face (an open two-face shell), r = 0.3. It asserts nothing about the geometry. It only checks that `fillet(...)` returns `Ok`, triangulates the result and dumps STEP (`dump_shell_step("fillet-cylinder", …)`).
  - DOCUMENTED (tests) / INFERRED (absence): https://github.com/virtualritz/monstertruck/blob/master/monstertruck-fillet/src/tests/edges.rs, https://github.com/virtualritz/monstertruck/blob/master/monstertruck-fillet/src/tests/surface.rs

## Parallelism and performance

- **No parallelism in the crate.** The code is sequential, with mutation-by-replacement of the shell and clone-checkpoints per chain. DOCUMENTED (code): https://github.com/virtualritz/monstertruck/blob/master/monstertruck-fillet/src/edge_select.rs
- **The per-station contact solve is naturally uniform work.** INFERRED:
  - It is a fixed 3×3 solve plus 2×2 Gauss-Newton per iteration, with a bounded iteration count, and each station is independent given a seed.
  - This maps well to Bend fork-join or GPU lanes, as long as seeding is done by a shared predictor (for example from the previous station, or from the analytic solution when both faces are quadrics).
- **Adaptive refinement in B is a sequential insert-and-refit loop.** INFERRED: it could be restructured as "evaluate every candidate midpoint in parallel, then insert all failing ones".

## Known failures, limitations, war stories

- The crate README and CHANGELOG present it as the extraction of an earlier truck prototype ("Prototyping for fillet surface with NURBS geometry", "Approximation of RbfSurface by ApproxFilletSurface"). `TRUCK-PARITY.md` explicitly tells maintainers not to resurrect the old fillet architecture. DOCUMENTED: https://github.com/virtualritz/monstertruck/blob/master/CHANGELOG.md, https://github.com/virtualritz/monstertruck/blob/master/TRUCK-PARITY.md
- The `flip_side` try-both-orientations hack exists because post-Boolean shells have inconsistent face orientation. A kernel with guaranteed orientation should not need it. DOCUMENTED (code comment in `ops.rs`) / INFERRED (lesson).
- **The flagship fillet example cannot get through its Boolean.**
  - Issue #24, "`filleted-spheres-cube` fails on first cube–sphere boolean (`EmptyOutputShell`)", 2026-08-27: the example dies on the first `difference` with "invalid output shell for `and`: no boundary shells". The reporter suspects that marching SSI cannot close a result against a revolved sphere (poles/seams).
  - The maintainer closed it as won't-fix: "the `truck` CSG code isn't great/useful for production IMHO. `monstetruck` will probably gain a CSG kernel eventually … side project so no ETA."
  - So "post-CSG, kernel-independent" fillets currently have no reliable CSG in front of them in their own repo. DOCUMENTED: https://github.com/virtualritz/monstertruck/issues/24
  - Lesson for wonky (INFERRED): the fillet stage is only as good as the Boolean output it receives. Wonky's plan of hybrid Boolean first, fillet second is the right order, but fillet tests must also run on real Boolean outputs, not just hand-built boxes.
- `DegenerateEdge` rejects edges shorter than 2r. This is conservative, and wrong for chains where the ball rolls past a short edge. DOCUMENTED: https://github.com/virtualritz/monstertruck/blob/master/monstertruck-fillet/src/error.rs
- Closed wires with variable radius must satisfy f(0)≈f(1), otherwise `VariableRadiusUnsupported`. This is a clean explicit failure. DOCUMENTED: `error.rs`.

## Relevance for wonky

- **Scope match.** INFERRED.
  - Wonky's FDM parts mostly need constant-radius fillets and chamfers between planes, cylinders and cones.
  - For those pairs the fillet surface is **exactly** a cylinder (plane/plane), a torus (plane/cylinder with perpendicular axis, or coaxial cylinder/cone), or occasionally a more general surface.
  - Monstertruck's NURBS-approximation path is therefore the wrong default for wonky. It should emit exact analytic cylinder/torus pieces, as OCCT ChFiKPart does, and only fall back to an approximation for general pairs.
- **Worth adopting as algorithms:**
  1. The 3×3 center solve plus Gauss-Newton contact projection, as the generic "contact circle" kernel. It is small, branch-light and uniform.
  2. The Leibniz derivative recursion, which gives exact v-derivatives of the spine and contact curves for free.
  3. The adaptive "midpoint at u ∈ {0, ½, 1} vs tol, insert, refit" scheme with a hard iteration cap and an explicit `None`. This is exactly the explicit-tolerance, explicit-failure pattern wonky wants.
  4. The profile abstraction: Round / Chamfer / Ridge / Custom as a 2D profile in the (p0, p1, transit) frame. It is a nice unified FeatureScript mapping for `fillet` and `chamfer` cross-sections.
- **Anti-patterns to avoid:**
  - silently skipping failed edges
  - env-var strictness
  - silent bilinear surface sampling
  - `unwrap` on contact existence
  - try-both-orientations
  - `new_unchecked` faces without a validity pass
  - C0 seam averaging of control points in place of a real miter or vertex blend at wire corners (worked example above)
  - multi-edge tests that assert face counts but not geometry
- **Bend fit.** INFERRED.
  - Everything is f64 in the source.
  - The Newton iterations tolerate F32x2 well, because they are self-correcting.
  - The existence and side decisions need exact predicates: the sign of `(n0×n1)·t` and whether the ball fits. When the sign is near zero, wonky should escalate to the multi-limb path or fail explicitly.

## Pointers worth porting or studying

- `monstertruck-fillet/src/geometry.rs`: `contact_point`, `next_point`, `generate`, `composite_line_bezier` (the degree `udeg+vdeg` trick for lines in parameter space), `expand_custom`.
- `monstertruck-geometry/src/decorators/rolling_ball_fillet/algo.rs`: `der_routine` (Leibniz derivatives) and `parameter_division_u` (chord-height division).
- `monstertruck-geometry/src/decorators/approximate_fillet_surface/mod.rs`: the adaptive fit and the local-frame tangent handles.
- `monstertruck-geometry/tests/rbf_surface.rs`: the sphere-sphere closed-form oracle. It is a good test pattern for wonky's own fillet surfaces (compare against torus/cylinder closed forms).
- `monstertruck-fillet/src/edge_select.rs`: chain grouping and longest-first ordering, and re-matching edges after mutation. Useful ideas, but replace the error policy.

## Verdict: adapt

- **Adapt** the contact-circle solver, the derivative recursion, the adaptive tolerance-driven approximation and the profile abstraction. All are Apache-2.0 and small.
- **Do not adopt** the crate's operation layer, for five reasons:
  1. it approximates even when exact quadric fillets exist
  2. its accuracy is not tolerance-driven (about 3% of r in its own test)
  3. it swallows failures
  4. it has no vertex blends and no non-planar fixtures
  5. it joins wire corners by averaging seam control points, which misplaces the corner trim point by about 0.71 r on a plain box top
