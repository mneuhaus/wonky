"""Freeze build123d 0.13.0's Color name tables and an oracle for the shim's Color.

Run (introspection and value probes only, builds no geometry):

    uv run --no-project --quiet --with build123d==0.13.0 \
        python scripts/python/build123d-colors.py \
        python/build123d_colors.json fixtures/python-color/build123d-color-oracle.json

build123d.Color is a value object: a name, hex string, integer code or sRGB
tuple stored in an OCCT Quantity_ColorRGBA (linear RGB and alpha as float32).
The first output holds the data wonky's python/_wonky_color.py needs to do the
same without OCCT: the CSS3 names (webcolors), the reverse CSS3 lookup that
str(Color) uses, and the OCCT/X11 names with the exact linear values that
Quantity_Color.ColorFromName returns (build123d feeds those back as sRGB).

The second output is the oracle: Color expressions with the real package's
tuple(), repr(), str() and errors. test/python-khana-color.test.mjs evaluates
the same expressions with the shim and requires identical results.
"""

import json
import platform
import random
import sys

import build123d as b
import webcolors
from build123d import Color
from OCP.Quantity import Quantity_Color, Quantity_NameOfColor

VERSION = "0.13.0"
if b.__version__ != VERSION:
    sys.exit(f"expected build123d {VERSION}, found {b.__version__}")

try:
    from importlib.metadata import packages_distributions, version as dist_version
    OCP_DIST = packages_distributions()["OCP"][0]
    OCP_VERSION = f"{OCP_DIST} {dist_version(OCP_DIST)}"
except Exception:  # noqa: BLE001 - provenance only
    OCP_VERSION = None

css3 = {name: list(webcolors.name_to_rgb(name)) for name in webcolors.names("css3")}
reverse = {}
for rgb in css3.values():
    key = "#%02x%02x%02x" % tuple(rgb)
    reverse[key] = webcolors.rgb_to_name(tuple(rgb))

PREFIX = "Quantity_NOC_"
occt = {}
for member in Quantity_NameOfColor.__members__:
    name = member[len(PREFIX):] if member.startswith(PREFIX) else member
    color = Quantity_Color()
    if not Quantity_Color.ColorFromName_s(name, color):
        sys.exit(f"OCCT does not resolve its own color name {name}")
    occt[name.upper()] = [color.Red(), color.Green(), color.Blue()]

tables = {
    "schema": "wonky-build123d-colors/1",
    "provenance": {
        "build123d": VERSION, "webcolors": webcolors.__version__, "OCP": OCP_VERSION,
        "python": platform.python_version(),
        "command": "uv run --no-project --quiet --with build123d==0.13.0 python scripts/python/build123d-colors.py "
                   "python/build123d_colors.json fixtures/python-color/build123d-color-oracle.json",
    },
    "css3": css3,
    "css3Reverse": reverse,
    "occt": occt,
    "occtPrefix": PREFIX.upper(),
}

# Oracle expressions. Corpus literals first (the 12 cad_khana corpus files).
CORPUS = ["'#198c90'", "'#dfb745'", "'#8799ad'", "'#905aaf'", "'#c5cdd5'", "'#262d32'", "'#a9bbc7'", "'#ba8755'",
          "0.18, 0.48, 0.82", "0.13, 0.68, 0.74", "0.96, 0.48, 0.10", "0.05, 0.36, 0.12", "0.035, 0.04, 0.055",
          "0.92, 0.92, 0.86", "0.06, 0.06, 0.07", "0.50, 0.52, 0.55", "0.68, 0.70, 0.72", "0.42, 0.44, 0.47",
          "0.45, 0.47, 0.50", "0.67, 0.68, 0.70", "0.55, 0.57, 0.60", "0.20, 0.21, 0.23", "0.76, 0.62, 0.18",
          "0.16, 0.17, 0.19", "0.30, 0.31, 0.33", "0.32, 0.34, 0.38", "0.12, 0.42, 0.26",
          "0x4A6E8A", "0xDDAA33", "0xD07020", "0xC4A77D", "0.85, 0.55, 0.1", "'olivedrab'", "'silver'", "\"red\""]
