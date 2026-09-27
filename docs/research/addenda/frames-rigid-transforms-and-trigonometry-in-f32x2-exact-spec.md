# Frames, rigid transforms and trigonometry in F32x2: exact special angles, rational rotations, symbolic placements

Addendum to the wonky research knowledge base, 2026-09-24. English. Gap filler.

**Why this gap.** Rotations and frames are a recurring failure family, and the research so far treated them only as a source of tolerance. MEASURED in the corpus docs: `opTransform` in 304 FS files (1190 lines), `opPattern` in 263; "Plane frame is not orthonormal" blocks 5-9 units (`docs/corpus/cluster-boolean-capability.md` l.514, `run.md` l.285); a far tilted extrusion's cap normal was 1e-5 rad off (`cluster-kernel-sketch-and-ops.md` §2.1); `sin(180°)` left `y = 1.66e-14 mm` on a sector edge (`docs/sketch-arcs.md` l.51, D03); rigid copies "stay F32" and mirrors are refused (`cluster-fs-missing-builtin.md`); the corefine carrier unification uses `2^-44·scale`, derived from "one rigid transform rounded to F32x2", after a larger tolerance opened sealed pockets ([robust-numerics.md](../robust-numerics.md) §3.5, §4.2). Nobody had asked how to represent placements so that coplanarity, coaxiality and orthonormality survive **by construction**.

**Method.** Primary sources (papers read in full, library code read, standards text), wonky's own code (`src/library.mjs`, `src/real.mjs`, `src/kernel.mjs`, `kernel/real.bend`, `kernel/revolve.bend`), a usage survey of Marc's corpus (`~/Workspace/cad`, 606 `.fs` files, read only), and four small JS measurement scripts in `tmp/research/frames-trig/` (`f64-special-angles.mjs`, `emulate-real-bend.mjs`, `rational-rotation-bits.mjs`, `prototype-sincos-turns.mjs`; F32 emulated with `Math.fround` after every operation, no FMA; no builds, no project tests). Worklog: local development evidence.

**Labels.** DOCUMENTED = primary source or measured artifact; INFERRED = my reasoning from evidence; HEARSAY = secondhand.

**Source notes written for this addendum** (all in `docs/research/sources/`):
`canny-donald-ressler-1992-rational-rotation-method.md`, `milenkovic-milenkovic-1997-rational-orthogonal-approximations.md`, `cgal-rational-rotation-approximation.md`, `bahrdt-seybold-2017-rational-points-on-the-unit-sphere.md`, `ieee-754-2019-and-c23-sinpi-cospi-half-revolution-trig.md`, `core-math-correctly-rounded-binary32-sinpif-cospif.md`, `qd-library-hida-li-bailey-dd-real-sin-cos.md`, `campary-joldes-muller-popescu-tucker-multiple-precision-gpu.md`, `metal-shading-language-math-accuracy-and-fp-modes.md`, `onshape-std-rotationaround-circularpattern-and-angle-values.md`, `occt-gp-trsf-forms-mirror-sign-and-toploc-powers.md`, `cgal-sqrt-extension-exact-quadratic-fields.md`.
Existing notes this builds on: Spatter (Pythagorean-triple rotations as test oracle), Hoffmann 1989 (tan(θ/2) rationals), CGAL Nef (rational rotation cost), Thall df64 (float-float sin/cos errors), Joldes-Muller-Popescu 2017 and Yang 2024 (double-word bounds), OCCT Modeling Data (location chains), Parasolid V35 overview (1e-8 / 1e-11 precision).

## 0. Findings in one page

