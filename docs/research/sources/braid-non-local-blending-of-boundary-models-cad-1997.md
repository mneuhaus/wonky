# Braid, "Non-local blending of boundary models" (CAD 1997)

- **Kind:** journal paper.
- **Canonical URL:** https://www.sciencedirect.com/science/article/abs/pii/S0010448596000383 (DOI 10.1016/S0010-4485(96)00038-3). Paywalled. The saved page `tmp/research/blend-papers/sd_braid.html` is only a JavaScript challenge shell with no abstract.
- **Other URLs:**
  - Semantic Scholar paperId `b127b34f7f375797cd9f5157d1990862298dd9d0` (`tmp/research/blend-papers/s2_braid.json`).
  - OpenAlex `tmp/research/blend-papers/openalex_10.1016_S0010-4485_96_00038-3.json`.
  - Proxy primary sources read instead:
    - ACIS R10 Blending Component manual, ch. 1: http://www-isl.ece.arizona.edu/ACIS-docs/PDF/BLND/01CMP.PDF (local `tmp/research/pdf/acis-blnd-01cmp.pdf`).
    - ACIS R17 user-guide blending pages under http://www.q-solid.com/ACIS_Docs_R17/online/SPAacisuserTechArticles/, e.g. `SPAacisuser_moblndbt.htm` (HTTP 200 on 2026-09-23). Local copies: `tmp/research/acis-r17/moblnd*.{htm,txt}`.
    - ACIS Advanced Blending error appendix: `tmp/research/pdf/acis-abl-cerr.pdf`.
- **Author:** Ian C. Braid.
  - He built BUILD at the Cambridge CAD Group from 1969.
  - He co-founded Shape Data in 1974 (ROMULUS, the precursor of Parasolid).
  - He left in 1985 with Lang and Grayer to found **Three-Space Ltd**, which developed **ACIS** (first released 1988).
  - DOCUMENTED: SMA Bézier Award citation, http://solidmodeling.org/awards/bezier-award/i-braid-a-grayer-and-c-lang/ (as summarised by search; page not fetched), and https://en.wikipedia.org/wiki/ACIS.
  - Correction to the brief: the paper belongs to the **ACIS** lineage. Its examples are drawn "from the ACIS modeller" (abstract), not from Parasolid.
- **Venue:** Computer-Aided Design 29(2):89–100, 1997. OpenAlex counts 33 citations and Semantic Scholar 42 (2026-09-23). Closed access.
- **License:** © Elsevier. The ACIS docs used as proxies are Spatial Corp. proprietary documentation, read-only. There is no code to port; ideas and topology case lists only. INFERRED; not legal advice.

## What it is

**Full text: unreachable.** Known content:

- **Abstract** (HEARSAY, reconstructed from search-engine snippets of the publisher page):
  - It "describes varieties of blending in kernel boundary modellers emphasizing topology, algorithms and program structure rather than geometry and using examples drawn from the ACIS modeller to explain how object-oriented methods can ease the addition of new categories of blend by applications built on a kernel modeller."
  - "The paper illustrates some of the many configurations that can occur when blends spread on to faces distant from the original implicitly blended edges and vertices."
  - "From a systems standpoint, a staged evaluation of blends is shown to have advantages in the use of existing Boolean code to perform much of the work."
- The Semantic Scholar TLDR repeats the first sentence (machine-generated).
- Later work citing it includes "Small blend suppression from B-rep models in CAE analysis" (2016) and "A note on solid modeling: history, state of the art, future" (2023). DOCUMENTED via the Semantic Scholar citation list.

So the paper is about the **topological rebuild** of blending in a B-rep kernel:

- blend networks, sequences, vertices, caps;
- blends that run onto *non-adjacent* faces ("non-local" / "remote" blends);
- a **staged** implementation where a blend sheet is built first and then merged into the body *by the Boolean engine*;
- an OO extension mechanism for new blend kinds.

## How it works, reconstructed from ACIS documentation

The ACIS docs describe the system Braid's examples came from. Everything here is DOCUMENTED in the ACIS R10 manual or the R17 pages. The claim that it reflects the paper's content is INFERRED.

