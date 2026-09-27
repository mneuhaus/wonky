# EXACUS (Berberich et al. 2005) and Dupont, Hemmer, Petitjean, Schömer 2007: exact arrangements of quadrics

- Kind: papers plus a research library.
  - **EXACUS library paper:** Berberich, Eigenwillig, Hemmer, Hert, Kettner, Mehlhorn, Reichel, Schmitt, Schömer, Wolpert, "EXACUS: Efficient and Exact Algorithms for Curves and Surfaces", ESA 2005, LNCS 3669, pp. 155-166, doi:10.1007/11561071_16. Read in full: tmp/research/pdf/exacus-esa2005.{pdf,txt}.
  - **Quadric planar maps (the EXACUS "QuadriX" projection approach):** Berberich, Hemmer, Kettner, Schömer, Wolpert, "An exact, complete and efficient implementation for computing planar maps of quadric intersection curves", SoCG 2005, pp. 99-106, doi:10.1145/1064092.1064110. Read in full: tmp/research/pdf/berberich-socg2005-quadrics.{pdf,txt}.
  - **DHPS 2007:** Dupont, Hemmer, Petitjean, Schömer, "Complete, exact and efficient implementation for computing the adjacency graph of an arrangement of quadrics", ESA 2007, LNCS 4698, pp. 633-644, doi:10.1007/978-3-540-75520-3_56.
    - HAL inria-00165663 has metadata and abstract only; no open PDF was found (Springer, HAL, ISTEX, CiteSeerX).
  - **Journal version:** Hemmer, Dupont, Petitjean, Schömer, "A complete, exact and efficient implementation for computing the edge-adjacency graph of an arrangement of quadrics", J. Symbolic Computation 46(4):467-494 (2011), doi:10.1016/j.jsc.2010.11.002, HAL inria-00537592 (no file).
  - **Read instead for the DHPS content:** Michael Hemmer's PhD thesis, "Exact computation of the adjacency graph of an arrangement of quadrics", Univ. Mainz 2008 (submitted 2007-09-18), open access: https://openscience.ub.uni-mainz.de/items/00316f97-9402-4168-9adb-63a288743c64.
    - Its extracted text is saved as tmp/research/pdf/hemmer-2008-thesis.txt.
    - The thesis states that "a short version of this work has been published in cooperation with Sylvain Petitjean, Laurent Dupont and Elmar Schömer". Its Chapter 1 is therefore the full version of DHPS 2007 (DOCUMENTED).
  - **Project site:** http://www.mpi-inf.mpg.de/projects/EXACUS/ (HTTP 403 today). Cached pages are in tmp/research/exacus/.
- Authors/organization:
  - MPI für Informatik Saarbrücken (Kettner, Mehlhorn, Berberich, Eigenwillig, Wolpert, …), Univ. Mainz (Hemmer, Schömer), INRIA Nancy/LORIA (Dupont, Petitjean).
  - EU projects ECG (IST-2000-26473) and ACS (IST-006413), 2002-2008.
- License:
  - The papers are copyrighted; the thesis is "InC-1.0", open access.
  - EXACUS releases 0.9 (Oct 2004), 0.9.1 (Jan 2005) and 1.0 (Aug 2006) contained LiS, NumeriX, SweepX and ConiX under "an open-source license". The exact licence was not verified.
  - CubiX was restricted to ECG members. QuadriX does not appear in the public downloads (INFERRED from the cached downloads page).
  - The algebraic layer went into CGAL: Algebraic_foundations, Polynomial, Modular_arithmetic and Algebraic_kernel_d (including Bitstream Descartes). Their CGAL headers carry **SPDX LGPL-3.0-or-later OR LicenseRef-Commercial** (checked in CGAL/cgal on GitHub, 2026-09-23).
  - DHPS builds on QI (DLLP), which is non-commercial; see [qi-quadric-intersection-library-loria-gamble.md](qi-quadric-intersection-library-loria-gamble.md).
  - Porting ideas is unrestricted. Copying CGAL code would bring in LGPL obligations, and linking is excluded by wonky's rules anyway.
