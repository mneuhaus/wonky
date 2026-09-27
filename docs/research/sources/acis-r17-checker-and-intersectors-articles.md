# ACIS R17 User Guide: "ACIS Checker" and "Intersectors" technical articles (Spatial Corp.)

- Kind: two vendor user-guide articles (online HTML documentation, R17).
- Canonical URLs (both HTTP 200 with `curl -A "Mozilla/5.0"` on 2026-09-22):
  - Checker: http://www.q-solid.com/ACIS_Docs_R17/online/SPAacisuserTechArticles/SPAacisuser_mointrchkr.htm (398 KB HTML, most of it the ID-macro tables)
  - Intersectors: http://www.q-solid.com/ACIS_Docs_R17/online/SPAacisuserTechArticles/SPAacisuser_mointrintr.htm (short)
- Local copies: `tmp/research/acis-r17/SPAacisuser_mointrchkr.{htm,txt}` and `SPAacisuser_mointrintr.{htm,txt}`. Both were read in full; the Checker's macro table was skimmed by section.
- Organization: Spatial Corp., "a Dassault Systèmes company", "© 1989-2007". DOCUMENTED (page footers).
- License: proprietary documentation of a closed commercial kernel. Porting implication: no code. Check categories, level and cost ideas, and the fault-ID concept are generic and free to reimplement under wonky names. Do not copy the macro tables verbatim. INFERRED.
- Status: R17 is about 2007. ACIS is still a Spatial product. The versioning text covers R14-R17. DOCUMENTED (article text).

## What it is

- **Checker**: the user-level contract of `api_check_entity`:
  - purpose and workflow;
  - result objects (`insanity_list`, `insanity_data`);
  - four severities;
  - cost-ordered check levels 10-70;
  - options;
  - versioned checks;
  - auxiliary check APIs;
  - `api_fix_check_problems`;
  - a large table of ID macros grouped by entity type and level.
- **Intersectors**: a one-page description of the CCI, CSI, SSI and CCS intersector families and their special-case capabilities, with a warning not to call them directly.

## How it works

### Checker philosophy. DOCUMENTED (Checker URL).
- "ACIS data should be checked on read-in and repaired before modeling commences."
- Applications are "advised against including the ACIS checking functionality as part of their modeling workflow, because ACIS operations are expected to produce a valid result if applied to a valid model".
- An entity is **defective** "if ERROR-status problems are detected when the entity is processed by api_check_entity at its highest level". Then "the operation may fail, or produce an incorrect result".
- "api_check_entity is expected not to fail (return an unsuccessful outcome), regardless of errors in the input data." Its algorithms do not treat the input the way modeling operations do.
- "If an operation fails on a part which the Checker reveals to have ERROR-severity problems, Spatial does not normally view the failure of the operation to be a bug." The checker defines the support contract.

### Results. DOCUMENTED.
- `insanity_list` holds problems. Each carries a severity, a problem ID and the offending (sub-)entity, which is "typically not the input entity".
- Applications should use integer IDs via the macros in `insanity.err`, "not ... the message strings, particularly for determining workflow".
- `convert_insanity_list_into_error_info_list` bridges results to error handling.

### Severities. DOCUMENTED.
ERROR, WARNING, NOTE, INFO.
- ERROR means issues "the algorithms in ACIS are not designed to handle".
- Warnings include non-G1 geometry. ACIS "prefers ... G2 ... but allows G1 continuity at the knots".
- `show_warning_msg` can suppress warnings to save time.

### Levels. DOCUMENTED.
- `check_level` takes multiples of 10 from 10 to 70; the default is 20.
- "The allocation of checks to particular levels is governed by the computational expense of performing the check, rather than the severity."
- The believed importance of levels 20-30 is "incorrect".
- Exception: curve and surface self-intersection checks run at level 30 despite being "very computationally expensive", "because self-intersecting geometry is commonly encountered".

### Options. DOCUMENTED.
- `checker_limit`, `check_abort`.
- `check_ff_int`: face-face checks, otherwise only at level 70.
- `check_discont`, `check_edge_on_face`.
- `check_surface_irregular_and_selfint`: skip the self-intersection test if the surface is already irregular.
- `d3_checks`, `check_ee_int_always`.
- `r14_checks`: default false in R14/R15, true in R16, "In R17 and beyond ... the checks are always enforced". "the new checks are not 'optional'; parts for which problems are reported when r14_checks is enabled are defective."