### Staged evaluation ("Creating a Blend", `moblndcr`)

1. "Create a **blend sheet**, which is a sheet of surfaces that are used to form the blend."
2. "Attach the blend sheet to the model at the blend location. This involves trimming or extending the original faces and replacing portions of original surfaces with surfaces from the blend sheet."

- Stage two uses the Boolean code. The capping page says special-case capping appends cap faces to the sheet, then adds "Attributes that aid the Booleans in blend stage two (by avoiding the recalculation of the intersections)" (`moblndca`). This is the abstract's "existing Boolean code".
- Single stepping (`api_init_blend_ss` → repeated `api_do_one_blend` → `api_concl_blend_ss`) builds the sheet face by face. The attribute list "may grow longer than that initially constructed, as the blend operation may add attributes to the list itself" (R10 "Single Stepping").

### Program structure: attributes and a worklist

- **Attributes** (`moblndba`): blends are `ATTRIB_BLEND` objects attached to edges and vertices. "When an entity with a blend attribute is picked to have its blend fixed, the entire set of connected entities with blend attributes is fixed in one operation."
- A second family, **`ATTRIB_BLINFO`**, is "attached to the blend sheet during blending to record its relationship with the blank body". This is provenance.
- **OO extensibility:**
  - There is a general routine that finds spring curves, auxiliary surfaces and the blend surface, plus specific routines for spine, springs, surface and cross curve.
  - "Derived classes for new blend geometries need supply only as much new geometric code as is needed. For example, one might adopt the standard method of finding spring curves but construct a different blend surface through them."
  - Simple spines and springs (straights, ellipses) are recognised "for … improved numerical stability".
- **Worklist algorithm** (`moblndabp`, Advanced Blending): "Blend processing begins with a list of primary blend attributes … considered one at a time in list order." Each processed attribute behaves as follows:
  - Success creates one or more blend faces, and may add new primary attributes or remove not-yet-processed ones.
  - Failure moves the attribute "to the end of the list for later reconsideration, or" removes it.
  - Primary attributes (face-face, vertex, initial entity-entity) drive the processing; secondary attributes give local guidance.
- A caveat: between attaching attributes and fixing, "Other operations on the body should be avoided". Unsuccessful attributes must be removed, "as their continued status of being in a valid state is not guaranteed" (`moblndba`). Mutable-attribute fragility.

### Topology vocabulary and case analysis

From `moblndbt`, the R10 manual and `moblndsm`:

- The **network**: blended edges and vertices must not form disjoint networks. Radii may differ. "Wherever possible, analytic surfaces are used."
  - Edges are classified by smoothness (G¹ or not) and convexity. Both must be constant along the edge ("Blending operations may fail on non-G1 surfaces").
  - Vertices are **terminal** (exactly one blended edge ends there) or **internal** (two or more).
- **Sequences:**
  - **bi-blend**: two blended edges meet tangentially, plus any number of smooth unblended edges; the two blend surfaces "mate exactly".
  - **mitered**: non-tangent meeting or non-smooth unblended edges present. A miter surface computes the cross curves; the edges need the same convexity; at most two other edges, both non-smooth.
  - **complex miter**: the sheets do not match at their ends, and a side surface is extended as a partial end cap.
  - **closed / open** sequences.
- **Smooth-edge propagation** (`moblndsm`): the sequence propagates over a vertex when two same-convexity non-smooth edges are smoothly connected (Situation 1, "the vertex will be removed by ACIS"), or when the extra edges are smooth "slant edges" (Situation 4). It stops at a convexity change (Situation 2) and when other non-smooth edges are present (Situation 5). Situation 3 (a crease without an edge) is unsupported.
- **Capping** (`moblndca`):
  - A blend ends where "the figurative rolling ball does not roll onto any of the new entities it encounters", by intersecting the blend surface with body faces or their extensions.
  - An **end cap** terminates the blend. A **side cap** covers only a side, and the blend continues afterwards.
  - Multiple capping faces may be needed. At mixed-convexity vertices a face may need **extending**, which for spline faces means building an extension "so that the blend surface is guaranteed to intersect".
  - An **edge-face blend** can be used instead of a side cap (`bl_how_roll_on`), keeping the planar face's straight edges.
