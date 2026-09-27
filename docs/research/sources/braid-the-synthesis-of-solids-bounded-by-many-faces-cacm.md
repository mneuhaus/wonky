# Braid, The synthesis of solids bounded by many faces (CACM)

- **Kind / canonical URL:** historical research paper, [DOI 10.1145/360715.360727](https://dl.acm.org/doi/10.1145/360715.360727). Primary accessible evidence: [publisher-deposited Crossref metadata and abstract](https://api.crossref.org/works/10.1145/360715.360727) [C].
- **Author / venue / year — DOCUMENTED:** I. C. Braid, University of Cambridge, Cambridge, England; *Communications of the ACM* **18(4), 209–216, April 1975**, ACM. Eight-page article. [C](https://api.crossref.org/works/10.1145/360715.360727).
- **License — DOCUMENTED / access limit:** Crossref points to the [general ACM copyright policy](https://www.acm.org/publications/policies/copyright_policy#Background), not a permissive code license. The original paper's copyright notice could not be inspected. Do not interpret historical publication or free-to-read indexing as permission to copy text/pseudocode or as patent clearance. [C](https://api.crossref.org/works/10.1145/360715.360727).
- **Status / activity:** historical publication, not a maintained repository; language, source size, commit dates, contributors, stars and releases are not applicable. Full text could not be retrieved in this environment on 2026-09-24.

## What it is

**DOCUMENTED from the actual publisher abstract:** a technique to synthesize and store a class of solid objects from primitive cube, wedge and cylinder solids. Objects can be moved, scaled and rotated, and combined by addition/subtraction. The abstract states that **two addition algorithms** are described. Its claimed user-facing advantage is concise, composable operations on easily imagined solids, allowing short construction sequences to produce objects with many boundary faces. [C, abstract](https://api.crossref.org/works/10.1145/360715.360727).

**Access boundary:** this note does not claim to have read the algorithms, figures, derivations or experiments. Search-engine snippets were not promoted to algorithmic evidence. In particular, the names/precise preconditions of the two addition algorithms, their full data structures and their numeric implementation are unverified here.

## How it works

**DOCUMENTED:** only the primitive/transform/add/subtract workflow and existence of two addition algorithms are available from the primary abstract. Crossref lists five references, including Braid's *Designing with Volumes*, second edition, 1974, and Lang's SAL systems-assembly-language paper. A reference to a programming language does **not** establish the implementation language of this paper. [C, abstract/reference fields](https://api.crossref.org/works/10.1145/360715.360727).

**Not established:** Euler operator definitions, validity invariants, coincident-face handling, intersection construction, arithmetic type, f64 dependence, exact predicates, tolerance rules and performance. Those cannot responsibly be reconstructed from the title or from modern B-rep knowledge.

**Related primary source, not a substitute for reading Braid:** Stroud's firsthand implementation notes discuss a Braid uniform-Boolean method used in GPM, shared-edge intersection rings, and the failure of some ring-wise joining cases. These facts are documented **in Stroud**, not verified as statements of this 1975 article; see [Stroud back matter, G.1, printed pp.751–757](https://link.springer.com/content/pdf/bbm:978-1-84628-616-2/1). That source has been read separately and is the more actionable item in this batch.

## Robustness and guarantees

**DOCUMENTED evidence limit:** the abstract claims representability and convenient synthesis, not an all-input correctness proof, watertightness theorem, exact arithmetic or Boolean failure bound. No robustness guarantee can be extracted beyond the described class of constructible objects. [C](https://api.crossref.org/works/10.1145/360715.360727).

**INFERRED:** do not label the paper “valid-by-construction Euler editing” solely because it belongs to the Cambridge modeling tradition. That may be a useful reading hypothesis, but the accessible original evidence does not establish it. [C](https://api.crossref.org/works/10.1145/360715.360727).

## Parallelism and performance

No measured runtime, machine specification, memory use or parallel strategy is present in the accessible publisher abstract. None is claimed here. Short construction sequences are an expressiveness claim, not a CPU speed measurement. [C](https://api.crossref.org/works/10.1145/360715.360727).

## Known failures, limitations, war stories

**Access attempts:**

- [Canonical ACM article](https://dl.acm.org/doi/10.1145/360715.360727): HTTP 403.
- [ACM PDF](https://dl.acm.org/doi/pdf/10.1145/360715.360727): HTTP 403, HTML response rather than a PDF.
- [Current CACM article path](https://cacm.acm.org/research/the-synthesis-of-solids-bounded-by-many-faces/) and [legacy CACM entry](https://cacmb4.acm.org/magazines/1975/4/11588-the-synthesis-of-solids-bounded-by-many-faces): HTTP 403.
- [OpenAlex DOI record](https://api.openalex.org/works/https://doi.org/10.1145/360715.360727) was used **only for access discovery**. It labels the ACM PDF bronze/open and reports no repository full text; that is neither a successful download nor a permissive license. Its alternate [CUMINCAD catalog location](https://cumincad.architexturez.net/doc/oai-cumincadworks-id-85d7) failed DNS resolution.

No paper-specific algorithmic failure or issue tracker was read. The 403 results should not be redescribed as proof that the article is paywalled; automated access and publication licensing are different issues.

## Relevance for wonky

**INFERRED from the abstract:** the primitive/transform/Boolean vocabulary is closely aligned with code-to-CAD and concise model programs. It provides historical motivation for composable solid operations and test models built from short construction sequences. It does not yet supply an implementable curved Boolean, SSI, fillet, naming or interference algorithm. [C](https://api.crossref.org/works/10.1145/360715.360727).

**Bend fit unresolved:** symbolic primitive trees and operation descriptions can use U32 IDs and immutable arrays, but no claim can be made about porting the paper's internals to F32x2, multi-limb predicates, balanced fork-join or uniform GPU work until the text is available. In particular, the source cannot presently justify thread scaling, numeric precision, manifoldness or tolerance behavior. FDM relevance is only the general solid-modeling goal, not a documented printing guarantee. [C, basis and limit of the inference](https://api.crossref.org/works/10.1145/360715.360727).

## Pointers worth porting or studying

1. Obtain the [original eight-page paper](https://dl.acm.org/doi/pdf/10.1145/360715.360727) through a normal accessible publisher/library route. Compare the two addition algorithms' preconditions, result topology, regularization and degeneracies before considering a prototype.
2. Read the cited *Designing with Volumes* only as a separate source; the Crossref citation is not evidence its content was inspected here. [C references](https://api.crossref.org/works/10.1145/360715.360727).
3. For actionable immediate work, use the separately read [Stroud Appendix G.1](https://link.springer.com/content/pdf/bbm:978-1-84628-616-2/1), which explicitly distinguishes proposed algorithms from incomplete implementations.

## Verdict: unreachable

The paper's identity and abstract are verified, but the substantive original text remains unreachable in this environment. Keep it in the historical reading queue, not in the list of algorithms ready for porting. The missing work is a lawful readable copy and a genuine algorithm-level read; no fabricated technical reconstruction fills that gap.

## Sources and local evidence

- [Publisher DOI/article](https://dl.acm.org/doi/10.1145/360715.360727); [original PDF endpoint](https://dl.acm.org/doi/pdf/10.1145/360715.360727).
- [Publisher-deposited metadata/abstract via Crossref](https://api.crossref.org/works/10.1145/360715.360727).
- [OpenAlex access-discovery record](https://api.openalex.org/works/https://doi.org/10.1145/360715.360727); [legacy CACM entry](https://cacmb4.acm.org/magazines/1975/4/11588-the-synthesis-of-solids-bounded-by-many-faces).
- [Stroud's separately read primary implementation account](https://link.springer.com/content/pdf/bbm:978-1-84628-616-2/1).
- Local primary metadata: `<repo>/tmp/research/commercial-kernels-2/braid-crossref.json`.
- Local access evidence: `<repo>/tmp/research/commercial-kernels-2/braid-acm-pdf-response`, `<repo>/tmp/research/commercial-kernels-2/braid-cacmb4.html`, `<repo>/tmp/research/commercial-kernels-2/braid-openalex.json`. No genuine Braid paper PDF was obtained.

