#!/usr/bin/env python3
"""Run with uv run --no-project; plants an off-by-one without a production feature flag.

Requires exclusive ownership of this worktree. Runs the real public-API test green,
changes the initial predecessor sign (one phantom transition for a leading minus),
requires the known cubic root-count assertion to fail, restores the exact source,
and reruns green. Cargo compilation failures do NOT count as detecting the mutant.
An optional --worklog records every source edit for workflow crash recovery.
"""

import argparse
from pathlib import Path
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worklog", type=Path)
    args = parser.parse_args()
    crate = Path(__file__).resolve().parents[1]
    source = crate / "src" / "roots.rs"
    original = source.read_bytes()
    old = b"let mut previous = None;"
    new = b"let mut previous = Some(Sign::Positive);"
    if original.count(old) != 1:
        raise SystemExit("plant site must occur exactly once; source was not changed")
    command = [
        "cargo", "test", "--release", "--offline", "--locked", "-p", "wonky-alg",
        "--test", "algebra", "sturm_counts_and_endpoints", "--", "--exact",
    ]

    def test():
        # Run cargo in the foreground; wait for all test output before editing again.
        result = subprocess.run(command, cwd=crate.parent, capture_output=True, text=True)
        output = result.stdout + result.stderr
        print(output, flush=True)
        return result.returncode, output

    def checkpoint(intent):
        if args.worklog:
            time = subprocess.check_output(["date", "+%H:%M"], text=True).strip()
            with args.worklog.open("a") as worklog:
                worklog.write(f"{time} {source} {intent}\n")

    status, output = test()
    if status != 0 or "1 passed" not in output:
        raise SystemExit("baseline must pass before planting")
    try:
        source.write_bytes(original.replace(old, new))
        checkpoint("planted phantom first Sturm transition (off-by-one).")
        status, output = test()
        if not (
            status == 101
            and "test sturm_counts_and_endpoints ... FAILED" in output
            and "known cubic has exactly three distinct real roots" in output
            and "left: 4" in output and "right: 3" in output
        ):
            raise SystemExit("mutant was not caught by the intended root-count assertion")
    finally:
        source.write_bytes(original)
        checkpoint("restored exact original source after Sturm mutant.")
    status, output = test()
    if status != 0 or "1 passed" not in output:
        raise SystemExit("restored source must pass")
    print("PASS: planted Sturm off-by-one caught (4 != 3); source restored; green again.")


if __name__ == "__main__":
    main()
