# Onshape FeatureScript std: rotationAround, circularPattern and angle values (plus corpus usage)

- Kind: vendor standard library source (local mirror) plus a usage survey of Marc's corpus. Mirror: `<repo>/tmp/lang/onshape-std` (commit `a2a7b13e`, 2026-05-15; the same mirror other wonky notes cite, e.g. [onshape-featurescript-std-library-mirror note](onshape-featurescript-std-library-mirror-opfillet-opchamfer-.md)). Files read: `math.fs` l.28-45, `units.fs` l.235-239 and l.805-830, `curveGeometry.fs` l.105-117, `vector.fs` l.360-400, `circularPattern.fs` l.30-245. Upstream: [github.com/javawizard/onshape-std-library-mirror](https://github.com/javawizard/onshape-std-library-mirror) (mirror of Onshape's std; not re-queried here).
- Author: PTC Inc. (Onshape). License: **MIT** ("The MIT License (MIT) for the FeatureScript Standard Library (std). Copyright (c) 2013-Present PTC Inc.", `LICENSE.txt`).
- Corpus survey: `~/Workspace/cad` (Marc's FeatureScript, read only), 606 `.fs` files, grep counts made 2026-09-24 (development evidence kept locally).

## What it is

The FeatureScript definitions whose numbers reach wonky's frontend when user code rotates, patterns or builds frames: the `degree` constant, `sin/cos`, `rotationAround`, `rotationMatrix3d`, `circularPattern`'s instance transforms and Onshape's tolerance constants.

## How it works (DOCUMENTED, std source)

- **Angles are radians in binary64.** `units.fs:235-239`: `radian = { value: 1, unit: ANGLE_UNITS }`, `degree = 0.0174532925199432957692 * radian`. So `90 * degree` is the double nearest to `90 × fl(π/180)`, not π/2 exactly (in JS it equals `Math.PI/2`; measured below).
- **Trig is approximate by documentation:** `units.fs:807` "`sin(30 * degree)` returns approximately `0.5`"; `:808` "`sin(PI * radian)` returns approximately `0`"; `:821` "`cos(60 * degree)` returns approximately `0.5`". `sin`/`cos` are the builtins `@sin(value.value)`, `@cos(value.value)`.
- **Rotations:** `rotationAround(line, angle) = transform(R, origin − R·origin)` with `R = rotationMatrix3d(line.direction, angle)` = builtin `@matrixRotation3d(axis, angle.value)` (`vector.fs:396-400`). `rotationMatrix3d(from, to)` uses `atan2(norm(cross), dot)` and falls back to `identityMatrix(3)` or a 180° turn about `perpendicularVector(from)` when `squaredNorm(cross) < zeroLength²` (`vector.fs:369-390`).
- **Circular pattern:** `circularPattern.fs:143` decides a full circle by `abs(abs(angle) − 2π) < TOLERANCE.zeroAngle`, then `angle / instanceCount` (full) or `/ (instanceCount − 1)`. Instance k gets `rotationAround(axis, i * angle)` (legacy path, l.232-238): **multiplied, not accumulated**. Since V2338 the list comes from the opaque builtin `@computeCircularPatternTransforms` (l.214-225).
- **Tolerances** (`math.fs:35-41`): `zeroAngle 1e-11`, `zeroLength 1e-8` (metres), `g1Angle 0.1°`, `booleanDefaultTolerance 1e-5` (m), `computational 1e-13`. These equal Parasolid's session precisions (see the [Parasolid V35 overview note](overview-of-parasolid-v35-july-2022.md)).

## Robustness and guarantees

- DOCUMENTED: Onshape treats special angles as approximate at the FS level; exactness (if any) is inside Parasolid, which resolves near-coincidences with its 1e-8 m / 1e-11 rad resolution. FS code is written against that tolerance, so a user's `rotationAround(z, 90 * degree)` relies on the kernel to call the rotated face coplanar with an axis plane.
- MEASURED in wonky's frontend (`tmp/research/frames-trig/f64-special-angles.mjs`; wonky's `src/library.mjs:284-290` reproduces the FS formula in JS):
  - `rotationAround(z, 90°)` rows `[[6.123e-17, −1, 0], [1, 6.123e-17, 0], [0, 0, 1]]`: the image of +x is `(6.1e-17, 1, 0)`, not an axis;
  - `sin(30°) = 0.49999999999999994`, `cos(60°) = 0.5000000000000001`, `sin(180°) = 1.22e-16`, `sin(360°) = −2.45e-16`;
  - the typed degree count is recoverable: `round(θ / π · 180)` returns the integer degree for every integer in ±720 (max deviation 1.1e-13°), and `round(θ/π·18000)` for every hundredth of a degree in ±360 (max 7.3e-12 hundredths).
  - `k·(360/N)·degree` vs `k·2π/N`: at most 8.9e-16 rad apart for N ≤ 36; step accumulation reaches 4.4e-15 at N = 36 (Onshape multiplies, so accumulation does not occur in std, but user loops can accumulate).

