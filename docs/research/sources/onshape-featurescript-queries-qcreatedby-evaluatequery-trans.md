# Onshape FeatureScript: queries, qCreatedBy, evaluateQuery, transient queries

- Kind: official language/modeling/API documentation. Canonical [standard library](https://cad.onshape.com/FsDoc/library.html); [modeling](https://cad.onshape.com/FsDoc/modeling.html); [number semantics](https://cad.onshape.com/FsDoc/variables.html); [API FeatureScript guide](https://onshape-public.github.io/docs/api-adv/fs/).
- Organization: Onshape / PTC; FeatureScript-era documentation, inspected 2026-09-24. These live pages are not pinned to a released standard-library revision.
- License: no explicit reuse license for the documentation was established. Important correction to the supplied source description: Onshape itself calls its **standard library open-source**, with source in the public `std` document; the inspected welcome page does not specify a license identifier. Do not equate the library, documentation, proprietary geometric kernel, and API service licensing. No library source was copied or ported here. [Official wording](https://cad.onshape.com/FsDoc/), [std source link](https://cad.onshape.com/documents/12312312345abcabcabcdeff).
- Status: live documentation for a commercial modeling system, not a Git repository with available star/contributor statistics. DOCUMENTED: a context tracks its standard-library version; held-back features emulate their older version. Thus even correct current-page semantics are not a substitute for version-qualified compatibility tests. [Context](https://cad.onshape.com/FsDoc/library.html#Context).

## What it is

DOCUMENTED: a `Context` contains bodies, topology, variables, and feature error state. A query is a map describing criteria, not normally an eagerly captured entity list. The modeling guide calls it an **order form for geometry**. State-based queries select current model properties; historical queries select through creation/dependency history. State-based queries cannot reference deleted entities. Evaluations and operations accept unevaluated queries and resolve them against their context. [Modeling](https://cad.onshape.com/FsDoc/modeling.html), [query module](https://cad.onshape.com/FsDoc/library.html#module-query).

DOCUMENTED: a body is connected and can be solid, sheet, wire, or point. The guide's analytic cylinder has three faces, two edges, **zero vertices**. A topology/query implementation must not assume every edge has two distinct endpoints or every CAD cylinder contains a seam edge. Geometric values such as Plane and Line are distinct from topological face/edge entities in the context. [Bodies and geometry](https://cad.onshape.com/FsDoc/modeling.html).

## How it works

### Creation is a relation, not one scalar creator

DOCUMENTED `qCreatedBy(featureId, entityType)` semantics:

1. It returns entities added to the context by the feature/operation. Mere modification without creation does **not** qualify for the modifying operation.
2. A split's children count as created by **both the original creator and the split operation**.
3. A merged entity counts as created by **every input entity's creator and the merging operation**.
4. With a sketch ID, it selects sketch regions, points, and wire bodies; the optional entity filter still matters. [Exact contract](https://cad.onshape.com/FsDoc/library.html#qCreatedBy-Id-EntityType).

INFERRED representation for wonky: maintain an ordered event stream plus a many-to-many `CreatedBy(entity,operationPath)` relation (or equivalent DAG reachability). A single `operationId` per face is insufficient, even if it names the earliest creator. For split `s → {t1,t2}`, `C(ti)=C(s)∪{splitOp}`. For merge `{s1,...,sn} → t`, `C(t)=⋃C(si)∪{mergeOp}`. For a modification that preserves the entity without creating one, retain `C` and update a separate last-modifier relation. These equations implement the [documented split/merge/modify distinction](https://cad.onshape.com/FsDoc/library.html#qCreatedBy-Id-EntityType); they are not claims about Onshape's storage.

INFERRED consequence: OCCT `Modified` versus `Generated` is **not itself** the FeatureScript creator classification. A split face can appear in `Modified` while its children acquire a new split creator. Conversely, not every modification should add its operation to `qCreatedBy`. The Boolean history producer must describe unchanged, identity-preserving modification, split, merge, new intersection, and deletion distinctly enough to implement this rule. [FeatureScript contract](https://cad.onshape.com/FsDoc/library.html#qCreatedBy-Id-EntityType), [OCCT history contract](https://dev.opencascade.org/doc/overview/html/specification__boolean_operations.html).

### Roles, operation IDs, and dependencies

DOCUMENTED: `qCapEntity(id,capType,entityType)` selects start/end cap faces, edges, and vertices; `qNonCapEntity` selects non-cap entities. Extrude, revolve, sweep, loft, and thicken generate cap roles. `qDependency` asks for the true input dependency, e.g. an extruded body's profile face or sketch edges. These are different queries, not synonyms for the most recent operation or face normal. [Cap](https://cad.onshape.com/FsDoc/library.html#qCapEntity-Id-CapType-EntityType), [non-cap](https://cad.onshape.com/FsDoc/library.html#qNonCapEntity-Id-EntityType), [dependency](https://cad.onshape.com/FsDoc/library.html#qDependency-Query).

DOCUMENTED: `Id` is a hierarchy of string components, constructed with `newId()` and `+`. Each feature/subfeature/operation has a unique ID, and each parent identifies a **contiguous history region**. The documented loop `extrude/i; chamfer/i; extrude/i+1` fails with parents `extrude` and `chamfer`; use per-iteration parents or unnested unique names instead. Only specified identifier characters are legal. `ANY_ID` and `unstableIdComponent` introduce wildcard treatment; `setExternalDisambiguation` supplies external dependency context for unstable IDs, including operations that do not otherwise track dependency. These are semantic constraints, not just pretty strings. [Id](https://cad.onshape.com/FsDoc/library.html#Id), [unstable component](https://cad.onshape.com/FsDoc/library.html#unstableIdComponent), [external disambiguation](https://cad.onshape.com/FsDoc/library.html#setExternalDisambiguation-Context-Id-Query).

INFERRED: encode operation paths as interned U32 component sequences, preserve prefix relationships and contiguous-history validation, and store role facts **relative to their originating operation**, not as a single overwritten role. Exact role inheritance through every Boolean case is not completely specified by these short role-query paragraphs; test it explicitly rather than inventing a universal rule. [Role and ID contracts](https://cad.onshape.com/FsDoc/library.html#qCapEntity-Id-CapType-EntityType).

### Evaluation, ordering, transient lifetime

DOCUMENTED: `evaluateQuery(context,q)` returns one transient query per matching entity **at the time of evaluation**. Subsequent context modification may invalidate those queries. `qNthElement` describes resolution order as deterministic but arbitrary, while `evaluateQuery` warns it is generally not predictable. This does not promise stable ordinals across edits. [evaluateQuery](https://cad.onshape.com/FsDoc/library.html#evaluateQuery-Context-Query), [qNthElement](https://cad.onshape.com/FsDoc/library.html#qNthElement-Query-number).

DOCUMENTED ordering exceptions:

- `qUnion([q1,q2,...])` preserves subquery precedence: matches of earlier subqueries appear earlier.
- `qIntersection` preserves the first subquery's order.
- `qSubtraction(q1,q2)` preserves `q1`'s order.
- `areQueriesEquivalent` deliberately ignores order.
- Unioning bodies preserves the identity/name/color of the earliest resolved tool body; attribute merge conflicts also use the primary entity. Therefore replacing every query with an unordered set can change visible semantics even if membership is correct. [qUnion](https://cad.onshape.com/FsDoc/library.html#qUnion-array), [qIntersection](https://cad.onshape.com/FsDoc/library.html#qIntersection-array), [qSubtraction](https://cad.onshape.com/FsDoc/library.html#qSubtraction-Query-Query), [equivalence](https://cad.onshape.com/FsDoc/library.html#areQueriesEquivalent-Context-Query-Query), [opBoolean](https://cad.onshape.com/FsDoc/library.html#opBoolean-Context-Id-map), [attributes](https://cad.onshape.com/FsDoc/library.html#module-attributes).

DOCUMENTED: the public API guide uses `transientQueriesToStrings(evaluateQuery(context,qCreatedBy(makeId("Top"),EntityType.FACE)))` to retrieve a sketch plane ID in an evaluated lambda. This confirms the usage, **not** a persistent serialization format, cross-revision validity, or a general documented inverse. That helper was not found in the inspected library reference itself. [Sketch plane IDs](https://onshape-public.github.io/docs/api-adv/fs/), [cross-microversion ID translation](https://onshape-public.github.io/docs/api-adv/associativity/).

### Tracking is policy-bearing

DOCUMENTED: `startTracking(context,{subquery,...})` follows derived entities from the tracking point to later evaluation; optional `secondarySubquery` requires derivation from both objects, `trackPartialDependency` admits non-exclusive derivation, and `lastOperationId` changes the starting operation. `startTrackingIdentity` follows inherited identity. `makeRobustQuery` targets identity-preserving changes. `makeRobustQueriesBatched(context,q)` produces per-entity strict-identity queries; its boolean overload explicitly permits following split/merge. A single generic 'follow descendants' operation is therefore not sufficient. [Tracking](https://cad.onshape.com/FsDoc/library.html#startTracking-Context-map), [identity tracking](https://cad.onshape.com/FsDoc/library.html#startTrackingIdentity-Context-Query), [robust batched overload](https://cad.onshape.com/FsDoc/library.html#makeRobustQueriesBatched-Context-Query-boolean).

DOCUMENTED: named attributes copy to all split pieces and patterned copies. Merging keeps attributes from both inputs, but equal attribute names take the primary entity's value. This is not set-union of arbitrary payloads and not a global last-write-wins rule. [Attributes](https://cad.onshape.com/FsDoc/library.html#module-attributes).

## Robustness and guarantees

DOCUMENTED: queries are intended to survive upstream model edits, but transient queries can expire, nonempty selection checks can fail after edits, and most query ordering is arbitrary. `verifyNonemptyQuery` throws a regeneration error and marks the bad parameter. There is no theorem that arbitrary design intent survives every topology change. [Modeling](https://cad.onshape.com/FsDoc/modeling.html), [verifyNonemptyQuery](https://cad.onshape.com/FsDoc/library.html#verifyNonemptyQuery-Context-map-string-string).

DOCUMENTED numeric assumptions: FeatureScript `number` is IEEE **64-bit double precision**; integers are not a separate language type; NaN-producing operations throw rather than returning NaN. The modeling guide gives ordinary geometric comparison tolerances of `1e-8 meter` and `1e-11 radian`, with explicit warning that no tolerance suits all applications. Scalar `tolerantEquals` uses a documented computational tolerance `1e-13`, or an explicit caller-supplied tolerance. [Numbers](https://cad.onshape.com/FsDoc/variables.html), [geometry tolerances](https://cad.onshape.com/FsDoc/modeling.html), [scalar tolerance](https://cad.onshape.com/FsDoc/library.html#tolerantEquals-number-number).

INFERRED Bend consequence: combinatorial historical queries are precision-free U32 relations. Spatial selectors (`qContainsPoint`, nearest/farthest filters, parallelism tests) are not: F32 alone cannot generally reproduce these tolerances, and F32x2's roughly 48-bit mantissa and F32 exponent range do **not** emulate all double-precision language values. Preserve JS frontend number semantics where applicable, validate the boundary into Bend, use explicit F32x2 error/tolerance policies for geometric queries, and fail on unsupported scale/precision rather than silently relaxing compatibility. Exact U32 predicates help predicates, not arbitrary double transcendental behavior. [Required numeric contract](https://cad.onshape.com/FsDoc/variables.html), [query examples](https://cad.onshape.com/FsDoc/library.html#qContainsPoint-Query-Vector).

## Parallelism and performance

DOCUMENTED: `isQueryEmpty` and `evaluateQueryCount` are stated to be faster than materializing full query arrays in the corresponding cases, but no measured timings, complexity, or backend implementation are given. No benchmark was run here. [isQueryEmpty](https://cad.onshape.com/FsDoc/library.html#isQueryEmpty-Context-Query), [evaluateQueryCount](https://cad.onshape.com/FsDoc/library.html#evaluateQueryCount-Context-Query).

INFERRED implementation: preserve the immutable query AST until evaluation, then use fork-join filtering, stable deduplication, ordered joins, and reductions over topology/history arrays. Model Context updates as successive immutable states even though the frontend exposes imperative operations. Fixed-size U32 relation batches are suitable GPU work; recursive historical walks and variable-length ID paths need flattening/bucketing. Cache evaluated queries only with a context revision key; do not cache a lazy query's result indefinitely. These are proposed implementations of [the query contract](https://cad.onshape.com/FsDoc/library.html#module-query), not Onshape performance claims.

## Known failures, limitations, war stories

- DOCUMENTED reproducible language failure: non-contiguous parent IDs in an interleaved loop. [Example](https://cad.onshape.com/FsDoc/library.html#Id).
- DOCUMENTED lifetime failure: modifying context after evaluating a query can leave previously obtained transient queries empty. [evaluateQuery](https://cad.onshape.com/FsDoc/library.html#evaluateQuery-Context-Query).
- DOCUMENTED intent limitation: strict identity tracking and split/merge-following tracking are separate policies. Treating all successors as a unique old face changes the selected meaning. [Robust queries](https://cad.onshape.com/FsDoc/library.html#makeRobustQueriesBatched-Context-Query-boolean).
- No public kernel implementation issue tracker, complete query algorithm, error bound, or benchmark accompanies these pages. No anecdotal forum claim is used as a guarantee. [Source scope](https://cad.onshape.com/FsDoc/).

## Relevance for wonky

INFERRED priority order: (1) make Boolean/recovery output event-classified many-to-many history; (2) evaluate multi-creator queries and role-relative queries over it; (3) implement explicit tracking policies and invalid transient detection; (4) preserve ordered query semantics and attribute primary ownership; (5) add explainable empty/ambiguous/split diagnostics for code and LLM users. Identity must survive the **mesh-topology → analytic B-rep recovery** boundary; a mesh triangle tag alone is not the full creator/dependency relation. [Contract motivating this design](https://cad.onshape.com/FsDoc/library.html#qCreatedBy-Id-EntityType).

INFERRED minimal future regression suite, not executed: split face selectable through both original and split creator; merged face selectable through every input creator; identity-preserving modification not selected by its modifier; cap query after downstream Boolean; transient query used after deletion; overlapping ordered union deduplicated without reordering; conflicting attribute names on reversed Boolean tool order; strict robust query versus split-following overload; invalid non-contiguous operation IDs. The cap-after-Boolean case needs an external oracle because these docs do not completely specify its inheritance. [Creation](https://cad.onshape.com/FsDoc/library.html#qCreatedBy-Id-EntityType), [tracking](https://cad.onshape.com/FsDoc/library.html#makeRobustQueriesBatched-Context-Query-boolean), [attributes](https://cad.onshape.com/FsDoc/library.html#module-attributes).

## Pointers worth porting or studying

- Read `qCreatedBy`, `qCapEntity`, `qNonCapEntity`, `qUnion`, `evaluateQuery`, `startTracking`, `makeRobustQueriesBatched`, `setExternalDisambiguation`, and `Id` together; no one function defines the whole identity contract. [Library](https://cad.onshape.com/FsDoc/library.html).
- Read the [modeling guide](https://cad.onshape.com/FsDoc/modeling.html) for entity/geometry separation and tolerances; the [API FS guide](https://onshape-public.github.io/docs/api-adv/fs/) for actual string-ID serialization usage.
- Local complete snapshots: `<repo>/tmp/research/onshape-featurescript-queries-qcreatedby-evaluatequery-trans/` (`library.html/.txt`, `modeling.html/.txt`, `variables.html/.txt`, `api-fs.html/.txt`, `index.html`).

## Verdict: adopt

Adopt these **observable language contracts**, because unmodified FeatureScript is wonky's frontend requirement. The most consequential correction is multi-creator provenance plus policy-specific tracking; a lone operationId/role on the latest face is not enough. Independently implement relations and lazy evaluation in Bend/JS without embedding Onshape. Defer unsupported spatial/numeric/query cases explicitly, and verify standard-library licensing separately before any code port. [Primary contracts](https://cad.onshape.com/FsDoc/library.html), [numeric boundary](https://cad.onshape.com/FsDoc/variables.html).

