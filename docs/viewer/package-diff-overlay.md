# Package report: diff-overlay

Wave 3, P1, 2026-09-23. Behavior and interfaces: `docs/viewer/diff-overlay.md`.
Screenshots, API answers and step logs: `out/viewer/diff-overlay/`. QA drivers:
`out/viewer/diff-overlay/qa/qa.mjs` (main run and `--integration`),
`qa-entry.mjs`, `compare-route-integrated.mjs`, `r10b-api.mjs`.

## What it does

- `Shift+W` (or the ghost button in the view actions) draws the previous
  revision of the displayed model's source translucent over it: faces in one
  blue tint, depth-tested and pushed behind the displayed model's surfaces,
  plus the ghost's feature edges that do not coincide with an edge of the
  displayed model. In compare mode the ghost is the before model, drawn in the
  after pane.
- A panel names the ghost (`r3 ghost`), has a blend slider (ghost opacity,
  global setting `ghostBlend`) and shows the bounds and volume deltas of the
  pair with their exactness chips; a click opens the Ghost delta drawer.
- The ghost is keyed by model id: a live swap (or any change of the displayed
  pair) removes it from the view in the same tick and the panel reads
  "pending" until the new pair has its draw data and its delta.
- `GET /api/diff?after=[&before=]` pairs the ghost (previous revision of the
  same source, or explicit) and returns the `compareModels` deltas with
  **kernel-resolved bounds** for every body whose recorded bounds are null:
  the union of the Bend edge-band extrema (`boundEdgePlaneBand`) along X, Y
  and Z, computed in the query worker (`diffBounds`, the frozen handler) and
  cached per model id. It is exact for faces bounded by planes, cylinders and
  cones; other surfaces answer `unsupported`, unresolved bands and a cone
  apex that may lie outside the box answer `unresolved`, each with the reason
  and a display-envelope fallback labelled as such.
- `compareModels` (signature unchanged) accepts `kernelBounds` in a revision
  descriptor and labels such bounds `kernel-resolved`; without it the output
  is unchanged.

## How to use it

```
node bin/wonky-view.mjs part.fs          # live source
# save a few edits, then in the browser:
#   Shift+W        ghost of the previous revision ("r3 ghost" over r4)
#   Blend slider   ghost opacity 5-100 %
#   click the Δ    Ghost delta drawer (bounds per body, source, method)
#   save again     the ghost clears, reads "pending", then shows r4 over r5
#   W              compare mode: the ghost is the before model
curl 'http://127.0.0.1:<port>/api/diff?after=<id>'   # pairing + deltas as JSON
```

## Evidence

Browser: headless Chromium through `scripts/viewer/qa/browser.mjs`, 1536 × 900
plus 1150, 900 and 650, own instance on port 4372 (started and stopped by the
QA driver; no instance left running). Load average 13 to 21 during QA. The
live source is a fresh copy of `scripts/viewer/audit-data/cross-bore.fs`
under `tmp/viewer/live/diff-overlay/run-*/`, built by the unmodified
`bin/wonky-view.mjs` as r1 (bore r 4), r2 (r 5), r3 (r 3), r4 (bore r 6,
block 24 mm high) and r5 (r 4.5, 24 mm). The terminal prints
"≈ 30×20×24 mm display ±0.02 mm" for these revisions: their recorded bounds
are null. Main run `qa.json`: 12/12 checks, no console warnings or errors.

