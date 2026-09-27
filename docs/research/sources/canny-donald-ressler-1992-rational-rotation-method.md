# Canny, Donald, Ressler 1992: A Rational Rotation Method for Robust Geometric Algorithms

- Kind: peer-reviewed conference paper. Canonical: [ACM DL, DOI 10.1145/142675.142726](https://doi.org/10.1145/142675.142726). Author PDF actually read: [people.eecs.berkeley.edu/~jfc/papers/92/CDRscog92.pdf](https://people.eecs.berkeley.edu/~jfc/papers/92/CDRscog92.pdf). Local copy: `<repo>/tmp/research/pdf/canny-donald-ressler-1992-rational-rotation.pdf` (10 pages, all read).
- **DOI correction:** the brief's hint named `10.1145/142675.142719`; the ACM DL record for this title is `142675.142726` (DOCUMENTED, ACM DL search result).
- Authors: John Canny (UC Berkeley), Bruce Donald and Eugene K. Ressler (Cornell). Proc. 8th ACM Symposium on Computational Geometry (SoCG), Berlin, June 1992, pp. 251-260.
- License: ACM copyright 1992; the PDF carries ACM's "copy without fee for non-commercial use" notice. The algorithms are mathematics: reimplement independently, cite. The Common Lisp listings (Figures 4, 7) are short and not needed verbatim.
- Status: historical, widely cited (Milenkovic 1997, CGAL's `rational_rotation_approximation`, Hoffmann 1989 already had the tan(θ/2) idea). No repository, stars or issues apply.

## What it is

A method to replace an arbitrary 2D rotation angle θ by a nearby angle θ' whose sine and cosine are **both rational**, so that the rotation is an exact isometry in rational arithmetic ("pure rotation", no scaling). The paper argues (DOCUMENTED, pp. 251-252) that rounding sin θ and cos θ independently gives `(1 + δs)·A(θ + δθ)`: the angle error δθ is harmless (a nearby physical configuration), but the scale error δs is not, because it breaks rigidity (lengths, distances and areas compared between rotated and unrotated objects).

## How it works

- **Rational points on the unit circle** (DOCUMENTED, §6): every rational sine is `S = 2pq/(p²+q²) = 2/(t + 1/t)` with `t = p/q` rational; the cosine is `(q²−p²)/(p²+q²)` (Pythagorean triple `a = m²−n², b = 2mn, c = m²+n²`). `t` is the tangent (or cotangent) of the half angle. §10 notes this is the rational parametrization of a genus-0 conic.
- **Specification** (DOCUMENTED, §1, §3): input θ and tolerance εθ; output rational S with (1) `|asin S − θ| < εθ`, (2) `√(1−S²)` rational, (3) S at most **one bit longer** than the shortest rational sine meeting (1) and (2). "Length" is the denominator magnitude; bits = bits of the denominator.
- **Algorithm** (DOCUMENTED, §§5-8, Figures 2-7):
  1. Figure 1: a brute-force table of short rational sines, one per integer degree 0..45 (for example 16° ≈ 7/25, 37° ≈ 3/5, 28° ≈ 8/17, 45° ≈ 697/985). Exhaustive search over `0 ≤ a ≤ b < 1000` found 159 pairs; most integer degrees get a 3-digit sine within 0.3°, except within 2° of multiples of 90°.
  2. Figure 2: an ad hoc iterative correction `S := S·Ω(k) ± Ω(S)·k` with `Ω(x) = √(1−x²)`; converges fast but gives about twice the optimal bits.
  3. Final method: compute `x = 1/sin θ + √(1/sin²θ − 1)` (the exact but irrational t), then approximate x by a rational with a continued-fraction (Euclid) or Farey-mediant search. Figure 7 `rat(x0, x1)` returns the **smallest rational in an interval** (a CF walk that stops mid-run of Farey mediants), and `rat-sin(a0, a1)` returns `2/(t + 1/t)` for the interval of t corresponding to `[a0, a1]`.
  4. Claim/proof (§8, Lemmas 1-2): if t is the shortest rational in the interval, S is at most 1 bit longer than the shortest rational sine; key fact `gcd(2pq, p²+q²) ≤ 2` for coprime p, q.
- **Numeric model** (DOCUMENTED, §1, §8): the reference code evaluates error terms in double precision and "performs well for εθ ≥ 1e-10"; all double arithmetic "can be replaced by rational arithmetic" (sine series, Newton square root) for any precision. Complexity O(n) iterations for n = log(1/ε) bits, O(n² log n log log n) with fast multiplication; the result denominator has about n bits.
- **Scaled rotations** (DOCUMENTED, §9): if only the un-rotated output matters (sweep in an arbitrary direction, perturbation), a rotation-with-scaling needs about half the bits and is exactly invertible, but it must not be used when distances, areas or volumes are compared across rotated and unrotated data.

## Robustness and guarantees

- DOCUMENTED: the returned rotation is **exactly orthogonal** in rational arithmetic; the only approximation is the angle, bounded by εθ. Shortness is within one bit of optimal (proved). Euclid's plain algorithm (Figure 3, Common Lisp `rationalize`) does **not** always return the shortest rational; the fix is to stop inside a Farey run (Figure 7).
- DOCUMENTED limitation: the bracket is computed in double precision in the published code, so εθ below about 1e-10 needs exact or extended evaluation of the target.
- INFERRED: exactness at special angles holds only where sin and cos are rational: multiples of 90° and Pythagorean angles (atan(3/4) etc.). 30°, 45°, 60° have irrational sines (Niven's theorem, see the Bahrdt-Seybold note), so they are approximated like any other angle.

## Parallelism and performance

- DOCUMENTED: "a few milliseconds" per sine on 1992 Lisp workstations; no tables beyond that. The algorithm is sequential per angle (a CF loop of data-dependent length) but angles are independent.
- MEASURED here (INFERRED numbers from a local re-implementation, `tmp/research/frames-trig/rational-rotation-bits.mjs`, 2000 random angles in (0, π/2), smallest rational in the tan(θ/2) interval, BigInt exact output):

| εθ | mean denominator bits | max bits | max angle error |
|---|---:|---:|---:|
| 2^-24 | 24.8 | 37 | 6.0e-8 |
| 2^-32 | 32.9 | 45 | 2.3e-10 |
| 2^-40 | 40.8 | 53 | 9.1e-13 |
| 2^-44 | 44.8 | 55 | 5.7e-14 |
| 2^-46 | 46.9 | 59 | 1.4e-14 |

  At 2^-40, 30° becomes `637815097923/1275630195845` (41 bits). Outliers come from intervals close to a rational with small denominator (Farey gaps).

## Known failures, limitations, war stories

- DOCUMENTED (§4): no 3-digit rational sine exists within 2° of multiples of 90° (except exactly at them); small angles need long denominators relative to their size.
- DOCUMENTED (§9.3): without pure rotations the edges of a rotated polygon change length, which breaks visibility-graph consistency; that is the "rigid copy is not rigid" failure.
- INFERRED: composing k rational approximations of 360°/N does not give the identity at k = N unless the rotation is exactly of order N; in SO(2, Q) only orders 1, 2 and 4 exist (a finite-order rotation needs rational cos(2π/N), which by Niven means N ∈ {1, 2, 3, 4, 6}, and N = 3, 6 need sin = ±√3/2). So a rational 60° step does not close a 6-fold pattern.
- The 3D extension via Euler angles triples the bit size (Milenkovic 1997, DOCUMENTED there); use integer quaternions instead.

## Relevance for wonky

- **Where it plugs in:** `rotationAround` / `opTransform` / `opPattern` placements (src/library.mjs builds the matrix from `Math.cos/Math.sin` in f64; kernel/polygon-prism.bend `transform` checks orthonormality only within `10 × angular_guard`). A rational rotation makes "rigid" a structural fact rather than a tolerance.
- **Bend fit:** good. A 2D rational rotation at εθ = 2^-40 is three integers of about 41 bits: two U32 limbs each. Applying it to exact dyadic coordinates (every F32x2 value is a dyadic rational) yields exact rationals with denominator `d·2^k`; that is multi-limb integer work with fixed limb counts, uniform per vertex, fork-join over vertices. The continued-fraction search itself is data-dependent and should run once per placement on the host or in a scalar Bend function; it does not need F64 if the bracket is computed from F32x2 tan(θ/2) with a stated error, or exactly from degrees (below).
- **Precision mapping:** the paper's doubles only bracket the target. In wonky the bracket can come from F32x2 (about 2^-44 absolute today, see the addendum) or, better, from exact degree rationals for typed angles; the output is exact integers.
- **What it does not solve:** the rotated coordinates are rational with big denominators; storing them as F32x2 words rounds again. The benefit appears only where wonky keeps carriers or placements symbolic (plane `n·x = d` with rational n, d) and decides coplanarity/coaxiality exactly on them.
- **LLM ergonomics:** users type 30°, 45°, 90° in FeatureScript; approximating 30° by a 41-bit rational is invisible to them and keeps rigidity exact, but it silently changes the angle by up to εθ. That change must be recorded (exactness label, as `frameRegularization` already does).

## Pointers worth porting or studying

- §6 equation `S = 2/(t + 1/t)` and footnote 3 (odd b); §8 Lemma 1 `gcd(2pq, p²+q²) ≤ 2`.
- Figure 7 `rat(x0, x1)`: smallest rational in an interval with the Farey-run stopping fix. This is the piece to port (U32 multi-limb CF loop).
- Figure 1: per-degree short rational sines (useful as test fixtures).
- §9.4: integer-only transform pipeline for graphics, a model for a U32 path.

## Verdict: adapt

Adapt the tan(θ/2) rational parametrization and the smallest-rational-in-interval search for 2D placements (sketch rotations, rotations about coordinate axes) where wonky wants exact rigidity. Do not use it for circular patterns that must close (N ∉ {1, 2, 4}); those need symbolic group elements (addendum). For general 3D axes prefer Milenkovic's integer quaternions.
