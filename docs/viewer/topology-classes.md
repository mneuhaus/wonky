# Edge classes and logical faces

Package `topology-classes` (spec sections 7.3, 9.2 and D21). Modules:
`src/viewer/edge-classes.mjs`, `src/viewer/logical-faces.mjs`,
`src/viewer/routes/topology.mjs`. The package report with evidence and gaps is
`docs/viewer/package-topology-classes.md`.

## What it answers

A Boolean in the Bend kernel leaves coplanar fragments behind. The pocket
plate has 46 stored faces for the 11 faces of a plate with a pocket, and 48 of
its 92 edges only split one plane into pieces. The viewer should draw, pick,
count and diff the 11 faces and hide the 48 edges, while every fragment stays
addressable by its exact alias (`B1.F14`).

- `classifyEdges(model, scene)` gives every edge one class:

  | Class | Meaning | Drawn (spec 7.3) |
  |---|---|---|
  | `sharp` | the two faces lie on different supports and their outward normals differ at every sample | dark |
  | `tangent` | different supports, outward normals equal at every sample | 45 % opacity |
  | `seam` | a line used twice, in opposite directions, by one cylinder or cone face (the closing generator) | hidden |
  | `subdivision` | both faces lie on the identical oriented support within tolerance, and the recorded construction origin does not contradict it | hidden |
  | `unresolved` | anything that cannot be decided honestly, with a reason | like sharp |

- `logicalFaces(model)` joins faces across `subdivision` edges only. Faces on
  the same plane that no subdivision edge connects stay separate (two pad tops
  at the same height are two logical faces).

Both are closed forms over the stored analytic parameters (`exact-parameters`);
the construction origins they consult are `recorded`. Neither uses the display
mesh or a kernel call, so they run unchanged in the server, the live build
worker, the query worker and a browser-free test.

## Decision rules

For an edge with face uses `a` and `b`:

1. Not exactly two uses: `unresolved` ("edge has N face uses").
2. `a === b`: `seam` when the face is a cylinder or cone, the edge is a line
   and the two uses run in opposite directions; otherwise `unresolved` with
   the reason. A `FaceIntersection` origin on such an edge is a contradiction
   (`unresolved`).
3. No recorded body tolerance: `unresolved`.
4. The edge is evaluated at the fractions 0, 1/4, 1/2, 3/4 and 1 of its exact
   range (line `origin + t·direction` with `curveRange`, or the vertex pair of
   legacy bodies; circle and ellipse by their frame, `curveRange`, or the
   vertex parameters). Unsupported curve types are `unresolved`.
5. Every sample must lie on both supports within the edge tolerance;
   otherwise `unresolved` ("edge point lies … mm off the support of face F…").
6. Supports are compared (`compareSupports`): same surface type; for
   cylinders and cones parallel, coincident axes, equal radius and half angle;
   every sample within tolerance of the other support; outward normals within
   the angular tolerance. The outward normal is `surface.normal` (planes) or
   the radial direction (cylinders, cones with their half angle), flipped when
   `sameSense === false` on analytic bodies.
