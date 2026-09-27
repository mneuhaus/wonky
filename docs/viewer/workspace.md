# Viewer workspaces: one viewer for a project

Status: implemented 2026-09-25 (WP1 to WP6, uncommitted worktree
local development evidence), with the deviations listed in section 8. Owner
request: one viewer instead of one per part, with assemblies.

**Technical summary.** Ein Viewer-Prozess pro Projekt. Eine Workspace-Datei
(`*.view.json`) listet die Modelle (Quelle, Feature, Module-Manifest,
Parameter, optionale starre Transformation) und Baugruppen (Liste von
Instanzen). Im Parts-Tab steht ein Baum: Baugruppe „Feeder“ mit allen sechs
R20-Modulen, darunter jedes Modul mit seinen Teilen. Ein Klick wechselt
zwischen Baugruppe und Modul, die Kamera bleibt stehen. Sichtbarkeit,
Isolieren und Auswahl gehen pro Modul und pro Teil. Jedes Modul baut beim
Speichern live neu (dieselben warmen Worker wie heute, ein gemeinsamer Pool).
Messen, Schnitt, Wandstärke, Vergleich und Reviews funktionieren pro Modul;
in der Baugruppe wirken Schnitt und Wandstärke auf alle sichtbaren Module.
Statt sechs Prozessen (heute gemessen 6,2 GB) läuft einer. Start:
`node bin/wonky-view.mjs workspaces/r20-single-step.view.json` oder direkt
mit `…/build/studios/manifest.json`. Mates gehören nicht dazu.

## 1. Workspace file

JSON, schema `wonky.view-workspace/1`, name `<project>.view.json`, kept with
the project that owns the sources (the CAD side can generate it there). The
R20 file is `workspaces/r20-single-step.view.json` in this repo, because
`~/Workspace/cad` is read only for us.

```json
{
  "schema": "wonky.view-workspace/1",
  "name": "R20 Single Step Feeder",
  "defaults": { "curvedContacts": "strict" },
  "limits": { "concurrency": 2, "maxWorkers": 3 },
  "models": [
    { "key": "datums", "label": "Datums", "feature": "r20Datums",
      "source": "~/Workspace/cad/cad-project-041/single-step-r20/build/studios/datums.fs",
      "out": "../tmp/r20-view/datums" },
    { "key": "context", "label": "Context", "feature": "r20Context",
      "source": "~/Workspace/cad/cad-project-041/single-step-r20/build/studios/context.fs",
      "modules": "store:manifests/cad-project-041/single-step-r20/build/studios/context.fs.json",
      "params": { "withImports": "true" } }
  ],
  "assemblies": [
    { "key": "feeder", "label": "Single Step Feeder",
      "instances": [{ "model": "datums" },
        { "model": "context", "transform": { "translate": [0, 0, 0] } }] }
  ],
  "open": "assembly:feeder"
}
```

Abridged, `params` and `transform` only show syntax; the real file has six
models in manifest order, no params, identity transforms.

Rules (enforced by `src/viewer/workspace/load.mjs`; a violation is a typed
error naming the JSON path and the viewer does not start):

- `key` matches `^[a-z0-9][a-z0-9-]{0,39}$`, unique over models and assemblies.
- `source` is `.fs`, `.py` or `.brep.json`. Paths (`source`, `modules`, `out`)
  resolve against the file's directory; `~/` means `$HOME`; `store:` means
  the Onshape store root of `scripts/onshape-store.mjs`
  (`WONKY_ONSHAPE_STORE`, else `<repo>/var/onshape-store`; worktrees have no
  `var/` and set the variable).
- Per-model build options mean exactly the CLI flags: `feature`, `params`
  (name → FeatureScript expression, as `--param`), `modules`, `maxSteps`,
  `curvedContacts`, `contactCapMm`, `python`, `timeoutMs`, `maxRequests`,
  `out`, `format`, `deviationMm`. `defaults` may set all but `feature`,
  `params`, `modules` and `out`. Unknown fields are refused.
- Two models with equal source, feature, params and modules are refused (same
  model id); reuse a model through instances.