## Parallelism and performance

Not applicable (value semantics).

## Known failures, limitations, war stories

- wonky corpus (DOCUMENTED, `docs/sketch-arcs.md:51`): a 180° sector's `sin(180°)` left `y = 1.66e-14 mm` on one radial edge (R20 datums D03), which made two exactly collinear radial edges near-collinear and refused them until a drift-aware rule landed. 1.66e-14 / 1.22e-16 = 135.5 mm radius.
- wonky corpus: rotations are one of the carriers of "Plane frame is not orthonormal" and of the `2^-44` carrier-unification tolerance (robust-numerics.md §3.5 and §4.2).

## Corpus usage survey (DOCUMENTED counts, INFERRED interpretation)

| item | count |
|---|---:|
| `.fs` files | 606 |
| lines with `rotationAround(` / files | 141 / 114 |
| of those lines using `degree` | 130 |
| rotation axis `vector(0,0,1)` / `(1,0,0)` / `(0,1,0)` / `(0,-1,0)` (from 139 parsed calls) | 112 / 18 / 5 / 4 |
| lines whose axis vector has only components in {−1, 0, 1} | 140 of 141 |
| literal angles `180*degree` / `90*degree` / `-90*degree` | 15 / 6 / 3 |
| other literal angles | `25.75` ×5, `5` ×2, `-30` ×2, `-25` ×2, `-23.6293777307` ×2 |
| angle through a variable (`a*degree`, `deg*degree`, `angle`, `th`) | about 85 |
| `opPattern` / `coordSystem(` / `mirrorAcross` occurrences | 332 / 318 / 21 |

INFERRED: essentially every rotation in Marc's code is about a signed coordinate axis, and among literal angles two thirds are multiples of 90°. Exact signed-permutation handling of `k·90°` about coordinate axes plus exact-degree carrying for the rest covers the corpus shape; arbitrary-axis rotations are rare.

## Relevance for wonky

- **Frontend policy anchor:** the interpreter can know the typed degree count exactly (decimal literal times `degree`) before it becomes radians. Keeping `{degrees: rational}` next to the radian value, and passing it to the kernel, gives exact special angles without any tolerance. Snapping radians back to degrees needs a tolerance (1e-13° suffices for ±720°, measured), which is a declared regularization, not an identity.
- **Pattern semantics:** std computes instance k from `i * angle` directly, so instance transforms are independent group elements `k/N` of a turn when `equalSpace` and full circle hold; wonky can represent them symbolically as (axis, k, N) instead of matrices, and recover exact `R^N = I`.
- **Tolerance calibration:** Onshape's `zeroAngle = 1e-11` rad is the angle scale at which FS code expects the kernel to identify directions; wonky's `angular_guard = 1e-12` and the 1e-8 frame regularization should be stated relative to it.
- Bend fit: none needed (frontend); the payoff is that Bend receives exact small integers (degrees, k, N, signed-axis codes) instead of rounded matrices.

## Pointers worth porting or studying

- `units.fs:239` degree constant; `units.fs:805-830` approximate-trig documentation; `curveGeometry.fs:110-117`; `vector.fs:369-400`; `circularPattern.fs:138-146, 210-243`; `math.fs:35-41`.

## Verdict: adopt

Adopt the std semantics as the contract (angles are approximate radians in FS), and add exactness on wonky's side by carrying typed degrees and pattern indices symbolically; the corpus shows this covers nearly all real rotations.
