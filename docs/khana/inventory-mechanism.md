# cad_khana inventory: the mechanism side

Workflow `khana-design`, task `inv-mechanism` (2026-09-24). Scope: everything in
cad_khana that composes assemblies and checks them relationally:
`src/cad_khana/mechanism/**` (assembly, assertions, check, diagnostics, pick,
hints), `core/tessellation.py`, `_paths.py`, the mechanism-relevant CLI and
diff code, the mechanism tests, the README and the mechanism parts of the
skill. Printability (`inspect`, FDM, bores, ...) and tooling (viewer, draw,
export, environment) have their own inventories; they appear here only where
the mechanism code calls them.

Evidence legend used in every section:

- **[C]** read in code (file:line given);
- **[M]** measured by running the installed `khana` 0.0.2 on copies in
  `tmp/khana/oracle/` (the parity oracle; it never feeds the kernel);
- **[I]** inference from code or geometry, not run.

Path abbreviations:

| prefix | path |
| --- | --- |
| `U/` | `~/Workspace/cad/cad-khana/src/cad_khana/` (upstream source, read only) |
| `UT/` | `~/Workspace/cad/cad-khana/tests/` |
| `B/` | `~/.local/share/uv/tools/cad-khana/lib/python3.13/site-packages/build123d/` (build123d 0.10.0 in the installed tool) |
| `W/` | `<repo>/python/cad_khana/` (wonky's compat package) |
| `O/` | `<repo>/tmp/khana/oracle/` (oracle scripts and outputs) |

## 0. Provenance and versions

- Upstream git HEAD is `22f0ad0` (2026-06-11, "skill: document warnings +
  contact ratio") [M: `git log -1`]. The working tree is **not clean**:
  `src/cad_khana/mechanism/pick.py` and `tests/mechanism/test_pick.py` are
  untracked, `cli.py` is modified (+55 lines, only the `khana pick` command)
  and `skills/cad-khana/SKILL.md` is modified (+39 lines: the "Review loop"
  section and a fit-test label bullet) [M: `git status`, `git diff --stat`].
  pick is therefore local, uncommitted work in Marc's checkout (file mtime
  2026-06-12), not a released cad_khana feature.
- The installed tool (`uv tool`, receipt `directory = .../cad/cad-khana`) is
  version 0.0.2 and is an older snapshot: its `cad_khana/mechanism/` has no
  `pick.py` and its CLI has no `pick` command [M: `ls` of the tool's
  site-packages]. The installed skill `~/.claude/skills/cad-khana/SKILL.md`
  likewise lacks the "Review loop" section (upstream `SKILL.md:119-137`) [M:
  diff].
- Tool venv: build123d 0.10.0, cadquery_ocp 7.8.1.1.post1 (OCCT 7.8),
  ocp_tessellate 3.3.0 [M: dist-info names]. `pyproject.toml` pins only
  `build123d>=0.8`, Python `>=3.13,<3.14` [C: `pyproject.toml`]. wonky's
  build123d shim follows build123d 0.13; the numeric behavior below is 0.10.0.
- There is no `__init__.py` anywhere in upstream `src/cad_khana` (PEP 420
  namespace packages) [C: file listing].

## 1. Module map

| file | lines | public names | role |
| --- | --- | --- | --- |
| `U/mechanism/assembly.py` | 341 | `PlacedPart`, `RevoluteJoint`, `SubAssembly`, `DetailOverride`, `Assembly` | immutable assembly builder, joints, overrides, flattening |
| `U/mechanism/assertions.py` | 100 | `NoInterference`, `Clearance`, `ExpectedInterference`, `Assertion`, `evaluate` (+ `_intersection_volume`, `_placed`) | declared relational checks and their evaluation |
| `U/mechanism/check.py` | 64 | `check`, `CheckResult` (+ `_export_default`, `_set_export_default`) | coordination: export, evaluate, compute, write `mechanism.json`, exit |
| `U/mechanism/diagnostics.py` | 123 | `SCHEMA_VERSION`, `INTERFERENCE_VOLUME_EPSILON_MM3`, `BBox`, `PartDiagnostics`, `Interference`, `AssertionResult`, `Diagnostics`, `compute` (+ `_placed`, `_bbox`, `_part_diagnostics`, `_interference`) | per-part facts and all-pairs interference |
| `U/mechanism/hints.py` | 44 | `match_hint` (+ `_PATTERNS`) | regex repair hints for crashed scripts |
| `U/mechanism/pick.py` (uncommitted) | 104 | `describe_face`, `describe_edge`, `describe_vertex`, `face_relations` (+ `_EPS_DOT`, `_EPS_MM`, `_vec`, `_face`, `_edge`, `_vertex`) | viewer-index to geometry facts |
| `U/core/tessellation.py` | 32 | `TESSELLATION_TOLERANCE_MM`, `TESSELLATION_ANGULAR_TOLERANCE`, `Triangle` (+ `_triangle`, `_tessellate`) | triangle soup for printability (no mechanism caller) |
| `U/_paths.py` | 25 | `resolve_out` | `out=` anchoring |
| `U/cli.py` (mechanism parts) | 285 | `build`, `check`, `pick` commands, `_write_error_diagnostics`, `_run_script` | runs scripts, writes error `mechanism.json` |
| `U/diff.py` (mechanism parts) | 265 | `diff` (mechanism branch) | text diff of two `mechanism.json` |

## 2. Assembly model (`U/mechanism/assembly.py`)

All classes are `@dataclass(frozen=True)`; every builder method returns a new
object via `dataclasses.replace` [C: `assembly.py:15,24,64,87,102`].

| name | signature | semantics [C] |
| --- | --- | --- |
| `PlacedPart` | `(name: str, part: Part, location: Location, color: Color \| None = None, material: str \| None = None)` | a leaf: the unplaced part plus its placement (`assembly.py:15-21`). No validation of any field. |
| `RevoluteJoint` | `(axis: Axis, angle_deg: float = 0.0)` | single-DOF joint on a sub-assembly, axis in the parent's frame (`:24-36`). |
| `RevoluteJoint.with_angle` | `(angle_deg) -> RevoluteJoint` | copy with a new angle (`:38-39`). |
| `RevoluteJoint.transform` | property `-> Location` | `T(p) · R(d, angle) · T(-p)` built as `pivot * rotation * pivot.inverse()` with `rotation = Location((0,0,0), (dx,dy,dz), angle_deg)` (`:41-61`). At angle 0 it still builds the product (a float identity, not an exact one). |
| `SubAssembly` | `(name: str, assembly: Assembly, location: Location = Location(), joint: RevoluteJoint \| None = None)` | nested assembly placed in the parent frame (`:64-78`). |
| `SubAssembly.effective_location` | property | `location` without joint, `joint.transform * location` with one (`:80-84`): the joint rotates the already placed sub-assembly about an axis in the parent frame. |
| `DetailOverride` | `(part: Part, location: Location \| None = None, material: str \| None = None, color: Color \| None = None)` | one entry of `with_detailed_geometry` (`:87-99`). |
| `Assembly` | `(parts: tuple[PlacedPart,...] = (), subassemblies: tuple[SubAssembly,...] = (), assertions: tuple[Assertion,...] = ())` | the tree (`:102-106`). |
| `.with_part` | `(name, part, location=None, color=None, material=None)` | appends `PlacedPart(name, part, location or Location(), color, material)` (`:108-117`). Duplicate names are accepted silently. |
| `.with_subassembly` | `(name, assembly, location=None, joint=None)` | appends a `SubAssembly` (`:119-132`). |
| `.with_joint` | `(path: str, joint)` | dotted path (`"rotor.platform_dump"`), each segment resolved in its own frame; sets the leaf's joint; `KeyError(f"no sub-assembly named {head!r}")` if a segment is missing (`:134-158`). Every sub-assembly with the matching head name is updated (no uniqueness). |
| `.with_joint_angle` | `(path: str, angle_deg)` | as above, updates the angle; `ValueError("sub-assembly ... has no joint to update")` if the leaf has none, `KeyError` for a missing segment (`:160-189`). |
| `.with_materials` | `(mapping: dict[str,str])` | replaces `material` of every part whose name is a key, recursively (`:191-207`). |
| `.with_detailed_geometry` | `(mapping: dict[str, DetailOverride \| Part])` | bare `Part` means `DetailOverride(part=p)`; swaps recurse into the whole tree and keep placement/material/color unless the override gives them (`or` fallback, so an override can never clear a value to `None`); names not found anywhere are **additions** at the top level and need an explicit `location`, else `ValueError("with_detailed_geometry: addition ... requires an explicit location")` (`:209-264`). |
| `._swap_detail`, `._all_part_names` | private | helpers (`:247-270`). |
| `.assert_no_interference` | `(a, b, name=None)` | records `NoInterference(a, b, name or f"no_interference:{a}/{b}")` (`:272-278`). |
| `.assert_clearance` | `(a, b, min_mm, name=None)` | records `Clearance(a, b, min_mm, name or f"clearance:{a}/{b}>={min_mm}")` (`:280-293`). |
| `.assert_interference` | `(a, b, reason=None, name=None)` | records `ExpectedInterference(a, b, name or f"interference:{a}/{b}", reason)` (`:295-315`). |
| `.placed_parts` | property `-> tuple[PlacedPart,...]` | own parts first, then each sub-assembly's `placed_parts` with `location = eff * inner.location` (`:317-334`). This flat list is what every check uses. |
| `.compound` | property `-> Compound` | `Compound(children=[p.part.moved(p.location) ...] + [sub.assembly.compound.moved(sub.effective_location) ...])`, a nested compound tree (`:336-341`). Used by export. |

Module-level names that are importable from `assembly.py` only because they
are imported there: `Axis`, `Color`, `Compound`, `Location`, `Part`
(`assembly.py:5`) and `Assertion`, `Clearance`, `ExpectedInterference`,
`NoInterference` (`:7-12`).

Error behavior of the builder [C, M]:

- Assertions reference part **names** that are not checked at declaration.
  An unknown name is a `KeyError` at evaluation time inside `check()`
  (`assertions.py:42,56,81`) [M: `O/keyerror/`: `KeyError: 'ghost'`, status
  `error`, `hint: null`].
- Duplicate part names: `{p.name: ...}` dicts keep the last one
  (`assertions.py:99`, `diagnostics.py:116-117`), while all-pairs interference
  iterates the list, so a duplicate interferes with itself and is reported as
  `("a", "a")` [M: `O/probe/probe.json` `duplicate_names`:
  `parts_keys ["a"]`, `interferences [["a","a",500.0]]`].
- `part` can be any build123d shape. A `Face` "part" has volume 0, is
  `is_valid` true and never interferes [M: `probe.json` `face_as_part`].

## 3. Assertions (`U/mechanism/assertions.py`)

| name | semantics [C] | threshold |
| --- | --- | --- |
| `_intersection_volume(a, b)` | `a & b`; `None` -> 0.0; object with `.volume` -> that; else sum of member volumes (`:17-32`) | none |
| `NoInterference(a, b, name).evaluate(parts)` | passes iff `volume <= INTERFERENCE_VOLUME_EPSILON_MM3`; detail `"interference volume {v:.4f}mm^3"` (`:35-45`) | 0.001 mm³ (`diagnostics.py:13`) |
| `Clearance(a, b, min_mm, name).evaluate(parts)` | `dist = parts[a].distance_to(parts[b])`; passes iff `dist >= min_mm`; detail `"clearance {d:.4f}mm below min {min}mm"` (`:48-63`) | **no epsilon** |
| `ExpectedInterference(a, b, name, reason=None).evaluate(parts)` | passes iff `volume > 0.001`; detail `"expected interference absent (volume {v:.4f}mm^3)"` plus `"; reason: ..."` (`:66-88`) | 0.001 mm³ |
| `Assertion` | type alias `NoInterference \| Clearance \| ExpectedInterference` (`:91`) | |
| `_placed(p)` | `p.part.moved(p.location)` (`:94-95`) | |
| `evaluate(assembly)` | `parts = {p.name: _placed(p) for p in assembly.placed_parts}`; evaluates every assertion in declaration order (`:98-100`) | |

Notes [C/M]:

- For build123d `Part` inputs, `Part & Part` always returns a `Compound`,
  never `None`: `Compound.__and__` wraps any result (`B/topology/composite.py:506-513`;
  `Part` subclasses `Compound`, `composite.py:841`). The `None` branch in
  `_intersection_volume` and the `hint` about `a & b` returning `None`
  (`hints.py:12-15`) only apply to raw `Solid`s [M: `probe.json`
  `cube_states.*.and_type == "Compound"`, `solid_states.separated.and_type == "NoneType"`].
- `Compound.volume` sums the volumes of contained `Solid`s and `Shell`s
  (`composite.py:195-198`).
- Asserted pairs are intersected twice per `check()`: once in `evaluate`
  (`assertions.py:42/81`) and again in `compute` (`diagnostics.py:88`) [C].
- Failure texts round to 4 decimals, so a failing overlap of 4e-5 mm³ cannot
  occur (below epsilon) but a clearance failure can print `0.2000mm below min
  0.2mm` for `d = 0.19999999` [I from format strings].

## 4. `check()` (`U/mechanism/check.py`)

Signature: `check(assembly: Assembly, out: str | Path = "outputs", *, export: bool | None = None) -> CheckResult`
(`check.py:29-34`). `CheckResult(exports: tuple[Path,...], diagnostics: Diagnostics)` (`:15-18`).

Order of operations [C]:

1. `out_path = resolve_out(out)`; `mkdir(parents=True, exist_ok=True)` (`:35-36`).
2. Export first: `export_assembly(assembly, out_path)` when
   `export` (default: module global `_export_default`, which `khana check`
   sets to `False`, `cli.py:104-108`, `check.py:21-26,37-38`). So a failing
   check still leaves fresh `assembly.stl`/`assembly.step` (tested,
   `UT/mechanism/test_check.py:114-124`).
3. `evaluate_assertions(assembly)` (`:39`), `failed = any(not passed)` (`:40`).
4. `compute(assembly)` then `replace(..., exports=..., assertions=..., status="assertion_failed" if failed else "ok")` (`:41-46`).
5. Write `out/mechanism.json` as `json.dumps(asdict(diagnostics), indent=2) + "\n"` (`:47-49`).
6. `viewer.push(assembly)` if `khana view` enabled it; `draw.draw(...)` if
   `khana draw` enabled it (`:50-60`).
7. `raise SystemExit(1)` if any assertion failed (`:62-63`), else return.

Consequences [C/I/M]:

- `status` is only ever `"ok"` or `"assertion_failed"` from `check()`.
  Unasserted interferences do **not** affect it [M: `O/ok/outputs/mechanism.json`
  has two interferences and `status: "ok"`].
- `status: "error"` is written only by the CLI when the script raises
  (`cli.py:47-53,80-92`), into `--out` (default `<script dir>/outputs`,
  `cli.py:81-82`), **not** into the directory the script passed to
  `check(out=...)`. A script that checks into `checks/A-C0.20/` and later
  crashes leaves the previous run's `mechanism.json` there untouched [I].
- `SystemExit(1)` ends the script at the first failing `check()`. Scripts that
  loop `check()` over poses (`cad-project-003/.../preload_z/coupon.py:120-124`)
  report only up to the first failing pose [I]. The CLI re-raises
  `SystemExit` without printing anything (`cli.py:85-86`) [M:
  `O/fail/build.log` is empty, exit code 1].
- `khana check` means "no export", not "no geometry": `compute` still runs
  every pairwise Boolean [M: `O/check-mode/outputs/mechanism.json`
  `exports: []`, 5 parts].

## 5. Diagnostics (`U/mechanism/diagnostics.py`)

Constants: `SCHEMA_VERSION = "0.2"` (`:12`), `INTERFERENCE_VOLUME_EPSILON_MM3 = 0.001` (`:13`).

| dataclass | fields [C] |
| --- | --- |
| `BBox` | `min: (x,y,z)`, `max: (x,y,z)` (`:16-19`) |
| `PartDiagnostics` | `bbox`, `volume_mm3`, `surface_area_mm2`, `center_of_mass_mm`, `is_valid`, `face_count`, `edge_count`, `vertex_count` (`:22-31`) |
| `Interference` | `a`, `b`, `volume_mm3`, `centroid` (`:34-39`) |
| `AssertionResult` | `name`, `passed`, `detail = None` (`:42-46`) |
| `Diagnostics` | `schema_version = "0.2"`, `status = "ok"`, `error = None`, `hint = None`, `parts = {}`, `interferences = ()`, `assertions = ()`, `exports = ()` (`:49-58`) |

`compute(assembly) -> Diagnostics` (`:114-123`): places every part, computes
`_part_diagnostics` per name (dict: last duplicate wins), and
`_interference(a, b)` for every `itertools.combinations(placed, 2)` pair in
`placed_parts` order (so pairs read `housing/pin`, not assertion order) [M:
`O/ok`].

`_part_diagnostics(shape)` (`:73-84`) and the OCCT call under each field:

| field | build123d call | OCCT underneath [C] |
| --- | --- | --- |
| `bbox` | `bounding_box()` (`diagnostics.py:65-70`) | `BRepBndLib.AddOptimal_s` (`B/geometry.py:1098-1124`, `optimal=True` default); the `tolerance` argument does not enlarge an optimal box |
| `volume_mm3` | `Compound.volume` | sum of `BRepGProp.VolumeProperties_s` over solids and shells (`composite.py:195-198`, `shape_core.py:199-208,778-798`) |
| `surface_area_mm2` | `Shape.area` | `BRepGProp.SurfaceProperties_s` over all faces (`shape_core.py:313-320`) |
| `center_of_mass_mm` | `Compound.center()` (default `CenterOf.MASS`) | `VolumeProperties_s(...).CentreOfMass()` (`composite.py:563-590`) |
| `is_valid` | `Shape.is_valid` | `BRepCheck_Analyzer(...).IsValid()`, parallel (`shape_core.py:446-455`) |
| `face/edge/vertex_count` | `len(faces())` etc. | `TopExp_Explorer` deduplicated by `hash` (`shape_core.py:3000-3011`) |

`_interference(a, b)` (`:87-111`): `inter = placed(a) & placed(b)`; `None` ->
no row; a shape with `.volume` -> its volume and its own `center()`; a
`ShapeList` -> sum of volumes and the **largest** piece's center; drop if
`volume <= 0.001`. For `Part` inputs the result is always a `Compound`, so the
centroid is the mass centroid of **all** overlap pieces together, which for
two disjoint overlap regions lies between them, possibly outside both [C, I].

## 6. `mechanism.json` (schema 0.2)

Written by `check()` (`check.py:47-49`) and, on a script crash, by the CLI
(`cli.py:47-53`). Field order is the dataclass order. Floats are raw Python
`repr` (full precision, e.g. `5199.999999999999`); tuples become arrays.

```text
{
  "schema_version": "0.2",                      // string, constant
  "status": "ok" | "assertion_failed" | "error",
  "error": null | string,                        // full traceback text (error only)
  "hint": null | string,                         // match_hint(traceback) (error only)
  "parts": {                                     // {} on error
    "<leaf name>": {                             // placed_parts leaf name; duplicates collapse
      "bbox": {"min": [x,y,z], "max": [x,y,z]},  // mm, world frame, optimal box
      "volume_mm3": number,
      "surface_area_mm2": number,
      "center_of_mass_mm": [x,y,z],
      "is_valid": boolean,
      "face_count": int, "edge_count": int, "vertex_count": int
    }
  },
  "interferences": [                             // every pair with overlap > 0.001 mm^3
    {"a": name, "b": name, "volume_mm3": number, "centroid": [x,y,z]}
  ],
  "assertions": [                                // declaration order
    {"name": string, "passed": boolean, "detail": null | string}
  ],
  "exports": [absolute path string, ...]         // [] under `khana check` / export=False / error
}
```

There is no `kind` field (tested, `UT/mechanism/test_check.py:55-58`); `khana
diff` uses the absence of `kind` to recognize a mechanism file
(`U/diff.py:22-23`).

Real example, generated by the installed `khana build` on
`O/ok/assembly.py` (housing, lid face-touching on top, a pin through the
housing, an unasserted clip overlap, a lever in a sub-assembly on a 30°
revolute joint) [M], shortened to two of five parts:

```json
{
  "schema_version": "0.2",
  "status": "ok",
  "error": null,
  "hint": null,
  "parts": {
    "housing": {
      "bbox": {"min": [-20.0, -15.0, 0.0], "max": [20.0, 15.0, 20.0]},
      "volume_mm3": 24000.0,
      "surface_area_mm2": 5199.999999999999,
      "center_of_mass_mm": [-1.9942134277144827e-16, -3.5527136788005004e-17, 10.0],
      "is_valid": true, "face_count": 6, "edge_count": 12, "vertex_count": 8
    },
    "lever": {
      "bbox": {"min": [24.499999999999996, -2.0, 4.133974596215562],
               "max": [34.16025403784438, 2.0, 10.866025403784437]},
      "volume_mm3": 80.0, "surface_area_mm2": 136.0,
      "center_of_mass_mm": [29.33012701892219, 4.163336342344337e-18, 7.5],
      "is_valid": true, "face_count": 6, "edge_count": 12, "vertex_count": 8
    }
  },
  "interferences": [
    {"a": "housing", "b": "pin", "volume_mm3": 212.05750411731103,
     "centroid": [6.701415625141238e-17, -2.680566250056495e-16, 10.0]},
    {"a": "housing", "b": "clip", "volume_mm3": 31.999999999999993,
     "centroid": [19.000000000000004, -6.938893903907233e-18, 10.0]}
  ],
  "assertions": [
    {"name": "no_interference:lid/housing", "passed": true, "detail": null},
    {"name": "clearance:lever/housing>=0.5", "passed": true, "detail": null},
    {"name": "interference:pin/housing", "passed": true, "detail": null}
  ],
  "exports": [
    "<repo>/tmp/khana/oracle/ok/outputs/assembly.stl",
    "<repo>/tmp/khana/oracle/ok/outputs/assembly.step"
  ]
}
```

The full five-part file is `O/ok/outputs/mechanism.json`. Variants [M]:

- `O/fail/outputs/mechanism.json`: lid lowered 0.1 mm, pin moved away:
  `status: "assertion_failed"`, details `"interference volume 120.0000mm^3"`,
  `"clearance 0.0000mm below min 0.2mm"`, `"expected interference absent
  (volume 0.0000mm^3); reason: press-fit bore not modeled yet"`; exit 1, no
  stderr.
- `O/error/outputs/mechanism.json`: script crashes before `check()`:
  `status: "error"`, `error` = traceback, `hint: "Missing .part accessor — use
  ...p.part"`, `parts: {}`, `assertions: []`.
- `O/keyerror/outputs/mechanism.json`: assertion on an undeclared part:
  `status: "error"`, `KeyError: 'ghost'`, `hint: null`.
- `O/check-mode/outputs/mechanism.json`: `khana check`: `exports: []`, no STL/STEP.
- `O/diff-ok-fail.txt`: `khana diff` ok -> fail.

## 7. Hints (`U/mechanism/hints.py`)

`match_hint(error_text) -> str | None` returns the first matching hint
(`hints.py:40-44`). Only the CLI error path calls it (`cli.py:48-50`).

| # | regex (`hints.py`) | hint |
| --- | --- | --- |
| 1 | `NoneType.*has no attribute 'part'` (`:7-10`) | use `with BuildPart() as p: ...; return p.part` |
| 2 | `has no attribute 'volume'` (`:11-15`) | `a & b` returns None when solids don't overlap; guard or use `assert_no_interference()` |
| 3 | `TypeError.*Location` (`:16-20`) | `Location((x, y, z))` / `Location((x,y,z), (rx,ry,rz))` |
| 4 | `BRep_API: command not done\|BRepAlgo_BooleanOperation` (`:21-25`) | OCCT boolean failed; check validity, tolerances |
| 5 | `StdFail_NotDone` (`:26-30`) | fillet/chamfer radius too large |
| 6 | `No module named` (`:31-36`) | only build123d, bd_warehouse, cad_khana importable |

All six are OCCT/build123d-text specific; none maps a wonky capability error.

## 8. Pick (`U/mechanism/pick.py`, uncommitted) and `khana pick`

Constants: `_EPS_DOT = 1e-3` (`:20`), `_EPS_MM = 0.02` (`:21`); coordinates
rounded to 4 decimals (`_vec`, `:24-25`), areas/lengths to 3.

| name | semantics [C] |
| --- | --- |
| `describe_face(shape, index) -> dict` | `{"face", "geom": geom_type.name, "area_mm2", "center"}`; for `PLANE` also `"normal"` at the center and `"plane_offset_mm" = normal·center` (`:42-55`) |
| `describe_edge(shape, index) -> dict` | `{"edge", "geom", "length_mm", "mid", "start", "end"}` from `position_at(0.5/0/1)`; `LINE` adds `"direction"`, `CIRCLE` adds `"radius_mm"` (`:58-75`) |
| `describe_vertex(shape, index) -> dict` | `{"vertex", "position"}` (`:78-80`) |
| `face_relations(shape, indices) -> list[dict]` | for every pair: if both planar, `"angle_deg" = acos(\|na·nb\|)`, `"parallel" = \|\|cos\|-1\| < 1e-3`, if parallel `"normal_offset_mm" = na·(cb - ca)` and `"coplanar" = \|offset\| < 0.02`; always `"min_distance_mm" = fa.distance_to(fb)` (`:83-104`) |
| `_face/_edge/_vertex(shape, index)` | index into `ocp_tessellate.ocp_utils.get_faces/get_edges/get_vertices` (TopExp map order), which the comment says differs from build123d's `.faces()` order (`:28-39`) |
| `khana pick SCRIPT --part NAME [--faces i,j] [--edges k] [--vertices m]` | runs the script with `run_name="__khana_pick__"` (the `__main__` block does not run), collects every `Assembly` in the namespace, maps `placed_parts` by name (last wins), places the part and prints JSON (`cli.py:204-256`) |

Measured on `O/pick/pick_probe.py` (upstream `pick.py` copied, run in the
installed tool) [M, `O/pick/pick.json`]:

- Two top faces tilted 2° relative to each other, 30 mm apart: `parallel:
  true`, `normal_offset_mm: -0.003`, `coplanar: true`. At 3°: `parallel: false`.
  The parallel window is `acos(0.999) = 2.56°`, and coplanarity is judged at
  the two face centers only; the tilted 20 mm face deviates up to
  `10 · sin 2° = 0.35 mm` from the other plane [I].
- A cylinder face reports `geom: "CYLINDER"`, area and a "center" of
  `[-3, 0, 0]` for an r = 3 bore on the z axis: build123d `Face.center()`
  for a non-planar face is the surface point at the middle of the uv box
  (`B/topology/two_d.py:1450-1480`), not the centroid; no radius or axis is
  reported for cylinders.
- `describe_edge` of a full circle gives `start == end`, no center or axis.
- An out-of-range index raises a raw `IndexError`; the CLI prints a traceback,
  no JSON.
- On this part the viewer order equalled build123d's `.faces()` order; the
  difference the code comment claims was not reproduced [M].

## 9. `core/tessellation.py` and `_paths.py`

- `TESSELLATION_TOLERANCE_MM = 0.1`, `TESSELLATION_ANGULAR_TOLERANCE = 0.3`
  (`U/core/tessellation.py:7-8`); `Triangle(centroid, normal, area)` (`:11-15`);
  `_triangle(a, b, c)` (zero-area triangles keep a zero normal, `:18-25`);
  `_tessellate(part)` = `part.tessellate(0.1, 0.3)` mapped to `Triangle`s
  (`:28-32`). No mechanism code calls it; printability does.
- `resolve_out(out)` (`U/_paths.py:9-25`): absolute paths unchanged; relative
  paths anchored at `sys.modules["__main__"].__file__`'s directory; cwd-relative
  when there is no `__main__` file (REPL). Tested (`UT/test_cli.py:193-258`).

## 10. The OCCT calls and their numerical behavior

| step | call chain [C] | tolerance behavior |
| --- | --- | --- |
| interference / expected interference | `Shape.__and__` -> `intersect` -> `_bool_op(BRepAlgoAPI_Common)`, `SetRunParallel(True)`, then `ShapeUpgrade_UnifySameDomain` clean (`B/topology/shape_core.py:875-891,1328-1392,2109-2178`) | no `SetFuzzyValue` on Common (fuzzy is only set in fuse paths, `shape_core.py:1274`, `composite.py:492`); `IsDone`/`HasErrors` are never checked, so a failed Common yields whatever shape it has; OCCT's own confusion tolerance (1e-7) applies |
| volume | `BRepGProp.VolumeProperties_s` (OCCT numerical integration over the faces; not re-checked here) | no error bound is requested or reported [C] |
| clearance | `distance_to` -> `BRepExtrema_DistShapeShape` `LoadS1/LoadS2/Perform` with defaults, returns `Value()` (`shape_core.py:1120-1147`) | default deflection (Precision::Confusion); `InnerSolution()` is not consulted |
| bbox | `BRepBndLib.AddOptimal_s` | tight |
| validity | `BRepCheck_Analyzer` | OCCT defaults |

What the numbers do [M, `O/probe/probe.json`, `O/probe/probe2.json`]:

| configuration (10 mm cubes unless stated) | Common volume | `distance_to` | `no_interference` | `clearance(min>0)` | `assert_interference` |
| --- | --- | --- | --- | --- | --- |
| separated 10 mm | 0 | 10.0 | pass | pass if min ≤ 10 | fail |
| face touch | 0 | 0.0 | pass | fail | fail |
| edge touch | 0 | 0.0 | pass | fail | fail |
| vertex touch | 0 | 0.0 | pass | fail | fail |
| overlap 5 mm | 500 | 0.0 | fail | fail | pass |
| identical | 1000 | 0.0 | fail | fail | pass |
| 4 mm cube fully inside 20 mm cube (`Part`s) | 64 | **8.0** (InnerSolution false) | fail | **pass for min ≤ 8** | pass |
| same with raw `Solid`s | 64 | 0.0 (InnerSolution true) | fail | fail | pass |

So "interference" means "Common volume > 0.001 mm³". Touching of any kind
(face, edge, vertex) is **not** interference: it passes
`assert_no_interference`, fails any `assert_clearance(min_mm > 0)` (distance
0) and fails `assert_interference`. There is no "contact" category in the
JSON; a touching pair is indistinguishable from a separated one in
`interferences`. The containment row is a real false pass: a part hidden
entirely inside another passes a 5 mm clearance assertion
(`probe2.json` `contained_part_clearance_min5: passed true`) while
`no_interference` fails with 64 mm³.

Overlap depth sweep (overlap of depth d over a square contact patch) [M]:

| contact patch | d = 1e-7 | 1e-6 | 1e-5 | 2e-5 | 1e-4 | 1e-3 | 1e-2 | 1e-1 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 10 × 10 mm | 0 (pass) | 1e-4 (pass) | 0.001 (pass) | 0.002 **fail** | fail | fail | fail | fail |
| 1 × 1 mm | 0 (pass) | pass | pass | pass | pass | 0.001 (pass) | 0.01 **fail** | fail |
| 0.2 × 0.2 mm | 0 (pass) | pass | pass | pass | pass | pass | 4e-4 (pass) | 0.004 **fail** |

- Overlaps up to 1e-7 mm give a Common volume of exactly 0 (OCCT treats them
  as touching).
- The effective depth tolerance is `0.001 mm³ / contact area`: 1e-5 mm for a
  10 × 10 patch, 1e-3 mm for 1 × 1, 0.025 mm for 0.2 × 0.2 [I from the
  measured rows]. For a 300 × 30 mm rail contact it is ~1e-7 mm; for a thin
  rib edge it is tens of microns. The threshold is a volume, not a length, so
  its meaning depends on part scale.
- Line contact, pin d3 in bore d3.5, 10 mm long, pushed off-center:
  penetration 1e-4 mm -> 6.1e-5 mm³ (pass), 1e-3 mm -> 0.0019 mm³ (fail),
  1e-2 mm -> 0.060 mm³ (fail).

Gap sweep [M]: gaps of 1e-9, 1e-8, 1e-7 mm give `distance_to == 0.0`. For
every gap g in 1e-6 ... 1e-3 mm, `distance_to` comes out slightly below g
(1e-6 -> 9.999999992515995e-7; 1e-3 -> 0.0009999999999994458), so
`assert_clearance(min_mm=g)` **fails on the nominal gap**. The concentric pin
in its bore (analytic radial gap 0.25) measures `0.24999999999999983`, so
`assert_clearance(pin, bore, min_mm=0.25)` fails on nominal geometry [M
distance, verdict from `assertions.py:57`]. Marc's scripts work around this
with `min_mm=0.20-1e-6` (`cad-project-003/overnight-2026-09-05/manufacturing/coupons.py:135`,
`snap_coupon.py:59`).

Rotated exact contact is robust: a face-touching pair rotated together by a
`RevoluteJoint` about a skew axis at 7°, 30°, 33.3°, 45°, 60°, 89.9° never
reports interference [M, `probe2.json` `rotated_face_contact`].

Cost [M]: one Common on a curved pair ~10-15 ms, one distance ~0.6-2 ms;
`compute` on 24 simple boxes (276 pairs) 0.17 s. The skill states the check
is O(n²) "fine up to ~20 parts" (`SKILL.md:659`); there is no broad phase,
every pair runs a full Boolean.

Diff [C/M]: `khana diff` compares part scalars and COM with exact `!=`
(`U/diff.py:73-91`), so translating a part prints `volume_mm3: 212 → 212
(-0.0%)` noise; interference volume changes use an absolute 1e-6 mm³ threshold
(`diff.py:130`); face/edge/vertex counts are not diffed; schema must be
exactly `0.2` on both sides (`diff.py:34-41`).

## 11. Tests (`UT/`)

| file | tests | covers [C] |
| --- | --- | --- |
| `mechanism/test_assembly.py` | 40 | immutability, order, defaults, colors, materials, detail swap/addition/ValueError, sub-assembly composition, joint transform (identity, 90° Z, offset pivot 180°, tilted X axis 30°), dotted paths, KeyError/ValueError, joint in `placed_parts`; `assert_min_wall` absent (`:86-87`) |
| `mechanism/test_assertions.py` | 18 | separated/face-touching/overlapping for all three assertions, names, order, collected failures |
| `mechanism/test_check.py` | 14 | STL+STEP export, mkdir, JSON fields, no `kind`, SystemExit(1), diagnostics before exit, export on failure, interferences (500 mm³, centroid 2.5), `export=` flag |
| `mechanism/test_diagnostics.py` | 18 | bbox with placement, volume, no min wall/overhang fields, touching not interfering, overlap 500 mm³, unordered pairs, topology counts 6/12/8, area 600, COM, is_valid, fused L changes counts |
| `mechanism/test_hints.py` | 9 | each pattern, CLI error JSON with and without hint |
| `mechanism/test_pick.py` (uncommitted) | 4 | plane facts, coplanar tops, 1 mm offset, line edge |
| `test_cli.py` (mechanism parts) | 31 total | check without exports, build after check, error diagnostics, out anchoring (`:94-258`) |
| `test_diff.py` | 23 | mechanism and printability diffs, schema mismatch |

Untested [C]: edge/vertex contact, containment, gaps near `min_mm`, duplicate
names, unknown names, multi-piece overlaps, non-box geometry in
`test_assertions`, pick on curved faces, pick index order.

## 12. What the README and the skill say

- README (`~/Workspace/cad/cad-khana/README.md`): describes a
  single `diagnostics.json` (`:22-24,53-57`) although the files are
  `mechanism.json` and `<name>-printability.json`; its example
  (`:138-167`) imports `cad_khana.core.assembly` and `cad_khana.core.build`
  and calls `assert_min_wall`, none of which exist (tested absent,
  `UT/mechanism/test_assembly.py:86-87`). Stale.
- Skill, upstream `skills/cad-khana/SKILL.md` (line numbers below are upstream; the
  installed copy has the same mechanism sections shifted, e.g. the assertion
  table at `:343-363` instead of `:380-400`):
  - mechanism = relational checks, `check()` writes `mechanism.json` (`:17-19`);
  - design order: declare parts as pure functions, wire with explicit
    `Location`s, assert no interference for **every** candidate pair
    ("default to over-asserting"), clearance ≥ 0.2 mm for moving pairs, run
    `khana check` until green, only then draw (`:187-216`);
  - assertion table with the 0.001 mm³ threshold (`:380-400`);
  - joints and the `t -> Assembly` factory; "sample `factory(t)` at several
    `t` and call `check()` on each to catch mid-motion overlaps" (`:402-523`,
    esp. `:411-413`);
  - JSON essentials: face/edge/vertex counts as the cheapest "did the boolean
    change geometry" signal (`:622-637`);
  - known limitations: O(n²) (`:659`), tangent contact reads as zero clearance,
    use `assert_no_interference` for parts meant to touch (`:660-663`);
  - review loop with `khana pick` (`:119-137`, uncommitted, not in the
    installed skill).

