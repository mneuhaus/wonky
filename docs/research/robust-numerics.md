# Robust and exact geometric computation with limited precision

Chapter of the wonky research knowledge base, 2026-09-24. English.

**Status and method.**

- **Deep reads.** 18 source notes cover this topic. They are under
  [sources/](sources/) and linked in section 2. This chapter re-read all 18
  in full.
- **Publish-first step.** None of the 18 notes had a Markdown file yet. All 18
  were written verbatim from the `markdown` field of
  `tmp/research/notes/<slug>.json`. A scan found no broken fences or emphasis.
  The only unbalanced brackets are half-open intervals in the Rump and Hobby
  notes (mathematics, not broken links), so nothing was changed.
- **Workflow input.** The scout's landscape and catalog. The 29 catalog-only
  sources are in section 7.
- **Checks made for this chapter** (working tree, 2026-09-24, read only):
  - `kernel/real.bend` (the F32x2 `Real`), `kernel/robust-predicates.bend`
    and [../robust-predicates.md](../robust-predicates.md) (the exact tier),
    `kernel/intersections.bend` (F32 expansion zero certificates),
    `kernel/ray.bend` (certified quadratic roots),
    `kernel/hybrid/corefine/gate.bend` (three-tier output gate).
  - [../proto-corefine.md](../proto-corefine.md) "Numeric model and
    guarantees", [../proto-exact-plane.md](../proto-exact-plane.md) "Numeric
    model and guarantees", [../hybrid-boolean-plan.md](../hybrid-boolean-plan.md)
    §§1, 2, 6.
  - The pinned Bend 2.0.25 code generator, local copy
    `tmp/research/bend-comp.ts` (source commit `c65bcb7` per
    `bend.lock.json`, [bendlang/bend](https://github.com/bendlang/bend)).
  - Findings from these checks are DOCUMENTED (read in the code); what they
    imply is INFERRED. Nothing was built or run: a CPU benchmark is running on
    this machine.

**Labels.**

- **DOCUMENTED**: read in a primary source, by the note author or for this
  chapter. The link leads to the note, and the note carries the primary URL.
- **INFERRED**: reasoning from evidence, including derivations the note
  authors added but did not prove.
- **HEARSAY**: secondhand, or vendor-run and not reproduced.

**Correction to the scout's framing.** The scout wrote that the Boolean
bake-off "is running right now". By 2026-09-24 it is decided (DOCUMENTED,
[../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) §1, and the sibling
chapter [mesh-booleans.md](mesh-booleans.md)):

- **corefine** (Manifold-style, F32x2 Reals, shared symbolic-perturbation
  decisions, face tags) decides topology. **recover** rebuilds the exact
  B-rep from the tags or refuses by name.
- **exact-plane** (EMBER-style, integer plane arithmetic) stays as an
  independent differential oracle. **sdf** produces no Boolean results.
- **Production runs on the CPU pool (`--gpu off`).** Metal is an experiment
  and was slower than 18 CPU threads for every prototype.

This matters for the numerics. The production targets are the JS target and
native C on ARM64. Both have gradual underflow. The flush-to-zero (FTZ)
hazards that dominate this chapter apply to the Metal target, which today
serves only experiments and cross-target identity checks. They become
production hazards the day a kernel moves to Metal, which the plan allows for
"flat SoA F32 records, batched" kernels (plan §6).

---

## 1. Landscape

### 1.1 Three families and one orthogonal tool

Robust geometric computation splits into three families by what it promises.
The scout's split holds up on the primary sources.

**(1) Exact decisions over floating-point inputs.** A predicate (orientation,
side of plane, in-circle) returns the exact sign for the numbers it was given.
Most calls are settled by a cheap floating-point filter with a proved error
bound; the rest go to an exact stage.

- Lineage: Shewchuk 1997 adaptive expansions
  ([note](sources/shewchuk-1997-adaptive-precision-floating-point-arithmetic-a.md)),
  CGAL's filtered kernels (catalog), Melquiond-Pion 2007 and FPG 2008
  (catalog), Ozaki et al. 2016
  ([note](sources/ozaki-b-nger-ogita-oishi-rump-2016-simple-floating-point-fil.md)),
  Bartels, Fisikopoulos and Weiser 2023
  ([note](sources/bartels-fisikopoulos-weiser-2023-fast-floating-point-filters.md)).
- **Indirect or implicit points** extend this to constructed points. An
  intersection point is kept as the tuple of primitives that define it, and
  every predicate on it is one polynomial in the original inputs, so no
  construction is ever rounded before a decision. Attene 2020
  ([paper note](sources/attene-2020-indirect-predicates-for-geometric-constructions-.md),
  [repository note](sources/indirect-predicates-repository-attene-with-predicate-generat.md)),
  Cherchi et al. 2020 and 2022, Lévy 2024 (sibling notes, section 2.2).

**(2) Fixed-precision exact integer arithmetic sized by static analysis.**
Declare input bit lengths, compute the bit length of every intermediate at
generation time, and emit straight-line code of exactly that width.

- Lineage: Fortune and Van Wyk 1996 (the LN compiler)
  ([note](sources/fortune-van-wyk-1996-static-analysis-yields-efficient-exact-.md)),
  Nanevski, Blelloch and Harper 2001/2003 (staged predicate generation from a
  functional language)
  ([note](sources/nanevski-blelloch-harper-2003-automatic-generation-of-staged.md)),
  Campen and Kobbelt 2010 (plane-based meshes)
  ([note](sources/campen-kobbelt-2010-exact-and-robust-self-intersections-for-.md)),
  EMBER 2022 and its commercial form Solidean (sibling notes).
- The key representation trick is shared by all of them: **keep planes as the
  primary data and vertices as triples of existing planes.** A Boolean then
  never creates a new plane, so the algebraic degree and the bit width of
  every predicate are fixed by the input, not by the depth of the CSG tree.
  DOCUMENTED in Fortune-Van Wyk §§6.3, 7.1 and Campen-Kobbelt §3.
- Yap's "exact geometric computation" (EGC) supplies the contract behind both
  families: decisions must never be wrong; constructions are represented
  exactly (or with a certified approximation); a zero is proved by a
  constructive zero bound, never observed
  ([note](sources/yap-1997-towards-exact-geometric-computation-cgta-7-and-the-.md)).

**(3) Controlled approximation with explicit guarantees.** When exactness is
too expensive or impossible (irrational constructions, output formats), give
up exactness in a way that is stated and bounded.

- Snap rounding: Hobby 1999
  ([note](sources/hobby-1999-practical-segment-intersection-with-finite-precis.md)),
  iterated snap rounding, 3D snap rounding (catalog), Valque-Lazard 2025
  (sibling note).
- Epsilon geometry, controlled perturbation (catalog).
- Topology-oriented implementation: Sugihara, Iri, Inagaki and Imai 2000
  ([note](sources/sugihara-iri-inagaki-imai-2000-topology-oriented-implementat.md);
  full text unreachable, abstract only).
- Local tolerances in production B-rep kernels: Jackson 1995, Parasolid
  (sibling note).

**Orthogonal: symbolic perturbation for degeneracies.** Simulation of
Simplicity (Edelsbrunner and Mücke 1990) answers every predicate as if the
input had been perturbed by one globally consistent infinitesimal. It needs
exact signs to work and it changes the question from "what is true" to "what
is true for the perturbed input"
([note](sources/edelsbrunner-m-cke-1990-simulation-of-simplicity-acm-tog-9-1.md)).
Qualitative symbolic perturbation (catalog) extends it to non-linear
predicates.

**Support layers.** Two numerical bodies of work sit under all three
families:

- **Error-free transformations and double-word arithmetic** (TwoSum, the
  Veltkamp/Dekker split, TwoProd, "double-double"): Joldes, Muller and
  Popescu 2017 with the Muller-Rideau 2022 formal corrections
  ([note](sources/joldes-muller-popescu-2017-tight-and-rigorous-error-bounds-f.md)),
  Yang et al. 2024 on overlapping pairs
  ([note](sources/yang-lyu-he-lu-qi-li-2024-on-the-robustness-of-double-word-a.md)),
  Thall's GPU df64 2006/2007
  ([note](sources/thall-2006-extended-precision-floating-point-numbers-for-gpu.md)).
- **Directed-rounding-free intervals**: Rump, Zimmermann, Boldo and Melquiond
  2009, predecessor and successor in round-to-nearest
  ([note](sources/rump-zimmermann-boldo-melquiond-2009-computing-predecessor-a.md)).

**Test methodology.** Kettner, Mehlhorn, Pion, Schirra and Yap 2008 show how
to break naive predicates on purpose and how the damage propagates into
topology
([note](sources/kettner-mehlhorn-pion-schirra-yap-2008-classroom-examples-of.md)).
**Hardware qualification.** Dougall Johnson's applegpu is the only source in
this set that models what Apple GPU F32 arithmetic actually does
([note](sources/applegpu-dougall-johnson-apple-gpu-isa-reverse-engineering.md)).

### 1.2 The arithmetic model every source assumes, and what wonky has

Every proof in this chapter rests on a short list of premises. The table puts
them next to what wonky's targets provide.

| Premise (assumed by) | JS target | native C (ARM64) | Metal |
|---|---|---|---|
| Correctly rounded +, −, ×, ties to even (all) | yes: every F32 op is `Math.fround(a op b)` (DOCUMENTED, `bend-comp.ts` l.229). Double then F32 rounding is innocuous for +, −, ×, ÷, √ because 53 ≥ 2·24+2 (INFERRED, Figueroa's theorem, [ACM](https://doi.org/10.1145/221332.221334)) | yes, IEEE hardware (INFERRED) | modelled as RTNE for ordinary F32 ALU ops (DOCUMENTED, applegpu `fma.py`); the scout reports the Metal spec allows RTZ in places ([MSL spec](https://developer.apple.com/metal/Metal-Shading-Language-Specification.pdf), not re-read here) |
| No contraction into FMA (Shewchuk §5, Bartels Remark 5, Ozaki, Thall) | no FMA exists | `#pragma clang fp contract(off)` (DOCUMENTED, `bend-comp.ts` l.3323) | `MTLMathModeSafe` (DOCUMENTED, l.5019); CUDA `--fmad=false` (l.5161) |
| No reassociation, no excess precision (Shewchuk §5, Kettner appendix) | each op rounded to F32 | strict C semantics with the pragma (INFERRED) | safe math mode (INFERRED from the mode's name and wonky's measured identity, below) |
| Gradual underflow (Shewchuk §2.1 excludes underflow; Bartels, Ozaki, Rump prove with subnormals) | yes: `Math.fround` produces subnormals (INFERRED) | yes, ARM64 default FPCR without FZ (INFERRED, platform default) | **no**: F32 inputs and results are flushed (DOCUMENTED in applegpu's model for the studied ALU paths; generation dependent) |
| Correctly rounded ÷ and √ (Joldes Alg. 15/17; `real.bend` `div`, `sqrt`) | yes (INFERRED as above) | yes (INFERRED) | open: not established by any source here |

What wonky measured (DOCUMENTED): the exact-plane prototype's device filter
certified exactly the same pairs on JS, the CPU pool and Metal, and all
targets produced byte-identical results
([../proto-exact-plane.md](../proto-exact-plane.md), "Determinism"). The
hybrid is byte-identical to JS on Metal on every corpus case
([../hybrid-boolean-plan.md](../hybrid-boolean-plan.md) l.281). Identity on a
corpus is evidence that FTZ did not bite on those inputs; it is not a proof
that it cannot.

Three consequences (INFERRED):

1. **TwoSum survives codegen on every target, and TwoProd must use the
   Veltkamp split with 4097.** There is no FMA primitive, and disabling
   contraction cannot create one (Thall note: separately rounded `a*b` and
   `a*b - p` give a zero residual by construction). `kernel/real.bend` `mul`
   already uses the split (DOCUMENTED).
2. **F32x2 is a filter and evaluation type of about 44 to 46 guaranteed bits,
   never an exact type.** Joldes/Muller-Rideau bounds at p = 24 give about
   46.4 bits for accurate addition, 45.7 for multiplication, 44.1 for
   division, relative to the result, for published algorithms only. The
   exponent range stays F32's (2^-149 to 2^128).
3. **Anything proved for gradual underflow must be re-proved or range-guarded
   before it runs on Metal.** Section 3.1 shows a concrete counterexample, and
   section 4 lists where wonky's own code stands.

### 1.3 Trends, 2016-2026

- **Implicit constructions plus exact predicates won mesh CSG.** Cherchi 2020
  and 2022, Lévy 2024 and trueform 2026 all avoid rounding a constructed point
  before deciding on it (sibling chapter [mesh-booleans.md](mesh-booleans.md)
  §1.1).
- **Expansions lost to integers for constructions.** Lévy 2024 is the key
  DOCUMENTED data point: stored expansion constructions reached 65,000
  components, overflowed and underflowed the 11-bit double exponent on
  ThingiCSG and Thingi10K cases, and ran 40 to 100 times slower than double.
  He replaced them with an mpz mantissa plus 32-bit exponent
  ([Lévy note](sources/levy-2024-exact-predicates-exact-constructions-and-combinato.md)).
  With F32's 8-bit exponent the same wall arrives about seven to eight times
  sooner (INFERRED in that note).
- **Fixed widths are provable and fast.** EMBER and Solidean keep every
  predicate at a statically known integer width and were the only engines
  canonical on every iterated-CSG case in the 2026 Solidean series (HEARSAY:
  vendor-run; see [mesh-booleans.md](mesh-booleans.md) §1.2).
- **Generators replaced hand-written predicates.** LN (1996), Nanevski's
  staged compiler (2001), FPG (2008), Attene's JPCK and Bartels' expression
  templates all derive filters and exact code from an expression description
  instead of hand constants.
- **Formal verification found real errors.** Muller and Rideau 2022
  machine-checked 15 double-word algorithms, found a false lemma in the 2017
  multiplication proof, and showed the accurate-addition bound is attained at
  almost 3u², where random testing had suggested 2.25u² (Joldes note).
  Melquiond and Pion 2007 machine-checked orient2d filters (catalog).
- **Round-to-nearest-only certification.** Rump et al. 2009 and Ozaki et al.
  2016 build certified bounds without switching rounding modes. Geometric
  Tools' `SWInterval` does intervals the same way (sibling note,
  [GTE](sources/geometric-tools-engine-david-eberly-bsnumber-bsrational-exac.md)).
  This matters because GPUs and Bend have no mutable rounding mode.

### 1.4 What is conspicuously missing

1. **No predicate suite for binary32 without FMA under FTZ, with proved
   constants.** Every canonical source assumes double or gradual underflow,
   and many assume directed rounding or FMA. Ozaki's theorem covers binary32
   but not FTZ; Bartels' `AVOID_DENORM` switch is not a proof (both notes).
2. **No validation of error-free transforms or double-word arithmetic on Apple
   GPUs.** Thall 2006 and Da Graça-Defour 2006 predate Apple silicon; applegpu
   models the ISA but its own test header asks for better float edge-case
   coverage.
3. **No fixed-precision exact treatment of curved B-rep geometry.** ESOLID's
   exact algebraic approach is the negative example (sibling note,
   [ESOLID](sources/esolid-exact-boundary-evaluation-for-low-degree-curved-solid.md)).
   Yap's EGC admits algebraic numbers only with root bounds and isolating
   intervals, and Core's implementation turns budget exhaustion into zero.
4. **No exact kernel in a mutation-free language beyond Nanevski's staged SML
   predicates.** CGAL's lazy DAG (Pion-Fabri, catalog) and Core's adaptive
   expression DAG rely on mutation, reference counting and exceptions. A Bend
   design has to recompute from inputs or carry immutable certificates.
5. **No published semantics for "exact sign" versus "perturbed sign" in CAD.**
   SoS resolves ties for combinatorics; CAD needs the unperturbed zero as
   evidence of contact, coincidence and common carriers. The SoS paper itself
   says original-boundary answers need a separate test (SoS note §6). No
   source designs the two interfaces together.
6. **No proof that the rounded output of an exact computation is a valid
   embedding.** Campen-Kobbelt §4.3 and Attene §8 both say rounding can
   reintroduce self-intersections; 3D snap rounding is O(n^15) worst case
   (catalog).

---

## 2. Comparison table

### 2.1 Deep-read sources of this chapter

| Source | Kind | Status | License (for wonky) | Verdict | Key idea | Note |
|---|---|---|---|---|---|---|
| Shewchuk 1997, adaptive predicates | paper + C | historical, code last revised 1996 | `predicates.c` public domain; Triangle separate | adapt | Expansions and staged adaptive sign certification; constants are symbolic in u, so F32 needs u = 2^-24, splitter 4097, not binary64 values | [note](sources/shewchuk-1997-adaptive-precision-floating-point-arithmetic-a.md) |
| Bartels, Fisikopoulos, Weiser 2023, fast FP filters | paper + C++20 archive | archived 2022 (v1 pinned) | predicate headers BSL-1.0; benchmark drivers GPL-3.0-or-later | adapt | Compositional (a, m) error rules generate static, almost-static and semi-static filters with underflow guards, plus a structural zero filter | [note](sources/bartels-fisikopoulos-weiser-2023-fast-floating-point-filters.md) |
| Rump, Zimmermann, Boldo, Melquiond 2009, pred/succ in RN | paper | historical, Coq-checked theorems | no code license; reimplement | adapt | Branch-free neighbour enclosure `e = RN(RN(phi·abs(c)) + eta)` gives RN-only intervals; eta assumes subnormals | [note](sources/rump-zimmermann-boldo-melquiond-2009-computing-predecessor-a.md) |
| Joldes, Muller, Popescu 2017 (+ Muller-Rideau 2022) | papers | historical, formally corrected | ACM; reimplement | adopt | Specified double-word schedules with proved bounds: accurate add ≈3u², DWTimesDW1 <5u², DWDivDW2 15u²; sloppy add unsafe under cancellation | [note](sources/joldes-muller-popescu-2017-tight-and-rigorous-error-bounds-f.md) |
| Attene 2020, indirect predicates | paper | published 2020, arXiv v2 2025 | paper CC BY-NC-ND; code LGPL-2.1 vs LGPL-3.0+ conflict | adapt | Keep constructed points as homogeneous polynomials of inputs; certify denominator signs; filter construction and predicate together | [note](sources/attene-2020-indirect-predicates-for-geometric-constructions-.md) |
| Indirect_Predicates repository (Attene) | C++ library + generator | active, last commit 2026-09-01, 51 stars | LGPL conflict; study only | adapt | Current code runs interval then bigfloat; generator composes error bounds from a DSL; recent PRs fix denominator-sign and cascade bugs | [note](sources/indirect-predicates-repository-attene-with-predicate-generat.md) |
| Campen, Kobbelt 2010, exact mesh self-intersections | paper | historical; WebBSP service discontinued | no code; reimplement | adapt | Plane-only representation keeps predicate precision bounded; `M ≥ 3L + 2 log2(δ) + 3` bounds plane coefficients, not whole predicates | [note](sources/campen-kobbelt-2010-exact-and-robust-self-intersections-for-.md) |
| Edelsbrunner, Mücke 1990, Simulation of Simplicity | paper | historical | ACM; reimplement | adapt | One global infinitesimal perturbation; ties resolved by a fixed ladder of minors (5 for orient2d, 15 for orient3d) with ID sorting and parity | [note](sources/edelsbrunner-m-cke-1990-simulation-of-simplicity-acm-tog-9-1.md) |
| Kettner et al. 2008, classroom examples | paper | historical; companion pages 404 | reimplement experiments | adopt | 256×256 adjacent-float sweeps expose false zeros, false signs and inversions; hull and walk invariants show the topological consequences | [note](sources/kettner-mehlhorn-pion-schirra-yap-2008-classroom-examples-of.md) |
| applegpu (Dougall Johnson) | reverse-engineered ISA + emulator | active, last commit 2026-07-01, 707 stars | BSD-3-Clause; `fma.py` also Go BSD notice | learn-from | Modelled Apple GPU F32 ALU: FTZ on inputs and results, RTNE final rounding; raw-bit hardware comparison harness | [note](sources/applegpu-dougall-johnson-apple-gpu-isa-reverse-engineering.md) |
| Ozaki et al. 2016, simple orient2d filters | paper | historical | no code license; reimplement | adapt | Seven-op RN-only semi-static orient2d filter with one branch, proved for binary32 and binary64 under gradual underflow | [note](sources/ozaki-b-nger-ogita-oishi-rump-2016-simple-floating-point-fil.md) |
| Yang et al. 2024, robustness of DW addition | preprint | arXiv v2, no journal version | arXiv licence; reimplement | adapt | Moderately overlapping pairs may skip a normalization; sloppy add can have order-one relative error; interval theorem assumes directed rounding | [note](sources/yang-lyu-he-lu-qi-li-2024-on-the-robustness-of-double-word-a.md) |
| Thall 2006/2007, df64/qf128 on GPUs | report + Cg source | unmaintained | custom research-use wording | learn-from | F32 pairs on GPUs; compiler destroyed product residuals; source has broken `exp`, placeholder `sincos` | [note](sources/thall-2006-extended-precision-floating-point-numbers-for-gpu.md) |
| Fortune, Van Wyk 1996, static analysis (LN) | paper | historical | ACM; reimplement | adopt | Compile whole predicates from declared input bit lengths: bit-length recurrences, static filter, fixed-size exact fallback | [note](sources/fortune-van-wyk-1996-static-analysis-yields-efficient-exact-.md) |
| Nanevski, Blelloch, Harper 2003, staged predicates | paper + tech report | historical | copyrighted; reimplement | adapt | Separate stages (partial application, hoisting per-plane work) from phases (precision); generate error certificates and liveness | [note](sources/nanevski-blelloch-harper-2003-automatic-generation-of-staged.md) |
| Yap 1997, EGC, and Core Library 2 | papers + C++ library | Core unmaintained; fork last commit 2020 | Core QPL-1.0 or commercial | adopt (contract) | Decisions never wrong; rational bounded-depth widths; zero by constructive bound; Core's cutoff-to-zero is the anti-pattern | [note](sources/yap-1997-towards-exact-geometric-computation-cgta-7-and-the-.md) |
| Hobby 1999, snap rounding | paper | historical | no code; reimplement | adapt | Route every segment through every hot pixel it crosses; half-open pixels; guarantees no new crossings, not topology preservation | [note](sources/hobby-1999-practical-segment-intersection-with-finite-precis.md) |
| Sugihara et al. 2000, topology-oriented implementation | paper | full text unreachable | subscription | unreachable | Legal topological transitions first, numerical preference second (abstract only) | [note](sources/sugihara-iri-inagaki-imai-2000-topology-oriented-implementat.md) |

### 2.2 Related deep reads in sibling chapters

These notes belong to other chapters but carry numerical evidence used here.

| Source | Why it matters here | Note |
|---|---|---|
| Lévy 2024, mesh CSG | Expansion constructions hit 65,000 components and double-exponent overflow; replaced by mpz + 32-bit exponent | [note](sources/levy-2024-exact-predicates-exact-constructions-and-combinato.md) |
| EMBER 2022 | Fixed-width integer plane predicates, bits bounded across iterated CSG | [note](sources/ember-exact-mesh-booleans-via-efficient-robust-local-arrange.md) |
| Geometric Tools Engine (Eberly) | BSL-1.0 exact arithmetic: `UIntegerFP32<N>`, per-query bit budgets (orient3d on arbitrary floats needs 27 words), `SWInterval` without mode switches | [note](sources/geometric-tools-engine-david-eberly-bsnumber-bsrational-exac.md) |
| Cherchi et al. 2020 | Mesh arrangements with indirect predicates; cascades unsupported | [note](sources/cherchi-livesu-scateni-attene-2020-fast-and-robust-mesh-arra.md) |
| Jackson 1995, local tolerances | The production B-rep answer to near-tangency: per-entity tolerances, explicit growth | [note](sources/jackson-1995-boundary-representation-modelling-with-local-to.md) |
| Valque, Lazard 2025, iterative snap rounding | 3D export repair that keeps float coordinates | [note](sources/valque-lazard-iterative-snap-rounding-for-triangle-soup-auto.md) |
| verified-3d-mesh-intersection (Lean 4) | MIT, machine-checked mesh-validity contract | [note](sources/verified-3d-mesh-intersection-lean-4.md) |
| ESOLID | Exact curved CSG with algebraic numbers: the cost warning | [note](sources/esolid-exact-boundary-evaluation-for-low-degree-curved-solid.md) |

---

## 3. State of the art: best techniques, real guarantees, where they break

### 3.0 Summary

| Technique | What it really guarantees | Premises | Breaks when | wonky today |
|---|---|---|---|---|
| Semi-static sign filter (Shewchuk stage A, Ozaki Alg. 3, Bartels) | an accepted sign is the exact sign of the determinant of the **represented** inputs; rejection means "unknown" | RN ties-even, fixed evaluation graph, no contraction, gradual underflow or a proved range guard | FTZ/DAZ, underflow of the bound to 0, FMA contraction, fast-math NaN elimination, reading rejection as "collinear" | `point_plane` filter with exponent window 87..167; gate tier-1 hand bounds; exact-plane filter with an absolute floor |
| Error-free transforms (TwoSum, Split 4097, TwoProd) | `hi + lo` equals the exact sum or product | RN, no overflow in the split, residual representable | FTZ drops residuals, `4097·a` overflows, compiler folds `a*b - p` | used in `real.bend` and the expansion certificates of `intersections.bend` |
| Double-word arithmetic (F32x2) | a relative error bound per operation, published per algorithm | normalized inputs, same premises as EFTs, unlimited exponent in the proofs | sloppy add under cancellation, overlapping pairs, low-word underflow | `R.Real` everywhere; `add` is a sloppy variant, `mul` near DWTimesDW1 |
| Exact expansions | exact sign after the adaptive stages | as EFTs, plus no exponent exhaustion | long construction chains (65,000 components, exponent overflow) | `intersections.bend` zero certificates only |
| Multi-limb integers, static widths | exact value and sign within a declared input contract | declared input lattice or exponent window, bit-length proof per expression | input outside the contract, unbounded construction depth | variable-length digits in `robust-predicates.bend` and exact-plane `big.bend`; no fixed-width code yet |
| Indirect predicates | exact decisions on constructed points without rounding them | exact denominators with certified signs; bounded construction depth | undecided denominator treated as known, cascades, output rounding | `LinePlane` indirect predicate, exact only; exact-plane vertices are plane triples |
| Symbolic perturbation (SoS) | a consistent answer for one infinitesimally perturbed input | exact zero detection, persistent IDs, correct parity | ad hoc per-site tie-breaks; using it where contact must be detected | corefine's shared-decision perturbation (Manifold style) |
| Snap rounding (Hobby) | output fully intersected; each piece within half a pixel (L∞) of its source | exact hot-pixel classification, half-open pixels | closed pixels or ties-to-even, snapping intersections only | not used |
| Local tolerances (Jackson) | a declared, per-entity gap within which entities count as incident | tolerances recorded and grown explicitly | silent global epsilons | corefine repair tolerances (2^-36, 2^-44), all stated |
| EGC for algebraic values (Yap, Core) | decisions exact via isolating intervals and zero bounds | valid root bound, refinement to it | budget cutoff turned into zero | `ray.bend` exact discriminant zeros, "unresolved" otherwise |

### 3.1 Floating-point sign filters

**The best filters are short and RN-only.**

- Ozaki et al.'s Algorithm 3 for orient2d is seven arithmetic operations plus
  a bound `e = RN(theta · RN(|RN(l + r)| + uN))` and one strict comparison.
  For binary32 `phi = 4094` and `theta = 3·2^-24 − 4072·2^-48`, exactly
  representable (INFERRED by substitution in the note). The proof covers IEEE
  overflow through Inf/NaN comparison semantics and gradual underflow through
  the `uN` term placed inside the multiplication (DOCUMENTED, Theorems
  3.1-3.5). Reported overhead on 10^8 random points was 3 to 5% over the
  unsafe baseline, with every predicate resolved by the filter (DOCUMENTED,
  Table 3.2). That says nothing about CAD input, where degenerate calls are
  common ([Ozaki note](sources/ozaki-b-nger-ogita-oishi-rump-2016-simple-floating-point-fil.md)).
- Shewchuk's stage-A constants are symbolic in u: orient2d `(3 + 16u)u`,
  orient3d `(7 + 56u)u`, incircle `(10 + 96u)u`, insphere `(16 + 224u)u`.
  For F32 instantiate them at `u = 2^-24`; importing the evaluated binary64
  constants is wrong (Shewchuk note, INFERRED).
- Bartels et al. generalize this to any polynomial tree: each node carries a
  pair `(a(u), m)` with `|computed − exact| ≤ a(u)·m`. Sum:
  `a = (1+u)·max(a1, a2) + u`; product: `a = (1+u)(a1 + a2 + a1·a2) + u`.
  The underflow-protected variant adds the smallest normal to product
  magnitudes and the smallest subnormal to the final bound (DOCUMENTED,
  Definition 12, Theorem 16). A separate structural zero filter proves common
  exact zeros without trusting a computed 0.
- Fortune and Van Wyk compute the whole bound at compile time from declared
  input sizes (static filter). It is the cheapest at run time but filters
  badly when real operands are much smaller than the declared maximum
  (DOCUMENTED, §4.1).

**What an accepted answer means.** The sign of the determinant of the numbers
actually passed in. If those numbers are rounded constructions, the filter
certifies the wrong polynomial (Shewchuk §4.1, Attene). `kernel/ray.bend`
says the same in a comment: "Certifying a rounded offset, projection, or
normalized vector would certify the wrong polynomial" (DOCUMENTED).

**Where filters break (DOCUMENTED unless marked):**

1. **Underflow can certify a false zero.** Bartels Example 7:
   `a = (0,0)`, `b = (2^emin, 0)`, `c = (2^emin, 2^emin)` is not collinear, but
   a naive stage A computes determinant 0 and bound 0 and certifies zero. For
   binary32 use `emin = −126`. Ozaki §2.1 gives a binary64 example whose exact
   determinant is `2^-1401`.
2. **FTZ breaks the gradual-underflow proofs, and raising a constant does not
   repair them.** The Ozaki note derives a binary32 counterexample (INFERRED,
   analytic, not run on hardware). With `N = 2^-126` and `S = 2^-149`, take
   the normal inputs `A = (2^30, N+S)`, `B = (2^55, 2N)`, `C = (0, N)`. The
   exact determinant is `2^-96 − 2^-94 = −3·2^-96`. Under FTZ
   `RN(ay − cy) = S` flushes to 0, the computed determinant becomes `+2^-96`,
   and the bound (about `3·2^-120`) accepts the wrong sign. The error of one
   flushed subtraction is amplified by `bx = 2^55`.
3. **FMA contraction breaks antisymmetry.** `ab − cd` contracted to
   `fma(a, b, −RN(cd))` is not the negative of the swapped expression, so
   swapping arguments need not flip the sign (Bartels Remark 5). A properly
   analysed FMA is fine; an accidental one is not.
4. **Fast-math breaks overflow handling.** Ozaki's and Bartels' proofs send
   Inf/NaN bounds to "reject" through strict IEEE comparisons. A compiler that
   assumes no NaN removes that path.
5. **Rejection is not collinearity.** Algorithm 3 cannot certify
   `(1,1), (2,1), (3,1)` as collinear (Ozaki p. 16). Zero needs the exact
   stage or a structural proof.

**wonky's filters (DOCUMENTED by reading the code; conclusions INFERRED):**

- `point_plane` in `kernel/robust-predicates.bend` expands the dot difference
  into 24 F32 products and accepts only if every factor word is zero or has a
  biased exponent in 87..167 (unbiased −40..40). The bound is `2^-16` times
  the rounded absolute sum, more than ten times `gamma_24`. In this window
  every exact product is a multiple of `2^(-63)·2^(-63) = 2^-126`, so every
  product and partial sum is zero or normal. **The filter is FTZ-safe by
  construction** (INFERRED; it agrees with the claim in
  [../robust-predicates.md](../robust-predicates.md), which states it was
  verified on the JS target only). It never certifies zero.
- The corefine output gate's tier 1 (`gate.bend`) uses hand-derived bounds on
  local differences, for example `bound3` =
  `2^-14·l1·l2·l3 + 2^-38·M·l1·(l2 + l3)` against a derived error of
  `78·2^-24·l1·l2·l3 + 96·2^-48·M·l1·(l2 + l3)`. It pads every length by
  `2^-44·M` and rejects when the threshold is below `1e-30` (about
  `2^-99.7`). There is no exponent window. A back-of-envelope estimate says a
  flushed subtraction costs at most about `2^-126·(2M)^2` absolute, below the
  threshold for any M in millimetre range (INFERRED, not a proof). The
  derivations in the comments assume the gradual-underflow model.
- The exact-plane filter certifies when
  `|f| > 2^-40·M + 2^-44·S + 1e-28`, after scaling every Big by a shared power
  of `2^16` so the F32 exponent cannot overflow; it never certifies zero
  (DOCUMENTED, [../proto-exact-plane.md](../proto-exact-plane.md)). The
  absolute floor `1e-28` is the Bartels-style underflow guard.

### 3.2 Error-free transforms and double-word (F32x2) arithmetic

**The primitives** (DOCUMENTED in the Joldes, Yang and Thall notes; each `RN`
is a separate rounding that the compiler must keep):

- `TwoSum(a, b)`: 6 operations, no magnitude precondition.
- `Fast2Sum(a, b)`: 3 operations, needs `exponent(a) ≥ exponent(b)`
  (normally `|a| ≥ |b|`). Yang 2024 proves some unsorted calls safe under a
  trailing-bit condition; that licence is specific to those calls.
- `Split(a)`: `t = RN(4097·a); hi = RN(t − RN(t − a)); lo = RN(a − hi)`.
  4097 = 2^12 + 1 is the binary32 splitter.
- `TwoProd(a, b)` without FMA: split both, 17 operations in total.

**Published double-word bounds at p = 24** (relative to the exact result;
bits = −log2 of the bound; DOCUMENTED formulas, INFERRED bit counts, from
the [Joldes note](sources/joldes-muller-popescu-2017-tight-and-rigorous-error-bounds-f.md)):

| Operation | Algorithm | Bound | ≈ bits | Operations with Dekker TwoProd |
|---|---|---|---|---|
| DW + FP | Alg. 4 | 2u² | 47 | 10 |
| DW + DW, accurate | Alg. 6 | 3u²/(1−4u), attained at almost 3u² | 46.4 | 20 |
| DW + DW, sloppy | Alg. 5 | relative error up to 1 under cancellation | none | 11 |
| DW × FP | Alg. 7 | 1.5u² + 4u³ | 47.4 | about 25 |
| DW × DW | Alg. 10 (DWTimesDW1) | < 5u² with ties to even (Muller-Rideau) | 45.7 | 24 |
| DW ÷ FP | Alg. 15 | 3u² | 46.4 | about 25 |
| DW ÷ DW | Alg. 17 (DWDivDW2) | 15u² + 56u³ | 44.1 | 33 |

The operation counts with Dekker TwoProd are the note's INFERRED adjustment
of the paper's FMA-based counts; the paper's FMA counts do not apply to Bend.

**What the bounds do not give.**

- **Not a representation of 48 exact bits.** The pair represents `hi + lo`
  with F32's exponent range. `2^60 + 2^-60` is representable; `2^-140` with
  a 48-bit significand is not (Thall report §III.A).
- **Not a sign certificate.** Per-operation relative error does not bound the
  error of a determinant whose terms cancel. Carry an **absolute** error,
  scaled by operand magnitudes, through the expression and fall back to
  exact arithmetic when zero is inside the enclosure (Joldes and Yang notes).
- **Not valid outside the premises.** All proofs assume unlimited exponent
  range. Low words and residuals can underflow or flush even when `hi` is
  normal; `4097·a` overflows for `|a|` above about `2^116`; a compiler can fold
  the residual to zero (Thall §II.D: Cg 1.5 on G70 did exactly that).
- **Sloppy addition is unsafe under cancellation.** Joldes: it can return 0
  for a nonzero sum. Yang: order-one relative error when the high words are
  adjacent floats of opposite sign.
- **Yang's interval theorem assumes directed rounding** for every primitive
  operation. It removes mode switches inside a directed-rounding
  implementation; it does not certify RN-only intervals on Metal.

**wonky's `R.Real` (DOCUMENTED by reading `kernel/real.bend`):**

- `add`: TwoSum on the high words, then
  `error = ((ah − (sum − v)) + (bh − v) + al + bl)` in plain F32, then
  `renorm` (Fast2Sum). This is a sloppy addition with a different grouping
  from Joldes Alg. 5. No published bound applies by name. Its error is of
  order `u²·(|a| + |b|)` in absolute terms (INFERRED); its relative error
  under cancellation is not bounded. The sibling chapter
  [mesh-booleans.md](mesh-booleans.md) reached the same reading.
- `mul`: Dekker split with 4097, residual
  `((a1·b1 − p) + a1·b2 + a2·b1) + a2·b2`, plus `ah·bl + al·bh + al·bl`, then
  `renorm`. Close to DWTimesDW1 but with a different grouping and the extra
  `al·bl` term; the proved `< 5u²` is not inherited by name (INFERRED).
- `div` and `sqrt` are Karp-style corrections on F32 seeds (as in Thall);
  no bound is proved in the code.
- **How wonky uses it is sound in principle.** The gate's Real filter
  (`kfilter` = `2^-32`) assumes each Real operation errs by about `2^-46` of
  its **operands** and keeps a 64-fold margin (DOCUMENTED, comment in
  `gate.bend`). That is the absolute, operand-scaled form the papers say a
  sign filter needs. corefine's constructed points are quoted as "about
  2^-44 of the operand magnitude" (DOCUMENTED, proto-corefine numeric model),
  also operand-scaled.
- **Canonical form.** corefine relies on "comparing two Reals is exact,
  because Reals are canonical" (DOCUMENTED). That holds when every `renorm`
  call meets the Fast2Sum exponent precondition. In the add and mul regimes
  checked by hand for this chapter it does (INFERRED), but it is not proved,
  and it is the kind of property the Muller-Rideau style adversarial families
  test.

### 3.3 The exact tier: expansions versus integers

**Expansions (Shewchuk, Nanevski).** An exact value is a list of
non-overlapping floats. Stages recover exact subtraction tails and add them
only when needed. Final stages are bounded for fixed predicates (orient2d at
most 16 components, orient3d 192; DOCUMENTED, Shewchuk note). Two limits:

- **Exponent range.** Components do not extend the exponent range. Lévy's
  stored constructions overflowed double's 11-bit exponent; F32 has 8 bits,
  about 276 binades against about 2098 (Lévy note, INFERRED). Nanevski:
  F32 expansions work on a certified bounded-exponent domain, but more
  components never help with range (DOCUMENTED, §7).
- **Irregular work.** Expansion lengths and zero elimination are data
  dependent and the merges are serial carry chains: poor uniform GPU work
  (Shewchuk note, INFERRED).

**Integers with static widths (Fortune-Van Wyk, Campen-Kobbelt, EMBER,
Yap).** Bit lengths follow `B(a ± b) = 1 + max(B(a), B(b))` and
`B(a·b) = B(a) + B(b)` (Fortune-Van Wyk §4). Yap's rational bounded-depth
theorem: intermediate sizes are at most `D·s + O(1)` for s-bit inputs and a
constant D fixed by the computation; indefinitely edited CAD models are his
own counterexample to bounded depth (DOCUMENTED, Yap §4). Note that LN's
exact backend is **not** U32 limbs: it stores integers as sums of binary64
components weighted by `2^(23i)` (DOCUMENTED, Fortune-Van Wyk §4.2). Only the
analysis ports.

**Bit budgets that matter for wonky:**

| Quantity | Bits | Source |
|---|---|---|
| one arbitrary finite F32 as an integer times `2^-149` | 277 | Attene note (INFERRED) |
| one arbitrary F32x2 pair (sum of two words) | 278 | Attene note (INFERRED) |
| orient3d on arbitrary float input, exact | 27 words of 32 bits = 864 | GTE note (DOCUMENTED, `PrimalQuery3.h`) |
| `x·y − z·w` on arbitrary floats | 554 | GTE note (DOCUMENTED) |
| plane through three homogeneous points, 31-bit inputs | about 97 | Fortune-Van Wyk Fig. 6 (DOCUMENTED) |
| Campen det4 side test, lattice L = 20, edge bits K = 16 | 150 (five 32-bit limbs) | Campen note (INFERRED derivation) |
| three-plane vertex numerator/denominator, s-bit coefficients | about `3s + log2 6` | Yap §6.3 (DOCUMENTED) |
| wonky exact-plane plane-side predicate, worst case (34-bit lattice) | 325 (21 limbs of 16 bits) | [../proto-exact-plane.md](../proto-exact-plane.md) (DOCUMENTED) |
| same, observed maximum on the corpus | about 256 | same (DOCUMENTED) |

The lesson, stated in the GTE note: almost all bits of an arbitrary-float
budget come from the **exponent range**, not the mantissa. Declare an input
lattice (exact-plane: `2^-24` mm inside ±1024 mm) or an exponent window and
the budget collapses to ordinary integer growth.

**What wonky's exact tiers look like (DOCUMENTED):**

- `robust-predicates.bend`: signed, variable-length lists of base-4096 digits
  (12 bits per U32). Every F32 word is decoded exactly from its bits as an
  integer times `2^-149`, including subnormals, so the tier is immune to FTZ.
  Digit products plus carry stay below `2^24`. Schoolbook multiplication.
- `gate.bend` `big_det`: the same Big type, but all words of one predicate are
  scaled to the smallest exponent among them, so integers stay "a few digits"
  instead of about 13 digits per word. A dynamic version of static width
  reduction.
- exact-plane `big.bend`: signed variable-length 16-bit limbs. It keeps
  variable length on purpose: typical operands are 1 to 4 limbs, the worst
  case 21 limbs.
- Measured cost, native, 1 thread: 1.3 µs (grid point) and 6.0 µs
  (constructed vertex) per exact plane-side evaluation, against 0.10 and
  0.20 µs for the F32x2 filter (DOCUMENTED in the Lévy note, citing
  proto-exact-plane).

**The exact tier is mostly a zero prover in CAD.** One exact-plane report
line (the `hex-nut` case) reads: 1,068,884 predicates settled by the filter,
85,456 exact zeros, 20 exact nonzero, 459 symbolic zeros (DOCUMENTED,
[../proto-exact-plane.md](../proto-exact-plane.md)). About 7.4% of calls went
to the exact tier and 99.98% of those were zero. One case is not a
distribution, but it matches the SoS note's warning that degeneracy is common
in CAD and it points at structural zero proofs (Bartels' `zero_pattern`,
exact-plane's plane-ID zeros) as the cheapest speed-up (INFERRED).

### 3.4 Indirect predicates: exact decisions on constructed points

**The construction is a homogeneous point `(N, W)` of the inputs**
(DOCUMENTED, Attene §4; INFERRED formulas checked against the repository):

- Line through `q1, q2` against plane `r, s, t`:
  `d = det(q1 − q2, s − r, t − r)`, `n = det(q1 − r, s − r, t − r)`,
  `N = d·q1 + n·(q2 − q1)`, `W = d`.
- Three planes `ai·x = bi`: `W = det(a1, a2, a3)`,
  `N = b1(a2 × a3) + b2(a3 × a1) + b3(a1 × a2)`. Campen-Kobbelt's plane
  representation gives the same with `(n_i, d_i)`, and the side of a fourth
  plane is `sign(n4·N + d4·W)·sign(W)`, which equals a 4×4 determinant.
- Degrees in input coordinates: LPI numerator 4, denominator 3; TPI from
  triangles numerator 7, denominator 6; side tests against a triangle plane
  6 and 9 (INFERRED, Attene note).
- Rules: certify the denominator's sign first; `W = 0` means "undefined",
  which differs from a geometric zero; canonicalize to `W > 0` only after its
  sign is certified; a filter must include the construction's own error
  (unsound to treat cached lambdas as exact inputs, Attene Appendix A).

**Where it breaks (DOCUMENTED, repository issues):**

- [PR 15](https://github.com/MarcoAttene/Indirect_Predicates/pull/15): an
  undecided interval denominator was reported as reliable. The reporter
  measured 233,200 wrong orientations in 355,200 stress queries and six
  inverted tetrahedra in a 10.5M-tet arrangement. **The wrong signs were
  permutation-consistent, so antisymmetry tests missed them.**
- [PR 14](https://github.com/MarcoAttene/Indirect_Predicates/pull/14): exact
  Cartesian accessors forgot to divide by W; explicit points (W = 1) hid it;
  a nested construction returned (4,0,0) for (2,0,0).
- Cascades: Cherchi's arrangements do not support implicit points of implicit
  points, and IARMB failed the iterated benchmarks (sibling chapter
  [mesh-booleans.md](mesh-booleans.md) §1.2).
- Output rounding can create self-intersections (Attene §8, Campen §4.3).

**wonky today (DOCUMENTED):** `classify(LinePlane{...})` evaluates
`(alpha·delta − beta·gamma)/(alpha − beta)` exactly from source words, with
`Undefined` for a zero denominator. In its normal/origin plane form the
numerator has degree 4 and the denominator degree 2 in input words
(INFERRED). It has **no filter**; every call is exact. There is no TPI and
no orient3d on implicit points in this module. exact-plane represents every
vertex as a plane triple (Campen/EMBER) and is exact end to end. corefine's
constructed points are rounded Reals, and its decisions on values closer than
about `1e-13` relative are "consistent but may differ from exact arithmetic"
(DOCUMENTED, proto-corefine numeric model). That residue is exactly what
indirect predicates would remove.

### 3.5 Degeneracies: symbolic perturbation

- **The mechanism** (DOCUMENTED, SoS §§3-4). Give every object a persistent
  index. Evaluate the determinant as a polynomial in a conceptual epsilon; the
  answer is the sign of the first nonzero coefficient. For orient2d with
  sorted indices `i < j < k` the complete ladder is: the determinant,
  `xk − xj`, `yj − yk`, `xi − xk`, `+1`. Flip for an odd permutation of the
  caller's order. orient3d has 15 terms; a general homogeneous 4×4 has 50.
- **The guarantee.** Every nonzero sign is unchanged; every tie is resolved
  consistently across all predicates that share the perturbation. It needs
  exact zero detection; a float filter cannot supply it.
- **Where it breaks.** Ad hoc perturbations proportional to one epsilon keep
  algebraic dependence and can leave determinants identically zero (SoS
  §3.2). Wrong parity or IDs that depend on scheduling order break global
  consistency. And **SoS answers for the perturbed input**: a boundary point
  is moved to one side, coplanar faces stay apart until a postprocess merges
  them (SoS §6).
- **wonky today.** corefine uses Manifold's shared-decision perturbation for
  combinatorics (DOCUMENTED). recover needs the opposite: coincident carriers
  and contacts as evidence. For carriers that were rotated, exact zero cannot
  be expected, because the transform was rounded. corefine's carrier
  unification therefore uses an explicit, bounded tolerance (`2^-44`, derived
  from the F32x2 wire rounding of one rigid transform) and never unifies two
  exactly axis-aligned carriers (DOCUMENTED, proto-corefine step 10). That is
  a Jackson-style local tolerance, and the history of its constant is a war
  story (section 4).

### 3.6 Controlled approximation

- **Snap rounding (Hobby 1999).** Guarantee: the output arrangement is fully
  intersected (pieces meet only at endpoints) and every output piece lies in
  its source segment thickened by half a pixel, which is `h/2` in L∞ and
  `h/√2` Euclidean for pixel size h (DOCUMENTED Theorem 4.1; the Euclidean
  figure is the note's INFERRED correction). Not guaranteed: topology. Nearby
  intersections merge; two redrawn segments may share several disjoint
  pieces. Premises: half-open pixels `[−1/2, 1/2)²` and `floor(x + 1/2)`
  (not ties-to-even); exact classification of segment against pixel. Cost:
  `O((n + k) log n + k′)`, with k′ exploding for near-collinear input.
- **Iterated and 3D snap rounding** (catalog): ISR adds half-pixel clearance
  from non-incident edges; 3D snap rounding bounds Hausdorff motion with an
  O(n^15) worst case. The practical 3D export answer in this knowledge base
  is Valque-Lazard's iterative snap rounding (sibling note).
- **Epsilon geometry and controlled perturbation** (catalog): answers are
  correct up to epsilon, or for a randomly perturbed input with a precision
  bound. Both change the input model, which conflicts with exact analytic
  carriers (INFERRED).
- **Topology-oriented implementation** (Sugihara et al.): only legal
  topological transitions are allowed; numerics only rank them. The abstract
  claims robustness; no geometric error bound could be verified because the
  full text was unreachable. Yap §4.2 separates combinatorial consistency from
  stability (DOCUMENTED in the Yap note).
- **Local tolerances** (Jackson 1995, sibling note): each edge and vertex
  carries its own tolerance; growth is explicit.

**wonky today (DOCUMENTED):** corefine never moves a vertex; its tolerances
decide topological repairs only and are stated (short-edge collapse at
`2^-36·max|coordinate|`, triangulator flatness `1e-7` rad, carrier
unification `2^-44·scale`). exact-plane quantizes the input once to a
`2^-24` mm lattice (measured maximum displacement 2.98e-8 mm) and exports to a
`2^-36` mm grid (Hausdorff below `√3·2^-36` mm = 2.5e-11 mm from the exact
Boolean of the quantized input); its finish step refuses a result that
rounding broke. That is Campen-Kobbelt's contract including the output
caveat, implemented.

### 3.7 Beyond polynomials: curved decisions

- **Exact algebraic decisions need three parts** (DOCUMENTED, Yap and Core 2):
  an exact representation (integer polynomial plus an isolating interval), a
  certified approximation with an error bound, and a constructive root bound
  `B(E)` such that a nonzero E has `|E| > B(E)`. An enclosure inside
  `(−B, B)` proves zero. Repeated approximations near zero prove nothing.
- **Core's escape hatch is the anti-pattern.** When refinement reaches the
  escape or cutoff bound, Core logs "ZERO ASSERTION" and sets the sign to
  zero (DOCUMENTED, Core 2 §3.3 and `ExprRep.h`). A wonky equivalent must
  return an explicit budget failure.
- **RN-only enclosures exist.** Rump's Algorithm 1 encloses the neighbours
  of any finite float with `e = RN(RN(phi·|c|) + eta)`,
  `phi = u(1 + 2u)` = `2^-24 + 2^-47` for binary32, `eta = 2^-149`. Wrap
  every operation's result and you get an interval without switching
  rounding modes (DOCUMENTED). The two binades around the normal threshold
  may give the second neighbour, still a valid enclosure. On FTZ hardware
  `eta` cannot be simply replaced by `2^-126`; DAZ destroys input information
  that no output inflation recovers (Rump note, INFERRED).
- **Directed-rounding designs do not port.** CGAL's `Interval_nt`
  (Brönnimann-Burnikel-Pion, catalog), Attene's `setFPUModeToRoundUP`,
  Menezes et al.'s CUDA `__fadd_rd/ru` filters (catalog) and Yang's interval
  theorem all need rounding modes that Bend and Metal do not expose.
- **ESOLID** is the cost warning for exact curved CSG (sibling note).

**wonky today (DOCUMENTED):** `ray.bend` computes the quadratic coefficients
of line/cylinder and line/cone intersections from original-coordinate
differences as exact expansions and certifies an exact zero discriminant; a
near but uncertified case is "unresolved" (kind 4), and a comment explains
why a rounded normalized vector would certify the wrong polynomial. The
expansion certificates in `intersections.bend` admit a product only when its
factors and its complete 48-bit result fit the F32 range. recover refines
multi-carrier corners by Newton with a residual of at most `1e-7` mm
(observed at most `1e-12`; plan §2.2); that is a residual check, not a
certificate that the root exists and is unique.

---

## 4. War stories and anti-patterns

### 4.1 From the sources

1. **A line with a hole in it** (Kettner et al., DOCUMENTED). Evaluate the
   naive orient2d with `q = (12, 12)`, `r = (24, 24)` and p on a 256×256 grid
   of adjacent doubles around (0.5, 0.5). The exact answer is the line
   `x = y`. The computed sign map has broken zero bands and islands of wrong
   sign, because a whole block of neighbouring p values shares one rounded
   difference. A different pivot or extra precision changes the picture but
   does not fix it. With an absolute `epsilon = 1e-10` the zero band widens
   and stays fractured.
2. **An infinite loop from four points** (Kettner et al., DOCUMENTED). The
   binary64 fixture `p1 = (200.0, 49.200000000000003)`,
   `p2 = (100.0, 49.600000000000001)`,
   `p3 = (−233.33333333333334, 50.93333333333333)`,
   `p4 = (166.66666666666669, 49.333333333333336)` makes p4 "see" every edge
   of the triangle. The textbook tangent search then loops forever. The
   area error of a hull built with wrong predicates can be made arbitrarily
   large. A 3D Delaunay point-location walk cycles through three tetrahedra.
3. **The tilted grid that never finished** (Shewchuk Table 9, DOCUMENTED).
   The approximate 3D triangulation on a tilted grid did not terminate; the
   robust version finished in 108.5 s.
4. **Underflow certifies a false zero** (Bartels Example 7, DOCUMENTED); the
   fix, underflow guards, raised first-stage filter failures from 49,375 to
   624,400 of 4,121,216 orientation calls in one benchmark (Table 2): safety
   has a price in acceptance rate.
5. **FTZ turns a certified sign into a wrong one** (Ozaki note, INFERRED
   counterexample, section 3.1): a single flushed subtraction amplified by a
   coordinate of `2^55`.
6. **Published error bounds were wrong** (Joldes note, DOCUMENTED). An older
   claimed `2u²` bound for accurate double-word addition was false; the 2017
   multiplication proof used the false inequality "ab ≤ 2 with a, b ≥ 1
   implies a + b ≤ 2√2" (a = 1, b = 2 refutes it); random experiments showed a
   maximum near 2.25u² while an explicit family attains almost 3u². The
   algorithms survived; the reasoning did not.
7. **The compiler ate the residual** (Thall, DOCUMENTED). Cg 1.5 on G70
   optimized `x = a*b; y = a*b − x` to `y = 0`. Thall's source also returns 0
   from `df64_exp` for `a.hi ≥ 88.7` or `a.hi ≤ −87.3`, ships an all-zero
   `sincos` placeholder, and the 2009 addendum deletes the report's FFT
   results.
8. **Wrong signs that pass symmetry tests** (Attene PR 15, DOCUMENTED): an
   undecided denominator reported as reliable gave 233,200 wrong signs in
   355,200 queries, consistently under permutation. PR 14: `W = 1` for
   explicit points hid a missing division until cascades exposed it. Issue 11:
   an inverted limb equality in the bignum. PR 13: header-only code compiled
   with different FMA flags in different translation units collided at link
   time. Correct mathematics, wrong build.
9. **Budget exhaustion becomes zero** (Core 2, DOCUMENTED): the escape and
   cutoff bounds log "ZERO ASSERTION" and set the value to zero. Core 2.1 also
   fixed root-bound overflow (the metadata overflowed, not the arithmetic), a
   chain-form harmonic sum segfaulted at n = 100,000, and filters are disabled
   for transcendental nodes after a wrong sign from a `Log` node.
10. **Expansions ran out of exponent** (Lévy, DOCUMENTED): 65,000 components,
    overflow and underflow of the double exponent on ThingiCSG and Thingi10K
    cases, 40 to 100 times slower than double.
11. **Exact topology, broken output** (Campen-Kobbelt §4.3, Attene §8,
    DOCUMENTED): rounding exact results to output coordinates reintroduces
    microscopic self-intersections; Campen's outer-hull semantics silently
    drop internal voids.
12. **Transform and inverse are not the identity** (Fortune-Van Wyk §§6.3,
    7.1, DOCUMENTED): exact plane-based Booleans, but transformations round
    plane coefficients back to bounded size, so a solid transformed and
    transformed back is a different solid.
13. **Snapping one intersection makes new ones** (Hobby Figs. 1-2,
    DOCUMENTED): snapping the true intersection to (5, 3) creates crossings
    that were not there; a naive repeat-until-clean loop took 14.02 s against
    4.94 s for hot pixels and added more vertices.
14. **The hardware model changed under a basic op** (applegpu PR 65,
    DOCUMENTED): F32 FMA, add and multiply writing an F16 destination round
    twice; found while bringing up M3 tests. M3/M4 changed the ISA encoding.
    Pin the model version and qualify each GPU generation.
15. **Saving work cost time** (Nanevski Table III, DOCUMENTED): generated
    insphere ran 2.39 times slower than Shewchuk's hand code, attributed to
    naive temporary allocation. Keeping every intermediate can lose to
    recomputation.

### 4.2 From wonky itself

1. **A tolerance 1000 times too large opened sealed voids** (DOCUMENTED,
   [../proto-corefine.md](../proto-corefine.md) step 10). Carrier unification
   first merged plane carriers within `2^-40·scale`. A sealed void 2e-11 mm
   under the top face of an axis-aligned block came back `ok` as an opened
   pocket (area 1840 instead of 2040). After exact axis-aligned carriers were
   excluded, a tilted prism with a sealed pocket 1e-11 mm under its tilted
   face still came back opened (area 1269.02 instead of 1472.67). The fix
   derived the tolerance from the error it must absorb (one rigid transform
   rounded to F32x2: offsets within about `2^-46.4·scale`; measured at most
   `2^-50.2·scale`) and set `2^-44·scale`. Lessons: derive a tolerance from
   the rounding it absorbs, never apply it to exact input, and state it in the
   result.
2. **Exact predicates on rounded constructions decided the wrong question**
   (DOCUMENTED, same step). Rotating analytically coplanar faces with an
   F32x2 transform moved them about 1e-14 mm apart; the exact shadow
   predicates then decided overlap from the rounding and produced membranes
   and slivers. This is Shewchuk §4.1 in production: exactness of the
   decision does not repair inexactness of its input.
3. **A window that assumes gradual underflow** (INFERRED from code reading,
   untested). `kernel/intersections.bend` admits a product for its exact-zero
   expansion certificates when the biased exponents sum to at least 151, i.e.
   the lowest bit of the exact product is at least `2^-149`, the smallest
   subnormal. That is exactly the gradual-underflow limit. On a target that
   flushes subnormals (Metal, per applegpu) the TwoProd residual of such a
   product can vanish, and a nonzero expansion can come out empty, which the
   code reads as a certified exact zero. On JS and native C it is correct.
   For millimetre CAD data the affected range (products below about `2^-80`)
   is practically unreachable, but the certificate claims exactness, so the
   window should state its premise or use the FTZ-safe bound (P2).

### 4.3 Anti-patterns, and what to do instead

| Anti-pattern | Seen in | Instead |
|---|---|---|
| Deciding with `abs(x) < epsilon` | Kettner Fig. 12 | certified filter, exact fallback; tolerances only in named repair decisions with stated values |
| "F32x2 has 48 bits, that is exact enough" | common folklore; Thall's own warning | operand-scaled absolute error bounds per expression; exact tier when zero is in the enclosure |
| Casting published binary64 fixtures to F32 | Kettner note | regenerate adversarial cases from F32 bit patterns |
| Importing evaluated binary64 filter constants | Shewchuk, Fortune-Van Wyk, Attene notes | instantiate symbolic constants at `u = 2^-24`, or regenerate |
| Porting a gradual-underflow proof to FTZ by changing one constant | Ozaki, Rump, Bartels notes | an exponent window that provably excludes subnormals, or a new FTZ proof, or exact decode from bits |
| Reading filter rejection as "zero" or "collinear" | Ozaki p. 16 | three outcomes plus "uncertain"; zero only from exact or structural proof |
| Validating predicates by permutation symmetry only | Attene PR 15 | compare against an independent exact oracle |
| Testing only explicit inputs | Attene PR 14 | include cascaded constructions and `W ≠ 1` |
| Turning budget exhaustion into zero | Core 2 | typed `Unresolved` / `CapacityExceeded` with the enclosure as diagnostic |
| Rounding a construction, then deciding exactly on it | Shewchuk §4.1; wonky carrier history | indirect predicates, or an explicit bounded unification tolerance |
| Sloppy double-word addition on cancellation-sensitive paths | Joldes §3, Yang Thm 3.4 | accurate addition (Joldes Alg. 6), or a proof for the specific call |
| Trusting a compiler flag without checking the emitted arithmetic | Thall; Attene PR 13 | a probe program whose raw-bit output proves the residual survives |
| Establishing error bounds by random testing | Muller-Rideau | proofs plus adversarial families; random tests only as smoke tests |
| Assuming exact topology gives a valid float mesh | Campen §4.3, Attene §8 | validate the rounded output; refuse or repair explicitly |
| Letting symbolic perturbation erase coincidence | SoS §6 | separate `exact_sign` and `sos_sign` APIs |
| Designing intervals on directed rounding | CGAL `Interval_nt`, Attene, Menezes, Yang §4.2 | RN-only enclosures (Rump, GTE `SWInterval`) with a range contract |

---

## 5. What wonky should take: ranked proposals

The ranking weighs benefit for the production path (the corefine + recover
hybrid on the CPU pool, exact special cases, curved decisions) against cost
and risk. Everything is INFERRED design unless a fact is marked. None of it was
built or run for this chapter.

| Rank | Proposal | Cost | Main benefit | Relation to the hybrid |
|---|---|---|---|---|
| P1 | Numerical contract per target, with a probe program | small | every proof gets a checked premise | makes the "byte-identical on all targets" result explainable |
| P2 | FTZ audit of all gradual-underflow code; fix the expansion window | small | removes a possible false exact-zero certificate on Metal | prerequisite for any Metal kernel (plan §6) |
| P3 | Adversarial sweep and mutation harness across targets | medium | catches filter, compiler and FTZ regressions | grades corefine's gate, exact-plane and robust-predicates alike |
| P4 | Predicate generator: static widths, composed F32 bounds, zero patterns, SoS ladder | medium-large | replaces hand constants with derivations; enables fixed-width code | replaces the hand-derived bounds in `gate.bend`; feeds exact-plane |
| P5 | Fixed-width exact tier behind a declared input contract | medium | uniform, predictable exact work; explicit capacity failure | exact-plane (21 limbs worst case) and the gate's `big_det` |
| P6 | Two sign interfaces: `exact_sign` and `sos_sign` with tie provenance | small-medium | keeps coincidence evidence for recover while corefine perturbs | closes a semantic gap between corefine and recover |
| P7 | Indirect three-plane points and a filtered `LinePlane` | medium | exact planar corners and exact provenance per edge | plan step 9 (provenance per new edge), recover corners |
| P8 | Accurate double-word addition and pinned `R.Real` schedules | small | published error bounds under cancellation | corefine's constructed points and the gate's Real filter |
| P9 | RN-only intervals and root certificates for curved decisions | large | certified curved corners and tangencies, never cutoff-to-zero | recover's Newton corners; `ray.bend`, `curve-band.bend` |
| P10 | Hot-pixel snap rounding for 2D sections and FDM contours | medium | valid planar output with stated deviation | outside the Boolean; export and slicing |
| P11 | Staged plane contexts as flat F32 records | medium | fewer operations per query; meets the Metal trial conditions | gate and recover's clearance join |

### P1. A numerical contract per target, checked by a probe program

- **Idea.** Write down, per target (JS, native C, Metal), what the F32
  arithmetic does, and check it with a Bend program that returns raw U32 bit
  patterns. This is applegpu's method (raw-bit comparison against a model)
  applied to Bend's own code generator. Every filter, error-free transform
  and double-word bound then names the contract clause it relies on.
- **Where it plugs in.** A new probe module next to `kernel/real.bend`, a
  test under `test/`, and a short section in
  [../robust-predicates.md](../robust-predicates.md). Run it wherever
  `targetsAgree` is already checked.
- **Bend fit.** Excellent: fixed vectors of U32 in, U32 out, one straight-line
  function, uniform on GPU.
- **Expected benefit.** Makes the premises in section 1.2 facts instead of
  inferences. It would show whether exact-plane's Metal filter certified the
  same pairs as the CPU because the target behaves like the CPU or because
  the filter's floors keep it away from subnormals (both are consistent with
  the measurement). It catches a future Bend or macOS update that changes the
  emitted arithmetic.
- **Risk.** Low. Metal behaviour can differ by GPU generation (applegpu
  PR 65 and issue 62), so the probe must run on every machine class used.
- **First acceptance test.** A probe with at least these vectors, compared
  bit for bit with a per-target expectation table:
  - `TwoProd(1 + 2^-12, 1 + 2^-12)` via the 4097 split: product
    `1 + 2^-11` (the exact `2^-24` tail is a tie and must round to even) and
    residual exactly `2^-24`. Tests ties-to-even and residual survival.
  - `p = RN(a·b)` computed in one function, `a·b − p` in another: must be 0
    on every target (no hidden FMA).
  - `2^-126 · 0.5`: `2^-127` on JS and native, 0 where FTZ holds; a subnormal
    input times `2^20`: exact on JS, 0 where inputs are flushed.
  - `1/3` and `sqrt(2)`: bit patterns `0x3EAAAAAB` and `0x3FB504F3` if ÷ and
    √ are correctly rounded.
  - `4097 · 2^117`: infinity (splitter overflow threshold).

### P2. FTZ audit: make every gradual-underflow assumption explicit

- **Idea.** For each module that reasons about F32 rounding, state whether it
  (a) is immune (exact decode from bits), (b) is FTZ-safe by a window proof,
  or (c) assumes gradual underflow. Fix (c) cases that could run on Metal.
- **Where it plugs in.**
  - `kernel/intersections.bend` `product_exponents`: raise the lower bound on
    the biased exponent sum from 151 to 174, so every TwoProd intermediate is
    a multiple of `2^-126` (lowest product bit `2^(ea+eb−46) ≥ 2^-126`), and
    add a window on addend words so TwoSum results cannot fall below
    `2^-126`. Alternatively route these certificates to the U32 Big path of
    `robust-predicates.bend`, which is immune.
  - `kernel/hybrid/corefine/gate.bend` tier 1: turn the back-of-envelope in
    section 3.1 into a written lemma, or add an exponent window like
    `point_plane`'s.
  - `kernel/real.bend`: document that the F32x2 bounds assume no subnormal
    low words; on FTZ a low word may be flushed, which keeps the pair
    canonical but changes the represented value.
- **Bend fit.** Trivial changes to pure predicates.
- **Expected benefit.** Removes the only concrete FTZ hazard found in wonky's
  code (section 4.2 item 3) and documents why the other filters are safe.
- **Risk.** More cases return "unresolved" or go exact near `2^-80`
  magnitudes, which is irrelevant for millimetre CAD. Changed thresholds must
  not alter corpus results (expected: none).
- **First acceptance test.** With `x = 1 + 2^-23`, `a = x·2^-52`,
  `b = x·2^-51` (biased exponents 75 and 76, sum 151) the exact product is
  `(1 + 2^-22)·2^-103 + 2^-149`. Build the expansion of `a·b` minus the
  expansion of `p'·1` with `p' = (1 + 2^-22)·2^-103`. The true difference is
  `2^-149`. Under an FTZ emulation of the F32 operations (or on Metal) the
  current code may report `expansion_zero = True`. After the fix the product
  is not admitted, so no zero certificate is issued on any target; on JS the
  answer is unchanged or unresolved, never "zero".

### P3. Adversarial sweep and mutation harness across targets

- **Idea.** Kettner's adjacent-float sweeps, regenerated in F32 bit patterns,
  for every predicate wonky ships, run on JS, native and Metal against an
  independent BigInt oracle (the one `test/robust-predicates.test.mjs`
  already has). Add consequence tests (hull visibility invariants A1-B2 for
  planar arrangements, bounded point-location walks with a cycle
  diagnostic). Add mutation checks, as applegpu's test header asks for: break
  a filter constant on purpose and require the harness to notice.
- **Where it plugs in.** `test/` harness plus a batch entry point in Bend for
  the sweeps. Predicates: `point_plane`, `LinePlane`, the gate's projected
  orientations and `bound3` tests, exact-plane's `side`.
- **Bend fit.** Ideal: 65,536 independent calls per map, fixed work, balanced
  fork-join; immutable U32 inputs.
- **Expected benefit.** A regression net for P2, P4, P5 and P8, and for Bend
  upgrades. The Attene PR 15 lesson: an oracle, not symmetry, finds wrong
  signs.
- **Risk.** Runtime (run after the benchmark, and in CI only on demand).
  Oracle bugs; keep the oracle independent of the Bend code.
- **First acceptance test.** Map `p = (0.5 + X·2^-24, 0.5 + Y·2^-24)` for
  `X, Y = 0..255` with `q = (12, 12)`, `r = (24, 24)` (ulp at 0.5 is
  `2^-24`) through every orientation filter: zero mismatches between certified
  signs and the oracle on all three targets, and every oracle zero reported as
  exact zero, never as a certified sign. Mutation: multiply the gate's
  `kfilter` by `2^-8`; the harness must report mismatches.

### P4. A predicate generator with static widths, composed bounds and zero patterns

- **Idea.** One small DSL for polynomial predicates (inputs with declared
  kind: F32 word, F32x2 pair, lattice integer, homogeneous point; `+ − ×`;
  sign). The generator (a build-time tool; production arithmetic stays in
  Bend) computes:
  - Fortune-Van Wyk bit lengths per node, including input exponent span;
  - a Bartels-style composed error bound instantiated at `u = 2^-24`, with an
    explicit underflow floor chosen to keep the whole graph in normal range
    (the `point_plane` window argument, generalized);
  - a structural zero pattern (Bartels `zero_pattern`, exact-plane's
    plane-ID zeros, the gate's axis-aligned zeros);
  - the SoS minor ladder for the predicate (Edelsbrunner-Mücke §4.2
    `Next-v`/`Matrix` generator);
  - Nanevski-style stages: which subexpressions depend only on the "fixed"
    argument (a plane) and can be hoisted.

  It emits straight-line Bend for the filter, the zero check and a fixed-width
  exact evaluation (P5).
- **Where it plugs in.** First `point_plane` and the gate's orient2d/orient3d
  (to reproduce today's hand results), then exact-plane's plane-side and
  det4, then `LinePlane` and TPI (P7).
- **Bend fit.** Excellent: generated code is fixed-shape and pure. The
  generator itself is not production geometry.
- **Expected benefit.** The gate has about ten hand-derived bounds with
  derivations in comments; each is a place for a Muller-Rideau-style error.
  Generation makes them reproducible and reviewable. Structural zeros target
  the measured hot spot: on the hex-nut case, 85,456 of 85,476 exact
  evaluations were zeros (section 3.3).
- **Risk.** A generator bug is systematic. Mitigate with P3 (oracle sweeps)
  and by checking generated bounds against the existing hand bounds (generated
  must be at least as safe). Scope creep: stay polynomial; curved predicates
  are P9.
- **First acceptance test.** (1) The generated bit budget for exact-plane's
  plane-side predicate on the 34-bit lattice reproduces the documented worst
  case of `9B + 19 = 325` bits; (2) generated `point_plane` makes the same
  decisions as the current one on every corpus job and on the P3 sweep; (3)
  the generated gate orient2d bound is not smaller than the hand bound on any
  sweep input where the hand bound is proved.

### P5. A fixed-width exact tier behind a declared input contract

- **Idea.** Keep the full-range variable-length Big for "anything goes", but
  add fixed-width straight-line exact kernels for the classes that dominate:
  exact-plane's lattice predicates (worst case 21 limbs of 16 bits), and
  F32x2 predicates whose words fall in a declared exponent window, scaled to
  a common exponent as `gate.bend` already does. Anything outside returns
  `CapacityExceeded`, never a wrong sign.
- **Where it plugs in.** `kernel/robust-predicates.bend` (base-4096 digits
  today), exact-plane `big.bend` (variable 16-bit limbs), the gate's
  `big_det`.
- **Bend fit.** Fixed tuples of U32 limbs, 16×16-bit partial products with
  explicit carries (no U64), fixed loop depth: uniform on GPU and allocation
  free. Variable-length lists are Bend-friendly on the CPU, so the win there
  must be measured, not assumed (open question 4).
- **Expected benefit.** Predictable cost, and the GPU trial of plan §6 becomes
  possible for exact work. Moving from 12-bit to 16-bit digits alone cuts the
  digit count by a quarter and digit products by about 44% (INFERRED).
- **Risk.** A declared contract is a semantic restriction (exact-plane
  already refuses coordinates outside ±1024 mm). Two exact paths must agree;
  P3 checks that.
- **First acceptance test.** A million random raw-word cases inside and at the
  edge of the contract (including the largest lattice coordinates and all
  carry boundaries): the fixed-width result equals the BigInt oracle or is
  `CapacityExceeded`, never different; outside the contract the variable path
  answers.

### P6. Two sign interfaces: `exact_sign` and `sos_sign`

- **Idea.** `exact_sign → Negative | ExactlyZero | Positive | Undefined |
  Uncertain | CapacityExceeded` and `sos_sign → Negative | Positive` plus tie
  provenance (which minor of the ladder decided, which object IDs). IDs come
  from provenance (leaf, face, vertex), never from scheduling order.
- **Where it plugs in.** `kernel/robust-predicates.bend` already has
  `Negative | ExactlyZero | Positive | Undefined` and a `Method`; add the
  missing states and the SoS wrapper. corefine keeps its Manifold-style
  shared perturbation for combinatorics; recover, carrier unification and
  contact decisions consume `exact_sign`.
- **Bend fit.** Good: the ladder is a fixed list of minors; a GPU version
  evaluates all and reduces to the first nonzero (SoS note).
- **Expected benefit.** Keeps coincidence and contact as first-class evidence
  (SoS §6) while combinatorics stay perturbed. Tie provenance makes
  refusals and diffs explainable to Marc and to LLMs.
- **Risk.** API churn; the perturbation order must be one global order for
  all predicates that share it.
- **First acceptance test.** For three coincident points with distinct IDs,
  all six argument orders: `exact_sign = ExactlyZero` every time; `sos_sign`
  equals the oracle's SoS ladder and flips exactly with permutation parity.
  Add the PR 15 lesson: compare `exact_sign` with the oracle on the P3 sweep,
  not only with its own permutations.

### P7. Indirect three-plane points and a filtered `LinePlane`

- **Idea.** Add TPI points `(N, W)` from three planes (Attene, Campen) with
  certified denominator sign, canonical `W > 0`, `Undefined` on `W = 0`, and
  exact side, equality and ordering tests. Add a filter to `LinePlane`, which
  today is always exact. Keep original primitive IDs on every implicit point.
- **Where it plugs in.** recover's corners where three **planar** carriers
  meet (today refined by Newton to a residual of at most `1e-7` mm) become
  exact TPI points; Newton stays for curved carriers. corefine's tag pairs
  per new edge (plan step 9) become implicit LPI/TPI records instead of
  rederived adjacency.
- **Bend fit.** Fixed-degree polynomials (TPI numerator 7, denominator 6 from
  triangles; less from stored planes), bounded depth: fits P4/P5.
- **Expected benefit.** Exact planar corners and incidences in the recovered
  B-rep; removes one source of sliver heuristics named in plan §2.2.
- **Risk.** Construction depth must stay bounded (no implicit points of
  implicit points unless the degree is budgeted, see Cherchi's cascade
  failure). Denominator handling is exactly where Attene's library had bugs.
- **First acceptance test.** Three rotated planes and a fourth plane that
  passes exactly through their intersection by construction: side test
  returns `ExactlyZero`; the same with a fourth plane moved by one ulp of its
  offset returns the correct nonzero sign; three planes with a common line
  return `Undefined`; a PR 14-style cascade (midpoint of an LPI point and an
  explicit point) returns the exact midpoint. On the corpus, every recovered
  planar corner is exactly incident to its three carriers.

### P8. Accurate double-word addition and pinned `R.Real` schedules

- **Idea.** Replace `R.add` with Joldes Algorithm 6 (AccurateDWPlusDW), keep
  the current one only as a named `add_sloppy` where a proof covers the call,
  and either switch `mul` to DWTimesDW1 (Algorithm 10) or prove the current
  grouping. Note the theorem and version next to each bound.
- **Where it plugs in.** `kernel/real.bend`; re-derive constants that quote
  "about `2^-46` of the operands" (gate `kfilter`) and "about `2^-44`" per
  constructed point (corefine).
- **Bend fit.** Excellent: fixed scalar graphs. Accurate addition costs 20
  F32 operations against 11.
- **Expected benefit.** A published relative bound (`3u²`, about 46 bits)
  under cancellation instead of none; the double-word layer becomes citable.
  The effect on corefine's topology is expected to be small, because its
  filters already use operand-scaled absolute bounds (section 3.2).
- **Risk.** Every Real-heavy kernel gets slower (corefine, recover); outputs
  change in the last bits, so corpus byte-identity must be re-baselined
  deliberately.
- **First acceptance test.** Muller-Rideau Property 2.1 at `u = 2^-24`:
  `x = (1, 2^-24 − 2^-48)`, `y = (−1/2 + 2^-25, −2^-49 + 2^-72)` (all words
  representable and normalized). The new `add` has relative error at most
  `3u²/(1 − 4u)` against the BigInt oracle and close to `3u²` on this family.
  A directed search over cancellation cases (opposite-sign high words that
  are adjacent floats, Yang Theorem 3.4) records how far the old `add` can
  exceed that bound; the result goes into the `real.bend` header.

### P9. RN-only intervals and root certificates for curved decisions

- **Idea.** A small interval type built from RN operations with Rump's
  neighbour enclosure (or GTE's `SWInterval` construction), valid on the
  gradual-underflow targets, with a separately proved or range-guarded
  variant for FTZ. Use it for interval Newton / Krawczyk certification of
  curved corners and tangencies, and Yap-style root bounds where an exact zero
  must be proved. Budget exhaustion returns `Unresolved`, never zero.
- **Where it plugs in.** recover's multi-carrier corner refinement,
  `ray.bend` and `curve-band.bend` near-degenerate branches (today
  "unresolved" at `angular_guard = 1e-12`), and later fillet contact lines.
- **Bend fit.** Small pure F32 schedules; fixed-iteration refinement per
  batch. Exact neighbour computation by bit manipulation needs a U32→F32
  bitcast at language level (open question 8); Rump's Algorithm 1 does not.
- **Expected benefit.** Turns "residual below `1e-7` mm" into "a unique root
  lies in this box", and makes curved "unresolved" answers rarer without
  making them wrong.
- **Risk.** Interval blow-up on nearly tangent carriers (they should stay
  unresolved); FTZ proof work for any Metal use; a large piece of new code.
- **First acceptance test.** Line against circle with root `√2`: the
  enclosure `[lo, hi]` satisfies `lo² < 2 < hi²`, checked exactly by the
  BigInt oracle from the decoded words, with width at most `2^-40`. A tangent
  configuration must return `Unresolved`, not a root.

### P10. Hot-pixel snap rounding for 2D sections and FDM contours

- **Idea.** Hobby's construction as a batch algorithm: exact segment-pair
  intersections, unique hot pixels, exact segment-against-pixel tests with
  half-open pixels, per-segment ordering, deduplication. For a rational
  `x = N/D` with `D > 0`, the pixel test against `q + 1/2` is the exact sign
  of `2N − (2q + 1)·D` (Hobby note).
- **Where it plugs in.** 2D sections and slicing outputs (`kernel/section.bend`
  and the FDM path), sketch arrangement output. Never inside the analytic
  Boolean.
- **Bend fit.** Batched detection, sort, unique and group: pure passes. The
  published sweep is not a GPU fit and is not needed.
- **Expected benefit.** A valid planar arrangement on a stated grid with a
  stated deviation (`h/2` per coordinate, `h/√2` Euclidean), with every
  collapsed vertex or merged edge reported.
- **Risk.** It changes topology by design (merges, collapses); must be opt-in
  and reported. `k′` can explode for near-collinear input.
- **First acceptance test.** Hobby's Fig. 1-2 regression with endpoints
  (0,0), (9,5), (−1,−2), (13,6) on the integer grid: the output is fully
  intersected (exact check: output pieces meet only at endpoints) and every
  output vertex is within `1/2` per coordinate of its source segment.

### P11. Staged plane contexts as flat F32 records

- **Idea.** Nanevski's stages without thunks: for each face used in many
  queries, precompute an immutable record (plane words, hoisted differences,
  magnitude bounds, exponent class, zero-pattern flags, provenance). Queries
  then read flat F32 fields.
- **Where it plugs in.** The corefine gate (it already notes that "Reals are
  heap pairs, F32 words are inline" and tests about ten times more pairs than
  triangles) and recover's clearance join.
- **Bend fit.** Flat SoA F32 records are condition (a) of the plan's Metal
  trial; batching across a whole operation is condition (b).
- **Expected benefit.** Fewer operations per query and a GPU-shaped workload.
- **Risk.** Memory; affine arrays may force explicit duplication.
- **First acceptance test.** Decisions byte-identical to the unstaged gate on
  the corpus and the four adversarial suites; operation counts per query
  reported.

---

## 6. Open questions worth a prototype

1. **What does Bend's Metal target actually do on the machines in use?**
   FTZ on inputs and on results, RTNE everywhere, and correctly rounded ÷ and
   √ under `MTLMathModeSafe`? None of the sources establishes ÷ and √, and
   applegpu's model is generation dependent. Prototype: P1's probe on each
   machine class. Cheap, and it decides how much of P2 is urgent.
2. **Is an FTZ-aware error bound worth having, or is "window plus exact
   decode" always better?** A Bartels-style composition with an extra
   absolute term per flushed operation, amplified by later multiplications,
   is derivable in principle. Prototype: derive it for orient2d and
   `point_plane`, then compare the acceptance rate against the window
   approach on the corpus. If the window rejects almost nothing in millimetre
   CAD (likely, INFERRED), prefer the window.
3. **How often do CAD predicates go exact, and how many of those are zeros?**
   One published exact-plane line (hex-nut) says 7.4% exact, 99.98% of them
   zero. Prototype: per-predicate counters (filter, structural zero, exact
   zero, exact nonzero, capacity) in `robust-predicates.bend` and the corefine
   gate, reported over the whole corpus. This sets the priority between P4's
   zero patterns and P5's fixed widths.
4. **Fixed-width or variable-length limbs on Bend's CPU runtime?** The
   interaction-net runtime may favour short lists for the typical 1-4 limb
   operands; fixed width wins on GPU by construction. Prototype: a 21-limb
   fixed plane-side kernel against `big.bend` on the exact-plane corpus,
   cpu1/cpu18/Metal.
5. **Can corefine's decisions on constructed points become exact?** Today they
   are "consistent but may differ from exact arithmetic" below about `1e-13`
   relative. Prototype: represent an edge-face intersection point as its
   (edge, face) record, evaluate the few predicates that consume it as
   indirect predicates (degree analysis first), and measure the exact
   fallback rate. This would retire the plan's conjecture that exact-plane
   agreement catches corefine's unproven decisions.
6. **How far do F32x2 mesh-only chains drift?** The plan's `2^-44` per
   constructed point is a conjecture. Prototype: Solidean-style long chains
   (hundreds to thousands of operations) on corefine alone, compared with
   exact-plane's exact result at every step.
7. **Does Rump's enclosure survive FTZ+DAZ on a restricted domain?** Unary F32
   functions have only 2^32 inputs, so an exhaustive check of a candidate
   FTZ variant (with `eta` replaced by `2^-126` and inputs restricted) is
   feasible, even on the GPU itself. Prototype: exhaustive comparison of
   enclosures against exact neighbours, JS versus Metal.
8. **Does Bend expose U32→F32 bit reinterpretation at the language level?**
   The code generator has an internal `f32_from_bits` (DOCUMENTED,
   `bend-comp.ts`), and wonky uses `F32.bits` in the other direction. Exact
   `ufp`, successor and Ozaki's static filter are simpler with it.
9. **Is every `R.Real` canonical?** Prove, or test adversarially, that each
   `renorm` call meets the Fast2Sum precondition, since corefine's "comparing
   two Reals is exact" relies on it. Under FTZ a flushed low word keeps the
   pair canonical but changes its value, which matters for cross-target
   identity.
10. **Does exported geometry survive re-import?** corefine snaps constructed
    points to double representability; exact-plane exports to a `2^-36` mm
    grid and checks; STEP export writes doubles. Prototype: round-trip every
    corpus result through its export format and re-run the exact validity
    gates (the Lean-verified contract in the sibling
    [verified-3d-mesh-intersection note](sources/verified-3d-mesh-intersection-lean-4.md)
    is a candidate specification).
11. **Is the perturbation order stable under re-tessellation?** corefine's
    shared-decision perturbation should depend on provenance IDs only, so the
    same model decides the same ties after an unrelated edit. Prototype:
    re-tessellate one operand at a different density and diff the tie
    decisions on unchanged faces.

---

## 7. Catalog of the remaining sources

Catalog-only sources from the scout's list, not deep-read. Status and license
are as the scout recorded them (DOCUMENTED per repository or publisher
metadata, not a legal review). "Check" says what a future deep read should
answer for wonky.

### 7.1 Filters and certified bounds

| Source | Year | Status / license | One line | Check for wonky | Priority |
|---|---|---|---|---|---|
| [Melquiond, Pion, Formally certified FP filters for homogeneous predicates](http://www.numdam.org/item/ITA_2007__41_1_57_0/) | 2007 | historical | Machine-checked orient2d filters including overflow and underflow cases | Can the Coq approach extend to an FTZ model? Template for proving P4's generated bounds | 3 |
| [Meyer, Pion, FPG code generator](https://hal.inria.fr/inria-00344297) | 2008 | historical | Static analysis of C++ predicates emitting almost-static filters, used by CGAL | Generator architecture for P4; which analyses survive the move from double to F32 | 3 |
| [Brönnimann, Burnikel, Pion, interval dynamic filters](https://www.sciencedirect.com/science/article/pii/S0166218X00002316) | 2001 | historical | CGAL `Interval_nt`: dynamic interval filters on directed rounding | Does not port (no rounding modes); read for filter-failure statistics | 3 |
| [Ogita, Rump, Oishi, Accurate sum and dot product](https://www.tuhh.de/ti3/paper/rump/OgRuOi05.pdf) | 2005 | historical | Compensated Sum2/Dot2 from TwoSum/TwoProd with rigorous bounds | A tighter middle tier for `point_plane`'s 24-product dot, before exact | 3 |
| [Shewchuk, Lecture notes on geometric robustness](https://people.eecs.berkeley.edu/~jrs/meshpapers/robnotes.pdf) | 2013 | maintained | Didactic orientation/incircle error analysis | Teaching reference for contributors and LLM prompts | 3 |
| [Schirra, Of what use is FP arithmetic in computational geometry?](https://link.springer.com/chapter/10.1007/978-3-642-03456-5_23) | 2009 | historical | Where floats are safe (filters) and where they break algorithms | Survey context; low new information after Kettner | 3 |
| [Jeannerod, Louvet, Muller, Kahan's 2×2 determinant](https://hal.science/ensl-00649347/) | 2013 | historical | FMA-based 2×2 determinant with a 2u relative bound | Needs FMA, which Bend lacks; only relevant if a verified FMA appears | 2 |

### 7.2 Extended precision and GPU numerics

| Source | Year | Status / license | One line | Check for wonky | Priority |
|---|---|---|---|---|---|
| [Muller, Rideau, Formalization of double-word arithmetic](https://hal.science/hal-02972245v2) | 2022 | historical | Coq proofs that corrected published double-word bounds | Already used via the Joldes note; the proof archive could anchor P8 | 3 |
| [Da Graça, Defour, float-float operators on graphics hardware](https://hal.science/hal-00021443) | 2006 | historical | Error analysis of float-float add/mul/div on 2006 GPUs | Pre-Apple-silicon; read for how they handled non-IEEE GPU rounding | 3 |
| [CAMPARY](https://homepages.laas.fr/mmjoldes/campary/) | 2016 | maintained | GPU/CPU n-term floating-point expansions | Longer expansions hit the same exponent wall (Lévy); license and FTZ handling unchecked | 3 |
| [QD library (Hida, Li, Bailey)](https://www.davidhbailey.com/dhbsoftware/) | 2000 | maintained; BSD-LBNL (HEARSAY) | Classic double-double and quad-double | Reference schedules; check license before copying anything | 2 |
| [Menezes, Magalhães, Franklin et al., GPU exact predicates](https://wrfranklin.org/p/239-marcelo-gpu-predicates-2021.pdf) | 2022 | historical | GPU single-precision interval filter, CPU double interval, CPU rationals | Relies on CUDA directed rounding (does not port); read for fallback rates on a GPU tier | 4 |
| [Qi, Yan, Zheng, GPredicates](https://ieeexplore.ieee.org/document/8692354) | 2019 | historical | Shewchuk adaptive predicates ported to CUDA | Divergence and memory costs of adaptive stages on GPU | 2 |
| [Collange, Flórez, Defour, GPU interval library](https://hal.science/hal-00263670/) | 2008 | historical | Boost.Interval-style intervals on early CUDA | How they emulated outward rounding; compare with Rump's RN-only method | 2 |
| [Daumas, Da Graça, Defour, arithmetic of GPUs](https://arxiv.org/abs/cs/0605081) | 2006 | historical | Measured non-IEEE rounding on pre-CUDA GPUs | Historical method for P1-style probing | 1 |

### 7.3 Exact arithmetic libraries and kernels

| Source | Year | Status / license | One line | Check for wonky | Priority |
|---|---|---|---|---|---|
| [CGAL filtered and lazy kernels](https://doc.cgal.org/latest/Kernel_23/index.html) | 2026 | active; GPL-3.0 / LGPL-3.0 | Reference industrial filtered predicates and lazy exact constructions | Study only (copyleft); benchmark numbers for filter hit rates | 3 |
| [Pion, Fabri, generic lazy evaluation](https://arxiv.org/abs/cs/0608063) | 2011 | historical | CGAL's lazy kernel: interval approximations plus a construction DAG | Mutation and ref-counting do not fit Bend; read for what to recompute instead of cache | 3 |
| [CGBN (NVIDIA Labs)](https://github.com/NVlabs/CGBN) | 2026 | maintained; NOASSERTION | Fixed-size multi-precision integers on CUDA, limbs spread over threads | Cooperative limb layouts for P5 on GPU; license unclear, study only | 3 |
| [georust/robust](https://github.com/georust/robust) | 2025 | maintained; Apache-2.0 | Allocation-free Rust port of Shewchuk's predicates | Clean reference for stage structure and test vectors | 3 |
| [ESOLID](http://www.cs.unc.edu/~geom/ESOLID/) | 2004 | abandoned | Exact CSG on low-degree algebraic solids | Deep-read in a sibling chapter ([note](sources/esolid-exact-boundary-evaluation-for-low-degree-curved-solid.md)) | 3 |

### 7.4 Degeneracies and perturbation

| Source | Year | Status / license | One line | Check for wonky | Priority |
|---|---|---|---|---|---|
| [Devillers, Karavelas, Teillaud, Qualitative symbolic perturbation](https://inria.hal.science/hal-01276444) | 2016 | historical | Perturbation defined on the predicate's geometry, for non-linear predicates | Tie-breaking for circle and cylinder predicates in recover | 3 |
| [Mehlhorn, Osbild, Sagraloff, controlled perturbation](https://people.mpi-inf.mpg.de/~mehlhorn/ftp/ControlledPerturbationGeneralStrategy.pdf) | 2006 | historical | Random input perturbation so fixed precision is provably correct | Conflicts with exact carriers; possibly useful for sampling-based FDM analyses | 3 |
| [Franklin, de Magalhães, Implementing SoS](https://arxiv.org/abs/2212.08226) | 2022 | historical | Practical SoS for 3D predicates with rationals | Engineering details for P6's ladder | 2 |

### 7.5 Controlled approximation and mesh arrangements

| Source | Year | Status / license | One line | Check for wonky | Priority |
|---|---|---|---|---|---|
| [Halperin, Packer, Iterated snap rounding](https://www.cgl.cs.tau.ac.il/projects/iterated-snap-rounding/) | 2002 | historical | Re-snap until vertices keep half-pixel clearance from non-incident edges | Clearance guarantee for P10's FDM contours | 3 |
| [Devillers, Lazard, Lenhart, 3D snap rounding](https://drops.dagstuhl.de/opus/frontdoor.php?source_opus=8743) | 2018 | historical | First 3D snap rounding with bounded Hausdorff motion | Theory behind Valque-Lazard; O(n^15) worst case | 3 |
| [Guibas, Salesin, Stolfi, Epsilon geometry](https://dl.acm.org/doi/10.1145/73833.73857) | 1989 | historical | Predicates return a truth value plus an epsilon certificate | Vocabulary for stating tolerance results; not a decision method | 3 |
| [Cherchi, Livesu, Scateni, Attene, mesh arrangements](https://dl.acm.org/doi/10.1145/3414685.3417818) | 2020 | historical | Float input, implicit intersection points, indirect predicates | Deep-read in a sibling chapter ([note](sources/cherchi-livesu-scateni-attene-2020-fast-and-robust-mesh-arra.md)) | 3 |
| [Garau, Cherchi, triangle intersections across representations](https://arxiv.org/abs/2507.08478) | 2025 | new | Templated triangle-triangle classification for float, rational and implicit points | Case analysis for the gate's exact triangle tests | 2 |
| [JTS OverlayNG](https://github.com/locationtech/jts) | 2026 | active; EPL-2.0 / EDL-1.0 | Production 2D overlay with snap-rounding noder and fixed precision model | Production evidence for P10; study only | 2 |
