# Rump, Zimmermann, Boldo, Melquiond 2009, Computing predecessor and successor in rounding to nearest
- **Kind / canonical URL:** numerical-analysis paper; [author-hosted PDF](https://www.tuhh.de/ti3/paper/rump/RuZiBoMe08.pdf), [HAL record](https://hal.science/inria-00337537).
- **Authors / venue:** Siegfried M. Rump (TU Hamburg-Harburg/Waseda), Paul Zimmermann (INRIA Nancy), Sylvie Boldo (INRIA Saclay), Guillaume Melquiond (INRIA–Microsoft joint centre); BIT 49(2):419–431, 2009. DOCUMENTED, PDF front page.
- **License:** no standalone implementation license established from the PDF. Read/use the mathematical results and write a fresh implementation; do not assume article text or linked proof source is public domain. Separate proof/code licenses would need checking before copying.
- **Status:** historical published paper, 12-page author copy read in full on 2026-09-24. No canonical source repository inspected; repository stars, contributors and releases N/A. Local PDF: <repo>/tmp/research/pdf/rump-predsucc.pdf.

## What it is
DOCUMENTED: computes outer bounds on the immediate predecessor and successor of a finite floating-point number using only round-to-nearest arithmetic. Binary arithmetic gets almost-always-exact neighbors with a branch-free algorithm, and always-exact neighbors with a three-case algorithm. Wrapping the correctly rounded result of an operation yields an enclosure of its exact value without changing the rounding mode. This is not by itself interval evaluation of an entire expression: inflate EACH operation or propagate a separate error certificate. [Paper §§1–2](https://www.tuhh.de/ti3/paper/rump/RuZiBoMe08.pdf).

## How it works
DOCUMENTED notation [paper Eqs.1.1–1.5](https://www.tuhh.de/ti3/paper/rump/RuZiBoMe08.pdf): u is half the gap from 1 to its successor, eta the smallest positive subnormal. For binary32, u=2^-24, eta=2^-149. RN denotes an actual rounded operation. The rounding model for finite results is RN(a op b)=(a op b)(1+lambda)+mu, |lambda|≤u, |mu|≤eta/2, with at least one of lambda,mu zero; for addition/subtraction mu is always zero under gradual underflow.

**Algorithm 1, branch-free neighbor bounds:**
1. Precompute phi=succ(u)=u(1+2u) in binary (general even radix beta: u(1+4u/beta)). For binary32 this is exactly 2^-24+2^-47; replacing it with u loses the proof.
2. e=RN(RN(phi·abs(c))+eta).
3. lower=RN(c−e), upper=RN(c+e).

Theorem 2.1 proves lower≤pred(c) and succ(c)≤upper. Theorem 2.2 shows equality for binary, ≥4 precision bits, ties-to-even or ties-away, EXCEPT when |c| is in [eta/(2u),2eta/u], the two binades around the smallest-normal threshold. In that range Algorithm 1 can return the second predecessor/successor, still a valid enclosure. For binary32 this exceptional band is [2^-126,2^-124]. Thus “branch-free exact nextafter replacement for every input” is false. [Algorithms 1–2 / Theorems 2.1–2.3](https://www.tuhh.de/ti3/paper/rump/RuZiBoMe08.pdf).

**Algorithm 2, exact binary neighbors:**
- If |c|≥eta/(2u²), set e=RN(phi·|c|), return RN(c−e), RN(c+e).
- Else if |c|<eta/u, return RN(c−eta), RN(c+eta).
- Else set C=RN(c/u), e=RN(phi·|C|), return RN(RN(C−e)·u), RN(RN(C+e)·u).

INFERRED direct binary32 constants: first threshold 2^-102, second 2^-125; rescale by 2^24 and back by 2^-24. These are instances of the proven formulas, not experimentally selected epsilons. Keep exact branch boundaries and rounding sequence. Equation 2.17 encloses a op b when c is its finite RN result; sqrt is also covered when correctly rounded. The output is an enclosure of the underlying exact operation on the given float inputs, not of unknown unrounded model coordinates. [Paper pp.8–10](https://www.tuhh.de/ti3/paper/rump/RuZiBoMe08.pdf).

## Robustness and guarantees
- DOCUMENTED: IEEE-style gradual underflow and monotonic round-to-nearest, finite input c, and the stated precision/exponent prerequisites. Theorems 2.1 and 2.2 were formally checked in Coq; the paper links [the original proof location](http://lipforge.ens-lyon.fr/www/pff/AlgoPredSucc.html), not retrieved in this pass. Theorem 2.3 additionally requires eta/(2u³) not to overflow. [Paper §2](https://www.tuhh.de/ti3/paper/rump/RuZiBoMe08.pdf).
- DOCUMENTED: Algorithm 1's neighbor-bounding theorem remains valid with FMA for its e calculation; this specific statement must not be generalized to arbitrary fused predicate evaluation. It does not promise all sharpness properties under that substitution. [Remark after Theorem 2.1](https://www.tuhh.de/ti3/paper/rump/RuZiBoMe08.pdf).
- DOCUMENTED: c must be finite in the enclosure theorem. NaN/Inf and an overflowing source operation require explicit handling; the timing table's special-value measurements do not enlarge the theorem's domain.
- INFERRED: FTZ invalidates the eta term and gradual-underflow lemmas. Replacing eta with the smallest normal 2^-126 is NOT established by this paper; it might produce a conservative envelope in a specified FTZ model, but requires a new proof covering all operations, endpoint rounding and input denormals. DAZ can discard a tiny input before multiplication by a large factor, creating error far larger than the smallest normal. Merely patching output inflation cannot account for that. Likewise “clamp away subnormals” changes input semantics unless the change is explicitly certified.
- INFERRED: even when c is normal, phi·|c| can be subnormal; testing only the result's exponent is insufficient. For the uncomplicated Algorithm-2 large branch, |c|≥2^-102 ensures its product scale is normal, but source-operation error and boundary handling still need their own checks. [Algorithm 2](https://www.tuhh.de/ti3/paper/rump/RuZiBoMe08.pdf).

## Parallelism and performance
DOCUMENTED: Algorithm 2 ordinary-range cost is two flops for one neighbor or three for both; Algorithm 1 intentionally avoids the branch. Historical binary64 timings for 10 million calls, 2.667 GHz Core 2/Linux/GCC 4.3.0: ordinary inputs [2^-969,2^1024) 0.464 s vs nextafter 1.020 s; subnormal inputs [2^-1074,2^-1022) 30.743 s vs 12.434 s. This is explicitly NOT uniformly faster near underflow. [Paper p.11](https://www.tuhh.de/ti3/paper/rump/RuZiBoMe08.pdf). No local measurement performed.

INFERRED: Algorithm 1 is tiny pure straight-line F32 and suitable for uniform GPU/fork-join batches. Algorithm 2 has three data-dependent cases; implement selection only if all eagerly evaluated branches are made safe, or bucket inputs. Interval products need four endpoint products and extrema, each inflated appropriately; division needs a denominator interval excluding zero. None of those larger interval APIs comes for free from next-neighbor functions.

## Known failures, limitations, war stories
DOCUMENTED: dropping eta fails near underflow; inflating by the older 2u·|c| formula can make an interval four ulps wide when two suffice. Algorithm 1 can be one extra neighbor loose in the two-binade exception. There is no universal multiplier phi-prime that simultaneously returns unchanged small addition results and exact neighbors elsewhere, as counterexamples on p.10 show. Wider input intervals diminish the benefit relative to other inflation schemes. [Paper pp.2–3,6,10–12](https://www.tuhh.de/ti3/paper/rump/RuZiBoMe08.pdf). No canonical issue tracker identified.

## Relevance for wonky
INFERRED from [the algorithms and arithmetic model](https://www.tuhh.de/ti3/paper/rump/RuZiBoMe08.pdf):
- A useful reference for a pure-Bend RN-only interval layer: certified scalar evaluations, bounding boxes, sign filters, and root isolation in future SSI/fillet work. Certified enclosures can support geometric deviation checks, but these are rounding bounds, not user/FDM tolerances.
- Requires no mutation, libraries, f64, directed rounding or FMA. Use U32 tags to represent empty/unknown/unbounded intervals and explicit failure rather than assuming quiet NaNs survive all backends.
- U32 float bit reinterpretation, if Bend reliably provides it, offers a separate exact-neighbor implementation; it still cannot rescue FTZ arithmetic before/after the neighbor call. This option needs independent specification, not a citation to this algorithm.
- For predicates, route intervals containing zero to exact U32 evaluation; interval overlap is NOT equality. For curved roots, use subdivision/isolation or fail as unresolved. An F32x2 midpoint does not remove the need to certify the radius.
- Validation plan (not executed): signed zero, both neighbors of powers of two, min normal, subnormal transitions, max finite, ties, and source-operation overflow; differential checks across JS/C/Metal with precise backend semantics.

## Pointers worth porting or studying
[PDF](https://www.tuhh.de/ti3/paper/rump/RuZiBoMe08.pdf): Eq.1.1 (rounding model), Algorithm 1 and Theorems 2.1–2.2 (bounds/sharpness), Algorithm 2 and Theorem 2.3 (true neighbors), Eq.2.17 (operation enclosure), p.10 counterexamples, p.11 timing table. Local PDF <repo>/tmp/research/pdf/rump-predsucc.pdf.

Sources: [author PDF](https://www.tuhh.de/ti3/paper/rump/RuZiBoMe08.pdf), [HAL](https://hal.science/inria-00337537), [original proof pointer](http://lipforge.ens-lyon.fr/www/pff/AlgoPredSucc.html).

## Verdict: adapt
Adopt the RN-only enclosure strategy where gradual underflow is guaranteed; adapt/prove a separate FTZ-safe path before GPU use. The paper does not justify the task hint's simple eta→min-normal replacement. Open work is that proof and cross-backend validation; no production changes or benchmarks were made.

