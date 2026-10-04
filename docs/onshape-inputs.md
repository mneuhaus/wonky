# Frozen Onshape inputs

FeatureScript sources import other Onshape Part Studios:

```
base::import(path : "onshape-id-019892ef", version : "onshape-id-676f05b9");
Legacy::import(path : "<document>/<version>/<element>", version : "<microversion>");
```

wonky never fetches these at build time. It resolves them from frozen inputs:
captured part lists and B-reps, or checked FeatureScript regeneration sources.
All input bytes are checked by SHA-256. This page describes the
manifest a build reads (`--modules`), the shared store the manifests point
into, and the scripts that fill it. The failure analysis behind the design is
[corpus/cluster-fs-module-import.md](corpus/cluster-fs-module-import.md).

## Rules

- **Bound to revisions.** A manifest entry names an immutable Onshape revision:
  element and microversion, plus the document and its version for an import
  from another document. Any import of that revision resolves, whichever file
  imports it and whatever its namespace is called.
- **The source hash is provenance.** `sourceSha256` is optional. When it is
  present and differs from the importing file, the build still loads and every
  imported body carries `provenance.sourceBinding: "mismatch"` (`"absent"` when
  the manifest has none). With a matching hash, schema-1 provenance is
  unchanged.
- **Bytes are checked.** The part list and every body file are SHA-256-checked
  and must lie inside the manifest directory (schema 1) or the store root
  (schema 2). The part list must name the entry's element and microversion, and
  each body file its microversion and part id.
