# Contact integration contract

Lead decision, 22 September 2026. This is the contract for the next integration;
it is not a claim that FeatureScript currently supports curved contacts.
The construction design and measured P10 contact witnesses are retained in
`out/boolean-ports/contact-review/proposal.md` and `evidence.json`.

## Native operation

The separate `curved-contact.bend` entrypoint takes the source solid, edge
domains, cutter, query tolerance, original source budget and an explicit contact
cap. It returns an attempt containing `P.Result`, the policy and a contact ledger.
Neither the query tolerance nor the input allowance implicitly selects a cap.
The strict section and transverse curved-clip entrypoints keep their semantics.

The first slice handles planar linear contact regions in otherwise supported
analytic solids. Curved faces must be proved separated from the contact region.
The source audit precedes every retained or empty shortcut. Rejected components
invalidate the whole operation. Source representatives and supports remain
unchanged; cap incidence must fit the original source budget plus the operational
numeric guard. The contact cap is never added to this construction allowance.

P10's nearby vertices have exact negative signs. Treating them as contacts is
an explicitly tolerated regularization of the represented coordinates, not an
exact-zero result. The ledger retains both the exact signs and the tolerated
decisions, including their witnesses and output identity maps.

## Host and sequence admission

Before production FeatureScript dispatch can call this operation:

1. Native focused checks, repeated cuts and the independent STEP checks must
   pass for its admitted cases. Partial shells or wire-only results are errors.
2. The host must carry the source-budget ceiling separately from STEP export
   uncertainty and per-reader tolerance. The existing curved test exporter uses
   `max(0.0003, allowance)` as an export floor; feeding that value back through
   `classificationInput` as a new kernel budget is not permitted.
3. An explicit modeling policy must reach the operation without editing the
   frozen FeatureScript. Its selected mode and contact cap must be recorded in
   the model and acceptance report. A failed strict operation cannot silently
   retry with a larger cap or a different policy.
4. Every sequence step must preserve the inherited source-budget ceiling and
   recompute signs on the actual output geometry. A contact classification for
   one cutter is not an exact-zero certificate for the next cutter.
5. Provenance composition must relate ledger input indices to the actual input
   occurrence and output component. Ambiguous split/merge correspondence remains
   explicit. A failed later step discards all earlier result bodies atomically.
6. Transforms, patterns, serialization and later Booleans must preserve the
   policy and ledger. Historical coordinate witnesses need an identified
   operation frame and transform chain; copying coordinates without their frame
   is insufficient. `transformAnalytic` currently only retains selected known
   construction records and needs this extension before contact integration.
7. Empty results retain the operation-level ledger too. Storing all evidence
   only on surviving bodies would lose the decisions that removed material.

The original full r10b acceptance remains the integration gate. Passing an
isolated `y=4` contact or both independent P10 plane cuts is not that gate.
