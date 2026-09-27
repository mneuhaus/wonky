# Metal Shading Language 4.1: math-function accuracy (precise vs fast) and floating-point modes

- Kind: official specification. Canonical: [Metal Shading Language Specification (PDF)](https://developer.apple.com/metal/Metal-Shading-Language-Specification.pdf), Version 4.1, pages dated 2026-06-04, 383 pages. Local: `<repo>/tmp/research/pdf/metal-shading-language-spec.pdf` and text extract `msl.txt`. Read: §1.6.3 compiler options (pp. 14-16), §6.6 math functions and the `metal::precise` / `metal::fast` namespaces (p. 208), §8 numerical compliance (pp. 368-375: 8.1 INF/NaN/denormals, 8.2 rounding mode, 8.4 Tables 8.1-8.3, 8.5 flush-to-zero). Runtime API counterparts: [MTLCompileOptions.mathMode](https://developer.apple.com/documentation/metal/mtlcompileoptions/mathmode) ("replaces the fastMathEnabled property") and [mathFloatingPointFunctions](https://developer.apple.com/documentation/metal/mtlcompileoptions/mathfloatingpointfunctions) ("The FP32 math functions Metal uses"), read via Apple's documentation JSON.
- Author: Apple Inc.
- License: proprietary documentation; facts only.
- Status: current (Metal 4.1).

## What it is

The accuracy contract for single-precision operations and math functions on Apple GPUs, and the compiler switches that change it. This decides what a Bend program compiled to Metal can assume for F32 arithmetic and for any hardware sin/cos.

## How it works (DOCUMENTED)

- **Basic operations:** `x + y`, `x − y`, `x * y` are correctly rounded in both the precise table (8.1) and the fast-math table (8.2). `x / y` and `1.0 / x` are correctly rounded only in precise mode; with fast math `x / y ≤ 2.5 ulp` and `1.0 / x ≤ 1 ulp` for operands in `[2^-126, 2^126]`. Fast `sqrt(x)` is "implemented as x * rsqrt(x)" with `rsqrt ≤ 2 ulp`.
- **Trigonometry, precise (Table 8.1):** `sin, cos, sincos, sinpi, cospi ≤ 4 ulp`; `tan, tanpi ≤ 6 ulp`; `atan ≤ 5`, `atan2 ≤ 6`, `asin, acos ≤ 4 ulp`.
- **Trigonometry, fast (Table 8.2):** `sin(x), cos(x)`: "For x in the domain [-pi, pi], the maximum absolute error is <= 2^-13 and larger otherwise"; `sinpi, cospi`: the same absolute 2^-13 on `[-1, 1]`; `tan(x)` "Implemented as sin(x) * (1.0 / cos(x))"; `tanpi(x)` "Implemented as tan(x * pi)"; `atan2` is a formula that is "undefined" when x = 0 or y = 0.
- **Defaults:** fast math is "the default unless you specify -fno-fast-math" (8.4). §1.6.3: `-fmetal-math-fp32-functions=<fast|precise>` "The default is fast"; `-fmetal-math-mode=<fast|relaxed|safe>` "The default is fast". `fast` allows "no NaNs, no INFs, no signed zeros, allow reciprocal, allow reassociation, and FP contract to be fast"; `relaxed` honours INF/NaN but still reassociates; `safe` "disables unsafe floating-point optimizations ... This sets the FP contract to **on**". `-fno-fast-math` = precise functions + safe mode.
- **Contraction:** "By default, the compiler allows floating-point contractions. For example, a*b+c may be converted to a single fused-multiply-add." `-ffp-contract=off` or `#pragma METAL fp contract(off)` disables them; `on` "allows contractions within statement", `fast` across statements.
- **Rounding and denormals:** "Either round ties to even or round toward zero rounding mode may be supported" (8.2); denormal inputs/outputs "may be flushed to zero" (8.1), with the FTZ edge-case rules of 8.5. Floating-point exceptions are disabled (8.3). Metal 4.1 adds `-fmetal-rtz-fp-conversion` for float-to-float conversions.
- **Explicit selection:** `metal::precise::cos(x)` and `metal::fast::sin(x)` pick a variant regardless of the global flag (p. 208).

## Robustness and guarantees

- DOCUMENTED: ulp bounds are minimum accuracies (upper bounds on error), not correct rounding, for every transcendental function, in both modes. Precise `sinpi(1.0)` is only promised within 4 ulp of 0 in relative terms; no exact-zero rule like C23 F.10.1.13 is stated.
- DOCUMENTED: fast-mode absolute error 2^-13 ≈ 1.2e-4 on sin/cos: at a 100 mm radius, 12 µm. Outside `[-π, π]` the error is unspecified ("larger otherwise").
- INFERRED: error-free transforms (TwoSum, Dekker split, TwoProd without FMA) need round-to-nearest, no reassociation and no contraction. `safe` mode removes reassociation but, per §1.6.3, still sets contraction to `on` (within a statement). An emitted `a1*b1 - p` in one statement may therefore be fused unless `-ffp-contract=off` is also set.

## Parallelism and performance

- Not measured here. The spec gives no timings. INFERRED: `fast::` functions are the hardware-friendly variants; wonky's F32x2 series cost far more but are exact in their stated bounds.

## Known failures, limitations, war stories

- DOCUMENTED in wonky: `docs/proto-exact-plane.md:255` states that "the Metal runtime of Bend 2.0.25 compiles with `MTLMathModeSafe`", and the certified-pair counts were identical on all targets. `docs/native-bridge.md:304` says "Metal baut Bend schon mit `--fmad=false`"; `--fmad=false` is an NVCC (CUDA) flag and does not appear in the MSL 4.1 specification (INFERRED: that sentence probably conflates the CUDA and Metal backends).
- INFERRED risk: `MTLMathModeSafe` implies contraction `on` per spec; if Bend's Metal codegen ever emits `a*b - c` inside one expression, the TwoProd residual in `real.bend` `mul` could be fused and become 0. The identical counts are evidence for current codegen, not a guarantee.
- INFERRED risk: RTZ is permitted by the spec; Apple GPUs are believed to use RTNE for F32 arithmetic (HEARSAY, not stated in the spec). A qualification test (TwoSum residual on a tie case) should pin it per GPU family, as robust-numerics.md already recommends for FTZ.

## Relevance for wonky

- **Never use Metal's sin/cos/sinpi for geometry.** Fast variants have 2^-13 absolute error; precise variants 4 ulp of F32 (about 2^-22 relative): both far above F32x2 and neither gives exact values at multiples of 90°. wonky's own F32x2 series in `kernel/real.bend` is the right approach; this spec is the justification.
- **Pin the build:** require `mathMode = safe` **and** contraction off (`-ffp-contract=off` or the pragma) and `mathFloatingPointFunctions = precise` for any Bend Metal build, record them in the build key (as native-bridge.md already does for C), and add a device self-test: TwoProd residual nonzero for `(1 + 2^-12)²`, TwoSum on a known tie, a subnormal round trip.
- **Trig in turns on GPU:** half-revolution reduction is integer/F32-exact arithmetic that only needs correctly rounded `+ − ×`, which Metal guarantees in every mode; the polynomial runs in F32x2. That design is portable across JS, C and Metal.
- Bend fit: this is about the target, not an algorithm; its constraints (no F64, possibly FTZ/RTZ) are exactly Bend's.

## Pointers worth porting or studying

- MSL spec §1.6.3 (pp. 14-16), §6.6 p. 208, §8.1-8.5 (pp. 368-375), Tables 8.1 and 8.2.

## Verdict: learn-from

A platform contract, not an algorithm: it rules out hardware trig for kernel geometry and specifies the flags and self-tests the Bend Metal build must pin for F32x2 soundness.
