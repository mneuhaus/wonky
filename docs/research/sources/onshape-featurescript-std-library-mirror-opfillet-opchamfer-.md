# Onshape FeatureScript std library mirror: the `opFillet` / `opChamfer` / `opShell` / `opThicken` / `opOffsetFace` contracts

- **Kind:** library source (FeatureScript), auto-mirrored to Git.
- **Canonical URL:** https://github.com/javawizard/onshape-std-library-mirror (default branch `without-versions`; `main` keeps the version numbers in the imports).
- **Other URLs:**
  - https://github.com/javawizard/onshape-std-library-mirror/blob/without-versions/geomOperations.fs
  - https://github.com/javawizard/onshape-std-library-mirror/blob/without-versions/fillet.fs
  - `chamfer.fs`, `shell.fs`, `thicken.fs`, `offsetSurface.fs`, `moveFace.fs`, `modifyFillet.fs`, `edgeBlendCommon.fs`, `valueBounds.fs`, `errorstringenum.gen.fs` in the same tree.
  - Upstream is the Onshape "std" document https://cad.onshape.com/documents/12312312345abcabcabcdeff (needs an Onshape login).
  - The importer: https://github.com/javawizard/onshape-std-library-importer
- **Local copies:**
  - Shallow clone at commit `a2a7b13`: `tmp/research/onshape-std-library-mirror-opfillet-opchamfer-/`
  - The four core files are also in `tmp/research/onshape-std/`.
- **Authors / organization:**
  - The code is by Onshape / PTC Inc. ("Copyright (c) 2013-Present PTC Inc.", file headers).
  - The mirror and importer are by @javawizard (Alex Boyd), who is not affiliated with Onshape (README).
- **License:**
  - **MIT**. `LICENSE.txt`: "The MIT License (MIT) for the FeatureScript Standard Library (std). Copyright (c) 2013-Present PTC Inc." DOCUMENTED.
  - Implication: wonky may copy the feature wrappers, enums, bounds and error vocabulary verbatim if it keeps the MIT notice. The private, unlicensed status of wonky does not conflict with this.
  - The geometry itself is **not** in this code. Every `op*` is a one-line wrapper around a server built-in (`return @opFillet(context, id, definition);`). The file header says: "The geomOperations.fs module contains wrappers around built-in Onshape operations and no actual logic." DOCUMENTED, `geomOperations.fs` l.1–17.
- **Status and activity** (as of 2026-09-23, re-checked 2026-09-24 via `gh api`: unchanged):
  - 12 stars, 9 forks, 1 contributor, created 2024-03-26.
  - Last mirrored release: **Version 2960.0, commit dated 2026-05-15** (`a2a7b13`). Earlier releases arrived roughly every 3 weeks (2892 on 2026-02-20, 2909, 2931, 2945, 2960).
  - The importer has **stalled**. Issue #1, "Last update didn't auto run", opened 2026-04-10, got a follow-up on 2026-09-21: "Is this repo still getting updated? It seems behind." https://github.com/javawizard/onshape-std-library-mirror/issues/1
  - Marc's real model `fixtures/r10b/r10b.fs` declares `FeatureScript 3044;`, which is **newer than the javawizard mirror**.
