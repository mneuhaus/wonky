# W5b: build123d names behind the Python door (corpus run, 2026-09-23)

W5 (commit fceffef) left 37 of Marc's 91 Python files at a use-site capability
error for one of 16 build123d names. W5b implemented those names and what the
37 files call after them, following [w5b-plan.md](w5b-plan.md). Tasks A to G
built it; task H recorded a corpus run over all 91 Python files, where each
of the 37 stops now, the STEP check and the kernel demand for W2. The
integration step then resolved the conflicts between the task outputs, reran
the corpus and the tests on the integrated tree, and updated this page (see
"Integration"). Regression review 1 then removed four silent differences from
build123d that verification found (see "Regression review 1"), and Regression review 2 two
more (float-noise ties in selectors, cylinder seams after Booleans; see "Fix
round 2").

The user-facing surface is in [python-frontend.md](../python-frontend.md)
(location values, 2D profiles, operations and containers, queries and
selectors, operations the Bend kernel lacks) and
[python-khana.md](../python-khana.md).

## Headline

- **No Python file builds (0 of 91)**, as the plan predicted. After W5b every
  file stops at a kernel operation Bend lacks, at the package policy, at a
  cad_khana diagnostic, or in a Boolean that takes longer than 180 s.
- **No build123d name stops a file any more.** No first blocker in the 91 is
  "… is not implemented by the Python frontend" for an API that Bend could
  build. The only messages of that form left name a missing kernel operation
  (edge blend, font outlines, offset, loft, B-spline, planar region Boolean) or
  the external-geometry policy (`import_step`).
- **34 of the 37 files get past their W5 blocker.** The other 3 stop at the
  same name because that name is itself their final gap: `import_step` twice
  (policy) and `Spline` (`cad-project-047/ei.py`; the message now names the
  missing B-spline curves).
- **28 of the 37 stop exactly at the plan's final gap.** 9 stop earlier or run
  out of time:
  - 2 at a planar region Boolean the plan did not see (`zusatz.py`,
    `zusatz_seite.py`);
  - 3 in planar arrangement unions of slanted prisms (`bar.py`, `build.py`,
    `merged.py`);
  - 3 time out after 180 s in slow Bend Booleans (`camera_mount.py`,
    `camera_mount_assembly.py`, `preload_family.py`). With a 900 s budget
    `preload_family.py` reaches its planned gap (`Edge.make_spline`, 537 s),
    and `camera_mount.py` stops in a slanted-prism union (239 s);
  - 1 (`project-component-abeb2fd3.py`) in a box-minus-box subtraction that the **uncommitted
    W2 kernel** refuses and the committed kernel builds (regression below).
- **Other 54 files: 53 unchanged.** `snap_coupon.py` moves from its W5 stop
  (line 50) to the same W2 kernel regression one line earlier (line 49).
- **Integration rerun: identical.** After the integration fixes, the rerun
  (`--rerun`, 21:12 to 21:19) gives the same status, message and line as
  task H's run for all 91 files. No file builds, so there is no newly building
  file to compare with Marc's exported STEP/STL or with a build123d run of
  the same file (`reference.mjs --label w5b`: no rows).
- **Regression review 1: no silent differences left in the four findings.** `edges()`
  and every selector after a Boolean are build123d's unified edges (the union
  of two boxes has 30 edges, not Bend's 84), or a capability error where
  OpenCascade's merge is not determined by the Bend body; sub-tolerance
  profile edges and near-collinear polygon vertices are refused instead of
  built; picks that depend on OpenCascade's edge order or direction are
  refused. The Regression review corpus rerun is identical for all 91 files (no file
  reaches these cases before its kernel stop).
- **Regression review 2: no silent differences left in the two findings.** Picks among
  sort keys that are equal within float noise (build123d orders them by
  OpenCascade's rounding, Bend by its own) are refused like other ties, and a
  full cylinder face after a Boolean keeps the seam of the operand surface it
  comes from (or refuses seam-dependent evaluations where no operand fixes
  it). Brute-force check: 0 of 612 picks differ silently (was 25). The rerun
  is identical for 90 of 91 files; `project-component-abeb2fd3.py` moves from line 544 to its
  planned gap at line 559 (planar region Boolean) because W2's working tree
  builds that box-minus-box again, so 29 of the 37 now stop at their planned
  gap.
- **STEP:** 12 new artifacts covering the 16 names pass
  `uv run scripts/validate-step.py`. Volume, bounding box and topology counts
  match build123d 0.13.0, except the face split after Booleans (see "STEP").

## Run

```sh
node scripts/corpus/run.mjs --label w5b --only .py --concurrency 3 [--rerun]
node scripts/corpus/summarize.mjs --label w5b
node scripts/corpus/compare.mjs --label w5b --base w5-fix2
node tmp/w5b/h-report/analyze.mjs w5b      # per-file table below
node scripts/corpus/reference.mjs --label w5b   # reference STEP/STL of successes (none)
```

2026-09-23 20:19 to 20:27 local time, Python 3.13.3 (`tmp/corpus/uv-python`),
mirror `tmp/corpus/src`, default JS path, 3 processes. Load average was 40 at
the start and 133 during the timeouts; another corpus run (`w1-verify3`, 2
processes, FeatureScript) was active. Working tree: HEAD (d866717) plus the
uncommitted W5b Python frontend and the uncommitted work of the other
workflows (W1, W2, viewer, hybrid-gate). Records are in
`out/corpus/bench/w5b/runs.jsonl`; the per-file analysis is in
`tmp/w5b/h-report/analysis.json`.

The integration rerun (`--rerun`, 2026-09-23 21:12:48 to 21:19:51, 3
processes, load average up to 150, another workflow's `npm test` active) ran on
the integrated tree. `node tmp/w5b/integrate/vs-h.mjs` finds the same status,
message and line as the first run for all 91 files; H's records are kept in
`tmp/w5b/integrate/h-w5b-backup/`. The latest record per file is the
integrated one, and `summarize.mjs`/`compare.mjs` give the same numbers as
below.

The Regression review rerun (`--rerun`, 2026-09-23 23:06 to about 23:20, 3 processes,
load average 35 to 85, another workflow's FeatureScript corpus run active)
ran after the four fixes. `node tmp/w5b/integrate-fix/vs-before.mjs` finds
the same status, message and line as the integration run for all 91 files
(its records are kept in `tmp/w5b/integrate-fix/w5b-before-fix/`).
`compare.mjs --base w5-fix2` again reports `newOk 0` and `regressions []`;
its transition clusters now read `py-api-surface → boolean-capability` 10,
`→ boolean-invalid-topology` 4, `→ timeout` 3, `→ other` 1 and
`other → boolean-invalid-topology` 1 (17 units keep their cluster with a new
message): the corpus scripts' cluster rules changed in the meantime, the
messages are identical.

The Regression review-2 rerun (`--rerun`, 2026-09-24 00:33:41 to 00:40:58, 3
processes, load average falling from about 50 to 10) ran after both round-2
fixes; the round-1 records are kept in `tmp/w5b/integrate-fix2/w5b-before-fix2/`.
`node tmp/w5b/integrate-fix2/vs-before.mjs` finds the same status, message and
line for 90 of 91 files. The one move is `cad-project-003/project-component-abeb2fd3.py`: line 544
(`AmbiguousContact`, the W2 working-tree regression) → line 559, `Sketch +
Sketch` needs a planar region Boolean, the plan's gap. The cause is W2's
kernel, which changed in the meantime: the regression repro
`tmp/w5b/h-report/regress/tray.fs` (and `tray.py`) now builds (46 faces,
6448.3776 mm³, as HEAD d866717), while `snap.py` and `snap_coupon.py:49`
still stop at `AmbiguousContact (stage 2, detail 10)`. `compare.mjs --base
w5-fix2`: `newOk 0`, `regressions []`; transitions `py-api-surface →
boolean-capability` 10, `→ timeout` 3, `→ boolean-invalid-topology` 3,
`→ other` 1 and `other → boolean-invalid-topology` 1 (18 units keep their
cluster with a new message).

Result: 78 capability, 9 frontend, 4 timeouts, 0 builds. `compare.mjs`
reports `newOk 0`, `regressions []` and these transitions:
`py-api-surface → boolean-capability` 10, `→ other` 5, `→ timeout` 3; 18 units
keep their cluster with a new message.

| first blocker, all 91 files | w5-fix2 | w5b |
| --- | ---: | ---: |
| import refused by the package policy | 42 | 42 |
| build123d name not implemented by the shim | 35 | **0** |
| `import_step` (external-geometry policy) | 2 | 5 |
| build123d operation Bend lacks (named in the message) | 0 | 14 |
| kernel limit (Bend Boolean refusal) | 2 | 16 |
| cad_khana diagnostic (`inspect()`) | 0 | 1 |
| no result (`NoResultError`: pytest and helper modules) | 8 | 8 |
| the file's own bug (`cad-project-033/debug_edges.py`) | 1 | 1 |
| timeout (180 s) | 1 | 4 |
| **builds** | **0** | **0** |

## The 37 files

"W5" is the W5 blocker and its line, "stop" is the w5b first blocker, "plan"
is the final gap [w5b-plan.md](w5b-plan.md) predicted. `bb-mfg/` is
`cad-project-003/overnight-2026-09-05/manufacturing/`, `…/` is
`cad-project-014/bottom-drive-review-2026-09-19/tool-improvement/worktree/`.
A stop on an earlier line than W5 is inside a function the W5 line calls.

| W5 | file | stop | plan gap | = plan |
| --- | --- | --- | --- | --- |
| `RectangleRounded` :64 | `cad-project-032/project-component-32f60153.py` | `Text` :49 (font outlines) | `Text` | yes |
| `RectangleRounded` :29 | `cad-project-032/kasse.py` | `Text` :24 (in `project-component-32f60153.py:49`) | `Text` | yes |
| `RectangleRounded` :56 | `cad-project-032/zusatz.py` | `Sketch() + [circles]` :57 (planar region Boolean) | `ExportSVG` :58 | **earlier** |
| `RectangleRounded` :59 | `cad-project-032/zusatz_seite.py` | `Sketch() + [circles]` :60 (planar region Boolean) | `ExportSVG` | **earlier** |
| `RectangleRounded` :133 | `cad-project-025/beam_frame.py` | Boolean refusal :134 (arc-edged plate − box) | same | yes |
| `RectangleRounded` :153 | `bb-mfg/current-latch-final/…/source/family.py` | Boolean refusal :155 (rounded shell − rounded inner) | same | yes |
| `RectangleRounded` :144 | `bb-mfg/family-audit/8e50fd80ede5/family_snapshot.py` | Boolean refusal :146 | same | yes |
| `RectangleRounded` :144 | `bb-mfg/family-audit/fd500e8d3059/family_snapshot.py` | Boolean refusal :146 | same | yes |
| `RectangleRounded` :146 | `bb-mfg/hands-audit/e055fee48ec7/family_snapshot.py` | Boolean refusal :148 | same | yes |
| `Polygon` :77 | `bb-mfg/preload_z/coupon.py` | `offset` :77 | `offset` | yes |
| `Polygon` :140 | `cad-project-035/project-component-d98e059b.py` | `fillet` :216 (edge blend) | `fillet`/`chamfer` | yes |
| `Polygon` :35 | `…/labs/tile-clip-sockets/build.py` | planar union `AmbiguousContact` :205 | `mirror` :251 | **earlier** |
| `Polygon` :98 | `…/labs/tile-clip-sockets/merged.py` | planar union `AmbiguousContact` :99 | planar ∪ cylinder :127 | **earlier** |
| `Location` :50 | `cad-project-017/cutter.py` | `import_step` (`blade.py:23`) | same | yes |
| `Location` :18 | `cad-project-017/mount.py` | `import_step` (`blade.py:23`) | same | yes |
| `Location` :16 | `cad-project-017/servo.py` | `import_step` (`blade.py:23`) | same | yes |
| `Rot` :102 | `…/skills/cad-khana/references/examples/pin_hinge/assembly.py` | pierce through both clevis arms :105 | same | yes |
| `Rot` :160 | `bb-mfg/coupons.py` | cad_khana `inspect()` :149 | same | yes |
| `Rot` :181 | `cad-project-013/sanding_head.py` | Boolean refusal :359 (1 + 9 operands; build123d fails too) | same | yes |
| `Shape.edges` :40 | `cad-project-003/kalibrier.py` | `chamfer` :40 | `fillet`/`chamfer` | yes |
| `Shape.edges` :72 | `cad-project-026/plate.py` | `fillet` :75 | `fillet`/`chamfer` | yes |
| `Shape.edges` :176 | `cad-project-033/case.py` | `fillet` :179 | `fillet`/`chamfer` | yes |
| `Part` :55 | `cad-project-017/base.py` | `fillet` :24 | `fillet` | yes |
| `Part` :38 | `cad-project-017/extruder_stub.py` | `fillet` :16 | `fillet` | yes |
| `Plane.XY` :38 | `bb-mfg/preload-audit/…/experiments/lateral_preload.py` | `offset` :70 | `offset` | yes |
| `Plane.XY` :23 | `bb-mfg/preload-audit/d1c92576002d/preload_family.py` | timeout 180 s (Booleans) | `Edge.make_spline` | **timeout** |
| `Polyline` :304 | `cad-project-013/camera_mount.py` | timeout 180 s (Booleans) | `chamfer` :346 | **timeout** |
| `Polyline` :90 | `cad-project-013/camera_mount_assembly.py` | timeout 180 s (loads `camera_mount.py`) | `chamfer` | **timeout** |
| `import_step` :47 | `cad-project-048/mount.py` | `import_step` :47 (policy) | same | yes (unchanged) |
| `import_step` :10 | `cad-project-041/archiv/…/retrofit-mgn9h/build_p10_mgn9h.py` | `import_step` :10 (policy) | same | yes (unchanged) |
| `Plane.XZ` :105 | `cad-project-026/bar.py` | planar union `AmbiguousContact` :115 | blind cylinder cut :122 | **earlier** |
| `Circle` :559 | `cad-project-003/project-component-abeb2fd3.py` | planar subtraction `AmbiguousContact` :544 (W2 regression) | `Circle + Polygon` :559 | **earlier** (plan gap with the committed kernel) |
| `Cone` :31 | `cad-project-003/overnight-2026-09-05/design-review/lego_test_helpers.py` | Boolean refusal :30 (cylinder ∪ cone) | same | yes |
| `RegularPolygon` :152 | `cad-project-013/sanding_pad_sprung.py` | `loft` :162 | same | yes |
| `Solid.make_box` :10 | `cad-project-041/single-step-r10/jobs/endstop/geometry.py` | Boolean refusal :14 (planar ∪ cylinder) | same | yes |
| `Spline` :58 | `cad-project-047/ei.py` | `Spline` :58, now naming the missing B-spline curves | same | yes (same name) |
| `Wire.make_polygon` :147 | `cad-project-041/single-step-r10/jobs/gears/geometry.py` | through hole must land in material :175 (blind cut) | same | yes |

### Why 9 files stop short of the plan

**Uncommitted W2 kernel: box minus open-top box (`project-component-abeb2fd3.py:544`).** The
tray `Pos(0,0,H/2)*Box(56, 29.44, 11.78) - Pos(0,0,1.68+10.1/2)*Box(52.64, 24.4, 10.1)`
has a coplanar top face. FeatureScript fails the same way, so the Python
frontend is not involved:

| repro | working tree (W2's F32x2 prism) | committed kernel (HEAD d866717) |
| --- | --- | --- |
| `tmp/w5b/h-report/regress/tray.fs` (`fCuboid` − `fCuboid`) | `Native planar arrangement subtraction unresolved: AmbiguousContact (stage 2, detail 7)` | builds: 46 faces, 6448.378141 mm³ |
| `tmp/w5b/h-report/regress/tray.py` | same error at line 4 | builds: 46 faces, 6448.377988 mm³ |
| `tmp/w5b/h-report/regress/snap.py` (`snap_coupon.py:47..49`: U of two boxes ∪ a disjoint box) | `Native planar arrangement union unresolved: AmbiguousContact (stage 2, detail 10)` | builds: 2 solids, 160 + 184.32 mm³ |

The committed-kernel column comes from a detached worktree of HEAD (d866717, the viewer commit after fceffef)
(`tmp/h-head-wt`, the Bend compiler linked from `.tools/`; removed after use, recipe under Follow-ups). With the current
`python/**`, `src/python.mjs` and `bin/wonky-python.mjs` copied into it,
`project-component-abeb2fd3.py` reaches `project-component-abeb2fd3.py:559:14`, `Sketch + Sketch … planar region
Boolean`. That is the plan's gap (`Circle + Polygon`). The changes in the
working tree are W2's F32x2 polygon prism (`src/kernel.mjs` `extrudeInBend`)
and the new `parallel_candidate` filter in
`kernel/ports/planar-boolean-arrangement.bend`.

**Planar arrangement unions of slanted prisms (`bar.py:115`,
`build.py:205`, `merged.py:99`).** A polygon prism with slanted side faces
unioned with a box. Task D's FeatureScript repro `tmp/w5b/d-ops/amb.fs` fails
too. The working tree gives `AmbiguousContact (stage 2)`, the committed kernel
`InvalidTopology (stage 1, detail 0)`, so both kernels refuse it. These files
never reach their planned gaps behind it (blind cut, `mirror`, planar ∪
cylinder).

**Planar region Boolean (`zusatz.py:57`, `zusatz_seite.py:60`).** `preview()`
runs before the build and makes `Sketch() + [Pos(x, y) * Circle(r), …]`, the
union of several disjoint circles. The plan's oracle trace recorded 3D
Booleans only, so it missed this 2D union. The shim refuses 2D Booleans on
purpose (task C). The `ExportSVG` on the next line and the `chamfer` and `Text`
in `build_zusatz()` are all kernel gaps too, so the file cannot build either
way.

**Timeouts (`camera_mount.py`, `camera_mount_assembly.py`,
`preload_family.py`).** All the time goes into Bend Booleans; the shim's
queries take under a second (task G's traces). With a longer budget
(`--timeout-ms 900000`, 20:49 to 20:58, 2 processes,
`tmp/w5b/h-report/long.sh`, log local development evidence):

| file | time | stop |
| --- | ---: | --- |
| `camera_mount.py` | 239 s | `camera_mount.py:287:5` `Native planar arrangement union unresolved: ResolutionLimit (stage 2, detail 20)`: `bracket += Pos(RAIL_X0,0,0) * extrude(Plane.YZ * rail_profile, RAIL_T)`, a slanted rail prism unioned into the pierced bracket; the planned `chamfer` (:346) is behind it |
| `preload_family.py` | 537 s | `preload_family.py:58:7` `Edge.make_spline … Bend has no B-spline curves (at family.py:241:19)`, the plan's gap |

`camera_mount_assembly.py` loads `camera_mount.py` and stops in the same
union. With the committed kernel all three fail within seconds with
`InvalidTopology (stage 1, detail 0)` (`camera_mount.py:267`,
`preload_family.py:58`), so the slow path is new in W2's working tree.

## Other 54 files

53 are unchanged against `w5-fix2`: same status, message, line and column.
They cover the 42 import-policy files (numpy 18, bd_warehouse 7, pytest 6,
yaml 4, hardware_refs 3, OCP 2, trimesh 1, httpx 1), 8 without a result, the
own-bug file, `sanding_head_v3.py` (through hole missing a face) and
`cad-project-003/neustart/robot.py` (timeout).

`bb-mfg/snap_coupon.py` moved from `snap_coupon.py:50:5` (`Python Boolean
operands currently require one solid each`, the W5 refusal that task E
removed) to `snap_coupon.py:49:5` (`Native planar arrangement union
unresolved: AmbiguousContact (stage 2, detail 10)`). Line 49 is the union
before it, which the working-tree kernel now refuses (`snap.py` above). This
is the W2 regression, not a Python one. With the committed kernel the file gets
past line 49 and then stops at `coupons.py:39`, `RuntimeError: Profile has
collinear or nearly collinear consecutive edges` in `latch_male()`. W2's
profile merge in the working tree targets such profiles; the working tree
never gets that far, so it is not checked here.

## STEP

Twelve small models (`tmp/w5b/h-report/step/*.py`) cover the names:
`Pos*Rot*Box`, axis-angle `Location*Cylinder`, `extrude(Polygon)`,
`extrude(Plane.XZ*RectangleRounded)`, `extrude(Plane.XY.offset*Circle, both=True)`,
`Cone(align=)`, `Solid.make_box`, `Solid.extrude(Face(Wire.make_polygon))`,
`extrude(RegularPolygon(rotation=))`, `extrude(Plane.YZ*make_face(Polyline), both=True)`,
`Part() + … - …`, and `Box − Rot(90,0,0)*Cylinder` (a through hole). Each was
built with `node bin/wonky-python.mjs <model> --python tmp/corpus/uv-python
--out tmp/w5b/h-report/step-out/<name>` and checked with
`uv run scripts/validate-step.py tmp/w5b/h-report/step-out/<name> …`: exit 0,
all 12 valid (`BRepCheck_Analyzer`, exact CurveOnSurface), and each volume was
compared with the kernel. The oracle is the real build123d 0.13.0 on the same
files (`uv run --no-project --with build123d==0.13.0 python -B
tmp/w5b/h-report/oracle.py`):

| model | solids / faces / edges / vertices (wonky STEP / build123d) | volume mm³ | Δvolume rel. | Δbbox mm |
| --- | --- | ---: | ---: | ---: |
| `rot_box` | 1/6/12/8 = | 8 | 2.1e-15 | 1.0e-14 |
| `location_cyl` | 1/3/3/2 = | 75.398224 | 3.8e-16 | 4.4e-16 |
| `polygon_prism` | 1/6/12/8 = | 23.75 | 0 | 4.5e-17 |
| `rrect_xz` | 1/10/24/16 = | 177.424778 | 9.6e-16 | no Bend bounds |
| `circle_both` | 1/3/3/2 = | 37.699112 | 3.8e-16 | 0 |
| `cone` | 1/3/3/2 = | 27.227136 | 0 | 4.4e-16 |
| `make_box` | 1/6/12/8 = | 6 | 0 | 0 |
| `wire_polygon` | 1/7/15/10 = | 54 | 1.3e-16 | 0 |
| `regular_polygon` | 1/8/18/12 = | 129.903811 | 8.8e-16 | 3.6e-15 |
| `polyline_face` | 1/7/15/10 = | 128 | 0 | 8.9e-16 |
| `rotated_hole` | 1/7/15/10 = | 874.336294 | 5.2e-16 | no Bend bounds |
| `part_union` | 1 / **88/176/88** vs 1/15/36/24 | 240 | 5.9e-16 | 0 |

"No Bend bounds" means the body JSON has no `validation.boundsMm` for that
construction, and wonky's `bounding_box()` refuses rather than inventing one
(task E). `part_union` (a plate plus a boss minus a square pocket) has the
right volume and a valid shell, but its faces are split: 88 faces where
build123d has 15. That is the known split of coplanar faces in Bend's planar
Boolean results, here larger than in earlier examples.

## Integration

The seven task outputs overlapped in `python/_b3d_core.py`, the Shape method
registry, `src/python.mjs` and the Python tests. State on the integrated tree:

| overlap | resolution |
| --- | --- |
| `2 * a` message (D changed the empty result class; E and F saw `python-shape-protocol` fail) | already resolved in the tree: build123d 0.13 itself says `Compound cannot be multiplied by int` for a Compound and `Box cannot be multiplied by int` for a Box, and the test expects that |
| `bounds` of an empty Compound (F saw `python-host-queries` fail) | already resolved: an empty shape gives build123d's zero `BoundBox` |
| `volume` came back as an `int` from the JSON bridge (G) | already resolved: `float` in `Shape.volume` and `Compound.volume` (an empty container is `0`, an `int`, as in build123d) |
| `Plane.XY * Sketch()` returned `[]` (C's note on B's `Plane.__mul__`) | it returned a `Sketch` after B's change; build123d raises. Fixed, see the next row |
| empty containers (C, D, E notes): wonky moved, listed and added `Sketch()`, `Part()`, `Compound()` and empty Boolean results where build123d fails | integrator fix, checked against build123d 0.13.0 on 31 cases (`tmp/w5b/integrate/probe2.py`, identical output): moving one is `ValueError: Cannot move an empty shape`; listing `Compound()`, `Part()` or `Sketch()`, `Plane * x` of one (build123d lists `x` first), `Compound() + x` and `empty Boolean result + x` are build123d's bare `AssertionError`; `Compound([])` lists as `[]`, and `Compound([]) + x` is a Part. New `_null` flag in `_b3d_ops.py` (no wrapped shape), `_wonky_empty_kind` hook read by `Plane.__mul__`; `copy.copy` keeps the flag |
| D's missing host op `compound` (D, E and H follow-ups) | integrator fix: `src/python.mjs` `compound` (two or more handles, all their solids unfused and unchanged, a query op that builds nothing); a group `Compound` uses it when it is needed as one shape (result, export, cad_khana `Assembly.compound`), while Booleans still distribute over the members. `Compound(children=[Box(1,1,1), Pos(5,0,0)*Box(1,1,2)])` now exports two bodies; bounding box, 24 edges, Z groups `[4, 4, 8, 4, 4]` and volume 3 equal build123d 0.13.0, and the STEP passes `validate-step.py` |
| `test/python-names.test.mjs` sentinel lists (B, C, F) | already consistent: F moved the examples to names that are still sentinels |
| docs: F wrote "Operations and containers" while D was in progress | checked against the final `_b3d_ops.py` capability errors; updated for the empty-container rules and the `compound` op |

New tests: `test/python-ops.test.mjs` "empty containers and empty Boolean
results move, iterate and add as in build123d 0.13" (frozen from the 31-case
oracle run) and "a Compound of separate shapes is one unfused result through
the host compound op"; the old test that expected the `compound` refusal is
removed. Neither change moves a corpus file: no file reaches a group export or
an empty-container placement before its kernel stop.

## Regression review 1

Verification (local development evidence, repros in
`tmp/w5b/verify-1/repro/`) found four ways the frontend returned a result that
differs from build123d 0.13 without an error. Each is fixed at its cause in
the files this workflow owns and frozen in `test/python-unify.test.mjs`
(6 tests; oracle values from `tmp/w5b/integrate-fix/reg_oracle.py`, run with
`uv run --no-project --with build123d==0.13.0`). None moves a corpus file (see
"Run").

| finding | cause | fix | evidence (wonky vs build123d 0.13.0) |
| --- | --- | --- | --- |
| **edges() and every selector after a Boolean return Bend's split edges** (high) | the host `edges` query (`src/python.mjs`) passed the Bend body's edges through, including the pieces of split coplanar faces and collinear edges; build123d's `+`, `-`, `&`, `fuse`, `cut` and `extrude` run `clean()` (ShapeUpgrade_UnifySameDomain) | `unifiedEdgeRecords`: remove every edge between two faces of one plane (OCCT tolerances 1e-7 mm, 1e-12 rad), merge partial cylinder/cone faces split along a circle, chain collinear lines and co-circular arcs at vertices of only those two edges between the same faces. Where OCCT's outcome depends on data Bend does not keep, `edges()` is a capability error: a full (seamed) cylinder or cone split into several faces, a curved face split along a line, a circle extruded with `both=True` (and every body built from it). The body, its volume and its STEP are unchanged | union 30 edges (was 84) = 30, top group 4 × 10.0 (was 12 × 5.0), longest 10.0; pocket 24 (was 92), vertical length groups [4, 4] (was [16, 12]); `part_union` 36 edges (Bend body 176) = 36 with equal Z groups; pierce, rotated pierce, stepped cylinders, split box, `both=True` triangle and rounded rectangle, exactly collinear polygon all equal. `edges_probe.py` (20 cases): 11 equal, 5 explicit refusals, 4 kernel Boolean refusals, 0 silent differences. `Cylinder(5,4) - Pos(0,0,1)*Cylinder(2,4)` (was 6 circles vs 4) and `extrude(Circle(3), -4, both=True)` (was 3 edges vs 5) now refuse |
| **RectangleRounded within ~1e-10 of the limit builds 2e-10 mm edges; its STEP is no solid** (high) | the line/arc extrusion accepted entities far below the body's own tolerance | host guard: a line/arc entity at or below the profile tolerance (`tolerance(points)`, ≥ 1e-5 mm) and, after building, any edge or arc radius of an `extrude_profile` body at or below its `validation.toleranceMm` is an UnsupportedFeatureError naming the missing 'sub-tolerance edge merge' | `RectangleRounded(10, 6, 3 - 1e-10)`: refused (build123d merges the sides into half circles, 6 faces). `3 - 1e-4` (2e-4 mm sides, body tolerance 3e-4): refused. `3 - 5e-4` (1e-3 mm sides): builds, `validate-step.py` valid, 1 solid; `3 - 1e-3` equals build123d (24 edges, 52.279483468 mm³) |
| **A near-collinear polygon vertex is merged silently** (medium) | W2's `PROFILE_MERGE.allowRegularized` (`src/kernel.mjs`, OPEN for Marc) merges it and only marks the body 'regularized' | the Python host refuses any `extrude_profile` body with `exactness: 'regularized'` and names the vertex, its deviation and the tolerance ('near-collinear profile vertex'); FeatureScript keeps W2's policy. Exactly collinear vertices still merge, as build123d's `clean()` does | `Polygon((0,0),(200,1e-4),(400,0),(400,300),(0,300))` (build123d 119999.98 mm³, 15 edges; wonky was 120000.0, 12) and the 5e-6 mm case at 4 mm: refused. `Polygon((0,0),(2,0),(4,0),(4,3),(0,3))`: 12 edges, 12 mm³ = build123d |
| **Selector ties and edge direction follow Bend's topology** (medium) | build123d takes `edges()` order and edge direction from OpenCascade's traversal, which Bend does not reproduce; the shim returned Bend's | `python/_b3d_query.py`: a ShapeList records which items are only in Bend's order among each other (all of `edges()`, set results of `-`/`&`, equal keys after `sort_by` or inside a group); indexing, `first`, `last`, `index`, `pop` and slices that pick among such items are capability errors, picks by separating keys work. `start_point`/`end_point` of open edges, `position_at` away from the midpoint (closed circles: also 0 and 1, the seam vertex), `tangent_at`, `@`, `%` are capability errors | `Box(1,2,3).edges().sort_by(Axis.Z)[0]`, `.first`, `.group_by(Axis.Z)[-1][0]`, the circle `position_at(0.25)`: refused. `.sort_by(Axis.X).sort_by(Axis.Y).sort_by(Axis.Z)[0]` and `[-1]`, the tie block `sort_by(Axis.Z)[0:4]` and a circle's `position_at(0.5)` equal build123d. Plain Python iteration order (a list comprehension indexed later) cannot be checked and stays Bend's (documented) |

`test/python-query.test.mjs` now picks edges by separating keys (the rewritten
script's output equals build123d's, `tmp/w5b/integrate-fix/q2.py`) and no
longer compares the oracle's `tangent_at` column. The user doc
([python-frontend.md](../python-frontend.md), "Queries and selectors" and
"Operations and containers") describes the unified edges, the refusals and the
profile rules. The 12 STEP artifacts were rebuilt with the fixes
(`tmp/w5b/integrate-fix/step-out`): all valid, symmetric difference 0 against
build123d, unchanged topology.

A rerun of verification's 66-case query probe
(`node tmp/w5b/verify-1/split.mjs tmp/w5b/verify-1/p_query.py`, output
`tmp/w5b/integrate-fix/p_query.wonky.txt`) against its build123d output
differs only where wonky now refuses (order- or direction-dependent picks,
`Shape.center`, the `both=True` circle) and in the printed order of whole
lists (plain iteration, documented). The circle's `CenterOf.MASS` now has float
components.

## Regression review 2

Verification round 2 (local development evidence, repros in
`tmp/w5b/verify-2/repro/`) found two more ways the frontend returned a result
that differs from build123d 0.13 without an error. Both are fixed at their
cause in the files this workflow owns and frozen in
`test/python-noise-seam.test.mjs` (4 tests; oracle values from
`tmp/w5b/integrate-fix2/reg_oracle.py`, run with `uv run --no-project --with
build123d==0.13.0`; the same script through wonky prints byte-identical JSON).
Neither moves a corpus file (see "Run").

| finding | cause | fix | evidence (wonky vs build123d 0.13.0) |
| --- | --- | --- | --- |
| **Float-noise ties in `sort_by` were picked silently** (high) | build123d does not round sort keys; keys that are mathematically equal carry OpenCascade's rounding noise there and Bend's here (a tilted extrusion's edges are exactly 1.0 and 2.0 long in build123d, 0.9999999999999994 to 2.0000000000000067 in Bend). `python/_b3d_query.py` labelled ties only for bit-equal keys | the host `edges` records carry the body's coordinate noise (`src/python.mjs` `coordinateNoise`: 1e-10 of the coordinate scale for F32x2 words, at least 4 × the kernel's incidence audit, 1e-5 of the scale for F32 words). `sort_by` makes neighbours whose keys lie within their combined slack (4 × noise + 1e-10 of the key) one tie, also when Bend computes them bit-equal (OpenCascade may not, the reverse case); `group_by` refuses a key whose rounding to `tol_digits` the noise could flip, and unroundable keys (tuples) within noise; `filter_by(Axis)` refuses an edge whose angle lies within its noise of the tolerance. Picks among ties stay capability errors, as in Regression review 1 | the four repro picks (`sort_by(SortBy.LENGTH)[-1]` of the tilted extrusion, `sort_by(SortBy.DISTANCE)[5]` of a hexagonal prism, `sort_by(Axis((0,0,0),(1,1,1)))[4]` of a moved box, `sort_by(SortBy.LENGTH)[-2:]` of a rotated box): refused. `p_brute` (7 shapes × 6 criteria × every index, 612 picks): 224 equal, 388 refused, **0 silent differences** (was 233 / 354 / 25). verify-2's query probes rerun: `p_q` 54 equal and 23 refused of 77, `p_noise` and `p_noise2` differ only in the lines that print raw keys, `p_bedges` 40 equal and 14 refused of 54, no silent difference. `Pos(0, 0, 5e-7) * Box(1, 1, 1)` `group_by(Axis.Z)` (a key on a rounding boundary) and `Rot(1e-5, 0, 0) * Box(1, 1, 1)` `filter_by(Axis.Z)` (an edge at exactly the tolerance): refused; 2e-7, 0.99e-5 and 1.01e-5 degrees equal build123d |
| **The seam of cylinder faces after a Boolean ignored the operand's rotation** (high) | Bend's Boolean results rebuild cylinder surfaces with their own reference direction, so the seam line, the end circles' seam vertex (`position_at(0)`/`(1)`) and their `center()` (the point opposite the seam) sat at +X; build123d keeps the parametrization of the operand surface the face comes from | the shape session records, per Boolean result, the angle from Bend's seam to the operand's for each full cylinder or cone face (`src/python.mjs` `seamed`, `trueSeams`): the seam of the operand face on the same surface when exactly one seam is found there, otherwise unknown. Rigid moves keep the angles and later Booleans take them from their operands. `applySeams` moves the seam line and the end circles' seam vertex in the `edges` records of a face bounded by its seam and end circles. An unknown seam flags those records (`seam: unknown`): `center()`, `position_at`, `start_point`/`end_point` refuse, while lengths, `filter_by` and keys along the cylinder axis still work. A seam that must move on a face with any other boundary, or an unknown seam on a cone, makes `edges()` a capability error. The body is unchanged | `Box(10,10,4) - Pos(2,1,0)*Rot(0,0,70)*Cylinder(1,5)`: hole seam (2.34202, 1.93969, 0) (was (3, 1, 0)), circle `position_at(0)`/`(1)` (2.34202, 1.93969, ±2), circle centers (1.65798, 0.06031, ±2) (was (1, 1, ±2)); centered, Y-axis (`Rot(90,0,0)*Rot(0,0,50)`), coaxial outer/inner, rotated sketch plane, union, moved result, second hole: all equal build123d (`tmp/w5b/integrate-fix2/p_seam.py`: 12 of 15 equal, 3 kernel Boolean refusals). `Rot(0,0,70)*Cylinder(1,4) & Rot(0,0,10)*Cylinder(1,8)` (build123d happens to take the first operand's seam; no rule wonky can rely on): lengths, Z groups and seam count equal build123d, `center()`/`position_at` of its circles and seam line refused |

Consequences for earlier results: stable multi-key sorts over bit-equal keys,
which Regression review 1 answered (`Box(1, 2, 3).edges().sort_by(Axis.X).sort_by(Axis.Y).sort_by(Axis.Z)[0]`
and `[-1]`), are now refused: OpenCascade may order such keys by rounding
noise (`Rot(0, 0, 45) * Box(2, 2, 2)` gives an X key of 1.1e-16 there, 0.0 in
Bend). `test/python-unify.test.mjs` moves these picks to its refusal test, and
`test/python-query.test.mjs` now picks by axes that separate all twelve edges
of its box. User code that compares noisy values itself (`e.center().X > 0`,
`e.length == 2`, verify-2's LOW finding) sees Bend's rounding and is not
checked (documented in [python-frontend.md](../python-frontend.md)).

## Newly building files

None, also after Regression reviews 1 and 2. `reference.mjs --label w5b` has no rows (tolerances it would apply:
STEP reference volume 0.1 % relative and bounding-box extents 0.05 mm; STL
reference 1 % and 0.2 mm). The build123d-oracle comparison of whole files has
nothing to compare either. The closest files stop at kernel limits
(`pin_hinge/assembly.py`: the pierce through both clevis arms) or at the
cad_khana `inspect()` policy (`coupons.py`).

## Tests

**Regression review 2.** `node --test test/python*.test.mjs`: **108 of 108 pass**
(development evidence kept locally), including the new
`test/python-noise-seam.test.mjs` (4) and the updated picks in
`test/python-unify.test.mjs` and `test/python-query.test.mjs`. Full
`npm test` (2026-09-24 00:41 to 00:49, load average 10 to 60, log
local development evidence): **1332 of 1336 pass** (1
skipped). The 3 failures are in a file the native bridge owns and come from
W2's kernel, which changed during the run:

| test | owner | cause |
| --- | --- | --- |
| `native-bridge-slice` `py-planar-union` (469), `py-planar-pocket` (470), `py-frame-with-tab` (471): `kernel/polygon-prism.bend:extrude: compared calls vs the profile count run`, 3 !== 2 (5 !== 3 for `frame-with-tab`, which in the full run also hit the 30 s Python budget) | W2 (`src/kernel.mjs`) and the native bridge (profile call files) | W2's uncommitted `transformInBend` (`src/kernel.mjs:209-212`, modified at 00:40:52) now re-extrudes a translated prism (`translatedPrismInputs` → `prismInBend`) instead of transforming it: one more `polygonPrism.extrude` per `Pos`, while the frozen `out/native-bridge/profile/calls/py-*.json` (2026-09-23 20:09) still expect the old count. They fail the same way run alone (development evidence kept locally); the fixtures (`Box`, `Pos`, `+`, `-`) never reach the query code this round changed |

**Regression review 1.** `node --test test/python*.test.mjs`: **104 of 104 pass**
(development evidence kept locally), including the new
`test/python-unify.test.mjs` (6) and the rewritten
`test/python-query.test.mjs` (3); `python.test.mjs:26` passes again with
W2's current kernel. Full `npm test` (23:13 to 23:27, load average up to 85,
log local development evidence): **1321 of 1322 pass**. The
one failure is in a file the native bridge owns:

| test | owner | cause |
| --- | --- | --- |
| `native-bridge-slice` `py-frame-with-tab` (463): `Python execution exceeded 30000 ms` | native bridge | load: the fixture (`Box`, `Pos`, `-`, `+` only, no query) builds through the CLI in 272 s wall for 43 s CPU at load 180. Rerun alone at 23:30 it failed with `ENOENT …/tmp/native-bridge/slice/test/py-frame-with-tab/js/guard.json` because another workflow's `npm test` used the same fixed work dir |

**Integrated tree.** `node --test test/python*.test.mjs`: 98 tests, 97 pass;
the one failure is `python.test.mjs:26` (W2's F32x2 prism, below). Full
`npm test` (21:21 to 21:34, load average 120 to 150, another workflow's full
test run at the same time, log local development evidence):
**1306 of 1309 pass**, none of the 3 failures in the Python frontend, all in
files other workflows own:

| test | owner | cause |
| --- | --- | --- |
| `native-bridge-slice` `py-frame-with-tab` (458): `Python execution exceeded 30000 ms` | native bridge | load: building the fixture (`Box`, `Pos`, `-`, `+` only) takes 2:45 wall for 30 s CPU at load 124; it passed alone at load 29 in H's run |
| `native-bridge-slice` (e) "a native/JS divergence … ends the run" (472): 2 divergence dumps instead of 1 | native bridge | the test writes to the fixed `tmp/native-bridge/slice/test`, shared with the other workflow's concurrent run; passes alone (1/1) |
| `python.test.mjs:26` (739): Python box `9`, FeatureScript box `9.000000000000002` | W2 (`src/kernel.mjs` F32x2 prism) | passes with the committed kernel (H) |

**Task H's run** (before the integration fixes): full `npm test` (2026-09-23 20:35 to 20:47, load average up to 190; another
workflow ran `npm test` at the same time): **1293 of 1296 pass**. None of the
3 failures is in the Python frontend:

| test | alone / with the committed kernel | cause |
| --- | --- | --- |
| `native-bridge-slice` `py-planar-pocket` (455) and `py-frame-with-tab` (456): `Python execution exceeded 30000 ms` | both pass when run alone (`node --test --test-name-pattern "py-planar-pocket\|py-frame-with-tab" test/native-bridge-slice.test.mjs`, load 29) | the 30 s Python timeout under load, as in W5 |
| `python.test.mjs:26` "real Python helpers, loops and measured volumes select a fully built final box" (728): the Python box has `9` where the FeatureScript box has `9.000000000000002` | passes in `tmp/h-head-wt` (HEAD d866717 kernel with the current `python/**`, `src/python.mjs` and this test file) | W2's uncommitted F32x2 polygon prism, reported by tasks A, B, D and G; the expectation belongs to W2's change |

Every other test in `test/python*.test.mjs` passes in this run, and so do the
oracle-frozen tests of the 16 names: location (Location, Rot, Plane.XY/XZ),
sketch (RectangleRounded, Polygon, Polyline, Circle, RegularPolygon,
Wire.make_polygon, Spline as a named gap), ops (Part, Cone, Solid.make_box),
query (Shape.edges) and names (import_step stays refused).

## Kernel demand for W2

Ranked by the number of files (of all 91) whose **first** stop it is in `w5b`.
"Also behind" lists files that reach it after another gap.

| # | kernel operation | first stop | files | also behind |
| ---: | --- | ---: | --- | --- |
| 1 | **Regression fix**: planar arrangement with a coplanar face or a disjoint third box, which the uncommitted F32x2 prism refuses (`AmbiguousContact`, stage 2) and HEAD (d866717) builds | 1 (2 in H's run) | `snap_coupon.py:49` (`project-component-abeb2fd3.py:544` builds again in W2's tree at the Regression review-2 rerun) | repros `tmp/w5b/h-report/regress/{tray.fs,tray.py}` build now; `snap.py` still refused (`AmbiguousContact`, stage 2, detail 10) |
| 2 | Mixed plane/cylinder Booleans: arc-edged prisms (`RectangleRounded`), planar ∪ cylinder, cylinder ∪ cone | 7 | `beam_frame.py:134`, cad-project-003 `family.py:155` and 3 × `family_snapshot.py:146/148`, `endstop/geometry.py:14`, `lego_test_helpers.py:30` | `merged.py:127`; the only remaining gap of `endstop/geometry.py` and `beam_frame.py` |
| 3 | Edge blend (fillet, chamfer) on planar and cylinder edges | 6 | `base.py`, `extruder_stub.py`, `kalibrier.py`, `plate.py`, `case.py`, `project-component-d98e059b.py` | `camera_mount.py:346` (+ assembly), `zusatz*.py` (`build_zusatz()`), `snap_coupon.py:40`; present in 19 of the 37 (plan traces) |
| 4 | Planar arrangement robustness for slanted polygon prisms ∪ boxes (`AmbiguousContact` now, `InvalidTopology` at HEAD d866717) | 3 | `bar.py:115`, `build.py:205`, `merged.py:99` | `camera_mount.py:287` (+ assembly, `ResolutionLimit` after 239 s); repro `tmp/w5b/d-ops/amb.fs` |
| 5 | Boolean speed on planar arrangements (results grow split coplanar faces) | 4 (timeouts) | `camera_mount.py`, `camera_mount_assembly.py`, `preload_family.py`, `neustart/robot.py` | traces `tmp/w5b/g-query/{camera,preload}_trace.err` |
| 6 | Blind holes and pierces through more than two faces | 3 | `gears/geometry.py:175`, `sanding_head_v3.py:255`, `pin_hinge/assembly.py:105` | `bar.py:122` |
| 7 | Planar region Boolean (2D union/difference of faces) | 3 (2 in H's run) | `zusatz.py:57`, `zusatz_seite.py:60`, `project-component-abeb2fd3.py:559` (since the Regression review-2 rerun) | |
| 7 | 2D offset | 2 | `lateral_preload.py:70`, `preload_z/coupon.py:77` | |
| 7 | Font outlines (`Text`) | 2 | `project-component-32f60153.py:49`, `kasse.py` (via `project-component-32f60153.py`) | `snap_coupon.py:42` |
| 10 | B-spline curves (`Spline`, `Edge.make_spline`) | 1 | `cad-project-047/ei.py:58` | `preload_family.py` after its Booleans |
| 10 | General loft | 1 | `sanding_pad_sprung.py:162` | |
| – | Reflection transform (`mirror`), frustum apex (`Cone(r, 0, h)`), oblique circular or line/arc extrusion | 0 | | `build.py:251` (`mirror`) |
| – | not a kernel gap: `sanding_head.py:359` (a Boolean of 1 + 9 operands that also fails in build123d with `invalid printable solids`) | 1 | | |

For the product owner (policy, unchanged from the plan): 5 files stop at
`import_step` (external geometry), `coupons.py` only at the cad_khana
`inspect()` in its build flow, and exports are recorded, not written.

## Acceptance (Regression review 2)

| criterion | result |
| --- | --- |
| each finding fixed at its cause | **pass.** Noise-aware ties, rounding and tolerance checks from the host's per-body coordinate noise (`src/python.mjs` `coordinateNoise`, `python/_b3d_query.py` `_compare`, `_rounded_key`, `_sorted`); operand seams carried through Booleans and moves and applied to the edge records (`src/python.mjs` `seamed`, `moveSeams`, `applySeams`), unknown seams refused; see "Regression review 2" |
| a regression test for each | **pass.** `test/python-noise-seam.test.mjs`: seams and separating picks against frozen build123d values, noise refusals (the four repro picks, bit-equal keys, a rounding-boundary `group_by`, a tolerance-boundary `filter_by`, tuple keys), unknown-seam refusals, and a unit test of the seam move and its refusal on a face with other boundary edges |
| rerun | Python tests 108 of 108; the repros `noise_ties.py` (refused) and `hole_seam.py`/`coax_seam.py` (all 11 lines equal build123d); `p_brute` 0 silent of 612; corpus identical for 90 of 91 files, `project-component-abeb2fd3.py` moves to its planned gap through W2's kernel change (0 builds, 78 capability, 9 frontend, 4 timeouts; `regressions []` against `w5-fix2`); `npm test` 1332 of 1336 (3 native-bridge slices, W2's translate re-extrusion against frozen profile counts) |
| docs/corpus/w5b.md updated | **pass** (intro, "Headline", "Run", "Regression review 2", "Tests", "Kernel demand", this section, "Follow-ups"); user doc [python-frontend.md](../python-frontend.md) "Queries and selectors" |

## Acceptance (Regression review 1)

| criterion | result |
| --- | --- |
| each finding fixed at its cause | **pass.** Host edge unification (`src/python.mjs` `unifiedEdgeRecords`), sub-tolerance and regularized-profile refusals (`extrude_profile`), tie labels and direction refusals (`python/_b3d_query.py`); see "Regression review 1" |
| a regression test for each | **pass.** `test/python-unify.test.mjs`: unified edges against frozen build123d values (union 30, pocket 24, …), refusals for seamed cylinder splits and `both=True` circles, sub-tolerance `RectangleRounded`, near-collinear `Polygon`, order/direction picks, and a synthetic arc-chain unit test |
| rerun | Python tests 104 of 104; corpus identical for all 91 files (0 builds, 78 capability, 9 frontend, 4 timeouts; `regressions []` against `w5-fix2`); `npm test` 1321 of 1322 (native-bridge load/shared-dir failure); 12 STEP artifacts valid and equal to build123d |
| docs/corpus/w5b.md updated | **pass** (this section, "Run", "Tests") |

## Acceptance (integration)

| criterion | result |
| --- | --- |
| conflicts between the task outputs resolved | **pass.** Four overlaps were already resolved in the tree; the empty-container semantics and D's missing `compound` host op are fixed and frozen in tests (see "Integration") |
| all Python tests | **97 of 98**; the failure is W2's F32x2 expectation (`python.test.mjs:26`) |
| corpus run `--label w5b --only .py` against `w5-fix2` | 0 builds (as planned), 78 capability, 9 frontend, 4 timeouts; identical to task H's run for all 91 files; `compare.mjs`: `newOk 0`, `regressions []` |
| newly building files against Marc's reference and the build123d oracle | **none to compare** (`reference.mjs --label w5b` has no rows) |
| `npm test`, failures of other workflows reported separately | 1306 of 1309; the 3 failures are in files of the native bridge (load, shared work dir) and W2 (F32x2) |

## Acceptance (H-corpus-report)

| criterion | result |
| --- | --- |
| 37 of 37 moved past their W5 blocker; new first blockers equal the plan's final gaps or better | **partial.** 34 of 37 moved past it. The other 3 stop at the name that is itself their final gap (`import_step` ×2 by policy, `Spline` with the B-spline message). 28 of 37 stop exactly at the plan's gap, and so does `preload_family.py` with a 900 s budget. 8 stop earlier, each at a kernel limit, none at a shim gap: the W2 working-tree regression (`project-component-abeb2fd3.py`; it reaches the plan gap with the committed kernel), planar unions of slanted prisms (`bar.py`, `build.py`, `merged.py`, `camera_mount.py` and its assembly) and the planar region Boolean the plan missed (`zusatz.py`, `zusatz_seite.py`). |
| 0 regressions among the other 54 Python files versus w5-fix2 | **53 of 54 identical.** `compare.mjs` reports `regressions []`. `snap_coupon.py` moves one line earlier (50 → 49) into the W2 working-tree regression; with the committed kernel and the current frontend it gets past line 49. It is not a Python-frontend regression. |
| npm test green apart from documented failures outside the Python frontend; `uv run scripts/validate-step.py` passes on new STEP artifacts | **pass.** 1293 of 1296 tests pass; the 3 failures are load timeouts (pass alone) and W2's F32x2 expectation (passes with the committed kernel). `validate-step.py` passes on all 12 new STEP artifacts, and they match build123d 0.13.0 in volume (≤ 2.1e-15 relative) and bounding box (≤ 1e-14 mm). |
| docs/corpus/w5b.md records the run, the per-file stops and the ranked kernel demand for W2 | **pass** (this page) |

## Follow-ups

- **W2 / native bridge, from Regression review 2:** `transformInBend` now
  re-extrudes translated prisms; regenerate
  `out/native-bridge/profile/calls/py-{planar-union,planar-pocket,frame-with-tab}.json`
  (or keep the transform call) so `test/native-bridge-slice.test.mjs` counts
  match (3 !== 2, 5 !== 3 today). `snap.py` / `snap_coupon.py:49` still stop
  at `AmbiguousContact (stage 2, detail 10)`; `tray.fs`/`tray.py` build again.
- **W2 (kernel, optional), from Regression review 2:** keeping each curved face's
  surface parametrization (its reference direction) through Booleans would let
  the host drop its seam bookkeeping and admit the refused cases (a seam that
  must move on a face with other boundary edges, unknown seams on cones).
- **Python frontend (optional), from Regression review 2:** noise ties now also refuse
  stable multi-key sorts over bit-equal keys on axis-aligned models, which
  build123d orders deterministically when OpenCascade's keys are exact; a
  proof that both sides compute a key exactly (for example exact dyadic inputs
  through exact operations) would admit them again. verify-2's LOW finding
  `Polygon((0,0),(4,0),(4,3),(1e-6,3),(0,3.5))` is refused with a misleading
  "collinear consecutive edges that reverse direction" message
  (`validatePolygon`, `src/brep.mjs`); build123d builds it (12 mm³).

- **W2 (kernel), from Regression review 1:** a 'unify same domain' operation in Bend
  (merge coplanar faces and collinear edges of Boolean results) would make the
  bodies and STEP exports match build123d's topology (`part_union`: 88 faces
  vs 15), not only the `edges()` query; together with face provenance (which
  operand face a cylinder piece came from) it would also allow the refused
  seamed-cylinder cases. A 'sub-tolerance edge merge' would admit
  `RectangleRounded` within 1e-8 of its limit, as build123d does.
- **Marc (policy):** W2's `PROFILE_MERGE.allowRegularized` (`src/kernel.mjs`,
  OPEN) now only affects FeatureScript; the Python frontend refuses regularized
  profiles.
- **Python frontend (optional):** a tie pick (`sort_by(SortBy.LENGTH)[-1]`)
  could return a proxy that answers only what all tied edges agree on (their
  common length), which build123d models use; today it is refused. `solids()`
  order after compound Booleans follows FeatureScript's `naryBoolean`, not
  OpenCascade's (no corpus file indexes it outside `import_step`).

- **W2 (kernel, first):** the working tree refuses planar arrangements that
  HEAD (d866717) builds. Repros `tmp/w5b/h-report/regress/tray.fs`
  (`node bin/wonky.mjs tmp/w5b/h-report/regress/tray.fs --feature tray --check`:
  `AmbiguousContact (stage 2, detail 7)`; HEAD (d866717): 46 faces, 6448.378141 mm³),
  `tray.py` and `snap.py` (`node bin/wonky-python.mjs <file> --python
  tmp/corpus/uv-python --check`). They block `project-component-abeb2fd3.py:544` and
  `snap_coupon.py:49`.
- **W2:** `test/python.test.mjs:26` fails only with the F32x2 prism (`9`
  vs `9.000000000000002`); update the expectation or the prism with that
  change.
- **W2:** the ranked kernel demand above; in speed terms, `camera_mount.py`
  239 s and `preload_family.py` 537 s of Booleans, and the 88-face result of
  `tmp/w5b/h-report/step/part_union.py` (build123d: 15 faces).
- **Python frontend (sketch module):** `Sketch() + [Pos(x, y) * Circle(r), …]`
  with provably disjoint circles could become an exact multi-face sketch
  without a kernel region Boolean (task C's note). That would move
  `zusatz.py`/`zusatz_seite.py` to `ExportSVG`, the plan's gap; they still
  would not build (`chamfer`, `Text` behind it).
- **Python host (optional):** the `bounds` host op refuses pierced planar
  bodies and line/arc extrusions; their exact bounds are the vertices plus the
  extreme points of the circle arcs, so no approximation is needed (task G).
- **Native bridge owner:** `test/native-bridge-slice.test.mjs` (e) shares the
  fixed work dir `tmp/native-bridge/slice/test` between concurrent runs, and
  the Python slices use a 30 s budget that fails under load.
- **Python shim:** Shape attribute assignment (`shape.label`, `shape.color`)
  is still a capability error; 9 cad_khana files do it, none reaches it yet.
- **Corpus scripts owner:** the `MIRROR_EXT` `.md` diff from the plan
  (`gears/geometry.py` reads `CONTRACT.md`, behind its Boolean stop), the
  `py-package-policy` / `py-no-result` clusters from W5 (`compare.mjs`
  still files 5 transitions as `other`), and a link to this page in
  `docs/corpus/README.md`.
- To recreate the committed-kernel comparison: `git worktree add --detach
  tmp/h-head-wt HEAD` (d866717), symlink `node_modules` and
  `.tools/bend-source-2.0.25` into it, and copy `python/`,
  `src/python.mjs` and `bin/wonky-python.mjs` over (the first Bend
  compile takes about 3 minutes).

## Status at commit (24.09.2026)

The second verification round found two high defects: silent float-noise ties in sort_by, and cylinder seams after Booleans. The last Regression review addressed both at the root, with regression tests (test/python-noise-seam.test.mjs). Its own brute-force probe reports 0 silent differences in 612 picks. No third independent verification round ran after this fix. Two low items remain: noise-level user thresholds, and a misleading reason for a 1e-6 mm polygon edge.