- `transform` (model or instance, default identity) is rigid: either
  `{ "matrix": [12 or 16 numbers, row-major, mm] }` (16: last row `0 0 0 1`)
  or `{ "rotate": [{ "axis": [x,y,z], "deg": a }, …], "translate": [x,y,z] }`
  (rotations in order, then translation). `R·Rᵀ = I` and `det R = +1` within
  1e-9, else refused: no scale, no mirror. An instance sits at
  `instance.transform ∘ model.transform`; a model node shows the model at
  `model.transform`, so switching between it and an assembly never jumps.
- `open`: `model:<key>` or `assembly:<key>`; default first assembly, else
  first model.

**Studio manifest adapter** (`src/viewer/workspace/studios.mjs`).
`wonky-view <dir>/build/studios/manifest.json` (schema `r20/studio-build/v1`)
yields one model per `order` entry: `source = <dir>/<studios[k].file>`,
`feature = modules[k].featureType`, `label = studios[k].name`, and `modules`
= `store:manifests/<corpus-relative source>.json` when that file exists (the
convention of `scripts/snapshot-modules.mjs`, corpus root
`WONKY_CORPUS_ROOT` or `~/Workspace/cad`), plus an assembly `all` over
`order`. This is clean: it reuses one existing convention and invents none.
Params, transforms and `out` need a real workspace file; `--print-workspace`
prints the adapter result, which is how the R20 file is created.

**CLI.** A workspace input (a `.json` that is not `.brep.json`, detected by
`schema`) must be the only input; every build and output flag is refused
next to it, viewer flags stay. The derived port
comes from the workspace file's real path. Plain inputs keep working through
an **implicit workspace** (one model per input, CLI build flags on every live
model, no assembly), so the server has a single code path.

## 2. Server model

- **Sources.** One live session per model; static `.brep.json` models
  register as today. `createLiveSession` gets the model's own `flags` and
  `out`. `sourceId` stays `sourceIdOf(realPath)` when the real path is unique
  in the workspace (keeps per-source settings, reload restore, session
  marker) and becomes `sourceIdOf(realPath)-<key>` otherwise. The last-good
  cache key becomes `sha256(realPath + canonical build options)`; today it is
  the path only, so a restart with another `--feature` can seed r0 from a
  different feature's model.
- **Watcher fix.** `manifestFiles` uses the loader's list
  (`manifestInputFiles`, `src/modules.mjs`, taking parsed JSON): schema 2
  resolves against `manifest.store` and includes `parts.file`. Today it
  watches `<manifest dir>/revisions/…`, which does not exist (checked for
  `context.fs.json`); low impact, a recapture also rewrites the manifest.
- **Builds.** The build pool is already shared by all sessions (one job per
  source, drain rules unchanged); startup queues in workspace order.
- **Unreadable sources.** A model whose source is missing or cannot be read
  fails on its own: its r1 fails (`MissingSourceError` or
  `UnreadableSourceError`, kind `input`), the other models start and build,
  and the watcher builds the model once its source reads. The server refuses
  to start (`Cannot read live source …`) only when no live source can be read
  and no saved `.brep.json` model is listed, as for a single missing input.
- **Workspace file watch.** A valid change is diffed by key: new models start
  a session, removed ones close (revisions stay registered), changed build
  options rebuild that model only, transform/assembly/label changes only
  republish the tree. An invalid change keeps the running workspace and
  publishes `workspace-invalid { error }` (banner and terminal line).
- **Ids and routes.** Model ids stay content hashes of the `.brep.json`
  bytes, so every `/api/models/:id/…` route (draw, topology, geometry,
  measure, section, thickness, parts, resolve, export) is already per model
  and unchanged. Additions only:
  - `GET /api/workspace` gains `tree`: `{ name, file, open, models: [{ key,
    label, sourceId, sourceKey, static, matrix }], assemblies: [{ key, label,
    instances: [{ id, model, matrix }] }] }`; `matrix` = 12 numbers, world
    placement; instance `id` = `<assembly>/<index>`. Implicit workspaces send
    the same shape.
  - `GET /api/live` entries and the SSE `hello` gain `key`; events keep
    `sourceId`, the client maps it through the tree.
  - `/api/compare/revisions` facts gain `model: key`; the fact `source`
    (library group and settings key) stays the path when unique, else
    `path#key` (today two models of one file would merge into one group).
  - `GET /api/selection` references gain `placement: { node, instance,
    matrix }`, so agents can map model-local results into the shared frame.