### Versioned checking. DOCUMENTED.
- Checks are versioned since R14, and only for legacy rebuilds (feature-history replay).
- "A part for which checking discovers no errors at a particular version is not 'valid' for that version. If check errors are reported when the part is checked as the current version, then the part is defective."

### Other interfaces. DOCUMENTED.
- `api_check_face` / `api_check_edge` are geometric-only ("somewhat misnamed").
- `api_check_entity_ff_ints` runs the level-70 face-face checks.
- `surface::check()` / `curve::check()` at the direct interface.
- `api_fix_check_problems` is "not intended to provide general healing". It will "tidy up" minor flaws and "does not guarantee to correct any particular problem".

### Check table highlights (ID macros). DOCUMENTED.
- **Pointers** (10+): "If a basic pointer check fails, then treat it as a fatal topology error". It is "impossible to detect every invalid access without severely compromising the performance".
- **BODY / SHELL / ATTRIB**: containment at 50+ (`BODY_WARN_CONT_CHK`, "maybe a void"); `SHL_DISCONNECTED`; corrupt attribute chains.
- **TRANSFORM**: `TRANSF_*` (non-unit, large translation, bad determinant).
- **FACE**:
  - domain and box checks;
  - `NULL_EDGE_AT_APEX`;
  - `EDGE_OFF_FACE` / `TEDGE_OFF_FACE`;
  - `FACE_NEGA_AREA` / `FACE_ZERO_AREA` (20+).
- **SURFACE**:
  - analytic form checks at 10+ (unit normals, radii, cone ratios, torus radii);
  - G1 at 20+;
  - irregular, self-intersection, closure, singularity and `SURF_BAD_FITOL` at 30+;
  - rolling-ball and vertex-blend checks.
- **PCURVE**: range, direction, location (10+); TCOEDGE consistency (30+); `TCOED_STRAY` (50+).
- **EDGE**:
  - vertex on curve (10+);
  - `TEDGE_HAS_LOCAL_SELF_INT`, `COED_OUT_OF_ORDER` (20+);
  - convexity at 60+: `CONVEX_POINT` "Edge has convexity points" (Error), `CVXTY_ON_EDGE_MARKED_TANGENT`, `CVXTY_PTS_ON_TANGENT_EDGE`.
- **CURVE**: form checks (for example `ELL_RATIO_GT_1`); G1; self-intersection; `EXTREME_PAR` / `CRV_ZERO_DERIV` at 70.
- **VERTEX**:
  - `DUP_VTX` (Error);
  - `OVERLAP_TVERT` (Error);
  - `OVERLAP_VERT` (Warning);
  - `PART_OVERLAP_TVERT`;
  - CW/CCW coedge closure around the vertex ("Fatal topology error").
- **Solid checks (70)**:
  - `FF_INT_FACE_INT` "Improper face intersection", Error: "Two faces were found to intersect but the topology in the model did not reflect all of the intersections. This is a self-intersecting body. Modeling operations, such as Booleans, will either fail or produce bad results."
  - `FF_INT_FACE_COIN` "Coincident face intersection", Error: "Two distinct faces were found to coincide."
  - `FF_INT_FAIL` "intersection failed" (Warning). The checker's own face-face intersection failed, and it reports this rather than passing.
  - `FF_INT_EDGE_INT` (with `check_ee_int_always`).
  - `FF_INT_SHL_INT` / `FF_INT_LMP_INT` (Warning); `FF_INT_SHL_CONT` / `FF_INT_LMP_CONT` "Improper ... containment" (Error).
- **Cellular topology**: `CT_*` checks.
- **Slivers (30+)**:
  - `SLIVER_FACE_DETECTED`;
  - `SLIVER_FACE_REMOVED` "Sliver face detected and replaced with tedge";
  - `NO_SLIVER_FACE_TEST` "Test for sliver faces was not performed". A *skipped* test is itself reported.
- **Checker self-failure**: e.g. `ACIS_ERROR` "outcome checks bad", "Failed to complete face sense check of a non-degenerate torus".
- Legacy misspellings are kept for ID stability: `TRANSF_BAD_DETERMINENT`, `SURF_SEFL_INT`, `BS3C_CLOSED_MRKD_PEROID`.

### Intersectors. DOCUMENTED (Intersectors URL).
- ACIS represents cones, cylinders, planes, spheres and tori explicitly, and sculptured faces as NURBS.
- **CCI** finds "points or intervals where two curves meet or approach one another within a specified tolerance".
- **CSI** handles implicit curve/surface pairs and parametric curves against singular surfaces (boundary degenerate to a point).
- **SSI**:
  - parametric surfaces including singular ones;
  - silhouette curves for any surface;
  - "help points in the exploration stage, which enable the intersection of implicit surfaces";
  - offset-surface intersections between given start and end points, used for blend spine curves.
