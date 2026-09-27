# /// script
# requires-python = ">=3.11"
# dependencies = ["jsonschema==4.25.1"]
# ///
"""Independent Draft 2020-12 consumer of the real Rust codec's JSON output.

Run remotely: uv run scripts/rust/check-wire-v3-schema.py out/wc0/cases.jsonl
This checks the JSON contract, not semantic geometry or certificate validity.
"""
import copy
import json
import sys
from pathlib import Path
from jsonschema import Draft202012Validator

root = Path(__file__).resolve().parents[2]
schema = json.loads((root / "rust/wonky-wire/wire-v3.schema.json").read_text())
Draft202012Validator.check_schema(schema)
validator = Draft202012Validator(schema)
rows = [json.loads(line) for line in Path(sys.argv[1]).read_text().splitlines()]
assert len(rows) == 128, "require the full generated positive corpus, not all-refuse"
for row in rows:
    validator.validate(row)

mutants = []
missing_branch = copy.deepcopy(rows[0])
curve = next(c for c in missing_branch["body"]["curves"] if c["geometry"]["kind"] == "Hyperbola")
del curve["geometry"]["branch"]
mutants.append(("missing hyperbola branch", missing_branch))
for name, mutate in [
    ("unknown version", lambda v: v.update(schemaVersion=3)),
    ("unknown top field", lambda v: v.update(ignored=True)),
    ("estimated payload under enclosure tag", lambda v: v["body"]["budgets"][0]["total"].update(kind="Enclosed")),
    ("noncanonical binary64 text", lambda v: v["body"]["constructions"][0]["parameters"].__setitem__(0, "0X0000000000000000")),
    ("binary64 trailing newline", lambda v: v["body"]["constructions"][0]["parameters"].__setitem__(0, "0000000000000000\n")),
]:
    mutant = copy.deepcopy(rows[0])
    mutate(mutant)
    mutants.append((name, mutant))
for name, mutant in mutants:
    assert not validator.is_valid(mutant), f"schema accepted {name}"
print(f"PASS JSON Schema draft2020-12: {len(rows)} actual exported messages; {len(mutants)} malformed negatives rejected")
