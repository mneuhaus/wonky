# Viewer code and architecture audit

Date: 2026-09-22. Role: code and architecture auditor. Scope: `viewer/app.js`,
`viewer/index.html`, `viewer/style.css`, `src/review-server.mjs`,
`src/review-scene.mjs`, `bin/wonky-view.mjs`, their tests, and the production
build pipeline the live mode will drive. The regression checklist that goes
with this audit is [feature-inventory.md](feature-inventory.md).

## 1. Summary

The viewer works and its revision/identity discipline is good: model ids are
content hashes, reviews bind to immutable snapshots, sources are frozen by
hash, display failures are reported instead of hidden, and 17 regression tests
guard stale asynchronous responses. The structure is the problem. One 67 KB
script holds 25 blocks of responsibility in one scope, with 28 fields in one
mutable `state` object, 14 more module-level variables, 69 hard-wired DOM ids
and HTML built from strings. The test harness depends on that layout: it slices
`app.js` as text and re-binds function names inside a `vm` context.

Two correctness defects stand out:

1. **Every view is a mirror image.** The projection in `project()` and in the
   vertex shader has determinant -1 (screen right x screen up points away
   from the viewer). Verified: the "Top view" preset of the L bracket shows
   +Y downward while a click picks the +Z cap (`out/viewer/audit/code/05-*.png`,
   `07-*.png`); the independent render `out/visual-comparison/1-after.png`
   shows the correct L. Handed parts (for example the r10b left and right rail
   carriers) appear as their mirror twins.
2. **The camera is bounds-relative.** Pan and zoom are scaled by the current
   model extent and centered on the current bounds, so any model change moves
   the view. A live loop that "keeps the camera" needs a world-space camera.

Live mode is feasible without new dependencies. The measurements decide its
shape: starting a build process costs 0.83-1.10 s (0.68-0.91 s of it is Bend
kernel loading), while a warm build of every example takes 2-78 ms. A
persistent, pre-warmed build process gets save-to-screen latency for Marc's
part sizes to roughly 0.1-0.3 s. The r10b fixture runs about 55 s before
failing, and nothing can interrupt a synchronous build, so cancellation means
killing the process and promoting a warm spare.

## 2. Method and evidence

- Read all six files completely, plus `test/viewer-state.test.mjs` (32
  tests), `test/review.test.mjs` (7), `src/index.mjs`, `src/python.mjs`,
  `python/runner.py`, `src/modules.mjs`, `src/source-map.mjs`,
  `src/geometry-summary.mjs`, `src/display-export.mjs`, `src/comparison.mjs`,
  `src/section.mjs`, `bin/wonky.mjs`, `bin/wonky-python.mjs`, and Marc's
  `~/Workspace/cad/*/watch.py` (read only).
- Baseline tests (focused, niced): viewer-state 32/32, review 7/7,
  display-export + display-cylinder + geometry-summary 18/18.
- Pipeline latency: `scripts/viewer/measure-pipeline.mjs` (new). Result in
  `out/viewer/audit/code/pipeline-latency.json`. Python cases ran through a
  `uv run --no-project python` wrapper, never `python3`.
- Client costs, payload breakdown, determinism and handedness evidence:
  `out/viewer/audit/code/client-cost.json` (helpers in
  `tmp/viewer/audit-code/`).
- Browser QA: my own viewer on port 4391 with a private review directory,
  driven by `agent-browser --session wonky-code-audit`. Screenshots are in
  `out/viewer/audit/code/`. No console errors were observed. The instance and
  the session were stopped afterwards.
- The machine was shared and loaded (load average 13-17 on 18 cores), so the
  timings are upper bounds for this hardware on the JavaScript Bend target.
  They say nothing about native or GPU targets.

## 3. Current module map

### 3.1 `viewer/app.js` (710 lines, 58 lines over 200 characters, longest 1274)