- **Pinned to a document state.** An import `version` is either a document
  microversion or the element's own microversion (see
  [Resolving an import version](#resolving-an-import-version)). Captured bytes
  always name a document microversion. When that differs from the import
  version, the schema-2 entry says so in `documentMicroversion`, the byte checks
  use it, and every imported body records it in
  `provenance.documentMicroversion`.
- **Nothing is invented.** A part in the part list whose B-rep was not captured
  raises `Body '<name>' was not captured in this input snapshot` when it is
  used. An import whose revision is not in the manifest raises
  `Unresolved Onshape module`. The same element at a different microversion (or
  document version) raises `Frozen module revision mismatch`. `qCreatedBy` over
  an imported source context is refused, because a B-rep snapshot does not
  record which source feature created a part. Regenerated source contexts keep
  their actual creator history.
- **Composite parts load; using them is refused** (decision 11 of
  [entscheidungen.md](entscheidungen.md)). See
  [Composite parts](#composite-parts). Any other non-solid body type in a part
  list (`wire`, `sheet`, ...) still refuses the whole module:
  `Imported module '<ns>' contains unsupported body type '<type>'`.
- **The r10b fixture stays frozen.** `fixtures/r10b/modules.json` (schema 1) is
  read unchanged.

## What the loader implements (`src/modules.mjs`)

- `NS::build({})`: the source Part Studio in its frozen default
  configuration, as a read-only context. Captured part lists create lazy
  records; regeneration sources execute in their own modeling context.
  Namespace aliases of one immutable revision share the build and context.
  A non-empty configuration is refused.
- `addInstance(instantiator, NS::build, definition)` accepts:
  - `name` (optional, std `AutoN` default), `partQuery` (optional, all solids);
  - `loadedContext` (optional). Without it, the module's default-configuration
    context is used, the same one `NS::build({})` returns;
  - `transform` (optional): a proper rigid `Transform`. Rust copies use the
    native pattern transport, preserving the original binary64 SI values.
    Scale, shear and reflection are refused by name;
  - `configuration` (optional): only an empty map.

  Any other field is refused by name.
- `instantiate(context, instantiator)`: each body is created by its instance id
  and by the instantiator id, so `qCreatedBy(<instance id>)` and
  `qCreatedBy(<instantiator id>)` both find it (exact id match). An instance
  with several source bodies names them `<instance id>/<part id>`.
- `manifestInputFiles(manifestPath)`: every file a manifest makes the loader
  read, for watchers and packaging.

On Rust, `evaluateQuery(sourceContext, qAllModifiableSolidBodies())` and NAME
lookup are metadata-only for captured part lists. Transient queries retain
that source owner and cannot be evaluated in the destination. Native source
bodies support read-only volume, bounds, distance and collision evaluation.
Instantiation copies geometry and properties without moving or consuming the
source; copies are published only after every selected body has been copied.

**Raw Onshape analytic snapshots still cannot be converted to native WC0.**
Using that geometry on Rust refuses with
`import/onshape-brep-conversion-unavailable`, including the namespace, part
name and part ID. Listing metadata is not proof of importing this geometry.
Feature Studio source imports, fsocct `version: "local"`, full `derive` /
`opMergeContexts`, configurations, mate connectors and unsupported query
forms remain outside this subset.

### Frozen regeneration sources (schema 2)

Instead of `parts` and `bodies`, an entry can supply the complete frozen
FeatureScript source of a Part Studio's exported build feature:

```json
{
  "namespace": "rails",
  "document": "555555555555555555555555",
  "documentVersion": null,
  "element": "111111111111111111111111",
  "microversion": "222222222222222222222222",
  "source": {
    "file": "source.fs",
    "sha256": "<SHA-256 of source.fs bytes>",
    "feature": "importedRails"
  }
}
```

`source.file` is store-relative and hash-checked before execution. Its imports
resolve exclusively through the same frozen manifest. Recursive dependencies
work; cycles refuse explicitly. This is regeneration, not a substitute for a
captured B-rep: it uses the named source's real operations on the chosen kernel
and refuses unsupported operations. No geometry is fabricated from metadata.
The resulting bodies record the source hash and immutable revision provenance.
External inputs must retain their real capture origin; synthetic fixtures must
label their identifiers as synthetic, not claim an Onshape capture.

`fixtures/fs-partstudio-imports` is a repository-authored synthetic two-studio
example with provenance and an independent closed-form volume. Its source has
two 8×4×4 mm rails. The second studio derives both, unions one translated rail
with a local rail (192 mm³), and retains the spare (128 mm³). No live project
was used to author these inputs.

### Composite parts

A part list entry with `bodyType: "composite"` becomes a record of the source
context, like a solid, and the module loads. The part list entry is checked
like every other (element, microversion, SHA-256 of the list). Using the
composite raises an `UnsupportedFeatureError` by name:

- `addInstance` whose `partQuery` selects the composite, alone or with other
  bodies, and any access to its geometry:
  `Using the composite part '<name>' (<partId>) of imported module '<ns>' is not implemented: composite parts are not implemented`.
- Any query over the whole source context (`qAllModifiableSolidBodies()`,
  `qBodyType(qEverything(...), BodyType.SOLID)`, also inside `addInstance`):
  `A query over the whole source context of imported module '<ns>' meets its composite part '<name>' (<partId>): composite parts are not implemented, and Onshape's answer would include the bodies a closed composite consumes, which the captured part list does not hold`.

Why the second refusal: a closed composite consumes its constituent bodies.
They leave the Parts list (and so the captured part list), but they stay
solid bodies of the context: `qAllModifiableSolidBodies()` still returns them,
which is why std has `qConsumed(query, Consumed.NO)` (FsDoc library,
`qConsumed`, `Consumed`, `opCreateCompositePart` `closed`). The part list
does not say whether a composite is open or closed, and the capture holds no
constituent bodies. Answering such a query from the captured solids alone
would invent the answer.

Both errors carry the location of the call that built the source context
(`NS::build(...)`, or the `addInstance` that built it implicitly): the refusal
is raised when a query reads the composite's record, which does not know the
query's own location.

The FeatureScript dataflow tracer (`src/lang/dataflow/fs-trace.mjs`)
resolves queries over the same records on its own. It refuses the same way,
through `isCompositeRecord`/`refuseComposite` from `src/modules.mjs`, with
the location of its own query: `qEverything(...)` over a source context that
holds a composite gives the whole-context refusal, and `addInstance` or
`instantiate` over a composite row the use refusal. A trace never records a
composite part as an `import` node.

To lift the second refusal for a revision, the capture has to prove what the
whole-context queries return, for example one FeatureScript evaluation per
revision of `qConsumed(qEverything(EntityType.BODY), Consumed.YES)` (no
consumed bodies: the captured solids are the complete answer; otherwise the
consumed bodies must be captured too). The loader does not read such a proof
yet.

## Manifest schema 2 (`wonky-onshape-inputs/2`)

```json
{
  "schema": "wonky-onshape-inputs/2",
  "generator": "scripts/snapshot-modules.mjs",
  "generatedAt": "2026-09-23T06:20:00.000Z",
  "store": "../../../../..",
  "source": { "corpusRoot": "~/Workspace/cad", "path": "cad-project-041/.../r59b.fs", "sha256": "3149b978…" },
  "sourceSha256": "3149b978…",
  "hostDocument": "onshape-id-b768d669",
  "hostDocumentFrom": "store revision 082fddfe…@e0aa7b21… (element ids are unique in Onshape)",
  "modules": [
    {
      "namespace": "base",
      "path": "onshape-id-019892ef",
      "revision": "onshape-id-019892ef@onshape-id-676f05b9",
      "document": "onshape-id-b768d669",
      "documentVersion": null,
      "element": "onshape-id-019892ef",
      "microversion": "onshape-id-676f05b9",
      "parts": { "file": "revisions/082fddfe…@e0aa7b21…/parts.json", "sha256": "7e9cd922…" },
      "bodies": [
        { "name": "T06 R6d 249.2mm rear hopper wall", "partId": "Zu2DD",
          "file": "revisions/082fddfe…@e0aa7b21…/bodies/Zu2DD.body.json", "sha256": "8285a1fc…" }
      ],
      "coverage": { "solids": 17, "captured": 9 }
    }
  ],
  "unresolved": []
}
```

| field | read by the loader | meaning |
|---|---|---|
| `schema` | yes | `wonky-onshape-inputs/2` |
| `store` | yes | directory, relative to the manifest, that file paths are resolved against and must stay inside. Default: the manifest directory. |
| `sourceSha256` | yes (recorded only) | SHA-256 of the source the manifest was generated for |
| `hostDocument` | yes | document of same-document imports, used when an entry has no `document` |
| `modules[].element`, `.microversion` | yes | the revision (`microversion` is the import `version`) |
| `modules[].documentMicroversion` | yes | the document microversion the part list and bodies name, when it differs from `microversion` (the import version was the element's own microversion). Default: `microversion`. |
| `modules[].document`, `.documentVersion` | yes | an entry with a `documentVersion` matches only a `<document>/<version>/<element>` import with the same document and version; an entry without one matches only a same-document `<element>` import |
| `modules[].parts` | yes | `{file, sha256}` of the raw part list |
| `modules[].bodies[]` | yes | `{partId, file, sha256}` of each captured B-rep; `name` is informative |
| `generator`, `generatedAt`, `source`, `hostDocumentFrom`, `namespace`, `path`, `revision`, `pin`, `coverage`, `unresolved` | no | provenance and reporting (`pin` is the pin mode) |

Schema 1 (`wonky-onshape-inputs/1`, only `fixtures/r10b` and the
fs-module-import repro) is still read: one `document` for all entries, part
lists at `modules/<namespace>/parts.json` with `partsSha256`, body files
relative to the manifest. Its entries are matched by revision too; the
`namespace` field only locates the part list.

## Store layout (`var/onshape-store/`, not in git)

```
var/onshape-store/
  revisions/<element>@<microversion>/
    revision.json                  what is held for this revision, with provenance
    parts.json                     raw GET /api/parts response, byte for byte
    bodies/<partId>.body.json      raw GET .../partid/<partId>/bodydetails, byte for byte
                                   (each uppercase letter marked with '_', then
                                   URL-encoded: RuHD -> _Ru_H_D, Z/1DD -> _Z%2F1_D_D;
                                   part ids are case-sensitive, macOS file names are
                                   not. Files written before 2026-09-23 15:50 keep
                                   the plain name that revision.json records.)
    query-answers/<hash>.json      raw FeatureScript evaluation of a static partQuery
  documents/<document>/
    m/<microversion>/elements[-<element>].json   raw elements listing at a document
                                   microversion (immutable; evidence for pins)
    v/<version>/elements.json      the same at a document version
    history/<microversion>.json    raw document-history page ending at that
                                   microversion (immutable)
    workspaces.json                workspace list at fetch time (mutable, informative)
  element-documents.json           element -> document evidence from corpus URLs
  captures/<captureId>.json        one record per capture run or seed
  manifests/<corpus-relative path>.json   schema-2 manifest per source file
```

A revision is immutable, so a file is written once. Writing different bytes for
an existing file is an error (`writeOnce` in `scripts/onshape-store.mjs`).

`revision.json` (`wonky-onshape-revision/1`):

```json
{
  "schema": "wonky-onshape-revision/1",
  "key": "<element>@<microversion>",
  "document": "…", "documentVersion": null, "element": "…", "microversion": "…",
  "pin": { "mode": "history", "documentMicroversion": "<D>", "elementMicroversion": "<version>", "workspace": "…",
           "historyEntry": { "date": "…", "description": "…" }, "evidence": [ { "listing": "m/<D>", "file": "documents/…", "sha256": "…",
           "elementName": "…", "elementType": "PARTSTUDIO", "elementMicroversion": "<version>" } ], "probes": [ … ], "capture": "<captureId>" },
  "parts": { "file": "parts.json", "sha256": "…", "capture": "<captureId>", "apiPath": "/api/parts/d/…/m/<D>/e/…" },
  "bodies": [ { "partId": "…", "name": "…", "file": "bodies/….body.json", "sha256": "…", "capture": "<captureId>",
                "apiPath": "…", "vertices": 8, "edges": 20, "faces": 10, "surfaceTypes": ["plane"], "curveTypes": ["line"] } ],
  "queryAnswers": [],
  "captures": ["<captureId>"]
}
```

`pin` is described in [Resolving an import version](#resolving-an-import-version).
A revision whose element is not a Part Studio (a Feature Studio imported as
code) gets `notCapturable: {elementType, reason}` instead of a part list.
Body entries copied from another revision at the same pinned state carry
`copiedFrom`.

`queryAnswers` holds capture-time answers to static `partQuery` expressions
that a B-rep cannot answer, for example
`qCreatedBy(makeId("<source feature id>") + "…")`: the query text, the raw
response file, and the selected bodies (`partId` matched by exact id, else by
a unique name). Only queries whose identifiers are all FeatureScript query
builtins are evaluated; `makeId(SOURCE_FEATURE) + item.operation` names the
importing file's variables and is left alone. The loader does not read
`queryAnswers` yet (qCreatedBy over an imported source context stays refused).

`captures/<captureId>.json` (`wonky-onshape-capture/1`) holds the provenance of
one run: kind (`seed` or `bridge`), time, bridge URL, the metering counters
before and after, the request log with `x-rate-limit-remaining` per response,
and the revisions it touched. The r10b seed record points at
`fixtures/r10b/modules.json` and `fixtures/r10b/snapshot-requests.json` (with
their SHA-256) and copies the original capture's time and metering.

## Scripts

`scripts/snapshot-modules.mjs` (helpers in `scripts/onshape-store.mjs`, bridge
client in `scripts/onshape-bridge.mjs`). The corpus (`~/Workspace/cad`, or
`--corpus-root`) is only read.

```sh
node scripts/snapshot-modules.mjs seed-r10b              # copy the r10b capture into the store (offline)
node scripts/snapshot-modules.mjs plan --all             # missing revisions/parts and the calls a capture would cost (offline)
node scripts/snapshot-modules.mjs capture --resume --query-answers   # the bridge capture (see below)
node scripts/snapshot-modules.mjs capture <file>... [--max-bodies N] [--dry-run]
node scripts/snapshot-modules.mjs reanswer               # recompute stored query answers (offline)
node scripts/snapshot-modules.mjs manifests --all        # a manifest for every corpus source with a held revision (offline)
node scripts/snapshot-modules.mjs manifests <file>...    # the same for chosen files
node bin/wonky.mjs ~/Workspace/cad/<path> --check --feature <name> \
  --modules var/onshape-store/manifests/<path>.json
```

The document of an import comes from its path (`<document>/<version>/<element>`),
else `--document`, else the nearest `state.json` above the source (`document`
or `documentId`), else a held revision, else corpus URL evidence: text files
below 1 MiB that contain `d/<document>/{w,v,m}/<id>/e/<element>` for that
element, unanimously (cached in `element-documents.json`). Every guess is
verified by the elements listing the pin is checked with. A host document that
disagrees with the store leaves that import unresolved, with the reason in
`unresolved`.

### Corpus runner

`scripts/corpus/run.mjs` (and its probe, `scripts/corpus/probe.mjs`) uses the
store manifests. For each FS unit:

1. a sibling `modules.json` wins; the CLI reads it by itself, as before;
2. otherwise, if `var/onshape-store/manifests/<corpus path>.json` exists, it is
   passed with `--modules`;
3. otherwise the unit runs without frozen inputs, exactly as before.

Each record names the manifest it used (`modules: { source, path, sha256 }`).
`--no-store-manifests` turns step 2 off for A/B runs. The results of the
first run over the whole cluster are in [corpus/w4.md](corpus/w4.md).

## Capture

Capturing goes through a local, signed-in Onshape session bridge only (a localhost proxy that is not part of this repository), never API keys, one process at a time, read-only. The bridge client refuses any other host and any method except GET and POST to `.../featurescript`. A capture run:

1. checks that the bridge is up and the session is signed in, and records the account's API usage counters;
2. prints the planned calls per endpoint (`--dry-run` stops there) and keeps
   20 % of every bucket in reserve: a call that would leave
   `x-rate-limit-remaining` below 20 % of the bucket's cap is not made, and that
   bucket stops for the run (`BudgetStop`). The cap is the measured one, or the
   first observed remaining when that is higher;
3. pins every missing revision (below), highest priority first (families of
   the fs-module-import cluster, then the most families and sources), and
   fetches its part list at the pinned state;
4. fetches `bodydetails` for every solid, non-mesh part not yet held, family
   by family: complete-able families first, then cluster families, then the
   cheapest. A body of the same element, part and pinned document microversion
   held by another revision is copied instead of fetched;
5. with `--query-answers`, evaluates each static `makeId` partQuery once in the
   source Part Studio at the pinned state;
6. on 429 waits `retry-after` once when it is at most 90 s, otherwise stops that
   bucket (no polling);
7. re-reads the usage counters every 100 Onshape calls and at the end, and stops with an error if they moved.

Every request (path, status, `x-rate-limit-remaining`, `retry-after`, bytes,
time) goes into `captures/<id>.json` as it happens, with the metering checks,
the per-bucket summary, the per-revision outcome, what is still pending and the
resume command. Held files are never fetched again, so an interrupted or
budget-limited run continues with the same command.

### Resolving an import version

An import `version` is not always a document microversion. Marc's tools write
either the `microversionId` of a workspace part list (a document microversion,
e.g. r10b) or the element's own `microversionId` from an elements listing (an
element microversion, e.g. the R6d family). `GET /api/parts/d/<doc>/m/<element
microversion>/…` answers 404, and the query parameter `elementMicroversionId`
is ignored by Onshape (a bogus value returns 200 with the current workspace
state; probed 2026-09-23). So the capture pins every revision to a document
microversion D at which the element had exactly the imported state, and checks
that with an elements listing at D before any part or body is fetched. Modes, in
the order they are tried:

| mode | when | D | evidence |
|---|---|---|---|
| `alias` | a held revision of the same element was pinned at a state with this element microversion | that revision's D | its listing; part list and bodies are copied |
| `document-microversion` | `/m/<version>/elements` exists | the version itself | listing at `m/<version>` |
| `document-version` | `<doc>/<ver>/<element>` import whose element microversion at `v/<ver>` equals the version | the `microversionId` of the part list at `v/<ver>` | listing at `v/<ver>` |
| `history` | otherwise | the history entry after which the element had this microversion | listing (filtered to the element) at `m/<D>`, plus the probe trail |

History search: each element microversion covers one contiguous stretch of the
document history. The search starts at the newest history entry not later than
the importing files' earliest mtime plus 60 s (the version was read before the
file was written), and walks back one element-microversion interval at a time:
it gallops back until the element's microversion changes and binary-searches
the change point. The search stops when it finds the version, when the element
does not exist yet, or after 150 probes. If that fails, the same search runs
again from the workspace heads, for copied files whose mtime is older than the
version they name. Tab names are not used: tabs get renamed, so the old
entries carry other names. History pages up to `/m/<M>` are immutable and
cached. An import whose element is not a Part Studio is recorded as
`notCapturable` (a code import, stage 4) without a parts request.

A pin is only as good as the element microversion: Onshape changes it on every
edit of the element. A Part Studio whose geometry depends on another element
(a derived feature or a Variable Studio) could in principle change without a
new element microversion; the capture does not check this.

## Capture log

### 2026-09-23 (W4 stage 2)

Six read-only capture runs (two pilots, probes, four resume runs) made 2,305 Onshape calls
(bodydetails 1842, elements 213, documenthistory 121, parts 75, workspaces 9, featurescript 3,
plus session and usage checks). The usage counters did not move, no 429 occurred and the 20 %
reserve was never reached. Wasted calls: 3 parts (an element microversion taken for a document
microversion, two calls on a Feature Studio) and 1 bodydetails (`RuHD`/`RUHD` collided on the
case-insensitive disk; refused, then fetched under a case-safe name). The `parts`, `bodydetails`
and `documenthistory` buckets are short sliding windows, not daily budgets.

**Result**
- 82 imported Part Studio revisions across the corpus, 57 of them in the
  fs-module-import cluster. The cluster analysis counted 63; it also counted
  the Feature Studio and local imports.
- 81 pinned:
  - history 34;
  - document-version 28;
  - document-microversion 15 (including the 8 r10b revisions);
  - alias 4.
- 80 revisions hold their part list and every solid part: 2024 bodies, 0 mesh
  parts, 0 missing.
- 1 is not capturable: `45366781…@1ddd7d39…` is a Feature Studio (code import,
  stage 4).
- 1 could not be pinned: `ddce30e6…@a6532d72…` (fs560, cad-project-040). 56
  probes from the source mtime and from both workspace heads saw only the
  element microversions `7f693ba1`, `aad49641`, `4a05e539` and `759df126`.
  The version is in no history of document `e49ff434…`; it may come from a
  deleted branch or a copy of the document.
- 56 of 57 families have all their Part Studio inputs, including all 37
  cluster families.
- 3 static `makeId` partQuery answers were evaluated (3 FS calls); each
  selects one part, matched by exact part id.
- Store: 311 MB. The document listings and history pages are 12 MB of that.
- 214 corpus manifests were written, and 1 source was skipped.

**Verification.** All 274 import units of the 96 cluster files were run through
`bin/wonky.mjs --check --modules var/onshape-store/manifests/<path>.json`.
- 257 units get past the import: 7 build (`r10bRetainedContext`) and 250 stop
  at a named next blocker.
- 17 stay `Unresolved Onshape module`, all stage 4: 16 Feature Studio code
  imports (`SourceR11`, `TopR3` in the `module-r4` files) and 1 fsocct
  `version: "local"` import.
- 0 units report an uncaptured body or a manifest/checksum error. The 6 r10b
  units that needed T60, C00 and T02 now get past their imports.
- 35 of the 38 families have all their import units past the import.

Next blockers (units / families):

| blocker | units | families |
|---|---|---|
| imported surface `torus` | 46 | 1 |
| curved convex-tool intersection | 44 | 3 |
| imported surface `other` | 34 | 4 |
| part list with a `composite` part (the loader refuses the whole module) | 32 | 7 |
| Bend Real serialization (finite magnitude ≤ 1e20) | 23 | 6 |
| `qNthElement` | 20 | 5 |
| general `opBoolean` | 18 | 3 |
| imported curve `icurve` | 15 | 5 |
| imported surface `extruded` | 6 | 5 |
| collinear profile edges | 5 | 4 |
| `qCreatedBy` over a source context | 3 | 3 |
| `mergeMaps` | 2 | 2 |
| imported edge without an analytic curve, or needing another intersection branch | 2 | 2 |

`frame_r2.fs` (fs508) now loads the real R6d snapshots and stops at its
`opBoolean` (24:27).

**Corpus run `--label w4` (integration, 17:17 to 17:49 local).** The corpus
runner now passes the store manifests (see [Corpus runner](#corpus-runner)).
`run.mjs --label w4 --cluster fs-module-import` ran all 274 units through
`bin/wonky.mjs --format step`, 3 processes, load 11 to 105; 273 of them with
a store manifest. The result matches the verification above unit by unit
(274/274 same outcome and message):
- 257 units (92 files, 35 of 38 families) get past their imports: 7 build,
  161 stop in the imported-body loader, 89 load the imported bodies and stop
  later in the model;
- 17 stay unresolved (stage 4);
- 0 missing bodies, 0 manifest errors, 0 timeouts;
- the 7 units that were ok in the baseline are unchanged (same bodies, faces,
  edges, volume and bounding box); `compare.mjs` reports 0 regressions.

Details and the full next-blocker table: [corpus/w4.md](corpus/w4.md).

**Corpus run `--label composite` (2026-09-24, decision 11).** The 32 units
whose W4 record was `contains unsupported body type 'composite'` (7
families) were rerun with the new loader:
`node scripts/corpus/run.mjs --label composite --keys-file <the 32 keys> --concurrency 3`
(results in `out/corpus/bench/composite/runs.jsonl`).

- 31 units (6 families) get past the loader: their modules load.
- All 31 stop at the next step, the whole-context refusal above: every one
  of them selects its source bodies with `qAllModifiableSolidBodies()` or
  `qBodyType(qEverything(EntityType.BODY), BodyType.SOLID)`.
- 1 unit (`cad-project-005/rotor-experiments-r1.fs`) still
  stops in the loader: its `Channel` part list also holds a `wire` part
  (`Curve 1`), which still refuses the module.

A diagnostic run (not production: an in-memory load hook made the
whole-context query answer from the captured solids only, as if no body were
consumed) shows what the 31 units would reach after a capture proves that:
16 imported surface `other`, 5 `Imported edge ... misses face ... by
0.0018 mm` (the `funnel-holder` guides), 3 Bend Real serialization, 3
`Analytic solid contains disconnected shells` (`loadSc15Flap`), 1 imported
curve `icurve`, and 3 would build (`loadSc15Coupling`). Those 3 builds are
not results: they rest on the unproven assumption.

**Pending and resume.** Nothing is left that a capture can fetch: one
revision cannot be pinned and one is a Feature Studio. To continue after new
corpus files or a new `--document`:

```sh
node scripts/snapshot-modules.mjs plan --all
node scripts/snapshot-modules.mjs capture --resume --query-answers   # bridge; skips everything held
node scripts/snapshot-modules.mjs manifests --all
```
