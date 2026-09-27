# One closed profile from FeatureScript line segments

`skLineSegment` and `skSolve` now assemble one simple closed profile from
independently ordered and oriented straight segments. Endpoint matching, graph
assembly, canonical ordering and geometric acceptance execute in
`kernel/sketch-lines.bend`. The FeatureScript frontend serializes coordinates and
retains the original entity references.

```fs
var sketch = newSketchOnPlane(context, id + "profile", {
    "sketchPlane" : plane(vector(0, 0, 0) * millimeter,
                          vector(0, 0, 1), vector(1, 0, 0))
});
skLineSegment(sketch, "slope", {
    "start" : vector(0, 2.1) * millimeter,
    "end" : vector(2.1, 0) * millimeter
});
skLineSegment(sketch, "entry", {
    "start" : vector(0, 0) * millimeter,
    "end" : vector(2.1, 0) * millimeter
});
skLineSegment(sketch, "axis", {
    "start" : vector(0, 2.1) * millimeter,
    "end" : vector(0, 0) * millimeter
});
skSolve(sketch);
opExtrude(context, id + "extrusion", {
    "entities" : qSketchRegion(id + "profile", false),
    "direction" : vector(0, 0, 1),
    "endBound" : BoundingType.BLIND,
    "endDepth" : 5 * millimeter
});
```

The complete input is [examples/line-sketch.fs](../examples/line-sketch.fs).
This is a bounded profile assembler, not a general sketch constraint solver.
`skArc`, constraints and `opRevolve` remain explicit unsupported capabilities.
In particular, supporting the three relief-profile segments in the frozen r10b
source does not establish support for its following revolve or the complete
`singleStepR10b` feature.

## Accepted input and topology

- Exactly 3–256 straight segments, each with a unique nonempty FeatureScript
  entity ID, two 2D length vectors, and optional `construction: false`.
- Finite, representable sketch coordinates within ±10,000 mm. The native input
  must contain normalized Real words; nonzero z coordinates are rejected.
- Exact represented endpoint equality. Every endpoint must have degree two,
  and one closed walk must consume every segment.
- No duplicate or reversed duplicate edges, zero or unresolved short edges,
  collinear corners, self-intersections, nonadjacent touching, holes, nested
  loops, additional regions, construction geometry or mixed circle/rectangle/
  polyline profile modes.

Native topology compares the original SI binary64 words as well as the
millimetre F32x2 prefix and a separate serialized remainder. Two different
quantities can collide even before F32x2 serialization: both
`1.1000000000000085 * meter` and `1.1000000000000087 * meter` round to
`1100.0000000000086` mm. Retaining their original SI words prevents an
unintended join. Distinct millimetre numbers with identical F32x2 prefixes,
such as `1.1` and `1.1000000000000003`, also remain distinct. Positive and
negative zero represent the same endpoint, while the original sign bits are
retained. There is no epsilon welding or inferred closure.

Bend starts at the lexicographically least represented millimetre endpoint and
returns a counterclockwise walk. It records whether each use follows or reverses
its original segment. Reordering input or reversing individual segments does
not change the canonical geometry or resulting solid topology IDs. Entity IDs
remain original provenance; they do not determine the canonical geometry order.

## Numeric boundary

The frontend retains evaluated FeatureScript `Quantity.value` numbers in SI
metres and serializes their binary64 representations without conversion into
four U32 words per 2D point. The converted millimetre numbers are separately
serialized into F32x2 prefixes and remainder Real words. Inputs which cannot be
represented fail explicitly. A native check requires that adding a remainder
does not change the coordinate prefix. Remainders and original SI words are
reference data; they are never coordinate displacements used to repair a
profile.

The native point contract is:

```text
Point {
  value: Vec3<Real>,       // millimetre F32x2 prefix; z = 0
  remainder: Vec3<Real>,   // remaining millimetre serialization bits; z = 0
  source: SourcePoint { x_high: U32, x_low: U32, y_high: U32, y_low: U32 }
}
```

