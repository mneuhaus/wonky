#!/usr/bin/env -S uv run --script
"""Independent N3 acceptance: fractions + integer-sqrt enclosures, NOT the
production squaring recurrence. Runs the real Rust driver in bounded batches.
Exact zeros use square-class collection (sqrt(q1/q2) rational), valid for a
linear combination of principal square roots of rationals. Distinct square
classes are linearly independent over Q. No float oracle or Bend oracle.
"""
import argparse
from collections import Counter
from fractions import Fraction as Q
from functools import lru_cache
import hashlib
import json
import math
from pathlib import Path
import random
import struct
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]


def rational_sqrt(q):
    n, d = math.isqrt(q.numerator), math.isqrt(q.denominator)
    return Q(n, d) if n * n == q.numerator and d * d == q.denominator else None


@lru_cache(maxsize=4096)
def enclosure(q, bits):
    # Integer inequality k²*d <= n*2^(2bits) < (k+1)²*d is the certificate.
    k = math.isqrt((q.numerator << (2 * bits)) // q.denominator)
    low = Q(k, 1 << bits)
    return low, low if k * k * q.denominator == q.numerator << (2 * bits) else Q(k + 1, 1 << bits)


def bounds(terms, bits):
    low = high = Q(0)
    for coefficient, radicand in terms:
        if not coefficient or not radicand:
            continue
        a, b = enclosure(radicand, bits)
        if coefficient < 0:
            a, b = b, a
        low += coefficient * a
        high += coefficient * b
    return (1 if low > 0 else -1 if high < 0 else 0 if low == high == 0 else None)


def reference(terms):
    s = bounds(terms, 64)
    if s is not None:
        return s
    groups = []
    for c, r in terms:
        if not c or not r:
            continue
        for i, (coefficient, radicand) in enumerate(groups):
            ratio = rational_sqrt(r / radicand)
            if ratio is not None:
                groups[i] = (coefficient + c * ratio, radicand)
                break
        else:
            groups.append((c, r))
    groups = [(c, r) for c, r in groups if c]
    if not groups:
        return 0
    for bits in (128, 256, 512, 1024, 2048):
        s = bounds(groups, bits)
        if s is not None:
            return s
    raise AssertionError("independent oracle budget exhausted (not a passed refusal)")


def simple_terms(xs):
    return [(Q(xs[0]), Q(1))] + [(Q(xs[i]), Q(xs[i + 1])) for i in (1, 3, 5)]


def perturb(value, direction, scale):
    # nextafter(0) is subnormal and outside the admitted input domain. Preserve
    # the near-zero nonzero case with an exact in-domain dyadic perturbation.
    return math.nextafter(value, direction) if value != 0 else math.copysign(math.ldexp(scale, -50), direction)


def sample(rng, near, i):
    scale = math.ldexp(1.0, rng.randrange(-20, 21))
    if not near:
        coefficients = [math.ldexp(rng.uniform(-2, 2), rng.randrange(-20, 21)) for _ in range(4)]
        roots = [math.ldexp(rng.uniform(1, 2), rng.randrange(-20, 21)) for _ in range(3)]
        if i % 4 == 0:
            roots = [float(rng.randrange(1, 1_000_000)) for _ in range(3)]
        a, b, d, f = coefficients
    elif i % 4 == 0:
        # Three exact norm squares from integer Pythagorean triples (m²-n²,2mn,m²+n²).
        hypotenuses = [m * m + n * n for m, n in [(rng.randrange(2, 80), rng.randrange(1, 80)) for _ in range(3)]]
        roots = [float(h * h) for h in hypotenuses]
        b, d, f = [rng.choice([-7, -3, -1, 1, 3, 7]) * scale for _ in range(3)]
        a = -sum(c * h for c, h in zip((b, d, f), hypotenuses))
        if i % 3 != 0:
            a = perturb(a, math.inf if i % 3 == 1 else -math.inf, scale)
    elif i % 4 == 1:
        r = float(rng.randrange(1, 10000))
        roots = [r, 4 * r, 9 * r]
        b, d, f = scale, scale, -scale
        a = (i % 3 - 1) * math.ldexp(scale, -50)
    else:
        roots = [float(rng.choice([2, 3, 5, 7, 11, 13, 17])) for _ in range(3)] if i % 4 == 2 else [rng.uniform(1, 2) for _ in range(3)]
        b, d, f = [rng.choice([-3, -1, 1, 3]) * scale for _ in range(3)]
        a = -sum(c * math.sqrt(r) for c, r in zip((b, d, f), roots))
        if i % 3 != 0:
            a = perturb(a, math.inf if i % 3 == 1 else -math.inf, scale)
    xs = [a, b, roots[0], d, roots[1], f, roots[2]]
    assert all(math.isfinite(x) and (x == 0 or 1e-150 <= abs(x) <= 1e150) for x in xs), f"generator outside wonky-num domain: near={near} i={i} {xs!r}"
    if i % 8 == 0 and not near:
        # Nontrivial exact subtraction and basis permutation, not only x==x.
        other = [rng.uniform(-8, 8), -f / 2, roots[2], -b / 2, roots[0], -d / 2, roots[1]]
        terms = simple_terms(xs) + [(-c, r) for c, r in simple_terms(other)]
        return "c", xs + other, reference(terms), "random_compare"
    return "s", xs, reference(simple_terms(xs)), "near" if near else "random"


def basis_sample(rng, i):
    # The public basis constructor also serves stripe expressions, including
    # products of the same three roots. Exercise its full domain independently
    # of the simpler sum/compare corpus and the six planar fixture jobs.
    # Bound bit-height as well as magnitude: unrestricted 53-bit dense bases
    # can legitimately hit the expansion product floor during repeated squaring
    # (a preserved public-boundary witness lives in contracts.rs).
    roots = [math.ldexp(float(rng.randrange(1, 32)), rng.randrange(-4, 5)) for _ in range(3)]
    coefficients = [rng.randrange(-256, 257) / 128 for _ in range(8)]
    radicands = [math.prod((Q(r) for j, r in enumerate(roots) if mask & (1 << j)), start=Q(1)) for mask in range(8)]
    if i % 2:
        coefficients[0] = -sum(c * math.sqrt(float(r)) for c, r in zip(coefficients[1:], radicands[1:]))
    return "q", roots + coefficients, reference(list(zip(map(Q, coefficients), radicands))), "basis"


def f32(word):
    return struct.unpack("!f", struct.pack("!I", int(word)))[0]


def words(values):
    assert len(values) % 2 == 0
    # The frozen jobs contain F32x2 words; the replay's authoritative input is
    # their f64 sum. This is declared conversion, not a claim of Bend parity.
    return [f32(values[i]) + f32(values[i + 1]) for i in range(0, len(values), 2)]


def dot(a, b):
    return sum((x * y for x, y in zip(a, b)), Q(0))


def cross(a, b):
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]


