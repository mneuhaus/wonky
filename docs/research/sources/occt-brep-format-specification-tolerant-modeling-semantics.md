# OCCT BRep format specification (tolerant modeling semantics)

- Kind: official file-format specification. Canonical URL: https://occt3d.com/dev/doc/overview/html/specification__brep_format.html
- Other URLs: markdown source `dox/specification/brep_format.md` in https://github.com/Open-Cascade-SAS/OCCT (read at commit `3d097a0328e71b826377d4814ab05ec3c3d23871`; formulas are only legible there, the HTML renders them as MathJax SVG); Modeling Data user guide https://occt3d.com/dev/doc/overview/html/occt_user_guides__modeling_data.html ; the SameParameter semantics are in the Shape Healing guide (snapshot `tmp/research/occt-healing/shape_healing.txt`, see the separate note `occt-shape-healing-guide-and-brepcheck-validity-checking-and.md`). Local snapshots: `tmp/research/occt-docs/brep_format.{html,txt}`, `modeling_data.{html,txt}`.
- Authors/organization: Matra Datavision (format versions "CASCADE Topology V1/V2, (c) Matra-Datavision"), OPEN CASCADE SAS ("V3, (c) Open Cascade"). The spec dates from the 2000s and is maintained in the 2026 docs.
- License: documentation part of OCCT (LGPL-2.1 with exception). Implication (INFERRED): a file format and data-model semantics are facts and interfaces. Implementing a `.brep` reader or writer, or adopting the tolerance definitions, needs no OCCT code and creates no licensing obligation.
- Status: current. Version 3 adds triangulation normals; version 2 adds UV parameters of triangulation nodes and end-point UV values of pcurves (DOCUMENTED).

## What it is

A formal (BNF-like) description of OCCT's native B-rep file. It is the most compact precise statement of OCCT's **tolerant boundary representation**. Topology (vertex, edge, wire, face, shell, solid, compsolid, compound) references shared geometry (3D curves, 2D curves, surfaces, polygons, triangulations) under locations. Every vertex, edge and face carries a **tolerance** that bounds the disagreement among its multiple representations.

## How it works

### File structure (DOCUMENTED)
- Header `CASCADE Topology V1|V2|V3`, then `Locations`, `Geometry` (`Curve2ds`, `Curves`, `Polygon3D`, `PolygonOnTriangulations`, `Surfaces`, `Triangulations`), then `TShapes`. Shape records are numbered backwards and reference sub-shapes as `<orientation><index> <location>`.
- Orientation codes are `+` forward, `-` reversed, `i` internal, `e` external. The shape flag word has 7 flags: free, modified, checked, orientable, closed, infinite, convex.
- **Locations:** type 1 is a 3×4 matrix, type 2 a product of powers of earlier locations. Geometry is shared and positioned by locations (instancing).

### Geometry records (DOCUMENTED, all with explicit parametric equations)
- 3D curves: 1 line, 2 circle `C(u) = P + r(cos u·Dx + sin u·Dy)`, 3 ellipse, 4 parabola, 5 hyperbola, 6 Bezier, 7 B-spline, 8 trimmed, 9 offset. 2D curves use the same set.
- Surfaces:
  1. plane;
  2. cylinder `S(u,v) = P + r(cos u·Dx + sin u·Dy) + v·Dv`, `(u,v) ∈ [0,2π) × ℝ`;
  3. cone `S(u,v) = P + (r + v sin φ)(cos u·Dx + sin u·Dy) + v cos φ·Dz`, with reference radius `r` at `P` and `φ ∈ (−π/2, π/2)\{0}`; the apex direction is `−sgn(φ)·Dz`;
  4. sphere `S(u,v) = P + r cos v (cos u·Dx + sin u·Dy) + r sin v·Dz`, `v ∈ [−π/2, π/2]`;
  5. torus `S(u,v) = P + (r1 + r2 cos v)(cos u·Dx + sin u·Dy) + r2 sin v·Dz`;
  6. linear extrusion;
  7. revolution;
  8. Bezier;
  9. B-spline;
  10. rectangular trim;
  11. offset.
- Polygons and triangulations carry a **deflection** `d` with `max_{P∈C} min_{Q∈L} |Q−P| ≤ d`, the one-sided Hausdorff distance from exact to approximate.

