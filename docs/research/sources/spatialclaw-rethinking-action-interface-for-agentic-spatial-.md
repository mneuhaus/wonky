# SpatialClaw: Rethinking Action Interface for Agentic Spatial Reasoning

- Kind: paper and research implementation. [arXiv 2606.13673v1](https://arxiv.org/abs/2606.13673), [PDF](https://arxiv.org/pdf/2606.13673v1), [project](https://spatialclaw.github.io/), [code](https://github.com/NVlabs/SpatialClaw).
- Authors: Seokju Cho, Ryo Hachiuma, Abhishek Badki, Hang Su, Byung-Kwan Lee, Chan Hee Song, Sifei Liu, Subhashree Radhakrishnan, Seungryong Kim, Yu-Chiang Frank Wang, Min-Hung Chen; NVIDIA, with Cho/Kim KAIST affiliations. Submitted 2026-06-11; preprint, no conference acceptance established. DOCUMENTED: paper title page/arXiv.
- License: DOCUMENTED paper CC-BY-4.0. **Code is not permissive:** NVIDIA custom license §3.3 restricts work and derivatives to “non-commercial scientific research purposes only”; redistribution retains license and notices, derivatives retain use restriction (§3.1–3.2). Private/unlicensed wonky is not automatically exempt, nor is personal CAD necessarily scientific research. Study and independently implement interface ideas; do not copy code/prompts into production without clearance. [LICENSE](https://github.com/NVlabs/SpatialClaw/blob/b062f82962549391a02cc70e022641c1f4d8ac2b/LICENSE).
- DOCUMENTED repository snapshot, 2026-09-24: Python; size 1,063 KiB; 387 stars; 3 contributor accounts (not necessarily 3 people); main HEAD b062f82962549391a02cc70e022641c1f4d8ac2b dated 2026-07-17, “Fix GPU RPC security”; pushed_at 2026-09-14 differs from default-branch commit date; no releases returned. Early research code. [metadata](https://api.github.com/repos/NVlabs/SpatialClaw), [commit](https://github.com/NVlabs/SpatialClaw/commit/b062f82962549391a02cc70e022641c1f4d8ac2b), [contributors](https://api.github.com/repos/NVlabs/SpatialClaw/contributors), [releases](https://api.github.com/repos/NVlabs/SpatialClaw/releases).

## What it is

DOCUMENTED: training-free spatial image/video QA agent. It executes one Python cell per turn in a persistent kernel, rather than generating a whole analysis once or dispatching one named JSON tool per turn. It studies **action interface expressiveness and feedback**, not parametric CAD, exact B-rep, or manufacturing. [Paper §§1–3](https://arxiv.org/pdf/2606.13673v1).

## How it works

DOCUMENTED, paper §§3.1–3.2 and Appendices D–G:

- Workspace lasts one sample. Entry points: `InputImages`, `Metadata`, `tools`, `show`, isolated visual-question helper `vlm`, and `ReturnAnswer`. Ordinary variables retain masks, reconstructed points, camera poses and partial computations; NumPy/SciPy/Matplotlib are available.
- Five-stage loop: (1) separate planner sees question/metadata/tool docs, **not images**, and plans evidence acquisition, not the answer; (2) main agent writes purpose/reasoning/next-goal/code; (3) AST/static checks, execute cell; (4) observe stdout, concise exception and offending line, new-variable type/shape/size summaries, shown images; (5) validate answer format and terminate, or continue up to 30 steps. Code after a failing line is not evidence and is omitted from failure context. Transport retries are distinguished from agent mistakes.
- Per-frame containers carry **absolute frame IDs**. Combining reconstruction points and segmentation masks requires aligned frame IDs, preventing same-shape arrays from silently referring to different frames. This is the most useful type-level idea for wonky: numerical shape/type alone does not encode geometric context.
- Reconstruction wraps Depth Anything 3; SAM3 supplies masks. World frame is gravity aligned, +Y up, first camera looking toward -Z. `depth`/dense points are float32; camera-to-world SE(3) matrices are float64. Most geometry helpers cast to NumPy float64. No exact predicates or formal error model. [Paper pp.17,20–24](https://arxiv.org/pdf/2606.13673v1), [geometry_utils.py](https://github.com/NVlabs/SpatialClaw/blob/b062f82962549391a02cc70e022641c1f4d8ac2b/spatial_agent/tools/geometry_utils.py).
- Figure 2 concretely motivates composition: median/centroid-to-centroid distance is the wrong operation for nearest object distance. After inspecting masks, agent switches to `scipy.spatial.KDTree` nearest distances between reconstructed point sets. Ground truth 0.9 m, revised prediction about 0.949 m. This is a sampled, noisy point-cloud computation, **not exact surface clearance**. [Paper Fig.2](https://arxiv.org/pdf/2606.13673v1).
- RANSAC helper is explicit: confidence >0.3, 1,000 random triples, reject cross-product norm <1e-8, count inliers within 0.05 scene units, require ≥100 input points and ≥50 inliers, refit by SVD. RNG seed 42; plane-normal sign remains caller's responsibility. Useful for understanding the paper's heuristic numeric layer, not for transplanting its thresholds to millimeter CAD. [geometry_utils.py](https://github.com/NVlabs/SpatialClaw/blob/b062f82962549391a02cc70e022641c1f4d8ac2b/spatial_agent/tools/geometry_utils.py).

## Robustness and guarantees

DOCUMENTED: runtime/format failures become observations, with wall-clock timeout, namespace reset/reinjection and step/tool-call budgets. Static AST and regex checks reject forbidden I/O/imports/dynamic execution. These are implementation defenses, not a proof that arbitrary Python is securely sandboxed. When budgets fail, a termination fallback first asks the model directly, then extracts a best-effort answer from recent text/variables. Thus “always returns an answer” is not correctness certification. [Paper E.3–E.6](https://arxiv.org/pdf/2606.13673v1), [kernel manager](https://github.com/NVlabs/SpatialClaw/blob/b062f82962549391a02cc70e022641c1f4d8ac2b/spatial_agent/kernel/manager.py), [safety](https://github.com/NVlabs/SpatialClaw/blob/b062f82962549391a02cc70e022641c1f4d8ac2b/spatial_agent/kernel/safety.py).

INFERRED: wonky should reject unsupported/uncertified results rather than imitate the best-effort answer fallback. Use capability-limited FeatureScript evaluation, immutable revision handles, fuel/time limits and explicit query errors. A cleared execution state must invalidate old handles, not silently reconstruct different geometry.

## Parallelism and performance

DOCUMENTED author results, no reproduction here:

- Table 2 controls toolset/backbone: Gemma4-31B average over 20 benchmarks: no-tool 53.4, single-pass 55.2, structured tool-call 56.7, SpatialClaw 59.9. Therefore interface advantage is **+3.2 pp versus its controlled structured interface**, +4.7 versus single-pass; headline +11.2 is against a different prior system, SpaceTools-ToolUsed (48.7, Table 3). Do not conflate these comparisons.
- Figure 4: wins in 11/13 meta-categories against each baseline, but not necessarily the same 11; structured-call losses include size estimation (-1.3 pp) and spatial planning (-4.7 pp). Multi-view/camera-motion/direction gains roughly +6–9 pp. Table 2 itself contains benchmark exceptions (Omni3D, BLINK, CV-Bench), despite broad prose claims.
- Table 4 ablation, different smaller backbone/subset: 56.9 full, 56.4 without utility wrappers, 51.4 without perception, 48.7 no-tool. Strong support for composability, not a proof that wrappers never matter.
- Figure 6 attributes 52.2% of 1,095 wins to composition, 19.5% control flow, 28.3% interface-neutral; **LLM-judge attribution**, not a randomized causal measurement. Evaluation caps large benchmarks at 1,000 samples; input long edge 768 px, main visual context ≤32 frames. [Paper Tables 2–4, Fig.4/6, Appendix B/E](https://arxiv.org/pdf/2606.13673v1).

DOCUMENTED architecture: separate scalable VLM and perception servers, session-affinity prefix cache; this is not a Bend GPU algorithm or a CAD timing benchmark. No supported claim of lower geometric-kernel latency. [Paper E.1](https://arxiv.org/pdf/2606.13673v1).

## Known failures, limitations, war stories

DOCUMENTED: Figure 7 classifies 1,000 wrong sessions using an LLM judge: geometric computation 20.6%, tool selection/coverage 18.4%, unsupported visual judgment 14%, VLM hallucination 14%, perception primitive errors 7.3%, recovery failures 8.2%, plus smaller categories. Still approximate learned perception, not manufacturing metrology. Appendix H emphasizes perceptual limitations; its broad conclusion should be read alongside the geometric-error breakdown. [Paper pp.15–16,25](https://arxiv.org/pdf/2606.13673v1).

DOCUMENTED issue report [#1](https://github.com/NVlabs/SpatialClaw/issues/1): unpinned PyTorch pulled a CUDA runtime incompatible with reporter's driver; asks for experimental lockfile. No run here. Default HEAD is itself an RPC security fix, so do not casually deploy the research server in an exposed environment. [commit](https://github.com/NVlabs/SpatialClaw/commit/b062f82962549391a02cc70e022641c1f4d8ac2b).

## Relevance for wonky

INFERRED transfer, not measured CAD evidence:

1. Expose measurement, section, closest-distance, interference, query and assertions **inside interpreted FeatureScript** so code can consume results without copying numbers through language. A persistent frontend can retain immutable geometry/query handles between iterations; Bend geometry stays pure and standalone.
2. Extend the frame-ID contract to `(revision, body/provenance ID, world/local frame, units, tolerance, method)`; reject combining stale topology or mismatched frames until explicitly transformed/remapped. Bounds and uncertainty should travel with numeric results.
3. Emit variable/query summaries and selected render handles, not full meshes. Explicit `unknown`, `empty selection`, `stale revision`, and `approximate with error bound` are different states. Compare expected geometry/dimension changes after edits.
4. Controlled wonky eval: same model/tools/problems/budget; compare one-shot FS, per-operation tool calls, iterative FS with evaluation functions. Measure dimensional/provenance success, no-op rate, edit invariants, tool turns/tokens and wall time. Do not import spatial-VQA accuracy as CAD reliability.

Bend fit: pure array transforms, dot products and bounded reductions fit fork-join; matrix arithmetic needs F32x2 scaling/error analysis, not blind substitution for float64. F32x2 lacks float64 exponent range. Python mutation, SciPy KDTree/SVD, learned perception runtimes and HTTP model dependencies cannot be embedded. Uniform GPU queries need bounded/bucketed workloads; irregular search/control flow stays CPU-side or uses explicitly supported Bend kernels. No Boolean/SSI/fillet algorithm is offered.

## Pointers worth porting or studying

Paper Fig.2/3, Table 2, Appendix E.5 frame contracts, E.6 failure-context handling, G numeric APIs. [variable_tracker.py](https://github.com/NVlabs/SpatialClaw/blob/b062f82962549391a02cc70e022641c1f4d8ac2b/spatial_agent/kernel/variable_tracker.py) demonstrates metadata-only diffs and compact summaries (not deep content equality). Read architecture, independently implement due to code restrictions. PDF: `<repo>/tmp/research/pdf/spatialclaw-2606.13673.pdf`; checkout: `<repo>/tmp/research/spatialclaw-rethinking-action-interface-for-agentic-spatial-`.

## Verdict: learn-from

Strong experimental motivation for composable, stateful **code plus observations**, with frame-aware typed evidence. Reimplement those ideas in wonky's own frontend/Bend query layer; do not import restrictive research code or noisy perception numerics. The seed's build123d-mcp influence attribution was not independently investigated in this source and is not evidence for a CAD outcome.

