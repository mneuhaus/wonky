# Cluster py-api-surface: build123d API outside the Bend shim

Date: 2026-09-22 23:46 to 2026-09-23 00:24 local. Input: [the corpus run](run.md)
(`out/corpus/runs.jsonl`, cluster 8). HEAD `79bbfeec` plus the uncommitted
working tree of that moment, Node v22.23.1, Python 3.13 through `uv run`,
default JS path (`WONKY_BACKEND` unset), at most 3 wonky processes, the corpus
run's per-file budget (180 s, 480 s for the heavy paths such as lego-beam).
The machine was shared with benchmarks: load average 15 to 120 on 18 cores
(`uptime` at start and end of every pass is in
`out/corpus/py-api-surface/run-meta.jsonl` and `recover-next.json`). Nothing in
`src/`, `kernel/`, `bin/` or `python/` was changed, and `~/Workspace/cad` was
only read.

Re-checked 2026-09-23 04:12 to 04:22 on the current working tree (§11). The
only production change since the first pass is the native-backend hook in
`src/python.mjs` (`backendInfo`, `endsRun`). The repros and both re-run
next-blocker passes give the same result for all 40 files.

Machine-readable results in `out/corpus/py-api-surface/`:

- `surface.json`: per file, every build123d construct it uses, by tier;
- `next-lazy.jsonl`, `next-lazy-localpath.jsonl`, `next-lazy-localpath-khana.jsonl`:
  what each file hits once the first blocker is gone;
- `recover-next.json`: the bake-off `recover` route on the Boolean chains
  behind this cluster.

Repros: [`fixtures/corpus-repro/py-api-surface/`](../../fixtures/corpus-repro/py-api-surface/).
Scripts: `scripts/corpus/py-api-surface/`.

## Answer in short

1. **This cluster is the first blocker of all 40 files (39 families), and
   every one of them stops before its first Bend request.** No file completes a
   single modeling call.
   - 34 files stop at their `from build123d import (...)` statement.
   - 4 files stop at a return annotation (`-> Sketch`, `-> Part`), which Python
     evaluates when the `def` runs.
   - 2 files stop at the first use of a name (`FontStyle.BOLD`, `import_step`).
2. **The root cause is in the frontend: `python/build123d.py` has a closed and
   eager name table.**
   - Module `__getattr__` (line 218) raises the capability error for any name
     outside the shim. A named import calls it once per name, so the import
     statement fails at the first unknown name in its list.
   - `__all__` (line 215) lists 32 names. `from build123d import *` binds
     nothing else, so `Sketch`, `Part`, `FontStyle`, `import_step`, `Color` and
     the rest become plain `NameError`s instead of capability errors.
   - As a result, the recorded API names are an artifact of import order.
     "Compound 11, Part 8" means that `Compound` or `Part` came first in the
     import list. It does not measure what the files use.
3. **What the files really need is most of build123d.** A static scan
   (stdlib `ast`, nothing executed) finds a median of 23 constructs per file
   that the shim does not implement (minimum 2, maximum 53).
   - All 40 files need frontend-only API: `Part`, `Compound`, `Plane`, `Rot`,
     `export_*`, `bounding_box`.
   - 33 files need sketches and `extrude` on top of existing Bend construction.
   - 32 files need kernel features that Bend lacks today: `fillet` (19 files),
     `chamfer` (16), `Text` (10), `offset` (9), `loft` (5), `Sphere` (5), ...
   - 14 files need external geometry: `import_step` (9), OCP, `bd_warehouse`.
   - Only 2 files need nothing beyond frontend work and Bend operations that
     already exist: `cad-project-025/beam_frame.py` and
     `cad-project-041/single-step-r10/jobs/endstop/geometry.py`.
4. **The fix has three frontend stages. Kernel work is separate.**
   - **Stage 1 (effort S):** a complete, lazy name table and a package guard.
   - **Stage 2 (effort M):** containers, rigid placement, metadata, and export
     calls as named outputs.
   - **Stage 3 (effort L):** sketch profiles, `extrude`, `Cone` and `revolve`
     on existing Bend construction, plus builder mode.
   - Tier C (fillet, chamfer, text, offset, loft, sphere) and tier X (a STEP
     reader, a Bend-side cad_khana) are kernel and ecosystem work. They belong
     to separate work items.
5. **Stage 1 alone builds no file.** I emulated it in copies of the files (a
   one-line preamble, line numbers unchanged) and ran them through the
   production CLI:

   | next blocker after stage 1 | files | … with the model directory and cad_khana on the path |
   |---|---:|---:|
   | build123d API at its real use site (`RectangleRounded`, `Polygon`, `Shape.edges`, `Rot`, `Solid.make_box`, ...) | 17 | 26 |
   | Python import (`cad_khana` 11, local modules 6, `bd_warehouse` 1 / then `bd_warehouse` 4, `yaml` 2, `httpx`, `build123d.exporters`) | 18 | 8 |
   | OCP import, refused by design | 2 | 3 |
   | no `result`: the file is a library module | 2 | 2 |
   | `opBoolean` capability (`sanding_head_v3.py:255`) | 1 | 1 |

   `cad_khana` cannot run on wonky at all today. It builds a `Location()` at
   class definition, imports `build123d.exporters` and imports OCP directly
   (`export.py`, `printability/holes.py`, `pins.py`, `structure.py`). 11 files
   of this cluster depend on it.
