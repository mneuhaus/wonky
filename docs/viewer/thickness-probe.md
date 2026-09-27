# Wall thickness probe (K)

Package thickness-probe (P1, wave 3). Spec: `docs/viewer/spec.md` sections 3.3,
5 (key `K`), 8 (exactness) and 9.2 (`POST /api/models/:id/thickness`).
Package report with the evidence: `docs/viewer/package-thickness-probe.md`.

The probe answers one question with one click: how thick is the material
behind the point I clicked, measured along the face normal? The kernel decides
everything. The viewer projects the click onto the exact surface, asks Bend
for the ray's roots and their trimmed-face membership, and draws the answer.
A contact the kernel cannot settle refuses the measurement and names the
entities that block it. The ray is never moved to avoid them.

## What you see

- **Tool.** `K`, or the tool in the rail (between Orbit and the markup
  tools), selects the thickness tool. The hint reads "Click a face to probe the
  wall along its inward normal". Hovering highlights the face the click will
  probe. The tool is one-shot: after one click the rail returns to Select.
  Pressing `K` again while the tool is active, or double-clicking the tool,
  keeps it until Escape (the same rule as the markup tools, spec D8). Alt-drag
  orbits and Shift-drag pans while the tool is active; a plain drag does
  nothing.
- **Pending.** A pulsing marker at the click and a card at the upper left:
  "Probing B1.F2 in the query worker…" with Cancel. The query runs in the
  query worker process, so the viewport keeps rendering, orbiting and hovering.
- **Measured.** A line from the entry point to the exit point, with the
  label `8.00000 mm  kernel` and "B1.F2 → B1.F1 · anchor: display pick". The
  card repeats the value with its tolerance, the entry and exit faces (with
  their logical faces) as buttons that select them, a one-line note on the
  anchor, and "How": the method, the exact ray origin and direction, and every
  kernel refusal that was settled (see below). Copy puts a plain-text summary
  on the clipboard.
- **Refused.** `unresolved  kernel`: a dashed ray with a cross at every
  blocking point, and the card lists each blocking entity: the reason
  ("boundary hit", "tangent hit", "ray in face", "membership unknown", …), the
  face and the edge the kernel named, the distance along the ray and the
  kernel's membership answer. "The ray is not nudged: probe another point."
- **No hit / unsupported / error.** `no hit` for a given ray that misses the
  body. A start face without kernel membership (cones and anything else that is
  not a plane or a cylinder) answers the capability error with the
  `unsupported` chip. Other failures are shown verbatim in the card, never in
  the global error banner.
- **Escape** cancels a running probe. When no probe is running, Escape clears
  the card and the drawing. A new click supersedes a running probe (latest
  wins).
