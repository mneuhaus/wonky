# Fillets, chamfers, blends, offsets and shelling

Chapter of the wonky research knowledge base, 2026-09-24. English.

**Status and method.**

- **Deep reads.** 18 source notes cover this topic. They are under
  [sources/](sources/) and linked in section 2. This chapter re-read all 18
  in full.
- **Publish-first step.** Two notes existed only as JSON. They were published
  verbatim from the JSON `markdown` field, with no Markdown fixes needed:
  [Peternell-Pottmann][n-pp] and [Maekawa 1999][n-mae].
- **Four notes exist in two versions.** For Choi-Ju, Lukács, the Dupin
  cyclide papers and Wallner-Pottmann, `tmp/research/notes/<slug>.json` holds
  a Codex re-read from 2026-09-24 (13:04 to 13:15). It is newer than the
  published `.md` (2026-09-23). The publish rule only fills missing files, so
  the `.md` files were left alone. The two versions differ in verdict (see
  the table in section 2) and in some details. This chapter uses the stricter
  statement where they differ and says so.
- **Checks made for this chapter.**
  - wonky's working tree on 2026-09-24: HEAD `cb9ec22` plus uncommitted
    work. Read: [../fillet.md][w-fillet] and its five chapters,
    [proto-kpart.md][w-kpart], [proto-rollingball.md][w-rb],
    [harness.md][w-harness], [../entscheidungen.md][w-ent],
    [../hybrid-boolean-plan.md][w-hyb], `kernel/analytic.bend` and
    `kernel/robust-predicates.bend`.
  - remus's own agent skills for fillets and offsets at commit `1dc3763e`,
    read in the shallow clone ([fillet-blend][remus-fb],
    [its reference][remus-fbref], [offset][remus-off]).
  - Page 2 of the Wallner-Pottmann preprint, against both note versions
    (section 4.1).
  - Marc's CAD corpus, read-only with ripgrep, for offset and shell calls
    (section 1.8).
  - Two arithmetic checks with a node one-liner: the chamfer volumes in
    correction 2 and the Hopf-map identity in section 4.1.
  - Nothing else was built or run.

**Labels.**

- **DOCUMENTED**: read in a primary source. Links to a note lead to the
  primary URL through the note; other links go to the primary source itself.
- **MEASURED**: measured in a run that is named: wonky's own runs as recorded
  in its docs, or the ripgrep counts and node checks of this chapter.
- **INFERRED**: reasoning from evidence.
- **HEARSAY**: secondhand.

**Corrections to the scout's framing.**

1. **The fillet work is past the proposal stage.** The scout proposes a
   closed-form "Tier 0" in pure Bend. wonky has already decided on it and is
   prototyping it:
   - **Part 1** of the fillet work (survey, corpus usage, harness) is
     [../fillet.md][w-fillet] (commit `d6b45bb`). Its corpus measurement:
     - 93 files in 52 families use 3D blends.
     - Every blend has a constant size in mm, and every chamfer is
       `EQUAL_OFFSETS`.
     - Nothing uses variable radius, rho, G2, setbacks or the full-round
       option.
     - 23 to 30 of 39 measured families are analytic, and the hard rest is
       mostly overflow (5 of 9 non-analytic families).

     All MEASURED there.
   - **Marc accepted the recommendations** on 2026-09-24
     ([../entscheidungen.md][w-ent], "Fillets und Fasen"):
     - version 1 is analytic only, and everything else is refused with a type;
     - Torus and Sphere go into production together with the hybrid Boolean;
     - freeform blends carrying a tolerance are opt-in only;
     - the cross-section is circular G1 only;
     - notch overflow comes first;
     - declared tangency may be built for candidate B;
     - C runs as a cross-check.
   - **Prototype A**, `fillet-kpart`, has stage A1 (the per-edge ladder,
     about 3.2k Bend lines) and stage A2 (the corner network). It does not
     build a B-rep yet: stage 3, the surgery, is open.
   - **Prototype C**, `fillet-rollingball`, has stage C1 (independent
     stations with a maximum-ball certificate) and stage C2 (bi-arc tori and
     B-spline outputs).
   - **B and D** (the blend Boolean and the morphological reference) have no
     directory under `kernel/proto/` yet (MEASURED, `ls`).
   - **Sphere and Torus** are entering the production `Surface` type right
     now. The uncommitted `kernel/analytic.bend` adds both; HEAD has neither
     (MEASURED, `git diff` and `git show HEAD:`).

   So this chapter does not re-argue Tier 0. It concentrates on what the
   research says about the open parts:
   - exact decisions;
   - the attach stage;
   - overflow and consumed faces;
   - above all offsets and shells, which no wonky plan covers beyond
     [theory.md §12][w-theory].
2. **Chamfer distance: the notes infer the wrong rule for Onshape.**
   - Four notes ([Onshape std][n-fs], [Onshape help][n-help],
     [Parasolid][n-ps], [ACIS][n-acis]) and theory.md §5.1 inferred that
     Onshape's default `FACE_OFFSET` is Parasolid's "offset the supports,
     intersect, project" rule.
   - Onshape probe FP-a (2026-09-24, [decision log][w-ent]) measured an
     `EQUAL_OFFSETS` chamfer with d = 1 on a 120° edge of length 20:
     ΔV = −8.6603 mm³ and a chamfer face of 34.641 mm². That is the
     **in-support** rule: each contact line lies d along its own support face.
   - Neither face-offset reading fits (MEASURED here with node):
     - contacts at the spine foot, d·cot(α/2): −2.8868 mm³;
     - each face cut with the other face's offset, d/sin α: −11.547 mm³ (the
       value the decision log quotes).
   - Probe FP-b: a chamfered three-edge box corner is a small equilateral
     triangle (side √2), as in OCCT.
   - The Parasolid chamfer formulas in the notes remain correct as statements
     about Parasolid's documented v12 ranges. They do not describe what
     Onshape does by default.
   - `APEX_RANGE` and the `TWO_OFFSETS` side assignment are still unprobed.
3. **Usage decides offsets too.** The fillet corpus study did not measure
   offsets; this chapter did (section 1.8).
   - `opOffsetFace` appears in 67 FS files in 3 projects. 51 of those calls
     have one shape: grow every face of a tool body by a 0.15 mm fit
     allowance, then cut.
   - `opShell` appears in 1 file and `opThicken` in 2.
   - So the first offset feature wonky needs is a **whole-body offset of a
     tool body**, not a shell.
4. **One open kernel is missing from the scout's list.** remus
   (Apache-2.0, 2026) has the broadest open analytic fillet ladder and a
   qualified offset engine ([remus note][n-remus]). Its own skill files
   document the failure modes wonky must avoid (section 4). keel, vcad and
   BREP_kernel are covered in [../fillet/implementations.md][w-impl] and not
   re-read here.

---

## 1. Landscape

### 1.1 One construction behind three operations

Fillets, chamfers and offsets share one construction, applied at different
scales. All DOCUMENTED; the combined reading is INFERRED.

- **Constant-radius fillet.** Offset both supports by r toward the ball,
  intersect the offsets to get the **spine** (the ball-centre path), push the
  spine back along the normals to get the two **spring curves**, and sweep a
  circular arc between them. Five independent sources describe the same thing:
  - Parasolid stores the spine in its blend record ([Parasolid][n-ps] §29.6);
  - ACIS: "offset both supports, intersect, project" ([ACIS][n-acis] §2);
  - OCCT ChFiKPart ([OCCT][n-occt]);
  - Kós-Martin-Várady §3.2 ([Kós][n-kos]);
  - Choi-Ju ([Choi-Ju][n-cj]).
- **Chamfer.** The same contact problem with a straight cross-section.
  Kernels disagree on what "distance" means (correction 2, section 3.7).
- **Offset and shell.** Offset every face. Then either re-intersect the
  neighbours (intersection join) or insert pipes at convex edges and spheres
  at vertices (arc join, the Euclidean offset). Trim self-intersections. For
  a shell, combine the result with the original by a Boolean.
- **Rossignac-Requicha** tie the two together semantically
  ([note][n-rr]):
  - rounding is the morphological opening `R_r(S) = (S↓r)↑r`;
  - filleting is the closing `F_r(S) = (S↑r)↓r`.

  Edge-local blends agree with these definitions away from their ends.

Three consequences for wonky (INFERRED):

- **The carrier zoo is closed under offsetting.** A plane stays a plane, a
  cylinder a cylinder, a cone a cone with a shifted apex, and a sphere or
  torus keeps its type ([Patrikalakis][n-pmc] 11.3.3). The same holds for
  cyclides ([Dupin note][n-dupin]). The pipe of radius r around a line or
  circle edge is exactly the cylinder or torus a fillet produces.
- **One SSI and one set of collapse tests serve both features.** An exact
  offset engine and an exact fillet ladder need the same surface-surface
  intersections, the same carriers and the same exact collapse tests (a
  radius reaching zero).
- **Both need the same attach machinery**: trim the neighbours, insert new
  faces, drop consumed ones.

### 1.2 Lineages

