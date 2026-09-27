# Viewer parity and prior-art audit

Input for the viewer rework spec, written 2026-09-22. It compares wonky's
review viewer with the OCP CAD Viewer that Marc uses every day, with Onshape
and Fusion 360, with Zoo Design Studio and with slicers (Bambu Studio,
OrcaSlicer). It proposes priorities. Nothing in this file is implemented yet.

Priority legend used throughout:

| Priority | Meaning |
|---|---|
| **P0** | Needed before wonky beats Marc's OCP loop for daily use. Belongs in the first rework. |
| **P1** | Parity Marc uses regularly. Next increment. |
| **P2** | wonky-specific strengths or larger parity items. After P1. |
| **P3** | Not now, or deliberately not adopted (reason given). |
| **Keep** | wonky already does this well; the rework must not lose it. |

## 1. What was studied, and how

- **OCP CAD Viewer as Marc runs it**: `ocp_vscode` 3.3.4 standalone, the
  same version installed in `~/Workspace/cad/cad-khana/.venv`. It bundles
  `three-cad-viewer` 4.3.7. I ran it on port 3947 with
  `uv run --no-project --python 3.13 --with ocp_vscode==3.3.4 --with build123d python -m ocp_vscode --port 3947`
  and pushed a three-part build123d assembly
  (`tmp/viewer/ocp/demo_part.py`). Port 3939 was not touched. All
  screenshots are in `out/viewer/parity/` and described in
  `out/viewer/parity/manifest.json`.
- **Upstream source**: `three-cad-viewer` master (5.0.7, commit `ca28537`,
  2026-09-17) and `vscode-ocp-cad-viewer` master (4.0.1, commit `61d29c0`,
  2026-09-15), cloned to `tmp/viewer/ocp/`. Where 5.x differs from Marc's
  4.3.7, both are noted.
- **Marc's loop**: cad-khana README, CLAUDE.md, `viewer.py`,
  `printability/overhangs.py`; the project `watch.py` files; the
  `cad-fdm-design` skill (review loop through selection indices and
  `khana pick`).
- **Onshape**: help pages for shortcut keys, camera and render options,
  Compare. **Fusion 360**: navigation presets, measure and visibility
  shortcuts, ViewCube. **Zoo Design Studio**: `KittyCAD/modeling-app`
  source (settings defaults, camera presets, cube gizmo, hover-to-code
  highlight). **OrcaSlicer**: source (shortcut table, camera defaults,
  overhang highlight, support threshold). Bambu Studio: public docs.
- **wonky today**: `viewer/app.js`, `viewer/index.html`,
  `src/review-scene.mjs`, `src/review-server.mjs`, `docs/viewer-ui.md`. I
  ran my own instance on port 4386 with `out/bracket.brep.json` and
  `out/bored-spacer.brep.json`.

## 2. The bar to beat: Marc's OCP loop, as observed

1. **Rebuild**: each project's `watch.py` polls the mtimes of `*.py` in the
   project directory every 5 s, rebuilds synchronously with
   `runpy.run_path`, then calls `show(*parts, names=…, colors=…)`. After a
   save, the model appears up to about 5 s plus build time later. Imports
   outside the project directory are not watched.
2. **Push without state**: the standalone viewer relays pushes to the open
   tab but keeps no model. A reloaded tab shows the OCP logo until the next
   push (`ocp-10-reload-loses-model.png`). `watch.py` therefore re-pushes the
   cached assembly every 5 s as a keep-alive.
3. **Camera**: the standalone default is `reset_camera=KEEP`. A re-push
   keeps the view (`ocp-09-repush-keeps-camera.png`). Only the first push
   after the splash screen resets it.
4. **Failure**: the watcher prints a traceback in the terminal. The browser
   keeps the previous model without any stale marker, error, or busy state.
   Nothing shows that the model on screen belongs to older source.
5. **Look**: named, colored parts (default `#e8b024`), a tree with separate
   eye toggles for faces and edges, orthographic camera, trackball
   ("Holroyd") rotation, grey `#808080` edges (black with `b`), grid and
   axes off by default (`ocp-01-default.png`, `ocp-02-…`).
6. **Review**: Marc turns on the select tool, filters faces, edges or
   vertices (`f`/`e`/`v`), clicks entities and quotes the part name and
   indices. The agent resolves them with `khana pick`, which answers
   "coplanar? parallel? offset? angle? radius?". Indices are valid only for
   one push.