6. **Overlap with in-flight work.**
   - **Bake-off `recover` route.** This cluster is not a Boolean, so the route
     does not remove it. It does cover the Boolean chains that come next:
     - `beam_frame.py` with `optimize=False` recovers exactly (114 faces,
       volume within 4.7e-15 of OCCT's exact CSG);
     - the `endstop/geometry.py` bracket E10 and boss E12 recover exactly;
     - the first `sanding_head_v3.py` cut recovers exactly.

     Production refuses all three today. The default `optimize=True`
     beam frame is refused by `recover` itself.
     - The box chain at the start of `project-component-abeb2fd3.py` `tray()` builds in
       production, but with 114 faces instead of 11 and 34 s of CPU.
       `recover` gives exactly 11 faces in 2 ms (added in the re-check).
   - **Native binding.** It changes nothing here.
   - **Viewer.** This is not a viewer issue.
   - **Language work.** The WPy prototype already has most of this
     vocabulary. It also has the export-as-output contract. The plan's step 8
     ("build123d: stable IDs, lazy selectors in the shim") is where this fix
     belongs. Stage 1 and the package guard overlap with the py-imports fix.

## 1. Population and first-blocker check

The cluster contains 34 units that raised `build123d.<Name> is not implemented`,
plus 6 units with a `NameError` for a build123d name. `summarize.mjs` moves those
6 into this cluster. That makes 40 unique files in 39 families. The two
`family-audit/*/family_snapshot.py` copies share family `py175` and are not
representatives.

**First blocker: yes, for all 40.** The corpus run records the first failure,
and the probe trace shows `completedOperations = 0` for every file. The blocker
fires at:

| where | files | example |
|---|---:|---|
| the `from build123d import` statement | 34 | `cad-project-025/beam_frame.py:30`, `cad-project-041/single-step-r10/jobs/r10b/cores.py:16`, `cad-project-003/kalibrier.py:13` |
| a return annotation evaluated at `def` | 4 | `cad-project-047/ei.py:53`, `cad-project-035/project-component-d98e059b.py:136`, `cad-project-033/case.py:132` (`-> Sketch`), `cad-project-026/bar.py:86` (`-> Part`) |
| the first use | 2 | `cad-project-032/project-component-32f60153.py:20` (`FontStyle.BOLD`), `cad-project-048/mount.py:47` (`import_step(...)`) |

In 18 files an import failure is waiting directly behind the build123d import,
typically on the next line: `cad_khana` 11, project modules 6, `bd_warehouse`
1. Those files belong to both this cluster and py-imports. Fixing either one
alone moves them into the other.

## 2. Repro

`fixtures/corpus-repro/py-api-surface/`, run with
`node bin/wonky-python.mjs <file> --check --python tmp/corpus/uv-python`:

| file | observed | stands for |
|---|---|---|
| `named-import.py` | `7:1: build123d.Compound is not implemented by the Python frontend` | the 34 import-line files; the reported name is the first unknown one in the list, and `Part`, `RectangleRounded`, `extrude` are never reached |
| `wildcard-annotation.py` | `11: NameError: name 'Sketch' is not defined` | the 6 wildcard files |
| `submodule-import.py` | `6: ModuleNotFoundError: No module named 'build123d.exporters'; 'build123d' is not a package` | side finding: the next blocker of `camera_mount_assembly.py` via `cad_khana/draw.py:8`; the runner's guard for build123d submodules never runs (also found by the py-imports analysis) |
| `next-box-chain.py` (added in the re-check) | builds: 114 faces, 10869.511374 mm³, about 34 s CPU | not this cluster: the planar Boolean cost and fragmentation that `project-component-abeb2fd3.py` reaches after stage 1 (§5) |

With stage 1 emulated, `named-import.py` fails at `9:1: build123d.Part is not
implemented` (the use site), `wildcard-annotation.py` builds (one box,
800 mm³), and `submodule-import.py` is unchanged (it needs the package guard).

## 3. Root cause

The file is `python/build123d.py`, loaded by `python/runner.py` in place of the
real library. Neither the kernel nor `src/python.mjs` is involved in the
failure itself.

- **The name table is closed.** Implemented: `Box`, `Cylinder`, `Pos`, `Align`,
  `Mode`, `Shape`, the operators `+ - &` and `.volume`. 25 more names in
  `_missing` (line 208) are error sentinels. Every other name goes to module
  `__getattr__` (line 218).
- **The table is eager.** `__getattr__` calls `_unsupported()` at once. The
  host latches that capability as sticky (`src/python.mjs`, `stickyCapability`),
  so a named import aborts the whole run at the import statement. That also
  holds when only an annotation, a type check or an unused import mentions
  the name.
- **Wildcard imports bind only `__all__`** (32 names, line 215). Real build123d
  0.13.0 exports 203 names in `__all__`, and all 11 names in this cluster are
  among them. Other names give a plain Python `NameError`. That contradicts
  the documented intent that wildcard-imported names fail as capabilities
  (docs/python-frontend.md).
- **The submodule guard is dead code.** The shim module has no `__path__`, so
  Python raises `ModuleNotFoundError` for `build123d.<sub>` before
  `NoExternalGeometry.find_spec` (`python/runner.py:48`) can refuse it with a
  capability error.
- **Behind the name table, the vocabulary really is missing.** The bridge
  (`shapeSession` in `src/python.mjs`) knows six requests: `box`, `cylinder`,
  `translate`, `boolean`, `volume` and `unsupported`. Even a complete name
  table therefore only moves each error to its use site.
- **The entry contract does not fit the corpus.** No file binds `result`. 36
  of the 40 call `export_stl` or `export_step` in a `__main__` block, which the
  runner executes. A complete API would still end at "must bind its final
  Shape to 'result'".

## 4. What the files use (static surface)

`scripts/corpus/py-api-surface/surface.mjs` reads the corpus facts
(`tmp/corpus/facts/py-facts.json`, stdlib `ast`), adds the local helper
modules each file imports, and sorts every construct into a tier:

| tier | meaning | files | most used (files) |
|---|---|---:|---|
| S | in the shim today | 40 | `Pos` 34, `.volume` 34, `Box` 31, `Cylinder` 31, `Align` 13 |
| A | frontend only: containers, rigid placement, metadata, exports, measures of built bodies; transforms use the existing `transformInBend` / `transformAnalytic` | 40 | `export_stl` 36, `.bounding_box` 33, `Plane` 33, `export_step` 33, `Rot` 30, `.solids` 27, `.is_valid` 22, `Compound` 22, `.center` 21, `Part` 20, `Axis` 15, `.rotate` 10, `Location` 9, `Color` 8, `Solid` 6 |
| B | existing Bend construction, new wiring: `extrudeInBend`, `extrudeSketchArcs` (line/arc profiles), `circularFrustumInBend` (cone), `revolveInBend` | 33 | `extrude` 31, `Cone` 23, `Polygon` 21, `Circle` 18, `make_face` 12, `Polyline` 11, `RectangleRounded` 8, `Rectangle` 7, `RegularPolygon` 7, `BuildPart`/`BuildSketch` 7, `mirror` 7 |
| Q | topology queries over built bodies (host side) | 28 | `.edges` 24, `.geom_type` 13, `.filter_by` 10, `GeomType` 10, `.group_by` 9, `.faces` 8, `.distance_to` 6 |
| C | missing in Bend | 32 | `fillet` 19, `chamfer` 16, `Text` 10, `offset` 9, `loft` 5, `Sphere` 5, `Spline` 2, `Torus` 2, `split` 3, `section` 2, `sweep` 1 |
| X | external geometry | 14 | `import_step` 9, `bd_warehouse` 5, OCP 2 direct (3 more through cad_khana), `import_brep` 1 |

Highest tier per file: C 23, X 14, B 1 (`beam_frame.py`), A 2
(`endstop/geometry.py`, and `pin_hinge/assembly.py`, which needs cad_khana).
Only `beam_frame.py` and `endstop/geometry.py` need no C or X construct and
no third-party package.

Two caveats:

- `.center()` defaults to the center of mass in build123d. Bend reports volume
  but no centroid, so stage 2 needs a Bend measure or an explicit refusal. It
  must not fall back to the bounding-box center.
- 2D sketch Booleans (`Circle(r) + Polygon(...)`, the `beam_frame.py`
  teardrop) are not in the static tiers. Bend has no 2D region Boolean. The
  WPy prototype counts 90 `sketch_union` nodes in `beam_frame.py` (both
  variants, `out/lang/surface/corpus.json`).

## 5. Next blockers

`scripts/corpus/py-api-surface/next.mjs` copies each file (with the project's
`.py` files and the entry directory, from the corpus run's mirror) to
`tmp/corpus/py-api-surface/<mode>/src/`. `lazy.py` then adds a preamble to
the first top-level statement, which keeps line numbers unchanged. The
preamble binds every build123d 0.13.0 `__all__` name and makes module
`__getattr__` return the shim's own `_UnsupportedAPI` sentinel. Any call or
attribute access of a sentinel still raises the shim's capability error
through the host. The copy then runs through `bin/wonky-python.mjs` and the
failure probe, exactly as in the corpus run.

| mode | API use site | import | OCP refused | no `result` | `opBoolean` |
|---|---:|---:|---:|---:|---:|
| `lazy` (stage 1) | 17 | 18 | 2 | 2 | 1 |
| `lazy+localpath` (also the model directory on `sys.path`) | 17 | 18 | 2 | 2 | 1 |
| `lazy+localpath+khana` (also cad_khana from the mirror) | 26 | 8 | 3 | 2 | 1 |

The first two rows are equal because the 6 files with a local module then
fail on that module's own third-party imports (`bd_warehouse`, `yaml`,
`httpx`).

**How far stage 1 gets.** With stage 1 emulated, 10 of the 40 files complete
Bend requests before the next blocker (`completedOperations` in
`next-lazy.jsonl`): `sanding_head.py` 13, `project-component-abeb2fd3.py` 8,
`sanding_head_v3.py` 7, `bar.py` 5, `lego_test_helpers.py` 4, `case.py` 4,
`kalibrier.py` 3, `sanding_pad_sprung.py` 3, `build.py` 2, `merged.py` 2. The
other 30 still complete none.

**Box-heavy files will hit the planar arrangement's cost and fragmentation
next.** `project-component-abeb2fd3.py` needs 37 to 54 s of wall time for its 8 requests. I
reduced them with the file's own values to
[`next-box-chain.py`](../../fixtures/corpus-repro/py-api-surface/next-box-chain.py):
tray box minus cavity box (coplanar top), plus the motor block box. It uses
only shim API, so it builds today. Measured through the production CLI at
load 49 to 117:

| prefix | production result | CPU (user) |
|---|---|---:|
| tray minus cavity (`tmp/corpus/py-api-surface/bristle-prefix-a.py`) | 46 faces, 6448.377988 mm³ (exact 6448.3776) | 4.9 s |
| … plus the motor block (`next-box-chain.py`) | 114 faces, 10869.511374 mm³ (exact 10869.5112) | 33.9 to 34.0 s |
| the same chain through the bake-off `recover` route (`bristle-box-chain`) | **exact, 11 faces**, ΔV 5.0e-16 against OCCT | 2 ms (native `cpu1`) |

The volumes are right within the F32 precision contract, but the solid has
11 faces. This is the known over-fragmentation of the planar arrangement
(cluster boolean-invalid-topology, §7: convex cells, no merge of coplanar
neighbours, at most 32 planes and 256 faces per operand). `tray()` has dozens
more Booleans after line 559. Once stages 2 and 3 land, it will run into
those limits, or into the time budget, before the tier C constructs. This is
a kernel issue, not part of this cluster, and the `recover` route solves this
case.

**The next Boolean blockers are inside the `recover` route's scope.**
`scripts/corpus/py-api-surface/recover-next.mjs` writes the Boolean chains
as bake-off CSG trees, using each file's own values. It then runs the bake-off
pipeline in its own directory: manifold3d tagged mesh Boolean as input,
recovery in Bend with the native `cpu1` build, OCCT exact CSG as the oracle.
Production results for comparison come from the FS port of the audit, run at
HEAD, and from `tmp/corpus/py-api-surface/probe-e10.py`.

| case | production today | recover |
|---|---|---|
| `beam_frame.py` rounded outline, then the opening, then one counterbored bore | the square frame builds; the first bore fails as a general trimmed-face Boolean (FS port at HEAD, `beam-fs/*.fs`) | exact at every step (10, 14, 19 faces) |
| `beam_frame.py` `frame(7, 5, optimize=False)` | not reachable | **exact**: 114 faces / 216 edges / 144 vertices, ΔV 4.7e-15 against OCCT (5765.959284 mm³), 99 ms |
| one bridged vertical cutter (stadium slabs, `Cylinder & Box`) | not reachable | exact, 39 faces |
| one teardrop side bore (`Circle + Polygon`, tangent flanks) | not reachable | recovered, but the STEP export refuses: `STEP cylindrical parameter curves unresolved: InvalidSource` |
| `frame(7, 5, optimize=True)`, the file's default | not reachable | **unresolved**: `mesh boundary does not traverse its exact curve once (sweep -0.0133, expected 2π)` |
| `endstop/geometry.py` E10 bracket (stadium slots, bosses, blind pilots) | `probe-e10.py:8:1: opBoolean supports ... general trimmed-face booleans are not implemented` | exact, 22 faces, ΔV 1.3e-16 |
| `endstop/geometry.py` E12 boss minus its coaxial blind pilot | coaxial path (supported) | exact, 5 faces |
| `sanding_head_v3.py:249-259` annulus minus the coaxial index chamber | `255: opBoolean through hole must land in material` | exact, 6 faces, ΔV 4.0e-16 |
| `project-component-abeb2fd3.py` `tray()` prefix (`next-box-chain.py`, added in the re-check) | builds, but 114 faces and 34 s CPU | exact, 11 faces, ΔV 5.0e-16 |

`beam_frame.py` with `optimize=False` is therefore the first real corpus part
that could build end to end. It needs stages 2 and 3 (`Part`, `Rot`,
`RectangleRounded` + `extrude`, `Circle` + `extrude`, `.moved`, export
capture) plus the `recover` route in production. The default print variant
needs a 2D sketch union and a fix in `recover` for the teardrop.

## 6. Fix design

All stages touch `python/build123d.py`, `python/runner.py` and `src/python.mjs`
(`shapeSession`), plus tests in `test/python*.test.mjs` and the table in
docs/python-frontend.md. No kernel change is needed up to stage 3.

**Stage 1, effort S (about half a day), risk low: a complete, lazy name table.**

- Freeze the build123d 0.13.0 public names (`__all__`, 203 names) with
  provenance (version, `scripts/lang/b3d-vocab.py`) in, for example,
  `python/build123d-api.json`.
- Set `__all__` to that list, so wildcard imports bind every real name.
- Module `__getattr__` returns a sentinel for a known name. For an unknown name
  it raises `AttributeError`, as real build123d does, so a typo stays an
  `ImportError` or a `NameError`.
- Make the sentinels classes with a metaclass. Calling one, attribute access,
  operators, `isinstance`/`issubclass`, iteration, `bool()` and subclassing all
  raise the capability through `_unsupported()`. That records the use-site line
  and the Python call stack, which `_request` already does. Use in an
  annotation or in `X | None` stays allowed, because it constructs nothing.
- Give the shim `__path__ = []`, so `build123d.<sub>` reaches
  `NoExternalGeometry` and fails as a capability. Do this once, together with
  the py-imports fix.
- Effect: errors point at the construct that is actually used; the corpus
  table measures real demand; the 6 `NameError` files become explicit
  capability errors. No file builds from this stage alone (§5).

**Stage 2, effort M (1 to 2 days), risk low to medium: containers, placement, outputs.**

- `Part`, `Solid`, `Compound`, `ShapeList` as `Shape` subclasses:
  - `Part()` is an explicitly empty shape;
  - `empty + x` is exactly `x`;
  - `Compound(children=...)` concatenates bodies without a Boolean;
  - `.solids()`, `.bounding_box()` (`validation.boundsMm`), `.is_valid`
    (the validation result).
- Booleans with multi-body operands stay refused. A compound must not be
  unioned silently.
- `Location`, `Rot`, `Plane` (`XY`/`XZ`/`YZ`, `origin`/`x_dir`/`z_dir`,
  `offset`), `Axis` and `Vector` as host values.
- A new bridge request `transform` with a rotation matrix, reusing
  `transformInBend` / `transformAnalytic`, which `opPattern` already calls.
  Covers `loc * shape`, `.moved`, `.translate`, `.rotate`, `rotation=` on
  primitives, and `Solid.make_box` / `make_cylinder` with a `Plane`.
  Multiples of 90° must produce exact matrices (the WPy prototype saw 1.2e-16
  noise otherwise).
- `Color`, `.label`, `.color` go to `body.name` / `body.appearance`.
- `export_step` / `export_stl` / `export_brep` become named outputs. The host
  writes them, and `result` becomes optional when outputs exist. This is a CLI
  contract change and needs Marc's decision. WPy §3.9 already specifies the
  same rule.
- `.center()` needs a Bend centroid, or it stays a named refusal.

**Stage 3, effort L (about a week), risk medium: sketches and extrusion on existing Bend ops.**

- Profile objects: `Rectangle`, `RectangleRounded`, `Circle`, `Polygon`,
  `RegularPolygon`, `Polyline` + `make_face`, `SlotCenterToCenter`,
  `RadiusArc`.
- `extrude(profile, amount, dir)` on any `Plane`:
  - polygons through `extrudeInBend`;
  - line/arc profiles through `solveSketchArcs` / `extrudeSketchArcs`, the
    FS path for `skArc`;
  - circles through `circularFrustumInBend`.
- `Cone` through `circularFrustumInBend` with two radii (apex case to be
  checked). `revolve` through `revolveInBend` (polygonal profiles, as
  `kernel/revolve.bend` allows).
- `BuildPart` / `BuildSketch` / `BuildLine` context stacks on the host
  (7 files).
- 2D sketch Booleans are either new Bend work (region Booleans on line/arc
  profiles) or become 3D Booleans per operand. The second option then
  depends on the Boolean dispatch.
- Risks: FS already hits profile validation limits (run.md cluster 6:
  collinear edges, 3 to 256 vertices), and they will show up here too.
  Mixed planar/curved Booleans stay refused until `recover` or another route
  reaches production.

**Outside this cluster (kernel and ecosystem):**

- Tier Q selectors: host side, about M. They mainly feed tier C.
- Tier C: fillet and chamfer (the status document plans constant-radius
  plane/cylinder fillets as the first class), text (fonts and spline
  outlines), offset, loft, sphere/torus, sweep, split, section.
- Tier X:
  - `import_step` needs a STEP reader in Bend, or a frozen B-rep snapshot with
    provenance, like the FS `modules.json`. OCCT may not read it for
    production geometry.
  - cad_khana needs a Bend-side port, or a split of model and checks.
  - `bd_warehouse` threads need helix sweeps.

## 7. Overlap with in-flight work

- **Boolean bake-off.** This cluster is not a Boolean, so `scripts/bakeoff`
  does not apply to the repro. It is the next blocker for 3 files. There,
  `recover` is exact on `beam_frame.py` (plain), on `endstop/geometry.py`
  E10/E12 and on the first `sanding_head_v3.py` cut (§5). It also removes
  the face fragmentation of the planar box chains that `project-component-abeb2fd3.py` runs
  (11 instead of 114 faces).
  Two findings go to the bake-off:
  - the teardrop STEP pcurve refusal (`InvalidSource`);
  - the `optimize=True` traversal refusal.
- **Native binding.** No overlap. The Python process launch and the shim are
  unchanged. `WONKY_BACKEND=native` covers 19 kernel entries and adds no
  build123d vocabulary. Stage 2's `transform` request and stage 3's profile
  extrusions map onto facade ops the binding plans anyway (docs/language.md
  §5, "one contract").
- **Viewer.** Not a viewer issue. The audit's daily-use finding (the beam
  frame fails at `Part`, the error sits at the import line) improves with
  stage 1, because errors then point at the use line.
