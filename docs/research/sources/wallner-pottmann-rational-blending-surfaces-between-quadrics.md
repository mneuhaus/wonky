# Wallner & Pottmann, "Rational blending surfaces between quadrics" (CAGD 14(5):407-419, 1997)

- Kind: paper. Open preprint (7 pp.): https://dmg.tuwien.ac.at/geom/ig/papers/pot078.pdf (local `tmp/research/pdf/wallner-pottmann-rational-blending-quadrics.pdf`, read in full). Journal version: https://doi.org/10.1016/S0167-8396(96)00037-4
- Authors: Johannes Wallner, Helmut Pottmann (Institut für Geometrie, TU Wien). 1997.
- Venue: DOCUMENTED (OpenAlex): *Computer Aided Geometric Design* 14(5):407-419, 1997. The brief's "probably CAGD 1997" is confirmed. 26 citations (OpenAlex, 2026-09-23).
- License: preprint freely downloadable, copyright with the authors or publisher. The mathematics (kinematic mappings, Hopf map) is classical and free to re-derive. No code.
- Status: historical. It builds on Dietz, Hoschek, Jüttler 1993/1995 (rational patches on quadrics) and Pottmann 1995 ("Studying NURBS curves and surfaces with classical geometry").

## What it is

- Abstract (DOCUMENTED): "Using tools from classical line geometry and the theory of kinematic mappings, it is possible to define an intrinsic control structure for NURBS curves and surfaces on the sphere, the cylinder and on any projectively equivalent quadratic surface. These methods are further used to construct exact C¹ blends between these surfaces, such that interactive design of trim lines and surface tension is possible. The lowest possible degree of a blend that can be achieved with this method is (4, 3)."
- It is a **free-form, designer-controlled exact blend**, not a rolling-ball fillet. The trim lines are inputs (designed NURBS curves on the quadrics), and "surface tension" is an extra design parameter. Covered surfaces: "oval" quadrics (projectively a sphere: sphere, ellipsoid, paraboloid, two-sheet hyperboloid) and "singular" quadrics with one singular point (cones, cylinders). Ruled quadrics would work analogously but are skipped (§5).

## How it works (DOCUMENTED unless marked)

### 1. Spherical kinematic mapping and a quadratic "lift" of the sphere
- Rotations are unit quaternions a (a and −a give the same rotation). σ maps SO(3) one-to-one onto projective 3-space P³ (elliptic space). One-parameter subgroups and their cosets map to straight lines (§1).
- Fix n ∈ S². The map δ: P³ → S², δ(Ra) = a n ā, is in homogeneous coordinates (eq. 1):
  - y_0 = x_0² + x_1² + x_2² + x_3²
  - y_1 = 2(x_0x_1 − x_2x_3)
  - y_2 = 2(x_1x_3 − x_0x_2)
  - y_3 = x_1² + x_2² − x_0² − x_3²

  Restricted to S³ this is the **Hopf map**. It equals an elliptic-net projection composed with inverse stereographic projection ("generalized stereographic projection"). Fibers (preimages of points) are lines of an elliptic net, pairwise skew.
- Dietz et al. 1993: **every rational curve or surface of degree ≤ 2m on the unit sphere is δ of polynomials of degree ≤ m**. So polynomial splines of degree m in P³ map to exactly the rational splines of degree 2m on the sphere.
- **Intrinsic control structure on the sphere** (§2, following Pottmann 1995):
  - The inputs are de Boor points d_i on S² plus "Farin points" f_i on S² (points that play the role of the weights).
  - Choose p_0 ∈ δ⁻¹(d_0). Then solve successively q_i = ½(p_i + p_{i+1}), δ(q_i) = f_i, δ(p_i) = d_i.
  - A C^k polynomial spline of degree n with control points p_i maps to a C^k rational spline of degree 2n on the sphere. It is independent of the choice of p_0, because the elliptic net has a one-parameter group of automorphic collineations.
  - Closed curves use periodic knots: p need not close in P³ even when the image closes.