## 13. How the corpus uses the mechanism side

- wonky's 91-file Python corpus: 27 files import cad_khana (8 are
  cad-khana's own tests); grep counts [M, step 5 of the worklog]:
  `with_part` 74 calls in 17 files, `assert_no_interference` 22 in 13 (7 files
  loop `itertools.combinations(mounted, 2)`), `assert_clearance` 7 in 5,
  `assert_interference` 1 (`cad-project-046/tripod_assembly.py:154-156`, reason
  "Purchased 1/4-20 top stud engaged in the captive metal nut"), `check(` 16
  in 15; `with_subassembly`, joints, `with_materials`,
  `with_detailed_geometry`: 0; `describe_face` 3, `describe_edge` 3,
  `face_relations` 5 and `compute(` 19, each in one file (cad-khana's own
  tests).
- The whole `~/Workspace/cad` tree (corpus-usage agent,
  `tmp/khana/corpus-usage/inventory.json` `customer_calls_by_name`) [M]:
  `with_part` 202, `assert_no_interference` 183, `Assembly` 57, `check` 54,
  `assert_clearance` 22, `assert_interference` 14; no customer call of
  sub-assemblies, joints, materials, detail overrides, `compute` or pick.
- The 39 stored `mechanism.json` files in Marc's projects [M, jq over
  `tmp/khana/corpus-usage/outputs.json`]: all `status: "ok"`; 7 of them list
  interferences, 25 rows in total, of which **5 are covered by
  `assert_interference` and 20 are unasserted**. Several are "pose ghosts":
  one part placed in several motion states in the same assembly
  (`cad-project-048`: `slider`, `slider_pushed`, `slider_pushed_far`;
  `cad-project-033`: `lid`, `lid_mid_slide`, `lid_near_seat`, `lid_entry_slide`;
  `cad-project-035`: `tray`, `tray_mid`), which all-pairs interference
  reports against each other. Others are real overlaps nobody asserted, e.g.
  `cad-project-017` `mount/servo` 3661 mm³. Assertion names across the 39
  files: `no_interference` 390, `clearance` 16, `interference` 5, custom 13.
