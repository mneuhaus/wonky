# /// script
# requires-python = ">=3.11"
# dependencies = ["build123d==0.13.0", "manifold3d==3.5.3", "numpy==2.5.3"]
# ///
"""Bake-off TEST ORACLE for the recover prototype's extra cases (never
production geometry).

Usage: uv run scripts/bakeoff/recover-extra.py <dir>
Reads <dir>/cases.json and <dir>/jobs/<id>.job (written by
scripts/bakeoff/recover-extra.mjs) and, with the harness's own oracle code
(scripts/bakeoff/reference.py, imported unchanged), writes
  <dir>/results/<id>.result   manifold3d Boolean of the job's tessellated leaf
                               meshes with per-triangle face provenance (the
                               recover input, a TEST INPUT only)
  <dir>/reference.json        OCCT exact CSG volume/area/solids + manifold
                               volume/genus/components per case
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reference as ref  # noqa: E402  (the harness oracle module)


def main():
    root = Path(sys.argv[1])
    cases = json.loads((root / "cases.json").read_text())["cases"]
    (root / "results").mkdir(parents=True, exist_ok=True)
    out = {}
    for case in cases:
        entry = {"deviationMm": case["deviationMm"]}
        try:
            entry["occt"] = ref.occt_reference(case)
        except Exception as err:  # recorded, never hidden
            entry["occt"] = {"error": f"{type(err).__name__}: {err}"}
        job = ref.decode_job((root / "jobs" / f"{case['id']}.job").read_text())
        try:
            entry["manifold"] = ref.manifold_reference(job, root / "results" / f"{case['id']}.result")
        except Exception as err:
            entry["manifold"] = {"error": f"{type(err).__name__}: {err}"}
        out[case["id"]] = entry
        o, m = entry["occt"], entry["manifold"]
        print(f"{case['id']:24s} occt V={o.get('volume', float('nan')):.6f} solids={o.get('solids')} | manifold V={m.get('volume', float('nan')):.6f} genus={m.get('genus')} comps={m.get('components')}", flush=True)
    (root / "reference.json").write_text(json.dumps({"schema": "wonky-recover-extra-reference/1", "role": "independent test oracle", "cases": out}, indent=1) + "\n")


if __name__ == "__main__":
    main()
