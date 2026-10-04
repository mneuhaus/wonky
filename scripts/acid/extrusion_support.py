"""Bounded support equivalence for STEP reference observation, never construction.

For a non-rational, clamped degree-one tensor direction, the surface is
(1-t) C0(u) + t C1(u). Common knots imply C1-C0 is the B-spline
of pole differences. Nonnegative partition-of-unity basis bounds every
isoparametric translation error by the largest pole-difference L1 error.
All decisions on transferred binary64 poles use exact rational arithmetic.
"""
from fractions import Fraction as Q


def extrusion_support(spline, resolution_mm):
    if resolution_mm < 0 or spline.IsURational() or spline.IsVRational():
        return None
    for axis in ('V', 'U'):
        if (getattr(spline, axis + 'Degree')() != 1 or
                getattr(spline, 'Nb' + axis + 'Poles')() != 2 or
                getattr(spline, 'Is' + axis + 'Periodic')() or
                getattr(spline, 'Nb' + axis + 'Knots')() != 2 or
                any(getattr(spline, axis + 'Multiplicity')(i) != 2 for i in (1, 2))):
            continue
        count = spline.NbUPoles() if axis == 'V' else spline.NbVPoles()
        differences = []
        for i in range(1, count + 1):
            a, b = (spline.Pole(i, 1), spline.Pole(i, 2)) if axis == 'V' else (spline.Pole(1, i), spline.Pole(2, i))
            differences.append(tuple(Q(y) - Q(x) for x, y in zip(a.Coord(), b.Coord())))
        direction = differences[0]
        error = max(sum(abs(x-y) for x,y in zip(delta,direction)) for delta in differences)
        if sum(x*x for x in direction) > 0 and error <= Q(resolution_mm):
            return {'tensorDirection': axis, 'translationMm': [float(x) for x in direction],
                    'translationErrorBoundMm': float(error), 'exactTransferredPoles': error == 0,
                    'resolutionMm': resolution_mm,
                    'proof': 'degree-one tensor; common directrix knots; exact-rational pole differences; convex-hull L1 bound'}
    return None
