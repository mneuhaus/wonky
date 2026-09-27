"""cad_khana topology pick descriptions (refused)."""

from cad_khana import _wonky

_WHAT = "face/edge/vertex descriptions by OCCT topology index"
_M = "cad_khana.mechanism.pick"

describe_face = _wonky.refused_call(f"{_M}.describe_face", _WHAT)
describe_edge = _wonky.refused_call(f"{_M}.describe_edge", _WHAT)
describe_vertex = _wonky.refused_call(f"{_M}.describe_vertex", _WHAT)
face_relations = _wonky.refused_call(f"{_M}.face_relations", _WHAT)

__getattr__ = _wonky.module_getattr(__name__)
