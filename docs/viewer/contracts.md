# Viewer frozen contracts

Status: frozen by the foundation step (spec section 11), 2026-09-22. Changing
anything listed here needs an maintainer decision; packages may only add.
`node scripts/viewer/check-contracts.mjs` checks the DOM ids, the state
facade fields and the harness functions below against the code (and, with
`--browser <url>`, against a running viewer).

## DOM ids

Every id of the pre-foundation `viewer/index.html` still exists after boot.
The markup now comes from the features (see `docs/viewer/foundation.md`); the
id set is unchanged. `#view-presets` opens the standard views (the Views menu
after camera-navigation) and `#fit-view` fits; both clear hover.

```dom-ids
add-comment after-label after-model after-short annotation-count annotation-list
annotation-overlay annotation-total before-model before-short checks-tab close-report
compare-toggle comparison-bar comparison-range comparison-split copy-review display-note
fit-view global-error hidden-annotations inspect-panel inspect-tab interaction-hint
layout-side-by-side layout-wipe library-content library-search linked-camera model-canvas
model-count model-summary model-title models-tab refresh report-content report-count
report-drawer report-title restore-annotation-view review-notes review-panel review-tab
review-title revision-hint save-review save-state saved-review-detail saved-reviews
selection-content selection-mode split-value stage swap-models toast toggle-edges
undo-annotation view-presets viewport-message viewport-message-body viewport-message-title
viewport-retry wipe-divider wipe-handle workspace-status
```

Dynamic ids rendered by features keep their names too: `copy-selection`,
`comment-selection`, `inspect-entity`, `copy-geometry`, `copy-source`,
`open-source`, `copy-context`, and the SVG clip paths
`hover-<side>-clip` / `selection-<side>-clip` and marker `arrowhead`.

Ids added by the work packages (recorded at integration, 2026-09-23; the
same add-only rule applies):

- model-first-compare: `model-bar-title`, `model-bar-name`, `model-bar-revision`,
  `model-bar-newer`, `compare-previous`, `delta-strip`, `delta-details`.
- section: `section-toggle`, `section-panel`, `section-slider`, `section-value`,
  `section-exact`, `section-exact-status`, `section-caps`; debug names
  `sectionState`, `sectionStats`, `setSectionPlanes`, `sectionExact`,
  `sectionNormalFromView`, `sectionDebugGap`.
- help-a11y: `help-toggle`, `settings-toggle`, `help-dialog`, `settings-dialog`,
  `help-filter`, `help-single-keys`, `help-settings`, `help-list`, `help-summary`,
  `settings-list`, `settings-summary`, `inspector-heading`; api functions
  `openHelp`, `closeHelp`, `openSettings`; `core/dom.js` exports
  `captureFocus`, `restoreFocus`, `preserveFocus`, `focusKey`, `focusables`,
  `trapFocus`; `core/keyboard.js` exports and methods `parseKey`, `matches`,
  `isCharacterBinding`, `isCharacterEvent`, `keyLabel`, `setSingleKeyShortcuts`,
  `singleKeyShortcuts`, `describe`.
- `#report-drawer` is `role="dialog"` labelled by `#report-title` (it holds
  reports, frozen source, build failures and deltas).

## Legacy state facade

`createViewer(...).harness.state` (VS) exposes these fields as live, mutable
accessors over the store; the store never freezes a slice. Assigning
`state.selection` replaces the multi-selection `state.selectionSet`.
`state.scenes` is the Map-compatible scene cache (VS sets scenes directly).

```facade-fields
after annotations before camera center compare dirty extent hover hoverPane layout loading
mode panel saved saving scenes selection split workspace
```

Additional fields (not frozen, same rules): `selectionSet`, `tool`, `pending`,
`activeAnnotation`, `tab`, `preset`.

| Field | Owner feature (store slice) |
|---|---|
| `workspace`, `loading`, `tab` | library |
| `before`, `after`, `compare`, `layout`, `split` | compare |
| `selection`, `selectionSet`, `hover`, `hoverPane`, `mode` | selection |
| `panel` | inspector |
| `annotations`, `activeAnnotation`, `pending`, `tool` | annotations |
| `dirty`, `saved`, `saving` | reviews |
| `camera`, `center`, `extent`, `preset` | view |
| `scenes` | core (`render/scene-cache.js`) |

