# Model-first view, revisions and compare

Package `model-first-compare` (wave 1, P0) of `docs/viewer/spec.md`. This page
describes the behavior and the interfaces. Evidence and open gaps are in
`docs/viewer/package-model-first-compare.md`.

## What you see

- **One model by default.** The viewer opens on one model: the newest
  revision of the first source on the command line. There are no
  BEFORE/AFTER selectors, no comparison bar and no wipe divider. The model bar
  shows the model name, a revision chip (`r3 · 14:05 · latest`), the delta
  strip and a **Compare with previous** button (`W`).
- **Delta strip.** The strip under the model name compares the displayed
  revision with the previous revision of the same source, for example:

  ```
  Δ vs r2 · 00:00  bodies 1 · faces 8 → 9 (logical 8 → 9) · edges 18 → 21 ·
  volume −112 mm³ [recorded] · bounds Δ 0 × 0 × 0 mm [recorded] ·
  source: line 23 changed, line 24 added
  ```

  In compare mode it compares before with after. It never opens a wipe by
  itself. Without an earlier revision it says "No earlier revision of this
  source · no delta". A click opens the **Revision delta** drawer with every
  value, its label, the per-body table (bodies matched by body id) and the
  changed source lines with old and new text.
- **Compare with previous (`W`).** Opens compare with before = the previous
  revision of the same source, in the persisted layout (wipe by default).
  Without an earlier revision (a lone `.brep.json`, an archived snapshot) it
  opens compare with the before selector focused and a toast "No earlier
  revision of this source · choose a before model". `W` again, or the
  **Compare** button, leaves compare mode.
- **Models tab.** Revisions are grouped per source. The newest revision is a
  full row (`bracket`, `r3 · 00:00 · 1 body · 28fba270`); older ones are
  folded under "2 earlier". The displayed model and, in compare mode, the
  before model (copper mark, "Before" badge) stay visible when folded.
  Snapshots from `<reviews>/models/` (revisions of earlier sessions) are in
  their own group, "Archived snapshots", named by their recorded source
  file. Search matches the name, id, source path, `rN` and time.
- **Library clicks (LIB-03).** In compare mode, a click on a revision of the
  same source replaces the after model and keeps the before model and the
  camera. A click on a model of another source leaves compare mode and fits
  the view. Keyboard focus stays on the clicked row.
- **Selectors.** Before and after list the after model's source first
  ("bracket (this source)"), then the other sources, then archived snapshots.
  Every option names its model: `bracket · r2 · 00:00 · d56a64a7`.

## Persistence

| Setting | Scope | Key | Default |
|---|---|---|---|
| Compare on/off | S (source) | `compare` | off |
| Explicitly chosen before model | S | `compareBefore` | none (previous revision) |
| Compare layout | G | `compareLayout` | `wipe` |
| Wipe split | G | `compareSplit` | 0.5 |

Settings live in `<reviews>/viewer-settings.json` (spec D19), so they survive a
reload and a `wonky-view` restart. The source key is the input path of a
`.brep.json` or the path of a live source (`metadata.live.path`); archived
snapshots have no source and persist nothing. At startup a persisted "on"
opens compare against the chosen before model if it still exists, else the
previous revision; with neither, the view stays single for that start and the
setting is kept. Layout and split are written only while no saved review is
open: a loaded review restores its own mode, layout and split (spec D10) and
never changes the global default. Leaving compare by clicking another source
does not rewrite that source's setting.

The store's initial value stays `compare: true` (VS fixtures rely on it).
`startupWorkspace()` applies the persisted mode; the compare chrome is hidden
until at least two models are known, so there is no flash of compare chrome
during startup.

## Revision numbers and times

`GET /api/compare/revisions` gives, per registered revision, `kind`
(`input`, `live`, `archive`), `source`, `revision`, `time` and `timeBasis`:

- `live`: `revision` and `builtAt` from live-server (`metadata.live`); a
  previous-session seed is `r0`.
- `input`: `rN` is the registration order of that input path **in this
  server session** (Refresh adds the rebuilt file as the next `rN`). Time is
  the modification time of the archived snapshot (`first-registered`: when
  this review directory first saw these exact bytes).
