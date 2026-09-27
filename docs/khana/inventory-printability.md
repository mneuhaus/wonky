# cad_khana printability: complete inventory

Workflow `khana-design`, task `inv-printability` (2026-09-24). Research only: nothing in
wonky changes. This page accounts for every public name of cad_khana's printability side,
states each algorithm with its thresholds, the JSON it writes, how each number depends on
tessellation, what goes wrong (measured and read from code), and what an exact analytic
version on wonky's B-rep (plane, cylinder, cone, sphere, torus faces) would compute
instead.

Evidence labels used throughout:

- **[C]** read from code at the cited `file:line`;
- **[M]** measured by a command recorded in section 7 (oracle runs on copies in
  `tmp/khana/oracle/printability/`, or read-only surveys of `~/Workspace/cad`);
- **[I]** inference (reasoned from code or numbers, not separately tested).

Path prefixes: `U/` = `~/Workspace/cad/cad-khana/src/cad_khana/` (upstream worktree),
`UT/` = `~/Workspace/cad/cad-khana/tests/printability/`, `SK/` =
`~/.claude/skills/cad-khana/`, `B/` = build123d 0.10.0 in the khana tool venv
(`~/.local/share/uv/tools/cad-khana/lib/python3.13/site-packages/build123d/`), `W/` =
this repository. Oracle outputs: `O/` = `W/tmp/khana/oracle/printability/`.

## 0. Provenance: three generations of the code

| gen | what | printability modules | where it runs |
| --- | --- | --- | --- |
| **G0** | installed `khana` 0.0.2 (uv tool) = upstream commit `eee0567` (cyberchitta / restlessronin, 2026-05-25), byte-identical [M] | `inspect`, `methods`, `overhangs`, `wall`, `core/tessellation` only | `~/.local/share/uv/tools/cad-khana` |
| **G1** | `22f0ad0` = G0 + 5 commits by Marc (2026-06-11: `2ac9df9` orientation/bores/min-wall location/epsilons, `f37fd6d` bridges/cantilever/pins/bore notes, `d28c493` skill, `caa01b2` voids/sharp edges/contact ratio, `22f0ad0` skill) [M: `git log`] | + `holes`, `pins`, `structure`, `orientation` | copy `O/src_g1/` |
| **G2** | G1 + uncommitted worktree changes: `floating_solids`, `sharp_rim_edges`, diagonal convexity probe (`U/printability/inspect.py`, `U/printability/structure.py`, `UT/test_structure.py` modified) [M: `git status`, `git diff`] | same modules, more warnings | copy `O/src_g2/` (identical to the worktree, `diff -r` clean [M]) |

All 175 `*-printability.json` files in Marc's projects have the 17-key G2 schema [M,
section 8], so **G2 is what Marc actually runs** (the installed G0 CLI is not his daily
loop). This inventory describes G2 and marks G0/G1 differences. Line numbers are G2
worktree lines unless marked.

G0 → G1 changed behaviour, not only added modules [C: `git diff eee0567 22f0ad0`]:
assertions got the `EPS` (G0 compared `wall >= wall_min` and `angle <= max` exactly);
`detect_overhang` switched from whole-part `_tessellate` to per-face `tessellate_tagged`
plus the bore/bridge exemption and the `+1e-6` threshold; `min_wall` (with location) was
added and `min_wall_mm` became a wrapper.

## 1. Public surface and wonky's current status

Every top-level name of every upstream printability module (AST scan
`O/names.py`, output `O/names.out` [M]). "wonky" = `W/python/cad_khana/...`.

| upstream name | kind | upstream `file:line` | semantics (one line) | wonky today |
| --- | --- | --- | --- | --- |
| `methods.FDM` | frozen dataclass | `U/printability/methods.py:6-10` | print settings `up_axis=(0,0,1)`, `wall_min_mm=1.5`, `overhang_max_deg=45.0` | **provided**, identical fields (`printability/methods.py:10-14`) |
| `inspect.inspect(part, *, method, out="outputs", name="part")` | function | `U/printability/inspect.py:84-156` | run all checks, write `<name>-printability.json`, `SystemExit(1)` if an assertion failed | `checked_call` (`printability/inspect.py:12`): refused, or recorded not-run with `--khana-checks=skip` |
| `inspect.PrintabilityDiagnostics` | frozen dataclass | `inspect.py:32-50` | the JSON record (17 fields) | `refused_type` (`inspect.py:11`) |
| `inspect.EPS` | const `1e-6` | `inspect.py:28` | tolerance of both assertions | provided (`inspect.py:5`) |
| `inspect._wall_assertion`, `_overhang_assertion` | private fn | `inspect.py:53-63`, `:66-81` | build `AssertionResult`s | absent → `AttributeError` (`_wonky.py:148-149`) |
| `wall.min_wall(part)` | function | `U/printability/wall.py:28-36` | `(thickness, triangle-centroid)` of the worst inward ray, or `None` | `refused_call` (`wall.py:11`) |
| `wall.min_wall_mm(part)` | function | `wall.py:39-41` | the thickness only | `refused_call` (`wall.py:12`) |
| `wall.RAY_OFFSET_MM` | const `1e-4` | `wall.py:7` | ray start inside the surface | provided (`wall.py:5`) |
| `wall.SLIVER_HIT_DISTANCE_MM` | const `0.05` | `wall.py:8` | hits closer than this are ignored | provided (`wall.py:6`) |
| `wall._wall_thickness_at` | private fn | `wall.py:11-25` | one ray | absent |
| `overhangs.detect_overhang(part, *, up_axis=(0,0,1), angle_threshold_deg=45.0)` | function | `U/printability/overhangs.py:46-69` | `Overhang(area, max angle)` of flagged triangles, or `None` | `refused_call` (`overhangs.py:11`) |
| `overhangs.Overhang` | frozen dataclass | `overhangs.py:14-17` | `area_mm2`, `max_angle_deg` | `refused_type` (`overhangs.py:10`) |
| `overhangs.BUILD_PLATE_EPSILON_MM` | const `1e-3` | `overhangs.py:11` | plate-face centroid tolerance | provided (`overhangs.py:5`) |
| `overhangs._overhang_angle_deg`, `_build_plate_level`, `_on_build_plate` | private fn | `overhangs.py:20-22`, `:25-37`, `:40-43` | angle, plate height, plate-face test | absent |
| `holes.detect_bores(part, up_axis=(0,0,1))` | function | `U/printability/holes.py:164-236` | concave cylinders, deduped, classified vertical/horizontal/slanted with notes | `refused_call` (`holes.py:20`) |
| `holes.Bore` | frozen dataclass | `holes.py:46-51` | `diameter_mm`, `at`, `axis`, `note` | `refused_type` (`holes.py:15`) |
| `holes.FaceTag` | frozen dataclass | `holes.py:54-61` | per-face tag: bore diameter, planar normal, face bbox | `refused_type` (`holes.py:16`) |
| `holes.bore_face_radius(face)` | function | `holes.py:64-76` | radius if the cylinder face is concave, else `None` | `refused_call` (`holes.py:17`) |
| `holes.tessellate_tagged(part)` | function | `holes.py:79-105` | per-face tessellation with `FaceTag` | `refused_call` (`holes.py:18`) |
| `holes.self_supporting(tag, up, part)` | function | `holes.py:129-152` | `"bore"`, `"bridge"` or `None` | `refused_call` (`holes.py:19`) |
| `holes.VERTICAL_DOT` `0.99`, `HORIZONTAL_DOT` `0.1`, `SMALL_BORE_MM` `12.0`, `BRIDGE_MAX_MM` `10.0`, `CEILING_DOT` `0.985`, `PLATE_TOUCH_MM` `0.3` | consts | `holes.py:38-43` | see section 3 | provided (`holes.py:5-10`) |
| `holes._horizontal_span_dir`, `_axis_label` | private fn | `holes.py:108-126`, `:155-161` | bridge span, axis label | absent |
| `pins.detect_pins(part)` | function | `U/printability/pins.py:33-91` | convex full cylinders below Ø2 or L/D ≥ 8 | `refused_call` (`pins.py:13`) |
| `pins.Pin` | frozen dataclass | `pins.py:25-30` | `diameter_mm`, `length_mm`, `at`, `note` | `refused_type` (`pins.py:12`) |
| `pins.MIN_PIN_DIA_MM` `2.0`, `SLENDER_RATIO` `8.0`, `FULL_SWEEP_RAD` `5.2` | consts | `pins.py:20-22` | see section 3 | provided (`pins.py:5-7`) |
| `structure.enclosed_voids(part)` | function | `U/printability/structure.py:39-41` | number of inner shells | `refused_call` (`structure.py:13`) |
| `structure.floating_solids(part)` | function (G2 only) | `structure.py:44-48` | `(count, volume)` of solids beyond the largest | `refused_call` (`structure.py:14`) |
| `structure.sharp_vertical_edges(part, up_axis)` | function | `structure.py:84-97` | `(count, length)` of convex sharp vertical line edges | `refused_call` (`structure.py:15`) |
| `structure.sharp_rim_edges(part, up_axis)` | function (G2 only) | `structure.py:103-116` | `(count, length)` of convex sharp horizontal/vertical junctions | `refused_call` (`structure.py:16`) |
| `structure._convex_sharp_line_edges` | private generator (G2) | `structure.py:51-81` | shared edge filter | absent |
| `structure.VERTICAL_DOT` `0.99`, `SHARP_INTERIOR_DEG` `91.0`, `MIN_EDGE_LEN_MM` `2.0`, `HORIZONTAL_DOT` `0.95` | consts | `structure.py:34-36`, `:100` | see section 3 | provided (`structure.py:5-8`) |
| `orientation.suggest_orientation(part, *, name="part", out="outputs", overhang_max_deg=45.0)` | function | `U/printability/orientation.py:107-138` | rank six up axes, write `<name>-orientation.json`, return tuple | `refused_call` (`orientation.py:12`) |
| `orientation.score_orientation(part, up_axis, *, overhang_max_deg=45.0, triangles=None)` | function | `orientation.py:57-104` | one `OrientationScore` | `refused_call` (`orientation.py:11`) |
| `orientation.OrientationScore` | frozen dataclass | `orientation.py:43-54` | 8 fields (section 6.2) | `refused_type` (`orientation.py:10`) |
| `orientation.CANDIDATES` | const tuple (6 unit axes) | `orientation.py:32-39` | candidate up axes | **missing**: falls to `module_getattr` → capability error on access (`_wonky.py:153`) |
| `orientation.PLATE_TOL_MM` | const `1e-3` | `orientation.py:40` | plate-contact height tolerance | provided (`orientation.py:5`) |
| `core.tessellation._tessellate(part)` | private fn | `U/core/tessellation.py:28-32` | whole-part triangles | `refused_call` (`core/tessellation.py:13`) |
| `core.tessellation._triangle(a, b, c)` | private fn | `tessellation.py:18-25` | centroid, unit normal, area | `refused_call` (`core/tessellation.py:12`) |
| `core.tessellation.Triangle` | frozen dataclass | `tessellation.py:11-15` | `centroid`, `normal`, `area` | `refused_type` (`core/tessellation.py:11`) |
| `core.tessellation.TESSELLATION_TOLERANCE_MM` `0.1`, `TESSELLATION_ANGULAR_TOLERANCE` `0.3` | consts | `tessellation.py:7-8` | mesh settings (the first is **relative**, section 4) | provided (`core/tessellation.py:5-6`) |

