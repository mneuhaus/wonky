# Supporting-line intersections

`kernel/ray.bend` intersects an infinite oriented line with a supporting plane,
cylinder, or cone. Geometry, coefficient construction, zero certification,
normalization, root solving, and cone branch filtering run in Bend. The output
retains normalized F32x2 values.

This is not yet ray/trimmed-face classification or a solid inside/outside test.
It does not test face boundaries, select positive parameters, combine adjacent
faces, deduplicate edge or vertex contacts, or assemble Boolean topology.

## Contract

```text
line_surface(origin: precise.Vec3, direction: precise.Vec3,
             surface: analytic.Surface) -> Roots

Roots{kind: U32, values: List<Real>}
```

The direction is normalized in Bend. Each returned parameter `t` is signed
distance in the input coordinate units, conventionally mm, with
`point = origin + normalized_direction * t`. Negative roots are retained.
Roots are sorted in increasing order. Changing direction scale does not change
parameters; reversing direction reverses their order and signs. Surface `x`
directions are unused because they do not affect supporting sets.

| Kind | Meaning | Values |
| --- | --- | --- |
| 0 | Resolved miss of the supporting surface | None |
| 1 | Resolved transverse roots | One or two |
| 2 | Certified double root | One |
| 3 | Certified coincident line | None; infinitely many points |
| 4 | Unresolved coefficient, degeneracy, certificate, or cone apex | None |
| 5 | Invalid or out-of-domain input | None |
| 6 | Generated parameter outside the supported range | None |

**Tangencies and coincident lines are unsafe for ray parity.** Kind 2 must not
be counted as one transverse crossing. Kind 3 is not a miss. Even kind 1 still
requires face trim tests, robust shared-boundary treatment, and a stated policy
for roots near the ray origin before it can contribute to solid classification.

`point(origin, direction, t)` evaluates the same signed-distance
parameterization. It assumes a previously validated nonzero direction.

The JavaScript adapter only loads and serializes:

```js
import {
  lineSurfaceIntersections,
  requireResolvedLineIntersection,
  lineIntersectionKinds,
} from './src/ray.mjs';

const result = await lineSurfaceIntersections(
  [-10, 0, 0], [2, 0, 0],
  { type: 'cylinder', origin: [0, 0, 0], axis: [0, 0, 1], radius: 5 },
);
requireResolvedLineIntersection(result);
// kind === lineIntersectionKinds.transverse; parameters are 5 and 15.
```

`loadRayKernel()` gives access to the Bend module for synchronous calls after
loading. Numeric arrays and existing Bend vectors/surfaces are supported.
`requireResolvedLineIntersection()` throws a capability error for kinds 4–6;
callers must still distinguish tangency and coincidence.

## Generic polynomial solver versus geometry

`quadratic(a, b, c)` solves the represented polynomial `a*t² + b*t + c = 0`.
`linear(b, c)` is the corresponding safe linear entry point. These generic APIs
validate their Real words and certify a computed-zero discriminant using the
exact represented coefficients. They have no access to any geometry that
produced those coefficients.

Consequently, `quadratic(1, 0, 0)` correctly returns a double root at zero, but
feeding it rounded geometric coefficients does not certify a tangent surface.
Use `line_surface` for geometric classifications. It checks coefficient zeros
and the discriminant against the original surface equation independently of
the rounded solver coefficients.

For resolved positive discriminants, the solver forms
`q = -0.5 * (b + sign(b) * sqrt(discriminant))`, choosing the positive sign when
`b` is zero, then returns `q/a` and `c/q`. This preserves a small root when the
ordinary subtraction formula would cancel most of its significant digits.

## Exact-zero certification

Plane coefficient zero tests use the original normal, line direction, and
original origin coordinates. They do not certify a rounded normalized vector
or a rounded coordinate difference.

For cylinders, let `o = origin - cylinder_origin`, `d` be the input line
direction, `n` the input cylinder axis, and `r` its radius. Floating expansions
retain the original-coordinate difference, and form:

