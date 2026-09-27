# ACIS api_check_entity and checking levels (Univ. of Arizona mirror of ACIS docs)

- Kind: vendor API reference page (old ACIS online help, HTML), plus the R17 user-guide article and tolerance page used for cross-checking. Canonical as briefed: [api_check_entity reference, Arizona mirror](http://www-isl.ece.arizona.edu/ACIS-docs/HTM/DATA/INTR/INTR/03FN/0003.HTM) (HTTP 200 on 2026-09-24, 210 KB; local copy `tmp/research/acis-api-check-entity-and-checking-levels-univ-of-arizona-mi/0003.HTM` + `.txt`). Cross-checks: [ACIS R17 "ACIS Checker" article (q-solid mirror)](http://www.q-solid.com/ACIS_Docs_R17/online/SPAacisuserTechArticles/SPAacisuser_mointrchkr.htm) and the R17 "Tolerance Variables and Units" page (local `tmp/research/acis-r17/SPAacisuser_totol.htm`). The R17 article has its own sibling note, `acis-r17-checker-and-intersectors-articles`. This note adds the older per-check procedures and does not repeat that note's R17 philosophy.
- Organization: Spatial Corp. (Dassault Systèmes). The Arizona mirror carries no version banner. INFERRED: pre-R14, around ACIS 7–13, early 2000s, because it has no `r14_checks` option, no check versioning, and prose-style check tables instead of R17's ID-macro tables. The header path is `intr/intersct/kernapi/api/intrapi.hxx`, library `intersct`, "Effect: Read-only". **DOCUMENTED** page footer.
- License: proprietary documentation of a closed commercial kernel, mirrored without an explicit grant. There is no code to port. Check *categories* and their cost ordering are generic engineering knowledge and can be reimplemented under wonky names; do not copy the message tables verbatim (INFERRED).
- Status: historic documentation of a live commercial product (ACIS is still sold by Spatial). The mirror is static. Current docs at doc.spatial.com are script-gated (per the brief).

## What it is

The reference page for ACIS's validity checker: prototype, options, the seven cost levels, and an itemised list of every check with its procedure and message. It is the most detailed public, procedure-level description of an industrial B-rep checker that I have found. Parasolid's PK_BODY_check docs (sibling note) list fault *classes*; this page says *how* many checks are carried out: which tolerance, how many sample points, and which traversal.

## How it works

**API (DOCUMENTED):** `outcome api_check_entity(const ENTITY*, insanity_list*& list, AcisOptions* = NULL)` and an overload `(const ENTITY*, ENTITY_LIST* problem_ents, FILE* = stdout, AcisOptions*)`. A null `insanity_list` means "checks good". Messages come from a user-editable table `intersct/sg_husk/sanity/insanity_tbl.cxx`. A `sanity_ctx` exposes counters of checked lumps/shells/wires/faces/loops/coedges/edges/vertices/laws, so the caller can see *coverage* as well as faults. Options: `check_level`, `check_output`, `check_abort` (stop at first problem), `get_aux_msg` (detail).

**Levels (DOCUMENTED, values not multiples of 10 round down; > 70 clamps to 70):**
10 fast error checks · 20 (+ slower error checks, **default**) · 30 (+ D-Cubed curve/surface checks) · 40 (+ fast warning checks) · 50 (+ slower warning checks) · 60 (+ slow edge convexity change-point checks) · 70 (+ face-face intersection checks).
R17 states explicitly that level allocation is by **computational expense, not severity**, with self-intersection checks deliberately pulled down to level 30 because self-intersecting input is common and usually unusable ([R17 article](http://www.q-solid.com/ACIS_Docs_R17/online/SPAacisuserTechArticles/SPAacisuser_mointrchkr.htm)). The R17 table maps levels to groups as follows: 10+ pointer/back-pointer, attribute chain, transform, basic curve/surface form, pcurve basics, cellular topology; 20+ face area, non-G1 curve/surface, tolerant-edge checks; 30+ general curve/surface ("D3") checks, tolerant coedge, sliver faces; 40+ coedge partner, degenerate spline poles, pcurve compatibility; 50+ body containment; 60+ edge convexity points; 70+ improper face-face intersections and curve parametrisation. The R17 table was extracted by a script and is lightly lossy.

**Check catalogue (DOCUMENTED from the Arizona page; tolerances are SPAresabs unless stated):**
- *Topology pointers:* body→lump→shell→face/wire→loop→coedge back-pointers. Loops must close in both `next` and `previous` directions. Sequential coedges share a vertex. Partner coedges form a closed ring that all points to the same edge, and no coedge is its own partner. A vertex must reach every incident coedge by walking CW and CCW, and any failure there is labelled "Fatal topology error. This part will hang". Non-manifold vertices store one edge per manifold group, and an edge must belong to exactly one group.
- *Transform:* translation length ≤ 2·SPAresabs/SPAresnor (a dynamic-range bound). The affine part must be orthonormal (unit rows and columns), det = +1 or −1 matching the reflection flag, and identity when there is no rotation or reflection.
- *Analytic geometry well-formedness:* plane normal is unit length. Sphere radius ≠ 0. Cone base ellipse: unit normal ⟂ major axis, major ≠ 0, 0 < ratio ≤ 1, sin²+cos² = 1 for the half-angle. Torus: unit normal, major ≠ 0, minor ≠ 0, major ≥ −|minor| (lemon/apple tori allowed). Straight line: unit direction, parameter scale > 0. Ellipse: unit normal ⟂ major axis, major > 0, 0 < ratio ≤ 1.
- *Face/loop classification:* exactly one periphery loop, or 1–2 u/v *separator* loops on periodic surfaces (cone/sphere/torus), never both. Holes must be contained in the periphery or separators, holes must not contain holes, and separator pairs must mutually contain or exclude each other. A full sphere or torus face may have no loop. A cone with an apex needs a degenerate loop: one coedge whose edge has no curve and one vertex. Planar and bounded-cone faces must have positive area. Loop orientation on tori is tested by pushing boundary points toward the material side and classifying them against the face.
- *Geometry–topology incidence (sampling-based):* vertex-on-curve means closest-point distance ≤ SPAresabs. Coedge start/end vertices must lie on the face surface. The coedge's edge is sampled at "about 20 points" and each must lie on the face (the summary list later says "10 points"; the page is internally inconsistent). The pcurve is evaluated at parameters 0, 1/3, 2/3, 1: each point must match the 3D curve within SPAresabs (via `point_perp`), tangent directions must have a positive dot product, the pcurve range must cover the coedge range, and periodic pcurves must land in the face's period. Spline closure/periodicity is verified by sampling 10 points along the seam. Face and edge bounding boxes must contain their vertices, grown by the vertex tolerance for tolerant entities.
- *Edge ordering:* faces around an edge must be ordered by sidedness/containment, and coedges around an edge sorted by dihedral angle from the first face must match the stored order (radial-edge consistency for non-manifold edges).
- *Vertices:* no two vertices closer than SPAresabs ("duplicate vertex"). Tolerant vertices overlap if their distance exceeds the larger tolerance.
- *Tolerant modeling (TEDGE/TCOEDGE/TVERTEX):* the evaluated coedge endpoints must lie within the vertex tolerance. The tube of radius = edge tolerance must not self-intersect where curvature is high. A tolerant edge's box must intersect both vertex boxes.
- *Face-face (level 70 or `check_ff_int`):* adjacent faces may intersect only along their common edge, and non-adjacent faces must not intersect. If face-face intersection fails, edges on each face are intersected instead: adjacent edges may meet only at their common vertex, and non-adjacent edges must not meet. Shells in one lump must contain each other; lumps must not contain each other. Offending intersections are returned as a separate body named `check_error`, a visual debug artefact.
- *Cellular topology:* cell↔lump, cshell, cface, front/back cface attributes, and ray-cast containment of cshells.

**Tolerance model (DOCUMENTED, R17 tolerance page):** SPAresabs = 1e-6 (model units, usually mm), SPAresnor = 1e-10, so the largest representable quantity is SPAresabs/SPAresnor = 1e4. SPAresfit = 1e-3 for procedural-surface approximations. SPAresmch = 1e-11, one order below the 1e-10 needed for a 1e4 model space with 1e-6 features. The default keeps "at least an order of magnitude guard band" around SPAresabs.

## Robustness and guarantees

- DOCUMENTED (R17): a body is *defective* iff level-70 checking reports ERROR problems. Operations on defective bodies are not guaranteed, and Spatial "does not normally view the failure of the operation to be a bug". Check on read-in, repair, then model; do not check inside the modeling workflow, because valid in → valid out is the contract.
- DOCUMENTED (R17): a part with no errors at an old checker version is not thereby "valid". Checker improvements can reveal old defects, so the checker is explicitly incomplete and evolving.
- INFERRED: all incidence checks are *sampled* (4, 10 or 20 points) against an absolute tolerance, so an edge that leaves its face between samples passes. The face-face check is the only global geometric test and costs a full pairwise SSI.
- DOCUMENTED: `api_check_entity` is designed never to fail on bad input. It must traverse corrupt pointer graphs without crashing, which is why pointer checks come first.

## Parallelism and performance

No numbers are published. The level scheme exists because costs differ by orders of magnitude: pointer checks are O(n); sampled incidence is O(n·k) evaluations; face-face is O(F²) SSI unless pruned by boxes (INFERRED). Every check except the traversal-order ones is independent per entity, so the work is data-parallel (INFERRED).

## Known failures, limitations, war stories

- R17 notes a "commonly held belief" in the ACIS community that levels 20/30 are the important ones. Spatial says this is wrong, because levels encode cost, not severity (DOCUMENTED, R17).
- Several pointer-inconsistency messages carry "This part will hang", meaning later operations loop forever on them. A checker must be total on corrupt input (DOCUMENTED).
- Internal inconsistency: "about 20 points" vs "10 points along edge" for edge-on-face sampling (DOCUMENTED, same page). This shows how loosely such checks are specified.
- Mass properties require C1 curves (R17: "evaluation of mass properties in ACIS requires that curves be C1 continuous"). So validation properties depend on warning-level checks that are skipped at the default level (DOCUMENTED + INFERRED).

## Relevance for wonky

- **Checker design (primary).** Together with Parasolid's grouped `PK_BODY_check` and OCCT's `BRepCheck` (sibling notes), this confirms a three-kernel consensus: *total* traversal first, then per-entity geometry well-formedness, then geometry–topology incidence, then global face-face intersection behind an opt-in flag. Wonky should keep that order, but it can make the middle stage *exact* where ACIS samples:
  - Vertex-on-plane and vertex-on-line are exact predicates on F32-quantized coordinates. Use multi-limb U32 determinants in `robust-predicates.bend`.
  - Vertex-on-cylinder/cone/circle is a polynomial sign test: squared distance to the axis minus r². Evaluate it with F32x2 and an error bound, falling back to limbs when the result is ambiguous.
  - Edge-on-face for line-on-plane, circle-on-plane, line-on-cylinder (a generator) and circle-on-cylinder (coaxial, same radius) is a finite set of algebraic identities, so no sampling is needed. Only ellipse-on-cylinder, the oblique section, needs one identity check (plane ∩ cylinder parameters).
  - Sampling survives only for the certified print mesh and for future spline/SSI curves.
- **Existing wonky code to align.** `kernel/curve-plane.bend:84-126` (`frame_valid`, `directions_valid`, `radius_valid`, `curve_valid`) already implements ACIS's curve well-formedness block with an angular budget. There is no `minor ≤ major` check for `A.Ellipse`, whereas ACIS rejects ratio > 1. Decide whether wonky's ellipse convention requires major ≥ minor and add the check or document the convention (INFERRED gap). `kernel/boundary.bend:43` `endpoints_valid` corresponds to the coedge endpoint-on-curve checks.
- **Dynamic range.** ACIS's 1e-6 absolute over a 1e4 model space (ratio 1e10 ≈ 2^33) matches wonky's documented ±10,000 mm coordinate range. A 1e10 dynamic range fits F32x2's ~48-bit significand (~2^48 ≈ 2.8e14) with ~15 bits of guard, but is far beyond plain F32 (2^24 ≈ 1.7e7). So any F32-only fast path in a checker must be a filter backed by F32x2 or limbs, never the decision (INFERRED).
- **Face-face stage as uniform GPU work.** Box-pruned face pairs → per-pair "intersect only along the shared edge" test is uniform per pair for plane/plane and plane/quadric. Wonky's Boolean bake-off already needs the same SSI kernels, so the checker can reuse them (INFERRED). Emit offending curves as a debug body like ACIS's `check_error`; the viewer's diff/review can show it.
- **Coverage counters.** `sanity_ctx` counts are cheap and make "checker passed" auditable. Return them in wonky's check report next to per-fault entries with stable IDs (the R17 advice: use IDs, not message strings).
- **Testing.** Use the catalogue as a mutation-test checklist: for each check, write a fixture that corrupts exactly that invariant (open loop, flipped coedge, vertex 2·tol off the curve, hole outside periphery, torus major < −|minor|) and assert the checker names it. That is the ACIS/Parasolid fault taxonomy turned into wonky regression tests (INFERRED).

## Pointers worth porting or studying

1. Arizona page, "Level 20 Checks" tables: LOOP checks 8–23 (periphery/separator/hole rules per surface type). This is the most compact statement of face-loop validity for periodic analytic surfaces; port it as wonky's loop-classification spec for cylinder/cone faces with seams.
2. Same page, COEDGE/PCURVE checks: the 0, 1/3, 2/3, 1 pcurve-vs-3D-curve rule plus tangent-sign test. Wonky's STEP export writes pcurves (`kernel/step-pcurves.bend`, `step-cylinder-pcurves.bend`), so this is a direct self-check before export.
3. Same page, EDGE checks: radial ordering of coedges by dihedral angle. Needed once wonky allows non-manifold intermediate results in the Boolean.
4. Same page, "Optional face-face intersection checking" (a–d): exact definitions of *proper* intersection for faces, edges, shells and lumps.
5. R17 tolerance page: the SPAresabs/SPAresnor/SPAresmch derivation. Copy the *reasoning* to derive wonky's own constants from F32x2 and the ±10,000 mm range.
6. R17 article: severities ERROR/WARNING/NOTE/INFO, `check_abort`, `checker_limit`, versioned checks. See the sibling note for details.

## Verdict: learn-from

No code and a proprietary, dated mirror, so there is nothing to adopt directly. It is still the most concrete public procedure list for an industrial B-rep checker. Use it as the checklist and mutation-test inventory for wonky's checker. Reimplement the incidence stage with exact or bounded predicates instead of ACIS's 4/10/20-point sampling, and keep ACIS's cost-ordered levels, total traversal, coverage counters and the opt-in face-face stage.

