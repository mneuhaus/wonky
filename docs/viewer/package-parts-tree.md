# Package report: parts-tree

Wave 3, P0, 2026-09-23. Behavior and interfaces: `docs/viewer/parts-tree.md`.
Screenshots and step logs: `out/viewer/parts-tree/`. QA drivers (out/, not
committed): `out/viewer/parts-tree/qa-parts-tree.mjs` (static session, port
4362) and `out/viewer/parts-tree/qa-live.mjs` (live sessions, ports 4368 and
4369).

## What it does

- A **Parts** tab in the left column, first of Parts / Models / Checks. It is
  the default for a model with two or more bodies and for a live source
  (also a single-body one). A manual tab pick is stored per source (S
  `libraryTab`) and wins on the next start; after a manual pick the tab is
  never switched automatically in that page.
- One row per body: eye, color swatch, name or body id, alias, "46 faces
  (11 logical)", color source ("appearance" / "viewer color" / "custom
  color"), opacity, "hidden", and the FDM badge slot (`parts.rowBadge`, on the
  second line so a long badge never hides the name). The library search field
  filters parts. Name click selects the body, Shift/⌘-click adds it; hovering
  a row highlights the body.
- Row details: opacity slider, color override with Reset, recorded volume and
  size (`recorded` chip, null = "not evaluated"), producing operation and
  source line, body id, contributed details (`parts.rowDetail`, used by fdm
  for printed/up), row actions (`parts.rowAction`, reviews-context's
  **Export for print** of the body).
- `Y` hides the selected bodies (else the hovered one), `Shift+Y` shows all,
  `I` isolates the selection. Hidden bodies leave the selection and hover and
  are skipped by the picker.
- Visibility, opacity and color persist per source + body name (SB; body name
  if unique, else body id). Defaults are never stored (visible, 100 %, no
  override delete their keys).
- The revisions of the displayed source below the tree, newest first, with
  Open/Before badges, folded after eight; for a live source the latest
  building, failed ("r3 fails · capability error at multi-body.fs:74",
  Details opens the failure drawer) or cancelled attempt on top.
- `[` / `]` (and `Alt+[` / `Alt+]` for layouts where brackets need Option or
  AltGr) collapse the library and inspector columns to 44 px rails; header
  buttons and rail buttons do the same. Global setting, restored after a
  restart, first-paint cache in `localStorage`. The viewport grows; nothing is
  laid over it.
- `GET /api/models/:id/parts` (`wonky.viewer-parts/1`): per body alias, id,
  name, label, settings key, appearance and its normalized color, geometry
  representation, raw/logical face, edge and vertex counts, recorded volume
  and bounds, producing operation with source point, identity role/stability,
  provenance; totals; exactness labels; 404 for an unknown revision.
- Fixture `scripts/viewer/qa/fixtures/multi-body.fs`: four bodies with
  appearance, without appearance and without a name; the base plate has 46
  raw and 11 logical faces.

## How to use it

```
node scripts/viewer/qa/fixtures.mjs --only multi-body
node bin/wonky-view.mjs tmp/viewer/fixtures/multi-body.brep.json --port 4362
# or live: node bin/wonky-view.mjs my-assembly.fs
```

The viewer opens on Parts. Click the eye of a body, or select any face of it
and press `Y`; `Shift+Y` brings everything back; select a body and press `I`
to look at it alone. The chevron opens opacity, color and **Export for
print**. `[` and `]` give the viewport the whole width.

## Evidence

Browser: headless Chromium through `scripts/viewer/qa/browser.mjs` (1536 × 900,
plus 1150, 900 and 650 px), own instances on ports 4362, 4368 and 4369, all
stopped afterwards. Load average 13 to 17 during QA. Static run
`qa-static.json`: 33/33 checks passed; live run `qa-live.json`: 10/10 passed;
no console errors or warnings in either run.