- Hand-rolled workarounds for missing features [C, read only]:
  - clearance epsilon: `min_mm=min(clearance,0.20)-1e-6`
    (`cad-project-003/overnight-2026-09-05/manufacturing/coupons.py:135`),
    `0.20-1e-6` (`snap_coupon.py:59`);
  - insertion sweeps with an own 1e-5 mm³ threshold:
    `coupons.py:165-167`, `cad-project-003/neustart/robot.py:194-200` (lift `dz`
    over 0 ... 20 mm per part), plus an access-corridor check (`robot.py:202-205`);
  - motion states as separate `check()` calls into separate directories:
    `preload_z/coupon.py:120-124` (5 strokes per preload).

## 14. wonky's compat package versus cad_khana

wonky's `python/cad_khana/` provides the modeling API and refuses every
diagnostic (decision 3; decision 12 adds `--khana-checks=skip` for `check()`
and `inspect()`), `docs/python-khana.md:3-10,97-163`.

| cad_khana name | upstream | wonky | wonky file:line |
| --- | --- | --- | --- |
| `PlacedPart` | plain record | provided; validates nonempty `name`, `material` str; places eagerly (`world`) and records `appearance` | `W/mechanism/assembly.py:24-44` |
| `RevoluteJoint`, `.with_angle`, `.transform` | pivot conjugation | provided, same formula; angle 0 is the exact identity | `W/mechanism/assembly.py:47-69` |
| `SubAssembly`, `.effective_location` | | provided; `assembly` must be an `Assembly`; leaves precomputed | `:72-97` |
| `DetailOverride` | | provided | `:100-107` |
| `Assembly` fields, `with_part`, `with_subassembly`, `with_joint`, `with_joint_angle`, `with_materials`, `with_detailed_geometry`, `_swap_detail`, `_all_part_names`, `placed_parts` | | provided, same semantics | `:110-211` |
| `Assembly.assert_no_interference/assert_clearance/assert_interference` | recorded | recorded, never evaluated; exported in `brep.json` metadata with `status: "declared-not-evaluated"` | `:189-199,237-247` |
| `Assembly.compound` | nested `Compound` of moved parts and sub-compounds | flat `build123d.Compound(children=[leaf.world ...])` | `:213-216` |
| `NoInterference`, `Clearance`, `ExpectedInterference`, `Assertion` | records + `evaluate` | records provided; `.evaluate()` refused | `W/mechanism/assertions.py:17-59` |
| `assertions.evaluate` | | refused | `W/mechanism/assertions.py:61` |
| `assertions._intersection_volume`, `_placed` | private | absent: `AttributeError` (module `__getattr__` raises `AttributeError` for `_`-names) | `W/_wonky.py:147-149` |
| `check` | | refused; with `--khana-checks=skip` returns `NotRun`, host records `not-run` | `W/mechanism/check.py:18`, `W/_wonky.py:113-125` |
| `CheckResult` | | refused type | `W/mechanism/check.py:17` |
| `_export_default`, `_set_export_default` | | provided (inert) | `W/mechanism/check.py:9-14` |
| `SCHEMA_VERSION`, `INTERFERENCE_VOLUME_EPSILON_MM3` | | provided | `W/mechanism/diagnostics.py:5-6` |
| `BBox`, `PartDiagnostics`, `Interference`, `AssertionResult`, `Diagnostics` | | refused types | `W/mechanism/diagnostics.py:11-15` |
| `compute` | | refused | `W/mechanism/diagnostics.py:16` |
| `diagnostics._placed/_bbox/_part_diagnostics/_interference` | private | absent (`AttributeError`) | |
| `match_hint` | | refused | `W/mechanism/hints.py:5-6` |
| `hints._PATTERNS` | private | absent | |
| `describe_face`, `describe_edge`, `describe_vertex`, `face_relations` | uncommitted upstream | refused | `W/mechanism/pick.py:8-11` |
| `pick._EPS_DOT/_EPS_MM/_vec/_face/_edge/_vertex` | private | absent | |
| `TESSELLATION_TOLERANCE_MM`, `TESSELLATION_ANGULAR_TOLERANCE` | | provided | `W/core/tessellation.py:5-6` |
| `Triangle`, `_triangle`, `_tessellate` | | refused | `W/core/tessellation.py:11-13` |
| `_paths.resolve_out` | | provided, same semantics | `W/_paths.py:9-16` |
| `khana build/check/pick` | CLI | `cli.app`/`cli.main` refused; `bin/wonky-python.mjs` replaces build | `W/cli.py:7-8` |
| names re-exported by import (`assembly.Location`, `assembly.Axis`, `check.Assembly`, `check.compute`, ...) | importable | capability error via module `__getattr__` except `assembly.{Clearance, ExpectedInterference, NoInterference}` | `W/mechanism/assembly.py:21,250` |

