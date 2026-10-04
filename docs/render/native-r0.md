# Native headless rendering (R0)

The renderer consumes Wonky's display tessellation and topology-derived B-rep
edge polylines. Rendering is approximate (`exact:false`); the FeatureScript
build and its B-rep remain exact or explicitly refuse. The PNG report states
chord deviation, edge source, bounds provenance and all five stage timings.
Chart seams are excluded by the same opposite-coedge/same-face rule as
Wonky edge queries, independently of mesh angles. The drawn edge count equals
the kernel semantic B-rep edge count.
STL has no B-rep edges: the renderer reports zero edges and does not invent
feature lines from mesh angles.

Build the addon and lockfile-pinned renderer through the host dispatcher:

```sh
node local-development-evidence  "$PWD" -- node scripts/rust/build-node.mjs
```

The standard addon build also builds or verifies the renderer, including on an
addon cache hit. Renderer artifacts live in `tmp/rust/cache/render/<sourceHash>/`
(or under `WONKY_RUST_CACHE`). The key includes source bytes, pinned compiler,
build environment and Cargo configuration; the manifest checks binary integrity
and the embedded source hash. A stale renderer refuses `render/build-stale`.
The build JSON reports renderer `addedBuildMs`, including its subprocess overhead.

The renderer requires a headless Metal or Vulkan adapter. Build/source and
binary hashes are checked before invocation; a missing or stale build refuses.
The renderer crate is outside the geometry workspace to keep GPU dependencies out of modeling.

```sh
WONKY_BACKEND=rust node bin/wonky.mjs examples/tea-box.fs --format png --out out/tea --json
node bin/wonky.mjs render out/tea.stl --out out/tea-stl --json
node bin/wonky.mjs render fixtures/step-import/tetra-si.step --out out/tetra --json
```

Both paths accept `--views front,right,top,iso`, `--atlas 2`,
`--resolution 512x512`, and `--camera orthographic|perspective`.
Silhouette pixel bounds use exclusive upper coordinates, like image crop boxes.
Resolution is per tile. View order determines row-major atlas order. Coordinates
are millimetres, Z up; front looks along +Y, right along -X, top along -Z.
A neutral technical material, transparent neutral background, depth-tested
feature lines, one atlas pass, and one readback produce deterministic PNGs on
the same GPU/backend and renderer build. Cross-device identical pixels are
not guaranteed. Timings are wall durations including synchronization.

STEP goes through `wonky_geom::import::ImportDraft`, including exact admission,
then Wonky's own planar triangulator. R0 supports admitted straight-edge planar
models. Unsupported carriers/import entities retain a named refusal. No OCCT,
Truck or other external geometry kernel constructs or imports the render input.
The reference importer introduced in I1 is not a substitute for admitted geometry
and cannot yet supply R0 rendering. No interactive viewer is included.

Structural checks live in the Rust crate and `test/native-render.test.mjs`:
actual PNG occupancy, independent orthographic projected bounds within one
pixel, B-rep edge count, repeated bytes, perspective scale framing, own STEP
import and malformed input. Run native tests from the pinned crate directory:

```sh
node local-development-evidence  "$PWD" -- sh -c 'cd render/wonky-render && cargo test --release --locked'
```

The same silhouette test with `--features plant-fixed-distance` must fail.
The mutation is test-only; `build-render.mjs` accepts no feature options.
Before running the JS lane, build both native artifacts. Visual comparisons
are display checks, never evidence of geometry validity. Upstream camera
attribution and retained licenses are in `render/wonky-render/NOTICE`.
