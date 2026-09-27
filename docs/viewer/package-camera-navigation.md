# Package report: camera-navigation

Wave 1, P0, 2026-09-23. Behavior and interfaces: `docs/viewer/camera-navigation.md`.
Screenshots and numbers: `out/viewer/camera-navigation/` (`qa-report.json`).
QA drivers (tmp, not committed): `tmp/viewer/camera-navigation/qa/` —
`prefix.mjs` (legacy review and pre-fix screenshots with the frozen foundation
client), `run.mjs` (all acceptance items), `responsive.mjs` (breakpoints),
`debug-zoom.mjs` (picker probe for integration request 5), `common.mjs`,
`entry.mjs`.

## What it does

- **The mirrored view is fixed.** One right-handed world camera
  (`viewer/render/camera.js`, convention 2) drives the shader matrix, the
  picker, the overlays, the triad and the annotation geometry. Screen X is
  flipped and yaw/pitch keep their meaning, so a saved camera still looks at
  the same side of the part. Top shows the bracket as the upright L of
  `out/visual-comparison/1-after.png`; Front looks from −Y.
- **Frozen camera API** (spec 7.1) with `lookFrom` presets, physical zoom
  limits (1 µm to 10 m per CSS px), a ±90° pitch clamp, orthographic (default)
  and 35° perspective, near/far from the bounding sphere, and
  `fromLegacy`/`toLegacy`.
- **Fit policy:** the first model of a session gets the source's saved camera
  or the fitted Iso view; another revision of the same source keeps the camera
  exactly; a model from another source is fitted keeping the orientation.
- **Views:** number row and numpad (OCP layout, NumLock on or off),
  Shift+1…7 (Onshape order), 0/Home (default view), F (fit, orientation
  kept), O (projection), the Views menu behind `#view-presets`, a projection
  button, the projection legend, the axis triad and the origin marker.
- **Navigation:** zoom toward the cursor in both projections (perspective
  anchors at the model point under the cursor), pan that follows the pointer,
  arrows 15°/5°/90° (Ctrl+Shift pans), Ctrl+wheel pinch, optional trackpad
  mode. Drag now rotates the model with the pointer (OCP/Onshape grab
  direction); arrows turn it the way a drag would.
- **Persistence:** last camera per source (settings scope S, debounced, plus a
  `keepalive` write on `pagehide`), projection and trackpad mode global.
- **Legacy reviews (D6):** legacy cameras convert with the same eye direction;
  legacy drawings are mirrored within their pane (single, side by side, wipe
  over one model) and sit over the same vertices as before the fix; legacy
  wipe drawings over two different models are hidden with the note. Review
  camera validation accepts both conventions; RV is unchanged.

## How to use it

```
node bin/wonky-view.mjs part.fs                 # or .brep.json models
# 1 3 4 6 8 2 5: Front Back Left Right Top Bottom Iso (row or numpad)
# Shift+1..7: the same views in Onshape order; 0 or Home: default view
# F: fit, keeping the orientation; O: perspective on/off
# arrows (viewport focused): 15°, Ctrl/⌘ 5°, Shift 90°, Ctrl+Shift pan
# wheel: zoom toward the cursor; the cube button opens the Views menu
```

Edits of the source keep the camera; clicking another source fits it. The
camera of each source is back after a reload or a `wonky-view` restart.

Until integration request 1 is applied, the browser loads the foundation
`view.js`; the QA serves the requested one-line re-export through a
Playwright route (`common.mjs`, mode `tree`: everything else is the current
working tree, parallel packages included).

## Evidence

Browser: headless Chromium via `scripts/viewer/qa/browser.mjs`, 1536 × 900,
own instance on port 4352 (stopped after every run), live source
`tmp/viewer/camera-navigation/live/two-blocks.fs` plus `.brep.json` inputs.
Load average 47–106 during QA. Final run 2026-09-23 00:58, 19/19 checks
(`qa-report.json`). Console: only the four expected `400` responses of the
deliberately invalid review posts.

