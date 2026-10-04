# Boolean measure sweep

`test/rust-boolean-identities.test.mjs` builds real operands and results with
Rust. Both identities use canonical BigInt rationals. Planar measurements
publish `volumeExactMm3` (decimal integer numerator/denominator); the value
comes from the audited authoritative world boundary, including replayed
rational construction points, not the rounded projection or f64 volume.
Non-polynomial/radical measurements keep their existing certified bounds.
Explicit enclosure endpoints, or `volumeMm3 ± volumeMm3 * volumeRelBound`,
are converted from binary64 to exact rationals before any interval arithmetic.
A certified point enclosure (equal endpoints or zero radius) is exact as well.
No f64 tolerance is added. The report counts exact and enclosure checks.

There are 94 mandatory pairs and 229 pairs with
`WONKY_BOOLEAN_IDENTITY_LARGE=1`. Fixed scales are 0.005, 1 and 100; the larger
sweep adds 0.01, 0.125, 0.5, 2 and 10. Fixed seed labels 17, 41 and 73 select
precomputed dyadic offsets. Tests never consult a random source. Contacts
include shared faces, edges, vertices and coplanar overlaps. Nesting,
disjointness, thin walls and long bars are explicit generated cases.

The following routing coverage follows `analytic::boolean` and its
`family_boolean` dispatcher. Report route labels name the operand mechanism;
output certificates are counted separately. They do not pretend to be a
runtime dispatch trace. Replayed operands exercise continuation routing.

| Mechanism | Generator |
| --- | --- |
| Orthogonal exact cells | `box-*`, `seed-*` |
| General rational plane arrangement | `convex-*`, `different-axis-*`, `frame-*` |
| General model Boolean (concave leaves) | `concave-*` |
| Exact rational placement plus plane arrangement | `rational-345-*`, `rational-51213-*` |
| Coaxial axial profile | `coaxial-*` |
| Parallel cylinder arrangement, separation/contact | `parallel-*`, `cylinder-contact-*`, `cylinder-disjoint-*` |
| Columns, perforation/holes and shared prism arrangement | `cylinder-box-*` |
| Sphere equatorial box intersection | `sphere-halfspace-*` |
| Cylinder tee union and bicylinder intersection | `cross-cylinder-*`, `tee-unequal-*` |
| Sphere axial cylinder subtraction | `sphere-cylinder-*`, `axial-pythagorean-*` |
| Sphere lens intersection | `sphere-sphere-*` |
| Replayed holed operand/tools | `holed-recut`, `holed-prism-recut` |
| Replayed column operand | `column-recut`, `column-cylinder-recut` |
| Continued arc/line prism arrangement | `stack-recut` |
| Cylinder/box pocket subtraction | `cylinder-pocket` |
| Continued coaxial profile | `coaxial-recut` |
| Coaxial revolution Boolean | `revolve-coaxial` |
| Revolution cutter through prism | `box-revolve` |
| Polynomial-profile shared arrangement | `polynomial-boss` |

`frame-*` uses ordinary FeatureScript Pythagorean direction vectors. Its
normalized axes are binary64 construction values. For **exact** 3/5, 4/5
and 5/13, 12/13 frames, `rational-*` builds the original FeatureScript
operands, applies the existing public rational placement API, registers them
in a fresh modeling context, then executes the unchanged `opBoolean` statement
with the normal parser, interpreter and host builtins. There is no test-only
Boolean implementation or alternative modeling language.

The refusal baseline is per pair and operation, with a named reason; a newly
refusing previously built operation fails even if another operation improved.
Total refusals are also bounded by the recorded baseline. Refusals are not
identity passes. Independently available identities are checked even when the
third operation refused. Operand and measurement errors fail immediately;
only typed `opBoolean` refusals enter the baseline. An empty-result verdict
is counted as a named refusal, never replaced by an invented empty model.
`tmp/boolean-identities/report.json` contains the complete counts, certificates,
refusal reasons and violations; console output omits the large refusal map.
The `built` and `refused` counts denote operations (three attempted per pair),
while `cases` denotes operand pairs and `violations` denotes failed identities.
`completeCases` counts pairs with all three results; `refusedCases` counts pairs
with at least one named refusal. The report is saved after each completed pair
so an unexpected later construction failure does not erase earlier evidence.

`rust/wonky-ops/tests/boolean_identity_measure.rs` builds an actual overlapping
box union and verifies both exact identities plus integer closed forms. It
then drops a contributing boundary face and moves one vertex coordinate by
one binary64 ulp, bypassing topology re-audit deliberately: exact integration
must detect both. The JS checker separately rejects a one-ulp exact mismatch
and verifies closed interval endpoints. These are planted geometry defects,
not mock models presented as live results.

**No claim:** volume identities do not prove topology or shape. A wrong but
volume-preserving result can pass, including a missing face with zero signed
volume contribution. This sweep complements CAD-Acid's closed forms and
independent STEP checks.
