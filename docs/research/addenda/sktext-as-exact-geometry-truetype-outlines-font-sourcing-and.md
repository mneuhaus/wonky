# skText as exact geometry: TrueType outlines, font sourcing and licensing, Onshape text layout

Addendum to the wonky research knowledge base, 2026-09-24. English. Gap filler.

**Why this gap.** `skText` appears in 174 FS files of Marc's corpus (185 calls; `docs/corpus/cluster-fs-missing-builtin.md` l.405 counts 101 units in 27 families; `cluster-boolean-capability.md` names it the next blocker for 18 units). Font `OpenSans-Regular.ttf` 176×, `OpenSans-Bold.ttf` 9×. It is nearly always an engraved revision mark ("CORNER POST R10", "SC15 TOP R3"), 4 mm or 2.4 mm tall, 0.3 mm deep, cut into a planar face (planar in the sampled files; not verified for all 185 calls). Skipping it silently is forbidden.

**Method.** Primary sources plus one measurement that turned out to be decisive: an Onshape STEP export already in the corpus (`~/Workspace/cad/cad-project-014/native-step-r10/CORNER_POST_AND_JOINER_R10.step`, Onshape 1.220, 2026-09-08) contains two engraved strings produced by `post-r10/corner-post-r10.fs`. Extracting its text edges and fitting candidate layout models against the Open Sans binaries pinned Onshape's font version and layout rule to the lattice point. No Onshape API calls were made. Scripts and data: `tmp/research/sktext/`. Worklog: local development evidence.

**Labels.** DOCUMENTED = primary source or measured artifact; INFERRED = my reasoning from evidence; HEARSAY = forums, secondhand.

**Source notes written for this addendum** (all in `docs/research/sources/`):
`onshape-sktext-layout-measured-from-step-export.md`, `open-sans-v1-10-apache-vs-v3-ofl-font-sourcing.md`, `truetype-glyf-outlines-apple-rm-and-opentype-spec.md`, `freetype-unhinted-26-6-scaling-and-openjdk-freetypescaler.md`, `ttf-parser-harfbuzz-rust.md`, `fonttools-pens-and-cu2qu.md`, `lengyel-2017-slug-winding-number-quadratic-bezier.md`, `occt-brepfont-text-to-brep-2026.md`, `freecad-shapestring-ft2fc.md`, `solvespace-ttf-text.md`, `yong-hu-sun-2000-bisection-g1-arc-splines-quadratic-bezier.md`, `bertolazzi-frego-2017-robust-biarc-computation.md`, `iso-10303-42-parabola-and-surface-of-linear-extrusion.md`.

## 0. Findings in one page

1. **Onshape's font is Open Sans v1.10 (Apache-2.0, 2011), not today's v3.003 (OFL).** v1.10 reproduces 186 of 190 floor segments of "CORNER POST R10" and 173 of 177 of "STACK JOINER R10" *exactly* on Onshape's coordinate lattice; v3.003 matches 1 of 304 points. DOCUMENTED measurement, INFERRED identification.
2. **Onshape's layout rule, reconstructed exactly** (INFERRED, reproduces every lattice value): FreeType-style unhinted scaling at 100 ppem, coordinates rounded half-away-from-zero to 1/64 px (`X = round(x·6400/upem)`), glyph advances rounded the same way, **no kerning**, pen starts at the left edge of the box, baseline on the bottom edge, box height H = 72 px, so em = H·100/72 and one lattice step = H/4608 (0.87 µm at 4 mm). It matches OpenJDK's `freetypeScaler.c` outline path (Java2D font of size 100, `FT_LOAD_NO_HINTING`).
3. **Onshape keeps the TrueType segments as exact quadratic Beziers**: degree-2 single-span B-spline edges and degree-(3,1) `SURF_OF_LINEAR_EXTRUSION` B-spline walls, one face per segment. It also **replaces near-circular segments by arcs**: 11 of 118 quads became circles (3-point-circle deviation ≤ 1.16 µm replaced, ≥ 1.47 µm kept), so Onshape itself is only "exact" to ~1 µm. DOCUMENTED.
4. **Exactness is cheap**: the whole string lives on an integer lattice (half-integers at implied points) with coordinates below 2^18, followed by one similarity transform. Every predicate wonky needs (line–parabola, parabola–parabola, point-in-region, area) has integer coefficients; the largest (exact winding sign at an algebraic root) needs ~128-bit integers. INFERRED.
5. **A parabola arc is a quadric carrier**: the extruded wall is a parabolic cylinder; its sections with planes are parabolas that are affine images of the same Bezier (exact, rational); with the target face planar and the extrusion normal to it, the Boolean is 2.5D. INFERRED from standard conic geometry.
6. **The arc-spline alternative is expensive**: measured on "CORNER POST R10", biarcs need 470 arcs at 1 µm tolerance and 930 at 0.1 µm for 118 parabolas (4-8× faces), and still differ from Onshape. Keep it as a tolerance-tagged fallback only. DOCUMENTED measurement.
7. **Licensing is clean**: Open Sans v1.10 TTFs carry an Apache-2.0 notice; ship the pinned binary (sha256 `13c03e22…b05f8` Regular, `1b43de24…49d3` Bold) with its license. Parser references are MIT/Apache (ttf-parser, fonttools); the Slug winding-number patent was dedicated to the public domain on 2026-03-17.

