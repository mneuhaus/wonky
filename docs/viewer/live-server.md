# Live build server

Package live-server (spec sections 3.1, 9.2, 9.4, 10.4, D1, D4, D5, D7, D17,
D18, D22). `wonky-view part.fs` watches a source, rebuilds it on every save in
a warm background process, prints one line per build and pushes each
revision to the browser over Server-Sent Events. The package report with the
acceptance evidence is `docs/viewer/package-live-server.md`.

## Usage

```
node bin/wonky-view.mjs part.fs [more.fs|part.py|model.brep.json ...]
    [--feature F] [--param 'name=expr']... [--modules manifest.json] [--max-steps N]
    [--curved-contacts strict|tolerated-regularized] [--contact-cap-mm N]
    [--python exe] [--timeout-ms N] [--max-requests N]
    [--out prefix] [--format all|step|print] [--deviation-mm N]
    [--port N] [--reviews dir] [--json] [--open|--no-open]
node bin/wonky-view.mjs project.view.json|build/studios/manifest.json
    [--port N] [--reviews dir] [--json] [--open|--no-open] [--print-workspace]
```

- `.fs` and `.py` inputs are live sources; `.brep.json` inputs are shown as
  saved (the pre-rework behavior; no build worker runs for them). Several
  sources are allowed; build flags apply to all of them.
- A workspace file (`*.view.json`, schema `wonky.view-workspace/1`) or a
  CAD project's `build/studios/manifest.json` serves several models, each
  with its own build options, from one process (docs/viewer/workspace.md).
  It must be the only input; build and output flags next to it exit 1.
  Internally plain inputs form an implicit workspace (one model per input,
  the CLI flags on every live model), so both paths share one server.
- Build flags mean exactly what they mean for `bin/wonky.mjs`. A live
  revision's model id equals the id of the CLI's `.brep.json` for the same
  source bytes and flags.
- `--out prefix` (one live source) writes every good revision like the CLI:
  `.brep.json`, `.step`, plus `.stl` and `.html` for `--format all` (the
  `.fs` default) or the print mesh `.stl` and `.print.json` for `--format
  print`. The bytes equal the CLI's. A failed or superseded build never
  touches the files.
- Python: `.py` runs through `scripts/viewer/uv-python` (`uv run
  --no-project python -I -S …`) unless `--python` is given; `python3` is never
  called directly. The watch set is the source plus every project file the
  last build loaded (the runner records them as `source.modules` with real
  path and SHA-256; a failed build adds the files it loaded before failing).
  A module file joins the baseline when its bytes still match the recorded
  SHA-256, so it never triggers a rebuild of its own; an edit to it does
  (D5, changed 2026-09-23).
- Python timeout: `--timeout-ms` (default 30000) bounds evaluation. The build
  pool adds a 2 s margin: if the worker has not answered by then (with
  `scripts/viewer/uv-python` the interpreter is a grandchild of `uv run` and
  survives the frontend's kill of its direct child), the job fails with kind
  `timeout` and the worker's whole process group, interpreter included, is
  killed.
- Manifest-bound `.fs` sources (a sibling `modules.json` or `--modules`) run,
  but every edit fails by design with kind `provenance` and the manifest path
  (D4); the terminal and `/api/live` carry a standing note. The watch set
  holds the manifest and exactly the files the module loader reads
  (`manifestInputFiles`, `src/modules.mjs`): for schema 2 they resolve
  against the manifest's `store` root (before 2026-09-25 the watcher used the
  manifest directory and watched paths that do not exist).

Environment: `WONKY_VIEW_PORT_RANGE=4320-4399` overrides the derived-port
range, `WONKY_VIEW_OPENER=<command>` replaces the browser opener (it receives
the URL), `WONKY_VIEW_TEST_WORKER_CRASH=1` makes worker startup fail (tests).

## Port and tab

Without `--port` the port is derived from the first input's real path:
4400 + (SHA-256 mod 100), the next free port of the range on collision
(wrapping), so a restart finds its tab at the same origin. `--port N` is
strict: a busy port exits 1 with `wonky-view: port N is in use`. The server
binds before it registers anything.

