# Patrikalakis, Maekawa, Cho: "Shape Interrogation for Computer Aided Design and Manufacturing" (MIT hyperbook)

- Kind: textbook, free HTML "hyperbook" edition. Canonical URL: https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/ (TOC: .../node2.html). Every page uses a JS XOR-2 scrambler (`hp_d01`) for links and equation images. I decoded it with perl into `tmp/research/hyperbook/node*.txt`.
- Other URLs: the print edition is Springer-Verlag, Berlin 2002. HEARSAY: this is the standard citation. The hyperbook pages I decoded do not print the ISBN or publisher line. The accompanying C/C++ software package is described at https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/software.html.
- Authors/organization, year: Nicholas M. Patrikalakis (MIT Ocean Engineering, Design Laboratory), Takashi Maekawa (Yokohama National Univ.), Wonjoon Cho (MIT). Book 2002, hyperbook pages dated December 2009. DOCUMENTED (page footers).
- License:
  - Text: copyrighted book, free to read online.
  - Code: the software package uses a non-commercial license adapted from the Microsoft Research Shared Source license (software.html). No commercial use. Derivatives must carry the same terms. DOCUMENTED.
  - Porting implication: re-derive algorithms from the equations (math is not copyrightable). Do not transcribe the C/C++ release. Wonky is private and unlicensed, but may be used commercially later, so the package is poison. INFERRED.
- Status: finished reference work, no activity. It is the standard citation for IPP (Interval Projected Polyhedron) and SSI (surface-surface intersection) classification, with 400+ references in the bibliography (node245). DOCUMENTED.

## What it is

The book frames shape interrogation (intersection, distance, extrema, umbilics, offsets) as solving systems of nonlinear polynomial equations in a box. It gives one robust solver for all of these: the Projected Polyhedron (PP) algorithm and its rounded-interval version (IPP).

- Ch. 4 (node35-54): the solver and robustness.
- Ch. 5 (node55-113): intersection problems classified by dimension and representation.
- Ch. 6 (node114-131): differential geometry of intersection curves, including tangential intersections.
- Ch. 11 (node210-235): offsets, including self-intersection of offset surfaces and pipe surfaces.

The book is heavy on math with exact equations and numbered tables. It is the best single source for "what can go wrong in SSI and why".

## How it works

### PP solver (4.4, node42), DOCUMENTED
- Input: n polynomial equations in l variables, each written in multivariate Bernstein form over the unit box, with degree m per variable.
- Graph trick: for each variable x_k, pair each Bernstein coefficient with its Greville abscissa i/m to get control points of the graph. Project them onto the (x_k, f) plane and take the 2D convex hull. By the convex hull property, the hull's intersection with the f=0 axis bounds all roots in x_k.
- Intersect these intervals across all n equations and shrink the box. De Casteljau subdivision re-expresses the Bernstein coefficients on the new box.
- If a step "does not reduce much", split the box in half with de Casteljau ("binary subdivision"). This happens when several roots share the box. The book leaves the threshold to the implementation.
- Stop when the box is smaller than the tolerance epsilon, then report it as a root box. Newton polishing is optional.
- Each subbox is re-parametrized to [0,1]^l "to capitalize on the higher density of floating point numbers in this range".
- Bernstein subdivision is numerically stable, but conversion from the power basis to Bernstein is ill-conditioned. The book says: formulate in Bernstein from the start, or convert in exact arithmetic (node42).
- Cost per step O(n l m^{l+1}) (node42). Convergence is quadratic for simple roots in 1D and at best linear in higher dimensions. Multiple or tangential roots degrade to bisection.

### Why plain floating point fails (4.6, node44), DOCUMENTED
- Example 4.6.1: a tangential curve y=x^4 is translated by +1, then -1/3 three times, in floating point. A 3.5e-4 "gap" appears, which is enough to flip tangent to "no intersection" or "two crossings".
- Example 4.6.2: PP in floating point on (x-0.1)(x-0.6)(x-0.7) drops the root 0.7 at iteration 9 (Table 4.1). The same run in RIA keeps it (Table 4.5, node52).

### Rounded interval arithmetic (4.7-4.8, node45-51), DOCUMENTED
- Interval ops per (4.43): subtraction and division are not inverses of addition and multiplication, and multiplication is only subdistributive.
- RIA per (4.49): after each op, widen the lower bound down by one ulp and the upper bound up by one ulp. Two implementations:
  - (a) software ulp extraction from IEEE-754 bits (4.8.2), which always widens;
  - (b) hardware directed rounding modes (4.8.4), which widen only on inexact results.
