# Cluster py-imports: Python imports fail in the isolated runner

Date: 2026-09-22 23:45 to 2026-09-23 04:21 local. Input: [run.md](run.md)
cluster 5 and `out/corpus/runs.jsonl`. Repository HEAD `79bbfeec` plus the
uncommitted working tree of that moment, including the native-backend change to
`src/python.mjs`. Default JS path (`WONKY_BACKEND` unset; the scripts refuse to
start with it set). Node v22.23.1, Python 3.13 through `uv run`, at most 2
concurrent probes. The machine was shared with benchmarks: load average 10 to
121 on 18 cores (`uptime` at the start and end of every pass is in the first
line of each `out/corpus/py-imports-next*.jsonl`). Nothing in `src/`,
`kernel/`, `bin/` or `python/` was changed, and `~/Workspace/cad` was only read.

The first pass ran on 2026-09-22. On 2026-09-23 all repros and both next-blocker
variants were re-run on the current working tree, with identical results for
all 98 units and all 42 regression units. The corpus files had not changed (all
49 SHA-256 prefixes match `runs.jsonl`). The re-run added a third variant: this
fix plus stage 1 of cluster [py-api-surface](cluster-py-api-surface.md).

## Answer in short

1. **This is the first blocker of all 49 files (43 families).** Each run exits
   with status 1 and `ModuleNotFoundError` at the import line, before any Bend
   request (`completedOperations = 0` for all 49).
2. **There are three root causes. All are in the Python runner (frontend), none
   in the kernel.**
   - The runner executes the model source with `exec()` and never puts the
     model's directory on `sys.path`. `-I -S` is not the cause of this half:
     without both flags the sibling import still fails.
   - `-S` is hard-coded (`src/python.mjs:115`). No interpreter's site-packages
     are ever visible, including a project `.venv` passed with `--python`.
   - Secondary: the shim `build123d` is not a package. `import build123d.<sub>`
     therefore raises a catchable `ModuleNotFoundError` instead of the
     capability error the docs promise. The guard in `python/runner.py:46-50`
     never runs for submodules.
3. **The fix is small (effort S, risk low).**
   - Put the model directory on `sys.path[0]`, as `python model.py` does.
   - Add an explicit `--venv <dir>` option that drops only `-S`.
   - Make the shim a package with an empty submodule path.
   - Record the imported project files (path and SHA-256) and the environment,
     on success *and* on failure. The viewer rework has asked for exactly this
     list (spec D5).
4. **The fix alone builds no file, and neither does the fix together with
   py-api-surface stage 1.**
   - With the fix, 46 of 49 files get past the import. The other 3 are broken
     snapshot copies that fail the same way under plain CPython.
   - Their next blocker is the build123d API gap in 33 files (`Compound`,
     `Part`, `RectangleRounded`, `import_step`, ...), "must bind `result`" in 9
     pytest modules, a refused `build123d.build_common` import in 2, and a data
     file or a relative import in 2.
   - With py-api-surface stage 1 emulated as well, 2 of 49 units reach any Bend
     request (7 requests in total), and none completes. Of the 21 part models
     that can run at all: 6 stop at `Location` (stage 2 of py-api-surface), 6 at
     a refused external import (`OCP` through `ocp_vscode.show` in `__main__`
     3, direct `OCP` 1, `bd_warehouse` 2), 3 at `FontStyle`/text, 3 at sketch or
     builder construction, 2 at `import_step`, 1 at a topology selector.
   - `cad_khana` cannot load under wonky at all. All 8 cad-khana tests stop
     inside `cad_khana` itself: 7 at a direct `OCP` import, 1 at a `Location()`
     in a class definition.
5. **In-flight work: only the viewer overlaps, and it is waiting for this fix.**
   - It is not a Boolean, so the bake-off `recover` route does not apply.
   - The native binding leaves the Python process launch unchanged.
   - The viewer's live server (`src/viewer/live/session.mjs:176`) watches only
     the `.py` file and marks local imports as unsupported (spec D5). The spec
     requests a loaded-files list from the frontend owner.
   - WPy (language work) plans hash-pinned project modules for v1 and rejects
     numpy and cad_khana by design. These files stay on the CPython path, which
     is the path this fix changes.

## 1. Population and first-blocker check

`scripts/corpus/summarize.mjs` counts a module as "local" if a file with that
name exists anywhere in the project. By directory:

| group | files | families | what the import needs |
|---|---:|---:|---|
| module next to the file (`params`, `project-component-32f60153`, `bar`, `case`, `family`, `lego_test_helpers`, 2× `hardware_refs`) | 14 | 13 | the model directory on `sys.path` |
| `hardware_refs` exists only under `design-review/snapshots/*/` | 3 | 1 | nothing helps: the files also fail in plain CPython with the project `.venv` (`python family_snapshot.py --help` → `No module named 'hardware_refs'`) |
| installed package (`numpy` 18, `pytest` 6, `cad_khana` 5, `bd_warehouse` 2, `trimesh` 1) | 32 | 30 | the project's environment (site-packages) |

The 3 broken copies are all in family `py175` (cad-project-003 overnight
snapshots). Two other files of that family have `hardware_refs.py` next to them
and do get past the import.

**Role of the 49 files** (read by hand where the path does not say it):

| role | files | notes |
|---|---:|---|
| part model | 25 | builds printable or reference geometry; 4 of these fail in plain CPython too (see below) |
| pytest module | 18 | `cad-khana/tests/**` (8), `pruefstand/tests/**` (10) |
| tool | 4 | `cad-project-033/debug_edges.py` (edge debug report), `extract_lilypad.py` (Eagle `.brd` to STEP), 2 concept builders (argparse) |
| helper module | 2 | `lilypad_helpers.py`, `pruefstand/region.py` (relative import, package-internal) |

**Files that also fail in plain CPython.** Five files fail for a reason in the
file itself, whatever the runner does:

- the 3 `hardware_refs` copies above;
- `cad-project-041/single-step-r10/jobs/camera-correction/pivot-study/inputs/core_geometry.py`,
  an older copy of `src/core_geometry.py`. It derives `ROOT` and `FEEDER` from
  `__file__`, so its `oval-geometry.json` path resolves below
  `jobs/camera-correction/`, where that file does not exist;
- `cad-project-033/debug_edges.py` (a tool) reads `case.PORT_H`, which `case.py`
  no longer defines.

That leaves **21 runnable part models in 20 families.**

**Entry pattern of the 25 models** (static scan): none binds `result`. 16 have
an `if __name__ == "__main__":` block. 20 call `export_step`/`export_stl`, 4
call `ocp_vscode.show`, 7 call `import_step`, and 5 are argparse CLIs. The
runner executes the source as `__main__`, so these blocks run.

**Hidden members.** The regression run (§5) finds two more files with the same
root cause. `distributor-…/style_tile.py` and `cad-project-040/…/style_tile.py`
(family `py4279`) do `import yaml` inside `try/except ImportError` and then
call `sys.exit(2)`. The corpus run filed them under "Other" as argparse CLIs.
The `SystemExit: 2` there comes from the missing `yaml`, not from argparse.
They are argparse CLIs as well (`--style` and `--mfg` are required), so after
the import they are still not models.

**Coupling with py-api-surface.** That cluster's analysis finds an import
failure directly behind the build123d import in 18 of its 40 files
(`cad_khana` 11, project modules 6, `bd_warehouse` 1). This fix is therefore
needed by 49 + 18 files, and the two frontend fixes should land together.

## 2. Minimal repros

`fixtures/corpus-repro/py-imports/` contains the repros. None depends on
`~/Workspace/cad`. All were run through the production CLI on 2026-09-22 and
again on 2026-09-23 04:12 with identical output.

| repro | command | observed |
|---|---|---|
| `local-module/` (`part.py` + `helpers.py`) | `node bin/wonky-python.mjs fixtures/corpus-repro/py-imports/local-module/part.py --check --python tmp/corpus/uv-python` | `part.py:6: ModuleNotFoundError: No module named 'helpers'`, exit 1 |
| `installed-package/` | `… installed-package/part.py --check --python fixtures/corpus-repro/py-imports/installed-package/python-with-numpy` | `part.py:8: ModuleNotFoundError: No module named 'numpy'`, although that interpreter imports numpy 2.5.3 |
| `build123d-submodule/` | `… build123d-submodule/part.py --check --python tmp/corpus/uv-python` | `part.py:7: ModuleNotFoundError: No module named 'build123d.build_common'; 'build123d' is not a package` |
| `control-syspath/` | `… control-syspath/part.py --check --python tmp/corpus/uv-python` | builds (1000 mm³ box), exit 0. The model adds its own directory, as 8 corpus files do. |

A further check used the production runner with both `-I` and `-S` removed
(`tmp/corpus/py-imports/python-no-isolation`). `local-module` still fails with
`No module named 'helpers'`.

## 3. Root cause (code, read-only)