- Status:
  - EXACUS is dormant (last site change August 2006).
  - Its CGAL descendants are alive: CGAL/cgal has 6,054 stars and was last pushed 2026-09-21; the last commit touching Algebraic_kernel_d was 2026-07-27 (rechecked with `gh api` on 2026-09-24; GitHub reports the repository licence as NOASSERTION because the files carry mixed SPDX headers).
  - DHPS 2007: 17 citations (Semantic Scholar).
  - As of the thesis, the full 3D arrangement of quadrics was *not* achieved by any approach (DOCUMENTED, thesis §1.1.1).

## What it is

- **EXACUS:** a layered C++ design for exact and complete non-linear geometry, i.e. arrangements of low-degree algebraic curves and Booleans on curved polygons. It rests on generic number-type concepts, algebraic numbers, curve analysis and curve-pair analysis (a CAD-like decomposition of the plane), plus a degeneracy-complete Bentley-Ottmann sweep.
- **SoCG 2005 (projection approach):** for quadrics p1…pn, compute exactly the planar map of all curves p1 ∩ pi *on the surface of p1*. Method: project to the xy-plane, analyze the planar arrangement, then lift back to the upper and lower sheets.
- **DHPS 2007 / thesis (parameterization approach):** compute exactly the **adjacency graph** of the 3D arrangement of n quadrics:
  - all vertices, with their connectivity along the arrangement's edges;
  - from exact DLLP parameterizations of each pairwise intersection;
  - by intersecting each component with third quadrics and sorting points by exact parameter values.
- Correction to the brief: DHPS does **not** build the full arrangement topology (faces, cells, "sphere maps"). That is stated as future work.

## How it works

### EXACUS layers (ESA 2005)

- **LiS:** configuration, assertions, handles with union-find.
- **NumeriX:**
  - Number-type concepts: IntegralDomainWithoutDiv, IntegralDomain, UFDomain, EuclideanRing, Field, FieldWithSqrt, RealComparable.
  - Recursive multivariate `Polynomial<NT>`: degree ≤ 16 and ≤ 3 variables in their applications.
  - Gcd via Euclidean PRS over fields, or subresultant PRS over a UFD made fraction-free.
  - A **modular one-sided filter** for coprimality and square-freeness.
  - Resultants via subresultant PRS, or via Sylvester/Bézout determinants with division-free Berkowitz.
  - `Algebraic_real` = square-free polynomial plus an isolating interval, with non-zero endpoints; it may collapse to a rational.
  - Roots of one polynomial are cross-linked, so a factorization learned by one root simplifies all of them.
  - Refinement API: `refine`, `strong_refine`, `refine_to`, `refine_zero_against`, `rational_between`.
  - Descartes root isolation; later the Bitstream Descartes variant, which uses only as many coefficient bits as needed.
- **SweepX:**
  - The LEDA sweep, which handles all degeneracies with one event type.
  - **Linear-time reordering of curves through a common point using intersection multiplicities**, instead of pairwise comparisons.
  - Generalized polygons with regularized Booleans on curved edges.
- **GAPS (generic algebraic points and segments):**
  - A point is an x-coordinate (an algebraic number) plus an *arc number* on its supporting curve. The y-coordinate is never computed explicitly.
  - Everything reduces to one-curve analysis:
    - events are x-extreme points, singularities and vertical asymptotes;
    - `Event1_info` gives arc counts left and right per point.
  - …and two-curve analysis: `Event2_slice` maps arc numbers to vertical position numbers.
  - Preconditions: square-free and coprime curves. A violation, or a non-generic coordinate system in CubiX and QuadriX, throws; the caller shears and restarts (Las Vegas).
  - Unbounded arcs use symbolic ε-perturbation of x at poles and ±ε² at the ends of vertical lines.
