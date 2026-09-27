# CAD acid test (AC1)

One frozen model made of 48 small zones. Each zone tests one theme and is
described twice: as Onshape FeatureScript and as a build123d/OCCT twin. Zones
are checked per zone without image comparison:

1. closed forms where they exist (volume, area, canonical topology, bounding
   box, targeted distances and edge lengths);
2. cross-comparison Onshape (Parasolid) vs OCCT vs wonky where no closed form
   exists;
3. validity (the kernel's own B-rep check and a STEP round trip that re-checks
   the zone's topology and measurements);
4. four metamorphic variants of every zone (V0 to V3).

The result has two scores per kernel, **strict** and **practical**, with one
verdict per zone/kernel. Both use the same 48-zone denominator. A practical
point is not a strict-v1 pass and is never an exact-construction claim.

The catalog is `fixtures/cad-acid/zones.json`. It was written before any kernel,
twin or Onshape result existed, and its tolerances and accepted outcomes are
predeclared. `scripts/acid/closed-forms.py` recomputes every closed form from
the construction parameters and must pass after any edit of the catalog.

## Three-tier verdicts and two scores

The versioned practical overlay is `fixtures/cad-acid/tolerance-rules.json`
(`AC1-tolerance-2026-09-27-1`). It does **not** edit `zones.json`, its original
bands, accepted branches, observations or the six disputed zones.

- **CORRECT**: strict v1 `PASS` or `REFUSED_EXPECTED`. Expected refusal remains
  identified by `expectedRefusal` and `strictStatus`, including its reason.
- **TOLERANT**: fails strict v1, but every variant satisfies the measurable
  acceptance of the same predeclared, source-evidenced rule for this kernel.
  The scorer checks original observations, both STEP imports and metamorphic
  invariants. An audit classification never supplies acceptance or a point.
- **WRONG**: a strict defect not covered by a fully measured tolerance rule.
- **REFUSED**, **ERROR**, **NOT_RUN**, **DISPUTED** and **UNVERIFIED** retain
  their meanings and receive no points under either score.

`strict = CORRECT`; `practical = CORRECT + TOLERANT`. JSON schema
`wonky/cad-acid-scoreboard/2` exposes both kernel totals, new-tier `counts`,
legacy `strictCounts`, per-cell `strictStatus`, `strictPoints` and
`practicalPoints`. `score` and `points` remain aliases for the **strict**
values, never the practical values. Rules and their digest are included in the
report; tolerant cells cite `toleranceRuleIds` and their STEP witness hashes.
The exact class, including **wonky-rust**, cannot receive TOLERANT. A serialized
or fabricated observation still cannot acquire either kind of point.

### Current scored snapshot (2026-09-27)

Main kernel revision `c2ce6b5684160adc42e4d74b759f736dfb1e4615`, with this
scoring overlay. The Rust addon was built through the bounded Studio runner
under nice with `CARGO_BUILD_JOBS=4`, then all 192 Rust zone/variants were
executed locally (`--no-smoke`, exit 0). External rows are the 192 frozen
observations per reference, not live external calls.

| Kernel | Evidence | Strict /48 | Practical /48 | CORRECT | TOLERANT | WRONG | REFUSED | ERROR | DISPUTED | UNVERIFIED |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Onshape | frozen | 38 | 38 | 38 | 0 | 3 | 0 | 1 | 6 | 0 |
| OCCT | frozen | 37 | 39 | 37 | 2 | 2 | 1 | 0 | 6 | 0 |
| wonky-rust | live | 30 | 30 | 30 | 0 | 0 | 12 | 0 | 6 | 0 |

Every kernel has zero NOT_RUN cells. Rust's 30 strict points comprise **26
geometry passes and 4 expected refusals**, not 30 geometry constructions.
The run tree digest is
`56348d8f4aaf12a9c6e97cd4bdb09f8a3aea4b1f5905835813a817d02eb71637`;
addon source hash is
`bc4d39255d9611bba53fbceacdb05616da9be17b775f16177885976e08ce4c93`.
`out/cad-acid-tolerant/scoreboard.json` records the full addon binary and
reference identities, per-variant strict failures and fired rule IDs.

No claim: no new Onshape execution, no new geometry capability, no AC20 C1
certificate and no exact-native topology proof from a tolerance STEP import.

### Declared measurable rules

| Rule | Kernel | Phenomenon and acceptance |
|---|---|---|
| `OCCT-CONTACT-IMPRINT-1` | OCCT | An exact external tangency between two parallel capped cylinders may split boundary faces/edges. Two valid closed positive bodies, independently witnessed analytic radii/axes/full spans/full caps and per-body genus zero are required. Native and both STEP-import volumes, areas, bounding boxes and probes retain strict v1 bands. No joining, lost body, bridge or lens is accepted. |
| `OCCT-FUZZY-CONTACT-1` | OCCT | Same geometry and validity contract, with a strictly positive input gap **below `1e-7 mm`** allowed to become contact. This is OCCT V7_8_1's default Boolean fuzzy value, not a blanket healing tolerance. |

The rules use construction predicates, not zone IDs. Both are checked against
**all 48 zones**. The new rule tests preserve OCCT's invalid AC27 lens as WRONG
under every rule and exercise out-of-band volumes, gaps, invalid bodies, real
raw-topology handles, missing measurements and both STEP imports. The two
current applications are AC22 (contact imprint) and AC44 (sub-fuzzy contact).

Sources are versioned in the rules file: OCCT V7_8_1
`BOPAlgo_Options.cxx:54,70` initializes `myFuzzyValue(Precision::Confusion())`,
`Precision.hxx:163` defines `1e-7`; `Precision.hxx:121` defines angular
resolution `1e-12`. The frozen build123d 0.10.0/OCP 7.8.1.1.post1 twin does not
set a fuzzy override. Same-domain face/edge unification is a representation
operation, not permission to change material. **CE12** records the catalog's
incorrect descriptive statement “fuzzy value 0” in `errata.json.annotations`.
It is informational: it neither adds a DISPUTED cell nor changes strict points.

### Correct physical witness, reproducible strict observation

The legacy canonical observer can remove a seam without compensating for an
imprinted face and report impossible `genus=-0.5`. Its original v1 diagnostic
is retained for strict reproducibility. `measure.py::physical_witness` adds a
separate per-body Euler/genus and analytic-support observation. The practical
scorer requires both that STEP witness and the independently recomputed raw
native cell decomposition, plus unchanged strict geometry and validity checks.
It does **not** whitelist the bad canonical tuple or rewrite native genus to
zero. STEP support is not evidence of unrecorded native topology.

Twelve original archived STEP files (AC20, AC22, AC44, V0–V3) are frozen
byte-for-byte under `fixtures/cad-acid/occt/artifacts/`. The added files
`tolerance-provenance.json`, `tolerance-witness.json` and
`tolerance-SHA256SUMS` record per-file identity checks and witness bindings.
The original OCCT observations, provenance and checksum manifest are untouched.
There were **no historical STEP hashes or recorded byte sizes**: historical
identity rests on recomputing the original import/roundtrip observations, not
on a retrospective claim of historical byte authentication. All 12 agree
(exact topology/validity; numerical re-observation within `1e-9` relative or
`1e-7` absolute, not a new scoring band). The new manifest now binds their
exact bytes and derived witness.

`uv run --no-project .../reference-venv/bin/python
scripts/acid/tolerance-witness.py --help` describes offline re-derivation.
This is a measurement fix on existing artifacts, not fresh OCCT construction
or new Onshape evidence. AC44's exported support need not preserve the tiny
positive input gap; the rule explicitly permits sub-Confusion contact.

### Audit B is not an automatic tolerance verdict

Three cells remain WRONG with an **evidence pending** modal note:

- Onshape AC40: no pinned std 3044 solid-Boolean gap policy; the older std
  2960 surface-join constant is insufficient.
- Onshape AC20: the STEP model-accuracy declaration is not a certified
  area/volume guarantee or fitted-curve error bound.
- OCCT AC20: extra STEP edges do not prove one-to-one, gap-free C1 continuity
  under a declared transport-error bound. The archived STEP alone has not
  supplied that certificate.

The script-free public page consumes schema /2 with
`scripts/acid/build-status-page.py`. Its badge tiles and CSS-only chip filters
use the new tiers; the headline compares both scores and modals cite fired
rules. “Evidence pending” is a note, never a badge or a practical point.

## Declared errata and evidence admission (AC01 audit fix)

The versioned scoring overlay is `fixtures/cad-acid/errata.json`, version
`AC1-errata-2026-09-27-2` (CE8–CE11 unchanged; informational CE12 added).
It is disclosed in both scoreboard formats. The
frozen catalog remains byte-for-byte unchanged, SHA-256
`c83552ff482d2805b298686d0f0a4b1e973007b5ea9f92f0dbc7341d32b2b547`.
No strict-v1 tolerance or accepted geometry branch is widened. Until a v2 catalog or
corrected, re-frozen twins are independently verified, all six listed zones
are **DISPUTED for every admitted kernel observation**, including unexecuted
cells: zero points, never PASS or WRONG, still in the 48-zone denominator.
Unverified wonky input rows are rejected before even this catalog verdict.
Historical raw v1 scoreboards below are not the current verdicts.

| Erratum | Zones | Evidence and reason | Required resolution |
|---|---|---|---|
| CE8 | AC31 | FS `opFillet` defaults to `allowEdgeOverflow=true`. Exact overflow volume is `512 - 16*(8 + sqrt(12) - 8*pi/3) = 462.61566071096047` mm³; frozen Onshape gives 462.61566071096163 mm³, OCCT BRepCheck valid, closed shell. The refusal-only contract is wrong. | Specify overflow geometry in v2. No exact-class infeasibility claim; a refusal must name the actual unsupported operation/edge-overflow capability. |
| CE9 | AC36 | `acid-blend.fs` lines 175–183 select empty `qCreatedBy(union, BODY)`. The frozen feature error is `FILLET_SELECT_EDGES`; the union preserves an input body. | Correct selection using surviving inputs and re-freeze. |
| CE10 | AC38 | `acid-blend.fs` lines 198–200 use `DraftType.NEUTRAL_PLANE/neutralPlane`. The documented std call uses `DraftType.REFERENCE_SURFACE`, `referenceSurface`, `pullVec`; frozen result is `REGEN_ERROR`. `src/lang/dataflow/fs-trace.mjs` accepts the incorrect alias. | Correct/re-freeze the FS twin. Frontend alias divergence remains a separate follow-up, not a Parasolid defect. |
| CE11 | AC25, AC26, AC48 | `acid_curved.py` and `acid_precision.py` substitute Cone/Torus primitives for revolves. The independent audit's actual AC48 revolve yields a SurfaceOfRevolution with observed `singularPoints=0`, changing the v1 verdict. | Use real revolve twins, re-freeze, settle the representation-independent singular-point check. |

Evidence is recorded per entry in the errata JSON: frozen artifacts under
`fixtures/cad-acid/onshape/` (checksummed), exact formula above, twin source
locations, and the documented [opFillet](https://cad.onshape.com/FsDoc/library.html#opFillet-Context-Id-map)
and [opDraft](https://cad.onshape.com/FsDoc/library.html#opDraft-Context-Id-map)
signatures. Numerical audit findings are in
local development evidence; this fix makes no new live Onshape
calls and does not re-author the twins.

### Audit-fix scoreboard comparison

Re-scoring the stored OCCT v1 rows and freshly measured frozen Onshape rows,
with the new strict Rust 48-zone run. These are deliberately a historical
comparison, **not** a merge of builds: their code identities differ, and the
whole table was labelled UNVERIFIED. Its old artifact-only Rust admission was
insufficient and is superseded by the execution rules below. Re-scoring that
stored file without `--reverify` now awards zero wonky points.
Each cell below is `before → after` the errata overlay. No retired-kernel
observations are admitted or compared in this audit.

| Kernel | Score /48 | PASS | REFUSED_EXPECTED | REFUSED | ERROR | WRONG | NOT_RUN | DISPUTED | UNVERIFIED cells |
|---|---|---|---|---|---|---|---|---|---|
| onshape (frozen) | 40 → 38 | 40 → 38 | 0 → 0 | 0 → 0 | 4 → 1 | 4 → 3 | 0 → 0 | 0 → 6 | 0 → 0 |
| occt (stored v1) | 42 → 37 | 41 → 37 | 1 → 0 | 1 → 1 | 0 → 0 | 5 → 4 | 0 → 0 | 0 → 6 | 0 → 0 |
| wonky-rust (fresh) | 2 → 2 | 1 → 1 | 1 → 1 | 46 → 40 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 6 | 0 → 0 |
| wonky-bend (excluded/retired) | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 0 → 0 | 48 → 42 | 0 → 6 | 0 → 0 |

Evidence: local development evidence
and its `results.json` retaining per-row provenance. The new Rust run is
local development evidence: 192 zone/variant builds,
all guarded Bend-free, `--no-smoke`, exit 0, 2/48, 0 WRONG. AC01 supplies the
geometry point; AC45 supplies the expected open-profile refusal. AC31 actually
refuses the unported `fCuboid` host operation, not geometric infeasibility.

Regression evidence is local development evidence (all five
findings plus requested-kernel exit fail) and `audit-cad-acid.log` (23 tests
pass, including extended positive/negative controls). `audit-test-rust.log`
records the successful explicit 13-file lane. Tests are not kernel capability
claims; no geometry was implemented by this harness fix.

### Verification rules

- Only execution by the kernel proves a wonky observation. `run.mjs` calls
  `execution.mjs` to build the FS twin, obtain native observations and score
  in the same process, with the checked live addon. A private process-local
  row binding cannot be serialized, supplied by a caller, or manufactured by
  matching files. The result contains the actual tree identity, addon source
  hash and binary SHA-256. Both identities are checked again before publishing
  the scoreboard. The in-process import/addon guard must remain clean.
- Standalone `score.mjs results.json` awards **zero points to every wonky
  input row**, including refusals, export failures and recorded NOT_RUN rows:
  they are UNVERIFIED. Absent rows stay NOT_RUN. No self-consistency check is
  labelled VERIFIED. With `--reverify`, each claimed Rust zone/variant is
  executed through the same runner, against the live tree and live addon. The
  recorded tree, addon, outcome, native observations, measurements, validity
  and STEP round trip must match. Refusals must reproduce their name, category,
  builtin and under-test/capability classification. Mismatches are reported
  individually and remain UNVERIFIED. The retired backend is never executed.
- Native construction and artifact consistency remain necessary, not sufficient:
  every body needs `boundToConstruction === true`, complete native probe
  coverage and the same body/WC0 binding as the serialized B-rep. Scored metrics
  are the native observations. Successful exact exports additionally require
  hashes of request/build/B-rep/STEP/measurement files, checked against their
  bytes and source/catalog/STEP bindings. `--artifact-root` relocates old
  artifacts but never selects the source tree or addon used for re-execution.
- Post-build failures have **no execution-admission exemption**. A failure
  actually obtained during this run stays built and reaches WRONG/validity
  instead of ERROR/REFUSED. Replayed failures must reproduce the observation.
  AC41's declared unhealed-sliver exception can apply to wonky only after
  execution admission. AC41's exact class uses its frozen 1e-9 relative bands;
  the sliver envelope applies only to the tolerance-class sliverBound branch.
- External references remain **frozen**, not live: Onshape checks its existing
  manifest and re-observes only local frozen STEP files; no API calls occur.
  `fixtures/cad-acid/occt/` preserves the unchanged 192 OCCT rows from the
  stored AC1 run, with original-file hash/provenance and SHA256SUMS. Both are
  compared to the supplied observations before receiving the frozen label.
  A fresh requested OCCT build is **live-reference**, never a scored reference:
  its observations stay in `results.json`'s separate `liveReferences` list,
  outside the scored rows, including after merging. It earns zero points and
  cannot replace or fill a missing frozen OCCT row. The OCCT and Onshape columns
  receive points only when their observations match the checked frozen reference
  exactly. Self-consistent artifacts are not a substitute: unmatched stored rows
  are unverified and receive zero points, also after merging.
- Each kernel's scoreboard header reports **live / re-verified / frozen /
  unverified**, with row-mode counts in JSON. Mixed mode is unverified at the
  kernel header; the row counts preserve the distinction. No generic VERIFIED
  label implies authenticity of writable files. The Markdown header includes
  the catalog and tree SHA-256 plus each recorded addon sourceHash/addonSha256.
  JSON `verification.referenceFixtures` and the Markdown header identify the
  matched reference bytes: OCCT `observations.json` and `SHA256SUMS`, and Onshape
  `SHA256SUMS` (the verified manifest of the entire freeze, not just provenance).
  These digests are bound to frozen admission in this process, not copied from
  input claims or read later at publication. Missing matches have no digest;
  unverified identities remain recorded claims, not current execution evidence.
  Synthetic numerical classifications are not execution evidence and cannot
  award points, even through the in-process scoring API. `score()` refuses a
  catalog object differing from the frozen file rather than misreporting its hash.
- Run identity hashes actual tracked and untracked files under `rust/`,
  `src/` and all of `scripts/`, including deletions. This conservative closure
  covers the STEP validator and transitive R20 imports as well as the runner.
  Merge rejects different/missing local identities and addon source hashes.
  Identical frozen external rows repeated across zone batches are deduplicated;
  conflicting duplicates and all local duplicates are rejected. Merging is
  not execution: use `score.mjs --reverify` for points after a merge.
- `run.mjs` exit status considers only requested kernels. Frozen neighbours'
  WRONG counts cannot fail a Rust-only run. Standalone scoring reports all
  WRONG/unverified cells through its exit status.

### Bend-free verification lane

`pnpm test:rust` runs `scripts/test-rust.mjs`: the explicit 13-file list from
AC01's independent gate, sequentially, fail-fast, with
`WONKY_BACKEND=rust` and `NODE_OPTIONS=--max-old-space-size=8192`. The list is
checked nonempty and all files must exist. No glob and no fallback to Node's
whole-repository test discovery are used. Each file runs under the import/addon
guard and must report `bendLoaded=false` in `out/test-rust/`.

The files cover the benchmark observer, CAD-Acid scorer/runner regressions,
frozen R20 references, publication rendering, Rust host, and eight viewer
modules. The lane requires an existing matching Rust addon; it does not compile
one. Cargo builds/tests run only through the bounded runner, for example
local development evidence.
Do not run the historical `test`/`test:fast` lanes: they can load the retired
kernel. These 13 files are not a claim that every JS test is migrated.

## Status (historical AC1, 2026-09-26)

| Piece | Path | State |
|---|---|---|
| Catalog, 48 zones in 5 groups | `fixtures/cad-acid/zones.json` | version `AC1-2026-09-26-a1`, frozen; checker passes 1561/1561 |
| Closed-form checker | `scripts/acid/closed-forms.py` | runs with `uv run`, 17 planted mutants caught (below) |
| FeatureScript twins, one Feature Studio per group | `fixtures/cad-acid/fs/acid-<group>.fs` | written; boolean and precision still lack the per-zone `acidACxx` functions (authoring grain only, no geometry effect) |
| build123d twins, one module per group | `fixtures/cad-acid/b3d/acid_<group>.py` | written |
| Runner, measurer, scorer, Onshape push script | `scripts/acid/` | written; the push ran live once (below) |
| Frozen Onshape reference | `fixtures/cad-acid/onshape/` | frozen 2026-09-26: document `a4463fc362ce4f30055696a6` (public, "wonky CAD-Acid v1"), one Part Studio per variant, 100 feature states, `provenance.json` + `SHA256SUMS` |
| Test | `test/cad-acid.test.mjs` | 15/15: synthetic scorer contracts (not kernel evidence) plus four live OCCT checks (observer primitives, observer edge-merge rule, curved twin vs build123d's named Booleans, a planted AC31 body through `build-occt.py`) |

The Onshape references were frozen once over the session bridge; the account's API usage counters were unchanged before and after every push run.
the onshape column to the stored AC1 observations of the other kernels.

## Historical raw v1 scoreboard (before CE8–CE11)

Revision: `git c7fa3c3f6435` + worktree diff (`onshape-push.mjs`,
`frozen-onshape.py`, the `acid-blend.fs` feature name, `fixtures/cad-acid/onshape`).
The occt, wonky-bend and wonky-rust rows are the stored AC1 observations
(`git 4d126c35d690 + diff sha256:c156c6f95ba12e15`, next section); they were
not re-run. Onshape rows: `scripts/acid/frozen-onshape.py` on the frozen
reference.

| Kernel | Score | PASS | REFUSED_EXPECTED | REFUSED | ERROR | WRONG | NOT_RUN | DISPUTED |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| onshape | 40/48 | 40 | 0 | 0 | 4 | **4** | 0 | 0 |
| occt | 42/48 | 41 | 1 | 1 | 0 | **5** | 0 | 0 |
| wonky-bend | 6/48 | 6 | 0 | 39 | 3 | 0 | 0 | 0 |
| wonky-rust | 0/48 | 0 | 0 | 0 | 0 | 0 | 48 | 0 |

**Onshape WRONG (4; subtypes geometry 4, validity 3, topology 1), identical in V0 to V3:**

- AC40: the 2^-10 mm (9.8e-7 m) gap is closed and filled. One box, volume
  256 vs 255.984375, gap 0. The catalog assumes Parasolid's 1e-8 m resolution;
  Onshape's Boolean merges this gap.
- AC31: v1 incorrectly counted the feasible overflow fillet (volume 462.62
  of the 512 plate) as WRONG because it required a refusal. CE8 supersedes
  that verdict with DISPUTED; this is a catalog error, not silent-wrong.
- AC20: STEP-measured area 1821.04783 vs 1821.04336 (+2.45e-6 relative, band
  1e-6); volume within 4.1e-7. The quartic edge is a B-spline in the STEP file.
- AC27: volume -3.14e-5, area +1.1e-5, V2 bounding box. This is an observer
  artifact, not Onshape geometry. The STEP file carries the exact lens: two
  spheres r=8 at x=2000 and x=2008 and a circle of radius sqrt(48) at x=2004.
  OCCT measures that imported face pair as 670.18541 at every integration
  tolerance (ShapeFix does not change it), while OCCT's own Boolean of the
  same spheres gives 670.20643 (the closed form). Verdict unchanged.

**Onshape ERROR (4), with the frozen `getFeatureError` enum; the failed
features left no body:**

- AC36 `FILLET_SELECT_EDGES`: a twin defect. `acidAC36` selects the edge on
  `qCreatedBy(id + "union", BODY)`, which is empty in Onshape because a union
  keeps the tool body. The other twins use `acidResult(inputs, created)`.
  Parasolid never saw the fillet. A corrected twin needs a new freeze.
- AC38 `REGEN_ERROR` (draft): CE10 isolates an incorrect twin call signature,
  not a Parasolid refusal. Current verdict: DISPUTED.
- AC47 `PARAMETER_OUT_OF_RANGE`: `fCylinder` rejects the 3.9 µm radius.
- AC48 `REVOLVE_FAILED`: a named Onshape refusal. The zone accepts the refusal
  `singular-geometry`, but no mapping from Onshape errors to refusal categories
  was declared beforehand, so it scores ERROR.

**Cross-comparison:** AC35 has a reference now. Onshape and OCCT agree within
1e-4 in every variant, so occt AC35 is PASS (was DISPUTED); wonky-bend AC35
stays REFUSED (`isVariable` not implemented). AC36 has no reference (Onshape
ERROR); raw v1 occt AC36 was WRONG/topology. CE9 now disputes the zone.

**Volume basis (disclosed).** Onshape's REST mass properties are an estimate
with declared [min, max] bounds: 4e-2 relative on the AC07 helix sweep,
2.7e-3 on AC19, about 1e-14 on planar bodies. The observer scores the OCCT
volume of the exported B-rep and admits it only inside Onshape's own bounds;
area, box, topology and probes were STEP-measured already. With the native
value as the volume, AC07 and AC19 flip to WRONG and onshape scores 38/48
(`out/cad-acid-native-volume/`).

**Twin fix:** Onshape did not compile `acid-blend.fs` (empty featureSpecs): the
non-ASCII dash in its `Feature Type Name`. It is now an ASCII colon. This is
the display name only; closed forms 1561/1561 and `test/cad-acid.test.mjs`
15/15 pass after the fix. The AC35 call shape (`isVariable`, `vertexSettings`,
`smoothTransition: false`) passed its pre-flight unchanged: setbacks
10/14/8/12 and spring line sqrt(68) exact.

**No claim:** the onshape column is Onshape's frozen output measured by the
OCCT observer, a tolerance measurement. The occt and wonky rows are stored
observations, not re-run at this revision. A re-run of the wonky-bend blend
zones at `c7fa3c3` gives different verdicts, from kernel changes that landed
after AC1: AC29, AC30 and AC34 ERROR in V1 (coordinate envelope), and
**AC31 WRONG under the incorrect v1 refusal-only contract** (superseded by CE8). Evidence:
`out/acid-onshape/wonky-blend/` in the freeze worktree.

## Scoreboard (AC1 Regression review, 2026-09-26, before the Onshape freeze)

Revision: `git 4d126c35d690 + diff sha256:c156c6f95ba12e15` (HEAD plus
`tmp/acid/integrate/revision.sh`: sha256 over `git diff HEAD` and every
untracked file under `fixtures/cad-acid`, `scripts/acid` and
`test/cad-acid.test.mjs`; this document is excluded). Catalog sha256
`c83552ff482d2805...` (`AC1-2026-09-26-a1`, unchanged). Full table:
`out/cad-acid/scoreboard.md`; observations `out/cad-acid/results.json` (48 zones
x V0..V3 x 3 run kernels, isolated `zone = <id>` builds, plus 60 `ALL` smoke
builds; four batches run as two parallel pairs, 5.1 min wall time). Every
verdict and twin-agreement status equals the integrate run
(`diff sha256:bed79c14bd1f1ae1`); the Regression review changed twin behaviour only
where OCCT does not reach it today (AC31) and added disclosures CE2 to CE7.

| Kernel | Score | PASS | REFUSED_EXPECTED | REFUSED | ERROR | WRONG | NOT_RUN | DISPUTED |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| onshape | 0/48 | 0 | 0 | 0 | 0 | 0 | 48 | 0 |
| occt | 41/48 | 40 | 1 | 1 | 0 | **5** | 0 | 1 |
| wonky-bend | 6/48 | 6 | 0 | 39 | 3 | 0 | 0 | 0 |
| wonky-rust | 0/48 | 0 | 0 | 0 | 0 | 0 | 48 | 0 |

**WRONG (occt, 5; subtypes validity 5, topology 4, geometry 1):**

- AC20 V3 only: after the STEP round trip the quartic stays three BSpline
  edges whose tangents kink by sin 1.4e-11 to 2.9e-11 (above OCCT's declared
  angular resolution 1e-12), so E=6/V=3 vs E=4/V=0. Native V0..V3 pass. The
  kink comes from OCCT's STEP writer (at most 14 significant digits at
  ~500 mm world coordinates); the catalog has no separate angular band for
  re-imported shapes. Verdict unchanged, question to the catalog owner: CE2.
- AC22: the tangent fuse imprints the contact line (F7 E7 V4 vs F6 E4 V0),
  two bodies, volume exact; the zone accepts only unchanged cylinders or a
  named refusal.
- AC27: build123d's default clean() (UnifySameDomain) after the serial
  Common turns the valid lens into an invalid full sphere (V = 2144.66 =
  4/3·π·8³ vs 670.21, BRepCheck fails). Without clean() the lens is valid
  but one cap is split at the seam (F3 E2 V2), also WRONG/topology.
- AC36: the blend along the AC20 quartic is three BSpline patches (F8 E12 V6
  vs F6 E5 V0); volume 5243.77 lies strictly inside the closed-form bounds.
  Same root cause as AC20; AC07's approximation rule would exempt such face
  splits, AC36 scores them (CE4, verdict unchanged).
- AC44: the 2^-30 mm gap is treated as contact and imprinted, like AC22.

**Other non-points:** occt AC30 REFUSED (named fillet failure where geometry
is expected), AC35 DISPUTED (cross-comparison only, no frozen Onshape
reference; its closed-form setbacks and spring line pass). wonky-bend ERROR:
AC01 V1 and AC09 V1 ("Solid exceeds the finite ±10,000 mm coordinate
envelope") and AC46 all variants ("Profile coordinates must be finite and
within ±10,000 mm"), all unnamed FeatureScriptErrors. wonky-bend REFUSED
(capability): 39 zones, mostly `opTransform`, `fCylinder`, `opSphere`,
`opHelix` not implemented. wonky-rust: strict backend not registered.
Twin agreement: wonky-bend and occt agree in all 30 comparable zone-variants.

**Twin fixes in the integrate run (against the spec, never against a kernel output):**
`acid-blend.fs` imports `geometry.fs`; AC22 labels the post-Boolean
survivors; `acid-boolean.fs` and `acid-precision.fs` use the catalog's
`AcidVariant` / `zone` parameters (before, every wonky run of 20 zones
failed on the undefined enum and was miscounted as a capability refusal);
the curved b3d twin applies build123d's default clean() after its serial
Booleans (disclosed as CE3, see below); AC35 uses a linear radius law; the
AC30/AC31 refusals carry the category the runner reads.

**Twin fixes in the Regression review:** the AC31 b3d twin returns any body OCCT
builds for AC31, so the raw v1 scorer counted it WRONG (CE8 corrects that
contract). Previously the twin raised an unnamed RuntimeError, hiding a built
result as ERROR; the fix had no score effect because OCCT refused. The curved twin's `_boolean`
docstring no longer blames OCCT's parallel Boolean for AC27: serial and
parallel agree, clean() (UnifySameDomain) turns the valid lens into the
invalid sphere, exactly as build123d's own `intersect` does.

**Catalog records (`tmp/acid/integrate/catalog-errors.json`, marked in the
scoreboard; catalog unchanged, no verdict changed,
`tmp/acid/fix/catalog-changes.json` lists no change):**

- CE1 AC35: the b3d hint `Add(2, 4, edge)` is not the linear law the zone
  specifies; OCCT's two-radius law puts the spring line up to 0.11 mm off
  (length 8.2612 vs √68 = 8.2462).
- CE2 AC20: one angular resolution (1e-12) serves native and STEP-re-imported
  shapes; 14-digit STEP text kinks the V3 quartic above it (see the WRONG
  list). Open question for the catalog owner.
- CE3 AC19: b3dFeatures list clean() for AC20, AC21 and AC23 only, but name
  build123d's `intersect`/`fuse`/`cut` for every curved Boolean, and those
  clean by default. The twin follows build123d (a test compares every curved
  Boolean zone and variant with build123d's own operation). What changed: the
  integrate round added clean() to the twin's serial path. Evidence:
  `tmp/acid/fix/probe_clean_effect.json`; raw AC19 is F6 E7 V5 (cylinder
  patches split at the seams), clean() gives the closed form F4 E4 V2. Score
  effect: occt AC19 PASS, 41/48 instead of 40/48; no other verdict depends on
  it.
- CE4 AC36: scores face/edge/vertex counts of a necessarily fitted blend that
  AC07's approximation rule would treat as representation; its
  justification's "two orders below the bound gap" is 19.5x (gap 1.95e-3).
- CE5 AC35: the silent-wrong "off by >= 1e-3 mm" sits on the inclusive band
  edge; exactly 1e-3 mm passes, detection starts above it.
- CE6 AC07: the silent-wrong cites a tangent-plane probe that does not exist
  (a left-handed helix is caught by the V3 bbox, 0.052 mm); a biased 1e-4 mm
  fit gives 2e-4 relative volume error, not "about 1e-5".
- CE7 all zones: 2e-5 mm is 2x Onshape's linear resolution, not one order.
  No observed deviation comes near a band (worst deviation/band 9.6e-3).

**No claim:** DISPUTED is not geometry-verified: without a frozen Onshape
reference AC35 and AC36 are only checked against their strict closed-form
bounds (gaps 1.36e-2 and 1.95e-3 relative), which cannot see a 1e-3 relative
volume error; the 1e-4 agreement band applies once the reference exists. No
Onshape result exists; the FS fixes for AC22 and the blend
import are not executed past wonky's first capability refusal and are not
compile-checked in Onshape; OCCT observations are tolerance measurements, not
E9 proofs; synthetic unit tests are not kernel evidence.

**Amendment 1** (critic review, before any kernel run) is the last change to
tolerances and accepted outcomes. It fixed the V3 bounding boxes of AC10 and
AC12, extended AC12 by a vertex contact, made genus and singular points scored
topology (AC48 horn torus), made the STEP round trip re-check topology and
measurements, added closed-form setbacks to AC35, retired AC06 and added AC49
(frame-relative queries), introduced per-zone functions with a zone selector,
and bound the checker to the construction parameters. The catalog's `history`
field records the previous version and its sha256.

## Rules

- **Predeclared.** Tolerances and accepted outcomes are fixed in `zones.json`
  before any kernel result is seen. They are never widened afterwards
  (tolerance widening).
- **Twins follow the spec.** A twin is corrected only against its zone spec and
  closed forms, never to match a kernel's output (golden regeneration).
- **Denominator.** Every zone counts, including zones no kernel can build.
- **Refusal.** A refusal is worth 0 points where geometry is expected. It is
  worth 1 point only where the zone accepts that refusal category. A capability
  refusal (op not implemented: `UnsupportedFeatureError`,
  `NativeCapabilityError`) is always 0 points, even where some refusal is
  accepted. This blocks refusal farming by a backend that refuses everything.
- **Wrong is loud.** A success that is not an accepted outcome is WRONG,
  counted separately in red.
- **Number policy** (docs/rust-migration.md 3.2): plain f64 geometry, exact
  predicates or a named refusal, never silent-wrong. E4: tangency, contact and
  gaps are decided from the construction. E9: the proof basis is the binary64
  values the FeatureScript interpreter produces.
- **Stable ids.** Zone ids are never reused. A retired zone stays listed in
  `retiredZones` with its reason.

## The knackpunkt: the test defines what is right

Some zones only have an answer because the test declares it. Every zone lists
accepted outcomes per kernel class (`expected.outcomes`, `kernelClass` =
`exact`, `tolerance` or `any`) and the outcomes that are silent-wrong
(`expected.silentWrong`).

- **exact** is wonky-rust. It has no resolution. A gap of 2^-30 mm (AC39,
  AC44), an overlap of 2^-30 mm (AC41) or a gap of 1.7e-15 mm produced by
  decimal arithmetic (AC42) is real geometry. Merging a gap or dropping a sliver
  is silent-wrong. A decision it cannot prove from the construction must be a
  named refusal.
- **tolerance** is Onshape (Parasolid, linear resolution 1e-5 mm), OCCT
  (Precision::Confusion 1e-7 mm) and wonky-bend (Bend kernel with guard bands
  and host regularisations). These kernels may legitimately merge a 1e-9 mm gap
  or drop a sub-resolution sliver, but only where the zone lists that branch.
  They must also take the same branch in all four variants.

**E9 in practice.** Lengths are written `L * millimeter`. The kernel receives
fl(fl(L) * fl(0.001)) in metres, and the catalog stores these payloads exactly:

- **AC42:** `(0.1 + 8.2) * millimeter` vs `8.3 * millimeter`. Decimal intent
  says the faces touch. The interpreter's values leave a gap of
  1.7347e-15 mm (exact rational in `construction.e9`). Exact class: two bodies.
- **AC43:** `(1.68 + 10.1) * millimeter` equals `11.78 * millimeter` bit for bit
  (the docs/rust-migration.md example), so contact is proven. Re-evaluating the
  unrounded literals would invent a gap and is silent-wrong.
- **AC39:** the effective gap of `(8 + 2^-30) * millimeter` vs `8 * millimeter`
  is 9.3132273e-10 mm, not 2^-30 mm. The metre conversion rounds, and the closed
  form uses the E9 value.

**Provenance.** Under V1 (65 m translation) and V3 (skew rotation), world
coordinates are rounded. A 1.7e-15 mm gap does not survive rounding at 65 m
(the f64 spacing there is 1.4e-11 mm). So an exact kernel must decide contact
in the construction frame: a shared sketch plane, or one shared `opTransform`
applied to all operands before the operation under test. Deciding on rounded
world coordinates merges the AC42 gap under V1, which is WRONG/metamorphic.

The same holds for measuring. Measurements whose value is an E9 symbol (the
gaps of AC39, AC40, AC42, AC44, the AC41 thickness, the AC46 slot) are compared
for the exact class at their stated exact band in every variant. An exact
kernel has to report them from the construction frame
(`zones.json` `measurements.e9Values`).

**Queries follow the frame.** Planes and directions used by query predicates
(`qCoincidesWithPlane`, `qParallelEdges`) are built from the zone frame, never
from world planes or axes. AC49 routes its verdict through such queries: a
world-frame or axis-only predicate changes its geometry under V1 to V3.

## Kernels and classes

| Kernel | Class | Source of its result |
|---|---|---|
| onshape | tolerance | FeatureScript twin, frozen in `fixtures/cad-acid/onshape/` and measured by `scripts/acid/frozen-onshape.py` |
| occt | tolerance | Frozen `fixtures/cad-acid/occt/observations.json`; optional local `uv run` builds are separate unscored live-reference diagnostics |
| wonky-bend | historical tolerance | Retired; historical observations only, no new runs |
| wonky-rust | exact | Strict Rust FeatureScript frontend; AC01 geometry and AC45 expected open-profile refusal are the two points at this slice. Other capabilities remain open. |

## Variants and grid

Every zone is authored in local coordinates. The zone frame is
F(p) = cellOrigin + Vk(p). Vk is applied to the construction inputs (the sketch
plane, or one shared `opTransform` before the op under test), never to the
finished result.

| Variant | Transform |
|---|---|
| V0 | identity |
| V1 | translation by (65536.25, -32768.5, 16384.125) mm |
| V2 | 90 deg about Z, then 90 deg about X: (x,y,z) -> (-y,-z,x). Authored with exact axis vectors, not sin/cos |
| V3 | 0.1 rad about the axis (1,2,3) through (3,-2,5) mm. The interpreter's inexact f64 frame is the payload |

A zone passes only if every variant passes and its invariants hold
(`metamorphic.invariants`, with zone-specific `exceptions`).

**Grid.** The cell pitch is 250 mm (2^-2 m, exact in SI). The cell origin is
(250 * column, 250 * row, 0), where row is the group index and column is the
index within the group. AC46 has large local coordinates (x = 131072 mm) and its
own row 6. Local extents stay within 90 mm of the local origin, so cells never
interact.

`closedForm.bbox.variants` are given in zone-frame coordinates without the cell
origin. Each result body is named after its zone id.

## Authoring: one function per zone

The authoring grain is the zone, not the group (`zones.json` `authoring`):

- Each group has one Feature Studio `fixtures/cad-acid/fs/acid-<group>.fs`. It
  defines one function per zone, `acidAC10(context is Context, id is Id,
  cs is CoordSystem)`, plus the variant frames and shared helpers.
- The group's custom feature `acid<Group>` has two parameters: `variant`
  (V0 to V3) and `zone` (`ALL` or one zone id of the group, listed in
  `groups[].featureScript.parameters.zone.values`). It calls the selected zone
  function, or every zone function in catalog order for `ALL`.
- The build123d module mirrors this: `def ac10(frame)` per zone and
  `build(variant, zone="ALL")`.
- Zones of one group can be written independently. They share a file, so they
  land one after another; conflicts stay in the dispatcher list.

**Isolation.** Every zone and variant is scored from a run that builds only
that zone (`zone = <id>`). A refusal or a crash in one zone therefore cannot
change another zone's verdict. `zone = ALL` is the one frozen model; it is built
once per group and variant as a smoke run.

## Scoring

| Verdict | Points | Meaning |
|---|---|---|
| PASS | 1 | Every variant yields the same accepted geometry outcome. Scored metrics, canonical topology, measurements, validity and the STEP round trip are all within the zone tolerance |
| REFUSED_EXPECTED | 1 | Every variant yields a named refusal of an accepted category, raised by the operation under test |
| REFUSED | 0 | A named refusal where geometry is expected, or any capability refusal |
| ERROR | 0 | Crash, panic, timeout or an unnamed error |
| WRONG | 0, red count | A success that is not an accepted outcome. Subtypes: geometry (metrics out of tolerance), validity (invalid B-rep or a failed STEP round trip), topology (canonical count mismatch), metamorphic (accepted outcomes that differ between variants) |
| NOT_RUN | 0, listed | Kernel unavailable or zone not executed. It stays in the denominator |
| UNVERIFIED | 0 | Exact observation or artifact binding missing/invalid |
| DISPUTED | 0 | Declared erratum or unavailable cross-comparison reference; never PASS or WRONG |

- **Precedence across the four variants:** a declared erratum overrides the cell;
  otherwise WRONG > UNVERIFIED > ERROR > REFUSED > NOT_RUN > DISPUTED >
  REFUSED_EXPECTED / PASS. A mix of PASS and REFUSED_EXPECTED is
  WRONG/metamorphic.
- **Cross-comparison zones (AC35, AC36):** the reference for volume and area
  is the frozen Onshape value, accepted only if OCCT agrees within
  `volumeRel.agreement`. Otherwise the zone is DISPUTED and no kernel earns its
  point. The closed-form bounds and the closed-form measurements are always
  enforced. AC35's setbacks and spring line are closed forms: both blend
  conventions (rolling ball and circular sections) touch the faces along the
  lines y = 12 - r(z) and x = 16 - r(z), so a radius-law error of 1e-3 mm is
  visible to every kernel class.
- **Tolerance profiles** (predeclared, justified per zone in
  `tolerance.justification`):
  - *standard*: exact 1e-9 relative (the enclosure width from
    docs/rust-migration.md 3.2); tolerance 1e-6 relative, 1e-4 mm bbox,
    2e-5 mm distance.
  - *approximation* (helix sweep AC07): exact 1e-7, tolerance 1e-4; topology
    scores bodies, shells and genus only.
  - *crossComparison*: 1e-4.
  - Gap, sliver and setback measurements carry their own bands.

## Topology convention and validity

**Canonical counts.** Seam and degenerate edges are dropped. A vertex whose
only incident edge is one closed edge is dropped, and the edge is counted as a
ring edge. Two edges that meet at a 2-valent vertex, bound the same pair of
faces and have parallel tangents are one edge. Faces are never merged by the
normaliser. Raw counts are recorded but not scored.

**Singular points.** Points where a surface degenerates (a cone apex, a
horn-torus pinch, a profile point on the revolve axis) are `singularPoints`,
never vertices. A toroidal face whose major radius equals its minor radius
(bit-equal for the exact class, within the linear resolution for the tolerance
class) contributes one singular point at its centre, which is also a
`pinchPoint`: the solid is locally two cones touching at a point.

**Scored fields.** `topology.scored` lists them per zone. By default these are
bodies, shells, faces, edges, vertices, genus and singularPoints, plus
pinchPoints where declared; the approximation profile scores bodies, shells and
genus. So a ring torus in AC48 (genus 1, no pinch) is WRONG/topology even when
its hole is below every metric band. AC48 also measures the distance between
the revolve axis and the result (`axis_contact`, 0).

**Invariant.** Every declared topology satisfies
V + ringEdges - E + (2F - loops - 2 closedToroidalFaces) + 2 pinchPoints =
2 shells - 2 genus. Genus is the first Betti number of the solid, summed over
bodies.

**Validity.** Every result body of a geometry outcome must pass the kernel's own
check. A success with an invalid body is WRONG/validity, even if the metrics
match.

**STEP round trip.** The result is exported to STEP (one file per zone run) and
re-imported with OCCT, as in `scripts/validate-step.py`. The re-imported shape
is scored with the zone's own contract under tolerance-class bands, because
OCCT measures it:

- valid (BRepCheck) and the same body count;
- the zone's scored canonical topology;
- volume within the tolerance-class `volumeRel` of the kernel's own volume;
- every closed-form measurement, re-measured on the re-imported shape.

A lost feature is a round-trip failure even when the volume cannot see it. For
example, a STEP export that drops the AC47 micro hole changes the volume by only
1.2e-8 relative, but the genus, the face count and `probe_hole` all catch it.

One exception is predeclared (`validity.roundTripExceptions`): an AC41 sliver
thinner than 1e-7 mm is below OCCT's Precision::Confusion, so OCCT cannot
represent its short edges. There the STEP file is parsed without healing. It
must contain exactly one closed shell with 8 distinct points whose extent along
the local x axis lies in (0, 2e-5] mm.

## Zone table

| Zone | Group | Title | Oracle | Accepted outcomes |
|---|---|---|---|---|
| AC01 | profile | Concave L-profile extrude | closed | any: 1 bod. |
| AC02 | profile | Square with a circular inner loop | closed | any: 1 bod. |
| AC03 | profile | Obround: tangent line-arc chain | closed | any: 1 bod. |
| AC04 | profile | Quarter revolve of an offset rectangle | closed | any: 1 bod. |
| AC05 | profile | Ruled loft square to smaller square | closed | any: 1 bod. |
| AC07 | profile | Circular section swept along a two-turn helix | closed (approx. profile) | any: 1 bod. |
| AC08 | profile | Circular pattern of four cylinders | closed | any: 4 bod. |
| AC09 | profile | Mirror of an asymmetric wedge | closed | any: 2 bod. |
| AC10 | boolean | Overlapping boxes: corner union | closed | any: 1 bod. |
| AC11 | boolean | Full-face touch union | closed | any: 1 bod. |
| AC12 | boolean | Edge-only and vertex-only contact union (three boxes) | closed | any: 3 bod.; any: refusal non-manifold-result |
| AC13 | boolean | Face-touch intersection is empty | closed | any: 0 bod.; any: refusal empty-result |
| AC14 | boolean | Flush-sided subtraction (U channel) | closed | any: 1 bod. |
| AC15 | boolean | Coincident solids: difference is empty | closed | any: 0 bod.; any: refusal empty-result |
| AC16 | boolean | Coincident solids: union is idempotent | closed | any: 1 bod. |
| AC17 | boolean | Closed internal cavity | closed | any: 1 bod. |
| AC18 | boolean | Plate minus four cylinders (genus 4) | closed | any: 1 bod. |
| AC49 | boolean | Frame-relative face and edge queries after a Boolean | closed | any: 1 bod. |
| AC19 | curved | Steinmetz bicylinder | closed | any: 1 bod. |
| AC20 | curved | T-junction of unequal cylinders | closed (elliptic integrals) | any: 1 bod. |
| AC21 | curved | Coaxial cylinders joined at a shared cap | closed | any: 1 bod. |
| AC22 | curved | Externally tangent cylinders (line contact) | closed | any: 2 bod.; any: refusal non-manifold-result |
| AC23 | curved | Tangent cylindrical cutter is a no-op | closed | any: 1 bod. |
| AC24 | curved | Hemisphere by sphere and half-space | closed | any: 1 bod. |
| AC25 | curved | Cone with its apex on the axis | closed | any: 1 bod. |
| AC26 | curved | Ring torus by revolving an off-axis circle | closed | any: 1 bod. |
| AC27 | curved | Sphere-sphere lens | closed | any: 1 bod. |
| AC28 | curved | Napkin ring: sphere minus coaxial cylinder | closed | any: 1 bod. |
| AC29 | blend | Single vertical edge fillet | closed | any: 1 bod. |
| AC30 | blend | Critical paired fillets consume a face | closed | any: 1 bod. |
| AC31 | blend | Overflow fillet (v1 title incorrectly says infeasible) | CE8 | DISPUTED for all kernels |
| AC32 | blend | Fillet along a tangent chain | closed | any: 1 bod. |
| AC33 | blend | Chamfer of a circular rim | closed | any: 1 bod. |
| AC34 | blend | Trihedral corner: three equal fillets | closed | any: 1 bod. |
| AC35 | blend | Variable-radius edge fillet (cross-comparison) | cross-comparison + bounds; closed-form setbacks | any: 1 bod. |
| AC36 | blend | Fillet on a quartic Boolean edge (cross-comparison) | cross-comparison + bounds | any: 1 bod. |
| AC37 | blend | Open-top shell | closed | any: 1 bod. |
| AC38 | blend | Draft one planar face | closed | any: 1 bod. |
| AC39 | precision | Sub-resolution face gap (2^-30 mm) | closed (E9) | exact: 2 bod.; tolerance: 2 bod.; tolerance: 1 bod. |
| AC40 | precision | Resolved face gap control (2^-10 mm) | closed (E9) | any: 2 bod. |
| AC41 | precision | Sub-resolution overlap sliver (intersection) | closed (E9) | exact: 1 bod.; tolerance: 1 bod. (thickness bound); tolerance: 0 bod.; tolerance: refusal empty-result |
| AC42 | precision | E9: decimal sum leaves a real gap | closed (E9) | exact: 2 bod.; tolerance: 1 bod.; tolerance: 2 bod. |
| AC43 | precision | E9: rounded sum equals the shared boundary | closed (E9) | any: 1 bod. |
| AC44 | precision | Sub-resolution gap between cylinders | closed (E9) | exact: 2 bod.; tolerance: 2 bod.; tolerance: refusal non-manifold-result |
| AC45 | precision | Sub-resolution open sketch profile | none for exact; box for tolerance | exact: refusal open-profile; tolerance: 1 bod.; tolerance: refusal open-profile |
| AC46 | precision | Large coordinates: thin resolved slot at 131 m | closed (E9) | any: 1 bod. |
| AC47 | precision | Micro hole in a large plate | closed | any: 1 bod. |
| AC48 | precision | Horn torus: exact axis tangency | closed; genus and pinch scored | any: 1 bod.; any: refusal singular-geometry |

Retired: AC06 (circular section swept along a quarter arc). Its geometry is a
torus patch that the revolve zones AC04 and AC26 already cover exactly, and
opSweep stays covered by AC07. The slot went to AC49.

Groups (one Feature Studio and one build123d module each; custom feature
`acid<Group>` with the parameters `variant` and `zone`):

| Group | Zones | Theme |
|---|---|---|
| profile | AC01-AC05, AC07-AC09 | sketch loops, extrude, revolve, loft, helix sweep, pattern, mirror |
| boolean | AC10-AC18, AC49 | planar Booleans, edge and vertex contact, coincidence degeneracies, cavity, multi-tool, frame-relative queries |
| curved | AC19-AC28 | cylinder, sphere, cone and torus surfaces, curved Booleans, tangency |
| blend | AC29-AC38 | fillet, chamfer, vertex blend, variable blend, blend on a quartic edge, shell, draft |
| precision | AC39-AC48 | E4/E9: sub-resolution gaps and slivers, decimal arithmetic, large and small scale, singular revolve |

Oracles:
- closed forms: 44 zones;
- cross-comparison with closed-form bounds: 2 zones (AC35 variable fillet,
  which also has closed-form setbacks; AC36 blend on the quartic T-junction
  edge);
- current refusal-only exact zone: AC45. V1 also listed AC31; CE8 establishes
  feasible edge overflow and suspends that erroneous requirement.

## Closed-form checker

```sh
uv run scripts/acid/closed-forms.py                 # all zones, exit 1 on any failure
uv run scripts/acid/closed-forms.py --only AC20 --verbose
```

For every zone, the checker recomputes the closed forms from
`construction.params` by a route other than the catalog's hand-written
expression:

- **Prisms and revolves:** Green's theorem over line and arc profiles, in sympy
  exact arithmetic.
- **Axis-aligned box Booleans:** coordinate compression with Fractions, exact.
  The same cells give the body count (cells joined through shared faces) and
  the body distances.
- **Other curved zones:** mpmath quadrature at 50 digits (Steinmetz, T-junction,
  tangent-chain and trihedral fillet cross-sections, helix length).
- **Precision zones:** the box Boolean on the binary64 SI payload.
- **Probe distances:** 2D distance to the profile, exact box distances, or
  Dykstra projection onto convex pieces.
- **Edge lengths (AC35):** the straight edges of the spring-line model.

**Binding to the construction.** A changed parameter must change a recomputed
value or fail:

- every top-level key of `construction.params` is consumed by a route or
  matched by an explicit literal guard; an unbound key fails;
- probe points, body points, edge points and axes are read from the measurement
  definitions, never re-typed in the checker;
- the premises a route relies on are checked from the parameters (tangency in
  AC22 and AC23, the critical radii of AC30, clearances in AC49, through holes,
  disjoint instances, axis tangency in AC48).

**Bounding boxes, two routes.** Route A takes support functions of the result's
boundary pieces (points, arcs, sphere zones, tori, helix tube). Route B builds
the result as primitives from the parameters, with the same description the
volume route integrates: exact cells of box Booleans, prisms and revolves of the
profile loops, vertex sets of polyhedra. Both must match the stored local box and
all four variant boxes. Four zones have no route B (AC07 helix tube, AC19
Steinmetz solid, AC32 chain fillet, AC34 vertex blend); their V3 box is reported
as single-route, and the independent part is containment in the rotated local
box.

It also checks:

- every expression string against its stored value;
- every E9 relation with IEEE floats, and every E9 symbol exactly;
- the Euler-Poincare invariant (with pinch points) of every declared topology;
- that every topology scores the required fields (genus and singular points
  included);
- catalog structure: 36-48 zones, 8-12 per group, unique ids, retired ids never
  reused, zone selector values, unique cells, the variant definitions, the
  measurement kinds and the scoring table.

Current result: 1561 checks, 0 failed, 4 single-route V3 checks. Evidence that
the checker is not vacuous: 17 planted mutants on temporary copies were all
caught (exit 1):

- the critic's AC29 mutant (radius 4 to 3, expectations kept);
- AC35 end radius 4 to 3.99, and a consistent but wrong setback;
- AC48 ring torus with R = 4 + 1e-10, and pinchPoints or genus unscored;
- AC10 V3 box reverted to the old enclosing-box value;
- AC12 declared body count 3 to 2, and a V3 coordinate +1e-6 mm;
- AC01 a new unbound parameter, and a moved probe point with its value kept;
- AC49 chamfer 1 to 2, selection of local y edges, and a probe value as if the
  short edges were chamfered;
- AC07 a single-route V3 coordinate +1e-6 mm;
- AC39 an E9 symbol;
- AC20 an internally consistent but wrong elliptic area.

The critic's independent oracle (`tmp/acid/critic_math_independent.py`, run on
a scratch copy that only skips the zones this amendment changed) agrees on 1026
variant bbox coordinates and on all scalar metrics except the known 8.3e-17 mm
decimal-vs-SI residual of the AC43 probe, which is inside its band.

What the checker does not prove:

- Face, edge and vertex counts are hand-derived. Only the Euler-Poincare
  invariant checks them. Body counts of box zones are recomputed.
- The four single-route V3 boxes above.
- Kernel notes are expectations, not observations.
- FeatureScript and build123d parameter names in `fsFeatures`/`b3dFeatures` still
  have to be verified by the twin authors against the std version they pin.

## How to run

1. `uv run scripts/acid/closed-forms.py` must pass (the runner also runs it
   first and stops on failure).
2. `NODE_OPTIONS=--max-old-space-size=8192 node scripts/acid/run.mjs
   [--out <dir>] --kernels wonky-rust [--zones AC01,...]
   [--variants V0,...]` constructs selected zones and variants sequentially,
   plus one `ALL` smoke build per group/variant unless `--no-smoke`. Strict
   Rust construction, observation and scoring use one process and one checked
   live addon, via `build-wonky.mjs`; the FS interpreter has a step budget.
   OCCT observers and an explicitly requested OCCT twin run in bounded child
   processes through `uv run`. `--timeout` bounds those child processes, not
   synchronous native Rust calls. Every successfully exported wonky zone is
   independently observed from STEP and checked by `validate-step.py`.
3. `node scripts/acid/score.mjs <results.json> <out-dir>
   [--reverify] [--catalog-errors <file>] [--revision "<stamp>"]
   [--artifact-root <tree>] [--json-only]` writes `scoreboard.json` and
   `scoreboard.md`. Without `--reverify`, all saved wonky rows are UNVERIFIED
   (zero points), even when their files are perfectly self-consistent. Replay
   builds into `<out-dir>/reverify`, leaving the claimed artifacts separate.
   Split a longer run by `--zones`, merge using
   `node scripts/acid/merge-results.mjs <out-dir> <batch-dir>...`, then score
   the merged file with `--reverify`. Identical repeated frozen references
   are deduplicated. Local batch code/addon identities must match.

Cargo builds/tests must use `node local-development-evidence
<absolute-worktree> [--fetch <relpath>] -- <cmd>` (never benchmarks there).
Python observers/checkers use `uv run`; no live Onshape calls are needed.

## How the maintainer freezes the Onshape references

Freezing makes live Onshape calls through the session bridge. It is done only
by the maintainer. Done once on 2026-09-26 (above); a new freeze needs a new
document or an explicit decision to replace this one.

`node scripts/acid/onshape-push.mjs --dry-run` prints the call plan. Live:
`--live --meter-start <ISO date> [--variants V0,...] [--resume]`. A run stops
between variants with a saved `state.json`; `--resume` continues only when no
write is pending and every started variant is complete.

0. **Pre-flight (one evaluation).** AC35 uses `opFillet` with `isVariable`,
   whose std parameters are sparsely documented. Upload a scratch Feature
   Studio with only the AC35 zone function and evaluate it in V0. If Onshape
   rejects the call shape, correct the twin's call to the working std signature
   before any group is frozen. The zone spec is semantic (linear radius law
   2 mm at z=0 to 4 mm at z=8) and does not change. AC36 uses a constant-radius
   fillet and needs no pre-flight. (2026-09-26: accepted unchanged.)
1. **Upload.** For each group, upload `fixtures/cad-acid/fs/acid-<g>.fs` as one
   Feature Studio (pattern: `~/Workspace/cad/cad-project-041/single-step-r20/tools/onshape_sync.py`,
   read only). An empty featureSpecs answer is a compile failure and stops the
   push. Record the sha256 and `sourceMicroversion`.
2. **Part Studios.** One Part Studio per variant. It holds one `zone = ALL`
   feature per group. If a group's ALL feature ends in ERROR (Onshape rolls it
   back), one feature per zone of that group follows in the same Part Studio.
   Any status other than OK or ERROR stops the push. The STEP translation pot
   is small (`x-rate-limit-remaining`), so there is one export per variant,
   not one per group.
3. **Measure.** Per variant Part Studio, at its immutable microversion:
   - parts, grouped mass properties (value/min/max; no centroid without a
     material), body details and bounding boxes;
   - one STEP export. Translations have no `/m/` route, so the workspace is
     exported and the microversion is checked before and after;
   - for failed features only, one FS evaluation per variant with
     `getFeatureError` and the number of bodies the feature left.

   `scripts/acid/frozen-onshape.py` attributes STEP solids to zones by the
   solid name Onshape writes (`MANIFOLD_SOLID_BREP('<part name>')`). It
   measures them with the OCCT observer, and admits each volume only inside
   Onshape's own mass bounds. A failed zone feature is an ERROR row that
   carries the Onshape error enum.

   Budget of the 2026-09-26 freeze: 0 features GET, 5 FS evaluations (one
   failed on a request-shape bug), 4 Part Studios, 100 feature writes,
   4 STEP exports, plus one pre-flight scratch document (deleted).
4. **Freeze.** Store the results under `fixtures/cad-acid/onshape/` with a
   `provenance.json` in the `fixtures/r20-modules` pattern: document,
   workspace, element and microversion ids, uploaded sha256 of each studio,
   variant, zone and status per feature state, the call log, and a SHA256SUMS
   file over every frozen file. Tests read only these frozen files, never a live project.
5. **Reference use.** A mismatch between the frozen Onshape result and a closed
   form is reported as an Onshape verdict (WRONG or REFUSED). It is never
   written back into `zones.json`.

## Sources

- Candidate drafts: `tmp/acid/design/draft-coverage.json` (42 candidates),
  `draft-failures.json` (40), `draft-robustness.json` (40).
  - Selected and merged: sketch topology, regular and degenerate Booleans,
    curved tangency, blends, E9 arithmetic, sub-resolution and scale cases.
  - Dropped, and why:
    - text glyphs: font dependency;
    - fit splines: parametrisation differs between kernels;
    - bow-tie and touching inner loops: Onshape sketch-region semantics, not
      kernel geometry;
    - duplicate contact variants;
    - near-horn and spindle tori: no stable accepted-outcome contract yet.
- Critic review (amendment 1): decisions per finding in
  `tmp/acid/design/amendments.json` (scratch in the ac1 worktree).
  - Deferred, and why:
    - a bore tangent to an exterior face (draft-failures C04): the result is a
      non-manifold self-contact whose accepted-outcome contract is not settled,
      and the proposed construction was inconsistent;
    - three-body non-manifold contact, `opSplit`, non-BLIND extrude end
      conditions: none of them occurs in the R20 studios; AC12 now covers edge
      and vertex contact with three operands in one Boolean.
- `docs/rust-migration.md` 3.2 (E4, E9) and "Entscheidungen Marc" (26.09.2026).
