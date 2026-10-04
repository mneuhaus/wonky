# /// script
# requires-python = ">=3.11"
# dependencies = ["sympy==1.13.3", "mpmath==1.3.0"]
# ///
"""Independent oracle of the BSpline math in wonky-curve (strand S5).

Everything here is derived from the definitions (Green integrals of x(t), y(t), critical
points of derivative polynomials, adaptive mpmath quadrature), never from the Rust code.
Exact quantities are sympy Rationals written "n/d"; transcendental or algebraic quantities
are mpmath values at 50 digits written as decimal strings (the Rust test compares them with
a 1e-12 relative tolerance).

Run:   uv run rust/wonky-curve/tests/oracle/bspline_oracle.py > rust/wonky-curve/tests/oracle/bspline_oracle.json
The JSON records the sha256 of this file; test/wonky-curve-oracle.test.mjs checks the hash
and re-runs the script to prove the JSON is exactly its output.
"""
import hashlib
import json
import pathlib
import sys

import mpmath as mp
import sympy as sp

mp.mp.dps = 50
t = sp.symbols("t", real=True)
R = sp.Rational


def qs(x):
    x = sp.Rational(x)
    return f"{x.p}/{x.q}"


def ms(x):
    return mp.nstr(x, 40)


def pts(P):
    return [[qs(a), qs(b)] for a, b in P]


def bezier_xy(P):
    n = len(P) - 1
    B = [sp.binomial(n, k) * t**k * (1 - t) ** (n - k) for k in range(n + 1)]
    return (sp.expand(sum(P[k][0] * B[k] for k in range(n + 1))),
            sp.expand(sum(P[k][1] * B[k] for k in range(n + 1))))


def rational_xy(P, W):
    n = len(P) - 1
    B = [sp.binomial(n, k) * t**k * (1 - t) ** (n - k) for k in range(n + 1)]
    w = sum(W[k] * B[k] for k in range(n + 1))
    return (sum(W[k] * P[k][0] * B[k] for k in range(n + 1)) / w,
            sum(W[k] * P[k][1] * B[k] for k in range(n + 1)) / w)


def exact_moments(X, Y, a, b):
    """Signed area 1/2 int(x dy - y dx) and 1/3 int x(x dy - y dx), 1/3 int y(x dy - y dx)."""
    w = X * sp.diff(Y, t) - Y * sp.diff(X, t)
    return {
        "area": qs(sp.integrate(w / 2, (t, a, b))),
        "mx": qs(sp.integrate(X * w / 3, (t, a, b))),
        "my": qs(sp.integrate(Y * w / 3, (t, a, b))),
    }


def mp_moments(X, Y, a, b):
    dX, dY = sp.diff(X, t), sp.diff(Y, t)
    f = [sp.lambdify(t, e, "mpmath") for e in ((X * dY - Y * dX) / 2, X * (X * dY - Y * dX) / 3, Y * (X * dY - Y * dX) / 3)]
    cuts = [mp.mpf(a) + (mp.mpf(b) - mp.mpf(a)) * k / 8 for k in range(9)]
    return {k: ms(mp.quad(g, cuts)) for k, g in zip(("area", "mx", "my"), f)}


def mp_length(X, Y, a, b):
    speed = sp.lambdify(t, sp.sqrt(sp.diff(X, t) ** 2 + sp.diff(Y, t) ** 2), "mpmath")
    cuts = [mp.mpf(a) + (mp.mpf(b) - mp.mpf(a)) * k / 16 for k in range(17)]
    return ms(mp.quad(speed, cuts))


def min_speed(X, Y):
    sp_f = sp.lambdify(t, sp.sqrt(sp.diff(X, t) ** 2 + sp.diff(Y, t) ** 2), "mpmath")
    return min(sp_f(mp.mpf(k) / 200) for k in range(201))


