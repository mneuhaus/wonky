# /// script
# requires-python = ">=3.11"
# dependencies = ["sympy==1.13.3", "mpmath==1.3.0"]
# ///
"""Oracle of the spline arrangement tests of wonky-curve (strand S6): two gear
outlines as binary64 inputs, and their enclosed areas by a route independent of
the Rust code.

AC102 (fixtures/cad-acid/zones.json): the binary64 payload is closed-forms.py's
`gear_payload` for the zone's construction params (imported, not copied), taken
as the SI values `x * millimeter` that the FeatureScript interpreter stores
(binary64 metres). The area is closed-forms.py's own `payload_area` (lines and
Bezier pieces in Fractions, three-point arcs through exact circumcentres with
mpmath angles), in mm^2, of exactly those SI values.

z45: the construction of tmp/cadbench/gears/robustness/exact_flank.py (m 1,
z 45, pressure angle 20 deg; every flank 6 binary64 involute points evenly in
roll angle from max(rb, rf) to ra, binary64 centripetal parameters, exact
natural cubic interpolation), applied to every flank of the whole outline:
tooth k is centred at k * 2 pi / 45, its tip arc passes through the tip points
and ra at the tooth centre, its root arc from the upper root point through rf
at the gap centre to the next tooth's lower root point. Inputs are in mm. The
area is the exact Fraction Green integral of the power-basis flank pieces plus
the arcs (exact circumcentre, mpmath angle); the exact Bezier controls and the
exact Green term of tooth 0's upper flank pin the Rust interpolation.

Run:   uv run rust/wonky-curve/tests/oracle/gear_outlines.py > rust/wonky-curve/tests/oracle/gear_outlines.json
The JSON records the sha256 of this file and of closed-forms.py;
test/wonky-curve-gear-oracle.test.mjs checks both and re-runs the script.
"""
import hashlib
import importlib.util
import json
import math
import pathlib
import sys
from fractions import Fraction as F

import mpmath as mp
import sympy as sp

mp.mp.dps = 50
HERE = pathlib.Path(__file__).resolve()
ROOT = HERE.parents[4]
CLOSED_FORMS = ROOT / "scripts/acid/closed-forms.py"


def closed_forms():
    spec = importlib.util.spec_from_file_location("closed_forms", CLOSED_FORMS)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def qs(x):
    x = F(x)
    return f"{x.numerator}/{x.denominator}"


def ms(x):
    return mp.nstr(x, 45)


def cross(a, b):
    return a[0] * b[1] - a[1] * b[0]


def arc_term(a, mid, b):
    """1/2 integral (x dy - y dx) along the three-point arc a -> mid -> b of exact
    points: the exact chord part (centre terms) plus the sector part r^2 theta / 2."""
    (ax, ay), (bx, by), (cx, cy) = a, mid, b
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    ux = ((ax * ax + ay * ay) * (by - cy) + (bx * bx + by * by) * (cy - ay) + (cx * cx + cy * cy) * (ay - by)) / d
    uy = ((ax * ax + ay * ay) * (cx - bx) + (bx * bx + by * by) * (ax - cx) + (cx * cx + cy * cy) * (bx - ax)) / d
    mpq = lambda v: mp.mpf(v.numerator) / v.denominator
    ang = lambda px, py: mp.atan2(mpq(py - uy), mpq(px - ux))
    t0, tm, t1 = ang(ax, ay), ang(bx, by), ang(cx, cy)
    ccw = d > 0
    if ccw:
        while tm < t0:
            tm += 2 * mp.pi
        while t1 < tm:
            t1 += 2 * mp.pi
    else:
        while tm > t0:
            tm -= 2 * mp.pi
        while t1 > tm:
            t1 -= 2 * mp.pi
    exact = (ux * (cy - ay) - uy * (cx - ax)) / 2
    return exact, mpq((ax - ux) ** 2 + (ay - uy) ** 2) * (t1 - t0) / 2


