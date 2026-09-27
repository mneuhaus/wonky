# Maekawa, An overview of offset curves and surfaces

- Kind: survey paper. [Canonical publisher page](https://www.sciencedirect.com/science/article/abs/pii/S0010448599000135), [DOI](https://doi.org/10.1016/S0010-4485(99)00013-5), [publisher-deposited metadata](https://api.crossref.org/works/10.1016%2FS0010-4485(99)00013-5).
- Author/year/venue: Takashi Maekawa, Computer-Aided Design **31(3), 165–173, March 1999**. DOCUMENTED by publisher metadata. The later MIT lecture cites an earlier version as Design Laboratory Memorandum 98-2, MIT Department of Ocean Engineering, March 1998; do not confuse that report date with the journal publication. [Lecture bibliography, reference 14](https://ocw.mit.edu/courses/2-158j-computational-geometry-spring-2003/3a77ce2173073840510f548601cd36b4_lecnotes13.pdf).
- License: no open-content or code license established for the 1999 paper; [Elsevier metadata](https://api.elsevier.com/content/article/PII:S0010448599000135?httpAccept=text/xml) reports openaccess=0. Crossref's TDM license is not a permissive software license. The companion hyperbook states copyright Patrikalakis/Maekawa/Cho, all rights reserved. MIT OCW has [CC BY-NC-SA 4.0 terms](https://ocw.mit.edu/terms/), subject to exclusions, which are content-use terms, not a permissive kernel-code license. INFERRED: independently implement mathematical ideas and attribute them; do not copy prose, figures or unspecified software on the assumption that public access grants a permissive license.
- Status: historical journal survey; commits, contributors, stars and software releases do not apply. No implementation or issue tracker was identified for this article.
- **Access/read scope, 2026-09-24:** the original paper remains unavailable. ScienceDirect returned HTTP 403; Elsevier XML yielded bibliographic coredata, not full text. Read the publisher's search-indexed abstract and verified publication metadata. Instead, actually read the explicitly separate primary-source companions: Patrikalakis/Maekawa/Cho's [hyperbook chapter 11](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node210.html), selected sections 11.1.1, 11.2.1–11.2.4, 11.3.1–11.3.2, 11.3.5–11.3.7, 11.4.1–11.4.2, 11.6.2 and 11.6.3.4; and **all 23 pages** of N. M. Patrikalakis' MIT OCW Lecture 13, *Offsets of Parametric Curves and Surfaces*, copyright 2003. These are not passed off as the 1999 paper.
- Local evidence: `<repo>/tmp/research/maekawa-1999.xml`; `<repo>/tmp/research/maekawa-hyperbook-ch11-extracted.txt`; `<repo>/tmp/research/pdf/mit-offset-lecture13.pdf`.

## What it is

DOCUMENTED, **original article's indexed publisher abstract only**: a continuation of Pham's survey through 1992, reviewing later and previously omitted literature in five areas: exact offsets in Bézier/B-spline form, approximation, self-intersections, geodesic offsets, and general offsets. It is a literature map, not a single ready-to-port shelling algorithm. [Publisher abstract](https://www.sciencedirect.com/science/article/abs/pii/S0010448599000135).

The useful technical material below is **DOCUMENTED in the named MIT companions, not claimed as directly read in the 1999 survey**. Their central lesson is that evaluating a normal offset, representing it rationally, detecting its singularities, and selecting a valid trimmed solid boundary are different problems. The original may discuss these topics, but its precise coverage, comparisons and conclusions remain unverified. [Hyperbook introduction](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node212.html).

## How it works

### 1. Normal-offset evaluator and local regularity invariant

DOCUMENTED in [§11.2.1](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node219.html) and [§11.3.1](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node224.html): a planar curve offset is c_d(t)=c(t)+d*n(t); a surface offset is S_d(u,v)=S(u,v)+d*N(u,v). The chapter takes positive curvature when its center of curvature lies **opposite** the chosen normal. With this convention:

    n = (y′,−x′)/sqrt(x′²+y′²)
    c_d′ = (1+d*κ)*c′
    S_du × S_dv = J*(S_u × S_v)
    J = (1+d*κ1)*(1+d*κ2) = 1+2*H*d+K*d².

Here H and K are the progenitor's mean and Gaussian curvatures. An ordinary offset cusp has 1+d*κ=0; a surface loses immersion when either 1+d*κi=0. Where J≠0, the orientation induced by the offset parameterization is sign(J)*N, not necessarily N. These equations expose a singularity before attempting surface fitting. They also show why blindly carrying the source face orientation through an offset can be wrong. [Equations 11.3–11.9 and 11.17–11.28](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node224.html).

INFERRED implementation rule: choose and document one normal/curvature convention for wonky. Translate the formula if using the opposite shape-operator sign; do not mix the book's plus sign with a library's minus-sign curvature. A local nonzero J proves neither global injectivity nor a valid shell. [Distinct local/global mechanisms](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node220.html).

### 2. Turn radical equations into polynomial systems without discarding branches

DOCUMENTED in [§11.2.3, equations 11.11–11.16](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node221.html): introduce a speed variable ρ satisfying ρ²=x′²+y′². For polynomial c, cusp locations solve two polynomial equations instead of a radical equation. Equivalently, defining A=x′y″−y′x″ gives

    d*A + ρ³ = 0
    ρ² − (x′²+y′²) = 0.

Self-intersections solve c_d(σ)=c_d(t), σ≠t. Introduce speed variables ω at σ and ρ at t, clear denominators, and solve four polynomial equations in (σ,t,ω,ρ). Bézier subdivision and the Interval Projected Polyhedron (IPP) solver provide parameter-box candidates without requiring a Newton initial guess. B-splines are split into Bézier segments; both each segment's self-intersections and all relevant pairs of different segments must be considered.

INFERRED mandatory port details: impose **ρ>0, ω>0** for the intended unit-normal sheet, reject progenitor speed zero, and recheck the unsquared original equations. Squaring alone adds wrong-sign branches. The diagonal σ=t is an entire trivial solution family. The text describes algebraic manipulation followed by common-factor removal for curves; the raw auxiliary-variable equations must not be naïvely divided by σ−t without that derivation. For distinct source segments σ=t need not be a trivial root at all. [Same section](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node221.html).

### 3. Surface self-intersection needs complete seeds, not boundary marching alone

DOCUMENTED in [§11.3.5](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node228.html): let A=S_u×S_v be the unnormalized normal. At two parameter points p=(σ,t), q=(u,v), introduce η=|A(p)| and ζ=|A(q)|. The system is

    η*ζ*(S(p)−S(q)) + d*(ζ*A(p)−η*A(q)) = 0   [three equations]
    η²−A(p)·A(p) = 0
    ζ²−A(q)·A(q) = 0.

For an isolated seed search, fix one of the four original parameters, giving five equations in five unknowns. The two-dimensional diagonal p=q remains a special obstacle. Unlike the planar case, one cannot generally divide the coordinate differences by separate σ−u and t−v factors. [Equations 11.78–11.86](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node228.html).

Closed self-intersection loops can lie wholly inside **both** parameter domains. The companion locates curvature-extremum events in concave regions and pairs of collinear-normal points separated by at most 2*|d|, then splits along isoparametric lines through those events so branches meet subdomain boundaries. Only then is boundary-seeded marching intended to be complete. The prerequisite event-finding stage is substantial, not an optional optimization. [§11.3.5 and Figure 11.26](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node228.html).

DOCUMENTED details of its diagonal filter: run IPP with coarse accuracy **10^-1 to 10^-2**, extract candidate subpatches via de Casteljau, build normal bounding pyramids and translate their apexes to the origin. The text says that **intersecting** pyramids cause boxes to be classified as trivial and excluded. It then restarts on retained boxes at high accuracy, e.g. **10^-8**. These are solver accuracies in this construction, not a universal world-space CAD tolerance. The decoded original HTML and its equation alt text were checked directly; an automated page summary had inverted this test and misreported the tolerances. [Original paragraph](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node228.html).

INFERRED caution: overlapping **bounds** on normals do not by themselves prove identical parameter points or rule out every nontrivial root in a coarse box. Do not transplant the exclusion as a universal certified rule without studying reference [253] and its hypotheses. A safe wonky implementation must retain uncertain boxes or supply a local injectivity/diagonal-isolation proof. It must also enforce η,ζ>0.

### 4. Trace both pcurves and retain degeneracy diagnostics

DOCUMENTED in [§11.3.6](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node229.html): away from tangency, the world-space intersection tangent is T=(A(p)×A(q))/|A(p)×A(q)|. For each preimage, solve S_du*u′+S_dv*v′=T, yielding a four-component ODE for the two pcurves. Equations 11.92–11.95 express the parameter derivatives using determinants divided by |A|²*J. Both a vanishing cross-normal product and small J are explicit degeneracies.

The [OCW lecture, pp. 13–14](https://ocw.mit.edu/courses/2-158j-computational-geometry-spring-2003/3a77ce2173073840510f548601cd36b4_lecnotes13.pdf) gives a related 3×4 nullspace/cofactor ODE, normalized to arclength in one parameter domain, and uses variable-step/variable-order Adams integration. Do not confuse that parameter-domain arclength with the later hyperbook's world-space arclength formulation. Neither formula alone guarantees complete branch discovery.

### 5. Exact rational offset is a special property, not inherited from NURBS

DOCUMENTED in [§11.4.1](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node232.html): planar Pythagorean-hodograph curves can be built from polynomial a,b,c with

    x′=(a²−b²)*c,  y′=2*a*b*c,  τ=(a²+b²)*c
    x′²+y′²=τ².

The rational unit normal then avoids a nonrational square root on regular sign-consistent intervals. PH is sufficient, not necessary, for rational offsets. Practical flexible PH curves begin with quintics; the chapter gives offset degree 2m−1 for degree-m PH curves, hence degree nine for quintics. Conversely the ordinary parabola admits a degree-six rational **two-sided** offset after reparameterization, even though its offset is not rational in the original t. A rational form can change coverage, multiplicity and side. [Same section](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node232.html).

DOCUMENTED alternative: describe a curve as an envelope of rational oriented lines n(t)·x=h(t), with rational unit n. Solve this equation and its derivative; an offset replaces h by h+d. The analogous surface uses rational tangent planes N(u,v)·x=h(u,v). [§11.4.1](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node232.html), [§11.4.2](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node233.html). INFERRED: preserve this representation when available instead of normalizing arbitrary NURBS derivatives and hoping the result stays rational. Check denominator and envelope-system rank. Rational whole-surface existence does not automatically supply a rational parameterization of a required finite trimmed patch; the companion explicitly flags that issue for ruled-surface offsets.

### 6. Approximation and topology are separate stages

DOCUMENTED in [§11.2.4](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node222.html): the Tiller–Hanson construction offsets each control-polygon leg, intersects consecutive offset legs, retains the knot structure/weights, checks deviation and subdivides if needed. Other surveyed routes use Hermite interpolation, least squares, interval Bézier bounds, or polygonal topology discovery followed by Newton refinement of the true intersection parameters. The companion's reported comparison of least squares and control-polygon methods is a citation to Elber et al., **not an independently read benchmark here**.

DOCUMENTED in [§11.3.7](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node230.html): a plate is bounded by a progenitor, its offset, and ruled side surfaces. An approximate NURBS offset may move each control vertex along a normalized average of incident control-polyhedron facet normals, keep weights, then refine knots. Its described acceptance samples knots and progressively finer interior locations to a prespecified level. Another route recognizes special analytic cases before sampling/interpolating and removing knots within tolerance.

INFERRED: finite sample acceptance is not a certified supremum-distance bound; retain it only as a proposal/fast filter and add interval or derivative-based geometric bounds. Likewise, a polygon may discover a useful candidate topology but can miss small loops without a resolution/completeness argument. An accurate approximating surface can still be the wrong boundary sheet. [Approximation and loop-trimming discussion](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node222.html).

## Robustness and guarantees

No original-paper finite-precision guarantee or tolerance was verified. DOCUMENTED in the companions: the analytic Jacobian identities are exact differential-geometric facts for regular differentiable inputs. Local curvature thresholds detect local loss of regularity, while global constrictions create intersections independently. IPP is proposed for polynomial root-box searches; subdivision, diagonal exclusion, completeness of seeds and subsequent tracing remain distinct obligations. [§11.2.2](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node220.html), [§11.3.5](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node228.html).

INFERRED: no statement here authorizes returning a valid shell merely because J stays nonzero or Newton residuals are small. Certify the physical side, local regularity, global intersections, trimmed region choice, seams and closed manifold topology independently. Even a pipe satisfying r*κ_max<1 needs global end/end, end/body and body/body separation checks; the companion explicitly includes those in its pipe nonsingularity threshold. This threshold is for the stated pipe construction, not an arbitrary B-rep shelling theorem. [§11.6.2](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node237.html), [§11.6.3.4](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node242.html).

## Parallelism and performance

No original-paper timings, scalar type, implementation language or hardware were verified. The inspected chapter/lecture give formulas, solver tolerances and illustrated examples, not a measured multicore/GPU implementation. No numerical speed claim is made.

INFERRED Bend decomposition: map independent analytic offset evaluations and regularity bounds; fork-join Bézier subdivision with immutable coefficient arrays and parameter boxes; balance reductions over candidate patch pairs. Marching is sequential along each branch, but branches can run independently. Adaptive root isolation and variable-order integration are not naturally uniform GPU workloads; separate discovery/refinement from fixed-degree, fixed-budget sample evaluation and bucket equal-depth tasks. Explicitly return unresolved boxes on budget exhaustion. [Algorithmic dependencies](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node228.html).

## Known failures, limitations, war stories

- DOCUMENTED: for c(t)=(t,t²) with the stated clockwise normal, d=-0.3 is regular; d=-0.5 gives an extraordinary point at t=0; d=-0.8 creates ordinary cusps and a loop. Cusp parameters are ±0.5*sqrt(cuberoot(4*d²)−1); self-intersection parameters are ±0.5*sqrt(4*d²−1), for the appropriate negative-d regime and within the selected domain. These are useful different event types, not one interchangeable threshold. [Example 11.2.1](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node220.html).
- DOCUMENTED: a bisextic example has collinear-normal pair distance 0.1367; internal loops appear as |d| exceeds 0.1367/2. This illustrates why searching only the patch boundary misses closed components; the number is example-specific, not a default tolerance. [§11.3.6/Figure 11.29](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node229.html).
- DOCUMENTED: tangent-discontinuous progenitors create offset gaps or overlaps requiring filling/trimming; regular progenitors can also produce cusps and self-intersections. [§11.1.1](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node212.html).
- INFERRED: tangential self-contact makes cross-normal marching singular; auxiliary square roots without sign constraints add unintended branches; coarse normal-bound overlap is not itself a universal proof of triviality. These are implementation warnings grounded in the displayed systems, not issue reports.
- Original 1999 full text is still missing. Geodesic/general-offset sections of that original article were not read. No issue tracker or software war stories should be fabricated.

## Relevance for wonky

INFERRED near-term plan: (1) retain exact analytic offset evaluators for qualified plane/cylinder/cone/sphere/torus cases as they become supported; (2) add scale-aware local regularity and collapse rejection; (3) reuse SSI/Boolean infrastructure to find and trim offset collisions; (4) introduce approximate freeform offsets only with an explicit error contract. For a closed shell, side walls and neighboring-face joins need topology construction, not merely one offset per face. Offsets also underpin rolling-ball fillet-center spines, but general offset/SSI success does not solve vertex blending automatically. [Source rationale](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node212.html).

Bend arithmetic: F32x2 is useful for normalized local derivatives and ODE correction, but adds mantissa precision only, not exponent range or directed rounding. Polynomialization enables U32 multi-limb coefficient/sign calculations; it does **not** make algebraic roots or normalized normals rational. A certified solver needs validated outward enclosures, exact sign predicates where applicable, or algebraic root isolation, with overflow/underflow and denominator checks. Use dimensionless local coordinates and separate world-distance, angular, parameter-box and topology tolerances; do not copy 10^-8 blindly. [Auxiliary-variable basis](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node221.html), [solver tolerances](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node228.html).

Immutable provenance should retain source face, signed distance, source parameters, regularity interval, discarded-sheet reason and geometric error bound. This directly supports introspection, diffs and LLM diagnostics such as OffsetCollapse, TangentialSelfContact or UnresolvedClosedLoop. For FDM shell thickness/clearance, the critical distinction is a true normal-distance construction versus a shifted control net whose approximation error consumes the thickness budget. These are proposed architecture choices, not measured source results.

## Pointers worth porting or studying

- Recover [the original 1999 survey](https://doi.org/10.1016/S0010-4485(99)00013-5) before attributing its detailed evaluations or recommendations.
- [Hyperbook §11.2.3](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node221.html): planar polynomialization and diagonal exclusion; begin with independently verifiable parabola fixtures.
- [§11.3.1](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node224.html): Jacobian/orientation factor J.
- [§11.3.5](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node228.html): closed-loop seeds, five-equation system and limitations of the normal-pyramid filter. Its reference [253], Maekawa/Cho/Patrikalakis, *Computation of self-intersections of offsets of Bézier surface patches*, J. Mechanical Design 119(2), 275–283 (1997), is an **unread follow-up**, not additional verified evidence.
- [§11.4.1–11.4.2](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node232.html): rational normals, dual support functions, finite-patch caveat.
- [OCW Lecture 13](https://ocw.mit.edu/courses/2-158j-computational-geometry-spring-2003/3a77ce2173073840510f548601cd36b4_lecnotes13.pdf): pp. 5–8 sign convention and cusp fixture; pp. 10–14 surface Jacobian and marching; pp. 17–20 explicit quadratic surface offset cases and figures; p. 21 approximation warning.

## Verdict: unreachable

The assigned **1999 paper** was not obtainable in full, so this is not a full-paper review. Retain it as a survey/retrieval lead. The independently read MIT companions are immediately useful to **learn from/adapt** for offset regularity, branch-aware polynomial systems and adversarial tests. Their concrete guidance is preserved here with distinct attribution; neither sampled approximation nor local curvature alone is an acceptable general shelling guarantee.

Sources: [original publisher abstract](https://www.sciencedirect.com/science/article/abs/pii/S0010448599000135), [Crossref metadata](https://api.crossref.org/works/10.1016%2FS0010-4485(99)00013-5), [Elsevier metadata](https://api.elsevier.com/content/article/PII:S0010448599000135?httpAccept=text/xml), [MIT hyperbook chapter 11](https://web.mit.edu/hyperbook/Patrikalakis-Maekawa-Cho/node210.html), [MIT OCW course](https://ocw.mit.edu/courses/2-158j-computational-geometry-spring-2003/), [MIT lecture PDF](https://ocw.mit.edu/courses/2-158j-computational-geometry-spring-2003/3a77ce2173073840510f548601cd36b4_lecnotes13.pdf), [OCW terms](https://ocw.mit.edu/terms/).