wonky tests: `test/python-khana.test.mjs` (9 tests: named/colored/placed
bodies, repeated placement, builder semantics, joint about its axis line,
diagnostics refused even when caught, unknown names, part/color validation,
`show()`, corpus repros) and `test/python-khana-checks.test.mjs`
(`--khana-checks=skip`).

### Exactly what is missing for a native mechanism side

1. **Assertion evaluation** (`evaluate`, `<Assertion>.evaluate`): pairwise
   overlap volume and a minimum distance between placed bodies, with a
   verdict rule.
2. **`compute()` facts**: per-part surface area and center of mass (no host
   request; the shim registers only `edges`, `solids`, `bounding_box`,
   `is_valid` on shapes, `python/_b3d_query.py:981-984`), face and vertex
   counts (no `faces()`/`vertices()` on solids), and all-pairs interference
   with a location. Volume (`src/python.mjs:653-657`), tight bounds
   (`:640-647`) and a construction-audit `is_valid`
   (`python/_b3d_query.py:974-979`) exist.
3. **`mechanism.json` writer** (host side), the `CheckResult`/`Diagnostics`
   result objects, `SystemExit` behavior, exports inside `check()`.
4. **Error diagnostics** (`status: "error"` + hint) for crashed builds.
5. **pick**: `describe_*`, `face_relations`, a CLI and a viewer selection
   that speaks the same IDs.