def extremes(X, Y):
    """Min and max of x and y over [0, 1] from the roots of the derivative numerators."""
    out = {}
    for name, e in (("x", X), ("y", Y)):
        num = sp.Poly(sp.numer(sp.together(sp.diff(e, t))), t)
        cand = [mp.mpf(0), mp.mpf(1)]
        if num.degree() > 0:
            for r in num.nroots(n=50, maxsteps=500):
                r = sp.N(r, 50)
                if abs(sp.im(r)) < 1e-40 and 0 < sp.re(r) < 1:
                    cand.append(mp.mpf(str(sp.re(r))))
        f = sp.lambdify(t, e, "mpmath")
        vals = [(f(c), c) for c in cand]
        lo = min(vals, key=lambda v: v[0])
        hi = max(vals, key=lambda v: v[0])
        out[name + "min"], out[name + "max"] = ms(lo[0]), ms(hi[0])
        out[name + "max_t"] = ms(hi[1])
    return out


def poly_case(name, P, subranges):
    X, Y = bezier_xy(P)
    case = {"name": name, "degree": len(P) - 1, "poles": pts(P), "weights": None,
            "extremes": extremes(X, Y), "length": mp_length(X, Y, 0, 1), "ranges": []}
    for a, b in subranges:
        case["ranges"].append({"from": qs(a), "to": qs(b), **exact_moments(X, Y, a, b)})
    return case


def elevate(P):
    n = len(P) - 1
    Q = [P[0]]
    for i in range(1, n + 1):
        Q.append(tuple(R(i, n + 1) * P[i - 1][c] + (1 - R(i, n + 1)) * P[i][c] for c in range(2)))
    Q.append(P[n])
    return Q


