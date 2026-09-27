# Lengyel 2017, "GPU-Centered Font Rendering Directly from Glyph Outlines" (Slug)

- Kind: paper + reference code + author blog. E. Lengyel, *Journal of Computer Graphics Techniques* 6(2):31-47, 2017 ([JCGT page](https://jcgt.org/published/0006/02/02/), [PDF](https://jcgt.org/published/0006/02/02/paper.pdf), local `tmp/research/pdf/lengyel-2017-slug-jcgt.pdf`, pp. 31-39 read). Reference shaders: [github.com/EricLengyel/Slug](https://github.com/EricLengyel/Slug) (`SlugPixelShader.hlsl` copied to `tmp/research/sktext/`; 1531 stars, pushed 2026-04-15). Blog: [A Decade of Slug](https://terathon.com/blog/decade-slug.html) (2026-03-17).
- Author: Eric Lengyel, Terathon Software.
- License: repo ships LICENSE-MIT and LICENSE-APACHE; README: "may be freely used by anyone for any purpose... If you do use this code in software that gets distributed in any way, then you are required to give credit." **Patent US 10,373,352** (granted 2019, term to 2038) was **dedicated to the public domain on 2026-03-17** via USPTO form SB/43 (DOCUMENTED, blog). No patent obstacle for wonky anymore.
- Status: production (Slug Library, used in games); the 2017 algorithm core unchanged, band-split and adaptive supersampling removed since (blog).

## What it is

A robust way to compute the **nonzero winding number of a point with respect to closed contours of quadratic Beziers** (TrueType glyphs), evaluated per pixel on the GPU with uniform, branch-light work.

## How it works

- Translate so the query point is the origin. For a quad with control y-values y1, y2, y3, the roots of C_y(t) = (y1 − 2y2 + y3)t² − 2(y1 − y2)t + y1 are t1,2 = (b ∓ √(b² − ac))/a with a = y1 − 2y2 + y3, b = y1 − y2, c = y1 (linear fallback t = c/2b when a ≈ 0).
- **Root eligibility (DOCUMENTED, §2, Table 1):** instead of testing t ∈ [0,1) numerically, classify the curve by the 3-bit sign code ((y1 > 0)·2 + (y2 > 0)·4 + (y3 > 0)·8) and shift the 16-bit table `0x2E74` to get two bits: whether root t1 contributes +1 and whether t2 contributes −1 (each only if C_x(t_i) ≥ 0). The eight equivalence classes cover all 27 sign cases including rays through control points and tangencies; "This guarantees that there exists a value x0 such that for all x ≤ x0, a particular contour intersection is counted, and for all x > x0, the same intersection is not counted." Discriminant is clamped at 0 so the no-real-root case contributes +1 −1 = 0.
- The only remaining numeric decision is the sign of C_x(t_i); rendering replaces it by a clamped coverage.
- Performance: glyphs split into ≤16 horizontal/vertical bands with sorted curve lists and early-out (§3).

## Robustness and guarantees

"achieves absolute, unconditional robustness over the entire space of finite inputs" for the *counting logic* (no double counting at shared endpoints, no missed crossings); the geometric accuracy of each C_x(t_i) remains floating-point.

## Parallelism and performance

Designed for uniform per-pixel work: every (point, curve) pair runs the same code; no divergent branching except the band early-out. JCGT reports real-time rates on 2017 GPUs (numbers in §5 of the paper, not transcribed).

## Known failures, limitations, war stories

Pre-Slug methods (Esfahbod 2012 GLyphy, Dobbie 2016) suffered "sparkle" and "streak" artifacts from numeric root-interval tests (DOCUMENTED §1). Slug's own rendering is only as exact as C_x(t_i).

## Relevance for wonky

The cleanest known recipe for **exact region classification of text** in Bend: with lattice-integer control points, the eligibility code is an exact sign test, and sign(C_x(t_i)) for an algebraic t_i = (b ∓ √D)/a can be decided exactly with multi-limb integers by isolating the square root and squaring with sign bookkeeping (degree-2 algebraic numbers). That yields an exact nonzero winding number of any lattice point (or rational point) against a whole string's contours, uniform work per (point, curve), fork-join or GPU friendly. Uses in wonky: (1) region/fill classification when building the text profile (which faces of the 2D arrangement are material), (2) certified point-in-text queries for testing and the hybrid mesh path, (3) viewer rendering of sketches straight from outlines. Recommended over OCCT-style containment trees because it needs no contour-direction or nesting assumptions and handles overlapping contours (nonzero union) for free.

## Pointers worth porting or studying

- Paper eq. (1)-(2), Table 1 (the 0x2E74 table and its 8 classes), §3 bands.
- `SlugPixelShader.hlsl` `CalcRootCode` (l.17-31) and `SolveHorizPoly` (l.34+).
- README tip: encode a line as the degenerate quad {p1, p2, p2}, so one code path covers lines too.

## Verdict: adapt

Take the root-eligibility logic verbatim (public domain patent, MIT/Apache code) and replace the float root evaluation by an exact integer sign decision.
