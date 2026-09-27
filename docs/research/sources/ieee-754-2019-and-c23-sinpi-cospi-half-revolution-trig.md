# IEEE 754-2019 §9.2 and C23 sinpi/cospi/tanpi: trigonometry in half-revolutions

- Kind: standards (plus working-group background notes and one reference implementation). Sources actually read:
  - IEEE 754 working group, [754-2019 background index](https://grouper.ieee.org/groups/msc/ANSI_IEEE-Std-754-2019/background/) (list of changes from 754-2008) and David Hough's note [754 and tanPi - exceptionally interesting](https://grouper.ieee.org/groups/msc/ANSI_IEEE-Std-754-2019/background/tanpi.txt).
  - The IEEE 754 text itself is paywalled. The correct-rounding clause is quoted by WG14 [N1355](https://www.open-std.org/jtc1/sc22/wg14/www/docs/n1355.htm) (Fred Tydeman, 2009): 754-2008 §9.1 para. 3, "A conforming function shall return results correctly rounded for the applicable rounding direction for all operands in its domain."
  - ISO C23 working draft [N3220](https://www.open-std.org/jtc1/sc22/wg14/www/docs/n3220.pdf) §7.12.4.8-14 and Annex F.10.1.8-14, plus the 60559-to-C mapping table in F.3. Local: `<repo>/tmp/research/pdf/c23-n3220.pdf` (text extract `c23-n3220.txt`, lines 15716-15875 and 33125-33170).
  - Reference implementation for comparison: Julia Base [`base/special/trig.jl`](https://github.com/JuliaLang/julia/blob/master/base/special/trig.jl) (`sinpi`, `cospi`, `sind`, `cosd`, `deg2rad_ext`), MIT, JuliaLang/julia 49,149 stars, pushed 2026-09-24 (`gh api`). Local copy `<repo>/tmp/research/julia-trig/trig.jl`.
- Authors/organization: IEEE Microprocessor Standards Committee (754-2019 chair David Hough, editor Mike Cowlishaw; approved 2019-06-13); ISO/IEC JTC1/SC22/WG14.
- License: standards texts are copyrighted; definitions and special values are facts to implement. Julia code is MIT.
- Status: 754-2019 is current (recommended, i.e. optional, operations). C23 is published (ISO/IEC 9899:2024).

## What it is

Standardized trigonometric operations whose argument is measured in half-revolutions: `sinPi(x) = sin(πx)`, `cosPi(x) = cos(πx)`, `tanPi(x) = tan(πx)`, and inverses `asinPi, acosPi, atanPi, atan2Pi` returning results divided by π. 754-2008 had sinPi, cosPi, atanPi, atan2Pi; 754-2019 §9.2 added tanPi, aSinPi, aCosPi (DOCUMENTED, background index: "9.2 new tanPi, aSinPi, and aCosPi operations are recommended"; 754-2019 also added §9.5 augmentedAddition/Subtraction/Multiplication, i.e. standardized TwoSum/TwoProduct-style operations).

## How it works

- **Why half-revolutions** (DOCUMENTED, Hough, tanpi.txt): "the argument reduction to the primary range is fast and exact by subtracting an integer multiple of 2, unlike the argument reduction of radians which requires subtracting integer multiples of 2*pi, computed to high precision."
- **Exact special values** (DOCUMENTED, C23 F.10.1.12-14):
  - `cospi(±0) = 1`; `cospi(n + 1/2) = +0` for integers n;
  - `sinpi(±0) = ±0`; `sinpi(±n) = ±0` for positive integers n;
  - `tanpi(n) = ±0` with a sign rule; `tanpi(n + 1/2) = ±∞` with divide-by-zero.
  - Hough explains the sign conventions: sinPi zeros take the sign of x (odd function), cosPi zeros are always +0 (even function); `tanpi(x + integer) = tanpi(x)` was sacrificed.
- **Accuracy** (DOCUMENTED via N1355): a conforming 754 §9 function returns the correctly rounded result. C23 itself does not require correct rounding for `sinpi`; implementations differ (INFERRED from the C text, which only defines the mathematical result and special values).
- **Implementation pattern** (DOCUMENTED, Julia `sinpi`, trig.jl l.934-958): `n = round(2x)`, `rx = x − n/2` computed with one `muladd` (exact), quadrant `n & 3`, then `sinpi_kernel`/`cospi_kernel` polynomials on `[0, 0.5]`. Large `x ≥ maxintfloat` returns ±0 or 1 directly.
- **Degrees** (DOCUMENTED, Julia `sind`/`cosd`, trig.jl l.1456-1530): `rem(x, 360)` exactly, fold around 90/180/270 with exact subtractions (`90 − |x|` is exact by Sterbenz on its range), return exact ±0 at 180, then convert the small remainder to radians **in double-word** (`deg2rad_ext`: Dekker split of x, π/180 as hi/lo) and evaluate the radian kernel on the pair. Multiples of 90° give exact 0 and ±1 because the reduced argument is exactly 0.

## Robustness and guarantees

- DOCUMENTED: the reduction in half-revolutions or degrees is exact in binary floating point; zeros at integer (and cos at half-integer) arguments are exact by specification, not by luck.
- INFERRED limit: exactness holds for the **represented** argument. `1/6` and `1/3` are not binary floats, so `sinpi(fl(1/6))` is not exactly 1/2 unless rounding happens to land there; 30° and 60° are exact only if the angle is carried as the integer 30 (degrees) or as a rational, not as a binary fraction of π. Niven's theorem limits rational outputs anyway to 0, ±1/2, ±1 (see the Bahrdt-Seybold note).
- DOCUMENTED (Hough): the choice of signed zeros/infinities is a convention; not all identities can hold at once.

## Parallelism and performance

- Not measured here. INFERRED: the reduction is integer-like and branch-free up to a quadrant switch; kernels are fixed-degree polynomials: uniform GPU work.
- Metal has `sinpi/cospi/tanpi`, but with fast math (the default) `tanpi` is "implemented as tan(x * pi)" and `sinpi/cospi` only promise absolute error ≤ 2^-13 on [-1, 1] (see the Metal note). The exactness property is therefore not available from Metal's fast functions.

## Known failures, limitations, war stories

- DOCUMENTED: tanPi's sign-of-zero/infinity controversy delayed it from 754-2008 to 754-2019 (Hough).
- DOCUMENTED (Onshape std, see its note): FeatureScript's own `sin(30 * degree)` "returns approximately 0.5"; FS has no sinPi, and `degree = 0.0174532925199432957692 * radian`. In wonky's JS frontend `Math.cos(90 * Math.PI/180) = 6.123233995736766e-17` and `Math.sin(Math.PI) = 1.2246467991473532e-16` (measured, `tmp/research/frames-trig/f64-special-angles.mjs`).

## Relevance for wonky

- **Direct fix for a failure family:** `rotationAround(axis, 90 * degree)` today yields a matrix with `6.12e-17` where 0 belongs (measured), so an axis-aligned face becomes very slightly tilted; the 180° sector of sketch-arcs D03 got `y = 1.66e-14 mm` from `sin(180°)` at a 135.5 mm radius. A degree- or turn-based sin/cos with exact reduction returns exact 0 and ±1 at multiples of 90°, which keeps exact axis alignment, the property that wonky's cap snap, carrier unification exclusions and `isIdentityRotation` fast path rely on.
- **Bend fit:** excellent. Represent angles as an exact dyadic or rational number of turns/degrees (U32 integer degrees plus a U32 fraction, or an F32x2 value of turns whose reduction subtracts an integer). The quadrant switch and exact subtraction are integer/F32 operations; the kernel polynomial runs in F32x2 on a reduced argument of at most 45°. No F64 needed.
- **Precision mapping:** a half-revolution argument in F32x2 has 48 bits; reduction to `[−1/4, 1/4]` turn is exact; the polynomial in F32x2 needs coefficients `π^k/k!` as F32x2 pairs (error about 2^-47 each, INFERRED). An F32x2 kernel cannot be correctly rounded to F32x2 in general, but it can be faithful with a stated bound (see the QD/CORE-MATH notes for designs).
- **FeatureScript bridge:** users write `k * degree`; the interpreter can carry the degree count exactly (it is typed as a decimal literal) and pass degrees, not radians, to Bend. Radian-typed angles (`PI * radian`, `atan2` results) stay approximate.

## Pointers worth porting or studying

- C23 N3220 F.10.1.12-13 (special values, the test table for a wonky `sinTurns/cosTurns`).
- Julia `sind`/`cosd` (trig.jl l.1473-1530): the exact degree folding pattern and the double-word conversion `deg2rad_ext` (l.1456-1469), directly analogous to an F32x2 design with F32 hi/lo split by 4097.
- Hough's tanpi.txt: rationale sentences to cite in wonky's numeric-model docs.

## Verdict: adopt

Adopt half-revolution (or degree) semantics for every angle that enters the kernel, with exact reduction and exact values at multiples of 90°, following C23 F.10.1.12-13 special values. Implement the kernel in F32x2 with a stated bound; never rely on Metal's `sinpi`.