7. **Measurement**: the properties and distance tools send shape IDs to a
   Python backend that evaluates OCCT exactly: `BRepExtrema` minimum
   distance with both closest points and XYZ deltas, plus the angle between
   normals or tangents at those points. Properties include centre, radius,
   area, "angle to XY" and bounding box (`ocp-05-…`, `ocp-06-…`). Two
   quirks are visible. A cylinder's "center" is its axis origin (0, 15, 22),
   not the face centre. "Angle to XY" of a curved face is evaluated at one
   UV midpoint only. three-cad-viewer 5.x adds a mesh-based measurement
   backend with approximate ("≈") values for use without Python.
8. **Tessellation**: the defaults are deviation 0.1 and angular tolerance
   0.2 rad. The UI never shows the display tolerance.

The OCP loop is good at *looking*: colors, a parts tree, clipping,
transparency, crisp edges and a kept camera. It is weak at *trust*: no stale
or busy state, no error in the viewer, no memory across reloads, no
comparison between revisions, indices that die on every push, and measurement
values that are unlabelled when they come from the mesh backend.

## 3. Feature matrix

Abbreviations: **tcv** is three-cad-viewer. "Onshape/Fusion" also carries
Zoo and slicer notes where they are the relevant prior art. "n/a" means not
audited or not applicable.

### 3.1 Live loop and data flow

| Feature | OCP viewer | Onshape / Fusion (+ Zoo, slicers) | wonky today | Priority and rationale |
|---|---|---|---|---|
| Rebuild on save | Only through the user's `watch.py` (5 s poll, project `*.py` only) or VS Code Run | Interactive regeneration; Zoo re-executes KCL on edit | None. "Refresh workspace" re-reads `.brep.json` files that were built elsewhere | **P0**. This is the core gap. Watch the source and every resolved import, debounce, and do not use a polling delay. |
| Push to the open browser | WebSocket push | n/a (single app) | None | **P0**. Server-Sent Events from `node:http` are enough: one-way, native `EventSource`, no dependency. |
| Reload keeps the model | No (logo until the next push) | Yes | Yes (server-held immutable snapshots) | **Keep**. This is a real advantage over OCP. |
| Camera kept on a new revision | Yes (`KEEP`) | Yes | No. Every model change calls `loadSelectedModels(resetCamera = true)` | **P0**. |
| Busy state; cancel superseded builds | None | Onshape shows regeneration progress | None | **P0**. Keep revision N visible and labelled while N+1 builds; kill the superseded build process. |
| Failure with source location | Terminal traceback only; the stale model stays unmarked | Onshape marks the failing feature red with its message; Zoo shows diagnostics in the editor | Capability errors reach the CLI; the viewer only reports load errors | **P0**. Show a banner and a "stale" badge on the retained model, with `file:line:col` from the interpreter. Keep capability errors visually distinct from syntax errors. |
| Never show an incomplete model as complete | Shows whatever `show()` received | Onshape shows geometry up to the failed feature, marked as such | The viewport note counts faces shown only as boundaries; diagnostic models are labelled | **P0**. Extend this to the live loop with explicit states: "current", "last good (source newer)", "partial". |

### 3.2 Structure and visibility

| Feature | OCP viewer | Onshape / Fusion (+ Zoo, slicers) | wonky today | Priority and rationale |
|---|---|---|---|---|
| Parts/bodies tree | Nested tree, eye toggles for faces and edges separately, color dots, collapse keys `1 R C E` | Onshape parts list and assembly tree; Fusion browser | The inspector lists bodies; no visibility control | **P0**. Marc relies on it daily. One row per body, grouped by source part or operation where known. |
| Per-part colors | From `colors=` / `part.color`, default `#e8b024` | Part appearances | One sage color for everything | **P1**. Use a source-declared appearance when the frontend provides one; otherwise a deterministic palette labelled as a display color. |
| Hide, show all, isolate | Meta-double-click hides (with undo), Shift-double-click isolates, tree clicks | Onshape `Y` / `Shift+Y` / `Shift+I`; Fusion `V` | None | **P1**. |
| Explode | `x`, slider | Fusion explode in animation | None | **P3**. Marc's parts are mostly single bodies; assemblies come later. |
| Construction history | None (the VS Code debugger can show locals per step) | Onshape feature list with rollback bar; Fusion timeline; Zoo feature tree | Per-body operation, "Earlier body operations" and source call in the inspector | **P2**. A history rail built from the recorded operation trace, with jump-to-source. Rollback previews only if the interpreter can evaluate a prefix (open question). |

### 3.3 Camera and orientation

