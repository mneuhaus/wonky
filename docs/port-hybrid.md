# Initial native hybrid of the reference adaptations

`kernel/ports/hybrid.bend` combines specific behaviors observed in
`out/boolean-ports/baseline/report.json`. It remains an experimental bounded
halfspace constructor. Its planar branch is now used by the
[convex-tool solid intersection](solid-intersection.md) in FeatureScript.
It does not yet solve the general imported curved r10b operation.

1. Classify represented source-vertex contact with the native filtered/exact
   predicate module. This routing decision preserves the original words; it does
   not change the individual constructors' tolerance or output validity rules.
2. For transverse planar input, use Truck's graph construction, which was faster
   on the measured shared successful cases and supports disconnected output.
3. For exact source-vertex contact, use OCCT's shared-event construction, which
   handles the tested vertex/edge cases and supports separate components.
4. Use the SolveSpace UV-BSP classifier as an additional native check that each
   newly constructed cut edge's midpoint belongs to its original trimmed face.
   This reuses the adapted classifier directly, not the entire SolveSpace clip.
5. Explicit line intervals also route to OCCT, including transverse steps after
   an exact-contact cut. The intervals are retained and validated.
6. Full cylindrical bands route to the separate analytic Truck subset. Its
   whole-conic/periodic-topology checks replace the planar midpoint audit.
   Rim-crossing cuts, contacts and arbitrary imported curved bodies remain
   unsupported by this branch.

The midpoint check is an additional consistency check, not a whole-edge error
certificate or a complete global embedding proof. The selected constructor must
already return a complete validated closed B-rep. Outside or ambiguous BSP results
reject the whole output. No result fragments are combined, failed operations
are not skipped, and no tolerance or approximation fallback is introduced.

All source-derived module licenses still apply, including the SolveSpace GPLv3+
BSP code, OCCT LGPL/exception material and Truck Apache-2.0 material; see their
individual source mappings. This local comparison does not settle distribution
packaging or grant a new license to the upstream-derived files.

`node --test test/boolean-ports.test.mjs` covers shared construction,
contact/component selection, a concave-face BSP control, analytic cylindrical
caps, chaining, source immutability and malformed/zero-volume input. The current
seven shared tests passed. The solid-intersection tests and strict exports add
the production planar-chain checks. The exact predicates and full-cylinder
subset have independent reviews under `out/boolean-ports/`. The refreshed
source-stable comparison in `out/boolean-ports/hybrid-pcurves/report.json`
records 20 strictly valid nonempty hybrid exports, two empty results, ten
unresolved cases, five correct invalid-input rejections and no invalid exports.
The oblique full-band case now passes the
[strengthened CurveOnSurface validation](step-validation.md) with explicit
native Bend pcurves. This does not extend the hybrid to arbitrary imported
curved shells. This correctness run is not used for performance conclusions.
