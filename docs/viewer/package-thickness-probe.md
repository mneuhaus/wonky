# Package report: thickness-probe

Wave 3, P1, 2026-09-23. Behavior and interfaces: `docs/viewer/thickness-probe.md`.
Screenshots and `qa-report.json`: `out/viewer/thickness-probe/`. QA drivers:
`tmp/viewer/thickness-probe/qa.mjs` (steps a0-a4, a6, against a private
viewer on 4373) and `qa-live.mjs` (a5, a live session on 4376). Kernel
exploration scripts: `probe.mjs` (audit table), `r10b.mjs`, `tilted.mjs` in
the same directory.

## What it does

- `K` (or the new rail tool between Orbit and the markup tools) arms a
  one-shot thickness tool. A click on a face posts `{ face, point }` (the
  fragment alias and its display pick) to `POST /api/models/:id/thickness`.
  The rail returns to Select. `K` twice or a double-click keeps the tool until
  Escape.
- The query worker (kind `thickness`, 10 s timeout) projects the pick onto the
  exact supporting surface. It casts the inward-normal ray, takes
  `ray.line_surface` roots on every supporting surface and decides each root
  with solid-classification `membership` on its trimmed face. The span runs
  from the start face to the first crossing that leaves the material. The
  value is `t_exit − t_entry` in Bend Real arithmetic, labelled
  `kernel-resolved`, with the tolerance max(entry, exit face tolerance).
- Tangent roots on a face, coincident faces the ray touches, boundary (edge
  or vertex) contacts, unknown membership and roots the kernel could not decide
  refuse the probe: `unresolved` with every blocking entity (face, edge named
  by the face classifier, distance along the ray, kernel answer). The ray is
  never moved.
- The result is drawn as an overlay line (entry to exit) with value, `kernel`
  chip and "anchor: display pick". A refusal is drawn as a dashed ray with a
  cross per blocking point. A card at the upper left shows the details,
  selectable aliases, a "How" disclosure (method, exact ray, settled kernel
  refusals) and Copy.
- Latest wins twice: the client aborts the previous request, and the server
  supersedes the running query of the same revision (409) or cancels it when
  the client goes away (499). The handler checks its signal and yields every
  8 ms.
- On a revision swap the probed face is carried with `POST /resolve` and
  probed again on the new revision (live loop), or marked stale with the
  reason.
- The ray form `{ origin, direction, body? }` is available through the API and
  `window.wonkyViewer.app.thicknessProbe(…)`.

## How to use it

```sh
node bin/wonky-view.mjs part.fs          # or model.brep.json
# in the browser:
#   K, click a wall       value + line; the rail is back on Select
#   K K                   keep the tool; Esc releases it
#   Esc                   cancel a running probe, or clear the result
#   card aliases          select the entry/exit or a blocking entity
#   How / Copy            method, exact ray, settled refusals / plain text
# API: curl -X POST -H 'Content-Type: application/json' \
#   -d '{"origin":[18,0,4],"direction":[0,1,0]}' http://127.0.0.1:<port>/api/models/<id>/thickness
```

## Evidence

Browser: headless Chromium through `scripts/viewer/qa/browser.mjs`, 1536 × 900
CSS px (plus 1150, 900, 650), private viewer on port 4373 with the QA
fixtures and `out/r10b-retained.brep.json`, and a live session on 4376 with a
copy of the bracket in `tmp/viewer/live/thickness-probe/`. Load average 13-15
during the runs. No console errors from the viewer in any step. The only
console lines are the 409 responses of the deliberate server burst in a3,
which are kept apart.

