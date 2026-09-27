# Package source-links: face-level source, call chains, editor links, source to geometry

Wave 2, P1 (spec section 12). Status: implemented 2026-09-23. The reference
for the data, the API and the UI rules is `docs/viewer/source-links.md`.

## What it does

- **Sketch-entity source first** (spec 13, audit-data section 5 defect). A
  face or edge that a line/arc sketch extrusion produced shows its recorded
  sketch entity as the primary source (`skArc "right"`, line 10, file, excerpt
  with the line marked, editor link) and the body operation as **Context**
  (`opExtrude model/slot`, line 14). Other entities keep the **Operation
  source** section. External import records (`identity.source` with Onshape
  ids) are never shown as code.
- **Call chain headline.** A body or entity made inside a helper function
  reads `copyBody (line 20) called from r10b.fs:1382`: the innermost recorded
  frame with a call site, with the call site as an editor link. Construction
  history lists the call path without the duplicated wrapper frames, each
  call site linked.
- **Open in editor.** Every location is an editor link `file:line:column` in
  the scheme of the global setting `editor` (default `zed://`, also `vscode`
  and `cursor`), with URI-encoded segments, so live sources outside the repo
  (for example under `$TMPDIR`) and paths with spaces work. The settings item
  `source.editor` is registered for the settings UI; the inspector re-renders
  when the setting changes.
- **History API.** `GET /api/models/:id/history` (`wonky.viewer-history/1`):
  recorded calls with span, excerpt, call path, call site, SI parameters plus
  mm/deg display values, outputs and removed bodies; entity → operation and
  face/edge → sketch entity links; Boolean origins; a per-line index from each
  source line to the geometry it produced, with relation and notes.
- **Source to geometry.** The frozen source drawer marks the selection's
  primary line and its context lines (legend with jump buttons), marks every
  line that produced geometry, and on a click (or Enter on a marked line)
  selects exactly that geometry in the viewport, or says that the line
  produced none and why. `Hide code` shrinks the drawer to its status line so
  the highlighted geometry is not covered.

Files (all owned): `viewer/features/source/source-section.js`,
`viewer/features/source/source-drawer.js`, `viewer/features/source/source.css`,
`src/viewer/history.mjs`, `src/viewer/routes/history.mjs`,
`test/viewer-source-links.test.mjs`, `docs/viewer/source-links.md`, this
report. QA artifacts in `out/viewer/source-links/`. No new dependency, no
change to frozen files.

## How to use it

Select a face in the viewer. The inspector's source section shows where it
came from; `Open in Zed` jumps there, `Open frozen source` shows the exact
bytes the revision was built from. In the drawer, click any marked line to
see what it produced; `Hide code` to look at the model.

```sh
curl -s http://127.0.0.1:<port>/api/models/<id>/history | jq '.files[0].lines["10"]'
```

Change the editor: `wonkyViewer.settings.set('G', 'editor', 'vscode')` in the
console, or `PUT /api/settings` with `{"global":{"editor":"vscode"}}`.

## Evidence

Tests (focused, `nice node --test …`, all green):

- `test/viewer-source-links.test.mjs`: 19/19. Kernel-built arc slot (with a
  `$TMPDIR`-style path containing spaces) and a helper-built part; synthetic
  models for Boolean origins, lineage, removal and the exact r10b R39 record
  shape. Covers: history operations, spans, call paths, mm/deg parameters;
  face and edge sketch-entity links; the line index (line 10 → the arc face
  and its two cap edges, 14 → B1, 13 → the sketch, 7 → none); helper call
  sites and call links; Boolean origins with contributors and
  FaceIntersection edges; descendants of a removed body; removal and
  setProperty notes; a model without a source map; the route (200, 404); the
  inspector order (skArc before opExtrude, context line 14); edges and cap
  faces; browser/server agreement on every face and edge of both kernel
  models; the r10b headline with and without a recorded path; editor links for
  zed, vscode, cursor, unknown and relative paths; the record-only legacy case;
  the copyable reference; the drawer under the legacy seam (exactly one
  request) and outside it (source + one history request, linked lines,
  select on click, "produced none" clears only the drawer's own highlight,
  Hide code).
- `test/viewer-state.test.mjs` (VS): 32/32, including the source/report
  drawer race test. `test/review.test.mjs` (RV): 7/7.
- `node scripts/viewer/check-format.mjs`: 173 files ok.
  `node scripts/viewer/check-contracts.mjs`: 65 DOM ids, 20 facade fields,
  21 harness functions ok.

