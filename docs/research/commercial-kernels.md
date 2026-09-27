# Commercial kernels: Parasolid, ACIS, CGM, Granite, ShapeManager, C3D and others

Chapter of the wonky research knowledge base, 2026-09-24. English.

**Status and method.**

- **Deep reads.** This chapter rests on the 12 deep-read source notes of this
  topic (section 2). All of them were re-read in full for this chapter.
  Related notes that belong to other chapters are cross-linked, not
  re-summarized:
  [XT intersection curve](sources/parasolid-xt-format-reference-v35-intersection-curve-chart-t.md),
  [PK checking chapter](sources/parasolid-pk-body-check-and-the-model-checking-chapter-q-sol.md),
  [ACIS check levels (Arizona mirror)](sources/acis-api-check-entity-and-checking-levels-univ-of-arizona-mi.md),
  [ACIS blending](sources/acis-blending-documentation-r17-technical-articles-r10-blnd-.md),
  [Parasolid v12 edge blending](sources/parasolid-v12-functional-description-edge-blending-chapters-.md),
  [FS std library mirror](sources/onshape-featurescript-std-library-mirror-opfillet-opchamfer-.md),
  [Onshape architecture](sources/onshape-architecture-microversions-compare-branching-merging.md)
  and the second
  [Jackson note](sources/jackson-1995-boundary-representation-modelling-with-local-to.md).
- **Publish-first step.** Six notes of this topic existed only as Codex JSON
  in `tmp/research/notes/`. Their `markdown` fields were written verbatim to
  `docs/research/sources/`: the two Autodesk patents, Stroud, the Spatial
  threading blog, the Parasolid v39 blog and Braid. Their Markdown rendered
  correctly; nothing had to be fixed.
