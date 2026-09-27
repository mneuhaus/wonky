"""build123d 0.13.0 ``Color`` for the Bend-backed shim, without OpenCascade.

build123d's Color is a value object: it parses a name, hex string, integer
code or sRGB tuple and stores the result in an OCCT ``Quantity_ColorRGBA``,
which keeps linear RGB and alpha as float32. This class ports build123d's
constructor verbatim and emulates that storage exactly: sRGB -> linear in
double precision, rounded to float32, and back to sRGB on read, then rounded
to 7 digits like build123d's ``__iter__``. Name tables (CSS3 via webcolors,
OCCT/X11 with OCCT's own linear values) are frozen with their provenance in
``build123d_colors.json`` by ``scripts/python/build123d-colors.py``, which
also writes the oracle ``test/python-khana-color.test.mjs`` compares against.

Differences, all explicit:

- An sRGB channel outside 0..1 raises ``ValueError("Color out")`` where
  build123d raises OCP's ``Standard_Failure("Color out")``.
- ``.wrapped`` (the OCP ``Quantity_ColorRGBA``) and ``str()`` of a color
  without an exact CSS3 name (build123d names the nearest OCCT color with
  float32 arithmetic) are capability errors at their use site.
- ``Color("Quantity_NOC_")`` is a ``ValueError``; in build123d it aborts the
  Python process inside OCCT.

The shim binds this class as ``build123d.Color``; cad_khana's ``with_part``
reads it through ``__iter__``.
"""

import colorsys as _colorsys
import json as _json
import math as _math
import operator as _operator
import os as _os
import re as _re
import struct as _struct
import sys as _sys

with open(_os.path.join(_os.path.dirname(_os.path.abspath(__file__)), "build123d_colors.json"),
          encoding="utf-8") as _handle:
    _TABLES = _json.load(_handle)
_CSS3 = _TABLES["css3"]
_CSS3_REVERSE = _TABLES["css3Reverse"]
_OCCT = _TABLES["occt"]
_OCCT_PREFIX = _TABLES["occtPrefix"]
_HEX = _re.compile(r"^#([a-fA-F0-9]{3}|[a-fA-F0-9]{6})$")
_ASCII_UPPER = str.maketrans("abcdefghijklmnopqrstuvwxyz", "ABCDEFGHIJKLMNOPQRSTUVWXYZ")


def _unsupported(message):
    """Capability error at the model's use site (latched by the host)."""
    shim = _sys.modules.get("build123d")
    if shim is not None and callable(getattr(shim, "_unsupported", None)):
        return shim._unsupported(message)
    runtime = _sys.modules.get("_wonky_runtime")
    if runtime is not None:
        return runtime.capability(message)
    raise RuntimeError(message)


def _float32(value):
    """C's (float) cast of a double: round to nearest float32, overflow to infinity."""
    value = float(value)
    try:
        return _struct.unpack("f", _struct.pack("f", value))[0]
    except OverflowError:
        return _math.copysign(_math.inf, value)


def _srgb_to_linear(value):
    """OCCT Quantity_Color::Convert_sRGB_To_LinearRGB (double)."""
    return value / 12.92 if value <= 0.04045 else _math.pow((value + 0.055) / 1.055, 2.4)


def _linear_to_srgb(value):
    """OCCT Quantity_Color::Convert_LinearRGB_To_sRGB (double)."""
    return value * 12.92 if value <= 0.0031308 else _math.pow(value, 1.0 / 2.4) * 1.055 - 0.055


def _quantity_rgba(red, green, blue, alpha):
    """Quantity_ColorRGBA(Quantity_Color(r, g, b, Quantity_TOC_sRGB), alpha): float32 linear RGB + alpha."""
    if red < 0.0 or red > 1.0 or green < 0.0 or green > 1.0 or blue < 0.0 or blue > 1.0:
        raise ValueError("Color out")
    return (_float32(_srgb_to_linear(red)), _float32(_srgb_to_linear(green)), _float32(_srgb_to_linear(blue)),
            _float32(alpha))


