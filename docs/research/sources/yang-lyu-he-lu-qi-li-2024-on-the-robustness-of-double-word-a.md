# Yang et al. 2024, On the robustness of double-word addition algorithms

- Kind: numerical-analysis preprint. [Canonical arXiv record](https://arxiv.org/abs/2404.05948); [version-pinned PDF](https://arxiv.org/pdf/2404.05948v2); [HTML](https://arxiv.org/html/2404.05948v2).
- Authors: Yuanyuan Yang, XinYu Lyu, Sida He, Xiliang Lu, Ji Qi and Zhihao Li, Huawei Technologies and Wuhan University; Yang/Lyu contributed equally. Submitted April 9, 2024, v2 April 10; PDF front matter dated April 11, 2024. DOCUMENTED, arXiv record and first page.
- License: arXiv [non-exclusive distribution license](https://arxiv.org/licenses/nonexclusive-distrib/1.0/), **not** a permissive code license or a public-domain dedication. INFERRED: implement mathematical ideas independently and cite them; separately check QD/SLEEF licensing before copying their code. This note does not propose linking either library.
- Status: the retrieved arXiv record lists v2 and no journal reference; treat as a preprint, not as a separately verified peer-reviewed result. No source repository, release or issue tracker for these experiments was linked in the paper; repository metrics do not apply. All 19 pages including proofs/tables/references read. Local PDF: `<repo>/tmp/research/pdf/yang-double-word-addition-2024.pdf`.

## What it is

DOCUMENTED: analyzes QD-style double-word addition with partially overlapping high/low components, under round-to-nearest and broader faithful rounding. The practical target is removing a multiplication’s final normalization before a following addition and replacing accurate addition by cheaper sloppy addition in suitable multiply-add workloads. It separately studies directed-rounding interval arithmetic. It is **not** a proof that two floats are exact, that all cancellations retain twice the precision, or that RN hardware automatically supplies enclosing intervals ([PDF](https://arxiv.org/pdf/2404.05948v2), §§1–4).

## How it works

DOCUMENTED representation: an unevaluated pair `(xh,xl)` means the real sum `xh+xl`. A conventional normalized pair has `RN(xh+xl)=xh`; the more general analysis permits `|xl|<=ox*u*|xh|`, `|yl|<=oy*u*|yh|`. The overlap factor `o=max(ox,oy)` is explicit. Theorems 3.2–3.5 assume precision `p>=6` and overlap factors in `[1,1/(8u)-2]`; practical skipped-multiply-normalization examples have `o≈3`, not an arbitrary giant overlap. If `o` grows like `1/u`, an expression with coefficient `o*u^2` is not uniformly second-order. Source: [PDF](https://arxiv.org/pdf/2404.05948v2), §3.

DOCUMENTED numerical model: radix two, precision p, **unlimited exponent range**, so underflow and overflow are excluded at the outset (§2). Faithful rounding of exact x selects either adjacent representable bracket `{RD(x),RU(x)}` and must preserve exact representable values. The paper uses **different unit-roundoff conventions**: `u=2^-p` for RN, `u=2^(1-p)` for faithful/directed rounding. For binary32 these are `2^-24` and `2^-23`, respectively. Do not reuse the RN constant in a directed-rounding bound.

DOCUMENTED primitive algorithms (Algorithms 1–3):
```text
Fast2Sum(a,b): s=RN(a+b); t=RN(b-RN(s-a)); return (s,t)
2Sum(a,b):
  s=RN(a+b)
  ap=RN(s-b); bp=RN(s-ap)
  da=RN(a-ap); db=RN(b-bp)
  t=RN(da+db); return (s,t)
2Prod(a,b): s=round(a*b); t=FMA(a,b,-s); return (s,t)
```
Under the stated contracts, RN 2Sum is error-free; Fast2Sum needs the exponent-order condition or a special representability argument. FMA in 2Prod is a genuinely fused residual operation, not a separate multiply then subtract. Without FMA the paper points to Dekker splitting. Directed-rounding variants replace primitive RN calls consistently by the specified direction and are not generally error-free summations. Source: [PDF](https://arxiv.org/pdf/2404.05948v2), pp. 3–4.

DOCUMENTED Algorithm 4 (sloppy addition), 11 scalar adds/subtracts under the literal 6-op 2Sum and 3-op Fast2Sum:
```text
(sh,sl)=2Sum(xh,yh)
v=RN(xl+yl)
w=RN(sl+v)
(zh,zl)=Fast2Sum(sh,w)
```
DOCUMENTED Algorithm 5 (accurate addition), 20 scalar adds/subtracts:
```text
(sh,sl)=2Sum(xh,yh)
(th,tl)=2Sum(xl,yl)
c=RN(sl+th)
(vh,vl)=Fast2Sum(sh,c)
w=RN(tl+vl)
(zh,zl)=Fast2Sum(vh,w)
```
These operation counts are derived directly from the displayed algorithms and agree with the later MAA table after accounting for multiplication. They are not measured Bend instruction counts. Source: [PDF](https://arxiv.org/pdf/2404.05948v2), pp. 4–5 and Table 1.

DOCUMENTED key invariant: cancellation can make the second Fast2Sum input larger than the first, but also gives the first input many trailing zero bits. Lemma 3.1 uses `ufp(a)<=ufp(b)` and `uls(a)>=ulp(b)` as a sufficient condition for exact Fast2Sum **even with varying faithful rounding directions across its three operations**. Here `uls` is the weight of the least significant nonzero bit. This is not the usual `|a|>=|b|` proof. Theorems 3.2–3.3 show that moderate input overlap in the addition algorithms preserves an appropriate validity condition. Do not generalize this to arbitrary Fast2Sum calls with swapped magnitudes ([PDF](https://arxiv.org/pdf/2404.05948v2), pp. 4–6).

DOCUMENTED optimized MAA: compute `(ch,cl)=2Prod(xh,yh)`, then approximate `t=cl+xh*yl+xl*yh` (optionally include `xl*yl`). Usually normalize with `Fast2Sum(ch,t)`. When this product immediately feeds double-word addition, omit **that product normalization** and pass `(ch,t)` onward with overlap bounded near `3u`. Keep the addition’s final normalization in the general case. The paper distinguishes this separate multiplication-and-addition sequence, MAA, from a truly fused double-word FMA. It analyzes the modified error `|d-(a*b+c)|/(|a*b|+|c|)`, not the possibly unbounded relative error divided by `|a*b+c|` ([PDF](https://arxiv.org/pdf/2404.05948v2), Algorithm 6, §4.1).

## Robustness and guarantees

**DOCUMENTED absolute versus relative guarantees.** Both addition variants tolerate moderate overlap with an input-magnitude-scaled error of order `u^2*(|x|+|y|)` (constants depend on overlap and rounding mode). Accurate Algorithm 5 has an RN relative-error bound `(3o+15)u^2+O(u^3)` under Theorem 3.5, including severe cancellation. In RD/RU the same theorem additionally requires changing the low-part `2Sum(xl,yl)` to a magnitude comparison plus Fast2Sum, and low-part signs consistent with the stated rounding representation (`xl,yl>=0` in RD; `<=0` in RU). The unmodified directed-rounding Algorithm 5 is **not** covered by the stronger relative claim; p. 12 gives a double-precision RD example with relative error about `2^-54`, not O(u^2). [PDF](https://arxiv.org/pdf/2404.05948v2), Theorem 3.5 and proof pp. 11–13.

**DOCUMENTED sloppy-add cancellation exception.** Define `r(xh,yh)=min(|xh|,|yh|)/max(|xh|,|yh|)` for opposite signs, zero otherwise. For strictly RN-normalized inputs and opposite-sign high parts with `r<=1/2`, Theorem 3.4 sharpens sloppy addition to `3u^2+O(u^3)` relative error. In the stronger-cancellation region the result can be only single-precision-relative accurate; when `|xh|` and `|yh|` are consecutive representable floats, the relative error can even be order one. Ties-to-even/ties-away assumptions and exact non-overlap matter. The abstract’s informal “if and only if” description is not an instruction to assume all Sterbenz-region inputs fail. [PDF](https://arxiv.org/pdf/2404.05948v2), Theorem 3.4, Remark 3.2, pp. 7–11.

**DOCUMENTED interval claim, correctly scoped.** In §4.2, *all primitive operations are already rounded in one chosen directed mode*. The composite double-word additions/multiplication inherit an error sign consistent with that direction, so internal error-free-transform stages need not switch back to RN. This avoids mode switches **within a directed-rounding interval implementation**. It does not say that an RN-only target has known one-sided error, nor that simply negating an arbitrary RN answer gives certified endpoints. INFERRED for Metal: use a separately proved RN-plus-outward-margin strategy or emulate directed operations with representable-neighbor adjustments and proofs; this preprint is not sufficient certification. Source: [PDF](https://arxiv.org/pdf/2404.05948v2), §4.2.

**INFERRED finite-exponent restriction.** Binary32 F32x2 can instantiate the p=24 algebra only on a domain where *every relevant intermediate and residual* behaves like the paper’s unbounded model. An exact result below the normal threshold may flush to zero; that is not faithful rounding in the paper’s unbounded representable set. Increasing a global error constant cannot automatically repair loss of tiny residuals, and overflow must explicitly reject. Gradual-underflow results would also require additional analysis; the paper assumes neither kind of range failure occurs. Source basis: [PDF](https://arxiv.org/pdf/2404.05948v2), first paragraph of §2.

## Parallelism and performance

DOCUMENTED Table 1: C++/SIMD binary64-pair GEMM on Intel Xeon Gold 6148, g++ 9.3.0, `-march=skylake-avx512 -O3`, fixed CPU 2.4 GHz / AVX-512 2.2 GHz. Reported double-word throughput goes from **2.17 GFLOPS** (accurate add, both normalizations retained, no comparisons) to **4.20 GFLOPS** (sloppy add, multiplication normalization omitted, addition normalization retained). With AVX512DQ magnitude max/min (`vrangepd`) replacing 2Sum by comparison+Fast2Sum, the corresponding rows are **2.48 to 4.57 GFLOPS**, an approximately 84% gain. The table’s 5.79-GFLOPS row also drops addition normalization and must not be advertised as the general fully normalized guarantee. Ordinary handwritten double GEMM is 65.4 GFLOPS and MKL 67.7 on this setup. Source: [PDF](https://arxiv.org/pdf/2404.05948v2), §5, Table 1.

DOCUMENTED experiment caveats: small matrices kept in cache by warmups, no full blocking/packing, structure-of-arrays layout; these are throughput comparisons, not timings of CAD predicates. Error experiment uses arrays of length `10^6`, random entries in `[-1/2,1/2]`, repeated ten times. Table 2’s largest observed modified error ranges from `4.35e-32` to `6.03e-32` across variants, on binary64 pairs. Random modified-error evidence is not an adversarial cancellation or FTZ test. [PDF](https://arxiv.org/pdf/2404.05948v2), pp. 15–17.

INFERRED Bend fit: immutable high/low tuples and straight-line primitives are excellent. In accurate addition, the two initial 2Sum calls are independent, so `a b = f(x) g(y)` can expose parallel work; most later operations are dependent and per-pair fork overhead may exceed the savings. Prefer wide independent predicates/array operations over tiny nested forks. Fixed algorithms are uniform GPU work; variable renormalization loops and CPU-specific AVX512DQ instructions do not port directly. A balanced reduction changes numerical summation order and needs its own propagated error budget, not a verbatim sequential-BLAS bound.

## Known failures, limitations, war stories

- DOCUMENTED: arbitrary swapped Fast2Sum inputs can cause order-u error, with an explicit sharpness example after Lemma 3.1. The overlap/cancellation proof is what licenses the specific exceptional calls, not the name Fast2Sum.
- DOCUMENTED: sloppy addition can have order-one relative error for adjacent opposite-sign high words (Theorem 3.4); directed accurate addition needs the modification above (Theorem 3.5).
- DOCUMENTED: removing the addition normalization is generally invalid without information on cancellation; favorable SLEEF polynomial-evaluation conditions are discussed separately (§4.1).
- DOCUMENTED: multiplication rounding prevents any universal small relative bound with denominator `|a*b+c|` when c nearly cancels the product; hence the modified metric (§4.1).
- DOCUMENTED scope gap: no FTZ, overflow, Metal, binary32 timing or published implementation issue tracker in this source. It cites earlier formalization/corrections by [Muller and Rideau](https://dl.acm.org/doi/10.1145/3484514), but this note has not independently machine-checked the new preprint’s proofs. All bullets refer to [primary PDF](https://arxiv.org/pdf/2404.05948v2).

## Relevance for wonky

INFERRED: use the paper to define two explicit F32x2 API contracts: a conservatively accurate/normalized operation for construction and a faster overlapping-pair pipeline with recorded overlap and error bounds for qualified filters or polynomial evaluation. Never let a `sloppy` operation silently replace the sign-critical cancellation path. A Boolean/SSI determinant that subtracts nearly equal products is precisely where ordinary relative accuracy fails; certify its absolute error and fall back to integer exact signs if zero cannot be excluded. Input/construction uncertainty must be added separately. Fillet and offset solvers may exploit faster bulk arithmetic, but tolerances still need a world-unit interpretation.

INFERRED: the no-F64/no-FFI constraint is compatible with the formulas after a p=24 finite-exponent qualification. Error-free-product implementations need a true FMA primitive or a verified Dekker split; optimizer contraction must preserve intended operation boundaries. U32 multi-limb arithmetic remains the exact-predicate escape path; F32x2 plus these O(u^2) results is not exact algebraic geometry. Treat hardware claims of merely “faithful” rounding as relevant only after proving that precise bracketing definition and excluding FTZ/overflow. No tests, code port, benchmark or production change was performed. Source basis: [PDF](https://arxiv.org/pdf/2404.05948v2), §§2–4.

## Pointers worth porting or studying

- [Algorithms 1–5, pp. 3–5](https://arxiv.org/pdf/2404.05948v2): exact evaluation graph for primitives, sloppy and accurate addition.
- Same PDF, Lemma 3.1/Theorems 3.2–3.3: trailing-bit invariant that permits specific unsorted Fast2Sum calls with moderate overlap.
- Same PDF, Theorems 3.4–3.5 and Remark 3.2: cancellation-dependent versus cancellation-insensitive bounds and directed-rounding modifications.
- Same PDF, Algorithm 6/§4.1/Eq. 14: omit only the product normalization and propagate an input-scaled absolute error.
- Same PDF, §4.2: read its first sentence before applying the interval result; §5 Tables 1–2: hardware-specific performance and modified-error metric.

## Verdict: adapt

Adapt the overlap bookkeeping and selective normalization optimization after establishing a finite-exponent F32 contract. Keep accurate addition for sensitive cancellation and exact fallback for topology. Reject the seed’s stronger implication that this directly enables certified RN-only Metal intervals: the interval theorem assumes directed rounding, and every main theorem excludes underflow/overflow.

Sources: [arXiv record](https://arxiv.org/abs/2404.05948), [v2 full paper](https://arxiv.org/pdf/2404.05948v2), [arXiv distribution license](https://arxiv.org/licenses/nonexclusive-distrib/1.0/).