- **Language work.** This is the largest overlap.
  - The WPy prototype (`src/lang/surface/eval.mjs`) evaluates build123d
    vocabulary without CPython and builds graphs for 6 of these 40 files.
    Its kernel gap ops for `beam_frame.py` are `rectangle_rounded` and
    `sketch_union` only, which agrees with §4.
  - WPy also defines exports as named outputs.
  - docs/language.md step 8 plans stable IDs and lazy selectors in the
    shim.
  - Recommendation: build stages 1 to 3 in the production shim, as step 8,
    with WPy's node names (`extrude_polygon`, `extrude_profile`, `frustum`,
    `transform`, `sketch_*`), so that the vocabulary is designed once.
- **py-imports cluster.** Both clusters need the package guard, and 18 files
  sit in both. The two fixes should land together. Neither builds a file on
  its own.

## 8. Per-file table

"Next" columns are measured (§5). "Still missing" lists the tier C and X
names from the static scan (§4), first six per tier.

| file | first blocker | next, API gap closed | next, + local path + cad_khana | still missing (C / X tier) | third-party |
|---|---|---|---|---|---|
| `cad-project-003/project-component-abeb2fd3.py` | 18: `Color` (import) | 559: `Circle` | 559: `Circle` | Text chamfer fillet loft trace | - |
| `cad-project-003/kalibrier.py` | 13: `Text` (import) | 40: `Shape.edges` | 40: `Shape.edges` | Text chamfer fillet loft trace | - |
| `cad-project-003/neustart/robot.py` | 13: `Compound` (import) | 17: import `cad_khana` | 17: `Location` | fillet | cad_khana |
| `cad-project-003/overnight-2026-09-05/design-review/lego_test_helpers.py` | 13: `Compound` (import) | 31: `Cone` | 31: `Cone` | Text | - |
| `cad-project-003/overnight-2026-09-05/manufacturing/coupons.py` | 12: `Part` (import) | 14: import `cad_khana` | 14: `Location` | Text offset | cad_khana |
| `cad-project-003/overnight-2026-09-05/manufacturing/family-audit/8e50fd80ede5/family_snapshot.py` | 15: `RectangleRounded` (import) | 18: import `cad_khana` | 18: `Location` | fillet offset | cad_khana |
| `cad-project-003/overnight-2026-09-05/manufacturing/family-audit/fd500e8d3059/family_snapshot.py` | 15: `RectangleRounded` (import) | 18: import `cad_khana` | 18: `Location` | fillet offset | cad_khana |
| `cad-project-003/overnight-2026-09-05/manufacturing/preload_z/coupon.py` | 13: `Text` (import) | 15: import `cad_khana` | 15: `Location` | Mesher Text fillet offset | cad_khana |
| `cad-project-003/overnight-2026-09-05/manufacturing/preload-audit/d1c92576002d/experiments/lateral_preload.py` | 9: `RectangleRounded` (import) | 9: import `cad_khana` | 9: `Location` | Mesher fillet offset | cad_khana |
| `cad-project-003/overnight-2026-09-05/manufacturing/snap_coupon.py` | 9: `Text` (import) | 10: import `cad_khana` | 10: `Location` | Text fillet offset | cad_khana |
| `cad-project-013/camera_mount_assembly.py` | 11: `Color` (import) | 12: import `cad_khana` | 12: import `build123d.exporters` | chamfer | cad_khana |
| `cad-project-013/camera_mount.py` | 17: `RectangleRounded` (import) | 492: import `cad_khana` | 492: import `OCP` (refused) | chamfer | cad_khana |
| `cad-project-013/sanding_head_v3.py` | 26: `Compound` (import) | 255: opBoolean: through hole must land in material; this axis misses the fac… | 255: opBoolean: through hole must land in material; this axis misses the fac… | Sphere | - |
| `cad-project-013/sanding_head.py` | 28: `Compound` (import) | 181: `Rot` | 181: `Rot` | Sphere Spline Torus sweep | - |
| `cad-project-013/sanding_pad_dock.py` | 29: `Compound` (import) | 45: import `wasteboard` | 45: import `bd_warehouse` | Side Side.BOTH chamfer fillet loft offset · bd_warehouse | bd_warehouse |
| `cad-project-013/sanding_pad_sprung.py` | 24: `Compound` (import) | 152: `RegularPolygon` | 152: `RegularPolygon` | loft | - |
| `cad-project-014/bottom-drive-purpose-2026-09-19/src/brep_audit.py` | 4: `import_brep` (import) | 5: import `offline` | 5: import `httpx` | import_brep import_step | numpy, pruefstand, trimesh |
| `cad-project-014/bottom-drive-review-2026-09-19/tool-improvement/worktree/labs/tile-clip-sockets/build.py` | 18: `Compound` (import) | 35: `Polygon` | 35: `Polygon` | section · import_step | - |
| `cad-project-014/bottom-drive-review-2026-09-19/tool-improvement/worktree/labs/tile-clip-sockets/merged.py` | 23: `Text` (import) | 98: `Polygon` | 98: `Polygon` | Text section · import_step | trimesh |
| `cad-project-014/bottom-drive-review-2026-09-19/tool-improvement/worktree/skills/cad-khana/references/examples/pin_hinge/assembly.py` | 21: `Part` (import) | 23: import `cad_khana` | 23: `Location` | (none) | cad_khana |
| `cad-project-020/lochwand/printed-parts/carrier.py` | 28: `FontStyle` (import) | 52: import `common` | 53: import `yaml` | FontStyle FontStyle.BOLD Keep Keep.BOTTOM Keep.TOP Sphere | yaml |
| `cad-project-020/lochwand/printed-parts/common.py` | 7: `GeomType` (import) | no `result` | no `result` | chamfer fillet | - |
| `cad-project-020/lochwand/printed-parts/pulley.py` | 23: `GeomType` (import) | 42: import `common` | 43: import `yaml` | chamfer fillet | yaml |
| `cad-project-025/beam_frame.py` | 30: `Part` (import) | 133: `RectangleRounded` | 133: `RectangleRounded` | (none) | - |
| `cad-project-026/bar.py` | 86: NameError `Part` (annotation) | 105: `Plane.XZ` | 105: `Plane.XZ` | chamfer fillet | - |
| `cad-project-032/project-component-32f60153.py` | 20: NameError `FontStyle` (use) | 20: `FontStyle.BOLD` | 20: `FontStyle.BOLD` | FontStyle FontStyle.BOLD Text chamfer | - |
| `cad-project-033/case.py` | 132: NameError `Sketch` (annotation) | 176: `Shape.edges` | 176: `Shape.edges` | Torus chamfer fillet | - |
| `cad-project-035/project-component-d98e059b.py` | 136: NameError `Sketch` (annotation) | 140: `Polygon` | 140: `Polygon` | Kind Kind.INTERSECTION Text chamfer fillet offset | - |
| `cad-project-041/archiv/gt2-linie/single-stage-gt2-mini-r3/retrofit-mgn9h/build_p10_mgn9h.py` | 3: `import_step` (import) | 10: `import_step` | 10: `import_step` | import_step | - |
| `cad-project-041/single-step-r10/jobs/endstop-print-fix/code/endstop_print_fix.py` | 9: `Compound` (import) | 21: import `OCP` (refused) | 21: import `OCP` (refused) | import_step | - |
| `cad-project-041/single-step-r10/jobs/endstop/geometry.py` | 7: `Solid` (import) | 10: `Solid.make_box` | 10: `Solid.make_box` | (none) | - |
| `cad-project-041/single-step-r10/jobs/gears/geometry.py` | 17: `Compound` (import) | 147: `Wire.make_polygon` | 147: `Wire.make_polygon` | import_step | - |
| `cad-project-041/single-step-r10/jobs/r10b/cores.py` | 16: `Compound` (import) | no `result` | no `result` | import_step | - |
| `cad-project-041/single-step-r10/src/endstop_check.py` | 18: `Compound` (import) | 19: import `OCP` (refused) | 19: import `OCP` (refused) | OCP import_step | OCP, PIL |
| `cad-project-046/ball_joint.py` | 23: `Part` (import) | 29: import `mount` | 29: import `bd_warehouse` | Sphere chamfer fillet loft · bd_warehouse | OCP, bd_warehouse, cad_khana |
| `cad-project-046/mount.py` | 16: `Part` (import) | 22: import `bd_warehouse` | 22: import `bd_warehouse` | chamfer fillet · OCP bd_warehouse | OCP, bd_warehouse |
| `cad-project-046/tripod_adapter.py` | 21: `Part` (import) | 27: import `mount` | 27: import `bd_warehouse` | chamfer fillet · bd_warehouse | OCP, bd_warehouse, cad_khana |
| `cad-project-046/tripod_assembly.py` | 18: `Part` (import) | 23: import `cad_khana` | 23: `Location` | Sphere chamfer fillet · bd_warehouse | OCP, bd_warehouse, cad_khana |
| `cad-project-047/ei.py` | 53: NameError `Sketch` (annotation) | 58: `Spline` | 58: `Spline` | Kind Kind.INTERSECTION Spline offset | - |
| `cad-project-048/mount.py` | 47: NameError `import_step` (use) | 47: `import_step` | 47: `import_step` | import_step | - |

