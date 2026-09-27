# Polygon prism (F32x2)

`kernel/polygon-prism.bend` builds polygon prisms and rigid copies of polyhedral bodies on
normalized F32x2 words (`kernel/precise.bend`, `kernel/real.bend`). It replaces the F32 path of
`kernel/topology.bend` `extrude`/`transform` (W2, [corpus/w2-plan.md](corpus/w2-plan.md),
[corpus/w2.md](corpus/w2.md)). **Status: wired.** `src/kernel.mjs` `extrudeInBend` calls
`profileRing.simplify` and then `extrude` on `prismInputs`; `transformInBend` calls `transform`. The native
slice and the WK evaluator (`kernel/lang/wk/real.bend` op 1 and op 3) call the same entries.
Tests: `test/polygon-prism.test.mjs`, `test/wire-production.test.mjs`. `PROOF.bend` imports it, so
`npm run check:bend` checks it.

## Contract

`extrude(points, origin, normal, x, far) -> Outcome`, all millimetres:

- `points`: the profile in sketch coordinates, `z` word exactly 0, at least 3 vertices,
  counterclockwise along the sweep (the host already orients it, `src/library.mjs` `body`).
- `origin`: the world origin of the near cap, the sketch plane origin moved by the extrude start offset.
- `normal`, `x`: the sketch plane directions. The frame is `n = normalize(normal)`, `u = normalize(x)`,
  `v = cross(n, u)`.
- `far`: the world origin of the far cap, `origin +` the world sweep. The sweep must cross the plane. It
  need **not** be normal to it: oblique sweeps are kept (the r10b `nose` sweeps along
  `(1, sin 25°·k, cos 25°·k)` from a plane with normal `(1, 0, 0)`).

The host computes `origin` and `far` as binary64 sums and splits each once
(`src/kernel.mjs` `prismInputs`, W2 integrate). Two caps that describe the same plane then get the same
words whenever the host's binary64 values agree. Before, the prism added the split summands in F32x2:
an open-top tray (box top `0 + 11.78`, pocket top `1.68 + 10.1`) got caps 2.9e-14 mm apart, and the
planar arrangement refused the contact as ambiguous. Sampled over 2·10⁵ decimal box/pocket pairs, the
F32x2 sum split such caps in 29 % of the cases, the binary64 sum in 0.5 % (F32 rounding hid it in all).
The remaining cases need the far bound itself as the input (for `fCuboid` its `corner2`), see the
follow-ups in [corpus/w2.md](corpus/w2.md).

`prismInputs` also regularizes the sketch x axis: when `|n̂·x̂|` lies in (1e-12, 1e-8], `x` is
projected onto the plane orthogonal to `n` in binary64 before the split. A profile point at distance `r`
from the origin moves by at most `1e-8·r`, 1e-5 mm at 1000 mm (Onshape's own length tolerance). The body
records `construction.frameRegularization = {orthogonalityDefect, toleranceRad: 1e-8}` and states
`exactness: 'regularized'`. Above 1e-8 the prism's `InvalidFrame` refusal stands. (Generated
FeatureScript planes carry such noise: `archive-r16/hopper.fs:121` has `n·x = 8.43e-11`,
`archive-r17/hopper.fs:33` and `r21-expanded-hopper.fs:33` have 2.04e-9.)

Construction, all in F32x2:

1. The sweep in the frame, `s = ((far − origin)·u, (far − origin)·v, (far − origin)·n)`.
2. The prism in the sketch frame: caps on `z = 0` and `z = s.z` with normals `∓sign(s.z)·z`. Side `i` has
   the origin `p_i`, the x axis `normalize(p_{i+1} − p_i)` and the normal
   `normalize(cross(p_{i+1} − p_i, s))`: a parallelogram for an oblique sweep.
3. The rotation `{u, v, n}` maps the profile to world: bottom vertices `rotate(p) + origin`, top vertices
   `rotate(p) + far`, and the face frames the same way. The cap normals are therefore the F32x2 image of
   `±z`, which is `±n` word for word.

The topology is the one of `topology.bend` `extrude`: vertices bottom `0..n−1`, top `n..2n−1`; edges
bottom ring, top ring, verticals; faces bottom, top, then side `i`; the bottom loop is the reversed ring.

`transform(solid, rotation, offset) -> Outcome` is a rigid copy of any polyhedral `Solid` of this module
(`rotation` holds the columns, as in `precise.rotate`).

