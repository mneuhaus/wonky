# Topology identity foundation

Identity is additive metadata on the existing B-rep schema. Geometry construction
and validation are unchanged. `kernel/identity.bend` defines the key, parent
lineage, entity and identity-set types and derives all origin/instance keys.
`src/identity.mjs` marshals these types and records geometry/source evidence.

This establishes a supported identity contract; it does **not** solve general
topological naming across Boolean split/merge events or arbitrary model edits.

## Public metadata

`body.name` remains a display label. Changing it never changes an identity.
`body.id` remains the existing frontend body ID. `body.identity` has this form:

```javascript
{
  schema: 'wonky-topology-identity/1',
  originId: 'wk1/...',       // Logical generating entity, independent of label.
  instanceId: 'wk1/...',     // One occurrence of that origin.
  revision: 'sha256:...',    // Exact serialized geometry revision.
  kind: 'body',
  role: 'frustum/solid',
  stability: 'semantic',   // 'semantic', 'source', or 'revision-local'.
  operationId: 'model/extrusion',
  operation: {
    id: 'model/extrusion',
    type: 'circular-frustum',
    source: { file: null, sha256: null, span: null },
    parameters: { /* supplied geometric parameters */ },
    parentOperations: []
  },
  lineage: {
    relation: 'created',
    matching: 'semantic-role',
    parents: []
  },
  topology: {
    vertices: [/* entity records */],
    edges: [/* entity records */],
    faces: [/* entity records */]
  }
}
```

Topology entries carry `originId`, `instanceId`, `revision`, `kind`, `role`,
`stability`, `operationId` and `lineage`. Their array positions locate the
corresponding current B-rep entries; **the positions are not persistent IDs**.
The enclosing body's `operation` provides source/parameter details for all its
entries. Parent references contain origin ID, instance ID, geometry revision
and generating operation ID. Transform and Boolean body lineage also records
the available previous operations in `lineage.history`.

Imported entities additionally carry `source` with the exact external
`entityId`, namespace, document, element, microversion and snapshot SHA-256 where
known. This is separate from the generating operation's code `source`.

Keys are opaque framed strings. Bend length-prefixes every component, including
namespace, operation ID, entity kind, semantic/source role and parent identity.
Punctuation and Unicode cannot alias different component sequences. Geometry
hashes are used only for `revision` and to scope explicitly revision-local
references; they are never substituted for persistent logical identity.
An ancestry component (the parents' origins or instances, or the instance a
rigid copy came from) longer than 512 characters is replaced by `sha256:` and the
SHA-256 of its UTF-8 bytes (`lineage` in `kernel/identity.bend`). This hashes key
text, not geometry, and a full component never starts with `s`, so the two forms
cannot alias. Without it every key nested all ancestor keys: in a chain of 23
Booleans a body's instance key was 74,616 characters and one 104-face body held
198 MB of identity. Keys without such ancestry (primitives, imports) are unchanged.

The revision fingerprints vertices, edges, faces and geometry representation.
It excludes names, appearance, source maps, validation/debug data and identity
metadata. Identical geometry can therefore have different origins/occurrences;
a dimension change can preserve an origin and occurrence but change revision.
Reordered serialization can change revision without changing preserved source
IDs. This fingerprint is not a geometry-equivalence test.

## Supported stability

| Construction | Identity guarantee |
| --- | --- |
| Circular cylinder/frustum | Semantic start/end caps, lateral face, start/end rims, seam edge and seam vertices, tied to the same generating operation. |
| Explicit canonical box | Semantic local X/Y minimum/maximum roles and start/end sweep roles for all vertices, edges and faces. |
| Generic polygon extrusion | Semantic start/end caps and solid; anonymous profile vertices, edges and side faces are revision-local. |
| Frozen import | Original body/face/edge/vertex IDs preserved in a namespace containing the recorded source revision. |
| Synthetic import seams | Revision-local generated entities; no invented original source ID. |
| Rigid transform/clone | Origin IDs and exact topology correspondence preserved; new occurrence IDs and parent lineage distinguish copies. |
| Boolean results | Both input ancestries preserved; output components and topology remain revision-local. |

