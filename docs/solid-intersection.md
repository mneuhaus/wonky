# Native intersection with a convex planar tool

`kernel/ports/solid-intersection.bend` applies every outward halfspace of a
validated convex planar tool to the source. The source may be concave and an
intermediate result may have multiple connected components. The native driver
chooses the valid tool operand, composes provenance, retains explicit curve
intervals and discards the whole operation if any subsequent plane fails.

The production FeatureScript/Python Boolean dispatcher now uses this path for
planar intersections outside the existing convex/convex path. This does not add
planar union/difference or production support for the general curved r10b case.
The separate native API also exercises the bounded full-cylinder hybrid branch.

```sh
node bin/wonky.mjs examples/concave-intersection.fs --format step --out out/concave-intersection
node --test test/solid-intersection.test.mjs
```

The ordinary FeatureScript example creates an L-profile, extrudes it and
intersects it twice with cuboids. Its final volume is 40 mm³ and its bounds are
`[1,0,1]` to `[7,6,3]` mm. The geometry, measurements and clipping run in Bend.
Host code serializes, decodes, validates and attaches operation-level identity.

## Closure, identity and failure contract

Native output is `Bodies{bodies}` or `Unresolved{reason,tool,face}`. An empty list
is an accepted regularized empty intersection. Unresolved never carries an
earlier successful body or an incomplete shell. Tool validity, including
positive volume, is checked before applying its halfspaces; sources are
validated by their selected constructor before an empty shortcut.

Every output face refers to an original `(operand,index)` pair. Every edge
refers either to an original edge or to the two original operand faces whose
intersection produced it. The references are composed after every plane and
for every component, including edges formed by two tool faces. They are not
indices into an inaccessible intermediate body. This is operation provenance,
not a claim that all split/merge correspondences across model revisions are
already resolved.

After an exact-contact step, the OCCT adaptation can return explicit line
intervals. Subsequent transverse steps route to the interval-aware OCCT
constructor. They do not discard the intervals to satisfy Truck's narrower
input contract. The SolveSpace midpoint audit remains an additional planar
check, not a complete whole-edge embedding proof.

The source must satisfy the documented embedded-shell preconditions of its
constructor. Neither the driver nor its local audits constitute a general
global self-intersection validator. General curved clipping remains separate in
[curved-clip.md](curved-clip.md).

## Evidence and limits

Eight focused tests cover concave intersection, operand order, disconnected
output, subsequent planes, contact-to-transverse handoff, malformed/zero-volume
inputs, late failure, FeatureScript execution and rigid transformation. A prior
clipped convex body can also serve as the tool with its explicit line domains;
incorrect intervals are rejected by the interval-aware native validator.
Nine exports passed the strengthened independent exact CurveOnSurface check:
`out/boolean-ports/solid-intersection/step-validation.json`.

The independent review found and reproduced two defects: zero-volume tools
could be accepted, and explicit intervals could prevent subsequent transverse
cuts. Both were fixed and added to regression tests. Evidence is retained under
`out/boolean-ports/solid-intersection-review/`.

Planar result volume and tight vertex bounds are computed in Bend. Arbitrary
curved mass properties or bounds are not inferred from boundary vertices.
Export validity for oblique cylindrical boundaries remains subject to the
[stricter STEP checks](step-validation.md).