- **Remote (non-local) blending** (`moblndre`): "A remote blend is a blend that is not traveling on the two faces immediately adjacent to the blended edges."
  - *Some* remote: remote face-face or edge-face blends next to normal ones, e.g. a blend that "has traveled onto a cylindrical preexisting blend face".
  - *All* remote: "blending must determine an alternative pair of entities" (face-face, edge-face, even edge-edge). The canonical example is a blend whose radius exceeds a step height, which becomes an edge-face blend. This is "currently restricted to blend networks without vertex blends or miters".
- **Interference** (`moblndlo`):
  - Normally detected by "intersecting the spring curves of the sheet with geometry local to the blend".
  - Occasionally "the surfaces of the sheet must be intersected with all of the geometry of the body". The option `bl_remote_ints` switches global checking on; it is off by default because it is slower, "especially thin walled parts".
  - Example: a vertex blend with univex side capping fails without global checks.
- **Order-dependence** (`moblndve`, "Vertex Blend Order"):
  - Blending one edge first yields a smooth sequence for the other two.
  - Mitering two edges first gives a path for the third.
  - A **mixed-convexity mitered blend** "may not produce a unique valid solution. Therefore, ACIS disallows a single blend to be fixed with mixed-convexity mitered blends". The user must sequence it, and the two orders give two different valid shapes (Figs. 1-33/1-34).
- **Blend reordering** (`moblndbr`): a new, larger blend between two existing smaller blend faces is built "as though the larger radius blend had been done before the smaller radius blends".
- **Stopped blends** (`moblndst`): setback plus stop angle define a stop plane. The setback difference splits into `right = s + d/2` and `left = s − d/2`.
- **Error surface** (ACIS Advanced Blending appendix, `acis-abl-cerr.pdf`): `ABL_NO_GEOM_{EE,EF,FF,VF}`, `ABL_RADIUS_SMALL`/`BIG`, `ABL_GEOM_NOT_IMPL_{VE,VF,VV}`, `ABL_CHG_PT_COMPLEX` ("configuration around change point too complex"), plus standard blending errors "particularly those pertaining to capping".

## Robustness and guarantees

- The paper's claims are unknown.
- ACIS docs:
  - Global interference checking is optional, off by default, and some cases fail without it.
  - The worklist may requeue and give up on attributes.
  - Mixed-convexity miters are refused because they are non-unique.
  - Attributes left behind after a failure are not guaranteed valid.

  DOCUMENTED. There are no formal guarantees; this is engineering practice.

## Parallelism and performance

- The only number: special-case capping gives "on average … a twofold (2X) time improvement though only over the time spent in capping". DOCUMENTED (`moblndca`).
- Local interference checking "speeds up blending dramatically in some cases (especially thin walled parts)". DOCUMENTED (`moblndlo`).
- No parallelism is described. The worklist is inherently sequential as written. INFERRED.

## Known failures, limitations, war stories

- The ACIS docs list their own gaps (DOCUMENTED):
  - remote blending is not available with vertex blends or miters;
  - edge-edge alternatives "currently [have] limited capability";
  - non-G¹ creases without edges are unsupported;
  - interference misses happen unless global checking is on;
  - results depend on order.
- Wonky-side lesson (INFERRED): non-local cases are exactly Parasolid's overflow and "overlapping blends" faults. Two independent kernel lineages converged on the same hard set: running onto distant faces, capping at mixed convexity, and order-dependent corners.

## Relevance for wonky

