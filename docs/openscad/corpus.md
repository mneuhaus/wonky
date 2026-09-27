# OpenSCAD corpus census and first oracle runs

Status: research, 24 September 2026. Written by the architect from the
corpus-census agent's machine-readable findings
(`tmp/openscad/corpus-census/findings.json`), which left no Markdown report.
Every number below is copied from that file or its linked artifacts; the
labels are the agent's. Nothing is implemented; no wonky run is involved.
How the design uses this corpus: [design.md](design.md) §7 and §10.

Labels: **MEASURED** (counted or run), **READ** (licence texts, repository
metadata), **INFERRED** (screening or recommendation, never a build result).

All paths below are relative to `tmp/openscad/corpus-census/` unless stated.

## 1. Summary

- **Primary corpus: 806 files** (MEASURED, `census-summary.json`): 395 local
  copies of every `.scad` path under `~/Workspace/cad`, 387 original public
  files from 10 repositories at pinned commits, and 24 code-only extracts of
  BOSL2 tutorial examples.
- A supplementary census covers **all 2,550 acquired `.scad` files**
  (2,418 distinct hashes), including 1,744 library and support files that
  were not selected (`acquisition-census.json`). Primary percentages use the
  806, never the 2,550.
- **60 oracle runs** with the installed OpenSCAD 2022.05.16 (CGAL, no
  experimental flags), 20 local and 40 public, 120 s timeout, at most 2
  processes (MEASURED, `oracle-environment.json`).
- **21 strict references**: diagnostics-free CSG and STL runs whose binary
  STL passes an independent mesh admission. 20 are public, 1 is local
  (MEASURED, `oracle-summary.json`).
- Screening for wonky is conditional: 102 of 806 files fit today's reviewed
  operations in either mode; 133 with planned faceted ingress (INFERRED,
  `planning-and-licenses.json`). These are not build rates.
- No source original, installed library or production file was changed; all
  395 originals still match their recorded hashes (MEASURED,
  `source-integrity-audit.json`).

## 2. Composition

### 2.1 Local files (MEASURED)

- 395 paths, **314 distinct contents**. 392 paths are research mirrors under
  `~/Workspace/cad/cad-project-043/var/research/**`, 3 are copies in
  `cad-project-039`.
- The local set is mostly archived terrain-model downloads (OpenLOCK,
  OpenForge, DragonLock and similar), **not 395 independent designs by
  Marc**.
- Only 36 local files could be matched to a git blob with a verified commit;
  356 mirror files are untracked in their worktree and have no verified
  upstream commit; 3 project files have none. The agent recorded `file://`
  URLs and hashes and did not invent commit mappings (`inventory.json`).

### 2.2 Public files (READ metadata, MEASURED counts)

| repository | commit (short) | selected | licence declaration | category |
|---|---|---|---|---|
| openscad/openscad | 28fe66bc | 170 (all examples + 120 tests) | examples CC0-1.0; tests GPL-2.0 with CGAL exception (repository default) | official examples and tests |
| nophead/NopSCADlib | c9baa0ed | 55 | GPL-3.0 | library examples and tests |
| JustinSDK/dotSCAD | bb33edfd | 50 | LGPL-3.0 | library examples |
| BelfrySCAD/BOSL2 | 4566659a | 35 (11 originals + 24 tutorial extracts) | BSD-2-Clause | library examples and tests |
| ostat/gridfinity_extended_openscad | 94d5a3e2 | 30 | GPL-3.0 | customizer models |
| syvwlch/Thingiverse-Projects | 2fb6fa9b | 29 | CC-BY-SA (version unspecified; 2 files 3.0) | Thingiverse collection |
| rsheldiii/openSCAD-projects | 67227f89 | 16 | LGPL-3.0 | customizer collection |
| rsheldiii/KeyV2 | 19f0d2fa | 13 | GPL-3.0 | customizer models |
| osresearch/openscad | f383f81d | 9 | unresolved | model collection |
| kennetek/gridfinity-rebuilt-openscad | 910e22d8 | 4 | MIT (repository; third-party exceptions possible) | customizer models |

Full URLs and per-file records: `repositories.json`, `inventory.json`. An
eleventh attempted repository (`jmil/Thingiverse`) had no checked-out `.scad`
files and contributes nothing.

