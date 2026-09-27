# QD library (Hida, Li, Bailey): dd_real sin/cos

- Kind: C++/Fortran library plus technical paper. Canonical: [QD 2.3.24 tarball](https://www.davidhbailey.com/dhbsoftware/qd-2.3.24.tar.gz) from [Bailey's software page](https://www.davidhbailey.com/dhbsoftware/); paper [Library for Double-Double and Quad-Double Arithmetic (qd.pdf)](https://www.davidhbailey.com/dhbpapers/qd.pdf), dated May 8, 2008 (earlier version: Hida, Li, Bailey, "Algorithms for quad-double precision floating point arithmetic", ARITH-15, 2001). Local: `<repo>/tmp/research/qd/qd-2.3.24/` (read `src/dd_real.cpp` l.160-600, `COPYING`, `NEWS`) and `<repo>/tmp/research/pdf/qd-hida-li-bailey.pdf` (24 pages; read §§1-5, 9 and the trig section).
- Authors: Yozo Hida (UC Berkeley), Xiaoye S. Li, David H. Bailey (LBNL).
- License: modified BSD ("BSD-LBNL-License", copyright 2003-2023 The Regents of the University of California); `COPYING` adds a request to contact LBNL tech transfer for commercial use. INFERRED: porting the algorithm structure is unproblematic; copying code needs the BSD notice.
- Status: 2.3.24 (tarball dated 2023-11-04) is the latest release; the library is maintained sporadically by Bailey; no public repository, stars or issue tracker (NEWS lists small fixes per release).

## What it is

The reference software for double-double (`dd_real`, ≥106-bit significand as an unevaluated pair of binary64) and quad-double arithmetic, including elementary functions. It is the direct ancestor of every "float-float" GPU library (Thall's df64 cites QD; see the [Thall note](thall-2006-extended-precision-floating-point-numbers-for-gpu.md)). For wonky it is the template for F32x2 sin/cos: the same algorithm with binary32 words.

## How it works (DOCUMENTED, dd_real.cpp l.284-446)

- **Reduction:** `z = nint(a / 2π)`, `r = a − 2π·z` (in dd), then `j = round(r / (π/2))`, `t = r − (π/2)·j`, then `k = round(t / (π/16))`, `t -= (π/16)·k`, so `|t| ≤ π/32`. Constants `_2pi`, `_pi2`, `_pi16` are dd pairs (~106 bits). Error exits if `|j| > 2` or `|k| > 4`.
- **Tables:** `sin(kπ/16)`, `cos(kπ/16)` for k = 1..4 as dd pairs.
- **Series:** `sin_taylor` sums Taylor terms with a precomputed `inv_fact` table (15 entries, dd) until the term drops below `0.5·|a|·eps`; `cos_taylor` similarly. `sincos_taylor` computes `cos = sqrt(1 − sin²)` when both are needed.
- **Recombination:** `sin(t + jπ/2 + kπ/16)` by the addition formulas with the table values, quadrant signs by `j`.
- The paper's §5.3 describes the finer `mπ/1024` table (|m| ≤ 256, at most 10 series terms) for quad-double; tables were precomputed with MPFUN via half-angle formulas starting from `cos π = −1`.

## Robustness and guarantees

- DOCUMENTED (paper §9): "Currently, the basic routines do not have a full correctness proof"; renormalization correctness relies on Priest's non-overlap conditions. The remainder `a − round(a/b)·b` is the "naïve method", which "leads to loss of accuracy when a is large compared to b. Since this routine is used in argument reduction for exponentials, logarithms and trigonometrics, a fix is needed."
- No stated ulp bound for sin/cos in the paper. Thall measured a df64 (float-float) port on G80: sin max 7.8 / RMS 0.94 ulps of 48 bits, cos max 241.3 / RMS 6.0 (see the Thall note), a warning that the cos path (via `sqrt(1 − sin²)` near cos ≈ 0, or the table recombination) can lose many bits.
- INFERRED: the radian reduction subtracts multiples of a rounded 2π; a result for an argument that the user meant as exactly π comes out as `sin(fl(π))`-sized noise (about 1e-32 in dd, about 1e-14 in F32x2 as measured for wonky below). QD provides no degree or half-revolution variants.

## Parallelism and performance

- DOCUMENTED (paper §8, Table 1): timings only for quad-double add/mul/div/sqrt on 200-400 MHz CPUs of about 2000 (for example quad-double mul 1.965 µs, sloppy mul 1.016 µs on a Pentium II 400); no sin/cos timings.
- INFERRED: the series loop has a data-dependent term count (threshold test); for uniform GPU work use a fixed term count, as wonky's `trig_series(18n, …)` already does.

## Known failures, limitations, war stories

- DOCUMENTED: naive remainder for large arguments (above); missing proofs.
- MEASURED for wonky's current F32x2 port-in-spirit (`kernel/real.bend`: reduce by 2π only, then an 18-term Taylor series on `|r| ≤ π`, no π/2 or table reduction). A faithful JS emulation (`tmp/research/frames-trig/emulate-real-bend.mjs`, `Math.fround` after every F32 op, no FMA):
  - `cos(90°) = −4.4e-16`, `sin(180°) = 1.42e-14`, `cos(270°) = −9.3e-15` (inputs: F32x2 split of the f64 radians the frontend would send);
  - max absolute error vs libm at the same input: **6.4e-14 (2^-43.8)** over 20,000 random `|x| ≤ 4π`;
  - `cos² + sin² − 1` up to 7.2e-14 (2^-43.7).
  The loss versus the 2^-48 word precision comes from summing series terms up to π³/6 ≈ 5 in magnitude on `|r| ≤ π` and from the F32x2 π constant (about 3.6e-15 off Math.PI); QD's π/2 + π/16 reduction exists precisely to avoid that.

## Relevance for wonky

- **Upgrade path for `kernel/real.bend` sin/cos (INFERRED):** keep F32x2 but adopt QD's structure: reduce by π/2 (quadrant, exact sign/swap) and by a small table step, then a short fixed-length series on `|t| ≤ π/32`. Expected absolute error near the F32x2 word precision (a few 2^-48) instead of 2^-44. Better still, move the reduction to exact turns/degrees (CORE-MATH/C23 notes), which removes the rounded-π subtraction entirely for typed angles.
- Avoid `cos = sqrt(1 − sin²)` in F32x2 near cos ≈ 0; evaluate both series (Thall's cos failure).
- **Bend fit:** tables of F32x2 constants, fixed-length series, quadrant selection by `Bool.pick`: uniform work, no mutation, fork-join over elements.
- **Precision mapping:** dd's 106 bits map to F32x2's ~48; the F32 exponent range (smallest normal 2^-126) matters only for the tiny-term tail, where the series should stop by count rather than by an underflowing threshold.

## Pointers worth porting or studying

- `dd_real.cpp` l.284-301 (tables), l.304-359 (series), l.361-446 (`sin` with the two-stage reduction), l.448-500 (`cos`).
- Paper §5.3 (mπ/1024 table idea, half-angle precomputation), §9 (known weaknesses).

## Verdict: adapt

Adopt QD's reduction-plus-table structure for the F32x2 trig kernel and state its error bound; do not adopt its radian-only interface for user angles. The code itself is not needed.
