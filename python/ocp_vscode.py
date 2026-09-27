"""Wonky-provided ocp_vscode: show()/show_object() record model outputs.

No viewer is contacted. The shown objects become the model's named outputs
under the runner's result contract (see _wonky_runtime.py); viewer options are
listed in the output record, not applied. Every other ocp_vscode name raises an
explicit capability error where it is used.
"""

import _wonky_runtime

show = _wonky_runtime.show
show_object = _wonky_runtime.show_object

__all__ = ["show", "show_object"]


def __getattr__(name):
    if name.startswith("_"):
        raise AttributeError(name)
    return _wonky_runtime.capability(
        f"ocp_vscode.{name} is not provided by wonky; only show() and show_object() are, and they record model outputs")
