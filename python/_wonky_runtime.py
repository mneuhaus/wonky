"""Runner-side model contract: captured outputs, result resolution and capability errors.

Loaded by runner.py as the module ``_wonky_runtime``. Provided modules
(build123d's export_step/export_stl, ocp_vscode.show/show_object, cad_khana)
record their outputs here. The runner resolves the model result at the end of
execution with this precedence, first match wins:

1. a module-level ``result``;
2. a module-level ``assembly`` (the cad_khana convention);
3. the objects passed to show()/show_object()/export_step()/export_stl(), in
   call order, with the names used;
4. otherwise an explicit error that lists the module-level bindings.

Several top-level shapes are never guessed between.

export_step()/export_stl() also write their file at once: the host builds it
from the Bend B-rep with the CLI's exporters and records its path and SHA-256
(decision 13, docs/python-frontend.md). cad_khana check()/inspect() are
refused, or recorded here as not run under --khana-checks=skip (decision 12,
docs/python-khana.md).

Objects accepted as outputs:

- a Bend ``Shape`` (anything carrying an opaque ``_handle`` string from the host);
- an assembly: an object whose type defines ``_wonky_parts()``, returning an
  iterable of ``(name, shape, color)`` with already placed shapes. ``color`` is
  None, an ``(r, g, b)`` or ``(r, g, b, a)`` tuple in 0..1, a ``#rrggbb[aa]``
  string, a build123d ``Color`` (python/_wonky_color.py, iterated as sRGB
  r, g, b, a), a color name or short hex string that ``Color`` resolves, or an
  object with ``to_tuple()`` (older build123d ``Color``).
"""

import inspect as _inspect
import math as _math
import os as _os
import types as _types
import __future__ as _future

_channel = None
_shim = None
_main_filename = None
_wonky_dir = _os.path.dirname(_os.path.abspath(__file__))
_captures = []


def _user_frames(frame):
    """Frames of model code (the executed source, even an in-memory "<python>", and
    anything outside wonky's python/ directory), innermost first."""
    while frame is not None:
        filename = frame.f_code.co_filename
        if filename == _main_filename or (
                not filename.startswith("<") and not _os.path.abspath(filename).startswith(_wonky_dir + _os.sep)):
            yield frame
        frame = frame.f_back


def capability(message, frame=None):
    """Raise an explicit capability error; the host latches it before Python sees it.

    The location comes from the shim's _locate (line and 1-based column of the
    executed source, plus the use site when that is a project module), so
    ocp_vscode, cad_khana, capture and import-policy errors point at the same
    place as build123d sentinels do.
    """
    frame = frame or _inspect.currentframe().f_back
    locate = getattr(_shim, "_locate", None)
    try:
        if locate is not None:
            location, use, stack = locate(frame)
            if use is not None and (location is None or "use" in location) and "(imported at " not in message:
                column = f":{use['column']}" if use.get("column") else ""
                message += f" (at {_shim._display(use['file'])}:{use['line']}{column})"
        else:
            location, stack = None, []
            walker = frame
            while walker is not None:
                if walker.f_code.co_filename == _main_filename:
                    position = {"file": walker.f_code.co_filename, "line": walker.f_lineno}
                    location = location or position
                    stack.append({"name": walker.f_code.co_name, "calledAt": position,
                                  "declaration": {"line": walker.f_code.co_firstlineno}})
                walker = walker.f_back
            stack.reverse()
            walker = None
    finally:
        del frame
    if _channel is None:
        raise RuntimeError(message)
    return _channel.request("unsupported", message=message, location=location, callStack=list(stack))


def _is_shape(value):
    shape_type = getattr(_shim, "Shape", None) if _shim is not None else None
    return isinstance(shape_type, type) and isinstance(value, shape_type)


def _is_assembly(value):
    return callable(getattr(type(value), "_wonky_parts", None))


def _describe(value):
    if _is_shape(value):
        return "Shape"
    if _is_assembly(value):
        return "assembly"
    if isinstance(value, _types.FunctionType):
        return "function"
    if isinstance(value, type):
        return "class"
    return type(value).__name__


def _color_type():
    """The shim's build123d.Color class when it is implemented (python/_wonky_color.py), else None."""
    color_type = vars(_shim).get("Color") if _shim is not None else None
    sentinel_type = vars(_shim).get("_Unimplemented") if _shim is not None else None
    if not isinstance(color_type, type) or (isinstance(sentinel_type, type) and isinstance(color_type, sentinel_type)):
        return None
    return color_type


