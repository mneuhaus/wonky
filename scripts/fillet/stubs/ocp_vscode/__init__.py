"""No-op ocp_vscode stub for the fillet oracle probe (no viewer connection)."""


def _noop(*args, **kwargs):
    return None


show = show_object = show_all = show_clear = reset_show = set_port = set_defaults = set_viewer_config = _noop
save_screenshot = status = _noop


class Camera:
    RESET = KEEP = CENTER = ISO = TOP = BOTTOM = LEFT = RIGHT = FRONT = BACK = None


class Collapse:
    ALL = NONE = LEAVES = ROOT = None


def __getattr__(name):
    return _noop