- **Compatibility.** `/api/live/:sourceId/rebuild|cancel` keep their ids;
  existing server tests (plain inputs) pass unchanged.

## 3. UI

The visual style stays: existing rows, icons, trust dots, colors.

- **Tree (Parts tab).** Root rows: assemblies, then models in workspace
  order. A model row shows label and trust state (dot, `r7`, building,
  failed, "last good r5") and expands to the existing body rows (eye,
  swatch, alias, face counts); an assembly row expands to its instances.
  Search filters models and parts. The Models tab keeps the revision history
  per model; Checks is unchanged.
- **Nodes.** Clicking a root row opens it. The URL hash
  (`#node=assembly:feeder`) and session storage keep it across reload and
  server restart.
- **Rendering.** A pane gets `members: [{ instance, key, modelId, matrix }]`
  (model node: one). Each member is drawn with the camera and clip planes
  expressed in its local frame (`T⁻¹`): shaders stay unchanged, identity
  costs nothing. All members of a pane share one near/far range from the
  union of their bounds, so depth between members is consistent. Picking
  tests every visible member (ray in local frame) and returns the nearest hit
  with `modelId` and `instance`. `members: []` (every instance hidden) draws
  and picks nothing; only a pane without `members` draws `state.after`.
- **Active model.** `state.after` stays the compat seam: the active model's
  displayed revision. Model node: that model. Assembly: the model of the
  primary selection, else the last active, else the first visible member.
  Inspector, parts details, measure and compare read it as today. A node
  whose model has no good revision yet (never built, or every build failed)
  shows no model: `state.after` is null, the live status and failure panel
  name that model's source, and its first good revision opens in the node.
- **Visibility, isolation, selection.** The eye on a model row hides that
  instance in the open assembly; `I` on a model row isolates it (again: show
  all). Body eyes, opacity and color stay per source + body name (scope SB)
  and apply to every instance of the model; `Y`, `Shift+Y`, `I` on bodies
  work across members. Clicks select in any member; references carry
  `modelId` (already) and `instance`; the tree reveals the selected body.
- **Live and camera.** Each member follows live on its own; a failed build
  keeps its last good revision and marks its row. The displayed model
  (`state.after`) is the exception: its member draws the displayed revision,
  so with Follow off (`L`) or an older revision picked, a placed model draws
  what the model bar and inspector show, and moves only when that revision
  is shown. One world camera per tab
  for the whole workspace: switching nodes never fits or resets, `F` fits
  the open node's visible members, a first open without a camera fits.
- **Features in an assembly.** Section clips all members; caps are requested
  per visible member with the plane mapped into its frame. Wall thickness
  probes the hit member. Measure works between references of one model;
  references on two models show "Measure across models is not supported yet"
  (typed refusal, WP7). Compare, diff and FDM plate need a model node and are
  disabled in an assembly with the hint "Open a model to compare". A review
  saves the node, every member model id (so `referencedModels` archives them)
  and the camera. In a model node everything works as today.

## 4. Memory

Measured at 07:10 today (`ps` RSS sum): the six R20 viewers use 6.2 GB
before any build runs (6 servers 1.7 GB, 6 query workers 1.4 GB, 12 build
workers 3.2 GB). One workspace process has one server, one query worker and
one build pool, bounded by `limits` (defaults): `concurrency` (2) builds at
once; `maxWorkers` (4) build processes including draining ones;
`workerRssMb` (1536) recycles a build worker after its job; `queryRssMb`
(2048, new) recycles an idle query worker; `displayBudgetMb` (512) and
`modelBudgetMb` (256) bound unpinned revisions in the registry ring.

