# Lukács, "Differential geometry of G1 variable radius rolling ball blend surfaces" (CAGD 15(6):585-613, 1998)

- Kind: journal paper (paywalled). Canonical URL: https://www.sciencedirect.com/science/article/abs/pii/S0167839698000065 , DOI https://doi.org/10.1016/S0167-8396(98)00006-5
- Other URLs:
  - SZTAKI repository record, no file: https://eprints.sztaki.hu/1762/
  - Companion records: Hermann, Lukács, Várady, "Techniques for variable radius rolling ball blends", in *Mathematical Methods for Curves and Surfaces* 1995, pp. 1-11, https://eprints.sztaki.hu/911/ ; Lukács, Hermann, Várady, "Continuity and self-intersections of variable radius rolling ball blend surfaces", IFIP WG5.2 workshop, Airlie 1996, pp. 369-370, https://eprints.sztaki.hu/1459/
  - Semantic Scholar: https://www.semanticscholar.org/paper/4d5bf0b34a9de25c325e2592d47380caae45506b
- Author: Gábor Lukács, Computer and Automation Research Institute (SZTAKI), Budapest, Geometric Modelling Laboratory (Várady's group). 1998.
- License: Elsevier copyright. The content is differential geometry and is free to re-derive. There is no code.
- Status: historical. OpenAlex lists 30 citations, closed access (checked 2026-09-23).
- **Access note:** the full text could not be obtained. ScienceDirect and ACM return 403, SZTAKI has only a metadata record, and the De Gruyter copy of the follow-up Kós 2000 paper is behind a bot wall. This note uses:
  - the bibliographic record and the Crossref reference list (DOCUMENTED);
  - later summaries (DOCUMENTED secondary);
  - the same mathematics from open primary sources, namely Peternell & Pottmann 1997 and Dahl 2014, which treat the identical object: the envelope of a one-parameter family of spheres with variable radius. These are labelled as such.

## What it is

- DOCUMENTED (secondary; You et al. 2024, https://eprints.bournemouth.ac.uk/40506/1/mathematics-12-03096.pdf p. 3): "Lukács et al. treated variable-radius rolling-ball blending surfaces as the envelopes of one-parameter families of varying-radius balls, which are special cases of discriminant sets. Lukács used the theory of envelopes and discriminant sets to analyse variable-radius rolling-ball blending surfaces, determine the differential geometric invariants of the surfaces, and characterize the progressive and regressive points on the variable-radius rolling-ball blending surfaces."
- DOCUMENTED (Crossref reference list, 29 entries). They show the context:
  - cyclide-based variable-radius blends: Chandru, Dutta & Hoffmann 1990; Dutta 1989; Pratt 1990;
  - parametric VRRB evaluation: Chuang 1995; Denker 1996 "Precise parametric evaluation of variable radius blend surfaces"; Harada 1991;
  - Hermann 1992 "Rolling ball blends, self-intersection"; Hermann et al. 1995; Lukács 1996 "Continuity and selfintersections";
  - envelope and sweep theory: Flaquer 1992 "Envelopes of moving quadric surfaces"; Martin 1990 "Sweeping of three-dimensional objects"; Pegna 1987/1990/1992 including "Geometrical criteria to guarantee curvature continuity of blend surfaces";
  - singularity theory classics: Porteous 1994, Pogorelov 1974, Zalgaller 1975, Monge 1850;
  - Vida, Martin, Várady 1994 survey.
- Contribution, as far as can be established: a rigorous account of **when a variable-radius rolling-ball (VRRB) surface exists, is regular, and is G1 to the two base surfaces**; its first and second fundamental forms and curvature invariants; and the classification of surface points (the "progressive" and "regressive" points of the abstract). The exact definitions of progressive and regressive are **not verified** (full text not read). The reading below is an INFERRED interpretation.

## How it works (the mathematics, from open equivalent sources)

The VRRB is the envelope of spheres Σ(t) with center m(t) and radius r(t), restricted to the arc between the two contact points.

1. **Envelope equations** (DOCUMENTED, Peternell & Pottmann 1997 eqs. 2.1-2.2, `tmp/research/pdf/peternell-pottmann-canalsurf.pdf`):
   - Σ(t): (x − m)² − r² = 0;
   - Σ̇(t): (x − m)·ṁ + r ṙ = 0.

   Their intersection is the **characteristic circle** k(t): the sphere Σ(t) cut by a plane perpendicular to ṁ.
2. **Reality / existence** (DOCUMENTED, P&P eq. 2.4): cos²α = ṙ²/ṁ² ≤ 1. The envelope is real iff **|ṁ|² − ṙ² ≥ 0**. With equality at isolated t the characteristic circle shrinks to a point. With equality on an interval the envelope degenerates to a curve. Dahl states the same condition in Minkowski form (DOCUMENTED, Dahl 2014 Remark 1.2, thesis `tmp/research/pdf/dahl-2014-thesis-improved-blends.pdf`): the curve f(t) = (m(t); r(t)) in R^{3,1} must be space-like, ‖ḟ‖² = |ṁ|² − ṙ² > 0.
3. **Contact with the base surfaces.** The ball touches S_i at P_i = m − r·n_i (oriented normals). Differentiating |m − P_i| = r along the family gives n_i·ṁ = −ṙ (sign depends on orientation). So each contact point lies on the characteristic circle automatically when m(t) stays on the **bisector** of S_1 and S_2 and r(t) is the common distance. INFERRED derivation; it is the standard condition. Dahl phrases it (DOCUMENTED, thesis p. 9-10): the spheres in oriented contact with both surfaces form a 2-dimensional **bisector surface in R^{3,1}**, and "there is a one-to-one correspondence between rolling ball blends between the two surfaces and curves in the bisector surface". Choosing a radius law r(t) means choosing a curve on this bisector surface.
4. **G1 to the base surfaces.** The envelope is tangent to Σ(t) along k(t), and Σ(t) is tangent to S_i at P_i, so the blend is G1 to S_i wherever the envelope is regular at P_i. G1 between two canal pieces holds iff their R^{3,1} curves share tangent lines at the join (DOCUMENTED, Dahl §3.3.1). G2 holds iff the R^{3,1} curves are G2 (DOCUMENTED, Dahl §3.3.2, §3.4.2).
5. **Normal field and principal curvatures** (DOCUMENTED, Dahl eqs. 3.12, 3.28):
   - N_t(θ) = (ṙ/ν)·t + sqrt(1 − ṙ²/ν²)·(cos θ·n + sin θ·b), where ν = |ṁ| and (t, n, b) is the spine's Frenet frame. This is Dahl's sign, with oriented radii. With the unoriented P&P convention, eq. 2.2 gives N·t = −ṙ/ν. Fix the convention once and test it;
   - c_2 = 1/r (the characteristic circle direction);
   - c_1 = (rΛ_1Λ_2 − X)/(r(Λ_1(1 + Λ_2 r) − X)), with Λ_1 = (1/c)·sqrt(1 − ṙ²/ν²), Λ_2 = (ν̇ṙ − r̈ν)/((1 − ṙ²/ν²)ν³), X = r cos θ, and c the spine curvature.
6. **Local self-intersection criterion** (DOCUMENTED, Dahl eq. 3.45): local self-intersections occur where EG − F² = 0. The VRRB is locally regular iff **|r| < Λ_1/(cos θ − Λ_1Λ_2) for all t, θ**. For constant r this reduces to r < 1/|c| (Dahl Thm 3.26): the ball radius must stay below the spine's radius of curvature.
7. **Progressive and regressive points.** INFERRED interpretation, unverified. Along k(t), points where the envelope sheet moves forward (in the direction of ṁ) versus backward relative to the moving sphere. The boundary between them is where the tangent cone half-angle φ, with sin φ = ṙ/ν (Dahl p. 53), and the curvature terms make the parametrization singular. Regressive regions are where a VRRB folds (cuspidal edges) and must be rejected or trimmed.

How the radius law is specified matters for implementation. Variable radius is given along the **original edge** by arc length (Onshape `pointOnEdgeSettings`, see `onshape-help-fillet-and-face-blend.md`). OCCT maps it to a section plane through a guide point (`BlendFunc_EvolRad`, see `occt-modeling-algorithms-guide-and-tkfillet-chfi3d-fillets-c.md`). The correspondence from edge parameter to spine parameter is a modelling choice, and the regularity conditions above must be checked in spine terms after that mapping (INFERRED).

## Robustness and guarantees

- The conditions above are exact analytic criteria: reality |ṁ|² > ṙ², local regularity (eq. 3.45) and G1/G2 inheritance. They are proofs about the smooth object, not algorithms with numerical guarantees.
- Global self-intersection (two distant parts of the blend meeting) is not covered by local conditions. The hyperbook's pipe-surface chapter treats global self-intersection separately (11.6.3, see `patrikalakis-maekawa-cho-shape-interrogation-for-cad-cam-fre.md`).
- Tolerances: none. This is the differential-geometry layer. Any implementation must sample or bound these expressions.

## Parallelism and performance

- No numbers (theory paper; full text not read).
- INFERRED: every criterion is pointwise in (t, θ): ṁ, ṙ, r̈, spine curvature and the Frenet frame. Checking is a uniform per-sample evaluation, suitable for GPU call trees. A certified check needs bounds over intervals of t (interval arithmetic or Lipschitz bounds on the expressions), not samples.

## Known failures, limitations, war stories

- Variable-radius fillets are where production kernels fail most visibly:
  - OCCT routes all variable radius through walking (`BlendFunc_EvolRad`) with no closed-form tier (see the OCCT note);
  - Onshape exposes `VRFILLET_NO_EFFECT` and `TOLERANT_RADIUS_NO_VARIABLE_RADIUS` errors (see the Onshape note);
  - monstertruck rejects closed wires with f(0) ≠ f(1) (`VariableRadiusUnsupported`, see the monstertruck note).
- A variable radius changes the characteristic circle from a great circle of the ball to a small circle (cone half-angle φ with sin φ = ṙ/ν). A radius law that changes faster than the spine advances (|ṙ| → ν) collapses the section (DOCUMENTED, P&P Remark after eq. 2.4). In practice: steep radius ramps over short edges fail.

## Relevance for wonky

- **Scope.** Needed only if wonky supports `opFillet` with `isVariable: true`. For Marc's FDM parts, variable-radius fillets are rare. Constant-radius plane/plane, plane/cylinder and cap-edge fillets dominate (see the OCCT note's "FDM fillet table"). **Low urgency**, as the brief says.
- **What to take now, cheaply.**
  1. **Precondition checks as explicit failures.** Before building any canal-type blend, constant or variable, evaluate:
     - reality: |ṁ|² − ṙ² > 0;
     - regularity: r < Λ_1/(cos θ − Λ_1Λ_2), which reduces to r·κ_spine < 1 for constant r;
     - existence of both contact points.

     On failure, return a named error (for example `FILLET_BALL_TOO_LARGE_AT(t)` or `VR_RADIUS_RAMP_TOO_STEEP_AT(t)`). This matches the project rule "unsupported cases must fail explicitly".
  2. **The R^{3,1} model.** A blend is a curve (m(t); r(t)) on the bisector surface of the two faces. This gives one data structure for constant- and variable-radius blends and cyclides: a cyclide corresponds to a pseudo-Euclidean circle in R^{3,1} (DOCUMENTED, Dahl thesis p. 8-9). It is also a natural diff and naming key: the blend's identity is the (face A, face B, radius law) triple.
- **Bend fit.** All quantities are closed-form per sample (derivatives of m and r, Frenet frame, a few square roots and divisions) and fit F32x2 and uniform GPU work. Ratios like ṙ/ν near 1 lose relative precision (1 − ṙ²/ν² cancels). Evaluate ν² − ṙ² directly as (ν − ṙ)(ν + ṙ) in F32x2. For exact sign decisions on polynomial or rational r and m, the sign of ν² − ṙ² is a polynomial sign, decidable with multi-limb integers.
- **Testing.** The regularity inequality gives a precise "should fail" boundary for property tests: sweep r across 1/κ_spine and assert the kernel switches from success to a named failure at the right place.

## Pointers worth porting or studying

- Peternell & Pottmann 1997, eqs. 2.1-2.4 (envelope and reality condition), open: https://www.dmg.tuwien.ac.at/geom/ig/peternell/canalsurf.pdf
- Dahl 2014 thesis, Ch. 3 (Dahl, "Piecewise rational parametrizations of canal surfaces", *Mathematical Methods for Curves and Surfaces*, LNCS 8177, 2014, pp. 88-111):
  - eq. 3.12 (normal field);
  - eqs. 3.19-3.28 (fundamental forms, principal curvatures);
  - eq. 3.45 and Thm 3.26 (self-intersection);
  - Lemma 3.6 / Alg. 3.8 (rational VRRB parametrization when m and r are rational).

  Open via NVA (the old DUO URL now redirects to a JS app): `tmp/research/pdf/dahl-2014-thesis-improved-blends.pdf`.
- If library access appears, read Lukács 1998 for the exact progressive/regressive classification and the discriminant-set treatment of singular points. That is the one piece not reproducible from the open sources above.

## Verdict: learn-from (full text unreachable)

The paper itself could not be read. Its subject, existence, regularity and G1 of VRRB surfaces, is fully covered at the level wonky needs by the open Peternell-Pottmann and Dahl sources. Use those formulas as preconditions for explicit failure. Defer any variable-radius implementation until the constant-radius tiers are done.
