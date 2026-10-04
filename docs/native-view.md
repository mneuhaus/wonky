# Native viewer

`wonky view examples/tea-box.fs` opens the native macOS wgpu/winit viewer.
Use `wonky view fixtures/render/servo-slide-v5.fs --feature jawSlideMount`
for the frozen servo mount. Build the renderer with the normal Rust addon
build (`node scripts/rust/build-node.mjs` through the studio runner).

Drag with the left button to orbit; right/middle-drag or Shift-drag pans.
Scroll zooms. Keys 1/2/3/4 select front/right/top/iso, F fits the model and
Esc closes. `--resolution WxH` sets the initial logical window size (physical
pixels for a headless frame). Resize preserves the camera. Successful reloads also preserve
navigation; F fits the new geometry if needed.

FeatureScript options are `--feature`, repeated `--param name=expression`,
`--modules`, and `--max-steps`. The viewer uses the Rust kernel. It watches
the source, sibling `modules.json` (even when absent), and frozen files listed
by that manifest. It shares the browser viewer's content-hash, parent/direct
file watcher, debounce, polling fallback and atomic-save handling. Evaluation
runs in a warm child process; a superseded build is cancelled and its result cannot
replace a newer revision. A superseded native call is stopped with its child
process, and the browser worker parent-death watchdog prevents orphan builds. Before publishing, the complete watch set is hashed
again to reject mixed source/module revisions. A failed save labels the window
failed and retains the last good geometry until a successful rebuild.

STL and admitted STEP inputs use the existing R0 renderer import path. STL
contains no B-rep edges; the viewer does not invent them. Unsupported STEP
geometry produces the existing named import refusal.

Surfaces and exact B-rep feature edges are **tessellated display geometry at
0.02 mm deviation**, not exact raster curves. The title exposes that tolerance.
Chart seams are excluded by B-rep topology, as in PNG rendering. Construction,
certified bounds, geometry and export implementations are unchanged. PNG and
window presentation share the same GPU buffers, shaders and drawing code.
The projected-bounds camera fit retains R0's stefangolas/look provenance and
licence notices in `render/wonky-render/NOTICE`.

For automation, `wonky view part.fs --headless --view front --resolution 256x192
--out tmp/frame.png` renders one frame through the shared scene and exits.
`--reload-count 1` waits for one additional successful save, renders it and
exits. NDJSON frame events include silhouette bounds and build-to-frame elapsed
milliseconds. Headless mode exits with code 2 on a failed build/import; SIGINT
or SIGTERM stops the watcher, worker and native process. For a window smoke,
`WONKY_VIEW_SMOKE_FRAMES=1 wonky view part.fs` exits after presenting one frame.
The JS browser live server remains available as `wonky-view`.
