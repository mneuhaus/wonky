# Ghost of the previous revision and exact bounds deltas

Package `diff-overlay` (wave 3, P1) of `docs/viewer/spec.md` (sections 3.4,
9.2, 10.4). This page describes the behavior and the interfaces. Evidence and
open gaps are in `docs/viewer/package-diff-overlay.md`.

## What you see

- **Ghost (`Shift+W`, or the ghost button in the view actions).** The
  previous revision of the displayed model's source is drawn translucent over
  the displayed model, in one blue tint, with its changed feature edges. In
  compare mode the ghost is the before model and it is drawn in the after
  pane. `Shift+W` again (or × in the panel) hides it.
- **What the ghost shows.** The ghost is depth-tested against the displayed
  model and pushed behind its surfaces, so surfaces both revisions share show
  the displayed model only. Where the previous revision had material that is
  gone now (a smaller bore, a lower top), the ghost is visible; where the new
  revision added material, the new surfaces hide the ghost. Ghost edges are
  drawn only where they do not coincide with an edge of the displayed model:
  the old outline of a changed feature stands out, unchanged edges stay as
  they are.
- **Panel.** Lower right, above the view actions (lower left in two rows
  below 900 px):

  ```
  ▣ r3 ghost   Blend ───●──── 35 %   bounds Δ 0 × 0 × +4 mm [kernel] · volume Δ −144.7 mm³ [recorded]   ×
  ```

  The label names the ghost revision (`r3 ghost`, `archived ghost`, or
  `ghost` without revision facts). The **blend slider** sets the ghost's
  opacity (5–100 %, default 35 %); the value is a global setting
  (`ghostBlend`, scope G) written when the slider is released. The deltas come
  from `GET /api/diff`; each carries its exactness chip. A click opens the
  **Ghost delta** drawer: bounds size, min and max for both revisions with Δ
  and label, recorded volume, the kernel method, and per body the bounds
  source (recorded or kernel), status and size or reason.
- **Pending.** The ghost is keyed by model id. When the displayed model
  changes (a live swap, a library click, a compare change) the old ghost is
  removed from the view at once and the panel reads `r4 ghost [pending] …
  bounds Δ pending` until the new pair has both its draw data and its
  `/api/diff` answer. A late answer for a replaced pair is dropped.
- **No ghost.** Without an earlier revision the panel says "No earlier
  revision of this source". Without WebGL2 the ghost is not drawn (the panel
  says why) and the deltas still come.

## Exactness

| Value | Source | Label |
|---|---|---|
| Ghost faces and edges | draw payload of the ghost revision (display mesh) | not a measurement; drawn only |
| Bounds Δ, body with recorded bounds | `validation.boundsMm` | `recorded` |
| Bounds Δ, body with `boundsMm: null` | Bend edge bands (below) | `kernel` (`kernel-resolved`) |
| Bounds Δ, kernel cannot resolve | display envelope | `display ±t`, with the kernel's reason in the title and drawer |
| Volume Δ | `validation.volumeMm3` | `recorded`; null stays "not evaluated" |

A delta is as weak as its weakest side: recorded + recorded = recorded,
anything with kernel = kernel, anything with display = display. Its tolerance
is the sum of both sides (recorded 0, kernel = max(model tolerance, Bend
arithmetic guard), display = display tolerance). Kernel values print to the
decade of that tolerance (4 decimals for 0.0003 mm).

### Exact bounds from edge bands

On a solid bounded by planes, cylinders and cones every directional extreme
lies on an edge: a plane carries a linear height function, and cylinders and
cones are ruled, so an interior extreme needs a generator of constant height,
which reaches the face boundary. The one exception is a cone's apex. So the
union of the Bend edge-band extrema (`boundEdgePlaneBand` of every edge
against the planes x = 0, y = 0 and z = 0, contact cap 1e-7 mm; resolved
results of any relation and `Unresolved/Threshold` evidence carry the
computed extrema) is the exact box, when

- every face is a plane, cylinder or cone (otherwise the body is
  `unsupported`, with the offending faces named: "B1.F4 (sphere)");
- every edge band returns extrema (otherwise `unresolved`, naming the first
  failing edge and axis: "B1.E2 along Z: Rejected/EdgeRejected/InvalidDomain");
- no cone face can reach its apex outside the box. A cone face whose loops
  hold two full coaxial circles at different heights (a frustum band, the
  conical spacer) provably excludes the apex; otherwise an apex outside the
  edge-band box leaves the body `unresolved` ("Cone face B1.F2 may reach its
  apex at (0, 0, 24) outside the edge-band box; whether the trimmed face
  contains it is not decided").

Nothing is sampled, nudged or guessed. Bodies with recorded bounds are not
recomputed. Measured: cross bore (7 faces, 15 edges) 45 band calls, bored
spacer reproduces its recorded bounds exactly, the five r10b retained bodies
(null recorded bounds) resolve in about 0.3 s warm, 2.2 s including the
worker start and kernel load.

## Server API

`GET /api/diff?after=<id>[&before=<id>]`. Without `before` the ghost is the
previous revision of after's source (highest revision number below after's;
archived snapshots have none); with it, `before` (pairing `explicit`). 400 for
a missing or malformed id, 404 for an unknown revision, 200 with
`pairing: 'none'` and a reason when there is no earlier revision.

