# What Onshape's opLoft actually produces: surface types in Marc's own Onshape STEP exports

- Kind: primary data (STEP AP214 files exported by Onshape, `originating_system 'ONSHAPE BY PTC INC, 1.220'` / `1.221`), plus the FeatureScript sources that built them. Read-only, local:
  - `~/Workspace/cad/cad-project-014/native-step-r11/CORNER_POST_AND_JOINER_R11.step` (twisted octagon lofts, corner-post shoulder)
  - `~/Workspace/cad/cad-project-014/machine-interface-r6/STEP/*.step` (11 parts; `bottomPost_R6`, `cableClamp_R6`, `ribbonReference_R6`, ...)
  - `~/Workspace/cad/cad-project-014/bottom-drive-review-2026-09-19/baseline/assembly.step` (Onshape 1.221; built from `baseline/native-source.fs`; contains the `motorBracket` pentagon loft and the 42-section `routeLoft` cable duct)
  - `~/Workspace/cad/cad-project-039/c-channel-bases-arcs-r6/native/bases-r6-native.step`, built from `channel-bases-arcs-r6.fs` (sha256 `01cac25c…`, equal to `native/state.json` `builtSha256`, featureStatus OK). It contains the `n141` stadium loft R13→R10 and the hexagon prismatoids `n117` etc.
- Analysis scripts (written for this note): `wonky-kernel/tmp/research/lofts/bsurf-scan.mjs` (degree, STEP form, grid, straightness and planarity of every `B_SPLINE_SURFACE_WITH_KNOTS`), `bsurf-detail.mjs` (control grids), `bilinear-check.mjs` (are single-span 3×1 faces exact bilinear patches?).
- Authors/organization: the geometry is Onshape/PTC's (Parasolid inside); the models are Marc's. 2026-08/09.
- License: private files; facts about output formats carry no licence burden.
- Status: snapshot of Onshape behaviour in Sept 2026 (Onshape build 1.220/1.221).

## What it is
The only direct evidence in reach of which carrier Onshape gives each loft face. Onshape documents neither the surface types of `opLoft` nor its simplification rules (see the std/help note). Parasolid documents that simplification exists (see the Parasolid note). These exports show the result for the loft shapes the corpus actually uses.

## How it works (findings; all DOCUMENTED by the files unless marked)
1. **Two-profile loft between polygons with parallel corresponding edges (prismatoid): planes.** `bases-r6-native.step` holds 214 planes, 86 cylinders, 16 cones and **zero** B-spline surfaces, although its source contains 10 `opLoft` calls including the hexagon prismatoids (corresponding edges parallel, side quads planar to 4e-13 mm per the corpus report). `cableClamp_R6.step` (fixedCableClamp prismatoid family) likewise has no B-spline face.
2. **Two-profile loft of line+arc stadia with coaxial, equal-span arcs: exact right circular cone.** `bases-r6-native.step` has `CONICAL_SURFACE('',…,0.013,0.463647609000757)` (three copies). 0.013 m is R13 and 0.4636476090 rad = atan(0.5) = atan((13−10)/6): the `n141` loft R13→R10 over 6 mm. The half-angle is exact to ~1e-12. Coaxial-circle lofts (`conicalTool`, `roundBody`) likewise come out as `CONICAL_SURFACE` (`cableClamp_R6`: 2 cones, 0 B-splines).
3. **Two-profile loft between polygons whose side quads are not planar ("twisted"): exact bilinear patch, stored as a B-spline.** Every such face is `B_SPLINE_SURFACE_WITH_KNOTS(…,3,1,…,.RULED_SURF.,…,(4,4),(2,2),…,.PIECEWISE_BEZIER_KNOTS.)`: one Bézier span, cubic along the profile edge, linear across. The 4 control points of each row are collinear and **evenly spaced** (interior points at 1/3 and 2/3 of the row within ≤1.4e-12 mm, `bilinear-check.mjs`). The cubic is a degree-elevated line with linear parameterisation, so the face is exactly `(1−u)(1−v)P00 + u(1−v)P10 + (1−u)vP01 + uvP11`, a hyperbolic paraboloid patch. Counts: 26 faces in R11 (twist, i.e. distance of the 4th corner from the plane of the other three, 0.16…2.60 mm), 10 in `bottomPost_R6` (same shoulder), 4 in the bottom-drive assembly (twist 0.98…1.29 mm; the 1.286 mm maximum is the `motorBracket` pentagon twist of 1.29 mm reported in `docs/corpus/cluster-kernel-sketch-and-ops.md`). Example `#50` (R11): bottom row (−16.6, −367.30, 6)→(−6, −386.04, 6), top row (−29, −378.04, 28)→(−21, −386.04, 28).
4. **Vertex correspondence observed: nth-to-nth in sketch order.** In `#50/#51` the neck vertex `[-16.6,-0.65]` maps to the top vertex `[-29,-11.4]` and `[-6,-19.4]` to `[-21,-19.4]` (both relative to the post axis), i.e. index i ↔ i. This is consistent with Parasolid's documented "start vertices matched, then in order" rule, with Onshape's start vertices coinciding with the sketch polyline start (INFERRED; one example family).
5. **Multi-section loft (the 42-section `routeLoft` cable duct): cubic C2 skin.** Faces `#691/#693` in the bottom-drive assembly: degree 3×3, form `.RULED_SURF.`, grid 7×55, u-knots (4,3,4), v-knots 4,1,…,1,4 (all interior knots simple ⇒ C2 in the loft direction), u-rows straight (profile edges are lines). 55 control points for 42 sections: not the n+2 of plain cubic interpolation, so Parasolid adds knots or fits (INFERRED; the rule is undocumented).
6. **No rational B-splines anywhere.** 0 `RATIONAL_B_SPLINE_SURFACE` in every scanned export. Circles that stay circles are simplified to analytic cones/cylinders. Where a circle enters a non-simplifiable loft face, Onshape must use a non-rational approximation (INFERRED; no square-to-circle export exists in the corpus to confirm).
7. Other B-spline forms present in the exports: 3×1 grid 34×2 and 1×3 grid 2×36 `.RULED_SURF.` (curved in one direction, straight in the other; origin not traced, INFERRED to be rulings between spline curves), 3×3 grid 4×N with straight u-rows (e.g. `ribbonReference_R6`, 4×37, 259 mm; INFERRED multi-section skins of rectangles), and 240 text-sized 3×1 `.SURF_OF_LINEAR_EXTRUSION.` faces (engraved lettering). None of these is a two-profile loft of the corpus's line/arc profiles.

