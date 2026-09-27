# ISO 10303-42: `parabola`, `surface_of_linear_extrusion`, B-spline forms (and what Onshape actually writes)

- Kind: standard (EXPRESS schema with normative text). Canonical: ISO 10303-42 (2021 edition text as published in the STEP Tools SMRL mirror: [geometric_and_topological_representation 4_schema.htm](https://steptools.com/stds/smrl/data/resource_docs/geometric_and_topological_representation/sys/4_schema.htm); local `tmp/research/sktext/iso42-schema.htm`, text dump `iso42.txt`); [STEP Tools AIM reference: PARABOLA](https://www.steptools.com/stds/stp_aim/html/t_parabola.html). Evidence of practice: Onshape export `~/Workspace/cad/cad-project-014/native-step-r10/CORNER_POST_AND_JOINER_R10.step`.
- Organization: ISO TC 184/SC 4.
- License: ISO standard (paid); the SMRL mirror is publicly readable. Implementing entities is free.
- Status: current; AP214/AP242 use these resources.

## What it is

The STEP entities available to export text walls exactly.

## How it works (DOCUMENTED, ISO 10303-42 §4.5.29, §4.5.67, §4.4.3)

- **parabola** (subtype of `conic`): `position: axis2_placement`, `focal_dist: length_measure`, `WR1: focal_dist <> 0`. "λ(u) = C + F(u² x + 2u y)", −∞ < u < ∞; implicit in the placement frame 4Fx − y² = 0; C is the apex, x the axis.
- **surface_of_linear_extrusion** (subtype of `swept_surface`): σ(u,v) = λ(u) + vV with V = `extrusion_axis` (a `vector`; its magnitude sets the v parametrization); "The surface shall not self-intersect."
- **b_spline_curve_form / b_spline_surface_form:** informational enumerations including `parabolic_arc` ("an arc of finite length of a parabola represented by a B-spline curve") and surface forms `quadric_surf`, `surf_of_linear_extrusion`, `ruled_surf`.
- A trimmed quadratic Bezier is exactly a non-rational degree-2 `b_spline_curve_with_knots` with knots (0,1), multiplicities (3,3).

**What Onshape writes (DOCUMENTED, census of the export):** text edges as single Bezier spans, verbatim `#312=B_SPLINE_CURVE_WITH_KNOTS('',2,(#13381,#13382,#13383),.UNSPECIFIED.,.F.,.F.,(3,3),(0.,1.),.PIECEWISE_BEZIER_KNOTS.)` (form `.UNSPECIFIED.`, not `.PARABOLIC_ARC.`); walls as `B_SPLINE_SURFACE_WITH_KNOTS('',3,1,(4×2 poles),.SURF_OF_LINEAR_EXTRUSION.,...)` (degree-elevated in u); arcs substituted for near-circular segments as `CIRCLE` + `CYLINDRICAL_SURFACE`. No `PARABOLA`, no `SURFACE_OF_LINEAR_EXTRUSION` entity is used.

## Robustness and guarantees

The parabola entity needs an apex, a unit axis and F. From control points p0, p1, p2 with a = p0 − 2p1 + p2 and b = 2(p1 − p0): axis x = a/|a|, F = |b⊥|²/(4|a|) = cross(p1 − p0, p2 − p1)² / |a|³ (derivation: match t²a + t b to F(u²x + 2u y) with u affine in t; INFERRED, checked by hand). |a|³ needs a square root, so the focal form of a lattice-exact segment is irrational; trimming parameters on the conic are also irrational. The B-spline form keeps the exact lattice control points.

## Parallelism and performance

Irrelevant.

## Known failures, limitations, war stories

Many importers treat `PARABOLA` poorly or convert it; B-spline curves are universally supported (HEARSAY, general CAx-IF experience; Onshape's own choice of B-splines is DOCUMENTED above). Degree-elevating walls to (3,1) as Onshape does is unnecessary for validity; (2,1) is legal.

## Relevance for wonky

Export text as Onshape does, exactly: edges = degree-2 single-span B-splines with the lattice control points scaled to mm, walls = `B_SPLINE_SURFACE_WITH_KNOTS` degree (2,1) with 3×2 poles and form `.SURF_OF_LINEAR_EXTRUSION.` (or, equivalently, `SURFACE_OF_LINEAR_EXTRUSION` over the degree-2 B-spline curve), pcurves on the floor/top planes = the same 2D Bezier, pcurves on the wall = straight lines u = const or v = const. wonky's STEP writer already emits pcurves for planes/cylinders/cones; adding one curve type and one surface type covers text. Validate with the existing OCCT-as-reader test oracle (OCCT maps these to `Geom_BSplineCurve` / `Geom_SurfaceOfLinearExtrusion` or `Geom_BSplineSurface`).

## Pointers worth porting or studying

ISO 10303-42 §4.5.29 parabola (eq. and WR1), §4.5.67 surface_of_linear_extrusion, §4.4.3 b_spline_surface_form, `b_spline_curve_with_knots` / `b_spline_surface_with_knots` entity definitions; Onshape's export as a concrete byte-level template.

## Verdict: adopt (B-spline form for export; do not use focal-form PARABOLA as the internal carrier)