- Library size: 94,000 lines of code and documentation.
- Lessons, verbatim-level (DOCUMENTED, §7):
  - "Arithmetic is the bottleneck", so use the simplest number type possible: integers, then rationals, then LEDA real or CORE, then algebraic numbers.
  - Naive LEDA reals are costly in (near-)equality situations.
  - Cache curve analyses and compute all roots of a polynomial at once.
  - Modular arithmetic serves as a fast inequality filter.
  - Floating-point filters are future work.

### Projection approach for quadrics (SoCG 2005)

- Make every quadric z-regular via a random shear; the curves must be y-regular.
- **Cutcurves** res_z(p1, pi) have degree ≤ 4; the **silhouette** res_z(p1, ∂p1/∂z) has degree ≤ 2.
- Theorem 3: the x-coordinates of singular points of a cutcurve are **one-root numbers a + b√c** (a, b, c rational). The four-lines case gives two-root numbers. Both are cheap to compare exactly (repeated squaring or separation bounds).
- Theorem 4: for a cutcurve f and the silhouette g, R = res(f, g, y) is split into multiplicity classes R1·R2·R≥3.
  - Simple roots are transversal crossings.
  - Double roots are handled with the **Jacobi curve** J = fx·gy − fy·gx, which crosses both curves transversally there.
  - Roots of R≥3 are one-root numbers.
- Theorem 5: for two cutcurves there are two polynomials of degree ≤ 8. One of them, R, gives exactly the x-coordinates of common points of p1, pi and pj; the other gives projection artifacts.
- The sheet assignment (upper, lower or both) of each sweepable segment is decided by ray shooting in z at a rational x inside the segment.
- A vertex is identified as (x0, curve f, arc number k, quadric p1, sheet j). Equality across surfaces is tested via res(p, p̃, z).
- Implementation: QuadriX, 15,500 lines.

### Parameterization approach (DHPS 2007 / Hemmer thesis Ch. 1)

- **Phase 0:** remove duplicate quadrics and make them coprime. A common factor yields rational planes, treated as double planes.
- **Phase 1:** features of single quadrics: cone apex (inertia (2,1) or (3,0)) and the line of a plane pair.
- **Phase 2, pairs:**
  - DLLP/QI parameterizes every component of Qs ∩ Qt.
  - A cache keyed by a unique pencil representation avoids rebuilding. A quartic determines its pencil; a pencil has at most one cubic and up to two conics.
  - Equal components from different pencils are unified, and their points are "rescued" onto the kept parameterization.
- **Phase 3, triples:** intersect each component with the third quadric U.
  - **Rational components** (singular quartic, cubic, conic, line): h(ξ) = X_C(ξ)ᵀ U X_C(ξ), of degree 8, 6, 4 and 2 respectively. Then square-free factorization plus root isolation.
    - h ≡ 0 means the component lies on U.
    - Coefficients live in Q, Q(√δ) or Q(√δ1, √δ2). Lines may need a degree 3-4 extension, handled with LEDA real or CORE Expr.
  - **Smooth quartic** (two arcs ε = ±1): work in the parameter space of the ruled pencil member Q_R.
    - f = a2τ² + a1τ + a0 (Q_R ∩ Q_S) and g = b2τ² + b1τ + b0 (Q_R ∩ U).
    - res(ξ) = s02² − s01·s12, degree 8, with s_ij = a_i·b_j − a_j·b_i and Δ = a1² − 4a0a2.
    - **Theorem 8, per real root ξ0:**
      - Δ(ξ0) < 0: two complex points.
      - Δ(ξ0) = 0: a common endpoint of both arcs.
      - Δ(ξ0) > 0 and s01(ξ0) = 0: one point on each arc.
      - Δ(ξ0) > 0 otherwise: ε = −sign(s01)·sign(2a0s02 − a1s01) at ξ0. There is a symmetric formula when a0(ξ0) = 0.
    - All these signs are known to be non-zero, so they are computed with **MPFI interval arithmetic, doubling the precision until the sign is certain** (Algorithm 3).
    - Theorem 9 gives multiplicities per arc via the first non-vanishing derivative of s01.