def main():
    self_path = pathlib.Path(__file__)
    out = {"provenance": {
        "script": self_path.name,
        "script_sha256": hashlib.sha256(self_path.read_bytes()).hexdigest(),
        "sympy": sp.__version__, "mpmath": mp.__version__, "python": sys.version.split()[0],
        "moments": "area = 1/2 int(x dy - y dx) (signed, follows the traversal); mx = 1/3 int x (x dy - y dx); my = 1/3 int y (x dy - y dx)",
    }}
    full_and_sub = [(R(0), R(1)), (R(1, 4), R(3, 4))]

    # AC100: the Pythagorean-hodograph cubic.
    P = [(0, 0), (8, 6), (18, 6), (26, 0)]
    X, Y = bezier_xy(P)
    speed2 = sp.factor(sp.diff(X, t) ** 2 + sp.diff(Y, t) ** 2)
    root = 6 * (2 * t**2 - 2 * t + 5)
    assert sp.expand(root**2 - speed2) == 0, speed2
    ac = poly_case("ac100", P, full_and_sub)
    ac["length_exact"] = qs(sp.integrate(root, (t, 0, 1)))
    ac["speed_squared"] = str(speed2)
    ac["apex_y"] = qs(Y.subs(t, R(1, 2)))
    assert sp.Poly(sp.diff(Y, t), t).all_roots() == [R(1, 2)]
    t0 = R(1, 4)
    pt0 = [X.subs(t, t0), Y.subs(t, t0)]
    d = [sp.diff(X, t).subs(t, t0), sp.diff(Y, t).subs(t, t0)]
    sp0 = sp.sqrt(d[0] ** 2 + d[1] ** 2)
    ac["point"] = {"t": qs(t0), "p": [qs(v) for v in pt0], "unit_normal": [qs(-d[1] / sp0), qs(d[0] / sp0)]}
    probe = (R(49, 8), R(251, 64))
    dist2 = (X - probe[0]) ** 2 + (Y - probe[1]) ** 2
    cands = [(R(0), dist2.subs(t, 0)), (R(1), dist2.subs(t, 1))]
    for r in sp.Poly(sp.diff(dist2, t), t).real_roots():
        if 0 < sp.N(r, 30) < 1:
            cands.append((r, sp.simplify(dist2.subs(t, r))))
    best = min(cands, key=lambda c: sp.N(c[1], 40))
    ac["closest"] = {"probe": pts([probe])[0], "t": qs(best[0]), "dist2": qs(best[1]),
                     "dist": qs(sp.sqrt(best[1]))}
    out["ac100"] = ac

    # Its exact quartic elevation: identical moments, identical curve.
    E = elevate(P)
    EX, EY = bezier_xy(E)
    assert sp.expand(EX - X) == 0 and sp.expand(EY - Y) == 0
    el = poly_case("ac100_elevated", E, full_and_sub)
    assert el["ranges"] == ac["ranges"]
    out["ac100_elevated"] = el

    # The S-edge block: cubic (24,0),(34,6),(20,14),(24,24) and three lines closing the cap.
    S = [(24, 0), (34, 6), (20, 14), (24, 24)]
    SX, SY = bezier_xy(S)
    cap = sp.integrate((SX * sp.diff(SY, t) - SY * sp.diff(SX, t)) / 2, (t, 0, 1))
    for a, b in [((0, 0), (24, 0)), ((24, 24), (0, 24)), ((0, 24), (0, 0))]:
        cap += R(1, 2) * (a[0] * b[1] - b[0] * a[1])
    se = poly_case("s_edge", S, full_and_sub)
    se["cap_area"] = qs(cap)
    se["cap_lines"] = [[[0, 0], [24, 0]], [[24, 24], [0, 24]], [[0, 24], [0, 0]]]
    se["y_range"] = [qs(SY.subs(t, 0)), qs(SY.subs(t, 1))]
    assert all(0 <= sp.N(SY.subs(t, k / sp.Integer(100))) <= 24 for k in range(101))
    out["s_edge"] = se

    # 20 dyadic cubics from a fixed generator, speed bounded away from zero.
    seed, dyadic = 20260928, []
    while len(dyadic) < 20:
        c = []
        for _ in range(8):
            seed = (seed * 1103515245 + 12345) % (1 << 31)
            c.append(R((seed >> 8) % 161 - 80, 4))
        Pd = [(c[0], c[1]), (c[2], c[3]), (c[4], c[5]), (c[6], c[7])]
        X1, Y1 = bezier_xy(Pd)
        if min_speed(X1, Y1) > mp.mpf("0.5"):
            dyadic.append(poly_case(f"dyadic_{len(dyadic):02d}", Pd, full_and_sub))
    out["dyadic"] = dyadic

    # Rational spans: enclosures only (the values are transcendental).
    rat = []
    for name, Pr, W in (
        ("rational_quadratic", [(0, 0), (10, 20), (20, 0)], [R(1), R(2), R(1)]),
        ("rational_cubic", [(0, 0), (8, 12), (18, 12), (26, 0)], [R(1), R(3, 2), R(2), R(1)]),
    ):
        RX, RY = rational_xy(Pr, W)
        rat.append({"name": name, "degree": len(Pr) - 1, "poles": pts(Pr), "weights": [qs(w) for w in W],
                    "extremes": extremes(RX, RY), "length": mp_length(RX, RY, 0, 1),
                    "ranges": [{"from": "0/1", "to": "1/1", **mp_moments(RX, RY, 0, 1)}]})
    out["rational"] = rat

    # Regularity: the plan's "looped cubic" is a cusp (hodograph zero at t = 1/2); a true loop refuses too.
    cusp = [(0, 0), (10, 10), (0, 10), (10, 0)]
    CX, CY = bezier_xy(cusp)
    assert sp.gcd(sp.Poly(sp.diff(CX, t), t), sp.Poly(sp.diff(CY, t), t)).monic().as_expr() == t - R(1, 2)
    loop = [(0, 0), (20, 15), (-10, 15), (10, 0)]
    LX, LY = bezier_xy(loop)
    # A self-crossing at parameters s < u: x(s) = x(u) and y(s) = y(u), both in (0, 1).
    s, u = sp.symbols("s u")
    sol = None
    for guess in ((0.2, 0.8), (0.1, 0.9), (0.3, 0.7)):
        try:
            sol = sp.nsolve([LX.subs(t, s) - LX.subs(t, u), LY.subs(t, s) - LY.subs(t, u)], [s, u], guess, prec=30)
            if 0 < sol[0] < sol[1] < 1 and abs(sol[0] - sol[1]) > 1e-3:
                break
            sol = None
        except (ValueError, ZeroDivisionError):
            sol = None
    assert sol is not None, "the loop cubic has no self-crossing"
    out["regularity"] = {
        "cusp": {"poles": pts(cusp), "hodograph_zero_t": "1/2"},
        "loop": {"poles": pts(loop), "crossing_params": [ms(sol[0]), ms(sol[1])]},
        "refusal": "curve2/self-intersecting-spline",
    }
    json.dump(out, sys.stdout, indent=1, sort_keys=True)
    sys.stdout.write("\n")


main()