## 9. Reproduce

```sh
# repros (production CLI)
node bin/wonky-python.mjs fixtures/corpus-repro/py-api-surface/named-import.py --check --python tmp/corpus/uv-python
# build123d 0.13.0 public names (introspection only, no geometry)
uv run --no-project --offline --quiet --with build123d python -c "import build123d as b, json; print(json.dumps(sorted(b.__all__)))" > tmp/corpus/py-api-surface/b3d-all.json
# next blockers with stage 1 emulated (max 3 processes)
node scripts/corpus/py-api-surface/next.mjs --mode lazy --concurrency 3
node scripts/corpus/py-api-surface/next.mjs --mode lazy+localpath --concurrency 3
node scripts/corpus/py-api-surface/next.mjs --mode lazy+localpath+khana --concurrency 2
# static surface and the table above
node scripts/corpus/py-api-surface/surface.mjs
node scripts/corpus/py-api-surface/table.mjs
# Boolean chains through the bake-off recover route (own directory under tmp/)
node scripts/corpus/py-api-surface/recover-next.mjs
# next-blocker repro: planar box chain from project-component-abeb2fd3.py tray() (builds, 114 faces, ~34 s CPU)
node bin/wonky-python.mjs fixtures/corpus-repro/py-api-surface/next-box-chain.py --check --python tmp/corpus/uv-python --timeout-ms 170000
```

