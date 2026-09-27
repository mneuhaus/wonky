# Package topology-classes: exact edge classes and logical faces

Wave 1, P0 (spec section 12). Status: implemented 2026-09-23. The reference
for the rules, tolerances and API is `docs/viewer/topology-classes.md`.

## What it does

- `classifyEdges(model, scene)` (`src/viewer/edge-classes.mjs`) classifies
  every edge as `sharp`, `tangent`, `seam`, `subdivision` or `unresolved`
  from the stored analytic parameters. An edge is `subdivision` when both of
  its faces lie on the identical oriented support within the body tolerance
  and its recorded `construction.edgeOrigins` entry does not contradict that
  (`FaceSubdivision` and `SurfaceSeam` confirm, `FaceIntersection`
  contradicts, an inherited `OriginalEdge` or a missing record is neutral).
  When the evidence disagrees the edge is `unresolved`, with the reason, and
  the faces are not merged. A chain of subdivisions whose fragments drift off
  one support is also `unresolved`.
- `logicalFaces(model)` (`src/viewer/logical-faces.mjs`) joins fragments
  across `subdivision` edges only, with aliases `B<b>.L<n>` and the shared
  support. Fragment aliases (`B1.F14`) stay the canonical references.
- `GET /api/models/:id/topology[?detail=summary]`
  (`src/viewer/routes/topology.mjs`) serves both per body: counts, logical
  face groups with fragment aliases and support, and per edge the class, the
  two faces, the support relation, the recorded origin, the normal angle range
  and, where it applies, the reason. Exactness: classes and groups
  `exact-parameters`, origins `recorded`.
- QA fixture `scripts/viewer/qa/fixtures/coplanar-pads.fs`: a plate with two
  pads whose tops share the plane z = 8. `node scripts/viewer/qa/fixtures.mjs`
  builds it into `tmp/viewer/fixtures/coplanar-pads.brep.json`.

Both functions keep their frozen signatures and only add fields. They use no
display mesh and no kernel call, so the same module runs in the server, the
live build worker (`src/viewer/live/build-worker.mjs` imports it), the query
worker (`draw.mjs` calls it for the draw payload) and in tests.

## How to use it

```sh
curl -s http://127.0.0.1:<port>/api/models/<id>/topology?detail=summary
```

```js
const classes = classifyEdges(model);
const logical = logicalFaces(model, { classes });
```

The viewer uses it through render-transport (edge classes in the draw
payload, hover and selection expand to the logical face), exact-measure
(`logical` and `fragments` per face in `/geometry`) and model-first-compare
(logical face counts). render-look will hide `seam` and `subdivision` edges
and dim `tangent` ones.

## Evidence

Tests (all green, `nice node --test …`):

- `test/viewer-topology-classes.test.mjs` (14 tests): synthetic strips and a
  synthetic cylinder pin every rule: FaceSubdivision confirmation, support
  alone without a record or with OriginalEdge, legacy bodies,
  FaceIntersection contradiction, a tilted fragment recorded as subdivision,
  a reversed fragment (fin), a drifting chain (0.7 × the angular tolerance per
  step, not merged), seams in opposite versus equal directions, missing
  tolerance, an unsupported curve and surface, an edge off its support,
  determinism and caching. Kernel-built models (cached in
  `tmp/viewer/topology-classes/cache/`, keyed by source and kernel file
  stats) pin the acceptance counts below.
- `test/viewer-topology.test.mjs` (4 tests): the route on a real server; the
  same results in-process, in a forked child process with advanced
  serialization, in a worker thread and through the query pool (deep-equal
  for pocket plate, arc slot, bored spacer and r10b-retained); r10b timing;
  a `prepare` job on the real live build worker yields the same logical face
  counts and no error note.

Results (kernel output, not the frozen audit numbers):

| Model | Raw faces | Logical | Edges | sharp | tangent | seam | subdivision | unresolved |
|---|---|---|---|---|---|---|---|---|
| pocket plate | 46 | 11 | 92 | 44 | 0 | 0 | 48 | 0 |
| arc slot | 6 | 6 | 12 | 8 | 4 | 0 | 0 | 0 |
| bored spacer | 4 | 4 | 6 | 4 | 0 | 2 | 0 | 0 |
| coplanar pads | 70 | 16 | 140 | 64 | 0 | 0 | 76 | 0 |
| frame with tab | 64 | 14 | 128 | 68 | 0 | 0 | 60 | 0 |
| r10b-retained (5 bodies) | 172 | 172 | 402 | 362 | 0 | 40 | 0 | 0 |
| bracket (legacy) | 8 | 8 | 18 | 18 | 0 | 0 | 0 | 0 |
| cross bore | 7 | 7 | 15 | 14 | 0 | 1 | 0 | 0 |
| conical spacer | 3 | 3 | 3 | 2 | 0 | 1 | 0 | 0 |

- Pocket plate: the 48 subdivision edges are exactly the 48 `FaceSubdivision`
  edges; every logical face lies on one plane and the 11 planes are distinct.
- Arc slot: the tangent edges are the four line/arc transitions
  (B1.E9 to B1.E12); the four side lines and the four circle rims are sharp.
- Bored spacer: B1.E5 is the seam of the bore B1.F3, B1.E6 the seam of the
  outer cylinder.
- Coplanar pads: the pad tops B1.L10 = [B1.F62] and B1.L16 = [B1.F70] stay
  two logical faces; the plate top around both pads is one logical face
  B1.L6 with 13 fragments.