- **Selection** (READ `findings.json` `corpus.selectionMethod`): purposive
  strata by source and feature, deterministic SHA-256 order within pools,
  seed `openscad-census-2026-09-24`. It makes no claim of random coverage of
  GitHub or the internet.
- **Bias** (INFERRED by the agent): official tests contain assertion
  failures, non-manifold examples, 2D programs and newer syntax on purpose;
  library helper syntax is not the same as executed modeling operations.
- **Roles** (MEASURED): 667 model or geometry tests, 16 language or
  assertion tests, 123 library files or fragments (106 of them local). The
  139 non-model entries are excluded from candidate counts.

## 3. Census of features

### 3.1 Method (READ `findings.json` `census.method`)

A lexical scanner, not a full parser: comments and strings are ignored,
definition headers are not counted as calls, bodies are. Three measures per
feature: **files** with at least one call, **calls**, and
**dependency-closure files** whose full include/use closure contains the
feature. The closure is conservative: unused library helpers count, so it
overstates what a simple caller needs. Direct-only screening was too
optimistic (453 apparent candidates, 102 under the closure).

### 3.2 Geometry features (MEASURED, `census-summary.json`)

| feature | files (local / public) | calls (local / public) | closure files (all) |
|---|---|---|---|
| translate | 215 / 209 | 8,109 / 1,577 | 690 |
| scale | 76 / 36 | 3,812 / 103 | 406 |
| rotate | 135 / 133 | 3,184 / 481 | 584 |
| cube | 160 / 117 | 1,733 / 411 | 595 |
| union | 173 / 69 | 935 / 114 | 483 |
| cylinder | 48 / 73 | 644 / 187 | 299 |
| difference | 136 / 111 | 633 / 269 | 426 |
| color | 43 / 67 | 52 / 348 | 233 |
| linear_extrude | 13 / 91 | 33 / 318 | 307 |
| sphere | 1 / 70 | 2 / 277 | 204 |
| hull | **61 / 27** | **268 / 63** | 289 |
| intersection | 35 / 35 | 184 / 52 | 290 |
| square | 2 / 53 | 8 / 229 | 188 |
| mirror | 39 / 18 | 184 / 38 | 241 |
| import | **33 / 28** | **122 / 56** | 333 |
| circle | 2 / 46 | 2 / 147 | 188 |
| offset | 0 / 20 | 0 / 118 | 158 |
| polygon | 13 / 32 | 28 / 77 | 266 |
| rotate_extrude | 2 / 16 | 8 / 53 | 140 |
| linear_extrude with scale | 1 / 17 | 2 / 53 | 101 |
| resize | 0 / 3 | 0 / 53 | 51 |
| polyhedron | 2 / 31 | 2 / 51 | 184 |
| text | 0 / 29 | 0 / 42 | 110 |
| render | 3 / 18 | 3 / 30 | 148 |
| surface | 4 / 6 | 15 / 11 | 10 |
| minkowski | 0 / 14 | 0 / 25 | 81 |
| linear_extrude with twist | 0 / 10 | 0 / 18 | 58 |
| projection | 0 / 6 | 0 / 17 | 44 |
| import_stl (deprecated) | 0 / 6 | 0 / 8 | 6 |
| multmatrix | 0 / 2 | 0 / 2 | 112 |
| intersection_for | 0 / 2 | 0 / 2 | 19 |
| roof | 0 / 2 | 0 / 6 | 2 |

Correction of the task statement: local `hull` is **268 calls in 61 files**,
not 268 files; local `import` is 122 calls in 33 files, and included helpers
widen the import footprint to 251 local files (MEASURED). The semantics study
counted with grep and got 280 `hull(` in 64 files and 130 `import(`
(semantics.md §9.6); the difference is comments, strings and definition
headers.

### 3.3 Language features and resolution (MEASURED)