Each `high`/`low` pair contains the most/least significant 32 bits of the
original SI binary64 value. Native callers must supply the original source
words and their corresponding millimetre representation. Bend validates the
SI words as finite and within ±10 metres, and the millimetre words separately;
it does not decode the binary64 source to recompute unit conversion. Equality
requires both representations to agree. The source words provide identity;
the millimetre prefix provides geometric arithmetic.

Source geometric checks use the millimetre F32x2 prefix with a guard of approximately
`1e-12 * max(1, maximum absolute coordinate)`. They check edge lengths, corner
cross products, conservative separation of nonadjacent segments and translated
shoelace area relative to perimeter. These are operational numeric guards,
not interval-arithmetic certificates.

The accepted profile is explicitly converted to the existing F32 extrusion
boundary. Distinct vertices must remain distinct, and the quantized polygon is
checked again with:

```text
max(1e-5 mm, max(1, maximum absolute coordinate in mm) * 2^-20)
```

Source and quantized orientation must agree. Any collapse or unresolved shape
fails rather than changing connectivity. The solved result retains the source
area estimate, quantized area, maximum estimated vertex quantization error and
linear resolution. The resulting B-rep and STEP contain straight edges and
planar faces; no curve is replaced by a polygonal approximation.

## Retained references and failure behavior

Extruded bodies carry `sketchProfile` with schema `wonky-line-sketch/1`:

| Field | Meaning |
| --- | --- |
| `sketchId` | Original modeling sketch ID |
| `segments` | Original entity IDs, evaluated `startMeters`/`endMeters` before conversion, `startMm`/`endMm`, source line and column, in insertion order |
| `profileUses` | Canonical 2D walk: original `entityId`, `sourceIndex`, and original-direction `forward` flag |
| `native` | Complete Bend `Solved` result, including unchanged source segments, original SI U32 words, mm prefix/remainder words, oriented uses and numeric diagnostics |

The use order describes the 2D profile. It does not assert correspondence to
final solid edge indices, which also include cap and longitudinal edges and may
change orientation for a negative extrusion.

Source tracing records segment, solve and extrusion calls with source file,
hash, span and function stack through the existing tracing layer. A rejected
solve records a failed operation and produces no body. Native arrangement
rejections, unsupported mixed modes, unsupported construction and coordinate
serialization failures are `UnsupportedFeatureError` paths, including inside
`try silent`. Ordinary malformed call arguments still use existing
FeatureScript validation errors. A solved sketch cannot be modified or solved
again.

## Validation evidence

The focused test file contains 35 tests, including all 48 triangle insertion/
direction variants, concave profiles, the 256-segment boundary, invalid native
words, unit-conversion and sub-prefix endpoint collisions, native rejections and FeatureScript
failure behavior. Another 48 FeatureScript extrusions check stable body
geometry and topology IDs under insertion/direction changes in both positive
and negative sweeps. Together with the existing kernel and source-map tests,
all 68 tests pass:

```sh
node --test test/sketch-lines.test.mjs test/kernel.test.mjs test/source-map.test.mjs
.tools/bend-2.0.25/bin/bend kernel/sketch-lines.bend
node --check src/library.mjs
node bin/wonky.mjs examples/line-sketch.fs --format step --out out/sketch-lines/line-sketch
uv run scripts/validate-step.py out/sketch-lines/line-sketch
```

The exported triangle has F32 side length `2.0999999046325684` mm and depth
5 mm. The independent STEP reader reports one valid solid, 6 vertices, 9 edges,
5 faces and volume `11.02499899864199` mm³, agreeing with the kernel. It added no
seams or boundary vertices. OpenCascade only reads and validates the Bend
export; it does not construct production geometry.

Local evidence is in `out/sketch-lines/tests.tap`, `bend-check.txt`,
`step-validation.json`, `evidence.json`, and the `.step`/`.brep.json` pair.
The lead integration run owns the full project suite and benchmarks.