A browser tab opens only for live sources on a TTY (`--open`/`--no-open`
override). On close the server writes `tmp/viewer/sessions/<port>.json` with
the number of connected event streams. A start within 10 minutes of a
shutdown that had a connected tab waits up to 2.5 s for that tab's
EventSource to reconnect (it retries every 2 s) and opens no second tab.

## Process model

```
wonky-view (server, event loop never builds)
 ├─ build worker (busy)     child_process.fork, advanced serialization,
 ├─ build worker (spare)    own process group, kernel loaded and warmed
 └─ query worker (lazy)     ctx.pool.query kinds, model cache of 4
```

- **Build workers** (`src/viewer/live/build-worker.mjs`, pool in `pool.mjs`)
  load the kernel, the frontends and the display modules once and warm up on
  a small build. Per job they evaluate exactly the bytes the watcher hashed,
  serialize like the CLI (`JSON.stringify(model, null, 2) + '\n'`), validate
  with the geometry inspector, run `reviewScene`, edge classes, logical faces
  and `buildDrawPayload`, render the `--out` formats and reply with the model
  bytes, the scene JSON text, the draw payload and a summary. A failure
  replies with the plain `wonky.live-build-failure/1` payload built in the
  worker. At most one job per source and two jobs overall run at a time, so
  a slow build of one source never holds back another source; one warm spare
  waits. A job held back by another build reports the phase `waiting for
  another build`; only a job that waits for a worker to start reports
  `warming worker` (and `(cold worker)` in the terminal).
- **Cancellation**: a newer save of the same source supersedes the running
  job at once (`build-cancelled`); the job gets at most 250 ms. Then its whole
  process group (a Python child included) is killed with SIGKILL, but only if
  enough warm workers are idle for the queue and the spare. Otherwise the
  worker **drains**: it keeps running the stale build (`job-draining` with
  `limitMs`), is killed as soon as a warm replacement is idle, and takes the
  next job itself if it finishes first. Killing at once made a burst of saves
  use up every warm worker, so the final save waited for a cold start (fix
  round 2: 25.8 s instead of about 0.4 s at load 200+). Draining is bounded
  (Regression review 3: ten superseded builds that hung in `time.sleep(600)` held all
  four worker slots, and the fix and every other source stayed queued
  forever):
  - a drained build is killed (`job-killed`, reason `drain limit`) once it
    has run 1.5 times as long as the last build of its source took (at least
    1 s; before the first build of the source, as long as the last worker
    start took, 5 s before any): a build that runs that much longer than
    usual is taken to hang, and it holds a worker and a CPU. A first version
    bounded the drain by the worker start time alone; in the burst run below
    that killed a 4.3 s stale build 0.1 s before it would have finished;
  - a queued job that needs a worker start while all four slots are taken
    kills the most recently started drained build for its slot (reason
    `slot needed`), so a new save always gets a worker;
  - a job's deadline (Python timeout + 2 s) still applies after it was
    cancelled (reason `deadline`);
  - an explicit Cancel (`POST /api/live/:id/cancel`) never drains: the build
    is killed after the grace.

  The newest save runs at once on a warm worker when one is idle. When every
  warm worker still drains a stale build, which happens in a burst of saves of
  builds that take longer than a worker start, it takes whichever is ready
  first: a drained worker that finishes, or a fresh worker (`(cold worker)`).
  So the newest save does wait for a cold start when builds take longer than a
  worker start (Regression review 3: a 4 s build saved five times 0.6 s apart ran
  on a cold worker after 3.3 s in the queue); only killing a synchronous
  build cooperatively could avoid that, and the kernel cannot be interrupted.
  The next job starts on the spare immediately; missing workers are forked in
  parallel (one at a time after a start failure). A job that waits for a
  worker forked after it was queued reports `warming worker` and `(cold
  worker)`. Only the latest job of a source may register; late results are
  dropped. `/api/live` lists each worker with `cancelled` and `draining`.
