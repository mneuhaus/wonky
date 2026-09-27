# Hybrid Boolean codec (`src/hybrid.mjs`)

Plan step 6 of `docs/hybrid-boolean-plan.md`. The codec turns wonky bodies
into a hybrid job, runs the entry `kernel/hybrid/main.bend`, and turns the
answer back into wonky bodies with provenance.

The codec is I/O only and decides no geometry:
- Every coordinate it writes comes from Bend: `printMesh` samples
  (`kernel/tessellate.bend`), or the vertices of an earlier hybrid result.
- Every coordinate it decodes is the F32x2 Real that recover wrote.
- On the host side it only welds equal coordinates, numbers faces, groups
  triangles by shared vertices and edges, and matches tags.

The dispatch into `booleanInBend` is plan step 7 and not part of this module.

## Encoder

`hybridJob(kernel, operands, tree, {deviationMm = 0.01, id})` returns the job
object, and `encodeJob(job)` returns its text. The grammar is the bake-off job
format (`docs/bakeoff.md`, "Job format"; the Bend side is
`kernel/hybrid/mesh-io.bend`).

- **Leaves.** Leaf *i* is `operands[i]`, a `brep` prim with the identity
  matrix. `binaryTree(operation)` builds `union`, `subtract` or `intersect`
  over leaves 0 and 1.
- **Face table.** One row per body face, in body face order, leaf by leaf. The
  tag is the row index, so tag → (leaf, face) is the table itself. The wire
  forms (`wireSurface`):
  - plane `o n x`
  - cylinder `o n x r`
  - cone `o n x r a`
  - sphere `o r`
  - torus `o n R r`

  Any other surface type is refused by name.
- **Leaf mesh.** `printMesh(kernel, body, dev, {tags: true})`. Equal
  coordinates are welded by exact key, as in
  `scripts/bakeoff/recover-roundtrip.mjs`. For the 13 round-trip bodies the
  encoder produces that script's bytes exactly. A `printMesh` refusal
  propagates unchanged.
- **Attached mesh.** A body decoded from an `exact` answer carries
  `hybridMesh`: corefine's result mesh, with its tags renumbered to the body's
  face indices (see "Decoder"). The encoder reuses it as the leaf mesh
  (`leaves[i].via === 'attached'`) under two conditions:
  - its deviation is at most the job's;
  - the body's `geometryRevision` still equals the one recorded when the mesh
    was attached. A transformed or edited body therefore never reuses a stale
    mesh.

  Otherwise the encoder calls `printMesh` and records the reason in
  `leaves[i].reuseDeclined`.

  `hybridMesh` is a non-enumerable property (`setHybridMesh`). It is not body
  data: `brep.json` does not write it, and a structured clone or spread copy
  (a rolled-back or copied body) drops it, so such a copy is meshed by
  `printMesh` again.
- **Reals.** Coordinates are written strictly as F32x2 (`hi`, `lo`). A value
  that is not exactly `hi + lo` is refused, never rounded. The job deviation
  is a parameter and is written as its nearest F32x2 value.

`roundTripInput(kernel, body)` is recover mode's input: a one-leaf job,
followed by that leaf's mesh as the result.

## Running

`runHybrid(kernel, jobText)` returns `{text, meshText}`.
- `text` is `kernel.hybrid.boolean(jobText)` byte for byte. It is built from
  the entry's own stages: `corefine/main.run`, then `mid.go`, `map`, `finish`
  and `show`.
- `meshText` is corefine's result text. The `exact` answer does not repeat it,
  and the attached mesh comes from it.
- A corefine refusal is the answer as is.

`carrierClasses(kernel, job)` returns recover's carrier class table, computed
from the job's face table: the class of tag *t* is the first tag whose carrier
is the same surface. It is decided in Bend by recover's own stage 1
(`recover/topo.cls.go` over `surfs.go` of `mesh-io.parse_job`). The job is
parsed without its meshes, so the call is cheap. A recovered face's `tag` is
its class. Plane unification of rotated near-coplanar carriers (the `unified`
record) is not part of this table.

## Decoder

`decodeHybrid(answer, {id, job, operands, meshText, kernel|classes, validate})`
has three outcomes.

**`exact`** returns `{status, bodies, stats, statements}`. The body geometry
fields (vertices, edges, faces, shell, voids) are exactly those of
`scripts/bakeoff/recover-brep.mjs` `toBodies`, which the tests check. Each
body carries:
- `construction: {method: 'hybrid corefine+recover', deviationMm}`;
- `validation`, from `validate(body)` (e.g. `validateAnalytic` bound to the
  kernel). A failure throws;