## Robustness and guarantees
Evidence is exact for the inspected files. What it does not show: the default start-vertex heuristic in general, the treatment of unequal vertex counts (the only corpus case, the square-to-circle `upperRotor` throat, has no Onshape STEP export), the parameterisation Parasolid uses when a line is ruled to an arc, and the knot placement of multi-section skins.

## Parallelism and performance
Not applicable (static files). The scans are single-pass regex over ≤7.4 MB STEP files, <1 s each.

## Known failures, limitations, war stories
- Onshape does not export a hyperbolic-paraboloid entity (STEP has none; Parasolid has no such analytic class), so every twisted side becomes a B-spline in STEP. A consumer that only knows analytic types (like today's wonky) cannot even import these parts.
- The corpus report's statement that R6 parts "carry 42 to 334 B-spline faces from lofts and engraved text" is mostly engraved text: in `motorBracket_R6.step` all 46 B-splines are text-sized 3×1 extrusion faces (<5 mm), not lofts.

## Relevance for wonky
- **Answers question (a) of the gap for the corpus cases, with Onshape as ground truth:** prismatoid → planes; coaxial/equal-span arcs → right cones (cylinders for equal radii); twisted polygon pair → bilinear HP patch (degree (1,1) geometry, exported as 3×1 `.RULED_SURF.`); ≥3 sections → cubic C2 B-spline skin.
- The HP result is exact, so a wonky bilinear carrier can match Onshape bit-for-bit up to F32x2 rounding (four corners define it). It is a quadric: the exact implicit form follows from the corners (see the addendum), so the planned quadric SSI work (brep-booleans P1 plane/conic, P5 ruled-member) applies.
- Parity tests: the STEP files are ready-made oracles. Compare wonky's loft faces against `#50…` (corner post) and `#695…#698` (motorBracket) control points, and the `n141` cone parameters.
- STEP export: writing a twisted face as `B_SPLINE_SURFACE_WITH_KNOTS` 3×1 `.RULED_SURF.` with evenly spaced rows reproduces Onshape's own encoding (diff-friendly).

## Pointers worth porting or studying
`tmp/research/lofts/bsurf-scan.mjs --summary` as a corpus classifier for any new Onshape export; `bilinear-check.mjs` as the acceptance check for a wonky bilinear exporter; face ids above as fixtures.

## Verdict: adopt (as ground truth and test oracle)
It settles which carriers Onshape uses for the three two-profile loft classes in the corpus, and shows the twisted class is an exact quadric rather than a free-form fit.
