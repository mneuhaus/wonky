# Fornjot final experiment (experiments/2025-12-03) plus experiments dir

- Kind: kernel (hobby B-rep kernel, Rust). Canonical: https://github.com/hannobraun/fornjot/tree/main/experiments/2025-12-03
- Other URLs: https://github.com/hannobraun/fornjot , https://github.com/hannobraun/fornjot/tree/main/experiments , merged code: https://github.com/hannobraun/fornjot/tree/main/crates/fj/src/core/new , shutdown post: https://www.fornjot.app/blog/shutting-down-fornjot/ , design issue: https://github.com/hannobraun/fornjot/issues/2118
- Authors: Hanno Braun (sole driver: 18,972 of 19,972 commits; 44 GitHub contributors, 56 including anonymous, over the project's life; DOCUMENTED via `gh api .../contributors` and the commits `Link` header on 2026-09-24). 2021-04 (repo) to 2026-06-19 (archival). Companion note on the shutdown: `sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md`.
- License: 0BSD (DOCUMENTED: `LICENSE.md` is the Zero-Clause BSD text; README says "licensed under the terms of the Zero Clause BSD License"). GitHub API reports `NOASSERTION` only because the file is Markdown. 0BSD = public-domain-equivalent: code can be copied into wonky with no attribution or notice obligation.
- Status: archived (DOCUMENTED: `gh api repos/hannobraun/fornjot` -> archived=true, 2552 stars on 2026-09-24, 136 forks, pushed 2026-06-19). Last release v0.49.0 (2024-03-21). The experiment was merged into `crates/fj/src/core/new/` (last commits there 2026-06-12/13, "Integrate `Sketch2` tests into new infrastructure"). Shutdown post dated 2026-06-19.

Clone read: `tmp/research/fornjot` (HEAD 7e85668, 2026-06-19).

## What it is

The last of five architecture experiments (2024-10-30, 2024-12-09, 2025-03-18, 2025-11-07, 2025-12-03) started because mainline Fornjot "has reached a local maximum. It has become mired in complexity" (DOCUMENTED, `experiments/2025-12-03/README.md`). The final design is a "hybrid b-rep/mesh-based kernel. Topology is represented using typical b-rep primitives, but geometry is approximated with polylines and triangle meshes" (DOCUMENTED, `crates/fj/src/core/new/approx/mod.rs`). The README's Results section says: "This experiment has concluded successfully and will be merged back into the mainline code." The merge was partial (module `core::new`, "piecemeal transition") when the project was shut down.

Scope actually implemented (DOCUMENTED by reading `core/new`, 2374 lines total): sketch (lines and arcs on a plane) -> face; sweep face along a line or arc -> solid; reverse; translate; connect two vertices -> half-edge; one validation check. **There is no Boolean, no intersection, no fillet, no STEP export** in the new architecture. Mainline never had 3D Booleans either: union/difference/intersection issues #42/#43/#44 were closed NOT_PLANNED ("too many moving parts ... to make this actionable", https://github.com/hannobraun/fornjot/issues/42).

## How it works

Experiment lineage (DOCUMENTED from each `experiments/*/README.md`):
- 2024-10-30: an interactive core on a bare triangle mesh; every operation step can be viewed. Lesson: the batch-system design ("API calls come in on one side, geometry comes out the other") made debugging painful.
- 2024-12-09: added B-rep topology layers on top of the mesh; "very happy with how the topological b-rep structure turned out"; the attempt to encode the operation graph in the UI failed ("the problem I was trying to solve was ill-defined").
- 2025-03-18: stored all geometry globally in 3D (no curve/surface-local coordinates), which simplified graph construction. Failure mode: "By constructing all geometry in 3D, we're throwing away information about local coordinates that would be available at the time of construction. This information can't be reconstructed reliably, as there are degenerate cases where a 3D coordinate maps to multiple 2D ones."
- 2025-11-07: added redundant local definitions back (owned vs shared objects). Result: defining one cube by hand took ~590 lines of core-data construction (link in 2025-12-03 README, `main.rs#L29-L619`).
- 2025-12-03: "use the complicated information _right away_, so we don't need to maintain nor reconstruct it". Build topology and approximation together, step by step, at construction time.

Code size per experiment (DOCUMENTED, `wc -l` of `*.rs`): 2024-10-30 1,530; 2024-12-09 2,435; 2025-03-18 5,373; 2025-11-07 4,158; 2025-12-03 **90**. The final experiment directory is only a demo binary (`src/main.rs`) that depends on `fj` by path. Everything real lives in `crates/fj/src/core/new` (2,374 lines).

The demo (DOCUMENTED, `experiments/2025-12-03/src/main.rs`) builds one shape end to end:
- a `Sketch` of four `arc_to(radius 1.0, tolerance 0.001, …)` segments (a bulged square), plus an inner square hole made of `line_to`;
- `into_face` on a plane;
- `Sweep::face_to_solid` along `Arc::to([0,0,1], [1,1,1], tolerance)`, a curved sweep path;
- export of the solid's face triangles to `output.3mf`.

The design kept evolving after the README declared success (DOCUMENTED, `gh api repos/hannobraun/fornjot/commits?path=crates/fj-core/src/new/topology/topology.rs`):
- The demo was last touched 2026-02-20. It destructures `Topology { faces, half_edges, solids, vertices }`, which no longer matches HEAD. INFERRED: it would not compile against the final `core/new`.
- 2026-03-16: "Add store for edges to `Topology`" introduced the shared `Edge` record.
- 2026-03-17: "Rename `Face` to `HalfFace`".
- 2026-03-20: "Add store for faces" introduced the shared `Face` record.
- 2026-06-11: `fj-core` was merged into `fj`.

So the sibling invariants (coincident half-edges share one `Edge`, coincident half-faces share one `Face`) arrived during the merge, about three months after the experiment ended. The published end state of the architecture is `core/new`, not the experiment directory.

Data model (DOCUMENTED, `core/new/topology/{store,primitives,topology}.rs`):
- `Store<T>` is an append-only `Vec<T>`; `push` returns `Handle<T>{index}`. There is no removal or mutation API. `Topology` is six stores: vertices, edges, half_edges, faces, half_faces, solids.
- `Vertex { point: Point<3> }`. Only boundary points are vertices; curvature sample points are not vertices.
- `Edge { boundary: EdgeBoundary { vertices: [Handle<Vertex>;2] }, approx: Vec<Point<3>> }`: interior polyline samples, empty for straight lines. The edge is undirected in principle and has a nominal direction.
- `HalfEdge { edge: Handle<Edge>, orientation: Nominal|AntiNominal }`. Invariant: coincident half-edges must reference the same `Edge` (they are "siblings").
- `Face { approx: Vec<Triangle<3>> }`. `HalfFace { boundary: Vec<Handle<HalfEdge>>, face, orientation }`; reversing a half-face flips triangle winding on read.
- `Solid { boundary: Vec<Handle<HalfFace>> }`.
- `Face` is explicitly shareable across solids. The doc comment says "Faces may be shared by half-faces from different solids, where those solids touch, or by half-faces from the same solid, where that solid touches itself" (DOCUMENTED, `topology/primitives.rs`). So the model is a small cellular complex, closer to a radial-edge or half-face structure than to a 2-manifold half-edge B-rep. It can represent touching bodies and self-touching solids without duplicating geometry, which is the same idea as hypermesh's bundled coincident facets (`sources/hypermesh-hyperreal-hyper-stack-under-csgrs.md`) (INFERRED comparison).
- `Store` docs warn that handles from two `Topology` instances must not be mixed, and nothing checks this at runtime (DOCUMENTED, `topology/store.rs`). A Bend port should tag handles with a store or generation id if more than one store can exist.
- The geometric definitions (plane, arc) are transient: they exist only in the operation call and are never stored in the topology. The only geometry left is the samples.

Approximation (DOCUMENTED):
- Tolerance is an explicit positive scalar (`approx/tolerance.rs`; rejects values <= 0) and is passed per arc (`Sketch::arc_to(radius, tolerance, to)`, `Arc::to(end, dir, tolerance)`).
- Circle sampling (`core/approx/circle.rs`) uses n = max(ceil(pi / acos(1 - tol/r)), 3) vertices per full circle and increment = tau/n. Samples lie on a **global per-circle angular lattice** (k * increment); for a sub-range [a,b] it emits floor(a/inc)+1 .. ceil(b/inc)-1. Two edges on the same circle therefore produce identical sample points, which keeps shared boundaries consistent.
- Face triangulation (`core/new/approx/face.rs`): constrained Delaunay (crate `spade`, f64) over the boundary samples in 2D local coordinates plus interior surface points. Holes are handled by discarding triangles whose centroid is outside the boundary polygon (crate `geo`). `panic!` on an invalid (degenerate) triangle.
- Sweep side faces (`operations/sweep.rs`) use a synthetic unit-square parameterisation: `ApproxAxis::Uniform` spreads the existing edge samples evenly on [0,1] in u or v. Interior points are the cartesian product of bottom-edge samples and path samples. The comment spells out the key trick: "you don't need a perfectly accurate local representation of the face's 3D points ... to create a triangulation. All you need is the correct number of points, relatively positioned in the correct way" (`approx/half_edge.rs`). The local coordinates are thrown away and only the 3D triangles are kept.
- `Connect` memoises `(v0,v1) -> HalfEdge` in a BTreeMap so the side faces share their vertical edges.
- Validation (`validation/coincident_non_sibling_half_edges.rs`): an O(n^2) all-pairs check. Two half-edges are coincident if every sample of A lies within `non_coincident_distance` of B's polyline; coincident non-siblings are reported as invalid. `Model.invalid_half_edges` carries failures to the viewer instead of panicking.
- Numeric model: `Scalar` wraps f64 and forbids NaN/inf, so it can implement Eq/Ord/Hash (`core/math/scalar.rs`).

Planned but not built: STEP/SVG export through tags. Issue #2118 proposes that the "intermediate representation [be tagged] with the primitive it came from, and the exporter can then be aware of those tags", e.g. an arc recovered as a circle for SVG. This is hand-waved ("a bit hand-wavy") and never implemented.

## Robustness and guarantees

- Nothing is proven. Tolerance controls only the chord-height error of arc samples (DOCUMENTED formula above). There is no global deviation certificate for faces: interior sweep points are exact samples, but the triangles between them are not bounded against the true surface (INFERRED).
- Known unchecked assumptions in code (DOCUMENTED comments): `sketch.rs` "We just assume that the approximation of the sketch segment and the existing approximation of the half-edge match. We should make sure by checking it here." `curve/mod.rs` Arc: a half-circle arc (end perpendicular to dir) "will panic". `Sweep::face_to_solid`: "rather finicky in regards to how the face and the curve ... must be oriented ... limitations are not well-tested".
- There are no degenerate-case predicates. f64 comparisons and spade's own robust predicates are used for the CDT only.
- Lattice edge cases in `CircleApprox`, INFERRED from reading `core/approx/circle.rs`:
  - The chord formula `n = ceil(max(pi / acos(1 - tol/r), 3))` follows from the sagitta `r(1 - cos(theta/2)) <= tol`.
  - For `tol > 2r` the `acos` argument drops below -1 and yields NaN. `Scalar` forbids NaN, so this panics instead of clamping to 3.
  - The boundary exclusion `floor(a/inc) + 1 .. ceil(b/inc) - 1` has no epsilon. An arc endpoint that should sit exactly on lattice point k but is computed as `k·inc - 1e-15` emits lattice point k anyway, so a sliver segment of length ~1e-15 appears next to the boundary vertex.
  - The lattice is anchored at angle 0 of the circle's local frame, and Fornjot does not canonicalize that frame (vcad does). Two operands with differently oriented frames on the same circle therefore get different lattices.
  - wonky should derive lattice membership from exact integer `k` plus a canonical frame, and snap endpoints within a stated tolerance of a lattice point *onto* that lattice point.

## Parallelism and performance

No numbers were published. Issue #2118 progress notes (DOCUMENTED) say performance "has taken a hit" when geometry was regenerated on demand; the author concluded regeneration was "an architectural problem" and moved to generating samples once at construction time. The design is single-threaded Rust.

## Known failures, limitations, war stories

- Shutdown reasons (DOCUMENTED, blog 2026-06-19): financial/motivational, and technical inertia ("avoiding necessary rewrites", "half-measures"). The new architecture "still ... shows promise" but was never integrated.
- The generator-vs-generated-geometry problem (#2118 comments, DOCUMENTED): pure geometry code (project curve onto surface) needed range/context knowledge to regenerate samples. The fix was to store generated samples with the object that bounds them. The same issue appears in wonky whenever a mesh Boolean needs fresh samples of an analytic face.
- Local vs global coordinates (2025-03-18 README): discarding 2D surface coordinates caused ambiguous reconstruction (seam and pole points map to several 2D coordinates).
- "Coincident HalfEdges must be congruent" was a long-standing mainline limitation (#1608, #1937). The new design keeps it as a validation rule, not a construction guarantee.
- No Booleans, ever (#42-#44 NOT_PLANNED).

## Relevance for wonky

- Data model fit with Bend: excellent (INFERRED). Append-only typed stores with integer handles are exactly affine arrays or balanced trees keyed by U32 index. There is no mutation, and "reverse" creates new records. The half-edge/edge sibling invariant (coincident => same edge record) is the same shared-edge identity wonky needs for watertight meshes.
- The per-circle angular lattice sampling is directly useful for wonky's print mesh and tagged-mesh Boolean. vcad arrived at the same scheme on its own (`split::canonical_arc_points` plus `freeze.rs`; see `sources/vcad-ecto-vcad-kernel-booleans-kernel-naming-torture-corpus.md`). It also canonicalizes the circle frame (sign-normalized normal, x axis = the world axis least parallel to the normal) so that faces from *different* operands share lattice points. wonky needs that as well. Every edge and face that lies on the same analytic circle/cylinder samples from the same lattice k * (2*pi/n(r,tol)), so adjacent faces agree bit-for-bit without a stitching pass. In F32x2, compute n with the chord formula in double-word. Evaluating cos/sin of k*inc should use exact integer k plus double-word range reduction for determinism.
- Contrast with wonky's hybrid: Fornjot throws the analytic definition away after sampling and keeps only topology labels. Wonky keeps exact analytic B-rep and uses tags to recover it. Fornjot is therefore a data point for "topology as labels over samples", not for Booleans; it never reached the case that blocks wonky (plane/cylinder union). The brief's claim that it is "the closest published design to wonky's hybrid" is true only for the representation, not for any Boolean algorithm (INFERRED).
- Lesson to carry: keep the local (u,v) coordinates of every sample at construction time, alongside the 3D point (Fornjot's `ApproxPoint{local, global}`), because reconstructing them later is ill-posed at seams and poles. For wonky's analytic recovery this means tagging each mesh vertex with (surface id, u, v) where it is known, not only with a face id.
- The synthetic-parameterisation trick (a uniform [0,1]^2 grid for triangulating a swept face) is a cheap way to triangulate sweep/revolve side faces without a projection routine. Uniform work fits GPU call trees.
- Failure reporting as data (`Model.invalid_half_edges`) rather than panic matches wonky's "fail explicitly".
- Shared `Face` records across solids give a cheap representation for wonky's missing compare and interference features (INFERRED):
  - Two bodies that touch share a face record, with two half-faces of opposite orientation.
  - Interference then becomes "which faces or cells are shared or overlapped", not a separate mesh-mesh query.
  - For FDM this separates "touching" (a shared face, which prints fused) from "overlapping" (a volume, which prints as one piece) and from "clearance" (a gap). These are three cases a print-fit checker needs to tell apart.
- FDM: the tolerance-per-operation philosophy ("every manufacturing technique is going to have some tolerance") matches FDM, but wonky already has a certified-deviation mesh, which is stronger.

## Pointers worth porting or studying

- `crates/fj/src/core/approx/circle.rs` (`CircleApprox::new`, `points`): global-lattice arc sampling. Port it.
- `crates/fj/src/core/new/topology/primitives.rs`: minimal half-edge/half-face with Nominal/AntiNominal orientation over shared Edge/Face records (a compact identity model).
- `crates/fj/src/core/new/approx/half_edge.rs` (`from_start_and_axes`) and `operations/sweep.rs`: synthetic uv triangulation of swept faces.
- `crates/fj/src/core/new/validation/coincident_non_sibling_half_edges.rs`: a tolerance-based coincidence validator. Wonky would replace O(n^2) with a BVH.
- `experiments/2025-03-18/README.md` ("Possible Return to Locally Defined Geometry") and `experiments/2025-12-03/README.md` ("Potential Drawbacks"): the clearest written rationale of the local/global geometry trade-off.
- Issue #2118: the "uniform intermediate representation" argument against a combinatorial explosion of analytic intersection pairs, and the tag-for-export idea.
- `experiments/2025-12-03/src/main.rs` (90 lines): the smallest end-to-end use of the API (sketch with arcs and a hole, arc sweep, 3MF export). It is stale against HEAD, so read it together with `core/new/topology/topology.rs`.
- `crates/fj/src/core/new/approx/point.rs` (`ApproxPoint<D>{local, global}`): the "keep local coordinates next to the 3D point" record, fed directly to spade's CDT through `HasPosition`.

## Verdict: learn-from

The representation lesson is valuable: append-only, construction-time topology labels, keeping local coordinates, lattice sampling. The license is free (0BSD). But there is no Boolean, SSI, fillet or export to learn from, the code is small and partly untested, and the project is dead. Port `CircleApprox` lattice sampling and the half-edge/edge sibling invariant. Do not adopt the "discard analytic geometry" stance, because wonky needs STEP and exact recovery.
