# TrueType `glyf` outlines: Apple TrueType Reference Manual and OpenType 1.9.1 spec

- Kind: format specifications. Canonical: [Apple TrueType Reference Manual, ch. 1 "Digitizing Letterform Designs"](https://developer.apple.com/fonts/TrueType-Reference-Manual/RM01/Chap1.html), [Apple RM `glyf` table](https://developer.apple.com/fonts/TrueType-Reference-Manual/RM06/Chap6glyf.html), [OpenType spec `glyf` (1.9.1, 2024-05-29)](https://learn.microsoft.com/en-us/typography/opentype/spec/glyf). Also relevant: OpenType `loca`, `hmtx`, `cmap`, `head`, `kern`, `GPOS`, `CFF`/`CFF2` chapters (same site).
- Organizations: Apple (TrueType, 1991-); Microsoft/Adobe (OpenType, ISO/IEC 14496-22 "Open Font Format").
- License: public specifications; implementing them carries no obligation.
- Status: stable; OpenType 1.9.1 current.

## What it is

The quadratic outline format used by `OpenSans-Regular.ttf` and the 7 other `.ttf` names in Onshape's 12-name `skText` list (the four `NotoSansCJK*.otf` are CFF, cubic; INFERRED from the extension, not opened).

## How it works

- **Curves (DOCUMENTED, Apple RM ch.1):** "p(t) = (1−t)²p0 + 2t(1−t)p1 + t²p2"; "the addition of a third off-curve point between two on-curve points makes it possible to describe a parabolic curve"; "The control point p1 is at the point of intersection of the tangents to the curve at points p0 and p2." So every non-degenerate segment is an arc of a parabola with axis parallel to p0 − 2p1 + p2.
- **Implied on-curve points (DOCUMENTED):** a point between two consecutive off-curve points is implied at their midpoint and omitted from the file ("its existence implied and its location can be reconstructed"). FreeType: "Two successive conic 'off' points force the rasterizer to create ... a virtual 'on' point inbetween, at their exact middle" ([FreeType glyphs-6](https://freetype.org/freetype2/docs/glyphs/glyphs-6.html)). A contour may start with an off-curve point and may consist only of off-curve points (then all on-curve points are implied); parsers handle both (see ttf-parser `Builder::push_point/finish_contour`).
- **Direction and fill (DOCUMENTED, Apple RM ch.1):** "The direction is always from lower point number toward higher point number"; "TrueType uses the non-zero winding number rule"; "TrueType allows for the possibility that two contours might intersect... the non-zero winding number rule is invoked... Black filled areas when placed over other black filled areas will remain black." Convention (not a rule): outer contours clockwise in y-up font units (Open Sans v1.10 confirms: signed area of all contours of "CORNER POST R10" is negative, `area.mjs`).
- **Coordinates (DOCUMENTED):** integer font units, "Each point must be within the range -16384 through +16383 font-units"; stored as deltas (1 byte with sign flag, or int16, or "same as previous"), flags run-length coded (REPEAT_FLAG). Bounding box in the glyph header is the control-point box ("guaranteed to contain the outline, but might not be tight").
- **Overlap flags (DOCUMENTED, OpenType):** `OVERLAP_SIMPLE` (0x40 on the first flag) and `OVERLAP_COMPOUND` (0x0400) "could overlap. Use of this flag is not required — that is, contours may overlap without having this flag set." "Variable fonts often make use of overlapping contours"; static instances should set the flag or merge contours.
- **Composites (DOCUMENTED):** components with offsets (int8/int16) or point-matching anchors, optional F2DOT14 scale / xy-scale / 2×2 matrix; `SCALED_/UNSCALED_COMPONENT_OFFSET`, default on Apple/Microsoft = unscaled; `ROUND_XY_TO_GRID` only matters when hinting; nesting allowed, acyclic, depth in `maxp.maxComponentDepth`; `USE_MY_METRICS` takes advance/lsb from a component.
- **Metrics:** advance and lsb from `hmtx`; the right side bearing is implied. Kerning in legacy `kern` (format 0 pairs) and/or `GPOS` pair adjustment.

## Robustness and guarantees

Integer inputs, but the spec does **not** guarantee simple, non-overlapping, consistently oriented contours; "contours may overlap without having this flag set". Point-matching composites depend on (possibly hinted) child points. F2DOT14 composite transforms are the only non-integer data (exact dyadic rationals, multiples of 2^-14).

## Parallelism and performance

Per-glyph decoding is independent (fork-join over glyphs); each glyph is ≤ a few hundred points. Uniform-work GPU decoding is not natural (variable-length RLE flags), but it is irrelevant at this size.

## Known failures, limitations, war stories

Overlapping contours in variable-font-derived statics; malformed composites causing exponential recursion (ttf-parser issues #220/#224); `kern` subtable length overflow in Open Sans v1.10 (fonttools warning).

## Relevance for wonky

- **Exactness:** a segment is a parabola arc with integer (or half-integer, for implied points) control points. Its implicit equation in barycentric form, τ1² − 4τ0τ2 = 0 with τi affine in (x, y) over the control triangle, has integer coefficients after clearing twice the triangle area; line–parabola intersection is a quadratic, parabola–parabola a quartic, all in exact integers. After the Onshape 26.6 rescale (factor 25/8 for upem 2048, rounded) everything stays on an integer lattice, so a multi-limb U32 predicate kernel suffices; F32x2 is enough for construction.
- **Axis/focal form is inexact:** ISO 10303-42 parabola uses apex, unit axis and focal distance F = cross(p1−p0, p2−p1)² / |p0−2p1+p2|³ (derivation in the addendum), which needs a square root. Keep the Bezier (control-point) form as the carrier; derive focal form only for display/export if ever needed.
- **Fill semantics:** implement nonzero winding over *all contours of the whole string* (not per glyph), because adjacent unkerned glyphs can intersect (`KA`), while Onshape itself derives regions geometrically and removes contained counters (`qSketchRegion(id, true)`). For non-overlapping, consistently oriented fonts both give the same set; wonky should verify that premise per string and fail explicitly otherwise.
- **Scope cut:** ASCII of Open Sans v1.10 needs neither composites nor overlap handling (measured); implement composites (offset only, reject point matching and non-unit transforms) as a second step.

## Pointers worth porting or studying

- Apple RM ch.1 figures 1-3 (implied points), glyf flag table; OpenType glyf "Composite glyph description" pseudo-code.
- CFF/CFF2 chapters only if the CJK fonts are ever needed (cubic; see `fonttools-pens-and-cu2qu.md`).

## Verdict: adopt

The spec is small, integer-exact and fully covers the corpus case. Implement a subset (simple glyphs, implied points, hmtx, cmap format 4) and refuse the rest explicitly.
