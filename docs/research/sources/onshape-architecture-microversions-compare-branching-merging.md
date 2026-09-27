# Onshape architecture (microversions) + Compare + Branching/Merging help

- Kind: official product and API documentation. Canonical: https://onshape-public.github.io/docs/api-intro/architecture/. Additional primary sources: https://onshape-public.github.io/docs/api-adv/associativity/, https://cad.onshape.com/help/Content/compare.htm, https://cad.onshape.com/help/Content/versionmanager.htm, https://cad.onshape.com/help/Content/Document/merging.htm.
- Organization: Onshape / PTC; commercial product, 2015 onward. Inspected 2026-09-24; fetched help pages say Last Updated September 22, 2026 (not September 18 as the initial research brief suggested).
- License: public access is not an open-source implementation license. No permissive code license established for these product docs; independently implement concepts, do not copy proprietary implementation or redistribute help assets. There is no kernel repository to inventory for size, contributors or releases here.
- Access correction: supplied branching_and_merging.htm and its linked legacy Content/merging.htm return the help landing page. Current substantive page is Content/Document/merging.htm above.

## What it is

DOCUMENTED: document-wide revision history with mutable workspaces, immutable model-state microversions and named versions; plus human-oriented structural and graphical comparison and selective tab-level merging. The architecture itself gives the analogy document/repository, element/file, workspace/branch, version/tag, microversion/commit, explicitly warning that implementation is very different from Git. Source: https://onshape-public.github.io/docs/api-intro/architecture/.

## How it works

DOCUMENTED revision model: a document contains elements (Part Studio, Assembly, Blob, Application, Feature Studio). Each change to an element or set of elements creates a microversion. A workspace is the editable branch; a version names a snapshot of the entire document at a microversion. GET normally reads workspace/version/microversion; writes normally target a workspace and create a microversion. Important exception: metadata on a version can be updated without creating a microversion. A stable workspace ID therefore identifies a changing state, not an immutable cache key. Source: Architecture / Workspaces, Versions, and Microversions.

DOCUMENTED regeneration and presentation: each Part Studio has one feature list; changing it reevaluates parametric history. Features and sketch-like definition entities have persistent identifiers, but generated topology IDs are history-dependent indices and may change. Tessellation is generated on demand and may be cached, not stored as the authoritative model. Configurations must be specified explicitly in API applications; relying on the currently selected configuration is warned to be inconsistent. Linked documents refer to versions, preserved while referenced even if their containing document is deleted. Source: Architecture / Configurations, Onshape Data Model, Linked Documents.

DOCUMENTED critical correction to the research premise: Onshape DOES document entity-level topology lineage. Architecture explicitly lists creation, disappearance, ID change, split and merge; a (microversion, topology ID) can translate to a set of topology IDs in another state. Therefore the narrow visible Compare UI is NOT evidence that Onshape lacks topological correspondence internally or in its public API. Sources: Architecture / Model presentation data and https://onshape-public.github.io/docs/api-adv/associativity/.

DOCUMENTED concrete API: POST /api/partstudios/d/{docid}/w/{wid}/e/{eid}/idtranslations accepts sourceDocumentMicroversion and ids. Response includes targetDocumentMicroversion and records {source,status,target:[...]}. The official cube example shows SPLIT for a body and edge, OK for surviving faces/edges, and FAILED_TO_RESOLVE with [] after deletion. An OK record can change ID (JHD -> JID); it does NOT mean byte-identical ID, unchanged geometry or unchanged provenance. Rolling back can restore resolved faces. The example initially picks IDs from tessellation, but this is an example workflow, not a documented mathematical requirement for translation. Source: Associativity.

DOCUMENTED Compare behavior: Part Studio and Feature Studio support; choose any two history entries, versions or workspaces. Base is the first selection (blue); Target is the second (red). The slider emphasizes one over the other. Feature lists mark identical, not identical, present only in base/target, and moved up/down in order. Display all features or only differences, select Part Studios and configurations, and inspect parameter differences. Feature Studio comparison is line-by-line source diff with additions green and deletions red. The yellow outlines for differing Tolerance options concern feature parameter/tolerance-option differences, NOT a claimed geometric-error certification threshold. Source: https://cad.onshape.com/help/Content/compare.htm.

DOCUMENTED merge semantics: Source is a workspace or version, Target the currently active workspace. Compute delta from merge base to Source and apply it to Target. Base is the divergence state OR, when applicable, the last non-reverted merge from the same Source branch into that Target. Strategies are Keep Target, Merge changes, Replace with Source; per-tab overrides supersede the overall strategy. Users cannot cherry-pick individual changes inside a tab. Creating/deleting tabs and unsupported tab types only permit Keep/Replace. Replace discards target changes, not just conflicting parameters. Source: https://cad.onshape.com/help/Content/Document/merging.htm.

DOCUMENTED inconsistency in that page: the embedded video transcript says Merge combines changes only for Part Studios/assemblies; the later Resolving merge issues section says all tab types except Drawings and PCB Studios. Both explicitly exclude drawings. Do not use this document alone to promise Feature Studio automatic text merge or exact support for every tab kind; verify current UI/API if implementing a compatibility claim. The page does not specify conflict arbitration for two edits to the same parameter, low-level matching algorithms, database schema or content-addressing. Same source.