- **Lifecycle**: every worker group is killed on `close()`, SIGINT, SIGTERM,
  SIGHUP, `uncaughtException` and `exit`. Workers exit on IPC disconnect, and
  a watchdog thread in each worker kills its group within 250 ms when the
  parent dies (for example `kill -9` during a synchronous build). Start
  failures back off 1, 2, 4 … 30 s; three within 60 s emit `worker-failed`
  with the stderr tail and stop all starts until the next save or rebuild.
  Workers are recycled after 200 builds, above 1.5 GB RSS, or when the kernel
  fingerprint changes. A worker that fails to start sends `{type:
  'start-failed', error}` over IPC before it exits, so `worker-backoff` and
  `worker-failed` carry `error` (for example `SyntaxError: The requested
  module './kernel.mjs' does not provide an export named …`), which the
  terminal and the red banner show instead of the last stack line. Workers
  forked at the same time that all fail count as one attempt.
- **Kernel fingerprint**: size and mtime of every file in the import closure
  of the worker entries (static and dynamic relative imports, `new URL(...)`
  assets, Bend `import ... as` lines), watched with `fs.watch` and settled
  for 3 s before workers are recycled. Deviation from spec 10.4, which names
  all of `src/**/*.mjs` and `kernel/**`: other workflows edit `kernel/proto`,
  `src/lang` and similar directories continuously, and builds never load
  them, so recycling on them would only cost warm workers.
- **Query worker** (`src/viewer/query-worker.mjs` behind
  `src/viewer/query-pool.mjs`): started on the first `ctx.pool.query`, keeps
  the last 4 parsed models, latest wins per `supersedeKey` (409 for the
  loser), timeouts per kind (section and thickness 10 s, printability and
  diff bounds 30 s, draw and scene 60 s). A query that times out while the
  worker runs it kills the worker (a synchronous kernel call cannot be
  interrupted otherwise); the next query starts a fresh one. Tests that pass
  their own `handlers` keep the in-process transport.

## Revisions, ring and archive

Revision numbers are session-local attempts: every queued build takes the next
number (`r1`, `r2`, …). `r0` is the previous session's model: the `--out`
`.brep.json`, else the last good build cached under
`tmp/viewer/live-cache/`, if it was built from the same source path. The
cache key is the real path plus the build options that change the model
(feature, parameters, module manifest, modeling policy; since 2026-09-25), so
a restart with another `--feature` never seeds r0 from a different model. It
is display-prepared by the worker before `r1` and labelled "previous session".

Live revisions are registered from the worker's result: the server hashes,
parses and freezes the source; the scene text and draw payload come
prepared. They live in a byte-bounded ring (`src/viewer/registry.mjs`):

- over the display budget (512 MB of scene text and draw payloads) the least
  recently used unpinned revisions drop their display data (rebuilt on demand
  through the query worker);
- over the model budget (256 MB) they leave memory for the spool
  `tmp/viewer/spool/<session>/<modelId>.brep.json`, from which `archive()`,
  `bytes()`, `model()`, the inspector and review saves still work;
- pins: each source's current revision (server) and client pins from
  `POST /api/live/pins`, dropped 60 s after that client's last event stream
  closed.

`POST /api/models/:id/archive` and saving a review archive live or spooled
revisions to `<reviews>/models/<id>.brep.json` (idempotent, exact bytes). The
spool is removed when the server closes.

Sources are frozen into `<reviews>/sources/<sha>.txt` from the exact bytes the
worker built, also when the file lies outside the repository (D22), so
`GET /api/source/<sha>` answers for them.

## HTTP and events

| Route | Answer |
|---|---|
| `GET /api/events[?client=id]` | SSE stream (below) |
| `GET /api/live` | `{session, sources: [{id, key, path, realPath, label, language, state, watched[], current, lastGood, lastFailure, job, kernelFingerprint, notes, flags}], workers: {build, query} \| null, ring, clients}`; `key` is the workspace model key |
| `POST /api/live/:sourceId/rebuild` | 202 `{jobId, revision}` |
| `POST /api/live/:sourceId/cancel` | 202 `{jobId, revision}`; 409 when nothing runs |
| `POST /api/live/pins` `{client, modelIds}` | `{client, modelIds}` (known ids only) |

