# Testing and validating CAD kernels

Chapter of the wonky research knowledge base, 2026-09-24. English.

**Status and method.**

- **Deep reads.** 15 source notes cover this topic. They are under
  [sources/](sources/) and linked in section 2. This chapter re-read all 15
  in full.
- **Publish-first step.** None of the 15 notes had a Markdown file yet. All
  15 were written verbatim from the `markdown` field of
  `tmp/research/notes/<slug>.json`. A read-through found no broken fences,
  tables or links, so nothing was changed.
- **Workflow input.** The scout's landscape, failure taxonomy and catalog.
  The 7 catalog-only sources and the sources the scout named in passing are
  in section 7.
- **Checks made for this chapter** (working tree, 2026-09-24, read only):
  - wonky's existing test and acceptance machinery:
    [../bakeoff.md](../bakeoff.md) (runner, validator, oracles, arbitration),
    [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §§1, 5-9,
    local design note and `scripts/r20/acceptance.mjs`,
    [../boolean-stress.md](../boolean-stress.md),
    [../public-boolean-regressions.md](../public-boolean-regressions.md),
    [../step-validation.md](../step-validation.md),
    [../cadbench.md](../cadbench.md), [../laws.md](../laws.md),
    [../acceptance.md](../acceptance.md), [../cad-testing.md](../cad-testing.md),
    [../corpus-triage.md](../corpus-triage.md), [../fillet.md](../fillet.md);
  - code: `src/brep.mjs` (`validateSolid`), `src/comparison.mjs`,
    `src/exporters.mjs`, `scripts/r20/mesh.mjs`, `test/boolean-stress.test.mjs`,
    the layout of `kernel/proto/corefine/` and `kernel/proto/recover/`
    (HEAD) and of the uncommitted `kernel/hybrid/` of the R20 integration;
  - the sibling chapters [robust-numerics.md](robust-numerics.md),
    [mesh-booleans.md](mesh-booleans.md) and
    [brep-booleans-ssi.md](brep-booleans-ssi.md), whose proposals this
    chapter references instead of repeating;
  - 11 issue URLs from the scout's taxonomy, checked with `gh api`
    (title, state, creation date). They are cited in sections 1.4 and 1.6.
  - Nothing was built or run. A CPU benchmark is running on this machine.

**Labels.**

- **DOCUMENTED**: read in a primary source, by the note author or for this
  chapter. The link leads to the note or the file; the note carries the
  primary URL.
- **INFERRED**: reasoning from evidence, including derivations the note
  authors added.
- **HEARSAY**: secondhand, or a vendor or reporter claim that nobody here
  reproduced.

**Two corrections to the scout's framing.**

1. **The bake-off is decided.** The scout wrote that it "is running right
   now". By 2026-09-24 it is over (DOCUMENTED,
   [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §1). corefine (a
   tagged mesh Boolean with symbolic perturbation) decides topology.
   recover rebuilds the exact B-rep or refuses by name. exact-plane stays
   as an independent differential oracle. sdf produces no Boolean results.
   Production runs on the CPU pool. Plan steps 1 to 4 are done. The
   proposals below therefore attach to the hybrid's integration steps, not
   to a four-way race.
2. **wonky already tests more rigorously than most open kernels.** The
   scout's strategy list (a) to (l) reads as if it all had to be built.
   Much of it exists (section 1.3): an exact mesh validator, two
   differential oracles with a third-reference arbiter, byte identity across
   four targets, 216 adversarial cases, a strict OCCT STEP check, analytic
   stress cases, formal proofs of discrete invariants, and an Onshape-backed
   acceptance gate. This chapter measures the literature against that
   baseline. The real gaps are narrower and more specific than the scout
   suggests.

## 1. Landscape

### 1.1 Five practices that rarely cite each other

Testing a geometry kernel splits into five practices. Each grew in a
different community. A sixth resource, ML datasets, serves as input for all
of them.

| practice | typical representatives | what it decides | what it cannot decide |
|---|---|---|---|
| **validity checkers** | Parasolid `PK_BODY_check`, ACIS `api_check_entity`, OCCT `BRepCheck_Analyzer` and `BOPAlgo_ArgumentAnalyzer` | "this body violates invariant X at entity Y" | whether the body is the *intended* result; whether an unreported defect exists |
| **regression corpora with property oracles** | OCCT `tests/` (Draw/Tcl), GEOS/JTS XML suites, CGAL nightly | "this named case still gives volume V, counts N, validity OK" | anything outside the corpus; results within a loose default tolerance |
| **fuzzing** | GEOS on OSS-Fuzz, Manifold's FuzzTest fuzzer | "no crash, no sanitizer report, termination" | semantic correctness (the GEOS target discards every result) |
| **metamorphic and differential testing** | Spatter (affine-equivalent inputs), reference kernels, set identities | "two computations that must agree do not" | errors that both sides share |
| **exchange conformance** | CAx-IF validation properties (GVP), NIST STEP File Analyzer, ISO 10303-59 | "sender and receiver agree on volume, area, centroid within business thresholds" | local topology; anything below 0.5% volume |

The five practices share almost no vocabulary. The checker manuals never
mention property oracles. The corpora never mention metamorphic relations.
Spatter never mentions B-reps. Only CAx-IF defines a tolerance-aware
equivalence, and it is built for translators, not kernels (DOCUMENTED per
source in section 2; the absence of cross-citation is INFERRED from the
reference lists of the 15 notes).

### 1.2 Lineages

- **The checker lineage** (Parasolid, ACIS, OCCT). All three are ordered by
  cost: structural topology first, then per-entity geometry
  well-formedness, then geometry-topology incidence, then an expensive,
  opt-in face-face intersection stage. ACIS encodes this as levels 10 to 70
  and says explicitly that levels express computational cost, not severity.
  Parasolid recommends exposing two user levels, with and without the
  face-face check. All three are explicitly incomplete. Parasolid "assumes
  that any bodies you are working with are valid", and a checker failure is
  not proof of invalidity. ACIS calls a body *defective* only if level 70
  reports errors, and does not treat failures on defective input as bugs.
  (DOCUMENTED: [Parasolid](sources/parasolid-pk-body-check-and-the-model-checking-chapter-q-sol.md),
  [ACIS](sources/acis-api-check-entity-and-checking-levels-univ-of-arizona-mi.md),
  [OCCT](sources/occt-brepcheck-status-and-bopalgo-argumentanalyzer.md).)
- **The corpus lineage** (OCCT Draw, then GEOS/JTS XML). Named cases, a
  per-case reference record, and a parser that maps expected failures to
  states. OCCT's state machine (TODO becomes BAD; an unexpected pass is
  IMPROVEMENT; a missing completion marker is FAILED) is the most mature
  public version. GEOS/JTS moved the cases into declarative XML that two
  implementations share, but their runners do not share oracle semantics
  (DOCUMENTED:
  [OCCT tests](sources/occt-automated-test-system-and-the-tests-corpus.md),
  [GEOS/JTS](sources/geos-jts-xml-test-suite-and-geos-oss-fuzz-target.md)).
- **The robustness lineage** (Kettner, Mehlhorn, Pion, Schirra, Yap 2008;
  then Shewchuk, CGAL's exact kernels, EMBER's bounded integers). It turned
  "floating point is inexact" into reproducible adversarial inputs: ULP-grid
  sweeps and invariant-violating witnesses. Its test method outlives its
  algorithms (DOCUMENTED:
  [Kettner et al.](sources/kettner-mehlhorn-pion-schirra-yap-classroom-examples-of-robu.md),
  [EMBER](sources/ember-exact-mesh-booleans-via-efficient-and-robust-local-arr.md)).
- **The mesh-comparison lineage** (Metro 1998, then MeshLab's Hausdorff
  filter). A sampled one-sided and two-sided surface distance. It is the
  de-facto metric for "how far apart are two tessellations", and its
  reported maximum is a lower bound
  ([Metro](sources/metro-measuring-error-on-simplified-surfaces-cignoni-rocchin.md)).
- **The database-testing lineage** (Spatter 2024). Metamorphic testing of
  spatial predicates under affine bijections, with relation-rich
  generation and a reducer. It came from spatial DBMS testing, not from
  CAD ([Spatter](sources/spatter-detecting-logic-bugs-in-spatial-database-engines-via.md)).
- **The exchange lineage** (CAx-IF recommended practices since 2011; NIST
  SFA since 2016). Send validation properties inside the STEP file; the
  receiver recomputes and compares within agreed thresholds
  ([CAx-IF](sources/cax-if-recommended-practices-for-geometric-and-assembly-vali.md),
  [NIST SFA](sources/nist-step-file-analyzer-and-viewer-sfa.md)).
- **The dataset lineage** (ABC 2019, DeepCAD 2021, Fusion 360 Gallery 2021).
  Built for machine learning, these are nevertheless the largest public
  corpora of real CAD histories and B-reps. Every one of them documents its
  own processing losses
  ([ABC](sources/abc-a-big-cad-model-dataset.md),
  [DeepCAD](sources/deepcad-dataset-and-onshape-cad-parser.md),
  [Fusion 360 Gallery](sources/fusion-360-gallery-dataset-autodesk-ai-lab.md)).
- **The reference-service lineage.** Onshape's REST API evaluates the same
  unmodified FeatureScript that wonky interprets, on Parasolid, and returns
  mass properties as intervals. No other kernel project has a reference
  that runs its exact input language
  ([Onshape API](sources/onshape-rest-api-part-studio-mass-properties-and-rollback.md)).

### 1.3 What wonky already has

wonky's harness already covers parts of all five practices. The table maps
what exists (DOCUMENTED in the named files) to the practices above.

| practice | what exists in wonky | where | scale today |
|---|---|---|---|
| validity checking (mesh) | exact validator: weld by exact position, every directed edge once each way, single-cycle vertex links, degenerate triangles, BVH plus exact closed triangle/triangle test (Shewchuk-filtered, BigInt fallback), tags within deviation of their carrier | `scripts/bakeoff/validate.mjs` (JS, test side); corefine's step-1 gate in Bend (`kernel/proto/corefine/gate.bend`, `kernel/proto/recover/clear.bend` at HEAD; moving to `kernel/hybrid/` in the uncommitted R20 integration) | tested on deliberately broken meshes and all 38 oracle outputs; about 0.3 s for 50k triangles |
| validity checking (B-rep) | `validateSolid`: index ranges, closed loops, edge use, orthonormal plane frames, vertices on planes, loop orientation, a ±10,000 mm envelope; plus per-module checks such as `curve_valid` and `endpoints_valid` | `src/brep.mjs:141` (JS, planar faces only, throws at the first fault); `kernel/curve-plane.bend`, `kernel/boundary.bend` | every planar build |
| validity checking (external) | strict OCCT reader check: `BRepCheck_Analyzer(shape, True, False, True)` with the exact CurveOnSurface method, native-to-STEP topology preservation, adaptive volume, point classification | `scripts/validate-step.py` (test only, `cadquery-ocp==8.0.1.0.0`) | every acceptance and regression export |
| regression corpus | 34 Boolean stress cases with analytic volumes (32 valid, 2 unsupported, 0 incorrect); 6 frozen public OCCT cases (4 pass, 2 unsupported, 21 occupancy probes); 5 CADBench pilot cases and 10 build123d probes; the r10b acceptance run | [../boolean-stress.md](../boolean-stress.md), [../public-boolean-regressions.md](../public-boolean-regressions.md), [../cadbench.md](../cadbench.md), [../acceptance.md](../acceptance.md) | about 60 cases |
| regression corpus (real parts) | Marc's own FeatureScript and build123d files, run as a standing benchmark with a backlog | [../corpus-triage.md](../corpus-triage.md) | 423 files in 213 families; 1 file builds completely |
| adversarial suites | four verifier suites written against the four prototypes, replayed by a judge on all targets | `out/bakeoff/judge2/suites/adv-*` | 216 cases |
| differential oracles | OCCT exact CSG (fuzzy 0) and manifold3d on the same leaf meshes; exact-plane as the in-house second topology oracle | `fixtures/bakeoff/reference.json`, `scripts/bakeoff/reference.py` | every corpus and adversarial case |
| oracle arbitration | a dispute (shell count or volume disagreement) gets a third, independent reference: closed forms, Pappus, Gauss-Legendre quadrature of a closed-form cross section, set identities, constructed result meshes | `scripts/bakeoff/arbiter.mjs`, `fixtures/bakeoff/arbiter.json` | 20 disputes decided; a new undecided dispute fails `--check` |
| metamorphic cases | operand swap and rigid transform of one multicomponent comb case; one set identity inside the arbiter; `self-union`, `self-subtract`, `self-intersect` corpus cases | `scripts/boolean-stress.mjs`, `arbiter.mjs`, bake-off corpus | a handful, hand-written |
| cross-backend identity | result texts compared byte for byte on JS, cpu1, cpu18 and Metal; disagreement turns `pass` into `mismatch` | bake-off runner (`targetsAgree`) | 38/38 corpus, 216/216 adversarial (measured) |
| reference service | R20 gate: every case through the production CLI, compared with Onshape volume interval, bbox and a sampled Hausdorff distance to the Onshape STL | `scripts/r20/acceptance.mjs`, local design note | 16 of 17 pass (24.09.2026) |
| formal proof | Bend laws: claims over real kernel code, proved by the checker; mutation-tested | [../laws.md](../laws.md), `kernel/laws/pilot/` | 4 laws in the root, 37 in the pilot batch (0.83 to 1.07 s) |
| blends | fillet harness with an OCCT oracle and 16 Onshape fillet probes as primary oracle | [../fillet.md](../fillet.md) | 70 cases |

