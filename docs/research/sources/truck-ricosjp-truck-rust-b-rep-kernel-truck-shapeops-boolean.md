# Truck (ricosjp/truck): Rust B-rep kernel, truck-shapeops Boolean

- Kind: open-source code. Canonical: https://github.com/ricosjp/truck. Read at HEAD `8d03d8f7900d6aaff784d02092bf5126c1425749` (2026-09-07), which is the same commit wonky's port pins in `docs/port-truck.md`. Shallow clone in `tmp/research/truck-ricosjp-truck-rust-b-rep-kernel-truck-shapeops-boolean/`. Other URLs:
  - Boolean core: https://github.com/ricosjp/truck/tree/8d03d8f7900d6aaff784d02092bf5126c1425749/truck-shapeops/src/transversal
  - `IntersectionCurve`: https://github.com/ricosjp/truck/blob/8d03d8f7900d6aaff784d02092bf5126c1425749/truck-geometry/src/decorators/intersection_curve.rs
  - Mesh interference: https://github.com/ricosjp/truck/blob/8d03d8f7900d6aaff784d02092bf5126c1425749/truck-meshalgo/src/analyzers/collision.rs
  - Issues read: #114, #57, #68, #110 (PR), #129 (PR), #121, #65, #74.
- Authors/org, year: RICOS Co. Ltd., Japan. The main author and maintainer is Yoshinori Tanimura (`ytanimura`). Started 2020-12. Development happens on RICOS GitLab and is mirrored to GitHub; the last commit is "Merge ... cargo-upgrade-20260907, merge request ricos/truck/truck!818". DOCUMENTED (`gh api repos/ricosjp/truck`, commits API).
- License and porting implications:
  - **Apache-2.0.** DOCUMENTED.
  - Porting into wonky is permitted. Keep attribution, and add a NOTICE/modification statement if wonky is ever distributed. wonky already does this in `docs/port-truck.md` and `out/boolean-ports/truck/upstream.json`.
  - The code is Rust f64 with generic traits, so a port is a re-implementation in Bend, not a link. That satisfies wonky's no-FFI rule.
  - INFERRED.
