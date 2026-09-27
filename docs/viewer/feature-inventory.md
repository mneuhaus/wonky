# Viewer feature inventory (regression checklist)

Baseline: 2026-09-22, audited code `viewer/app.js` (710 lines), `viewer/index.html`,
`viewer/style.css`, `src/review-server.mjs`, `src/review-scene.mjs`,
`bin/wonky-view.mjs`. Every row is something a user, a script or an agent can
observe today. Later stages keep each row working, or the spec retires it with
a reason. Rows marked **defect** record current behavior that is wrong; do not
preserve those, fix them deliberately (see `docs/viewer/audit-code.md`).

Test keys: **VS** `test/viewer-state.test.mjs` (32 tests), **RV**
`test/review.test.mjs` (7), **DC** `test/display-cylinder.test.mjs`, **DE**
`test/display-export.test.mjs`, **GS** `test/geometry-summary.test.mjs`.
"manual" means only browser QA covers it (earlier runs are listed in
`docs/viewer-ui.md`).

## Setup for exercising

```sh
node bin/wonky.mjs examples/bracket.fs --param 'thickness=8*millimeter' --out tmp/viewer/inv/before
node bin/wonky.mjs examples/bracket.fs --param 'thickness=12*millimeter' --out tmp/viewer/inv/after
node bin/wonky.mjs examples/bored-spacer.fs --format step --out tmp/viewer/inv/bored-spacer
node bin/wonky.mjs examples/convex-intersection.fs --format step --out tmp/viewer/inv/convex
node bin/wonky-view.mjs tmp/viewer/inv/before.brep.json tmp/viewer/inv/after.brep.json \
  tmp/viewer/inv/bored-spacer.brep.json tmp/viewer/inv/convex.brep.json \
  --port 43NN --reviews tmp/viewer/inv/reviews
# open http://127.0.0.1:43NN/viewer/
```

Use a free port in 4320-4399 and a private `--reviews` directory; the server
writes model and source snapshots there at startup. Never touch the viewers
on 4310/4311. For check reports, the server reads fixed files under `out/`
(API-10). For a large multi-body model use `out/r10b-retained.brep.json`.

## 1. CLI and process

