"""cad_khana manufacturing method settings (plain data, provided)."""

from __future__ import annotations

from dataclasses import dataclass

from cad_khana import _wonky


@dataclass(frozen=True)
class FDM:
    up_axis: tuple[float, float, float] = (0, 0, 1)
    wall_min_mm: float = 1.5
    overhang_max_deg: float = 45.0


__getattr__ = _wonky.module_getattr(__name__)