6. **diff** of two mechanism reports.

### What the kernel has for this today

| need | wonky today | gap |
| --- | --- | --- |
| overlap volume `a & b` | host Boolean `INTERSECTION` (`src/python.mjs:628-638`); coaxial-cylinder Bend Boolean (`kernel/boolean.bend:7-9`), planar and convex-tool arms, hybrid last; empty FeatureScript intersection refused (`src/library.mjs:90,586,677`); hybrid face-touching intersect is refused, not empty (`docs/hybrid-boolean-plan.md:304`) | touching pairs (the most common mating case) must come back as "empty, touching", not as a refusal |
| volume with bound | `kernel/volume.bend` `Measured{volume, bound, quadrature, faces} \| Refused` (`:115-117`, uncommitted) | none for overlap bodies of curved Booleans until those build |
| body-to-body minimum distance | none in Bend; `kernel/hybrid/recover/clear.bend` has a two-set BVH triangle join `close2` (`:682-699`, uncommitted, F32) | exact/certified distance for plane/cylinder/cone pairs, containment handling |
| point in solid | `kernel/solid-classification.bend` (plane and cylinder faces only, `:145-152`; five fixed ray directions, ≥ 2 agreeing votes, `:294-308`); `qContainsPoint` needs it loaded (`src/queries.mjs:129-133`) | cones/spheres/tori; native backend |
| area, centroid | none as a query | divergence-theorem moments next to `volume.bend` |
| stable topology IDs for pick | see `docs/topology-identity.md` | ID-based `describe_*` |