def _css3_rgb(name):
    """webcolors.name_to_rgb(name) for the CSS3 spec."""
    try:
        return _CSS3[name.lower()]
    except KeyError:
        raise ValueError(f'"{name}" is not defined as a named color in css3.') from None


def _hex_rgb(value):
    """webcolors.hex_to_rgb(value)."""
    match = _HEX.match(value)
    if match is None:
        raise ValueError(f'"{value}" is not a valid hexadecimal color value.')
    digits = match.group(1).lower()
    if len(digits) == 3:
        digits = "".join(2 * digit for digit in digits)
    return [int(digits[i:i + 2], 16) for i in (0, 2, 4)]


def _occt_rgb(name):
    """Quantity_Color::ColorFromName: ASCII case-insensitive, optional Quantity_NOC_ prefix; linear values."""
    upper = name.translate(_ASCII_UPPER)
    if upper.startswith(_OCCT_PREFIX):
        upper = upper[len(_OCCT_PREFIX):]
    return _OCCT.get(upper)


class Color:
    """
    Color object based on OCCT Quantity_ColorRGBA (emulated; see the module docstring).

    Accepts what build123d 0.13.0 accepts: a name ("red", CSS3 or OCCT/X11),
    a hex string ("#ff0000", "#f00", "#ff000080"), an integer code 0xRRGGBB
    with optional alpha 0x00..0xFF, sRGB floats (red, green, blue[, alpha]),
    a tuple of those, another Color, or the keywords color_like, name,
    color_code, red, green, blue and alpha.
    """

    def __init__(self, *args, **kwargs):
        self._rgba = None
        red, green, blue, alpha, name, color_code = (1.0, 1.0, 1.0, 1.0, None, None)
        default_rgb = (red, green, blue, alpha)

        # Conform inputs to complete color_like tuples
        color_like = kwargs.get("color_like", None)
        if color_like is not None:
            args = (color_like,)

        if args:
            args = args[0] if isinstance(args[0], tuple) else args

        def fill_defaults(a, b):
            return tuple(a[i] if i < len(a) else b[i] for i in range(len(b)))

        if args:
            if len(args) >= 3:
                red, green, blue, alpha = fill_defaults(args, default_rgb)
            else:
                match args[0]:
                    case Color():
                        self._rgba = args[0]._rgba
                        return
                    case str():
                        name, alpha = fill_defaults(args, (name, alpha))
                        name = name.strip()
                        if "#" in name:
                            # extract alpha from hex string
                            hex_a = format(int(alpha * 255), "x")
                            if len(name) == 5:
                                hex_a = name[4] * 2
                                name = name[:4]
                            elif len(name) == 9:
                                hex_a = name[7:9]
                                name = name[:7]
                            elif len(name) not in [4, 5, 7, 9]:
                                raise ValueError(f'"{name}" is not a valid hexadecimal color value.')
                            try:
                                if hex_a:
                                    alpha = int(hex_a, 16) / 0xFF
                            except ValueError as ex:
                                raise ValueError(f"Invald alpha hex string: {hex_a}") from ex
                    case int():
                        color_code, alpha = fill_defaults(args, (color_code, alpha))
                    case float():
                        red, green, blue, alpha = fill_defaults(args, default_rgb)
                    case _:
                        raise TypeError(f"Unsupported color definition: {args}")

        # Replace positional values with kwargs unless from color_like
        if color_like is None:
            name = kwargs.get("name", name)
            color_code = kwargs.get("color_code", color_code)
            red = kwargs.get("red", red)
            green = kwargs.get("green", green)
            blue = kwargs.get("blue", blue)
            alpha = kwargs.get("alpha", alpha)

        if name:
            color_format = (name, alpha)
        elif color_code:
            color_format = (color_code, alpha)
        else:
            color_format = (red, green, blue, alpha)

        match color_format:
            case (name, a) if isinstance(name, str) and isinstance(a, (float, int)):
                red, green, blue = Color._rgb_from_str(name)
                alpha = a
            case (hexa, a) if isinstance(hexa, int) and isinstance(a, (float, int)):
                red, green, blue = Color._rgb_from_int(hexa)
                if a != 1:
                    # alpha == 1 is special case as default, don't divide
                    alpha = a / 0xFF
            case (red, green, blue, alpha) if all(isinstance(c, (int, float)) for c in (red, green, blue, alpha)):
                pass
            case _:
                raise TypeError(f"Unsupported color definition: {color_format}")

        if not self._rgba:
            self._rgba = _quantity_rgba(red, green, blue, alpha)

    @property
    def wrapped(self):
        return _unsupported("build123d.Color.wrapped is an OCP Quantity_ColorRGBA; external geometry objects are "
                            "not available in the Python frontend (read the color with tuple(color))")

    def _srgb(self):
        red, green, blue, _ = self._rgba
        return (_linear_to_srgb(red), _linear_to_srgb(green), _linear_to_srgb(blue))

    def __iter__(self):
        rgb_tuple = (*self._srgb(), self._rgba[3])
        return (round(value, 7) for value in rgb_tuple)

    def __copy__(self):
        """Return copy of self"""
        return Color(*tuple(self))

    def __deepcopy__(self, _memo):
        """Return deepcopy of self"""
        return Color(*tuple(self))

    def __str__(self):
        """Generate string: the exact CSS3 name, as build123d; the nearest OCCT name is not provided."""
        try:
            key = "#%02x%02x%02x" % tuple(round(c * 255) for c in self._srgb())
        except (ValueError, OverflowError):
            key = None
        name = _CSS3_REVERSE.get(key)
        if name is None:
            return _unsupported(f"str() of build123d.Color{tuple(self)} names the nearest OCCT color "
                                f"(float32 search over Quantity_Color's table), which the Python frontend does not "
                                f"provide; use repr() or tuple()")
        return f"{type(self).__name__}: {str(tuple(self))} is {name.upper()!r}"

    def __repr__(self):
        """Represent Color"""
        return f"{type(self).__name__}{str(tuple(self))}"

    @classmethod
    def categorical_set(cls, color_count, starting_hue=0.0, alpha=1.0):
        """Generate a palette of evenly spaced colors (build123d 0.13.0, numpy.linspace emulated)."""
        if isinstance(starting_hue, float):
            if not 0.0 <= starting_hue <= 1.0:
                raise ValueError("Starting hue must be within range 0.0–1.0")
        elif isinstance(starting_hue, int):
            if starting_hue < 0:
                raise ValueError("Starting color integer must be non-negative")
            rgb = tuple(Color(starting_hue))[:3]
            starting_hue = _colorsys.rgb_to_hls(*rgb)[0]
        else:
            raise TypeError("Starting hue must be a float in [0,1] or an integer color literal")

        if isinstance(alpha, (float, int)):
            alphas = [float(alpha)] * color_count
        else:
            alphas = list(alpha)
            if len(alphas) != color_count:
                raise ValueError("Number of alpha values must match color_count")

        count = _operator.index(color_count)
        if count < 0:
            raise ValueError(f"Number of samples, {count}, must be non-negative.")
        # numpy.linspace(start, start + 1.0, count, endpoint=False): i * step + start.
        start = float(starting_hue)
        step = ((start + 1.0) - start) / count if count else 0.0
        hues = [i * step + start for i in range(count)]
        return [cls(*_colorsys.hls_to_rgb(h % 1.0, 0.55, 0.9), a) for h, a in zip(hues, alphas)]

    @staticmethod
    def _rgb_from_int(triplet):
        red, remainder = divmod(triplet, 256**2)
        green, blue = divmod(remainder, 256)
        return red / 255, green / 255, blue / 255

    @staticmethod
    def _rgb_from_str(name):
        if "#" not in name:
            try:
                # Use css3 color names by default
                triplet = _css3_rgb(name)
            except ValueError as exc:
                # Fall back to OCCT/X11 color names
                values = _occt_rgb(name)
                if values is None:
                    raise ValueError(f"{name!r} is not defined as a named color in CSS3 or OCCT/X11") from exc
                return tuple(values)
        else:
            triplet = _hex_rgb(name)
        return tuple(i / 255 for i in tuple(triplet))


Color.__module__ = "build123d.geometry"