Shared names the printability side uses (owned by other inventories, listed for
completeness): `mechanism.diagnostics.SCHEMA_VERSION = "0.2"` (`U/mechanism/diagnostics.py:12`),
`AssertionResult(name, passed, detail)` (`:43-46`), `BBox(min, max)` (`:17-19`), `_bbox`
(`:65-70`); `_paths.resolve_out` (`U/_paths.py:9-25`); `diff.diff` printability branch
(`U/diff.py:22-23`, `:191-246`).

"Import-through" names: upstream modules re-export what they import (for example
`from cad_khana.printability.inspect import FDM` works upstream because `inspect.py:17`
imports it; likewise `detect_bores`, `Overhang`, `min_wall`, `Triangle`, `Vector`, OCP
classes). In wonky such an access hits `module_getattr` and is a capability error
(`_wonky.py:139-155`), not the object [C]. No corpus file relies on this [I from the
census in `W/docs/python-khana.md:241-246`, which lists only direct names].

Which names real code uses [M: grep over `~/Workspace/cad`, excluding the cad-khana repo]:
only `inspect` and `FDM`, plus `suggest_orientation` in `cad-project-026/assembly.py:21,79`.
The other refused names (`detect_overhang`, `detect_bores`, `detect_pins`,
`enclosed_voids`, `sharp_vertical_edges`) appear only in cad-khana's own tests
(`W/docs/python-khana.md:241-246`).

## 2. `inspect()` step by step

`U/printability/inspect.py:84-156` [C]:

1. `out_path = resolve_out(out)`; `mkdir(parents=True, exist_ok=True)` (`:91-92`).
   Relative `out` is anchored at `sys.modules["__main__"].__file__`'s directory
   (`U/_paths.py:19-25`).
2. `min_wall(part)` → `(wall, wall_at)` or `(None, None)` (`:93-94`).
3. `detect_overhang(part, up_axis=method.up_axis, angle_threshold_deg=method.overhang_max_deg)` (`:95-99`).
4. Two assertions, always both, in this order (`:100-103`):
   - `wall_min:<wall_min_mm>` passes iff `wall >= wall_min_mm - EPS`; `wall is None` fails
     with detail `"min wall could not be computed"` (`:53-63`).
   - `overhang_max:<overhang_max_deg>` passes iff `overhang is None` or
     `max_angle_deg <= overhang_max_deg + EPS` (`:66-81`). Because `detect_overhang` only
     returns triangles above `threshold + 1e-6`, with the same threshold a non-`None`
     overhang always fails; the `EPS` only matters if the thresholds differed [I].
   - The assertion names embed Python's float `repr` (`wall_min:1.5`, `overhang_max:91`
     when an int was passed, `wall_min:0.27999999999999997` [M, section 8]).
5. Warnings, advisory, in this order (`:104-131`): floating solids (G2), enclosed voids,
   sharp vertical edges, undeburred rim edges (G2). Each is a formatted English string.
6. `failed = any(not passed)`; `com = part.center()` (build123d `CenterOf.MASS` for
   solids/compounds, `B/topology/three_d.py:178`, `B/topology/composite.py:563`).
7. Build `PrintabilityDiagnostics` (`:134-150`); **`detect_bores(part, method.up_axis)` and
   `detect_pins(part)` run here**, after the assertions, and never influence `status`.
   `method` is recorded as `type(method).__name__` (duck typing: any object with the three
   attributes works) [C].
8. Write `json.dumps(asdict(diagnostics), indent=2) + "\n"` to `<out>/<name>-printability.json` (`:151-153`).
9. If failed: `raise SystemExit(1)` **after** writing (`:154-155`); else return the dataclass.

Consequences [C/I]: every call fully recomputes (no caching besides OCCT's triangulation
cache on the shape); the JSON is written even on failure; `SystemExit` escapes
`except Exception`, which is why Marc's scripts catch it explicitly
(`cad-project-003/overnight-2026-09-05/family.py:340-343`, recorded in the worklog of this
task).

## 3. Every threshold and default

