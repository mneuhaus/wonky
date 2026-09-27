# FreeType unhinted 26.6 scaling, and OpenJDK's `freetypeScaler.c` outline path

- Kind: C source code + library docs. Canonical: [freetype/freetype](https://github.com/freetype/freetype) (`src/base/ftcalc.c` `FT_MulFix`/`FT_DivFix`, `src/truetype/ttgload.c` point and phantom-point scaling), [FreeType glyph conventions: outlines](https://freetype.org/freetype2/docs/glyphs/glyphs-6.html), [OpenJDK `freetypeScaler.c`](https://github.com/openjdk/jdk/blob/master/src/java.desktop/share/native/libfontmanager/freetypeScaler.c). Local copies: `tmp/research/sktext/{ftcalc.c,ttgload.c,freetypeScaler.c}` (master, fetched 2026-09-24).
- Authors: David Turner, Robert Wilhelm, Werner Lemberg et al. (FreeType, 1996-); Oracle/OpenJDK contributors.
- License: FreeType is dual FTL (BSD-style with credit clause) / GPLv2; OpenJDK is GPLv2 + Classpath exception. wonky needs no code, only the arithmetic rule (two lines), which is a fact about behaviour, not copyrightable expression.
- Status: FreeType very active (last commit 2026-09-22, 900 stars on the GitHub mirror; canonical repo is on GitLab); OpenJDK active.

## What it is

The scaler that, by all evidence, produces Onshape's text geometry (see `onshape-sktext-layout-measured-from-step-export.md`). Understanding its rounding lets wonky reproduce Onshape's lattice exactly.

## How it works

- **26.6 outlines (DOCUMENTED, glyphs-6):** "An outline point's vectorial coordinates are expressed in the 26.6 format, i.e., in 1/64 of a pixel."
- **Scale factor (DOCUMENTED, ftcalc.c):** `x_scale = FT_DivFix(ppem·64, unitsPerEm)` (16.16 fixed point, rounded). At 100 ppem and upem 2048: 6400/2048 = 3.125 = 204800/65536 exactly, so no rounding in the factor.
- **Point scaling (DOCUMENTED, ttgload.c ~l.960):** unhinted, non-variable glyphs: `vec->x = FT_MulFix(vec->x, x_scale)`. `FT_MulFix` = `(ab + 0x8000 + (ab >> 63)) >> 16`, i.e. **round half away from zero**. Measured consequence: overshoot y = −20 u → −62.5 → −63 (26.6), which is what Onshape's STEP shows; `Math.round` (half up) gets it wrong.
- **Advance (DOCUMENTED):** phantom points `pp1`, `pp2` are scaled the same way; `horiAdvance = pp2.x − pp1.x`. With `xMin == lsb` (Open Sans), advance = round_half_away(adv · 3.125).
- **Implied points:** created by the decomposer at "their exact middle" of two scaled off-curve points, so they lie on a half-lattice.
- **OpenJDK outline path (DOCUMENTED, freetypeScaler.c):** `getFTOutline()` loads with `FT_LOAD_NO_HINTING | FT_LOAD_NO_BITMAP`, translates by `FloatToF26Dot6(xpos)` (pen position rounded to 26.6), decomposes with `FT_Outline_Decompose` into `SEG_QUADTO`/`SEG_CUBICTO`, converts `F26Dot6ToFloat(v) = v/64`, sets `WIND_EVEN_ODD` only if `FT_OUTLINE_EVEN_ODD_FILL`; glyph advances are `FT26Dot6ToFloat(advance.x)` when fractional metrics are off (`linearHoriAdvance` when on). `FT_Set_Char_Size(face, 0, ptsz·64, 72, 72)`: at 72 dpi point size = pixel size, so a Java `Font` of size 100 gives 100 ppem.

## Robustness and guarantees

Deterministic integer arithmetic for TrueType outlines at a fixed ppem; the only float step in the Java path is `/64` and the later affine scale. Quantization error ≤ 1/128 px per coordinate (≤ H/9216 in Onshape's text box).

## Parallelism and performance

Not relevant; per-glyph independent.

## Known failures, limitations, war stories

- Rounding mode matters (half-away vs half-up changed 18 of 190 segments in the Onshape match).
- Variable fonts use a different path (`unrounded` points, `+32 >> 6`), not relevant for v1.10.
- CFF fonts go through a different loader (cubic, `FT_LOAD_NO_HINTING` still yields 26.6).

## Relevance for wonky

The rule "X = round_half_away(x · 6400/upem), advance likewise, pen += advance, no kerning, mm = X · H/4608" is all wonky needs to match Onshape. It is integer arithmetic (U32 with a sign bit, or F32 exact for |x| < 2^24), trivially expressible in Bend; the division 6400/upem is exact for upem 2048 (25/8) and 1000 (32/5, then rounding matters). Implement it once in Bend, keep the font-unit coordinates as provenance, and treat the 26.6 lattice as the canonical exact coordinates of text geometry.

## Pointers worth porting or studying

- `ftcalc.c` `FT_MulFix` (C fallback, l.212-227), `FT_DivFix` (l.232-250).
- `ttgload.c` l.935-995 (point scaling, phantom points).
- `freetypeScaler.c` `getFTOutline` (~l.1230-1265), `addToGP`/`conicTo` (~l.1330-1410), advance logic (~l.1070-1090).

## Verdict: learn-from

No code to port, but the two rounding rules are the key to bit-level agreement with Onshape.
