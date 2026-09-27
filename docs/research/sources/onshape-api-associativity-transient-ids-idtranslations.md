# Onshape API: Associativity (transient IDs, idtranslations)

- Kind: official public API documentation. Canonical [Associativity guide](https://onshape-public.github.io/docs/api-adv/associativity/); related [FeatureScript modeling guide](https://cad.onshape.com/FsDoc/modeling.html) and [evaluateQuery contract](https://cad.onshape.com/FsDoc/library.html#evaluateQuery-Context-Query).
- Organization: Onshape / PTC. Undated continuously published documentation, inspected 2026-09-24; the supplied 2020–2026 range is not a verified publication history.
- License: no affirmative code/documentation reuse license established from the inspected page; public accessibility is not an open-source license. DOCUMENTED: these are public descriptions of a commercial service, not an implementation. INFERRED: independently implementing the behavior is the useful route; do not copy the documentation or assume access to Onshape's internal naming algorithm. [Source](https://onshape-public.github.io/docs/api-adv/associativity/).
- Status: live commercial API documentation. No repository size, contributors, releases, or implementation language are exposed by this source. A guessed `onshape-public/docs` GitHub metadata endpoint returned 404; it is not evidence of a repository license or of service inactivity. [Checked endpoint](https://api.github.com/repos/onshape-public/docs).

## What it is

DOCUMENTED: Onshape explicitly says it does **not expose a persistent ID** for the referenced model entities. IDs can change when the model changes. The supported associativity workflow stores both an entity ID and its document microversion, then translates that reference after an edit. The guide demonstrates this for a part, faces, and edges, using tessellation endpoints as the original selection source. This is a contract for resolving references across revisions, not a promise that a short string such as `JHO` is globally stable. [Guide](https://onshape-public.github.io/docs/api-adv/associativity/).

## How it works

DOCUMENTED workflow and wire format, directly from the worked example:

1. Get the document microversion from `/api/d/{did}/w/{wid}/microversionId`; retrieve tessellated faces/edges and retain their IDs.
2. Store the selected ID **together with the source microversion**.
3. Following model edits, POST `/api/partstudios/d/{did}/w/{wid}/e/{eid}/idtranslations` with `{sourceDocumentMicroversion, ids:[...]}`. The target is the addressed workspace's model state; the request example has no target-microversion field.
4. The response contains `documentId`, `elementId`, `sourceDocumentMicroversion`, `targetDocumentMicroversion`, and a per-input `ids` array of `{source,status,target:[...]}` records.
5. Reapply application data to the returned target entities, recognizing zero, one, or multiple successors. [Request, response, and workflow](https://onshape-public.github.io/docs/api-adv/associativity/).

The demonstrated outcomes are:

- `OK`: one current target. The old ID may survive (`JHO → JHO`) **or change** (`JHD → JID`). String equality is neither necessary nor sufficient evidence of semantic continuity outside its revision context.
- `SPLIT`: multiple successors; the example part becomes `[JID,JIH]`, and an edge becomes `[JI5,JI9]`. This is an asserted one-to-many lineage result, not merely several similar candidates.
- `FAILED_TO_RESOLVE`: empty target set. The deletion example produces this for the removed face and edge. The page does not establish that every failure means physical deletion; retain the API's weaker wording.
- Translating the **same original source** after deleting one split part changes a prior `SPLIT` into `OK` for the surviving part/edge. Status is a relation between the specified source and target states, not a permanent property of an entity. [Examples](https://onshape-public.github.io/docs/api-adv/associativity/).

INFERRED implementation sketch for wonky: `Reference = (documentNamespace, elementNamespace, sourceRevision, entityKind, sourceEntity)` and `Translation = (sourceRevision, targetRevision, inputRef, outcome, successors, evidence)`. Store explicit revision-to-revision relations with cardinality; compose history relations when a direct edge is unavailable. Keep `ambiguous` for competing hypotheses separate from `split` for a known successor set, and `unsupported` separate from an established empty result. This data model follows the [documented cardinality and version contract](https://onshape-public.github.io/docs/api-adv/associativity/), not any exposed Onshape internals.

## Robustness and guarantees

DOCUMENTED: the guide demonstrates zero/one/many resolution and names both source and target microversions. It does not publish its matching algorithm, tolerance policy, persistent-name grammar, merge history, or a completeness theorem. It also does not specify cross-document/cross-element matching, reverse-translation semantics, canonical successor ordering, or a distinct `MERGE` status. Do not invent those guarantees. [Guide](https://onshape-public.github.io/docs/api-adv/associativity/).

INFERRED: even if every individual request succeeds, fetching mesh data and translating IDs against a moving workspace can race with an edit. Cache translations by **returned target microversion**, and verify the viewed geometry belongs to that same revision before applying annotations. An `OK` record is a versioned reference result, not proof of equal surface geometry, equal shape, or unchanged printability. [Basis: source/target fields and edit workflow](https://onshape-public.github.io/docs/api-adv/associativity/).

DOCUMENTED source caveat: the rollback example reuses the prior example's target-microversion literal and still maps the original part to `JID`; treat the page as an illustrative workflow, not a consistent machine-replay fixture with trustworthy opaque constants. [Rollback example](https://onshape-public.github.io/docs/api-adv/associativity/).

## Parallelism and performance

DOCUMENTED: a single request accepts an array of input IDs. No latency, throughput, complexity, accuracy statistics, GPU behavior, or parallel implementation is provided. No live service call or benchmark was run for this research. [Guide](https://onshape-public.github.io/docs/api-adv/associativity/).

INFERRED for Bend: translation over an already-built finite relation can be batched through balanced fork-join filters/joins. Revision identifiers and opaque strings can be interned into U32-indexed tables; multiword hashes need equality/collision verification. This layer requires neither f64 nor geometric tolerances. Graph traversal and variable-size successor lists are less uniform than flat batched table lookups; bounded/padded relation batches fit GPU work better. Onshape does not document any of these implementation choices. [Contract being implemented](https://onshape-public.github.io/docs/api-adv/associativity/).

## Known failures, limitations, war stories

- DOCUMENTED: a single edge can turn into two, one, or zero references as edits proceed. Persisting only one successor silently loses valid design intent. [Split/delete example](https://onshape-public.github.io/docs/api-adv/associativity/).
- DOCUMENTED: previously valid IDs need not remain usable after changes; FeatureScript likewise warns that transient query results can become invalid after context changes. REST IDs and FeatureScript queries are distinct interfaces with analogous lifetime constraints, not interchangeable serializations. [Associativity](https://onshape-public.github.io/docs/api-adv/associativity/), [evaluateQuery](https://cad.onshape.com/FsDoc/library.html#evaluateQuery-Context-Query).
- No public implementation issue tracker or measured failure-rate study is supplied by this page. No forum anecdotes were needed, and none are treated as guarantees. [Source scope](https://onshape-public.github.io/docs/api-adv/associativity/).

## Relevance for wonky

INFERRED, high-priority integration: augment the local matcher and review UI with **known split/known merge relations**, not just unique match versus ambiguity. Returning a set does not authorize choosing one face for a later fillet: query policy must explicitly request all descendants, retain a geometric role, or fail for insufficient specificity. The diff UI can show one-to-many highlighting and attach the old reference to its complete successor set. [Basis](https://onshape-public.github.io/docs/api-adv/associativity/).

INFERRED validation-only use: source/target Onshape microversion snapshots plus translation responses can be independent reference fixtures for imported models. Freeze both revisions and raw API responses; compare relation cardinality and behavior, not raw ID equality with wonky. This does not supply production geometry and does not make commercial-cloud access part of the local kernel. No signed-in Onshape API was accessed here. [API contract](https://onshape-public.github.io/docs/api-adv/associativity/).

INFERRED architecture boundary: source revision IDs belong in imported-reference namespaces; generated wonky topology needs its own lineage relation. API associativity cannot rescue an incorrect Boolean or establish FDM watertightness. Carry status/evidence through LLM-facing diagnostics so a failed translation never looks like an empty but valid modeling selection. [Documented failure status](https://onshape-public.github.io/docs/api-adv/associativity/).

## Pointers worth porting or studying

- [Associativity Example](https://onshape-public.github.io/docs/api-adv/associativity/#associativity-example): split → delete → rollback, the complete three-stage cardinality fixture.
- Request fields `sourceDocumentMicroversion`, `ids`; response field `targetDocumentMicroversion`; per-entity `source`, `status`, `target`. These are the load-bearing parts to reproduce in wonky's independently designed interface. [Schema examples](https://onshape-public.github.io/docs/api-adv/associativity/).
- Local research artifacts: `<repo>/tmp/research/onshape-api-associativity-transient-ids-idtranslations/associativity.html` and `associativity.txt`. Local intended integration point: `<repo>/src/identity.mjs`; not modified.

## Verdict: adopt

Adopt the **version-scoped translation/result contract**, especially the distinction between a known split and an ambiguous guess. No proprietary implementation needs porting; no precision or FFI dependency is introduced. What remains open is wonky's history producer and relation composition, not the public-facing shape of the translation result. Do not infer hidden naming guarantees or a universal deletion meaning from this short guide. [Primary source](https://onshape-public.github.io/docs/api-adv/associativity/).

