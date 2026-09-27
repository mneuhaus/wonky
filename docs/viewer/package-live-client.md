# Package report: live-client

Wave 2, P0, 2026-09-23. Behavior and interfaces: `docs/viewer/live-client.md`.
Evidence: `out/viewer/live-client/` (one `<step>.json` per QA step and the
screenshots named below). QA driver: `out/viewer/live-client/qa/qa.mjs`
(`node out/viewer/live-client/qa/make-overlay.mjs`, then
`node out/viewer/live-client/qa/qa.mjs [bracket] [part] [nogood] [worker]
[static] [persist]`), QA sources in `out/viewer/live-client/qa/sources/`,
working copies under `tmp/viewer/live/live-client/`.

## What it does

- SSE client (`viewer/core/events.js`): client id per tab, the browser's own
  reconnect with `Last-Event-ID`, a backoff reconnect with `?lastEventId=`
  when the EventSource gives up, duplicate drop by `<session>:<seq>`, fresh
  state on a new session's `hello`. Disabled under the legacy seam.
- Live pill in the header and trust chip in the viewport bottom line,
  implementing the trust-state table of spec 7.4 (plus `cancelled` and
  `waiting`), with the 250 ms rule so fast builds do not flicker.
- Busy bar with phase, elapsed time and Cancel (`POST /api/live/:id/cancel`).
- Failure banner (amber) with `file:line:col`, the failing operation and
  "called from file:line"; worker failure banner (red) with Rebuild; the
  no-good-build failure panel in the viewport; the failure drawer with the
  excerpt, the call chain, the failed operation, timings, output and the raw
  payload; `zed://` links (editor setting).
- Follow live (`L`, per source, persisted, default on); pause while the open
  review has annotations on a displayed revision; picked older revisions are
  never replaced; "rN available" chip; Go to latest.
- Selection carry through `POST /api/models/:id/resolve` (identity match
  only, exact / lost / ambiguous), toast for what did not carry.
- Derived data: `live.swap` store key and `onLiveSwap()`; the inspector marks
  the measurement "pending" until the measure API answers for the new
  revision.
- Client pins for the displayed, compare, annotated and loading revisions.
- Library badges for live sources whose latest attempt is building, failed or
  cancelled.

## How to use it

```
node bin/wonky-view.mjs part.fs            # edit and save part.fs in your editor
```

The tab shows the model, fitted once; every save that builds replaces it
without moving the camera. `L` stops following (the view stays, new revisions
show as "rN available"); `L` again, or the chip, shows the latest. Cancel in
the pill or chip stops a long build and keeps the last good model. On a
failure, Details opens the drawer and Open in editor jumps to the line in Zed.

Debug in the browser: `wonkyViewer.app.liveStatus()`.

## Evidence

Own instances only, through `out/viewer/live-client/qa/qa-entry.mjs` (the
`bin/wonky-view.mjs` server with the overlay viewer): ports 4361 (bracket),
4366 (part), 4367 (no good build), 4368 (worker crash), 4369 (static),
4370 (persistence). Marc's viewers on 4310 and 4311 were not touched. Every
instance was stopped; no QA process remained (`lsof`, `ps`). Headless Chromium
(`scripts/viewer/qa/browser.mjs`), 1536 × 900 unless stated, no console
messages in any step. Load average (1 and 5 min) 17.8 to 21.2 during the final run.

The overlay (`tmp/viewer/live-client/viewer/`) is a snapshot copy of
`viewer/` with this package's files symlinked, because other packages were
editing the tree during the run (a reviews-context edit broke VS for a few
minutes), and with exact-measure integration step 1 applied
(`features/measure/measure.js` delegates to `setupExactMeasure`), without
which there is no measurement section (integration request 1).