## 15. Weaknesses of cad_khana's approach

1. **The interference threshold is a volume, not a length.** Its depth
   meaning is `0.001 / contact area` (Section 10): microns on large contacts,
   25 µm on a 0.2 mm patch. Needle-like overlaps along an edge pass; large
   flush contacts fail on sub-micron float noise.
2. **Touching is invisible.** Face, edge and vertex contact report volume 0
   and no row; there is no contact kind, no contact area, and "touching" and
   "separated" look the same in `interferences`.
3. **No epsilon on clearance.** Nominal gaps fail by one ulp (0.25 bore gap
   measures 0.24999999999999983; every tested gap 1e-6 ... 1e-3 measures
   below itself). Users patch with `-1e-6`.
4. **Containment false pass.** `distance_to` on `Part` compounds returns the
   boundary distance of a fully contained part (8.0 mm) instead of 0, so
   `assert_clearance` passes for a part buried inside another.
5. **No penetration depth or direction.** A failing overlap reports only its
   volume and (for `Part`s) the merged centroid of all overlap pieces; no
   minimum translation, no witness faces.
6. **No kinematic checking.** Joints exist only for animation; clearance over
   a motion range means sampling `factory(t)` and calling `check()` per
   sample (skill `:411-413`); samples miss collisions between them; the
   corpus hand-rolls insertion sweeps (Section 13). Only revolute joints
   exist; no prismatic joint although the corpus's sweeps are all linear.
