# Marcheix & Pierra 2002, A survey of the persistent naming problem

- Kind: research survey. [Canonical DOI](https://doi.org/10.1145/566282.566288), [ACM article](https://dl.acm.org/doi/10.1145/566282.566288), [HAL author/institutional record](https://hal.science/hal-03700801).
- Authors: David Marcheix and Guy Pierra, Laboratoire d'Informatique Scientifique et Industrielle (LISI), France. DOCUMENTED: Proceedings of the seventh ACM symposium on Solid modeling and applications, 2002, pp.13–22; Crossref date 2002-06-17. [Publisher-deposited metadata](https://api.crossref.org/works/10.1145%2F566282.566288).
- License: ACM publication, no verified open-access or software license. A bibliographic record or text-mining link is not permission to reproduce full text or implementation.
- Status: historical survey. **Full text not obtained or read in this run, checked 2026-09-24.** No repository/release/activity metrics apply.

## What it is

DOCUMENTED at bibliographic level: a ten-page survey of persistent naming in parametric CAD, cited as the relevant survey by [Bidarra et al. 2005, §2 and reference 8](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=3). Search/secondary abstract mirrors describe five recurring concepts and two orthogonal classification criteria, but neither the actual enumerations nor the full argument were retrieved from the original. Treat those details as **HEARSAY/unverified**, not a reconstructed taxonomy. [Secondary listing](https://www.researchgate.net/publication/221115805_A_survey_of_the_persistent_naming_problem).

## How it works

Not verified beyond its subject and survey nature. No direct reading of its definitions, classification axes, comparison table, formulas, cases or conclusions was possible. In particular, do not attribute a specific “generation-based versus geometry-based” axis or a split/merge taxonomy to this paper merely because later naming literature uses those concepts. The [Crossref record](https://api.crossref.org/works/10.1145%2F566282.566288) contains no abstract; the [HAL API record](https://api.archives-ouvertes.fr/search/?q=halId_s:hal-03700801&fl=title_s,abstract_s,uri_s,fileMain_s,files_s,docType_s,authFullName_s,producedDate_s&wt=json) has title/authors/date/URI but no abstract or file attachment.

## Robustness and guarantees

No theorem, precise failure taxonomy, tolerance model or numeric assumptions verified. A survey can organize competing guarantees, but is not itself evidence that a naming method handles arbitrary topology change. Any assertion that this paper proves split/merge/reorder robustness would exceed the available source.

## Parallelism and performance

No performance figures, algorithmic complexities or parallelization claims could be read. No local experiments or builds were run. There is no evidence to map specific surveyed methods to F32x2, exact integer predicates, fork-join or GPU execution.

## Known failures, limitations, war stories

Access results, not algorithm defects:

- [ACM article](https://dl.acm.org/doi/10.1145/566282.566288) and [PDF endpoint](https://dl.acm.org/doi/pdf/10.1145/566282.566288) returned HTTP 403. The returned HTML was preserved as an access-error HTML file, not passed off as a PDF.
- [HAL landing page](https://hal.science/hal-03700801) returned an access-denied page; its public [metadata API](https://api.archives-ouvertes.fr/search/?q=halId_s:hal-03700801&fl=title_s,abstract_s,uri_s,fileMain_s,files_s,docType_s,authFullName_s,producedDate_s&wt=json) was readable and lists no attached full text.
- [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1145/566282.566288) marks it closed, with no repository full text and only DOI/HAL locations. Its abstract field contains only “International audience,” not an abstract.
- [Author's LIAS profile](https://www.lias-lab.fr/members/davidmarcheix/) was read but supplied no paper copy. ResearchGate direct fetch was forbidden and search led to request-PDF pages/citations. No authenticated retrieval or paywall circumvention was attempted.

A 403 may be anti-bot rather than lack of a human entitlement, so “unreachable in this run” is narrower and more accurate than “nobody can access it.”

## Relevance for wonky

INFERRED research use: a verified survey could check whether wonky's selection and lineage contract covers established classes of failure. Until then, use the independently read [OCCT naming guide](https://occt3d.com/dev/doc/overview/html/occt_user_guides__ocaf.html#occt_ocaf_5) and [Bidarra's full paper](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf) to justify concrete tests.

INFERRED proposed wonky checklist, **not presented as Marcheix/Pierra's taxonomy**: distinguish initial naming from reidentification; zero/one/many successors; merge with several origins; deleted versus temporarily absent geometry; changing adjacency/orientation; periodic seams; recomputation order; feature-dependent versus imported models; geometric equivalence versus construction-intent equivalence. Expected query outcomes should include Missing, Ambiguous, Split and Unsupported rather than a guessed unique ID. These follow from wonky's requirements and the directly read sources, not from an inaccessible comparison table.

Bend implications remain source-independent: symbolic IDs and history relations can be represented in U32-indexed immutable structures; geometric matching may need F32x2 filters or multi-limb exact predicates with an explicit indeterminate result. No conclusion about this survey's numeric model, fork-join friendliness or GPU uniformity is possible. No external CAD kernel linkage is proposed.

## Pointers worth porting or studying

- Obtain a lawful copy through [ACM DOI](https://doi.org/10.1145/566282.566288) or the authors. Verify the five concepts and two criteria before adding them to wonky's requirements taxonomy.
- Compare with directly accessible [Bidarra 2005](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf), which cites this work, but do not substitute that paper for the survey.
- Access artifacts: `<repo>/tmp/research/marcheix-pierra-2002-a-survey-of-the-persistent-naming-probl/hal-metadata.json` and `<repo>/tmp/research/marcheix-pierra-2002-a-survey-of-the-persistent-naming-probl/acm-pdf-access-error.html`.

## Verdict: unreachable

Keep as a bibliographic and taxonomy follow-up. Metadata and access routes were checked, but there is insufficient primary content for port-level advice. Open work: obtain/read the original, transcribe its actual taxonomy with page references, then compare it against wonky's error/result contract.

Sources: [ACM DOI](https://doi.org/10.1145/566282.566288), [Crossref](https://api.crossref.org/works/10.1145%2F566282.566288), [HAL](https://hal.science/hal-03700801), [OpenAlex](https://api.openalex.org/works/https://doi.org/10.1145/566282.566288), [Bidarra 2005](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf).

