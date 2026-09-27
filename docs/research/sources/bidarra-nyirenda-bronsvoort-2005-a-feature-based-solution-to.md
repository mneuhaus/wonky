# Bidarra, Nyirenda, Bronsvoort 2005, A Feature-Based Solution to the Persistent Naming Problem

- Kind: research paper, full ten-page author PDF read. [Canonical PDF](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf), [DOI](https://doi.org/10.1080/16864360.2005.10738401).
- Authors: Rafael Bidarra, Paulos J. Nyirenda, Willem F. Bronsvoort, Delft University of Technology. Computer-Aided Design & Applications 2(1–4), 2005, pp. 517–526. DOCUMENTED in [PDF p.1](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=1).
- License: openly accessible author manuscript, not a software license; no permissive code license or reusable source package was found in the paper. INFERRED: implement the described ideas independently and cite the authors, do not assume permission to redistribute the article/artwork or copy a hidden implementation.
- Status: historical research, illustrated implementation and examples; no repository/release/activity metrics apply.

## What it is

DOCUMENTED: replace unstable B-rep entities in parametric definitions with persistent entities in the feature domain. The authors deliberately separate (A) naming an intended entity in the definition from (B′) locating and validating its representation in the newly evaluated B-rep. They reject the premise that every old B-rep face or edge must acquire a unique successor after every edit. [§§2–3, pp.3–4](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=3).

## How it works

**Persistent vocabulary.** DOCUMENTED: reference classes provide named auxiliary planes, cylinders and lines with geometric constraints, even when no corresponding B-rep entity exists. Declarative feature classes define parameterized canonical volumes, their feature nature (additive/subtractive), constraints, feature faces and auxiliary feature references. A cylindrical hole has top, bottom and side feature faces plus an axis. Procedural features such as chamfers/blends differ: they require an actual B-rep edge, and their shape/material behavior depends on that edge's geometry and convexity. [§§3.1–3.3, pp.4–6](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=4).

**Names and ownership invariant.** DOCUMENTED: `<feature instance name>.<feature element name>` is unique as long as the instance exists. Feature faces are never split, merged or deleted by boundary evaluation, although their B-rep representations can be. Each B-rep face must represent part of exactly ONE feature face and carry its owner name; splitting propagates the owner. Adjacent coplanar faces MUST NOT be merged unless they share the same owner. This non-maximal-face requirement is crucial, not optional metadata decoration. Explicitly deleting a feature instance is different from trimming away its geometric realization. [§3.2, p.5](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=5).

**Edge names.** DOCUMENTED: search the B-rep for an edge whose adjacent faces have the prescribed feature-face owners. Store `(adjacent feature faces, discriminator)`. For planar manifold examples, the additional feature faces incident at the start/end vertices distinguish a selected segment; Fig.5 identifies a partial edge by `(<block.top,block.right>, <block.front,slot.left>)`. These endpoint-face discriminators are not sufficient for curved surfaces: a block front and cylindrical slot side can intersect in two edges with the same end-face names. [§3.4, p.6](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=6).

**Half-space discriminator.** DOCUMENTED: group intersection edges by feature-face owner pair. For each multi-edge group, generate one or more reference planes positioned relative to persistent feature elements; assign edges to positive/negative half-space combinations. Surface type, feature canonical shape and available references (e.g. axes) guide construction. Iterate until the edges have distinct combinations. The paper gives a generic scheme and examples, not a complete source implementation or a termination proof for arbitrary surfaces. [§4, pp.6–8](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=6).

- DOCUMENTED: planar block / cylindrical slot: plane through the cylinder axis and orthogonal to the block face, yielding e1/e2 as positive/negative sides. The reference moves with the slot through the constraint system; it is not a fixed world plane. [Fig.6, p.7](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=7).
- DOCUMENTED: crossing circular holes with coplanar perpendicular axes and unequal radii: reference plane through hole1's axis, orthogonal to the plane of both axes, separates the two intersection edges. It follows later changes of the axis angle. [Fig.7, p.7](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=7).

**Validation, not silent substitution.** DOCUMENTED: dependencies prevent removal of a referenced feature until the dependent feature is removed or repositioned. During reevaluation of an edge-dependent feature, collect all matching owner-pair edges and apply its existing discriminator. Cases are (1) faces no longer intersect, (2) intersection exists but zero edges satisfy the discriminator, (3) several edges satisfy it. Suspend evaluation and ask the user to remove the dependent feature, retarget it, cancel the edit, or in case 3 explicitly add features on additional edges. Do NOT silently generate a new discriminator to transfer an old selection to another edge. [§5, pp.8–9](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=8).

## Robustness and guarantees

DOCUMENTED: the paper reports validation for planar, cylindrical, spherical and toroidal surfaces (the text calls this a domain of “quadric surfaces,” although tori are not quadrics mathematically). It illustrates successful relocation and explicit invalidity detection; it supplies no exhaustive test corpus, measured failure rate, exact arithmetic specification, floating-point type, predicate error bound, epsilon or timing table. Do not infer universal geometric robustness or a proven all-surface partition algorithm from its broad guarantee language. [§4 ending, p.8](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=8).

INFERRED: name persistence is a symbolic invariant; actual existence and uniqueness are separate semantic obligations. Even perfect numeric predicates cannot decide user intent when two edges satisfy the old name. Conversely, half-space tests near tangency need a numeric contract absent from the article. Proposed Bend predicate: sign of `n·(p−o)` with certified error bounds; escalate ambiguous F32x2 results to exact multi-limb arithmetic only where the geometry representation permits an exact decision, otherwise return indeterminate. Evaluating a single arbitrary sample is not a proof that an entire curved edge lies in one half-space.

## Parallelism and performance

DOCUMENTED: no benchmark or parallel execution model is reported. The authors say ownership requirements impose no limitations on model traversal, visualization or face selection, but provide no measured overhead supporting that assertion. [§3.2, p.5](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=5). INFERRED: U32 feature/face-owner keys, sorted owner-pair adjacency tables and groupwise candidate filtering map well to immutable arrays and balanced fork-join. Half-space classifiers can run in parallel for uniform surface families; variable rounds of reference-plane generation are unsuitable for an unbucketed GPU call tree. No build/test was run.

## Known failures, limitations, war stories

- DOCUMENTED: moving a round slot can remove the selected-side edge while the other intersection edge survives. Existing systems can incorrectly move the blend to the surviving edge; this scheme instead reports no match for the stored half-space. [Figs.3 and 9, pp.3 and 8–9](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=8).
- DOCUMENTED: making two crossing-hole radii equal changes their intersection from two to four edges; two satisfy the stored half-space. Fig.11 contrasts a commercial system's arbitrary one-edge blend with the proposed explicit ambiguity. [Figs.10–11, p.9](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=9).
- DOCUMENTED: the argument in §3.4 starts with planar manifold B-reps. It is not an explicit treatment of nonmanifold radial adjacency, periodic seams or degenerate vertices. No issue tracker accompanies the paper. [p.6](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=6).
- INFERRED: coalescing coincident faces from different owners into one unqualified owner violates the paper's invariant. A multi-owner B-rep can be supported only by an extension, e.g. retaining a separate semantic patch decomposition; the paper does not provide that extension.

## Relevance for wonky

INFERRED: this is an unusually direct fit to wonky's semantic stability class. A persistent key could be `(operationId, role, sketchEntityId, patternInstanceId)` while the current B-rep holds zero/one/many realizations. Querying a semantic face returns a set, so a face split is normal, not an identity crisis. Keep that semantic key distinct from B-rep face identity and from triangulation facet tags.

INFERRED: the leading mesh-Boolean/analytic-recovery hybrid must preserve owner tags through mesh fragmentation and recovery. Analytic coplanar coalescing must either respect owner boundaries or maintain a finer semantic overlay. Otherwise the data required by this scheme is lost before selection runs. Add conformance cases for one owner→multiple fragments, two owners→coincident geometry, edge disappearance with a surviving sibling, equal-radius crossing-hole ambiguity, explicit feature deletion, and regeneration order changes.

INFERRED: no f64, rationals, mutation or FFI is required for naming keys and index joins. Only generated reference geometry and half-space classification need F32x2/error-aware or exact predicates. Preserve error alternatives in FeatureScript-facing queries; an LLM can inspect semantic roles and explicitly resolve ambiguity, but must not guess a new edge. FDM fillet safety benefits immediately: the wrong-edge-success failure is worse than a clear unsupported/ambiguous result. This is not a Boolean or fillet geometry implementation.

## Pointers worth porting or studying

- [§3.2, p.5](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=5): single-owner B-rep invariant and no cross-owner coplanar merge.
- [§3.4 and Fig.5, p.6](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=6): edge tuple and endpoint-face discriminator.
- [§4 and Figs.6–7, pp.6–8](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=7): feature-relative half-space construction.
- [§5 and Figs.9–11, pp.8–9](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf#page=8): three explicit failure cases and allowed repairs.
- Local full PDF: `<repo>/tmp/research/pdf/bidarra-nyirenda-bronsvoort-2005.pdf`.

## Verdict: adapt

Adopt semantic feature-face references and explicit zero/one/many resolution; adapt the ownership invariant to wonky's recovery/coalescing architecture. Implement only supported half-space constructions with explicit numeric limits. Do not claim universal persistent naming, automatically retarget vanished edges, or hide equal-radius ambiguities.

Sources: [full paper](https://graphics.tudelft.nl/~rafa/myPapers/jrnl-bidarra.CAD05.pdf), [publication DOI](https://doi.org/10.1080/16864360.2005.10738401).