| feature | files (local / public) | calls (all) |
|---|---|---|
| module definitions | 175 / 205 | 1,888 |
| function definitions | 54 / 66 | 1,277 |
| for | 54 / 177 | 1,102 |
| $fn | 36 / 114 | 781 |
| include | 318 / 142 | 601 |
| children | 0 / 40 | 455 |
| use | 0 / 147 | 342 |
| list comprehensions | 3 / 81 | 334 |
| let | 0 / 64 | 233 |
| direct recursion | 0 / 19 | 45 |
| $fs, $fa | 0 / 32, 0 / 33 | 76, 57 |
| each | 0 / 13 | 29 |

Library prefixes: BOSL2 in 33 files, NopSCADlib in 12, MCAD in 5 (explicit
prefixes only). None of Marc's local files includes BOSL2.

Literal `$fn` values (lexical right-hand sides, not evaluated,
`resolution-census.json`): 150 files set `$fn`; **27 files use a literal
3 to 6** and 41 files 3 to 12. Most frequent values: 200 (337), 8 (61),
20 (59), 100 (47), 50 (38), 4 (27), 24 and 64 (21 each). Small literal values
are often deliberate polygons (nut traps, keys, flats), which matters for
intent mode ([design.md](design.md) §3.3).

Randomness: 58 files call `rands` directly; seeds and fonts are not
stabilized by the census.

## 4. Oracle runs (MEASURED)

### 4.1 Setup

`oracle.mjs` copied each selected source unmodified and ran two separate
OpenSCAD processes per file: an expanded `.csg` export and a binary STL
export with `-d` dependencies. No `-D` overrides, no wrappers, no automatic
extrusion of 2D programs. `OPENSCADPATH` pointed at pinned copies in
`tmp/openscad/corpus/libraries` and dotSCAD's `src`. Binary sha256
`13ba3861…`, Apple M5 Pro, 18 logical CPUs, nice 10, concurrency 2.
Environment: `oracle-environment.json`.

Mesh admission (`mesh-check.mjs`): exact welding of float32 vertices, every
undirected edge used exactly twice with opposite orientations, one cycle per
vertex link, no duplicate or zero-area triangles. It does **not** prove the
absence of geometric self-intersections.

### 4.2 Results

| | all | local | public |
|---|---|---|---|
| runs | 60 | 20 | 40 |
| success without diagnostics | 29 | 3 | 26 |
| geometry with warnings | 17 | 13 | 4 |
| failure | 7 | 3 | 4 |
| empty | 3 | 1 | 2 |
| non-3D output | 3 | 0 | 3 |
| timeout | 1 | 0 | 1 |
| meshes produced | 46 | 16 | 30 |
| closed, oriented 2-manifold | 37 | 13 | 24 |
| **strict references** | **21** | **1** | **20** |

Diagnostic classes over all 60: missing asset 9, undefined variable or
parameter 8, argument or reassignment 4, source parser error 4, default
program empty 3, 2D or non-3D output 3, oracle version assertion 2, source
assertion 1, missing include 1, unknown module 1, oracle timeout 1.

