# Capoyleas, Chen & Hoffmann 1996: Generic naming in generative, constraint-based design

- Kind: research paper. Canonical journal DOI: https://doi.org/10.1016/0010-4485(95)00014-3. Computer-Aided Design 28(1), January 1996, pp. 17-26. Bibliographic primary metadata: https://api.crossref.org/works/10.1016/0010-4485(95)00014-3.
- Authors: Vasilis Capoyleas, Xiangping Chen, Christoph M. Hoffmann, Purdue University. Repository metadata spells the first name Vallis, while the report title page says Vasilis; use the latter and journal metadata.
- Full text actually read: authors' Purdue technical report CSD-TR-94-011, November 1994, revised February 1995, 23 PDF pages including covers (21 numbered report pages). Author-hosted PDF: https://www.cs.purdue.edu/cgvlab/www/resources/papers/Capoyleas-Computer_aided_design-1996-Generic_naming_in_generative.pdf. Repository landing page: https://docs.lib.purdue.edu/cstech/1114. This is an accessible predecessor, NOT verified byte-for-byte equal to the 1996 journal text. All technical section/page references below are to this report.
- Access: direct Purdue e-Pubs download returned a Cloudflare page; the Purdue Computer Science author archive succeeded. Therefore the source is not unreachable despite the initial paywall warning.
- License: no implementation license or permissive grant found in the read report. Crossref lists a CC-BY-NC-ND-4.0 version-of-record entry, as well as Elsevier TDM licenses; the reported historical effective date does not establish the author-report's license. Do not label a potential code port open source on this basis. Study and independently implement ideas; verify rights before reusing figures/text. Source: Crossref URL above.
- Maturity/status: historical Erep research implementation; no public code, current issue tracker, release or repository activity established.

## What it is

DOCUMENTED: a procedure for constructing generic names for picked geometry in a generative model, combining construction-origin names, topological context, local orientation and feature-generated orientation. It explicitly separates producing the name from resolving/updating names when editing; the detailed edit matching is delegated to companion report Chen & Hoffmann, Editing feature based design, CSD-TR-94-067. Source: abstract, introduction and references in the author PDF above.

The crucial idea is that a selected B-rep instance is not the user's generic intent. The record should be a modeler-independent expression that can be interpreted at a later feature-history state, rather than a pointer or the mouse-picked location. That is DOCUMENTED as the Erep design goal, not evidence of a historical implementation lineage into OCAF or Onshape. Source: report pp. 1-4.

## How it works

### Scope and generated names

DOCUMENTED assumptions: sequential features with fixed order; sketches made of lines/arcs enclosing connected finite areas; extrusion and revolution; datum points/axes/planes; modifying blends/chamfers. Mirroring, patterning and shelling are excluded for simplicity. Correct sketch-solver branch selection is assumed. References for feature k are evaluated against the geometry present at that construction stage, not the final model. Sources: Sections 2 and 3.3, report pp. 4-6 and 11.

DOCUMENTED generated-name rules: sketch vertices vi, edges ei and enclosed region f get feature-qualified names. Extruding sketch edge ei produces side face f(ei); sweeping vertex vi produces side edge e(vi). Front/back copies are distinguished along sweep direction; full revolutions lack front/back caps. Prefix the feature name, e.g. X.ek, to make sketch-local names global. A chamfer/round face gets c(e) or r(e), possibly based on an edge list. Newly intersecting edges and vertices initially get collective labels Ie and Iv and must be disambiguated. Sources: Section 3.1, Fig. 3, report pp. 6-8.

DOCUMENTED merge rule: when newly generated geometry coincides with existing geometry and is merged, keep the existing entity's name; for merged faces Section 5.3 specifies the earliest feature's name. Later face names also carry adjacent-edge expressions. This is a particular name-selection convention, not a full multi-parent provenance relation. Sources: Sections 3.1 and 5.3, pp. 7-8 and 20.

### Context graph and distinguishing certificate

DOCUMENTED graph G has labeled vertex, edge and face nodes. Incidence links are face-edge and edge-vertex; direct face-vertex links are intentionally ignored. Multiple physical B-rep faces may be grouped into one logical face, so G can be a reduction of raw topology. The immediate context is a node's star, with repeated labels counted, not discarded. Source: Section 3.2, Figs. 4-5, pp. 8-10.