- **Matching (Algorithm 4):**
  - Each point of Q1 ∩ Q2 ∩ Q3 has one representation per component it lies on. Comparing two representations exactly across different parameter spaces is prohibitively expensive: a degree-8 root, under a square root of a quartic, over Q(√δ).
  - Instead, given the precondition "every point of seq1 has exactly one counterpart in seq2", compute MPFI boxes for all of them and double the precision until each box overlaps exactly one partner.
  - The authors call this their main source of efficiency, and also its **Achilles' heel**: the precondition cannot be checked, and a violation yields a meaningless map or non-termination (DOCUMENTED, §1.7.2).
- **Phase 4:**
  - Sort vertices along each component by parameter value. P¹ is cut at (1:0); the node of a nodal quartic has two parameter values; a smooth quartic is split into its connected components using the real roots of Δ.
  - Equal vertices (e.g. points on four quadrics) merge through union-find handles.
- **Data structure:**
  - Each vertex stores its quadrics and, per component, (parameterization, parameter value, previous, next). Explicit coordinates are stored when available.
  - Each component stores its quadrics and its sorted vertices.
  - Planned extension: Nef-style **sphere maps** per vertex, computed as the arrangement of conics on a small box around the vertex. For regular points the tangent planes suffice.
- NumeriX pieces used: `Sqrt_extension` (a multiplication costs 5 multiplications and 2 additions), modular square-free filter, modular gcd over Z and Z(α), and Bitstream Descartes. They were later packaged in CGAL.

## Robustness and guarantees

- The authors claim "complete" (all inputs, including singular and tangential cases), "exact" (always the mathematically correct result) and "efficient" (DOCUMENTED claims). There is no formal verification.
- Randomization:
  - The projection approach relies on random shears and restarts when genericity checks fail (Las Vegas).
  - The parameterization approach relies on Algorithm 4's unverifiable precondition (see above).
  - The EXACUS GAPS layer throws on violated preconditions.
- There are no tolerances anywhere. Coordinates are algebraic numbers.

## Parallelism and performance

- All implementations are single-threaded C++ with LEDA, CORE or GMP.
- **Sweep versus CGAL on cubic curves** (Pentium III-M 1.2 GHz):
  - 30, 60 and 90 random cubics: 6.7, 27.7 and 67.5 s (SoX) versus 8.0, 34.6 and 81.2 s (CGAL).
  - A pencil of 18 curves through 5 points: 1.7 s versus 4.3 s (ESA 2005, DOCUMENTED).
- **QuadriX projection** (Pentium M 1.7 GHz; quadric coefficients 89 bits, projected curves up to 329 bits):
  - Random instances: 25 quadrics → 6,574 edges in 32.3 s; 150 quadrics → 160,810 edges in 830 s. About **7 ms per edge**.
  - Degenerate instances: 150 quadrics → 171,314 edges in 3,247 s. About **25 ms per edge**.
  - Runtime grows about quadratically when the bit length grows linearly.
  - Caching makes the first planar map of a quadric the expensive one: 822 s versus 51 s for the second (SoCG 2005, DOCUMENTED).
- **DHPS versus projection** (Pentium M 1.7 GHz; thesis §1.9.3), on arrangements on the first quadric:
  - For random 50-bit quadrics, parameterization is **faster**, and the gap grows with bit size, even though its resultant coefficients grow 4.5x faster (4,500 bits versus 1,000 bits at 50-bit input).
    - The reason is MPFI plus the modular filter plus Bitstream Descartes: root isolation and matching become nearly bit-size independent.
    - At 170-bit inputs, exact resultant computation is about 70% of the runtime.
  - For degenerate instances (about 73 bits), parameterization is **slower**. Gcds over Q(√δ) with more bits are about 80% of the runtime.
  - The author does "not think that our approach will ever be faster" for degenerate inputs.
  - Plots cover up to about 90 quadrics, with axis ranges up to about 350 s (random) and 1,400 s (degenerate).

