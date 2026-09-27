# cad_khana and external packages in the Python frontend

Decision 3 of the W5 Python work (product owner, 2026-09-23): wonky provides
a compatible module for cad_khana's **modeling** API. cad_khana's diagnostics
and every other external package fail as capability errors where they are
used. Decision 12 (2026-09-24) adds one opt-in exception: with
`--khana-checks=skip`, `check()` and `inspect()` are recorded as not run
instead of refused (see below). This page describes that module, the package
policy and how many corpus files each package blocks. The runner, `sys.path` and the result contract are
described in [python-frontend.md](python-frontend.md).

## cad_khana modeling API

`python/cad_khana/` is wonky's package, not the cad-khana distribution. The
runner serves it before anything on `sys.path`, so a model's
`from cad_khana.mechanism.assembly import Assembly` never loads the installed
cad-khana (which imports OCP). All geometry is built by the Bend build123d shim.

| cad_khana API | wonky |
| --- | --- |
| `Assembly()`, `.with_part(name, part, location=, color=, material=)` | provided; immutable builder as in cad_khana |
| `.with_subassembly(name, assembly, location=, joint=)` | provided; locations compose through the parents |
| `.with_joint(path, joint)`, `.with_joint_angle(path, deg)`, dotted paths | provided |
| `RevoluteJoint(axis, angle_deg)`, `.with_angle()`, `.transform` | provided: T(p) · R(d, angle) · T(-p) about the axis line, with build123d `Axis` and `Location`; angle 0 is the exact identity |
| `.with_materials()`, `.with_detailed_geometry()`, `DetailOverride` | provided |
| `.assert_no_interference()`, `.assert_clearance()`, `.assert_interference()` | recorded as in cad_khana, never evaluated |
| `.parts`, `.subassemblies`, `.assertions`, `.placed_parts`, `PlacedPart`, `SubAssembly` | provided |
| `.compound` | builds `build123d.Compound(children=...)`, a group of the parts' shapes: `volume`, `solids()`, queries and Booleans work; as a result or export it is the host's `compound` op, the parts' solids unfused and unchanged |
| `FDM(up_axis, wall_min_mm, overhang_max_deg)` | provided (plain settings) |
| `SCHEMA_VERSION`, numeric thresholds, `_paths.resolve_out`, `viewer/draw.set_auto()` | provided (plain values) |

**Result.** A module-level `assembly` (or `result`) that is an `Assembly`
becomes one output per placed part, in cad_khana's `placed_parts` order: own
parts first, then sub-assembly leaves. Each part's bodies carry the part name
(`body.name`, the leaf name as in cad_khana) and its color as
`body.appearance = {red, green, blue, alpha}` in 0..1, which the viewer's parts
tree shows. `show(assembly)` from the provided `ocp_vscode` records the same
parts under `<name>/<part>`. The protocol is `Assembly._wonky_parts()`
(`(name, placed shape, (r, g, b, a) | None)` per part) and
`Assembly._wonky_metadata()` (sub-assembly path, material and the declared
assertions with status `declared-not-evaluated`), both read by
`python/_wonky_runtime.py`.

**Placement.** Parts and sub-assemblies are placed when they are added: a
placement wonky cannot build fails on the model's own line, not later. A
missing `location` is build123d's `Location()`, as in cad_khana, and
placements compose with build123d `Location` composition (`Pos`, `Rot`,
`Location`, `Plane` placements all work, see the location section of
[python-frontend.md](python-frontend.md)); an identity placement builds
nothing. A shape
placed more than once at the same spot gets an exact Bend copy (zero
translation), so every part owns its own bodies.

**Colors.** Any build123d-style color is accepted: an object that iterates as
`(r, g, b, a)` in 0..1 (build123d 0.13 `Color`), one with `to_tuple()`, or an
`(r, g, b[, a])` tuple. Other values are a `TypeError` naming the part.

### build123d `Color`

