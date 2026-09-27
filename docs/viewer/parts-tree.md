# Parts tab, body visibility and collapsible columns

Package `parts-tree` (wave 3, P0) of `docs/viewer/spec.md`. This page
describes the behavior and the interfaces. Evidence and open gaps are in
`docs/viewer/package-parts-tree.md`.

## What you see

- **Parts tab.** The left column has three tabs: Parts, Models, Checks.
  Parts is the default tab when the displayed model has two or more bodies or
  comes from a live source (`wonky-view part.fs`). A tab picked by hand is
  remembered for that source (setting S `libraryTab`) and applied on the next
  start; after a manual pick the viewer never switches the tab by itself in
  that page. The search field filters parts by name, alias or body id while
  Parts is open.
- **Rows.** One row per body: eye button, color swatch, name (or the body id
  when the model records no name), alias (`B1`), then a second line with the
  raw and logical face counts ("46 faces (11 logical)"), the color source
  ("appearance", "viewer color" or "custom color"), the opacity when below
  100 %, "hidden", and the FDM badge slot. A summary line reads
  "4 bodies · 63 faces (28 logical) · 1 hidden" with **Show all** when a body
  is hidden. Clicking a name selects the body (Shift/⌘-click adds it);
  hovering a row highlights the body in the viewport.
- **Row details** (chevron): an opacity slider (10–100 %), a color override
  (color input, **Reset** returns to appearance or viewer color), the recorded
  volume and size (chip `recorded`, null reads "not evaluated"), the producing
  operation with its source line, the body id, details contributed by other
  features (`parts.rowDetail`, e.g. FDM printed/up) and the row actions
  (`parts.rowAction`, e.g. **Export for print** of that body).
- **Revisions below the tree.** The revisions of the displayed model's source,
  newest first (`r3 · 14:05`, **Open** on the displayed one, **Before** in
  compare mode), folded after eight. For a live source the latest attempt that
  has no revision yet is listed on top: "r5 building · evaluating",
  "r5 fails · capability error at part.fs:24" with **Details** (the failure
  drawer), or "r5 cancelled". A click opens that revision.