| # | Acceptance | Status | Evidence |
|---|---|---|---|
| 1 | The multi-body fixture and any live source open on the Parts tab; rows show counts such as "12 faces (9 logical)" | pass | `a1-multibody-parts-tab.png` (Parts selected, "46 faces (11 logical)", "8 faces (8 logical)", summary "4 bodies · 63 faces (28 logical)"); live multi-body `l1-live-revisions-below-tree.png`; live single-body bracket `l3-live-single-body-parts.png`. Unit: "Parts is the default tab …", "a multi-body model opens on Parts …", "counts read …". |
| 2 | Hide a body with the eye or Y, restart wonky-view: still hidden. Shift+Y shows all, I isolates, hidden bodies cannot be picked | pass | Eye hides the bracket and the pick at its screen point returns the base plate behind it (`a2-eye-hides-bracket.png`); Y on the selected pin (`a2-y-hides-pin.png`); settings file `{"Bracket":{"visible":false},"Pin":{"visible":false}}` under the source path; after a server restart both are still hidden and not pickable (`a2-restart-still-hidden.png`); Shift+Y shows all and the bracket is pickable again; I isolates the bracket and the hidden plate is not pickable (`a2-isolate-bracket.png`). Live: a hidden pin stays hidden across a save (r1 → r2). Unit: composition, hidden mask, Y / Shift+Y / I with settings round trip and restart. |
| 3 | r10b-retained swatches match their appearance colors; bodies without appearance say "viewer color" | pass | `a4-r10b-swatches.png`: for all 5 bodies swatch = appearance = rendered color (`#8c99b3` ×2, `#d96e21`, `#6b7a82` ×2), swatch fills in the markup identical. Bracket (no appearance) "viewer color" `a4-bracket-viewer-color.png`; multi-body pin and spacer "viewer color" in `a1`. Server test: appearance normalization equals the renderer's `appearanceColor` on both record forms. |
| 4 | `[` and `]` collapse the library and inspector columns, the state persists across a restart, no tree covers the viewport | pass | `a5-columns-collapsed.png` (columns 44 px, canvas 1024 → 1448 px, stage between the rails), settings `{"libraryCollapsed":true,"inspectorCollapsed":true}`, `a5-columns-after-restart.png` (still collapsed after a server restart), rail and header buttons expand again. Breakpoints `a6-width-1150.png`, `a6-width-900.png`, `a6-width-650.png`; at 900 px the collapsed inspector card is gone (`a6-width-900-inspector-collapsed.png`). The parts tree lives inside the library column at every width. |
| 5 | The current live source's revisions are listed below the parts tree | pass | `l1-live-revisions-below-tree.png` (r2 Open, r1), `l2-live-failing-attempt.png` ("r3 fails · capability error at multi-body.fs:74", Details, last good r2 still open); a good save clears the line. |
| 6 | VS 32/32 and RV 7/7 remain green | pass | `test/viewer-state.test.mjs` 32/32, `test/review.test.mjs` 7/7. Also DC 5/5, DE 2/2, GS 11/11, `test/viewer-parts.test.mjs` 7/7, `test/viewer-parts-tree.test.mjs` 16/16; `check-format.mjs` and `check-contracts.mjs` ok. |

Other checks: Export for print on a row requests
`/print.json?body=model%2Fpin` → 200 (`a3-row-opacity-color-export.png`);
opacity 40 % and custom color reach the renderer (`bodyColors`: override,
0.4); Reset removes the stored keys instead of storing defaults. The route
test compares `GET /api/models/:id/parts` with `partsDocument()` and checks
404. `r10b-retained` parts document: 6 ms.

Pre-existing failures outside this package, unchanged by it:
`test/viewer-core.test.mjs` 3 of 10 (camera numbers after camera-navigation,
highlight buffers after render-transport) and `test/viewer-server.test.mjs` 2
of 12 (foundation stub expectations for printability and logical faces, now
implemented by fdm and topology-classes). The key-conflict test with every
feature loaded passes (also repeated in `viewer-parts-tree.test.mjs`).

## Gaps

- **Picker and per-revision visibility.** The picker's hidden mask
  (`render/picking.js hiddenMask`) reads only the shared body map. In compare
  mode with two different sources whose bodies share an id, a body hidden in
  one pane is also skipped by picking in the other pane (rendering is right,
  it uses the per-model entries). Integration request 1.
- **First frame colors.** Until the binary draw payload arrives, the JSON
  adapter frame uses viewer palette colors, because the review scene carries
  no appearance; the swatches already show the appearance. Integration
  request 3.
- **Concurrent settings writes.** `core/settings.js` replaces its document
  with every PUT response, so overlapping writes can lose a newer local
  value. This feature serializes its own writes; other features are not
  protected. Integration request 2.
- **Library tab plumbing.** `features/library/library.js` knows only Models
  and Checks; the Parts view toggles `data-library-view` on `.library` and
  listens to the Models/Checks clicks. It works, but a tab registry in the
  library would be cleaner. Integration request 4.
- Parts of the **after** model only; in compare mode the before model's
  bodies follow the same per-source settings but have no rows.
- `.py` sources: the build123d frontend records no names or appearance, so
  rows show body ids and "viewer color" (spec section 1).
- Printed / up axis rows belong to fdm (they render through
  `parts.rowDetail`), not to this package.
- Isolation is ordinary persisted visibility (like hiding the other bodies),
  not a temporary mode.
