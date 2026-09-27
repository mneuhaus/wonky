# fontTools: pens, `glyf` object model, cu2qu / qu2cu

- Kind: repository (Python library). Canonical: [github.com/fonttools/fonttools](https://github.com/fonttools/fonttools). Files read (fetched from `main`, 2026-09-24) into `tmp/research/fonttools/`: `Lib/fontTools/pens/basePen.py`, `pens/ttGlyphPen.py`, `ttLib/tables/_g_l_y_f.py`, `cu2qu/cu2qu.py`, `qu2cu/qu2cu.py`, `LICENSE`.
- Authors: Just van Rossum (original), Behdad Esfahbod, Cosimo Lupo et al.; ≥100 contributors, 5259 stars, release 4.66.0 on 2026-09-23 (gh api).
- License: **MIT** ("Copyright (c) 2017 Just van Rossum"). Ideas and code may be ported with the notice.
- Status: the de-facto standard font engineering library (Google Fonts toolchain, fontmake); very active.

## What it is

Read/write access to every OpenType table plus a "pen" protocol for outlines (`moveTo`, `lineTo`, `qCurveTo(*points)`, `curveTo`, `closePath`), converters between quadratic and cubic outlines with explicit tolerances, and many utilities (bounds, area, overlap removal via skia-pathops in `removeOverlaps`).

## How it works

- **Quadratic runs (DOCUMENTED, `basePen.py:424` `decomposeQuadraticSegment`):** a `qCurveTo` with n off-curve points becomes n atomic quads; implied on-curve points are `(0.5·(x + nx), 0.5·(y + ny))`. A TrueType contour with no on-curve point is passed as `qCurveTo(..., None)`.
- **`_g_l_y_f.py`:** `Glyph.getCoordinates(glyfTable)` returns (coordinates, endPts, flags) with composites flattened; `glyph.flags[0] & 0x40` is `OVERLAP_SIMPLE`. Used here for `dumpglyphs.py` / `ascii.py` / `fontinfo.py` in `tmp/research/sktext/`.
- **cu2qu (DOCUMENTED, `cu2qu.py`):** `curve_to_quadratic(curve, max_err)` tries n = 1..`MAX_N`(100) quadratic pieces; for each n it splits the cubic uniformly (`split_cubic_into_n_iter`), builds quadratic control points (`cubic_approx_control`), takes implied on-curve points as midpoints, and accepts when `cubic_farthest_fit_inside(0, c1 − q1', c2 − q2', 0, tolerance)` holds. That test works on the *difference* between the cubic and the degree-elevated quadratic (itself a cubic Bezier with zero end points) and recursively subdivides until both inner control points are within `tolerance` of the origin, returning false as soon as a curve point exceeds it. By the convex-hull property this is a **sufficient** (conservative) check that the parametric distance ≤ tolerance.
- **qu2cu:** the inverse (merge quadratic splines into cubics with `max_err`, default 0.5 font units), with `elevate_quadratic` (exact degree elevation).
- **TTGlyphPen:** builds `glyf` glyphs from pen calls, optional `dropImpliedOnCurves`.

## Robustness and guarantees

Integer font-unit input; converters use complex doubles. cu2qu's acceptance test is a certified upper bound (parametric, hence also Hausdorff) under exact arithmetic; with doubles it is robust in practice. `ApproxNotFoundError` when 100 pieces do not suffice (explicit failure).

## Parallelism and performance

Per-glyph, pure-Python or Cython; cu2qu is used on whole font families in production builds. No numbers taken (benchmark running on this machine).

## Known failures, limitations, war stories

`kern` subtable length overflow warning on Open Sans v1.10 ("subtable longer than defined: 112178 bytes instead of 46642"), which fonttools tolerates. Python-only: not a runtime dependency candidate for wonky production code (and the machine rule forbids calling `python3` directly; `uv run --with fonttools` worked for extraction).

## Relevance for wonky

- **Tooling, not kernel:** the natural generator of a pinned "glyph pack" (integer contours, advances, cmap subset, font sha256) consumed by Bend. The pack is data, like a fixture; production geometry (layout, lattice rounding, regions, extrusion) stays in Bend.
- **CFF/CJK path:** cu2qu is the proven way to turn cubic CFF outlines (the four `NotoSansCJK*.otf` in Onshape's list) into quadratics with an explicit tolerance, keeping wonky's carrier set to parabolas. The error bound maps to wonky's "approximations need explicit tolerances" rule; record `max_err` per glyph in the pack. The difference-curve hull test is also directly usable in Bend (fixed-depth subdivision, uniform work).
- Its area/bounds pens give an independent oracle for the exact lattice area computation.

## Pointers worth porting or studying

- `cu2qu.py` `cubic_farthest_fit_inside`, `cubic_approx_spline`, `curve_to_quadratic` (the tolerance loop).
- `basePen.py` `decomposeQuadraticSegment`; `qu2cu.py` `elevate_quadratic`.
- `ttLib/tables/_g_l_y_f.py` `Glyph.getCoordinates`, flag constants.

## Verdict: adopt (as offline tooling) / learn-from (cu2qu bound for a future CFF path)
