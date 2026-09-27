# remus (esaueng/remus)

- Kind: B-rep kernel, a Rust workspace with a WASM/JS API. Canonical: https://github.com/esaueng/remus. Upstream it was forked from: https://github.com/andymai/brepkit (now AGPL-3.0). Benchmark consumer: https://github.com/andymai/brepjs (Apache-2.0). Shallow clone: `tmp/research/remus-esaueng-remus/` (head `1dc3763e`, 2026-09-22).
- Authors: Esau Engineering, maintained by "Peter" (`petergstfsn`, 959 commits). The inherited upstream history is by Andy Mai (`andymai`, 955 commits). The rest are bots (`brepkit[bot]` 430, `github-actions[bot]` 187, dependabot 60, ...). The upstream brepkit was created 2026-03-02; the remus repo 2026-08-15.
- License: Apache-2.0 (`LICENSE-APACHE`, `NOTICE`: "includes software developed by the brepkit contributors").
  - Porting ideas, or even code, into wonky is permissible with attribution and NOTICE carry-over.
  - Trap: only the remus line (upstream <= `v2.129.15`, `a878e2b9`) is Apache. andymai/brepkit v3 and later is AGPL-3.0, so do not read or copy from current brepkit (`docs/production-readiness/fork-maintenance.md`, `apache-replay-provenance.md`).