```json
{
  "schema": "wonky.diff/1",
  "pairing": "previous-revision",
  "identical": false,
  "before": { "modelId": "…", "label": "cross-bore", "revision": 3, "kind": "live",
    "kernelBounds": { "status": "resolved", "bounds": { "min": […], "max": […], "size": […] },
      "exactness": "kernel-resolved", "toleranceMm": 0.0003, "ms": 12,
      "bodies": [{ "bodyId": "model/bore/0", "alias": "B1", "source": "kernel",
        "status": "resolved", "bounds": { … }, "exactness": "kernel-resolved",
        "toleranceMm": 0.0003 }] } },
  "after": { … },
  "ghost": { "modelId": "<before>", "forModelId": "<after>",
    "representation": "display-approximation", "note": "…never measured" },
  "scope": "The ghost is the display mesh of the before revision …",
  "deltas": { "bodies": …, "faces": …, "logicalFaces": …, "edges": …, "vertices": …,
    "volumeMm3": { …, "exactness": "recorded" },
    "bounds": { "status": "evaluated", "exactness": "kernel-resolved", "toleranceMm": 0.0006,
      "before": { "min": […], "max": […], "size": […], "exactness": "kernel-resolved",
        "toleranceMm": 0.0003, "method": "union of Bend edge-band extrema …" },
      "after": { … }, "delta": { "min": […], "max": […], "size": [0, 0, 4] } },
    "bodyMatches": [{ "bodyId": "model/bore/0", "bounds": { "exactness": "kernel-resolved", … } }] },
  "sourceLines": { … }
}
```

`deltas` and `sourceLines` are `compareModels` output (below), so the shapes
equal `GET /api/compare`. Kernel bounds are computed in the query worker and
cached per model id (a revision's bounds serve every pair it is part of); the
pair result is cached unless a transient pool failure (timeout, worker down)
is part of it, which falls back to the display envelope with
`kernelReason` and is retried on the next request.

Module interfaces:

- `src/viewer/diff.mjs`
  - `diffBoundsQuery(model, { other }, { signal })`: the frozen `diffBounds`
    query-worker handler. Returns `kernelBounds(model)` plus `other` (echoed;
    bounds are per model). `{ bodies: [] }` without a schema is a
    `CapabilityError` (501).
  - `kernelBounds(model, { signal, band, onlyMissing = true })` →
    `{ schema: 'wonky.kernel-bounds/1', status: resolved | unresolved |
    unsupported | not-needed, bounds, exactness, toleranceMm, reason, method,
    bodies: [{ bodyId, alias, source: recorded | kernel, status, bounds,
    toleranceMm, guardMm, reason, issues, calls, ms }], ms }`.
  - `kernelBodyBounds(body, { alias, signal, band })`, `coneApex(body, face)`,
    `bandExtrema(result)`, `unsupportedFaces(body)`: the steps, exported for
    tests. `band` defaults to `boundEdgePlaneBand` (lazy import).
  - `kernelBoundsFor(ctx, modelId)`: server side, through
    `ctx.pool.query('diffBounds', …)`, cached per registry and model id;
    `{ status: 'not-needed' }` when every body has recorded bounds; 501 answers
    are cached as `unsupported`, other pool errors are returned as
    `{ status: 'failed', transient: true }` and not cached.
  - `ghostPairing(list, { after, before, snapshotDirectory })`,
    `diffModels(before, after, { logical, pairing, labels })`.
- `src/viewer/compare.mjs`: `compareModels(before, after, { logical })` is
  unchanged in signature. A descriptor may carry `kernelBounds` (a
  `kernelBounds()` result); a body whose recorded bounds are null then uses
  its resolved kernel box (matched by position and body id). Without
  `kernelBounds` the output is byte-for-byte what it was.
  `boundsDelta(before, after)` ranks recorded < kernel-resolved < display.
- `src/viewer/routes/diff.mjs`: `GET /api/diff`.

## Client

`viewer/features/diff/`:

- `diff.js`: the feature. Command `diff.ghost` (`Shift+W`, "Ghost of previous
  revision"), button `#ghost-toggle` (view actions, order 13), panel
  `#ghost-panel` (stage slot, order 40) with `#ghost-label`, `#ghost-state`,
  `#ghost-blend`, `#ghost-blend-value`, `#ghost-details`, `#ghost-close`.
  Store keys: `diff` (`ghost` snapshot, `blend`) and `display.ghost`
  (`{ modelId, opacity }`, set only while the ghost is drawn; the renderer
  pins that model in the scene cache and widens the pane's depth window).
  The pair is re-evaluated on every store change of `after`, `before` in
  compare mode and `previousRevision(after)`, and on `onLiveSwap`. The panel
  is rendered before the store is notified, so no listener sees a new pair
  with the old ghost.
  Pure parts (tested): `createGhostController`, `ghostTarget`, `ghostLabel`,
  `boundsDeltaText`, `deltaItems`, `panelModel`, `detailsMarkup`,
  `clampBlend`.
- `ghost-layer.js`: `renderer.addLayer({ id: 'diff.ghost', order: 20 })`.
  Faces: `frame.drawBodies({ modelId, color, alpha, lit, depthMask: false,
  polygonOffset: [2, 40] })`, back faces then front faces. Edges:
  `frame.drawLines` of the ghost's sharp, tangent and unresolved segments that
  do not coincide (endpoints on a 1 µm grid, either direction) with a segment
  of the displayed model, at most 20,000 segments. `ghostEdgePositions` is
  exported for tests.
- `diff.css`: button state, panel, drawer tables, 900 and 650 px layouts.

Debug handle (`window.wonkyViewer.app`): `ghostStatus()` (snapshot, blend,
drawn pair, `display.ghost`, layer stats), `toggleGhost(on)`,
`setGhostBlend(value)`, `ghostModelId()` (for client pins).

Nothing of this runs on the legacy seam: the feature is not in the VS set.