| Feature | OCP viewer | Onshape / Fusion (+ Zoo, slicers) | wonky today | Priority and rationale |
|---|---|---|---|---|
| Rotation model | Trackball (Holroyd) by default, orbit optional; Ctrl/Meta lock one axis | Onshape free rotate; Fusion free or constrained orbit; Zoo `spherical` by default; Orca constrained (`use_free_camera=false`) | Z-up turntable (yaw about world Z, then pitch); pitch is not clamped | **Keep** the Z-up turntable, because Z is the print direction; **P1**: clamp pitch to ±90°. Trackball as an option is **P3**. |
| Zoom target | Camera target (not the cursor) | Onshape, Fusion, Zoo and Orca zoom toward the cursor | Viewport centre, 0.05–25× | **P1**. Zoom toward the cursor. It is cheap and it is what every CAD tool except OCP does. |
| Orthographic / perspective | Ortho by default, `p` toggles | Onshape ortho by default; Fusion offers ortho, perspective, and perspective with ortho faces; Zoo ortho by default; Orca perspective by default | Orthographic only | **P1**. Keep ortho as the default. Annotations must record the projection, and the existing "view no longer matches" hiding has to cover a projection change. |
| Standard views | Seven buttons plus keys `5 1 3 8 2 4 6` (numpad layout) | Onshape `Shift+1…7`; Orca `Ctrl+0…7` | One button cycles iso → front → top → "side" | **P0**. Cheap. Seven explicit views; see §5. |
| Orientation gizmo | Non-interactive XYZ triad at bottom left | Clickable view cube in Onshape, Fusion and Zoo (Zoo: `cube` gizmo by default, faces and edges clickable, plus a view menu) | None | Axis triad **P0** (orientation is currently unreadable). Clickable cube **P1**. |
| Fit | `r` resize, `R` reset | Onshape `F` fit; Fusion `F6` or double-click the middle button | `F` resets to the default iso and zoom 1, so it loses the orientation | **P1**. `F` fits and keeps the orientation; `Shift+F` fits the selection; a separate key restores the default view. |
| Set orbit pivot | Shift+Meta+double-click sets the camera target | Fusion Shift+click+middle-drag orbits around a point | Always the bounding-box centre | **P2**. Orbit around the exact picked point. |
| Normal to face | n/a (the clip tab can set a plane normal from the camera) | Onshape `N` (again: flip) | None | **P2**. Exact: it only needs the plane normal of a planar face. |
| Trackpad | Pinch zoom, two-finger pan (three.js controls) | Onshape and Zoo offer trackpad presets; Fusion gestures | Every wheel event zooms, so a two-finger scroll zooms | **P1**. Pinch (wheel with `ctrlKey`) zooms; an optional trackpad mode lets two-finger scroll pan. |

### 3.4 Display

