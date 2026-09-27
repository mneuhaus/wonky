#!/usr/bin/env python3
"""Live source mutations at the N2 public API; run via the remote runner only.

No production flags or test-only exports. Each mutant must compile, invoke the
specific owning test, and fail its equality assertion, not merely exit nonzero.
Sources are restored in finally, even after an unexpected survivor. Do not run
concurrently with another writer or Cargo invocation in this worktree.
"""
from pathlib import Path
import subprocess

CRATE = Path(__file__).resolve().parents[1]
CARGO = ["cargo", "test", "--release", "--offline", "--locked", "--manifest-path",
         str(CRATE.parent / "Cargo.toml"), "-p", "wonky-n2"]
SCALAR = "radical_sign_cases_cancellation_and_arity_are_not_approximated"
RATIONAL = "million_random_and_hundred_thousand_near_degenerate_against_rationals"
MUTATIONS = [
    ("half_filter_bound", "filter.rs", "v.m.abs() > v.r", "v.m.abs() > v.r * 0.5", "contracts", SCALAR),
    ("missing_squaring_sign_case", "exact.rs", "sa == Sign::Zero || sa == sb", "sa == Sign::Zero", "rational", RATIONAL),
    ("accept_three_roots", "lib.rs", "terms.len() > 2", "terms.len() > 3", "contracts", SCALAR),
    ("shortened_arc_domain", "geometry.rs", "sp == Sign::Negative || pe == Sign::Negative", "sp == Sign::Negative && pe == Sign::Negative", "contracts", "arc_opening_includes_major_wrapped_clockwise_and_full_domains"),
]


def checkpoint(path, intent):
    at = subprocess.check_output(["date", "+%H:%M"], text=True).strip()
    print(f"{at} {path} {intent}", flush=True)


def run(test, name=None):
    args = [*CARGO, "--test", test]
    if name:
        args.append(name)
    result = subprocess.run([*args, "--", "--nocapture"], text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    print(result.stdout, flush=True)
    return result


def main():
    baseline = run("contracts")
    if baseline.returncode != 0:
        raise SystemExit("baseline must pass before planting")
    for name, filename, old, new, test, owner in MUTATIONS:
        path = CRATE / "src" / filename
        source = path.read_bytes()
        text = source.decode()
        if text.count(old) != 1:
            raise SystemExit(f"{name}: expected one mutation site")
        try:
            path.write_text(text.replace(old, new))
            checkpoint(path, f"plant {name}")
            result = run(test, owner)
            if not (result.returncode == 101 and f"test {owner} ... FAILED" in result.stdout
                    and "assertion `left == right` failed" in result.stdout
                    and "could not compile" not in result.stdout):
                raise SystemExit(f"{name}: SURVIVED or failed for the wrong reason")
            print(f"KILLED {name}: compiled API assertion in {owner}", flush=True)
        finally:
            path.write_bytes(source)
            checkpoint(path, f"restore {name}")
    if run("contracts").returncode != 0:
        raise SystemExit("restored baseline failed")
    print("N2 negatives: 4/4 killed; all source bytes restored", flush=True)


if __name__ == "__main__":
    main()
