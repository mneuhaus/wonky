# Open Boolean Benchmark: boolean-benchmark-runners

- Kind: open-source benchmark harness (runner adapters plus JSON I/O contract), code repository.
- Canonical URL: https://github.com/Open-Boolean-Benchmark/boolean-benchmark-runners
- Other URLs: benchmark data https://github.com/solidean/bench-blog-data (MIT code, CC BY 4.0 meshes); result write-ups https://solidean.com/blog/2026/first-benchmark-results-iterated-csg/, https://solidean.com/blog/2026/iterated-cube-grid-benchmark/, https://solidean.com/blog/2026/terrain-carve-benchmark/, https://solidean.com/blog/2026/iterated-dome-carve-benchmark/.
- Authors/organization, year: GitHub org "Open-Boolean-Benchmark"; all 27 commits by Philip-Trettner (EMBER first author, Solidean/Shaped Code). Created 2026-03-29. DOCUMENTED (`gh api repos/Open-Boolean-Benchmark/boolean-benchmark-runners/contributors`, 2026-09-22).
- License: MIT for the harness. Each wrapped library keeps its own licence (GPL for CGAL, Carve, Blender, Mesh Arrangements; non-commercial for Solidean, Trueform, MeshLib, QuickCSG; BSD-3 for Geogram and VTK; MIT for IARMB; Apache-2.0 for Manifold). `build-all.py -y` means accepting all of them. DOCUMENTED (README, https://github.com/Open-Boolean-Benchmark/boolean-benchmark-runners/blob/main/README.md). Porting implication: the harness, protocol and smoke test are freely reusable; do not vendor the wrapped libraries into wonky.
- Status: 8 stars, 3 forks, 0 open issues, 0 issues ever filed, last commit a41f0d6 "added bbox check for smoke test" on 2026-06-08. Single maintainer. The meta-runner (case planner, correctness evaluation, aggregation) is referenced by the docs but not in this repo. INFERRED: meta-runner not yet published (the first benchmark post says "the runner programs that wrap each implementation are already open source", https://solidean.com/blog/2026/first-benchmark-results-iterated-csg/). DOCUMENTED for the metadata (`gh api`, 2026-09-22). Re-checked 2026-09-24: 9 stars, HEAD still a41f0d6, still 0 issues ever filed. No commit in 3.5 months while Solidean's own benchmark posts also stopped after 2026-07-02, so the project is dormant rather than active. DOCUMENTED (`gh api`, https://solidean.com/blog/); "dormant" INFERRED.

## What it is

A collection of standalone "runners", one per Boolean implementation and version, that all speak the same subprocess protocol: read `request.json`, run the listed operation chains, write `result.json`. It covers 17 variants: Blender exact/fast 5.1, Carve 2014-9, CGAL 6.1.1 corefine (EPEC) and Nef (exact homogeneous integer, plain and regularized), Geogram 1.10.0, Interactive and Robust Mesh Booleans (IARMB) 2024-6, Manifold 3.4.0, mcut 1.3.0, Mesh Arrangements 2.6.0, MeshLib 3.1.1.211, QuickCSG 2022-10, Solidean 2026.1, Trueform 0.7.0, VTK 9.6.0 BoolOp and LoopBool. DOCUMENTED (README table).

Capability legend (self-reported by each project, "not independent verification"):
- E, exact arithmetic: "exact constructions, not just predicates. Operations like (A \ B) u (A n B) == A hold exactly."
- R, robust within stated preconditions.
- I, "Stable under repeated/iterative operations: the result is usable for additional booleans without loss of information. Methods that output indexed float/double triangle meshes generally cannot claim this unless specifically designed for it."
- S, supports self-intersecting input by design.
DOCUMENTED (README).

Self-reported ratings: Solidean E R I S; CGAL Nef E R I S; CGAL corefine E R I; Geogram E R S; Mesh Arrangements E R S; Trueform R I S; Manifold R I; Carve R; IARMB R; mcut R; Blender, MeshLib, QuickCSG, VTK none. Planned: an "N" letter for non-manifold handling, pending a correctness definition. DOCUMENTED (README table and TODOs).

## How it works

- Folder layout `<family>/<version>/[<algorithm>/][<material-variant>/]` with `runner.yaml` (mandatory), `build.py` (uv inline-script shebang, `uv run build.py`), optional `CMakeLists.txt`, `vcpkg.json`, `src/main.cc`, `patches/`. `bin/build-info.json` records resolved provenance (commit, compiler, patches). DOCUMENTED (https://github.com/Open-Boolean-Benchmark/boolean-benchmark-runners/blob/main/docs/Runner%20Overview.md, docs/Build Script Spec.md).
- Runtime variants (thread count, repair toggles, preconditions) vs folder variants (different algorithm family or build). The "honesty rule": if a variant narrows preconditions, its capabilities must say so, because the meta-runner uses them for case selection. DOCUMENTED (docs/Runner Manifest Spec.md).
- Capabilities parsed by the meta-runner: `operations`, `requires_closed_meshes`, `accepts_self_intersections`, `accepts_non_manifold_inputs`; hints: `input_formats`, `supports_components`, `supports_variadic_booleans`. DOCUMENTED (same).
- Request: `{kind:"boolean-benchmark", version:1, id, system_snapshot, runs:[{case_id, out_dir, out_format, bounding_box:{min,max}, operations:[...]}]}`. Operations are SSA: `load-mesh {path}`, `boolean-union|intersection|difference {args:[i,j,...]}`; 1 arg = self-operation (self-union regularization), 3+ = variadic (binary-only runners return `unsupported`). The `bounding_box` over all loaded inputs is supplied "to size exact-arithmetic / spatial structures". DOCUMENTED (https://github.com/Open-Boolean-Benchmark/boolean-benchmark-runners/blob/main/docs/Runner%20IO%20Contract.md).
- Output: every op (including loads) written as `op_<N>.<ext>`; formats `obj` (mandatory), `raw-f64` (unrolled, 9 doubles per triangle), `raw-f64-i32` (indexed with u32 counts header). DOCUMENTED (same).
- Timing fields with explicit inclusion policies: `io_ms`, `import_ms`, `operation_ms`, `export_ms`, `preprocessing_ms` (reusable per-handle prep only, never pair-specific), `debug_total_ms` (diagnostic, includes disk write). The docs deliberately give no `total_ms`; recommended compositions: end-to-end = sum(import) + sum(operation) + last export; composable pipeline = sum(import) + sum(operation); per-op core = sum(operation). DOCUMENTED (same).
- Status values: `success`, `timeout`, `crash`, `invalid_input`, `invalid_output`, `unsupported`; failures must be reported via status plus error, and the exit code must be nonzero. Results flushed every ~10 s via tmp+rename because the meta-runner watchdog may SIGKILL. DOCUMENTED (same; `_common/cpp/include/runner_utils/run_loop.hh`).
- Shared header-only C++20 helpers: OBJ/OFF/STL/raw readers and writers, `validate_op_boolean_binary`, timers, run loop. DOCUMENTED (`_common/cpp/include/`).
- Smoke test `run-smoke-test.py`: unit cube minus a cube translated to corner (1.1,1.2,1.3); checks volume, area and bbox (bbox check distinguishes A-B from B-A, which have equal volume). DOCUMENTED (run-smoke-test.py, tests/smoke/).
- Per-runner notes document raw formats and what timers include. Examples: Solidean and Trueform are float32 internally at the I/O boundary (`indexed-tris-f32`); Manifold, Geogram and IARMB are f64. IARMB is compiled with `-frounding-math` or `/fp:strict` and AVX2. Geogram, Manifold, IARMB and Trueform declare `accepts_self_intersections: false`; Solidean declares true; all declare `accepts_non_manifold_inputs: false`. DOCUMENTED (runner.yaml files under solidean/2026.1, trueform/0.7.0, geogram/1.10.0/boolean, interactive-and-robust-mesh-booleans/2024-6, manifold/3.4.0).

### Letters vs manifests (checked 2026-09-22, HEAD a41f0d6)
The README letters and each runner's `capabilities` block are separate self-reports, and they disagree in places. DOCUMENTED (all 17 `runner.yaml` files grepped):
- `accepts_self_intersections: true` appears only for Solidean, CGAL Nef, Mesh Arrangements and Blender.
- Geogram (E R S) and Trueform (R I S) carry the S letter, yet their runners declare `accepts_self_intersections: false`. So the case planner never sends them self-intersecting input, and their S is never exercised by this harness.
- `supports_variadic_booleans: false` in every runner, including libraries with native N-ary Booleans (Manifold, Geogram, IARMB, Solidean, trueform). The current cases are pairwise SSA chains only. N-ary strength, such as trueform's build-once/query-many, is invisible here.
- `requires_closed_meshes: false` appears only for Blender and MeshLib.

Implication: read a letter as "claimed", and a manifest flag as "what this harness actually tests". A wonky runner should keep the two identical. INFERRED.

### What a wonky runner would test (INFERRED)
- Inputs are plain indexed triangle meshes (OBJ/OFF/STL) with no analytic surface tags.
- So a wonky runner exercises only the mesh-Boolean stage of each bake-off candidate: tagged-mesh SoS, plane-based exact, or SDF. It does not exercise the analytic B-rep recovery of the hybrid.
- The request's `bounding_box` over all inputs is exactly what a global-lattice design needs, as in Solidean and trueform: fix the integer lattice or F32 grid once per run, and quantize the f64 OBJ input onto it.
- Output must be f64 OBJ/raw, so the lattice converts back at export.

## Robustness and guarantees

The harness makes no claims about Boolean robustness itself. It gives reproducible provenance (exact refs, build-info.json) and a protocol that separates a library's failures (`crash`, `invalid_output`, `unsupported`) from harness failures. Correctness judgment (canonical vs wrong) is done by the unpublished meta-runner or by blog analysis: e.g. terrain-carve canonical values are the 4-decimal agreement of the three exact-construction methods (Solidean, CGAL corefine EPEC, CGAL Nef). DOCUMENTED (https://solidean.com/blog/2026/terrain-carve-benchmark/).

## Parallelism and performance

Runners own their threading; thread count is a runtime variant arg, not a request field. Timing semantics are designed so per-op core cost is comparable only because `preprocessing_ms` excludes pair-specific work. DOCUMENTED (Runner IO Contract). Published results, vendor hardware Ryzen 9 5900X: iterated cube grid 1999 ops, Solidean 0.98 s, Trueform 4.1 s, Manifold 5.3 s, Geogram 1.10.0 112 s (Geogram 1.9.8 ~37 min); 9 failed of 18. DOCUMENTED (https://solidean.com/blog/2026/iterated-cube-grid-benchmark/).

## Known failures, limitations, war stories

- Conflict of interest: the only maintainer is the author of the top-ranked commercial product, and capability letters are self-reported. The code is open and anyone can rerun it, which mitigates this. INFERRED.
- Metadata drift: the Solidean `runner.yaml` notes say each op re-imports float32 data, but `src/main.cpp` keeps `solidean::Mesh` handles in its SSA vector. Notes are hand-maintained and can go stale. DOCUMENTED (both files).
- No non-manifold capability letter yet. The cube-grid checkerboard creates edge-adjacent (non-manifold) intermediates, which CGAL corefine rejects by design. DOCUMENTED (README TODO; cube-grid post).
- Full build takes 30+ minutes cold, plus 60+ minutes for the vcpkg pre-warm. DOCUMENTED (README quickstart). Not runnable on this machine while the CPU benchmark is running.
- No issues were ever filed, so there is no external validation trail yet. DOCUMENTED (`gh api .../issues?state=all` returned none).
- Versions go stale fast. Trueform is pinned at 0.7.0, but upstream reached 0.10.5 on 2026-09-21 with a rewritten engine. Its own paper reports trueform fastest on 1000/1000 pairwise cases against the same competitors, EMBER/Solidean included, under a different timing protocol that includes arrays in and out and structure builds (arXiv 2607.15905). Rankings from this harness are version- and protocol-specific. DOCUMENTED (`gh api repos/polydera/trueform/releases`; trueform note), INFERRED conclusion.

## Relevance for wonky

- This is the obvious external yardstick for the Boolean bake-off. A wonky runner that calls the Bend kernel and speaks request.json/result.json puts every candidate (Manifold-style SoS, EMBER-style plane-based, libfive SDF, tagged-mesh B-rep recovery) on the same axes as 17 existing implementations, with the same timing semantics. INFERRED.
- `entry.kind` may be an executable or `python-uv`, so a Bend-built binary or a thin uv script works. No FFI or linking into wonky is needed: the runner is an out-of-tree subprocess, consistent with wonky's no-linking rule. INFERRED (docs/Runner Manifest Spec.md).
- The E/R/I/S letters are a compact way for wonky to state its own claims. Wonky's explicit-failure principle maps onto the status values (`invalid_input`, `unsupported`), not onto best-effort output. INFERRED.
- The cube grid (all integer-aligned, fully verifiable at every step), terrain carve (exactly coplanar seams), dome carve (scaling to 1e5 ops) and the smoke test are directly usable regression cases for wonky's tagged-mesh pipeline. INFERRED.
- Output formats are float64 meshes. A B-rep result must be exported to triangles for comparison, so the harness measures the mesh stage only. INFERRED.

## Pointers worth porting or studying

1. docs/Runner IO Contract.md: adopt the SSA operation list and the status vocabulary for wonky's own Boolean test driver.
2. Timing composition rules (import/operation/export/preprocessing) for honest internal benchmarks.
3. run-smoke-test.py `mesh_stats` (divergence-theorem volume, area, bbox) as the minimal correctness oracle, plus the bbox trick that tells A-B from B-A.
4. Honesty rule plus capability flags: declare wonky's input preconditions (closed, manifold, self-intersection) explicitly.
5. The bench-blog-data meshes (CC BY 4.0) as a corpus alongside Thingi10K.
6. The per-library runner.yaml notes as a quick cross-reference of what each library assumes (f32 vs f64, preconditions, compile flags).

## Verdict: adapt

Use it with light adaptation. Add a wonky runner out-of-tree, and reuse the protocol, timing rules, smoke test and data sets for the bake-off. Nothing needs to be ported into the kernel itself. The MIT licence allows all of this. Treat the published rankings with care: the maintainer is a vendor, capabilities are self-reported, and the correctness-judging meta-runner is not public.