- Measured results (4.9.2, node54, from Abrams et al. [4]):
  - Wilkinson-20 at ±1e-8, 50 runs: 25.3 s software vs 24.7 s hardware.
  - Offset-curve self-intersection at ±1e-12: hardware 25.8% faster (168.0 vs 124.6 CPU s, SGI).
  - The text also reports hardware rounding about 15% slower on PowerMac. Cost is platform-dependent.
- Formulation rule (4.9.1, node53): build the Bernstein coefficients themselves in rational arithmetic or RIA. Always use RIA when inputs are irrational, e.g. rotated geometry with sin/cos. The formulation step is where plain floating point contaminates an otherwise robust solver.
- IPP detail (node52): hull-axis crossings come out as intervals [u_a,u_b], [u_c,u_d]. The new box is taken as the degenerate outer ends [u_a], [u_d], so parameters stay reals while coefficients stay intervals.

### SSI taxonomy (5.1-5.8, node55-110), DOCUMENTED
- Intersection problems are classified by dimension and representation: rational polynomial parametric (RPP), procedural parametric (PP), implicit algebraic (IA), implicit procedural (IP). SSI cases F1..F10 cross these classes.
- About 90% of surfaces in mechanical parts are planes, natural quadrics or tori (node100, citing [149]).
- F3, parametric vs implicit (5.8.2, node102):
  - Substitute the rational parametric surface into the implicit: F(u,v) = W^m(u,v) f(X/W, Y/W, Z/W), which is a Bernstein polynomial of degree (mp, mq).
  - For a plane, the coefficients are c_ij = (a x_ij + b y_ij + c z_ij + d) w_ij. If all coefficients have one sign, there is no intersection. This is exact if the inputs are exact.
  - Gradients: F_u = W^m ∇f·r_u (5.92) on the curve.
  - Tracing ODE in parameter space: u' = ξ F_v, v' = -ξ F_u, with arc-length normalization ξ = ±1/sqrt(E F_v² - 2F F_u F_v + G F_u²) (5.89-5.91). The step must shrink where F_u²+F_v² → 0 (Fig. 5.20).
- Characteristic points (5.8.2, node103-104) guarantee that every branch and loop is found:
  - Border points: F=0 on the patch edge (1D problems).
  - u-turning points: F=F_v=0. v-turning points: F=F_u=0.
  - Singular points: F=F_u=F_v=0, where the surface normals are parallel.
  - Bézout bounds: 2MN-M u-turning, 2MN-N v-turning, 2MN-M-N+1 singular, over the complex plane (Table 5.4). Example: plane vs bicubic gives 15/15/13. In practice there are far fewer inside [0,1]².
  - Splitting the domain at turning points makes each piece monotone, so marching can start from border points only.
- Singular point classification: sign of the discriminant of α²F_uu + 2αβF_uv + β²F_vv = 0 gives self-crossing (two tangents), cusp, or isolated point. DOCUMENTED (node104-105).
- F1, parametric vs parametric (node106-109):
  - Lattice methods miss small loops.
  - Subdivision methods have connectivity trouble near singular points (node107).
  - Marching needs starting points on every branch. Collinear-normal points, where r_u×r_v ∥ s_σ×s_t (Sederberg; eq. 5.100), bound closed loops. Split the patches at collinear-normal points, so that every loop touches a border.
  - Marching direction c' = (N^A × N^B)/|...|, with parameter derivatives from (5.104)-(5.105). Grandine-Klein topology resolution is cited (node109).
- F8, implicit vs implicit (node110): Bajaj-style marching and Hartmann numerical implicitization. Example 5.8.4 is a sphere-cylinder Viviani curve with a singular point. Quadric/quadric special cases are cited as [233, 234, 367, 104, 443, 390, 268].
- Overlap (5.9, node111): curve/curve overlap shows up as a continuum of root boxes (Fig. 5.29, cubics overlapping for t∈[0.25,1]). Theorem 5.9.1 characterizes overlap via end-point containment plus a degree-elevated control-point identity.
- Self-intersection (5.10, node112): trivial solutions σ=t are removed by factoring out (σ-t) in Bernstein form (5.113-5.116), before calling the solver.

