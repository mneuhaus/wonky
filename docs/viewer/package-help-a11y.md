# Package report: help-a11y

Wave 3, P1. Help overlay, single-key shortcut setting, focus-preserving
rendering, drawer focus trap, contrast and size tokens, dark theme, inspector
host, German user guide. Reference for other packages:
[`help-a11y.md`](help-a11y.md). Evidence: `out/viewer/help-a11y/`.

## What it does

- **Help overlay (`?`).** A modal dialog listing every registered binding
  with its scope ("Anywhere", "Viewport focused", "In a dialog"), generated
  from the command registry through `keyboard.describe()`, grouped by command
  prefix, with a filter field, "not available now" for commands whose
  `enabled()` is false, and struck-through keys while single-key shortcuts are
  off. Static tables add the focused-control keys (tab lists, wipe divider,
  source lines, dialogs) and the mouse gestures. Also reachable through the
  header button **Keyboard shortcuts**, which works when single keys are off.
- **Settings dialog.** Header button **Settings** renders every
  `slots.settings.item` entry (boolean, choice, number with clamping; other
  scopes read-only, unknown types said so). This makes the settings of
  render-look (edge width, seam edges), fdm (α_max, small bores, plate size)
  and source-links (editor) editable for the first time.
- **Single-key shortcuts (G `singleKeyShortcuts`, default on).** Off: every
  binding typed with one character key does nothing (letters, digits,
  punctuation, also with Shift, also `?`); ⌘/Ctrl and Alt bindings, Escape,
  Home and the arrows keep working. `keyboard.js` enforces it in its dispatch
  and, for listeners outside it (the digit listener of `navigation.js`), with
  a window capture guard registered before any feature.
- **Keyboard core.** `Digit*`/`Numpad*`/`Key*` bindings match `event.code`,
  arrows only `Arrow*` codes, named keys never match numpad codes (NumLock
  off); a `dialog` scope inside open modal dialogs; each conflict is logged
  once instead of on every keydown; `keyLabel()` for display.
- **Focus.** `dom.js` gains `preserveFocus`, `captureFocus`/`restoreFocus`,
  `focusables` and `trapFocus`; `patch()` now also restores by form-control
  name, by position (same tag and text), the caret and the scroll position.
  The library already used `patch`; the inspector now renders through it.
  The drawer: focus moves to its close button on open (never out of a text
  field being typed in), Tab and Shift+Tab stay inside, Escape closes only the
  drawer (it is the top of the Escape stack while open, spec section 5) and
  focus returns to the opener, found again by id if it was re-rendered.
  Both dialogs are native `<dialog>` with `showModal()`, a Tab trap and focus
  return.
- **Tokens and themes.** `tokens.css` defines the full semantic set (surfaces,
  five tints, nine text colours, strong fills with `--on-green`, lines, focus,
  shadows, five type sizes from 11 px) with `light-dark()`; `data-theme` on
  `<html>` selects light (default), dark, or system. Every text token reaches
  4.5:1 on every surface and tint in both themes (tested). The setting
  `theme` (G) is applied by `help.js` and cached for the first paint.
- **Inspector host.** Section order of spec section 4 (heading, sections
  below 30, identity, 30 to 49, Browse geometry, 50 and up, warning, reference,
  LLM context), the labelled overview size (`overviewSizeMarkup`,
  `app.modelBounds`), focus kept across renders (to `#inspector-heading` when
  the control is gone), roving `tabindex` on the Inspect/Review tabs,
  `data-focus-key` on body rows; `inspector.css` on tokens, text at 11 px or
  more, honesty-critical notes on a copper tint at 12 px.
- **Contrast audit.** `scripts/viewer/qa/contrast.mjs` measures every rendered
  text, input value and placeholder in light and dark across eleven UI states
  (or lists CSS findings with `--static`).
