# render-transport: draw payload, cache, picker, highlight

Package of wave 1 (spec 7.2, 9.3, D12). Rendering, picking and hover use a
binary draw payload instead of the JSON display scene. The JSON scene is still
served (compact) and is loaded only when the inspector needs identity, source
or `edgeIndices`. Evidence and open points: `package-render-transport.md`.

## Files

| File | Role |
|---|---|
| `src/viewer/draw.mjs` | producer: `buildDrawPayload`, `drawQuery` (query kind `draw`), `exactNormals`, `loadDrawKernel` |
| `src/viewer/routes/draw.mjs` | `GET /api/models/:id/draw` with a byte-bounded payload cache |
| `viewer/render/draw-decode.js` | shared by server and browser: array builder, encoder, decoder, JSON-scene adapter |
| `viewer/render/scene-cache.js` | LRU of draw models, JSON scenes and GPU buffers; pins |
| `viewer/render/picking.js` | typed-array picker with a screen grid |
| `viewer/render/renderer.js` | WebGL2 renderer, shader highlight, context restore |
| `viewer/render/gl.js`, `shaders.js` | context, program, uploads, state textures |

## Payload `wonky.draw/1`

Little-endian, every section 4-byte aligned:

```
u32 magic 'WKD1' | u32 headerBytes | header JSON (UTF-8, space padded)
| f32 positions[3n] | i16 normals[2n] (oct16) | u32 faceOfVertex[n] | u16 bodyOfVertex[n]
| u32 indices[3m]
| f32 edgePoints[3k] | u32 edgeSegments[2s] | u32 edgeOfSegment[s] | u8 edgeClass[e]
| f32 vertexPoints[3v] | u16 bodyOfPoint[v] | u32 vertexIndex[v]
| u32 faceEdgeOffsets[f + 1] | u32 faceEdges[b]
```

- Positions, edge points and B-rep vertex points are relative to
  `header.center` (the center of the display bounds). The subtraction is done
  in float64 before the float32 conversion.
- Face, edge and point numbers are global: bodies in order, then the scene's
  faces, edges and vertices. `header.bodies[i].faceRange`, `edgeRange`,
  `pointRange`, `indexRange`, `vertexRange` and `segmentRange` map them back.
- Triangle winding follows the outward display normal (the JSON triangle
  normal already carries `sameSense`).
- Normals: planes, cylinders and cones get exact outward normals per vertex.
  Bend (`kernel/display.bend`) finds the chart angle of the display vertex
  (`cylinder_coordinates`) and evaluates `surface_normal` there. If one exact
  normal points away from its display triangle, the face falls back to its
  triangle normals, so a wrong normal is never sent. Each face states
  `normalSource: exact | display`. oct16 costs at most 0.004°.
- `edgeClass` holds the codes of `src/viewer/edge-classes.mjs`
  (`header.edgeClassNames`). Logical faces come from
  `src/viewer/logical-faces.mjs`. If either helper throws, the payload keeps
  `unresolved` classes and one logical face per fragment, and says why in
  `notes`.
- `faceEdgeOffsets`/`faceEdges` (an addition to spec 9.3) list the global
  boundary edges of each face as compressed sparse rows (CSR). Boundary
  highlights and faces without triangles use them.

Header: `schema, version, modelId, exactness: 'display-approximation', center,
bounds, toleranceMm, diagnostic, counts, bodies[{index, alias, id, name,
appearance, …ranges}], faces[{alias, surfaceType, logical, indexRange,
normalSource, maxChordErrorMm, displayWarning?}], logicalFaces[{alias,
fragments}], edges[{curveType}], edgeClassNames, notes`.

Deviation from spec 9.3: edge entries carry no `alias` and no `class`. The
alias is `B<b>.E<i>` from the ranges, and the class is in the binary
`edgeClass` section. Repeating both costs 13 KB on r10b-retained.
`maxChordErrorMm` is the cylinder strip bound from `display-cylinder`
(rounded up to two significant digits), 0 for planar faces with straight
boundaries, or the scene tolerance otherwise.

Sizes: r10b-retained 288,244 B (73,673 B gzip), 333k-triangle stress scene
18.4 MB (4.2 MB gzip).

## Server

`GET /api/models/:id/draw`:
- `application/octet-stream`, `ETag: "<id>.wkd1.v<version>"`,
  `If-None-Match` answers 304, `Accept-Encoding: gzip` gets gzip,
  `X-Wonky-Draw-Bytes` gives the raw size.
- Unknown revision: 404. The producer's capability errors (no bodies, display
  preparation failed) are 501 with the reason.
- The payload comes from `registry.drawPayload(id)` when live-server's build
  worker has produced one. Otherwise it comes from `ctx.pool.query('draw', id,
  { modelId, scene })`. Concurrent requests share one production. A cache
  bounded at 128 MB keeps raw and gzip bytes.