## 10. Limitations

- **The emulation is not the fix.** The preamble patches the shim module
  object inside each run. It checks where files fail next, not how a real
  stage 1 behaves on `isinstance` or `bool()`.
- **The static tiers are a judgment.**
  - `.offset` does not distinguish `Plane.offset` (tier A) from shape offset
    (tier C).
  - `.intersect` / `.fuse` / `.cut` are tier A wrappers, but they inherit
    every Boolean limit.
  - Helper modules missing from the facts file (plain modules without build123d
    modeling) are not scanned.
- **The recover cases are my CSG transcriptions** of the files' geometry, with
  their values. They are not executions of the files. The teardrop orientation
  follows build123d's `Rot(90, 0, 0)` and the bake-off's rotation convention,
  and is not checked against a render.
- **Two files are libraries, not models:** `cad-project-020/.../common.py`
  and `cad-project-041/.../r10b/cores.py`. Their first blocker is real. After it
  they need a caller (the inventory's model role is too wide for them).

## 11. Re-check on the current tree (2026-09-23 04:12 to 04:22)

Same HEAD `79bbfeec`. `python/build123d.py` and `python/runner.py` are
unchanged since 2026-09-22 00:23. The only production change since the first
pass is the native-backend hook in `src/python.mjs`: `backendInfo(kernel)`
in the result, and `endsRun(error)`, which can only fire under
`WONKY_BACKEND=native|diff`. The default JS path is unchanged for this
cluster.

| check | load (1 min, start / end) | result |
|---|---|---|
| the 3 repros, production CLI | 11.9 / 11.9 | same messages and lines as §2 |
| `next.mjs --mode lazy --concurrency 3` | 19.9 / 43.0 | 40 of 40 identical to the first pass (status, line, message) |
| `next.mjs --mode lazy+localpath+khana --concurrency 3` | 43.0 / 120.0 | 40 of 40 identical to the first pass |
| `recover-next.mjs`, all cases plus `bristle-box-chain` | 73.5 / 65.4 | same verdicts as §5; the new case is exact (11 faces) |
| `next-box-chain.py`, production CLI | 49.0 / 90.2 | 114 faces, 10869.511374 mm³, 33.9 s user, 63 s wall |

`uptime` for the passes is in `out/corpus/py-api-surface/run-meta.jsonl`
(sessions `2026-09-23T02:13` and `02:15`) and in `recover-next.json`. The
first-pass outputs are kept in `tmp/corpus/py-api-surface/prev-0004/` for
comparison. The `lazy+localpath` pass was not repeated, because §5 shows it
equal to `lazy`.
