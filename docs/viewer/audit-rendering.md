# Viewer rendering and interaction audit

Scope: the WebGL renderer and the interaction layer of `viewer/app.js`
(shaders, lighting, edge pass, depth handling, picking, hover, camera,
projection, HiDPI, precision) and the display data it receives from
`src/review-scene.mjs`, `src/display-cylinder.mjs` and `src/display-export.mjs`.
Everything below was measured in a real browser against a private viewer
instance on port 4347. `viewer/app.js` was not changed. The harness appends a
probe to the module inside the audit browser session only.

Related audits: [audit-code.md](audit-code.md) (architecture, payload
composition, found the mirroring independently as F1),
[audit-data.md](audit-data.md) (exact parameters, overhang math, sections),
[audit-daily-use.md](audit-daily-use.md).

## 1. Summary

1. **Every view is a mirror image (critical).** The view basis
   (screen right, screen up, toward viewer) has determinant −1 at every camera
   angle. The "Top" preset shows +Y pointing down. The L-shaped test part
   renders as Γ, while the project's own report renderer shows the correct L
   for the same model and named view. Handed parts look like their mirrored
   twins, for example the r10b left and right rail carriers. The "Front" preset
   actually shows the +Y side. Picking and SVG overlays use the same mirrored
   math, so nothing *looks* broken, which is probably why it went unnoticed.
2. **The GPU is not the bottleneck; the CPU picker and the JSON transport are.**
   A 333k-triangle scene orbits with 1.6 ms GPU time per frame (3.1 ms with CPU
   and GPU synced) at 2000×1410 device pixels with 4× MSAA. The same scene
   costs **405 ms per hover pick**. Moving the mouse over it drops the page to
   **2.9 frames/s**. Opening it takes 1.4 s for a **247 MB** pretty-printed JSON
   response that carries 31 MB of vertex data.
3. **A typed-array CPU picker would fix picking without a GPU ID buffer.**
   Prototype on the same scene and camera: 6 ms projection per camera change,
   then **0.3 ms per pick** (1000× faster). It agreed with the current picker
   on 96 of 96 probe points. A WebGL2 ID buffer measured 0.8 ms per pick and
   agreed on 92 of 96, differing only at face boundaries.
4. **Shape readability is weak.** Edges are 1 device pixel, which is 0.5 CSS px on
   Retina (`ALIASED_LINE_WIDTH_RANGE` is [1, 1]). Their contrast to the faces
   is 1.7 to 2.7:1. Curved faces are flat-shaded per facet and have no
   silhouette lines. Seam edges are drawn like feature edges. Faces with the
   same normal but different depth have identical color. All bodies share one
   color, although the B-rep already carries per-body `appearance`. Hover is
   hard to see: ΔE 10, contrast 1.15:1.
5. **Precision, zoom and memory limits.** Absolute float32 positions put vertices
   up to 4.3 CSS px away from the exact overlay at 100 m from the origin. The
   zoom clamp is relative to the scene extent: the closest possible view of
   r10b is 15.7 mm wide, and about 140 mm for the 8×8 scene. Scenes and GPU
   buffers are never evicted. A live loop would leak about 6 MB of heap per
   r10b revision.

## 2. Method and environment

| Item | Value |
|---|---|
| Browser | Chromium 145 headless (Playwright 1.58 `chromium-1208`), `--use-angle=metal --enable-gpu`. Plain headless has **no WebGL at all**, so the flags are required |
| GPU | `ANGLE (Apple, ANGLE Metal Renderer: Apple M5 Pro)`, WebGL 1.0 context as created by the viewer; WebGL2 and `EXT_disjoint_timer_query` available |
| Viewport | 1512×945 CSS, DPR 2; model canvas 1000×705 CSS = 2000×1410 device px, `SAMPLES` 4, depth 24 bit |
| Machine load | load average 11 to 14 on 18 cores during all runs (shared machine, other workflows active). CPU timings are therefore pessimistic; GPU timer-query numbers are not affected |
| Viewer | `node bin/wonky-view.mjs … --port 4347 --reviews tmp/viewer/audit-rendering/reviews`, stopped after the runs. Ports 4310/4311 untouched |
| Timing | `performance.now()` around wrapped `draw`/`pick`/`select`/`prepareScene`/`api`; GPU time via `EXT_disjoint_timer_query`; synced time via a 1-pixel `readPixels` after draw; heap via `performance.memory` after `gc()`; process RSS via `ps` over the browser's process tree |
| Input | real CDP mouse events (Playwright `page.mouse`), about 120 Hz |

