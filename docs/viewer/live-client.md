# Live client

Package live-client (spec sections 3.1, 4, 6, 7.4, 9.2 resolve, 10.3). The
browser side of the live loop: it listens to `wonky-view`'s event stream,
always says which revision is on screen and whether it is current, follows
new revisions without moving the camera, carries the selection when its
recorded identity allows it, and shows build failures with their source
location. The server side it talks to is `docs/viewer/live-server.md`. The
package report with the acceptance evidence is
`docs/viewer/package-live-client.md`.

## What you see

| Where | What |
|---|---|
| Header, center | The live pill: trust state, build time and file ("Current r12 · 0.21 s · bracket.fs"; the build time excludes the wait for a worker, a wait of 0.5 s or more is added: "0.09 s (queued 3.32 s)"), Cancel while building, Go to latest when an older revision is shown, Details on a failure, Rebuild after a cancel or a worker failure, and the Follow toggle (`L`). A `.brep.json`-only workspace keeps "N model versions · Local workspace" there. |
| Viewport, bottom left | The trust chip: the same trust text at every width (the header status is hidden below 1150 px), with Cancel and Go to latest. Next to it "r4 available" when a newer good revision is not shown, with the reason ("follow off (L)", "follow paused: review annotations on r3"). |
| Viewport, top edge | A thin busy bar while a build runs (shown after 250 ms). |
| Viewport, top edge | The failure banner (amber): "Showing last good r2. Source now fails: capability error at part.fs:32:5 in opBoolean, called from part.fs:57", the message, Details and Open in editor. Red for a build worker that failed to start, with the worker's start error (not the last stack line) and Rebuild. Blue for the build notices of the displayed revision ("r6: 2 show/export calls ignored: the module-level 'result' is the result (Python result contract)"). The banner overlays the top edge of the viewport instead of taking layout space, so a failure or a fix never resizes the viewport and the model does not jump (Regression review 3); the viewport's top HUD line moves down by the banner height (`--live-banner-height` on the stage), so the model title stays readable. |
| Viewport, center | When no build of the source ever succeeded: the failure panel (title, message, excerpt with the failing line, "called from …", Details, Open in editor) instead of a model. |
| Drawer | Build failure details: kind with its meaning, message, Open in editor, revision, error name, location, source path, call site, failed operation (name, operation id, sequence), completed operations, kept model (display failures), last good revision, source excerpt, call chain (every frame an editor link), timings, Python traceback and output, the raw payload. |
| Library | A badge on the newest revision of a live source while its latest attempt is not a success: "r5 building", "r5 fails", "r5 cancelled". |
| Inspector | Right after a swap, while the carried multi-selection is re-measured: "PENDING Measurement of r7 is being recomputed. Derived data of r6 was cleared on the swap." It disappears when the measurement of the new revision arrives. |

"Open in editor" links use the editor setting (`G`, `editor`, default
`zed`): `zed://file/<absolute path>:<line>:<column>` (`core/editor-links.js`).

## Trust states (spec 7.4)

`trustState(input)` in `viewer/features/live/trust-state.js` is the table,
first match wins. D is the displayed revision, G the latest good one, A the
latest attempt, N a revision being loaded.

| Row | Condition | Text | Tone |
|---|---|---|---|
| `disconnected` | the event stream is not open | Disconnected · showing rD · reconnecting | grey |
| `worker-failed` | the build worker failed to start (any live source) | Build worker failed to start · showing rD | red |
| `static` | the displayed model is not a live revision | Static file · rD | neutral |
| `no-good-build` | no good build and A failed (or was cancelled) | No successful build · rA fails at file:line | red |
| `building` | A queued or building | Building rA · phase · 1.2 s (+ · showing rD when D ≠ G) | blue |
| `dirty` | watched bytes changed, no build queued yet | Source changed · showing rD | blue |
| `loading` | N is loading, or nothing is displayed yet | Loading rN · showing rD | blue |
| `failed` | A failed and D = G | Last good rG · rA fails at file:line | amber |
| `cancelled` | A was cancelled and D = G | Last good rG · rA cancelled | amber |
| `older` | D ≠ G (picked, follow off or paused) | Viewing rD · rG is latest | neutral |
| `current` | D = G, A succeeded, clean, connected | Current rD | green |
| `waiting` | live source, nothing built or attempted yet | Waiting for the first build | blue |