EDGE = ["2, 0, 0", "-0.1, 0, 0", "0.5, 0.5, 0.5, 2", "0x000000", "0xff0000, 0x80", "'#ff0000', 0.5", "'#f00'",
        "'#f008'", "'#FF000080'", "'GRAY50'", "'gray50'", "'Quantity_NOC_GRAY50'", "'quantity_noc_gray50'",
        "'nosuch'", "' red '", "'Red'", "'gray 50'", "' gray50'", "0.5", "(0.1, 0.2, 0.3)",
        "('red', 0.5)", "(0xff0000, 0x80)", "(0.1, 0.2, 0.3, 0.4)", "red=0.2", "1, 0, 0", "0x1000000", "-5",
        "[0.1, 0.2, 0.3]", "True", "'#12345'", "'#gggggg'", "'#ff00zz'", "'#ff0000zz'", "Color(0.1, 0.2, 0.3, 0.4)",
        "color_like=(0.1, 0.2, 0.3)", "color_like='blue'", "name='blue', alpha=0.3", "0xff0000, 1",
        "0xff0000, 0.5", "None", "", "0.1, 0.2", "0.1, 0.2, 0.3, 0.4, 0.5", "float('nan'), 0, 0", "'grey'",
        "'darkgrey'", "'aqua'", "'cyan'", "1.0, 1.0, 1.0", "0.0031308, 0.04045, 0.0404", "1e-9, 0.999999, 0.5",
        "0.5, 0.5, 0.5, 1e40", "0.5, 0.5, 0.5, -0.25", "'#abc', 0.3", "'navy', alpha=0.25", "color_code=0x00ff00",
        "0x123456, alpha=0x40", "blue=0.0", "0.2, 0.4, 0.6, alpha=0.8", "'MATRABLUE'", "'#fff'"]
rng = random.Random(20260923)
SWEEP = [f"{i}/255, {i}/255, {i}/255" for i in range(256)]
SWEEP += [f"0x{rng.randrange(0x1000000):06x}" for _ in range(200)]
SWEEP += [", ".join(repr(rng.random()) for _ in range(3)) + f", {rng.random()!r}" for _ in range(800)]
NAMES = [repr(name) for name in css3] + [repr(name.lower()) for name in occt]
CATEGORICAL = ["Color.categorical_set(5)", "Color.categorical_set(7, 0.3)", "Color.categorical_set(3, 0x4A6E8A)",
               "Color.categorical_set(4, 0.1, alpha=[0.1, 0.2, 0.3, 0.4])", "Color.categorical_set(0)",
               "Color.categorical_set(3, 1.5)", "Color.categorical_set(3, -1)", "Color.categorical_set(3, 'red')",
               "Color.categorical_set(2, alpha=[1.0])", "Color.categorical_set(10, 0.95, alpha=0.5)"]


def probe(expression):
    try:
        value = eval(expression, {"Color": Color})  # noqa: S307 - frozen oracle expressions
    except BaseException as error:  # noqa: BLE001
        return {"error": [type(error).__name__, str(error)]}
    colors = value if isinstance(value, list) else [value]
    out = []
    for color in colors:
        text = str(color)
        out.append({"tuple": [repr(c) for c in tuple(color)], "repr": repr(color),
                    **({"str": text} if " is '" in text else {"strNear": True})})
    return {"colors": out} if isinstance(value, list) else out[0]


cases = []
for group, expressions in (("corpus", CORPUS), ("edge", EDGE), ("names", NAMES), ("sweep", SWEEP)):
    cases += [{"group": group, "expr": f"Color({args})", **probe(f"Color({args})")} for args in expressions]
cases += [{"group": "categorical", "expr": expr, **probe(expr)} for expr in CATEGORICAL]

oracle = {"schema": "wonky-build123d-color-oracle/1", "provenance": tables["provenance"], "cases": cases}

with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(tables, handle, indent=1, sort_keys=False)
    handle.write("\n")
with open(sys.argv[2], "w", encoding="utf-8") as handle:
    handle.write(json.dumps({key: value for key, value in oracle.items() if key != "cases"})[:-1] + ', "cases": [\n')
    handle.write(",\n".join(json.dumps(case, ensure_ascii=False) for case in cases))
    handle.write("\n]}")
    handle.write("\n")
print(f"{len(css3)} CSS3 names, {len(occt)} OCCT names, {len(cases)} oracle cases", file=sys.stderr)