Models:

| Model | Kind | Bodies | Faces | Display triangles | Edge segments |
|---|---|---:|---:|---:|---:|
| `out/bracket.brep.json` | L bracket, handedness probe | 1 | 8 | 20 | 18 |
| `out/bored-spacer.brep.json` | cylinders | 1 | 4 | 266 | 122 |
| `out/boolean-ports/contact-work/P10-y4.brep.json` | largest real single body | 1 | 182 | 2928 | 1380 |
| `out/r10b-first-failure-inputs.brep.json` | overlapping Boolean inputs | 2 | 195 | 2980 | 1419 |
| `out/acceptance/r10b-retained.brep.json` | largest real assembly | 5 | 172 | 5242 | 2242 |
| `tmp/viewer/audit-rendering/stress-r10b-4x4.brep.json` | synthetic: 16 translated copies of r10b-retained | 80 | 2752 | 82954 | 35872 |
| `tmp/viewer/audit-rendering/stress-r10b-8x8.brep.json` | synthetic: 64 copies | 320 | 11008 | 332920 | 143488 |
| `tmp/viewer/audit-rendering/far*-bored-spacer.brep.json` | spacer translated by 20 m / 100 m | 1 | 4 | 256 | 122 |

The stress models are rigid translations of real bodies, built with
`scripts/viewer/make-stress-model.mjs`. Every copy still goes through the real
`reviewScene` and `display-cylinder` tessellation. Identity metadata is dropped
from the copies because its revision hash would be stale, so their JSON is
leaner than a real model of that size would be.

## 3. How the renderer works today

- **Context**: WebGL1, `antialias: true` (4× MSAA), `alpha: true`, one program
  and one draw per scene for triangles and one for edges.
- **Vertex shader**: absolute float32 positions. `position - center` is
  computed on the GPU, then yaw about Z and pitch. Orthographic only.
  `gl_Position.z = -viewDepth / (6·extent)`, so the used NDC depth range is
  about ±0.15.
- **Fragment shader**: `mediump`,
  `light = 0.70 + 0.30·|n·L|` with a fixed view-space `L`. `abs()` lights
  back faces like front faces. Normals are per triangle: planar faces get the
  face normal and cylinder/cone strips get one normal per column, so curved
  faces are flat-shaded.
- **Edges**: B-rep edge polylines (lines, circles and ellipses sampled at
  0.02 mm chordal tolerance) drawn as `gl.LINES`, 1 device px, color
  (82, 110, 82). Faces use `polygonOffset(1, 1)`; lines get no bias.
- **Highlight**: every hover or selection change allocates a new VBO with the
  entity's triangles or segments. Selected and hovered edges are also drawn as
  an SVG polyline, projected on the CPU in float64 and not depth tested.
- **Picking**: on the CPU in `pick()`. Every triangle of every face is projected
  through `project()`, which allocates objects, on every hover frame. Then all
  vertices and all edge segments are projected. Edge and vertex visibility
  uses a depth tolerance of 0.1 % of the scene extent: 0.26 mm for r10b,
  2.3 mm for the 8×8 scene, which is about an FDM wall thickness.
- **Camera**: `{yaw, pitch, zoom, pan}`. Pitch is not clamped, so the view flips
  over the pole. Orbit is always about the bounding-box center and zoom is
  always about the viewport center. Zoom is clamped to [0.05, 25]× of the fit.
  Four presets cycle.
- **HiDPI**: backing store is `clientSize × min(devicePixelRatio, 2)`. Point
  sizes scale with the ratio; line width cannot.
- **Data path**: `/api/models/<sha>` returns the whole scene as 2-space
  pretty-printed JSON, with every triangle as `{points: [[x,y,z]×3], normal}`
  plus identity and source metadata. `triangleData()` flattens it with
  `push(...spread)` into a JS array, then into a `Float32Array`. `state.scenes`
  and `state.buffers` keep every opened revision for the page's lifetime.

## 4. Measurements

Raw data: `out/viewer/audit-rendering/render-bench-dpr2.json`,
`pick-prototype.json`, `hover-sweep.json`, `render-shots.json`.

### 4.1 Payload and load