A translation of a prism is not sent to `transform` (W2 integrate fix, 2026-09-24). `transformInBend`
adds the offset to the decoded words in F32x2, so a copy moved into contact with another cap missed it
by an F32x2 ulp: a pocket built at z = −5.05..5.05 and moved up by 6.73 (FeatureScript `opPattern`,
Python `Pos() * Box()`) got a top 2.9e-14 mm off a box top at 11.78, and the planar arrangement refused the
contact (`AmbiguousContact`, stage 2). `extrudeInBend` keeps its binary64 inputs (kept profile,
`origin`, `normal`, `x`, `far`) with the body object (`src/kernel.mjs` `PRISM_INPUTS`, not in the body
JSON). A rigid transform whose rotation is exactly the identity adds the offset to `origin` and `far` in
binary64 (`translatedPrismInputs`) and calls `extrude` again, and a chain of translations sums in binary64 step
by step. The copy's near cap has the words of the same prism extruded in place when `origin + offset` is the
in-place origin in binary64. Its far cap is `(origin + sweep) + offset`, which differs from the in-place
`(origin + offset) + sweep` in about 4.5 % of random decimal cases (`tmp/w2/verify-2/fold-assoc.mjs`); a
contact that such a last-bit difference makes ambiguous is handled by the cap snap below. The copy keeps its source's
construction record (with its own incidence audit) and identity labels, as every rigid copy does. Every
other body (a Boolean result, a rotated copy, a clone without the inputs) takes `transform`. The WK
evaluator mirrors this (`src/lang/wk/real-host.mjs` `foldedTranslations`: such a transform is sent as op 1).

