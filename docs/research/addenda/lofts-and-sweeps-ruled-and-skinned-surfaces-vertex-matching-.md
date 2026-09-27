# Lofts and sweeps: ruled and skinned surfaces, vertex matching, and what Onshape's `opLoft` produces

Research addendum, 2026-09-24. Gap filler for the biggest open demand in the corpus. Read-only research; no kernel code was changed.

Labels: **DOCUMENTED** (primary source or file evidence), **INFERRED** (my reasoning from evidence), **HEARSAY** (secondary). Per-source notes live in `docs/research/sources/`:

- [onshape-parasolid-loft-output-in-corpus-step-exports](../sources/onshape-parasolid-loft-output-in-corpus-step-exports.md) — the ground truth (new evidence from Marc's own Onshape STEP files)
- [onshape-std-oploft-opsweep-api-and-loft-sweep-help](../sources/onshape-std-oploft-opsweep-api-and-loft-sweep-help.md)
- [parasolid-pk-body-make-lofted-body-and-advanced-surfacing-chapter](../sources/parasolid-pk-body-make-lofted-body-and-advanced-surfacing-chapter.md)
- [occt-thrusections-brepfill-compatiblewires-geomfill-loft](../sources/occt-thrusections-brepfill-compatiblewires-geomfill-loft.md)
- local design note
- [truck-homotopy-surface-and-monstertruck-skin-builders](../sources/truck-homotopy-surface-and-monstertruck-skin-builders.md)
- [chen-zheng-sederberg-2001-mu-basis-of-a-rational-ruled-surface](../sources/chen-zheng-sederberg-2001-mu-basis-of-a-rational-ruled-surface.md)
- [sederberg-greenwood-1992-physically-based-2d-shape-blending](../sources/sederberg-greenwood-1992-physically-based-2d-shape-blending.md)
- [skinning-and-ruled-ssi-classics-metadata-only](../sources/skinning-and-ruled-ssi-classics-metadata-only.md)

Scripts written for this addendum (in `tmp/research/lofts/`): `bsurf-scan.mjs`, `bsurf-detail.mjs`, `bilinear-check.mjs`.

## 0. The answer in brief

1. **What Onshape produces (DOCUMENTED from its own STEP exports of corpus parts).**
   - Polygon pairs with planar side quads give **planes**.
   - Line+arc stadia with coaxial, equal-span arcs give **exact right cones**, e.g. `CONICAL_SURFACE` r = 13 mm, half-angle atan(0.5) for the R13→R10 slot `n141`.
   - Twisted polygon pairs give **exact bilinear patches** (hyperbolic paraboloids). They are stored as one-span 3×1 B-splines of form `.RULED_SURF.` whose rows are evenly spaced collinear control points; checked on 40 faces, residual ≤1.4e-12 mm.
   - Three or more sections give **cubic C2 B-spline skins**.
   - No rational B-spline appears anywhere.
2. **Semantics (DOCUMENTED, Parasolid).**
   - Equal vertex counts: vertices are matched nth-to-nth from the start vertices.
   - Unequal counts: the caller must imprint vertices or give explicit matches. Legal matches form a monotone, non-crossing staircase.
   - Faces are simplified to analytic surfaces "where the combination of profile geometries produces an analytic simplification" (default on).
   - Topology is MINIMAL, COLUMNS or GRID.
   - Onshape adds only: "if not [guides] Onshape estimates the proximity within the existing vertices".
3. **Which carrier each two-profile face needs (INFERRED from Chen-Zheng-Sederberg Lemma 1; the circle cases checked by hand).**
   - Coplanar lines give a plane. Skew lines give the bilinear HP (a quadric).
   - Arcs on parallel planes with equal spans give a quadric: a right cone or cylinder when coaxial, otherwise an oblique cone, an elliptic cylinder or a hyperboloid.
   - Line↔arc gives a cubic ruled surface, but only with a rational correspondence. With an angle- or arc-length correspondence it is not algebraic.
   - General arc↔arc gives a quartic.
4. **The corpus needs little.**
   - None of the 275 FS files uses `connections`, guides, end conditions, `loftTopology`, periodic lofts or `addSections` (MEASURED).
   - The 83 blocked loft units split as follows (corpus report):
     - 25 planar;
     - 10 coaxial-arc;
     - 28 twisted (bilinear);
     - 14 square-to-circle (line↔arc);
     - 6 multi-section.
   - 63 of the 83 therefore need only planes, cones and one new quadric, the bilinear patch.
5. **Proposed order.**
   - First, planar and coaxial-arc lofts (already planned) plus exact matching rules with introspection.
   - Then a `Bilinear` carrier with a twist certificate. It plugs into the quadric SSI already planned (brep-booleans P1/P5).
   - Then line↔arc as an exact rational cubic ruled face. Its parity against Onshape is measured, not assumed.
   - Last, multi-section skins, which are deferred and XL.

## 1. Landscape

### 1.1 Demand (MEASURED unless marked)

| source | count | note |
|---|---:|---|
| FS files calling `opLoft` (`~/Workspace/cad`, rg) | 275 (2146 lines, per the brief) | 0 use `connections`/`derivativeInfo`/`guideSubqueries`/`loftTopology`/`makePeriodic`/`addSections` (the 2 "connections" hits are comments) |
| FS files calling `opSweep` | 5 | circle along a planar path of lines and tangent arcs (PTFE tunnel, hot-wire game): exact cylinders + tori |
| `opRuledSurface`, `opHelix` | 0 | — |
| `.py` files with `loft(` | 34 (the brief reports 110 with a wider pattern) | most are generators that emit FS; 1 `ruled=True`; FreeCAD `Part.makeLoft(…,True,True)` once |
| loft units blocked, kernel-sketch-and-ops cluster | 49 | 17 planar, 14 twisted, 14 polygon-to-circle, 4 multi-section (first failing loft) |
| further units blocked right after Boolean fixes | 34 | 7 planar, 2+5 channel bases (planar), 10 channel bases (tapered slot `n141`), 8 `motorBracket` (twisted 1.29 mm), 2 multi-section |
| combined | 83 | 25 planar, 10 coaxial arcs, 28 twisted, 14 square-to-circle, 6 multi-section |

Two corpus idioms matter (DOCUMENTED, source reading):

- **Pairwise lofts as a manual sweep.** `ribbonLoft` lofts section k to k+1 and unites the pieces.
- **A 42-section `routeLoft` along a precomputed frame list.** The cable duct is a sweep in disguise. It even collects the start vertices (`v0`) and then never passes them.

Every loft in the cluster is followed by a `unite` or `cut` (corpus report).

### 1.2 What Onshape produces (DOCUMENTED, STEP evidence)

| loft class | Onshape output | evidence |
|---|---|---|
| prismatoid (corresponding edges parallel) | `PLANE` | `bases-r6-native.step` (0 B-splines although 10 lofts incl. hexagon prismatoids), `cableClamp_R6.step` |
| coaxial circles / coaxial equal-span arcs | `CONICAL_SURFACE` (or cylinder) | `CONICAL_SURFACE('',…,0.013,0.463647609000757)` = R13, atan(3/6) |
| twisted polygon pair | `B_SPLINE_SURFACE_WITH_KNOTS` 3×1 `.RULED_SURF.`, one Bézier span, evenly spaced collinear rows = exact bilinear patch | 26 faces R11 corner post, 10 `bottomPost_R6`, 4 bottom-drive assembly; twist 0.16…2.60 mm |
| ≥3 sections | 3×3 B-spline, simple interior knots (C2) across sections | `routeLoft` faces `#691/#693`, 7×55 control points for 42 sections |
| square-to-circle | not observed (no export) | open question 1 |

### 1.3 The semantics behind it (DOCUMENTED, Parasolid FD ch. 27 and `PK_BODY_make_lofted_body`)

- **Start vertices.**
  - Each profile needs at least one vertex and a start vertex.
  - "The start vertices for the profiles should be aligned to avoid twist" (Fig. 27-10).
  - Orientation must agree.
- **Matching with equal counts.** "All start vertices are matched with each other, then subsequent vertices on each profile are matched in order."
- **Matching with unequal counts.**
  - The caller either imprints vertices (`PK_EDGE_imprint_point`) or supplies `PK_BODY_loft_matches_t`.
  - Matches may only link neighbouring profiles.
  - Every vertex is matched at least once to each neighbour.
  - Vertices of intermediate profiles are matched exactly once.
  - "Paths must not cross over".
  - A repeated vertex means a degenerate section.
- **Failure.** `PK_ERROR_bad_profile_matching` fires when the matching "couldn't be incorporated into a non-intersecting collection of curves interpolating vertices along the loft direction". The fault point and topology are returned.
- **Simplification.** `simplify_yes` (default) replaces a lofted surface by an analytic one where possible, per whole face, without changing topology.
- **Topology.**
  - `minimal`: smoothly meeting profile edges may share one face.
  - `columns`: one face per edge column.
  - `grid`: additionally split at each profile.
- **Sweep.**
  - Alignment is normal (default) or parallel.
  - Twist and scale laws are defined on arc length and are not allowed on non-smooth paths.
  - Non-G1 path corners give mitred corners.
  - Self-intersection repair is attempted, but "locally self-intersecting surfaces and clashes between adjacent faces are not repaired".
  - Spin and sweep produce "analytic surfaces if possible".

What Onshape adds on top (DOCUMENTED, help):

- "For best results" equal vertex and segment counts;
- `connections` to control twist;
- for start vertices, "Onshape estimates the proximity within the existing vertices".

The heuristic itself is undocumented.

### 1.4 Open-source implementations

- **OCCT `BRepOffsetAPI_ThruSections`** (LGPL; used by build123d, CadQuery, FreeCAD):
  - Equal counts: `ComputeOrigin` tries all n cyclic shifts × 2 directions and minimises the summed vertex distance after aligning the barycentres.
  - Unequal counts: `SameNumberByPolarMethod` casts rays from the barycentre and imprints the hits on neighbouring sections.
  - Ruled faces are simplified only in two cases: a parallelogram gives a plane, and full coaxial circles give a cone or cylinder. Trapezoids and trimmed arcs become B-splines.
  - The smooth loft concatenates each section into one B-spline, makes the sections compatible and approximates across them (chord-length, C2, degree ≤6/8, 1e-6).
  - There is no twist check. Issue #1315 is a twisted, self-intersecting loft that `BRepCheck` reports valid.
- **build123d** only wraps OCCT. Its field reports show carrier loss:
  - trapezoids come out as BSPLINE (#756);
  - two-section lofts are degree-7 non-rational surfaces with arcs approximated, and offsets of them fail (#1469, #1351, #545).
- **truck / monstertruck** (Apache-2.0):
  - `try_wire_homotopy` needs equal edge counts, pairs edges i↔i, shares the lateral edges, and uses the procedural `HomotopySurface` (1−v)C0(u)+vC1(u).
  - It does no matching, simplification or validation.
  - monstertruck `skin` is only C0 at the sections, and its `sweep_rail` is sampled.
- **Parasolid** is closed. It is the reference behaviour through Onshape.

## 2. Comparison table

| source | kind | status | license | verdict | key idea for wonky | note |
|---|---|---|---|---|---|---|
| Onshape STEP exports (corpus) | file evidence | Sept 2026, Onshape 1.220/1.221 | private | adopt (oracle) | planes / cones / exact bilinear / cubic skin; fixtures for parity | [link](../sources/onshape-parasolid-loft-output-in-corpus-step-exports.md) |
| Onshape std `opLoft`/`opSweep` + help | API + docs | current | MIT (std) | adopt (interface) | contract; defaults the corpus relies on | [link](../sources/onshape-std-oploft-opsweep-api-and-loft-sweep-help.md) |
| Parasolid `PK_BODY_make_lofted_body`, FD ch. 27 | vendor docs | stable API | proprietary docs | adopt (semantics) | nth matching, legal match rules, simplify, fault classes | [link](../sources/parasolid-pk-body-make-lofted-body-and-advanced-surfacing-chapter.md) |
| OCCT ThruSections / CompatibleWires / GeomFill | code | active (2026-08) | LGPL-2.1+exc | learn-from | ComputeOrigin and polar imprint; weak simplification | [link](../sources/occt-thrusections-brepfill-compatiblewires-geomfill-loft.md) |
| build123d loft issues | tracker | active | Apache-2.0 | learn-from | carrier loss breaks offset/selection; no matching introspection | local design note |
| truck / monstertruck homotopy, skin | code | active | Apache-2.0 | adapt | topology of a ruled loft; procedural ruled surface | [link](../sources/truck-homotopy-surface-and-monstertruck-skin-builders.md) |
| Chen-Zheng-Sederberg 2001 (+Dohm, Sederberg-Saito) | paper | classic | Elsevier, author PDF | adapt | implicit degree m = λ − deg gcd; exact implicitization; carrier table | [link](../sources/chen-zheng-sederberg-2001-mu-basis-of-a-rational-ruled-surface.md) |
| Sederberg-Greenwood 1992 | paper | classic | ACM | adapt | staircase DP for correspondence; quadratic local-inversion test | [link](../sources/sederberg-greenwood-1992-physically-based-2d-shape-blending.md) |
| Woodward 1988, Piegl-Tiller 2002, NURBS Book §10.3, Heo-Kim-Elber 1999, Fuchs et al. 1977 | papers | paywalled | — | learn-from (pending) | skinning pipeline; ruled/ruled SSI; contour stitching | [link](../sources/skinning-and-ruled-ssi-classics-metadata-only.md) |

## 3. State of the art: techniques, guarantees, where they break

### 3.1 Vertex matching

- **Equal counts.** Parasolid's rule is exact once the start vertices and orientation are fixed (DOCUMENTED).
  - The start vertex is the only heuristic. OCCT minimises Σ‖p_prev,k − (p_cur,k+s + offset)‖ over the shifts s and both directions.
  - Onshape says "proximity" (DOCUMENTED wording, undocumented algorithm).
  - The corner-post exports show index i ↔ i in sketch order (DOCUMENTED, one family). That is consistent with both a min-distance rule and "start at the first polyline vertex" (INFERRED).
  - Failure mode: near-symmetric profiles (squares, regular polygons, circles) make several shifts almost equally good. A tiny edit then flips the matching and twists the part, as in OCCT #1315 (DOCUMENTED) and the 6.7.1 regression (HEARSAY).
- **Unequal counts.** The options:
  - OCCT casts rays from the barycentre (heuristic; tolerance `myPercent` = 10 % of the edge range).
  - Parasolid demands explicit matches.
  - Sederberg-Greenwood give an optimal staircase DP in O(mn), or O(mn ln n) over all starting points (DOCUMENTED).
  - The staircase is the same object as Parasolid's legal match set (INFERRED).
  - In the corpus only square→circle occurs. A full sketch circle has no vertex, so one must be imprinted in any case. For a centred square, rays from the centre and nearest points both give the 45° split (INFERRED).
- **Guarantee gap.** No system certifies the result. They match, then build, and at most check validity. Validity does not detect a wrong matching (OCCT #1315).

### 3.2 Carriers of two-profile ruled faces, and their exact forms

The face is P(u,v) = (1−v)·A(u) + v·B(u), with A and B the matched edges and u the correspondence parameter. With a rational correspondence it is a rational ruled surface of bidegree (n,1). Its implicit degree is m = λ − deg gcd(2×2 minors) ≤ 2n (Chen-Zheng-Sederberg Lemma 1, DOCUMENTED). The table below is INFERRED from that lemma:

| edge pair | m | carrier | Onshape (DOCUMENTED where observed) |
|---|---:|---|---|
| coplanar lines (planar quad) | 1 | plane | `PLANE` |
| skew lines, linear correspondence | 2 | hyperbolic paraboloid | exact bilinear, stored 3×1 `.RULED_SURF.` |
| arcs on parallel planes, equal spans, same sense | 2 | right cone/cylinder if coaxial; else oblique cone (homothetic), elliptic cylinder (translated), hyperboloid (rotated) | `CONICAL_SURFACE` for coaxial; others not observed |
| line ↔ arc, rational correspondence | ≤3 | cubic ruled surface (rational bidegree (2,1)) | not observed |
| line ↔ arc, angle/arc-length correspondence | — | not algebraic | Onshape's likely choice; no rationals in any export (INFERRED) |
| arcs in general position / unequal spans | ≤4 | quartic ruled surface | not in corpus |

**The bilinear patch in closed form** (INFERRED; elementary algebra, verify in tests):

- Let e = p10 − p00, f = p01 − p00, g = p11 − p10 − p01 + p00. Then P = p00 + u·e + v·f + uv·g.
- D = e·(f×g). The quad is planar iff D = 0. The twist T = |D|/|e×f| is the distance of p11 from the plane through the other three corners. This is the "twist" measured in the evidence note.
- **Inverse map**, valid for points on the surface, with d = x − p00: u = d·(f×g)/D and v = −d·(e×g)/D. This gives exact point inversion and inside-patch tests (0 ≤ u, v ≤ 1).
- **Implicit quadric:** D·(d·(e×f)) + (d·(f×g))·(d·(e×g)) = 0. The coefficients are integer polynomials in snapped corner coordinates: degree 3 (D) and degree 2 per bracket.
- **Normal:** N = e×f + u·(e×g) + v·(g×f). It is affine in (u,v) and never zero when D ≠ 0 (take the dot product with g). So the patch is regular and embedded; self-intersection can only come from interactions between faces.
- **Tessellation bound:** splitting a Δu×Δv cell into two triangles deviates from the patch by at most |g|·Δu·Δv/4. An N×N grid is certified to |g|/(4N²).
- **Planar approximation:** the best plane is within T/4 of the patch, but vertices cannot move, so this is not an alternative representation. Keep the patch.

**Volume oracle** (INFERRED, exact): between parallel planes the section at height t is the curve (1−t)A + tB. Its area is a quadratic polynomial in t for any correspondence. Hence V = h/6·(A0 + 4·A½ + A1) (prismatoid formula) for every two-profile ruled loft between parallel planes, polygon, square-to-circle or slot. A½ is the area of the average curve. This gives closed-form volume checks independent of the kernel.

### 3.3 Skinning (≥3 sections)

The classic pipeline is DOCUMENTED in OCCT code; the Woodward, Piegl-Tiller and NURBS Book sources were not read:

1. Make the sections compatible: common degree, common knot vector by knot union.
2. Parameterise across the sections (chord length).
3. Interpolate or approximate each control-point column.

Onshape gives a cubic with simple interior knots; its knot count (55 for 42 sections) shows extra knots or fitting (DOCUMENTED counts, rule unknown). Exact parity is therefore impossible without Parasolid's rule. Any wonky skin can match Onshape only within a measured tolerance. Known anomalies are wiggles from knot merging and bad parameterisation (Piegl-Tiller 2002 "avoids anomalies"; HEARSAY-level).

### 3.4 Sweeps

- **Exact cases** (DOCUMENTED principle: Parasolid "analytic surfaces if possible"; truck `tsweep`/`rsweep`):
  - translation of lines and arcs gives planes and cylinders;
  - rotation gives planes, cylinders, cones, spheres and tori;
  - with normal alignment, a profile swept along a planar path of lines and tangent arcs is piecewise exact. Circle along a line gives a cylinder, circle along an arc a torus section, and a rectangle along an arc planes, cylinders and annuli.
  - The 5 corpus `opSweep` files are all of this kind.
- **Not exact:** twist/scale laws, `keepProfileOrientation` along curves, 3D paths, helices. There is no corpus demand for these, so wonky should refuse them explicitly.

### 3.5 Twist and self-intersection

- **Local test.** At each vertex the angle between the neighbouring edges, over t, has tan θ(t) = quadratic/quadratic (Sederberg-Greenwood eq. 6, DOCUMENTED). A fold happens exactly when the quadratic Bézier Q(t) crosses the positive x-axis. The predicates are exact on integer inputs.
- **Global test, parallel planes** (INFERRED). The loft is simple iff every section (1−t)P⁰ + tP¹ is a simple polygon (curve). Non-adjacent edges cross only where an orientation predicate of linearly moving points changes sign. Each such predicate is a quadratic in t. There are O(n²) pairs, uniform in size, decided with an exact sign-and-root count on multi-limb integers.
- **Global test, general position** (INFERRED):
  - each bilinear patch lies in the tetrahedron spanned by its four corners (convex-hull property);
  - disjoint hulls of non-adjacent faces certify that those faces do not meet;
  - an overlap is refined by subdividing the patch, which stays bilinear, or refused with a witness point, like Parasolid's fault point.
- The kernels studied give no guarantee. Parasolid returns `bad_profile_matching` for crossing matches. OCCT has no check (#1315).

### 3.6 Downstream: Booleans, export, print

- **Ruled face ∩ plane** is one linear solve per ruling: v(u) = (c − n·A(u)) / (n·(B(u) − A(u))). The result is a rational graph over u, exact.
  - A plane parallel to both profile planes gives the intermediate section itself.
  - This covers the square-to-circle throat, whose cut meets only planes of constant height (INFERRED from `upperRotor` source).
- **Ruled face ∩ quadric** is one quadratic per ruling, the Miller/Levin generator idea already planned as brep-booleans P5.
  - The bilinear patch is itself doubly ruled, so it can serve as the "ruled member".
  - HP ∩ cylinder/cone/sphere/HP then needs no pencil or DLLP machinery.
  - The discriminant Δ(u) has degree ≤4, as in P5 (INFERRED).
- **Plane ∩ HP** is a conic (parabola, hyperbola or line pair). brep-booleans P1 already adds hyperbola and parabola.
- **Ruled ∩ ruled** (general) reduces to coplanarity of rulings, det(A1(s)−A2(u), D1(s), D2(u)) = 0, a bivariate curve (Heo-Kim-Elber; INFERRED reduction, paper not read). The corpus needs it rarely (INFERRED).
- **Classification only.** Many corpus Booleans may never cut a loft face. For example the `upperPost` shoulder is united face-to-face with a prism, and the hollow pocket stays inside the loft. Such cases need only ray/patch classification, a quadratic (INFERRED; to be measured, P-L4).
- **STEP.** Export the bilinear patch like Onshape does, as 3×1 `.RULED_SURF.` with evenly spaced rows. It is exact and diffs cleanly against Onshape exports.
- **Print mesh.** Use the tessellation bound above for a certified deviation. `src/print-mesh.mjs` currently refuses faces bounded by trimmed arcs (corpus report). Slots and line↔arc lofts will hit that next.

## 4. War stories and anti-patterns

- **A twisted loft reported valid.** OCCT #1315: 9-edge rounded rectangles, wrong correspondence, self-intersecting band, volume 1450 vs 15700, `IsValid() == true`. Anti-pattern: trusting validity as a correctness check for lofts.
- **Crash on unequal counts.** OCCT #1297: SIGSEGV in the polar method when a correspondence chain is short. It is fixed by a guard. Anti-pattern: heuristic chains without an explicit failure path.
- **Carrier loss.**
  - build123d #756: frustum sides are BSPLINE, and plane selection fails.
  - #1469: arcs approximated at degree 7, then offset/shell produces zero-width faces.
  - #1351/#1353: loft vs extrude+draft of the same shape; only the loft fails to offset.
  - Anti-pattern: approximating what is analytic. Onshape shows it is avoidable for planes and cones.
- **Heuristic start vertex.** Parasolid Fig. 27-10: misaligned start vertices twist silently. Onshape documents only "for best results". Anti-pattern: silent heuristic matching without introspection. In the corpus, `routeLoft` computes start vertices (`v0`) and never passes them.
- **Sampled sweeps.** monstertruck `sweep_rail` approximates even a straight extrusion. Anti-pattern: sampling what has a closed form.

## 5. Ranked proposals for wonky

The ranking weighs units unblocked per effort, then robustness. The corpus report's phases 1 (planar ruled loft) and 1b (lines + coaxial arcs → planes and cones) stand. They are confirmed by Onshape's output, and the proposals below build on them. Current gates: `src/library.mjs:897–904` and the mirror `src/lang/wk/record-fs.mjs:222–226`. Both still say "opLoft currently requires two coaxial circular profiles"; the brief's `library.mjs:235` has moved.

### P-L1 (S). Exact matching rules, explicit ambiguity errors, matching introspection

**Idea.**

- **Matching rules.** Implement Parasolid's rules exactly:
  - both profiles oriented the same way;
  - equal counts matched nth-to-nth from the start vertices;
  - legal explicit matches form a monotone staircase.
- **Start-vertex choice.** Minimise the sum of squared distances of matched vertices over the n cyclic shifts, after barycentre alignment (OCCT's rule, squared for exact integer evaluation).
  - Decide ties exactly. If the best and second-best differ by less than a stated tolerance, raise `LoftMatchingAmbiguous{profiles, candidates, costs}` instead of guessing.
  - `connections` remain the way to disambiguate; implement them when a corpus unit needs them.
- **Unequal counts.** Imprint vertices on the profile with fewer vertices at the points nearest to the other profile's vertices, or run a staircase DP on squared distance. For square→circle this is the 45° split.
- **Provenance.** Record the chosen matching per face: which input vertex went to which. Expose it in queries, the diff and the viewer. This is also the LLM-facing explanation of twist.

**Where it plugs in.** Host `opLoft` and the `record-fs` mirror; face provenance; the `diff` output.

**Bend fit.** n shifts × n squared distances on snapped integers is a uniform map + min-reduce (fork-join). The DP is a small wavefront.

**Benefit.** It is a prerequisite for every loft class and removes the silent-twist class of bugs. Check it against the corner-post fixtures (index i ↔ i) and the `motorBracket` pentagon.

**Risks.** Onshape's "proximity" may differ from min-squared-distance on some profiles. Mitigation: the fixture suite from STEP exports (P-L8), and a refusal rather than a guess when the choice is close.

### P-L2 (M). A `Bilinear` carrier: the exact surface of every twisted side (28 units' lofts)

**Idea.**

- **Carrier.** Add `Bilinear{p00, p10, p01, p11}` (F32x2) to `kernel/analytic.bend` next to `Plane`, `Cylinder`, `Cone`, `Sphere`, `Torus`. Store the exact derived data from §3.2: D, the inverse map, the implicit quadric and the affine normal.
- **Constructor.** `ruled(bottom, top)`, with the extrusion layout of the corpus plan: 2n vertices, 3n edges, n+2 faces. Per side:
  - planar (D = 0 on snapped inputs, or T below the kernel's linear resolution): `Plane`;
  - otherwise: `Bilinear`, with the measured twist recorded.
- **Validation.** Face regularity is automatic (the normal never vanishes). Loft simplicity comes from P-L3.
- **Tessellation.** Uniform N×N grid with N = ⌈√(|g|/(4ε))⌉ for a certified ε.
- **STEP.** 3×1 `.RULED_SURF.` single span with rows at 0, 1/3, 2/3, 1: Onshape's encoding.

**Where it plugs in.** `analytic.bend`, `validateAnalytic`, STEP writer, print mesh, viewer. It is a new carrier for recover and the planar arrangement to classify against.

**Bend fit.** Everything is closed-form F32x2 arithmetic and uniform per sample (GPU-friendly). The exact decisions (D = 0, inside tests) need 3–7 U32 limbs on snapped inputs (INFERRED estimate).

**Benefit.** Admits 20 cluster units and 8 `motorBracket` units at the loft stage, and matches Onshape's geometry exactly (4 corners). The Booleans remain the gate (P-L4).

**Risks.** Every Boolean path must now accept a quadric that is neither natural nor of revolution. Without P-L4 the units only move to the next blocker, as the corpus report warns.

### P-L3 (S–M). Twist and self-intersection certificate with a witness

**Idea.**

- **Profiles on parallel planes** (all corpus twisted cases so far):
  - Sederberg-Greenwood's per-vertex quadratic fold test;
  - an O(n²) test of non-adjacent edge pairs of the moving section polygon, via quadratics in t.
  - Both are exact on multi-limb integers.
- **General position:** tetrahedral-hull BVH of the bilinear faces, disjointness of non-adjacent faces, subdivision up to a depth limit.
- **Failure:** `LoftSelfIntersects{faces, t or point}`, never a silent result.

**Where it plugs in.** Right after P-L1/P-L2 in `opLoft`; it is reused by any future sweep.

**Bend fit.** O(n²) identical predicate evaluations: a flat uniform map, ideal for fork-join or GPU.

**Benefit.** Closes the OCCT #1315 failure class. Use #1315's wires as a negative regression test after snapping them to planar profiles, or reproduce the pattern.

**Risks.** The subdivision depth for near-touching faces needs an explicit limit and error.

### P-L4 (M, staged). Booleans that accept `Bilinear` faces

**Idea.** Measure first, then add only what the 28 units need.

- **Measure.** Run the corpus harness with an exact-bilinear proxy. For every Boolean after a twisted loft, record whether a tool face actually intersects a bilinear face (mesh-level test). The result splits the demand into three stages:
  - **(a) classification only:** ray ∩ patch as one quadratic, point-in-solid;
  - **(b) plane ∩ HP conics:** extends brep-booleans P1 (hyperbola and parabola are already planned there);
  - **(c) HP ∩ cylinder/cone/sphere:** extends P5, with the HP's rulings as the ruled member (one quadratic per ruling, Δ(u) of degree ≤ 4).
- On the recover route, the tagged mesh decides the topology and these relations recover the exact curves.

**Where it plugs in.** The recover table (`docs/proto-recover.md` lists planes, cylinders, cones, spheres and tori today); later `kernel/intersections.bend`.

**Bend fit.** As P1/P5: small branchy exact work per pair on the CPU, uniform evaluation for samples.

**Benefit.** Turns P-L2's admitted lofts into finished parts (up to 28 units).

**Risks.** It depends on the Boolean bake-off outcome. Stage (c) inherits P5's bigint budget question.

### P-L5 (M–L). Line↔arc faces (square-to-circle, 14 units)

**Idea.**

- **Correspondence.** Choose an explicit, documented correspondence: the rational one. The arc becomes a rational quadratic (weights 1, cos(Δ/2), 1) and the line is linear. The face is then an exact rational bidegree (2,1) ruled surface with implicit degree ≤3 (Chen-Zheng-Sederberg). Keep it procedural (`HomotopySurface`-like: two boundary curves) with an implicit form for classification.
- **Cuts.** Plane cuts are per-ruling linear, and cuts by planes parallel to the profiles are the intermediate sections. That is all `upperRotor` needs (the cut against base planes at constant z; INFERRED from source).
- **Parity.** Onshape's correspondence is unknown and probably not rational (no rational B-splines in exports). The deviation between the two must be measured once, not assumed. Ask Marc for one Onshape STEP export of the `upperRotor` throat, then compare wonky's face against it and record δ in the parity test.

**Where it plugs in.** A new ruled carrier variant; STEP as rational B-spline (exact) with pcurves; print mesh with a second-derivative bound.

**Bend fit.** Evaluation is uniform (de Boor/rational Bézier in F32x2). The exact decisions go through the implicit cubic on multi-limb integers.

**Benefit.** Unblocks the 14 polygon-to-circle units, if δ is acceptable for FDM (likely: the parts are printed at ±0.1 mm or worse; INFERRED).

**Risks.**

- A visible mismatch with Onshape geometry at interior points: wonky and Onshape both produce valid lofts through the same edges, but with different rulings.
- Onshape may imprint the circle at different points than 45°. This is the risk P-L1 carries.

### P-L6 (S–M). Exact sweeps for the existing `opSweep` corpus, explicit refusal for the rest

**Idea.**

- `opSweep` with the default normal alignment, a planar G1 path of lines and arcs, and a line/arc/circle profile produces planes, cylinders, cones and tori piece by piece.
- Mitred corners at non-G1 path vertices follow Parasolid.
- Refuse twist, scale, `keepProfileOrientation` on curved paths, 3D paths and helices with named reasons.
- For wonky's native language (LLM ergonomics): offer a real `sweep` and a `loft(ruled)` so that authors stop emulating sweeps with 42 hand-framed sections.

**Where it plugs in.** Host `opSweep`; the kernel's existing extrude/revolve constructors (`sweepInBend`, `kernel/revolve.bend`).

**Bend fit.** Existing analytic constructors; one fork-join map over path segments.

**Benefit.** 5 FS files (PTFE tunnel variants, hot-wire game). Exact tori and cylinders instead of skins.

**Risks.** Tori in Booleans need the recover route's torus support.

### P-L7 (XL, defer). Multi-section skins and general arc↔arc quartics

**Idea.**

- Cubic C2 skinning through compatible sections: Piegl-Tiller pipeline, chord-length parameters across the sections.
- Its deviation from Onshape's skin is measured and stored in provenance.
- General arc↔arc ruled faces (quartic) are only needed if a unit appears.

**Benefit.** 6 units (`feederOfframp`, hopper, cable duct).

**Risks.**

- Onshape's knot rule is unknown, so parity is by tolerance only.
- B-spline Booleans are far off.

**Recommendation.** Keep the explicit error until the rest is done. For `routeLoft`, whose sections are rigid copies along a path, consider emitting an exact sweep in wonky-native rewrites rather than in FS parity mode.

### P-L8 (S). Oracles and fixtures (do first, alongside P-L1)

- **Onshape parity fixtures** from the STEP evidence:
  - corner-post faces `#50…` (R11), with their corner coordinates and matching;
  - `motorBracket` `#695…#698`;
  - the `n141` cone (r 13 mm, half-angle atan 0.5);
  - `bases-r6-native.step`: zero B-splines expected.
- **Closed-form volumes:**
  - prismatoid formula V = h/6(A0 + 4A½ + A1) for every parallel-plane two-profile loft, including twisted ones;
  - the tapered slot 4140 + 798π mm³ (corpus report).
- **Negative tests:**
  - OCCT #1315 pattern (twist must be refused);
  - a build123d #756 frustum (must give 4 planes);
  - near-symmetric profiles (must give `LoftMatchingAmbiguous` or a documented deterministic choice).
- **Tooling:** keep `tmp/research/lofts/bsurf-scan.mjs --summary` and `bilinear-check.mjs` as corpus oracles for any new Onshape export (promote them to `tools/` only if the project wants them).

## 6. Open questions

1. How does Onshape imprint the circle in a square-to-circle loft, and what correspondence does it use along line↔arc faces? One Onshape STEP export of the `upperRotor` throat answers both. It needs Marc: an Onshape action outside this read-only study.
2. Onshape's start-vertex "proximity" rule on symmetric profiles: is it min-distance, sketch order, or something else? Build a small FS probe suite (square rotated by 0°, 44°, 46°) and export. Also an Onshape action.
3. How many of the 28 twisted-loft units actually intersect a bilinear face in their subsequent Booleans (P-L4 measurement)?
4. The tolerance for treating a nearly planar side as planar. Onshape exported the hexagon prismatoid sides (planar to 4e-13 mm per the corpus report) as planes and 0.16 mm twists as bilinear patches; the threshold between them is unknown. Proposal: the kernel's linear resolution, with the measured twist in provenance.
5. Parasolid's knot placement for multi-section skins (55 control points for 42 sections), only relevant for P-L7.

## 7. Sources

Primary, read:

- Onshape std 3083 mirror (MIT): `tmp/research/onshape-std-3083/repo/geomOperations.fs`, `loft.fs`, `lofttopology.gen.fs`, `sweep.fs`, `sweeptwisttype.gen.fs`, `ruledsurfacetype.gen.fs`.
- Onshape help: https://cad.onshape.com/help/Content/loft.htm , https://cad.onshape.com/help/Content/sweep.htm
- Parasolid docs: http://www.q-solid.com/Parasolid_Docs/headers/pk_body_make_lofted_body.html , …/pk_body_make_lofted_body_o_t.html , …/chapters/fd_chap.28.html , …/chapters/fd_chap.14.html (local: `tmp/research/parasolid-loft/`)
- OCCT at 3d097a0: https://github.com/Open-Cascade-SAS/OCCT (local sparse clone `tmp/research/occt-loft/`); issues https://github.com/Open-Cascade-SAS/OCCT/issues/1315 , /1297 ; repro https://github.com/KeithSloan/OpenSCAD_Workbench/tree/GeneralBrepLofts/OCCT/loft_error ; Mantis https://tracker.dev.opencascade.org/view.php?id=28642 , id=26123
- build123d: https://github.com/gumyr/build123d/issues/756 , /1469 , /1351 , /1353 , /545 , /1022 , /681 ; `_make_loft` at e22d34d (local clone)
- truck 8d03d8f / monstertruck e6520c2 (local clones): `builder.rs`, `decorators/homotopy.rs`, `bspline_surface/builders.rs`, `nurbs/compat/mod.rs`
- F. Chen, J. Zheng, T. W. Sederberg, "The mu-basis of a rational ruled surface", CAGD 18 (2001) 61–72, https://archive.ymsc.tsinghua.edu.cn/pacm_download/53/510-jZ-ruledsurface.pdf
- M. Dohm, arXiv math/0702658, https://arxiv.org/pdf/math/0702658
- T. W. Sederberg, E. Greenwood, "A Physically Based Approach to 2-D Shape Blending", SIGGRAPH '92, https://www.cs.drexel.edu/~deb39/Classes/Papers/p25-sederberg.pdf
- Onshape STEP exports and FS sources in `~/Workspace/cad` (paths in the evidence note); corpus report `docs/corpus/cluster-kernel-sketch-and-ops.md` §2.2.

Metadata only (paywalled/blocked): Woodward 1988 (doi:10.1016/0010-4485(88)90002-4), Piegl-Tiller 2002 (doi:10.1007/s003710100156), Heo-Kim-Elber 1999 (doi:10.1016/S0010-4485(98)00078-5), Fuchs-Kedem-Uselton 1977 (doi:10.1145/359842.359846), Sederberg-Saito 1995 (doi:10.1006/gmip.1995.1029), The NURBS Book §10.3.
