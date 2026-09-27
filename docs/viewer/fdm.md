# fdm: build plate, plate relation and overhang shading

Package of wave 3 (spec 3.6, D20, sections 5 and 6 rows "Plate", "Plate
size", "Overhang shading", "Overhang threshold", "Small-bore exemption",
"Body printed", "Body up axis"). It adds printability checks per body that
follow cad-khana's conventions. It never moves geometry and never tints
anything the printability API has not classified. The report with the
evidence is `package-fdm.md`.

## Files

| File | Role |
|---|---|
| `src/viewer/printability.mjs` | query-worker handler `printabilityQuery`: request check, planar classification, cylinder and cone bands, face coverage, body extents, plate relation |
| `src/viewer/routes/printability.mjs` | `POST /api/models/:id/printability` through `ctx.pool.query('printability', …)` |
| `viewer/features/fdm/fdm.js` | feature: keys, view actions, Print check panel, status item, legend card, requests, `display.fdm`, parts-tree slots, inspector section, labels |
| `viewer/features/fdm/overhang.js` | pure helpers: legend and relation texts, settings keys, `display.fdm` composition, markup |
| `viewer/features/fdm/plate-layer.js` | GL layer: plate grid, outline and origin axes with depth clamping |
| `viewer/features/fdm/fdm.css` | styles of the above |
| `scripts/viewer/qa/fixtures/chamfer-45.fs`, `cross-bore-16.fs` | QA fixtures |
| `test/viewer-fdm.test.mjs` | 17 focused tests |

## Conventions

- **α (cad-khana)**: the overhang angle of an outward normal n from vertical,
  α = asin(max(0, −n·up)). A face overhangs when α > α_max + slack. The
  slack is 1e-6° (cad-khana) or the angular guard of the stored precision
  when that is larger (F32 bodies: 2⁻²³ rad ≈ 6.8e-6°), so a 45° chamfer
  passes at α_max = 45°.
- **β (slicers)**: OrcaSlicer and Bambu Studio use a threshold angle from
  horizontal. β = 90° − α_max is always shown next to α: "overhang α > 45°
  from vertical (slicer threshold β = 45°)"; at α_max = 60° the legend says
  β = 30°.
- **Bed faces**: planar faces with n = −up (within 4 × the angular guard) whose
  plane lies at the body's minimum along up (within the face tolerance). They
  are excluded from the overhang set and outlined.
- **Small-bore exemption** (on by default): hole cylinders (`sameSense`
  false) with Ø ≤ 12 mm (cad-khana `SMALL_BORE_MM`) are self-supporting. A
  bore is marked `exempt-small-bore` only where it would otherwise overhang
  (a vertical small bore stays `ok`), outlined and labelled "exempt: small
  bore Ø8". Cones are not exempted (cad-khana exempts cylinders only).
- **Bridge exemption**: not applied (it needs span analysis of anchored flat
  regions). The API and the legend say "bridge exemption (≤ 10 mm) not
  applied".

## Printability API

`POST /api/models/:id/printability`

```json
{ "alphaDeg": 45, "smallBoreMm": 12, "plateMm": [256, 256],
  "bodies": [{ "bodyId": "model/prism", "up": [0, 0, 1], "printed": true }] }
```

Every field is optional. `smallBoreMm: null` turns the exemption off.
Without `bodies` every body is checked with up = +Z; with `bodies` the answer
covers exactly the listed bodies (the viewer asks only for bodies whose
settings changed). Shape errors answer 400 before the worker runs; an unknown
body id answers 400; an unknown model 404; a non-JSON body 415. The handler
runs in the query worker (30 s timeout); a client that disconnects aborts it.

Answer (`wonky.viewer-printability/1`):

```
{ schema, modelId, units: 'mm', alphaDeg, betaDeg, smallBoreMm,
  conventions: { overhang, slicer, legend, bands, slackDeg },
  exemptions: { bed, smallBore: { applied, maxDiameterMm, note },
                bridge: { applied: false, maxSpanMm: 10, note } },
  plate: { sizeMm, center: [0, 0, 0], up: [0, 0, 1] },
  bodies: [{ bodyId, alias, name, up, printed, slackDeg, toleranceMm,
             plate: { relation, distanceMm?, minAlongUpMm, bedFaces, footprint?,
                      exactness, method, toleranceMm, note?, reason? },
             faces: [{ alias: 'B1.L3', fragments: ['B1.F3', …], surface,
                       kind, exactness, toleranceMm,
                       normal?, angleDeg?, offsetAlongUpMm?,         // planes
                       hole?, diameterMm?, halfAngleDeg?, bandsDeg?,  // cylinders, cones
                       band?: { kind, centerDeg, halfWidthDeg, supportingBandsDeg,
                                coverageDeg, scope, frame, angleConvention },
                       reason? }],
             counts: { ok, overhang, bed, 'exempt-small-bore', unsupported } }] }
```

A body with `printed: false` answers `plate: null, faces: []` and a note.

**Face kinds** (per logical face, `logicalFaces(model)`):

| kind | meaning |
|---|---|
| `ok` | no overhang |
| `overhang` | planar: the whole face (α > α_max); curved: `bandsDeg` is non-empty |
| `bed` | planar face at the body minimum with n = −up |
| `exempt-small-bore` | hole cylinder Ø ≤ smallBoreMm that would overhang |
| `unsupported` | no closed form (surface types other than plane, cylinder, cone), or a down-facing plane when the body minimum is unresolved; `reason` says which |

