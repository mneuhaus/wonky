# CGAL rational_rotation_approximation (Kernel_23)

- Kind: library source code plus docs. File actually read: [Kernel_23/include/CGAL/rational_rotation.h](https://github.com/CGAL/cgal/blob/master/Kernel_23/include/CGAL/rational_rotation.h) (250 lines, local copy `<repo>/tmp/research/cgal-rational-rotation/rational_rotation.h`). Used by `Aff_transformation_2(ROTATION, Direction_2 d, RT num, RT den)` ([CGAL Kernel manual](https://doc.cgal.org/latest/Kernel_23/classCGAL_1_1Aff__transformation__2.html)).
- Author: Stefan Schirra; copyright 1999 Utrecht, ETH Zurich, INRIA, MPI Saarbrücken, Tel-Aviv.
- License: `SPDX-License-Identifier: LGPL-3.0-or-later OR LicenseRef-Commercial` (file header). INFERRED: copying code into private wonky is possible under LGPL, but the algorithm is 60 lines of mathematics; reimplement from Canny-Donald-Ressler instead and avoid LGPL obligations if wonky is ever distributed.
- Activity (DOCUMENTED, `gh api`, 2026-09-24): CGAL repo 6,055 stars, 1,593 forks, last push 2026-09-21. This file: last commits 2021-04-07 ("I should buy glasses"), 2021-04-06 (remove local reference), 2020-03-26 (whitespace). Mature, dormant.

## What it is

Two overloads that return integers `(sin, cos, den)` with `sin² + cos² = den²` exactly, approximating either the direction of an exact vector `(dirx, diry)` or a `double` angle, with a quality bound `eps_num/eps_den` on the sine (not on the angle).

## How it works

- DOCUMENTED (lines 26-134, direction overload): reduce to the first octant (`|dy| ≤ |dx|`), then a **Stern-Brocot / Farey mediant loop**: start `p0/q0 = 0/1`, `p1/q1 = 1/1`; repeatedly form the mediant `p = p0+p1, q = q0+q1`, candidate `sin = 2pq`, `den = p²+q²`; accept when `|sin/den − dy/√(dx²+dy²)| < n/d`, tested **exactly** by squaring (`common_part ± diff_part` against `rhs`, all in NT); otherwise move the bracket. Result `cos = q² − p²`; swap and sign-fix for the octant.
- DOCUMENTED (lines 137-247, angle overload): same loop, but the comparisons use `CGAL::to_double` and `std::sin/std::cos` of the double angle ("XXX sanity check"), so it is only as exact as double.
- The commented-out branch halves `(sin, cos, den)` when p, q are both odd (the gcd-2 case of CDR Lemma 1); it is disabled, so results can carry a spare factor 2.

## Robustness and guarantees

- DOCUMENTED: output is an exact Pythagorean triple, so the transformation is exactly orthogonal in the kernel's number type. The bound is on the sine difference, `< eps_num/eps_den`.
- DOCUMENTED weakness: the plain mediant walk needs O(q) iterations (not O(log q) like CDR's continued-fraction speedup, which CGAL does not implement). The CGAL Nef note already records 0.01 s at 10^-1°, 4.47 s at 10^-4° and 450 s at 10^-6° (Hachenberger thesis Table 6.1; see [cgal-nef-polyhedron-3 note](cgal-nef-polyhedron-3-and-hachenberger-kettner-mehlhorn-bool.md)).
- No 3D analogue exists in the file; `Aff_transformation_3` takes user-supplied rational matrices.

## Parallelism and performance

- Sequential loop; with lazy exact number types each iteration extends a DAG. DOCUMENTED user report: [issue #6459](https://github.com/CGAL/cgal/issues/6459) (open, 2022) measured the stereographic-projection method of Bahrdt-Seybold at about 160 ns per pair versus about 10 ms for `rational_rotation_approximation` at tolerance 1e-9 (10,000 pairs), with about 30-bit denominators for both (HEARSAY-grade: user benchmark attached as test.cpp.gz, not reproduced).

## Known failures, limitations, war stories

- DOCUMENTED: [issue #6110](https://github.com/CGAL/cgal/issues/6110) (open): `Aff_transformation_2(ROTATION, dir, 1, 1e16)` with the Epeck kernel overflows the stack in a worker thread, because the mediant loop builds a huge `Lazy_exact_nt` DAG whose destruction is recursive (same bug as #1118). A maintainer (afabri) states the design mistake: it should run on `Interval_nt` and switch to exact rationals only on filter failure, producing a single DAG node.
- DOCUMENTED: the angle overload trusts `std::sin` of a double; any angle the user meant as exactly 90° arrives as `1.5707963267948966` and is treated as such.

## Relevance for wonky

- Confirms the CDR representation in a production library and shows the two engineering traps: O(q) mediant loops and computing the approximation inside a lazy exact DAG. In Bend the search must be a bounded CF loop over fixed U32 limbs, run once per placement, never inside a deferred-evaluation structure.
- The direction overload is the useful variant for wonky: a sketch or plane frame often arrives as a direction vector (FS `plane.x`, edge directions), not as an angle; the exact squared comparison `(sin²d² + n²den²)·h ∓ 2n·sin·d·den·h` vs `dy²d²den²` is a good template for an exact multi-limb acceptance test.
- Bend fit: acceptance test is fixed-degree integer polynomial arithmetic (uniform, fork-join friendly); the walk length varies per input (host or scalar Bend).

## Pointers worth porting or studying

- Lines 57-118: the exact acceptance test by squaring, and the bracket update.
- The disabled halving branch (lines 88-97): turn it on in a port to keep denominators minimal.
- Issue #6110 maintainer comment on interval-first evaluation.

## Verdict: learn-from

Reference implementation of the CDR idea with known performance traps. Port the idea with CDR's continued-fraction speedup and an exact acceptance test; do not copy the LGPL code.
