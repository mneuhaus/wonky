# Certified-mesh bodies

Status 24 September 2026. This is step 8 of `docs/hybrid-boolean-plan.md` section 8,
and task 11 of `local design note`. Code: `src/hybrid-mesh.mjs`, with its
host sides in `src/hybrid.mjs`, `src/print-mesh.mjs`, `src/volume.mjs`,
`src/queries.mjs`, `src/exporters.mjs` and `src/r20-export.mjs`. The Bend side
is in `kernel/volume.bend`. Tests: `test/hybrid-mesh.test.mjs`.

## 1. What it is

The hybrid Boolean (`kernel/hybrid/main.bend`) can answer in three ways:

- `exact`: a recovered B-rep;
- `mesh <dev> <reason>`: the result mesh, when recover refuses only the exact
  recovery;
- `unresolved`: a refusal.

For example, recover refuses the exact B-rep for a space quartic (KS08:
torus/cylinder; KT1: the relief cone against the 12 arc walls), or for a
degenerate or tangent corner. A `mesh` answer has passed these checks:

- corefine's output gate: vertex links and the exact self-intersection test;
- recover's pre-certificate: no undecided near contact between leaf faces
  (`tangent.bend`);
- recover's input checks: every vertex within `deviation x 1.000001 + 1e-9` mm of
  its tagged carrier, a closed oriented 2-manifold, vertex links.

These later recover stages are not evaluated, because recovery stopped before
them: boundary distances to the exact curves, shell nesting and clearance.

`certifiedMeshBody(result, id, operands, loc)` turns such an answer into
**one** body. It refuses by name in two cases:

- a mesh with several shells, because nothing certified their nesting;
- a mesh that is not closed and oriented.

The body looks like this:

| field | value |
|---|---|
| `geometry` | `'mesh'` (`isMeshBody`) |
| `exact` | `false`, always |
| `approximation` | `{kind: 'certified-mesh', label: 'approximation', deviationMm, jobDeviationMm, reason, certificate, statement: 'approximate, 0.01 mm'}` |
| `mesh` | `{deviationMm, vertices, triangles: [a, b, c, face]}`: corefine's mesh, unchanged |
| `faces[i]` | `{surface, region: {triangles, sha256}}`. A face is a patch: triangles of one carrier class joined across edges. `surface` is the exact carrier (the operand face of the class representative). The region digest makes `geometryRevision` depend on the mesh. |
| `vertices`, `edges` | `[]`: the body has no exact edges or vertices |
| `validation` | mesh counts, `volumeMm3: null`, `boundsMm` = the mesh box grown by the deviation |
| `construction` | `{method: 'hybrid corefine+recover', outcome: 'certified-mesh', deviationMm, reason}` |
| `provenance.faces[i]` | `{carrier, carrierClass, sources}`: the face-table rows (leaf, face, identity) of its triangles. `removedMaterial` reads them. |

**Deviation.** The stated deviation is the job's. Every point of the mesh lies
within it of the exact carrier of its face. The operands' print meshes hold
it, corefine keeps each result triangle inside an input triangle, and recover
checked every vertex. It is **not** a Hausdorff bound to the exact result.
Where two carriers meet at a shallow angle, the mesh boundary can lie several
deviations away from their exact curve (section 4).

## 2. What works and what refuses

Works:

