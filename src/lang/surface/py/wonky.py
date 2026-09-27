"""CPython shim for WPy (docs/language/proposal-surface.md).

A WPy program is a valid Python program. Under CPython this module makes it
run on real build123d/OCCT, which wonky uses only to *validate* artifacts
(AGENTS.md): the wonky extensions are defined here with their CPython meaning.

    param(default, ...)   -> the default (wonky overrides it from the CLI)
    expect(cond, message) -> raises AssertionError when cond is false
    KernelError           -> Exception (OCCT raises assorted exception types)
"""
from build123d import *  # noqa: F401,F403  (the WPy vocabulary is build123d-compatible)


def param(default, *, min=None, max=None, doc=None):  # noqa: A002 - mirrors the WPy signature
    if min is not None and default < min or max is not None and default > max:
        raise ValueError(f"parameter default {default} outside [{min}, {max}]")
    return default


def expect(cond, message="expect"):
    if not cond:
        raise AssertionError(message)


KernelError = Exception


def frozen_import(document, version, part=None):
    """Reference geometry frozen by document/version hash (wonky: src/modules.mjs
    snapshots). Not reachable from plain CPython; the validation run needs a STEP
    export of the same snapshot."""
    raise NotImplementedError(f"frozen import {document}@{version} is only available inside wonky")
