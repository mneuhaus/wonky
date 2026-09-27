# CAMPARY: CudA Multiple Precision ARithmetic librarY (Joldes, Muller, Popescu, Tucker)

- Kind: CUDA/C++ header library plus extended abstract. Original: [homepages.laas.fr/mmjoldes/campary/](https://homepages.laas.fr/mmjoldes/campary/) (blocked by an Anubis bot challenge from this machine; original tarball `campary_01.06.17.tar.gz` named in the mirror README). Mirror actually read: [github.com/LegalizeAdulthood/campary](https://github.com/LegalizeAdulthood/campary) (shallow clone `<repo>/tmp/research/campary`, HEAD `e805449d`, 2025-08-05; 1 star). Paper: "CAMPARY: Cuda Multiple Precision Arithmetic Library and Applications", ICMS 2016 (LNCS 9725), extended abstract PDF shipped in the mirror (`ICMS_Extended_Abstract_2016_CAMPARY.pdf`, read). The error analysis behind its double-word paths is the [Joldes-Muller-Popescu 2017 note](joldes-muller-popescu-2017-tight-and-rigorous-error-bounds-f.md).
- Authors: Mioara Joldes (LAAS-CNRS), Jean-Michel Muller, Valentina Popescu (ENS Lyon/LIP), Warwick Tucker (Uppsala); contributor Olivier Marty.
- License: **GPL v2 or later** (file headers, e.g. `Singles/src_cpu/multi_prec_certif.h`). Copyleft: copying code into wonky would put wonky under GPL on distribution. INFERRED: use the papers, not the code.
- Status: research library, original release 2016-2017; the GitHub mirror adds CMake only. No issue tracker of the original.

## What it is

Floating-point expansions (unevaluated sums of n machine floats, templated precision) on CPU and CUDA GPUs, with two families of algorithms: "certified algorithms with rigorous error bounds and output constraints" and "quick-and-dirty algorithms that perform well for the average case, but do not consider the corner cases (i.e. cancellation prone computations)" (DOCUMENTED, ICMS abstract §1). Operations: `+, −, ×, /, √` only (DOCUMENTED, abstract: "Currently, all basic multiple-precision arithmetic operations are supported"; code: `addition.h`, `multiplication.h`, `newton.h`, `renorm.h`, `errorFreeTransf.h`). **No sin/cos or other elementary functions** (DOCUMENTED by grepping both `Doubles/` and `Singles/` trees).

## How it works

- Error-free transforms (TwoSum, Fast2Sum, TwoProd with FMA) in `errorFreeTransf.h`; renormalization to "ulp-nonoverlapping" expansions (`renorm.h`).
- A **`Singles/` variant with binary32 limbs** exists for CPU and GPU: n-float expansions, i.e. F32x2, F32x3, ... with certified addition (comment in `Singles/src_cpu/addition.h`: "Addition_accurate with relative error < 4.5 · 2^{-(prec-1)R}"; quick addition "< 24 · 2^{-(prec-1)R}").
- Division and square root by Newton iteration (`newton.h`).

## Robustness and guarantees

- DOCUMENTED: certified variants carry proven relative error bounds; quick variants do not handle cancellation. The double-word special cases are analysed in Joldes-Muller-Popescu 2017, which shows that the "sloppy" double-word addition has unbounded relative error under cancellation.
- INFERRED: the library assumes IEEE binary32/binary64 with round-to-nearest and available FMA for TwoProd; Metal's permission of round-toward-zero and FTZ (Metal note) would void the error-free transforms.

## Parallelism and performance

- DOCUMENTED (abstract): GPU target (CUDA compute capability ≥ 2.0), templated precision up to a few hundred bits; applications: Hénon map iteration, semidefinite programming. Not re-measured.

## Known failures, limitations, war stories

- No transcendental functions: anyone building rotations on CAMPARY must write sin/cos themselves.
- The quick/certified split is explicit: a wonky port must never let a quick path decide a sign.

## Relevance for wonky

- **Main value:** confirms that F32-limb expansions (not just F32x2) are an established GPU technique with certified addition bounds, so wonky can grow a Real to F32x3 locally (for example for the argument reduction of a very large radian argument, or for accumulating a long transform chain) without F64.
- **Transform-specific reminder of an existing proposal:** `kernel/real.bend` `add` is a sloppy double-word addition (already documented in [robust-numerics.md](../robust-numerics.md) §"wonky's R.Real" and proposal P8). Rigid-transform evaluation (`R·p + t` with nearly cancelling terms, carrier offsets `n·o` of rotated planes) is exactly the cancellation-prone use; P8's accurate addition should cover the transform path first (INFERRED priority).
- **Bend fit:** expansions are fixed-size records of F32; operations are straight-line; fork-join over elements; no mutation. The certified/quick distinction maps to two explicit Bend function families.
- **Trig:** nothing to take; use the QD/CORE-MATH/C23 notes.

## Pointers worth porting or studying

- `Singles/src_cpu/addition.h` (certified vs quick addition comments and bounds), `errorFreeTransf.h`, `renorm.h` (read for structure only; GPL).
- ICMS abstract §1-3 (design rationale).

## Verdict: learn-from

Useful as evidence and for the certified/quick split; GPL code must not be copied, and it offers no trigonometry. The actionable item is replacing wonky's sloppy F32x2 addition on sign-relevant and transform paths by the accurate variant.