### Topology data and tolerance definitions (DOCUMENTED, `brep_format.md` §7)
- **Vertex:** tolerance `t`, 3D point `V`, and representations: parameter `u` on a 3D curve; `u` on a 2D curve plus surface; or `(u,v)` on a surface. Invariant: **`max_{P∈R} |P − V| ≤ t`** over all representations.
- **Edge:** tolerance `t`, flags **SameParameter**, **SameRange**, **Degenerated**, and a list of representations:
  1. 3D curve + location + parameter range `[umin, umax]`;
  2. 2D curve (pcurve) on surface + location + range (+ UV at the ends, v2+);
  3. **two pcurves on a closed surface** (the seam edge) + continuity + range + end UVs;
  4. **regularity** between two surfaces: continuity order `C0|C1|C2|C3|CN|G1|G2` across the edge;
  5. 3D polygon;
  6. polygon on triangulation;
  7. two polygons on a triangulation (seam).

  Invariant: **`max_{C∈R} max_{P∈E} min_{Q∈C} |Q − P| ≤ t`**. Every representation stays within `t` of the edge.
- **Face:** natural-restriction flag, tolerance `t`, surface (may be empty), location, optional triangulation. Invariant: **`max_{P∈F} min_{Q∈S} |Q − P| ≤ t`**.
- The flags "are used in a special way" and the spec defers their meaning. From the Shape Healing guide (DOCUMENTED there):
  - **SameParameter**: the 3D curve and every pcurve give the same 3D point *for the same parameter* within the edge tolerance.
  - **SameRange**: all representations use the same parameter range.
  - **Degenerated**: an edge collapsed to a point (e.g. a sphere pole or cone apex) with only pcurves.
  - `BRepLib::SameParameter` enforces SameParameter by reparameterizing pcurves or **increasing the edge tolerance** ("No geometry modification, only an increase of tolerance is possible" for edges flagged same-parameter).
  - `ShapeAnalysis_Edge::CheckSameParameter(edge, maxdev, NbControl = 23)` samples 23 points.
- The Modeling Data guide defines **regularity** as the minimal continuity between the two faces along an edge (`BRep_Builder::Continuity`, `BRepLib::EncodeRegularity`). "Boolean Operations, Shape Healing … do not set regularity", fillets do. Regularity is consumed by chamfer, draft, hidden-line removal and gluing (DOCUMENTED, "Regularity of Shared Edges"). The guide also defines orientation semantics (FORWARD/REVERSED/INTERNAL/EXTERNAL as entering/exiting/touching from inside or outside) and point states IN/OUT/ON/UNKNOWN.

## Robustness and guarantees