## Harness functions and owners

```harness-functions
renderInspector loadReview saveReview workspace restoreAnnotation openReport openSource
startupWorkspace pick project viewPanes setLayout renderOverlay currentView viewMatches
annotationAt annotationPoint reviewPayload tool select loadSelectedModels
```

| Function | File | Owner |
|---|---|---|
| `loadReview`, `saveReview`, `reviewPayload` | `features/reviews/reviews.js` | reviews-context (W2) |
| `workspace`, `startupWorkspace` | `features/library/workspace.js` | model-first-compare (W1) |
| `restoreAnnotation`, `annotationAt`, `tool` | `features/annotations/annotations.js`, `tools.js` | reviews-context (W2) |
| `annotationPoint` | `features/annotations/annotation-geometry.js` | camera-navigation (W1) |
| `currentView`, `viewMatches` | `features/view/view-match.js` | camera-navigation (W1) |
| `project`, `viewPanes` | `render/panes.js` | camera-navigation (W1) |
| `pick` | `render/picking.js` | render-transport (W1) |
| `setLayout` | `features/compare/layout.js` | model-first-compare (W1) |
| `loadSelectedModels` | `features/compare/load-models.js` | model-first-compare (W1) |
| `select` | `features/selection/selection.js` | exact-measure (W1) |
| `openReport` | `features/reports/reports.js` | frozen after foundation |
| `openSource` | `features/source/source-drawer.js` | source-links (W2) |
| `renderOverlay` | `core/overlay.js` | frozen after foundation |
| `renderInspector` | `features/inspector/inspector.js` | help-a11y (W3) |

Seams (the VS harness passes no-ops): `renderInspector`, `scheduleDraw`,
`renderAnnotations`, `renderLibrary`, `renderSaved`, `panel`.

## Selection reference

Exactly `{modelId, bodyId, entityType, entityIndex}` in this key order.
`entityType` is `body`, `face`, `edge` or `vertex`. Alias, body index, logical
face and identity are derived by lookup (`core/scene-records.js`), never
stored in the reference. `validateReview` reads `target.bodyId`.

## Pane

`{x, y, width, height, clipX, clipWidth, modelId, side}` in CSS px; `side` is
`before` or `after`. Single: one pane for `after`. Wipe: two full-width panes
clipped at the split. Side by side: two half-width panes. All panes share one
camera (`render/panes.js`). Additive (2026-09-25): the single pane of an open
workspace assembly or placed model carries `members: [{instance, key, modelId,
matrix}]` (12 numbers, row-major `[R | t]`, `render/placement.js`); `modelId`
stays the active model. The renderer draws and the picker tests every member;
a picked result then also names its `instance`. Renderer layers run once with
the active member, or once per member with `perMember: true` (frame.member).

## Camera API (`viewer/render/camera.js`)

```
defaultCamera(bounds) -> camera
viewProjection(camera, pane, bounds, { relativeTo }) -> Float64Array(16), column-major
project(point, camera, pane, bounds) -> { x, y, depth }       // larger depth = nearer
unproject(x, y, depth, camera, pane, bounds) -> [x, y, z]
basis(camera) -> { right, up, toward }
lookFrom(direction, up, camera) -> camera
preset(name, camera) -> camera        // front back left right top bottom iso
fit(bounds, camera, pane) -> camera   // keeps yaw and pitch
depthPerPixel(camera, pane, bounds) -> mm of view depth per CSS px
fromLegacy({ yaw, pitch, zoom, pan }, { center, extent, pane }) -> camera
toLegacy(camera, { center, extent, pane }) -> { yaw, pitch, zoom, pan }
```

The foundation implemented convention 1 (the pre-foundation numbers,
including the mirrored screen X). Since the integration of 2026-09-23 the
camera is convention 2 (camera-navigation: right-handed, world-space, same
API); `projectLegacy` still reproduces the pre-foundation formula bit for bit
for legacy reviews, and `viewProjection` agrees with `project()` within
1e-6 px (test/viewer-camera.test.mjs).

## Client extension points

- Feature module: `export const id`, `export const legacy`, `export function
  setup(ctx)` returning `{ dispose, api, legacy: { harness, state }, defaults }`.
  `app.js` merges them and throws on a duplicate api name, harness function,
  facade field or store slice. Features never import each other
  (`scripts/viewer/check-format.mjs`).
