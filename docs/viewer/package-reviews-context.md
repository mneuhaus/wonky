# Package reviews-context: delivery report

Wave 2, P0 (spec section 12), 2026-09-23. Reference for behavior and APIs:
`docs/viewer/reviews-context.md`. Evidence: `out/viewer/reviews-context/`.

## What it does

- **Dirty rule (D9)** in `viewer/features/reviews/dirty.js`: "Unsaved
  changes" only when the review has content and its payload (title as typed,
  notes, comparison, layout, annotations; camera excluded) differs from the
  last save or load. Undo back to the saved state reads "Saved · WKR-…" again.
- **One-shot, lockable markup tools (D8)**: comment, arrow, box and pen return
  to Select after one annotation; double-click or a second activation locks;
  Escape (exclusive, so the selection stays) or another tool releases.
- **Archive on copy (D7)**: Copy reference, Copy references, Copy selected
  geometry, Copy model overview and Copy LLM context go through `POST
  /api/context`, which archives every named revision before building the
  text. Commands use absolute paths and resolve after the server stops.
- **Scoped LLM context**: the visible model(s) only (never a hidden compare
  model), the selection with inline exact summaries and exact entries,
  measurements for two or more entities, and the change summary against the
  previous revision of the same source. The saved-review context follows the
  same scope rule and inlines the exact data of annotated entities.
- **Copy references** for a multi-selection (`wonky.viewer-references/1`).
- **Selection API**: the browser posts its selection; `GET /api/selection`
  answers aliases, logical faces and exact summaries.
- **Print export**: `print.stl` / `print.json` per revision and per body,
  archived first, manifest with the chord deviation; capability refusals are
  422 with the print mesh's message. In the inspector: Export for print and
  Export B<n> for print; command `reviews.exportPrint`; `parts.rowAction`
  item for the parts tree.
- **Per-review isolation**: a corrupt review file is an error row, the
  workspace still loads; a review whose context cannot be rebuilt still opens.
- **Archive on save**: saving a review archives every referenced revision
  (live ones from memory or the spool) before the record is written.

## How to use it

In the viewer: select geometry, then use the inspector's **LLM context**
section (Copy selected geometry / Copy model overview, Copy references (N)
with a multi-selection, Copy LLM context) and **Print** section (Export for
print, Export B2 for print). Markup keys C, A, R, P are one-shot; press the
key twice or double-click the tool to keep it; Escape releases it.

From a shell or an agent (any running viewer):

```sh
curl -s http://127.0.0.1:<port>/api/selection            # what Marc selected
curl -s -X POST -H 'Content-Type: application/json' \
  -d '{"kind":"llm","visible":["<id>"],"references":[]}' \
  http://127.0.0.1:<port>/api/context | jq -r .text     # scoped context
curl -sOJ http://127.0.0.1:<port>/api/models/<id>/print.stl?body=B2
curl -s  http://127.0.0.1:<port>/api/models/<id>/print.json | jq .deviation
```

## Evidence

Own instances only: static session on port 4376 (fixtures pin-in-bore,
bracket, compare-before/after, bored-spacer, arc-slot; private reviews
directory `tmp/viewer/reviews-context/reviews-static` with a planted corrupt
`WKR-EEEEEEEEEE.json`), live session on port 4377 (`WONKY_VIEW_PORT_RANGE=
4320-4399`, a copy of `examples/bracket.fs` under
`tmp/viewer/live/reviews-context/`, reviews in
`tmp/viewer/reviews-context/reviews-live`). Port 4371 (the spec's port for
this package) was taken by an unrelated `python -m http.server`; 4310 and
4311 were not touched. Headless Chromium through
`scripts/viewer/qa/browser.mjs`, 1536 × 900, real mouse and keyboard events,
clipboard read through granted permissions. Load average 16 to 28 during QA.
Every instance was stopped; no process of them remains.