- names and properties;
- face queries by body (`qOwnedByBody(..., FACE)`);
- `qCoincidesWithPlane` and `qGeometry` over its faces, decided on their
  recorded exact carriers ([fs-queries](fs-queries.md#certified-mesh-bodies));
- `evVolume` (section 3);
- print meshes and the r20 check export (section 4);
- chained Booleans: `src/hybrid.mjs tagOperand` feeds the mesh and the face
  carriers into the next job. The mesh cannot be refined, so a job finer than
  the body's deviation refuses by name. `src/boolean.mjs` sends mesh operands
  to the hybrid arm directly.

Refused by name (`refuseMeshBody`). The message names the body, its deviation
and recover's reason:

- STEP export and the exact STL (`src/exporters.mjs`);
- edge and vertex queries (`qOwnedByBody(..., EDGE | VERTEX)`, and so evLine
  and friends);
- `qCoincidesWithPlane` over a face whose carrier is near the plane but
  neither certified in it nor, when exactly parallel, within the kernel's
  rounding margin of it (deciding it needs exact boundary points or lies in
  the undecided band), and `qClosestTo`;
- `qParallelEdges` over its edges (it has none to list);
- `qAdjacent`;
- `qContainsPoint` over the body, its faces or its edges;
- `evBox3d`;
- `opPattern`;
- the HTML preview (`src/preview.mjs`).

The build123d frontend's rigid placement (`src/python.mjs`) is not guarded
yet; a one-line refusal is a followUp. FeatureScript has no other transform
of a solid than `opPattern`.

## 3. Volume: the carrier method

`evVolume` and the r20 export integrate a certified-mesh body in Bend with
`integrateMeshVolume` (`src/volume.mjs`) and `kernel/volume.bend` (`MFace`,
`Meet`).

- Every face becomes its exact carrier, bounded by the mesh boundary polyline.
- Every boundary vertex is refined by Newton onto every carrier that meets
  there. This is a least-squares Newton over the unit gradients with a tiny
  damping, so two carriers give a point on their curve, and three or more give
  the corner.
- Every boundary segment becomes a piece of its two carriers' exact curve:
  - `Trace`: sampled by Newton in the plane normal to the chord, with
    `dp/dt = T |b-a|^2 / (T.(b-a))` and `T = g1 x g2`;
  - `Chord`: the straight segment, used where the two carriers are tangent at
    an end (sine < 1e-3). It is checked to lie on both carriers.
- The flux of each face is the analytic body's formula (`kernel/volume.bend`
  header). The closed-form terms apply to its chords. The same integrand
  (`KFlux`) is integrated by adaptive 10-point Gauss-Legendre along the traces.
  On a sphere or torus, the area term's quadrature runs over every piece. The
  side of a sphere or torus patch comes from its triangles, summed in Bend.
- The label is `carrier-quadrature`, never `exact`.

The bound adds up three parts:

- the summed `|G10 - halves|` estimates;
- `2^-38` of the summed face fluxes;
- `2 L r (|p - c| + |p - anchor|)` for each segment, where `r` is its largest
  carrier residual at t = 0, 1/4, 1/2, 3/4, 1.

This is the volume of the exact solid whose faces are the mesh patches on
their carriers. The patch topology is corefine's (the certificate), and the
bound does not cover it.

Refusal codes 7-10 are listed in the `kernel/volume.bend` header:

- 7: a residual above 1e-9 mm;
- 8: a trace more than 60° off its chord;
- 9: a whole plane, cylinder or cone patch;
- 10: patch triangles that do not agree on a side.

After a refusal, the r20 export states the mesh volume ± area × deviation
(label `mesh-estimate`). `evVolume` refuses by name instead, because that bound
exceeds its 1e-6 relative limit.

Checks:

| case | carrier volume | independent value | difference |
|---|---|---|---|
| KS08 torus ∪ stem | 2260.152455027288 (bound 8.3e-9) | 2260.152455027294 (torus + stem − overlap, host Gauss-Legendre 40…160, `tmp/r20/certified-mesh-bodies/ks08-exact.mjs`) | 6e-12 |
| lens (two r 5 cylinders 6 apart, h 10) | 1347.148717794084 | 1347.148717794091 (circle-lens closed form) | 7e-12 |
| KT1 relief union (12-arc prism ∪ relief cone; cone/arc quartics, tangent corners as chords) | 82.65541994972705 (bound 1.2e-9) | 82.655419949726 (polar section integral, host GL 160…640, `tmp/r20/certified-mesh-bodies/kt1-tool-exact.mjs`) | 1e-12 |
| tee (r 5 × r 3 cylinders crossed, L 20) | 1866.912676913009 | 1866.912676912998 (π r²L terms − 36∫cos²t √(25 − 9 sin²t) dt; also in `test/hybrid-mesh.test.mjs`) | 1.1e-11 |
| tee minus the slab z > 4.9 (a mesh operand chained) | 1864.2540245879163 | 1864.254024587887 | 2.9e-11 |
| equal-radius Steinmetz (curves cross where the carriers are tangent) | refused (code 8), `evVolume` refuses by name | — | — |
| KT1 (Onshape) | 17645.236839 | 17645.236626 [17644.487, 17645.987] | 1.2e-8 relative |
| KS08 (Onshape) | 2260.152455 | 2260.152825 [2259.878, 2260.428] | 1.6e-7 relative (Onshape's value is the one that is off: see the KS08 row) |

## 4. Print meshes: snapping, and what the stated deviation means

A certified-mesh body's print mesh (`printMesh`, `--format print`,
`r20-check`) is its own mesh, **snapped** onto the exact curves where that
certifies the request (`snappedPrintMesh`, `snapMesh`). The result is
cached per mesh and request.

**The statement.** `achievedDeviationMm` bounds the distance of every mesh
point from the exact **faces**, not only from their carriers. A point within
the deviation of its carrier is not within it of its face when its foot lies
past the face's edge. That is what went wrong before Regression review 1 of the R20
gate: KT1 turned 90 degrees and moved (verify#1, `kt1-r90far`) kept
slot-edge vertices 0.030 mm off the exact line (the Ø3.4 cross hole grazes the
pocket floor at 20 degrees) while the manifest stated 0.01 mm, because
snapping had taken those moves back and the claim counted carrier distances
only. The canonical KT1 had the same kind of vertex; it was moved there by
luck of the sequence.

**Boundary drift** (`boundaryDrift`, local wedge model). At every boundary
vertex, for every pair of carriers meeting along a mesh edge there:
- the exact solid near their curve is the intersection of their inner sides
  (a convex edge: the mesh dihedral folds inward) or their union (concave;
  its complement is then the intersection of the outer sides);
- `f` is each carrier's signed value at the vertex (Bend `mesh_snap` item
  `Value`: the carrier function, a distance to first order), outward
  positive by the face's oriented mesh normal;
- the drift is the vertex's distance from the wedge's boundary when it lies
  outside the convex set (`wedgeDistance`: the plane value when the
  projection onto that plane stays inside the other, else the distance to the
  edge, taken from Newton's point on the exact curve because the tangent
  planes understate it at a sharp wedge), and 0 inside it (a point inside is
  within |f| of the boundary, which the carrier bound covers). Tangent
  carriers (sine below 0.1) have no drift: they lie within the deviation of
  each other there.

**Boundary edges** (`edgeDrift`, Regression review 2). Regression review 1 argued that the
distance from a convex set is convex, so over a triangle it is largest at a
corner. That holds for the wedge of two tangent planes, whose edge is a
straight line, but not along a curved intersection curve: verify#2 found KT1
0.01013 mm from the exact edge in the middle of a 0.060 mm boundary edge on
the rib arc (r 0.45 mm) and the Ø3.4 cross hole, whose ends were 0.00986 and
0.00961 mm off, while 0.01 mm was stated (KS08: 0.00545 mm against 0.00533
stated). So every mesh edge between two carrier classes has its own claim:
- samples along the edge: its ends (their vertex drift) and points in
  between (the wedge model at the point, with the two sides' mesh normals
  and Bend `Value` of both carriers; past the edge Newton's point on the
  exact curve), each with Newton's foot on the curve (Bend `Onto`);
- between two neighbouring samples the curve can bend away from the chord of
  their feet by at most its sagitta `(1 - sqrt(1 - (k h / 2)^2)) / k`, h the
  feet's chord and k **twice** the larger curvature bound at the two feet
  (the margin for its change in between). The curve's curvature is at most
  `(|IIA(t,t)| + |IIB(t,t)|) / sine` (its curvature vector lies in the plane
  of the two normals; IIA, IIB the carriers' normal curvatures along the
  curve's tangent t, closed form per carrier in `carrierFrame`: 0 along a
  cylinder's ruling, so a plane parallel to a cylinder's axis meets it in a
  straight line with no sagitta);
- an interval is halved (a new sample) while its sagitta term exceeds 5 % of
  the request or its claim exceeds the request, at most 8 times;
- the edge's claim is the largest over its intervals of (the larger drift of
  the two samples + the sagitta term). Tangent carriers keep the wedge
  model's convention (0).