## Known failures, limitations, war stories

- No full 3D arrangement and hence no Booleans on quadric solids was delivered by either approach (DOCUMENTED, thesis §1.1.1 and §1.10).
- The parameterization approach does not extend beyond quadrics: there are no ruled quadrics in pencils of higher-degree surfaces. The projection approach is generic (DOCUMENTED, thesis §1.9.3 conclusions).
- Degenerate inputs are an order of magnitude or more slower. Unavoidable gcds dominate, and the cost is paid exactly where CAD models live (tangencies, shared points) (INFERRED from the benchmark shape).
- Algorithm 4 can silently mis-match or loop if its precondition fails.
- The earlier ESOLID system (Keyser et al.) required general position and could crash on degenerate inputs (DOCUMENTED in the thesis); see [esolid-exact-boundary-evaluation-for-low-degree-curved-solid.md](esolid-exact-boundary-evaluation-for-low-degree-curved-solid.md).
- The thesis cites "natural quadrics and tori make up to 95% of all mechanical pieces" (Requicha and Voelcker). This is a secondary, old claim: HEARSAY-grade.

## Relevance for wonky

- **Upper bound, not production path:**
  - Exact, degeneracy-complete *adjacency* for quadric arrangements is achievable, at roughly 7-25 ms per edge on 2005 hardware with big integers.
  - Coefficients grow to hundreds or thousands of bits.
  - It needs algebraic numbers over Q(√δ), gcd-heavy degenerate paths and irregular work.
  - This conflicts with wonky's uniform-work and speed goals and needs far more machinery than a plane/cylinder/cone kernel (INFERRED).
- **Ideas to port** (INFERRED unless noted):
  1. **Points identified by (component, exact parameter) and sorted along components.** This is the cleanest definition of the Boolean *imprint* on an intersection curve: every vertex on a curve is a root of a small univariate polynomial in that curve's parameter; sorting gives the edges.
     - For wonky's rational curves (lines, conics, rational cylinder/cone curves via DLLP), intersecting with a third plane or quadric is one univariate polynomial h(ξ), of degree ≤ 8 in the worst case (degree 2 for a line, 4 for a conic).
  2. **Certify inequality cheaply and equality only when needed.**
     - Run adaptive-precision interval boxes (F32x2 intervals first, multi-limb dyadic intervals next) with a *known* one-to-one correspondence.
     - When the correspondence cannot be proven, fall back to exact equality, or return `Unresolved`. Never loop.
     - wonky must make Algorithm 4's precondition checkable, e.g. by counting roots exactly with Sturm first.
  3. **One-root numbers.** For the common CAD degeneracies (tangent cylinders, cone apex on a surface), coordinates are often a + b√c with dyadic a, b, c. Exact comparison of such numbers needs only integer squaring. This is a cheap exact tier between F32x2 and general algebraic numbers.
  4. **Triples as the vertex generator.** In a Boolean between two solids, vertices arise from (face, face, face) triples, in practice (edge of A, face of B) and (edge of B, face of A). Computing all representations of one triple together enables batched matching. This fits fork-join over triples.
  5. **Jacobi curve for double roots.** Tangential crossings of two plane curves are separated by the transversal curve fx·gy − fy·gx. The same trick works in the parameter domain of pcurves.
  6. **Arithmetic hierarchy:** modular filter → interval filter → exact. NumeriX's lesson "arithmetic is the bottleneck, use the simplest number type" should become a stated principle for wonky's predicate layers.