| # | Acceptance | Status | Evidence |
|---|---|---|---|
| 1 | Bracket save shows the new revision < 1 s after the save (median of 5), camera unchanged, pill "Current r2" | pass | `bracket.json` `timing`: save to first painted frame 96, 90, 94, 90, 93 ms, median 93 ms (save to `revision` event 82 to 84 ms, of which 75 ms is the watcher debounce); `cameraUnchanged` true in all 5 runs after a user orbit; pill and chip "Current r2" … "Current r6". Screenshots `state-current.png`, `a1-current-r2.png`. |
| 2 | A build > 250 ms shows phase, elapsed and Cancel; Cancel keeps the last good model and "r3 cancelled" | pass | `part.json` `building`: "Current r2" until 368 ms after the save, then "Building r3 · evaluating · 0.3 s", "… 1.0 s" at 1072 ms; Cancel and busy bar visible (`state-building.png`); after Cancel "Last good r2 · r3 cancelled", same model id displayed (`a2-cancelled.png`). |
| 3 | A failing Boolean: amber banner with file:line:col and "called from part.fs:57"; Details shows excerpt and chain; Open in editor is `zed://file/…:L:C` | pass | `part.json` `banner`: "Showing last good r2. Source now fails: capability error at part.fs:32:5 in opBoolean, called from part.fs:57", editor `zed://file~/…/tmp/viewer/live/live-client/part.fs:32:5` (`a3-failure-banner.png`). Drawer: excerpt lines 30 to 34 with line 32 marked, chain "at bore (part.fs:32:5)", "called from part.fs:57:5 in part", both linked (`a3-failure-drawer.png`). No good build at all: failure panel (`nogood.json`, `state-no-good-build.png`). |
| 4 | Every trust-state row has a unit test; five states have screenshots; the chip stays visible at 1100, 900, 650 px | pass | Tests "trust row 1" … "trust row 10" (every spec row, plus cancelled and waiting) and the event-driven test. Screenshots of 9 states: `state-current`, `state-building`, `a3-failure-banner` (failed), `a2-cancelled`, `state-older-follow-off`, `a5-follow-paused`, `state-disconnected`, `state-no-good-build`, `state-worker-failed`, plus `state-static`. `part.json` `widths`: the chip lies inside the stage at 1100, 900 and 650 px with its full text (the header status is hidden there): `width-1100.png`, `width-900.png`, `width-650.png`. |
| 5 | `L` toggles follow; follow off shows "r4 available"; a review with annotations on the displayed revision pauses follow and says so | pass | `bracket.json`: `L` → toast "Follow live off …", a save gives "Viewing r8 · r9 is latest" and "r9 available · follow off (L)" (`state-older-follow-off.png`); `L` again → "Current r9". A comment on r9, then a save: "r10 available · follow paused: review annotations on r9", r9 stays (`a5-follow-paused.png`); undo → "Current r10". `persist.json`: follow off survives a `wonky-view` restart ("Follow off", then "r2 available · follow off (L)", `a5-follow-off-after-restart.png`). |
| 6 | An arc-slot face selection carries; a bracket face is cleared with the toast; measurement "pending" right after a swap | pass | `part.json`: clicked B1.F4 (the `skArc` "right" face) on r1, after the save the selection is B1.F4 of r2, no toast (`a6-arc-slot-carried.png`). `bracket.json`: clicked side face B1.F4 (revision-local), after the save the selection is empty and the toast reads "B1.F4 has a revision-local identity; not carried to r8" (`a6-bracket-face-cleared.png`). Caps B1.F1 + B1.F2 (semantic) measured 13.00000 mm; at the swap to r7 the inspector shows "PENDING Measurement of r7 is being recomputed. Derived data of r6 was cleared on the swap." and "Measuring…" (`a6-measurement-pending.png`, measure answer delayed 1.5 s by the QA to photograph it), then 15.00000 mm and the marker is gone (`a6-measurement-recomputed.png`). |
| 7 | Reload keeps the live state; a server restart reconnects without a new tab; the client posts pins | pass | `bracket.json` `reload`: "Current r11" before and after; `part.json` `reload`: the failure banner and "Last good r2 · r4 fails at part.fs:32" survive a reload (`a7-reload-keeps-failure.png`). Restart: chip "Disconnected · showing r11 · reconnecting" (`state-disconnected.png`), then "Current r1" of the new session 1.9 s after the restart, same client id, opener called once in total (first start), terminal "browser     tab reconnected; no new tab opened" (`a7-reconnected.png`). Pins: every displayed revision, `[before, after]` in compare mode, `[annotated r10, displayed r11]` after going to the latest with an annotation on r10, `[r11]` after undo, reposted after the reload and the restart; `/api/live` `ring.clients` 1. |
| 8 | VS 32/32 and RV 7/7 | pass | `test/viewer-state.test.mjs` 32/32, `test/review.test.mjs` 7/7 (shared tree, after the reviews-context edit settled). `test/viewer-live-client.test.mjs` 22/22. `node scripts/viewer/check-format.mjs`: 173 files ok; `node scripts/viewer/check-contracts.mjs`: ok. |