### 2. Cylinder / cone version (Blaschke-Grünwald kinematic mapping)
- The planar Euclidean motion group maps into Q³ = P³ minus the line x_0 = x_3 = 0. The cylinder x_1² + x_2² = x_0² is the "unit sphere" of an isotropic metric.
- The quadratic projection onto the cylinder is (eq. 2):
  - y_0 = x_3² + x_0²
  - y_1 = x_3² − x_0²
  - y_2 = −2x_3x_0
  - y_3 = 2(x_3x_1 − x_2x_0)

  Its fibers form a **parabolic net** (line pencils, one per cylinder ruling).
- Caveat (§4): q_i = ½(p_i + p_{i+1}) is uniquely solvable only if the fibers of d_i, f_i, d_{i+1} are skew. If two of the three points lie on one ruling, the third must as well. This is because a segment maps to a planar conic section of the cylinder.
- Convex-hull and variation-diminishing properties hold with respect to conics through δ(l) (§4, Fig. 2).

### 3. The blend construction (§5, Figs. 3-4)
1. Design four NURBS curves by intrinsic control polygons (d_{ij}, c_{ij}), j = 1..4: two per quadric. The outer curve on each quadric is the **trim line**; the inner one sets tangent behaviour.
2. Lift them to control polygons p_{ij} in R⁴. Use {p_{i1}, p_{i2}} and {p_{i3}, p_{i4}} as control nets of (m,1) tensor-product polynomial **ruled** spline surfaces.
3. Apply δ (spherical δ for oval quadrics, cylindrical δ for singular ones). This yields a **(2m, 2) NURBS patch lying exactly on each quadric**. Compute its control points.
4. Take the "outermost two" control-point rows of each quadric patch (4 rows in total) as the control net of a **(2m, 3) NURBS transition surface**. A NURBS surface's boundary and first cross-derivative depend only on its first two control rows (with weights), so the transition surface is an **exact C¹ blend**. m = 2 gives the minimum degree **(4, 3)**. (The preprint writes "(2n, 3)"; with n = m.)
- Design freedom: the trim lines, and the choice of p_{0j}. The quadric patches do not depend on p_{0j}, but the transition surface does. The paper suggests choosing the trim line's distance to the intersection curve as a function of the surface angle for automation.
- **Closed trim lines** (§5, Props. 1-3):
  - A spherical or cylindrical polygon of conic segments defines a path in the motion group. The lifted polygon closes (R p_0 = R p_n) iff the **total turning angle** is 2kπ (sphere) or 0 (cylinder, using the isotropic angle = difference of slopes k = z/sqrt(x²+y²)).
  - Because S³ and Z³ doubly cover P³ and Q³, p_n = ±p_0. Two closed polygons can be lifted consistently after changing the turning number of at most one (homotopy argument, Prop. 2). The cylinder case needs the two polygons homotopic and free of line segments (Prop. 3).
  - Practical recipe: keep the c_i, and adjust the f_i to the group midpoints of p_i, p_{i+1} so the lifted polygon closes.

## Robustness and guarantees

- **Exactness:** the quadric-side patches lie exactly on the quadrics (algebraic identity via δ). The transition surface is exactly C¹ in the parametric sense, which implies G1, at both trim lines, provided knot vectors and parametrizations match along the trim.
- **Not guaranteed:** fairness, absence of self-intersection of the transition surface, and that the blend stays on the correct side. Nothing in the paper checks these. Shape is steered by the designer.
- The lifting step picks points in fibers (lines). The fibers are rational lines (δ is a linear projection followed by inverse stereographic projection), so with rational inputs the whole construction can stay in exact rationals (INFERRED from the composition statement). The cylindrical case has solvability conditions (skewness) that must be checked; they are exact incidence tests.

## Parallelism and performance

- No measurements (short theory paper).
- INFERRED:
  - Construction is a sequential chain along each control polygon, because q_i depends on p_i.
  - The δ-image control points are products of Bernstein polynomials: degree m → 2m multiplication, uniform arithmetic per coefficient.
  - Evaluating a (4,3) NURBS patch is uniform GPU work.