```text
A = (n·n)(d·d) - (d·n)²
B = 2*((n·n)(o·d) - (o·n)(d·n))
C = (n·n)((o·o) - r²) - (o·n)²
D = B² - 4*A*C
```

These polynomials differ from the normalized geometric coefficients by positive
scale factors, preserving their zero sets and the discriminant's zero set.
Parallel-axis certification also uses the original cross product. A computed
zero without the relevant original-equation certificate produces kind 4.

The implementation reuses the guarded error-free F32 expansions documented in
[intersections.md](intersections.md). An unavailable certificate is not proof
of nonzero; it leaves a computed-zero branch unresolved. The public helper
`cylinder_polynomial` exposes the original-equation expansions, and
`exact_discriminant` operates on its `ExactPolynomial` record.

Cones require additional care: `tan(angle)` is computed in finite precision,
so an exact zero of that approximate polynomial does not prove an exact zero
for the source analytic cone. A zero angle takes the cylinder path. For a
nonzero angle, only structural reductions are certified: perpendicular line
direction plus perpendicular offset can certify the linear coefficient zero;
an origin in the cone's base plane can certify its zero constant through the
base circle; a line entirely in that base plane can use the cylinder
discriminant certificate. Other computed-zero cone coefficients or
discriminants remain unresolved. Lines on cone generators remain unresolved.

## Cone nappe and apex

The represented cone uses axial coordinate `z` and signed radial size
`radius + tan(angle) * z`. Squaring that equation produces roots on a second
nappe that is absent from this oriented surface. Roots with clearly negative
signed radius are discarded. Any root whose signed radius is inside the apex
guard makes the whole result unresolved, including when another root is usable.
Negative cone angles are supported with the same signed-radius convention.

The guard is the larger of approximately `1e-7` and `1e-12` times the magnitudes
participating in the signed-radius evaluation. Very small circular sections
can consequently remain unresolved.

## Numerical and range limits

Input Real words must be finite and normalized. Every input origin and
direction component is limited to absolute magnitude `10000`. A direction
must have a component of magnitude at least approximately `1e-12`. Radii must
be positive and at most `10000`. Cone angles must have absolute magnitude less
than approximately `1.4` radians. All retained geometric parameters must have
absolute magnitude at most `100000`; an excessive parameter produces kind 6
without a partial root list.

The generic polynomial APIs accept normalized finite coefficients of magnitude
at most `1e14`, and roots up to approximately `1e20`. These wider generic root
bounds do not change the geometric entry point's limits.

Nonzero leading quadratic or linear coefficients of magnitude at most
approximately `1e-12` remain unresolved. A nonzero constant in a degenerate
linear equation uses the same ambiguity threshold. Nonzero discriminants use
approximately `1e-12 * max(1, |b²| + |4ac|)`. Exact zero branches additionally
require the certificates above. The generic solver's absolute thresholds mean
that rescaling all coefficients can change whether it resolves a problem.

These nonzero guards are operational limits, not certified interval bounds on
all root errors or nonzero signs. F32x2 root construction remains finite
precision. More degenerate cases, unrestricted magnitudes, and parity-safe
classification require further work; unresolved results must not be converted
to misses or silently suppressed.

## Validation

```sh
.tools/bend-2.0.25/bin/bend kernel/ray.bend
node --test test/ray.test.mjs test/intersections.test.mjs
```

The tests retain the original plane/cylinder/cone coverage and add independent
BigInt predicates over every represented F32 bit. Regressions cover rounded
zero plane denominators and offsets, rounded cylinder coefficients for both
inside and outside points, an actual missed line whose rounded quadratic claims
a tangent hit, and radial-direction underflow that formerly implied a miss or
coincidence. The raw discriminant test distinguishes an exact represented
quadratic from its rounded discriminant.

Independent analytic references cover signed parameters, reversed and rescaled
directions, translated and rotated cone frames, physical-nappe filtering,
near-apex and generator ambiguity, and 100 deterministic raw quadratic cases.
Malformed words and finite range limits have explicit regression tests. No
external geometry engine constructs production results.