| constant | value | `file:line` | used by | meaning |
| --- | --- | --- | --- | --- |
| `FDM.up_axis` | `(0, 0, 1)` | `methods.py:8` | overhang, bores, sharp edges, rims | print "up" in part coordinates |
| `FDM.wall_min_mm` | `1.5` | `methods.py:9` | wall assertion | ≈ 3 perimeters at 0.4 mm nozzle (`SK/SKILL.md:567-572`) |
| `FDM.overhang_max_deg` | `45.0` | `methods.py:10` | overhang assertion and flagging | PLA rule of thumb (`SK/SKILL.md:573-578`) |
| `EPS` | `1e-6` | `inspect.py:28` | both assertions (`:57`, `:72`) | "design intent lands exactly on thresholds" |
| overhang flag epsilon | `+1e-6` (literal) | `overhangs.py:61`, `orientation.py:88` | triangle flagging | 45° planar chamfers must not flag |
| `TESSELLATION_TOLERANCE_MM` | `0.1` (**relative**, not mm) | `core/tessellation.py:7` | `_tessellate`, `tessellate_tagged` | `BRepMesh_IncrementalMesh(shape, 0.1, isRelative=True, 0.3, parallel=True)` (`B/topology/shape_core.py:1472-1475`) |
| `TESSELLATION_ANGULAR_TOLERANCE` | `0.3` rad | `core/tessellation.py:8` | same | max angle between adjacent facet normals |
| `RAY_OFFSET_MM` | `1e-4` | `wall.py:7` | wall ray start and result (`+1e-4`) | |
| `SLIVER_HIT_DISTANCE_MM` | `0.05` | `wall.py:8` | wall hit filter (`wall.py:23`) | ignore hits closer than 50 µm |
| ray intersection tolerance | `1e-6` | `B/geometry.py:89` (`TOLERANCE`), `B/topology/two_d.py:234-251` | wall | `BRepIntCurveSurface_Inter` on an **infinite** line (`gce_MakeLin`) |
| `BUILD_PLATE_EPSILON_MM` | `1e-3` | `overhangs.py:11` | `_on_build_plate` (`:41`) | centroid height tolerance |
| plate-face normal | `normal·up < -0.999` (≈ 2.56°) | `overhangs.py:42` | `_on_build_plate` | |
| `holes.VERTICAL_DOT` | `0.99` (≈ 8.1°) | `holes.py:38` | `_axis_label` (`:157`) | bore axis vertical |
| `holes.HORIZONTAL_DOT` | `0.1` (≈ 84.3° from up) | `holes.py:39` | `_axis_label` (`:159`) | bore axis horizontal |
| `SMALL_BORE_MM` | `12.0` (diameter, `<=`) | `holes.py:40` | exemption (`:136`), notes (`:204`, `:211`) | sag/undersize matters; ceilings self-bridge |
| `BRIDGE_MAX_MM` | `10.0` (span, `<=`) | `holes.py:41` | `self_supporting` (`:144`) | flat bridges print reliably |
| `CEILING_DOT` | `0.985` (≈ 9.9° from horizontal) | `holes.py:42` | `self_supporting` (`:141`) | face counts as a flat ceiling |
| anchor probe offsets | `0.5` mm below, `span/2 + 0.5` sideways | `holes.py:147`, `:149` | `self_supporting` | material test at both span ends |
| `PLATE_TOUCH_MM` | `0.3` | `holes.py:43` | elephant-foot note (`:223`) | bore starts on the plate |
| bore degeneracy | radial length `< 1e-9` | `holes.py:72` | `bore_face_radius` | |
| dedupe rounding | direction 3 decimals, axis foot 1 decimal (0.1 mm), radius 2 decimals | `holes.py:189-197`, `pins.py:48-56` | bores, pins | split faces of one cylinder counted once |
| `MIN_PIN_DIA_MM` | `2.0` (`<`) | `pins.py:20` | pin note (`:71`) | |
| `SLENDER_RATIO` | `8.0` (`L/D >=`) | `pins.py:21` | pin note (`:76`) | |
| `FULL_SWEEP_RAD` | `5.2` rad (≈ 298°) | `pins.py:22` | pin filter (`:40`) | fillet strips are partial sweeps |
| `structure.VERTICAL_DOT` | `0.99` | `structure.py:34` | `sharp_vertical_edges` (`:93`) | edge direction vs up |
| `SHARP_INTERIOR_DEG` | `91.0` | `structure.py:35` | `_convex_sharp_line_edges` (`:69`) | right angles and sharper |
| `MIN_EDGE_LEN_MM` | `2.0` | `structure.py:36` | same (`:60`) | ignore micro edges |
| convexity probe distance | `0.2` mm | `structure.py:75`, `:78` | same | bisector + diagonal probes (G2); G1 bisector only |
| `structure.HORIZONTAL_DOT` | `0.95` | `structure.py:100` | `sharp_rim_edges` (`:112`) | one face `|n·up| <= 0.05`, the other `>= 0.95` |
| `is_inside` tolerance | `1e-6`, **on-face counts as inside** | `B/topology/three_d.py:423-440` | bridge anchors, convexity probes | `BRepClass3d_SolidClassifier` |
| `CANDIDATES` | `±X, ±Y, ±Z` | `orientation.py:32-39` | `suggest_orientation` | |
| `PLATE_TOL_MM` | `1e-3` | `orientation.py:40` | plate contact (`:85`) | |
| plate-contact normal | `downward > 1 - 1e-9` | `orientation.py:85` | plate contact | |
| footprint floor | `1e-9` | `orientation.py:102` | `contact_vs_footprint` | |
| ranking key | `(round(support, 1), risky_bores, height)` | `orientation.py:122` | sort | ties keep `CANDIDATES` order (stable sort) |
| `SCHEMA_VERSION` | `"0.2"` | `U/mechanism/diagnostics.py:12` | printability JSON | orientation JSON has none |

## 4. Tessellation: the common approximation

`core/tessellation.py:28-32` [C]: `part.tessellate(0.1, 0.3)` → build123d
`Shape.tessellate` (`B/topology/shape_core.py:1899-1939`) calls `Shape.mesh`
(`:1459-1475`): `if not BRepTools.Triangulation_s(shape, 0.1): BRepMesh_IncrementalMesh(shape, 0.1, True, 0.3, True)`.

- The third argument `True` is `isRelative`: the linear deflection is 0.1 × the size of
  each edge/face, not 0.1 mm. The name `TESSELLATION_TOLERANCE_MM` is misleading [C].
  In practice the 0.3 rad angular limit decides curved faces [I, consistent with the
  measured triangle counts: 164 triangles for a Ø10 × 20 cylinder].
- The triangulation is cached on the `TopoDS_Shape` and reused if its deflection is
  ≤ the request [C: `BRepTools.Triangulation_s`]. A second call on the same object reuses
  it; the oracle builds fresh shapes for each setting for that reason (`O/oracle.py:95-96`).
- Triangle normal = normalized `(b-a) × (c-a)` with the OCCT winding flipped for
  `REVERSED` faces (`shape_core.py:1917-1939`), so it is outward; zero-area triangles keep
  a zero normal (`tessellation.py:19-24`).
- `min_wall` uses the whole-part triangles (`wall.py:32`); overhang and orientation use
  per-face `face.tessellate(...)` (`holes.py:99-101`), which reuses the same cached
  per-face triangulation [I].
- Every curved-face triangle lies inside the true surface by up to the chord sagitta
  (convex faces: inside the material; concave faces: inside the hole). Its normal is the
  chord-plane normal, tilted by up to about half the angular step (≤ 0.15 rad ≈ 8.6°)
  against the true surface normal at the centroid [I]. Both effects drive the false
  results in section 5.

Wonky already has what an exact replacement of this layer would build on, or a
certified approximate one: the certified print mesh `printMesh(kernel, body, deviationMm,
{ tags })` (`W/src/print-mesh.mjs:7-41`, `:183-200`) states the achieved deviation from
Bend (`W/kernel/tessellate.bend:5-29`, `sagitta` `:21`, `arc_sagitta` `:145`,
`grid_bound` `:163`) and can tag triangles with face ids. It covers planes, cylinders and
cones bounded by parallels/rulings, spheres and tori bounded by parallels and meridians,
and refuses ellipse/intersection-curve edges by name (`print-mesh.mjs:40-41`).

## 5. Checks: algorithm, exemptions, failure modes, exact version

### 5.1 Minimum wall (`wall.py`)

**Algorithm [C]** (`wall.py:11-36`): for every triangle of `_tessellate(part)` with
`area > 0`: `inward = -normal`; `origin = centroid + inward·1e-4`; intersect the
infinite line `Axis(origin, inward)` with the part (`find_intersection_points`,
`B/topology/two_d.py:234-275`: `BRepIntCurveSurface_Inter` against all trimmed faces,
tolerance 1e-6, hits sorted by signed distance); keep hits with
`(hit - origin)·inward > 0.05`; thickness = `min(kept) + 1e-4`. `min_wall` returns the
smallest thickness and that triangle's centroid (`min_wall_at`); `None` if no triangle
produced a hit. There is no location for the far hit and no face id.

**What it measures.** The "ray method" of wall thickness: distance from a boundary point
along the inward normal to the next boundary crossing, sampled at triangle centroids.

**Failure modes.**

| case | result | exact | label | cause |
| --- | --- | --- | --- | --- |
| Ø10 boss / cylinder (convex) | 9.984 | 10 | [M] `boss10`, `cyl_vertical_r5` | chord centroid is inside the material by the sagitta: convex curvature under-reads (safe side) |
| Ø1.5 pin at `wall_min_mm=1.5` | 1.4977 → **assertion fails** | 1.5 → passes with `EPS` | [M] `pin_thin_1p5` | same under-read; `EPS = 1e-6` protects planar design intent only |
| bore crown 0.5 mm below top | 0.5140 / 0.5016 / 0.5006 (3 mesh levels) | 0.5 | [M] `bore_near_top` | concave curvature **over-reads** (unsafe side) |
| 0.4 mm web between two Ø10 bores | 0.4277 / 0.4031 / 0.4008 | 0.4 | [M] `web_two_bores` | over-read, and the pinch is only hit if a centroid ray passes near it |
| Ø20 bore 2 mm from a face | 2.0429 / 2.0048 / 2.0012 | 2.0 | [M] `bores_v5_h5_h20` | over-read |
| 20 mm plate with Ø60 / Ø100 through bore | **0.0746 / 0.1243** | 20 | [M] `concave-self-hit.json` | self-hit: the centroid lies inside the hole by the sagitta (> 0.05 once the bore is large), the ray re-enters the bore's own surface |
| block with Ø20 / Ø60 spherical void | 0.0508 / 0.0523 | 20 | [M] same | concave self-hit, clipped just above the 0.05 floor |
| solid sphere Ø10 | **0.49** at the pole (`[-0.35, 0, 9.96]`); 0.16 and 3.91 at finer meshes | 10 | [M] `sphere_r5`, sensitivity | degenerate pole-fan triangles whose normals are far from radial: the inward ray is nearly tangent [I] |
| cone frustum with 45° knife edge at the top rim | 0.0596 at `[5.82, -5.40, 6.0]` (rim radius 7.94 of 8) | 0 (infimum) | [M] `cone_inv_45` | at an edge with interior dihedral angle < 90° the ray thickness → 0; the reported value is wherever the nearest centroid happens to be, clipped by the 0.05 floor |
| wall thinner than 0.05 mm | `None` → `"min wall could not be computed"` | the thickness | [C] `wall.py:23`, `SK/references/printability.md:32-41` | sliver filter |
| diagonal pinch not along any face normal | over-read | smaller | [C] `SK/references/printability.md:42-45` | ray method limitation |