A triangle's claim is the **largest of its carrier bound, its corners' drift
and the claims of its boundary edges**; the stated deviation is the largest
claim. The corners of a boundary edge over the request are forced to move in
the next attempt (step 8). The model's assumptions: the carriers' tangent
planes stand in for the carriers over a corefine triangle (as in recover), and
the curve's curvature between two samples stays within twice its bound at
their feet.

How snapping moves vertices:

1. Bend `mesh_snap` refines every boundary vertex onto its carriers
   (Newton), and reports residual, smallest sine and distance moved.
2. A vertex moves when its drift exceeds half the request, Newton converged
   (1e-9 mm), the carriers are transversal (sine ≥ 0.1) and the move is at
   most 10 deviations. A vertex on three carriers or more whose corner is
   ill-conditioned (Newton's corner more than twice as far as the curves of
   its carrier pairs: curves that nearly touch) moves onto the pair curve it is
   farthest from instead.
3. A vertex that drifted but cannot move (tangent carriers, no convergence,
   over the cap) keeps its neighbours in place, except neighbours forced by
   an earlier attempt.
4. A move that folds a triangle of a curved face first lets the triangle's
   other corners move onto their curves too (companions: a fan of slivers
   from one far vertex to a row of moved edge vertices folds unless its apex
   moves); a triangle that still folds, or turns to the other side of its
   carrier, takes its moves back.
