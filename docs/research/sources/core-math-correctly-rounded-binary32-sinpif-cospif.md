# CORE-MATH: correctly rounded binary32 sinpif / cospif

- Kind: open-source math library (C). Canonical: [gitlab.inria.fr/core-math/core-math](https://gitlab.inria.fr/core-math/core-math), homepage [core-math.gitlabpages.inria.fr](https://core-math.gitlabpages.inria.fr/). Files actually read: `src/binary32/sinpi/sinpif.c` (117 lines), `src/binary32/cospi/cospif.c` (114 lines), `README.md`, `LICENSE`. Local sparse clone: `<repo>/tmp/research/core-math/repo` (HEAD `708e86ef`, 2026-09-23 "[pow] avoid spurious underflow").
- Authors: sinpif/cospif copyright 2022-2025 Alexei Sibidanov; project led at INRIA (Paul Zimmermann et al.).
- License: **MIT** (repository LICENSE and file headers). Porting ideas or code is permitted with the notice.
- Activity (DOCUMENTED, GitLab API 2026-09-24): created 2022-01-26, last activity 2026-09-23, 2 stars, 1 fork (GitLab stars understate use). Homepage (DOCUMENTED via fetch): glibc 2.42+ integrated 29 CORE-MATH binary32 functions including the π-variants; LLVM-libc integrated several; AMD libm 4.2+ took tanhf.

## What it is

A library of correctly rounded (all four rounding modes) elementary functions for binary32/binary64 and more. Relevant here: `cr_sinpif`, `cr_cospif` (and `tanpif`) for binary32. README (DOCUMENTED): "For univariate binary32 functions it is checked by exhaustive search" (homepage) and `./check.sh --exhaustive` over all inputs and rounding modes.

## How it works (sinpif.c, DOCUMENTED by reading the code)

- **Integer argument reduction on the significand:** extract exponent e and 24-bit significand m (with sign folded into m). With `s = 143 − e`, the quadrant/table index is `iq = ((m >> s) + 1) >> 1` modulo 128, and the remainder is the integer `k = m << (31 − s)` (a signed 32-bit fixed-point fraction of 1/64 of a half-turn). No π is involved in the reduction: x is in half-revolutions, so reduction is bit manipulation.
- **Exact zeros:** `if (si >= 0 && (m << si) == 0) return copysign(0, x)` catches every integer x; for `|x| ≥ 2^23` the result is ±0; for `2^17 ≤ |x| < 2^23` the result is read straight from the table (x is a multiple of 1/64).
- **Table plus polynomial:** `S[i] ≈ sin(iπ/64)`, 128 binary64 entries (one table serves sin and cos via index shift 32). `sin(π(i/64 + z)) = S[is] + S[is]·z²·fc(z²) + S[ic]·z·fs(z²)` with degree-2 polynomials `fs, fc` in z² whose binary64 coefficients absorb the fixed-point scale of k (for example `sn[0] = 0x1.921fb54442d0fp-37` = π·2^-38).
- **Tiny arguments:** `|x| < 2^-14` uses `z·(π + z²·c3)` in double.
- **cospif:** same table with swapped indices; `|x| < 2^-15` returns `fmaf(-c·x, x, 1)`; `cospi(n + 1/2)` hits the table entry 0 exactly.
- **Numeric model:** all evaluation is in **binary64** (double tables, double polynomial), then one rounding to binary32. Correct rounding follows because the double evaluation error is far below the binary32 rounding boundary distance for all inputs, verified exhaustively (the code has no rounding test/fallback path for sinpif).

## Robustness and guarantees

- DOCUMENTED: correct rounding for all 2^32 inputs and all rounding modes (exhaustive check); exact ±0 at integers; special cases NaN/Inf raise FE_INVALID.
- DOCUMENTED (README Notes): assumes runtime rounding in the current mode (`-frounding-math` may be needed), assumes double operations really round to double (x87 extended precision breaks it), and uses `__builtin_fmaf`, which may fall back to a library fma.
- INFERRED: the guarantee is for binary32 output. It says nothing about a double-word (F32x2) result.

## Parallelism and performance

- Branch-light, table plus 2 short polynomials; no loops. The repo has `perf.sh` harnesses; no numbers read here. INFERRED: uniform per-element work, ideal for SIMD/GPU if binary64 were available.

## Known failures, limitations, war stories

- DOCUMENTED (README): Apple's `ldexp` subnormal bug (Darwin 25.1.0, reports FB21774989/FB21774410) breaks CORE-MATH `erfc`; x87 double-rounding caveat.
- For wonky the blocking limitation is the **binary64 dependency**: the tables and polynomial are in double, which neither Bend's F32/U32 scalars nor Metal provide.

## Relevance for wonky

- **Design to copy, not code:** the half-revolution reduction is pure U32 bit arithmetic (shift of the 24-bit significand, index mod 128), which Bend expresses directly with U32 ops, uniformly across elements. Exact zeros at integers come from an integer test on the significand. That is exactly what wonky needs for exact 0/±1 at multiples of 90° when angles are carried in turns.
- **F32x2 adaptation (INFERRED):** replace each double table entry by an F32x2 pair (hi = F32 rounding, lo = F32 rounding of the rest; about 48 bits), and evaluate the polynomial in F32x2 with the remainder `k` converted exactly (a 32-bit integer does not fit one F32 exactly; split into two F32 words, 16+16 bits, both exact). With |z| ≤ 1/128 half-turn, `fs, fc` need a few more terms than CORE-MATH (target 2^-47 instead of 2^-30). The result is faithful to about 2^-46 absolute, not correctly rounded; that bound must be proved per wonky's F32x2 operation bounds (Joldes-Muller-Popescu note).
- **Where it plugs in:** revolve end frames (`kernel/revolve.bend:607` builds the end plane from `R.cos(angle)`, `R.sin(angle)`), tessellation, pcurves, `rotationAround` for axis-aligned rotations, circular pattern instance frames.
- **Correctly rounded F32 as a byproduct:** for display or the F32 GPU path, an exhaustive-checkable binary32 sinpif implemented in F32x2 inside Bend would be testable against CORE-MATH on the host (all 2^32 inputs in minutes on a CPU, later, not now).

## Pointers worth porting or studying

- `sinpif.c`: exponent/significand split, `s = 143 − e`, `iq = ((m>>s)+1)>>1`, `k = m<<(31−s)`, exact-zero test `(m << si) == 0`, large-argument table read, 128-entry `S[]`.
- `cospif.c`: index swap (`ic = (iq + 32) & 127`) and the tiny-argument `fmaf`.
- `check.sh --exhaustive` as the testing model for any wonky binary32 trig.

## Verdict: adapt

Adopt the integer half-revolution reduction and exact-zero logic; re-derive tables and polynomials for F32x2 with a stated error bound (MIT permits reuse of structure and constants). The binary64 evaluation itself is unreachable in Bend.
