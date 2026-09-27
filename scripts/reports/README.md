# scripts/reports

Generators for the visual wonky reports on postplan.dev. Each report is a Node
script that reads real repo documents and data, composes HTML with `lib.mjs`
and writes **one self-contained HTML file** to `out/reports/` (gitignored).
The script uses Node built-ins only. It has no npm dependencies and no JavaScript in the output.

```sh
node scripts/reports/<report>.mjs                  # → out/reports/<report>.html
npx postplan upload out/reports/<report>.html --description "…"   # first time: add --new
```

Re-uploading the same path creates a new version of the same draft (mapping in

## Design

The design borrows from a CAD drawing sheet. Each report opens with a **Schriftfeld** (title block)
with the title, date (Stand), meta cells and the evidence legend. There is one visual convention
throughout, and it is the thing to keep consistent:

| Mark | Meaning | Where it shows |
|---|---|---|
| solid fill ■ | **gemessen** | tiles (top rule), badges, bars |
| hatched ▨ | **geschätzt** | tiles, callout edge, bars (`kind: 'geschätzt'`) |
| hollow ○ | **offen** | tiles, callouts, cards |
| ◆ | **Entscheidung** | callouts, cards |
| ✕ | **fehlgeschlagen** | callouts, cards, tiles |

- Palette: cool drafting paper (`--page #eef1f3`, `--surface #fcfdfd`) with a drafting-blue
  accent. The dark mode is its own set of values (`#0d1012` / `#171b1e`), not an automatic inversion.
- Type: system fonts only (see CSP: web fonts are blocked). The display face is DIN
  (`DIN Alternate` on Apple, `Bahnschrift` on Windows, condensed fallbacks) and is used only for
  h1/h2, the title block and small uppercase labels. Body text and all numbers,
  including tile values, use `system-ui`. `tabular-nums` applies only in tables and chart values.
- Chart colours follow the dataviz reference categorical order: blue, orange, aqua, yellow
  (max 4 coloured keys). There is also a neutral gray for "vorher" / non-highlighted / "sonstige".
  Validated with the dataviz `validate_palette.js` against these surfaces:
  - light (`#fcfdfd`): all hard checks PASS. Worst adjacent CVD ΔE 9,1, normal-vision 22,9.
    Aqua and yellow are below 3:1 contrast, so **every chart ships direct value labels
    and a "Werte als Tabelle" twin**. Keep them.
  - dark (`#171b1e`): all checks PASS. Worst adjacent CVD ΔE 8,4.
- Responsive: horizontal charts are `width="100%"` SVGs with **percentage geometry**.
  Bars stretch and text stays at real pixel size on phones. Diagrams use a viewBox and
  scroll horizontally below 520 px.
- Print: white page, and cards/figures avoid page breaks. Details blocks are meant to expand via `::details-content` (Chromium), but this has not been print-tested yet.

## Components (`lib.mjs`)

The API is documented at the top of `lib.mjs`. Text rules:

- Short props (`title`, `label`, `value`, `note`, `caption`, table cells) are plain text with
  inline `` `code` `` and `**bold**`. They are escaped.
- `body` props and section blocks are HTML strings, composed from `p()`, `ul()`, `table()`, and so on.
- Any figure, tile or card takes `src` (string or array) and renders a small **Quelle** line.
  Name the repo-relative source file of every number.

| Function | Purpose |
|---|---|
| `page({title, date, meta, lede, sections})` | Whole document: title block, auto TOC (≥ 3 sections), colophon. Runs the public-safety guard. |
| `section(title, ...blocks)` | Section with h2 and a TOC entry. `{title, id, note}` form also works. |
| `tiles([{label, value, unit, note, kind, src}])` | Key-number tiles. Top rule colour and badge come from `kind`. |
| `grid(...cards)` / `grid({wide: true}, ...)` | Responsive card grid (17 rem / 24 rem minimum). |
| `card({title, eyebrow, kind, body, src})` | Finding card. |
| `callout(kind, title, body, {src})` | gemessen / geschätzt / offen / entscheidung / fehlgeschlagen. |
| `table({columns, rows, caption, src})` | Columns are `'Label'` or `{key, label, align: 'right', format}`. Rows are arrays or objects. |
| `details(summary, body, {open})` | Collapsible block (CSS only). |
| `image(path, {alt, caption, maxKB, maxWidth, jpeg})` | Data-URI image. Over `maxKB` (default 400) it is downscaled with macOS `sips`. If it is still too big, it throws. |
| `source(...paths)` | Standalone "Quelle" line. |
| `badge(kind)` | Inline evidence badge. |
| `barChart({title, unit, data: [{label, value, kind, highlight, note}]})` | Horizontal bars with the value at the tip. `highlight` greys the others. `kind: 'geschätzt'` hatches the bar. |
| `stackedBar({title, keys, rows})` | 100 % stacked bar(s). A single row shows values and shares in the legend. Keys can be `neutral`. |
| `beforeAfter({title, unit, data: [{label, before, after}], labels, better})` | Grouped before/after bars with a signed Δ (green/red by `better`). |
| `diagram({title, nodes: [{id, label, sub, col, row, kind}], edges: [{from, to, label, planned}]})` | Box-and-arrow on a col/row grid. `kind`: `accent` / `muted` / `planned` (dashed). |
| `fmt.num/auto/pct/ms/bytes` | German number formatting. `auto` picks precision by magnitude. |
| `readJson(path)` / `readJsonl(path)` | Read repo data (repo-relative). |
| `writeReport(name, html)` | Writes `out/reports/<name>` and prints the size. It warns above the Postplan limit of 512 KiB and within 10 % of it. |

Every chart renders a caption, an optional legend, the SVG, a "Werte als Tabelle" details block
and the Quelle line. Hover tooltips are native SVG `<title>` elements (no JS). They add detail,
but the table always holds every value.

## Adding a report

1. Create `scripts/reports/<topic>.mjs`. Import from `./lib.mjs`.
2. Load numbers with `readJson` / `readJsonl` or parse the markdown in `docs/`. **Never type
   a number by hand** if it exists in a file. Put the file in `src`.
3. Label honestly: `kind: 'gemessen'` only for measured values. Use `'geschätzt'` for estimates,
   extrapolations and "indicative under load". Use `'offen'` for what is not known yet.
   Say what failed with `'fehlgeschlagen'`.
4. `writeReport('<topic>.html', page({...}))`, then open the file locally in light and dark
   mode and at a phone width before uploading.
5. Upload with `npx postplan upload out/reports/<topic>.html` (`--new` the first time) and add

**Public-safety guard.** `page()` throws if the HTML contains absolute `~` or `/home/…`
paths, email addresses, 24-hex ids (the Onshape document/workspace/element shape),
`token=…`-style credential assignments or API-key-like strings. Data URIs are excluded
from the scan. If it fires, remove the value from the report. Do not weaken the regex.
Watch out for JSON sources that carry absolute paths, for example `out/corpus/summary.json → corpus.root`.
Print repo-relative paths instead.

## CSP findings (tested 2026-09-23)

Test page: `scripts/reports/csp-test.mjs` → `out/reports/_csp-test.html` (241 KB).
It contains one 165 KB PNG as a data URI, `<details>`, every chart type, SVG `<pattern>` and
`<clipPath>`, and CSS custom properties with `prefers-color-scheme`.

Served CSP header (the same on the draft URL and on `/raw`):

```
default-src 'none'; script-src 'none'; script-src-attr 'none'; style-src 'unsafe-inline';
img-src https: data:; connect-src 'none'; worker-src 'none'; frame-src 'none';
object-src 'none'; base-uri 'none'; form-action 'none'
```

Checked in agent-browser (Chromium), session `reports-foundation`:

- **data: images work.** The PNG decoded at 744 × 1225 with no console or CSP errors. Later
  reports **may embed screenshots** as data URIs, but the whole page must stay under the
  upload limit below (base64 adds ~33 %).
- **Inline `<style>` works.** `style` attributes are also allowed by `'unsafe-inline'`, but they were not exercised because the library emits none.
- **CSS-only interactivity works.** `<details>` was closed by default, and clicking it opened it and showed the content.
- **Inline SVG works fully**: patterns (the geschätzt hatch), clip paths, markers, CSS variables in SVG fills.
- **The HTML is served byte-identical** to the uploaded file. The page is top-level
  (no iframe wrapper and no injected markup), so `prefers-color-scheme` and the viewport meta work as written.
  Light, dark and 390 px phone renders were checked.
- **Web fonts are blocked.** There is no `font-src`, so `default-src 'none'` applies, and data: fonts are blocked too.
  Use system font stacks only (the library already does).
- `img-src https:` would also allow remote images. Don't use them. Reports must stay self-contained.
- **Upload limit: 512 KiB per draft** (524 288 bytes, UTF-8 length of the whole HTML). The CLI
  checks it before sending (`HTML document is … bytes; maximum is 524288 bytes`), and the server
  default is the same. The first viewer build with JPEG q60 screenshots was 1,2 MB and would have
  been rejected. `viewer.mjs` now embeds screenshots as **AVIF** via `sips` (q50 for resized shots,
  q80 for native-size UI crops): about a third of the JPEG bytes at the same width, with no visible
  loss on UI text. The page is now ~430 KB. AVIF needs Safari 16+, Chrome 85+ or Firefox 93+.
- **Not tested:** Safari/Firefox rendering.
