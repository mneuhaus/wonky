# Package report: model-first-compare

Wave 1, P0, 2026-09-23. Behavior and interfaces: `docs/viewer/model-first-compare.md`.
Screenshots and step logs: `out/viewer/model-first-compare/`. QA drivers (tmp,
not committed): `tmp/viewer/model-first-compare/qa-ten.mjs`, `qa-bracket.mjs`,
`qa-lib.mjs`.

## What it does

- The viewer opens on one model (newest revision of the first command-line
  source) with no BEFORE/AFTER chrome. The model bar shows name, revision
  chip, delta strip and **Compare with previous** (`W`).
- Compare on/off is persisted per source (settings scope S), layout and split
  globally (G) unless a saved review is open. A loaded review still restores
  its own mode (D10). The store's initial `compare: true` is unchanged.
- The Models tab groups revisions per source, newest first, with `rN` and
  time; older ones fold under "N earlier"; archived snapshots get their own
  group. Selectors list the same source first, grouped, and every option names
  its model.
- `W` opens compare against the previous same-source revision; without one it
  opens compare with the before selector focused.
- `GET /api/compare` returns raw and logical counts, labelled volume and
  bounds deltas, per-body rows matched by body id, and changed source lines
  (Myers shortest edit script over the frozen source snapshots). `GET
  /api/compare/revisions` returns revision numbers, times and kinds.
- The delta strip shows those values; a click opens a drawer with every row,
  its label and the changed source lines as old/new pairs.
- LIB-03: a cross-source library click leaves compare and fits; a same-source
  click keeps the before model and the camera. Focus stays on the clicked row
  (fixes the LIB-03 focus-loss defect).

## How to use it

```
node bin/wonky.mjs part.fs --out tmp/part          # r1
node bin/wonky-view.mjs tmp/part.brep.json other.brep.json --port 4355
# edit part.fs, rebuild with the same --out, click Refresh (↻):
#   the chip "r2 is newer" appears; click it (camera kept),
#   the strip reads "Δ vs r1 · … faces … volume … bounds … source: lines … changed".
# W: wipe against r1. W again: back to one model. Click the strip: full delta drawer.
```

With live-server (`wonky-view part.fs`), revisions arrive with their live
revision number and build time and group the same way.

## Evidence

Browser: headless Chromium through `scripts/viewer/qa/browser.mjs`, 1536 × 900
plus 1150/900/650, own instance on port 4355 (stopped). Machine load average
about 20 during QA. Console: no errors from this package. One warning from
render-transport's draw fetch was logged around the server restart step
("Draw payload … unavailable: Failed to fetch").

