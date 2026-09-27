"""Resolve user-supplied ``out=`` paths relative to the running script (as cad_khana)."""

from __future__ import annotations

import sys
from pathlib import Path


def resolve_out(out) -> Path:
    p = Path(out)
    if p.is_absolute():
        return p
    main_file = getattr(sys.modules.get("__main__"), "__file__", None)
    if main_file is None:
        return p
    return Path(main_file).resolve().parent / p