- Frame with tab: every inner wall is one logical face with all its
  fragments: x = 8 is B1.L13 = [F45, F46, F49]; x = 42 is B1.L2 =
  [F6, F18, F20]; y = 8 and y = 32 are single faces. The outer wall at
  x = 50 is correctly two logical faces (the tab interrupts it).
- Timing, r10b-retained, medians of 5 at load average 33 to 86: in-process
  2.0 to 6.3 ms, forked child 11 to 14 ms, worker thread 8.7 to 9.9 ms,
  server `computeMs` 3.4 to 5.8 ms. A 4 × 4 grid of r10b (80 bodies,
  2752 faces) takes 30 ms.

Browser QA on a private viewer (port 4356, stopped afterwards),
`out/viewer/topology-classes/qa-topology.mjs`, Playwright via
`scripts/viewer/qa/browser.mjs`: 30/30 checks in `qa-results.json`. The
browser opens `/api/models/<id>/topology` for pocket plate, arc slot, bored
spacer, coplanar pads, frame with tab and r10b-retained and checks every
acceptance item against exact face planes from `/geometry`. It also decodes
the draw payload (query-worker kind `draw`) in the page with
`/viewer/render/draw-decode.js`: its edge classes and logical faces equal the
route for all six models (0 mismatches over 780 edges). No console errors.

Screenshots in `out/viewer/topology-classes/`:

- `pocket-plate-topology-summary.png`, `pocket-plate-topology-full.png` and
  `<model>-topology-summary.png`: the route as the browser shows it.
- `<model>-classes.png`: an isometric QA drawing from the display scene with
  one fill per logical face and edges colored by class (sharp dark, tangent
  blue, seam green dotted, subdivision red dashed). Pocket plate with the
  floor B1.L8 highlighted, coplanar pads with both pad tops highlighted, frame
  with tab from two sides with the multi-fragment inner walls highlighted.
- `viewer-pocket-top-hover.png`, `viewer-pocket-top-selected.png`
  (`qa-viewer-logical.mjs`): in the viewer, hovering and clicking one
  fragment of the pocket plate top highlights all 8 fragments of B1.L1.
- `viewer-frame-wall-left.png` (`qa-viewer-frame-wall.mjs`): clicking B1.F49
  highlights the whole inner wall B1.L13.
- `viewer-pocket-floor-selected.png`: the pocket floor is a single fragment
  (B1.F14 = B1.L8) in this kernel output; one click selects all of it.

Gates: VS was 32/32 with this package in place. At the end of the session one
VS test (31, side-by-side pane projection) and three `viewer-core` camera
tests failed after concurrent edits to `viewer/render/camera.js` and
`panes.js` by camera-navigation; this package touches no client file and
those tests do not import its modules. RV 7/7, DC 5/5, DE 2/2, GS 11/11,
`check-format` and `check-contracts` green. `viewer-server` test 12 (frozen
stubs) asserts the stub behavior and needs the update in the integration
requests below.

## Gaps

- Supports: planes, cylinders and cones; curves: lines, circles and ellipses.
  Anything else is `unresolved` with a reason (the kernel produces nothing
  else today).
- Tangency is decided at five exact samples per edge. For edges where the
  normal angle is constant (every line and coaxial circle between planes,
  cylinders and cones) this is exact. Where it varies (ellipses,
  non-coaxial curved pairs) a tangency strictly between samples would not be
  seen; the angle range is reported so a client can tell.
- `OriginalEdge` edges are inherited from an operand whose own origin is not
  stored in the output body, so support alone decides them: 36 of 60
  subdivision edges on frame with tab and 58 of 76 on coplanar pads. Kernel
  request below.
- Faces are joined only across `subdivision` edges, never across `tangent`
  edges, vertices or bodies.
- The route computes in-process (under 10 ms); there is no `topology` kind in
  the frozen query-worker map, and none is needed. The foundation query pool
  still runs handlers in-process; a separate query process is live-server's.
- The live build worker computes both per revision, but it sends no draw
  payload yet (`buildDrawPayload` returns null because the worker never calls
  `loadDrawKernel()`). So classes from the build worker cannot be compared
  there yet; the logical face counts are.
- The first run of `test/viewer-topology-classes.test.mjs` builds seven
  models (about 45 s under load); later runs use the cache.

## Integration requests

1. `test/viewer-server.test.mjs`, test "frozen stubs": the stub assertions no
   longer hold. For the box example replace
   `assert.deepEqual(logical.bodies[0].groups[0], { alias: 'B1.L1', fragments: [0], support: null });`
   with checks of `alias` (`B1.L1`), `fragments` (`[0]`) and
   `support.type` (`plane`), and replace
   `classes.bodies[0].classes.every(code => code === EDGE_CLASS.unresolved)`
   with `… === EDGE_CLASS.sharp` (the box has 12 sharp edges).
2. live-server / render-transport: in `src/viewer/live/build-worker.mjs`
   `display()`, `await modules.draw.loadDrawKernel?.()` before
   `buildDrawPayload`, so the build worker ships the draw payload with the
   edge classes it already computes (today it sends `draw: null`).
3. Kernel / Boolean owners: carry the operand's edge origin through
   `OriginalEdge` (for example `OriginalEdge {operand, index, origin}`), so
   inherited subdivision edges can be confirmed by construction, not only by
   support.
