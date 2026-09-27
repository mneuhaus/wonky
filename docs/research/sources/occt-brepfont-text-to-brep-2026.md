# OCCT BRepFont: FreeType glyphs to planar B-rep faces (2026 rework)

- Kind: repository code. Canonical: [Open-Cascade-SAS/OCCT](https://github.com/Open-Cascade-SAS/OCCT) `src/Visualization/TKV3d/BRepFont/{BRepFont_Builder,BRepFont_PlanarRegion,BRepFont_Regularizer}.{hxx,cxx}`, `src/Visualization/TKV3d/StdPrs/StdPrs_BRepFont.{hxx,cxx}`, `src/Visualization/TKService/Font/{Font_FTFont.cxx,Font_GlyphOutline.hxx}`. Copies: `tmp/research/sktext/occt/`. Introduced/reworked by commit `8ab68fe939` "Visualization - Rework BRep font and text construction (#1485)", 2026-08-23.
- Organization: OPEN CASCADE SAS; 2910 stars; last push 2026-09-05.
- License: **LGPL-2.1 with the OCCT exception**. Porting code into wonky (a standalone Bend program, not a dynamically linked library) would pull LGPL obligations; treat it as learn-from (ideas, status taxonomy), not code.
- Status: current master; the previous `Font_BRepFont` (2013-2025) is what build123d/CadQuery `Text` used through OCCT 7.x.

## What it is

The text path of the kernel behind build123d, CadQuery and FreeCAD: glyph outline → validated planar region → `TopoDS_Face` with holes on a `Geom_Plane`, positioned by a text plan (layout), optionally extruded by the caller (`BRepPrimAPI_MakePrism`, giving `Geom_SurfaceOfLinearExtrusion` walls over the Bezier curves; INFERRED from standard OCCT usage, not read here).

## How it works

- **Outline source (DOCUMENTED, `Font_FTFont.cxx:264`):** `FT_LOAD_NO_SCALE | FT_LOAD_NO_HINTING | FT_LOAD_NO_BITMAP`, i.e. **unscaled font design units** (exact integers), decomposed into `Font_GlyphOutline` segments `Line`, `QuadraticBezier`, `CubicBezier` (`Font_GlyphOutline.hxx:105-167`) plus `FillRule {NonZero, EvenOdd}` from `FT_OUTLINE_EVEN_ODD_FILL` and `HasPossibleOverlaps` from `FT_OUTLINE_OVERLAP` (l.291-296).
- **Regularizer (DOCUMENTED, `BRepFont_Regularizer.{hxx,cxx}`):** statuses `Success, Empty, InvalidOutline, OpenContour, IntersectingContours, SelfIntersectingContour`; tolerance "in the same design-unit coordinate system as the input outline", default 1e-7. Steps: append contours, snapping the last segment's end to the contour start if within tolerance ("healing", with signed-area bookkeeping, l.400-470); reject zero-area loops; find intersections with `Geom2dAPI_InterCurveCurve` (self and pairwise, box-filtered, l.756-950); if any and the outline is **not** marked overlapping → `IntersectingContours` failure; if marked → keep the intersecting loops "as separate output regions" (no union is computed); self-intersection → failure. `classifyLoops` builds a containment tree by area and point-in-loop tests, then winding = parent winding ± 1 by orientation, filled iff `winding != 0` (NonZero) or odd (EvenOdd) (l.1280-1320).
- **Builder (DOCUMENTED, `BRepFont_Builder.cxx`):** each segment becomes an exact `Geom2d_BezierCurve` of degree 2 or 3 (3 or 4 poles, scaled by size/upem) as the pcurve on `Geom_Plane(XOY)`; optionally each contour is concatenated into one C0 B-spline edge (`Geom2dConvert_CompCurveToBSplineCurve`, option `ToConcatenateContours`). Faces are built with an outer wire and hole wires.
- **Layout:** `Font_TextFormatter`; kerning via `FT_Get_Kerning(..., FT_KERNING_UNFITTED)` (legacy `kern` table only, no GPOS; `Font_FTFont.cxx:1087-1117`).

## Robustness and guarantees

Explicit failure statuses instead of silently broken faces; containment classification is area-ordered; intersection detection uses OCCT's numeric curve-curve intersector with an absolute tolerance, so near-tangent contours are tolerance-dependent (INFERRED). Overlapping contours are *not* merged, so a variable-font glyph yields overlapping faces that a later Boolean must fuse.

## Parallelism and performance

Glyph regions are cached per (font, glyph, size) (`StdPrs_BRepFontCache`) and reused for repeated glyphs via positioned occurrences; no numbers published.

## Known failures, limitations, war stories

- The pre-2026 `Font_BRepFont` produced wires that `BRepBuilderAPI_MakeFace` sometimes mis-oriented for fonts with unusual contour directions; downstream tools (FreeCAD ShapeString, build123d) accumulated workarounds (FreeCAD issue [#16809](https://github.com/FreeCAD/FreeCAD/issues/16809): "faces.concatenate can return a Face or a Compound"). HEARSAY for the OCCT-side root cause; the rework's explicit statuses read as a response to exactly these classes.
- Kerning differs from Onshape (OCCT kerns, Onshape does not), so build123d text will not match Onshape layout.

## Relevance for wonky

The best current design reference for "text as exact geometry" in an open B-rep kernel, and it confirms the approach: keep glyphs as exact degree-2 Bezier curves on a plane, work in integer design units, classify loops by containment + winding, and **fail explicitly** on intersecting contours unless overlap handling is implemented. wonky should copy the status taxonomy (OpenContour, IntersectingContours, SelfIntersectingContour, InvalidOutline, Empty) as user-visible refusals, but do the predicates exactly on the 26.6 lattice instead of with a 1e-7 tolerance, and add the one thing OCCT still does not: a true nonzero union across overlapping contours and across glyphs (needed for `KA`-type collisions).

## Pointers worth porting or studying

- `BRepFont_Regularizer.hxx` (status enum and contract comments), `.cxx` `appendOutline`, `classifyLoops` (l.1280-1320 winding propagation), `intersections` (l.756+).
- `BRepFont_Builder.cxx` `makeCurve2d` (l.70-110), face assembly with holes (~l.600-680).
- `Font_GlyphOutline.hxx` as a minimal glyph data model (segments + contour ranges + fill rule + overlap flag + upem).

## Verdict: learn-from

Right architecture and failure taxonomy; LGPL and tolerance-based predicates make it unsuitable to port verbatim.
