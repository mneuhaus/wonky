# LLM-driven code CAD

Chapter of the wonky research knowledge base, 2026-09-24. English.

**Status and method.**

- **Deep reads.** 17 source notes cover this topic. They are under
  [sources/](sources/) and linked in section 2. This chapter read all 17 in
  full.
- **Publish-first step.** All 17 notes existed only as JSON in
  `tmp/research/notes/`. Their Markdown files were written from the JSON
  `markdown` field verbatim. The only fix was syntactic: in 10 files, blank
  lines were inserted where two paragraphs, or a list and the paragraph after
  it, sat on consecutive lines and would have merged when rendered.
- **Workflow input.** The scout's landscape and catalog. The 24 catalog-only
  sources are in section 7.
- **Checks made for this chapter** (working tree, read only, 2026-09-24):
  - [../FACTSHEET.md](../FACTSHEET.md), `AGENTS.md`,
    ../development record.md;
  - [../geometry-summary.md](../geometry-summary.md) (`wonky-inspect`),
    [../cadbench.md](../cadbench.md), [../language.md](../language.md) §1 and
    §8, [../language/prior-art.md](../language/prior-art.md) §1 and §4,
    [../khana.md](../khana.md) and [../khana/design.md](../khana/design.md)
    §3, §4.2 and §6.3;
  - the help texts of `bin/wonky.mjs` and `bin/wonky-compare.mjs`,
    `src/errors.mjs`, and the `ev*` builtins in `src/queries.mjs`;
  - `gh api` / `gh search repos` for the catalog repositories (section 7).
- Nothing was built or run: a CPU benchmark is running on this machine.

**Labels.**

- **DOCUMENTED**: read in a primary source, either by the note author or for
  this chapter. The link leads to the note, and the note carries the primary
  URL.
- **INFERRED**: reasoning from evidence, including derivations the note
  authors added but did not prove.
- **HEARSAY**: secondhand, or self-reported by an interested party and not
  reproduced.

**Corrections to the scout's framing.** The deep reads changed several
statements of the landscape. Each item names the note that carries the
evidence.

1. **The bake-off is decided** (DOCUMENTED,
   [mesh-booleans.md](mesh-booleans.md) and
   [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md)). corefine decides
   topology, recover rebuilds the exact B-rep or refuses by name, and
   `--boolean hybrid-last` is the default in `bin/wonky.mjs`. The proposals
   in section 5 relate to that decided design, not to a running contest.
2. **FeatureScript as an LLM target is not unresearched.** CADFS (CVPR 2026,
   arXiv 2605.01925) fine-tuned on 451k *standardized* FeatureScript programs
   rebuilt from Onshape documents. Makatura et al. (2023) found that GPT-4
   "performs poorly" on raw FeatureScript and fell back to a mini DSL; the
   paper does not show that models write raw FeatureScript well. Both are
   DOCUMENTED in [../language/prior-art.md](../language/prior-art.md) §4 and
   were not re-read here. The Onshape Labs MCP server shows product intent,
   not a measured success rate
   ([note](sources/onshape-featurescript-mcp-server-onshape-labs-ptc.md)).
3. **CAD-Assistant's over-parameterized JSON did not win.** It scored 0.747
   against 0.748 for point-based JSON
   ([note](sources/cad-assistant-mallis-et-al-iccv-2025.md)). The supported
   recommendation is "explicit point-based fields", not "redundant fields".
4. **SpatialClaw's controlled interface gain is +3.2 points**, not +11.2
   (59.9 against 56.7 for structured tool calls, same backbone and tools, on
   spatial VQA, not CAD). The +11.2 compares against a different prior system
   ([note](sources/spatialclaw-rethinking-action-interface-for-agentic-spatial-.md)).
   [../language/prior-art.md](../language/prior-art.md) §4.1 and §4.3 repeat
   the +11.2 and should be corrected by its owner.
5. **Arko-T measures no design-state preservation** and runs no ±ε audit. Its
   12 numbers are invalid rate, Chamfer distance and IoU over four splits;
   edit evaluation is listed as future work
   ([note](sources/arko-t-text-to-structured-3d-bitinf-wuhan-u.md)). The
   perturbation audit belongs to build123d-mcp's `design_audit`.
6. **CADGenBench**: the evaluator is Apache-2.0, the public dataset is
   **ODC-BY**, full scoring needs private ground truth, and the interface
   score is `min over features of max over poses`, not one common pose
   ([note](sources/cadgenbench-hugging-face-ai4engineering.md)).
7. **CAD-Recode's 16.8 % invalid rate** on CC3D is the no-sampling ablation;
   the reported best-of-ten system has 0.3 %
   ([note](sources/cad-recode-rukhovich-et-al-iccv-2025.md)).
8. **CADFit is CC BY-NC 4.0** and its README claims a provisional patent
   application; it is not unlicensed
   ([note](sources/cadfit-nehme-whalen-ahmed-icml-2026.md)).
9. **Text2CAD-Bench's "15 % to 70-90 % invalid at L3"** is the paper's
   narrative, not a law: Gemini-3-Flash has 12.8 % at geometric L3, and all
   published results include up to three error-feedback retries
   ([note](sources/text2cad-bench-wang-et-al-may-2026.md)).
10. **CADCodeVerify's 64.6 % / 68.2 %** are correct answers with 26.6 % /
    19.3 % "Unclear" beside them. Its numeric-feedback arm had ground-truth
    access and was not better for CodeLlama
    ([note](sources/cadcodeverify-cadprompt-alrashedy-et-al-iclr-2025.md)).
11. **"CADBench" names three benchmarks.** MIT's CADBench (Doris et al.,
    arXiv 2605.10873, read here), gNucleus-AI's CAD-Bench v2 at cadbench.ai
    (FreeCAD, 100 tasks; wonky already runs a local pilot, see
    [../cadbench.md](../cadbench.md)), and BlenderLLM's CADBench (arXiv
    2412.14203, catalog only). Cite them by URL, never by name alone.
12. **wonky already has part of the recommended surface** (section 1.6): a
    revision-bound LLM overview, uncatchable capability errors with source
    positions, `--check` and `--param`, and a designed (not implemented)
    tri-state check core. Several scout recommendations are therefore
    "connect and finish", not "invent".

---

## 1. Landscape

### 1.1 Three strands and their lineages

**Strand A: learned generators that emit programs.** DOCUMENTED unless
marked.

- **Root: DeepCAD (2021).** 178,238 Onshape sketch-and-extrude histories as
  quantized vectors. It is the data under CADPrompt, Text2CAD and most
  Chamfer/IoU evaluation until 2025
  ([note](sources/deepcad-dataset-and-onshape-cad-parser.md), a dataset note
  that belongs to no chapter yet).
- **Tokens gave way to code.** Text2CAD (NeurIPS 2024) still emitted DeepCAD
  tokens. From late 2024 the target became CadQuery Python: CAD-Recode
  (point cloud to CadQuery, 1M procedurally generated programs), then
  Text-to-CadQuery, two different works named CAD-Coder, cadrille (online RL)
  and CADEvolve (evolved scripts; 1.3M per the scout). Arko-T (June 2026)
  targets build123d with 1.3M prompt/program pairs; CADFS (CVPR 2026) targets
  standardized FeatureScript
  ([CAD-Recode](sources/cad-recode-rukhovich-et-al-iccv-2025.md),
  [Arko-T](sources/arko-t-text-to-structured-3d-bitinf-wuhan-u.md),
  [../language/prior-art.md](../language/prior-art.md) §4.1).
- **Search instead of generation.** CADFit fits a mesh with extrude, revolve,
  fillet and chamfer candidates, executes each, and accepts by IoU, then
  reconstructs missing and excess residuals. On MIT's CADBench it reaches
  aggregate IoU 0.859 against 0.673 for CAD-Recode, and the paper finds
  specialized mesh-to-CAD methods well ahead of code-generating VLMs. The
  price is time: 453 s mean per shape for CADFit against 2.1 s for
  CAD-Recode, both on the paper's local GPU workstation
  ([CADFit](sources/cadfit-nehme-whalen-ahmed-icml-2026.md),
  [CADBench](sources/cadbench-doris-ahmed-et-al-mit-may-2026.md)).
- **The data engines.** CAD-Recode's generator is 3 to 8 random rectangles
  and circles, unioned and cut, serialized as lines and arcs, extruded on
  canonical planes, quantized to integers in [-100, 100], and filtered with
  BRepCheck. The generator itself was never released. BenchCAD builds 106
  families from typed parameter schemas, samplers and validators. Zero-to-CAD
  (about 1M agent-synthesized sequences) and CADEvolve are catalog-only
  (scout, not verified here).

**Strand B: agents and tooling around existing kernels.**

- **Self-review loops (2024).** 3D-PreMise, Query2CAD and CADCodeVerify ask a
  VLM about renders and rewrite the code. CADCodeVerify generates 2 to 5
  yes/no questions from the prompt and answers them from four views
  ([note](sources/cadcodeverify-cadprompt-alrashedy-et-al-iclr-2025.md)).
- **Tool-augmented planners.** CAD-Assistant (ICCV 2025) writes Python
  actions against FreeCAD, with sketch and solid recognizers that return JSON
  plus labelled renders, and a constraint checker that previews whether a
  constraint moves geometry
  ([note](sources/cad-assistant-mallis-et-al-iccv-2025.md)).
- **MCP servers (2025-2026).** build123d-mcp has the richest verification
  surface; jarvis-onshape-mcp and its upstream hedless wrap Onshape's REST
  API; freecad-mcp, blender-mcp and two OpenSCAD servers are catalog-only
  ([build123d-mcp](sources/build123d-mcp-pzfreo-and-its-cadgenbench-submission-pipeline.md),
  [jarvis](sources/jarvis-onshape-mcp-reshefelisha.md)).
- **Products with a language.** Zoo's Zookeeper writes KCL and runs it on
  Zoo's closed engine; its public agent socket returns KCL, not STEP
  ([Zoo](sources/zoo-design-studio-kittycad-modeling-app-and-zookeeper-agent.md),
  [KCL](sources/kcl-language-docs-and-introducing-kcl-zoo.md)). Onshape's
  FeatureScript MCP server (August 2026) generates reusable custom features.
  CADAM compiles LLM-written OpenSCAD in the browser and reviews seven views
  ([note](sources/cadam-adam-cad.md)). Autodesk Assistant and Backflip are
  commercial and catalog-only.
- **Interface research.** SpatialClaw runs one persistent Python cell per
  turn and wins against structured tool calls under a controlled comparison
  ([note](sources/spatialclaw-rethinking-action-interface-for-agentic-spatial-.md)).
  build123d-mcp v0.3.68 adopted the idea: measure, clearance and sections
  became callable inside `execute()`. Anthropic's tool-writing guidance
  (2025) supplies the evaluation discipline
  ([note](sources/anthropic-engineering-writing-effective-tools-for-agents.md)).

**Strand C: evaluation.**

- **Until 2025:** Chamfer distance and IoU on normalized DeepCAD shapes,
  computed only on outputs that executed.
