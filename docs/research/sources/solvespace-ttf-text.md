# SolveSpace TrueType text (`src/ttf.cpp`)

- Kind: repository code. Canonical: [solvespace/solvespace `src/ttf.cpp`](https://github.com/solvespace/solvespace/blob/master/src/ttf.cpp) (449 lines). Local clone: `tmp/research/solvespace-srf/ss/src/ttf.cpp` (HEAD `cbff7a9112bb`, 2026-09-16).
- Authors: whitequark, Peter Barfuss (copyright line 2016).
- License: **GPL-3.0** (`COPYING.txt`). Learn-from only; no code into wonky.
- Status: active project; text code stable.

## What it is

A parametric 2D/3D CAD kernel that turns TrueType text into its own exact curve type. Header comment (DOCUMENTED): "Routines to read a TrueType font as vector outlines, and generate them as entities, since they're always representable as either lines or quadratic Bezier curves."

## How it works (DOCUMENTED from source)

- FreeType, `FT_LOAD_NO_BITMAP | FT_LOAD_NO_HINTING`, size requested via `FT_Request_Size` (vertical resolution 128).
- **Height = cap height of 'A':** loads glyph `A`, `capHeight = bbox.yMax` of its outline (fallback: requested height "this is likely wrong"); the user's text height maps to that, `data.factor = 1/capHeight`.
- `ConicTo` → `SBezier::From(p0, c, p1)`: a **degree-2 Bezier kept as-is** in SolveSpace's rational Bezier curve type (`SBezier`, up to degree 3); `CubicTo` → degree-3 `SBezier`.
- Optional kerning via `FT_Get_Kerning(..., FT_KERNING_DEFAULT)`; the code comment admits it is used as "a really hacky pseudo-track-kerning".
- Extrusion of the resulting curves creates SolveSpace NURBS surfaces (`SShell::MakeFromExtrusionOf` → `SSurface::FromExtrusionOf`, `src/srf/shell.cpp:17`, `surface.cpp:11`), which then go through its general surface Boolean (`srf/boolean.cpp`; see `solvespace-nurbs-boolean-src-srf-boolean-cpp-surfinter-cpp-r.md`).

## Robustness and guarantees

Exact curve carriers; all robustness is deferred to SolveSpace's tolerance-based NURBS Boolean (chord tolerance, known to fail on many near-tangent configurations per that note).

## Parallelism and performance

Not measured.

## Known failures, limitations, war stories

Inherits SolveSpace Boolean fragility; text Booleans on small lettering are a classic source of "didn't generate" errors in its forum (HEARSAY).

## Relevance for wonky

Evidence that a kernel can carry text exactly as degree-2 Beziers end to end, including extrusion, without arc approximation. Shows the other half of the risk: once walls are general NURBS, every Boolean needs general SSI. wonky should keep the parabola as a *named* analytic carrier (parabolic cylinder, a quadric) so that the dominant case (walls perpendicular to a planar target face) reduces to 2D predicates plus plane/quadric sections, instead of general NURBS SSI.

## Pointers worth porting or studying

`TtfFont::LoadFromFile` (cap-height calibration), `TtfFont::PlotString` (pen advance, kerning), `ConicTo`/`CubicTo`.

## Verdict: learn-from
