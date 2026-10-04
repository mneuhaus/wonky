# Viewer foundation: module map and extension points

Status: foundation step of `docs/viewer/spec.md` section 11, done 2026-09-22.
It is a pure restructuring: the viewer looks and behaves as before (evidence
in `out/viewer/foundation/`, row by row in
`out/viewer/foundation/inventory-checklist.md`). The one intended change is
the Host allowlist (SRV-13). The frozen names and signatures are listed in
`docs/viewer/contracts.md`; this document explains how the pieces fit and how
a work package adds to them.

Rules that hold everywhere:

- Native ES modules, no build step, no CDN, no new npm dependency.
- Lines at most 100 characters, no inline `style` attributes, no imports from
  one feature directory into another, no remote URLs in `viewer/**`
  (`node scripts/viewer/check-format.mjs`).
- The viewer never invents geometry or measurements. Server data that is a
  display approximation carries its tolerance; unsupported requests answer an
  explicit capability error (`CapabilityError`, HTTP 501), never a guess.
- A package edits its own files. `viewer/app.js`, `viewer/core/**`,
  `viewer/render/**`, `src/viewer/{server,http,router,registry}.mjs` and
  `src/viewer/routes/index.mjs` are frozen; they change only by an
  maintainer decision.

## Module map

### Client (`viewer/`)

```
index.html          shell: header, library, review area, stage, inspector as
                    data-slot regions; <link>s every CSS file in cascade order
main.js             boot: loadFeatures(FEATURES), createViewer(env, …), start();
                    window.wonkyViewer is the debug handle
app.js              createViewer(env, { seams, features, failures, legacy })
core/
  store.js          createStore: get, define, update(reason, recipe), select;
                    createFacade/field for the legacy state facade
  requests.js       latest-wins scopes: scope(name).begin() -> { token, signal, current }
  api.js            json/text/binary/post helpers with error mapping and abort
  events.js         SSE client (stub until live-client; off under the legacy seam)
  dom.js            $/$$, html escaping, clamp, focus-preserving patch
  format.js         units, tolerance-decade formatting, the 7 exactness chips
  icons.js          inline SVG icon set, [data-icon] hydration
  commands.js       command registry
  keyboard.js       scoped key bindings, typing guard, Escape stack
  pointer.js        pointer router: drag threshold, tool gestures, orbit/pan
  overlay.js        SVG overlay with ordered layers (renderOverlay)
  slots.js          DOM and list slots (extension points)
  settings.js       settings scopes G/S/SB via /api/settings
  editor-links.js   zed:// (default), vscode://, cursor:// file:line:column
  feature-loader.js isolated import of every feature
  notify.js         toast, global error banner, viewport message, clipboard
  scene-records.js  reference -> scene/body/entity lookup, alias, identity, source
render/
  camera.js         the frozen camera API (convention 1 = pre-foundation numbers)
  panes.js          viewPanes() and project() for single, wipe, side by side
  picking.js        pick(x, y, mode) on the JSON scene, occlusion-aware
  scene-cache.js    Map of loaded scenes (state.scenes)
  renderer.js       WebGL renderer: init, prepareScene, setStyle, setHighlights,
                    addLayer, draw, project, pick
  gl.js shaders.js  GL context, buffers and programs
  draw-decode.js    decoder for the future wonky.draw/1 payload (render-transport)
  style.js          style table defaults and composeStyle(display)
  layers.js         ordered GL layers
features/
  index.js          ordered feature list; legacy: true marks the VS feature set
  library/ compare/ selection/ inspector/ annotations/ reviews/ reports/
  drawer/ source/ view/          the legacy feature set (all of today's UI)
  display/                       the single renderer.setStyle caller
  live/ measure/ parts/ fdm/ section/ diff/ thickness/ help/   stubs
styles/
  tokens.css base.css layout.css shared variables, element defaults, grid
```

Each feature directory holds its JS modules and one CSS file named after the
feature (`features/view/view.css`), with its own media-query blocks.
`index.html` links all of them statically in the order of `features/index.js`,
so there is no unstyled first frame.

Who owns which feature after the foundation is in the table in
`docs/viewer/contracts.md` (harness functions) and spec section 12.

### Server (`src/viewer/`)

