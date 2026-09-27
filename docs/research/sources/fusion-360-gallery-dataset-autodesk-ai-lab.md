# Fusion 360 Gallery Dataset (Autodesk AI Lab)

- Kind: dataset (three subsets: Reconstruction, Segmentation, Assembly/Joint) plus Python tools that run inside Autodesk Fusion 360 ("Fusion 360 Gym", reconverter, regraph). Canonical: https://github.com/AutodeskAILab/Fusion360GalleryDataset . Main paper: Willis et al., "Fusion 360 Gallery: A Dataset and Environment for Programmatic CAD Construction from Human Design Sequences", ACM TOG 40(4), Article 54 (SIGGRAPH 2021), arXiv https://arxiv.org/abs/2010.02392 (v1 2020-10-05, v2 2021-05-17; local PDF `tmp/research/pdf/willis-2021-fusion360-gallery-2010.02392.pdf`). Segmentation: BRepNet, CVPR 2021, https://arxiv.org/abs/2104.00706 . Assembly: JoinABLe, https://arxiv.org/abs/2111.12772 .
- Downloads (DOCUMENTED, README; still HTTP 200 on 2026-09-24, S3 `Last-Modified` 2021-12-03): reconstruction `r1.0.1.zip` 2,103,449,157 bytes; `r1.0.1_extrude_tools.zip` 159,352,814 bytes; segmentation `s2.0.1.zip` 3.1 GB, `s2.0.1_extended_step.zip` 506 MB; assembly joint `j1.0.0.7z` 2.8 GB.
- Authors/organization: Karl D.D. Willis, Yewen Pu, Jieliang Luo, Hang Chu, Joseph G. Lambourne (Autodesk Research), Tao Du, Armando Solar-Lezama, Wojciech Matusik (MIT). 2020-2021.
- License: **custom, non-commercial research only** (`LICENSE.md`, updated 11/2021; GitHub shows NOASSERTION), DOCUMENTED:
  - (1) use/modify "only for non-commercial research purposes";
  - (2) no redistribution of the dataset in its entirety (point people to the GitHub page instead);
  - (3) portions or modifications may be redistributed only if marked as such, kept non-commercial, and the restrictions and indemnity terms are passed downstream;
  - (4) no re-identification of creators;
  - (8) the user indemnifies Autodesk;
  - (9) Autodesk may terminate at any time;
  - (11) "If you are employed by a for-profit, commercial entity, your employer shall also be bound";
  - California law.

  Implications for wonky (INFERRED, not legal advice): use it only as an *external, uncommitted* test corpus, downloaded to a cache outside the git tree (e.g. `tmp/` or `~/datasets`). Do **not** commit JSON/STEP/OBJ files or derived fixtures (a "Modified Set" inherits the non-commercial and indemnity terms). Do not use it for commercial work; clause 11 also binds the user's employer. Hand-written fixtures that merely reproduce a *pattern* observed in the data (for example "plate + cylinder boss join") are ordinary engineering knowledge and not dataset copies. `docs/cadbench.md` already flags this license.
- Status (DOCUMENTED, `gh api`, 2026-09-24): repo created 2020-03-11, last push 2022-04-23 ("Add JoinABLe code link"), 741 stars, 89 forks, 8 contributors, 16 open issues. Issues from 2023-2025 are mostly unanswered, so the dataset is maintained only as a static release. The code is Python against the Fusion 360 API (`adsk.core`/`adsk.fusion`) and needs the Fusion desktop app.
- Local copy: sparse clone (docs, `tools/common`, gym server/client, reconverter, testdata JSON/STEP) at `tmp/research/fusion-360-gallery-dataset-autodesk-ai-lab/`. The dataset zips were not downloaded; only their zip central directories were read via HTTP range requests (15.7 MB + 8.5 MB) to count files.

## What it is