## 1. Landscape

### 1.1 Two families of "text in CAD"

- **Exact curves from the font**: Onshape (Parasolid B-splines, then some arcs), OCCT `BRepFont` (design-unit Bezier pcurves on a plane; the path behind build123d/CadQuery), FreeCAD ShapeString (Bezier → B-spline edges, faces built afterwards), SolveSpace (degree-2 `SBezier` kept end to end). All use FreeType for decoding. DOCUMENTED (source notes).
- **Polygonized text**: mesh/SDF systems and some code-CAD tools flatten outlines to polylines with a segment count (HEARSAY for specific tools; not researched here). Not an option under wonky's "approximations need explicit tolerances" rule unless the tolerance is certified, which is easy for parabolas (§3.6).

### 1.2 Font decoding

FreeType (C, FTL/GPLv2) is the universal decoder; fonttools (Python, MIT) the universal toolchain; ttf-parser (Rust, MIT/Apache, maintenance mode) and fontations (Rust, Apache-2.0, Google Fonts, active) are safe, allocation-free parsers; opentype.js and Typr.js (JS, MIT) parse in the browser (gh api metadata 2026-09-24: fonttools 5259★, release 4.66.0 on 2026-09-23; ttf-parser 793★, last commit 2026-08-06; fontations 828★, active daily; opentype.js 5020★; Typr.js 1004★). None is needed at wonky runtime if glyph data is shipped pre-extracted (P1).

### 1.3 Region classification from quadratic outlines

GPU font rendering solved robust nonzero winding for quadratic Beziers: Lengyel's Slug (JCGT 2017) decides root eligibility from the three sign bits of the control y-values and a 16-bit table (`0x2E74`), so no ray is double-counted or missed. OCCT 2026 instead builds a containment tree by area plus orientation and **refuses intersecting contours** unless flagged as overlapping, and even then does not union them. DOCUMENTED.

### 1.4 Arc-spline approximation (CNC lineage)

Meek-Walton (1993/1994), Ahn et al. (1998), Yong-Hu-Sun (2000) approximate a quadratic Bezier by G1 arcs with an error bound; arc counts grow like ε^(−1/2) for one-arc chains (DOCUMENTED, Yong-Hu-Sun Corollary 1) and ≈ ε^(−0.3) for biarcs (measured here, §3.5). Bertolazzi-Frego (2017) give a branch-free biarc kernel (DOCUMENTED).

### 1.5 Comparison

| system / source | font data | curve type kept | layout size meaning | kerning | overlap handling | license |
|---|---|---|---|---|---|---|
| Onshape `skText` | Open Sans v1.10 etc. (12 names) | quad Bezier (B-spline) + ~1 µm arc substitution | box = 72/100 em, baseline at box bottom | none | geometric sketch regions, `filterInnerLoops` | closed |
| OCCT BRepFont (2026) | any via FreeType, design units | Bezier deg 2/3 | glyph size (em, INFERRED) | legacy `kern` | refuse unless flagged; no union | LGPL-2.1 |
| FreeCAD ShapeString | any via FreeType, hinted | Bezier → B-spline | line height (face height) | legacy `kern` + tracking | none (MakeFace/Fuse later) | LGPL-2.1 |
| SolveSpace | any via FreeType, unhinted | `SBezier` deg 2 | cap height of 'A' | optional | NURBS Boolean | GPL-3 |
| Slug (rendering) | TrueType quads | quad | n/a | n/a | nonzero winding exact counting | MIT/Apache, patent PD |