INFERRED consequence: the literature's biggest single lesson, "never trust a
single oracle", is already wonky practice. The bake-off measured it: OCCT's
exact CSG is 1.3e-6 relative off on `adv-ep2-rot-sphere-minus-cone`, its
fuzzy 1e-7 mm tolerance merges a 1e-9 mm gap that is really two solids, and
manifold3d splits rotated touching unions that are one solid (DOCUMENTED,
plan §7 "Oracle limits"). The gaps that remain are in section 1.5.

### 1.4 Trends, 2024-2026

- **New small kernels hit coincident geometry first.** Truck #114 (opened
  2026-03-12, open), "Boolean operations not handling coincident geometry
  correctly". Manifold #1430 (2025-11-15, closed), "Symbolic perturbation
  occasionally fails to handle perfectly coincident faces". Manifold #1706
  (2026-05-12, open), "`Boolean` emits sliver tris on near-coincident
  inputs", with `Status() == NoError`. wonky's own adversarial suites
  reproduced the same class: rotated coplanar pockets, point contacts,
  sub-micron skins (DOCUMENTED, issue pages via `gh api`; plan §7).
- **Silent success is the dominant reported failure in mature kernels.**
  OCCT #1496 (2026-08-23, closed): `BRepAlgoAPI_Common` returns empty or
  negative volume for two geometrically identical swept solids, with
  `IsDone()` true. OCCT #1543 (2026-09-16, open): a cut with a helical tool
  "silently removes nothing". OCCT #1371: a fillet reports `IsDone` while
  BRepCheck finds an invalid solid (DOCUMENTED).
- **Maintainers accept degenerate-but-valid output as by design.** The
  Manifold #1706 reporter asks whether slivers are "by design"; the
  existing short-edge and swap cleanups do not catch them (DOCUMENTED, issue
  body). For wonky this means: a mesh stage can be valid and still unusable
  downstream, so the analytic stage must either merge slivers provably or
  refuse. The recover defect "sliver absorption deletes real faces"
  (plan §7) was the other side of the same coin.
- **Validation-first projects struggle to ship features.** Fornjot
  (0BSD per its `LICENSE.md`; GitHub reports NOASSERTION) is archived
  (DOCUMENTED, `gh api repos/hannobraun/fornjot`: `archived=true`). After
  nearly six years it shipped validation checks (face boundary, winding,
  half-edge connection, coincident half-edges) but no Boolean beyond a
  disjoint group; "reliability was pursued through validation layers and
  by restricting the feature set" (DOCUMENTED in the sibling note
  [Fornjot shutdown](sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md)).
  INFERRED lesson: a checker is a gate, not a strategy. It must sit behind
  an operation that already works on the common cases.
- **Oracle-free testing arrived in geometry.** Spatter (PACMMOD, December
  2024) is the first published metamorphic campaign against geometry
  engines: 34 previously unknown bugs, 30 confirmed or fixed (DOCUMENTED).
- **Equivalence checks move into libraries.** Manifold #1682 (2026-04-27,
  closed) asks for a built-in mesh equivalence comparison (DOCUMENTED,
  title). The scout reads it as symmetric-difference volume with a cutoff;
  the thread was not re-read for this chapter.
- **Datasets aged into test corpora.** ABC, DeepCAD and the Fusion 360
  Gallery are no longer maintained as research artifacts (last commits
  2019, 2024, 2022), but their data is still downloadable and still the
  largest public source of real design histories (DOCUMENTED per note).

### 1.5 What is conspicuously missing