- **German guide.** `docs/viewer-ui.md` rewritten for the new viewer: start,
  layout, live loop and trust states, model-first compare and ghost, camera
  keys (camera-navigation's text), display, parts, selection and exact
  measurement with the exactness labels, tools and thickness probe (its text),
  section, FDM, source links, reviews and LLM context, reports, the key table,
  settings, themes and accessibility, API and files.

## How to use it

```
node bin/wonky-view.mjs part.fs     # or .brep.json models
#   ?            shortcut list (or the (?) button in the header)
#   header ⚙︎    Settings: Theme light/dark/system, Single-key shortcuts, ...
#   Escape       closes the dialog or drawer; focus returns where it was
node scripts/viewer/qa/contrast.mjs --port 4374           # audit, both themes
node scripts/viewer/qa/contrast.mjs --static              # CSS sizes and literals
```

Console: `wonkyViewer.app.openHelp()`, `openSettings()`,
`wonkyViewer.settings.set('G', 'theme', 'dark')`.

## Files

Owned and changed: `viewer/features/help/help.js`, `help.css`,
`viewer/core/keyboard.js`, `viewer/core/dom.js`, `viewer/styles/tokens.css`,
`viewer/features/inspector/inspector.js`, `inspector.css`,
`scripts/viewer/qa/contrast.mjs`, `docs/viewer-ui.md`,
`docs/viewer/help-a11y.md`, this report. New in the package's own feature
directory: `viewer/features/help/shortcuts.js` and `settings-panel.js` (pure
modules, tested directly). Test: `test/viewer-help-a11y.test.mjs` (the task
named `test/viewer-help-a11y*.test.mjs`; the package list said
`viewer-a11y.test.mjs`). QA tooling (not repository code):
`tmp/viewer/help-a11y/` (`qa.mjs`, `widths.mjs`, `restart.mjs`,
`migrate.mjs`, `qa-entry.mjs` + `core-overlay.mjs` for the overlay server);
`migrate.mjs` is also kept in `out/viewer/help-a11y/qa-scripts/`. No new
dependency; no frozen or foreign file edited.

## Evidence

Browser: Playwright Chromium from `~/.dev-browser` (`scripts/viewer/qa/browser.mjs`),
1536 × 900, real keyboard and mouse events. Instances: **4374** = the shared
working tree; **4375** = the same tree served with the token-migrated CSS of
integration request 1 (`tmp/viewer/help-a11y/qa-entry.mjs`, symlink overlay;
every JS file is the live shared tree). Both stopped afterwards.
`out/viewer/help-a11y/results.json`: **25/25 checks pass**, plus the restart
check (`qa-run.txt`).

| # | Acceptance | Result | Evidence |
|---|---|---|---|
| 1 | `?` opens an overlay that lists every registered binding with its scope | pass | `?` (Shift+/) opens `#help-dialog` as `:modal`; 32 rows = 32 commands with keys, 34 kbd = 34 unique bindings of `commands.bindings()`, no missing id, no scope mismatch; scopes Anywhere / Viewport focused / In a dialog; filter "orbit" leaves only orbit commands; Tab ×8 stays in the dialog; Esc closes; opened from the header, focus returns to `#help-toggle`. `01-help-overlay.png`, `01b-help-overlay-end.png`, `02-help-filter.png`, `13-help-{1150,900,650}.png` (no page overflow, scope column visible at 650 px). |
| 2 | With single-key shortcuts off, letter keys do nothing while ⌘S still saves | pass | Turned off in Settings (`03-settings-dialog.png`); `c a e ? f 1 Shift+E t w` changed nothing (tool, edges, camera, help closed); ⌘S with focus on the page: `POST /api/feedback` 201, "Saved · WKR-AD1340AF6A" (`04-saved-with-single-keys-off.png`); the overlay strikes 25 keys through (`04b-help-single-keys-off.png`); survives a reload and a server restart with the same reviews directory (`15-after-restart-dark.png`, also theme dark); back on, `C` selects the comment tool. Unit tests: dispatch, guard, modal scope. |
| 3 | Clicking a model or changing Browse geometry keeps focus on the clicked control; the drawer traps focus and returns it on close | pass | Click on a model row: after the load focus is on the same `data-focus-key`; Tab + Enter on the next row: same (`05-model-focus-kept.png`). `selectOption` face:2 on `#inspect-entity`: focus stays on the new select, selection B1.F3, Tab/Shift+Tab return to it (`06-browse-geometry-focus.png`). Enter on `#open-source`: focus on `#close-report` (`07-drawer-focus-in.png`), 14 × Tab and 14 × Shift+Tab stay inside, Esc closes and focus is back on `#open-source` with the selection kept (`08-drawer-focus-returned.png`); report drawer from the Checks tab: close button returns focus to the report row. |
| 4 | contrast.mjs reports every text at 4.5:1 or better and 11 px or larger, in light and dark | pass with integration request 1; fails on the shared tree | **Integrated (4375):** light 1297 texts, dark 1426 texts in 11 states, 0 below 4.5:1, 0 below 11 px (`contrast-integrated.txt`, `.json`, 22 screenshots in `contrast-integrated/`; `10-dark-theme-integrated.png`, `11-dark-help-integrated.png`, `12-light-theme-integrated.png`). Static scan of the overlay: 0 sizes below 11 px, 31 deliberate literals left (shadows, data swatches). **Shared tree (4374):** light 14 below 4.5:1 and 58 below 11 px, dark 163 and 56 (`contrast-shared-tree.txt`), every one in CSS owned by other packages or the foundation (`base.css`, `layout.css`); this package's own UI passes in both themes there too (help and settings states: 187 texts, 0/0), and its files have no static finding. The token contract (every text token on every surface and tint, both themes; sizes ≥ 11 px) is a unit test. |
| 5 | docs/viewer-ui.md describes the new viewer in German | pass | Rewritten; includes the texts requested by camera-navigation, diff-overlay, thickness-probe, live-client, reviews-context and fdm. |
| 6 | VS 32/32 and RV 7/7 remain green | pass | See Tests. |

Also checked: no console errors on either instance; settings persist across a
`wonky-view` restart (`restart.mjs`); the dialogs at 1150, 900 and 650 px
(`13-*.png`, `14-settings-*.png`).

### Tests

- `nice node --test test/viewer-help-a11y.test.mjs`: **17/17** (WCAG
  character-key classification; code matching for digits, numpad, arrows and
  NumLock-off Home; key labels; dispatch with single keys off; modal dialog
  scope; the window guard; `preserveFocus` by id, focus key, name, position
  and caret; `trapFocus` cycling, release, re-rendered opener, fallback,
  deliberate moves; `shortcutGroups`/`shortcutsMarkup`; settings parsing and
  markup; the help feature in the fake environment with a settings server;
  inspector section order and labelled overview size; the token contrast
  contract; contrast math, failure dedupe and the static scan).
- VS `test/viewer-state.test.mjs` **32/32**, RV `test/review.test.mjs` **7/7**,
  DC 5/5, DE 2/2, GS 11/11.
- Neighbours, unchanged: camera-navigation 15/15, exact-measure 12/12,
  measure 17/17, reviews-context 14/14, source-links 19/19, diff-overlay
  17/17, parts-tree 16/16, model-first-compare 18/18, render-look 14/14,
  section 15/15, fdm 17/17, thickness-probe 6/6. `viewer-core` 7/10 (the
  same three failures as before this package: camera frozen API ×2 and
  multi-selection buffers, owned by camera-navigation and render-transport);
  `viewer-live-client` 21/22 (the failing test throws in
  `features/parts/parts.js` `bodiesOf`, parts-tree is being built in
  parallel).
- `node scripts/viewer/check-format.mjs`: ok; `check-contracts.mjs`: ok.

## Integration requests

1. **Token migration of the other stylesheets (required for acceptance 4 on
   the shared tree and before the dark theme is offered).** Run
   `node tmp/viewer/help-a11y/migrate.mjs` (or
   `out/viewer/help-a11y/qa-scripts/migrate.mjs`) after the wave-3 packages
   are merged: it re-derives the change from the current files and writes
   copies to `tmp/viewer/help-a11y/integration/viewer/` plus
   `migration-report.md` (every line, from, to). Copy those CSS files over
   `viewer/`, then check `node scripts/viewer/qa/contrast.mjs --port 4380`
   (expect 0 and 0 in both themes) and `--static` (expect 0 sizes below
   11 px). Rules: font sizes below 11 px → `var(--text-xs)`; literal colours
   → tokens by property role and hue (text greys → `--ink`/`--ink-soft`/
   `--muted`, accents → `--green`/`--copper`/`--danger`/`--blue`/`--amber`,
   white text → `--on-green`, light backgrounds → nearest surface or tint,
   dark fills → `--green-strong`/`--blue-strong`, translucent white →
   `color-mix(var(--surface))`, neutral lines → `--line`/`--line-strong`,
   tinted lines → `color-mix(hue 35 %)`); `background: var(--green)` under
   white text → `var(--green-strong)`; `base.css` gets
   `small { font-size: max(var(--text-xs), .85em) }`; shadows and data colours
   stay. Snapshot of today's change: `out/viewer/help-a11y/integration-tokens.diff`
   (19 files, 329 replacements: `styles/base.css`, `styles/layout.css` and
   the CSS of annotations, compare, diff, display, drawer, fdm, library, live,
   measure, parts, reports, reviews, section, selection, source, thickness,
   view). If the migration is not applied, remove `'dark'` and `'system'` from
   `THEMES` in `viewer/features/help/help.js`: without it the dark theme puts
   light ink on the literal white panels (`15-after-restart-dark.png`).
2. `viewer/features/view/navigation.js` (camera-navigation, optional): the
   window listener's digit matching is now in `keyboard.js` (codes, NumLock
   off, Shift on the numpad). It can shrink to `menu.close()` in
   `applyPreset` plus, if still wanted, swallowing unmapped numpad keys 7 and
   9. Until then it works unchanged; the keyboard's window guard, registered
   first, applies the single-key setting to it.