**Real-world signature [M, section 8]:** 30 of 175 of Marc's outputs report
`min_wall_mm < 0.1`, almost all between 0.050 and 0.054 (for example
`cad-project-046/outputs/ball_socket-printability.json` 0.0501 at `wall_min:1.5`; spherical
sockets are concave spheres). This is the `SLIVER_HIT_DISTANCE_MM` floor produced by
self-hits and knife edges, not real walls [I, supported by the probes above]. Marc
answered by lowering `wall_min_mm` to 0.01–0.05 in 17 files, which switches the check off.

**Tessellation dependence.** Entirely: sample positions, the ray directions (facet
normals, not surface normals), the sagitta offset of the start point, and the self-hit
threshold all come from the mesh. Results are not monotone under refinement (sphere:
0.49 → 0.16 → 3.91 [M]).

**Exact analytic version.** On wonky's analytic faces (`W/kernel/analytic.bend:21-26`)
the ray-method quantity is `t(p) = first positive root of the line p - s·n(p) with the
trimmed boundary`, and its infimum over each face has closed-form or certified
candidates:

- Interior critical points are **double normals**: pairs `(p, q)` on faces A, B with
  `q - p` parallel to both normals, opposite orientation, open segment inside the solid.
  For the five surface types these are closed form: plane–plane (parallel, opposed):
  plane distance; plane–cylinder: axis-to-plane distance ∓ r (the bore crown: exactly
  0.5); cylinder–cylinder with parallel axes: axis distance ∓ r1 ∓ r2 (the web: exactly
  0.4); skew axes: common perpendicular; sphere–anything: distance from the centre ∓ ρ;
  cone: through the axis/apex (quadratic); torus: through the tube-centre circle
  (circle–plane and coaxial cases closed form, otherwise a quartic → certified root
  isolation or a capability error).
- Boundary critical points lie on edges/vertices of the trimmed faces (1-D minimization
  along lines, circles, ellipses; certified).
- Every witness must be inside its trimmed face (face membership) and the segment inside
  the solid (solid classification).
- Knife edges must be reported as what they are: an edge with interior dihedral angle
  < 90° has thickness infimum 0 by geometry. An exact tool reports "knife edge E, angle
  α, length L" separately and excludes an explicit neighbourhood from the wall minimum,
  instead of returning a mesh-dependent 0.05–0.06.
- Result: `min_wall_mm` exact (or with a stated certified bound), and `min_wall_at` as a
  witness pair `(p, q)` with face ids, which makes the location unambiguous. Self-hits
  and sagitta errors cannot occur.

Kernel status: line/plane, line/cylinder, line/cone roots exist (`W/kernel/ray.bend:174`,
`:292`, `:297-310`); line/sphere and line/torus return kind 4 "unresolved"
(`ray.bend:320-325`); `ray.bend` does no trims or forward selection (`ray.bend:7-10`).
Face membership exists for planes (`W/kernel/face-classification.bend:9-11`) and trimmed
cylinders (`W/kernel/cylinder-classification.bend:10-12`); solid classification accepts
only plane and cylinder faces (`W/kernel/solid-classification.bend:145-152`). No
double-normal or body-to-body distance primitive exists yet.

### 5.2 Overhang (`overhangs.py` + exemptions in `holes.py`)

**Algorithm [C]** (`overhangs.py:46-69`): `up = normalize(up_axis)`; plate level
`min_up` = min of `corner·up` over the 8 corners of the part's axis-aligned bounding box
(`:25-37`); for every `(triangle, tag)` of `tessellate_tagged(part)` flag it iff

1. `self_supporting(tag, up, part) is None` (not an exempt bore or bridge), and
2. `angle = degrees(asin(clamp(-normal·up, 0, 1))) > threshold + 1e-6` (`:20-22`, `:61`), and
3. not `_on_build_plate`: `|centroid·up - min_up| < 1e-3` and `normal·up < -0.999` (`:40-43`).

Returns `None` if nothing flagged, else `Overhang(sum of flagged triangle areas, max
flagged angle)`. The angle is 0° for a vertical wall and 90° for a downward ceiling.

**Exemption "bore" [C]** (`holes.py:136-137`): every triangle of a cylinder face that
`bore_face_radius` calls concave with diameter ≤ 12 mm is exempt, regardless of up axis.
`bore_face_radius` (`holes.py:64-76`) probes one point, `face.center()` (the uv midpoint
for non-planar faces, `B/topology/two_d.py:1450-1480`): convex if the outward normal
there points away from the axis. Concave partial cylinders (inner fillets) are therefore
"bores" too.

**Exemption "bridge" [C]** (`holes.py:138-152`): planar faces with `-n·up >= 0.985`;
span = the smaller of the face bbox extents along two in-plane directions `u1`, `u2`
derived from a fixed seed (`(1,0,0)` unless up is nearly X, `holes.py:108-126`); if
`span <= 10`, probe two points `bbox_mid - 0.5·up ± (span/2 + 0.5)·u`; both must be
`is_inside` (on-face counts); else it is a cantilever and flags. `self_supporting` runs
per triangle, so these two probes repeat for every triangle of the face [C].

**Measured behaviour [M]** (G2, default mesh unless noted; exact values computed in
`O/oracle.py:97-105`, corrected where noted):

| part | reported area / max angle | exact (same rules) | verdict |
| --- | --- | --- | --- |
| `cube10`, `plate_1mm`, `chamfer45_bottom` (planar 45° chamfer) | none | none | correct; the `+1e-6` keeps the 45° chamfer out |
| `ell_ledge` (10×20 ledge underside) | 200 / 90 | 200 / 90 | correct |
| `slot6_bridge` / `slot20_bridge` | none / 800 / 90 | bridge exempt / 800 | correct by the rules |
| `cantilever6` (6 mm shelf, one side anchored) | 120 / 90 | 120 / 90 | correct: probe finds air |
| `cyl_horizontal_r5` (Ø10×20 lying) | 164.4 → 154.6 → 152.1; max 90 → 90 → 89.29 | band 157.08 / 90 | ±5 %, non-monotone; at fine meshes bottom triangles fall under the plate exemption |
| `sphere_r5` | 51.06 → 44.10 → 45.97; max 83.97 → 88.0 → 89.0 | cap 46.01 / 90 | −14 %..+11 % |
| `torus_R10_r3` flat | 308.9 → 281.9 → 282.0; max 90 → 87.1 → 87.9 | band 296.09 / 90 | converges to the wrong value: the plate test removes a strip along the contact circle |
| `cone_inv_45` (side exactly 45°) | **54.0 → 31.2 → 21.8; max 45.94 → 45.25 → 45.10 → fails** | nothing flagged, 45 passes | **false positive** at every mesh level: facet normals are steeper than the cone |
| countersink from below, cone exactly 45° | **28.1 / 46.1 → fails** | 45 passes | same false positive |
| `cone_inv_46` / `cone_inv_50` | 276.2 → 277.1 / 325.9 → 327.0; max 46.93 / 50.88 at default | 277.11 / 46; 326.97 / 50 | area fine, angle over-read by ~0.9° |
| `bores_v5_h5_h20` | 493.2 → 463.7; max 90 | D20 top band flagged, D5 exempt | Ø20 > 12 so its ceiling flags (by design) |
| 6 mm slot rotated 45° in plan | **491 / 90 → fails** | exempt like the axis-aligned slot | **false positive**: bbox span of a diagonal slot ≫ 6 |
| 6 mm bridge between 0.4 mm walls | **120 / 90 → fails** | a 6 mm bridge | **false positive**: the anchor probe lands 0.1 mm outside the thin wall |
| same with 2 mm walls | none | none | correct |
| ledge with r2 inner fillet at the underside | 160 (was 200) | 200 minus the fillet's non-steep part | fillet treated as a Ø4 "bore": its steep part is exempt (false negative, small) |

Real use confirms the cone/countersink problem: Marc raised the threshold to 66° and 48°
with the comments "countersink-mouth tessellation in the first 0.2 mm above the plate"
and "the 0.42 end-face deburr chamfer wraps the spine fillet arcs at up to 47 deg — <1
mm2 in the first 0.4 mm above the plate" (`~/Workspace/cad/cad-project-026/assembly.py:80-84`).
52 of 175 outputs use `overhang_max_deg` 90/91, i.e. the check disabled [M].

**Further failure modes read from code [C/I]:**

