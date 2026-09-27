# Onshape `skText`: std contract, help page, and the layout rule measured from a STEP export

- Kind: vendor std library source + vendor help page + **own measurement** on an Onshape STEP export from Marc's account. Canonical: std `sketch.fs` (local mirror `tmp/research/onshape-std-3083/repo/sketch.fs:336-396`), [Onshape help: Text](https://cad.onshape.com/help/Content/Sketch/text.htm) (page dated 2026-09-22). Evidence file: `~/Workspace/cad/cad-project-014/native-step-r10/CORNER_POST_AND_JOINER_R10.step` (header `ONSHAPE BY PTC INC, 1.220`, 2026-09-08, document `onshape-id-b768d669`, element `8ecef2f5588569ce9c0a8b41`, microversion `2ee95c85743837a02878bb5a`, sha256 in the sibling `step-export.json`), produced by `post-r10/corner-post-r10.fs` (`engrave()` l.126-134, calls l.238 and l.264). Scripts and extracted data: `tmp/research/sktext/` (`step-census.mjs`, `step-text-extract.mjs`, `fitlayout2.mjs`, `circfit.mjs`, `area.mjs`, `arccount.mjs`, `pairx.mjs`). Related precedent: [bladec, "Custom Feature: Custom Font Text"](https://forum.onshape.com/discussion/30384/custom-feature-custom-font-text) (2026-03-08).
- Organization: Onshape / PTC. The builtin `@skText` is closed; only its precondition and doc comment are public.
- License: std library is readable Onshape source (used as the FS frontend contract); the measurement is Marc's own data. Nothing to port; the result is a *specification* wonky can reimplement.
- Status: skText is stable std API; font list unchanged across the std versions mirrored locally.

## What it is

`skText(sketch, id, {text, fontName, construction?, firstCorner?, secondCorner?, mirrorHorizontal?, mirrorVertical?})` adds a text entity to a sketch. DOCUMENTED (std doc comment): `fontName` must be one of 12 names (`OpenSans-Regular.ttf` "Default if no match is found", `AllertaStencil-Regular.ttf`, `Arimo-Regular.ttf`, `DroidSansMono.ttf`, `NotoSans-Regular.ttf`, four `NotoSansCJK*-Regular.otf`, `NotoSerif-Regular.ttf`, `RobotoSlab-Regular.ttf`, `Tinos-Regular.ttf`), with `-Bold`/`-Italic`/`-BoldItalic` variants where they exist. "Text will start at the left of the rectangle and extend to the right, overflowing the right if necessary. The first line of text will fill the height of the rectangle, with subsequent lines below the rectangle (or above if mirrored vertically)." Newlines are `\n`. Help page (DOCUMENTED): "The lower left corner and the height define the text position and size of the first line of text"; flips are "about the horizontal/vertical center of the text frame"; text can be extruded, dimensioned and constrained; text cannot be patterned/mirrored inside a sketch. No custom fonts (forum threads; a community FS feature converts TTF to JSON offline, HEARSAY-level for its internals).

Corpus usage (DOCUMENTED, grep of `~/Workspace/cad`): 185 calls in 174 FS files; `OpenSans-Regular.ttf` 176×, `OpenSans-Bold.ttf` 9×; strings are upper-case + digits + space ("CORNER POST R10", "SC15 TOP R3"); rectangles 4 mm or 2.4 mm tall, always lower-left `firstCorner`; no `mirror*` option; always followed by `opExtrude(qSketchRegion(id, true))` along ±sketch normal, depth 0.3 mm (0.2-1.2), then a subtracting Boolean.

## How it works (measured)

**Representation in the exported B-rep (DOCUMENTED from the STEP, census script):** 378 `B_SPLINE_CURVE_WITH_KNOTS` of degree 2 with 3 poles (one non-rational quadratic Bezier per edge), 189 `B_SPLINE_SURFACE_WITH_KNOTS` of degree (3,1), 4×2 poles, form `.SURF_OF_LINEAR_EXTRUSION.` (the glyph walls; a degree-elevated quadratic Bezier swept linearly), `LINE`/`PLANE` for straight glyph segments, no rational splines. So Onshape keeps **one face per TrueType segment**; it does not merge segments into multi-span splines.

**Font identity (INFERRED from DOCUMENTED geometry):** the outlines match **Open Sans v1.10** (2011, Apache-2.0, `google/fonts@beaec08:apache/opensans`) and not v3.003 (OFL, googlefonts/opensans): with the model below 186/190 floor segments of "CORNER POST R10" match exactly on the lattice with v1.10, v3.003 matches 1/304 points.

