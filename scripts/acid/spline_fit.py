"""Exact open cubic interpolation for catalog contracts, independently checked.

D1: parameters computed in binary64 on SI point payloads, then exact rationals.
Route A solves second derivatives (natural ends) and forms Hermite spans.
Route B solves the cubic B-spline collocation equations including natural ends.
No CAD kernel participates in the contract computation.
"""
import math
import sympy as sp


def default_parameters(points):
    lengths = [math.sqrt(math.sqrt(sum((b[d] - a[d]) ** 2 for d in range(2)))) for a, b in zip(points, points[1:])]
    total = 0.0
    cumulative = [0.0]
    for length in lengths:
        total += length
        cumulative.append(total)
    return [v / total for v in cumulative]


def contract_fit(points, parameters=None):
    pts = [[sp.Rational(float(v) * 0.001) * 1000 for v in p] for p in points]
    ts = [sp.Rational(v) for v in (parameters or default_parameters([[float(v) * 0.001 for v in p] for p in points]))]
    n = len(pts)
    h = [b - a for a, b in zip(ts, ts[1:])]
    if n < 2 or any(v <= 0 for v in h):
        raise ValueError('curve2/degenerate-span')
    a, rhs = sp.zeros(n), sp.zeros(n, 2)
    a[0, 0] = a[n-1, n-1] = 1
    for i in range(1, n-1):
        a[i, i-1], a[i, i], a[i, i+1] = h[i-1], 2*(h[i-1]+h[i]), h[i]
        for d in range(2):
            rhs[i,d] = 6*((pts[i+1][d]-pts[i][d])/h[i] - (pts[i][d]-pts[i-1][d])/h[i-1])
    second = a.inv() * rhs
    spans = []
    for i, width in enumerate(h):
        ctrl = [pts[i], [], [], pts[i+1]]
        for d in range(2):
            slope = (pts[i+1][d]-pts[i][d])/width
            left = slope - width*(2*second[i,d]+second[i+1,d])/6
            right = slope + width*(second[i,d]+2*second[i+1,d])/6
            ctrl[1].append(pts[i][d]+width*left/3)
            ctrl[2].append(pts[i+1][d]-width*right/3)
        spans.append(ctrl)
    # Independent global B-spline solve, using Cox-de Boor polynomials.
    knots = [ts[0]]*4 + ts[1:-1] + [ts[-1]]*4
    u = sp.Symbol('u')
    def basis(j, degree, lo, hi):
        if degree == 0:
            return sp.Integer(int(bool(knots[j] <= lo and hi <= knots[j+1] and knots[j] < knots[j+1])))
        out = 0
        if knots[j+degree] != knots[j]:
            out += (u-knots[j])/(knots[j+degree]-knots[j])*basis(j,degree-1,lo,hi)
        if knots[j+degree+1] != knots[j+1]:
            out += (knots[j+degree+1]-u)/(knots[j+degree+1]-knots[j+1])*basis(j+1,degree-1,lo,hi)
        return sp.expand(out)
    count = n+2
    rows = []
    for i,t in enumerate(ts):
        k = min(i,n-2)
        rows.append([basis(j,3,ts[k],ts[k+1]).subs(u,t) for j in range(count)])
    rows += [[sp.diff(basis(j,3,ts[k],ts[k+1]),u,2).subs(u,ts[end]) for j in range(count)] for k,end in [(0,0),(n-2,n-1)]]
    poles = sp.Matrix(rows).inv()*sp.Matrix(pts+[[0,0],[0,0]])
    for i,ctrl in enumerate(spans):
        local = (u-ts[i])/h[i]
        for d in range(2):
            bez = sum(sp.binomial(3,j)*local**j*(1-local)**(3-j)*ctrl[j][d] for j in range(4))
            bs = sum(basis(j,3,ts[i],ts[i+1])*poles[j,d] for j in range(count))
            assert sp.expand(bez-bs) == 0, 'independent fit routes differ'
    return ts, spans, knots, [list(poles.row(i)) for i in range(count)]