- **2026: validity-gated, multi-axis, execution-verified.**
  - CADGenBench (Hugging Face): hard validity gate; then surface F1 plus mesh
    volume IoU, keep-in and keep-out interface regions, and solid Betti
    numbers; 32 STEP edits scored against a no-op baseline
    ([note](sources/cadgenbench-hugging-face-ai4engineering.md)).
  - BenchCAD: 106 families, 748 edit pairs, a quarantine taxonomy for
    generation errors, and eight semantic edit-failure codes F01 to F08
    ([note](sources/benchcad-may-2026.md)).
  - MIT CADBench: 18,000 shapes, five input modalities, IoU plus thresholded
    surface coverage (SIoU), Chamfer, validity and source compactness
    ([note](sources/cadbench-doris-ahmed-et-al-mit-may-2026.md)).
  - Text2CAD-Bench: feature tiers L1 to L4 with paired geometric and
    procedural prompts ([note](sources/text2cad-bench-wang-et-al-may-2026.md)).
  - gNucleus CAD-Bench v2: 100 FreeCAD tasks, one attempt each, geometry
    score and parameter-consistency score combined by harmonic mean; a
    submission needs the editable `answer.FCStd` and its generating
    `answer.py`, so a STEP file alone cannot enter
    ([../cadbench.md](../cadbench.md)).

### 1.2 Trends 2024-2026

1. **Execution is the filter everywhere.** Training data is execution
   filtered (CAD-Recode, Arko-T, BenchCAD), inference reranks executed
   candidates by geometry (CAD-Recode best-of-ten), and agents loop on
   compiler output (CADAM, the CADGenBench baseline). DOCUMENTED.
2. **Numbers are becoming the primary feedback; pictures remain for gross
   errors.** The CADGenBench reference agent injects validity, watertightness,
   solid and face counts, volume and bbox plus one iso render.
   build123d-mcp's guidance is measure, then clearance, then render, and it
   warns that a plausible render proves nothing. Zookeeper measures centre of
   mass, mass, area and volume. CADSmith (in the language prior-art) moved
   median IoU from 0.81 to 0.96 with kernel measurements plus a VLM judge.
   DOCUMENTED.
3. **From shape to design state and edits.** Arko-T formalizes a design as
   features, named parameters, constraints, history and attachments. BenchCAD
   and CADGenBench add edit tasks scored against the unedited input. CADAM
   edits parameters without the model, and Zoo scopes agent requests to a
   selected face plus its source span. DOCUMENTED.
4. **Python dominates as the written language.** FeatureScript works only
   after standardization (CADFS: raw FS 56 % invalid, standardized 10 %;
   still 9 % against 3 % for the CadQuery baseline). DOCUMENTED in
   [../language/prior-art.md](../language/prior-art.md) §4.2.
5. **Explicit failure is becoming a feature, but implementations lag.**
   build123d-mcp reports UNVERIFIED after issue #381; KCL publishes a known-
   issues capability list; CADGenBench gates validity before scoring. Yet the
   same period's evaluators still turn internal failures into the number 0
   (section 4.1). DOCUMENTED.
6. **Tool surfaces shrink and move into code.** build123d-mcp hides
   inapplicable tool groups and exposes analysis inside `execute()`;
   Anthropic recommends a few workflow tools with concise and detailed modes.
   DOCUMENTED.

### 1.3 Where the guarantees actually sit

INFERRED from the 17 notes:

- **Validity is always the kernel's own checker plus a mesh heuristic.**
  OCCT `BRepCheck_Analyzer` plus closed, consistently wound, manifold
  tessellation (CADGenBench, build123d-mcp); BRepCheck alone (CAD-Recode's
  data filter); "nonempty valid solid" without a stated API (Arko-T);
  OpenSCAD's exit code (CADAM); Onshape `featureStatus`, where INFO counts as
  ok (jarvis). None checks self-intersection exactly.
- **Similarity is sampled, voxelized, normalized and sometimes repaired.**
  2,048 to 100,000 surface samples, 64³ to 256³ occupancy grids,
  per-shape normalization to a unit box (BenchCAD, Text2CAD-Bench,
  CADCodeVerify, MIT CADBench, Arko-T), and alpha-wrapping before measuring
  (MIT CADBench, CADFit). Only CADGenBench keeps absolute scale (rigid
  alignment, never scale).
- **No number carries an error bound.** Thresholds are scale-relative
  (`0.005 × GT diagonal`, `1 %` of the diagonal) or fixed constants copied
  from double-precision code (`1e-9`, `1e-12`).

### 1.4 What is conspicuously missing

- **Printability and manufacturability.** No benchmark scores walls,
  overhangs, bores, clearances or FDM fits. CADGenBench's interface regions
  come closest; Text2CAD-Bench's L4 asks a VLM about exterior views.
  DOCUMENTED absence across the five benchmark notes.
- **Certified verification in the loop.** Every tool sits on floating-point
  OCCT, Parasolid, OpenSCAD/Manifold or Zoo's closed engine. INFERRED.
- **Absolute millimetres.** BenchCAD, MIT CADBench, Text2CAD-Bench and
  CADPrompt normalize each shape's scale away, so a wrong-unit part can score
  well. CADGenBench keeps scale; gNucleus's geometry score was not read at
  that depth. DOCUMENTED per note.
- **Joint fit.** CADGenBench maximizes each interface feature's pose
  separately, so two features needing incompatible poses can both score
  well. Text2CAD-Bench's L4 and Arko-T are single-body by design.
  DOCUMENTED.
- **Reference survival across edits.** Nobody measures whether an agent's
  face and edge selections still select the intended entity after a
  parameter edit. BenchCAD's F05 ("wrong selector/face") labels the failure
  but does not test survival. DOCUMENTED absence; INFERRED importance.
- **Evaluator failure as its own state.** BenchCAD's IoU, MIT CADBench's
  CPU fallback and CADFit's IoU all return 0.0 on internal failure.
  CADGenBench renormalizes weights over axes it could not compute.
  DOCUMENTED.
- **Real sandboxes.** BenchCAD's `exec_cq`, CADBench's `get_mesh_safe` and
  CAD-Recode's demo run generated Python with full builtins; a timeout is not
  isolation. DOCUMENTED.
- **Controlled interface ablations on CAD tasks.** SpatialClaw's is on
  spatial VQA; build123d-mcp's 0.360 to 0.457 is uncontrolled and
  self-reported (HEARSAY); jarvis's evaluation compares one human and one
  agent on two models. DOCUMENTED.

### 1.5 The language question is already settled for now

[../language.md](../language.md) (2026-09-22) decided: no new syntax, an
internal content-addressed graph IR (WK/0) on the host, and a measured LLM
study (H6: 10 to 20 of Marc's parts; build123d on CPython, raw FS, WPy with
check, WPy with check and graph) before any authoring dialect. The deep reads
here agree (INFERRED): every effect with good evidence comes from feedback,
identifiers, explicit frames and error classes, none from syntax. This
chapter therefore treats the frontends as fixed (unmodified FeatureScript,
and the build123d subset in Python) and asks what the kernel and host should
*return* to an agent.

### 1.6 Where wonky stands (working tree, 2026-09-24; DOCUMENTED)

| part | file | state |
|---|---|---|
| frontends | `src/interpreter.mjs`, `src/python.mjs`, `bin/wonky-python.mjs` | unmodified FeatureScript; real Python with a limited build123d algebra API. All 37 Python files that were blocked on a name now run to a precise message about the missing kernel operation (morning report, commit `903dde5`) |
| LLM overview | `src/geometry-summary.mjs`, `bin/wonky-inspect.mjs` | summary bound to the model's SHA-256; aliases `B1.F2`; `detail()` and `lookup()`; unknown volume and bounds stay `null`; computes no distances, interference or mass properties. Measured: r10b-retained summary 18,120 tokens (JSON), body overview 1,094 |
| errors | `src/errors.mjs` | `FeatureScriptException` (catchable, only where Onshape would raise) and `UnsupportedFeatureError` (never caught by `try silent`), both with line and column. `--format r20-check` writes `error.json {class, message, file, line, column}` and retires older outputs |
| measurement inside FS | `src/queries.mjs` | `evVolume` (solids only; refuses when the integrated relative bound exceeds its limit), `evBox3d` (refuses mesh bodies), `evLine`, `qCreatedBy`, `qContainsPoint`. `evDistance`, `evArea`, `evCollision` do not exist; khana design §6.3 plans them as thin wrappers over its Q6/Q1 primitives |
| parameters | `bin/wonky.mjs` | `--param 'name=expression'` overrides a FeatureScript parameter; `--check` builds and validates without exports |
| comparison | `bin/wonky-compare.mjs` | "geometric changes and interference measured in Bend", scoped to one coaxial-cylinder primitive per input; other B-reps fail explicitly |
| checks | [../khana/design.md](../khana/design.md) | designed, not implemented: verdicts pass / fail / unresolved / refused / not-run / waived; value labels exact / bounded / estimate / approximation / refused; Bend primitives Q1 to Q14; "the host never computes a distance" |
| graph IR | [../language.md](../language.md) | WK/0 plan: recorder, preflight with source spans, graph diff (r10b hash 4 ms, diff 9.7 ms); `wonky graph --check --diff` proposed as an MCP tool |
| benchmark | [../cadbench.md](../cadbench.md), `scripts/cadbench*.mjs` | local pilot on gNucleus CAD-Bench v2 specs: 5 FS cases, 4 pass, 1 unsupported (square washer); 0/100 official tasks scored; 10 probes adapted from build123d tests |
| Boolean | `src/boolean.mjs`, `kernel/hybrid/` | `hybrid-last` default; the hybrid answers `exact`, `mesh <dev> <reason>` or `unresolved` ([mesh-booleans.md](mesh-booleans.md) §1.7) |
| viewer | `viewer/`, review server | selection, compare, annotations; "Copy selected geometry" puts the detail packet into LLM feedback |

There is no MCP server (grep over `src/`, `bin/` and `scripts/` finds "mcp"
only in the native binding and a report generator).

### 1.7 Licensing for porting (INFERRED, not legal advice)

wonky has no open-source licence (all rights reserved). Noncommercial licences
are off limits for anything that may be used commercially.

| class | sources | what wonky may do |
|---|---|---|
| permissive code | build123d-mcp and its harness (Apache-2.0), CADGenBench evaluator (Apache-2.0), BenchCAD harness (MIT), MIT CADBench code (MIT), KCL interpreter and modeling-app (MIT), jarvis-onshape-mcp (MIT), gNucleus CAD-Bench dataset (Apache-2.0, per [../cadbench.md](../cadbench.md)) | port or transliterate with notices |
| open data and papers | CADGenBench data (ODC-BY), BenchCAD data (CC BY 4.0), Text2CAD-Bench preview (CC BY 4.0), SpatialClaw paper (CC BY 4.0), Arko-T paper (CC BY-SA 4.0: share-alike applies to copied text) | attribute; fixtures derived from them carry the notice |
| copyleft | CADAM (GPL-3.0, bundles OpenSCAD WASM) | re-implement the UX ideas; do not copy code unless GPL is chosen deliberately |
| noncommercial | CAD-Recode, CAD-Assistant, CADFit (all CC BY-NC 4.0; CADFit also claims a provisional patent), SpatialClaw code (NVIDIA research-only), MIT CADBench's Fusion 360 subset | papers only; no code, weights or data |
| no licence | CADCodeVerify/CADPrompt repository | do not copy; author fresh fixtures |
| proprietary | Onshape FeatureScript MCP, Zoo's engine and agent backend | public contracts only (FsDoc semantics, the public Zoo OpenAPI schema) |
| guidance | Anthropic engineering article | cite the principles |

None of the 17 sources contains a geometry kernel worth porting to Bend:
each delegates geometry to OCCT, Parasolid, OpenSCAD/Manifold, FreeCAD or
Zoo's closed engine. Their value is protocol and API design, metrics and
failure data. INFERRED.

---

## 2. Comparison table

Status and stars as recorded by the note authors with `gh api` on
2026-09-24.