| ID | Feature | How to exercise | Expected today | Tests |
|---|---|---|---|---|
| CLI-01 | Start with one or more `.brep.json` files | `node bin/wonky-view.mjs a.brep.json b.brep.json` | Prints `Wonky review: http://127.0.0.1:4310/viewer/` and `Structured feedback: <dir>` | RV (via `createReviewServer`) |
| CLI-02 | `--port <n>` | `--port 4391`; `--port 0` in tests | Binds 127.0.0.1 only; invalid port prints `wonky-view: Invalid viewer port`, exit 1 | manual |
| CLI-03 | `--reviews <dir>` | `--reviews tmp/x` | Reviews, `models/`, `sources/` go there (default `<repo>/reviews`) | RV |
| CLI-04 | `--help` | `node bin/wonky-view.mjs --help` | Usage text, exit 0 | manual |
| CLI-05 | Argument errors | `--bogus`, or no model | `wonky-view: Unknown option --bogus`; `wonky-view: Pass at least one .brep.json model`; exit 1 | manual |
| CLI-06 | Clean shutdown | Ctrl-C / SIGTERM | Server closes, exit 0 | manual |
| CLI-07 | `npm run view -- <files>` | alias of CLI-01 | same | manual |
| CLI-08 | `npm run demo:review` | builds 5 examples into `out/` and starts the viewer | 5 models, default port 4310 (conflicts with Marc's viewer; pass `-- --port 43NN`) | manual |

## 2. Server behavior

| ID | Feature | How to exercise | Expected today | Tests |
|---|---|---|---|---|
| SRV-01 | Revision identity | Start with any model | Model id = SHA-256 of the exact file bytes; label = file name without `.brep.json` | RV, GS |
| SRV-02 | Validation before publish | Start with a model whose identity revision is stale | Startup fails; nothing is registered | RV |
| SRV-03 | Display preparation before publish | Model with an edge curve type other than line/circle/ellipse | `Unsupported display edge <type>`: as a CLI input the server does not start; on refresh 400; the model cannot be viewed or inspected at all | RV |
| SRV-04 | Model archive | Start once, list `<reviews>/models/` | `<sha>.brep.json` written once (`wx`), hash re-checked if it exists | RV |
| SRV-05 | Archived revisions reload | Restart with a changed input file | Old revision still listed as `Saved revision <sha8>`; new bytes listed under the file label | RV |
| SRV-06 | Corrupt archive is fatal and preserved | Put wrong bytes in `models/<sha>.brep.json`, start | `Cannot load archived model snapshot <path>: ... hash mismatch`; file untouched | RV |
| SRV-07 | Source freezing | Model built with `sourcePath` inside the repo | `<reviews>/sources/<sha>.txt` written only if the current file hash matches; never serves newer code as the old revision | RV |
| SRV-08 | Rebuild pickup on refresh | Rebuild an input file, then GET `/api/workspace` (or "Refresh workspace") | New bytes become an additional revision; old selections stay on the old revision | RV |
| SRV-09 | Rejected refresh does not publish | Overwrite an input with invalid bytes, refresh | 400 with the reason; no registry entry, no archive file, old scene still served | RV |
| SRV-10 | Cross-origin rejection | Any request with `Origin` other than the server origin (or its `localhost` form) | 403 `Cross-origin request rejected` | RV (POST) |
| SRV-11 | Response headers | any request | `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` | manual |
| SRV-12 | Error mapping | any failing route | `ENOENT` -> 404, every other thrown error -> 400 `{error}` (no 500s) | RV |
| SRV-13 | **defect** Host header not checked | `curl -H 'Host: attacker.example:43NN' .../api/workspace` | 200 (DNS-rebinding exposure) | none |

## 3. HTTP API

| ID | Endpoint | How to exercise | Expected today | Tests |
|---|---|---|---|---|
| API-01 | `GET /` | `curl -i /` | 302 to `/viewer/` | manual |
| API-02 | `GET /viewer/`, `/viewer/index.html`, `/viewer/app.js`, `/viewer/style.css` | curl each | 200 with html/js/css content types | manual |
| API-03 | Unknown viewer asset | `GET /viewer/nope.js` | 404 `Unknown viewer asset` (hard whitelist of 3 files) | manual |
| API-04 | `GET /api/workspace` | curl | `{models:[{id,label,sha256,sourcePath,bodyCount,faceCount,bounds}], reports:[{id,label,status}], feedback:[{id,title,createdAt}]}`; side effects: re-reads inputs (SRV-08), re-reads reports, rewrites stale `.context.md` files | RV |
| API-05 | `GET /api/models/<sha>` | curl with a listed id | Display scene: `bounds`, `bodies[{id,name,volumeMm3,identity,source,debug,vertices,edges[{index,curveType,points,identity,source}],faces[{index,surfaceType,edgeIndices,triangles,identity,source,displayWarning?,displayTessellation?}]}]`, `sourceMap`, `diagnostic`, `display{toleranceMm:0.02,notes,purpose}` | RV, DC |
| API-06 | Unknown model scene | `GET /api/models/<64 hex unknown>` | **400** `Unknown model revision` (asserted by RV; inconsistent with API-07) | RV |
| API-07 | `GET /api/models/<sha>/summary[?level=bodies][&format=text]` | curl the 4 variants | JSON `wonky-geometry-summary/1` or text; `level=bodies` omits faces; unknown model 404 | RV, GS |
| API-08 | `GET /api/models/<sha>/entities/<alias>` | `B1`, `B1.F2`, `B1.E1`, `B1.V1` | Exact entity detail (geometry, identity, relations, source, construction origin); out-of-range alias 400; unknown model 404 | RV, GS |
| API-09 | `GET /api/source/<sha>` | sha from an inspector source block | `{file, sha256, text}` from the frozen snapshot; unknown 404 `Exact source snapshot unavailable; use the recorded call excerpt`; changed snapshot bytes 400 | RV |
| API-10 | `GET /api/reports/<id>` | ids `acceptance`, `comparison`, `visual`, `curved-visual`, `hardware` read from `out/acceptance/report.json`, `out/comparison-demo.json`, `out/visual-comparison/report.json`, `out/curved-visual-comparison/report.json`, `out/hardware/report.json` | Report JSON; missing file -> report absent; unknown id 404 | RV |
| API-11 | `GET /api/reports/<id>/images/[<generation>/]<file>` | URL from a visual report `views[].images.*.url` | PNG only if bytes match the recorded SHA-256 (else 400); URLs of earlier generations stay valid for the server lifetime; unknown 404 | RV |
| API-12 | `GET /api/feedback/WKR-XXXXXXXXXX` | id from a saved review | Record plus `url`, `file`, `contextFile`, `contextUrl`; missing -> 404 whose message is the raw ENOENT text with the absolute path | RV |
| API-13 | `GET /api/feedback/<id>/context` | curl | `text/plain` LLM context: notes, annotations with aliases, body overview per model, entity detail route, `wonky-inspect` command | RV |
| API-14 | `POST /api/feedback` | Save a review in the UI, or curl JSON | 201 `{id,url,file,contextFile,contextUrl}`; writes `.json` (temp+rename), `.md`, `.context.md`. Rejects: non-JSON 415, >2 MiB 413, unknown models, >30 models, >500 annotations, bad tool, points outside [0,1] or >4000, arrow/box without exactly 2 points, pen <2, text >10000, title missing or >200, notes >30000, bad camera (zoom outside (0,100]), bad view/layout/aspect, unknown target or index -> 400 | RV |
| API-15 | Unknown route | `GET /api/nope` | 404 `Unknown route` | manual |

## 4. Shell, header and notifications

| ID | Feature | How to exercise | Expected today | Tests |
|---|---|---|---|---|
| UI-01 | Brand link | click "Wonky Kernel" | navigates to `./` (reloads, keeps no hash) | manual |
| UI-02 | Workspace status | load | `N model version(s) · Local workspace` | manual |
| UI-03 | Save state | edit after saving | `Unsaved changes`, or `Saved · WKR-...`; hidden under 1150 px | VS |
| UI-04 | Save review button | click | disabled without a model, while loading or saving | VS |
| UI-05 | Copy review button | save first, then click | disabled until saved; copies `Review <id>`, `#review=` URL, LLM context URL, local context path; toast `Review link and code copied` | manual |
| UI-06 | Toast | any copy/save | bottom center, `role=status`, hides after 3.6 s | manual |
| UI-07 | Global error banner | force an API failure | `role=alert`, hides after 8 s (**defect**: an older timer can hide a newer error early) | VS (text only) |
| UI-08 | Icons | load | inline SVG icon set, `aria-hidden`; no network fonts or CDN | manual |

## 5. Library (left column)

| ID | Feature | How to exercise | Expected today | Tests |
|---|---|---|---|---|
| LIB-01 | Models / Checks tabs with counts | click tabs; ArrowLeft/Right/Home/End on a focused tab | switches list, updates search placeholder, clears search | manual |
| LIB-02 | Search filter | type in "Find a model..." | substring match on label and id; `No matching items.` | manual |
| LIB-03 | Model list item | click a model | becomes the **after** model (compare state unchanged), `Open` badge, loads; camera reset; **defect**: list re-renders and keyboard focus is lost to `<body>` | manual |
| LIB-04 | Check list item | Checks tab, click | opens the report drawer (DRW-01); status label `Passed` / `Needs attention` / `Measurements` | VS (drawer) |
| LIB-05 | Refresh workspace | click the refresh icon | re-reads inputs and reports (SRV-08), toast `Workspace refreshed`; resets the camera unless a review is loaded; does not switch to a newly built revision | VS (race) |
| LIB-06 | Saved reviews list | save a review | up to 12 newest, click loads the review | manual |
| LIB-07 | Empty states | start with no reports | `No check reports are available yet.` etc. | manual |

## 6. Version bar and comparison

| ID | Feature | How to exercise | Expected today | Tests |
|---|---|---|---|---|
| CMP-01 | Before / After selects | choose versions | options `label · sha8`; Before disabled when not comparing; After label reads `Model` in single mode | VS |
| CMP-02 | Default pair | start with files named `*before*`/`*after*` | before = first label matching /before/i else first model; after = /after/i else second model | manual |
| CMP-03 | Compare on by default | start with >= 2 models | wipe compare is active immediately, even for unrelated models (target direction changes this; spec must record it) | manual |
| CMP-04 | Compare toggle | click `Compare` | single-model view; disabled with < 2 models; single model forces compare off | manual |
| CMP-05 | Swap | click the swap icon | exchanges before/after; disabled in single mode | manual |
| CMP-06 | Wipe layout | `Wipe` | one viewport, before left of the divider, after right; picking follows the divider | VS |
| CMP-07 | Split slider and handle | drag slider or handle; ArrowLeft/Right on the handle (2 %) | output `53 / 47`; marks a saved review dirty | VS |
| CMP-08 | Side by side | `Side by side` | two complete panes, same camera and scale, each pickable, `Linked camera` label; tool rail moves to bottom center | VS |
| CMP-09 | Shared bounds | compare two models of different size | both panes share combined bounds and one camera; no automatic alignment | VS |
| CMP-10 | Comparison bar | compare mode | short hashes of both versions; hidden in single mode | manual |

## 7. Viewport rendering and display honesty

| ID | Feature | How to exercise | Expected today | Tests |
|---|---|---|---|---|
| VP-01 | WebGL shading | open a model | server display triangles, one fixed color for all bodies, two-sided headlight, orthographic | manual |
| VP-02 | Edges | open a model | B-rep edges as 1 px lines in dark green (low contrast; hard to see) | manual |
| VP-03 | Display tolerance | inspect `display.toleranceMm` | 0.02 mm; circles/ellipses sampled so chord error <= tolerance; cylinders/cones tessellated in Bend | RV, DC |
| VP-04 | Boundary-only faces | model with an unsupported trimmed face | face drawn as edges only; viewport note `k face(s) shown as boundaries only`; inspector lists causes | DC, manual |
| VP-05 | Diagnostic model note | model with `diagnostic.purpose` (e.g. `out/r10b-first-failure-inputs.brep.json`) | purpose text appended to the viewport note | manual |
| VP-06 | Model title and summary | open | `<h1>` label; `N bodies · M faces · sha8` | manual |
| VP-07 | Viewport messages | no WebGL / API down / no models / load failure / context loss | `3D display unavailable`, `Workspace unavailable` (+Try again), `No models yet`, `Model could not be opened` (+Try again), `3D display was interrupted` (no automatic recovery) | VS (load failure) |
| VP-08 | Units | look at footer and viewport | `mm` pills (static) | manual |
| VP-09 | **defect** Mirrored projection | Top preset on the L bracket | shows +Y downward while picking the +Z cap: every view is a mirror image (`out/viewer/audit/code/05-top-preset-bracket.png` vs `out/visual-comparison/1-after.png`) | none |

## 8. Navigation and camera

| ID | Feature | How to exercise | Expected today | Tests |
|---|---|---|---|---|
| NAV-01 | Orbit | drag with Select or Orbit tool; Alt-drag with drawing tools | yaw/pitch 0.008 rad per px, no pitch clamp | manual |
| NAV-02 | Pan | Shift-drag, middle or right button | pan in units of model extent | manual |
| NAV-03 | Zoom | mouse wheel | factor exp(-deltaY/1000), clamped 0.05..25, zooms about the view center (not the cursor) | VS (hover invalidation only) |
| NAV-04 | Keyboard orbit | focus canvas, arrow keys | 0.12 rad per press | VS (hover invalidation only) |
| NAV-05 | Fit | `F` or fit button | resets camera to iso default and preset index | VS (hover invalidation only) |
| NAV-06 | Standard views | cube button | cycles Isometric, Front, Top, Side with a toast (VP-09 applies) | VS (hover invalidation only) |
| NAV-07 | Camera marks review dirty | move camera after saving | `Unsaved changes` | manual |
| NAV-08 | Context menu suppressed | right-click canvas | no browser menu | manual |
| NAV-09 | Camera is bounds-relative | switch models | center/extent recomputed from bounds; pan and zoom are relative to extent | manual |

## 9. Hover, selection and picking

| ID | Feature | How to exercise | Expected today | Tests |
|---|---|---|---|---|
| SEL-01 | Selection mode | select `Auto select / Faces / Edges / Points / Bodies` | filters picking and hover; hidden under 650 px | VS |
| SEL-02 | Hover preview | move over the model | face shaded light, edge as SVG polyline, point as dot; only in the pane under the pointer; cursor `pointer` | VS |
| SEL-03 | Hover never mutates | hover with a saved review open | selection, inspector, panel, dirty state, annotations unchanged | VS |
| SEL-04 | Hover invalidation | leave canvas, window blur, pointerdown, wheel, arrow keys, mode/tool/layout/model change, fit, presets | hover cleared, including a pending frame | VS |
| SEL-05 | Click select | click without dragging (Select tool) | Auto priority: point within 7 px, edge within 6 px, then face; copper highlight | VS |
| SEL-06 | Occlusion-aware picking | point/edge behind a face | not hover- or click-pickable | VS |
| SEL-07 | Pane-aware picking | wipe or side by side | picks the model visible at that pixel; outside the canvas returns nothing | VS |
| SEL-08 | Clear selection | `Escape` | selection cleared, report closed, tool reset to Select | manual |

## 10. Inspector (right column, Inspect tab)

| ID | Feature | How to exercise | Expected today | Tests |
|---|---|---|---|---|
| INS-01 | Empty states | no model / no selection | `Your model, in detail` / `Select something to inspect` | manual |
| INS-02 | Model overview | no selection | bodies, faces, size (bounds extents, mm), version; display warnings in a disclosure | manual |
| INS-03 | Body list | click a body row | selects that body | manual |
| INS-04 | Selection properties | select face/edge/point/body | Model, Body, Version; Surface + boundary edge count (face); Curve (edge); X/Y/Z to 5 decimals (point); faces, edges, volume from validation (body, `Not measured` if absent); Role; Identity scope (`Semantic role` / `Frozen source ID` / `This model revision only` / `Unattributed`) | VS |
| INS-05 | Unresolved split/merge note | select a Boolean output | note shown before the source section | VS |
| INS-06 | Comment on selection | `Comment` button | adds a comment annotation targeted at the selection (ANN-03) | manual |
| INS-07 | Copy reference | `Copy reference` | JSON: modelId, bodyId, entityType, entityIndex, alias `B1.F2`, compact identity (lineage without history), source | VS |
| INS-08 | Browse geometry | `Browse geometry` select | reaches every body/face/edge/point including hidden or boundary-only ones (**defect**: re-render drops keyboard focus) | manual |
| INS-09 | Operation source | select an entity of a traced model | file, `Line l:c`, sha8, 6-line excerpt with the call line highlighted | VS |
| INS-10 | Copy source reference | button | source descriptor JSON copied | manual |
| INS-11 | Open frozen source | button (only with sha256) | drawer with full frozen text, call line highlighted and scrolled into view | VS |
| INS-12 | Construction history | disclosure | call stack frames with call lines, operation name/status/id, operation parameters JSON | manual |
| INS-13 | Earlier body operations | disclosure (Boolean/transform outputs) | lineage history entries with type, id, source excerpt | VS |
| INS-14 | Display warning per face | select a boundary-only face | its reason | manual |
| INS-15 | Reference block | any selection | body id, type, index, identity id | manual |
| INS-16 | LLM context copy | `Copy model overview` / `Copy selected geometry` | overview: `/summary?format=text&level=bodies`; selection: `/entities/<alias>` JSON; toasts | manual |

## 11. Annotations (tool rail and Review tab)

| ID | Feature | How to exercise | Expected today | Tests |
|---|---|---|---|---|
| ANN-01 | Tools | rail buttons or `V H C A R P` | Select, Orbit, Comment, Arrow, Box, Pen; `aria-pressed`; hint text per tool | VS (hover invalidation only) |
| ANN-02 | Comment tool | `C`, click model | numbered comment at the click, target = picked entity (or none), Review tab opens, textarea focused | manual |
| ANN-03 | Add comment button | `+` in Review tab | with selection: comment at the selection centroid; without: switches to Comment tool, toast | manual |
| ANN-04 | Arrow / Box / Pen | drag on the canvas | arrow with head, rectangle, freehand (<= 4000 points); a click without drag creates nothing | manual |
| ANN-05 | View-bound display | change camera, models, layout or split | non-matching annotations hidden; chip `N annotations in other views · Restore` restores the first hidden one | VS |
| ANN-06 | Aspect-ratio rescale | resize the window | points rescaled with `view.aspect`, per pane in side by side | VS |
| ANN-07 | Annotation cards | Review tab | number, type, jump (restores models, layout, split, camera, target), remove, note textarea (active card, max 10000), preview, target label | VS |
| ANN-08 | Undo last | `Cmd/Ctrl-Z` outside text fields, or undo button | removes the last annotation | manual |
| ANN-09 | Limit | 500 annotations | toast asking to save and start another review | manual |
| ANN-10 | Legacy annotations | review saved without `layout` | restores as wipe | VS |

## 12. Reviews

| ID | Feature | How to exercise | Expected today | Tests |
|---|---|---|---|---|
| REV-01 | Title and notes | Review tab fields | title max 200 (empty -> `<model label> review`), notes; edits mark dirty | VS |
| REV-02 | Save | `Save review` or `Cmd/Ctrl-S` | POST (API-14), toast `Review saved · WKR-...`, URL `#review=<id>`, saved detail box | VS |
| REV-03 | Save races | edit notes/model/layout while saving, or load another review | stale save does not overwrite newer state; toast `Earlier review snapshot saved`; no duplicate POST | VS |
| REV-04 | Load | saved list, `#review=<id>` at startup, `hashchange` | restores models, compare, layout, split, camera, annotations, title, notes | VS |
| REV-05 | Load races | start two loads, or navigate during a load | the newest navigation wins; late success or failure is ignored | VS |
| REV-06 | Copy LLM context | saved detail box button | text of API-13; toast | manual |
| REV-07 | Revision binding | save, rebuild input, refresh, reopen | annotations stay on the saved revision; no automatic remapping | RV |

## 13. Report and source drawer

| ID | Feature | How to exercise | Expected today | Tests |
|---|---|---|---|---|
| DRW-01 | Check report view | Checks tab item | status badge, scope; acceptance: stages complete, references passed, operations completed, error with line:column, stage rows; comparison: added/removed/common volume, minimum distance; visual: changed-pixel percentage per view and before/after/diff images (open in new tab); limitations; full JSON disclosure | VS |
| DRW-02 | Source snapshot view | INS-11 | file name, sha, numbered lines | VS |
| DRW-03 | Close | close button or `Escape` | hides the drawer, invalidates pending loads | VS |
| DRW-04 | Latest-wins | open report A then B quickly | only B's content shown | VS |

## 14. Keyboard

| Key | Action | Guard |
|---|---|---|
| V, H, C, A, R, P | Select, Orbit, Comment, Arrow, Box, Pen | not while typing; no modifiers |
| F / E | Fit / toggle edges | not while typing |
| Arrow keys | orbit | canvas focused |
| Cmd/Ctrl-S | save review | always |
| Cmd/Ctrl-Z | remove last annotation | not while typing |
| Escape | cancel gesture, Select tool, close drawer, clear selection, blur field | always |
| ArrowLeft/Right, Home, End | move between tabs | focused tab list |
| ArrowLeft/Right | move wipe divider | focused handle |

Covered: VS (ArrowRight hover invalidation only); the rest manual.

## 15. Layout, responsiveness and accessibility

| ID | Feature | How to exercise | Expected today | Tests |
|---|---|---|---|---|
| RSP-01 | Wide (>= 1600 px) | resize | wider columns | manual |
| RSP-02 | <= 1150 px | resize | narrower columns, header status hidden, compare label icon only | manual |
| RSP-03 | <= 900 px | resize | inspector floats over the viewport bottom right; in side by side it sits below | manual |
| RSP-04 | <= 650 px | resize | stacked: horizontal library strip, viewport, inspector below; selection mode hidden | manual |
| A11Y-01 | Landmarks and labels | screen reader / snapshot | labelled regions, tool rail `role=toolbar`, tabs with `aria-selected`, labelled selects/inputs, canvas `aria-label` + tabindex | manual |
| A11Y-02 | Focus visibility | Tab through | 2 px green focus outline | manual |
| A11Y-03 | Reduced motion | OS setting | button transitions off | manual |

## 16. Files on disk

| ID | Artifact | Written by | Notes |
|---|---|---|---|
| FS-01 | `<reviews>/models/<sha>.brep.json` | server start, refresh | immutable, `wx` |
| FS-02 | `<reviews>/sources/<sha>.txt` | server start, refresh | only for sources inside the repo root with matching hash |
| FS-03 | `<reviews>/WKR-*.json` | POST | temp + rename |
| FS-04 | `<reviews>/WKR-*.md` | POST | human summary |
| FS-05 | `<reviews>/WKR-*.context.md` | POST; rewritten on reads if stale | port-independent text |

## 17. Related tools that depend on viewer modules

| ID | Tool | How to exercise | Depends on |
|---|---|---|---|
| TOOL-01 | `node bin/wonky-inspect.mjs <model.brep.json> [--bodies-only] [--detail B1.F2 --revision <sha>] [--lookup ...] [--format json]` | offline overview/detail; referenced by LLM context | `src/geometry-summary.mjs` |
| TOOL-02 | `displayMesh()` in `src/display-export.mjs` | DE tests | `reviewScene()` from `src/review-scene.mjs` |
| TOOL-03 | Display evidence `WONKY_DISPLAY_EVIDENCE=1 node --test test/display-cylinder.test.mjs` | writes `out/viewer-trims/regression.json` with SHA-256 of `src/review-scene.mjs` | changing `review-scene.mjs` invalidates the recorded hash |
