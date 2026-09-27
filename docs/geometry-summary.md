# Geometry overview and entity detail

`src/geometry-summary.mjs` provides a semantic overview for LLM feedback and a
revision-bound lookup into the existing B-rep. It reads stored geometry,
topology, identity and source evidence. It constructs no geometry and imports
no renderer or geometry backend.

The overview is deliberately lossy. Exact selected data remains available
through `detail()`. Short aliases are navigation handles within one immutable
model snapshot, never replacements for persistent topology identities.

## CLI

```sh
./bin/wonky-inspect.mjs out/bored-spacer.brep.json
./bin/wonky-inspect.mjs out/bored-spacer.brep.json --format json
./bin/wonky-inspect.mjs out/r10b-retained.brep.json --bodies-only
./bin/wonky-inspect.mjs out/bored-spacer.brep.json \
  --detail B1.F2 --revision <modelId-from-overview> --format json
./bin/wonky-inspect.mjs out/bored-spacer.brep.json \
  --lookup B1.E3 --revision <modelId-from-overview>
```

`node bin/wonky-inspect.mjs ...` is equivalent. `--out <file>` writes the selected
packet to a file. Summary, detail and lookup work with Node's standard library;
token measurement is optional and has its own external Python dependency.

The summary supplies aliases for every entity:

| Alias | Meaning within the recorded modelId |
| --- | --- |
| `B1` | First body. |
| `B1.F2` | Second face of the first body. |
| `B1.E3` | Third edge of the first body. |
| `B1.V4` | Fourth vertex of the first body. |

Numbering is one-based and follows the frozen B-rep arrays. These aliases can
change when a model is regenerated or reordered. Detail/lookup require the
matching full model SHA-256; missing, stale or unknown references fail. A
display-name edit also changes the exact model snapshot, even if its logical
topology identity and geometry revision remain unchanged.

## Viewer and LLM integration

```javascript
import {
  createGeometryInspector,
  formatGeometrySummary,
  formatGeometryDetail,
} from './src/geometry-summary.mjs';

const inspector = createGeometryInspector(model, {
  modelBytes: originalFileBytes,
  modelId: verifiedModelSha256,
});
const overview = inspector.summary();
const overviewText = formatGeometrySummary(overview);
const bodyOverview = inspector.summary({ includeFaces: false }); // Optional, shorter first view.
const reference = { modelId: inspector.modelId, alias: 'B1.F2' };
const target = inspector.resolve(reference);
const packet = inspector.detail(reference);
const packetText = formatGeometryDetail(packet);
```

The review server already hashes its exact model file bytes. Supplying those
same bytes makes the IDs identical. Supplied bytes must describe the supplied
model object, and an optional `modelId` must match their SHA-256. Without bytes,
the ID is the SHA-256 of `JSON.stringify(model)` and is labeled accordingly.
A formatted JSON file and its compact serialization can therefore have
different model IDs. External model IDs are never accepted without verification
against the bytes used by the inspector.

The inspector holds an isolated snapshot. Mutating the original model or a
returned packet cannot retarget its aliases. Identity metadata is checked
against the current body's geometry revision and topology counts before being
reported as authoritative. Missing legacy identity remains `null`; the exact
snapshot can still be addressed safely without inventing persistent IDs.

`resolve()` returns the viewer-compatible target fields:

```javascript
{
  modelId, alias, bodyId,
  entityType: 'face', entityIndex: 1,
  geometryRevision: 'sha256:...',
  identity: { /* existing authoritative origin/instance/revision reference */ },
  referencePolicy: 'Exact model snapshot only. Alias positions are not persistent identity.'
}
```

`detail()` additionally returns:

- The exact selected face, edge or vertex geometry, or the complete body
  geometry when a body is selected.
- Ordered face coedges and their direction; edge uses, including repeated
  periodic-seam uses; incident edge/face aliases for vertices.
- The selected entity's full available identity, lineage and external source
  identifiers, plus the body's generating operation, source and debug evidence.
- Existing body validation and, when available, imported source face
  measurements explicitly labeled as source references.
- Native Boolean face/edge ancestry as `constructionOrigin`, when recorded:
  original operand revision, entity identity and generating operation, the
  original input frame, and subsequent rigid transforms. Coplanar faces retain
  every contributor. Artificial subdivisions and periodic seams keep their
  distinct origin types. Missing operation evidence produces an unresolved
  reference; no input is guessed from the current topology array. This is
  immediate recorded ancestry, not recursive split/merge correspondence.

The viewer's **Copy selected geometry** action includes this detail packet, so
native ancestry is available in structured LLM feedback without adding all
operand identities to the compact overview.

`lookup()` returns the complete alias-to-target dictionary. It is optional and
can be large. Keep it on the authoritative side of the lookup interface; a
normal LLM overview does not need all identity keys copied into its context.

The standard summary includes all face descriptors. Optional
`summary({includeFaces:false})` / `--bodies-only` keeps body facts and all entity
alias ranges, explicitly omits face descriptors, and sets `detailLevel` to
`bodies`. It does not change lookup or detail behavior. This is a useful first
view for large models; it contains less information than the default summary.

## Included information and limits