**Layout rule (INFERRED; every number below reproduced exactly on the lattice):**
1. Scale: FreeType-style unhinted scaling at **100 ppem**: `X = round_half_away(x_font · 6400 / unitsPerEm)` in 26.6 fixed point (1/64 px). For Open Sans (upem 2048) the factor is exactly 3.125.
2. The rectangle height H corresponds to **72 px**: 1 px = H/72, lattice step = H/4608 (0.868 µm at H = 4 mm, 0.52 µm at H = 2.4 mm), em size = H·100/72 = 1.3889 H. Cap height (1462 u) lands at 71.39 px, so capitals are slightly shorter than the box (3.966 mm in a 4 mm box); round overshoots (O, 0, S, C at -20/+1485 u) poke out of it.
3. Baseline = bottom edge of the rectangle; pen origin = left edge (left side bearing kept; `J`'s negative LSB puts ink left of the box).
4. Advance per glyph = `round_half_away(adv · 6400/upem)` in 26.6. **No kerning**: Open Sans v1.10 has `kern` pairs `T A` = -143 and `C O` = -41 in these strings; applying either breaks the match (173/177 and 186/190 without, ≤17 with).
5. Implied on-curve points are exact midpoints of two 26.6 off-curve points (half-lattice values appear).
6. Text overflows to the right (rect [-23, 23] mm, text reaches 25.17 mm).
This is consistent with OpenJDK's `freetypeScaler.c` outline path (`FT_LOAD_NO_HINTING`, `FT_Outline_Translate(FloatToF26Dot6(xpos))`, 26.6 → float/64, 26.6 advances when fractional metrics are off, no kerning unless requested), i.e. Java2D `Font(size 100).createGlyphVector().getOutline()` then scaled by H/72. That the server is Java is HEARSAY (search-engine summary of Onshape pages); the mechanism is INFERRED.

**Post-processing Onshape applies (DOCUMENTED from geometry):** 11 of 118 quadratic segments were **replaced by circular arcs** (`CIRCLE` edges, cylindrical walls). A three-point circle through each replaced quad deviates ≤1.16 µm from the parabola; every kept quad deviates ≥1.47 µm (script `circfit.mjs`). So Onshape simplifies near-circular text segments with a tolerance around 1 µm (absolute or relative to H is unknown; only H = 4 mm was sampled). Line endpoints adjacent to a substituted arc move off the lattice (by ≤ 0.27 µm) and away from the model point by up to 0.98 µm (e.g. 7243.00,7829.98 instead of 7244,7832 half-lattice units). The sketch plane sat 0.02 mm above the face; floor at −0.32 mm, so the engraving is 0.30 mm deep.

**Area oracle (DOCUMENTED measurement):** exact lattice area of the model (Green's theorem on quadratic Beziers; 6·A is an integer in half-lattice units) vs Onshape's floor loops (lines + degree-2 splines + arcs): "CORNER POST R10" 53.356965587 mm² vs 53.357511027 mm² (20 loops, rel. diff 1.02e-5); "STACK JOINER R10" 52.374137690 vs 52.374723075 mm² (19 loops, 1.12e-5). The residual is consistent with the arc substitutions (INFERRED). Engraved volume = area × 0.30 mm ≈ 16.007 mm³.

## Robustness and guarantees

Nothing is documented about tolerances. Measured: lattice quantization error ≤ H/9216 (0.43 µm at 4 mm) against the true font outline; arc substitution ≤ ~1 µm; both far below FDM resolution. `qSketchRegion(id, true)` (DOCUMENTED, std `query.fs:1776`: "exclude sketch regions fully contained in other sketch regions. A region whose border has a vertex or edge on the outside boundary is not considered contained") removes glyph counters, so the corpus relies on Onshape's geometric region finding, not on contour direction.

## Parallelism and performance

Not observable. Face count is the relevant cost: 118 quads + 83 lines → ~200 wall faces per 15-character string.

## Known failures, limitations, war stories

- Font version is not documented anywhere; a naïve "download Open Sans from Google Fonts" gets v3 (different outlines, lsb 200 vs 201, advances 1264 vs 1266).
- Kerning ignored: "TA" is visibly loose in Onshape text (INFERRED from the rule).
- Without kerning, adjacent glyphs can still intersect: in v1.10 Regular caps/digits only `KA`; Bold `KA KX QJ XA XX`; lowercase adds `fT fV fW fX fY f) gJ (J` (sampled polyline test, `pairx.mjs`). Onshape's region finder then yields extra lens regions that are still extruded (INFERRED).
- Multi-line spacing, mirror semantics, Bold (no Bold sample exported) and corner-order normalization are **unmeasured**.
- Custom fonts unsupported natively (forum; bladec feature needs an offline TTF→JSON step, "only basic x axis kerning").

## Relevance for wonky

This is the specification `skText` must reproduce. Everything needed is exact integer data: font units (int16) → 26.6 lattice via one multiply-and-round with a rational factor (6400/2048 = 25/8) → one similarity transform (scale H/4608, rotation/translation of the sketch frame). Lattice coordinates of a 15-glyph string stay below 2^17 half-units, so they are exact in F32 and trivially in U32; exact 2D predicates on quadratic Beziers need only small multi-limb integers. Onshape's own ~1 µm arc substitution means wonky cannot and need not be bit-identical to Onshape; compare with an interval (area rel. 2e-5 or ±1 µm Hausdorff). Plugs into: sketch (new `skText` builtin), 2D region arrangement (multi-loop profiles with holes, currently rejected by `kernel/sketch-arcs.bend`), extrude (parabolic-cylinder walls), Boolean (2.5D pocket into a planar face), STEP export (degree-2 B-spline curves and SURF_OF_LINEAR_EXTRUSION B-spline surfaces, as Onshape does), print mesh (certified chord bound for parabolas), testing (area/volume oracle above).

## Pointers worth porting or studying

- `tmp/research/sktext/fitlayout2.mjs` (the layout model, 40 lines) and `area.mjs` (exact area) are ready-made test oracles.
- std `sketch.fs:336-396` (`skText` contract), `sketch.fs:676` `skBezier`, `sketch.fs:940-1000` `skConicSegment` ("rho = 0.5 => parabola", DOCUMENTED): the same parabola primitive Onshape exposes elsewhere.
- Frozen fixture candidates: the two strings above with their Onshape areas; add a Bold sample, a 2.4 mm sample, a `\n` sample and a mirrored sample when an Onshape capture is budgeted.

## Verdict: adopt (as specification)

The rule is fully determined for the corpus case (Regular, one line, no mirror) and reproduces Onshape to the lattice point. Adopt it verbatim; mark Bold/multi-line/mirror as "unverified, fail or warn" until one more capture pins them.