| Feature | OCP viewer | Onshape / Fusion (+ Zoo, slicers) | wonky today | Priority and rationale |
|---|---|---|---|---|
| Crisp edges | Screen-space fat lines (`LineMaterial`), grey `#808080`, black with `b`; draws all B-rep edges including seams and tangent edges (`ocp-03-…`) | Onshape black edges by default; tangent edges visible, phantom or removed; seams not drawn; Zoo `highlightEdges` on by default | 1 px `gl.LINES` in `#526E52` on `#A6C2A8` shading: nearly invisible (`wonky-04-…`). Periodic seams are drawn like real edges. Faces whose display edges fail are shown only as boundaries. | **P0**. Dark 1.5–2 px edges drawn as instanced screen-space quads (WebGL1 line width is capped at 1 px). Classify edges from exact data: sharp, tangent (lighter), seam (hidden by default, still selectable). Unresolved classification is drawn as sharp. |
| Smooth shading | Vertex normals from the OCCT mesh | Smooth | Flat per-triangle normals; cylinder facets are visible (`wonky-02-…`) | **P1**. Evaluate exact surface normals in Bend at the display vertices. The result is smooth and still honest. |
| Silhouette edges | None (B-rep edges only) | Onshape and Fusion draw silhouettes of curved faces | None | **P2**. Display-only, labelled as such. |
| Transparency | `t` sets 50 % opacity for everything and shows hidden edges (`ocp-03-…`) | Onshape `Shift+T`, per-part translucency | None | **P1**. Global and per body, from the tree. |
| Axes and grid | Axes at the bbox centre or at the origin; XY/XZ/YZ grids with labelled ticks and a scale bar | Onshape origin and planes (`P`); Zoo `showScaleGrid` off by default | None | **P1**. Replace the three-plane grid with the build plate below (one grid, one meaning). Origin axes **P0** together with the triad. |
| Build plate | None | Slicers model the bed | None | **P1**. See §8. Configurable size (for example 256 × 256 mm for the Bambu A1 in Marc's notes); state when the model floats above or cuts through the plate. |
| Overhang shading | None (properties show "angle to XY" for one face) | Orca/Bambu "Show overhang" and "Highlight overhangs" (threshold defaults to the support threshold angle, 30° from horizontal); Fusion Draft Analysis | None | **P1**. From exact normals, with the threshold and its convention stated. See §8. |
| Section / clipping | Three clip planes (initial normals −X, −Y, −Z), sliders, "normal from camera", intersection mode, plane helpers, stencil caps in object colors (`ocp-04-…`) | Onshape `Shift+X` section by plane or face, several planes, capped; Fusion Section Analysis with hatched caps | None | **P1** display clipping (shader clip plane plus stencil cap), labelled "display section". **P2** exact section contours from `kernel/section.bend` for supported planar/cylindrical solids, with a capability error otherwise. |
| Lighting, theme, PBR | Material sliders, "Studio" PBR tab with shadows and AO, light/dark/browser theme | Fusion visual styles; Zoo SSAO on by default | One headlight term, light theme only | **P3** for PBR, zebra and material editors. **P2** for a dark theme and mild ambient occlusion if contrast needs it. |
| Display tolerance label | Not shown | Not shown | Default 0.02 mm, not shown in the UI | **P0**. The project rules require it: show "display mesh ±0.02 mm" in the viewport footer. |

### 3.5 Selection and measurement

| Feature | OCP viewer | Onshape / Fusion (+ Zoo, slicers) | wonky today | Priority and rationale |
|---|---|---|---|---|
| Pick face, edge, vertex, body | 4.x: double-click; single click inside tools; topology filter (4.x `n s f e v`, 5.x `a v e f s`); 5.x GPU id-buffer picking with vertex > edge > face priority | Click; box select; selection filter | Click with hover preview; filter Auto/Faces/Edges/Points/Bodies; depth order; vertex > edge > face; "Browse geometry" reaches hidden entities | **Keep**. Already equal or better. |
| Multi-select | Two picks in the distance tool | Shift/Ctrl-click everywhere | One selection | **P0**. Shift- or ⌘-click to add. Measurement and batch references depend on it. |
| Hover status | 5.x status line with geometry type and mesh-estimated values ("r ≈ …, c ≈ …") | Onshape highlights on hover | Highlight only | **P1**. Show the exact type and key parameter on hover, for example "Cylinder r = 5 mm (exact)". |
| Single-entity properties | Exact OCCT values: centre, radius, area, angle to XY, bbox (`ocp-05-…`) | Onshape shows passive measurements for the current selection; Fusion Measure (`I`) | Surface or curve type and edge count only. Radius, axis and origin are exact in `/api/models/<sha>/entities/B1.F4` but not shown (`wonky-03-…`) | **P0**. Show the exact parameters that already exist. |
| Two-entity distance and angle | `BRepExtrema` minimum distance, closest points, XYZ deltas, center mode with Shift, normal/tangent angle | Onshape min/centre distance and angle for the selection; Fusion Measure with snap points; `khana pick` coplanar/parallel/offset | None; the docs state that selection is not a distance measurement | **P0** for the analytic closed forms in §7. **P2** for general trimmed min distance, which needs kernel extrema; until then raise a capability error, never fall back to the mesh silently. |
| Copy references | Select tool copies shape IDs (4.x `S`, 5.x `I`), valid for one push | n/a | "Copy reference": model hash, `B1.F2`, identity, lineage, source; "Copy selected geometry"; LLM context | **Keep**, and **P1**: copy a whole multi-selection at once. |
| Mass properties | Volume and centre of mass per solid (exact) | Onshape and Fusion mass properties | Recorded Bend validation volume with its scope string | **Keep**; **P2** for area and centroid computed in Bend. |

### 3.6 Compare and diff

| Feature | OCP viewer | Onshape / Fusion (+ Zoo, slicers) | wonky today | Priority and rationale |
|---|---|---|---|---|
| Default mode | One model; each push replaces the last | One model | Compare first: a wipe against a "before" model even with unrelated models (`wonky-01-default.png`) | **P0**. One model by default; compare on request or automatically against the previous live revision. |
| Visual comparison | None | Onshape Compare: base blue, target red, a blend slider and a feature-list diff (identical, changed, added, moved) | Wipe and side by side with a linked camera and shared bounds | **Keep** wipe and side by side. **P1**: add a ghost overlay of the previous revision (Onshape-style blend). |
| Numeric deltas | None (`khana diff` compares diagnostics JSON in the terminal) | n/a | Pixel diffs in standardized render reports | **P1**. Volume, bounding box, and body/face/edge counts, each with its source (recorded Bend value or count). |
| Geometric diff highlight | None | Onshape colors the difference | None | **P2**. Only where identity or exact geometry supports it. Boolean results have unresolved split/merge correspondence today; say so instead of inventing face-level matches. |

### 3.7 Source, review and LLM

| Feature | OCP viewer | Onshape / Fusion (+ Zoo, slicers) | wonky today | Priority and rationale |
|---|---|---|---|---|
| Geometry → source | None | Onshape: feature ↔ geometry; Zoo: hovering geometry highlights the KCL code range (artifact graph) | File, SHA-256, call line, call chain and parameters in the inspector; "Open frozen source" | **Keep**. **P1**: open the live file at the call line in the editor. |
| Source → geometry | None | Zoo: code ↔ geometry both ways | None | **P1**. Clicking a source line highlights the bodies produced by that call. Face-level origin stays "unresolved" where the Boolean correspondence is unresolved. |
| Annotations and saved reviews | None | Onshape comments on parts and features | Comment, arrow, rectangle, freehand; restorable camera and layout; `reviews/` JSON, Markdown and LLM context | **Keep**. Unique among the tools studied. |
| LLM context | None (khana diagnostics and `khana draw` PNGs are separate) | n/a | "Copy LLM context", `wonky-inspect`, revision-bound aliases | **Keep**; **P1**: a per-revision change summary for the agent. |
| Screenshot export | `save_screenshot()` from Python | Image export | Standardized render reports | **P2**. "Save view as PNG" with model hash, camera and display tolerance in the metadata. |
| Checks in the viewer | None (khana diagnostics are read in the terminal) | Onshape feature errors | Checks tab with reports | **Keep**; **P1**: attach checks to each live revision. |

### 3.8 Robustness and performance

| Feature | OCP viewer | Onshape / Fusion (+ Zoo, slicers) | wonky today | Priority and rationale |
|---|---|---|---|---|
| Picking cost | 5.x: GPU id buffer, re-rendered only when the view changes | n/a | CPU: projects every edge on each hover frame | **P2**. Fine for current model sizes; revisit with the r10b-size models. |
| Incremental updates | 5.x `updatePart` rewrites GPU buffers in place when the topology is unchanged | n/a | Rebuilds all buffers for each model | **P2**. Swapping whole revisions is fine at current sizes. |
| Dependencies | three.js bundle (3.4 MB ESM) | n/a | Plain WebGL, no dependencies | **Keep**. Every proposal in this file works without new npm dependencies: SSE, `fs.watch`, `child_process`, instanced quads for edges, shader clip planes, and an SVG/CSS view cube. |

## 4. Priority summary

**P0, first rework**

1. Live loop: watch the source and imports, rebuild without blocking the UI,
   cancel superseded builds, push with SSE, keep the camera, and show
   busy, stale, failure and partial states with the source location.
2. One model by default; compare only on request or against the previous
   live revision.
3. Bodies tree with visibility.
4. Readable edges: dark screen-space lines, seams hidden, tangent edges
   lighter.
5. Axis triad and origin axes; seven standard views by key and button.
6. Multi-select, the exact parameters of the selected entity, and exact
   two-entity relations (§7).
7. Display tolerance shown in the viewport.

**P1**: zoom to cursor, fit that keeps the orientation, pitch clamp,
perspective toggle, clickable view cube, trackpad handling, per-body
colors, transparency, hide/show/isolate, build plate with overhang shading,
display section, smooth exact normals, hover status line, previous-revision
ghost, numeric deltas, source → geometry, open in the editor, batch
reference copy, checks per revision.

**P2**: exact section contours, general trimmed min distance through Bend,
history rail, orbit pivot, normal-to-face, silhouettes, geometric diff
highlight, PNG export with metadata, GPU picking, area and centroid.

**P3 (deliberately not adopted now)**: PBR Studio mode, zebra, material
sliders, explode and animation (they do not serve the FDM review loop);
trackball as the default (it tilts Z away from the print direction; see
`ocp-09-…`); OCP's double-click-to-pick (wonky's single click with hover
preview matches Onshape and Fusion and is already tested); the three-plane
grid (one build plate says more).

