# reviews-context: dirty rule, one-shot tools, resolvable copies, selection API, print export

Package of wave 2 (spec section 12, P0). Reference for the behavior and the
APIs. Delivery evidence, integration notes and gaps are in
`docs/viewer/package-reviews-context.md`.

## Dirty rule (spec D9)

One owner: `viewer/features/reviews/dirty.js`. Every other feature only calls
`ctx.review.touch(reason)`; a touch re-evaluates the rule.

- The **dirty payload** is the review payload without the camera and the
  derived model list: the title as typed (not the "<model> review" fallback),
  the notes, the comparison (before, after, split, compare, layout) and the
  annotations.
- **Unsaved changes** shows when the review has content (a title, notes or
  an annotation, whitespace does not count) **and** its dirty payload differs
  from the payload of the last save or load. A review that was never saved has
  no baseline, so any content makes it dirty.
- Clean and saved reads `Saved · WKR-…`; clean and never saved reads nothing.
- Consequences: with an empty review, compare, layout, split and the camera
  never mark it dirty. On a saved review the camera never does; drawing a
  rectangle and pressing ⌘Z returns to `Saved · WKR-…`; toggling compare
  twice returns to Saved.
- The stale-save check of an in-flight save compares the same payload, so it
  still covers comparison and layout (the VS save-race tests are unchanged).
  A camera move during a save no longer makes the save stale.

## Markup tools (spec D8)

`viewer/features/annotations/tools.js`.

- Comment, arrow, box and pen are **one-shot**: after one annotation the rail
  returns to Select.
- **Lock**: double-click the tool button, or activate the active tool again
  (its key pressed twice, or a second click). The button turns solid green
  and the hint reads "… · Locked · Esc to release".
- **Escape** releases a locked tool through an exclusive Escape handler, so
  that Escape does not also clear the selection. Choosing any other tool
  releases the lock too.
- The harness `tool(name)` keeps its meaning (select a tool, unlocked).
  `ctx.app.lockTool(name)` locks programmatically; `state.toolLocked` is a new
  (not frozen) facade field.

## Copy actions and archive (spec 3.7, D7)

Every copy in the browser goes through `ctx.app.copyContext(kind, options)`,
which posts to `POST /api/context`. The server archives every revision the
text names to `<reviews>/models/<id>.brep.json` **before** it builds the
text, so every `wonky-inspect` command in it resolves after the server stops.
Commands use absolute paths of this repository's `bin/wonky-inspect.mjs` and
of the archived snapshot, so they run from any directory:

```
node /…/wonky-kernel/bin/wonky-inspect.mjs /…/reviews/models/<id>.brep.json \
  --revision <id> --detail B2.F3
```

| Button (inspector) | kind | Text |
|---|---|---|
| Copy reference (`#copy-selection`) | `references` | the reference JSON (`modelId, bodyId, entityType, entityIndex, alias, logical, identity, source`) plus `exact` (one-line exact summary), `snapshot` and `inspect` |
| Copy references (N) | `references` | `wonky.viewer-references/1`: every entry of the multi-selection in selection order |
| Copy selected geometry (`#copy-geometry`) | `geometry` | the `wonky-geometry-detail/1` entity detail plus `exact` (the exact-measure geometry entry) and `inspect: {snapshot, command}` |
| Copy model overview (`#copy-geometry`, no selection) | `overview` | the bodies-level overview text plus the revision line and snapshot, overview and detail commands |
| Copy LLM context | `llm` | Markdown, see below |

Under the legacy seam (VS) the pre-rework handlers stay: Copy reference is
composed locally without a request, and Copy selected geometry / model
overview read `/entities/<alias>` and `/summary` directly.

### LLM context (`kind: llm`)

Scoped to what is on screen: the displayed model, and the before model only
in compare mode. A hidden compare model is never named. Sections:

1. per visible model: modelId, revision (`r3 of /path/part.fs (live)`,
   `input <path>` or `archived snapshot`), snapshot, overview and detail
   commands, and the bodies-level overview;
2. **Changes since** the previous revision of the same source (when the
   library knows one): bodies, faces (logical), edges, recorded volume, size
   delta and changed source lines, from `compareModels` (counts compare the
   stored B-rep; bodies are matched by body id);
3. **Selection**: per entity its alias, logical face with fragments, the exact
   summary line (for example `cylinder boss Ø8.0000 mm (r 4.0000 mm) · axis (0,
   0, 1) through (0.0000, 0.0000, 0.0000) mm (nearest the origin) · exact
   ±0.0003`), identity scope and role, source location, detail command and
   the exact geometry entry as one JSON line;