| Model | Served JSON (pretty) | Compact | Drawable part only | Vertex data now | Indexed binary (estimate) | Server display prep (warm) |
|---|---:|---:|---:|---:|---:|---:|
| P10-y4 | 2.33 MB | 0.90 MB | 0.85 MB | 0.28 MB | 0.13 MB | 2.2 s cold (includes kernel load) |
| r10b-first-failure-inputs | 10.39 MB | 7.66 MB | 0.87 MB | 0.28 MB | – | 148 ms |
| r10b-retained | 9.07 MB | 5.65 MB | 1.46 MB | 0.49 MB | 0.21 MB | 275 ms |
| stress 4×4 | 61.7 MB | 23.2 MB | 22.5 MB | 7.7 MB | ≈3.4 MB | 6.4 s |
| stress 8×8 | 247.5 MB | 92.8 MB | 90.1 MB | 30.9 MB | ≈13.6 MB | 19.4 s |

"Indexed binary" assumes float32 positions, oct-encoded int16 normals, u32
face ids, u32 indices and edge points (`scripts/viewer/audit-indexed-size.mjs`).
It averages 2.9 triangle corners per unique vertex.

Browser, cold open (evicted from the viewer cache first), until the first
frame is complete on the GPU:

| Model | Open → frame | fetch + `json()` | of which download | `JSON.parse` | flatten | `prepareScene` (flatten + upload) | Retained JS heap |
|---|---:|---:|---:|---:|---:|---:|---:|
| bracket | 15 ms | 4 ms | 3 ms | 0 ms | 0 ms | 0.1 ms | 0.0 MB |
| P10-y4 | 25 ms | 17 ms | 15 ms | 2 ms | 2 ms | 1.3 ms | 0.9 MB |
| r10b-first-failure-inputs | 62 ms | 56 ms | 34 ms | 8 ms | 3 ms | 2.4 ms | 7.6 MB |
| r10b-retained | 46 ms | 40 ms | 33 ms | 6 ms | 2 ms | 1.5 ms | 5.6 MB |
| stress 4×4 | 396 ms | 349 ms | 279 ms | 47 ms | 31 ms | 39 ms | 24.1 MB |
| stress 8×8 | 1413 ms | 1292 ms | 1320 ms | 197 ms | 127 ms | 107 ms | 96.8 MB |

For the real models, load is fine. Only 16 % (r10b-retained) and 8 %
(r10b-first-failure-inputs) of the served bytes are drawable data; the rest is
metadata the renderer never draws plus pretty-print whitespace, which alone
adds 60 %. At scale, download and parse dominate.

### 4.2 Orbit

Continuous drag orbit for 6 s, about 120 Hz input:

| Model | Draws/s | Frames > 33 ms | Draw CPU p50/p95 | GPU p50/p95 (timer query) | CPU+GPU synced p50 |
|---|---:|---:|---:|---:|---:|
| bracket | 60.2 | 0 | 0.1 / 0.2 ms | 0.61 / 0.61 ms | 1.8 ms |
| bored-spacer | 60.2 | 0 | 0.1 / 0.2 ms | 0.61 / 0.62 ms | 1.8 ms |
| P10-y4 | 60.2 | 0 | 0.1 / 0.2 ms | 0.61 / 0.62 ms | 1.9 ms |
| r10b-first-failure-inputs | 60.3 | 0 | 0.1 / 0.2 ms | 0.62 / 0.63 ms | 1.9 ms |
| r10b-retained | 60.3 | 0 | 0.1 / 0.2 ms | 0.64 / 0.72 ms | 2.1 ms |
| stress 4×4 | 60.4 | 0 | 0.1 / 0.2 ms | 0.93 / 0.98 ms | 2.2 ms |
| stress 8×8 | 60.3 | 0 | 0.1 / 0.2 ms | 1.57 / 1.63 ms | 3.1 ms |

Every input event produced one frame; the draw rate was bounded by the input
rate, not by rendering. The about 0.6 ms floor is the fill cost of 2000×1410
with 4× MSAA. Headroom for 120 Hz is large, so richer shading, fat edges and an
outline pass fit into the budget.

### 4.3 Hover and pick

96 hover positions and 12 clicks on a grid over the model, default iso:

| Model | `pick()` p50/p95 (auto mode) | Move → highlight drawn p50/p95 | Click → drawn p50/p95 | Continuous hover sweep |
|---|---:|---:|---:|---|
| bracket | 0.1 / 0.2 ms | 17.8 / 18.0 ms | 9.5 / 9.8 ms | – |
| bored-spacer | 0.3 / 0.4 ms | 17.8 / 18.0 ms | 9.5 / 10.5 ms | – |
| P10-y4 | 3.7 / 4.0 ms | 17.9 / 19.5 ms | 10.1 / 10.7 ms | – |
| r10b-first-failure-inputs | 3.9 / 4.3 ms | 17.9 / 19.6 ms | 12.0 / 12.4 ms | – |
| r10b-retained | 6.0 / 6.3 ms | 17.9 / 18.3 ms | 14.3 / 14.9 ms | 120 rAF/s, max gap 10 ms |
| stress 4×4 | 94.7 / 100.4 ms | 106 / 111 ms | 99 / 106 ms | **11.8 rAF/s**, max gap 125 ms |
| stress 8×8 | 405 / 421 ms | 417 / 441 ms | 407 / 411 ms | **2.9 rAF/s**, max gap 367 ms; 240 moves took 83 s to drain |