def _color(value, where):
    if value is None:
        return None
    color_type = _color_type()
    if isinstance(value, str):
        text = value.strip()
        if text.startswith("#") and len(text) in (7, 9):
            try:
                channels = [int(text[i:i + 2], 16) / 255 for i in range(1, len(text), 2)]
            except ValueError:
                channels = None
            if channels:
                return channels
        if color_type is None:
            return capability(f"{where}: color {value!r} is not supported; use '#rrggbb', an (r, g, b[, a]) tuple in 0..1 or Color")
        # A color name ("red", "steelblue", OCCT/X11 names) or short hex, resolved like
        # build123d's Color; an unknown name is Color's own ValueError.
        value = color_type(text)
    if color_type is not None and isinstance(value, color_type):
        value = tuple(value)  # build123d 0.13 Color iterates as sRGB (r, g, b, a)
    if callable(getattr(type(value), "to_tuple", None)):
        value = value.to_tuple()
    if isinstance(value, (tuple, list)) and len(value) in (3, 4) and all(
            isinstance(v, (int, float)) and not isinstance(v, bool) and _math.isfinite(v) and 0 <= v <= 1 for v in value):
        return [float(v) for v in value]
    return capability(f"{where}: color {value!r} is not supported; use '#rrggbb', an (r, g, b[, a]) tuple in 0..1 or Color")


def _handle(shape, where):
    handle = getattr(shape, "_handle", None)
    if not isinstance(handle, str):
        return capability(f"{where}: {_describe(shape)} is not a Bend Shape")
    return handle


def _parts(value, name, color, where):
    """Flatten one output object into [(name, handle, color)]."""
    if _is_shape(value):
        return [(name, _handle(value, where), color)]
    if _is_assembly(value):
        parts = []
        for index, part in enumerate(value._wonky_parts()):
            if not isinstance(part, (tuple, list)) or len(part) != 3:
                return capability(f"{where}: assembly part {index} must be (name, shape, color)")
            part_name, shape, part_color = part
            if not _is_shape(shape):
                return capability(f"{where}: assembly part {part_name!r} is a {_describe(shape)}, not a Bend Shape")
            label = str(part_name) if part_name not in (None, "") else f"part-{index + 1}"
            parts.append((f"{name}/{label}" if name else label, _handle(shape, where),
                          _color(part_color, where) or color))
        return parts
    return capability(f"{where}: {_describe(value)} objects cannot be model outputs; pass a Bend Shape or an assembly")


def _inferred_name(value, frame):
    for scope in (frame.f_locals, frame.f_globals) if frame is not None else ():
        for key, candidate in scope.items():
            if candidate is value and not key.startswith("_"):
                return key
    return None


def capture(kind, objects, names=None, colors=None, alphas=None, path=None, options=None, frame=None):
    """Record objects passed to a show/export call, in call order."""
    frame = frame or _inspect.currentframe().f_back
    user = next(_user_frames(frame), None)
    position = getattr(_shim, "_position", None)
    site = None if user is None else position(user) if position is not None else \
        {"file": user.f_code.co_filename, "line": user.f_lineno}
    where = f"{kind}()"

    def sequence(value, label):
        if value is None:
            return [None] * len(objects)
        if isinstance(value, (str, bytes)) or not isinstance(value, (list, tuple)):
            value = [value]
        if len(value) != len(objects):
            return capability(f"{where}: {label} has {len(value)} entries for {len(objects)} objects")
        return list(value)

    names, colors, alphas = sequence(names, "names"), sequence(colors, "colors"), sequence(alphas, "alphas")
    for index, value in enumerate(objects):
        name = names[index]
        if isinstance(value, dict):
            for key, item in value.items():
                capture(kind, [item], names=[f"{name}/{key}" if name else str(key)], colors=[colors[index]],
                        alphas=[alphas[index]], path=path, options=options, frame=frame)
            continue
        if isinstance(value, (list, tuple)) and not _is_shape(value):
            base = name or _inferred_name(value, user)
            for position, item in enumerate(value):
                capture(kind, [item], names=[f"{base}[{position}]" if base else None], colors=[colors[index]],
                        alphas=[alphas[index]], path=path, options=options, frame=frame)
            continue
        if name is None and path is not None:
            name = _os.path.splitext(_os.path.basename(_os.fspath(path)))[0] or None
        if name is None:
            name = _inferred_name(value, user)
        if name is None:
            name = f"{kind}-{len(_captures) + 1}"
        color = _color(colors[index], where)
        if alphas[index] is not None:
            alpha = alphas[index]
            if isinstance(alpha, bool) or not isinstance(alpha, (int, float)) or not 0 <= alpha <= 1:
                return capability(f"{where}: alpha {alpha!r} must be a number in 0..1")
            color = (color or [None, None, None])[:3] + [float(alpha)]
        for part_name, handle, part_color in _parts(value, str(name), color, where):
            _captures.append({"kind": kind, "name": part_name, "handle": handle, "color": part_color,
                              "location": site, **({"path": _os.fspath(path)} if path is not None else {}),
                              **({"options": sorted(options)} if options else {})})


