# gitcad forge (forgekernel)

- Kind: exact-arithmetic B-rep kernel: a Python reference plus a partial Rust port.
  - Repo: https://github.com/gitcad-xyz/forge
  - PyPI: `forgekernel`, `forgekernel_rs` (https://pypi.org/project/forgekernel/, 14 releases, latest 0.9.13).
  - Host project: https://github.com/gitcad-xyz/gitcad ("Agent-first, headless, git-native CAD").
  - Design records in `gitcad/docs/adr/` (0018, 0019, 0020, 0021, 0023, 0024 are the kernel ones).
- Clone read: `tmp/research/gitcad-forge-forgekernel` at `ac6f23b` (2026-07-31, "release 0.9.13"): about 24.2k lines of Python in `src/forgekernel/`, about 37k with tests, and 1,497 lines of Rust. ADRs fetched to `tmp/research/gitcad-forge-forgekernel-adr/`.
- Author: Dan Willis (GitHub `theironchef`). He is the only contributor, with 181 commits.
- License: **Apache-2.0**, for both forge and gitcad. Porting code or ideas is fine with attribution and the NOTICE.
- Status (DOCUMENTED, `gh api` 2026-09-22):
  - 1 star, 0 forks, 0 issues. Created 2026-07-23, last push 2026-07-31.
  - **All 181 commits fall between 2026-07-23 and 2026-07-31** (44 on day one). There has been no activity since.
  - `PLAN.md` is written "so ANY agent (including a smaller model) can pick up the next packet". gitcad has ADRs for agent loops (0006 "agent-loop autonomy tiers", 0011 "night shift").
  - INFERRED: LLM-agent-built at very high velocity. The claims are self-verified only, and there are no external users.

## What it is

A kernel whose charter is: **"no float ever influences a topological decision"** (`PLAN.md` §1, ADR-0018/0019).

Numbers are drawn from a stack of exact kinds:
- ℚ (`fractions.Fraction`);
- ℚ[√d] (`SurdVal`);
- ℚ(√p,√q) (`BiSurd`);
- ℚ[π] as a polynomial ring (`polypi.py`).

Beyond those come certified rational intervals (`CInterval`, ADR-0019), and finally a labelled Monte-Carlo **"sampled"** tier (ADR-0024).

Anything that leaves the current field raises a *named* refusal: `MixedRadicals`, `BooleanUnsupported`, `SsiCellUncertified`, `NotchOutsideField`, …. Per `PLAN.md` §1.9: "A refusal with the right stage name is a SUCCESS state; a wrong number is the only failure."

Claimed capabilities (README):
- planar Booleans;
- quadrics with closed-form intersections;
- NURBS and SSI with "complete branch detection";
- offsets and shells, fillets, lofts;
- exact mass properties via the divergence theorem;
- STEP AP203/214.

**Reality from the code**: most curved capabilities are *special-case composite classes* with closed-form volumes, not general B-rep Booleans. Details below.

## How it works

### Exact planar core (`exact.py`, `brep.py`, `csg.py`)

- `Vec` is a tuple of `Fraction`s. `Plane` is `n·x = d` with an unnormalized rational normal, and `side(p)` is the exact sign of `n·p − d`. `canonical()` divides by the first nonzero component, so coplanarity is tuple equality.
- `F(x)` converts a float to its **exact binary** Fraction and never guesses decimals. Wider exact scalars pass through untouched. `as_fraction` asks a wider value to *prove* it is rational via `demote()`.
- Booleans are **csg.js BSP with exact classification** (`csg.py`, 158 lines):
  - `_split` computes exact FRONT/BACK/COPLANAR;
  - the crossing point is `x = vi + t(vj − vi)` with `t` an exact rational;
  - zero-area fragments are dropped by an exact `area2()` test.

  **These are constructed vertices, not a plane-based representation**, so coordinate bit-length grows with Boolean depth. The Rust README expects "larger wins … on deep chains where ref's denominators grow". Polygon `source` labels ride through every split as lineage.
- Validity: `Solid.watertight_violations()` checks exact edge coverage ("line-coverage closure", which tolerates csg.js T-junctions). `kernel.boolean` raises if the result is not watertight.
- Mass properties: signed tetrahedra (`volume6`), exact rational.
- Rotations: exact only for multiples of 30° and 45°, using `_cos_sin_deg` tables in ℚ[√2]/ℚ[√3] and a Rodrigues matrix over ℚ[√d] (`kernel.py`). Draft converts `tan` of a float angle to its exact binary Fraction, a documented "bounded-error construction".
- Chamfer is the solid intersected with one half-space per convex edge (`brep.chamfer_planar`). A corner-facet semantics bug (d³/12 per corner) was found by OCCT differential and hand math (`kernel.py` docstring; `PLAN.md` §1.2).

### Number fields

- **ℚ[√d]** (`surd.py`): `a + b√d` with d square-free.
  - `_sign` (L317): if the signs of a and b agree, return that sign. Otherwise compare `a²` with `b²d`; the larger magnitude wins, and equality means 0. All integer or rational ops, no floats.
  - Division uses the conjugate: `(c − e√d)/(c² − e²d)`.
  - Mixed radicals promote to `BiSurd` ℚ(√p,√q) (`bisurd.py`) when p and q are coprime square-free; otherwise `MixedRadicals` is raised. Example: √6 with √10 has no home.
  - `sqrt_rational` refuses nested radicals √(a+b√d).
- **ℚ[π]** (`polypi.py`): a polynomial in π with rational or surd coefficients.
  - Zero-test is exact by transcendence: all coefficients are zero.
  - Sign narrows a rational enclosure of π from 20 up to about 100 stored digits, using rigorous interval evaluation (each term's bounds from 4 corners). It raises `ArithmeticError` if the sign is still undecided at the stored precision.
  - Needed because fillet volumes bring π² (Pappus: a torus is 2π²Ra²).
- **`CInterval`** (`interval.py`, ADR-0019): a rational `[lo, hi]` with rigorous `+ − ×`.
  - `pi_interval()` has width 1e-60, from a 60-digit integer constant.
  - `sqrt` uses integer `isqrt` brackets with `a² ≤ x ≤ b²`.
  - Rule: "Every topological decision is made from a certified sign … If an interval straddles zero, the kernel tightens it … if it cannot certify within budget, it refuses."
  - Results carry `provenance ∈ {exact, certified}`; `sampled` was added by ADR-0024.

### Curved solids (`quadric.py`, 3,069 lines; `body.py`, 3,970 lines)

- **Composite classes with closed-form measures**:
  - `DrilledSolid`, `AxisStack` (coaxial counterbores), `RevolveSolid`;
  - `DisjointUnion` (exact tangency proofs such as `(n·c − d)² == r²(n·n)`);
  - `RoundedBox`, `FilletedPrism`, `FilletedBox`, `VariableFilletedBox`, `FilletedChamferedBox`;
  - `MiteredSweep` (volume exact in ℚ[√2]: 720 + 240√2 for the corpus channel);
  - `SphereOverlap`, `steinmetz(r)`.

  The early fillet was explicitly "a new composite `RoundedPlanar` … whose volume/centroid come from the formula — no curved B-rep needed at this stage" (`PLAN.md` W-D).
- **Canonical B-rep** `Body` (`body.py`, ADR-0021):
  - `Face = (Surface, [Loop], sense)`, `Loop = [Edge]`, `Edge = (Curve, v0, v1)`;
  - analytic Plane/Cylinder/Cone (half-angle as a rational tan)/Torus/Sphere; Line/Circle.
  - Volume and centroid use the divergence theorem per face in closed form: `_band_sweep` for cylinders, `_sphere_zone`, `_torus_sweep` via Pappus, `_cone_rims`.
  - **Trimmed arcs are measured in quarter or twelfth sectors** (`_quarter_antiderivative`, `_sin_cos_twelfths`). This pins every arc endpoint to angles whose sin and cos are in ℚ[√3] (Niven).
- **Quadric Booleans** are hand-written per family:
  - `flat.py`: a flat on a round bar;
  - `notch.py`: a box straddling a bore, where each crossing is decided by comparing `a/r` with twelfth cosines `{0, ±1/2, ±√3/2, ±1}`;
  - `sphercut.py`, `bsolid.py`, `trimshell.py`.

  There is no general plane×cylinder or cylinder×cylinder arrangement. The general cases go to the `sampled` tier (ADR-0024).

### SSI (`ssi.py`, 1,444 lines; "K3.3")

- Exact rational de Casteljau subdivision of both Bézier patches, pruned by control-net bounding-box disjointness. Pruning is conservative, so no branch is lost.
- Branches are the connected components of surviving leaf pairs in a resolved 4D (u,v,s,t) cell graph.
- Each cell is refined by float Newton. The **certificate is an exact rational residual `|A(u,v) − B(s,t)|² < tol²`**, i.e. a tolerance certificate, not an exact point.
- Cells that fail are deepened (`_RESOLVE_LEVELS = 6`) until there is an existence proof, an exclusion proof, or a named `SsiCellUncertified` refusal. Tangential contact is the canonical refusal.
- "Complete" means complete **at the stated resolution 2^-d** (docstring).

### Sampled tier (`sampled.py`, ADR-0024)

- A CSG expression over operand meshes. Membership is by ray parity. Volume and centroid are Monte-Carlo estimates with a reported **3σ half-width**.
- Deterministic fixed-seed LCG (`_LCG_A = 1664525`, `_SEED = 20260730`).
- Never drives topology. Labelled `provenance="sampled"`.

### Other modules

- STEP (`stepio.py`, 1,856 lines): STEP decimal reals parse **exactly** into Fractions (`_num`). It reads `B_SPLINE_*_WITH_KNOTS` including rational complex entities, and writes `MANIFOLD_SOLID_BREP`/`ADVANCED_FACE`/`PCURVE`/`SEAM_CURVE`.
- `hlr.py`: native hidden-line removal. It uses floats, justified as "display property".

### Reference ⇄ port discipline

- ADR-0018 set up three backends behind one seam: `occt` (oracle), `ref` (Python exact spec) and `forge` (Rust port). "`ref` is forge's oracle; OCCT is the independent cross-check".
- `tests/test_rust_oracle.py` asserts **identical exact volume6 and identical canonical face set** between Python and Rust. The canonical face set is sorted `num/den` vertex strings per face.
- The Rust port (`rust/forge-core/src/lib.rs`) covers only the K1 planar core, chamfer, prismatoid, NURBS eval and patch bboxes. Its README says it is 2.5× faster than Python on a Boolean cut.
- Rust adds a float filter, `side_filtered` (L866): f64 `n·p − d` against a static bound `16·ε·(Σ|tᵢ| + |d| + 1)`, with exact BigRational fallback. It looks conservative, but no proof is given (INFERRED).
- **ADR-0020 (2026-07-24, one day after ADR-0018) removed OCCT entirely.** Correctness now rests on:
  - exact-ℚ invariants;
  - ref⇄Rust bit-identity;
  - property fuzzing: `V(A∪B) + V(A∩B) = V(A) + V(B)`, the SSI residual certificate, additivity and partition identities.

  "We lose the independent oracle. This is the real cost."

## Robustness and guarantees

- **Exact, where it answers**: K1 planar decisions and measures are exact rationals, and ℚ[√d]/ℚ[π] signs are decided exactly by the algorithms above.
- **Refuses outside the field**, by name. This is honest, but see the null-set problem below.
- **Tolerance-certified, not exact**: SSI points (residual < tol²) and SSI completeness (resolution 2^-d).
- **Statistical**: the sampled tier (3σ).
- The capability matrix claims **340/345 cells (99%)** with 0 crashes at 0.9.7/0.9.8 (`PLAN.md`). The early corpus scorecard claimed "ref 94.4% (17/18) > OCCT 88.9% (16/18)".
- **ADR-0023 undercuts that metric in the author's own words.** A per-parameter sweep (`gitcad.bench.coverage`) found:
  - "flat on a bar": **3/33 (9%)** of parameters answer;
  - "slot through a bar": **0/25 (0%)**;
  - "bore across a plate wall", crossing set: **0%**.

  The reason: a chord across a disc leaves area `r²(t − sin t cos t)` with `t = arccos(h/r)`, which is a rational multiple of π only at twelfths (Niven). The kernel's representable set is "a null set … which reads as success on a cell-counting instrument and as refusal to every user." ADR-0023 then introduced certified angles (CInterval) for trimmed quadric faces; release 0.9.13 is titled "certified angles".

## Parallelism and performance

- None. The code is single-threaded Python `Fraction` arithmetic. The only figure is the Rust port being about 2.5× faster than Python on one Boolean (DOCUMENTED, `rust/README.md`).
- The PLAN's W-I gate was "≥10× speed on the Menger case"; no result is recorded.
- Deep Boolean chains grow denominators, which is the known cost of constructed rational vertices.

## Known failures, limitations, war stories

- **Null-set exactness** (ADR-0023, above). This is the central lesson: an exact-field kernel that requires *measures* (volumes, arc spans) to be exact refuses nearly every real machining parameter.
- **Type-lattice bugs** in the exact tower, all documented in docstrings:
  - `.numerator` on a `SurdVal` whose value is rational crashed chamfer and shell "four separate times in one day" (`surd.sqrt_rational`);
  - reading `.b == 0` on a `BiSurd` "silently dropped c√q + e√pq and reported 960 for 960 − 20√3" (`exact.as_fraction`);
  - a quarter-turn rotation typed every coordinate as ℚ[√1], which made later rational-only paths refuse (`kernel.rotate._narrow`).
- The chamfer corner-facet error d³/12 per corner lived in "every chamfer this kernel ever produced" until an invariant test caught it (`kernel.chamfer` docstring).
- The first `flat` draft claimed 45° support that the arc machinery lacked, and it was caught only by a full parameter sweep: "spot-checking two values would not have" (`tests/test_flat_on_a_round_bar.py`).
- Release commits mention "the silent chamfer bug, and the sampled-tier hang" and "5 real defects found by adversarial repro" (2026-07-31).
- No general quadric Boolean. Cylinder×cylinder and prism×sphere go to Monte-Carlo (ADR-0024).

## Relevance for wonky

1. **Reference-plus-port-plus-oracle discipline**, the most transferable idea:
   - one semantic reference;
   - each port asserts **bit-identical canonical serialization** of results. The canonical serialization sorts faces and vertices as exact `num/den` strings.

   For wonky the "ports" are Bend's JS, C and Metal backends compiled from one source. Identity tests there check the Bend compilers/runtimes and F32 semantics rather than two hand-written implementations: FMA contraction, denormal flushing and `fast-math` on Metal can break bit-identity (INFERRED).
   - Adopt a canonical exact serialization (integer limbs as hex, deterministic ordering) as the cross-backend oracle, plus property identities such as `V(A∪B)+V(A∩B)=V(A)+V(B)`. These are decidable on exact planar volumes and interval-checkable on curved ones.
2. **ℚ[√d] sign test → U32 limbs**: `sign(a + b√d)` = compare `a²` with `b²d` under sign cases. That is pure integer arithmetic with doubled bit-length, which suits fixed multi-limb U32. It covers wonky's plane∩cylinder / line∩circle intersection coordinates, which with rational or grid inputs live in ℚ[√D] for a **per-intersection** discriminant D.
   - Forge's *field* approach (one d, or a coprime pair) does not scale to arrangements with many independent discriminants.
   - Wonky should represent each such number as `(a, b, D)` and compare two of them by bounded repeated squaring. This is fixed degree, so a static limb count per predicate is possible, in the style of CGAL's `Sqrt_extension` / `Root_of_2` comparisons (INFERRED).
3. **Keep topology algebraic, measures certified.** ADR-0023's null-set finding tells wonky not to demand exact *measures*. Arc angles, areas and volumes involve arccos/π and should be `CInterval`-style brackets. Only *predicates* (signs of polynomial expressions in the input data) need exactness. Wonky's analytic B-rep already stores curves, not angles; keep it that way. Never index arcs by sector counts.
4. **Certified measures via the divergence theorem per analytic face** (`body.py` `_face_volume_term*`, `volume_certified`): exact for planar faces, bracketed for quadric faces. Useful as an independent check on wonky's certified print mesh: mesh volume vs B-rep volume within the deviation bound. It also gives cheap FDM mass estimates.
5. **Provenance tiers** (`exact / certified / sampled`, each with an explicit error) match csgrs's `GeometryOutcome` and wonky's "explicit tolerances" rule. Adopt one tier tag on every result.
6. **Honest-refusal taxonomy and parameter-sweep coverage**: named refusal classes that distinguish "outside field" (a permanent boundary) from "not this family" (try another path), as in `notch.NotchRefused` vs `NotchOutsideField`. Also benchmark by **parameter coverage, not cell count** (ADR-0023). Wonky's Boolean bake-off should score parameter sweeps (depths, angles, offsets), not one representative per case.
7. **STEP decimals as exact rationals** (`stepio._num`): exact import of STEP decimal text. Wonky's F32 or integer-grid inputs would round decimals, so decide explicitly whether import snaps to the grid (with a reported deviation) or keeps decimal-scaled integers (INFERRED).
8. **Not a solution to wonky's blocker.** Forge has no general plane/cylinder Boolean. It solves twelfth-angle special cases exactly and falls back to Monte-Carlo otherwise. Its csg.js BSP with constructed rational vertices is the opposite of the construction-free, bounded-degree design wonky needs for fixed-width U32 limbs.
9. **Bend fit**: Python `Fraction`s are unbounded bignums; that does not port as is. The *algorithms* do port: sign of a surd, rigorous interval polynomial evaluation, subdivision SSI with bbox pruning (uniform, fork-join friendly), and the divergence-theorem terms. They need bounded-precision redesign.

## Pointers worth porting or studying

- `src/forgekernel/surd.py:317` (`_sign`), `:257` (conjugate division); `bisurd.py` (two-radical promotion); `exact.as_fraction` (the "prove it's rational" guard).
- `src/forgekernel/polypi.py` `sign()` (L252): rigorous interval evaluation of a polynomial in π with corner bounds.
- `src/forgekernel/interval.py`: `CInterval`, `pi_interval`, `_sqrt_low` and `_sqrt_high` via `isqrt`.
- `src/forgekernel/csg.py`: the smallest exact csg.js. Useful as a *slow oracle* for wonky's planar Boolean tests, not as a design.
- `src/forgekernel/body.py`: the canonical B-rep schema; `volume`, `volume_certified`, `_band_sweep`, `_sphere_zone`, `_torus_sweep`, `arc_span_certified`.
- `src/forgekernel/ssi.py`: detection, resolved clustering, residual certificate and per-cell resolution. Read the docstring at L1-60.
- `src/forgekernel/sampled.py`: deterministic, labelled Monte-Carlo.
- `tests/test_rust_oracle.py`: canonical-string differential between implementations.
- `rust/forge-core/src/lib.rs:866` `side_filtered`: an f64 static filter over a BigRational fallback.
- ADRs (`tmp/research/gitcad-forge-forgekernel-adr/`): 0018 (three-backend oracle chain), 0019 (certified-interval charter), 0020 (dropping OCCT and its cost), 0023 (**the null-set measurement, must read**), 0024 (sampled tier), 0003 (identity = lineage + rounded fingerprint).

## Verdict: learn-from

Adopt the *discipline*: reference/port bit-identity oracle, named refusals, provenance tiers, property identities, parameter-sweep coverage. Adopt the small exact-sign algorithms for ℚ[√d] and π-polynomials.

Do not adopt the architecture:
- it is a zoo of closed-form special cases with an unbounded-rational csg.js core;
- by its own ADR-0023 its exact curved Booleans cover only null sets of parameters;
- it has no general plane×cylinder Boolean;
- it is a 9-day, 1-star, single-author, agent-built project with self-verified claims.
