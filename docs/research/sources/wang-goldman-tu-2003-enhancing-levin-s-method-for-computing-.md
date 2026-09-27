# Wang, Goldman, Tu 2003: "Enhancing Levin's method for computing quadric-surface intersections" (CAGD 20), with Tu, Wang, Mourrain, Wang 2009: QSIC classification by signature sequences (CAGD 26)

- Kind: two journal papers. Both were read in full from the author copies.
  - 2003: W. Wang, R. Goldman, C. Tu, Computer Aided Geometric Design 20(7):401-422, doi:10.1016/S0167-8396(03)00081-5.
    - Author PDF: https://i.cs.hku.hk/~ykchoi/quadrics/CAGD_Levin_Enhanced.pdf (HTTP 200; server Last-Modified 2014-12-13).
    - Local copy: tmp/research/pdf/wang-goldman-tu-2003-levin-enhanced.{pdf,txt}.
  - 2009 companion: C. Tu, W. Wang, B. Mourrain, J. Wang, "Using signature sequences to classify intersection curves of two quadrics", CAGD 26(3):317-335, doi:10.1016/j.cagd.2008.08.004.
    - Author PDF: https://i.cs.hku.hk/~ykchoi/quadrics/cagd_qsic.pdf.
    - Local copy: tmp/research/pdf/hku-qsic-2009.{pdf,txt}.
  - Index page of the HKU group: https://i.cs.hku.hk/~ykchoi/quadrics/. It also lists ellipsoid-separation and continuous collision papers (2001-2014).
- Authors/organization:
  - Wenping Wang (HKU), Ronald Goldman (Rice), Changhe Tu (Shandong University).
  - 2009 adds Bernard Mourrain (INRIA Galaad) and Jiaye Wang (Shandong).