def _path_argument(file_path, where):
    try:
        path = _os.fsdecode(_os.fspath(file_path))
    except TypeError:
        return capability(f"{where}: file_path must be a str or os.PathLike, found {type(file_path).__name__}")
    if "\x00" in path:
        raise ValueError(f"{where}: embedded null byte")  # as open() raises
    return path


# build123d 0.13 signatures after (to_export, file_path), and the options the
# host applies when it writes the file. Other non-default options are listed
# on the output record as ignored (a STEP is always written in millimeters
# with Bend's own curves; an STL cannot honor an angular tolerance).
_EXPORT_POSITIONAL = {"export_step": ("unit", "write_pcurves", "precision_mode"),
                      "export_stl": ("tolerance", "angular_tolerance", "ascii_format")}
_EXPORT_APPLIED = {"export_step": (), "export_stl": ("tolerance", "ascii_format")}


def _export(kind, to_export, file_path, args, kwargs, frame):
    """Record the export as a model output, then have the host write the file now.

    The path is resolved as open() resolves it: against the current working
    directory, not normalized, so 'link/../x' follows the symlink first and a
    model can read its export back. The host
    refuses paths outside the model's project directory and read-only roots.
    """
    where = f"{kind}()"
    path = _path_argument(file_path, where)
    names = _EXPORT_POSITIONAL[kind]
    if len(args) > len(names):
        raise TypeError(f"{kind}() takes at most {len(names) + 2} positional arguments ({len(args) + 2} given)")
    options = {**dict(zip(names, args)), **kwargs}
    applied = {key: options[key] for key in _EXPORT_APPLIED[kind] if key in options}
    for key, value in applied.items():
        if key == "ascii_format" and not isinstance(value, bool):
            raise TypeError(f"{where}: ascii_format must be a bool, found {type(value).__name__}")
        if key == "tolerance" and (isinstance(value, bool) or not isinstance(value, (int, float))):
            raise TypeError(f"{where}: tolerance must be a number, found {type(value).__name__}")
    start = len(_captures)
    capture(kind, [to_export], path=path, options=[key for key in options if key not in applied], frame=frame)
    entries = _captures[start:]
    written = _shim._request("export_file", kind=kind, requested=path, path=_os.path.join(_os.getcwd(), path), cwd=_os.getcwd(),
                             handles=list(dict.fromkeys(entry["handle"] for entry in entries)),
                             options={key: float(value) if key == "tolerance" else value for key, value in applied.items()})
    for entry in entries:
        entry["file"] = written
    return True


def export_step(to_export, file_path, *args, **kwargs):
    """build123d.export_step: a named model output, written by the host from the Bend B-rep (src/exporters.mjs toStep)."""
    return _export("export_step", to_export, file_path, args, kwargs, _inspect.currentframe().f_back)


def export_stl(to_export, file_path, *args, **kwargs):
    """build123d.export_stl: a named model output, written by the host (exact facets, or a print mesh within tolerance)."""
    return _export("export_stl", to_export, file_path, args, kwargs, _inspect.currentframe().f_back)


# cad_khana check()/inspect() (python/cad_khana/_wonky.py) ask the host at
# every call. The host owns the --khana-checks mode and the not-run record:
# "refuse" (default) is a capability error at the call; "skip" records the call
# in brep.json as not run, with its location and arguments. Nothing a model
# changes on the Python side can turn a call off or rewrite its record.


