# Fornjot: "Shutting Down Fornjot" (2026) and the Fornjot repository

- Kind: blog post-mortem + archived Rust repository
- Canonical URL: https://www.fornjot.app/blog/shutting-down-fornjot/
- Other URLs:
  - Repo: https://github.com/hannobraun/fornjot (archived)
  - https://www.fornjot.app/blog/why-fornjot-is-using-boundary-representation/ (2022-01-26)
  - https://www.fornjot.app/blog/a-new-direction/ (2023-05-15)
  - https://www.fornjot.app/blog/straight-edges-flat-faces-simple-sketches-full-csg/ (2022-03-02, the milestone that was never reached)
  - Experiments: https://github.com/hannobraun/fornjot/tree/main/experiments (2024-10-30 .. 2025-12-03)
  - Key issues: #42 union (https://github.com/hannobraun/fornjot/issues/42), #2118 uniform intermediate representation (https://github.com/hannobraun/fornjot/issues/2118), #993 edge equality (https://github.com/hannobraun/fornjot/issues/993), #1937 coincident half-edges (https://github.com/hannobraun/fornjot/issues/1937), #1385 kernel interactivity (https://github.com/hannobraun/fornjot/issues/1385), #2450 "How do you cut extrude?" (https://github.com/hannobraun/fornjot/issues/2450)
- Author: Hanno Braun (plus 56 contributors per GitHub API), first commit 2020-07-30 (per the shutdown post), repo created 2021-04-07.
- License: 0BSD (LICENSE.md; GitHub reports NOASSERTION because of the file name/format). 0BSD is public-domain-equivalent: code and ideas may be ported into a private, unlicensed project with no attribution obligation. DOCUMENTED (LICENSE.md in repo).
- Status: archived. Last push 2026-06-19 ("Make warning signs bold too"), 2,553 stars, 136 forks, 20 open issues, 26 MB repo, last crates.io release v0.49.0 (2024-03-21). Mainline (crates/) ~24.7k lines Rust in crates/fj after merging the final experiment; ~40k lines total with experiments. DOCUMENTED (gh api, 2026-09-22; local shallow clone at tmp/research/fornjot).

## What it is

A from-scratch, code-first B-rep CAD kernel in Rust, aimed at "mechanical CAD applications, like 3D printing, machining, woodworking" with the principle "Favor reliability over features. Anything you can do should either work as expected, or result in a clear and actionable error" (README). This is almost exactly wonky's stated scope and rule set, which makes it the most relevant negative example available. DOCUMENTED.