- **Checked against wonky's own state (DOCUMENTED, local files):**
  - [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §1-§9: decision,
    pipeline, step status on 2026-09-24;
  - [../proto-recover.md](../proto-recover.md): certificates, the
    "not certified" list, carrier unification at 2^-44·scale;
  - [../entscheidungen.md](../entscheidungen.md): items 8 (declared
    tangency), 10 (no silent tolerance growth, report the needed tolerance),
    12, 18, 21 and 23 (khana checks);
  - [../fillet.md](../fillet.md) §3.3 and §5.2, and
    [../fillet/commercial.md](../fillet/commercial.md), which already covers
    commercial fillets (overflow types, blended-edge records, fillet
    patents). This chapter does not repeat that material;
  - source files: `src/parser.mjs` (the FeatureScript version header is
    parsed), `src/index.mjs:53` (it is stored as `source.version` and
    selects nothing), `src/analytic.mjs` (import vertex tolerances of
    0.0003 mm with a 0.01 mm budget; the zero-height rule at line 209 cites
    std `TOLERANCE.zeroLength`), `src/boolean.mjs` (input verdicts
    `InvalidInput`, `InvalidTopology`, `SourceTolerance`).
- **Metadata.** `gh api` on 2026-09-24 for `nkallen/plasticity` and
  `KittyCAD/modeling-app`; HTTP status checks for every catalog URL in
  section 7 on the same day.
- **No builds, no test runs.** A CPU benchmark is running on this machine.
- **Sibling chapters.** Their proposals are not repeated here. Where a
  commercial source strengthens one of them, section 5.9 says so:
  [brep-booleans-ssi.md](brep-booleans-ssi.md) (P1-P9, among them the XT
  chart curve P8 and corefine → recover provenance P9),
  [oss-brep-kernels.md](oss-brep-kernels.md) (R1-R10, among them the field
  failure corpus R3 and the validator R6),
  [testing-validation.md](testing-validation.md) (P1-P10, among them the
  typed checker P3 and the Hausdorff compare P4),
  [fringe-kernels.md](fringe-kernels.md) (F1-F7, among them stable failure
  codes F4), [topology-identity-data-structures.md](topology-identity-data-structures.md),
  [mesh-booleans.md](mesh-booleans.md), [robust-numerics.md](robust-numerics.md),
  [parallel-gpu-geometry.md](parallel-gpu-geometry.md),
  [fdm-geometry.md](fdm-geometry.md).

**Labels.**

- **DOCUMENTED:** a primary source, linked here or in the linked note.
- **MEASURED:** a wonky run, reported in a linked wonky document.
- **INFERRED:** my reasoning from that evidence.
- **HEARSAY:** secondhand, or a catalog entry that was not deep-read.

**Corrections to the scout's landscape overview.** Found while re-reading the
notes and wonky's own documents.

1. **The Boolean bake-off is no longer running.** Judge round 2 decided it on
   2026-09-23: production is corefine (the tagged mesh Boolean) plus recover
   (exact B-rep recovery from the tags). Steps 1-4 of the plan are
   committed; step 7 made the hybrid the default last arm of
   `src/boolean.mjs` (uncommitted, R20 gate). The *fillet* bake-off is the
   one that runs now: A1 and C1 are finished, A2 and C2 were interrupted
   (DOCUMENTED, [hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §8-§9,
   development record.md). The
   proposals in section 5 therefore plug into plan steps 6 and 8-13 and into
   the fillet bake-off.
2. **Parallelism is shallow, but not "only the face-face clash".** Parasolid
   V35 lists SMP for face-level checking, the face-face clash of Booleans,
   wireframe, hidden line, closest approach, body-level faceting, mass
   properties, spline creation and isoclines (ov.pdf §17.2.3). The Spatial
   blog reports *single-body* faceting at about 2x on six threads, so "ACIS
   parallelizes only across bodies" is wrong too. What holds: no vendor
   documents parallel topological assembly (DOCUMENTED, Parasolid overview
   and Spatial notes).
3. **The Zoo SSI patent is granted, not pending.** US 12,229,885 B1, filed
   2024-05-13, granted 2025-02-18, anticipated expiry 2044-05-13. Zoo
   rewrote its SSI around March 2026; whether the new one still uses the
   claimed method is not public (DOCUMENTED, Zoo note).
4. **The Autodesk patents are not "the same shape" as wonky's hybrid.**
   US11886165B2 stores a *set of input-solid identifiers per mesh vertex*,
   not a source-face tag per triangle. A triangle is incident only if all
   three vertices are, and then gets the *union* of their sets. The patent
   keeps exact input solids and fits new organic surfaces to the rest; it
   does not recover an analytic B-rep from a mesh Boolean. US11016470B2 is
   boundary-constrained spline fitting, and its method claim 1 is not
   limited to generative design (DOCUMENTED, both patent notes). The shared
   idea is provenance-guided coexistence of mesh and exact geometry, which
   marks terrain to review, not a precedent for wonky's algorithm
   (INFERRED, not legal advice).
5. **Parasolid v39 does not disclose "mesh decides topology".** It exposes
   bidirectional mesh/B-rep correspondence queries, mesh Euler edits and
   preservation choices during mesh Booleans. It validates correspondence
   contracts, not wonky's pipeline (DOCUMENTED, v39 note).
6. **"Wonky must honour ~1e-5 mm semantics" needs two numbers, not one.**
   FeatureScript std `TOLERANCE.zeroLength` is 1e-8 m = 1e-5 mm, but
   `booleanDefaultTolerance` is 1e-5 m = 0.01 mm and is used for tolerant
   edge matching (DOCUMENTED, std 2960 `math.fs`, `boolean.fs`). wonky
   today unifies planes only within 2^-44·scale (about 2e-12 mm at 32 mm),
   bounds contacts at 1e-7 mm, and admits import vertex tolerances of
   0.0003 mm up to a 0.01 mm budget (DOCUMENTED,
   [proto-recover.md](../proto-recover.md), `src/analytic.mjs`). F32x2 can
   *represent* Parasolid's resolution with room to spare. The open question
   is where wonky and Onshape *decide* differently. A real 2e-11 mm skin
   over a sealed void is a feature for wonky (proto-recover, fix of
   2026-09-24); Parasolid's session precision would merge it (INFERRED).
   Section 5 turns this into an explicit, recorded tolerance ledger rather
   than a global epsilon.
7. **Stroud was read only in part.** The note covers the public back matter
   (appendices A, D, E, F, G), not chapters 1-16. **Braid 1975 was
   unreachable** (ACM 403); only the abstract is verified.
8. **Onshape's "Under the Hood" engineering posts** (Ilya Baran et al.) were
   not reached in this batch either. They remain a follow-up.

## 1. Landscape

### 1.1 The shape of the field

Commercial solid-modelling kernels are one family tree plus a few sovereign
offshoots. Every one of them is closed, f64-based C or C++, and sold under a
royalty licence.

| kernel | owner, users | public technical depth | evidence level |
|---|---|---|---|
| **Parasolid** | Siemens (UGS until 2007). NX, Solid Edge, SolidWorks, Onshape, Plasticity since 2022, many others | the richest: V35 Overview, XT Format Reference, PK header pages, Functional Description chapters, all on the unofficial q-solid mirror; release blogs up to v39 (2026-08-25) | DOCUMENTED (notes); the user list is partly HEARSAY (catalog) |
| **ACIS** | Spatial, a Dassault company since 2000 | R17 user-guide articles (Booleans, Checker, Intersectors, Tolerances, Blending) on mirrors; Spatial blogs | DOCUMENTED (notes) |
| **ShapeManager** | Autodesk, forked from ACIS 7.0 in November 2001. Inventor, AutoCAD, Fusion | no technical documents found | HEARSAY (catalog) |
| **CGM** | Dassault, CATIA V5 and 3DEXPERIENCE; sold through Spatial | marketing pages; one Spatial blog on multi-process face-face intersection | DOCUMENTED for the blog, otherwise HEARSAY |
| **Granite** | PTC Creo, sold for interoperability | a marketing sheet | HEARSAY (catalog) |
| **C3D** | C3D Labs / ASCON, Russia | vendor blog; Plasticity's frozen N-API bindings | HEARSAY (catalog) |
| **RGK** | Russian state project (Top Systems, LEDAS, STANKIN), 2011-2013 | reached a "full-featured" release, then silence | HEARSAY (catalog) |
| **Overdrive, AMCAX** | ZWSOFT (ZW3D) and AMCAX, China | product pages | HEARSAY (catalog) |
| **SMLib** | NVIDIA since 2022, formerly Solid Modeling Solutions | the manual is public; the only kernel ever sold as C++ source, now "limited to legacy customers" | HEARSAY (catalog) |
| **D-Cubed DCM** | Siemens; the constraint solver next to Parasolid in Onshape | Owen 1991 (unread) | HEARSAY (catalog) |
| **Zoo engine** | Zoo (KittyCAD); closed engine, MIT app | a research article, a granted patent, a public issue tracker | DOCUMENTED (note) |

Zoo is not a classic licensable kernel, but it is the only commercial B-rep
engine of 2025-2026 that publishes its SSI approach *and* lets anyone read
its failure tracker. That makes it the most useful commercial source for
failure cases (DOCUMENTED, Zoo note).

Three properties hold across the deep-read sources:

1. **Nobody uses exact arithmetic or symbolic perturbation.** Robustness
   comes from a bounded world box and a fixed resolution, local tolerances,
   heavy checkers, retries and roll-back (DOCUMENTED, Parasolid overview
   §3.6, §3.7.3, §15.3; ACIS Booleans and Tolerance Variables).
2. **The public documents describe contracts, not algorithms.** They give
   stage lists, option sets, fault enums and precision numbers. They never
   give face classification rules, coincidence handling or blend
   construction (DOCUMENTED by absence in every note).
3. **The documents that do exist mostly live on unofficial mirrors.** Their
   legal status is unclear. Treat them as study material to re-derive from;
   copy no names, tables or headers (INFERRED; every note repeats this).

### 1.2 Lineages

- **Cambridge to everything.** Braid's BUILD work at the Cambridge CAD Group
  (CACM 1975: primitives, transforms, addition and subtraction; DOCUMENTED
  abstract only) led to Shape Data's Romulus (1978), then Parasolid (1989)
  and ACIS (Three-Space, 1989). ShapeManager forked from ACIS in 2001
  (HEARSAY, catalog). Stroud's acknowledgements document his own time at the
  Cambridge CAD Group (1977-1980) and the Cranfield BUILD group (1986-1989),
  so his book is a first-hand account of that lineage (DOCUMENTED, Stroud
  back matter p. 607). Jackson wrote his 1995 paper from the "Parasolid
  Business Unit, EDS Unigraphics, Cambridge, UK" (DOCUMENTED, paper header).
- **Ideas, not code, flow between kernels.**

  | idea | first public source | where it shipped | wonky counterpart today |
  |---|---|---|---|
  | tolerances on topology, exact geometry | Jackson SMA'95 | Parasolid ("intrinsic", V35 §3.6.1); XT null edge curve plus fin SP-curves | recover's per-edge `dev`/`bound`, vertex Newton residual ≤ 1e-7 mm, the `unified` record; import vertex tolerances in `src/analytic.mjs` |
  | four-stage Boolean with an intersection graph | ACIS R17 Booleans | ACIS; Parasolid's "Boolean tools" (imprint, divide, remove, fuse) | corefine decides, recover lifts; the graph is implicit |
  | caller-declared coincidence | ACIS glue, Parasolid matched regions | both | declared tangency approved for fillet candidate B (entscheidungen item 8), not built |
  | cost-tiered, versioned checker with stable IDs | ACIS R14-R17 checker | ACIS; PK_BODY_check states | named refusals `BCert`/`BNo` with reason strings |
  | algorithm versions pinned for replay | ACIS `r14_checks` | FS std (1,967 version constants), Zoo KCL `legacyMethod` | header parsed, recorded, unused |
  | mixed mesh/exact bodies | Parasolid facet bodies (Overview V35 ch. 8) | Parasolid Convergent Modeling, v39 mesh Euler ops | CertifiedMesh bodies (plan step 8, whole body) |
  | exact procedural intersection curve | Parasolid XT §5.2.1.5 | Parasolid | recover refuses space quartics; brep-booleans P8 proposes the chart |
  | uniform GPU SSI seeding | Zoo 2025 article, US 12,229,885 B1 | Zoo engine | none (Metal measured slower than 18 CPU threads for every current kernel) |

- **Kernel switching is rare and painful.** SolidWorks started on ACIS and
  shipped on Parasolid; Solid Edge and Bentley moved to Parasolid in the late
  1990s; Plasticity moved from C3D to Parasolid in 2022 for sanctions
  reasons (HEARSAY, catalog: Weisberg, the HN thread, Kallen's talk). The
  open Plasticity frontend with generated C3D bindings has had no commit
  since 2023-10-20 (DOCUMENTED, `gh api`). Every FeatureScript program is
  therefore written against Parasolid's behaviour, including its tolerances
  and its blend defaults (INFERRED; the fault-code correspondence is in
  [../fillet/commercial.md](../fillet/commercial.md)).

### 1.3 Trends, 2024 to 2026

1. **Convergent mesh plus B-rep.** Parasolid has facet bodies and mixed
   facet/classic bodies (Convergent Modeling, V35 ch. 8; introduced over
   v29-v33 according to the scout, HEARSAY). v39
   (2026-08-25) adds mesh Euler operations, bidirectional mesh/B-rep
   topology queries, preservation choices during mesh Booleans, and fitting
   from mesh vertices alone. Autodesk holds granted patents on mesh-to-B-rep
   conversion (US11016470B2, 2021; US11886165B2, 2024) (DOCUMENTED).
2. **One public GPU bet.** Zoo evaluates surfaces on grids, filters sample
   pairs by distance, refines by level of detail, skeletonizes in uv and fits
   a B-spline. The method is patented; the promised NURBS-on-GPU paper is
   still unpublished (checked 2026-09-24) (DOCUMENTED, Zoo note).
3. **Algorithm generations pinned to language versions.** FS std gates
   behaviour with `isAtVersionOrLater(...)`; Zoo deprecated `legacyMethod`
   in KCL 2.0 (May 2026) and removed it in KCL 3.0 (issues closed in August
   and September 2026), with fillet `version` 1 and 2 alongside (DOCUMENTED, ACIS checker and Zoo
   notes).
4. **Concurrency stays locked.** v39 still speaks of "appropriately locked
   application threads"; the V35 SMP cap is 8 threads, and whether it still
   holds is not stated (DOCUMENTED, v39 and overview notes).
5. **Sovereign kernels and data access instead of new modellers.** Russian
   and Chinese kernels exist for political reasons. The Open Design
   Alliance's 2026 roadmap plans to read CGM, ACIS and Parasolid data through
   one API and to integrate third-party kernels rather than write a general
   Boolean modeller (HEARSAY, catalog).

### 1.4 What is conspicuously missing

- **Boolean internals.** No vendor publishes face classification rules,
  coincident or tangent handling, or degenerate vertex cases. The most
  detailed text is still Jackson's two pages on imprint (DOCUMENTED by
  absence).
- **Blend construction.** Only the XT blend surface definitions and the
  behavioural blending chapters are public; see
  [../fillet/commercial.md](../fillet/commercial.md).
- **Numbers behind robustness.** No vendor gives predicate error bounds, a
  proof, a failure rate or a benchmark. Spatial's "70% fixed in one prepare
  pass" is uncited (HEARSAY, scout).
- **A failure corpus.** No vendor publishes failing Booleans. Zoo's public
  tracker is the only commercial one, and Stroud's appendix G is the only
  first-hand historical record (DOCUMENTED, Zoo and Stroud notes).
- **Determinism.** Parasolid documents that SMP changes result body order,
  target-tag inheritance and checker fault order. No vendor promises
  bit-identical results across thread counts; ACIS calls parallel faceting
  "nearly indistinguishable" (DOCUMENTED).
- **Exact or GPU-resident numerics.** None disclosed anywhere.
- **Documents for CGM, Granite, post-fork ShapeManager and D-Cubed
  internals.** Not found. Owen 1991 was not read.
- **Onshape's own engineering posts.** Not reached (correction 8).

### 1.5 Licensing and patent map (wonky is private and unlicensed)

| source | status | what wonky may do |
|---|---|---|
| Parasolid, ACIS documentation on q-solid and Arizona mirrors | proprietary, unofficial mirrors | study, re-derive under wonky names; copy no enums, headers, tables or API names |
| Parasolid XT format | called a documented format in the Overview (Ch. 12); the reference itself sits on an unofficial mirror and Siemens does not link it publicly (scout) | a reader or writer is feasible in principle (INFERRED; open question Q6) |
| Jackson 1995, Braid 1975, Owen 1991 | ACM copyright, no code | re-implement the published ideas |
| Stroud 2006 | Springer copyright | re-implement ideas; do not paste pseudocode, tables or figures |
| FS std library mirror | MIT | the contract to reproduce, including `TOLERANCE` |
| Zoo article, KCL docs | MIT (`KittyCAD/documentation`, `modeling-app`) | quote and adapt freely |
| **US 12,229,885 B1** (Zoo) | granted, active to about 2044 | claim 16 covers "points of surface A closer than a threshold to surface B". Form SSI points by exact triangle intersection, sign-change bracketing or closed forms, never by a sample distance threshold (INFERRED, not legal advice) |
| **US11886165B2** (Autodesk) | granted, active, adjusted expiry 2040-08-09 | dependent claims cover distance incidence (5), partition repair (7), boundary pull (10), cellular composition (12), gap filling (14). Keep face-level provenance and analytic trims; do not build distance-based reassignment, pulling or gap filling |
| **US11016470B2** (Autodesk) | granted, active; claim 1 not limited to generative design | review before any boundary-first, frozen-control spline fit of meshes to CAD curves |
| US10102331B2 (Siemens) | granted 2018, active | catalog only, unread: Boolean region participants by body type and convexity |
| fillet patents (Siemens, Geomagic) | see [../fillet/commercial.md](../fillet/commercial.md) | as listed there |

### 1.6 Where wonky sits (INFERRED from the notes and wonky's documents)

| property | commercial kernels | wonky today |
|---|---|---|
| representation precision | f64; Parasolid resolution 1e-8 m in a 1e3 m box (ratio 1e11); ACIS resabs 1e-6 in a 1e4 box | F32x2 (about 2^-48 relative, 3.6e-15) plus multi-limb exact predicates; exporter coordinate limit at 1e3-1e5 mm (plan step 9) |
| decisions near coincidence | tolerance merges within session precision; tolerant entities grow on demand | exact predicates, unification only within 2^-44·scale, named refusals, clearance certificate |
| tolerance policy | implicit growth (Jackson, Parasolid `set_tol` default yes, ACIS fuzz ignored when inconvenient) | "no silent tolerance growth, report the needed tolerance" (entscheidungen item 10); the "needed" number is not yet emitted by the Boolean |
| determinism | not guaranteed under SMP (Parasolid) | byte-identical across JS, cpu1, cpu18 and Metal on 38 corpus and 216 adversarial cases (MEASURED, plan §9) |
| parallelism | at most 8 threads, face-level work, locks | fork-join everywhere; cpu1/cpu18 geo-mean 1.46 for corefine; Metal 2.40x slower than cpu18 (MEASURED, plan §1, §6) |
| failure contract | checker fault codes with witness positions; "failures on defective input are not bugs" | named refusals in two classes (`BCert`, `BNo`) with prose reasons |
| coverage | decades ahead: NURBS, blends, offsets, healing, sheet and non-manifold bodies | planes, cylinders, cones, spheres, tori; general curved Booleans through the hybrid (32/38 corpus exact); no fillets yet |

The gap in coverage is enormous and will stay so. wonky's credible
differentiators against this field are exactness of decisions, determinism,
explicit budgets and introspection. The commercial documents show exactly
where the incumbents are weak on those four points, and they supply
contracts wonky can adopt without adopting their tolerance model.

## 2. Comparison table

Verdicts: *adopt* (take as is), *adapt* (take with changes), *learn-from*
(study, take ideas), *unreachable* (not readable). Links go to the deep-read
notes.

| name | kind | status | license | verdict | key idea | note |
|---|---|---|---|---|---|---|
| Jackson, "Boundary representation modelling with local tolerances" (SMA'95) | paper | historical; still Parasolid's shipped model (V35) | ACM ©, no code | adapt | tolerances live on topology (vertex spheres, edge tubes); imprint in dimension order V-V → V-E → E-E → V-F → E-F → F-F so SSI skips known contacts; validity = "within the sum of tolerances" | [note](sources/jackson-boundary-representation-modelling-with-local-toleran.md) |
| ACIS R17 "Booleans" article | vendor docs (mirror) | R17, about 2007; ACIS still sold | proprietary docs | adapt | four stages around an explicit intersection graph with provenance; glue, fuzz, partial and cellular (SBOOL) Booleans | [note](sources/acis-r17-user-guide-booleans-technical-article.md) |
| Overview of Parasolid V35 (July 2022) | vendor manual (mirror) | V35; v39 current | proprietary docs | learn-from | 1e-8 in a 1e3 box; consistency guaranteed only for global Booleans; matched regions; clash taxonomy; 8-thread SMP with documented non-determinism and a shuffle debug switch; mixed facet/exact bodies | [note](sources/overview-of-parasolid-v35-july-2022.md) |
| Parasolid PK reference: `PK_BODY_check` states and faults | vendor API docs (mirror) | shipping interface | proprietary docs | adapt | flat fault enum by entity class; record `{state, entity_1, entity_2?, position?}`; gated check groups; "checker failure is not invalidity"; verdict marks versioned by checker | [note](sources/parasolid-pk-reference-pk-body-check-states-and-fault-types.md) |
| ACIS R17 "Checker" and "Intersectors" articles | vendor docs (mirror) | R17; R14-R17 versioning history | proprietary docs | adapt | cost-ordered check levels 10-70; stable integer IDs; the checker never fails and reports skipped tests; versioned checks for replay; CCI/CSI/SSI/CCS intersector families | [note](sources/acis-r17-checker-and-intersectors-articles.md) |
| Zoo "CAD Engine Overview": GPU SSI | vendor article + patent + issue tracker | article 2025-05-20; SSI rewritten about March 2026 | article MIT; engine closed; US 12,229,885 B1 granted | learn-from | uniform grid sampling and LOD culling on the GPU, then an uncertified uv skeleton and B-spline fit; a public tracker full of coplanar, coaxial and order-dependent failures | [note](sources/zoo-kittycad-cad-engine-overview-gpu-surface-surface-interse.md) |
| Autodesk US11886165B2: generative design to watertight B-rep | patent | granted 2024-01-30, active | patent | learn-from | per-vertex input-solid incidence sets; monotone partition repair; boundary pulled into solids, contact topology checked, then cellular composition | [note](sources/autodesk-us11886165b2-generative-design-to-editable-watertig.md) |
| Stroud, *Boundary Representation Modelling Techniques* | book (back matter read) | 2006, historical | Springer © | adapt | typed intersection results (points, curves, oriented and partial coincidence); `pla_cyl_int` case split; candid BUILD/GPM Boolean failures | [note](sources/stroud-boundary-representation-modelling-techniques-springer.md) |
| Autodesk US11016470B2: mesh geometry to watertight B-rep | patent | granted 2021-05-25, active | patent | learn-from | transfinite displacement patches; fit the boundary tightly, freeze it, then fit the interior loosely; separate boundary and interior error budgets | [note](sources/autodesk-us11016470b2-mesh-geometry-to-watertight-b-rep.md) |
| Spatial, "Seven Years of Thread Safe 3D ACIS Modeler" | vendor blog | 2016 | vendor article | adapt | thread safety = disjoint data plus separate history streams; one-body faceting 2x on 6 threads, many bodies 6-7x; measure workloads separately | [note](sources/spatial-blog-seven-years-of-thread-safe-3d-acis-modeler.md) |
| Siemens, "Parasolid v39.0" release | vendor blog | 2026-08-25 | vendor article | adapt | bidirectional mesh/B-rep correspondence, mesh Euler edits, preservation policy in mesh Booleans, required edge positions in faceting | [note](sources/siemens-blog-parasolid-v39-0-release.md) |
| Braid, "The synthesis of solids bounded by many faces" (CACM 1975) | paper | historical | ACM © | unreachable | primitives, transforms, addition and subtraction; two addition algorithms (abstract only) | [note](sources/braid-the-synthesis-of-solids-bounded-by-many-faces-cacm.md) |

## 3. State of the art: best techniques, their real guarantees, where they break

### 3.1 The precision model: a fixed box and a resolution

**Technique.** Every commercial kernel fixes a world box and a linear
resolution, and treats anything closer than the resolution as coincident.

| system | linear resolution | box or range | other constants | source |
|---|---|---|---|---|
| Parasolid | 1e-8 (m) | 1e3 (ratio 1e11) | angular 1e-11; non-tolerant ("accurate") entities have half the session precision | DOCUMENTED, ov.pdf §3.6, §3.6.1 |
| ACIS R17 | `SPAresabs` 1e-6 model units | 1e4 (`SPAresnor` 1e-10) | `SPAresfit` 1e-3 (fits of procedural geometry), `SPAresmch` 1e-11; "at least an order of magnitude guard band" | DOCUMENTED, ACIS Tolerance Variables article |
| Onshape FS std 2960 | `zeroLength` 1e-8 m | | `zeroAngle` 1e-11, `booleanDefaultTolerance` 1e-5 m, `computational` 1e-13, `g1Angle` 0.1° | DOCUMENTED, `math.fs` lines 35-42 |
| Zoo KCL | CSG/fillet `tolerance` default 1e-7 mm | | | DOCUMENTED, `std-solid-subtract.md` |
| wonky | contact bound 1e-7 mm; plane unification 2^-44·scale; recover carrier classes 1e-7 mm / 1e-10 | exporter limit at 1e3-1e5 mm | import vertex tolerance 0.0003 mm, budget 0.01 mm; zero-height sweep at 1e-5 mm | DOCUMENTED, proto-recover, `src/analytic.mjs` |

**Real guarantee.** None stated formally. ACIS gives the only rationale: a
1e4 box with 1e-6 features needs 1e-10 relative resolution, plus one decade
of slack. Parasolid's claim that 1e11 is "an order of magnitude more accurate
than that of any other kernel modeler" is marketing (DOCUMENTED, notes).

**Where it breaks.**

- The box is a validity rule. Parasolid reports `TOPOL size_box` for
  geometry outside 1000 units (DOCUMENTED, PK note).
- Coincidence by resolution is not coincidence by intent. Parasolid's own
  overview admits that inferring matched regions for "slightly mis-aligned"
  geometry "cannot always be guaranteed, leading to slow performance or
  failed boolean operations" (DOCUMENTED, ov.pdf line 1617).
- Onshape's constants leak into FeatureScript code. std's
  `filterOverlappingEdges` switches from exact point containment to a
  1e-5 m tolerant radius behind `V607_HOLE_FEATURE_FIT_UPDATE` (DOCUMENTED,
  std mirror, via the ACIS checker note). A FeatureScript program that works
  in Onshape may rely on a merge that wonky refuses (INFERRED).

**Bend mapping (INFERRED).** F32x2 gives about 2^-48 relative, 3.6e-15. At
1 m that is about 3.6e-15 m, roughly seven orders below Parasolid's 1e-8 m
resolution; at 100 mm the F32x2 ulp is about 4.5e-13 mm. Representation is
not the problem. Plain F32 (ulp about 7.6e-6 mm at 100 mm) is below
Onshape's `zeroLength` of 1e-5 mm only by a factor of about 1.3, so F32 alone
can cull and seed but cannot decide at FeatureScript resolution. Decisions
belong to exact multi-limb predicates or to F32x2 values with a derived error
bound compared against a stated tolerance.

### 3.2 Tolerant modelling: tolerances on topology, exact geometry

**Technique** (DOCUMENTED, Jackson note; XT V35 §4.3.8-4.3.10).

- A vertex tolerance is a sphere; a tolerant edge has no 3D curve, only one
  pcurve per adjacent face, and its tube is centred on one fixed pcurve.
  Faces have a thickness that Parasolid kept at the default.
- Monotonic rule: vertex tolerance ≥ edge tolerance ≥ face tolerance.
- Validity: two entities intersect if they come within the sum of their
  tolerances; every connected component of an edge-tube or face-region
  intersection must contain, or contract onto, a common vertex or edge.
- Operations that cannot proceed raise the local tolerance and compress
  redundant topology.
- XT encodes a tolerant edge as a null curve plus fin SP-curves; a
  null-double tolerance means "accurate" (half the resolution). Parasolid
  later added optional *nominal geometry*: an accurate curve inside the
  tolerance pipe (ov.pdf §3.6.2), and the checker grew `*_nmnl` fault twins
  for it.
- ACIS reaches the same place through the Boolean fuzz: pairs coincident
  within the fuzz but not within `resabs` are forced coincident by
  "minimal" tolerant entities (DOCUMENTED, ACIS Booleans note).
- Parasolid applies tolerant modelling to imports: foreign B-reps have "gaps
  and overlaps along every edge", so edges and vertices get the foreign
  resolution while faces keep the designer's intent (DOCUMENTED, ov.pdf line
  4149).

**Real guarantee.** Structural only: the model stays a valid tolerant B-rep
because tolerances grow. No bound on the growth. Jackson says containment is
"not always achievable" (§7.3) and recursive compression is incomplete
(§7.2) (DOCUMENTED).

**Where it breaks.** Tolerance creep, and tolerances that end up far larger
than the geometric error the user expects (INFERRED). ACIS may *ignore* the
fuzz "if forcing coincidence would result in the creation of bad geometry"
(DOCUMENTED): a silent behaviour change. Parasolid's blend tolerance grows by
default up to 1e-5 m per blend (`set_tol` default yes; DOCUMENTED in
[../fillet/commercial.md](../fillet/commercial.md)).

**wonky's position.** recover already writes Jackson tolerances in all but
name: per-edge `dev` and `bound`, Newton vertex residuals up to 1e-7 mm, the
`unified <classes> <tolerance>` record, and a clearance certificate that
applies Jackson's base rule as a *refusal* rather than a merge (DOCUMENTED,
proto-recover). What is missing is Jackson's rules 2-3 for *adjacent*
entities (proposal C4) and a machine-readable "needed tolerance" on every
tolerance-driven refusal (proposal C1).

### 3.3 Boolean pipelines

| | Jackson (Parasolid 1995) | ACIS R17 | Parasolid V35 | wonky hybrid |
|---|---|---|---|---|
| stages | imprint → join → select | intersection graph → imprint → keep/discard → join and regroup | imprint → divide into face sets → remove → fuse ("Boolean tools") | CSG layer → tagged tessellation → pre-certificate → corefine → recover |
| decision order | by dimension, reusing lower decisions | not documented | not documented | symbolic perturbation inside corefine; curves from carriers in recover |
| multiple tools | not covered | SBOOL: non-regular cellular unite, then select cells | tools united first, "treating them as a single body" | CSG layer flattens unions (subtract spine A − ∪B) |
| coincidence | sum-of-tolerances test | fuzz, glue | matched regions, tolerant modelling | exact unification within 2^-44·scale, else named refusal |
| intermediate artefact | correspondence list | intersection graph: disjoint wires, per-face coedges with sense, degenerate point-contact edges, provenance attributes | not documented | tagged mesh; curve assignment implicit in recover's runs |

**Real guarantee.** Parasolid gives the only explicit one: global Booleans
compare all face pairs and "the resulting body is guaranteed to be
topologically consistent". Local Booleans, local operations and local checks
all carry "not guaranteed" caveats (DOCUMENTED, ov.pdf §4.2, §5, §3.7.3).
ACIS regularization "resolves many modeling tangency issues"; nothing more
(DOCUMENTED).

**Where it breaks.** Misaligned coincident regions (Parasolid); wrong or
incomplete glue lists give "undefined" results (ACIS); open-shell Booleans
work only when the shell extends past the other body on all sides (ACIS)
(DOCUMENTED). Stroud's first-hand notes add ring joins that fail when
intersection rings share edges, and intersection curves that enter a face
without a detectable exit after a tolerance failure (DOCUMENTED, Stroud
appendix G).

### 3.4 Known-coincidence fast paths: glue, matched regions, partial Booleans

**Technique** (DOCUMENTED, ACIS Booleans and Parasolid overview notes).

- **ACIS glue**: the caller supplies all coincident face pairs; SSI is
  skipped. Timings on one twisted-sweep example: 12.046 s standard,
  3.328 s glue, 1.469 s with three extra asserted facts
  (`patch_and_face_cover`, `single_face_patch`, `non_trivial`).
- **ACIS partial Booleans**: stage 1 takes an explicit array of face pairs
  (the example passes the full cross product); `api_update_intersection`
  attaches known curves so SSI is skipped for that pair.
- **Parasolid matched regions**: the caller declares intended coincident
  faces and edges, because inference on misaligned data is unreliable.
- **Parasolid local Booleans**: caller-chosen face sets, "can drastically
  improve performance", no consistency guarantee.

**Real guarantee.** None: correctness moves to the caller. ACIS says it
outright: "It is essential that this information is accurate and complete,
otherwise the results are undefined."

**wonky's position.** The FeatureScript evaluator knows many coincidences by
construction (same sketch plane, same offset expression), and fillet
candidate B needs *declared tangency* between tool and support faces, which
the product owner approved (entscheidungen item 8; [../fillet.md](../fillet.md)
§5.2). What the commercial kernels lack, and wonky can add, is exact
verification of every declaration with an explicit failure (proposal C3).

### 3.5 Surface-surface intersection and its representation

**Techniques** (DOCUMENTED, notes as named).

- **ACIS intersector families**: CCI (points or intervals within
  tolerance), CSI (including singular surfaces), SSI (singular surfaces,
  silhouettes, "help points" to explore implicit pairs, offset-surface
  intersections for blend spines), CCS (curve/curve on a surface via the
  pcurves, purely for speed). Intersectors are "virtual methods of Booleans";
  direct calls give "unpredictable results".
- **Analytic dispatch** (Stroud appendix D): results typed as point, curve,
  same- or reverse-orientation coincidence, partial coincidence;
  `pla_cyl_int` splits into zero, one or two generators when the plane is
  parallel to the axis, else a circle or ellipse. Stroud warns that marching
  a general cylinder/cylinder intersection can jump branches near tangency
  (Fig. D.11).
- **Parasolid XT exact procedural intersection curve** (§5.2.1.5): two
  surfaces, an ordered chart of points with uv on both surfaces, tangents and
  parameters, chordal and angular error, start and end limits of type help,
  terminator or limit, a C1 parameterisation, and evaluation by intersecting
  both surfaces with the plane through the interpolated chord point,
  orthogonal to the chord. The curve is exact; the chart is the seed.
- **Zoo GPU SSI**: grid sampling, all-pairs distance filter against ε, LOD
  (40 x 40 coarse plus 20 x 20 local, about 800 x 800 effective), uv band
  rasterization, medial-axis thinning, branch detection by adjacency row
  sums, a convolution-smoothed walk, a cubic B-spline fit in the reference
  surface's uv.

**Real guarantee.** None anywhere. XT's chordal error is an estimate. Zoo's
fitted curve lies exactly on one surface only, and the patent's fallback is
to "adjust the threshold for sensitivity", a silent tolerance growth
(DOCUMENTED).

**Where it breaks.** Near tangency, everywhere: marching jumps branches
(Stroud), sampled bands widen and skeletons become arbitrary (Zoo, INFERRED
from the pipeline), small closed loops fall between samples (INFERRED). Zoo's
tracker shows the consequence on easy analytic cases: a coaxial cone/cylinder
intersect fails (#10621) although the intersection is a circle (DOCUMENTED).

**wonky's position.** recover takes every curve from its two carriers, never
from the polyline, and refuses space quartics, spiric sections and plane/cone
hyperbolas and parabolas by name (DOCUMENTED, proto-recover). The XT chart
as recover's general fallback is already proposed as
[brep-booleans-ssi.md](brep-booleans-ssi.md) P8, with a certified chord bound
instead of XT's estimate. This chapter adds two inputs to P8 (section 5.9):
seed the chart from corefine's exact triangle intersections, and keep every
distance test a verifier, never a point generator, because of claim 16.

### 3.6 Validity checking

**Technique** (DOCUMENTED, PK and ACIS checker notes).

- **Parasolid**: check groups run in sequence, cheapest first, and a group
  runs only if the previous groups passed. Options select groups and levels
  (`geom` no/basic/lazy/full/yes, `top_geo` no/edge/face/yes, binary
  toggles for B-geometry, face-face, size box, self-intersection, loops,
  shells, corruption). `max_faults` defaults to 10; 0 is fail-fast. Faults
  are `{state, entity_1, entity_2?, position?}` with a per-state table of
  populated fields; `position` is a witness point in the faulty region.
  Verdicts are cached as marks on geometry, and `lazy`/`full`/`yes` decide
  how far to trust marks from older checkers (XT persists
  `SCH_checked_ok_in_old_version`).
- **ACIS**: levels 10-70 ordered by *cost*, not severity, with one
  exception (self-intersection at level 30 because it is common). Severities
  ERROR, WARNING, NOTE, INFO; stable integer IDs ("use IDs, not message
  strings"; misspelled IDs frozen). The checker "is expected not to fail",
  reports skipped tests (`NO_SLIVER_FACE_TEST`), its own failures
  (`FF_INT_FAIL`, `ACIS_ERROR`) and repairs (`SLIVER_FACE_REMOVED`). Level
  70 holds the face-face checks: improper intersection, coincidence,
  containment. "Defective" means ERROR problems at the highest level, and
  "Spatial does not normally view the failure of the operation to be a bug"
  on defective input.

**Real guarantee.** Explicitly none on completeness. Parasolid: "does not
guarantee to return all the faults"; omitted groups can mislead later ones;
"checker failures ... should not be taken to indicate that the body is
invalid"; local checks can miss pre-existing invalidity. ACIS: an old-version
pass "is not 'valid' for that version".

**Where it breaks.** With SMP, the order of Parasolid's faults varies, so
together with `max_faults` *which* faults a broken body reports can vary
between runs (INFERRED from §114.2.5).

**wonky's position.** The typed checker is proposed in
[testing-validation.md](testing-validation.md) P3 and
[oss-brep-kernels.md](oss-brep-kernels.md) R6, and stable failure codes in
[fringe-kernels.md](fringe-kernels.md) F4. Section 5.9 lists what the
commercial checkers add to those proposals.

### 3.7 Algorithm and checker versioning

**Technique** (DOCUMENTED, ACIS checker, Zoo and Parasolid overview notes).

- ACIS versions its checks since R14 for history replay. `r14_checks` went
  from opt-in (R14, R15) to default (R16) to mandatory (R17).
- Parasolid XT is forward compatible back to V1 data and, since V14,
  backward compatible "to at least the next major version" (§12.3).
  Persisted checker marks carry their checker generation.
- FS std defines 1,967 version constants and gates behaviour with
  `isAtVersionOrLater(context, ...)`; `fillet.fs` alone has 6 gates. A std
  comment records the failure of doing otherwise: "BEL-110102 in rel-1.99
  use of operations change was released without versioning. It causes
  missing parts in section views held back to versions earlier than
  V1017_SUBTRACT_COMPLEMENT."
- Zoo pins SSI generations to KCL versions (`legacyMethod`, removed in KCL
  3.0) and exposes fillet `version` 1 and 2.

**Real guarantee.** Replay of old documents with old behaviour, as long as
every behaviour change is gated. Nothing enforces the gating except review
(INFERRED from BEL-110102).

**wonky's position.** The parser reads `FeatureScript 3044;` and
`src/index.mjs` stores it as `source.version`; no algorithm is selected by it
(DOCUMENTED). Meanwhile wonky's own constants move fast: the unification
tolerance went from 2^-40 to 2^-44 on 2026-09-24 because it merged a real
1e-11 mm skin, which changes results (DOCUMENTED, proto-recover). Proposal
C2.

### 3.8 Parallelism

**Technique** (DOCUMENTED, Parasolid overview and Spatial notes).

- **Parasolid SMP**: at most 8 threads, 1 per core by default. Parallel in
  face-level checking, the face-face clash of Booleans, wireframe, hidden
  line, closest approach, body-level faceting, mass properties, spline
  creation and isoclines. "Not expected to be linear"; isolated calls can be
  slower; two threads can need twice the workspace. Application threads go
  through a queue of concurrent, exclusive and locally exclusive functions
  with partitions locked to threads.
- **Parasolid determinism**: with SMP, multi-body Boolean results come back
  in no guaranteed order, *which* result body inherits the target's tag is
  not guaranteed, and checker fault order varies.
  `PK_DEBUG_shuffle_start/stop` deliberately permutes returned orders so
  applications can test their own robustness.
- **ACIS**: thread safety through thread-local storage; every thread must
  initialize ACIS; modified entities must sit in different history streams.
  Single-body faceting about 2x on six threads, many bodies 6-7x,
  redesigned stitching 10% faster *serially*. CGM runs its Boolean
  face-face intersections multi-process.
- **Zoo**: uniform GPU sampling for SSI seeding (Vulkan); no timings
  published.

**Real guarantee.** ACIS: parallel faceting output "nearly
indistinguishable", not bitwise equal. Parasolid: none on order or identity.

**wonky's position (MEASURED, plan §1, §6, §9).** Byte-identical output on
JS, cpu1, cpu18 and Metal for the corpus and all adversarial suites.
corefine's cpu1/cpu18 geo-mean speed-up is 1.46 over cases of at least
20 ms; Metal is 2.40x slower than cpu18 for corefine. Parallel face-pair work
is where commercial kernels find their gains too; wonky can match them
without locks and beat them on determinism (INFERRED). Scheduling proposals
live in [parallel-gpu-geometry.md](parallel-gpu-geometry.md) P1-P3.

### 3.9 Convergent modelling: mesh and exact geometry together

**Technique** (DOCUMENTED, notes as named).

- **Parasolid facet bodies** carry Parasolid topology over mesh geometry;
  Booleans, sections and offsets run on them directly. **Mixed bodies** hold
  "an arbitrary mix of facet and classic geometries" in one body, stated for
  adding precise machined holes to scans and restoring mating surfaces on
  facet-optimized models (V35 §8.1). v39 adds mesh Euler edits,
  bidirectional mesh/B-rep topology queries, preservation choices when "a
  topology deformation is needed for watertight results", fitting from mesh
  vertices alone, and exact positions along edges that faceting must respect.
- **Autodesk US11886165B2**: incidence sets per vertex (from a level set,
  a volumetric mesh, or a signed-distance fallback within the solver
  accuracy d); partition repair that grows the organic region until the
  boundary is manifold (worst case: everything organic); boundary control
  points pulled into the solids until F ≤ ξ < 0; contact curves checked to be
  homeomorphic to the originals, with ξ doubled on failure; composition by
  oriented-sheet Booleans or a cellular decomposition that reports
  contradictory orientation evidence.
- **Autodesk US11016470B2**: transfinite displacement patches to meet
  prescribed CAD curves; boundary fitted tightly and frozen, interior fitted
  loosely (5 x 5 quadrature, 9 x 9 error samples); tolerance ξ between 10ε and
  1000ε of the kernel resolution ε, interior δ often 10-1000 ξ; 34,532
  patches in 42 minutes on unspecified hardware.

**Real guarantee.** None certified. Autodesk's interior error is sampled, not
bounded; its unconstrained L2 option has "unbounded" initial boundary
distance; near-coincident SSI "may be incorrect" (DOCUMENTED). Parasolid v39
publishes no residual bounds (DOCUMENTED by absence).

**wonky's position.** CertifiedMesh bodies are planned per *whole body*
(plan step 8), carrying the operation's tessellation deviation as a
per-vertex certificate after the step-2 pre-certificate (DOCUMENTED, plan
§2.3). recover's tags are per triangle and per source face, which is a
stronger contract than Autodesk's per-vertex solid sets (INFERRED). Proposal
C7 takes Parasolid's mixed body as the next step.

### 3.10 What is actually guaranteed, in one table

| technique | vendor wording | what is actually guaranteed | wonky counterpart |
|---|---|---|---|
| fixed resolution box | "accuracy ratio 1e11" | coincidence below resolution; nothing about intent | F32x2 plus exact predicates; tolerances stated per decision |
| tolerant modelling | "intrinsic", "allow operations to succeed" | structural validity; unbounded growth | recorded budgets; refusal with the needed tolerance (C1) |
| global Boolean | "guaranteed topologically consistent" | consistency, not geometric correctness | corefine gate + recover certificates; wrong `ok` 18 → 3 on the suites (MEASURED) |
| local/partial Boolean, glue, matched regions | "can drastically improve performance" | none; "undefined" on wrong input | declared contacts, verified exactly (C3) |
| checker | full check at the end, roll back | no completeness; checker failure ≠ invalidity | typed checker (testing P3) with an undecided state |
| checker versioning | versioned checks | replay if every change is gated | version vector keyed to the FS header (C2) |
| SMP | "not expected to be linear" | no order or tag stability | byte-identical across targets (MEASURED); shuffle test (C6) |
| GPU SSI (Zoo) | "parallelizable root-finding" | none; heuristic, patented | corefine triangles as seeds, F32x2 Newton, exact existence decisions (brep P8) |
| mesh → B-rep (Autodesk) | "watertight", "editable" | watertight under tolerant sewing; sampled error | exact recovery or CertifiedMesh with a per-vertex certificate |

## 4. War stories and anti-patterns

### 4.1 Silent tolerance growth

- Jackson: growth "should be contained" but this is "not always achievable"
  (§7.3) (DOCUMENTED).
- ACIS: the fuzz "may be ignored if forcing coincidence would result in the
  creation of bad geometry" (DOCUMENTED).
- Parasolid blends: `set_tol` default yes, "Apply a tolerance to the blend
  if this would make the blend succeed", up to 1e-5 m (DOCUMENTED,
  [../fillet/commercial.md](../fillet/commercial.md)). Some of Marc's Onshape
  fillets may succeed only because of it (INFERRED there).
- Zoo patent: if no pair is under the threshold, "the threshold may be
  adjusted for greater sensitivity" (DOCUMENTED).
- Autodesk US11886165B2: if the contact topology check fails, double |ξ| and
  pull again (DOCUMENTED).

Five vendors, five silent growths. wonky's rule (entscheidungen item 10) is
the opposite, and the numbers these algorithms compute on the way are
exactly the "needed tolerance" wonky should report.

### 4.2 Hints that make results undefined

ACIS glue with an incomplete pair list gives "undefined" results; partial
Booleans move all responsibility to the caller; intersectors called directly
give "unpredictable results" (DOCUMENTED). A kernel that accepts hints must
verify them or fail.

### 4.3 Coincidence, coaxiality and touching

- Parasolid: slightly misaligned coincident regions give "slow performance or
  failed boolean operations" (DOCUMENTED).
- Zoo #7485 (open): coplanar union fails. The CEO: "this the coplanar bug,
  when things are perfectly aligned on the same [plane] csg will fail". An
  FDM user's workaround: skip the union and let the slicer merge the bodies
  (DOCUMENTED).
- Zoo #10621 (open): intersect of two coaxial revolved solids (cone and
  cylinder faces) fails, "our recent SSI push didn't solve this one"
  (DOCUMENTED).
- Zoo #11068 (open): four tangentially meeting swept tubes with coincident
  end caps fail to union; staff had the in-app LLM rewrite the model as one
  sweep (DOCUMENTED).
- Zoo #12578 (open): a flat 3 mm plate, 150 x 70 mm with holes and a
  trapezoid notch, fails at the final subtract of a Ø16 cable notch. That is
  exactly wonky's part class (DOCUMENTED).

### 4.4 Topology from noisy coordinates

Zoo #12429 (closed): a 2 mm fillet on a box edge works at size 20 and fails
at 18, 19, 21 and 22. Root cause: "a bug detecting when surfaces were planar
or not", triggered by sketch-solver start positions that did not match the
solved positions (DOCUMENTED). Planarity must come from provenance or from an
exact predicate, never from a float epsilon on solver output (INFERRED).

### 4.5 Order dependence and non-determinism

- Zoo #13438 (open): two box subtractions succeed in one order and fail in
  the other (DOCUMENTED).
- Parasolid SMP: multi-body result order and target-tag inheritance vary;
  checker fault order varies; the vendor ships a shuffle switch so that
  *applications* can survive this (DOCUMENTED). An Onshape FeatureScript
  program that relies on "the first result body" after a split relies on
  unspecified behaviour (INFERRED).
- Stroud: whole-edge convexity cannot be inferred from the endpoints (an
  elliptical cylinder/cylinder edge can be smooth at both ends and convex in
  the middle; Fig. E.9); a point-in-face ray on a periodic face can wrap
  without crossing any boundary (Fig. E.6) (DOCUMENTED). Both are
  order-of-evaluation traps.

### 4.6 Unversioned algorithm changes

- FS std BEL-110102: an operation change "released without versioning"
  broke section views of held-back documents (DOCUMENTED).
- Zoo #13200 (open): adding only `kclVersion = 2.0` to a sample's header
  makes its four-edge 5 mm fillet fail ("Edge cut failed"); the sample was
  dropped from the migration (DOCUMENTED).
- Zoo #10710: the new SSI changed several test outcomes; one sample "should
  never have worked" (DOCUMENTED).
- ACIS `r14_checks`: newly mandatory checks declared existing customer parts
  defective (DOCUMENTED).

### 4.7 Prose as the failure contract

Zoo #13709 (closed "not planned" 2026-09-23): the oversize-fillet regression
test snapshots the full message "The Zoo engine cannot handle this 3D
subtraction yet. / Edge cut failed", and the maintainers keep prose snapshots
on purpose (DOCUMENTED). ACIS's rule is the opposite: use integer IDs, never
message strings, and freeze IDs even when misspelled (`SURF_SEFL_INT`,
`TRANSF_BAD_DETERMINENT`) (DOCUMENTED).

### 4.8 Checkers that lie by omission

Local checks miss pre-existing invalidity; omitted groups mislead later
groups; `max_faults` truncates; an old-version pass is not validity; a
checker failure is not invalidity (DOCUMENTED, PK and ACIS notes). Every one
of these is a way for "no faults reported" to mean less than "valid".

### 4.9 Historical implementation failures (Stroud appendix G, first-hand)

- A tolerance failure produced an intersection curve that enters a face with
  no detectable exit (Fig. G.1).
- Joining whole intersection rings broke when rings shared edges; the
  replacement edge-pair join was only partly implemented and never
  benchmarked (Figs. G.2-G.7).
- Full-circle sweep accumulation broke exact face gluing; swept faces
  self-intersected next to smaller adjacent faces (G.2, Fig. G.8).
- The GPM Boolean in FORTRAN IV lacked edge and vertex lists; its
  replacement joining code was never finished (DOCUMENTED, all Stroud back
  matter pp. 751-757).

### 4.10 Parallelism that costs more than it gives

Parasolid: isolated calls "slightly slower with SMP", twice the workspace
with two threads, and swapping then makes SMP slower than one thread. ACIS:
some APIs show overhead that grows with the thread count; a serial redesign
of stitching gained 10% without any threads (DOCUMENTED). wonky measured the
same lesson on Metal: device start-up and per-pass costs outweigh small,
divergent kernels (MEASURED, plan §6).

### 4.11 Kernel switching

SolidWorks moved from ACIS to Parasolid before shipping; Plasticity moved
from C3D to Parasolid in 2022 and left its open C3D binding layer frozen
(HEARSAY for the history, DOCUMENTED for the frozen repository). The cost of
switching is why wonky's rule "never link another kernel as a backend"
protects more than purity: a backend would become a dependency that can only
be replaced by a rewrite (INFERRED).

### 4.12 Anti-pattern → wonky rule

| anti-pattern | seen in | wonky rule |
|---|---|---|
| tolerance grows until the operation succeeds | Jackson, ACIS fuzz, Parasolid `set_tol`, Zoo, Autodesk | grow only within a recorded budget; refuse with the needed tolerance (C1) |
| caller hints trusted without checking | ACIS glue, partial Booleans | verify every declaration exactly; a false one is a named refusal (C3) |
| planarity or coincidence from float epsilons | Zoo #12429 | provenance first, exact predicate second |
| results depend on evaluation order | Zoo #13438, Parasolid SMP | sort every parallel output by stable ids; shuffle test (C6) |
| behaviour change without a version gate | BEL-110102, Zoo #13200 | version vector per operation, golden hashes per version (C2) |
| prose failure snapshots | Zoo #13709 | stable codes with fields (fringe F4) |
| "no faults" read as "valid" | PK, ACIS caveats | explicit undecided and skipped states (testing P3) |
| a sample-distance threshold forms intersection points | Zoo US 12,229,885 B1 | exact triangle intersection or sign-change bracketing; distance only verifies (C8) |
| a whole body downgraded because one patch is unrecoverable | none (Parasolid avoids it with mixed bodies) | mixed exact/facet bodies (C7) |

## 5. What wonky should take: ranked proposals

**Context.** The Boolean architecture is decided (corefine plus recover);
steps 1-4 of the plan are done, step 7 made the hybrid the default last arm,
and steps 6 and 8-13 are open. The fillet bake-off runs with candidates A to
D, and B needs declared tangency (approved, entscheidungen item 8). The
commercial kernels offer no algorithm wonky can port. What they offer are
*contracts* that have survived decades of customer data: how tolerances are
declared and reported, how caller knowledge enters a Boolean, how behaviour is
versioned, how clashes are classified, how exact and approximate geometry
coexist in one body. Each proposal below adapts one such contract to wonky's
rules: exact decisions, explicit budgets, no silent growth, byte-identical
results.

**Ranking.** By expected benefit per unit of risk for the path that exists
today: first the cheap contracts the product decisions already demand (C1,
C2), then the known-coincidence path that unblocks fillet candidate B (C3),
then a certificate gap (C4), then new outputs (C5), test infrastructure (C6),
a representation change (C7) and legal hygiene (C8). All Bend-fit statements
are INFERRED.

| rank | proposal | plugs into | size | depends on |
|---|---|---|---|---|
| C1 | tolerance ledger: every tolerance decision recorded, every tolerance refusal names the needed tolerance, FeatureScript resolution as a reported reference | `kernel/hybrid/unify.bend`, recover's clearance and corner certificates, pre-certificate [C], `src/boolean.mjs` `operationEvidence`, `src/analytic.mjs`, fillet refusals | S-M | none; extends fringe F4 |
| C2 | algorithm version vector keyed to the FeatureScript header | `src/index.mjs` (`source.version`), job wire format header, `operationEvidence`, golden tests | S | none |
| C3 | declared contacts: one mechanism for glue, matched regions and declared tangency, verified exactly | plan step 6 encoder, job wire format, pre-certificate [C], recover carrier classes, fillet candidate B | M | step 6; C1 for its failure records |
| C4 | Jackson's adjacent-entity rule in recover's clearance certificate | `kernel/hybrid/recover` `clear.bend` | S | none |
| C5 | clash taxonomy and an explicit intersection graph for compare and interference | plan step 13, khana checks (entscheidungen 12, 18, 23), viewer diff | M | coordinate with testing P4 and fringe F7 |
| C6 | determinism as a tested invariant: an internal shuffle mode | plan step 6 encoder, sort points in corefine and recover, multi-body result order in `src/boolean.mjs` | S-M | step 6 |
| C7 | tolerant edges instead of whole-body CertifiedMesh | plan step 8, recover `BNo` curve refusals, body format, identity, print mesh | M | C1; overlaps step 9 |
| C8 | patent-terrain guardrails at SSI and mesh-fitting sites | plan step 9 acceptance, `clear.bend`, future seeding code, docs | S | none |

### C1. A tolerance ledger, with the needed tolerance on every tolerance refusal

**Idea.** Five commercial mechanisms grow tolerances silently until an
operation succeeds (section 4.1). Each of them computes, on the way, the one
number wonky's product decision asks for: the tolerance that *would* have
made the operation succeed (entscheidungen item 10, "stattdessen die nötige
Toleranz melden"; ACIS even names it "the minimum tolerance necessary to
enforce coincidence"). wonky makes that number an output instead of an
action.

1. **One record per tolerance decision**, emitted by every site that compares
   a computed distance with a stated tolerance:
   `Tol{site, a, b, measured, err, limit, decision}`.
   - `site`: plane unification, carrier class, contact bound, clearance
     certificate, pre-certificate, corner residual, curve bound, import
     vertex, zero-length sweep;
   - `a`, `b`: U32 tags or entity ids;
   - `measured`: the F32x2 distance or angle; `err`: its derived error bound;
   - `limit`: the tolerance applied; `decision`: merge, keep apart, refuse.
2. **Every tolerance-driven refusal names two needed numbers.**
   - `needed.merge = measured + err`: the contact budget under which the two
     entities would count as one (Jackson's "within the sum of tolerances");
   - `needed.deviation`: the tessellation deviation below which the mesh
     could keep them apart, which is exactly the input that local refinement
     needs ([oss-brep-kernels.md](oss-brep-kernels.md) R7,
     [brep-booleans-ssi.md](brep-booleans-ssi.md) P6).
3. **FeatureScript resolution as a reported reference, not an epsilon.**
   Every record also states where `measured` falls relative to std's
   `zeroLength` (1e-5 mm) and `booleanDefaultTolerance` (0.01 mm). A result
   that contains an edge shorter than `zeroLength`, or two patches of one
   face class closer than it, gets a `belowFeatureScriptResolution` entry:
   Onshape would almost certainly not have produced that topology (INFERRED,
   to be checked by Q1).
4. **An opt-in contact budget.** `modelingPolicy.contactBudgetMm`, default the
   current strict values. Raising it (at most to `zeroLength`) lets
   unification and contact decisions merge within the budget, and every use
   is a `Tol` record with `decision: merge`. Nothing grows beyond the budget;
   exceeding it is a refusal with `needed.merge`.

**Where it plugs in.** `kernel/hybrid/unify.bend` (the 2^-44·scale rule),
recover's `clear.bend` refusal, corner and curve certificates, the
pre-certificate [C] (`tangent.bend`), `src/analytic.mjs` (import vertex
tolerances), `src/boolean.mjs` `operationEvidence`, `src/errors.mjs`. The
record is the `tolerance_violation` payload of fringe F4's code registry.
The fillet bake-off needs the same record for its "needed tolerance" refusals
(entscheidungen item 10), so both should share it.

**Bend fit.** Records of U32 ids, F32x2 distances and F32 limits; every site
already computes `measured`. One extra field per comparison, collected by the
same fork-join map and sorted by (site, a, b) before output. `err` needs a
derived bound per site: for plane offsets it follows from the F32x2 rounding
analysis already used for 2^-44·scale; for Newton corners the residual is the
bound.

**Expected benefit.**

- Refusals become actionable. An LLM or Marc can move a face by the stated
  amount, raise the budget knowingly, or ask for finer tessellation.
- Closes decision item 10 for Booleans, not only for fillets.
- Gives a measured calibration between wonky's strict decisions and
  Onshape's, instead of guesses (feeds Q1).
- The ledger doubles as the per-operation tolerance evidence that Jackson's
  model keeps on entities.

**Risks.**

- A sloppy `err` makes "needed" wrong. Every site needs its bound derived,
  not guessed; sites without a derivation report `err: unknown` rather than
  a number.
- The opt-in budget can reintroduce the 1e-11 mm skin bug (a real skin
  merged). It must stay opt-in, never a default, and every merge is visible.
- Output size: ledger records only for decisions within 1000x of their limit
  keep it small.

**First acceptance test.**

1. The sealed-void 2e-11 mm skin case (`test/proto-recover.test.mjs`) still
   refuses; the refusal now carries `needed.merge` within 2e-11 mm ± `err`
   and a `needed.deviation`, byte-identical on JS, cpu1, cpu18 and Metal.
2. A FeatureScript fixture: a block unioned with a second block rotated 17°
   about z, whose top is offset by δ ∈ {0, 1e-9, 1e-7, 5e-6, 2e-5} mm. Each
   run is exact, or exact with a `belowFeatureScriptResolution` entry, or a
   refusal naming `needed.merge ≈ δ`. With `contactBudgetMm = 1e-5` the
   0 < δ ≤ 5e-6 mm cases build with one `merge` record each and δ = 2e-5 mm is
   unchanged.
3. The same FeatureScript runs in Onshape through the session bridge, and its
   face counts become the oracle for which δ Onshape merges.

### C2. An algorithm version vector keyed to the FeatureScript header

**Idea.** ACIS versions its checks for replay, FS std gates behaviour with
1,967 version constants, Zoo pins SSI and fillet generations to KCL versions,
and each learned it by breaking customer documents (BEL-110102, Zoo #13200,
ACIS `r14_checks`). wonky's constants move daily: the unification tolerance
went from 2^-40 to 2^-44 on 2026-09-24 and changed results. wonky parses the
header (`FeatureScript 3044;`) and stores it, but selects nothing with it.

1. Every operation records a version vector:
   `{tessellation, corefine, unify, recover, certificates, checker, fillet}`,
   each a U32, in `operationEvidence`, in `brep.json` and in the job header
   of the canonical wire format.
2. One table maps FeatureScript header ranges to a version vector. It starts
   with a single row (every header maps to the current vector).
3. A golden test stores, per corpus and R20 case, the vector and a hash of
   the canonical output. An output change without a version bump fails the
   test and names the cases. A bump either keeps the old variant selectable
   for old headers or records the break explicitly in the table.
4. A header outside the table is a named refusal, not a guess.

**Where it plugs in.** `src/index.mjs` (`source.version` exists),
`src/boolean.mjs` evidence, the job header of `kernel/hybrid` (the canonical
text wire already makes outputs hashable), `test/`.

**Bend fit.** Data only. The version is a U32 in the job header; a variant is
selected once per job, not per element, so work stays uniform.

**Expected benefit.** Reproducible regeneration of Marc's pinned documents;
every behavioural change becomes visible in review; a cheap guard for a
kernel whose tolerances and certificates are still being tuned.

**Risks.** Keeping old variants alive costs code; the policy "flag the break
instead of keeping the variant" must be allowed, or the table becomes a
museum. Hash-based goldens need canonical output everywhere (already true for
the hybrid wire format, not yet for every `src/` path).

**First acceptance test.** Change the unification constant from 2^-44 to
2^-43 without a bump: the golden test fails and lists exactly the cases whose
canonical output changed. With the bump it passes, and the r10b and R20
fixtures (header 3044) report the vector in their evidence.

### C3. Declared contacts: glue, matched regions and declared tangency as one verified mechanism

**Idea.** ACIS glue and partial Booleans and Parasolid matched regions let
the caller state coincidences so that the kernel does not have to infer them
from misaligned numbers; both vendors leave wrong declarations "undefined".
wonky has two sources of such knowledge and one approved use:

- the FeatureScript evaluator knows coincidences by construction: two
  extrudes from one sketch plane, faces offset by the same expression, a
  pattern instance and its seed;
- fillet candidate B builds tools whose faces share carriers with the support
  faces and whose contact curves are known exactly
  ([../fillet.md](../fillet.md) §5.2; approved, entscheidungen item 8).

The proposal:

1. An optional `declared` section in the job:
   `(tagA, tagB, relation, curve?)` with relation ∈ {same carrier,
   opposite-oriented same carrier, tangent along a curve, abutting}.
2. Every declaration is verified exactly before use: carrier equality on the
   face-table values with multi-limb predicates, tangency from the carrier
   parameters (a cylinder of radius r tangent to a plane at distance r from
   its axis, with parallel axis). A declaration that does not hold is a
   named refusal with the measured distance (a C1 record), never
   "undefined".
3. A verified declaration replaces inference for that pair: the
   pre-certificate accepts the declared tangency instead of refusing it,
   recover puts the two tags into one carrier class or takes the declared
   curve, and the ledger records `declared` instead of `unified`.
4. Unlike ACIS glue, completeness is not required: undeclared pairs go
   through the normal path.

**Where it plugs in.** The plan step 6 encoder (JS; the evaluator emits the
pairs), the job wire format, the pre-certificate [C], recover's carrier
classes and `unify.bend`, fillet candidate B.

**Bend fit.** A flat array of declarations; one exact predicate per entry, a
uniform map; the rest is a lookup in maps that already exist.

**Expected benefit.**

- FeatureScript's intended coincidences become exact by construction,
  independent of how a rigid transform rounded (the 2^-44 unification then
  stays a fallback, not the only route).
- Unblocks fillet candidate B, which otherwise "refuses almost every fillet"
  at stage [C] ([../fillet.md](../fillet.md) §5.2).
- The ACIS glue timings (12.0 → 3.3 → 1.5 s) suggest a speed gain when many
  faces coincide (DOCUMENTED there; not measured for wonky).

**Risks.**

- The evaluator has to track construction provenance (which faces share a
  sketch-plane expression); that is new interpreter work.
- Rotated copies are equal by construction but not numerically; "same
  carrier" must be declared as *the same carrier record*, not re-derived.
- corefine and recover belong to other workflows right now (fillet.md
  names this risk).

**First acceptance test.**

1. The encoder test: two extrudes from one sketch plane, unioned, produce one
   `same carrier` declaration.
2. The 14 rotated coplanar cases (exact today through unification) run with
   unification disabled and declarations on: canonical outputs identical
   except the evidence, which says `declared`.
3. A false declaration (a plane offset by 1e-9 mm) is a named refusal with
   `measured ≈ 1e-9 mm` on all four targets.
4. For candidate B: a 90° planar edge of length L = 20 mm filleted with
   r = 2 mm through a declared-tangent tool gives exact STEP and a removed
   volume of L·r²·(1 − π/4) within 1e-12 relative.

### C4. Jackson's adjacent-entity rule in recover's clearance certificate

**Idea.** recover's clearance certificate refuses non-adjacent patches that
come within h + h' + 1e-6 mm. Pairs that share a mesh vertex are skipped, and
proto-recover lists "clearance between adjacent patches away from their
common edge" as not certified. The pre-certificate has the matching blind
spot: "a tool that crosses a target's tessellation in one place and grazes it
elsewhere passes" (DOCUMENTED, proto-recover). Jackson's validity rules 2 and
3 state the missing condition: every connected component of the near set of
two entities must contain, or contract onto, their common vertex or edge.

1. Stop skipping adjacent pairs in the `clear.bend` join. For a near triangle
   pair (distance ≤ h + h' + 1e-6 mm) of two adjacent patches, accept it
   cheaply if both closest points lie within r(θ) of the shared edge, where θ
   is the smallest dihedral angle along that edge and
   r(θ) = (h + h' + 1e-6 mm) / (2 sin(θ/2)) plus a margin (two half-planes at
   angle θ are 2 s sin(θ/2) apart at distance s from their common line).
2. The remaining near pairs form components under triangle adjacency. A
   component that contains no triangle incident to the shared edge or vertex
   is a refusal: "adjacent patches approach away from their common edge",
   with the distance, both tags and a witness point.

**Where it plugs in.** `kernel/hybrid/recover` `clear.bend` and its
"not certified" list in [../proto-recover.md](../proto-recover.md).

**Bend fit.** The same BVH self-join; the filter in step 1 is a fixed-cost
point-to-curve distance per pair. Components use min-label propagation over
the small set of surviving pairs, a few fork-join rounds.

**Expected benefit.** Closes one of recover's listed certificate gaps and the
"crossing plus grazing" blind spot, the regime where mesh Booleans invent or
drop topology below their deviation (plan §2.3).

**Risks.** Knife edges: at small θ, r(θ) grows and the whole strip along the
edge is near. That is still one component containing the edge, so rule 2
accepts it, but the component pass must not be skipped for them. Cost: more
pairs enter the join. False refusals on legitimate acute wedges
(`adv-wedge-sliver-*`) must be ruled out.

**First acceptance test.**

1. Build a case the current code accepts wrongly, for example a torus tool
   whose surface crosses a plate top along one loop and comes within 1e-8 mm
   of it along another region. If the per-run curve certification already
   refuses it, record that and C4 becomes a certificate-completeness change
   with no behaviour change.
2. After the change the case is a named refusal with a witness, on all four
   targets.
3. The 38 corpus cases and the `adv-wedge-sliver-*` cases keep their results
   byte for byte; the clearance join time grows by at most 20% on the
   corpus.

### C5. Clash taxonomy and an explicit intersection graph for compare and interference

**Idea.** Plan step 13 adds `interference(a, b)` and `clearance(a, b)`; the
khana decisions want real collision and distance checks in wonky
(entscheidungen 12, 18, 23). Parasolid's clash taxonomy and ACIS's
intersection graph give the output contract.

1. `clash(a, b)` returns one typed answer:
   - `disjoint` with the certified clearance (plan step 13's two-body
     `clear.bend`);
   - `abutment`: touching with zero volume, split into face, edge and point
     contact, each with the tag pair and a witness;
   - `interference`: volume > 0, with the volume, the components and a
     witness per component;
   - `containment`: one body inside the other without touching;
   - `undecided` with a reason, where corefine refuses (point contacts,
     grazing).
2. The **intersection graph** becomes an explicit artefact between corefine
   and recover, in ACIS's form: disjoint wires; per edge, the exact curve
   record or the named refusal; per-face coedges with sense; degenerate edges
   for point contacts; provenance tags on every element. It gives
   `section(body, plane)` for FDM layers (Parasolid lists AM slicing as a use
   of its offset sections), imprint for debugging, and a diff target for the
   viewer.
3. ACIS's non-regularized conditions define what an abutment result keeps:
   coincident regions stay, double-sided faces stay, no final edge or vertex
   merge.

**Where it plugs in.** Plan step 13, the `kernel/hybrid` entry, the viewer's
diff and review, khana's overlap report.

**Bend fit.** Candidate face pairs are a uniform map; the graph is built from
corefine's tagged intersection segments on the CPU; witnesses are F32x2
points; the answer is a small ADT.

**Expected benefit.** The missing compare/interference output with a
vocabulary users know from commercial CAD; khana's overlap checks move into
wonky; FDM sections fall out of the graph.

**Risks.** Abutment is the tangent and contact regime where corefine refuses
today (plan §5 notes that a face-touching intersect is refused, not returned
empty). The first version must answer `undecided` there rather than guess.
Overlap with [testing-validation.md](testing-validation.md) P4 (Hausdorff
compare) and [fringe-kernels.md](fringe-kernels.md) F7 (multi-root
evaluation): the taxonomy should be the result type those proposals fill.

**First acceptance test.** The plan step 13 fixtures plus four clash cases,
byte-identical on all four targets:

- two overlapping boxes: `interference`, 1500 mm³ exact;
- two boxes sharing a face: `abutment(face)` with the tag pair (today a
  refusal);
- a box inside a box: `containment`;
- boxes 0.5 mm apart: `disjoint`, clearance 0.5 ± the stated deviation.

For a cylinder through a plate, the intersection graph has two circular
wires with coedges on both faces and source tags.

### C6. Determinism as a tested invariant: an internal shuffle mode

**Idea.** Parasolid ships `PK_DEBUG_shuffle_start/stop` so that applications
can survive its non-deterministic SMP output. wonky is deterministic already
(MEASURED, byte-identical across four targets); what it lacks is a test that
internal *unordered* collections cannot leak into results.
[testing-validation.md](testing-validation.md) P1 permutes *inputs* (axis
permutations, operand order); this permutes *internals*.

1. `WONKY_SHUFFLE=<seed>` permutes, before each deterministic sort: candidate
   pair arrays, face-table row order in the job encoder, the order of tools in
   commutative operations, fault and ledger lists, and multi-body results.
2. The assertion: canonical outputs are identical after renumbering by
   provenance, and every face's `sources` are identical.
3. Specify what Parasolid leaves unspecified: the order of result bodies
   after a multi-body Boolean (for example by smallest source tag, then
   volume) and which body keeps the target's identity. FeatureScript queries
   over those results then become deterministic by contract.

**Where it plugs in.** The plan step 6 encoder, corefine and recover sort
points, `src/boolean.mjs` multi-body results, the validator.

**Bend fit.** A seeded permutation is a pure map (sort by hash(seed, id));
no mutation, no extra synchronization.

**Expected benefit.** Catches the Zoo #13438 class (order-dependent Booleans)
before it happens, and protects FeatureScript query order after splits.

**Risks.** Renumbering needs stable ids derived from provenance (the naming
work in [topology-identity-data-structures.md](topology-identity-data-structures.md)
P1-P5); CI time grows with the number of seeds.

**First acceptance test.** Eight seeds over the 38 corpus cases and the four
adversarial suites on JS and cpu18: canonical outputs identical to the
unshuffled run. A deliberately removed sort in one stage is detected by at
least one seed. A two-body split result has the documented body order on
every seed.

### C7. Tolerant edges instead of whole-body CertifiedMesh

**Idea.** When recover refuses because a curve type is missing (space
quartics, two-carrier vertices, hyperbolas), plan step 8 turns the *whole
body* into a certified mesh. Parasolid avoids that with mixed bodies, and
Jackson §6.2 gives the representational slot: approximated geometry is
admissible if its approximation tolerance is attached to the relevant edges.
In wonky's setting every face still has its exact carrier (the tags survive
corefine), and only the boundary curve is unknown in closed form.

1. Keep every face exact (carrier plus trim). Represent only the unrecovered
   edge as a *tolerant edge*: the certified polyline from corefine's tagged
   intersection segments, with tolerance = its certified deviation, and one
   parameter-space polyline per adjacent face.
2. Its end vertices get spheres at least as large as the edge tolerance
   (Jackson's monotonic rule).
3. The body is labelled `exact with tolerant edges`, with each tolerant edge
   listed and its tolerance in the C1 ledger. Face queries (radius, axis,
   normal) stay exact; exact-edge queries on a tolerant edge raise a
   capability error; STEP export refuses by default and names the edge.
4. When plan step 9 lands a closed form or a certified B-spline for that
   curve type, the tolerant edge is simply replaced.

**Where it plugs in.** Plan step 8 (body kinds), recover's `BNo` refusals for
missing curves, the body format and `src/identity.mjs`, the print mesh (the
polyline is the edge landmark both faces use).

**Bend fit.** A per-edge kind tag in immutable edge arrays; the seam check
between a tolerant edge and its faces is Jackson's sewing test (vertex and
edge comparisons within the sum of tolerances), a uniform map.

**Expected benefit.** For FDM parts the faces carry the dimensions that
matter (hole radii, plane positions); they stay exact and queryable even when
one intersection curve is not. Chained operations keep exact carriers, as
they already do.

**Risks.** A new body kind and validity rules; STEP cannot express the
result without a fitted curve, so it still refuses; if plan step 9 closes the
quartics first, C7 matters mostly for curve types without a certified fit
(tori, cones). Topology still rests on corefine's decisions, exactly as for
CertifiedMesh, so the step-2 pre-certificate must pass.

**First acceptance test.** pipe-tee as FeatureScript: the result has the
same face count as OCCT's B-rep, every face on its exact carrier, one or two
tolerant edges with tolerance ≤ the operation deviation, and vertex spheres
at least as large. The radius queries on both cylinders return the exact
values; the volume is within area × deviation of OCCT; the STL passes
`uv run scripts/validate-print-mesh.py`; STEP refuses and names the tolerant
edge and its tolerance.

### C8. Patent-terrain guardrails at SSI and mesh-fitting sites

**Idea.** Three active patents sit next to wonky's next steps (section 1.5).
wonky is private and unlicensed today, but a later public or commercial
release would inherit whatever methods were built now (INFERRED, not legal
advice).

1. A short terrain note outside the research folder (for example
   `docs/patent-terrain.md`), listing per patent the claimed step to avoid
   and the design-around wonky uses:
   - US 12,229,885 B1 (Zoo): form intersection points by exact triangle
     intersection, sign-change bracketing, interval subdivision or closed
     forms; never keep "samples of A closer than a threshold to B" as
     intersection points;
   - US11886165B2 (Autodesk): no distance-based incidence assignment,
     boundary pulling or gap filling;
   - US11016470B2 (Autodesk): review before any boundary-first,
     frozen-control spline fit of meshes to CAD curves;
   - the fillet patents in [../fillet/commercial.md](../fillet/commercial.md).
2. A marker comment at every site that computes distances between sampled
   geometry (`clear.bend` today; P8 chart seeding and any sampled SSI later)
   stating that the result is a verifier, not a point generator.
3. A review item in the plan step 9 acceptance list.

**Where it plugs in.** Docs, `kernel/hybrid/recover/clear.bend`, future SSI
seeding code, plan step 9.

**Bend fit.** Not applicable.

**Expected benefit.** Keeps licensing options open at almost no cost; keeps
the verifier/generator separation visible to future agents.

**Risks.** Not legal advice; over-caution could forbid prior-art methods
(the Zoo patent's own background acknowledges mesh intersection).

**First acceptance test.** A lint in `npm test` finds a terrain marker in
every Bend file that performs sample-to-sample distance tests, and plan step
9's acceptance list contains the review item.

### 5.9 Inputs to sibling proposals (no new proposal)

- **Typed checker** ([testing-validation.md](testing-validation.md) P3,
  [oss-brep-kernels.md](oss-brep-kernels.md) R6):
  - the fault record `{state, entity_1, entity_2?, position?}` as one Bend
    constructor per state, with a per-state field schema and an F32x2
    witness;
  - the checker never fails; `undecided` and `skipped` are states of their
    own (ACIS `NO_SLIVER_FACE_TEST`, PK `check_fail`);
  - cost-ordered tiers, with self-intersection early because it is common;
    fail-fast in production, full lists in tests; `max_faults` applied
    *after* a deterministic sort;
  - verdict caching as a memo keyed by (geometry content hash, checker
    version), never as marks on geometry;
  - report repairs, not only faults: one record per sliver recover absorbs
    (patch, area, the edge it collapsed to) instead of a count
    (ACIS `SLIVER_FACE_REMOVED`);
  - the PK B-curve (4) and B-surface (7) validity rules and the `top_geo`
    G1/periodicity rules as the acceptance spec for future spline geometry;
  - `bad_spcurve` before writing STEP pcurves ([../step-pcurves.md](../step-pcurves.md)).
- **Stable failure codes** ([fringe-kernels.md](fringe-kernels.md) F4): use
  integer or snake_case codes, never messages; freeze codes even when
  misnamed (ACIS); Zoo #13709 shows the prose-snapshot alternative.
- **Field failure corpus** ([oss-brep-kernels.md](oss-brep-kernels.md) R3):
  add the Zoo cases #7485 (coplanar union), #10621 (coaxial cone/cylinder
  intersect), #11068 (tangent swept tubes), #12429 (planarity from solver
  noise; sweep the box size 18-22), #12578 (flat plate cable notch), #13438
  (order-dependent subtract), #9100 and #13200 (fillet on revolve; header
  change) as FeatureScript fixtures, and Stroud's figures G.1-G.3 (missing
  exits, shared-edge rings), D.11 (cylinder branch jump), E.6 (periodic
  point-in-face) and E.9 (convexity along an edge).