| # | Acceptance | Result | Evidence |
|---|---|---|---|
| 1 | With K, clicking a bracket wall shows 8.0000 mm with the kernel label; the bored-spacer wall shows 3.0000 mm; an overlay line marks the span | **pass**, with one formatting difference (below) | a1: `K`, hover highlights B1.F2, click at (30, 6, 8) → tool back to Select, `8.00000 mm kernel`, B1.F2 → B1.F1, line from (30, 6, 8) to (30, 6, 0) (`a1-1-bracket-top-8mm.png`). Side wall B1.F3 → `12.00000 mm` (`a1-2-bracket-foot-12mm.png`). Bored spacer outer wall B1.F4 → `3.0000 mm kernel` to the bore B1.F3 (`a1-3-bored-spacer-outer-3mm.png`); bore wall B1.F3 → `3.0000 mm` to B1.F4 (`a1-4-bored-spacer-bore-3mm.png`). |
| 2 | A ray lying in a face plane shows "unresolved" and lists the blocking entities | **pass** | a2: ray (18, 0, 4) → +Y on the bracket (the audit's in-plane case, through the debug handle): `unresolved kernel`, "3 blocking entities; the ray is not nudged": B1.F5 boundary at 12 mm (edge B1.E16), B1.F7 boundary at 40 mm (B1.E17), B1.F6 ray in face (the plane x = 18 containing the ray). Dashed ray with 3 crosses (`a2-1-in-plane-ray-unresolved.png`); clicking B1.F6 in the card selects it (`a2-2-blocking-face-selected.png`); a pick on the edge line of the top face refuses with `start-boundary` B1.F2, B1.F1, B1.F6 (`a2-3-pick-on-edge-unresolved.png`). Unit test: the same three entities on a bracket turned 30°/20° and moved. |
| 3 | The UI stays responsive during the query; a superseded probe is cancelled | **pass** | a3 on r10b: the probe request was held 1.5 s (Playwright route) to make the pending state observable. While it was pending, an Alt-drag orbit moved the camera and the page drew 109 frames in 900 ms (median gap 8.3 ms, max 10.2 ms) (`a3-1-pending-while-orbiting.png`: pulse marker, "Probing B5.F7 in the query worker…", Cancel). A second click superseded it: `thicknessStats` requests 2, superseded 1, completed 1, and the result `4.3000 mm kernel` B3.F1 → B3.F2 (`a3-2-second-probe-result.png`). Server with the real query worker: 10 probes of one revision at once → 9 × 409 "Superseded by a newer query", the last 200 `measured 4.3000 mm` (30.6 ms in the worker); `/api/workspace` answered 8 ms later. Route test: a closed request aborts its query (499). |
| 4 | VS 32/32 and RV 7/7 remain green | **pass** | `test/viewer-state.test.mjs` 32/32, `test/review.test.mjs` 7/7 (see Tests). |

Additional checks:

- **Rail regression (a0).** The rail order is Select, Orbit, Thickness,
  Comment, Arrow, Box, Pen, Undo. `K` shows the hint, `K` again locks it with
  "Locked · Esc to release", and Escape returns to Select. C, A, H and V still
  switch tools (`a0-tool-rail-k.png`).
- **Layout (a4).** At 1150, 900 and 650 px the card overlaps neither the
  rail, the view actions nor the status bar (`a4-*-measured.png`).
- **Live loop (a5).** Live session on a copy of the bracket: probe the top
  wall on r1 → `8.00000 mm` (`a5-1-live-r1-8mm.png`). Save thickness 8 → 12:
  r2 is built in 0.01 s, the face B1.F2 carries exactly through `/resolve`,
  and the card shows `12.00000 mm` with "Re-probed on this revision" 255 ms
  after the save (`a5-2-live-r2-12mm-carried.png`). The source copy was
  restored afterwards.
- **Tilted parts (a6).** The r10b pickup plate (66 faces, tilted frame):
  `4.3000 mm`, with 22 side walls and holes whose `line_surface` answer was
  `unresolved`. Each one is settled as near-parallel, with its exact offset
  and crossing bound listed under "How" (`a6-1-r10b-how-refused-roots.png`).
  Kernel runs over three faces of each r10b body
  (`tmp/viewer/thickness-probe/r10b.mjs`): the walls measure 4.0000 (hopper
  floor, rear hopper wall), 4.3000 (pickup plate) and 4.2000 mm (rail
  carriers); end faces measure the part length through the material (52.2 to
  160.0 mm); 3-38 ms per probe. Before refusals were settled, 7 of these 15
  probes were refused.
- **Capability error (a6).** A click on the conical spacer's cone face
  answers `unsupported`: "Thickness probe from a cone face is not supported:
  the kernel membership (solid-classification) covers plane and cylinder
  faces" (`a6-2-cone-face-unsupported.png`).
- **Audit table.** The kernel module reproduces every row of the audit
  probes (docs/viewer/audit-data.md 2.2): bored spacer 3, bracket 8 and 12,
  in-plane refusal, arc slot 10, pocket plate 3, cross bore 6 mm.

## Tests

- `test/viewer-thickness.test.mjs` (new, 11): request validation and the 501
  for a model without bodies; event grouping and coincidence samples; bracket
  top/bottom 8 mm with the projected origin, the tolerance and the face
  reference form; bored spacer 3 mm from both cylinders; the audit rays
  (12 mm foot, 50 mm through from outside, in-plane refusal with its three
  entities and edges, no-hit, origin inside); edge pick `start-boundary`, cone
  apex `root-unresolved`, cone start 501; multi-body `body` required and by
  alias or id; an aborted signal; `refusedRootPlan` cases (near-parallel
  excluded, near-coincident, origin on a plane, still-blocking transverse,
  parallel cylinder, radial far wall, tangent start, cone); the tilted
  bracket (8 mm, and the in-plane refusal with its near-coincident face);
  `POST /thickness` with injected handlers (409 supersede, 499 on close,
  400, 404) and with the real query worker. 11/11.
- `test/viewer-thickness-probe.test.mjs` (new, 6): pure helpers (pick
  request, alias references, drawing geometry, labels, copy text, SVG
  markup without inline styles); `K`, lock and Escape, and no key conflict
  across all loaded features; a click posts the fragment alias and the display
  pick, the rail returns to Select, pending and measured cards; latest wins
  and Escape cancel/clear; refusal list and the 501 → `unsupported` chip; a
  revision swap re-probes the carried face or marks it stale. 6/6.
- Gates: VS `test/viewer-state.test.mjs` 32/32, RV `test/review.test.mjs`
  7/7, DC `test/display-cylinder.test.mjs` 5/5, DE
  `test/display-export.test.mjs` 2/2, GS `test/geometry-summary.test.mjs`
  11/11. `node scripts/viewer/check-format.mjs`: 182 files ok.
  `node scripts/viewer/check-contracts.mjs`: ok.
- `test/viewer-server.test.mjs` 10/12 and `test/viewer-core.test.mjs` 7/10
  in the shared tree. The failures are outside this package: the frozen-stub
  loop expects 501 from every handler with an empty model and fails on
  `printability` before it reaches `thickness`. A direct check shows
  `thickness` answers 501 there. The logical-face stub expectation, the camera
  convention tests and the highlight-buffer test fail as well.

## Gaps

- **8.00000, not 8.0000, for the bracket.** The bracket records
  `validation.toleranceMm = 4.77e-5` (F32 planar build), and values print to
  the decade of their tolerance (spec 8), so it reads `8.00000 mm kernel
  ±0.00005`. exact-measure prints the bracket the same way. The bored spacer
  (3e-4) prints `3.0000 mm`. The tolerance is not inflated to match the
  acceptance text.
- **Settled refusals are closed forms in the viewer module.** `line_surface`
  refuses near-parallel supports and origins that lie on a surface without an
  exact certificate. `refusedRootPlan` settles only those two cases, with
  closed forms over the stored parameters in Bend Real arithmetic (like
  exact-measure), and lists each one. A kernel-side answer would be cleaner:
  a certified lower bound on |t| for near-parallel refusals, or a certified
  start root. See the integration requests.
- **Membership covers planes and cylinders only.** Other start faces answer
  501. Such faces elsewhere block only when their supporting surface is met
  before the exit.
- **The ray form has no pointer gesture.** An exactly in-plane ray cannot be
  clicked, so acceptance 2 is shown through the debug handle. The refusal
  that a click can produce (a pick on an edge line) is shown too.
- **The "UI responsive" evidence holds the request 1.5 s client-side**,
  because real r10b probes take 3-40 ms in the worker. The server side is
  covered by the real-worker burst (9 × 409) and by the route tests.
- The numeric view keys (`2`, `Shift+6`) did not move the camera in this
  tree during QA (camera-navigation area). The QA used visible faces instead.

## Integration requests

1. `docs/viewer-ui.md` (German user guide, not owned): add under the tools
   section:
   > **Wandstärke (K).** `K` wählt das Wandstärke-Werkzeug (einmalig; zweimal
   > `K` oder Doppelklick hält es bis Esc). Ein Klick auf eine Fläche misst
   > entlang der exakten Innennormalen bis zur nächsten Austrittsfläche; der
   > Kernel entscheidet jede Wurzel über die Membership der getrimmten Fläche.
   > Ergebnis als Linie mit Wert und Chip `kernel`, Details in der Karte oben
   > links. Tangentiale, koinzidente oder Kanten-Treffer werden mit den
   > blockierenden Elementen abgelehnt („unresolved“); der Strahl wird nie
   > verschoben. Esc bricht ab bzw. schließt die Karte.
2. `docs/viewer/spec.md` section 15.2, switch-over task 3 ("Wall thickness: 2
   clicks (Shift-click pair)"): the probe makes it `K` plus one click. Section
   3.3 could name the refused-root handling of
   `docs/viewer/thickness-probe.md` ("Refused roots that are settled").
3. Kernel owner (`kernel/ray.bend`, not owned): let `line_surface` report a
   certified lower bound on |t| (or a separate `parallel` kind with the exact
   offset) when it refuses a near-parallel support, and accept a caller-certified
   start point. `refusedRootPlan` in `src/viewer/thickness.mjs` could then be
   removed.
4. fdm owner: `printabilityQuery` resolves instead of answering 501 for a
   model without bodies, which fails the frozen-stub loop in
   `test/viewer-server.test.mjs` ("Missing expected rejection:
   printability"). This package is not affected.
