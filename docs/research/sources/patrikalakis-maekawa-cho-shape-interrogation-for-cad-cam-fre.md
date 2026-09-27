# Patrikalakis, Maekawa, Cho: *Shape Interrogation for Computer Aided Design and Manufacturing* (hyperbook edition). Ch. 11 Offsets, plus Ch. 4/5 robustness and SSI

- **Kind / URLs:** Textbook, free online HTML "hyperbook" (LaTeX2HTML).
  - Index: https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/
  - Ch. 11: https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node210.html
  - Nodes 210–240 (Ch. 11), 36–54 (Ch. 4) and 55–113 (Ch. 5) were read from the local mirror `tmp/research/hyperbook/`.
- **Authors / org / year:** N. M. Patrikalakis (MIT), T. Maekawa, W. Cho. Print edition Springer 2002; the hyperbook pages are stamped "December 2009". DOCUMENTED: index and page footers at https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/
- **License and porting:**
  - The text is copyrighted and freely readable. The math is free to re-derive.
  - The accompanying C/C++ "software package" is **non-commercial only**: "You may not use or distribute this Software or any derivative works in any form for commercial purposes". DOCUMENTED: https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/software.html
  - Consequence for wonky: read the math, do not transcribe the code.
- **Status / activity:** A static reference work. Last hyperbook update 2009, so literature after about 2008 is missing. DOCUMENTED: page footers.

## What it is

A graduate textbook on the geometry that CAD/CAM interrogation needs:
- polynomial solvers and robustness (Ch. 4)
- intersection problems of every dimension/type combination (Ch. 5)
- differential geometry, curvature lines, umbilics (Ch. 6–9)
- **offset curves and surfaces (Ch. 11)**: singularities, self-intersections, approximations, Pythagorean-hodograph curves, general (cutter) offsets, and pipe surfaces with their maximum non-self-intersecting radius

DOCUMENTED: https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node210.html

## How it works

Key content relevant to fillets, offsets and shells. Each item is DOCUMENTED at the URL given.

- **Definition and non-closure** (11.1.1):
  - Offset = locus at constant distance d along the normal.
  - Because of the square root in the unit normal, offsets are "functionally more complex than their progenitors". A NURBS progenitor usually has a non-NURBS offset, except for special cases: cyclides, PH curves/surfaces, simple solids.
  - Tangent-discontinuous progenitors (i.e. B-rep edges) give gaps on convex sides and self-intersections on concave sides.
  - https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node212.html
- **Rolling-ball offsets of solids** (11.1.4, tolerance region):
  - Farouki handled edges and vertices of simple solids using the rolling-ball offset definition.
  - The tolerance region of a patch is bounded by 10 surfaces: 2 normal offsets, 4 pipe surfaces along the edges, and 4 sphere patches at the corners.
  - https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node217.html
- **Curve offset singularities** (11.2.2–11.2.3):
  - Cusps occur where κ(t) = −1/d, i.e. local self-intersection when |d| exceeds the minimum concave radius of curvature.
  - Global self-intersection occurs at constrictions, where r(σ)+d n(σ) = r(t)+d n(t) for σ≠t.
  - https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node220.html
- **Curve offset approximation** (11.2.4):
  - Two-sided offsets of degree-n polynomial curves are implicit curves of degree 4n−2−2m.
  - Of the compared methods, least squares generally wins. Tiller–Hanson (offset the control-polygon legs, intersect them, check deviation, subdivide) wins for quadratics.
  - Local loops are detected by the sign of ω(t) = t(t)·t̂(t) (Elber–Cohen).
  - https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node222.html
- **Offset surface differential geometry** (11.3.1):
  - r̂ = r + dN.
  - N̂ = eN with e = sign((1+dκmax)(1+dκmin)).
  - Offset principal curvatures: κ̂ = eκ/(1+dκ).
  - The normal flips when offsetting past the concave curvature center.
  - https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node224.html