- **CCS**: curve/curve intersection on a surface, given the surface and both pcurves. If "each pcurve is an accurate representation", it "can possibly improve the efficiency".
- Intersectors "can be thought of as virtual methods of Booleans". Direct use gives "Unpredictable results".

## Robustness and guarantees

- DOCUMENTED: the contract is "valid in, valid out". There is no guarantee on defective input, and "not a bug" if input has ERROR problems.
- DOCUMENTED: the checker must never fail, but it can report its own inability (`ACIS_ERROR` outcome checks, `NO_SLIVER_FACE_TEST`) and skipped work.
- DOCUMENTED: the checker improves over time. Hence versioning, and a warning that an old-version pass does not imply validity.
- DOCUMENTED: pointer checks are best-effort for performance reasons.

## Parallelism and performance

- DOCUMENTED:
  - Levels are ordered by cost.
  - `show_warning_msg`, `checker_limit`, `check_abort` and `check_surface_irregular_and_selfint` are cost controls.
  - Face-face checks are the most expensive tier (70).
- No threading is mentioned. INFERRED.
- DOCUMENTED: CCS exists purely for performance, reusing pcurves the caller already has.

## Known failures, limitations, war stories

- DOCUMENTED:
  - A community misconception that levels 20-30 are "the important checks".
  - Self-intersection moved down to level 30 because it is so common in practice.
  - `r14_checks` went from opt-in (R14/R15), to default-on (R16), to mandatory (R17). A migration war story: newly detected defects broke existing customer parts.
  - Misspelled macro IDs are frozen for compatibility.
  - `api_check_face` and `api_check_edge` are misnamed.
- DOCUMENTED: the explicit statement that failures on ERROR-defective parts are not bugs shows the support burden that invalid imported data creates.

## Relevance for wonky

1. **Cost-ordered check tiers with explicit toggles.**
   - Wonky runs the same validator on CPU and GPU with fork-join.
   - Tiering by cost (topology pointers → analytic forms → pcurve/edge-on-face → face-face at the top tier) lets tests run full checks while production runs cheap tiers.
   - Self-intersection gets the same "common, so check early" exception. INFERRED.
2. **Stable integer fault IDs, never strings.**
   - Combine with the PK fault record (see `parasolid-pk-reference-pk-body-check-states-and-fault-types.md`): stable ID, severity, entity, optional second entity, witness point.
   - Freeze IDs even when misnamed. INFERRED.