To name a selected node r:

1. Gather every node R sharing r's base label. If unique, no context is needed.
2. For each candidate v in R, breadth-first search to bounded depth d.
3. Partition reached nodes by (distance from v, base label); encode each class as (distance,label,count).
4. Distinguish candidates with different class structures.
5. Optionally reduce the stored context to distinguishing classes and path-supporting classes connecting them to the root. The authors explicitly say reduction sacrifices some resolution on later edits.

This is DOCUMENTED pseudocode on pp. 10-11. The paper calls it essentially spectral graph isomorphism, but the concrete procedure here is labeled distance-count signatures, not an eigenvalue routine; do not unnecessarily port a linear-algebra library. It cannot solve arbitrary graph isomorphism or distinguish automorphically equivalent entities. Source: Section 3.3.

### Local and construction-relative orientation

DOCUMENTED edge-use convention: face normals point outward; traversing an edge as used by that face keeps face interior on the left. An open edge can be encoded by [face,startVertex,endVertex], sometimes using terminating faces instead of endpoints. Closed edges cannot use this endpoint triple. Source: Section 4.1, Fig. 7, pp. 12-13.

IMPORTANT DOCUMENTED rejected alternative: the authors consider sign((n1×n2)·n3) at a vertex, then explicitly DO NOT use it because its invariance under edits is unclear. Instead they retain manifold/nonmanifold status and a cyclic counter-clockwise list of incident faces for manifold vertices. Do not describe the determinant-sign sketch as their implemented solution. Source: pp. 13-14.

DOCUMENTED feature orientation is induced by the generating operation: constant sweep vector for extrusion; instantaneous rotational velocity field for revolution, with an axis-direction convention at singular points. On cylinder-like swept topology, curves are divided into: (1) longitudinal/aligned cuts, (2) separating loops with source/sink flow across them, (3) hole-boundary loops with mixed source/sink. Feature orientation descriptor [F,f,c] records feature, adjacent face and c=+/-, in/out, or 0 respectively. Type-2 edges can carry [F,f,m,n,q], position m among n such edges, with q specifying total versus cyclic ordering. The feature field plus local face-use direction can distinguish edges that either field alone cannot. Sources: Section 4.2, Figs. 10-12, pp. 14-17.

DOCUMENTED final expressions: edge Ee=[Ce,Le,Fe], vertex Ev=[Cv,Lv,Fv]. Ce is cyclic adjacent-face context, Le encodes open-edge endpoint/use orientation (empty on closed edges), Fe feature-orientation evidence using the latest relevant feature. Vertex context is cyclic for manifold vertices, unordered for nonmanifold ones, with corresponding status marker. Canonicalization uses creation order/set expressions; definitions must be noncircular. Add reduced context only when the basic expression still has collisions, up to a predefined maximum depth. Sources: Sections 4.3 and 5, pp. 17-20.

## Robustness and guarantees

DOCUMENTED: neither topological context nor orientation is complete; even their combination admits unresolved symmetry. Toroidal-cut boundary circles have a graph symmetry that swaps them (Fig. 6). Other examples defeat local orientation (Fig. 9) or feature orientation alone (Fig. 12). The report claims robust/reliable experimental experience but supplies no general theorem, numeric tolerance specification or quantitative success rate. Sources: Sections 3.3, 4 and 5-6.

DOCUMENTED fallback policy in this implementation is surprisingly permissive: for a blend/chamfer with ambiguous name, apply the modification to ALL equally named entities; for a dimension requiring unique identification, require changing the dimensioning scheme. They also accept some ambiguity when all candidates have the same underlying line for a distance reference. Source: Section 5, p. 19. This is a semantic policy choice, not proof the ambiguity has been solved.

INFERRED: the 'all equal names' fallback is unsafe as an implicit wonky default, especially for destructive fillets/chamfers or FDM clearance features. Return Ambiguous with candidates unless the query explicitly requests a set or equivalent-support semantics. Also, an automorphism-invariant description cannot uniquely select one of two truly symmetric entities without additional construction/user evidence. Source basis: the report's counterexamples and fallback discussion.

## Parallelism and performance

DOCUMENTED: bounded-depth BFS, reduced certificates and staged escalation are provided; no benchmark times, hardware, memory use or asymptotic end-to-end measurements are reported. The historical software's claimed robustness is qualitative. Source: Sections 3.2 and 5-6.

