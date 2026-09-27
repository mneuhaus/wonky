# render-look: lighting, classified edges, style table, transparency, layers

Package of wave 2 (spec 7.3, section 6 rows "Feature edges", "Edge width",
"Seam/subdivision edges", "X-ray"). It changes how the draw payload of
render-transport is drawn; it adds no geometry and no measurement. The
report with the evidence is `package-render-look.md`.

## Files

| File | Role |
|---|---|
| `viewer/render/shaders.js` | face and line programs, lighting constants, colors, edge look, state bits, a JS mirror of the lighting (`shadeLinear`, `luminance`, `contrastRatio`) |
| `viewer/render/renderer.js` | passes per pane, per-model look resources, `frame.drawLines` / `frame.drawBodies`, `look(id)`, `styleVersion()` |
| `viewer/render/style.js` | style table: `composeStyle(display)`, `resolveBodyStyle`, viewer palette, `overhangCodes`, `composeLookStates` |
| `viewer/render/layers.js` | layer list, line instance layout, `segmentsFrom`, `lineOptions`, `bodyOptions` |
| `viewer/features/display/display.js` | the only `renderer.setStyle()` caller; Shift+E, T, settings, debug handle |
| `viewer/features/display/legend.js` | status-bar legend |
| `viewer/features/display/display.css` | legend and x-ray button |
| `test/viewer-render-look.test.mjs` | 14 tests |

## Look

**Lighting** (face program, linear space, sRGB output). Hemisphere ambient
keyed to world +Z (ground 0.57, sky 0.77), one key light fixed in view space
(0.58 from upper left), a weak fill near the view direction (0.12) and a low
Blinn-Phong specular (0.05, shininess 40). Two-sided: the server winds every
triangle outward, and `gl_FrontFacing` flips the normal of a back face; no
`abs()`. The constants are chosen so that

- every lit shade of the viewer palette keeps at least 4.5:1 against the
  edge color `#1d2721` (unit test sweeps 624 cameras × 400 normals), and
- the principal iso faces differ by at least 1.3:1, top lightest.

Body colors are converted to linear on the CPU; hover (`COLORS.hover`, mix
0.6), selection and overhang tints mix in linear space.

**Edges** (line program). One instanced screen-space quad per display
segment (4 strip vertices), width `edgeWidthPx` CSS px (1.5 default, 1 to 3)
times the device ratio, square caps, moved toward the eye by
`EDGE_LOOK.biasPx` = 1 CSS px of view depth (`depthPerPixel`, per vertex in
perspective). Passes per body set:

| Pass | Classes | Look |
|---|---|---|
| base | sharp, unresolved | `#1d2721`, opaque |
| soft | tangent; seam and subdivision with Shift+E | 45 %; 30 %; blended once per pixel (stencil bit 0x80) |
| hidden (transparent bodies only) | sharp, unresolved, tangent | 22 %, depth GREATER, only behind a transparent front surface (stencil bit 0x40) |
| accent | hovered, selected, bed and exempt outlines, whatever the class | 2.5 CSS px, `hoverEdge`, `selectEdge`, `bed`, `exempt` |

`E` (view feature, `display.edges.visible`) turns the class passes off; the
accent pass still draws, so a selected seam from Browse geometry stays
visible. Seam and subdivision edges stay pickable (the picker is unchanged).

**Per-body rank offset.** Faces move toward the eye by
`(bodyIndex mod 8) × 0.05` CSS px of view depth, so two bodies with
coplanar faces show a stable winner (the higher rank) instead of noise. The
offset (at most 0.35 px) stays below the edge bias, so edges of any body on
a coplanar face draw continuously.

**Frame order per pane**: opaque bodies (one draw for merged body ranges),
their edges; transparent bodies back to front by bounds center, each with
back faces (cull front) then front faces (cull back), `depthMask(false)`;
their depth plus the front mark; their edges; highlighted B-rep points;
layers. With nothing transparent the frame is one face draw plus 1 to 3
instanced line draws.

**Transparency and x-ray.** A body is transparent when its opacity is below 1
(parts tree, appearance alpha) or x-ray is on (`T`, every body at
`min(opacity, 0.5)`). Intersecting transparent bodies can sort wrongly; this
is accepted (spec 7.6, no order-independent transparency).

**Clip planes.** Up to 3 `{ origin, normal }` world planes; the shaders
discard `dot(n, p − center) > n · (origin − center)`, the same half-space the
picker skips. Applied to faces, edges and points; `drawLines` and
`drawBodies` apply them when asked (`clip`).

**Overhang flags.** Face state bits 2 to 4 carry a code per face
(`OVERHANG`): `overhang` (planar, exact from the printability API: the whole
face is tinted), `curved` (cylinder or cone flagged `overhang`, or with
`bandsDeg`: tinted where `−n·up > sin α_max` with the exact per-vertex normal
interpolated over the display triangles; the legend says "curved overhang
sampled"), `bed` and `exempt` (no tint; their boundary edges are drawn in the
accent pass as outlines), `ok`, `unsupported`. Uniforms: enabled, `sin α`,
color, mix; the up axis and "printed" flag come per body from the body style
texture. Nothing is tinted until a feature writes flags for the displayed
revision.

## Style table

Features write only their own store key; `display.js` composes them with
`composeStyle()` and calls `renderer.setStyle()`:

| Key | Owner | Shape |
|---|---|---|
| `display.edges` | view | `{ visible }` (E) |
| `display.look` | display | `{ edgeWidthPx, hiddenEdges }` (Shift+E) |
| `display.xray` | display | `{ on }` (T) |
| `display.parts` | parts-tree | `{ bodies: { [bodyId]: BodyStyle }, models: { [modelId]: { bodies: { [bodyId]: BodyStyle } } } }` |
| `display.section` | section | `{ planes: [{ origin, normal, enabled? }] }` |
| `display.fdm` | fdm | `{ overhang: { enabled, alphaDeg, models: { [modelId]: { faces: { [alias]: kind \| { kind, bandsDeg } }, bodies: { [bodyId]: { up, printed } } } } } }` |
| `display.ghost` | diff-overlay | `{ modelId, opacity }` |
| `display.debug` | display | `{ clipPlanes, overhang, bodies, models }` (QA) |

`BodyStyle = { visible?, opacity? (0..1), color? ([r, g, b] sRGB 0..1) }`.
Face aliases are fragments (`B1.F3`) or logical faces (`B1.L3`, all
fragments). The composed style:

```js
{ edges, edgeWidthPx, hiddenEdges, xray, bodies, models, clipPlanes, overhang, ghost }
```

`style.bodies[bodyId].visible` and `style.clipPlanes` keep the shapes the
picker reads. A body's style is keyed by body id (it carries across
revisions) with per-revision overrides under `models[modelId]`
(`resolveBodyStyle(style, modelId, body)`).

**Colors.** `appearance` from the model (both record forms Bend writes:
`{red, green, blue, alpha}` in 0..1 and `{color: {red, green, blue}, opacity}`
in 0..255), else `VIEWER_PALETTE[index % 8]`, labelled "viewer color"
(`colorSource: 'viewer-palette'`), else a parts-tree override
(`'override'`). `renderer.look(id).bodies` and `app.bodyColors(id)` return
`{ id, alias, name, color, colorSource, opacity, visible }` per body.

## Layers

```js
renderer.addLayer({ id: 'fdm.plate', order: 10, draw(frame) {
  frame.drawLines({ positions: [[-128, -128, 0], [128, -128, 0]], color: [0.6, 0.65, 0.6],
    widthPx: 1, depthBias: 0 });
  frame.drawBodies({ cull: 'front', colorMask: [false, false, false, false],
    stencil: { func: 'always', zpass: 'invert', writeMask: 1 } });
} });
```

- `frame.drawLines({ positions, color, widthPx, depthBias, depthTest, strip,
  closed, clip })`: world mm (float64 subtraction of the draw origin), pairs
  or a polyline; returns the segment count.
- `frame.drawBodies({ modelId, bodies, color, alpha, lit, clip, cull,
  colorMask, depthMask, depthTest, depthFunc, stencil, polygonOffset })`:
  triangles of the pane's model or another cached model (ghost), with the GL
  state given; returns the triangle count. Enum names are lower-case strings
  (`'always'`, `'incr-wrap'`, …). Stencil bits 0x80 and 0x40 belong to the
  renderer and are zero when a layer runs.
- Each layer runs with the default state and the state is reset after it.
  When another model is drawn, the pane's depth window is the union of both
  bounds (`style.ghost` is included automatically).

## Legend

The status bar item `#display-legend` always states the display tolerance
("display mesh ±0.02 mm") and the active display-only features: smooth
normals, seam or subdivision edges hidden or dimmed, edges off, x-ray 50 %,
display section, curved overhang sampled, viewer colors. Each item has a
title with the detail (counts, body aliases). It updates after a frame only
when the displayed models or the style version change.

## Settings

| Setting | Scope | Key |
|---|---|---|
| Feature edges (E) | G | `featureEdges` (the view feature's toggle, restored through `view.toggleEdges`) |
| Edge width | G | `edgeWidthPx` (1 to 3; `settings.item` registered, `app.setEdgeWidth(px)`) |
| Seam/subdivision edges (Shift+E) | G | `hiddenEdges` |
| X-ray (T) | S | `xray` per source (`app.sourceKey`) |

The display feature applies these keys at load and on every later settings
change (the Settings dialog writes them directly); each value is applied only
when it differs from the store, so the feature's own writes are no-ops.

## Debug handle

`window.wonkyViewer.app`: `displayStyle()`, `bodyColors(modelId)`,
`displayLegend()`, `setEdgeWidth(px)`, `debugStyle(patch | null)` (writes
`display.debug`), `debugLayer({ lines, bodies, allPanes } | null)` (a layer
calling `frame.drawLines(lines)` and `frame.drawBodies(bodies)`).
`wonkyViewer.renderer.look(id)`, `.style()`, `.styleVersion()`, and
`.stats().gpu.look*` / `.stats().frames.medianCpuMs`.

## GPU resources

Per uploaded model (on the cache entry's gpu object, released with it): the
segment instance buffer (7 words per segment), the face→body texture (R16UI)
and the body style texture (RGBA32F, two texels per body). Per context: the
line program and one instance VAO; the layer line buffer on first use.
Counted as `lookPrograms`, `lookBuffersCreated/Deleted`,
`lookTexturesCreated/Deleted`, `lookVertexArrays`, `lookBytes`; the cache's
GPU byte budget includes them.