1. **Floats can never hold a tilted unit vector exactly.** Bahrdt-Seybold (2017, Theorem 3): the only binary floating-point points on S¹ are the 4 poles and on S² the 6 poles, for any precision. So every non-axis frame in F32 or F32x2 is orthonormal only within a tolerance; "orthonormal by construction" is possible only for **signed axis permutations**, for **rational (non-dyadic) entries**, or for **symbolic placements**. DOCUMENTED.
2. **wonky's frontend destroys exact axis alignment at 90° and 180°.** `rotationAround(z, 90°)` produces rows `[[6.12e-17, −1, 0], [1, 6.12e-17, 0], [0, 0, 1]]`; `sin(180°) = 1.22e-16`; `sin(30°) = 0.49999999999999994`. The F32x2 split keeps these residues, so an axis-aligned face rotated by 90° is no longer axis-aligned, and every mechanism keyed on exact axes (`isIdentityRotation`, cap snap `coordinateAxis`, corefine's "never unify exactly axis-aligned carriers") stops applying. This is the robust-numerics §4.2 war story mechanism ("rotating analytically coplanar faces with an F32x2 transform moved them about 1e-14 mm apart"). DOCUMENTED measurement.
3. **Marc's rotations are almost all special.** Of 141 `rotationAround` lines (114 files), 130 use `degree`; every parsed axis is a signed coordinate axis (112 z, 18 x, 5 y, 4 −y); literal angles are `180°` ×15, `90°` ×6, `−90°` ×3 of 39 literal integer-degree angles. Of 21 `mirrorAcross`, 14 mirror across coordinate planes and 7 across a plane with the typed normal `(0.5, 0, 0.86602540378443864676)` (√3/2). DOCUMENTED counts.
4. **The typed degree survives in f64.** `round(θ/π·180)` returns the typed integer degree for every integer in ±720 (max deviation 1.1e-13°), and hundredths of a degree in ±360 are recovered too (7.3e-12 hundredths). Better still, the interpreter sees `90 * degree` before it becomes radians. DOCUMENTED measurement.
5. **Half-revolution trigonometry gives exact special values by construction.** IEEE 754-2008/2019 sinPi/cosPi and C23 `sinpi/cospi` reduce exactly ("subtracting an integer multiple of 2", Hough) and specify exact zeros (`sinpi(n) = ±0`, `cospi(n + 1/2) = +0`). CORE-MATH's correctly rounded binary32 `sinpif` does the reduction as U32 bit arithmetic on the significand; Julia's `sind/cosd` fold degrees exactly and convert the remainder to radians in double-word. DOCUMENTED.
6. **wonky's F32x2 trig is 2^-43.8 today and inexact at special angles.** Emulated `kernel/real.bend`: `cos(90°) = −4.4e-16`, `sin(180°) = 1.42e-14`, max absolute error 6.4e-14 over `|x| ≤ 4π`. A prototype turn-based F32x2 kernel (1/64-turn table, accurate double-word addition, 5+6-term series) returns exact 0/±1 at quarter turns and 9.7e-15 (2^-46.6) max error. It is used for revolve end frames (`kernel/revolve.bend:607`), tessellation, pcurves. DOCUMENTED measurement.
7. **Exact rational rotations fit U32 limbs.** Canny-Donald-Ressler (2D, `tan(θ/2) = p/q`) at ε = 2^-40 need about 41-bit denominators (measured mean 40.8, max 53); Milenkovic's integer quaternions (3D, naive M2) at ε = 2^-40 need ≤ 41-bit components and ≤ 83-bit common denominators, exactly orthogonal (checked in BigInt); the optimum is ≤ 1.5b bits. But rational rotations do not close patterns: in SO(2, Q) only orders 1, 2, 4 exist (INFERRED from Niven's theorem), and rotated dyadic vertices become non-dyadic rationals. DOCUMENTED + INFERRED.
8. **Circular patterns want group elements, not matrices.** Onshape std builds instance k as `rotationAround(axis, i * angle)` (multiplied, not accumulated) and decides a full circle with `zeroAngle = 1e-11`; OCCT locations are datum-power chains with free-group cancellation but no `D^N = I`. A pattern placement `(axis, k, N)` with the cyclic relation is exact, cheap, and lets most instance-to-instance decisions be symbolic; exact coordinates for N divides 24 live in `Q(√2, √3)`. DOCUMENTED + INFERRED.
9. **Mirrors become easy as a parity bit.** OCCT stores a plane mirror as `scale = −1` times the half-turn `2nnᵀ − I`; that half-turn is exactly rational for any dyadic normal, and for coordinate normals it is a signed permutation. wonky refuses reflections today. DOCUMENTED + INFERRED.
10. **Never use Metal's trig for geometry, and pin contraction off.** MSL 4.1: fast math is the default; fast `sin/cos/sinpi/cospi` promise only 2^-13 absolute error, `tanpi` is `tan(x·pi)`; precise variants are ≤ 4-6 ulp of F32. `MTLMathModeSafe` still sets FP contraction to "on" within a statement; RTZ rounding and FTZ are permitted. DOCUMENTED.

## 1. Landscape

### 1.1 Six ways to represent a placement

| family | representative sources | exact what? | cost | fits Bend? |
|---|---|---|---|---|
| binary64 matrix from radians, tolerance downstream | Onshape std, OCCT `gp_Trsf`, Parasolid (1e-8 m, 1e-11 rad) | nothing; relies on kernel resolution | 12 doubles | as F32x2 words: yes, but only as good as its tolerance |
| typed transform (form tag + scale sign) | OCCT `gp_TrsfForm`, `gp_Trsf::SetMirror` | the *kind* (identity, translation, rotation, mirror parity) | a tag | yes (U32 tag) |
| symbolic chains of shared datums with integer powers | OCCT `TopLoc_Location` | equality of identically built placements | list of (datum, power) | yes (U32 ids and powers) |
| exact rational rotation | Canny-Donald-Ressler 1992, Milenkovic 1997, CGAL `rational_rotation_approximation`, Spatter's generator | orthogonality (exact), angle within ε | 2-4 integers of ~b bits; vertices become rationals | yes (fixed multi-limb U32) |
| exact rational unit vectors | Bahrdt-Seybold 2017 (libratss) | unit length | denominators ≤ 10(d−1)/ε² | yes (fixed-point variant) |
| algebraic numbers for special angles | CGAL `Sqrt_extension`, Niven's theorem | cos/sin of k·360°/N for N divides 24 | tuples of multi-limb integers; sign by squaring | yes (bounded circuits) |