- Pick cost is linear, about 1.1 to 1.2 µs per triangle under this load. The
  code audit measured 3 µs at another load level; same shape.
- Even a 0.1 ms pick takes about 18 ms to show. Hover runs `pick()` in one
  animation frame and calls `scheduleDraw()` from inside it, so the highlight
  appears one frame later. Drawing in the same frame would halve the latency.
- The pick runs synchronously in `pointerup` and in every hover frame. On large
  scenes it blocks input, orbit start, the inspector and the whole page.

### 4.4 Memory

| State | JS heap used | GPU vertex buffers | Renderer RSS | GPU process RSS |
|---|---:|---:|---:|---:|
| Viewer open, first model | – | – | 182 MB | 99 MB |
| + r10b-retained | +5.6 MB | 0.49 MB | 300 MB | 104 MB |
| + stress 4×4 | +24.1 MB | 7.7 MB | 421 MB | 119 MB |
| + stress 8×8 | +96.8 MB | 30.9 MB | 599 MB | 184 MB |
| All 8 models cached, after GC | 138 MB | 39.6 MB | 485 MB | 167 MB |

The JS heap holds the parsed scene objects: 11× the vertex data for
r10b-retained and 3× for the 8×8 scene. Nothing is evicted. With a live loop,
each save of r10b would add about 6 MB of heap and 0.5 MB of GPU memory.

### 4.5 Picking strategies, prototyped

`scripts/viewer/audit-pick-prototype.mjs`, face mode, same 96 points and camera:

| Model | Triangles | Current `pick` p50/p95 | Typed-array CPU: project per camera, then pick p50/p95 | Agrees | WebGL2 ID buffer, scissored 1 px + `readPixels`, p50/p95 | Agrees | Full-frame ID pass | 13×13 window read |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| r10b-retained | 5242 | 4.6 / 6.8 ms | 1.7 ms, then 0.0 / 0.1 ms | 96/96 | 0.4 / 0.7 ms | 94/96 | 0.5 ms | 0.1 ms |
| stress 4×4 | 82954 | 74.4 / 77.5 ms | 1.9 ms, then 0.1 / 0.3 ms | 96/96 | 0.5 / 0.8 ms | 92/96 | 0.6 ms | 0.1 ms |
| stress 8×8 | 332920 | 303.8 / 313.1 ms | 6.0 ms, then 0.3 / 0.8 ms | 96/96 | 0.8 / 1.2 ms | 92/96 | 0.6 ms | 0.1 ms |

ID-buffer disagreements are pixel-center samples on face boundaries. Both
prototypes upload or project positions relative to the scene center, with the
subtraction done in float64.

## 5. Visual quality findings

Screenshots are in `out/viewer/audit-rendering/`. That directory is gitignored,
so they are local QA artifacts.

### 5.1 Mirrored projection

- `handedness-bracket-top-page.png`: "Top" preset, with the vertex (0, 40, 8)
  selected. The inspector shows Y = 40 at the **bottom**-left.
  `examples/bracket.fs` sketches an L; the viewer shows a Γ.
- `handedness-visual-after-top.png` vs `report-visual-after-top-matplotlib.png`:
  the same model and the same named view "top (+Z)". The viewer shows Γ, the
  project's report renderer shows L.
- `handedness-bracket-front.png`: the "Front" preset shows the step edge at
  x = 18. That edge exists only on the +Y side; a real front view from −Y
  shows a plain rectangle.
- Analytically the (b, z) block of `view()` is `[[sin p, cos p], [cos p, −sin p]]`
  with determinant −1. The numeric basis determinant is −1 as well
  (`render-shots.json → handedness`).

### 5.2 Edges

- `edges-r10b-zoom-crop.png` (DPR 2) vs `edges-r10b-zoom-crop-dpr1.png`: at
  DPR 2, edges are half as wide in CSS terms. Measured edge-to-face contrast is
  2.1, 1.7 and 2.7:1 on the three principal face shades, so on dark faces
  edges almost disappear. This is the likely cause of the reported "no visible
  feature edges on some models": the edges are there but below perceptual
  contrast. Black edges, as in OCP, would be 6 to 10:1 on these shades.