Browser QA (Playwright via `scripts/viewer/qa/browser.mjs`, own instances,
both stopped afterwards; Marc's 4310/4311 untouched):

- Port 4365 (`scripts/viewer/qa/serve.mjs`), arc slot, bored spacer, pocket
  plate, r10b-retained rebuilt with its path recorded
  (`node bin/wonky.mjs fixtures/r10b/r10b.fs --feature r10bRetainedContext
  --format step --out tmp/viewer/source-links/r10b-retained`, 4.6 s) and
  `out/r10b-retained.brep.json` (no path recorded).
  `out/viewer/source-links/qa-source-links.mjs` → `qa-report.json`: 37 checks,
  19 asserted, 0 failed, no console errors.
- Port 4366, live `wonky-view $TMPDIR/wonky-source-links-qa/arc-slot.fs
  $TMPDIR/wonky-source-links-qa/helper.fs --port 4366 --no-open`.
  `out/viewer/source-links/qa-live-source.mjs` → `qa-live-report.json`:
  13 checks, 7 asserted, 0 failed, no console errors.

| Acceptance | Result | Evidence |
|---|---|---|
| 1 Arc-slot right face: skArc line 10 first, opExtrude line 14 as context | pass | Clicked face B1.F4 on the canvas: heading "Sketch source", headline `skArc "right" · line 10`, excerpt line 10 current, Context `opExtrude model/slot · line 14`; `01-arc-face-inspector.png`, `01b-arc-face-history.png` |
| 2 r10b helper body reads "copyBody (line 20) called from r10b.fs:1382" | pass | Clicked an R39 face and selected the R39 body: exact headline text; link `zed://file/…/fixtures/r10b/r10b.fs:1382:10`; `07-r10b-face.png`, `07-r10b-helper.png`. Without a recorded path: `copyBody (line 20) called from line 1382`, "No file path recorded" |
| 3 Open in editor follows the setting (zed by default), file:line:column, works for a live source under $TMPDIR; Open frozen source too | pass | `zed://file/var/folders/…/T/wonky-source-links-qa/arc-slot.fs:10:5`; setting `vscode` / `cursor` switches every link without reselecting (`02-arc-face-vscode.png`); live drawer opens `arc-slot.fs` from the frozen bytes with line 10 current (`11-live-tmpdir-face.png`, `12-live-line12-code-hidden.png`) |
| 4 A source line click highlights what it produced, or says it produced none | pass | Line 10 → B1.F4, B1.E2, B1.E6 selected (`highlightState`: face 3, edges 1 and 5; `04-arc-line10-highlight.png`, `04b-arc-line10-code-hidden.png`); line 14 → B1 (`05`); line 7 → "has no recorded modeling call … produced no geometry", drawer highlight cleared (`06`); r10b line 1382 → B4 via copyBody (`08`), line 1389 → "removed 2 bodies"; pocket plate line 10 → 17 Boolean-origin entities (`09`); live helper line 12 → B2 (`13`); keyboard Enter on a marked line |
| 5 VS source/report drawer race test; VS 32/32; RV 7/7 | pass | see tests |

Inventory rows touched and re-checked in the browser: INS-09 (file,
`Line l:c`, sha8, excerpt with the line marked; now the sketch entity first,
spec 13), INS-10 (Copy source reference copies the recorded descriptor; keys
`language, file, sha256, url, span, excerpt`), INS-11 and DRW-02 (drawer with
file name, sha, numbered lines, current line scrolled into view), INS-12
(construction history), INS-13 (earlier body operations on r10b).

## Gaps

- **Face-level sketch sources exist only for line and arc sketch
  extrusions.** `skCircle`, `skPolyline`, `skRectangle` and cap faces record
  none, so those lines say "produced no geometry … recorded only for line and
  arc sketch extrusions" and the face shows the operation. Recording them is
  a kernel/identity change (request below).
- **Coaxial and pierce Booleans have no `faceOrigins`** (bored spacer, cross
  bore): lines of their input bodies link the whole result body as
  `descendant`, not individual faces (spec section 14 already requests
  `faceOrigins` from the Boolean owners).
- **Call frames carry no file.** A call site is placed in the calling
  operation's document; correct for single-document builds (all of today's
  FeatureScript and single-file Python) but not for future multi-file sources.
- `Copy source reference` and the inspector's `Copy reference` still copy the
  operation descriptor only, because the binding lives in `source.js` and
  `inspector.js` (not owned). `sourceReference()` is ready; see the
  integration requests.
- The drawer covers the lower part of the stage. `Hide code` solves it with
  one click; a camera "frame selection above the drawer" would remove the
  click (camera owner).
- The editor setting has no UI until a package renders `slots.settings.item`
  (help-a11y); it is settable by API or console today.
- The editor scheme reaches `sourceMarkup()` through a module-level reader
  installed by `createSourceDrawer()`, because `source.js` does not pass it.
  Harmless (one viewer per page; tests reset it) and removed by integration
  request 1.
- Pre-existing failures outside this package (seen, not caused here):
  `test/viewer-core.test.mjs` 3 (camera frozen API and presets,
  multi-selection highlight buffers) and `test/viewer-server.test.mjs` 1
  (frozen stubs), from wave-1 changes to camera, renderer and stub modules.

## Integration requests

1. `viewer/features/source/source.js` (not owned): pass the editor setting,
   copy the face-level reference and give the drawer the section's focus.

   ```js
   import { sourceLinks, sourceMarkup, sourceReference } from './source-section.js';
   // render:
   render: ({ records }) => sourceMarkup(sourceFor(records), records,
     { editor: ctx.settings.get('G', 'editor', 'zed') }),
   // bind:
   const source = sourceFor(records);
   const links = sourceLinks(records, source);
   $('#copy-source').onclick = () => ctx.copyText(
     JSON.stringify(sourceReference(links, source), null, 2), 'Source reference copied');
   $('#open-source').onclick = () => openSource(source,
     { focus: links && { modelId: ctx.state.selection.modelId, links } }).catch(ctx.showError);
   ```

   The copied JSON keeps every existing key (INS-10) and adds `sketchEntity`
   and `callSite`.
2. `viewer/features/inspector/inspector.js` (reviews-context / help-a11y):
   optionally add `sketchEntity` to `Copy reference` the same way (VS asserts
   `source.span.line` 14 for a record-only case, which stays).
3. Settings UI (help-a11y): render the registered `settings.item` entries;
   `source.editor` is a `choice` of `zed`, `vscode`, `cursor`.
4. Kernel identity owner: record `sketch-entity` sources for circle, polyline
   and rectangle sketch extrusions and for cap faces (region → sketch), and a
   `file` on call frames (`calledAt.file`) for multi-document sources.
5. camera-navigation: a fit-selection command with an inset for the drawer
   (the drawer's height is `#report-drawer`'s box).
