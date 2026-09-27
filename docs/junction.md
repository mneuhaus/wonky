# Explicit point junctions

`kernel/junction.bend` associates retained source vertices, native curve samples,
plane projections and resolved curve/plane hits under an explicit contact cap.
All geometry, certificates, parameter selection and association decisions run
in Bend. `src/junction.mjs` validates representation fields and serializes input.
The module is separate from clipping and has no implicit policy in the boundary,
halfspace or Boolean modules.

The result contains the original anchor and every event point. It never moves a
source vertex, selects an average or replacement point, rewrites a curve, or
turns near coincidence into exact geometric coincidence. Body/vertex, body/edge,
body/face and event IDs remain distinct even when their coordinates match.

## Evidence and policy

Three different statements remain distinguishable:

| Statement | Evidence | Meaning |
| --- | --- | --- |
| `ExactZero` plane incidence | Error-free F32 expansions of the original represented `normal · (point − origin)` | That exact algebraic expression is zero, within the certificate's supported exponent range. |
| `SameRepresentedPoint` / `ExactRepresentedPoints` | Equal normalized F32x2 coordinate words | Stored coordinates match. This does not certify analytic incidence or identify different source entities. |
| `WithinTolerance` / `ToleratedConnection` | Explicit cap and complete pairwise gap checks | A proposed topological point connection fits the caller's policy. It does not certify exact coincidence. |

`NotCertified` means nonzero **or unavailable**. It is never a certificate of
nonzero incidence. A rounded numeric zero is insufficient. Intersection witnesses
also carry a separate analytic root certificate, using the curve/plane solver's
original-input certificate: currently lines and round curves at native parameter
zero. Noncanonical round roots can be resolved numerically without this exact
certificate.

The caller must provide `contactTolerance`; omitting it is an error. It must be
a finite normalized nonnegative Real within the existing approximately 0.1 mm
source-budget range. Source allowances are preserved separately and never added
to this contact cap. The prepared-edge convenience builder carries the existing
body-wide finite-edge source budget, not an inferred individual vertex budget.

For every anchor–event and event–event pair the result records both IDs, the
coordinate delta, actual computed distance, guard, cap and relation. For distinct
represented coordinates:

- Accept only when `distance + guard <= contactTolerance`.
- Separate only when `distance - guard > contactTolerance`.
- Otherwise return `Unresolved / Threshold` with the measured gap witness.

The pair guard adds a scale-dependent arithmetic estimate and both event
construction estimates. Each construction estimate must itself fit the contact
cap, or the result is `Unresolved / ConstructionBudget`. These are operational
guards, not formal interval-arithmetic error bounds. A zero cap can accept equal
original vertex records; numerical constructions have nonzero estimates.

Every pair is checked, so a chain of individually nearby points cannot join a
group whose diameter exceeds the cap. The accepted diameter is the maximum of
the retained pair distances. No global equivalence class or transitive merge is
created from separate successful calls.

Two events on the same body/edge must use exactly the same native parameter.
Different parameters return `Unresolved / ParameterConflict`, including periodic
parameters that happen to evaluate to nearly the same point. This prevents a
point junction from silently collapsing event order; it does not construct a
complete ordered arrangement.

Repeated source IDs must have identical source coordinates and allowances;
repeated curve IDs must have identical curves and domains; repeated plane IDs
must have identical origins and normals. Contradictions and duplicate event IDs
are rejected. IDs are caller-scoped references to a fixed source revision; the
module does not infer entity identity across model revisions.

## API

```js
import { associateJunction } from '../src/junction.mjs';

const original = {
  body: 0, vertex: 3,
  point: [2, 4.00000000005, 7],
  sourceTolerance: 0.0003,
};
const result = await associateJunction(original, [
  {
    id: 1, type: 'curve-sample', body: 0, edge: 12,
    curve: { type: 'line', origin: [2, 0, 7], direction: [0, 1, 0] },
    interval: [0, 5], parameter: 4.000000000049,
    sourceTolerance: 0.0003,
  },
  {
    id: 2, type: 'plane-projection', body: 1, face: 2,
    plane: { origin: [0, 4, 0], normal: [0, 1, 0] },
    seed: original,
  },
], { contactTolerance: 1e-7 });
```

This returns `Associated / ToleratedConnection`, retaining three different
points. The original anchor still has `NotCertified` plane incidence. The curve
sample is explicitly a sample, and the plane projection is explicitly a foot;
neither claims to be an intersection root.

Event descriptions:

| Type | Additional fields | Construction / provenance |
| --- | --- | --- |
| `vertex` | `source` | Retains an original `SourceVertex` and its words. |
| `curve-sample` | `body`, `edge`, `curve`, `interval`, `parameter`, `sourceTolerance` | Evaluates the supplied native parameter in Bend. |
| `plane-projection` | `body`, `face`, `plane`, `seed` | Creates a separate foot, preserving the seed, displacement and both incidence records. |
| `curve-plane-hit` | `body`, `edge`, `curve`, `interval`, `planeBody`, `face`, `plane`, `hit`, `tolerance`, `sourceTolerance` | Calls the existing curve/plane solver and selects a genuine resolved hit. Preserves parameter, multiplicity, position, resolution and certificates. |

Every event requires an unsigned 32-bit `id`. A missing interval means an
untrimmed curve; explicit intervals remain increasing native ranges. A missing
source allowance means zero. A missing hit index means the first hit. The root
event's intersection tolerance uses the existing curve/plane defaults; this does
not provide a default junction contact policy.

`associateJunction(anchor, events, policy)` returns:

- `Associated{junction}`: retained anchor, events, all pair gaps, anchor/plane
  checks, diameter, policy and connection mode.
- `Separated{witness}`: a definite out-of-cap gap with its actual distance and cap.
- `Unresolved{reason}`: construction budget, diameter threshold, parameter
  conflict or the unchanged underlying curve-resolution issue.
- `Rejected{reason}`: invalid input, empty event list, duplicate/conflicting
  references or a requested hit that does not exist.

No partial successful junction is returned for unresolved input. Coincident or
disjoint curve results have no isolated hit to select. No sample fallback can
replace an unresolved root. `requireAssociatedJunction` raises an explicit
capability error for every non-associated result.

`chooseJunctionAnchor(anchors, events, policy)` returns `Unique`, `NoneFound`,
`UnresolvedSelection` or `RejectedSelection`. Two admissible anchors cause
`CompetingAnchors`; even one admissible anchor plus an uncertain competitor
causes `IndeterminateAnchor`. The function never picks the nearest candidate.
Duplicate anchor identities are rejected.

`endpointJunctionProposal(preparedEdgeSource, sourceBody, planeReference,
{atStart, sampleId, projectionId})` consumes an `EdgeSource` already produced by
the finite-edge module. Its plane reference has `{body, face, plane}`. Bend
selects the original endpoint and the native parameter according to edge sense,
or recovers the actual seam parameter for a full periodic edge. The returned
`Proposal{anchor, specs}` contains a curve sample and a separate plane projection;
call `associateJunction` explicitly to evaluate it. It is not an intersection
solver. The builder and other prepared helpers assume validated preparation
outputs. The validating native entrypoints for raw descriptions are `associate`
and `choose_anchor`.

## Frozen P10 evidence and limits

`node scripts/diagnose-junction.mjs` rebuilds the frozen P10 body and actual F32
box, then re-evaluates all 42 unresolved finite-edge pairs selected from
`out/edge-plane/diagnostic.json`. It verifies the frozen hashes, original
unresolved reasons, retained endpoints and stable relevant implementation hashes.
The resulting `out/junction/diagnostic.json` retains the native proposals,
associations, source records, full F32x2 words and independent double checks.

| Observation under explicit `contactTolerance: 1e-7` mm | Count |
| --- | ---: |
| Original unresolved finite-edge pairs, still unresolved | 42 |
| Endpoint ambiguity pairs | 21 |
| Near-parallel / near-coincident interval pairs | 21 |
| Both endpoint proposals for every pair | 84 |
| Accepted tolerated point connections | 63 |
| Clearly separated other endpoints | 21 |
| Further unresolved / rejected proposals | 0 / 0 |
| Accepted anchors with exact plane-incidence certificate | 0 |
| Accepted analytic endpoint samples with exact plane-incidence certificate | 0 |

The maximum accepted diameter is `6.344983322878629e-11` mm. The maximum pair
guard is `4.232599925733773e-10` mm, below the declared cap. Independent double
projection comparison measured zero discrepancy; the maximum pair-distance
discrepancy was `4.440892098500626e-16` mm. These are observations for this input,
not proofs of the general guard.

The 21 interval cases still need an explicit interval-band/overlap contract.
Endpoint associations do not prove coincidence over an interval or create
ordered overlap events. Even the 21 endpoint cases remain unresolved in the
geometric edge/plane API: a tolerated connection is a separate relation.
Clipping also needs trimmed-face incidence, event ordering, face splitting,
orientation and manifold closure. This diagnostic produces no clipped solid
and does not complete r10b's first Boolean.

Focused validation: `node --test test/junction.test.mjs` covers 14 cases,
including complete-diameter rejection, threshold evidence, ambiguous anchors,
conflicting references, native parameter protection, independent projections
and distances, a BigInt-confirmed rounded-zero adversary, unavailable expansion
exponents, root failure propagation and actual periodic seam selection.
`.tools/bend-2.0.25/bin/bend kernel/junction.bend` checks the native module.
