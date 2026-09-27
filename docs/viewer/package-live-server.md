# Package report: live-server

Wave 1, P0, 2026-09-23. Behavior and interfaces: `docs/viewer/live-server.md`.
Evidence: `out/viewer/live-server/` (one `<step>.json` plus terminal
transcripts per acceptance item, screenshots `sse-*.png` and
`opener-tab-after-restart.png`). QA driver: `out/viewer/live-server/qa/qa.mjs`
(`node out/viewer/live-server/qa/qa.mjs [step ...]`), working copies under
`tmp/viewer/live/live-server/`.

## What it does

- `wonky-view part.fs|part.py|model.brep.json ...` is the entry point. `.fs`
  and `.py` are live sources; `.brep.json` keeps the static behavior and
  starts no worker.
- Derived stable port (4400 + SHA-256 of the real path mod 100, next free on
  collision, `WONKY_VIEW_PORT_RANGE` override), strict `--port`, tab reuse
  through a session marker and a 2.5 s reconnect wait,
  `WONKY_VIEW_OPENER`.
- Watch set with a combined hash (`.fs`: source, manifest, manifest files;
  `.py`: the source), parent-directory and file watchers, 75 ms from the first
  event of a burst. Exactly the hashed bytes go to the worker.
- One busy and one warm spare build worker (forked, own process group,
  kernel loaded and warmed). A superseding save emits `build-cancelled` at
  once, kills the old group after 250 ms and starts on the spare. Stale results
  are dropped.
- Lifecycle: group kill on close, signals, crashes and exit; exit on IPC
  disconnect; a watchdog thread kills a worker group within 250 ms when the
  parent dies; start backoff 1, 2, 4 … 30 s and `worker-failed` after three
  failures in 60 s; recycling after 200 builds, above 1.5 GB RSS, or on a
  kernel fingerprint change.
- The worker builds, serializes like the CLI, validates with the geometry
  inspector, prepares the scene, edge classes, logical faces and draw payload,
  renders `--out` formats, and on failure returns the plain
  `wonky.live-build-failure/1` payload (kind, location, excerpt, call chain
  without runtime wrapper frames, call site, failed operation, manifest,
  output, timings).
- Query worker behind `ctx.pool.query` (lazy, model cache of 4, latest wins,
  per-kind timeouts, kill and restart on a stuck query).
- SSE hub (`hello`, build events, `revision`, `build-failed`,
  `worker-failed`, `workspace-changed`; replay of 100 after `Last-Event-ID`;
  heartbeat), `/api/live`, rebuild, cancel and pins routes.
- Terminal: one line per event; `--json` prints NDJSON with the SSE names and
  nothing else on stdout.
- `--out`/`--format all|step|print` byte-identical to `bin/wonky.mjs`; failed
  builds never touch the files. Previous-session seed `r0` from `--out` or the
  last-good cache.
- Byte-bounded revision ring (display 512 MB, models 256 MB) with server and
  client pins and a session spool; archive route and review saves work for
  spooled revisions. Live model inspectors are created lazily (the worker
  already validated the bytes).
- Sources are frozen from the exact built bytes wherever they live.

## How to use it

```
node bin/wonky-view.mjs ~/Workspace/cad/part.fs              # opens a tab on a TTY
node bin/wonky-view.mjs part.fs --param 'thickness=12 * millimeter' --out out/part
node bin/wonky-view.mjs part.fs --json | jq -c 'select(.event=="revision")'
curl -N http://127.0.0.1:<port>/api/events                     # the same events as SSE
curl -X POST http://127.0.0.1:<port>/api/live/<sourceId>/rebuild
```

Until the live-client package lands, the browser shows new revisions after
**Refresh workspace**; the events are already on `/api/events`.

## Evidence

Own instances only, all through `WONKY_VIEW_PORT_RANGE=4320-4399` (ports
used: 4328, 4329, 4339, 4368, 4372, 4380, 4383, 4397, 4398); Marc's viewers on
4310 and 4311 were busy the whole time and untouched. Browser: headless
Chromium via `scripts/viewer/qa/browser.mjs`, 1536 × 900. Machine load average
40 to 124 during QA (other workflows), so build times are 2 to 3 times the
quiet numbers. Every instance was stopped; `ps` shows no leftover worker.

