# section: display clip planes, caps and exact contours

Package of wave 3 (spec 4, 5 key `X`, 6 row "Section", 9.2
`POST /api/models/:id/section`, 12 "section"). It cuts the display mesh with
up to three planes, closes the cut with caps in the body color and, on
demand, asks the kernel for the exact section contours of one plane. The
report with the evidence is `package-section.md`.

Two things are kept apart everywhere, as the project rules require:

| What | Source | Label |
|---|---|---|
| Clipping and caps | display mesh (render-look clip planes, this package's caps) | "display section ±0.02 mm" (the model's display tolerance) |
| Exact contour | `sectionSolid` in Bend (`src/section.mjs`, `kernel/section.bend`) | chip "kernel"; its polylines "display ±0.02" |

The viewer never nudges a plane, never invents a cap for an open mesh and
never shows a partial contour as complete.

## Files

| File | Role |
|---|---|
| `viewer/features/section/section.js` | feature: state, commands, panel, settings, exact-contour requests, contour layer; pure plane math (exported, tested) |
| `viewer/features/section/section-caps.js` | caps: parity target, cap shader, gap closing, cap availability, plane/box helpers |
| `viewer/features/section/section.css` | view action state, floating panel |
| `src/viewer/section.mjs` | query-worker handler `sectionQuery` (kind `section`), request validation, contour serialization |
| `src/viewer/routes/section.mjs` | `POST /api/models/:id/section` |
| `test/viewer-section.test.mjs` | 15 tests (plane math, caps helpers, kernel cases, route, feature in the fake browser) |

## Using it

- `X` (or the section button in the view actions) turns the section on and
  off. On means one plane by default, through the model center with normal
  −Y (the front half is cut away).
- The panel (bottom right, collapsible with −) edits the active plane:
  - **Plane 1 / 2 / 3** tabs and **+ Plane** (at most three). A second and
    third plane start on X and Z.
  - **X Y Z** set the normal to that axis; the sign is chosen so the half
    facing the camera is cut away. The same axis keeps its position.
  - **From view** sets the normal to the view direction, keeping the plane
    point, so the cut faces the camera.
  - **Flip** cuts away the other side of the same plane.
  - The **slider** moves the plane across the model bounds (±2 %); the mm
    field takes an exact value (axis planes show the axis coordinate, for
    example `x = 18.00 mm`; other planes show `n·p`).
  - **Plane on** disables a plane without deleting it; **Remove plane**
    deletes it (the last one turns the section off).
- The cap list names every displayed body with its color: `capped`, `not
  cut`, `clipped away`, `hidden, not capped` or `cap unavailable: N
  boundary-only face(s) (B2.F4)`.
