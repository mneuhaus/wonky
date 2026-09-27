#!/usr/bin/env python3
"""Tests for exact-judge.py; the K0 RNG adapter is replaced by native JSONL when available."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import math
import struct
import subprocess
import sys
import tempfile
import unittest
from fractions import Fraction
from pathlib import Path

SCRIPT = Path(__file__).with_name("exact-judge.py")
spec = importlib.util.spec_from_file_location("exact_judge", SCRIPT)
assert spec is not None and spec.loader is not None
exact_judge = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = exact_judge
spec.loader.exec_module(exact_judge)


class K0Rng:
    """Test-only port of Rng in rust/wonky-num/tests/properties.rs (K0)."""

    MASK = (1 << 64) - 1
    BAD = [
        5.0e-324, -5.0e-324, 2.225e-308, -1.0e-310, 1.0e-151,
        -1.0e-160, float.fromhex("0x1.0000000000000p-1022"), 1.0e151,
        -1.0e200, sys.float_info.max, math.inf, -math.inf, math.nan, -math.nan,
    ]

    def __init__(self, seed: int):
        self.state = seed

    def next(self) -> int:
        x = self.state
        x ^= (x << 13) & self.MASK
        x ^= x >> 7
        x ^= (x << 17) & self.MASK
        self.state = x & self.MASK
        return self.state

    def below(self, n: int) -> int:
        return self.next() % n

    def unit(self) -> float:
        return (self.next() >> 11) / (1 << 53)

    def sgn(self) -> float:
        return 1.0 if self.next() & 1 == 0 else -1.0

    def cad(self) -> float:
        s = self.sgn()
        choice = self.below(8)
        if choice == 0:
            return s * 0.0
        if choice == 1:
            return s * self.below(200)
        if choice == 2:
            return s * self.below(4096) / 64.0
        if choice == 3:
            return s * (self.below(100000) * 0.001)
        if choice == 4:
            return s * self.unit() * 1.0e4
        if choice == 5:
            return s * self.unit() * 1.0e9
        if choice == 6:
            return s * (1.0 + self.unit()) * 1.0e-6
        return s * self.below(7)

    def wide(self) -> float:
        s = self.sgn()
        choice = self.below(10)
        if choice == 0:
            return s * 1.0e-150
        if choice == 1:
            return s * 1.0e150
        return s * (1.0 + self.unit()) * 10.0 ** (self.below(299) - 150)

    def bad(self) -> float:
        x = self.BAD[self.below(len(self.BAD))]
        choice = self.below(3)
        if choice == 0:
            return math.nextafter(1.0e-150, -math.inf)
        if choice == 1:
            return math.nextafter(1.0e150, math.inf)
        return x

    def full(self) -> float:
        while True:
            value = struct.unpack(">d", self.next().to_bytes(8, "big"))[0]
            if math.isfinite(value):
                return value

    def any(self) -> float:
        choice = self.below(100)
        if choice <= 87:
            return self.cad()
        if choice <= 95:
            return self.wide()
        if choice <= 97:
            return self.bad()
        return self.full()


def q(value: float) -> Fraction:
    return Fraction.from_float(value)


def sign(value: Fraction) -> str:
    return "Positive" if value > 0 else "Negative" if value < 0 else "Zero"


def oracle(predicate: str, xs: list[float]) -> str:
    """Independent direct Fraction formulas, kept separate from production dispatch."""
    v = [q(x) for x in xs]
    if predicate == "orient2d":
        ax, ay, bx, by, cx, cy = v
        result = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    elif predicate == "orient3d":
        ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz = v
        u, w, t = (bx-ax, by-ay, bz-az), (cx-ax, cy-ay, cz-az), (dx-ax, dy-ay, dz-az)
        result = u[0] * (w[1]*t[2] - w[2]*t[1]) - u[1] * (w[0]*t[2] - w[2]*t[0]) + u[2] * (w[0]*t[1] - w[1]*t[0])
    elif predicate == "plane_side":
        nx, ny, nz, px, py, pz, ox, oy, oz = v
        result = nx*(px-ox) + ny*(py-oy) + nz*(pz-oz)
    elif predicate == "incircle":
        ax, ay, bx, by, cx, cy, dx, dy = v
        aa, ab, ba, bb, ca, cb = ax-dx, ay-dy, bx-dx, by-dy, cx-dx, cy-dy
        # Generic determinant expansion, not the translated-lift implementation in exact-judge.py.
        result = ((aa*aa + ab*ab) * (ba*cb - bb*ca)
                  - (ba*ba + bb*bb) * (aa*cb - ab*ca)
                  + (ca*ca + cb*cb) * (aa*bb - ab*ba))
    else:
        raise AssertionError(predicate)
    return sign(result)


def refusal_reason(values: list[float]) -> str | None:
    nonzero = [abs(value) for value in values if value != 0.0]
    if any(value < sys.float_info.min for value in nonzero):
        return "Subnormal"
    if any(not (1.0e-150 <= value <= 1.0e150) for value in nonzero):
        return "OutOfRange"
    return None


class ExactJudgeTests(unittest.TestCase):
    def test_known_signs_and_proven_claims(self):
        cases = [
            {"predicate": "orient2d", "inputs": ["0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0", "0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0"], "claimed": {"Sign": "Positive"}},
            {"predicate": "orient3d", "inputs": ["0x0.0p+0", "0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0", "0x0.0p+0", "0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0", "0x0.0p+0", "0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0"], "claimed": {"Sign": "Positive"}},
            {"predicate": "incircle", "inputs": ["0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0", "0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0", "0x1.999999999999ap-4", "0x1.999999999999ap-4"], "claimed": {"Sign": "Positive"}},
            {"predicate": "plane_side", "inputs": ["0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0", "0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0", "0x0.0p+0", "0x0.0p+0", "0x0.0p+0"], "claimed": {"Proven": "!="}},
            {"predicate": "plane_side", "inputs": ["0x1.0000000000000p+0", "0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+1", "0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+1", "0x0.0p+0", "0x0.0p+0"], "claimed": {"Proven": "="}},
            {"predicate": "one_surd_sign", "inputs": ["0x1.0000000000000p+0", "-0x1.0000000000000p+0", "0x1.0000000000000p+0"], "claimed": {"Sign": "Zero"}},
            {"predicate": "two_surd_sign", "inputs": ["0x0.0p+0", "0x1.0000000000000p+0", "0x1.0000000000000p+0", "-0x1.0000000000000p+0", "0x1.0000000000000p+0"], "claimed": {"Sign": "Zero"}},
            {"predicate": "orient2d", "inputs": ["0x1.0000000000000p+500", "0x0.0p+0", "0x0.0p+0", "0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0"], "claimed": {"Refuse": "OutOfRange"}},
        ]
        for line, record in enumerate(cases, 1):
            self.assertIn(exact_judge.judge_record(record, line), {"Sign", "Proven", "Refuse"})

    def test_sign_aware_surd_cases(self):
        cases = [
            ((1, -1, 1), 0),
            ((1, -2, 1), -1),
            ((2, -1, 1), 1),
            ((-1, 1, 4), 1),
            ((1, 1, 0), 1),
        ]
        for (a, b, c), expected in cases:
            self.assertEqual(exact_judge._one_surd(*(Fraction(x) for x in (a, b, c))), expected)
        two = [
            ((0, 1, 1, -1, 1), 0),
            ((-1, 1, 1, 1, 1), 1),
            ((-3, 1, 1, 1, 1), -1),
            ((1, 1, 1, -1, 4), 0),
        ]
        for xs, expected in two:
            self.assertEqual(exact_judge._two_surd(*(Fraction(x) for x in xs)), expected)
        with self.assertRaisesRegex(exact_judge.CertificateError, "c >= 0"):
            exact_judge._one_surd(Fraction(0), Fraction(1), Fraction(-1))

    def test_unknown_name_and_flipped_sign_report_line(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "negative.jsonl"
            good = {"predicate": "orient2d", "inputs": ["0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0", "0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0"], "claimed": {"Sign": "Positive"}}
            good_line = json.dumps(good)
            flipped = json.dumps(dict(good, claimed={"Sign": "Negative"}))
            path.write_text(good_line + "\n", encoding="utf-8")
            result = subprocess.run([sys.executable, str(SCRIPT), "--expect-count", "1", str(path)], text=True, capture_output=True, check=False)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("checked 1 certificates", result.stdout)
            result = subprocess.run([sys.executable, str(SCRIPT), "--expect-count", "2", str(path)], text=True, capture_output=True, check=False)
            self.assertEqual(result.returncode, 1)
            self.assertIn("expected 2 certificates, got 1", result.stderr)

            # Keep a late planted error within the 100k-line acceptance window.
            with path.open("w", encoding="utf-8") as output:
                for _ in range(99_998):
                    output.write(good_line + "\n")
                output.write(flipped + "\n")
            result = subprocess.run([sys.executable, str(SCRIPT), str(path)], text=True, capture_output=True, check=False)
            self.assertEqual(result.returncode, 1)
            self.assertIn("line 99999:", result.stderr)
            self.assertIn("exact Sign=Positive", result.stderr)

            unknown = dict(good, predicate="not_a_predicate")
            path.write_text(good_line + "\n" + json.dumps(unknown) + "\n", encoding="utf-8")
            result = subprocess.run([sys.executable, str(SCRIPT), str(path)], text=True, capture_output=True, check=False)
            self.assertEqual(result.returncode, 1)
            self.assertIn("line 2: unknown predicate", result.stderr)

    def test_k0_rng_property_batch_100k(self):
        # Adapter reproduces K0's deterministic xorshift/any() inputs. K0 currently
        # does not emit JSONL and has no incircle predicate; these oracle-signed
        # records validate replay only, not agreement with Rust. Replace this adapter
        # once the K0 property runner emits certificates directly.
        predicates = [
            ("orient2d", 0xBF58476D1CE4E5B9, 6),
            ("orient3d", 0x2545F4914F6CDD1D, 12),
            ("incircle", 0xD1B54A32D192ED03, 8),
            ("plane_side", 0x9E3779B97F4A7C15, 9),
        ]
        records_per_predicate = 25_000
        expected_decided = 0
        expected_refused = 0
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "property-cases.jsonl"
            with path.open("w", encoding="utf-8") as output:
                for predicate, seed, arity in predicates:
                    rng = K0Rng(seed)
                    written = 0
                    while written < records_per_predicate:
                        xs = [rng.any() for _ in range(arity)]
                        if not all(math.isfinite(x) for x in xs):
                            continue
                        inputs = [x.hex() for x in xs]
                        reason = refusal_reason(xs)
                        if reason is not None:
                            claim = {"Refuse": reason}
                            expected_refused += 1
                        else:
                            claim = {"Sign": oracle(predicate, xs)}
                            expected_decided += 1
                        output.write(json.dumps({"predicate": predicate, "inputs": inputs, "claimed": claim}) + "\n")
                        written += 1
            count, counts = exact_judge.check_jsonl(path)
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--expect-count", "100000",
                 "--expect-decided-count", str(expected_decided), str(path)],
                text=True, capture_output=True, check=False,
            )
        self.assertEqual(count, 100_000)
        self.assertEqual(counts["Sign"] + counts["Proven"], expected_decided)
        self.assertEqual(counts["Refuse"], expected_refused)
        self.assertGreater(counts["Refuse"], 0)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"{expected_decided} decided", result.stdout)

    def test_100k_false_refusals_fail_the_acceptance_gate(self):
        record = {"predicate": "orient2d", "inputs": ["0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0",
                  "0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0"], "claimed": {"Refuse": "OutOfRange"}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "false-refusals.jsonl"
            path.write_text((json.dumps(record) + "\n") * 100_000, encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(SCRIPT), "--expect-count", "100000",
                 "--expect-decided-count", "100000", str(path)],
                text=True, capture_output=True, check=False,
            )
        self.assertEqual(result.returncode, 1)
        self.assertIn("line 1:", result.stderr)
        self.assertIn("not justified by these inputs", result.stderr)

    def test_formula_table_names_and_unknown_input_validation(self):
        table = json.loads(exact_judge.FORMULAS_PATH.read_text(encoding="utf-8"))
        names = {predicate["name"] for predicate in table["predicates"]}
        self.assertTrue({"orient2d", "orient3d", "incircle", "plane_side"} <= names)
        with self.assertRaisesRegex(exact_judge.CertificateError, "hex-f64"):
            exact_judge.parse_input("1.0", 1)
        with self.assertRaisesRegex(exact_judge.CertificateError, "expects 6 inputs"):
            exact_judge.judge_record({"predicate": "orient2d", "inputs": [], "claimed": {"Sign": "Zero"}}, 7)

    def test_hex_f64_rejects_values_rounded_by_float_fromhex(self):
        for value in ("0x1p-1075", "0x1.00000000000008p+0", "0x1.8p-1074"):
            with self.subTest(value=value), self.assertRaisesRegex(
                exact_judge.CertificateError, "exactly representable"
            ):
                exact_judge.parse_input(value, 4)
        self.assertEqual(exact_judge.parse_input("0x0.0000000000001p-1022", 1), Fraction(1, 1 << 1074))
        self.assertEqual(exact_judge.parse_input("-0x0.0p+0", 1), Fraction(0))

    def test_empty_or_all_refuse_files_do_not_pass_without_an_explicit_count(self):
        refusal = {"predicate": "orient2d", "claimed": {"Refuse": "OutOfRange"},
                   "inputs": ["0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+500", "0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0"]}
        with tempfile.TemporaryDirectory() as tmp:
            empty = Path(tmp) / "empty.jsonl"
            empty.write_text("", encoding="utf-8")
            refuse_only = Path(tmp) / "refuse.jsonl"
            refuse_only.write_text(json.dumps(refusal) + "\n", encoding="utf-8")
            self.assertEqual(exact_judge.check_jsonl(refuse_only), (1, {"Sign": 0, "Proven": 0, "Refuse": 1}))
            for path in (empty, refuse_only):
                with self.subTest(path=path.name), contextlib.redirect_stderr(io.StringIO()) as err:
                    self.assertEqual(exact_judge.main([str(path)]), 1)
                    self.assertIn("no decided certificates", err.getvalue())
            with contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(exact_judge.main(["--allow-no-decisions", str(refuse_only)]), 0)
                self.assertEqual(exact_judge.main(["--expect-decided-count", "0", str(refuse_only)]), 0)

    def test_hex_f64_rejects_noncanonical_spellings_of_valid_values(self):
        canonical = "0x1.c68ebf71cdb20p+17"
        self.assertEqual(exact_judge.parse_input(canonical, 1), Fraction.from_float(float.fromhex(canonical)))
        for value in ("0x01.c68ebf71cdb20p+17", "0X1.C68EBF71CDB20P+17", "+0x1.c68ebf71cdb20p+17",
                      "0x1.c68ebf71cdb2p+17", "0x3.8d1d7ee3b6400p+16", "0x1p+0", "0x1p-1074", "-0x0p+999"):
            with self.subTest(value=value), self.assertRaisesRegex(exact_judge.CertificateError, "canonical"):
                exact_judge.parse_input(value, 2)

    def test_range_refusals_must_match_policy_and_out_of_range_must_not_claim_sign(self):
        inputs = ["0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0", "0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0"]
        valid_refusal = {"predicate": "orient2d", "inputs": inputs, "claimed": {"Refuse": "OutOfRange"}}
        with self.assertRaisesRegex(exact_judge.CertificateError, "not justified by these inputs"):
            exact_judge.judge_record(valid_refusal, 12)
        arbitrary_refusal = dict(valid_refusal, claimed={"Refuse": "NotExact"})
        with self.assertRaisesRegex(exact_judge.CertificateError, "not justified by these inputs"):
            exact_judge.judge_record(arbitrary_refusal, 12)

        too_small = ["0x0.0p+0", "0x0.0p+0", "0x0.0000000000001p-1022", "0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0"]
        with self.assertRaisesRegex(exact_judge.CertificateError, "requires Refuse=Subnormal"):
            exact_judge.judge_record({"predicate": "orient2d", "inputs": too_small,
                                      "claimed": {"Sign": "Positive"}}, 13)
        with self.assertRaisesRegex(exact_judge.CertificateError, "requires Refuse=Subnormal"):
            exact_judge.judge_record({"predicate": "orient2d", "inputs": too_small,
                                      "claimed": {"Refuse": "OutOfRange"}}, 14)
        accepted = {"predicate": "orient2d", "inputs": too_small, "claimed": {"Refuse": "Subnormal"}}
        self.assertEqual(exact_judge.judge_record(accepted, 15), "Refuse")

        too_large = ["0x1.0000000000000p+500", "0x0.0p+0", "0x1.0000000000000p+0", "0x0.0p+0", "0x0.0p+0", "0x1.0000000000000p+0"]
        accepted = {"predicate": "orient2d", "inputs": too_large, "claimed": {"Refuse": "OutOfRange"}}
        self.assertEqual(exact_judge.judge_record(accepted, 16), "Refuse")


if __name__ == "__main__":
    unittest.main(verbosity=2)
