# ACIS R17 User Guide: "Booleans" technical article (Spatial Corp.)

- Kind: vendor user-guide article (online HTML documentation, R17), part of "Modeling Operations > Intersectors, Booleans, and Stitching".
- Canonical URL: http://www.q-solid.com/ACIS_Docs_R17/online/SPAacisuserTechArticles/SPAacisuser_mointrbool.htm. HTTP 200 with `curl -A "Mozilla/5.0"` on 2026-09-22. Read in full from the local copy `tmp/research/acis-r17/SPAacisuser_mointrbool.htm` / `.txt`.
- Other URLs:
  - http://www-isl.ece.arizona.edu/ACIS-docs/: HTTP 200 on 2026-09-22. It is an older ACIS online-documentation mirror with a JS frame and search; the exact version was not determined.
  - https://doc.spatial.com/index.php/Basic_Boolean_Operations: on 2026-09-22 this served only the Spatial documentation portal navigation (`tmp/research/acis-r17/spatial-basic-boolean.html`), with no article body. The current vendor text was not retrievable anonymously.
- Organization: Spatial Corp., "a Dassault Systèmes company". The page footer says "© 1989-2007". DOCUMENTED (local .htm).
- License: proprietary documentation. ACIS itself is a commercial, closed-source kernel. Porting implication: nothing can be linked or copied. The architectural ideas (four-stage Boolean, intersection graph as a wire, glue, fuzz, partial and selective Booleans) are generic, well-known concepts and are free to reimplement. Do not copy API names verbatim into public interfaces. INFERRED.
- Status: R17 is about 2007 vintage. ACIS is still sold by Spatial (the doc.spatial.com portal exists). The article describes stable, long-lived architecture. INFERRED from the copyright line and the portal.

## What it is

An architecture-level description of the ACIS Boolean component (BOOL) and its variants. DOCUMENTED on the canonical URL:
- unite, intersect, subtract, chop;
- slice and imprint;
- regularized and non-regularized results;
- glue, fuzzy Booleans, open-shell Booleans, embedded faces and wires;
- partial Booleans, selective Booleans (SBOOL), non-destructive Booleans.

It covers solids, sheets and wires, manifold and non-manifold. It contains Scheme and C++ API examples but no algorithms for SSI or classification; those live in the intersector articles (see `acis-r17-checker-and-intersectors-articles.md`).

## How it works

### Four stages. DOCUMENTED.
1. Intersect all faces and edges of both bodies into an **intersection graph**.
2. Imprint the graph on both bodies ("often splitting faces").
3. Decide which faces, shells and edges to keep or discard.
4. Join or un-join along the intersection edges, and reorganize shells and lumps.

**Chop** returns subtract and intersect results in one pass and is "more efficient" than running both. DOCUMENTED.

### Intersection graph. DOCUMENTED.
- A list of wires. Wires are "geometrically and structurally disjoint". There are no shells.
- Each edge carries one coedge per face of each body passing through it:
  - two coedges of opposite sense if the face passes through;
  - one if the curve lies on the face boundary.
- Coedges of the blank body form a partner ring. On a boundary edge, the graph coedges "correspond in number, sense, and order" with the body edge's coedges.
- If all coedges would have the same sense (sheet or incomplete body), a **dummy coedge** of converse sense is added.
- **Point intersections** are edges with no geometry and identical start and end vertices.
- Branching at a vertex is traversed by this rule: follow `next`, then search the partner ring for the opposite-sense coedge with a non-NULL `next`, and repeat.
- Tool-body coedges are linked the same way, but reached via an attribute on the edge.
- "Each topological entity in an intersection wire carries an attribute that relates it to corresponding entities in the original bodies. These attributes contain data essential to the operation of the later stages." This is the provenance record.

### Slice and imprint. DOCUMENTED.
- **Slice** turns the graph into a wire body with two coedge pairs, one per source body. It works on cellular bodies too. Uses: NC waterlines, drawing sections, contours.
- **Imprint** embeds the graph into both bodies. A closed loop becomes a new face; an open loop becomes a spur or a slit. Uses: edges for later sweeps, visualizing intersections, and debugging Booleans.

### Regularized vs non-regularized. DOCUMENTED.
- Regularized operates on interior point sets and "resolves many modeling tangency issues".
- Non-regularized adds three conditions:
  1. SINGLE_SIDED faces that become DOUBLE_SIDED BOTH_INSIDE stay;
  2. face-face coincident regions stay;
  3. no edge or vertex merging at the end.