- `ctx`: `env, dom, store, state, app, api, requests, events, renderer, overlay,
  slots, commands, keyboard, pointer, panes, cache, settings, format, notify,
  showError, viewportMessage, copyText, drawer, review, onFrame, field, fields,
  legacy`.
- Slots: `header.status`, `header.action`, `modelBar.item`, `library.tab`,
  `library.row`, `library.section`, `parts.rowBadge`, `parts.rowAction`, `parts.rowDetail`,
  `viewportHud.item` (`corner`: top-left, top-right, bottom-left, bottom-right),
  `viewportBanner.item`, `statusBar.item`, `viewActions.button`, `toolbar.tool`,
  `inspector.section` (`order`, `when`, `render`, `bind`), `settings.item`;
  generic regions `reviewArea`, `stage`, `inspector`, `inspector.reviewPanel`.
- `commands.register({ id, label, keys, scope, run, enabled, allowWhileTyping,
  preventDefault })`, `commands.bind(selector, id)`.
- `keyboard.pushEscape(handler)` (exclusive stack), `keyboard.onEscape(handler,
  order)` (default Escape participants).
- `overlay.layer({ id, order, render(frame), after(frame) })`;
  `renderer.addLayer({ id, order, perMember?, draw(frame) })`; `panes.setMembers(provider)`
  (only `features/workspace`); `renderer.setStyle(style)`
  (only `features/display/display.js`); `renderer.setHighlights({ hover,
  hoverPane, selection: [references] })`.
- `drawer.open({ title, eyebrow, load(signal), render(data) }) -> data | null`.
- `settings.get(scope, key, fallback, { source, body })`, `settings.set(...)`;
  scopes `G`, `S`, `SB`; in memory under the legacy seam.

## Server contracts

- `src/review-server.mjs` re-exports `createReviewServer` and
  `validateReview` (RV unchanged).
- Registry read API: `get(modelId)`, `list()`, `scene(modelId)` (async),
  `model(modelId)`, `sources()`, `archive(modelId) -> path`,
  `onRevision(listener)`.
- `src/viewer/http.mjs`: `send`, `sendJson`, `sendBinary`, `sendText`,
  `readJson`, `HttpError(status, message)`, `CapabilityError` (501),
  `checkHost`, `checkOrigin`. Legacy routes keep ENOENT -> 404, everything
  else -> 400; new routes map HttpError statuses, ENOENT -> 404, else 500.
- Router: `router.add(method, pattern, handler, { legacy })`; route modules
  export `register(router, ctx)`; `ctx` holds `registry, events, sources,
  reports, settings, pool, origin, reviewDirectory, reviews, inputs, root,
  viewerDirectory, live, workspace` (`workspace.tree()`, docs/viewer/workspace.md). `routes/index.mjs` lists every module with its planned
  paths; a module that fails to load answers 500 "route module <name> failed
  to load" on those paths and the server still starts.
- `ctx.pool.query(kind, modelId, payload, { timeoutMs, supersedeKey, signal })
  -> Promise`; kinds `draw`, `printability`, `section`, `thickness`,
  `diffBounds` (frozen map in `query-worker.mjs`), each handler
  `(model, payload, { signal }) -> result`.
- `buildDrawPayload(model, scene, { logical, classes }) -> { header, buffer } |
  null` (`draw.mjs`), `logicalFaces(model)` (`logical-faces.mjs`),
  `classifyEdges(model, scene)` (`edge-classes.mjs`),
  `compareModels(before, after, { logical }) -> { deltas, sourceLines }`
  (`compare.mjs`, frozen after wave 1; a descriptor may carry optional
  `kernelBounds`, diff-overlay). The foundation stubs of `logicalFaces`,
  `classifyEdges` and `buildDrawPayload` are implemented (topology-classes,
  render-transport) behind the same signatures.
- Every request passes the Host allowlist (`127.0.0.1:<port>`,
  `localhost:<port>`) and the same-origin check.
- `GET, PUT /api/settings`: document `wonky.viewer-settings/1` in
  `<reviews>/viewer-settings.json`; PUT merges a patch, `null` deletes.
- `POST /api/models/:id/archive` -> `{ path, modelId }`, idempotent.
