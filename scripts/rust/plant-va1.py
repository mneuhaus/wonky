# /// script
# requires-python = ">=3.11"
# ///
"""Run VA1 planted negatives against real production paths, on the remote runner.

No production flags or test-only exports: edit one expression, execute the
owning test/oracle, require the intended failure, then restore source bytes.
A build error never counts as a killed plant. Source is restored on exceptions
and SIGTERM. Run only in this package's idle worktree (never alongside a test).
"""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
RUST = ROOT / "rust"
SRC = RUST / "wonky-validated/src"


def invoke(command, expect=0, needle=None, cwd=RUST):
    print("RUN " + " ".join(command), flush=True)
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=True)
    print(result.stdout, end="", flush=True)
    print(result.stderr, end="", file=sys.stderr, flush=True)
    if result.returncode != expect or (needle and needle not in result.stdout + result.stderr):
        raise RuntimeError(f"expected exit {expect} with {needle!r}; got {result.returncode}")


def test(name=None):
    return ["cargo", "test", "--release", "--offline", "--locked", "-p", "wonky-validated", "--test", "validated", *([name, "--", "--exact"] if name else [])]


def integrity_plants():
    # A valid corpus and valid numeric results must not disguise fewer API calls.
    # IDs 8 and 18 are +/-0: reusing one result for both used to pass containment.
    path = RUST / "wonky-validated/examples/va1-samples.rs"
    before = path.read_bytes()
    source = before.decode()
    calls = """        let s = v::sin(Iv::point(x), WIDTH)?;
        let c = v::cos(Iv::point(x), WIDTH)?;
        let a = v::atan2(Iv::point(y), Iv::point(x), WIDTH)?;"""
    loop = "    for id in start..start + count {"
    mutations = [
        ("cached-zero-calls", [
            (loop, "    let zs = v::sin(Iv::point(0.0), WIDTH)?;\n"
                   "    let zc = v::cos(Iv::point(0.0), WIDTH)?;\n" + loop),
            (calls, """        let s = if id == 8 || id == 18 { zs } else { v::sin(Iv::point(x), WIDTH)? };
        let c = if id == 8 || id == 18 { zc } else { v::cos(Iv::point(x), WIDTH)? };
        let a = v::atan2(Iv::point(y), Iv::point(x), WIDTH)?;"""),
        ], "public API invocation census mismatch"),
        ("repeated-one-corpus", [
            (calls, "        let x = 1.0_f64;\n        let y = 1.0_f64;\n" + calls),
        ], "scalar corpus mismatch"),
        ("three-hoisted-calls", [
            (loop, "    let hs = v::sin(Iv::point(1.0), WIDTH)?;\n"
                   "    let hc = v::cos(Iv::point(1.0), WIDTH)?;\n"
                   "    let ha = v::atan2(Iv::point(1.0), Iv::point(1.0), WIDTH)?;\n" + loop),
            (calls, "        let x = 1.0_f64;\n        let y = 1.0_f64;\n"
                    "        let (s, c, a) = (hs, hc, ha);"),
        ], "scalar corpus mismatch"),
    ]
    # Restore the missing counts with irrelevant calls: counts alone must not
    # certify that the canonical rows describe the arguments actually evaluated.
    mutations.append(("compensating-wrong-arguments", [
        *mutations[0][1],
        ("    // Additional whole-ball/domain coverage", "    v::sin(Iv::point(1.0), WIDTH)?;\n"
         "    v::cos(Iv::point(1.0), WIDTH)?;\n    // Additional whole-ball/domain coverage"),
    ], "public API argument stream mismatch: sin"))
    killed = []
    for name, edits, needle in mutations:
        mutated = source
        for old, new in edits:
            if mutated.count(old) != 1:
                raise RuntimeError(f"plant anchor not unique: {name}")
            mutated = mutated.replace(old, new)
        try:
            path.write_text(mutated)
            invoke(["cargo", "build", "--release", "--offline", "--locked", "-p", "wonky-validated", "--example", "va1-samples"])
            invoke(["uv", "run", "scripts/rust/validate-va1.py", "--count", "20"], 1, needle, ROOT)
            killed.append(name)
            print(f"KILLED {name} at independent invocation/corpus oracle", flush=True)
        finally:
            path.write_bytes(before)
    return killed


def main():
    if os.environ.get("WONKY_REMOTE_PROFILE") not in {"studio", "mini"}:
        raise RuntimeError("run plants through the guarded remote runner, not on the MacBook")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--integrity-only", action="store_true")
    args = parser.parse_args()
    invoke(test())
    plants = [] if args.integrity_only else [
        ("f64-pi-reduction", "transcendental.rs", "for word in words {", "for word in &words[..1] {", None, "sample 0 sin"),
        ("gauss-difference-as-bound", "quadrature.rs",
         "let remainder = (width.pow(5) * I::point(derivative.abs_max()) / I::point(180.0)).hi;",
         "let remainder = (q - width * eval(m)?[0]).abs_max();",
         "oscillatory_alias_is_not_certified_by_gauss_order_agreement", "Gauss alias certified"),
        ("overwide-overlap", "lib.rs", "if !width.is_finite() || width > max_width {", "if !width.is_finite() {",
         "acceptance_width_rejects_a_wide_overlapping_enclosure", "overwide overlap accepted"),
        ("shortened-domain", "quadrature.rs", "let mut cells = vec![(a, b)];", "let mut cells = vec![(a, a * 0.5 + b * 0.5)];",
         "certified_gl2_contains_closed_sphere_and_torus_integrals", "not in Enclosure"),
    ]
    killed = []
    for name, filename, original, mutated, owner, needle in plants:
        path = SRC / filename
        before = path.read_bytes()
        source = before.decode()
        if source.count(original) != 1:
            raise RuntimeError(f"plant anchor not unique: {name}")
        try:
            path.write_text(source.replace(original, mutated))
            if owner:
                invoke(test(owner), 101, needle)
            else:
                invoke(["cargo", "build", "--release", "--offline", "--locked", "-p", "wonky-validated", "--example", "va1-samples"])
                invoke(["uv", "run", "scripts/rust/validate-va1.py", "--count", "1"], 1, needle, ROOT)
            killed.append(name)
            print(f"KILLED {name} at {owner or 'independent mpmath oracle'}", flush=True)
        finally:
            path.write_bytes(before)
        if path.read_bytes() != before:
            raise RuntimeError(f"restore failed: {path}")
    killed.extend(integrity_plants())
    invoke(test())
    # Leave the public driver matching the restored sources as well.
    invoke(["cargo", "build", "--release", "--offline", "--locked", "-p", "wonky-validated", "--example", "va1-samples"])
    print(json.dumps({"killed": killed, "survived": [], "sources_restored": True}))


def interrupted(signum, frame):
    raise KeyboardInterrupt(f"signal {signum}")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupted)
    main()
