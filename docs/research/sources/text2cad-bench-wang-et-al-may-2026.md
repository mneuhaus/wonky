# Text2CAD-Bench

- Kind: paper and partially public prompt benchmark. Canonical: https://arxiv.org/abs/2605.18430 ; associated dataset preview: https://huggingface.co/datasets/AICAD/Text2CAD-Bench .
- Authors: Liang Wang, Heng Meng, Zekai Xiang, Jin Liu, Pingyi Zhou, Litao Chen, Yongqiang Tang; Wuhan University, BitInf Spatial Design Intelligence Lab, Nanjing Tech University, CAS. Read v1 submitted May 18, 2026 (PDF says preprint May 19). No accepted venue established. [DOCUMENTED, paper](https://arxiv.org/pdf/2605.18430v1).
- License: arXiv paper and preview card state CC BY 4.0. Attribute and indicate changes when reusing released text/data. No public executable evaluator was found, so no code license can be inferred from a claimed directory tree. [Paper landing page](https://arxiv.org/abs/2605.18430), [preview license](https://huggingface.co/datasets/AICAD/Text2CAD-Bench/blob/76428d5fe6efc3daa4ed93d4e8a3e5b8e32939c0/README.md).
- Status 2026-09-24: public GitHub repository search for Text2CAD-Bench returned none; card links github.com/xxx/Text2CAD-Bench and forms.google.com/xxx are placeholders. HF API lists only .gitattributes, README.md, release.csv, revision 76428d5f, last modified 2026-02-06, 1 like, 126 downloads. Card's proposed evaluation/metrics.py, evaluate.py and leaderboard.html are **not in the file manifest**. GitHub stars/contributors/releases/LOC: not available. The preview's connection is supported by matching title, task counts and model results; arXiv itself provides no direct code/data link, so author ownership of the HF account was not independently established. [HF manifest](https://huggingface.co/api/datasets/AICAD/Text2CAD-Bench), [card](https://huggingface.co/datasets/AICAD/Text2CAD-Bench/blob/76428d5fe6efc3daa4ed93d4e8a3e5b8e32939c0/README.md), [paper](https://arxiv.org/abs/2605.18430).

## What it is

DOCUMENTED: 600 intended reference models, paired geometric/appearance and procedural/sequence descriptions, hence 1,200 prompts. L1=200 basic models, L2=200 compositions/Booleans, L3=100 advanced sweep/loft/shell/freeform models, L4=100 domain-context tasks. **L4 is a different evaluation axis, not uniformly harder than L3**. It covers approximately 40% mechanical, 25% consumer, 15% medical, 10% architecture, 10% education. L4 is intended to be single-body, externally assessable, without assemblies or mating constraints. [Paper §§3.1–3.3, Tables 4–5](https://arxiv.org/pdf/2605.18430v1).

## How it works

DOCUMENTED reference construction: three human contributors worked approximately four weeks; description-first geometry specification, AI-assisted CadQuery implementation, usually 2–5 revisions per example, independent reviewer checks execution, description match, difficulty and paired-prompt consistency. Geometric prose follows global shape → local features → details → global summary. Procedural descriptions name modeling steps and dimensions. [Paper §3.2, App. E](https://arxiv.org/pdf/2605.18430v1).

DOCUMENTED evaluation protocol: Python 3.10/CadQuery 2.4 executes generated code in isolation, exports STEP then samples surface geometry using Trimesh. Invalidity includes syntax/runtime failure, 60s execution timeout or empty/degenerate geometry. The evaluator allows **up to three retries with execution error feedback** and reports the best output across attempts; a task is invalid only if all fail. The paper does not fully specify how best is selected among multiple geometrically different valid outputs. System prompt supplies practical API notes and five in-context examples, including chamfered hexagon, spring, circle-to-square loft, twisted gear and filleted bracket. Therefore published scores are not clean zero-shot first-attempt results. [Paper §4.1.2, App. D](https://arxiv.org/pdf/2605.18430v1).

DOCUMENTED metrics:

- L1–L3: normalize meshes to unit bounding boxes; sample 30,000 points per mesh. CD = mean nearest distance predicted→reference + mean nearest distance reference→predicted, reported ×10^3. IoU uses 256^3 voxel occupancy. Failed outputs are omitted from **both CD and IoU**, separately counted in IR. No exact tessellation/containment implementation or voxel origin/tie policy is available to audit. [Paper §3.3.3 and §4.1.2](https://arxiv.org/pdf/2605.18430v1).
- L4: eight exterior views to GLM4.6V, five 0–10 feature scores (overall features, external, functional, extended, details) and a separate Overall geometric-similarity score; average only over valid outputs, and report IR separately. Three engineering students blind-rescored a stratified subset. Appendix B claims broadly consistent rankings but gives neither subset size nor actual correlation/inter-rater agreement statistics, despite the main text promising them. [Paper §3.3.3, Table 2, App. B](https://arxiv.org/pdf/2605.18430v1).

## Robustness and guarantees

DOCUMENTED: no theorem about correctness; references are human-curated, execution is kernel-dependent, fidelity scores are sampled/voxelized and normalized. The paper explicitly warns that valid execution does not imply intended geometry, and that survivor-only metrics bias results when invalidity differs. Exterior VLM views cannot validate hidden voids, precise dimensions, mechanical load paths or inter-part relationships. [Paper §§3.3.2–3.3.3, §4.4](https://arxiv.org/pdf/2605.18430v1).

INFERRED numeric limitations: 256^3 occupancy is only about 1/256 of the normalized box per cell, insufficient to certify small clearances; 30k samples may miss tiny holes or sharp local defects. Independent size normalization can erase wrong physical dimensions. Neither metric substitutes for wonky's explicit tolerance and watertightness guarantees. Preserve source units and an unnormalized evaluation lane. [Underlying resolution/normalization](https://arxiv.org/pdf/2605.18430v1).

## Parallelism and performance

DOCUMENTED: no portable kernel speed measurements, GPU scalability experiments or asymptotic implementation are supplied. The concrete compute budget reported is the 60s execution cutoff and error-retry policy. Table 4 reference means: code lines 7.9→19.1→70.7, API calls 10.8→15.0→26.8 for L1→L2→L3. L3 geometric prompts average 429.4 words versus procedural 173.6, so prompt style and token burden are confounded at high complexity. [Paper §4.1.2, Table 4](https://arxiv.org/pdf/2605.18430v1).

DOCUMENTED selected results, not locally reproduced:

- GPT-5.2 geometric L1 CD 44.31 / IR 11.1% / IoU 0.59; L3 CD 93.46 / IR 68.0% / IoU 0.23. Sonnet-4.5 geometric L3 CD 70.13, IR 70.0%, IoU 0.25. These are conditional-on-success geometry statistics. [Table 1](https://arxiv.org/pdf/2605.18430v1).
- The narrative says invalidity rises roughly 15%→70–90% and CD 1.3–2.1×. **Do not generalize this to all models**: Table 1 Gemini-3-Flash geometric L3 IR is 12.8%; Text2CAD domain model L3 IR 2.0% but CD 234.00 and IoU 0.04. Low invalidity can mean reliably wrong/simple output. [Table 1 and §4.2](https://arxiv.org/pdf/2605.18430v1).
- Geometric prompts typically improve L1/L2 validity by 5–10 percentage points; at L3 sequence prompts often win. GPT-5.2 L3 CD 82.94 procedural versus 93.46 geometric, but IR 74.0% versus 68.0%, so some apparent CD benefit could be survivorship. [Table 1, §4.2](https://arxiv.org/pdf/2605.18430v1).
- L4 Gemini-3-Flash IR=17%, MiniMax M2.1 IR=81%; the latter's few surviving outputs have high feature scores. These are not evidence that the more-invalid model is the better assistant overall. [Table 2, §4.3](https://arxiv.org/pdf/2605.18430v1).

## Known failures, limitations, war stories

### Release quality and directly observed prompt defects

DOCUMENTED: paper conclusion says benchmark/evaluator will be released after acceptance. HF card says only 30% prompt preview, STEP ground truth withheld to prevent contamination, full access by contacting authors; contact email is blank. Its last-modified date precedes the May paper, so the preview may be stale. Do not treat its defects as proof of identical errors in unreleased evaluation data. [Paper §5](https://arxiv.org/pdf/2605.18430v1), [card](https://huggingface.co/datasets/AICAD/Text2CAD-Bench/blob/76428d5fe6efc3daa4ed93d4e8a3e5b8e32939c0/README.md).

DOCUMENTED direct file inspection: release.csv is 199 KiB and not valid UTF-8; GB18030 decoding is a successful local encoding hypothesis. A lightweight quoted-CSV parse found 151 records: L1 60, L2 61, L3 30, L4 none; columns id, geo_prompt_en, pro_prompt_en. No shape or code references are distributed in it. This is not a fully reproducible 600-case benchmark. [Pinned CSV](https://huggingface.co/datasets/AICAD/Text2CAD-Bench/blob/76428d5fe6efc3daa4ed93d4e8a3e5b8e32939c0/release.csv).

DOCUMENTED concrete contradictions in that public CSV:

- L1_1 geometric prompt: central hole diameter **20 mm**; procedural prompt: hole diameter **50.0 mm**. Both otherwise use the same 50mm-across-flats hexagon. These cannot be treated as interchangeable descriptions with one exact reference. Paper App. F gives the corrected 20mm procedural hole, reinforcing that preview and paper differ.
- L1_2 geometric prompt is a uniform OD40/ID25/L120 cylinder. Procedural prompt adds a 3mm fillet at a step corner while its purported step moves from (20,60) to the identical (20,60).
- L3_1 claims a paraboloid axis through y=75 but prints Y^2+Z^2=200(X-100), omitting the required (Y-75)^2 shift if those are the stated global coordinates; it alternates surface revolve and solid language without defining wall thickness.

These are specification defects visible without executing CAD. [CSV](https://huggingface.co/datasets/AICAD/Text2CAD-Bench/blob/76428d5fe6efc3daa4ed93d4e8a3e5b8e32939c0/release.csv), [paper App. F](https://arxiv.org/pdf/2605.18430v1).

DOCUMENTED paper inconsistencies/reproduction gaps: limitations claim no multi-turn execution-feedback interaction, while §4.1.2 and App. D.2 explicitly implement it; full few-shot examples are omitted; L3 ground-truth code is abbreviated; complete L4 judge rubric is not actually provided where the cross-reference says it is. There is no available issue tracker or evaluator to resolve these. INFERRED: reconstruct the task taxonomy, not published scores, until author artifacts clarify retry selection, prompt versions, reference models and scoring. [Paper §§4.1.2/5, Apps. B–F](https://arxiv.org/pdf/2605.18430v1).

## Relevance for wonky

INFERRED: borrow the **feature-aware difficulty matrix** and paired intent/procedure prompts. Create new licensed FeatureScript fixtures with an immutable typed specification (units, dimensions, coordinate frame, topology requirements), then render both prompt styles from that same specification. Automatic consistency checks would catch the released 20-versus-50mm contradiction. Separate primitive construction, curved Boolean, loft/sweep/shell, edge finishing, and domain intent; an L1 finishing feature can still be unsupported in wonky. [Motivation: paper taxonomy and paired prompt protocol](https://arxiv.org/pdf/2605.18430v1), [counterexample](https://huggingface.co/datasets/AICAD/Text2CAD-Bench/blob/76428d5fe6efc3daa4ed93d4e8a3e5b8e32939c0/release.csv).

INFERRED LLM ergonomics contract: return structured UNSUPPORTED with operation name, source span, affected topology and supported alternatives, distinct from numeric failure, invalid topology and malformed code. A fallback suggestion must be explicit and tolerance-bounded, never silently approximate a fillet or shell. Measure first-attempt and fixed-budget error-feedback repair separately, with both all-task and success-conditioned geometry outcomes. These are proposed wonky features, not capabilities shown by the benchmark. [Evidence: advanced-operation failures and retry template](https://arxiv.org/pdf/2605.18430v1).

INFERRED Bend fit: the benchmark organization is frontend/harness logic, independent of scalar width. Geometry must be reimplemented in Bend rather than binding CadQuery/OCCT. Uniform voxel classification and point-distance batches map naturally to balanced fork-join and immutable arrays; use U32 occupancy/counts, tiled bitsets rather than a mutable 256^3 object grid, F32 for normalized approximate metric coordinates, F32x2 for cancellation-sensitive accumulation. Robust containment needs wonky predicates, potentially multi-limb U32, not assumptions inherited from a float64 Python/OCCT reference. GPU work should be bounded and bucketed by shape/triangle count. The paper specifies no F32 error budget or exact arithmetic. [Protocol numeric basis](https://arxiv.org/pdf/2605.18430v1).

INFERRED FDM lesson: add functional assertions (hole fit, wall thickness, noninterference, snap travel) rather than an exterior-image judge. Do not normalize away millimeter errors. Keep L4-like domain descriptions as usability tests, not print certification. [Paper's L4 scope limitations](https://arxiv.org/pdf/2605.18430v1).

## Pointers worth porting or studying

- §3.3 taxonomy; §4.4 survivor-bias discussion; App. D retry contract/API guardrails; App. E description-first independent review; App. F examples. [PDF](https://arxiv.org/pdf/2605.18430v1).
- Preview CSV as a specification-validation adversarial fixture, **not blindly as truth**. [File](https://huggingface.co/datasets/AICAD/Text2CAD-Bench/blob/76428d5fe6efc3daa4ed93d4e8a3e5b8e32939c0/release.csv).
- Local: <repo>/tmp/research/pdf/text2cad-bench-wang-et-al-may-2026.pdf ; <repo>/tmp/research/text2cad-bench-wang-et-al-may-2026/release.csv ; <repo>/tmp/research/metadata/text2cad-bench-wang-et-al-may-2026-hf.json . Only document/CSV inspection; no model inference, CAD execution or test runs.

## Verdict: learn-from

Useful feature-aware evaluation design and clear evidence that executability, geometry and intent must be separated. Not currently a trustworthy drop-in oracle: incomplete release, ambiguous retry/scoring specification, stale/mismatched preview and concrete paired-prompt contradictions. Independently create validated wonky fixtures inspired by the methodology; retain attribution for copied CC BY text. Full ground truth, evaluator source, protocol reconciliation and dataset revision remain open.