### 1.2 Trigonometry

| source | argument unit | reduction | exact special values | accuracy | precision model | Bend-reachable |
|---|---|---|---|---|---|---|
| IEEE 754 §9.2 sinPi/cosPi, C23 `sinpi/cospi` | half-turns | exact (integer multiple of 2) | yes, specified (F.10.1.12-13) | correctly rounded if claimed 754-conformant | any format | the semantics, yes |
| CORE-MATH `cr_sinpif` | half-turns | U32 bit ops on the significand | ±0 at integers | correctly rounded binary32, exhaustively checked | binary64 internally | reduction yes; binary64 evaluation no |
| Julia `sinpi`, `sind/cosd` | half-turns / degrees | exact fold, remainder to radians in double-word | 0/±1 at multiples of 90° | not stated | binary64 + double-word | design yes |
| QD `dd_real::sin/cos` | radians | 2π, π/2, π/16 (naive remainder) | no | no proof ("do not have a full correctness proof") | double-double | structure yes |
| Thall df64 (float-float GPU) | radians | as QD | no | measured sin 7.8 / cos 241 ulps of 48 bits max | F32 pairs | yes, but its cos is poor |
| wonky `kernel/real.bend` today | radians | 2π only, 18-term series on `|r| ≤ π` | no (cos 90° = −4.4e-16) | 2^-43.8 absolute (measured) | F32x2 | it is Bend |
| Metal `precise::sin` / `fast::sin` | radians / half-turns | hardware | not specified | ≤ 4 ulp F32 / 2^-13 absolute | F32 | callable, unsuitable |

CAMPARY (GPL, F32 and F64 expansions on GPU) has certified `+ − × ÷ √` but no trigonometry.

## 2. wonky today (DOCUMENTED by reading code and measuring)

- **Frontend.** `src/scalars.mjs:28` `degree = Math.PI/180`; `src/library.mjs:284-290` `rotationAround` builds the Rodrigues matrix from `Math.cos/Math.sin(theta.value)`; `mirrorAcross` builds `I − 2nnᵀ` with a normalized n and is a value only. `src/real.mjs` splits every f64 into F32x2 once (`hi = fround(v)`, `lo = fround(v − hi)`; 48 bits kept, up to half an f64 ulp lost on decode).
- **Kernel transform.** `src/kernel.mjs` `transformInBend`: an **exactly identity** rotation with an extrusion's binary64 inputs re-extrudes the translated prism (the W2 rule that fixed flush pockets); every other rotation goes to `polygonPrism.transform`, which requires the rotation columns orthonormal within `10 × angular_guard = 1e-11` and a positive determinant, and audits vertex-to-carrier incidence against `1e-12·scale`.
- **Frames.** Sketch frames from FS (`normal`, `x`) are regularized when `1e-12 < |n̂·x̂| ≤ 1e-8` (projection of x, `exactness: 'regularized'`, w2.md §1.2); Marc's hopper generator produced defects 8.43e-11 and 2.04e-9. The old F32 cap normal from an absolute area vector (1e-5 rad off at 560 mm) is replaced by the sketch frame in the F32x2 polygon prism.
- **Kernel trig.** `kernel/real.bend` `sin/cos` (see finding 6); callers: `revolve.bend:607` (end frame of a partial revolve), `tessellate.bend`, `analytic.bend`, `ray.bend` (cone `tan = sin/cos`), `step-cylinder-pcurves-geometry.bend`, `prism-boolean.bend`, `display.bend`.
- **Double-word addition is sloppy** (robust-numerics.md "wonky's R.Real", proposal P8): rotated-carrier offsets `n·o` and `R·p + t` are cancellation-prone uses.
- **Tolerances in play for placements:** `angular_guard = 1e-12`, frame regularization 1e-8 rad, `2^-44·scale` carrier unification, cap snap within `1e-12·scale`. Onshape's own `zeroAngle` is 1e-11 rad and `zeroLength` 1e-8 m.

## 3. State of the art by topic

### 3.1 What exactness is even possible (the axioms)