- `provenance`:
  - `faces[i]`:
    - `tag`: recover's tag, the carrier class;
    - `carrier`: that row as a source reference;
    - `carrierClass`: every row on the same carrier;
    - `sources`: the rows whose triangles form this face, or `null` when the
      mesh could not be assigned;
    - `shell`.

    A source reference is `{tag, leaf, face, operand (body id), identity}`.
    `identity` holds the operand face's `originId`, `instanceId` and
    `operationId`.
  - `edges[i]`: recover's edge certificate `{seam, boundaryDeviationMm,
    certifiedBoundMm}`;
  - `operands`: the leaves the body's faces come from;
  - `statements`: recover's `unified` record (classes and tolerance) and its
    absorbed slivers, as text;
  - `stats`: recover's maxima;
- `hybridMesh`: the attached mesh `{deviationMm, vertices, triangles,
  revision, certificate}`, or `{refused: <reason>}`.

**`mesh`** returns `{status: 'mesh', approximation: true, exact: false,
deviationMm, reason, mesh}`. It is never exact. `deviationMm` is the job
deviation, a per-vertex distance to the tagged carrier, not a Hausdorff bound
(plan section 2.3).

**`unresolved`** returns `{status: 'unresolved', reason}`, a named refusal.

`hybridBoolean(kernel, operands, operation, {id, deviationMm, validate})` is
encode + run + decode in one call. Identity (`identifyBoolean`) and
`operationEvidence` are left to the dispatch, as for every other arm of
`booleanInBend`.

### Assigning the result mesh to faces

`attachResultMesh` replays recover's stages 1-4 on its own input,
combinatorially:
1. **Class.** A triangle of tag *t* lies in a face whose tag is
   `classes[t]`.
2. **Patch.** A patch is a set of triangles of one class joined across shared
   mesh edges. Each patch is one recovered face.
3. **Shell.** A mesh component (triangles joined through shared vertices) is
   one closed shell: the one recovered shell whose face tags are exactly the
   component's classes.
4. **Several faces on one carrier** in one shell (the two r = 8 bands of
   `rt-revolve-groove`) are told apart by the classes of their neighbours:
   across B-rep edges for faces, across patch boundaries for patches.

It declines by name, and never guesses, in these cases:
- recover absorbed sliver patches;
- carriers were unified;
- the mesh is not a closed 2-manifold;
- a component matches no shell, or several;
- two components match one shell;
- the patch and face counts of a carrier differ;
- neighbour signatures do not separate the faces.

## Evidence (24 September 2026)

`node --test test/hybrid-roundtrip.test.mjs`: 8/8 pass, about 5.5 s on the JS
target.

- **Round trip, 13/13.** body → tagged mesh → recover on the 13 bodies of
  `recover-roundtrip.mjs`:
  - the job text is byte-identical to that script's;
  - the decoded geometry is identical to `recover-brep.mjs`'s decode;
  - `validateAnalytic` passes;
  - faces, surface kinds and radii, and non-line curves match the original;
  - vertices agree within 1e-9 mm;
  - the result mesh attaches, and the attached mesh recovers the same body
    again.

  With OpenCascade (`node scripts/bakeoff/recover-roundtrip.mjs`), all 13 are
  `exact`: OCCT valid, `validate-step.py` passes, volume and area relative
  error at most 2.9e-15.
- **Stub-probe jobs, KT2, KT6, KS07.** These are the Booleans the R20 cases
  hand to the hybrid: KT2 `seatCut` step 0, KT6 `union` step 1, KS07 `join`.
  - The operands, rebuilt with the cases' own FeatureScript helpers, give the
    stub probe's job byte for byte through the bake-off route (sha256 in the
    test).
  - The JS answer is byte-identical to the stub probe's native answer.
  - The codec decodes it to the same B-rep as the bake-off decoder.
  - The codec's own job (`printMesh` operands) recovers the same exact
    geometry: vertices bit for bit, carriers to 1e-12. The bake-off
    tessellator re-normalizes and quantizes plane normals, so the carrier
    representations differ in the last bits. For example, the KT2 pocket
    floor is `n = -z, sameSense false` there and `n = +z, sameSense true`
    here.
  - Provenance, KT6: the top face lists four sources from both operands.
- **Chain.** KT2's seat, bore and hole cuts: each step is exact, the recovered
  body re-enters by its attached mesh, and the geometry matches the route that
  re-tessellates every step. `tmp/r20/hybrid-codec/chain.mjs` runs all six
  cuts: 6/6 exact, 1.0 s JS for the last cut.

## Open

- The attached mesh grows with the chain: KT2 goes from 468 to 2,818
  triangles over six cuts. corefine keeps every triangle of the operands'
  meshes. A decimation or re-tessellation of recovered faces with
  `printMesh`, once it covers them, would bound it.
- Sliver absorption and unification decline the attached mesh. Recover could
  print its per-triangle face assignment (or the unified class table), which
  would remove both cases.
