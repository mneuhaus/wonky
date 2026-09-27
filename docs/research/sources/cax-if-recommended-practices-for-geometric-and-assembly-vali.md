# CAx-IF Recommended Practices for Geometric and Assembly Validation Properties (v4.5, superseded by v4.6)

- Kind: industry recommended-practice specification for STEP (ISO 10303 AP203e2/AP214/AP242) exchange. Canonical as briefed: [v4.5 PDF on mbx-if.org](https://www.mbx-if.org/home/wp-content/uploads/2024/05/rec_prac_gvp_v45.pdf) (38 pp., 2019-08-22; file hosted 2024-05-29, 889,984 bytes, sha256 f2e5a1f6…3e25). **Current version: [v4.6 PDF](https://www.mbx-if.org/home/wp-content/uploads/2024/05/rec_prac_gvp_v46.pdf)** (39 pp., 2023-04-21), linked from the [MBx-IF CAx Recommended Practices index](https://www.mbx-if.org/home/cax/recpractices/) as the live document; v4.5 is the archived predecessor. Local copies: `tmp/research/pdf/caxif_rec_prac_gvp_v45.pdf`, `caxif_rec_prac_gvp_v46.pdf` (+ `.txt` extractions).
- Authors: Jochen Boy (PROSTEP AG), Phil Rosché (ACCR), Doug Cheney (ITI Global); v4.5 adds Jean-Marc Crepel (AFNeT), v4.6 adds Rosemary Astheimer (NIST). CAx Implementor Forum (CAx-IF, now under the MBx Interoperability Forum), jointly run by ProSTEP iViP and PDES Inc. **DOCUMENTED** (title pages).
- License: "© CAx Interoperability Forum", freely downloadable, no explicit license. It is a *convention*, not code: implementing the conventions in wonky's STEP writer/reader carries no licensing issue (INFERRED). Do not redistribute the PDF in the repo; cite the URL.
- Status: maintained. Revision history 3.1 (2011) → 4.5 (2019) → 4.6 (2023, "editorial updates for broken cross-references and P21 code; context for bounding-box corner points (4.11); industry example for thresholds (4.13); updated implementation schemas (Annex A: AP242 1st–3rd ed.)"). **DOCUMENTED**, v4.6 p.4.

## What it is

A convention for embedding *geometric validation properties* (GVP) in a STEP file so the receiver can recompute them and compare: sender computes, receiver imports, receiver recomputes, compare within agreed thresholds (§4.1). Also defines *extended* (per-instance centroid) VP, *Cloud Of PointS* (COPS) sampling points per face, and *assembly* VP (number of children, notional-solid centroid). It does not specify how to compute the properties numerically, only which ones, where they live in the STEP graph, and how to evaluate deviations.

## How it works

**Property set per geometry class (§4.6, DOCUMENTED):** solids → volume, surface area, centroid; independent surfaces → area, centroid; independent curves → length, centroid; independent points → count, centroid. Up to four separate centroids per part to avoid ambiguity about what a system includes (e.g. CATIA reports "wetted area" excluding voids, so it must label it `'wetted area measure'`, §4.7.2). Bounding box applies to solids/surfaces/curves.

**What geometry counts (§4.2):** only visible 3D elements that would be exported; no annotations, no composite-only geometry, no supplemental/reference geometry. Part-level GVP is mandatory; geometry-level GVP (per MANIFOLD_SOLID_BREP, BREP_WITH_VOIDS, CLOSED_SHELL, ADVANCED_FACE, CURVE, …) is optional (§4.5 "Important Agreement").

**STEP instantiation (§4.4–4.12, §8 Fig.19/21, DOCUMENTED):** `PROPERTY_DEFINITION('geometric validation property', <desc>, <PRODUCT_DEFINITION_SHAPE or SHAPE_ASPECT>)` → `PROPERTY_DEFINITION_REPRESENTATION` → `REPRESENTATION(name, items, context)` with items:
- `MEASURE_REPRESENTATION_ITEM('volume measure', VOLUME_MEASURE(v), unit)`
- `MEASURE_REPRESENTATION_ITEM('surface area measure', AREA_MEASURE(a), unit)`
- `CARTESIAN_POINT('centre point', (x,y,z))`
- `CARTESIAN_POINT('bounding box corner point', min)`, `(…, max)`
- counts as `INTEGER_REPRESENTATION_ITEM('number of independent points', 4.)` in AP242 (with the famous trailing decimal point; §4.10.1 explains the "integer with an identity crisis" P21 rule).
Combining (§4.12): if properties share type and model element, put them in one `REPRESENTATION('' , (#vol,#area,#centroid), ctx)`; the empty name signals "several items inside". COPS cannot be combined because its representation name distinguishes `'smooth sampling points'` vs `'sharp sampling points'`. v4.6 adds: the bbox `REPRESENTATION` must share its `GEOMETRIC_REPRESENTATION_CONTEXT` with the part's `SHAPE_REPRESENTATION` (units!). Geometry-level attachment via `SHAPE_ASPECT` + `GEOMETRIC_ITEM_SPECIFIC_USAGE` (AP242 allows one GISU per SHAPE_ASPECT; use `ITEM_IDENTIFIED_REPRESENTATION_USAGE` for several items) and `ID_ATTRIBUTE` for uniqueness (§4.5.1–4.5.3).

**Document identification (§3):** append to `FILE_DESCRIPTION` the string `'CAx-IF Rec.Pracs.---Geometric and Assembly Validation Properties---4.6---2023-04-21'` (v4.5: `---4.5---2019-08-22`).

**Bounding box agreement (§4.11):** axis-aligned; computed from B-rep **vertices and edges** (plus independent points) *or* from all vertices of a display tessellation. INFERRED consequence: the agreed box is not the tight box of the solid. It misses face-interior bulges (sphere/torus patches, cylinder silhouettes when the seam edges do not hit the extreme), and tessellation vertices lie inside convex curved faces. So "bbox" here is a convention both sides can reproduce, not a geometric truth.

**Evaluation (§4.13, DOCUMENTED):**

| Property | Interop testing (green / yellow / red) | Industry production, v4.6 Fig.13 (single OK threshold) |
|---|---|---|
| Volume, area, curve length | < 1% / 1–10% / > 10% | 0.5% |
| Centroid, absolute distance | < 1 mm / 1–5 mm / > 5 mm | 0.02 mm, plus 0.1% of size for size > 20 mm |
| Centroid, relative to bbox diagonal | < 0.1% / 0.1–1% / > 1% | (curve centroid alternative: 0.02 mm + 2.0% for size > 2.5 mm) |
| Bounding box | abs error = max(err(min), err(max)); relative = abs/diagonal; same thresholds as centroid | corner point 0.5% |
| Notional-solid centroid (assembly) | n/a | 0.0001 mm or 0.05 mm |

The relative-centroid method is declared meaningless below a 20 mm diagonal "assuming a model accuracy of 0.02 mm" (0.02 mm / 0.1% = 20 mm); small parts must use absolute deviation.

**COPS (§6):** per-face sampling points evaluated *exactly* on the native surface/edge, inside the face's active region. Distribution parameters: minimum points per face, maximum spacing (relative to model extent), chordal-deviation tolerance; FEM-mesh-like distributions recommended. Two classes: *smooth* points (on surface, projected in the target onto the nearest active face region, so edges may move along smooth geometry or vanish) and *sharp* points (on edge curves, projected onto the nearest active sharp edge). An edge is sharp if non-manifold or if surface normals across it differ by more than a threshold; "a 1.0 degree limit seems to be practical". The document gives **no numeric deviation threshold** for COPS (INFERRED from a full read of v4.5 and v4.6).

**Assembly VP (§7):** `number of children` = count of NEXT_ASSEMBLY_USAGE_OCCURRENCE under a node; `notional solids centroid` = mean of the point (10,10,10) transformed into the parent by each child's placement. The doc states candidly that this is "not mathematically guaranteed" to detect a wrong placement, "but the chance … is extremely small".

## Robustness and guarantees

- It is a heuristic equivalence check on global integrals plus sparse samples. Equal volume/area/centroid does not imply equal shape (e.g. a mirrored pocket with the same volume and a compensating centroid is unlikely but possible). DOCUMENTED for assemblies, INFERRED for parts.
- Thresholds are business agreements, not derived from numeric error analysis. The 1% interop threshold is deliberately loose, because it must accept every commercial exporter.
- COPS is the only local check, and it is sample-based: it detects moved or deformed faces, not topology changes that keep points on some surface.

## Parallelism and performance

Not applicable in the document. INFERRED for wonky: volume, area, centroid and inertia of an analytic B-rep are sums of per-face integrals (divergence theorem), which is a uniform map-reduce. That is a clean fork-join tree in Bend and a uniform GPU kernel per tessellated triangle or per quadrature point. COPS generation is a per-face map as well.

## Known failures, limitations, war stories

- CATIA's "wetted area" vs everyone else's total area created false errors until the naming convention was added (§4.7.2, DOCUMENTED).
- CAx-IF tests found systems computing model extent "in many different ways, … making a comparison of these values meaningless", hence the prescribed bbox algorithm (§4.11, DOCUMENTED).
- Units: GVP values must be in the STEP file's declared units; v4.6 had to add the shared-context requirement for bbox points (DOCUMENTED). Wrong unit contexts are a classic false-red source (INFERRED).
- v4.6 exists specifically to fix "broken cross-references and P21 code" in earlier editions: examples in older PDFs are not reliable templates (DOCUMENTED).

## Relevance for wonky

- **STEP export validation (primary):** wonky's writer (`src/exporters.mjs:148`) emits AP214 `AUTOMOTIVE_DESIGN` with `FILE_DESCRIPTION(('wonky-kernel analytic B-rep'),'2;1')` and no GVPs. Adding part-level volume, surface area, centroid and the agreed bbox, combined per §4.12, plus the §3 ID string, lets every receiving CAD (Fusion, Onshape import, FreeCAD/OCCT, NIST SFA) report green/yellow/red automatically. It also gives wonky's STEP *reader* a self-check for imported parts (INFERRED).
- **Round-trip test harness:** export → import in a receiving system → compare with the v4.6 *industry* thresholds (0.5%, 0.02 mm), not the 1%/1 mm interop ones. For Marc's FDM parts (often < 20 mm diagonals for clips and latches) the doc itself says to use the absolute centroid criterion.
- **Not for kernel regression.** 0.5% of volume on a 3,000 mm³ part is 15 mm³, i.e. a whole 2.5 mm cube can vanish unnoticed. Kernel tests need wonky's own declared tolerances (F32x2 ≈ 48-bit significand, analytic input budget 0.0003 mm, certified mesh deviation) and exact predicates, as in the OCCT `checkprops -deps` style. INFERRED.
- **Computing the values in Bend:** volume = (1/3)∮ x·n dA and centroid = moments / volume via per-face integrals. For planar faces with F32-quantized or integer-scaled vertices, these are exact polynomial sums that can be done with multi-limb U32 integers. For cylinders/cones the integrals are closed-form in trig of the trimming angles, which F32x2 handles at ~1e-14 relative error, orders below any GVP threshold. Store as decimal strings with enough digits (≥ 10 significant). INFERRED.
- **COPS ↔ certified print mesh:** wonky already certifies mesh deviation. COPS generation (points exactly on faces, sharp edges marked by a 1° normal jump) is a byproduct of the same sampler and could be emitted into STEP. Receivers will project them and report deviations, a free external check of the analytic geometry (INFERRED). Low priority: file size grows and few receivers evaluate COPS.
- **Bbox subtlety:** wonky's introspection/queries should expose *both* the tight box (exact extremes of analytic faces) and the CAx-IF agreed box (vertices+edges). Otherwise a correct kernel will "fail" bbox GVPs against receivers that follow the agreement (INFERRED).

## Pointers worth porting or studying

1. v4.6 §4.13.3 Fig.13 (p.27): industry OK/Not-OK thresholds; encode as a constant table in the STEP round-trip test.
2. §4.12 Fig.11 + Part 21 example (combined `REPRESENTATION('', (#vol,#area,#centroid), ctx)`): minimal entity pattern for the writer.
3. §8 Fig.21 (v4.6 p.38): exact magic strings for every property; copy verbatim.
4. §4.11: the agreed bbox algorithm; implement as `bboxCaxif()` next to `bboxTight()`.
5. §6.2: smooth/sharp classification with the 1.0° normal-jump rule and the projection semantics (smooth→nearest active face, sharp→nearest active sharp edge).
6. §7.2: notional-solid centroid (mean of transformed (10,10,10)); trivial to add if wonky grows assemblies.
7. Related: NIST STEP File Analyzer (sibling source `nist-step-file-analyzer-and-viewer-sfa`) reads and reports these GVPs; use it as a free receiver-side checker.

## Verdict: adopt

Adopt for **STEP exchange only**: emit part-level GVPs (volume, area, centroid, agreed bbox) with the v4.6 ID string, and gate STEP round-trip tests on the v4.6 industry thresholds (0.5%, 0.02 mm absolute centroid for small FDM parts). Do not reuse any of these thresholds for kernel Boolean/fillet regression. They are orders of magnitude too loose and statistically blind to local topology errors. Track v4.6, not v4.5.