- **Exact contour** asks the kernel for the active plane. While it runs the
  panel says "Computing the exact contour … in the query worker…" with
  **Cancel**; the viewport keeps drawing. A result is drawn as blue lines on
  the cut; a failure is listed per body verbatim (below). Moving the plane,
  another model or section off removes a drawn contour ("The plane or model
  changed; the contour was removed") and aborts a running request.

Settings (scope S, per source, spec 6): `section = { on, active, planes:
[{ normal, offset, enabled }] }` in `<reviews>/viewer-settings.json`. A
source without a setting starts off with the default plane. Changes are
saved 250 ms after the last edit and with `keepalive` on `pagehide`.

## Clipping and picking

The feature writes only `display.section = { planes: [{ origin, normal }] }`
(world mm, origin = offset · normal). `features/display/display.js` composes
it into `style.clipPlanes`; the renderer discards `dot(n, p − origin) > 0`
for faces, edges and points, and the picker skips hits on that side
(render-look, `render/picking.js`). Nothing in this package changes that
path.

## Caps

A cap is drawn per plane and body in a renderer layer (`section.caps`,
order 5), from the display triangles only. It is the stencil-cap technique;
the parity lives in an offscreen R8 target instead of the stencil buffer,
because WebGL2 cannot sample stencil and the cap shader needs neighbouring
pixels:

1. **Parity.** The body's display triangles, clipped by this plane only, are
   drawn into the parity target without depth test; every fragment toggles
   its pixel (`blendFunc(ONE_MINUS_DST_COLOR, ZERO)`). Where the plane point
   is inside the body, the ray crosses the remaining surface an odd number
   of times, so the pixel ends at 1.
2. **Cap.** The polygon plane ∩ model bounds is drawn on the canvas where the
   parity is 1, discarded where another plane cuts it away, depth-tested
   against the model and written to depth. Color: the body color (appearance,
   parts-tree override or viewer palette, from `renderer.look()`), opacity as
   the body, with a screen-space hatch (every 7 CSS px, 78 % shade) so a cap
   is never taken for a model face.
3. Each pass is scissored to the body's projected bounds inside the pane, and
   a body whose bounds the plane does not cross is skipped.

**Gap closing.** The display mesh is not watertight: a cylinder and its
planar neighbour are tessellated independently, so their seam carries
slivers up to the display tolerance wide. A ray through such a sliver flips
the parity and leaves a hairline leak in the cap
(`out/viewer/section/g-without-gap-closing-crop.png`). The cap shader
therefore also fills a parity-0 pixel when, along one of four directions,
parity-1 pixels lie on both sides within `gap` px, where `gap` is the display
tolerance at the current zoom in device px, rounded up, 1 to 6 px. This
closes openings up to `2 gap − 1` px, about twice the display tolerance:
the seams, and also a real slit that narrow. It never extends a convex
outline; a concave corner of the cut can be blunted by up to `gap` px. Both
effects are within the stated display tolerance at that zoom (plus one
pixel) and are listed in the gaps of the report.

**Cap unavailable.** A body with a boundary-only face (a face with a display
warning, drawn as edges only, or with no triangles) has an open display
mesh; its parity would be meaningless. Its cap is not drawn and the panel
says `cap unavailable: 1 boundary-only face (B2.F1)`, with the face's
display warning as the row title. Clipping and picking still work for it.

GPU resources: one R8 target of the drawing-buffer size and a copy of the
displayed models' positions and indices, both released when the section is
off (`sectionStats().caps.bytes`, `targetBytes`). Context loss drops them;
they are rebuilt on the next frame.

## Exact contour

`POST /api/models/:id/section` with `{ origin, normal, bodies? }` (world mm;
`bodies` lists body ids, the client sends the visible ones). The route
validates the body (400), answers 404 for an unknown revision and runs the
query in the query worker (`ctx.pool.query('section', …)`, timeout 10 s)
with `supersedeKey` `section:<modelId>`: a newer request for the same
revision supersedes the running one (409), and a client that closes the
request cancels it (499). The browser side is latest-wins too
(`requests.scope('section.exact')`): a second click, a moved plane or a model
change aborts the fetch.

`sectionQuery(model, payload, { signal })` calls `sectionSolid(body, plane)`
for every requested body (checking the abort signal between bodies) and
answers:

```js
{
  schema: 'wonky.viewer-section/1', plane: { origin, normal },
  status: 'resolved' | 'failed',
  reason?: 'B1: Solid/plane section FaceContact at face 0',   // first failure
  contours: [{ body: 'B1', bodyId, index, edges: [{ edge, forward, face: 'B1.F3',
    curve: { type: 'line' | 'circle' | 'ellipse', … mm }, range: [t0, t1],
    chordBoundMm, points: [[x, y, z], …] }] }],
  bodies: [{ alias, bodyId, status, relation?, contours, message?, detail?, face?,
    kernelReason?, ms }],
  exactness: { contours: 'kernel-resolved', points: 'display-approximation' },
  displayToleranceMm: 0.02, ms,
}
```

- Body `status`: `resolved` (kernel `Resolved`; `relation` `Empty` or
  `Transverse`), `failed` (kernel `Failed`), `unsupported` (the adapter
  raised a capability error before sectioning, message verbatim) or `error`
  (anything else, message verbatim). `status` is `resolved` only when every
  requested body resolved; contours of resolved bodies are always returned
  and tagged with their body.
- A failure is passed on unchanged: `message` is the text
  `requireResolvedSection` raises, `detail` renders every tag and field of the
  kernel reason record as a chain (`FaceContact face 0 › VertexContact edge 4
  location StartVertex(index 4, point (18, 40, 0), gap 0)`), `face` is the
  alias of the named face and `kernelReason` the raw record. The panel shows
  all three (the record under "Kernel reason record").
- `curve` and `range` are the kernel's exact parameters (Real `hi + lo`); the
  ring order and coedge directions are the kernel's. `points` is a display
  polyline of that curve: lines by their end points, circles and ellipses in
  uniform parameter steps with chord error ≤ 0.02 mm (`R dt² / 8`); the
  achieved bound is `chordBoundMm`.
- A model without bodies is a capability error (501), like every frozen
  query handler called with `{ bodies: [] }`.

Contours are drawn by the layer `section.contour` (order 6) with
`frame.drawLines` (2.5 px, blue, depth-tested, 2 px depth bias), only in panes
showing the revision they were computed for.

## Debug and QA handle

`window.wonkyViewer.app`: `sectionState()` (planes, world planes, contour
summary), `sectionStats()` (request counters: requests, completed,
superseded, cancelled, failed, errors; cap counters, last frame's caps,
availability per body), `setSectionPlanes([{ normal, position | offset,
enabled }], { active, on })`, `sectionExact()`, `sectionNormalFromView()`,
`sectionDebugGap(px | null)` (fixed gap-closing radius for comparisons).

QA drivers (not committed): `tmp/viewer/section/qa/qa.mjs [a1 a2 gap a3 a4
extras]`, `persist.mjs`, `perf.mjs`, `r10b-exact.mjs`, `compare.mjs`, against
a viewer started with `node scripts/viewer/qa/serve.mjs start --port 4364 …`.