| # | Acceptance | Status | Evidence |
|---|---|---|---|
| 1 | Ten-model audit workspace opens on one model without BEFORE/MODEL chrome; compare off survives reload and restart | pass | `01-ten-model-startup.png`, `02-reload-single.png`; W on → reload keeps compare on with the chosen before (`08-reload-compare-on.png`); W off → reload (`12-reload-compare-off.png`) and `wonky-view` restart with the same reviews directory (`13-restart-compare-off.png`) stay single. Step log `qa-ten.json` (`compare:false`, `barMode:"single"`, before/after selects hidden). Unit: "compare mode is persisted per source and restored at startup". |
| 2 | Models tab groups revisions per source, newest first, rN and time, older folded under "N earlier" | pass | `23-delta-strip-r3.png` ("r3 · 00:09", "2 earlier"), `26-library-grouped-expanded.png`, `29-restart-archived-group.png` (archived snapshots group). Unit: "library groups revisions newest first and folds older ones", "client grouping …". |
| 3 | W opens wipe against the previous same-source revision; a `.brep.json` without siblings opens the before selector | pass | `25-w-wipe-previous.png` (before = r2 `d56a64a7`, after = r3); `03-w-no-sibling-before-selector.png` (focused `#before-model`, strip "Choose a before model"). Unit: "W without a sibling revision …", "archived snapshots …". |
| 4 | After a bracket edit the delta strip shows bodies, faces raw and logical, edges, volume Δ or "not evaluated", labelled bounds Δ, "source: lines … changed" | pass | Edit 1 (arm 40 → 55, thickness 8 → 14): `22-delta-strip-r2.png` "bodies 1 · faces 8 (logical 8) · edges 18 · volume +10,404 mm³ [recorded] · bounds Δ 0 × +15 × +6 mm [recorded] · source: lines 25-26, 37 changed". Edit 2 (corner chamfer): `23-delta-strip-r3.png` "faces 8 → 9 (logical 8 → 9) · edges 18 → 21 · volume −112 mm³ · bounds Δ 0 × 0 × 0 mm · source: line 23 changed, line 24 added"; drawer `24-delta-drawer.png`, `24b-delta-drawer-source.png`. "not evaluated" for null volumes and display-labelled bounds: unit tests. Route test on two real bracket builds: bounds Δ [0, 15, 6] recorded, volume evaluated, source lines changed. |
| 5 | Cross-source click in compare leaves compare and fits; same-source click keeps before | pass | `27-same-source-click-keeps-before.png` (before r2 kept, camera yaw unchanged), `28-cross-source-leaves-compare.png` and `09-cross-source-click-leaves-compare.png` (compare off, camera reset to the fitted default). Unit: the loader is called with `resetCamera` false/true. |
| 6 | Wipe and side by side still work with linked camera and split handle | pass | `04-wipe-chosen-before.png`, `05-wipe-handle-30.png` (handle drag → split 0.30, "30 / 70"), `06-side-by-side-linked.png` ("Linked camera"), `07-side-by-side-orbit.png` (one orbit moves both panes), `17-compare-1150.png`, `18-compare-650.png`. |
| 7 | VS 32/32 with store `compare:true` unchanged; RV 7/7 | pass for this package; see note | RV 7/7. VS 32/32 with this package's files on the foundation tree (`tmp/viewer/model-first-compare/iso2`). On the shared working tree VS is 31/32 at the time of writing: test 31 (side-by-side annotation projection) fails identically when my files are replaced by their foundation versions, so the cause is the in-progress `render/camera.js` / `render/panes.js` edits of other wave-1 packages (viewer-core camera tests 10/11 fail at the same time). Re-check at the wave gate. |

Tests: `nice node --test test/viewer-model-first-compare.test.mjs` 18/18. It
covers the line diff (including a 300-case property check against LCS), the
compare module, the revision facts, the routes against two real bracket builds
and a restart, and the client behavior on the fake environment in non-legacy
mode: model-first start, persistence, W, LIB-03, grouping, the delta strip,
review restore, and no requests on the legacy path.
`node scripts/viewer/check-contracts.mjs` is ok (65 ids, 20 fields, 21
functions). `check-format.mjs` reports no violations in this package's files.
viewer-server test 12 (frozen logical-faces stub) fails because
topology-classes implemented `logicalFaces`; that failure does not come from
this package.

## Gaps

- **Revision numbers of `.brep.json` inputs are session-local.** Refresh adds
  the rebuilt file as the next `rN`; after a restart the input is `r1` again
  and its earlier revisions are "Archived snapshots" without `rN`, so "Compare
  with previous" and the strip have no previous across restarts. The spec
  keeps archived snapshots in their own group. For live sources the live-server
  `r0` "previous session" seed covers this.
- **Revision time for inputs** is the first registration of those exact bytes
  in the review directory, not the build time (the brep has no build
  timestamp). The tooltip says so ("first registered in this review
  directory"). Live revisions use `builtAt`.
- **Logical face counts** come from `logicalFaces`. Under the foundation stub
  they equal the raw counts; with topology-classes they join fragments.
- **Bounds** use the recorded `validation.boundsMm`. When any body lacks them
  the whole model falls back to the display envelope, labelled display ±0.04
  mm for the delta. There is no kernel-resolved bounds delta yet (diff-overlay
  P1).
- **Source lines** compare only the recorded top-level source file
  (`sourceMap.source`), not module files. Changes to imported modules are
  therefore invisible here. Frozen snapshots exist only for sources inside the
  repo, or where live-server freezes them; otherwise the strip says "source:
  not comparable" with the reason.
- **Delta strip** is cut at narrow widths with a fade; the drawer has
  everything. There are no parameter-level deltas (deferred, spec 14).
- **Dirty state is unchanged** (package brief): toggling compare still shows
  "Unsaved changes" without review content. D9 belongs to reviews-context.
- `W` while a select has focus types into the select (typing guard); the
  Compare button leaves compare there.
- `docs/viewer-ui.md` (German) still describes compare as the default. It is
  not in this package's files; see integration requests.