7. **Pose ghosts and unasserted overlaps stay "ok".** All-pairs interference
   includes alternate poses of the same part; unasserted overlaps never change
   `status` (20 of 25 stored rows).
8. **Late name validation.** Unknown names are a `KeyError` at `check()`
   (hint `null`); duplicate names collapse in `parts` and self-interfere.
9. **O(n²) full Booleans, twice for asserted pairs,** no broad phase, no cache
   across iterations.
10. **First failure stops the run** (`SystemExit(1)` inside `check()`), with
    no stderr line; error JSON goes to the CLI's `--out`, not to `check(out=)`,
    so stale results can survive.
11. **Unchecked OCCT results.** `BRepAlgoAPI_Common` success is not checked;
    `is_valid` is only reported, never used to distrust a volume.
12. **No exactness information.** Every number is a bare float with float noise
    (`5199.999999999999`); nothing says which values are exact and which are
    approximate.
13. **pick heuristics.** Parallel within 2.56°, coplanar judged at two centers
    (a 2° tilt reported coplanar), cylinder "center" is a surface point and no
    axis/radius, OCCT index order that changes on every rebuild, uncommitted.
14. **Hints match OCCT error text** and one of them (`a & b returns None`) is
    wrong for `Part`s in build123d 0.10.
15. **`assert_interference` mixes two intents**: a known defect awaiting a fix
    (its documented purpose) and an intended engagement such as a thread in a
    nut or a press fit (`cad-project-046/tripod_assembly.py:154-156`).

## 16. Improvement ideas for wonky

1. **Contact-classified pair report.** For each pair: `separated{distance,
   witness points}`, `touching{kind: face|edge|vertex, contact area, faces}`
   or `overlapping{volume ± bound, penetration depth, direction, components}`,
   decided by exact predicates under one stated linear tolerance, not a volume
   threshold. Keep a derived `volume_mm3 > 0.001` flag only for 0.2
   compatibility.