Unit tests (`nice node --test test/viewer-live-client.test.mjs`, 22): the ten
trust rows; the live model through every build event (supersede, cancel,
failure, success, same-model rebuild); `hello` with a running build, a
failure, a worker failure and the r0 ordering; the settle rule and the build
time format; follow, pause and pick; pins; carry messages; failure texts;
drawer markup with `zed://` links; the SSE client (client id, duplicate drop,
browser reconnect, CLOSED reconnect with `lastEventId`, new session);
`resolveReferences` on real bracket and arc-slot builds; the resolve route
(exact, lost, 400, 404); and the feature end to end in the fake browser (first
display, pill "Current r1", a follow swap keeping the camera and carrying two
arc-slot faces, "Current r2", `L` off with "r3 available", pause, a failure
with banner, library badge and drawer).

## Gaps

- The "pending" marker covers the measurement, the only model-keyed derived
  data in the tree today. Printability, section, diff and thickness (wave 3)
  should clear on `live.swap` / `onLiveSwap()` and show their own pending
  state.
- The measurement section itself exists only after exact-measure's
  integration step 1 (integration request 1); without it the marker never
  shows (it checks for `app.measureSelection`).
- A swap preloads through `app.loadScene`, which today fetches the JSON scene
  (the current `load-models.js`); after render-transport's integration of
  `load-models.js` the same call loads only the draw payload, as spec 7.2
  wants.
- With several live sources the pill, banner and follow apply to the source
  of the displayed model; failures of the other sources show as library
  badges only.
- "Source changed" is a short state: the server queues the build right after
  `source-changed`, so the 250 ms rule hides it in practice. It is covered by
  unit tests, not by a screenshot.
- A `display` failure shows the kept model path in the drawer; there is no
  download route for it (live-server gap).
- An older revision picked in a tab is restored after a reload of that tab
  (`sessionStorage`), not in other tabs.
- `L` is a single-key shortcut; the setting that disables single-key
  shortcuts belongs to help-a11y.
- The example location of the acceptance text is part.fs:24:17; the QA part
  fails at part.fs:32:5 inside the helper, called from line 57 as required.
- Failures seen in other packages' tests, not caused by this package:
  `test/viewer-core.test.mjs` 3 and 4 (camera convention, camera-navigation)
  and 9 (shader highlight, render-transport), `test/viewer-server.test.mjs`
  12 (topology stub assertion).

## Integration requests

1. `viewer/features/measure/measure.js` (exact-measure's step 1, not owned
   here): replace the stub with `import { setupExactMeasure } from
   './measure-section.js'; export const id = 'measure'; export const legacy =
   false; export function setup(ctx) { return setupExactMeasure(ctx); }`.
2. Optional, `src/viewer/routes/live.mjs` (live-server): prefer the
   `Last-Event-ID` header over `?lastEventId=` when both are present
   (`lastEventId: req.headers['last-event-id'] ? undefined :
   url.searchParams.get('lastEventId') ?? undefined`), so a browser reconnect
   after a manual one does not replay from the stale query value (the client
   drops those duplicates already).
3. Optional, `viewer/features/compare/compare.js` (model-first-compare): for
   live revisions the model bar's "rN is newer" (`#model-bar-newer`) repeats
   the live chip "rN available"; run the `live.latest` command from it when
   `app.liveRevision?.(state.after)` is set, so it also clears a pick.
4. `docs/viewer-ui.md` (help-a11y): describe the pill, the trust chip, the
   failure banner and drawer, follow live (`L`) and the pause rule in German.