QA drivers: `tmp/viewer/reviews-context/qa.mjs` (22/22,
`results.json`), `qa-live.mjs` (5/5, `results-live.json`),
`qa-inventory.mjs` (10/10, `results-inventory.json`).

| # | Acceptance | Result | Evidence |
|---|---|---|---|
| 1 | Empty review: compare, layout, camera never show Unsaved changes; rectangle then ⌘Z returns to Saved; VS save-race tests unchanged | pass | `results.json` states: compare on, side by side, wipe, orbit, front view, compare off all read `""` (`02-empty-review-compare-no-dirty.png`). Saved review: orbit stays `Saved · WKR-7031FEB42E`, rectangle → `Unsaved changes` (`03-rectangle-unsaved-select-again.png`), ⌘Z → `Saved · WKR-7031FEB42E` (`04-undo-back-to-saved.png`). VS 32/32 with the test file untouched. |
| 2 | Tools one-shot; double-click locks; Escape unlocks | pass | R + drag: one box, tool back to `select`; double-click: class `tool active locked`, two more boxes, still `box`; Escape → `select`, `toolLocked false`; R R locks too (`05-locked-box-tool.png`); comment tool: one comment, note focused, back to Select (`13-comment-one-shot-card.png`). |
| 3 | After Copy reference, selected geometry, model overview, LLM context, every copied command exits 0 with the server stopped | pass | Static: `copied-*.txt`, server down, 4 distinct commands all exit 0 (`inspect-after-stop.txt`). Live r2: `copied-live-*.txt`, 3 commands exit 0 (`inspect-after-stop-live.txt`). Saved-review context: commands exit 0 (`results-inventory.json`). |
| 4 | LLM context: visible model and the selection's exact data, never a hidden compare model; Copy references copies a multi-selection | pass | `copied-llm-context.txt` with before = bracket and compare off: bracket id absent, pin-in-bore present, `cylinder boss Ø8.0000 mm … exact ±0.0003`, a Measurement section (angle, axis distance, coaxial). In compare mode the bracket is listed as `(compare before)` (`copied-llm-context-compare.txt`). `copied-references.txt`: `count 2`, each with snapshot and inspect command (`09-inspector-llm-context-multi.png`). |
| 5 | GET /api/selection returns the clicked faces with aliases and exact summaries within 500 ms | pass | 3 ms from the click to a GET that answered `B2.F3` `cylinder boss Ø8.0000 mm (r 4.0000 mm) · axis (0, 0, 1) …` (`selection-single.json`); Shift-click adds the block face (`selection-multi.json`, `06-multi-selection-inspector.png`). |
| 6 | Export for print: STL + manifest stating the deviation, for a revision and for one body | pass | `downloads/revision-pin-in-bore-6404ed85.{stl,print.json}` and `downloads/body-pin-in-bore-6404ed85-b2-model-pin.{stl,print.json}`; statement "Every facet lies within 0.0193 mm of the exact B-rep surface (chord deviation bound computed by Bend; requested at most 0.02 mm)"; the manifest's SHA-256 matches the STL (unit test). arc-slot is refused with 422 and the banner "Export for print: Print mesh needs full circles; face 3 is bounded by a trimmed arc" (`08-print-capability-error.png`). |
| 7 | Corrupt review file is an error row while the workspace loads; saving a review on a live revision archives it | pass | `01-corrupt-review-row.png`: `WKR-EEEEEEEEEE · Review WKR-EEEEEEEEEE cannot be read: Unexpected end of JSON input`, workspace loaded. Live: r1 not archived before, `reviews-live/models/<r1>.brep.json` present after ⌘S and equal to `revisions[0].snapshot` (`11-live-review-saved.png`, `results-live.json`); r2 archived by Copy LLM context (`12-live-r2-copied.png`). |
| 8 | VS 32/32 and RV 7/7 | pass | see Tests. |

Also re-checked in the browser (inventory rows these files touch): REV-02
save, REV-04 load from the list, REV-06 saved-review Copy LLM context, UI-05
Copy review, ANN-02 comment tool, ANN-07 card and jump, ANN-08 undo, INS-07
Copy reference, INS-16 LLM context copy. No console messages except Chrome's
own "Failed to load resource: 422" for the deliberate arc-slot refusal.

