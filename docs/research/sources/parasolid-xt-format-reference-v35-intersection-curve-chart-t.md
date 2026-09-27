# Parasolid XT Format Reference (V35): INTERSECTION curve, chart, terminators, tolerant edges

- Kind: vendor file-format specification (PDF), not code. Canonical: http://www.q-solid.com/Parasolid_Docs_V35/pdf/xt.pdf (132 pages, FrameMaker 2015, created 2022-07-22, "© Siemens PLM"). Older edition: http://www.13thmonkey.org/documentation/CAD/Parasolid-XT-format-reference.pdf (123 pages, UGS Corp., October 2006). Both fetched 2026-09-22 (HTTP 206) and read locally from `tmp/research/pdf/parasolid-xt-v35.pdf` and `parasolid-xt-2006.pdf`.
- Authors/org, year: Siemens Digital Industries Software (formerly UGS / EDS Unigraphics, Cambridge UK). V35 text ~2022, 2006 text by UGS.
- License and porting implications: proprietary document, copyright Siemens; the XT format is published so that third parties can read and write `.x_t` files. No code is included and none is implied. Describing the data model and re-implementing an equivalent representation from the published definitions is fine. Copying text or Parasolid algorithms beyond what the format defines is not. The actual Parasolid intersector, marcher and tolerant modelling code are closed and unreachable. INFERRED.
- Status: live. Parasolid is the kernel behind NX, Solid Edge, SolidWorks, Onshape, Shapr3D and others. XT is versioned with the kernel, and V35 is one of the latest publicly mirrored editions. The q-solid.com mirror is a third-party host, not Siemens. DOCUMENTED (title pages), HEARSAY (mirror provenance).

## What it is

The reference defines every node type in a transmitted Parasolid part: topology (BODY, REGION, SHELL, FACE, LOOP, FIN, EDGE, VERTEX), geometry (curves, surfaces, points), attributes, and since V3x also mesh and lattice nodes. It matters to wonky mainly for one thing: how a production kernel **stores a general surface-surface intersection curve without converting it to a spline**. The INTERSECTION curve is two surface pointers plus a polyline "chart" of exact points, plus rules that define the true curve pointwise as the solution of a small local system. The second relevant part is how tolerant edges are stored (per-fin SP-curves, no edge curve). DOCUMENTED (V35 pp. 44-48, 49-52, 30, 96-98).

## How it works

### Curve and surface catalogue (V35 ch. 5)
- Curves: LINE, CIRCLE, ELLIPSE, INTERSECTION, TRIMMED_CURVE, PE_CURVE, B_CURVE, SP_CURVE, POLYLINE. There is no parabola or hyperbola type: conic sections that are not circles or ellipses must come out as INTERSECTION or B_CURVE. DOCUMENTED (V35 p. 34 union, sec. 5.2.1).
- Parametric forms (DOCUMENTED, V35 sec. 5.2.1, 5.3.1):
  - line P + tD
  - circle C + r X cos t + r Y sin t
  - ellipse C + a X cos t + b Y sin t
  - plane P + uX + vY
  - cylinder P + r X cos u + r Y sin u + vA
  - cone P - vA + (X cos u + Y sin u)(r + v tan a). This is a half-cone: the axis points away from the used half, the node stores sin and cos of the half angle, and the PK-interface axis is opposite.
  - sphere C + (X cos u + Y sin u) r cos v + r A sin v
  - torus C + (X cos u + Y sin u)(a + b cos v) + b A sin v. Subtypes: doughnut a > b; apple 0 < a <= b; lemon a < 0, |a| < b; a = 0 is not allowed and must be a sphere.
- Surfaces: PLANE, CYLINDER, CONE, SPHERE, TORUS, BLENDED_EDGE, BLEND_BOUND, OFFSET_SURF, SWEPT_SURF, SPUN_SURF, PE_SURF, B_SURFACE, and in V35 also MESH. DOCUMENTED (V35 p. 34 union, sec. 5.3).