| Lineage | Origin | Carried on by | What it gives wonky |
|---|---|---|---|
| Morphological and CSG offsets | Rossignac-Requicha 1984/86, PADL-2 ([note][n-rr]) | SDF offsets and smooth-min (Quilez, libfive; [SDF chapter][c-sdf]); remus `arc_joint` for all-convex polyhedra ([remus offset][remus-off]) | semantics, oracles, the definitions of clearance and tolerance equality |
| Parametric rolling ball | Choi-Ju 1989 ([note][n-cj]) | OCCT BlendFunc/BRepBlend since 1994 ([note][n-occt]); monstertruck ([note][n-mt]); remus walker; wonky C ([proto-rollingball][w-rb]) | the general solver for pairs without a closed form |
| Analytic special cases | OCCT ChFiKPart 1994; Kós table 2000 | Parasolid ("simplifies … to tori and cylinders"); remus `analytic.rs` (9 pairs); wonky's symmetry theorems ([theory §4.1][w-theory]) and prototype A | the exact ladder that covers the corpus |
| Exact rational canal surfaces and cyclides | Chandru-Dutta-Hoffmann 1989; Peternell-Pottmann 1997; Wallner-Pottmann 1997; Shene 1998/2000; Lukács 1998 ([notes](#2-comparison-table)) | Dahl 2014 (cited in the notes) | exact representations and validity conditions, not an operator |
| Kernel topology engineering | Braid 1997 (ACIS staging, [note][n-braid]); Parasolid attach/check/fix and overflow ([note][n-ps]); HP patents 1993/1996 ([note][n-hp]) | Siemens blend patents (active); Onshape's error enums ([note][n-fs]) | the attach stage and the failure taxonomy |
| Offsets and shape interrogation | Farouki; Maekawa 1999 ([note][n-mae]); Patrikalakis-Maekawa-Cho 2002 ([note][n-pmc]) | OCCT BRepOffset; Parasolid hollow; remus `offset` | exact quadric offsets, regularity tests, the pipe theorem |
| Blend recovery | Kós-Martin-Várady 2000 ([note][n-kos]) | the Várady group; wonky C's certificate | the maximum-ball residual as an independent oracle |

### 1.3 What every production kernel does, and what none of them claims

- **The same pipeline everywhere.** DOCUMENTED for ACIS, Parasolid, OCCT and
  remus; that it is common to all of them is INFERRED.
  1. The request is stored as data.
  2. Chains are built and classified. Convexity must be uniform along an
     edge: ACIS reports `BL_NON_U_CVXTY`, and Onshape has
     `EdgeConvexityType.VARIABLE` ([Onshape std][n-fs]).
  3. Each edge gets its stripe: a closed form where possible, walking
     otherwise.
  4. Vertices get terminal caps, bi-blends, miters, sphere corners or
     n-sided patches.
  5. The blend is attached: Boolean-like in ACIS stage 2, via TopOpeBRepDS in
     OCCT.
  6. The result is validated.
- **No completeness claims.** Parasolid calls its rules "rules of thumb",
  says "the only guaranteed test of a blend is to FIX it", and calls the
  workflow "trial and error" ([Parasolid][n-ps]). ACIS claims "a high degree
  of precision", yet its local interference default silently loses a pocket
  ([ACIS][n-acis] §7).
- **Order dependence is built in.** DOCUMENTED:
  - Parasolid's `overlap_c`: blends that fail when fixed together succeed
    one after another;
  - ACIS refuses mixed-convexity miters as non-unique;
  - ACIS rebuilds a large blend between two small ones "as though the larger
    radius blend had been done before".
- **The kernels differ mostly at the ends of blends.** Parasolid has overflow
  types. ACIS has caps and remote blends. OCCT has Plate corners. remus stops
  at a cliff with a typed error.

### 1.4 The contract wonky has to meet: Onshape, which means Parasolid

- **Onshape almost certainly runs Parasolid.** Its `FILLET_*`, `CHAMFER_*`
  and `EDGEBLEND_*` enums reproduce Parasolid's v12 fault list almost word for
  word (INFERRED, strong: [Onshape std][n-fs]).
- **Onshape builds what OCCT refuses.** It builds 13 of the 14 formerly
  open harness cases, and OCCT refuses 10 of them. The one Onshape refusal,
  FP12, uses `FILLET_FAIL_SMOOTH` (DOCUMENTED, [decision log][w-ent]). So
  parity with Onshape means matching Parasolid, including overflow.
- **Behaviour is pinned by version.** In FS through `isAtVersionOrLater`, in
  Parasolid through its `update` option. Marc's `FeatureScript 3044;` sits
  between the 2960 and 3083 std snapshots, whose blend files are identical
  ([Onshape std][n-fs]).
- **Defaults differ between the UI and code.** `tangentPropagation` is
  `false` in the programmatic defaults but `true` in the UI.
  `allowEdgeOverflow` is `true` in both ([Onshape std][n-fs]).
- **Parity matters more than it seems.** Marc's corpus wraps 41 blend calls
  in `try`, often with a smaller-radius fallback
  ([../fillet.md §2.3][w-fillet]). Where wonky refuses and Onshape succeeds,
  the part silently changes shape.

### 1.5 Trends 2023-2026

- **Typed refusal as API.** remus: "Codes are API: never rename one, only
  add". The same holds for keel and vcad, per
  [implementations.md][w-impl]. monstertruck still swallows failures
  ([monstertruck][n-mt]).
- **Agent-built kernels with agent manuals.** remus has 21 skills and 510k
  lines of Rust ([remus][n-remus]).
- **Post-CSG fillet crates.** monstertruck's fillet crate runs after the
  Boolean, and its own flagship example dies in that Boolean (issue #24,
  [note][n-mt]).
- **Mesh offsets.** OffsetCrust (2025/26), Zint 2023/24 and Cao 2024 are
  mesh or implicit methods, not B-rep ones (catalog; [SDF chapter][c-sdf]).
- **Quiet theory.** Almost nothing new has appeared in B-rep blending since
  about 2005. There is one paywalled 2025 chapter on blend termination.
- **Patents.** The HP patents have expired. The Siemens blend patents run to
  2032 and 2036, and the Geomagic setback patent to 2027-12-17
  ([Várady-Rockwood][n-vr], [HP][n-hp]).

### 1.6 What is conspicuously missing

- **A public fillet-robustness benchmark.** None was found; this is
  DOCUMENTED by absence across the notes. The closest thing seen in this
  research is wonky's own private harness: 70 cases, 57 closed forms
  ([harness.md][w-harness]).
- **Exact arithmetic or robust predicates in blending.** Every source works
  in f64 with tolerances:
  - OCCT: 1e-12 angular and 1e-7 linear ([OCCT][n-occt]);
  - remus: local epsilons of 1e-9 ([remus][n-remus]);
  - Kós: relative stopping at 1e-6 ([Kós][n-kos]).
- **Parallel or GPU blending.** None. OCCT's TKFillet has no parallel path,
  the ACIS worklist is sequential, and monstertruck is sequential.
- **An open overflow implementation.** None. remus stops at the cliff, OCCT
  fails, and monstertruck skips the edge.
- **An open, permissive setback vertex blend.** None. ogeom-rs issue #18
  (2026) plans a fitted patch ([Várady-Rockwood][n-vr]).
- **Onshape's shell join semantics.** The Parasolid docs say hollowing joins
  by intersection (sharp edges) ([Rossignac note][n-rr], citing Parasolid FD
  ch. 19). No Onshape probe exists yet.
- **The canon's full texts.** Vida-Martin-Várady, Várady-Rockwood, Braid,
  Choi-Ju, Lukács and Maekawa 1999 were all unreachable. Their vocabulary is
  recoverable from the ACIS and Parasolid docs, Kós 2000 and Rossignac's
  thesis ([Vida note][n-vmv]).

### 1.7 Where wonky stands (working tree, 2026-09-24)

| Area | State | Source |
|---|---|---|
| FS frontend | `opFillet` and `opChamfer` throw `UnsupportedFeatureError` naming the call | [Onshape std note][n-fs], "Relevance" |
| Decisions | v1 analytic only, typed refusal, Torus/Sphere in production, freeform opt-in, notch first | [../entscheidungen.md][w-ent] |
| Harness | 70 cases with 57 closed forms. The OCCT oracle does 49 of 70. The validator gets 15 of 15 mutations right. The Onshape probes `fp-*` are the primary oracle for the 14 formerly open cases, but they are not yet an `onshape` entry in `reference.json` | [harness.md][w-harness], [proto-kpart.md][w-kpart] open items |
| Prototype A | A1 ladder and A2 corner network. Decisions use a 1e-9 mm band in F32x2. Stage 3 surgery is open, and overflow cases are refused | [proto-kpart.md][w-kpart] |
| Prototype C | C1 solver and C2 tori/B-spline outputs. Overflow checks are sampled (17 per edge). The spline tolerance is 1e-4 mm at rims. Metal runs only the station solve | [proto-rollingball.md][w-rb] |
| Prototypes B and D | not started | `kernel/proto/` |
| Carriers | Sphere and Torus in the uncommitted `kernel/analytic.bend` | working tree |
| Hybrid Boolean | not yet safe near tangencies. Before steps 1 and 2 of the plan it gave 18 wrong `ok` answers and 15 wrong exact STEP files; "fillets through tangent-cylinder Booleans" is marked a conjecture | [../hybrid-boolean-plan.md][w-hyb] |
| Exact predicates | `kernel/robust-predicates.bend`: filtered decisions with an exact fallback in signed base-4096 integers | working tree |
| Offsets and shells | only [theory.md §12][w-theory] and the sdf prototype's `f − r` offset | [../proto-sdf.md][w-sdf], [SDF chapter][c-sdf] |

### 1.8 Offset and shell usage in Marc's corpus (MEASURED, this chapter)

Method: `rg -l --glob '*.fs' --glob '*.py' -e <op>` over `~/Workspace/cad`,
read only, on 2026-09-24. The counts are files, revision copies included. They
are not normalised to families the way [corpus.md][w-corpus] does it.

| Operation | Files | Shape of use |
|---|---:|---|
| `opOffsetFace` | 67 FS files in 3 projects: cad-project-014 50, cad-project-002 12, cad-project-039 5 | 51 calls are `opOffsetFace(…"fitAllowance", {"moveFaces": qOwnedByBody(plug, EntityType.FACE), "offsetDistance": .15 * millimeter})` followed by a cut. The rest are ±0.2 to 0.35 mm allowances on face sets, plus one `(4.2 − 0.5)/√2` |
| `opShell` | 1 | |
| `opThicken` | 2 (one call site, `skirt_split.fs`) | |
| `opMoveFace`, `opDraft` | 1 each | |
| `opFaceBlend`, `opFullRoundFillet`, `opExtractSurface` | 0 | |
| build123d shell (`openings=`) | 8 lines | most `offset(` hits in Python are datum-plane offsets, not solid offsets |

One example: in
`cad-project-014/bottom-drive-review-2026-09-19/iterations/r12-0/source.fs`
l.518-520 the comment reads "offset the exact keyed envelope for 0.15 mm fit
clearance". The plug unites an imported caster insert with a cylinder.
Imported tool bodies can carry fillets, so an offset tier must handle tori
and spheres from its first day (INFERRED).

### 1.9 Licensing for porting

| Source | License | What wonky may do |
|---|---|---|
| Onshape FS std library | MIT (© PTC) | copy the wrappers, enums, bounds and error strings with the notice ([note][n-fs]) |
| OCCT TKFillet, BRepOffset | LGPL-2.1 with exception | study only; production must not use OCCT ([../fillet.md §3.4][w-fillet]) |
| remus | Apache-2.0 up to brepkit v2.129.15 | port with NOTICE. Later brepkit is AGPL-3.0: never read it ([note][n-remus]) |
| monstertruck, truck | Apache-2.0 | port with NOTICE ([note][n-mt]) |
| keel; BREP_kernel | GPL-3.0; custom with a give-back clause | ideas only ([implementations.md][w-impl]) |
| libfive | MPL-2.0 kernel, GPL Studio | study ([note][n-libfive]) |
| hg_sdf | CC BY-NC | never copy; rewrite the trivial formulas |
| Hyperbook software | non-commercial | math only ([note][n-pmc]) |
| Papers | publisher copyright | reimplement the math; do not copy text or figures |
| Parasolid and ACIS docs | proprietary | read only; re-express the concepts ([Parasolid][n-ps], [ACIS][n-acis]) |
| HP US5615317A, US6133922A | expired | free to implement ([note][n-hp]) |
| Siemens US9690878B2 (to 2036-04-24), US8935130B2 (to 2032-12-15) | active | do not build ribbon-breaker reblending; check before recognising notch or cliff chains in imports ([../fillet.md §3.3][w-fillet]) |
| Geomagic US8004517B1 | active to 2027-12-17 | check its claims before any setback patch ([note][n-vr]) |

---

## 2. Comparison table

The first 18 rows are this topic's deep reads. The last four are related deep
reads from other chapters that this chapter relies on. "md / json" means that
the published note and the newer JSON re-read disagree on the verdict.

| Source | Kind | Status | License | Verdict | Key idea | Note |
|---|---|---|---|---|---|---|
| Onshape FS std library (`opFillet`, `opChamfer`, `opShell`, `opThicken`, `opOffsetFace`) | library source | mirror of FS 2960; manual 3083 export 2026-09-23 | MIT | adopt | exact op contracts, hidden keys, bounds, 13-code fault enum mapping 1:1 onto Parasolid | [note][n-fs] |
| Onshape help: Fillet, Face blend | product docs | live | proprietary text | adopt | user-level semantics, e.g. width = chord, rho ranges, face-blend vocabulary | [note][n-help] |
| Parasolid v12 Functional Description, blending chapters | vendor docs | historical, concepts current | proprietary | learn-from | attach/check/fix; vertex rules; 4 overflow types with a default table; 15 faults | [note][n-ps] |
| ACIS blending docs (R17, R10 BLND/ABL) | vendor docs | historical snapshot | proprietary | learn-from | blend sheet then attach; bi-blend and miter rules; 6-situation propagation; "pocket lost" | [note][n-acis] |
| Rossignac & Requicha 1986 (plus TM-54 thesis) | paper, thesis | historical | Elsevier; TM free | adapt | R_r and F_r as opening and closing; blend primitives by Boolean; clearance and tolerance-equality definitions | [note][n-rr] |
| Vida, Martin, Várady 1994 | survey | full text unreachable | Elsevier | unreachable | vocabulary rebuilt from readable proxies; conic spines scope the analytic tier | [note][n-vmv] |
| Várady & Rockwood 1997 | paper | full text unreachable | Elsevier; related patent to 2027 | unreachable | setback split; 2n-sided patches; ACIS no-setback rule; sphere-corner rank test | [note][n-vr] |
| Braid 1997 | paper | full text unreachable | Elsevier | unreachable | staged blends that reuse the Boolean; remote blends; order dependence | [note][n-braid] |
| Kós, Martin, Várady 2000 | paper | historical, author copy | Elsevier | adapt | blend fixed by (R, side); maximum-ball closed form; table of cylinder and torus cases; 30 % spread on a real scan | [note][n-kos] |
| monstertruck fillet crate | Rust code | one maintainer, HEAD `e6520c2` | Apache-2.0 | adapt | contact circle from a 3×3 solve plus Gauss-Newton; adaptive fit with explicit `None`; silent skips; corners averaged | [note][n-mt] |
| Patrikalakis, Maekawa, Cho, ch. 11 (plus ch. 4/5) | textbook | static (2009) | text free; code non-commercial | learn-from | quadric offsets are exact; pipe theorem r < min(1/κ, r_ee, r_bb, r_eb); collinear-normal seeds | [note][n-pmc] |
| HP/CoCreate patents US5615317A, US6133922A | patents | expired | free | adapt | shrink/swallow Euler walks; gap test; DFS trimming path with backtracking | [note][n-hp] |
| Choi & Ju 1989 | paper | abstract only | Elsevier | learn-from / unreachable | offset-SSI spine plus an exact rational-quadratic section sweep; corner by Taylor interpolants | [note][n-cj] |
| Lukács 1998 | paper | abstract only | Elsevier | learn-from / unreachable | variable-radius blends as sphere envelopes; reality D = \|m′\|² − r′² > 0 (from Peternell-Pottmann) | [note][n-luk] |
| Dupin cyclide blends (Shene; Foufou & Garnier; Chandru, Dutta, Hoffmann) | papers | Shene read in full; Foufou abstract only | copyright | learn-from / adapt | cyclides are variable-radius; the torus is the only constant-radius case; feasibility classifier; offset-closed | [note][n-dupin] |
| Wallner & Pottmann 1997 | paper | preprint read | copyright | learn-from / adapt | Hopf and Blaschke-Grünwald maps: exact rational curves on quadrics; (4,3) freeform C1 transition, not a radius fillet | [note][n-wp] |
| Peternell & Pottmann 1997 | paper | read in full | copyright | adapt | known-contact reflection gives exact rational canal surfaces; tangent-plane fast path; general case numerically fragile | [note][n-pp] |
| Maekawa 1999 (plus the MIT companions) | survey | original unreachable; companions read | copyright; OCW CC BY-NC-SA | unreachable | J = (1+dκ₁)(1+dκ₂) is a local test only; closed self-intersection loops need seeds | [note][n-mae] |
| *OCCT modeling guide, TKFillet/ChFi3d, BRepOffset* | code, docs | active | LGPL-2.1 | adapt (ideas) | the `ChFi3d_KParticular` eligibility table; `E1..E4` residuals; open bugs #1177, #1371, #1495 | [note][n-occt] |
| *remus* | Rust kernel | active, agent-built | Apache-2.0 (≤ v2.129.15) | adapt (contract) | typed fillet refusals; 9 analytic pairs; spindle-torus bound; qualified offset engine | [note][n-remus] |
| *truck* | Rust kernel | maintained | Apache-2.0 | (other chapter) | procedural rolling-ball surface `RbfSurface`; single-edge fillet | [note][n-truck] |
| *libfive* | SDF kernel | active | MPL-2.0 / GPL | (other chapter) | `offset = f − r`, `shell`; `box_exact` vs `box_mitered`; exponential blend | [note][n-libfive] |

---

## 3. State of the art: techniques, their real guarantees, where they break

### 3.1 The closed-form ladder

**What it is.**
- **Two symmetry families** decide when a fillet is exactly analytic
  ([theory §4.1][w-theory]; the individual cases DOCUMENTED in Kós §4, OCCT
  ChFiKPart, Shene Thm 16):
  - both supports invariant under one translation → the fillet is a
    **cylinder** and the chamfer a plane;
  - both supports rotationally symmetric about one axis → the fillet is a
    **torus**, or a sphere when the arc centre lies on the axis, and the
    chamfer a cone, plane or cylinder.
- **OCCT uses a smaller set.** One face must be a plane, the other a plane,
  cylinder or cone, and the spine a line or circle. Everything else walks
  ([OCCT][n-occt]).
- **remus adds** plane/sphere, sphere/cylinder, sphere/cone, parallel
  cylinder/cylinder and coaxial cone/cone ([remus][n-remus]).
- **Trigonometry-free forms exist for plane/plane** ([Onshape std][n-fs],
  theory §4.3; the ball-centre distance and the width are DOCUMENTED in code,
  the rest INFERRED):
  - ball centre at r/cos(θ/2) from the edge along the bisector, or directly
    `c = e + r(m1+m2)/(1+m1·m2)`;
  - each contact line at r·tan(θ/2) from the edge;
  - chord width 2r·sin(θ/2);
  - `tan(θ/2) = |n0×n1| / (1 + n0·n1)`.

**Real guarantees.** The geometry is exact up to evaluation. In every open
implementation, however, the decisions are tolerance tests: *whether* a case
qualifies, which side the ball is on, and whether it fits.
- OCCT: 1e-12 rad, 1e-7 ([OCCT][n-occt]).
- remus: 1e-9 epsilons ([remus][n-remus]).
- wonky A: a 1e-9 mm band in F32x2 for the mitre gap, spring on or past a cap
  edge, consumption coverage and chain agreement ([proto-kpart][w-kpart]
  "Decisions without exact predicates").

**Where it breaks** (all DOCUMENTED):
- **Oblique pairs.** A plane cut obliquely by a cylinder or cone gives a
  conic spine. The fillet is then a pipe around an ellipse, not a quadric
  ([Kós][n-kos] §3.2.5, [Vida note][n-vmv]). None occur in the measured
  corpus ([../fillet.md §2.4][w-fillet]).
- **Spindle torus inside a cylinder** (boss cap, blind-hole floor). The
  quarter tube never reaches the torus's self-intersecting part, so
  r < r_c − ε is the right bound. keel's r ≤ r_c/2 refuses sound geometry
  ([remus][n-remus]; wonky's harness case `pc-post-top-rim-spindle-r3.5`
  confirms it).
- **Half-angle confusion.** The wedge half-angle is (π − ∠(n1,n2))/2.
  Halving the normal angle instead agrees only at 90°. On a 178.9° ridge the
  contacts then land about 100r away instead of about 0.01r
  ([remus][n-remus]).
- **Convexity sign.** In remus the rim of a through hole was read as concave
  because the `reversed` flag alone was used. The fixed rule is
  `convex = plane_bounded == material_inside_cylinder` ([remus][n-remus]).
- **Near-tangent edges.** OCCT fails on the 178.9° ridge and on tangent
  edges. Onshape refuses FP12 with `FILLET_FAIL_SMOOTH`
  ([../fillet.md §6.4][w-fillet], [decision log][w-ent]).

### 3.2 The general rolling-ball solver

**What it is.** Three formulations are documented:
- **OCCT `BlendFunc_ConstRad`**: four unknowns (u₁, v₁, u₂, v₂) per section
  plane, residuals E1..E4, marched by Newton ([OCCT][n-occt]).
- **monstertruck**: a 3×3 ball-centre solve with rows `n0×n1`, `n0`, `n1`,
  plus Gauss-Newton projection onto both supports ([monstertruck][n-mt]).
- **Choi-Ju**: offset-SSI continuation. The JSON re-read adds an explicit
  3×4 Jacobian whose nullspace gives the marching direction, and it labels
  this a reconstruction ([Choi-Ju][n-cj]).

wonky's prototype C does it the Bend way ([proto-rollingball][w-rb]):
- it solves 65 stations per edge independently instead of marching;
- it checks odd-station midpoints against the chords;
- it certifies each station by its maximum-ball residual.

**Real guarantees.** None beyond the Newton residual.
- monstertruck's operation layer is accurate to about 3 % of r in its own
  test ([monstertruck][n-mt]).
- Its decorator path refines adaptively and returns an explicit `None` after
  16 rounds.

The exact validity conditions are known, but no open kernel checks all of
them:
- **Pipe regularity.** The pipe is nonsingular iff
  r < min(1/κ_max, r_ee, r_bb, r_eb) (Theorem 11.6.1, [Patrikalakis][n-pmc]).
  For wonky's line and circle spines this collapses to scalar comparisons.
- **Support offset regularity.** (1 + rκ) > 0 on each support. When a convex
  support has a curvature radius below r, the spring curve loops. ACIS
  detects this and fails ([ACIS][n-acis] §2, `…bg`).
- **Variable radius.** The characteristic circle is real iff
  |m′|² − r′² > 0 ([Peternell-Pottmann][n-pp] eq. 2.4; [Lukács][n-luk]).

**Where it breaks** (DOCUMENTED):
- degenerate normals: OCCT #1495 never returns;
- closed spines with a seam: OCCT #1371 reports success and returns a
  self-intersecting solid;
- no contact circle: monstertruck panics on an `unwrap`;
- `WalkingFailure` and `TwistedSurface` statuses in OCCT;
- marching alone misses closed loops, which need collinear-normal seeds
  ([Patrikalakis][n-pmc] 5.8.2.3; [Maekawa][n-mae]).

### 3.3 Exact representations beyond the quadrics

- **Canal surfaces** ([Peternell-Pottmann][n-pp]):
  - **Known contact.** When one rational contact curve is known, reflecting
    it through the pencil of planes that contain the spine tangent traces
    each characteristic circle rationally. Tangent to a plane, this gives a
    rational surface directly from a rational spine (eq. 4.1).
  - **General case.** It needs a sum-of-two-squares factorization. The
    authors themselves call it inexact with numerical roots (§6.2), and they
    report near-singular parametrizations even on regular pipes (p. 265).
  - **Degree.** Rational centre and radius laws of degree k give bidegree
    (5k−6, 2) after reduction. For a conic spine (k = 2) that is (4, 2)
    (INFERRED from the formula).
  - **The notes disagree on the conic case.** The Choi-Ju `.md` also says
    (4, 2) for the pipe around an ellipse. The Dupin `.md` cites
    Dahl-Krasauskas 2012 as (6, 2) for constant-radius blends with a conic
    spine. Section 6 lists this as open.
- **Dupin cyclides** ([Dupin note][n-dupin]):
  - They are **variable-radius** envelopes with circular contact curves.
  - The torus is the only constant-radius member: two cones can be blended by
    a torus iff their axes are identical (Shene Thm 16).
  - Shene gives a complete feasibility classifier for cone/cone.
  - Cyclides are offset-closed (μ ↦ μ + d), but horn sheets need offsets of
    opposite sign.
  - Both versions of the note agree that cyclides cannot implement
    `opFillet(radius)` without breaking Onshape parity.
- **Wallner-Pottmann** ([note][n-wp]):
  - The Hopf map and the Blaschke-Grünwald map turn polynomial splines into
    rational splines lying exactly on a sphere or cylinder (degree doubles).
  - A (4, 3) C1 transition surface is built from four control rows.
  - It is a designer-driven freeform blend, not a radius fillet, and closed
    trims need turning-number and parity conditions.
- **Real guarantees.** These are algebraic identities in exact real
  arithmetic. The coefficients may be irrational. F32x2 adds mantissa bits
  but no exponent range, and multi-limb integers help only with sign tests on
  rational data (all notes).

### 3.4 Ends and vertices

- **Terminal vertex with a perpendicular cap** is the dominant FDM end:
  27 fillet families ([../fillet.md §2.4][w-fillet]).
- **Parasolid's configuration rules** ([Parasolid][n-ps] §29.3-29.4):
  - one blended edge at a 3-edge vertex: normally fine;
  - two of three: both blends must add material or both remove it;
  - three of three: an extra vertex face is inserted;
  - at a 4-edge vertex, blending two edges is constrained;
  - vertices with 5 or more edges cannot be blended unless every edge is.
- **ACIS sequences** ([ACIS][n-acis] §3, §8):
  - **bi-blend**: two blended edges meet tangentially and the blends mate
    exactly;
  - **miter**: same convexity, at most two other non-smooth edges;
  - **complex miter**: a side surface is extended as a partial end cap;
  - **smooth-edge propagation**: a six-situation table, which is a ready
    specification for `tangentPropagation`.
- **Sphere corner.** It needs equal radii and uniform convexity.
  - At valence 3 it always exists: a 3×3 solve of `n_i·c = d_i ∓ r`
    ([Várady-Rockwood][n-vr]).
  - At valence ≥ 4 it exists iff the offset planes meet in one point, which
    is an exact rank test.
  - theory.md §6.4 argues that a sphere corner exists whenever three
    equal-radius, same-convexity blends meet, not only at planar corners
    (INFERRED there).
- **Horn torus.** A concave fillet rolling past a sharp convex edge gives a
  horn torus (theory §6.3). ACIS allows exactly this "osculating torus"
  ([ACIS][n-acis] §9).
- **Setback patches.**
  - ACIS: an n-sided Gregory patch with a bulge factor; with no setback it
    takes "the intersection farther from the vertex"; its autosetback
    heuristic has a documented valid domain ([ACIS][n-acis] §6).
  - Mixed-convexity miters are non-unique, so ACIS refuses them.
  - Choi-Ju fill corners with a convex combination of Taylor interpolants.
    The weights are unread, and the JSON re-read declines to reconstruct them
    ([Choi-Ju][n-cj]).
- **Corpus reality.** Zero setbacks and one mixed-convexity corner
  (`project-component-4c7a33fe`). Onshape builds FP14 as 3 cylinders and a torus
  ([proto-kpart][w-kpart]).
- **Where open kernels stop at corners:**
  - OCCT uses Plate approximations;
  - monstertruck averages the seam control points (section 4.1);
  - ogeom-rs #18 plans a fitted patch;
  - remus returns `UnsupportedVertexBlend`.

### 3.5 Attaching the blend to the body

There are two routes ([theory §13][w-theory]).

**The Boolean route.**
- **Sources:** Rossignac's blend primitives ([note][n-rr]), ACIS stage 2,
  Braid's "use of existing Boolean code" ([note][n-braid]), and Marc's own
  skill practice, e.g. `Cylinder(R+r) − Torus(R+r, r)`
  ([commercial.md][w-comm]).
- **Guarantee:** it inherits whatever the Boolean guarantees. Obliterated
  holes, remote interactions and notch overflow come out of the Boolean for
  free.
- **Where it breaks:** the tool is tangent to both supports along the spring
  curves and coplanar with them. That is the hardest Boolean degeneracy.
  - SolveSpace #1291, "a fillet-shaped difference tool tangent to cube
    faces", took four years and five separate fixes. The later grazing fix
    (#1751/#1760) then broke the opposite face ([SolveSpace note][n-ss]).
  - wonky's hybrid stage [C] refuses near-tangent carrier pairs today
    ([hybrid plan][w-hyb]).
  - BREP_kernel documents cutter overshoot and order dependence
    ([implementations.md][w-impl]).

**Local surgery.**
- **US5615317A** (shrink and swallow, [HP note][n-hp]):
  - walk the edges at each end vertex;
  - an edge the blend boundary misses is killed with `kev`; a face that loses
    all its edges is removed with `kbfv`;
  - intersect with each edge's *original* 3D curve;
  - check the intersection count against the expected number.
- **US6133922A** (growing neighbours):
  - it deliberately goes through a geometrically inconsistent intermediate
    state;
  - the gap test `start(I) ≠ end(O)` finds open faces;
  - a DFS finds the trimming path, ordered by smallest angle and then
    shortest segment, with ray shooting to extend short edges, validity
    checks and backtracking;
  - simultaneous blends can merge faces.
- **Guarantee:** the patents claim it, with no tolerances and no analysis.
- **Where it breaks:** the 1996 background admits that growing topologies
  were "not handled reliably". Its FIG. 7c shows a non-manifold outcome that
  the validity check exists to reject.

**The hybrid worth building** ([theory §13.4][w-theory],
[../fillet.md §5.6][w-fillet]; INFERRED):
- surgery when every contact stays on its face and the caps are simple;
- the Boolean only for overflow, notch and interference;
- a global interference check always.

### 3.6 Overflow, consumed faces, interference

- **Parasolid's overflow model** ([note][n-ps], ch. 31):
  - internal vs external overflows, their bounds, overflow edges and
    convexity;
  - four types: smooth, cliff, cliff-end, notch;
  - the default attempt order is smooth → cliff → notch, with a table of
    eight worked defaults;
  - "When no allowed overflow type can be created, the blend operation
    fails."
- **ACIS remote blends** switch to face-face, edge-face or edge-edge blends.
  This is restricted to networks without vertex blends or miters
  ([ACIS][n-acis] §5).
- **remus stops at the cliff** with
  `CliffEncountered{edge, face, requested_radius, available_radius}` and
  never reduces the radius silently ([remus][n-remus]).
- **Consumed faces and full rounds.**
  - OCCT #1177: a 10 mm box with R5 on two opposite edges fails; R4.99 works
    and leaves a sliver. This has been open for more than 10 years
    ([OCCT][n-occt], [../fillet.md][w-fillet]).
  - Exactly, at r = t/2 both fillet cylinders share one carrier and the face
    between them vanishes ([theory §10.3][w-theory]).
  - Onshape builds these cases (decision log).
- **Interference.** ACIS checks locally by default and loses a pocket.
  Global checking is an option there ([ACIS][n-acis] §7). A global BVH check
  is cheap in a parallel kernel (INFERRED, [Braid note][n-braid]).
- **This is the corpus's hard rest.** Five overflow families; in
  cad-project-046's radius loop, 154 of 167 OCCT calls fail
  ([../fillet.md §2.6][w-fillet]).

### 3.7 Chamfers

- **Definitions.** Face offset, in-support distance, and distance plus angle
  ([theory §5.1][w-theory]).
- **Onshape measures `EQUAL_OFFSETS` in-support**, with a triangular
  three-edge corner (correction 2).
- **Families** ([theory §5.3][w-theory], [OCCT][n-occt] `ChPlnCyl`,
  `ChPlnCon`):
  - translation family → plane;
  - rotation family → cone, plane or cylinder;
  - anything else → a rational ruled surface (INFERRED).
- **Chamfers are not tangent to their supports.** "In general, chamfer
  blends are not tangent continuous" ([Parasolid][n-ps]). So a chamfer tool
  body avoids the tangency degeneracy of section 3.5, which makes chamfers
  the safest first candidate for a Boolean attach (INFERRED).
- **Handedness.** Onshape needed `V414_ASYMMETRIC_CHAMFER_MIRROR_BUG` for
  mirrored asymmetric chamfers, so tests must include mirrored instances
  ([Onshape std][n-fs]).
- **Undefined chamfers.** Parasolid's "not defined at all" case for very
  unequal ranges (Fig. 29-5) belongs to face-offset semantics. Under the
  measured in-support rule, `TWO_OFFSETS` fails differently: at a contact
  beyond the face boundary (INFERRED).

### 3.8 Offsets, shells and thicken

**Two semantics** (DOCUMENTED; [theory §12.2][w-theory]):

- **Arc join** (Euclidean): pipes at convex edges, spheres at vertices.
  - Rossignac's offset ([note][n-rr]); OCCT `GeomAbs_Arc`; SDFs with exact
    distance fields.
  - remus builds it only for all-convex planar polyhedra and refuses curved,
    concave, holed and inward cases rather than falling back to a miter
    ([remus offset][remus-off]).
- **Intersection join** (extend and intersect, sharp edges).
  - Parasolid hollow: "created new edge geometry where the offset surfaces
    intersected … extending the underlying surface(s)"
    ([Rossignac note][n-rr], citing Parasolid FD ch. 19).
  - OCCT `GeomAbs_Intersection`.
  - The SDF `f − r` on carrier-wise fields ([SDF chapter][c-sdf]).

**Parasolid hollow in detail** ([Rossignac note][n-rr]):
- positive offsets grow the body, negative ones keep its size;
- opening faces are "pierce faces", reduced by a local Boolean;
- per-face offset values are allowed;
- self-intersections are handled "accurate" (cut at the self-intersection,
  which may leave sharp edges) or "approximate" (the recommended method);
- optional `offset_step` side faces.

**OCCT** ([note][n-occt]):
- `PerformByJoin` does exact continuation plus intersection.
- `PerformBySimple` offsets every face independently, and its
  "tolerances have to grow in order to cover the gaps".
- `BRepOffset_Error` lists `BadNormalsOnGeometry`, `C0Geometry`,
  `CannotTrimEdges`, `CannotFuseVertices`, `MixedConnectivity` and others.

**remus `offset`** ([skill][remus-off], DOCUMENTED at `1dc3763e`):
- an 8-phase pipeline:
  1. `analyse`: edge convexity classes;
  2. per-face offset: planes translate; cylinder, cone, sphere and torus
     radii adjust; NURBS are interpolated on a 16×16 grid;
  3. `inter3d`: 3D intersections of adjacent offset faces;
  4. `inter2d`: samples become edges, certified as circles where they fit;
  5. `loops`: one closed wire per face;
  6. `assemble`: every shell must validate closed;
  7. `self_int`: a fail-closed fold detector;
  8. `cavity`: signed offsets per shell;
- only one fold is proven removable, the uniform L-prism;
- `thick_solid` refuses a body that already has a cavity;
- `move_faces` refuses topology changes and rolls back.

**Exact mathematics** ([Patrikalakis][n-pmc], [Maekawa][n-mae]):
- offsets of the natural quadrics are natural quadrics;
- self-intersection curves of offset implicit quadrics are planar conics;
- the cone apex has no normal;
- J = (1+dκ₁)(1+dκ₂) = 1 + 2Hd + Kd² is a *local* test only;
- global self-intersection needs seeds at collinear-normal pairs.

**Topology changes under intersection join** (INFERRED; each is a scalar or
small exact test on wonky's carriers):
- **Faces vanish.** An outward offset shrinks faces at concave edges; an
  inward offset shrinks faces at convex edges.
- **Vertices split.** A vertex of valence ≥ 4 turns into an edge unless the
  offset planes meet in one point. This is the same rank test as the sphere
  corner.
- **Carriers collapse.** A cylinder collapses at ρ + d = 0, a torus tube at
  m + d = 0, and a cone passes its apex.
- **Imported fillets** change radius or collapse. An inner fillet of radius
  r − t disappears at r ≤ t ([theory §12.3][w-theory]).

**Real guarantees.** OCCT and Parasolid claim none. remus gates every shell on
being closed and, after the inside-out bug (section 4.1), on a negative
signed-volume postcondition.

### 3.9 Oracles and invariants

| Oracle | What it checks | Source |
|---|---|---|
| R_r(S) ⊂ S ⊂ F_r(S), idempotence, R_a(R_r S) = R_r S for a ≤ r | global semantics, property tests | [Rossignac][n-rr] |
| Steiner volume of a box with all edges rounded; `roundX` ΔV = −(4−π)r²a | closed-form volumes; topology F = 26, E = 48, V = 24 and F = 10, E = 24, V = 16 | [Onshape std note][n-fs], [Rossignac][n-rr] |
| Maximum-ball residual per sample point | constant radius between the two supports, side, spine, trim, independent of the construction | [Kós][n-kos] §3.3; used by wonky C |
| Envelope residuals \|x−m\|² = r², (x−m)·m′ + r r′ = 0 | any canal or approximate blend | [Peternell-Pottmann][n-pp] §2 |
| Gap test O1/O4 (incoming edge end = outgoing edge start, geometrically) | every local topology edit | [HP][n-hp] |
| (F, E, V) and volume must change | catches the silent no-op | [remus fillet skill][remus-fb] |
| Wall volume and winding, negative signed volume | inside-out offsets | [remus offset skill][remus-off] |
| X↓ε ⊂ Y ⊂ X↑ε; clearance ≥ 2r ⇔ (X↑r) ∩ (Y↑r) = ∅ | compare, clearance, interference | [Rossignac][n-rr] p. 30 |
| Exact algebraic identities of rational maps (y₁² + y₂² + y₃² = y₀²) | transcription errors in formulas taken from papers | section 4.1 |

### 3.10 Summary

| Technique | Guarantee | Bend fit | Breaks at |
|---|---|---|---|
| Closed-form ladder | exact geometry; decisions tolerance-based everywhere | per-edge 2D solve, uniform, F32x2 | oblique pairs, near-tangency, spindle bounds, sign conventions |
| Rolling-ball solver | residual only; exact validity conditions known | independent stations, fork-join/GPU; Newton self-corrects in F32x2 | degenerate normals, seams, missing contact, loops |
| Rational canal/cyclide forms | algebraic identities | fixed-degree evaluation, uniform | irrational coefficients, near-singular charts, variable radius (cyclides) |
| Vertex rules and sphere corners | exact for equal radius and uniform convexity | per-vertex table in U32; exact rank test | mixed convexity, valence ≥ 4, unequal radii |
| Attach by Boolean | as good as the Boolean | reuse the hybrid | tangency, coplanarity, cutter overshoot |
| Attach by surgery | claims only | irregular graph work, CPU fork-join; persistence makes backtracking free | growing topology, ambiguous hits at vertices |
| Offsets of the zoo | exact carriers | per-face map plus the Boolean's SSI | collapse, vanishing faces, vertex splits, self-intersection |

---

## 4. War stories and anti-patterns

### 4.1 War stories (DOCUMENTED unless marked)

**Success with a wrong or empty result**

- **OCCT #1371** (open, 2026-07-14): `MakeFillet` on a closed rational
  B-spline rim reports full success (IsDone, 0 faulty contours) and returns a
  self-intersecting solid. The defect sits at the seam vertex
  ([OCCT][n-occt]).
- **ACIS "pocket lost".** With the default local interference check, a
  round of 20 next to a blind pocket succeeds and the pocket is gone. Global
  checking is an off-by-default option ([ACIS][n-acis] §7). The note records
  the exact Scheme coordinates.
- **remus: the silent no-op, in two layers.** `try_fillet` returns the input
  solid unchanged when every edge is filtered out or no engine produced a
  closed shell. `fillet_solid` then reports `Ok(original)`. "'Ran without
  error' plus 'solid verifies' both green-light a no-op." The skill's
  remedy: assert that (F, E, V) and volume changed ([remus fillet
  skill][remus-fb]).
- **monstertruck** swallows `GeometryFailed` and restores a checkpoint when a
  chain fails. Strictness is an environment variable, surfaces silently
  degrade to a 64×64 bilinear grid, and fillet faces are built with
  `Face::new_unchecked` ([monstertruck][n-mt]).
- **FreeCAD keeps invalid OCCT results and patches tolerances**
  ([../fillet.md §3.2][w-fillet]).

**Wrong geometry that passes the tests**

- **monstertruck averages the seam control points at wire corners.** On a box
  top this puts the corner trim point about 0.71 r from the exact point
  (INFERRED by hand from the code). Its multi-edge tests assert only face
  counts ([monstertruck][n-mt]).
- **remus offset: the shell had both skins.** The skill's example is a 10 mm
  cube shelled outward by 1 mm, which measured 2584 mm³ instead of 584 mm³.
  (584 = 12·12·11 − 10³, consistent with one open face; that reading is
  INFERRED.) The cause: loops were wound to the effective normal and the
  assembler flipped the offset skin. The skill notes that the result was
  "census-exact its whole life" ([remus offset skill][remus-off]).
- **remus offset: inward past half the thickness returned `Ok` inside out.**
  −6 mm on a 10 mm box gave 8 mm³; −1e6 gave 8e18. Planes only translate, so
  no radius guard ever fires. The general validator has no orientation check,
  and the fix is a signed-volume postcondition per operation
  ([remus offset skill][remus-off]).
- **remus offset, three more** ([remus offset skill][remus-off]):
  - HashMap iteration mixed two loop paths, which gave intermittent free edges
    and volumes that changed between runs (pinned by a 64× repeat test);
  - plane/plane joints used a 1 % margin instead of exact endpoints;
  - a torus needed a dedicated concentric rebuild, because its doubly
    periodic seam wire defeats every generic loop strategy.
- **remus fillet, three sign and bound bugs** ([remus][n-remus]):
  - the rim of a through hole was read as concave;
  - halving the normal angle put contacts 100r off on a 178.9° ridge;
  - keel's r ≤ r_c/2 bound refuses sound spindle tori.

**Failures that last**

- **OCCT #1177**: a full round on a 10 mm box fails at R5 and works at
  R4.99 with a sliver face. It has been open in some form since about 2015
  ([OCCT][n-occt], [../fillet.md][w-fillet]).
- **OCCT #1495**: a search loop over an `int` denominator never terminates
  when no non-degenerate normal exists ([OCCT][n-occt]).
- **OCCT fails a real chamfer.** It fails the 0.42 mm chamfer chain of
  Marc's `r22-planar-guides.fs` (20 edges), while a reconstructed look-alike
  works. The cause is unknown ([../fillet.md §2.6][w-fillet]).
- **SolveSpace #1291**: "a fillet-shaped difference tool tangent to cube
  faces" took four years and five separate defects to fix (tangent-fold
  misclassification, grazing intersections, orientation of tangent curves,
  …). The grazing fix (#1751/#1760) then broke the opposite face
  ([SolveSpace note][n-ss]). This is the blend-by-Boolean route failing on
  exactly its hardest case.
- **monstertruck #24**: the flagship `filleted-spheres-cube` example dies in
  the first Boolean. It was closed as won't-fix: "the truck CSG code isn't
  great/useful for production" ([monstertruck][n-mt]).

**Degeneracies and non-uniqueness**

- **ACIS `ABL_GEOM_EDGE_STAT`**: the same block works as analytic geometry
  (the osculating-torus special case) and fails after conversion to splines.
- **ACIS `ABL_CHG_PT_COMPLEX_EDGE`**: "small tweaks to the radius do not
  help". The case works from r = 15, once the change point leaves the smooth
  edge ([ACIS][n-acis]).
- **Parasolid**: blends that fail when fixed together succeed when fixed one
  after another. The checker "is not foolproof". A cliffedge overflow turns
  into a notch as the radius grows ([Parasolid][n-ps]).
- **HP 1996, background section**: growing topologies "are not handled
  reliably", which leads to failure or "a body which is actually not
  manufacturable". FIG. 7c shows a non-manifold outcome ([HP][n-hp]).
- **Rossignac 1985**: PADL-2's torus vertex blends were not smooth. Global
  filleting bridges disjoint spheres and fills slots narrower than 2r
  ([Rossignac][n-rr]).
- **Shene 2000**: the "offset, blend, offset back" shortcut for cyclide
  blends fails silently for some configurations (Pratt). The Cranfield object
  provably cannot be blended with one cyclide ([Dupin note][n-dupin]).
- **Kós 2000, real scan**: methods that agree to 0.1 % on synthetic data give
  3.29, 3.71 and 4.35 on one real blend, a 30 % spread ([Kós][n-kos]).

**Semantics and transcription (found in this research)**

- **The chamfer rule was inferred wrongly** in four notes and in theory.md,
  and one Onshape probe overturned it (correction 2). A semantics question
  that the documents leave open cannot be settled by more reading.
- **Wallner-Pottmann eq. (1) is misprinted, and both notes copy it wrong**
  (MEASURED with node, [preprint p. 2][wp-pdf]):
  - The preprint prints y₁ = 2(x₀x₁ − x₂x₃), y₂ = 2(x₁x₃ − x₀x₂),
    y₃ = x₁² + x₂² − x₀² − x₃². At x = (1,1,1,1) this gives y = (4,0,0,0),
    which is not on the unit sphere (residual −16).
  - The published `.md` copies the misprint verbatim ([note][n-wp]).
  - The JSON re-read flips the sign in y₁ but also rewrites y₃ as
    x₀² − x₁² + x₂² − x₃². That fails at (1,2,3,4) (residual 84).
  - Flipping only the sign in y₁, to 2(x₀x₁ + x₂x₃), satisfies
    y₁² + y₂² + y₃² = y₀² on every tested input.
  - Lesson: formulas taken from papers, and from agent-written notes about
    papers, need an identity test before any port.

**Practice and defaults**

- **Marc's corpus** has 41 blend calls in `try` and 30 in loops, often
  falling back to a smaller radius. Where wonky refuses and Onshape succeeds,
  the part changes shape silently ([../fillet.md §2.3][w-fillet]).
- **build123d's `max_fillet()` bisects**, which assumes that feasibility is
  monotone in r. It is not (F16 in [implementations.md][w-impl]).
- **Parasolid V35 grows tolerances on failure** by default, up to 1e-5 m per
  blend. Some Onshape successes may depend on it (INFERRED,
  [../fillet.md §3.3][w-fillet]).
- **Bend-specific**, from prototype C ([proto-rollingball][w-rb], MEASURED
  there):
  - `Bool.pick` evaluates both branches, so recursive walks went exponential
    (more than 2 min, down to 277 ms after the fix);
  - making the whole build the Metal device call overflowed the machine
    stack; restricting the device call to the station solve took the Metal
    build from 504 s to 35 s;
  - records wider than 255 words broke the native build;
  - Metal flushes subnormals.

### 4.2 Anti-patterns (INFERRED from the war stories)

| Anti-pattern | Seen in | Instead |
|---|---|---|
| Success that changes nothing, or skips edges | remus, monstertruck | assert completeness and that (F, E, V) and volume changed |
| Success with a wrong result | OCCT #1371, ACIS local interference | "fixing is the check": build, then validate globally, then fail explicitly |
| Approximating what has a closed form | monstertruck (NURBS everywhere); ACIS spline conversion loses the osculating torus | closed-form ladder first; approximation only as a labelled opt-in |
| Averaging seams instead of a miter or corner | monstertruck | explicit miter or sphere corner, or a typed refusal |
| Trying both orientations to hide inconsistent input | monstertruck `flip_side` | guaranteed orientation from the Boolean |
| A predictive checker separate from construction | Parasolid "not foolproof" | one path: construct and validate |
| Silent tolerance growth | Parasolid V35 default, OCCT `PerformBySimple`, FreeCAD | report the tolerance that would be needed |
| Recognising blends instead of tracking them | Onshape `DIRECT_EDIT_FAILED_TO_IDENTIFY_FILLETS`; Parasolid delete-blends needs tracking | provenance tags at creation (vx_twin style) |
| Sign conventions without tests | half-angle, convexity flag, offset side, curvature sign ([Maekawa][n-mae]) | one documented convention per quantity, with a test per sign |
| Validation that proves nothing | Euler on the unchanged input; census-exact but inverted; face-count-only tests | volume, winding, sampled geometry near corners |
| Bisection for the maximum radius | build123d | closed-form bound where one exists, otherwise a typed "unknown" |
| "Offset, solve, offset back" shortcuts | cyclide blends (Pratt, Shene) | solve the real problem, or prove the commutation |
| Mutable request state on the body | ACIS attributes between attach and fix | immutable FS maps keyed by resolved edge identity |
| Nondeterministic iteration | remus HashMap loops | deterministic orders; cross-target byte identity |
| Trusting transcribed formulas | Wallner-Pottmann eq. (1) | identity tests on random rational inputs |

---

## 5. What wonky should take: ranked proposals

The ranking weighs value for Marc's corpus against effort and risk. P1 and P2
serve prototype A, the likely winner of the fillet bake-off. P3 covers the
largest usage that no plan addresses yet. P4 connects the fillet bake-off to
the Boolean hybrid (corefine + recover). Every proposal is INFERRED unless a
source is named.

### P1. Put every ladder decision on the exact-predicate path

- **Idea.** Phrase each admission decision of the ladder as the sign of a
  polynomial in stored values, evaluate it through the filter-plus-exact path
  of `kernel/robust-predicates.bend`, and otherwise return a typed
  `undecidable` that names the numbers. Examples:
  - convexity of a plane/plane edge: sign of (n₀ × n₁)·t;
  - fit of a fillet on a face: r·tan(θ/2) ≤ w. With unnormalised normals
    this is r·|n₀×n₁| ≤ w·(|n₀||n₁| + n₀·n₁). Isolate one square root at a
    time, check signs, and square; two rounds leave a polynomial sign test;
  - rim fillets: r < ρ (a torus), r = ρ (a sphere), and the spindle bound;
  - the in-support chamfer setback against the face width;
  - sphere-corner concurrency at valence ≥ 4, which is also the offset
    vertex-split test of P3: a 4×4 determinant of the offset-plane system;
  - the "smooth edge" threshold behind FP12's `FILLET_FAIL_SMOOTH`. This one
    must be a declared angular tolerance, not an accident of ulps.
- **Where.** `kernel/proto/fillet-kpart/bounds.bend` and `ladder.bend` (the
  1e-9 mm band), then production. For C: replace the sampled overflow checks
  (17 samples per edge) with exact tests of line and circle contact curves
  against the face boundaries.
- **Bend fit.** F32x2 words are dyadic rationals, so stored inputs can be
  lifted exactly into U32 multi-limb integers. The filter runs in F32x2.
  Decisions are uniform per edge and fork-join over edges.
- **Benefit.**
  - It closes the risk that prototype A records itself
    ([proto-kpart][w-kpart], "Decisions without exact predicates";
    [../fillet.md §5.1][w-fillet]).
  - Verdicts become identical across js, cpu and Metal, whatever FMA or
    subnormal flushing does (C1 found that Metal flushes subnormals).
  - No blending source does this at all (section 1.6).
- **Risk.**
  - The degree grows with every square root removed.
  - Offset constants d·|n| are irrational for non-unit rational normals
    (section 6, question 3).
  - Cost, though these tests run once per edge, not per sample.
- **First acceptance test.** The boundary sweeps of
  [../fillet.md §6.3][w-fillet]:
  - sweep r across the face width, across ρ, and across the chamfer width;
  - the verdict must flip exactly at the threshold, which the JS checker
    computes in rationals;
  - verdicts must be identical on js, cpu1, cpuN and Metal;
  - verdicts must survive 1e-13 relative perturbations and a rigid
    translation by 1000 mm (the translation-variance bug class in remus).

### P2. Stage 3: attach by pure-functional surgery, check gaps, always check interference globally

- **Idea.**
  - Build prototype A's stage 3 as the US5615317A shrink-and-swallow walk
    per stripe end. `KEV` and `KBFV` become pure rewrites on immutable
    arrays, and a pending-geometry flag must never leave the operation
    ([HP][n-hp]).
  - Post-conditions:
    - the O1/O4 gap test on every face at every touched vertex;
    - a global BVH interference check of the new faces against all faces,
      with no local-only mode ([ACIS][n-acis] §7, [Braid][n-braid]);
    - (F, E, V) and volume changed.
  - Emit provenance events: face F shrank, was swallowed, or grew; blend
    face from edge E; corner face from vertex V (Parasolid `vx_twin` style).
  - Growing neighbours (US6133922A) are refused with a type in v1, or routed
    to P4.
- **Where.** `kernel/proto/fillet-kpart`, stage 3. The events feed the
  identity layer ([topology chapter][c-topo]) and the diff viewer.
- **Bend fit.** The walks are irregular but independent per stripe end, so
  both ends of an edge can run as one fork-join. Persistence makes
  backtracking free. The BVH query is uniform work.
- **Benefit.**
  - Exact geometry and face identity are preserved, which the Boolean route
    would weaken.
  - It covers terminal caps, miters, sphere corners and full-round merges,
    where OCCT fails.
  - Defillet and modify-fillet become lookups.
- **Risk.**
  - Bend verbosity: A1 alone is 3.2k lines.
  - Coplanar fragments (an A2 open item).
  - Seams on periodic faces (the #1371 class).
  - The gap test is a geometric equality, so it must use P1's predicates.
- **First acceptance test.**
  - `roundX`: ΔV = −(4−π)·r²·a to 1e-9 relative, with F = 10, E = 24,
    V = 16.
  - All 12 edges of a box: the Steiner volume, with F = 26, E = 48, V = 24.
  - `hard-full-round-r5` builds.
  - The ACIS "pocket lost" fixture, rebuilt in FS (cube [−30,30]³, blind
    pocket r = 5 at (20,0,20), round 20 on the top edge at x = 30): the
    result keeps the pocket or refuses, and never drops it.

### P3. Offsets for fit allowances: `opOffsetFace` with intersection join, exact on the carrier zoo

- **Idea.**
  - Implement `@opOffsetFace` (all faces of a body, or a face set) with the
    intersection-join semantics of Parasolid, which Onshape inherits (to be
    probed, section 6):
    - every moved face offsets its carrier exactly: a plane shifts;
      cylinder and sphere radii change by ±d; a cone keeps its axis origin
      and half-angle, with radius ρ₀ + d/cos α; a torus changes its minor
      radius by ±d ([theory §12.1][w-theory]);
    - adjacent moved faces are re-intersected with the Boolean's analytic
      SSI, and unmoved neighbours are extended or trimmed.
  - Detect topology changes exactly (P1 predicates) and refuse them in v1
    with typed reasons: `OffsetCollapse{face, d, radius}`,
    `OffsetFaceVanishes{face}`, `OffsetVertexSplit{vertex}`.
- **Where.** A new FS builtin `@opOffsetFace`, backed by a Bend function
  `offset(body, faces, d) → Result`. It reuses the hybrid's SSI and the new
  Sphere and Torus carriers.
- **Bend fit.** The carrier offset is a uniform map per face.
  Re-intersection is fork-join over adjacent pairs. The collapse tests are
  scalar.
- **Benefit.**
  - It unlocks the 51+ fit-allowance calls in cad-project-014 and
    cad-project-002 (MEASURED, section 1.8), far more than `opShell`.
  - It multiplies with the Boolean integration: the offset tool is cut next.
  - Offsets of imported fillet faces stay exact (tori and spheres).
- **Risk.**
  - Onshape's join semantics are not yet probed.
  - Imported B-spline faces in a tool need the approximate path (opt-in) or
    a refusal.
  - Offsets large enough to self-intersect; fit allowances of 0.15 to
    0.35 mm rarely are.
- **First acceptance test.**
  - A 10×20×30 box offset by +0.15 on all faces gives exactly
    10.3×20.3×30.3.
  - A cylinder r = 4, h = 77 gives r = 4.15, h = 77.3.
  - −6 on a 10 mm box gives a typed refusal, never an inside-out body; every
    `ok` has positive signed volume.
  - The r12-0 caster plug matches an Onshape probe export to 1e-6 mm, or
    refuses naming the face type.
  - The result is invariant under translation.

### P4. Candidate B: tangency by carrier identity, and Parasolid's default table as the overflow oracle

- **Idea.**
  - The tool body shares **carrier records** with the supports (the same
    plane object, the same cylinder).
  - The spring curves go to recover as known exact edges, so the Boolean
    never has to *discover* tangency. This is the Boolean chapter's "decide
    once" ([Boolean chapter][c-bool] P9; [Rossignac][n-rr]).
  - Start with **chamfer tools**, which are not tangent to their supports
    (section 3.7). Then move to fillet tools.
  - Encode Parasolid's eight default cases (internal/external × smooth/sharp
    bound × same/opposite convexity, [Parasolid][n-ps] ch. 31) as data.
    Accept B's notch result only where the table says notch; refuse with a
    type elsewhere.
- **Where.** A new `kernel/proto/fillet-boolean`, plus the declared-tangency
  interface in corefine stage [C] and recover. Decision 8 allows it
  ([../entscheidungen.md][w-ent]).
- **Bend fit.** Tool construction is uniform per stripe; the Boolean is the
  hybrid's.
- **Benefit.** It is the only v1 route to the 5 overflow families (208
  calls), to holes swallowed by a blend, and to interactions with distant
  faces.
- **Risk.**
  - SolveSpace #1291 is exactly this class of failure.
  - The hybrid is "not yet" safe near tangencies ([plan][w-hyb]).
  - Where Parasolid's smooth overflow applies, notch gives a different shape.
  - Cutter overshoot.
  - Runtime: every fillet becomes a full Boolean.
- **First acceptance test.**
  - For the Onshape overflow probes FP01, FP05, FP06, FP07, FP09, FP11 and
    FP13 ([proto-kpart][w-kpart]), the volume lies inside Onshape's stated
    mass-property range and the exact STEP validates.
  - Zero wrong `ok` answers on the hybrid's tangent adversarial suites.
  - Where the table predicts smooth, the result is a typed refusal.

### P5. Faults as data: Onshape names on two axes, with numbers

- **Idea.**
  - One fault family keyed by Onshape's names (`FILLET_*`, `CHAMFER_*`,
    `VRFILLET_*`, `SHELL_FAILED`, `DIRECT_EDIT_OFFSET_FACE_FAILED`), so FS
    `try`/`catch` behaves as in Onshape ([Onshape std][n-fs]).
  - Each fault carries:
    - the ACIS type (USER, IMPS, LIMT, PROG) and area
      ([ACIS][n-acis] §10);
    - the entity ids;
    - the measured numbers, e.g. requested vs available radius as in remus's
      `CliffEncountered` ([remus][n-remus]);
    - the Parasolid overflow type it would need;
    - where a closed form exists, the largest feasible radius (the decided
      wonky extension).
  - Codes are additive only. wonky-only reasons name deliberate limits:
    `NeedsOverflow{type}`, `UnsupportedVertexConfig{valence, convexities}`,
    `VariableConvexityEdge`, `OffsetCollapse`.
  - Emulate one pinned FS version, the 3083 snapshot.
- **Where.** The FS prelude (MIT enums), the Bend result type and the
  harness reason classes.
- **Bend fit.** Trivial: U32 tags and small records.
- **Benefit.**
  - LLM repair loops branch on codes.
  - Marc's trial loops can ask for the feasible radius instead of guessing.
  - Error behaviour matches Onshape.
- **Risk.**
  - Drift between Onshape versions.
  - Promising a feasible radius where feasibility is not monotone (F16).
- **First acceptance test.**
  - Every refusal in the 70-case harness carries an Onshape name, an ACIS
    type, entity ids and at least one number.
  - FP12 gives `FILLET_FAIL_SMOOTH`.
  - Every FP overflow case refused by A names the overflow type the table
    predicts.

### P6. Complete the harness with oracles that do not share the construction

- **Idea.** Add to the validator:
  - (a) the Kós maximum-ball residual on sample points of **every** blend
    face, for A and B too, not only inside C ([Kós][n-kos]);
  - (b) Peternell-Pottmann envelope residuals for approximate faces
    ([note][n-pp]);
  - (c) mirrored instances of every chamfer and asymmetric case (Onshape's
    `V414` mirror bug);
  - (d) the HP gap test on every result;
  - (e) Rossignac property tests on convex bodies: re-rounding with a ≤ r
    changes nothing, and rounding all edges equals the shrunk body plus a
    ball ([note][n-rr]);
  - (f) identity tests for every formula transcribed from a paper;
  - (g) the ACIS global-interference fixtures and the Parasolid figure cases
    (two of three at a vertex with mixed convexity gives `edge_c`; overlaps
    fixed together vs one after another).
- **Where.** `scripts/fillet/` (the harness owner's JS validator).
- **Bend fit.** Not applicable; this is test infrastructure. The max-ball
  residual would also be uniform per point in Bend.
- **Benefit.** It catches wrong-but-valid results independently of the
  construction code: exactly the failure classes of section 4.
- **Risk.** Oracle bugs: in remus, all five initial "findings" were harness
  bugs ([remus][n-remus]).
- **First acceptance test.** Extend the mutation self-test (15 of 15 today)
  with four mutations, each of which must be flagged:
  - the right topology with the radius off by 1e-4 mm;
  - a spring curve displaced by 1e-4 mm;
  - a mirrored chamfer with swapped widths;
  - a dropped pocket.

### P7. Clearance, interference and compare as distance queries (Rossignac's definitions)

- **Idea.**
  - Define khana's clearance and interference, and wonky's compare, by
    Rossignac:
    - tolerance equality `X↓ε ⊂ Y ⊂ X↑ε`;
    - clearance ≥ 2r ⇔ `(X↑r) ∩ (Y↑r) = ∅`, i.e. dist(X, Y) ≥ 2r
      ([note][n-rr] p. 30).
  - Compute them as exact distance queries between carriers (closed-form
    projections, Rossignac's Algorithm 7), not by building offsets.
  - Euclidean (arc-join) semantics is right here, unlike for shells.
- **Where.** The khana checks (decision 23: "clearance is body distance";
  real wonky checks for collision and distance "follow later",
  [../entscheidungen.md][w-ent]) and the review viewer.
- **Bend fit.** Uniform per face pair, with a BVH broad phase and a min
  reduction in fork-join.
- **Benefit.**
  - Exact print-in-place gaps (0.2 mm) without any offset construction.
  - The same code serves the fillet validator (does the ball fit), the
    maximum-ball oracle and P2's global interference check.
- **Risk.** Trimmed faces need the full case enumeration (vertex-face,
  edge-edge, edge-face).
- **First acceptance test.**
  - Two blocks 0.2 mm apart give a clearance of 0.2 to 1e-9 mm.
  - A pin r = 2.9 in a hole r = 3.1 gives a radial clearance of 0.2.
  - A filleted box equals its Steiner construction within ε = 1e-7.

### P8. Shell and thicken as offset plus Boolean

- **Idea.**
  - `opShell` = body − inward offset, using P3 with every face moved by −t.
    Opening faces are treated as Parasolid pierce faces (offset 0);
    `isHollow` has none ([Rossignac note][n-rr] on Parasolid hollow).
  - `opThicken` on planar sheets gives a prism, and on cylinder or cone
    sheets an annular solid.
  - Fillet interaction: an inner fillet r − t collapses at r ≤ t (an exact
    scalar test), and intersection join then gives a sharp inner edge
    ([theory §12.3][w-theory]).
- **Where.** `@opShell` and `@opThicken`, on top of P3 and the hybrid
  Boolean.
- **Bend fit.** As P3.
- **Benefit.** Completes the op set. Usage is small, though (1 `opShell`
  file, 1 `opThicken` call site, 8 build123d shells), hence the rank.
- **Risk.**
  - Sign conventions: the feature flips the sign so that the UI default is
    inward ([Onshape std][n-fs]). Compare remus's "both skins" bug.
  - Bodies that already have cavities: remus refuses them.
  - Removing self-intersections: remus has proved only one fold type.
- **First acceptance test.**
  - An open-top a×b×c box with t = 1 inward has volume
    abc − (a−2)(b−2)(c−1).
  - The "both skins" regression: a 10 mm cube shelled outward by 1 mm with
    one face open gives 584 mm³.
  - Fillet r = 0.5 < t = 1 gives a sharp inner edge, matching an Onshape
    probe.
  - Signed volume > 0.

### P9. Exact canal-surface records for the next tier (not v1)

- **Idea.**
  - When oblique plane/cylinder or plane/cone fillets arrive (tilted holes,
    e.g. the hybrid plan's 17° fixture), store the blend as a procedural
    record: supports, r, conic spine, side, and the contact on the plane as
    seed. This is Parasolid's blended-edge record ([Parasolid][n-ps] §29.6).
  - Evaluate and export it through Peternell-Pottmann's tangent-plane
    reflection, which is exactly rational for rational spines
    ([note][n-pp] §4), instead of C's bi-arc tori or fitted splines.
  - Both contact curves are ellipses, a type wonky already has
    ([Choi-Ju][n-cj], INFERRED there).
- **Where.** After v1: a new surface kind, exported to STEP as a rational
  B-spline.
- **Bend fit.** Fixed-degree rational evaluation with uniform work. The
  reflection normals need no normalisation.
- **Benefit.** Exact where C is approximate, keeping "exact unless opted
  in".
- **Risk.**
  - The corpus has no such case today.
  - The spline is exactly rational only for rational ellipse coefficients.
  - Parametrizations near-singular even on regular pipes (P-P p. 265), so
    meshing needs a deviation certificate.
  - The (4,2) vs (6,2) degree question (section 6).
  - A new carrier for the Boolean's SSI.
- **First acceptance test.** Plane z = 0 and a cylinder of r = 5 tilted
  by 17°, with a fillet r = 1:
  - envelope residuals ≤ 1e-12 relative on 10⁴ samples;
  - the STEP B-spline validates in OCCT;
  - it agrees with C's tori within C's stated tolerance.

---

## 6. Open questions worth a prototype

1. **Onshape offset semantics** (probe; the fillet probes are approved,
   offset probes would need the same approval). About five documents,
   `opOffsetFace` on all faces by +1 and −1 of:
   - a box;
   - a pyramid, and a block with one valence-4 vertex (does a new edge
     appear?);
   - an L-block (does a face vanish at the concave edge?);
   - a filleted box, with `opShell` at r < t and r > t.

   This decides P3 and P8.
2. **Can every ladder and offset decision be a bounded-degree polynomial sign
   test on dyadic inputs?** Enumerate A's decisions, derive the squared
   forms, and count the degree and limb width. Compare the cost with the
   F32x2 band (P1).
3. **Rational unit normals.**
   - An offset plane's constant d·|n| is irrational for a rational normal of
     irrational length. Exact offset-plane concurrency then needs algebraic
     numbers.
   - How many of Marc's plane normals are axis-aligned or Pythagorean? A
     rational point on the unit sphere is exactly the image of the
     stereographic map of section 3.3.
   - Measure the normals of the corpus B-reps. Decide whether planes should
     be stored as (unnormalised normal, offset) with squared decisions.
4. **Declared tangency, step by step.**
   - Can carrier identity make corefine + recover exact for chamfer tools
     first (no tangency)?
   - Then roundX through B vs A: same volume, same topology, runtime ratio?
5. **Pipe around a conic spine: (4,2) or (6,2)?** Peternell-Pottmann's
   formula gives (4,2) for k = 2. The Dupin note quotes Dahl-Krasauskas as
   (6,2). Settle it with the Dahl thesis PDF the notes already hold, before
   P9.
6. **Is the GPU worth it for blends?** C2's Metal build only became
   reasonable once the device call was just the station solve. Count
   stations × edges in the corpus and compare Metal with cpuN. The INFERRED
   expectation is that CPU fork-join suffices and the GPU pays off only for
   sampling-heavy certification.
7. **Blends without tags.**
   - STEP imports from Onshape carry fillets as cylinders and tori, or as
     B-splines. Recognition enables defillet and exact offsets of imports.
   - Kós's constrained circle fit covers mesh-only inputs and scans.
   - Check the Siemens US8935130B2 claims before recognising notch or cliff
     chains.
8. **Full rounds on fragmented coplanar faces.** An A2 open item: merge the
   fragments (unify same-domain) before stage 3, or locate the fragment?
9. **Does Parasolid's tolerance growth carry some of Marc's Onshape
   successes?** Probe the tight overflow cases and compare with an exact
   construction.
10. **Chamfer `APEX_RANGE` and the `TWO_OFFSETS` side assignment** are still
    unprobed.
11. **Offsets of imported bodies with B-spline faces**, e.g. the caster
    insert: does Onshape offset them exactly, and what should wonky's opt-in
    tolerance be?

---

## 7. Catalog of the remaining sources

### 7.1 Catalog-only sources from the scout (not deep-read)

| Source | Kind, year | License | One line | Relevance for wonky | Priority |
|---|---|---|---|---|---|
| [Inigo Quilez, smooth minimum](https://iquilezles.org/articles/smin/) | blog, 2013-2024 | article | quadratic, cubic, quartic, circular and exponential smin; which variants are rigid, local, conservative, associative | preview and SDF-prototype blends only; constant thickness, not constant radius ([SDF chapter][c-sdf]) | 3 |
| [salvipeter/transfinite](https://github.com/salvipeter/transfinite) | C++ library, 2016-2026 | MIT | n-sided transfinite patches (Gregory, Kato, Charrot-Gregory families) | the portable base for a later setback tier; mind US8004517B1 until 2027-12-17 | 3 |
| [Rossignac & Requicha 1984, Constant-radius blending](https://www.semanticscholar.org/paper/CONSTANT-RADIUS-BLENDING-IN-SOLID-MODELLING-Rossignac-Requicha/553014d71e15e44f3585377bc9fd017d4f823b3d) | paper, 1984 | publisher | rolling-ball blending of natural-quadric CSG solids | precursor of the deep-read 1986 paper and thesis | 2 |
| [Várady & Hoffmann 1998, Vertex blending](https://cs.purdue.edu/cgvlab/www/publications/varady1998vertex) | paper, 1998 | publisher | catalogue of vertex configurations and strategies | corner classification beyond the sphere corner; not freely online | 2 |
| [Hoffmann & Hopcroft 1986, Quadratic blending surfaces](https://www.sciencedirect.com/science/article/pii/0010448586900916) | paper, 1985-86 | publisher | implicit low-degree blends; the potential method | implicit blends; not rolling-ball, so not an `opFillet` path | 2 |
| [Siemens US9690878B2](https://patents.google.com/patent/US9690878) and US8935130B2 | patents, 2011-2013 | active to 2036-04-24 and 2032-12-15 | ribbon-breaker reblending; recognising notch/cliff chains | avoid the claims; relevant for P5 and question 7 | 2 |
| [OffsetCrust, arXiv 2507.10924](https://arxiv.org/abs/2507.10924) | paper, 2025-26 | arXiv | variable-radius mesh offsets with power diagrams | mesh-side offsets; not the B-rep path | 2 |
| [Topological considerations in joining and terminating blends](https://link.springer.com/chapter/10.1007/978-981-96-6235-7_15) | chapter, 2025 | paywalled | blend termination, overlay, global blending | the only recent topology text; retrieval lead | 2 |
| [hg_sdf](https://github.com/jcowles/hg_sdf) | GLSL library, 2016 | CC BY-NC | round, chamfer, stairs and columns operators for SDFs | never copy; the formulas are trivial to rewrite | 2 |
| [BRL-CAD ideas list](https://brlcad.org/~sean/ideas.html) | docs, ongoing | LGPL/BSD | "generalized blend/fillet primitive" still only an idea | negative example: a mature CSG system without B-rep fillets | 1 |

### 7.2 Related deep-read notes from other chapters

- [OCCT modeling guide, TKFillet, BRepOffset][n-occt]: the eligibility
  table, the residuals, and the open bugs used throughout.
- [remus][n-remus]: typed refusals, the analytic pair list, the offset
  engine. Its skills are linked in the header.
- [truck][n-truck]: the procedural rolling-ball surface `RbfSurface`, the
  ancestor of monstertruck's decorators.
- [libfive][n-libfive]: `offset = f − r`, `shell`, and why min/max fields
  offset with miters.
- [Manifold][n-manifold]: symbolic perturbation and Minkowski shards. Mesh
  offsets have been an open issue since 2022 (scout).
- [SolveSpace NURBS Boolean][n-ss]: #1291 and the `tangent_fillet`
  regression test with a closed-form volume.
- [Fornjot shutdown][n-fornjot]: it never shipped fillets; its SDF phase
  failed on "chamfering specific edges".
- [BRL-CAD libbrep][n-brl]: CSG without B-rep blends.
- Chapters: [Boolean and SSI][c-bool], [implicit and SDF][c-sdf],
  [FDM geometry][c-fdm] (teardrops, BOSL2 edge masks, the Prusa guidance on
  chamfers), [robust numerics][c-num], [topology identity][c-topo],
  [testing and validation][c-test].

### 7.3 wonky's own fillet documents (read for this chapter)

- [../fillet.md][w-fillet]: part 1, the landscape, and the bake-off plan with
  candidates A to D.
- [theory.md][w-theory], [implementations.md][w-impl],
  [commercial.md][w-comm], [corpus.md][w-corpus], [harness.md][w-harness].
- [proto-kpart.md][w-kpart] (A1, A2) and [proto-rollingball.md][w-rb]
  (C1, C2).
- [../entscheidungen.md][w-ent]: the decisions and the Onshape probe
  results.

### 7.4 Referenced in the notes but not read here

- Dahl 2014 thesis and Dahl & Krasauskas 2012. A local PDF exists under
  `tmp/research/pdf/`; it matters for question 5.
- Terék & Várady 2009 (setback vertex blends in reconstruction).
- Hermann 1992 (rolling ball and self-intersection).
- Maekawa, Patrikalakis, Sakkalis & Yu 1998 (pipe surfaces).
- Farouki 1986 (offset approximation).
- Elber-Cohen and Piegl-Tiller (offset curves and surfaces).
- US8004517B1 (Geomagic setbacks).
- You et al. 2024, an open secondary summary of Choi-Ju and Lukács.
- The Kós RECCAD report GML 98/4.
- Shene 1997 (affine and projective cyclides) and Garnier et al. 2021.
- ogeom-rs issue #18.
- Zint 2023/2024 and Cao 2024 (feature-preserving mesh offsets).

[n-fs]: sources/onshape-featurescript-std-library-mirror-opfillet-opchamfer-.md
[n-help]: sources/onshape-help-fillet-and-face-blend.md
[n-ps]: sources/parasolid-v12-functional-description-edge-blending-chapters-.md
[n-acis]: sources/acis-blending-documentation-r17-technical-articles-r10-blnd-.md
[n-rr]: sources/rossignac-requicha-offsetting-operations-in-solid-modelling-.md
[n-vmv]: sources/vida-martin-varady-a-survey-of-blending-methods-that-use-par.md
[n-vr]: sources/varady-rockwood-geometric-construction-for-setback-vertex-bl.md
[n-braid]: sources/braid-non-local-blending-of-boundary-models-cad-1997.md
[n-kos]: sources/kos-martin-varady-methods-to-recover-constant-radius-rolling.md
[n-mt]: sources/monstertruck-truck-fork-monstertruck-fillet-crate.md
[n-pmc]: sources/patrikalakis-maekawa-cho-shape-interrogation-for-cad-cam-fre.md
[n-hp]: sources/hp-cocreate-blend-topology-patents-us5615317a-freitag-and-us.md
[n-cj]: sources/choi-ju-constant-radius-blending-in-surface-modelling-cad-19.md
[n-luk]: sources/lukacs-differential-geometry-of-g1-variable-radius-rolling-b.md
[n-dupin]: sources/dupin-cyclide-blends-shene-1998-two-cones-and-foufou-et-al-2.md
[n-wp]: sources/wallner-pottmann-rational-blending-surfaces-between-quadrics.md
[n-pp]: sources/peternell-pottmann-computing-rational-parametrizations-of-ca.md
[n-mae]: sources/maekawa-an-overview-of-offset-curves-and-surfaces-cad-1999.md
[n-occt]: sources/occt-modeling-algorithms-guide-and-tkfillet-chfi3d-fillets-c.md
[n-remus]: sources/remus-esaueng-remus.md
[n-truck]: sources/truck-ricosjp-truck-rust-b-rep-kernel-truck-shapeops-boolean.md
[n-libfive]: sources/libfive.md
[n-manifold]: sources/manifold-elalish-manifold.md
[n-ss]: sources/solvespace-nurbs-boolean-src-srf-boolean-cpp-surfinter-cpp-r.md
[n-fornjot]: sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md
[n-brl]: sources/brl-cad-libbrep-nurbs-boolean-evaluation-bool-eval-developme.md
[w-fillet]: ../fillet.md
[w-theory]: ../fillet/theory.md
[w-impl]: ../fillet/implementations.md
[w-comm]: ../fillet/commercial.md
[w-corpus]: ../fillet/corpus.md
[w-harness]: ../fillet/harness.md
[w-kpart]: ../fillet/proto-kpart.md
[w-rb]: ../fillet/proto-rollingball.md
[w-ent]: ../entscheidungen.md
[w-hyb]: ../hybrid-boolean-plan.md
[w-sdf]: ../proto-sdf.md
[c-bool]: brep-booleans-ssi.md
[c-sdf]: implicit-sdf.md
[c-fdm]: fdm-geometry.md
[c-num]: robust-numerics.md
[c-topo]: topology-identity-data-structures.md
[c-test]: testing-validation.md
[remus-fb]: https://github.com/esaueng/remus/blob/1dc3763e5bee36f9ad72e5d6dbe66b24f8978b94/.claude/skills/fillet-blend/SKILL.md
[remus-fbref]: https://github.com/esaueng/remus/blob/1dc3763e5bee36f9ad72e5d6dbe66b24f8978b94/.claude/skills/fillet-blend/reference.md
[remus-off]: https://github.com/esaueng/remus/blob/1dc3763e5bee36f9ad72e5d6dbe66b24f8978b94/.claude/skills/offset/SKILL.md
[wp-pdf]: https://dmg.tuwien.ac.at/geom/ig/papers/pot078.pdf