def stripe_reference(xs):
    ch, side, convex = xs[:3]
    size, offset = map(Q, xs[3:5])
    ni, nj, t, e, x = [list(map(Q, xs[i:i + 3])) for i in (5, 8, 11, 14, 17)]
    roots = [dot(ni, ni), dot(nj, nj), dot(t, t)]
    p = dot(cross(ni, t) if side else cross(t, ni), [a - b for a, b in zip(x, e)])
    if ch:
        return reference([(p, Q(1)), (-(size + offset), roots[0] * roots[2])])
    nn = dot(ni, nj)
    det = dot(ni, cross(t, nj)) if side else dot(nj, cross(t, ni))
    # Expand the *mathematical* numerator p(√ri√rj+ni.nj)-rs*det√ri
    # minus offset * √rt√ri(√ri√rj+ni.nj). No production polynomial operations.
    return reference([(p * nn, Q(1)), (p, roots[0] * roots[1]),
                      ((size if convex else -size) * det, roots[0]),
                      (-offset * roots[0], roots[1] * roots[2]),
                      (-offset * nn, roots[0] * roots[2])])


def fixture_rows(provenance):
    names = ["pp-box-vertical-edge-r2", "pp-convex-60-r2", "pp-convex-120-hex-r2",
             "pp-l-concave-and-convex-r2", "ch-box-vertical-edge-d1", "ch-convex-60-d1"]
    for name in names:
        path = ROOT / "fixtures/fillet/jobs" / (name + ".job")
        raw = path.read_bytes()
        meta = json.loads(path.with_suffix(".json").read_text())
        sha = hashlib.sha256(raw).hexdigest()
        assert sha == meta["jobSha256"], f"changed frozen job: {path}"
        provenance.append({"path": str(path.relative_to(ROOT)), "sha256": sha})
        vertices, edges, faces = [], [], []
        size = ch = None
        for line in raw.decode().splitlines():
            w = line.split()
            if w[0] == "size": size = words(w[1:])[0]
            elif w[0] == "op": ch = float(w[1] == "chamfer")
            elif w[0] == "v": vertices.append(words(w[1:]))
            elif w[0] == "e":
                assert w[3] == "line", name
                edges.append((words(w[4:10]), [v * (1 if w[16] == "1" else -1) for v in words(w[10:16])]))
            elif w[0] == "f":
                assert w[2] == "plane", name
                normal = [v * (1 if w[1] == "1" else -1) for v in words(w[9:15])]
                indices = []
                cursor = 22
                for _ in range(int(w[21])):
                    assert w[cursor] == "l"
                    count = int(w[cursor + 2])
                    indices.extend(int(w[cursor + 3 + j * 2]) for j in range(count))
                    cursor += 3 + count * 2
                assert cursor == len(w)
                faces.append((normal, indices))
        assert size is not None and ch is not None
        for selected in meta["selected"]:
            edge = selected["edge"]
            adjacent = [n for n, es in faces if edge in es]
            assert len(adjacent) == 2
            origin, tangent = edges[edge]
            convex = float(selected["convexity"] == "convex")
            for side in (0.0, 1.0):
                ni, nj = adjacent if side else list(reversed(adjacent))
                for point in vertices:
                    for offset in (0.0, -1e-6, 1e-6):
                        xs = [ch, side, convex, size, offset] + ni + nj + tangent + origin + point
                        yield "t", xs, stripe_reference(xs), "fixture"


