# Bahrdt & Seybold 2017: Rational Points on the Unit Sphere (approximation complexity and practical constructions)

- Kind: paper (arXiv improved-analysis version of an ISSAC 2017 paper) plus a C++ library. Canonical: [arXiv 1707.08549](https://arxiv.org/abs/1707.08549) (v1, 2017-07-26; "Improved Analysis" of the ISSAC '17 paper, its ref. [1]). Library: [github.com/fmi-alg/libratss](https://github.com/fmi-alg/libratss). Local PDF: `<repo>/tmp/research/pdf/arxiv-1707.08549-rational-unit-vectors.pdf` (13 pages, all read).
- Authors: Daniel Bahrdt, Martin P. Seybold (FMI, University of Stuttgart).
- License: paper under arXiv's non-exclusive license. libratss README: **LGPL v2.1**, and binaries linking MPFR/GMP/CGAL "are usually governed by the GPL v3". INFERRED: reimplement the method; do not copy code.
- Activity (DOCUMENTED, `gh api`, 2026-09-24): libratss 0 stars, 1 fork, 3 contributors, last commit 2024-04-04, no SPDX license detected by GitHub (README states LGPL-2.1). Research code, depends on GMP/MPFR.

## What it is

A method to snap any point of R^d to a rational point **exactly on** the unit sphere S^(d−1) within ε, with small denominators, plus a theorem that binary floating point cannot do it. Surfaced for wonky because [CGAL issue #6459](https://github.com/CGAL/cgal/issues/6459) proposes it as a faster replacement for `rational_rotation_approximation` (the unit vector of a direction gives cos and sin directly).

## How it works

- **Floats are insufficient** (DOCUMENTED, Theorem 3, §3.1): every float (any precision, any exponent range) is a dyadic rational `z/2^i`. The only such points on S¹ are the 4 poles `(±1, 0), (0, ±1)`, and on S² the 6 poles. Proof: mod-4 argument on odd numerators (`y² ≡ 1 mod 4` for odd y); nontrivial dyadic solutions need d ≥ 4. Scaling carries over to spheres of radius 2^j.
- **Stereographic snapping** (DOCUMENTED, §2, §3.2, Algorithm 1 PointToSphere): rotate coordinates so the projection pole is opposite the smallest-magnitude coordinate (`x_d = min_i −|x_i|`), project `τ(x) = (x_1/(1−x_d), …)` into the unit ball of R^(d−1), approximate τ by a rational y within `ε/(2√(d−1))` per coordinate, return `σ(y) = (2y_1/(1+S²), …, (S²−1)/(1+S²))` with `S² = Σ y_j²`, which lies exactly on the sphere.
- **Error** (DOCUMENTED, Lemma 2, Theorem 4): σ is 2-Lipschitz on the ball, so the result is within ε (max-norm) of `x/|x|`.
- **Denominators** (DOCUMENTED, Lemma 3, Theorem 5): with common denominator Q for y, all images have denominators ≤ 2Q²; fixed-point snapping gives denominators ≤ `10(d−1)/ε²`. With continued fractions on S¹, ε = 1/q² gives denominators ≤ 2q². Simultaneous Diophantine approximation (Jacobi-Perron, LLL) shrinks them further (Corollary 1).
- Related facts cited (DOCUMENTED, §1-2): Niven's theorem (the only rational values of sine at rational multiples of π are 0, ±1/2, ±1); Chebyshev U_n roots are `cos(πk/(n+1))`; Liouville's lower bound for algebraic numbers (explicit constant for cos 108°).

## Robustness and guarantees

- DOCUMENTED: exactness on the sphere is structural (rational identity), independent of how y was computed; only the distance to the target depends on the approximation.
- DOCUMENTED Table 1 (S², e significand bits for y): fixed-point e = 31 gives about 62-bit denominators (Jacobi-Perron about 45 bits) and mean error 2.7e-3 m on Earth-radius data (relative about 4e-10); e = 53 gives 106-bit (fx) or 77-bit (jp) denominators, error 6.3e-10 m (relative about 1e-16).
- Limitation: exact on the sphere, not a rotation; orthonormal frames need two or three mutually orthogonal rational unit vectors, which this method does not construct jointly (INFERRED; use a rational rotation instead, whose columns are such a frame).

## Parallelism and performance

- DOCUMENTED Table 1 (one core Xeon E5-2650v4, GMP/MPFR): 16-19 µs per S² point (fixed-point), 57-118 µs (Jacobi-Perron); S⁹ ~117 µs, S⁹⁹ ~550 µs. Table 2: constrained spherical Delaunay of 669 M OSM segments took 12 h and 545 GiB (mostly GMP storage overhead).
- Per point the work is uniform (fixed-point variant): a projection, a rounding, a rational σ evaluation. INFERRED: maps well to fork-join and GPU if limbs are fixed.

## Known failures, limitations, war stories

- DOCUMENTED §6: denominators above 64 bits are the practical pain; the authors want ≤ 64-bit storage.
- DOCUMENTED §2.1: for points with algebraic coordinates like cos 108°, Liouville bounds how well small denominators can approximate; no free lunch at special angles that are irrational.

## Relevance for wonky

- **Theorem 3 is the key negative result for wonky's frames:** no F32 or F32x2 unit normal other than a signed coordinate axis has norm exactly 1. So "unit normal", "orthonormal frame" and "|n·x| = 0" can hold exactly in F32x2 only for axis-aligned frames (and signed permutations). Every other frame is orthonormal only within a tolerance; wonky's `angular_guard`-based `InvalidFrame`/`NonRigidRotation` checks are therefore necessary, not sloppiness. Exactness for tilted frames needs either non-unit representations (plane `a·x = d` with integer a, never normalized; this is what exact predicates want anyway) or rational unit vectors with multi-limb denominators.
- **Practical design consequence (INFERRED):** store carriers unnormalized (integer or dyadic normal, not unit) so that coplanarity and parallelism are exact determinant tests; normalize only for display, distances and tolerances. For frames that must be rigid, use rational rotations (integer quaternions), whose columns are exactly orthonormal rational vectors.
- Bend fit: the fixed-point snapping is uniform integer work (one rounding, a handful of multiplications, fixed limbs), so it fits Bend; the Jacobi-Perron/LLL refinements do not need to be ported.

## Pointers worth porting or studying

- Theorem 3 proof (§3.1): cite it in wonky's numeric model docs.
- Algorithm 1 and Lemma 3 (denominator bound 2Q²); Figure 2 (error vs denominator bits for fixed-point vs Jacobi-Perron).
- libratss `include/libratss/ProjectS2.h`, `ProjectSN.h`, `SimApxLLL.h` (not read in detail; LGPL).

## Verdict: learn-from

Adopt Theorem 3 as a design axiom (non-axis F32x2 frames are never exactly orthonormal) and the stereographic snapping as the tool for rational unit normals if wonky ever needs them; placements themselves are better served by integer quaternions.
