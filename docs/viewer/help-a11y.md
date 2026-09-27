# help-a11y: help overlay, keyboard, focus, tokens, themes

Reference for the help-a11y package (spec sections 4, 5, 6 and 12, wave 3).
The delivery report with evidence and gaps is
[`package-help-a11y.md`](package-help-a11y.md).

## Help overlay and settings dialog (`viewer/features/help/`)

- `help.js`: header buttons **Keyboard shortcuts** (`#help-toggle`) and
  **Settings** (`#settings-toggle`), two native `<dialog>` elements opened
  with `showModal()` (`#help-dialog`, `#settings-dialog`), the theme and
  single-key settings, and the focus handling of `#report-drawer`.
- `shortcuts.js` (pure): `shortcutGroups(keyboard.describe(), { enabled, mac })`
  groups the registry by command id prefix; `shortcutsMarkup(groups, { filter,
  singleKeys })` renders one table per group (action, keys, scope) plus the
  static "Focused controls" and "Mouse" tables. A command whose `enabled()`
  returns false is marked "not available now"; a key that single-key mode
  switches off is struck through and marked "off".
- `settings-panel.js` (pure): `settingsMarkup(slots.list('settings.item'),
  read)` and `parseSettingValue(item, value)`.

Commands: `help.shortcuts` (`?`, global), `help.close` (`?`, dialog scope),
`help.settings`, `help.toggleSingleKeys`. API: `app.openHelp()`,
`app.closeHelp()`, `app.openSettings()`.

A feature makes a setting editable by registering it:

```js
slots.settings.item({                         // as registered by features/fdm
  id: 'fdm.alpha', order: 60, label: 'Overhang threshold α max (from vertical)',
  scope: 'G', key: 'fdmAlphaDeg', type: 'number', min: 1, max: 89, step: 1,
  default: 45, unit: '°',
  description: 'Slicer threshold angle β = 90° − α max (cad-khana convention)',
});
```

Types: `boolean` (checkbox), `choice` (`choices`: strings or `{ value, label }`),
`number` (clamped to `min`..`max`). The dialog writes `settings.set('G', key,
value)`; the owning feature reacts through `settings.onChange`. Scopes other
than `G` are listed read-only ("Stored per source or body"); an unknown type
says so.

## Settings owned here (scope G)

| Key | Values | Default | Effect |
|---|---|---|---|
| `theme` | `light`, `dark`, `system` | `light` | `<html data-theme>`; `system` follows `prefers-color-scheme` |
| `singleKeyShortcuts` | boolean | `true` | `keyboard.setSingleKeyShortcuts()` |

Both are cached in `localStorage` (`wonky.viewer.a11y`) for the first paint
only; `/api/settings` stays the source of truth. `data-theme` changes only
when the `theme` setting changes, so a theme set by hand (QA, devtools) is not
reset by other settings.

## Keyboard (`viewer/core/keyboard.js`)

Dispatch order: bindings allowed while typing (Mod+S, Escape); nothing else
while typing (input, textarea, select, contenteditable); inside an open modal
dialog (`[aria-modal="true"]`) only `dialog` scope; Mod/Alt bindings; no
single key with ⌘/Ctrl/Alt held; no character-key binding while single-key
shortcuts are off; global, then canvas scope.

