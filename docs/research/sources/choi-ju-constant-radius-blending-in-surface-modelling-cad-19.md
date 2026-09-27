# Choi & Ju, "Constant-radius blending in surface modelling" (Computer-Aided Design 21(4):213-220, 1989)

- Kind: journal paper (paywalled). Canonical URL: https://www.sciencedirect.com/science/article/abs/pii/0010448589900468 , DOI https://doi.org/10.1016/0010-4485(89)90046-8
- Other URLs: bibliographic records at https://api.openalex.org/works/https://doi.org/10.1016/0010-4485(89)90046-8 and https://api.crossref.org/works/10.1016/0010-4485(89)90046-8 (the reference list). Book successor: B. K. Choi, *Surface Modeling for CAD/CAM*, Elsevier 1991, which has a chapter on blending surfaces (https://books.google.com/books/about/Surface_modeling_for_CAD_CAM.html?id=bvBTAAAAMAAJ).
- Authors: Byoung K. Choi and S. Y. Ju (KAIST, Korea). 1989.
- License: Elsevier copyright. The method is textbook geometry (offset surfaces, SSI, a rational quadratic circle arc, a transfinite corner patch), so it can be re-derived freely. Nothing here is code.
- Status: historical. OpenAlex lists 68 citations, Semantic Scholar 76 (checked 2026-09-23). OpenAlex reports `oa_status: closed` with no repository copy.
- **Access note (read this first):** the full text could not be obtained. ScienceDirect, ACM DL and the Internet Archive scholar index returned 403 or nothing, and no author copy exists. This note therefore rests on (a) the bibliographic record and the Crossref reference list (DOCUMENTED), (b) summaries of the paper by later primary papers (DOCUMENTED as secondary), and (c) a reconstruction of the method from open primary sources that describe the same construction (INFERRED, flagged per item). Every formula below comes from those open sources, not from the paper itself.

## What it is

