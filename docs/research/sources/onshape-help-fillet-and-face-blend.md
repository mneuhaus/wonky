# Onshape help: Fillet and Face blend (plus the FeatureScript std-library wrappers)

- **Kind / URLs:**
  - User documentation:
    - https://cad.onshape.com/help/Content/fillet.htm
    - https://cad.onshape.com/help/Content/face-blend.htm
  - FeatureScript standard-library source, read from the community mirror https://github.com/javawizard/onshape-std-library-mirror (branch `without-versions`), files `fillet.fs`, `chamfer.fs`, `shell.fs`, `geomOperations.fs`. Local copies are in `tmp/research/onshape-std/`.
  - Official FS docs: https://cad.onshape.com/FsDoc/library.html
- **Authors / org / year:**
  - Onshape (PTC Inc.). The help pages were fetched 2026-09-22.
  - The std-library header reads `FeatureScript 2960` and "Copyright (c) 2013-Present PTC Inc.". DOCUMENTED: `fillet.fs` header in the mirror.
- **License and porting implications:**
  - The help text is proprietary documentation, so read it but don't copy it.
  - The std library is published under the **MIT License**. DOCUMENTED: header of `fillet.fs` in the mirror, https://github.com/javawizard/onshape-std-library-mirror
  - The feature-level wrappers (parameter handling, validation, error enums) could therefore legally be reused as wonky's FS-interpreter prelude.
  - The actual geometry is in built-ins (`@opFillet`, `@opChamfer`, `@opShell`, `@opFaceBlend`, `@opOffsetFace`, `@opThicken`) executed server-side and not published. DOCUMENTED: `geomOperations.fs` lines 287, 677, 721, 802, 1159, 1215, 1502, 1801 (`return @opFillet(context, id, definition);` etc.).
- **Status / activity:** Live commercial product. The std library is versioned continuously and features are version-gated (e.g. `FeatureScriptVersionNumber.V2211_CHAMFER_IMPROVEMENTS`, `V575_SHEET_METAL_FILLET_CHAMFER` in `chamfer.fs`). DOCUMENTED: mirror source.

## What it is

This is the specification of the blend/offset features that wonky's FeatureScript frontend has to accept. Wonky interprets Onshape FeatureScript, so these parameter maps *are* wonky's API contract for fillets, chamfers, face blends, shells, offsets and thickens. The help pages add the user-level semantics (what "width" or "rho" means) and the known limitations.

## How it works

Everything in this section is DOCUMENTED unless marked otherwise.