### Tangential intersections (6.4, node122-124), DOCUMENTED
- At P with N^A = N^B, the tangent satisfies t = r^A_u u'_A + r^A_v v'_A = r^B_u u'_B + r^B_v v'_B (6.56), and the normal curvatures are equal (6.57).
- Eliminate u'_B, v'_B via determinant coefficients a_ij (6.58-6.63) to get the quadratic b11 u'² + 2 b12 u'v' + b22 v'² = 0 (6.64-6.65). The discriminant b12² - b11 b22 classifies P:
  - < 0: isolated contact point;
  - = 0 with some b nonzero: tangential intersection curve with a unique direction;
  - > 0: branch point;
  - all b = 0: contact of order ≥ 2, i.e. curvature-continuous.
- Geometric reading: t is where the Dupin indicatrices of A and B intersect (Fig. 6.3).
- The curvature vector at tangential points needs third-order terms (6.69-6.77). Transversal curvature, torsion and higher derivatives are in 6.3 (node117-121).

### Offsets (11.3, node224-229), DOCUMENTED
- An offset surface is singular where κ_min or κ_max = -1/d (11.28). Offsets of natural quadrics are natural quadrics (node226). Self-intersections of offsets of implicit quadrics are planar conics (Maekawa [249]).
- For general patches, offset self-intersection is an underconstrained 3x4 system (11.79-11.81), traced with c' = S(σ,t)×S(u,v) (11.87).
- Pipe surfaces (the rolling-ball fillet core) are in 11.6 (node235, not read in detail).

## Robustness and guarantees

- DOCUMENTED (4.9, node52-53): with RIA plus an exact or RIA formulation, IPP never loses a root in the box. Every real root lies in some output box of width ≤ ε. This is a one-sided guarantee.
- Not guaranteed:
  - Boxes may contain no root, or several roots (a cluster).
  - Multiplicity is not certified.
  - Tangential and overlapping solution sets produce many adjacent boxes that the caller must merge.
  - Summary 5.11 (node113) says interval and exact methods "cannot resolve effectively non-zero-dimensional solution sets ... or achieve very high precision in reasonable computation times".
  - DOCUMENTED.
- Marching (5.8) is heuristic. Completeness depends on starting points (the characteristic points), and step control has no proof. The book's answer is characteristic points plus IPP for the start points, but it does not prove that a traced branch never jumps to a neighboring branch. INFERRED from 5.8.2 and Fig. 5.20.
- The authors point to "rectification" of B-reps (Shen, Sakkalis et al.; node113, refs 303/360/388/389) and interval NURBS (INURBS, node45) as the remedy for inconsistent B-reps. That is a topology-tolerance model, not exactness. DOCUMENTED.
- Tolerances are explicit everywhere: ε root-box width, 1e-8 and 1e-12 in the examples, interval widths reported per root (Table 4.6). This matches wonky's "approximations carry explicit tolerances" rule.

## Parallelism and performance

- The only measured numbers are old single-core SGI/PowerMac timings: Wilkinson-20 at 0.5 s per solve (25.3 s for 50 runs), offset self-intersection 124-168 CPU s at ±1e-12 (node54). DOCUMENTED. These are not useful as absolute numbers.
- The book never discusses parallelism. INFERRED: PP/IPP is embarrassingly parallel.
  - Boxes are independent.
  - A de Casteljau split is a fixed arithmetic kernel on (m+1)^l coefficients.
  - Projection plus hull-axis crossing is a min/max reduction.
  - This is a textbook fork-join tree.

## Known failures, limitations, war stories

- Loss of roots in FPA (Table 4.1). Tangency "gap" example 4.6.1. DOCUMENTED (node44, node52).
- Lattice methods miss loops. Subdivision loses connectivity near singular points. Marching steps over small loops or jumps branches (node107, Fig. 5.20). DOCUMENTED.
- Turning- and singular-point counts grow as 2MN, so high-degree F3 substitutions (a torus against bicubic gives degree 12x12) make the characteristic-point solve expensive (Table 5.4, node103). DOCUMENTED.
- Non-zero-dimensional solution sets (overlapping faces, coincident curves) are the main open problem (node113). Coplanar and co-cylindrical faces in CAD Booleans are exactly this case. DOCUMENTED plus INFERRED.

## Relevance for wonky

