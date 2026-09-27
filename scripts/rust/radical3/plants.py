#!/usr/bin/env -S uv run --script
"""Kill two real source mutations at the public sign boundary, then restore.
No production mutation flags/seams. Run foreground only, with no concurrent edits.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "rust/wonky-radical3/src/lib.rs"
MANIFEST = ROOT / "rust/wonky-radical3/Cargo.toml"
LOG = ROOT / "out/n3/mutation-edits.log"


def write(text, intent):
    SOURCE.write_text(text)
    at = subprocess.check_output(["date", "+%H:%M"], text=True).strip()
    line = f"{at} {SOURCE}: {intent}\n"
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a") as output:
        output.write(line)
    print(line, end="", flush=True)


def run(target):
    return subprocess.run(["cargo", "test", "--release", "--offline", "--locked", "--manifest-path", str(MANIFEST),
                           "--test", "contracts", "near_zero_signs_and_exact_pythagorean_zeros", "--", "--exact", "--nocapture"],
                          env={**os.environ, "CARGO_TARGET_DIR": str(target)}, text=True, capture_output=True)


def mutations(target):
    original = SOURCE.read_text()
    # Match stable semantic operations, not line numbers; no test asserts source.
    mutants = [
        ("unchecked-square", "if sb == Sign::Zero || sa == sb", "if sb == Sign::Zero", "left: Negative", "right: Positive"),
        ("zero-positive", "Eval::default().exact_sign(&self.coefficients, &self.roots)",
         "Eval::default().exact_sign(&self.coefficients, &self.roots).map(|s| if s == Sign::Zero { Sign::Positive } else { s })",
         "left: Positive", "right: Zero"),
    ]
    baseline = run(target)
    print(baseline.stdout, baseline.stderr)
    assert baseline.returncode == 0 and "1 passed" in baseline.stdout, "baseline failed; no mutation evidence"
    results = []
    try:
        for name, before, after, actual, expected in mutants:
            assert original.count(before) == 1, "mutation location ambiguous"
            write(original.replace(before, after), f"plant {name}")
            result = run(target)
            print(result.stdout, result.stderr)
            combined = result.stdout + result.stderr
            assert result.returncode == 101 and "1 failed" in result.stdout and actual in combined and expected in combined, f"{name} did not fail for the intended sign"
            results.append({"plant": name, "killed": True, "exit": result.returncode, "observed": actual, "expected": expected})
            write(original, f"restore after {name}")
    finally:
        if SOURCE.read_text() != original:
            write(original, "finally restore production source")
        restored = run(target)
        print(restored.stdout, restored.stderr)
        assert restored.returncode == 0 and "1 passed" in restored.stdout, "restored baseline failed"
    print(json.dumps({"mutants": results, "restoredBaseline": "PASS"}))


def main():
    # Source timestamps can move backwards when the runner next rsyncs the tree.
    # Never leave a mutated artifact in the normal target, even after failure.
    with tempfile.TemporaryDirectory(prefix="wonky-n3-mutants-") as target:
        mutations(target)


if __name__ == "__main__":
    main()
