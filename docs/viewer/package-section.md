# Package report: section

Wave 3, P1, 2026-09-23. Behavior and interfaces: `docs/viewer/section.md`.
Screenshots and numbers: `out/viewer/section/` (`qa-report.json`). QA
drivers (tmp, not committed): `tmp/viewer/section/qa/qa.mjs` (acceptance
steps `a1 a2 gap a3 a4 extras`), `persist.mjs`, `perf.mjs`, `r10b-exact.mjs`,
`compare.mjs`, `crop.mjs`. Viewer instance: port 4364 (spec 15.1), QA
fixtures from `tmp/viewer/fixtures/` plus `out/r10b-retained.brep.json`,
headless Chromium (Playwright from `~/.dev-browser`), 1536 × 900.

## What it does

- **X** toggles a display section: one clip plane by default (through the
  model center, normal −Y), up to three (plane tabs, **+ Plane**). A slider
  and an mm field move the active plane; **X Y Z** pick an axis with the
  side facing the camera cut away; **From view** aligns the normal with the
  view direction through the same plane point; **Flip**; per-plane on/off.
  The renderer and the picker clip with these planes (render-look
  `style.clipPlanes`); this package only writes `display.section`.
- **Caps** close the cut per plane and body, in the body color with a hatch,
  labelled "display section ±0.02 mm" (the model's display tolerance). They
  are stencil-technique caps with the parity in an offscreen R8 target, so
  the cap shader can close the hairline seams of the non-watertight display
  mesh. Bodies with boundary-only faces are listed "cap unavailable" and get
  no cap; the list also says `not cut`, `clipped away` and `hidden`.
- **Exact contour** posts the active plane to
  `POST /api/models/:id/section`, which runs `sectionSolid` per visible body
  in the query worker, latest wins on both ends. Contours are drawn as blue
  lines on the cut (kernel chip; polylines labelled display ±0.02); kernel
  failures are shown verbatim per body: the adapter's message, the full
  reason chain and the raw reason record. The plane is never nudged.
- Setting "Section" (scope S): on/off, active plane and all planes per
  source, restored after a restart.

## Acceptance

| # | Criterion | Evidence | Result |
|---|---|---|---|
| 1 | `X` shows one plane; the slider moves it; "normal from view" aligns it | Bracket: after `X` exactly one plane `{origin [0, 20, 0], normal [0, −1, 0]}` and a cap (`a1-0-bracket-no-section.png` → `a1-1-x-one-plane.png`). A real mouse drag on the slider moved the plane y = 20 → 18.08, 16.17, 14.26, 12.35, 10.43, 8.52 frame by frame, the renderer's `clipPlanes` followed (`a1-2-slider-dragged.png`). After an orbit, **From view** gave normal (0.0617, −0.9422, 0.3292) = camera direction within 8.5e-7° (`a1-3-normal-from-view.png`). | pass |
| 2 | Caps in body color with the label; a boundary-only body says "cap unavailable" | Bored spacer cut at y = 0: five cap pixels read back from the canvas are exactly the body color (166, 194, 168); the bore behind is a lit face (159, 186, 161), not capped (`a2-1-bored-spacer-caps.png`). Pin-in-bore: two caps in two body colors (`a2-2-…`). Panel tag "display section ±0.02 mm". With a boundary-only face injected into the pin's draw payload (display warning on B2.F1, its triangles removed): panel "B2 model/pin · cap unavailable: 1 boundary-only face (B2.F1)", no cap on B2, B1 capped (`a2-3-cap-unavailable-stage.png`, `-page.png`). Seam leak without and with gap closing: `g-without-gap-closing-crop.png`, `g-with-gap-closing-crop.png`. | pass |
| 3 | The clipped side cannot be picked | Bracket, plane x = 25 (+X cut), 1131-point grid through `renderer.pickDetail`: 58 hits on the removed side without the section, 0 with it. A real hover and click at a point that showed the removed top face (B1.F2 at x = 27.9) now hover and select a kept face (x = 19.9) (`a3-clipped-side-not-pickable.png`). See gap 1 about picking through a cap. | pass |
| 4a | "Exact contour" draws the contours of the bored spacer | z = 5: kernel `Resolved`, two circles r 2 and r 5, drawn on the cap (`a4-1-bored-spacer-exact-contour.png`); status "kernel 2 closed contours on z = 5.00 mm · Lines: display ±0.02 polylines of the kernel curves". | pass |
| 4b | Bracket x = 18 shows the FaceContact message verbatim | "Solid/plane section FaceContact at face 0 (B1.F1)", chain "FaceContact face 0 › VertexContact edge 4 location StartVertex(index 4, point (18, 40, 0), gap 0)", raw record expandable (`a4-2-bracket-x18-facecontact.png`, `-panel.png`). | pass |
| 4c | A cone shows FaceRejected verbatim | Conical spacer z = 5: "Solid/plane section FaceRejected at face 2 (B1.F3)", "FaceRejected face 2 › UnsupportedSurface" (`a4-3-cone-facerejected.png`, `-panel.png`). | pass |
| 4d | The UI stays responsive; a superseded request is cancelled | Requests held 1.5 s in the browser (a slow-kernel stand-in): click A (request at 24 ms), click B at 226 ms → A `net::ERR_ABORTED` at 247 ms, B answered 200 at 1755 ms and was drawn; click C, then the slider moved (1988 ms) → C `net::ERR_ABORTED` at 1997 ms, panel "Exact contour superseded" (`a4-0-pending.png`, `a4-1b-superseded-after-plane-move.png`); counters 4 requests, 2 completed, 2 superseded. 411 frames while pending with an orbit drag: median 8.3 ms, p95 10.2 ms, max 10.3 ms. Server side (unit test): the older of two requests answers 409 and its handler's signal is aborted; a closed request aborts its query. | pass |
| 5 | VS 32/32 and RV 7/7 stay green | `test/viewer-state.test.mjs` 32/32, `test/review.test.mjs` 7/7 | pass |

More evidence: three planes, each capped and clipped by the others
(`e1-three-planes.png`), with x-ray 50 % (`e2-…`); layouts at 1150, 900 and
650 px (`e3-layout-*.png`); compare side by side, caps in both panes
(`e4-compare-side-by-side-caps.png`); setting restored after a server restart
(bracket x = 18 on, `e5-persisted-after-restart.png`); r10b-retained (5
bodies, appearance colors): caps per body (`e6-r10b-one-plane.png`), three
planes with `clipped away` rows (`e6-r10b-three-planes.png`), exact contour
in 450 ms: B1 1 ring, B3 3 rings (outline and two holes), B2, B4, B5 `Empty`,
kernel 3.5 to 229 ms per body (`e7-r10b-exact-contour.png`). Draw time on
r10b-retained (5242 triangles) with 0, 1 and 3 planes: below the 0.1 ms timer
resolution including `gl.finish()`; 8 cap passes with 3 planes (bodies the
plane does not cross are skipped).

## Tests

- `node --test test/viewer-section.test.mjs`: 15/15 (plane math and text,
  settings round trip, plane polygons, gap closing, body scissor, cap
  availability, request validation and the 501 for a bodiless model, chord
  bound of the contour polylines, reason chain, bored spacer / bracket x = 18
  / cone / bracket z = 4 and z = 20 through the real kernel, route latest-wins
  and cancel with an in-process pool, route through the real query worker,
  the feature in the fake browser: `X`, three-plane limit, settings flush,
  exact-contour latest-wins, stale contour, verbatim failure markup).
- `test/viewer-state.test.mjs` 32/32, `test/review.test.mjs` 7/7,
  `test/viewer-render-look.test.mjs` 14/14.
- `test/viewer-core.test.mjs`: "every feature loads and no two commands bind
  the same key" passes with section loaded. Tests 3, 4 (camera) and 9
  (multi-selection, legacy features only) fail independently of this package.
- `test/viewer-server.test.mjs`: 10/12; the query-pool test stops at the
  `printability` handler (fdm), the frozen-stubs test at logical faces
  (topology-classes). `sectionQuery({ bodies: [] }, {})` rejects with 501 as
  that pool test expects (covered in this package's tests).
- `node scripts/viewer/check-format.mjs` ok; `node
  scripts/viewer/check-contracts.mjs --browser …` ok (static and live).

## Gaps

1. **Picking through a cap.** The picker skips the clipped side, but a pixel
   covered by a cap still picks the interior face behind it (a3 probe: the
   bottom face B1.F1 behind the cap). Hover and selection then name a face
   the user cannot see. Needs the picker change in the integration requests.
2. **Gap closing is a display operation.** It closes openings up to
   `2 gap − 1` px (about twice the display tolerance at that zoom, at least
   one pixel): the tessellation seams, but also a real slit that narrow, and
   it can blunt a concave corner of the cut by up to `gap` px. At high zoom
   (more than 6 px of tolerance) a seam can leak again. A watertight display
   mesh would remove the need (integration request 2).
3. The cap outline is not anti-aliased (single-sample parity target); where
   no model edge covers it, the outline shows a pixel staircase. The exact
   contour draws the true outline on demand.
4. Caps of transparent bodies are depth-tested like opaque ones, so a cap
   behind the body's own transparent front face is not visible.
5. Exact contour is per plane (the active tab); with three planes each needs
   its own request. Kernel limits apply (planes and cylinders; cones
   `FaceRejected`; a plane on a face or vertex `FaceContact`), shown, not
   worked around.
6. Keyboard: while the slider or the mm field has focus, `X` is typing (the
   global typing guard); Escape blurs.
7. Section planes are not part of saved reviews (the spec asks for scope S
   only).
8. No 333k-triangle model in the QA set, so the frame budget was measured on
   r10b-retained only.

## Integration requests

1. `viewer/render/picking.js` (frozen, render-transport): when
   `clipPlanes` is non-empty and the winning face triangle is seen from
   behind (the payload winds triangles outward, so the sign of the
   barycentric `denominator` of the winning triangle is the opposite of the
   sign a front face gives), the pixel shows a section cap. Then return no
   face hit, and keep its depth as the occluder so edges and points behind
   it are not picked either: after the triangle loop,
   `if (clipped && winningBackFacing) { face = -1; faceHit = null; }` with
   `faceDepth` unchanged. Optionally report `{ cap: true }` in `pickDetail`
   so the hover line can say "display section cap".
2. Display tessellation (`src/review-scene.mjs`, `src/display-cylinder.mjs`,
   owner of the display pipeline): sample cylinder and cone rims at the same
   points as the adjacent face boundaries (the edge polylines), so the
   display mesh is watertight; then the caps' gap closing can drop to zero.
3. `docs/viewer/contracts.md` (maintainer): if the section DOM ids should
   be frozen: `#section-toggle`, `#section-panel`, `#section-slider`,
   `#section-value`, `#section-exact`, `#section-exact-status`,
   `#section-caps`, and the debug names `sectionState`, `sectionStats`,
   `setSectionPlanes`, `sectionExact`, `sectionNormalFromView`,
   `sectionDebugGap`.
4. `viewer/features/display/legend.js` (display, optional): the "display
   section" item could name caps in its title ("clip planes and caps from the
   display mesh; exact contours on demand").
5. Native bridge: include `src/viewer/section.mjs` → `sectionSolid` in the
   surface scan (spec 14 already lists it).
