# Camera, views and navigation

Package `camera-navigation` (wave 1, P0) of `docs/viewer/spec.md` (7.1, D6,
D13, section 5). This page describes the behavior and the interfaces.
Evidence, integration requests and open gaps are in
`docs/viewer/package-camera-navigation.md`.

## The camera (convention 2)

One right-handed, world-space camera in `viewer/render/camera.js` (pure, no
DOM) feeds the shader matrix, the picker, the SVG overlays, the triad and the
annotation geometry. There is no second projection anywhere.

```
{ convention: 2, projection: 'orthographic' | 'perspective',
  target: [x, y, z] mm (float64), yaw, pitch, height }
```

- **yaw, pitch** (radians) keep their pre-fix meaning: yaw 0 puts the eye on
  the +Y side, pitch −π/2 looks straight down, larger depth is nearer. The fix
  flips screen X, so a saved yaw/pitch still shows the same side of the part,
  now unmirrored: `basis(camera)` returns `{right, up, toward}` with
  `right × up = toward` (determinant +1 for every angle). Before the fix the
  basis had determinant −1 and every view, the Top view included, was a
  mirror image.
- **Z-up turntable.** Pitch is clamped to ±90° (no pole flip). A restored
  legacy pitch beyond the limit is kept, and only moves back toward the
  limit. Yaw is never normalized.
- **height** is the world size (mm) that the shorter side of a pane shows at
  the target: px per mm = min(pane width, pane height) / height. The view
  scales with its pane, like the legacy camera, so side-by-side panes share
  one scale and an annotation drawn at one viewport aspect lands on the same
  geometry at another (VS test 31). Spec 7.1's `scale` is
  `depthPerPixel(camera, pane)` = height / min side (mm per CSS px).
- **Zoom limits are physical:** 1 µm to 10 m per CSS px (`MM_PER_PX`,
  `heightLimits(pane)`), whatever the model size. On r10b-retained a 0.2 mm
  clearance reaches 200 CSS px (the old limit was 25× of the fit, 10 px).
- **Perspective** uses a 35° field of view across the shorter pane side. The
  eye sits `height / (2 tan 17.5°)` from the target, so the target plane keeps
  its scale when the projection is toggled. Orthographic is the default.