The JSON summary (`wonky-geometry-summary/1`) includes model/entity counts,
body aliases and labels, identity stability/roles, generating operation and
source point, recorded volume and bounds, validation scope, edge-type counts,
and per-face semantic descriptors with incident edge aliases.

Surface descriptors are copied from existing data: plane origin/normal,
cylinder origin/axis/radius, and cone origin/axis/radius/angle. Cone angles remain
in radians. A surface origin is not asserted to be a trimmed-face centroid.
`sameSense` is copied separately when recorded, so a surface frame direction
is not silently presented as the oriented face normal. Missing orientation is
`null`, not guessed.

Unknown volume or bounds remain `null` in JSON and `unknown` in text. Existing
bounds are envelopes only: they do not describe occupied space, holes, voxel
cells or material distribution. No distances, interference results, mass
properties, tessellation or geometric equivalence are calculated here.

The overview omits full curve/surface frames, exact trims and ordered coedge
winding, vertex coordinates, full identity keys/ancestry and complete source
evidence. Its incident edge lists deduplicate an edge used twice as a seam;
`detail()` preserves both uses and their directions. Summary numerics are not
rounded. Surface descriptions and topology links are navigation information,
not a replacement geometry representation suitable for reconstruction.

Schema/topology/reference checks establish that aliases address the recorded
objects. They are not a new geometric validity certification; the original
validator's scope is carried through explicitly. General cross-revision
identity matching is outside this API; see `docs/topology-identity.md`.

## Actual token accounting

```sh
./bin/wonky-inspect.mjs out/bored-spacer.brep.json --tokens \
  --tokenizer-python /path/to/python-with-tiktoken \
  --tokenizer-cache /path/to/cached-encoding-assets \
  --encoding o200k_base --out out/bored-spacer.geometry-tokens.json
```

The optional exported function is
`measureGeometrySummaryTokens(inspector, {python, encoding, cacheDirectory,
timeoutMs})`. It launches the selected local Python/tiktoken installation,
disables network loading of encoding assets, and measures the exact strings.
An unavailable tokenizer or missing local encoding fails explicitly; there is
no character-count approximation. No tokenizer dependency is added to the
production npm package.

Each report identifies tokenizer library/version, encoding and Python version,
plus tokens, Unicode characters, UTF-8 bytes and SHA-256 for each payload. It
separately measures:

- Exact raw B-rep JSON, including existing metadata and whitespace.
- The same complete B-rep with JSON whitespace removed.
- Compact geometry-only JSON containing schema/units and each body's ID,
  geometry/precision, vertices, edges, faces and shell.
- Compact summary JSON and readable summary text.
- The optional body overview, with face descriptors explicitly omitted.
- The complete optional alias lookup dictionary, whose cost is not hidden in
  the summary counts.

These are text counts for the named encoding, not a measured end-to-end LLM
request. Message framing, other model tokenizers, detail queries, repeated
lookups and reasoning quality are outside the measurement. Different payload
scopes must not be described as equivalent information or equal task quality.
Fewer overview tokens alone do not establish total token savings.

### Measured examples

Recorded on 2026-09-22 using **tiktoken 0.9.0**, **o200k_base**, Python
**3.12.11**, with existing local encoding assets and network loading disabled.
Counts are for the exact payloads identified in the reports:

| Payload | Bored spacer, 1 body / 4 faces | Retained R10B, 5 bodies / 172 faces |
| --- | ---: | ---: |
| Raw B-rep JSON | 32,511 | 101,935 |
| Compact complete B-rep JSON | 28,447 | 62,052 |
| Compact geometry-only JSON | 649 | 53,993 |
| Standard summary JSON | 857 | 18,120 |
| Standard summary text | 524 | 17,031 |
| Body overview JSON | 544 | 1,094 |
| Body overview text | 288 | 620 |
| Complete optional alias lookup JSON | 14,358 | 113,739 |

For the simple spacer, the summary JSON is **larger than compact geometry-only
JSON: 857 versus 649 tokens**. Much of the difference from the complete raw
B-rep comes from excluding identity/source metadata and whitespace, not from
compressing an equivalent geometry representation. The full lookup dictionary
can itself exceed the raw B-rep, as the retained model shows; it is not silently
bundled into the normal overview. Selected detail responses have additional
costs. The body overview excludes all face descriptors, so its count is not a
like-for-like substitute for the standard summary or geometry.

All five retained-model volumes and bounds were unknown and remain `null` in
the JSON overview; the short body view does not invent spatial measurements.
No quality equivalence or task-level token saving was tested.

Evidence files are `out/bored-spacer.geometry-tokens.json` and
`out/r10b-retained.geometry-tokens.json`. They bind the measurements to these
exact model IDs, not to any later file regenerated at the same path:

```text
bored-spacer:
6a6e2c15579b3b1a66a0409ce488b52f0cbc28265491e1c7aee932bb9630a624
r10b-retained:
ca307a129b7526de0eb922dbc12ac8811e74a6b9feffc2773938273c8fa10418
```

## Verification

```sh
node --test test/geometry-summary.test.mjs
```

The tests cover exact-byte revision binding, every alias kind, authoritative
identity lookup, stale metadata rejection, unknown measurements, holes and
periodic-seam topology, source evidence, immutable snapshots, CLI behavior and
explicit tokenizer failure. They do not construct approximation geometry or
require a tokenizer installation for the ordinary test suite.
