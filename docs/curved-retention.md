# Complete retention and exclusion for curved clipping

`kernel/ports/curved-retention.bend` handles a valid source that is wholly and
strictly on one side of the cutting plane. It fixes the contained-cylinder
failure recorded as R2 in `out/boolean-ports/curved-review/report.md`: two
periodic rim wires may have different stored seam angles, and retaining the
source does not require connecting those vertices.

## Decision and protected gates

`curved.clip` still validates the query and source budget first, then runs the
existing complete source audit. Only its successful branch calls the retention
classifier. Invalid topology, wrong domains, inward shells and zero-volume
shells cannot return `Clipped` or `Empty` through this path.

Every source face is prepared through `face-plane.prepare_valid`, then enclosed
with the existing `face-bounds.directional`. The bounds are joined across all
faces. Planar faces use complete analytic boundary supports. Cylinder bounds
enclose the full angular cylinder over its conservatively bounded axial range,
including interior extrema that may be absent from stored boundary vertices.
Full circle/ellipse supports may deliberately overestimate a trimmed arc.

The existing `face-bounds.separated` rule requires a strict gap exceeding

```text
query_linear + source_budget
  + 16 * max(source_resolution, intersections.guard(bounds_scale))
```

after normalizing the cutting direction. The operational arithmetic guard is
not an interval-arithmetic proof. The two complete-body decisions are:

- All face bounds strictly below the negative margin: retain the complete source.
- All face bounds strictly above the positive margin: return `Empty`.

Unknown, non-finite, unprepared, mixed, tangent and insufficiently separated
bounds return `Undecided`; `curved.clip` then follows its existing section and
construction path. The classifier is an internal post-audit helper, not a
replacement public source validator. No vertex-only box, proximity welding,
geometry shift, new seam or partial result is used.

## Native representation contract

A retained result contains the original source solid: vertex/edge/face indices,
coordinates, curve supports, frames, senses and loops are preserved. Origin
lists are complete and ordered: `SourceEdge{i}` and `SourceFace{i}` refer to the
unchanged input indices. A retained source does not acquire `CutEdge` or
`CutFace` entries.

The shared result contract requires one explicit domain per edge. Existing
`GivenDomain` values are preserved exactly. `AutoDomain` or an omitted domain
list is resolved using the existing source edge/vertex rules and returned as
`GivenDomain`; failure to resolve does not produce a partial result. Line
directions and interval parameter values are not normalized or rescaled. The
tests include a nonunit line with original interval `[5,10]`, nonunit surface
directions, explicit bounded circular arcs, and subsequent clipping with the
returned domains. Exporters must honor that preserved source parameterization;
this path does not broaden their existing serialization preconditions.

This is a complete-body fix. It does not expand the supported mixed/contact
arrangements or change how winding bands are reconstructed when a real cut
still requires that reconstruction.

## Regression and independent STEP evidence

The frozen evidence is under `out/boolean-ports/curved-retention/`.

- Native compilation passed.
- `test/curved-retention.test.mjs`: 7/7 tests passed. Its 31 recorded scenarios
  cover shifted rim seams, complete inside/outside decisions, exact source and
  domain preservation, provenance, full extrema despite vertices all lying on
  one side, positive source-budget/query margins, coordinate-scaled guards,
  unknown preparation, bounded output reuse and invalid-source gates.
  Additional assertions check invalid public query/budget gates and follow-up
  clipping.
- `test/curved-clip.test.mjs`: 11/11 tests passed, including both existing P10
  native cases. An attempted name filter did not exclude that P10 test; the
  log records the actual complete focused-file run.
- Six retained exports passed
  `BRepCheck_Analyzer(shape, True, False, True)`, the strict exact
  CurveOnSurface check, plus the validator's topology and volume checks.

The four radius-5, height-10, two-rim source cylinders have native topology
`V/E/F = 2/2/3` before and after retention. Their independent reference volume
is `250π mm³`; all three source face areas are independently compared with
`[25π,25π,100π] mm²`. Imported STEP topology is a separate observation:

| Source seam offset | Native retained V/E/F | Imported STEP V/E/F | Reader refinement |
|---|---|---|---|
| 0 | 2/2/3 | 2/3/3 | One periodic seam |
| 0.3 rad | 2/2/3 | 3/4/3 | One seam and one boundary vertex |
| π/2 | 2/2/3 | 3/4/3 | One seam and one boundary vertex |
| π | 2/2/3 | 3/4/3 | One seam and one boundary vertex |

Those edges/vertices are added by the independent STEP reader. The native
constructor and serializer retain the source topology. Validation permits only
the existing explicitly accounted periodic refinement and checks every source
face area; it does not accept lost faces or solids. The retained longitudinal
body with bounded arcs and a cylinder with an existing generator seam also pass
strict STEP checking without added topology.

```sh
.tools/bend-2.0.25/bin/bend kernel/ports/curved.bend
node --test test/curved-retention.test.mjs
node --test test/curved-clip.test.mjs
uv run scripts/validate-step.py \
  out/boolean-ports/curved-retention/aligned \
  out/boolean-ports/curved-retention/shifted-small \
  out/boolean-ports/curved-retention/shifted-quarter \
  out/boolean-ports/curved-retention/shifted-opposite \
  out/boolean-ports/curved-retention/bounded-arcs \
  out/boolean-ports/curved-retention/original-generator-seam
```

This bounded change makes no timing, native/GPU performance, general-contact,
general solid-Boolean, full-suite or full-r10b acceptance claim. Root owns the
combined integration gates and broader export acceptance.
