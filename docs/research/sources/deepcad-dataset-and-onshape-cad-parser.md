# DeepCAD dataset and onshape-cad-parser

- Kind: CAD construction-sequence dataset, reconstruction/training code, and Onshape extraction scripts. Canonical [DeepCAD repository](https://github.com/rundiwu/DeepCAD); [parser](https://github.com/rundiwu/onshape-cad-parser), redirected from ChrisWu1997; [paper](https://arxiv.org/abs/2105.09492), [PDF](https://arxiv.org/pdf/2105.09492).
- Authors/year: Rundi Wu, Chang Xiao, Changxi Zheng, Columbia University; ICCV 2021, pp. 6772–6782. Read all 15 PDF pages including supplementary sections A–G.
- License: DOCUMENTED DeepCAD [MIT](https://github.com/rundiwu/DeepCAD/blob/master/LICENSE), copyright Rundi Wu 2022; **parser has no license** in inspected tree/API, corroborated by [license request #7](https://github.com/rundiwu/onshape-cad-parser/issues/7). Treat parser implementation as reference-only pending permission, not MIT by association. MIT covers the software; it does not establish every underlying Onshape model's rights. Source-model licensing still matters for data reuse.
- Activity, observed 2026-09-24: DOCUMENTED [DeepCAD API](https://api.github.com/repos/rundiwu/DeepCAD): Python, repository size 263 KiB, 827 stars, 170 forks, 3 contributor records including anonymous; last default-branch commit [f7b350790a3bce0267a5345339fd09be0250c8cb](https://github.com/rundiwu/DeepCAD/commit/f7b350790a3bce0267a5345339fd09be0250c8cb), 2024-04-12; not archived, no releases returned. [Parser API](https://api.github.com/repos/rundiwu/onshape-cad-parser): Python, 15 KiB, 95 stars, 23 forks, one contributor; last commit [1f84bf85f2a96fda03efd944f820c1ee791c3a35](https://github.com/rundiwu/onshape-cad-parser/commit/1f84bf85f2a96fda03efd944f820c1ee791c3a35), 2022-08-18; not archived, no releases. These are historical research artifacts with continuing questions, not evidence of active maintenance.

## What it is

DOCUMENTED paper §3.3: **178,238** construction histories collected using original Onshape document links supplied by ABC; models using operations beyond sketch/extrude were discarded. Data split 90%/5%/5%. This is not the whole million-model ABC corpus and not a general feature-history corpus. Supplement A notes near-duplicate shapes and a nearest-neighbor Chamfer-distance filter for test-vs-training duplicates. [Paper, pp. 5 and 12](https://arxiv.org/pdf/2105.09492).

DOCUMENTED [README](https://github.com/rundiwu/DeepCAD/blob/f7b350790a3bce0267a5345339fd09be0250c8cb/README.md): `cad_json` contains parsed construction histories; `cad_vec` is normalized/quantized vector data for learning. Models are replayed locally through pythonocc/OpenCASCADE, not Onshape. The downloadable [data.tar](https://www.cs.columbia.edu/cg/deepcad/data.tar) responded HTTP 200 to a HEAD request, Content-Length 208074561, last-modified 2021-08-06. The full archive was not downloaded or replayed in this pass, so 178,238 is paper-reported, not a recounted clean replay total.

## How it works

### Construction schema and replay

DOCUMENTED [parser.py](https://github.com/rundiwu/onshape-cad-parser/blob/1f84bf85f2a96fda03efd944f820c1ee791c3a35/parser.py) emits a Fusion360-Gallery-like JSON structure with `entities`, `properties.bounding_box`, and ordered `sequence` records containing feature index, type and entity ID. Sketch entities store frame origin/x/y/z axes and profiles containing loops of Line3D, Arc3D and Circle3D geometry. Extrusions reference sketch/profile IDs, operation, extent type and distances. This is **not FeatureScript source**, and sketch constraints are intentionally omitted. [Parser README](https://github.com/rundiwu/onshape-cad-parser/blob/1f84bf85f2a96fda03efd944f820c1ee791c3a35/README.md).

DOCUMENTED extraction details:

- `process_one` first excludes feature types other than newSketch/extrude. `_parse_extrude` rejects offsets and end conditions other than BLIND/SYMMETRIC, except a second BLIND direction. It maps NEW/ADD/REMOVE/INTERSECT to new-body/join/cut/intersect labels. Distances are evaluated in meters. A symmetric Onshape depth is divided by two for the stored **per-side** extent. Opposite-direction signs are represented in the distances. Both taper angles are written as zero; the parser is not a faithful draft-extrusion exporter. [process.py](https://github.com/rundiwu/onshape-cad-parser/blob/1f84bf85f2a96fda03efd944f820c1ee791c3a35/process.py), [parser.py](https://github.com/rundiwu/onshape-cad-parser/blob/1f84bf85f2a96fda03efd944f820c1ee791c3a35/parser.py), [myclient.py](https://github.com/rundiwu/onshape-cad-parser/blob/1f84bf85f2a96fda03efd944f820c1ee791c3a35/myclient.py).
- Sketch profile loops are reconstructed by vertex-to-edge adjacency and walking unvisited edges. The code explicitly warns that vertices incident to three edges are error-prone. Arcs are recognized as circles with two vertices; fewer than two means a full circle. The major/minor arc decision compares actual and candidate midpoint angles rounded to three decimals. Every emitted loop has `is_outer: true`; robust hole/nesting classification cannot trust that field blindly. [parser.py](https://github.com/rundiwu/onshape-cad-parser/blob/1f84bf85f2a96fda03efd944f820c1ee791c3a35/parser.py).
- **Partial-history hazard:** `FeatureListParser.parse` catches a feature exception and breaks, returning the successfully parsed prefix. `process_one` writes that prefix if it has at least two sequence entries. Its bbox was queried before the parse loop from the source document. INFERRED: a JSON can represent a prefix while retaining the final source bbox; importer completeness must be checked against original feature counts if original parity is claimed. [parse and process_one](https://github.com/rundiwu/onshape-cad-parser/blob/1f84bf85f2a96fda03efd944f820c1ee791c3a35/parser.py), [process.py](https://github.com/rundiwu/onshape-cad-parser/blob/1f84bf85f2a96fda03efd944f820c1ee791c3a35/process.py).

DOCUMENTED local replay [cadlib/extrude.py](https://github.com/rundiwu/DeepCAD/blob/f7b350790a3bce0267a5345339fd09be0250c8cb/cadlib/extrude.py), [visualize.py](https://github.com/rundiwu/DeepCAD/blob/f7b350790a3bce0267a5345339fd09be0250c8cb/cadlib/visualize.py):

1. `Extrude.from_dict` splits a multi-profile extrusion into one operation per profile; for a NewBody operation it rewrites all but the first to Join.
2. Build sketch curves in world coordinates as `origin + x*xAxis + y*yAxis`; make planar face from first loop and reverse later loops as holes. Build a prism along the sketch normal. Symmetric/two-sided extrusion builds a second prism and fuses it.
3. `create_CAD` treats **both NewBody and Join as Fuse** for every operation after the first. It maintains a single accumulated shape, not Onshape's distinct body/merge-scope semantics. No original merge-scope or target-body selection is preserved by this replay path.
4. Line endpoints passing NumPy `allclose` are omitted; circle radii are made absolute; arcs are reconstructed from three points. These are geometry-altering reconstruction policies, not neutral oracle behavior.

INFERRED mathematical replay caveat: splitting a multi-profile INTERSECT into sequential intersections gives `A ∩ B1 ∩ B2`, whereas intersecting the combined extruded regions normally gives `A ∩ (B1 ∪ B2)`. These differ, e.g. for disjoint profiles. A wonky adapter should preserve a feature's grouped tool set and original operation scope, not blindly copy DeepCAD's flattened loop. The observed split and replay code above are the evidence; this mismatch was not locally executed.

### Network representation versus raw geometry

DOCUMENTED paper Table 1/§3.1 and [macro.py](https://github.com/rundiwu/DeepCAD/blob/f7b350790a3bce0267a5345339fd09be0250c8cb/cadlib/macro.py): commands are Line, Arc, Circle, SOL, Ext and EOS. Each has 16 parameter slots plus a command tag; unused slots are -1. Extrude parameters encode frame orientation (three angles), origin, sketch scale, two distances, Boolean kind and extent kind. Limits in code are 10 extrudes, 6 loops/sketch, 15 curves/loop, 60 total tokens; 256 parameter bins.

DOCUMENTED: `CADSequence.normalize` scales about the original origin, without recentering, by `0.75/max(abs(bbox))`. Numeric parameters are then rounded/clipped to 8-bit bins; e.g. distance encoding `round((e+1)*256/2)` clipped to 0…255, decoding `2*q/256-1`. Coordinates/angles also undergo quantization and clipping. This is intentional lossy learning data, **not a tolerance-certified CAD representation**. [extrude.py](https://github.com/rundiwu/DeepCAD/blob/f7b350790a3bce0267a5345339fd09be0250c8cb/cadlib/extrude.py), [paper supplementary B](https://arxiv.org/pdf/2105.09492). INFERRED: use raw JSON and preserve original frame vectors for kernel conformance; treat vectorized histories as a distinct mutation/robustness corpus.

## Robustness and guarantees

DOCUMENTED: paper §5 and supplementary F explicitly deny guaranteed topological soundness of generated command histories, with increasing failure likelihood for longer sequences. Figure 11 includes invalid topology and misplaced small sketches. No exact-predicate, tolerance certification or watertightness theorem is supplied. [Paper](https://arxiv.org/pdf/2105.09492).

DOCUMENTED evaluation §4.1 measures command/parameter accuracy and Chamfer distance from **2000 random surface samples**; parameter threshold is 3 quantization bins. Invalid Ratio means failing conversion to point clouds. [evaluate_ae_cd.py](https://github.com/rundiwu/DeepCAD/blob/f7b350790a3bce0267a5345339fd09be0250c8cb/evaluation/evaluate_ae_cd.py) returns None on missing ground-truth point cloud, CAD creation exception or point-cloud conversion exception; these are combined in its reported invalid count. It also normalizes generated point clouds whose max absolute coordinate exceeds 2. [visualize.py](https://github.com/rundiwu/DeepCAD/blob/f7b350790a3bce0267a5345339fd09be0250c8cb/cadlib/visualize.py) samples an exported STL. INFERRED: neither low Chamfer distance nor successful meshing proves solid validity, feature fidelity, correct scale or Boolean semantics. Separate missing-data, parser, kernel, meshing and sampling failures.

## Parallelism and performance

DOCUMENTED: `json2vec.py` and extraction process use joblib with ten workers; evaluation optionally uses eight. Dependencies include Python/NumPy, pythonocc 7.5.1, and training additionally PyTorch/CUDA. These are not directly embeddable Bend components. [Preprocessor](https://github.com/rundiwu/DeepCAD/blob/f7b350790a3bce0267a5345339fd09be0250c8cb/dataset/json2vec.py), [evaluation](https://github.com/rundiwu/DeepCAD/blob/f7b350790a3bce0267a5345339fd09be0250c8cb/evaluation/evaluate_ae_cd.py), [README](https://github.com/rundiwu/DeepCAD/blob/f7b350790a3bce0267a5345339fd09be0250c8cb/README.md).

DOCUMENTED paper Table 2: augmented autoencoder reports 99.50% command accuracy, 97.98% parameter accuracy, median CD 0.752×10^-3 and 2.72% invalid ratio. These are **neural reconstruction-quality metrics**, not original dataset validity or kernel benchmark failure rates. No trustworthy throughput for replay of the raw corpus was found; no benchmark was run. [Paper p. 6](https://arxiv.org/pdf/2105.09492).

## Known failures, limitations, war stories

- DOCUMENTED author-confirmed [#5](https://github.com/rundiwu/DeepCAD/issues/5): pythonocc may segfault while rebuilding raw JSON, sometimes nondeterministically. Suggested workaround was identify IDs serially and skip them, not prove them valid. Preserve these as isolated crash regressions, not silently discarded cases.
- DOCUMENTED [#29](https://github.com/rundiwu/DeepCAD/issues/29): 00511440.json exports successfully while its h5 reconstruction returns None during Boolean accumulation, even after regenerating h5. This directly warns against treating quantized vectors as faithful raw geometry.
- DOCUMENTED [#6](https://github.com/rundiwu/DeepCAD/issues/6): initially reported wrong major arcs was ultimately resolved as **separate sketch profiles that must be combined**, not a confirmed arc parser defect. The final author/reporter comments matter; do not cite the initial suspicion as fact.
- DOCUMENTED author [#11](https://github.com/rundiwu/DeepCAD/issues/11): each JSON filename is its ABC data ID, enabling join to original provenance.
- Bulk collection is not an established input path here. Use distributed snapshots first; obtain appropriate source permissions before any bulk requests. No live Onshape access was performed.

## Relevance for wonky

INFERRED: this is a strong **candidate** replay corpus for line/arc/circle sketches and extrusions, but not ready-made trustworthy golden truth. Recommended pipeline:

1. Import a small licensed subset of raw JSON, retain ABC ID, source URL/snapshot, meter-to-mm factor, complete original history and hash. Keep all scalar text and original frame vectors. Do not equate a mutable workspace URL with a frozen source model.
2. Validate closure, loop nesting, arc orientation, feature completeness, finite ranges and operation scopes before replay. Preserve grouped profiles and separate bodies; reject unsupported draft/end conditions/target semantics explicitly.
3. Capture outcome after **every feature**: supported/refused/invalid/reference-unavailable, body count, bbox, signed volume, topology checks, analytic face types, witness render and provenance. Minimize failing histories by finding the first divergent prefix.
4. Maintain separate corpora for raw parse, cleaned/confirmed replay and quantized mutations. A conversion defect must not become a wonky expected-success fixture merely because it was in a learning dataset.
5. Compare JS/C/Metal on the exact same encoded input. Runtime geometry stays in Bend; a host-side JSON-to-FeatureScript adapter is data translation, not an OCCT backend. F32x2 calculations need scale-aware error bounds; arbitrary Python float/NumPy binary64 output must be rounded under a declared input policy, not assumed preserved. U32 covers tags/IDs and can encode 8-bit stress inputs exactly.
6. Each history is intrinsically sequential, but independent histories and independent sketch/predicate batches fit balanced fork-join. Bucket by operation count and geometry size for GPU uniformity. No direct port of mutation-heavy Python/Numpy/OCC code.
7. This corpus **cannot validate the sketch constraint solver**, because it stores solved geometry without constraints. Nor does it cover fillet/revolve histories: those were filtered out, not retained as refusal cases. Curved Boolean combinations of accepted extrusions can still exercise wonky's current gaps and become explicit unsupported tests. FDM suitability needs wall/feature and watertightness checks beyond DeepCAD's metrics.

## Pointers worth porting or studying

Paper §3.1/Table 1 (encoding), §3.3 (selection), supplementary A/B/F (duplicates, quantization, failures). MIT DeepCAD `cadlib/extrude.py` (frame, grouped-profile split, normalization), `cadlib/visualize.py` (Boolean and body semantics), `macro.py`, `dataset/json2vec.py`, `evaluation/evaluate_ae_cd.py`. Reference-only unlicensed parser `FeatureListParser.parse`, `_parse_extrude`, `SketchParser._parse_edges_to_loops`, `myclient.py` FeatureScript queries. Source links above. Local PDF: `<repo>/tmp/research/pdf/deepcad-2105.09492.pdf`.

## Verdict: adapt

Use a vetted raw-JSON subset as a staged sketch/extrude replay corpus with per-feature diagnostics and provenance. Do not port the unlicensed parser, treat quantized h5 as exact CAD, equate reconstructed Fuse semantics with Onshape body semantics, or assume access to bulk Onshape reference measurements. Open work: data/model rights review, small offline import audit, and creation of independently checked golden values.

