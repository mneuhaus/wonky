#!/usr/bin/env python3
"""Replay exact-predicate certificates with Python's exact rational arithmetic.

JSONL record format:
  {"predicate":"orient2d", "inputs":["0x...p..."],
   "claimed":{"Sign":"Positive"}}

Inputs are exactly representable finite binary64 values in canonical float.hex form. Sign
claims are checked against exact fractions. Proven claims use "=" or "!=" for
exact zero/nonzero. Refuse claims must match the supported range/domain refusal
policy; they do not claim that other inputs are decidable by the kernel.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from fractions import Fraction
from pathlib import Path
from typing import Any

FORMULAS_PATH = Path(__file__).with_name("predicate-formulas.json")
HEX_F64 = re.compile(r"^[+-]?0x(?:[0-9a-f]+(?:\.[0-9a-f]*)?|\.[0-9a-f]+)p[+-]?[0-9]+$", re.IGNORECASE)
SIGNS = {"Negative": -1, "Zero": 0, "Positive": 1}
MIN_INPUT = Fraction.from_float(1.0e-150)
MAX_INPUT = Fraction.from_float(1.0e150)
MIN_NORMAL = Fraction.from_float(sys.float_info.min)


class CertificateError(ValueError):
    """An invalid or mismatched certificate record."""


def require_canonical(value: str, parsed: float, index: int) -> None:
    # One spelling per value: the canonical float.hex form the Rust emitters write, so that equal
    # inputs cannot hide behind different strings (leading zeros, case, '+', short mantissas).
    if value != parsed.hex():
        raise CertificateError(f"input {index} is not canonical float.hex form (expected {parsed.hex()!r})")


def parse_input(value: Any, index: int) -> Fraction:
    if not isinstance(value, str) or HEX_F64.fullmatch(value) is None:
        raise CertificateError(f"input {index} must be a finite hex-f64 string")
    try:
        parsed = float.fromhex(value)
        mantissa_text, exponent_text = value.lower().lstrip("+-")[2:].split("p", 1)
        exponent = int(exponent_text)
    except (OverflowError, ValueError) as exc:
        raise CertificateError(f"input {index} is not a finite hex-f64 value") from exc
    if not math.isfinite(parsed):
        raise CertificateError(f"input {index} is not finite")

    whole, _, fractional = mantissa_text.partition(".")
    digits = (whole or "0") + fractional
    trailing_zeros = len(digits) - len(digits.rstrip("0"))
    digits = digits[:-trailing_zeros] if trailing_zeros else digits
    if not digits:
        require_canonical(value, parsed, index)
        return Fraction(0)
    significand = int(digits, 16)
    binary_exponent = exponent - 4 * len(fractional) + 4 * trailing_zeros
    trailing_bits = (significand & -significand).bit_length() - 1
    significand >>= trailing_bits
    binary_exponent += trailing_bits
    highest_bit = binary_exponent + significand.bit_length() - 1
    if significand.bit_length() > 53 or binary_exponent < -1074 or highest_bit > 1023:
        raise CertificateError(f"input {index} is not an exactly representable finite hex-f64 value")

    exact = (Fraction(significand << binary_exponent) if binary_exponent >= 0
             else Fraction(significand, 1 << -binary_exponent))
    if value.startswith("-"):
        exact = -exact
    if Fraction.from_float(parsed) != exact:
        raise CertificateError(f"input {index} is not an exactly representable finite hex-f64 value")
    require_canonical(value, parsed, index)
    return exact


def _cross(ax: Fraction, ay: Fraction, bx: Fraction, by: Fraction) -> Fraction:
    return ax * by - ay * bx


def _det3(a: tuple[Fraction, Fraction, Fraction],
          b: tuple[Fraction, Fraction, Fraction],
          c: tuple[Fraction, Fraction, Fraction]) -> Fraction:
    return (a[0] * (b[1] * c[2] - b[2] * c[1])
            + a[1] * (b[2] * c[0] - b[0] * c[2])
            + a[2] * (b[0] * c[1] - b[1] * c[0]))


def _one_surd(a: Fraction, b: Fraction, c: Fraction) -> int:
    """Exact sign of a + b*sqrt(c), using only rational comparisons."""
    if c < 0:
        raise CertificateError("one_surd_sign requires c >= 0")
    if c == 0 or b == 0:
        return _sign(a)
    sa, sb = _sign(a), _sign(b)
    if sa == 0:
        return sb
    if sa == sb:
        return sa
    compare_squares = _sign(a * a - b * b * c)
    return compare_squares if sa > 0 else -compare_squares


def _two_surd(a: Fraction, b: Fraction, c: Fraction,
              d: Fraction, e: Fraction) -> int:
    """Exact sign of a + b*sqrt(c) + d*sqrt(e) by sign-aware squaring."""
    if c < 0 or e < 0:
        raise CertificateError("two_surd_sign requires c >= 0 and e >= 0")
    left_sign = _one_surd(a, b, c)
    if d == 0 or e == 0:
        return left_sign
    right_sign = _sign(d)
    if left_sign == 0:
        return right_sign
    if left_sign == right_sign:
        return left_sign
    # (a + b*sqrt(c))^2 - d^2*e is itself a + b*sqrt(c).
    square_difference = _one_surd(a * a + b * b * c - d * d * e,
                                  2 * a * b, c)
    return square_difference if left_sign > 0 else -square_difference


def _sign(value: Fraction) -> int:
    return (value > 0) - (value < 0)


def _required_refusal(predicate: str, values: list[Fraction]) -> str | None:
    nonzero_magnitudes = [abs(value) for value in values if value]
    if any(value < MIN_NORMAL for value in nonzero_magnitudes):
        return "Subnormal"
    if any(value < MIN_INPUT or value > MAX_INPUT for value in nonzero_magnitudes):
        return "OutOfRange"
    if predicate == "one_surd_sign" and values[2] < 0:
        return "InvalidRadicand"
    if predicate == "two_surd_sign" and (values[2] < 0 or values[4] < 0):
        return "InvalidRadicand"
    return None


def evaluate(predicate: str, values: list[Fraction]) -> int:
    """Return the exact sign for a supported predicate."""
    if predicate == "orient2d":
        ax, ay, bx, by, cx, cy = values
        return _sign(_cross(bx - ax, by - ay, cx - ax, cy - ay))
    if predicate == "orient3d":
        ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz = values
        a = (bx - ax, by - ay, bz - az)
        b = (cx - ax, cy - ay, cz - az)
        c = (dx - ax, dy - ay, dz - az)
        return _sign(_det3(a, b, c))
    if predicate == "incircle":
        ax, ay, bx, by, cx, cy, dx, dy = values
        adx, ady = ax - dx, ay - dy
        bdx, bdy = bx - dx, by - dy
        cdx, cdy = cx - dx, cy - dy
        alift = adx * adx + ady * ady
        blift = bdx * bdx + bdy * bdy
        clift = cdx * cdx + cdy * cdy
        determinant = (alift * _cross(bdx, bdy, cdx, cdy)
                       + blift * _cross(cdx, cdy, adx, ady)
                       + clift * _cross(adx, ady, bdx, bdy))
        return _sign(determinant)
    if predicate == "plane_side":
        nx, ny, nz, px, py, pz, ox, oy, oz = values
        return _sign(nx * (px - ox) + ny * (py - oy) + nz * (pz - oz))
    if predicate == "one_surd_sign":
        return _one_surd(*values)
    if predicate == "two_surd_sign":
        return _two_surd(*values)
    raise CertificateError(f"unknown predicate {predicate!r}")


def _predicate_arities() -> dict[str, int]:
    try:
        table = json.loads(FORMULAS_PATH.read_text(encoding="utf-8"))
        if table.get("schema") != "wonky-exact-certificate/v1":
            raise CertificateError("unsupported predicate formula table schema")
        return {item["name"]: len(item["inputs"]) for item in table["predicates"]}
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise CertificateError(f"cannot load predicate formula table: {exc}") from exc


def judge_record(record: Any, line_number: int, arities: dict[str, int] | None = None) -> str:
    """Validate one decoded JSON record; return the accepted claim kind."""
    if not isinstance(record, dict):
        raise CertificateError(f"line {line_number}: record must be a JSON object")
    predicate = record.get("predicate")
    if not isinstance(predicate, str):
        raise CertificateError(f"line {line_number}: predicate must be a string")
    arities = _predicate_arities() if arities is None else arities
    if predicate not in arities:
        raise CertificateError(f"line {line_number}: unknown predicate {predicate!r}")
    raw_inputs = record.get("inputs")
    if not isinstance(raw_inputs, list) or len(raw_inputs) != arities[predicate]:
        raise CertificateError(
            f"line {line_number}: {predicate} expects {arities[predicate]} inputs"
        )
    claim = record.get("claimed")
    if not isinstance(claim, dict) or len(claim) != 1:
        raise CertificateError(f"line {line_number}: claimed must contain exactly one judgment")
    kind, asserted = next(iter(claim.items()))
    if kind not in {"Sign", "Proven", "Refuse"}:
        raise CertificateError(f"line {line_number}: unknown judgment {kind!r}")
    values = [parse_input(value, i) for i, value in enumerate(raw_inputs, start=1)]
    required_refusal = _required_refusal(predicate, values)

    if kind == "Refuse":
        if not isinstance(asserted, str) or not asserted.strip():
            raise CertificateError(f"line {line_number}: Refuse needs a non-empty reason")
        if required_refusal is None:
            raise CertificateError(
                f"line {line_number}: Refuse={asserted!r} is not justified by these inputs"
            )
        if asserted != required_refusal:
            raise CertificateError(
                f"line {line_number}: input policy requires Refuse={required_refusal}"
            )
        return kind
    if required_refusal is not None:
        raise CertificateError(
            f"line {line_number}: range policy requires Refuse={required_refusal}, not {kind}"
        )

    exact_sign = evaluate(predicate, values)
    if kind == "Sign":
        expected = next(name for name, sign in SIGNS.items() if sign == exact_sign)
        if asserted != expected:
            raise CertificateError(
                f"line {line_number}: {predicate} claimed Sign={asserted!r}, exact Sign={expected}"
            )
    else:
        if not isinstance(asserted, str) or asserted not in {"=", "!="}:
            raise CertificateError(f"line {line_number}: Proven must be '=' or '!='")
        expected = "=" if exact_sign == 0 else "!="
        if asserted != expected:
            raise CertificateError(
                f"line {line_number}: {predicate} claimed Proven={asserted!r}, exact Proven={expected!r}"
            )
    return kind


def check_jsonl(path: Path) -> tuple[int, dict[str, int]]:
    arities = _predicate_arities()
    counts = {"Sign": 0, "Proven": 0, "Refuse": 0}
    total = 0
    try:
        stream = path.open("r", encoding="utf-8")
    except OSError as exc:
        raise CertificateError(f"cannot open {path}: {exc}") from exc
    with stream:
        for line_number, line in enumerate(stream, start=1):
            if not line.strip():
                continue
            try:
                record = json.loads(line)
            except json.JSONDecodeError as exc:
                raise CertificateError(f"line {line_number}: invalid JSON: {exc.msg}") from exc
            kind = judge_record(record, line_number, arities)
            total += 1
            counts[kind] += 1
    return total, counts


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("certificates", type=Path, help="JSONL decision certificates")
    parser.add_argument("--expect-count", type=int, help="fail unless exactly this many records are checked")
    parser.add_argument(
        "--expect-decided-count", type=int,
        help="fail unless this many Sign/Proven decisions were independently checked",
    )
    parser.add_argument(
        "--allow-no-decisions", action="store_true",
        help="accept a file without any Sign/Proven decision (refusal-policy checks only)",
    )
    args = parser.parse_args(argv)
    try:
        total, counts = check_jsonl(args.certificates)
        decided = counts["Sign"] + counts["Proven"]
        if args.expect_count is not None and total != args.expect_count:
            raise CertificateError(f"expected {args.expect_count} certificates, got {total}")
        if args.expect_decided_count is not None and decided != args.expect_decided_count:
            raise CertificateError(
                f"expected {args.expect_decided_count} decided certificates, got {decided}"
            )
        # An empty or all-refuse file proves nothing; without an explicit count it must not pass.
        if decided == 0 and args.expect_decided_count is None and not args.allow_no_decisions:
            raise CertificateError(
                f"no decided certificates among {total} records (pass --allow-no-decisions for refusal-only files)"
            )
    except CertificateError as exc:
        print(str(exc), file=sys.stderr)
        return 1
    print(
        f"checked {total} certificates: {counts['Sign']} Sign, "
        f"{counts['Proven']} Proven, {counts['Refuse']} Refuse; "
        f"{decided} decided; 0 mismatches"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