- `zfight-coplanar-edges-crop.png` (r10b-first-failure-inputs): edges of the
  second, overlapping input body lie in the plane of the first body's face and
  render as broken, stippled lines. `polygonOffset(1, 1)` on faces with no
  line bias is not enough, because line and triangle depth rasterize
  differently. Coincident faces of the two bodies also z-fight today but
  cannot be seen because both use the same color. **Per-body colors will make
  that visible** unless the bodies get a deterministic per-body depth
  priority.
- Periodic seam edges of cylinders are drawn like feature edges
  (`silhouette-spacer-low-iso.png`: vertical line inside the bore;
  `overview-four-holes.png`: a tick in every hole). The display data already
  lists them in `displayTessellation.seamEdges`.

### 5.3 Silhouettes and curved shading

- `silhouette-spacer-front.png`: the side outline of a cylinder has no line,
  and 24 flat facets show as vertical bands.
- `silhouette-p10-crop.png`: the curved end of the P10 channel is only a
  shading boundary against the background.

The fix needs no new geometry. Bend already evaluates the exact surface
normal (`D.surface_normal`), once per column middle. Evaluating it at the
column boundaries too and sending it per vertex is cheap.

### 5.4 Lighting and color

- Bracket iso: the three principal faces have luminance 0.35, 0.26 and 0.45,
  maximum contrast 1.6:1, minimum ΔE 7.3 (`lighting-bracket-iso.png`). That is
  acceptable between orientations, but faces with the **same** normal at
  different depths are identical. Examples: the y = 12 and y = 40 faces in
  the front view, and the rail top face against the hopper floor in
  `edges-r10b-zoom.png`. Only the 1 px edge separates them.
- `edges-r10b-zoom-noedges.png`: without edges, holes and body boundaries
  vanish.
- All bodies use (0.65, 0.76, 0.66). r10b-retained carries `appearance`
  colors: orange pickup plate, blue-grey floor and wall, grey carriers.
  `reviewScene` drops them.

### 5.5 Hover and selection contrast

On the bracket top face (`hover-face-bracket.png`, `select-face-bracket.png`):

| State | RGB | ΔE to base | Contrast to base |
|---|---|---:|---:|
| Base | (158, 185, 161) | – | – |
| Hover | (185, 195, 158) | 10.3 | 1.15:1 |
| Selected | (195, 134, 85) | 43.1 | 1.44:1 |