### INTERSECTION curve (V35 pp. 44-48)
```
struct INTERSECTION_s == ANY_CURVE_s {
  surface[2];              // the two surfaces
  CHART chart;             // ordered exact points on the curve
  LIMIT start, end;        // how the ends are bounded
  nolog INTERSECTION_DATA intersection_data;  // optional cached uv
}
hvec { vector Pvec; double u[2], v[2]; vector Tangent; double t; }  // only Pvec transmitted
CHART_s { base_parameter; base_scale; chart_count; chordal_error; angular_error;
          parameter_error[2] /* always null */; hvec[] }
LIMIT_s { char type; char term_use; hvec[] }
```
DOCUMENTED (V35 pp. 44-47).

- Design contract, quoted: the node's information "is sufficient to identify the particular intersection branch involved, to identify the behaviour of the curve at its ends, and to evaluate precisely at any point in the curve". The limits "identify the particular branch involved". At terminators "the tangent to the curve is defined by the limit of the curve tangent as the curve parameter approaches the terminating value". The parameterisation "increases as the array index increases". DOCUMENTED (V35 sec. 5.2.1.5, p. 44).
- Chart points and error fields (corrected 2026-09-23 against the V35 text; an earlier version of this note overstated them):
  - Every chart point `pvec` is "a point common to both surfaces". That means within the linear resolution. DOCUMENTED (V35 p. 45) and INFERRED (the resolution qualifier).
  - `chordal_error` is "an **estimate** of the maximum deviation of the curve from the piecewise-linear approximation given by the hvec array. It **may be null**."
  - `angular_error` is "the maximum angle between the tangents of two sequential hvecs. It may be null." It measures chart density, not a deviation.
  - `parameter_error[]` is always [null, null].

  DOCUMENTED (V35 p. 45). So the chart is an exact *sampling* of the true curve, but its polyline deviation is only an estimate, not a certificate. A consumer that needs a guaranteed bound (wonky's certified print mesh) must compute its own, for example via the Yang 2025 refinement criteria or a curvature bound.
- The natural tangent direction is the normalized cross product of the two sense-corrected surface normals. The curve direction is fixed by this, with no separate sense flag. DOCUMENTED (V35 p. 45).
- **Parameterisation** (V35 p. 46, checked against the rendered PDF page, since the text extraction garbles subscripts). For chart points P_i with tangents T_i:
  - C_i = |P_{i+1} - P_i|
  - cos a_i = T_i · (P_{i+1} - P_i) / C_i
  - cos b_i = T_i · (P_i - P_{i-1}) / C_{i-1}
  - f_0 = base_scale, f_i = (cos b_i / cos a_i) f_{i-1}
  - t_0 = base_parameter, t_i = t_{i-1} + C_{i-1} f_{i-1}

  DOCUMENTED. The f_i factors make the parameterisation C1 across chart points. Derivation (INFERRED, mine): Q(t) lies in the plane orthogonal to chord i through the chord point, so Q'·d_i = 1/f_i where d_i is the unit chord. At P_i both neighbouring chords see the same Q' parallel to T_i, which gives |Q'| cos b_i = 1/f_{i-1} and |Q'| cos a_i = 1/f_i.
- **Parameter of a point:** project the point onto the chord between the neighbouring chart points and interpolate t linearly. DOCUMENTED (V35 p. 46). The 2006 edition instead says "projecting onto the tangent line at the previous chart point", omits the /C_i normalisation, and does not define evaluation at all. Any secondary source that describes chart evaluation as "project onto the tangent line and refine" is quoting the 2006 text. DOCUMENTED (2006 PDF, INTERSECTION section).
- **Evaluation at t (interior):** the curve point is the local solution of three equations: surface[0], surface[1], and the plane through the chord point ((t_{i+1} - t) P_i + (t - t_i) P_{i+1}) / (t_{i+1} - t_i) orthogonal to the chord P_{i+1} - P_i. DOCUMENTED (V35 p. 47). This is a 3x3 Newton solve seeded by the chord point, well conditioned wherever the surfaces are transversal.
- **Evaluation near a terminator** (between the last chart point, the "branch point", and the terminator): only one surface is used, plus two planes.
  - The surface is surface[0], unless surface[0] is singular there and surface[1] is not, or surface[0] is a BLEND_BOUND, or `term_use` says otherwise.
  - Plane 1 contains the branch-terminator chord and the surface normal at the terminator (or the curve tangent at the branch point).
  - Plane 2 is orthogonal to the chord at the chord point.

  This avoids solving the ill-conditioned two-surface system at a tangency or singularity. DOCUMENTED (V35 pp. 47-48).
- **LIMIT types** (DOCUMENTED, V35 p. 46):
  - `H`: help point, used on a closed curve (1 hvec).
  - `T`: terminator (2 hvecs). The first is the exact singular point; the second is a nearby branch point that is also in the chart. The singularity lies just outside the chart's parameter range.
  - `L`: artificial limit on an infinite branch.
  - `B`: spine boundary of a degenerate rolling-ball blend.

  `term_use` is `?`, `F` or `S` (which surface to use near the terminator). Terminators only occur at curve ends. A curve through a tangency must therefore be split there.
- **intersection_data** (V35 p. 47): optional cached surface parameters.
  - `uv_type` is none/first/second/both, giving 0, 2 or 4 doubles per hvec.
  - Values are ordered start-terminator, chart hvecs, end-terminator.
  - It is a `nolog` field, so it is a cache and not part of the definition.

### Blends (V35 pp. 60-62)
- BLENDED_EDGE (rolling ball) is R(u,v) = C(u) + r X(u) cos(v a(u)) + r Y(u) sin(v a(u)).
  - The spine C(u) is the intersection of the two supporting surfaces, each offset by `range[i]` (signed, negated for negative sense).
  - Type is `R` (rolling ball) or `E` (cliff edge). `thumb_weight` is always [1,1] and `boundary` is always [0,0].
  - v = 0 on the surface[0] boundary, v = 1 on surface[1], and v is proportional to angle in between.
  - start/end LIMITs are used when the spine is periodic but the blend has terminators.
- BLEND_BOUND is an implicit surface with no parameterisation: f(X) = f0(X + r1 grad f1(X)) - r0. It serves as the second surface of the INTERSECTION curve that forms a blend's boundary.
- The dependency ring (GEOMETRIC_OWNER):
  - An intersection depends on its 2 surfaces.
  - An SP-curve depends on its surface.
  - A trimmed curve depends on its basis.
  - A blended edge depends on its 2 supporting surfaces, 2 blend bounds and the spine.
  - An offset surface depends on its underlying surface.

DOCUMENTED (V35 sec. 5.3, 5.5).

### Resolution and tolerant topology (V35 pp. 26, 30, 49-52, 96-98)
- Linear resolution is 1e-8: points closer than this coincide. Angular resolution is 1e-11 rad.
- Everything must lie in a 1000 x 1000 x 1000 size box centred at the origin. Units are metres, so the box is 1 km.
- Arc radii must be < 10x the size box.

  DOCUMENTED (V35 sec. 4.2.1 p. 26).
- An accurate edge or vertex has tolerance = half the linear resolution (stored as null). Anything else is tolerant. DOCUMENTED (V35 p. 30).
- A **tolerant edge** has `edge.curve = null`.
  - Each non-dummy fin (half-edge) carries a TRIMMED_CURVE whose basis is an SP_CURVE on that fin's face surface.
  - The fin curves must lie within the edge tolerance of each other, with ends within the vertex tolerance.
  - An accurate edge that has tolerant vertices gets a TRIMMED_CURVE.
  - The face tolerance field exists but is "not used".

  DOCUMENTED (V35 pp. 49-52, 96-98).
- SP_CURVE is a 2D B-curve in the surface's (u,v) space: rational dimension 3, or non-rational dimension 2. TRIMMED_CURVE carries parm/point pairs, sense ordering, periodic rules, and closed non-periodic ends coincident to 1e-8. DOCUMENTED (V35 sec. 5.2.1.7-5.2.1.8).
- Topology conventions:
  - Fins around an edge are ordered clockwise looking along the edge. Dummy fins guarantee at least 2 fins per edge.
  - A loop has its face on the left.
  - In a solid body every edge has exactly 2 fins of opposite sense, and the faces around a vertex are edgewise connected.

  DOCUMENTED (V35 sec. 4, 6).

### V35 vs 2006
V35 adds:
- MESH surfaces (PSM mesh with position and normal pools). Faces may carry facet geometry ("convergent modelling").
- Lattices and polylines. The 2006 edition already has an `SCH_polyline` enum but no mesh or lattice nodes.
- The intersection-curve evaluation definition and the /C_i normalisation. The 2006 text is incomplete here.

DOCUMENTED (both PDFs).

## Robustness and guarantees

- The representation is **exact by definition**: the curve is the true intersection locus. The chart is only a seed plus *estimated* (nullable) error fields. There is no fitted spline error to propagate into later Booleans. DOCUMENTED (V35 p. 45, 47).
- Singularities (tangent points, cone apices, self-intersections of the locus) are pushed to curve ends as terminators, with a dedicated one-surface-plus-two-planes evaluator. This is Parasolid's answer to the Newton breakdown where the two normals become parallel. DOCUMENTED (V35 pp. 46-48).
- The ratio of 1e-8 linear resolution to the 1 km box is 1e-11 relative. That is Parasolid's global accuracy contract, in double precision. INFERRED from p. 26.
- No guarantees are stated about how the chart is produced (the marcher, the branch-finding, the completeness of the SSI). The format only defines what a valid result looks like. INFERRED.

## Parallelism and performance

- Not addressed by the document. Structurally, chart evaluation is local: each t needs one chord lookup plus a 3x3 Newton solve, and parameters of different points are independent, so evaluation is embarrassingly parallel. INFERRED.
- Storage cost is O(chart_count) hvecs per curve plus optional uv cache. No spline fitting is ever done. INFERRED.

## Known failures, limitations, war stories

- The chart density needed to keep `chordal_error` small grows near high curvature. The format does not say how Parasolid chooses it. INFERRED.
- Any downstream consumer (STEP/IGES export, meshing, other kernels) must re-implement the evaluator or approximate the curve by a B-spline. STEP has no equivalent of this chart-plus-surfaces definition (only `intersection_curve` with an associated geometry curve), so exporters convert. INFERRED.
- Wording drift between editions: the 2006 "tangent-line projection" and the V35 "chord projection" disagree, and the 2006 text lacks the normalisation. A port based on the older mirror would be subtly wrong (C0 instead of C1 parameter speed). DOCUMENTED (both PDFs).
- The only open-source analogue has the same interior evaluator but none of the extras. Truck's `IntersectionCurve<PolylineCurve,S0,S1>` evaluates `double_projection` with plane normal = `leader.der(t)`. For a `PolylineCurve` that is the unnormalised chord P_{n+1} − P_n, with t equal to the integer vertex index plus a fraction (`truck-polymesh/src/polyline_curve.rs` L218-243). That makes it exactly the XT chord-plane evaluator, **but**:
  - with an index parameterisation (neither arc-length nor C1)
  - with no uv cache: `search_triple` passes `None` hints, so every evaluation re-runs `search_nearest_parameter` on both surfaces
  - with no terminators: at tangency the derivative matrix `invert().unwrap()` panics
  - outside the parameter range, `der` returns the zero vector, so the constraint plane degenerates

  DOCUMENTED (code at `ricosjp/truck@8d03d8f`; see `truck-ricosjp-truck-rust-b-rep-kernel-truck-shapeops-boolean.md`). XT's f_i factors, uv cache and terminator evaluator are exactly what Truck lacks.

## Relevance for wonky

- wonky's current curved Boolean is blocked on a plane/cylinder union. The curve types involved:
  - Plane/cylinder gives only lines, circles and ellipses, which are analytic and already supported by `plane_cylinder`.
  - Cylinder/cylinder and cone pairs give conics in the special configurations of Miller-Goldman Table 4, and quartic space curves (not analytic) otherwise.

  The INTERSECTION-chart model is a clean way to represent the quartics **without inventing a spline fitter**. Store (surface A, surface B, chart of exact points, terminators) and evaluate any point by a local Newton solve. INFERRED.
- For **quadric/quadric** pairs there is a cheaper exact alternative to the chart. Miller 1987 writes every natural-quadric QSIC as a(t)s² + b(t)s + c(t) = 0 on one of the two input surfaces, which is a ruled surface. Each point is then one quadratic solve, and critical t values are found geometrically (see `miller-goldman-1995-geometric-algorithms-for-detecting-and-c.md`). Recommended split: closed-form branches for plane/cylinder/cone/sphere pairs; the XT chart + chord-plane Newton only for pairs involving tori, blends or B-splines. Both can share one `IntersectionCurve` interface (evaluate(t), tangent(t), uv(t), limits). INFERRED.
- For natural quadrics with **coplanar axes** there is an even simpler exact form. Put the axial plane at z = 0; both surfaces are then Qᵢ(x, y) + z² = 0, and the curve is the lift of the 2D conic Q1 − Q2 = 0 by z = ±√(−Q1). This follows from Shene-Johnstone Lemma 8.1 (see `shene-johnstone-1994-on-the-lower-degree-intersections-of-tw.md`). It covers the common FDM "tee" of two cylinders with intersecting axes and unequal radii. INFERRED.
- Bend fit (INFERRED):
  - A chart is an immutable array of F32x2 triples, which fits affine arrays.
  - Evaluation is a fixed-size 3x3 Newton in F32x2 with a bounded iteration count, which fits uniform-work GPU lanes.
  - Chart generation (marching) is inherently sequential per branch, but branches and seeds are independent. That gives fork-join over branches.
- Precision (INFERRED): F32x2 gives ~48-bit mantissa, ~3.5e-15 relative. Parasolid's contract is 1e-11 relative (1e-8 in a 1 km box). So a wonky resolution of 1e-8 m in a ~1 m or 1 km box is attainable in F32x2 if the Newton residuals are computed in double-word. The F32 exponent range (~1e38) is not a constraint here.
- STEP export: wonky already writes pcurves. The XT tolerant-edge model (edge.curve null, per-fin SP-curves) is exactly the shape STEP pcurves take. For an INTERSECTION edge wonky would emit per-face pcurves plus a 3D B-spline within a stated tolerance. That tolerance must be explicit and checked, per wonky's rule. INFERRED.
- Terminators give wonky an explicit failure boundary. If a tangency point cannot be isolated into a terminator, the operation must fail explicitly instead of marching through it. INFERRED.

## Pointers worth porting or studying

1. The hvec/CHART/LIMIT data layout (p. 44-47) as wonky's `IntersectionCurve` value. Drop the transmitted-only-Pvec detail: wonky can keep u,v for both surfaces as the cache (`intersection_data` with uv_type both).
2. The C1 chart parameterisation, i.e. the f_i recurrence (p. 46). Cheap, closed-form, and makes `t` usable for trimming and pcurve fitting.
3. The chord-plane evaluator (p. 47) and the terminator evaluator (p. 47-48) as the two Newton systems wonky needs.
4. `chordal_error` and `angular_error`, which Parasolid stores as optional estimates, as **mandatory, certified** fields in wonky. They become wonky's explicit tolerance for the chart polyline and feed the certified print mesh directly. A certificate needs its own derivation, e.g. a bound on curve curvature between chart points. XT's values cannot be trusted as bounds.
5. The torus subtype rules and the half-cone convention (sec. 5.3), useful when wonky adds tori for fillets.
6. BLENDED_EDGE + BLEND_BOUND (pp. 60-62) as the data model for constant-radius fillets: the spine is itself an INTERSECTION of offset surfaces. This connects the missing fillet feature to the same curve machinery.
7. The tolerant-edge rules (edge.curve null, per-fin SP-curves within edge tolerance), as the target model if wonky ever adopts local tolerances (see the Jackson 1995 note).

### Porting sketch for Bend (INFERRED, added 2026-09-24)

Value layout, all immutable affine arrays of F32x2 words:
- `IntersectionCurve { s0: SurfaceRef, s1: SurfaceRef, chart: [ChartPt], t0: F32x2 (base_parameter), f0: F32x2 (base_scale), start: Limit, end: Limit, chord_bound: F32x2, angle_bound: F32x2 }`
- `ChartPt { p: Vec3x2, uv0: Vec2x2, uv1: Vec2x2, tan: Vec3x2, t: F32x2 }`. Store the full hvec, not just Pvec. The t and f_i values are derived once at construction by the recurrence and cached. Cost: about 14 double-words per point.
- `Limit = Help ChartPt | Terminator { singular: ChartPt, branch_index: U32, use_surface: U32 } | Artificial ChartPt`. Parasolid's `B` (blend spine boundary) waits until fillets exist.

Two evaluators, both fixed-size and GPU-uniform:
1. **Interior, chord-plane system.**
   - For wonky's analytic surfaces, solve in **xyz with implicit forms** (plane, cylinder, cone, sphere and torus all have cheap implicit F(x)):
     - F0(x) = 0
     - F1(x) = 0
     - dᵢ·(x − c(t)) = 0, with dᵢ the unit chord and c(t) the chord point.

     That is a 3x3 Newton with the Jacobian rows ∇F0, ∇F1, dᵢ. No uv is needed during iteration. Recover uv afterwards by closed-form inversion, as wonky's STEP pcurve writer already does.
   - For B-spline surfaces later, use the 4x4 (u0, v0, u1, v1) form of Truck's `double_projection`.
   - Seed from the chord point. Cap iterations (e.g. 8), and return the residual |F0| + |F1| with the point. If det(J) falls below a scaled bound, report `NearTangency`. That can only happen if the chart was built wrongly, since terminators are excluded from the interior.
2. **Terminator segment.**
   - Solve Fₖ(x) = 0 plus plane 1 (containing the branch→terminator chord and nₖ(terminator)) plus plane 2 (orthogonal to that chord at the chord point).
   - Again 3x3, and well conditioned because only one surface is used.

Construction invariants to check in `curved-validate`:
- chart t strictly increasing
- consecutive tangents within `angle_bound`
- every chart point with |F0|, |F1| ≤ resolution
- `chord_bound` certified, e.g. by bounding the curve's curvature on the segment: sagitta ≤ κ_max·C_i²/8
- terminators only at the ends, and each terminator's `branch_index` equal to the first or last chart index

Parallelism: evaluation at many t (tessellation, pcurve sampling, STEP B-spline fitting) is a uniform map over t. Chart construction is per-branch fork-join.

Precision: the Newton residual must be computed in double-word arithmetic. A ~48-bit mantissa gives a residual floor around 1e-14 relative, far below the 1e-8 m / 1 km contract.

## Verdict: adapt

Adopt the representation, not code (there is none). An INTERSECTION curve is two surfaces + an exact chart + terminator limits, evaluated with the V35 C1 parameterisation and the chord-plane Newton evaluator. wonky should make the chordal and angular error fields certified and mandatory, where XT has estimated, nullable ones.

It is the lowest-risk general way to represent non-analytic SSI curves exactly in F32x2 without a spline fitter. For natural-quadric pairs, prefer the closed-form Miller 1987 branches behind the same interface.

The chart marcher itself is not described and must come from elsewhere:
- the mesh-seeded chains of the hybrid, with the Yang 2025 refinement criteria
- Truck's `IntersectionCurve`
- OCCT
- the Yang 2023 topology-guaranteed SSI
