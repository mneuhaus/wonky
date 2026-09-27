# Spatial blog: Seven Years of Thread Safe 3D ACIS Modeler

- **Kind / canonical URL:** vendor engineering retrospective, [Seven Years of Thread Safe 3D ACIS Modeler](https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler) [S]. Read the entire article body, not just search excerpts.
- **Organization / date — DOCUMENTED:** Spatial; displayed author is ADMIN; published 2016-04-27. It looks back to thread-safe ACIS R20, released summer 2009. [S](https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler).
- **License — DOCUMENTED / limitation:** vendor web article with no open-source license or source code supplied. ACIS implementation is not made available here; reuse the engineering lessons through independent design, not embedded ACIS. No patent-clearance conclusion follows from the article. [S](https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler).
- **Status / maturity:** historical 2016 snapshot still accessible on 2026-09-24. Not a maintained repository or current API contract; commit dates, stars, contributors, source language/size and release cadence are not applicable. Statements about 20+ years of algorithm use and seven years of thread safety are vendor reports, not an independently audited reliability corpus. [S](https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler).

## What it is

**DOCUMENTED:** ACIS's evolution from serial algorithms to safe independent workflows and selected internally multithreaded “thread hot” APIs. The article defines thread-safe as operating **on disjoint data concurrently and correctly**, not arbitrary concurrent writes to one shared model. Its message is conservative refactoring and careful work granularity, not that more threads automatically improve geometry throughput. [S, opening and “Speedups” section](https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler).

## How it works

**DOCUMENTED architectural contracts:**

1. **Each participating thread initializes ACIS.** A caller cannot treat the modeling context as process-global initialization alone.
2. **Modified ENTITYs must belong to different history streams.** Disjoint memory/entity sets alone are not the complete stated condition; history/undo state is also an ownership boundary.
3. **Thread-local storage (TLS)** retains per-thread context without locks/mutexes everywhere. The article does not say that all shared state disappears or that ACIS is lock-free.
4. **Selected APIs own internal parallel work.** Applications can enable a thread pool rather than manually coordinates their internals. `api_facet_entity` is the concrete example.
5. **Refactoring strategy:** preserve serial behavior as far as possible, accept useful nonideal speedup, and avoid changing the proven geometry algorithm unnecessarily. `api_stitch` is a counterexample to purely mechanical parallelization: it was redesigned and its new serial implementation also improved. Spatial's 3D InterOp is reported to exploit concurrent ACIS entity import. [S, “Speedups with Thread-Safe 3D ACIS Modeler and Thread Hot APIs”](https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler).

**DOCUMENTED:** four scaling categories are described: ideal inverse scaling, Amdahl-style fixed serialized work, contention/overhead increasing with thread count, and no speedup. Overhead can make the threaded path slower at every thread count. **INFERRED restatement:** T(P)=T_serial+T_parallel/P+T_overhead(P) is a useful measurement model, but the article gives no fitted coefficients or detailed scheduler/data-structure description. [S, “Challenges with Multithreading”](https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler).

**Numeric model:** no floating-point precision, predicate arithmetic, tolerance value or geometric representation implementation is disclosed. This article cannot establish that ACIS depends on f64, or that its algorithms port numerically unchanged to F32x2. [S, entire technical body](https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler).

## Robustness and guarantees

**DOCUMENTED:** Spatial says it preserved serial behavior “as much as possible,” and describes parallel faceting output as **nearly indistinguishable**, not bitwise identical. “Not compromising” model integrity is a vendor assertion; no formal proof, race-verification method, degeneracy tests, tolerance table or failure-rate statistics accompany it. The guarantees actually specified in the article are conditional on separate history streams and per-thread initialization. [S](https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler).

**INFERRED:** determinism, race freedom, manifoldness and geometric equivalence are separate acceptance criteria. A visual match or matching volume does not prove unchanged topology/provenance. Wonky should compare these independently when enabling native/GPU paths. [S, serial-preservation and faceting discussion](https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler).

## Parallelism and performance

**DOCUMENTED reported measurements:**

