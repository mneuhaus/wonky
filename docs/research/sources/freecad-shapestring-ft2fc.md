# FreeCAD ShapeString (`FT2FC.cpp`)

- Kind: repository code + issue tracker. Canonical: [FreeCAD/FreeCAD `src/Mod/Part/App/FT2FC.cpp`](https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/Part/App/FT2FC.cpp) (480 lines; copy `tmp/research/sktext/freecad/FT2FC.cpp`), Draft ShapeString (Python) on top. Issues: [#21501](https://github.com/FreeCAD/FreeCAD/issues/21501), [#19304](https://github.com/FreeCAD/FreeCAD/issues/19304), [#16809](https://github.com/FreeCAD/FreeCAD/issues/16809), [#29930](https://github.com/FreeCAD/FreeCAD/issues/29930), [#26015](https://github.com/FreeCAD/FreeCAD/issues/26015).
- Organization: FreeCAD community (FT2FC originally by WandererFan, 2013).
- License: LGPL-2.1+. Learn-from only.
- Status: active; ShapeString issues keep arriving (2025-2026).

## What it is

FreeCAD's text-to-geometry: FreeType outlines → OCCT edges → wires per glyph, faces built later in Python (`MakeFace`, optional `Fuse`).

## How it works (DOCUMENTED from source)

- `FT_Load_Char` with `FT_LOAD_DEFAULT | FT_LOAD_NO_BITMAP` (hinting allowed) at `FT_Set_Char_Size(0, 48·64·10, 0, 0)` ("increased 10X to preserve very small details").
- Scale: `scalefactor = (stringheight / FTFace->height) / 10`, so the user's "Size" is measured against the face's line height (ascender − descender + line gap), not cap height or em.
- Kerning: `FT_Get_Kerning(..., FT_KERNING_DEFAULT)` (grid-fitted legacy `kern`), plus a user `tracking` per character.
- Curves: each conic becomes a 3-pole `Geom2d_BezierCurve` converted to `Geom2d_BSplineCurve` (`ShapeConstruct_Curve::ConvertToBSpline`, `Precision::Confusion()`), cubic likewise with 4 poles; edges on a plane; wires orientation set by a heuristic (`TopAbs_REVERSED` for some wires).

## Robustness and guarantees

None stated; face construction and fusion are left to generic OCCT tools.

## Parallelism and performance

Not measured.

## Known failures, limitations, war stories

- #21501: with Gabriola.ttf "no faces are generated, 'Make Face' has no effect and therefore 'Fuse' has no effect"; maintainer: "It was an issue with the font."
- #19304: padding a ShapeString made the whole body disappear ("may just be a contiguous solid issue", i.e. separate glyph solids).
- #16809: "faces.concatenate can return a Face or a Compound. The code did not take that into account."
- #29930 tapered extrusion issues; #26015 no right-to-left shaping; #5593 no wrapping onto curved surfaces.

## Relevance for wonky

A catalogue of what goes wrong when text is treated as "wires, then hope MakeFace/Fuse cope": font-dependent contour orientation, overlapping glyphs, multi-solid results. wonky should build glyph regions with its own exact classification (nonzero winding on the lattice) and emit one profile per string, refusing explicitly when premises fail. Also a warning that "text size" means different things in every CAD system (FreeCAD: line height; SolveSpace: cap height of 'A'; Onshape: box = 0.72 em; OCCT: requested glyph size, presumably em, INFERRED): wonky must implement Onshape's.

## Pointers worth porting or studying

`getGlyphContours`, `quad_cb`, `cubic_cb`, `getKerning` in `FT2FC.cpp`.

## Verdict: avoid (as a model), learn-from (failure catalogue)