In the literature (INFERRED from the 15 notes and the scout's searches):

- **No empirical bug study of B-rep kernels.** The failure taxonomy in 1.6
  is assembled from issue trackers.
- **No metamorphic-testing paper for B-rep Booleans, fillets or offsets.**
  Spatter covers 2D/3D predicates on polygonal geometry only, and its
  formal result is about DE-9IM relations, not solid operations.
- **No checker with a completeness guarantee.** All three vendor checkers
  say so. OCCT's `ExactMethod` is a stronger floating-point sampler, not a
  proof. ACIS samples edge-on-face at "about 20" or "10" points on the same
  page.
- **No labeled ground-truth corpus of B-rep Boolean inputs with exact
  expected results.** EMBER's 1000 benchmark pairs carry transforms but no
  results. The Fusion 360 Gallery carries Fusion's results, which are one
  kernel's answer.
- **No public suite size or pass rate for Parasolid or ACIS.**
- **OCCT's corpus is not fully reproducible**: "a considerable portion of
  the data is confidential".
- **Offset is the least mature area everywhere.** OCCT's offset group has
  638 TODO declaration lines in 266 cases, against 21 lines in 16 cases for
  the Boolean group (DOCUMENTED static count; these are declarations, not
  measured failures).
- **No certified surface distance in any comparison tool.** Metro, MeshLab,
  GEOS's buffer matcher and wonky's R20 gate all report a sampled maximum,
  which is a lower bound.

In wonky, measured against the state of the art (INFERRED from 1.3):

- **Metamorphic testing is anecdotal.** A few hand-written variants exist.
  No generator applies exact transforms or set identities across the 38
  corpus cases and 216 adversarial cases.
- **The B-rep checker is planar, JavaScript and first-fault.**
  `validateSolid` throws at the first fault (Parasolid's `max_faults = 0`
  semantics), accepts one outer loop per planar face only, and returns no
  typed report or coverage. Curved results are checked by recover's
  certificate against the mesh and, in tests, by OCCT. A production build
  has no independent B-rep validity gate for curved faces.
- **Tolerance constants are tested by accident, not by sweep.** Both step-4
  unification defects (a real 2e-11 mm skin merged, then a tolerance about
  1000 times the rounding it absorbs) were found by a verifier writing
  one case at a time (plan §7).
- **The Hausdorff check is a lower bound used as an acceptance criterion.**
  `scripts/r20/mesh.mjs` says so in its own comment.
- **The Onshape oracle is used at its loosest.** R20 accepts a volume inside
  Onshape's `[min, max]` interval. In the stored R20 references its
  half-width is 3.1e-5 to 3.4e-4 relative (KT2: ±0.62 mm³ on 15,407 mm³;
  computed for this chapter from the 31 reference entries), although the
  exact cases match Onshape's nominal value to 6e-15 relative.
- **No generator and no minimizer.** The 216 adversarial cases were written
  by verifier agents. A failure is reduced by hand.
- **No STEP validation properties.** The writer emits AP214 without GVPs
  (`src/exporters.mjs`).

### 1.6 Failure taxonomy, with wonky's own measured instances

The scout's taxonomy, checked against the notes and against wonky's own
evidence. Issue titles and dates were read with `gh api` for this chapter.

| class | meaning | outside evidence | wonky's own instance |
|---|---|---|---|
| F1 silent invalid success | reported OK, body invalid | OCCT #1371 (fillet `IsDone`, BRepCheck invalid); Manifold #1706 (slivers with `NoError`) | corefine returned `ok` with a non-manifold vertex on 10 point-contact cases, and with exact self-intersections on 4 rotated coplanar cases (plan §7; closed by step 1) |
| F2 silent wrong-but-valid | valid body, wrong shape | OCCT #1496 (identical solids, empty Common), #1543 (tool removes nothing); OCCT #1315 (twisted loft valid, volume 1450 instead of about 15700) | recover's sliver absorption deleted real faces, volume error up to 2.7e-4, labelled exact; near-tangency pre-check bypassed, 9/9 wrong exact STEP (plan §7; closed by step 2) |
| F3 crash or assertion | abort | OCCT #1360 (access violation in fuzzy Booleans); GEOS #1020, #1021, #606 under fuzzing | none recorded in the bake-off (0 errors for corefine) |
| F4 hang or blowup | no answer in bounded time or memory | OCCT #724 (over 10 GB for one SSI), #1385 (validation 619 s despite a 30 s deadline) | corefine refused a near-coincident sphere union only after about 70 s on JS (plan §7; step 11) |
| F5 periodic seam errors | wrong pcurve branch or seam | OCCT #1534 (root cause story LLM-assisted, HEARSAY) | the strict STEP check rejected Truck-cylinder exports whose reader pcurves missed the edge (step-validation.md) |
| F6 coincidence and tangency | shared faces, touching edges, tangent carriers | OCCT #245; Truck #114; Manifold #1430 | point contacts, rotated coplanar pockets, grazing tools (plan §7) |
| F7 tolerance growth | tolerances inflate until later operations fail | OCCT #1541 (vertex tolerance grows to a circle diameter after unify) | not measured; chained CSG drift is "argued, not measured" (plan §9) |
| F8 cannot be built | the operation is impossible as posed | FreeCAD #28189 (chamfer consumes an adjacent edge); OCCT offset TODOs | KS05 must be refused, "like Parasolid" (local design note) |
| F9 version regression | worked before | FreeCAD #26677 (1.1rc1 invalid, 1.0.2 fine) | the step-4 fix regressed the tilted-prism skin case against HEAD (plan §7) |
| F10 unactionable errors | the message does not help | FreeCAD #19255 ("BRep_API: command not done") | wonky refuses by name; the corpus triage counts first blockers by class |
| F11 naming breaks references | downstream selections move | FreeCAD's toponaming issues (scout: 212) | covered by [topology-identity-data-structures.md](topology-identity-data-structures.md) |
| F12 checker false result | the checker is wrong | Parasolid and ACIS docs; OCCT sampled `BRepCheck` warns it "can be incorrect" | OCCT's default sampled check accepted a reader pcurve 1.49e-4 mm off at an edge tolerance of 1e-7 mm (step-validation.md); recover's grader compared only with OCCT's fuzzy CSG and graded a wrong topology `exact` (plan §7) |
| F13 post-processing breaks validity | cleanup after a correct operation | OCCT #1193 (ArgumentAnalyzer passes, UnifySameDomain introduces self-intersections), #1541 | step-4 carrier unification merged a real 2e-11 mm skin, twice (plan §7) |
| F14 unchecked preconditions | invalid or C0 input accepted | OCCT ArgumentAnalyzer exists for this, all nine modes default false | the bake-off expectations include `non-manifold-contact`; recover's pre-certificate is a precondition check |
| F15 exchange loss | round trip changes the model | ABC processing errors; the reason GVP exists | STEP reader turns an exact ellipse pcurve into a cubic B-spline off by 1.49e-4 mm (step-validation.md) |
| F16 scale dependence | behaviour changes with scale | Spatter's PostGIS normalization bug; Manifold's fuzzer restricts inputs to 0.1-10 (scout) | recovered B-rep at 1e5 mm cannot be written (`ResolutionLimit`, plan §7); the skin defect reproduced at 1000 mm with a 5e-10 mm skin |
| F17 nondeterminism across backends | results differ by target or thread count | Manifold #1275 (case 600, later not reproducible) | none: 4 targets byte-identical on 254 cases (measured). INFERRED risk: FMA contraction or reassociation breaks F32x2 silently |

F1, F2, F6, F12 and F13 dominate wonky's own record. F8 becomes central
once fillets land. F17 is wonky's strength; it must stay measured, not
assumed.

## 2. Comparison table

### 2.1 Deep-read sources of this chapter

| source | kind | status (2026-09-24) | license | verdict | key idea | note |
|---|---|---|---|---|---|---|
| Parasolid `PK_BODY_check` and checking chapter | vendor docs (mirror) | historical v12.0 chapter plus V35 face page | proprietary docs; study only | adapt | ordered, dependency-gated check groups; bounded fault list; local "changed face vs every face" checking; checker failure is not proof of invalidity | [note](sources/parasolid-pk-body-check-and-the-model-checking-chapter-q-sol.md) |
| ACIS `api_check_entity` and levels | vendor docs (mirror) | pre-R14 mirror, cross-checked with R17 | proprietary docs; categories reimplementable | learn-from | levels 10-70 by cost; total traversal first; sampled incidence against SPAresabs; face-face stage outputs a `check_error` body; coverage counters | [note](sources/acis-api-check-entity-and-checking-levels-univ-of-arizona-mi.md) |
| OCCT `BRepCheck_Status` and `BOPAlgo_ArgumentAnalyzer` | C++ API and code | active, V8.0.1 (2026-07-30) | LGPL-2.1 + exception | adapt | contextual consistency vs operation preflight; 37 enum values incl. `NoError`; nine preflight modes all off by default, `TestTangent` unimplemented; witnesses with parameter and distance | [note](sources/occt-brepcheck-status-and-bopalgo-argumentanalyzer.md) |
| OCCT automated test system and `tests/` | test harness and corpus | active | LGPL-2.1 + exception | adapt | property assertions, not bytes; TODO/BAD/IMPROVEMENT state machine; mandatory completion marker; 1% default comparison (do not copy) | [note](sources/occt-automated-test-system-and-the-tests-corpus.md) |
| GEOS/JTS XML suite and GEOS OSS-Fuzz | declarative corpus, fuzz targets | both active (GEOS 3.15.0, 2026-09-01) | GEOS LGPL-2.1; JTS EPL-2.0 or EDL-1.0 | adapt | issue-named fixtures; area identities over U, I, D, SD; shared XML but different oracles; fuzz target checks crashes only | [note](sources/geos-jts-xml-test-suite-and-geos-oss-fuzz-target.md) |
| Spatter | paper plus artifact | PACMMOD Dec 2024; artifact idle since 2024-10 | paper CC-BY-4.0; code MIT | adopt | affine-equivalent inputs preserve DE-9IM; exact rational rotations from Pythagorean triples; relation-rich derivation beats random generation | [note](sources/spatter-detecting-logic-bugs-in-spatial-database-engines-via.md) |
| Kettner et al., classroom examples | paper | historical (2008) | scholarly paper | adopt | ULP-grid sweeps; false zero, perturbed zero and sign inversion as separate classes; invariant-violating witnesses A1-B2; epsilons widen the zero region | [note](sources/kettner-mehlhorn-pion-schirra-yap-classroom-examples-of-robu.md) |
| Metro (Cignoni, Rocchini, Scopigno) | paper plus tool | canonical (1998); code frozen since 2018 | paper closed; vcglib GPL | adapt | sampled one- and two-sided distance; the maximum is a lower bound; covering radius turns it into an upper bound | [note](sources/metro-measuring-error-on-simplified-surfaces-cignoni-rocchin.md) |
| EMBER | paper, benchmark JSON | SIGGRAPH 2022; binary on request | paper rights with ACM; Manifold mirror Apache-2.0 | adapt | exact 26-bit plane arithmetic within 256 bits; winding invariants; 1000 reproducible pair transforms without golden results | [note](sources/ember-exact-mesh-booleans-via-efficient-and-robust-local-arr.md) |
| Onshape REST API: mass properties and rollback | commercial API docs | active (OpenAPI 1.221.89339) | SaaS terms; no scraping of public documents | adopt | `[nominal, min, max]` intervals; `rollbackBarIndex` on read endpoints; `evalFeatureScript` with explicit density and `evVolume` HIGH | [note](sources/onshape-rest-api-part-studio-mass-properties-and-rollback.md) |
| CAx-IF validation properties (v4.5, now v4.6) | recommended practice | maintained (v4.6, 2023-04-21) | free, no license; a convention | adopt | volume, area, centroid, agreed bbox inside STEP; interop 1%/1 mm; industry 0.5%/0.02 mm; COPS sampling points | [note](sources/cax-if-recommended-practices-for-geometric-and-assembly-vali.md) |
| NIST STEP File Analyzer (SFA) | tool | active (v5.51, 2026-09-14) | US public domain plus bundled closed parts | learn-from | an OCCT-independent Part 21 parser; checks the form of validation properties, never their truth; Windows only | [note](sources/nist-step-file-analyzer-and-viewer-sfa.md) |
| ABC dataset | dataset | static (v00) | repo MIT; model rights with creators | adapt | one million Onshape models as STEP; annotations with known index and unit defects; OFS is not FeatureScript | [note](sources/abc-a-big-cad-model-dataset.md) |
| DeepCAD and onshape-cad-parser | dataset plus code | static | DeepCAD MIT; parser unlicensed | adapt | 178,238 sketch+extrude histories; replay merges NEW and ADD into Fuse; parser can return partial prefixes | [note](sources/deepcad-dataset-and-onshape-cad-parser.md) |
| Fusion 360 Gallery | dataset plus tools | static since 2022 | custom, non-commercial, binds employers | adapt | 8,625 sequences, 19,333 extrude snapshots and tool bodies; per-stage oracles; systematic float32(0.1) bias in sketch coordinates | [note](sources/fusion-360-gallery-dataset-autodesk-ai-lab.md) |

### 2.2 Related deep reads in sibling chapters

- [robust-numerics.md](robust-numerics.md) P3: adjacent-float predicate
  sweeps across targets against a BigInt oracle, with mutation checks. This
  chapter does not repeat it; proposal P2 below reuses its harness.
- [mesh-booleans.md](mesh-booleans.md) P1 (iterated-CSG suite with a cell
  oracle) and P7 (validator failure classes, OBB protocol, differential
  counts).
- [brep-booleans-ssi.md](brep-booleans-ssi.md) P2: harvest external SSI
  oracles (QI server, published quadric-pair fixtures) as third references.
- [topology-identity-data-structures.md](topology-identity-data-structures.md)
  P9: an external naming oracle; F11 belongs there.

## 3. State of the art: best techniques, real guarantees, where they break

### 3.0 Summary

| technique | best known form | what it really guarantees | where it breaks | wonky today |
|---|---|---|---|---|
| validity checker | Parasolid/ACIS/OCCT layered checkers | a reported fault is a fault (modulo tolerance policy); nothing about unreported ones | sampled incidence, checker breakdown on bad input, local checks missing old damage, post-processing after the check | exact mesh validator (test side and corefine gate); planar JS `validateSolid`; OCCT strict reader check in tests |
| property regression corpus | OCCT Draw cases, GEOS/JTS XML | the named case keeps its measured properties within the declared tolerance | loose defaults (OCCT 1%, GEOS 1e-3 relative); representation-specific counts; corpus coverage | analytic volumes at absolute tolerances around 1e-7 to 2e-6 mm³; about 60 named cases plus 216 adversarial |
| differential oracle | a second kernel on the same input | disagreement proves at least one is wrong | shared errors (common ancestry, same tolerance policy); the reference's own tolerance | OCCT exact CSG and manifold3d, plus exact-plane |
| oracle arbitration | wonky's arbiter (no published equivalent found) | a disputed case is decided by an independent method class | needs a recipe per dispute class; a new class blocks scoring | 20 disputes decided |
| metamorphic relations | Spatter; GEOS `overlayareatest` | a violated exact relation proves a bug, with no oracle | errors both sides share; relations that do not hold exactly on the represented inputs; count-only comparison | a handful of hand-written variants |
| closed-form truth | analytic volumes, Pappus, quadrature | exact or bounded reference inside its shape family | family is narrow | boolean-stress, arbiter recipes, R20 exact cases |
| sampled distance | Metro | a lower bound on the Hausdorff distance | reported as if it were the distance; random seeds; silent sample drops | R20 gate (lower bound, 20,000 samples) |
| certified distance | Metro plus covering radius plus certified deviations (INFERRED) | a sound [lower, upper] interval | cost of fine lattices; needs certified deviations on both sides | not built |
| fuzzing | GEOS on OSS-Fuzz | no crash, no sanitizer report | semantic errors pass by construction | none |
| generator plus minimizer | Spatter's derivation and reducer | finds distinct bugs faster than uniform random (measured in its ablation) | irregular work; minimization must keep the failure class | none; cases are hand-written |
| exchange conformance | CAx-IF GVP v4.6, NIST SFA | sender and receiver agree on global integrals within thresholds | 0.5% volume hides whole features; SFA checks form, not truth | no GVPs written |
| predicate conformance | Kettner-style ULP sweeps | no false certainty on the tested grid | a finite sweep is not a proof | sibling chapter proposal |
| formal proof | wonky's Bend laws | a discrete invariant holds for every input | F32 operations are opaque axioms | 4 root laws, 37 in the pilot |

### 3.1 Validity checkers

**Structure.** The three industrial checkers agree on an order (DOCUMENTED):

1. **Total traversal first.** ACIS runs pointer and back-pointer checks
   before anything else because the checker "is designed never to fail on
   bad input"; several messages carry "Fatal topology error. This part will
   hang".
2. **Per-entity well-formedness.** Unit normals, orthonormal transforms with
   det ±1, `0 < ratio <= 1` for ellipses and cone bases, torus
   `major >= -|minor|`, positive face area.
3. **Geometry-topology incidence.** Vertex on curve, vertex on surface, edge
   on face, pcurve agrees with the 3D curve, loop orientation and nesting
   per surface type (ACIS's periphery, separator and hole rules for periodic
   surfaces).
4. **Global self-intersection.** Face-face (ACIS level 70, Parasolid
   `fa_fa`), optional because it is by far the most expensive. ACIS returns
   the offending curves as a separate `check_error` body.

Parasolid gates later groups on earlier ones: a failure skips dependent
groups, and switching off a prerequisite can produce misleading diagnoses.
Its local check compares **each altered face against every other face**,
not only against other altered faces. A face-face inconsistency can come
back with a zero API error and a separate `local_check_failed` status, so a
caller that reads only the API status loses real failures (DOCUMENTED,
Parasolid note §§8.4-8.5).

**Preflight versus postcondition.** OCCT separates `BRepCheck_Analyzer`
(contextual consistency of a shape) from `BOPAlgo_ArgumentAnalyzer`
(operation-dependent input checks). Two ArgumentAnalyzer ideas matter for
wonky (DOCUMENTED, OCCT BRepCheck note):

- **RebuildFace** is a dry-run invariant: rebuild each face from its
  boundary edges and require exactly one area with the same edge-use count.
- **MergeVertex/MergeEdge** builds an all-pairs compatibility matrix and
  flags any row or column with more than one match. It detects *ambiguous
  many-to-one merging*, not proximity. That is exactly the failure class of
  wonky's step-4 carrier unification (INFERRED): a tolerance merge is safe
  only if every merge class is unambiguous at that tolerance.

**Tolerance semantics.** Parasolid treats edges as tubes and vertices as
spheres of their local precision; exact entities carry half the session
precision, 5e-6 mm (DOCUMENTED, Onshape note). ACIS's SPAresabs = 1e-6 over
a model space of SPAresabs/SPAresnor = 1e4 is a dynamic range of 1e10,
about 2^33. That range fits F32x2's roughly 48-bit significand with about
15 bits of guard, and does not fit plain F32's 24 bits (INFERRED, ACIS
note). A checker that decides with plain F32 at wonky's ±10,000 mm envelope
is wrong by construction; an F32 pass may only filter.

