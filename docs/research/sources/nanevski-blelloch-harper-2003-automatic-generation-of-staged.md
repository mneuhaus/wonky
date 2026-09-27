# Nanevski, Blelloch & Harper: Automatic Generation of Staged Geometric Predicates
- **Kind / canonical URLs:** research paper and compiler specification; [HOSC DOI](https://link.springer.com/article/10.1023/A:1025876920522), [author-hosted journal preprint](https://software.imdea.org/~aleks/papers/geompred/geomhosc.pdf), [technical report with complete rules](https://software.imdea.org/~aleks/papers/geompred/geomtr.pdf), [ICFP 2001 version](https://www.cs.cmu.edu/~rwh/papers/geompred/icfp01.pdf).
- **Authors / years / venue:** DOCUMENTED: Aleksandar Nanevski, Guy Blelloch, Robert Harper, Carnegie Mellon; ICFP/CMU-CS-01-141 in 2001; Higher-Order and Symbolic Computation 16(4), pp.379–400, December 2003. Downloaded journal manuscript is dated 12 December 2002 and has 28 PDF pages, not the publisher's pagination. [Crossref](https://api.crossref.org/works/10.1023/A:1025876920522), [preprint](https://software.imdea.org/~aleks/papers/geompred/geomhosc.pdf).
- **License:** DOCUMENTED: preprint carries Kluwer copyright; no permissive compiler-source license was established in the inspected author directory. INFERRED: reproduce mathematical transformations independently; do not assume SML or C fragments grant broad code-copying permission. [Author directory](https://software.imdea.org/~aleks/papers/geompred/).
- **Status:** historical research prototype/specification, not a modern maintained-library claim; repository metrics not applicable. Read the journal preprint in full and the technical report's later-phase/compiler appendix (PDF pp.20–27).

## What it is
DOCUMENTED: A compiler from a small exact-arithmetic expression language to multi-phase filtered predicates. It generalizes Shewchuk's hand-designed adaptive predicates and, separately, supports partial application of geometric arguments. “Staged” is not just progressively increasing precision: it is also precomputing one fixed plane/line once and testing many subsequent points. [§§1,3](https://software.imdea.org/~aleks/papers/geompred/geomhosc.pdf#page=3).

## How it works
### Two axes: stages versus phases
DOCUMENTED: A **stage** supplies another group of function arguments; a **phase** increases confidence/accuracy for already supplied arguments. Nested anonymous functions are source stages. Every stage is translated into four numeric phases A–D; later-phase work is suspended and memoized, not immediately run. Fig.5 fixes A and C for orient2d(A,B,C), returning a function of B; differences ax-cx and ay-cy can be shared across all queries. [§3,Figs.5–7](https://software.imdea.org/~aleks/papers/geompred/geomhosc.pdf#page=10).

### Source and intermediate languages
DOCUMENTED: normalized single-operation assignments, +, -, *, unary negation and dedicated square; constants are temporarily replaced by variables during analysis. No division, radical or arbitrary recursive program is supported. A compilation context records each variable's phase-specific error descriptor, permanent, and substitution. The intermediate language distinguishes rounded operations from exact expansion operations, roundoff-tail extraction, expansion approximation, signtest, and suspensions. The compiler threads these contexts functionally and performs free-variable analysis to determine retained values. [§§3–4](https://software.imdea.org/~aleks/papers/geompred/geomhosc.pdf#page=10).

### Concrete filter algebra
DOCUMENTED: represent X_i = x_i ± delta_i*p_i, with |x_i| ≤ p_i. Here delta_i is a rational compile-time coefficient; p_i is a runtime magnitude expression (“permanent”). Under round-to-nearest ties-to-even and no under/overflow, epsilon=2^-53 for the measured binary64 implementation. Eq.(2) gives:
- addition/subtraction: delta_out = epsilon + (1+epsilon)*max(delta1,delta2); p_out = rounded(p1+p2);
- multiplication: delta_out = epsilon + (1+epsilon)*(delta1+delta2+delta1*delta2); p_out = rounded(p1*p2);
- square: delta_out = epsilon + (1+epsilon)*(2*delta1+delta1²); p_out = rounded(p1²).
Accept sign when |x| > rounded(ceil_fp((1+epsilon)*delta)*p). The upward-rounded **constant** is generated beforehand; this is not runtime fenv switching. Constants were computed in initialization rather than inserted as potentially downward-rounded decimal literals. [§2.1,eqs.2–3,Table II footnote](https://software.imdea.org/~aleks/papers/geompred/geomhosc.pdf#page=6).

### Four numeric phases and exact recovery
DOCUMENTED: It is **not** merely rerunning the same expression at four mantissa widths. Let v_x=fl(ax-bx), e_x=(ax-bx)-v_x and likewise for y. The example X=(ax-bx)²+(ay-by)² decomposes exactly into (v_x²+v_y²) + 2(v_x*e_x+v_y*e_y) + (e_x²+e_y²).
- A: ordinary rounded leading expression plus a certified error bound.
- B: exact expansion evaluation of the leading expression built from rounded input differences, still bounded for omitted input tails.
- C: recover tails and cheaply approximate the first correction, with its own residual bound.
- D: include all remaining correction terms in exact expansions and return exact sign.
A phase may reuse values from previous phases rather than repeat work. Tables I–II show the complete c*(a-b)² example. [§2.3,Fig.3,§4](https://software.imdea.org/~aleks/papers/geompred/geomhosc.pdf#page=8).

DOCUMENTED: Expansions are magnitude-ordered, nonoverlapping floating components whose unevaluated sum is exact; error-free transforms recover the rounding tail. “approx” returns an approximation to an expansion with relative error bounded by 2*epsilon. Suspensions return two tuples: values for later phases of the current stage (lforce), and values for the next stage (rforce). [§§2.2,3](https://software.imdea.org/~aleks/papers/geompred/geomhosc.pdf#page=7).

DOCUMENTED: the journal omits full phase-C error semantics and delegates complete rules to the technical report. Appendix A.2–A.4 is the actual porting reference: e.g. exact phase-D multiplication adds residual terms x1_B*x2_D + x1_D*x2_B + x1_D*x2_D to the phase-B product. A.5 gives the free-variable-driven composition of stages and suspensions. A new implementation should not guess phase-C bounds from the journal's examples alone. [Technical appendix](https://software.imdea.org/~aleks/papers/geompred/geomtr.pdf#page=20).

## Robustness and guarantees
DOCUMENTED: semantics-preserving expression transformations plus forward error analysis yield exact predicate signs **conditional on** IEEE round-to-nearest/ties-to-even and absence of underflow/overflow. Expansions do not cure exponent exhaustion. The authors explicitly suggest falling back to another exact arithmetic (e.g. rationals) on exceptions, and note that Standard ML's Basis Library did not provide the necessary floating-point exception/status controls. x87 excess internal precision is identified as another soundness hazard. [§§2,7](https://software.imdea.org/~aleks/papers/geompred/geomhosc.pdf#page=25).

INFERRED: this is a formal rule-based derivation, not evidence of a machine-checked proof or a universally verified compiler. Do not turn “functional language” into a claim of allocation-free execution: memoized suspensions, captured environments, and variable-length expansions need storage. [Target semantics and performance discussion](https://software.imdea.org/~aleks/papers/geompred/geomhosc.pdf#page=12).

## Parallelism and performance
DOCUMENTED: no GPU/multicore measurements. The C backend handles single-stage source programs; SML naturally supports staging. On Pentium II 266 MHz/96 MB, Table III reports generated/Shewchuk runtime ratios 1.197 orient2d, 1.092 orient3d, 0.870 incircle, and 2.387 insphere. The tested random coordinate exponents were -63 through 63, not the full double range. [§5,Table III](https://software.imdea.org/~aleks/papers/geompred/geomhosc.pdf#page=22).

DOCUMENTED whole-application experiment: Triangle on 50,000 points: uniform random 1410.3 vs 1187.1 ms, tilted grid 3677.5 vs 2060.4 ms, cocircular 1578.3 vs 1190.2 ms (generated vs hand-coded). The authors attribute part of the gap to naïve array allocation/lifetime handling in the C translator, particularly for insphere, rather than an unavoidable compiler-method penalty. No new benchmarks ran here. [Table IV](https://software.imdea.org/~aleks/papers/geompred/geomhosc.pdf#page=23).

## Known failures, limitations, war stories
DOCUMENTED: no exact-to-approximate feedback after a shared exact stage is computed; this is future work. Higher-order function arguments and recursion remain future work and would complicate/error-bound analysis. Polynomial-only language cannot directly classify algebraic SSI roots. Deferred work reduces recomputation but increases retained memory; variable-length expansions and naïve temporary arrays caused measured slowdown. No project issue tracker was located; these limitations are explicit §§5–7. [Discussion](https://software.imdea.org/~aleks/papers/geompred/geomhosc.pdf#page=23).

## Relevance for wonky
INFERRED adaptation from the paper's compiler model:
- Use its **stage/phase separation** for a persistent immutable “plane predicate context” reused across hundreds of mesh vertices. Hoist fixed-face coefficients, permanent factors, denominator certificates, and source-provenance references; preserve exactly which original inputs the predicate represents.
- F32 is eligible for a *newly derived* first filter using epsilon=2^-24 with the correct normal-number assumptions, not binary64 constants. F32x2 can supply a second approximate tier but requires its own operator error model; it is not the paper's expansion stage and must not inherit its error bounds by name.
- In the first Bend prototype, use A → fixed U32 exact fallback rather than port all B/C/D expansion machinery. This combines Nanevski's staged reuse with Fortune/Van Wyk's bounded-width specialization. If performance later justifies more tiers, generate each correction graph and error certificate explicitly.
- F32 expansions can work on a certified bounded-exponent domain; they are **not categorically impossible**. The unsafe assertion is that arbitrarily many F32 components solve exponent range. For unrestricted supported input exponent spans, use software exponents/multi-limb dyadics and explicit overflow/width failure.
- Replace mutable memoized thunks with immutable precomputed records or bulk phase passes. Group unresolved predicates by operation/stage/width and balanced fork–join them. Sharing affine-array records may require deliberate duplication or indexing; pure syntax alone does not eliminate Bend's ownership/copy cost.
- Generate a liveness schedule for temporaries; insphere shows why preserving every intermediate can be worse than recomputation. Keep sign result, filter bound, numeric stage, construction ID and failure reason inspectable for Boolean/debugging provenance.
This helps mesh/planar Boolean decisions and cached face queries, not nonlinear fillet/offset root isolation by itself. [Basis: §3/§4/§5](https://software.imdea.org/~aleks/papers/geompred/geomhosc.pdf#page=10).

## Pointers worth porting or studying
DOCUMENTED: eqs.(2)–(3), Fig.3 correction decomposition, Figs.4–7 source/target/staging semantics, Tables I–II complete small example, §4.2 free-variable retention, technical-report Appendix A.2–A.5 complete rules. Local PDFs: <repo>/tmp/research/pdf/nanevski-blelloch-harper-2003.pdf and <repo>/tmp/research/pdf/nanevski-2001-technical-report.pdf. [Journal preprint](https://software.imdea.org/~aleks/papers/geompred/geomhosc.pdf), [report](https://software.imdea.org/~aleks/papers/geompred/geomtr.pdf).

## Verdict: adapt
Excellent compiler architecture for a functional kernel: separate partial application, precision phases, error certificates, and liveness. Adopt these ideas, not a literal SML-thunk/variable-expansion runtime port. Open work is proving F32/F32x2 bounds and designing immutable staged contexts; there is no evidence here for a ready-to-use Bend generator.

## Sources
[Author preprint](https://software.imdea.org/~aleks/papers/geompred/geomhosc.pdf), [full rules](https://software.imdea.org/~aleks/papers/geompred/geomtr.pdf), [publication metadata](https://api.crossref.org/works/10.1023/A:1025876920522).

