# Thall, Extended-Precision Floating-Point Numbers for GPU Computation (df64/qf128)

- Kind: SIGGRAPH 2006 poster, later technical report, and historical Cg source. [Requested report PDF](https://www.andrewthall.org/papers/df64_qf128.pdf); [2006 poster](https://andrewthall.org/papers/sigg06_df64_mkIV.pdf); [author bibliography](https://andrewthall.org/papers/); [source distribution page](https://andrewthall.org/dist/); [source ZIP](https://andrewthall.org/dist/extPrecision.cg.zip).
- Author: Andrew Thall, Allegheny College on the 2006 poster, Alma College on the report. **Version correction:** the requested 12-page PDF is Technical Report CIM-007-01, March 15, 2007, with July 2009 addenda, not the 2006 poster itself. The author lists it as unpublished work. DOCUMENTED, report first page and author bibliography.
- License: report copyright © March 2007 A. Thall. Source header copyright 2004, 2006, 2010; custom wording offers it for experimental/research purposes, disclaims correctness, says readers may reuse it, and asks for credit if copied verbatim. This is **not a named MIT/BSD/Apache license**, and research-purpose wording should not be silently relabeled unrestricted commercial redistribution. It also says many routines derive from QD/Briggs. INFERRED: independently implement the mathematical primitives and cite the lineage; clarify rights before redistributing copied shader code. Source: [distribution page/ZIP](https://andrewthall.org/dist/), `extPrecision.cg` lines 1–35.
- Status/activity: historical unsupported research code, not a maintained GitHub repository; no commit history, stars, contributor count, release stream or issue tracker. Author calls it quirky/antique and hardware-dependent. Download contains **one 32,027-byte, 1,364-newline Cg file**, archive member timestamp December 14, 2010; this timestamp is not a verified last development date. No test suite/build files or qf128 implementation is included in that archive. DOCUMENTED by archive inspection and full source reading.
- Read the full 12-page report, 2006 poster, distribution notes and all source. Local artifacts: `<repo>/tmp/research/pdf/thall-df64-qf128-2006.pdf`, `<repo>/tmp/research/pdf/thall2006-full.pdf` (poster), `<repo>/tmp/research/thall-2006-extended-precision-floating-point-numbers-for-gpu/extPrecision.cg`. No compilation or numerical tests run.

## What it is

DOCUMENTED: implements a real value as an unevaluated sum of two (`df64`) or four (`qf128`) F32 components, giving roughly 48 or 96 contiguous significand bits in the **F32 exponent range**. It adapts error-free transforms and double-double techniques to pre-CUDA Cg fragment shaders, then illustrates Newton/Karp corrections, transcendental functions and a ping-pong FFT. The names are storage widths, not IEEE binary64/binary128 semantics. The report explicitly warns that an expansion is not a fixed 48-bit-significand format: separated terms such as `2^60+2^-60` can also be represented ([report](https://www.andrewthall.org/papers/df64_qf128.pdf), §§II–III.A).

## How it works

DOCUMENTED core representation: `float2(hi,lo)` denotes `hi+lo`, with low residual nonoverlapping the high component. Complex df64 occupies four floats `(real_hi,real_lo,imag_hi,imag_lo)`. Four-term qf128 needs renormalization after intermediate five-term sums. Constants such as pi/log2 are passed as high/low pairs from the host; merely promoting a rounded F32 constant does not restore lost bits ([report](https://www.andrewthall.org/papers/df64_qf128.pdf), pp. 4, 6–8; [source ZIP](https://andrewthall.org/dist/extPrecision.cg.zip), constants and shader-entry code).

DOCUMENTED portable primitive graph, with `RN` made explicit here to show required rounding points (report Algorithms 1–4, source lines 77–173):
```text
QuickTwoSum(a,b):   s=RN(a+b); e=RN(b-RN(s-a))
TwoSum(a,b):        s=RN(a+b); v=RN(s-a)
                    e=RN(RN(a-RN(s-v))+RN(b-v))
Split(a):          t=RN(4097*a)
                    hi=RN(t-RN(t-a)); lo=RN(a-hi)
TwoProd(a,b):      p=RN(a*b); (ah,al)=Split(a); (bh,bl)=Split(b)
                    e=RN(RN(RN(RN(ah*bh)-p)+RN(ah*bl))+RN(al*bh))
                    e=RN(e+RN(al*bl))
```
The source’s nested sums determine grouping. QuickTwoSum normally assumes `|a|>=|b|`; ordinary TwoSum does not. `4097=2^12+1` is the binary32 splitter, separating the 24-bit significand into two smaller pieces. Exactness claims require appropriate rounding and absence of range failure; the shader code itself has no universal range guard. Sources: [report](https://www.andrewthall.org/papers/df64_qf128.pdf), pp. 2–5; [source](https://andrewthall.org/dist/extPrecision.cg.zip), `split`, `quickTwoSum`, `twoSum`, `twoProd`.

DOCUMENTED `df64_addSLOW` / `df64_add` preserve low-part error: TwoSum of both high words and both low words, add low-sum high component into high-sum residual, QuickTwoSum, add remaining low residual, then QuickTwoSum again. The vector version performs the two independent TwoSum calls together. This is the accurate-add graph, not merely `hi=a.hi+b.hi; lo=a.lo+b.lo`. `df64_mult` computes TwoProd of the high words, adds the two cross products, omits `a.lo*b.lo`, and normalizes with QuickTwoSum. Consequently full df64 multiplication is **approximate**, even though TwoProd of two scalar floats can be exact in its qualified domain. Source: [source ZIP](https://andrewthall.org/dist/extPrecision.cg.zip), lines 187–203, 269–293; [report](https://www.andrewthall.org/papers/df64_qf128.pdf), pp. 4–5.

DOCUMENTED Karp-style mixed-precision corrections:
- Division `B/A`: `xn≈1/Ahi` (F32), `yn=RN(Bhi*xn)`, compute high word of the df64 residual `B-A*yn`, then return df64 sum `yn + TwoProd(xn,residual_hi)`.
- Square root: `xn≈1/sqrt(Ahi)`, `yn=RN(Ahi*xn)`, compute df64 `A-yn^2`, take residual high word and correct by `xn*residual_hi/2`.
These exploit quadratic refinement while limiting double-word operations. Their success depends on a suitable seed and scaling; they are not unconditional correctly-rounded sqrt/div routines. Source: [report](https://www.andrewthall.org/papers/df64_qf128.pdf), Algorithms 6–7 / Figure 1; [source](https://andrewthall.org/dist/extPrecision.cg.zip), lines 478–565.

DOCUMENTED qf128 report design: sum four F32 components, build n-sum transforms, and compress five accumulated terms into four via QuickTwoSum chains with zero-dependent branches. Multiplication groups the 4×4 products by significance, retaining error terms for high-order products and fewer low-order contributions. Its cheaper addition has an input-scaled backward-error form `(1+delta1)*a+(1+delta2)*b`, not necessarily a relative bound against the nearly cancelled sum. More expensive sorting/accumulation is discussed separately. The posted source archive contains df64/complex-df64 routines only; qf128 listings must be studied in the report, not assumed available as a tested library ([report](https://www.andrewthall.org/papers/df64_qf128.pdf), §III.B/Figures 6–8).

## Robustness and guarantees

DOCUMENTED mathematical premises: the report presents error-free transforms assuming correctly rounded binary arithmetic with ties-to-even, while its GPU measurements show older hardware does not always satisfy them. Faithful/approximately one-ulp elementary operations are not equivalent to the assumptions required by every transform. Its empirical accuracy tables are not universal proofs. The author’s source explicitly disclaims correctness on a given graphics card ([report](https://www.andrewthall.org/papers/df64_qf128.pdf), §II, Table I; [source header](https://andrewthall.org/dist/extPrecision.cg.zip)).

**DOCUMENTED compiler hazard:** §II.D/§III.A report that Cg 1.5 on G70 did not correctly preserve the product residual in code shaped as `x=a*b; y=a*b-x`; aggressive optimization can reduce y to zero. The implementation therefore uses Dekker splitting. A real FMA residual is `p=RN(a*b); e=FMA(a,b,-p)`, with one rounding in the FMA. **INFERRED correction to the task seed:** turning contraction off is not by itself a fix for an FMA-based TwoProd. If both products are separately rounded, subtracting them gives zero by construction. Either use an explicitly available, verified true FMA or retain the split graph. Compiler safe/no-reassociation/no-contraction controls help preserve a split-based implementation, but their emitted instructions and FTZ behavior still need qualification. This read did not verify Bend’s current compiler controls. Source: [report](https://www.andrewthall.org/papers/df64_qf128.pdf), pp. 3–5.

INFERRED exponent restrictions: `4097*a` can overflow even if a and the desired result are finite; a safe splitter requires an input guard or exact power-of-two scaling. Low words and residuals can underflow/flush even with normal high words. Four-word qf128 worsens this exponent-budget pressure. Thus these expansions give extra significand accuracy only inside a qualified arithmetic domain, not a larger exponent range or an exact-predicate replacement. No fixed CAD tolerance follows merely from “48 bits.” Evidence basis: [source Split/TwoProd](https://andrewthall.org/dist/extPrecision.cg.zip), lines 77–173, and [report numeric model](https://www.andrewthall.org/papers/df64_qf128.pdf), §§II–III.

## Parallelism and performance

DOCUMENTED: the historical vector GPUs could execute independent component arithmetic together; the report describes an approximately 2× benefit for paired operations in several pre-NV8800 cases. This is an architecture-specific report, not a Metal prediction. The FFT uses log2(n) fixed stages, each output reading prior-stage inputs and writing a separate framebuffer; CPU swaps read/write buffers between stages. Precomputed Fourier coefficients avoid expensive shader transcendental evaluation. That is an early functional stage-by-stage GPU pattern ([report](https://www.andrewthall.org/papers/df64_qf128.pdf), §III.A and Algorithms 8–10).

DOCUMENTED Table II gives measured G80 maximum/RMS errors in ulps of **48 contiguous significant bits**, compared with CPU binary64: addition `1.1/0.12`, subtraction `1.1/0.12`, multiplication `2.5/0.33`, division `4.1/0.48`, square root `4.5/0.46`, exp `10.6/1.7`, log(1+x) `11.0/1.7`, sin `7.8/0.94`, cos `241.3/6.0`; operand intervals vary by operation. Cosine’s large maximum is a useful warning about transcendental/range-reduction accuracy, not a general guaranteed bound. Crucially, the July 2009 addendum explicitly **deletes the FFT timing/accuracy results in §III.E**; the text still contains `[DELETED]` and drafting placeholders. Do not invent an FFT speedup or cite the deleted tables as retained evidence. Source: [report](https://www.andrewthall.org/papers/df64_qf128.pdf), pp. 9–10.

INFERRED Bend mapping: use immutable `(hi,lo)` values, explicit expression grouping, parallel independent TwoSum/Split calls where profitable, and balanced batches of many independent arithmetic problems. The fixed basic arithmetic is GPU-uniform. The shader’s variable Taylor loops, zero-branching qf128 normalization, mutable globals, textures and host/OpenGL calls are not a direct fit; use fixed-degree/range-qualified approximants, bounded work and explicit failure, not a literal port of the entire Cg program.

## Known failures, limitations, war stories

DOCUMENTED author warnings and **statically observed source defects**, not tests run in this pass:
- `df64_exp` explicitly flags broken range reduction in a comment (line 804). For either `a.hi>=88.7` **or** `a.hi<=-87.3`, the active code returns zero (`outVal.x=ZERO`), not the commented positive-overflow infinity. Thus `exp(90)` takes a plainly wrong mathematical result path if copied literally (lines 812–814).
- `df64_sincosPade` is an all-zero placeholder (line 949), not an implemented approximation.
- `df64_sqrt` has its zero-special-case line commented out (480–483). Under IEEE-like `rsqrt(0)=+Inf`, the ensuing `0*Inf` is NaN; there is no active zero handling. The exact historical shader result is not measured here.
- `df64_nint` notes inaccurate behavior near half-integers (625–632); trig/remainder comments say constants need more than df64 precision for reliable argument reduction and observed results can be poor (635–645, 994–1001).
- `df64_eq` and comparisons are component-based/lexicographic. INFERRED: do not apply these blindly to overlapping/noncanonical pairs introduced by normalization-skipping optimizations; component equality need not equal equality of the represented real sum.
- Source `mainTRIGFUN` requires host initialization of global ZERO/ONE and high/low constants. The 2006 poster explains passing a one-valued uniform to thwart constant folding. This is a historical workaround, not a modern numerical contract.
Sources: [complete code archive](https://andrewthall.org/dist/extPrecision.cg.zip), [poster discussion panel](https://andrewthall.org/papers/sigg06_df64_mkIV.pdf). No issue tracker exists for this distribution.

## Relevance for wonky

INFERRED: very close historical precedent for F32x2 in a GPU-only environment and useful concrete reference for a *small audited* arithmetic layer. Study the primitives and mixed-precision corrections, not the unguarded transcendental code. Keep canonical/normalized versus intentionally overlapping pair types distinct. Record operation-specific scale/error contracts; reject overflow, range-reduction failure and uncertain topology rather than returning an attractive but unverified approximation.

INFERRED implementation/qualification plan: (1) preserve a reviewed straight-line Split/TwoSum/TwoProd graph in Bend; (2) add bit-pattern regression fixtures that require a nonzero product residual, plus ties, cancellation, splitter-overflow, smallest-normal and FTZ boundaries; (3) compare JS/native/Metal under pinned compiler versions against a U32 exact dyadic reference, not against this old Cg implementation; (4) separately prove F32x2 interval/error bounds before using values to accept Boolean/SSI signs. Basic tuples need no F64 or FFI. General exact zero still belongs to the multi-limb integer path. `contract(off)` or similar settings are useful only after demonstrating that the intended graph survives the actual backend.

This helps numerical construction, analytic SSI evaluation and potentially fillet/offset iteration; it does not supply robust Boolean topology, stable naming, or FDM mesh-deviation certification. F32x2 accuracy must be converted to model-space error bounds and connected to the exact/uncertain predicate interface. Source motivation: [report](https://www.andrewthall.org/papers/df64_qf128.pdf), §§II–III, and [source warnings](https://andrewthall.org/dist/).

## Pointers worth porting or studying

- [Report Algorithms 1–5](https://www.andrewthall.org/papers/df64_qf128.pdf), pp. 2–5: error-free transforms, splitter and true-FMA distinction.
- [Source ZIP](https://andrewthall.org/dist/extPrecision.cg.zip), `split` 77–85, `quickTwoSum` 100–104, `twoSum` 117–122, `twoProd` 148–154, `df64_mult` 188–203, `df64_addSLOW`/`df64_add` 269–293.
- Same source, `df64_div` 515–565 and `df64_sqrt` 478–490: mixed-precision correction structure **with new edge-case handling required**.
- Report Figures 6–8: qf128 five-to-four compression and product organization, not shipped in the source archive.
- Source 759–1135: negative examples for unbounded series/range-reduction/placeholder handling; report §II.D plus poster discussion: compiler semantics belong in numerical acceptance tests.

## Verdict: learn-from

Learn the F32-pair architecture and compiler-failure lessons; independently implement and verify a minimal Bend arithmetic layer. Do not adopt the historical library wholesale: custom research-use wording, no modern maintenance, explicit incomplete/broken routines, finite-exponent/FTZ gaps and deleted benchmark results make it unsuitable as a trusted production numerical foundation.

Sources: [2007 report with 2009 addenda](https://www.andrewthall.org/papers/df64_qf128.pdf), [2006 poster](https://andrewthall.org/papers/sigg06_df64_mkIV.pdf), [author bibliography](https://andrewthall.org/papers/), [distribution and usage terms](https://andrewthall.org/dist/), [actual Cg source archive](https://andrewthall.org/dist/extPrecision.cg.zip).