- **SSI for the hybrid Boolean.** The leading bake-off prototype uses the tagged mesh Boolean for topology, then analytic SSI to recover exact curves. The hyperbook gives the recipe for the analytic step:
  - (a) For plane, cylinder or cone against an implicit quadric, use the F3 substitution F(u,v)=W^m f(r(u,v)). With wonky's rational parametrizations (rational-quadratic circle), F is a low-degree Bernstein polynomial.
  - (b) All-same-sign coefficients mean no intersection. With exact inputs this can be an exact multi-limb-integer sign test.
  - (c) Turning points plus border points give guaranteed starting points, so no loop is missed. The mesh Boolean's intersection polylines give seeds and branch topology, and the characteristic-point solve certifies them.
  - INFERRED.
- **Tangential and coincident cases.** The b12² - b11 b22 classifier from 6.4 applies to any Boolean involving fillets, because a fillet face is tangent to its support faces by construction. Branch points (> 0) are where the mesh Boolean's topology is most likely wrong. It gives wonky an explicit "fail or special-case" trigger instead of silent marching. INFERRED.
- **Bend fit.**
  - IPP maps well: recursion over boxes is fork-join, and each step is uniform arithmetic on a fixed-size coefficient array. Degree is known per surface pair, so arrays are fixed-length lists.
  - The hull-axis intersection needs no hull algorithm. The hull ∩ axis equals [min, max] over axis crossings of all segments joining opposite-sign control points (plus points on the axis). That is O(m²) uniform work, GPU-friendly. INFERRED (elementary convexity argument).
  - RIA without directed rounding: Bend has no rounding-mode control and no cheap ulp bit tricks on F32x2. Instead, use a priori error bounds of double-word ops, widening each result by c·u²·|x| with u = 2^-24 (Joldes-Muller-Popescu style bounds; the constant depends on the DW algorithm used). INFERRED. This matches the book's "software ulp" variant, which is only slightly looser (node54).
  - F32 exponent range: the low word of F32x2 underflows below about 1e-31, so root boxes should be normalized to [0,1] per subdivision level. That is already the Bernstein convention. INFERRED.
  - Exact branch: for predicates (sign of all coefficients, sign of the discriminant b12² - b11 b22), use multi-limb U32 integers on fixed-point inputs, as the book's "rational arithmetic for formulation" advice suggests (node53). INFERRED.
- **Offsets and FDM.** 11.3 gives singularity conditions (κ = -1/d). Offsets of natural quadrics are natural quadrics, so offset-by-κ checks for wall thickness, shell and clearance on plane/cylinder/cone models are closed-form. Offsets of cone/cylinder/plane stay in wonky's current exact analytic set. INFERRED.
- **Fillet.** The rolling-ball fillet is a pipe surface (11.6) whose spine is the intersection of two offset surfaces. That is F-class SSI on offsets, the same machinery again. INFERRED.
- **Testing.** Tables 4.1, 4.5 and 4.6 and examples 4.6.1, 4.6.2, 5.8.4 (sphere-cylinder Viviani with a singular point) make ready-made regression cases with known answers. INFERRED.

## Pointers worth porting or studying

- 4.4 PP steps and cost (node42). 4.8 RIA rules (4.49) (node46). 4.9.1 formulation advice (node53). 4.9.2 software vs hardware rounding (node54).
- 5.8.2 F3: substitution F=W^m f (5.78-5.92), tracing ODE (5.89-5.91), characteristic points and Table 5.4 (node102-105).
- 5.8.3 F1: collinear-normal loop detection (eq. 5.100) and marching direction (5.104-5.105) (node106-109).
- 5.9 overlap Theorem 5.9.1 (node111). 5.10 factoring out (σ-t) (node112). 5.11 open problems (node113).
- 6.4.1 tangential-direction quadric and four-case classification (6.56-6.67) (node123). 6.4.2 curvature at tangential points (node124).
- 11.3.2-11.3.6 offset singularities and self-intersection tracing (node225-229). 11.6 pipe surfaces (node235).
- Bibliography (node245):
  - [254, 255] Maekawa-Patrikalakis on IPP robustness;
  - [4] Abrams et al. on RIA;
  - [458] Ye-Maekawa on differential geometry of intersection curves;
  - [303, 360, 389] B-rep rectification.

## Verdict: adapt

Adapt the IPP solver (Bernstein subdivision plus projected hulls, with the a priori error-bounded F32x2 intervals of the RIA variant), the characteristic-point method for complete SSI start points, and the 6.4 tangential classifier. These are the math core of wonky's analytic SSI recovery and the fillet-Boolean robustness story, and they fit fork-join and uniform GPU work well.

Do not port code: the software package is non-commercial shared-source. The book is honest that coincident and tangential solution sets remain open, so wonky still needs its own explicit-failure policy there.
