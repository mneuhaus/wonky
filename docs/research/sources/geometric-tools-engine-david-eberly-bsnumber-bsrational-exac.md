# Geometric Tools Engine (David Eberly): BSNumber/BSRational exact arithmetic and intersection queries

- **Kind:** header-only C++14 library (GTMathematics), plus PDF derivations. Canonical URL: https://github.com/davideberly/GeometricTools
- **Other URLs:**
  - Site and documents: https://www.geometrictools.com/
  - Successor library GTL (same author, BSL-1.0, 16 stars, pushed 2026-09-19): https://github.com/davideberly/GeometricToolsLibrary. It keeps the same arithmetic stack under `GTL/Mathematics/Arithmetic/` and adds `APInterval.h` (arbitrary-precision intervals).
  - Unit tests live in a separate repo: https://github.com/davideberly/GeometricToolsUnitTests
  - PDFs read for this note (local copies in tmp/research/pdf/):
    - "GTE: Arbitrary Precision Arithmetic", 45 pp, created 2014-11-25, modified 2020-09-11: https://www.geometrictools.com/Documentation/ArbitraryPrecision.pdf (`gte-ArbitraryPrecision.pdf`)
    - "Robust Intersection of Ellipses", 15 pp, 2023-06-16: https://www.geometrictools.com/Documentation/RobustIntersectionOfEllipses.pdf
    - "Intersection of a Cylinder and a Plane", 7 pp, 2007, modified 2024-07-23: https://www.geometrictools.com/Documentation/IntersectionCylinderPlane.pdf
    - "Intersection of Cylinders", 7 pp, 2000, modified 2024-12-24: https://www.geometrictools.com/Documentation/IntersectionOfCylinders.pdf
    - "Low-Degree Polynomial Roots", 1999, modified 2023-07-28: https://www.geometrictools.com/Documentation/LowDegreePolynomialRoots.pdf
  - Also online, not read here: ClassifyingQuadrics.pdf, IntersectionLineCone.pdf, IntersectionOfEllipsoids.pdf. `QuadraticFields.pdf`, which `QFNumber.h` cites, returns HTTP 404 (DOCUMENTED, checked 2026-09-22).
  - Book: D. Eberly, *Robust and Error-Free Geometric Computing*, CRC Press 2020. Not read here; the PDFs call it the revised and expanded form of this material.
- **Author:** David Eberly (Geometric Tools, Redmond WA). Code lineage goes back to 1998 (WildMagic). The GitHub repo was created 2020-09-15.
- **License:** code is under the Boost Software License 1.0 (DOCUMENTED: `LICENSE` and every file header). The PDFs are CC BY 4.0.
  - BSL is permissive. Wonky may translate the code logic into Bend with no copyleft effect.
  - The only obligation: source copies of substantial portions must keep the BSL notice. A Bend transliteration of, say, `UIntegerALU32` should carry a one-line attribution plus the BSL text.
- **Status:** active. Checked with `gh api` on 2026-09-22 (DOCUMENTED):
  - 1,386 stars, 247 forks, 12 contributors, 3 open issues;
  - last commit 2026-09-20 ("Fixed compile breaks.");
  - no GitHub releases. Versioning is per file (`File Version: 8.0.YYYY.MM.DD`).
  - `GTE/Mathematics` has 564 headers.
  - A wave of about 50 small bug-fix PRs landed in February 2026, #113-#167. Several touched BSNumber, see "Known failures".
  - Shallow clone at tmp/research/geometric-tools-engine-david-eberly-bsnumber-bsrational-exac/repo, commit 2146f16.

## What it is

A large toolbox of geometric queries, most of them templated on the scalar type:

- distance (`DCPQuery`), test-intersection (`TIQuery`), find-intersection (`FIQuery`);
- approximation, containment, root finding, triangulation.

Most algorithms are written so that `T` can be `float`, `double` or an exact type. The exact types are:

- `BSNumber<UInteger>`: exact ring arithmetic (+, -, *), no division;
- `BSRational<UInteger>`: exact field arithmetic;
- `QFNumber<T,N>`: exact arithmetic in quadratic fields, i.e. x0 + x1*sqrt(d), nested for N square roots.

Eberly's design stance is "exact decisions via exact types, no epsilons". In issue #88 he wrote: "Adding 'epsilon' in the algorithms is a rabbit hole I choose not to go down... I prefer the rational number approach." (https://github.com/davideberly/GeometricTools/issues/88, DOCUMENTED.)

