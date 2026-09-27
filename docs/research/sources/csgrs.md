# csgrs

- Kind: Rust CSG modeling "grammar" library. OpenSCAD-like vocabulary: 2D regions, 3D meshes, extrude/revolve/sweep/loft, mesh I/O.
  - Repo: https://github.com/timschmidt/csgrs
  - Crate: https://crates.io/crates/csgrs
  - HN: v0.16 thread https://news.ycombinator.com/item?id=43347677 (2025-03-12); Show HN https://news.ycombinator.com/item?id=42656522 (2025-01-10).
  - The numeric stack underneath is covered in depth in `hypermesh-hyperreal-hyper-stack-under-csgrs.md`. Read that note for the exact Boolean internals.
- Clone read: `tmp/research/csgrs` at `4e5b9eb` (2026-09-17, shallow). Historical files fetched via `gh api …/contents?ref=`:
  - `tmp/research/csgrs-readme-v0.16.md` (README at tag v0.16.0);
  - `tmp/research/csgrs-PORTING_PLAN-2026-05.md` (PORTING_PLAN.md at merge `570a658b`, 2026-05-15, 2,093 lines).
- Author: Timothy Schmidt (1,165 commits). Others: TimTheBig 40, mvdnet 9, qthree 6, …; BSP optimizations were pulled from ryancinsight's fork.
  - Development is explicitly **agent-driven**: `AGENTS.md` contains pre-push rules for coding agents. PORTING_PLAN tells agents: "After every successful commit and push, take another implementation turn against the next incomplete item in this plan" (DOCUMENTED).
- License: **MIT** (`gh api`, `Cargo.toml`). Porting code or ideas needs only the copyright notice. Dependencies are MIT or Apache-2.0 (see the hypermesh note).
- Status (DOCUMENTED, 2026-09-22):
  - 255 stars, 33 forks, 5 open issues. Created 2025-01-05, last push 2026-09-17.
  - Cargo version 0.23.0, edition 2024, rust 1.95. About 20k lines in `src/`.
  - **crates.io stops at 0.20.1 (2025-07-24, the BSP era)**, 42.7k downloads total. The Hyper-based 0.21-0.23 is unpublished and depends on sibling path crates (`hypercurve = { path = "../hypercurve" }`). So the README's `cargo add csgrs` currently installs the old BSP library (INFERRED from crates.io and `Cargo.toml`).

## What it is

**Now (2026-07 onward)**: a thin modeling language over the Hyper workspace.
- `hypercurve` owns 2D regions/curves and certified planar Booleans.
- `hypermesh` owns `TriangleMesh`, certified solid Booleans and queries.
- `hypertri` owns triangulation.
- `hyperreal::Real` is the scalar: exact rationals plus lazy computable/symbolic reals.

README: "Primitive floats occur only at explicit rendering, serialization, adapter, FFI, and WebAssembly boundaries."

Curved solids (sphere, cylinder, torus …) are **tessellated** into exact triangle meshes. Vertex coordinates can be irrational `Real`s built from `Real::pi()` and trig (`solid.rs:279`). There are no analytic surfaces and **no STEP**. I/O covers STL, OBJ, PLY, AMF, glTF, VRML, DXF, SVG and Gerber.

**Before (2025-01 to 2026-05)**: a Rust port of Evan Wallace's **csg.js**. Polygons were stored in BSP trees with f32/f64 `Real` and an absolute `EPSILON` (v0.16: `1e-5` for f32, `1e-12` for f64, `src/float_types.rs`). There was a `geo`-based 2D subsystem, nalgebra/parry/rapier integration, and earcut triangulation.

## How it works

### BSP era (historical, `src/plane.rs`, `src/bsp.rs` at v0.16.0)

- Classic csg.js: `Plane::split_polygon` classifies each vertex as FRONT, BACK or COPLANAR with `t < −EPSILON` / `t > EPSILON`, splits spanning polygons, and uses `clipTo`/`invert`/`build` to realize union, difference and intersection.
- Everything depends on one global absolute epsilon.
- The parallel BSP used `rayon::join` recursion. That overflowed the stack, and the fix replaced it with iterative approaches (commit `b14c42c7`, 2025-07-10, from ryancinsight).