- **Dyadic unit vectors are only poles** (Bahrdt-Seybold Theorem 3). So:
  - signed permutation matrices (the 48-element cube group, including reflections) are the only exactly orthonormal F32x2 frames;
  - any other exact frame needs rational entries with non-power-of-two denominators (Pythagorean triples/quadruples), or symbolic representation;
  - exact decisions should use **unnormalized** carriers (`a·x = d` with dyadic or integer a), which is how exact predicates want them anyway (INFERRED).
- **Rational sines at rational degrees** are only 0, ±1/2, ±1 (Niven, via Bahrdt-Seybold §1). 30° has a rational sine, 45° and 60° do not (as a pair with cosine only 0°, 90°, 180°, 270° are rational).
- **Finite-order rational rotations** (INFERRED from the above): in 2D only orders 1, 2, 4; in 3D additionally orders 3 and 6 about special axes like (1,1,1) (cyclic coordinate permutation). A 90° rotation about axis a is rational iff a/|a| is rational; a 180° rotation `2aaᵀ/|a|² − I` is rational for every integer axis a.

### 3.2 Rational rotations (topic 1)

- Canny-Donald-Ressler: every rational sine is `2pq/(p²+q²)`; search the smallest rational t in the ε-interval of `tan(θ/2)` with a continued-fraction walk that stops inside Farey runs; result within one bit of the shortest; pure rotation (no scaling) keeps distances comparable across rotated and unrotated objects. Measured here: ε = 2^-40 → ~41-bit denominators, i.e. two U32 limbs.
- Milenkovic: integer quaternion `Q` gives the exactly orthogonal rational matrix (Eq. 4) with common denominator `|Q|²`; every rational rotation arises this way (Lemma 2.3); naive rounding M2 gives 2b+2 bits, optimum ≤ 1.5b; robust extraction of Q from a float matrix by the max-diagonal row (error ≤ 1.5μ).
- CGAL implements the 2D method with an O(q) Stern-Brocot loop (450 s at 10^-6° per the Nef note) and hit stack overflows in lazy-exact DAGs ([#6110](https://github.com/CGAL/cgal/issues/6110)); a user measured the stereographic method at ~160 ns vs ~10 ms ([#6459](https://github.com/CGAL/cgal/issues/6459)).
- **Limits for wonky** (INFERRED): (a) the images of F32x2 vertices under a rational rotation have denominators `|Q|²·2^k`, so storing them as F32x2 rounds again; the win exists only where carriers and placements stay symbolic and decisions are exact integer tests; (b) composition multiplies denominators (limb growth along transform chains); (c) no pattern closure for N ∉ {1, 2, 4}.

### 3.3 Degree- and π-reduced trigonometry (topic 2)

- Exact reduction is the whole point: in turns or degrees the reduction is integer arithmetic, so multiples of 90° give exactly 0 and ±1 (C23 F.10.1.12-13 specify the zeros). CORE-MATH shows the bit-level recipe (U32 shifts of the significand, 128-entry table of `sin(iπ/64)`); Julia's `sind` shows the degree recipe (exact fold at 90/180/270, exact zero at 180, remainder converted with a double-word π/180).
- Limit: exactness is for the represented argument. 30° as "1/12 turn" is not dyadic; a degree representation (integer 30) keeps it exact and lets the kernel return exactly 1/2 for sin 30°, cos 60°; √3/2 remains rounded (F32x2, stated error).

### 3.4 Double-word sin/cos (topic 3)

- QD: reduction by 2π, π/2, π/16 plus tables and a short Taylor series; no proof; naive remainder for large arguments. Thall's float-float port measured cos errors up to 241 ulps of 48 bits (sqrt(1 − sin²) path and table recombination). CAMPARY: none.
- wonky today (finding 6): 2^-43.8 because the series runs on `|r| ≤ π` with terms up to ~5 and one π constant; that is 16× above the F32x2 word precision.
- Prototype (`prototype-sincos-turns.mjs`): argument in turns (F32x2), `n = round(64t)`, `r = t − n/64` (exact), `x = 2π·r` (F32x2), sin/cos series with 5 and 6 terms on `|x| ≤ π/64`, table `sin/cos(2πk/64)` as F32x2 with exact entries at k = 0, 16, 32, 48, recombination by addition formulas with accurate double-word addition. Measured: exact 0/±1 at quarter turns, max absolute error 9.7e-15 (2^-46.6) over 50,000 random turns in [−2, 2]. A proved bound needs the JMP 2017 operation bounds (INFERRED target: ≤ 2^-46 absolute).

### 3.5 Circular patterns as exact group elements (topic 4)

- Onshape std (`circularPattern.fs:143, 232-238`): full-circle test `| |angle| − 2π | < zeroAngle`, step `angle/instanceCount`, instance `rotationAround(axis, i * angle)`; the current builtin `@computeCircularPatternTransforms` is opaque.
- OCCT: `TopLoc_Location` chains merge adjacent equal datums by adding powers, invert by negating powers; equality is symbolic. There is no relation `D^N = I`, so a full pattern's N-th power is not recognized as the identity (INFERRED from `TopLoc_Location.cxx:88-218`).
- A placement `P = T_axis ∘ Rot(k/N turns) ∘ T_axis⁻¹` stored as `(axisId, k mod N, N)` has exact group laws: `P_i⁻¹ P_j = Rot((j − i)/N)`, `P_N = I`. Symbolic consequences available without coordinates (INFERRED): instances are coaxial with the axis; a carrier that contains the axis (plane through it, coaxial cylinder) maps to a carrier of the same pencil; two instances coincide iff `k ≡ k'`; a plane through the axis at angle φ meets its image at angle φ + 2πk/N only along the axis (unless `2k/N` is an integer: coplanar).
- When coordinates are needed exactly: N divides 24 in `Q(√2, √3)` (CGAL `Sqrt_extension` pattern: sign by repeated squaring, no mixed fields); N = 5, 10 need a degree-4 tower; other N stay rounded with a stated bound.

### 3.6 Near-special frontend values (topic 5)

- FS gives the interpreter three kinds of angle values: (a) typed literals times `degree` (130 of 141 corpus rotations); (b) computed radians (`atan2`, `acos`); (c) pasted decimals that are near-special (`25.75°` is exact decimal, `−23.6293777307°` is a pasted computed value, `0.86602540378443864676` is √3/2 to 20 digits).
- Recoverability: case (a) is exact if the interpreter keeps the degree count; from radians, rounding `θ/π·180` to integers (±720) or hundredths (±360) recovers every tested value with deviation ≤ 1.1e-13° (measured). Onshape itself compares angles with `zeroAngle = 1e-11` rad (≈ 5.7e-10°), so a snap at, say, 1e-12 rad is a hundredfold stricter than Onshape's own identification.
- Policies found in sources: Onshape/Parasolid identify within resolution silently; CGAL's angle overload trusts `std::sin` of the double; wonky already regularizes frames with a recorded `exactness: 'regularized'` and refuses above 1e-8 rad. The research rule "approximations need explicit tolerances; unsupported cases fail explicitly" implies a ladder, not a silent snap (§4, P6).

### 3.7 GPU trig guarantees (topic 6)

- Metal (MSL 4.1 §8.4): precise `sin, cos, sinpi, cospi ≤ 4 ulp`, `tan, tanpi ≤ 6 ulp`; fast (default) `sin/cos/sinpi/cospi` absolute error ≤ 2^-13 on the primary interval, `tanpi = tan(x·pi)`, `x/y ≤ 2.5 ulp`, `sqrt = x·rsqrt(x)`; `+ − ×` correctly rounded in both modes. §1.6.3: math modes fast/relaxed/safe, safe sets contraction "on" (within a statement), `-ffp-contract=off` separate; §8.1-8.2: FTZ and RTZ permitted.
- wonky's docs say Bend 2.0.25's Metal runtime uses `MTLMathModeSafe` (`docs/proto-exact-plane.md:255`), and `docs/native-bridge.md:304` says Metal builds with `--fmad=false`, which is an NVCC flag not present in the MSL spec (INFERRED: likely a CUDA/Metal conflation).

## 4. Ranked proposals for wonky

Ranking: benefit on measured corpus failures per unit of effort, and whether it removes a tolerance or only tightens one. Effort S/M/L as in the other chapters.

### P1. Typed placements with exact signed-axis rotations and mirrors (S; do first)

- **Idea.** A placement IR with a form tag (OCCT-style): `identity`, `translation`, `signedPermutation` (the 48 cube symmetries, parity bit included), `axisRotation{axis ∈ ±x,±y,±z, degrees: exact rational}`, `pattern{axisId, k, N}`, `general{matrix words}`. In the interpreter, `rotationAround` with a signed coordinate axis and an angle whose degree count is a multiple of 90 produces a `signedPermutation` with **exact** 0/±1 entries; `mirrorAcross` across a coordinate plane produces a `signedPermutation` with parity −1. The kernel applies a signed permutation by permuting and negating words (no rounding); translation parts stay binary64 sums as in W2.
- **Extend the W2 rule:** like `translatedPrismInputs`, a signed permutation of an extrusion with binary64 inputs re-extrudes with permuted inputs (origin, normal, x, far), so the copy's words equal "the same prism built in place".
- **Where.** `src/library.mjs` (`rotationAround`, `mirrorAcross`), `src/kernel.mjs` (`transformInBend`, `isIdentityRotation` generalizes to `isSignedPermutation`), a Bend `permute` for polygon bodies (trivially exact), orientation reversal for parity −1 (face sense and loop order).
- **Bend fit.** Perfect: U32 codes, word moves and sign flips, fork-join over vertices; no arithmetic.
- **Benefit.** 24 of 39 literal-angle rotations in the corpus and 14 of 21 mirrors become exact; rotated axis-aligned carriers stay exactly axis-aligned, so cap snap, identity-based coplanarity (mesh-booleans Q3) and the "never unify exactly axis-aligned carriers" rule keep working; unblocks the mirror refusal for coordinate planes.
- **Risk.** Low. Parity handling must be tested on every body kind (prism, analytic, recovered).
- **First acceptance test.** A box with a flush pocket, rotated by 90° about z (and mirrored across x = 0) as a whole and as separate operands, Booleaned: result identical in words to the unrotated case transformed exactly; no `AmbiguousContact`. Plus Spatter-style metamorphic tests over the 48-element group (testing-validation.md already lists them).

### P2. Carry exact degrees from FeatureScript to the kernel (S)

- **Idea.** `Quantity` for angles gets an optional exact rational `degrees` field when built from a numeric literal times `degree` (decimal literals are exact rationals); `+ − ×int ÷int` preserve it; anything else drops it. `rotationAround`, `opRevolve`, `circularPattern`, sketch arcs pass `{degrees}` when present, else radians. Kernel entry points accept an angle as `Degrees{num: U32 limbs, den: U32}` or `Radians{Real}`.
- **Where.** `src/scalars.mjs`, `src/values.mjs`, `src/library.mjs`, kernel wire format.
- **Bend fit.** Small fixed integers; exact reduction mod 360 is integer arithmetic.
- **Benefit.** Every typed angle gets exact special values downstream (P3), including 30°/150° sines of exactly 1/2 and the 180° sector of D03 (`y = 0` exactly). Removes the need to snap in most cases.
- **Risk.** Semantics: FS equality/`tolerantEquals` on angles must keep comparing radians; the field is advisory, never user-visible.
- **First acceptance test.** `sketch-arcs` D03 sector: radial edge y exactly 0; `rotationAround(z, 180 * degree)` produces a signed permutation.

### P3. Rewrite `kernel/real.bend` trigonometry around exact turn/degree reduction (M)

- **Idea.** `sincos_degrees(Degrees)` and `sincos_turns(Real)`: exact integer reduction (quadrant, 1/64-turn or 15°-step table), exact outputs where the value is rational (0, ±1/2, ±1), F32x2 table plus a fixed short series elsewhere (QD structure, CORE-MATH reduction), accurate double-word addition (robust-numerics P8) inside. Keep radian `sin/cos` only for radian-typed inputs, implemented as `sincos_turns(x / 2π)` with the conversion error stated.
- **Where.** `kernel/real.bend`; callers `revolve.bend:607` (end frames), tessellation, pcurves, analytic cones.
- **Bend fit.** Fixed tables (64 F32x2 pairs), fixed series length, `Bool.pick` quadrant selection: uniform GPU work.
- **Benefit.** Exact end planes of 90°/180° revolves; error from 2^-43.8 to about 2^-46.6 (prototype) for the rest; frames built from kernel sin/cos satisfy `|c² + s² − 1| ≲ 2^-45` instead of 2^-43.7.
- **Risk.** Output bits change (golden re-baseline); the error bound must be proved, not only measured.
- **First acceptance test.** Exhaustive over all 360·100 hundredth-degree inputs: exact values at multiples of 30°/90° as specified; max error ≤ stated bound against a BigInt/MPFR-free oracle (Taylor in exact rationals on the host).

### P4. Circular patterns as cyclic group elements (M-L)

- **Idea.** `opPattern` whose transforms the interpreter recognizes as `rotationAround(axis, i·step)` with `step·N = 360°` (exact via P2) becomes `pattern{axisId, k, N}` placements. Placement equality and composition use the cyclic relation (`k mod N`), extending OCCT's datum-power chains with `D^N = I`. The Boolean pre-pass decides instance-to-instance facts symbolically (same pencil, same axis, `2k/N ∈ Z` coplanarity); exact coordinates for N divides 24 through a `Q(√2, √3)` evaluator (CGAL `Sqrt_extension` model, sign by squaring on multi-limb U32); otherwise rounded matrices with a recorded bound.
- **Where.** Interpreter pattern recognition, placement store, planar arrangement / corefine carrier classes (identity instead of `2^-44` unification for pattern-related carriers), naming (instance k of feature f is a stable identity).
- **Bend fit.** Symbolic part is U32; the algebraic evaluator is fixed-size integer circuits.
- **Benefit.** Bolt circles, vents and gear teeth: no near-coplanar or near-coaxial ambiguity between instances; the last instance closes exactly; naming and diffs can talk about "instance k of N".
- **Risk.** Recognition must be conservative (only exact provenance); patterns with accumulated user loops (`a += step`) need P2's exact arithmetic to qualify.
- **First acceptance test.** A 6-hole and a 24-slot pattern on a disk: all hole carriers classified coaxial with their instances' axes by identity; volume matches closed form; no unified-carrier record.

### P5. Frame canonicalization and unnormalized exact carriers (S)

- **Idea.** Make the existing practice a contract: plane frames enter as (dyadic normal, dyadic x) and are canonicalized once (`x' = x − (n̂·x)n̂`, `y = n̂ × x'`) with a stated defect; exact predicates use unnormalized normals (never "unit" words, which by §3.1 cannot be exact); normalization is a view for distances and display. State `angular_guard` (1e-12) and the 1e-8 regularization relative to Onshape's `zeroAngle` (1e-11) in one table.
- **Where.** `src/kernel.mjs` `prismInputs`, polygon-prism docs, robust-numerics numeric model.
- **Bend fit.** Existing code; documentation plus a few asserts.
- **Benefit.** Removes the ambiguity behind "Plane frame is not orthonormal" as a class: a frame is either canonicalized with a recorded defect or refused by one rule.
- **First acceptance test.** The three hopper frames (8.43e-11, 2.04e-9) and the far-foot octagon produce identical canonical frames on JS and native; the recorded defect equals the measured one.

### P6. A near-special value policy ladder (S)

- **Idea.** For every angle and direction that reaches a placement:
  1. **Exact by provenance** (P2 degrees, signed axes, integer normals): use exactly, no record.
  2. **Snap with a declared tolerance** when the f64 value is within `τ_angle = 1e-12` rad of a multiple of 1/100° (or a normal within `1e-12` of a signed axis, or a decimal within a few f64 ulps of √2/2, √3/2, 1/2): snap, record `{kind: 'angleSnap' | 'axisSnap' | 'algebraicSnap', from, to, deviation, tolerance}` and label the body `exactness: 'regularized'` (same machinery as `frameRegularization` and `capSnap`).
  3. **Keep as rounded** with its measured deviation otherwise; exact downstream decisions that depend on it refuse explicitly (`AmbiguousContact`) rather than guess.
  Never snap silently; never refuse a value merely for being near-special.
- **Where.** Interpreter (`rotationAround`, `plane`, `coordSystem`), `src/exactness.mjs`.
- **Bend fit.** Frontend only.
- **Benefit.** Handles the pasted `0.86602540378443864676` mirror normal and computed-then-pasted angles deterministically and visibly.
- **Risk.** A snap can change geometry by up to τ·r (1e-12·r: 1e-9 mm at 1 m); must be toggled like `CAP_SNAP.enabled` and reported.
- **First acceptance test.** The 7 `WIDTH_AXIS` mirrors: normal snapped to `(1/2, 0, √3/2)` with a record; result equal to the P4/Q(√3) exact path within the recorded deviation.

### P7. Exact rational rotations for general angles, on demand (L; later)

- **Idea.** For rotations that are not special but must stay rigid relative to unrotated geometry in a Boolean (a rotated copy fused with its source), represent the rotation as an integer quaternion (Milenkovic M2 at ε = 2^-44, ≤ 45-bit components) and keep rotated **carriers** symbolic (source carrier id + placement), deciding coplanarity/coaxiality between them exactly with multi-limb integers. Vertices are still rounded to F32x2 once, with the rounding recorded.
- **Where.** Corefine/recover carrier classes (replace `2^-44` unification for carriers related by known placements), exact predicates module.
- **Bend fit.** Fixed-limb integer arithmetic; construction is a Shepperd max-row selection plus rounding.
- **Benefit.** Turns the remaining transform-related tolerance into identity (mesh-booleans Q3) for rotated copies.
- **Risk.** Limb growth under composition; angle changes by up to ε (record it); only pays off once corefine/recover consume carrier identities.
- **First acceptance test.** The robust-numerics war story (tilted prism with a pocket 1e-11 mm under its tilted face, rotated): sealed void stays sealed without any unification tolerance.

### P8. Pin the GPU floating-point contract (S; prerequisite for all F32x2 work on Metal)

- **Idea.** Build Bend's Metal target with `mathMode = safe`, **contraction off** (`-ffp-contract=off` or `#pragma METAL fp contract(off)`), `mathFloatingPointFunctions = precise`, and hash them into the build key; never emit `metal::sin/cos/sinpi` for geometry. Add a device self-test: nonzero TwoProd residual, TwoSum on a tie, subnormal round trip, RTNE check. Correct `docs/native-bridge.md:304` (`--fmad=false` is CUDA).
- **Bend fit.** Build configuration.
- **Benefit.** Keeps every F32x2 bound in this chapter valid on the GPU.
- **First acceptance test.** The self-test passes on each Apple GPU family in CI; a deliberately contracted build fails it.

**Ordering.** P8 and P1 first (S, remove measured failures), then P2+P3 (exact special values end to end), P5 and P6 (policy and documentation), P4 (patterns, needs P2), P7 last (needs identity-consuming Booleans). robust-numerics P8 (accurate double-word addition) should precede P3 and P7.

## 5. Open questions

1. Does Bend's Metal codegen emit contractible expressions (`a*b − c` in one statement)? The MSL spec says safe mode allows contraction within a statement; wonky's cross-target identical counts suggest not, but that is evidence, not a guarantee.
2. What does Onshape's opaque `@computeCircularPatternTransforms` do near full circles and with `skipInstances`? Only its FS fallback (`i * angle`) is readable.
3. Should `degrees` provenance survive user arithmetic like `a * degree` where `a` came from a loop `a = 360 / n * i`? P2 says yes if every step is rational; the interpreter needs exact rationals for plain numbers (not only for quantities) to do that.
4. How much of the `2^-44` carrier unification is due to rotations about coordinate axes by multiples of 90°? P1's first acceptance run can count unified classes before and after (mesh-booleans Q3 asks the same question for identity).

## 6. Source index

| source | kind | status | license | verdict | key point for wonky | note |
|---|---|---|---|---|---|---|
| Canny, Donald, Ressler 1992 | SoCG paper | classic | ACM | adapt | `2pq/(p²+q²)`; smallest rational in the tan(θ/2) interval; ~b-bit denominators | [note](../sources/canny-donald-ressler-1992-rational-rotation-method.md) |
| Milenkovic & Milenkovic 1997 | CGTA paper | classic | Elsevier | adapt | integer quaternions give all rational rotations; M2 2b+2 bits, optimum ≤ 1.5b | [note](../sources/milenkovic-milenkovic-1997-rational-orthogonal-approximations.md) |
| CGAL `rational_rotation_approximation` | library code | dormant since 2021 | LGPL-3+/commercial | learn-from | O(q) mediant walk; exact acceptance by squaring; lazy-DAG stack overflow | [note](../sources/cgal-rational-rotation-approximation.md) |
| Bahrdt & Seybold 2017 | paper + libratss | idle since 2024 | arXiv / LGPL-2.1 | learn-from | Theorem 3: floats hold only axis unit vectors; stereographic snapping | [note](../sources/bahrdt-seybold-2017-rational-points-on-the-unit-sphere.md) |
| IEEE 754-2019 §9.2, C23 sinpi/cospi | standards | current | standards | adopt | exact half-turn reduction; exact zeros specified | [note](../sources/ieee-754-2019-and-c23-sinpi-cospi-half-revolution-trig.md) |
| CORE-MATH sinpif/cospif | library code | active (2026-09-23) | MIT | adapt | U32 bit reduction; exhaustive testing model; binary64 inside | [note](../sources/core-math-correctly-rounded-binary32-sinpif-cospif.md) |
| QD dd_real sin/cos | library + paper | 2.3.24 (2023) | BSD-LBNL | adapt | π/2 + π/16 reduction, tables, short series; no proof | [note](../sources/qd-library-hida-li-bailey-dd-real-sin-cos.md) |
| CAMPARY | GPU library | 2016-2017 | GPL-2+ | learn-from | F32-limb expansions with certified bounds; no trig | [note](../sources/campary-joldes-muller-popescu-tucker-multiple-precision-gpu.md) |
| Metal Shading Language 4.1 | spec | current | Apple | learn-from | fast trig 2^-13 abs; precise ≤ 4 ulp; safe mode keeps contraction on | [note](../sources/metal-shading-language-math-accuracy-and-fp-modes.md) |
| Onshape std + corpus survey | library + measurement | std 2026-05 | MIT | adopt | approximate FS trig; `i*angle` patterns; corpus rotations are axis-aligned | [note](../sources/onshape-std-rotationaround-circularpattern-and-angle-values.md) |
| OCCT gp_Trsf / TopLoc | library code | active | LGPL-2.1+exc. | adapt | form tags; mirror as −1 × half-turn; datum-power chains without `D^N = I` | [note](../sources/occt-gp-trsf-forms-mirror-sign-and-toploc-powers.md) |
| CGAL Sqrt_extension | library docs | active | CGAL | learn-from | exact Q(√r) with sign by squaring; N divides 24 patterns in Q(√2, √3) | [note](../sources/cgal-sqrt-extension-exact-quadratic-fields.md) |