## Known failures, limitations, war stories

- DOCUMENTED:
  - closed intersections need the turning-angle condition, so a closed blend may need a modified turning number;
  - cylindrical lifting fails when two of d_i, f_i, d_{i+1} lie on one ruling;
  - ruled quadrics (hyperboloid of one sheet, hyperbolic paraboloid) are "possible" but not done.
- INFERRED:
  - no automatic trim-line placement, so the output is not determined by a single scalar like a fillet radius;
  - trim lines are general rational curves of degree 2m on the quadric, so the B-rep needs NURBS pcurves (curves-on-surface), not circles or ellipses;
  - degree (4,3) with weights: high for SSI in later Booleans.

## Relevance for wonky

- **Semantics mismatch:** FeatureScript `opFillet` means a rolling ball of radius R. Wallner-Pottmann blends are free-form C¹ transition surfaces with designer-chosen trims. Using them for opFillet would not reproduce Onshape geometry (INFERRED). The closest FeatureScript feature would be a face blend or a "conic/curvature" cross-section variant (see `onshape-help-fillet-and-face-blend.md`), and even those are rolling-ball based in Onshape.
- **Where it does fit:**
  1. **Exact NURBS-on-quadric representation.** The δ maps give an exact, polynomial way to represent any rational curve or patch on a sphere, cylinder or cone. That is directly useful for **STEP export of trimmed quadric faces as B-splines** when a consumer lacks analytic surfaces. It also makes **pcurves on quadrics** exact rational objects, with no fitting.
  2. **Exact G1 corner or transition patches** where wonky must bridge two quadric faces with a surface that has no rolling-ball meaning (a user-requested "loft between faces" with tangency).
- **Bend fit:** very good for the arithmetic, poor for the product.
  - δ is quadratic polynomial evaluation. Degree elevation and products of Bernstein coefficients are pure integer or rational arithmetic, which maps cleanly to **multi-limb U32 exact rationals**. No square roots appear if inputs are rational and fibers are taken rationally.
  - No iteration, no mutation. Per-polygon lifting is sequential but tiny.
- **Testing value:** because the quadric patches are exactly on the quadric, "control-point δ-image lies on the quadric" is an exact algebraic identity test. It is a good unit test for any exact-rational NURBS code in wonky.
- **Priority: low.** Do it only after rolling-ball fillets, and only if a tangent-transition feature or exact B-spline export of quadric faces is needed.

## Pointers worth porting or studying

- Eq. (1), the spherical δ (Hopf map in homogeneous form), and eq. (2), the cylindrical δ: 4 lines each.
- §2 lifting recipe (d_i, f_i → p_i, q_i); §5 steps 1-4 (the (2m,2) quadric patches and the (2m,3) transition from outer control rows).
- Props. 1-3: the closure conditions (total turning angle 2kπ on the sphere, 0 on the cylinder).
- Background: Dietz, Hoschek, Jüttler 1993 (CAGD 10:211-229), "An algebraic approach to curves and surfaces on the sphere and on other quadrics"; Dietz et al. 1995 (CAD 27:27-40), "Rational patches on quadric surfaces". These are the degree-2m theorem and the general quadric case.
- Krasauskas's later "universal rational parametrization" of the sphere via C² → S² (used in Dahl & Krasauskas 2012 as P_S(U_0,U_1)) is the complex-number form of the same δ. See `peternell-pottmann-computing-rational-parametrizations-of-ca.md`.

## Verdict: learn-from

The paper gives an exact, rational, polynomial-arithmetic way to put NURBS on quadrics and to build C¹ transition patches. That fits wonky's multi-limb exact arithmetic. The blends are designer-driven free-form surfaces, not rolling-ball fillets, and they need NURBS trims and a high-degree (4,3) surface. Keep the δ maps (spherical and cylindrical) for exact curves-on-quadrics and STEP B-spline export. Do not use it to implement opFillet.