## 5. Mouse and keyboard conventions

### 5.1 Mouse

| Action | wonky today | OCP (tcv) | Onshape | Fusion | Zoo (default "Zoo") | OrcaSlicer | Proposal |
|---|---|---|---|---|---|---|---|
| Orbit | Left-drag (select tool); Alt-drag in markup tools; arrow keys | Left-drag; Ctrl/Meta lock one axis | Right-drag | Shift+middle-drag | Right-drag | Left-drag | **Keep** left-drag. It matches OCP and the slicer, Marc's two daily viewers. |
| Pan | Shift+left-drag, middle-drag, right-drag | Shift+left-drag or right-drag | Middle-drag, Ctrl+right-drag | Middle-drag | Shift+right-drag or middle-drag | Right-drag or middle-drag | **Keep**. |
| Zoom | Wheel, about the viewport centre | Wheel or middle-drag, about the target | Wheel, toward the cursor | Wheel, toward the cursor | Wheel, Ctrl+right-drag | Wheel, toward the cursor | Wheel **toward the cursor**; pinch zooms (P1). |
| Select | Click, with hover preview | Double-click (4.x); click inside tools | Click; drag = box select | Click | Click | Click | **Keep** click; add Shift/⌘-click (P0). |
| Right click without drag | Suppressed | Removes the last selection in measure mode | Context menu | Marking menu | n/a | Context menu | Entity context menu: copy reference, isolate, hide, comment, show source (P2). |
| Double-click | None | Identify; Shift isolate; Meta hide; Shift+Meta set target | n/a | n/a | n/a | n/a | Set the orbit pivot at the exact hit point (P2). |
| Presets | None | Modifier remapping only | SolidWorks, NX, Creo, AutoCAD presets | Fusion, Alias, Inventor, SolidWorks presets | Zoo, OnShape, Trackpad friendly, SolidWorks, NX, Creo, AutoCAD | Configurable per button | Onshape and trackpad presets later (P3). Zoo shows that a preset table is cheap. |