Notes:

- The static row comes right after the two global rows. A static model has
  no live source, so rows 3 to 9 of the spec table cannot match it; the order
  is equivalent to the spec's.
- `cancelled` and `waiting` are additions: the spec table has no row for a
  cancelled attempt ("r3 cancelled" in its acceptance) or for the moment
  before the first attempt.
- D = G compares model ids: a rebuild with identical output ("same model as
  r0") is current under the new revision number.
- 250 ms rule (spec 3.1 step 4): `settle()` keeps the previous state for the
  first 250 ms of a busy period (source changed, building, loading), so a
  fast build goes from "Current r1" straight to "Current r2". A reload during
  a build shows the building state at once. A follow swap counts as loading
  from the moment it is decided (also while it waits for another job), so the
  trust state never passes through "Viewing r1 · r2 is latest" on the way
  (fixed 2026-09-23; `test/viewer-live-client.test.mjs` records every chip and
  pill text of a swap).

## Events and the live model

`viewer/core/events.js` is the SSE client (`GET /api/events?client=<id>`).
The client id lives in `sessionStorage`, so a reload keeps it and its pins.
The browser's EventSource reconnects on its own and sends `Last-Event-ID`;
the server replays what was missed or, after a restart, answers a fresh
`hello`. If the EventSource gives up (readyState CLOSED), a new one opens with
backoff (2, 4, 8, then 15 s) and `?lastEventId=`. Events of the
current session whose sequence number was already handled are dropped, so an
overlapping replay is harmless. Under the legacy seam (VS) the client is
disabled and opens nothing.

`reduceLive(model, name, data)` builds the live model from `hello` (the full
status of every source, including a running job with its elapsed time, the
last failure and a worker failure) and the build events. A revision event of
the previous session (`r0`) never replaces a newer last good revision.

## Follow live, pause, picks

- Follow live is per source (settings `S`, key `followLive`, default on,
  persisted in `<reviews>/viewer-settings.json`). `L` toggles it: off → on
  (and shows the latest good revision), on or paused → off.
- With follow on, a new good revision of the displayed source replaces the
  displayed one once its scene and draw payload are loaded. The swap keeps
  the camera (`loadSelectedModels(false)`; camera-navigation keeps the camera
  for revisions of one source) and, in compare mode with "compare with
  previous", moves the before model along.
- Follow pauses while the open review has annotations on a displayed revision
  (the view's model, the before model of a comparison view, or the target's
  model). When the annotations are gone the view catches up.
- A revision picked from the library or a loaded review that is older than
  the newest listed one is never replaced ("Viewing r2 · r4 is latest"); Go
  to latest or `L` return to following.
- A newer revision that is not shown appears as "rN available" (click: show
  it, camera kept) and in the library.
- A newer save during a swap aborts the swap's downloads and goes to the
  newest revision; a swap that already switched the view finishes first.
- Restart of `wonky-view`: the tab reconnects (same derived port) and keeps
  showing its model until the displayed source, matched by path (source ids
  are per session), has a good revision in the new session. The same model
  id (usually `r0 previous session`) only refreshes the list; another one is
  swapped in. A source that is gone falls back to the first display. Before
  Regression review 2 the tab reloaded the empty list at once ("No models yet" for
  the whole cold start) and then opened the first source.
- Reload: `sessionStorage` keeps the displayed model, its source id and path.
  `preferredAfter(list)` (used by `library/workspace.js` defaultAfter) opens
  the picked revision, else the newest revision of that source, so a reload
  keeps a source that is not the first on the command line.
- The library follows every source: a good revision that is not listed, or
  listed under an older revision number, refreshes the list
  (`requestList`). The second case is a rebuild that reproduces an earlier
  model ("r5 ok · same model as r3"): the model id is listed as r5 from then
  on, in the model bar, the library and the compare selectors. A
  `workspace-changed` event for a saved review or archive refreshes the list
  too, never the view.

## Selection carry and derived data

Before a swap, the references of the selection on the replaced revision are
sent to `POST /api/models/<new>/resolve` (`src/viewer/routes/resolve.mjs`,
`src/viewer/carry.mjs`). Each reference becomes the recorded topology
identity of its entity (`topologyReference`) and is matched in the new
revision with `matchTopologyReference`:

```
POST /api/models/:id/resolve { from: <modelId>, references: [{ bodyId, entityType, entityIndex }] }
-> { schema: 'wonky.resolve/1', from, to, results: [
     { status: 'exact', fromAlias, alias, reference: { modelId, bodyId, entityType, entityIndex },
       stability },
     { status: 'lost', fromAlias, reason, stability },
     { status: 'ambiguous', fromAlias, reason, candidates: [alias] } ] }
```

Only `exact` carries. Nothing is ever matched by geometry, position or index.
Semantic identities (extrusion caps, named sketch sides such as the arc slot's
`skArc` faces) carry; revision-local ones (the bracket's polyline sides and
edges) do not, and the toast says so: "B1.F4 has a revision-local identity;
not carried to r8". Errors: 400 for a malformed body, a reference of another
revision or more than 64 references; 404 for an unknown revision.

Derived data is keyed by model id. On each swap the store key `live.swap`
(`{ from, to, revision, at }`) changes before the carried selection renders
the inspector, and `ctx.app.onLiveSwap(listener)` is called after it; features
that cache per model (printability, section, diff, thickness) clear and show
"pending" from there. The measurement section recomputes for the new
revision; the live feature marks it "pending" until the measure API answers.

## Pins

`POST /api/live/pins { client, modelIds }` (150 ms debounce, only when the
set changes, again after every `hello`): the displayed revision, the compare
before revision, every annotated revision (see pause) and a revision being
loaded. The server drops them 60 s after the client's last event stream
closes.

## Client API

| `ctx.app` | Use |
|---|---|
| `liveStatus()` | debug snapshot: connection, session, client id, shown trust state, follow, displayed revision, loading, last swap timings (`receivedAt`, `displayedAt`, `paintedAt`), the live model |
| `onLiveSwap(listener)` | `listener({ from, to, revision })` after each live swap; returns an unsubscribe |
| `liveRevision(modelId)` | `{ sourceId, revision, modelId }` or null |

Store slice `live`: `trust` (the shown state), `follow` (`on`, `off`,
`paused`), `swap`.

Commands: `live.follow` (`L`), `live.cancel`, `live.rebuild`, `live.latest`,
`live.details`.

## Files

| File | Role |
|---|---|
| `viewer/core/events.js` | SSE client |
| `viewer/features/live/live.js` | wiring: events, swaps, follow, carry, pins, inspector marker, library badge, commands |
| `viewer/features/live/trust-state.js` | pure logic: live model, trust table, settle, follow, pins, carry message |
| `viewer/features/live/pill.js` | pill, trust chip, busy bar |
| `viewer/features/live/banner.js` | failure banner, failure panel, failure texts |
| `viewer/features/live/failure-drawer.js` | failure details drawer |
| `viewer/features/live/live.css` | styles |
| `src/viewer/carry.mjs`, `src/viewer/routes/resolve.mjs` | identity-based reference resolution |
| `test/viewer-live-client.test.mjs` | 22 tests: every trust row, reducer, settle, follow, pins, carry texts, failure texts and drawer, SSE client, carry and resolve route, the feature end to end in the fake browser |
