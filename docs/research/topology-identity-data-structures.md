# B-rep data structures, persistent naming, history and model diffing

Chapter of the wonky research knowledge base, 2026-09-24. English.

**Status and method.**

- **Deep reads.** 18 source notes cover this topic. They are under
  [sources/](sources/) and linked in section 2. This chapter re-read all 18
  in full.
- **Publish-first step.** None of the 18 had a Markdown file yet. All 18
  were written verbatim from the `markdown` field of
  `tmp/research/notes/<slug>.json`. No Markdown syntax needed fixing.
- **Two notes are "unreachable".** Kripac 1997 and Marcheix & Pierra 2002:
  metadata and an abstract only, no full text.
- **Related deep reads from other chapters** that this chapter uses: the
  older FreeCAD element-map note, Fornjot's final experiment and shutdown,
  BREP.io, Manifold, and the Parasolid overview and XT reference. They are
  listed in 7.2.
- **Workflow input.** The scout's landscape and catalog. The 20 catalog-only
  sources are in 7.1.
- **Checks made for this chapter** (working tree, 2026-09-24, all by reading
  code and docs):
  - `kernel/identity.bend`, `src/identity.mjs` and
    [../topology-identity.md](../topology-identity.md) in full;
  - [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §§1-2, §8 steps 7
    and 9, §9;
  - `src/hybrid.mjs` (`toBodies`, `attachResultMesh`, `sourceRef`),
    `src/library.mjs` (`hybridRemovedMaterial`, Boolean lineage),
    `src/queries.mjs` (`qCreatedBy`, `owned`, `makeRobustQuery`);
  - `src/comparison.mjs`, `kernel/comparison.bend`, the header of
    `src/viewer/diff.mjs`, `kernel/topology.bend`,
    `src/construction-history.mjs`.
- Nothing was built or run: a CPU benchmark is running on this machine.

**Labels.**

- **DOCUMENTED**: read in a primary source, either by the note author or for
  this chapter. The link leads to the note, and the note carries the primary
  URL.
- **INFERRED**: reasoning from evidence, including derivations the note
  authors added but did not prove.
- **HEARSAY**: secondhand, or a claim from the scout or the catalog that no
  deep read confirmed.

**Corrections to the scout's framing.**

1. **The bake-off is decided.** corefine (a Bend port of Manifold's Boolean
   with per-triangle face tags) decides topology. recover rebuilds the exact
   B-rep from the tags or refuses by name. DOCUMENTED:
   [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §1 and
   [mesh-booleans.md](mesh-booleans.md). So the proposals below target
   corefine → recover, not four prototypes.
2. **The hybrid already emits face provenance.** DOCUMENTED, `src/hybrid.mjs`
   `attachResultMesh`:
   - each result face gets `provenance.faces[i].sources`: the sorted operand
     faces (leaf, face index, and that face's `identity`) whose triangles
     form it;
   - it *declines* by name (sources stay `null`) when recover absorbed
     slivers, when coplanar carriers were unified with a tolerance of
     1e-7 mm or more, when the mesh is not a closed 2-manifold, when mesh
     components and recovered shells do not match one-to-one, or when faces
     on one carrier cannot be told apart by their neighbours' carrier
     classes;
   - edges carry only the seam flag and boundary certificates, no source
     pair.

   So "Modified" evidence for faces exists today, as a JS-side record. It
   does not reach `kernel/identity.bend`, which still stamps every Boolean
   output entity revision-local.
3. **Onshape exposes entity lineage.** Its REST `idtranslations` endpoint
   returns OK, SPLIT or FAILED_TO_RESOLVE per ID, and OK can return a
   *different* ID. The scout said this already; the architecture note
   confirms it
   ([note](sources/onshape-architecture-microversions-compare-branching-merging.md)).
   The visual Compare UI is not evidence that Onshape lacks correspondence.
4. **BREP.io "caps repaired by neighbour voting"** is HEARSAY at that level
   of detail. The BREP.io note documents probe-vote nudges of coplanar tool
   faces and cleanup of tiny face islands, not a neighbour vote for cap
   names ([note](sources/brep-io.md)).
5. **"Ondsel reports negligible runtime cost"** is catalog-only HEARSAY. The
   only measurement in the deep reads is realthunder's informal test: one
   148-object model recomputed in 40 s without and 52 s with the element
   map, about 30 % more, with no hardware or repetitions given
   ([note](sources/realthunder-topological-naming-algorithm-asm3-wiki.md)).
6. **FreeCAD's failed monolithic PR #4752** was not verified in any deep
   read. HEARSAY.
7. **Parasolid's attribute action table** (propagate, keep_if_equal,
   combine, delete, transform per event) was not read in any note. The
   Parasolid overview note has one line: "attribute classes define behaviour
   on split, merge and transfer"
   ([note](sources/overview-of-parasolid-v35-july-2022.md)). The per-event
   table is HEARSAY here.

---

## 1. Landscape

### 1.1 Two layers: containers and identity

The field has two layers that the literature treats separately.

**Layer A: B-rep containers.** How faces, edges, vertices and their uses
are stored.

- Lineages: winged edge (Baumgart 1975), edge-based and radial-edge
  structures (Weiler 1985), quad-edge (Guibas-Stolfi 1985), Euler operators
  (Mäntylä's GWB, 1982/1988), partial entities (Lee & Lee 2001), darts and
  generalized maps (Lienhardt; CGAL). All catalog only (7.1).
- Deep-read production containers:
  - **OCCT TopoDS**: an entity definition (`TShape`) plus a `Location` plus
    an `Orientation` (DOCUMENTED,
    [note](sources/occt-modeling-data-guide-topods-tshape-location-orientation.md)).
    Details in 3.9.
  - **Parasolid fins** (half-edges): every edge of a solid has exactly two
    fins of opposite sense, fins around an edge are ordered clockwise
    looking along it, and dummy fins guarantee at least two per edge
    (DOCUMENTED,
    [XT note](sources/parasolid-xt-format-reference-v35-intersection-curve-chart-t.md)).
  - **Fornjot's final data model**: append-only typed stores with integer
    handles, six stores (vertices, edges, half-edges, faces, half-faces,
    solids), and the invariant that coincident half-edges share one `Edge`
    record (DOCUMENTED,
    [note](sources/fornjot-final-experiment-experiments-2025-12-03-plus-experim.md)).
- Container design is mature. The only live question for wonky is
  **expressibility in Bend**: pointer and handle graphs with mutation
  (OCCT, truck) do not fit; index arrays do (INFERRED).
- **wonky already chose index arrays.** `kernel/topology.bend` stores a solid
  as lists of U32-indexed records. A face loop is a list of coedges
  `Use{edge, forward}` (DOCUMENTED, code). That is the one-bit orientation
  model that TopoDS calls faithful only for a restricted manifold boundary
  model (3.9). For closed 2-manifold FDM solids that restriction is fine.

**Layer B: identity on top of the container.** How an entity is referenced
across operations, regenerations, edits and imports. This is where the open
problems are.

### 1.2 Six identity families

| family | what the name is | how a split is handled | deep reads |
|---|---|---|---|
| (1) generative, construction-role names | the creating feature plus a role (`f(e_i)`, `cap/start`), plus context when roles collide | ordinals or context certificates; Capoyleas applies a blend to *all* equal names | [Capoyleas 1996](sources/capoyleas-chen-hoffmann-1996-generic-naming-in-generative-co.md), [Kripac 1997](sources/kripac-1997-a-mechanism-for-persistently-naming-topological-.md) (unreachable), [Farjana & Han 2018](sources/farjana-han-2018-mechanisms-of-persistent-identification-of-.md) |
| (2) feature-domain references that never split | `feature.featureFace`; the B-rep holds zero, one or many realizations | a set is normal; the edge name adds a half-space discriminator | [Bidarra 2005](sources/bidarra-nyirenda-bronsvoort-2005-a-feature-based-solution-to.md); Zoo KCL tags (catalog) |
| (3) geometry-semantic support names | unbounded support surfaces, their intersection curves, trims | branch evidence from derivatives; nearest match per row | [Wang & Nnaji 2005](sources/wang-nnaji-2005-geometry-based-semantic-id-for-persistent-an.md); OCAF INTERSECTION naming; KCL `getCommonEdge` (catalog) |
| (4) names derived from kernel history | a string built from Modified/Generated relations and operation codes | successor ordinal in kernel output order | [OCCT history](sources/occt-boolean-operations-specification-history-modified-gener.md), [realthunder](sources/realthunder-topological-naming-algorithm-asm3-wiki.md), [FreeCAD ElementMap](sources/freecad-elementmap-mappedname-toposhapeexpansion-freecad-1-0.md), [build123d](sources/build123d-topology-selection-select-all-last-new-topo-path.md) |
| (5) transient IDs plus a translation service | an ID valid in one immutable model state | `SPLIT` returns the successor set | [Onshape associativity](sources/onshape-api-associativity-transient-ids-idtranslations.md), [FeatureScript queries](sources/onshape-featurescript-queries-qcreatedby-evaluatequery-trans.md), [Onshape architecture](sources/onshape-architecture-microversions-compare-branching-merging.md) |
| (6) history-free matching | none; correspondence is recomputed from geometry and adjacency | one-to-one only, or abstain | [Jones 2023](sources/jones-et-al-2023-b-rep-matching-for-collaborating-across-cad.md), [US11288411B2](sources/us11288411b2-b-rep-matching-for-maintaining-associativity-ac.md); MeshGit (catalog) |

**The convergence (INFERRED from the deep reads).** Every system that works
in production separates three things:

1. an **operation history relation** (what each operation did to each input
   entity);
2. a **persistent reference recipe** (what the user meant);
3. **resolution** of the recipe to a current *set*, with explicit
   cardinality.

The sources say this in their own words:

- OCAF: `TNaming_NamedShape` records evolution, `TNaming_Naming` stores a
  solvable recipe (DOCUMENTED,
  [note](sources/occt-ocaf-user-guide-tnaming-naming.md)).
- Onshape: a query is "an order form for geometry"; `evaluateQuery` returns
  transient queries; `idtranslations` maps IDs between microversions
  (DOCUMENTED, [FS note](sources/onshape-featurescript-queries-qcreatedby-evaluatequery-trans.md),
  [API note](sources/onshape-api-associativity-transient-ids-idtranslations.md)).
- Bidarra: naming (A) and locating and validating in the new B-rep (B′)
  are separate steps (DOCUMENTED,
  [note](sources/bidarra-nyirenda-bronsvoort-2005-a-feature-based-solution-to.md)).
- FreeCAD is the exception that proves the rule. It folds history into the
  name string, and its failures come from that folding: truncated parent
  lists, ordinals, random suffixes (3.2).

### 1.3 The history contract is the load-bearing piece

Families (2) to (5) all need the same input: what each operation did to
each entity. OCCT has the only open, precise specification of that
contract (DOCUMENTED,
[note](sources/occt-boolean-operations-specification-history-modified-gener.md)):

- **Modified(s)**: retained replacements or splits of `s`, normally of the
  same dimension. Empty does not mean deleted: `s` may be unchanged.
- **Generated(s)**: in a Boolean, only vertices from edge/edge, edge/face
  or face intersection events, and edges from face/face intersections.
  Coincident pieces are not "generated".
- **IsDeleted(s)**: `s` is absent from the result **and** has no Modified
  image. It can still have Generated children. A filleted-away edge is
  deleted and generates the fillet face.
- Per source, M and G are disjoint. Deleted and Modified exclude each
  other. Deleted and Generated do not.
- **Result closure**: no Modified or Generated member lies outside the
  final result. An empty result means everything is deleted.
- **Composition** of two steps: M then M is M; every other combination is
  G. Retained unchanged intermediates carry through. Boolean cleanup
  (`UnifySameDomain`) history is composed into the main history, so
  references reach the unified faces, not dead pre-refine fragments.

What production systems add on top (DOCUMENTED):

- **FeatureScript creator sets.** `qCreatedBy` counts a split's children
  as created by the original creator **and** the splitting operation; a
  merged entity by every input's creator **and** the merging operation. A
  mere modification adds nothing. OCCT's Modified is therefore not
  FeatureScript's creation semantics
  ([note](sources/onshape-featurescript-queries-qcreatedby-evaluatequery-trans.md)).
- **Tracking policies.** `startTracking`, `startTrackingIdentity`,
  `makeRobustQuery` and the split/merge-following overload of
  `makeRobustQueriesBatched` are different policies. There is no single
  "follow the descendants" (same note).
- **Attribute policy.** Named attributes copy to all split pieces; on a
  merge, equal names take the primary entity's value (same note).
  Parasolid has attribute classes with split/merge/transfer behaviour (one
  line in the overview; 1.6).
- **Operation-relative selectors.** build123d's `Select.LAST`/`NEW` are set
  equations over history (3.6,
  [note](sources/build123d-topology-selection-select-all-last-new-topo-path.md)).

### 1.4 Model diffing is three problems

Brière-Côté, Rivest and Maranzana separate shape retrieval, similarity
assessment and **model difference identification**. They also separate
difference calculation, structured representation and visualization
(DOCUMENTED,
[note](sources/bri-re-c-t-rivest-maranzana-2012-comparing-3d-cad-models-use.md)).

- Four matching families: static IDs, signatures, similarity, and
  syntax/adjacency-specific matching.
- Geometric comparison: global properties, directed and symmetric
  point-to-part distances, and regularized Boolean regions `A −* B`
  (removed), `B −* A` (added), `A ∩* B` (common).
- Topology changes can matter even when the volume difference is zero (a
  translated wingtip went from 10 to more than 100 faces).

What exists in 2026:

- **Onshape Compare** is a feature-list diff plus a blue/red visual overlay
  (DOCUMENTED,
  [note](sources/onshape-architecture-microversions-compare-branching-merging.md)).
  Onshape's entity lineage lives in the API (`idtranslations`), not in
  Compare.
- **Jones et al. 2023** match B-reps without shared history: a
  conservative geometric bootstrap, then a learned scorer that grows the
  matching through neighbourhoods (DOCUMENTED,
  [note](sources/jones-et-al-2023-b-rep-matching-for-collaborating-across-cad.md)).
  PTC holds a related active patent
  ([note](sources/us11288411b2-b-rep-matching-for-maintaining-associativity-ac.md)).
- Commercial model-difference tools of the 2012 survey are closed and dated.

### 1.5 Trends 2024-2026

- **Code-first CAD adopts kernel history.** build123d added a history
  module on 2026-09-10 (OCCT `BRepTools_History` behind `Select.LAST`/`NEW`;
  release v0.13.0 on 2026-09-21). Persistent semantic tags are an open
  proposal there (#1454). DOCUMENTED
  ([note](sources/build123d-topology-selection-select-all-last-new-topo-path.md)).
- **FreeCAD is replacing its naming algorithm.** A "V2" draft PR (#31040,
  opened 2026-06-29, open and unmerged) proposes multi-child links and
  removing the StringHasher. DOCUMENTED
  ([note](sources/freecad-elementmap-mappedname-toposhapeexpansion-freecad-1-0.md)).
- **Mesh-Boolean provenance as a first-class output.** Manifold carries
  `originalID`/`faceID` per triangle
  ([note](sources/manifold-elalish-manifold.md)). BREP.io builds a whole
  "B-rep" as a labelled Manifold mesh with a normative face-naming spec
  ([note](sources/brep-io.md)). Fornjot's last experiment layered topology
  over meshes
  ([note](sources/fornjot-final-experiment-experiments-2025-12-03-plus-experim.md)).
  wonky's hybrid is one of these (DOCUMENTED).
- **Learned and LLM-facing references.** Jones 2023 (learned matching);
  Pointer-CAD 2026 (LLM references by pointers into the current model;
  catalog only).
- **A pure B-rep kernel project gave up.** Fornjot shut down on 2026-06-19
  and estimated 2-3 more years to reach a useful foundation (DOCUMENTED,
  [note](sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md)).

### 1.6 What is conspicuously missing

- **(a) An open, formal split/merge specification.** OCCT specifies
  Modified/Generated/Deleted precisely, but has no "split" or "merge"
  relation kind: both are Modified with fan-out or fan-in. FeatureScript's
  creator rules need exactly that distinction (1.3). Parasolid's attribute
  classes are the only production policy we know of, and here we know one
  line of it.
- **(b) Naming for mesh-driven B-rep recovery.** No source describes how to
  turn mesh face tags (Modified evidence) plus exact surface-pair
  intersections (Generated evidence) into exact entity names. That is
  precisely wonky's hybrid. BREP.io stops at labelled meshes; Manifold stops
  at triangle IDs (INFERRED from the deep reads).
- **(c) An open entity-level B-rep diff.** Onshape has lineage (API) and a
  feature-list diff (UI). Jones is research code tied to Parasolid, plus a
  patent. No open tool reports "these faces changed, these split, these
  merged, this is the added and removed material" (INFERRED).
- **(d) Immutable B-rep containers with identity.** Fornjot's append-only
  stores (0BSD) are the closest, and Fornjot never had a Boolean.
- **(e) Branch identity for multi-component intersections.** Two surfaces
  can meet in several curves. Wang & Nnaji's derivative closeness is not
  unit- or scale-invariant; OCAF's packed positional index works only if
  child counts are unchanged; Bidarra's half-spaces come without a numeric
  contract (3.4).

### 1.7 Where wonky stands (working tree, 2026-09-24; DOCUMENTED)

| part | file | state |
|---|---|---|
| identity keys | `kernel/identity.bend` | framed Strings (`wk1/…`, every component length-prefixed) for origin and instance; semantic roles for box, frustum, extrusion caps and named line/arc sketch extrusions; anonymous profile sides are revision-local |
| imports | `kernel/identity.bend` `from_source`, `src/identity.mjs` `identifyImport` | source IDs kept inside a namespace (Onshape document, element, microversion); unknown namespace means revision-local |
| rigid transforms | `transformed` | origin kept, new occurrence, parent recorded |
| Boolean results | `boolean_result` | every output entity revision-local, `matching: 'unsupported-split-merge-correspondence'`; parents are the input body identities |
| hybrid face provenance | `src/hybrid.mjs` `attachResultMesh`, `sourceRef` | per result face: sorted operand faces (leaf, face, operand-face identity); `null` after sliver absorption, carrier unification at ≥ 1e-7 mm, a non-manifold mesh, a shell mismatch or neighbour-ambiguous faces |
| consumers of provenance | `src/library.mjs` `hybridRemovedMaterial`; `src/boolean.mjs` diff mode | a SUBTRACTION removed material iff a face comes from the tool on a carrier no target face shares; "coincident triangles may carry either tag", so shared carriers are not evidence |
| reference matching | `src/identity.mjs` `matchTopologyReference` | `matched` / `missing` / `ambiguous` / `unsupported`; no split, no merge, no translation across revisions; never a geometric fallback |
| FeatureScript creators | `src/library.mjs`, `src/queries.mjs` | `createdBy` is a **set per body record**: a Boolean result gets the union of creators plus the operation (subtract drops the tool's creators) |
| face/edge queries | `src/queries.mjs` `created` + `owned` | `qCreatedBy(id, FACE or EDGE)` returns **every** face or edge of the bodies whose set contains `id` (body-granular); `makeRobustQuery` over faces or edges refuses; `qCapEntity` has no runtime implementation (only the dataflow tracer lists it) |
| model comparison | `src/comparison.mjs`, `kernel/comparison.bend` | two coaxial cylinder primitives only: added, removed, common volumes, clearance, contact; everything else refused |
| viewer diff | `src/viewer/diff.mjs` | ghost overlay; exact bounds from edge bands for plane/cylinder/cone bodies; "bodies are matched by body id; no geometric correspondence is inferred" |
| operation evidence | `src/construction-history.mjs` | per operation: inputs (revision, identity, counts), outputs (revision, counts), transform chain |
| container | `kernel/topology.bend` | lists of U32-indexed records; coedge `Use{edge, forward}` |

**INFERRED consequence of the body-granular `qCreatedBy`.** After
`opBoolean` SUBTRACTION with id `c` on a target created by `a`, the target
record's set becomes `{a, c}`. So `qCreatedBy(c, EntityType.FACE)` returns
all faces of the result, including `a`'s untouched faces, and
`qCreatedBy(a, FACE)` includes the cut walls. Onshape's documented rule
selects entities *created* by the feature. Not run; derived from reading
`resolveTopology` and the Boolean commit code.

### 1.8 Licensing for porting (INFERRED, not legal advice)

- **Permissive:** build123d (Apache-2.0), Manifold (Apache-2.0), Fornjot
  (0BSD), BREP.io (MIT since 2026-09-12). Record, query and data-model
  ideas can be ported; keep a provenance comment.
- **Copyleft:** OCCT (LGPL-2.1 with the OCCT exception) and FreeCAD
  (LGPL-2.1-or-later). The exception is not permission to translate
  implementation bodies into a proprietary Bend port. Implement the
  documented contracts independently.
- **No license:** realthunder's asm3-wiki; implement concepts, do not copy
  prose or pseudocode.
- **Papers:** reimplement from the description and cite. The Jones code
  declares MIT in `setup.py` but has no root license and needs Parasolid.
- **Proprietary docs and IP:** Onshape (behaviour contracts only, and a
  possible external test oracle), Parasolid, and PTC's **US11288411B2**
  (Google shows it active, adjusted expiry 2040-07-18, with a disclaimer).
  Its claim 2 is much broader than the detailed claim 1. "Private use is
  exempt" is not a safe blanket rule; German PatG §11(1) exempts private
  non-commercial acts only (DOCUMENTED,
  [note](sources/us11288411b2-b-rep-matching-for-maintaining-associativity-ac.md)).

---

## 2. Comparison table

All 18 deep-read notes of this topic.

| name | kind | status (2026-09-24) | license | verdict | key idea | note |
|---|---|---|---|---|---|---|
| OCCT Boolean history (Modified / Generated / IsDeleted) | official spec + C++ | active; V8.0.1, 2026-07-30 | LGPL-2.1 + OCCT exception | **adopt** | a result-relative relation; deleted ≠ "no descendants"; composition table; result closure | [link](sources/occt-boolean-operations-specification-history-modified-gener.md) |
| Onshape API: associativity and idtranslations | API docs | live commercial | proprietary docs | **adopt** | IDs are microversion-scoped; translation returns OK / SPLIT / FAILED_TO_RESOLVE sets | [link](sources/onshape-api-associativity-transient-ids-idtranslations.md) |
| Onshape FeatureScript queries | language docs | live | proprietary docs; std library called open-source, license unverified | **adopt** | lazy queries; `qCreatedBy` is a creator *set* (split adds the splitter, merge unions creators); tracking policies differ | [link](sources/onshape-featurescript-queries-qcreatedby-evaluatequery-trans.md) |
| realthunder: Topological Naming Algorithm | design doc | historical (2022-09-03) | none | adapt | four passes: unchanged, Modified/Generated, lower from upper, upper only from all lowers | [link](sources/realthunder-topological-naming-algorithm-asm3-wiki.md) |
| FreeCAD ElementMap / MappedName / TopoShapeExpansion | production C++ | active; 1.1.3 (2026-07-25); V2 draft open | LGPL-2.1-or-later | adapt | alias maps and shared child maps; keeps first + at most 4 parents; random duplicate suffix in release builds | [link](sources/freecad-elementmap-mappedname-toposhapeexpansion-freecad-1-0.md) |
| OCCT OCAF user guide + TNaming_Naming | docs + C++ | active | LGPL-2.1 + OCCT exception | adapt | evolution records separate from solvable selection recipes; INTERSECTION naming is adjacency set intersection | [link](sources/occt-ocaf-user-guide-tnaming-naming.md) |
| build123d topology selection | docs + Python | very active; history module 2026-09-10 | Apache-2.0 | adapt | ALL / LAST / NEW as set equations over history; `topo_path` as selection context | [link](sources/build123d-topology-selection-select-all-last-new-topo-path.md) |
| OCCT Modeling Data (TopoDS) | docs + C++ | active | LGPL-2.1 + OCCT exception | adapt | definition + location + orientation; IsPartner / IsSame / IsEqual; four orientations | [link](sources/occt-modeling-data-guide-topods-tshape-location-orientation.md) |
| Onshape architecture, Compare, merging | product + API docs | live | proprietary docs | adapt | mutable workspaces over immutable microversions; entity lineage in the API; Compare is feature list + overlay | [link](sources/onshape-architecture-microversions-compare-branching-merging.md) |
| Bidarra, Nyirenda, Bronsvoort 2005 | paper (full) | historical | author PDF, no code | adapt | feature faces never split; each B-rep face has exactly one owner; no cross-owner coplanar merge; edge = owner pair + half-space | [link](sources/bidarra-nyirenda-bronsvoort-2005-a-feature-based-solution-to.md) |
| Wang & Nnaji 2005 | paper (full) | historical | Elsevier, all rights reserved | adapt | support / intersection / trim / occurrence are separate names; a surface pair is not a unique edge; second-derivative branch evidence | [link](sources/wang-nnaji-2005-geometry-based-semantic-id-for-persistent-an.md) |
| Capoyleas, Chen, Hoffmann 1996 | report 1994/95 (full) | historical | no code license | adapt | construction-role names + bounded BFS certificates (distance, label, count) + feature-flow orientation | [link](sources/capoyleas-chen-hoffmann-1996-generic-naming-in-generative-co.md) |
| Kripac 1997 | paper | historical | Elsevier / ACM | unreachable | assign IDs, recompute, map old to new (abstract only) | [link](sources/kripac-1997-a-mechanism-for-persistently-naming-topological-.md) |
| Marcheix & Pierra 2002 | survey | historical | ACM | unreachable | content not read | [link](sources/marcheix-pierra-2002-a-survey-of-the-persistent-naming-probl.md) |
| Farjana & Han 2018 | review (full) | historical | CC-BY-NC-ND-4.0 (article) | learn-from | naming vs disambiguation vs matching vs mapping; OSI/SN; repeats a formula Capoyleas rejected | [link](sources/farjana-han-2018-mechanisms-of-persistent-identification-of-.md) |
| Brière-Côté, Rivest, Maranzana 2012 | survey (full) | historical | © CAD Solutions | adapt | calculation vs representation vs visualization; A−B, B−A, A∩B; four matching families | [link](sources/bri-re-c-t-rivest-maranzana-2012-comparing-3d-cad-models-use.md) |
| Jones et al. 2023, B-rep Matching | paper + code | research; last commit 2023-08-01 | preprint CC BY-NC-SA; code declares MIT, no root license; needs Parasolid | learn-from | conservative coincidence bootstrap + learned neighbourhood scoring; one-to-one with abstention | [link](sources/jones-et-al-2023-b-rep-matching-for-collaborating-across-cad.md) |
| US11288411B2 (PTC) | patent | active per Google (disclaimed) | patent | learn-from | translation alignment, tolerance coincidence, 80 % overlap, cyclic adjacency signatures; claim 2 broad | [link](sources/us11288411b2-b-rep-matching-for-maintaining-associativity-ac.md) |

---

## 3. State of the art: techniques, their real guarantees, where they break

### 3.1 Operation history as a relation algebra (OCCT)

**What it is.** Two source→list maps (Modified, Generated) plus a removed
set, produced by each operation and composed along a chain. DOCUMENTED
([note](sources/occt-boolean-operations-specification-history-modified-gener.md)).

**Real guarantees (DOCUMENTED).**

- Result closure: every returned entity is in the final result.
- The producer first maps the actual final result, then keeps only images
  present in it. Intermediate intersection fragments never leak.
- Orientation is normalised: vertex and solid orientation follow the
  source; edges and faces may reverse (`IsSplitToReverse`). Entity identity
  and oriented use are kept apart.
- Supported kinds: vertices, edges, faces and solids. Wires, shells and
  compounds are not tracked.

**Where it breaks.**

- No order guarantee for successors. Any name built from "the k-th
  Modified image" inherits kernel output order (3.2).
- Disabled history (`SetToFillHistory(false)`) returns empty lists and a
  null `History()`. Unless the caller checks, that looks like "nothing
  changed" (DOCUMENTED).
- The inspected `Merge` checks `IsRemoved(intermediate)` before propagating
  its Generated children, although removed+generated is legal. A test like
  `M12(a)={b}; removed23(b); G23(b)={c}` should give `G13(a)={c}`
  (INFERRED from code review, not run).
- Duplicate `AddGenerated` entries assert in debug sweep/thrusection tests
  (OCCT #1357, open; DOCUMENTED issue report).
- FUSE and CUT of the same crossing edges keep different Modified sets; an
  empty COMMON has empty Generated despite internal intersection work
  (DOCUMENTED examples). History describes the *result*, not the work.
- History is not naming. It relates one operation's input and output, not
  two regenerations of the model.

**Bend fit (INFERRED).** Pure U32 relations. Composition is a sorted
merge-join; deduplication is sort plus unique. No floating point in this
layer.

### 3.2 Names derived from history (realthunder, FreeCAD 1.0)

**What it is.** A naming layer over OCCT. A mapped name encodes source
names, relation (`;:M`, `;:G`, `;:MG`), ordinal, operation code and tag.
Four passes (DOCUMENTED,
[realthunder](sources/realthunder-topological-naming-algorithm-asm3-wiki.md),
[FreeCAD](sources/freecad-elementmap-mappedname-toposhapeexpansion-freecad-1-0.md)):

1. keep names of unchanged input entities;
2. name outputs of Modified and Generated, from all sources, first source
   as prefix;
3. name unnamed lower entities from named upper ones (`;:U` plus ordinal);
4. name an unnamed upper entity only when **all** its lower entities are
   named (`;:L`).

**Real guarantees (DOCUMENTED).**

- A deleted name is not silently recycled because another edge took its
  index slot.
- In one map, a mapped name identifies at most one indexed entity; an
  entity may have several aliases.
- Default interning compares complete bytes (threshold 0); SHA-1 replaces
  a string only if hashing is enabled and a positive threshold is exceeded,
  and then it is irreversible.

**Where it breaks (DOCUMENTED from the pinned code).**

- The encoding loop keeps the first candidate plus **at most four**
  more. The downward pass picks **only the first** sorted candidate. The
  upward pass for faces looks at the **outer wire only**.
- Ordinals are positions in OCCT's returned sequence. The author's own
  example shows a fillet switching to the lower of two split edges because
  OCCT emits it first.
- Duplicate names get a `;D` suffix from `std::mt19937` seeded by
  `std::random_device` in **release** builds (1..10000). Names can differ
  between sessions.
- The cap-stabilising heuristic `checkForParallelOrCoplanar` uses OCCT's
  `Precision::Angular()` and `Precision::Confusion()`: the full algorithm is
  not purely combinatorial.
- Several history adapters catch `Standard_Failure`, log and return what
  they collected. No `IsDeleted` set is kept in the naming loop.
- `traceElement` stops after 50 iterations to avoid cycles through the
  wrong document's string table.
- The `StringHasher` Save/Restore tests in the inspected file are empty
  bodies.
- The 1.0 release notes say the problem is "not completely solved". Open
  issues #17041 (IDs change after recompute), #29154 (a pad length change
  breaks references; the maintainer lists three separate causes), #27266
  (the reference resolves under V2, but OCCT cannot chamfer the face).

**Cost.** One informal author test: 40 s → 52 s recompute, 17.8 → 22.6 MiB
file (DOCUMENTED, no hardware or repetitions).

### 3.3 Solvable selection recipes (OCAF TNaming)

**What it is.** A selection is stored as a recipe: `TNaming_Name{type,
shapeType, arguments, stop, index, context, orientation}`. Types include
IDENTITY, MODIFUNTIL, GENERATION, INTERSECTION, UNION, CONSTSHAPE,
FILTERBYNEIGHBOURGS, ORIENTATION, WIREIN, SHELLIN. `Solve` resolves child
recipes first, then the recipe itself, within a set of valid labels.
DOCUMENTED ([note](sources/occt-ocaf-user-guide-tnaming-naming.md)).

**Real guarantees.**

- Conditional on the history coverage contract: a solid result must record
  all faces, open shells also open-boundary edges, closed wires their
  edges; **seam edges on periodic surfaces must be tracked explicitly**
  (DOCUMENTED).
- INTERSECTION intersects current adjacency sets by topological identity.
  It is **not** a numerical surface/surface intersection (DOCUMENTED).

**Where it breaks (DOCUMENTED).**

- `Solve` can succeed with several results; a boolean success does not
  mean a unique entity.
- Ambiguous edges get a packed index (edge index and count 8 bits each;
  wire index, wire count and face-argument index 4 bits each). It is used
  only if child counts are unchanged; otherwise all common subshapes are
  stored.
- SUBSTRACTION naming throws `Standard_NotImplemented`.
- Looking up a selection after deleting its shape crashed (OCCT #758,
  closed the next day).

### 3.4 Feature-domain and support-based names (Bidarra, Wang & Nnaji, Capoyleas)

**Bidarra, Nyirenda, Bronsvoort 2005** (DOCUMENTED,
[note](sources/bidarra-nyirenda-bronsvoort-2005-a-feature-based-solution-to.md)):

- A persistent name is `<feature instance>.<feature element>`. Feature
  faces never split, merge or disappear; their B-rep realizations can.
- **Invariant:** every B-rep face is part of exactly one feature face and
  carries its owner. Adjacent coplanar faces **must not merge** unless they
  have the same owner.
- An edge is named by its two adjacent feature-face owners plus a
  discriminator: end faces for planar cases, otherwise **half-spaces** of
  reference planes built from persistent feature elements (e.g. a plane
  through the slot's axis).
- Re-evaluation has three explicit failure cases: faces no longer meet;
  they meet but no edge satisfies the discriminator; several edges satisfy
  it. The system suspends and asks. It **never silently makes a new
  discriminator**.
- Where it breaks: no numeric contract for half-space tests near tangency;
  no treatment of non-manifold radial adjacency, seams or degenerate
  vertices; equal-radius crossing holes turn two edges into four, two of
  which satisfy the stored half-space.

**Wang & Nnaji 2005** (DOCUMENTED,
[note](sources/wang-nnaji-2005-geometry-based-semantic-id-for-persistent-an.md)):

- Names go through supports: a face names its unbounded surface and its
  boundary surfaces; a curve names two surfaces plus a disambiguator; an
  edge names its curve, bounding surfaces and endpoint evidence; a point
  names three or more surfaces.
- A surface pair can give several intersection components, and one
  component can be trimmed into several edges by the same boundary
  surfaces. So a surface pair, even with boundary surfaces, is not unique.
- Branch evidence: `I11 = ∇f × ∇g`; higher "adaptations" use pure
  second derivatives. Plane `z=0` against the cubic cylinder `x³−x−z=0`
  gives three parallel lines; two have the same first-order direction and
  differ only in second derivatives.
- Update: map old to new supports (from Pro/Engineer's surface update
  mapping), then match curve branches by `k`-closeness (position plus
  derivative terms), row by row.
- Where it breaks (INFERRED from the equations): the closeness sum is not
  invariant to scaling `f` or changing units; tangency zeroes the cross
  product; row-wise nearest matching is not a constrained assignment;
  positional branch numbering is not persistent under crossings.

**Capoyleas, Chen, Hoffmann 1996** (report read; DOCUMENTED,
[note](sources/capoyleas-chen-hoffmann-1996-generic-naming-in-generative-co.md)):

- Role names from construction: extruding sketch edge `e_i` gives face
  `f(e_i)`, sweeping vertex `v_i` gives edge `e(v_i)`; blends give `r(e)`,
  chamfers `c(e)`; new intersection entities start as collective `Ie`, `Iv`.
- When roles collide: a bounded BFS from each candidate, partitioned by
  `(distance, label, count)`. Integer-only; no eigenvalues needed.
- Orientation: face-use orientation along an edge, plus feature-flow
  orientation `[F, f, c]` (sweep vector or rotational velocity field).
- The authors **reject** the vertex triple-normal sign
  `sign((n1×n2)·n3)` because its invariance is unclear. Farjana & Han's
  review repeats it without the rejection
  ([note](sources/farjana-han-2018-mechanisms-of-persistent-identification-of-.md)).
- Where it breaks: symmetric configurations (two toroidal-cut circles that
  swap); the fallback **applies a blend to all equally named entities**;
  merged faces keep the earliest feature's name only.

### 3.5 Transient IDs plus translation (Onshape)

**What it is** (DOCUMENTED,
[API](sources/onshape-api-associativity-transient-ids-idtranslations.md),
[architecture](sources/onshape-architecture-microversions-compare-branching-merging.md),
[FeatureScript](sources/onshape-featurescript-queries-qcreatedby-evaluatequery-trans.md)):

- Every change creates an immutable microversion. Entity IDs are valid in
  one microversion. "No persistent ID" is exposed.
- `POST …/idtranslations {sourceDocumentMicroversion, ids}` returns per ID
  `{source, status, target:[…]}` with status OK, SPLIT or
  FAILED_TO_RESOLVE, plus the target microversion.
- OK can change the ID (`JHD → JID`). SPLIT is a known successor set, not
  a set of guesses. After deleting one split part, the same source becomes
  OK again: status is a relation between two states.
- Raw IDs can change even at a fixed microversion after an internal system
  change. Store the reference with its microversion, always translate.
- FeatureScript: queries are lazy ASTs; `qUnion` keeps subquery order;
  `evaluateQuery` order is otherwise arbitrary; transient queries expire
  when the context changes; `Id` components must form contiguous history
  regions (an interleaved loop `extrude/i; chamfer/i; extrude/i+1` fails).

**Real guarantees.** Zero/one/many results with explicit status. Nothing
more is published: no algorithm, no tolerances, no MERGE status, no
completeness claim. FAILED_TO_RESOLVE is not documented as proof of
deletion.

**Numeric contract.** FeatureScript numbers are IEEE binary64. Geometric
comparisons use `1e-8 meter` and `1e-11 radian`; `tolerantEquals` uses
`1e-13` (DOCUMENTED). F32x2 (about 48-bit mantissa, F32 exponent range)
does not reproduce binary64 values. Spatial queries need their own stated
tolerances in wonky; history queries need no floats (INFERRED).

### 3.6 Operation-relative selectors (build123d)

DOCUMENTED ([note](sources/build123d-topology-selection-select-all-last-new-topo-path.md)).
With result `R`, and `I`, `M` the identities and Modified descendants of
`before` (0) and `brought` (1) operands:

- `ALL = R`;
- `NEW = R \ (I₀ ∪ M₀ ∪ I₁ ∪ M₁)`;
- `LAST = (R ∩ (I₁ ∪ M₁)) ∪ NEW`.

NEW is not Generated: it is everything not attributable to an input, so an
unreported entity also lands there. LAST depends on operand roles, so a
commutative union can give different LAST sets when operands swap.
Boolean and `clean()` histories are composed before selection. `topo_path`
records the selection route (e.g. an edge selected through a face) and is
excluded from geometric equality.

**Where it breaks (DOCUMENTED).**

- #1453 (open): moving a recorded box makes all seven faces NEW, because
  the copied history still names shapes at the old location.
- The generic adapter swallows kernel exceptions into empty histories; a
  Builder fallback attaches an empty record. Missing history becomes NEW,
  not "unknown".
- Reverse maps keep one source per result; merges lose origins.
- Wires, shells and compounds are untracked and fall through as NEW.

### 3.7 History-free matching (Jones et al. 2023; US11288411B2)

**Jones et al.** (DOCUMENTED,
[note](sources/jones-et-al-2023-b-rep-matching-for-collaborating-across-cad.md)):

- Bootstrap: match entities that are **coincident** (actual trimmed
  entities, via Parasolid). The paper's candidate filter uses D+1 shifted
  grids of cell size (D+1)δ; the released C++ uses nested all-pairs loops
  with `COINCIDENCE_TOL=1e-5`.
- Then a 6-layer SB-GCN encoder, a 4-layer graph attention network over the
  partial matching, and a pair MLP. Greedy: add the best pair, mask its row
  and column, stop below a threshold (0.7 in the paper's table). One-to-one
  only; one-to-many is future work.
- Results at 0.7: correct labels 91.5 / 92.1 / 94.9 % (faces / edges /
  vertices, including true negatives), **wrong labels 2.8 / 1.9 / 1.1 %**,
  missed 5.6 / 6.0 / 4.0 %. The pure-geometry baseline finds only 11.0 /
  14.0 / 17.1 % of updated entities.
- The ground truth itself is heuristic: when Onshape's tracking gave
  one-to-many, one match was picked at random.
- Fails on repeated gear teeth, fillet one-to-many edges, and radical
  profile swaps (an I becomes a B: spurious matches along the outline).

**PTC patent** (DOCUMENTED,
[note](sources/us11288411b2-b-rep-matching-for-maintaining-associativity-ac.md)):
body filters, translation-only alignment by histogram voting, coincidence
within 0.00005 (units unspecified), same-support overlap ≥ 80 % of the
smaller entity, and cyclic adjacency signatures with sentinels (−1
unmatched, −2 loop separator, −3 missing face) processed most-constrained
first; a pair is committed only if unique. Inventor claim: about 4000 faces
in about 10 s, no hardware given.

**Guarantees.** None for intent. Both prefer precision over recall: a
missing reference raises a visible error, a wrong match silently drives a
wrong feature.

### 3.8 Model comparison (Brière-Côté, Rivest, Maranzana)

DOCUMENTED ([note](sources/bri-re-c-t-rivest-maranzana-2012-comparing-3d-cad-models-use.md)):

- Static IDs need shared construction; signatures need a definition per
  entity type; similarity needs tuned weights; syntax-specific matching
  (only edges whose adjacent faces already match; vertex → edge → face)
  prunes the search.
- Faces with the same surface equation but different boundaries are
  "limited/affected": geometry, trim and topology equality are three
  different things.
- Directed distances differ (`h(A,B) ≠ h(B,A)`); symmetric Hausdorff takes
  the maximum.
- Boolean robustness "depends directly on the kernel", especially at
  coincident boundaries and vanishing intersection angles, which are
  exactly what nearby revisions produce.
- No benchmark; the product inventory is from about 2012.

**INFERRED qualifications (from the note):**

- lineage IDs locate candidates; they do not prove unchanged geometry;
- equal volume or area is a rejection filter, never proof of equality;
- `volume(A ∩* B) = 0` does not mean no contact: regularisation removes
  lower-dimensional touching;
- a sampled maximum certifies Hausdorff only with a coverage bound: if the
  sample set `P` is an ε-cover of `A`, then
  `max(P→B) ≤ h(A,B) ≤ max(P→B) + ε`.

### 3.9 Containers: definition, placement, use

DOCUMENTED ([TopoDS note](sources/occt-modeling-data-guide-topods-tshape-location-orientation.md)):

- `IsPartner`: same `TShape`. `IsSame`: plus equal location. `IsEqual`:
  plus equal orientation. None compares geometry; none survives a rebuild.
- The default map hasher uses `IsSame` and omits orientation: a map of
  entities deduplicates opposite uses.
- A location is a chain of shared datums with powers; equality compares
  the chain symbolically, not matrices.
- Four orientations: FORWARD, REVERSED, INTERNAL, EXTERNAL. In the pinned
  code the composition table is indexed `[Or2][Or1]` while its comment
  labels rows `Or1`; they differ for INTERNAL/EXTERNAL. Test all 16 pairs
  before porting.
- Per-entity tolerances; `Precision::Confusion() = 1e-7` user units is a
  geometric policy, not machine epsilon.
- `TShape` holds mutable flags (Modified clears Checked); sharing is not
  immutability.

Parasolid fins and Fornjot's stores are summarised in 1.1. **wonky**
(INFERRED): the U32 list container fits Bend. What it lacks is a separation
of definition and use (a rigid transform copies the body today; identity
keeps the origin and makes a new occurrence), a reverse incidence index,
and an explicit rule for self-adjacent seam edges.

### 3.10 Summary

| technique | real guarantee | breaks at |
|---|---|---|
| OCCT history algebra | result closure; exact relation kinds; composition | successor order; disabled vs empty history; no split/merge kinds |
| history-derived names (FreeCAD) | no recycling of deleted names; unique reverse lookup | ordinals from kernel order; ≤ 5 parents; random duplicate suffix; tolerance heuristics |
| selection recipes (OCAF) | resolution against current history, with scope | multiple results reported as success; positional fallback |
| feature-domain names (Bidarra) | names exist while the feature exists; 0/1/many realizations; explicit failure | needs a single owner per face; no numeric contract for half-spaces |
| support names (Wang & Nnaji) | separates support, component, trim | unit-dependent branch metric; tangency |
| role names + BFS certificates (Capoyleas) | integer-only context evidence | symmetry; apply-to-all fallback |
| translation service (Onshape) | versioned 0/1/many with status | algorithm unpublished; no MERGE status |
| LAST/NEW selectors (build123d) | exact set semantics given complete history | missing history becomes NEW; moves |
| history-free matching (Jones) | measured accuracy on one dataset; abstention | 1-3 % wrong labels; one-to-one; Parasolid; patent |
| layered comparison (Brière-Côté) | a clean decomposition | Boolean robustness at coincidence |

---

## 4. War stories and anti-patterns

### 4.1 War stories (DOCUMENTED unless marked)

- **The fillet that moves to the other edge.** Moving a slot or cut makes a
  blend jump to the other intersection edge of the same face pair.
  Pro/ENGINEER 12 in Capoyleas's Fig. 1; Pro/Engineer in Wang & Nnaji's
  Fig. 1; a commercial system in Bidarra's Figs. 9-11; realthunder's own
  cube/cylinder example, where OCCT emits the lower split edge first
  ([Capoyleas](sources/capoyleas-chen-hoffmann-1996-generic-naming-in-generative-co.md),
  [Wang](sources/wang-nnaji-2005-geometry-based-semantic-id-for-persistent-an.md),
  [Bidarra](sources/bidarra-nyirenda-bronsvoort-2005-a-feature-based-solution-to.md),
  [realthunder](sources/realthunder-topological-naming-algorithm-asm3-wiki.md)).
  These are historical product examples, not claims about current releases.
- **Equal radii create ambiguity.** Two crossing holes with unequal radii
  meet in two edges; equal radii give four, and two satisfy the stored
  half-space. A commercial system blended one arbitrarily; Bidarra reports
  ambiguity instead.
- **FreeCAD's long road.** The FreeCAD wiki page on the problem dates from
  about 2015 (catalog). The element map shipped in FreeCAD 1.0 on
  2024-11-19 and is called a "mitigation" and "not finished"
  ([older note](sources/freecad-topological-naming-realthunder-s-element-map-algorit.md)).
  The older note (2026-09-22) counts 27 open and 52 closed "Toponaming"
  issues and lists reports where TechDraw, Assembly, FEM and
  SubShapeBinder lose references (#22482, #17554, #17776, #32126, #26084);
  their current status was not rechecked. A replacement algorithm is in
  draft (#31040).
- **Non-determinism by design.** FreeCAD's release builds pick duplicate
  suffixes with a randomly seeded generator, so a model that hits
  duplicates gets different names per session
  ([note](sources/freecad-elementmap-mappedname-toposhapeexpansion-freecad-1-0.md)).
  The older note links this to "IDs change after recompute" (#17041) as
  INFERRED.
- **Naming fixed, geometry still impossible.** FreeCAD #27266: under V2 the
  chamfer's face reference resolves, but OCCT cannot chamfer it. #29154:
  one user-visible breakage had three separate causes (sketch flip,
  refine naming, V2).
- **Index out of bounds.** FreeCAD #14129 "Shape index 11 out of bound 10":
  the mapped name survived, the resolved index was stale
  ([older note](sources/freecad-topological-naming-realthunder-s-element-map-algorit.md)).
- **Moving a part makes everything new.** build123d #1453 (open).
- **History that lies by omission.** build123d swallows history exceptions
  into empty lists; FreeCAD adapters catch `Standard_Failure`; OCCT can
  disable history and return empty lists. All three turn "unknown" into a
  plausible answer.
- **Wire order after STEP round trip.** OCCT #1363 (open): export/import
  changed wire order and moved an invalidity to a neighbouring face.
  Traversal ordinals are not identity
  ([note](sources/occt-modeling-data-guide-topods-tshape-location-orientation.md)).
- **Provenance tags that steer cleanup.** Manifold #1834: copying triangle
  IDs into `faceID` on export stopped coplanar triangles from collapsing
  after re-import. The same mesh behaved differently after a round trip
  ([note](sources/manifold-elalish-manifold.md)).
- **A labelled mesh as B-rep, with silent surgery.** BREP.io pushes
  coplanar tool faces by `max(4e-4, 1e-5·scale)` with a probe vote, and
  cleans tiny faces and close points after the Boolean. Nothing is
  reported ([note](sources/brep-io.md)).
- **Fornjot.** Six years, no 3D Boolean, shut down 2026-06-19. The final
  append-only layered topology is the part worth keeping
  ([shutdown](sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md),
  [experiment](sources/fornjot-final-experiment-experiments-2025-12-03-plus-experim.md)).
- **Learned matching's residue.** Jones et al.: 1.1-2.8 % wrong labels on
  the synthetic set, 1.4-2.3 % on 16 expert models. Wrong labels are the
  expensive kind.
- **Onshape's own caveats.** Raw IDs can change at a fixed microversion; a
  merge can produce incompatible features; reverting a merge can lose later
  edits ([note](sources/onshape-architecture-microversions-compare-branching-merging.md)).
- **wonky, today (DOCUMENTED, code).** `hybridRemovedMaterial` refuses a
  SUBTRACTION when a tool face lies only on a carrier the target shares,
  because "the coincident triangles may carry either tag". This is
  Bidarra's single-owner problem showing up in wonky's own code.

### 4.2 Anti-patterns (INFERRED from the war stories)

1. **Positional identity.** Array index, successor ordinal, traversal
   order, "branch k in sorted order", coordinate order (Mun's OSI). All
   change under harmless edits.
2. **Choosing one of a set.** First sorted candidate (FreeCAD downward
   pass), random suffix, earliest name on merge (Capoyleas), random pick for
   one-to-many ground truth (Jones). Return the set, or ambiguity.
3. **Applying to all equal names** (Capoyleas's blend fallback). A
   destructive feature on the wrong edges is worse than an error.
4. **Unknown history treated as an answer.** Empty lists, NEW, or
   "revision-local" chosen silently when history was not collected.
5. **Truncated ancestry to keep names short.** Store the full relation;
   make short names a view.
6. **Geometric nearest-neighbour repair as resolution.** Repair
   suggestions are UI, never the reference.
7. **Tolerance-based identity.** `IsSame`-style identity is exact; geometry
   equivalence is a separate, tolerance-bearing query.
8. **Merging coplanar faces of different owners without a record.** The
   information Bidarra-style naming needs disappears before selection runs.
9. **Provenance that steers geometry.** If tags change cleanup (Manifold
   #1834), tags must round-trip exactly.
10. **One identifier for six things.** Onshape's docs separate revision,
    branch head, named version, feature ID, topology ID and occurrence.
    wonky already separates origin, instance and revision; keep it so.
11. **Blaming everything on naming.** FreeCAD #29154 and #27266: some
    failures are geometry. Diagnostics must say which stage failed.

---

## 5. What wonky should take: ranked proposals

Ranking logic (INFERRED): everything else consumes the operation history, so
it comes first. Then a frontend correctness gap that exists today. Then the
reference contract, then the two recover-side decisions that must be made
before names harden (ownership, edge names). Diff, representation and
external oracles follow.

| rank | proposal | depends on | relation to the bake-off / hybrid plan |
|---|---|---|---|
| P1 | `OperationHistory` from corefine → recover, in Bend | mesh-booleans P3 | completes plan step 9 "provenance section"; turns today's JS face sources into a kernel contract |
| P2 | per-entity creator sets and roles (face-level `qCreatedBy`) | P1 | fixes a FeatureScript semantics gap visible today |
| P3 | set-valued reference translation (`split`, `merged`, …) | P1 | replaces "revision-local" for Boolean outputs |
| P4 | owner sets through carrier unification | P1 | a recover decision (`unify.bend`, sliver absorption) |
| P5 | exact names for recovered intersection edges | P1, mesh P3 | recover computes curves per carrier pair already |
| P6 | selection recipes and a resolver ladder | P2, P3, P5 | needed before `opFillet`/`opChamfer` exist |
| P7 | layered model diff | P1, P3 | reuses the hybrid for added/removed/common regions |
| P8 | U32 interned identity nodes instead of framed Strings | measure first | native CLI path (plan step 11) |
| P9 | external oracle, later a history-free fallback | P3 | validation only; patent review first |

### P1. A typed `OperationHistory`, emitted by corefine → recover in Bend

**Idea.** Every modeling operation returns, next to its bodies, one
immutable history record (OCCT's contract, 1.3):

- `rows`: `(relation, inKind, inOperand, inIndex, outKind, outIndex)`, all
  U32, with `relation ∈ {Unchanged, Modified, Generated}`;
- `deleted`: input entities absent from the result with no Modified image
  (they may still have Generated rows);
- `completeness ∈ {complete, partial(reason), unsupported(reason)}`,
  so "no rows" never means "unknown".

For the hybrid:

- **faces, Modified**: from the tags of the triangles that form each result
  face (what `attachResultMesh` computes in JS today, moved into recover,
  which already owns the patch → face assignment);
- **edges, Generated**: from the two carrier classes of each intersection
  edge, mapped back to input faces (mesh-booleans P3 records);
- **vertices, Generated**: from carrier triples at corners;
- **cleanup composed, not re-derived**: carrier unification and sliver
  absorption are recover's `UnifySameDomain`. Record them as a second step
  and compose (M∘M = M, otherwise G). Today `attachResultMesh` declines
  after sliver absorption and after unification at 1e-7 mm or more; P1
  turns "decline" into `partial(reason)` first and into `complete` once
  the steps are recorded.

Primitive operations (box, frustum, extrusions, revolve) emit `Generated`
rows from their sketch entities and roles; transforms emit `Unchanged` with
a new occurrence.

**Where it plugs in.** `kernel/hybrid/recover/` (face source sets, edge
carrier pairs), `kernel/hybrid/corefine/` and the optional provenance
section in `kernel/hybrid/mesh-io.bend` (mesh-booleans P3), a new type in
`kernel/identity.bend` replacing `boolean_result`, decoding in
`src/hybrid.mjs`, storage next to `operationEvidence` in
`src/construction-history.mjs`.

**Bend fit.** Excellent. Rows are fixed-width U32 tuples produced per
triangle, per edge and per corner, which the kernels already compute in
parallel. Grouping is sort plus unique plus segmented reduction.
Composition is a sorted merge-join. No floating point. Uniform work.

**Expected benefit.**

- Boolean outputs stop being 100 % revision-local; P2-P7 become possible.
- `hybridRemovedMaterial` becomes a query over history instead of a local
  heuristic.
- The native CLI path (plan step 11) gets provenance without the JS side.
- Explains results to an LLM: "this face is Modified from `a.cap/end`; this
  edge is Generated by `a.cap/end` × `b.side/lateral`".

**Risks.**

- corefine's weld and short-edge collapse (2^-36·scale) merge vertices built
  from different pairs; provenance becomes a set. A set whose carriers
  cannot meet must be a named refusal, not a pick.
- On coincident carriers "the coincident triangles may carry either tag"
  (`src/library.mjs`). A coincident face must record both operands (P4),
  not whichever tag won the symbolic perturbation.
- Edges internal to one analytic face carry the same tag on both sides and
  must produce no Generated row.
- OCCT's inspected `Merge` may mishandle removed+generated (3.1). Implement
  the documented algebra, not a translation.

**First acceptance test.**

1. Algebra unit tests in Bend, no geometry: unchanged with empty lists;
   full removal; one-to-two split; two-to-one merge; removed+generated;
   `M12(a)={b}; removed23(b); G23(b)={c}` composes to `G13(a)={c}`; disabled
   history ≠ complete empty history.
2. On the 38-case corpus and the adversarial suites, for every exact
   result: closure (all targets in the result); per input M ∩ G = ∅; never
   deleted ∧ modified; face Modified rows equal today's `attachResultMesh`
   sources wherever it does not decline (0 mismatches); every edge between
   two different carrier classes has Generated rows naming exactly the face
   pair recover derived; `completeness = complete` on at least the 32
   exact corpus cases, `partial` with a reason elsewhere.
3. Byte-identical history text on JS, cpu1, cpu18 and Metal.

### P2. Per-entity creator sets and roles (face-level `qCreatedBy`)

**Idea.** Derive `CreatedBy(entity)` per face, edge and vertex from P1,
using FeatureScript's documented rules
([note](sources/onshape-featurescript-queries-qcreatedby-evaluatequery-trans.md)):

- a primitive or Generated entity: `{op}`;
- Modified one-to-one: the source's set, unchanged;
- split (one input → several outputs of that kind): `C(s) ∪ {op}` for
  every child;
- merge (several inputs → one output): `⋃ C(s_i) ∪ {op}`.

Keep role facts (`cap/start`, `cap/end`, `profile-side/<entity>`)
**relative to their operation**, never overwritten by the last one. Then
`qCreatedBy(id, FACE)` filters entities instead of returning every face of
a body, and `qCapEntity`/`qNonCapEntity` become implementable.

**Where it plugs in.** `src/queries.mjs` (`created` case and `owned`),
`src/library.mjs` (keep the body-level `createdBy` set for BODY queries),
`kernel/identity.bend` (per-entity creator lists).

**Bend fit.** Sorted U32 operation-id lists per entity; union by merge and
unique; one pass per operation.

**Expected benefit.** FeatureScript fidelity for the most common selection
idiom (`qCreatedBy(id + "cut", EntityType.EDGE)` → fillet or chamfer those
edges). Today the body-granular answer is silently too large (1.7). For
FDM, "chamfer the bottom edges of this extrusion" depends on it.

**Risks.**

- Onshape does not fully document inheritance through Booleans with a
  separately created tool body, or cap roles after a Boolean. Do not guess:
  use a frozen Onshape oracle (P9) for the first fixtures.
- Changing face-level semantics can change existing corpus results; run the
  FS corpus in diff mode and review every change.
- "Split" across result bodies (one face → faces in two bodies) needs a
  rule; treat it as split.

**First acceptance test.** A FeatureScript fixture: block `a` (extrude),
cylinder tool `b` (extrude, NEW), `opBoolean` SUBTRACTION `c`, then a second
fixture where `c` cuts the block into two bodies. For each of
`qCreatedBy(a|b|c, FACE|EDGE)` and `qCapEntity(a, CapType.END, FACE)`: the
entity sets equal the ones Onshape returns for the same FeatureScript
(frozen once via the session bridge, counts and roles compared, not raw
IDs). Until the oracle exists, the test asserts at least that
`qCreatedBy(a, FACE)` no longer contains the cut walls.

### P3. Set-valued reference translation

**Idea.** Extend `matchTopologyReference` from
`matched | missing | ambiguous | unsupported` to Onshape's shape of answer,
plus a merge status:

- `unique(entity)`;
- `split(set)`: all members descend from the reference by recorded
  history; the set is the answer, not a candidate list;
- `merged(entity, coParents)`: the reference now lives inside an entity
  with other origins;
- `deleted(generatedChildren)`: gone, possibly with Generated successors
  (a filleted edge);
- `missing(reason)`: no lineage path; not claimed to be deletion;
- `ambiguous(candidates, evidence)`: competing hypotheses;
- `unsupported(reason)`: history partial or absent.

Resolution is "descendants of this origin in the target revision's
history", with a policy: `strict` (identity-preserving only, like
`makeRobustQuery`) or `follow-split-merge` (like
`makeRobustQueriesBatched(…, true)`). A caller that needs one entity gets
an error on `split`; it never gets "the first".

Cross-regeneration stability comes from P1 plus derived names: an output
entity's key is a pure function of its sorted source keys, relation kind
and operation (realthunder's four passes, 3.2), with no ordinal. Siblings
of a split share the derived key and are told apart only by the set.

**Where it plugs in.** `src/identity.mjs` (`matchTopologyReference`,
`topologyReference`), `kernel/identity.bend` (derived keys),
[../topology-identity.md](../topology-identity.md) (contract table), the
review UI.

**Bend fit.** Pure functions over U32 relations; the four naming passes are
a map, a sort and two bounded fixpoints (≤ 3 dimension levels).

**Expected benefit.** Boolean results get references that survive edits;
the LLM and the viewer see "this face split into 2" instead of "unsupported".

**Risks.** Derived keys make a model's names depend on its operation
structure; refactoring a feature's internal steps is a naming migration
(realthunder's versioning lesson). Version the identity algorithm.

**First acceptance test.** Fixtures modelled on Onshape's cube example
([note](sources/onshape-api-associativity-transient-ids-idtranslations.md)):

- r1 box; r2 box minus a through-slot splitting the top face: reference to
  `box.cap/end` → `split` with 2 faces;
- r3 slot tool deleted: the same r1 reference → `unique` again;
- r4 two boxes unioned with coplanar tops: `a.cap/end` → `merged` with
  co-parent `b.cap/end`;
- r5 a through-hole edge after the hole is removed → `missing` or
  `deleted`, never `unique` on another edge.

No `split` result ever comes back as `unique`.

### P4. Owner sets through carrier unification (Bidarra's invariant, adapted)

**Idea.** recover merges coplanar faces of different operands into one
face (carrier classes; `unify.bend` at 2^-44). That is right for clean
STEP and FDM output, and it violates Bidarra's "no cross-owner merge"
(3.4). Keep the geometric merge, and keep the information:

- the merged face gets a Merged history row from **every** owner (P1) and
  an owner *set*;
- where corefine's coincident triangles could carry either tag, the face
  records all owners of the carrier class, and a flag `coincident` instead
  of an arbitrary single owner;
- optional later: an owner overlay (a partition of the face into owner
  regions from the tagged triangles), valid only outside coincident areas.

**Where it plugs in.** `kernel/hybrid/recover/` and `kernel/hybrid/unify.bend`
(record, do not drop), `src/hybrid.mjs` (replace the decline on wide
unification with owner sets), `src/library.mjs` (`hybridRemovedMaterial`
reads owner sets).

**Bend fit.** Owner sets are sorted U32 lists per face, built by a
segmented union over triangles.

**Expected benefit.** References to "the top face of block a" stay
meaningful after a union; the subtraction check gets a principled input;
no silent loss before naming runs.

**Risks.** Owner overlays near coincident regions are not reliable, so
they must not drive geometry (Manifold #1834 lesson: provenance that steers
cleanup must be round-trip stable).

**First acceptance test.** Two boxes side by side with coplanar tops, union:
one top face, owner set `{a.cap/end, b.cap/end}`, `CreatedBy = {a, b,
union}`. Two overlapping boxes with coplanar tops: owner set of both and
`coincident = true`. `hybridRemovedMaterial` gives the same answers as
today on the existing tests.

### P5. Exact names for recovered intersection edges and vertices

**Idea.** Name an edge the way Wang & Nnaji separate it (3.4), with
wonky's exact tools:

- `support`: the ordered pair of input faces (from P1), with a fixed
  orientation convention; not a blindly sorted pair, because swapping
  flips `∇f × ∇g`;
- `component`: which connected intersection curve of that pair. Decide it
  by an **exact predicate on construction data**, Bidarra-style: the sign
  of `(p − o)·n` for a reference plane taken from the carriers (e.g. the
  plane through a cylinder's axis and the plane normal), evaluated in
  multi-limb U32 where the carriers are exact, or in F32x2 with a stated
  bound. A tie or an uncertain sign is `ambiguous`, never "branch 0";
- `trim`: the end vertices' names (each a carrier triple);
- `use`: the coedge orientation, kept separate from identity;
- seams: a self-adjacent edge has support `(f, f)`; name it by role (the
  seam of face `f`) as `identity.bend` already does for frustums
  (`side/seam`).

**Where it plugs in.** `kernel/hybrid/recover/` (it computes the curve for
each carrier pair and knows the curve type), `kernel/identity.bend`.

**Bend fit.** One predicate per edge, bucketed by carrier-pair type; the
plane/quadric signs are low-degree polynomials in the carrier coefficients,
so exact U32-limb evaluation is feasible where the coefficients are exact
(INFERRED).

**Expected benefit.** Stable edge references for chamfers and fillets (FDM
elephant-foot chamfers, fillets on bosses) and edge-level diffs.

**Risks.**

- Space quartics (cylinder/cylinder, Unresolved today) and tangencies need
  more than a half-space.
- Bidarra's equal-radius crossing holes: the correct answer is ambiguous,
  and the API must say so.
- Reference planes must come from construction data (axes of carriers),
  not from the current geometry's sorted positions.

**First acceptance test.** A block with a horizontal cylinder cut through
its side (each planar face meets the cylinder in two lines): component ids
stay the same when the cylinder moves by 1 mm and when operands are passed
in the other order. Two crossing holes: unequal radii give distinct names
for the edges on each wall; equal radii return `ambiguous` for the stored
half-space name.

### P6. Selection recipes and a resolver ladder

**Idea.** Persist what the user meant as an immutable expression, not as
an entity ID (OCAF, 3.3; Capoyleas, 3.4):

- nodes: `semantic(op, role)`, `createdBy(op, kind)`,
  `descendants(expr, policy)`, `commonEdges(faces, faces)`,
  `generatedFrom(expr)`, `adjacentTo(expr)`, `halfSpace(expr, plane)`;
- a resolver ladder that returns evidence at each step: recorded lineage →
  semantic roles → oriented incidence → a bounded BFS certificate
  (distance, label, count; integers only) → explicit candidate set;
- outcomes are P3's statuses. A destructive feature (fillet, chamfer, cut
  by reference) requires `unique` or an explicit set request.

`src/queries.mjs` already models FeatureScript queries as a lazy
`TopologyQuery` AST. P6 gives that AST a kernel-side resolver and a
serialized form.

**Where it plugs in.** `src/queries.mjs`, `kernel/identity.bend` (or a new
`kernel/selection.bend`), the future `opFillet`/`opChamfer` stage.

**Bend fit.** Set joins over sorted U32 arrays; independent recipes in
balanced fork-join; BFS with fixed depth and immutable frontiers. Irregular
depth is CPU work.

**Expected benefit.** The wrong-edge fillet (4.1) becomes an error with
candidates; an LLM can repair a reference by reading the evidence.

**Risks.** Scope creep; implement only the node types the frontend needs.

**First acceptance test.** Selection only (fillets do not exist yet): an
edge selected as `commonEdges(block.cap/end, slot.side)` plus a half-space;
move the slot so that edge disappears while its sibling survives →
`missing` (Bidarra Fig. 9), not the sibling. A symmetric part with two
indistinguishable edges → `ambiguous` with both.

### P7. Layered model diff

**Idea.** Brière-Côté's layers (3.8) on wonky's data:

1. scope: both revisions, frames (no automatic alignment), units, tolerance
   and error budget;
2. lineage join per entity (P3): unchanged, geometry-changed,
   trim-changed, split, merged, deleted, generated;
3. analytic verification of "unchanged": exact carrier equality and equal
   loops; lineage alone is not proof;
4. bounded deviation for changed faces, with a coverage bound;
5. regions: added `B − A`, removed `A − B`, common `A ∩ B` through the
   hybrid; interference volume, contact and clearance reported separately.

`src/comparison.mjs` already has this report shape for coaxial cylinders
(added, removed, common, clearance, contact); P7 generalises it.

**Where it plugs in.** `src/viewer/diff.mjs` (today: body-id matching and
bounds), `src/viewer/compare.mjs`, `src/comparison.mjs`, a CLI report.

**Bend fit.** Joins, per-entity checks and volume reductions are fork-join;
the Boolean regions reuse corefine → recover.

**Expected benefit.** The review UI answers "what changed, where, how much"
at entity level; the LLM gets a structured diff instead of pixels.

**Risks.** Boolean differences of nearby revisions are the hardest Boolean
inputs (coincident faces, tiny angles). Expect refusals and report them.

**First acceptance test.** A plate with one hole, r1 → r2 changes the hole
diameter: the hole wall and its two rim edges are `geometry-changed`, top
and bottom faces `trim-changed`, all other entities `unchanged`, added +
removed volume `π(r2² − r1²)·h` within 1e-9 relative. Moving the hole gives
removed and added regions and marks the wall `geometry-changed`.

### P8. U32 interned identity nodes instead of framed Strings

**Idea.** `kernel/identity.bend` builds keys by String concatenation. Keep
the framing semantics, change the representation: a key is an interned
node `(tag, children…)` of U32 fields in a per-revision sorted table; hash
limbs only as accelerators, with full-key comparison on equality;
persist the whole reachable DAG natively. Separate definition identity
from occurrence (TopoDS): an instance path, not a copied body.

**Where it plugs in.** `kernel/identity.bend`, `src/identity.mjs`, native
CLI (plan step 11).

**Bend fit.** Excellent: sort, unique, binary search over U32 tuples.

**Expected benefit.** Cost stays proportional to history size; native
save/reload without a JS string table (FreeCAD's intermediate-ID lesson).

**Risks.** Premature if Strings are cheap. Changing keys is a schema
migration (`wonky-topology-identity/2`).

**First acceptance test.** Measure first: identity time as a share of
hybrid time on `plate-hole-grid-10x10` and `fine-spheres-50k`. Only if it
exceeds a few percent: re-encode, and require the same key-equality
relation on every existing identity test.

### P9. External oracle, later a history-free fallback

**Idea.**

- **Oracle (soon).** For a handful of edits (split, delete, rollback,
  merge, reorder), freeze Onshape source/target microversions and their
  `idtranslations` responses. Replay the same FeatureScript in wonky and
  compare cardinalities (OK ↔ unique, SPLIT ↔ split, FAILED ↔
  missing/deleted), not raw IDs. Validation only; the cloud never enters
  the kernel path.
- **Fallback (later, after patent review).** For imported models without
  history: a deterministic coincidence bootstrap plus adjacency propagation
  that commits only unique signatures and abstains otherwise. Evidence
  classes stay separate: proven by history, verified coincidence,
  heuristic suggestion, ambiguous.

**Where it plugs in.** `fixtures/` (frozen responses), `test/`,
`identifyImport`.

**Bend fit.** Oracle: none needed. Fallback: descriptors in F32x2 with
stated tolerances, U32 signatures with tagged sentinels (not −1/−2/−3), a
synchronous frontier of conflict-free unique matches.

**Expected benefit.** An independent check of P1-P3; reimport of edited
Onshape parts.

**Risks.** The oracle's behaviour is undocumented beyond the example;
Jones's deterministic baseline is weaker than the learned method; PTC's
claim 2 is broad.

**First acceptance test.** Five frozen Onshape edit pairs; wonky's P3
statuses agree in cardinality on every entity both sides report.

### Not proposed, on purpose

- **Learned matching** (Jones). Native operations know their history;
  relearning it adds 1-3 % wrong labels.
- **FreeCAD's name grammar.** Store the relation; names are a view.
- **Random or first-candidate disambiguation, apply-to-all fallbacks,
  nearest-geometry repair as resolution.**
- **A pointer-based or radial-edge container rewrite.** No FDM need for
  non-manifold topology today; the U32 lists fit Bend.
- **GPU for identity.** Irregular, small, CPU fork-join is enough until
  measured otherwise.

---

## 6. Open questions worth a prototype

1. **How often does hybrid provenance become a set?** Instrument, do not
   change: on the corpus and adversarial suites, count (a) result faces
   where `attachResultMesh` declines, by its named reason (slivers, wide
   unification, shell mismatch, neighbour ambiguity, …); (b) corefine output vertices welded from different
   pairs; (c) edges whose two carrier classes each map to more than one
   input face. This sizes P1's `partial` share before any design is frozen.
2. **Is coincident-tag assignment consistent?** When two operands share a
   carrier, does corefine's symbolic perturbation give a whole coincident
   region one operand's tag, or mix them per triangle? If consistent, P4's
   owner overlay can be exact outside tangencies; if mixed, only owner
   *sets* are sound.
3. **Which exact predicates name all components recover supports?** For
   each curve type in `docs/proto-recover.md` (line pairs, ellipses, conics,
   circles, torus sections): is one feature-relative half-space sign enough
   to separate components, what degree is the predicate, and can it be
   evaluated exactly from the carrier data? Space quartics are the open
   case.
4. **Onshape's creator and cap semantics through Booleans.** What do
   `qCreatedBy(tool, FACE)`, `qCreatedBy(boolean, FACE)` and `qCapEntity`
   return after `opBoolean` with a separately created tool, and after a
   split into two bodies? Freeze the answers once through the session bridge
   (P2, P9).
5. **What does identity cost in Bend?** Framed Strings vs U32 interning on
   `plate-hole-grid-10x10`. The only published number is realthunder's
   informal ~30 %; the "negligible" claim is HEARSAY (P8).
6. **Model-level lineage across a chain.** exact → re-tessellate → corefine
   → recover, repeated. Can per-operation histories be composed into a
   model-level relation without keeping every intermediate entity? FreeCAD
   had to persist intermediate string IDs to keep names stable after
   save/restore (3.2). Prototype a pruning rule: keep an intermediate only
   while some reference or diff needs it.
7. **Seam identity after Booleans.** recover flags seam edges. Does a seam
   keep its role through a Boolean that trims the periodic face, and does
   it move (Jones lists seam relocation as a matching hazard)?
8. **OCCT's removed+generated composition.** A pure algebra test in wonky
   (P1 test 1) settles wonky's behaviour. Whether OCCT's `Merge` really
   drops those children is a side question; running it needs OCP and is not
   worth a heavy setup.
9. **Primary texts still missing.** Kripac 1995/1997 (ID schema and
   split/merge rules), Marcheix & Pierra 2002 (the actual taxonomy), Cheon
   et al. 2012 (merge/split history matching), Raghothama & Shapiro 1998
   (when two B-reps of a parametric family are "the same"). Acquire lawfully
   before relying on secondhand summaries.
10. **FreeCAD V2 (#31040).** Its multi-child links and migration design
    should be read before P3 fixes a split representation.
11. **Parasolid attribute classes.** Find the actual PK reference for
    split/merge/transfer behaviour to confirm or refute the scout's table;
    it would be the only production precedent for a declarative per-field
    policy (1.6 (a)).

---

## 7. Catalog of the remaining sources

### 7.1 Catalog-only sources from the scout (not deep-read)

All entries: scout's description, not verified here (HEARSAY for their
content).

| source | kind, year | status, license | one line | why it matters for wonky |
|---|---|---|---|---|
| [Cheon, Mun, Han, Kim 2012](https://doi.org/10.1007/s12206-012-0827-3) | paper, 2012 | historical; Springer, paywalled | name matching that tracks topology merge and split history | closest published work to P1/P3's split/merge relation (open question 9) |
| [Raghothama & Shapiro 1998](https://doi.org/10.1145/293145.293148) | paper, 1998 | historical; ACM, paywalled | formal semantics of "the same" B-rep in a parametric family | a formal basis for what P3 promises |
| [Denning & Pellacini 2013, MeshGit](https://cse.taylor.edu/~jdenning/research.html) | paper, 2013 | historical; ACM (author page) | mesh edit-distance matching for diff and 3-way merge | history-free diff baseline for mesh bodies (CertifiedMesh) |
| [Zoo KCL tags and edge functions](https://zoo.dev/docs/kcl-lang/types) | docs, 2023-2026 | active; MIT | `$tag` on sketch segments and faces; edges by face pairs (`getCommonEdge`); tags reportedly leak across scopes | code-first naming ergonomics for LLM-written models |
| [Weiler 1985](https://doi.org/10.1109/mcg.1985.276271) | paper, 1985 | historical; IEEE | sufficiency of edge-based structures for curved B-reps | container background |
| [Guibas & Stolfi 1985, quad-edge](https://doi.org/10.1145/282918.282923) | paper, 1985 | historical; ACM | rot/sym/onext as index arithmetic on groups of four | pure index arithmetic, a natural Bend encoding |
| [Mäntylä & Sulonen 1982, GWB](https://doi.org/10.1109/mcg.1982.1674396) | paper, 1982 (book 1988) | historical; IEEE | half-edge plus Euler operators | Euler-Poincaré checks as a validity signal |
| [Lee & Lee 2001, partial entities](https://doi.org/10.1145/376957.376976) | paper, 2001 | historical; ACM/ASME | compact non-manifold B-rep, about half radial-edge storage | only if non-manifold results are ever admitted |
| [CGAL combinatorial maps / G-maps](https://doc.cgal.org/latest/Combinatorial_map/index.html) | library, 1994-2026 | active; LGPL-3.0+ or commercial | dart-based n-D topology with beta involutions | formal model for index-array topology |
| [Ondsel blog, "The toponaming problem is history"](https://www.ondsel.com/blog/toponaming-problem-is-history/) | blog, 2023-2024 | historical | how realthunder's patches were migrated into FreeCAD 1.0 | source of the "negligible cost" claim (HEARSAY) |
| [FreeCAD wiki: Topological naming problem](https://wiki.freecad.org/Topological_naming_problem) | docs, 2015-2024 | maintained; CC0 | user-facing symptoms and workarounds | test scenarios |
| [Farjana, Han, Mun 2016](https://doi.org/10.1016/j.jcde.2016.01.001) | paper, 2016 | historical; open access | persistent IDs recorded with history for parametric exchange | exchange-oriented variant of P1 |
| [Safdar, Han, Kwon, Song 2019/2020](https://doi.org/10.14733/cadaps.2020.274-287) | paper, 2019 | historical; open | point-oriented persistent identification for exchange | coordinate-based naming, subordinate to lineage (4.2 item 1) |
| [Dobos & Steed 2012, 3D Diff](https://doi.org/10.1145/2407746.2407766) | paper, 2012 | historical; ACM | interactive mesh diff with conflict resolution | diff UI patterns for P7 |
| [Pointer-CAD (arXiv 2603.04337)](https://arxiv.org/abs/2603.04337) | paper + code, 2026 | new; repo unlicensed | LLM CAD generation referencing edges/faces by pointers into the current model | LLM-facing reference design next to P6 |
| [CadQuery string selectors](https://cadquery.readthedocs.io/en/latest/selectors.html) | docs, 2016-2026 | active; Apache-2.0 | `>Z`, `\|X`, `%CIRCLE` geometric selectors | the silent-retarget anti-pattern (geometric selectors re-resolve on each run) |
| [Baumgart 1975, winged edge](https://doi.org/10.1145/1499949.1500071) | paper, 1975 | historical | origin of winged edge and early Euler-style operators | container background |
| [Masuda 1993](https://doi.org/10.1016/0010-4485(93)90097-8) | paper, 1993 | historical; Elsevier | cell-complex non-manifold Booleans, merge-then-select | keeps all cells, a model for provenance-preserving Booleans |
| [Stroud 2006, Boundary Representation Modelling Techniques](https://doi.org/10.1007/978-1-84628-616-2) | book, 2006 | historical; Springer | practitioner book on B-rep structures, Euler ops, Booleans, features | reference book |
| [Chen & Hoffmann 1995, On editability of feature-based design](https://doi.org/10.1016/0010-4485(95)00013-5) | paper, 1995 | historical; Elsevier | editability needs references that survive re-evaluation | companion to Capoyleas; edit matching not read |

### 7.2 Related deep-read notes that belong to other chapters

| note | what this chapter uses from it |
|---|---|
| [FreeCAD topological naming: realthunder's element map](sources/freecad-topological-naming-realthunder-s-element-map-algorit.md) | 1.0 release date and "mitigation" wording; issue list (#14129, #27546, #22482, #17554, #17776, #32126, #26084); random duplicate suffix; 27 open / 52 closed issues |
| [Fornjot final experiment](sources/fornjot-final-experiment-experiments-2025-12-03-plus-experim.md) | append-only typed stores, half-edge sibling invariant, 0BSD |
| [Fornjot shutdown post](sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md) | shutdown date and the 2-3 year estimate |
| [BREP.io](sources/brep-io.md) | labelled-mesh topology, normative face-naming spec, unreported nudges and cleanup |
| [Manifold](sources/manifold-elalish-manifold.md) | per-triangle `originalID`/`faceID`; #1834 round-trip lesson |
| [Overview of Parasolid V35](sources/overview-of-parasolid-v35-july-2022.md) | attribute classes on split, merge and transfer (one line) |
| [Parasolid XT format reference V35](sources/parasolid-xt-format-reference-v35-intersection-curve-chart-t.md) | fins: two per solid edge, clockwise order, dummy fins |
| [truck](sources/truck-ricosjp-truck-rust-b-rep-kernel-truck-shapeops-boolean.md) | pointer-based topology; wonky's port replaced grid welding with exact vertex IDs |
| [Mäntylä 1986](sources/m-ntyl-1986-boolean-operations-of-2-manifolds-through-vertex.md) | half-edge Boolean background for the container layer |
| [mesh-booleans.md](mesh-booleans.md) chapter, P3 | corefine → recover provenance records that P1 and P5 build on |