def encoded(op, index, xs):
    return f"{op} {index} " + " ".join(struct.pack("!d", x).hex() for x in xs)


def parse_results(text, expected_count):
    lines = text.splitlines()
    assert len(lines) == expected_count, f"driver count {len(lines)} != {expected_count}"
    results = []
    for i, line in enumerate(lines):
        fields = line.split(" ")
        assert len(fields) == 2 and fields[0] == str(i) and fields[1] in ("-1", "0", "1"), f"noncanonical result/refusal: {line}"
        results.append(int(fields[1]))
    return results


def check_driver_protocol(binary):
    for row in ("s 0 " + "0" * 16 + "\n", "s 00 " + " ".join(["0000000000000000"] * 7) + "\n",
                "s 0 " + " ".join(["3FF0000000000000"] * 7) + "\n"):
        p = subprocess.run([binary], input=row, text=True, capture_output=True)
        assert p.returncode != 0 and p.stderr, "noncanonical input accepted"
    for text, n in [("0 refuse test Unresolved\n", 1), ("0 1\n", 2), ("00 1\n", 1), ("0 01\n", 1)]:
        try:
            parse_results(text, n)
        except AssertionError:
            pass
        else:
            raise AssertionError("validator accepted all-refuse/missing/noncanonical results")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", required=True)
    parser.add_argument("--random", type=int, default=1_000_000)
    parser.add_argument("--near", type=int, default=100_000)
    parser.add_argument("--seed", type=int, default=0x4E330926)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    assert args.random >= 0 and args.near >= 0
    start = time.monotonic()
    check_driver_protocol(args.binary)
    rng, counts, signs = random.Random(args.seed), Counter(), Counter()
    digest, provenance = hashlib.sha256(), []
    def rows():
        for i in range(args.random): yield sample(rng, False, i)
        for i in range(args.near): yield sample(rng, True, i)
        yield from fixture_rows(provenance)
        for i in range(4096): yield basis_sample(rng, i)
    batch = []
    def run_batch():
        payload = "\n".join(encoded(op, i, xs) for i, (op, xs, _, _) in enumerate(batch)) + "\n"
        digest.update(payload.encode())
        p = subprocess.run([args.binary], input=payload, text=True, capture_output=True)
        if p.stderr: sys.stderr.write(p.stderr)
        assert p.returncode == 0, f"driver exited {p.returncode}"
        try:
            actual = parse_results(p.stdout, len(batch))
        except AssertionError as error:
            refused = [(batch[i], line) for i, line in enumerate(p.stdout.splitlines()) if " refuse " in line and i < len(batch)]
            raise AssertionError(f"{error}; completed={dict(counts)!r}; first refusals={refused[:3]!r}") from error
        for i, ((op, xs, expected, group), got) in enumerate(zip(batch, actual)):
            assert got == expected, f"wrong sign: {group} {op} {xs!r}; got {got}, expected {expected}"
            counts[group] += 1
            signs[str(got)] += 1
        batch.clear()
    for row in rows():
        batch.append(row)
        if len(batch) == 2048: run_batch()
    if batch: run_batch()
    assert counts["random"] + counts["random_compare"] == args.random
    assert counts["near"] == args.near and counts["fixture"] == 384 and counts["basis"] == 4096
    if args.near >= 1000: assert signs["0"] > 0 and signs["-1"] > 0 and signs["1"] > 0
    result = {"schema": "wonky-n3-acceptance/1", "seed": args.seed,
              "counts": dict(counts), "signs": dict(signs), "actualInvocations": sum(counts.values()),
              "wrong": 0, "refusals": 0, "inputSha256": digest.hexdigest(),
              "fixtures": provenance, "wallSeconds": round(time.monotonic() - start, 3),
              "noClaim": "Three-root class only; no general algebraic numbers, full fillet geometry or domain completeness."}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