| # | Acceptance | Status | Evidence |
|---|---|---|---|
| 1 | Top (8) of the bracket shows the upright L like `1-after.png`; Front (1) shows −Y; triad agrees in all 7 views | pass | `top-vs-reference.png` (viewer Top, reference, pre-fix mirrored Top), `view-{1..8}-*.png`. Projected outline and picks: the notch is upper right and empty, the post hit at z = 8. Front: the face hit at the center lies on y = 0. Triad tips parallel to the projected axes (cosine ≥ 0.9999, end-on axes exact) in all 7 views; labels e.g. "+X right, +Y up, +Z toward you" (Top). Unit: triad test for all seven presets. |
| 2 | Number row, numpad with NumLock on and off, Shift+1…7 select the same 7 views; 0/Home default; F fits keeping orientation; `#view-presets` opens the Views menu; both buttons clear hover | pass | 28 key variants give the exact preset angles (NumLock off: `Numpad2` + `ArrowDown` etc.). `0`, `Numpad0`, `Home` give `defaultCamera(bounds, pane)` exactly. F: yaw/pitch unchanged, height refitted (`fit-keeps-orientation.png`). `views-menu.png`: menu open, `aria-expanded=true`, hover null after the click; `#fit-view` also clears hover. Units: key tests, typing guard, modifiers. |
| 3 | Point under the cursor stays within 1 px while wheel-zooming; pitch stops at ±90°; r10b 0.2 mm ≥ 100 px | pass | 30 wheel samples (ortho and perspective, cursor over the top face z = 8, the front face y = 0 and the background; the point is the cursor ray ∩ the exact face plane): max error 2.3e-13 px. Mouse drags: pitch −π/2 and +π/2 exactly (`pitch-clamped-top.png`). r10b: 60 wheel steps reach 1000 px/mm (1 µm/px); 0.2 mm = 200 CSS px at the limit; `r10b-limit-1um-per-px.png`, `r10b-0.2mm-at-100px.png` (a visible B-rep corner with a 0.2 mm = 100 px scale bar). Unit: zoom invariant, limits, dolly toward the picked point. |
| 4 | O toggles perspective; the legend names the projection | pass | Legend "Orthographic · Isometric" → "Perspective 35° · Isometric" → "Orthographic · …" (`projection-orthographic.png`, `projection-perspective.png`). Unit: O keeps target, height and orientation; setting G `projection`. |
| 5 | Revisions of one source keep the camera exactly (pixel-identical static regions); a model from another source fits | pass | Live source edited twice (height 8 → 6: same bounds; 6 → 14: bounds grow). Camera JSON identical after Refresh and after clicking r2, r1, r3. WebGL canvas read back after a synchronous draw, static region (everything outside the moving block's screen box + 3 px, 725,190 px): r1 vs r2 0 differing, r1 vs r1 again 0 (also inside), r1 vs r3 0; the changed box differs (5,109 and 14,712 px). `revision-r{1,2,3}.png`, `revision-r1-vs-r2-diff.png`, `revision-r1-vs-r3-diff.png`. Clicking bored-spacer: same yaw/pitch, target = its bounds center, new height (`other-source-fits.png`). Unit: fit policy test. |
| 6 | Legacy review loads; single-mode drawings over the same geometry as the pre-fix screenshot; wipe drawings over two models hidden with the note; new review has `cameraConvention: 2`; RV legacy posts accepted, invalid rejected | pass (field needs request 2) | A genuine legacy review saved by the frozen foundation client (`prefix.mjs`, `WKR-DD9C28072A`): 8 drawings anchored on B-rep vertices, 0 px error before the fix. After the fix: single (comment, arrow, box, pen), side by side (2) and wipe over one model: max error 1.2e-13 px, `viewMatches` true, markers drawn (`legacy-annotation-{3,5,6}-before-after.png`, `prefix-annotation-*.png`, `fixed-annotation-*.png`). Wipe over two models: not drawn, `#legacy-drawings-note` "1 drawing hidden. Drawn on the legacy mirrored wipe view; cannot be re-projected." Re-saved review: `cameraConvention: 2`, `camera.convention: 2`, the 8 legacy annotation cameras kept as they were; the legacy file untouched. Posts: legacy 201, zoom 0 → 400, pan of one number → 400, text yaw → 400, world 201, bad projection 400. RV 7/7. |
| 7 | Arrows 15°, Ctrl 5°, Shift 90° with canvas focus; camera per source survives a restart | pass | Measured deltas: −15°, +5° (Ctrl), +5° (⌘), +90° (Shift), pitch +15°, −5°. No orbit without canvas focus (unit). Restart: `wonky-view` stopped and started with the same reviews directory, the bracket opens with the byte-identical camera (`restart-before.png`, `restart-after.png`). |
| 8 | Unit tests: det +1 for presets and 100 random angles; Top +Y up, +X right; picker and renderer within 1e-6 px; legacy round trip 1e-9 | pass | `test/viewer-camera.test.mjs` 12/12: determinant, presets and poles, `project`/`unproject`/`viewProjection` agreement for 100 random cameras × panes in both projections (1e-6 px), clip depth order, `fromLegacy` mirror relation and round trip (1e-9), zoom limits, pitch clamp, fit, legacy drawing rules, `projectLegacy` bit-identical to the pre-foundation formula. |
| 9 | VS 32/32 with `test/viewer-state.test.mjs` unchanged | pass | 32/32 on the shared tree with the foundation `view.js`, and 32/32 with `view.js` resolved to `navigation.js` (`node --import tmp/viewer/camera-navigation/redirect-view.mjs test/viewer-state.test.mjs`). |

Other gates: `test/viewer-camera-navigation.test.mjs` 15/15 (keys, menu,
projection, fit policy, persistence and restore, keepalive on `pagehide`,
archived snapshots not persisted, legacy conversion and re-anchoring,
legacy drawings, review camera validation, triad, zoom anchor in both
projections, cameraConvention in views). RV 7/7, DC 5/5, DE 2/2, GS 11/11,
viewer-render-transport 15/15, viewer-model-first-compare 18/18,
viewer-measure 17/17, viewer-exact-measure 12/12 (11/12 once request 1 is
applied, until request 4). `check-format.mjs` and `check-contracts.mjs` ok.
Breakpoints 1536/1150/900/650 (`responsive-*-menu.png`,
`responsive-*-side-by-side.png`): the Views menu stays inside the viewport,
the triad inside the stage, origin markers clipped per pane.

## Integration requests

1. **`viewer/features/view/view.js`** (the entry `features/index.js`
   loads): replace the whole file with

   ```js
   // View feature entry: camera-navigation (render/camera.js convention 2).
   export { id, legacy, setup } from './navigation.js';
   ```

   Until then the old feature runs: VS stays 32/32, the image is already
   right-handed (panes convert its legacy camera), but orbit, pan and wheel
   use the old rules and none of the new keys, menu, triad or policy exist.
   After it, `LEGACY_PRESET_CYCLE` in `camera.js` has no caller left (kept
   only for the old `view.js`); `defaultLegacyCamera()` stays, because
   `features/compare/load-models.js` uses it as the fit-policy request.
2. **`src/viewer/reviews.mjs`**: record the convention of new reviews. Change
   the import to
   `import { cameraConventionField, validateReviewCamera } from './review-camera.mjs';`
   and the returned record in `validateReview` to
   `camera: validateReviewCamera(value.camera), ...cameraConventionField(validateReviewCamera(value.camera)), annotations,`
   (or validate once into a `camera` constant). RV is unaffected (legacy
   cameras yield `{}`). The QA applies exactly this change in memory
   (`qa/entry.mjs`). Optional: keep `cameraConvention: 2` on annotation views
   in `view()`; the viewer does not need it (the annotation camera form
   decides).
3. **`test/viewer-core.test.mjs`**: the two convention-1 camera tests
   ("camera exports the frozen API and reproduces the pre-foundation
   projection exactly", "camera presets, basis, lookFrom and fit keep the
   pre-foundation conventions") fail by design now; delete them with their
   helpers `legacyProject` and `randomSource` and the then unused imports
   `camera` and `computePanes`. Their convention-2 counterparts, including
   the bit-identical `projectLegacy` check, are in
   `test/viewer-camera.test.mjs`. After request 1, in "keyboard dispatch
   keeps the pre-foundation guards" replace
   `assert.equal(state.camera.yaw, yaw - 0.12);` with
   `assert.ok(Math.abs(state.camera.yaw - (yaw - 15 * Math.PI / 180)) < 1e-12);`.
4. **`test/viewer-exact-measure.test.mjs`** (after request 1): the camera has
   no `pan` any more. In "Shift-click with 2 px jitter …" take
   `const target = [...ui.state.camera.target];` before the presses and assert
   `assert.deepEqual(ui.state.camera.target, target, 'the jittery Shift-click did not pan');`
   and `assert.notDeepEqual(ui.state.camera.target, target, 'a 4 px Shift-drag pans');`.
5. **render-transport, `viewer/render/picking.js`**: in perspective the face
   hit point and face depth use screen-space barycentric weights; they must
   be perspective-correct (weights `u / w_a`, `v / w_b`, `w / w_c`,
   normalized, with `w` the clip w of each vertex). Measured on the bracket
   top face: `pick.detail` returns a point 24.7 px (top) and 33.4 px (front
   face) off the cursor (`qa-report.json`, `debug-zoom.mjs`). Zoom is not
   affected (any anchor on the cursor ray keeps the ray under the cursor; the
   pick depth only decides where the perspective eye converges), but measure
   anchors and hover depth order in perspective are.
6. **help-a11y, `docs/viewer-ui.md`** (German): the key table should read
   `| 1 3 4 6 8 2 5 (Zahlenreihe oder Ziffernblock) | Vorne, Hinten, Links, Rechts, Oben, Unten, Iso |`,
   `| Umschalt+1 … 7 | dieselben Ansichten (Onshape-Reihenfolge) |`,
   `| 0 / Pos1 | Standardansicht (Iso, eingepasst) |`,
   `| F | Einpassen, Blickrichtung bleibt |`, `| O | Orthografisch / Perspektive |`,
   `| Pfeiltasten bei fokussiertem Viewport | Drehen 15°, Strg 5°, Umschalt 90°, Strg+Umschalt verschieben |`;
   and a sentence: „Das Mausrad zoomt zum Mauszeiger. Die Kamera bleibt beim
   Wechsel zwischen Revisionen derselben Quelle stehen; ein Modell einer
   anderen Quelle wird eingepasst. Alte Reviews zeigen ihre Zeichnungen
   gespiegelt an derselben Geometrie; Zeichnungen einer Wipe-Ansicht über zwei
   verschiedene Modelle werden mit Hinweis ausgeblendet.“ If help-a11y adds
   the single-key-shortcut setting (WCAG 2.1.4), the digit-code listener in
   `navigation.js` must honor it too (see gaps).

## Gaps

- **Integration pending.** Requests 1–4 are needed on the shared tree; until
  then the old `view.js` runs and viewer-core tests 3 and 4 fail there (they
  assert convention 1). viewer-core test 9 (multi-selection buffers) fails
  for render-transport reasons, not this package.
- **Digit keys bypass `core/keyboard.js`.** It matches `event.key` only, so
  `Digit*`/`Numpad*` codes are handled by a capture listener on `window`.
  The commands carry the code keys for help and conflict checks, but a future
  global "single-key shortcuts off" setting has to be checked there as well,
  or `keyboard.js` learns `event.code` matching and the listener goes.
- **Camera scope U (URL) is not implemented**; a reload restores the camera
  through scope S. A camera saved at another window size is restored as is
  and may crop the model in a much narrower window (F fits).
- **The automatic fit does not follow later resizes.** Fit happens on the
  first revision, on request and on a source switch, as specified; resizing
  the window scales the view with the shorter pane side.
- **Origin marker** is an SVG overlay, not depth-tested; depth-tested origin
  axes and the plate come with fdm/render-look. The triad sits in the stage
  slot because `index.html` has no `viewportHud.bottom-left` region.
- **Perspective pick accuracy** depends on request 5.
- **No view cube, normal-to, or orbit about the picked point** (spec 14,
  deferred). Views keep target and zoom; F fits.
- **Orbit direction changed.** Drag and arrows now turn the model with the
  pointer (grab semantics, as OCP's orbit controls); before the fix the
  mirrored view moved the camera with the pointer. Arrow Up tilts the model's
  front up (more of the bottom shows), like dragging up.
- The QA's isolated mode (`run.mjs --mode fixed`, foundation snapshot for
  every non-owned file) was not re-run in its final form: the current
  checks use render-transport's `pickDetail`, which the foundation renderer
  lacks. The tree run is the integration-relevant evidence.