Ceiling ≈ server (≈ 0.4 GB + ring budgets + pinned current revisions) +
`maxWorkers × workerRssMb` + `queryRssMb`: about 8.5 GB with R20's
`maxWorkers: 3` (today: six such ceilings). Expected R20 idle 1.5 to 2 GB is
an estimate until WP6 measures it for `docs/viewer-ui.md`.

## 5. Migration from the six viewers

1. Start a copy of the R20 file without `out` fields on a scratch port
   (`--port 4396 --no-open`), so the running viewers keep sole ownership of
   their output files.
2. Per module compare the workspace's current model id with the running
   viewer's (`GET /api/live`, read only). Same bytes and flags give the same
   id (live-server contract); a difference is a defect of this work.
3. Marc stops 4320–4325 and starts the real file on the port he wants.
   Today's `--out tmp/r20-view/<module>` resolves against the running
   viewers' cwd `/private/tmp/wk-view`; the file writes
   `<repo>/tmp/r20-view/<module>`, and consumers move with it. The first
   start has no r0 per module (new cache key); later restarts do.

## 6. Work packages (one implementation agent each, in order)

| WP | Scope | Tests |
| --- | --- | --- |
| 1 Workspace file | `src/viewer/workspace/{load,studios,transform}.mjs`, CLI detection and flag refusal, implicit workspace, `--print-workspace`, `workspaces/r20-single-step.view.json`, `fixtures/viewer-workspace/` with provenance | T1–T3 |
| 2 Server | per-model flags and `out`, sourceId and cache key, `manifestFiles` fix, `tree`, `key`, fact `model`, `placement`, limits, query worker recycle, file watch | T4–T7 |
| 3 Renderer | pane members, local camera and clip planes, shared depth range, multi-member picking and hidden masks, pins for all members | T8–T9 |
| 4 Tree UI | tree, nodes, URL/session restore, camera rules, visibility, isolation, selection reveal, trust per row | T10, browser |
| 5 Assembly features | section caps per member, thickness on the hit member, cross-model measure refusal, compare/diff/FDM disabled with hint, reviews with node and members | T11, browser |
| 6 Docs, migration | `docs/viewer-ui.md` (German: Workspace-Datei, Baum, Baugruppe, Speicher), `live-server.md`, `parts-tree.md`, `contracts.md`; migration steps 1–2 run; R20 idle RSS measured | – |
| 7 (later, optional) | measure across models of one assembly (exact entities mapped by their matrices) | – |

## 7. Test plan

Every new or changed test goes through `.claude/skills/test-audit/SKILL.md`.
Tests read only `examples/` and `fixtures/viewer-workspace/`, never
`~/Workspace/cad`.

- **T1 loader.** A valid file normalizes paths, defaults and transforms.
  Planted negatives, each refused with its JSON path: duplicate key, unknown
  field, unknown instance model, scale-2 matrix, mirror (`det = -1`), bad
  last row of a 16-number matrix, duplicate (source, feature, params,
  modules), a build flag next to a workspace on the CLI.
- **T2 adapter.** A frozen fixture shaped like `r20/studio-build/v1` (three
  modules, one store manifest) gives models in `order`, their features, the
  store manifest only where it exists, assembly `all`; equals
  `--print-workspace`.
- **T3 manifest watch.** Schema 2 with `store`: the watch set equals the
  loader's list. Changed test: the `manifestFiles` case in
  `test/viewer-live-server.test.mjs` gains `schema: 'wonky-onshape-inputs/1'`
  (the loader refuses schema-less manifests, and the watcher now uses it).
- **T4 per-model builds.** A fixture `.fs` with two exported features used by
  two models: each current model id equals `bin/wonky.mjs` output for its
  feature and params; distinct sourceIds; saving the shared file rebuilds
  both; `rebuild` of one rebuilds only that one.
- **T5–T7 server.** `tree` for a file and for plain inputs (implicit);
  file reload (add, remove, change params; invalid file keeps the running
  workspace and publishes `workspace-invalid`); `limits` reach the pool
  (`/api/live` workers) and the ring.