**What they guarantee.** A reported fault, under the documented tolerance
policy. Nothing else:

- All incidence checks are sampled. ACIS evaluates pcurves at 0, 1/3, 2/3
  and 1 and edges at "about 20" or "10" points (the same page says both).
  OCCT's default geometric check samples a finite number of points, and its
  header warns the result can be incorrect. `theIsExact=true` selects a
  more thorough floating-point distance method, not an exact certificate.
- Several OCCT `InvalidTolerance` checks are marked not yet implemented;
  `TestTangent` is empty; all nine ArgumentAnalyzer modes default to false.
  Calling `Perform()` with defaults checks nothing.
- Parasolid: `max_faults = 0` raises on the first fault rather than
  collecting all of them; a positive maximum bounds the list; neither
  enumerates every defect.
- A checker can itself exceed any deadline (OCCT #1385: 619 s CPU against
  a 30 s cooperative deadline).

**Where wonky can do better than sampling (INFERRED, ACIS note).** For the
carriers wonky supports, most incidence checks are algebraic identities:

- vertex on plane or on line: an exact sign of a determinant on the
  represented coordinates (multi-limb U32);
- vertex on cylinder, cone or circle: a polynomial sign (squared distance to
  the axis minus r²), evaluated in F32x2 with an error bound, escalated to
  limbs when ambiguous;
- line on plane, circle on plane, a generator line on a cylinder, a coaxial
  circle on a cylinder: finitely many identities, no sampling;
- ellipse on cylinder (an oblique section): one identity on the plane and
  cylinder parameters;
- quartic intersection curves (KT1, KS08 in R20): no identity; the check
  must return *indeterminate*, never valid.

**Result contract.** Every source ends up with more than two outcomes.
Collected (DOCUMENTED per note, combined INFERRED): `checked` (no fault in
the stages run), `invalid` (fault list with stable entity ids, witness point,
residual and bound), `indeterminate` (the checker could not decide, a
distinct outcome in Parasolid's V35 face check), `not-run` (stage skipped
and why), `unsupported` (carrier pair outside the certified set),
`cancelled` (budget). Plus coverage counters (ACIS `sanity_ctx`) so that
"passed" is auditable.

### 3.2 Property oracles and regression corpora

**OCCT.** A case asserts properties, not bytes (DOCUMENTED, OCCT tests note):

- `checkshape`: validity through `BRepCheck`;
- `checkprops`: length, area, volume. Integration precision `eps = 1e-4`;
  the comparison default is **`deps = 1e-2`, i.e. 1%**;
- `checknbshapes`: exact topology counts, which are representation-specific;
- `checkmaxtol`: tolerance growth against a reference or a source budget
  (the `-multi_tol` branch has a static bug, so the formula should not be
  copied);
- `checkfreebounds`: free boundary counts, not a manifoldness proof.

The **state machine** is the lasting contribution. A `TODO` pattern turns a
known failure into `BAD`; the known failure disappearing is `IMPROVEMENT`;
`?` marks an unstable expectation; a missing `TEST COMPLETED` marker is
`FAILED`, so a crash never passes. `SKIPPED` (usually a missing fixture) is
not a pass. The weaknesses: a regex log parser that matches one TODO pattern
repeatedly, confidential fixtures, and the loose 1% default.

**GEOS/JTS.** Shared XML, different oracles (DOCUMENTED, GEOS note):

- JTS honours the run-level `<tolerance>` as an absolute bound and compares
  geometries by normalized `equalsExact`.
- GEOS does not parse `<tolerance>`. Its scalar comparator is
  `|expected - actual| / expected < 1e-3`. In the issue-named fixture
  `TestOverlay-geos-837.xml` the declared tolerance is 1, the effective one
  about 9,709.8 area units.
- 176 XML files, 14 with a tolerance declaration.
- The best oracle in the suite is **`overlayareatest`**: compute U, I, both
  differences and SD, and check five area identities (`A = I + Dab`, `B = I +
  Dba`, `SD = Dab + Dba`, `U = I + SD`, `U = I + Dab + Dba`) relative to
  `area(A) + area(B)` at 1e-6. It needs no reference.

**Guarantee.** Partial, independent oracles over a finite corpus. Each
catches a different failure class: validity catches F1, volume and area
catch gross F2, counts catch topology drift, `checkmaxtol` catches F7.

**Where it breaks.**

- The tolerance is part of the claim. OCCT's 1% and GEOS's 1e-3 relative
  hide a missing 2.5 mm cube in a 3,000 mm³ part (INFERRED, CAx-IF note's
  example at 0.5%).
- Counts are not invariants of the occupied set. Two correct kernels can
  split faces differently; Fusion's ASM merges coplanar faces after a join
  and splits them on a cut (Fusion note, issue #71).
- A decimal golden value is only as good as its units, input quantization
  and error contract. Binary64 fixtures cast to F32 describe a different
  input.

### 3.3 Differential oracles and arbitration

**The principle.** Run a second implementation on the same input.
Disagreement proves that at least one is wrong. Agreement proves little if
the two share ancestry or tolerance policy: GEOS is a port of JTS, and
Spatter notes that engines sharing GEOS agree on the same wrong answer
(DOCUMENTED, GEOS and Spatter notes).

**Reference-kernel failures are real.** Measured in wonky's bake-off (plan
§7): OCCT's exact CSG is 1.3e-6 relative off on
`adv-ep2-rot-sphere-minus-cone`, where recover matches a closed-form volume
of revolution to 3.5e-15; OCCT's fuzzy 1e-7 mm merges a 1e-9 mm gap into one
solid; manifold3d on tessellated leaves cannot see a tool that grazes a
surface by less than the deviation.

**Arbitration.** wonky's arbiter decides each dispute with a third reference
of a different method class: closed forms on box bounds, a constructed
result mesh plus the exact validator and point-in-mesh, a set identity plus
a closed form, Gauss-Legendre quadrature of a closed-form circular-segment
cross section, Pappus's theorem. Undecidable cases, where the F32x2
rounding of the input itself decides topology, are scored `ambiguous`
(DOCUMENTED, [../bakeoff.md](../bakeoff.md) "Oracle arbitration"). None of
the 15 sources describes anything equivalent; OCCT, GEOS and CGAL all trust
a single stored reference (INFERRED). This is ahead of the state of the art
and should be kept as the pattern for every new oracle.

**The Onshape reference.** It is special because it runs wonky's exact input
language (DOCUMENTED, Onshape note):

- `getPartStudioMassProperties` returns **`[nominal, min, max]`**. The
  jarvis MCP tool text says `[min, mean, max]`, which is wrong per the spec.
- In the guide's example the default-accuracy interval is ±6.6e-4 relative
  on volume, ±2.4e-4 on area and ±33 µm on centroid.
- The endpoint needs materials; FDM FeatureScript usually has none. The
  unambiguous route is `evalFeatureScript` with
  `evApproximateMassProperties(density given)`, `evVolume(accuracy: HIGH)`
  and `evBox3d(tight: true)`.
- Every read endpoint takes `rollbackBarIndex`, so a per-feature oracle
  needs no workspace mutation and can be pinned to an immutable microversion.
- Quotas are annual (Standard 2,500 calls per user); the terms forbid
  mining public documents.