`drawQuery(model, { modelId, scene? }, { signal })` loads the Bend display
module once, prepares a review scene if none is passed, classifies edges,
groups logical faces and computes exact normals. The normals are computed in
slices that yield to the event loop every 15 ms and honor `signal`.
`buildDrawPayload(model, scene, { logical, classes, modelId, normals })`
returns `null` until `loadDrawKernel()` has run (frozen contract: "compute
lazily").

## Client

### Scene cache (`ctx.cache`, `state.scenes`)

- `cache.scenes` is the Map-compatible JSON-scene store (VS sets it directly).
- `model(id)` returns the draw model. It is the payload once loaded, otherwise
  the JSON-scene adapter (`sceneDrawModel`: same arrays, display normals, one
  logical face per face).
- `loadDraw(id)`, `loadScene(id)`: one request per id; the JSON scene is
  compact.
- Pins: `pin(owner, ids)`, `unpin(owner)`, `pinSource(owner, () => ids)`. The
  renderer pins the displayed and compare models, highlighted models and the
  models referenced by annotations (target, view before/after). Other
  features add ghost or live pins with `pin`.
- Eviction: least recently used unpinned entries go when there are more than
  8, or when GPU buffers exceed 256 MB. The renderer deletes their buffers,
  vertex arrays and textures (`onEvict`). Typed arrays of pinned entries stay
  in memory for context restore.
- `stats()`: entries, pinned, unpinned, gpuBytes, evictions, drawLoads,
  sceneLoads.

### Renderer (`ctx.renderer`)

New members next to the foundation interface:

| Member | |
|---|---|
| `loadModel(id, { signal })` | fetch, decode and upload the draw payload |
| `model(id)`, `bounds(id)` | draw model and display bounds, without JSON |
| `summary(id)` | model overview from the draw model: bodies (id, name, appearance, counts), faces, logical faces, display bounds (`boundsExactness: 'display-approximation'`), display warnings, diagnostic |
| `alias(reference)` | `B1.F3` from the draw model |
| `entityPoints(reference)` | display points in world mm: edge polyline, vertex, face triangle corners, body vertices |
| `pickDetail(x, y, mode)` | `{ reference, point, exactness: 'display-approximation' }` with the display hit point |
| `highlightState(id)` | debug: highlighted faces, edges and points |
| `unavailableReason()` | the capability message when WebGL2 is missing |
| `onContextRestored(fn)` | after the program is rebuilt and the view redrawn |
| `stats()` | GPU counters (created and deleted buffers, textures, vertex arrays, uploads, releases, live bytes, losses, restores), cache, picker, frames |

- WebGL2 with `stencil: true` is required. Otherwise `init()` throws
  `RenderCapabilityError` with the message "This viewer draws models with
  WebGL2 and a stencil buffer, which this browser does not provide. The
  inspector, library, checks and review notes keep working."
- `prepareScene(scene)` (the JSON path of today's loader) draws the adapter
  at once and fetches the payload in the background. It stays a no-op without
  WebGL, so the VS harness never requests `/draw`.
- Highlight: one R8UI state byte per face and per edge (bit 0 hover, bit 1
  selected), read in the vertex shader. A face reference expands to its
  logical face. Hover also outlines the logical face (boundary edges except
  seam and subdivision). Any number of references can be selected; no buffer
  is allocated per highlight. Hover tint CIE76 ΔE 37.5 against the face and
  selection ΔE 43.3 (today's orange), both measured.
- A hover change is drawn inside `setHighlights`, which runs in the animation
  frame of the pick.
- Context loss: GPU handles are dropped and the typed arrays are kept.
  `webglcontextrestored` recompiles, re-uploads, redraws and hides the
  "interrupted" message.
- Layers get `frame.viewProjection` relative to `frame.origin` (the model
  center, float32-safe) and `frame.matrixFor(origin)` for other origins.

### Picker (`renderer.pick`, harness `pick`)

- Semantics: vertex within 7 px, then edge within 6 px, then the nearest
  face; `body` mode returns the face's body. References keep the key order
  `{modelId, bodyId, entityType, entityIndex}`.
- An edge or point is hidden when it lies more than 1.5 CSS px of view depth
  (`depthPerPixel`) behind the nearest face. Bodies hidden by the style
  (`style.bodies[id].visible === false`) and the clipped-away side of
  `style.clipPlanes` (`{ origin, normal }`, world) are not pickable.
- Per camera, pane and model, all points are projected once and triangles,
  segments and points are binned into a screen grid. Items covering more
  than 256 cells are tested on every pick. A pick visits one cell in
  ascending index order, so ties resolve exactly like a linear scan (tested
  against a brute force and the previous linear picker).
- `pick.stats()` reports picks, projections, projection time, and the last
  and median pick time excluding projection.

## Lazy JSON scene in the features (integration)

With WebGL2, the loader should request only the payload and the inspector
should load the JSON scene on the first inspection. That needs small edits in
features owned by other packages. The exact diff is in
`out/viewer/render-transport/integration.diff`, and each file is listed in
`package-render-transport.md`. Without these edits everything still works:
the JSON scene loads as before and the payload replaces the adapter when it
arrives.