- **XT chart curve** ([brep-booleans-ssi.md](brep-booleans-ssi.md) P8):
  seed from corefine's exact triangle intersections (already ordered and
  branched), never from a sample-distance filter (C8); map XT's limit types
  help/terminator/limit and Zoo's branch vocabulary (regular, joint, end,
  boundary end) onto one wonky enum.
- **Provenance and correspondence** ([brep-booleans-ssi.md](brep-booleans-ssi.md)
  P9, [topology-identity-data-structures.md](topology-identity-data-structures.md)
  P1-P2, [fringe-kernels.md](fringe-kernels.md) F3): ACIS puts provenance
  attributes on every intersection-wire entity; Parasolid v39 answers
  correspondence in both directions (mesh → B-rep and back) from one
  relation. Keep wonky's per-triangle, per-source-face tags; Autodesk's
  per-vertex solid sets are the weaker contract.
- **Edge landmarks in tessellation** ([fringe-kernels.md](fringe-kernels.md)
  F2): Parasolid v39 lets applications prescribe exact positions along edges
  that faceting must respect. That is the same contract as F2's canonical
  per-circle sample lattice.
- **Scheduling and native execution**
  ([parallel-gpu-geometry.md](parallel-gpu-geometry.md) P1-P3, plan steps 11
  and 12): measure one-operation latency, many-body throughput and serial
  redesigns as separate benchmark rows (Spatial); expect workspace growth per
  worker (Parasolid); give every forked task an explicit immutable context
  instead of thread-local state.