- `archive`: no `rN`; time as above.

A restart starts inputs at `r1` again; the earlier revisions are then
archived snapshots (see gaps).

## Exactness

The comparison never computes geometry.

| Value | Source | Label |
|---|---|---|
| Bodies, faces, edges, vertices | stored B-rep arrays | counts |
| Logical faces | `logicalFaces(model)` (topology-classes) | counts; "unavailable" with the reason if it throws |
| Volume Δ | `body.validation.volumeMm3` | `recorded`; any null body gives "not evaluated", never 0 |
| Bounds Δ | union of `body.validation.boundsMm` | `recorded` |
| Bounds Δ fallback | display scene envelope when any body lacks recorded bounds | `display ±t`, t = sum of both sides' display tolerances (0.04 mm) |
| Source lines | frozen source snapshots, Myers shortest edit script | "source: lines 5, 7 changed"; "different files", "unchanged" or "not comparable" with the reason |

Bodies are matched by body id only; no geometric correspondence is inferred.

## Server API

`GET /api/compare?before=<id>&after=<id>` (400 for a missing or malformed
id, 404 for an unknown revision). Results are cached per pair (revisions are
immutable).

```json
{
  "schema": "wonky.compare/1",
  "before": { "modelId": "…", "label": "bracket" },
  "after": { "modelId": "…", "label": "bracket" },
  "identical": false,
  "scope": "Counts compare the stored B-rep of two exact revisions. …",
  "deltas": {
    "bodies": { "before": 1, "after": 1, "delta": 0 },
    "faces": { "before": 8, "after": 9, "delta": 1 },
    "logicalFaces": { "before": 8, "after": 9, "delta": 1 },
    "edges": { … }, "vertices": { … },
    "volumeMm3": { "before": 19236, "after": 19124, "delta": -112,
      "exactness": "recorded", "status": "evaluated" },
    "bounds": { "status": "evaluated", "exactness": "recorded", "toleranceMm": 0,
      "before": { "min": […], "max": […], "size": […], "exactness": "recorded" },
      "after": { … }, "delta": { "min": […], "max": […], "size": [0, 0, 0] } },
    "bodyMatches": [{ "bodyId": "model/extrusion", "status": "matched",
      "alias": { "before": "B1", "after": "B1" }, "faces": { … }, … }]
  },
  "sourceLines": {
    "status": "changed", "before": { "file": "…/bracket.fs", "sha256": "…" },
    "after": { … }, "changed": [23], "changedFrom": [23], "added": [24],
    "removed": [], "beforeLines": 38, "afterLines": 39, "coarse": false
  }
}
```

Module signatures (frozen after wave 1):

- `compareModels(before, after, { logical }) -> { deltas, sourceLines }` in
  `src/viewer/compare.mjs`. `before`/`after` are descriptors
  `{ model, displayBounds?, source? }` or bare `wonky-brep/1` models.
- `changedSourceLines(beforeText, afterText) -> { changed, added, removed }`
  in `src/viewer/source-diff.mjs`, plus the added fields `changedFrom`,
  `beforeLines`, `afterLines`, `coarse`. Above 2000 edits the region between
  the common prefix and suffix is reported as one hunk (`coarse: true`).

## Client API (ctx.app)

From `features/library`: `revisionGroups()`, `revisionOf(id)`,
`sourceKey(id)` (settings key, null for archived snapshots),
`previousRevision(id)`, `sameSource(a, b)`, `revisionText(id)`,
`revisionName(id)`, `entryTitle(id)`, `revisionTimeTitle(id)`,
`openModel(id)` (the library click, LIB-03), `setRevisionFacts(response)`.
From `features/compare`: `comparePrevious()` (`W`), `toggleCompare()`,
`leaveCompare()`, `syncControls()`, `renderModelOptions()`, plus the existing
`setLayout`, `setSplit`, `loadScene`, `loadSelectedModels`, `activeScenes`.

`library.row` slot items (`{ id, order, render({ model, entry, group }) }`)
add badge markup to model rows (for live-client state badges).

On the legacy seam (VS) no revision, compare or settings request is made; the
grouping falls back to the workspace list (no times) and the delta strip is
hidden.
