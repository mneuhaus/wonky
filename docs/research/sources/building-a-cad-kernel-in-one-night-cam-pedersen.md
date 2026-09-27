# Building a CAD kernel in one night (Cam Pedersen)

- Kind: blog post (author's first-hand account). Canonical: https://campedersen.com/brep-kernel. Raw HTML saved at `tmp/research/building-a-cad-kernel-in-one-night-cam-pedersen/page.html`.
- Related:
  - repo https://github.com/ecto/vcad (Apache-2.0, 427 stars, 25 forks, 117 open issues, created 2026-01-27, last push 2026-09-23 per `gh api` on 2026-09-24, 2,276+ commits);
  - HN threads https://news.ycombinator.com/item?id=46786196 ("Parametric CAD in Rust", 241 points, 172 comments; the "roast" that triggered the rewrite), https://news.ycombinator.com/item?id=46799447 (this post, 5 points) and https://news.ycombinator.com/item?id=46826634 ("Vcad: Free BRep CAD in the Browser", 48 points, 40 comments);
  - PR https://github.com/ecto/vcad/pull/789.
- Author: Cam Pedersen (`ecto`), 2026-01-28.
- License: the blog post is ordinary copyright. The vcad code is Apache-2.0, so it could be ported with attribution; see the sibling note `vcad-ecto-vcad-kernel-booleans-kernel-naming-torture-corpus.md`.
- Status: a single post. Its subject, vcad, is still active (last push 2026-09-23).

## What it is
A narrative of replacing vcad's manifold-3d mesh kernel with a "real" B-rep kernel overnight, with Claude's help, after an HN thread criticised the mesh approach. The post is the calibration point for "how far does LLM scaffolding get you". The follow-up evidence in the vcad repo shows where the time actually went afterwards.

## How it works (as claimed in the post, DOCUMENTED quotes)
- Twelve Rust crates compiled to WASM: math, topo, geom, primitives, tessellate, booleans ("surface-surface intersection, face classification"), nurbs, fillet ("rolling ball algorithm"), sketch, constraints, shell, wasm.
- Topology: "every element has a unique ID and maintains bidirectional links to its neighbors".
- Boolean steps as stated: "Find where the surfaces intersect; Split both shapes along that intersection curve; Classify which parts are inside vs outside; Sew the surviving faces into a new solid."
- SSI: "Surface-surface intersection (SSI) is the dragon. Two NURBS surfaces can intersect in curves that branch, loop, and degenerate. My ssi.rs is ~500 lines of marching algorithms and Newton-Raphson refinement. She's ugly but she runs." The first `ssi.rs` (commit `2f0cced2`, 2026-01-28) has 492 lines (checked via `gh api`).
- Constraints: "Newton-Raphson on a system of nonlinear equations: each constraint becomes an error function, and the solver minimizes total error."
- Timeline as posted: first kernel commit Tue 23:51, "booleans working" 00:07 (16 minutes later), NURBS 00:31, "fillets done" 01:22, sketch and extrude 08:38, manifold ripped out 09:10, constraint solver 09:27. "Twelve hours. Coffee. Spite. Claude."
- Motivation: OpenCASCADE is "3.6 million lines of C++ with LGPL licensing"; the goal is a "Fusion 360 replacement".

## Robustness and guarantees
- The post gives no robustness evidence, tests, tolerances or failure data. "Booleans working" after 16 minutes means the pipeline ran on demo inputs.
- What happened later is DOCUMENTED in the vcad repo, and it validates "SSI is the dragon":
  - `crates/vcad-kernel-booleans` is now about 22.2k lines, and `ssi.rs` has 1,311 lines (17 commits, the last on 2026-08-11). New modules: `unrepresentable.rs`, `validate.rs`, `cyl_cyl.rs`, `cyl_band.rs`, `no_crossing.rs`, `repair.rs`, `mesh/csg.rs`.
  - PR #789 (2026-08-11, "stop Difference silently returning wrong solids against curved faces") names three silent-WRONG classes. First, intersecting circle arrangements on a sphere hit a gate that "deliberately returns the uncut target". Second, sphere x cylinder "has no analytic SSI. The sampled fallback returns unusable point dust, zero splits are recorded, and the no-crossing fast path then samples a sphere pole vertex ... and concludes the r=30 sphere is contained. Result: empty." Third, perpendicular unequal cylinders produced "a garbage TwoLines SSI ... the tool's cap is merged into the target (volume grew)".
  - `unrepresentable.rs` header: "a Ø20 cylinder bored through a Ø60 sphere came back as an untouched sphere, and a cross-drilled bar came back with the drill's surface merged into it". The fix is to declare unrepresentable pairs before running: if a face pair has no analytic intersection and the faces genuinely cross (sample points strictly inside and outside the other solid), route to the mesh fallback.
  - PR #789's validity oracle is a 6^3 probe grid classified by ray parity against both operands, predicting which probes must lie inside the result. A mismatch must survive a 7-point unanimity vote.
  - Notable negative result, quoted: "mesh closedness is deliberately advisory-only. Measured unpaired-edge counts: 3 on a sound thin-blade intersection, 64 on a sound sheet-metal fold union, 236 on the broken cylinder cut. No threshold separates good from garbage." If the fallback also fails validation, the operation returns `BooleanError::InvalidResult`, "fail closed, never a plausible wrong solid".
  - `validate.rs` was still being patched on 2026-09-17: "Fix silently wrong unions of prismatic solids with coplanar caps".
  - `pair_is_analytic` (DOCUMENTED, `unrepresentable.rs:45-90`, read 2026-09-24) mirrors the analytic arms of `ssi::intersect_surfaces`, including their inner guards. True for plane x {plane, sphere, cylinder, cone, torus} and sphere x sphere. Cylinder x cylinder is analytic only if the axes are parallel (`|1 - |a.b|| < 1e-9`; the SSI returns Empty and such faces never cross) or perpendicular (`|a.b| <= 1e-6`), equal-radius (`|ra - rb| <= 1e-6`) and genuinely intersecting (closest axis points within 1e-6). Everything else, including unequal cross-drills, is declared non-analytic. The crossing test samples `FACE_SAMPLES = 24` points per face (loop vertices plus edge midpoints, no surface parameterization needed) and calls a pair "crossing" only if some samples are strictly inside and some strictly outside the other solid. Only then is the arrangement unrepresentable and routed to the mesh fallback. INFERRED weakness: a face that crosses the other solid only between its sample points (a small bite in a large face) passes as non-crossing.
  - Determinism war story (DOCUMENTED, commit `3b1cd14e`, 2026-09-17, closes vcad #893, "Make boolean results reproducible across processes"): per-process-seeded `HashMap` iteration order leaked into geometry in three places (vertex merge removal order combined with LIFO slot-map reuse, first-nearest-edge selection among equidistant candidates, T-junction candidate order). The same 378-face union came back with 4067, 4075 or 4083 triangles, and the mesh fallback returned 8118.6 or 8150.6 mm^3 "from 'the same' input". The flip tracked the size of the process environment block. In-process repeats were always bit-identical, which hid the cause. Fix: iterate sorted everywhere.

## Parallelism and performance
- The post has no numbers. PR #789 mentions a chained two-cut that "produced 246k triangles in 21 s", which triangle-soup routing brought to about 800 triangles "in milliseconds".

## Known failures, limitations, war stories
- HN reception (HEARSAY, https://news.ycombinator.com/item?id=46826634): "Vibe coded? Nothing works." (fainpul). "Vibecoding expedites the easy parts fantastically. But the hard parts are hard. Really, damn hard." (fsloth, a CAD professional). "The challenge with CAD kernels is mainly in the edge-cases" (dekhn, https://news.ycombinator.com/item?id=46799447).
- The seven-month gap between "booleans working" (2026-01-28) and "stop Difference silently returning wrong solids" (2026-08-11) is the concrete measure of the hard part (DOCUMENTED dates, INFERRED interpretation).

## Relevance for wonky
- Calibration for the Boolean bake-off: primitives, tessellation, STEP, sketch solving and "Booleans that run" are the cheap 80% an LLM scaffolds in hours. They prove nothing. Bake-off criteria must be adversarial curved arrangements that vcad got silently wrong:
  - sphere x cylinder through-bore;
  - cross-drilled unequal cylinders;
  - intersecting circle arrangements on a sphere;
  - coplanar-cap prism unions;
  - chained cuts on triangle soup.
- Point-dust SSI (marching samples the splitters cannot consume) is exactly the failure that certified subdivision SSI (see `opensolid-ian-mackenzie.md`) and analytic quadric pairs avoid. vcad's pre-declared `pair_is_analytic` table is a cheap, honest gate wonky can copy: declare unsupported pairs up front and refuse (or take a disclosed fallback) instead of detecting failure afterwards.
- vcad's negative result about closedness thresholds supports a semantic oracle over a topological one: probe points classified against the CSG expression. Combined with keel's PASS/DECLINE/WRONG oracle and remus's metamorphic tests, this should form wonky's bake-off harness.
- The #893 determinism bug is a class Bend largely rules out: no hash maps with seeded order, no slot reuse, pure functions. The residual risk moves to tie-breaking. Every "pick the nearest / first candidate" in wonky must use a total order on exact keys (U32 ids, then exact coordinates), never an order that emerges from evaluation or fork-join scheduling (INFERRED).
- No Bend-specific content in the post itself: it is about process, not algorithms.

## Pointers worth porting or studying
- The post itself (timeline and crate list) for calibration only.
- `github.com/ecto/vcad` `crates/vcad-kernel-booleans/src/unrepresentable.rs` (`pair_is_analytic` plus the crossing test), `validate.rs` (probe-grid set-semantics oracle), PR #789 description (three silent-WRONG root causes, the closedness negative result).
- First `ssi.rs` at commit `2f0cced2` (492 lines) against the current one (1,311 lines), to see how the dragon grew.
- vcad commit `3b1cd14e` / issue #893 (cross-process nondeterminism from hash order).

## Verdict: learn-from
The post is a calibration datum, not a technique. Together with the repo history it shows that LLM-built kernels reach "runs on demos" in hours, while curved-SSI correctness takes months and still ends in explicit fallbacks. Use it to set bake-off acceptance criteria: adversarial curved cases plus a semantic WRONG oracle. Do not use it as evidence that any approach works.