| name | kind | status | license | verdict | key idea (one line) | note |
|---|---|---|---|---|---|---|
| build123d-mcp + cadgenbench-build123d (pzfreo) | Python MCP server + benchmark harness | very active: v0.3.85, commit 2026-09-24, 93★ | Apache-2.0 | **adapt** | measure-first agent workbench: source-hash transactions, analysis inside `execute()`, coverage-aware validity gate, clearance classes, ±ε parameter audit | [link](sources/build123d-mcp-pzfreo-and-its-cadgenbench-submission-pipeline.md) |
| CADGenBench (Hugging Face) | benchmark + evaluator | new: evaluator 2026-07-17, 131★, v0.1.0 | code Apache-2.0; data ODC-BY | **adapt** | validity gate, then surface F1 + volume IoU, keep-in/keep-out interface regions, solid Betti numbers; edits scored against a no-op baseline | [link](sources/cadgenbench-hugging-face-ai4engineering.md) |
| Onshape FeatureScript MCP (Onshape Labs) | commercial early-access service | announced 2026-08-11/13; schemas not public | proprietary | learn-from | text to a reusable FS custom feature; the implementable part is FsDoc's query/evaluation semantics | [link](sources/onshape-featurescript-mcp-server-onshape-labs-ptc.md) |
| CADCodeVerify / CADPrompt | paper (ICLR 2025) + 200 examples | static: last commit 2025-02-28, 65★, verifier code never released | none found | learn-from | self-generated yes/no questions answered from four renders; "Unclear" is a real answer | [link](sources/cadcodeverify-cadprompt-alrashedy-et-al-iclr-2025.md) |
| KCL language (Zoo) | language docs + open interpreter | active: kcl-186 2026-09-22; KCL 3 in preview | MIT (engine closed) | **adapt** | `var` seeds vs constraints; `faceOf` (attached) vs `planeOf` (detached); published capability limits | [link](sources/kcl-language-docs-and-introducing-kcl-zoo.md) |
| Zoo Design Studio + Zookeeper | CAD app + agent | active: v1.4.10, 1,303★, 53 contributors | MIT app; engine and agent closed | **adapt** | artifact graph from selection to source span; typed patches; revision fences with accepted/merged/stale/conflict | [link](sources/zoo-design-studio-kittycad-modeling-app-and-zookeeper-agent.md) |
| jarvis-onshape-mcp | Python MCP server | HEAD 2026-04-22, 172★; upstream hedless active 2026-09-10 | MIT | **adapt** | one-call state snapshot, filtered entity lists with frames, feature status beyond HTTP 200; point distances and AABB-only interference | [link](sources/jarvis-onshape-mcp-reshefelisha.md) |
| SpatialClaw (NVIDIA) | paper + research code | preprint 2026-06; code 2026-07-17, 387★ | paper CC BY 4.0; code NVIDIA NC | learn-from | one persistent code cell per turn with observations; frame-ID typed data; +3.2 points over structured tool calls (controlled) | [link](sources/spatialclaw-rethinking-action-interface-for-agentic-spatial-.md) |
| BenchCAD | paper + dataset + harness | HEAD 2026-07-24, 73★, errata maintained | data CC BY 4.0; harness MIT | **adapt** | 106 typed families, 748 edit pairs, quarantine classes, edit-headroom score, semantic edit failures F01 to F08 | [link](sources/benchcad-may-2026.md) |
| CAD-Assistant | paper (ICCV 2025) + partial code | HEAD 2025-10-30, 82★; checker never released | code CC BY-NC 4.0; paper CC BY-NC-ND | learn-from | planner acting in FreeCAD; labelled renders plus JSON; constraint-impact preview (PF1 0.747 to 0.979) | [link](sources/cad-assistant-mallis-et-al-iccv-2025.md) |
| Anthropic: Writing effective tools for agents | engineering article (2025-09-11) | reference | copyright | **adopt** | few workflow tools, concise/detailed modes, actionable errors, held-out evals, read raw transcripts | [link](sources/anthropic-engineering-writing-effective-tools-for-agents.md) |
| Arko-T | paper (preprint 2026-06) | no code or weights found | paper CC BY-SA 4.0 | learn-from | design state z = (features, parameters, constraints, history, attachments); no edit-preservation metric | [link](sources/arko-t-text-to-structured-3d-bitinf-wuhan-u.md) |
| MIT CADBench | benchmark + evaluator | HEAD 2026-06-18, 22★ | MIT code; data mixed, some NC | **adapt** | 18k shapes × 5 modalities; IoU, SIoU, CD, validity, compactness; rankings change with the metric; code differs from paper | [link](sources/cadbench-doris-ahmed-et-al-mit-may-2026.md) |
| Text2CAD-Bench | paper + partial prompt preview | 151-row preview; evaluator unreleased | CC BY 4.0 | learn-from | L1 to L4 feature tiers; paired geometric/procedural prompts; retries inside the results; preview contradictions | [link](sources/text2cad-bench-wang-et-al-may-2026.md) |
| CAD-Recode | paper (ICCV 2025) + weights | HEAD 2025-11-16, v1.5, 264★; generator unreleased | CC BY-NC 4.0 | learn-from | point cloud to CadQuery; 1M procedural programs; best-of-ten reranking by Chamfer distance | [link](sources/cad-recode-rukhovich-et-al-iccv-2025.md) |
| CADFit | paper (ICML 2026) + code | HEAD 2026-06-17, 55★ | CC BY-NC 4.0 + claimed provisional patent | learn-from | propose, execute, validate, accept; residual correction; heuristic with a gap in its convergence proof | [link](sources/cadfit-nehme-whalen-ahmed-icml-2026.md) |
| CADAM | browser app | active: v0.3.0, commit 2026-09-18, 5,175★ | GPL-3.0 | **adapt** | LLM to OpenSCAD to WASM compile to seven-view review; source-derived sliders edit without the model | [link](sources/cadam-adam-cad.md) |

---

## 3. State of the art: techniques, their real guarantees, where they break

### 3.1 Execution filtering and geometric reranking

**Technique.** Generate several programs, execute each, drop failures, rank
the survivors by distance to an observation. CAD-Recode samples ten programs
from different point subsets and keeps the one with the smallest Chamfer
distance to the input cloud. Text2CAD-Bench allows three retries with error
feedback and reports the best attempt. CADFit accepts a candidate operation
only if IoU does not drop. DOCUMENTED
([CAD-Recode](sources/cad-recode-rukhovich-et-al-iccv-2025.md),
[Text2CAD-Bench](sources/text2cad-bench-wang-et-al-may-2026.md),
[CADFit](sources/cadfit-nehme-whalen-ahmed-icml-2026.md)).

**Real guarantee.** The winner executed in the author's kernel and passed
that kernel's checker. Nothing more: not the intended dimensions, walls,
features or history. Search budget changes the numbers a lot: CAD-Recode's
CC3D invalid rate is 16.8 % without sampling and 0.3 % with ten samples.
DOCUMENTED.

**Where it breaks.** DOCUMENTED unless marked.

- **Representation limits.** CAD-Recode quantizes coordinates to integers in
  [-100, 100]; cylinder heights below one step round to zero, and revolves or
  B-splines come back as cylinders and arcs, sometimes as self-intersecting
  loops (paper Figure 14).
- **More search can hurt.** CADFit's mean IoU fell from 0.826 to 0.510 when
  axis slices doubled from 5 to 10 (Table 9). Its released pruning accepts a
  loss below 0.005 IoU per removed operation, and outer residual updates are
  accepted without a rollback gate.
- **Survivorship.** Text2CAD-Bench's CD and IoU cover valid outputs only. Its
  domain-trained Text2CAD baseline has 2.0 % invalid at L3, but CD 234.00 and
  IoU 0.04: reliably wrong rather than reliably right.
- **Platform drift.** CAD-Recode issue #5 reports poor output on macOS; the
  author blames floating-point differences and recommends pinned Linux Docker
  (author diagnosis, not verified).

**Bend fit** (INFERRED). Candidate execution and validation are independent
jobs, the ideal case for balanced fork-join. A fixture generator needs only a
U32 PRNG seed per case and immutable sketch arrays.

### 3.2 Visual self-verification

**Technique.** A VLM answers questions about renders. CADCodeVerify: 2 to 5
self-generated yes/no questions, four views, answers Yes/No/Unclear, rewrite
from the non-Yes answers, stop when all are Yes. CADAM: compile, render a
seven-view sheet, return it to the model. Text2CAD-Bench L4: eight exterior
views scored 0 to 10 by a VLM judge. DOCUMENTED
([CADCodeVerify](sources/cadcodeverify-cadprompt-alrashedy-et-al-iclr-2025.md),
[CADAM](sources/cadam-adam-cad.md)).

**Real guarantee.** None. Manual review of CADCodeVerify's answers found
64.6 % correct, 8.8 % incorrect and 26.6 % Unclear after the first
refinement; 68.2 / 12.5 / 19.3 % after the second. Its feedback prompt
explicitly avoids scale and dimension fixes, so the loop is blind to
millimetres by design. The authors warn that a desk whose legs float off the
top still scores a low point distance. DOCUMENTED.

**Where it breaks.** Hidden cavities and sub-resolution tolerances are
invisible. CAD-Assistant's human audit of wrong answers found reasoning
errors and misread renders (a trapezoid read as a triangle). In CADAM, a
failed preview upload silently degrades to code-only review. DOCUMENTED.

**What survives.** Renders whose labels match the IDs in the accompanying
JSON help: CAD-Assistant's precise renders scored 0.754 against 0.616 for
hand-drawn input. As a *secondary* check for gross errors, renders are
cheap and useful. INFERRED.

### 3.3 Numeric observation snapshots

**Technique.** After each step, return one structured state:

- build123d-mcp `measure`: volume, topology, surface types with cylinder
  diameter and axis, cone angle; identical records condensed; small
  non-analytic faces summarized but analytic faces always kept;
- jarvis `describe_part_studio`: feature statuses, classified faces with
  origin, outward normal and sketch frame, bbox, mass properties and renders
  in one agent call; `list_entities` filters before serialization and echoes
  the filters with original and filtered counts;
- CAD-Assistant: sketch JSON with primitive IDs, construction flags and
  constraints, plus a render labelled with the same IDs;
- wonky `geometry-summary`: bound to the model hash, aliases per entity,
  unknown values `null`.

DOCUMENTED ([build123d-mcp](sources/build123d-mcp-pzfreo-and-its-cadgenbench-submission-pipeline.md),
[jarvis](sources/jarvis-onshape-mcp-reshefelisha.md),
[CAD-Assistant](sources/cad-assistant-mallis-et-al-iccv-2025.md),
[../geometry-summary.md](../geometry-summary.md)).

**Real guarantee.** The values are as good as the kernel's, *if* the
snapshot is consistent. Often it is not:

- jarvis gathers six independent requests with `return_exceptions=True` and
  fills failed sections with empty defaults; the snapshot is neither atomic
  nor revision-pinned;
- jarvis `measure` returns distances between representative points (face
  origin, edge midpoint), not closest-point distances between trimmed
  entities, and reports curved edge lengths as chords;
- build123d-mcp's snapshot diff compares rounded volume, counts and bbox
  size, so a moved hole prints "unchanged".

DOCUMENTED. wonky's inspector is stricter on exactly these points: stale
aliases fail, missing values stay `null`, and it computes no distances it
cannot back.

**Cost.** jarvis reports 80 to 100 KB for unfiltered entity lists; wonky's
full alias lookup for r10b-retained is 113,739 tokens, more than the raw
B-rep. Filters, concise modes and on-demand detail are not optional.
DOCUMENTED.

### 3.4 Code as the action interface