2. **Clearance with a stated tolerance and exact gaps.** For analytic pairs
   (coaxial cylinders, parallel planes) report the exact gap (0.25, not
   0.2499...), and pass `d >= min_mm - tol` with `tol` written into the
   report. Removes the `-1e-6` workarounds.
3. **Containment-correct distance.** Classify one point of each body against
   the other first; contained or overlapping bodies have distance 0 and are
   reported as overlapping.
4. **Penetration depth and a fix hint**: minimum translation distance and
   direction for overlaps, per connected overlap component, with its own
   centroid and bounding box and the IDs of the faces involved.
5. **Motion checks.** `assert_clearance_over(joint path, range, min_mm)` and
   the same for interference, evaluated by conservative advancement or swept
   bounds with a certified step, reporting the worst angle/offset. Add a
   prismatic (slide) joint, which covers the corpus's insertion sweeps.
6. **Pose sets.** Declare alternate poses of one part (`lid` at seat, mid,
   entry) as states that are checked against the rest of the assembly but not
   against each other; removes pose-ghost rows.
7. **Strictness levels.** Unasserted overlaps raise `status: "warning"` by
   default and fail under `--strict`; split `assert_interference` into
   `expect_defect(reason)` (current meaning) and `assert_engagement(a, b,
   depth=...)` for threads and press fits.
8. **Declaration-time validation.** Unknown or duplicate names fail on the
   model line (wonky already places parts eagerly on their line); leaf names
   may be path-qualified (`arm.lever`).
9. **Broad phase and caching.** Tight AABBs (and the recover BVH) prune pairs;
   exact narrow phase only on candidates; results cached by the content hash
   of both placed bodies so an edit re-checks only the changed part; asserted
   pairs are computed once and reused for the interference list.
10. **Run to completion.** Collect every `check()` call of a run (all poses) in
    one report, exit nonzero at the end, print one stderr line per failure, and
    write error reports next to the declared `out` with a run id and source
    hash, so stale files are recognizable.
11. **Exactness in the report.** Each number carries `exact` or `± bound`
    consistent with `src/exactness.mjs`; a refused measurement is a
    capability entry, never a silent 0. New schema (for example
    `wonky-mechanism/1`) plus a 0.2-compatible writer for `khana diff` and
    Marc's existing files.
12. **Native host service, not Python-only.** Implement checks on Bend bodies
    in the host so the FeatureScript frontend (the R20 customer) and the
    Python frontend share them; show interference regions and clearance
    witness segments in wonky's viewer.
13. **pick on stable IDs.** Use wonky's topology identity instead of OCCT
    indices; report cylinder axis and radius, circle center/axis, true face
    centroids; coplanarity as maximum deviation of face b from plane a with an
    explicit tolerance, and an explicit angular tolerance (default far below
    2.56°).
14. **Hints from capability codes.** Map wonky's structured capability errors
    to repair hints instead of regexes over OCCT messages.
15. **Tolerance-aware diff** that also diffs topology counts and, with stable
    IDs, names which faces changed.
16. **Degenerate-part warnings**: a zero-volume or invalid part is reported,
    not silently exempt from interference.

## 17. Coverage checklist of public names

Every public (and relevant private) name of the mechanism side, with the
section that covers it:

- `mechanism.assembly`: `PlacedPart` (+ fields `name`, `part`, `location`,
  `color`, `material`), `RevoluteJoint` (`axis`, `angle_deg`, `with_angle`,
  `transform`), `SubAssembly` (`name`, `assembly`, `location`, `joint`,
  `effective_location`), `DetailOverride` (`part`, `location`, `material`,
  `color`), `Assembly` (`parts`, `subassemblies`, `assertions`, `with_part`,
  `with_subassembly`, `with_joint`, `with_joint_angle`, `with_materials`,
  `with_detailed_geometry`, `_swap_detail`, `_all_part_names`,
  `assert_no_interference`, `assert_clearance`, `assert_interference`,
  `placed_parts`, `compound`); re-exported imports `Axis`, `Color`,
  `Compound`, `Location`, `Part`, `Assertion`, `Clearance`,
  `ExpectedInterference`, `NoInterference`: Sections 2, 14.
- `mechanism.assertions`: `_intersection_volume`, `NoInterference` (`a`, `b`,
  `name`, `evaluate`), `Clearance` (`a`, `b`, `min_mm`, `name`, `evaluate`),
  `ExpectedInterference` (`a`, `b`, `name`, `reason`, `evaluate`),
  `Assertion`, `_placed`, `evaluate`; imported `INTERFERENCE_VOLUME_EPSILON_MM3`,
  `AssertionResult`, `Part`: Sections 3, 14.
- `mechanism.check`: `CheckResult` (`exports`, `diagnostics`),
  `_export_default`, `_set_export_default`, `check`; imported `draw`, `viewer`,
  `resolve_out`, `export_assembly`, `Assembly`, `evaluate_assertions`,
  `Diagnostics`, `compute`: Sections 4, 14.
- `mechanism.diagnostics`: `SCHEMA_VERSION`, `INTERFERENCE_VOLUME_EPSILON_MM3`,
  `BBox`, `PartDiagnostics`, `Interference`, `AssertionResult`, `Diagnostics`,
  `_placed`, `_bbox`, `_part_diagnostics`, `_interference`, `compute`:
  Sections 5, 6, 14.
- `mechanism.hints`: `_PATTERNS`, `match_hint`: Section 7.
- `mechanism.pick`: `_EPS_DOT`, `_EPS_MM`, `_vec`, `_face`, `_edge`,
  `_vertex`, `describe_face`, `describe_edge`, `describe_vertex`,
  `face_relations`; CLI `khana pick`: Section 8.
- `core.tessellation`: `TESSELLATION_TOLERANCE_MM`,
  `TESSELLATION_ANGULAR_TOLERANCE`, `Triangle`, `_triangle`, `_tessellate`:
  Section 9.
- `_paths`: `resolve_out`: Section 9.
- CLI mechanism parts: `build`, `check`, `pick`, `_write_error_diagnostics`,
  `_run_script`; `diff` mechanism branch: Sections 4, 6, 8, 10.

## 18. Open questions

- Does wonky keep `mechanism.json` schema 0.2 byte-shape compatible (Marc's 39
  stored files, `khana diff`, `watch.py`), or write a new schema plus a 0.2
  view?
- Which linear tolerance defines "touching" (build123d `TOLERANCE = 1e-6`,
  `B/geometry.py:89`; OCCT confusion 1e-7; wonky's profile quantization of
  about 1.6e-6 mm, `src/exactness.mjs:23`)?
- Should unasserted overlaps fail by default? That would turn 7 of Marc's 39
  stored results red.
- Pose ghosts: explicit pose-set API, or infer "same part object placed more
  than once"?
- Is the uncommitted `pick.py` Marc's own work, and should wonky's pick copy
  its JSON shape?
- Motion checks: revolute only, or add prismatic joints (not in cad_khana, but
  every hand-rolled sweep in the corpus is linear)?
- The hybrid's face-touching intersect refusal has to become an "empty,
  touching" answer before interference checks can rely on it; who owns that
  (r20-gate hybrid work is paused and uncommitted)?
- Should the checks run in the FeatureScript frontend too (R20 customer), and
  what is the FeatureScript surface for them?
- Keep `SystemExit(1)` inside `check()` for script compatibility, or collect
  and exit at the end?