| Lines | Responsibility | Main functions / globals |
|---|---|---|
| 1-7 | DOM and format utilities | `$`, `$$`, `escape`, `clone`, `clamp`, `number`, `short` |
| 8-37 | Icon set, hydration of `[data-icon]` | `paths`, `icon` |
| 39-47 | Global state | `state` (28 fields), `gl`, `program`, `uniforms`, attribute locations, `highlight`, `hoverHighlight`, `framePending`, `toastTimer` |
| 49-69 | API client, notifications | `api`, `notify`, `showError`, `changed`, `viewportMessage` |
| 71-115 | WebGL setup and buffers | `initWebGL` (inline GLSL), `gpuBuffer`, `triangleData`, `edgeData`, `prepareScene`, `renderBuffer` |
| 116-145 | Panes and camera math | `activeScenes`, `sharedBounds`, `viewPanes`, `paneAt`, `cameraFactor`, `project` |
| 146-177 | Frame loop and drawing | `scheduleDraw`, `drawModel`, `draw` (also moves the wipe divider and redraws the SVG overlay) |
| 178-220 | Annotation view matching and SVG overlay | `sameCamera`, `currentView`, `viewMatches`, `annotationPoint`, `drawingMarkup`, `renderOverlay` (also draws edge hover/selection polylines) |
| 222-279 | CPU picking and highlight buffers | `triangleHit`, `segmentHit`, `pick`, `selectedRecords`, `sameReference`, `referenceHighlight` |
| 280-305 | Hover and selection | `hoverPoint`, `hoverFramePending`, `setHover`, `clearHover`, `previewAt`, `select` |
| 306-346 | Inspector content builders | `sourceFor`, `sourceMarkup`, `selectionIdentity`, `geometryAlias`, `appendGeometryCopy` |
| 347-364 | Drawer loading | `drawerRequest`, `closeReport`, `drawerData`, `openSource` |
| 365-397 | Inspector rendering | `renderInspector` |
| 399-408 | Panels and tools | `panel`, `tool` |
| 409-444 | Annotations | `addAnnotation`, `annotationAt`, `commentOnSelection`, `renderAnnotations`, `restoreAnnotation` |
| 446-486 | Pointer input | `gesture`, canvas pointer/wheel handlers (orbit, pan, zoom, draw, select) |
| 488-499 | Wipe and layout | `setSplit`, `setLayout`, `wiping`, handle handlers |
| 501-544 | Control sync and model loading | `modelLabel`, `syncControls` (updates about 25 elements, calls `renderLibrary`), `loadScene`, `loadSelectedModels` |
| 545-568 | Library | `libraryTab`, `status`, `renderLibrary`, `renderSaved` |
| 569-589 | Workspace refresh and default pair | `workspace` |
| 591-605 | Report drawer | `openReport` |
| 606-612 | Clipboard | `copyText` (execCommand fallback) |
| 613-655 | Review save/load | `savedState`, `reviewPayload`, `saveReview`, `loadReview` |
| 657-698 | Wiring | button handlers, keyboard shortcuts, `hashchange` routing, `ResizeObserver`, context loss |
| 700-710 | Startup | `startupWorkspace`, the `try { initWebGL(); ... }` block the test harness slices at |

`index.html` is one static shell with 65 ids; `style.css` is 15 physical lines
(one of 18.5 KB) with later rules appended after the media queries that
override earlier ones (for example `.comparison-bar` height 67 px, then 88 px;
two conflicting `.comparison-range output` positions).

### 3.2 Server side

| File / lines | Responsibility |
|---|---|
| `review-server.mjs` 1-30 | value validators (`text`, `camera`, `view`) |
| 32-61 | `validateReview` (exported): annotation/target validation, alias computation |
| 63-96 | `register`: hash, parse, geometry inspector, display scene, source freezing, archive write, publish to four maps |
| 97-107 | startup registration of inputs and every archived snapshot |
| 108-134 | fixed report list, image registry with generation-bound URLs |
| 135-160 | `saved` (reads a review, rewrites its context file if stale), `contextText` |
| 161-218 | one `createServer` callback with a regex `if` chain for 14 routes |
| 219-221 | listen after all registration work |
| `review-scene.mjs` | display scene: edge sampling by tolerance (in Bend), planar faces via earcut with coverage check, cylinders via `display-cylinder.mjs`, cones with two full rims only; per-face failures become `displayWarning`; unsupported edge curves reject the whole model |
| `bin/wonky-view.mjs` | argument parsing, start, signal handling |