About 20,000 designs from the public Autodesk Online Gallery were parsed from native `.f3d` files. The **Reconstruction** subset keeps only *sketch* and *extrude* features, which are the most common operations: used in 84% and 79% of designs, ">3x more common than operations such as fillet and chamfer" (paper sec. 3). Every other feature is **suppressed**; for example, fillets are removed from the history. Multi-component assemblies are split into parts. Each design was **re-played in Fusion and compared to the original**, and failures were dropped (appendix A.1.1). That makes every sequence known-replayable in ASM (Autodesk Shape Manager, Fusion's ACIS-derived kernel). Duplicates, about 5,000, were removed with a signature: "body count, face count, surface area to one decimal point, volume to one decimal point, and for each extrude ...: profile count, body count, face count, side/end/start face counts" (A.1.1). The result is 8,625 sequences with an official 80:20 train/test split (6,900 / 1,725, `train_test.json`).

**Counts verified from the zip central directory (DOCUMENTED by me, 2026-09-24):**
- `r1.0.1.zip` holds 120,461 entries: 8,626 `.json` (8,625 designs + `train_test.json`), and 27,958 each of `.step`, `.smt`, `.obj`, `.png`. Of the STEP files, 8,625 are final designs and 19,333 are per-extrude snapshots (`XXXXX_YYYYYYYY_ZZZZ_NNNN.step`).
- `r1.0.1_extrude_tools.zip` holds 19,333 each of `.step`, `.smt`, `.obj`: "the extrude volumes for each extrude operation", i.e. the **tool body before the Boolean** (`..._NNNNe.step`).
- 19,333 matches the operation totals the maintainer gave: NewBody 10,304, Join 4,711, Cut 4,299, Intersect 19 (https://github.com/AutodeskAILab/Fusion360GalleryDataset/issues/66).

## How it works (data model)

**Construction JSON** (`docs/reconstruction.md`; units **cm** and radians):
- `timeline[]`: `{index, entity uuid}`.
- `entities{uuid}` is either a `Sketch` or an `ExtrudeFeature`.
- `sequence[]` interleaves individual curves and extrudes, and names the per-step `png/smt/step/obj` snapshot files.
- `metadata`.
- `properties` of the final design: `bounding_box`, `vertex_count`, `edge_count`, `face_count`, `loop_count`, `shell_count`, `body_count`, `area`, `volume`, `density`, `mass`, `center_of_mass`, `principal_axes`, `xyz_moments_of_inertia` (`xx, yy, zz, xy, yz, xz`), a `surface_types` histogram and a `vertex_valence` histogram (seen in `tools/testdata/Couch.json`).

**Sketch:**
- `points{uuid: Point3D}` in the sketch-local frame (z = 0).
- `curves{uuid}` of type `SketchLine` / `SketchArc` / `SketchCircle` / `SketchEllipse` / `SketchEllipticalArc` / `SketchFittedSpline` / `SketchFixedSpline` / `SketchConicCurve`, with a `construction_geom` flag.
- `constraints` (18 Fusion types: coincident, horizontal, tangent, symmetry, ...).
- `dimensions` (with `ModelParameter` values).
- `transform` (origin plus x/y/z axes: the sketch-to-world coordinate system).
- `reference_plane`, which is one of: a construction plane by name (XY/YZ/XZ), a `BRepFace` **identified by `point_on_face`**, or another sketch `Profile`.
- `profiles{uuid}` carry `loops[] {is_outer, profile_curves[]}` with **explicit trimmed** `Line3D`/`Arc3D`/`Circle3D`/... geometry. An Arc3D has center, radius, normal, reference_vector, start/end angle (`tools/common/serialize.py`). Each profile also has `properties {area, perimeter, centroid}`.

**Extrude:**
- `profiles[] {profile, sketch}` (several profiles per extrude allowed).
- `operation`: NewBody / Join / Cut / Intersect.
- `extent_type`: OneSide / Symmetric (with `is_full_length`) / TwoSides.
- `extent_one/two {distance (signed), taper_angle}`: all extents are `DistanceExtentDefinition`, never "up to face" (`sketch_extrude_importer.py:788-883`).
- `start_extent`: ProfilePlane or Offset.
- `faces{uuid: {index, surface_type, point_on_face}}` and `bodies` for **all** faces/bodies at that step.
- `extrude_faces`, `extrude_side_faces`, `extrude_start_faces`, `extrude_end_faces`: the per-extrude **face provenance labels**.

**Replay algorithm in the official importer** (`tools/common/sketch_extrude_importer.py`, DOCUMENTED):
1. Draw the raw sketch curves.
2. Let Fusion auto-detect regions.
3. **Match** each stored profile to a detected region by an identical sorted set of source-curve uuids **and** area, perimeter and centroid within `abs_tol = 1e-6` (cm) (`find_profile`, `are_profile_properties_identical`, lines 184-221).
4. If that fails, fall back to the region with the most overlapping curve ids (`get_closest_profile`).
5. Sketches on faces use a corrective transform `T_correction = T_import^-1 * T_extract`, because "sketch geometry created via the UI has a slightly different coordinate system than when created via the API" (`find_transform_for_sketch_geom`, lines 265-300).
6. Symmetric extents are replayed as two-sided extents because the Fusion API's "symmetric extent is currently buggy when a taper is applied" (lines 858-883).

**Gym/evaluation** (`tools/common/geometry.py:133-250`): IoU = intersect volume / union volume, computed in Fusion with pairwise temp-BRep unions and interference analysis. A heuristic decides containment via one `pointContainment(tool.faces[0].pointOnFace)` probe and treats "volume unchanged within `app.pointTolerance`" as no overlap. The paper counts "exact reconstruction" as IoU = 1 and itself warns that "incorrect reconstructions can score well with the IoU metric, but omit important design details", e.g. small holes (sec. 6.5).

**Statistics (DOCUMENTED, paper sec. 3, 7.1, appendix Figs. 21-28; percentages read from bar charts are approximate):**
- About 88% of designs have 1 body, and the face count peaks at 5-10 per design.
- Sequence length (sketch + extrude steps): mean 4.74, median 4, mode 2, max 61. 3,267 of 8,625 designs (38%) have a single extrude.
- Curves: lines about 70%, circles about 14%, arcs about 11%, fitted splines about 4% ("Line, arc, and circle represent 95% of curves").
- Curve combinations per design: C, ACL, CL, L and AL together cover roughly 90% of designs without any spline.
- Extrude types: OneSide about 16.9k, Symmetric about 1.9k, TwoSides about 0.6k, tapered about 0.15k.

**Numeric quirk found in the test data (DOCUMENTED pattern, INFERRED cause):** in `tools/testdata/Couch.json` all 28 non-zero sketch coordinates are exactly `round_value * (1 + 2^-26)`: 4.000000059604645, 3.0000000447034836, -2.500000037252903. That equals a millimetre value multiplied by `float32(0.1) = 0.10000000149011612`. Extrude distances (2.2, -1.2) are exact. The stored `volume` 25.860000770688064 = 25.86 * (1 + 2 * 1.49e-8) is consistent with two biased in-plane dimensions and one exact height. `Hexagon.json` mixes exact and biased values, and `SingleSketchExtrude.json` is exact. So lengths carry a systematic relative bias of about 1.5e-8, probably from a float32 unit conversion. "Should-coincide" geometry built from biased sketch coordinates and exact distances therefore disagrees at about 1e-8 relative.

## Robustness and guarantees

- Ground truth is "what ASM produced", validated by one replay per design in Fusion. It is not independently verified geometry. Profile matching in the reference importer itself needs a fuzzy fallback.
- The OBJ meshes are "not manifold" (each B-rep face is triangulated separately, with the face id as the group name; `docs/reconstruction.md`). So they are fine for sampled distance (Metro-style), not for volume.
- Face ownership follows ASM conventions: **coplanar faces merge** after a join, and the merged face "now belongs to the second extrude"; cuts **split** faces, so face sets per feature change along the timeline (maintainer, https://github.com/AutodeskAILab/Fusion360GalleryDataset/issues/71). Per-step face-role labels are Fusion's convention, not a universal truth.
- Step-level STEP/SMT export once altered the design (API needed a component), fixed in https://github.com/AutodeskAILab/Fusion360GalleryDataset/pull/65 . This is relevant if you distrust early snapshots (INFERRED).
- The segmentation subset has no construction sequences ("there isn't any sketch-extrude sequence information", https://github.com/AutodeskAILab/Fusion360GalleryDataset/issues/75). Linking segmentation to reconstruction requires re-running Fusion (https://github.com/AutodeskAILab/Fusion360GalleryDataset/issues/82).

## Parallelism and performance

No kernel performance numbers are relevant. The Gym runs Fusion instances as servers, and "multiple instances ... can be run in parallel" (appendix A.2). For wonky (INFERRED): each design is a sequential history, but the 8,625 designs are independent, so replay is embarrassingly parallel across designs (a balanced fork-join over the corpus, or process-level fan-out). Scale is modest: 19,333 extrude steps, most with fewer than 20 faces.

## Known failures, limitations, war stories

- Only sketch + extrude. Fillets/chamfers/revolves were suppressed, not kept as refusal cases. 38% of designs are single-extrude trivia (washers, plates).
- About 4% spline curves (B-spline surfaces after extrusion). Some tapered extrudes produce cones or inclined planes.
- IoU is a weak metric (paper sec. 6.5), so use distance plus mass properties.
- Face merge/split ambiguity for provenance labels (issue #71).
- Fusion-API frame quirks for sketches on faces (corrective transform) and the symmetric+taper API bug (see importer).
- "Only 59.2% can be directly converted to a face extrusion sequence" (issue #67). That concerns the Gym's face-to-face action space, not replay.
- The assembly data has its own open issues (#95, #106, #109), not relevant for kernel testing.

## Relevance for wonky

1. **Second labeled replay corpus for the planar/extrude subset, with a per-stage oracle (DOCUMENTED data, INFERRED plan).** Unlike DeepCAD (see note `deepcad-dataset-and-onshape-cad-parser`), every step has ground-truth outputs:
   - (a) profile area/perimeter/centroid, which tests wonky's sketch region detection and loop orientation;
   - (b) the **extrude tool body** (STEP), which tests extrude alone;
   - (c) the **post-Boolean snapshot** (STEP/SMT/OBJ), which tests the Boolean;
   - (d) final-design mass properties, topology counts, surface-type and vertex-valence histograms.

   This lets a failure be pinned to the first divergent stage.
2. **Boolean bake-off fuel:** about 9,029 real Join/Cut/Intersect cases as (before-snapshot, tool, result) triples with ASM results. Many are plate + cylinder boss/hole combinations, exactly the plane/cylinder class currently blocking wonky's general Boolean. Filter to lines/arcs/circles without taper for the current analytic set (planes, cylinders). Add tapered circles later as cones. Splines must fail explicitly as unsupported.
3. **Tolerance stress test:** because of the float32 unit-conversion bias (about 1.5e-8 relative, i.e. about 6e-7 mm at 40 mm), replays hit near-coincident but not-exactly-coincident faces and edges. wonky's default 1e-7 mm tolerances (`src/comparison.mjs`, `scripts/validate-step.py`) are **tighter than the data's own noise**. The converter must either declare an input-snapping policy (e.g. snap to 1e-6 mm, or undo the `float32(0.1)` factor when a value is within 1 ulp of a round decimal) or run with a larger, explicit modeling tolerance. Both behaviours are worth testing; this is exactly the class of input where exact-predicate kernels create slivers.
4. **Oracles:** compare wonky's results to per-step STEP via the existing OCCT test oracle (`scripts/validate-step.py`: volume, area, centroid, validity) and to the OBJ via a Metro-style sampled Hausdorff interval (see note `metro-measuring-error-on-simplified-surfaces-cignoni-rocchin`). Compare the JSON mass properties directly (convert cm to mm: lengths x10, areas x100, volumes x1000). Do not rely on IoU alone. Face/edge/vertex counts should be compared only modulo the merge-coplanar-faces convention, so either apply same-domain unification or compare post-unification counts.
5. **Naming/provenance:** `extrude_side/start/end_faces` per step, matched by `point_on_face`, is ground truth for "which feature created this face, in which role". This is directly comparable with wonky's topology provenance, provided the merge/split conventions are aligned (issue #71). Sketch planes on faces are referenced **by a point on the face**, which maps naturally to a FeatureScript `qContainsPoint`-style query. That makes it a realistic test of wonky's query resolution after Booleans.
6. **FeatureScript frontend and LLM ergonomics:** a host-side JSON-to-FeatureScript converter (data translation, not a geometry backend) yields thousands of human-authored, realistic FS programs. They are useful as LLM few-shot material only within the license terms (non-commercial, not redistributed) (INFERRED). Use the JSON `transform` (world frame) directly instead of replicating Fusion's UI-vs-API corrective transform.
7. **Secondary subsets:**
   - Segmentation: 35,680 STEP parts (plus 42,912 in the extended set) with per-face labels ExtrudeSide/End, CutSide/End, Fillet, Chamfer, RevolveSide/End. Useful later for STEP import and fillet-face recognition tests; not replayable.
   - Assembly: 8,251 assemblies, 154,468 parts, `contacts` = faces "coincident or within a tolerance of 0.1mm" in the assembled state, plus ASM-recognized `holes`. Ground truth for wonky's missing contact/interference analysis.
8. **Bend fit:** the corpus is plain data; nothing to port into Bend. The replay harness is host JS. Geometry stays in Bend, and designs are independent, which suits fork-join batch runs. Uniform GPU batching is possible for per-step predicate or distance checks (bucket designs by face count).
9. **FDM:** units and sizes are real mechanical parts (brackets, plates, enclosures), a good match for Marc's parts. However, fillets and chamfers were stripped, so the replayed results show sharper edges than the real prints.

## Pointers worth porting or studying

- `docs/reconstruction.md` (full schema), `docs/reconstruction_stats.md`, paper sec. 3 (DSL, Table 2 grammar: `add_sketch`, `add_line(4 numbers)`, `add_arc(5)`, `add_circle(3)`, `add_extrude([profiles], distance, op)`), appendix A.1.1 (validation replay and the duplicate signature: reuse it as wonky's cheap "same design" fingerprint), Figs. 21-28 (distributions).
- `tools/common/sketch_extrude_importer.py`: `reconstruct` (timeline loop), `find_profile`/`are_profile_properties_identical` (profile matching by curve-id set + area/perimeter/centroid at 1e-6), `get_closest_profile` (fallback), `find_transform_for_sketch_geom`, `reconstruct_extrude_feature` and the `set_*_extrude_input` functions (exact semantics of signed distances, `is_full_length`, taper, offset start). This is the reference behaviour a wonky converter must reproduce.
- `tools/common/serialize.py` (exact field names for Arc3D/Circle3D/Ellipse3D/NURBS), `tools/common/geometry.py` (IoU and its heuristics; do not copy them, but know what "exact reconstruction" meant).
- `tools/testdata/{Couch,Hexagon,SingleSketchExtrude}.json` + `Couch.step`: tiny samples in the repo, usable to build the converter before downloading 2 GB. They are still covered by the dataset license, so do not copy them into wonky's tree.
- Issues #66 (operation counts), #71 (face merge/split), #67, #75, #82.

## Verdict: adapt

Use the Reconstruction subset, plus `extrude_tools`, as an external, uncommitted replay and regression corpus for wonky's sketch-region, extrude and planar/cylindrical Boolean paths. Write a host-side JSON-to-FeatureScript converter with an explicit input-tolerance/snapping policy, and check every stage against the dataset's own oracles (profile properties, tool bodies, per-step snapshots, final mass properties), backed by the OCCT and Metro-style comparisons. The non-commercial license forbids treating it as a shipped fixture set or using it for commercial work.