It is **not** a B-rep kernel:
- no solids, no curved Booleans;
- the only polygon Boolean is a 2D BSP (`BSPPolygon2.h`);
- no quadric-quadric find-intersection. Eberly on cylinder-cylinder: "a Quadratically Constrained Quadratic Program. I do not have a general solver for this" (issue #99).

## How it works

### 1. BSNumber: binary scientific numbers (BSNumber.h, ArbitraryPrecision.pdf section 3)

**Representation**
- A nonzero value is `sign * u * 2^b`:
  - `sign` is in {-1, +1};
  - `u` is a **positive odd** unsigned big integer (`UInteger`);
  - `b` is an int32 "biased exponent".
- Zero is sign 0, b 0, and an empty integer.
- The odd-mantissa invariant makes the representation canonical, so equality is `b0 == b1 && u0 == u1` (BSNumber.h lines 744-747).

**Operations**
- **Multiply:** `u = u0*u1`, `b = b0 + b1`. The product of two odd numbers is odd, so no normalization is needed. PDF eq. 2-3.
- **Add** (lines 764-796):
  - let d = b0 - b1. If d > 0, shift u0 left by d and add u1; the result keeps exponent b1.
  - If d = 0, the sum of two odds is even: add, then `ShiftRightToOdd` and add the shift to the exponent.
  - Rounding never happens.
  - Bit count of a sum (eq. 11): `max(p,q) - min(p-n, q-m) + 2`. The bits span from the lowest set bit of either operand to one past the highest.
- **Subtract:** compare magnitudes, then subtract the smaller from the larger by two's complement plus add (lines 799-831; ALU `Sub`). The precondition n0 > n1 is asserted.
- **Division** does not exist in BSNumber.

**Float conversion**
- `ConvertFrom<IEEE>` (lines 835-907) extracts sign/exponent/trailing bits, shifts the trailing zeros away, and stores the odd significand.
  - Every finite float or double is exactly representable.
  - Inf maps to 2^(bias+1) and NaN maps to 0, unless `GTE_THROW_ON_CONVERT_FROM_INFINITY_OR_NAN` is set. This is silent by default.
- `ConvertTo<IEEE>` (lines 911-1042) rounds to nearest, ties to even, using `GetPrefix` (top 64 bits) plus a sticky check.
- `Convert(input, precision, roundingMode, output)` (lines 1070-1237) rounds to any bit precision with FE_TONEAREST, FE_UPWARD, FE_DOWNWARD or FE_TOWARDZERO.
  - This is **directed rounding in software**. It is how to get certified lower and upper F32 bounds of an exact value.

**Pitfall:** the `std::sqrt/sin/cos/exp/...` overloads for BSNumber (lines 1240-1422) just go through `double`. They are silently inexact. Only +, -, *, comparisons and conversions are exact (DOCUMENTED).

### 2. UInteger storage and ALU (UIntegerALU32.h, UIntegerAP32.h, UIntegerFP32.h)

**Storage classes.** One CRTP ALU is shared by two storage classes:
- `UIntegerAP32`: a `std::vector<uint32_t>`, arbitrary precision;
- `UIntegerFP32<N>`: a `std::array<uint32_t, N>` plus `mSize` and `mNumBits`, fixed precision.

**ALU routines.** They are schoolbook and in-place:
- `Add` (lines 138-206);
- `Sub` via two's complement (208-293);
- `Mul`, O(N^2) (295-377);
- `ShiftLeft` (381-439);
- `ShiftRightToOdd` (445-500);
- `RoundUp` (507-513);
- `GetPrefix` (520-571).

**Carries.** All carries and partial products use `uint64_t`, for example `term = block0 * n1Bits[i1] + carry`. The PDF (section 3.4) states the assumption: "embed the N-bit unsigned integer operands in a native type with 2N bits".

**Comparisons.** They assume both operands are aligned at the leading 1-bit (`1.u*2^p` vs `1.v*2^p`). They are not general integer comparisons (lines 24-117).

**Speedups.** Karatsuba and FFT multiplication are mentioned in PDF section 9 as not implemented.

### 3. BSRational (BSRational.h)

- A BSRational is a pair of BSNumbers with a positive denominator.
- `+`, `-`, `*`, `/` are cross-multiplication (lines 472-545).
- **There is no GCD reduction.** The only normalization is the power-of-two one inside BSNumber. Numerator and denominator therefore grow multiplicatively with expression depth.
- This is the root of "I tried rational, but it was too time-consuming" in issue #105 (DOCUMENTED).

### 4. BSPrecision: static worst-case bit budgets (BSPrecision.h; PDF section 7.1, eq. 22-23)

**Rules.** Each input type is described by (maxBits, minBiasedExponent, maxExponent):
- float is (24, -149, 127); double is (53, -1074, 1023); int32 is (31, 0, 30).
- **Multiply:** bits add; min biased exponents add; max exponents add plus 1.
- **Add:** min biased exponent is the minimum; max exponent is the maximum plus 1; bits = maxExp - minBiasedExp (+1).
- **Rationals:** the rules are applied to numerator and denominator cross products.

**Worked numbers** (DOCUMENTED):
- `x*y - z*w` with arbitrary float inputs: 554 bits, 18 words.
- The same restricted to [-1,1]: 300 bits, 10 words.
- Floats in [1,2) with no subtraction: 48 bits, 2 words.
- The same with arbitrary double inputs: 4,196 bits, 132 words.

**N tables in code comments**
- `PrimalQuery3::ToPlane` (orient3d) needs `UIntegerFP32<27>` for float input with BSNumber, 79 words with BSRational, and 197 / 591 words for double (PrimalQuery3.h lines 60-75).
- ConstrainedDelaunay2 recommends `UIntegerFP32<70>` for float input and `<526>` for double.
- The comments say these N were produced by a "PrecisionCalculator" tool. That tool is **not in the repo**: `GTE/Tools` has only BitmapFontCreator and GenerateProject (DOCUMENTED).

**Lesson** (INFERRED, directly readable from the rules): almost all of these bits come from the **exponent range** of IEEE inputs, meaning subnormal to max, not from the mantissa. With inputs on a fixed integer grid the budgets collapse to classic integer bit growth.
- orient3d on B-bit integer coordinates needs 3B+6 bits.
- Wonky's big.bend comment cites 34-bit grid coordinates. That gives 108 bits: 4 U32 limbs, or 7 16-bit limbs.

### 5. QFNumber: exact quadratic-field numbers (QFNumber.h, APConversion.h)

**Representation.** `QFNumber<T,1>` is `x0 + x1*sqrt(d)` with d rational. `QFNumber<T,N>` nests: its coefficients are `QFNumber<T,N-1>`.

**Operations**
- Arithmetic is closed when both operands share the same d. There is an optional assert on mismatched d.
- **Comparison** (lines 358-391):
  - if the sqrt coefficients are equal or d = 0, compare x0;
  - otherwise, if the sign of the difference is clear from x0 and x1 alone, return it;
  - else square: compare `diff.x0^2` with `diff.x1^2 * d`.
- Every comparison is therefore a small number of **integer sign tests**. Each nesting level doubles the degree.

**Users**
- `IntrLine3Cone3` returns the line parameters t as QFN1, so line-cone hits are exact and exactly ordered.
- `IntrSphere3Triangle3` and `LCPSolver` also use it.

**Approximation to a target precision** (`APConversion`)
- `EstimateSqrt` (APConversion.h line 85):
  - take the double sqrt rounded up as `aMax`, and `aMin = a^2/aMax`;
  - Newton-average until `aMax - aMin < 2^-p`;
  - round the new `aMax` upward to 2p bits each step "to avoid quadratic growth in the number of bits".
  - The output is a certified bracket.
- `EstimateApB` (line 132) does the same for sqrt(a)+sqrt(b).

### 6. Interval filters

- **`SWInterval<float|double>`** (SWInterval.h lines 103-200): interval arithmetic **without switching the FPU rounding mode**.
  - Compute in round-to-nearest, then widen each endpoint by one ulp with `std::nextafter(x, ±max)`.
  - `Mul2` handles sign cases. Division by an interval that contains 0 returns all reals.
- **`FPInterval`** uses real rounding-mode changes.
- **GTL** adds `APInterval` over arbitrary-precision endpoints.
- **Section 8.2 of the PDF** gives a zero-multiplication early exit for the sign of a 2x2 determinant:
  - compare the signs of the products first;
  - then the exponent sums `q0 = e00+e11` vs `q1 = e10+e01`. If they differ by more than 1, the sign is known.
  - Only otherwise multiply.

### 7. Exact root classification for degrees 2-4 (RootsQuadratic/Cubic/Quartic.h; LowDegreePolynomialRoots.pdf section 6)

**Setup.** Coefficients (float, double, or rational) are converted to `BSRational<UIntegerAP32>`, made monic, and depressed, all exactly.

**Quartic classification** (depressed quartic x^4 + d2 x^2 + d1 x + d0):
- Discriminant: `Delta = 256 d0^3 - 128 d2^2 d0^2 + 144 d2 d1^2 d0 - 27 d1^4 + 16 d2^4 d0 - 4 d2^3 d1^2` (eq. 22).
- Auxiliaries: `a0 = 12 d0 + d2^2`, `a1 = 4 d0 - d2^2` (eq. 23).
- The sign of Delta plus a0 and a1 separates all 9 factorization patterns: 4 simple real roots, 2 complex pairs, (x-r0)^2 (x-r1)(x-r2), and the rest. The classification follows Rees (1922).
- **Repeated real roots come out as exact rationals.** For example `r0 = -d1*a0 / (9 d1^2 - 2 d2 a1)` in RootsQuartic.h (around line 446).

**Simple roots**
- They are isolated in bounding intervals: Samuelson's inequality for all-real-root cases, Lagrange's bound otherwise.
- They are then estimated by rational bisection (`useBisection`) or by closed form.
- Result: multiplicity, meaning tangency, is decided exactly; only the simple roots are approximated.

### 8. Exact quadric classification (QuadricSurface.h lines 193-560)

- The input is a quadric `x^T A x + b^T x + c = 0` with rational coefficients.
- Its characteristic polynomial is computed exactly. A is symmetric, so all eigenvalues are real, and Descartes' rule of signs (`ComputeRootSigns`, line 263) gives the **exact** counts of positive, negative and zero eigenvalues.
- A case analysis on `r = b^T A^{-1} b / 4 - c` and the rank then yields the class: ellipsoid, hyperboloids, elliptic cone, the cylinder types, planes, point, or no solution.

### 9. Intersection queries relevant to plane/cylinder/cone

**Plane-cylinder** (`IntrPlane3Cylinder3.h`; PDF eq. 6-20)
- `TIQuery`:
  - parallel axis: `|N.(C-P)| <= r`;
  - finite cylinder: `|N.(C-P)| <= r|N x W| + (h/2)|N.W|` (eq. 14).
- `FIQuery`:
  - axis parallel to the plane: 0, 1 or 2 lines at `C - dN ± sqrt(r^2-d^2) (N x W)`.
  - Otherwise: substitute the plane parameterization into the cylinder quadric, complete the square to get `(xi-k)^T S (xi-k) = 1`, then eigendecompose S to get the ellipse center, axes and extents.
  - The query also returns the end-cap trim lines.
- With exact T, `Dot(N,W) != 0` is an exact parallelism test, but sqrt and the eigendecomposition are approximate.
- Infinite cylinders are encoded as `height = -1`, because exact types have no infinity. This is a small but real design point.

**Cylinder-cylinder** (`IntrCylinder3Cylinder3.h`; IntersectionOfCylinders.pdf)
- `TIQuery` only.
- Separating-axis test with `f(D) = r0|DxW0| + r1|DxW1| + (h0/2)|D.W0| + (h1/2)|D.W1| - |D.Delta| < 0`, plus special directions (Delta, W0, W1, and a radial direction when the axes are parallel).
- After that it **samples the hemisphere**. If no sampled direction separates, the cylinders are "deemed to be overlapping". This is heuristic (DOCUMENTED, PDF section 6).

**Ellipse-ellipse** (`IntrEllipse2Ellipse2.h`; RobustIntersectionOfEllipses.pdf)
- `TIQuery`: 8-way typed classification: separated, overlap, outside-but-tangent, strictly contains, contains-but-tangent (both ways), equal.
- `FIQuery`:
  1. Use unnormalized axes so ellipse data stays rational (section 2.1).
  2. LDL^T of M0 gives an affine map (translation plus shear) that makes ellipse 0 axis-aligned, `Y^T D Y = 1` (eq. 15-17).
  3. Eliminate y1^2 to get `E = e0 + e1 y0 + e2 y1 + e3 y0^2 + e4 y0 y1` (eq. 21).
  4. The quartic is `H(y0) = (e2 + e4 y0)^2 (-1 + d0 y0^2) + d1 (e0 + e1 y0 + e3 y0^2)^2` (eq. 37).
  5. Exact case split on e4 = 0, e2 = 0, e3 = 0 (sections 6-8).
  6. For each root, y1 comes from `F(r0, y1) = 0`, **not from a division**. The ± sign is chosen by the smaller residual.
  7. All divisions are removed by scaling with `r_i^2 = a_i^2 b_i^2 |U_i|^2` (section 9).
  8. In floating point, `uv - wz` uses Kahan's FMA difference of products (Listing 2).
- The 2022 version was not robust in float because of the division `w = -e(x)/d(x)`. It was rewritten on 2023-06-14 (PDF section 10.4, DOCUMENTED).

**Typed results.** `FIQuery` results are structs with `intersect` plus a type enum, for example `isEmpty / isPoint / isSegment / isRayPositive / isRayNegative` in IntrLine3Cone3. This is a good pattern for explicit, typed outcomes.

## Robustness and guarantees

- **Exact:** BSNumber +, -, *, compare; BSRational field operations; QFNumber comparisons; conversions of every finite float or double; directed-rounding conversion back to any precision; discriminant-based root multiplicities; quadric classification. All DOCUMENTED by code.
- **Not exact:** every transcendental or sqrt overload on BSNumber or BSRational (routed through double); root values other than rational repeated roots; the cylinder-cylinder TI sampling; eigen-decompositions in the plane-cylinder ellipse.
- **Garbage in:** exact arithmetic is only as exact as the input. In issue #94 a user typed `530.02631651848`, which is not representable as a double; with rationals the tangent case then correctly reports 0 intersections for the *rounded* input (https://github.com/davideberly/GeometricTools/issues/94).
- **Float mode is not symmetric or stable:**
  - triangle-triangle FI gives different results for (A,B) and (B,A) in double; it is fine with rationals (#110, 2025).
  - Ellipse/circle tangency fails in float: the theoretically zero coefficient e3 computes to -7.3e-18 (float) or -1.4e-26 (double) (#105, open since 2025-03-30).
- **Precision tables are worst case.** Actual data may need far fewer words. The class tracks `mSize` and has an optional `GTE_COLLECT_UINTEGERFP32_STATISTICS` to measure it (PDF section 7.2).

## Parallelism and performance

- **Allocation dominates.** For UIntegerAP32, `std::vector` allocation and copying are the main bottleneck. That is why UIntegerFP32<N> exists (PDF section 7).
- **Initialization cost, measured** (DOCUMENTED, UIntegerFP32.h header note):
  - `MinimumVolumeBox3` on 44 rational vertices, single-threaded, took 53.5 s;
  - 40.5 s of that was zero-initializing `mBits{}` in constructors;
  - after removing the initialization it took 10.8 s.
- **Stack size.** Large N needs a big stack: the `DistanceSegments3` sample with `UIntegerFP32<128>` needs a 16 MB stack reserve (PDF section 7.3).
- **No predicate benchmarks.** The PDFs publish no per-predicate timing tables.
- **Parallelism.** GTE has CPU multithreading and GPU (HLSL/GLSL) versions of some algorithms, but the arbitrary-precision stack is scalar, serial C++ (DOCUMENTED by reading; there is no parallel code in the Arithmetic headers).

## Known failures, limitations, war stories

- #99 (2024-12): "Cylinder-cylinder intersection appears wrong". The cause was equation (16) in the PDF plus a division by zero. The fix replaced the search with direct hemisphere sampling, which is still heuristic. https://github.com/davideberly/GeometricTools/issues/99
- #105 (open): ellipse-ellipse fails on tangent circles in float. The user found rationals too slow and reports that lib2geom needs epsilons. https://github.com/davideberly/GeometricTools/issues/105
- #110: FI triangle-triangle depends on argument order in double. https://github.com/davideberly/GeometricTools/issues/110
- #88: segment-segment in double fails on a T-junction off by 3.4e-13. Eberly's answer is to use exact types, not epsilons. https://github.com/davideberly/GeometricTools/issues/88
- February 2026 fixes in the exact stack itself show that edge cases were thinly tested until recently:
  - #122: signed-overflow UB for INT_MIN in the BSNumber constructors;
  - #146: `BSNumber("0")` had a nonzero sign;
  - #145: BSRational `frexp(0)`;
  - #121: a syntax error in `RobustDOP`;
  - #166: a precision-table typo in PrimalQuery3.
  - Links: https://github.com/davideberly/GeometricTools/pull/122, /146, /145, /121, /166.
- The `ALU32::Sub` comment admits to a crash during book testing that was "fixed" by handling a violated precondition. The code now logs an error when the difference is zero (lines 281-292).

## Relevance for wonky

INFERRED unless marked.

**Multi-limb exact tier.** BSNumber is the closest ready-made design for wonky's multi-limb U32 layer, with three adaptations:

1. **Limb width.** GTE needs `uint64_t` for carries and partial products; Bend has none. Wonky's existing `kernel/proto/exact-plane/big.bend` already uses 16-bit limbs in U32 words, so a limb product plus carry stays below 2^32. That is the correct mapping. The alternative is 32-bit limbs with a 16x16 split multiply, which costs about 4 multiplies per limb product either way.
2. **Fixed vs dynamic length.** For GPU-uniform work, use the `UIntegerFP32<N>` model: a fixed limb count per predicate, chosen statically. Branch-free loops over N limbs then give uniform control flow. Dynamic lists, the `UIntegerAP32` model and big.bend's current choice, are fine for CPU fork-join but diverge on GPU.
3. **Exponent or not.** If all inputs live on a fixed grid, BSNumber's floating exponent is unnecessary and plain integers suffice. The exponent form earns its place where wonky must ingest **F32 and F32x2 values exactly**:
   - an F32x2 `hi + lo` is exactly the sum of two BSNumbers;
   - with `|lo| <= ulp(hi)/2` the span is at most about 49 bits, so 2 limbs plus exponent;
   - and where it must round exact results **back** with a certified direction (`Convert` with FE_UPWARD/FE_DOWNWARD) to build conservative F32x2 boxes and tolerances.

**BSPrecision as a design-time tool.** Wonky should carry a small bit-budget calculator in its build (JS side, or as Bend constants) that derives the limb count per predicate from declared input ranges. For example:
- orient3d on B-bit grid coordinates needs 3B+6 bits;
- a plane-quadric substitution needs a small multiple of B.

This is exactly what is needed to size ESOLID-style exact fallbacks, which see up to 141 bits for near-tangent cylinders (see esolid note). Restricting inputs to a grid is the single biggest lever: it cuts GTE's 554-bit float budget for a 2x2 determinant down to 2B+3 bits.

**QFNumber** is the exact representation of wonky's plane/cylinder/cone intersection coordinates. Line-cylinder, line-cone and plane-cylinder-line parameters are all `a + b sqrt(d)` with rational a, b, d.
- Ordering hits along an edge, deciding whether a hit is inside a face, and deduplicating hits then become 2-3 integer sign tests. No sqrt is ever evaluated.
- Two different radicands (two cylinders) need `QFNumber<T,2>`: two squaring steps, roughly 4x the bit budget.
- This is a cleaner exact tier than ESOLID's isolating intervals for wonky's degree-2 cases.

**Exact root classification means exact tangency.** For plane-cylinder, plane-cone and coaxial cases, the quartic or quadratic discriminant sign decides TANGENT vs CROSSING vs MISS exactly, and a double root is an exact rational point.
- This is the typed "tangential contact" outcome wonky needs for the plane-tangent-to-cylinder FDM case, computed as a multi-limb predicate.
- Pair it with GoTools' singularity vocabulary (see the gotools note).

**Quadric classification by Descartes' rule** gives an exact, cheap check that an input or derived quadric really is a cylinder or cone. It is also the entry point for the pencil-based quadric-quadric method (QI; see the qi note), which needs exact degenerate-pencil detection.

**SWInterval is the right filter shape for Bend**, because Bend has no rounding-mode control.
- Compute in F32 round-to-nearest and widen by one ulp.
- The widening needs `nextafter`, i.e. a ±1 on the U32 bit pattern. That requires an F32<->U32 bitcast in Bend 2. **Verify it exists**; if not, widen by a relative `|x|*2^-23 + 2^-149` term computed in F32.
- On Metal, fast-math can flush subnormals, and division and sqrt are not correctly rounded. Widen div and sqrt by more than one ulp, and add an absolute FTZ term of about 2^-126 for GPU filters. This needs checking against the Metal spec before relying on it.

**Robust ellipse-ellipse** maps directly onto wonky's planar faces trimmed by several cylinders or cones, whose edges are ellipses in the plane.
- Port: the LDL^T shear normalization, the division-free quartic, and the exact case split.
- Replace the "choose ± by smaller residual" float heuristic with an exact sign decision. Given an isolating interval for r0, the sign of `e0 + e1 r0 + e3 r0^2` vs `(e2 + e4 r0)` is decidable.

**Fixed-size, branch-light kernels fit Bend.** QFNumber comparisons, discriminant signs, and fixed-N limb arithmetic are pure functions of small immutable records. They are ideal for uniform GPU maps over candidate pairs. Rational bisection with data-dependent iteration counts is better kept on CPU fork-join.

**What GTE does not give wonky:** no quadric-quadric curves (use QI or ESOLID-style methods), no B-rep or Boolean machinery, no topology.

**LLM ergonomics.** Copy the `TIQuery/FIQuery` split, a cheap boolean test vs a full construction, and typed `Result` enums including explicit tangency classes. The ellipse `TIQuery`'s 8-way classification is a model for wonky's SSI result types.

## Pointers worth porting or studying

- `GTE/Mathematics/BSNumber.h`:
  - `AddIgnoreSign`/`SubIgnoreSign` (lines 764-831);
  - `ConvertFrom` (835-907);
  - `ConvertTo`/`GetTrailing` (911-1042);
  - free `Convert(..., roundingMode, ...)` (1070-1237).
- `GTE/Mathematics/UIntegerALU32.h`: the whole file (575 lines) is the limb ALU to transliterate with 16-bit limbs.
- `GTE/Mathematics/UIntegerFP32.h`: header note on the initialization cost; the `mSize` tracking.
- `GTE/Mathematics/BSPrecision.h`: the bit-growth rules for +, -, *, / and comparisons (246 lines). Reimplement as a build-time calculator.
- `GTE/Mathematics/PrimalQuery3.h` / `PrimalQuery2.h`: per-predicate N tables and the exact expression shapes for orient and incircle tests.
- `GTE/Mathematics/QFNumber.h` lines 358-391 (`operator<`) and `APConversion.h` `EstimateSqrt` (line 85) / `EstimateApB` (line 132).
- `GTE/Mathematics/SWInterval.h` lines 103-200.
- `GTE/Mathematics/RootsQuartic.h` `ComputeDepressedRoots` (line 149 ff.), with LowDegreePolynomialRoots.pdf section 6.1.3, eq. 22-23.
- `GTE/Mathematics/QuadricSurface.h` `GetClassification` (line 193), `ComputeRootSigns` (line 263).
- `GTE/Mathematics/IntrEllipse2Ellipse2.h` (`TIQuery` line 48, `FIQuery` line 409), with RobustIntersectionOfEllipses.pdf sections 5-9 (eq. 15-23, 37-41) and Listing 2 (Kahan difference of products).
- `GTE/Mathematics/IntrPlane3Cylinder3.h`, with IntersectionCylinderPlane.pdf eq. 14-20.
- `GTE/Mathematics/IntrLine3Cone3.h`: exact QFN1 results with typed ray, segment and point cases.
- ArbitraryPrecision.pdf:
  - section 3 (eq. 2-11): the arithmetic;
  - section 7.1: static precision;
  - section 8.2: sign of a 2x2 determinant with an exponent early-out.

## Verdict: adapt

This is the most directly portable, permissively licensed reference for wonky's exact tier. Transliterate these pieces into Bend, with 16-bit limbs, fixed limb counts per predicate, and no exponent where inputs are grid integers:

- the odd-mantissa BSNumber model;
- the ALU;
- the static bit-budget rules;
- QFNumber comparisons;
- the exact discriminant classification;
- the SWInterval filter.

Port the robust ellipse-ellipse algorithm for planar faces with conic trims.

Do not adopt GTE wholesale:
- it is C++ with uint64 carries and heap allocation;
- its sqrt and transcendental functions are silently inexact;
- its cylinder-cylinder query is heuristic;
- it has no quadric-quadric SSI or B-rep machinery.
