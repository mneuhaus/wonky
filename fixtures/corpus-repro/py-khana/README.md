# Repros: cad_khana and external packages (decision 3)

Policy and corpus counts: [docs/python-khana.md](../../../docs/python-khana.md).
None of these files depends on `~/Workspace/cad`. Run on 2026-09-23 from the
repository root through the production CLI, default JS path (`WONKY_BACKEND`
unset), with `--check --python tmp/corpus/uv-python`. Columns are the use-site columns the host reports since the W5 integration (2026-09-23 afternoon). The first and last rows exit 0,
the others 1. `test/python-khana.test.mjs` asserts all of them.

| Directory | Stands for | Observed |
| --- | --- | --- |
| `assembly/assembly.py` (+ `parts.py`) | the cad_khana `assembly.py` files: named parts from a project module, `Pos` placements, colors, a sub-assembly, declared assertions, module-level `assembly` | builds 5 bodies `tray`, `hood`, `tray_slid_out`, `pin_left`, `pin_right` (3600, 8088, 3600, 56.548668, 56.548668 mm³), each with its name and appearance in `brep.json` |
| `check-in-main/assembly.py` | 16 files that call `check()`, usually in the `__main__` block | `assembly.py:18:5: cad_khana.mechanism.check.check() is a cad_khana diagnostic that wonky does not provide: …` |
| `diagnostic-caught/part.py` | `try: diag = inspect(...)` in the cad-project-003 family files | `part.py:10:12: cad_khana.printability.inspect.inspect() is a cad_khana diagnostic …`, although the model catches the exception |
| `external-package/part.py` | 7 files that import bd_warehouse (cad-project-046, cad-project-013, cad-project-026) | `part.py:4:1: Python package 'bd_warehouse' is not available to wonky models (imported at part.py:4). Policy: …, and wonky does not provide bd_warehouse: its threads, fasteners, bearings and pipes are built by the real build123d on OpenCascade; … See docs/python-khana.md.` |
| `corpus-color/assembly.py` | the 48 `Color(...)` calls of the 12 cad_khana corpus files | builds `hood` (24000 mm³) with appearance `{red: 0.2901961, green: 0.4313726, blue: 0.5411765, alpha: 1}` through `python/_wonky_color.py` (before the shim bound it: `assembly.py:10:1: build123d.Color is not implemented by the Python frontend`) |