### 5.2 Keyboard: conflicts and proposal

wonky keys today: `V` select, `H` orbit tool, `C` comment, `A` arrow,
`R` rectangle, `P` pen, `F` fit (actually "reset view"), `E` edges, arrow
keys orbit 0.12 rad (about 6.9°) while the viewport has focus, `⌘S` save,
`⌘Z` remove the last annotation, `Escape` cancel. They are matched
case-insensitively through `event.key.toLowerCase()`.

OCP defaults (tcv 4.3.7, Marc's version) are case-sensitive: `a` axes,
`A` axes at origin, `g` grid, `G` XY grid, `p` perspective, `t`
transparent, `b` black edges, `R` reset, `r` resize (fit), `5 1 3 8 2 4 6`
iso/front/rear/top/bottom/left/right, `x` explode, `D` distance,
`P` properties, `S` select tool, `h` help, `T C M Z s` tabs, Space play,
Escape stop. tcv 5.x moves axes to `A`, axes at origin to `0`, studio to
`S`, select to `I`, and uses `a v e f s` as topology filters.

| Key | wonky today | OCP 4.3.7 | tcv 5.x | Onshape | Proposal |
|---|---|---|---|---|---|
| `1 3 4 6 8 2 5` | – | Views (numpad layout) | Same | `Shift+1…7` = front, back, left, right, top, bottom, iso | **Adopt the OCP layout**: 1 front, 3 back, 4 left, 6 right, 8 top, 2 bottom, 5 iso. Also accept Onshape's `Shift+1…7`. Match on `event.code` (`Digit*`, `Numpad*`) so the number row, the numpad and Shift combinations work on QWERTZ. Do not copy Orca's `Ctrl+0…7` (different order). |
| `F` | Reset to default iso | tcv 5: face filter | same | Fit | `F` fits and **keeps** the orientation; `Shift+F` fits the selection; `0` or Home restores the default view (today's `F` behaviour moves there). |
| `E` | Edges toggle | tcv 5: edge filter | same | – | **Keep**. |
| `V` | Select tool | tcv 5: vertex filter | same | – (Fusion `V` = visibility) | **Keep**. |
| `T` | – | Transparent | Transparent | `Shift+T` transparency | **Adopt** `T`. |
| `G` | – | Grid | Grid | – | **Adopt** `G` for plate plus grid. |
| `X` | – | Explode | Explode | `Shift+X` section | **Adopt** `X` for section (wonky has no explode). |
| `O` | – | – | – | – | Ortho/perspective toggle. OCP uses `p`, which is the wonky pen. |
| `N` | – | – | – | Normal to face; again: flip | **Adopt** (P2). |
| `Y`, `Shift+Y`, `I` | – | – | `I` copy IDs | `Y` hide, `Shift+Y` show all, `Shift+I` isolate | **Adopt** `Y` / `Shift+Y`; `I` isolate. |
| `?` | – | (`h` help) | (`h`) | – | Help overlay listing every binding. Orca also uses `?`. |
| `A`, `P`, `R`, `C`, `H` | Arrow, pen, rectangle, comment, orbit tool | `a` axes, `p` perspective, `r` fit / `R` reset, `C` clip tab, `h` help | `A` axes, `P` properties, `C` clip | – | **Keep the wonky meanings** (documented and tested). Axes are folded into `G`, perspective moves to `O`, clip moves to `X`, help to `?`. Risk: OCP muscle memory `p` turns on the pen, and the next drag draws instead of orbiting. Mitigation for the spec to decide: markup tools show a clear cursor and toast and return to Select after one annotation. |
| Arrow keys | 0.12 rad orbit | – | – | 15° steps, Ctrl 5°, Shift 90°, Ctrl+Shift pan | **Adopt Onshape's step sizes** (P1). |
| `Escape` | Cancel gesture, clear selection, close report, Select tool | Clear selection; stop animation | same | – | **Keep**. |
| `⌘S`, `⌘Z` | Save review, remove last annotation | – | – | Undo | **Keep**. |
| Space | – | Play animation | same | – | Leave unassigned. |

Keyboard layout: Marc most likely types on a German layout. `?` is `Shift+ß`, `[` (the
Onshape measure dialog) is `Alt+5` on a German Mac, and `Y`/`Z` are swapped.
Letters should keep matching on `event.key`, so the mnemonic follows the
printed keycap, and digits should match on `event.code`. Avoid bracket and
slash keys.

## 6. Where wonky should deliberately differ

These follow from the project rules and from what OCP lacks. They are
design commitments, not missing parity.

1. **Exact measurement, labelled.** Every value states its class: *exact*
   (from analytic B-rep parameters, with the kernel tolerance), *recorded*
   (a value Bend stored, such as the validation volume, with its scope
   string) or *display* (derived from the display mesh, with ±tolerance,
   only when explicitly requested). Unsupported pairs raise a visible
   capability error rather than falling back to the mesh. The
   counter-example is OCP 5.x's mesh backend, which is marked only by "≈" in
   the hover status line. Answer Marc's real review
   questions directly: coplanar, parallel, offset, concentric, angle,
   radius.
2. **References that survive a rebuild when they can.** OCP indices die
   with every push. wonky references carry the model hash, alias, identity
   and lineage. On a new live revision the viewer carries a selection or
   annotation forward only when the recorded identity supports it, and it
   says "lost" or "ambiguous" otherwise. It never guesses by index.
3. **Source linking both ways, honestly scoped.** Geometry → call line
   already exists. Add source line → geometry and "open in editor".
   Face-level origin inside a Boolean stays "unresolved" until the kernel
   records the correspondence.
4. **Diffs as a first-class view.** Each live revision is compared with its
   predecessor: numeric deltas, an optional ghost overlay, and highlights
   only where exact data supports them. OCP silently replaces the model;
   Onshape needs an explicit Compare.
5. **Explicit trust states.** "Building", "current", "last good (source
   newer)", "partial", "failed at file:line". A model on screen always says
   which source revision it belongs to. OCP shows none of these.
6. **Reviews and LLM context.** Annotations, saved reviews, context packets
   and `wonky-inspect` stay. In the live loop the agent gets the same
   revision-bound data Marc sees: a change summary per revision and batch
   references from multi-selection. This replaces the fragile
   "quote indices, then run `khana pick`" step.
7. **Display honesty.** Show the display tolerance, count faces shown only
   as boundaries, hide seams because they are not physical edges, and
   state the overhang threshold and its convention. OCP shows none of this.
8. **Reload-safe and local.** Server-held immutable snapshots survive a
   browser reload, unlike OCP standalone. Zoo renders and evaluates in its
   cloud engine and streams the result; wonky runs locally with no CDN.

## 7. Exact measurement scope

What can be exact from data the B-rep already stores (plane origin and
normal, cylinder and cone axis, origin and radius, line endpoints, circle
and ellipse parameters, vertex points):

| Selection | Exact result | Notes |
|---|---|---|
| Vertex, vertex | Distance, ΔX, ΔY, ΔZ | – |
| Planar face | Origin, normal; "overhang angle" relative to the print direction | Constant over the face. |
| Planar face, planar face | Angle between the normals; if parallel, the offset; coplanar flag | Refers to the unbounded planes; label it so. The tolerance comes from the model record. |
| Line edge | Endpoints, length, direction | – |
| Line edge, line edge | Angle; distance if parallel; skew distance of the infinite lines | Say "infinite lines" when the closest points fall outside the segments. |
| Circle edge, cylinder face | Radius, diameter, centre or axis | For a cylinder, report the axis, not OCP's axis origin as a "centre". |
| Cylinder or circle, cylinder or circle | Axis angle, axis distance, coaxial/concentric flags, centre distance | – |
| Plane, cylinder or circle | Angle between axis and normal; axis-to-plane distance when parallel (for example hole height above the plate) | – |
| Vertex, plane | Signed distance to the plane | Not to the trimmed face; label it. |
| Body | Recorded Bend volume and bounds with their scope | Already stored. |
| Trimmed face or edge, anything (general minimum distance) | Needs kernel extrema | **Capability error** until Bend provides it. A display estimate is allowed only on explicit request, labelled "display mesh ±2 × tolerance". |
| Face area, ellipse arc length | Needs Bend | P2. Line length and circle arc length are closed forms. |

The formulas should live in Bend or a tested server module, never in
browser code that reads display points. Each result should carry
`{class, method, inputs: [alias@modelId…], tolerance}` so that it can be
copied into LLM context unchanged.

## 8. FDM awareness: plate and overhang conventions

- **Two conventions exist.** cad-khana measures the overhang angle from
  vertical: `α = asin(max(0, −n·u))`, where `u` is the print-up axis. It
  flags `α > 45°` by default, strictly greater with 1e-6 slack, so a 45°
  chamfer passes. It excludes faces on the build plate and self-supporting
  small bores and short bridges. OrcaSlicer and Bambu Studio use a
  "threshold angle" `β` measured from horizontal: support is generated
  where the slope is below `β`, default 30°. Orca's highlight colors
  triangles with `n_z < −cos β`. The mapping is `β = 90° − α`: khana's 45°
  equals slicer 45°, and Orca's default 30° equals khana `α > 60°`.
- **Proposal.** Default to khana's convention, because it is Marc's
  checker, and always show the slicer-equivalent value next to it, for
  example "overhang > 45° from vertical (slicer threshold angle 45°)". Make
  the up axis explicit (default +Z).
- **Exactness.** A planar face's classification is exact. On cylinders and
  cones the overhang region is an exact angular sub-range around the axis,
  but the drawn boundary follows the display mesh. Label curved-face
  shading "sampled at display vertices, ±0.02 mm". Say which exclusions are
  applied (plate faces yes; khana's bore and bridge exemptions only if
  implemented).
- **Plate.** Draw it at Z = 0 with a configurable size. If the model's
  minimum Z is not 0, say so ("floats 3.2 mm above the plate" or "cuts
  0.4 mm into the plate") instead of silently moving the model.

## 9. Open questions for the spec stage

1. Which process owns rebuilds: `wonky-view` spawning `bin/wonky.mjs` and
   `bin/wonky-python.mjs` as child processes (easy cancellation and crash
   isolation), or in-process builds?
2. How are imports resolved for watching? FeatureScript imports and
   project-local Python modules need a dependency list from the frontend,
   not a directory glob.
3. Can the interpreter evaluate a prefix of the operation trace, which a
   rollback preview in the history rail would need, or is `maxSteps` only
   a budget?
4. Should markup tools become one-shot (return to Select after one
   annotation) to defuse the `p`/`a`/`r` muscle-memory conflicts?
5. Where does exact measurement live: new Bend functions (kernel paths are
   outside the viewer's writable set) or a server module with documented
   formulas and tests?
6. Should toggling compare or layout still mark a saved review as having
   "Unsaved changes"? It does today, which is noisy in a live loop.

## 10. Evidence

Screenshots in `out/viewer/parity/`, described in `manifest.json` there:
`ocp-01` … `ocp-10` for the OCP viewer (default, axes/grid/black edges,
transparency, clip, properties, distance, help, perspective, re-push keeps
the camera, reload loses the model) and `wonky-01` … `wonky-04` for
wonky's current viewer (compare-first default with unrelated models, single
model, face inspector without radius, low-contrast edges).

Sources:

- three-cad-viewer: <https://github.com/bernhard-42/three-cad-viewer>
  (Readme, Design.md, `src/`)
- OCP CAD Viewer: <https://github.com/bernhard-42/vscode-ocp-cad-viewer>,
  docs at <https://bernhard-42.github.io/ocp_viewer_docs/>
- Onshape shortcut keys: <https://cad.onshape.com/help/Content/shortcut_keys.htm>
- Onshape camera and render options:
  <https://cad.onshape.com/help/Content/View/camera_and_render_options.htm>
- Onshape Compare: <https://www.onshape.com/en/resource-center/tech-tips/tech-tip-comparing-design-changes>
- Onshape view manipulation presets:
  <https://www.onshape.com/en/resource-center/tech-tips/tech-tip-changing-rotate-pan-and-zoom>
- Fusion pan, zoom and orbit presets:
  <https://www.autodesk.com/products/fusion-360/blog/quick-tip-pan-zoom-orbit-preferences/>
- Zoo Design Studio source: <https://github.com/KittyCAD/modeling-app>
  (`src/lib/settings/initialSettings.tsx`, `src/lib/cameraControls.ts`,
  `src/components/gizmo/`, `src/hooks/useEngineConnectionSubscriptions.ts`)
- OrcaSlicer source: <https://github.com/OrcaSlicer/OrcaSlicer>
  (`src/slic3r/GUI/Shortcuts.cpp`, `GLCanvas3D.hpp`,
  `Gizmos/GLGizmoFdmSupports.cpp`, `src/libslic3r/PrintConfig.cpp`,
  `src/libslic3r/AppConfig.cpp`)
- Bambu Studio support settings: <https://wiki.bambulab.com/en/software/bambu-studio/support>
