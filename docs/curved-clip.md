# Generic analytic curved halfspace construction

The native constructor in `kernel/ports/curved.bend` produces complete B-reps
from bounded planar/cylindrical input and a transverse cutting plane. It retains
`dot(point - origin, normal) <= 0`. Construction, topology, curve domains,
classification and measurement run in Bend; JavaScript only prepares fixtures,
serializes results and drives checks. No external CAD kernel constructs a result.

This is a reviewable intermediate implementation. Native tests include actual
frozen P10 top/right cuts, but independent STEP acceptance is still open: the
strict imported CurveOnSurface check currently fails for both P10 exports.
Neither the complete six-plane P10/box intersection nor the full r10b model is
claimed complete.

## API and result contract

```bend
clip(solid, domains, origin, normal, tolerance, source_budget) -> P.Result
audit(solid, domains, tolerance, source_budget) -> Audit
volume(solid, domains) -> R.Real
```

The shared `P.Result` type is unchanged. `Clipped` contains one connected closed
solid. `Components` contains complete, individually connected solids. Every
component carries one explicit domain and edge origin per edge, and one face
origin per face. `Empty` represents an accepted empty result. An unsupported,
ambiguous or invalid operation returns `Unresolved` without a partial solid.
Source validity is checked before empty or contained shortcuts. The source is
immutable, and returned domains can be supplied to the next native clip.

Domains may be omitted as an empty list, allowing the existing `AutoDomain`
rules, or must have exactly one entry per source edge. Lines, circles and
ellipses keep their analytic supports, trims and senses. Bounded conic arcs may
wrap past `2π`; they must not be serialized as untrimmed full curves.

## Construction

1. Audit the source shell, then use `section.bend` and its existing analytic
   intersection/event certificates. A shared event identifies a source edge and
   exact parameter words; source vertex/seam events retain their vertex IDs.
   Interior roots are appended once. There is no distance-based vertex merge.
2. Split each physical source edge into blocks at its ordered analytic events.
   Complete line/conic root enumeration permits classification of each
   intervening open interval at its midpoint. Periodic parameters are lifted
   relative to the actual source seam. Ambiguous or coincident intervals abort.
3. Rebuild each source face using retained source blocks and oppositely directed
   section uses. Stitch by vertex identity, classify outer rings and holes by
   analytic oriented area, and require one unambiguous owner for every hole.
   Carrier projection is used only for containment probes; it does not move
   vertices or supports. Planar caps use the section orientation directly.
4. Rebuild simple cylindrical winding bands with a generator seam. A synthetic
   section seam is aligned with a retained source boundary vertex where
   possible. Extract connected components, compact the topology, normalize
   support frames/line directions with matching domain rescaling, and audit
   every complete component before publishing any of them.

`SourceEdge` identifies retained blocks, including multiple pieces of one
source edge. `CutEdge{face}` identifies a section edge on that source face and
the cutter. `SurfaceSeam{face}` identifies a newly reconstructed periodic
generator seam belonging to the source face, without claiming cutter incidence.
Caps carry `CutFace`; retained
face regions carry `SourceFace`. The OCCT adaptation is reused only for its
low-level component selection/remapping helpers. Its clipping constructor and
the frozen `occt*.bend` baseline are not changed or called by this constructor.

## Supported domain and explicit limits

The source must be a connected, embedded, non-self-intersecting closed shell of
bounded planar and cylindrical faces, with coherent boundary orientation and
valid analytic curve/carrier incidence. Planar faces may be concave and have
holes; output may be disconnected. The native audit checks topology and local
geometry, but does not prove arbitrary 3D non-self-intersection or disjointness
of all source face interiors. Embedded source geometry remains a precondition.

Cylindrical contractible rings use the analytic area integral. A noncontractible
winding band currently requires exactly two opposite full-periodic, single-edge
wires. The band reconstruction itself requires aligned seam vertices. The
independent review found that unnecessarily rebuilding a wholly retained
source with shifted seam vertices caused `ConstructionFailure`.
The [complete-source retention path](curved-retention.md) now fixes that case:
after the full source audit, conservative bounds on every entire face can
prove strict retention or removal. Retention preserves geometry and indices,
resolves automatic domains and records original face/edge provenance.
Uncertain/contact/mixed bounds still use the existing construction path;
general mixed-body band reconstruction with shifted seams remains outside
this fix. More complicated periodic wire arrangements are rejected.
Disconnected source shells are rejected; disconnected output is represented
by `Components`.

General tangent/coplanar/contact arrangements, cones and other unsupported
surfaces are rejected. An exact source seam can participate in the supported
transverse arrangements, as exercised by the longitudinal seam test. This does
not establish general contact handling. The actual P10 `y=4` contact arrangement
remains unresolved. There is no polygonal fallback, tolerance escalation,
partial-shell success, general solid/solid Boolean claim or implicit repair.

## Numerical and measurement contract

`Audit` reports `valid`, `allowance`, `required`, `resolution` and `volume`.
The public `audit` entrypoint applies the same source-budget and query-tolerance
gates as `clip`: finite normalized source budget in `[0, 0.1]`, positive finite
linear tolerance, and angular tolerance between the operational angular guard
and `0.1`. Invalid policy inputs always give `valid: false`; the accompanying
numeric fields are diagnostic only and cannot authorize export.

- `required` is the maximum measured endpoint/curve gap and complete analytic
  curve/carrier incidence bound. It is checked against `allowance`.