1. **The model directory is never on `sys.path`.**
   - `src/python.mjs:115` starts `python -I -S -B -u python/runner.py`.
   - The model arrives as a JSON string on fd 3.
   - `python/runner.py:60` runs `exec(compile(source, filename, "exec"),
     namespace)`.

   CPython puts the *script's* directory on `sys.path[0]`, and the script is
   `runner.py`. `-I` suppresses even that. No code adds
   `dirname(filename)`, although `filename` is the absolute path from the CLI
   (`bin/wonky-python.mjs` passes `resolve(sourcePath)`) and `__file__` is set
   correctly. That is why the 8 files with `sys.path.insert(0,
   Path(__file__).parent)` work. The cluster's name blames `-I -S`, but they are
   not the cause of this half.
2. **`-S` removes every site-packages directory.** `-I` alone keeps the
   interpreter's own site-packages. With `-I` and the `cad-project-017`
   `.venv` interpreter, `sys.path` includes that venv's site-packages and
   `cad-khana/src` (from its editable `.pth`). `-I -S` leaves only the stdlib.
   `--python` can already select a venv interpreter, but no option removes
   `-S`. The corpus run's interpreter (`uv run --no-project python`) has neither
   numpy nor pytest in its site-packages, so it would need both an environment
   and site.
   `docs/python-frontend.md` ("Execution and embedding") documents the
   exclusion as intended ("Site packages, `PYTHONPATH`, and implicit
   source-directory helper imports are excluded by isolated execution") but
   gives no reason. The same section says Python is "not a security sandbox",
   so the exclusion is about hermetic builds, not about safety.
3. **`build123d.<submodule>` bypasses the capability guard.**
   - `python/runner.py:39-42` loads the shim with `spec_from_file_location`
     and no submodule search path, so the module has no `__path__`.
   - For `import build123d.build_common`, CPython fails with "'build123d' is
     not a package" *before* it consults `sys.meta_path`.
   - The `fullname.startswith("build123d.")` branch of `NoExternalGeometry`
     therefore never runs.

   The result is a normal `ModuleNotFoundError`. Code can catch it with
   `except ImportError` and then take another path, which is a silent-fallback
   hole under AGENTS.md. `docs/python-frontend.md` says these imports "are
   rejected" as capabilities. `test/python.test.mjs:150` tests only
   `__import__("OCP")`. In the corpus, `bd_warehouse/thread.py:39` hits this for
   `cad-project-013/wasteboard.py` and `cad-project-026/scissor.py`, and
   `cad_khana/draw.py:8` (`build123d.exporters`) for one py-api-surface file.

The kernel (`kernel/*.bend`) and the geometry library are not involved.

## 4. Fix design

All changes are in the frontend: `python/runner.py`, `src/python.mjs`,
`bin/wonky-python.mjs`, plus docs and tests.

**a. Model directory on `sys.path[0]` (default on).** In `runner.py`, after
reading `filename`:

```python
if os.path.isabs(filename) and os.path.isfile(filename):
    sys.path.insert(0, os.path.dirname(filename))
    sys.argv = [filename]
```

This is the ordinary `python model.py` semantics. String sources (`<python>`,
the API and tests) are unchanged. `-B` already keeps `__pycache__` out of
project directories. It could also be default-off behind a flag, but every
multi-file build123d project needs it, and (d) keeps the build reproducible.
Because `docs/python-frontend.md` currently promises the opposite, the default
is Marc's decision.

**b. Explicit environment: `--venv <dir>` (CLI) and `sitePackages: true`
(API).**
- `buildPython` takes `sitePackages` (default `false`). When it is true, the
  spawn arguments become `['-I', '-B', '-u', runner]`. `-I` stays, so
  `PYTHONPATH`, user site and the current directory remain excluded.
- `--venv <dir>` requires `<dir>/pyvenv.cfg`. It sets `python = <dir>/bin/python`
  and `sitePackages = true`. A missing `pyvenv.cfg` is an explicit error.
- Optionally, `--venv auto` searches upward from the model for a `.venv/`. That
  is the layout of Marc's projects: each has a `pyproject.toml` and a `.venv`
  with `cad-khana` installed editable.
- The default stays isolated. No environment is ever picked silently.
- `bin/wonky-view.mjs` would pass the same option through; that is the viewer
  owner's change.

**c. The shim becomes a package without submodules.** Use
`spec_from_file_location("build123d", path, submodule_search_locations=[])`.
Every `import build123d.x` then reaches `NoExternalGeometry` and becomes a
host-latched capability error: `External geometry import
'build123d.build_common' is disabled; …`. Like every capability error, it stays
fatal when caught. Explicit and wildcard `from build123d import X` behave as
before. The experiment confirmed both. py-api-surface stage 1 lists the same
change; it should be made once.

**d. Guards and provenance.**
- 15 of the 16 corpus venvs have the real `build123d` *and* `OCP` installed
  (`cad-khana`, `cad-project-017`, `cad-project-026`, ...; checked with `-I -B`
  through `uv run`). With site enabled, the `NoExternalGeometry` finder at
  `sys.meta_path[0]` and `sys.modules["build123d"] = shim` are then the only
  barriers. Both already exist and hold in the experiment. Two additions:
  - Before the shim is installed, refuse explicitly if `build123d`, `OCP`,
    `OCC` or `cadquery` is already in `sys.modules`. With site enabled, `.pth`
    files run before the runner. None of the 16 venvs preloads these modules
    today.
  - On completion, refuse if any `OCP*`/`OCC*`/`cadquery*` module is in
    `sys.modules` (defense in depth; costs one dict scan).
- Report, in the `complete` **and** the `failure` message:
  - every module file that was loaded from outside the interpreter's prefixes
    (the model's siblings, editable installs such as `cad-khana/src`), with
    path and SHA-256;
  - `sys.prefix`, and whether site-packages was enabled.

  `src/python.mjs` puts them into `model.source.modules` and
  `model.source.environment`, and onto `PythonExecutionError` /
  `UnsupportedFeatureError` as `error.sourceFiles`. Without this, a change to
  `params.py` would change the geometry but not the recorded source hash
  (`model.sourceMap` hashes only the main file). The failure path matters for
  the viewer: an error inside `params.py` must still put `params.py` into the
  watch set.
- This is the same idea as WPy v1's "hash-pinned sibling modules".

**Tests** (`test/python.test.mjs`):
1. A sibling import from a temporary directory, and its hash in
   `model.source.modules`.
2. `from build123d.topology import Solid` inside `try/except BaseException`
   stays an `UnsupportedFeatureError`.
3. `sitePackages` with a throwaway venv (`uv venv` in a temp directory) that
   contains one plain module, with and without the flag.
4. The preload guard, via a `.pth` that imports a fake `OCP`.
5. A failing sibling module reports its path in `error.sourceFiles`.

No new npm dependency. Update `docs/python-frontend.md` ("Execution and
embedding"), and replace `fixtures/corpus-repro/README.md`'s pointer to
`python-local-import/`.

**Effort: S.** About 40 lines of code, 5 tests and one doc section; half a day.

**Risk: low.**
- Results can depend on the environment (numpy version, cad_khana revision).
  (d) records the environment, and the default stays hermetic.
- A local module can shadow a package (`numpy.py` next to the model). That is
  standard Python behavior. The runner's own imports are already loaded.
- Packages that import OCP when they load (`ocp_vscode`, several `cad_khana`
  modules) now fail explicitly. That is correct under AGENTS.md, and §5 shows
  it is the next blocker of 10 files.
- The Python source map (`src/source-map.mjs` `pythonSourceTracker`) keeps
  only frames of the main file. A shape built inside `project-component-32f60153.fit_text` is
  attributed to the calling line in `kasse.py`. That is acceptable; a
  multi-document source map is follow-up work.
- The production path does not change for single-file models (`sys.path`
  gets one extra entry) or for API callers. The regression run confirms it for
  the other 42 corpus units.

## 5. Next blockers, measured

`scripts/corpus/py-imports-next.mjs` builds patched **copies** of
`python/runner.py` in `tmp/corpus/py-imports/` with (a) and (c). A wrapper,
`python-next`, is passed as the production `--python` option. It:
- swaps in the copied runner;
- drops `-S` in the environment variants;
- selects the interpreter with `uv run --no-project --python <venv python>`;
- runs Python under `sandbox-exec` with writes to `~/Workspace/cad` denied.

Every unit runs through `scripts/corpus/probe.mjs`, which uses the production
`buildPython`, shim, host session and classifier. Concurrency was 2, the
timeout 120 s. A unit took about 2.1 s (p50) and at most 9.2 s.

Variants:
- **dir:** (a)+(c), `-S` kept, the corpus run's bare interpreter.
- **dir+env:** (a)+(c), `-S` dropped, the environment Marc runs the file in:
  - a `uv run --project <p>` hint in the docstring (2 files);
  - otherwise the nearest `.venv` above the file;
  - otherwise `cad-project-043/pruefstand`, which the r10 handoff uses (7 cad-project-041
    files).
- **dir+env+lazy:** dir+env, plus py-api-surface stage 1 emulated in the same
  runner copy: every build123d 0.13.0 public name (203) is bound to the shim's
  own `_UnsupportedAPI` sentinel. Calling a sentinel or reading one of its
  attributes raises the shim's capability error at the real use site. This is
  the same emulation as `scripts/corpus/py-api-surface/lazy.py`, placed in the
  runner, so sibling modules see it too.
- **in place:** 3 files read data that the corpus mirror does not copy (a
  1.35 MB JSON, a `.step`, a `.brd`). Their dir+env+lazy result comes from a
  run on the corpus file itself (`--in-place`), still sandboxed and read-only.

| blocker | dir | dir+env | dir+env+lazy |
|---|---:|---:|---:|
| still an import error | 35 | 3 (the `hardware_refs` copies) | 5 (the copies; `matplotlib` in the 2 concept builders) |
| build123d API: explicit capability | 5 | 24 | 17 |
| build123d API: wildcard `NameError` (`Part`, `FontStyle`, `Sketch`) | 9 | 9 | 0 |
| external import refused (`OCP`, `build123d.build_common`) | – | 2 | 13 |
| no `result` binding (pytest modules, helper) | – | 9 | 11 |
| other Python error (data file, relative import, stale attribute) | – | 2 | 3 |
| **units with any Bend request / requests** | **0 / 0** | **0 / 0** | **2 / 7** |
| **units that build** | **0** | **0** | **0** |

**The 21 runnable part models after both frontend fixes:**

| blocker | models | owner |
|---|---:|---|
| `Location` (module level, or `cad_khana.mechanism.assembly` builds `Location()` in a class definition) | 6 | py-api-surface stage 2 |
| `OCP` refused via `from ocp_vscode import show` in `__main__` | 3 | entry contract: display calls in `__main__` (below) |
| `OCP` refused, direct (`build_exact.py`: `BRepAdaptor_Surface`) | 1 | by design; needs a Bend query instead |
| `build123d.build_common` refused via `bd_warehouse` threads | 2 | by design; threads would need a Bend implementation |
| `FontStyle.BOLD` in `project-component-32f60153.py` (text plates) | 3 | py-api-surface stage 2 + text (kernel) |
| `Wire.make_polygon`, `Solid.extrude`, `BuildPart` | 3 | py-api-surface stage 3 |
| `import_step` of reference bodies | 2 | frozen-input path (tier X) |
| `Shape.edges().filter_by(...)` after 2 Bend requests (`cad-project-026/plate.py`) | 1 | selection engine |

The cad-project-017 models put the build in functions and call
`show(build_housing(), ...)` in `__main__`. Running them as `__main__` reaches
the viewer import before the geometry. Either an explicit entry
(`--entry build_housing`, the Python analogue of FS `--feature`) or treating
`show`/`export_*` as named outputs (py-api-surface stage 2, WPy §3.9) removes
that blocker. That is an entry-contract decision, not part of this fix.

**Beyond that.** The 21 runnable models use a median of 11 build123d names
that the shim does not implement: 3 at least (`cad-project-017/base.py`) and
19 at most. The count includes their sibling modules, from
`tmp/corpus/facts/py-facts.json`:

| name | models |
|---|---:|
| `Plane` | 16 |
| `export_step`, `export_stl` | 15 each |
| `Part` | 12 |
| `Compound` | 11 |
| `Rot`, `fillet`, `extrude` | 10 each |
| `Axis`, `Location`, `import_step`, `Cone` | 9 each |
| `Circle` | 8 |
| `RectangleRounded` | 7 |

After the API, all of them hit the entry contract: none binds `result`. 9 of
them use `import_step` (in the file or a sibling module) for reference bodies,
which needs a frozen-input path like the FS `modules.json`.

### Per file

Generated by `scripts/corpus/py-imports-table.mjs` from
`out/corpus/py-imports-files.json`. "Bend requests" counts completed modeling
requests in the dir+env+lazy run. The last column counts build123d names that
the file and its sibling modules use and the shim does not implement. ¹ = run
in place (data file not in the mirror).

| file | role | first blocker | next (dir+env) | after both frontend fixes | Bend requests | missing names |
|---|---|---|---|---|---:|---:|
| `cad-project-003/…/design-review/family-hardware-snapshot.py` | model (broken copy) | `hardware_refs` :15 | import `hardware_refs` | import `hardware_refs` | 0 | 18 |
| `cad-project-003/…/design-review/family-render-snapshot.py` | model (broken copy) | `hardware_refs` :15 | import `hardware_refs` | import `hardware_refs` | 0 | 18 |
| `cad-project-003/…/manufacturing/current-latch-final/55c94242d134/source/family.py` | model | `hardware_refs` :15 | `RectangleRounded` | `Location` via `cad_khana` | 0 | 18 |
| `cad-project-003/…/manufacturing/hands-audit/6afe46f8db9b/family_snapshot.py` | model (broken copy) | `hardware_refs` :15 | import `hardware_refs` | import `hardware_refs` | 0 | 14 |
| `cad-project-003/…/manufacturing/hands-audit/e055fee48ec7/family_snapshot.py` | model | `hardware_refs` :15 | `RectangleRounded` | `Location` via `cad_khana` | 0 | 18 |
| `cad-project-003/…/manufacturing/preload-audit/d1c92576002d/preload_family.py` | model | `family` :12 | `RectangleRounded` via `family` | `Location` via `family` | 0 | 19 |
| `cad-project-013/wasteboard.py` | model | `bd_warehouse` :18 | `build123d.build_common` refused via `bd_warehouse` | `build123d.build_common` refused via `bd_warehouse` | 0 | 19 |
| `dpl/…/worktree/pruefstand/probestaebe/src/make_probestaebe.py` | model | `numpy` :21 | `Locations` | `BuildPart` | 0 | 10 |
| `cad-project-017/base.py` | model | `params` :11 | `Part` (NameError) | `OCP` refused via `ocp_vscode` | 0 | 3 |
| `cad-project-017/cutter.py` | model | `params` :15 | `Part` (NameError) | `OCP` refused via `ocp_vscode` | 0 | 4 |
| `cad-project-017/extruder_stub.py` | model | `params` :10 | `Part` (NameError) | `OCP` refused via `ocp_vscode` | 0 | 4 |
| `cad-project-017/mount.py` | model | `params` :16 | `Part` (NameError) | `Location` via `servo` | 0 | 7 |
| `cad-project-017/servo.py` | model | `params` :15 | `import_step` via `blade` | `Location` via `blade` | 0 | 5 |
| `cad-project-026/plate.py` | model | `bar` :15 | `Part` (NameError) | `Shape.edges` | 2 | 15 |
| `cad-project-026/scissor.py` | model | `bd_warehouse` :33 | `build123d.build_common` refused via `bd_warehouse` | `build123d.build_common` refused via `bd_warehouse` | 0 | 19 |
| `cad-project-032/kasse.py` | model | `project-component-32f60153` :6 | `FontStyle` (NameError) | `FontStyle.BOLD` via `project-component-32f60153` | 0 | 12 |
| `cad-project-032/zusatz_seite.py` | model | `project-component-32f60153` :10 | `FontStyle` (NameError) | `FontStyle.BOLD` via `project-component-32f60153` | 0 | 13 |
| `cad-project-032/zusatz.py` | model | `project-component-32f60153` :9 | `FontStyle` (NameError) | `FontStyle.BOLD` via `project-component-32f60153` | 0 | 13 |
| `cad-project-041/camera-arm-stiffness-2026-09-19/jobs/exact/build_exact.py` | model | `numpy` :18 | `Compound` | `OCP` refused | 0 | 12 |
| `cad-project-041/r10/jobs/belt/geometry.py` | model | `numpy` :7 | `Location` | `Location` | 0 | 10 |
| `cad-project-041/r10/jobs/camera-correction/pivot-study/inputs/core_geometry.py` | model (broken copy) | `numpy` :8 | `import_step` | data file missing | 0 | 9 |
| `cad-project-041/r10/jobs/rack-attachments/geometry.py` | model | `trimesh` :17 | `Compound` | `import_step` ¹ | 0 | 8 |
| `cad-project-041/r10/jobs/rack-drive-module/geometry.py` | model | `numpy` :14 | `Compound` | `Wire.make_polygon` | 0 | 11 |
| `cad-project-041/r10/jobs/rack-frame-mount/geometry.py` | model | `numpy` :15 | `Compound` | `import_step` | 0 | 8 |
| `cad-project-041/r10/src/core_geometry.py` | model | `numpy` :8 | `import_step` | `Solid.extrude` ¹ | 0 | 9 |
| `cad-project-003/…/design-review/extract_lilypad.py` | tool | `numpy` :13 | data file missing | `Polygon` ¹ | 0 | 5 |
| `cad-project-033/debug_edges.py` | tool (broken) | `case` :3 | `Sketch` (NameError) | AttributeError: module 'case' has no attribute 'PORT_H' | 5 | 14 |
| `cad-project-041/archiv/studien/tray-flip-study-2026-09-19/review/source/build_concepts.py` | tool | `numpy` :4 | `Solid` | import `matplotlib` | 0 | 11 |
| `cad-project-041/tray-repeat-study-2026-09-20/review/bound-concept-builder.py` | tool | `numpy` :4 | `Solid` | import `matplotlib` | 0 | 11 |
| `cad-project-003/…/design-review/lilypad_helpers.py` | helper | `lego_test_helpers` :11 | `Compound` via `lego_test_helpers` | no `result` | 0 | 10 |
| `dpl/…/worktree/pruefstand/src/pruefstand/region.py` | helper | `numpy` :4 | relative import (package module) | relative import (package module) | 0 | 2 |
| `cad-khana/tests/mechanism/test_diagnostics.py` | test | `pytest` :2 | `Color` via `cad_khana` | `Location` via `cad_khana` | 0 | 3 |
| `cad-khana/tests/mechanism/test_pick.py` | test | `cad_khana` :3 | `Edge` via `cad_khana` | `OCP` refused via `cad_khana` | 0 | 2 |
| `cad-khana/tests/printability/test_bridges.py` | test | `cad_khana` :3 | `GeomType` via `cad_khana` | `OCP` refused via `cad_khana` | 0 | 0 |
| `cad-khana/tests/printability/test_holes.py` | test | `cad_khana` :3 | `GeomType` via `cad_khana` | `OCP` refused via `cad_khana` | 0 | 1 |
| `cad-khana/tests/printability/test_inspect.py` | test | `pytest` :4 | `Part` via `cad_khana` | `OCP` refused via `cad_khana` | 0 | 1 |
| `cad-khana/tests/printability/test_overhangs.py` | test | `pytest` :2 | `Part` via `cad_khana` | `OCP` refused via `cad_khana` | 0 | 1 |
| `cad-khana/tests/printability/test_pins.py` | test | `cad_khana` :3 | `GeomType` via `cad_khana` | `OCP` refused via `cad_khana` | 0 | 1 |
| `cad-khana/tests/printability/test_structure.py` | test | `cad_khana` :3 | `GeomType` via `cad_khana` | `OCP` refused via `cad_khana` | 0 | 2 |
| `dpl/…/worktree/pruefstand/tests/test_budget.py` | test | `pytest` :11 | no `result` | no `result` | 0 | 1 |
| `dpl/…/worktree/pruefstand/tests/test_fenster.py` | test | `numpy` :9 | no `result` | no `result` | 0 | 1 |
| `dpl/…/worktree/pruefstand/tests/test_interface.py` | test | `numpy` :8 | no `result` | no `result` | 0 | 2 |
| `dpl/…/worktree/pruefstand/tests/test_primitives.py` | test | `numpy` :1 | no `result` | no `result` | 0 | 2 |
| `dpl/…/worktree/pruefstand/tests/test_print_pose.py` | test | `pytest` :4 | no `result` | no `result` | 0 | 0 |
| `dpl/…/worktree/pruefstand/tests/test_relevance.py` | test | `numpy` :4 | no `result` | no `result` | 0 | 1 |
| `dpl/…/worktree/pruefstand/tests/test_screw_chain.py` | test | `numpy` :6 | no `result` | no `result` | 0 | 1 |
| `dpl/…/worktree/pruefstand/tests/test_stability.py` | test | `pytest` :10 | no `result` | no `result` | 0 | 0 |
| `dpl/…/worktree/pruefstand/tests/test_sweep.py` | test | `numpy` :9 | no `result` | no `result` | 0 | 1 |
| `cad-project-043/pruefstand/tests/test_form.py` | test | `numpy` :8 | `Compound` | no `result` | 0 | 5 |

`dpl/…` is `cad-project-014/bottom-drive-review-2026-09-19/tool-improvement/`,
`cad-project-041/r10` is `cad-project-041/single-step-r10`. The `matplotlib` imports of
the 2 concept builders come from the fallback environment
(`cad-project-043/pruefstand` has no matplotlib); `cad-project-041` has no `.venv` of its
own.

**Regression check on the other 42 Python units** (`--rest`, dir+env). 40 keep
their first blocker unchanged. The 2 that change are the hidden
`style_tile.py` members from §1; they now stop at `build123d.Compound`.

## 6. Overlap with in-flight work

| work | effect on this cluster |
|---|---|
| Boolean bake-off (`recover`) | None. There is no Boolean. After both frontend fixes, 2 units complete 7 Bend requests and none reaches an `opBoolean`, so there is nothing to run through `scripts/bakeoff`. The Boolean chains further down these files are py-api-surface's `recover-next` subject. |
| Native binding (`WONKY_BACKEND=native`) | None. The working-tree diff to `src/python.mjs` adds `backendInfo(kernel)` and `endsRun(error)` for native bridge failures. The launch at line 115 is identical, and the imports fail before the kernel is involved. |
| Viewer rework | **Direct dependency.** The live server (`src/viewer/live/session.mjs:176`, `docs/viewer/spec.md` D5, `docs/viewer/live-server.md`) watches only the `.py` file, reports local imports as failures of kind `input`, and requests "a loaded-files list for the watch set" from the frontend owner. Fix (d) produces that list, also on failure. `bin/wonky-view.mjs` needs to pass `--venv` through. |
| Language work (WPy) | Complementary. WPy v0 rejects `numpy`, `cad_khana` and other imports by design and plans hash-pinned project modules for v1 (`docs/language/proposal-surface.md` §3.2, step 7). Files outside the subset keep "the CPython tracer" (step 3). That is the path fixed here. Provenance (d) uses the same idea as WPy's hash pinning. |
| py-api-surface (sibling cluster) | Coupled. Its stage 1 contains the same package change (c), and 18 of its files have an import failure behind the API one. Land (a) to (d) together with stage 1. |

## 7. Recommendations for the corpus ladder (not production)

- Take the 18 pytest modules, the 2 helper modules and the 5 files that fail
  in plain CPython out of the modeling population. Report the 3 remaining
  tools separately. That leaves 21 part models (20 families) in this cluster.
- Classify a module as local only if it resolves from the importing file's
  directory, not from anywhere in the project.
- Mirror data files by reference, not by size: 3 files read inputs above the
  1 MiB or text-extension limit of `tmp/corpus/src/`.
- Re-run the Python half with `--venv auto` once the fix lands. The
  `py-api-surface` cluster then grows by about 33 files. That is the real
  size of the build123d work.
- `cad_khana` is a separate work item. It imports OCP directly in several
  modules, so no file that uses it can run on wonky without a Bend-side port
  (WPy step 7 plans one).

## 8. Reproduce

```sh
node scripts/corpus/py-imports-next.mjs --concurrency 2                          # 49 units × dir, dir+env → out/corpus/py-imports-next.jsonl
node scripts/corpus/py-imports-next.mjs --variant dir+env+lazy --out py-imports-next-deep.jsonl
node scripts/corpus/py-imports-next.mjs --variant dir+env+lazy --in-place \
  --only extract_lilypad,single-step-r10/src/core_geometry.py,rack-attachments/geometry.py \
  --out py-imports-next-deep-inplace.jsonl                                       # data the mirror lacks
node scripts/corpus/py-imports-next.mjs --rest --variant dir+env                 # other 42 Python units → py-imports-next-rest.jsonl
node scripts/corpus/py-imports-files.mjs                                         # per-file join → out/corpus/py-imports-files.json
node scripts/corpus/py-imports-table.mjs                                         # the per-file table above
```

The scripts read the corpus mirror `tmp/corpus/src/` (from `run.mjs`), the
project `.venv` interpreters under `~/Workspace/cad` and, for the lazy
variant, the frozen build123d 0.13.0 name list
`tmp/corpus/py-api-surface/b3d-all.json`, all read-only. Python runs under
`sandbox-exec` with writes to the corpus denied, and `-B` prevents bytecode
writes. The working directories are `tmp/corpus/py-imports/work/<slug>`. The
2026-09-22 outputs are kept in `tmp/corpus/py-imports/rerun-0923/` for
comparison.

## 9. Limitations

- **Environment choice** for the env variants is a heuristic (docstring hint,
  nearest `.venv`, `cad-project-043/pruefstand`). The blockers sit at import or
  definition time in almost every file, so another environment could change
  at most which name comes first. The 2 `matplotlib` results are an artifact
  of the fallback environment.
- **Emulation, not the fix.** The patched runners are copies. The production
  fix may differ in detail, for example `submodule_search_locations=[]`
  instead of assigning `__path__`. The lazy name table emulates py-api-surface
  stage 1 with the shim's existing sentinel, not with the metaclass sentinels
  that stage proposes; `isinstance` or `|` on a sentinel would raise a
  `TypeError` here instead of a capability error. No file got that far.
- **Next blockers only.** Every unit stops before the kernel. The
  "missing names" come from the static scanner, including sibling modules one
  directory deep, not from execution.