- **Architecture: adopt the staged idea, in a functional form (INFERRED).**
  1. **Plan:** blend specs are immutable data keyed by edge and vertex identity. There are no mutable attributes on the body, which removes ACIS's "do not touch the body between attach and fix" hazard by construction.
  2. **Per-vertex decisions**, parallel over vertices: terminal / bi-blend / miter / sphere corner / unsupported, following the Parasolid and ACIS rules.
  3. **Per-edge sheet faces**, parallel over edges, uniform work: offset-SSI spine, springs, cross curves at the decided vertex ends. All analytic in the first cut.
  4. **Assemble the blend sheet and caps into a closed "blend region" solid.** It is removed for convex rounds and added for concave fillets.
  5. **Stage two = wonky's Boolean.** Trimming, extension, obliterated holes and "remote" interactions with distant faces then fall out of the Boolean instead of needing special topology code. This is Rossignac's blend-primitive recipe, generalised from one edge to a sheet.
- **Consequence for the roadmap:** fillets in this architecture are *gated on the general curved Boolean*, which currently stops at a plane/cylinder union. The first-cut sliver tools (planes, cylinders, tori, spheres) are exactly the surface pairs the bake-off's analytic-recovery hybrid must handle. INFERRED. Two consequences:
  - Pick fillet regression fixtures now as Boolean stress cases: coplanar tool/blank faces, and tangential cylinder/plane contact along the spring lines. Tangential contact is a notorious Boolean degeneracy that exact predicates must classify as *on*.
  - Fillets are the strongest argument for making tangential and coplanar handling first-class in the Boolean.
- **Bend fit (INFERRED):**
  - Steps 2 and 3 are uniform fork-join maps.
  - The ACIS worklist with requeue becomes a recursive fixpoint over an immutable list, or better, is avoided: decide vertices first, then build edges independently.
  - Connected components of the blend network are independent and can be processed in parallel.
  - A global interference check (sheet vs all faces via a BVH broad phase) is cheap enough in a parallel kernel to be **always on**, removing ACIS's local-by-default misses.
- **Provenance and diff:** the `ATTRIB_BLINFO` idea becomes wonky identity tags on every sheet face, `(source edge | vertex, role ∈ {blend, cap, cross, vertex, miter}, spec)`, preserved through the stage-two Boolean. Diffs then show "fillet faces of edge E grew", and defillet and modify-fillet become exact (see the Parasolid note on `vx_twin` and `PK_FACE_delete_blends`). INFERRED.
- **Explicit failure:** in the first cut, any spring curve leaving its support face (a remote/overflow situation) returns `NeedsOverflow{face, kind}` instead of attempting remote blending. Mixed-convexity miters return a "non-unique, sequence the fillets" error, mirroring ACIS's own refusal. That error message is also LLM-friendly.
- **LLM ergonomics and naming:** reuse the ACIS/Parasolid vocabulary (terminal/internal vertex, bi-blend, miter, end cap, side cap, remote blend) in error messages. FS authors and LLMs will find it in public docs.

## Pointers worth porting or studying

- ACIS R10 `01CMP.PDF`: "Creating a Blend", "Blend Topology", "Capping", "Sequences of Blended Edges", "Bi-Blend", "Mitered Blends", "Complex Miter", "Closed Sequences", "Open Ends and End Caps", "Multiple Capping Faces", "Extending Capping Faces", "Remote Blending", "Vertex Blend Order", "Local and Global Interference Checking".
- ACIS R17 pages `moblndba` (attribute classes, `ATTRIB_BLINFO`), `moblndabp` (worklist), `moblndsm` (smooth-edge sequence situations 1–5, a ready-made propagation spec for FS `tangentPropagation`), `moblndre`, `moblndlo`, `moblndve`, `moblndbr`, `moblndst`.
- Parasolid FD ch. 31–32 (overflow and overlap faults) for the same problems in the other lineage.
- If the paper becomes accessible: its figures of non-local configurations would be the regression fixtures to copy.

## Verdict: unreachable

The paper itself is closed, with no open copy found. Its documented thesis is actionable and confirmed by the ACIS docs:

- a staged blend sheet merged by the Boolean;
- non-local blends as the hard cases;
- OO or data-driven extension.

Adopt it as wonky's fillet architecture in pure-functional form (plan → per-vertex decisions → per-edge sheet → Boolean). Retry the paper for its case figures if library access appears.