- **Near/far** come from the bounding sphere of the bounds passed to
  `viewProjection` (the displayed model's bounds), with a small margin.

Frozen API (spec 7.1), plus helpers:

| Function | Result |
|---|---|
| `defaultCamera(bounds, pane?, projection?)` | Iso view fitted to the bounds (legacy fit without a pane) |
| `viewProjection(camera, pane, bounds, {relativeTo})` | column-major 4×4 world → clip; agrees with `project()` within 1e-6 px (tested) |
| `project(point, camera, pane, bounds)` | `{x, y, depth}` CSS px; perspective points behind the eye are NaN |
| `unproject(x, y, depth, camera, pane, bounds)` | world point at that view depth |
| `basis(camera)` | `{right, up, toward}`, right-handed |
| `lookFrom(direction, up, camera)` | same target and height, eye along `direction` |
| `preset(name, camera)` | one of `front back left right top bottom iso` |
| `fit(bounds, camera, pane)` | keeps orientation and projection; the projected bounds box fills 80 % of the pane |
| `depthPerPixel(camera, pane, bounds)` | mm of view depth per CSS px (picker tolerance, edge bias) |
| `fromLegacy({yaw, pitch, zoom, pan}, {center, extent})` | convention-2 camera with the same eye direction, center point and scale; the image is the legacy image mirrored about the pane center; a world camera passes through as a copy |
| `toLegacy(camera, {center, extent})` | inverse of `fromLegacy` (round trip within 1e-9, tested) |
| `orbit`, `panBy`, `zoomAt(camera, pane, x, y, factor, depth = 0)`, `clampPitch`, `heightLimits`, `presetOf`, `sameCamera`, `boundsFrame`, `unionBox`, `projectLegacy` | navigation helpers; `projectLegacy` reproduces the pre-fix projection bit for bit (legacy drawings, tests) |

Legacy cameras (`{yaw, pitch, zoom, pan}`, no `convention`) are accepted by
every function that takes a camera; they are read in the bounds frame of the
bounds passed in.

## Standard views

Presets are defined by `lookFrom`, as in Onshape and OCP. The direction points
from the target to the eye.

| View | Eye from | Screen right | Screen up |
|---|---|---|---|
| Front | −Y | +X | +Z |
| Back | +Y | −X | +Z |
| Left | −X | −Y | +Z |
| Right | +X | +Y | +Z |
| Top | +Z | +X | +Y |
| Bottom | −Z | +X | −Y |
| Isometric | (+1, −1, +1) | | +Z side |

Top shows the bracket as an upright L, the same orientation as
`out/visual-comparison/1-after.png`. A preset keeps the target and the zoom;
`F` fits afterwards.

## Keys and mouse

Digits match `event.code`, so the number row, the numpad with NumLock on and
off (Numpad2 then arrives as `ArrowDown`) and Shift+digit work on QWERTZ and
QWERTY alike. `core/keyboard.js` matches `event.key` only, so the view
feature handles `Digit*` and `Numpad*` codes in a capture listener on
`window` and stops them before the core dispatch. The commands are still
registered with their code keys (`Digit1`, `Numpad1`, `Shift+Digit1`), so help
and the conflict test see them. Shortcuts never fire while typing or with
Ctrl, ⌘ or Alt.

| Key | Action |
|---|---|
| 1 3 4 6 8 2 5 (row or numpad) | Front, Back, Left, Right, Top, Bottom, Iso (OCP numpad layout) |
| Shift+1 … Shift+7 | Front, Back, Left, Right, Top, Bottom, Iso (Onshape order) |
| 0, Numpad 0, Home | Default view: Iso, fitted (the old `F`) |
| F | Fit, keeping the orientation and the projection |
| O | Orthographic / perspective |
| E | Feature edges on/off (unchanged) |
| Arrows (viewport focused) | Orbit 15°; Ctrl or ⌘ 5°; Shift 90°; Ctrl+Shift pans 40 px |

| Gesture | Action |
|---|---|
| Drag (Select or Orbit tool) | Orbit about the target (grab semantics: the model follows the pointer) |
| Shift-drag, middle or right drag | Pan; the model follows the pointer exactly |
| Wheel | Zoom toward the cursor |
| Ctrl+wheel (trackpad pinch) | Zoom toward the cursor; pinch deltas count 10× (they are small) |
| Two-finger scroll with Trackpad mode (setting) | Pan |

**Zoom to the cursor.** The camera is scaled about a point on the cursor ray,
so every point on that ray stays under the cursor, in both projections (tested
to 1e-7 px; browser QA 1e-13 px). Orthographic zoom anchors at the target
plane, so the orbit pivot keeps its depth. Perspective zoom anchors at the
model point under the cursor (display pick, face mode): the eye dollies toward
that point and never passes through the surface. The pick is taken once per
wheel gesture and reused while the cursor rests; without a hit the target
plane is used.

## Views menu, triad, origin marker, legend

- `#view-presets` (cube icon) opens the **Views** menu: the seven views with
  their keys, Default view, Fit, and Perspective (a checkbox item). Arrow
  keys, Home and End move, Enter or Space choose, Escape closes it (Escape
  stack) and returns focus to the button, a press outside closes it.
  Clicking `#view-presets` or `#fit-view` clears the hover preview.
- `#toggle-projection` next to it toggles the projection (`O`).
- **Axis triad** (bottom left, `#view-triad`): world +X (red), +Y (green),
  +Z (blue) as the camera sees them; an axis pointing at the viewer is a
  filled dot, one pointing away a ring. Its `aria-label` spells the axes out
  ("Axis triad: +X right, +Y up, +Z toward you"). It is computed from the same
  `basis()` as the render, so it agrees with the model in every view (tested
  for all seven).
- **Origin marker**: a small ring with 14 px axis stubs at the projected world
  origin in every pane (SVG overlay layer `view.origin`, titled "World origin
  (0, 0, 0)"). It is an overlay, not depth-tested; plate and origin axes with
  depth belong to the fdm package.
- **Projection legend** (status line, `#projection-legend`): "Orthographic" or
  "Perspective 35°", plus the view name when the camera shows a standard view
  exactly ("Orthographic · Top"). Clicking it toggles the projection.

## Fit policy (spec D13)

The model loader assigns `defaultLegacyCamera()` after every load it wants
fitted (`loadSelectedModels(true)`). The view feature treats that value as a
request for its policy instead of a camera:

- **First model of the session:** the camera last used for its source
  (settings scope S), else the default view (Iso, fitted).
- **Another revision of the same source** (same library source key): the
  camera is kept exactly, number for number. A live rebuild, a Refresh or a
  click on another revision never moves the view.
- **A model from another source:** fit, keeping the orientation and projection.
  "Source" here is the set of sources on screen (the model, plus the before
  model in compare mode): choosing a before model from another source fits
  both, so neither is off screen (CMP-09; fixed 2026-09-23, before that only
  the after model's source counted). Revisions of the shown sources keep the
  camera.
- The projection setting (`G projection`) applies whenever it changes, also
  from the Settings dialog, not only at load.
- `F` fits, `0`/Home resets, views keep target and zoom.

Assigning a camera (a saved review, an annotation jump) always wins. The
camera never marks a review dirty (spec D9).

## Persistence

| Setting | Scope | Key | Default |
|---|---|---|---|
| Last camera | S (source) | `camera` | none: default view |
| Projection | G | `projection` | `orthographic` |
| Trackpad mode | G | `trackpadMode` | off |

The camera is written 600 ms after the last user change, and on `pagehide`
with a `keepalive` request, so it survives a reload and a `wonky-view`
restart. The source key is the library's (live source path or `.brep.json`
input path). Archived snapshots have no source; they count as their own
source (the model id) and are never persisted, so the settings file does not
grow per revision. Applying a saved camera takes the global projection.

## Legacy reviews (spec D6)

Reviews saved before the fix have legacy cameras (no `convention`) and
screen-space drawings made on the mirrored view.

- **Cameras** convert with `fromLegacy` in the bounds frame of the displayed
  models (the frame the legacy camera was relative to): same eye direction,
  same center point, same scale. The legacy image is mirrored about the pane
  center; the same side of the part is visible.
- **Drawings** (`render/panes.js`, `legacyDrawing(annotation)`):
  - `current`: the annotation camera is a world camera, or its view records
    `cameraConvention: 2` (drawn on the right-handed view): drawn as saved;
  - `mirrored`: a legacy drawing in single mode, side by side, or a wipe over
    one model: mirrored in X within its pane (side by side: its half), which
    puts it back over the same geometry (browser QA: 0 px error on every
    anchored vertex);
  - `hidden`: a legacy drawing in a wipe over two different models. The two
    halves of the old wipe would swap sides, so it cannot be re-projected.
    It is not drawn; `#legacy-drawings-note` says "N drawing(s) hidden.
    Drawn on the legacy mirrored wipe view; cannot be re-projected."
- Old review files are never rewritten. A review saved now stores world
  cameras (`convention: 2`) for the review and every new annotation, and
  `cameraConvention: 2` at the top level (with the requested one-line change
  to `src/viewer/reviews.mjs`, see the package page). The per-annotation
  camera form, not the review-level field, decides how a drawing is shown, so
  a re-saved legacy review with mixed drawings stays correct.

Server validation (`src/viewer/review-camera.mjs`): `validateReviewCamera`
accepts both forms; the key `convention` decides. Legacy rules are unchanged
(finite yaw/pitch/zoom, 0 < zoom ≤ 100, pan of two finite numbers). World
cameras need `convention: 2`, a known projection, finite yaw/pitch, 1e-9 ≤
height ≤ 1e9 mm and a finite target within ±1e9 mm. `cameraConventionField`
returns `{cameraConvention: 2}` for a world camera and `{}` for a legacy one.

## Interfaces for other features

- State facade: `state.camera` (the world camera; assigning a legacy camera
  converts it, a `center`/`extent` assigned in the same turn re-anchors it,
  VS assigns all three), `state.center`, `state.extent` (bounds frame kept
  by the model loader), `state.preset` (name of the last chosen view or
  null).
- `ctx.app`: `fit()`, `defaultView()`, `applyPreset(name)`,
  `toggleProjection()`, `viewCamera()` (world camera), `applyCameraPolicy()`,
  `currentView()`, `viewMatches(annotation)`.
- `ctx.panes.camera()` returns the world camera every pane shares; the
  picker and the renderer use it through `cameraFor`.
- Commands: `view.front … view.iso`, `view.default`, `view.fit`,
  `view.projection`, `view.menu`, `view.toggleEdges`, `view.trackpadMode`,
  `view.orbit.Arrow*`.
- Settings items (`slots.settings.item`): `view.projection`,
  `view.trackpadMode`.

## Files

`viewer/render/camera.js`, `viewer/render/panes.js`,
`viewer/features/view/{navigation,view-menu,triad,view-match}.js`,
`viewer/features/view/view.css`,
`viewer/features/annotations/annotation-geometry.js`,
`src/viewer/review-camera.mjs`; tests `test/viewer-camera.test.mjs`,
`test/viewer-camera-navigation.test.mjs`.