**Technique.** The agent writes code that runs in a persistent session and
calls analysis functions directly, instead of calling one JSON tool per step.
SpatialClaw: one Python cell per turn; observations are stdout, a concise
exception with the offending line, summaries of new variables, and shown
images. build123d-mcp v0.3.68 made measure, clearance, sections and
recognizers callable inside `execute()`. DOCUMENTED
([SpatialClaw](sources/spatialclaw-rethinking-action-interface-for-agentic-spatial-.md),
[build123d-mcp](sources/build123d-mcp-pzfreo-and-its-cadgenbench-submission-pipeline.md)).

**Evidence.** SpatialClaw's controlled comparison (Gemma4-31B, 20 spatial
benchmarks): no tools 53.4, single pass 55.2, structured tool calls 56.7,
code cells 59.9. The ablation on a smaller backbone: full 56.9, without
utility wrappers 56.4, without perception 51.4. An LLM judge attributes
52.2 % of wins to composition. Structured calls still won on size estimation
and spatial planning. None of it is CAD. DOCUMENTED.

**The transferable detail.** Per-frame containers carry absolute frame IDs,
so two arrays of the same shape from different frames cannot be combined by
accident. For CAD the analogue is revision, body, frame, units and tolerance
travelling with every value. INFERRED.

**Where it breaks.** SpatialClaw falls back to a best-effort answer when its
budget runs out; "always answers" is not correctness. Python introspection
is not a sandbox. Its own error analysis blames geometric computation
(20.6 %) and tool selection (18.4 %) for most wrong sessions. DOCUMENTED.

**wonky.** The FeatureScript interpreter already *is* a code-as-action
surface. What is missing is measurement inside it (`evDistance`, `evArea`,
`evCollision`), see section 1.6. INFERRED.

### 3.5 Validity gates

**Technique.** Before any similarity score, reject invalid geometry.

- CADGenBench: OCCT BRepCheck, closed shells, and a tessellation that is a
  closed, consistently wound, edge- and vertex-manifold mesh under a
  deflection ladder; slivers and large tolerances are advisory only.
- build123d-mcp `validate`: BRepCheck, every edge with two incident faces,
  positive volume, tessellation checks, and coverage fields that say which
  checks ran.

DOCUMENTED ([CADGenBench](sources/cadgenbench-hugging-face-ai4engineering.md),
[build123d-mcp](sources/build123d-mcp-pzfreo-and-its-cadgenbench-submission-pipeline.md)).

**Real guarantee.** A mesh at the tested deflection is manifold and closed.
Not: no self-intersection, correct orientation of every shell, or geometric
correctness. CADGenBench's solid Betti numbers come from inward-nudged
centroid probes and even/odd ray casts with epsilons (1e-12 determinant,
1e-9 grazing) and up to eight directions; if all graze, the answer is
"false", not "unknown". DOCUMENTED.

**Where it breaks.** Issue #381 of build123d-mcp: the fast fallback pinned
the open-edge count to zero, so fixture 240 passed 15 times while every
export had four open edges. The fix reports UNVERIFIED, but `passes_gate`
can still be true when the mesh check was skipped. CADGenBench trusts any
`<stem>.mesh.npz` sidecar and skips its checks. DOCUMENTED.

**wonky.** The certified print mesh with stated deviation, independent STEP
validation and the khana verdict rules (`pass` only with a closed form or a
verified enclosure, `unresolved` otherwise) are already a stronger contract
than any gate read here. INFERRED.

### 3.6 Similarity metrics and what each one hides

| metric | used by | what it hides (DOCUMENTED in the notes) |
|---|---|---|
| Chamfer distance | CAD-Recode, Text2CAD-Bench, MIT CADBench, BenchCAD, Arko-T | small features and wrong thickness; conventions differ (squared or not, ×1000 or not, one- or two-sided, 2k to 100k samples), so tables are not comparable across papers; MIT CADBench's code computes unsquared distances while the paper says squared |
| volume IoU | all six benchmarks | fine detail at high IoU (MIT CADBench Fig. 11); scale normalization erases millimetres; several implementations return 0.0 on internal failure |
| surface F1 / SIoU | CADGenBench, MIT CADBench | wrong wall thickness at high coverage; CADGenBench uses `abs(dot)` of normals, so flipped orientation passes; MIT CADBench's code uses a fixed 0.02 instead of the paper's 1 % of the diagonal |
| solid Betti numbers | CADGenBench | blind pockets and fillets do not change them; equal Betti numbers do not mean equal geometry |
| interface regions (keep-in, keep-out) | CADGenBench | each feature gets its own best pose; scale-relative windows instead of mm tolerances; only authored features are checked |
| edit headroom `(s - b)/(1 - b)` | CADGenBench, BenchCAD | not a pass rate; a no-op edit can still collect up to 0.4 of CADGenBench's composed score; small headroom amplifies noise |
| rotation-maximized IoU (24 cube rotations) | BenchCAD appendix M | a diagnostic for wrong workplanes; as an acceptance metric it would pass a wrongly oriented mounting part; the current harness does not implement it |
| compactness (tokens, operation count) | MIT CADBench | Python `tokenize` counts, not billing tokens; a static AST count, not executed operations |
| VLM feature scores | Text2CAD-Bench L4 | exterior only; no agreement statistics published |

**Metrics disagree.** On about 1M valid MIT CADBench outputs, Spearman
rho(IoU, SIoU) = 0.57, rho(IoU, CD) = -0.73. Rankings change with the metric.
None of these metrics is a tolerance certificate. DOCUMENTED
([note](sources/cadbench-doris-ahmed-et-al-mit-may-2026.md)).

### 3.7 Parameters, constraints and edits

DOCUMENTED unless marked:

- **KCL separates seeds from intent.** `var 40mm` is a solver initial guess;
  dimensions are separate constraints. Freedom analysis labels entities
  Fixed, Free or Conflict. A non-converged solve still produces geometry with
  a diagnostic, and some linear-algebra failures fall back to the initial
  guesses with `converged:false`
  ([note](sources/kcl-language-docs-and-introducing-kcl-zoo.md)).
- **Preview before commit.** CAD-Assistant's constraint checker asks whether
  a proposed constraint is valid and whether it moves geometry. Within the
  framework, adding it raised PF1/CF1 from 0.747/0.329 to 0.979/0.484. The
  checker code was never released
  ([note](sources/cad-assistant-mallis-et-al-iccv-2025.md)).
- **Edits without the model.** CADAM derives sliders from the source, patches
  assignments after a 200 ms debounce and recompiles with no AI request; the
  original defaults are pinned for reset. Ranges and units are heuristics
  ([note](sources/cadam-adam-cad.md)).
- **Selection-scoped requests.** Zoo maps a selected wall or cap through the
  artifact graph to its segment and sweep source ranges and sends those with
  the prompt; writes carry a base revision and come back accepted, merged,
  rejected_stale or conflict
  ([note](sources/zoo-design-studio-kittycad-modeling-app-and-zookeeper-agent.md)).
- **Edit taxonomies.** BenchCAD's edit types T1 (literal) to T5 (multi-feature
  rebuild) and failure codes F01 (wrong value) to F08 (compositional
  mismatch); non-target preservation is checked outside the edited feature's
  bounding region ([note](sources/benchcad-may-2026.md)).
- **Perturbation.** build123d-mcp's `design_audit` rebuilds each top-level
  numeric literal at ±0.1 (at most 8 parameters) in a disposable process and
  reruns validity
  ([note](sources/build123d-mcp-pzfreo-and-its-cadgenbench-submission-pipeline.md)).

**Real guarantee.** Nobody measures whether an edit preserved what it should
have: Arko-T lists it as future work, BenchCAD's preservation check is a
bounding-region complement, and CADGenBench scores similarity only.
DOCUMENTED.

**wonky** (DOCUMENTED, [../sketch-lines.md](../sketch-lines.md)): the sketch
path is a bounded profile assembler with exact endpoint equality, not a
constraint solver; constraints are an explicit unsupported capability. That
avoids KCL's solver/engine epsilon mismatch (issue #14138) by construction,
and it means constraint preview is a future topic, not a current gap
(INFERRED).

### 3.8 Summary