### Migration (DOCUMENTED timeline, `gh search commits`)

- 2026-05-12/14: `hyperreal` branch merged (PR #118, #119, `570a658b` "Merge hyperreal into main").
- 2026-05-22: `e95d8940` "Remove BSP mesh core" (−978/+287 lines).
- 2026-06-26: hypermesh views for exact queries.
- 2026-07-02: `d1112faa` "Use hypermesh booleans **without fallback**".
- 2026-07-12: exact Hypermesh hulls.

PORTING_PLAN's phased method (`csgrs-PORTING_PLAN-2026-05.md`):
1. **Audit** every f64/epsilon predicate and guard (§"Phase 1").
2. Build a predicate crate (`hyperlimit`) with an *approximate f64 backend* that reproduces or exceeds the old behavior, and centralize every epsilon there. `decorum` (total-ordered, hashable floats) was evaluated as a bridge.
3. Replace call sites and "rip out local epsilon guards" (§"Phase 5").
4. Swap the backend to exact `hyperreal`. The whole swap is then a "backend upgrade instead of a simultaneous semantic and API rewrite".

The plan also lists **numeric anti-patterns** to encode as tests and lints (L1821-1850):
- fixed epsilon too large near the origin and too small far away;
- machine epsilon mistaken for model tolerance;
- non-transitive approximate equality used as an equivalence relation;
- NaN in sorts giving nondeterministic topology;
- raw floats as hash keys;
- scale changing the Boolean result.

It also proposes demos: "translate-to-break", "scale-to-break", near-cocircular, endpoint-on-segment.

### Current API surface

- **`GeometryContext`** (`src/context.rs`) is the immutable predicate policy per operation: `STRICT` (certified only) or `APPROXIMATE_512` (Hyperlimit's terminal 512-bit interpretation allowed).
- **`GeometryOutcome<T> { value, certainty }`** where `GeometryCertainty ∈ {Certified, Approximate512Consumed}` is the *weakest* certainty consumed while computing the value. `GeometryDecisions::observe` downgrades it monotonically. Every `try_*_with_context` Boolean returns one.
- **Fallible everything**: `try_union/try_difference/try_intersection/try_xor` return `HypermeshResult`, and constructors return `Result<…, ValidationError>`. There is no silent repair.
- **`AttributedMesh<M>`** (`src/attributed.rs`, feature `attributed`) is a sidecar with *exactly one* metadata row per triangle and optional authored normals per position. It is checked by `AttributeAlignmentError`.
  - "Modeling operations still consume its `TriangleMesh` geometry". Metadata never influences predicates.
  - `exact_gpu_mesh_buffers` is declared a "rendering boundary only".
- **Part metadata** (`src/parts/metadata.rs`) carries certainty taxonomies:
  - `SourceCertainty {Exact, Certified, Lossy, DisplayOnly, Missing}`;
  - `GeometryCertainty {NativeExactCsg, CertifiedImported, LossyPreviewMesh, DisplayOnly, Missing, Stale}`.

  Rule: "downstream Hyper crates do not infer physical or electrical facts from display geometry". `PCB_MIGRATION.md` enforces the same boundary against `hypercircuit`.
- **Retained primitives** (`solid.rs:33 retained_primitive`): a 32-entry thread-local cache keyed by exact constructor parameters, so repeated `sphere(r, n, m)` calls reuse the same exact mesh. It feeds the "warm" benchmark rows.

## Robustness and guarantees

- Current: certified-or-typed-error, inherited from hypermesh and hyperlimit (see the hypermesh note for what is proven). Floats appear only at declared boundaries. Certainty is tracked per result.
- `adversarial.txt` (DOCUMENTED invariants):
  - finite input never yields non-finite output;
  - indices are valid;
  - bounds enclose the geometry;
  - Boolean identities hold on empty and identical operands;
  - closed-manifold inputs give "a valid result or a typed diagnostic; they must not hang, panic unexpectedly, or allocate without a configured bound";
  - repeated runs are deterministic;
  - the full-resolution 11,894-triangle fixture "must remain active … do not replace it with a reduced proxy".
  - Boolean case matrix: disjoint, contained, identical, tangent, coplanar, nearly coplanar, sliver, disconnected, inverted, open, duplicate-triangle, invalid-index.
- Fuzz targets (`fuzz/fuzz_targets/`) cover mesh Boolean pairs, curve Boolean pairs, extrude/revolve/sweep, the shape catalogue, DXF, Gerber, and a "mesh bytecode".
- **Not guaranteed**: bounded memory under chained exact Booleans (see the 116 GiB item below). Tessellated curved surfaces are only faceted approximations; the tessellation deviation is controlled by segment counts, not tolerances.

## Parallelism and performance (DOCUMENTED, `PERFORMANCE.md`, self-measured, July 2026)

- Final serialized competitive run over 54 workloads:
  - csgrs won 46/54 against CGAL EPECK and 53/54 against tight-tolerance OpenCascade;
  - geometric-mean runtime 0.789× of the previous baseline;
  - 4,512-triangle YeahRight union/intersection/difference took 20.45/11.89/12.58 ms, down from 18.50/17.72/18.00 **seconds** before the fixture and "lazy plane-evidence handoff" fixes.
- Rust matrix: csgrs wins the 3,072-triangle subdivided-box Booleans (about 3 ms). It **loses** the 4,512-triangle YeahRight rows to boolmesh and manifold-rust (2.70-3.70 ms), and wins only the 3 disjoint-box cases among the 12 small Booleans: "the exact general path remains the principal small-overlap deficit".
- Genus-131 import: 16.72 ms, against 5.75 ms for boolmesh and 5.17 ms for manifold-rust.
- Parallelism: BSP-era rayon. The current exact path's parallelism lives in hypermesh (see that note).

## Known failures, limitations, war stories (BSP era unless noted)

- #8 (https://github.com/timschmidt/csgrs/issues/8): subtracting two equal-height coaxial cylinders loses the top and bottom caps (coincident faces). The workaround was to make the tool taller. This is the *coplanar-cap* failure every FDM user hits.
- #21 and #110: `Node::from_polygons` / BSP `build` infinite recursion causes a stack overflow on rotated slicer cubes and valid frustums. It was "fixed" in 2025-04, then "not quite solved" (PR #48). In 2026-05 the author answered #110: "This is likely an epsilon tolerance issue. If you increase the size of epsilon … Long-term fixes inbound."
- #107 (atomCAD): 6 big half-space squares fail to intersect when a normal is "a tiny-tiny bit different". It was fixed by **editing EPSILON from 1e-8 to 1e-6 in a vendored fork**, and the user asked for EPSILON to be configurable. This is a textbook global-epsilon failure.
- #38, #84: non-manifold output (cube with a tube; extruded text). #25: NaNs when tessellating polygons with a repeated origin vertex. #10: union/intersection swapped.
- Hyper era (DOCUMENTED, PERFORMANCE.md): a rotated-copy full-resolution intersection "previously reached about 116 GiB RSS". It is now kept only as an ignored memory-ceiling test. Unbounded exact arithmetic moved the failure from wrong answers to resource exhaustion.
- Author on HN (2026-03-22, https://news.ycombinator.com/item?id=47482313): "computing with numbers isn't really even a solved problem yet". He cites Boehm's "Toward an API for the Real Numbers" (PLDI 2020) as the model behind hyperreal.

## Relevance for wonky

1. **The cautionary tale is the main value.** A popular hobby CSG kernel spent 16 months on epsilon BSP. It failed on exactly the configurations wonky's FDM parts produce (coplanar caps, flush faces, near-parallel planes, rotated cutters). It then threw the core away for exact predicates. This is independent evidence for wonky's "no global epsilons, exact predicates, fail explicitly" rules (INFERRED from the documented issue history).
2. **The migration method is directly reusable** for wonky's own tolerance debt (special-case Booleans, sketch solver):
   - (a) inventory every tolerance comparison;
   - (b) route them through one predicate module with named semantics (absolute/relative/scaled);
   - (c) make that module's backend swappable, e.g. F32x2 filter → U32-limb exact.

   In Bend, one predicate module used by the JS, C and Metal builds is also what keeps the backends bit-identical.
3. **API ideas to adopt**:
   - Per-result certainty: `GeometryOutcome` with monotone "weakest certainty consumed". Wonky could return `{value, certainty: Exact | Filtered | Toleranced(ε_mm) | Heuristic}` on every feature. That fits its introspection and LLM-review goals, since an agent can see *why* a result is trustworthy.
   - Typed errors instead of repair, which matches "unsupported cases must fail explicitly".
   - The certainty taxonomy for metadata (`Exact / Certified / Lossy / DisplayOnly / Missing / Stale`), useful for FeatureScript attributes and imported references.
   - Sidecar attributes that never affect predicates. Wonky's per-triangle face-id tags in the analytic-recovery hybrid should follow the same discipline: tags steer recovery, never classification.
4. **Test assets**: the adversarial case matrix and the numeric anti-pattern list (`adversarial.txt`, PORTING_PLAN L1821-1890) map one-to-one onto a wonky Boolean test plan. Also adopt the rule: "never replace the full-resolution hard case with a reduced proxy".
5. **Numeric model does *not* fit Bend**: `hyperreal` means unbounded rationals plus lazily refined computable reals. That needs heap-growing big numbers, data-dependent refinement loops and non-uniform work, so no GPU, and it led to 116 GiB RSS.
   - Wonky should instead bound bit-lengths up front: integer-grid inputs, construction-free predicates (Cherchi/Attene LPI/TPI, EMBER planes) and a fixed limb count per predicate (INFERRED).
   - The 512-bit "terminal" policy in hyperlimit is the one piece that resembles a fixed-limb design (16 U32 limbs), but it is labeled *approximate*.
6. **Retained primitive cache**: memoize exact constructions by exact parameters. This is trivially expressible in Bend as a pure memo keyed by a parameter hash, and pays off for FeatureScript regeneration where most features are unchanged between edits (INFERRED; ties into wonky's diff and provenance work).
7. **Scope mismatch**: tessellation-only curved geometry and no STEP. csgrs is not a model for wonky's exact analytic B-rep, only for the mesh-Boolean layer and for process.

## Pointers worth porting or studying

- `src/context.rs`: `GeometryContext`, `GeometryOutcome`, `GeometryDecisions::observe` (certainty aggregation).
- `src/attributed.rs`: the alignment-checked sidecar.
- `src/parts/metadata.rs`: source and geometry certainty enums.
- `adversarial.txt`: invariants, the Boolean case matrix, and resource and regression gates.
- `tmp/research/csgrs-PORTING_PLAN-2026-05.md`: the phased epsilon→exact plan (L1-120, "Phase 1…5", L1815-1890 anti-patterns and demos).
- BSP-era failures for regression fixtures: #8 (coaxial equal-height cylinders), #21 (rotated slicer cube, repro in the issue), #107 (six-plane cube from near-parallel planes), #110 (frustums).
- `PERFORMANCE.md` L660-687: honest crossover data (exact vs manifold-rust/boolmesh).
- `tests/competitive.rs`, `benchmarks/rust/*.rs`: the competitive harness shape (CGAL EPECK, OCCT, Manifold, boolmesh, Solidean comparisons).

## Verdict: learn-from

Adopt the *process and API patterns*: certainty-tagged outcomes, typed errors, sidecar metadata, adversarial matrix, phased epsilon removal. Also absorb the documented lesson that epsilon BSP collapses on coplanar CAD cases.

Do not adopt the geometry or numerics:
- no analytic surfaces;
- unbounded exact reals are incompatible with Bend's fixed-width U32/F32 and uniform-GPU model, and are memory-unsafe on chained Booleans;
- the current version is unpublished, single-author and agent-written, with self-reported benchmarks.