- `resolution` is the existing operational angular guard (approximately
  `1e-12`) multiplied by a scale at least one and covering vertex coordinates,
  analytic curve origins/sizes, surface origins and cylinder radii. It is a
  numerical guard, not an interval-arithmetic error proof.
- `allowance = source_budget + resolution`. The construction allowance does
  **not** include the query's linear tolerance. The source budget must be finite
  and between zero and 0.1 mm; the host uses the maximum supplied input/vertex
  tolerance. The actual represented values are reported in the artifacts.
- The query tolerance participates in intersection resolution, contact decisions
  and open-span classification. The latter uses the explicit margin
  `source_budget + linear_tolerance + resolution`. Cylindrical winding decisions
  also use an explicit angular allowance derived from source budget, radius and
  the number of coedges. These decisions do not enlarge the geometry allowance.
- The audit checks finite valid vertices, exact opposite coedge pairing, used
  vertices, a connected shell, valid source/output faces, positive oriented
  planar outer loops, negative oriented planar holes, positive total face areas
  and positive finite analytic volume. Zero-volume double-sided shells are
  rejected even when the cutter would otherwise return `Empty`.

Area and volume use analytic boundary antiderivatives for lines, circles and
ellipses. The planar integral is vector area; cylindrical area uses
`-radius * ∮ z dθ`; cylindrical flux uses trigonometric-product
antiderivatives, and total signed volume uses the divergence theorem. There is
no tessellation in these measurements. For exact supported incidences the
formulas measure the represented analytic body. With positive source tolerance,
they are **nominal** measurements of the represented supports/domains: no
rigorous mass-error interval is provided. Small measured incidence residuals
alone do not establish tight bounds on volume or any other mass property.

The test exporter separately records
`exportToleranceMm = max(0.0003, allowance)`, reflecting the existing analytic
export validation floor. This does not change the native construction budget.
That declared export tolerance must not be mistaken for demonstrated STEP
CurveOnSurface validity; the strict independent check remains authoritative.

## Frozen P10 observations

The input is `fixtures/r10b/modules/base/ZtoDD.body.json`, SHA-256
`b78a8546970e360ee2a3a22661c87d4f9e835d24fe50cedeedde6a19add20dc9`.
It is transformed with rows
`[[1,0,0],[0,0.9063077870366499,-0.42261826174069944],
[0,0.42261826174069944,0.9063077870366499]]` and translation
`[0,85.7915071334,-183.980480768]`, matching the frozen section tests.
Neither the fixture nor the input object is changed.

The represented source budget is `0.0003000000251806075` mm. Its audit reports
required incidence `2.5721352562924707e-11` mm, numerical guard
`1.3999999944102787e-10` mm, allowance `0.00030000016518060696` mm and nominal
volume `275773.8410529259` mm³.

| Retained halfspace | Native result | V / E / F per component | Nominal volume, mm³ |
|---|---|---|---:|
| `z <= 68` | `Clipped` | 318 / 480 / 168 | 237806.97653301898 |
| `x <= -92.79000091552734` | `Components` | 8 / 12 / 6 | 232.07661324585206 |
| same right cut, second component | same result | 90 / 135 / 50 | 30269.952370419458 |

The top result's required incidence is `2.263078724941085e-11` mm and allowance
`0.000300000145230607` mm. The right components report required incidence
`1.2847115876986807e-11` and `8.959943897935023e-12` mm, with allowances
`0.0003000001326806071` and `0.000300000145230607` mm. These are measured native
results, not a claim of successful independent export acceptance.

## Reproduction and independent acceptance

```sh
.tools/bend-2.0.25/bin/bend kernel/ports/curved.bend
node --test test/curved-clip.test.mjs
uv run scripts/validate-step.py out/boolean-ports/curved/r10b-plane-1
uv run scripts/validate-step.py out/boolean-ports/curved/r10b-plane-3
```

The focused test run passed 10/10 cases in 63.64 s, including 53.26 s in the
actual P10 test. These are process-level test timings, including additional
audits/exports, rather than isolated construction, native CPU or GPU benchmarks.
The focused tests cover axial/oblique/longitudinal cuts, source seams, bounded
wrapping ellipse arcs, annular holes, repeated native clips, a concave prism
with two output components, malformed sources/domains/orientation, a
zero-volume opposed triangle shell, unsupported/uncertain contacts and both
actual P10 planes. The root integration run owns the complete `npm test` gate.

Artifacts, compilation/test logs and source hashes are recorded under
`out/boolean-ports/curved/`. The independent validator uses
`BRepCheck_Analyzer(shape, True, False, True)` to request exact CurveOnSurface
checking. The initial P10 exports fail that check: the STEP reader's reconstructed
cylindrical pcurves can leave their declared edge tolerance despite precise 3D
conics. Export promotion is held pending explicit native pcurve export and
rerunning the strict check. A default sampled BRep validity pass does not
supersede this failure, and no hidden tolerance increase is applied.

The strict initial export checks pass for `axial`, `longitudinal`,
`longitudinal-reversed`, `source-seam`, `annular`, `annular-longitudinal` and
`U-components`. They fail at exact CurveOnSurface validity for `oblique`,
`partial-ellipse`, `repeated`, `r10b-plane-1` and `r10b-plane-3`.
`out/boolean-ports/curved/evidence.json` records the corresponding artifact,
source and log hashes. Later export-only corrections need new hashes and checks;
they must not overwrite these initial failures as though they had passed.