- **New revision.** When the displayed model changes (a live rebuild, or
  another model), the probed face is carried with `POST /resolve`. If its
  identity carries exactly, the probe runs again on the new revision with the
  same click point ("Re-probed on this revision: B1.F2 carried exactly to
  B1.F2"); in the live loop an edit from 8 to 12 mm shows 12.00000 mm about
  0.25 s after the save. Otherwise the card says why it was not carried, and
  the next swap removes it.

## Method

`src/viewer/thickness.mjs`, query-worker kind `thickness` (frozen map, 10 s
timeout):

1. **Ray.** For `{ face, point }` the display pick (±0.02 mm, a display
   approximation) is projected onto the face's supporting surface with a closed
   form in Bend Real arithmetic (`kernel.precise`, as in exact-measure):
   orthogonally onto a plane, radially onto a cylinder. The ray starts at that
   foot and runs along the exact inward normal there (`sameSense` applied: a
   boss is probed toward its axis, a hole away from it). For
   `{ origin, direction }` the given ray is used unchanged.
2. **Roots.** `ray.line_surface` (kernel/ray.bend) against the supporting
   surface of every face of the body gives transverse, tangent, coincident or
   refused answers. Parameters are distances along the unit direction.
3. **Membership.** In ray order, every root point is classified against its
   trimmed face by `membership` of kernel/solid-classification.bend (plane and
   cylinder faces). `FaceInside` on a transverse root is a crossing.
   `FaceOutside` is ignored (the supporting surface is hit outside the face).
   `FaceBoundary` (an edge or a vertex), `FaceUnknown` and a tangent root on
   the face block. For a boundary contact the face classifier names the edge.
4. **Span.** A face probe starts inside the material by construction. Its
   entry is the start face, whose own membership at the start must be
   `FaceInside`: a click that projects onto an edge refuses with
   `start-boundary`. A given ray enters at its first crossing whose outward
   normal points against the ray. The exit is the next crossing whose outward
   normal points along the ray. If crossings do not alternate, the probe
   refuses with `orientation`. A ray that starts inside the material answers
   `unresolved` with that reason.
5. **Coincident surfaces.** A face whose supporting surface contains the ray
   (`coincident`, or near-coincident, see below) is classified by membership
   at the origin, at every root and at the midpoint between consecutive roots
   up to the exit. Every edge of such a face lies on another face's surface,
   so the ray can only enter or leave the face at one of those roots. The
   samples therefore decide whether the ray touches the face. Any contact
   blocks (`ray in face`).
6. **Answer.** `measured` only when nothing blocks at or before the exit:
   `mm = t_exit − t_entry` (Bend Real subtraction of the two kernel roots),
   exactness `kernel-resolved`, tolerance = the larger of the entry and exit
   face tolerances (`faceTolerance`, as exact-measure does for plane offsets).
   Otherwise `unresolved` with every blocking entity at or before the exit (or
   all of them when no exit was found), or `no-hit`.

### Refused roots that are settled

On real assemblies most faces sit in a tilted frame. A probe along one face's
normal is then parallel to the side walls only up to rounding, and the kernel
answers `unresolved` for them: `|cos| ≤ 1e-12`, or `sin² ≤ 1e-12` for a
cylinder axis. The start face itself is also `unresolved`, because the
projected origin lies on the surface and its offset rounds to zero without an
exact certificate. Blocking on these made every probe on the r10b parts
refuse. `refusedRootPlan` therefore settles such an answer only by an exact
closed form over the stored parameters, and reports it in `refusedRoots`:

| Case | Condition (Bend Real) | Handling |
|---|---|---|
| origin on the surface | not parallel, offset ≤ body tolerance | root at the origin (plane), plus the far root −2(r·d⊥)/\|d⊥\|² of a cylinder; a tangent start is a tangent root |
| parallel, far | parallel within 1e-9 (plane) or 1e-6 (axis), offset > tolerance, and offset / angle > 1e5 mm | excluded: any crossing lies beyond the kernel's own `line_surface` range (1e5 mm), so outside every body |
| parallel, near | parallel and offset ≤ tolerance, or the bound above ≤ 1e5 mm | treated as coincident: membership sampling (step 5) |
| a plane answered `range` | offset / angle > 1e5 mm | excluded (beyond range) |
| anything else | – | blocks (`root-unresolved`, `root-invalid`, `root-range`) |

The ray is never moved. The UI lists each settled refusal with its offset
(for example "B3.F11: line_surface unresolved, settled as near-parallel
(offset 135.0878 mm; any crossing ≥ 1e+15 mm)").

On a tilted copy of the bracket, the in-plane ray still refuses with the same
three entities: the face containing the ray is near-coincident, not excluded
(test "a tilted bracket …").

## Server API

`POST /api/models/:id/thickness` (`src/viewer/routes/thickness.mjs`), body
at most 16 KiB:

```jsonc
{ "face": "B1.F2", "point": [30, 6, 8] }            // alias (F or L) or
{ "face": { "bodyId": "…", "entityIndex": 1 }, "point": [30, 6, 8] }
{ "origin": [18, 0, 4], "direction": [0, 1, 0], "body": "B1" }  // body: alias or id;
                                                    // required with 2+ bodies
```

Runs in the query worker. Latest wins per model: a newer probe of the same
revision supersedes the running one (409 "Superseded by a newer query"). A
client that closes the request cancels its query (499). Malformed input is
400. An unknown revision, body or face is 404. A start face without
membership is 501 (`CapabilityError`). A refused probe is a normal 200:

```jsonc
{
  "modelId": "…", "schema": "wonky.viewer-thickness/1",
  "status": "measured" | "unresolved" | "no-hit",
  "exactness": "kernel-resolved", "method": "ray.line_surface roots …",
  "mm": 8, "toleranceMm": 4.77e-5,            // null unless measured
  "body": "B1", "bodyId": "…", "bodyToleranceMm": 4.77e-5,
  "entry": { "alias": "B1.F2", "logical": "B1.L2", "point": [30, 6, 8], "t": 0 },
  "hit":   { "alias": "B1.F1", "logical": "B1.L1", "point": [30, 6, 0], "t": 8 },
  "blocking": [{ "alias": "B1.F5", "entity": "face", "reason": "boundary",
                 "text": "the ray meets the face on its boundary (an edge or vertex)",
                 "t": 12, "point": [18, 12, 4], "membership": "FaceBoundary",
                 "rootKind": "transverse", "edges": ["B1.E16"], "classifier": "Boundary" }],
  "coincident": ["B1.F6"],                    // supporting surfaces containing the ray
  "refusedRoots": [{ "alias": "B3.F11", "rootKind": "unresolved", "how": "near-parallel",
                     "offsetMm": 135.09, "beyondMm": 1.1e15 }],
  "reason": null | "3 blocking entities; the ray is not nudged" | "…",
  "ray": { "mode": "face", "face": "B1.F2", "pick": [30, 6, 8.0007],
           "origin": [30, 6, 8], "direction": [0, 0, -1], "anchor": "display-pick",
           "pickOffsetMm": 0.0007, "originExactness": "exact-parameters" },
  "counts": { "faces": 8, "roots": 2, "memberships": 2 }, "ms": 3.6
}
```

Blocking reasons: `boundary`, `tangent`, `coincident`, `membership-unknown`,
`overlap` (two faces contain the crossing), `orientation`, `grazing` (ray
perpendicular to the outward normal at a crossing), `root-unresolved`,
`root-invalid`, `root-range`, `unsupported-surface` (no ray intersection for
that surface type), `start-boundary`, `start-outside` (the click projects
outside the trimmed face), `start-missing`.

The handler checks the abort signal between kernel calls and yields to the
event loop every 8 ms, so the worker receives a cancel message during a long
probe. Kernel modules load once per worker. The classification input of a
body is cached per parsed model (the worker keeps four).

## Client

`viewer/features/thickness/thickness.js` (one module) and `thickness.css`:

- command `thickness.tool` (`K`, global scope), `thickness.cancel`,
  `thickness.clear`; pointer tool `thickness` (click probes, Alt/Shift/right
  drag navigates); hover preview through `app.setHover`.
- store slice `thickness` `{ probe, locked, collapsed }`. `probe.status` is
  `pending`, `measured`, `unresolved`, `no-hit`, `unsupported`, `error`,
  `cancelled` or `stale`.
- request scope `thickness` (latest wins, AbortController); the POST goes
  through `ctx.api.fetch` so a 501 becomes the `unsupported` chip.
- SVG overlay layer `thickness.probe` (order 62) in every pane that shows the
  probed model; card in the stage slot `thickness.panel` (order 29).
- Debug and QA handle (`window.wonkyViewer.app`): `thicknessProbe(request,
  { modelId, reference })` also accepts the `{ origin, direction, body }` form,
  `thicknessState()`, `thicknessStats()`, `thicknessCancel()`,
  `thicknessClear()`.
- No request is made under the legacy seam (the feature is not in the VS set).

## Limits

- Membership exists for plane and cylinder faces only (kernel
  solid-classification). Cones, spheres, tori and splines cannot start a probe
  (501). Such a face blocks a probe whose ray meets its supporting surface
  before the exit.
- The value is the wall along the normal at the click point. On a tapered
  wall it depends on where you click, and the pick is a display pick. The
  label says "anchor: display pick".
- Values print to the decade of their tolerance: the F32 bracket (tolerance
  4.77e-5 mm) prints `8.00000 mm`, parts with 3e-4 mm print `3.0000 mm`.
- The ray form is available through the API and the debug handle, not through
  a pointer gesture.