3. **Checker never fails; reports skipped and undecided work.** `NO_SLIVER_FACE_TEST` and the `ACIS_ERROR` outcome checks match wonky's "unsupported cases must fail explicitly". An undecided predicate becomes a reported fault, never a silent pass. INFERRED.
4. **Versioned checks keyed to the FeatureScript std version.**
   - FeatureScript programs pin a std library version. For example, `fixtures/r10b/r10b.fs` starts with `FeatureScript 3044;`.
   - Wonky can key check sets to that version so old acceptance fixtures such as r10b stay reproducible.
   - Keep the ACIS lesson: an old-version pass is not validity. INFERRED.
   - Evidence that this is the norm in the FeatureScript world (DOCUMENTED, verified 2026-09-23 on the public std mirror https://github.com/javawizard/onshape-std-library-mirror, std 2960, MIT):
     - `featurescriptversionnumber.gen.fs` defines **1,967** version constants, from `V30_BOOLEAN_COPY_RECORDS_FOR_TOOL_DERIVED` to `V2960_DELETE_FAILED_FLAT_BY_PART`.
     - Std code gates behaviour with `isAtVersionOrLater(context, FeatureScriptVersionNumber.V607_HOLE_FEATURE_FIT_UPDATE)` (`boolean.fs`, `filterOverlappingEdges`, which switches from exact point containment to a 1e-5 m tolerant radius). The local mirror excerpt `tmp/research/onshape-std/fillet.fs` alone has 6 such gates.
     - War story, in a std comment (`sectionpart.fs`): "BEL-110102 in rel-1.99 use of operations change was released without versioning. It causes missing parts in section views held back to versions earlier than V1017_SUBTRACT_COMPLEMENT." One unversioned change broke replay of old documents.
   - Evidence from a modern engine: Zoo pins algorithm generations to its language version. DOCUMENTED (KittyCAD/modeling-app `docs/kcl-std/functions/std-solid-fillet.md` and `docs/kcl-lang/migrating-to-kcl-3.md`):
     - `legacyMethod` ("revert to older engine SSI algorithm") was deprecated in KCL 2.0 and removed in KCL 3.0;
     - fillet `version` 1 is the original, 2 adds rolling-ball fillets;
     - "KCL 3.0 and later always use the newest algorithm".
     See `zoo-kittycad-cad-engine-overview-gpu-surface-surface-interse.md`.
   - War story for why the pin matters (DOCUMENTED, https://github.com/KittyCAD/modeling-app/issues/13200, opened 2026-08-21, open on 2026-09-24): adding *only* `kclVersion = 2.0` to the header of the `field-monitor-stand` sample makes its final four-edge 5 mm exterior fillet fail with "Edge cut failed" (0.5 mm fails too). Dropping the fillet changes volume by +0.1862% and area by +0.2730%. The sample was pulled from a migration PR rather than accept the geometry change. A language-version bump silently switched algorithm generations and turned a building model into a failing one.
   - Consequence for wonky (INFERRED):
     - Every kernel algorithm and checker gets a version.
     - The FeatureScript version header selects a version vector: (boolean, SSI, fillet, checker, tessellation).
     - Changing any algorithm output without bumping its version is a test failure. Acceptance fixtures pin their header.
5. **Level-70 face-face checks = compare/interference.** `FF_INT_FACE_INT`, `FF_INT_FACE_COIN` and `FF_INT_*_CONT` are exactly the interference, coincidence and containment outputs wonky lacks. Parasolid's clash taxonomy (interference, abutment, containment) is the user-facing form. INFERRED.
6. **CCS = pcurve-aware edge-edge intersection.**
   - Wonky keeps per-face pcurves (contract 3; `docs/step-pcurves.md`).
   - Intersecting edge curves in a shared face's (u,v) space reduces 3D CCI to 2D, which is cheaper and fits F32x2 better. That is exactly the edge-edge stage of Jackson's imprint cascade. INFERRED.
7. **Explicit analytic forms plus special-case SSI.** ACIS keeps plane, cylinder, cone, sphere and torus explicit, and SSI has explicit singular-surface (cone apex) handling. This is the same design as wonky's analytic B-rep. `NULL_EDGE_AT_APEX` and `no_vtx_at_sing` point at cone apexes as a known trouble spot. INFERRED.
8. **Report repairs, not just faults.** ACIS reports `SLIVER_FACE_REMOVED` ("Sliver face detected and replaced with tedge") and `NO_SLIVER_FACE_TEST` as check results. Wonky's `recover` already absorbs slivers and reports only their *count* in its `stats` line; proto-recover lists "that an absorbed sliver was not a real feature narrower than the deviation" as not certified (`docs/proto-recover.md`). Emitting one record per absorbed sliver (patch id, area, the edge it collapsed to) would make that uncertified step auditable in the viewer and in tests. INFERRED.
9. **Convexity points on edges** (`CONVEX_POINT`, level 60): edges whose convexity changes along their length must be split or marked. This is relevant for fillets later: blend selection needs a uniform edge convexity. INFERRED.

## Pointers worth porting or studying

- The Checking Levels paragraph (cost vs severity) and the self-intersection exception.
- The ERROR / WARNING / NOTE / INFO semantics and "defective = ERROR at highest level".
- The per-entity check table as a coverage checklist:
  - FACE/SURFACE/PCURVE/EDGE/VERTEX analytic-form checks (unit normals, positive radii, cone ratio, torus radii), directly relevant to wonky's plane, cylinder and cone types;
  - `DUP_VTX` and `OVERLAP_VERT`;
  - CW/CCW closure around vertices;
  - `FACE_ZERO_AREA`;
  - `EDGE_OFF_FACE`;
  - sliver faces;
  - `FF_INT_*`.
- Versioned checks (R14-R17 history) as a policy template.
- The CCS description as the justification for pcurve-based intersections.

## Verdict: adapt

The Checker article is the most explicit public statement of a commercial kernel's validity contract:
- cost-tiered levels;
- stable IDs;
- severities;
- a never-failing checker that reports its own gaps;
- versioned checks;
- "defective input means no guarantee".

Wonky should adapt this into a Bend-native validator and fault format, combined with the PK fault record shape.

The Intersectors article is thin but confirms two design choices: analytic special cases with singular-point handling, and pcurve-aware CCS.

Everything is proprietary documentation, so reimplement the ideas and copy no tables.
