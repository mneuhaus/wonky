"""Copy a build123d file with a one-line preamble that emulates the proposed
"lazy name table" fix of the Python shim (cluster py-api-surface).

Corpus analysis only. Never touches production code: the preamble patches the
already loaded shim module object inside the Python process of one run.

  uv run --no-project --offline python scripts/corpus/py-api-surface/lazy.py < jobs.json > report.json

jobs.json: {"b3dAll": [...build123d 0.13 __all__...],
            "mode": "lazy" | "lazy+localpath" | "lazy+localpath+khana",
            "jobs": [{"src": path, "dst": path}]}

Preamble (one physical line, joined with "; " to the first top-level simple
statement after the docstring and __future__ imports, so every line number of
the copy equals the original):

  * build123d.__all__ gains every build123d 0.13 public name, so
    `from build123d import *` binds them;
  * build123d.__getattr__ returns the shim's own _UnsupportedAPI sentinel
    instead of raising, so named imports, type annotations and default
    arguments no longer fail; any call or attribute access of a sentinel still
    raises the shim's capability error through the host channel.
  * mode "lazy+localpath" additionally puts the script directory first on
    sys.path (emulates the py-imports cluster fix for project-local modules);
    "lazy+localpath+khana" also appends Marc's cad_khana source package from
    the corpus mirror (emulates an installed cad_khana).
"""
import ast
import json
import os
import sys

PREFIX = "_wk_b3d"
KHANA = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../tmp/corpus/src/cad-khana/src"))


def preamble(names, mode):
    parts = [
        f"import build123d as {PREFIX}",
        f"{PREFIX}.__all__ = sorted(set({PREFIX}.__all__) | set({json.dumps(sorted(names))}))",
        f"{PREFIX}.__getattr__ = lambda _n: {PREFIX}._UnsupportedAPI(_n) if not _n.startswith('_') "
        f"else (_ for _ in ()).throw(AttributeError(_n))",
    ]
    if mode.startswith("lazy+localpath"):
        parts.append("import sys as _wk_sys, os as _wk_os")
        parts.append("_wk_sys.path.insert(0, _wk_os.path.dirname(_wk_os.path.abspath(__file__)))")
    if mode == "lazy+localpath+khana":
        # Marc's cad_khana package from the corpus run's read-only mirror (-B: no bytecode is written).
        parts.append(f"_wk_sys.path.append({json.dumps(KHANA)})")
    return "; ".join(parts)


SIMPLE = (ast.Import, ast.ImportFrom, ast.Assign, ast.AnnAssign, ast.AugAssign, ast.Expr, ast.Pass,
          ast.Global, ast.Nonlocal, ast.Assert, ast.Delete, ast.Raise)


def transform(source, pre):
    tree = ast.parse(source)
    body = tree.body
    i = 0
    if body and isinstance(body[0], ast.Expr) and isinstance(getattr(body[0], "value", None), ast.Constant) \
            and isinstance(body[0].value.value, str):
        i = 1
    while i < len(body) and isinstance(body[i], ast.ImportFrom) and body[i].module == "__future__":
        i += 1
    lines = source.split("\n")
    if i < len(body) and isinstance(body[i], SIMPLE) and body[i].col_offset == 0:
        n = body[i].lineno - 1
        lines[n] = pre + "; " + lines[n]
        return "\n".join(lines), {"insertedAtLine": n + 1, "how": "prefix"}
    if i > 0:
        prev = body[i - 1]
        n = prev.end_lineno - 1
        lines[n] = lines[n][:prev.end_col_offset] + "; " + pre + lines[n][prev.end_col_offset:]
        return "\n".join(lines), {"insertedAtLine": n + 1, "how": "suffix"}
    raise ValueError("no insertion point for the preamble")


def main():
    spec = json.load(sys.stdin)
    pre = preamble(spec["b3dAll"], spec.get("mode", "lazy"))
    report = []
    for job in spec["jobs"]:
        try:
            source = open(job["src"], encoding="utf-8").read()
            out, info = transform(source, pre)
            ast.parse(out)  # the copy must stay valid Python
            open(job["dst"], "w", encoding="utf-8").write(out)
            report.append({"src": job["src"], "dst": job["dst"], "ok": True, **info})
        except Exception as error:  # reported, the runner skips the unit
            report.append({"src": job["src"], "dst": job["dst"], "ok": False, "error": f"{type(error).__name__}: {error}"})
    json.dump(report, sys.stdout, indent=1)


if __name__ == "__main__":
    main()
