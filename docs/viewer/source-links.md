# Source links

Package `source-links` (spec sections 3.2, 9.2, 13, wave 2). Modules:
`viewer/features/source/source-section.js` (inspector section),
`viewer/features/source/source-drawer.js` (frozen source drawer,
source-to-geometry, editor setting), `viewer/features/source/source.css`,
`src/viewer/history.mjs` and `src/viewer/routes/history.mjs`
(`GET /api/models/:id/history`). The package report with evidence and gaps
is `docs/viewer/package-source-links.md`.

## Where the data comes from

Everything is recorded build data. Nothing is inferred from geometry.

| Data | Recorded where | Used for |
|---|---|---|
| Modeling calls | `sourceMap.operations[]`: `sequence`, `name`, `operationId`, `status`, `source {file, sha256, span, excerpt}`, `callStack`, `parameters` (SI), `outputs`, `removedBodies` | operation source, call chain, history |
| Body → call | `body.debug.sourceOperation` | the operation of a body |
| Entity → call | `identity.operationId` on faces, edges, vertices | the operation of an entity (falls back to the body's) |
| Face/edge → sketch entity | `identity.topology.faces[i].source = {kind: 'sketch-entity', sketchId, entityId, span, curveType, role}` (line/arc sketch extrusions; edges carry it for their cap roles) | sketch-entity source first |
| Boolean face/edge → input | `construction.faceOrigins` / `edgeOrigins` with operands, `operationHistory[].evidence.inputs` | `boolean-origin` line links |
| Body lineage | `identity.operation.parentOperations`, `identity.lineage.parents` / `history`, Boolean evidence inputs | `descendant` line links |

`identity.source` on imported bodies (r10b) is an external entity record
(Onshape document, element, entity id; no span). It is not code and is never
shown as a source location; only `kind: 'sketch-entity'` counts.

A sketch entity record has a span but no file. Its file comes from the `sk*`
call that created it (matched by sketch id and entity id, else by span), else
from the entity's operation (one build evaluates one source document).

## Inspector section

For a selected face, edge, point or body the section shows, in this order:

1. Heading: **Sketch source** when the entity has a recorded sketch entity,
   else **Operation source** (the legacy heading, which VS asserts).
2. Headline:
   - a call made inside a helper function: `copyBody (line 20) called from
     r10b.fs:1382` (the innermost frame of the recorded call stack that has a
     call site; the call site is an editor link; without a recorded file path
     it reads `called from line 1382`);
   - otherwise the primary call: `skArc "right" · line 10` or
     `opExtrude model/slot · line 14`.
3. File, `Line l:c`, sha8 and the recorded 6-line excerpt with the primary
   line marked (green) and, when inside the excerpt, the operation line or
   helper call site marked as context (copper).
4. `Open in <editor>` (link to `file:line:column`), `Open frozen source`
   (`#open-source`).
5. For a sketch-entity primary: **Context** with the body operation
   (`opExtrude model/slot`, editor link to line 14).
6. `Copy source reference` (`#copy-source`), Construction history (call path
   without duplicate wrapper frames, each call site an editor link; the
   operation name, status, id, parameters JSON), Earlier body operations.

`sourceLinks(records, fallback)` returns `{primary, context, operation,
helper}`; `fallback` is the record-level source of `core/scene-records.js`
`sourceFor()`, used when the scene has no source map entry (legacy scenes).
`sourceReference(links, source)` builds the copyable reference: the recorded
descriptor unchanged plus `sketchEntity` and `callSite` (see the integration
request in the package report; `source.js` still copies the descriptor).

## Editor links

`core/editor-links.js` builds `zed://file/<path>:L:C` (default),
`vscode://file/…` or `cursor://file/…`; path segments are URI-encoded, so
paths with spaces and live sources under `$TMPDIR` (`/var/folders/…`) work.
Relative or missing paths give no link ("No file path recorded"). The scheme
is the global setting `editor` (scope G, `<reviews>/viewer-settings.json`);
unknown values fall back to `zed`. The source feature registers the settings
item `source.editor` (choice `zed`, `vscode`, `cursor`) for the settings UI
and re-renders the inspector when the value changes. Until that UI exists:

```sh
curl -s -X PUT -H 'Content-Type: application/json' -H 'Origin: http://127.0.0.1:<port>' \
  -d '{"global":{"editor":"vscode"}}' http://127.0.0.1:<port>/api/settings
```

or `wonkyViewer.settings.set('G', 'editor', 'vscode')` in the console.

## Frozen source drawer

`openSource(source, {focus})` opens the frozen bytes of `source.sha256`
(`GET /api/source/:sha`, one request; the legacy VS race rules hold). Without
an explicit `focus` it takes the current selection's source links and marks
in that document: the primary line (current, scrolled into view), the
operation line and the helper call site (context), listed in a legend whose
entries scroll to their line. Without a selection only `source.span` is
marked. The bar has `Hide code` / `Show code` (the drawer shrinks to its
status line so the selected geometry is visible; the choice holds for later
openings) and `Open in <editor>` at the current line and column. The drawer
is a compact bottom sheet (at most 46 % of the stage, 60 % below 650 px);
only the code scrolls.

**Source to geometry.** Outside the legacy seam the drawer loads
`GET /api/models/:id/history` once per model (the selection's model, else the
displayed one), marks every line that produced geometry (underlined green
number, focusable, Enter or Space selects) and on a click:

- selects exactly the recorded targets (`app.select(references)`, canonical
  reference key order), which highlights them in the viewport, and says what
  they are: `Line 10 (skArc) produced 3 entities (recorded): sketch entity:
  B1.F4, B1.E2, B1.E6. Selected in the viewport.`;
- or says that the line produced none, and why: no recorded call at the line;
  the call removed bodies; its bodies are not in the model; it sets
  properties; face-level sources are recorded only for line and arc sketch
  extrusions; the call failed. A highlight that an earlier line click made is
  cleared; the user's own selection is left alone.

Under the legacy seam (VS harness) no history request is made; a line click
only says that the links need the history API.

## `GET /api/models/:id/history`

Schema `wonky.viewer-history/1`, compact JSON, cached per model, computed
inline (1.5 ms arc slot, 2.5 ms pocket plate, 4.5 to 8 ms r10b-retained at
load 18 to 25). Unknown revisions answer 404.

```
{ schema, modelId, available, source, scope, parameterUnits,
  exactness: { operations: 'recorded', links: 'recorded', parameters: 'design-parameter' },
  operations: [{ sequence, name, operationId, status, file, sha256, span, excerpt,
                 callPath: [{ name, calledAt, declaration }],   // duplicates removed
                 callSite: { name, line, column, file, sha256 } | null,
                 sketch: { id, entityId? } | null,
                 parameters,                                    // as recorded, SI
                 parametersDisplay: [{ path, value | values, unit: mm|deg|…, si }],
                 outputs: [{ bodyId, alias | null }], removedBodies, error? }],
  bodies: [{ alias, id, name?, operation,
             faces: [{ alias, operation, sketchEntity?, origins? }],
             edges: [{ alias, operation, sketchEntity?, origins? }],
             vertices: [{ alias, operation }] }],
  files: [{ sha256, file, lines: { "<line>": {
    line, operations: [{ sequence, name, operationId }],
    links: [{ relation, via?, operations, targets }],
    targets: [{ alias, modelId, bodyId, entityType, entityIndex }],
    notes: [{ kind: removed-bodies | outputs-not-in-model | failed, … }] } } }] }
```

A model without a source map answers `available: false` with empty lists.

Relations of a line, strongest first:

| Relation | Targets |
|---|---|
| `sketch-entity` | faces and edges whose recorded sketch-entity source is this `sk*` call |
| `sketch` | faces and edges built from the sketch created (`newSketchOnPlane`) or solved (`skSolve`) here |
| `operation` | final bodies created by the call at this line |
| `boolean-origin` | Boolean result faces and edges whose recorded construction origin is a face of an input body created here |
| `descendant` | final bodies whose recorded lineage contains a body created here, when none of that call's bodies is still in the model and no Boolean origin applies (whole body, no face correspondence) |
| `call` | the union of the above for calls made inside a helper that is called at this line (`via` names the helper) |

Recorded call frames carry lines only; a call site is located in the calling
operation's source document.