def _argument(value, depth=0):
    """A short, side-effect-free description of a check argument (no Shape or foreign __repr__ runs)."""
    if value is None or isinstance(value, (bool, int, float)):
        return repr(value)
    if isinstance(value, str):
        return repr(value if len(value) <= 120 else value[:117] + "...")
    if isinstance(value, _os.PathLike):
        try:
            return repr(_os.fsdecode(_os.fspath(value)))
        except TypeError:
            return f"<{type(value).__name__}>"
    if _is_shape(value) or _is_assembly(value):
        return f"<{type(value).__name__}: {_describe(value)}>"
    if depth >= 2:
        return f"<{type(value).__name__}>"
    if isinstance(value, (list, tuple)):
        items = [_argument(item, depth + 1) for item in value[:8]] + (["..."] if len(value) > 8 else [])
        return ("[{}]" if isinstance(value, list) else "({})").format(", ".join(items))
    if isinstance(value, dict):
        items = [f"{_argument(key, depth + 1)}: {_argument(item, depth + 1)}" for key, item in list(value.items())[:8]]
        return "{" + ", ".join(items + (["..."] if len(value) > 8 else [])) + "}"
    fields = getattr(type(value), "__dataclass_fields__", None)
    if isinstance(fields, dict):
        return f"{type(value).__name__}(" + ", ".join(
            f"{name}={_argument(getattr(value, name, None), depth + 1)}" for name in fields) + ")"
    return f"<{type(value).__name__}>"


def khana_check(qualname, what, args, kwargs, frame=None):
    """A cad_khana check()/inspect() call, decided and recorded by the host.

    Refused (capability error) unless the host runs with --khana-checks=skip;
    then the host records the call as not run and returns a copy of its record.
    """
    frame = frame or _inspect.currentframe().f_back
    user = next(_user_frames(frame), None)
    site = None if user is None else _shim._position(user)
    del frame, user
    arguments = [_argument(value) for value in args] + [f"{key}={_argument(value)}" for key, value in kwargs.items()]
    return _shim._request("khana_check", call=qualname, what=what, site=site, arguments=arguments)


def show(*objects, names=None, colors=None, alphas=None, **options):
    """ocp_vscode.show: records the shown objects as model outputs; viewer options are listed, not applied."""
    capture("show", list(objects), names=names, colors=colors, alphas=alphas, options=options,
            frame=_inspect.currentframe().f_back)


def show_object(obj, name=None, options=None, **kwargs):
    """ocp_vscode/CQ-editor show_object: records one named model output."""
    color = alpha = None
    if isinstance(options, dict):
        color, alpha = options.get("color"), options.get("alpha")
        extra = [key for key in options if key not in ("color", "alpha")]
    else:
        extra = [] if options is None else ["options"]
    capture("show_object", [obj], names=[name], colors=[color], alphas=[alpha], options=[*extra, *kwargs],
            frame=_inspect.currentframe().f_back)


def _outputs_of(value, binding):
    where = f"module-level '{binding}'"
    if not (_is_shape(value) or _is_assembly(value)):
        raise TypeError(f"The {where} must be a Bend Shape or an assembly, found {_describe(value)}")
    parts = _parts(value, None if binding == "result" and _is_shape(value) else "", None, where)
    return [{"kind": binding, "name": name or None, "handle": handle, "color": color, "location": None}
            for name, handle, color in parts]


def _listing(namespace, provided):
    """Module-level bindings the model made itself (imports and __future__ features left out)."""
    found = []
    for key, value in namespace.items():
        if key.startswith("__") or isinstance(value, (_types.ModuleType, _future._Feature)):
            continue
        if any(module.get(key, _listing) is value for module in provided):
            continue
        if isinstance(value, (_types.FunctionType, type)) and vars(value).get("__module__") != "__main__" \
                and getattr(value, "__module__", None) != "__main__":
            continue
        found.append(f"{key}: {_describe(value)}")
    if not found:
        return "no module-level bindings"
    shown = ", ".join(found[:30])
    return shown + (f", and {len(found) - 30} more" if len(found) > 30 else "")


class NoResultError(ValueError):
    pass


def _metadata(value):
    """An assembly's optional _wonky_metadata() record (JSON data), passed through to model.source.assembly."""
    method = getattr(type(value), "_wonky_metadata", None)
    return value._wonky_metadata() if callable(method) else None


def resolve(namespace, provided_modules=()):
    """Apply the result contract. Returns (binding, outputs, ignored capture count, assembly metadata)."""
    for binding in ("result", "assembly"):
        if binding in namespace:
            value = namespace[binding]
            return binding, _outputs_of(value, binding), len(_captures), _metadata(value) if _is_assembly(value) else None
    if _captures:
        return "capture", list(_captures), 0, None
    provided = [vars(module) for module in provided_modules]
    raise NoResultError(f"Python model has no result: bind its final Shape to module-level 'result' or 'assembly', "
                        f"or pass it to show(), show_object(), export_step() or export_stl(). "
                        f"Found at module level: {_listing(namespace, provided)}")
