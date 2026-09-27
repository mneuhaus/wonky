"""cad_khana's declared assembly assertions.

The records are the same frozen dataclasses as in cad_khana. Evaluating them
needs Boolean interference volumes and minimum distances between placed parts,
which is cad_khana's check() diagnostic; wonky refuses it at the call.
"""

from __future__ import annotations

from dataclasses import dataclass

from cad_khana import _wonky

_EVALUATE = "assertion evaluation (interference volume, clearance distance) is part of check()"


def _refused_evaluate(self, parts):
    return _wonky.unsupported(_wonky._refusal(f"cad_khana {type(self).__name__}.evaluate()", _EVALUATE))


@dataclass(frozen=True)
class NoInterference:
    a: str
    b: str
    name: str

    evaluate = _refused_evaluate

    def _wonky_record(self):
        return {"type": "no_interference", "name": self.name, "a": self.a, "b": self.b}


@dataclass(frozen=True)
class Clearance:
    a: str
    b: str
    min_mm: float
    name: str

    evaluate = _refused_evaluate

    def _wonky_record(self):
        return {"type": "clearance", "name": self.name, "a": self.a, "b": self.b, "minMm": self.min_mm}


@dataclass(frozen=True)
class ExpectedInterference:
    a: str
    b: str
    name: str
    reason: str | None = None

    evaluate = _refused_evaluate

    def _wonky_record(self):
        return {"type": "interference", "name": self.name, "a": self.a, "b": self.b, "reason": self.reason}


Assertion = NoInterference | Clearance | ExpectedInterference

evaluate = _wonky.refused_call("cad_khana.mechanism.assertions.evaluate", _EVALUATE)

__getattr__ = _wonky.module_getattr(__name__)