- **Offset surface singularities** (11.3.2):
  - Cuspidal edges lie along κmax or κmin = −1/d.
  - Self-intersections are pairs (σ,t)≠(u,v) with equal offset points.
  - Starting points are found robustly by an interval solver.
  - https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node225.html
- **Offsets of quadrics** (11.3.3):
  - "The offsets of the natural quadrics are also natural quadrics" (sphere, circular cylinder, circular cone).
  - Self-intersection curves of offsets of implicit quadrics are **planar conics** on the symmetry planes.
  - The cone apex has an undefined normal (|∇f| = 0).
  - https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node226.html
- **Self-intersection of offsets of parametric patches** (11.3.5):
  - Split the patch at iso-lines through concave curvature extrema and through collinear-normal point pairs closer than 2|d|. Then every self-intersection branch touches a sub-domain boundary, so boundary starting points suffice.
  - Replace the square roots S by auxiliary variables (η² = S²) to get a 5×5 polynomial system, solved with the Interval Projected Polyhedron (IPP) solver.
  - The trivial solution σ=u, t=v must be excluded, using normal bounding pyramids.
  - https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node228.html
- **Surface offset approximation** (11.3.7):
  - Farouki: bicubic Hermite with uniform subdivision.
  - Patrikalakis–Prakash: offset the control points along averaged facet normals, check deviation at knots and then at mid- and third-spans, insert knots where the check fails.
  - **Piegl–Tiller:** (1) *recognize special surfaces first* (plane, sphere, cylinder, cone, torus, revolution, ruled/extrusion), (2) sample using bounds on second derivatives, (3) interpolate, (4) remove knots within tolerance.
  - https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node230.html
- **General offsets** (11.5): cylindrical and toroidal cutter offsets are r + c·n + (d−c)·((e×n)×e)/|e×n|. https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node234.html
- **Pipe surfaces** (11.6), the geometric core of rolling-ball blends:
  - A pipe is the envelope of spheres of radius r along a spine and "construction of blending surfaces" is listed as an application.
  - **Local self-intersection iff r·κ(t) ≥ 1** anywhere on the spine; find κmax by solving κ̇ = 0.
  - **Global self-intersection** comes in three types: end-circle/end-circle, body/body and end-circle/body.
  - Body/body reduces to stationary points of |c(σ)−c(t)|², after factoring out (σ−t) to remove the trivial solution.
  - https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node236.html, node237.html, node240.html
  - **Equations**, added 2026-09-24 after reading node237–node242; nodes 241 and 242 were fetched and saved as `tmp/research/hyperbook/node24{1,2}.txt`. DOCUMENTED at the node given for each item.
    - **Parameterisation** (11.111): p(t,θ) = c(t) + r[cos θ n(t) + sin θ b(t)], using the Frenet frame (t, n, b) of the spine.
    - **Normal** (11.115): p_t × p_θ = −|ċ| r (1 − κ r cos θ)(sin θ b + cos θ n). The surface is singular exactly where 1 − κ(t) r cos θ = 0, so it is regular iff κ r < 1 everywhere. The maximum spine curvature κ_a comes from κ̇(t) = 0 plus the end values. node237.
    - **End circle to end circle** (11.116–11.121): the self-intersection point x solves a 3×3 *linear* system. Its rows are the two end normal planes (x − c(0))·ċ(0) = 0 and (x − c(1))·ċ(1) = 0, plus the bisector plane of c(0)c(1). The determinant is D = ċ(0)×ċ(1)·(c(1)−c(0)), and r_ee = |x − c(0)|. If D = 0 with no solution, r_ee = ∞. A closed spine with non-parallel end tangents gives r_ee = 0. node239.
    - **Body to body** (11.122–11.131): solve (c(σ)−c(t))·ċ(σ) = 0 and (c(σ)−c(t))·ċ(t) = 0 after dividing out (σ−t). For a rational Bézier spine of degree n this is a bivariate polynomial system of degree (3n−2, 2n−1) and (2n−1, 3n−2), solved with IPP. Then r_bb = √(min D(σ,t)) / 2. node240.
    - **End circle to body** (11.132–11.134): a univariate equation for the candidate, with the trivial root factored out. The touching radius r_eb is refined by a 4×4 Newton solve, seeded from the end-circle construction. For a planar spine the linear seed system is singular, so a different seed is used. node241.
    - **Theorem 11.6.1** (necessary and sufficient): the pipe p(r) is nonsingular iff r < R = min(1/κ_a, r_ee, r_bb, r_eb). Remark 11.6.1: for a planar spine the same R is the largest non-self-intersecting offset distance of the planar curve. Source: [256], Maekawa, Patrikalakis, Sakkalis, Yu, "Analysis and applications of pipe surfaces", CAGD 1998. node242.