- **Workspace tree** (workspace files only, docs/viewer/workspace.md): above
  the bodies the Parts tab lists the workspace: assemblies (with their
  instances), then its models, each with its trust state ("r3", "r4
  building", "r5 fails · last good r4") and body count. A click on a row
  opens that node; the camera stays. In an open assembly every instance row
  has an eye (hide that model in this assembly) and `I` (isolate it; again:
  show all), and the bodies are listed per visible model, each group headed
  by its model name ("Active" marks the model the inspector reads). Body
  rows act on their own model (`data-model-id`); `Y`, `Shift+Y` and `I` on
  bodies work across all members. Plain CLI inputs show no tree.
- **Collapsible columns.** `[` collapses or shows the library column, `]` the
  inspector column; both also have a header button (left and right end of the
  header actions) and, while collapsed, a 44 px rail with an expand button.
  The viewport grows into the freed space; no tree or panel is laid over it.
  At 900 px and below the floating inspector card disappears when collapsed.

Colors: a swatch shows exactly the color the renderer uses
(`render/style.js resolveBodyStyle`): the custom color, else the model's
`appearance`, else the viewer palette. Palette colors are not model data and
always say "viewer color".

## Keys

| Key | Action |
|---|---|
| `Y` | Hide the selected bodies (every body that has a selected face, edge, point or body); without a selection the hovered body |
| `Shift+Y` | Show every body of the displayed model(s) |
| `I` | Isolate: only the selected bodies stay visible |
| `[` (also `Alt+[`) | Collapse or show the library column |
| `]` (also `Alt+]`) | Collapse or show the inspector column |

`Alt+[` / `Alt+]` exist for layouts where the bracket needs Option or AltGr
(German Mac: Option+5 / Option+6). Hidden bodies leave the selection and the
hover, and the picker skips them, so they cannot be hovered, clicked or
measured until shown again.

## Persistence

| Setting | Scope | Key | Stored |
|---|---|---|---|
| Body visibility | SB | `visible` | `false` only; visible is the default and deletes the key |
| Body opacity | SB | `opacity` | 0.1 to 0.99; 100 % deletes the key |
| Body color override | SB | `color` | `#rrggbb`; Reset deletes the key |
| Library tab | S | `libraryTab` | `parts`, `models` or `checks`, after a manual pick |
| Library / inspector collapsed | G | `libraryCollapsed`, `inspectorCollapsed` | `true` only |

SB is source + body key: the source is the live source's real path or the
`.brep.json` input path (archived snapshots use their model id), the body key
is the body name when it is present and unique in the model, else the body
id. So a hidden "Pin" stays hidden across live revisions and restarts. The
column state is mirrored to `localStorage` (`wonky.viewer.columns`) only to
avoid a flash on first paint; the server settings file wins once loaded.
Body settings are written one at a time (each settings response then carries
every earlier patch); the row shows the new value at once.

## Display and picking

The feature writes only the store key `display.parts`, which
`features/display/display.js` composes into the renderer style:

```js
display.parts = {
  bodies: { [bodyId]: BodyStyle },                       // shared map
  models: { [modelId]: { bodies: { [bodyId]: BodyStyle } } },
}
// BodyStyle = { visible, opacity? (< 1), color? ([r, g, b] 0..1) }
```

Every displayed model (after, before in compare mode, a ghost) gets its own
entries from its own source's settings. The shared map carries the entries
of the displayed model by body id: the picker reads it
(`render/picking.js hiddenMask`), and it keeps a hidden body hidden across a
live revision swap until the new revision's own entries are composed. Before
the parts document of a revision arrives, body keys come from the draw model
or JSON scene with the same key rule.

Every render of the panel composes `display.parts` first, and a newly drawn
model renders the rows again: a row reads its style from the composed entries
of its own model, and an assembly's members change without a store change
(node switch, first good revision, instance visibility). A row read from
entries composed for an earlier set of models showed the shared entry of
another model's body with the same id (Regression review 3 of the workspace work).

## Server: `GET /api/models/:id/parts`

`src/viewer/routes/parts.mjs`, computed by `partsDocument()` /
`partsOf(model, { logical })` in `src/viewer/parts.mjs`, cached per revision,
404 for an unknown revision.

```json
{
  "schema": "wonky.viewer-parts/1", "modelId": "…", "scope": "…",
  "exactness": { "counts": "recorded", "logicalFaces": "exact-parameters",
    "volumeMm3": "recorded", "boundsMm": "recorded", "appearance": "recorded" },
  "totals": { "bodies": 4, "faces": 63, "logicalFaces": 28, "edges": 125, "vertices": 70 },
  "logicalFacesReason": null,
  "bodies": [{
    "index": 0, "alias": "B1", "id": "model/base/0", "name": "Base plate",
    "label": "Base plate", "settingsKey": "Base plate",
    "appearance": { "red": 0.55, "green": 0.68, "blue": 0.58, "alpha": 1 },
    "color": { "rgb": [0.55, 0.68, 0.58], "hex": "#8cad94", "source": "appearance" },
    "representation": { "geometry": "analytic", "precision": "F32x2", "closed": true },
    "counts": { "faces": 46, "logicalFaces": 11, "edges": 92, "vertices": 48 },
    "volumeMm3": 11520, "boundsMm": { "min": [0, 0, 0], "max": [60, 40, 9], "size": [60, 40, 9] },
    "validationScope": "…", "toleranceMm": 0.0003,
    "operation": { "id": "model/base", "type": "boolean:UNION", "name": "opBoolean",
      "source": { "file": "…/multi-body.fs", "sha256": "…", "span": { "line": 22, "column": 5 } } },
    "identity": { "role": "boolean-result/0", "stability": "revision-local" },
    "provenance": null
  }]
}
```

Nothing is computed geometrically: counts are the stored topology, logical
faces the exact subdivision grouping of topology-classes (a failure keeps
`null` counts and states `logicalFacesReason`), volume and bounds the
recorded build-time values (`null` stays "not evaluated"). `color` follows the
renderer's appearance rule; a body without appearance has `color: null`.

## Extension points

| Slot | Item | Rendered |
|---|---|---|
| `parts.rowBadge` | `{ id, order, render({ modelId, bodyId, part }) -> markup }` | second row line; long badges are ellipsized |
| `parts.rowDetail` | `{ id, order, render(context) -> markup, bind?({ element, … }) }` | row details, before the actions |
| `parts.rowAction` | `{ id, order, label, icon, run({ modelId, bodyId, part }) }` | buttons in the row details |

Markup returned by `render` is trusted and must escape its own values. A
feature whose badge or detail changes calls `app.renderParts()`.

API on `ctx.app` (and `window.wonkyViewer.app`): `renderParts()`,
`partsDocument(modelId?)`, `partsState()` (debug: tab, columns, composed
style, resolved rows), `showPartsTab()`, `setBodyVisible(bodyId, visible,
modelId?)`, `toggleColumn('library' | 'inspector')`.

## Fixture

`scripts/viewer/qa/fixtures/multi-body.fs` (built by
`node scripts/viewer/qa/fixtures.mjs --only multi-body`): four bodies, about
4 s to build. B1 "Base plate" (appearance sage; a pad unioned onto a plate,
46 faces, 11 logical), B2 "Bracket" (appearance copper, 8 faces), B3 "Pin"
(named, no appearance: viewer color), B4 without name or appearance (listed
as `model/spacer`).

## Files

`viewer/features/parts/parts.js` (feature, pure logic),
`viewer/features/parts/parts-row.js` (row, details and revision markup),
`viewer/features/parts/columns.js` (column collapse),
`viewer/features/parts/parts.css`, `src/viewer/parts.mjs`,
`src/viewer/routes/parts.mjs`, `test/viewer-parts.test.mjs` (server),
`test/viewer-parts-tree.test.mjs` (client).