- DOCUMENTED (secondary; You et al. 2024, *Mathematics* 12:3096, open PDF https://eprints.bournemouth.ac.uk/40506/1/mathematics-12-03096.pdf , local `tmp/research/pdf/you2024-analytical-c2-blending.pdf`, p. 2): "Choi and Ju mathematically constructed rolling-ball blends through sweeping rational quadratic curves and representing corner blends where three surfaces meet with a convex combination of linear Taylor interpolants."
- DOCUMENTED (secondary, abstract paraphrase in search indexes of the ScienceDirect page): any rectangular parametric surface patches can be blended as long as their offset surfaces are smooth.
- So the paper has two parts:
  1. **Edge blend.** A constant-radius rolling-ball blend between two parametric patches. The blend is a sweep of a rational quadratic (conic) arc, namely the exact circular cross-section, between the two contact curves.
  2. **Vertex blend.** The corner where three edge blends meet, filled with a transfinite patch built as a convex combination of linear Taylor interpolants of the three boundaries.
- DOCUMENTED (Crossref reference list, 12 entries): Rossignac & Requicha 1984 "Constant-radius blending in solid modelling"; Chiyokura 1987 (extended rounding); Holmström 1987 and Hoffmann & Hopcroft 1987 (implicit blends); Rockwood 1987; Barnhill 1987 (surface/surface intersection); Lee 1987 "The rational Bézier representation for conics"; Gregory 1983 "C1 rectangular and non-rectangular surface patches"; Farouki 1986 "The approximation of non-degenerate offset surfaces"; Faux & Pratt 1980; Choi & Lee "Surface modeling by sweep transformation". The references match the three building blocks: offset surfaces (Farouki), their intersection (Barnhill), conic arcs in rational Bézier form (Lee), and Gregory-type corner patches (Gregory).

## How it works (reconstruction; INFERRED unless marked)

This is the construction in the form a porter needs. It is the standard rolling-ball recipe the references point to. The same structure appears in Parasolid's `BLENDED_EDGE` surface (spine C(u) plus a circular cross-section, see `parasolid-xt-format-reference-v35-intersection-curve-chart-t.md`) and in OCCT's `BlendFunc_ConstRad` (see `occt-modeling-algorithms-guide-and-tkfillet-chfi3d-fillets-c.md`).

1. **Oriented offsets.** For base surfaces S_i(u,v) with unit normals n_i oriented toward the blend side: O_i(u,v) = S_i(u,v) + R·n_i(u,v). Precondition (DOCUMENTED secondary): the offsets must be smooth. So R must stay below the smallest concave principal radius of curvature of each S_i over the relevant region, otherwise O_i has cusps or self-intersections (offset theory: κ̂ = κ/(1+Rκ) blows up at Rκ = −1; see `patrikalakis-maekawa-cho-shape-interrogation-for-cad-cam-fre.md`, 11.3.1-11.3.2).
2. **Spine = SSI of the offsets.** c(t) = O_1(u_1(t),v_1(t)) = O_2(u_2(t),v_2(t)): 3 equations in 4 unknowns per point, plus a step or section constraint. Traced with a marching SSI (Barnhill-style: predictor along the tangent n_1 × n_2 of the offsets, Newton corrector). DOCUMENTED confirmation that the spine is exactly this intersection: Kós, Martin, Várady 2000, CAGD 17:127-160, §3.2 Fig. 6 "The spine as the intersection of offset surfaces" (open copy `tmp/research/pdf/kos-martin-varady-2000-blend-radius.pdf`); Dahl & Krasauskas 2012, Remark 2.1 (open copy in Dahl's thesis, `tmp/research/pdf/dahl-2014-thesis-improved-blends.pdf`, p. 23).
3. **Contact (trim) curves.** P_i(t) = S_i(u_i(t),v_i(t)) = c(t) − R·n_i. They come for free from the SSI parameters, so the trim curves are exact preimages on the base surfaces (pcurves), up to the SSI tolerance.
4. **Cross-section as a rational quadratic arc** (the "conic section sweep"). With a = (P_1 − c)/R, b = (P_2 − c)/R and cos θ = a·b (θ in (0, π) is the arc angle, equal to π minus the dihedral opening):
   - end control points P_1 and P_2; apex control point T = c + R·(a + b)/(1 + a·b), the intersection of the two contact tangents in the section plane, at distance R/cos(θ/2) from c;
   - weights (1, w, 1) with w = cos(θ/2) = sqrt((1 + a·b)/2);
   - B(t,s) = [(1−s)²P_1 + 2s(1−s)·w·T + s²P_2] / [(1−s)² + 2s(1−s)·w + s²].

   This is the standard exact circle arc in rational Bézier form (Lee 1987, cited by the paper). Sweeping it along t gives a surface whose t-rows are P_1(t), T(t), P_2(t) with weight row w(t). If the three rows and the weight are fitted as B-splines in t, the result is a NURBS surface of degree 2 across the blend. It is exact across the section and approximate along the spine unless the spine is rational (see `peternell-pottmann-computing-rational-parametrizations-of-ca.md`).
5. **Generalization to conic ("rho") cross-sections.** Keep P_1, T, P_2 and replace w by w_ρ = ρ/(1−ρ). ρ = 0.5 gives a parabola; ρ = cos(θ/2)/(1+cos(θ/2)) gives the circle. This is the classic rho-conic. INFERRED link: it is what Onshape's `FilletCrossSection.CONIC` with a rho value needs (see `onshape-help-fillet-and-face-blend.md`), so one sweep engine serves both round and conic fillets. Chamfers are the limit where the section is the straight line P_1P_2.
6. **Vertex blend.** Three edge blends end at a corner with boundary curves C_k(s) and cross-boundary derivatives D_k(s), known from the blend surfaces. A linear Taylor interpolant per side is L_k(p) = C_k(s_k(p)) + d_k(p)·D_k(s_k(p)), where s_k and d_k are the foot parameter and distance of the domain point p relative to side k. The patch is Σ_k W_k(p)·L_k(p), with convex weights that are 1 on side k and 0 on the other sides, e.g. W_k = Π_{j≠k} d_j² / Σ_m Π_{j≠m} d_j² (Gregory / Charrot-Gregory form). DOCUMENTED only as "convex combination of linear Taylor interpolants" (secondary). The exact domain mapping and weight exponents used by Choi & Ju are unverified. The result is G1 to the three edge blends only approximately: exactly at the boundaries in position and cross-derivative if the interpolants are consistent at the corners, which Gregory patches address with their rational twist terms.

## Robustness and guarantees

- DOCUMENTED (secondary): the method applies when the offsets are smooth. It does not address offset self-intersection, radius larger than the concavity, or faces that end before the ball does ("overflow"). Those are exactly the failure classes modern kernels spend most of their fillet code on (see the OCCT and Parasolid notes).
- Across the section, the arc is exact: every point is at distance R from c(t), and at the contact points the tangent planes coincide with the base surfaces (G1) by construction. That holds wherever c(t), P_i(t) are accurate.
- Along the spine, accuracy is limited by the SSI tolerance and by the fit of the t-direction. There are no certified bounds in this era's methods (INFERRED from the reference list; no interval or error-bound citation).
- The corner patch is heuristic: G1 at the boundaries depends on the compatibility of the corner data. There is no guarantee of fairness or of non-self-intersection.

## Parallelism and performance

- No numbers are available (full text not read).
- INFERRED structure: the per-sample work (Newton on offsets, closed-form contact points, closed-form T and w) is uniform. Only the marching SSI is sequential. For natural-quadric pairs the marching disappears: every spine sample has a closed form. Plane/plane, plane/sphere, plane/cylinder and plane/cone spines are conics, DOCUMENTED in Kós et al. 2000 §3.2.5: "the spine for a given R is always a conic curve, which can be computed explicitly". For quadric/quadric pairs, Miller-style ruled-surface parametrization gives one quadratic solve per sample (see `miller-goldman-1995-geometric-algorithms-for-detecting-and-c.md`).

## Known failures, limitations, war stories

- No issue tracker (paper). The limits visible from the abstract: offsets must be smooth, rectangular parametric patches only, and a constant radius.
- The general failure modes of this construction in practice are documented elsewhere and apply unchanged:
  - Self-intersecting blends when R exceeds the local concave curvature radius of the spine. Pipe-surface condition: no local self-intersection iff R < 1/κ_spine for all t (Dahl 2014, Thm 3.26, thesis p. 62; hyperbook 11.6.2).
  - Contact curves leaving the face (overflow): Parasolid overflow types, Onshape "detached" face blends.
  - Panics when no contact circle exists: monstertruck `rolling_ball_fillet` `unwrap()`s (see `monstertruck-truck-fork-monstertruck-fillet-crate.md`).
  - Walking failures and twisted surfaces: OCCT `ChFiDS_WalkingFailure`, `ChFiDS_TwistedSurface`.

## Relevance for wonky

- **Where it plugs in: the fillet tier between wonky's closed-form tier and a general marching engine.** wonky's current surfaces are Plane, Cylinder and Cone, with Line, Circle and Ellipse curves (INFERRED from constructor counts in `kernel/*.bend`). The Choi & Ju recipe is the uniform data model for every rolling-ball fillet:
  - spine = offset intersection (reuses the SSI machinery the Boolean needs);
  - contacts = spine minus R·n;
  - section = rational quadratic arc.

  Plane/plane gives a cylinder and coaxial plane/cylinder gives a torus: the special cases collapse to exact elementary surfaces, as OCCT's `ChFiKPart` does.
- **Concrete FDM case this unlocks.** Oblique plane/cylinder edges: a boss or hole meeting a sloped face, or a pipe through an inclined wall.
  - The offset plane cut with the offset cylinder is an ellipse, so the spine is an ellipse.
  - The contact curve on the plane is that ellipse translated by −R·n_plane. DOCUMENTED: Dahl & Krasauskas eq. 2.10.
  - The contact curve on the cylinder is also a planar ellipse. INFERRED derivation: spine points (ρ' cos θ, ρ' sin θ, z(θ)) with z affine in (cos θ, sin θ); radial projection to radius ρ keeps z, so the points satisfy an affine plane equation.
  - Both trim curves are therefore types wonky already has. Only the blend surface needs a new type: a "pipe around an ellipse", exact rational bidegree (4,2) (see the Peternell-Pottmann note).
- **Bend fit.**
  - Per-sample math is uniform and branch-light: closed-form spine samples for quadric pairs, contact points by subtraction, T by one division, w by one square root. It maps to a GPU call tree over spine samples or to fork-join halving of the t-interval.
  - F32x2 (~48-bit mantissa) is enough: fillet radii are 0.2-20 mm, part sizes up to about 300 mm, and Newton or closed forms need about 1e-9 relative accuracy. Square root and division must be the F32x2 double-word versions.
  - The one sequential part, SSI marching for non-quadric faces, is replaceable by "sample at fixed t, solve locally, verify chord deviation, subdivide" as a fork-join recursion. It is not a hard blocker.
  - No mutation is needed.
- **Exactness caveat.** w = cos(θ/2) and the SSI roots are irrational in general, so the NURBS rows are not exactly rational even for rational inputs. Keep a procedural definition (spine + R + two supporting faces, as Parasolid's BLENDED_EDGE does) as the source of truth. Treat the NURBS as an export or display artifact with an explicit tolerance.
- **Testing oracle.** Every blend point must satisfy dist(x, S_1) = dist(x, S_2) = R at its ball center, and the normals must match at the contacts. This is a cheap per-sample check that can certify any fillet implementation, including a future marching one.
- **LLM ergonomics.** The decomposition (offset → spine → contacts → section) gives natural, queryable intermediate objects (spine curve, contact edges, section at t). A code-writing LLM can inspect them when a fillet fails ("spine has 2 branches", "R ≥ concave radius at t=0.37").

## Pointers worth porting or studying

- The rational quadratic circle arc: T = c + R(a+b)/(1+a·b), w = sqrt((1+a·b)/2) (Lee 1987; any NURBS text). Implement once, use it for fillet sections, conic (rho) sections and exact circle export.
- Kós, Martin, Várady 2000 §3.2 (spine as offset intersection, explicit conic spines for plane/quadric pairs, per-point Newton with 1e-6 relative stopping): `tmp/research/pdf/kos-martin-varady-2000-blend-radius.pdf`.
- Dahl & Krasauskas 2012 (exact rational forms of the same blends for quadric pairs): see the Peternell-Pottmann note.
- OCCT `BlendFunc_ConstRad.cxx` residual system (4 unknowns per section) for the non-quadric case: see the OCCT note.
- If the full text becomes available (library access), verify the corner-patch weights and the t-direction fitting scheme.

## Verdict: learn-from

The structure (offset SSI spine, exact rational quadratic cross-section sweep, transfinite corner) is the right mental model for wonky's fillet data model and matches Parasolid and OCCT. There is nothing to port verbatim: the paper is inaccessible, and its corner patch and along-spine fitting are pre-robustness-era heuristics. Adopt the arc formula and the decomposition. Get exactness for quadric pairs from Dahl & Krasauskas and Peternell & Pottmann rather than from spine fitting.