- **Robustness chapter**:
  - FP geometry "will frequently fail". Rational arithmetic is robust but blows up in digits. Rounded interval arithmetic is the cheap, robust middle ground for *excluding* root-free regions.
  - Division can be avoided through 4D homogeneous processing (Yamaguchi).
  - https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node44.html and https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node45.html
- **SSI completeness** (5.8.2.3):
  - Marching alone is incomplete.
  - Starting points = border points + **collinear normal points** (4 polynomial equations). Collinear normal points lie inside every closed loop and at every singular point.
  - Split the patches there, and then border points suffice.
  - https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node109.html
- **Open problems** (5.11):
  - Non-zero-dimensional solution sets (overlaps, tangential contacts) defeat most methods, and interval methods are "not a panacea".
  - B-rep rectification is needed after inconsistent intersections.
  - Recent research moves to exact rational arithmetic.
  - https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node113.html

## Robustness and guarantees

- The book's position:
  - Interval arithmetic with rounded endpoints guarantees root *exclusion*.
  - IPP with interval Bernstein coefficients finds all roots in a box to a tolerance.
  - It cannot resolve non-isolated (1D or 2D) solution sets.
  - DOCUMENTED: https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node45.html, https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node113.html
- Offset and pipe validity conditions are exact and cheap for quadrics:
  - For a cylinder or cone, κ is constant along rulings, so the singularity test reduces to comparing d with the radius.
  - For a torus, κmax is attained on the inner equator.
  - DOCUMENTED (conditions): node224, node237. INFERRED (specialisation to wonky's surfaces).

## Parallelism and performance

- There is no discussion of parallel implementation. DOCUMENTED by absence in the Ch. 4 and 11 nodes read.
- Subdivision-based solvers (IPP, Bernstein subdivision) and "sample all candidates, keep failing boxes" are data-parallel by construction. The book's methods are well suited to fork-join or GPU work lists. INFERRED.

## Known failures, limitations, war stories

- Fig. 11.10 (parabola, d = −0.8): an untrimmed offset gouges, a trimmed one undercuts. This is the canonical failure of naive shelling and filleting in concave regions. DOCUMENTED: https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node220.html
- Closed self-intersection loops in both parameter domains are "more difficult": marching needs pre-subdivision at curvature extrema and collinear normal points, or loops are silently missed. DOCUMENTED: https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node228.html, node109.html
- Tiny FP drift (a 4-digit decimal example) turns a tangential contact into a miss. This is exactly the tangential-contact case a fillet produces at its trimlines. DOCUMENTED: https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node44.html

## Relevance for wonky

- **Shell/offset of wonky's current surfaces can be exact.** INFERRED from 11.3.3 (node226):
  - plane → plane
  - cylinder of radius R → coaxial cylinder of radius R ± d
  - cone → cone with the same half-angle, apex shifted along the axis
  - torus (from fillets) → torus with minor radius ± d
  - Exception: *degeneracy* when d reaches the concave radius (cylinder collapses to its axis, torus minor radius → 0, cone apex region). Those must be detected exactly and fail explicitly, or remove the face.
  - No approximation is needed for shell/thicken on wonky's surface set.
- **Rolling-ball fillet between quadrics = pipe/canal surface along the offset-offset intersection spine.**
  - For plane/plane the spine is a line and the fillet is a cylinder.
  - For plane/cylinder (axis ⟂ plane) and for coaxial cases the spine is a circle and the fillet is a torus.
  - Validity conditions: r·κspine < 1 (local) and spine self-distance > 2r (global).
  - INFERRED from node236/237 plus the pipe definition.
  - A third condition sits on the *supports*, not the spine: each support's offset by r toward the ball must be regular over the contact region, i.e. (1 + r·κmax)(1 + r·κmin) > 0 with the book's sign convention (κcrit = −1/d, eqs. 11.18–11.25, node224). When it fails, the offset has a cuspidal edge, the spring curve loops and the blend self-intersects.
    - ACIS documents exactly this as its "Geometric Limitation on the Blend Radius": when the support is convex and has a curvature radius below the blend radius, the spring curve forms a loop and ACIS reports a blend failure. DOCUMENTED: http://www.q-solid.com/ACIS_Docs_R17/online/SPAacisuserTechArticles/SPAacisuser_moblndbg.htm (see the ACIS blending note).
    - Kós–Martin–Várady define the spine the same way, as the intersection of the two offset surfaces (see that note).
    - For wonky's quadric supports the test is a scalar comparison: a cylinder or cone radius against r, and the torus inner-equator radius against r. INFERRED.
- **Shell with convex edges:** a true rolling-ball outward offset needs cylinders at convex edges and spheres at vertices (node217). Onshape/Parasolid-style shells instead extend and intersect the neighbouring offset faces. Wonky must pick one semantics and document it. For FDM enclosures the "extend-intersect" (sharp) variant matches user expectations. INFERRED.
- **Robustness mapping to Bend:**
  - The rounded-interval-arithmetic chapter (4.8) is directly applicable to F32x2 with outward rounding: interval exclusion in double-word, with the exact multi-limb predicate for the final sign.
  - Collinear-normal-point pre-splitting is a principled completeness guard for the analytic-recovery stage of the hybrid Boolean.
  - INFERRED.
- **Special surfaces first:** Piegl–Tiller's "recognize special surfaces first, approximate only the rest" is exactly wonky's intended policy. Keep it as the documented rule. DOCUMENTED principle: node230. INFERRED applicability.

## Pointers worth porting or studying

- The node226 quadric-offset formulas (11.30–11.35) and the symmetric-plane argument for self-intersection conics.
- node224: offset curvature relations (11.24–11.27), which give the curvature of shelled or filleted faces for free.
- node237/node240: pipe validity (r·κ < 1, and the stationary-distance system with the (σ−t) factor removed). This is a clean template for "does this fillet radius fit?"
- node239–node242: the end-end linear 3×3 system, the end-body Newton seed and Theorem 11.6.1 (R = min of four radii). INFERRED fit for wonky:
  - For its closed-form spines (lines and circles from plane/plane, plane/cylinder and coaxial pairs), κ is constant (0 or 1/ρ) and r_bb is trivial: ∞ for a line, and ρ for a full circle of radius ρ (antipodal points, 2ρ/2), which equals 1/κ. So "does the pipe self-intersect" collapses to scalar comparisons.
  - The end-end system is a tiny uniform linear solve. It needs a sign test on D, which is an exact-predicate candidate.
  - It is useful for chained fillets whose spine ends come close, e.g. a fillet around a short slot.
  - Note that the pipe being nonsingular is necessary but not sufficient for a valid *trimmed* fillet. The contact curves must also stay inside their support faces (see the ACIS capping and overflow material).
- node228: the auxiliary-variable trick to make square-root systems polynomial, and trivial-solution exclusion.
- node109: collinear normal points for loop detection in SSI.
- node45–node51: rounded interval arithmetic implementation details (ulp extraction, hardware vs software rounding).

## Verdict: learn-from

This is a reference for the math and for validity and singularity conditions. There is no code to port: the book's software is non-commercial and is C/C++ anyway. Most directly useful:
- exact quadric offsets for shell/thicken
- pipe radius-validity tests for fillets
- the collinear-normal completeness idea for SSI