- **T8 member camera.** A world point projects to the same pixel through a
  member with matrix `T` as through an identity member of the pre-transformed
  geometry.
- **T9 picking.** Two overlapping members: the nearer is picked; a hidden
  member or body never is.
- **T10 tree state.** A node switch keeps the camera value; per-instance
  visibility and isolation; active-model rules.
- **T11 assembly section.** Caps requested for every visible member, plane
  in the member frame.

Per package: focused test files, then `node scripts/test-lane.mjs fast
--jobs=4` once. Browser checks on scratch ports 4396–4399 only.

## 8. Implementation notes and deviations (2026-09-25)

Built as designed: loader, adapter and transforms
(`src/viewer/workspace/`), CLI detection, flag refusal, implicit workspace
and `--print-workspace`; per-model flags, `out`, source id suffix, build
options in the last-good cache key, `manifestFiles` through
`manifestInputFiles`, `tree` in `/api/workspace` and `hello`, `key` in
`/api/live`, fact `model` and `path#key` sources, `limits` to the pool and
the ring; pane members with placements, one shared depth range, members'
picking with hidden masks (`viewer/render/placement.js`, `renderer.js`,
`picking.js`); the tree, nodes, hash and session restore, camera kept on
switches, per-instance visibility and isolation, bodies grouped per member,
selection makes its model active; section caps per member (layer
`perMember: true`), wall thickness on the hit member.

Deviations and open items:

- Not built: the workspace file watch (a changed file needs a restart, no
  `workspace-invalid` event), `queryRssMb` (query worker recycling),
  `placement` in `GET /api/selection`, reviews saving the node and every
  member id (a review saves the active model as before).
- Compare in an assembly opens the active model's node and compares there
  (instead of a disabled button with a hint). Diff and FDM plate are not
  special-cased: they act on the active model.
- Measure across two models answers with the existing typed row
  "entities from different revisions" (no new text).
- Overlays projected in world coordinates (measure dimension labels, the
  thickness label, the diff ghost) are not placed for a member whose
  placement is not the identity; every R20 placement is the identity.
- The memory ceiling of section 4 is unchanged; measured R20 (all six
  built, `concurrency` 1, `maxWorkers` 2): 2.1 GB (server 498 MB, build
  workers 1072 + 217 MB, query worker 360 MB) against 6.2 GB for six viewers.
- Tests: `test/viewer-workspace.test.mjs` (T1 to T4, T5 for plain inputs,
  T8 to T10; T6, T7 and T11 not written: file reload is not built, limits are
  passed through unchanged, caps per member were checked in a browser only).
- Regression review 1: an unreadable model source no longer stops the server; a
  model node without a good revision shows no model instead of the previous
  one and opens its first good revision; a fully hidden assembly draws and
  picks nothing (`members: []` versus no members). Regression tests in
  `test/viewer-workspace.test.mjs` (server, picker/renderer members, the
  workspace feature in the fake browser).
- Regression review 2: a placed (non-identity) member of the displayed model draws
  the displayed revision instead of its newest good one (Follow off showed
  r1 in the model bar and inspector while r2 was drawn); an assembly member
  whose first good revision arrives after the assembly opened gets its parts
  document requested when the Parts tab lists it (its group stayed "Loading
  parts…" and the Parts count missed it; R20 showed 18 of 26 bodies).
  Regression tests in `test/viewer-workspace.test.mjs` (fake browser with
  real parts documents and draw payloads); the fake environment
  (`scripts/viewer/test-support/fake-env.mjs`) answers binary bodies.
- Regression review 3: after a model node hid a body and another model node was
  opened, the assembly listed that body with a visible eye ("Hide"), and the
  eye showed it again; the drawing was right. The Parts panel rendered its
  rows before composing the styles of the new member set (the row fell back
  to the other model's entry for the same body id). Every render now
  composes first, and a newly drawn model re-renders the rows. In an
  assembly a fully hidden member no longer says the viewport is empty; the
  note appears once when every listed body is hidden. Regression test in
  `test/viewer-workspace.test.mjs` (fake browser).