- A table defines regularized sheet/solid and sheet/sheet results, for example "Sheet from solid: portion of sheet within solid interior embedded in solid" and "Sheet with sheet (coincident): two-dimensional unite".

### Glue. DOCUMENTED.
- A fast unite or subtract when "the intersection graph is known to lie precisely on a set of overlapping, coincident faces, and neither body penetrates the faces of the other body".
- The caller supplies all coincident face pairs. "It is essential that this information is accurate and complete, otherwise the results are undefined."
- The speedup comes from skipping surface-surface intersections.
- Example (twisted sweep, Scheme timer):
  - standard unite: 12.046 s;
  - glue: 3.328 s (the comment says "approximately 75%");
  - glue with `patch_and_face_cover`, `single_face_patch`, `non_trivial`: 1.469 s.
- API: `api_boolean_glue`; Scheme: `bool:glue-unite`, `bool:glue-subtract`.
- Glue options from the same example (DOCUMENTED, Scheme comments): `patch_and_face_cover` and `single_face_patch` may be set when the coincident face pair also has "coincident" edges and vertices (the pair covers exactly the same patch); `non_trivial` may be set "because the bodies lie outside of one another". Each option is a further caller-asserted fact that removes work. The speedup is stated to show mainly with many coincident faces or complex surfaces, not in simple examples.

### Fuzzy Booleans. DOCUMENTED.
- A **fuzz** distance marks entities as intended-coincident when they are not coincident within `resabs`. Without it you get "sliver faces, ... performance problems, or even fail completely".
- A fuzz below `resabs` is ignored.
- Pairs (edge-face, edge-edge, face-face) coincident within the fuzz but not within `resabs` are forced coincident by creating tolerant entities.
- Tolerances are created only where needed, at "the minimum tolerance necessary to enforce coincidence".
- The fuzz may be ignored "if forcing coincidence would result in the creation of bad geometry".
- API: `BoolOptions::set_near_coincidence_fuzz(double)`; Scheme option `"near_coi_fuzz"`.

### Open shells and embedded entities. DOCUMENTED.
- A single-sided open shell acts "like a half-space" if the intersection curve lies entirely within it.
- Embedded faces are 2D voids ("slit"); embedded edges are 1D voids ("worm hole"). Both participate in later Booleans: in a unite, embedded portions that end up inside the other body are removed; subtracting a body with embedded faces or wires from a solid leaves them as external faces or wires.

### Partial Booleans. DOCUMENTED.
These gain "prior knowledge about the result": which face pairs to intersect and, optionally, the intersection curves themselves.

Pipeline:
- `api_boolean_start`
- then `api_selectively_intersect` (face-pair arrays) or `api_update_intersection`
  - `api_update_intersection` supplies known intersection edges, builds a `surf_surf_int` from them and attaches `ATTRIB_FACEINT` so that SSI is skipped for that pair;
- then one of `api_slice_complete`, `api_complete_intersection_graph`, `api_imprint_complete`, `api_imprint_stitch_complete`, `api_boolean_complete`, `api_boolean_chop_complete`;
  - `api_imprint_stitch_complete` reuses the imprint edges instead of re-detecting them, so it is faster than imprint followed by stitch.

Also `api_bool_make_intersection_graph`: runs stage 1 with all face-face intersections and returns the graph as a wire body "with Boolean attributes so it is ready to be imprinted" (unlike `api_slice_complete`, whose wire is for general use and cannot complete a Boolean). DOCUMENTED.

Use cases: a pattern of features on a planar face; editing a feature without topology change. The Scheme example ends with `(entity:check c1 70)`, a level-70 (face-face) check right after a partial Boolean.

C++ Example 1 builds the candidate list as the full cross product: `intersectionCount = blankCount * toolCount`, two parallel `FACE*` arrays, then one `api_selectively_intersect(intersectionCount, toolFaceArray, blankFaceArray)` call. DOCUMENTED. INFERRED: the stage-1 interface is literally "an array of face pairs", i.e. a flat, uniform work list; culling is the caller's (or the kernel's) business.

### Selective Booleans (SBOOL). DOCUMENTED.
- A non-regular unite produces cellular topology plus a cell connectivity graph. The example has 8 cells labelled by tool/blank origin.
- The application picks cells, or subsets the graph using the graph-theory component. The result is regularized.
- It builds on generic attributes, 2D convert, enclose and regularize.

### Non-destructive Booleans. DOCUMENTED.
`NDBOOL_KEEP_BOTH` (and variants) avoid copying inputs when the tool is reused or the edit is local. Available via `api_boolean`, `api_boolean_chop_body`, `api_boolean_glue` and the partial APIs.