- The model *defines* validity as containment of all representations in tolerance tubes and spheres. It guarantees nothing about how tolerances are obtained. Algorithms may grow them (the Boolean spec's `Tol = max(Tol, D + Tol')`), and checkers only sample (23 points; see the Boolean spec's own example of a split edge failing a check its parent passed).
- There is no upper bound on tolerances. A vertex tolerance of 50 is a legal file (the Boolean spec's "self-interference due to tolerances" example). Tolerances are unitless and absolute, so the model is scale-dependent (the Boolean spec's cylinder ×1000 / ×1e6 example).

## Parallelism and performance

Not applicable (format spec). INFERRED: shared geometry plus locations makes instancing cheap, and per-entity tolerances make every downstream predicate tolerance-aware and therefore slower. OCCT's `IntTools_Context` caches exist partly to amortize this.

## Known failures, limitations, war stories

- wonky's own evidence (DOCUMENTED, `docs/step-validation.md`): for an oblique cylinder cut, wonky's 3D ellipse is precise (residual about 7e-15 mm). But the OCCT STEP reader **rebuilds the cylinder pcurve as a cubic B-spline** that misses the 3D edge by up to about 1.49e-4 mm, while the imported edge tolerance stays 1e-7 mm. The default sampled `BRepCheck` passes; the exact CurveOnSurface check fails. This is the SameParameter invariant from this spec violated by the consumer, not by wonky. Changing STEP uncertainty and eight reader configurations did not help.
- INFERRED (math): an ellipse on a cylinder has the exact pcurve `u = t + ψ`, `v = v0 + γ cos t`. That is transcendental in the angular `u` coordinate, so no rational B-spline pcurve in `(u,v)` is exact. Every system must approximate such pcurves, and the tolerant model makes the edge tolerance the only place to declare that error.
- The Shape Healing note records further failure classes (tolerance explosion after fixing, sampled checks). See `occt-shape-healing-guide-and-brepcheck-validity-checking-and.md`.

## Relevance for wonky

- **A spec for a "certified deviation" field** (INFERRED). wonky's exact analytic B-rep can adopt the same *definitions* with the opposite discipline:
  - every entity whose representations are not identical by construction stores a **certified upper bound** `δ` in these exact formulas (vertex: max distance from representations; edge: one-sided Hausdorff over representations; face: surface-to-face);
  - `δ` is computed, never grown to make a check pass, and bounded by the per-operation budget wonky already tracks (`constructionBudget`, `docs/curved-intersection.md`);
  - exact-by-construction entities (plane/plane lines, plane/cylinder circles and lines, coaxial circles) carry `δ = evaluation error bound only`.
- **Parameterization choice that makes SameParameter hold by construction** (INFERRED, derivation). For plane `n·(P−p) = 0` and cylinder `o + r(cos u X + sin u Y) + v a` (unit `a`, unit `n`, `s = n·a ≠ 0`, `k = sqrt(1−s²)`, `ψ = atan2(n·Y, n·X)`, `d0 = n·(p−o)`):
  - principal ellipse frame `X' = cos ψ X + sin ψ Y`, `Y' = −sin ψ X + cos ψ Y`;
  - `E(t) = o + (d0/s) a + cos t · (r X' − (r k/s) a) + sin t · (r Y')`;
  - semi-axes `r/|s|` and `r`, orthogonal, matching OCCT's `IntPCy`;
  - on the cylinder `u = t + ψ`, `v = (d0 − r k cos t)/s`;
  - on the plane the pcurve is the affine image of `E`.

  With `E` parameterized by `t`, the 3D curve, the plane pcurve and the (transcendental) cylinder pcurve are exactly SameParameter and SameRange. Only the cylinder pcurve needs a B-spline approximation for STEP, with its deviation certified and written into STEP. wonky's `step-cylinder-pcurves.bend` already emits explicit B-splines with a spatial error budget. This formula lets the budget be computed against the exact `(t+ψ, v0+γ cos t)`.
- **STEP interop:** OCCT readers trust the file's uncertainty and pcurves, then may re-approximate. wonky's STEP writer should (a) emit pcurves whose certified deviation is below the declared `UNCERTAINTY_MEASURE_WITH_UNIT`, (b) keep 3D conics exact, and (c) record regularity (G1/C1) on tangent edges, since OCCT consumers (fillet, chamfer) use it. Keep validating with the exact CurveOnSurface check, as `docs/step-validation.md` does.
- **Seam edges and degenerated edges** are first-class in this model: two pcurves on one closed surface, and a point edge with pcurves at cone apexes and sphere poles. wonky's cylinder bands already handle seams. Cones (countersinks) will need the degenerated-edge concept or an explicit "apex vertex without edge" representation.
- **A `.brep` writer as a debugging/interop channel** (INFERRED): the format is simple text. Emitting `.brep` from wonky would let OCCT DRAW (`checkshape`, `bopcheck`) inspect wonky solids without STEP translation, as an external oracle (not a backend, consistent with project rules).
- **Bend fit:** a pure data model (records plus index references), serializable with U32/F32 words. Note that the text format stores f64 decimal. A wonky F32x2 value converts exactly to f64 (48 ≤ 53 bits); the reverse direction needs explicit rounding and an error term.

## Pointers worth porting or studying

- `dox/specification/brep_format.md` §5.1-§5.3 (curve and surface records with equations), §6.x (polygon and triangulation deflection), §7.2-§7.4 (vertex, edge and face data and tolerance formulas at L1781-L1874 of the markdown).
- Modeling Data guide sections "Topology", "Orientation", "State", "Regularity of Shared Edges".
- Shape Healing guide "SameParameter" operator (lines ~2706-2718 of the text snapshot) and `ShapeAnalysis_Edge::CheckSameParameter` (NbControl = 23).

## Verdict: learn-from

Adopt the vocabulary and the exact tolerance definitions (vertex/edge/face deviation, SameParameter/SameRange, seam and degenerated edges, regularity) as the spec for wonky's per-entity certified deviation bounds and STEP output. Reject the tolerant *discipline* (growable, uncapped, sampled-checked tolerances). Use the format itself optionally as a debugging export for external oracles.
