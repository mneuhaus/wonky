"""build123d 0.13 fillet() and chamfer() of solid edges on the production fillet (kernel/fillet).

Loaded by path from python/build123d.py after ``_b3d_query``. The host request
``blend`` (src/fillet-python.mjs) runs Bend's exact analytic fillet/chamfer
(docs/fillet-plan.md section 8 step 4); nothing here computes geometry.

- ``fillet(objects, radius)`` and ``chamfer(objects, length)``: the edges'
  solid, blended, as a ``Part`` (build123d returns ``Part(Compound([...]))``
  for a 3D target outside a builder). All edges must come from one shape.
- ``shape.fillet(radius, edge_list)`` / ``shape.chamfer(length, length2,
  edge_list, face=None)``: the same on ``shape``, as ``type(shape)``.
- Tangent chains are followed, as OCCT's BRepFilletAPI does; a chamfer is the
  symmetric distance chamfer (a setback ``length`` along each face).
- A refusal OCCT and Onshape also raise (a tangent edge) is a ``ValueError``
  the model may catch; every other refusal of the Bend fillet is a
  capability error. ``length2``, ``angle``, ``reference``/``face``, vertex
  (2D) fillets and edges of several shapes are capability errors by name.
"""

import collections.abc as _abc
import numbers as _numbers
import sys as _sys

_core = _sys.modules["_b3d_core"]
_ops = _sys.modules["_b3d_ops"]
_query = _sys.modules["_b3d_query"]
_request = _core._request
_unsupported = _core._unsupported
_NO_2D = "2D vertex fillets and chamfers of sketch profiles are not implemented (Bend blends solid edges only)"


def _size(value, name):
    if isinstance(value, bool) or not isinstance(value, _numbers.Real):
        raise TypeError(f"{name} must be a number")
    return float(value)


def _edges(objects, what):
    """(handle, [[solid, index], ...]) of the selected build123d Edges."""
    Edge = _query.Edge
    if isinstance(objects, Edge):
        items = [objects]
    elif isinstance(objects, _abc.Iterable) and not isinstance(objects, (str, bytes)):
        items = list(objects)
    else:
        return _unsupported(f"{what} of a {type(objects).__name__} is not implemented; {_NO_2D}")
    for item in items:
        if not isinstance(item, Edge):
            return _unsupported(f"{what} of a {type(item).__name__} is not implemented; {_NO_2D}")
    if not items:
        raise ValueError(f"{what} requires at least one edge")
    handles = {edge._key[0] for edge in items}
    if len(handles) != 1:
        return _unsupported(f"{what} of edges of several shapes at once is not implemented")
    keys = sorted({edge._key for edge in items})
    return keys[0][0], [[solid, index] for _, solid, index in keys]


def _blend(kind, handle, edges, size):
    # The host answers a failed blend (bad input, or a refusal OCCT raises too)
    # with an ordinary error, which the runner raises as RuntimeError; build123d
    # raises ValueError there. Capability refusals arrive as the latched
    # UnsupportedFeatureError and pass through unchanged.
    try:
        return _request("blend", kind=kind, handle=handle, edges=edges, size=size)
    except RuntimeError as error:
        if type(error) is not RuntimeError:
            raise
        raise ValueError(str(error)) from None


def _own_handle(shape, handle, what):
    handles = _ops._handles(shape)
    if len(handles) != 1:
        return _unsupported(f"{what} of a group of several shapes is not implemented")
    if handles[0] != handle:
        return _unsupported(f"{what} with edges taken from another shape is not implemented; select them from this shape")
    return handle


def fillet(objects, radius):
    """build123d.fillet(objects, radius) of solid edges."""
    radius = _size(radius, "radius")
    handle, edges = _edges(objects, "fillet")
    return _ops._new(_ops.Part, (_blend("fillet", handle, edges, radius),))


def chamfer(objects, length, length2=None, angle=None, reference=None):
    """build123d.chamfer(objects, length) of solid edges: the symmetric distance chamfer."""
    length = _size(length, "length")
    if length2 is not None or angle is not None or reference is not None:
        return _unsupported("chamfer with length2, angle or reference (an asymmetric chamfer) is not implemented; "
                            "Bend builds the equal-offsets chamfer only")
    handle, edges = _edges(objects, "chamfer")
    return _ops._new(_ops.Part, (_blend("chamfer", handle, edges, length),))


def _shape_fillet(self, radius, edge_list):
    radius = _size(radius, "radius")
    handle, edges = _edges(edge_list, "fillet")
    return _ops._new(type(self), (_blend("fillet", _own_handle(self, handle, "fillet"), edges, radius),))


def _shape_chamfer(self, length, length2, edge_list, face=None):
    length = _size(length, "length")
    if length2 is not None or face is not None:
        return _unsupported("chamfer with length2 or face (an asymmetric chamfer) is not implemented; "
                            "Bend builds the equal-offsets chamfer only")
    handle, edges = _edges(edge_list, "chamfer")
    return _ops._new(type(self), (_blend("chamfer", _own_handle(self, handle, "chamfer"), edges, length),))


_core.register_shape_method("fillet", _shape_fillet)
_core.register_shape_method("chamfer", _shape_chamfer)

BUILD123D = {
    "fillet": fillet,
    "chamfer": chamfer,
}
