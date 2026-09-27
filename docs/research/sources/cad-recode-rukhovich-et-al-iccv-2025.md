# CAD-Recode

- Kind: point-cloud-to-CAD-code research model, paper, inference notebook, released weights/data. Canonical: https://arxiv.org/abs/2412.14042 ; repository: https://github.com/filaPro/cad-recode ; project: https://cad-recode.github.io/ ; weights: https://huggingface.co/filapro/cad-recode-v1.5 .
- Authors: Danila Rukhovich, Elona Dupont, Dimitrios Mallis, Kseniya Cherenkova, Anis Kacem, Djamila Aouada; University of Luxembourg SnT and Artec3D. Initial preprint December 2024; read arXiv v2, March 11, 2025. Accepted ICCV 2025, proceedings pp. 9801–9811 according to repository citation. [DOCUMENTED paper](https://arxiv.org/pdf/2412.14042v2), [README](https://github.com/filaPro/cad-recode/blob/03e3262119b38939feaa44b8368ad8db99243d47/README.md).
- License: **CC BY-NC 4.0**, verified in LICENSE.md despite GitHub API NOASSERTION. Model and dataset cards also say CC BY-NC 4.0. Noncommercial restriction is not permissive software licensing; private noncommercial use and future commercial product reuse are different questions. Prefer independently implementing published ideas and fresh wonky fixtures; do not import code, weights or dataset into a reusable commercial-capable product without permission/legal review. [LICENSE](https://github.com/filaPro/cad-recode/blob/03e3262119b38939feaa44b8368ad8db99243d47/LICENSE.md), [model](https://huggingface.co/filapro/cad-recode-v1.5/blob/main/README.md), [data](https://huggingface.co/datasets/filapro/cad-recode/blob/main/README.md).
- Snapshot 2026-09-24: GitHub primary language Jupyter Notebook (Python code), size 192 KiB, 264 stars, 26 forks, one contributor returned, no open issues. Latest default commit 03e3262, 2025-11-16, a citation update. Latest release v1.5, 2025-03-16. Small inference/demo artifact rather than a full public training system. [API](https://api.github.com/repos/filaPro/cad-recode), [commit](https://github.com/filaPro/cad-recode/commit/03e3262119b38939feaa44b8368ad8db99243d47), [contributors](https://api.github.com/repos/filaPro/cad-recode/contributors), [releases](https://github.com/filaPro/cad-recode/releases).

## What it is

DOCUMENTED: a fine-tuned Qwen2-1.5B autoregressive decoder receives point-cloud tokens and emits executable CadQuery Python. CAD code is the reconstruction representation, not a mesh output subsequently converted to B-rep. The model is trained on one million procedurally generated sketch-and-extrude programs. It supports the **distribution of features it saw**, not everything CadQuery syntax can express. The paper demonstrates downstream GPT-4o code QA and parameter-slider refactoring; it does not recover the original designer's intent or history uniquely. [Paper §§3–5](https://arxiv.org/pdf/2412.14042v2).

## How it works

### Point-cloud encoder and code generation

DOCUMENTED code: demo.ipynb defines FourierPointEncoder and CADRecode. Normalize input bounding box to longest extent 2, centered at origin. Sample 8,192 surface points, then farthest-point sample K=256. For p=(x,y,z), concatenate p with sin(2^k p) and cos(2^k p), k=0…7: 3+2×3×8=51 channels; **no pi multiplier in the notebook**. A single learned linear 51→1536 projection supplies point embeddings to Qwen2-1.5B. Prefix tokens have a special attention-mask value -1; on first decoding step their normal embeddings are replaced with point embeddings and mask becomes 1. Subsequent tokens use the normal KV cache. [Notebook model and sampling cells](https://github.com/filaPro/cad-recode/blob/03e3262119b38939feaa44b8368ad8db99243d47/demo.ipynb).

DOCUMENTED numeric model: point projection explicitly float32, embeddings cast to bfloat16, decoder uses checkpoint dtype and float32 logits. CadQuery/OCCT and NumPy/Trimesh/SciPy geometry paths are native floating-point dependencies, not F32-only exact geometry. Original Qwen tokenizer is retained. Demo max_new_tokens=768; final output is a variable r, subsequently executed and exported. Point-prefix insertion and model caches are mutable, framework-specific operations. [Notebook](https://github.com/filaPro/cad-recode/blob/03e3262119b38939feaa44b8368ad8db99243d47/demo.ipynb), [pinned native dependencies](https://github.com/filaPro/cad-recode/blob/03e3262119b38939feaa44b8368ad8db99243d47/Dockerfile).

DOCUMENTED training: one-stage end-to-end negative log-likelihood, AdamW learning rate 2e-4/weight decay .01, cosine schedule, 100k iterations including 1k warmup; Gaussian positional noise sigma=.01 with probability .5 per object. Latest version uses xyz only, unsorted points and FPS; v1 had normals, random point sampling and z-ordering. Do not mix v1 and v1.5 protocols. [Paper §4.3, App. A](https://arxiv.org/pdf/2412.14042v2), [changelog](https://github.com/filaPro/cad-recode/blob/03e3262119b38939feaa44b8368ad8db99243d47/CHANGELOG.md).

DOCUMENTED inference search: generate ten programs from different point-cloud samples; execute candidates, sample their surfaces and choose minimum Chamfer distance to the input observation. Invalid candidates cannot win a valid geometric comparison. This is inference-time geometric verification, not proof of reconstruction correctness. The public notebook shows a single prediction rather than the full ten-candidate evaluation driver. [Paper §4.3, App. E](https://arxiv.org/pdf/2412.14042v2), [notebook](https://github.com/filaPro/cad-recode/blob/03e3262119b38939feaa44b8368ad8db99243d47/demo.ipynb).

### Synthetic generator recipe, useful without the model

DOCUMENTED paper Algorithms 1–2, App. B:

1. Choose 3–8 random primitives from circles and rotated rectangles; accumulate planar unions/cuts.
2. Extract boundary loops, classify outer versus inner, serialize surviving edges as lines/arcs/circles. Validate nonintersecting loops and strictly positive primitive lengths. This produces complex sketches from a small generative vocabulary instead of sampling arbitrary invalid wire coordinates.
3. Choose randomly translated canonical XY/YZ/ZX planes; extrude sketches, union resulting volumes.
4. Normalize shape scale, quantize coordinates to integer range [-100,100] with step 1, simplify recognizable rectangles/boxes/cylinders to higher-level calls, and reuse workplanes/coordinates.
5. Execute serialized code, use PythonOCC BRepCheck_Analyzer for geometric validity, discard failures and duplicates. The paper references another work's duplicate detector without a complete runnable implementation.

[Paper App. B and Algorithms 1–2](https://arxiv.org/pdf/2412.14042v2).

DOCUMENTED author clarification: random decisions are coin flips; mix planar rectangles/circles, some cuts, then describe their boundary as arcs/lines/circles. **The generator and original training code were not released**. Issue #4 explicitly says no plans to release more code; #8 confirms the missing training/generation pipeline. Thus this is an algorithmic template, not a source port waiting to happen. [Author reply #4](https://github.com/filaPro/cad-recode/issues/4#issuecomment-2701232218), [release-policy reply](https://github.com/filaPro/cad-recode/issues/4#issuecomment-2700195735), [#8](https://github.com/filaPro/cad-recode/issues/8).

## Robustness and guarantees

DOCUMENTED: paper defines valid code as satisfying syntax and CAD validity predicates, but autoregressive generation is **not constrained to that valid set**; empirical IR is nonzero. Validation filters synthetic training data and inference candidates. No guarantee covers true dimensions, minimum walls, original feature dependencies, feature identity or robust parameter edits. [Paper §§4.1/4.3/5, Figure 14](https://arxiv.org/pdf/2412.14042v2).

DOCUMENTED evaluation: 8,192 surface samples, squared bidirectional nearest-neighbor CD ×1000; IoU is volume overlap. Notebook confirms squared cKDTree distances and computes intersection volumes over split mesh components; prediction scale is divided by 100 then both inputs map to [0,1]. CadQuery tessellation uses linear tolerance .001 and angular .1 in output coordinate units. These are empirical mesh metrics, not certified geometric error. [Notebook metric/export cells](https://github.com/filaPro/cad-recode/blob/03e3262119b38939feaa44b8368ad8db99243d47/demo.ipynb), [paper §5.1](https://arxiv.org/pdf/2412.14042v2).

DOCUMENTED correction to a common summary: **CC3D 16.8% invalidity is the no-test-time-sampling ablation**, not the reported best-of-ten system. Table 3 has DeepCAD 4.9%→0.4%, Fusion360 8.7%→0.5%, CC3D 16.8%→0.3% with sampling. DeepCAD IoU improves 89.3→92.0%; CC3D 65.6→74.2%. Keep search budget and model version beside every number. [Paper Table 3](https://arxiv.org/pdf/2412.14042v2).

## Parallelism and performance

DOCUMENTED: training approximately 12 hours on one H100, batch size 18 in App. A; changelog additionally records gradient accumulation ×2. No controlled CPU/native geometry throughput claim is established here. Decoder is sequential in tokens, though candidate reconstructions and independent shape validation can be parallelized. [Paper App. A](https://arxiv.org/pdf/2412.14042v2), [changelog](https://github.com/filaPro/cad-recode/blob/03e3262119b38939feaa44b8368ad8db99243d47/CHANGELOG.md).

DOCUMENTED QA results: CAD-Recode→GPT-4o 76.5%, CAD-SIGNet→GPT-4o 63.2%, PointLLM 42.3% on point-cloud CAD-QA. App. F separately translates the 1,000-question SGP benchmark to CadQuery and reports 82.4% on code-based QA, approximately 4 points above DeepCAD format with explanatory hints. INFERRED: this supports familiar source code as an inspectable interface, but the 76.5-versus-63.2 comparison also changes reconstruction quality; it is not a clean proof that every code representation beats every symbolic representation. [Paper Table 5, App. F](https://arxiv.org/pdf/2412.14042v2).

## Known failures, limitations, war stories

- DOCUMENTED Figure 14: sub-quantization cylinder heights round to zero; unsupported revolutions/B-splines are approximated by cylinders or arcs and can produce invalid/self-intersecting loops. Integer step 1 over a 200-unit span is a **representation limit**, not float32 arithmetic error. [Paper Figure 14](https://arxiv.org/pdf/2412.14042v2).
- DOCUMENTED issue #5 reports poor macOS output. The author attributes it to floating-point/platform differences, recommends pinned Linux Docker, and has no macOS fix. This is an author diagnosis, not an independently established root cause. The reporter also encountered Open3D crashing the notebook kernel; author suggests removing visualization imports. [#5](https://github.com/filaPro/cad-recode/issues/5#issuecomment-2713619730).
- DOCUMENTED issue #12: author says 512 points did not improve results and suspects the one-linear-layer encoder may be insufficient. This is informal experimental recollection, not a published ablation. [#12](https://github.com/filaPro/cad-recode/issues/12#issuecomment-3345785340).
- DOCUMENTED notebook warns that generated CadQuery can exhaust memory; it links an open reproducible upstream case, recommends a separate process with e.g. 3s timeout, but **omits isolation in the demo** and uses exec(py_string, globals()). Process timeout alone is not a security sandbox. [Notebook](https://github.com/filaPro/cad-recode/blob/03e3262119b38939feaa44b8368ad8db99243d47/demo.ipynb), [CadQuery #1665](https://github.com/CadQuery/cadquery/issues/1665).
- DOCUMENTED metric implementation requests are redirected to Cadrille rather than a complete CAD-Recode reproduction package; HF per-file downloads generated HTTP 429 reports. [#9](https://github.com/filaPro/cad-recode/issues/9#issuecomment-3009044652), [#11](https://github.com/filaPro/cad-recode/issues/11).

## Relevance for wonky

INFERRED best transfer: **synthetic construction + independent validation + geometric candidate reranking**, implemented freshly in FeatureScript/Bend. Start with random bounded line/arc planar regions and supported extrusions/unions, but deliberately add boundary cases and explicit unsupported labels instead of discarding every hard shape. Record seed, source program, operation provenance, dimensions, expected invariants and normalization transform. Keep a separate adversarial corpus for thin walls, tangencies, short edges and curved union failures; an all-valid synthetic corpus alone hides exactly the kernel failures wonky needs to fix. [Generator and failure motivation](https://arxiv.org/pdf/2412.14042v2).

INFERRED Bend mapping: deterministic U32 PRNG seeds per fixture; immutable sketch/edge arrays; sequential per-model feature history but balanced fork-join across candidates and validations; bucket by bounded primitive counts for uniform GPU work. Integer fixture parameters fit U32/sign representations exactly, while circle intersections and Boolean validity still need F32x2 or multi-limb predicates. F32x2 cannot recover details already rounded away by the training representation. Avoid adopting ±100 integer quantization for real FDM tolerances; preserve dimensioned parameters and choose quantization only for a deliberately scoped learning experiment. [Quantization and algorithm evidence](https://arxiv.org/pdf/2412.14042v2).

INFERRED architecture: keep any optional inference model in a frontend authoring service; do not embed PyTorch, PythonOCC or CadQuery into the standalone Bend kernel. The no-FFI production-geometry rule is compatible with accepting generated FeatureScript as input, not with using CadQuery as hidden geometry backend. Porting the full Qwen inference stack to Bend is disproportionate to the kernel problem. [Implementation dependencies](https://github.com/filaPro/cad-recode/blob/03e3262119b38939feaa44b8368ad8db99243d47/Dockerfile).

INFERRED UX transfer: expose semantic parameters through typed metadata and deterministic edits instead of asking an LLM to regenerate on every slider movement. App. G demonstrates an LLM refactor into function parameters and ipywidgets, but does not verify geometry equivalence before/after the refactor or bounds throughout slider ranges. Wonky can improve this with AST-bound parameter IDs, provenance-aware diffs, original-parameter replay and admissible-range validation. This is a proposed design, not a paper guarantee. [Paper Figure 6, App. G/Figure 18](https://arxiv.org/pdf/2412.14042v2).

## Pointers worth porting or studying

- Paper Algorithms 1–2 (p.10), Figure 14 (p.15), Tables 3/5 (p.8), App. G/Figure 18 (editing).
- demo.ipynb: FourierPointEncoder, CADRecode.forward, mesh_to_point_cloud, prediction/export and metrics cells. [Pinned notebook](https://github.com/filaPro/cad-recode/blob/03e3262119b38939feaa44b8368ad8db99243d47/demo.ipynb).
- Local <repo>/tmp/research/cad-recode-rukhovich-et-al-iccv-2025 ; <repo>/tmp/research/pdf/cad-recode-rukhovich-et-al-iccv-2025.pdf . No weights/data corpus downloaded, no model/build/test run.

## Verdict: learn-from

Strong reference for familiar executable CAD code, procedural fixture synthesis and verification-aware reranking. Do not confuse the inference notebook with a released generator, or the 16.8% no-search CC3D failure rate with the best-of-ten result. NC licensing, missing generator/training code, quantization and narrow operation coverage favor independent ideas-only implementation in wonky. Original training pipeline, macOS numerical issue and robust edit-equivalence checks remain unverified/open.