| Workload | Reported configuration | Reported benefit | What is missing |
|---|---|---|---|
| `api_facet_entity`, one BODY | Six threads | About 2× speedup | Mesh/model complexity, CPU, memory, absolute times, tolerance, repeated trials |
| Concurrent faceting of multiple bodies | “Many-core processors” | 6× or 7× | Number of threads/cores/bodies and load distribution are unspecified |
| Redesigned `api_stitch` | New serial algorithm against old serial algorithm | 10% faster serially | No multithreaded stitch speedup, absolute time, model or hardware |

All figures come from [S, paragraph starting “For the initial implementations”](https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler). The multiple-body result is workload throughput, not evidence that any one body's operation runs seven times faster. The 10% stitch number is **not** a threading result. These are anecdotal vendor measurements, not reproducible benchmarks run in this research.

**Correction to an overbroad interpretation — INFERRED:** this does **not** prove that commercial kernels “only” parallelize across independent bodies/faces: the article itself reports a single-body internally parallel operation. It supports coarse independent work as a productive opportunity, while leaving the maximum possible speedup and the internals of Boolean/fillet algorithms unknown. [S](https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler).

## Known failures, limitations, war stories

**DOCUMENTED:** some APIs still exhibit increasing linear overhead; pragmatic serial-preserving refactors can scale worse than a redesign; small tasks can lose to scheduling costs; initialization/history-stream restrictions limit caller-level concurrency. There are no specific crash/race issue links or public regression cases in this source. Statements explaining historical multicore-market trends are opinion/background, not evidence for wonky's scheduler. [S, “Challenges” and final paragraph](https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler).

## Relevance for wonky

**INFERRED, strong architectural fit:**

- **Translate TLS into explicit immutable task context**, not an emulated mutable global: tolerances, precision mode, source/provenance scope, scratch ownership and diagnostics travel with each fork. Bend's no-mutation model helps avoid races but does not automatically make ID allocation, error aggregation or result ordering deterministic.
- **Partition by ownership and independence:** separate bodies/components, independent face-pair queries or meshing patches are good initial tasks; topology assembly and overlapping edit sets require a controlled join. The ACIS history-stream restriction is a reminder that hidden metadata can couple otherwise disjoint geometry.
- **Use balanced fork-join with a granularity threshold.** Estimate work by facet count, surface-pair type and expected refinement depth; avoid putting an expensive curved intersection opposite a trivial plane query. GPU batches should group fixed-format, similar-cost analytic evaluations rather than recursively launch irregular topology mutations.
- **Keep the proven serial path as an oracle during migration**, but validate exact/discrete semantics and numeric error bounds, not merely rendering. Compare one body and many bodies separately, including task setup, array copying, join cost and memory consumption. No performance experiment was run here because the machine's benchmark must not be disturbed.
- **Do not infer numeric safety from concurrency safety.** F32x2, U32-limb predicates and scale/tolerance rules need their own analysis. This source supplies an execution-contract lesson, not a robust Boolean, SSI or fillet algorithm.

These are proposed Bend adaptations of the source's explicit concurrency and measurement distinctions, not implementation claims about ACIS. [S](https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler).

## Pointers worth porting or studying

- The two caller restrictions in the paragraph beginning **“Even though the scaling…”**.
- The TLS and serial-preservation paragraphs beginning **“There were several keys…”** and **“For the initial implementations…”**.
- The separate one-body / many-body / serial-stitch measurements; preserve those three rows as distinct benchmark categories.
- The overhead warning and the final admission of nonideal scaling. All pointers refer to the [full article](https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler).

## Verdict: adapt

Adapt explicit task ownership, coarse independent work, serial-equivalence validation and honest per-workload benchmarks. Do not port TLS/mutation mechanisms literally, extrapolate the old vendor timings to Bend/Metal, or treat thread safety as a guarantee of geometric correctness.

## Sources and local evidence

- [Spatial original article, 2016-04-27](https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler).
- Local captures: `<repo>/tmp/research/commercial-kernels-2/spatial-thread-safe.html` and `<repo>/tmp/research/commercial-kernels-2/spatial-thread-safe.txt`.