| # | Acceptance | Status | Evidence |
|---|---|---|---|
| 1 | Derived port with 4310/4311 busy, same port on restart, `--port 4310` exits 1 | pass | `ports.json`: 4310 and 4311 busy, `http://127.0.0.1:4397/viewer/` twice, strict run exit code 1 with `wonky-view: port 4310 is in use` (`ports-strict.txt`). Unit test "ports: …"; CLI test "wonky-view: a busy --port exits 1 …". |
| 2 | `r1 ok … recorded`; syntax error `r2 FAILED input bracket.fs:L:C`, call chain, `showing last good r1`; `--json` only NDJSON with SSE names | pass | `terminal.txt`: `r1 ok … · 1 body · 8 faces (8 logical) · 50×40×8 mm recorded`, `r2 FAILED input …/bracket.fs:31:9 Expected ';', found 'opExtrude'`, `   showing last good r1`; a helper failure prints `at bore (…:13:5)` and `called from …:33:5 in part`; r10b prints a four-level chain (`manifest.txt`). `json.json`: 24 stdout lines, all JSON, the names after the SSE connect equal the SSE stream's names; the URL notices went to stderr. |
| 3 | `/api/events` hello; a save gives build-queued, build-started, revision within 1 s; workspace lists the revision; foundation UI shows it after Refresh | pass (workspace `sources` key: integration request 1) | `sse-curl.txt` (`curl -N`: `retry: 2000`, `event: hello`, then the build events). `sse.json`: queued/started at 78 ms, revision at 100 ms after the save. `/api/workspace` lists the model with `live.revision 2`; the per-source list is in `/api/live` and the `hello` event, not yet in `/api/workspace` (core.mjs is not this package's file). Browser: `sse-1-r1.png`, `sse-2-after-refresh.png` ("r2 is newer" after Refresh), `sse-3-r2-selected.png` (r2 opened, delta strip, no console messages). |
| 4 | Two saves 100 ms apart on pocket-plate: `build-cancelled` within 350 ms, no process of the group, only the second revision | pass | `cancel.json`: saves 102 ms apart, `build-cancelled` 116 ms after the second save (81 ms in the previous run), the old group still present at the cancel (grace) and gone 600 ms later (`ps -g`), r3 started on the spare at once and registered alone (r2 never registered). The earlier failure of this item (one merged build, from a sliding debounce window that the late FSEvents duplicate extended) is fixed and covered by the watcher unit test. Unit tests "cancel: the spare takes the next job at once …", "session: a save supersedes at once …". |
| 5 | Model id equals the CLI's; `--out` bytes equal; `--format print` writes `.stl` and `.print.json`; failed build leaves `--out`; restart shows r0 | pass | `parity.json`: model id `821c5fdc…` for live and CLI (`--param 'thickness=12 * millimeter'`), all four files byte-identical for `all`, `.brep.json .step .stl .print.json` identical for `print`, mtimes unchanged after `r2 FAILED`, restart prints `r0 previous session · 1 body · 8 faces (8 logical) · 50×40×12 mm recorded`. Unit test "live loop: CLI parity, --out …". |
| 6 | Manifest-bound edit fails with kind provenance and the manifest path; `.py` through uv-python; local import fails with kind input at its line | pass | `manifest.json`/`manifest.txt` (r10b copy): standing note at start, `r2 FAILED provenance Frozen module manifest does not match the FeatureScript source SHA-256`, `manifest tmp/viewer/live/live-server/r10b/modules.json`. (The unmodified r10b itself fails today with a kernel capability error from the current kernel state; that is not a viewer issue.) `python-ps.txt`: the worker group is `node build-worker.mjs` → `uv run --no-project python -I -S -B -u …/runner.py` → uv's interpreter; no direct `python3` call. `python.json`: `local-import.py:1 ModuleNotFoundError`, kind `input`, line 1. |
| 7 | No children or watchers after close()/Ctrl-C; workers exit within 5 s after `kill -9` of the parent | pass | `lifecycle.json`: Ctrl-C exit 0, both build workers and the query worker gone; `kill -9` during an 8M-turn build: both workers gone after 137 ms (278 ms in the first run). Unit tests: live loop asserts 0 source and kernel watcher handles and no child process after `close()`; "kill -9 of the parent …" 240-272 ms; CLI test checks the worker pids after SIGINT. |
| 8 | Injected start crash: three failures give `worker-failed` with the stderr tail, backoff lines, idle CPU | pass | `crash.txt`: two `build worker exited with code 3 before it was ready; retry N in 1 s / 2 s` lines, then `build worker failed to start 3 times within 60 s …` with the stderr tail. `crash.json`: SSE `worker-failed` with `stderrTail`, server 0.0 % / 0.3 % CPU 3 and 6 s later, no child processes. |
| 9 | `GET /api/source/<sha>` returns the exact bytes of a source under `$TMPDIR` | pass | `outside.json`: `/var/folders/…/T/wonky-live-qa/bracket.fs`, 200, bytes identical. Also asserted in the live loop unit test. |
| 10 | With a tab open, a restart calls the opener 0 times; a fresh start calls it once | pass | `opener.json`: one opener call after the fresh `--open` start, still one after the restart; the page's EventSource got a new `hello` from the new session 2 s later; terminal `browser     tab reconnected; no new tab opened`; screenshot `opener-tab-after-restart.png`. The foundation client does not open an EventSource yet (live-client), so the QA page opens one itself. Unit test "the opener runs for a fresh start and not …". |
| 11 | Unit tests: ring eviction by bytes keeps pins; archive from the spool; lag < 50 ms during a 4 s build; no worker for `.brep.json`; stale job ids dropped | pass | `test/viewer-live-server.test.mjs` 14/14, `test/viewer-live-server-workers.test.mjs` 8/8 (including: the build worker's draw payload is byte-identical to the query worker's for the same model, so one ETag names one payload). Lag: 4.1 to 4.6 s builds, p99 14.7 to 18.9 ms; max 20 to 72 ms, the same range as an idle 4 s window measured just before (p99 17.5 to 31.9 ms, max 27 to 38 ms) at load 46 to 124, so the spikes are CPU starvation, not work on the loop. The test asserts p99 < 50 ms and max < 250 ms. |
| 12 | VS 32/32, RV 7/7 | pass | `test/viewer-state.test.mjs` 32/32, `test/review.test.mjs` 7/7. `node scripts/viewer/check-format.mjs`: 166 files ok. |

## Gaps

- `GET /api/workspace` has no `sources` key yet; `routes/core.mjs` is not a
  file of this package (integration request 1). The data is in
  `registry.sources()`, `/api/live` and the SSE `hello`.
- `GET /api/models/:id` of a live revision parses the stored scene text and
  stringifies it again on the event loop; `registry.sceneText(id)` returns the
  compact text for a direct send (integration request 2).
- Tab reuse needs a tab that opens `/api/events`; the foundation client does
  not (live-client opens it). Client pins also come from live-client.
- The first `/summary` or `/entities` request of a large live revision creates
  its geometry inspector on the event loop (18 to 98 ms for r10b-retained);
  registration itself only hashes and parses (3 to 6 ms for 2.6 MB).
- The kernel fingerprint covers the workers' import closure instead of all
  `src/**/*.mjs` and `kernel/**` (spec 10.4), because other workflows edit
  directories that builds never load.
- A `display` failure keeps the built model under
  `tmp/viewer/failed-display/<id>.brep.json` (path in the payload); there is no
  download route for it yet.
- Python model ids depend on the interpreter uv picks; CLI parity is proved
  for `.fs` only. Local imports and part names for `.py` need the frontend
  owner (spec 14).
- Terminal ordering at startup: `r1 building` can print before `r0 previous
  session`, because the seed's registration finishes after r1 has started.
- `test/viewer-server.test.mjs` "frozen stubs" fails on the logical-faces
  assertion since topology-classes implemented `logicalFaces`; its SSE part is
  unchanged. Not this package's test.