## 2. The Onshape contract, exactly

### 2.1 Documented surface

std `sketch.fs:336-396`: `skText(sketch, id, {text, fontName, construction?, firstCorner?, secondCorner?, mirrorHorizontal?, mirrorVertical?})`; 12 font names, `OpenSans-Regular.ttf` "Default if no match is found"; "Text will start at the left of the rectangle and extend to the right, overflowing the right if necessary. The first line of text will fill the height of the rectangle, with subsequent lines below the rectangle (or above if mirrored vertically)." Help page (2026-09-22): flips are "about the horizontal/vertical center of the text frame". `qSketchRegion(id, true)` excludes regions "fully contained in other sketch regions" (`query.fs:1776`), which is what removes the counters of O, R, P, 0 in every corpus call. DOCUMENTED.

### 2.2 The measured rule (INFERRED; reproduced exactly)

For a single line of text in box [x_L, x_R] × [y_B, y_T], H = y_T − y_B, font units per em U:

```
s        = 6400 / U                       (3.125 for Open Sans; exact)
X(x)     = round_half_away(x · s)         (26.6 lattice, 1/64 px, 100 ppem)
pen_0    = 0
glyph g at pen: point (x, y)  ->  (pen + X(x), X(y))      [implied on-curve = midpoint, half-lattice]
pen     += round_half_away(adv_g · s)                     [no kerning, no GPOS]
sketch   = (x_L + L·H/4608, y_B + L_y·H/4608)             [L in lattice units; 4608 = 72·64]
```

Evidence: exact lattice agreement for 359 of 367 segments across both strings; the 8 remaining are lines whose endpoints Onshape moved (by up to 0.98 µm from the model point, ≤ 0.27 µm off the lattice) where they meet an arc-substituted segment. Rounding mode matters (half-up instead of half-away loses 18 segments). Applying Open Sans' `kern` pairs (`T A` −143, `C O` −41) destroys the match. Consequences: capitals are 3.966 mm tall in a 4 mm box (cap height 1462 u = 71.39 px); round overshoots (−20 u, +1485 u) leave the box; `J` starts left of the box (negative LSB); long strings overflow to the right. Stems: Regular 170 u = 0.46 mm at H = 4 mm, 0.28 mm at H = 2.4 mm; Bold 310 u.

### 2.3 Post-processing and the area oracle

Onshape exports each segment as `B_SPLINE_CURVE_WITH_KNOTS('',2,(3 poles),.UNSPECIFIED.,.F.,.F.,(3,3),(0.,1.),.PIECEWISE_BEZIER_KNOTS.)` and each wall as a degree-(3,1) `B_SPLINE_SURFACE_WITH_KNOTS` with form `.SURF_OF_LINEAR_EXTRUSION.`. Eleven near-circular quads became `CIRCLE`/`CYLINDRICAL_SURFACE`. Exact lattice area vs Onshape floor area: 53.356965587 vs 53.357511027 mm² ("CORNER POST R10", rel. 1.0e-5) and 52.374137690 vs 52.374723075 mm² ("STACK JOINER R10", 1.1e-5). The engraving is 0.30 mm deep (sketch plane 0.02 mm above the face). DOCUMENTED.

### 2.4 Unknowns

Bold (no exported sample), multi-line spacing, mirror flips, corner normalization (the corpus always passes lower-left first), fallback for unknown names, whether the ~1 µm arc substitution scales with H, and whether Onshape ever updates its font files (which would silently change geometry across std versions). Each needs one budgeted capture (P7).

## 3. State of the art applied to wonky's constraints

### 3.1 Representation: parabola arcs, not focal-form parabolas

A TrueType segment with control points p0, p1, p2 is B(t) = (1−t)²p0 + 2t(1−t)p1 + t²p2 (Apple RM ch.1). With a = p0 − 2p1 + p2 and b = 2(p1 − p0): B(t) = p0 + bt + at², so it is an arc of a parabola with axis ∥ a (degenerate: a ∥ b or a = 0 → a line segment; test exactly with cross(p1 − p0, p2 − p1) = 0).

