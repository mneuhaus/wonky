# cad_khana tooling: inventory and the unified wonky version

Research document of the khana-design workflow (task `inv-tooling`),
2026-09-24. It inventories cad_khana's **tooling**: the `khana` CLI, Marc's
watch loop and the OCP viewer push, HLR drawings, the STL/STEP/GLB exports,
the diagnostics diff, the environment probe, the output layout and the
agent-facing skill conventions. For each item it says what wonky already has
(replaced / partial / missing) and what the unified wonky version should be.
The mechanism and printability *semantics* (assertions, diagnostics, pick,
wall, overhang, bores, orientation) are inventoried in the sibling documents
of this workflow; they appear here only where the tooling touches them.

Nothing in this document changes code. The kernel rules of `AGENTS.md` apply
to every proposal: geometry stays in Bend, OpenCascade may only validate
exported artifacts, unsupported functionality is an explicit capability
error, analytic curves are never silently polygonized.

## 0. Sources, versions and evidence

| Tag | Source | State |
| --- | --- | --- |
| `ck:` | `~/Workspace/cad/cad-khana/` (upstream checkout, read only). Module paths below are relative to `ck:src/cad_khana/`. | pyproject version 0.0.2 (`ck:pyproject.toml`); local commits plus uncommitted `mechanism/pick.py`, `cli.py`, `printability/inspect.py`, `printability/structure.py`, `skills/cad-khana/SKILL.md` (`git status`, measured) |
| `khana` | installed uv tool `~/.local/share/uv/tools/cad-khana` | 0.0.2, built from the checkout before the `pick` work: `khana pick` does not exist (exit 2) [M `tmp/khana/tooling/help.txt`] |
| tool env | same uv tool | build123d 0.10.0, bd_warehouse 0.2.0, ocp_vscode 3.4.0, ocp_tessellate 3.3.0, OCP 7.8.1, Python 3.13.3 [M `tmp/khana/tooling/status.json`, site-packages listing] |
| `skill:` | `~/.claude/skills/cad-khana/SKILL.md` (754 lines, installed copy the agent loads, Jun 11) | no `pick` |
| `ck:skills/…/SKILL.md` | upstream skill, 791 lines | adds `khana pick` (line 97) and the review loop with viewer indices (lines 119-137) |
| cad-project-043 | `~/Workspace/cad/cad-project-043/skills/cad-khana/SKILL.md` (thin entry, 2026-09-10) and `references/field-notes.md` (the old SKILL.md body, archived) | "The cad-khana runtime is a separate dependency; this repository bundles its skill knowledge, not the library." |
| `FN:` | `ck:field-notes.md` (262 lines, Marc's cad-khana paper-cuts) | read |
| `fdm-skill:` | `~/.claude/skills/cad-fdm-design/SKILL.md` and `references/watch.py` | Marc's daily loop |
| `cad:` | `~/Workspace/cad/**` (Marc's projects, read only) | |
| oracle | `tmp/khana/tooling/` in this repo: copies run with the real `khana` (never feeding the kernel) | `help.txt`, `status.json`, `diff-probe.log`, `pin_hinge/`, `probe_export/`, `probe_anim/`, `probe_cli/` |

Evidence tags: **[M]** measured (a command was run; the artifact is named),
**[R]** read in code or docs (file:line), **[I]** inference or design
proposal.

## 1. Key findings

1. **The CLI is a thin runpy dispatcher; all behavior hides in module
   toggles read inside `check()`.** `khana build|check|view|draw` run the
   script as `__main__` (`ck:cli.py:84`) and differ only by global switches
   (`cli.py:104-108`, `114-118`, `183-189`) that `check()` reads
   (`mechanism/check.py:37-60`). Consequences, all measured: a script without
   `check()` gets no view and no drawing and no message
   (`khana draw inspect_only.py`, exit 0); `khana draw` and `khana view` also
   write STL/STEP; `khana view` exits 0 when no viewer listens; an assertion
   failure ends the process with exit 1 and **no console output**, and every
   later `inspect()` never runs, leaving stale JSON (FN:13-16, 197-200).
2. **Marc's real loop is not `khana view` but `watch.py`**: 15 copies in
   `cad:` (13 projects plus cad-project-043 and a worktree; two variants) and one
   in the fdm skill that `runpy.run_path` the assembly **without**
   `run_name`, so the `__main__` guard keeps `check()`/`inspect()` out, and
   re-push the cached assembly every 5 s because the standalone OCP viewer
   keeps no state (`fdm-skill:references/watch.py:1-12, 45, 51-63`,
   FN:17-21). Diagnostics run separately (`khana check`), slicer files are a
   third manual step (`fdm-skill:SKILL.md:53-62`).
3. **The STEP export carries no part names, colors or materials** [M]:
   PRODUCT names are the generic `'ASSEMBLY'`/`'SOLID'`, solids are unnamed,
   there are 0 `COLOUR_RGB`; only the assembly tree (NAUO) survives. XCAF
   names and sRGB colors are written **only into the GLB**
   (`export.py:128-157`). The task framing "STEP with XCAF colors/names" does
   not match the code; the skill itself says colors are ignored by STEP
   (`skill:251-258`).
4. **GLB export depends on an external `gltf-transform` binary** that is not
   installed on this machine: `export_glb` raises *after* writing an
   unjoined GLB [M]; Marc's `cad-project-013/camera_mount_assembly.py:358-373`
   monkeypatches the private `_gltf_transform_join` away. Animated GLB samples
   `PlacedPart.location` per keyframe and puts one `animgroup_N` node per
   jointed sub-assembly with LINEAR (slerp) rotation channels [M]; the joint
   itself (axis, angle, limits) is not in the file.
5. **Drawings are HLR line art without dimensions or common scale**:
   build123d's exact OCCT `HLRBRep_Algo`, ten fixed views, each fitted to its
   own bounds (`draw.py:249-260`), PNG polylines with 48 samples per curve,
   SVG with exact conic arcs; unknown `--format` silently writes nothing [M].
6. **`khana diff` compares two hand-kept JSON files by exact equality**:
   float dust shows up as changes ("min_wall_mm: 3 → 3 (-0.0%)"),
   face/edge/vertex counts, `min_wall_at`, bores, pins and warnings are not
   diffed, the output is text only and the exit code is 0 on a regression
   [M `tmp/khana/tooling/diff-probe.log`].
7. **Fixed output names collide.** `mechanism.json`, `assembly.step`,
   `assembly.stl` and `views/*.png` have no script stem: Marc's
   `cad-project-026/assembly.py:68` and `scissor_assembly.py:122` both write
   `outputs/mechanism.json`; that directory holds JSON from three different
   days [M `ls -la`].
8. **wonky already replaces the viewer half better than OCP** (live server,
   rebuild on save with the import closure watched, last-good plus failure
   state, reload-safe, revisions, ghost and delta strip, exact FDM overhang
   shading, kernel wall probe, revision-bound aliases instead of per-push
   topology indices). It **lacks** drawings, GLB, named/colored/structured
   STEP, check evaluation, check diffs, a status probe and an agent skill.
   Two concrete wiring gaps: `wonky-view` does not pass `--khana-checks`,
   read-only roots or a working directory to the Python build
   (`src/viewer/live/build-worker.mjs:85-93`, `src/viewer/live/pool.mjs:333-338`),
   so a Marc `assembly.py` with `check()` in `__main__` fails in live mode,
   and the compat `Assembly._wonky_metadata()` records no joints
   (`python/cad_khana/mechanism/assembly.py:237-247`), so no animation can
   reach the viewer or an export.

## 2. The `khana` CLI

### 2.1 Execution model [R]

- Typer app `khana` (`cli.py:18-23`), `--version` eager callback
  (`cli.py:26-44`), entry point `khana = cad_khana.cli:main`
  (`ck:pyproject.toml`, `[project.scripts]`).
- `_run_script` (`cli.py:80-92`) runs `runpy.run_path(script,
  run_name="__main__")` (`cli.py:84`). `SystemExit`/`typer.Exit` pass through
  (`cli.py:85-86`); any other exception prints the traceback and
  `khana <command> failed: …` to stderr and writes an error
  `mechanism.json` (`status: "error"`, `error`, `hint` from
  `mechanism.hints.match_hint`) into `--out`, default
  `<script-dir>/outputs` (`cli.py:47-53`, `81-82`, `87-92`).
- The commands only set module-level toggles; `check()` reads them
  (`mechanism/check.py:21-26`, `37`, `50-60`). `check()` then runs in this
  order: exports (`check.py:38`) → assertion evaluation (`39-40`) →
  `mechanism.json` (`47-49`) → viewer push if `khana view` (`50-51`) → drawings
  if `khana draw` (`52-60`) → `SystemExit(1)` on any failed assertion
  (`62-63`). A failing design is therefore still exported, pushed and drawn.
  `inspect()` also ends with `SystemExit(1)` (`printability/inspect.py:155`).
- Because `SystemExit` passes through `_run_script`, a failed assertion
  produces exit 1 and nothing on stdout/stderr [M: `pin_hinge` build and
  `check_r2` logs are empty]. The first failing `check()`/`inspect()` stops the
  script; later calls never write their JSON and old files stay on disk
  (FN:13-16, 197-200, 252-253) [M: `pin_hinge` tang inspect never ran].

### 2.2 Commands and flags

`khana --help` of the installed 0.0.2 lists build, check, view, draw,
status, diff [M `help.txt`]. `pick` exists only in the checkout.

| Command | Flags | Semantics | Exit | Evidence |
| --- | --- | --- | --- | --- |
| `khana build SCRIPT` | `--out PATH` (crash diagnostics only) | run script; `check()` exports `assembly.stl` + `assembly.step`, writes JSON | 1 on exception or failed assertion | `cli.py:95-98`; [M] pin_hinge exit 1, 2.4 s |
| `khana check SCRIPT` | `--out` | as build, `_set_export_default(False)`: no STL/STEP | as build | `cli.py:101-108`; [M] only `mechanism.json` |
| `khana view SCRIPT` | `--out` | as build plus `viewer.push(assembly)` inside `check()` | **0 even when no viewer listens** (CommsWarning traceback on stderr) | `cli.py:111-118`; [M `probe_cli/cli-probe.log`] |
| `khana draw SCRIPT` | `--out`, `--views-dir PATH` (default `<out>/views`), `--format png\|svg\|both` (default png), `--themeable` (SVG classes), `--view a,b` (subset of 10), `--part NAME` | as build plus `draw.draw()` inside `check()` | unknown `--view`: 2 before the script runs; unknown `--format`: **0 with an empty `views/`** | `cli.py:121-189`, `draw.py:540-543`; [M] |
| `khana pick SCRIPT` (checkout only) | `--part NAME` (required), `--faces`, `--edges`, `--vertices` (CSV indices) | runs the script as `__khana_pick__` (main block does not run), collects every `Assembly` in the module namespace, resolves OCP-viewer topology indices on `part.moved(location)` to JSON facts | 1 if no assembly or unknown part | `cli.py:204-256`; semantics in the mechanism inventory |
| `khana status` | none | JSON environment report | 1 when degraded (viewer unreachable) | `cli.py:259-265`; [M] exit 1 |
| `khana diff BEFORE AFTER` | none | text diff of two diagnostics JSON files | 2 on kind or schema mismatch, **0 on a regression** | `cli.py:268-277`; [M `diff-probe.log`] |
| `khana --version` | | `khana 0.0.2` | 0 | `cli.py:26-29`; [M] |

The README surface (`ck:README.md:53-57`) and the design doc surface
(`ck:CLAUDE.md`, "CLI surface") list build/check/view/draw/diff only;
`status` and `pick` are documented in the skills.

### 2.3 Output paths: `_paths.resolve_out`

`resolve_out(out)` (`_paths.py:9-25`): absolute paths unchanged; relative
paths anchored to the directory of `sys.modules['__main__'].__file__` (true
for `python script.py` and `runpy.run_path(..., run_name="__main__")`), else
cwd-relative. Used by `check()` (`check.py:35`), `inspect()`
(`inspect.py:91`) and `suggest_orientation()` (`orientation.py:124`). The CLI
`--out` is a different thing: only the crash-diagnostics directory
(`cli.py:67-77`), so a crash and a normal run may write to different
directories when a script passes its own `out=`.

## 3. Marc's daily loop: `watch.py` + OCP viewer

### 3.1 The documented loop [R]

`fdm-skill:SKILL.md:40-62`: one uv project per design with `<part>.py`
(parameters, pure part functions, `__main__` export of per-part STL/STEP to
`out/`), `assembly.py` (khana `Assembly`, assertions, `suggest_orientation`,
`inspect`), `watch.py` (copied from `references/watch.py`), `out/` (slicer
files) and `outputs/` (khana JSON). Start once per session, in the
background: `uv run python -m ocp_vscode` (port 3939) and `uv run watch.py`.
Loop: edit → `uv run khana check assembly.py` → read `outputs/*.json` → the
viewer updates itself; after geometry changes **also** run `uv run <part>.py`
("khana only writes `outputs/`, the slicer files in `out/` go stale
silently"). Review (`fdm-skill:SKILL.md:64-73`): Marc selects faces/edges in
the OCP viewer (f/e/v filters), quotes part + indices, the agent resolves them
with `khana pick`; indices are per pushed snapshot.

Real projects follow it: `cad:cad-project-026/bar.py:83` (`OUT = "out"`) and
`bar.py:273-285` (main-block exports), `cad-project-026/assembly.py:67-97`
(main block: `check`, four `inspect`, one `suggest_orientation`).

### 3.2 `watch.py` [M + R]

`find ~/Workspace/cad -name 'watch*.py'` plus md5 [M]: 12 copies of a
67-line variant (hash `08441e…`, identical to
`fdm-skill:references/watch.py`; also in cad-project-043 and in an improvement
worktree) and 3 copies of an older 60-line variant (`e2f99d…`:
`cad-project-033`, `cad-project-046`, `cad-project-048`). Lines below cite the
canonical copy.

| Aspect | Behavior | Lines |
| --- | --- | --- |
| Target | `SCRIPT = argv[1]` or `assembly.py` next to watch.py (old variant: fixed `assembly.py`) | 22 |
| Change detection | tuple of `st_mtime` of every `*.py` in the script directory except `watch.py`, polled every `INTERVAL = 5.0` s; subdirectories and non-Python inputs (JSON parameters, imported STEP) are not watched | 23, 26-32 |
| Stale imports | purge `sys.modules` entries whose file lives in the project root before rerunning (old variant lacks this, so edits to sibling modules were silently ignored) | 38-44 |
| How the model loads | `runpy.run_path(str(SCRIPT))` **without `run_name`**: the module is not `__main__`, so `check()`/`inspect()` in the main block do not run | 45 |
| What is taken | `module["assembly"]` (must be a module-level name) | 46 |
| Push | `cad_khana.viewer.push(assembly)` every 5 s, changed or not (keep-alive for reloaded tabs) | 20, 51-63 |
| Failure | traceback on stdout, "push/build failed, retrying"; the previous assembly keeps being pushed, the viewer shows no failure state [I from code] | 60-62 |

What is re-run on save: the whole assembly script and (new variant) freshly
imported sibling modules. Not re-run: diagnostics, the parts' `out/`
exports. FN:17-21 names the reason ("Viewer keeps no state for reloaded
tabs … A `khana watch` subcommand would be a natural home for this").

### 3.3 What the OCP viewer receives (`viewer.py`) [R]

`push(assembly)` (`viewer.py:19-25`): `placed_parts` (the flattened tree,
`mechanism/assembly.py:317-334`) moved to world, names = placed names,
colors = `placed.color or part.color`, passed only if any is set;
`ocp_vscode.show(*parts, names=…, colors=…)`. Tessellation happens in
`ocp_vscode`/`ocp_tessellate` with their defaults (deviation 0.1, angular
tolerance 0.2 rad: tool env `ocp_vscode/show.py:784-785`). Not pushed:
sub-assembly hierarchy, materials, joints, assertion results, interference
volumes, printability results. The viewer is the OCP CAD Viewer VS Code
extension or the standalone `python -m ocp_vscode` server on port 3939
(`skill:111-142`, with a Zed task pair). `set_auto`/`auto_enabled`
(`viewer.py:10-16`) are the `khana view` toggle.

## 4. Drawings (`draw.py`) [R + M]

| Aspect | Behavior | Evidence |
| --- | --- | --- |
| Views | 10 presets: `top`, `bottom`, `front`, `back`, `right`, `left` and `iso_ne/nw/se/sw` (camera octant in +Z-up/+Y-forward space); `DEFAULT_VIEW_NAMES`, `STANDARD_VIEWS` | `draw.py:63-84`, `skill:696-702` |
| Algorithm | build123d `Drawing(compound, look_at, look_from, look_up, with_hidden=True)` = exact OCCT `HLRBRep_Algo` + `HLRBRep_HLRToShape`, orthographic | `draw.py:471-483`; tool env `build123d/exporters.py:79-112` |
| Dedup | visible and hidden edges fingerprinted (conics by center/radii, others by rounded endpoints + midpoint, 1e-4) and de-duplicated, visible wins | `draw.py:109-171` |
| PNG | 1200 px square, 2× supersampling, 6 % margin, visible black 2 px, hidden grey (170,170,170); lines 2 samples, **every curve 48 samples** | `draw.py:86-102`, `273-298` |
| SVG | circles and ellipses as exact SVG arcs (large/sweep flags classified from sample points); lines and other curves as polylines; `--themeable` adds `class="cad-visible"`/`"cad-hidden"` next to the inline stroke | `draw.py:179-236`, `301-419` |
| Framing | each view is fitted to its own 2D bounds: **no common scale across views, no scale recorded, no scale bar** | `draw.py:243-260`, `394-407` |
| Content | no dimensions, labels, view names, title block, section views, colors or part names in the image | [M] SVGs of `probe_export/outputs/views/` |
| Scope | whole assembly or `--part` (framed alone, in its assembled position) | `draw.py:422-432` |
| Output | `<out>/views/<view>.png` / `.svg`, fixed names, overwritten, no model id or timestamp | `check.py:55`, `draw.py:497`, `514` |
| Cost | 20 files (10 × png+svg) in 2.7 s on a 3-part probe | [M] `probe_export/draw.log` |
| Failure modes | unknown `--format` → nothing written, exit 0 [M]; assemblies of imported STL meshes → exit 0, no views, no error (FN:86-87) | |

The skill's reading rules (load one view, pick it by question) are in
`skill:696-727`. Programmatic use in Marc's projects: only
`cad-project-013/camera_mount_assembly.py:375-379` (four views of a
mock-up). The drawings are the agent's shape-level channel (`ck:CLAUDE.md`
"two channels"); wonky's agent channel today is the viewer's exact
selection/overview text instead (section 11, row 12).

## 5. Exports (`export.py`)

### 5.1 `export_assembly`: STL + STEP [R + M]

`export_assembly(assembly, out, stem="assembly")` (`export.py:30-41`):
`assembly.compound` (nested `Compound`, one level per sub-assembly,
`mechanism/assembly.py:336-341`) through build123d `export_stl` and
`export_step`. `check()` calls it without a stem (`check.py:38`), so the files
are always `outputs/assembly.stl` and `outputs/assembly.step`.

Measured STEP content (grep of `pin_hinge/outputs/assembly.step` and
`probe_cli/outputs/assembly.step`):

| Item | pin_hinge (3 parts) | 2-part probe |
| --- | --- | --- |
| `PRODUCT('ASSEMBLY'…)` / `PRODUCT('SOLID'…)` | 3 / 3 | 3 / 2 |
| `NEXT_ASSEMBLY_USAGE_OCCURRENCE` | 5 | 4 |
| `MANIFOLD_SOLID_BREP` names | all `''` | all `''` |
| `COLOUR_RGB` | 0 | 0 |

So names, colors and materials of `PlacedPart` are lost; only the nesting
survives. STL: binary, OCCT header ("STL Exported by Open CASCADE
Technology") [M], one mesh for the whole assembly, build123d defaults
`tolerance=1e-3`, `angular_tolerance=0.1` (tool env
`build123d/exporters3d.py:336-340`). It is not the slicer file: per-part
slicer STL/STEP come from each `<part>.py` main block (section 3.1).

### 5.2 `export_glb` [R + M]

`export_glb(assembly, out, name="assembly.glb", linear_tolerance_mm=0.1,
angular_tolerance_rad=0.5, y_up=True, draco=True, draco_level=7)`
(`export.py:88-169`):

- XCAF document; per placed part (flattened): moved to world, optionally
  pre-rotated `Rot(-90, 0, 0)` to glTF Y-up (`135`, `145-146`), meshed with
  `BRepMesh_IncrementalMesh(0.1 mm, 0.5 rad)` (`23-24`, `148-150`), label
  name = part name (`152`), surface color as sRGB (`153-157`). Materials are
  not written; no PBR (`100-104`).
- `RWGltf_CafWriter` (`159-164`), then the **mandatory** shell-out
  `gltf-transform join --keepMeshes true --keepNamed true` (`166`, `172-204`)
  and optional Draco re-encoding (lossy, default on; `167-168`, `207-218`).
  The CLI dependency is `bun install -g @gltf-transform/cli`
  (`skill:545-546`; `ck:README.md:99-117`).
- Measured: without gltf-transform the call raises `RuntimeError` after the
  OCCT writer produced an unjoined file that stays on disk
  (`probe_export/outputs/probe.glb`, 11 428 B). With the join monkeypatched
  away (Marc's project-component-d753d790 pattern): flat named nodes, 6 primitives per box (one
  per face), materials `mat_0`/`mat_1`, node rotation = the Y-up quaternion,
  generator "Open CASCADE Technology 7.8" [M `probe_anim/outputs/anim-probe.json`].
- No deviation or provenance is stated in the file.

Marc's uses: `cad-project-013/camera_mount_assembly.py:358-373` (no-op
join, `draco=False`), `cad-project-022/concept-02/study.py:381`
(`draco=False`). fdm-skill:SKILL.md:245-248 names yacv as the way to hand
Marc a shareable GLB viewer page.

### 5.3 `export_animated_glb` [R + M]

`export_animated_glb(factory, ts, out, name, duration_s=5.0, …,
animation_name="default")` (`export.py:221-394`):

- `factory(t) -> Assembly`; `len(ts) >= 2` (`262-264`); geometry is
  tessellated once from `factory(ts[0])` through `export_glb(draco=False)`
  (`266`, `321-329`).
- Guard: a part whose `placed.location` changes between `ts[0]` and the
  middle frame must have an identity part-internal `Location`, else
  `ValueError` naming the part (`284-319`) [M: raised in `probe_export`].
- Sampling: every placed part's world TRS at every `t`, optional Y-up
  (`336-352`); a part missing in a frame raises `NotImplementedError`
  (`353-359`); quaternion signs aligned to one hemisphere (`361-362`,
  `397-411`).
- Grouping: one group per jointed `with_subassembly` (innermost jointed
  ancestor owns a part) (`44-85`, `372-377`); group trajectory
  `T[i]·T[0]⁻¹` from one member (`378`, `448-465`).
- Injection with pygltflib (`468-643`): a new node `animgroup_N` per group
  re-parents the group's nodes and carries a LINEAR rotation channel (glTF
  LINEAR on rotation is slerp) plus translation if it moves more than
  1e-4 mm (`570-604`); ungrouped moving parts get per-part TRS channels
  (`606-631`), which chord-drift on orbital motion (`247-251`). Keyframe
  times are spread evenly over `duration_s` (`382`). Draco at the end
  (`392-393`).
- Measured (`probe_anim`, RevoluteJoint about Z on sub-assembly `lever`, 5
  keyframes, 1.96 s): nodes `base`, `arm`, `animgroup_0` (children `[arm]`);
  scene roots `[base, animgroup_0]`; one animation `default` with a single
  `(animgroup_0, rotation)` LINEAR channel. The joint axis, pivot, angle and
  limits are not in the file; only baked keyframes.

Marc's one real use: `cad-project-022/concept-02/study.py:356-392`, a
flat assembly of named colored boxes (`build_cad`, `356-368`), four poses
exported as STEP and **re-imported to self-validate** solids/volume/sha256
(`376-380`), a static GLB (`381`) and an animated GLB over piecewise-linear
keyframes (`383-385`, the animation name states "duration is not cycle
time"), then the GLB JSON is parsed to count channels (`386-387`).

## 6. `khana diff` (`diff.py`) [R + M]

| Aspect | Behavior | Lines |
| --- | --- | --- |
| Dispatch | `kind` key present → printability, else mechanism; kinds must match | `22-23`, `252-259` |
| Schema | both files must be `schema_version` 0.2, else error (exit 2) | `34-41`, `260` |
| Mechanism parts | added/removed names; per common part: `volume_mm3`, `surface_area_mm2` (with %), `bbox: changed` (no values), COM old → new raw, `is_valid` | `70-107` |
| Not diffed (mechanism) | `face_count`/`edge_count`/`vertex_count` (the skill's "cheapest way to verify a boolean", `skill:596-598`), `exports`, `hint`, `error` | `70` |
| Interferences | keyed by sorted pair; added (volume), removed, changed volume (> 1e-6 mm³) | `110-132` |
| Assertions | regressed (with detail), fixed, added (with pass/fail), removed | `44-64` |
| Printability | status, name, method, bbox, volume, area, COM, is_valid, `min_wall_mm`, overhang area and max angle, assertions | `159-246` |
| Not diffed (printability) | `min_wall_at`, `bores`, `pins`, `warnings`, bridge data, `*-orientation.json` files | |
| Change test | exact `!=` on floats (`77`, `160`, `176`, `180`) → float dust is reported: `min_wall_mm: 3 → 3 (-0.0%)`, `max_angle_deg: 90 → 90 (-0.0%)`, COM `3.31e-16` noise | [M `diff-probe.log`] |
| Output | human text; `no changes` when empty; exit 0 whatever changed | `135-153`, `191-246`; [M] |
| Inputs | two files the user must keep; khana rewrites `mechanism.json` in place every run ("ephemeral", `ck:CLAUDE.md`), so there is no history | |

## 7. `khana status` (`environment.py`) [R + M]

`probe()` (`environment.py:68-78`) returns `EnvironmentReport` (`21-29`):
versions of cad-khana, Python, build123d, bd_warehouse (via
`importlib.metadata`, `32-36`), `ocp_vscode` as `ViewerStatus(importable,
reachable, error)` (`14-18`, `47-65`: TCP connect to `localhost:get_port()`
or 3939 with a 0.2 s timeout, `10-11`, `39-44`), `schema_version`, and
`status = "ok"` iff the viewer is reachable (`77`). Measured: `degraded`,
exit 1, "no listener on port 3939" [M `status.json`]. Not probed:
`gltf-transform` (missing here, needed by every GLB export), OCP/OCCT
version, write access to `outputs/`.

## 8. Output directory layout

```
<script-dir>/
  outputs/                        resolve_out("outputs"), next to the script
    mechanism.json                every check(); fixed name
    assembly.stl, assembly.step   build/view/draw; fixed stem "assembly"
    <name>-printability.json      every inspect(name=…)
    <name>-orientation.json       every suggest_orientation(name=…)
    views/<view>.png|.svg         draw; fixed view names
  out/                            Marc's convention: per-part slicer STL/STEP
                                  from each <part>.py main block (not khana)
  watch.py                        copied keep-alive pusher
```

Measured problems: fixed names collide when two scripts share a directory
(`cad-project-026/assembly.py:68` and `scissor_assembly.py:122`; the directory
holds JSON dated Jun 12, 13 and 14); no run id, source hash or manifest, so
files of an earlier or partial run read as current (FN:13-16, 197-200); the
combined `assembly.step` is overwritten by whichever script ran last.

## 9. Agent-facing conventions (`skill:`)

What the installed skill tells an agent, in order:

1. Load the skill before editing an `assembly.py` or running `khana`
   (`skill:3`); if `khana --version` fails, follow `references/install.md`
   (`skill:58-61`).
2. Script in four sections: parameters, pure part functions, assembly with
   `check(assembly, out="outputs")`, one `inspect()` per printed part
   (`skill:144-158`), diagnostics inside `if __name__ == "__main__":`
   (`skill:223-226`; this guard is what lets `watch.py` import the file
   without running checks).
3. New mechanism, strictly in this order: pure part functions → assembly with
   explicit `Location`s → `assert_no_interference` on *every* candidate pair
   → `assert_clearance(min_mm=…)` with a real number (≥ 0.2 mm for FDM) on
   every moving pair → `khana check` until all scalars are green → only then
   `khana draw` (`skill:160-189`).
4. Iterate with `khana check`, use `khana build` for exports
   (`skill:95-97`); JSON is always written, even on failure (`skill:99-109`).
5. Read `mechanism.json` first (`hint` before the traceback; `interferences`
   point at the root cause), then each printability JSON
   (`skill:585-611`, `628-643`); face/edge/vertex counts are the boolean
   no-op detector (`skill:596-598`).
6. Draw only for shape-level questions; read one view, add a second only if
   needed; `--view`, `--part` to trim (`skill:645-656`, `696-727`).
7. When clean, ask the human to view with `khana view` (`skill:657-659`).
8. Cap the repair loop at 3-5 attempts on the same failure, carry the failing
   script and JSON slice forward, then stop with one
   `HUMAN_REVIEW: <why> — last failure: <…>` line (`skill:661-694`).
9. Colors and materials at the placement; two fidelity tiers
   (`with_detailed_geometry`) (`skill:251-296`); do not `inspect()` bought
   parts (`skill:302-304`, `336-337`); document the coordinate frame
   (`skill:305-318`).
10. Motion: sample `factory(t)` and `check()` each pose; one-frame static
    first; parts in canonical frame for animation; GLB needs gltf-transform
    (`skill:365-546`).
11. Log every paper-cut to `field-notes.md` or a GitHub issue
    (`skill:740-754`).

The upstream skill adds the `khana pick` review loop
(`ck:skills/cad-khana/SKILL.md:97`, `119-137`); cad-fdm-design adds the watch
loop, the `out/` rule and validation patterns (`fdm-skill:SKILL.md:40-73`,
`215-233`); the cad-project-043 entry adds "after geometry changes, rebuild the
exported slicer files as well" and "viewer topology selections refer to one
pushed snapshot" (cad-project-043 `SKILL.md:23-24`).

## 10. Public-name ledger of the tooling modules

Every public (and every private but reachable) name of the tooling modules,
with wonky's compat state (`python/cad_khana/…`). "refused" means the name
exists in wonky and fails as a capability error at its call; "unlisted" means
the name is not defined and the module `__getattr__` raises the capability
error at access (`docs/python-khana.md:114-117`); "provided" means real
behavior. Mechanism/printability names are in the sibling inventories.

| Module.name | Semantics | wonky compat today | Unified target |
| --- | --- | --- | --- |
| `cli.app`, `cli.main` | typer app / entry point | refused (`python/cad_khana/cli.py:5-8`) | host CLI (section 12.1); `khana` alias bin |
| `cli.build`, `check`, `view`, `draw`, `pick`, `status`, `diff` | subcommands (2.2) | unlisted | `wonky` subcommands of the same names |
| `cli._run_script`, `_write_error_diagnostics`, `_version_callback`, `_root`, `ScriptArg`, `OutOpt`, `DiagArg` | runpy runner, crash JSON, typer plumbing | unlisted | host runner already exists (`python/runner.py`); crash record goes into `brep.json`/compat JSON |
| `viewer.set_auto`, `viewer.auto_enabled` | `khana view` toggle | provided (plain values, `python/cad_khana/viewer.py:5-14`) | keep as no-ops |
| `viewer.push` | `ocp_vscode.show` of placed parts | refused, pointing to `bin/wonky-view.mjs` (`viewer.py:17-20`) | no-op + note under wonky-view (the live server already shows the result); keep refusal outside it? see Open questions |
| `draw.set_auto`, `auto_enabled`, `auto_out`, `auto_fmt`, `auto_themeable`, `auto_views`, `auto_part` | `khana draw` toggles | provided (`python/cad_khana/draw.py:5-40`) | keep |
| `draw.draw`, `draw.View` | HLR drawings | refused (`draw.py:43-46`) | Bend HLR drawings (12.6) |
| `draw.VIEW_PRESETS`, `DEFAULT_VIEW_NAMES`, `STANDARD_VIEWS`, `CAMERA_DISTANCE_FACTOR`, `IMAGE_SIZE_PX`, `SUPERSAMPLE`, `MARGIN_FRACTION`, `VISIBLE_COLOR`, `HIDDEN_COLOR`, `LINE_WIDTH_PX`, `CURVE_SAMPLES`, `Segment`, `Point` | presets and constants | unlisted | provide presets as data; `CURVE_SAMPLES` has no meaning for exact conics |
| `draw._sample`, `_segments`, `_edge_key`, `_split_edges`, `_Polyline`, `_EllipseArc`, `_arc_primitive`, `_primitive`, `_primitives`, `_bounds`, `_transform`, `_to_px`, `_rasterize`, `_classify_arc`, `_arc_d`, `_polyline_points`, `_emit_svg_element`, `_to_svg`, `_scoped_compound`, `_bbox_extent`, `_camera_look_from`, `_resolve_views`, `_drawing`, `_draw_view`, `_draw_view_svg` | internals (4) | unlisted | not part of the API |
| `export.export_assembly` | STL+STEP of the compound | refused (`python/cad_khana/export.py:9`) | provided: writes wonky STEP (with names/colors/tree) + certified STL (12.7) |
| `export.export_glb` | static GLB via XCAF + gltf-transform | refused (`export.py:10`) | JS GLB writer, no external tool (12.7) |
| `export.export_animated_glb` | factory sweep → animated GLB | refused (`export.py:11`) | same factory API, exact joint channels (12.7) |
| `export._structural_groups` | jointed sub-assembly groups | refused (`export.py:12`) | internal |
| `export._gltf_transform`, `_gltf_transform_join`, `_gltf_transform_draco`, `_align_quaternion_hemispheres`, `_quat_mul`, `_quat_rotate`, `_relative_trajectory`, `_inject_animation_into_glb`, `_DEFAULT_LINEAR_TOLERANCE_MM`, `_DEFAULT_ANGULAR_TOLERANCE_RAD`, `_DEFAULT_DRACO_LEVEL`, `_EPS_POS_MM`, `_EPS_QUAT` | internals (5.2, 5.3) | unlisted (project-component-d753d790's read of `_gltf_transform_join` at `camera_mount_assembly.py:363` fails there) | not part of the API; the monkeypatch becomes unnecessary |
| `diff.diff`, `diff.Diag` | JSON diff | `diff` refused (`python/cad_khana/diff.py:5`); `Diag` unlisted | `wonky diff` (12.8) |
| `diff._pct`, `_delta`, `_kind`, `_status_section`, `_require_current_schema`, `_assertions_section`, `_PART_SCALAR_FIELDS`, `_mech_part_changes`, `_mech_parts_section`, `_pair_key`, `_interferences_section`, `_diff_mechanism`, `_scalar_line`, `_overhang_section`, `_bbox_section`, `_diff_printability` | internals (6) | unlisted | not part of the API |
| `environment.probe`, `ViewerStatus`, `EnvironmentReport` | status probe | refused (`python/cad_khana/environment.py:8-10`) | `wonky status` (12.9) |
| `environment._pkg`, `_is_listening`, `_probe_viewer`, `_VIEWER_DEFAULT_PORT`, `_VIEWER_PROBE_TIMEOUT_S` | internals (7) | unlisted | not part of the API |
| `_paths.resolve_out` | `out=` anchoring | provided, same semantics (`python/cad_khana/_paths.py:9-16`) | keep |
| `mechanism.check.check`, `CheckResult`, `_set_export_default`, `_export_default` | coordination of exports + JSON + push + draw (2.1) | `check` refused or not-run (`--khana-checks=skip`), `CheckResult` refused, toggles provided (`python/cad_khana/mechanism/check.py:9-18`) | native checks (12.2) |
| `mechanism.hints.match_hint` | error-text → repair hint used by the crash JSON (`cli.py:48-50`) | refused (`python/cad_khana/mechanism/hints.py:5-6`) | wonky hint catalog for its own error classes (idea 15) |
| `mechanism.pick.describe_face/edge/vertex`, `face_relations` | used by `khana pick` | refused (`python/cad_khana/mechanism/pick.py:8-11`) | exact entity facts exist in the viewer (section 11, row pick) |
| `core.tessellation.TESSELLATION_TOLERANCE_MM`, `TESSELLATION_ANGULAR_TOLERANCE`, `Triangle`, `_triangle`, `_tessellate` | shared mesh for wall/overhang (`ck:src/cad_khana/core/tessellation.py:7-32`) | constants provided, rest refused (`python/cad_khana/core/tessellation.py:5-13`) | certified tessellation (`src/print-mesh.mjs`) where a mesh is needed at all |
| `ocp_vscode.show`, `show_object` (external, used via push) | viewer push | wonky's `ocp_vscode` records the shapes as model outputs, no viewer contact (`python/ocp_vscode.py:1-21`) | keep |
| entry point `khana = cad_khana.cli:main` | console script | none | `khana` alias bin in `package.json` (12.1) |

## 11. Mapping to wonky: replaced, partial, missing

| # | cad_khana tooling | wonky today | Status | Unified wonky version |
| --- | --- | --- | --- | --- |
| 1 | `khana build` / `khana check` | `bin/wonky-python.mjs model.py` writes `out/<stem>.brep.json` + `.step` (`--format all`: + planar `.stl`, `.html`) (`bin/wonky-python.mjs:108-119`); `--check` means "do not write the `--out` files" (`:17-18`), not "evaluate assertions"; `check()`/`inspect()` refused or recorded not-run (`:20-23`, `:75-78`; `docs/python-khana.md:125-163`) | **partial** | `wonky build` and `wonky check` with khana meanings: build = checks + exports, check = checks only; checks evaluated natively (12.2) |
| 2 | `khana view` + `watch.py` + OCP viewer | `bin/wonky-view.mjs` live server: rebuild on save, watch set = source + every project module the last build imported with SHA-256 (`docs/viewer/live-server.md:31-38`), warm workers, last good model + failure at file:line:col, reload keeps the source (`bin/wonky-view.mjs:16-35`), revisions and archive (`live-server.md:158-186`), NDJSON events for agents (`live-server.md:192-217`) | **replaced (better)**, with two gaps: no `--khana-checks`/read-only roots/cwd passed to Python (`build-worker.mjs:85-93`, `pool.mjs:333-338`), so an `assembly.py` with `check()` in its main block fails live by default (the runner executes `__main__`, `python/runner.py:627-635`, unlike `watch.py:45`); relative export paths resolve against wonky-view's cwd [I] | one build path for CLI and viewer; checks shown live (12.5) |
| 3 | push of names + colors | `with_part` name and color become `body.name` + `body.appearance`, shown in the parts tree (`docs/python-khana.md:32-42`; `viewer/features/parts/parts-row.js:28`) | **replaced**; stale sentence in `docs/viewer-ui.md:726-728` still says Python delivers no names/colors | also show hierarchy and materials (row 4) |
| 4 | assembly tree (sub-assemblies, joints) | recorded in `model.source.assembly` as path + material + declared assertions (`python/cad_khana/mechanism/assembly.py:237-247`); parts tree is one flat row per body (`docs/viewer/parts-tree.md:16`); joints not recorded | **partial** | tree in the parts panel; joint records (axis, pivot, angle, parent) in `model.source.assembly`; joint sliders (idea 9) |
| 5 | `khana draw` | none: `ExportSVG` refused (`docs/python-frontend.md:408`), "PNG export with metadata" deferred P2 (`docs/viewer/spec.md:1299`) | **missing** | `wonky draw` with Bend HLR (12.6) |
| 6 | `export_assembly` STEP | exact analytic STEP (`src/exporters.mjs:25-148`): one `PRODUCT` named after the file (`:34`), solids named by body id (`:144`), no names, colors or tree | **partial** (geometry better, metadata worse than khana's tree) | STEP with assembly tree, part names, colors (12.7) |
| 7 | `export_assembly` STL | `toStl` exact for planar bodies, refuses curved ones (`src/exporters.mjs:151-157`); certified print mesh with stated deviation via `--format print` / "Export for print" (`src/print-mesh.mjs:7-40`; `docs/viewer-ui.md:584-587`); a model's own `export_stl()` meshes curved bodies at its `tolerance` (`docs/python-frontend.md:104-111`) | **replaced (better: deviation stated)** | per-part STL (and 3MF, idea 12) in one export step |
| 8 | `export_glb` | none (refused) | **missing** | JS GLB writer (12.7) |
| 9 | `export_animated_glb` | none; joints modeled (`docs/python-khana.md:22-24`) but not recorded | **missing** | same factory API, exact channels (12.7) |
| 10 | `khana diff` | viewer delta strip, ghost, compare (`docs/viewer/model-first-compare.md:13-22`, `docs/viewer/diff-overlay.md:9-30`): bodies, faces, edges, volume, bounds with labels, changed source lines; `bin/wonky-compare.mjs` for one coaxial cylinder pair (`:22-25`) | **partial** (geometry diff yes, check diff no) | `wonky diff` over revisions incl. checks (12.8) |
| 11 | `khana status` | none; pieces exist: `GET /api/live` workers + kernel fingerprint (`live-server.md:193`), `brep.json` Python environment and Bend version | **missing** | `wonky status` (12.9) |
| 12 | `khana pick` | `GET /api/selection` and `wonky-inspect --detail/--lookup --revision` with model-hash-bound aliases (`docs/viewer-ui.md:608-634`; `bin/wonky-inspect.mjs:5-23`); exact pair facts incl. cylinder gaps and face distances (`docs/viewer/exact-measure.md:68-83`) | **replaced (better: identity bound to the model hash, exact predicates)** | keep; add a coplanarity/parallel row set equal to `face_relations` |
| 13 | crash `mechanism.json` + `hint` | build failure with file:line:col, call chain, capability message; `error.writtenFiles`, `error.khanaChecks` (`bin/wonky-python.mjs:88-93`) | **partial** (no hint catalog, no compat JSON) | compat JSON projection + hints |
| 14 | output layout `outputs/` | `out/<stem>.*`, `reviews/`, `tmp/viewer/live-cache/` (`docs/viewer-ui.md:711-719`); model exports with SHA-256 provenance (`docs/python-frontend.md:118-124`) | **different** | 12.4 |
| 15 | printability display (not in khana: khana has no display) | exact overhang shading, bed faces, small-bore exemption, plate relation (`docs/viewer/fdm.md:23-44`, `124-171`); wall probe `K` (`docs/viewer/thickness-probe.md:1-45`); no bridge exemption (`fdm.md:42-44`) | **wonky is ahead** of khana here | feed from the same check engine (12.5) |
| 16 | skill conventions | none for wonky; `docs/python-khana.md` is a policy page | **missing** | `wonky-cad` agent skill (12.10) |

## 12. The unified wonky tooling (proposal) [I]

### 12.1 One CLI, with a `khana` alias

`wonky <command> <source>` for `.py` and `.fs` alike: `build`, `check`,
`view`, `draw`, `export`, `diff`, `status`, `pick`. The existing bins stay
(they are the implementation). A `khana` bin (`package.json` `bin`, no new
dependency) maps `khana build|check|view|draw|diff|status|pick` to the wonky
commands and prints one note line, so Marc's habits, his 13 watch-era
projects and the installed skill keep working during the switch. `khana
view` maps to `wonky view` (a server), not to a push.

### 12.2 Checks are native and never stop the script

The bridge op `khana_check` already routes every `check()`/`inspect()` call
to the host (`src/python.mjs:86`, `858-880`). The unified version evaluates
there instead of refusing: the host computes the check with Bend
primitives, records it in `brep.json` (`model.checks`, one entry per call:
kind, arguments, results with exactness labels, source location) and
returns a result object to Python. A failed assertion does **not** raise
`SystemExit` mid-script; all calls run, the CLI exits nonzero at the end
(`--fail-fast` optional). This removes FN:13-16, 197-200, 252-253 (stale
JSON, first failure hides the rest, `try/except BaseException` wrappers).
`--khana-checks=skip` stays for checks a kernel gap cannot evaluate yet,
per call, recorded as not run (decision 12 semantics).

### 12.3 One build path for CLI and viewer

`wonky view` passes exactly the CLI's Python options (checks mode, read-only
roots, working directory = the model's project directory) to its workers.
The main block runs in both (as `python model.py` does); because checks
never exit and exports are recorded, the reason `watch.py` avoided the main
block disappears.

### 12.4 Output layout and staleness

- Per script stem: `outputs/<stem>/mechanism.json`,
  `outputs/<stem>/<name>-printability.json`, `outputs/<stem>/views/…`, and
  `outputs/<stem>/run.json` (run id, model id = SHA-256 of `brep.json`,
  source SHA-256, every file written in this run). Files of the stem that
  this run did not rewrite are deleted or listed as stale in `run.json`.
- The compat JSON files are projections of `model.checks` in cad-khana's
  schema 0.2 plus a `wonky` block (model id, exactness labels), so agents
  that read khana JSON keep working.
- Slicer exports: the model's own `export_step`/`export_stl` calls already
  write with provenance on every build (decision 13). A `stale exports`
  check compares each recorded export's model id with the current revision
  and names the files that are out of date (fdm-skill:SKILL.md:59-61).

### 12.5 Checks live in the viewer

The viewer's query worker already hosts printability and thickness queries
(`docs/viewer/fdm.md:46-80`). Mechanism and printability results of the
revision become view layers: interference solids drawn in red with volume
and centroid; clearance as a dimension line between exact witness points;
overhang faces (exists) plus bridges; `min_wall_at` as a marker that opens
the thickness card; bores, pins and warnings as badges in the parts tree and
the inspector; an **Assertions** panel (pass/fail, detail, click focuses the
pair). The trust chip shows "checks: 12 passed, 1 failed, 2 not run".

### 12.6 Drawings from Bend

`wonky draw`: orthographic projection and hidden-line removal in Bend.
Lines project to lines and circles to ellipses exactly, so SVG output keeps
analytic arcs (no 48-sample polylines); silhouettes of cylinders and cones
under parallel projection are rulings (lines), of spheres circles; torus
silhouettes need a bounded approximation and are labeled. One scale for the
whole view set with a scale bar and the scale in the metadata; optional
overall dimensions and hole diameters from exact faces; view name, model id
and revision in the SVG. PNG by rasterizing in Node (zlib is built in) or
from the viewer. Unknown formats and empty inputs are errors.

### 12.7 Exports

- **STEP**: an assembly structure mirroring the `Assembly` tree
  (`NEXT_ASSEMBLY_USAGE_OCCURRENCE` per placed part and sub-assembly), product
  names = part names, colors as `STYLED_ITEM`/`COLOUR_RGB`, material as a
  product property; geometry stays the exact Bend B-rep. Validation: OCCT
  reads names, colors and tree back (allowed by `AGENTS.md` as independent
  artifact validation). This exceeds cad_khana, whose STEP loses all three.
- **GLB**: a JS writer (JSON chunk + binary chunk, no gltf-transform, no
  Draco dependency), one mesh per part from the certified tessellation with
  its achieved deviation in `extras`, node tree = assembly tree, names,
  sRGB colors converted to linear baseColor, `extras.wonky` with model id.
- **Animated GLB**: from recorded joints, not from sampled world poses:
  each jointed sub-assembly becomes a pivot node at the joint axis whose
  rotation channel turns about the fixed axis. glTF LINEAR rotation is slerp,
  which is exact for rotation about one fixed axis as long as consecutive
  keyframes are less than 180° apart, so the chord drift of
  per-part TRS channels (`export.py:247-251`) cannot occur. `factory(t)`
  stays supported for motion that is not a joint.

### 12.8 Diffs of revisions, including checks

`wonky diff a.brep.json b.brep.json` (or two revision ids): the geometry
delta the viewer already computes plus a check delta (assertions regressed
or fixed, interference volume and clearance changes, min wall and its
location, overhang area, bores/pins/warnings added or removed), compared
with each value's tolerance and exactness label instead of `!=`. Text and
JSON output; `--fail-on-regression` for scripts. The viewer's delta strip
gets the same check line.

### 12.9 Status

`wonky status` (JSON): Bend version and lock, Node, the Python interpreter
used by `scripts/viewer/uv-python`, running viewer servers and their ports
(read from the port range, never touching 4310/4311), kernel fingerprint,
schema versions of `brep.json` and the compat JSON. Degraded states name
their cause; missing optional tools are not a failure because nothing
external is required.

### 12.10 Agent skill

One `wonky-cad` skill that keeps what works in `skill:` (declare parts →
assert every pair → check until green → draw only for shape questions → ask
the human to view; loop cap and `HUMAN_REVIEW`; two fidelity tiers; field
notes) and replaces the commands and the reading guide: `brep.json` checks
with exactness labels, `wonky-inspect` aliases instead of per-push indices,
`wonky view` instead of `watch.py`.

## 13. Improvement ideas over cad_khana [I]

Each idea names the cad_khana behavior it fixes.

1. **Checks never stop the run** (12.2): every `check()`/`inspect()` runs,
   the exit code is decided at the end (fixes FN:13-16, 197-200, 252-253;
   measured stale JSON and silent exit 1).
2. **Say why a run failed**: print every failed assertion and printability
   gate on stderr with file:line (khana prints nothing, [M]).
3. **Per-script output directories and a run manifest** (12.4) (fixes the
   measured `cad-project-026` collision and stale-file confusion).
4. **Live checks in the viewer** (12.5): interference solids, clearance
   witness line, min-wall marker, overhang and bridge tint, badges; the
   daily loop becomes one process instead of viewer + watch.py + `khana
   check` + `uv run <part>.py`.
5. **Check diffs between revisions** with tolerances and labels (12.8)
   (fixes float dust and the missing exit code of `khana diff`).
6. **Waiver growth alarm**: when a part-wide waiver (`overhang_max_deg=91`)
   hides more area than in the previous revision, say so (FN:230-236 asks
   for exactly this).
7. **Fidelity mismatch warning**: record which fidelity tier each check and
   each export used and warn when the exported STL was not the checked
   variant (FN:161-172: a threaded screw exported broken while the
   inspected un-threaded variant was fine).
8. **Staleness of slicer files**: exports carry the model id; a check lists
   `out/` files built from an older revision (fdm-skill:SKILL.md:59-61).
9. **Animated joint previews in the viewer**: joint records → one slider
   per joint, play/scrub; poses are rigid transforms of the existing bodies
   (no rebuild); a **sweep check** evaluates interference and clearance at
   sampled poses and reports the first contact pose (replaces the
   hand-rolled pose loops in `cad-project-013/camera_mount_assembly.py:320-353`
   and the per-stroke `check()` calls noted in the mechanism inventory).
10. **Drawings that can be measured**: common scale, scale bar, exact arcs,
    optional dimensions, model id stamp (12.6).
11. **STEP that keeps names, colors, materials and the tree** (12.7);
    self-validated by an OCCT read-back like Marc does by hand in
    `cad-project-022/concept-02/study.py:376-380`.
12. **GLB and 3MF without external tools**: no gltf-transform, no Draco,
    deviation stated; 3MF with one named object per part for the slicer.
13. **Identity that survives rebuilds**: review references are
    revision-bound aliases (`B1.F2` + model hash) and face origins, not
    per-push topology indices (fixes the "re-push and re-quote" rule of
    `ck:skills/cad-khana/SKILL.md:119-137` and cad-project-043 `SKILL.md:24`).
14. **Exact pick predicates**: coplanar/parallel decisions with stated
    tolerances (the sibling pick probe measured cad-khana calling two 2°
    tilted faces coplanar, local development evidence
    step 5).
15. **Hint catalog** for wonky's own errors (capability errors, Boolean
    refusals, export refusals) in the compat JSON `hint` field, like
    `match_hint`.
16. **Per-part result cache** keyed by source + parameters (FN:111-119
    measured 302 s cold vs 3.8 s warm with a hand-made cache).
17. **`status` that checks what matters**: the tools the exports need
    (none external in wonky), writable output directories, schema versions.
18. **A monkeypatch-free API**: the private names Marc patched
    (`_gltf_transform_join`) disappear; options are parameters.

## 14. Kernel primitives the tooling needs

| Primitive | Needed for | Required exactness | In wonky today |
| --- | --- | --- | --- |
| Rigid placement composition (translation + rotation about an arbitrary axis) | assembly placement, joint poses, animation channels | rotations by arbitrary angles are irrational: exact for 0/90/180/270°, otherwise regularized with a stated bound | compat placement composition exists (`python/cad_khana/mechanism/assembly.py:48-97`); exactness labels in `src/exactness.mjs` |
| Orthographic projection of analytic edges | drawings | exact: lines → lines, circles → ellipses (conic parameters) | missing |
| Silhouette (contour generator) curves under parallel projection | drawings | exact for plane/cylinder/cone/sphere (lines and circles); torus approximate with bound | missing |
| 2D intersection of projected edges (line/conic, conic/conic) | splitting edges at visibility changes | exact or certified intervals | partial (`kernel/intersections.bend` for 3D curve/surface cases) |
| Visibility of an edge segment (ray from sample point toward the eye against trimmed faces) | hidden-line removal | exact membership, with explicit refusal on tangency | `kernel/ray.bend` (supporting surfaces, no trims) + `kernel/solid-classification.bend`/`face-classification.bend` (planar), `cylinder-classification.bend` |
| Certified tessellation with achieved deviation | GLB, STL, 3MF, PNG raster | approximate, bound stated | `src/print-mesh.mjs` + `kernel/tessellate.bend` (planes, cylinders, cones, spheres, tori per its header) |
| Boolean intersection volume of two bodies | interference layer, sweep check | analytic volume with error bound | `kernel/boolean.bend`, hybrid Boolean (uncommitted), `kernel/volume.bend` |
| Body-to-body minimum distance with witness points | clearance line, sweep check | exact for analytic pairs where closed forms exist, else certified bound | missing in general (`docs/viewer/spec.md:1290`); special pairs in exact measure (`docs/viewer/exact-measure.md:68-83`) |
| Face area, centroid, bounding box | diff rows, compat JSON | exact or bounded | bounds from edge bands (`docs/viewer/fdm.md:114-122`); area/centroid missing (`docs/viewer-ui.md:731-733`) |
| Topological identity across revisions (aliases, face origins) | check diffs, reviews, pick | exact bookkeeping | exists (viewer aliases, `wonky-inspect --revision`) |
| STEP assembly/presentation writer | STEP export | host-side, no geometry | missing (single-product writer only) |
| glTF/3MF container writer | GLB, 3MF | host-side | missing |

## 15. Open questions

1. Should `viewer.push()` inside `wonky view` become a silent no-op (the
   live server already shows the result) or stay a capability error outside
   it? A no-op everywhere would let the 13 project `watch.py` files run under
   wonky unchanged, but then the call means nothing.
2. `khana` alias bin: acceptable to shadow the installed uv tool name on
   PATH, or should it be `wonky khana …` only?
3. Check results inside `brep.json` change the model id whenever a check
   changes; should checks be a sidecar keyed by model id instead, so the
   geometry hash stays independent of check parameters?
4. Per-script output directories break Marc's existing paths
   (`outputs/mechanism.json`); keep the flat layout by default and add the
   stem only on collision?
5. Drawings: which dimensions are wanted (overall only, hole diameters,
   ISO-style chains)? Is PNG still needed once the viewer can export PNG?
6. Animated GLB from joints: are limits and joint types beyond
   `RevoluteJoint` (slider, cylindrical) wanted now, given cad_khana has
   only revolute?
7. The field notes are in German and English and partly project-specific;
   which of them become acceptance tests for the unified tooling?
8. `docs/viewer-ui.md:726-728` is stale (Python names/colors are delivered);
   who owns the correction (this workflow may not edit it)?
