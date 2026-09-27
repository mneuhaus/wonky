# Onshape REST API: Part Studio mass properties and rollback

- Kind: official vendor API documentation plus the machine-readable OpenAPI spec. Canonical: [Part Studios API guide](https://onshape-public.github.io/docs/api-adv/partstudios/). Also read: [OpenAPI spec served to the Glassworks explorer](https://cad.onshape.com/api/openapi) (captured 2026-09-24, `info.version` 1.221.89339), [Glassworks API Explorer](https://cad.onshape.com/glassworks/explorer/), [Evaluating FeatureScript guide](https://onshape-public.github.io/docs/api-adv/fs/), [API Limits](https://onshape-public.github.io/docs/auth/limits/), [Mass properties help](https://cad.onshape.com/help/Content/massprops-ps.htm), [FeatureScript std library reference](https://cad.onshape.com/FsDoc/library.html), [Parasolid session precision chapter (q-solid mirror)](http://www.q-solid.com/Parasolid_Docs/chapters/fd_chap.05.html).
- Organization: Onshape (PTC). Current API path version in the guide: v9; the FS guide still shows v6/v8 URLs. Both resolve to the same operations.
- License: commercial SaaS. The OpenAPI JSON declares an Apache-2.0 specification licence, which does not license the service or source models. Nothing is ported; frozen outputs are independent test fixtures.
- Status: actively maintained commercial API; OpenAPI spec updated with each release. Local artifacts: `tmp/research/onshape-rest-api-part-studio-mass-properties-and-rollback/` (`current-openapi.json`, `partstudios.html`, `fs-guide.html`, `limits.html`, `massprops-ps.htm`, `fsdoc-library.txt`, `ps-fd_chap05.html`).

## What it is

A REST surface over Onshape's Part Studio regeneration (Parasolid kernel underneath, running the same FeatureScript std library that wonky interprets). For kernel testing, the relevant read-only operations are:

| operationId | Path (wvm = w/v/m) | Rollback aware | Oracle use |
|---|---|---|---|
| getPartStudioMassProperties | GET `/partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/massproperties` | yes, `rollbackBarIndex` query | volume, area ("periphery"), centroid, inertia, principal axes, **with lower/upper bounds** |
| evalFeatureScript | POST `/partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/featurescript` | yes | arbitrary read-only FS lambda: tight `evBox3d`, `evVolume` with accuracy, `evApproximateMassProperties` with explicit density, `qCount`-style topology counts, surface-type census |
| getPartStudioBodyDetails | GET `.../bodydetails` | yes | faces/edges/vertices with surface & curve types and geometric data (`includeGeometricData`) |
| getPartStudioFeatures | GET `.../features` | yes | feature list plus `featureStates[fid].featureStatus` (OK/INFO/WARNING/ERROR) |
| getPartStudioFaces / getPartStudioEdges | GET `.../tessellatedfaces`, `.../tessellatededges` | yes | tessellation with `chordTolerance`/`angleTolerance` for Hausdorff-style comparison |
| exportParasolid | GET `.../parasolid` | no | frozen reference B-rep (x_t) for offline study; parsing it is wonky's job |
| comparePartStudios | GET `.../compare` | no | Onshape's own diff (`BTRootDiffInfo`: changes, geometryChangeMessages) between workspace/version/microversion |
| updateRollback | POST `/partstudios/d/{did}/w/{wid}/e/{eid}/features/rollback` body `{"rollbackIndex": n}` | writes | moves the visible bar in a *workspace*; not needed for oracles |

All **DOCUMENTED** from `current-openapi.json` (paths and parameter lists) and the guide pages.

## How it works

**Mass properties response (DOCUMENTED, schema `BTMassPropertiesBulkInfo` / `BTMassPropertiesInfo`):** `{microversionId, bodies: {"-all-" | partId: {mass[], volume[], periphery[], centroid[], inertia[], principalInertia[], principalAxes[], hasMass, massMissingCount}}}`. Values are SI (m, m², m³, kg, kg·m²). The operation description states that *when three values are returned, the first is the calculated value, the second the minimum and the third the maximum possible value considering tolerance*. So the order is **[nominal, min, max]**, not [min, mean, max] (Marc's jarvis MCP tool description says [min, mean, max]; that is wrong per the spec and the worked example). Centroid is 9 numbers: nominal xyz, min xyz, max xyz. Inertia is 3×3 nominal, then min and max matrices (27 numbers). Query parameters: `rollbackBarIndex` (int, default −1 = end of list), `configuration`, `elementMicroversionId`, `partId[]`, `massAsGroup` (default true: selected parts as one object), `useMassPropertyOverrides` (default false).

**Worked example in the guide (DOCUMENTED numbers, INFERRED percentages computed by me):** volume 3.29029e-6 m³ (3290.29 mm³) with bounds ±6.61e-4 relative; area 2591.11 mm² ±2.40e-4 relative; centroid y 17.967 mm ±0.0327 mm; density 7850 kg/m³ (steel). The bounds are symmetric. So the REST oracle is an **interval**, and its width at default accuracy is ~0.07% on volume and ~33 µm on centroid for a 3 cm³ part. That is looser than F32x2 arithmetic but tight enough to catch topological Boolean mistakes (a missing pocket, a lost cap face, an inverted shell).

**Materials gate (DOCUMENTED):** the operation description says "Parts must have density"; the help page says parts without a material are omitted and, if none have a material, *no calculation is made* (`hasMass`, `massMissingCount` report this). Marc's FDM FeatureScript models usually have no material. Whether volume is still populated then is not documented (jarvis tool text claims volume is always meaningful: **HEARSAY**). Workaround with no ambiguity: use `evalFeatureScript` and pass density explicitly, see below.

**evalFeatureScript (DOCUMENTED):** body `{"script": "function(context is Context, queries) { ... }", "libraryVersion"?: n}`; only lambdas are allowed. Response `BTFeatureScriptEvalResponse-1859`: `result` (typed `BTFSValue` tree), `console`, `notices`, `sourceMicroversion`, `microversionSkew`, `libraryVersion`. It honours `rollbackBarIndex` and `elementMicroversionId`. Relevant std functions (FsDoc):
- `evVolume(context, {entities, accuracy: VolumeAccuracy.LOW|MEDIUM|HIGH})`; the enum doc says HIGH is "slowest, most accurate, required for regeneration".
- `evApproximateMassProperties(context, {entities, density, referenceFrame?})` returns `{mass, centroid, inertia, volume|area|length|count}`; density is an argument, so no material is needed. Doc warns the values are approximate and may change between versions.
- `evArea`, `evLength`, `evBox3d(context, {topology, tight: true})`. The FS guide warns that `getPartStudioBoundingBoxes` is **not tight** ("meant for graphics and visualization, and are approximate") and shows the tight `evBox3d` lambda instead.
- Topology census via `size(evaluateQuery(context, qOwnedByBody(b, EntityType.FACE)))` etc., and surface types via `evSurfaceDefinition`.
One POST per rollback index can therefore return the whole per-feature fingerprint (volume HIGH, area, tight box, centroid/inertia at density 1, V/E/F counts per body, surface-type histogram) in a single call.

**Rollback semantics (DOCUMENTED + INFERRED):** `rollbackBarIndex=-1` evaluates the full list. The features response carries a top-level `rollbackIndex`; the guide example returns `rollbackIndex: 4` for a list whose last bar position is the end. INFERRED: index n means "evaluate features [0, n)", so stepping n = 1..N yields the per-feature state. Using the **query parameter** on read endpoints is read-only and works on immutable versions/microversions (`/m/{mid}`); `updateRollback` mutates a workspace and is only needed to show the bar in the UI. Pin every oracle call to `/m/{microversionId}` so it is reproducible, and record `sourceMicroversion`/`microversionId` from the response.

**Kernel tolerance behind the numbers (DOCUMENTED):** Onshape's std library `math.fs` defines `TOLERANCE = {zeroAngle: 1e-11, zeroLength: 1e-8, g1Angle: 0.1°, booleanDefaultTolerance: 1e-5 /*meter*/, computational: 1e-13}` (`tmp/research/onshape-std-3083/repo/math.fs:35-42`). FS works in meters internally, so zeroLength = 1e-5 mm = 10 nm and the default tolerant Boolean tolerance = 0.01 mm. Parasolid's session precision is 1.0e-8 units, angular 1.0e-11; edges/vertices without local precision are "exact" with **half** the session precision (5e-9 m = 5e-6 mm, which is where the brief's "5e-6 mm" figure comes from); imported or B-surface-heavy results may carry larger *local* (tolerant) precision ([fd_chap.05](http://www.q-solid.com/Parasolid_Docs/chapters/fd_chap.05.html)). INFERRED: comparisons must use max(Onshape interval, per-edge tolerance, wonky's declared error), never bit equality.

**Limits (DOCUMENTED, [limits page](https://onshape-public.github.io/docs/auth/limits/)):** per-endpoint rate limits (HTTP 429) plus **annual** call quotas: Enterprise 10,000 per full user; Professional 5,000 per user; Standard/Free/EDU Student 2,500 per user; Pro Discovery 2,500 per company. Exceeding the annual quota yields HTTP 402. API-key calls and private OAuth apps count (2xx/3xx only); calls made by the Onshape browser/mobile clients or the API Explorer under an Onshape *session* do not.

## Robustness and guarantees

- DOCUMENTED: mass properties are approximate, with accuracy depending on geometry complexity; bounds are exposed so the caller can reason about them (help page, "Show calculation variance").
- DOCUMENTED: `evApproximateMassProperties` and `evApproximateCentroid` carry a warning that the approximation may change between releases. So golden values must record `libraryVersion` and the capture date.
- DOCUMENTED: `rejectMicroversionSkew`/`microversionSkew` expose whether the evaluation ran on the requested microversion.
- Not guaranteed: that Parasolid's answer is *correct*. It is a strong reference, not ground truth. Disagreements need triage by a third signal (closed-form value, metamorphic relation, or wonky's own exact predicate).
- Not guaranteed: identical std-library behaviour across versions. wonky pins FS version via `import(path:"onshape/std/geometry.fs", version:"3044.0")`; Onshape evaluates the document at its own pinned std version, which must match the fixture's import line (INFERRED).

## Parallelism and performance

No published latency numbers. INFERRED from

## Known failures, limitations, war stories

- `getPartStudioBoundingBoxes` is not tight (DOCUMENTED in the FS guide). Use `evBox3d(tight: true)`.
- Mass properties need materials; FDM parts typically have none (DOCUMENTED gate, HEARSAY about partial output).
- The value order [nominal, min, max] is easy to misread; one local tool already documents it wrongly (DOCUMENTED spec vs jarvis tool text).
- `updateRollback` changes shared workspace state and could trip up a concurrent user session; avoid it for testing (INFERRED).
- Mass properties endpoint excludes sketches/surfaces from volume; bodies of lower dimension report area/length instead (DOCUMENTED for `evApproximateMassProperties`: "Only entities of the highest dimensionality will be considered").

## Relevance for wonky

- **Testing (primary):** wonky interprets *unmodified* Onshape FeatureScript, so the same `.fs` source evaluated on Onshape is the closest available reference oracle: same program, same std library, industrial kernel. Per-feature fingerprints from rollback stepping turn one end-to-end mismatch into "first diverging feature k", which is exactly the triage Marc needs for Boolean and fillet failures. INFERRED.
- **Fits the project rules:** nothing is linked; oracle values are captured once through the existing session bridge into frozen JSON fixtures with provenance (document, microversion, libraryVersion, capture time, sha256, metering before/after), mirroring `fixtures/r10b/provenance.json` and `modules.json`. Evaluation stays offline ("Die Auswertung benötigt keine Onshape-Verbindung", README).
- **Numeric mapping:** Onshape returns f64 SI values. Store them as decimal strings; compare in the JS test harness (tests are not production geometry) after converting wonky's F32x2 results to mm. For the comparison predicate use intervals: pass if [w − ε_w, w + ε_w] overlaps [min, max] widened by Parasolid's precision (1e-5 mm linear, scaled for area/volume). ε_w comes from wonky's own `precision`/`exactness` metadata. INFERRED.
- **Checker cross-validation:** `bodydetails` surface/curve types and V/E/F counts per rollback point give topology oracles; `featureStatus` gives "Onshape also errors here" signals for the explicit-failure rule (wonky may fail where Onshape succeeds, but must not *silently* differ).
- **Diff:** `comparePartStudios` is a reference for what Onshape considers a geometric change between microversions; useful to calibrate wonky's diff/review viewer (see sibling notes on microversions and associativity).
- **FDM:** interval widths (~33 µm centroid, ~0.07% volume at default accuracy) are far below FDM print tolerance (~0.1–0.2 mm), so the oracle is strict enough for print-relevant regressions but not for sub-micron kernel numerics. Use closed-form values and exact predicates for the latter.

## Pointers worth porting or studying

1. `current-openapi.json` operations `getPartStudioMassProperties`, `evalFeatureScript`, `getPartStudioBodyDetails`, `getPartStudioFeatures`, `comparePartStudios`; schemas `BTMassPropertiesInfo`, `BTFeatureScriptEvalResponse-1859`, `BTRootDiffInfo`, `BTSetFeatureRollbackResponse-1042`.
2. Oracle lambda to POST per rollback index (sketch; untested):
   `function(context is Context, queries) { var out = []; for (var b in evaluateQuery(context, qBodyType(qEverything(EntityType.BODY), BodyType.SOLID))) { const mp = evApproximateMassProperties(context, {"entities": b, "density": 1 * kilogram / meter ^ 3}); out = append(out, {"volHigh": evVolume(context, {"entities": b, "accuracy": VolumeAccuracy.HIGH}), "area": evArea(context, {"entities": qOwnedByBody(b, EntityType.FACE)}), "box": evBox3d(context, {"topology": b, "tight": true}), "centroid": mp.centroid, "inertia": mp.inertia, "F": size(evaluateQuery(context, qOwnedByBody(b, EntityType.FACE))), "E": size(evaluateQuery(context, qOwnedByBody(b, EntityType.EDGE))), "V": size(evaluateQuery(context, qOwnedByBody(b, EntityType.VERTEX)))}); } return out; }`
   Body order is not stable across kernels; match bodies by volume/box, not index.
3. `scripts/snapshot-r10b-modules.mjs` in wonky: reuse its request log, `x-rate-limit-remaining` guard, cache-if-exists, microversion pinning and metering check for an `snapshot-onshape-oracle.mjs`.
4. Onshape std `math.fs` `TOLERANCE` block (lines 35-42 of the 3083 snapshot) for the tolerance constants the std library itself uses.
5. Parasolid fd_chap.05 §4.3 on local precision ("edges as tubes, vertices as spheres") for how to widen tolerances on tolerant edges.

## Verdict: adopt

Adopt as an **offline, frozen, interval-valued reference oracle** for FeatureScript fixtures: capture per-rollback fingerprints once via `evalFeatureScript` (density passed explicitly, `evVolume` HIGH, tight `evBox3d`, counts), pin to microversion and library version, store with provenance, and compare with interval overlap. Do not use `updateRollback`, the non-tight bounding-box endpoint, or the materials-gated mass-properties endpoint for FDM parts without materials; never run it in CI or treat Parasolid's answer as ground truth.