| technique | best implementation read | real guarantee | breaks when | wonky counterpart today |
|---|---|---|---|---|
| execution filter + rerank | CAD-Recode | ran in the author's kernel and passed its checker | quantization, approximated unsupported operations, survivor-only metrics | `--check`, cadbench pilot |
| VLM self-review | CADCodeVerify, CADAM | none; about two thirds of answers correct, 19-27 % Unclear | dimensions, hidden cavities, fine tolerances | viewer renders (secondary) |
| numeric snapshot | jarvis, build123d-mcp | kernel values, if the snapshot is consistent | partial failures shown as empty, heuristic "unchanged" | `wonky-inspect`, revision-bound |
| code as action | SpatialClaw, build123d-mcp | none; +3.2 points controlled, on VQA | best-effort fallbacks, sandboxing | FS interpreter; `evDistance`/`evArea` missing |
| validity gate | CADGenBench, build123d-mcp | manifold mesh at the tested deflection | skipped checks still pass (#381); grazing rays answer "false" | STEP validation, certified print mesh, khana verdicts (designed) |
| similarity metrics | CADGenBench, MIT CADBench | sampled similarity, no bounds | fine detail, thickness, units, failure scored 0 | none |
| constraint preview / DOF | CAD-Assistant, KCL | solver status; KCL continues when not converged | contradictory constraints give no useful error (KCL #12327) | no constraint solver |
| deterministic parameter edits | CADAM, Zoo | recompile only | regex binding of array parameters | `--param`, WK/0 dirty sets (planned) |

---

## 4. War stories and anti-patterns

### 4.1 War stories (DOCUMENTED unless marked)

**Silent passes and failures scored as numbers.**

- **build123d-mcp #381.** The fast validity fallback pinned the open-edge
  count to zero: fixture 240 passed 15 times while every export had four open
  mesh edges. Fixed by an isolated exact check and an explicit "unverified"
  warning
  ([note](sources/build123d-mcp-pzfreo-and-its-cadgenbench-submission-pipeline.md)).
- **build123d-mcp clearance.** A failed Boolean volume probe becomes `None`,
  but a failed intersection is serialized as `intersection_volume: 0.0`, and
  containment can fall through to "neither". An agent reads "no
  interference" (same note).
- **MIT CADBench on a Mac.** The sampling IoU switches to CPU when CUDA is
  absent, then calls a ray routine that asserts CUDA tensors; the outer
  handler returns 0.0. On CPU-only hardware, a failed Trimesh Boolean is
  scored as disjoint geometry
  ([note](sources/cadbench-doris-ahmed-et-al-mit-may-2026.md)).
- **BenchCAD IoU** turns any exception into 0.0; on slower hardware 26 records
  were dropped by timeouts until the limit went from 90 to 300 s
  ([note](sources/benchcad-may-2026.md)).
- **CADFit IoU** returns zero on failure, alpha-wraps multi-body results, and
  code comments record about 50 % under-volume on slabs with holes before the
  current volume-consistency heuristic. Its emitted source sometimes uses
  CadQuery `.add()`, a non-fusing compound, while the scored mesh was a union
  ([note](sources/cadfit-nehme-whalen-ahmed-icml-2026.md)).
- **jarvis** treats Onshape's `INFO` status as `ok`. An extrude REMOVE from a
  picked face in the default direction cuts away from the material, removes
  nothing, and returns INFO. The server repairs this by silently flipping
  the direction
  ([note](sources/jarvis-onshape-mcp-reshefelisha.md)).

**Stopping, overconfidence and scoring artefacts.**

- **`conforms: true` as a stop signal.** build123d-mcp v0.3.67 disabled
  `verify_spec` by default after two sweeps scored worse with it; the author
  observed agents stopping at `conforms: true`. `conforms` means "no FAIL and
  at least one check ran", so it can be true with unchecked requirements.
  Observational, not randomized (same note).
- **CADGenBench interface score** maximizes each feature over poses
  separately and then takes the minimum; two features needing incompatible
  poses can both score well. A no-op edit can still collect up to 0.4. The
  benchmark's own issue #4 reports invalid input STEPs for three edit tasks
  ([note](sources/cadgenbench-hugging-face-ai4engineering.md)).
- **Workplane bias, measured.** In BenchCAD Table 14, GPT-4o's mean gain from
  rotation-maximized IoU is 0.046 for XY sketches but 0.231 for XZ and 0.214
  for YZ: the model builds on the wrong plane. Figure 6 adds a bolt without
  thread or chamfer and sweeps, lofts and twists replaced by sketch plus
  extrude ([note](sources/benchcad-may-2026.md)).
- **Human against agent** (jarvis RESEARCH.md, tiny exploratory eval): human
  spec composite 1.000 in 57 turns and 7 minutes against agent 0.533 in 147
  turns and 40 minutes; on a second model 0.615 against 0.000 with no export
  after 151 turns ([note](sources/jarvis-onshape-mcp-reshefelisha.md)).
- **Tool-call validity is not design validity.** CAD-Assistant's annotators
  judged 98.5 % of tool uses valid; errors were mostly FreeCAD API misuse,
  and QA mistakes were reasoning errors and misread renders
  ([note](sources/cad-assistant-mallis-et-al-iccv-2025.md)).

**Benchmarks with broken ground truth.**

- **CADPrompt 00005721** asks for an obtuse scalene triangle; the script
  encodes a right triangle
  ([note](sources/cadcodeverify-cadprompt-alrashedy-et-al-iclr-2025.md)).
- **Text2CAD-Bench preview**: the L1_1 geometric prompt specifies a 20 mm
  hole, the procedural prompt 50 mm; the CSV has 151 records, no L4, and is
  not valid UTF-8; the promised evaluator is not in the file manifest
  ([note](sources/text2cad-bench-wang-et-al-may-2026.md)).
- **BenchCAD errata**: 18 Code-QA rows with negative gold answers could never
  score; camera labels were antipodal to the rendered views (PR #1)
  ([note](sources/benchcad-may-2026.md)).
- **MIT CADBench** code and paper disagree on Chamfer squaring, the SIoU
  threshold and the IoU method, and the evaluator alpha-wraps both inputs
  before measuring
  ([note](sources/cadbench-doris-ahmed-et-al-mit-may-2026.md)).

**Language and engine failures on ordinary printed parts.**

- **KCL #7485**: the floor-and-walls union of a 3D-printed tape-measure wall
  mount returned "engine cannot handle this 3D union yet".
- **KCL #12327**: an impossible triangle-angle constraint set gave no useful
  error and no render.
- **KCL #14138**: the solver's coincidence epsilon and the engine's point
  deduplication epsilon disagree, so a solved triangle can become an open
  path.
- **Zoo #14107**: repeated `accum + accum` grew source-location metadata
  exponentially (293.6 MiB against 43.4 MiB for `accum + 1`).
- **Zoo #14116**: byte-identical KCL circle extrusions sometimes showed a
  polygonal cap; geometry, tessellation or viewport was never settled.
- **Zoo #12709**: seven failed attempts to derive loft sketch constraints
  before a literal template worked in under eight minutes.

([KCL](sources/kcl-language-docs-and-introducing-kcl-zoo.md),
[Zoo](sources/zoo-design-studio-kittycad-modeling-app-and-zookeeper-agent.md)).

**Parameter plumbing.**

- **CADAM** flattens `size=[10,20,30]` into controls `size[0]` to `size[2]`,
  but the patcher searches for a literal `size[0]=` assignment, so these
  sliders cannot change the source (static finding, not executed). It also
  creates a fresh OpenSCAD WASM instance per compile because reuse produced
  opaque numeric exceptions. Issue #181: some requests yield prose and an
  empty preview ([note](sources/cadam-adam-cad.md)).
- **jarvis #6** reported a wrong parameter ID accepted as OK; the inspected
  HEAD raises on missing IDs. The lesson survives: verify the effective
  parameter delta, not the regeneration status
  ([note](sources/jarvis-onshape-mcp-reshefelisha.md)).

**Model failure modes named by the papers.** Thin walls collapsing under
small numeric errors; polar patterns with the wrong axis or count; revolve
and sweep paths wrong (Arko-T §5.5). Structural configuration errors are 48 %
and logical errors 18 % of CADCodeVerify's labelled failures (Appendix C).
Validity collapses with complexity for most, not all, models
(Text2CAD-Bench Table 1). DOCUMENTED.

### 4.2 Anti-patterns (INFERRED from the war stories)

1. **Failure encoded as a value.** `0.0`, an empty list or `neither` where
   the truth is "the computation failed". Every evaluator above that did this
   produced a wrong, confident answer.
2. **A binary verdict with unchecked items inside.** `conforms`,
   `passes_gate` or "all Yes" that can be true while requirements were never
   checked. It also teaches the agent to stop.
3. **Normalizing away the millimetre.** Unit-box scaling makes wrong-unit and
   wrong-scale parts score well; FDM fits live in tenths of a millimetre.
4. **Survivor-only statistics.** Geometry metrics over valid outputs reward
   models that fail on hard cases.
5. **Repairing before measuring.** Alpha-wrapping or healing the candidate
   measures a different solid than the one that would be printed.
6. **Positional selectors.** `qNthElement`, CADFit's length-sorted edge
   indices and CADAM's `size[0]` regex all break when topology or source
   shape changes.
7. **Heuristic "unchanged".** Rounded volume plus equal counts is not
   equality; a moved hole passes.
8. **Silent intent repair.** jarvis's automatic REMOVE flip hides the model's
   misunderstanding instead of reporting the sketch normal and the cut
   direction.
9. **Non-atomic snapshots.** Several reads assembled into one "state" can
   describe no revision that ever existed.
10. **Non-converged geometry treated as solved.** KCL continues with
    diagnostics; an export path must refuse.
11. **Timeout as sandbox.** Process limits bound time, not file or network
    access.
12. **The agent's own report as the evaluation.** Anthropic's article and
    jarvis's evaluation both show transcripts disagreeing with
    self-assessment.
13. **Copied ancestry lists.** Provenance must be shared and interned (Zoo
    #14107).
14. **Paper and evaluator drifting apart.** MIT CADBench, BenchCAD (30 s in
    the paper, 300 s in the runner) and CADFit (paper pseudocode against
    runner defaults) all differ; results need pinned evaluator versions.
15. **Vision for measurable questions.** Hole diameters, counts and gaps are
    numbers; asking a VLM about them adds 20-27 % Unclear.

---

## 5. What wonky should take: ranked proposals

**Ranking rule.**

1. First, stop confident wrong answers from reaching an agent. Every tool
   and evaluator in section 4.1 shipped this failure. wonky's exactness is
   worth nothing to an agent if a failed computation can still arrive as a
   number (P1, P2).
2. Then put measurement inside the language the agent already writes, so it
   can verify instead of look (P3, P4).
3. Then edit feedback and a small transport (P5, P6).
4. Then the things only a mutation-free, exact kernel can offer cheaply
   (P7, P9), and the harness that decides whether any of it helps (P8).
5. Last, a connection that is almost free (P10).

**What already exists and only needs connecting** (DOCUMENTED, section 1.6):

- revision-bound summaries that keep unknown values `null`;
- uncatchable capability errors with source positions;
- `--check` and `--param`;
- refusal of no-op subtractions and empty intersections, reading the
  kernel's own account instead of a volume threshold
  (`src/library.mjs:83-96`, `:138-150`);
- the khana result model (verdicts, exactness labels, tolerances) and the
  Q1 to Q14 primitive plan ([../khana/design.md](../khana/design.md) §3,
  §4.2);
- the WK/0 graph diff.

Each proposal names the piece that is missing.

**Relation to the bake-off.** The bake-off is decided: corefine decides
topology, recover rebuilds the exact B-rep or refuses, and `hybrid-last` is
the default. Three relations matter here.

- **Evidence must reach the agent.** The hybrid answers `exact`,
  `mesh <dev> <reason>` or `unresolved`. Today that is operation evidence,
  not part of an agent-facing verdict. P1 carries it through unchanged.
- **Agent-written models are a Boolean stress corpus.** The hybrid plan's own
  gate still lists wrong `ok` answers under adversarial input: 18 of 216 for
  corefine. All are of kinds a local check can catch: point contact (10), a
  1e-10 mm self-intersection on rotated coplanar faces (4), and a grazing
  tool (DOCUMENTED, [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md),
  "Why corefine"). LLM-written models are dense in exactly these
  configurations: flush bosses, holes tangent to edges, coplanar faces at
  round numbers (INFERRED; every benchmark family read here samples round
  parameters). P7's audit and P8's harness therefore double as a Boolean
  regression corpus.
- **Face-level diffs through Booleans** (P5) need corefine's tags carried to
  recover as exact provenance. That is [mesh-booleans.md](mesh-booleans.md)
  P3, so P5 depends on it.

### P1. One agent result envelope: a status plus labelled evidence, never a bare number

**Idea.** One schema, `wonky-agent-result/1`, wraps every answer an agent can
receive: build, summary, measurement, check, diff and Boolean evidence.

- **Status.** khana's verdicts (`pass`, `fail`, `unresolved`, `refused`,
  `not-run`, `waived`) for checks; `ok`, `refused` or `error` for builds and
  measurements.
- **Values.** Intervals `[lo, hi]` with khana's labels (`exact`, `bounded`,
  `estimate`, `approximation`), the unit and the revision hash.
- **Coverage.** What ran, what was skipped and why. This follows
  build123d-mcp's coverage fields, with one difference: the aggregate is
  never `pass` while a relevant check was skipped. khana's aggregation
  already says that an empty set is `unresolved`.
- **Specifications.** One record per requirement, with its residual
  (`measured - target`, as an interval) and its status. The count of open
  (non-pass) requirements comes first. There is no single `conforms`
  boolean, so the agent sees "3 of 11 requirements open" instead of a green
  flag (INFERRED from build123d-mcp v0.3.67; untested).
- **The rule the envelope enforces.** A caught exception, a timeout, a
  skipped sub-check or an empty selection becomes `unresolved` or `refused`
  with stage and reason. It never becomes `0`, `[]`, `false` or `neither`.

**Where it plugs in.**

- a schema module next to `src/errors.mjs`;
- `bin/wonky.mjs --check` and `--format r20-check`;
- `src/geometry-summary.mjs` and `bin/wonky-compare.mjs`;
- khana K1a ("check contract, call contracts, reports") should adopt this as
  its outer layer rather than define a second schema.

**Bend fit.** A host schema with no numerics of its own. The labels and
intervals come from Bend results (F32x2 values, exact predicates). No kernel
change.

**Expected benefit.**

- Closes the first block of section 4.1 by construction, for every tool
  wonky exposes: build123d-mcp #381, the MIT CADBench Mac 0.0, the BenchCAD
  and CADFit 0.0, jarvis's INFO-as-ok.
- Gives agents a machine-checkable stopping rule that is not a green light:
  zero open requirements and no `unresolved` records.

**Risks.**

- Verbosity. Concise mode shows the status, the open count and the first
  failing record.
- Agents may treat `unresolved` as `pass` anyway. P8 has to measure that.
- Two schemas (khana and agent) drifting apart. There must be one.

**First acceptance test.**

- A fault-injection suite in `test/`. Producers: build, summary, `evVolume`,
  compare and a khana stub check. Injected faults: (a) a primitive that
  throws, (b) a skipped sub-check, (c) an empty selection, (d) a timeout.
- Assertions: no response has status `ok` or `pass`; no numeric field holds
  0 where the computation failed; every non-ok record names its stage and
  reason.
- A replay of build123d-mcp #381: a body with four open edges and the mesh
  check forced off yields `unresolved`, not `pass`.

### P2. Structured, repairable errors and a generated capability list

**Idea.** Extend `error.json` from `{class, message, file, line, column}`:

- **`class`** from a closed set that aligns with BenchCAD's quarantine
  classes and adds wonky's own:
  - `parse`, `runtime`;
  - `feature-exception` (Onshape would raise too);
  - `unsupported-capability`, `degenerate-geometry`, `empty-query`;
  - `numeric-domain` (outside the F32x2 range or precision the kernel
    supports);
  - `budget`, `verifier-refused`.
- **Location.** The `feature` id and a source excerpt of about five lines
  around the span.
- **Queries.** The selector, its match count, and what a relaxed version
  matched. Example: "`qCreatedBy(id + "boss", EntityType.FACE)` matched 0
  faces; `id + "boss"` created 1 body with 6 faces."
- **Capability refusals.** A stable `capability` id that resolves in a
  generated `capabilities.json`. KCL publishes its limits as prose; wonky can
  generate the list from its `unsupported(...)` sites. Each id carries
  `alternatives`: rewrites wonky can build and check, each marked with
  whether it changes design intent.

**Where it plugs in.**

- `src/errors.mjs` and the `unsupported()` call sites, which already carry a
  message and a location;
- `bin/wonky.mjs --format r20-check`;
- first corpus: the cadbench pilot's refusals and the 37 Python files that
  now stop at "a precise message about the missing kernel operation".

**Bend fit.** Host only, with one kernel-side duty. FeatureScript numbers are
f64 (DOCUMENTED, [Onshape note](sources/onshape-featurescript-mcp-server-onshape-labs-ptc.md)),
so values outside the F32x2 exponent range are legal FeatureScript. Bend has
to report them as a `numeric-domain` refusal, never overflow or flush to
zero silently.

**Expected benefit.**

- Text2CAD-Bench's published results include up to three error-feedback
  retries, so feedback quality is part of what those numbers measure. A
  precise class, span and capability id is the cheapest improvement to the
  repair loop (INFERRED).
- The capability list stops agents from retrying an unsupported operation in
  slightly different forms: fillets, chamfers, curved Booleans outside the
  hybrid's coverage.

**Risks.**

- "Alternatives" invite intent-changing workarounds, such as a fillet
  replaced by nothing. Only list rewrites wonky can check, and label every
  intent change.
- A hand-written capability list goes stale; it has to be generated.

**First acceptance test.**

- Every refusal from `scripts/cadbench.mjs` (the square washer case) and
  from the 37 Python cases yields a class from the closed set, a span inside
  the source, and a `capability` id present in `capabilities.json`.
- A snapshot test fails when a new `unsupported()` site has no id.

### P3. Measurement inside FeatureScript: evDistance, evArea and a pair relation first, as refusing wrappers

**Idea.** Make analysis callable where the agent already writes code: the
SpatialClaw result and build123d-mcp v0.3.68. khana §6.3 already specifies
the wrappers: thin layers over Q6 (distance), Q1 (area) and Q3 (convexity)
that raise the capability error for `refused`, and for a `bounded` interval
wider than the query's tolerance. This proposal adds a priority order for
agent value and three conventions.

**Priority order.**

1. `evDistance` (Q6, khana K4a and K4b). Gaps, wall thickness and
   hole-to-edge distances are the dimensions FDM parts live on.
2. `evArea` (Q1, K3a).
3. A pair relation (khana C1: apart, touching, containing or
   interpenetrating, with minimum distance and overlap volume from Q8).
   Onshape's `evCollision` is the std-named carrier and is absent in wonky
   today (section 1.6). Its enum mapping must be checked against FsDoc
   before implementation.

**Conventions.**

- **Onshape semantics where Onshape defines them, diagnostics where Onshape
  is silent.** FsDoc says `evArea` and `evVolume` return 0 for an empty
  selection and that `evDistance` breaks ties arbitrarily (DOCUMENTED,
  [Onshape note](sources/onshape-featurescript-mcp-server-onshape-labs-ptc.md)).
  Keep the value for compatibility, but add an `empty-query` warning to the
  P1 envelope and report ties in the evidence.
- **Values carry labels.** The FeatureScript value is a plain
  `ValueWithUnits`. Its label and interval go into operation evidence, as
  `evVolume` already does, so the summary can show which numbers the model's
  branches relied on.
- **Assertions use std.** A model asserts intent with FeatureScript's own
  `throw regenError(...)`, which wonky implements (`src/scalars.mjs:120`).
  No new syntax is needed.

**Where it plugs in.** `src/queries.mjs`, following the existing `evVolume`
pattern (refuse when the relative bound exceeds a limit, push operation
evidence), and khana K3a, K4a and K4b.

**Bend fit.** These are khana's Q-primitives: fork-join over cell pairs in a
Morton tree, F32x2 closed forms, and exact predicates for sign decisions.
The design and its Bend fit are DOCUMENTED in khana §4.2.

**Expected benefit.**

- An agent can assert its own intent in the model, for example "refuse if
  the gap is below 0.4 mm". The model then checks itself in Marc's
  repository, not only inside one agent session.
- The nearest evidence: SpatialClaw's controlled +3.2 points (spatial VQA)
  and CADSmith's median IoU from 0.81 to 0.96 (DOCUMENTED; neither is
  FeatureScript CAD).

**Risks.**

- wonky will refuse where Onshape returns a number, so a model that runs in
  Onshape can refuse in wonky. That is acceptable under the project rule, as
  long as it is a capability error and never a different number.
- Q6 coverage: cone-cone interiors are `unresolved` in v1, so some real
  parts will refuse.

**First acceptance test.** Three fixtures with closed-form answers: two
parallel plates 0.3 mm apart, a pin in a bore with 0.15 mm radial clearance,
and a plate with a hole 2 mm from an edge.

- `evDistance` returns the closed-form value within the stated allowance,
  labelled `exact`.
- The same call on a torus face raises the capability error.
- `evArea(context, {"entities": qNothing()})` returns 0 and puts an
  `empty-query` warning into the envelope.

### P4. Frames and effects in every feature record

**Idea.** Two additions to each feature's record in the summary.

- **Frame.** The sketch plane's origin, normal and x direction in world
  coordinates, and their source: `Top`, `Front`, `Right`, a face alias or an
  offset plane. For extrudes, the world direction and the side of the sketch
  plane that received material. The concise form is one line per feature,
  for example `sketch1 on Front: normal <world vector>, x <world vector>`.
- **Effect.** Bodies, faces and edges created, deleted and modified, by
  identity; the volume delta with its label; and the match count of every
  query parameter. A feature with an empty effect is flagged `no-effect`.
  This extends the existing no-op refusal to all other features, but as a
  warning: Onshape does not refuse them, so wonky must not either.

**Where it plugs in.** A `features` section in `src/geometry-summary.mjs`,
the interpreter's feature loop, identity from
[../topology-identity.md](../topology-identity.md), and WK/0 records.

**Bend fit.** Frames are F32x2 values the kernel already holds. Effect sets
are U32 identity-set differences: sort and merge, balanced fork-join, or
host-side.

**Expected benefit.**

- The workplane is the most clearly measured single model failure. In
  BenchCAD Table 14, GPT-4o's rotation-maximized IoU gain is 0.231 (XZ) and
  0.214 (YZ) against 0.046 (XY). A frame line in every record makes the
  wrong plane visible in text before any render (INFERRED; whether models
  read it is open question 6.2).
- `no-effect` covers jarvis's INFO case and "cuts that remove nothing" in
  features that are not Boolean subtractions.

**Risks.**

- Token growth: nine numbers per feature. Concise mode rounds for display;
  JSON keeps the exact words.
- Identity through splits and merges can be ambiguous. Report `unmatched`,
  never guess.

**First acceptance test.**

- A fixture with one sketch on each standard plane, one on a face and one on
  an offset plane, each extruded. Every feature record states its frame, and
  the three standard-plane frames equal the FsDoc definitions (checked
  against the std source, not typed by hand).
- A pattern whose instances all fall outside the body reports `no-effect`.
  The existing no-op subtraction still refuses.

### P5. Text diffs between revisions, with exact non-target preservation

**Idea.** `wonky diff A B` as the text twin of the viewer's compare:

- parameter deltas, and per-feature effect deltas (P4);
- faces added, removed and modified by identity, with what changed (carrier
  parameters, trims);
- the volume delta with its label;
- a preservation verdict: everything outside the edited feature's
  provenance is *identical* (exact word equality of carriers and trims), not
  "within tolerance".

Start from the WK/0 graph diff (hash 4 ms, diff 9.7 ms on r10b) and add the
geometry level.

**Where it plugs in.** `bin/wonky-compare.mjs` (today one coaxial-cylinder
primitive per input; other B-reps fail explicitly), the WK/0 diff, topology
identity, and mesh-booleans P3 for faces that pass through Booleans.

**Bend fit.** Exact equality of F32x2 words is U32 comparison: exact, cheap,
uniform, and fork-join over face pairs matched by identity. Where identity
does not match (a moved face), Q6 distance supplies a labelled difference.

**Expected benefit.**

- Edits of existing parts are where agent work on Marc's models actually
  happens. BenchCAD's edit failures and CADGenBench's edit tasks score
  similarity only; exact preservation is something none of the read tools
  can check (INFERRED).
- It fixes build123d-mcp's rounded "unchanged", where a moved hole with
  equal volume is reported as no change.

**Risks.**

- Identity loss across topology changes (a hole crossing an edge splits a
  face) produces large `unmatched` sets. The diff must say so instead of
  pretending.
- Boolean-heavy parts depend on mesh-booleans P3.

**First acceptance test.** A plate with two holes; `--param` moves one hole
by 5 mm.

- The diff lists that hole's cylinder face, its two circle edges and the two
  planar faces it trims as modified.
- It reports a volume delta of 0, labelled `exact`.
- Preservation is `pass` for every other face, by exact equality.
- The build123d-mcp counterexample (same volume, same counts) is reported as
  modified.

### P6. A thin agent transport over the CLI: four tools, pure builds, revision handles

**Idea.** A small stdio MCP server that widens language.md's "`wonky graph
--check --diff` as an MCP tool". At most five tools:

- `build`: source and parameters in; the P1 envelope, a concise summary and
  the revision hash out;
- `inspect`: revision plus alias or filter, concise or detailed;
- `check`: revision plus a `wonky-checks/1` spec;
- `diff`: revisions A and B (P5);
- `render`: explicitly secondary.

All tools except `build` are read-only, and `build` is a pure function of
source, parameters and kernel version. build123d-mcp needs source-hash
transactions because its OCCT session mutates and `execute()` can leave
partial state. wonky has no session state to roll back: the revision hash
*is* the transaction (INFERRED).

Anthropic's rules apply: concise and detailed modes; filters applied before
serialization, echoing original and filtered counts (as jarvis does);
actionable errors (P2); truncation stated. The CLI stays the source of
truth, and the MCP tools call it.

**Where it plugs in.** `bin/wonky-mcp.mjs` over `bin/wonky.mjs`,
`bin/wonky-inspect.mjs`, `bin/wonky-compare.mjs` and the khana CLI (khana
§6.5).

**Bend fit.** Host only.

**Expected benefit.**

- Claude Code and Codex get structured results without parsing stdout, and
  the tool count stays small.
- The budget is known from measurements: the body overview is 1,094 tokens,
  the full r10b alias lookup 113,739. The concise default must therefore be
  the overview plus open issues (DOCUMENTED, sections 1.6 and 3.3).

**Risks.**

- An MCP layer is maintenance, and clients reportedly defer large tool lists
  (scout; not re-verified).
- Two surfaces can drift. Generate the MCP schemas from the CLI's.

**First acceptance test.** A recorded session on r10b-retained.

- `build` in concise mode returns status, revision and open issues in under
  2,000 tokens.
- `inspect` with an alias from a stale revision is refused.
- `inspect` with a filter echoes original and filtered counts.
- The same session through the CLI produces byte-identical JSON.

### P7. A deterministic parameter audit (±ε), driven by a typed parameter manifest

**Idea.** build123d-mcp's `design_audit` rebuilds up to eight top-level
numeric literals at ±0.1 and reruns validity. wonky can do better because
its parameters are typed. FeatureScript `definition` preconditions state
units and bounds (`isLength(definition.x, LENGTH_BOUNDS)`). That is the
AST-bound parameter manifest CADAM's regex sliders lack.

The audit rebuilds each parameter at ±ε, with ε taken from the printer
profile (for example 0.1 mm and 1 %, stated in the report), and classifies
it:

- `robust`: builds, identity-equivalent topology, only carrier values move;
- `coupled`: topology changes (faces appear, disappear or split), with the
  features that changed;
- `brittle`: refuses or fails, with the P2 error class;
- `on-boundary`: the base design sits exactly on a degenerate configuration
  (a flush face, a tangency), detected because +ε and -ε give different
  topology.

**Where it plugs in.** `bin/wonky.mjs --param` (it already overrides
FeatureScript parameters), P4 effect records, the P5 diff, and a new
`wonky audit` subcommand.

**Bend fit.** Each rebuild is an independent, pure job. 2k+1 builds are a
balanced fork-join and deterministic by construction: no mutation, and all
four targets byte-identical per the bake-off table. No kernel change.

**Expected benefit.**

- Surfaces designs that only work at their exact numbers. For FDM parts that
  is exactly where printed tolerance variation lives.
- Bake-off relation: `on-boundary` flags the configurations the hybrid
  refuses or, today, answers wrongly (point contact, rotated coplanar faces,
  grazing tools) before they reach a print.

**Risks.**

- Cost: 2k+1 builds. Cap k, and use `--check` builds without exports.
- One-at-a-time perturbation misses interacting parameters.

**First acceptance test.** Three fixtures, run with `--check` and no
exports; the report names ε.

- A plain plate with a hole: all parameters `robust`.
- A boss exactly flush with a face: its height parameter is `on-boundary`
  (+ε and -ε give different topology).
- A hole whose edge exactly touches the plate edge: `brittle` or
  `on-boundary`, never `robust`.

### P8. A local evaluation harness for agent-facing wonky

**Idea.** wonky's own offline evaluation. It borrows structure from the
benchmarks read here, not their code or data one-for-one.

- **Fixtures.** Fresh FeatureScript and Python fixtures from typed
  specifications in BenchCAD's style: a parameter schema, a sampler and a
  validator per family. Each spec emits paired geometric and procedural
  prompts (Text2CAD-Bench), is seeded by a U32 PRNG, and carries a licence
  Marc chooses. Start with Marc's own families: the H6 study's 10 to 20
  parts.
- **Scores, in order of authority.**
  1. Validity gate: wonky's STEP validation plus the certified print mesh.
  2. Exact dimension and relation checks (khana checks as P1 records).
  3. Interface regions as in CADGenBench, but with one *shared* pose and
     millimetre tolerances.
  4. A printability axis from khana C6 and C7 (overhangs, bridges, walls).
     No benchmark read here has one.
  5. IoU, Chamfer distance and SIoU as secondary diagnostics. Evaluator
     failure is its own state. BenchCAD's 24-rotation IoU serves only as a
     wrong-workplane diagnostic.
- **Process metrics** (Anthropic): iterations, tool calls, tokens, wall time
  and P2 error classes per attempt. First-attempt and after-repair results
  are reported separately (MIT CADBench's lesson). Raw transcripts are kept.
- **Metamorphic checks.** A rigidly moved or rotated copy of a fixture must
  give the same verdicts, following Spatter's affine-equivalent inputs
  ([note](sources/spatter-detecting-logic-bugs-in-spatial-database-engines-via.md)).
- **External cross-check.** CADGenBench's Apache-2.0 evaluator runs offline
  on wonky STEP exports of public inputs, as an outside opinion and never as
  a production dependency. Neither official route can be the target:
  CADGenBench's full scoring needs private ground truth, and gNucleus
  requires `answer.FCStd`.

**Where it plugs in.** `scripts/`, next to `scripts/cadbench*.mjs`. It
reuses the pilot's rules: missing operations never count as passes, and
denominators are preserved. The language.md H6 study is its first client.

**Bend fit.** Checks run in Bend; the harness is host coordination. Voxel
IoU as U32 bitsets with popcount reductions fits Bend if wanted (BenchCAD
note). External Python evaluators are acceptable for secondary metrics
because they never produce production geometry.

**Expected benefit.**

- Turns P1 to P7 from INFERRED into measured, and answers H6.
- Produces a Boolean regression corpus of LLM-written models (bake-off
  relation).

**Risks.**

- Model and API cost. Small n (10 to 20 parts) gives wide intervals; report
  them.
- The fixture authors (Marc, LLMs) bias the families.

**First acceptance test.** Ten fixtures from three families, run against the
current wonky by a scripted, non-LLM "agent" that replays known programs
with planted faults:

- a part on the wrong plane: flagged by the 24-rotation diagnostic and
  failing its dimension checks;
- a 0.2 mm wall below the profile minimum: failing printability, with a
  witness;
- an evaluator crash: reported as `evaluator-failed`, not 0;
- no case dropped from the denominator.

### P9. A reference-survival test for agent-written queries

**Idea.** Measure what no benchmark measures: after a parameter edit, does
each query the agent wrote still select the entity it meant?

- Collect agent-written selections on Marc's parts: `qCreatedBy` plus
  filters, `qNthElement`, and geometric queries such as `qContainsPoint`.
- Resolve them before and after edits and compare by identity.
- Output: guidance for agents (which query idioms survive in wonky) and a
  regression test for wonky's topology identity.

**Where it plugs in.** `test/` fixtures,
[../topology-identity.md](../topology-identity.md), P5's identity matching,
and khana §6.3's part selection by operation id.

**Bend fit.** Query evaluation on the host, plus U32 identity comparison.

**Expected benefit.** Agent edits fail on selectors: BenchCAD's F05, CADFit's
length-sorted edge indices, CADAM's `size[0]`. Knowing which idioms survive
is a prompt-level fix that costs nothing at runtime (INFERRED).

**Risks.** "The entity it meant" needs an oracle. Use a geometric predicate
authored with the fixture (for example "the planar face with outward normal
+Z at maximum z"), not human judgement.

**First acceptance test.** Five parts × three parameter edits × every
selection in their source. The report gives a survival rate per idiom and
lists each selection whose target changed, with the identity before and
after.

### P10. Selection-to-source requests with revision fences

**Idea.** Zoo maps a selected face through its artifact graph to the source
ranges of the segment and sweep that made it, sends those with the prompt,
and fences writes with a base revision (accepted, merged, stale, conflict).
wonky's viewer already copies a detail packet for the selection, and the
summary already records the generating operation and its source point. The
missing pieces:

- the full source *span* of the generating feature and of the sketch
  entities it consumed;
- the parameters in effect;
- the base revision hash in the packet, so a patch against a stale revision
  is rejected instead of merged blindly.

**Where it plugs in.** The viewer's "Copy selected geometry", identity
records, WK/0 source spans.

**Bend fit.** Host only.

**Expected benefit.** Scoped edits with less context, and no silent edits of
a revision that has moved on (DOCUMENTED pattern in the Zoo note; benefit
INFERRED).

**Risks.** Spans through helper functions and loops map to several source
ranges. Report all of them.

**First acceptance test.** Selecting the cylinder face of a hole in r10b
yields a packet with the generating feature's span, the sketch circle's
span, the parameter values and the revision. Replaying a patch after
another edit is rejected as stale.

### Not proposed, on purpose

- **Training or fine-tuning a model**, or a synthetic-data engine at
  CAD-Recode scale. The strong model repositories are noncommercial, Marc
  uses frontier models, and nothing read here shows that a small FS model
  beats good feedback (INFERRED). CADFS exists if that changes.
- **VLM self-review as a gate** (section 3.2). Renders stay a secondary
  check.
- **A new LLM-facing syntax.** Decided in [../language.md](../language.md).
- **Linking OCCT, trimesh, manifold3d or any evaluator into production.**
  External offline evaluators only.
- **Silent intent repair**, like jarvis's automatic REMOVE flip. Report the
  mismatch with P4's frame instead.
- **A single `conforms` boolean** or one overall score for the agent.
- **CADFit-style mesh-to-CAD search.** CC BY-NC, a claimed provisional
  patent, and outside the modeling workflow.
- **An official gNucleus CAD-Bench or CADGenBench submission.** gNucleus
  requires FCStd; CADGenBench's full scoring needs private ground truth.

---

## 6. Open questions worth a prototype

Each question names the prototype that would settle it. Most run inside the
P8 harness, so P8 comes first.

**6.1 Does an open-requirements count stop agents at the right time?**

- *Why:* build123d-mcp's `conforms: true` finding is observational (two
  sweeps, no randomization).
- *Prototype:* in P8, three arms (a `conforms` boolean, the P1 open count,
  no specification feedback). Measure premature stops, final correctness and
  iterations.

**6.2 Does a frame line fix the workplane bias, or does it take a check?**

- *Why:* BenchCAD measures the bias (section 4.1), but nobody has tested a
  textual remedy.
- *Prototype:* XZ- and YZ-heavy families in P8, with and without P4's frame
  lines, plus a third arm with a print-orientation assertion (for example
  "the base face lies on z = 0").

**6.3 How much summary helps, per token?**

- *Why:* wonky's r10b-retained summary is 18,120 tokens and the body
  overview 1,094 (DOCUMENTED). SGP-Bench shows that models can answer
  geometry questions from programs alone, to a degree.
- *Prototype:* an SGP-Bench-style comprehension probe on Marc's parts. The
  same questions are answered from (a) source only, (b) source plus the
  concise summary, (c) plus the detailed summary, (d) plus a render. Report
  accuracy against tokens.

**6.4 What does "standardized FeatureScript" mean for wonky?**

- *Why:* CADFS measured raw FS at 56 % invalid and standardized FS at 10 %
  (DOCUMENTED in [../language/prior-art.md](../language/prior-art.md) §4.2).
  Standardization may matter more than any tool.
- *Prototype:* a WK/0-based normalizer that rewrites raw FS into a canonical
  subset (one operation per feature, explicit ids, no helper indirection).
  Check that geometry stays byte-identical on 10 of Marc's parts, then test
  in H6 whether agents edit the normalized form better.

**6.5 Empty queries: Onshape's 0 with a warning, or a refusal?**

- *Why:* compatibility with Onshape's documented semantics conflicts with the
  project rule and with anti-pattern 1 (section 4.2).
- *Prototype:* count in P8 how often agent-written models hit empty queries,
  and whether agents act on the P1 warning.

**6.6 Can agents use intervals and refusals productively?**

- *Why:* P3's wrappers refuse when a `bounded` interval straddles the
  query's tolerance. That is correct, and untested with agents.
- *Prototype:* fixtures whose natural answer sits inside the band. Measure
  whether agents add margin (good), retry blindly, or give up.

**6.7 Which agent habits leave F32x2's numeric domain?**

- *Why:* FeatureScript numbers are f64. F32x2 carries about 48 mantissa bits
  within F32's exponent range. Agents copy habits such as `1e-12`
  tolerances from OCCT and `1000 * meter` through-all extents (INFERRED).
- *Prototype:* scan the P8 corpus for literal magnitudes and ratios against
  the kernel's declared bounds (khana's `decide_mm = 1e-6`, the F32 exponent
  range). Write the supported numeric domain down and make P2's
  `numeric-domain` refusal enforce it.

**6.8 Is the ±ε audit cheap enough to run on every build?**

- *Prototype:* time 2k+1 `--check` builds on the CPU pool for Marc's parts.
  Decide whether P7 runs by default, on request, or in CI.

**6.9 Do agent-written models for Marc's parts need sketch constraints?**

- *Why:* wonky's sketch path is a bounded profile assembler; constraints are
  an explicit unsupported capability ([../sketch-lines.md](../sketch-lines.md)).
  If agents write `skConstraint` often, KCL's degree-of-freedom analysis and
  CAD-Assistant's constraint preview become necessary.
- *Prototype:* count constraint use in the P8 corpus and in Marc's existing
  Onshape models.

**6.10 Are renders needed at all for Marc's parts?**

- *Prototype:* a P8 ablation with the render tool disabled. If correctness
  does not drop, renders stay for Marc and leave the agent loop.

**6.11 Does printability by default cause false alarms?**

- *Prototype:* run khana C6 and C7 on the R20 corpus and on Marc's printed
  parts. Count the waivers needed, and check each fail witness against the
  printed reality.

**6.12 Is a shared-pose interface score tractable with exact predicates?**

- *Why:* CADGenBench's `min over features of max over poses` does not
  certify a joint fit (section 1.4).
- *Prototype:* two-part fits from Marc's projects. Search one rigid
  placement for all interface features, using Q6 distances and Q14
  placement bounds, and compare the verdict with CADGenBench's per-feature
  score.

---

## 7. Catalog of the remaining sources

### 7.1 Catalog-only sources from the scout (not deep-read)

Repository metadata from `gh api repos/...` on 2026-09-24 (stars, SPDX
licence as GitHub reports it, last push). The one-line summaries are the
scout's and were not verified here (HEARSAY-grade until read). The relevance
column is INFERRED.

| source | kind | year | activity / status | licence | one line | relevance for wonky |
|---|---|---|---|---|---|---|
| [SGP-Bench](https://arxiv.org/abs/2408.08313) (Qiu et al., ICLR 2025) | paper + benchmark | 2024 | repo `sgp-bench/sgp-bench`: 32★, push 2025-07-14 | MIT | semantic QA over SVG and CAD programs without rendering | template for question 6.3 |
| [Zero-to-CAD](https://arxiv.org/abs/2604.24479) (Autodesk Research) | paper | 2026 | no repository checked | unknown | about 1M executable CAD sequences synthesized by an agent inside a CAD environment with tools and docs | agent-in-the-loop data generation; feedback design |
| [CADEvolve](https://arxiv.org/abs/2602.16317) (Elistratov et al.) | paper | 2026 | candidate repo `zhemdi/CADEvolve`: 50★, push 2026-02-19 (not confirmed as official) | Apache-2.0 (candidate repo) | evolves CadQuery programs by VLM-guided edits plus validation; 8k parts, 1.3M scripts | fixture generation by guided mutation |
| [cadrille](https://arxiv.org/abs/2505.22914) (Kolodiazhnyi et al.) | paper + code | 2025-2026 | `col14m/cadrille`: 185★, push 2026-09-01 | Apache-2.0 | multimodal to CadQuery with online RL on execution and geometry rewards | reward design shows what "valid" meant in training |
| [CAD-Coder](https://arxiv.org/abs/2505.14646) (Doris et al., MIT) | paper + code | 2025 | `anniedoris/CAD-Coder`: 207★, push 2025-07-17 | Apache-2.0 | image to CadQuery VLM (GenCAD-Code) | same group as MIT CADBench |
| [CAD-Coder](https://arxiv.org/abs/2505.19713) (Guan et al.) | paper | 2025 | not checked | unknown | text to CadQuery, SFT then RL with a Chamfer, format and validity reward | name collision with the MIT work; cite by URL |
| [Text2CAD](https://arxiv.org/abs/2409.17106) (Khan et al., NeurIPS 2024) | paper + code | 2024 | `SadilKhan/Text2CAD`: 477★, push 2025-05-15 | GitHub: NOASSERTION; scout: CC-BY-NC-SA-4.0 | DeepCAD sequences with beginner-to-expert annotations | historical; the Text2CAD-Bench baseline |
| [Query2CAD](https://arxiv.org/abs/2406.00144) (Badagabettu et al.) | paper + code | 2024 | `akshay140601/Query2CAD`: 54★, push 2024-06-05 | none | FreeCAD macros refined by VLM captions and human feedback | historical self-review loop (section 3.2) |
| [3D-PreMise](https://arxiv.org/abs/2401.06437) (Yuan et al.) | paper | 2024 | historical | unknown | LLMs on parametric industrial shapes with sharp features; visual self-correction | historical |
| [Makatura et al.](https://arxiv.org/abs/2307.14377) (MIT) | paper | 2023 | historical | arXiv | GPT-4 across design and manufacturing, including Onshape FeatureScript | read in [../language/prior-art.md](../language/prior-art.md) §4: raw FS performed poorly |
| [LLMs for CAD: a survey](https://arxiv.org/abs/2505.08137) | survey | 2025 | reference | arXiv | code, sketch and sequence generation, QA, editing, datasets, metrics | map of the field; secondary |
| [Text-to-CadQuery](https://arxiv.org/abs/2505.06507) (Xie and Ju) | paper + code | 2025 | `Text-to-CadQuery/Text-to-CadQuery`: 114★, push 2026-08-04 | none | about 170k text/CadQuery pairs re-annotated from Text2CAD | study only (no licence) |
| [CAD-MLLM](https://arxiv.org/abs/2411.04954) | paper + code | 2024 | `CAD-MLLM/CAD-MLLM`: 270★, push 2025-09-16 | none (the scout reports MIT for a separate metrics repo) | multimodal CAD sequence generation; Omni-CAD dataset; topology-aware metrics | metric ideas only |
| [FlexCAD](https://arxiv.org/abs/2411.05823) (Microsoft, ICLR 2025) | paper + code | 2024-2025 | `microsoft/FlexCAD`: 104★, **archived**, push 2025-05-28 | MIT | hierarchy-aware masking to infill parts of a CAD text | local edits by infilling; archived |
| [BlenderLLM](https://arxiv.org/abs/2412.14203) (FreedomIntelligence) | paper + code | 2024 | `FreedomIntelligence/BlenderLLM`: 306★, push 2024-12-23 | Apache-2.0 | Blender Python generation with self-improvement; its own "CADBench" | third "CADBench" (correction 11) |
| [freecad-mcp](https://github.com/neka-nat/freecad-mcp) (neka-nat) | MCP server | 2025-2026 | 2,455★, push 2026-09-18 | MIT | agents drive FreeCAD: objects, Python execution, screenshots | tool-surface comparison for P6 |
| [build123d](https://github.com/gumyr/build123d) | library | 2020-2026 | 3,196★, push 2026-09-23 | Apache-2.0 | Python B-rep framework on OCCT; builder and algebra modes; topological selectors | wonky's Python frontend subset; selector semantics |
| [CadQuery](https://github.com/CadQuery/cadquery) | library | 2017-2026 | 5,827★, push 2026-09-23 | GitHub: NOASSERTION; scout: Apache-2.0 | OCCT-based Python CAD; the most common LLM target | the language most benchmarks speak |
| [blender-mcp](https://github.com/ahujasid/blender-mcp) (now `ahujasid/mcp-for-blender`) | MCP server | 2025-2026 | 29,280★, push 2026-09-24 | MIT | Claude drives Blender scenes | popularity, not CAD guarantees |
| [openscad-mcp](https://github.com/RobertCoop/openscad-mcp) and [OpenSCAD-MCP-Server](https://github.com/jhacksman/OpenSCAD-MCP-Server) | MCP servers | 2025-2026 | 142★ (push 2026-09-10) and 197★ (push 2026-09-07) | MIT | write, render and export OpenSCAD | CSG-only comparison point |
| [Autodesk Assistant (Fusion)](https://www.autodesk.com/products/fusion-360/blog/autodesk-assistant-ai/) | commercial | 2025-2026 | product | proprietary | text to editable B-rep and workflow automation in Fusion; related MCP effort | relevant to Marc's Fusion workflow; no public contract read |
| [TexoCAD on Onshape AI Advisor](https://blog.texocad.ai/posts/onshape-ai-advisor) | competitor blog | 2026 | commercial | copyright | argues the Advisor is a documentation chatbot that cannot see the model | HEARSAY; underlines that model-aware context is the product |
| [Backflip AI](https://www.backflip.ai) | commercial | 2026 | product | proprietary | mesh and scan to parametric CAD; Fusion add-in | scan workflow, not wonky's |
| [LLM4CAD-DSL](https://github.com/YuewanSun/LLM4CAD-DSL) | research repo | 2026 | 3★, push 2026-06-27 | none | a DSL designed for LLM CAD generation and editing | language question already settled (section 1.5) |

### 7.2 Related deep-read notes elsewhere in this knowledge base

These notes were written for other chapters and bear directly on this one.

| note | why it matters here |
|---|---|
| [DeepCAD dataset and Onshape CAD parser](sources/deepcad-dataset-and-onshape-cad-parser.md) | root dataset of strand A; the Onshape parser shows how feature histories become programs |
| [Fusion 360 Gallery dataset](sources/fusion-360-gallery-dataset-autodesk-ai-lab.md) | reconstruction sequences; noncommercial data inside MIT CADBench |
| [ABC dataset](sources/abc-a-big-cad-model-dataset.md) | large Onshape-derived corpus behind several benchmarks |
| [Onshape FeatureScript queries: qCreatedBy, evaluateQuery](sources/onshape-featurescript-queries-qcreatedby-evaluatequery-trans.md) | query semantics for P3, P4 and P9 |
| [Onshape FeatureScript std library mirror](sources/onshape-featurescript-std-library-mirror-opfillet-opchamfer-.md) | std behaviour wonky has to match or refuse |
| [Onshape REST API: mass properties and rollback](sources/onshape-rest-api-part-studio-mass-properties-and-rollback.md) | how Onshape exposes measurements; API quotas that limit Onshape-backed agents |
| [Onshape API associativity and transient IDs](sources/onshape-api-associativity-transient-ids-idtranslations.md) | deterministic IDs as used by jarvis |
| [Onshape microversions, compare, branching](sources/onshape-architecture-microversions-compare-branching-merging.md) | revision model behind P5, P6 and P10 |
| [build123d topology selection](sources/build123d-topology-selection-select-all-last-new-topo-path.md) | selector semantics for wonky's Python frontend and P9 |
| [Spatter: affine-equivalent inputs](sources/spatter-detecting-logic-bugs-in-spatial-database-engines-via.md) | metamorphic testing for P8 |
| [Zoo CAD engine overview](sources/zoo-kittycad-cad-engine-overview-gpu-surface-surface-interse.md) | what is known about the closed engine behind KCL |
| [gitcad forge](sources/gitcad-forge-forgekernel.md), [keel](sources/keel-redwoodrhetorica-keel.md), [CADmium](sources/cadmium.md) | other code-first kernels; see [fringe-kernels.md](fringe-kernels.md) |
| [testing-validation.md](testing-validation.md) | validity checking and test corpora in depth |
| [topology-identity-data-structures.md](topology-identity-data-structures.md) | identity and naming behind P4, P5, P9 and P10 |