- **Bend fit:**
  - Multi-limb U32 big integers exist.
  - Modular filters: primes below 2¹⁶ keep products inside U32.
  - Subresultant PRS and Descartes are pure recursions.
  - MPFI-style precision doubling is expressible as recursion over limb counts.
  - Obstacles: shared mutable caches and cross-linked roots with shared factorization knowledge (becomes pure memo maps keyed by polynomial hashes), union-find vertex handles (becomes an explicit merge pass), and highly non-uniform per-pair cost (CPU fork-join only, not GPU).
- **As a test oracle:**
  - For quadric-only configurations, an offline oracle could compute exact vertex counts and adjacency to check wonky's Boolean output. CGAL's Algebraic_kernel_d plus QI would be the realistic tooling, since EXACUS/QuadriX is not publicly obtainable.
  - It must stay outside production, per project rules. Using LGPL/non-commercial tools only in tests needs Marc's confirmation.
  - Cheaper and license-clean alternative: port DLLP Part II and the Wang-Tu classification for pairwise topology, and check triples with Sturm counts of h(ξ). See [wang-goldman-tu-2003-enhancing-levin-s-method-for-computing-.md](wang-goldman-tu-2003-enhancing-levin-s-method-for-computing-.md) and [dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md](dupont-lazard-lazard-petitjean-2008-near-optimal-parameteriz.md).
- **Hybrid Boolean link:** the leading prototype (a robust mesh Boolean decides topology; analytic SSI recovers the exact B-rep) can use idea 1. Snap each mesh-derived loop vertex to an exact root of h(ξ) on the analytic curve, then verify that the sorted exact order matches the mesh order. On a mismatch, fail explicitly.
  - Current state (working tree, 2026-09-24):
    - `kernel/hybrid/recover/geom.bend` certifies mesh boundary vertices against the exact curve by distance only. `cdist` is exact for lines and circles and a bound for ellipses.
    - Every vertex is an exact intersection of three carriers (docs/proto-recover.md). So two-carrier events, i.e. curve singularities such as the Steinmetz crossings, are currently `Unresolved`.
  - The DHPS vertex model (a component plus a parameter value that is a root of a small polynomial) also covers those two-carrier singular points. They are double roots of the curve's own discriminant, not roots of an h(ξ) against a third surface (INFERRED).

## Pointers worth porting or studying

- ESA 2005 §4 (NumeriX): number-type concept lattice, algebraic real representation, refinement API.
- ESA 2005 §6 (GAPS): arc-number representation, and curve and curve-pair analysis interfaces (Event1_info, Event2_slice).
- SoCG 2005 Theorems 3-5: one-root numbers, the Jacobi curve and the degree-8 three-quadric polynomials. §6: sheet assignment by ray shooting.
- Thesis §1.6: Algorithms 1-3 and Theorems 8-9, curve/quadric intersection with arc selection.
- Thesis §1.7.2: Algorithm 4 (matching) and its stated failure mode.
- Thesis §1.8: unifying equal components across pencils.
- Thesis §1.9.1: the phase structure and the vertex/component data layout.
- Thesis §1.9.3: benchmark methodology. Random, interpolated-degenerate and growing-bit families are worth copying for wonky's SSI stress tests.
- Thesis Ch. 2: generic modular gcd over Z and Z(α), and the CGAL algebraic-kernel design.
- CGAL `Algebraic_kernel_d` (LGPL-3.0+): study only, e.g. `Bitstream_descartes.h` for bit-adaptive root isolation.

## Verdict: learn-from

- This is the theoretical upper bound and a design source for an exact imprint stage: parameter-sorted vertices, interval-then-exact matching, one-root numbers and the arithmetic hierarchy.
- It is not a production path for wonky: heavy algebraic-number machinery, gcd-dominated degenerate cases, non-uniform work, no full arrangement or Boolean delivered, and code that is unavailable or under LGPL/non-commercial licences.
- Use it as a reference oracle concept and as a benchmark-design template.