- Plate level from the axis-aligned bbox corners (`overhangs.py:25-37`; same in
  `holes.py:168-174`, `orientation.py:67-73`): for an `up_axis` that is not a coordinate
  axis the minimum over bbox corners can lie below the real part (any part whose bbox
  corner is not a point of the part, for example a cylinder), so the true bottom is not
  "on the plate" and flags [I].
- The plate exemption requires a centroid within 1 µm of the plate and a normal within
  2.56° of straight down: curved bottoms (cylinders, spheres, tori lying on the plate)
  flag almost entirely, except for whatever triangles happen to satisfy both
  (`SK/references/printability.md:92-95` states the first half).
- No support-from-below test: a downward face with material right below it still flags
  (`SK/references/printability.md:88-91`).
- The bore exemption ignores orientation and applies to any concave cylinder ≤ Ø12,
  including a large horizontal *slot* of radius ≤ 6 and inner fillets [C].
- The bridge span uses only two fixed in-plane directions and the face **bbox**: diagonal
  or L-shaped ceilings get spans larger than their real width [C, M].
- The anchor probe samples one point per side at the bbox mid-line: walls thinner than
  0.5 mm, chamfered or filleted wall tops, and ceilings whose bbox centre is not above
  the gap misclassify [C, M].
- The result is one aggregate per part: no location, no face ids
  (`SK/references/printability.md:99-101`).

**Exact analytic version.** With up `u`, outward normal `n(p)` (face `same_sense`
applied) and `c = sin θmax`, the flagged set of a face is `{p : -n(p)·u > c}` (for
`θmax >= 90` it is empty):

- **Plane:** `n` constant, so all or nothing; area = exact trimmed-face area (Green's
  theorem over line, circle and ellipse edges, closed form); max angle `asin(-n·u)`.
- **Cylinder** (axis `a`, radius `r`, `σ = +1` boss / `-1` bore): with
  `u⊥ = u - (u·a)a`, `s = |u⊥|`, `n(φ) = σ e(φ)`, the downward component is
  `-σ s cos(φ - φu)`. Flagged: one angular band of half-width `arccos(c/s)` (empty if
  `s <= c`, so vertical cylinders never flag), centred at the bottom (boss) or the top
  (bore ceiling). Area = `r ∫band (z_hi(φ) - z_lo(φ)) dφ`; with ruling, parallel and
  plane-section (ellipse) trims `z` is `α + β cos φ + γ sin φ`, so it is closed form.
  Horizontal Ø10×20: exactly `5·20·π/2 = 157.08`.
- **Cone** (half-angle `α`): downward component `A cos(φ - φu) + B` with
  `A = -σ s cos α`, `B = σ sin α (u·a)` (sign by opening direction): an exact angular
  sub-band `|φ - φc| < arccos((c - B)/|A|)`; for an axis parallel to up it is constant,
  so a 45° countersink or conical chamfer lands exactly on 45° and passes like a planar
  chamfer.
- **Sphere:** flagged set = a spherical cap of angular radius `90° - θmax` around the
  lowest (convex) or highest (concave) point; `face ∩ cap` is bounded by circles, so its
  area is closed form (Gauss–Bonnet with constant geodesic curvature of small circles).
- **Torus** (`R`, `r`): for `u` parallel to the axis the band depends only on the tube
  angle `v` and the area is closed form (`2π r (R·π/2)` = 296.09 for the oracle torus);
  for a tilted `u` the region in `(φ, v)` is a level set of a trigonometric polynomial →
  certified quadrature with a stated bound (as `W/kernel/volume.bend:5-30` does for
  sphere/torus boundary integrals) or a capability error.
- **Max angle:** exact supremum of `asin(-n·u)` over the face (interior extremum if the
  extreme generator lies inside the trim, else on the boundary).
- **Plate:** exact plate level `h0 = min_p p·u` from the analytic support function (not
  a bbox); "supported by the plate" as an explicit band `p·u - h0 <= first_layer_mm`
  cut by a plane section (`W/kernel/section.bend`), which is what Marc's waiver comments
  describe.
- **Bore exemption:** concavity from `same_sense` (no probe); full circle vs partial
  (fillet) from the summed angular extent and G1 tangency of the trims.
- **Bridge exemption:** exact minimal width of the planar ceiling region (rotating
  calipers over the convex hull of its line and arc edges), and anchoring from topology:
  the faces across the ceiling's boundary edges on both sides of the span go down into
  material. No probes, so thin walls and rotated slots work.
- Output per flagged region: face id, area, angle range, height range, reason
  (`flagged` / `bore` / `bridge` / `plate`), which enables local waivers.

### 5.3 Bores (`holes.py:detect_bores`)

**Algorithm [C]** (`holes.py:164-236`): plate level from bbox corners (`:168-174`); for
each `GeomType.CYLINDER` face: skip if `bore_face_radius(face) is None` (convex or
degenerate, `:182-183`); dedupe by `(sign-folded axis direction rounded to 3 decimals,
axis foot point of the origin rounded to 0.1 mm, radius rounded to 0.01 mm)`
(`:185-200`); classify `|axis·up| >= 0.99` vertical, `<= 0.1` horizontal, else slanted
(`:155-161`); notes:

- horizontal and Ø ≤ 12: `"ceiling sag on horizontal bore — teardrop the top or oversize by 0.1-0.2 mm if a pin/axle must fit"` (`:204-208`);
- slanted (any Ø): `"slanted bore prints elliptical/stepped"` (`:209-210`);
- vertical and Ø ≤ 12: `"vertical bores print 0.1-0.3 mm undersize (nozzle squish) — oversize or ream if a pin/axle must fit"`; plus, if the face's bbox low corner is within 0.3 mm of the plate, `"bore starts on the build plate: elephant foot pinches the first layers — chamfer the hole's bottom edge"` (`:211-227`);
- otherwise `note: null`. Notes are joined with `"; "`.

`at` = `face.center()` = the uv midpoint **on the cylinder wall**, not on the axis
(`:184`, `:231`; [M] `bores_v5_h5_h20`: `at [-2.5, 0, 15]` for a bore whose axis is
`x = 0`).

**Failure modes:** inner fillets are listed as bores [M: r2 fillet → `Ø4 horizontal`
with a sag note]; coaxial equal bores in separate walls (for example both clevis arms)
merge into one entry, and the elephant-foot note looks only at the first face kept [C:
dedupe `:198-200`, note `:216-227`]; only cylinders count (countersink cones, hexagonal
nut traps, teardrops are not bores) [C: `:177`]; `detect_bores` never fails an inspection
(`holes.py:15`). Real outputs list up to 200 bores per part, 1980 in total (vertical 1441,
horizontal 535, slanted 4) [M].

**Tessellation dependence:** none (B-rep face types and OCCT surface data) [C].

**Exact version:** the same classification is already exact on analytic data if
concavity comes from face orientation and grouping from exact coaxiality (with a stated
tolerance, or construction identity of the hole feature); report the axis segment, depth,
through/blind, all faces, and the elephant-foot test from the exact lowest point of the
bore's circle edges (`center·u - r·|u⊥|`).

### 5.4 Pins (`pins.py`)

**Algorithm [C]** (`pins.py:33-91`): for each cylinder face that is **not** a bore
(`:37-38`) and whose OCCT u-range is ≥ 5.2 rad (`:39-41`), dedupe like bores
(`:46-59`); `length` = extent of that face's bbox corners along the axis (`:61-69`);
note if Ø < 2 (`"pin below FDM minimum diameter 2.0 mm — thicken or replace with an insert"`)
and/or L/D ≥ 8 (`"slender pin (L/D x.x) wobbles while printing and snaps in use — fillet the base or shorten"`);
only pins with a note are reported, `at` = `face.center()` on the surface.

**Failure modes [M/C]:** a pin built from two half-cylinder faces is missed (each u-range
π < 5.2) [M]; a stand-alone rod Ø3×30 and the same rod lying horizontally are both flagged
slender — `detect_pins` has no up axis and does not know that the whole part is the rod
[M]; a pin split into several faces reports only the first face's length [C]; the bbox
projection over-reads the length of tilted pins [I]; real outputs contain **zero** pins
over 175 files [M].

**Tessellation dependence:** none.

**Exact version:** convex cylinders grouped by exact axis and radius, sweep summed over
all faces of the group, length from the exact axial extent of the group's edges, free
end detected topologically (a cap face whose normal is the axis), orientation-aware
notes (vertical slender pins wobble; horizontal pins print as ovals).

### 5.5 Structure advisories (`structure.py`)

