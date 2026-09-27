# /// script
# requires-python = ">=3.11"
# dependencies = ["mpmath==1.3.0"]
# ///
"""VA1 independent 256-bit oracle, consuming actual public-API invocations.

Run through the guarded remote runner. The checker builds a temporary source
copy with entry instrumentation; production source/API remain untouched. Row
inputs must match the independently regenerated corpus bit-for-bit; real entry
counts and ordered argument fingerprints must match those validated rows.
Stream, never store, the million-row corpus. --count/--start allow bounded
shards; the default is full acceptance. No --binary bypass is accepted.
The primitive constants are independently proved by exact rational series.
This is regression evidence, not protection against malicious source code or
a formal proof; argument fingerprints are non-cryptographic. No geometry claims.
"""
import argparse
from collections import Counter
from contextlib import contextmanager
from fractions import Fraction as F
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import sys
import tempfile

import mpmath as mp

ROOT = Path(__file__).resolve().parents[2]
mp.mp.prec = 256


def require(condition, message):
    if not condition:
        raise ValueError(message)


FUNCTIONS = ("sin", "cos", "atan2", "acos", "exp", "log")
MASK = (1 << 64) - 1
WIDTH_BITS = "3d719799812dea11"  # binary64(1e-12), a fixed acceptance budget


def bits(x):
    return struct.pack(">d", x).hex()


