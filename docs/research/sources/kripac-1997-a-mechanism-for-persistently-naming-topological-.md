# Kripac 1997, A mechanism for persistently naming topological entities in history-based parametric solid models

- Kind: historical research paper. [1997 journal DOI](https://doi.org/10.1016/s0010-4485(96)00040-1), [ScienceDirect record](https://www.sciencedirect.com/science/article/abs/pii/S0010448596000401); [1995 conference predecessor](https://doi.org/10.1145/218013.218024).
- Author: Jiri Kripac. DOCUMENTED: Computer-Aided Design 29(2), February 1997, pp.113–122; conference version in Proceedings of the third ACM symposium on Solid modeling and applications, 1995, pp.21–30, with Autodesk affiliation. [Journal Crossref record](https://api.crossref.org/works/10.1016%2Fs0010-4485(96)00040-1), [conference Crossref record](https://api.crossref.org/works/10.1145%2F218013.218024). Crossref lists December for conference publication while the conference itself was May; use 1995 without treating deposit/publication month as event date.
- License: publisher-controlled Elsevier/ACM article; no code license identified. A Crossref text-mining license URL is not an open-source license or proof of full-text access. Independent implementation of ideas would still require actual algorithm access and attribution; copying article/code is not authorized by the DOI record.
- Status: historical; **full text could not be read in this run (2026-09-24)**. Primary bibliographic metadata and an indexed abstract were available. No repository, release or implementation metrics verified.

## What it is

DOCUMENTED, limited to the author abstract mirrored/indexed by [OpenAlex's 1995 record](https://api.openalex.org/works/https://doi.org/10.1145/218013.218024) and the [publisher's indexed abstract](https://www.sciencedirect.com/science/article/abs/pii/S0010448596000401): the Topological ID System assigns IDs to model faces, edges and vertices. Editing and reevaluating a sequential modeling history creates a new model; IDs from the old version are mapped to corresponding IDs in the new version. This mapping defines correspondence. This is NOT full-text verification of how IDs are constructed or how correspondence is chosen.

## How it works

Only the assign-IDs / recompute / map-correspondence architecture is verified at abstract level. **Unverified:** ID tuple fields, face split bookkeeping, merge rules, graph representation, similarity metrics, collision/disambiguation rules, operation-specific history loading, and any special treatment of deleted/resurrected faces. These must not be filled in from general knowledge of later naming systems. [Abstract record](https://api.openalex.org/works/https://doi.org/10.1145/218013.218024).

DOCUMENTED as a later author's characterization, not a direct reading of Kripac: Bidarra et al. cite Kripac as an early persistent naming scheme and contrast auxiliary B-rep tracking with their feature-domain proposal. Their reference list connects the 1995 paper with CAD 29(2), pp.113–122. It does not supply enough detail to port the Topological ID System. [Bidarra 2005 §§2–3 and references 5–6](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=3). Under the requested evidence vocabulary, specific Kripac mechanics inferred solely from such literature would be HEARSAY; none are asserted here.

## Robustness and guarantees

Not established from the available abstract/metadata. No proof, topology-domain restriction, tolerance, numeric scalar type, split/merge completeness guarantee or arbitrary-edit stability claim was verified. Abstract-level identification after reevaluation is the objective, not evidence of a universal guarantee. [Publisher record](https://www.sciencedirect.com/science/article/abs/pii/S0010448596000401).

## Parallelism and performance

No measurements, complexity analysis or parallel algorithm were accessible. No build or benchmark run. INFERRED: an ID/history mapping layer can generally use U32-indexed immutable relations and sorted joins in Bend, but the cost, traversal shape and numerical assumptions of this particular algorithm remain unknown. Do not cite Kripac as evidence for GPU suitability or any speedup.

## Known failures, limitations, war stories

The limitation here is access, not a demonstrated defect in the method. Both [ACM landing page](https://dl.acm.org/doi/10.1145/218013.218024) and [ACM PDF](https://dl.acm.org/doi/pdf/10.1145/218013.218024) returned HTTP 403. The ScienceDirect article page also returned 403. [Elsevier's official content endpoint](https://api.elsevier.com/content/article/PII:S0010448596000401?httpAccept=text/xml) returned only core bibliographic XML with `openaccessArticle=false`, no abstract/body. OpenAlex marked both the [1997 version](https://api.openalex.org/works/https://doi.org/10.1016/S0010-4485(96)00040-1) and [1995 version](https://api.openalex.org/works/https://doi.org/10.1145/218013.218024) closed and found no repository full text. Search found citations, not a lawful readable original. No issue tracker was identified. A 403 can also reflect bot restrictions; it alone does not prove that no institutional reader can access the paper.

## Relevance for wonky

INFERRED from the verified architecture: distinguish stable construction identity from transient B-rep identity and store explicit cross-regeneration correspondence. That is relevant to naming, provenance and diffing, but does not resolve wonky's open one-to-many successor problem without the missing details. Representing a correspondence as a relation, rather than forcibly a function, is a sensible wonky design proposal, **not a verified Kripac prescription**.

Bend fit remains provisional: symbolic identifiers need U32 rather than f64; exact geometry-based disambiguation may require F32x2 filters or multi-limb predicates, but whether the paper requires either is unknown. Fork-join scheduling, affine-array storage and uniform GPU work cannot be evaluated without the algorithm. Prefer directly inspected OCCT naming and Bidarra's full text for immediate engineering. No linking an external kernel is proposed.

## Pointers worth porting or studying

- Obtain a lawful copy of [CAD 1997](https://doi.org/10.1016/s0010-4485(96)00040-1) or [SMA 1995](https://doi.org/10.1145/218013.218024), then inspect the actual ID schema, split/merge examples and matching rules before implementation.
- Bibliography and competing semantic approach: [Bidarra 2005 full paper](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf).
- Local access evidence: `<repo>/tmp/research/kripac-1997-a-mechanism-for-persistently-naming-topological-/elsevier.xml`, `openalex-1995.json`, `acm-pdf-access-error.html` in that same absolute directory. No downloaded file is falsely labeled as a readable PDF.

## Verdict: unreachable

Bibliography and abstract were read; full paper and port-level details remain inaccessible. Preserve it as a high-value historical follow-up, not as verified implementation guidance. Open work: lawful full-text acquisition and direct validation of split/merge behavior.

Sources: [journal DOI](https://doi.org/10.1016/s0010-4485(96)00040-1), [conference DOI](https://doi.org/10.1145/218013.218024), [indexed author abstract](https://api.openalex.org/works/https://doi.org/10.1145/218013.218024), [Elsevier metadata](https://api.elsevier.com/content/article/PII:S0010448596000401?httpAccept=text/xml), [Bidarra 2005](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf).