7. The recorded origin (`construction.edgeOrigins[e]`, present on planar and
   solid-intersection Boolean results) is a verdict:

   | Origin | Verdict |
   |---|---|
   | `FaceSubdivision`, `SurfaceSeam` | same support |
   | `FaceIntersection` | different supports |
   | `OriginalEdge` | inherited from an operand; neutral (the operand's own origin is not stored in the output) |
   | none (legacy bodies, sketch extrusions, imports) | neutral |

   Identical supports and no contradicting verdict: `subdivision`. Identical
   supports but `FaceIntersection`: `unresolved`. A same-support verdict but
   different supports: `unresolved`.
8. Otherwise the normal angles at the samples decide: all within the angular
   tolerance `tangent`, all above it `sharp`, mixed `unresolved` ("tangency
   varies along the edge").
9. Chains: subdivision edges are joined into groups (union-find). In a group
   of three or more fragments every fragment's boundary samples must lie on
   the smallest fragment's support within tolerance. If the chain drifted,
   every subdivision edge of that group becomes `unresolved` and nothing in it
   is merged.

## Tolerances

- `toleranceMm`: the body's recorded `validation.toleranceMm` (analytic bodies
  3e-4 mm, legacy about 5e-5 mm); per edge the larger recorded endpoint vertex
  tolerance where imports record `vertexTolerancesMm`.
- `angularToleranceRad = toleranceMm / max(extentMm, 1)`, where `extentMm` is
  the body's bounding-box diagonal (vertices and circle/ellipse extents). Two
  normals closer than this deviate by less than the linear tolerance anywhere
  on the body. Pocket plate: 3e-4 / 50.36 = 5.96e-6 rad.

Both are reported per body, together with the method, in every result.

## API

```js
import { classifyEdges, EDGE_CLASSES, EDGE_CLASS } from './src/viewer/edge-classes.mjs';
import { logicalFaces } from './src/viewer/logical-faces.mjs';

const classes = classifyEdges(model);          // scene is optional (frozen signature)
classes.bodies[0].classes;                      // Uint8Array, EDGE_CLASSES[code]
classes.bodies[0].adjacent;                     // Int32Array [2e, 2e+1] = the two faces
classes.bodies[0].evidence[e];                  // { support, origin, angleRad, reason }
classes.bodies[0].counts;                       // { sharp, tangent, seam, subdivision, unresolved }

const logical = logicalFaces(model, { classes }); // reuse the classes (optional)
logical.bodies[0].logicalOf;                    // Int32Array face -> group index
logical.bodies[0].groups[0];                    // { alias: 'B1.L1', fragments: [0, 3, …], support }
```

Groups are ordered by their smallest fragment, so a body without subdivision
edges numbers `B1.L<n>` like `B1.F<n>`. `support` is a copy of the smallest
fragment's surface: `{ type, fragment, surface, sameSense }`. Results are
cached per model object (a `WeakMap`); models in the registry are immutable.
Additive helpers: `joinFragments`, `compareSupports`, `outwardNormal`,
`supportDistance`, `edgePoints`, `edgeUses`, `bodyTolerances`.

### `GET /api/models/:id/topology[?detail=summary]`

```json
{
  "schema": "wonky.viewer-topology/1",
  "modelId": "3934511b…",
  "totals": { "bodies": 1, "faces": 46, "logicalFaces": 11, "edges": 92,
    "classes": { "sharp": 44, "tangent": 0, "seam": 0, "subdivision": 48, "unresolved": 0 } },
  "exactness": { "classes": "exact-parameters", "logicalFaces": "exact-parameters",
    "origins": "recorded" },
  "method": { "samples": "…", "angularTolerance": "…", "support": "…" },
  "computeMs": 4.2,
  "bodies": [{
    "alias": "B1", "id": "model/pocket/0", "toleranceMm": 0.0003,
    "angularToleranceRad": 5.96e-6, "extentMm": 50.36, "counts": { … },
    "logicalFaces": [{ "alias": "B1.L1",
      "fragments": ["B1.F1", "B1.F4", "B1.F5", "B1.F6", "B1.F10", "B1.F18", "B1.F20", "B1.F26"],
      "support": { "type": "plane", "fragment": "B1.F1", "sameSense": true,
        "surface": { "type": "plane", "origin": [0, 0, 6], "normal": [0, 0, 1], "x": [1, 0, 0] } } }],
    "edges": [{ "alias": "B1.E2", "class": "subdivision", "faces": ["B1.F1", "B1.F5"],
      "support": "identical", "origin": "FaceSubdivision" },
      { "alias": "B1.E3", "class": "sharp", "faces": ["B1.F1", "B1.F3"], "support": "distinct",
        "origin": "FaceIntersection", "normalAngleRad": [1.5707963267948966, 1.5707963267948966] }]
  }]
}
```

`detail=summary` drops `logicalFaces` and `edges`. Unknown revision: 404;
another `detail`: 400. The document is computed in-process (r10b-retained in
2 to 6 ms) and cached per revision, so the route needs no query-worker kind.

## Consumers

- `src/viewer/draw.mjs` (render-transport) puts the classes into the draw
  payload's `edgeClass` section and the groups into `header.logicalFaces`;
  the client highlights the whole logical face on hover and click.
- `src/viewer/geometry.mjs` (exact-measure) reports `logical` and `fragments`
  per face and `class` per edge; `compare.mjs` counts logical faces.
- `src/viewer/live/build-worker.mjs` (live-server) calls both per revision and
  reports the logical face count in its summary.
