# Viewer rework spec

Status: binding spec for the viewer rework, revision 2, 2026-09-22. Inputs:
the six audits in this directory (`audit-daily-use.md`, `parity.md`,
`audit-rendering.md`, `audit-code.md`, `audit-data.md`,
`feature-inventory.md`), their screenshots in `out/viewer/`, and two critic
reviews (Marc's daily loop, engineering). `AGENTS.md` overrides anything here.
Section 16 lists how every critic "must change" item was handled.

Contents: 1 Vision and day-one scope, 2 Principles and decisions, 3 User
flows, 4 Layout, 5 Keyboard and mouse, 6 Defaults and persistence, 7
Rendering, 8 Exactness labels, 9 Server API, 10 Architecture, 11 Foundation,
12 Work packages, 13 Retired or changed behavior, 14 Deferred and requests to
other owners, 15 QA and gates, 16 Critic resolution log.

## 1. Vision and day-one scope

`wonky-view part.fs` is the one command Marc runs next to his editor. It
picks a stable free port, opens (or reuses) one browser tab, watches the
source, rebuilds on save in a warm background process, prints one line per
build to the terminal, and pushes each revision to a calm, model-first view
that keeps the camera and always says which revision is on screen and whether
it is current, building, or the last good one before a failure. Failures are
first-class: file, line, column, call chain and error kind, in the terminal
and in the viewport next to the retained model. The view reads like the OCP
viewer Marc knows (named, colored parts in a side tree with visibility, crisp
dark edges, axes, standard views, section, transparency) and adds what only
wonky has: exact B-rep parameters and closed-form measurements labelled by
exactness, logical faces instead of Boolean fragments, source links in both
directions, numeric deltas against the previous revision, per-part FDM plate
and overhang checks that follow cad-khana's conventions, saved reviews, LLM
context whose every reference still resolves after the server stops, and a
direct path to the slicer. It never invents geometry or measurements and never
shows a mesh approximation as exact.

Day-one scope, stated plainly:

- None of Marc's real parts builds unmodified today (audit-daily-use §5): the
  project-component-049ac660 fails in the Python frontend (`build123d.Part` is not
  implemented), its FeatureScript port builds only without rounded corners and
  bores, and the cad-project-012 hex shaft union fails with `InvalidTopology`. The
  live loop will therefore show failures often. Failure presentation is P0
  and gets the same care as rendering.
- **Single-file `.fs` is the day-one target.** When this spec was written,
  `.py` worked for single-file sources only, because the runner started
  Python with `-I -S` and project-local imports failed at their line. Since
  2026-09-23 the frontend puts the model directory and project root on
  `sys.path` and records the loaded files, and the live session watches them
  (D5). The build123d frontend still records no part names, colors or
  assemblies, so for `.py` the parts tree is anonymous ("Body 1", viewer
  palette colors); that fix belongs to the language/frontend owners
  (section 14).
- Viewer work cannot fix kernel capability gaps. It makes them visible,
  located and honest.

## 2. Principles and decisions

Principles (from AGENTS.md and the audits):

- All geometry and every measured value come from Bend or from recorded model
  data. Display meshes are labelled with their tolerance. Unsupported queries
  return an explicit capability error; no silent mesh fallback.
- The model on screen always names its revision and its trust state (7.4). A
  failed or superseded build is never shown as current. No partial geometry.
- Native ES modules, plain CSS, no build step, no CDN, no new npm dependency.
  Every new or moved JS file keeps lines at or below 100 characters, one
  statement per line, no inline `style=""` in generated HTML.
- Keep every feature in `feature-inventory.md` unless section 13 retires or
  changes it with a reason.
- `src/review-scene.mjs` and `src/display-cylinder.mjs` are not edited in
  this rework (their SHA-256 is recorded in the display evidence, and they are
  part of the native-bridge surface scan). New display data is computed in
  `src/viewer/**` from `reviewScene` output plus Bend calls.

Decisions:

| # | Question | Decision |
|---|---|---|
| D1 | Who runs builds | A forked, pre-warmed build worker plus one warm spare (10.4). Cancel = SIGKILL the job's process group after at most 250 ms grace and promote the spare. Never build on the server event loop. |
| D2 | Per-operation progress | Not in this rework (no observer hook in `build()`). Show phases (queued, evaluating, serializing, display) with elapsed time. Hook requested (section 14). |
| D3 | Python interpreter | `scripts/viewer/uv-python` (`uv run --no-project python "$@"`) unless `--python` is given. Never `python3`. |
| D4 | Manifest-bound `.fs` sources | Live mode runs them; every edit fails by design with kind `provenance`, the manifest path, and a standing note on the source row. |
| D5 | Local Python imports | Watched (changed 2026-09-23): the frontend now puts the model directory and project root on `sys.path` and records every loaded project file in `source.modules` (real path, SHA-256); the live session adds those files to the watch set after each build. |
| D6 | Legacy reviews after the handedness fix | The fix flips screen X and keeps the eye direction for a given yaw/pitch (7.1), so legacy cameras show the same side of the part. Legacy screen-space drawings in single and side-by-side mode are restored by mirroring X within their pane. Legacy wipe drawings over two different models are hidden with the note "Drawn on the legacy mirrored wipe view; cannot be re-projected". Reviews get `cameraConvention: 2`; old files are never rewritten. |
| D7 | Live revision archive | Revisions live in a byte-bounded in-memory ring with a spool (10.4). A revision is archived to `<reviews>/models/` when a review references it **and** whenever any Copy action or print export references it, so every copied `wonky-inspect` command resolves after the server stops. `--out` additionally writes the current good revision like the CLI. |
| D8 | Markup tools | One-shot: after one annotation the tool returns to Select. Double-click (or pressing the key twice) locks it until Escape. |
| D9 | Dirty state | "Unsaved changes" = the review has content (title, notes or annotations) **and** the current review payload (comparison, layout, annotations, text; camera excluded) differs from the last saved payload. The stale-save comparison of an in-flight save still covers comparison and layout (VS save-race tests unchanged). One owner: `features/reviews/dirty.js` (reviews-context). Other features only call `review.touch(reason)`. |
| D10 | Default mode | Model-first. The store's initial value stays `compare: true` (VS fixtures rely on it); `startupWorkspace()` applies the persisted mode (default off) exactly where `app.js:583` turns compare off today. A loaded review restores its own mode. |
| D11 | Measurement location | `src/viewer/measure.mjs` with `kernel.precise`; the browser only formats. |
| D12 | WebGL | WebGL2 with `stencil: true` required. Without it the viewport shows an explicit capability message; inspector, library and API keep working. |
| D13 | Camera | One right-handed, world-space camera module shared by shader, picker and overlays. Z-up turntable, pitch clamped to ±90°, orthographic by default. Fit only on first revision, on request, or when switching to a model from another source. |
| D14 | Test helpers | `scripts/viewer/test-support/`, because `npm test` runs every `test/*.test.mjs`. |
| D15 | Status codes | Legacy routes unchanged (unknown scene stays 400; `Unsupported display edge spline` stays 400, SRV-03 kept). New routes use 400/404/422/500 through `HttpError`. |
| D16 | `GET /api/workspace` side effects | Kept for `.brep.json` inputs (RV). Live sources register only through the build pipeline. |
| D17 | Default port | Without `--port`: a stable port derived from the first input's real path, next free on collision, printed. `--port N` stays strict (busy = exit 1). |
| D18 | Browser tab | Open only for live sources on a TTY (`--no-open`, `--open` override). No new tab when an existing tab reconnects within 2.5 s after a restart. |
| D19 | Settings storage | Server-side `<reviews>/viewer-settings.json` (atomic, schema `wonky.viewer-settings/1`) via `/api/settings`, cached in `localStorage` for first paint. Derived ports make `localStorage` per-origin, so it cannot be the source of truth. |
| D20 | FDM scope | Per body. Plate relation and overhang are evaluated per body with its own up axis and "printed" flag. cad-khana's small-bore exemption is applied by default; the bridge exemption is not applied and the legend says so. |
| D21 | Logical faces | Pick, highlight, measure, count and diff logical faces (fragments joined across exact subdivision edges). Fragment aliases stay addressable. The canonical selection reference keeps pointing at the clicked fragment. |
| D22 | Live sources outside the repo | Sources passed on the command line and their watch set are frozen from the exact hashed bytes wherever they live. Default `--reviews` stays `<wonky repo>/reviews` for every session (one review index). |

## 3. User flows

### 3.1 Live modeling loop (P0)

1. `node bin/wonky-view.mjs part.fs [--feature F] [--param k=v]... [--out
   prefix] [--format all|print] [--port N] [--json] [--no-open]`. Build flags
   match `bin/wonky.mjs`, and a live revision's model id equals the id of the
   CLI output for the same source and flags. Several sources
   (`wonky-view a.fs b.fs`) are allowed; each is its own library group, and
   build flags apply to all of them.
2. The server binds first on its port (D17), prints the URL, then starts the
   warm worker and build r1. If `--out` exists, or a last-good cache exists
   under `tmp/viewer/live-cache/`, it is loaded first as revision r0
   "previous session", so the view and the first delta work across restarts.
3. Terminal (one line per event; `--json` prints the same events as NDJSON
   and nothing else):

   ```
   wonky-view  http://127.0.0.1:4417/  (port from source path; --port pins it)
   watching    part.fs (+2 module files)
   r1 building part.fs
   r1 ok 0.21 s · 1 body · 12 faces (9 logical) · 50×55×14 mm recorded
   r2 FAILED capability part.fs:24:17 opBoolean: general trimmed-face booleans are not implemented
      at cut (part.fs:42:5)
      called from part.fs:57:3
      showing last good r1
   r3 cancelled (superseded by r4)
   ```

   Bounds say `recorded`, `kernel` or `≈ … display ±0.02 mm`.
4. The browser shows the pill "Building r1 · 0.4 s · evaluating" (only after
   250 ms, so fast builds do not flicker) and then the model, fitted once.
5. Marc saves. The watcher (parent-directory `fs.watch`, 75 ms debounce)
   hashes the whole watch set; only a changed combined hash queues a build,
   and exactly the hashed bytes go to the worker. The last good model stays
   interactive; a thin progress bar runs along the top of the viewport; the
   pill shows phase, elapsed time and Cancel.
6. Saving again while r2 builds supersedes it: r2 gets at most 250 ms to
   finish, then its process group is killed; r3 starts on the warm spare
   immediately. A late r2 result is dropped (results are keyed by job id).
7. On success the new revision replaces the old one when its draw payload is
   ready. Camera, visibility, section, plate, overhang and per-body settings
   are kept. Derived data (measurements, printability flags, section contours,
   geometry tables, diff, thickness) is keyed by model id; it is cleared on the
   swap and shows "pending" until recomputed for the new revision. The
   selection is carried when its recorded identity resolves exactly;
   otherwise it is cleared with a toast ("B1.F3 has a revision-local identity;
   not carried to r3").
8. The delta strip under the model title shows the change against the
   previous revision: bodies, faces (raw and logical), edges, recorded volume,
   bounds, each labelled, plus the source change ("source: lines 5, 7
   changed"). It never opens a wipe by itself.
9. On failure the amber banner says "Showing last good r2. Source now fails:
   capability error at part.fs:24:17 in opBoolean", plus "called from
   part.fs:57" when the failing frame is inside a helper. Details opens the
   drawer (message, excerpt, call chain, failed operation, kind, timings);
   Open in editor uses `zed://` by default. If no build ever succeeded, the
   viewport shows the failure panel instead of a model.
10. A reload keeps everything (server-held revisions, SSE `hello`). A server
    restart on the same derived port lets the open tab reconnect; no second
    tab opens.
11. Follow live (on, key `L`) switches to each new revision. When off, or while
    a review with annotations on the displayed revision is open (follow
    paused), a chip "r4 available" appears and the view stays.

### 3.2 Inspect (P0)

Hover highlights the whole logical face (or edge, vertex) and shows a status
line with type and key parameter ("Cylinder hole Ø4.0000 mm · exact ±0.0003").
Click selects. The inspector shows: selection header (logical face `B1.L3`
with its fragments `B1.F4, B1.F9`, each clickable), **Exact geometry** (plane:
outward normal, offset along the normal, in-plane frame; cylinder: hole/boss,
Ø and r, axis direction, the axis point closest to the world origin; cone:
half angle, radii; line: endpoints, length, direction; circle/arc: center,
normal, Ø, sweep, arc length; vertex: point), then identity, source, browse
geometry, model overview, bodies and LLM context. The model "Size" states
whether it is recorded, kernel-resolved or a display envelope ±0.02 mm.

### 3.3 Measure (P0)

Shift-click or ⌘-click adds or removes entities (4 CSS px drag threshold, so a
jittery Shift-click never pans). With two or more entities the inspector
shows **Measurement** from `POST /api/models/:id/measure`:

- plane/plane: angle, parallel offset, coplanar flag;
- line/line: angle, distance between infinite lines, segment endpoint gaps;
- cylinder/circle pairs: radii, axis angle, axis distance, coaxial and
  concentric flags; for a boss inside a hole the **radial gap**
  r_hole − r_boss and **diametral clearance** 2·(r_hole − r_boss) (minimum
  radial clearance r_hole − r_boss − d for parallel axes); for a hole inside
  a boss of the same body the **wall thickness** r_boss − r_hole − d; for two
  bodies that case is a negative clearance labelled interference; disjoint
  cylinders get the gap d − r1 − r2; crossing circles get no clearance
  (hole/hole or boss/boss coaxial: radius difference); all labelled
  "supporting cylinders" (trims and axial overlap are not considered);
- axis to plane: distance and angle;
- vertex/vertex: distance with ΔX/ΔY/ΔZ; vertex/plane: signed distance.

Every row has label, tolerance, method and inputs (`B1.L3@<modelId>`).
Pairs without a closed form show "unsupported: general minimum distance
between trimmed faces needs kernel extrema". Entities from two revisions show
"unsupported: entities from different revisions". The primary result is also
drawn in the viewport as a dimension line with value and exactness chip; the
line's anchor points come from the display picks and say so ("anchor: display
pick"). "Copy measurement" archives the revision and copies the rows. Wall
thickness of two picked parallel walls is their plane offset; the one-click
probe is package thickness-probe (P1).

### 3.4 Compare and diff (P0 model-first and deltas; P1 ghost)

- Compare is off by default and persisted per source. "Compare with previous"
  (model bar or `W`) opens wipe with before = previous revision of the same
  source; for a `.brep.json` input without sibling revisions the before
  selector opens.
- Selectors list same-source revisions first, grouped, with revision number
  and time. Clicking a model from another source in the library leaves compare
  mode and fits; a same-source click keeps compare and the camera.
- The delta strip (3.1 step 8) also shows in compare mode (`GET /api/compare`),
  with logical face counts next to raw counts.
- P1 (diff-overlay): a translucent ghost of the previous revision with a
  blend slider, and exact bounds deltas from edge bands where recorded bounds
  are null. The five-status identity tint is deferred (section 14).

### 3.5 Review (keep; P0 archive, P1 refinements)

Everything in inventory groups ANN and REV keeps working. Changes: one-shot
tools (D8), dirty rule (D9), `cameraConvention` (D6), archive-on-save and
archive-on-copy (D7), per-review error isolation (a corrupt review is an error
row, not "Workspace unavailable").

### 3.6 Printability check (P0)

- `G` toggles the build plate at Z = 0 (Bambu A1 256 × 256 mm by default,
  centered on the world origin), drawn as grid lines (10 mm / 1 mm) and origin
  axes only, so the bottom view (`2`) sees the model through it. Default on for
  live `.fs`/`.py` sources.
- Each body has an **up axis** (default +Z) and a **printed** flag (default
  on; reference and bought parts get it off and are excluded from tint and
  plate relation). Both persist by source path + body name. "Print on
  selected face" (`Shift+B` or inspector action) sets the body's up to −n of a
  selected planar face's exact outward normal. Geometry never moves.
- Plate relation per printed body, from exact or recorded bounds: with up =
  +Z "on plate", "floats 3.2 mm above the plate", "cuts 0.4 mm into the
  plate", "footprint exceeds plate"; with another up axis "bed faces: B1.L2"
  (planar faces at the body's minimum along up). The status bar shows a
  relation only when exactly one body is visible or isolated; otherwise each
  row in the parts tree carries a badge.
- `Shift+G` toggles overhang shading: a face overhangs when
  α = asin(max(0, −n·up)) > α_max (cad-khana convention, default 45°, 1e-6
  slack). Planar faces are classified exactly by the printability API (a
  per-face flag, not the shader); cylinders and cones get exact angular bands
  from the API and are shaded from exact per-vertex normals with the note
  "curved band edges ±5° (display strips)". No tint appears until the API has
  answered for the displayed revision. Bed faces are excluded and outlined.
- Exemptions: hole cylinders with Ø ≤ 12 mm are exempt (cad-khana
  `SMALL_BORE_MM`; hole vs boss from `sameSense`, radius from stored
  parameters, both exact), drawn outlined "exempt: small bore", toggle in
  settings. The legend states "bridge exemption (≤ 10 mm) not applied".
- Legend: "overhang α > 45° from vertical (slicer threshold β = 45°)". The
  slicer value is always β = 90° − α_max; at α_max = 60° it reads β = 30°.
- "Export for print" (per revision, or per body from the parts tree)
  downloads the print STL and its deviation manifest from the existing
  print-mesh export; curved parts get the stated chord deviation.

### 3.7 LLM context and agent access (P0 resolvability, P1 scoping)

- Every Copy action (reference, selected geometry, measurement, model
  overview, LLM context) archives the referenced revision first; copied
  commands use the archived path and resolve after the server stops.
- P1: context scoped to the visible model(s) and selection, inlining exact
  data and measurements; never a hidden compare model; per-revision change
  summary for live sources. "Copy references" copies a multi-selection.
- The browser posts its current selection to the server (ephemeral,
  same-origin). `GET /api/selection` returns it with aliases and exact
  summaries, so an agent can "look at the face Marc selected" without
  copy-paste; this replaces OCP's "quote indices, then `khana pick`" step.
- Agents can run `wonky-view --json` in the background and read build events
  without a browser.

## 4. Layout and interaction design

The light visual language stays: cream background, sage accents, three
columns, rounded cards, the tool rail on the left of the stage, view actions
bottom right. Contrast and density problems are fixed in `styles/tokens.css`
(every text token ≥ 4.5:1, no text under 11 px, honesty-critical notes in a
prominent style). A dark theme follows from the tokens (P1, setting
light/dark/system, default light).

```
+-----------------------------------------------------------------------------------+
| «  Wonky Kernel     ( ● Current r12 · 0.21 s · bracket.fs )    Copy · Save review » |
+---------------+---------------------------------------------------+---------------+
| Parts|Models|Checks | [!] Last good r11. Source fails: part.fs:24:17 | Inspect|Review|
| ⌕ filter      | bracket  r12 · 14:03   [Compare with previous]    | Face B1.L3    |
| 👁 ■ plate  ✓ | Δ faces 8→10 (logical 6→7) · volume +120 mm³ rec. | (F4, F9)      |
| 👁 ■ bracket  |                                                   | Exact geometry|
| 👁 ■ servo ref|                 model                             |  Hole Ø4.0000 |
| Revisions     |          ├── 8.0000 mm exact ──┤                  |  exact ±0.0003|
|  ● r12 now    | [tools]                                           | Measurement(2)|
|  ○ r11 fails  | (triad) ● Current r12   display ±0.02 · overhang α>45° (β 45°) · mm [E][F][O][G][X] |
+---------------+---------------------------------------------------+---------------+
```

- **Header**: the center status is the live pill (trust states 7.4). For
  `.brep.json`-only workspaces it keeps "N model versions · Local workspace".
- **Trust chip in the viewport**: a compact copy of the pill sits in the
  bottom HUD line, so the trust state stays visible at every breakpoint,
  including below 1150 px where RSP-02 hides the header status.
- **Left column**: tabs Parts, Models, Checks (`slots.library.tab`). Parts is
  the default tab when the displayed model has ≥ 2 bodies or a live source is
  open; it shows the parts tree (eye, color swatch, name, alias, counts, FDM
  badge; per-row expansion for opacity, color, printed, up axis, print
  export) and below it the revisions of the current source. Models groups all
  revisions by source (newest first, older folded under "N earlier",
  archived snapshots in their own group). Checks labels kernel reports
  "Workspace checks (not specific to this model)".
- **Collapsible columns**: both side columns collapse with a header button
  and `[` / `]`, persisted globally. The viewport is never covered by a tree.
- **Model bar** (replaces the before/after bar in single mode): title,
  revision chip, delta strip, "Compare with previous". Before/after
  selectors, swap and the wipe/side-by-side bar appear only in compare mode.
- **Viewport HUD**: top-left title and delta strip; top-right selection
  filter; bottom-left axis triad; bottom line: trust chip, display legend
  (tolerance, edge classes, section, overhang with β), unit pill; bottom-right
  view actions (edges, fit, views menu, projection, plate, section, x-ray).
- **Banners** at the top of the viewport (failure, capability notices ≥ 11 px)
  never cover the model title.
- **Inspector** sections in fixed order: selection header, exact geometry,
  measurement, identity, source, browse geometry, model overview, bodies,
  LLM context.
- **Drawer**: reports, frozen source, build failure details. Focus moves into
  the drawer and returns on close.

## 5. Keyboard and mouse

Letters match on `event.key` (case-insensitive unless Shift is part of the
binding). Digits and arrows match on `event.code` (`Digit*`, `Numpad*`,
`Arrow*`), so QWERTZ, the number row and the numpad work; with NumLock off,
`Numpad2` arrives with `key: ArrowDown` and still means the bottom view,
because arrow bindings match only `Arrow*` codes. Bindings are scoped: global,
canvas, drawer, dialog, list (focus-scoped arrows for orbit, wipe handle, tab
lists, Browse geometry). Escape is an ordered stack: the most recently pushed
handler (gesture, open dialog, drawer, locked tool, selection) runs first.
A test that loads all features fails on a conflicting binding in the same
scope; at runtime a conflict is logged and the first binding kept. A setting
disables single-key shortcuts (WCAG 2.1.4). Shortcuts are ignored while typing.

| Key | Action | Origin | Status |
|---|---|---|---|
| V, H | Select tool, orbit tool | wonky | keep |
| C, A, R, P | Comment, arrow, rectangle, pen (one-shot, D8) | wonky | keep, one-shot |
| E | Feature edges on/off | wonky | keep |
| Shift+E | Seam and subdivision edges dimmed on/off | new | P0 |
| F | Fit, keeping orientation | Onshape | changed (was reset) |
| Shift+F | Fit selection | Onshape | P1 |
| 0, Home | Default view (old F behavior) | new | P0 |
| 1 3 4 6 8 2 5 | Front, back, left, right, top, bottom, iso | OCP numpad layout | P0 |
| Shift+1…7 | Front, back, left, right, top, bottom, iso | Onshape | P0 |
| Arrows (canvas focus) | Orbit 15°; Ctrl 5°; Shift 90°; Ctrl+Shift pan | Onshape | changed (was 6.9°) |
| O | Orthographic/perspective | new (OCP `p` is the pen) | P0 |
| T | X-ray: all bodies 50 % transparent, hidden edges faint | OCP, Onshape Shift+T | P0 |
| Y, Shift+Y, I | Hide selected bodies, show all, isolate selected | Onshape | P0 |
| G, Shift+G | Plate, grid, origin axes; overhang shading | OCP `g` | P0 |
| Shift+B | Print on selected face (set body up = −n) | new | P0 |
| X | Section plane on/off | Onshape Shift+X | P1 |
| K | Thickness probe tool (one-shot) | new | P1 |
| W | Compare with previous on/off | new | P0 |
| Shift+W | Ghost of previous revision | new | P1 |
| L | Follow live on/off | new | P0 |
| [ , ] | Collapse library / inspector column | new | P0 |
| ? | Help overlay listing every binding | Orca | P1 |
| Escape | Ordered stack: gesture, dialog, drawer, locked tool, selection | wonky | keep |
| ⌘S / Ctrl+S | Save review | wonky | keep |
| ⌘Z / Ctrl+Z | Remove last annotation | wonky | keep |

Mouse (Z-up turntable kept; trackball rejected because it tilts Z away from
the print direction). Every click gesture, with or without Shift/⌘/Alt, has a
drag threshold of 4 CSS px: below it the gesture is a click, at or above it a
drag.

| Gesture | Action | Status |
|---|---|---|
| Left-drag (Select or Orbit tool) | Orbit about the view target | keep |
| Shift+left-drag, middle-drag, right-drag (≥ 4 px) | Pan | keep |
| Wheel | Zoom toward the cursor | changed (was center) |
| Ctrl+wheel (trackpad pinch) | Zoom toward the cursor | P1 |
| Two-finger scroll with "Trackpad mode" | Pan | P1 |
| Click (< 4 px) | Select logical face / edge / vertex (vertex > edge > face, depth, filter) | keep, logical |
| Shift-click, ⌘-click (< 4 px) | Add/remove from selection | P0 |
| Alt-drag in markup tools | Orbit | keep |
| Right-click without drag | Suppressed | keep |

## 6. Defaults and persistence

Scopes: **G** global (settings file, D19); **S** per source (real path of a
live source, input path of a `.brep.json`); **SB** per source + body name
(body name if present and unique in the model, else body id); **R** saved with
a review; **U** URL/session only.

| Setting | Default | Scope | Package |
|---|---|---|---|
| Compare on/off | off | S | model-first-compare |
| Compare layout, split | wipe, 0.5 | G (R when a review is loaded) | model-first-compare |
| Follow live | on | S | live-client |
| Camera | fit on first revision | S (last camera per source), U | camera-navigation |
| Projection | orthographic | G | camera-navigation |
| Feature edges (E) | on | G | render-look |
| Edge width | 1.5 CSS px | G | render-look |
| Seam/subdivision edges (Shift+E) | hidden | G | render-look |
| X-ray (T) | off | S | render-look |
| Body visibility | visible | SB | parts-tree |
| Body opacity | 100 % | SB | parts-tree |
| Body color override | none (appearance, else viewer palette) | SB | parts-tree |
| Library tab | Parts if ≥ 2 bodies or live source, else Models | S | parts-tree |
| Library / inspector collapsed | expanded | G | parts-tree |
| Plate (G) | on for live sources, off for `.brep.json` | S | fdm |
| Plate size | 256 × 256 mm | G | fdm |
| Overhang shading (Shift+G) | off | S | fdm |
| Overhang threshold α_max | 45° | G | fdm |
| Small-bore exemption | on, Ø ≤ 12 mm | G | fdm |
| Body printed | on | SB | fdm |
| Body up axis | +Z | SB | fdm |
| Section | off; one plane; last plane position | S | section |
| Selection filter | auto | G | exact-measure |
| Trackpad mode | off | G | camera-navigation |
| Editor scheme | `zed` | G | foundation (`core/editor-links.js`) |
| Single-key shortcuts | on | G | help-a11y |
| Theme | light | G | help-a11y |
| Inspector tab | Inspect | G | foundation |

Acceptance for every package that owns a row: change the setting, restart
`wonky-view`, and the setting is still in effect (for example: hide a body,
restart, the body is still hidden).

## 7. Rendering spec

### 7.1 Camera (`viewer/render/camera.js`, pure)

State: `{convention: 2, target: [mm, float64], scale, yaw, pitch, projection}`.
`scale` is mm per CSS px (ortho) or distance (perspective, fov 35°). `yaw` and
`pitch` are radians with **today's meaning** (yaw 0 = eye on the +Y side;
larger depth = nearer), pitch clamped to [−π/2, π/2], yaw never normalized on
restore. The handedness fix flips screen X; the eye direction for a given
yaw/pitch does not change. Presets are defined by `lookFrom(direction, up)`,
as in Onshape/OCP: Front from −Y, Back from +Y, Left from −X, Right from +X,
Top from +Z with +Y up and +X right, Bottom from −Z, Iso from (+1, −1, +1).
Zoom limit physical: 1 µm to 10 m per CSS px. Near/far from the bounding
sphere of the passed bounds.

Frozen API (foundation delivers it with today's numbers; camera-navigation
reimplements it):

```
defaultCamera(bounds) -> camera
viewProjection(camera, pane, bounds) -> Float64Array(16)
project(point, camera, pane, bounds) -> {x, y, depth}       // larger depth = nearer
unproject(x, y, depth, camera, pane, bounds) -> [x, y, z]
basis(camera) -> {right, up, toward}                          // right × up = toward
lookFrom(direction, up, camera) -> camera
preset(name, camera) -> camera                                // 7 names
fit(bounds, camera, pane) -> camera
depthPerPixel(camera, pane, bounds) -> mm of view depth per CSS px
fromLegacy({yaw, pitch, zoom, pan}, {center, extent, pane}) -> camera
toLegacy(camera, {center, extent, pane}) -> {yaw, pitch, zoom, pan}
```

`pane` is `{x, y, width, height, clipX, clipWidth, modelId, side}`. The state
facade keeps `state.camera`, `state.center` and `state.extent` readable and
assignable (VS assigns all three); assignments go through `fromLegacy`.
Tests: determinant +1 for all presets and 100 random angles; Top maps +Y up
and +X right; picker and renderer agree within 1e-6 px; legacy round trip
within 1e-9.

### 7.2 Transport, cache, picking

- **Draw payload** (`GET /api/models/:id/draw`, 9.3): binary, little-endian,
  positions relative to the model center (subtracted in float64 on the
  server), exact per-vertex normals for planes, cylinders and cones computed in
  `src/viewer/draw.mjs` from the stored surface parameters (triangle normals,
  flagged `display`, elsewhere), triangle winding normalized to the outward
  normal, per-vertex face index, B-rep vertex points, edge polylines with edge
  class, logical face per face. Rendering, picking and hover use **only** the
  draw payload.
- **JSON scene**: the inspector still reads identity, source and
  `edgeIndices` from the JSON scene. It loads on demand into the LRU on the
  first inspection of a model, never on a revision swap, and is served compact
  (content unchanged, whitespace removed).
- **Cache** (`render/scene-cache.js`): LRU by model id; pinned: displayed,
  compare, ghost, and revisions referenced by annotations; at most 8 others or
  256 MB GPU; `deleteBuffer` on eviction; typed arrays retained to rebuild
  after `webglcontextrestored`. `state.scenes` stays a Map-compatible cache that
  accepts JSON scenes (VS sets them directly).
- **Picking** (`render/picking.js`): typed-array CPU picker; project once per
  camera change, screen-bbox reject; depth tolerance 1.5 × `depthPerPixel`
  (not a fraction of extent); skips hidden bodies and clipped-away sides;
  hover drawn in the same frame. A JSON-scene adapter gives identical results
  without WebGL (VS, capability fallback). Same semantics as today (vertex >
  edge > face, filter, depth order); returned references keep the key order
  `{modelId, bodyId, entityType, entityIndex}`.
- **Highlight**: shader-side by uniforms and a small id texture; hover and
  selection expand to the logical face; hover tint ΔE ≥ 20 plus outline;
  selection keeps today's orange; any number of selected entities. The SVG
  edge hover/selection overlays with per-pane `hover-<side>-clip` and
  `selection-<side>-clip` clipPaths stay.

### 7.3 Look (render-look)

- **Lighting**: hemisphere ambient keyed to world +Z, one view-space key
  light, weak fill, low Blinn-Phong specular, linear space, sRGB output;
  two-sided via winding and `gl_FrontFacing`, no `abs()`. Target ≥ 1.3:1
  luminance between the principal iso faces.
- **Edges**: instanced screen-space quads, 1.5 CSS px (setting 1 to 3), color
  `#1d2721` (≥ 4.5:1 on every face shade), depth bias about 1 px of view depth
  (via `depthPerPixel`) toward the camera. Classes from
  `src/viewer/edge-classes.mjs`: `sharp` (dark), `tangent` (45 % opacity),
  `seam` (hidden), `subdivision` (hidden), `unresolved` (drawn as sharp).
  Hidden classes stay pickable through Browse geometry and `Shift+E`.
- **Style table**: one writer. Features write only their store keys
  (`display.parts`, `display.fdm`, `display.section`, `display.xray`,
  `display.edges`, `display.ghost`); `features/display/display.js` is the only
  caller of `renderer.setStyle` and composes them. Styles are keyed by model
  id + body id (body id carries visibility and color across revisions).
  Per-body color from `appearance`, else a fixed palette labelled "viewer
  color"; visibility (alpha 0 plus picker skip); per-body and global
  transparency drawn in two passes (opaque, then transparent back to front by
  bounds center, back faces then front faces, `depthMask(false)`); a tiny
  polygon offset by body rank against coplanar z-fighting.
- **Clip planes**: up to 3 uniforms, `discard` on a center-relative position.
  `frame.drawBodies` accepts stencil func/op, culling and colorMask so section
  can draw caps without editing `gl.js`.
- **Overhang**: per-face flag texture from the printability API for planar
  faces (exact); per-vertex exact normals against uniform `up`/`alphaDeg` for
  curved faces within their API bands; exempt and bed faces outlined.
- **Layers**: `renderer.addLayer({id, order, draw(frame)})` with
  `frame.drawLines({positions, color, widthPx, depthBias, depthTest})` and
  `frame.drawBodies(options)` for grid, plate, origin axes, section contours,
  ghost revision, dimension lines.
- **Budget**: frame ≤ 4 ms at 333k triangles; hover pick ≤ 2 ms after
  projection; both as medians of ≥ 5 runs with the load average recorded.
- **Legend**: the bottom line always states the display tolerance and which
  display-only features are active (smooth normals, hidden seams, display
  section, curved overhang sampling).

### 7.4 Trust states

Inputs: displayed revision D, latest good revision G, latest attempt A (queued,
building, ok, failed, cancelled), source dirty (watched bytes changed, build
not yet queued), follow (on/off/paused), a newer revision N downloading, SSE
connected.

| Condition (first match wins) | Pill and trust chip | Tone |
|---|---|---|
| SSE disconnected | "Disconnected · showing rD · reconnecting" | grey |
| Worker failed to start | "Build worker failed to start · showing rD" | red |
| No good build, A failed | "No successful build · rA fails at file:line" | red |
| A building or queued | "Building rA · phase · 1.2 s" (+ "showing rD" if D ≠ G) | blue |
| Source dirty | "Source changed · showing rD" | blue |
| N downloading | "Loading rN · showing rD" | blue |
| A failed, D = G | "Last good rG · rA fails at file:line" | amber |
| D ≠ G (older picked, follow off or paused) | "Viewing rD · rG is latest" + Go to latest | neutral |
| D = G = A, clean, connected | "Current rD" | green |
| `.brep.json` input | "Static file · rD" | neutral |

"Current" appears only in the last live row. Unit tests cover every row.

## 8. Exactness labels

| Label (UI chip) | API value | Meaning |
|---|---|---|
| exact ±t | `exact-parameters` | Closed form over stored analytic parameters with `kernel.precise`; t = entity tolerance (`validation.toleranceMm`, `vertexTolerancesMm`) or the arithmetic guard, whichever is larger. |
| kernel | `kernel-resolved` | Decided by a Bend function with its guards (ray roots, trim membership, section, edge bands). May be `unresolved`. |
| recorded | `recorded` | Build-time metadata with its `scope`. `null` shows "not evaluated", never 0. |
| design | `design-parameter` | A source call parameter (SI in the source map, shown in mm/deg). Intent, not geometry. |
| reference | `source-reference` | Frozen external oracle values. |
| display ±t | `display-approximation` | From display triangles or polylines; t = display tolerance (0.02 mm) or per-face chord bound. |
| unsupported | `unsupported` | Capability error with reason; no value. |

Formatting (`viewer/core/format.js`, delivered complete by the foundation):
values are printed to the decade of their tolerance, so t = 0.0003 mm gives
four decimals ("Ø4.0000 mm ±0.0003", "20.0000 mm ±0.0003"); angles to 0.001°.
Parallel, coaxial and coplanar decisions in `measure.mjs` use an angular
tolerance of 1e-9 rad (arithmetic guard) and the entity length tolerance t for
offsets; each row echoes both. Outward normals come from the server
(`sameSense` applied). Relations on unbounded supports say so ("supporting
planes", "supporting cylinders", "infinite lines").

## 9. Server API

### 9.1 Existing routes (contracts unchanged)

`GET /`, `GET /viewer/…` (every file under `viewer/`, MIME map, normalized,
unknown and traversal 404), `GET /api/workspace` (models gain optional `live`,
the response gains `sources`, added through `registry.mjs`),
`GET /api/models/:id` (compact JSON), `/summary`, `/entities/:alias`,
`GET /api/source/:sha`, `GET /api/reports/…`, `GET|POST /api/feedback…`.

### 9.2 New routes

| Method | Path | Package | Response | Exactness |
|---|---|---|---|---|
| GET, PUT | `/api/settings` | foundation | settings document (D19), scopes G/S/SB | – |
| POST | `/api/models/:id/archive` | foundation stub, live-server | `{path, modelId}`; idempotent; archives live or spooled revisions | – |
| GET | `/api/events` | live-server | SSE: `hello`, `source-changed`, `build-queued`, `build-started`, `build-phase`, `build-cancelled`, `revision`, `build-failed`, `worker-failed`, `workspace-changed`; ids `<session>:<seq>`, replay of the last 100 after `Last-Event-ID`, heartbeat 15 s, `retry: 2000`. Revision events carry no deltas. | status |
| GET | `/api/live` | live-server | `sources: [{id, path, language, state, watched[], current, lastGood, lastFailure, job, kernelFingerprint}]` | status |
| POST | `/api/live/:sourceId/rebuild`, `/cancel` | live-server | 202 `{jobId}` | status |
| POST | `/api/live/pins` | live-server | `{modelIds}` pinned for this client (dropped 60 s after its SSE connection closes) | – |
| GET | `/api/models/:id/draw` | render-transport | binary draw payload (9.3), `ETag` = model id + draw version | display |
| GET | `/api/models/:id/topology` | topology-classes | edge classes and logical face groups with fragment aliases | exact / recorded |
| GET | `/api/models/:id/geometry[?aliases=…&page=…]` | exact-measure | faces `{alias, logical, surface, outwardNormal, hole, axisPointNearestOrigin}`, edges `{alias, curve, range, lengthMm, class}`, vertices `{alias, point, toleranceMm}` | exact |
| POST | `/api/models/:id/measure` `{entities}` | exact-measure | `{measurements: [{quantity, value, unit, exactness, toleranceMm, angularToleranceRad, method, inputs, note}], unsupported: [{quantity, reason}]}` | per row |
| GET | `/api/compare/revisions` | model-first-compare | `revisions: [{modelId, kind input/live/archive, source, revision, time, timeBasis, recordedSource}]` | recorded |
| GET | `/api/compare?before=&after=` | model-first-compare | Δ bodies, faces raw and logical, edges; bodies matched by body id; recorded volume Δ; bounds Δ labelled; changed source lines | per row |
| POST | `/api/models/:id/resolve` `{from, references}` | live-client | per reference `{status: exact / lost / ambiguous, alias?}` via `matchTopologyReference` | identity |
| GET | `/api/models/:id/history` | source-links | operations `{sequence, name, operationId, span, callPath, parameters, outputs}`; entity→operation, face→sketch entity | recorded / design |
| GET, POST | `/api/selection` | reviews-context | current browser selection `{updatedAt, modelId, revision, references: [{ref, alias, logical, summary}]}`; ephemeral | exact |
| GET | `/api/models/:id/print.stl`, `print.json` `[?body=&deviationMm=]` | reviews-context | print mesh and deviation manifest via `src/print-mesh.mjs` (import only); archives the revision | display ±deviation |
| GET | `/api/models/:id/parts` | parts-tree | bodies `{alias, id, name, appearance, representation, counts {faces, logicalFaces, edges}, volumeMm3, boundsMm, operation, provenance}` | recorded |
| POST | `/api/models/:id/printability` `{alphaDeg, smallBoreMm, bodies: [{bodyId, up, printed}]}` | fdm | per body `{bodyId, up, printed, plate {relation, minAlongUpMm, bedFaces, exactness}, faces: [{alias, kind: ok / overhang / bed / exempt-small-bore / unsupported, bandsDeg?, reason?}]}`; echoes α, β and conventions | exact / kernel |
| POST | `/api/models/:id/section` `{origin, normal}` | section | `{status, reason?, contours}` from `sectionSolid`; only on "Exact contour" | kernel; polylines display |
| GET | `/api/diff?before=&after=` | diff-overlay | ghost pairing and exact edge-band bounds deltas | kernel / recorded |
| POST | `/api/models/:id/thickness` `{face, point}` or `{origin, direction}` | thickness-probe | `{status: measured / unresolved / no-hit, mm, hit, blocking[]}` | kernel |

Every route checks the Host header against `127.0.0.1:<port>` and
`localhost:<port>`; POST routes keep the same-origin check.

### 9.3 Draw payload (`wonky.draw/1`, little-endian, sections 4-byte aligned)

```
u32 magic 'WKD1' | u32 headerBytes | header JSON (utf-8, padded)
| f32 positions[3n] | i16 normals[2n] (oct16) | u32 faceOfVertex[n]
| u16 bodyOfVertex[n] | u32 indices[3m]
| f32 edgePoints[3k] | u32 edgeSegments[2s] | u32 edgeOfSegment[s] | u8 edgeClass[e]
| f32 vertexPoints[3v] | u16 bodyOfPoint[v] | u32 vertexIndex[v]
```

Header: `{schema, modelId, center, bounds, toleranceMm, bodies: [{index,
alias, id, name, appearance, faceRange, indexRange, edgeRange, pointRange}],
faces: [{alias, surfaceType, logical, indexRange, normalSource: exact|display,
maxChordErrorMm, displayWarning?}], logicalFaces: [{alias, fragments}],
edges: [{alias, curveType, class}], notes}`.

Frozen producer signature (foundation stub returns `null`, meaning "compute
lazily in the query worker"): `buildDrawPayload(model, scene, {logical,
classes}) -> {header, buffer} | null` in `src/viewer/draw.mjs`.

### 9.4 Live failure payload

`wonky.live-build-failure/1`, built **inside the worker** (structured clone
drops custom Error properties, so only this plain object crosses IPC):
`kind` (`capability`, `input`, `provenance`, `timeout`, `display`,
`internal`), `error {name, message, location {file, line, column},
sourceLine, excerpt}`, `failedOperation {sequence, name, operationId,
callStack}` from `error.modelTrace`, `callSite` (the first frame in the
top-level source when the failing frame is in a helper), `completedOperations`,
`timings`, `lastGood`, `jobId`. Python failures include the traceback.
`display` means the model built but display preparation failed; it is still
downloadable, never shown as a complete render.

## 10. Architecture and module layout

### 10.1 Client

```
viewer/
  index.html          shell with data-slot regions; <link>s every CSS file statically
  main.js             boot: loads features via isolated dynamic import, calls createViewer
  app.js              createViewer(env, {seams, features}): composition root, frozen after F
  core/
    store.js          createStore: get, update(reason, recipe) (mutating, never freezes), select
    requests.js       latest-wins scopes with AbortController
    api.js            json/binary/text/post helpers, error mapping, abort
    events.js         SSE client; stub until live-client
    dom.js            html`` escaping template, focus-preserving patch
    format.js         units, tolerance-decade formatting, 7 exactness chips (complete, tested)
    icons.js          icon set and [data-icon] hydration
    commands.js       command registry {id, label, keys, scope, run, enabled}
    keyboard.js       scoped bindings, Escape stack, typing guard, conflict check
    pointer.js        pointer router, drag threshold, tool -> gesture handlers
    overlay.js        SVG overlay with ordered layers (renderOverlay)
    slots.js          extension points (10.3)
    settings.js       settings with scopes G/S/SB, /api/settings, in-memory under the legacy seam
    editor-links.js   zed:// (default), vscode://, cursor:// file:line:column
    feature-loader.js isolated import + explicit per-feature failure notice
  render/
    camera.js panes.js picking.js scene-cache.js renderer.js gl.js shaders.js
    draw-decode.js style.js layers.js
  features/
    index.js          ordered feature list; `legacy: true` marks the VS feature set
    library/ compare/ selection/ inspector/ annotations/ reviews/ reports/ drawer/
    source/ view/ display/ live/ measure/ parts/ fdm/ section/ diff/ thickness/ help/
  styles/
    tokens.css base.css layout.css
```

A feature module exports `{id, legacy, setup(ctx)}`; `setup` returns
`{dispose, api, legacy, defaults}`: `legacy` maps harness function names and
state-facade fields to accessors, `defaults` gives its store slice defaults.
`app.js` only merges them and throws on a duplicate name (tested). The facade
returns live mutable objects (VS mutates `ui.state.workspace.reports`,
`ui.state.annotations[0].view`, `ui.state.scenes.set(...)`); the store never
freezes slices. `ctx`: `store`, `api`, `requests`, `events`, `renderer`,
`overlay`, `slots`, `commands`, `drawer`, `notify`, `settings`, `format`,
`review` (`touch(reason)`). Features never import each other (checked by
`scripts/viewer/check-format.mjs`).

**Legacy seam.** VS dispatchers throw on unexpected requests, the inspector
tests throw on any fetch, and `assertReviewB` requires an empty
`#global-error`. The VS harness therefore passes the preloaded legacy feature
set only (library, compare, selection, inspector, annotations, reviews,
reports, drawer, source, view) with in-memory settings and no renderer. Every
package keeps new requests (draw, geometry, compare, parts, printability,
settings, `/api/live`, EventSource, `localStorage`) out of the legacy load
path or behind non-legacy features, and never reports their failures through
`showError`; they use their own section or banner.

**Frozen contracts** (changing one needs an maintainer decision):

- DOM ids used by VS: `#after-model`, `#annotation-overlay`, `#close-report`,
  `#comparison-range`, `#comparison-split`, `#copy-selection`, `#fit-view`,
  `#global-error`, `#layout-side-by-side`, `#layout-wipe`, `#model-canvas`,
  `#report-content`, `#report-drawer`, `#report-title`, `#review-notes`,
  `#review-title`, `#save-review`, `#save-state`, `#selection-content`,
  `#selection-mode`, `#view-presets`, `#wipe-handle`, plus every other id in
  today's `index.html` (the foundation records the full list in
  `docs/viewer/contracts.md`). `#view-presets` opens the Views menu and
  `#fit-view` fits; both clear hover.
- State facade fields: `after, annotations, before, camera, center, compare,
  dirty, extent, hover, hoverPane, layout, loading, mode, panel, saved,
  saving, scenes, selection, split, workspace`. `state.selection` is the
  primary reference or null; the multi-selection is `state.selectionSet`.
  Assigning `state.selection` replaces the set.
- Selection reference: exactly `{modelId, bodyId, entityType, entityIndex}`
  in this key order. Alias, body index, logical face and identity are derived
  by lookup, never stored in the reference. `validateReview` reads
  `target.bodyId`.
- Harness functions and their owners after the foundation:

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

Seams: `renderInspector`, `scheduleDraw`, `renderAnnotations`,
`renderLibrary`, `renderSaved`, `panel` (the harness passes no-ops).

### 10.2 Server

```
src/review-server.mjs          facade: re-exports createReviewServer, validateReview
src/viewer/server.mjs          lifecycle: bind first, then register; close() ends SSE, kills workers
src/viewer/http.mjs            send helpers, HttpError, Origin and Host checks, body reader (frozen)
src/viewer/static.mjs          viewer/** with normalization and MIME map
src/viewer/router.mjs          add(method, pattern, handler) (frozen)
src/viewer/registry.mjs        revisions, register queue, ring, pins, spool, archive
src/viewer/reports.mjs         report discovery and image registry
src/viewer/reviews.mjs         validateReview, save/load
src/viewer/review-camera.mjs   camera validation for both conventions
src/viewer/context.mjs         context and Markdown writers
src/viewer/sources.mjs         source snapshot freezing
src/viewer/settings.mjs        settings document
src/viewer/events.mjs          SSE hub
src/viewer/query-pool.mjs      ctx.pool.query (frozen API); query-worker.mjs
src/viewer/routes/index.mjs    loads every route module by isolated dynamic import
src/viewer/routes/{core,settings,reviews,live,draw,topology,geometry,measure,compare,
  resolve,history,selection,export,parts,printability,section,diff,thickness}.mjs
src/viewer/live/{session,watch,pool,build-worker,failure,terminal,port,out}.mjs
src/viewer/{draw,edge-classes,logical-faces,geometry,measure,compare,source-diff,carry,
  history,selection,export,parts,printability,section,diff,thickness}.mjs
```

A route module exports `register(router, ctx)`; `ctx` holds `registry`,
`events`, `sources`, `reports`, `settings`, `pool`, `origin`,
`reviewDirectory`. A route module that fails to load logs its error and its
paths answer 500 "route module <name> failed to load"; the server still
starts.

Frozen server contracts (foundation; later packages may only add):

- Registry read API: `get(modelId)`, `list()`, `scene(modelId)`,
  `model(modelId)`, `sources()`, `archive(modelId) -> path`,
  `onRevision(listener)`.
- `http.mjs`: `send`, `sendBinary`, `sendText`, `readJson`, `HttpError(status,
  message)`, `checkHost`, `checkOrigin`. Legacy routes keep 400 mapping.
- `ctx.pool.query(kind, modelId, payload, {timeoutMs, supersedeKey, signal})
  -> Promise`. Handlers are registered by kind in a frozen map in
  `query-worker.mjs` (`draw`, `printability`, `section`, `thickness`,
  `diffBounds`), each implemented in its package's module with the signature
  `(model, payload, {signal}) -> result`. The foundation stub runs handlers
  in-process; live-server makes it a real worker.
- `logicalFaces(model) -> {bodies: [{logicalOf: Int32Array, groups:
  [{alias, fragments, support}]}]}` and `classifyEdges(model, scene) ->
  {bodies: [{classes: Uint8Array}]}`; foundation stubs return one group per
  face and class `unresolved`.
- `compare.mjs`: `compareModels(before, after, {logical}) -> {deltas,
  sourceLines}`; frozen after wave 1.

### 10.3 Extension points

| Slot | Used by |
|---|---|
| `slots.header.status`, `slots.header.action` | live pill; copy/save; column collapse |
| `slots.modelBar.item` | revision chip, compare button, delta strip |
| `slots.library.tab`, `slots.library.row` | parts, models, checks; live state badges |
| `slots.parts.rowBadge`, `slots.parts.rowAction` | FDM badge, print export |
| `slots.viewportHud.item` (top-left, top-right, bottom-left, bottom-right) | triad, busy bar, trust chip |
| `slots.viewportBanner.item` | failure banner, capability notices, feature load errors |
| `slots.statusBar.item` | display legend, plate relation, overhang legend |
| `slots.viewActions.button` | edges, fit, views, projection, plate, section, x-ray |
| `slots.toolbar.tool` | select, orbit, comment, arrow, box, pen, thickness |
| `slots.inspector.section` (`order`, `when(selection)`) | exact geometry, measurement, identity, … |
| `slots.settings.item` | plate size, edge width, overhang threshold, editor, trackpad, theme |
| `commands.register` | every button and shortcut |
| `overlay.layer` (SVG) / `renderer.addLayer` (GL) | annotations, dimension lines / grid, plate, section, ghost |
| `drawer.open({title, load(signal), render})` | reports, source, build failure |
| `router.add` via `src/viewer/routes/*.mjs` | every server feature |

### 10.4 Live process model (live-server)

- **Build workers**: `child_process.fork` of `src/viewer/live/build-worker.mjs`
  (`serialization: 'advanced'`, detached process group). The worker loads the
  kernel once and per job builds from the provided bytes, serializes exactly
  like the CLI (`JSON.stringify(model, null, 2) + '\n'`), runs `reviewScene`
  and `buildDrawPayload`, and classifies failures into the plain failure
  payload. At most one busy worker per source and two overall, plus one warm
  spare (changed 2026-09-23: with one busy worker for all sources an edit to
  one file waited for an unrelated slow build). A Python job that outlives
  its timeout by 2 s is failed as `timeout` and its worker group killed. No workers for `.brep.json`-only sessions.
- **Cancellation**: a superseded job gets at most 250 ms, then SIGKILL of its
  group; the new job starts on the spare at once. Without a warm spare, a cold
  worker is forked immediately and the pill says "warming worker". Results are
  registered only if their job id is still the latest for that source;
  messages from killed workers are dropped.
- **Lifecycle**: the parent kills every worker group on `close()`, SIGINT,
  SIGTERM, `uncaughtException` and `exit`; workers exit on `disconnect`.
  Start failures back off (1, 2, 4 … 30 s); after 3 failures within 60 s a
  `worker-failed` event with the stderr tail is shown until the next save or
  manual rebuild. Workers are recycled after 200 builds, above 1.5 GB RSS, or
  when the kernel fingerprint changes; revisions record the fingerprint.
  Accepted deviation (integration, 2026-09-23): the fingerprint covers the
  worker's import closure only (`importClosure` in `src/viewer/live/pool.mjs`),
  not every file under `src/` and `kernel/`, because other workflows edit
  `kernel/proto`, `src/lang` and similar paths that builds never load.
- **Query worker**: a separate, lazily started process with a model cache
  (LRU 4), latest-wins per `supersedeKey`, timeouts (section and thickness
  10 s, printability and diff bounds 30 s, draw 60 s). Everything that can
  break the 50 ms event-loop rule goes there: draw payloads for archived and
  `.brep.json` models, printability bounds (`boundEdgePlaneBand`, 144–689 ms),
  diff edge-band bounds, section, thickness, first-time kernel module loads.
  `geometry` and `measure` (closed forms, < 5 ms) run inline once the kernel
  loaded at startup. Integration (2026-09-23): a timeout covers the query,
  not the worker start (the worker loads the Bend kernel before `ready`) nor
  a kind's first-time module load (`preparing`/`started` messages, capped at
  120 s); on a machine at load 40–50 the solid classifier alone took 10 s
  to load, so every first thickness probe timed out and killed the worker.
- **Ring**: bounded by bytes (default 512 MB for scenes and draw payloads).
  Non-pinned revisions keep only the model; scenes and payloads are rebuilt on
  demand. Pins come from `/api/live/pins` (displayed, compare, ghost,
  annotated). A revision leaving the ring is spooled to
  `tmp/viewer/spool/<session>/<modelId>.brep.json`, from which archive and
  review save still work for the session.
- **Watch set**: `.fs`: the source, a sibling `modules.json` and the module
  files it lists. `.py`: the source plus the project files the last build
  loaded (`source.modules`, D5). Sources are frozen from the
  hashed bytes wherever they live (D22).
- **Port and tab**: port = 4400 + (SHA-256 of the real path mod 100), next
  free in 4400–4499 on collision; `WONKY_VIEW_PORT_RANGE` overrides the range
  (QA uses 4320–4399). A session marker under `tmp/viewer/sessions/<port>.json`
  records the last shutdown; if it is younger than 10 minutes, the server
  waits up to 2.5 s for an SSE reconnect before opening a tab.
  `WONKY_VIEW_OPENER` replaces the opener command (tests).

## 11. Foundation step

Pure restructuring plus extension points and frozen contracts. No
user-visible behavior change: the camera stays numerically identical
(including today's mirroring), compare stays the default, all keys stay. The
one intended exception is the Host allowlist (SRV-13 defect, no effect on
legitimate use). One agent, four gated stages. Before F1, baseline screenshots
of every fixture and breakpoint are taken into `out/viewer/foundation/baseline/`.

- **F1 server split** (gate: RV 7/7, DE/DC/GS green, new
  `test/viewer-server.test.mjs`, curl smoke of API-01..15 recorded in
  `out/viewer/foundation/api-smoke.txt`): facade, router, `http.mjs` with
  `HttpError`, static serving of `viewer/**`, settings route, archive route
  stub, query-pool with in-process stub, every route and server module as a
  stub with its frozen signature, dynamic route loading, bind-first lifecycle,
  lazy display preparation of archived snapshots, compact JSON scenes.
  live-server may start once F1 passes.
- **F2 client entry** (gate: VS 32/32): `createViewer(env, {seams,
  features})`, `viewer/main.js`; `test/viewer-state.test.mjs` changes only its
  harness (top-level await preloads the legacy feature set, passes the fake
  environment from `scripts/viewer/test-support/fake-env.mjs`, replaces
  string-injected overrides with seams). The 32 test bodies stay
  byte-identical.
- **F3 core and render extraction** (gate: VS, pixel comparison against the
  baseline, at most 0.1 % differing pixels): core modules, `format.js`
  complete with tests, `editor-links.js`, scoped `keyboard.js` with Escape
  stack and conflict test, `render/camera.js` with the full frozen API
  (today's numbers), view-projection matrix uniform shared by shader and
  `project()`, renderer interface (`setStyle`, `setHighlights` with arrays,
  `addLayer`, `project`, `pick`), multi-selection highlighting that really
  draws every selected entity.
- **F4 features and CSS** (gate: full inventory walk): feature modules with
  `{dispose, api, legacy, defaults}`, feature markup moved from `index.html`
  into features with every DOM id kept, all planned features and routes
  pre-registered as stubs, CSS split into `styles/*.css` and per-feature files
  (each carrying its own media-query blocks, cascade order preserved, linked
  statically), `viewer/style.css` removed, tooling (`check-format.mjs`,
  `qa/fixtures.mjs` building every `.fs` in `scripts/viewer/qa/fixtures/` plus
  the audit samples, `qa/serve.mjs`, `qa/browser.mjs`), `scripts/viewer/uv-python`,
  `docs/viewer/contracts.md` (DOM ids, facade fields, harness owners, frozen
  APIs), `bin/wonky-view.mjs` reformatted with the same behavior.

## 12. Work packages

Rules: waves run in order; packages within a wave run in parallel with
disjoint owned files, each in an isolated working copy (worktree or copy
provided by the maintainer; without one, the wave's packages run one after
another). Every package: focused tests only (`nice node --test
test/<file>`), browser QA on its own port (15.1), screenshots in
`out/viewer/<key>/`, a short English doc in `docs/viewer/<key>.md`, no edits
outside its owned files, no new request in the legacy load path. A package
whose acceptance needs another same-wave package (for example the logical
full-wall highlight) proves it against the frozen stub and is re-checked at
the wave integration gate.

- **Wave 1** (after F4; live-server after F1): live-server, camera-navigation,
  render-transport, topology-classes, exact-measure, model-first-compare.
- **Wave 2**: render-look, live-client, source-links, reviews-context.
- **Wave 3**: parts-tree, fdm, section, diff-overlay, thickness-probe,
  help-a11y.

Nobody edits `test/viewer-state.test.mjs` after F2. If a package finds a VS
assertion that contradicts its spec, it stops and reports to the maintainer.

### Wave 1

**live-server (P0).** `wonky-view` for `.fs`/`.py`/`.brep.json`: derived
port and tab reuse, watch set, warm build worker plus spare, kill-based
cancellation, lifecycle hardening, query worker, SSE, failure payload,
terminal and NDJSON output, `--out`/`--format print`, previous-session seed,
revision ring with pins and spool, archive route, source freezing outside the
repo, kernel fingerprint recycling.
Acceptance:
1. With 4310 and 4311 busy and `WONKY_VIEW_PORT_RANGE=4320-4399`,
   `wonky-view tmp/viewer/live/live-server/bracket.fs --no-open` starts and
   prints its URL; a restart picks the same port; `--port 4310` exits 1 with
   "port 4310 is in use".
2. Terminal: `r1 ok … · 1 body · N faces (M logical) · X×Y×Z mm recorded`; a
   syntax error prints `r2 FAILED input bracket.fs:L:C …`, the call chain and
   "showing last good r1"; `--json` prints only NDJSON whose event names equal
   the SSE names.
3. `curl -N /api/events` shows `hello`; a save produces `build-queued`,
   `build-started`, `revision` within 1 s for the bracket; `/api/workspace`
   lists the revision under `sources`; the foundation UI shows it after
   Refresh.
4. Two saves 100 ms apart on pocket-plate (2.8–4 s build): the first job emits
   `build-cancelled` within 350 ms of the second save, no process of its group
   remains, only the second revision is registered.
5. The live model id equals the CLI output id for the same source and
   `--param`; `--out` bytes equal the CLI's; `--format print` also writes
   `.stl` and `.print.json`; a failed build leaves the `--out` files
   untouched; a restart shows r0 "previous session".
6. A manifest-bound `.fs` edit fails with kind `provenance` and the manifest
   path; a single-file `.py` builds via `scripts/viewer/uv-python` (`ps` shows
   `uv run`, never `python3`); a local Python import fails with kind `input`
   at its line.
7. After `close()` or Ctrl-C no child processes or watchers remain; after
   `kill -9` of the parent during a 4 s build, the workers exit within 5 s.
8. With an injected start crash, three failed starts produce `worker-failed`
   with the stderr tail, backoff lines in the terminal, and an idle CPU.
9. `GET /api/source/<sha>` returns the exact bytes of a source under
   `$TMPDIR` (outside the repo).
10. With the tab open, restarting the server calls the opener 0 times
    (`WONKY_VIEW_OPENER` log); a fresh start calls it once.
11. Unit tests: ring eviction by bytes keeps pinned revisions; an evicted
    revision still archives from the spool; event-loop lag stays < 50 ms
    during a 4 s build; a `.brep.json`-only session forks no worker.

**camera-navigation (P0).** Right-handed world camera (screen-X flip, eye
direction kept), frozen API with bounds, height, basis, lookFrom,
depthPerPixel, legacy conversion; presets and keys; fit policy; zoom to
cursor; pitch clamp; physical zoom limits; ortho/perspective; axis triad and
origin marker; Views menu; review camera validation for both conventions;
legacy drawing restoration (D6).
Acceptance:
1. Top view (`8`) of the bracket shows the L upright (+X right, +Y up) like
   `out/visual-comparison/1-after.png`; Front (`1`) shows the −Y side; the
   triad agrees in all 7 views.
2. Number row, numpad with NumLock on and off, and Shift+1…7 select views;
   `0`/Home default view; `F` fits keeping orientation; `#view-presets` opens
   the Views menu; both buttons clear hover.
3. The point under the cursor stays within 1 px while wheel-zooming; pitch
   stops at ±90°; on r10b a 0.2 mm gap can be zoomed to ≥ 100 px.
4. `O` toggles perspective and the legend says which.
5. Switching between revisions of one source keeps the camera exactly; a
   model from another source fits.
6. A legacy review (no `cameraConvention`) loads; its single-mode comment
   drawings sit over the same geometry as in the pre-fix screenshot; wipe
   drawings over two models are hidden with the note; a newly saved review has
   `cameraConvention: 2`; RV legacy posts are still accepted; invalid legacy
   cameras are still rejected.
7. Arrows orbit 15°, Ctrl 5°, Shift 90°. Camera per source survives a
   restart.
8. Unit tests of 7.1 pass; VS 32/32.

**render-transport (P0).** WebGL2 context with stencil, binary draw payload
(exact per-vertex normals, winding, vertex points, logical faces, edge
classes from the frozen stubs), draw route and query-worker handler, typed
picker with JSON adapter, LRU cache with pins and context restore, lazy
compact JSON scene, shader highlight with logical expansion and
multi-selection, WebGL2 capability message.
Acceptance:
1. r10b-retained: `/draw` ≤ 0.3 MB; the network panel shows no JSON scene
   until a face is inspected; heap after open ≤ 15 MB above an empty page.
2. Hover pick median ≤ 2 ms at 333k triangles (5 runs, load recorded); the
   highlight is drawn in the frame of the pick.
3. VS picking tests pass; the JSON adapter and the draw payload agree on 96
   sample points.
4. Bored-spacer bores render smooth (no facet bands); an edge behind a 1 mm
   wall is not hoverable.
5. With the topology stub each fragment highlights alone; after integration
   one click on the pocket-plate floor highlights the whole floor.
6. `WEBGL_lose_context` then restore gives an identical image; opening 12
   revisions keeps ≤ 8 unpinned in the cache and deletes their buffers.
7. With WebGL2 disabled the viewport shows the capability message and the
   inspector works.
8. A model offset by 1e5 mm shows no gap between face and selection line.

**topology-classes (P0).** Exact edge classes (sharp, tangent, seam,
subdivision, unresolved) and logical face groups (fragments joined across
subdivision edges: both adjacent faces on the identical oriented support
within tolerance, confirmed by `construction.edgeOrigins` where present;
disagreement gives `unresolved` and no merge); topology route.
Acceptance:
1. `GET /api/models/<pocket-plate>/topology` in the browser: 46 raw faces →
   11 logical faces, 48 subdivision edges.
2. Arc slot: 4 tangent, 4 sharp, 4 rim edges sharp; bored spacer seam edge
   `seam`; two separate coplanar pad tops are not merged.
3. frame-with-tab inner wall fragments form one logical face.
4. Computation for r10b-retained < 200 ms; runs in the build worker and in
   the query worker.

**exact-measure (P0).** Geometry and measure APIs, exact inspector section,
hover status line, multi-select with drag threshold, measurement section with
radial gap and clearance, dimension line layer, Copy measurement with
archive, labelled model size, pin-in-bore fixture.
Acceptance:
1. Hovering the bored-spacer bore shows "Cylinder hole Ø4.0000 mm · exact
   ±…"; clicking shows axis direction and the axis point nearest the origin.
2. Shift-clicking the two bracket walls shows "Parallel offset 8.0000 mm
   exact"; a Shift-click with 2 px jitter adds the entity and does not pan; a
   4 px Shift-drag pans.
3. pin-in-bore: radial gap 0.2000 mm and diametral clearance 0.4000 mm,
   labelled "supporting cylinders".
4. A pair without a closed form shows the unsupported row; entities from two
   revisions show "unsupported: entities from different revisions".
5. The dimension line appears in the viewport with value, chip and "anchor:
   display pick".
6. Copy measurement: the copied `wonky-inspect` command exits 0 after the
   server stops.
7. The model overview size carries recorded/kernel/display.
8. With the stub, measurement accepts a fragment; after integration a click
   on the frame-with-tab wall selects the logical wall and measures it.
9. VS 32/32; no request from selection in the legacy seam.

**model-first-compare (P0).** Model-first default applied in
`startupWorkspace`, persisted compare mode, revisions grouped per source,
Compare with previous (`W`), compare API with logical counts and changed
source lines, delta strip, LIB-03 cross-source behavior.
Acceptance:
1. The ten-model audit workspace opens on one model without BEFORE chrome;
   compare off survives reload and restart.
2. Library groups revisions per source, newest first, with rN and time.
3. `W` opens wipe against the previous same-source revision; a `.brep.json`
   without siblings opens the before selector.
4. After a bracket edit the delta strip reads bodies, faces raw (logical),
   edges, volume Δ or "not evaluated", bounds Δ labelled, "source: lines …
   changed".
5. A cross-source click in compare mode leaves compare and fits; a
   same-source click keeps before.
6. Wipe and side-by-side still work; VS 32/32 (store default `compare: true`
   unchanged).

### Wave 2

**render-look (P0).** Lighting, fat classified edges, style table (single
writer `display.js`), two-pass transparency, x-ray (`T`), body rank offset,
clip-plane uniforms and stencil/culling/colorMask options, overhang flag
texture and uniforms, layer helpers, legend, `Shift+E`.
Acceptance:
1. On DPR 2 screenshots edges are 1.5 CSS px and ≥ 4.5:1 against every face
   shade; seams and subdivision edges hidden; `Shift+E` shows them dimmed.
2. Principal iso faces ≥ 1.3:1 luminance.
3. r10b-retained shows its appearance colors; bodies without appearance use
   the labelled viewer palette.
4. Coplanar edges in r10b-first-failure-inputs are continuous.
5. `T` makes all bodies 50 % transparent with faint hidden edges.
6. Frame median ≤ 4 ms at 333k triangles.
7. A debug layer draws a fat line with depth bias; a debug style sets a clip
   plane and a per-face overhang flag.

**live-client (P0).** SSE client, pill and trust chip (7.4), busy bar and
Cancel, failure banner with call site, failure drawer, follow live and pause
rule, pins, selection carry, derived-data invalidation on swap.
Acceptance:
1. A bracket save shows the new revision < 1 s after save (median of 5) with
   the camera unchanged; pill "Current r2".
2. A build > 250 ms shows phase, elapsed and Cancel; Cancel leaves the last
   good model and "r3 cancelled".
3. A failing Boolean shows the amber banner with file:line:col and "called
   from part.fs:57"; Details shows excerpt and chain; Open in editor is a
   `zed://file/…:L:C` link.
4. Every trust-state row is covered by a unit test; five states have
   screenshots; at 1100, 900 and 650 px the trust chip stays visible.
5. `L` toggles follow; with follow off a chip "r4 available" appears; with a
   review with annotations open, follow pauses and says so.
6. An arc-slot face selection carries to the next revision; a bracket face
   is cleared with the toast; measurement shows "pending" right after a swap.
7. Reload keeps state; a server restart reconnects without a new tab; the
   client posts pins.
8. VS 32/32.

**source-links (P1).** Face- and edge-level sketch source preferred over the
body operation, call chain headline for helper bodies, open in editor, history
API, source-to-geometry highlight from the drawer.
Acceptance:
1. The arc-slot right face shows skArc line 10 first and opExtrude line 14 as
   context.
2. An r10b helper body reads "copyBody (line 20) called from r10b.fs:1382".
3. Open in editor links use the editor setting and work for sources outside
   the repo; Open frozen source works for them too.
4. Clicking a source line in the drawer highlights the geometry it produced,
   or says it produced none.
5. VS source-drawer race test passes.

**reviews-context (P0).** Dirty rule (D9), one-shot tools, archive on copy,
scoped LLM context, Copy references, selection API with browser posting,
print export routes and command, per-review error isolation, archive of live
revisions on save, inspector identity and context sections.
Acceptance:
1. With an empty review, toggling compare, layout or camera never shows
   "Unsaved changes"; drawing a rectangle then ⌘Z returns to "Saved"; VS
   save-race tests unchanged.
2. Tools are one-shot; double-click locks; Escape unlocks.
3. After Copy reference, Copy selected geometry, Copy model overview and Copy
   LLM context, stopping the server leaves every copied `wonky-inspect`
   command resolvable (exit 0).
4. LLM context contains the visible model and the selection's exact data, no
   hidden compare model.
5. `GET /api/selection` returns the clicked faces within 500 ms.
6. Export for print downloads STL and manifest for a revision and for one
   body; the manifest states the deviation.
7. A corrupt review file shows as an error row; saving a review on a live
   revision archives it.

### Wave 3

**parts-tree (P0).** Parts tab (default rule), rows with eye, swatch, name,
alias, raw/logical counts, FDM badge slot, row expansion (opacity, color,
print export action), Y / Shift+Y / I, parts API, revisions under the tree,
column collapse, multi-body fixture.
Acceptance:
1. Multi-body fixture and live sources open on the Parts tab; rows show
   "12 faces (9 logical)".
2. Hide a body, restart `wonky-view`: still hidden; Shift+Y shows all; I
   isolates; hidden bodies are not pickable.
3. r10b-retained swatches match appearance; others say "viewer color".
4. `[` and `]` collapse the columns, persisted; the viewport is uncovered.
5. The current source's revisions are listed under the tree.

**fdm (P0).** Plate, grid and origin axes, printability API (per body, exact
planar flags, cylinder and cone bands, bed faces, small-bore exemption),
per-body printed and up settings, Print on selected face, plate relation in
status bar or row badges, overhang tint and legend with β, cross-bore-16
fixture.
Acceptance:
1. `G` shows the 256 × 256 plate as grid lines, on by default for live
   sources; the bottom view shows the model through it.
2. One visible body: status bar "on plate" / "floats … mm" / "cuts … mm"
   with its label; several bodies: badges per row instead.
3. `Shift+G`: a 45° chamfer is not tinted at α_max 45°; a 50° face is; the
   legend reads "overhang α > 45° from vertical (slicer threshold β = 45°)";
   at α_max 60° it reads β = 30°.
4. cross-bore (Ø8) is outlined "exempt: small bore"; cross-bore-16 (Ø16)
   shows a band 45°–135°; the legend says "bridge exemption (≤ 10 mm) not
   applied".
5. No tint before the API answers; a swap shows pending.
6. Setting a body to not printed removes its tint and relation; Shift+B on a
   planar face sets up = −n; both survive a restart; geometry never moves.

**section (P1).** One display clip plane by default (three available),
slider, normal from view, stencil caps labelled "display section ±0.02 mm",
"cap unavailable" for boundary-only bodies, picker respects clipping, "Exact
contour" button through the query worker with verbatim failures.
Acceptance:
1. `X` shows one plane; dragging the slider moves it; "normal from view"
   aligns it.
2. Caps are filled in body color with the label; a boundary-only body says
   "cap unavailable".
3. The clipped side cannot be picked.
4. "Exact contour" draws contours for the bored spacer; bracket x = 18 shows
   the FaceContact message; a cone shows FaceRejected; the UI stays responsive
   and a superseded request is cancelled.

**diff-overlay (P1).** Ghost of the previous revision (`Shift+W`, blend
slider), exact edge-band bounds deltas in the compare API for null recorded
bounds, via the query worker.
Acceptance:
1. `Shift+W` shows "r3 ghost" translucent over r4 with a blend slider.
2. The cross-bore delta shows bounds labelled kernel although recorded
   bounds are null.
3. The ghost clears and shows pending on a swap.

**thickness-probe (P1).** Thickness tool (`K`) via ray and membership in the
query worker, overlay line with the kernel label, refusal cases.
Acceptance:
1. Clicking a bracket wall shows 8.0000 mm kernel; the bored-spacer wall
   3.0000 mm.
2. A ray lying in a face plane shows "unresolved" with the blocking entities.

**help-a11y (P1).** Help overlay from the command registry, single-key
shortcut setting, focus-preserving patches, contrast and size tokens, dark
theme, inspector host, German `docs/viewer-ui.md`.
Acceptance:
1. `?` lists every registered binding.
2. With single-key shortcuts off, letters do nothing and ⌘S still saves.
3. Clicking a model keeps focus; the drawer traps and returns focus.
4. A contrast script reports every text ≥ 4.5:1 and ≥ 11 px in light and dark.
5. `docs/viewer-ui.md` describes the new viewer in German.

## 13. Retired or changed behavior

| Inventory row | New behavior | Reason |
|---|---|---|
| Mirrored projection (defect) | Right-handed camera, screen X flipped, eye direction kept | Correctness |
| NAV-09 bounds-relative camera | World-space camera kept across same-source revisions | Live loop |
| NAV-01 orbit | Pitch clamped to ±90° | No pole flip |
| NAV-03 zoom | Zoom to cursor; physical limits 1 µm–10 m per px | Fine features on large scenes |
| NAV-05 `F` resets | `F` fits keeping orientation; `0`/Home reset | Onshape |
| NAV-06 preset cycle | Views menu, 7 presets, keys | Bottom view for FDM |
| NAV-04 arrows 0.12 rad | 15°, Ctrl 5°, Shift 90° | Onshape |
| NAV-07 camera marks dirty | Camera never marks dirty (D9) | Noise |
| CMP-03 compare on by default | Off by default, persisted per source; store initial value unchanged | Unrelated before model |
| CMP-02 default pair | Before = previous same-source revision | Meaningful compare |
| CMP-07 split marks dirty | Only when the review has content and differs from saved (D9) | Noise |
| LIB-03 model click in compare | Cross-source click leaves compare and fits | Wrong half-view |
| CLI-02 default port 4310 | Derived stable port; `--port` strict | 4310/4311 are Marc's viewers |
| CLI-05 argument errors, "Pass at least one .brep.json model" | Accepts `.fs`/`.py`/`.brep.json`; message "Pass at least one model or source" | Live sources |
| CLI-08 `npm run demo:review` | Unchanged; the browser opens only for live sources | No surprise tabs |
| RSP-02 header status hidden ≤ 1150 px | Trust chip in the viewport HUD at every width | Trust state always visible |
| Markup tools stay active | One-shot, lockable (D8) | OCP muscle memory |
| ANN-05/ANN-10 legacy drawings re-projected | Mirrored within their pane; wipe over two models hidden (D6) | Handedness fix |
| SRV-13 Host not checked (defect) | Host allowlist | DNS rebinding |
| SRV-07 source freezing inside the repo only | Also command-line sources outside the repo | Marc's sources live in ~/Workspace/cad |
| WebGL1 renderer | WebGL2 required, capability message | Fat edges, stencil |
| `viewer/style.css`, 3-file static whitelist | `styles/*.css` plus per-feature CSS, `viewer/**` served | ES modules |
| Face source shows the body operation (defect) | Sketch-entity source first | audit-data bug |
| Model "Size" unlabeled (defect) | Labelled recorded/kernel/display | Exactness |
| All bodies one color | Appearance colors, else labelled palette | Data exists |
| Fragment picking and counting | Logical faces; fragments stay addressable | Meaningful counts |
| CMP-08 side by side (view actions bottom right) | The tool rail keeps the bottom centre; the ten view actions move to the top right at every width (before: only ≤ 1150 px); the "in other views" chip sits above the rail (2026-09-23) | The ten-button bar covered Undo at ≤ 1536 px and four tools at 1280 px |
| Bottom status line, one row with fixed chip widths | Whole items wrap onto rows above; hover line and display tolerance never cut; view actions, triad, rail and panels follow the line height (`--hud-bottom`); the triad moved right of the rail column (2026-09-23) | "exact ±t" and "display mesh ±0.02 mm" were cut at 1600 px |
| Hole/boss pairs always r_hole − r_boss − d | Relation follows cross-section containment: clearance, wall thickness (one body), interference (two bodies only), gap, or no row (2026-09-23) | A tube wall read as −3 mm "interference" |

SRV-03 (display preparation before publish, spline edges → 400) is kept.

## 14. Deferred and requests to other owners

| Item | Reason |
|---|---|
| View cube | The triad, seven view keys, Shift+1…7 and the Views menu cover orientation; OCP has no cube. P2. |
| Five-status identity diff tint | On Boolean-heavy parts nearly every face is revision-local, so the tint would be neutral hatching almost everywhere. Ghost and bounds ship first. |
| Exact section contour on every slider release | Frequent FaceContact/FaceRejected; exact contour stays on a button. |
| Bridge exemption in overhang shading | Needs span analysis of anchored flat regions; stated as "not applied". |
| Per-operation progress, failing-operand capture, rollback history | No observer hook in `build()`; only final bodies are kept. |
| General minimum distance, interference, face area, centroid | No Bend extrema/area functions; shown as unsupported. |
| On-demand material diff | Supported only for narrow cases. |
| Parameter-level source deltas ("thickness 8 → 14") and printability line in the delta strip | Needs history diffing; changed lines ship now. |
| Screen-space outline / silhouette pass | Smooth exact normals and fat edges fix most readability. |
| GPU id-buffer picking | Typed CPU picker is fast enough. |
| Orbit about picked point, normal-to (N), context menu | Not needed for the daily loop. |
| Trackball, mouse presets, explode, PBR, zebra | Do not serve the FDM loop. |
| Per-source build flags, multi-source fairness beyond one build per source (two overall) | Single-source is the daily case. |
| Server-side "open in editor" command | `zed://` links suffice. |
| PNG export with metadata; checks per live revision | P2. |
| Instancing; coplanar-overlap hatch | No instance data; needs overlap analysis. |
| 400 → 404 for unknown scenes; side-effect-free `GET /api/workspace` | RV asserts current behavior. |

Requests to other owners:

- Kernel (`src/index.mjs`): optional `onOperation` observer in `build()`
  (progress, failing operands, per-operation snapshots).
- Modules (`src/modules.mjs`): a distinct provenance error class.
- Boolean owners: `faceOrigins` for pierce and coaxial Booleans.
- Python frontend: project-local imports and the loaded-files list are done
  (2026-09-23, watched by the live session). Still requested: kill the
  interpreter's process group on timeout, output limit and request budget
  (`src/python.mjs` `abort()` kills only the direct child; with `uv run` the
  interpreter is a grandchild, so a hang is only ended by the build pool's
  deadline and reported as a timeout); part
  names, colors and assemblies in `python/build123d.py` (cad-khana's
  `with_part(name, color=)` idiom); `wonky-python`,
  `measureGeometrySummaryTokens` and `wonky-inspect --tokens` defaulting to a
  `uv run` wrapper; `build123d.Part` support.
- Native bridge: cover the kernel calls made from `src/viewer/**`
  (`draw.mjs`, `edge-classes.mjs`, `logical-faces.mjs`, `measure.mjs`,
  `printability.mjs`, `section.mjs`, `thickness.mjs`) in the surface scan.
- `wonky-compare`: accept `.brep.json`.

## 15. QA and gates

### 15.1 Conventions

- Ports: foundation 4350; wave 1: live-server 4351 (live sessions via
  `WONKY_VIEW_PORT_RANGE=4320-4399`), camera-navigation 4352,
  render-transport 4353, topology-classes 4356, exact-measure 4354,
  model-first-compare 4355; wave 2: render-look 4357, live-client 4361,
  source-links 4365, reviews-context 4371; wave 3: parts-tree 4362, fdm 4363,
  section 4364, diff-overlay 4372, thickness-probe 4373, help-a11y 4374;
  integration gates 4380; switch-over gate 4381. A busy port → another free
  port in 4320–4399, noted in the report. Never touch 4310, 4311 or 3939.
  Stop every instance and browser session you start.
- Browser: `agent-browser --session wonky-<key> …` or
  `scripts/viewer/qa/browser.mjs`; headless Chromium needs
  `--use-angle=metal --enable-gpu`. Viewport 1536 × 900 CSS px, plus 1150,
  900 and 650 where a package touches layout.
- Fixtures: `node scripts/viewer/qa/fixtures.mjs` into `tmp/viewer/fixtures/`
  (bracket, bored spacer, conical spacer, compare-before/after, arc slot,
  cross bore, pocket plate, plus every `.fs` in `scripts/viewer/qa/fixtures/`);
  large model `out/r10b-retained.brep.json`; stress scenes from
  `scripts/viewer/make-stress-model.mjs`. Live sources are copied to
  `tmp/viewer/live/<key>/` before editing; never edit `examples/` or
  `fixtures/r10b/r10b.fs`.
- Python only through `scripts/viewer/uv-python` or `uv run`.
- Performance numbers are medians of ≥ 5 runs with the load average recorded;
  above load 12, re-run later before failing.
- CPU: tests under `nice`, one browser per package.

### 15.2 Gates

- **Package gate**: VS 32/32, RV 7/7, DC/DE/GS green, own tests,
  `check-format.mjs`, no console errors, the inventory rows its files touch
  re-checked in the browser.
- **Wave integration gate** (maintainer, after merging a wave into one
  tree): all focused viewer tests, a full inventory browser pass with a
  checklist in `out/viewer/wave-<n>/inventory-checklist.md`, the
  cross-package acceptance items proven against stubs (logical highlight,
  terminal logical counts, measurement on logical faces), and settings
  persistence across a restart.
- **Switch-over gate** (after wave 3; a partial run after wave 2 covers rows
  1–6 and 8): replay the audit-daily-use task table on copied live sources —
  the bracket, the multi-body fixture, and the failing beam-frame FS port —
  and record steps and times in `out/viewer/daily-loop/report.md`:

| Task | Target |
|---|---|
| 1 Open a part | 1 command, 0 clicks, one tab |
| 2 Hole diameter | hover |
| 3 Wall thickness | K plus 1 click (thickness probe), or 2 clicks (Shift-click pair) |
| 4 Parameter change | 0 clicks, < 1 s save to pixels (bracket) |
| 5 Compare with previous | 1 key, numeric deltas |
| 6 Face → source line | 1 click, plus open in editor |
| 7 Printability | 1 key, per body, threshold and exemptions stated |
| 8 LLM context | 1 click; every command in the copied text resolves after the server stops |

  The failing source must show the stale banner with file:line and call site
  in both terminal and browser.

## 16. Critic resolution log

Marc (daily loop): default port and tab reuse → D17, D18, 10.4, live-server
1 and 10. Terminal and NDJSON output → 3.1 step 3, live-server 2. Live
revisions reachable outside the browser → D7, `--out`/print (3.1, 3.6),
archive on copy (3.7), reviews-context 3 and 6. FDM per body → D20, 3.6, fdm.
cad-khana exemptions → 3.6, fdm 4 (the Ø8 cross bore is now exempt;
cross-bore-16 tests the band). Logical faces → D21, 7.2, topology-classes,
exact-measure 8, render-transport 5. Defaults and persistence → section 6.
Parts tree placement → section 4 (left-column tab, collapsible columns).
Shift-click vs Shift-drag → section 5 (4 px threshold), exact-measure 2.
Radial gap → 3.3, exact-measure 3. Honest scope and requests → section 1,
section 14. Switch-over gate → 15.2. Adopted nice-to-haves: view cube and
diff tint deferred, section exact contour on a button with one default plane,
viewport dimension line, selection API, source-line delta, "called from" in
the banner, `zed://` default, dirty as a diff from saved, dark theme,
multi-source groups and previous-session seed, axis point nearest the origin.
Not adopted: parameter-level delta and printability line (deferred, section
14); gating C/A/R/P to the Review tab (one-shot tools plus the new dirty rule
remove the harm without hiding keys).

Engineering: VS-compatible behavior → D9, D10, 10.1 frozen contracts
(`#view-presets`, `#fit-view`, SVG clipPaths, DOM ids), nobody edits VS after
F2. Selection reference → 10.1. Camera convention and legacy handling → D6,
7.1, `src/viewer/review-camera.mjs`. Composition root → 10.1 (setup returns,
harness owner table, live mutable facade, Map-compatible scenes). Requests out
of VS → legacy seam (10.1). Unowned files → harness owner table; markup moves
into features in F4; identity and context sections go to reviews-context;
`sources.mjs` to live-server; `format.js` and `editor-links.js` complete in
the foundation; `/api/workspace` additions through `registry.mjs`. Contracts
→ 7.1 camera API, 10.2 frozen server contracts, 9.3 `buildDrawPayload`,
`compare.mjs` frozen after wave 1, no deltas in SSE. Single style writer →
7.3; stencil and draw options → render-transport and render-look. Draw
payload and JSON scene → 9.3, 7.2. Cancellation and worker hardening → 10.4.
Query worker → 10.4. Ring bound and safe eviction → 10.4 (pins, spool).
Stale data and trust state → 3.1 step 7, 7.4, trust chip at every width.
Planar overhang exactness → 3.6, 7.3 (API flags). `review-scene.mjs` and
`display-cylinder.mjs` not edited → section 2, SRV-03 kept, native-bridge
request. Isolation → section 12 (working copies, dynamic imports), 15.2
integration gate. Staged foundation → section 11 (F1–F4, full inventory,
breakpoints, API smoke, real multi-selection highlight). Keyboard scoping →
section 5. Live sources outside the repo and changed rows → D22, section 13.
Adopted nice-to-haves: renderer split into render-transport and render-look,
live-server after F1, static CSS links, legacy drawings mirrored, fit policy,
follow pause during review, CLI parity and id equality, kernel fingerprint,
session-local revision numbers with last-good cache, no workers for static
sessions, lazy archived display and compact JSON, winding normalization,
paged geometry, consistent formatting and angular tolerance, cross-revision
unsupported row, plate as grid lines, server-side settings, perf medians,
browser opens only for live sources.

## Open defects at the first commit (23.09.2026)

The third verification round left the following open. The follow-up workflow fixes the high and medium ones.

- **high, exactness:** an off-axis hole inside a boss with no axial overlap gets its "minimum distance between the faces" from the coaxial formula. The value is wrong, it is labelled exact, and its witness point is off the surface. *Fixed in the follow-up (measure):* every parallel cylinder pair without axial overlap gets the exact trimmed-face distance √(D² + g²) with witness points on the facing rims, or a named refusal; checked against OCCT on the new fixtures and 771 corpus pairs (docs/viewer/exact-measure.md, "Faces without axial overlap").
- **high, live:** the build pool deadlocks when superseded builds hang. The fix and every other source then stay queued forever.
- **medium:**
  - Parallel and coaxial decisions are evaluated at reference points far from the faces, using the angular tolerance of the smaller body, so the result depends on selection order. *Fixed in the follow-up (measure):* relations are evaluated at the selected entities, the smaller entity against the other's support, with t over its extent; identical rows in both orders for all 6832 near-parallel corpus pairs. *Refix 1:* that still decided over the smaller entity only (a pad 1000 mm beside a plate read "Parallel yes" with the plate 21 t off; axes 500 mm apart read "Coaxial yes" 33 t off at the other face; a refused face distance vanished next to a radius difference). Decisions now hold over the bounding box of both entities, coplanar and coaxial include the drift across them, planes parallel over the smaller face only get the scoped "Offset of <face> from the plane of <other>", and refused checks are always reported; corpus: 4736 parallel plane pairs and 465 coaxial pairs checked at every vertex of both faces, 0 outside (docs/viewer/exact-measure.md).
  - The claim that the newest save never waits for a cold start is false when builds take longer than a cold start.
  - show() calls are ignored without notice when a module-level `result` exists.
  - Python errors raised in imported modules are located at the importing line.
  - The delta strip says "source unchanged" after a rebuild caused by a watched import.
  - A worker start failure shows the last stack frame instead of the error.
- **medium, exactness (refix 2):** off-axis and coaxial trim checks used the union of every circle edge of a face, not its coverage inside the axial overlap, so a face with an end notch showed a supporting-cylinder gap as exact for the faces. *Fixed:* the coverage is evaluated at common heights of the overlap (docs/viewer/exact-measure.md, "Angular coverage"); regression tests on notch-base with in-memory trims.
- **tests depending on in-flight kernel work (W2):** viewer-parts #3 compares kernel-recorded bounds exactly, and viewer-section #11 now sees FaceUnresolved at bracket x = 18. *Fixed in the follow-up (measure):* #3 keeps the exact pass-through of the recorded bounds and checks the fixture's box within the body tolerance; #11 takes the failure kind from the kernel's own `sectionSolid` verdict and still requires the verbatim, complete rendering.
- **rollout:** the viewers already running on 4310 and 4311 still serve the old server code and must be restarted after this commit.
- The low-severity layout, a11y and label items are listed in the verifier reports (workflow run wf_188bcb2b-467).
