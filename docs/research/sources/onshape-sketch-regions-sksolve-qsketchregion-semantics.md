# Onshape sketch regions: `skSolve`, `qSketchRegion(id, filterInnerLoops)` and what the kernel returns

- Kind: vendor std library source + vendor help pages + vendor staff forum answers + own corpus measurement.
  - Std source: `sketch.fs`, `query.fs` and `featurescriptversionnumber.gen.fs` of the FS std library, via the local mirror `tmp/research/onshape-std-3083/repo` ([yepher/feature_script_std](https://github.com/yepher/feature_script_std), commit `18e5c7f`, 2026-09-22, FS 3083; header "distributed under the MIT License", © PTC).
  - Official docs: [FS Standard Library documentation](https://cad.onshape.com/FsDoc/library.html); help pages [Extrude](https://cad.onshape.com/help/Content/PartStudio/extrude.htm), [Construction](https://cad.onshape.com/help/Content/Sketch/construction.htm).
  - Forum: [5904](https://forum.onshape.com/discussion/5904/qsketchregion-with-filterinnerloops), [11934](https://forum.onshape.com/discussion/11934/featurescript-how-to-extrude-outermost-regions-of-text-sketch-without-including-interior-cutouts), [5302](https://forum.onshape.com/discussion/5302/text-sketching-qsketchregion-filterinnerloop-detection-bug), [22826](https://forum.onshape.com/discussion/22826/trying-to-extrude-text-but-cant-filter-out-inner-loops).
- Organization: Onshape / PTC. `@skSolve` and the region builder are closed (Parasolid-backed); only the doc comments and version flags are public.
- License: the std library is MIT (file header); the behaviour is a specification for wonky to reimplement. Nothing to port.
- Status: stable API. Version flags record the history: `V71_SKETCH_REGION_QUERY_UPDATE`, `V87_SKETCH_REGION_ORDERING`, `V140_SKETCH_REGION_VIA_FLOOD_FILL`, `V244_SKETCH_REGION_UPDATE`, `V539_SKETCH_CONICS`, `V1073_REFINE_SKETCH_INTERSECTIONS` (`featurescriptversionnumber.gen.fs` l.82, 98, 151, 243, 467, 792).

## What it is

The contract wonky's FeatureScript frontend must honour when a sketch contains more than one closed walk: holes, nested loops, overlapping circles, crossings, slots, text, construction geometry.

## How it works (DOCUMENTED unless marked)

- **`skSolve` output** (`sketch.fs` l.40-46): "all edges of the sketch will become `WIRE` bodies ... Any regions enclosed in the sketch will become `SURFACE` bodies ... Any vertices which are not edge endpoints (such as points created by `skPoint` or the center point of `skCircle`) will become `POINT` bodies."
- **`qSketchRegion(featureId, filterInnerLoops = false)`** (`query.fs` l.1773-1793): "A query for all fully enclosed, 2D regions created by a sketch." `filterInnerLoops`: "Specifies whether to exclude sketch regions fully contained in other sketch regions. A region whose border has a vertex or edge on the outside boundary is not considered 'contained.'"
- **Regions are arrangement faces, not loops.** Ilya Baran (Onshape VP Architecture), forum 5904: for a small rectangle inside a large one, "the sketch faces are (small rectangle, large rectangle minus small rectangle), not two overlapping rectangles".
  - `qContainsPoint` on a point inside the big rectangle's ring selects only the ring face; a point on the shared border selects both faces (cory_isaacson, same thread; HEARSAY-level user report, consistent with closed-set containment).
- **Whole-sketch extrude == `filterInnerLoops = true`.** Kevin O'Toole (Onshape), forum 11934: with `true` "that query resolves to the outer entities only, not the holes in the middle, just like our extrude feature does when you select a sketch." Help (Extrude): "Onshape automatically selects all the closed regions in the sketch, and if present, nested entities."
- **One nesting level only (INFERRED from the documented rule, confirmed by user reports).** The rule removes any region contained in another region's outer boundary without touching it. So in "©", "ʘ" or a ring with an island, the island is dropped as well.
  - Forum 5302 (brian_guan): filterInnerLoops "is not really detecting glyphs with any internal feature e.g. the inner C in the Copyright symbol"; Onshape (kevin_o_toole_1) agreed a better rule would help and filed a bug.
  - A user workaround there peels faces by rank (outermost = rank 1, and so on) and deletes even ranks: an **even-odd nesting parity**.
  - Whether Onshape changed the rule (`V244_SKETCH_REGION_UPDATE`?) is unknown; the doc text still states the containment rule.
- **Construction geometry** does not form regions: "Construction geometry are sketch entities used in creating other geometry but not used in creating features" (help page). The forum workaround for regions from construction lines is to split and convert segments.
- **Imprinting:** `newSketch` on a face imprints the face's edges into the sketch unless `disableImprinting: true` (`sketch.fs` l.142-159). `newSketchOnPlane` (a mathematical plane) has nothing to imprint.
- **Tolerance:** FS `TOLERANCE.zeroLength` = 1e-8 m and Parasolid session precision 1e-8 m (DOCUMENTED in [commercial-kernels](../commercial-kernels.md) l.318-320). The region builder's own tolerance is not documented. INFERRED: Parasolid-tolerant, i.e. endpoints and tangencies within ~1e-8 m count as incident.
- **Text:** the corpus always extrudes `skText` via `qSketchRegion(id, true)`. Overlapping glyph pairs create extra "lens" regions that are still extruded ([skText note](onshape-sktext-layout-measured-from-step-export.md)).

## Robustness and guarantees

Unknown internals. Observable guarantees: every bounded face of the non-construction curve arrangement becomes a region; regions of one sketch do not overlap (they share edges); order was changed by `V87_SKETCH_REGION_ORDERING` (so region *order* is versioned and should not be relied on).

## Parallelism and performance

Not documented.

## Known failures, limitations, war stories

- filterInnerLoops ignores nesting parity (5302), and text inner loops misbehave after transforms unless a robust query is taken right after `skSolve` (22826, accepted workaround `makeRobustQuery(context, qSketchRegion(sketchId, true))`).
- Shared-edge nesting confuses users: a smaller rectangle sharing an edge with a larger one is *not* filtered (5904). This is by the documented rule, but surprising.

## Measured corpus demand (this session, `~/Workspace/cad`, 606 `.fs` files, grep)

- `qSketchRegion` appears in 486 files, 3,132 calls: 1,254 with explicit `false`, **230 with explicit `true` (217 files)**, the rest single-argument (= false).
- `qContainsPoint` has 421 calls, but none directly on `qSketchRegion`. `"construction" : true` appears in 14 files; `skText` in 174 files; `newSketchOnPlane` in 500 files vs `newSketch(` in 3 (imprinting is practically unused); `disableImprinting` in 0.
- `skSpline`/`skBezier`/`skConicSegment`/`skEllipticalArc`: 0 files. `skEllipse`: 24 files (task brief).
- Implication (INFERRED): the dominant patterns are "all regions" (`false`, which extrudes nested disks too, i.e. union) and "outer minus holes" (`true`, text and plates with holes). Selecting single regions by point is rare in FS code.

## Relevance for wonky

- **Specification to implement (INFERRED from the above):**
  1. Build the arrangement of all non-construction sketch curves (lines, arcs, circles, ellipses, text quads), with tolerance-aware incidence at Onshape's scale.
  2. Regions = bounded faces with outer boundary + holes (inner CCBs); isolated components nest into faces.
  3. `filterInnerLoops = true` drops every face whose closure lies inside the outer boundary of another face and does not touch that boundary.
  4. `qSketchRegion` returns faces, never loops. Adjacent faces extruded together fuse into one body.
  5. Construction curves, points and circle centers never split faces.
- **Versioning:** implement the documented single-level rule as `filterInnerLoops` semantics v1. Optionally offer a parity rule as a *separate, named* wonky extension, never silently.
- **Diagnostics for LLM users:** report faces with their provenance (which sketch entities bound them), the nesting tree, and which faces `filterInnerLoops` removed and why ("inside outer boundary of face F2, no contact").
- **Plugs in:** `kernel/sketch-lines.bend` and `kernel/sketch-arcs.bend` admission (today one closed walk), extrude caps with inner loops, text, 2D Booleans.

## Pointers worth porting or studying

- `query.fs` l.1773-1793 (the exact doc text of the rule); `sketch.fs` l.40-46 (skSolve output bodies), l.142-159 (imprinting).
- `featurescriptversionnumber.gen.fs` region-related flags (history of behaviour changes).
- Forum 5904 (face structure statement by Onshape architecture), 11934 (extrude equivalence), 5302 (nesting parity limitation and rank-peeling workaround).

## Verdict: **adopt** (as the behavioural specification)

This is the contract. wonky must reproduce faces-of-the-arrangement regions and the documented single-level `filterInnerLoops` rule. The open question (does Onshape now use parity?) needs one probe document in Marc's Onshape account: "ʘ"-style nested circles with `qSketchRegion(id, true)`, then count the faces.