3. `viewer/features/drawer/drawer.js` (optional): replace
   `aria-label="Selected check report"` (wrong for source, failure and delta
   drawers) with `role="dialog" aria-labelledby="report-title"`. If the drawer
   later pushes its own Escape handler and calls `trapFocus`, remove the
   `#report-drawer` observer block in `help.js`.
4. `viewer/features/library/library.js` (optional): roving `tabindex` on the
   Models/Checks tabs in `libraryTab()` (`tab.tabIndex = selected ? 0 : -1`),
   as the inspector tabs now do.
5. `docs/viewer/contracts.md` (maintainer): new DOM ids `#help-toggle`,
   `#settings-toggle`, `#help-dialog`, `#settings-dialog`, `#help-filter`,
   `#help-single-keys`, `#help-settings`, `#help-list`, `#help-summary`,
   `#settings-list`, `#settings-summary`, `#inspector-heading`; api
   `openHelp`, `closeHelp`, `openSettings`; core additions in `dom.js`
   (`captureFocus`, `restoreFocus`, `preserveFocus`, `focusKey`, `focusables`,
   `trapFocus`) and `keyboard.js` (`parseKey`, `matches`, `isCharacterBinding`,
   `isCharacterEvent`, `keyLabel`, `setSingleKeyShortcuts`,
   `singleKeyShortcuts`, `describe`).