### Tests

- `nice node --test test/viewer-reviews-context.test.mjs`: 14/14 (dirty rule
  in the fake browser, one-shot and lock with real pointer and key events,
  selection posting and the legacy seam, copy requests and scope, error rows,
  reference validation and shell quoting, review scope, print helpers, list
  isolation, exact summaries and a deterministic scoped review context, a
  real server: selection within 500 ms, all four copy kinds archive, print
  STL/manifest/body/422/404, and every copied command exits 0 after close;
  archive on save through the review store; the print worker thread).
- `test/viewer-state.test.mjs` (VS) 32/32, `test/review.test.mjs` (RV) 7/7,
  `display-cylinder` 5/5, `display-export` 2/2, `geometry-summary` 11/11,
  `viewer-exact-measure` 12/12, `viewer-live-client` 22/22,
  `viewer-camera-navigation` 15/15, `viewer-model-first-compare` 18/18,
  `viewer-render-transport` 15/15, `viewer-topology-classes` 14/14,
  `viewer-camera` 12/12, `viewer-measure` 17/17.
- `viewer-core` 7/10 and `viewer-server` 11/12: the failures are in files of
  other packages being edited in parallel (camera frozen-API numbers, the
  renderer's highlight buffers, the topology stub expectation) and do not
  touch this package's files.
- `node scripts/viewer/check-format.mjs` and `check-contracts.mjs`: ok.

## Integration notes (outside this package's files)

None is required for the acceptance above. Recommended:

1. **parts-tree (wave 3)**: render `slots.list('parts.rowAction')` as row
   buttons and call `item.run({ modelId, bodyId })`; this package registers
   `reviews.printBody` ("Export for print", icon `cube`).
2. **help-a11y**: describe in `docs/viewer-ui.md` (German) the one-shot and
   locked tools, Copy references, the LLM context scope, Export for print and
   `/api/selection`.
3. **maintainer, optional**: the archive loop in the `reviews.save` wrapper
   of `src/viewer/server.mjs` is now redundant (the review store archives every
   referenced revision); keep the `workspace-changed` publish.

## Gaps

- **Safari clipboard**: copies are written after the server answers (the
  revision must be archived first). Chromium and Firefox accept that; Safari
  may reject a clipboard write outside the click's task. A
  `ClipboardItem`-with-promise path in `viewer/core/notify.js` (frozen core)
  would cover this and exact-measure's Copy measurement alike.
- **Two downloads per export**: Chromium asks once per site before a second
  automatic download. The manifest is also reachable at `print.json`.
- **Print mesh capability**: faces bounded by trimmed arcs and analytic bodies
  without circles are refused by `src/print-mesh.mjs` (arc-slot, pocket
  plate). The viewer reports it (422); widening the mesh belongs to its owner.
- **Print export worker**: its own worker thread, not the shared query worker,
  because the frozen query-kind map (and its test) pins five kinds.
- **Selection API**: the last post from any tab wins; there is no per-tab
  read. Body summaries are recorded values only.
- **Saved-review context** inlines exact data of annotated entities but no
  measurements (reviews do not store a measurement); the inspector's Copy LLM
  context does.
- **Change summary** appears only when the library knows a previous revision
  of the same source; parameter-level deltas are deferred (spec section 14).
- **Dirty evaluation** serializes the annotations on every touch (a keystroke
  in a note). Typical reviews are small and this is well under a millisecond;
  a review at the limits (500 annotations, pen strokes of 4000 points) could
  cost hundreds of milliseconds per keystroke. A per-annotation revision
  counter would fix that if it ever matters.
- **Identity section**: only the Copy reference behavior moved here; the
  identity rows are still rendered by `features/inspector/inspector.js`
  (help-a11y), and this package rebinds `#copy-selection` after each render.