Selection is clearly visible. Hover is a slight yellow tint. The SVG hover
edge (#a3ad83) is close to the face color.

### 5.6 Precision far from the origin

`precision-{bored-spacer,far-bored-spacer,far1e5-bored-spacer}.png`: the same
10 mm spacer, top view at maximum zoom, outer rim edge selected.

| Offset | Max float32 rounding of display vertices | At max zoom |
|---|---:|---:|
| 0 | 0.22 nm | 0.0003 CSS px |
| 20 m | 0.91 µm | 1.2 CSS px |
| 100 m | 3.2 µm | 4.3 CSS px; a visible gap between the GPU face and the exact SVG selection line |

This is low severity for FDM parts near the origin, but free to fix: upload
positions relative to the model center, with the subtraction done in float64.

### 5.7 Camera limits

The maximum zoom is 25× of the fit, so the smallest field of view
(shorter canvas side) is 15.7 mm for r10b-retained and 68.6 mm for the 4×4
scene (`zoom-stress4x4-max.png`); it is about 140 mm for the 8×8 scene. A
0.2 mm FDM clearance is 10 CSS px wide on r10b and about 1 px on the large
scene. There is no zoom to cursor, no orbit about the picked point, no pitch
clamp, and no Back, Bottom or Left presets.

### 5.8 Aliasing and HiDPI

4× MSAA keeps triangle edges clean. The problem is width, not aliasing: 1
device px lines at DPR 2. There is no `webglcontextrestored` handler; after a
context loss the user must reload.

## 6. Findings by severity

| # | Severity | Finding | Evidence |
|---|---|---|---|
| R1 | critical | Mirrored projection in render, pick and overlay; "Front" preset shows the +Y side | 5.1 |
| R2 | high | CPU pick allocates per triangle per hover: 95 ms at 83k and 405 ms at 333k triangles; the page drops to 11.8 and 2.9 frames/s while hovering | 4.3 |
| R3 | high | Scene payload is pretty JSON with metadata: 247 MB and 1.4 s for 31 MB of vertices; heap 11× the vertex data | 4.1, 4.4 |
| R4 | high | Edges 0.5 CSS px on Retina with 1.7–2.7:1 contrast; no curved silhouettes; seams drawn as feature edges | 5.2, 5.3 |
| R5 | medium | One color for all bodies although `appearance` exists; same-normal faces indistinguishable; flat per-facet shading on curved faces | 5.3, 5.4 |
| R6 | medium | Coplanar edges of overlapping bodies stipple; coplanar faces will z-fight once bodies are colored | 5.2 |
| R7 | medium | Zoom clamp relative to extent, zoom and orbit about the center only, no pitch clamp | 5.7 |
| R8 | medium | Scenes and buffers never evicted; a live loop leaks about 6 MB per r10b revision | 4.4 |
| R9 | medium | Edge and vertex pick visibility tolerance is 0.1 % of extent (2.3 mm on large scenes), so hidden edges can be picked through thin walls | 3 (code reading) |
| R10 | low | Hover highlight appears one frame after the pick; a new VBO per hover | 4.3 |
| R11 | low | Hover tint ΔE 10 | 5.5 |
| R12 | low | Float32 absolute coordinates: 4.3 px error at 100 m | 5.6 |
| R13 | low | Selected-edge SVG overlay ignores depth: back edges are drawn over the model | 3 |
| R14 | low | No context-restore path | 5.8 |

## 7. Proposed renderer (WebGL2, no dependencies)

WebGL2 is available here and in Safari 15+ and current Chrome and Firefox.
Recommendation: require it, and show an explicit capability message
otherwise. Do not keep a silent WebGL1 fallback. Costs below are the measured
or prototyped runtime cost on this machine plus an implementation estimate.
The estimates are judgment, not measurement.

### 7.1 Camera module (fixes R1, R7, R12; prerequisite for everything else)

- One pure module shared by shader uniforms, picking, overlays and tests.
  State: target (float64), distance, orientation as turntable yaw about world
  Z plus a clamped pitch, projection (`ortho`/`perspective`, fov 35°).
  Right-handed view matrix. Presets follow Onshape and OCP: Front looks from
  −Y, Top from +Z, Right from +X, plus Back, Bottom, Left and Iso.
- Orbit about the picked point, falling back to the bounds center. Zoom about
  the cursor. Zoom limit in physical terms, for example down to 1 µm per CSS
  px, not relative to extent. Near and far planes from the bounding sphere.
- Matrices are built in float64 and uploaded as float32 relative to the model
  center (with 7.2).
- Tests: basis determinant +1 for all presets and random angles; the top
  preset maps +Y up; the renderer and the picker project the same point to
  within 1e-6 px.
- Saved reviews store yaw/pitch plus screen-space drawings made on mirrored
  views. They need a camera-convention version: legacy reviews without it
  restore in an explicit, labeled "legacy mirrored view", or hide their
  view-bound drawings with a note. Never silently re-project them.
- Cost: 0 ms per frame. About 1.5 days including perspective, tests and legacy
  handling.

### 7.2 Buffers and transport (fixes R3, R8, and half of R10)

- New endpoint `GET /api/models/<sha>/display.bin`. One ArrayBuffer: float32
  positions relative to the model center, oct16 exact normals per vertex, u32
  indices, u32 face id per vertex, edge points with edge id and an edge class
  (feature, seam, silhouette candidate). A small JSON header carries bodies,
  per-body and per-face index ranges, name, `appearance`, tolerance, notes and
  `displayTessellation`. Identity and source stay on the existing lazy entity
  API. The JSON scene endpoint stays for tools, compact rather than pretty.
- Client: VAO per scene, one `drawElements` range per body. Hover and
  selection become a `uniform uint` face or edge id compared in the shader,
  so no buffer is allocated per hover.
- LRU eviction: keep the current revision, the compare revision and pinned
  review revisions, and at most N others or about 256 MB GPU. Call
  `deleteBuffer` on the rest. Retain the typed arrays so the scene can be
  rebuilt after `webglcontextrestored` (R14).
- Expected: r10b 9.07 MB → about 0.21 MB; 8×8 247 MB → about 14 MB, which at
  the measured about 190 MB/s local rate is about 70 ms instead of 1.3 s, with
  no `JSON.parse`. Heap per scene drops to roughly the typed-array size.
- Instancing: not now. The B-rep has no instance or prototype relation;
  copies are separate geometry. Revisit when the kernel reports patterns or
  instances. Draw calls per body are fine into the low thousands.
- Cost: about 1.5 to 2 days (encoder, decoder, tests).

### 7.3 Picking (fixes R2, R9, R10)

- Primary: a typed-array CPU picker. Project all vertices into
  `Float32Array`s once per camera change, measured at 6 ms for 333k triangles.
  Only do this when a hover actually starts, not while orbiting. Then test
  triangles with a screen bounding-box reject: 0.3 ms per pick. Edges and
  vertices work the same way. Hidden-entity tolerance becomes pixel-based,
  for example 1.5 px expressed in depth. Hidden bodies and the discard side of
  clip planes are rejected explicitly.
- Hover draws in the same animation frame as the pick, which saves about one
  frame of the measured 18 ms.
- Optional later: a WebGL2 ID buffer (MRT or a separate pass: 0.5 to 0.6 ms
  per full frame, 0.1 ms per 13×13 read) if clip, visibility and transparency
  rules become too many to mirror on the CPU. It is not needed for speed.
- The world-space hit point comes from the display triangle and must be
  labeled with the display tolerance. Measurement values always come from the
  referenced B-rep entity (see audit-data.md), never from pixels.
- Cost: about 1 day.

### 7.4 Lighting (fixes R5)

- Hemisphere ambient keyed to world +Z: up-facing faces slightly lighter,
  down-facing faces slightly darker, which also reads naturally next to
  overhang tint. Add one key light fixed in view space, a weak fill, and a low
  Blinn-Phong specular. Lighting in linear space, output in sRGB.
- Two-sided: consistent winding from the server (as `display-export` already
  normalizes) with `gl_FrontFacing` for inside-out cases. No `abs()`.
- Exact per-vertex normals from Bend for cylinders and cones, so curved faces
  are smoothly shaded. Planes keep their exact normal.
- Target: at least 1.3:1 luminance between the principal iso faces and a
  visible depth separation via the outline pass (7.5).
- Cost: shader only, well under 0.1 ms per frame; 4 bytes per vertex; about
  0.5 day.

### 7.5 Edges and silhouettes (fixes R4, R6)

- **Feature edges** from the B-rep polylines as screen-space quads (one
  instanced quad per segment). Width 1.25 to 1.5 CSS px independent of DPR,
  near-black (for example #1d2721), at least 4.5:1 against every face shade
  (pure black: 6 to 10:1). Depth: bias edges toward the camera by about 1 px of
  view-space depth and drop the reliance on `polygonOffset` alone. Coplanar
  edges then draw solid, and edges more than 1 px behind a face stay hidden.
  Cost for 143k segments: 860k vertex invocations, estimated below 0.5 ms on
  this GPU. About 1 day.
- **Seam edges** hidden by default, or drawn faint in an x-ray style, using
  `displayTessellation.seamEdges`. About 0.1 day.
- **Silhouettes**:
  - (a) A screen-space outline pass. WebGL2 MRT writes depth and normal (or
    face id); one full-screen pass marks depth and normal discontinuities.
    This also separates same-normal faces at different depths (5.4).
    Estimated 0.3 to 0.8 ms at 2000×1410; about 1 day.
  - (b) Optional exact-to-tolerance silhouettes: the server emits cylinder and
    cone column generators with the exact normals of the neighboring columns.
    The vertex shader shows a generator where `n·v` changes sign. Positional
    error is at most one column step, which is within the stated display
    tolerance.

  Both are display features and are labeled as such in the view legend.
- **Coplanar bodies**: deterministic per-body depth priority, a tiny extra
  `polygonOffset` by body rank. Overlapping Boolean inputs then show a stable
  winner instead of noise. An explicit "coplanar overlap" hatch is a possible
  diagnostic follow-up.

### 7.6 Per-body color, visibility and transparency (fixes R5)

- Color from `body.appearance` when present. Otherwise a fixed distinct
  palette by body index, labeled in the parts tree as "viewer color" so it is
  never taken for model data. Store it in a small RGBA texture (or uniform
  array) indexed by a per-vertex body index; toggling changes one texel.
- Visibility: alpha 0 in the table, plus a skip in the picker.
- Transparency: an opaque pass, then transparent bodies sorted back to front
  by bounds center with `depthMask(false)`, back faces then front faces. It is
  accepted and documented that intersecting transparent bodies can sort
  wrongly. Also a whole-scene x-ray toggle. No order-independent transparency.
- Cost: about 1 day; per frame about 2× draws for transparent bodies only.

### 7.7 Clipping and section with caps

- Drag: up to three clip planes as uniforms, `discard` on a
  center-relative world-position varying. Runs at full frame rate.
- Caps: the display mesh is **not** guaranteed closed (see the `display-export`
  limits, and boundary-only faces), so stencil caps from the display mesh may
  leak. Use them only for bodies without boundary-only faces, and label them.
  Otherwise show an explicit "cap unavailable" note for that body.
- On release: exact contours from the kernel (`src/section.mjs`). Measured
  10 to 190 ms per r10b body warm (762 ms for the first call, which includes
  module load), so about 0.3 s for the r10b assembly. Draw the exact contour
  polylines as the section outline and fill them with a stencil even-odd
  pass. That needs no nesting classification, which the kernel does not
  provide. If the section fails, show the kernel's failure reason; never fill
  in a guessed cap.
- Cost: about 2 days; about 0.1 ms per frame per plane.

### 7.8 Grid, axes, build plate and view cube

- Build plate: a shader grid at the plate plane (default: the model's minimum
  Z, labeled). Anti-aliased with `fwidth`, 10 mm and 1 mm lines, plate
  outline from a configured printer size. About 0.1 ms per frame.
- Axes: fat-line triad at the world origin plus a small orientation triad.
- View cube: a DOM element with a CSS 3D transform driven by the camera
  rotation matrix. Its faces are real buttons for the presets, so it is
  keyboard accessible and needs no GL. About 0.5 day for all three.

### 7.9 FDM overhang shading

- Shader tint where `n·up < −sin θ`, with θ from vertical, default 45°, shown
  in the legend (same convention as audit-data.md). The up vector is the
  build direction and follows the plate orientation.
- Uses the exact per-vertex normals from 7.4. For curved faces the tinted
  boundary is accurate to one column step; the exact angular band from
  audit-data.md can be drawn as a line when available.
- Must come after the handedness fix, otherwise "down" is still correct but
  the picture is mirrored.
- Cost: under 0.05 ms per frame; about 0.5 day.

### 7.10 Suggested order

1. Camera module (7.1): correctness first, and the tests pin the convention.
2. Binary buffers, eviction and ID-uniform highlight (7.2) together with the
   typed picker (7.3). This removes every measured scaling problem.
3. Edges and outline pass (7.5), lighting and normals (7.4), body colors
   (7.6): the readability package that matches OCP.
4. Grid, axes, view cube and plate (7.8), overhang (7.9), then clipping with
   exact section contours (7.7).

Expected frame budget after steps 1 to 4 on the 8×8 scene: about 1.6 ms fill,
plus 0.5 ms edges, plus up to 0.8 ms outline, plus under 0.2 ms for grid and
overhang, roughly 3 to 3.5 ms. That is still under a third of a 120 Hz frame.

## 8. Reproduce

```sh
# stress inputs (synthetic, rigid translations of real bodies)
node scripts/viewer/make-stress-model.mjs out/acceptance/r10b-retained.brep.json tmp/viewer/audit-rendering/stress-r10b-8x8.brep.json --grid 8x8 --spacing 300
node scripts/viewer/make-stress-model.mjs out/bored-spacer.brep.json tmp/viewer/audit-rendering/far1e5-bored-spacer.brep.json --offset 100000,100000,0
node scripts/viewer/audit-scene-stats.mjs <model.brep.json> ...          # payload sizes, server prep
node scripts/viewer/audit-indexed-size.mjs <model.brep.json> ...         # binary size estimate
node bin/wonky-view.mjs <models...> --port 4347 --reviews tmp/viewer/audit-rendering/reviews &
node scripts/viewer/audit-render-bench.mjs --url http://127.0.0.1:4347/viewer/ --models <sha>,<sha> --out out/viewer/audit-rendering
node scripts/viewer/audit-render-shots.mjs --url http://127.0.0.1:4347/viewer/ --out out/viewer/audit-rendering
node scripts/viewer/audit-pick-prototype.mjs --url http://127.0.0.1:4347/viewer/ --models <sha>,... --out out/viewer/audit-rendering
node scripts/viewer/audit-hover-sweep.mjs http://127.0.0.1:4347/viewer/ r10b=<sha> stress8x8=<sha>
node scripts/viewer/audit-section-timing.mjs out/acceptance/r10b-retained.brep.json
```

The browser scripts import a local `playwright-core` (default
`~/.dev-browser/node_modules`); it is not a project dependency. They need the
Metal flags shown in section 2, because headless Chromium without them has no
WebGL.