- Status:
  - Re-checked 2026-09-24 (`gh api repos/ricosjp/truck`):
    - 1,567 stars, 113 forks, 36 open issues/PRs, 17 contributors (including anonymous).
    - The last push is still 2026-09-07 (`cargo upgrade` merge). Recent commits are dependency bumps, not Boolean work.
    - No GitHub releases, only `truck-topology-v0.x` tags. Crates are published per crate on crates.io, with `truck-shapeops` at 0.4.0.
    - The newest issues (#130, #131, 2026-09) are spam.
  - Active but slow-moving on Booleans. Community PRs #110 and #111, which fix coplanar and STEP-type Booleans, have been open without maintainer review since 2026-01/02.
  - The maintainer's policy issue #121 (2026-04) says truck is "middleware" that avoids "implicit corrections".
  - Downstream forks carry fixes: `virtualritz/monstertruck`, with `Result`-returning Booleans and fillets, and `ovo-Tim/truck` on the fix-OR3 branch.

  DOCUMENTED (https://github.com/ricosjp/truck/issues/121, https://github.com/ricosjp/truck/pull/110).

## What it is

A pure-Rust B-rep kernel with a clean separation of crates: `truck-base`, `truck-geotrait`, `truck-geometry` (NURBS plus analytic decorators), `truck-topology` (Vertex/Edge/Wire/Face/Shell/Solid over generic P, C, S), `truck-meshalgo`, `truck-modeling`, `truck-stepio` and `truck-shapeops`.

`truck-shapeops` provides `and`/`or` on solids, plus shape healing and a single-edge fillet. Its crate doc states the scope: "Boolean operations are currently supported only for shapes where faces intersect transversally. Cases where faces are tangent to each other are not yet supported. Furthermore, performance optimization using BSP ... remains a future task." DOCUMENTED (`truck-shapeops/src/lib.rs` L3-L9).

## How it works

`integrate::process_one_pair_of_shells(shell0, shell1, tol)` (`transversal/integrate/mod.rs`) runs the following pipeline. DOCUMENTED (code).

1. **Tessellate both shells** at chord tolerance `tol` (`shell.triangulation(tol)`, rayon-parallel per edge and face in `truck-meshalgo/src/tessellation/triangulation.rs`). Every edge curve is wrapped as `Alternative::FirstType`; intersection curves become `SecondType(IntersectionCurve<PolylineCurve,S,S>)`.
2. **For every face pair (i, j)**, sequentially over all F0 x F1 pairs in `loops_store::create_loops_stores`:
   - **Mesh interference.** `polygon0.extract_interference(polygon1)` finds candidate triangle pairs by one-axis sweep-and-prune along a hashed pseudo-random unit direction (`hash::take_one_unit(first vertex)`), with an AABB reject. `collide_triangles` returns a segment built from up to 6 edge/triangle crossings, using a `TOLERANCE2` slack in the inside test. The result is a soup of 3D segments.
   - **Polyline construction** (`polyline_construction`). Segment endpoints are quantised to a grid of pitch 2·TOLERANCE (`PointIndex = (p + TOL) / (2·TOL)` cast to i64), and the adjacency graph is walked into open or closed polylines.
   - **Lift to the exact surfaces.** `IntersectionCurveWithParameters::try_new` calls `IntersectionCurve::search_triple(i, 100)` at every polyline vertex. That is `double_projection`: a **4x4 Newton** in (u0,v0,u1,v1) with residual [S0(u0,v0) − S1(u1,v1); n·((S0+S1)/2 − L(t))], where L is the leader curve and **n = L'(t), the leader tangent**. The point is thus constrained to the plane through L(t) orthogonal to the leader, the same construction Parasolid XT V35 documents for its INTERSECTION chart evaluation (see `parasolid-xt-format-reference-v35-intersection-curve-chart-t.md`). The output point is the midpoint S0/S1, with a uv pair per surface.
   - **Side label.** `ShapesOpStatus::from_is_curve` evaluates the curve midpoint and labels its left side `Or` if (n0 × c') · n1 > 0 and `And` otherwise. The flip depends on the face orientations.
   - **Insert into the loop stores.** A closed polyline becomes an "independent loop", pushed twice with opposite orientation. For an open one, each endpoint is located on the face boundary by `search_parameter`:
     - Front/Back: reuse the existing vertex, snapping its point.
     - Inner(t): split the edge. `curve_surface_projection` iterates curve/surface nearest-point with a tangent-line/normal step (≤ 100 trials) to put the new vertex on both the edge curve and the other surface.
     - Then `Loops::add_edge` splices the new edge into wires, splitting one wire into two (with opposite status) or merging two.

     This runs on a polyline store and a geometry store in lock-step.
3. **Divide faces** (`divide_face::divide_one_face`). Each loop is sampled into the face's (u,v) domain via `search_parameter` on edge tessellations. Positive-area loops become outer boundaries; each negative loop is attached to the first outer loop whose polygon contains its first point. Each new face takes the status of any non-Unknown wire.
4. **Classify.** `FacesClassification::integrate_by_component` propagates And/Or to connected components of Unknown faces by testing whether the **first edge of the component's first boundary** appears on an And or Or boundary. Faces still Unknown are classified by a **ray-crossing count against the other operand's tessellation** (`signed_crossing_faces`, ray from the first boundary vertex in a hashed direction; count ≥ 1 ⇒ inside).
5. **Assemble.** And-faces of both operands form the AND shell and Or-faces form the OR shell. `altshell_to_shell` converts every polyline-led `IntersectionCurve` to `IntersectionCurve<BSplineCurve,S,S>` via `BSplineCurve::quadratic_approximation(ic, range, tol, 100)`. That routine interpolates at uniform parameters, then accepts once **one hashed interior sample per span** is within tol (`truck-geometry/src/nurbs/bspcurve.rs` L381-411). `and`/`or` iterate over additional shells and split `connected_components` into solid boundaries. NOT is orientation inversion (`solid.not()`).

The exact evaluator `IntersectionCurve::subs(t)` is `search_triple(t,100).unwrap().0`. Derivatives (`der`, `ders`) solve 3x3 systems [n0; n1; L'] with `mat.invert().unwrap()`, i.e. the Parasolid-style chord plane again, differentiated. DOCUMENTED (`intersection_curve.rs` L155-L260).

Leader details, checked 2026-09-23 (DOCUMENTED, `truck-polymesh/src/polyline_curve.rs` L218-245, `intersection_curve.rs` L83-93):
- `PolylineCurve::subs(t)` uses t = vertex index + fraction, and `der(t)` = P_{n+1} − P_n, the unnormalised chord.
- `der` is **zero outside [0, len−1]**, where the Newton constraint row vanishes.
- `search_triple` passes `None` as the uv hints, so every evaluation starts with `search_nearest_parameter` on both surfaces before the 4x4 Newton.

So the polyline-led curve is XT's chord-plane evaluator with an index parameterisation (not C1, not arc length) and no uv cache. A wonky port should add the XT f_i parameterisation and cache (u,v) per chart point. INFERRED.

## Robustness and guarantees

- **Global absolute tolerance** `TOLERANCE = 1e-6` (`truck-base/src/tolerance.rs`), used by `near`, `so_small`, vertex snapping and PointIndex quantisation. The user `tol` controls only the tessellation chord and the B-spline fit. There are no per-entity tolerances. DOCUMENTED.
- **No guarantees stated.**
  - The return type is `Option<Solid>`: every failure is `None`.
  - Several paths panic instead: `subs()`/`der()` `unwrap` a Newton failure, and the derivative matrix `invert().unwrap()` panics when n0, n1 and L' are linearly dependent, i.e. at tangency.
  - Issue #114 reports panics on shared faces, edges and vertices.

  DOCUMENTED (code and https://github.com/ricosjp/truck/issues/114).
- Structural robustness gaps, INFERRED from the code:
  - **The mesh is the only detector.** A curve branch whose triangles do not cross is lost silently: small loops below the chord tolerance, tangential contact, or coincident faces. There is no conservative inflation of the kind Yang et al. 2025 use (see `yang-jia-wang-yang-xin-yan-2025-boolean-operation-for-cad-mo.md`).
  - **Grid-quantised welding.** Two segment endpoints within 1e-6 but on different sides of a 2e-6 cell boundary are not joined, which leaves an open polyline or a mis-split. Wonky's port replaced this with exact topological vertex IDs (`docs/port-truck.md`).
  - **No lower-dimensional imprint.** There is no vertex/edge coincidence pre-pass (compare Jackson 1995, V-V → E-E → F-F), so coplanar and touching configurations reach the face/face SSI and fail there.
  - **Ray classification** from a single boundary vertex with a hashed direction has no handling for rays grazing mesh edges or vertices. It is also a mesh test, so it is wrong within the chord tolerance of the other surface.
  - **Status from the midpoint normal triple.** For near-tangent curves (n0 ∥ n1), the sign of (n0 × c')·n1 is noise.
  - **Unverified B-spline fit.** The quadratic approximation tests one pseudo-random point per span, which is not an error bound.

## Parallelism and performance

- Tessellation is rayon-parallel. The face-pair loop, loop-store splicing and classification are sequential, with no BVH or BSP across faces: all F0 x F1 pairs are tried. Each pair's sweep-and-prune is O(n log n) in triangles. DOCUMENTED (code, lib.rs comment on BSP).
- Issue #68, "Boolean Operations take a long time":
  - Cube x cylinder took ~10 s in a debug build and ~1.3 s in release.
  - Profiling showed about half of `presearch` time spent allocating B-spline basis vectors in `KnotVec::try_bspline_basis_functions`.
  - Switching `KnotVec` to a `SmallVec<[f64;16]>` gave a large speedup in a fork.

  DOCUMENTED (https://github.com/ricosjp/truck/issues/68, comments by twitchyliquid64 and LtdJorge 2024-10/11).
- Each Newton point (`double_projection`, 4x4, ≤ 100 iterations) is independent of the others, so the per-vertex lift is embarrassingly parallel. Loop splicing is the sequential bottleneck. INFERRED.

## Known failures, limitations, war stories

- **#57 (open since 2024-02):** `or` of two cubes touching on a face (z_offset = 1.0) returns `None`. It works at 0.9 (overlap) and 1.1 (disjoint).
  - tsukimizake and ovo-Tim traced it to `intersection_curves` only detecting transversal SSI, and to a wrong face being sent to `divide_one_face`. Manual coplanar edge injection then failed with "wire is not simple".
  - PR #110 is an LLM-authored fix, per its author: "The PR was done by Gemini+Claude". When Newton fails and the points coincide with parallel normals, it accepts the initial guess. It also treats polyline boundaries as closed sets (`unwrap_or(true)`), drops tiny-area loops, and removes faces whose loops cancel. It is still unreviewed.

  DOCUMENTED (https://github.com/ricosjp/truck/issues/57, https://github.com/ricosjp/truck/pull/110).
- **#114 (open, 2026-03):** a shared partial face (box minus box with a common top face) returns `None`, and so does a union with a shared vertex or edge. A downstream user reports a production workaround: "catch_unwind + De Morgan fallback + perturbation retry" (comment on #110). DOCUMENTED. The perturbation retry is exactly the silent geometry change wonky forbids. INFERRED.
- **#129 (open PR, 2026-08):** STEP export of `IntersectionCurve` wrote `surface1` at `surface0`'s index, so entities were defined twice and `INTERSECTION_CURVE` referenced a `CARTESIAN_POINT`. "A plate with one bore comes out with 30 of its 488 entities defined twice." This matters for wonky's STEP writer tests: INTERSECTION_CURVE export is a real bug surface, and no bundled Truck test shape contains one. DOCUMENTED (https://github.com/ricosjp/truck/pull/129).
- #74 `NotSimpleWire` on STEP import; #123 and #128 STEP-placement panics ("tolerance must be no less than 1e-6"). These are symptoms of the single global tolerance meeting real data. DOCUMENTED (issue titles/bodies) and INFERRED (diagnosis).
- **Test coverage is minimal** (DOCUMENTED, code at `8d03d8f`, re-checked 2026-09-24).
  - The only Boolean unit test is `truck-shapeops/src/transversal/integrate/tests.rs::punched_cube`: a unit cube `and` a negated cylinder (radius 0.25, axis z through (0.5, 0.5)) at `tol = 0.05`.
  - It `unwrap`s the result and writes `punched-cube.obj`. There is **no assertion** on volume, face count, closedness or orientation.
  - `truck-shapeops/tests/` contains only `fillet.rs`.
  - So none of the coincident, tangent or touching configurations is regression-tested upstream. wonky's acceptance corpus must supply them itself.
- #65 asks for Cherchi et al.'s mesh Booleans, the same backend family Yang 2025 builds on. DOCUMENTED.
- #121 policy: no implicit fixes, and users compose operations explicitly. This matches wonky's "fail explicitly" rule, but in Truck the failure is an opaque `None` or a panic, not a typed reason. DOCUMENTED (policy) and INFERRED (contrast).

## Relevance for wonky

- wonky already ports Truck's **dataflow skeleton** (`kernel/ports/truck.bend`, `truck-topology.bend`, `truck-cylinder.bend`):
  - split edges → loop store → divide faces → classify → integrate
  - analytic plane/line and plane/cylinder curves replace mesh seeds and Newton
  - exact vertex IDs replace PointIndex welding
  - typed rejections (`AmbiguousContact`, `UnsupportedArrangement`) replace `None`/panic

  DOCUMENTED (`docs/port-truck.md`). This reading confirms that the port kept the right parts and dropped the fragile ones.
- The g10 blocker (plane/cylinder union with contact) is **exactly Truck's unsolved class** (#57/#114): Truck has no answer to port for it. Borrowing from Truck will not unblock wonky. The answer has to come from three pieces:
  - a lower-dimensional imprint pre-pass (Jackson 1995)
  - an explicit coplanar/2D-trim branch: Yang 2025 sec. 4.5.5, a 2D Boolean before meshing with one shared face for the overlap; and the Yang/Jia SIGA 2025 ε-overlap definition
  - tangent-contact relations decided from the analytic surface parameters before any mesh test, as in Miller-Goldman's "detect the tangent ruling up front" rule (`miller-goldman-1995-geometric-algorithms-for-detecting-and-c.md`)

  INFERRED.
- Truck's mesh-only detection vs. Yang 2025: Truck has neither the dε-inflated candidate test nor the normal-cone small-loop filter, and no seed for non-crossing triangle pairs. That is exactly the difference between "misses tangency/small loops" (Truck #57 and #114 class) and "0 failures on 400 hard operations" (Yang 2025 Table 5). INFERRED.
- What is still worth taking from Truck for the general curved Boolean:
  1. The `IntersectionCurve {surface0, surface1, leader}` representation: exact definition by two surfaces plus an approximate leader, evaluated by the chord-plane Newton. This is structurally the XT INTERSECTION curve and maps directly to STEP `INTERSECTION_CURVE` with two pcurves.
  2. The `double_projection` residual as the F32x2 point refiner. It is a fixed 4x4 system and GPU-uniform per point.
  3. The loop-store splice logic (`add_edge`: same-wire split with opposite status vs cross-wire merge) as a reference for wonky's immutable loop rebuild.

  INFERRED.
- Bend fit:
  - Per-point Newton, per-edge tessellation and per-pair triangle tests are uniform or fork-join.
  - Truck's in-place `Mutex` vertex mutation (`set_point`, `swap_edge_into_wire`) must become functional rebuilds, which the existing port already does.
  - Anything Truck decides by `near` (1e-6 absolute) must instead be a scaled F32x2 bound or an exact U32-bigint predicate.

  INFERRED.

## Pointers worth porting or studying

1. `double_projection` (intersection_curve.rs L4-L36): residual [S0−S1; n·(mid − L(t))] with n = L'(t), Jacobian columns [∂S0/∂u, ∂S0/∂v, −∂S1/∂u, −∂S1/∂v] extended by the n-projections / 2. A direct template for wonky's curve-point refiner, with explicit residual output and an iteration cap.
2. `IntersectionCurve::der`: k = (|L'|² − (c−L)·L'') / ((n0×n1)·L'), c' = k (n0×n1). The closed-form tangent of the exact curve, useful for tangent/pcurve derivative export and for a tangency detector (the denominator → 0).
3. `loops_store::Loops::add_edge` and `create_independent_loop`: the combinatorial wire-splice rules, as a reference for wonky's loop rebuild.
4. `from_is_curve` side labelling, (n0 × c')·n1, with its orientation truth table in `create_loops_stores`. Port it with a guard: reject as `AmbiguousContact` when |n0 × n1| is below a scaled bound.
5. Issues #57/#114/#110 as a **regression corpus**: touching cubes, shared partial faces, shared vertices. Wonky's g10 contact union is the curved analogue, and these planar cases should be in its acceptance tests.
6. PR #129 as a STEP-writer regression: an INTERSECTION_CURVE with differently sized surface entities.
7. For the fillet track (DOCUMENTED, code, not deep-read): `truck-geometry/src/decorators/rbf_surface/` (`mod.rs`, `algo.rs` 1,092 lines, `contact_circle.rs`) defines a **procedural rolling-ball fillet surface**.
   - `RbfSurface { edge_curve, surface0, surface1, radius: R }` takes a radius *function*, so the radius can vary along the edge.
   - `subs(u, v) = contact_circle(v).subs(u)`: per spine parameter, `algo.rs` solves for the ball centre and the two `ContactPoint { point, uv }`. `RbfContactCurve` exposes the two trim curves.
   - `ApproxFilletSurface` (`af_surface.rs`) and `truck-shapeops/src/fillet/mod.rs::simple_fillet` turn it into topology.

   This is the open-source analogue of Parasolid XT's BLENDED_EDGE + BLEND_BOUND (see `parasolid-xt-format-reference-v35-intersection-curve-chart-t.md`), Apache-2.0, and worth a dedicated read when wonky starts fillets.
8. Negative lessons:
   - Tolerance-grid welding (PointIndex).
   - Ray-parity classification against a tessellation.
   - One-sample B-spline fit acceptance.
   - `unwrap` in evaluators.

   Each has an explicit wonky counterpart already; keep it that way.

## Verdict: adapt

Truck is Apache-2.0, readable, and already the pinned reference for wonky's Boolean dataflow. Keep adapting its pipeline skeleton, `IntersectionCurve` representation and chord-plane Newton. Do not adopt its detection layer (mesh-only, global 1e-6 welding, ray parity) or expect it to solve wonky's contact/coplanar blocker: that is precisely its documented open failure class (#57, #114).