- Status (`gh api`, 2026-09-22, re-checked 2026-09-24): 2,615+ commits, 0 stars, 0 forks, no releases, "publishes nothing yet" (README); the committed WASM package is at v2.130.47 (PR #609, 2026-09-23). Pushed daily (last 2026-09-23); `open_issues_count` fell from 11 to 2 (issues and PRs share the counter; the open one of note is PR #603). About 510k lines of Rust including tests. The largest files are `io/step/reader.rs` (15.9k lines), `boolean/tests.rs` (9.5k), `pave_filler/phase_ff.rs` (9.3k) and `face_splitter/mod.rs` (9.2k).
- Provenance: DOCUMENTED LLM-built. `AI-DISCLOSURE-ETHICS.md`: "All of my contributions are done through coding agents, PR review is done through agents". `CLAUDE.md -> AGENTS.md` is a 40 KB agent manual, and `.claude/skills/` holds 21 skills (boolean-debugging, numerical-robustness, fillet-blend, ...). A real downstream consumer exists (OpenZCAD, per issue #483).

## What it is
An exact B-rep kernel (plane, cylinder, cone, sphere, torus, NURBS; line, circle, ellipse, parabola, hyperbola, NURBS edges). Its architecture is clearly shaped like OCCT's:
- General Fuse Boolean: `algo/pave_filler/phase_{vv,ve,ee,vf,ef,ff}.rs`, `builder/`, `builder_solid.rs`, `same_domain.rs`.
- ShapeFix-like healing: `heal/fix/*`, `upgrade/unify_same_domain.rs`.
- BRepOffset-like offset: `offset/{analyse,inter3d,inter2d,loops}.rs`.
- ChFi3d-like walking blends: `blend/{spine,stripe,walker,corner}.rs`.

The docs call OCCT "the incumbent open-source reference kernel" and impose a clean-room rule that bans reading oracle source while implementing (`docs/kernel-maturity/testing-strategy.md`, `target.md`). The product is less the geometry than a written maturity contract: operation contract, failure taxonomy, capability matrix, stability matrix and per-cell qualification (README "Kernel contract").

## How it works
Numeric model (DOCUMENTED, `crates/math/src/tolerance.rs`, `predicates.rs`, `filtered.rs`):
- f64 everywhere. `Tolerance{linear 1e-7, angular 1e-12, relative 1e-10}`, with loose/tight presets. `approx_eq`: `|a-b| <= max(linear, relative*max(|a|,|b|))`. `parametric(|dP|) = clamp(linear/|dP|, 1e-15, 0.1)`.
- Exact predicates come from the `robust` crate (Shewchuk `orient2d`/`orient3d`/`incircle`). Filtered versions use Shewchuk's static bounds `(3+16eps)eps*detsum` and `(7+56eps)eps*permanent`.
- The exactness does not survive into the algorithms. For example, the mesh fallback normalizes `orient3d(a0,a1,a2,b)/|n_a|` into a distance and compares it against `tolerance` (`operations/src/mesh_boolean.rs:345ff`). Edge keys are rounded onto a 1e-9 grid (`edge_key`, `S = 1e9`). INFERRED: topology decisions are tolerance bands, as in keel.
- There are many algorithm-local epsilons. `blend/analytic.rs` has `ANALYTIC_TOL_LIN = 1e-9` and `ANALYTIC_TOL_ANG = 1e-9`. The `exact_cylinder_cylinder` gates are `|a1.a2| > 1e-9`, and so on. The operation contract says these are being migrated to "named, scale-aware policy values ... classified as physical-space tolerance, parameter-space tolerance, angular tolerance, numerical floor, convergence threshold, topological resolution threshold, or resource budget" (`operation-contract.md` Context).

Operation contract (DOCUMENTED, `docs/kernel-maturity/operation-contract.md`):
- `OperationResult<T>{ value, quality: Exact | Approximate | Repaired, diagnostics, evolution, tolerance_report, fallback, stats }`. "A result may not claim Exact if any participating geometry was silently converted, refit, or tessellated."
- The fallback policy is chosen per operation: `ExactOnly`, `AllowApproximate{budget}` or `ApproximateOnly{budget}`. Fallback is "never silent regardless of policy".
- Eight universal postconditions:
  1. No panic, NaN or unbounded loop.
  2. Deterministic across runs and native/WASM.
  3. Validator passes.
  4. Typed failures.
  5. No silent degradation.
  6. Healing is reported.
  7. Evolution is complete or explicitly unresolved.
  8. Bounded, observable budgets.
- Transactional mutation: `remus_topology::transaction::{run_transacted, run_validated}` does begin, build, validate, then commit or roll back. Stale handles never alias new entities (no slot reuse).
- `OperationContext` (`math/src/context.rs`) holds the tolerance, `WorkBudgets{march_steps 200, queue_size 100, segments 50, branches_per_direction 10, newton_iterations 20, subdivision_depth 6}`, the `FallbackPolicy` (default `AllowApproximate{0.1}` mm) and a `CancellationToken`. `max_entity_tolerance` defaults to 1000*linear = 1e-4. Budgets are operation counts, not wall-clock time, "so behavior is consistent across native and WASM".

Failure taxonomy (DOCUMENTED, `failure-taxonomy.md`, `math/src/diagnostic.rs`):
- Nine categories: `invalid_input`, `invalid_topology`, `unsupported`, `nonconvergence`, `resource_limit`, `tolerance_violation`, `quality_refused`, `cancelled`, `internal`.
- Codes are lowercase snake case and additive-only. They are never derived from `Display`, `Debug` or Rust type names.
- An `unsupported` error must cite the capability-matrix cell. `nonconvergence` and `resource_limit` errors must report the budget and the amount consumed. Every failure leaves the pre-operation state. Reaching `internal` "is itself a defect to burn down".

Boolean pipeline (DOCUMENTED, `crates/operations/src/boolean/mod.rs::boolean_with_context_impl`, lines 786-1684):
1. `ApproximateOnly` goes straight to the mesh.
2. Each operand gets an analytic classifier (`algo/classifier/analytic.rs`, 7 variants: Box, Cylinder, Cone, Sphere, Torus, ...). A ladder of closed-form shortcuts follows:
   - identical solids; containment (A in B, B in A, strict-inside cut becomes a hollow result with a reversed tool shell);
   - coaxial cylinder, cone, torus and concentric sphere merges;
   - axis-aligned box pair by AABB algebra; box-sphere intersect (sphere inside, or a 3-plane octant);
   - separated curvature-aware AABBs give an empty intersect; provably disjoint operands take a fuse shell-merge or a cut copy.
3. Planar NURBS faces are flattened to analytic planes. The recursion is bounded by re-checking the gate predicate, because an unverified fixpoint could recurse without bound on imported geometry.
4. GFA runs (pave filler, builder, `BuilderSolid`).
5. Post-heal: `remove_degenerate_edges`, `remove_wire_spurs`, `unify_coincident_boundary_edges` (only if free edges exist), a vertex merge when Euler > 2, and up to 3 `unify_faces` passes when Euler or manifoldness is off.
6. Acceptance gates:
   - hole-aware Euler, `V-E+F-L = 2-2g` plus 2 per cavity shell;
   - closed manifold;
   - no open shell, but for Intersect only ("Cut and Fuse keep the legacy lenient gate");
   - `operands_are_represented`, `result_within_operand_bounds`, `validate_boolean_result_with_tolerance`.
   - A multi-region acceptance additionally needs disjoint component AABBs plus centre-point probes: a Cut component centre must lie outside B; an Intersect component must lie inside both operands.
7. On rejection, the cut is distributed over disjoint components of A, or a fuse with a 2..64-component tool is folded piece by piece. Otherwise `ExactOnly` returns `ExactOnlyUnattainable`, and `AllowApproximate{budget}` runs `run_mesh_fallback` at deflection = budget.
8. Mesh fallback (`mesh_boolean.rs`):
   - co-refinement with f64 tri-tri intersection, grazing imprint and a coplanar path;
   - CDT re-triangulation so that seams conform on both sides;
   - classification: closest-surface normal within tolerance with `cos > 0.9` gives OnSame/OnOpp, otherwise GWN at the centroid with `|wn| > 0.5` means inside;
   - limits of 100k input triangles, 200k candidate pairs and 25M classification tests, after which `resource_limit`;
   - output gate: `enforce_manifold_shell` plus `is_closed_manifold`, otherwise `NonManifoldResult`.
- `BooleanQuality::{Exact, Approximate{deflection}}` is returned by `boolean_with_context` and `Model::boolean`. Plain handle-returning entry points are pinned to `ExactOnly` (`boolean-contract-audit-2026-09-21.md`).

SSI (DOCUMENTED, `math/src/analytic_intersection.rs`, `intersect.rs`):
- `ExactIntersectionCurve{Circle, Ellipse, Line, Points}`. Plane x {cylinder, cone, sphere} are closed form. Plane x torus is sampled (quartic roots plus Newton).
- Perpendicular, equal-radius cylinders with intersecting axes give two ellipses: centre at the axis crossing, semi-major `r*sqrt2`, semi-minor `r`, plane normals `(a2-a1)/sqrt2` and `(a1+a2)/sqrt2`.
- General non-parallel cylinders: for each `u` on cylinder 1, solve `v^2(1-alpha^2) + 2v(q.a1 - alpha q.a2) + (|q|^2 - (q.a2)^2 - r2^2) = 0` with `alpha = a1.a2`. This is the same construction as keel's `quadratic_branch_field`, and both look like the standard LLM recipe.
- Otherwise marching, bounded by `WorkBudgets`.
- Qualified result model (`intersect.rs`): every element carries `ContactKind{Transversal, Tangential, Coincident, Unclassified}`, `ResultQuality{Exact, Approximate{max_error}, Unresolved}` and a source method. "The bound is the method's declared budget, not a certificate". Legacy results are wrapped honestly as `Unclassified + Approximate`.

Fillet (DOCUMENTED, `operations/src/blend_ops.rs:1095-1240`, `blend/src/lib.rs`, `blend/src/analytic.rs`):
- `fillet_cascade` tries engines in order:
  1. `fillet_v2` (walking engine; for planar-line selections it tries the rolling-ball rebuild first), then the rolling-ball rebuild alone;
  2. if one engine fails on the whole selection, the selection is split into `independent_blend_groups` with an engine per group.
  Every attempt runs in `transactional(...)` plus `reject_open_shell`. "The flat bevel is not a fillet and is no longer a fallback for one." The engine used is disclosed in `BlendResult::engine`.
- Typed refusals: `CliffEncountered{edge, face, requested_radius, available_radius}` (stop-at-cliff, never a silent radius reduction), `RadiusTooLarge{edge, max_radius}`, `UnsupportedVertexBlend{vertex, stripes}`, `SetbackMismatch{edge, vertex, declared, required}`, `TwistedSurface`, `WalkingFailure{edge, t, residual}`, `TrimmingFailure{face}`, ...
- Each maps to a stable string code in `blend_failure_code` ("cliff-encountered", "radius-too-large", ...). "Codes are API: never rename one, only add."
- Analytic fast paths (`analytic.rs`): plane-plane (cylinder), plane-cylinder (torus, perpendicular only), plane-cone, plane-sphere, sphere-sphere, sphere-cylinder, sphere-cone, cylinder-cylinder, coaxial cone-cone, with matching chamfers. Everything else goes to the Newton-Raphson walker (4x4 system per section, adaptive step, NURBS fit of sections, `walker.rs`).
- Plane-cylinder convexity table (`analytic.rs:798-814`): `convex = plane_bounded == material_inside_cylinder`.

  | Configuration | Convex? |
  | --- | --- |
  | Cylinder's own end cap | yes |
  | Post standing on a plate | no |
  | Flat bottom of a blind hole | no |
  | Rim of a through hole | yes |

  The last row was a real bug: `reversed` alone was read as concave.
- Plane-cylinder inward radius bound: `r < r_c - max(linear, relative*r_c)`. The argument: the quarter-tube band used spans `v in [0, pi/2]`, and a spindle torus self-intersects only where `R + r cos v < 0`, i.e. `|v| > arccos(-R/r) >= pi/2`. So the old `r <= r_c/2` bound (the one keel still uses: "convex needs r_cyl > 2r") "refused sound geometry".
- `dihedral_half_angle` war story: the fillet uses the wedge half-angle `(pi - angle(n1,n2))/2`. Halving the normal angle instead coincides only at 90 degrees and explodes near tangency: on a 178.9-degree ridge, contacts land about 100r away instead of about 0.01r.

## Robustness and guarantees
- Nothing is proven (INFERRED from code). Exact-path acceptance is a conjunction of necessary conditions (Euler, closed manifold, bounds, representation, validator) evaluated after up to three heuristic healing passes. An Euler-balanced closed shell with wrong geometry passes.
- A WRONG result is DOCUMENTED in the README: `intersect(box, sphere)` "keeps the wrong sphere region for that configuration (an open, pinned defect)". It is excluded from the benchmark table.
- The mesh fallback is tolerance-band co-refinement with f64 constructions. Its accuracy is set by an absolute deflection. The code comment (`boolean/mod.rs:1163-1167`) reports that routing a disjoint sphere cut through it lost 0.286% of volume at r = 10, 38.8% at r = 0.01, and refused ("work limit exceeded") at r = 10,000. DOCUMENTED scale-dependence.
- Qualification discipline (DOCUMENTED, `testing-strategy.md`):
  - A cell is Qualified only with matrix-generated tests, postcondition checks, negative/boundary tests and native/WASM agreement.
  - The B6 reference matrix covers 7 primitives x scales 1e-3/1/1e3 with closed-form volume, census, dual validation, watertight mesh, independent mesh-volume integration, determinism and typed refusal.
  - Metamorphic properties: transform invariance, uniform-scale invariance, operand symmetry, idempotence, split-then-rejoin, refinement convergence, STEP read/write/read.
  - Perturbation stability: 1e-13..1e-6 nudges must keep the classification or refuse typed.
  - Differential testing against an out-of-process oracle only.
  - Mutation testing reports: `mutants-*-2026-09-*.md`.
- B26 Boolean-correctness campaign (DOCUMENTED, `docs/kernel-maturity/b26-boolean-correctness-log.md`, `crates/operations/tests/prop_boolean_invariants.rs`), the most transferable test design in the repo:
  - Seven generated families: box pair, box-cylinder plug, cavity (via `shell()`), rigid motion, scale, spheres, nudge. A small deterministic CI replay (about 5 s) plus an opt-in campaign (`PROP_BOOL_CASES` clamped to 1..4096, `PROP_BOOL_SEED`).
  - Independent oracles only: hand closed forms (box, cylinder, sphere, equal-sphere lens), set identities, the operation validator, a position-quantized geometric edge recount, and mesh boundary/non-manifold counts. The log states that the harness "re-derives everything from hand closed forms so no kernel-sharing oracle is inherited". `solid_volume` is the reading under test, never the oracle.
  - Per-case outcome taxonomy `exact_ok | typed_refusal | incorrect` (keel's PASS/DECLINE/WRONG under other names), plus a non-vacuity gate: every family needs at least one `exact_ok`, so a kernel that refuses everything cannot pass.
  - Instability rule: refusals at tangency or contact pass, but a 1e-13 nudge that flips refusal to success (or back) fails.
  - All five initial "findings" were harness bugs (for example, the check crate's `ShellConnected` rejecting legitimate disjoint unions; empty intersections returned as faceless solids). A lesson for wonky: budget time to debug the oracle itself.
  - The translation-invariance oracle later found real kernel bugs (PR #603, below).

## Parallelism and performance
- Single-threaded, including WASM. README table measured 2026-08-06 before the fork, flagged "historical, do not quote as current": `fuse(box,box) x10` 0.5 ms WASM vs 43.7 ms occt-wasm; `cut(box,cyl) x10` 28.3 vs 64.3 ms; box+fillet 0.3 vs 6.2 ms; 16-hole multi-boolean 4.7 vs 30.1 ms; native `fuse(box,box)` 122 us.
- INFERRED: the box-box row hits the AABB-algebra shortcut, so the 87x compares a special case against OCCT's general GFA, not engine against engine.
- Curved Booleans are slow outside the shortcuts. The B26 log measured (2026-09-12, native): sphere-sphere fuse about 60-80 s per call, sphere cut about 36-66 s, sphere intersect about 1-2 s, at 8 segments, with volumes identical across 8/12/16 segments. Sphere fuse and cut were moved out of CI for that reason (DOCUMENTED, `b26-boolean-correctness-log.md` design decision 6).

## Known failures, limitations, war stories
- #190: cutting a cylinder with a 30-degree tilted slab. GFA returned an open 5-face shell, and the public `boolean` then silently substituted the mesh fallback: 53 planar faces, volume 674.79 against an exact of about 678.42. This is essentially wonky's blocked plane/cylinder class.
- #195, follow-up: the plane x cylinder generator line was never clipped against the planar face's polygon. The plane-polygon clip was "calibrated for plane x plane" and was skipped for mixed pairs. This produced a spurious seam edge on the wall.
- PR #603 (open, 2026-09-22, "B32 translation-variant exact cuts have distinct roots"; https://github.com/esaueng/remus/pull/603): two cuts whose measured volume changed under rigid translation.
  - Cylinder-cylinder near miss (0.54 apart, AABBs touching at z=1): the face-face phase kept infinite-carrier plane x cylinder contact lines whose only overlap with the planar disc face lay outside the stock's z range, because `clip_line_to_face` "only handled straight-edge polygons". Fix: an exact drop-only disc check (clean misses are dropped, any touch keeps the old conservative line). This is the same bug family as #195 and again the plane/cylinder class wonky is blocked on: clipping a carrier intersection line against a face bounded by circular arcs.
  - Box-cone cuts: the Boolean was right (cut + intersect = box to 0.0000% by Gauss quadrature), but the volume measurement integrated a NURBS-trimmed cone wall over its analytic bounding rectangle. Fix: decline such walls to the whole-solid mesh measure.
  - The fix then regressed an unrelated revolve test deterministically (relative error 5.68e-5 against a 5.1e-8 budget), because partial-revolve walls have exact rational-NURBS arc trims. The coordinator note forbids widening the test budget: "it encodes the exactness contract the base meets at ~1e-15". Lesson: measurement code (volume, area) needs the same trim-aware exactness as the Boolean, or the oracle lies.
- #483: an edge tolerance "stamped at measured residual + 1 ulp" was defeated by simd128 4-lane contraction in the WASM build. The residual exceeded tolerance by 8.13e-16. Same patch, same test, different build flags, different verdict.
- Silent fallback: `compound_cut` accepted the mesh fallback without disclosure until 2026-09-21 (`boolean-contract-audit-2026-09-21.md`).
- #278: GFA emitted same-wound inner wires on a cross-drilled cylinder wall. #264: periodic faces with two ring wires validated clean but tessellated to a fraction of their volume. #284: `unify_faces` took 10 s on a 47k-face solid. #244: healing opened closed shells. #262: a tessellation panic on valid solids.
- `AGENTS.md` "Wildcard match arms": 93 `_ =>` arms over `EdgeCurve`/`FaceSurface` silently absorb new variants ("a face skipped, an exact path declined for a mesh fallback").
- README Known Limitations: "Exact tangency and sliver crossings" always go to the fallback. General quartic seams and torus x torus are unqualified. Cross-drilled cylinder/cylinder rim fillets refuse. Fillet rollover onto the next support face is not implemented (stop-at-cliff).

## Relevance for wonky
- Error contract, adoptable almost verbatim:
  - the `quality`/`fallback`/`tolerance_report`/`stats` result shape;
  - the nine failure categories with additive stable codes;
  - "unsupported cites the capability cell";
  - "nonconvergence reports budget and consumed";
  - the fillet refusal record `{edge, face, requested_radius, available_radius}`.
  This is wonky's "unsupported must fail explicitly" rule made machine-readable, and it is ideal for LLM callers, which branch on codes, not prose.
- Budgets as deterministic operation counts map directly onto Bend: a U32 fuel parameter threaded through recursion, identical on JS, C and Metal. Cancellation is not needed in a pure batch model (INFERRED).
- Transactions are free in Bend. The old immutable model is the rollback, so remus's `run_transacted` machinery shows what a mutable arena costs, not something to copy (INFERRED).
- Do not copy the Boolean acceptance design. Heuristic heal passes followed by Euler/manifold gates, then a tolerance-band mesh fallback, is exactly the brittle web wonky wants to avoid. Its fallback uses a normalized `orient3d` against a tolerance and centroid GWN, so it is not a Manifold-class robust mesh Boolean. Wonky's hybrid should keep the symbolic-perturbation mesh core for topology decisions.
- Determinism lesson from #483, INFERRED and important for wonky: F32x2 double-word arithmetic relies on error-free transformations (TwoSum/Fast2Sum), which break under reassociation or fast-math. Metal compiles with fast-math and FMA contraction unless it is disabled; JS has no FMA. Wonky must (a) pin the contraction behaviour per target, (b) never mint tolerances or certificates at ulp-tight margins, and (c) test cross-target bit-identity or at least verdict-identity, as remus's parity matrix does.
- Scale lesson: an absolute deflection budget (0.1 mm) makes the error model-scale dependent. For FDM, mm-scale defaults are fine, but tolerances should be declared per quantity class (the contract's seven tolerance classes are a good taxonomy).
- Fillet ladder: the analytic pair list, the plane-cylinder convexity table and the `r < r_c` bound derivation are directly usable when wonky starts fillets. Plane-plane gives a cylinder, perpendicular plane-cylinder gives a torus, and every other pair refuses with a typed cliff or unsupported error until qualified.
- Testing: adopt the metamorphic list and the perturbation-stability rule (1e-13..1e-6 nudges keep the verdict or refuse typed) for the Boolean bake-off. Run it alongside keel's PASS/DECLINE/WRONG oracle. Take B26's non-vacuity gate (each family must produce at least one exact success) and its rule that oracles never share kernel code. Translation invariance is cheap and found real bugs (#603); in F32x2 it also exercises the absolute-coordinate precision loss that exact predicates must absorb.

## Pointers worth porting or studying
- `docs/kernel-maturity/operation-contract.md`, `failure-taxonomy.md`, `testing-strategy.md`, `capability-matrix.md` (the qualification states Qualified, Partial, Unqualified, Unsupported-typed and Unsupported-untyped), `boolean-contract-audit-2026-09-21.md`.
- `crates/math/src/context.rs` (`OperationContext`, `WorkBudgets`, `FallbackPolicy`), `crates/math/src/intersect.rs` (`ContactKind`, `ResultQuality`), `crates/math/src/diagnostic.rs`.
- `crates/operations/src/boolean/mod.rs:786-1730` (shortcut ladder, acceptance gates, fallback refusal point), `crates/operations/src/mesh_boolean.rs` (a counter-example for robust mesh Booleans; the limits struct is fine).
- `crates/blend/src/lib.rs` (`BlendError`), `crates/blend/src/analytic.rs:354-365` (`dihedral_half_angle`), `:758-886` (`plane_cylinder_fillet` convexity and bound), `crates/operations/src/blend_ops.rs:1106-1240` (`fillet_v2`, `fillet_cascade`, `blend_failure_code`).
- `crates/math/src/analytic_intersection.rs:2742` (`exact_cylinder_cylinder`), `:2813` (`algebraic_cylinder_cylinder`).
- Issues #190, #195, #483; PR #603 (translation-variant cuts, `clip_line_to_face` in `crates/algo/src/pave_filler/phase_ff.rs`).
- `docs/kernel-maturity/b26-boolean-correctness-log.md` and `crates/operations/tests/prop_boolean_invariants.rs` (generated families, independent oracles, outcome taxonomy, non-vacuity gate).

## Verdict: adapt
Adapt the contract layer: result quality, fallback policy, failure taxonomy with stable codes, work budgets, typed fillet refusals, qualified SSI results and the qualification/metamorphic test discipline. It is Apache-2.0, so the types and doc text can be carried over with attribution. Treat the geometry code as learn-from only:
- It is f64, arena-mutating and OCCT-shaped.
- Its Boolean robustness rests on heuristic gates plus a tolerance-band mesh fallback, with a DOCUMENTED wrong-result case.
- It is 510k lines of agent-written code with 0 external users besides OpenZCAD.
- Never pull code from post-v2.129.15 brepkit (AGPL).