## Robustness and guarantees

DOCUMENTED: immutable model snapshots give history-contexted reads, not permanent stability of raw topology IDs. Architecture warns that even at a fixed version/microversion an internal Onshape system change can alter Part IDs; faces/edges are used similarly. Applications must use the associativity mechanisms, not store raw IDs forever. The metadata exception also prevents calling every byte associated with a version immutable. Source: Architecture, ID table and revision discussion.

DOCUMENTED: merged changes can be incompatible and cause feature errors. Outdated FeatureScript versions can block merging and require upgrades; protected branches require synchronization. Reverting a merge is not ordinary Undo, and later edits by any user are lost if one reverts after those edits. Source: Merging / Resolving merge issues / Notes. No proof of correct intent recovery or watertight geometric differences is supplied.

INFERRED: a blue/red overlay can expose shape changes but does not establish volume equality, boundary Hausdorff bounds, topological correspondence correctness or manufacturing equivalence. A successful text merge need not produce a valid model. Source basis: Compare's described visual mechanism and the explicit merge-error warning.

## Parallelism and performance

DOCUMENTED: tessellation is on-demand/cacheable and data is in replicated cloud databases. These pages provide no numeric benchmark, scaling measurement, storage amplification figure or rebuilding complexity. They do not establish whether operations are recomputed incrementally, nor any specific persistent tree implementation. Source: Architecture.

INFERRED: immutable revision snapshots and independent diff classification are a strong local fit: compare sorted feature/entity tables using fork-join; cache by explicit revision/configuration; render each state independently. Lineage traversal and merge conflicts are irregular graph tasks, better CPU-side Bend or bounded frontier passes than naive uniform GPU recursion. The product's cloud distribution architecture itself is not needed.

## Known failures, limitations, war stories

DOCUMENTED primary-help examples: independent dimensions added to the same drawing on two branches cannot both be retained by Keep/Replace; one branch's addition is discarded. Merge cannot be ordinary-Undo'd; revert can lose post-merge changes. FeatureScript version mismatches and ongoing updates can block operation. The document-in-use warning appears in the update/merge troubleshooting sequence; do not generalize it into a claim that all simultaneous collaboration is disallowed. Source: Merging page above.

DOCUMENTED associativity limitation: a formerly selected face can resolve to zero or multiple new faces. The API example demonstrates this rather than promising a unique winner. Raw IDs can change even for immutably selected model states after internal system changes. Sources: Associativity and Architecture. No private issue tracker was accessed; no forum anecdote is promoted to fact.

## Relevance for wonky

INFERRED design, based on these documented mechanisms:

1. Distinguish immutable revision ID, mutable branch head, named version, feature definition ID, topology ID within revision and user occurrence path. Do not overload one SHA as all six.
2. Build a deterministic execution manifest including source bytes, dependency/source-module hashes, feature interpreter/kernel version, configuration, units, tolerance policy and imported geometry hashes. A Git commit plus code alone cannot guarantee identical geometry after compiler/kernel changes. An unsaved local edit also deserves a microrevision without creating a Git commit.
3. Store reference := (revision, entityId, query/lineage policy). Translate to a set with explicit states matched/split/merged/missing/new/ambiguous. Retain target revision and evidence. Keep representation equivalence, geometric change and reference resolution as separate diff dimensions. This adapts an EXISTING Onshape capability, not an invention absent there.
4. Show source/feature diff, per-entity lineage and certified geometry differences together; provide base/target overlay and a slider as a usability pattern. Label visual overlay as visual, not a tolerance certificate.
5. Text-merge FeatureScript in Git, then rebuild in Bend and gate acceptance on explicit regeneration, topology, tolerance and FDM checks. Use three-way feature records for stable feature IDs, but report ambiguity rather than silently applying source-wins conflict rules not established by the docs.
6. U32 identifiers, parent links, immutable tables and U32-word digests need no f64. F32x2/multi-limb exact geometry is needed only for geometric comparison/certification. Diffing can be fork-join; flatten lineage into sorted incidence ranges rather than shared mutable maps.

## Pointers worth porting or studying

- Architecture: Workspaces, Versions, and Microversions; Configurations; Model presentation data.
- Associativity: the full split/delete/rollback cube example and idtranslations request/response.
- Compare: feature difference categories, configuration selection and separate Feature Studio line diff.
- Merging: merge-base selection after prior merges; Keep/Merge/Replace distinction; loss example for drawings; revert semantics. All canonical URLs appear above.

## Verdict: adapt

Adopt revision-scoped references and explicit translation results, and adapt the comparison/merge ergonomics to a local Bend kernel. Do not copy cloud infrastructure, claim raw entity IDs are persistent, infer kernel internals from UI colors, or claim entity-level lineage is a wonky-only advantage. Open questions are undocumented merge conflict arbitration and the inconsistent tab-support description. No live Onshape document was modified.

Sources:
- [Architecture](https://onshape-public.github.io/docs/api-intro/architecture/)
- [Associativity API](https://onshape-public.github.io/docs/api-adv/associativity/)
- [Compare](https://cad.onshape.com/help/Content/compare.htm)
- [Current merging help](https://cad.onshape.com/help/Content/Document/merging.htm)