Matching: letters by `event.key` (case-insensitive, Shift ignored unless
named); `Digit*`, `Numpad*` and `Key*` bindings by `event.code` (so
`Numpad2` matches with NumLock on or off); `Arrow*` bindings only by an
`Arrow*` code, and no named key binding (`Home`, arrows) matches an event
whose code is `Numpad*`: a numpad key with NumLock off is not an arrow or
Home. This covers the digit matching of the window listener in
`navigation.js`; what that listener still adds is closing the Views menu and
swallowing the unmapped numpad keys (see the report's integration requests).

Exports: `parseKey`, `matches`, `isCharacterBinding`, `isCharacterEvent`,
`keyLabel(key, { mac })`. Keyboard object additions:
`setSingleKeyShortcuts(enabled)`, `singleKeyShortcuts()`, `describe()`
(every binding in registration order with `{ id, label, key, scope,
character, active }`; conflicting later bindings are dropped, and each
conflict is logged once).

Single-key shortcuts (WCAG 2.1.4): a character-key binding is one typed with
a single character key (letters, digits, punctuation, also with Shift).
Off: those do nothing; Mod/Alt bindings, Escape, Home and arrows keep
working. A capture listener on `window`, registered when the keyboard is
created (before any feature's setup), stops character keydowns from reaching
listeners outside the dispatch (today the digit listener of
`features/view/navigation.js`). It leaves text fields and focus-scoped widgets
alone (`role` menu, menubar, listbox, tree, treegrid, grid, application, or
`[data-key-scope]`).

## Focus (`viewer/core/dom.js`)

- `patch(element, markup)` and `preserveFocus(root, render)` keep keyboard
  focus on the same control across a re-render: found again by id, then
  `data-focus-key`, then form-control `name`, then (inside the root) its
  position when tag and text are unchanged. The text caret and the root's
  scroll position are restored. Give list rows a `data-focus-key`.
- `captureFocus(root)` / `restoreFocus(root, snapshot)` for renderers that
  write in several steps (the inspector: markup, binders, appended sections).
- `focusables(container)`: visible, enabled, `tabIndex >= 0`.
- `trapFocus(container, { initial, opener, fallback })` → `{ release({
  restore }) }`: Tab and Shift+Tab cycle while focus is inside; release gives
  focus back to the opener (or its re-rendered copy by id, else `fallback`)
  when focus is still inside or was lost to `<body>`. A deliberate move
  elsewhere (a click into the viewport, a text field) is kept.

The drawer: when `#report-drawer` becomes visible, focus moves to
`#close-report` (never out of a text field the user is typing in), Tab stays
inside, and the drawer is the top of the Escape stack, so Escape closes only
the drawer; the selection and the opener survive and focus returns to it.

## Inspector host (`viewer/features/inspector/inspector.js`)

Section order (spec section 4): heading; contributed sections with
`order < 30` (exact geometry 20, live notice 24, measurement 25); identity
(properties, split/merge note, Comment, Copy reference) as order 30;
sections 30 to 49 (print 35, operation source 40); Browse geometry as 50;
sections from 50; display warning; reference; LLM context and print
(appended by `context-section.js`). Without a selection: overview (size with
`recorded`/`kernel`/`display` from `overview-section.js` and
`app.modelBounds?.(id)`), bodies (`data-focus-key="body-<id>"`), LLM context.
`sectionBands(sections)` exports the split. Renders keep focus; when the
focused control is gone, focus moves to `#inspector-heading`. The Inspect and
Review tabs use a roving `tabindex`.

## Tokens (`viewer/styles/tokens.css`)

Every colour is written once as `light-dark(light, dark)`; `color-scheme` on
`:root` selects the theme (`light` by default, `dark` for `data-theme="dark"`,
`light dark` for `data-theme="system"`). Use tokens, never literal colours:

| Role | Tokens |
|---|---|
| surfaces | `--paper`, `--surface`, `--sunken`, `--field`, `--canvas`, `--chip`, `--glass`, `--stage-top`, `--stage-bottom`, `--backdrop` |
| tints | `--green-soft`, `--copper-soft`, `--danger-soft`, `--blue-soft`, `--amber-soft` |
| text | `--ink`, `--ink-soft`, `--muted`, `--placeholder`, `--green`, `--copper`, `--danger`, `--blue`, `--amber` |
| fills with text | `--green-strong`, `--green-strong-hover`, `--blue-strong` with `--on-green` |
| lines, focus | `--line`, `--line-strong`, `--focus`, `--shadow`, `--shadow-raised` |
| type | `--font-ui`, `--font-mono`, `--text-xs` 11 px, `--text-sm` 12, `--text-md` 13, `--text-lg` 15, `--text-xl` 17 |

Contract (tested in `test/viewer-help-a11y.test.mjs`): every text token
reaches 4.5:1 on every surface and tint token in both themes; `--on-green`
reaches it on both strong fills; no size token is below 11 px. The accent
tokens (`--green`, `--copper`, ...) are text colours: a fill that carries text
uses a `*-strong` token. Translucent surfaces:
`color-mix(in srgb, var(--surface) 94%, transparent)`.

## Contrast audit (`scripts/viewer/qa/contrast.mjs`)

```sh
node scripts/viewer/qa/contrast.mjs --port 4374            # starts a private viewer
node scripts/viewer/qa/contrast.mjs --url http://127.0.0.1:43NN/viewer/ \
  --json out/x.json --out out/shots                        # existing instance
node scripts/viewer/qa/contrast.mjs --static               # CSS scan, no browser
```

Browser mode sets `<html data-theme>` (not persisted) for light and dark and
walks eleven states (overview, selection, review tab, checks tab, source
drawer, parts tab, compare mode, section panel, print check panel, help,
settings); a state whose feature is missing is skipped with the reason. While
a modal dialog is open only the dialog is measured (the page behind is inert). It measures every rendered text node, input value and placeholder:
foreground with alpha and opacity, background composited up the ancestor chain
(gradients by their worst stop), computed font size. Colours are read through
a 1 × 1 canvas, so any CSS colour syntax works. Disabled controls are exempt
and listed apart; text over the viewport is measured against the stage and
marked. Failures are reported once per element and text with the states they
failed in; exit code 1 on any failure.