```
src/review-server.mjs     facade: re-exports createReviewServer, validateReview
src/viewer/
  server.mjs              lifecycle: bind first, then register inputs, then routes;
                          Host allowlist + same-origin check before routing
  http.mjs                send, sendJson, sendBinary, sendText, readJson, redirect,
                          HttpError, CapabilityError, capability(), checkHost, checkOrigin
  router.mjs              add(method, pattern, handler, { legacy }); error mapping
  static.mjs              viewer/** with path normalization and a MIME allowlist
  registry.mjs            revisions: get, list, scene, model, sources, archive,
                          onRevision (+ registerIfNew for the server)
  reports.mjs             report discovery and image registry
  reviews.mjs             validateReview, save and load of WKR reviews
  review-camera.mjs       camera validation for saved reviews
  context.mjs             LLM context and Markdown writers
  sources.mjs             frozen source snapshots
  settings.mjs            <reviews>/viewer-settings.json (wonky.viewer-settings/1)
  events.mjs              SSE hub
  query-pool.mjs          ctx.pool.query(kind, modelId, payload, options)
  query-worker.mjs        frozen kind map: draw, printability, section, thickness, diffBounds
  routes/index.mjs        ROUTE_MODULES with planned paths; isolated dynamic import
  routes/*.mjs            core, settings, reviews (working); live, draw, topology,
                          geometry, measure, compare, resolve, history, selection,
                          export, parts, printability, section, diff, thickness (stubs)
  live/*.mjs              session, watch, pool, build-worker, failure, terminal,
                          port, out (stubs for live-server)
  draw.mjs … thickness.mjs  package modules with frozen signatures (stubs)
```

Stubs answer honestly: a planned route whose module registers nothing yet is
`404 Unknown route`; a stub function called anyway returns or throws a
`CapabilityError` naming the package that will implement it.

### Tooling and tests

| Path | Purpose |
|---|---|
| `scripts/viewer/check-format.mjs` | format rules above |
| `scripts/viewer/check-contracts.mjs` | DOM ids, facade fields and harness functions against `contracts.md` (`--browser <url>` checks a running viewer) |
| `scripts/viewer/qa/fixtures.mjs` | builds the QA models into `tmp/viewer/fixtures/` (examples, audit samples, every `.fs` in `scripts/viewer/qa/fixtures/`) |
| `scripts/viewer/qa/serve.mjs` | `start`/`stop`/`status` of a private viewer on a port in 4320-4399 |
| `scripts/viewer/qa/browser.mjs` | Playwright helpers using the pinned repo dev dependency and checkout-local Chromium |
| `scripts/viewer/qa/provision-browser.mjs` | SHA512-verified dependency and Chromium headless-shell provisioning under `tmp/viewer-browser/` |
| `scripts/viewer/qa/foundation.mjs`, `inventory.mjs`, `inventory-extras.mjs`, `foundation-extras.mjs`, `api-smoke.mjs`, `compare-shots.mjs`, `compare-styles.mjs` | the foundation's differential QA (same script against two viewers) |
| `scripts/viewer/test-support/fake-env.mjs` | fake browser environment for the VS harness and core tests (JSON or binary answers) |
| `scripts/viewer/test-support/fake-event-source.mjs` | fake EventSource for the live and workspace client tests |
| `scripts/viewer/uv-python` | Python through `uv run` (never `python3` directly) |
| `test/viewer-state.test.mjs` (VS) | 32 legacy state tests; only the harness changed |
| `test/viewer-core.test.mjs` | format, camera, keyboard conflicts, composition, feature failure, multi-selection, core services |
| `test/viewer-server.test.mjs` | router, static serving, Host allowlist, error mapping, bind-first, settings, archive, compact scenes, route isolation, query pool, frozen stubs |

The Rust lane provisions its mandatory browser before starting test workers. Direct
browser QA also provisions automatically through `launch()`. To warm the cache,
run `node scripts/viewer/qa/provision-browser.mjs`. This needs Node, `tar`, and network
access on a cold cache, but no package manager on the runner host. The package
version and archive integrity come from `package.json` and `package-lock.json`;
Playwright's pinned CLI owns the matching Chromium revision. No files in `HOME`
or shared `node_modules` are needed or modified. Failed download, launch, or WebGL
availability fails the lane, never skips it. Browser cache reuse is safe only for
the same pinned version; dependency upgrades must update both repo lockfiles.

The `scripts/viewer/audit-*.mjs` probes belong to the audit stage. They
inject into the pre-foundation single-file `app.js` and only run against the
verbatim copy in `tmp/viewer/foundation/original/`.

## Boot and composition

`main.js` imports every feature through `core/feature-loader.js`. Each import
is isolated (`Promise.allSettled`), so a module that fails to load becomes a
`{ id, error }` failure instead of breaking the app. `createViewer` then:

1. builds the core services (store, commands, keyboard, pointer, requests,
   api, events, slots, settings, panes, picker, renderer, overlay, notifier);
2. calls `setup(ctx)` of every feature in `features/index.js` order;
3. merges the results: `api` into `ctx.app`, `legacy.harness` into the VS
   harness, `legacy.state` into the state facade, `defaults` into the store.
   A duplicate name throws (tested);
4. applies `seams` (the VS harness passes no-ops for `renderInspector`,
   `scheduleDraw`, `renderAnnotations`, `renderLibrary`, `renderSaved`,
   `panel`);