**Cap snap before a planar Boolean** (W2 integrate Regression review 2, 2026-09-24). Two caps meant to be coplanar
can still reach the F32x2 split through different binary64 sums: a box top at `0 + 28.26` and a pocket
top at `(-3.04 + 6.08) + 25.22`, each with FeatureScript's metre-to-millimetre noise. They split to words
about 1e-14 mm apart in 7 to 9.5 % of two-decimal flush pockets (`tmp/w2/verify-2/fold-residual.mjs`), and
the planar arrangement refuses a vertex within its resolution of a plane that is not exactly on it
(`AmbiguousContact`). After that refusal, and only then, `src/boolean.mjs` retries the Boolean once with
`src/kernel.mjs` `snapPrismCaps`: one operand that is a prism with its binary64 inputs (an extrusion or a
folded translation of one), whose normal is a coordinate axis exactly and whose sketch x axis has no
component along it, gets each cap moved onto the other operand's same-axis plane when
`0 < |distance| <= CAP_SNAP.angularGuard × scale` (1e-12 × the largest coordinate magnitude of both
operands, at least 1: the arrangement's own resolution, 3e-11 mm for a 30 mm part). The prism is extruded
again in Bend, every vertex of a moved cap must decode to the plane's coordinate exactly, and the operand
states `exactness: 'regularized'` with `construction.capSnap` (`cap`, `axis`, `fromMm`, `toMm`,
`distanceMm`, `toleranceMm`, `onto`); the result inherits it (`src/exactness.mjs`). The operation evidence
records the refusal and the retry (`capSnap.refused`, `capSnap.retry`). If the retry is refused too, the
original refusal is what the user gets. Tilted caps, side faces and operands without prism inputs (Boolean
results) are not snapped.

**Profile inputs that were already rounded.** A `skLineSegment` sketch reaches `extrudeInBend` as the
line-sketch solver's F32 points (`kernel/sketch-lines.bend` `Solved.points`) until W1 applies
`tmp/w2/integrate-fix/library-sksolve.diff`. The prism words are F32x2 of those points, so such a body
states `exactness: 'quantized'` with `construction.profileQuantization.maxDeviationMm` (the largest
distance of an extruded point from the source's binary64 segment endpoint, about 1.5e-6 mm), and every
Boolean, pierce and copy computed from it inherits the label (`src/exactness.mjs`).

`admit(solid) -> Outcome` runs the general incidence audit on an existing body.

`Outcome` is `Built{solid, required, allowance}` or `Refused{reason}`. `required` is the largest measured
vertex-to-carrier distance, `allowance` the admitted one (below).

## Tolerance

Every result is audited: each vertex of each face loop against that face's carrier plane
(`|dot(p − origin, normal)| / |normal|` in F32x2). The allowance is `angular_guard × scale` with
`angular_guard = 1e-12` (`kernel/intersections.bend`) and `scale = max(1, largest |coordinate| of the
vertices and face origins)`, the same resolution the planar arrangement admits
(`kernel/ports/curved-validate.bend` `resolution`). A body that passes this audit therefore passes that
admission's incidence check.

- `extrude` audits structurally in O(n): it checks the bottom and top rings against the caps and the four
  corners of each side against its carrier while walking the lists. There is no O(n²) step.
- `transform` and `admit` do not know the structure. They index vertices and edges through balanced
  trees (even/odd split), O(n log n).
- `transform` measures the source and the copy. It refuses only when the copy is worse than the source by
  more than the allowance. A precise source gives a precise copy; an imprecise source (for example an F32
  body) is copied with its own residual reported in `required`, never made worse.
- Frame and rotation words must be orthonormal to `10 × angular_guard` (the budget of
  `curve-plane.bend` `frame_valid`), and a rotation must have a positive determinant.

Measured (float64 diagnosis of the returned words, `test/polygon-prism.test.mjs`):

| body | F32x2 worst distance | bound `1e-12 × scale` | today's F32 path |
|---|---:|---:|---:|
| `wedge-union.fs#slanted` wedge | 2.7e-15 mm | 1.0e-11 mm | 7.7e-7 mm |
| `cap-normal-far-from-origin.fs` octagon | 3.5e-13 mm | 4.9e-10 mm | 6.7e-4 mm |
| `cap-normal-far-from-origin.fs` key pocket | 3.2e-13 mm | 4.7e-10 mm | 9.6e-4 mm |
| `rotated-box-cut.fs` 600 mm box after `transform` | 1.4e-12 mm | 4.9e-10 mm | 3.6e-5 mm |
| r10b `nose`, oblique sweep | 4.2e-13 mm | 3.1e-10 mm | 1.5e-5 mm |

**Host decode.** An F32x2 pair can span more than 53 bits (for example `hi = 0.25`,
`lo = −3.8e-17`), so decoding `hi + lo` to a float64 rounds once, by at most half a float64 ulp
(`2^-53 × |value|`). About 6 % of the words of the bodies above round. After that first decode,
`src/real.mjs` `real()` and decoding again is idempotent. The loss is 4 orders of magnitude below the
allowance.

## Refusals

| reason | when |
|---|---|
| `TooFewVertices` | fewer than 3 profile points |
| `InvalidInput` | a non-finite or out-of-range word (`> 1e10`), a zero `normal`/`x`, a non-finite `offset` or `far` |
| `InvalidPoint{index}` | a profile point with a nonzero `z` word or an invalid word |
| `InvalidFrame` | `normal` and `x` not orthogonal within `10 × angular_guard` |
| `DegenerateSweep` | `|s.z| ≤ angular_guard × scale`: the sweep does not cross the plane (also a zero sweep) |
| `ZeroLengthEdge{index}` | profile edge `index → index+1` shorter than `angular_guard × scale` (max-norm) |
| `ProfileOrientation` | the profile is not counterclockwise along the sweep, or has zero area |
| `NonRigidRotation` | rotation columns not orthonormal within `10 × angular_guard`, or a reflection |
| `DanglingIndex` | a face uses an edge, or an edge a vertex, that does not exist |
| `IncidenceAudit{required, allowance}` | a vertex is farther than the allowance from one of its carriers |
| `TransformDrift{required, before, allowance}` | a copy moved a vertex off its carriers by more than the allowance beyond the source |

The profile must be simple. That test is O(n²) and stays on the host (`src/brep.mjs` `validatePolygon`).

## Cost on the JS target

Warm second call, far tilted plane, ellipse profile (`test/polygon-prism.test.mjs`, last test):

| vertices | extrude | per vertex | transform (two general audits) |
|---:|---:|---:|---:|
| 4 | 0.3 ms | 85 µs | 0.7 ms |
| 192 | 13.5 ms | 70 µs | 43 ms |
| 470 | 24 ms | 51 µs | 90 ms |
| 4096 | 119 ms | 29 µs | 460 ms |

Every n-sized list is built by tail calls into a reversed accumulator: the JS target runs tail calls
without the host stack, but not `x <> f(tail)`. A 16384-vertex profile builds.