Live models in `GET /api/workspace` carry `live: {sourceId, path, key, revision,
revisions, builtAt, kernelFingerprint, previousSession}` (plus `sourceKey` =
`path#key` when two workspace models build one file). `GET /api/workspace`
and the SSE `hello` also carry the workspace `tree` (docs/viewer/workspace.md,
section 2); plain inputs send `implicit: true`.

Every stream starts with `retry: 2000` and a `hello` snapshot (session, url,
port, sources as in `/api/live`, static inputs, workers). Event ids are
`<session>:<seq>`; a reconnect with a `Last-Event-ID` of the same session that
is still among the last 100 events replays what followed, otherwise it gets a
fresh `hello`. Heartbeat comments every 15 s.

| Event | Data (all live events carry `sourceId`, `path`) |
|---|---|
| `source-changed` | `files` (changed watched paths), `hash` (combined) |
| `build-queued` | `jobId`, `revision`, `reason` (start, save, rebuild), `hash` |
| `build-started` | `jobId`, `revision`, `worker` (warm, cold), `pid`, `queuedMs`, `kernelFingerprint` |
| `build-phase` | `jobId`, `revision`, `phase` (warming worker, evaluating, serializing, display, outputs), `elapsedMs` |
| `build-cancelled` | `jobId`, `revision`, `reason` (superseded, cancelled), `supersededBy {jobId, revision}`, `graceMs` |
| `revision` | `jobId`, `revision`, `modelId`, `label`, `sameAs` (earlier revision with the same model), `previousSession`, `timings` (`queuedMs`, worker timings, `registerMs`, `buildMs` = worker start to registration, `totalMs` = with the queue wait), `summary`, `displayNotes`, `notices`, `kernelFingerprint`, `worker`, `output` (Python stdout/stderr) |
| `build-failed` | `jobId`, `revision`, `failure` (below), `lastGood` |
| `worker-failed` | `worker`, `failures`, `windowMs`, `error` (the start error the worker reported), `stderrTail`, `attempts` (each with `error`) |
| `workspace-changed` | `reason` (revision, review-saved), `modelId`, `revision` |

`notices`: facts about a successful build that the user must see because
the model differs from what the source seems to ask for, as `{kind, message,
detail}`. Today: `ignored-captures` when a module-level `result` or
`assembly` wins over show()/export calls (the result contract of
docs/python-frontend.md; `model.source.ignoredCaptures`). They are also on
`lastGood.notices` in `/api/live` and `hello`, printed as `   note: …` under
the ok line, and shown as a blue banner for the displayed revision.

`summary`: `bodies`, `faces`, `logicalFaces`, `edges`, `vertices`,
`volumeMm3` (recorded or null), `bounds {min, max, sizeMm, exactness}` where
exactness is `recorded` (every body carries `validation.boundsMm`) or
`display` with `toleranceMm`. Revision events carry no deltas.

## Failure payload `wonky.live-build-failure/1`

Built in the worker (structured clone would drop custom error properties):
`kind` (`capability`, `input`, `provenance`, `timeout`, `display`,
`internal`), `error {name, message, location {file, line, column},
sourceLine, excerpt {firstLine, text}, traceback, stack}`, `failedOperation
{sequence, name, operationId, callStack}` from `error.modelTrace`,
`callChain` (innermost first: `at <function> (file:line:col)`, then `called
from file:line:col in <caller>`; frames without a source call location, such
as a `defineFeature` wrapper, are left out), `callSite` (the outermost call
into a helper), `completedOperations`, `manifest` (provenance), `output`
(stdout/stderr tails), `timings`, `lastGood`, `jobId`, `revision`.
Python errors raised in an imported project module are located at the
innermost project frame the runner records (`error.sourceFile`/`sourceLine`,
or `error.useSite` for a capability error used inside a module), so the
terminal, the banner and Open in editor point at `dims.py:4`, not at the
model line that imported it; the call chain lists the project frames of the
traceback (`at make (helper.py:4)`, `called from main.py:12 in <module>`)
and `callSite` is the model's line. The excerpt shows the module's text only
when its bytes still match the SHA-256 the build recorded. A missing
source file fails with kind `input` without a build. `display` means the
model built but display preparation failed; its bytes are kept under
`tmp/viewer/failed-display/<id>.brep.json` and nothing is registered.