All 12 corpus files that call `Color(...)` are cad_khana files, with 48 calls:
sRGB float triples (24), hex strings through a name→hex dict (15, e.g.
`'#905aaf'`), hex string literals (7) and loop variables (2). The cad-khana
skill's other models also write `Color(0x4A6E8A)` and `Color("olivedrab")`.
`python/_wonky_color.py` is build123d 0.13.0's `Color` without OpenCascade: its
constructor is ported verbatim (names, `#rgb[a]`/`#rrggbb[aa]`, `0xRRGGBB`
with alpha `0x00..0xFF`, `(r, g, b[, a])`, tuples, `color_like=`, keyword
channels, and build123d's quirks such as `Color(0x000000)` being white), and
the OCCT `Quantity_ColorRGBA` storage is emulated exactly: sRGB → linear in
double precision, rounded to float32, back to sRGB when read, rounded to
7 digits. CSS3 names (webcolors 24.8.0) and the 521 OCCT/X11 names with OCCT's
own linear values are frozen with provenance in `python/build123d_colors.json`.

`scripts/python/build123d-colors.py` generates that table and the oracle
`fixtures/python-color/build123d-color-oracle.json` from the real package
(`uv run --with build123d==0.13.0`, value probes only): 2030 expressions (35
corpus literals, 61 edge cases, all 668 names, a 256-level gray sweep, 200
random integer codes, 800 random sRGBA quadruples and `categorical_set`). The
shim reproduces `tuple()`, `repr()`, exact-name `str()` and every error message
of all of them (`test/python-khana-color.test.mjs`). Explicit differences:

| build123d 0.13.0 | wonky |
| --- | --- |
| channel outside 0..1: OCP `Standard_Failure("Color out")` | `ValueError("Color out")` |
| `color.wrapped` (OCP `Quantity_ColorRGBA`) | capability error at the use site |
| `str()` without an exact CSS3 name: nearest OCCT name (float32 search) | capability error at the use site; `repr()` and `tuple()` work |
| `Color("Quantity_NOC_")` aborts the process inside OCCT | `ValueError` (not a named color) |

The shim binds this class as `build123d.Color` and `build123d.geometry.Color`
(`python/build123d.py` loads `_wonky_color.py` by path; without the file the
name would fall back to a use-site sentinel). A `Color` passed to
`with_part(..., color=...)` or to `show(..., colors=[...])` becomes the body's
`appearance` with its alpha (repro `fixtures/corpus-repro/py-khana/corpus-color/`).

**Parts** must be shapes built by the Bend shim; anything else is a capability
error naming the part.

## Refused cad_khana diagnostics

Each name imports, and fails as an `UnsupportedFeatureError` at its call (or
construction), naming the call. The host latches it, so `try: … except` does
not turn it into a silent success.

| module | refused names | why |
| --- | --- | --- |
| `mechanism.check` | `check` (recordable as not run, see below), `CheckResult` | assertion evaluation, exports, mechanism.json |
| `mechanism.assertions` | `evaluate`, `<Assertion>.evaluate()` | interference volumes, clearance distances |
| `mechanism.diagnostics` | `compute`, `Diagnostics`, `BBox`, `PartDiagnostics`, `Interference`, `AssertionResult` | per-part and pairwise diagnostics |
| `mechanism.pick`, `mechanism.hints` | `describe_face/edge/vertex`, `face_relations`, `match_hint` | OCCT topology indices, CLI hints |
| `printability.inspect` and `holes`, `overhangs`, `pins`, `structure`, `wall`, `orientation` | `inspect` (recordable as not run, see below), `detect_*`, `min_wall*`, `enclosed_voids`, `sharp_*_edges`, `suggest_orientation`, … and their result types | ray casting and tessellation of OCCT shapes |
| `core.tessellation` | `_tessellate`, `Triangle` | OCCT tessellation |
| `viewer`, `draw`, `export` | `push`, `draw`, `View`, `export_assembly`, `export_glb`, `export_animated_glb` | OCP viewer, HLR drawings, OCP exports |
| `environment`, `diff`, `cli` | `probe`, `diff`, `app`, `main` | the khana tooling |

A name or submodule that cad_khana has but this package does not list (for
example `cad_khana.core.build` from cad-khana's README) is a capability error
too. wonky has no equivalent of these diagnostics yet; the build itself (STEP,
`brep.json`, the viewer) replaces `export_assembly` and `push`.

Because a model runs like `python model.py`, its `if __name__ == "__main__":`
block runs. cad_khana assembly files call `check(assembly, out="outputs")`
there, so by default they stop at that line even though the assembly itself
builds (repro `py-khana/check-in-main/`). Marc's `watch.py` loads the same
files with `runpy.run_path`, where that block does not run.

### `check()` and `inspect()` in a build: `--khana-checks`

Decision 12 (product owner, 2026-09-24):

- **Default (`--khana-checks refuse`):** `check()` and `inspect()` stay
  capability errors at their call. The message now names the opt-in flag.
- **Opt-in (`--khana-checks=skip`, `buildPython({ khanaChecks: 'skip' })`):**
  each call is recorded and the build goes on. The record is
  `model.source.khanaChecks = { mode: 'skip', notRun: [...] }` in `brep.json`,
  one entry per call in call order: `call` (the qualified name), `status:
  "not-run"`, `message` (`cad_khana check() not run: no wonky equivalent
  yet`), `location` (`{file, line, column}` of the calling model line) and
  `arguments` (short descriptions such as `<Assembly: assembly>`,
  `method=FDM(up_axis=(0, 0, 1), wall_min_mm=0.8, overhang_max_deg=45.0)`,
  `out='outputs'`; no Shape or foreign `__repr__` is run). The mode is
  recorded even when no call is reached (`notRun: []`), and on a failed build
  it is on `error.khanaChecks`. The CLI prints every entry and a closing line:

  ```text
  cad_khana check() not run: no wonky equivalent yet (assembly.py:18: check(<Assembly: assembly>, out='outputs'))
  --khana-checks=skip: 1 cad_khana check/inspect call(s) NOT RUN; this build is not checked
  ```

- **A skipped check never passes.** The call returns a `NotRun` object
  (`python/cad_khana/_wonky.py`). Its `repr()`/`str()` say it was not run.
  Every other use is a latched capability error at that line: attributes
  (`diag.status`, `result.ok`), truth value, `==`/`!=`, `len()`, iteration,
  items. `try/except` cannot turn it into a pass. The declared assertions
  keep their status `declared-not-evaluated`.
- **The host decides and records.** Every `check()`/`inspect()` call is a
  bridge request (`khana_check`) that `src/python.mjs` answers: it holds the
  mode and appends the not-run entry itself, and hands Python only a copy.
  So a model can neither switch the checks off (setting runtime variables in
  `_wonky_runtime` does nothing without the flag) nor clear the record or
  rewrite an entry's `status`; `brep.json` always shows the host's own
  `not-run` entries. A malformed request is refused.
- Only `check()` and `inspect()` are covered. The other diagnostics
  (`detect_*`, `min_wall`, `compute`, …) stay refused. Real wonky checks for
  interference and clearance come later.

`coupons.py` (cad-project-003, corpus mirror) shows both modes. It first writes
`out/A-rail-1.60.stl` and `.step` (decision 13). Then, by default, it stops at
`coupons.py:149:14`, the `inspect()` call. With `--khana-checks=skip` the call
is recorded, and the run stops at `coupons.py:150:16`, because the model reads
`diag.status`.

## Other packages

Only the standard library, the model's project modules and the packages wonky
provides from `python/` (`build123d`, `cad_khana`, `ocp_vscode`) are
importable. Any other import from model or project code fails at the import
line with a capability error that names the package and this policy
(`python/runner.py`, `UnavailablePackages`). OCP, OCC and cadquery are
refused first by the external-geometry guard. `python/_wonky_packages.py`
holds the package-specific reasons for bd_warehouse, ocp_tessellate, trimesh
and pytest; the runner appends them to its message ("…, and wonky does not
provide bd_warehouse: its threads, fasteners, …"). build123d's readers
(`import_step`, `import_brep`, ...) are build123d names and fail at their call.

Installed packages stay closed also when a model puts their directory on
`sys.path` itself: a site-packages, dist-packages or `.egg` location, or a
directory whose installation record (`<dist>.dist-info/RECORD`,
`<egg>.egg-info/installed-files.txt`) lists the file, such as `pip install
--target .deps` or uv's package cache. Marc's
`cad-project-039/belt-fixed-r29/wall-r29/design_wall.py` (newer than the
91-file corpus snapshot) appends `.deps` and imports `ezdxf` and `numpy` from
it; it stops at `design_wall.py:15:1` with the installation record
`.deps/ezdxf-1.4.4.dist-info/RECORD` named in the message. Loading an installed file by path
(`spec_from_file_location`, `runpy.run_path`) is refused the same way.

### What each package blocks in the corpus

`node scripts/python/khana-package-census.mjs` (2026-09-23, static scan, read
only) over the 91 unique Python files of `out/corpus/runs.jsonl`. Imports are
resolved like the runner: standard library, provided modules, then project
modules on the model directory and the nearest `pyproject.toml` root,
recursively. *Direct*: the file itself imports it. *With project modules*: the
file or a project module it imports does. *First*: it is the first unavailable
import in source order, the error a run reports if nothing earlier fails. The
scan counts imports inside functions, `try` blocks and main blocks alike.

| package | direct | with project modules | first |
| --- | ---: | ---: | ---: |
| numpy | 18 | 19 | 18 |
| pytest | 13 | 13 | 6 |
| trimesh | 9 | 10 | 2 |
| bd_warehouse | 3 | 7 | 7 |
| OCP | 4 | 7 | 1 |
| yaml | 2 | 4 | 4 |
| matplotlib | 2 | 2 | 0 |
| scipy | 2 | 2 | 0 |
| shapely | 2 | 2 | 0 |
| httpx | 0 | 1 | 1 |
| ocp_tessellate | 1 | 1 | 1 |
| PIL | 1 | 1 | 0 |

Project modules that exist but are not on the model's `sys.path` under the
policy. They are refused as unavailable unless the model extends `sys.path`
itself (then they load and are recorded with SHA-256 in the provenance), which
the static scan does not follow: `preload_z/coupon.py` and
`lateral_preload.py` do, and get past `coupons` and `family` at run time.

| module | direct | with project modules | first | why |
| --- | ---: | ---: | ---: | --- |
| pruefstand | 10 | 11 | 0 | `src/` layout package; the project root is on the path, `src/` is not |
| hardware_refs | 3 | 3 | 3 | the snapshot copies lack the file (fail in plain CPython too) |
| coupons, family | 1 each | 1 each | 1 each | in a parent directory that is neither the model directory nor the project root |
| module_geometry | 1 | 1 | 0 | stale snapshot copy; the module lives in `single-step-r10/src/` |
| m3_hybrid_hole | 1 | 1 | 0 | lives in another corpus project (`cad-project-043`) |

External-geometry readers, by call sites in the file or its project modules:
`import_step` 21 files, `import_brep` 2, `import_stl`/`import_svg`/`import_dxf` 0.

In total 45 of 91 files import at least one unavailable package or module,
21 read external geometry, and 54 do at least one of the two.

**cad_khana** is imported by 27 files, 8 of them cad-khana's own pytest modules.
All 27 call at least one refused diagnostic (`inspect` 20, `check` 16,
`detect_overhang` and `detect_bores` 2 each, `draw`, `export_assembly`,
`detect_pins`, `enclosed_voids`, `sharp_vertical_edges`, `describe_face`,
`describe_edge`, `face_relations`, `compute` 1 each); 15 need no other
unavailable package.

### Where the cad_khana files stop now

**Policy run (2026-09-24, `scripts/corpus/run.mjs --label policy --only .py`,
91 files, default `--khana-checks refuse`).** Compared with `w5b-verify2`, 70
files stop at the same place with the same message. The 21 that changed moved
because of the concurrent kernel work (Boolean admission; timeouts now end at
a build123d name), not because of decisions 12 and 13. Two files reach a
cad_khana diagnostic:

- `coupons.py` still stops at `coupons.py:149` (`inspect()`), whose message
  now names the flag. It writes `out/A-rail-1.60.stl` and `.step` into the
  mirror first.
- `pin_hinge/assembly.py` gets past its clevis pierce (w5b: line 105) and now
  stops at `check()` in its main block (line 132). With `--khana-checks=skip`
  it builds all three parts (clevis, tang, pin) and records one `check()` and
  two `inspect()` calls as not run.

No file reaches an export with a path outside its project, so no export was
refused.

**Earlier state after W5b** (corpus run `--label w5b`, 2026-09-23 20:19 to
20:27, see [corpus/w5b.md](corpus/w5b.md)). The run has 26 of the 27 files (the 91
unique Python files). None stops at a build123d name any more, and only
`coupons.py` stops inside cad_khana, at the `inspect()` diagnostic in its
build flow. First blockers:

| first blocker | files |
| --- | ---: |
| Bend Boolean refusal: arc-edged shells in the cad-project-003 family (`family.py:155`, 3 × `family_snapshot.py`), the pierce through both clevis arms (`pin_hinge/assembly.py:105`), the planar union at `snap_coupon.py:49` (a regression of the uncommitted W2 kernel, see corpus/w5b.md) | 6 |
| pytest module without a model result | 5 |
| `hardware_refs` (missing in snapshots) | 3 |
| `bd_warehouse` (through `cad-project-046/mount.py:22`) | 3 |
| `pytest` import | 3 |
| timeout 180 s in Bend Booleans (`neustart/robot.py`, `camera_mount.py`, `camera_mount_assembly.py`) | 3 |
| `offset` (Bend has no offset: `lateral_preload.py:70`, `preload_z/coupon.py:77`) | 2 |
| cad_khana `inspect()` in the build flow (`coupons.py:149`) | 1 |

Compared with the earlier runs below, the 11 files that stopped at a build123d
name now stop at a kernel gap or a timeout, and `snap_coupon.py` no longer
stops at the compound-operand refusal. Placements with a nonzero joint angle
(`RevoluteJoint`) and `Location`/`Rot` placements now build, and `pin_hinge`
gets through its `Rot(90, 0, 0)` pivot cylinder to the clevis pierce. Shape attribute assignment
(`shape.label = …`, `shape.color = …`) is still a capability error, but no file
reaches it yet.

Earlier state: all 27 files run through `bin/wonky-python.mjs --check` on 2026-09-23
(first 06:35 to 06:45; rerun 10:35 to 10:45 with the runner's package reasons,
load average about 45 on 18 cores, at most 3 processes, the same first blockers
except `robot.py`). None stops inside cad_khana any more. First blockers:

| first blocker | files |
| --- | ---: |
| build123d API at its use site (`RectangleRounded` 4, `Rot` 2, `Plane.XY` 2, `Polyline` 2, `Polygon` 1) | 11 |
| pytest module without a model result (no `result`/`assembly`/`show`) | 5 |
| `hardware_refs` (missing in snapshots) | 3 |
| `bd_warehouse` (through `cad-project-046/mount.py:22`) | 3 |
| `pytest` import | 3 |
| kernel: compound Boolean operand (`snap_coupon.py:50`), planar arrangement union (`neustart/robot.py:83`, after 259 s at 06:40; still running after 400 s at 10:35, killed) | 2 |

The 12 files that call `Color(...)` were rerun at 10:40 on a copy of `python/`
with the `Color` binding the shim now has: 11 stop at the same line and
`robot.py` times out again, so `Color` is nowhere the first blocker yet. Past
those blockers, 9 of the 27 files assign `shape.label = name` and
`shape.color = Color(...)` before `with_part`; that is Shape attribute
assignment in the shim (a follow-up for the names package).

## Validation

```sh
node --test test/python-khana.test.mjs test/python-khana-color.test.mjs test/python-khana-checks.test.mjs
node bin/wonky-python.mjs fixtures/corpus-repro/py-khana/assembly/assembly.py --out out/py-khana-assembly
node bin/wonky-python.mjs fixtures/corpus-repro/py-khana/check-in-main/assembly.py --khana-checks=skip --check
node scripts/python/khana-package-census.mjs --json out/corpus/py-packages.json
uv run --no-project --quiet --with build123d==0.13.0 python scripts/python/build123d-colors.py \
  python/build123d_colors.json fixtures/python-color/build123d-color-oracle.json
```

The repros in `fixtures/corpus-repro/py-khana/` document each behavior with
the command and the observed output.