Data flow today: `.brep.json` file -> `register()` (inspector + scene, all on
the server's event loop) -> `/api/workspace` lists metadata -> browser fetches
`/api/models/<sha>` (whole scene JSON, pretty-printed) -> `prepareScene`
uploads GPU buffers -> `draw()` per frame; `pick()` projects every triangle in
JavaScript per hover frame.

## 4. Global state and coupling

- `state` mixes six concerns: server data (`workspace`, `scenes`), GPU
  resources (`buffers`), view (`before`, `after`, `compare`, `layout`,
  `split`, `camera`, `center`, `extent`, `showEdges`, `preset`), interaction
  (`tool`, `mode`, `selection`, `hover`, `hoverPane`, `pending`), the review
  document (`annotations`, `activeAnnotation`, `saved`, `dirty`, `saving`) and
  async bookkeeping (`loading`, `request`). Most used: `after` (28
  references), `camera` (24), `workspace` and `saved` (22).
- 14 further mutable module variables live outside `state` (GL handles,
  highlight buffers, frame flags, `gesture`, `wiping`, `drawerRequest`,
  `hoverPoint`, `toastTimer`).
- The DOM is part of the state: review title and notes exist only in input
  values and are read back by `reviewPayload()`; the selection mode select is
  mirrored into `state.mode`.
- There is no change notification. Each mutation calls its own mix of
  `syncControls`, `renderInspector`, `renderAnnotations`, `scheduleDraw` and
  `changed`. The dirty rule is inconsistent: most camera and model changes
  use `if (state.saved) changed()`, while `setLayout`, swap and the compare
  toggle call `changed()` unconditionally.
- The renderer reads interaction and review state directly (`drawModel` reads
  hover, selection, `showEdges`; `draw` writes the wipe divider style and
  calls `renderOverlay`).
- Camera math exists twice, in GLSL and in `project()`. They agree today,
  including on the mirroring.
- The alias `B<n>.F<m>` is implemented three times: `geometryAlias` in
  `app.js`, inline in `validateReview`, and `aliasFor` in
  `geometry-summary.mjs`. The `.md` written on POST duplicates part of
  `contextText`.
- Test coupling: `viewer-state.test.mjs` evaluates `app.js` source up to the
  literal `\ntry { initWebGL();` in `node:vm`, then reassigns
  `renderInspector`, `scheduleDraw`, `renderAnnotations`, `renderLibrary`,
  `renderSaved` and `panel` by name. Any `import` statement in `app.js` breaks
  the harness, so the migration has to change the harness first (section 11).

## 5. Dead code and duplication

- Unused icon `check`; unused CSS `.model-warning` and `.icon svg`; the static
  `#revision-hint` id is never referenced.
- Six inline `style=""` attributes in generated HTML (source buttons, LLM
  context, saved detail).
- A second, older renderer exists in `src/preview.mjs` and
  `src/preview-client.js` (standalone `.html` export, planar only). It is not
  mine to change; once the viewer renderer is a module it could be shared.

## 6. Error handling

Good: every async entry point catches and shows errors; display failures are
per face with reasons; capability errors from the kernel pass through
unchanged; a failed refresh publishes nothing.

Gaps:

| # | Issue | Effect |
|---|---|---|
| E1 | Unsupported edge curve types (anything but line/circle/ellipse) throw in `reviewScene` | The whole model cannot be opened, not even in the inspector; as a CLI input the server does not start |
| E2 | One corrupt review JSON, or a review whose model snapshot is missing, fails `GET /api/workspace` | The UI shows "Workspace unavailable" for everything |
| E3 | Every non-ENOENT error becomes 400 | Server bugs look like client errors; unknown model scene is 400 but unknown summary is 404 (RV asserts the 400) |
| E4 | ENOENT messages go to the client verbatim | Unknown review ids show a raw path error in the banner |
| E5 | `showError` does not clear the previous timer | An older 8 s timer can hide a newer error early |
| E6 | WebGL context loss has no restore path | The user must reload; buffers are not rebuilt |
| E7 | Registration (display prep up to 1.1 s for r10b-scale) runs on the server's event loop, and `createReviewServer` binds the port only after all of it | The server stalls during refresh; a busy port is reported only after seconds of work and after snapshot files were written |
| E8 | `GET /api/workspace` has side effects (registers revisions, writes files) | Any reader, including another tool or agent, can change the registry; concurrent refreshes register the same bytes twice |

## 7. Asynchronous races

Existing guards, all covered by tests:

- `state.request` generation token shared by `workspace`,
  `loadSelectedModels`, `loadReview` and `restoreAnnotation`; results of
  superseded calls are ignored (VS: 9 tests, plus one that checks a
  current failure still reaches the caller).
- `drawerRequest` token for report and source drawers (VS: 3).
- `saveReview` compares the posted payload with the current one before it
  applies the result (VS: 5).
- Hover is coalesced to one pick per animation frame and cleared on every
  navigation event (VS: 5).
- `startupWorkspace` only opens the URL review if nothing newer happened.

Remaining gaps:

- Ignored requests keep downloading (no `AbortController`); a superseded
  r10b-scale scene is 9 MB.
- `loadScene` has no in-flight de-duplication; two navigations can fetch the
  same scene twice.
- `Copy selected geometry` and `Copy LLM context` have no staleness check.
- `startupWorkspace` relies on `workspace()` incrementing the counter exactly
  once.
- Interaction is blocked while `state.loading` is true. With live updates the
  viewer would freeze on every revision instead of swapping when ready.

## 8. Accessibility

Good: labelled regions, `role=toolbar`, tab lists with arrow/Home/End keys,
`aria-pressed` tools, labelled inputs, focusable canvas with keyboard orbit,
keyboard-operable wipe handle, `role=status` toast, `role=alert` errors,
visible focus rings, reduced-motion support, and "Browse geometry" as a
keyboard route to every entity.

Gaps:

- Focus loss: `renderLibrary` and `renderInspector` replace `innerHTML`, so
  clicking a model or changing "Browse geometry" drops focus to `<body>`
  (verified in the browser). The entity select is unusable with arrow keys.
- Contrast: `.muted` text 3.9:1 on white, library details 3.8:1, viewport hint
  2.6:1, inspector footer 2.7:1, source line numbers 2.0:1; many labels are
  8-10 px. The display-approximation note ("faces shown as boundaries only"),
  which carries an honesty-critical message, is 9 px at 3.8:1.
- Single-key shortcuts cannot be turned off (WCAG 2.1.4).
- Tabs have no roving `tabindex`; the report drawer does not move or return
  focus; toasts disappear after 3.6 s.
- The canvas label always mentions comparison cameras, even in single mode.

## 9. Performance and payload

| Measurement | Result |
|---|---|
| Scene JSON served for `r10b-retained` (5 bodies, 172 faces, 5242 triangles) | 9.07 MB pretty-printed (all responses use 2-space indent), 5.65 MB compact |
| Composition of that compact scene | triangles 23 %; identity 3.36 MB, of which about 1.67 MB duplicates `body.identity.topology` into every face, edge and vertex; per-entity copies of the body source with excerpt text 0.71 MB |
| CPU pick per hover frame | 0.9 ms at 266 triangles, 16 ms at 5242 triangles (linear, about 3 us per triangle) |
| SVG overlay | fully rebuilt as a string every frame, including all annotations (up to 500 x 4000 points) |
| Browser caches | `state.scenes` and GPU `state.buffers` are never evicted; each live revision would add its scene and buffers |
| Display scene preparation | 0.6-21 ms warm for the examples; first call per process 156-182 ms, or about 0.8 s when cylinder display loads; `r10b-retained` 1.1 s in a fresh process |

## 10. Security (local tool, loopback only)

- The Origin check covers cross-origin writes. The Host header is not checked,
  so a DNS-rebinding page could read `/api/source/<sha>` and reviews.
  Planned SSE and live-control endpoints should add a Host allowlist
  (`127.0.0.1:<port>`, `localhost:<port>`).
- Static serving is a 3-file whitelist (safe, but blocks ES modules). The
  replacement must normalize paths and serve only `viewer/**` with known
  extensions.
- HTML is built with manual `escape()` calls. I found no injection, but a
  tagged template that escapes by default removes the risk class.

## 11. Test coverage

- `viewer-state` (32): inspector identity and source rendering (5), stale
  review/model/workspace/save/report/source/startup responses (17) plus one
  current-failure check, pane
  layout, picking, occlusion, hover lifecycle, overlay clipping, annotation
  projection and legacy layouts (9). WebGL, layout, CSS and real pointer
  gestures are outside it.
- `review` (7): display retention on the bored spacer, report images and
  generations, frozen source, rejected refresh, corrupt archive, feedback
  validation, cross-origin write, context files.
- `display-cylinder`, `display-export`, `geometry-summary`: display and
  summary contracts.
- Not covered: `bin/wonky-view.mjs`; static routes and content types; `/`
  redirect; 413/415; text summary; `hashchange`; most keyboard shortcuts;
  drawing gestures; undo; the restore-hidden chip; copy buttons; library and
  saved lists (stubbed out in tests); compare toggle and swap; context loss;
  responsive layouts; accessibility. Of 131 checkable inventory rows, 62 are
  manual-only or untested and 5 are only touched indirectly.

## 12. Findings by severity

| ID | Severity | Finding |
|---|---|---|
| F1 | high | Mirrored projection (section 1). Fix in one camera module shared by shader and picker. Saved reviews store yaw/pitch plus screen-space drawings, so they need a camera-convention version and a compatibility rule |
| F2 | high | Bounds-relative camera and `sharedBounds()` on every load: the view jumps when a revision changes size; a live loop cannot keep the camera |
| F3 | high | Single-scope architecture and text-slicing test harness block parallel work and ES modules |
| F4 | medium | Scene payload is metadata-dominated (9 MB for r10b-scale), re-downloaded per revision, with unbounded browser caches |
| F5 | medium | CPU picking is linear per hover frame (16 ms at 5k triangles) |
| F6 | medium | Registration runs on the server's event loop, and `GET /api/workspace` mutates state (E7, E8) |
| F7 | medium | One bad review file or one unsupported edge type makes the workspace or model unusable (E1, E2) |
| F8 | medium | Compare-first default, list click keeps an unrelated "before", refresh does not follow the rebuilt file and resets the camera |
| F9 | medium | Focus loss on re-render; low contrast and 8-10 px text, including the approximation warning |
| F10 | medium | Model "Size" in the inspector comes from display vertices and edge samples (an envelope that can fall short of the true extent by up to the 0.02 mm chord tolerance on curved edges). It is not labelled as a display value, although project rules require that |
| F11 | low | Edges are 1 device-pixel dark-green lines on green faces (hard to see at DPR 2); one color for all bodies |
| F12 | low | Status codes (400 vs 404), raw ENOENT messages, error-banner timer, no WebGL restore, Host header unchecked |
| F13 | low | Dead code, inline styles, appended CSS overrides, three alias implementations |

## 13. Target structure

### 13.1 Principles

Native ES modules and plain CSS, served as they are (no build step, no CDN,
no new npm dependency). One composition root. Features plug into named
extension points, so parallel work adds files and at most one line in a
registry. Each JavaScript line fits in 100 characters, with one statement per
line; a small dependency-free checker enforces this for new files.

### 13.2 Client layout

```text
viewer/
  index.html            shell with data-slot regions; loads styles/base.css and main.js
  main.js               boot only: createViewer(window)
  app.js                createViewer(env, options): composition root (name kept; tests import it)
  core/
    store.js            explicit store (below)
    requests.js         latest-wins scopes with AbortController (replaces request counters)
    api.js              json/text/post helpers, error mapping, abort support
    events.js           SSE client: reconnect, Last-Event-ID, hello snapshot
    dom.js              escaping `html` tagged template, focus-preserving patch helpers
    icons.js, format.js exact vs display labels, units, tolerance text
    commands.js         command registry: id, run, label, shortcut, enabled(state)
    keyboard.js         shortcuts derived from commands, typing guard, conflict check
    slots.js            extension points (below)
  render/
    camera.js           pure: world-space orbit camera, proper handedness, ortho/perspective, fit, presets
    panes.js            pure: single/wipe/side-by-side pane rectangles
    picking.js          pure CPU picker (today's algorithm, then a spatial index or GPU id pass)
    scene-cache.js      scenes and GPU buffers with LRU eviction by model id
    renderer.js         WebGL with the narrow interface below
    gl.js               program, buffer, pass helpers
  features/
    index.js            ordered feature list, one import per line
    library/  compare/  selection/  inspector/  annotations/  reviews/
    reports/  drawer/  view/  live/          each: <name>.js + <name>.css
    later: parts/ section/ measure/ grid-axes/ viewcube/ build-plate/ overhang/
  styles/
    tokens.css  base.css  layout.css
```

A feature module exports `{ id, styles, setup(ctx) }`. `ctx` holds `store`,
`api`, `requests`, `events`, `renderer`, `overlay`, `slots`, `commands`,
`drawer` and `notify`. `setup` returns a dispose function. Features never
import each other; they talk through the store and commands.

### 13.3 Store

```js
export function createStore(initial) {
  let state = initial;
  const listeners = new Set();
  let depth = 0;
  let batchStart = null;
  const emit = (previous, reason) => {
    for (const listener of [...listeners]) listener(state, previous, reason);
  };
  return {
    get: () => state,
    update(reason, recipe) {
      const previous = state;
      const next = recipe(previous);
      if (next === previous) return;
      state = next;
      if (depth) batchStart ??= previous;
      else emit(previous, reason);
    },
    batch(reason, run) {
      depth += 1;
      try { run(); } finally {
        depth -= 1;
        if (!depth && batchStart) {
          const previous = batchStart;
          batchStart = null;
          emit(previous, reason);
        }
      }
    },
    select(selector, listener, equals = Object.is) {
      let current = selector(state);
      const watch = next => {
        const value = selector(next);
        if (equals(value, current)) return;
        const old = current;
        current = value;
        listener(value, old);
      };
      listeners.add(watch);
      return () => listeners.delete(watch);
    },
  };
}
```

Proposed state slices: `workspace` (models, reports, feedback), `live`
(sources, follow flag, busy, last failure), `view` (primary model, before,
after, compare, layout, split, camera, projection), `display` (edges,
transparency, body visibility and colors, section, grid, axes), `interaction`
(tool, mode, hover, selection, pending drawing), `review` (title, notes,
annotations, active, saved, dirty, saving) and `ui` (library tab, panel,
search, drawer). Scenes and GPU buffers stay in `scene-cache.js`, outside the
store. During migration, `createViewer` returns a `state` facade with
accessors mapped onto the store, so tests that read and assign `ui.state.*`
keep working.

### 13.4 Renderer interface

```text
createRenderer(canvas, env) -> {
  setPanes([{ id, rect, clip, modelId }])
  setCamera(camera)                       world-space; one matrix for GL and picking
  setScene(modelId, scene) / evict(modelId)
  setStyle({ edges, edgeWidth, bodyColors, bodyVisibility, transparency, clipPlanes })
  setHighlights({ hover, selection })     entity references, resolved against cached scenes
  addLayer({ id, order, draw(frame) })    grid, axes, build plate, section caps, overhang tint
  project(point, paneId) -> { x, y, depth }
  pick(x, y, { paneId, mode })            delegates to picking.js
  invalidate(), dispose(), on('contextlost' | 'contextrestored', fn)
}
```

The renderer knows nothing about reviews, annotations or the DOM beyond its
canvas. The SVG overlay is a separate service with ordered layers
(annotations, edge hover, measurement labels).

### 13.5 Extension points

| Slot | Registered by (example) |
|---|---|
| `slots.library.tab` | models, checks, later a parts tree |
| `slots.toolbar.tool` (with pointer handlers and cursor) | select, orbit, comment, arrow, box, pen, later measure |
| `slots.viewActions.button` | edges, fit, presets, projection, section |
| `slots.viewportHud.item` (corner positions) | view cube, axes legend, live build status |
| `slots.inspector.tab` / `slots.inspector.section` (order, `when(selection)`) | inspect, review, live log; source, identity, measurement sections |
| `slots.header.action`, `slots.statusBar.item` | save, copy, live state |
| `overlay.layer` (SVG), `renderer.addLayer` (GL) | annotations, measurements; grid, plate, section caps |
| `commands.register` | every button and shortcut |
| `drawer.open({ title, load(signal), render })` | reports, source, build failure details |

CSS: each feature lists its stylesheets; `app.js` inserts `<link>` elements in
feature order. `tokens.css` holds the custom properties. Rules are formatted
one declaration per line, and there are no inline styles.

### 13.6 Server layout

```text
src/review-server.mjs         facade: re-exports createReviewServer, validateReview (tests unchanged)
src/viewer/server.mjs         lifecycle: bind first, then register; close ends SSE streams
src/viewer/http.mjs           send helpers, Origin + Host checks, body reader, 400/404/500 mapping
src/viewer/static.mjs         viewer/** with path normalization and MIME map
src/viewer/registry.mjs       revisions: serialized register queue, lazy archive scenes, LRU
src/viewer/reports.mjs        report discovery and image registry
src/viewer/reviews.mjs        validateReview, save/load, one context/markdown writer
src/viewer/sources.mjs        source snapshot freezing
src/viewer/events.mjs         SSE hub
src/viewer/live/session.mjs   per-source state machine and revisions
src/viewer/live/watch.mjs     watch set, directory watchers, debounce, content hash
src/viewer/live/pool.mjs      build process lifecycle (busy + warm spare), process-group kill
src/viewer/live/build-worker.mjs   child entry: warm kernel, build, serialize, display scene
src/viewer/live/failure.mjs   error classification and payload
```

New routes: `GET /api/events` (SSE), `GET /api/live` (source status),
`POST /api/live/<source>/rebuild`, `POST /api/live/<source>/cancel`; later
`GET /api/models/<id>/diff/<other>` and a measurement route backed by exact
entity data.

## 14. Live mode design (server)

### 14.1 Command line

`wonky-view part.fs [more inputs] [--feature F] [--param k=v]... [--modules
m.json] [--curved-contacts ...] [--python <exe>] [--port N] [--reviews DIR]`.
`.brep.json` inputs keep today's behavior. `.fs` and `.py` inputs become live
sources. The server binds first, then pre-warms the build process and runs
the first build, so the browser can show "building revision 1".

### 14.2 Watch set

| Source | Files watched | Notes |
|---|---|---|
| `.fs` | the source; `--modules` or sibling `modules.json`; every manifest-listed `parts.json` and body file | Standard-library imports are built in, and namespaced imports resolve only through the frozen manifest, so there is no file-to-file import graph. **Any edit of a source with a manifest fails by design** ("Frozen module manifest does not match the FeatureScript source SHA-256"). Live mode shows that as a provenance error that includes the manifest path. |
| `.py` | the source | The runner starts Python with `-I -S`, so the script's directory is not on `sys.path`: a local `import params` fails with `ModuleNotFoundError` at its line. That error is shown, not hidden. If the runner later allows local modules, it should report the files it loaded, and the watcher re-arms on that list. |

Watch parent directories with `fs.watch` (editors replace files by rename),
filter by name, debounce 75 ms, then read and hash the content. The build
starts only if the SHA-256 changed. The exact bytes that were hashed go to the
worker, which avoids a race between hashing and reading. Fall back to
`fs.watchFile` polling (500 ms) if a watcher errors. Builds are deterministic:
the same source gives the same `.brep.json` bytes as the CLI (verified for
`bored-spacer.fs` and `concave-intersection.fs`), so
revision ids stay comparable with CLI outputs.

### 14.3 Build process

- `child_process.fork(src/viewer/live/build-worker.mjs)` with
  `serialization: 'advanced'` and `detached: true`. A process group lets a
  cancel also kill the Python grandchild. Worker threads would also work
  (`bend-loader` only acts as a compiler worker when its own `workerData` flag
  is set), but a process isolates crashes and memory and makes killing
  simple.
- The worker loads the kernel once, then serves requests: `build(text,
  {sourcePath, feature, parameters, moduleManifest, modelingPolicy})` or
  `buildPython(text, {filename, python, timeoutMs})`; then `JSON.stringify(model,
  null, 2) + '\n'` (the CLI's exact serialization), and then `reviewScene` in
  the same process. The server's event loop only hashes, registers (inspector
  1-30 ms) and notifies.
- The pool keeps one busy process and one warm spare (0.7-0.9 s kernel load
  each). Idle cost is memory only; CPU use is one build at a time per source.
  The worker is recycled after N builds or above an RSS limit.
- Cancellation is latest-wins per source. Builds are synchronous inside the
  worker (r10b runs 55 s without yielding), so a superseded build is killed
  (`SIGKILL` to the group), the spare is promoted and a new spare starts. To
  avoid churn, a build younger than about 250 ms may finish and its result is
  dropped. A superseded result is never announced as current.
- The Python frontend defaults to `python3`. Live mode passes an interpreter
  explicitly; per the project rule, the default for agents is a wrapper that
  runs `uv run --no-project python`. Python's 30 s timeout should be
  configurable, because FeatureScript builds of r10b scale already take 55 s.
- Progress: `build()` creates its source tracker internally, so a worker can
  report only phases (evaluate, serialize, display). Per-operation progress
  ("operation 11, opBoolean, r10b.fs:25:2, in buildUpperCore") needs a small,
  backward-compatible `onOperation` option in `src/index.mjs`. That file is
  outside my paths, so this is a request to its owner. Whether IPC messages
  flush while the worker is blocked needs a short spike.

### 14.4 Revisions and memory

- A successful build becomes a revision `{source, revision n, modelId, sourceSha256,
  builtAt, timings, deltas}`. The model id is still the SHA-256 of the bytes.
- Numeric deltas against the previous good revision: bodies added or removed
  (matched by body id), `validation.volumeMm3` (exact where Bend recorded it,
  otherwise "not measured"), `validation.boundsMm` (exact where present; a
  display envelope with ±0.02 mm is labelled as such), and V/E/F counts and
  surface-type histograms. Geometric highlighting only where the data supports
  it: faces with `semantic` or `source` identity matched by origin id, with
  exact surface-parameter comparison. Revision-local identities are shown as
  "correspondence unavailable". `compareBodiesInBend` supports only coaxial
  cylinders, so a general volumetric diff is a capability error, never a
  mesh fake.
- Live revisions stay in memory (last 20 per source; scenes LRU). They are not
  written to `reviews/models` unless a review references them: the
  POST handler archives referenced revisions. This avoids an ever-growing
  archive, whose snapshots are all re-prepared at every startup today.

### 14.5 Server-Sent Events

`GET /api/events`: `text/event-stream`, `Cache-Control: no-store`, `retry:
2000`, a heartbeat comment every 15 s, and event ids `<session>:<seq>`. A
ring of the last 100 events is replayed after `Last-Event-ID`; otherwise
the server sends a fresh `hello` snapshot. `close()` must end all streams (an
open SSE response keeps `server.close()` waiting). Events:

| Event | Payload |
|---|---|
| `hello` | session id, sources with status, current and last good revision, last failure |
| `source-changed` | source id, changed files, new source hash |
| `build-started` | source id, job id, source hash, queued ms |
| `build-phase` | job id, phase, elapsed ms, operation (when the hook exists) |
| `build-cancelled` | job id, superseded-by job id |
| `revision` | source id, revision, model id, label, timings, deltas, display notes |
| `build-failed` | failure payload (below) |
| `workspace-changed` | reason: revision, review-saved, reports |

Scenes are not pushed; the client fetches `/api/models/<id>` after a
`revision` event. Scene responses are content-addressed and could be cached
with an ETag built from the model hash and the display code version.

### 14.6 Failure payload

```json
{
  "schema": "wonky.live-build-failure/1",
  "sourceId": "r10b",
  "jobId": 17,
  "source": { "path": "/abs/fixtures/r10b/r10b.fs", "sha256": "...", "language": "FeatureScript" },
  "kind": "capability",
  "error": {
    "name": "UnsupportedFeatureError",
    "message": "Native curved convex-tool intersection unresolved: UnsupportedArrangement (tool 1, face 2)",
    "location": { "file": "/abs/fixtures/r10b/r10b.fs", "line": 25, "column": 2 },
    "sourceLine": " opBoolean(c,id+\"op\",{\"tools\":qUnion([aa,bb]),\"operationType\":op});",
    "excerpt": { "firstLine": 23, "text": "..." },
    "traceback": null
  },
  "failedOperation": {
    "sequence": 11, "name": "opBoolean", "operationId": "model/UpperCore/g2/op",
    "callStack": [{ "name": "buildUpperCore", "calledAt": { "line": 1408, "column": 1 } }]
  },
  "completedOperations": 11,
  "timings": { "queuedMs": 3, "buildMs": 55100 },
  "lastGood": { "revision": 16, "modelId": "..." }
}
```

`kind` is `capability` (`UnsupportedFeatureError`), `input`
(`FeatureScriptError`, `PythonExecutionError` with line and traceback),
`provenance` (frozen-manifest mismatch; today this needs a message match, and
a distinct error class in `src/modules.mjs` would be cleaner), `timeout`,
`display` (the model built but `reviewScene` refused it; STEP export may still
work) or `internal` (other error types or a crashed worker; includes the
stack and is reported as a kernel or viewer bug). `failedOperation` comes from
`error.modelTrace` which `build()` already attaches. The example values are
the measured r10b failure in the default `strict` policy.

### 14.7 Client behavior (for the spec)

- Model-first: one model by default; "follow live" moves the primary view to
  each new revision. The swap happens when the new scene is ready, and the
  last good model stays interactive meanwhile.
- The camera is kept by making it world-space (F2) and never re-fitting
  automatically after the first revision.
- The busy indicator appears after 250 ms (fast builds do not flicker). Long
  builds show elapsed time, phase or operation, and a Cancel button.
- On failure, the last good revision stays visible and is labelled "last good
  revision N, source now fails", next to the error location, the excerpt and
  a link that opens the source in the drawer. The UI never shows partial
  geometry.
- Selections are revision-bound. On a new revision they are cleared, unless a
  semantic identity resolves exactly (spec decision). Reviews keep binding to
  exact revisions.

## 15. Measured pipeline latency

JavaScript Bend target, loaded shared machine, milliseconds.

| Case | CLI `--check` (new process) | Kernel load | First build | Warm build | Inspector | Display first / warm | `.brep.json` | Scene served |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| box.fs | 870 | 683 | 6.2 | 1.7 | 0.8 | 159 / 0.9 | 49 KB | 105 KB |
| bracket.fs | 831 | 712 | 7.2 | 2.0 | 1.4 | 156 / 0.8 | 85 KB | 180 KB |
| line-sketch.fs | 880 | 773 | 9.9 | 3.2 | 1.9 | 175 / 1.1 | 78 KB | 105 KB |
| tilted-plate.fs | 875 | 708 | 7.1 | 1.8 | 1.0 | 166 / 1.0 | 60 KB | 124 KB |
| compare-before.fs | 895 | 760 | 7.3 | 1.8 | 0.9 | 798 / 12.4 | 28 KB | 133 KB |
| bored-spacer.fs | 950 | 768 | 13.8 | 5.1 | 1.4 | 805 / 20.5 | 162 KB | 336 KB |
| conical-spacer.fs | 934 | 799 | 7.8 | 2.0 | 0.8 | 182 / 5.3 | 35 KB | 156 KB |
| convex-intersection.fs | 970 | 771 | 52.4 | 24.5 | 2.0 | 163 / 1.4 | 315 KB | 272 KB |
| concave-intersection.fs | 1103 | 777 | 139.9 | 77.6 | 4.3 | 168 / 3.0 | 1.17 MB | 666 KB |
| python-box.py | 922 | 676 | 46.2 | 41.7 | 1.1 | 165 / 0.7 | 59 KB | 123 KB |
| python-spacer.py | 936 | 766 | 63.0 | 49.1 | 1.2 | 827 / 21.4 | 124 KB | 353 KB |
| convex-intersection.py | 1003 | 755 | 113.6 | 76.7 | 1.9 | 174 / 1.8 | 235 KB | 267 KB |
| r10b.fs (`strict`, fails) | 57 807 | 906 | about 55 100 to the error | - | - | - | - | - |

Node start is 22 ms. Python builds include starting `uv run python` (the
Python process is new for every build). The r10b build-to-error time is
derived from the measuring child's wall time (56 088 ms) minus module import,
kernel load and process start; the script now records it directly on
failure. The largest existing model files: `r10b-retained` 1.1 s display
preparation, 9.1 MB scene; `r10b-first-failure-inputs` 0.15 s, 10.4 MB.

Latency budget from save to pixels with a warm worker, for parts of example
size: debounce 75 ms + build 2-80 ms + serialize and hash under 5 ms + display
1-21 ms + register 1-5 ms + SSE and fetch of 0.1-0.7 MB + parse and upload
tens of ms, so about 0.1-0.3 s. A process per save costs 0.9-1.2 s. The first
revision after startup adds kernel load (0.7-0.9 s) and the first display
load (0.16-0.8 s), hidden by pre-warming. r10b-scale sources need progress,
cancel and a responsive last-good view, because their builds take about a
minute.

## 16. Migration plan (every step keeps VS 32, RV 7, DC/DE/GS 18 green)

**Phase 0: baseline (done).** Test counts above; inventory; screenshots and
measurements in `out/viewer/audit/code/`.

**Phase 1: split the server behind the facade.** Move validators,
`validateReview`, context writing, reports, static serving and the router into
`src/viewer/*`. `src/review-server.mjs` re-exports `createReviewServer` and
`validateReview`. No test edits; RV is the gate. Then add, as separate
steps: the Host allowlist; a static handler for `viewer/**` (it must still 404
unknown files); a serialized register queue; lazy display preparation for
archived snapshots, while hash and inspector validation stay at startup (RV
expects corrupt and stale archives to fail startup).

**Phase 2: change the client entry. This is the only step that edits the harness.**
Wrap `app.js` in `export function createViewer(env, { seams })` with no code
at module top level. `env` carries document, window, fetch, history,
location, navigator, requestAnimationFrame, ResizeObserver, timers and
URLSearchParams. Add `viewer/main.js` and load it from `index.html`. In
`viewer-state.test.mjs`, replace only the `viewer()` harness: import
`createViewer`, pass the same fake environment, and replace the string-injected
overrides with `seams`. The 32 test bodies stay byte-identical. Gate: 32/32.

**Phase 3: extract pure modules, one per step.** `core/dom`, icons, format;
`render/panes` and `render/camera` (numerically identical at first);
`render/picking`; `core/requests` (the 17 race tests are the gate);
`core/store` with the `state` facade; then `render/renderer` behind the narrow
interface. New unit tests go to `test/viewer-camera.test.mjs`,
`test/viewer-picking.test.mjs` and `test/viewer-store.test.mjs`. WebGL
changes are checked in the browser against the inventory VP and NAV rows and
the baseline screenshots.

**Phase 4: features through slots, one feature per step.** Library, compare,
inspector, annotations, reviews, reports and drawer, view actions; CSS split
per feature in the same step. Gate: VS, RV and the feature's inventory rows in
the browser.

**Phase 5: deliberate behavior fixes, each with its own tests and a spec
line.** Handedness plus a camera convention version, including a rule for
annotations saved on the mirrored view; world-space camera; 404 for unknown
scenes (edits the RV assertion that expects 400, so it needs a spec
decision); focus-preserving rendering; error banner timer; a lean scene
transport as a separate HTTP serializer (`reviewScene` output unchanged,
because DE and DC depend on it); per-edge display capability errors instead
of whole-model rejection.

**Phase 6: live mode.** Server first (watch, pool, session, SSE, failure
payload), then `features/live`. New `test/viewer-live.test.mjs`: debounce and
content hashing on temp files, latest-wins with a fake worker, SSE framing and
replay, failure classification with a real small build and a deliberately
failing `.fs`, and `close()` with open streams.

**Phase 7: parity features in parallel as feature modules.** Parts tree with
visibility and colors, section through the kernel's `sectionSolid` where it
resolves (capability error otherwise), exact measurement from
`/entities/<alias>` geometry clearly separated from display values,
grid/axes/view cube, orthographic/perspective, transparency, crisp edges,
build plate and overhang shading from exact plane normals with a stated
threshold.

Notes for implementers: changing `src/review-scene.mjs` invalidates the hash
recorded by `WONKY_DISPLAY_EVIDENCE=1` in `out/viewer-trims/regression.json`;
re-record it. Keep the file name `viewer/app.js`, because the tests import it.

## 17. Decisions needed and dependencies

1. `src/index.mjs`: an optional `onOperation` progress callback for live
   progress (outside my paths; needs the owner or product owner).
2. `src/modules.mjs`: a distinct error class for frozen-manifest provenance
   failures (read-only for me).
3. The live Python interpreter default: a `uv run` wrapper, or an explicit
   `--python`.
4. How a manifest-bound `.fs` behaves live: every edit fails by design; show
   that, or disable live mode for such sources.
5. The rule for legacy reviews when the handedness fix lands.
6. The archive policy for live revisions (memory ring plus archive on review
   save, as proposed).
7. A home for test helpers: only `test/viewer*.test.mjs` is writable, and
   `npm test` runs every `test/*.test.mjs`. Proposal: allow `test/viewer/`
   for helpers that are not run directly.
8. The status code change 400 -> 404 for unknown scenes (RV asserts 400).
9. The lean scene format (field set and whether identity loads lazily through
   `/entities`).
