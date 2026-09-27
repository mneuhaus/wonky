# CAD-Assistant (Mallis et al., ICCV 2025)

- Kind: paper / partial research implementation. Full title **CAD-Assistant: Tool-Augmented VLLMs as Generic CAD Task Solvers**. [arXiv 2412.13810v3](https://arxiv.org/abs/2412.13810), [PDF](https://arxiv.org/pdf/2412.13810v3), [project](https://cadassistant.github.io/), [repository](https://github.com/dimitrismallis/CAD-Assistant).
- Authors: Dimitrios Mallis, Ahmet Serdar Karadeniz, Sebastian Cavada, Danila Rukhovich, Niki Foteinopoulou, Kseniya Cherenkova, Anis Kacem, Djamila Aouada. Initial preprint December 2024, v3 August 26, 2025; ICCV 2025 per official repository. [arXiv](https://arxiv.org/abs/2412.13810), [README](https://github.com/dimitrismallis/CAD-Assistant/blob/5fea47309b2db5245f9e01c7a2445cce9dd2d07e/README.md).
- License: DOCUMENTED repository **CC-BY-NC-4.0**, actual [LICENSE](https://github.com/dimitrismallis/CAD-Assistant/blob/5fea47309b2db5245f9e01c7a2445cce9dd2d07e/LICENSE); arXiv article separately **CC-BY-NC-ND-4.0**. Do not conflate paper and code grants. Noncommercial restriction prevents treating code as permissive reusable infrastructure; independent implementation of ideas is the recommended route. Subcomponents from SketchGraphs/Vitruvion have their own attribution history. Private/unlicensed status alone is not an exemption.
- DOCUMENTED snapshot 2026-09-24: Python, 15,291 KiB GitHub size, 82 stars, 1 contributor account/8 contributions, main HEAD 5fea47309b2db5245f9e01c7a2445cce9dd2d07e on 2025-10-30; no releases returned; two closed issues. “Maintained” in the seed is stronger than this sparse activity supports. [metadata](https://api.github.com/repos/dimitrismallis/CAD-Assistant), [commit](https://github.com/dimitrismallis/CAD-Assistant/commit/5fea47309b2db5245f9e01c7a2445cce9dd2d07e), [contributors](https://api.github.com/repos/dimitrismallis/CAD-Assistant/contributors), [releases](https://api.github.com/repos/dimitrismallis/CAD-Assistant/releases).

## What it is

DOCUMENTED: VLLM planner writes iterative Python actions in a FreeCAD computational environment. FreeCAD/OCCT performs geometry and constraint solving; model augments actions with symbolic recognizers, labeled renders, constraint-impact checks and a learned hand-drawn sketch parameterizer. It handles question answering, sketch auto-constraining and image-to-sketch tasks, with qualitative demonstrations of broader CAD actions. It is not an independently implemented CAD kernel. [Paper §§3–4](https://arxiv.org/pdf/2412.13810v3), [maintainer explanation](https://github.com/dimitrismallis/CAD-Assistant/issues/2#issuecomment-3311800986).

## How it works

DOCUMENTED paper equations 1–4: state/context `c_t` produces plan `p_t` and Python action `a_t`; environment evaluates action against CAD state `e_(t-1)` producing observation `f_t` and new state `e_t`; append observations to context and repeat until TERMINATE. Tool method signatures/docstrings are supplied to the planner. The paper describes an AutoGen-based system; released `core.py` uses LangChain `PythonREPL` with shared globals/locals and unrestricted builtins. Tool code and doc files are registered from config; default loop cap 10 iterations. Distinguish experimental description from released implementation. [Paper §3/§8](https://arxiv.org/pdf/2412.13810v3), [core.py](https://github.com/dimitrismallis/CAD-Assistant/blob/5fea47309b2db5245f9e01c7a2445cce9dd2d07e/cad_assistant/core.py).

DOCUMENTED representation details, paper §9/Tables 7–10:

- Point-based line = `(start_x,start_y,end_x,end_y)`; arc = `(start_x,start_y,mid_x,mid_y,end_x,end_y)`; circle = `(center_x,center_y,r)`; point = coordinates.
- Implicit line uses reference point, unit direction and signed start/end distances; implicit arc includes center/direction, clockwise flag and angles. Overparameterized representation concatenates implicit and point-based fields. It makes endpoints, midpoint, direction and angular information explicit rather than forcing the language model to derive them.
- Constraints name participating primitives and endpoint/midpoint/whole-primitive subreferences. Extrusion description includes sketch orientation, translation, scale, forward/reverse distances and operation type. Continuous parameter output is used; six-bit quantization is applied only to outputs for comparison with prior task-specific models, not as the engine's native precision.
- Sketch recognizer returns JSON geometry/constraints plus a precise drawing with primitive-number labels. Solid recognizer combines feature descriptions and four views. Constraint checker asks whether a proposed constraint is valid and whether it moves geometry; proposed constraints are evaluated before being accepted. Cross-section tool extracts a 2D image from a mesh plane for subsequent sketch fitting, not an exact B-rep SSI algorithm. [Paper §7, §9](https://arxiv.org/pdf/2412.13810v3).

DOCUMENTED released code limits:

- [`SketchConverter.freecad_to_json`](https://github.com/dimitrismallis/CAD-Assistant/blob/5fea47309b2db5245f9e01c7a2445cce9dd2d07e/cad_assistant/cad_tools/sketch_recognizer_code.py) enumerates geometry and constraints, supplies numeric IDs, construction flags, removes None-valued fields, and serializes. `GeometryDefaults.ROUNDING_PRECISION=4`; images and numeric summaries are observation artifacts, not round-trip canonical geometry. The plotting enhancer labels entity IDs directly on the curves.
- [`solid_recognizer`](https://github.com/dimitrismallis/CAD-Assistant/blob/5fea47309b2db5245f9e01c7a2445cce9dd2d07e/cad_assistant/cad_tools/solid_recognizer_code.py) only includes `Sketcher::SketchObject` and `Part::Extrusion` in its JSON loop; extrusions carry base, Dir, forward/reverse length, symmetry/reversal. “Solid recognizer” does not imply a general arbitrary-feature/topology summarizer. OCC renders imported/exported STEP geometry via [solid_recognizer_occ.py](https://github.com/dimitrismallis/CAD-Assistant/blob/5fea47309b2db5245f9e01c7a2445cce9dd2d07e/cad_assistant/cad_tools/solid_recognizer_occ.py).
- Only sketch/solid recognizers and SGP-Bench QA are clearly released. No named CAD-Assistant constraint-checker, scan-section or learned parameterizer implementation was found in the checkout. Vendored SketchGraphs constraint code is not evidence that the paper's solver-impact tool was released. [README](https://github.com/dimitrismallis/CAD-Assistant/blob/5fea47309b2db5245f9e01c7a2445cce9dd2d07e/README.md), [tool directory](https://github.com/dimitrismallis/CAD-Assistant/tree/5fea47309b2db5245f9e01c7a2445cce9dd2d07e/cad_assistant/cad_tools).

## Robustness and guarantees

DOCUMENTED: CAD solver enforces requested constraints, but valid constraints can arbitrarily reposition primitives. Evaluating geometry after solving, rather than counting plausible constraint tokens, is essential. PF1 requires primitive type/parameters correct within five quantization units; CF1 requires correct associated primitives. These benchmark tolerances are not millimeter manufacturing tolerances. Constraint checker is described functionally; numeric movement threshold/complete solver algorithm are not publicly specified in the inspected implementation. [Paper §§4.2–4.3/§7](https://arxiv.org/pdf/2412.13810v3).

INFERRED: render+JSON redundancy aids interpretation but is not a proof; derived fields must all come from the same canonical geometry/revision to avoid contradictory radius/endpoints. Rounded summaries must not be fed back as authoritative coordinates. Persistent Python with full builtins is not a production-safe evaluation boundary.

## Parallelism and performance

DOCUMENTED author measurements (not reproduced):

- Table 2, GPT-4o 2D SGP-Bench: implicit serialized graph .674, DXF .671, OCA .707, point-based CSV .703, Markdown .706, HTML .710, serialized graph .744, point-based JSON **.748**, overparameterized JSON **.747**. **Correction to seed: overparameterized JSON did not beat point-based JSON.** Authors choose it as a plausibly safer general representation, not because this ablation proves superiority. Precise rendering .754 versus hand-drawn .616.
- Table 3 GPT-4o baseline→agent: 2D .686→.791, 3D .782→.857. This is question-answer accuracy, not solid-generation validity. Small GPT-4-mini only .737→.783 in 3D and .594→.614 in 2D.
- Table 4 autoconstraining after solving: GPT-4o PF1/CF1 .693/.274, Vitruvion .706/.238, agent .979/.484. Table 5 within framework: multimodal recognizer without checker .747/.329; adding checker .979/.484. Strong practical motivation for dry-run constraint impact, not a complete reproducibility claim while checker code is missing.
- Table 6 hand-drawn parameterization: agent accuracy .784 vs Davinci .789; image-space CD .680 vs 1.184. Again not blanket superiority on every metric.
- Table 11 historical GPT-4o costs: CAD QA average 11,280 input /178 output tokens, $0.0299 per request; autoconstraining 28,422/852, $0.0795; hand-drawn 31,170/1,081, $0.0887. Historical accounting, not current pricing or local CAD latency. [Paper Tables 2–6,11](https://arxiv.org/pdf/2412.13810v3).

No Bend/native/GPU performance measurements are supplied; planning is sequential and FreeCAD does the geometry.

## Known failures, limitations, war stories

DOCUMENTED: 100 wrong QA trajectories audited by a human mostly revealed reasoning errors and misreading tool renders (e.g. trapezoid interpreted as triangle). Two annotators judged 200 autoconstraining/parameterization trajectories: 98.5% valid tool use, with errors mainly FreeCAD API misuse. **Tool-call validity is not design correctness or 98.5% reliable manufacturing.** [Paper §4.3/Fig.4](https://arxiv.org/pdf/2412.13810v3).

DOCUMENTED maintainer [issue #1 reply](https://github.com/dimitrismallis/CAD-Assistant/issues/1#issuecomment-3311821018): planned solid recognizer, constraint checker and evaluations; cannot confirm other tools due to potential IP conflicts. October commit released solid recognizer/3D QA; do not assume the rest shipped. [Issue #2](https://github.com/dimitrismallis/CAD-Assistant/issues/2) clarifies actual FreeCAD/OCCT execution versus a generated-code-only mockup. No broad production issue corpus exists.

## Relevance for wonky

INFERRED design suggestions:

1. `describeSketch` should emit stable IDs, construction status, start/mid/end points plus canonical curve parameters, constraints, residuals and frame/units, accompanied by identically labeled renders. Keep a concise mode and fetch detailed redundancies for selected entities; paper does not justify serializing every field of a huge model on every turn.
2. Implement a pure **preview constraint** operation in Bend: proposed constraint + old immutable sketch → solver status, residuals, rank/DOF diagnostics when available, per-primitive displacement, ambiguity and changed-entity list. Commit only if intended; otherwise return the old revision. Do not fabricate the unreleased paper checker implementation or copy its unspecified tolerance.
3. Pair code QA, render QA and post-solve geometry checks in wonky tests. Assertion examples: applying a redundant constraint must not move valid geometry; a tangent constraint must not silently invert an arc; unaffected features/attachments remain invariant.
4. Provide code-callable cross-section results and exact curve/frame metadata where supported, not only a mesh screenshot. A mesh-derived slice stays tagged approximate with mesh-deviation bounds.

Bend fit: no direct FreeCAD/OCC embedding; pure primitive serialization, parameter lookup and constraint-impact diffs are straightforward U32-indexed/F32x2 maps and balanced reductions. Float64 assumptions in Python/FreeCAD need explicit scale/error analysis; F32x2 is not full binary64 range. Sketch solve remains iterative/irregular and should be bounded CPU fork-join rather than assuming uniform GPU suitability. Rendering observation layer can remain JS; actual coordinates, sections and constraints remain Bend. No general Boolean, fillet or exact-predicate method is offered by this work.

## Pointers worth porting or studying

Paper §4.1/Table 2 encoding ablation; Tables 4–5 constraint-impact experiment; supplemental §§7/9 and Tables 7–10 representations. Source `cad_assistant/core.py`, `cad_tools/sketch_recognizer_code.py::SketchConverter`, `solid_recognizer_code.py`, `sgp_cad_evaluator.py`. Local PDF `<repo>/tmp/research/pdf/cad-assistant-2412.13810.pdf`; checkout `<repo>/tmp/research/cad-assistant-mallis-et-al-iccv-2025`.

## Verdict: learn-from

Good primary evidence for explicit geometric observation and solver-impact checking. Correct the overstated overparameterization result; respect restricted licensing and incomplete release. Independently implement selected contracts rather than adopting the code or counting qualitative demos as robust modeling coverage.