INFERRED complexity: for c same-label candidates, each unbounded BFS costs O(V+E), so straightforward context construction is O(c*(V+E)) before class sorting; depth limits reduce visited subgraphs, not the worst-case dense/symmetric case. Candidates can be processed in balanced fork-join. Each BFS can use immutable frontier arrays, sort/unique visited IDs and segmented histograms instead of a mutable queue. Uniform GPU work requires fixed depth, degree buckets or bounded adjacency tiles. This cost analysis is ours, derived from the published pseudocode, not a reported benchmark.

## Known failures, limitations, war stories

DOCUMENTED Fig. 1: changing slot position in Pro/ENGINEER 12 makes an edge round jump to another intersection edge. This is a historical observed example, not a statement about modern Creo. Topology alone cannot distinguish the two curves arising from the same face pair. Source: pp. 1-3.

DOCUMENTED scope limitations: fixed feature order, assumed intended sketch solution, excluded pattern/mirror/shell operations, closed-edge endpoint failure, symmetry, finite-depth context and reduced-certificate information loss. Full edited-name matching lives in a companion paper not read in this task. Sources: Sections 2-5 and reference [2]. No public issue tracker was found for this research prototype.

## Relevance for wonky

INFERRED: use this as a design for explainable topologyReference expressions, not another supposedly permanent integer. The hybrid already knows generating features and surface-pair intersections; preserve that evidence at creation and attach an orientation/context certificate only when collisions actually occur. Feature-qualified semantic roles should use stable internal feature IDs rather than mutable display names.

Suggested resolution ladder: exact construction lineage -> support/trim roles -> oriented incidence -> bounded contextual certificate -> explicit candidate set. Each step should return evidence and cardinality. Build certificates at the appropriate historical feature boundary, so a later Boolean destroying an edge does not invalidate a reference that was evaluated earlier. Preserve ALL merge parents even if one display name is preferred; do not inherit the paper's earliest-name rule as the complete provenance model.

Bend fit is strong for the core: U32-labeled graphs, counts, tagged canonical expressions and immutable revision tables. Most context work needs no floating point. Analytic feature vectors and face orientation can use F32x2 with bounded evaluation; use certified signs/U32-limb predicates where representable and an explicit zero/uncertain result at degeneracy. No binary64 precision is mandated by the naming algorithm, but the report also does not certify an F32 implementation. Avoid unbounded cyclic expression expansion through interned DAGs and an acyclicity check.

For diff and LLM ergonomics, report why a name resolved, which certificate changed, and whether an edit transformed a singleton into multiple candidates. For testing, directly adapt Figs. 1, 6, 9 and 12 as symmetry/orientation/closed-loop fixtures. None of this solves SSI or fillet geometry itself.

## Pointers worth porting or studying

- Section 3.1 / Fig. 3: extrusion/revolution semantic role naming.
- Section 3.2 pseudocode and reduced-context example: simple integer-only certificate algorithm.
- Section 3.3: naming at historical feature boundaries and explicit incompleteness.
- Sections 4.1-4.3: face-use versus feature-flow orientation, closed edges, noncircular expressions.
- Section 5 p. 19: ambiguity policy to replace, not blindly inherit.
- Companion paper pointer only: Chen & Hoffmann, Editing feature based design, Purdue CSD-TR-94-067 (reference [2]); not verified here.
- Local PDF: <repo>/tmp/research/pdf/capoyleas-chen-hoffmann-1994-generic-naming.pdf.

## Verdict: adapt

High-value precursor with directly implementable integer context signatures, source-derived orientation and explicit semantic naming. Adopt the layered/canonical-expression design, replace silent apply-to-all ambiguity and earliest-origin-only history, and retain fixed-scope limits. The 1994/95 report was fully read; exact differences from the 1996 journal version and the companion edit-matching algorithms remain open.

Sources:
- [Full Purdue report](https://www.cs.purdue.edu/cgvlab/www/resources/papers/Capoyleas-Computer_aided_design-1996-Generic_naming_in_generative.pdf)
- [Purdue repository record](https://docs.lib.purdue.edu/cstech/1114)
- [Journal metadata](https://api.crossref.org/works/10.1016/0010-4485(95)00014-3)

