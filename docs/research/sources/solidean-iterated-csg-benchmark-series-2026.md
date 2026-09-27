# Solidean iterated-CSG benchmark series (2026)

- Kind: vendor blog series plus open benchmark data and harness.
- Canonical: https://solidean.com/blog/2026/iterated-cube-grid-benchmark/
- Posts:
  - https://solidean.com/blog/2026/first-benchmark-results-iterated-csg/ (2026-05-28)
  - https://solidean.com/blog/2026/terrain-carve-benchmark/ (2026-06-12)
  - https://solidean.com/blog/2026/iterated-cube-grid-benchmark/ (2026-06-18)
  - https://solidean.com/blog/2026/iterated-dome-carve-benchmark/ (2026-07-02)
- Data: https://github.com/solidean/bench-blog-data
- Unpublished study: https://github.com/solidean/bench-iterated-sweeps-study
- Harness: https://github.com/Open-Boolean-Benchmark/boolean-benchmark-runners
- Local copies: tmp/research/solidean-blog/*.txt, tmp/research/solidean-iterated-csg-benchmark-series-2026/bench-iterated-sweeps-study/.
- Authors/org: Philip Trettner, Shaped Code GmbH (Solidean vendor; first author of EMBER). 2026.
- License:
  - Blog text © Shaped Code.
  - bench-blog-data: code MIT, meshes CC BY 4.0 ("unless otherwise specified").
  - bench-iterated-sweeps-study: MIT (© 2026 Philip Trettner).
  - Runners: MIT (DOCUMENTED, repo READMEs/LICENSE).
  - Implication: all cases, meshes and scripts can be copied into wonky's test fixtures with attribution (CC BY 4.0 for meshes). No kernel code is involved.
- Status and activity (DOCUMENTED, `gh api` and the blog index, re-checked 2026-09-24):
  - No new benchmark post after 2026-07-02 on the live blog index. The newest posts are the four benchmarks; the one before is the SIGGRAPH 2026 winding-number paper announcement (2026-05-07).
  - bench-blog-data: created 2026-06-08, last commit 2026-07-01 ("added data for the upcoming iterated dome carving benchmark"), 2 stars. Dome data is uploaded only up to 5000 steps (`dome10-through-5000.7z`); higher counts are "on request".
  - bench-iterated-sweeps-study: created 2026-04-02, last commit 2026-04-09, 1 star, README quickstart still "TODO".
  - Runners: 9 stars, last commit 2026-06-08 ("added bbox check for smoke test").

## What it is

The only public, reproducible data on how mesh Boolean engines behave on **long sequential chains**, where each output feeds the next operation. It uses the same 17-19 runner wrappers and one timing definition throughout. There are four published cases and one unpublished study.

| case | ops | stressor | canonical reference | survivors |
|---|---|---|---|---|
| 1. First results | 9 subtractions: icosphere A (20,480 tris) − 3 tori (16,384 each) − 6 icospheres (5,120 each), coords in [−1.5, 1.5]³, ~100k input tris, ~33k output tris | near-concentric curved primitives: near-tangent edges, near-coplanar faces | area 13.4224, volume 2.3513, "correct" = 4 decimals, "~correct" within ~1% | 8 correct + 4 ~correct of 17 |
| 2. Terrain carve | 223 sphere-sweep subtractions from a cube along a heightmap, each tool ~380 tris | consecutive sweeps meet exactly, so the classifier sees **exactly coplanar seams** | area 6.1648, volume 0.5477 = agreement of the only exact-construction engines (Solidean, CGAL corefine EPEC, CGAL Nef) | **4 of 17** |
| 3. Cube grid | 10×10×10 unit cubes: union even-parity cubes, union odd, subtract even, subtract odd = **1999 ops**, correct final result is the empty set | integer-aligned contact along faces, edges and corners; **non-manifold intermediates** (even cubes touch only along edges: 4 faces per edge) | exact per-step oracle: the expected shape is known after every op, and a run is canonical only if all 1999 steps match | **9 of 18** |
| 4. Dome carve | capsule subtractions carving a half-dome at 10, 100, 250, 1000, 5000, 10k, 100k, 200k steps; 1 h budget | pure scale: running mesh grows while the cut stays local | exact-construction agreement to 1e-4 relative (all through 250; CGAL corefine through 5000; Manifold through 10k; beyond that Solidean alone plus converging volume) | 12 → 8 → 7 → 4 → 3 → 2 → **1 at 100k** of 19; none within budget at 200k |
| 5. Sweep study (unpublished) | swept capsules 10/100/1000, swept cylinders 227 | swept machining | ground truth = runners named "solidean" or "cgal nef"; step correct iff success, `total_defect == 0` and area/volume within 10% of a reference (`chart_helpers.py`) | no results published |

(DOCUMENTED, the four posts and the repository files.)

## How it works

- **Protocol.** SSA operation lists in `request.json` (`load-mesh`, `boolean-difference {args:[i,j]}`, …), with a scene `bounding_box` given to every runner. Example: `blog/2026/first-benchmark-results-iterated-csg/primitives.request.json` in bench-blog-data. Harness details are in `open-boolean-benchmark-boolean-benchmark-runners.md` (DOCUMENTED).
- **Timing.** "Time" = import (indexed triangles to internal structure) + Boolean operations. It excludes file IO and export, and every mesh is used once.
  - Rel. and Mtris/s columns appear only for canonical runs: "A wrong or crashed run often computed something easier … would compare against a different problem" (DOCUMENTED, cube-grid post).
- **Hardware.** Ryzen 9 5900X (12 cores), 64 GB DDR4-2666, Windows 11; libraries free to multithread (DOCUMENTED, first post).
- **Versions.** Blender 5.1 exact/fast, Carve 2014-9, CGAL 6.1.1 corefine (EPEC) and Nef, Cork 2016-3, Geogram 1.9.8 (plus 1.10.0 from case 3 on), IARMB 2024-6, Manifold 3.4.0, mcut 1.3.0, Mesh Arrangements 2.6.0, MeshLib 3.1.1.211, QuickCSG 2022-10, Solidean 2026.1, Trueform 0.7.0, VTK 9.6.0 BoolOp and LoopBool. Default configurations throughout (DOCUMENTED).

### Results (DOCUMENTED, vendor-run)

- **Case 1:**
  - Correct: Solidean 27 ms, Trueform 85 ms, MeshLib 109 ms, Manifold 332 ms, CGAL corefine 507 ms, Mesh Arrangements 5.6 s, Geogram 32.4 s, CGAL Nef 477.7 s.
  - ~correct: QuickCSG 235 ms, Blender fast 670 ms, Carve 1.5 s, Blender exact 3.6 s.
  - Failed: VTK BoolOp wrong (+3.7% area); VTK LoopBool empty; mcut crash at op 4; IARMB and Cork no result.
  - The spread among correct runs is about 17,000×.
- **Case 2:**
  - Canonical: Solidean 205 ms, **Manifold 525 ms**, CGAL corefine 11.0 s, CGAL Nef 330 s.
  - Wrong:
    - VTK BoolOp empty;
    - QuickCSG volume −0.4388;
    - Carve right volume but ~+10.7% area (6.8216 vs 6.1648) from duplicated opposite-facing coincident faces;
    - Trueform inverted (area 16.28, volume −0.8181);
    - Blender exact degenerate (area 0.0026);
    - Blender fast open.
  - Crashed or no result: MeshLib crash at op 38, mcut op 4, Mesh Arrangements op 184 (~19 min), Geogram no result, IARMB "exit (needs rationals)", Cork and VTK LoopBool SIGSEGV.
- **Case 3:**
  - Canonical: Solidean 980 ms, Trueform 4.1 s, **Manifold 5.3 s**, Carve 23 s, Mesh Arrangements 62 s, Geogram 1.10.0 112 s, CGAL Nef 280 s, Blender exact 294 s, Geogram 1.9.8 ~37 min.
  - Failed:
    - VTK ×2 empty intermediate;
    - IARMB residual solid;
    - Blender fast residual zero-volume double-sided walls;
    - **CGAL corefine declined op 5** (the first time an incoming cube touches two placed cubes along edges; corefine documents that it requires a manifold output);
    - QuickCSG diverged at ~op 996;
    - MeshLib exit at op 554;
    - mcut no result;
    - Cork crash at op 5.
- **Case 4** (survivor bracket; time, peak memory):
  - 100 steps: Solidean 73 ms, Trueform 673 ms, MeshLib 957 ms, Manifold 1.1 s, CGAL corefine 3.3 s, Mesh Arrangements 47 s, CGAL Nef 262 s. Blender exact empty; Geogram no result.
  - 250: Trueform wrong.
  - 1000: Solidean 1.3 s / 226 MiB, Manifold 34 s / 55 MiB, CGAL corefine 157 s, MeshLib 219 s / 774 MiB. Mesh Arrangements and Nef timed out.
  - 5000: Solidean 12.4 s / 819 MiB, Manifold 442 s / 138 MiB, CGAL corefine ~44 min.
  - 10k: Solidean 26 s / 1.1 GiB, **Manifold ~20 min / 203 MiB**.
  - 100k: Solidean ~23 min / 7.9 GiB. Manifold timed out at op 17,257 (452 MiB).
  - 200k: Solidean ~97 min / 16.2 GiB (over budget).

## Robustness and guarantees

The series measures robustness; it proves nothing. The vendor's own guarantee claims (DOCUMENTED, cube-grid post):
- **Closure.** A "Solid" is any result boundable by topologically disjoint (possibly touching) manifold meshes, made by duplicating vertices on output. "Booleans are closed under that definition". Once inputs are valid, "every boolean combination of those inputs will succeed (subject only to CPU and memory limits)". "We have not had one of these [failures] in over three years".
- **Export.** Float export rounds, so exactness is lost, but the output stays "topologically supersolid" and can be re-imported.
- **Observed pattern across all cases:** there is no self-healing. "They usually die pretty fast after introducing the first real topological error, we basically see no self-healing behavior at all" (first post). In case 2, outcomes are "binary": exactly canonical, or unsalvageable (DOCUMENTED).

## Parallelism and performance

- **Chains are inherently sequential.** Parallelism is only possible inside one op ("the chain itself cannot be parallelized", DOCUMENTED).
- **Cost per cut vs step count** (case 4 plot). For most engines, time per cut grows at least linearly with the running mesh, so total time is at least quadratic in step count and "difficult to 'just throw more hardware at it'".
  - Solidean grows sub-linearly per cut. It attributes this to convex polygons kept internally (triangulated only on export), bounded-bit-width exact coordinates that do not grow with history, and localized lookup of the interacting region (DOCUMENTED).
- **Memory trade-off.** Manifold is the lean survivor (203 MiB at 10k steps vs Solidean 1.1 GiB; 452 MiB vs 7.9 GiB at 100k) (DOCUMENTED).
- **Geogram.** 1.9.8 → 1.10.0 went from ~37 min to 112 s on case 3 (DOCUMENTED).

## Known failures, limitations, war stories

- **Vendor bias** (INFERRED; the posts state "None of this is meant to dunk on these libraries"):
  - The author sells the top-ranked engine and maintains the harness.
  - The reference values come partly from that engine: case 4 beyond 10k steps, and the sweep study's `is_known_good` = Solidean or CGAL Nef.
  - The correctness-judging meta-runner is not public (see the OBB note).
  - Mitigation: data and runners are open, and case 3's oracle is exact and independent of any engine.
- **Test design limits** (INFERRED, partly DOCUMENTED):
  - Single machine and default settings (DOCUMENTED).
  - Float mesh I/O at every runner boundary, which favours engines that keep an internal handle across the chain.
  - Solidean's runner receives the scene bounding box to size its fixed-point grid; the harness gives it to everyone.
- **Failure taxonomy worth encoding as validators** (DOCUMENTED, INFERRED as a list):
  - crash or exit mid-chain;
  - explicit decline (CGAL corefine on non-manifold output);
  - empty result;
  - inverted solid (negative volume);
  - missing faces (open mesh; Blender fast is "biased toward not emitting a face");
  - duplicated opposite coincident faces (Carve: volume right, area wrong, so a volume-only check misses it);
  - zero-volume residual walls (Blender fast);
  - per-triangle misclassification spreading into scattered debris (QuickCSG);
  - one lost triangle poisoning a whole patch many steps later (Trueform on case 2).
- **Precision evidence:**
  - Trueform is "the only algorithm in our lineup that works internally with 32-bit floats". It fails case 2 (inverted) and case 4 at 250 steps with float input.
  - Its double-precision build "did not fail at this step count" at 1000 steps (DOCUMENTED, dome post).
- **Unexplained failures.** IARMB's "needs rationals" exit on case 2 (DOCUMENTED) and Geogram's "no result" on cases 2 and 4 (DOCUMENTED) are unexplained in the posts. Levy 2024 reports expansion-kernel overflow on some CSG trees; open Geogram uses expansions unless the commercial geogramplus is present (see `levy-2024-exact-predicates-exact-constructions-and-combinato.md`). The link is INFERRED, not shown.

## Relevance for wonky

**Acceptance tests for all four bake-off prototypes** (INFERRED):
- **Cube grid is the best oracle anywhere.**
  - Integer coordinates are exact in F32x2 and on any integer grid.
  - The expected solid after step k is a known set of unit cubes: volume = count, area = number of exposed unit faces.
  - Every step can be checked exactly, with no reference engine.
  - It exercises exact coplanar and touching handling and **non-manifold intermediates**. wonky must choose explicitly: represent non-manifold solids (Solidean's duplicated-vertex "Solid"), or return `Unresolved` at op 5 as CGAL corefine does. Silently producing walls is not an option.
  - Scale it for the targets: 3×3×3 (53 ops) for CI on the JS target, 5×5×5 (249) for native, 10×10×10 (1999) as a nightly native run.
  - It fits wonky's existing CSG-tree fixtures (`fixtures/bakeoff/cases.json`, box leaves, left-deep chain). The current longest chain is 20 unions, which is two orders of magnitude shorter.
- **Case 1 in analytic form.** Sphere − 3 tori − 6 spheres is also a natural *analytic* case. The exact-B-rep prototype 4 must then recover torus/sphere intersection curves. The mesh version checks topology; an OCCT oracle (already used in scripts/bakeoff/reference.py) checks the exact volume.
- **Case 2 isolates exact coplanarity under iteration.** Only exact-construction engines and Manifold survived. It should be the main discriminator between prototype 1 (symbolic perturbation in F32x2) and prototype 2 (exact plane-based).
- **Case 4 steps 100/250/1000 are performance canaries** for output sensitivity. Track time per cut vs step and flag superlinear growth. A 1 h budget at 100k steps is out of reach for Bend today and should not be a goal.

**What wonky's bake-off did and did not cover** (DOCUMENTED, docs/bakeoff.md, docs/hybrid-boolean-plan.md, fixtures/bakeoff/adversarial-*.json, 2026-09-23/24):
- None of the four Solidean cases was run. The longest chains are `pin-array-chain-20` (20 unions, flattened by the CSG layer into 1 Boolean) and 3-6-step adversarial chains: `adv-iterated-same-subtract`, `adv-iterated-split-reglue`, `adv-ep2-iterated-sub-add-sub`, `adv3-iterated-hole-rotated-3x`, `adv4-iterated-hole-shift-1e-12` and the sdf self-union/subtract chains.
- The plan states that corefine passes its iterated adversarial cases (repeated self-unions, split and re-glue, repeated subtracts), section 2.4.
- The plan argues that drift cannot accumulate through *exact* steps, because each operation re-tessellates the recovered exact B-rep. After an `Unresolved`, a mesh-only chain adds "at most about 2^-44 relative per constructed point", i.e. about 6e-10 mm after 100 operations on a 100 mm part. The plan marks this "conjecture: arithmetic, not measured over long chains" (section 2.4). Solidean's cases 2 and 3 are exactly the measurement that would confirm or refute it. The earlier recommendation therefore stands (INFERRED).
- **Prediction for the cube grid (INFERRED).** Since commit aa84b76 (2026-09-24), corefine's output gate refuses a vertex whose triangles form more than one fan ("non-manifold contact (point)"). It also refuses any pair of triangles with different tags that intersect under an exact *closed* test, where "touching counts" (docs/proto-corefine.md). The cube grid's even-parity union creates cubes touching only along edges, whose faces touch there whether or not the vertices are duplicated. So the gated hybrid should refuse the first edge-contact step (op 5, where CGAL corefine also declined). Manifold itself was canonical on this case, so this is a policy difference, not a numeric one. Passing the cube grid requires an explicit decision to represent touching-but-disjoint solids (Solidean's duplicated-vertex "Solid" closure) instead of refusing them. For FDM, edge-touching solids are usually a modelling error, so refusal is defensible as the default. Verify by running the 3×3×3 grid.

**What the data says about the prototype families** (INFERRED from the DOCUMENTED numbers):
- **Manifold (prototype 1's reference)** was canonical on every case at every scale it finished within the budget. It was the only non-exact-construction engine to survive case 2, and it matched exact references to 1e-4 through 10k dome steps. That is strong empirical support that Smith-Dodgson symbolic perturbation survives long chains on clean input.
  - Caveats: it was run in double, while wonky has F32x2, about 5 fewer mantissa bits. Its self-rating is "R I" not "E" (OBB README). Known coincident-face shards are documented in Manifold issues #1430 and #1656 (see the Manifold note).
- **Exact plane-based / EMBER lineage (prototype 2).** Solidean leads every case, but it is EMBER plus about 3-4 years of engineering (output-sensitive structures, export-time topology). A clean-room EMBER port should be expected to be canonical on cases 1-3 but slow on case 4 (INFERRED).
- **Plain F32 is not enough** for Trueform's algorithm on long chains, while double is. F32x2 (~48-bit mantissa, 8-bit exponent) is untested territory: wonky's prototype 1 results on cases 2-4 would be genuinely new data.

**Validator requirements for `scripts/bakeoff/validate.mjs`** (INFERRED): check at least volume and area to a stated tolerance, the bbox (the OBB smoke-test trick for A−B vs B−A), the open-edge/defect count, a negative-volume check, and the duplicate-opposite-face count. Carve's case shows why volume alone is insufficient.

## Pointers worth porting or studying

- bench-blog-data: `blog/2026/iterated-cube-grid-benchmark/checker_iter_even_fill_remove.request.json` (1999-op SSA list; the 1000 input cubes are `input/c_x_y_z.obj`), `terrain-carve-benchmark/0.2_-y.request.json` plus `heightmap/0.2_-y/*.obj`, `first-benchmark-results-iterated-csg/{A..J}.obj` plus `primitives.request.json`, and `iterated-dome-carve-benchmark/dome10-through-5000.7z`.
- bench-iterated-sweeps-study: `iterated-sweeps.suite.yaml`, the `.case` DSL (`w = boolean-difference w "sweeps/sweep_000.obj":flip`), and `chart_helpers.py` (`is_step_correct`: success, zero defect, 10% band).
- Cube-grid post, "Non-manifold, but still solid" section: the Solid/Supersolid closure argument and the CGAL corefine manual quote. This is a design decision wonky must make explicitly.
- Dome post, "Cost per cut" plot and "Why Solidean stays flat": the requirements list for an iterated-CSG-capable data structure.

## Verdict: adopt

Adopt the cases, data and correctness-checking method as bake-off acceptance tests. The cube grid comes first because its oracle is exact and engine-independent; terrain carve and case 1 follow, and dome at small step counts serves as a performance canary. The licences (MIT, CC BY 4.0) allow direct use as fixtures. Treat the rankings and timings as vendor-run evidence, not as independent truth.
