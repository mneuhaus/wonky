# Repros: Python imports in the isolated runner (cluster `py-imports`)

Analysis: [docs/corpus/cluster-py-imports.md](../../../docs/corpus/cluster-py-imports.md).
None of these files depends on `~/Workspace/cad`. All were run on 2026-09-22 and
again on 2026-09-23 04:12 (HEAD `79bbfeec` plus the working tree of that moment,
with identical output) through the production CLI on the default JS path
(`WONKY_BACKEND` unset). The failing rows exit with status 1, the control row
with 0. They are inputs, not tests: they document the behavior at each date.
`scripts/corpus/verify/repros.mjs` holds the current expectations
(`node scripts/corpus/verify/verify.mjs --only repros`).

| Directory | Stands for | Command (from the repo root) | Observed 2026-09-22 / 04:12 | Observed after the W5 integration (2026-09-23 afternoon) |
|---|---|---|---|---|
| `local-module/` | 17 corpus units that import a module of their own project (`params`, `project-component-32f60153`, `bar`, `case`, `hardware_refs`, `family`, `lego_test_helpers`) | `node bin/wonky-python.mjs fixtures/corpus-repro/py-imports/local-module/part.py --check --python tmp/corpus/uv-python` | `part.py:6: ModuleNotFoundError: No module named helpers` | builds: `python/1: 8 vertices · 12 edges · 6 faces · 1000 mm³ · closed topology`; `helpers.py` is recorded with its SHA-256 in `model.source.modules` |
| `installed-package/` | 32 corpus units that import an installed package (`numpy` 18, `pytest` 6, `cad_khana` 5, `bd_warehouse` 2, `trimesh` 1), plus 2 hidden ones (`yaml`) | `node bin/wonky-python.mjs fixtures/corpus-repro/py-imports/installed-package/part.py --check --python fixtures/corpus-repro/py-imports/installed-package/python-with-numpy` | `part.py:8: ModuleNotFoundError: No module named numpy`, although `python-with-numpy -c "import numpy"` prints `numpy 2.5.3` | `part.py:8:1: Python package numpy is not available to wonky models (imported at part.py:8). Policy: … installed third-party packages are not importable. See docs/python-khana.md.` (decision 1: installed packages stay closed; `cad_khana` is now wonky-provided) |
| `build123d-submodule/` | the 2 `bd_warehouse` files, once site-packages are visible (`bd_warehouse/thread.py:39` imports `build123d.build_common`) | `node bin/wonky-python.mjs fixtures/corpus-repro/py-imports/build123d-submodule/part.py --check --python tmp/corpus/uv-python` | `part.py:7: ModuleNotFoundError: No module named build123d.build_common; build123d is not a package` | builds 1000 mm³: the name table registers every build123d 0.13.0 submodule as a view |
| `control-syspath/` | control: the runner sets `__file__` correctly, only `sys.path` lacks the model directory | `node bin/wonky-python.mjs fixtures/corpus-repro/py-imports/control-syspath/part.py --check --python tmp/corpus/uv-python` | builds: `python/1: 8 vertices · 12 edges · 6 faces · 1000 mm³ · closed topology` | builds, unchanged |

`tmp/corpus/uv-python` is `exec uv run --no-project --quiet python "$@"` (see
`docs/corpus/run.md`). Any Python 3.10+ interpreter reproduces the first,
third and fourth rows. `python-with-numpy` is `exec uv run --no-project
--quiet --with numpy python "$@"`.

With the runner patch sketched in the analysis (model directory on
`sys.path[0]`, `shim.__path__ = []`, and `-S` dropped for an explicitly chosen
environment), `local-module` and `installed-package` build the same 1000 mm³
box, and `build123d-submodule` stops with the documented capability error
`External geometry import 'build123d.build_common' is disabled; production
geometry must be constructed in Bend`. That was checked with a patched copy
of the runner under `tmp/corpus/py-imports/` (`scripts/corpus/py-imports-next.mjs`),
not in production.

The older `../python-local-import/` repro (same root cause as `local-module/`)
stays in place, because `../README.md` links it.