Semantic identity assumes the same namespace, generating operation identity,
role contract and parent identities. Harmless dimension/label edits preserve
these identities. Reassigning an operation ID to an unrelated operation is not
a supported continuity guarantee. Frontends must supply stable operation IDs;
inserting operations into a frontend that uses sequential IDs can change them.

Box semantics require an explicitly declared canonical four-corner rectangle
in sketch coordinates: `(xmin,ymin)`, `(xmax,ymin)`, `(xmax,ymax)`,
`(xmin,ymax)`. Bend verifies that declaration. An anonymous four-point polygon
is not silently treated as a named box. Source import namespaces default to the
known Onshape document, element and microversion. Missing qualification is
recorded as unknown and all such imported identities remain revision-local.
Cross-microversion source matching is not claimed.

Boolean lineage declares `matching: 'unsupported-split-merge-correspondence'`
and includes an explicit ambiguity description. No input face ID is silently
reused for a split, merged or newly generated output face. Even a currently
single-body Boolean result carries this conservative policy.

## Supplying source and primitive context

Existing wrapper calls remain valid. Each accepts an optional **last**
`identityContext` argument after its original arguments:

```javascript
{
  namespace: 'project/model',        // Default: 'model'.
  operationId: 'feature/base',       // Default: wrapper id.
  occurrenceId: 'assembly/left',     // Default: wrapper id.
  primitive: 'box',                 // Only on extrudeInBend; omit for generic profiles.
  sourceNamespace: 'frozen-input',   // Optional explicit import namespace.
  source: {
    file: 'part.fs',
    sha256: 'verified-source-sha256',
    span: { line: 12, column: 4 },
    // A verified callStack or other explicit source evidence can be retained.
  },
  parameters: { widthMm: 20 }        // Optional; otherwise geometric inputs.
}
```

For the known Box/fCuboid call path:

```javascript
extrudeInBend(kernel, id, points, plane, delta, [0, 0, 0],
  { primitive: 'box', source, parameters });
```

The complete signatures are:

```text
extrudeInBend(kernel, id, points, plane, delta, startOffset, identityContext)
circularFrustumInBend(kernel, id, first, second, delta, startOffset, identityContext)
importOnshapeBody(kernel, source, id, provenance, identityContext)
transformInBend(kernel, body, id, rows, offset, identityContext)
transformAnalytic(kernel, body, id, rows, offset, identityContext)
booleanInBend(kernel, a, b, operation, id, loc, identityContext)
```

Unknown file/hash/span values are `null`. No end position is invented from a
start-only parser location. `booleanInBend` can preserve its existing `loc`
directly; other wrappers require the frontend to supply source context or attach
verified source evidence afterward. Source instrumentation is independent of
identity derivation and does not alter the geometry revision. Parameter/source
values are copied so later caller mutation cannot rewrite recorded evidence.

## References and explicit matching outcomes

```javascript
import { topologyReference, matchTopologyReference } from './src/identity.mjs';

const reference = topologyReference(body, 'face', faceIndex, { persistent: true });
const outcome = matchTopologyReference(nextModel.bodies, reference);
```

`persistent: true` rejects revision-local entities. Ordinary references include
their geometry revision and can address revision-local entities within that
revision. Matching returns `matched`, `missing`, `ambiguous`, or `unsupported`;
only `matched` includes one selected body/kind/current index. Changed revisions
cannot make revision-local references masquerade as persistent ones.

The default matches both origin and occurrence. `{ byOrigin: true }` deliberately
searches copies of an origin; multiple copies return `ambiguous` with all
candidates. There is no proximity, array-index or geometry-hash fallback.
Missing legacy metadata is treated as unattributed, revision-local geometry
when it enters a transform/Boolean operation.

## Checks

```sh
.tools/bend-2.0.25/bin/bend kernel/identity.bend
node --test test/identity.test.mjs
node --test test/kernel.test.mjs test/analytic.test.mjs test/boolean.test.mjs test/python*.test.mjs
npm test
```

Tests cover key framing, dimension/label stability, distinct namespace/operation/
occurrence domains, frozen source IDs under topology-array reordering, exact
transform ancestry, Boolean ambiguity, revision-local rejection, source slots,
and unchanged STEP output. This metadata layer does not modify exported STEP
geometry; existing independent geometry acceptance tests remain applicable.
