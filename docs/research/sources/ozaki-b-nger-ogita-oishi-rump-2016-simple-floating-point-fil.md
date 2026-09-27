# Ozaki et al. 2016, Simple floating-point filters for the two-dimensional orientation problem

- Kind: numerical-analysis research paper. [Author manuscript PDF](https://www.tuhh.de/ti3/paper/rump/OzBueOgOiRu15.pdf); [journal DOI](https://link.springer.com/article/10.1007/s10543-015-0574-9); [publisher-deposited Crossref metadata](https://api.crossref.org/works/10.1007/s10543-015-0574-9).
- Authors: Katsuhisa Ozaki, Florian Bünger, Takeshi Ogita, Shin’ichi Oishi, Siegfried M. Rump; Shibaura Institute of Technology, TU Hamburg-Harburg, Tokyo Woman’s Christian University and Waseda University. BIT Numerical Mathematics 56(2), 729–749, 2016; online publication July 25, 2015. DOCUMENTED, manuscript affiliations and DOI metadata.
- License: no permissive code/content license stated in the downloaded manuscript. Crossref lists Springer text-and-data-mining terms, not an open-source implementation license. INFERRED: independently implement the mathematics with citation; do not treat available PDF/pseudocode as an unrestricted source-code license. No external kernel is needed.
- Status: historical peer-reviewed paper, not a software repository; stars, releases and contributor counts do not apply. All 20 manuscript pages were read. Local copy: `<repo>/tmp/research/pdf/ozaki-orientation-filters-2016.pdf`. No tests/builds were run.

## What it is

DOCUMENTED: a one-branch semi-static filter for the sign of a 2D orientation determinant, with an unusually careful proof covering IEEE overflow and **gradual** underflow. It either certifies the computed nonzero sign or requests a more robust fallback. A second, fully static filter precomputes a bound for all point triples in a dataset. It is not an exact orientation implementation by itself and does not implement orient3d, in-circle, or point-plane tests ([PDF](https://www.tuhh.de/ti3/paper/rump/OzBueOgOiRu15.pdf), §§1–4).

## How it works

DOCUMENTED arithmetic contract: binary32 **or** binary64, every operation rounded to nearest with ties to even, with IEEE subnormals. Define unit roundoff `u=2^-24` or `2^-53`; `uN` is the smallest positive normal, and `uS` the smallest positive subnormal. These are distinct: for binary32 `uN=2^-126`, `uS=2^-149`. The paper already includes binary32 in its theorem scope; it is not binary64-only (§2).

DOCUMENTED Algorithm 3, preserving this exact unfused evaluation graph:
```text
x1=RN(ax-cx); x2=RN(by-cy)
x3=RN(ay-cy); x4=RN(bx-cx)
l=RN(x1*x2); r=RN(x4*x3)
det=RN(l-r)
s=RN(l+r)
e=RN(theta * RN(abs(s)+uN))
if abs(det)>e: return certified sign(det)
else: return uncertain and invoke robust fallback
```
Here `phi=2*floor((-1+sqrt(4/u+45))/4)` and `theta=3u-(phi-22)u^2`. These are offline constants, not runtime square roots. INFERRED by direct substitution into the documented formula: binary32 gives `phi=4094`, `theta=3*2^-24-4072*2^-48`, exactly representable in binary32. Encode a precomputed constant with reviewed bit pattern; do not recompute it using an optimizing low-precision expression at every call. Source: [PDF](https://www.tuhh.de/ti3/paper/rump/OzBueOgOiRu15.pdf), Lemma 3.1, Theorem 3.1, Eq. 3.31 and Algorithm 3.

DOCUMENTED proof architecture, useful for deriving another predicate:
1. Bound a product of two rounded differences relative to its **computed** product. Lemma 3.1 gives `|RN((a+b)(c+d))-(a+b)(c+d)| <= (3u-(phi-14)u^2)*|computed product| + S`, where `0<=S<(1/2+3u/2)uS`, and `S=0` if the computed product is normal. The improved coefficient uses `ufp(x)=2^floor(log2|x|)` and representability structure, not just a generic gamma bound.
2. If final subtraction is exact, Theorem 3.1 bounds product/difference errors using `RN(theta*RN(|l|+|r|))+(1.5+3u)uS`. If final subtraction rounds, Sterbenz’s theorem implies the terms are sufficiently separated that its sign is already safe (Theorem 3.2). This argument depends on the same IEEE arithmetic model.
3. Theorem 3.3 replaces explicit subnormal constants with the normal constant **inside** the multiplication: `RN(theta*RN(RN(|l|+|r|)+uN))`. Successor spacing proves enough margin despite RN evaluation of the bound.
4. Theorem 3.4 permits `abs(RN(l+r))` instead of `RN(|l|+|r|)`: when l/r have opposite signs, the determinant is a large sum, so the smaller threshold still certifies a correct sign. Do not silently change this into a generic cancellation-bound recipe for unrelated expressions.
5. Theorem 3.5 handles overflow through IEEE NaN/Inf comparison semantics. Many overflow paths yield a false strict comparison and fallback; some opposite-sign final-subtraction overflows can safely return the sign of infinity.
All five steps: [PDF](https://www.tuhh.de/ti3/paper/rump/OzBueOgOiRu15.pdf), pp. 7–16.

DOCUMENTED fully static alternative: reduce coordinate minima/maxima, compute `alpha=RN(max_x-min_x)` and `beta=RN(max_y-min_y)`, then
```text
T2=RN(2*alpha*u*ufp(beta) + 2*beta*u*ufp(alpha)
      + 2*u*ufp(RN(alpha*beta)) + 2*u^2*ufp(alpha)*ufp(beta))
Estatic=succ(RN(T2 + 3*u*ufp(T2)))
```
Use the exact grouping specified in §4/Eqs. 4.2–4.3. The analysis has a no-underflow precondition and bounds all triples using the dataset ranges. The authors suggest power-of-two scaling if necessary. `succ` is the next representable number, not an arbitrary epsilon. INFERRED: a Bend implementation could extract `ufp` and successor via U32 bit manipulations with explicit zero/subnormal/overflow cases. Computing a smaller static bound for each immutable tile may be useful, but is a new algorithmic application, not a measured paper result. Source: [PDF](https://www.tuhh.de/ti3/paper/rump/OzBueOgOiRu15.pdf), §4.

## Robustness and guarantees

- DOCUMENTED: accepted results have the true sign of the determinant of the *represented input coordinates*. The filter does not certify exact geometric constructions rounded before these coordinates were formed. Rejection means unknown, never collinear. Algorithm 3 cannot even directly certify `(1,1),(2,1),(3,1)` as collinear (p. 16).
- DOCUMENTED: only RN operations are needed, but the proof is not independent of compiler semantics. The experiments use `/fp:precise` for filters; changing evaluation order is explicitly disallowed for their a-priori estimates. Contraction, reassociation, saturating arithmetic or assumptions removing NaN/Inf behavior require a new proof (p. 17).
- DOCUMENTED: underflow protection here is gradual-underflow IEEE protection, **not FTZ/DAZ protection**. The proof treats sums/differences of representable floats as satisfying a relative rounding model even in the subnormal region, and gives the additive `uS/2` term specifically for products (Eqs. 3.1–3.4). Flushing an exact tiny subtraction to zero destroys that premise.

**INFERRED counterexample to the seed’s proposed easy FTZ adaptation.** Let `N=2^-126`, `S=2^-149`, and take binary32-representable inputs `A=(2^30,N+S)`, `B=(2^55,2N)`, `C=(0,N)`. All nonzero coordinates are normal. Under the documented applegpu-style F32 FTZ model, `RN(ay-cy)=S` flushes to zero. The computed products become `l=2^-96`, `r=0`, so the filter accepts a positive determinant against a bound near `3*2^-120`. The exact determinant is `2^-96-2^-94=-3*2^-96`, negative. The error from the lost subtraction is amplified by `bx`; merely changing an underflow constant to `2^-126` is not a proof and cannot generally repair this. This is an analytic derivation, not a hardware test. Evidence for the distinct FTZ model: [applegpu F32 conversion](https://github.com/dougallj/applegpu/blob/4c5bae61086b8067231120c98b4756d7696d399c/fma.py#L194-L247); source for the filter’s actual assumptions: [PDF](https://www.tuhh.de/ti3/paper/rump/OzBueOgOiRu15.pdf), §3.

## Parallelism and performance

DOCUMENTED Table 3.2: incremental convex hull on `n=10^8` standard-normal random points; **every predicate was resolved by the filter**, no robust fallback executed. Reported computing-time entries for plain arithmetic / Shewchuk filter / Melquiond–Pion filter / new filter are Intel C `7.37 / 9.58 / 13.4 / 7.74` and Visual C `7.76 / 13.6 / 17.7 / 7.97`; the manuscript table does not explicitly label a time unit. More portable are its ratios: new filter 1.05× and 1.03× the unsafe plain baseline, versus 1.30×/1.75× and 1.82×/2.28× for the alternatives. Compilers: Intel C++ 13 and Visual C++ 2010, C code through MATLAB MEX, precise flags for filtered variants. No CPU model/GPU benchmark is supplied in this section. Do not extrapolate to degenerate CAD input or Bend throughput ([PDF](https://www.tuhh.de/ti3/paper/rump/OzBueOgOiRu15.pdf), pp. 16–17).

DOCUMENTED Tables 4.1–4.2: the new fully static bound divided by their previous bound has mean 0.5766 for 100 sets of 10,000 normally distributed points and 0.1250 for uniform points; these are **bound sizes**, not speedups (pp. 18–19).

INFERRED: the fixed seven-operation determinant plus short bound calculation maps very well to immutable tuples and balanced fork-join. On a GPU, batch the fixed-cost filters and process uncertain cases in separate fixed-limb-size buckets. All-lane collinear data will reject, so low fallback rate in the paper’s random benchmark is not a CAD prediction.

## Known failures, limitations, war stories

DOCUMENTED: §2.1 demonstrates a naive early-return Shewchuk filter accepting zero after products underflow even though the exact binary64 determinant is `2^-1401`. This is a warning about that isolated filter under out-of-contract input ranges, not evidence that every robust-predicate implementation has that bug. §2.2 shows range guards unnecessarily rejecting easy problems. Algorithm 3 cannot identify exact zero and leaves fallback design to the caller. Fully static bounds assume away underflow unless inputs are safely scaled. No paper issue tracker or separately licensed implementation was located ([PDF](https://www.tuhh.de/ti3/paper/rump/OzBueOgOiRu15.pdf), pp. 5–6, 16, 18).

## Relevance for wonky

INFERRED: use this as a proof/implementation template for the **first scalar F32 orient2d filter**, before an F32x2 filter or U32 exact fallback. Do not replace a proven filter merely with a larger epsilon. Three safe engineering routes are (a) prove an exponent-domain precondition preventing every relevant FTZ event; (b) rescale exactly from original bit representations and prove the scaled DAG; or (c) derive an FTZ-aware bound carrying subtraction/input-flush errors through subsequent products. Reject outside the qualified domain to integer-only exact predicates. A simple input exponent window alone is insufficient without residual/product/bound analysis.

INFERRED: the seed claim that this filter is directly applicable to `point_plane` is too strong. Its special two-product structure and Sterbenz case analysis must be rederived for a three-term dot product, orient3d determinant or implicit SSI predicate; construction error in plane coefficients needs a separate budget. It helps planar arrangements, tagged-mesh Boolean decisions and FDM topology reliability, not fillet/offset construction or exact analytic recovery by itself. Use original unperturbed sign=zero in the exact fallback, with SoS as a separate semantic layer. No mutation, FFI, directed-rounding primitive or F64 scalar is required for the qualified F32 filter; multi-limb exact fallback remains necessary. Source basis: [PDF](https://www.tuhh.de/ti3/paper/rump/OzBueOgOiRu15.pdf), footnote 1 and §§2–4.

## Pointers worth porting or studying

- [PDF §2](https://www.tuhh.de/ti3/paper/rump/OzBueOgOiRu15.pdf): precise binary32/binary64 model, baseline filters and underflow counterexample.
- Same PDF, Lemma 3.1 and Theorems 3.1–3.5: computed-result bounds, Sterbenz split, subnormal-to-normal guard transformation, signed-sum optimization, IEEE overflow logic.
- Same PDF, Algorithm 3 p. 16: compact port target; Table 3.2: compiler flags and carefully scoped performance comparison.
- Same PDF, §4/Eqs. 4.2–4.3: range-reduction static bound with U32-friendly `ufp`/successor operations.

## Verdict: adapt

Excellent RN-only, low-branch filter design and derivation template. Port the binary32 version only within a proved non-FTZ domain or after a fresh FTZ-aware proof; **do not** transplant the IEEE-underflow guarantee to Metal by substituting a constant. Keep an integer exact fallback and explicit unknown result.