- **Vertex (curvature maximum)** at t* = (p0 − p1)·a / (a·a): rational. Splitting at t* gives monotone-curvature halves (the arc-spline literature's first step); splitting at the y-extremum t_y = (y0 − y1)/(y0 − 2y1 + y2) gives y-monotone pieces for sweeps. INFERRED (direct differentiation).
- **Focal form (ISO 10303-42 `parabola`, λ(u) = C + F(u²x + 2uy))**: F = cross(p1 − p0, p2 − p1)² / |a|³ and the axis needs |a|; both irrational. So the carrier must be stored as control points, not as apex/axis/focal distance. INFERRED derivation; ISO text DOCUMENTED.
- **Implicit equation with integer coefficients**: with A0(X) = cross(p1 − X, p2 − X), A1(X) = cross(p2 − X, p0 − X), A2(X) = cross(p0 − X, p1 − X) (twice the barycentric areas), the curve satisfies f(X) = A1(X)² − 4·A0(X)·A2(X) = 0, because B(t) has barycentric coordinates ((1−t)², 2t(1−t), t²). f(p1) = D² > 0 (D = twice the control-triangle area), so sign(f) separates the convex side of the arc from the control-point side. INFERRED (standard implicitization).
- **Parabolic cylinder wall**: the same f evaluated on the sketch-plane coordinates of a 3D point is the wall's implicit equation, a quadric of rank 3 (parabolic cylinder). It fits the hybrid path's "quadric carrier" certification identity (`docs/hybrid-mesh-bodies.md` l.175). INFERRED.

**Intersections needed by text, all exact on the lattice** (INFERRED):

| pair | reduces to | exact cost |
|---|---|---|
| wall ∩ plane ⟂ extrusion (top face, floor) | the profile Bezier translated | none |
| wall ∩ oblique plane z = αx + βy + γ | Bezier with control points (p_i, αx_i + βy_i + γ) | affine map of 3 points |
| wall ∩ plane ∥ extrusion | 0-2 rulings: roots of L(B(t)) = (1−t)²L0 + 2t(1−t)L1 + t²L2 | quadratic, discriminant L1² − L0L2 |
| segment line ∩ quad (2D) | same Bernstein quadratic | ~72-bit integers |
| quad ∩ quad (2D, colliding glyphs) | f2(B1(t)) = 0, quartic in Bernstein form | root isolation, ~150-bit coefficients |
| wall ∩ cylinder (text on a round boss) | algebraic space curve, not rational | out of scope; decline to hybrid or refuse |

Bit sizes assume half-lattice coordinates < 2^18 (a 30-character string; "CORNER POST R10" reaches 110 982). The lattice integers are exact in F32 (24-bit mantissa), so Bend can carry them as F32 or U32 words and hand them to the existing multi-limb `Big` predicates (`kernel/robust-predicates.bend`); the world placement (scale H/4608, sketch frame) is the only inexact step and happens once, in F32x2.

### 3.2 Format details that matter

- **Implied on-curve points**: midpoint of two consecutive off-curve points; contours may start off-curve or contain no on-curve point (Apple RM; ttf-parser `Builder::push_point/finish_contour` is the reference state machine). On the lattice the midpoint is a half-integer: double all coordinates once.
- **Direction and fill**: point order defines direction; fill is **nonzero winding**; contours "might intersect" and overlapping black stays black (Apple RM ch.1). Outer contours are clockwise by convention (Open Sans signed area negative, measured).
- **Overlaps**: `OVERLAP_SIMPLE`/`OVERLAP_COMPOUND` "not required — contours may overlap without having this flag set"; variable fonts overlap routinely (OpenType glyf). Open Sans v1.10 ASCII: no composites, no overlap flags, no crossing contours (sampled check), ≤ 66 points and ≤ 5 contours per glyph. DOCUMENTED/INFERRED.
- **Between glyphs**: without kerning, adjacent glyphs still collide: v1.10 Regular caps/digits only `KA`; Bold `KA KX QJ XA XX`; lowercase adds `fT fV fW fX fY f) gJ (J` (sampled, `pairx.mjs`). Nonzero union over the *whole string* handles this; per-glyph faces do not.
- **CFF**: the four `NotoSansCJK*.otf` names are cubic (CFF). cu2qu (fonttools) converts cubics to quadratic splines with a certified conservative bound; that keeps the parabola carrier, at the price of an explicit per-glyph tolerance. Zero corpus demand today.

### 3.3 Region semantics: Onshape's versus nonzero

Onshape builds sketch regions geometrically from all curves and `filterInnerLoops` drops regions contained in others; the corpus always extrudes `qSketchRegion(id, true)`. For fonts whose contours are simple and consistently oriented, and for strings whose glyphs are disjoint or merely overlap (lens regions touch the outside boundary, so they are kept), this equals the nonzero union of all contours. INFERRED. wonky should compute the nonzero union exactly (Slug-style counting with exact root signs) and assert the equivalence premises, refusing strings that violate them (e.g. a glyph drawn with reversed contour direction) until an Onshape capture shows what Onshape does there.

### 3.4 Winding numbers and point location, exactly

Slug's eligibility table turns the error-prone "is t in [0,1)" test into three exact sign bits of y1, y2, y3 relative to the query point. What remains is sign(C_x(t_i)) at t_i = (b ∓ √(b² − ac))/a: writing C_x(t_i)·a² = P ∓ Q√D with integers P, Q, D, the sign is decided by sign(P), sign(Q) and a comparison of P² with Q²D (~128-bit). Uniform work per (point, curve): fork-join on CPU, one thread per pair on GPU. INFERRED (Slug DOCUMENTED).

### 3.5 Cost of the arc route (measured)

"CORNER POST R10", H = 4 mm, 118 quads (`arccount.mjs`, equal-chord biarcs with recursive bisection):

| tolerance | biarc arcs | per quad | uniform chords for a print mesh |
|---|---|---|---|
| 10 µm | 256 | 2.2 | 439 |
| 1 µm | 470 | 4.0 | 1269 |
| 0.1 µm | 930 | 7.9 | 3897 |
| 0.01 µm | 1870 | 15.8 | 12184 |

Every arc is a cylindrical wall face plus a vertex pair; the Boolean and naming cost scales with it. Onshape's own ~1 µm arc substitution touches only 11 of 118 quads because it replaces a segment by *one* arc or not at all. INFERRED comparison.

### 3.6 Tessellation with a certified bound

B(t) − chord = a·(t − t0)(t − t1) exactly, so a uniform split into n pieces has chord deviation ≤ |a| / (4n²); choose n = ⌈√(|a| / (4ε))⌉. Same n for all points of one segment, independent segments: uniform GPU work, and the bound is exact (not sampled). For the print mesh at ε = 1 µm: 1269 chords for the whole string above. INFERRED (elementary).

### 3.7 Area and volume, exactly

Signed area of a closed outline = Σ over segments of ½·cross(p0, p2) + ⅓·cross(p1 − p0, p2 − p0) (lines: ½·cross(p0, p1)). On the half-lattice, 6·A is an integer (measured: −1 699 445 819 for "CORNER POST R10"). Engraved volume = area × depth. This is the test oracle for text (§5, T2).

### 3.8 Font sourcing and licensing

- Onshape's `OpenSans-Regular.ttf` is v1.10 (Version 1.10, fontRevision 1.1010, 938 glyphs, `kern` table present). Pin `google/fonts@beaec0837bd2:apache/opensans/OpenSans-{Regular,Bold}.ttf`, sha256 Regular `13c03e22a633919beb2847c58c8285fb8a735ee97097d7c48fd403f8294b05f8`, Bold `1b43de2449d39b65ff6f63315d4afda585f72fbbec2e3d9a56f59de6c75149d3`. The TTF name table says "Licensed under the Apache License, Version 2.0"; keep `LICENSE` next to it. DOCUMENTED.
- v3.003 (googlefonts/opensans, OFL-1.1, re-derived from Noto Sans, "scale Noto Sans from 1000 units-per-em to 2048") is a different drawing (lsb 200 vs 201, advances 1264 vs 1266) and must not be used. google/fonts PR #4206 (2022) moved v3 to `ofl/` "No TTF changes"; it does not concern the old Apache-licensed binaries (INFERRED; not legal advice).
- Other std names need the same version check before admission; refuse them explicitly until then.

## 4. War stories

- **Version drift**: "Open Sans" downloaded today is v3; every glyph moves by ~1-3 font units. Would silently break any Onshape comparison. (Measured.)
- **Kerning mismatch**: OCCT/build123d and FreeCAD kern, Onshape does not; the same string lays out differently in each (source notes).
- **Faces from wires**: FreeCAD ShapeString issues #21501 (font with no faces generated), #19304 (pad makes the body disappear), #16809 (face vs compound) show what happens when text is "wires, then MakeFace and hope". DOCUMENTED.
- **Intersecting contours**: OCCT 2026 returns `IntersectingContours`/`SelfIntersectingContour` instead of building bad faces; overlapping contours are kept as separate regions, never unioned. DOCUMENTED.
- **Composite recursion**: ttf-parser #220/#224, exponential work from shared composite subtrees; fixed with a total visit budget. DOCUMENTED.
- **Floating-point winding**: pre-Slug GPU renderers "sparkle" and "streak" from numeric root-range tests (Slug §1). DOCUMENTED.
- **Robust biarcs**: MATLAB `rscvn` picks wrong or degenerate biarcs near singular angles (Bertolazzi-Frego Fig. 3-4). DOCUMENTED.

## 5. Ranked proposals for wonky

Ordering = value per effort on the corpus path; each proposal fails explicitly outside its admission set.

### P1. Pinned glyph pack + exact Onshape layout in Bend (effort S, do first)

- Offline tooling (fonttools via `uv run`, like the existing corpus tooling) extracts from the pinned v1.10 TTFs: cmap subset, per glyph `adv`, `lsb`, contours as integer points with on/off flags, and the font sha256. Stored under `fixtures/fonts/` with provenance (google/fonts commit, sha256, license). This is input data, not production geometry.
- Bend computes the layout of §2.2 (26.6 rounding half-away, advances, implied midpoints on the doubled lattice), producing contours of lattice integers plus the similarity transform to the sketch frame. Glyphs lay out fork-join in parallel (prefix sum of advances).
- Frontend: `skText` builtin in the FS interpreter hands `text`, `fontName`, corners, mirror flags to Bend; unsupported inputs (`\n`, mirror, Bold until verified, non-ASCII, unknown font, composite glyphs) raise specific errors ("skText: multi-line layout is not verified against Onshape").
- **Acceptance (T1)**: reproduce every lattice point of the two Onshape strings (359/367 exact; the 8 moved line ends within 1 µm; the 11 arc-substituted segments within 1.2 µm Hausdorff).

### P2. Exact text region: nonzero union on the lattice (effort M; depends on P1; closes the "2D arrangement" dependency for text)

- Premise checks with exact predicates: no crossings inside a glyph (Open Sans ASCII passes), cross-glyph collisions detected with Bernstein-form line/quad and quad/quad tests (bounding-box filter, then exact).
- Stage a (corpus-sufficient): if no curves cross, regions = contours; nest them by exact point-in-contour winding (Slug eligibility + exact root sign, §3.4); emit faces as outer loop + holes. This subsumes Onshape's `filterInnerLoops` for the corpus.
- Stage b: when curves cross (`KA`, Bold `XA`), split at exact intersection points (quadratic/quartic roots isolated exactly, represented as algebraic parameters with F32x2 approximations for construction) and classify arrangement faces by nonzero winding.
- Reuse the 2D region machinery of `kernel/prism-boolean.bend` (line/arc profiles, exact incidence via `Big`) by adding a quad-Bezier boundary kind, instead of a separate text-only arrangement.
- **Acceptance (T2)**: exact 6·A integers equal to the closed-form sum; area within 2e-5 of Onshape's floor areas (53.357511027 / 52.374723075 mm²).

### P3. Parabola as a first-class carrier (effort M; parallel to P2)

- `kernel/analytic.bend`: `Curve` gains a quadratic-Bezier variant (three `Vec3` control points, plus lattice provenance), `Surface` gains a linear-extrusion variant over it (parabolic cylinder). Needed operations: evaluate, derivative, exact plane sections (§3.1 table), bounds (control hull), orientation, transform (affine maps control points exactly).
- Tessellation: uniform n per segment with the certified bound of §3.6 (feeds the watertight print mesh's certified deviation).
- STEP: degree-2 single-span `B_SPLINE_CURVE_WITH_KNOTS` edges and degree-(2,1) `B_SPLINE_SURFACE_WITH_KNOTS` walls with form `.SURF_OF_LINEAR_EXTRUSION.` (Onshape uses (3,1); both valid), pcurves = the 2D Bezier on caps and iso-lines on walls. Validate with the existing OCCT reader oracle.
- Do **not** store apex/axis/focal form internally (irrational).
- **Acceptance (T4)**: STEP round-trip valid under OCCT `BRepCheck`, same area/volume.

### P4. Engrave/emboss arm: 2.5D pocket on a planar face (effort M; depends on P2+P3; unlocks the corpus)

- Recognize exactly: tool = right extrusion of a text region along ±n; target has a planar face F with normal ±n; the tool's near cap is outside the solid (the corpus places the sketch plane 0.02 mm proud), the floor plane lies between F and every other face of the target within the tool's footprint, and the text region lies strictly inside F's region (2D containment in F's frame, exact on F32x2 words). Otherwise decline with a code (to the hybrid Boolean or a refusal under `exact-only`).
- Build: F minus region (new holes), floor faces (region at depth d), wall faces (lines → planes, quads → parabolic cylinders, arcs → cylinders), with identity/provenance per glyph segment ("text:mark/glyph 3/contour 1/segment 7") so diffs name the letter that changed.
- EMBOSS (ADD) is the mirror case (tool outside, base on F).
- This is deliberately narrower than the prism Boolean (whose axis must be a coordinate axis; the corpus engraves along diagonal normals).
- **Acceptance (T3)**: engraved volume = target volume − area·depth exactly (closed form), and against Onshape `evVolume` for the two strings once captured.

### P5. Fallbacks with explicit tolerances (effort S-M; optional)

- Hybrid Boolean: parabolic walls as quadric carriers in the tagged-mesh + analytic-recovery path for cases P4 declines (text crossing a face edge, text on a cylinder boss via the mesh path).
- Arc-spline export mode (Yong-Hu-Sun bisection with a Bertolazzi-Frego biarc kernel, ε recorded, default 1 µm for FDM) for consumers that only accept lines/arcs. Never the default geometry.

### P6. Other fonts (effort S each; demand-driven)

Bold after one capture; other TrueType names after a version-identification capture each; CJK CFF via cu2qu with a recorded tolerance (zero corpus demand today).

### P7. One budgeted Onshape capture for the unknowns (effort S, can run now)

One FS test document (public document, pinned microversion) with: Bold string; H = 2.4 mm string; `"A\nB"`; mirrorHorizontal and mirrorVertical; firstCorner upper-right; "KAXA" collision; overflow past the box; a 1 µm-scale check of arc substitution at H = 40 mm. Export STEP (no metering-sensitive REST loops needed) plus one `evalFeatureScript` per rollback point for `evVolume`/`evArea` (see `onshape-rest-api-part-studio-mass-properties-and-rollback.md`). ~10 API calls.

### Anti-proposals

- Arc splines as the primary representation (4-8× faces, still not Onshape's geometry).
- Polyline text (violates the explicit-tolerance rule unless certified, and loses exact area).
- Downloading "Open Sans" from Google Fonts (v3).
- Kerning (Onshape does not kern).
- Replicating Onshape's ~1 µm arc substitution (it is an artifact, not a contract).
- Porting OCCT/FreeCAD/SolveSpace code (LGPL/GPL; their ideas are in the notes).

## 6. Test plan summary

| id | test | oracle |
|---|---|---|
| T1 | lattice points of "CORNER POST R10", "STACK JOINER R10" | Onshape STEP (`tmp/research/sktext/*.text.json`) |
| T2 | exact area (6·A integer), area vs Onshape floor | `area.mjs` values in §2.3 |
| T3 | engraved volume | closed form; Onshape `evVolume` after P7 |
| T4 | STEP validity and round-trip | OCCT reader |
| T5 | refusals: unknown font, `\n`, mirror, Bold (until P7), composite glyph, crossing contours (until P2b), non-planar target, region leaving the face | error codes |
| T6 | metamorphic: translation of the box by k·H/4608 shifts lattice exactly; string concatenation shifts the second part by the first part's advance sum; area(A+B) = area(A) + area(B) when no collision | self |

## 7. Open questions

1. Multi-line spacing and mirror flips (P7).
2. Bold and other fonts: same rule? (The rule is font-independent in the OpenJDK path, INFERRED; Bold is a separate TTF, not an emboldening transform, because `-Bold.ttf` is a file name.)
3. Is the arc-substitution tolerance absolute (~1 µm) or relative to H? Matters only for comparisons.
4. Does Onshape's region finder treat a reversed-direction contour like nonzero would (it does not look at direction at all, INFERRED)? Only relevant for fonts other than Open Sans v1.10.
5. Where does text land in the corpus beyond planar faces? A per-unit scan of the engrave targets (plane vs cylinder) would size P5.