## Terminal

One line per event that matters; `--json` prints every event (and the
startup `hello`) as NDJSON `{"event": <SSE name>, ...data}` on stdout and
nothing else (notices go to stderr).

```
wonky-view  http://127.0.0.1:4397/viewer/  (port from source path; --port pins it)
reviews     tmp/viewer/live/live-server/reviews
watching    tmp/viewer/live/live-server/bracket.fs
r1 building tmp/viewer/live/live-server/bracket.fs (cold worker)
r1 ok 3.6 s · 1 body · 8 faces (8 logical) · 50×40×8 mm recorded
r2 FAILED input tmp/viewer/live/live-server/bracket.fs:31:9 Expected ';', found 'opExtrude'
   showing last good r1
r3 FAILED capability …/bracket.fs:13:5 opBoolean supports … general trimmed-face booleans are not implemented
   at bore (…/bracket.fs:13:5)
   called from …/bracket.fs:33:5 in part
   showing last good r1
r4 cancelled (superseded by r5)
```

The time after `ok` is the build time (worker start to registration); a
wait of 0.5 s or more for a worker is added, for example `r6 ok 4.04 s (queued
3.3 s)`. Build notices follow as `   note: …` lines. Bounds print as
`recorded` or `≈ … display ±t mm`. With several sources each
line starts with the source label.

## Modules

| File | Role |
|---|---|
| `bin/wonky-view.mjs` | arguments, signals, exit codes |
| `src/viewer/server.mjs` | bind first, registry, sessions, pools, pins, close |
| `src/viewer/live/session.mjs` | per-source watch set, revision numbers, supersede, r0 seed, --out, last-good cache; a source missing or unreadable at start fails its r1 (`MissingSourceError`, `UnreadableSourceError`) and is watched instead of stopping the server (the server refuses only when no live source reads and no saved model is listed) |
| `src/viewer/workspace/load.mjs`, `studios.mjs`, `transform.mjs` | workspace files, studio manifest adapter, rigid placements (docs/viewer/workspace.md) |
| `src/viewer/live/watch.mjs` | parent-directory and file `fs.watch`, 75 ms window from the first event, combined hash; a missing or empty source is retried for about 1 s (atomic and truncate-then-write saves) |
| `src/viewer/live/pool.mjs` | build workers, cancellation, backoff, recycling, fingerprint |
| `src/viewer/live/build-worker.mjs` | the worker process |
| `src/viewer/live/failure.mjs` | failure payload |
| `src/viewer/live/terminal.mjs` | terminal lines and NDJSON |
| `src/viewer/live/port.mjs` | derived port, strict bind, session marker, opener |
| `src/viewer/live/out.mjs` | `--out` writes |
| `src/viewer/events.mjs` | SSE hub |
| `src/viewer/registry.mjs` | revisions, ring, pins, spool, archive |
| `src/viewer/sources.mjs` | source freezing |
| `src/viewer/query-pool.mjs`, `query-worker.mjs` | query worker |
| `src/viewer/routes/live.mjs` | live routes |

Tests: `test/viewer-live-server.test.mjs` (ring, spool, failure payload,
terminal, ports, SSE, watcher, fingerprint closure, start backoff, static
session without workers, stale results, end-to-end loop with CLI parity,
event-loop lag, opener) and `test/viewer-live-server-workers.test.mjs`
(cancellation grace and group kill, recycling, parent `kill -9`, query
worker, session supersede logic, CLI strict port, NDJSON and Ctrl-C, draw
payload of the build worker equal to the query worker's).
