# ABC: A Big CAD Model Dataset

- Kind: CAD B-rep/mesh dataset with analytic surface annotations and normal-estimation benchmarks. Canonical [website](https://deep-geometry.github.io/abc-dataset/), [repository](https://github.com/deep-geometry/abc-dataset), [paper and supplement](https://arxiv.org/pdf/1812.06216), [CVPR publication](https://openaccess.thecvf.com/content_CVPR_2019/html/Koch_ABC_A_Big_CAD_Model_Dataset_for_Geometric_Deep_Learning_CVPR_2019_paper.html).
- Authors/year: Sebastian Koch, Albert Matveev, Zhongshi Jiang, Francis Williams, Alexey Artemov, Evgeny Burnaev, Marc Alexa, Denis Zorin, Daniele Panozzo; TU Berlin, Skoltech/IITP and NYU; CVPR 2019. Read all 15 pages including supplementary schema.
- License: DOCUMENTED important tension: paper §7 says dataset/information is distributed under MIT and describes processing pipeline as GPL, while the current [website License section](https://deep-geometry.github.io/abc-dataset/#license) says model copyrights belong to their creators and requires a source-rights review. The [repository MIT license](https://github.com/deep-geometry/abc-dataset/blob/master/LICENSE) does not independently settle third-party model rights. Treat site/repository material, pipeline code, and underlying CAD designs as separate licensing layers.
- The dataset includes old models; do not label every model MIT or assume a single universal public-domain status. No legal opinion or redistribution clearance is claimed.
- Status observed 2026-09-24: [GitHub API](https://api.github.com/repos/deep-geometry/abc-dataset) reports 309 stars, 10 forks, size 9525 KiB, one contributor record, language null, not archived, no releases. Default master commit [392789113158b874bfa630098f5bbab3ed38309e](https://github.com/deep-geometry/abc-dataset/commit/392789113158b874bfa630098f5bbab3ed38309e), 2019-07-09; website branch [4590ed3fac542c35f3966da596bf9025b375e9f3](https://github.com/deep-geometry/abc-dataset/commit/4590ed3fac542c35f3966da596bf9025b375e9f3), 2019-09-30. pushed_at 2022-11-10 is not an actual newer default-branch implementation commit. Mature, widely usable research snapshot, not evidence of an actively maintained processing kernel.

## What it is

DOCUMENTED: one million Onshape-derived CAD models initially released April 2019; approximately 750,000 gained OBJ/features/statistics files in May. Latest advertised data version remains **v00**. Shapes include analytic and spline-based surfaces, multiple parts, simple primitives and defective models. A file may be absent because of processing failure. The website says meta, step, para and stl2 are always available; other formats are not. [Official dataset page](https://deep-geometry.github.io/abc-dataset/), [paper §3](https://arxiv.org/pdf/1812.06216).

INFERRED: excellent source of realistic import, tessellation, analytic-recovery and numerical regression cases. It is **not** a million labeled Boolean input/output pairs, and the existence of a source model is not proof of validity, manufacturability or a successful independent round trip.

## How it works

### Acquisition and conversion pipeline

DOCUMENTED paper §3.2: Onshape supplies Parasolid-derived STEP B-reps. OCCT loads/translates them, Gmsh creates uniform or curvature-adaptive triangle meshes, topology traversal links mesh vertices/triangles to original curves/patches and computes analytic differential quantities, then post-processing filters/resamples. Multiple representations share model identifiers. Supplement A filters empty STEP files by size, single primitives, shapes needing healing during conversion/meshing, and oversized meshes for selected processed/benchmark sets. Thus processed meshes have selection bias relative to raw CAD. [Paper pp. 4, 11](https://arxiv.org/pdf/1812.06216).

DOCUMENTED formats and joins from [official format table](https://deep-geometry.github.io/abc-dataset/#file-formats):

- `meta`: author/document metadata YAML.
- `step`: parametric B-rep exported from Parasolid; retain original topology, units and entity structure.
- `para`: native Parasolid representation, not directly usable as a Bend backend.
- `stl`: separate part files in an archive; `stl2`: all parts merged into one STL model, **not documented as Boolean-unioned into a single manifold**. Triangles may have very poor aspect ratios.
- `obj`: processed mesh with ground-truth normals/curvatures.
- `feat`: curve/patch annotations linked to OBJ vertex and triangle indices. Documented YAML indices are 0-based; OBJ indices are 1-based.
- `stats`: B-rep and mesh statistics.
- `img`: example renders; full download availability is not established.
- `ofs`: serialized Onshape feature API records, despite the label FeatureScript. **Not executable FeatureScript source.**

DOCUMENTED storage: separate format archives in chunks of 10,000 model IDs, e.g. `abc_0000_step_v00.7z`, with URL lists, file sizes and MD5 checksums. Join formats by model ID and per-model suffix, not directory enumeration order; availability differs. [Chunk lists](https://deep-geometry.github.io/abc-dataset/data/all_v00.txt), [checksums](https://deep-geometry.github.io/abc-dataset/data/md5.yml), [sizes](https://deep-geometry.github.io/abc-dataset/data/size.yml). INFERRED: MD5 is useful for advertised archive-integrity comparison, not a security-authenticity proof; record your own content hash and pinned version as well.

### Concrete annotation schema

DOCUMENTED supplement B.3, pp. 11–13 of [PDF](https://arxiv.org/pdf/1812.06216):

- Curve types: Line, Circle, Ellipse, BSpline, Other. Each carries type, `sharp`, `vert_indices` and `vert_parameters`; primitive-specific fields include location/axes/radii. For B-splines: rational/closed/continuity/degree/poles/knots/weights. Knot multiplicities are represented by repeated entries.
- Patch types: Plane, Cylinder, Cone, Sphere, Torus, Revolution, Extrusion, BSpline, Other. Store `vert_indices`, `vert_parameters`, `face_indices`, plus analytic parameters. B-spline surfaces carry u/v rational/closed flags, degrees, knot arrays, pole grids and weights.
- Plane: `p(u,v)=l+u*x+v*y`, with frame and implicit plane coefficients. Cylinder: `p(u,v)=l+r*cos(u)*x+r*sin(u)*y+v*z`. Cone uses a reference radius r and half-angle a: `p(u,v)=l+(r+v*sin(a))*(cos(u)*x+sin(u)*y)+v*cos(a)*z`. **Its v is slant displacement, not axial height.**
- Circle: `c(t)=l+r*cos(t)*x+r*sin(t)*y`; Line: `c(t)=l+t*d`. Quadrics also provide implicit coefficient arrays. INFERRED: these permit independent residual checks and analytic-normal evaluation in Bend, provided units/frames/parameters are verified.

DOCUMENTED inspected public [stats example](https://deep-geometry.github.io/abc-dataset/data/00000050_80d90bfdd2e74e709956122a_stats_000.yml) has 3 parts, 43 surfaces, 106 edges, 22335 vertices and 44694 mesh faces. Surface labels are only Plane/Cylinder, **but edge labels include BSpline**. This is direct evidence that filtering on supported face types alone is insufficient for wonky's supported analytic edge/trim set. The example also includes bbox, diagonal, tolerance, max_length, surface and volume fields. No established cross-format unit/accuracy contract for those scalar statistics was found; do not promote them to exact golden mass properties without validation.

DOCUMENTED [STEP example](https://deep-geometry.github.io/abc-dataset/data/00000050_80d90bfdd2e74e709956122a_step_000.step): AP214-style `AUTOMOTIVE_DESIGN` schema, explicit METRE length unit, RADIAN angular unit and `UNCERTAINTY_MEASURE_WITH_UNIT(1e-17, ...)`. The annotations show dimensions around 64.7 while STEP geometry has its own unit context. INFERRED: read each representation's actual units and compare known coordinates/radii before selecting a scale; do not assume all files are mm, and do not treat the exported uncertainty declaration as an empirically certified geometry error.

DOCUMENTED [OFS sample](https://deep-geometry.github.io/abc-dataset/data/00000050_80d90bfdd2e74e709956122a_featurescript_000.yml) contains BTMFeature/BTFeatureState objects, IDs, parameter records, suppression flags and feature statuses. Author [issue #4](https://github.com/deep-geometry/abc-dataset/issues/4#issuecomment-507199558) confirms these come from `/partstudios/d/:did/[wvm]/:wvm/e/:eid/features`, contain **no FeatureScript code**, and may need Onshape API context. A later comment notes geometry IDs with no defining reference in the file. Consequently original document links/OFS records do **not automatically provide offline FeatureScript-level replay**.

## Robustness and guarantees

DOCUMENTED paper §3.2: raw Onshape collection is not curated and includes broken boundaries, self-intersecting faces/edges and duplicate vertices/models. Processed sets apply filters, but neither the paper nor website guarantees all models/annotations are consistent or closed solids. [Paper](https://arxiv.org/pdf/1812.06216).

DOCUMENTED: analytic differential ground truth means derivatives of the source surface descriptions, not exact rational evaluation, correct solid orientation or an independently verified Boolean result. The normal benchmark loss is `1-(n·n_gt)^2`, intentionally insensitive to a 180-degree reversal. INFERRED: do not use that loss alone for wonky's outward normals or signed volume; preserve orientation signs and face-use context. [Paper §5.1](https://arxiv.org/pdf/1812.06216).

DOCUMENTED annotation defects below show why range checks, indexing verification and `||surface(uv)-meshVertex||` checks are prerequisite to using annotations as an oracle. Exact U32 predicates cannot repair a wrong index, wrong unit or mismatched source snapshot.

## Parallelism and performance

DOCUMENTED §3.2 estimate: approximately **two CPU-years** to extract triangle meshes for one million CAD models; processing was designed for parallel execution on large computing clusters. No hardware-specific per-model extrapolation should be made from that rough aggregate. [Paper p. 4](https://arxiv.org/pdf/1812.06216).

DOCUMENTED supplement Table 5: simple Uniform normal estimation on 10k full meshes with 512 vertices took **0.5 minutes** on one Intel Core i7 CPU core; for 100k full meshes with 2048 vertices, **12.0 minutes**. These are normal-estimation timings, not import/Boolean/meshing throughput. Paper §6 reports even this method produced invalid normals on roughly 100 models due to floating-point errors. [Paper pp. 7, 14](https://arxiv.org/pdf/1812.06216).

INFERRED Bend fit: independent model validation is easy fork-join; uniform GPU batches are natural for analytic point/normal/parameter residuals grouped by surface type. Arbitrary STEP parsing, variable topology and adaptive meshing are ragged CPU tasks unless separately bucketed. Dataset numeric text can exceed F32's useful scale/precision; normalize with a recorded reversible transform and preserve original input for range/refusal tests. F32x2 improves mantissa only; exact multi-limb predicates address discrete decisions, not all parametric evaluation.

## Known failures, limitations, war stories

- DOCUMENTED author [#7](https://github.com/deep-geometry/abc-dataset/issues/7#issuecomment-607763133): a few models (<5 reported then) have indices shifted by -1; others have indices exceeding mesh vertex count. Suggested workaround for those was deriving vertices via face_indices. Do **not** apply +1 globally; prove the model-specific remapping first.
- DOCUMENTED [#19](https://github.com/deep-geometry/abc-dataset/issues/19): website example uses one-based vertex indices while matching main-dataset file uses the documented zero base. The example cannot be an unquestioned schema conformance fixture.
- DOCUMENTED first-person [#10](https://github.com/deep-geometry/abc-dataset/issues/10): interior curve parameters appear scaled by 1000 while endpoints are not. The inspected [example](https://deep-geometry.github.io/abc-dataset/data/00000050_80d90bfdd2e74e709956122a_features_000.yml) indeed lists a circle's interior parameters into the thousands followed by endpoint 2π. The proposed divide-by-1000 correction is reporter diagnosis, not a universal repair contract.
- DOCUMENTED [#22](https://github.com/deep-geometry/abc-dataset/issues/22): processing-code availability remains a question years later. Master checkout contains README/LICENSE, not the promised pipeline; website still says modules coming soon. Do not claim the GPL pipeline is available for porting based solely on paper prose.
- DOCUMENTED [#24](https://github.com/deep-geometry/abc-dataset/issues/24): full canonical-view image downloads requested but not located.
- DOCUMENTED [#25](https://github.com/deep-geometry/abc-dataset/issues/25): archive access restriction reported; author requested it lifted. In this pass the first [STEP archive URL](https://archive.nyu.edu/rest/bitstreams/88598/retrieve) returned HTTP 200 to HEAD, while individual website samples and lists were downloaded successfully. This verifies one endpoint, not completeness of all chunks. No bulk archive download performed.

## Relevance for wonky

INFERRED staged corpus plan:

1. **Manifest first:** model ID, source document/snapshot, per-file hash, license/provenance review, available formats, units, part counts, curve/surface classes and filter decisions. Start with small offline samples; do not start by downloading/rebuilding a million models.
2. **Capability filter:** require supported planes/cylinders/cones **and** supported 3D curves/pcurves, trim domains, periodic seams, topology kind and units. Keep rejected cases with exact unsupported reasons for future SSI/fillet/offset work. A sphere/torus/NURBS case is not a Boolean regression until its prerequisites are implemented.
3. **Import and STEP round trip:** if a general STEP reader is not yet present (current context explicitly mentions export), build/limit the import path first or construct native fixtures from vetted analytic records. Compare topology incidence, oriented shells, body count, analytic types/parameters, pcurve agreement, bbox and independently evaluated mass properties; allow legitimate face/edge splitting without confusing it with shape drift.
4. **Analytic recovery validation:** use trusted patch/curve-to-mesh correspondence to test the mesh-Boolean/analytic-recovery hybrid. Each recovered surface and edge should match its source type and satisfy residual bounds. Verify annotations themselves before grading wonky against them. The YAML feature list is not a replacement for complete B-rep incidence/trim topology.
5. **Numerical metamorphisms:** translate, uniformly rescale, permute entity storage order, reverse/reverse-back orientation, and vary tessellation resolution under explicit tolerances. Use U32/multi-limb signs for exact combinatorics and F32x2/interval evaluation for geometry bounds. Keep frame normalization and physical FDM tolerance separate.
6. **Mesh/FDM lane:** compare source and certified wonky tessellations for closedness, manifoldness, orientation, minimum triangle quality, body overlap and physical feature size. Merged STL parts do not imply print-ready union. Compare continuous geometry within certified tolerance, not byte-identical triangles.
7. **Replay lane is separate:** OFS is an API snapshot, not the promised unmodified FeatureScript input. DeepCAD offers a narrower solved sketch/extrude history but has its own semantic losses. Any fresh bulk Onshape extraction needs separate source-rights review; this research does not authorize it.

## Pointers worth porting or studying

Paper §3.2 (pipeline), §5.1 (orientation-insensitive metric), supplementary A (selection), B.3 (curve/surface equations and fields), Table 5 (actual measured scope). Official example STEP/feat/stats/ofs linked above; author explanations in #4 and #7; negative-index and unit-parameter regressions #10/#19. Local PDF `<repo>/tmp/research/pdf/abc-1812.06216.pdf`; downloaded example `<repo>/tmp/research/abc-a-big-cad-model-dataset/example.step`.

## Verdict: adapt

Use a provenance-audited, capability-filtered ABC subset for import/export, analytic-preservation, meshing and validation stress tests. Do not call the entire dataset clean golden truth, infer code availability from the paper, filter only by face type, or equate OFS with replayable FeatureScript. Open work: underlying-model rights, unit/index audit on selected archives, and independent oracle measurements.

