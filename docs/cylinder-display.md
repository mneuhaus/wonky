# Trimmed cylinders in the review display

`reviewScene` shades trimmed cylindrical faces using an explicitly approximate
display mesh. The triangles retain the original face index and identity, so the
existing face-picking path selects the corresponding analytic face. The B-rep,
source vertices, analytic curves, native trims and exported model geometry are
unchanged. OpenCascade is not used by this display path.

The implementation is in [display-cylinder.mjs](../src/display-cylinder.mjs)
and the evaluation helpers in [display.bend](../kernel/display.bend). Planar
triangulation and the existing two-rim cone display remain separate.

## Supported regions and validation

The display supports full periodic bands, partial panels, circular and oblique
elliptical rims, generator boundaries and physical holes, including holes that
cross the angular coordinate seam. It consumes the existing Bend-evaluated
edge samples to determine finite angular spans and subdivision events.

Before tessellation, the existing Bend cylinder/face preparation validates
curve frames, native domains, endpoint agreement, complete cylinder incidence
and closed coedge loops. Opposite uses of one valid line generator are removed
as an internal periodic seam. Other repeated edges, nonmanifold physical
vertices, unresolved generators and missing trims are rejected.

Physical boundary crossings are paired in height order in each angular column.
This parity is anchored to the exterior at axial infinity and supports holes
without inventing an outer loop. In particular, two noncontractible loops both
labelled `inner` can delimit a valid finite cylinder band. Face sense changes
triangle winding and normals, not region coverage.

The display checks height-order extrema over each column, generator/round-curve
crossings, overlapping generators and unconnected touching boundaries. Odd
crossing counts, crossing or tangent rims, coincident trims, uncertain input
projection and tessellation-budget exhaustion reject the **whole face**. The
existing analytic boundary display and `displayWarning` remain available;
partial shading is not reported as successful coverage.

## Display error budget

Bend converts samples to angular/axial coordinates and evaluates every generated
surface point and normal. For a supported round boundary, the intersection of
its plane with the cylinder has the axial height

```text
h(u) = a + b cos(u) + c sin(u)
A = sqrt(b² + c²)
```

Bend computes the coefficients and heights. The display mesh joins boundary
points with straight chords. Over an angular interval of width Δu, the radial
error is bounded by `r Δu² / 8`, and the height interpolation error by
`A Δu² / 8`. The conservative combined chordal bound is therefore
`(r + A) Δu² / 8`, plus the recorded input and arithmetic allowances. The
step size uses the largest participating amplitude, so a steep ellipse is not
judged solely by its radial sagitta. Internal triangle points have the same
radial bound; boundary-region displacement also includes the axial term.

The global Bend curve-incidence bound is amplified by
`sqrt(1 + (A/r)²)` when projecting a slightly inconsistent round boundary to
its cylinder/plane intersection. Endpoint disagreement is added separately.
Small shared-vertex angular events may be coalesced only within the recorded
numerical allowance. This affects the display chart, never the model topology.
The input gap allowance is one eighth of the requested display tolerance;
combined input/arithmetic uncertainty must stay below one quarter. The
remaining budget limits the chordal approximation.

The default tolerance is **0.02 mm**; `reviewScene(model, metadata,
{toleranceMm})` accepts 0.001–1 mm. A face is limited to 8192 angular columns
and 32768 triangles. Each shaded cylinder exposes `displayTessellation` with
the method, approximate flag, tolerance, removed seam indices, chart area,
maximum angular span, combined chordal bound, projection bound, endpoint gap
and event-coalescing allowance. These are display diagnostics, not new B-rep
measurements or a certified interval-arithmetic proof.

## Regression evidence

Run the focused regressions and optionally save their measurements:

```sh
WONKY_DISPLAY_EVIDENCE=1 node --test test/display-cylinder.test.mjs test/review.test.mjs
node scripts/check-bend.mjs
```

The measurement artifact is
[out/viewer-trims/regression.json](../out/viewer-trims/regression.json), with
the tested implementation/test hashes. The saved run's TAP and Bend output are
[regression.tap](../out/viewer-trims/regression.tap) and
[bend-check.log](../out/viewer-trims/bend-check.log). Existing acceptance,
benchmark and STEP-oracle reports are not overwritten by these checks.

Observed at 0.02 mm on a **fresh import of frozen P10 in the actual r10b `g0`
placement**:

- All 26 cylindrical faces receive 1402 triangles; no face is left as boundaries
  only. Source face identities remain attached to the selectable triangles.
- All 26 face chart areas agree with the frozen source within the perimeter
  times display-tolerance budget; the largest absolute difference is
  approximately 0.01261 mm². Three-dimensional mesh areas are checked as well.
- The largest cylinder residual at a triangle vertex is below `2.1e-12` mm;
  the largest sampled interior/chord residual is approximately 0.019322 mm.
- The largest declared combined chordal bound is approximately 0.019346 mm.
  Independent between-column samples on elliptical boundaries of faces 17,
  110 and 169 show maximum chord errors of approximately 0.013699, 0.014732
  and 0.014732 mm respectively. These checks include axial deviation.
- 52 projected triangle-interior probes classify `Inside` through the analytic
  Bend cylinder classifier; an unresolved result fails this check.
- P10's source hash remains
  `b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9`,
  and the imported/transformed body remains byte-identical during display.

Synthetic regressions add 115 coverage probes for full bands, holes crossing
the coordinate seam, partial panels and reversed senses. Oblique-rim tests
measure intermediate chord points, including a steep ellipse whose axial
error exceeds its radial error. A smaller requested tolerance produces more
triangles and smaller measured error. Seven negative cases verify explicit
rejection of missing trims, crossing/tangent rims, a generator crossing another
boundary, repeated coedges, an invalid chord seam and an unbounded rim.

The test corpus is finite. General surface arrangements, arbitrary nonanalytic
curves and trimmed cones are not added by this change. The viewer's approximate
coverage is not a Boolean construction, a watertight tessellation guarantee
between independently sampled neighbouring faces, a STEP validation or full
r10b acceptance. Browser picking and visual presentation are checked separately
from these geometric display regressions.