def bezier_term(ctrl):
    """1/2 integral (x dy - y dx) over a Bezier piece with exact controls, in the
    power basis (Fractions): no Bernstein pairing, independent of the Rust route."""
    n = len(ctrl) - 1

    def power(c):
        out = [F(0)] * (n + 1)
        for i, v in enumerate(c):
            b = math.comb(n, i)
            for k in range(n - i + 1):
                out[i + k] += v * b * math.comb(n - i, k) * (-1) ** k
        return out

    x, y = power([p[0] for p in ctrl]), power([p[1] for p in ctrl])
    dx = [k * x[k] for k in range(1, n + 1)]
    dy = [k * y[k] for k in range(1, n + 1)]
    total = F(0)
    for i, xi in enumerate(x):
        for j, dj in enumerate(dy):
            total += xi * dj / (i + j + 1)
    for i, yi in enumerate(y):
        for j, dj in enumerate(dx):
            total -= yi * dj / (i + j + 1)
    return total / 2


def natural_bezier(P, U):
    """Exact natural cubic interpolation (tmp/cadbench/gears/robustness/exact_flank.py):
    the Bezier controls of each piece."""
    n = len(P) - 1
    P = [(F(x), F(y)) for x, y in P]
    U = [F(x) for x in U]
    h = [U[i + 1] - U[i] for i in range(n)]
    N = n - 1
    Ms = []
    for comp in range(2):
        a = [F(0)] * N
        b = [F(0)] * N
        c = [F(0)] * N
        d = [F(0)] * N
        for i in range(1, n):
            k = i - 1
            a[k] = h[i - 1]
            b[k] = 2 * (h[i - 1] + h[i])
            c[k] = h[i]
            d[k] = 6 * ((P[i + 1][comp] - P[i][comp]) / h[i] - (P[i][comp] - P[i - 1][comp]) / h[i - 1])
        for k in range(1, N):
            w = a[k] / b[k - 1]
            b[k] -= w * c[k - 1]
            d[k] -= w * d[k - 1]
        x = [F(0)] * N
        x[-1] = d[-1] / b[-1]
        for k in range(N - 2, -1, -1):
            x[k] = (d[k] - c[k] * x[k + 1]) / b[k]
        Ms.append([F(0)] + x + [F(0)])
    pieces = []
    for i in range(n):
        B = []
        for comp in range(2):
            Mi, Mj = Ms[comp][i], Ms[comp][i + 1]
            slope = (P[i + 1][comp] - P[i][comp]) / h[i]
            d0 = slope - h[i] * (2 * Mi + Mj) / 6
            d1 = slope + h[i] * (Mi + 2 * Mj) / 6
            B.append((P[i][comp] + h[i] * d0 / 3, P[i + 1][comp] - h[i] * d1 / 3))
        pieces.append([P[i], (B[0][0], B[1][0]), (B[0][1], B[1][1]), P[i + 1]])
    return pieces


