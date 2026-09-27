# Milenkovic & Milenkovic 1997: Rational Orthogonal Approximations to Orthogonal Matrices

- Kind: journal paper (conference version at CCCG 1993, pp. 485-491). Canonical: Computational Geometry: Theory and Applications 7(1-2):25-35, 1997, [ScienceDirect PII 0925772195000488](https://www.sciencedirect.com/science/article/pii/0925772195000488). Author copy actually read: [cs.miami.edu/~vjm/Papers/quat.ps.gz](http://www.cs.miami.edu/~vjm/Papers/quat.ps.gz) (PostScript "quatjrnl.ps", dated 1997-04-15), listed on [Milenkovic's paper page](https://www.cs.miami.edu/home/vjm/papers.html). Converted locally to `<repo>/tmp/research/pdf/milenkovic-1997-rational-orthogonal.pdf` (10 pages, all read).
- Authors: Victor J. Milenkovic (University of Miami), Veljko Milenkovic (engineering consultant, formerly Ford Motor Company).
- License: Elsevier journal copyright; the author PostScript is a personal copy. Mathematics only; reimplement and cite.
- Status: historical, foundational for exact rotations in CGAL-style kernels. No code released with the paper (experiments used Maple and C).

## What it is

Algorithms that approximate an arbitrary 3D rotation matrix M by an **exactly orthogonal matrix with rational entries** within a spectral-norm accuracy ε, with small bit size (common denominator). It generalizes Canny-Donald-Ressler from 2D to 3D through integer quaternions and shows that Euler-angle composition of 2D rational rotations costs about 3b bits where 1.5b suffice.

## How it works

- **Integer quaternion to rational rotation** (DOCUMENTED, §2.1, Eq. 4, "a theorem by Rodriguez"): for any nonzero integer quaternion `Q = Q0 + Q1 i + Q2 j + Q3 k`, the rotation matrix
  `(Q0²+Q1²+Q2²+Q3²)⁻¹ · [[Q0²+Q1²−Q2²−Q3², 2(Q1Q2−Q0Q3), 2(Q1Q3+Q0Q2)], [2(Q2Q1+Q0Q3), Q0²−Q1²+Q2²−Q3², 2(Q2Q3−Q0Q1)], [2(Q3Q1−Q0Q2), 2(Q3Q2+Q0Q1), Q0²−Q1²−Q2²+Q3²]]`
  is exactly orthogonal and rational, although the unit quaternion `Q/|Q|` is not rational. b'-bit components give `2b'+2`-bit numerators and a common `2b'+2`-bit denominator.
- **Robust quaternion extraction** (DOCUMENTED, §2.2, Eq. 5, after Shepperd 1978): the 4×4 matrix of `1 ± r11 ± r22 ± r33` and off-diagonal sums/differences equals `4 q qᵀ`; pick the row with the largest diagonal `4qi²` (equivalently the largest of `r00 = r11+r22+r33, r11, r22, r33`). Then `|4qi| ≥ 2`, and floating absolute error 3μ per component becomes at most **1.5μ** after normalization.
- **Accuracy transfer** (DOCUMENTED, Lemma 2.1): `|q' − q| ≤ ε/2` implies `‖M(q') − M(q)‖ ≤ ε + ε²/4`.
- **Three algorithms** (DOCUMENTED, abstract, §§2.3-3.2):
  1. `M2(M, ε)`: scale Q to length 1/ε and round each component to the nearest integer. Bit size `2b+2`, accuracy ε = 2^-b. A few dozen float operations.
  2. `Mν(M, ε)`: reduce to simultaneous Diophantine approximation `|αi − pi/p0| ≤ ε/(2√3)` of the three ratios `αi = Qi/Qmax`, solved with LLL basis reduction on `(1,0,0,0), (0,1,0,0), (0,0,1,0), (α1, α2, α3, −x)`. Accuracy `ε^(ν/1.5)` at bit size νb with `1.5 ≤ ν ≤ 6`, ν controlled only by retrying x. In practice ν ≈ 1.5.
  3. `Mopt(M, ε)`: integer programming (Lovász-Scarf generalized basis reduction). Proven optimal bit size **at most 1.5b** (Lemma 2.2: 0.75b-bit quaternion components exist by a pigeonhole/lattice argument); within one bit of optimal.
- **Converse** (DOCUMENTED, Lemma 2.3, credited to Fortune): every rational rotation matrix with a 2b-bit common denominator comes from an integer quaternion of at most b bits. So integer quaternions parametrize **all** of SO(3, Q); nothing is lost by storing placements as integer quaternions.

## Robustness and guarantees

- DOCUMENTED: exact orthogonality (M Mᵀ = I in rational arithmetic) for every output; accuracy ε in the operator norm; bit-size bounds 2b+2 (M2), ≤1.5b optimal (Mopt), heuristic ≈1.5b (LLL).
- DOCUMENTED §1.1: the motivation is physical realizability: "if the approximate matrices are strictly orthogonal, the output is guaranteed to be physically realizable"; a solid modeler needs "fast integer arithmetic for geometric constructions, rational Euclidean transformations, and geometric rounding".
- DOCUMENTED §1.1: exact rational pipelines grow bit complexity (three planes to a point, three points to a plane each treble bits); rounding is unavoidable later, and minimum-perturbation topology-preserving rounding is NP-complete (Milenkovic-Nackman).
- INFERRED: the quaternion map is 2-to-1 (Q and −Q), and rotation by 180° needs Q0 = 0: fine for integers. Finite-order rational rotations exist beyond order 4 in 3D (order 3 and 6 about (1,1,1), for example the cyclic coordinate permutation), but not about an arbitrary user axis; a 90° rotation about axis a is rational only if a/|a| is rational (a Pythagorean quadruple direction), while 180° about any integer axis a is rational (`2aaᵀ/|a|² − I`).

## Parallelism and performance

- DOCUMENTED §3.3: the LLL-style heuristic took on average 7.6 iterations and about 0.01 s per matrix at 1e-6 on a DEC Alpha 3000/700; measured `−log ε` averaged 22.0 against the theory's `(4/3) log p0` = 21.99 over 1000 random inputs. Maple LLL at 1e-6 took "a few seconds" on a 30 MIPS workstation.
- MEASURED here (local re-implementation of M2, `tmp/research/frames-trig/rational-rotation-bits.mjs`, 500 random axes/angles, exact BigInt check of `M Mᵀ = den² I`):

| ε | quaternion component bits | common denominator bits | exactly orthogonal |
|---|---:|---:|---|
| 2^-24 | ≤ 25 | ≤ 51 | all |
| 2^-32 | ≤ 33 | ≤ 67 | all |
| 2^-40 | ≤ 41 | ≤ 83 | all |
| 2^-44 | ≤ 45 | ≤ 91 | all |

  With the 1.5b optimum, ε = 2^-40 needs about 30-bit quaternion components (one U32 limb plus sign) and 62-bit matrix entries (two limbs). INFERRED from Lemma 2.2, not measured.

## Known failures, limitations, war stories

- DOCUMENTED: the LLL method cannot target ε directly; worst case accuracy ε⁴ at 6b bits.
- DOCUMENTED: bit growth under composition: the product of two rational rotations has the product of the denominators (quaternion product: component bits add). A chain of placements (pattern of a pattern, nested `opTransform`) grows limbs linearly; re-approximation of the composite breaks exact relations between the chain's members.
- INFERRED: the paper handles the matrix only. Translations must be rational too, and applying the rotation to vertices yields denominators `den·2^k` that cannot be stored back in F32x2 without rounding; the paper's own §1.1 calls for "geometric rounding" afterwards.

## Relevance for wonky

- **Frames and placements:** wonky's recurring failures ("Plane frame is not orthonormal", `NonRigidRotation`, carrier unification at `2^-44·scale`) come from frames that are orthonormal only within a tolerance. An integer quaternion (4 small integers) plus a dyadic translation is a placement that is **exactly** rigid; its matrix is computed exactly with multi-limb U32 integers. Coplanarity of two carriers derived from one source plane under two placements can then be decided exactly: compare `(P2⁻¹P1)` applied to the source plane with the source plane, in integers.
- **Bend fit:** very good for M2. Construction is Shepperd extraction (a max over four F32x2 values), a scale by a power of two, and nearest-integer rounding into U32 limbs: fixed-size, branch-light, uniform. Matrix entries are sums of products of ≤ 45-bit integers: fixed 3-limb arithmetic. LLL/IP (1.5b) are sequential and data-dependent; keep them on the host or out of scope.
- **Precision mapping:** F32x2 carries about 48 bits, so a 2^-44 quaternion from F32x2 input is meaningful; the input quaternion itself must first be computed (from axis and angle) with a stated error, which for typed special angles can be exact (addendum §4).
- **Where not to use it:** circular patterns about arbitrary axes (a rational 72° step does not close after 5 steps); mesh-level recovery tolerances that are unrelated to placement.

## Pointers worth porting or studying

- Eq. 4 (integer quaternion to rational matrix), Eq. 5 with the max-diagonal row choice, Lemma 2.1 (accuracy transfer), Lemma 2.3 (converse: every rational rotation is an integer quaternion).
- §2.3 last paragraph: reduction to simultaneous approximation with `ε/(2√3)`.
- §3.3: the simple greedy basis-reduction loop (only if 1.5b bit sizes matter).

## Verdict: adapt

Adopt the integer-quaternion representation (M2, 2b+2 bits) as the exact form of arbitrary 3D rotations that must be rigid by construction, with ε and the angle change recorded. Skip LLL/IP unless limb counts become the bottleneck. Pair it with symbolic group elements for patterns and exact special-angle recognition (addendum).