| check | algorithm [C] | measured [M] | failure modes | exact version |
| --- | --- | --- | --- | --- |
| `enclosed_voids` | `sum(max(0, len(solid.shells()) - 1))` (`:39-41`) | `hollow_cube`: 1 | none known; pure topology | shell count from face connectivity; which shell is outer from the signed volume (`W/kernel/volume.bend`) |
| `floating_solids` (G2) | solids sorted by OCCT volume, count and volume of all but the largest (`:44-48`) | `two_solids`: `1 floating solid(s), 64.0 mm3` | two solids touching at a face may be one or two OCCT solids depending on the Boolean [I] | lump count (connected components) and exact volumes |
| `sharp_vertical_edges` | `_convex_sharp_line_edges` (`:51-81`): LINE edges ≥ 2 mm between exactly two PLANE faces; interior angle `180 - acos(n1·n2) <= 91`; convex iff both 0.2 mm probes `mid + 0.2·norm(n1+n2)` and (G2) `mid + 0.2·norm(n1-n2)` are outside; then `|dir·up| >= 0.99` (`:84-97`) | cube: 4 edges 40 mm; plate with five 0.8×2 mm slide ribs: 24 edges; Ø20 cylinder: 0 | noisy on intentional micro features (`SK/SKILL.md:38-41`); the probe pair is a heuristic (G1 counted the four concave cavity edges of `hollow_cube` as convex: 8 edges vs 4 in G2 [M]); micro edges < 2 mm ignored | dihedral angle and convexity from the two exact normals and the coedge orientation (`sign((n1 × n2)·t)`), no probes; extend to circle and ellipse edges |
| `sharp_rim_edges` (G2) | same generator; one face with `|n·up| <= 0.05` and the other `>= 0.95` (`:103-116`) | cube: 8 edges 80 mm; slide-rib plate: 18 edges 620 mm | cylinder rims (circle edges) never counted [M: Ø20 cylinder 0], although they are the same house-rule case | same exact predicate on line and circle edges; report per edge with location |

Warnings in real outputs [M]: "sharp vertical" in 118 of 175 files, "undeburred rim" in
149 of 175, no void or floating warnings. Warnings are free text (`inspect.py:107-131`);
`diff.py` ignores them (`U/diff.py:214-244`).

**Tessellation dependence:** none, but convexity depends on `is_inside` probes at a
fixed 0.2 mm, which fail on features smaller than that [I].

### 5.6 Orientation (`orientation.py`)

**Algorithm [C]** (`orientation.py:57-138`): `tessellate_tagged` once; for each of the
six `CANDIDATES`: plate = min bbox corner·up; footprint = product of bbox extents along
the two in-plane directions; for each triangle, `height = centroid·up - plate`,
`downward = clamp(-n·up)`:

- `downward > 1 - 1e-9` and `height <= 1e-3` → `plate_contact_mm2 += area`;
- else if `asin(downward) > overhang_max_deg + 1e-6`: exempt (`self_supporting`) →
  `self_bridging_mm2 += area`, otherwise `overhang_area_mm2 += area` and
  `support_demand_mm3 += area·height`;
- `risky_bores` = bores (`detect_bores(part, up)`) not labelled vertical;
- `contact_vs_footprint = contact / max(footprint, 1e-9)`; `height_mm` from the bbox.

Sort by `(round(support, 1), risky_bores, height)` (`:122`), write
`<name>-orientation.json` (no `schema_version`), return the tuple. Geometry is not
rotated; the user copies `best_up_axis` into `FDM(up_axis=...)` (`:14-17`).

**Measured [M]:** a sphere's six scores differ only by tessellation (support 35.2, 35.2,
35.2, 36.8, 42.7, 42.7 mm³), so the "best" axis `(1,0,0)` is mesh noise; a lying
cylinder's end-face contact is 78.247 mm² (inscribed polygon) instead of 78.54; real
winners carry support "dust" such as 0.2 mm³ (`cad-project-026` carriage) and 0.4 mm³
(`cad-project-020/.../pulley_bracket`) that the `round(…, 1)` key still ranks.
9 real orientation files exist, all with six entries of eight fields.

**Tessellation dependence:** every number except `risky_bores` and `height_mm`.