- **Fillet bake-off** ([../fillet.md](../fillet.md),
  [../fillet/commercial.md](../fillet/commercial.md)): C1's ledger carries
  the "needed tolerance" of a refused blend; C3 is candidate B's declared
  tangency; classify edge convexity along the whole edge, not at its
  endpoints (Stroud Fig. E.9, ACIS `CONVEX_POINT`); Jackson §5 attaches a
  blend's tolerance to the blend's own edges only.

### 5.10 Anti-proposals

- **Do not link or emulate a commercial kernel as a backend**, and do not
  build on Plasticity's frozen C3D bindings. Project rule, and section 4.11.
- **Do not adopt 1e-5 mm as a global epsilon.** It would merge real features
  (the 2e-11 mm skin case) and hide intent. Report against it (C1).
- **Do not copy implicit tolerance growth** from Jackson, the ACIS fuzz,
  Parasolid `set_tol`, Zoo or Autodesk.
- **Do not accept hints without verification** (ACIS glue's "undefined").
- **Do not convert analytic faces to NURBS for uniformity** (Zoo's minimal
  primitive set). Rational circles need weights such as √2/2 that neither
  F32 nor F32x2 represents exactly; bucket face pairs by type instead.
- **Do not implement Zoo's distance-threshold SSI or Autodesk's
  pull-and-fill reconstruction** (C8).
- **Do not parallelize with locks or thread-local state, and do not accept
  scheduling-dependent result order** (Parasolid SMP).
- **Do not copy vendor names, enums or tables** from the mirrored documents.

## 6. Open questions worth a prototype

- **Q1. Where do Onshape and wonky decide differently between 2^-44·scale
  and 1e-5 mm?** A dozen FeatureScript probes through the session bridge
  (offset faces, short edges, near-coaxial cylinders, rotated coplanar
  faces), run in Onshape and in wonky. The result calibrates C1's
  `belowFeatureScriptResolution` rule and decides whether an FS-compat budget
  should exist at all.
- **Q2. How many Booleans in Marc's corpus have coincidences known by
  construction?** Instrument the evaluator to log sketch-plane and
  offset-expression sharing between Boolean operands. If the share is small,
  C3 is mainly a fillet-B enabler; if it is large, it is also the main
  coplanar path.
- **Q3. Does the version vector need living old variants?** Replay the golden
  outputs across the last weeks of commits and count how often an output
  changed. Many changes argue for "flag the break"; few argue for keeping
  variants.
- **Q4. Can corefine return a typed zero-volume contact instead of refusing?**
  C5's `abutment` depends on it. Prototype on face-touching boxes and
  cylinder-on-plane line contact, with exact predicates deciding contact
  dimension.
- **Q5. How much of the Unresolved set would tolerant edges (C7) cover that
  plan step 9 will not?** Count the corpus and R20 refusals by curve type and
  check which have a certified closed form or fit planned.
- **Q6. Is an XT reader worth it?** Onshape can export Parasolid transmit
  files, and the XT format is documented, including tolerant edges and exact
  intersection curves. An XT reader would import Onshape parts with their
  exact curves instead of through STEP. Check the legal status of the
  reference before any work (it is on an unofficial mirror; Siemens does not
  link it publicly).
- **Q7. Is a local Boolean ever needed?** Parasolid guarantees consistency
  only for global Booleans. Measure corefine on Marc's largest models; add a
  local path only if global is too slow, and cross-check it against global.
- **Q8. Follow-up reading.** Onshape's "Under the Hood" engineering posts,
  Stroud chapters 6 (§6.1-§6.4, finding interactions, coincident topology)
  and 14 (verification, healing), Owen 1991, and a legitimate copy of Braid
  1975.

## 7. Catalog of the remaining sources

Not deep-read. "HTTP" is the status of a request on 2026-09-24 with a browser
user agent; it says only that the page was reachable.

| name | kind | year | status | license | one line | priority | HTTP |
|---|---|---|---|---|---|---|---|
| [Siemens US10102331B2: Boolean region participants for arbitrary bodies](https://patents.google.com/patent/US10102331B2/en) | patent | 2018 | active (filed 2012-08-01, granted 2018-10-16) | patent | NX patent: which tool-face regions take part in a Boolean, from body types, spatial relation and relative convexity | 2 | 200 |
| [Owen, "Algebraic solution for geometry from dimensional constraints" (SMA'91)](https://dl.acm.org/doi/10.1145/112515.112573) | paper | 1991 | historical | ACM © | the founding paper of D-Cubed's DCM constraint solver, licensed by Onshape next to Parasolid | 2 | 403 |
| [C3D Labs: "C3D Geometric Kernel: New Features and Development Trends"](https://c3dlabs.com/blog/products/c3d-geometric-kernel-new-features-and-development-trends/) | blog | 2025 | commercial | vendor blog | C3D Modeler lead on parallelization, tolerance controls and triangulation-based diagnostics | 2 | 200 |
| [Plasticity source (nkallen/plasticity)](https://github.com/nkallen/plasticity) | library | 2023 | frozen: last commit 2023-10-20; 3,398 stars; TypeScript; about 37 MB (`gh api`, 2026-09-24) | LICENSE says LGPL-3 and "All rights reserved"; GitHub: NOASSERTION | the open frontend of Plasticity with generated N-API bindings to C3D, frozen after the move to Parasolid | 2 | 200 |
| [Kallen, "What is a Geometry Kernel? C3D vs ACIS vs Parasolid"](https://www.youtube.com/watch?v=WvwiH1DOK1M) | talk | 2022 | historical | YouTube | Plasticity's author on kernels and why he left C3D | 2 | 200 |
| [Spatial CGM Modeler](https://www.spatial.com/solutions/3d-modeling/cgm-modeler) | product | 2012-2026 | commercial | commercial | Dassault's CATIA kernel, sold through Spatial, "tolerant from the start" | 2 | 200 |
| [Autodesk ShapeManager](https://en.wikipedia.org/wiki/ShapeManager) | product | 2001-2026 | commercial | proprietary | Autodesk's ACIS 7.0 fork (November 2001) in Inventor, AutoCAD and Fusion | 2 | 200 |
| [SMLib manual (NVIDIA)](https://docs.nvidia.com/smlib/manual/smlib/index.html) | docs | 2024 | closed to new licensees | commercial source licence | the only NURBS/non-manifold kernel ever sold as C++ source | 2 | 200 |
| [Weisberg, *The Engineering Design Revolution* (Shapr3D mirror)](https://www.shapr3d.com/history-of-cad/siemens-plm-software-unigraphics) | book | 2008 | historical | copyrighted, free to read | interview-based history of Shape Data, Romulus, Parasolid, ACIS, D-Cubed and kernel switches | 2 | 200 |
| [Hacker News: ex-Parasolid / D-Cubed / SolidWorks developer](https://news.ycombinator.com/item?id=8536744) | thread | 2014 | historical | forum | which products use which kernel; the ShapeManager fork; why history replay hardens kernels | 2 | 200 |
| [Onshape blog: "How Does Onshape Really Work?"](https://www.onshape.com/en/blog/how-does-onshape-really-work) | blog | 2015 | maintained | vendor blog | geometry servers replay feature lists and FeatureScript on licensed Parasolid and D-Cubed | 2 | 200 |
| [Zou, "A note on solid modeling" (arXiv 2302.14373)](https://arxiv.org/abs/2302.14373) | paper | 2023 | new | arXiv, author copyright | Chinese-language review of solid-modelling history, open problems and robustness | 2 | 200 |
| [Corney and Lim, *3D Modeling with ACIS*](https://books.google.com/books/about/3D_Modeling_with_ACIS.html?id=x_JMSgAACAAJ) | book | 2002 | historical | copyrighted | ACIS 6.3 textbook: data structures, laws, selective Booleans, lofting, healing | 2 | not checked |
| [PTC Creo Granite Interoperability Kernel sheet](https://support.ptc.com/images/cs/articles/2020/06/1593411762dEcH/PTC_Creo_Granite_Interoperability_Kernel._Final.pdf) | product | 2020 | commercial | commercial | PTC's marketing sheet for Granite | 1 | 200 |
| [Romulus (Wikipedia)](https://en.wikipedia.org/wiki/Romulus_(modelling_kernel)) and Braid's Bézier Award biography | docs | 1978 | historical | CC BY-SA | the first commercial B-rep kernel and its authors | 1 | 200 |
| [Russian Geometric Kernel (RGK)](https://en.wikipedia.org/wiki/Russian_Geometric_Kernel) | product | 2011-2013 | abandoned | proprietary | state-funded C++ kernel that reached a "full-featured" release and went silent | 1 | 200 |
| [Tech Soft 3D: Parasolid distribution](https://www.techsoft3d.com/products/parasolid) | product | 2026 | commercial | resale | the channel through which smaller companies license Parasolid | 1 | 200 |
| [Change.org: "Open Parasolid Kernel's Source Code and APIs under a Free License"](https://www.change.org/p/open-parasolid-kernel-s-source-code-and-apis-under-a-free-license) | thread | 2020s | active | web petition | a community petition asking Siemens to open Parasolid | 1 | not checked |
| [ZWSOFT Overdrive](https://www.zwsoft.com/product/overdrive) and the AMCAX kernel | product | 2024-2026 | commercial | proprietary | Chinese in-house kernels: ZW3D's Overdrive and AMCAX | 1 | 200 |
| [ODA MCAD roadmap](https://www.opendesign.com/blog/2026/march/roadmap-oda-mcad) | blog | 2026 | active | member-licensed SDKs | read CATIA/CGM, ACIS and Parasolid data through one API; integrate third-party kernels instead of writing a Boolean modeller | 1 | 200 |