| # | Acceptance | Status | Evidence |
|---|---|---|---|
| 1 | `Shift+W` shows "r3 ghost" translucent over r4 with a working blend slider | pass | `02-shift-w-r3-ghost-blend-35.png`: panel "r3 ghost · Blend 35 % · bounds Δ 0 × 0 × +4 mm [kernel] · volume Δ −144.7 mm³ [recorded]"; the r3 bore (r 3) shows as a translucent tube inside the r4 bore (r 6), the old 20 mm top outline as blue lines on the 24 mm block (`05-ghost-right-view.png` looks through the bore). Layer: 256 ghost triangles, 64 ghost edge segments, 4 coincident segments skipped. Slider: `03-blend-80.png`, `04-blend-10.png`; 22,185 pixels differ between 35 % and 80 % (`03b-blend-35-vs-80-diff.png`), `display.ghost.opacity` 0.1 after the 10 % step, `ghostBlend: 0.1` stored in `/api/settings`. `01-r4-no-ghost.png` is the same view without the ghost. Unit: "Shift+W shows "r2 ghost" …" (fake browser, all legacy features plus display and diff). |
| 2 | The cross-bore delta shows bounds labelled kernel although its recorded bounds are null | pass | Panel chip `kernel` on "bounds Δ 0 × 0 × +4 mm"; `api-diff-r3-r4.json`: `deltas.bounds.exactness: "kernel-resolved"`, before [0, −10, 0]..[30, 10, 20], after [0, −10, 0]..[30, 10, 24], both bodies `source: "kernel"`, `toleranceMm` 0.0003 each (0.0006 for the Δ), method stated. Drawer `06-ghost-delta-drawer.png`: bounds size/min/max rows labelled kernel, per-body source "kernel", status "resolved". Delta strip: see integration request 1; with that change applied through `qa-entry.mjs --integration` (`qa-integration.json`, 3/3) the strip reads "bounds Δ 0 × 0 × 0 mm [kernel]" (`20-integration-delta-strip-kernel.png`, `api-compare-integrated-r1-r2.json`). Unit: "Bend edge bands give the cross bore its exact box …" ([0, −10, 0]..[30, 10, 20] from the real kernel; the bored spacer reproduces its recorded bounds; the conical spacer's frustum excludes its apex), "GET /api/diff: pairing, kernel-labelled bounds …". |
| 3 | The ghost clears on a live swap and shows pending until recomputed | pass | Save r5 while "r3 ghost" is shown over r4 (QA delays `/api/diff` by 1.5 s so the state is observable). `swap-timeline.json` (every store change and frame): 109 ms after the recorder started, the displayed model is r5 and in the same tick the pair is r5, the style's ghost is null, nothing is drawn, chip "pending", "bounds Δ pending"; 1 ms later the r4 ghost is drawn (its draw data was cached) with the chip still "pending"; 1.5 s later the delta arrives: "r4 ghost · bounds Δ 0 × 0 × 0 mm [kernel] · volume Δ +1,484.4 mm³". No row after the swap has the r3 ghost in the style, drawn, or the r4 pair. Screenshots `07-live-swap-r5-pending.png`, `08-live-swap-r4-ghost-recomputed.png`. Unit: "the ghost is keyed by model id …", "stale draw data for a replaced pair never marks the new pair ready". |
| 4 | `compareModels` signature unchanged; VS 32/32 and RV 7/7 green | pass | `compareModels(before, after, { logical })` unchanged; `test/viewer-model-first-compare.test.mjs` 18/18 unchanged; `test/viewer-state.test.mjs` 32/32; `test/review.test.mjs` 7/7. |

Further checks in `qa.json`: at 1150, 900 and 650 px the panel does not cover
the view actions (`09-width-*.png`; below 900 px it moves lower left in two
rows, clear of the floating inspector and the status line); compare mode (`W`)
keeps the ghost paired with the before model (`10-compare-wipe-ghost-in-after-pane.png`);
`Shift+W` again hides it and clears `display.ghost`.

Large model (`r10b-api.mjs`, `api-diff-r10b.json`): the five r10b retained
bodies (null recorded bounds, 144 + 99 + 99 + 36 + 24 edges) resolve to
[−124.6, −122, 50.017]..[124.6, 65.368, 313.786] mm, labelled kernel, first
request 2.2 s including query-worker start and kernel load, cached 3 ms. 79
`/api/workspace` probes during the computation: median 6 ms, max 15 ms (the
server's event loop stayed free). In-process warm: 0.29 s for all five bodies.

Tests (focused, under `nice`):

| Suite | Result |
|---|---|
| `test/viewer-diff-overlay.test.mjs` (new) | 17/17 |
| `test/viewer-state.test.mjs` (VS) | 32/32 |
| `test/review.test.mjs` (RV) | 7/7 |
| `test/viewer-model-first-compare.test.mjs` | 18/18 |
| `test/viewer-render-look.test.mjs` | 14/14 |
| `test/viewer-core.test.mjs` | 7/10; tests 3, 4 (camera convention 1) and 9 (one GL buffer per highlight) fail as documented by camera-navigation and render-transport; test 5 (every feature loads, no key conflicts, including `Shift+W`) passes |
| `test/viewer-server.test.mjs` | 10/12; "query pool" stops at `printability` (implemented by fdm, the stub test expects 501) and "frozen stubs" fails on topology-classes' logical faces. `diffBounds` answers 501 for the test's schema-less `{ bodies: [] }` as that test expects. |
| `test/viewer-live-client.test.mjs` | 21/22; test 22 fails inside `features/parts/parts.js` (parts-tree, in progress) |

`node scripts/viewer/check-format.mjs` and `check-contracts.mjs` pass.

The polygon offset of the ghost faces was chosen by experiment: with (1, 6)
coplanar faces of the two revisions with different triangulations showed
through in stripes; (2, 40) hides shared surfaces completely while the
changed regions stay visible.

## Gaps

- **Delta strip and `/api/compare` still show display bounds** for null
  recorded bounds until `src/viewer/routes/compare.mjs` passes kernel bounds
  (integration request 1, verified with the QA copy). The ghost panel and
  `/api/diff` already carry them.
- **The ghost revision is not pinned on the server.** live-client posts pins
  for displayed, compare, annotated and loading revisions; the ghost needs
  integration request 2. Without it an evicted ghost revision's draw payload
  is rebuilt on demand (slower, still correct); the client cache pins it
  through `display.ghost`.
- **Edge-band bounds cover planes, cylinders and cones only.** Spheres, tori
  and splines answer `unsupported` with the faces named. A cone face whose
  apex may lie outside the edge-band box, with fewer than two coaxial full
  circles bounding it (a pointed cone, a cone with a hole), answers
  `unresolved`; deciding it needs a trimmed-face membership query at the
  apex.
- **The ghost is display data.** It shows where the previous revision's
  surfaces lie, not a computed material difference (the five-status identity
  tint and on-demand material diff stay deferred, spec 14). Surfaces within
  about the polygon offset of the displayed surfaces at grazing angles are
  hidden; ghost edges coincide by display endpoints on a 1 µm grid; more than
  20,000 ghost edge segments are cut (counted in `ghostStatus().layer`).
- **Blend is ghost opacity**, not a crossfade of the displayed model (the
  displayed model's opacity belongs to parts-tree and x-ray).
- **Terminal bounds.** live-server prints "≈ … display ±0.02 mm" for null
  recorded bounds; spec 3.1 allows `kernel` there (integration request 3).
- `docs/viewer-ui.md` (German, help-a11y) does not describe the ghost yet
  (integration request 4).

## Integration requests

1. `src/viewer/routes/compare.mjs` (model-first-compare): apply
   `out/viewer/diff-overlay/integration-compare-route.diff`: import
   `kernelBoundsFor` from `../diff.mjs`; in `descriptor(id)`, when a body
   lacks recorded bounds, set `kernelBounds = await kernelBoundsFor(ctx, id)`
   and read the display scene only when `kernelBounds.status !== 'resolved'`;
   return `kernelBounds` in the descriptor; do not cache a pair whose
   `kernelBounds.transient` is set. Verified with `qa.mjs --integration`.
2. `viewer/features/live/live.js` (live-client): pin the ghost. In
   `postPins`, `extra: [loading?.modelId, app.ghostModelId?.()].filter(Boolean)`;
   and add `app.ghostModelId?.() ?? ''` to `viewKey()` so a ghost change
   reschedules the pins.
3. `src/viewer/live/*` (live-server, optional): for revisions with null
   recorded bounds, print kernel bounds (`kernelBoundsFor(ctx, id)`, label
   `kernel`) in the terminal line once they resolve.
4. `docs/viewer-ui.md` (help-a11y): a German paragraph: "Geist der
   vorherigen Revision (Shift+W): die vorherige Revision derselben Quelle
   halbtransparent über dem Modell, Überblendregler, Maß-Deltas mit Label
   (recorded/kernel/display); bei jedem Revisionswechsel sofort entfernt und
   „pending“, bis neu berechnet."
5. Optional reuse: parts-tree (`boundsMm` per body) and fdm (plate relation
   "from exact or recorded bounds") can call `kernelBoundsFor(ctx, id)` for
   bodies whose recorded bounds are null.