5. shows `Feature <id> failed to load` in the viewport banner for every
   failure (import or setup), and installs the keyboard.

`viewer.start()` starts WebGL, loads settings (not under the legacy seam) and
runs `app.startupWorkspace()`.

The VS harness runs the same code path:

```js
const { features } = await loadFeatures(LEGACY_FEATURES);
const fake = createFakeEnvironment({ dispatch, hash });
const api = createViewer(fake.env, { seams, features, legacy: true }).harness;
```

Under `legacy: true` there is no renderer start, no settings request, no
EventSource and no `localStorage`. New features keep their requests out of
this path; they report failures in their own section or banner, never through
`showError` (VS requires an empty `#global-error`).

## Writing a feature

A feature is a directory `viewer/features/<id>/` with `<id>.js`, optional
helper modules and `<id>.css`. The module exports:

```js
export const id = 'measure';
export const legacy = false;

export function setup(ctx) {
  // register slots, commands, layers, store keys …
  return {
    api: { measureSelection },          // callable by other features as ctx.app.measureSelection
    legacy: { harness: {}, state: {} }, // only for the frozen VS contract
    defaults: { measure: { results: [] } },  // store slice (or 'display.measure')
    dispose() { /* remove listeners, layers */ },
  };
}
```

Features never import each other. Cross-feature calls go through `ctx.app`
(late-bound, so order does not matter at call time) or through the store.

### ctx

| Member | Use |
|---|---|
| `store` | `get()`, `update(reason, recipe)` (mutates in place, never freezes), `select(selector, listener)`, `define(slice, value)` |
| `state` | legacy facade (live accessors over the store); new code prefers `store` |
| `app` | merged feature APIs plus core functions (`scheduleDraw`, `draw`, `renderOverlay`, `pick`, `project`, `viewPanes`) |
| `api` | HTTP helpers with error mapping and `AbortSignal` support |
| `requests` | `requests.scope(name).begin()` -> `{ token, signal, current() }`: latest wins |
| `events` | SSE subscription (live-client fills it in) |
| `renderer`, `overlay` | GL and SVG drawing extension points (below) |
| `slots` | DOM and list slots (below) |
| `commands`, `keyboard`, `pointer` | commands and shortcuts, Escape stack, pointer gestures |
| `panes`, `cache` | pane geometry and loaded scenes |
| `settings` | `get(scope, key, fallback, { source, body })`, `set(…)`; scopes `G`, `S`, `SB` |
| `format` | units, tolerance-decade numbers, exactness chips |
| `notify`, `showError`, `viewportMessage`, `copyText` | user feedback |
| `drawer` | `open({ title, eyebrow, load(signal), render(data) })`, `close()` |
| `review` | `touch(reason)`: marks a saved review dirty |
| `onFrame(hook)` | runs after every drawn frame |
| `field`, `fields` | accessor helpers to expose store keys through the legacy facade |
| `legacy` | true under the VS harness |

### Slots

`slots.add(region, { id, order, html })` inserts markup into
`[data-slot="<region>"]` at its order without re-rendering earlier items, so
bound handlers survive. Items for a region that does not exist yet wait until
a feature inserts it. Named helpers:

```js
slots.header.action({ id: 'live.pill', order: 5, html: '<span class="live-pill">…</span>' });
slots.viewportHud.item({ corner: 'bottom-left', id: 'view.triad', order: 10, html: '…' });
slots.viewActions.button({ id: 'section.toggle', order: 40,
  html: '<button id="section-toggle" class="icon-button" data-icon="cube"></button>' });
slots.statusBar.item({ id: 'fdm.legend', order: 20, html: '<span>…</span>' });
slots.viewportBanner.item({ id: 'live.failure', order: 10, html: '<p>…</p>' });
```

Regions: `header.status`, `header.action`, `modelBar.item`, `library.tab`,
`library.section`, `viewportHud.<corner>`, `viewportBanner.item`,
`statusBar.item`, `viewActions.button`, `toolbar.tool`, `settings.item`, and
the generic `reviewArea`, `stage`, `inspector`, `inspector.reviewPanel`,
`comparisonBar`.

List slots are data, rendered by their owner: `inspector.section`,
`library.row`, `parts.rowBadge`, `parts.rowAction`, `settings.item`
(`slots.list(name)` returns them by order). The inspector renders sections
for the current selection:

```js
slots.inspector.section({
  id: 'measure.exact',
  order: 30,                                   // source is at 40
  when: ({ records }) => records.entity?.surfaceType === 'cylinder',
  render: ({ records }) => `<section class="inspector-section">…</section>`,
  bind: ({ records }) => { /* attach handlers after insertion */ },
});
```

### Commands and keys

Every button and shortcut is a command:

```js
commands.register({
  id: 'section.toggle', label: 'Section view', keys: ['Shift+X'], scope: 'global',
  run: () => toggleSection(), enabled: () => !!ctx.state.after,
});
commands.bind('#section-toggle', 'section.toggle');
```

Keys use `Mod` for Cmd/Ctrl. `scope` is `global` or `canvas` (viewport
focused). Commands do not run while typing unless `allowWhileTyping`. Two
commands with the same key in one scope are a conflict: the test in
`test/viewer-core.test.mjs` loads every feature and fails on any conflict.
Escape: `keyboard.pushEscape(handler)` takes Escape exclusively until popped
(menus, dialogs); `keyboard.onEscape(handler, order)` joins the default
Escape chain (cancel gesture, close drawer, clear selection, blur field).

### Drawing

GL layers draw after the model in each pane:

```js
renderer.addLayer({ id: 'fdm.plate', order: 10, draw(frame) {
  // frame: { gl, pane, panes, ratio, viewProjection, drawLines, drawBodies }
} });
```

`frame.drawLines` and `frame.drawBodies` (fat lines with depth bias; stencil,
culling and colorMask options) are part of the interface but throw "not
implemented yet (render-look)" until the render-look package fills them in.
Until then a layer uses `frame.gl` and `frame.viewProjection` directly.

SVG overlay layers render markup over the canvas (annotations are one):

```js
overlay.layer({ id: 'measure.dimensions', order: 60,
  render: ({ width, height }) => '<g class="dimension">…</g>',
  after: () => { /* DOM side effects */ } });
```

Style: features write only their own keys under `store.display.*`
(`display.edges`, later `display.parts`, `display.fdm`, `display.section` …).
`features/display/display.js` is the only caller of `renderer.setStyle()`; it
composes those keys with `render/style.js`. Highlights take arrays:
`renderer.setHighlights({ hover, hoverPane, selection: [references] })`, and
`window.wonkyViewer.select([a, b])` highlights every reference.

A selection reference is exactly `{ modelId, bodyId, entityType,
entityIndex }`; everything else (alias, identity, source) is looked up with
`core/scene-records.js`.

### Numbers and exactness

Use `ctx.format` for every number shown: values print to the decade of their
tolerance, and each value carries one of the seven exactness chips of spec
section 8. The browser formats; the server measures (`src/viewer/measure.mjs`
with the kernel). Display-mesh values are labeled with their tolerance.

## Writing a server route

A route module exports `register(router, ctx)`:

```js
// src/viewer/routes/measure.mjs
import { HttpError, readJson, sendJson } from '../http.mjs';
import { measureEntities } from '../measure.mjs';

export function register(router, ctx) {
  const path = /^\/api\/models\/([a-f0-9]{64})\/measure$/;
  router.add('POST', path, async (req, res, { match }) => {
    const model = ctx.registry.model(match[1]);
    if (!model) throw new HttpError(404, 'Unknown model revision');
    sendJson(res, 200, measureEntities(model, (await readJson(req)).entities));
  });
}
```

Handlers receive `(req, res, { url, match })`; routes are tried in
registration order and the first match answers. `ctx`
holds `registry, events, sources, reports, settings, pool, origin,
reviewDirectory, reviews, inputs, root, viewerDirectory`. New routes map
`HttpError` statuses, `ENOENT` to 404 and everything else to 500; legacy
routes keep their 400 mapping. Anything that can block the event loop for
more than 50 ms goes through `ctx.pool.query(kind, modelId, payload,
{ timeoutMs, supersedeKey, signal })` with a handler in the frozen kind map of
`query-worker.mjs`. If a module fails to import or register, its planned paths
(listed in `routes/index.mjs`) answer `500 route module <name> failed to
load` and the server still starts.

## Adding a feature package: checklist

1. Fill the stub files your package owns (`viewer/features/<id>/`,
   `src/viewer/<id>.mjs`, `src/viewer/routes/<id>.mjs`). A genuinely new
   feature needs a line in `features/index.js` and a `<link>` in
   `index.html`: that is an maintainer decision, because both files are
   frozen.
2. Register UI through slots and commands only; keep CSS in `<id>.css`.
3. Keep new requests off the legacy path (`ctx.legacy`) and report failures in
   your own section or banner.
4. Add tests next to the existing ones (`test/viewer-*.test.mjs`) and run
   them focused; keep `test/viewer-state.test.mjs` at 32/32.
5. Run `node scripts/viewer/check-format.mjs` and
   `node scripts/viewer/check-contracts.mjs`.
6. Browser QA on your own port: `node scripts/viewer/qa/fixtures.mjs`, then
   `node scripts/viewer/qa/serve.mjs start --port 43NN`, drive it with
   `scripts/viewer/qa/browser.mjs`, stop it with `serve.mjs stop --port 43NN`.
   Ports 4310 and 4311 are Marc's viewers; never touch them.