**Where it breaks.** A reference is a kernel with its own tolerance policy
(Parasolid's 1e-5 mm zero length, 0.01 mm default Boolean tolerance). Its
interval is looser than wonky's exact arithmetic by many orders of
magnitude (section 4.2). And a service can change: `evApproximate*`
functions warn that values may change between releases, so fixtures must
record `libraryVersion` and the capture date.

### 3.4 Metamorphic relations

**Spatter's contract** (DOCUMENTED, Spatter note). For a nonsingular affine
map A applied to all geometries, the DE-9IM relation of every pair is
invariant (Proposition 3.3). The artifact builds exact rational rotations
from Pythagorean triples and clears denominators, so the transformed input
is exact. It adds representation-only rewrites (reordering, deduplication,
orientation normalization) and a compatibility table saying which
predicates each rewrite preserves. It derives new shapes from existing ones
(boundary, hull, ring extraction, coordinate editing) so that touching,
containment and overlap actually occur. Result: 34 previously unknown bugs
in four systems, 30 confirmed or fixed. In a one-hour ablation the
geometry-aware generator produced 2,366 triggers against 9,913 for the
plain one, and found **more distinct bugs** (about 7 against 3). Raw
disagreement counts are a bad metric.

**Relations that carry over to solids** (INFERRED, adapted in the Spatter
and GEOS notes):

| relation | exact on the F32x2 wire? | targets |
|---|---|---|
| signed axis permutations, 90° rotations (48 elements of the cube's symmetry group) | yes: they permute and negate words | F2, F6, F17, orientation bugs |
| scaling by 2^k, k small | yes while no word leaves the normal exponent range | F16 |
| translation by a dyadic vector | only if every coordinate sum is representable; must be checked, not assumed | F16 |
| operand order: `A ∪ B = B ∪ A`, `A ∩ B = B ∩ A` | yes | F2, tie-breaking asymmetry |
| `vol(A ∪ B) + vol(A ∩ B) = vol(A) + vol(B)` | the identity is exact; the check needs a declared volume error | F2 |
| `A ∩ A = A`, `A − A = ∅`, `A ∪ A = A`, also with A as two distinct but identical operands | yes | F6 (OCCT #1496 is exactly this failure) |
| `(A − B) ∪ (A ∩ B) = A` | yes | F2, F13 |
| rotating a cylinder's seam about its axis | the parameterization changes, the occupied set does not | F5 |
| reordering independent features, cached versus uncached evaluation, rollback and replay | yes | F9, F17 |
| perturbing an input by δ below, at and above a declared tolerance | the expected answer is a documented step function | F6, F13, F16 |

For a similarity `T(x) = sRx + t` the mass properties transform as
`V' = s³V`, `area' = s²·area`, `centroid' = sR·c + t`,
`I' = s⁵ R I Rᵀ` (INFERRED, Spatter note). Shear is not allowed: it turns
circles into ellipses and breaks constant-radius fillets.

**Guarantee.** If the relation holds exactly on the *represented* inputs, a
violation proves a bug in at least one of the two runs. No oracle needed.

**Where it breaks.**

- Shared systematic errors pass: a kernel that loses the same pocket in
  both runs agrees with itself.
- Count-only comparisons can cancel: Spatter compares `COUNT(*)`, which two
  opposite mistakes can balance (INFERRED, Spatter note). Compare
  per-correspondence results.
- A transform that is not exact on the wire creates false alarms. Spatter
  uses integer coefficients for this reason, and still reports precision
  trouble in its normalization path.
- Relations must match the operation's semantics: `A − B` is not symmetric;
  offsets and fillets need their radius scaled with the geometry.

### 3.5 Closed-form truth and exact oracles

- **Closed forms.** wonky's boolean-stress corpus uses analytic volumes of
  comb prisms and cylinder sections; the arbiter uses Pappus and
  quadrature; R20's exact cases match Onshape to at most 6e-15 relative
  (DOCUMENTED). The guarantee is exact within a shape family. The family is
  narrow: planes, cylinders, cones, spheres, tori in simple arrangements.
- **Exact sign oracles.** Kettner et al. compute orientation exactly and
  compare the floating result on a 256×256 grid of adjacent floats. They
  separate three failure classes: a true nonzero sign rounded to zero, an
  exact zero perturbed to a sign, and an inverted sign (DOCUMENTED). A
  finite sweep tests conformance on that grid; certainty needs a proved
  error bound under the actual arithmetic (INFERRED correction in the note).
- **Bounded exact arithmetic.** EMBER proves that 26-bit integer
  coordinates keep every plane-based predicate within 256 bits, eight U32
  limbs. Outside that contract (midpoints, arbitrary new planes,
  triangulating output) the bound fails (DOCUMENTED). An oracle is exact
  only inside its stated domain; tests must include inputs at the domain
  edge and assert an explicit refusal beyond it.

### 3.6 Geometric distance

**Metro** (DOCUMENTED, Metro note). One-sided `E(S1, S2) = max over p in S1
of min distance to S2`; Hausdorff is the larger of both directions; mean
and RMS come from area-weighted samples; a signed variant uses the sign of
`N_p · (p' - p)`. Metro 4.07 samples every vertex, every unique edge and
lattice points inside every face ("similar triangles"), with error
diffusion of per-face counts so tiny faces are sampled deterministically.
The default budget is 10 samples per face of the larger mesh.

**The guarantee is one-sided.** The sampled maximum is a **lower bound** on
the true one-sided distance. Because `p -> e(p, S2)` is 1-Lipschitz, adding
the lattice covering radius ρ makes it an **upper bound**:
`E(S1, S2) <= max_i e(s_i, S2) + ρ`, with `ρ <= l_max / sqrt(3)` for the
lattice sub-triangles (derivation in the note, INFERRED). Combined with the
certified deviation δ_M of wonky's print mesh and the chord error δ_R of a
reference mesh:

`H(B, R*) <= δ_M + max(Ê(M, R) + ρ_M, Ê(R, M) + ρ_R) + δ_R + ε_fp`

`H(B, R*) >= max(Ê(M, R), Ê(R, M)) - δ_M - δ_R - ε_fp`

A test then answers pass (upper bound below tolerance), fail (lower bound
above it) or undecided (refine or fail explicitly). This is the only route
among the sources to a *certified* surface-distance verdict.

**Where it breaks.** Monte Carlo sampling gives no ρ; Metro's
`srand(clock())` is nondeterministic. Samples at `dist_upper_bound` are
silently dropped. Unsigned distance misses inside/outside swaps; the sign
is ambiguous where the nearest point is not unique. Topology changes are
only partly visible (component count). GEOS's buffer matcher adds
symmetric-difference area to its densified Hausdorff for exactly this
reason (DOCUMENTED, GEOS note).

**COPS.** CAx-IF's cloud of points samples each face exactly on its native
surface and classifies points as smooth or sharp (a normal jump above
1.0°). The receiver projects them. No numeric COPS threshold is defined
(DOCUMENTED, CAx-IF note).

### 3.7 Generators, fuzzing, minimization and datasets

**Crash fuzzing.** GEOS's `fuzz_geo_ops.c` reads WKB or WKT, calls dozens
of operations and **discards every result**, including `GEOSisValid`
(DOCUMENTED). It found real memory bugs (GEOS #1020, #1021, #606) and no
semantic ones by construction. Separating memory safety from semantics is
right; calling it Boolean testing is not.

**Semantic generation.** Spatter's relation-rich derivation is the only
measured evidence that *how* inputs are generated matters more than how
many (3.4). Manifold's FuzzTest-based CSG fuzzer restricts inputs to a
declared domain and has a minimizer (scout; FuzzTest itself is
catalog-only, section 7).

**Minimization.** Spatter's reducer deletes batches of statements and
keeps a change only if the same disagreement survives, plus guard
conditions. For wonky the unit to shrink is the FeatureScript operation
DAG, the operands and the parameter bit patterns, and the reducer must
preserve the *typed* failure (INFERRED, Spatter note).

**Datasets as corpora.** Each has losses that must be separated from kernel
failures (DOCUMENTED per note):

- **DeepCAD.** 178,238 sketch+extrude histories. The local replay treats
  both NEW and ADD as Fuse and keeps one accumulated shape. It splits a
  multi-profile extrusion into one operation per profile, which for
  INTERSECT gives `A ∩ B1 ∩ B2` instead of `A ∩ (B1 ∪ B2)` (INFERRED from
  the code). The parser can return a partial history prefix while keeping
  the final bounding box. Vectorized data is quantized to 256 levels.
- **ABC.** One million Onshape models; processed files for about 750,000.
  A Plane/Cylinder-only example still has B-spline *edges*, so filtering by
  face type is insufficient. Documented index shifts (#7), one-based
  examples (#19), interior curve parameters scaled by 1000 (#10). The `ofs`
  files are feature API records, not FeatureScript source (#4).
- **Fusion 360 Gallery.** 8,625 designs, 19,333 per-extrude snapshots and
  19,333 tool bodies: about 9,029 real (before, tool, result) Boolean
  triples with Fusion's result. Sketch coordinates carry a systematic
  `(1 + 2^-26)` factor, about 6e-7 mm at 40 mm, above wonky's 1e-7 mm
  comparison tolerance. OBJ meshes are not manifold. The license is
  non-commercial and binds the employer of a user who works for a company.

**Where it breaks.** Every dataset result is one kernel's answer. None
comes with an error contract.

### 3.8 Exchange conformance

CAx-IF GVP (DOCUMENTED, CAx-IF note): part-level volume, area, centroid and
an *agreed* bounding box (from B-rep vertices and edges, or tessellation
vertices, so not the tight box) go into the STEP file as
`MEASURE_REPRESENTATION_ITEM`s, combined into one `REPRESENTATION('')`.
Interop thresholds are 1% and 1 mm; v4.6 adds industry thresholds of 0.5%
and 0.02 mm plus 0.1% of size above 20 mm. NIST SFA checks the *form* of
these properties (names, units, `derived_unit` exponents, missing
definitions). It never recomputes them. Its syntax checker skips WHERE,
uniqueness and global rules (DOCUMENTED, SFA note).

**Guarantee.** The receiver's recomputation matches within a business
threshold. **Where it breaks.** Everywhere below 0.5%: the thresholds were
chosen to accept every commercial exporter.

### 3.9 Predicate conformance

Covered in depth by [robust-numerics.md](robust-numerics.md) §§3.1-3.3 and
its proposal P3. The testing-relevant points (DOCUMENTED, Kettner note):
regenerate the sweeps at F32 spacing instead of casting binary64 fixtures;
count false zero, false nonzero and inverted sign separately; build
whole-algorithm invariants (Kettner's A1, A2, B1, B2 visibility failures;
three-cell point-location cycles) because a wrong sign early can make a
large, visible error many steps later; replacing a zero test by an epsilon
only widens the fractured zero region.

### 3.10 Proofs of discrete invariants

None of the 15 sources proves properties of kernel code. wonky's Bend laws
do (DOCUMENTED, [../laws.md](../laws.md)): a law such as "for every triangle
and every extrusion vector, `T.extrude` is combinatorially well formed" is
checked symbolically over all inputs. The pilot's 37 laws kill three
mutants that survive the current four (∩ = ∪, ∩ = a, flip = identity).

**Where it breaks.** Bend treats every F32 operation as an opaque axiom, so
nothing geometric can be proved. Three identical points still give a
"valid" solid. Laws and tests are complementary: laws for the discrete
kernel (topology bookkeeping, integer arithmetic, gates, "no silent
fallback"), tests for geometry (INFERRED).

## 4. War stories and anti-patterns

### 4.1 From the sources

- **Success is not validity.** OCCT #1371: a fillet returns `IsDone = true`
  with no faulty contours, while `BRepCheck` and `BRepAlgoAPI_Check` find an
  invalid solid, self-intersections and eight sub-tolerance edges. OCCT
  #1496: `Common` of two geometrically identical solids returns empty with
  `IsDone()` true. Validate after every success.
- **Validity is not correctness.** OCCT #1315: a twisted ruled loft passes
  `BRepCheck` with volume about 1450 where about 15700 was expected.
- **Correct, then broken by cleanup.** OCCT #1193: a coplanar-wedge fuse
  passes ArgumentAnalyzer; `UnifySameDomain` then introduces
  self-intersections. OCCT #1541: box minus sphere, then unify; a pcurve
  phase inversion inflates a vertex tolerance to the circle's diameter.
- **The checker hangs.** OCCT #1385: 619 s CPU in validation against a 30 s
  cooperative deadline, 80% of samples in linked-sequence indexing.
- **A declared tolerance that nobody reads.** GEOS's runner ignores the
  `<tolerance>` element and uses 1e-3 relative; fixture 837 declares 1 and
  effectively allows about 9,709.8.
- **A fuzz target that checks nothing.** GEOS discards `GEOSisValid`'s
  return value. The error callback named `log_and_exit` writes to
  `/dev/null`.
- **An API that inverts intuition.** Parasolid `max_faults = 0` means "raise
  on the first fault", not "unlimited". OCCT `HasFaulty()` means only "the
  list is nonempty".
- **An inconsistent spec.** ACIS samples edge-on-face at "about 20 points"
  and, on the same page, at "10 points along edge".
- **A misread oracle.** The jarvis Onshape MCP tool describes mass
  properties as `[min, mean, max]`; the spec says `[nominal, min, max]`.
- **Business thresholds leaking into engineering.** CAx-IF's 1% volume
  threshold exists because it must accept every commercial exporter. CATIA's
  "wetted area" excluded voids and produced false reds until a naming
  convention was added.
- **Dataset replay that changes semantics.** DeepCAD's replay fuses NEW and
  ADD alike and splits grouped profiles. Its h5 reconstruction of
  `00511440.json` fails where the raw JSON exports (DeepCAD #29).
- **Silent sample loss.** Metro's `AddSample` drops samples at
  `dist_upper_bound`; its Monte Carlo sampler seeds with `clock()`.
- **Exact inside, inexact on the way out.** EMBER's exact result is a
  polygon soup with T-junctions; rounding it to floats "may introduce tiny
  self-intersections".
- **Epsilon as a fix.** Kettner et al. show that replacing an exact zero
  test by an absolute or relative epsilon (1e-10 in their Figure 12) widens
  the zero region and keeps its fractured boundary.

### 4.2 From wonky itself

- **A checker false negative, 1500 times the tolerance.** OCCT's default
  sampled check accepted a reader-built cylinder pcurve that missed the 3D
  edge by up to about 0.000149 mm at an edge tolerance of 1e-7 mm. Nine
  Truck-cylinder exports that had been reported valid had to be demoted
  when the strict CurveOnSurface method was switched on (DOCUMENTED,
  [../step-validation.md](../step-validation.md)).
- **A grader that shared the oracle's blind spot.** recover's grader
  compared only with OCCT's fuzzy CSG. A sealed void under a 2e-11 mm skin,
  opened by both OCCT and the step-4 unification, was graded `exact`
  (plan §7, fixed 23 September 2026).
- **A tolerance fix that needed a second fix.** The unification tolerance
  of 2^-40·scale was about 1000 times the rounding it absorbs. It merged a
  real skin, was tightened, and then still merged exact carriers that are
  not axis-aligned (tilted prism, rotated block), a regression against HEAD.
  Final value 2^-44·scale (plan §7). Each defect was found by a verifier
  writing single cases.
- **A replay that skipped cases.** The recover team's adversarial replay
  silently skipped fixture cases without prebuilt inputs (plan §7). The
  judge rebuilt every case.
- **A validator with a known hole.** Tag validation checks the unbounded
  carrier surface, not the face patch; a triangle tagged with the right
  surface of the wrong coplanar face passes (DOCUMENTED,
  [../bakeoff.md](../bakeoff.md) "Known harness limitations").
- **An interval ten orders looser than the evidence.** R20 accepts a
  volume inside Onshape's `[min, max]` or within 1e-6 relative. The stored
  intervals are ±3.1e-5 to ±3.4e-4 relative (31 reference entries in the
  R20 project, read for this chapter; KT2 allows ±0.62 mm³, a 0.85 mm
  cube). The exact cases match Onshape's nominal value to at most 6e-15
  relative. The datums D01-D04 have no Onshape B-rep volume and sit
  4.1e-4 relative above Onshape's mesh-derived volume and pass; the morning
  report of 24 September says "das muss geprüft werden" (DOCUMENTED,
  local design note, `scripts/r20/acceptance.mjs`,
  ../development record.md).
- **A lower bound used as an acceptance bound.** The R20 Hausdorff is
  "a lower bound of the true one" (comment in `scripts/r20/mesh.mjs`), with
  every vertex, every edge midpoint and 20,000 extra samples. It passed all
  cases, which is necessary but not sufficient.
- **A good one: byte identity found nothing because it was designed in.**
  All four targets agreed on 254 cases (measured). This is the cheapest F17
  protection there is, and it only lasts while every new kernel path is
  added to the comparison.

### 4.3 Anti-patterns, and what to do instead

| anti-pattern | seen in | instead |
|---|---|---|
| trusting `IsDone`/`ok` | OCCT #1371, #1496; corefine point contacts | validate every result, including after cleanup |
| validating before post-processing only | OCCT #1193, #1541; wonky step 4 | validate after unification, recovery and export too |
| one oracle, its own tolerance | recover grader vs OCCT fuzzy | at least two oracles plus arbitration by a third method class |
| loose default tolerance copied from another project | OCCT 1%, GEOS 1e-3, CAx-IF 0.5% | per-case tolerance from wonky's declared error, with units |
| declared tolerance not wired to the comparator | GEOS XMLTester | one oracle specification, tested by a deliberately wrong expectation |
| sampled maximum reported as the distance | Metro, R20 | report `[lower, upper]` with the covering radius |
| crash-only fuzzing called testing | GEOS OSS-Fuzz | separate safety fuzzing from semantic generation with relations |
| counting disagreements | Spatter ablation | count distinct minimized failure classes |
| finite sweep reported as proof | predicate testing in general | a proved bound, plus the sweep as a regression net |
| epsilon to silence a flaky test | Kettner Fig. 12 | an exact decision or an explicit refusal |
| a checker that stops at the first fault | Parasolid `max_faults=0`; wonky `validateSolid` | a bounded fault list plus coverage counters |
| an empty fault list read as success | OCCT `HasFaulty()`; ArgumentAnalyzer with default modes | explicit `checked / invalid / indeterminate / not-run / cancelled` |
| silent skipping in a replay | wonky recover replay; GEOS fuzz packaging | build every case, count skips as failures |
| dataset result used as truth | DeepCAD, ABC annotations | separate parser, quantization, unsupported and kernel failures |

## 5. What wonky should take: ranked proposals

All proposals are INFERRED from the evidence above. They are ranked by
expected benefit per unit of work, with the failure classes that produced
wonky's wrong answers so far (F1, F2, F6, F12, F13) first. None needs a
kernel change before its first acceptance test, except P3 and P4. None links
another kernel into production: reference kernels stay separate processes
in the test harness, as today.

| rank | proposal | main targets | size | attaches to |
|---|---|---|---|---|
| P1 | metamorphic relation suite over the hybrid | F2, F5, F6, F13, F16, F17 | small (JS job transformer, scorer) | plan steps 1-4 regression net; fillet bake-off |
| P2 | tolerance-band sweeps for every named tolerance constant | F6, F13, F16 | small (fixture generator, arbiter recipes exist) | step 4 unification, step 2 pre-certificate |
| P3 | a Bend B-rep checker with a typed report | F1, F12, F13, F14 | large | recover output gate, STEP export, fillets |
| P4 | certified Hausdorff interval as wonky's general `compare` | F2, F12 | medium | R20 gate, `src/comparison.mjs`, diff viewer, fillet oracle |
| P5 | per-feature Onshape fingerprints and tighter R20 gating | F2, F9 | small to medium | R20 gate, fillet probes |
| P6 | relation-rich generator plus a typed minimizer | F1, F2, F6 | medium | adversarial suites, arbiter |
| P7 | one case-result schema with OCCT's state machine | F9, F10 | small (adapter) | all runners |
| P8 | deterministic work budgets, tested across targets | F4, F17 | small | plan step 11 |
| P9 | STEP validation properties and a round-trip gate | F15 | small to medium | `src/exporters.mjs`, `validate-step.py` |
| P10 | dataset replay lanes behind Marc's own corpus | F2, F8, F15 | medium | corpus benchmark |

### P1. A metamorphic relation suite over the hybrid Boolean

**Idea.** Multiply every existing case by relations that need no oracle.
Start with the relations that are exact on the F32x2 wire (section 3.4):

1. The 48 signed axis permutations (the cube's symmetry group), applied to
   every world coordinate, surface origin, normal, in-plane axis and
   placement row. Odd elements reverse orientation, so triangle winding
   `a b c` becomes `a c b`.
2. Scaling by 2^k for k in {-3, ..., 3}, rejecting a case if any word
   leaves the normal exponent range. Radii and heights scale; cone angles do
   not.
3. Operand swaps for union and intersection; `A op A` with A as two
   distinct copies (OCCT #1496's failure); the set identities
   `vol(A ∪ B) + vol(A ∩ B) = vol(A) + vol(B)` and
   `(A − B) ∪ (A ∩ B) = A`.
4. A cylinder seam rotated about its axis by 90°: the tessellation and
   parameterization change, the occupied set does not (F5).
5. Later, dyadic translations, admitted only when an exact check confirms
   that every translated word is representable.

Compare the hybrid's final results (recover's B-rep, or the certified mesh
body when recovery is Unresolved) after mapping back with the inverse
transform, which is exact:

- the verdict class (`exact`, `certified-mesh`, named refusal) must match;
- shell count, and face count per carrier type, must match;
- volume and area must match within the declared error
  (`s³` and `s²` scaled);
- the bbox must map exactly.

Byte identity after the inverse transform is measured and reported, not
required (open question Q1). A relation violation is scored per case and
per relation, and minimized failures are counted by class, not by count
(Spatter's ablation lesson).

**Where it plugs in.**

- A JS job transformer next to `scripts/bakeoff/run.mjs` that rewrites
  `wonky-bakeoff-job 1` texts word by word, and a `--relations` option on
  `run.mjs --suite`.
- The scorer in `run.mjs compare` and `judge.mjs`, as a new verdict
  `relation-violated(<relation>)` that counts as wrong.
- Inputs: the 38 corpus cases and the 216 adversarial cases. Skip
  `ambiguous` cases for rotations that are not exact; signed permutations
  add no rounding, so those cases are included.
- Later: the fillet harness (70 cases), with the radius scaled by `2^k`.

**Bend fit.** No kernel change. The transformer is test infrastructure in
JS; every transformed case runs through the existing Bend entry points on
all four targets. The relation checks compare stored results.

**Expected benefit.**

- A regression net around steps 1-4 at about 50 to 100 times the case
  count, at zero oracle cost. The three remaining corefine wrong-`ok` cases
  (grazing) and the 14 rotated coplanar cases get 48 frames each.
- Catches frame-dependent tie-breaking: a Boolean whose topology depends on
  the coordinate frame is a user-visible bug even when each answer is valid.
- The per-frame results give the first measurement of whether corefine's
  symbolic perturbation is equivariant under axis permutations.

**Risk.**

- Runtime. 254 cases × 48 frames on four targets is about 49,000 runs; run
  the full product nightly on cpu18 and a sampled subset (for example 4
  frames per case) in `npm test`.
- Relations that legitimately fail: symbolic perturbation with fixed
  directions may resolve an exactly degenerate case differently in another
  frame. Then the relation defines the requirement (the hybrid's step-4
  unification should make the final result frame-independent), and a
  violation is a real finding, not noise.
- The transformer can be wrong. Test it with the exact validator on every
  transformed leaf before any Boolean runs.

**First acceptance test.** For the 38 corpus cases and all 48 signed
permutations at scale 1, plus the 6 axis-aligned corpus cases at 2^-3 and
2^3, on JS and cpu1:

- every transformed leaf passes `scripts/bakeoff/validate.mjs`;
- every case has the same verdict class in every frame;
- volume and area agree after back-transformation within 1e-12 relative for
  `exact` results and within area × deviation for certified mesh results;
- byte identity between JS and cpu1 holds in every frame;
- a deliberately broken transformer (winding not reversed for odd elements)
  is caught by the validator before scoring.

### P2. Tolerance-band sweeps for every named tolerance constant

**Idea.** Make Fornjot's two-threshold rule (scout: identical below one
bound, distinct above another, an explicit error in between) testable for
wonky's actual constants. For each named constant c in the pipeline,
generate cases whose critical feature size is c × {1/1000, 1/2, 1, 2, 1000},
at part scales of 1, 100, 1000 and 10,000 mm. The constants
(DOCUMENTED in plan §§1, 7 and `src/brep.mjs`):

- corefine's short-edge collapse, 2^-36 × scale;
- carrier unification, 2^-44 × scale (after two fixes);
- the recover near-tangency pre-check (a tilt threshold near 1e-12);
- the tessellation deviation (0.01 mm; 0.004 mm for fine spheres);
- `validateSolid`'s `tolerance(vertices)` and the ±10,000 mm envelope;
- the strict STEP check's 1e-7 mm comparison tolerance.

The feature families are the ones the arbiter already knows closed forms
for: gaps between boxes, slabs, skins over sealed voids (axis-aligned,
tilted prism, rotated block), grazing cylinder shaves, cone apex contacts.
The expected outcome per band is written down: far below, merged (and
reported as merged); far above, preserved; near the constant, either
correct or a named refusal. Never a wrong `ok`.

**Where it plugs in.** A generator that writes a new adversarial suite
(`fixtures/bakeoff/adversarial-bands.json`), plus arbiter recipes for any
family that lacks one. `arbiter.mjs --check` already fails on a dispute
without a recipe, which keeps the suite honest.

**Bend fit.** Fixtures only.

**Expected benefit.** Both step-4 unification defects (a real 2e-11 mm skin
merged; a tolerance about 1000 times the rounding it absorbs merging tilted
carriers) and the 1e-9 mm gap class sit exactly on such bands. A sweep
finds them before a verifier writes them one at a time. The sweep also
documents the effective resolution of the kernel per scale, which Marc
needs for FDM clearances.

**Risk.** Case count grows as constants × families × scales × bands
(about 6 × 6 × 4 × 5 = 720); keep it in the nightly run. Some bands are
decided below the input rounding; those are `ambiguous` by the existing
policy and must not be forced.

**First acceptance test.** Generate the unification sweep (three skin
families: axis-aligned, tilted prism, rotated block; 4 scales; 5 bands; 60
cases). The skin defects arose and were fixed inside the uncommitted step-4
work, so no commit contains them; test the sweep as a mutation instead. In
a scratch copy, set the unification tolerance back to 2^-40 × scale
(`kernel/proto/unify.bend` at HEAD, moving to `kernel/hybrid/unify.bend`):
the sweep must report the skin families as wrong `ok`. At HEAD it must
report zero wrong `ok`, and every refusal in the band must carry a named
reason.

### P3. A Bend B-rep checker with a typed report

**Idea.** One checker for exact B-reps, in Bend, ordered like the industrial
ones (section 3.1) but exact where they sample:

| stage | checks | arithmetic |
|---|---|---|
| 0 topology | index ranges, loop closure both ways, each edge used once in each direction per shell (seam rule for periodic faces), unreferenced entities, Euler-Poincaré per shell | U32; `W.solid_ok` from `kernel/laws/spike/topology-spec.bend` is already this stage for planar solids |
| 1 carriers | unit normals and orthonormal frames within a stated bound; ellipse `minor <= major` (or a documented convention; `kernel/curve-plane.bend` lacks the check today); cone angle range; finite values; the ±10,000 mm envelope | F32x2 with bounds |
| 2 incidence | vertex on plane or line exactly; vertex on cylinder, cone, circle by a bounded sign; curve-on-face by algebraic identity per carrier pair; pcurve against 3D curve for the exported pcurves | multi-limb U32 for planar decisions; F32x2 plus escalation for quadrics |
| 3 loops | orientation and nesting per face in its parameter domain; periphery and hole rules for cylinder and cone faces with seams (ACIS's loop rules as the spec) | exact orient2d on planar faces; unrolled domain on cylinders |
| 4 shells | outward orientation by signed volume; void shells negative and nested | `kernel/volume.bend` |
| 5 face-face (opt-in) | non-adjacent faces must not meet; adjacent faces only along their shared edge | certified tessellations: pairs farther apart than the sum of both deviations are cleared; closer pairs go to exact SSI or return `indeterminate` |

The report: `status` in `checked | invalid | indeterminate | cancelled`;
per stage `ran`, `skipped` with a reason, and coverage counters; a bounded,
deterministically sorted fault list with a stable code, entity ids, witness
point, residual and bound; the checker version and tolerance policy. An
unsupported carrier pair (a quartic intersection curve, as in R20's KT1 and
KS08) gives `indeterminate` at stage 2, never `checked`. Two levels:
`fast` (stages 0-4) and `full` (adds stage 5), as Parasolid recommends.

**Where it plugs in.**

- After recover and after carrier unification in the hybrid, as the output
  gate (OCCT #1193 and wonky's step-4 defects both show that cleanup must
  be followed by a check).
- Before STEP export in `src/exporters.mjs`, replacing the planar-only,
  first-fault `validateSolid` path step by step.
- On frozen B-rep inputs (`fixtures/r10b`, imported bodies).
- In the harnesses, next to OCCT's strict check: any case where OCCT says
  invalid and wonky's checker says `checked` is a checker bug (F12).
- Later the fillet stage: OCCT #1371 is the warning.

**Bend fit.** Good. Stages 0-4 are per-entity maps over immutable arrays
with balanced fork-join reductions of fault lists; results go into a new
report value, geometry is never mutated. Stage 5's pair tests group by
carrier pair type, which is uniform work; plan §6 keeps it on the CPU pool
until a batched kernel beats cpu18. The laws pilot can prove stage 0's
discrete properties (for example, "every constructor's output passes stage
0").

**Expected benefit.**

- The first production-side validity gate for curved results. Today the
  independent check for curved faces exists only in tests (OCCT).
- Machine-readable faults with witnesses for LLM-driven repair, instead of
  a thrown string.
- A precondition check for fillets (F14) and a postcondition for them
  (F1).

**Risk.**

- Size: this is several weeks of kernel work. Build it stage by stage;
  stage 0 and 4 first.
- A checker that is wrong is worse than none: every stage needs mutation
  fixtures (below) and differential runs against OCCT.
- Cost on large parts: `fast` must stay small against the Boolean itself.
  Measure on r10b-size bodies before making it mandatory.

**First acceptance test.**

- Twelve mutation fixtures, each corrupting exactly one invariant, taken
  from ACIS's catalogue: open loop, flipped coedge, an edge used twice in
  one direction, a vertex 2 × tolerance off its plane, a hole loop outside
  its periphery, a clockwise outer loop, an ellipse with ratio > 1, a
  non-unit normal, a seam pcurve shifted by one period, an inverted shell,
  a void shell with positive volume, two faces crossing away from their
  shared edge. Each is reported with exactly its fault code and entity id.
- The 32 corpus results that recover writes as exact STEP are `checked`
  at level `full`, with byte-identical reports on JS and cpu1.
- KT1 returns `indeterminate` at stage 2 with the carrier pair named.
- No case in the boolean-stress and public-regression suites where
  `validate-step.py` rejects the export and the checker says `checked`.

### P4. A certified Hausdorff interval as wonky's general `compare`

**Idea.** Replace the sampled lower bound with an interval (section 3.6).
Deterministic similar-triangle lattice samples on both meshes, per-triangle
sample counts from a prefix sum of `area × density` (Metro's error
diffusion without mutation: `floor(prefix[i+1]) − floor(prefix[i])`),
every vertex and every edge sampled, the covering radius ρ per triangle,
an exact point-to-triangle distance evaluated branch-free (minimum over the
interior projection and the three segment distances, no `1e-6 × area`
fudge). Combine with the certified deviation of wonky's print mesh and the
stated chord error of the reference mesh. Output
`{lower, upper, verdict, forward, backward, rho, deltaOurs, deltaRef,
worst: {point, faceId, featureId}}` in mm and as a fraction of the bbox
diagonal. Verdict: `pass` if `upper <= tol`, `fail` if `lower > tol`,
otherwise refine (halve ρ) up to a budget, then `undecided`.

Add signed maxima E+ and E- (outside and inside) because FDM fits care
about direction, and keep volume and bbox checks next to it because
unsigned distance misses an inside/outside swap.

**Where it plugs in.**

- `scripts/r20/mesh.mjs` `hausdorff()`: the R20 gate reports the interval
  and gates on `upper`.
- `src/comparison.mjs`, whose limitations list says "No general surface
  distance, Hausdorff distance". The product feature belongs in Bend.
- The diff and review viewer: per-sample error colors (Metro's error
  texture) with face and feature provenance.
- The fillet harness: comparison with Onshape's fillet probe meshes.

**Bend fit.** Excellent. Samples are independent (a map), and max, sum
and sum of squares are balanced fork-join reductions; pairwise summation is
Metro's own accuracy device. Brute force (every sample against every
triangle) is perfectly uniform work. At R20 sizes (about 3,000 reference
triangles, 10^4 to 10^5 samples) that is 10^7 to 10^8 point-triangle
evaluations per direction, which the CPU pool handles; a Morton-sorted
grid is the fallback for larger parts. F32x2 covers wonky's 1e-7 mm
tolerances; plain F32 does not at 200 mm extents.

**Expected benefit.** R20's geometric acceptance becomes a claim instead of
a lower bound. `compare` gains the general distance it lacks. The viewer
can say "face F12 is 0.3 mm inside the reference near (x, y, z)".

**Risk.** Fine lattices can be slow on JS; ρ must be small against the
tolerance, so thin features need dense sampling. The reference's own chord
error must be known: R20 derives it from Onshape's angle tolerance (0.05
rad), which is an assumption about Onshape's tessellator, not a guarantee.

**First acceptance test.**

- Two tessellations of one cylinder (r = 5 mm, h = 10 mm) at certified
  deviations 0.01 and 0.004 mm: `upper <= 0.014 + ρ_max + ε` and verdict
  `pass` at tol 0.02.
- The same cylinder with a 0.3 mm dent in one mesh: `lower >= 0.3 − 0.014`,
  verdict `fail` at tol 0.2, worst point inside the dent.
- The 16 building R20 cases: every interval contains the current sampled
  value; report how many verdicts stay `pass` under `upper`.
- JS and cpu1 give byte-identical reports.

### P5. Per-feature Onshape fingerprints and tighter R20 gating

**Idea.** Use the Onshape oracle at its strongest, offline and frozen
(section 3.3):

1. **Gate by exactness class.** For a result wonky marks exact, require
   `|w − nominal| <= max(1e-9 × V, wonky's stated bound)` in addition to
   the interval. The interval remains the criterion for approximations
   (certified meshes, quadrature), next to area × deviation. Today an exact
   case could lose 0.62 mm³ in KT2 and still pass.
2. **Per-feature fingerprints.** One `evalFeatureScript` POST per rollback
   index with the lambda from the Onshape note: `evVolume` with accuracy
   HIGH, `evApproximateMassProperties` with density 1 (no material needed),
   area, tight `evBox3d`, V/E/F counts and a surface-type census per body.
   Pin to the microversion and the FeatureScript `libraryVersion`; store as
   a frozen fixture with provenance; match bodies by box and volume, not by
   index.
3. **First divergent feature.** The harness reports the first rollback
   index k where wonky leaves the interval, which turns one failed model
   into one failed feature.
4. **Resolve the D01-D04 question.** The datums have no Onshape B-rep volume
   and are compared against a mesh volume; they sit 4.1e-4 relative above
   it. `evalFeatureScript` with an explicit density returns a B-rep volume
   even without a material (INFERRED from the Onshape note: the mass
   properties endpoint omits parts without density). That decides whether
   the 4.1e-4 is a mesh artefact or a wonky defect.

**Where it plugs in.** A new `scripts/snapshot-onshape-oracle.mjs` that
reuses `scripts/snapshot-r10b-modules.mjs`'s guards (request log,
`x-rate-limit-remaining` floor, cache-if-exists, metering before and
after); the R20 reference files; `scripts/r20/acceptance.mjs`; the fillet
harness, whose 16 Onshape probes have intervals of 5e-5 to 3e-4 relative
(read for this chapter from the R20 references) and are the primary fillet
oracle.

**Bend fit.** None needed; a test-only network oracle whose frozen outputs
are fixtures. The comparison runs in the JS harness.

**Expected benefit.** Exact results are held to the precision they
actually have. Fillet and Boolean regressions below about 1e-4 relative
become visible. Per-feature triage for every model Marc owns in Onshape.

**Risk.**

- Quota: Standard plans have 2,500 calls a year. A 40-feature model costs
  about 41 calls. Capture once, never in CI.
- Parasolid is not ground truth: disagreements go to the arbiter pattern
  (closed form, metamorphic relation, wonky's exact predicate).
- `evApproximate*` may change between releases: record `libraryVersion`
  and the capture date.

**First acceptance test.** Capture KT2 and D01 fingerprints at every
rollback index (at most about 20 calls, metering unchanged or accounted).
wonky matches the HIGH-accuracy nominal volume of KT2 within 1e-9 relative
at every index; D01 receives a B-rep volume, and the 4.1e-4 gap is either
explained or filed as a named defect. An exact result deliberately
perturbed by 1e-6 relative fails the new gate and still passes the old
interval check.

### P6. A relation-rich generator with a typed minimizer

**Idea.** Automate what the four verifier agents did by hand, in Spatter's
style (section 3.4):

- **Derivation, not uniform random.** Start from corpus leaves and derive
  the second operand: an exact copy moved so that a face is coplanar, or
  offset by k × deviation for k in {0, 1/2, 1, 2}; a cylinder tangent to a
  face or with its axis through a vertex; a hole whose axis crosses a seam;
  a tool that grazes by k × deviation; a cone apex on a face; nested copies
  that form a skin over a void.
- **Declared domain.** Sizes 0.1 to 1000 mm inside the ±10,000 mm envelope;
  outside it, the expected answer is a named refusal.
- **Oracle families only.** Emit only families for which the arbiter has
  an automatic third reference (boxes by cell decomposition, axis-aligned
  cylinders and spheres by closed forms, skins and gaps by closed forms).
  Other families first get a recipe.
- **Typed minimizer.** Delta debugging over the CSG tree (drop nodes, then
  leaves), leaf parameters (toward round dyadic values), transforms (toward
  the identity). A step is kept only if the *same typed verdict* survives,
  for example `wrong-ok: non-manifold vertex` or
  `relation-violated(perm-17)`. The unminimized seed is kept with the
  minimized case, as `boolean-stress.md` already requires.
- **Score by distinct minimized classes**, never by raw disagreement count.

**Where it plugs in.** `scripts/gen/` (host JS) writing
`wonky-bakeoff-job 1` files into a new suite; the minimizer calls
`run.mjs`; minimized cases become corpus cases named after their class and
first commit.

**Bend fit.** Host side. Generated cases run through the existing Bend
entry points. The generation itself is irregular and stays out of Bend.

**Expected benefit.** A continuous source of adversarial cases, and small
reproducers for every new defect class. It also tests the tests: a
generator that cannot rediscover old defects is too weak.

**Risk.** Oracle coverage limits the families; unarbitrated disputes block
scoring. Minimization can slide into a different defect; the typed verdict
guards against that. CPU time competes with benchmarks; run it only when
the machine is otherwise idle.

**First acceptance test.** One CPU-hour on cpu18 at commit `903dde5`, the
parent of the hybrid-gate commit `aa84b76` (which added corefine's
`gate.bend` and the unification; `git show --stat aa84b76`). The generator
rediscovers at least three of the defect classes documented for that state
(point contact returned `ok`, rotated coplanar self-intersection, grazing
tool below the deviation, recover's near-tangency bypass, recover's sliver
absorption) as minimized cases of at most three leaves. The same budget at
HEAD yields zero wrong `ok`.

### P7. One case-result schema with OCCT's state machine

**Idea.** wonky's runners each have their own outcome vocabulary:
boolean-stress (`native-resolved`, `unsupported`, `incorrect`), the public
regressions (`unsupported-api`, `unsupported-geometry`, `wrong-geometry`,
`incomplete-oracle`, `validation-error`, `execution-error`,
`passed-adapted-geometry`), the bake-off (`pass`, `mismatch`, `invalid`,
`unresolved`, `expected-refusal`, `info`, `ambiguous`, `unarbitrated`,
`error`, `timeout`, `no-source`), R20, CADBench, the fillet harness and the
corpus benchmark. Each is careful; together they cannot answer "what
changed since yesterday".

Define one schema that every runner's report maps into:

- outcome: `pass`, `expected-refusal(code)`, `known-bad(issue, assertion
  ids)`, `improvement`, `fail`, `invalid`, `ambiguous`, `unarbitrated`,
  `skipped(reason)`, `cancelled(budget)`, `crash`;
- per assertion: id, quantity, unit, observed, expected, absolute and
  relative tolerance, basis (closed form, OCCT, manifold3d, Onshape,
  relation);
- a completion marker, the implementation hash, the target, the inputs'
  hashes.

Adopt OCCT's semantics: a `known-bad` expectation is precise (issue plus
assertion ids); if it disappears, the result is `improvement` and CI fails
until the expectation is removed, so fixes are recorded; a missing
completion marker is `crash`, never `skipped`.

**Where it plugs in.** An adapter (`scripts/cases/collect.mjs`) that reads
the existing JSON reports; no runner is rewritten. The corpus backlog and
the Postplan reports can read the same table.

**Bend fit.** Harness only.

**Expected benefit.** One cross-runner view; `improvement` makes silent
fixes and silent regressions (F9) visible; precise known-bad records stop
blanket masking.

**Risk.** Mapping drift when a runner changes its vocabulary; the adapter
needs tests per runner. Scope creep into a rewrite: keep it an adapter.

**First acceptance test.** The adapter reads the stored reports of the
bake-off judge round 2, the boolean-stress baseline, the public regressions
and the latest R20 run, and its per-runner counts equal the counts in those
reports. A synthetic `known-bad` case that starts passing yields
`improvement` and exit code 1.

### P8. Deterministic work budgets, tested across targets

**Idea.** Plan step 11 adds budgets. For testing, the budget must be
counted in work units (predicate evaluations, BVH node visits, refinement
depth), not wall time, so that a refusal is byte-identical on all four
targets. Keep a separate wall-clock timeout in the harness as a safety net,
like OCCT's 300 s CPU cap in `boolean/begin`.

**Where it plugs in.** corefine and recover entry points (step 11); the
bake-off runner's `targetsAgree` check.

**Bend fit.** A counter threaded through the computation as a value; no
mutation needed. Fork-join branches report their counts, the parent adds
them.

**Expected benefit.** F4 becomes a named refusal (`budget`) with the same
bytes everywhere, instead of 70 s on JS.

**Risk.** Work units must be meaningful across very different phases;
calibrate per phase.

**First acceptance test.** The near-coincident sphere union from plan §7
is refused with `unresolved budget(<phase>, <units>)` on JS, cpu1, cpu18
and Metal with identical bytes, and in under 2 s on JS.

### P9. STEP validation properties and a round-trip gate

**Idea.** Write CAx-IF v4.6 part-level validation properties into every
exact STEP export: volume, surface area, centroid and the agreed bounding
box (vertices and edges, not the tight box), combined into one
`REPRESENTATION('')`, with the v4.6 identification string in
`FILE_DESCRIPTION`. `validate-step.py` reads them back and compares with its
own recomputation twice: at wonky's declared tolerance (a self-check), and
at the v4.6 industry thresholds (exchange). Expose both the tight box and
the CAx-IF box in wonky's queries so that a correct kernel does not "fail"
a receiver's bbox check. Run NIST SFA occasionally, on a Windows machine,
for the form of the properties.

**Where it plugs in.** `src/exporters.mjs` (the AP214 writer);
`scripts/validate-step.py`; `kernel/volume.bend` for the integrals.

**Bend fit.** Volume, area and centroid are per-face integrals, a uniform
map-reduce; planar faces can be summed exactly with limbs; cylinder and
cone integrals are closed forms in F32x2.

**Expected benefit.** Every receiving CAD (Fusion, Onshape, FreeCAD)
reports green, yellow or red automatically; wonky's own exports carry their
own check.

**Risk.** Low. Never reuse the 0.5% threshold for kernel regressions.

**First acceptance test.** KT2's STEP carries the four properties; the
OCCT reader recomputes volume and area within 1e-9 relative of the embedded
values and the centroid within 1e-6 mm; a deliberately wrong embedded
volume is reported.

### P10. Dataset replay lanes, behind Marc's own corpus

**Idea.** Marc's own 423 files remain the primary corpus. Datasets add
volume where his files are thin:

- **Fusion 360 Gallery**, reconstruction subset plus the extrude tool
  bodies: per-stage oracles (profile area, perimeter and centroid; the tool
  body; the post-Boolean snapshot; final mass properties). A host-side
  JSON-to-FeatureScript converter with an explicit snapping policy for the
  `(1 + 2^-26)` coordinate bias. External, uncommitted cache only.
- **DeepCAD** raw JSON (not the quantized vectors), with grouped profiles
  and body scopes preserved.
- **ABC** STEP files, capability-filtered on faces *and* edges and pcurves,
  once a STEP reader exists.

**Where it plugs in.** `scripts/corpus/` next to the corpus benchmark;
results in the P7 schema.

**Bend fit.** Data only; replay is sequential per design, parallel across
designs.

**Expected benefit.** Thousands of realistic plate-and-hole Booleans, the
plane/cylinder class that blocked wonky; per-extrude face-role labels as a
naming oracle.

**Risk.** Licensing dominates. The Fusion license is non-commercial and binds the employer of a user who works for a company, so the Fusion lane is limited to non-commercial research (INFERRED; not legal advice). The DeepCAD parser is unlicensed; ABC's model rights belong to their creators. Every dataset answer is one kernel's answer.

**First acceptance test.** 100 designs from the Fusion test split that use
only lines, arcs and circles without taper: each either builds with final
volume within the bias-induced bound of the JSON volume (converted from
cm³) or refuses with a named capability; zero wrong `ok`; zero files from
the dataset in the git tree.

## 6. Open questions worth a prototype

- **Q1. Is the hybrid equivariant under axis permutations?** corefine
  resolves degeneracies by symbolic perturbation; if its perturbation
  directions are fixed in world coordinates, exactly degenerate cases may
  resolve differently in another frame before recover unifies them.
  Prototype: P1's first acceptance test, then diff the results byte by byte
  after the inverse transform. The answer decides whether P1 can require
  byte identity.
- **Q2. What does certification cost, and how many R20 verdicts survive
  it?** Prototype P4 in JS on the 16 building R20 cases; measure time per
  case and the fraction of `pass`, `undecided` and `fail` under `upper`.
- **Q3. Can certified tessellations certify face-face disjointness?**
  Non-adjacent faces whose certified meshes are farther apart than the sum
  of their deviations cannot meet. How many pairs on real parts (0.42 mm
  chamfers, thin walls, M3 holes) fall into the close band and need exact
  SSI? Prototype on the 16 building corpus units and the R20 parts.
- **Q4. Which incidence checks can be exact with bounded limbs?** For every
  current carrier pair (plane, cylinder, cone against line, circle, ellipse),
  derive the identity, its degree and the limb width it needs at the
  ±10,000 mm envelope. Is ellipse-on-cylinder decidable within eight limbs?
- **Q5. Does relation-rich generation beat uniform generation for solid
  Booleans?** Spatter measured it for spatial predicates. Measure distinct
  minimized classes per CPU-hour on commit `903dde5`, with both generators.
- **Q6. How tight is the Onshape oracle at `VolumeAccuracy.HIGH`, and what
  does it cost?** Capture KT2 at HIGH and default accuracy; compare the
  interval widths; count metered calls through the session bridge.
- **Q7. Can a symmetric-difference volume be computed without circularity?**
  Computing `vol(A Δ B)` with corefine tests corefine with itself. Using
  exact-plane (the differential oracle) or manifold3d as the SD engine
  avoids that. Compare SD volume and certified Hausdorff on the R20 parts.
- **Q8. Do tolerances grow along chains?** Record recover's certified
  residuals and the unification decisions along r10b's feature chain and
  along mesh-booleans.md's iterated cube grid. Does anything resemble
  Jackson's tolerance growth (F7)?
- **Q9. Is the FeatureScript interpreter a fuzzing target?** 71% of corpus
  units stop at a frontend error (corpus triage). Grammar-based generation
  of FeatureScript could find interpreter crashes and hangs (F3, F4 in the
  frontend) that no geometry test reaches. The safety lane of GEOS's fuzzing
  applies here, not to Bend geometry.

## 7. Catalog of the remaining sources

Catalog-only sources from the scout (not deep-read; claims as the scout
stated them):

| source | kind | status | license | one line | URL |
|---|---|---|---|---|---|
| Google FuzzTest | library | active | Apache-2.0 | coverage-guided property-based fuzzing for C++ with typed domains; Manifold's fuzzers use it | https://github.com/google/fuzztest |
| ISO 10303-59:2022 | standard | maintained | ISO, paywalled | shape-data quality criteria and recording of inspection results; successor to the SASIG PDQ guidelines | https://www.iso.org/standard/84678.html |
| next.BREP.io (Autodrop3d) | product | new | share-back license (scout) | a public known-problems page where each entry attaches its reproducing model; predecessor repository in [brep-io](sources/brep-io.md) | https://next.brep.io/ |
| Analysis Situs | inspection workbench | active | BSD-3-Clause (depends on LGPL OCCT) | open B-rep inspection with tolerance and validity diagnostics | https://gitlab.com/ssv/AnalysisSitus |
| CGAL testsuite and nightly testing | docs | active | GPL-3.0/LGPL-3.0 | nightly multi-platform testing of an exact-computation library, public results matrix | https://github.com/CGAL/cgal/wiki/Testing |
| ITI CADIQ | commercial product | commercial | commercial | validation of derivative models and revision comparison | https://www.iti-global.com/interoperability-products/cadiq/ |
| Czumaj, Sohler 2000, "Property Testing in Computational Geometry" | paper | historical | paper | a false friend: sublinear randomized algorithms, not property-based software testing | https://link.springer.com/chapter/10.1007/3-540-45253-2_15 |

Sources the scout named in passing, with where they are covered:

- **Manifold** issues #1430, #1706, #1682 (checked with `gh api` for this
  chapter) and the FuzzTest-based CSG fuzzer (scout): sibling note
  [manifold](sources/manifold-elalish-manifold.md);
  https://github.com/elalish/manifold.
- **Truck** #114, coincident geometry (checked): sibling note
  [truck](sources/truck-ricosjp-truck-rust-b-rep-kernel-truck-shapeops-boolean.md);
  https://github.com/ricosjp/truck/issues/114.
- **Fornjot**: validation layers without a Boolean, archived:
  [Fornjot shutdown](sources/fornjot-shutdown-post-shutting-down-fornjot-2026-and-the-for.md).
- **Jackson 1995**, local tolerances (vertex, edge, face):
  [Jackson](sources/jackson-1995-boundary-representation-modelling-with-local-to.md);
  https://doi.org/10.1145/218013.218067.
- **Cherchi et al. 2020**, mesh arrangements, validated against libigl by
  V/E/F counts:
  [Cherchi 2020](sources/cherchi-livesu-scateni-attene-2020-fast-and-robust-mesh-arra.md).
- **CAD-Recode** (generator distributions for P6):
  [CAD-Recode](sources/cad-recode-rukhovich-et-al-iccv-2025.md).
- **Solidean iterated-CSG benchmark** (the failure taxonomy used in
  mesh-booleans.md P7):
  [Solidean benchmark](sources/solidean-iterated-csg-benchmark-series-2026.md).
- **FreeCAD** #28189, #26677, #19255 (checked): examples of F8, F9, F10;
  the scout's count of 212 "toponaming" issues was not re-checked.
- **OCCT** #1496, #1543, #1360, #245 (checked) and #724, #1041, #1193, #1315,
  #1371, #1385, #1534, #1541 (in the OCCT notes).
- **Thingi10K**: the mesh source of EMBER's 1000 benchmark pairs; relevant
  only for the mesh stage (see the EMBER note).