Timing of the STL runs: 515.7 s of process time, 267.5 s wall with two
workers; median 0.50 s, p90 23.3 s, p95 54.3 s, slowest success 93.0 s
(`dotSCAD/examples/spiral/text_tower.scad`, 79,496 triangles), one timeout
(`dotSCAD/examples/circle_packing/packing_circles.scad`). Triangle counts:
median 2,108, p90 15,648, max 79,496. The `.csg` exports took 12.0 s in
total (architect's aggregation, [design.md](design.md) §0.2).

### 4.3 The 21 strict references

| run | file | licence | triangles | STL s |
|---|---|---|---|---|
| 001 | openscad examples/Basics/CSG.scad | CC0-1.0 | 3,004 | 1.67 |
| 002 | openscad examples/Basics/hull.scad | CC0-1.0 | 476 | 0.16 |
| 003 | openscad examples/Basics/linear_extrude.scad | CC0-1.0 | 7,278 | 1.84 |
| 006 | openscad examples/Advanced/surface_image.scad | CC0-1.0 | 6,376 | 7.42 |
| 007 | openscad examples/Old/example010.scad | CC0-1.0 | 9,542 | 4.48 |
| 008 | openscad examples/Old/example007.scad | CC0-1.0 | 524 | 0.21 |
| 009 | openscad tests 3D/features/minkowski3-tests.scad | GPL-2.0 (repo default) | 236 | 0.39 |
| 011 | openscad tests 3D/features/polyhedron-cube.scad | GPL-2.0 (repo default) | 12 | 0.04 |
| 019 | BOSL2 tutorial Shapes3d-001 | BSD-2-Clause | 12 | 0.25 |
| 020 | BOSL2 tutorial Transforms-019 | BSD-2-Clause | 50 | 0.21 |
| 021 | BOSL2 tutorial Rounding_the_Cube-021 | BSD-2-Clause | 120 | 0.32 |
| 023 | NopSCADlib tests/rounded_cylinder.scad | GPL-3.0 | 3,732 | 0.65 |
| 024 | NopSCADlib tests/cable_clip.scad | GPL-3.0 | 3,750 | 3.66 |
| 028 | dotSCAD examples/knot.scad | LGPL-3.0 | 2,520 | 0.05 |
| 029 | dotSCAD examples/spiral/text_tower.scad | LGPL-3.0 | 79,496 | 93.02 |
| 030 | gridfinity-rebuilt-baseplate.scad | MIT (repo) | 4,224 | 2.71 |
| 032 | gridfinity-spiral-vase.scad | MIT (repo) | 3,492 | 3.83 |
| 036 | KeyV2 examples/legends.scad | GPL-3.0 | 15,648 | 25.57 |
| 037 | Thingiverse-Projects Threaded Library/CutNut.scad | CC-BY-SA | 614 | 0.32 |
| 040 | osresearch torus-customizer.scad | unresolved | 9,276 | 7.13 |
| 045 | local dragonlock openforge-bases/bases-wall-primary.scad | Apache-2.0 | 808 | 3.03 |

Each run directory `runs/<run>-<hash>/` holds `expanded.csg`,
`reference.stl`, `dependencies.d`, both logs and `result.json`.

### 4.4 Mesh admission failures (MEASURED)

Nine meshes fail admission: five with incidence or vertex-link problems
(including `polyhedron-self-touch-vertex-nonmanifold.scad`: exit 0, closed
edges, one bad vertex link; BOSL2 `attachments.scad` and `spring_handle.scad`;
dotSCAD `dancing_cubes.scad` with 505 non-manifold edges; one OpenForge
gatehouse floor) and four with only zero-area triangles (gridfinity bins,
ScaleExtrudeHorns, two OpenForge/OpenVLEX bases). The zero-area cases may be
float32 export artifacts; the agent recommends cross-checking them with OFF
or 3MF before blaming the model. Lesson: exit code 0 and closed edges do not
make a usable reference.

## 5. Missing assets and version gates (MEASURED)

- 135 logged uses of local assets (STL files for `import()` and similar) are
  missing, and **all of them are also missing in the originals** under
  `~/Workspace/cad` (`missing-assets-audit.json`). Some of these files still
  export a smaller, incomplete STL with only a warning. They must be
  quarantined, never used as references.
- Two current Gridfinity Extended models assert a newer OpenSCAD version
  and refuse 2022.05.16 (READ `tmp/openscad/corpus/public/ostat--gridfinity_extended_openscad/modules/functions_general.scad:124`).
- NopSCADlib has preview-only entrypoints that export empty with plain CLI
  defaults (READ `tmp/openscad/corpus/public/nophead--NopSCADlib/tests/rod.scad:44`).
- No dependency resolved to an unexpected personal or original library path
  (`dependency-boundary-audit.json`).

## 6. Recommendations of the census (INFERRED)

- **P0** Use the 21 strict references as the first local differential group;
  keep the other 39 runs as negative and triage cases. Check redistribution
  rights and self-intersection separately.
- **P0** Keep faceted and intent as named modes with their own tolerances.
  Start with primitives, CSG, scopes, loops, modules and children, and exact
  literal polyhedra; no silent analytic fallback.
- **P0** Store per reference: entrypoint kind (3D, 2D, library, assertion),
  parameters, source and dependency hashes, library versions, binary hash,
  backend, warning and error ledger, output checksum. A missing dependency or
  skipped unknown module makes a reference fail.
- **P1** A library test-invocation manifest: preview-only and module-only
  examples need explicit upstream entrypoints in their own run class, never
  hidden wrappers mixed with default programs.
- **P1** hull, Minkowski, offset and affine transforms as explicit Bend
  projects; the lexical counts support hull, mesh ingress and transforms
  first, but do not prove which executed operations unblock whole models.
- **P1** A newer OpenSCAD with Manifold as a separately pinned oracle lane,
  without overwriting the CGAL baseline. No speedup was measured here.
- **P1** Cross-check the nine STL admission failures with OFF/3MF.

## 7. Licences (READ)

Declarations over the 806 selected files: unresolved 293 (284 local mirrors,
9 osresearch), GPL-2.0 with CGAL exception 120 (OpenSCAD tests, repository
default), Apache-2.0 107 (local OpenForge copies), GPL-3.0 98, LGPL-3.0 66,
CC0-1.0 50 (OpenSCAD examples), BSD-2-Clause 35, CC-BY-SA 29, MIT 4,
CC-BY-SA-4.0 1, unresolved local project files 3.

Rules the agent applied (`findings.json` `licensing.rules`):

- No third-party source was committed.
- GitHub licence metadata is a hint; file and subtree declarations win;
  inherited repository licences are marked as such.
- OpenSCAD examples are CC0 (49 explicit notices, one directory-level
  inference); tests carry the repository's GPL-2.0 text plus the CGAL
  exception, not audited per file.
- Local copies do not imply Marc's authorship.
- A generated reference mesh can carry the source's obligations; the
  compiler's licence and the geometry's rights are separate questions.

The commit policy for fixtures is in [oracle.md](oracle.md) §9 and
[design.md](design.md) §7.

## 8. Eligibility screen for wonky (INFERRED, not executed)

Three conditional screens over the 806 files, all assuming a working
OpenSCAD language frontend (`planning-and-licenses.json`):

| screen | all | local | public |
|---|---|---|---|
| today's reviewed operations, faceted | 102 | 2 | 100 |
| today's reviewed operations, intent | 102 | 2 | 100 |
| with planned faceted ingress (faceting, polyhedron ingress, twisted/scaled sweeps, affine transforms) | 133 | 4 | 129 |

Top blockers by closure files: scale 406, import 333, hull 289, mirror 241,
offset 158, non-model entrypoint 139, multmatrix 112, text 110, non-trivial
extrude scale 101, minkowski 81, non-trivial twist 56, resize 51,
projection 44, surface 10, unresolved include 8.

On the 60 expanded trees actually produced by OpenSCAD, the same screen
admits 8 faceted and 6 intent candidates. The architect's dynamic scan of the
46 meshed trees, per work package, is in [design.md](design.md) §10.

## 9. Open items

- No wonky frontend was implemented or run; every eligibility number is
  conditional.
- No geometric self-intersection certification of the references.
- The static scanner does not execute include/use or resolve dead code.
- Unresolved licences and unknown upstream commits remain explicit.
- Random seeds, fonts, parameter sweeps and preview-only entrypoints need a
  reproducibility policy.
- No full render of all 806 files and no comparison with a newer backend.

## 10. Artifacts and reproduction

| artifact | content |
|---|---|
| `inventory.json` | per file: source URL, commit, hash, licence status, role |
| `census.json`, `census-summary.json` | per-file features and aggregates |
| `acquisition-census.json` | all 2,550 acquired files |
| `resolution-census.json` | `$fn/$fa/$fs` literals |
| `oracle-selection.json`, `oracle-results.json`, `oracle-summary.json`, `runs/` | the 60 oracle runs |
| `planning-and-licenses.json` | eligibility screens, licence rules |
| `missing-assets-audit.json`, `dependency-boundary-audit.json`, `source-integrity-audit.json` | audits |
| `selftest-results.json` | nine scanner and mesh self-tests (all passed) |
| `worklog.json` | the agent's checkpoint |

Reproduction (`findings.json` `reproduction`): `node census.mjs`,
`refine.mjs`, `selftest.mjs`, `oracle.mjs` (resumes when the source hash
matches; use a fresh run directory for a new baseline), `audit-results.mjs`,
`scan-acquisition.mjs`, `resolution-census.mjs`, `assemble-findings.mjs`,
all under `tmp/openscad/corpus-census/`.
