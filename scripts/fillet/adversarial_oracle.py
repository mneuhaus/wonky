# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["cadquery-ocp==8.0.1.0.0"]
# ///
"""Fillet harness TEST ORACLE for an extra case catalogue (verify:fillet-kpart).

Usage: uv run scripts/fillet/adversarial_oracle.py <cases.json> <jobs dir> [--cases a,b]

Runs scripts/fillet/reference.py's OCCT oracle (run_case, closed_form_check)
on every case of the catalogue whose sidecar <jobs dir>/<id>.json exists and
prints one JSON object {id: record} on the last stdout line. It never writes
fixtures/fillet/reference.json.
"""
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("fillet_reference", ROOT / "scripts/fillet/reference.py")
ref = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ref)


def main(argv):
    cases = json.loads(Path(argv[0]).read_text())["cases"]
    jobs = Path(argv[1])
    only = argv[argv.index("--cases") + 1].split(",") if "--cases" in argv else None
    out = {}
    for case in cases:
        if only and case["id"] not in only:
            continue
        side_path = jobs / f"{case['id']}.json"
        if not side_path.exists():
            out[case["id"]] = {"status": "no-fixture"}
            continue
        side = json.loads(side_path.read_text())
        try:
            rec = ref.run_case(case, side, None)
        except Exception as ex:  # report, never hide
            rec = {"status": "error", "error": f"{type(ex).__name__}: {ex}"}
        rec["jobSha256"] = side["jobSha256"]
        rec["closedForm"] = ref.closed_form_check(case, rec)
        out[case["id"]] = rec
        print(f"{case['id']:50} {rec['status']:9} vol {rec.get('result', {}).get('volume', float('nan')):.9f}", file=sys.stderr, flush=True)
    print(json.dumps(out))


if __name__ == "__main__":
    main(sys.argv[1:])