def z45():
    m, z, pa = 1.0, 45, math.radians(20.0)
    rp = m * z / 2
    rb = rp * math.cos(pa)
    ra = rp + m
    rf = rp - 1.25 * m
    rs = max(rb, rf)
    inv = lambda a: math.tan(a) - a
    theta_b = math.pi / (2 * z) + inv(pa)
    roll = lambda r: math.sqrt(max(r * r / (rb * rb) - 1.0, 0.0))
    t0, t1 = roll(rs), roll(ra)
    pitch = 2 * math.pi / z

    def flank(th, side):
        pts = []
        for k in range(6):
            t = t0 + (t1 - t0) * k / 5
            r = rb * math.sqrt(1 + t * t)
            a = th + side * (theta_b - (t - math.atan(t)))
            pts.append((r * math.cos(a), r * math.sin(a)))
        u = [0.0]
        for a, b in zip(pts, pts[1:]):
            u.append(u[-1] + math.sqrt(math.sqrt((b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2)))
        return pts, u

    teeth = []
    for k in range(z):
        th = k * pitch
        lower, upper = flank(th, -1), flank(th, 1)
        teeth.append({
            "lower": lower,
            "upper": upper,
            "tipMid": (ra * math.cos(th), ra * math.sin(th)),
            "rootMid": (rf * math.cos(th + pitch / 2), rf * math.sin(th + pitch / 2)),
        })
    # Exact area of the counter-clockwise outline.
    exact, angular = F(0), mp.mpf(0)
    for k, tooth in enumerate(teeth):
        nxt = teeth[(k + 1) % z]
        (lp, lu), (up, uu) = tooth["lower"], tooth["upper"]
        exact += sum(bezier_term(c) for c in natural_bezier(lp, lu))
        exact -= sum(bezier_term(c) for c in natural_bezier(up, uu))
        for a, mid, b in ((lp[-1], tooth["tipMid"], up[-1]), (up[0], tooth["rootMid"], nxt["lower"][0][0])):
            e, g = arc_term(*(tuple(F(v) for v in p) for p in (a, mid, b)))
            exact += e
            angular += g
    first = natural_bezier(*teeth[0]["upper"])
    out = {
        "construction": {"module": m, "teeth": z, "pressureAngleDeg": 20, "rb": repr(rb), "rf": repr(rf), "ra": repr(ra)},
        "teeth": [
            {
                "lower": {"points": [[repr(x), repr(y)] for x, y in t["lower"][0]], "params": [repr(v) for v in t["lower"][1]]},
                "upper": {"points": [[repr(x), repr(y)] for x, y in t["upper"][0]], "params": [repr(v) for v in t["upper"][1]]},
                "tipMid": [repr(v) for v in t["tipMid"]],
                "rootMid": [repr(v) for v in t["rootMid"]],
            }
            for t in teeth
        ],
        "tooth0_upper": {
            "controls": [[[qs(c[0]), qs(c[1])] for c in piece] for piece in first],
            "green": qs(sum(bezier_term(c) for c in first)),
        },
        "area_mm2": ms(mp.mpf(exact.numerator) / exact.denominator + angular),
        "max_control_bits": max(max(abs(v.numerator).bit_length(), v.denominator.bit_length()) for piece in first for c in piece for v in c),
    }
    return out


def ac102(cf):
    zones = json.loads((ROOT / "fixtures/cad-acid/zones.json").read_text())
    zones = zones["zones"] if isinstance(zones, dict) else zones
    zone = next(z for z in zones if z["id"] == "AC102")
    P = zone["construction"]["params"]
    G, Fl = P["gear"], P["flank"]
    g = {"m": cf.R_(G["module"]), "z": G["teeth"], "alpha": cf.R_(G["pressureAngleDeg"]), "ha": cf.R_(G["addendumModules"]),
         "hf": cf.R_(G["dedendumModules"]), "th0": cf.R_(G["toothCentreDeg"]), "h0": cf.R_(Fl["handles"][0]), "h1": cf.R_(Fl["handles"][1])}
    teeth = cf.gear_payload(g)
    si = lambda p: [repr(float(p[0]) * 0.001), repr(float(p[1]) * 0.001)]
    return {
        "params": {"module": G["module"], "teeth": G["teeth"], "handles": Fl["handles"]},
        "teeth": [
            {
                "lower": {"poles": [si(p) for p in t["lower"][0]], "foot": si(t["lower"][1])},
                "upper": {"poles": [si(p) for p in t["upper"][0]], "foot": si(t["upper"][1])},
                "tipMid": si(t["tipMid"]),
                "rootMid": si(t["rootMid"]),
            }
            for t in teeth
        ],
        "area_mm2": ms(cf.payload_area(teeth)),
    }


def main():
    cf = closed_forms()
    out = {
        "provenance": {
            "script_sha256": hashlib.sha256(HERE.read_bytes()).hexdigest(),
            "closed_forms_sha256": hashlib.sha256(CLOSED_FORMS.read_bytes()).hexdigest(),
            "sympy": sp.__version__,
            "mpmath": mp.__version__,
            "units": {"ac102": "binary64 SI metres (x * millimeter); area in mm^2", "z45": "mm"},
        },
        "ac102": ac102(cf),
        "z45": z45(),
    }
    json.dump(out, sys.stdout, indent=1, sort_keys=True)
    sys.stdout.write("\n")


main()