6. exact-measure: its inspector integration (steps 2 and 3, labelled size and
   section order) is now in `inspector.js`; do not apply
   `tmp/viewer/exact-measure/integration/inspector.diff`. Its step 1
   (`measure.js`) is still open and not part of this package.
7. render-look (frozen `viewer/render/**`, maintainer decision): the
   viewport is not themed. Edges stay `#1d2721`, so in the dark theme the
   silhouette against the dark stage is carried by the face shading only; a
   token-driven clear colour and edge colour would finish the dark theme.

## Gaps

- **Acceptance 4 depends on request 1** on the shared tree (see the table).
- **First frame:** the theme is applied when the help feature runs (cached in
  `localStorage`), after the module graph loads; a dark-theme user can see one
  light frame. An inline boot script would fix it but `index.html` is frozen
  and inline scripts are avoided.
- **Browsers:** `light-dark()` needs Chrome 123, Safari 17.5 or Firefox 120;
  QA ran in Chromium only.
- **Audit coverage:** eleven states. The live failure banner, busy bar and
  failure drawer (need a live source), the thickness card, dimension labels
  and filled annotation cards are not rendered by the audit; their CSS is in
  the static scan (0 sizes below 11 px after migration) and their colours in
  the token contract only. Text over the viewport is measured against the
  stage background, not against model pixels.
- **Digits in the browser:** the shared tree still loads the foundation
  `view.js` (camera-navigation's integration is pending), so digit views and
  the Views menu were not exercised in the browser; the code matching and the
  guard are unit-tested.
- **Numpad with NumLock off** sends no character, but `Numpad*` bindings
  count as character bindings, so they are off with single keys off in
  `keyboard.js` while `navigation.js`'s own listener still serves them.
  Harmless, noted for request 2.
- The drawer's trap is keyboard-only: a click into the viewport moves focus
  out (the drawer is not modal) and is then left there on close.
- Structural focus restore needs the same tag and text at the same position;
  rows without id, focus key or name can still lose focus when they change.
- Settings dialog: scopes S and SB are listed read-only; values are validated
  per type (numbers clamped), not per feature rule.
- Optional source-links request 2 (`sketchEntity` in the inspector's local
  Copy reference) is not done: in the browser reviews-context rebinds the
  button to the server-built reference; the local path only runs under the
  legacy seam.
