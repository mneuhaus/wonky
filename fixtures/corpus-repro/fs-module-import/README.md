# fs-module-import repros

Minimal inputs for the cluster "FeatureScript module imports cannot be
resolved". The analysis is in
[docs/corpus/cluster-fs-module-import.md](../../../docs/corpus/cluster-fs-module-import.md).
The inputs do not depend on `~/Workspace/cad`. They are inputs, not tests. They
record current behavior and need no change to stay valid. All were checked on
2026-09-23 with the production CLI on the default JS path.

## Unresolved imports (the corpus signature)

Run `node bin/wonky.mjs <file> --check` from the repository root.

| File | Stands for | Observed |
|---|---|---|
| `part-studio-import.fs` | `NS::build` of a Part Studio, 95 files. Reduced from `cad-project-040/src/buildplate-r16-rear.fs`. | `13:23: Unresolved Onshape module 'Parts': d9c8543f8a347821ee2e2194 at version 188904c7a670c9866e4b06de. Supply its frozen source or B-rep snapshot.` |
| `feature-studio-import.fs` | `NS::function` of a Feature Studio in another document, 3 files. Reduced from `machine-interface-r11/top-full-module-r4/module-r4.fs`. | `12:5: Unresolved Onshape module 'SourceR11': 889f3a9e…/3a4a721e…/6d0c52f9… at version 929e2218…. Supply its frozen source or B-rep snapshot.` |
| `local-path/main.fs` + `lib.fs` | An fsocct `version: "local"` library, 1 file. Reduced from `cad-project-043/fsocct/examples/canonical_m3_tool.fs`. | `12:5: Unresolved Onshape module 'M3': ./lib.fs at version local. Supply its frozen source or B-rep snapshot.` |

## With a snapshot present (`snapshot/ (local only)`)

`snapshot/ (local only)idioms.fs` imports the `base` Part Studio of r10b at the r10b
microversion. `snapshot/ (local only)modules.json` uses schema `wonky-onshape-inputs/1`. It
is bound to the SHA-256 of `idioms.fs` and holds one captured body, the `T06
R6d 249.2mm rear hopper wall` (part `Zu2DD`). The files
`modules/base/parts.json` and `modules/base/Zu2DD.body.json` are byte copies
of the files in `fixtures/r10b/modules/base/`. Their hashes therefore match the
r10b capture of 2026-09-21. Each feature exercises one corpus idiom.

Run `node bin/wonky.mjs fixtures/corpus-repro/fs-module-import/snapshot/ (local only)idioms.fs --check --feature <name>`.

| Feature | Corpus idiom (cluster files) | Observed before stage 1 | After stage 1 (revision-keyed loader) |
|---|---|---|---|
| `nameLookup` | `loadedContext` plus a name table, as in r10b (36 files) | builds: `model/src/wall: 16 vertices · 24 edges · 10 faces · volume not evaluated · closed topology` (positive control) | builds (unchanged) |
| `instantiatorIdQuery` | `qCreatedBy(<instantiator id>)` after `instantiate` (15 files) | the file's own check: `42:15: qCreatedBy(instantiator id) found 0 bodies; Onshape finds 1` | builds: 1 body (the instantiator id is recorded in `createdBy`) |
| `noLoadedContext` | `addInstance` without `loadedContext` (56 files) | `51:5: loadedContext must belong to the specified frozen module build` | `51:5` refusal lifted; next: `Body 'P10 R6d 180mm upper core - raised accessible idler' was not captured in this input snapshot` (the snapshot holds 1 of 17 parts; all solids are selected) |
| `instanceTransform` | `addInstance` with a `transform` (14 files) | `62:5: addInstance field 'transform' is not implemented` | builds: the wall moved by +10 mm in z |
| `sourceFeatureId` | `qCreatedBy(makeId("<source feature id>") + …)` (3 files) | `74:89: 'makeId' is not defined or not implemented by this prototype` | unchanged if `makeId` is missing; with `makeId`: `qCreatedBy over an imported source context is not implemented: frozen Onshape inputs do not record which source feature created each part` |
| `containsPoint` | `qNthElement(qContainsPoint(qBodyType(qEverything(…))))` (56 files select source parts dynamically) | `85:68: 'qNthElement' is not defined or not implemented by this prototype` | unchanged (stage 3) |
| `importedVolume` | an imported source body identified by `evVolume` (fs95, 14 files) | builds: evVolume integrates the imported body in Bend (kernel/volume.bend, closed form, bound in the operation evidence) | fixed (r20-gate analytic-volume) |
| `importedBox` | an imported source body identified by `evBox3d` (fs10, fs11, fs16, fs19: 7 files) | `111:5: Tight bounds over analytic imported faces are not implemented` | unchanged (stage 3) |

Before stage 1, the source binding refused an existing capture for any other
source, even one that imports the same immutable Onshape revision:

```sh
node bin/wonky.mjs fixtures/corpus-repro/fs-module-import/snapshot/ (local only)idioms.fs --check --feature nameLookup \
  --modules fixtures/r10b/modules.json
# …/idioms.fs: Frozen module manifest does not match the FeatureScript source SHA-256
```

This is why 16 corpus files failed even though they import only revisions
that are already captured for r10b (same element and microversion). After
stage 1 manifests bind revisions ([docs/onshape-inputs.md](../../../docs/onshape-inputs.md)),
so the same command builds `model/src/wall`, and the body records
`provenance.sourceBinding: "mismatch"`. The inputs in this directory are
unchanged; `test/modules-revision.test.mjs` runs every feature above.
