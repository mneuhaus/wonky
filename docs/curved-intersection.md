# Curved convex-tool intersection

The production `INTERSECTION` path can intersect an admitted closed plane/cylinder
B-rep with a validated convex planar tool. All source/tool selection, clipping,
contact handling, component assembly, domain decisions, provenance composition,
incidence audits and nominal volume calculations run in Bend. This does not add
general union or subtraction, arbitrary curved tools, fillets or toroidal faces.

`kernel/ports/curved-intersection.bend` validates the tool using the existing native
convex-tool admission. It runs all cutter planes over every current component.
A later failure returns no result solids, even if earlier cuts or components
succeeded. Face and edge origins always refer to the two original operands.

## Explicit policy

The default policy is strict. A deliberately tolerated run is selected before
evaluation, without changing FeatureScript:

```sh
node bin/wonky.mjs fixtures/r10b/r10b.fs --feature singleStepR10b \
  --curved-contacts tolerated-regularized --contact-cap-mm 1e-7 --check
```

The API equivalent is `build(source, { modelingPolicy: {
curvedContacts: 'tolerated-regularized', contactCapMm: 1e-7 } })`.
The same options are available in `scripts/check-acceptance.mjs`.
These commands still fail on subsequent unsupported operations; they are not
a claim of completed r10b evaluation.

The preselected policy allows only the documented contact constructor after
an `AmbiguousContact` or `UnsupportedArrangement` result from the transverse
constructor. Its rejection is retained in the native step. No failure changes
the selected policy or cap. Contact regularization is not reported as an
exact-zero classification. See [the contact implementation](curved-contact.md).

## Budgets and serialization

Every result has a separate `constructionBudget` carrying the original source
ceiling, including its native F32x2 words. `classificationInput` preserves that
ceiling on subsequent operations. Neither `vertexTolerancesMm`, the STEP reader
allowance, nor a requested `inputTolerance` may increase it. An attempt to pass
a larger input tolerance is an error. Each cutter recomputes signs and incidence
on the actual current geometry under that original ceiling.

`src/curved-intersection.mjs` audits every returned component before publication.
It serializes finite intervals and complete closed circles/ellipses, preserving
their native topology. It does not normalize nonunit source lines to hide a
host/export incompatibility. Native nominal volume is reported; tight curved
bounds remain unevaluated (`null`).

The legacy analytic reader validation uses a minimum 0.0003 mm allowance. This
is recorded as an export/reader allowance separately from the construction
budget. The generalized [cylinder PCurves](step-cylinder-pcurves.md) use their
own explicit native approximation bounds, and are independently validated.

## Historical frames and ancestry

`model.operationEvidence` retains successful Boolean records even when a result
is Empty or is later deleted. Each curved operation records its selected policy,
original ceiling, native tolerance, every attempted cutter and component, native
contact ledgers and final component audits. An unsupported operation throws and
retains diagnostic evidence; no partial result becomes a successful model.

Each record identifies an input coordinate frame and snapshots both operands'
body IDs, geometry revisions and available topology identities. Each native step
contains cutter origin/normal, immediate source vertices and source-face/edge
maps into the original operands. Contact-ledger IDs remain **local to that step**:
ledger source `body=0` and cutter `body=1, face=0` are resolved through the step's
source maps and `cut`, not interpreted as outer operand numbers. A result's
`construction.faceOrigins` and `edgeOrigins` are already outer operand references.
Generated periodic seams use `SurfaceSeam{face: FaceRef}`; they are not intersection
curves of the carrier with the cutter. The same distinction survives later steps.
No stable split/merge correspondence across revisions is inferred.

`body.operationHistory` references its generating evidence plus a chronological
`transformChain`. Rigid transforms append their operation ID, matrix and offset;
historical cutter coordinates and witnesses remain untouched. A later Boolean
records each operand's history by reference (`wonky-operation-evidence/2`): per
earlier operation its summary `{schema, operationId, operation, method, status}` and
the operand's transform chain since then; `historyEvidence(model, entry)`
(src/construction-history.mjs) resolves the full evidence from the model-level
`operationEvidence` list; `serializeModel` adds every referenced evidence the
producer's list lacks (Python and wonky-compare models have no list), reached
through the in-memory link each reference keeps. Traversing it composes the child's transforms with the
parent frame. (Evidence /1 nested full copies, quadratic in a Boolean chain: 381 MB
for the R20 tray.) brep.json (`serializeModel`) names each distinct input identity
once in `model.inputIdentities`, keyed by geometry revision (`#2`, `#3` when
different identities share one), and evidence inputs carry `identityRef`. The
table value is the index of the identity in `model.identityPool`
(`wonky-identity-pool/1`): every distinct JSON value once, children first, with
`wk1/` keys and framed part lists split into their parts, so an entity's parent keys
and the origin inside its instance are shared, not repeated. Every snapshot of a
growing body is still new (a Boolean re-identifies each entity), so the pool grows
with steps x entities, about 25 times more slowly: a plate 120 holes deep holds 7.4 MB
of pool instead of 182.7 MB of identity objects, and 200 chained holes write
36 MB (they exceeded V8's string limit before). `inputIdentity(model, input)`
reads inline, pool and pre-pool tables. Empty results preserve the record at model
level.

## Checks

- `test/curved-intersection.test.mjs`: native selection, full actual P10/box input,
  strict and explicit contact policies, operand swaps, original ancestry,
  multicomponent continuation, fixed budgets, late failure and Empty.
- `test/curved-boolean-integration.test.mjs`: public Boolean decoding, subsequent
  rigid transforms/cuts, JSON history, Empty and rejection of damaged geometry
  despite an enlarged reader allowance.
- `test/modeling-policy.test.mjs`: API/CLI/frozen-context policy propagation,
  atomic publication and evidence retained on success, Empty and failure.

The current full acceptance result and independently validated exports are linked
from the project README. Focused checks do not replace full r10b acceptance.
