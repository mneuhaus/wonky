# Arko-T: Text-to-Structured 3D (BitInf / Wuhan U.)

- Kind: research paper. Full title **Arko-T: A Foundation Model for Text-to-Structured 3D Generation**. Canonical [arXiv 2606.30429](https://arxiv.org/abs/2606.30429), [v2 PDF](https://arxiv.org/pdf/2606.30429v2), [HTML](https://arxiv.org/html/2606.30429v2). Initial submission June 29, 2026, revision June 30; preprint, not an established conference result.
- Authors: Liang Wang, Zhaoyang Xi, Zekai Xiang, Heng Meng, Qishan Zhang, Pingyi Zhou, Jin Liu, Litao Chen. Affiliations: Spatial Design Intelligence Lab, BitInf Ltd.; Wuhan University; Nanjing Tech University. DOCUMENTED paper title page.
- License: DOCUMENTED article CC-BY-SA-4.0 from [arXiv rights link](https://arxiv.org/abs/2606.30429). This does not grant a license to absent training data, weights or code. Independently implementing ideas does not automatically make wonky share-alike; copying/adapting licensed expressive material requires attribution and applicable SA obligations. The mixed open-source/internal training corpus has no itemized license manifest in the paper.
- Release/status: paper §6 says scored outputs and evaluation code are **slated for public release alongside the final report**, not already supplied by v2. GitHub/Hugging Face searches during this reading did not locate an attributable official Arko-T repository/model. That is a bounded search result, not proof none exists. No repository language/size/stars/contributors/last-commit/release statistics can responsibly be assigned. The organization-domain probe `https://www.bitinf.ai` was connection-refused; the paper itself is fully reachable. [Paper §6](https://arxiv.org/pdf/2606.30429v2).

## What it is

DOCUMENTED: a 4B transformer producing executable Build123d Python from natural-language single-part requests. It emphasizes a design that can be edited, not merely a surface that can be rendered. The model is initialized from Qwen3.5-4B, receives domain continual pretraining and supervised fine-tuning on about 1.3M prompt/program pairs. Build123d/its CAD backend performs geometry; this is not an alternative Boolean kernel. [Paper §§1,4](https://arxiv.org/pdf/2606.30429v2).

## How it works

DOCUMENTED formalism, §3 Eqs.1–2:

`x → z →[D_b] p_b →[E_b] (g,ℓ)` where request x maps conceptually to design state z, backend decoder D_b emits program p_b, backend execution E_b produces geometry g and log ℓ. `z=(F,Θ,C,H,A)` comprises:

- F: feature vocabulary (holes, ribs, fillets, shells, patterns).
- Θ: named parameters (radii, thicknesses, spacings).
- C: constraints/relations (symmetry, coplanarity, spacing rules).
- H: ordered construction history (sketch, extrude, cut, fillet etc.).
- A: attachments binding features to faces, edges or sketch planes.

For a bracket, named hole radius and plate thickness belong in Θ, hole-spacing relation in C, build sequence in H, each hole's support face in A. B-rep boundary geometry alone does not encode all five. **This is a conceptual design-state formalization and normalization target, not a released typed IR with parser/serializer/identity algorithm.** Actual output is a Build123d program. [Paper §§3–4.1/Fig.3](https://arxiv.org/pdf/2606.30429v2).

DOCUMENTED training pipeline, §§4.2–4.4:

1. Roughly equal sources: converted DeepCAD/related construction sequences paired with generated text; open-source CAD and internally authored designs. Filter both by executing programs and retaining nonempty valid solids.
2. Normalize feature constructions into canonical patterns; move editable dimensions to a top-of-file parameter block with descriptive names/unit annotations; regularize construction sequence toward sketch→extrude→secondary features→finishing; explicitly express symmetry/spacing and face/edge references. The paper does not give the normalization algorithm, correctness checks for reordering noncommuting operations, full vocabulary or attachment-resolution code.
3. Continual pretraining on documentation/API references for Build123d, CadQuery, OpenSCAD, modeling libraries and internal design documents. Then LoRA SFT over 1.3M pairs, one epoch, batch 256, learning rate 2e-4 on 16 GPUs. **Execution-grounded here means execution-filtered supervised data**, not a demonstrated online theorem prover, reinforcement learner, or parameter-perturbation optimizer.
4. Generated code is executed by the backend. Syntactic validity does not ensure nonempty/manifold geometry or realization of requested features. The explicit five-part tuple is useful as an inspection checklist, not evidence that every model output carries valid editable design intent. [Paper §§3–4](https://arxiv.org/pdf/2606.30429v2).

## Robustness and guarantees

DOCUMENTED evaluation gate: code must execute and result must be a nonempty valid solid. Invalid rate includes crashes, empty and non-manifold bodies. Exact validity API, tolerances, environment pins and kernel-version failure handling are not specified sufficiently for independent reproduction. No formal proof of design-state preservation, attachment stability or parameter-edit robustness is supplied. [Paper §5.1](https://arxiv.org/pdf/2606.30429v2).

**Critical correction to seed, DOCUMENTED:** all 12 numerical columns are three metrics (invalid rate, Chamfer distance, IoU) × four splits (L1/L2 × Geo/Pro). There is **no reported “design-state preserved” metric**, ±epsilon perturbation audit, brittle/coupled/robust classifier or quantified attachment-preservation test in this paper. Section 6 explicitly calls automated feature realization and validity after parameter edits **future work**. A separate tool may be inspired by it, but that would be a downstream design, not a published result. The seed's build123d-mcp inspiration claim was not verified as part of this source. [Paper §§5.1,6](https://arxiv.org/pdf/2606.30429v2).

DOCUMENTED: CD/IoU only score valid outputs, after scale/pose alignment by “bidirectional normalization”; the exact alignment procedure is not elaborated. Thus high geometry scores do not penalize every failed example, and can hide wrong absolute dimensions, pose, holes or ribs. No ablation isolates the causal effect of the five-part normalization from dataset volume, domain training or base model. [Paper §§5.1,5.5,6](https://arxiv.org/pdf/2606.30429v2).

## Parallelism and performance

DOCUMENTED author-reported, not reproduced:

- Text2CAD-Bench has 400+ prompts, simple single-feature L1 and multi-feature L2, geometric layperson wording (Geo) and procedural expert wording (Pro). Same prompt, temperature .6, up to three retries after execution failure. It is **Text2CAD-Bench (arXiv:2605.18430), not BenchCAD (2605.10865)**. [Paper §5.1–5.2 and reference](https://arxiv.org/pdf/2606.30429v2).
- Chamfer equation (3): average squared nearest point distance in both directions, reported ×10³; Arko-T 2.46, 2.33, 4.92, 5.02 over the four splits. IoU uses 128³ occupancy grids; Arko-T .873/.868/.801/.780. Invalid rates 4.4%,3.9%,12.2%,12.2%. It leads 8/12 columns, second 3/12, third on L1-Pro IoU. This is not eight independent benchmarks or eight direct design-state tests. [Table 2](https://arxiv.org/pdf/2606.30429v2).
- Multi-feature validity remains a weakness: comparator Gemini-3.5-flash IR 1.6%/9.5% vs Arko-T 12.2%/12.2%; “~10 pp gap” applies approximately to L2-Geo, not both L2 columns. Invalid examples excluded from CD/IoU complicate ranking across systems.
- Table 3: 971 requests including retries, 1.07M tokens, .41 s/item, $0.0007/item, $0.28 run, locally on **4×A100 80GB**; API baselines $1.69–$18.14/run, 17–582 s/item. Paper openly notes raw compute at $1.50/A100-hour versus vendor API pricing is not apples-to-apples. Ratios are roughly 6–65× cost reduction, not universally tenfold. Latency is model-serving reporting, not certified end-to-end CAD regeneration on a local Mac or Bend Metal. [Paper §5.4/Table 3](https://arxiv.org/pdf/2606.30429v2).

INFERRED: nothing here establishes a Bend parallel algorithm. Training needs mutable tensor runtimes/large accelerators; fitting a transformer in Bend is neither required nor useful for adopting the state model. Numeric validation of independent parameter variants could later be balanced fork-join jobs, grouped by common topology/operation for GPU uniformity, but that experiment is not in Arko-T.

## Known failures, limitations, war stories

DOCUMENTED §5.5: precise coordinate reasoning for revolutions/sweeps along complex paths; thin walls collapsing under small numerical errors; polar patterns with wrong inferred axis or count. Programs often execute but generate the wrong intended shape. §6: text-only, single parts; assemblies, multimodal inputs and iterative editing are out of scope/future work. Geometric metrics may miss absent ribs/bolt patterns. Figure 1's out-of-distribution gallery states no identical training example, but no public deduplication audit or data manifest was available to check that claim. [Paper §§5.5–6/Fig.1](https://arxiv.org/pdf/2606.30429v2).

No official issue tracker or runnable source was located, so no implementation failure was reproduced and no issue anecdotes are invented. Corpus/weights/evaluator availability and exact CAD validation details remain open.

## Relevance for wonky

INFERRED concrete use of the five components:

- F: explicit feature instances/types and supported-domain status; distinguish intended feature from a geometric primitive that merely resembles it.
- Θ: named typed unit-bearing parameters, dependency expressions, admissible ranges, and actual resolved values. Preserve exact tokens/unit intent in the JS interpreter and compute geometry in Bend.
- C: mathematical relations with solver/evaluator status and residual/error bounds; do not mistake a source-code comment for an enforced constraint.
- H: immutable feature dependency DAG plus ordering/provenance, operation status and source spans. A mere linear log is insufficient if only part of the model rebuilds.
- A: support references resolved through provenance-aware queries, with expected cardinality and explicit ambiguous/missing/stale status. Deterministic IDs alone do not prove that the same intended support survives a split/merge.

Each summary component should point to evidence in the executed revision. This turns “design to edit” into testable contracts rather than branding.

INFERRED prototype **beyond the paper**, clearly not an Arko-T algorithm: perturb a continuous parameter by application-chosen absolute/relative delta, constrained by units and valid ranges; rebuild ±delta independently in Bend; check valid solids, unchanged unrelated feature/attachment invariants, intended dimensional response and boundary cases. Sweep several deltas, since numerical noise and intended topology transitions can invalidate a one-epsilon classification. Record topology changes separately from unintended coupling. Discrete counts need integer steps, not fractional epsilon. Explicitly label bounded sampled evidence, not global parametric robustness. Such an audit should never implicitly accept an unsupported Boolean or approximate fillet.

Bend fit: the design tuple and immutable DAG/attachments map well to U32 IDs, tagged structures and affine arrays. F32x2 suffices only within certified scale/error limits for dimensional evaluations; Build123d's double-based geometry assumptions and unrestricted Python libraries cannot be embedded. Multi-limb exact predicates may be needed for invariant tests involving topology; the paper supplies none. Independent rebuild/check tasks support balanced fork-join; heterogeneous failure/retry paths are not naturally uniform GPU work. Keep generative model inference external to the production kernel; JS translates unchanged FS frontend semantics, Bend computes solids and checks. No solution to wonky's general curved Boolean/SSI/fillet gap is contained here.

## Pointers worth porting or studying

Equations 1–2 (design-state vocabulary), §4.3 normalization, Fig.4 named-parameter example, §5.1 validity gate/metrics, §5.5 failures, §6 explicitly unimplemented edit/feature evaluations. PDF `<repo>/tmp/research/pdf/arko-t-2606.30429.pdf`; text `<repo>/tmp/research/pdf/arko-t-2606.30429.txt`. No clone or code port was possible without a located official repository.

## Verdict: learn-from

Adopt the conceptual separation between shape validity and editable design structure, independently extend it into verifiable wonky provenance/parameter/attachment contracts. Do not claim the paper measures edit preservation or supplies a robust-design audit. Its model results are promising author evidence with limited public reproducibility, not a ready-to-adopt implementation or kernel robustness guarantee.

Sources: [Arko-T paper and rights](https://arxiv.org/abs/2606.30429), [full v2 PDF](https://arxiv.org/pdf/2606.30429v2). Repository searches yielded no attributable release; unrelated similarly named search results were not used as sources.