- License:
  - Both papers are copyrighted by Elsevier; the HKU PDFs are author copies.
  - No code was published with the 2003 paper.
  - The 2009 paper says efficient implementations "are available in the library synaps" (INRIA; http://www-sop.inria.fr/galaad/software/synaps/). That library is historical, and its licence was not checked.
  - The algorithms are mathematics and can be reimplemented freely. Do not copy the text or tables verbatim.
- Status:
  - Historical and finished work. The 2003 paper is the standard reference for "Levin's method plus morphology".
  - Dupont, Lazard, Lazard and Petitjean 2008 (DLLP) supersede it for exact parameterization; see [dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md](dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md).
  - The 2009 paper is one of the two complete exact classifiers of quadric pencils. The other is DLLP Part II.

## What it is

**2003 (ELM, "Enhanced Levin's Method").**
- Levin (1976/78) parameterizes the intersection curve of two quadrics (QSIC) as p(u) = a(u) ± d(u)·√s(u), with s a quartic. It gives no structural information. It misses the line in a "line plus space cubic" QSIC, never produces the rational parameterization that every singular QSIC admits, and cannot count components (DOCUMENTED, §1.3).
- ELM adds three things (DOCUMENTED, abstract and §4):
  1. A resultant test that detects and extracts a line component.
  2. A complete table that maps the root pattern of s(u) to the morphology of an irreducible QSIC: singular type (acnode, crunode, cusp) or component count 0/1/2.
  3. A rational parameterization of any singular QSIC, obtained by choosing a cone or cylinder in the pencil whose vertex is the singular point.
- The authors admit that numerical robustness is open: "Further research is still required to examine the numerical accuracy of Levin's method in order to insure that this method is numerically robust" (DOCUMENTED, §5).

**2009 (signature sequences).**
- This is a classification of all 35 QSIC types of non-degenerate pencils in real projective space PR³, i.e. det(λA − B) ≢ 0.
- Each type is characterized by a "signature sequence" that is computable with rational arithmetic only. Two ambiguous groups are resolved by minimal-polynomial tests (DOCUMENTED, abstract and §4.4).
- It covers neither degenerate pencils nor affine (bounded or unbounded) information (DOCUMENTED, §1.1).

## How it works

### Levin's parameterization (2003 §1.3), the computational core

- Setup:
  - Take two quadrics X^T A X = 0 and X^T B X = 0 in homogeneous coordinates X = (x, y, z, w). They span the pencil X^T(λA + B)X = 0, and every member contains the QSIC.
  - Theorem A.1 (with a short geometric proof in the appendix): every real pencil contains a real *ruled* quadric S. Candidates are a pair of planes, a cone or cylinder (singly ruled), or a one-sheet hyperboloid or hyperbolic paraboloid (doubly ruled).
  - Levin's affine version, Theorem A.2: the QSIC always lies on a plane, a pair of planes, a hyperbolic or parabolic cylinder, or a hyperbolic paraboloid. The corresponding λ is chosen so that the conic at infinity λA_u + B_u (the upper 3x3 blocks) degenerates into one containing a real line.
- Parameterize S as q(u, v) = b(u) + v·d(u):
  - Singly ruled: b is the vertex (degree 0; a point at infinity for a cylinder) and d(u) is a conic on S (degree 2).
  - Doubly ruled: b and d are two skew lines of one regulus (degree 1).
- Substitute into A:
  - c2(u)·v² + 2·c1(u)·v + c0(u) = 0, with c2 = dᵀAd, c1 = bᵀAd, c0 = bᵀAb.
  - s(u) = c1² − c2·c0 is a quartic.
  - p(u) = c2·b + (−c1 ± √s)·d = a(u) ± √s(u)·d(u), with a = c2·b − c1·d.
- Lemma 3: re-choosing the generating curves by q̄ = (γv + µ)b + (αv + β)d changes s only by the constant factor δ² with δ = αµ − βγ. The root pattern of s is therefore an invariant of the pencil member, not of the chosen parameterization (DOCUMENTED).

### Line plus cubic detection (2003 §2.2)

- A line component ℓ0 makes all three c_i vanish at some u0, so the whole line collapses to the single point p(u0) (DOCUMENTED).
- Test when S is singly ruled:
  - c0 is constant. If c0 ≠ 0 there is no line.
  - If c0 = 0, there is a line iff Res(c1, c2) = 0, i.e. gcd(c1, c2) is non-constant. Here deg c1 = 2 and deg c2 = 4.
- Test when S is doubly ruled:
  - Build a parameterization from each of the two reguli.
  - For each one, test whether the three quadratics c0, c1, c2 share a factor: Res(c0, c2) = Res(c1, c2) = Res(c0 + c1, c2) = 0, or equivalently gcd(gcd(c0, c1), c2) ≠ const.
- Then extract the line and parameterize the residual cubic rationally (step 3 below).

### Morphology from the roots of s(u) (2003 §3, Theorem 12)

- Proof device: a stereographic projection from a real regular point N0 of the QSIC lying on S. It maps the QSIC to a plane cubic H with the same reducibility, singularity type and component count. The regulus through N0 maps to a pencil of lines through a point R̃0 on H. The zeros of s are the pencil lines tangent to H or passing through its double point.
- Full table for an irreducible QSIC (DOCUMENTED, Theorem 12). The PDF text lost a prime; it is s″(u0), since at a double root s′ = 0.

| Morphology | Root pattern of s(u) |
| --- | --- |
| One real singular point and no other real point | s < 0 everywhere except a single zero u0 |
| Acnode plus one component | (a) double root with s″(u0) < 0 plus two simple real roots; or (b) s = c1² with c1 having complex roots (then p is rational) |
| Crunode | (a) double root with s″(u0) > 0 plus two simple real roots; or (b) s = c1² with c1 having two distinct real roots |
| Cusp | (a) triple root plus one simple real root; or (b) s = c1² with c1 having a real double root |
| No real points | s < 0 for all u |
| Non-singular, one component | two simple real roots and two complex roots |
| Non-singular, two components | (a) four simple real roots; or (b) no real roots and s > 0 everywhere |

- In each (b) case the parameterization is rational.

### Rational parameterization of a singular QSIC (Theorems 7 and 8)

- p is rational iff S is singly ruled with its vertex at the singular point X0. Then c0 ≡ 0, v = −2c1/c2, and p(u) = c2(u)·b − 2·c1(u)·d(u).
- Such an S always exists when the QSIC is singular and non-planar:
  - The tangent planes of A and B at X0 coincide, so X0ᵀA = ρ·X0ᵀB.
  - S0 = A − ρB then has X0 in its kernel; it is a cone or cylinder with vertex X0.
  - This also covers "line plus cubic" (DOCUMENTED).
- Corollary 9: every singular QSIC is rational.

### Procedure ELM (§4)

1. If the pencil contains a pair of planes, the QSIC is planar: intersect a quadric with the planes and stop.
2. Find a real ruled S. Run the §2.2 line test and extract the line if one exists.
3. For every singly ruled member of the pencil, check whether its vertex lies on A. If one does, that vertex is the singular point and the parameterization built from that member is rational.
4. Otherwise use any ruled S and read the component count from Theorem 12.

Finding S requires the roots and multiplicities of the quartic det(λA + B) = 0. The paper defers quartic solving to classical texts (Dickson 1914, Uspensky 1948).

### Worked examples (usable as fixtures)

- Example 1: two cones meeting in a line plus a space cubic.
  - A = [[1,0,0,-0.5],[0,0.75,-0.5,-0.5],[0,-0.5,0,0],[-0.5,-0.5,0,0.25]]
  - B = [[0.75,0,-0.5,0.125],[0,1,0,0],[-0.5,0,0,0.25],[0.125,0,0.25,-0.3125]]
  - s = (u² − 1)².
  - The line is (0.5, 0, −1, 1) + v·(0, 0, 3.46, 0).
  - All entries are dyadic, so they are exactly representable as F32 values.
- Example 2: sphere and cone meeting in a curve with a cusp.
  - A = [[1,0,0,0],[0,1,0,-1],[0,0,1,0],[0,-1,0,0]] (the sphere x² + (y−1)² + z² = 1)
  - B = [[1,0,0,0],[0,0,1,0],[0,1,0,0],[0,0,0,0]] (the cone x² + 2yz = 0)
  - s = (u − 1)⁴. This is case 4(b); the quartic parameterization is printed in the paper.
- Example 3: ellipsoid and two-sheet hyperboloid, with three-decimal inputs. S is a hyperbolic paraboloid; s has four real roots (−1.324, −0.897, 0.043, 1.169), so the curve has two components.

### 2009 signature-sequence classifier (Tu, Wang, Mourrain, Wang)

- Quadric Pair Canonical Form (Muth 1905, Uhlig 1976): simultaneous block diagonalization of a non-singular pair by a real congruence. The Jordan blocks of A⁻¹B carry signs ε_i = ±1.
- Index function Id(λ) = number of positive eigenvalues of λA − B. It can only jump at real roots of f(λ) = det(λA − B). The size and sign of the Jordan block at a root determine the jump.
- Computation is rational-only (§3.4):
  - Form C(λ, µ) = det(λA − B − µI) = µ⁴ + c3(λ)µ³ + c2(λ)µ² + c1(λ)µ + c0(λ), with f = c0.
  - The matrix is symmetric, so all eigenvalues are real and Descartes' rule counts exactly.
  - The number of positive eigenvalues is the number of sign variations of [1, c3, c2, c1, c0].
  - The number of negative eigenvalues is the number of sign variations of [1, −c3, c2, −c1, c0].
  - Between the roots of f, evaluate at rational separators q_i.
  - At a root α (given as square-free part plus an isolating interval), get the sign of c_i(α) from Sturm-Habicht (subresultant) sequences: V(a) − V(b) = #{roots with g > 0} − #{roots with g < 0}.
- Algorithm 1, the complete exact classifier:
  1. Compute A, B and C(λ, µ).
  2. If c0 ≡ 0, report "degenerate pencil".
  3. Isolate the real roots of f and their multiplicities.
  4. Take the index at −∞ and at the separators q_i; take the signature at each root via static Sturm sequences.
  5. Look the signature sequence up in Tables 1-3, modulo rotation, reversal and complement rules.
  6. Resolve the two ambiguous groups:
     - Signature (2): if Disc(f) = Res(f, f′) ≠ 0 it is case 4. Otherwise write f = g² and test g(A⁻¹B) = 0: zero means case 11 ([22]₀), non-zero means case 31 ([(11)(11)]₀).
     - Signature (2,(((1,1))),2): with f = g², if g(A⁻¹B) = 0 it is case 26, otherwise case 35.
  - The result is 32 distinct signature sequences for 35 types (DOCUMENTED, §4.4).
- The 35 types (DOCUMENTED, §4.3):
  - Cases 1-12 contain non-planar components:
    - two ovals; vacuous; one oval;
    - two non-null-homotopic components;
    - crunode joining two ovals; oval plus acnode; lone acnode;
    - crunode of two non-null-homotopic components;
    - cusp;
    - line plus cubic meeting in two real points, in two complex points, or tangentially.
  - Cases 13-22: conic pairs, real or imaginary, meeting at real or complex points, doubled, or tangent.
  - Cases 23-35: conic plus lines, four lines, and double lines.
  - "Null-homotopic" means the loop avoids some plane of PR³ and so is affinely an ellipse-like oval. Otherwise the loop meets every plane.
- Worked example: 20x² − 12xy + 48xz + 76x + 16y² − 16yz − 12y + 42z² + 72z + 58 and 28x² + 16xy + 80xz + 56x + 2y² + 24yz + 20y + 56z² + 72z + 14. f has the single real double root λ = 0 and the signature sequence is (1,((1,1)),3). That is case 17: one real conic plus one imaginary conic.
- Application (§5): exact separation, one-point tangency and two-point tangency tests for two cones by signature sequence (Lemmas 1-3).

## Robustness and guarantees

- ELM proves Theorem 12 (necessary conditions are pairwise distinct, hence also sufficient), but every test in it is an *exact* root-multiplicity decision on s(u):
  - double versus triple roots;
  - s = c1²;
  - sign of s″ at a double root.
- The coefficients of s live in the field generated by the chosen pencil parameter λ0, a root of a quartic. In general they are algebraic numbers of degree up to 4, and DLLP report nested radicals of depth up to five for Levin.
- ELM therefore needs exact algebraic-number arithmetic, or it is a heuristic when run in floating point. The paper offers no tolerance analysis.
- DLLP Part I §1 reports that floating-point Levin gives topologically wrong results in degenerate cases (DOCUMENTED there).
- The 2009 classifier is exact with integer and rational arithmetic only:
  - Descartes counting on the characteristic polynomial.
  - Sturm-Habicht signs at the real roots of a quartic with integer coefficients.
  - Minimal-polynomial tests are integer matrix evaluations.
  - It does not produce the curve, handle degenerate pencils (f ≡ 0), or give affine information.

## Parallelism and performance

- Neither paper reports timings. ELM is O(1) work per pair, dominated by quartic root analysis.
- The 2009 classifier is also O(1) per pair:
  - one 4x4 characteristic polynomial with polynomial entries;
  - root isolation of a quartic;
  - at most a few Sturm-Habicht sequences of degree ≤ 4.
- Its cost is set by the bit length of the integer coefficients, not by geometry (INFERRED).

## Known failures, limitations, war stories

- Levin's method loses the line of a line plus cubic QSIC. Wilf and Manor 1993 (CAD 25(10)) first reported this, and ELM §2.2 fixes it.
- Levin/ELM with floating point gives wrong topology near degeneracies (DLLP 2008 Part I §1). One exact Levin output "fills up over 100 megabytes" in Maple (DOCUMENTED in DLLP).
- ELM needs an initial real regular point of the QSIC only inside the proof, not in the algorithm. The earlier Wang-Joe-Goldman 2002 cubic-projection method does need one (DOCUMENTED, 2003 §1.2).
- The 2009 classification is projective. A cylinder is a cone with its vertex at infinity, and whether a component is bounded in R³ needs an extra test against the plane w = 0 (DOCUMENTED, §1.1).

## Relevance for wonky

- **Direct target.** docs/intersections.md returns `UnsupportedSurfacePair` for cylinder/cylinder and all cone pairs, and these are exactly QSICs.
  - The most common FDM cases are cross holes (cylinder/cylinder), countersinks and chamfer cones against holes (coaxial cone/cylinder: circles), and tangent bosses (singular QSIC).
- **Exact inputs are available** (INFERRED):
  - Every F32x2 word is a dyadic rational (docs/robust-predicates.md).
  - A cylinder (origin o, non-unit axis n, radius r) has the implicit form |n|²·|p − o|² − (n·(p − o))² − r²·|n|² = 0. All of its 4x4 matrix entries are polynomials in dyadic inputs.
  - A power-of-two scale therefore makes A and B integer matrices without rounding. Cones work too if the half-angle is stored as a rational slope.
  - So the 2009 classifier and the ELM resultant tests can run on multi-limb U32 integers.
- **Bit budget** (INFERRED):
  - Inputs like 0.1 mm are not dyadic, so F32x2 stores roughly 48-bit mantissas.
  - Matrix entries are degree-4 products of such values; the characteristic polynomial coefficients are degree 4 in those entries.
  - That means hundreds to about a thousand bits for general inputs. Fixed-size limb vectors are fine; see also Hoffmann's fixed grid idea in [hoffmann-geometric-and-solid-modeling-1989-fundamental-techn.md](hoffmann-geometric-and-solid-modeling-1989-fundamental-techn.md).
- **Levin recipe that fits wonky's surfaces** (INFERRED):
  - For cylinder/X or cone/X, the input cylinder or cone *is* a singly ruled member of the pencil, so no quartic solve is needed to find S.
  - Parameterize the cylinder by a rational circle, t = tan(θ/2), plus the axis direction, or the cone by its apex plus a rational circle. Substitute into the other quadric.
  - s(t) is then a quartic with coefficients that are exact polynomials in the inputs. Theorem 12 classifies the morphology from the exact root pattern of s:
    - square-free discriminant and Sturm count on multi-limb integers;
    - gcd(s, s′) for multiplicities.
  - Branch points p(t) are then evaluated in F32x2 with residual checks against both implicits.
  - This is the same closed form OCCT and GTE use for cylinder/cylinder; see [open-cascade-technology-occt-intpatch-impimpintersection-and.md](open-cascade-technology-occt-intpatch-impimpintersection-and.md) and tmp/research/pdf/gte-IntersectionOfCylinders.pdf. ELM adds the certified topology on top.
- **Planar split first:**
  - Step 1 of ELM, "pair of planes in the pencil", covers the Steinmetz case. Take x² + z² = r² and y² + z² = r²: then A − B = x² − y² = (x − y)(x + y), which gives two ellipses.
  - In integers the test is a rank check of λA + B at rational roots of the quartic (INFERRED).
- **Singular cases get rational curves:**
  - For tangent cylinders or a cone touching a cylinder, Theorem 8 gives the singular point as the kernel of A − ρB.
  - For dyadic inputs ρ is a rational root of the pencil quartic in the common CAD configurations (INFERRED, to verify per case). The rational curve p = c2·b − 2c1·d then evaluates stably.
  - wonky must put a vertex at that singular point; Hoffmann Ch. 5 gives the reason.
- **Test oracle:**
  - The 35-case table plus degenerate pencils gives an exhaustive list of case names for wonky's quadric/quadric `Unresolved`/`UnsupportedSurfacePair` taxonomy.
  - A Bend port of Algorithm 1 can differential-test a DLLP Part II based classifier, or the wonky case table itself. Generate random integer quadric pairs per signature sequence using the canonical forms in Tables 1-3.
- **Bend fit** (INFERRED):
  - Everything is pure functions on 4x4 integer matrices and univariate quartics. There is no mutation, and fork-join parallelism is available over surface pairs.
  - The integer sizes are data-dependent, but they can be bounded from the input grid, so fixed-limb uniform GPU kernels are plausible for batch classification.
  - Root isolation of quartics is a short fixed-depth recursion, e.g. Descartes with a bounded bisection depth derived from root separation bounds. Anything that exceeds the bound returns `Unresolved`.
- **Hybrid Boolean:**
  - The exact component count and singular point list is a certificate for the loops that the mesh Boolean proposes on a quadric/quadric contact.
  - If they disagree, fail explicitly rather than trust the mesh.
  - Caveat (INFERRED): Theorem 12 counts components of the QSIC of the *infinite* surfaces. Face trims can cut a component into several edges or hide it. Compare counts only after clipping the certified branches to both faces' trims.

### Current wonky hook (checked in the working tree on 2026-09-24)

- `kernel/hybrid/recover/geom.bend`, surface-pair dispatch (around line 510), refuses every non-coaxial quadric pair with a free-text reason:
  - `SCyl`/`SCyl` off a common axis: "cylinder/cylinder intersection off a common axis is a space quartic (curve type missing)".
  - `cyl_cone` and `cone_cone` off a common axis: same "space quartic" refusal.
  - Coaxial pairs go through `coaxial_circle` (exact circles).
- These refusals are the measured `Unresolved` corpus cases in docs/hybrid-boolean-plan.md §2.3: `pipe-tee` (space quartic), `steinmetz-intersect` and `steinmetz-union` ("two-carrier vertices on the quartic"), plus `x-rod-cross-hole` in docs/proto-recover.md. Plan item 9 proposes "space quartics of cylinder/cylinder as B-spline curves with a stated bound computed in Bend".
- ELM gives a sharper split for these cases (INFERRED):
  - Steinmetz is ELM step 1: the pencil contains a plane pair, so the result is two exact ellipses. wonky already has an `Ellipse` curve type in `kernel/analytic.bend`. No quartic curve type is needed, and the two crossing points are the singular points where the vertices must go.
  - docs/proto-recover.md reports Steinmetz as "unresolved: 2-carrier vertex (quartic)". Recover builds each vertex as an exact intersection of three carriers, but the Steinmetz crossing points lie on only two carriers: they are the singular points of the QSIC.
    - Theorem 8 computes them exactly. For x² + y² = r² and y² + z² = r², the gradients agree at the singular points with ρ = 1, and A − B = x² − z² has the kernel line x = z = 0.
    - Intersecting that line with A gives (0, ±r, 0). Every step is rational.
    - Generally the singular points are Sing(λ0·A + B) ∩ A for the pencil roots λ0 whose member is singular (a cone or plane pair). When λ0 is rational, the whole computation is rational.
  - pipe-tee and cross holes are irreducible quartics. Theorem 12 certifies their component count and singular points. The curve itself needs either a new procedural curve type p(u) = a(u) ± √s(u)·d(u), evaluated in F32x2, or the planned bounded B-spline.
- The stored cylinder is `Cylinder{origin, axis, x, radius}` with F32x2-renormalized directions (`of_wire` in geom.bend). The frame (x, y = axis × x) is exactly what the rational-circle substitution below needs.
  - Caveat: after renormalization the frame is orthonormal only to F32x2 precision, about 2⁻⁴⁸ ≈ 4e-15 relative. An exact integer pipeline must pick one definition (implicit form or frame) as the carrier and report the difference as a stated deviation (INFERRED).

### Worked derivation: cylinder/cylinder through Levin (INFERRED, checked by hand)

This is ELM's singly ruled case with S = the first cylinder itself, so no pencil quartic has to be solved.

- Inputs:
  - Cylinder C1: origin o, unit axis n, unit x ⟂ n, y = n × x, radius r.
  - Cylinder C2: origin o2, axis m (need not be unit), radius ρ. Implicit form F(p) = |m|²·|p − o2|² − ((p − o2)·m)² − ρ²·|m|².
- Rational circle: c(u) = o + r·((1 − u²)·x + 2u·y)/(1 + u²). Points of C1 are p = c(u) + w·n.
- Substituting gives α·w² + 2β(u)·w + γ(u) = 0 with e(u) = c(u) − o2:
  - α = |m|²·|n|² − (n·m)², a constant. It is zero iff the axes are parallel, and then the QSIC is a set of generator lines (ELM's line case, c0 = 0).
  - β = |m|²·(e·n) − (e·m)·(n·m).
  - γ = |m|²·|e|² − (e·m)² − ρ²·|m|².
- Clear denominators: β̂ = (1 + u²)·β has degree 2, γ̂ = (1 + u²)²·γ has degree 4, and ŝ(u) = β̂² − α·γ̂ has degree 4.
  - In ELM notation: c0 = α, c1 = β̂, c2 = γ̂, s = ŝ.
- Branches: w±(u) = (−β̂ ∓ √ŝ)/(α·(1 + u²)). Real points exist exactly where ŝ(u) ≥ 0. u = ∞ is the point θ = π; handle it projectively or rotate the seam.
- Check 1, Steinmetz: C1 is x² + y² = r² (n = z) and C2 is y² + z² = r² (m = x, o2 = 0).
  - α = 1, β̂ = 0, ŝ = r²(1 − u²)², so w = ∓r(1 − u²)/(1 + u²) = ∓x.
  - The branches lie in the planes z = ±x: two ellipses, matching the plane-pair case.
- Check 2, offset cross hole: C2 has axis x, radius ρ, and is offset by a ≥ 0 in y.
  - α = 1 and β̂ = 0, so ŝ = −γ̂ = F1·F2 with F1 = (ρ − a)(1 + u²) + 2ru and F2 = (ρ + a)(1 + u²) − 2ru.
  - F1 and F2 have real roots iff r > |ρ − a| and r > ρ + a respectively. Theorem 12 then gives:
    - r > ρ + a (hole inside the wall's projection): four simple real roots, so two loops. This is the hole entering and leaving (case 7a).
    - |ρ − a| < r < ρ + a: two real roots and two complex roots, so one loop (case 6).
    - r < ρ − a: no real roots and ŝ(0) = ρ² − a² > 0, so two loops. The thin rod pierces both walls (case 7b).
    - a = 0 and r = ρ: F1·F2 = ρ²(1 + u)²(1 − u)², two double roots. The curve is reducible (Steinmetz), so ELM step 1 catches it and Theorem 12 does not apply.
    - r = ρ + a (a > 0): F2 = (ρ + a)(u − 1)², a double root at u0 = 1 with ŝ″(u0) = 2(ρ + a)·F1(1) = 8ρ(ρ + a) > 0, plus the two simple roots of F1, so a crunode (figure-eight, case 3a). The singular point is c(1) + w·n = (0, r, 0), which is rational as Theorem 8 predicts.
- Exactness:
  - With dyadic inputs, every coefficient of ŝ is an exact integer polynomial after power-of-two scaling.
  - The discriminant signs, double-root tests (gcd(ŝ, ŝ′)) and Sturm counts run in multi-limb U32.
  - Only the evaluation of √ŝ and w± needs F32x2, with residual checks against both implicits.
- Evaluation caveat: near simple roots of ŝ the speed |dp/du| is unbounded because of √ŝ. Chart points must cluster there, or the branch must be reparameterized locally by w. This matters for the certified-deviation mesh.

## Pointers worth porting or studying

- 2003 eq. (1)-(4): Levin substitution, s = c1² − c2·c0, and p = a ± √s·d.
- 2003 §2.2: resultant and gcd line tests.
- 2003 Theorem 12: the morphology table.
- 2003 Theorems 7-8: the rational singular parameterization and how to find ρ.
- 2003 Appendix: Theorems A.1 and A.2. These are short proofs, useful as a test that the parameterization surface exists.
- 2003 Examples 1-2: exact dyadic fixtures.
- 2009 Theorem 2: Descartes counting of eigenvalue signs.
- 2009 Theorem 3: the Sturm-Habicht sign at an algebraic root.
- 2009 Algorithm 1 and Tables 1-3: 35 types, index sequences, signature sequences, canonical forms. The tables are images; read them from the PDF pages, not the txt.
- 2009 §5: cone-cone separation lemmas, usable for fast interference checks between conical features.

## Verdict: learn-from

- Do not port ELM as the production parameterizer. Its exact form needs algebraic numbers of degree up to 4, and the DLLP construction (already rated "adapt") is the better exact backbone.
- Take these parts from it:
  - the Theorem 12 root-pattern table as a certified morphology check on s(t) for wonky's cylinder- and cone-based Levin substitutions;
  - the Theorem 7-8 rule that gives a rational singular curve;
  - the 2003 fixtures.
- The 2009 signature-sequence classifier is rational-only and small. Port it (adapt) as an independent oracle and case namer for differential testing of wonky's quadric case table.
- First concrete use: the cylinder/cylinder derivation above, with the input cylinder as the parameterization surface. It closes the Steinmetz cases exactly (two ellipses) and gives pipe-tee and cross holes a certified loop count and singular points before any curve fitting.