- **Newer snapshot (found 2026-09-24):** in the same issue thread (comment 2026-09-23) user @yepher points to a manual export of **Version 3083.0**: https://github.com/yepher/feature_script_std (MIT, 0 stars, created 2026-09-23, single import commit `5e7d1b4` "Version: 3083.0"; `_export_manifest.json` records `versionName: "3083.0"`, source document `12312312345abcabcabcdeff`, exported 2026-09-23T01:34Z). DOCUMENTED. Shallow clone: `tmp/research/onshape-std-3083/repo/` (280 files). It is a one-off manual pull, not an auto-updating mirror. HEARSAY-grade provenance (single unaffiliated user), but the files carry the PTC headers and the content is consistent with 2960.
- **2960 → 3083 diff for the blend/offset/shell surface** (done locally, import/version lines normalised; DOCUMENTED):
  - `fillet.fs`, `chamfer.fs`, `shell.fs`, `thicken.fs`, `edgeBlendCommon.fs`, `offsetSurface.fs`, `modifyFillet.fs`: **only import-list changes**, no logic change.
  - `geomOperations.fs`: only doc-comment additions unrelated to blends (loft `useProfileApproximation`, draft `inferReferences`/`inferReferenceOptions`, spline `hasTargetLength`/`targetLength`, mate-connector `attachTo`/`originEntities`, `companionBodyPattern`, imprint `ownExistingImprints`). Op line numbers shift by ~+30 (3083: `opChamfer` 284, `opDraft` 513, `opExtractSurface` 583, `opFaceBlend` 706, `opFillet` 750, `opFullRoundFillet` 833, `opModifyFillet` 1195, `opMoveFace` 1214, `opOffsetFace` 1251, `opOffsetWire` 1282, `opShell` 1540, `opThicken` 1842).
  - `errorstringenum.gen.fs`: 62 new codes appended (simulation, sheet-metal unfold/jog, fit-spline length, `BSURF_INCONSISTENT_*`, `SWEEP_*`); **no fillet, chamfer, shell or thicken codes added or changed**.
  - `valueBounds.fs`: new integer/real count bounds only; the blend/shell bounds below are unchanged.
  - INFERRED: the contract below holds for 3044 (Marc's header) as well, since it is sandwiched between two identical versions of the blend files. The line numbers below are for **2960** unless marked.

## What it is

This is the exact API surface that wonky's FeatureScript frontend has to honour for blends, offsets and shells. It covers:

- parameter maps, defaults and bounds;
- the feature-level preprocessing that happens *before* the built-in is called (sign flips, partial-fillet data, sheet-metal routing, manipulators);
- the error vocabulary.

A companion note, `onshape-help-fillet-and-face-blend.md`, covers user-level semantics from the help pages. This note is the code-level contract and adds three things:

1. the complete fillet/chamfer error enum and its one-to-one correspondence with Parasolid's blend fault codes;
2. hidden parameters that the features pass through to the built-ins;
3. closed-form helper formulas found in the code.

## How it works

### Op signatures and locations

All in `geomOperations.fs` at v2960, DOCUMENTED:

| op | line | required | optional / notes |
|---|---:|---|---|
| `opChamfer` | 285 | `entities` (edges and faces; a face means all its edges), `chamferType` ∈ `EQUAL_OFFSETS`/`TWO_OFFSETS`/`OFFSET_ANGLE` (+ hidden `RAW_OFFSET`) | `width`, `width1`, `width2`, `angle`, `oppositeDirection`, `tangentPropagation` (default false). Doc comment: "TODO: make this interface more like an operation and less like a feature." |
| `opDraft` | 482 | `draftType`, `pullVec`, `angle` ∈ [0, 89.9]° | `reFillet` ("attempt to defillet draft faces before the draft and reapply the fillets after") |
| `opFaceBlend` | 675 | `side1`, `side2` (face sets, each from one body), `flipSide1Normal`/`flipSide2Normal`, `crossSection` ∈ `ROLLING_BALL`/`SWEPT_PROFILE` (+ `spine`), `blendControlType` ∈ `RADIUS`/`WIDTH`, `crossSectionShape` ∈ `CIRCULAR`/`CONIC`/`CURVATURE`/`CHAMFER` | `asymmetric`, `secondRadius`, `widthRatio`, `rho`, `magnitude`, tangent/conic hold lines (and inverse), `cliffEdges`, `caps` (entity + flip), limits (`limitPlane1/2`, `faceLimits`, `edgeLimit`), `helpPoint` (keep the solution nearest to it), `trim` ∈ `WALLS`/`SHORT`/`LONG`/`NO_TRIM`, `detach` |
| `opFillet` | 719 | `entities`, `radius` | `tangentPropagation` (false), `crossSection` ∈ `CIRCULAR`/`CONIC`/`CURVATURE` (+ hidden `CHAMFER`), `rho`, `magnitude`, `partialFilletBounds` [{`boundaryEdge`, `boundaryParameter`, `isFlipped`}], `isVariable`, `vertexSettings` [{`vertex`, `vertexRadius`, `variableRho`/`variableMagnitude`}], `pointOnEdgeSettings`, `smoothTransition`, `allowEdgeOverflow` (**default true**), `keepEdges`, `smoothCorners` (false), `smoothCornerExceptions`, `createDetachedSurface` (false) |
| `opFullRoundFillet` | 800 | `side1Face`, `side2Face`, `centerFaces` | `tangentPropagation` (**default true** here) |
| `opModifyFillet` | 1157 | `faces`, `modifyFilletType` ∈ `CHANGE_RADIUS`/`REMOVE_FILLET` | `radius`, `reFillet` |
| `opMoveFace` | 1176 | `moveFaces`, `transform` | `reFillet` (false), `mergeFaces` (true) |
| `opOffsetFace` | 1213 | `moveFaces`, `offsetDistance` (signed, along the face normal) | `reFillet` (false), `mergeFaces` (true) |
| `opOffsetWire` | 1244 (`@internal`) | `edges` (planar, no intersections or coincidences), `normal`, `offset1`, `offset2` | `flip`, `makeRegions`. Open chains take their direction from the first edge; closed chains default to outward. |
| `opShell` | 1500 | `entities` (faces to remove and/or solid bodies to hollow), `thickness` | **positive = outward, negative = inward** |
| `opThicken` | 1799 | `entities` (sheets/faces), `thickness1` (along the normal), `thickness2` (opposite) | `keepTools` (default true) |

- **Offset surface does not use `opOffsetFace`.** The `offsetSurface` feature calls `opExtractSurface(context, id, {"faces", "offset", "useFacesAroundToTrimOffset": false})`. DOCUMENTED, `offsetSurface.fs`.
- **Hidden keys.** Features pass their whole `definition` map to the built-in, so `@opFillet` also receives keys that are not in its doc block. DOCUMENTED, `fillet.fs` `performEdgeFillet`, `edgeBlendCommon.fs`:
  - `blendControlType` (`RADIUS`/`WIDTH`), `width`;
  - `isAsymmetric`, `otherRadius`, `flipAsymmetric`;
  - `nonCircularRadius`;
  - `partialFilletCapBounds`, `partialArcLengthParameterization` / `variableFilletArcLengthParameterization` (both set to `false` "for better performance");
  - `filletType`, `defaultsChanged`, `isPartial`, `secondBound`, ….

  An interpreter must therefore accept unknown keys. INFERRED: whitelisting keys would break Onshape-authored code.

### Feature-level preprocessing wonky must reproduce

All DOCUMENTED in the named files.

- **`fillet` feature** (`fillet.fs` l.127–412):
  - `FilletType` is `EDGE` or `FULL_ROUND`. The entity filter is `EntityType.EDGE && EdgeTopology.TWO_SIDED` or `FACE`, and not sketch or construction geometry.
  - The feature calls `verifyNoMesh`, so mesh bodies are rejected.
  - If `crossSection` is not `CIRCULAR`, the radius is read from `nonCircularRadius`: `definition.radius = radiusIsCircular(definition) ? definition.radius : definition.nonCircularRadius`.
  - `CURVATURE` **forces** `allowEdgeOverflow = true` (`performEdgeFillet` l.427).
  - Programmatic defaults (the map at l.392–412) are `tangentPropagation: false`, `crossSection: CIRCULAR`, `allowEdgeOverflow: true`, `smoothCorners: false`, `isAsymmetric: false` and `isPartial: false`. The **UI** annotation default is `tangentPropagation: true`. So a UI-created fillet and a code-called `fillet(...)` without the key behave differently.
  - After the op, a `VRFILLET_NO_EFFECT` status is cleared when `defaultsChanged` is false. Tolerant radii set dimensioned entities via `setDimensionedEntities` (only for circular, and not together with asymmetric or variable).
- **Partial fillet** (l.425–940):
  - `getPath` builds one continuous `Path` from the selected edges, using `qTangentConnectedEdges` if propagation is on.
  - Errors: `PATH_EDGES_NOT_CONTINUOUS`; `PARTIAL_FILLET_BAD_INPUT_ERROR` (more than one path); `PARTIAL_FILLET_CLOSED_PATH_ERROR` (closed path without a second bound).
  - Bounds are given as percentage, offset or entity. They are converted into `{boundaryEdge, boundaryParameter, isFlipped}` via `evPathTangentLines` and `evDistance`, using edge parameters without arc-length parameterisation.
  - Entity bounds split a temporary wire copy with `opSplitPart` to count intersections. Cap faces are removed afterwards with `opDeleteFace`.
- **Variable fillet:**
  - Up to v2960 the vertex and point-on-edge settings are just forwarded. Edge parameters are bounded to [0.001, 0.999].
  - A setting that selects more than one edge throws the literal string `"Variable radius fillet has more than one edge selected in a particular setting"` (l.1090).
- **Sheet metal:**
  - `sheetMetalAwareFillet` and `sheetMetalAwareChamfer` split the selection.
  - Active sheet-metal edges only allow circular, constant, symmetric, non-partial fillets and equal-offset `FACE_OFFSET` chamfers. Everything else throws `SHEET_METAL_*_USE_CORNER_BREAK`.
  - wonky can reject sheet metal entirely.
- **`chamfer` feature** (`chamfer.fs`):
  - `chamferMethod` is `FACE_OFFSET` ("Offset", the default) or `APEX_RANGE` ("Tangent").
  - `directionOverrides` flips individual edges.
  - Before `V2211_CHAMFER_IMPROVEMENTS`, `oppositeDirection` is flipped when the pattern transform has determinant −1 (a mirrored instance): the `V414_ASYMMETRIC_CHAMFER_MIRROR_BUG` workaround.
  - Defaults: `oppositeDirection: false`, `tangentPropagation: false` (UI default true), `chamferMethod: FACE_OFFSET`.
- **`shell` feature** (`shell.fs`):
  - `isHollow` selects either whole parts (hollowed without an opening) or faces to remove.
  - `thickness` is positive in the UI (bounds below). Unless `oppositeDirection` is set, the feature applies `definition.thickness = -definition.thickness`. So the UI default is **inward**, while `opShell` itself treats positive as outward.
  - Errors: `SHELL_SELECT_PARTS`, `SHELL_SELECT_FACES`.
- **`thicken` feature** (`thicken.fs`):
  - `midplane` splits `thickness` into two halves; `oppositeDirection` swaps `thickness1` and `thickness2`.
  - It then runs `opThicken` and a boolean step (`processNewBodyIfNeeded`). `thickenEditLogic` guesses ADD or REMOVE from the flip.

### Bounds

All from `valueBounds.fs` and `edgeBlendCommon.fs`, DOCUMENTED. These are the smallest legal values, i.e. wonky's input-validation layer:

- `BLEND_BOUNDS` (fillet radius, chamfer distance): meter `[1e-5, 0.005, 500]`, so the minimum is **0.01 mm** and the UI default is 5 mm.
- `VR_BLEND_BOUNDS` (variable-radius values): `[0, 0.005, 500]` m, so **zero is allowed**. The error `VRFILLET_INTERNAL_ZERO` says "Only end vertices of an edge chain can have zero radius."
- `SHELL_OFFSET_BOUNDS`: `[1e-5, 0.0025, 500]` m (default 2.5 mm).
- `FILLET_RHO_BOUNDS`: `[0.0, 0.5, 0.99999]`.
- `CHAMFER_ANGLE_BOUNDS`: `[0.1°, 45°, 179.9°]`.
- `MOVE_FACE_OFFSET_BOUNDS = ZERO_INCLUSIVE_OFFSET_BOUNDS`.
- Thicken uses `ZERO_INCLUSIVE_OFFSET_BOUNDS` and `NONNEGATIVE_ZERO_DEFAULT_LENGTH_BOUNDS`.

### Closed forms hidden in the manipulator code

From `edgeBlendCommon.fs` l.90–215. The formulas are DOCUMENTED; their geometric interpretation is INFERRED.

- `findRadiusToOffsetRatio(normals) = 1/cos(θ/2) − 1`, where θ is the angle between the two face normals at the edge midpoint. The comment reads: "distance from the center of a corner-inscribed circle to the corner is radius / cos(0.5·angle between normals)". So the ball centre sits at `r / cos(θ/2)` from the edge, along the bisector `normalize(n0 + n1)`.
- The width-to-radius conversion is `radius = width / |n0 − n1|`. For a plane/plane edge the two contact (spring) lines are at `C − r·n0` and `C − r·n1`, so **"width" is the chord between the spring lines**, `r·|n0 − n1| = 2r·sin(θ/2)`. INFERRED.
- Corollary for fit checks, INFERRED: each contact line lies `r·tan(θ/2)` from the edge along its face. At a 90° box edge that is exactly `r`. A fillet on face F can only fit if `r·tan(θ/2)` is below the local distance to F's next boundary; otherwise the result is overflow or `FILLET_FACE_RANGE_TOO_LARGE`.
- Convexity comes from `evEdgeConvexity`. `EdgeConvexityType` has four values: `CONVEX` (interior angle < 180°), `CONCAVE`, `SMOOTH` and **`VARIABLE`** (convexity changes along the edge). DOCUMENTED, `edgeconvexitytype.gen.fs`.

### Error vocabulary

From `errorstringenum.gen.fs` (3503 lines), DOCUMENTED. The fillet block (l.2367–2392), the chamfer block (l.2393–2418) and the `EDGEBLEND_*` block (l.2419–2444) contain the **same 13 codes** with near-identical wording. They match the Parasolid v12 edge-blend fault chapter almost word for word (see `parasolid-v12-functional-description-edge-blending-chapters-.md`). The Parasolid mapping in the table is INFERRED from that wording; it is stronger evidence for "Onshape runs Parasolid" than the Wikipedia hearsay in the help note.

| Onshape `FILLET_*` (message) | Parasolid v12 fault |
|---|---|
| `FILLET_VERTEX_EDGES_COMPLICATED` ("Selection of edges at vertex is too complicated") | `PK_blend_fault_vertex_c` |
| `FILLET_REQUIRES_SURFACE_EXTENSION` ("requires invalid extension of surface") | `PK_blend_fault_bsurf_c` |
| `FILLET_RANGE_INCONSISTENT_EDGE` ("Radius inconsistent with adjacent filleted edge") | `PK_blend_fault_range_c` |
| `FILLET_ADJOINING_EDGE_NOT_FILLETED` | `PK_blend_fault_edge_c` |
| `FILLET_OVERLAPS_EDGE_LOOP` ("completely overlaps edge loop") | `PK_blend_fault_loop_c` |
| `FILLET_EDGE_OVERLAPPED_BY_FILLET` ("Unfilleted edge overlapped by fillet") | `PK_blend_fault_overlap_edge_c` |
| `FILLET_FACE_RANGE_TOO_LARGE` ("Radius of fillet on face too large") | `PK_blend_fault_face_c` |
| `FILLET_OVERLAP` ("Overlapping fillets") | `PK_blend_fault_overlap_c` |
| `FILLET_BOUNDARY_OVERLAP` ("Bad overlap on end boundary") | `PK_blend_fault_overlap_end_c` |
| `FILLET_ILLEGAL_END_BOUNDARY` | `PK_blend_fault_end_c` |
| `FILLET_BOUNDARY_INTERSECTS_EDGE` ("End boundary intersects unfilleted edge") | `PK_blend_fault_edge_intsec_c` |
| `FILLET_PRODUCED_SELF_INT_SURFACE` | `PK_blend_fault_self_int_c` |
| `FILLET_RHO_TOO_LARGE` | (post-v12 conic code) |

Other codes relevant to a first-cut interpreter:

- Selection and generic failures: `FILLET_SELECT_EDGES`, `FILLET_FAILED`, `FILLET_FAIL_SMOOTH` ("Could not fillet smooth edges"), `FILLET_PARTIAL_FAIL` ("Could not fillet selections on some parts", i.e. per-body partial success), `FILLET_EDGES_NOT_MANIFOLD` ("Edges must form single chain per part"), `FILLET_CHAMFER_UNSUPPORTED` ("Chamfer cross section is unsupported").
- Chamfer: `CHAMFER_SELECT_EDGES`, `CHAMFER_FAILED`, `CHAMFER_FAIL_SMOOTH`, `CHAMFER_PARTIAL_FAIL`, `CHAMFER_DIRECTION_OVERRIDE_NO_EFFECT`, `CHAMFER_HELD_BACK`.
- Variable fillet: `VRFILLET_*` (radius, rho or magnitude required at a vertex or point, vertex not on the chain, `VRFILLET_INVALID_CHAIN` for closed chains with fewer than 2 vertices, `VRFILLET_MULTI_SELECTION`, `VRFILLET_BAD_COEDGE`).
- Shell and thicken: `SHELL_FAILED` ("Could not shell part with selections"), `THICKEN_FAILED`, `THICKEN_SELECT_ENTITIES`.
- Direct edit: `DIRECT_EDIT_OFFSET_FACE_FAILED`, `DIRECT_EDIT_FAILED_TO_IDENTIFY_FILLETS` / `DIRECT_EDIT_NO_FILLET_FACES` (the `reFillet` path needs fillet *recognition*).
- Face blend: `FACE_BLEND_*` (29 codes), including `FACE_BLEND_SELF_INTERSECTION`, `FACE_BLEND_CANNOT_ATTACH` and the three `WRONG_*_SENSE` codes.
- Offset wire: `OFFSET_WIRE_DIR1_FAILED` / `DIR2_FAILED` ("offset value … too large").

## Robustness and guarantees

- The wrappers guarantee nothing geometric. They validate selections and parameter combinations, and then the built-in succeeds or throws. DOCUMENTED.
- **Version pinning is part of the contract.** Behaviour branches on `isAtVersionOrLater(context, FeatureScriptVersionNumber.V…)`:
  - `V575_SHEET_METAL_FILLET_CHAMFER`
  - `V1917_PARTIAL_FILLET_FIX_CHAIN_OF_EDGES`
  - `V1968_PARTIAL_FILLET_CHECK_INVALID_BOUNDS`
  - `V2211_CHAMFER_IMPROVEMENTS`
  - `V2479_PF_ADDED_ENTITY_END_CONDITION`
  - `V414_ASYMMETRIC_CHAMFER_MIRROR_BUG`
  - `V484_MOVE_FACE_0_DISTANCE`, `V685_EXTEND_SHEET_BODY_STEP_EDGES`

  DOCUMENTED. INFERRED: wonky must declare one emulated FS version and treat higher `FeatureScript N;` headers (Marc's 3044) as "semantics may differ".
- "Info instead of silent no-op" precedent: `VRFILLET_NO_EFFECT` and `CHAMFER_HELD_BACK` are reported as feature infos. DOCUMENTED. This matches wonky's explicit-failure rule.
- `allowEdgeOverflow = true` is the default. By default, therefore, the kernel may *change neighbouring topology* (Parasolid-style overflow) to keep the circular profile. A wonky first cut that cannot overflow must fail explicitly rather than silently produce a different fillet. INFERRED.

## Parallelism and performance

- Nothing measurable here. The wrappers are sequential coordination and all heavy work is server-side. There are no numbers in the source. DOCUMENTED (absence).
- Minor performance hint: arc-length parameterisation is deliberately disabled for variable and partial fillets ("For better performance", `fillet.fs` l.91). DOCUMENTED.

## Known failures, limitations, war stories

- The mirror has been **stale since 2026-05-15** (issue #1). Anything added in FS 2961–3044 is invisible here. DOCUMENTED.
- The opChamfer doc still carries "TODO: make this interface more like an operation and less like a feature" (l.284). This is honest evidence that `opChamfer` takes feature-level semantics such as `tangentPropagation` and `directionOverrides`. DOCUMENTED.
- A mirrored-pattern bug needed a direction flip before V2211: `V414_ASYMMETRIC_CHAMFER_MIRROR_BUG`. INFERRED lesson: asymmetric blends (`TWO_OFFSETS`, `OFFSET_ANGLE`, asymmetric fillets) are handedness-sensitive, and wonky's tests must include mirrored instances.
- Sheet metal routes around fillet and chamfer entirely (corner break). DOCUMENTED.
- Marc's real code uses the minimal subset. `r10b.fs` l.61–79 (`roundX`, `filletXWindow`) calls `opFillet(c, id+"f", {"entities": qUnion(edges), "radius": rad*millimeter, "tangentPropagation": false})` on all straight edges parallel to X (`abs(direction[0]) > 0.99999`), optionally windowed by bounding-box midpoints. It runs on a `clone` of the body and wraps the call in `try … regenError("roundX "~id~": "~e)`. DOCUMENTED (wonky repo). Both helpers are currently not reached from the target (`docs/acceptance.md` l.158).

## Relevance for wonky

- **Where wonky stands today** (repo HEAD `d917992`, 2026-09-24; DOCUMENTED from the wonky repo):
  - `opFillet` and `opChamfer` are builtins that throw `UnsupportedFeatureError` naming the call, also inside `try silent`, e.g. `"opChamfer (EQUAL_OFFSETS) is not implemented; blends are a separate stage"` (`test/r20-queries.test.mjs` l.164–169, `local design note` l.197).
  - The R20 kernel cases KS01–KS09 stop at their first blend, and their shared helpers use exactly two call shapes: `opChamfer(context, id, {"entities", "chamferType": ChamferType.EQUAL_OFFSETS, "width"})` and `opFillet(context, id, {"entities", "radius"})` (`tmp/r20/scratch/ks0*/case.fs` l.105 and l.110). So the first implementation target is narrower than the acceptance matrix below: **symmetric equal-offset chamfer and constant circular fillet, programmatic defaults (`tangentPropagation: false`)**.
  - Corpus triage counts `opFillet`/`opChamfer` in 108 files across 53 families of the FS corpus, and `opOffsetFace`/`opSplitPart`/`opSweep`/… in 91 files across 41 families (`docs/corpus-triage.md` l.135, l.195–196).
  - Key names: `EQUAL_OFFSETS` takes `width` (UI "Distance"); the feature maps it to `{width1: width, width2: width}` (`chamfer.fs` l.200). The op doc says it "places both new edges `width` away from each original edge" (`geomOperations.fs` 3083 l.265). A raw `opChamfer` call carries no `chamferMethod`; the feature default is `FACE_OFFSET` (`chamfer.fs` l.112), i.e. the Parasolid "offset both supports by the range, intersect, project" rule (see `onshape-help-fillet-and-face-blend.md` and the chamfer closed form in the Parasolid note). At a 90° edge this equals the distance along each face; at other angles the contact lines sit at `t = width·cot(α/2)` from the edge for interior angle α. DOCUMENTED (code) / INFERRED (formula). This `width` is *not* the fillet `WIDTH` control (the spring-line chord).
- **Frontend contract (adopt):**
  - Copy the MIT wrappers (`fillet.fs`, `chamfer.fs`, `shell.fs`, `thicken.fs`, `edgeBlendCommon.fs`, the enum `.gen.fs` files, `valueBounds.fs` constants, `errorstringenum.gen.fs`) into the interpreter prelude with the license notice.
  - Map `@opFillet`, `@opChamfer`, `@opShell`, `@opThicken`, `@opOffsetFace` and `@opExtractSurface` to Bend kernel entry points.
  - The error enum above becomes wonky's fillet failure enum, with the same names so that FS `try`/`catch` code behaves the same.
- **First-cut acceptance matrix** (INFERRED). Implement:
  - `opFillet{CIRCULAR, RADIUS, constant, symmetric}` on plane/plane, plane/cylinder (axial and circular) and plane/cone circular edges. These give exact cylinders, tori and spheres; see the OCCT/ChFiKPart note.
  - `opChamfer{EQUAL_OFFSETS, TWO_OFFSETS, OFFSET_ANGLE, FACE_OFFSET}` on the same pairs (exact planes and cones).
  - `opShell` and `opThicken` on plane/cylinder/cone bodies (offsets of these are exact and of the same type).
  - `opOffsetFace` on the same types.

  **Reject explicitly** with the Onshape enum names:
  - `CONIC`, `CURVATURE`, `WIDTH` control, `isAsymmetric`, `isVariable` (`VRFILLET_*`), partial fillets, `smoothCorners`, `createDetachedSurface`, `APEX_RANGE`, `reFillet`, `opFaceBlend`, `opFullRoundFillet`, `opModifyFillet`;
  - edges with `VARIABLE` convexity (`FILLET_FAIL_SMOOTH`-style);
  - any case that would need overflow: `FILLET_FACE_RANGE_TOO_LARGE` / `FILLET_EDGE_OVERLAPPED_BY_FILLET`, even though `allowEdgeOverflow` defaults to true.
- **Bend fit:** the wrappers are interpreter-side JS, not Bend. The Bend side only needs pure functions `(body, edgeIds, params) -> Result<body, FilletFault>`. The formulas above (`r/cos(θ/2)`, `r·tan(θ/2)`, `2r·sin(θ/2)`) are F32x2-friendly: one normalize, one cos/sin of a half-angle. With planes, the half-angle trig can be avoided: `cos θ = n0·n1` and `tan(θ/2) = |n0×n1| / (1 + n0·n1)`. Fit predicates can be decided with multi-limb integers when the inputs are exact rationals. INFERRED.
- **Provenance advantage:** Onshape's `reFillet` and `opModifyFillet` depend on *recognising* fillet faces (`DIRECT_EDIT_FAILED_TO_IDENTIFY_FILLETS`). wonky already tracks topology identity, so it can tag each blend face with `(source edge id, radius, cross-section)` at creation. Defillet, modify-fillet and diffs then become lookups, not recognition. INFERRED.
- **LLM ergonomics:** the code-called defaults differ from the UI defaults (`tangentPropagation`). wonky's docs and linter should warn when LLM-written FS omits `tangentPropagation`. INFERRED.
- **Testing and FDM:**
  - `roundX` is the canonical first regression. Fillet the 4 X-parallel edges of an `a×b×c` box (a along X) at radius `r < min(b,c)/2`; the volume must be `abc − (4 − π)·r²·a` exactly. Topology: F = 10 (4 planes ±Y/±Z, 2 end planes ±X that become rounded rectangles, 4 quarter-cylinders), E = 24 (8 tangent spring lines along X, plus 4 lines + 4 quarter-circle arcs on each end face), V = 16 (8 per end face); V − E + F = 2. Each fillet end is a "one edge blended at a three-edge vertex" end cap against a planar face perpendicular to the edge, so no vertex blend is needed. Add the degenerate limit `r = b/2` (two fillets meet tangentially, spring lines coincide, the ±Y face vanishes) as an explicit reject-or-merge test. INFERRED closed form.
  - The same box with **all 12 edges** at equal `r` is the first vertex-blend test: 12 quarter-cylinders + 8 sphere octants (F = 26, E = 48, V = 24). With `a' = a−2r` etc., the result is the Minkowski sum of the inner box with a ball, so Steiner's formula gives `V = a'b'c' + 2r(a'b'+b'c'+c'a') + πr²(a'+b'+c') + (4/3)πr³ = abc − (4−π)r²(a+b+c) + (16 − 14π/3)r³`. Sanity check: a cube of side 2r gives 4πr³/3, a sphere. INFERRED (derived here).
  - FDM parts need chamfers on down-facing edges at least as often as fillets, so `OFFSET_ANGLE` 45° must be in the first cut.

## Pointers worth porting or studying

- `geomOperations.fs` l.260–302 (`opChamfer`), l.610–736 (`opFaceBlend`, `opFillet`), l.785–826 (`opFullRoundFillet`), l.1145–1260 (`opModifyFillet`, `opMoveFace`, `opOffsetFace`, `opOffsetWire`), l.1488–1512 (`opShell`), l.1795–1820 (`opThicken`).
- `fillet.fs`:
  - l.127–412: precondition and defaults;
  - l.425–523: `performEdgeFillet`;
  - l.526–940: partial-fillet path logic;
  - l.1021–1045: `sheetMetalAwareFillet`, a good model for "split selection, reject unsupported subset with a named error".
- `edgeBlendCommon.fs` l.1–215: bounds, `radiusIsCircular`, `findSurfaceNormalsAtEdge`, `findRadiusToOffsetRatio`.
- `chamfer.fs` l.20–225, `shell.fs` (62 lines), `thicken.fs` (131 lines), `offsetSurface.fs` (`opExtractSurface` offset path), `moveFace.fs` l.240–262 (sign handling for OFFSET).
- `errorstringenum.gen.fs` l.2367–2444 (the 13-code blend fault family ×3), l.1478–1512 (`VRFILLET_*`), l.2557–2624 (`FACE_BLEND_*`), l.2615–2628 (`OFFSET_WIRE_*`).
- `valueBounds.fs` l.279–370 and l.1058–1061.
- `git log -p -- fillet.fs` on the **full** (non-shallow) mirror shows how fillet semantics changed since 2014. Useful when wonky picks an emulated version.

## Verdict: adopt

Adopt the interface, defaults, bounds and error enum verbatim; the code is MIT, and wonky is an FS interpreter, so this *is* the spec. Pin wonky to the 3083 snapshot (`yepher/feature_script_std`, identical blend/shell logic to 2960, so it also covers Marc's 3044 header), and keep a script that re-diffs the blend files whenever a newer export appears. Do not expect geometry: every op is `@builtin`. The geometric behaviour to match is Parasolid's, per the fault-code correspondence.
