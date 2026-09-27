# Prism region Boolean

`kernel/prism-boolean.bend` (entry `boolean(a, b, op)`), host
`src/prism-boolean.mjs`, dispatch `src/boolean.mjs` `last()`. Task 12a of
local design note; it closes KS04.

## What it does

Two operands that are right prisms along the same coordinate axis, over
line/arc profiles (cylinders included), are combined as a 2D region Boolean of
their profiles and extruded again between the result's cap planes. The result
is an exact analytic B-rep (planes and cylinders), its volume is the closed-form
profile area (lines and circular arcs) times the cap distance.

It is an exact arm. It sits in `booleanInBend` inside `last()`, after every
older exact arm has declined and before the hybrid Boolean, and it runs under
both Boolean policies (`hybrid-last` and `exact-only`). It either builds or
declines with a code; a decline hands the operation on unchanged (to the hybrid,
or to the exact arm's refusal under `exact-only`). Operations that an older exact
arm builds never reach it, so their results do not change.

## Recognition (exact, on the input words)

- the prism axis is a coordinate axis exactly (tried z, then y, then x), so the
  profile coordinates are the input words themselves, never a rounded
  projection;
- every face is a cap (a plane whose normal is that axis) or a vertical plane
  or cylinder; there are exactly two caps, one facing down below one facing up;
- every vertex lies on one of the two cap planes; cap edges are lines or circles
  about the axis; a cap has one counterclockwise outer loop and clockwise holes.

The cap planes must fit the operation: UNION equal slabs; SUBTRACTION the tool
spans the target's slab; INTERSECTION one spans the other.

## The 2D Boolean

- Coincidence of carriers, tangency (a discriminant exactly zero) and the
  incidence of a vertex with the other profile's carrier are decided exactly
  (robust-predicates.bend `Big`; every F32 word is an integer times 2^-149).
  A vertex also lies on a carrier when a segment of its own profile ending at
  it has exactly that carrier.
- Transversal crossings are computed in F32x2 and used as they are.
- Pieces are classified by the other profile's winding number at their
  midpoint, certified by the midpoint's distance to that profile.
- A box prefilter skips segment pairs whose boxes are further apart than twice
  the tangent resolution (no crossing, no near tangency possible).

Tolerances (relative to max(1 mm, the profile scale)) are used only to decline,
never to move or merge geometry: snap 1e-8, tangent 1e-5, classify 1e-9.

## Decline codes

| code | meaning |
|---|---|
| 1 | an operand face is not a plane or a cylinder |
| 2 | an operand face is neither a cap nor vertical along any coordinate axis |
| 3 | an operand has not exactly two cap faces |
| 4 | an operand vertex lies off both cap planes |
| 5 | a cap edge is not a line or a circle about the axis, or is degenerate |
| 6 | a cap face could not be read |
| 7 | a cap face is not one counterclockwise outer loop with clockwise holes |
| 10 | the cap planes do not fit the operation |
| 20 | a crossing lies next to a vertex it is not exactly incident with |
| 21 | two crossings closer than the tangent resolution (near tangency) |
| 22 | two split points of a segment closer than the snap resolution |
| 23 | a piece midpoint too close to the other profile to classify |
| 24 | the winding number at a piece midpoint is not 0 or 1 |
| 25 | pieces do not meet two by two at every vertex (non-manifold touch) |
| 26 | the kept pieces do not close into loops |
| 27 | a result loop has (near) zero area |
| 28 | a hole lies in no outer loop |

When the three axes decline with different codes, the code that got furthest
is reported (`further`).

## Evidence and removed material

`body.construction`: `method` = `native Bend prism region Boolean`, `axis`,
`slabMm`, `profileAreaMm2`, `faceOrigins` (per face: the operand faces it
comes from), `toolBoundaryKept`, `admission`, `tolerances`. A side face names
the operand whose profile piece it extrudes; a piece both profiles share is
kept from operand 0. In a SUBTRACTION a side face from operand 1 is the tool's
boundary inside the target, so material was removed exactly when
`toolBoundaryKept` is true (src/library.mjs `removedMaterial`).

## Limits

- Only coordinate-axis prisms (an oblique common axis declines with code 2).
- One cap face per side: a planar-arm result whose cap is split into coplanar
  faces (KT6's a ∪ b) declines with code 3/4 and keeps its old route.
- KS04: the outline union (disc ∪ bar ∪ tip, tangent sides) and the bore are
  built here; recover refuses the tangent contact by design.