**Curved bands.** For a cylinder (θ = 0) or cone (half angle θ) with frame
x, y = axis × x and s = +1 boss, −1 hole, the outward normal is
n(u) = s (cos θ (cos u x + sin u y) − sin θ a) (the same convention as the
kernel's `surface_normal`, checked in `out/viewer/fdm/check-normals.txt`).
Then −n·up = −s cos θ R cos(u − φ) + s sin θ (a·up) with R = hypot(x·up,
y·up), φ = atan2(y·up, x·up), and the overhang set is one interval of u (or
none, or the full turn), in degrees from x toward y. The band of the
supporting surface is intersected with the face's own angular coverage from
its circle edges (exact curve parameters, `kernel.analytic.curve_point`);
a face without circle edges keeps the supporting band and says so in
`band.scope`. Cross-bore-16 (axis +X, x = +Y): band 45°–135°.

**Plate relation.** With up = +Z: `on-plate` (|min Z| ≤ body tolerance),
`floats` or `cuts` with `distanceMm`, plus `footprint` (X and Y extents
against the plate centred on the origin, `exceeds`). With another up axis:
`bed-faces` or `no-bed-face` with `minAlongUpMm`; the drawn plate stays at
Z = 0 and the geometry is not moved. `unresolved` when an edge band does not
resolve.

**Exactness.** Planar kinds, angles and bands are `exact-parameters` (closed
forms over the stored parameters). Body extents are `recorded`
(`validation.boundsMm`, only for axis-aligned up) or `kernel-resolved`
(`boundEdgePlaneBand` over every edge: on solids bounded by planes,
cylinders and cones every directional extreme lies on an edge). Bed kinds
carry the extent's label. The viewer draws curved bands from exact per-vertex
normals interpolated over display strips; the legend states the band-edge
bound "curved band edges ±4.1° (display strips)", half the widest strip
span 2 acos(1 − e/r) of a tinted cylinder (e = the face's `maxChordErrorMm`).

## Viewer

| Control | Action | Setting |
|---|---|---|
| `G`, view action (plate icon) | build plate at Z = 0 | S `fdmPlate`; default on for live sources, off for `.brep.json` |
| `Shift+G`, view action | overhang shading | S `fdmOverhang`; default off |
| `Shift+B`, inspector "Print on this face", panel button | up = −n of the selected planar face's exact outward normal (`GET …/geometry?aliases=`) | SB `fdmUp`, `fdmUpFrom` |
| Print check panel (view action) | plate size, α_max with β, small-bore exemption, per body printed + up axis + relation | G `fdmAlphaDeg` (45), `fdmSmallBore` (true), `fdmPlateWidthMm` / `fdmPlateDepthMm` (256); SB `fdmPrinted` (true) |

SB keys are `name:<body name>` when the name is present and unique in the
model, else `id:<body id>`. S and SB use the source key of `app.sourceKey`
(live source path or `.brep.json` path).

- **Plate** (`plate-layer.js`): grid lines every 10 mm, 1 mm lines fading in
  from 6 CSS px per mm, the outline, and origin axes (X red and Y green to
  the plate edge, Z blue 10 % of the shorter side). Lines only, so the bottom
  view sees the model between them. The renderer's depth window comes from
  the model's bounding sphere, so plate segments are split where they leave
  a slab of 1.02 × that radius and the outside pieces are moved along their
  eye rays onto the slab faces: the screen position is unchanged, pieces
  behind the model stay hidden by the depth test, pieces in front are drawn
  over it (tested for orthographic and perspective).
- **Tint** (`display.fdm`, see `render-look.md`): only models with answers
  for the current settings get face flags; a live swap, an α change or an up
  change shows "pending" until the new answer. Planar `overhang` is exact
  per face; curved `overhang` is drawn by the shader where the exact
  per-vertex normal passes the threshold, inside the API's band; bed and
  exempt faces are outlined. Not printed bodies get no flags.
- **Status bar** (`#fdm-status`): with exactly one visible body its relation
  and exactness chip ("B1 on plate recorded", "B1 floats 3.2000 mm above the
  plate", "B2 cuts 4.0000 mm into the plate"); with several, "N visible
  bodies: plate relation per body" and each parts-tree row gets the badge
  (`parts.rowBadge` `fdm.plate`, compact "cuts 4.0000 mm", full sentence in
  the title). Distances print to the decade of the body tolerance.
- **Legend card** (`#fdm-legend`, bottom right above the view actions while
  overhang shading is on): the α/β line, "exempt: small bore Ø ≤ 12 mm
  (outlined)", "bed faces excluded (outlined)", "bridge exemption (≤ 10 mm)
  not applied", the curved band-edge bound, and the counts or "overhang
  pending · r4: no tint until the printability API answers".
- **Parts tree** (`parts.rowDetail` `fdm.print`): printed checkbox and up
  axis in the row expansion. The feature calls `app.renderParts()` after
  every change.
- **Inspector** (`inspector.section` `fdm.print`, order 35, while the plate
  or overhang is on): the body relation, the face's classification (α, band,
  exemption, bed) and "Print on this face".
- **Labels**: "exempt: small bore Ø8" at the display centre of exempt faces
  (a label position only), at most 12.

Debug handle (`window.wonkyViewer.app`): `fdmStatus()`,
`fdmPrintability(modelId)`, `fdmSetAlpha(deg)`, `fdmSetPrinted(bodyId,
printed)`, `fdmSetUp(bodyId, up)`, `fdmPrintOnFace()`.