**Exact version:** `support_demand = ∫flagged (p·u - h0) dA` is a first moment of area:
closed form on planes (area × centroid height via Green's theorem), cylinder and cone
bands, sphere caps, and flat tori; `plate_contact` = exact areas of planar faces with
`n = -u` at `h0` (plus the first-layer band if adopted); exact bbox/footprint from the
support function. Exact values make symmetric orientations tie exactly, so ties can be
reported instead of broken by candidate order. Candidates can include "lay flat on
planar face F" (`u = -n_F`) and cylinder axes, not only the six world axes.

### 5.7 Mass properties and validity fields

`bbox` (optimal OCCT box, `B/topology/shape_core.py:1006-1020`), `volume_mm3`
(`part.volume`), `surface_area_mm2` (`BRepGProp.SurfaceProperties_s`,
`shape_core.py:313-319`), `center_of_mass_mm` (`CenterOf.MASS`), `is_valid`
(`BRepCheck_Analyzer`, `shape_core.py:446-452`) [C]. Exact counterparts: volume with a
stated bound exists (`W/kernel/volume.bend:5-30`, host `W/src/volume.mjs:104`
`integrateVolume`); surface area, centre of mass (first moments, same divergence-theorem
machinery) and an analytic bbox do not exist as kernel queries yet [C: grep].

## 6. JSON schemas

### 6.1 `<name>-printability.json`

Written by `json.dumps(asdict(PrintabilityDiagnostics), indent=2) + "\n"`
(`inspect.py:151-153`); key order is the dataclass order (`inspect.py:33-50`); tuples
become arrays; floats use Python `repr`.

| key | type | G0 | G1 | G2 | source |
| --- | --- | --- | --- | --- | --- |
| `schema_version` | string `"0.2"` | ✓ | ✓ | ✓ | `diagnostics.py:12` |
| `kind` | `"printability"` | ✓ | ✓ | ✓ | `diff.py:22-23` detects the kind by this key |
| `status` | `"ok"` \| `"assertion_failed"` | ✓ | ✓ | ✓ | `inspect.py:149` |
| `name` | string | ✓ | ✓ | ✓ | `name=` argument |
| `method` | string (class name, `"FDM"`) | ✓ | ✓ | ✓ | `inspect.py:136` |
| `bbox` | `{min: [x,y,z], max: [x,y,z]}` | ✓ | ✓ | ✓ | `diagnostics.py:65-70` |
| `volume_mm3` | number | ✓ | ✓ | ✓ | OCCT |
| `surface_area_mm2` | number | ✓ | ✓ | ✓ | OCCT |
| `center_of_mass_mm` | `[x,y,z]` | ✓ | ✓ | ✓ | OCCT |
| `is_valid` | bool | ✓ | ✓ | ✓ | OCCT |
| `min_wall_mm` | number \| null | ✓ | ✓ | ✓ | 5.1 |
| `min_wall_at` | `[x,y,z]` \| null (triangle centroid) | – | ✓ | ✓ | 5.1 |
| `overhang` | `{area_mm2, max_angle_deg}` \| null | ✓ | ✓ | ✓ | 5.2 |
| `bores` | `[{diameter_mm, at: [x,y,z], axis: "vertical"\|"horizontal"\|"slanted", note: string\|null}]` | – | ✓ | ✓ | 5.3 |
| `pins` | `[{diameter_mm, length_mm, at, note}]` (only flagged pins) | – | ✓ | ✓ | 5.4 |
| `warnings` | `[string]` | – | ✓ (voids, sharp vertical) | ✓ (+ floating, rim) | 5.5 |
| `assertions` | `[{name: "wall_min:<v>", passed, detail}, {name: "overhang_max:<v>", passed, detail}]` | ✓ | ✓ | ✓ | `inspect.py:53-81` |

Detail strings: `"min wall 0.4928mm below min 1.5mm"`, `"min wall could not be computed"`,
`"overhang 83.9672° exceeds max 45.0°"` [M].

Real G2 example (`O/out_g2/cube10-printability.json`, [M]):

```json
{"schema_version":"0.2","kind":"printability","status":"ok","name":"cube10","method":"FDM",
 "bbox":{"min":[-5.0,-5.0,0.0],"max":[5.0,5.0,10.0]},"volume_mm3":999.9999999999998,
 "surface_area_mm2":599.9999999999999,"center_of_mass_mm":[-3.5e-17,-1.2e-16,5.0],"is_valid":true,
 "min_wall_mm":10.0,"min_wall_at":[-5.0,-1.6666666666666665,3.333333333333333],"overhang":null,
 "bores":[],"pins":[],
 "warnings":["4 sharp vertical edge(s), 40 mm total: the nozzle decelerates at these corners every layer — fillet >= 1 mm for a fluid toolpath",
             "8 undeburred rim edge(s), 80 mm total: sharp horizontal/vertical face junctions — deburr-chamfer them (e.g. 0.42 mm) against elephant foot and sharp skin"],
 "assertions":[{"name":"wall_min:1.5","passed":true,"detail":null},{"name":"overhang_max:45.0","passed":true,"detail":null}]}
```

A full example with three bores, a failed overhang assertion and both edge warnings is
`O/out_g2/bores_v5_h5_h20-printability.json`; pins: `O/out_g2/pin_thin_1p5-printability.json`
(`{"diameter_mm":1.5,"length_mm":8.0,"at":[-0.75,9.2e-17,9.0],"note":"pin below FDM minimum diameter 2.0 mm — thicken or replace with an insert"}`);
floating solid: `O/out_g2/two_solids-printability.json`; void: `O/out_g2/hollow_cube-printability.json`.

G0 example from the installed CLI on a copy of the skill's `pin_hinge`
(`O/pin_hinge_g0/outputs/clevis-printability.json`, [M]): the same first 11 keys plus
`overhang` and `assertions`, no `min_wall_at`/`bores`/`pins`/`warnings`; clevis
`min_wall_mm 2.9999999999999996`, `overhang {area_mm2 22.69, max_angle_deg 90.0}`,
`status "assertion_failed"`; the script stopped with `SystemExit(1)` before the tang was
inspected.

### 6.2 `<name>-orientation.json`

`orientation.py:126-137`: `{"kind": "orientation", "name": <name>, "ranked": [OrientationScore...], "best_up_axis": [x,y,z]}`.
No `schema_version`, so `khana diff` cannot compare two orientation files: `_kind`
classifies any file with a `kind` key as printability (`diff.py:22-23`), and
`_require_current_schema` then raises `schema mismatch` (`diff.py:34-41`) [C].

`OrientationScore` (`orientation.py:43-54`): `up_axis` (the candidate tuple as given,
ints), `support_demand_mm3`, `overhang_area_mm2`, `self_bridging_mm2`, `risky_bores`
(int), `plate_contact_mm2`, `contact_vs_footprint` (">0.7 too sticky for auto-eject;
near 0 adhesion/tipping risk", `:52-53`), `height_mm`.

Example (`O/out_g2/slot6_bridge-orientation.json`, first entry [M]):
`{"up_axis":[0,0,1],"support_demand_mm3":0.0,"overhang_area_mm2":0.0,"self_bridging_mm2":240.0,"risky_bores":0,"plate_contact_mm2":960.0,"contact_vs_footprint":0.8,"height_mm":20.0}`, `best_up_axis [0,0,1]`.

### 6.3 How the JSON is consumed

`khana diff` (`U/diff.py:191-246`) compares `status`, `name`, `method`, `bbox`,
`volume_mm3`, `surface_area_mm2`, `center_of_mass_mm`, `is_valid`, `min_wall_mm`,
`overhang` and `assertions` (regressed/fixed/added); it ignores `min_wall_at`, `bores`,
`pins` and `warnings` [C]. Agents read the JSON directly (skill workflow
`SK/SKILL.md:628-644`).

## 7. Oracle runs (parity reference, never kernel input)

All commands ran on copies in `O/` with the khana tool's interpreter:
`uv run --no-project --python ~/.local/share/uv/tools/cad-khana/bin/python <script>`.

| run | command / script | output | markers |
| --- | --- | --- | --- |
| G2, 22 synthetic parts + tessellation sensitivity | `oracle.py g2 out_g2` | `O/out_g2/{<part>-printability.json, <part>-orientation.json, summary.json, tessellation-sensitivity.json}`, log `O/oracle-g2.log` | `O/oracle-g2.done` = `exit=0` |
| G1, same parts | `oracle.py g1 out_g1` | `O/out_g1/`, `O/oracle-g1.log` | `O/oracle-g1.done` |
| G2 probes (false positives/negatives) | `oracle2.py out_g2_probes` | `O/out_g2_probes/probes.json`, `O/oracle2.log` | `O/oracle2.done` |
| G2 concave self-hit probe | `oracle3.py` | `O/out_g2_probes/concave-self-hit.json`, `O/oracle3.log` | `O/oracle3.done` |
| G0 installed CLI | copy of `SK/references/examples/pin_hinge` | `O/pin_hinge_g0/outputs/` | – |

Correction: `O/oracle.py:104` states an exact minimum wall of 5.0 for
`bores_v5_h5_h20`; the exact value is 2.0 (Ø20 bore at x = 18 ends at x = 28, the face is
at x = 30). The measured sequence 2.043 → 2.005 → 2.001 converges to 2.0.

G2 default run, per part [M, `O/oracle-g2.log`]: `inspect` exit (`returned` or
`SystemExit(1)`), time 0.07–0.88 s per part (torus 3528 triangles: 0.88 s), orientation
0.02–0.20 s.

| part | triangles | exit | min wall | overhang | bores | pins | warnings |
| --- | ---: | --- | ---: | --- | ---: | ---: | ---: |
| cube10 | 12 | ok | 10.0 | – | 0 | 0 | 2 |
| plate_1mm | 12 | fail (wall) | 1.0 | – | 0 | 0 | 1 |
| ell_ledge | 28 | fail | 4.0 | 200 / 90 | 0 | 0 | 2 |
| slot6_bridge | 28 | ok | 10.0 | – | 0 | 0 | 2 |
| slot20_bridge | 28 | fail | 5.0 | 800 / 90 | 0 | 0 | 2 |
| cantilever6 | 20 | fail | 6.0 | 120 / 90 | 0 | 0 | 2 |
| bores_v5_h5_h20 | 528 | fail | 2.043 | 493.2 / 90 | 3 | 0 | 2 |
| boss10 | 180 | ok | 9.984 | – | 0 | 0 | 2 |
| pin_thin_1p5 | 180 | fail (wall 1.4977) | 1.498 | – | 0 | 1 | 2 |
| pin_slender_2p5x25 | 180 | ok | 2.496 | – | 0 | 1 | 2 |
| plate_fillet05 | 124 | ok | 5.0 | – | 0 | 0 | 2 |
| hollow_cube | 24 | ok | 5.0 | – | 0 | 0 | 3 |
| two_solids | 24 | ok | 4.0 | – | 0 | 0 | 3 |
| chamfer45_bottom | 20 | ok | 20.0 | – | 0 | 0 | 2 |
| cyl_horizontal_r5 | 164 | fail | 9.984 | 164.4 / 90 | 0 | 0 | 0 |
| sphere_r5 | 868 | fail | **0.493** | 51.1 / 83.97 | 0 | 0 | 0 |
| cone_inv_45 | 248 | fail | **0.060** | **54.0 / 45.94** | 0 | 0 | 0 |
| cone_inv_46 | 248 | fail | 0.059 | 276.2 / 46.93 | 0 | 0 | 0 |
| cone_inv_50 | 248 | fail | 0.057 | 325.9 / 50.88 | 0 | 0 | 0 |
| torus_R10_r3 | 3528 | fail | 5.962 | 308.9 / 90 | 0 | 0 | 0 |
| cup_wall05 | 28 | fail (wall) | 0.5 | – | 0 | 0 | 2 |
| bore_near_top | 184 | fail (wall) | 0.514 | – | 1 | 0 | 2 |

Tessellation sensitivity (relative linear deflection / angular rad → triangles; `O/out_g2/tessellation-sensitivity.json`, plus torus and web in `probes.json`) [M]:

| part | 0.1/0.3 | 0.05/0.3 | 0.01/0.1 | 0.001/0.05 | exact |
| --- | --- | --- | --- | --- | --- |
| cyl_horizontal_r5 area | 164.41 | 164.41 | 154.57 | 152.09 | 157.08 |
| sphere_r5 area / wall | 51.06 / 0.49 | 51.06 / 0.49 | 44.10 / 0.16 | 45.97 / 3.91 | 46.01 / 10 |
| cone_inv_45 area / angle | 54.01 / 45.94 | same | 31.22 / 45.25 | 21.76 / 45.10 | none / 45 |
| cone_inv_46 area | 276.24 | same | 277.03 | 277.11 | 277.11 |
| cone_inv_50 area | 325.91 | same | 326.86 | 326.95 | 326.97 |
| torus area / angle | 308.91 / 90 | – | 281.86 / 87.14 | 281.96 / 87.86 | 296.09 / 90 |
| bore_near_top wall | 0.514 | 0.514 | 0.5016 | 0.5006 | 0.5 |
| bores_v5_h5_h20 wall | 2.043 | 2.043 | 2.005 | 2.001 | 2.0 |
| web two Ø10 bores wall | 0.4277 | – | 0.4031 | 0.4008 | 0.4 |

The 0.05 relative setting changes nothing against 0.1: the angular tolerance governs [M].

G1 vs G2 differ only in warnings [M, `O/out_g1/summary.json`]: G1 lacks floating and rim
warnings, and counts cavity edges as convex (`hollow_cube` 8 sharp vertical edges vs 4).

## 8. Real-world usage (read-only survey of `~/Workspace/cad`)

`find ~/Workspace/cad -name '*-printability.json'` excluding `.venv` and `worktree`
copies: 175 files (list `O/real-printability-files.txt`), 92 in cad-project-003, 35
cad-project-013, 11 cad-project-046, 11 cad-project-020, 10 cad-project-026, others
≤ 4; dated 2026-08-02 to 2026-09-19 [M]. Aggregates (one `jq -s` over all files) [M]:

- all 175 have the 17-key G2 schema; `is_valid` true everywhere; `min_wall_mm` never null;
- status `ok` 114, `assertion_failed` 61 (failed assertions: `wall_min` 59, `overhang_max` 6);
- `overhang` non-null in only 6 files;
- `overhang_max` thresholds: 45 in 116 files, 90/91 (check disabled) in 52, 48/60.5/66 in 7;
- `wall_min` thresholds: 0.8 ×67, 1.5 ×33, 0.45 ×20, ≤ 0.05 ×17 (0.01 ×2, 0.04 ×5,
  0.05 ×10), 1.2 ×9, and 16 other values;
- `min_wall_mm` < 0.1 in 30 files (typically 0.050–0.054, the sliver floor), 0.1–0.3 in 34;
- bores: 1980 entries (vertical 1441, horizontal 535, slanted 4), max 200 in one file;
  pins: 0; warnings: sharp vertical in 118 files, undeburred rim in 149, no void/floating.

Usage patterns in source [M, grep]: `FDM(wall_min_mm=.8)` dominates (cad-project-003 family);
`overhang_max_deg=91` to disable the overhang assertion (for example
`cad-project-035/assembly.py:55-61`, `cad-project-048/assembly.py:60,66`);
`try: inspect(...) except SystemExit: status = "review"` in the cad-project-003 family
(worklog step 3); waiver comments explaining thresholds (`cad-project-026/assembly.py:69`,
`:76-84`). Reading: the checks are useful enough that Marc runs them on every build, and
noisy enough that a third of the runs switch one of them off globally [I].

## 9. Documentation drift

- `SK/references/printability.md` (identical to the upstream skill copy) describes the
  G0 algorithms: no bore or bridge exemption, no `min_wall_at`, and still says the build
  plate is the only exclusion (`:59-101`) [C].
- `SK/SKILL.md:20-56` documents G1 (bores, pins, bridges, voids, sharp vertical edges,
  contact ratio); neither skill copy mentions the G2 floating-solid and rim warnings [M:
  grep], although 149 of 175 real outputs contain rim warnings.
- `SK/SKILL.md:602-611` lists only the G0 JSON fields.
- The constant name `TESSELLATION_TOLERANCE_MM` hides that the value is relative (section 4).

## 10. wonky today

- Policy: `W/docs/python-khana.md:97-117` (refused names; printability rows `:109-110`),
  decision 12 `--khana-checks=skip` for `check()`/`inspect()` only (`:125-163`); `FDM`
  provided as plain settings (`:29`).
- Implementation: every public printability and tessellation function is a
  `refused_call`, every result type a `refused_type`, `inspect` a `checked_call`
  returning `NotRun` under skip (`W/python/cad_khana/_wonky.py:38-48`, `:113-136`); all
  numeric constants are provided with upstream values (section 1). **Gap:**
  `orientation.CANDIDATES` is missing; private helpers raise `AttributeError`
  (`_wonky.py:148-149`), which matches CPython behaviour for a missing private name.
- Corpus: 27 files import cad_khana; refused printability calls: `inspect` 20,
  `detect_overhang` 2, `detect_bores` 2, `detect_pins` 1, `enclosed_voids` 1,
  `sharp_vertical_edges` 1 (`W/docs/python-khana.md:241-246`).
- Kernel pieces reusable for an exact implementation: section 11.

## 11. Kernel primitives this area needs

| primitive | exactness required | exists in wonky? |
| --- | --- | --- |
| outward normal field `n(p)` per face with `same_sense` | exact (closed form) | surface data yes (`analytic.bend:21-35`); orientation helper in the host only (`print-mesh.mjs:52-60`) |
| exact trimmed-face area (plane, cylinder, cone closed form; sphere, torus closed form for circle-bounded regions, else certified quadrature) | exact or stated bound | no (volume uses the same Green/Stokes machinery, `volume.bend:5-30`) |
| face ∩ angular band `{-n·u > c}` and its area / first moment (∫h dA) | exact (arccos band limits, closed-form integrals) | no |
| line/sphere and line/torus roots | exact quadratic; certified quartic isolation | no: kind 4 unresolved (`ray.bend:320-325`) |
| forward ray to the first trimmed-boundary crossing | exact with face membership | roots yes (`ray.bend`), trims/forward selection no (`ray.bend:7-10`) |
| face membership for cone, sphere, torus faces | exact | planes and cylinders only (`face-classification.bend`, `cylinder-classification.bend`) |
| solid point classification for all five surfaces | exact | plane and cylinder only (`solid-classification.bend:145-152`) |
| double-normal pairs between quadric/torus faces + edge-constrained minima | closed form; certified root isolation otherwise | no |
| support function / exact plate level and bbox along any `u` | exact | no |
| plane section at height `h` (first-layer band, section spans) | exact contours | yes (`section.bend`) |
| edge dihedral angle and convexity from normals + coedge orientation | exact sign predicate | no (topology data exists) |
| shells and lumps (face connectivity), inner/outer shell via signed volume | exact topology | volume yes; connectivity queries no |
| volume, centre of mass | stated bound | volume yes (`volume.bend`, `volume.mjs:104`); COM no |
| coaxiality / equal-radius grouping of split faces | exact predicate with stated tolerance, or construction identity | no |
| minimal width of a planar region (lines + arcs) | exact | no |
| face across an edge (adjacency) | exact topology | data yes, query no |
| certified tagged print mesh (fallback and viewer overlay) | stated deviation | yes (`print-mesh.mjs:183`, `tessellate.bend`) |

## 12. Improvement ideas over cad_khana

1. **Exact per-face overhang** with angular sub-bands on cylinders and cones, caps on
   spheres and bands on tori: 45° countersinks and conical chamfers pass exactly like
   planar ones (removes the measured false positives and Marc's 48°/66° waivers).
2. **Explicit first-layer band** (`first_layer_mm`) instead of the 1 µm centroid test:
   what is within the first layer is supported by the plate; exact via a plane section.
3. **Well-posed wall thickness:** double-normal thickness (exact witnesses `p, q`, face
   ids) plus a separate **knife-edge report** (edges with dihedral < 90°). Removes the
   0.05 floor that 30 of 175 real outputs show and makes `wall_min_mm` meaningful again.
4. **Topological bridges:** exact minimal width and anchoring from adjacent faces; fixes
   rotated slots, thin walls, L-shaped ceilings.
5. **Findings with locations, not one aggregate:** every flagged region, bore, pin and
   edge with face ids and coordinates, so the viewer can highlight it and a design can
   waive it locally ("this countersink mouth is fine") instead of raising a global
   threshold (52 of 175 runs disable overhang, 17 disable wall).
6. **Exactness label per metric** (`exact` / `bounded ±e` / `approximate, deviation d`)
   following AGENTS.md and `W/src/exactness.mjs`; anything not computable exactly is a
   capability error or explicitly labelled, never a silent mesh number.
7. **Bores and pins from analytic data and construction identity:** concavity from
   `same_sense`, grouping across split faces, through/blind and depth, fillets excluded
   by tangency, orientation-aware pin notes.
8. **Edge advisories on curved edges** (cylinder rims) with exact convexity; group
   repeated micro features (slide ribs) into one finding with a count.
9. **Orientation from exact integrals:** exact ties reported, lay-flat candidates from
   planar faces and cylinder axes, per-orientation bore report; `schema_version` on
   `orientation.json` so it can be diffed.
10. **Compatible output:** keep the 17 G2 keys and the assertion names so Marc's
    `watch.py`, `khana diff` and agents keep working; add new data under new keys
    (`findings`, `exactness`, `knife_edges`), and keep `SystemExit(1)` semantics.
11. **Parity oracle as regression set:** `O/` (22 synthetic parts, probes, the 175 real
    outputs once their models build in wonky) with a documented list of intended
    differences.
12. **Record in `brep.json`:** the host records each `inspect()` result as it already
    records not-run entries (decision 12), so a build is "checked" only when the checks
    actually ran.

## 13. Open questions

- Parity or improvement: should wonky reproduce the ray-method number (with its mesh
  artifacts) for comparability, or only the well-posed exact metrics? Product decision.
- Defaults for the new parameters (`first_layer_mm`, knife-edge angle) and whether the
  heuristics `SMALL_BORE_MM = 12`, `BRIDGE_MAX_MM = 10`, `PLATE_TOUCH_MM = 0.3` stay
  fixed or become `FDM` fields (upstream `FDM` has only three fields).
- G2's floating-solid and rim checks are uncommitted upstream, but Marc's outputs show he
  runs them: treat G2 as the reference?
- Warning texts are free English strings; do consumers parse them, or can wonky switch to
  structured findings with the old strings kept for compatibility?
- Tilted-up tori and cone/torus wall pairs: certified quadrature/root isolation or
  capability errors at first?
- Where the analysis runs: AGENTS.md puts geometry in Bend; printability metrics are
  geometric queries, so they belong in `kernel/` with the host only carrying results.
- `orientation.json` without `schema_version`: add it (breaks byte parity) or not?