## Robustness and guarantees

- DOCUMENTED:
  - Glue and partial Booleans shift correctness responsibility to the caller; wrong or incomplete face pairs make results "undefined".
  - The fuzz is a *bounded* tolerance mechanism: minimum-necessary tolerance, capped at the fuzz, and skipped if it would create bad geometry.
  - Regularization is cited as the tangency-resolving mechanism.
- Not covered: no numeric guarantees, precision model or SSI robustness claims beyond the fuzz text. INFERRED.
- ACIS resolution constants. DOCUMENTED (verified 2026-09-23 in the R17 "Tolerance Variables" article, http://www.q-solid.com/ACIS_Docs_R17/online/SPAacisuserTechArticles/SPAacisuser_totol.htm, local copy `tmp/research/acis-r17/SPAacisuser_totol.htm`):
  - `SPAresabs` = 1e-6 model units, "the distance below which ACIS considers two points to be coincident"; chosen "assuming that at least an order of magnitude guard band around SPAresabs is required".
  - `SPAresnor` = 1e-10, so the largest representable quantity is resabs/resnor = 1e4.
  - `SPAresfit` = 1e-3, the fit tolerance for stored polynomial approximations of procedural curves and surfaces.
  - `SPAresmch` = 1e-11, since a 1e4 box with 1e-6 features needs 1e-10 relative resolution, with one decade of slack.
  - The fuzz text above ("fuzz below resabs is ignored") refers to this `SPAresabs`.

## Parallelism and performance

- DOCUMENTED: the only numbers are the glue timings (12.046 → 3.328 → 1.469 s, one machine, "timings will vary").
- DOCUMENTED: the performance levers are fewer SSI calls (glue, `api_update_intersection`, selective face pairs), fewer copies (non-destructive), and a combined pass (chop, imprint-stitch).
- Threading is not mentioned in the R17 article. Later vendor sources (DOCUMENTED, secondary vendor blog posts, fetched 2026-09-24):
  - "Multi-processing in ACIS and CGM" (Spatial blog, 2011-02-23, https://blog.spatial.com/3d-modeling/3d-acis/cgm/multi-processing-acis-and-cgm): CGM ships "multi-process face-face intersections in the CGM Boolean operator"; ACIS uses threads (a multi-threaded entity-point-distance API) because CGM "does not need to be thread-safe" but pays inter-process data transfer. No speedup numbers.
  - "Seven Years of Thread Safe 3D ACIS Modeler" (Spatial blog, 2016-04-27, https://blog.spatial.com/3d-acis/seven-years-thread-safe-3d-acis-modeler): thread safety via thread-local storage; "3D ACIS Modeler must be initialized on each thread used. The ENTITYs modified must be on different history streams." Measured: faceting one body with six threads about 2x; faceting many bodies concurrently 6-7x; a refactored `api_stitch` 10% faster serially.
  - INFERRED: as in Parasolid, the only parallelized Boolean stage in either Spatial kernel is the face-face intersection over candidate pairs. The imprint/select/join graph work stays serial, and model-level parallelism requires disjoint history streams (ACIS) or partitions locked to threads (Parasolid).

## Known failures, limitations, war stories

- DOCUMENTED:
  - "Undefined" results when the glue face-pair list is incomplete.
  - The fuzz can be silently ignored ("if forcing coincidence would result in the creation of bad geometry"). This is silent behaviour change, a war-story-grade gotcha.
  - Open-shell Booleans are "limited": the shell must extend beyond the other body on all sides.
- The need for fuzzy Booleans is itself the war story: near-coincident inputs such as a B-spline approximation of exact geometry create slivers or fail. DOCUMENTED motivation.
- Independent modern confirmation that coincidence is the hard case: Zoo's engine (2025-2026) fails unions of exactly coplanar, touching bodies. DOCUMENTED, https://github.com/KittyCAD/modeling-app/issues/7485, Zoo's CEO: "this the coplanar bug, when things are perfectly aligned on the same [plane] csg will fail". It also fails intersections of coaxial revolved solids (issue #10621) and has an order-dependent subtract (#13438). A kernel without a glue or fuzz concept rediscovers exactly the failures this article's options address. See `zoo-kittycad-cad-engine-overview-gpu-surface-surface-interse.md`.

## Relevance for wonky

1. **The intersection graph with provenance attributes is contract 1 of `docs/boolean-strategy.md`.**
   - An explicit, disjoint wire set is built once per operation. Every entity carries a link to its source faces, edges and vertices, and later stages consume it.
   - Point intersections are represented as degenerate edges. This is useful for wonky's tangent-contact cases, where plane and cylinder touch along a line or at points.
   - INFERRED.
2. **Glue as a FeatureScript fast path.**
   - FeatureScript extrudes from sketch planes often produce exactly coincident faces known by construction (same sketch plane, same offset expression).
   - Wonky can carry "coincident-by-construction" face pairs from the frontend into the Boolean and skip SSI.
   - Unlike ACIS, it should *verify* the pairs cheaply (plane equality under exact predicates) and fail explicitly if they are wrong, instead of returning "undefined".
   - INFERRED.
3. **Fuzz = wonky's explicit contact bound.**
   - Wonky's "tolerated-regularized, Kontaktobergrenze 1e-7 mm" mode (`local design note`) is conceptually the ACIS fuzz: minimum-necessary tolerances, capped by a user-visible bound.
   - The ACIS clause "the fuzz may be ignored" must *not* be copied. Wonky's rule is explicit failure, and the 2026-09-24 product decision adds that the failure reports the tolerance that would have been needed (`docs/entscheidungen.md` item 10: no silent tolerance growth). ACIS already computes that number ("the minimum tolerance necessary to enforce coincidence"), so reporting it costs nothing. INFERRED.
4. **Partial Booleans for FeatureScript regeneration.**
   - `api_update_intersection` (known curves attached, SSI skipped) fits pattern features and replay of unchanged features.
   - With wonky's pure data model, a previous operation-scoped record can be reused keyed by input hashes. INFERRED.
5. **SBOOL / cellular result.** A "general fuse, then select cells" design (as in OCCT's General Fuse) would make multi-body FeatureScript operations such as `opBoolean` with several tools and `opSplitPart` one algorithm. INFERRED.
6. **Slice** gives FDM layer contours for free once the intersection graph exists. It is a useful side product for wonky's FDM focus. INFERRED.
7. **Where the intersection graph sits in the hybrid.** In wonky's chosen corefine + recover hybrid (`docs/proto-recover.md`, `docs/hybrid-boolean-plan.md`), the tagged mesh Boolean decides topology and `recover` lifts runs to exact curves. The ACIS intersection graph is the natural *explicit* artefact between the two: one wire per connected intersection component, edges with exact curve records (`line`/`circle`/`ellipse`, or a refusal naming the missing curve), per-face coedges with sense, degenerate edges for point contacts, and provenance to source faces. Today that information is implicit in recover's runs and loops. Materializing it would give slice (sections), imprint (edge-only operations, debugging), and a stable diff target for the viewer. INFERRED.
8. **Stage-1 as a flat pair array.** ACIS's own example passes the full cross product of faces as two parallel arrays. Wonky's Bend version should do the same after a Morton/BVH broad phase: a flat candidate array bucketed by carrier-type pair, then one uniform map per bucket (GPU), then a deterministic sort. INFERRED.
9. **Multiple tools.** Parasolid unites several tools into one before the Boolean (see the Parasolid overview note, §4.2); ACIS's SBOOL instead builds one non-regular cellular result and selects cells. For FeatureScript `opBoolean` with many tools (patterns of holes), the cellular route avoids n sequential Booleans and their order dependence (compare Zoo #13438, an order-dependent subtract). INFERRED.

## Pointers worth porting or studying

- The four-stage decomposition and the chop combined pass.
- Intersection-graph structure:
  - per-face coedges;
  - dummy converse coedges for sheets;
  - degenerate edges for point contacts;
  - the branch-traversal rule;
  - provenance attributes.
- The non-regularized three-condition definition. It is a precise spec for a wonky "keep boundary" mode used for compare and interference output.
- Fuzz semantics: ignore below resolution; create the minimum-necessary tolerance; cap at the fuzz. Replace "ignore fuzz if bad geometry" with an explicit error.
- Partial API staging (start → selective intersect / update intersection → complete), as a model for incremental regeneration.

## Verdict: adapt

The article documents a mature architecture that maps almost 1:1 onto wonky's four Boolean contracts: intersection graph with provenance, bounded tolerance (fuzz), known-coincidence fast path (glue), cell selection (SBOOL).

Two ACIS behaviours conflict with wonky's rules and must be changed:
- "undefined" results on wrong caller hints;
- silently ignored fuzz.

It is proprietary documentation with no code, so reimplement the ideas and link nothing.