4. **Measurement** per model with two or more selected entities: the rows of
   `src/viewer/measure.mjs` (value, exactness chip, note, inputs) and its
   unsupported rows; entities of different revisions are not measured;
5. the exactness legend. No display-mesh value is included.

### Saved review context

`GET /api/feedback/:id/context` and `<reviews>/<id>.context.md` use the same
scope rule: the displayed model, the before model when the review was in
compare mode, annotated models and models an annotation's view showed (the
before model of that view only in compare). Referenced but hidden revisions
are counted ("Not included (hidden in the saved view): 1 referenced
revision"), never named. Each annotation with a target gets its exact summary
line and a detail command. The on-disk file stays port-independent and
deterministic (it is rewritten when a read finds it stale).

## Selection API (spec 3.7, 9.2)

`viewer/features/reviews/selection-share.js` posts the browser selection
whenever the multi-selection or the displayed models change (coalesced per
task; a newer post aborts an older one). It posts once at startup with an
empty selection; that first post warms the kernel in the server. Nothing is
posted under the legacy seam. A failed post never touches `#global-error`.

```
POST /api/selection { references: [ref…], visible: [modelId…], client? }
GET  /api/selection
```

Response `wonky.viewer-selection/1`: `updatedAt, sequence, client, modelId`
(the primary's), `revision` (live revision number or null), `model` (label,
source path, revision text), `visible`, and `references: [{ ref, alias,
logical, summary: { text, exactness, toleranceMm, entry }, identity, source?,
detail }]`, where `detail` is this server's entity route. Summaries are closed
forms over the stored parameters (`exact-parameters`); bodies carry their
recorded counts, volume and bounds (`recorded`). Ephemeral: memory only, the
last post from any tab wins; before the first post `references` is empty.
Unknown revision 404, malformed reference 400.

## Print export (spec 3.6, 9.2)

```
GET /api/models/:id/print.stl[?body=<id|B2>&deviationMm=0.02]
GET /api/models/:id/print.json[?body=…&deviationMm=…]
```

Both archive the revision first. The mesh is `toPrintStl` of
`src/print-mesh.mjs` (import only): every circle divided by a count Bend
chooses for the requested chord deviation, the achieved deviation a computed
bound. The manifest `wonky.viewer-print-export/1` records modelId, label, live
revision, scope (`revision` or `body`), bodies, the STL file name, bytes and
SHA-256, `deviation { requestedMm, achievedMm, exactness:
display-approximation, statement }`, the snapshot and an inspect command, and
the print mesh's own `wonky.print-mesh/1` manifest verbatim. Both answers are
attachments (`pin-in-bore-6404ed85.stl`, `…-b2-model-pin.print.json`).

- `deviationMm` outside 0.001–1 mm: 400. Unknown body: 404.
- A body the print mesh cannot cover (a face bounded by a trimmed arc, an
  analytic body without circular edges): **422** `{ error, kind: capability,
  exactness: unsupported, scope }` with the print mesh's message.
- The export runs in a worker thread that loads the kernel once
  (`createPrintExporter` in `src/viewer/export.mjs`), so the server's event
  loop never meshes; the last four results are cached, so the STL and its
  manifest are meshed once.

In the browser: **Export for print** (inspector Print section, command
`reviews.exportPrint`) fetches the manifest first (a capability error stops
there and shows in the error banner), then downloads the STL and the manifest.
With a selection, **Export B2 for print** exports that entity's body. The
parts tree renders the `parts.rowAction` item `reviews.printBody` (`run({
modelId, bodyId })`) once it lands.

## Per-review isolation and archive on save

- `GET /api/workspace` lists reviews from their records only. A file that is
  not valid JSON, or whose id does not match its name, becomes an error row
  `{ id, file, error }` (listed last, shown in red in Saved reviews); the
  workspace still loads.
- Opening a review whose context cannot be regenerated (for example a missing
  snapshot) still opens it; the record carries `contextError`.
- `POST /api/feedback` archives every referenced revision (live revisions
  from memory or the spool) before writing the review; `revisions[].snapshot`
  is the archived path and the answer lists `archived`.

## Files

Browser: `viewer/features/reviews/{reviews,dirty,selection-share}.js`,
`reviews.css`; `viewer/features/annotations/{annotations,tools}.js`,
`annotations.css`; `viewer/features/inspector/{context-section,identity-section}.js`.
Server: `src/viewer/{context,selection,export,reviews}.mjs`,
`src/viewer/routes/{reviews,selection,export}.mjs`. Tests:
`test/viewer-reviews-context.test.mjs`.