5. A planar face with a folded triangle is re-triangulated from its boundary
   loops (earcut, `withHoles`).
6. Every triangle touching a moved vertex, and every new triangle, gets a Bend
   bound of its distance to its carrier (`mesh_bound`, Taylor's theorem on
   a squared-distance function). Untouched triangles keep the carrier claim
   of the mesh (the deviation).
7. A triangle over the request is split at the edge that weighs most in its
   bound, the new vertex on the carrier or on the curve. Edges next to
   untouched triangles are not split.
8. A triangle still over the request because of an unmoved corner forces that
   corner in the next attempt; one with no such corner pins the moves behind
   it (up to 32 attempts; the attempt with the smallest claim is kept).
9. If no attempt holds the request, corefine's own mesh is considered with
   its honest statement (the larger of the deviation and its largest drift).
10. If that does not hold the request either, the body's own hybrid Boolean
    is run again at half the request (`setRefine`, attached by the
    dispatch, print-only; its certified-mesh operands are refined the same way
    first), and that mesh is printed if it holds the request (manifest:
    `snap.refinedJobDeviationMm`).
11. Otherwise the print mesh is **refused by name** (`UnsupportedFeatureError`
    "its boundary is not certified that close to the exact curves ..."), so
    `r20-check` writes `error.json` instead of a file with a false claim.

Measured (Regression review 2, with boundary edges; exact distances by OCCT
`BRepExtrema` on the r20 STL, tmp/r20/verify-2/adv/exactcheck.py): canonical
KT1 states 0.009998 mm and is 0.009988 mm off (refined at 0.005 mm: snapping
at 0.01 mm left 0.0101 mm); KS08 states 0.005837 mm and is 0.005448 mm off
(refined at 0.005 mm). `test/hybrid-mesh.test.mjs` has the miniature: a
bore bite whose left-cap boundary vertices sit 0.00985 mm past the edge of a
r 0.45 circle, chord middles 0.01026 mm off; the vertex-only claim was
0.01 mm.

Measured (Regression review 1): canonical KT1 states 0.01 mm (snapped; largest drift
left 0.0099 mm); KS08 is refined at 0.005 mm and states 0.0053 mm; KT1 turned
90 degrees and moved refuses by name (corefine's mesh holds 0.031 mm,
snapping 0.0128 mm, and the Boolean at 0.005 mm answers "1 triangles are not
clearly oriented against their carrier"). `test/hybrid-mesh.test.mjs` covers
a vertex inside its wedge (no move) and one past a sharp wedge (moved; left in
place its drift is the claim), and `wedgeDistance`.

Snapped meshes are print meshes only. The body keeps corefine's mesh, which is
what the certificate covers and what a chained Boolean consumes. When KT1's
snapped tool was fed into the next Boolean, corefine made a zero-thickness
membrane at z = 20 (a coplanar up/down pair at the tangent corners; Hausdorff
0.40 mm). That is a corefine finding, recorded in the followUps.


## 5. Open points

- **probe P01 does not build.** corefine refuses the tilted relief union at
  612:9 with "face triangulation failed (no valid ear or hole bridge)". The
  cause: the two coplanar tilted caps are bitwise the same carrier, so
  `kernel/hybrid/unify.bend` does not unify them, and their leaf vertices lie
  on the plane only to rounding. Unifying identical non-axis-aligned carriers
  of different leaves (scratch experiment) gets past the ear clipping. corefine
  then refuses "welded / repaired output is not 2-manifold" at the 12 tangent
  points of the cone base circle with the arcs. This is corefine robustness,
  not this task's files.
- **Performance.** Snapping and the carrier volume run in the JS Bend
  target: 1-5 s for KT1 and KS08. The native slice has neither `mesh_snap`,
  `mesh_bound` nor `volume`.
- The torus bound is isotropic on the low side (it uses `|e|^2`), and the cone
  bound divides by the smallest radius. Both over-state; bisection pays for
  that with extra triangles.