- **Edge fillet** (https://cad.onshape.com/help/Content/fillet.htm; `opFillet` doc block in `geomOperations.fs` ~l.680–721):
  - `entities` are edges, or faces (a face means all its edges).
  - `radius` is the fillet radius. The UI's "Measurement: Width" is the chord width.
  - `tangentPropagation`: default `false` in `opFillet`, but the UI feature defaults to on.
  - `crossSection` ∈ {`CIRCULAR`, `CONIC`, `CURVATURE`}:
    - `rho` is in (0,1). "0.01 creates a flat, nearly-chamfered shape; 0.99 creates a pointed, nearly-unchanged shape". The help maps 0.25 to elliptical, 0.5 to parabolic and 0.999 to hyperbolic.
    - `magnitude` is in [0, 0.999] for curvature-continuous blends.
  - Partial fillets: `partialFilletBounds` gives a boundary edge plus parameter.
  - Variable fillets: `isVariable`, `vertexSettings`, `pointOnEdgeSettings`, `smoothTransition`.
  - `allowEdgeOverflow` (default true) with `keepEdges` exceptions.
  - `smoothCorners` with `smoothCornerExceptions`.
  - `createDetachedSurface`.
- **Full round fillet**: `opFullRoundFillet(side1Face, side2Face, centerFaces)` replaces the center faces with a tangent round. The help states it cannot span more than one non-contiguous face at a time. https://cad.onshape.com/help/Content/fillet.htm
- **Fillet feature wrapper** (`fillet.fs`, 1227 lines):
  - The `CURVATURE` cross-section forces `allowEdgeOverflow = true`.
  - Partial-fillet bounds come from Position %, Entity or Offset end types.
  - Variable radii are placed by arc length.
  - Partial fillet caps are removed with `opDeleteFace`.
  - Status enums the interpreter must reproduce, split by how the wrapper raises them (DOCUMENTED, `fillet.fs` 2960, re-checked 2026-09-24):
    - **Errors** via `throw regenError(...)`: `FILLET_SELECT_EDGES` (l.1029), `PATH_EDGES_NOT_CONTINUOUS` (l.543), `PARTIAL_FILLET_BAD_INPUT_ERROR` (l.548), `PARTIAL_FILLET_CLOSED_PATH_ERROR` (l.553), `PARTIAL_FILLET_INVALID_BOUNDS_ERROR` (l.451, 657), `PARTIAL_FILLET_INVALID_BOUND_ENTITY` (l.760), `FILLET_ILLEGAL_END_BOUNDARY` (l.838), `PARTIAL_FILLET_OFFSET_BOUNDARY_TOO_LARGE` (l.888), `CANNOT_USE_PARTIAL_FILLET_IN_SHEET_METAL` (l.532), `SHEET_METAL_PARTS_PROHIBITED` (full round).
    - **Warnings** via `reportFeatureWarning`: `TOLERANT_RADIUS_NO_ASYMMETRY` and `TOLERANT_RADIUS_NO_VARIABLE_RADIUS` (l.486–492). The feature still regenerates.
    - **Kernel status** `VRFILLET_NO_EFFECT`: set by the `@opFillet` built-in, not by the wrapper. The wrapper *clears* it when `defaultsChanged` is false (l.504–511). So a wonky built-in that finds a variable-radius request with no effect should report this status, and the wrapper logic decides visibility.
  - **Measurement and radius parameters** (DOCUMENTED, `fillet.fs` l.160–195 and `edgeBlendCommon.fs` in the FS 3083 mirror https://github.com/yepher/feature_script_std, cloned at `tmp/research/onshape-std-3083/repo`, HEAD `18e5c7f`, 2026-09-22):
    - `filletType` ∈ {`EDGE`, `FULL_ROUND`}.
    - `blendControlType` ∈ {`RADIUS`, `WIDTH`}. The help defines Width as "distance between the two ends of the fillet (a constant width)".
    - With `RADIUS`: `radius` for the `CIRCULAR` cross-section (the only parameter with `UIHint.CAN_BE_TOLERANT`), but `nonCircularRadius` for `CONIC` and `CURVATURE`. With `WIDTH`: `width`.
    - **Asymmetric** (`asymmetricFilletOption`, only with `RADIUS`): `isAsymmetric`, `otherRadius` ("Second radius"), `flipAsymmetric`. Variable-fillet vertex and point settings carry `vertexOtherRadius` / `pointOnEdgeOtherRadius` and matching flips.
    - Bounds (`valueBounds.fs`): `BLEND_BOUNDS` = [1e-5 m, default 0.005 m, 500 m], so the minimum radius is 0.01 mm. `VR_BLEND_BOUNDS` allows 0 at variable-radius vertices. `FILLET_RHO_BOUNDS` = [0, default 0.5, 0.99999], used for both `rho` and `magnitude`.
    - Tolerant radius: when the radius carries a tolerance, the wrapper calls `setDimensionedEntities(... ToleranceSchemaClass.FILLET_RADIUS)`. This confirms the tolerance is a dimension annotation on the created faces, not a geometric fallback.
  - The help describes **Smooth fillet corners** as creating "rounded vertices between filleted edges", with an exclusion list. That is a vertex-blend request. DOCUMENTED: https://cad.onshape.com/help/Content/fillet.htm (fetched 2026-09-24).
- **Chamfer** (`opChamfer`, `geomOperations.fs` ~l.265–287; `chamfer.fs`):
  - `chamferType`:
    - `EQUAL_OFFSETS` (`width`)
    - `TWO_OFFSETS` (`width1`, `width2`, `oppositeDirection`)
    - `OFFSET_ANGLE` (`width`, `angle`, `oppositeDirection`)
  - `tangentPropagation`: the feature UI defaults to true, but the precondition default map says `tangentPropagation : false`.
  - `chamferMethod` defaults to `FACE_OFFSET`.
    - The enum has exactly two values, `FACE_OFFSET` (UI name "Offset") and `APEX_RANGE` (UI name "Tangent"). DOCUMENTED: `chamfermethod.gen.fs` in the mirror, https://github.com/javawizard/onshape-std-library-mirror/blob/without-versions/chamfermethod.gen.fs
    - The help defines them as follows (DOCUMENTED: https://cad.onshape.com/help/Content/chamfer.htm):
      - **Offset** measures the distance "from the starting edge to the chamfer" and is "edge dependent".
      - **Tangent** measures it "from the intersection of the tangent of the two adjacent faces" and is "NOT edge dependent".
    - INFERRED mapping to kernel definitions, checked against the ACIS and Parasolid docs (see the ACIS blending note):
      - `FACE_OFFSET` corresponds to the Parasolid/ACIS-R10 "offset the supports by the range, intersect, project" definition. For faces meeting at 90° this equals the distance along each face.
      - `APEX_RANGE` corresponds to the ACIS-R17 standard-chamfer "in-support distance from the edge" definition.
      - Both give the same result for planar faces at 90°. They diverge for other angles and for curved supports.
    - `chamfer.fs` l.94–101: for Part Studios older than `V2211_CHAMFER_IMPROVEMENTS`, the combination `FACE_OFFSET` + asymmetric type + `directionOverrides` only reports the info `CHAMFER_HELD_BACK`, meaning the overrides are not applied. Sheet metal accepts only `FACE_OFFSET` (l.130–132).
    - Wonky must implement both measurement modes, or reject `APEX_RANGE` explicitly.
  - `directionOverrides` sets the per-edge side for asymmetric types.
  - The feature calls `verifyNoMesh` first, so mesh bodies are rejected.
  - Errors: `CHAMFER_SELECT_EDGES`, `CHAMFER_HELD_BACK`.
- **Face blend** (https://cad.onshape.com/help/Content/face-blend.htm; `opFaceBlend` ~l.640–677):
  - Two face sets (`side1`, `side2`) that need not be adjacent, each with a flip arrow.
  - Propagation: off, tangent ("extends to all tangent faces"), adjacent ("extends to all adjacent faces"), or custom (faces below a specified maximum angle).
  - Cross section: **rolling ball** (default) or **swept profile** (profile perpendicular to a spine, which is a part or sketch edge). Tangent propagation is disabled with swept profile.
  - Measurement: radius, or width ("constant width" between the blend ends).
  - Asymmetric: a second radius (with Radius) or a ratio (with Width). Not combinable with tangent hold lines.
  - Control: circular, conic (rho), curvature (magnitude) or chamfer.
  - Tangent hold lines and inverse tangent hold lines. Conic hold lines. Cliff edges.
  - Caps: face or plane. Limits: planes, faces, edges with side. A "help point" keeps the blend nearest to it.
  - Trim (help definitions):
    - **Walls**: blend from the edge walls of both sides.
    - **Short**: the shortest possible blend between the side walls.
    - **Long**: the longest possible blend between the side walls.
    - **No trim**: the blend goes beyond the walls.
    - Long and No trim are meant for support surfaces that the user trims manually.
  - Detached output "resolves self-intersecting surface errors".
  - Hold lines and cliff edges must be existing face edges, so users split faces first.
- **Shell** (`shell.fs`, 62 lines; `opShell` ~l.1490–1502):
  - `opShell` hollows "with uniform thickness".
  - Positive thickness shells outward, negative inward. The feature flips the sign unless `oppositeDirection` is set, so the UI default is inward.
  - `isHollow` hollows parts without opening faces.
  - Errors: `SHELL_SELECT_PARTS`, `SHELL_SELECT_FACES`.
- **Offset face / Move face** (`opOffsetFace` ~l.1200–1215): `offsetDistance` along the normal. `reFillet` means "attempt to defillet `moveFaces` prior to the offset and reapply the fillet after". `mergeFaces` defaults to true.
- **Thicken** (`opThicken` ~l.1801): `thickness1` and `thickness2` on both sides of a surface.
- **Kernel attribution**:
  - The built-ins run on Onshape's servers. HEARSAY: Onshape is widely reported to license Siemens **Parasolid**, e.g. it appears in the "Notable uses" list at https://en.wikipedia.org/wiki/Parasolid (marked "citation needed").
  - Onshape's tolerances elsewhere in FS match Parasolid session precision. HEARSAY, see the Parasolid XT note.
  - Treat Onshape's fillet behaviour as "what Parasolid does".

## Robustness and guarantees

- The documentation gives no geometric guarantees. It states failure modes:
  - DOCUMENTED at https://cad.onshape.com/help/Content/fillet.htm: a fillet "too large for the selected edge or face" produces an error with a visual indication.
  - "Tolerant" radius UI hints (`UIHint.CAN_BE_TOLERANT`, `TOLERANT_RADIUS_*` errors) let a feature carry a tolerance on the radius value. DOCUMENTED in `fillet.fs`/`chamfer.fs`. INFERRED: this is a manufacturing annotation (±), not a geometric fallback.
- The `VRFILLET_NO_EFFECT` / `CHAMFER_HELD_BACK` infos show Onshape reports "operation had no effect" instead of silently succeeding. DOCUMENTED in `fillet.fs`, `chamfer.fs`. This is good precedent for wonky's explicit-failure policy.
- Behaviour is **version-pinned**: every Part Studio stores the FS version it was built with, and wrappers branch on `isAtVersionOrLater`. DOCUMENTED: `chamfer.fs`. INFERRED: wonky must decide which version semantics its interpreter emulates, and the fillet/chamfer defaults changed across versions.

## Parallelism and performance

Nothing is documented. Everything runs server-side. The FS wrappers are sequential coordination around single built-in calls. INFERRED.

## Known failures, limitations, war stories

- Full round works only across one contiguous set of center faces. DOCUMENTED: https://cad.onshape.com/help/Content/fillet.htm
- In sheet metal, users are told to use corner break instead of fillet or chamfer (`SHEET_METAL_CHAMFER_OPTIONS_USE_CORNER_BREAK`). DOCUMENTED: `chamfer.fs`, https://cad.onshape.com/help/Content/fillet.htm
- Face blend needs "detached" mode to get past self-intersecting blend surfaces. This is an admission that the rolling-ball surface can self-intersect (radius > local curvature radius) and that the kernel then gives up on attaching. DOCUMENTED: https://cad.onshape.com/help/Content/face-blend.htm
- Tangent propagation is disabled for swept-profile face blends. Asymmetric blends are not combinable with tangent hold lines. DOCUMENTED: https://cad.onshape.com/help/Content/face-blend.htm
- Onshape community threads report that fillets fail where edge chains end at vertices of ≥3 blended edges and are fixed by `smoothCorners` or by reordering features. HEARSAY, not verified in this pass. A typical forum area is https://forum.onshape.com/

## Relevance for wonky

The interpreter contract, INFERRED from the above:

1. **Accept the full parameter maps** for `opFillet`, `opChamfer`, `opShell`, `opOffsetFace`, `opThicken`, `opFaceBlend` and `opFullRoundFillet`. Unknown keys must not crash.
2. **Implement a strict subset first:**
   - Fillet: `CIRCULAR`, constant radius, with or without tangent propagation, `allowEdgeOverflow` treated as false (see point 3).
   - Chamfer: all three types, `FACE_OFFSET`.
   - Shell: inward and outward, removed faces, `isHollow`.
   - Offset face and thicken on planes, cylinders and cones. These offsets are exact, see the Patrikalakis note.
3. **Throw an explicit `regenError`** (reusing Onshape's enum names) for:
   - `CONIC`, `CURVATURE`, `isVariable`, `partialFilletBounds`, `smoothCorners`
   - `isAsymmetric`: the help does not define the cross-section of an asymmetric circular fillet. INFERRED: for plane/plane it is not a circular arc (a conic, so an elliptic-cylinder face), and wonky has no elliptic-cylinder surface yet.
   - `blendControlType: WIDTH` except on plane/plane edges. INFERRED derivation: faces meeting at interior angle α have ball contacts subtending π − α at the centre, so chord width w = 2r·cos(α/2), i.e. r = w / (2cos(α/2)). This is constant along a straight plane/plane edge (an exact cylinder), but varies wherever α varies along the edge (curved supports), which turns the request into a variable-radius blend. The ACIS ABL "fixed width" radius law is the same concept (see the ACIS blending note).
   - `opFaceBlend`, `opFullRoundFillet`, `createDetachedSurface`
   - `reFillet`
   - any case where the ball does not fit

   This keeps Marc's FS models portable: they either regenerate identically or fail loudly.
4. `allowEdgeOverflow = true` (the default) means Parasolid may change neighbouring edges ("overflow") so the ball's profile survives. Wonky should either implement that or report explicitly that overflow was needed. It must never silently produce a different shape.
5. **FDM-first priorities:**
   - Chamfers matter as much as fillets. A 45° chamfer on down-facing edges avoids overhangs, and fillets on vertical edges are common.
   - Plane/plane circular fillets are exact cylinders, chamfers are exact planes and plane/cylinder cases give tori. So the first milestone needs no approximated surfaces at all. INFERRED.
6. Reuse the MIT-licensed wrapper logic (`fillet.fs`, `chamfer.fs`, `shell.fs`) essentially verbatim in wonky's FS prelude, with the built-ins mapped to Bend operations.

## Pointers worth porting or studying

- `geomOperations.fs` doc blocks for `opFillet`, `opChamfer`, `opShell`, `opOffsetFace`, `opThicken`, `opFaceBlend`, `opFullRoundFillet`, `opModifyFillet`: the exact parameter schema.
- `fillet.fs`: partial and variable fillet parameterisation, and the list of error enums.
- `chamfer.fs`: `directionOverrides` and version gates.
- `shell.fs`: sign convention (inward by default via the flip).
- The face-blend help page: the vocabulary for later (hold lines, cliff edges, caps, trims). It is a good spec of what a full-featured blend engine exposes.

## Verdict: adopt

- **Adopt the interface.** Wonky's frontend is Onshape FeatureScript, so these parameter maps, defaults and error enums are the API wonky must honour. The MIT-licensed wrapper code can be reused.
- **Do not adopt the implementation.** The geometry sits behind `@op*` built-ins (Parasolid per hearsay) and is unreachable.