After nearly six years it shipped: sketches of lines (circles experimental), sweeps along straight paths (planes and cylinder side walls only), face split/join/replace operations, validation checks, 3MF/STL/OBJ export, a wgpu viewer. It never shipped: any Boolean beyond disjoint "Group", cut-extrude through existing geometry, fillets/chamfers, STEP export, NURBS. DOCUMENTED (README Status section; issue #42 closed 2023-11-24 as "not actionable"; #2450: cut extrude "probably not possible right now").

The site now redirects readers to next.BREP.io, a different author's Rust B-rep kernel/app (browser + desktop, fillets, shells, sheet metal, STEP export claimed on its landing page). HEARSAY-level for capability claims (landing page only, not examined here).

## How it works (concrete)

### Timeline of architectures (DOCUMENTED from blog, issues, experiment READMEs)

1. 2018-2021: SDF/f-rep experiments. Abandoned because (post of 2022-01-26): common operations do not yield correct SDFs ("fine for many use cases, but ... engineering use cases ... accuracy is important"); CSG is not enough (want "chamfering specific edges; or selecting a face, drawing a sketch on it"); meshing algorithms are "either aren't that good ... or crazy complicated". He also rejected mesh-based modeling as the "third approach" because selecting a round edge made of many triangle edges is unclear.
2. 2021-2024 mainline B-rep: object graph with Vertex/HalfEdge/Cycle/Face/Shell/Solid, geometry defined locally (vertex as 1D point on a curve, curve as 2D path on a surface, surfaces from sweeping lines/circles). `Scalar` is an f64 newtype that panics on NaN/inf so it can implement `Eq/Ord/Hash` (crates/fj/src/core/math/scalar.rs). Validation layer with checks: `coincident_half_edges_are_not_siblings`, `face_boundary`, `face_winding`, `half_edge_connection`, `half_edge_has_no_sibling`, `multiple_references` (crates/fj/src/core/validation/checks/). Triangulation: Delaunay (spade crate) plus filtering for holes (crates/fj/src/core/algorithms/triangulate/). The only intersection routine left in mainline is `ray_segment.rs` (point-in-polygon for triangulation); the face/face, shell/point and ray/face intersection code written for the union effort was later removed as dead code (CHANGELOG 0.49: "Remove unused intersection checks").
3. Mid-2023: scope cut from "code-first CAD application" to "CAD kernel only" after the biggest sponsor left (A New Direction).
4. Late 2023 - 2024: issue #2118 "uniform intermediate representation": replace per-primitive-pair intersection math (combinatorial explosion: line-line, circle-circle, line-circle, circle vs. surface-surface curve...) with one approximation representation (polylines for curves, triangle meshes for surfaces) on which all queries run. Stalled because curves/surfaces are infinite and generating approximations needs range/context information everywhere; geometry was regenerated repeatedly for ops, rendering and bounding boxes.
5. 2024-10 .. 2025-12: five experiments in experiments/:
   - 2024-10-30: interactive core over a plain triangle mesh, step-through of operations (1.5k lines).
   - 2024-12-09: adds a simplified topological B-rep layer on the mesh; "full success" on topology, failure on showing operation history ("the problem I was trying to solve was ill-defined").
   - 2025-03-18: global 3D geometry instead of local coordinates. Finding: constructing everything in 3D throws away local (u,v) coordinates that "can't be reconstructed reliably, as there are degenerate cases where a 3D coordinate maps to multiple 2D ones" (e.g. cylinder seam, cone apex). Local definitions are redundant (shared edges/vertices have several local forms) and need caching, but global-only is worse.
   - 2025-11-07: back to local coordinates; separates owned vs. shared topology; defining one cube manually takes ~590 lines (experiments/2025-11-07/src/main.rs L29-L619 per the 2025-12-03 README).
   - 2025-12-03 (declared successful, merged into crates/fj/src/core/new/): "use the complicated information right away". Core data is append-only lists: vertices (3D points), triangles, edges (two boundary vertices + `approx: Vec<Point<3>>` interior polyline), faces (`approx: Vec<Triangle<3>>`), half-edges/half-faces referencing shared edges/faces with an `Orientation::{Nominal, AntiNominal}` flag, solids as lists of half-faces (crates/fj/src/core/new/topology/primitives.rs). Every operation takes a tolerance and emits the approximation plus the topology tags at construction time; the exact curve/surface is not stored in the kernel, the generating code is the source of truth. Validation: coincident half-edges in one solid must reference the same Edge (`new/validation/coincident_non_sibling_half_edges.rs`, O(n^2), no spatial index). The author openly lists STEP export and memory at high accuracy as unanswered.

### Numeric model

f64 everywhere, no robust predicates in mainline (robust-predicates `orient3d` was considered for ray/face in #42). No exact arithmetic, no tolerance model beyond per-operation approximation tolerance. DOCUMENTED (scalar.rs, #42 comment 2022-08-05).

## Robustness and guarantees

Nothing proven. Reliability was pursued through validation layers and by restricting the feature set ("only straight edges (line segments) and flat faces (polygons) will be supported" for the stable milestone, 2022-03-02). Even that restricted milestone ("full CSG" for polyhedra) was never completed. DOCUMENTED.

## Parallelism and performance

No measured numbers published. The author noted a subjective performance hit from regenerating approximations on demand (#2118 comment 2024-10-15) and that this turned out to be an architectural rather than a performance problem (2024-10-22). No parallelism. DOCUMENTED.

## Known failures, limitations, war stories

- Union (#42, opened 2022-01, closed 2023-11 unimplemented). Chain of blockers: #97 -> #568/#567 -> face/point containment (#941) -> ray/face (#978) -> shell/point needed edge equality (#993) -> edge equality needed normalized GlobalEdge/GlobalCurve (#1079) -> #1162 -> #1589 cleanup. 2023-03-17 retrospective: building all intersection tests first "was the wrong one. All those intersection tests that have already been completed are basically dead code"; the harder part is "actually doing the thing", i.e. topology surgery, and constructing test geometry "always turned into a huge pain". A contributor pointed out that two crossing cylinders cannot even be represented with lines and circles (needs the sine-like trim curve in the cylinder's uv); the author's answer was a possible "square things with round holes" milestone, or full NURBS. DOCUMENTED.
- Edge identity (#993): the sweep produced coincident but differently-defined, opposite-direction edges for neighbouring side faces; deciding whether two edges are "the same" required normalizing curves, which conflicted with local/global consistency. Months of work. DOCUMENTED.
- Coincident half-edges had to be congruent for watertight approximation (#1937); face splitting made that impractical. DOCUMENTED.
- Architecture at a "local maximum ... consistent and self-reinforcing. Whenever I try to simplify one aspect, I run into the problem that it's there for a reason" (experiment READMEs). DOCUMENTED.
- Kernel as batch system with no insight into intermediate steps was called a core mistake (2024-10-30 README; #1385 cites Bret Victor). DOCUMENTED.
- Post-mortem (2026-06-19) lists non-technical and process causes: extrapolating linear progress from early B-rep success ("I ran into a cliff"), sponsorship before a product ("sold a dream"), incremental-only changes instead of constant prototyping, half-measures after funding drops, muddled vision after going from app to generic kernel ("Something can be a kernel, a library, but still focus on specific use cases. Be a tool instead of a building block"), prototyping too late (over a year of experiments, then ran out of steam while integrating). Estimate: another 2-3 years to reach a foundation that delivers value. DOCUMENTED.

## Relevance for wonky

INFERRED throughout:

- Risk register. Wonky shares Fornjot's goals (code-first, FDM, reliability, explicit failures) and several of its traps. Concrete mapping:
  1. "Implement all pairwise intersection tests first" became dead code. Wonky should keep driving Booleans from real failing models (the plane/cylinder union that blocks the current model), not from a complete surface-pair matrix.
  2. Edge identity and coincident-edge sharing (#993/#1937) is where Fornjot spent months. Wonky's topology identity/provenance layer already exists; a Boolean must emit shared edges by construction (one edge object referenced by both half-edges), never by post-hoc geometric matching.
  3. Local vs. global geometry: Fornjot's finding that 3D points cannot be mapped back to unique (u,v) at seams/apexes applies directly to wonky's STEP pcurves and to analytic B-rep recovery from a tagged mesh. Keep (u,v) (pcurve) data from the construction step instead of re-projecting later.
  4. Fornjot's final design (tagged approximation built at construction time, exact geometry left in the generating code) is close to wonky's leading hybrid, except wonky keeps the exact analytic surface on each tag and recovers an exact B-rep. Fornjot never got to test whether a tagged mesh supports Booleans; its final data model has no Boolean at all. So it validates the data layout, not the Boolean.
  5. The scope lesson: Fornjot's stable milestone was "straight edges, flat faces, full CSG" and it still failed, mainly on topology surgery and API ergonomics for constructing test geometry. Wonky already has planar arrangements, convex tools and coaxial cylinder cases; the next step (plane/cylinder general union) is exactly the step Fornjot never made. Keep the surface set closed (plane/cylinder/cone, later sphere/torus) and treat everything else as explicit failure.
  6. Interactivity/introspection: Fornjot identified "batch kernel with no insight" as a root mistake; wonky's viewer diff/review and provenance are the right counter-measure and should expose Boolean intermediate state (candidate intersection curves, classification per face) not just results.
- Bend fit: nothing algorithmic to port. The append-only vertex/triangle/edge/face lists with orientation flags are a natural fit for Bend's immutable arrays and fork-join construction (each operation appends; no in-place surgery).
- Process lesson for a solo product owner: prototype aggressively in throwaway experiments (the running Boolean bake-off is this), and stop integrating an approach once it is shown to stall.

## Pointers worth porting or studying

- crates/fj/src/core/new/topology/primitives.rs: Vertex/Edge(boundary + approx)/HalfEdge(edge + Orientation)/Face(approx triangles)/HalfFace/Solid. Minimal tagged-mesh B-rep layout.
- crates/fj/src/core/new/validation/coincident_non_sibling_half_edges.rs: the one validity invariant that matters for watertight meshes (coincident half-edges must share an Edge).
- experiments/2025-03-18/README.md, section "Possible Return to Locally Defined Geometry": clearest short argument for keeping local (u,v) data.
- experiments/2025-12-03/README.md: "build topology and approximation together" rationale, and its admitted open problems (STEP, memory).
- Issue #42 comment 2023-03-17 (https://github.com/hannobraun/fornjot/issues/42#issuecomment-1473709945): why intersection-tests-first failed.
- Issue #2118: the combinatorial-explosion argument for a uniform intermediate representation, and why on-demand approximation of infinite curves/surfaces hurt.
- crates/fj/src/core/math/scalar.rs: NaN/inf-rejecting total-order float wrapper (trivial, but the Eq/Hash-on-floats pattern is how Fornjot used geometry as map keys; wonky should prefer topology IDs as keys instead).

## Verdict: learn-from

Nothing to adopt technically: no Boolean, no curved SSI, no robust predicates, f64-only. Its value is as a precise, well-documented failure history of a project with nearly identical goals, and as independent confirmation (from its final experiment) that "topology tags recorded at construction time on an approximation" is a workable data layout. The post-mortem argues for narrow scope, prototype-first development and early introspection, all of which wonky already follows.