def corpus(sample_id):
    """Independent specification of the scalar corpus, not data from the driver.

    Ten equally sized families: near large multiples of pi, near k*pi/2
    (two), 1e10, full supported reduction range, tiny normal, moderate, tiny,
    signed zero/quadrants, and broad large random. Keep binary64 order explicit.
    """
    state = sample_id + 0x564131

    def uniform():
        nonlocal state
        state = (state + 0x9e3779b97f4a7c15) & MASK
        z = ((state ^ (state >> 30)) * 0xbf58476d1ce4e5b9) & MASK
        z = ((z ^ (z >> 27)) * 0x94d049bb133111eb) & MASK
        return ((z ^ (z >> 31)) >> 11) / float(1 << 53)

    def adjacent(base):
        return struct.unpack(">d", (int(bits(base), 16) + sample_id % 3).to_bytes(8, "big"))[0]

    r = uniform()
    family = sample_id % 10
    pi2 = float.fromhex("0x1.921fb54442d18p+0")
    if family == 0:
        x = adjacent((1e10 + sample_id) * (pi2 * 2.0))
    elif family in (1, 2):
        q = (r - 0.5) * 4e10
        k = math.copysign(math.floor(abs(q) + 0.5), q)  # Rust ties away, not Python round
        x = adjacent(k * pi2)
    elif family == 3:
        x = 1e10 if sample_id == 3 else 1e10 + r * 1e6
    elif family == 4:
        x = (r - 0.5) * 2.0 * 35184372088832.0
    elif family == 5:
        x = (r - 0.5) * math.ldexp(1.0, -(sample_id % 450))
    elif family == 6:
        x = (r - 0.5) * 100.0
    elif family == 7:
        x = (r - 0.5) * 1e-10
    elif family == 8:
        x = {8: 0.0, 18: -0.0}.get(sample_id, (sample_id // 10) * pi2)
    else:
        x = (r - 0.5) * 2e10
    if sample_id % 17 == 0 and x != 0.0:
        y = 0.0
    else:
        exponent = int(uniform() * 996.0) - 498
        y = (1.0 + uniform()) * math.ldexp(1.0, exponent)
        if uniform() < 0.5:
            y = -y
    return [bits(x), bits(y)]


@contextmanager
def audited_binary():
    require(os.environ.get("WONKY_REMOTE_PROFILE") in {"studio", "mini"},
            "instrumented builds require the guarded remote runner (no local fallback)")
    scratch = ROOT / "tmp"
    scratch.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="va1-audit-", dir=scratch) as directory:
        work = Path(directory) / "rust"
        shutil.copytree(ROOT / "rust", work, ignore=shutil.ignore_patterns("target", "vendor", ".git"))
        # Preserve the pinned workspace, lockfile, profiles and offline dependency
        # setup. The vendor source is read-only; every edited file is a copy.
        (work / "vendor").symlink_to(ROOT / "rust/vendor", target_is_directory=True)
        digest = hashlib.sha256()
        for path in sorted(work.rglob("*")):
            if path.is_file():
                digest.update(str(path.relative_to(work)).encode() + b"\0" + path.read_bytes())
        provenance = {"source_sha256": digest.hexdigest()}
        crate = work / "wonky-validated"
        source = crate / "src/transcendental.rs"
        text = source.read_text()
        for index, name in enumerate(FUNCTIONS):
            args = "y: Iv, x: Iv, max_width: f64" if name == "atan2" else "x: Iv, max_width: f64"
            signature = f"pub fn {name}({args}) -> Result<Enclosure, Error> {{"
            require(text.count(signature) == 1, f"cannot instrument public API entry {name}")
            y = "y.m.to_bits(), y.r.to_bits()" if name == "atan2" else "0, 0"
            text = text.replace(signature, signature +
                                f"\n    crate::va1_audit::enter({index}, [x.m.to_bits(), x.r.to_bits(), {y}, max_width.to_bits()]);")
        source.write_text(text)
        helper = (ROOT / "scripts/rust/va1-invocations.rs").read_bytes()
        provenance["instrumentation_sha256"] = hashlib.sha256(helper).hexdigest()
        (crate / "src/va1_audit.rs").write_bytes(helper)
        with (crate / "src/lib.rs").open("a") as lib:
            lib.write("\n#[doc(hidden)]\npub mod va1_audit;\n")
        driver = crate / "examples/va1-samples.rs"
        text = driver.read_text()
        main = "fn main() -> Result<(), Box<dyn std::error::Error>> {"
        require(text.count(main) == 1, "cannot attach invocation audit lifetime to driver")
        driver.write_text(text.replace(main, main + "\n    let _audit = v::va1_audit::Guard;"))
        target = ROOT / "rust/target/va1-audit"
        subprocess.run(["cargo", "build", "--release", "--offline", "--locked", "-p", "wonky-validated",
                        "--example", "va1-samples", "--target-dir", str(target)], cwd=work, check=True,
                       stdout=sys.stderr)
        yield target / "release/examples/va1-samples", Path(directory) / "calls.txt", provenance


class Invocations:
    """Expected audit derived from validated rows; matched to real entry counters."""
    def __init__(self):
        self.counts = Counter({name: 0 for name in FUNCTIONS})
        self.fingerprints = {name: 0xcbf29ce484222325 for name in FUNCTIONS}

    def add(self, name, words):
        self.counts[name] += 1
        value = self.fingerprints[name]
        for byte in bytes.fromhex("".join(words)):
            value = ((value ^ byte) * 0x100000001b3) & MASK
        self.fingerprints[name] = value

    def verify(self, path):
        require(path.is_file(), "missing public API invocation audit")
        records = [line.split() for line in path.read_text().splitlines()]
        require(len(records) == len(FUNCTIONS), "incomplete public API invocation audit")
        for name, row in zip(FUNCTIONS, records):
            require(len(row) == 3 and row[0] == name and re.fullmatch(r"0|[1-9][0-9]*", row[1])
                    and re.fullmatch(r"[0-9a-f]{16}", row[2]), "noncanonical public API invocation audit")
        actual = Counter({row[0]: int(row[1]) for row in records})
        require(actual == self.counts, f"public API invocation census mismatch: actual {dict(actual)}, expected {dict(self.counts)}")
        for name, _, fingerprint in records:
            require(int(fingerprint, 16) == self.fingerprints[name], f"public API argument stream mismatch: {name}")
        return dict(actual)


def binary64(token):
    require(re.fullmatch(r"[0-9a-f]{16}", token), f"noncanonical binary64: {token!r}")
    x = struct.unpack(">d", bytes.fromhex(token))[0]
    require(math.isfinite(x), f"nonfinite binary64: {token}")
    return x


def number(token):
    return mp.mpf(binary64(token))


def enclosure(tokens, budget):
    require(len(tokens) == 2, "enclosure requires two endpoints")
    lo, hi = map(number, tokens)
    require(lo <= hi, "reversed enclosure")
    require(hi - lo <= budget, f"width {hi - lo} exceeds {budget}")
    return lo, hi


def contains(bounds, value, context):
    lo, hi = bounds
    if not lo <= value <= hi:
        raise ValueError(f"{context}: {mp.nstr(value, 80)} outside [{mp.nstr(lo, 80)}, {mp.nstr(hi, 80)}]")


def constants():
    # Alternating series encloses atan(1/q) between successive partial sums.
    def atan(q):
        n = 128
        partial = sum((F((-1) ** k, (2 * k + 1) * q ** (2 * k + 1)) for k in range(n)), F(0))
        other = partial + F((-1) ** n, (2 * n + 1) * q ** (2 * n + 1))
        return min(partial, other), max(partial, other)

    a, b = atan(5), atan(239)
    pi2 = (8 * a[0] - 2 * b[1], 8 * a[1] - 2 * b[0])
    n = 128
    partial = 2 * sum((F(1, (2 * k + 1) * 3 ** (2 * k + 1)) for k in range(n)), F(0))
    tail = 2 * F(1, (2 * n + 1) * 3 ** (2 * n + 1)) / (1 - F(1, 9))
    references = {"PIO2": pi2, "LN2": (partial, partial + tail)}
    source = (ROOT / "rust/wonky-validated/src/transcendental.rs").read_text()
    # Extract the actual numeric proof ingredients, not a duplicated fixture
    # or expected source text. The series above prove their mathematical values.
    remainder = re.search(r"const CONSTANT_REMAINDER: f64 = f64::from_bits\(\(1023 - (\d+)\) << 52\);", source)
    require(remainder is not None, "cannot read constant remainder proof bound")
    exponent = int(remainder[1])
    require(0 < exponent < 1023, "constant remainder is not positive normal")
    radius = F(1, 2 ** exponent)
    for name, (lo, hi) in references.items():
        match = re.search(rf"const {name}: \[f64; 3\] = \[([^\]]+)\];", source, re.S)
        require(match is not None, f"cannot read proof constant {name}")
        terms = [float(s.strip()) for s in match[1].split(",") if s.strip()]
        require(len(terms) == 3, f"{name} requires three binary64 terms")
        value = sum(map(F.from_float, terms), F(0))
        require(value - radius <= lo <= hi <= value + radius, f"unproved constant remainder: {name}")
    return list(references)


def scalar(row, expected_id):
    require(len(row) == 10 and row[0] == "S", f"expected scalar invocation {expected_id}, got {row[:4]}")
    require(row[1] == str(expected_id), f"missing/duplicated/out-of-order scalar {expected_id}")
    x, y = map(number, row[2:4])
    require(row[2:4] == corpus(expected_id), f"scalar corpus mismatch at {expected_id}: got {row[2:4]}")
    require(not (x == 0 and y == 0), "noncanonical atan2 origin")
    for name, fun, offset in [("sin", mp.sin, 4), ("cos", mp.cos, 6), ("atan2", None, 8)]:
        bounds = enclosure(row[offset:offset + 2], mp.mpf(1e-12))
        value = fun(x) if fun else mp.atan2(y, x)
        contains(bounds, value, f"sample {expected_id} {name}({row[2]},{row[3]})")


def extras(row):
    require(len(row) == 9 and row[0] == "E", f"expected extra invocation, got {row[:4]}")
    name = row[1]
    require(name in {"sin", "cos", "atan2", "acos", "exp", "log"}, "unknown function")
    m, r, ym, yr, budget = map(number, row[2:7])
    require(r >= 0 and yr >= 0 and budget >= 0, "noncanonical ball/budget")
    bounds = enclosure(row[7:], budget)
    xs = [m - r, m, m + r]
    if name == "atan2":
        for x in xs:
            for y in [ym - yr, ym, ym + yr]:
                contains(bounds, mp.atan2(y, x), f"whole-ball {name}")
    else:
        fun = getattr(mp, name)
        for x in xs:
            contains(bounds, fun(x), f"whole-ball {name}")
        if name in {"sin", "cos"}:
            offset = mp.pi / 2 if name == "sin" else 0
            first = int(mp.ceil((xs[0] - offset) / mp.pi))
            last = int(mp.floor((xs[-1] - offset) / mp.pi))
            for k in range(first, last + 1):
                contains(bounds, (-1) ** k, f"whole-ball {name} interior extremum")
    return name


def integral(row, name):
    require(len(row) == 7 and row[:2] == ["Q", name], f"missing integral {name}")
    budget = number(row[2])
    require(budget == mp.mpf(1e-10 if name == "sphere" else 1e-7), "integral budget changed")
    panels, evaluations = int(row[3]), int(row[4])
    require(1 <= panels <= 4096 and panels & (panels - 1) == 0, "bad panel count")
    require(evaluations == 3 * (2 * panels - 1), "evaluation count does not cover all attempted cells")
    exact = 36 * mp.pi if name == "sphere" else 10 * mp.pi ** 2
    contains(enclosure(row[5:], budget), exact, name)
    return {"panels": panels, "evaluations": evaluations}


def read_row(stream):
    line = stream.readline()
    require(bool(line), "truncated/all-refuse output; no invocation")
    return line.split()


def run(binary, audit_path, count, start):
    audit_path.unlink(missing_ok=True)
    invocations = Invocations()
    zero = "0000000000000000"
    env = {**os.environ, "WONKY_VA1_AUDIT": str(audit_path)}
    with subprocess.Popen([str(binary), str(count), str(start)], stdout=subprocess.PIPE, text=True, env=env) as child:
        try:
            for i in range(start, start + count):
                row = read_row(child.stdout)
                scalar(row, i)
                for name in ("sin", "cos", "atan2"):
                    invocations.add(name, [row[2], zero, row[3] if name == "atan2" else zero, zero, WIDTH_BITS])
                if (i + 1 - start) % 100_000 == 0:
                    print(f"checked {i + 1 - start}/{count} argument triples", file=sys.stderr, flush=True)
            extra_counts = Counter()
            for _ in range(6003):
                row = read_row(child.stdout)
                name = extras(row)
                extra_counts[name] += 1
                # Unary API calls do not receive the driver's unused y ball.
                invocations.add(name, [*row[2:4], *(row[4:6] if name == "atan2" else [zero, zero]), row[6]])
            require(extra_counts == Counter(sin=1000, cos=1000, atan2=1000, acos=1003, exp=1000, log=1000), "extra invocation census mismatch")
            quadrature = {name: integral(read_row(child.stdout), name) for name in ["sphere", "torus"]}
            require(child.stdout.read() == "", "unexpected trailing records")
            require(child.wait() == 0, "public API driver exited nonzero")
            actual = invocations.verify(audit_path)
            return {"scalar_calls": {name: actual[name] - extra_counts[name] for name in ("sin", "cos", "atan2")},
                    "extra_calls": dict(extra_counts), "public_api_calls": actual,
                    "argument_stream_verified": True, "quadrature": quadrature}
        finally:
            if child.poll() is None:
                child.terminate()
                child.wait()


def self_test(binary, audit_path):
    # A complete audited baseline precedes mutations of a real successful row.
    # These parser controls are not production evidence or fake kernel calls.
    run(binary, audit_path, 20, 0)
    result = subprocess.run([str(binary), "1", "0"], capture_output=True, text=True,
                            env={**os.environ, "WONKY_VA1_AUDIT": str(audit_path)}, check=True)
    good = result.stdout.splitlines()[0].split()
    scalar(good, 0)
    mutations = {}
    mutations["all-refuse"] = ["REFUSE", "0"]
    mutations["noncanonical-bits"] = good[:2] + ["0x" + good[2]] + good[3:]
    mutations["nan-result"] = good[:4] + ["7ff8000000000000"] + good[5:]
    mutations["duplicate-id"] = [good[0], "1"] + good[2:]
    mutations["overwide-overlap"] = good[:4] + ["bff0000000000000", "3ff0000000000000"] + good[6:]
    for name, row in mutations.items():
        try:
            scalar(row, 0)
        except ValueError:
            continue
        raise ValueError(f"checker survived {name}")
    from io import StringIO
    try:
        read_row(StringIO(""))
    except ValueError:
        pass
    else:
        raise ValueError("checker survived empty output")
    return [*mutations, "empty-output"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--count", type=int, default=1_000_000)
    parser.add_argument("--start", type=int, default=0)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    require(0 < args.count <= 1_000_000 and 0 <= args.start and args.start + args.count <= 1_000_000, "invalid sample range")
    proof = constants()
    with audited_binary() as (binary, audit_path, provenance):
        if args.self_test:
            report = {"checker_negative_controls": self_test(binary, audit_path), "constants": proof}
        else:
            report = run(binary, audit_path, args.count, args.start)
            report.update(precision_bits=256, constants=proof, start=args.start, count=args.count,
                          corpus_families=dict(Counter(str(i % 10) for i in range(args.start, args.start + args.count))))
        report.update(provenance, machine=os.environ["WONKY_REMOTE_PROFILE"])
        print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        sys.exit(f"VA1 FAIL: {error}")
