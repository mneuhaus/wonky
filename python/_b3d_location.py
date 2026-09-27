"""build123d 0.13 geometry values: Vector, Location, Rotation/Rot, Pos, Plane and Axis.

Loaded by path from python/build123d.py after ``_b3d_core``. Pure Python: no
OCP. The arithmetic ports the OpenCascade classes build123d wraps, operation
for operation, so printed text (``repr``, ``str``, ``:.Ng``), ``_key`` equality
and hashing match build123d 0.13.0 (tmp/w5b/b-location/oracle.py, frozen in
test/python-location.test.mjs) and raw floats agree to about 1e-15. The last
ulp can differ: OCCT's arm64 build fuses multiply-adds (FMA contraction), so
build123d's own raw floats are platform dependent. Ported:

- ``gp_Trsf`` with its form tags (identity, translation, rotation, compound):
  Multiply/PreMultiply/Invert/Power take the same branches as OCCT, so signed
  zeros agree (e.g. ``format(Location(Plane.XZ))``);
- ``TopLoc_Location`` chains: a Location is a list of (datum, power) items, a
  composition prepends the right operand's items and cancels adjacent powers
  of the same datum, and the transformation is the left fold of the items;
- ``gp_Quaternion`` for Euler angles (``SetEulerAngles``/``GetEulerAngles``,
  all 24 ``Intrinsic``/``Extrinsic`` orders) and the canonical ``_key``;
- ``gp_Ax3``/``gp_Dir`` for planes and axes.

Placing a Shape (``location * shape``, ``shape.moved(location)``,
``plane * shape``) builds a B-rep now, like OCCT's TShape at a location: the
unplaced B-rep is built once at the composed chain, a pure translation through
the host op ``translate``, anything else through ``transform`` (3x3 rotation
rows and an offset, mm). The same B-rep at an equal chain is the same shape
(``p * box == p * box``, ``(p * p.inverse()) * box == box``). OCP objects
(``wrapped``, ``to_gp_ax3``, ...) and the geometry queries not listed in
docs/python-frontend.md are capability errors at their use; attributes
build123d does not have are ordinary AttributeErrors.
"""

import collections.abc as _abc
import math as _math
import sys as _sys

_core = _sys.modules["_b3d_core"]
_Implemented = _core._Implemented
_unsupported = _core._unsupported
_request = _core._request

TOLERANCE = 1e-6
TOL_DIGITS = 6
GEOM_KEY_DIGITS = 5
_RESOLUTION = _sys.float_info.min  # gp::Resolution()


class Standard_ConstructionError(Exception):
    """OCCT's Standard_ConstructionError, as build123d leaks it (e.g. a plane x_dir parallel to z_dir)."""


# ---------------------------------------------------------------------------
# gp_XYZ / gp_Mat arithmetic in OCCT's operation order.

def _mat_vec(m, v):
    """gp_XYZ::Multiply(gp_Mat): M * v."""
    return (m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
            m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
            m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2])


def _mat_mul(a, b):
    """gp_Mat a.Multiply(b) = a * b (also b.PreMultiply(a))."""
    return tuple(tuple(a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j] for j in range(3)) for i in range(3))


def _transpose(m):
    return tuple(tuple(m[j][i] for j in range(3)) for i in range(3))


def _add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _neg(a):
    return (-a[0], -a[1], -a[2])


def _cross(a, b):
    """gp_XYZ::Cross."""
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _modulus(v):
    return _math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])


def _gp_dir(v, message="gp_Dir() - input vector has zero norm"):
    """gp_Dir(gp_XYZ): v / |v|; a zero vector is OCCT's construction error."""
    d = _modulus(v)
    if d <= _RESOLUTION:
        raise Standard_ConstructionError(message)
    return (v[0] / d, v[1] / d, v[2] / d)


def _dir_cross(a, b):
    """gp_Dir::Crossed."""
    return _gp_dir(_cross(a, b), "gp_Dir::Crossed() - result vector has zero norm")


def _dir_cross_cross(v, c1, c2):
    """gp_Dir::CrossCross: v x (c1 x c2), normalized."""
    x, y, z = v
    r = (y * (c1[0] * c2[1] - c1[1] * c2[0]) - z * (c1[2] * c2[0] - c1[0] * c2[2]),
         z * (c1[1] * c2[2] - c1[2] * c2[1]) - x * (c1[0] * c2[1] - c1[1] * c2[0]),
         x * (c1[2] * c2[0] - c1[0] * c2[2]) - y * (c1[1] * c2[2] - c1[2] * c2[1]))
    return _gp_dir(r, "gp_Dir::CrossCross() - result vector has zero norm")


_IDENTITY_MATRIX = ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0))
_ZERO = (0.0, 0.0, 0.0)


# ---------------------------------------------------------------------------
# gp_Trsf (scale 1; no mirrors: build123d locations are rigid).

_IDENTITY, _TRANSLATION, _ROTATION, _COMPOUND = "identity", "translation", "rotation", "compound"


class _Trsf:
    __slots__ = ("form", "m", "t")

    def __init__(self, form=_IDENTITY, m=_IDENTITY_MATRIX, t=_ZERO):
        self.form, self.m, self.t = form, m, t


_IDENTITY_TRSF = _Trsf()


def _with_translation(trsf, v):
    """gp_Trsf::SetTranslationPart."""
    v = tuple(float(c) for c in v)
    null = v[0] * v[0] + v[1] * v[1] + v[2] * v[2] < _RESOLUTION
    form = trsf.form
    if form == _IDENTITY and not null:
        form = _TRANSLATION
    elif form == _TRANSLATION and null:
        form = _IDENTITY
    elif form == _ROTATION and not null:
        form = _COMPOUND
    return _Trsf(form, trsf.m, v)


def _multiply(a, b):
    """gp_Trsf a.Multiply(b): a * b."""
    if b.form == _IDENTITY:
        return a
    if a.form == _IDENTITY:
        return b
    if a.form == _ROTATION and b.form == _ROTATION:
        t = a.t
        if b.t[0] != 0.0 or b.t[1] != 0.0 or b.t[2] != 0.0:
            t = _add(a.t, _mat_vec(a.m, b.t))
        return _Trsf(_ROTATION, _mat_mul(a.m, b.m), t)
    if a.form == _TRANSLATION and b.form == _TRANSLATION:
        return _Trsf(_TRANSLATION, a.m, _add(a.t, b.t))
    if a.form in (_COMPOUND, _ROTATION) and b.form == _TRANSLATION:
        return _Trsf(a.form, a.m, _add(a.t, _mat_vec(a.m, b.t)))
    if a.form == _TRANSLATION:  # b is a rotation or compound
        return _Trsf(_COMPOUND, b.m, _add(a.t, b.t))
    return _Trsf(_COMPOUND, _mat_mul(a.m, b.m), _add(a.t, _mat_vec(a.m, b.t)))


def _premultiply(a, b):
    """gp_Trsf a.PreMultiply(b): b * a."""
    if b.form == _IDENTITY:
        return a
    if a.form == _IDENTITY:
        return b
    if a.form == _ROTATION and b.form == _ROTATION:
        return _Trsf(_ROTATION, _mat_mul(b.m, a.m), _add(_mat_vec(b.m, a.t), b.t))
    if a.form == _TRANSLATION and b.form == _TRANSLATION:
        return _Trsf(_TRANSLATION, a.m, _add(a.t, b.t))
    if a.form in (_COMPOUND, _ROTATION) and b.form == _TRANSLATION:
        return _Trsf(a.form, a.m, _add(a.t, b.t))
    if a.form == _TRANSLATION:  # b is a rotation or compound
        return _Trsf(_COMPOUND, b.m, _add(_mat_vec(b.m, a.t), b.t))
    return _Trsf(_COMPOUND, _mat_mul(b.m, a.m), _add(_mat_vec(b.m, a.t), b.t))


def _inverted(a):
    """gp_Trsf::Inverted."""
    if a.form == _IDENTITY:
        return a
    if a.form == _TRANSLATION:
        return _Trsf(_TRANSLATION, a.m, _neg(a.t))
    m = _transpose(a.m)
    t = _mat_vec(m, a.t)
    return _Trsf(a.form, m, (t[0] * -1.0, t[1] * -1.0, t[2] * -1.0))


def _powered(a, n):
    """gp_Trsf::Powered(n)."""
    if a.form == _IDENTITY or n == 1:
        return a
    if n == 0:
        return _IDENTITY_TRSF
    if n == -1:
        return _inverted(a)
    if n < 0:
        a = _inverted(a)
    count = abs(n) - 1
    if a.form == _TRANSLATION:
        loc, temp = a.t, a.t
        while True:
            if count % 2:
                loc = _add(loc, temp)
            if count == 1:
                break
            temp = _add(temp, temp)
            count //= 2
        return _Trsf(_TRANSLATION, a.m, loc)
    m, temp_m, loc = a.m, a.m, a.t
    if a.form == _ROTATION and loc == (0.0, 0.0, 0.0):
        while True:
            if count % 2:
                m = _mat_mul(m, temp_m)
            if count == 1:
                break
            temp_m = _mat_mul(temp_m, temp_m)
            count //= 2
        return _Trsf(a.form, m, loc)
    temp_loc = loc
    while True:
        if count % 2:
            loc = _add(loc, _mat_vec(m, temp_loc))
            m = _mat_mul(m, temp_m)
        if count == 1:
            break
        temp_loc = _add(temp_loc, _mat_vec(temp_m, temp_loc))
        temp_m = _mat_mul(temp_m, temp_m)
        count //= 2
    return _Trsf(a.form, m, loc)


def _rotation_about(point, direction, angle):
    """gp_Trsf::SetRotation(gp_Ax1(point, direction), angle) with gp_Mat::SetRotation."""
    a, b, c = _gp_dir(direction)  # gp_Mat::SetRotation normalizes the (already unit) axis again
    s, k = _math.sin(angle), 1.0 - _math.cos(angle)
    cross = ((0.0, -c, b), (c, 0.0, -a), (-b, a, 0.0))
    square = ((-c * c - b * b, a * b, a * c), (a * b, -a * a - c * c, b * c), (a * c, b * c, -a * a - b * b))
    m = tuple(tuple(cross[i][j] * s + _IDENTITY_MATRIX[i][j] + square[i][j] * k for j in range(3)) for i in range(3))
    loc = _add(_mat_vec(m, _neg(point)), point)
    return _Trsf(_ROTATION, m, loc)


# ---------------------------------------------------------------------------
# gp_Quaternion and Euler sequences.

# gp_EulerSequence parameters (first axis 1..3, odd permutation, proper Euler, extrinsic) by (kind, name).
_EULER = {
    ("Extrinsic", "XYZ"): (1, False, False, True), ("Extrinsic", "XZY"): (1, True, False, True),
    ("Extrinsic", "YZX"): (2, False, False, True), ("Extrinsic", "YXZ"): (2, True, False, True),
    ("Extrinsic", "ZXY"): (3, False, False, True), ("Extrinsic", "ZYX"): (3, True, False, True),
    ("Intrinsic", "XYZ"): (3, True, False, False), ("Intrinsic", "XZY"): (2, False, False, False),
    ("Intrinsic", "YZX"): (1, True, False, False), ("Intrinsic", "YXZ"): (3, False, False, False),
    ("Intrinsic", "ZXY"): (2, True, False, False), ("Intrinsic", "ZYX"): (1, False, False, False),
    ("Extrinsic", "XYX"): (1, False, True, True), ("Extrinsic", "XZX"): (1, True, True, True),
    ("Extrinsic", "YZY"): (2, False, True, True), ("Extrinsic", "YXY"): (2, True, True, True),
    ("Extrinsic", "ZXZ"): (3, False, True, True), ("Extrinsic", "ZYZ"): (3, True, True, True),
    ("Intrinsic", "XYX"): (1, False, True, False), ("Intrinsic", "XZX"): (1, True, True, False),
    ("Intrinsic", "YZY"): (2, False, True, False), ("Intrinsic", "YXY"): (2, True, True, False),
    ("Intrinsic", "ZXZ"): (3, False, True, False), ("Intrinsic", "ZYZ"): (3, True, True, False),
}


def _sequence(key):
    first, odd, two_axes, extrinsic = _EULER[key]
    i = first
    j = 1 + (first + (1 if odd else 0)) % 3
    k = 1 + (first + (0 if odd else 1)) % 3
    return i, j, k, odd, two_axes, extrinsic


def _quaternion_from_euler(key, alpha, beta, gamma):
    """gp_Quaternion::SetEulerAngles -> (x, y, z, w)."""
    i, j, k, odd, two_axes, extrinsic = _sequence(key)
    a, b, c = alpha, beta, gamma
    if not extrinsic:
        a, c = gamma, alpha
    if odd:
        b = -b
    ti, tj, th = 0.5 * a, 0.5 * b, 0.5 * c
    ci, cj, ch = _math.cos(ti), _math.cos(tj), _math.cos(th)
    si, sj, sh = _math.sin(ti), _math.sin(tj), _math.sin(th)
    cc, cs, sc, ss = ci * ch, ci * sh, si * ch, si * sh
    values = [0.0] * 4  # w, x, y, z
    if two_axes:
        values[i] = cj * (cs + sc)
        values[j] = sj * (cc + ss)
        values[k] = sj * (cs - sc)
        values[0] = cj * (cc - ss)
    else:
        values[i] = cj * sc - sj * cs
        values[j] = cj * ss + sj * cc
        values[k] = cj * cs - sj * sc
        values[0] = cj * cc + sj * ss
    if odd:
        values[j] = -values[j]
    return values[1], values[2], values[3], values[0]


def _quaternion_matrix(q):
    """gp_Quaternion::GetMatrix."""
    x, y, z, w = q
    s = 2.0 / (x * x + y * y + z * z + w * w)
    x2, y2, z2 = x * s, y * s, z * s
    xx, xy, xz = x * x2, x * y2, x * z2
    yy, yz, zz = y * y2, y * z2, z * z2
    wx, wy, wz = w * x2, w * y2, w * z2
    return ((1.0 - (yy + zz), xy - wz, xz + wy),
            (xy + wz, 1.0 - (xx + zz), yz - wx),
            (xz - wy, yz + wx, 1.0 - (xx + yy)))


def _matrix_quaternion(m):
    """gp_Quaternion::SetMatrix -> (x, y, z, w)."""
    tr = m[0][0] + m[1][1] + m[2][2]
    if tr > 0.0:
        q = (m[2][1] - m[1][2], m[0][2] - m[2][0], m[1][0] - m[0][1], tr + 1.0)
        scale = 0.5 / _math.sqrt(q[3])
    elif m[0][0] > m[1][1] and m[0][0] > m[2][2]:
        q = (1.0 + m[0][0] - m[1][1] - m[2][2], m[0][1] + m[1][0], m[0][2] + m[2][0], m[2][1] - m[1][2])
        scale = 0.5 / _math.sqrt(q[0])
    elif m[1][1] > m[2][2]:
        q = (m[0][1] + m[1][0], 1.0 + m[1][1] - m[0][0] - m[2][2], m[1][2] + m[2][1], m[0][2] - m[2][0])
        scale = 0.5 / _math.sqrt(q[1])
    else:
        q = (m[0][2] + m[2][0], m[1][2] + m[2][1], 1.0 + m[2][2] - m[0][0] - m[1][1], m[1][0] - m[0][1])
        scale = 0.5 / _math.sqrt(q[2])
    return tuple(c * scale for c in q)


def _euler_from_quaternion(key, q):
    """gp_Quaternion::GetEulerAngles in radians."""
    m = _quaternion_matrix(q)
    i, j, k, odd, two_axes, extrinsic = _sequence(key)
    M = lambda r, c: m[r - 1][c - 1]  # noqa: E731 - OCCT's 1-based M(row, col)
    if two_axes:
        sy = _math.sqrt(M(i, j) * M(i, j) + M(i, k) * M(i, k))
        if sy > 16 * _sys.float_info.epsilon:
            alpha = _math.atan2(M(i, j), M(i, k))
            gamma = _math.atan2(M(j, i), -M(k, i))
        else:
            alpha = _math.atan2(-M(j, k), M(j, j))
            gamma = 0.0
        beta = _math.atan2(sy, M(i, i))
    else:
        cy = _math.sqrt(M(i, i) * M(i, i) + M(j, i) * M(j, i))
        if cy > 16 * _sys.float_info.epsilon:
            alpha = _math.atan2(M(k, j), M(k, k))
            gamma = _math.atan2(M(j, i), M(i, i))
        else:
            alpha = _math.atan2(-M(j, k), M(j, j))
            gamma = 0.0
        beta = _math.atan2(-M(k, i), cy)
    if odd:
        alpha, beta, gamma = -alpha, -beta, -gamma
    if not extrinsic:
        alpha, gamma = gamma, alpha
    return alpha, beta, gamma


def _ordering_key(ordering):
    """(kind, name) of a shim Intrinsic/Extrinsic member; build123d falls back to Intrinsic.XYZ."""
    shim = _sys.modules.get("build123d")
    for kind in ("Intrinsic", "Extrinsic"):
        enum = getattr(shim, kind, None)
        if isinstance(enum, type) and isinstance(ordering, enum):
            return kind, ordering.name
    return "Intrinsic", "XYZ"


def _is_ordering(value):
    shim = _sys.modules.get("build123d")
    return any(isinstance(value, getattr(shim, kind)) for kind in ("Intrinsic", "Extrinsic")
               if isinstance(getattr(shim, kind, None), type))


def _euler_trsf(angles, ordering=None):
    """gp_Trsf::SetRotation(quaternion from Euler angles in degrees)."""
    q = _quaternion_from_euler(_ordering_key(ordering), *(_math.radians(a) for a in angles))
    return _Trsf(_ROTATION, _quaternion_matrix(q), _ZERO)


def _key_digits(values):
    return tuple(round(v, GEOM_KEY_DIGITS) for v in values)


# ---------------------------------------------------------------------------
# gp_Ax3 frames.

def _ax3(origin, z, x=None):
    """gp_Ax3(P, V[, Vx]) -> (origin, x, y, z); V and Vx are gp_Dir (unit)."""
    if x is None:
        a, b, c = z
        aa, ba, ca = abs(a), abs(b), abs(c)
        if ba <= aa and ba <= ca:
            d = (-c, 0.0, a) if aa > ca else (c, 0.0, -a)
        elif aa <= ba and aa <= ca:
            d = (0.0, -c, b) if ba > ca else (0.0, c, -b)
        else:
            d = (-b, a, 0.0) if aa > ba else (b, -a, 0.0)
        vx = _gp_dir(d)
    else:
        vx = _dir_cross_cross(z, x, z)
    return origin, vx, _dir_cross(z, vx), z


def _dir_transform(trsf, d):
    """gp_Dir::Transform."""
    if trsf.form in (_IDENTITY, _TRANSLATION):
        return d
    return _gp_dir(_mat_vec(trsf.m, d))


def _vec_transform(trsf, v):
    """gp_Vec::Transform."""
    if trsf.form in (_IDENTITY, _TRANSLATION):
        return v
    return _mat_vec(trsf.m, v)


def _pnt_transform(trsf, p):
    """gp_Pnt::Transform."""
    if trsf.form == _IDENTITY:
        return p
    if trsf.form == _TRANSLATION:
        return _add(p, trsf.t)
    return _add(_mat_vec(trsf.m, p), trsf.t)


def _frame_trsf(origin, x, y, z):
    """gp_Trsf::SetTransformation(gp_Ax3) followed by Invert(): the frame's placement."""
    m = (x, y, z)  # SetCols then Transpose: rows are the axes
    loc = _mat_vec(m, origin)
    loc = _neg(loc)
    m = _transpose(m)
    t = _mat_vec(m, loc)
    return _Trsf(_COMPOUND, m, (t[0] * -1.0, t[1] * -1.0, t[2] * -1.0))


# ---------------------------------------------------------------------------
# Attribute errors: capability for build123d names the shim lacks, AttributeError otherwise.

class _GeometryMeta(_Implemented):
    def __getattr__(cls, name):
        if name.startswith("_") or name not in cls._wonky_public:
            raise AttributeError(f"type object {cls.__name__!r} has no attribute {name!r}")
        return _unsupported(f"{cls.__name__}.{name} is not implemented by the Python frontend")


def _missing(self, name, what=None):
    if name.startswith("_") or name not in type(self)._wonky_public:
        raise AttributeError(f"{type(self).__name__!r} object has no attribute {name!r}")
    if name == "wrapped":
        return _unsupported(f"{type(self).__name__}.wrapped is an OpenCascade (OCP) object, and external "
                            f"geometry is disabled: production geometry must be constructed in Bend")
    return _unsupported(f"{type(self).__name__}.{name} is not implemented by the Python frontend"
                        + (f" ({what})" if what else ""))


# ---------------------------------------------------------------------------
# Vector

class Vector(metaclass=_GeometryMeta):
    """build123d.Vector: a mutable 3D vector (gp_Vec)."""

    __slots__ = ("_xyz", "vector_index")
    build123d_type = "Vector"
    _dim = 0
    _wonky_public = frozenset({"X", "Y", "Z", "add", "build123d_type", "center", "cross", "distance_to_plane", "dot",
                               "get_angle", "get_signed_angle", "intersect", "length", "multiply", "normalized",
                               "project_to_line", "project_to_plane", "reverse", "rotate",
                               "signed_distance_from_plane", "sub", "to_dir", "to_pnt", "transform", "wrapped"})

    def __init__(self, *args, **kwargs):
        self.vector_index = 0
        x, y, z, xyz = 0, 0, 0, None
        unknown = ", ".join(set(kwargs).difference(["v", "X", "Y", "Z"]))
        if unknown:
            raise ValueError(f"Unexpected argument(s) {unknown}")
        if args and all(isinstance(a, (int, float)) for a in args):
            values = list(args) + [0.0] * max(0, 3 - len(args))
            x, y, z = values[0:3]
        elif len(args) == 1 or "v" in kwargs:
            first = kwargs.get("v", args[0] if args else None)
            if isinstance(first, Vector):
                xyz = first._xyz
            elif isinstance(first, (tuple, _abc.Iterable)):
                try:
                    values = [float(value) for value in first]
                except (TypeError, ValueError) as exc:
                    raise TypeError("Expected floats") from exc
                values += [0.0] * (3 - len(values))
                xyz = tuple(values[0:3])
            else:
                raise TypeError("Expected floats, OCC gp_, or iterable")
        x, y, z = kwargs.get("X", x), kwargs.get("Y", y), kwargs.get("Z", z)
        self._xyz = xyz if xyz is not None else (float(x), float(y), float(z))

    @classmethod
    def _of(cls, xyz):
        vector = object.__new__(cls)
        vector.vector_index = 0
        vector._xyz = tuple(xyz)
        return vector

    def __iter__(self):
        return iter(self._xyz)

    X = property(lambda self: self._xyz[0], lambda self, v: self._set(0, v), doc="Get x value")
    Y = property(lambda self: self._xyz[1], lambda self, v: self._set(1, v), doc="Get y value")
    Z = property(lambda self: self._xyz[2], lambda self, v: self._set(2, v), doc="Get z value")

    def _set(self, index, value):
        xyz = list(self._xyz)
        xyz[index] = float(value)
        self._xyz = tuple(xyz)

    @property
    def length(self):
        return _modulus(self._xyz)

    def cross(self, vec):
        return Vector._of(_cross(self._xyz, vec._xyz))

    def dot(self, vec):
        a, b = self._xyz, vec._xyz
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

    def _other(self, vec, verb):
        if isinstance(vec, Vector):
            return vec._xyz
        if isinstance(vec, tuple):
            return Vector(vec)._xyz
        raise ValueError(f"Only Vectors or tuples can be {verb} Vectors")

    def sub(self, vec):
        b = self._other(vec, "subtracted from")
        a = self._xyz
        return Vector._of((a[0] - b[0], a[1] - b[1], a[2] - b[2]))

    __sub__ = sub

    def add(self, vec):
        return Vector._of(_add(self._xyz, self._other(vec, "added to")))

    __add__ = add

    def __radd__(self, vec):
        vec = Vector(0, 0, 0) if vec == 0 else vec  # sum() starts with 0
        return self.add(vec)

    def multiply(self, scale):
        return Vector._of(tuple(c * scale for c in self._xyz))

    __mul__ = __rmul__ = multiply

    def __truediv__(self, denom):
        return self.multiply(1.0 / denom)

    def normalized(self):
        d = self.length
        if d <= _RESOLUTION:
            raise Standard_ConstructionError("gp_Vec::Normalized() - vector has zero norm")
        return Vector._of(tuple(c / d for c in self._xyz))

    def reverse(self):
        return self * -1.0

    def center(self):
        return self

    def get_angle(self, vec):
        """gp_Vec::Angle in degrees."""
        a, b = self.normalized()._xyz, vec.normalized()._xyz
        cosine = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
        if -0.70710678118655 < cosine < 0.70710678118655:
            return _math.acos(cosine) * 180 / _math.pi
        sine = _modulus(_cross(a, b))
        return (_math.asin(sine) if cosine >= 0 else _math.pi - _math.asin(sine)) * 180 / _math.pi

    def project_to_line(self, line):
        line_length = line.length
        return line * (self.dot(line) / (line_length * line_length))

    def signed_distance_from_plane(self, plane):
        return (self - plane.origin).dot(plane.z_dir)

    def project_to_plane(self, plane):
        base, normal = plane.origin, plane.z_dir
        return self - normal * (((self - base).dot(normal)) / normal.length ** 2)

    def rotate(self, axis, angle):
        """gp_Vec::Rotated about the axis direction (a vector ignores the axis position)."""
        return Vector._of(_vec_transform(_rotation_about(_ZERO, axis._direction, _math.radians(angle)), self._xyz))

    def __neg__(self):
        return self * -1

    def __abs__(self):
        return self.length

    def __and__(self, other):
        return _unsupported("Vector & ... (intersect) is not implemented by the Python frontend")

    def __format__(self, spec):
        last = spec[-1] if spec else None
        if last in ("f", "g"):
            return _core._format_vector(self._xyz, spec)
        return str(tuple(self))

    def __repr__(self):
        return f"{type(self).__name__}{self:.13g}"

    def __str__(self):
        x, y, z = format(self, ".6g")[1:-1].split(", ")
        return f"{type(self).__name__}: (X={x}, Y={y}, Z={z})"

    def __eq__(self, other):
        if not isinstance(other, Vector):
            return NotImplemented
        return self._key() == other._key()

    def __hash__(self):
        return hash(self._key())

    def _key(self):
        return _key_digits(self._xyz)

    def __round__(self, ndigits=None):
        return Vector(round(self.X, ndigits), round(self.Y, ndigits), round(self.Z, ndigits))

    def __copy__(self):
        return Vector(self.X, self.Y, self.Z)

    def __deepcopy__(self, _memo):
        return Vector(self.X, self.Y, self.Z)

    def __getattr__(self, name):
        return _missing(self, name)


# ---------------------------------------------------------------------------
# Location (TopLoc_Location)

class _Datum:
    """TopLoc_Datum3D: identity matters, compositions cancel adjacent powers of the same datum."""

    __slots__ = ("trsf",)

    def __init__(self, trsf):
        self.trsf = trsf


def _construct(nodes, datum, power):
    """TopLoc_SListOfItemLocation::Construct: the node's transformation is tail * item."""
    item = _powered(datum.trsf, power)
    return nodes + ((datum, power, _premultiply(item, nodes[-1][2]) if nodes else item),)


def _chain_multiplied(a, b):
    """TopLoc_Location::Multiplied (a * b), items bottom-first; the head is the last item."""
    if not a:
        return b
    if not b:
        return a
    result = _chain_multiplied(a, b[:-1])
    datum, power = b[-1][0], b[-1][1]
    if result and result[-1][0] is datum:
        power += result[-1][1]
        result = result[:-1]
    if power != 0:
        result = _construct(result, datum, power)
    return result


def _chain_inverted(nodes):
    result = ()
    for datum, power, _ in reversed(nodes):
        result = _construct(result, datum, -power)
    return result


def _chain_powered(nodes, n):
    if not nodes or n == 1:
        return nodes
    if n == 0:
        return ()
    if len(nodes) == 1:
        return _construct((), nodes[0][0], nodes[0][1] * n)
    if n > 0:
        return _chain_multiplied(nodes, _chain_powered(nodes, n - 1))
    return _chain_powered(_chain_inverted(nodes), -n)


def _single(trsf):
    """TopLoc_Location(gp_Trsf): one new datum."""
    return _construct((), _Datum(trsf), 1)


class Location(metaclass=_GeometryMeta):
    """build123d.Location: position and orientation (TopLoc_Location)."""

    __slots__ = ("_nodes", "location_index")
    build123d_type = "Location"
    _wonky_public = frozenset({"build123d_type", "center", "intersect", "inverse", "mirror", "orientation",
                               "position", "wrapped", "x_axis", "y_axis", "z_axis"})

    def __init__(self, *args, **kwargs):
        self.location_index = 0
        position = kwargs.pop("position", None)
        orientation = kwargs.pop("orientation", None)
        direction = kwargs.pop("direction", None)
        ordering = kwargs.pop("ordering", None)
        angle = kwargs.pop("angle", None)
        plane = kwargs.pop("plane", None)
        location = kwargs.pop("location", None)
        for ocp in ("top_loc", "gp_trsf"):
            if kwargs.pop(ocp, None) is not None:
                _unsupported(f"Location({ocp}=...) takes an OpenCascade (OCP) object, and external geometry is "
                             f"disabled: production geometry must be constructed in Bend")
        if kwargs:
            raise TypeError(f"Unexpected keyword arguments: {', '.join(kwargs)}")
        if args:
            first = args[0]
            if plane is None and isinstance(first, Plane):
                plane = first
            elif location is None and isinstance(first, Location):
                location = first
            elif isinstance(first, (Vector, _abc.Iterable)):
                position = Vector(first)
                if len(args) > 1:
                    if isinstance(args[1], (Vector, _abc.Iterable)):
                        orientation = Vector(args[1])
                    elif isinstance(args[1], (int, float)):
                        angle = args[1]
                if len(args) > 2:
                    if isinstance(args[1], (Vector, _abc.Iterable)) and isinstance(args[2], (int, float)):
                        direction = Vector(args[1])
                        angle = args[2]
                    elif _is_ordering(args[2]):
                        ordering = args[2]
                    else:
                        raise TypeError(f"Third parameter must be a float or order not {args[2]}")
            else:
                raise TypeError(f"Invalid positional arguments: {args}")

        trsf = _IDENTITY_TRSF
        if isinstance(plane, Plane):
            trsf = _frame_trsf(plane._origin, plane._x, plane._y, plane._z)
        elif angle is not None:
            axis = _gp_dir(Vector(direction)._xyz) if direction else (0.0, 0.0, 1.0)
            trsf = _rotation_about(_ZERO, axis, _math.radians(angle))
        elif orientation is not None:
            trsf = _euler_trsf(list(orientation), ordering)
        if position:
            trsf = _with_translation(trsf, Vector(position)._xyz)

        if isinstance(location, Location):
            self._nodes = location._nodes
        else:
            self._nodes = _single(trsf)

    @classmethod
    def _of(cls, nodes):
        location = object.__new__(cls)
        location.location_index = 0
        location._nodes = nodes
        return location

    def _trsf(self):
        """TopLoc_Location::Transformation()."""
        return self._nodes[-1][2] if self._nodes else _IDENTITY_TRSF

    def _wonky_rigid(self):
        """(3x3 rotation rows, offset in mm): the protocol other shim modules place geometry with."""
        trsf = self._trsf()
        return trsf.m, trsf.t

    @property
    def position(self):
        return Vector._of(self._trsf().t)

    @position.setter
    def position(self, value):
        rotation = _Trsf(_ROTATION, _quaternion_matrix(_matrix_quaternion(self._trsf().m)), _ZERO)
        self._nodes = _single(_multiply(_with_translation(_IDENTITY_TRSF, Vector(value)._xyz), rotation))

    @property
    def orientation(self):
        angles = _euler_from_quaternion(("Intrinsic", "XYZ"), _matrix_quaternion(self._trsf().m))
        return Vector._of(tuple(_math.degrees(a) for a in angles))

    @orientation.setter
    def orientation(self, rotation):
        position = _with_translation(_IDENTITY_TRSF, self._trsf().t)
        self._nodes = _single(_multiply(position, _euler_trsf(list(rotation))))

    @property
    def x_axis(self):
        plane = Plane(self)
        return Axis(plane.origin, plane.x_dir)

    @property
    def y_axis(self):
        plane = Plane(self)
        return Axis(plane.origin, plane.y_dir)

    @property
    def z_axis(self):
        plane = Plane(self)
        return Axis(plane.origin, plane.z_dir)

    def inverse(self):
        return Location._of(_chain_inverted(self._nodes))

    def center(self):
        return self.position

    def __copy__(self):
        return Location._of(_single(self._trsf()))

    def __deepcopy__(self, _memo):
        return Location._of(_single(self._trsf()))

    def __mul__(self, other):
        if isinstance(other, Location):
            return Location._of(_chain_multiplied(self._nodes, other._nodes))
        # Shapes such as Sketch and Compound may also be iterable: a movable object moves as a whole.
        if callable(getattr(other, "moved", None)):
            return other.moved(self)
        try:
            others = list(other)
        except TypeError:
            return NotImplemented
        if all(isinstance(item, Location) for item in others):
            return [Location._of(_chain_multiplied(self._nodes, item._nodes)) for item in others]
        if all(callable(getattr(item, "moved", None)) for item in others):
            return [item.moved(self) for item in others]
        return NotImplemented

    def __pow__(self, exponent):
        if isinstance(exponent, bool) or not isinstance(exponent, int):
            return _unsupported(f"{type(self).__name__} ** exponent supports only integer exponents")
        return Location._of(_chain_powered(self._nodes, exponent))

    def __eq__(self, other):
        if not isinstance(other, Location):
            return NotImplemented
        return self._key() == other._key()

    def __hash__(self):
        return hash(self._key())

    def _key(self):
        """build123d Location._key: position rounded to 5 digits, canonical rounded quaternion."""
        trsf = self._trsf()
        components = list(_matrix_quaternion(trsf.m))
        for value in components:
            if abs(value) > TOLERANCE:
                if value < 0:
                    components = [-c for c in components]
                break
        return _key_digits(trsf.t), _key_digits(components)

    def __iter__(self):
        return _unsupported(f"Iterating a {type(self).__name__} yields build123d Vectors (position, orientation); "
                            f"this is not implemented by the Python frontend, use .position and .orientation")

    def __neg__(self):
        return _unsupported(f"-{type(self).__name__} flips the orientation (Location(-Plane(location))), which is "
                            f"not implemented by the Python frontend")

    def __and__(self, other):
        return _unsupported("Location & ... (intersect) is not implemented by the Python frontend")

    def __format__(self, spec):
        last = spec[-1] if spec else None
        if last in ("f", "g"):
            return f"({self.position:{spec}}, {self.orientation:{spec}})"
        return f"({tuple(self.position)}, {tuple(self.orientation)})"

    def __repr__(self):
        return f"{type(self).__name__}{self:.{TOL_DIGITS}g}"

    def __str__(self):
        return (f"{type(self).__name__}: (position={self.position:.{TOL_DIGITS}g}, "
                f"orientation={self.orientation:.{TOL_DIGITS}g})")

    def __getattr__(self, name):
        return _missing(self, name)


class Rotation(Location):
    """build123d.Rotation (Rot): a Location that only rotates."""

    __slots__ = ()

    def __init__(self, *args, **kwargs):
        rotation_like = kwargs.pop("rotation", None)
        x_angle = kwargs.pop("X", None)
        y_angle = kwargs.pop("Y", None)
        z_angle = kwargs.pop("Z", None)
        ordering = kwargs.pop("ordering", None)
        axis = kwargs.pop("axis", None)
        axis_angle = kwargs.pop("angle", None)
        if kwargs:
            raise TypeError(f"Unexpected keyword arguments: {', '.join(kwargs)}")
        if args:
            first = args[0]
            if isinstance(first, Axis):
                axis = first if axis is None else axis
                axis_angle = args[1] if len(args) > 1 and axis_angle is None else axis_angle
                if len(args) > 2:
                    raise TypeError("Too many arguments for axis-angle Rotation")
            elif isinstance(first, (Rotation, Vector, tuple)):
                rotation_like = first if rotation_like is None else rotation_like
                ordering = args[1] if len(args) > 1 and ordering is None else ordering
                if len(args) > 2:
                    raise TypeError("Too many arguments for RotationLike Rotation")
            elif isinstance(first, (int, float)):
                x_angle = first if x_angle is None else x_angle
                y_angle = args[1] if len(args) > 1 and y_angle is None else y_angle
                z_angle = args[2] if len(args) > 2 and z_angle is None else z_angle
                ordering = args[3] if len(args) > 3 and ordering is None else ordering
                if len(args) > 4:
                    raise TypeError("Too many arguments for Euler-angle Rotation")
            else:
                raise TypeError(f"Invalid positional arguments: {args}")

        has_axis_angle = axis is not None or axis_angle is not None
        has_euler_angles = any(angle is not None for angle in (x_angle, y_angle, z_angle))
        if has_axis_angle:
            if axis is None or axis_angle is None:
                raise TypeError("Both an Axis and angle must be provided")
            if rotation_like is not None or has_euler_angles or ordering is not None:
                raise TypeError("Unsupported or ambiguous Rotation arguments")
            if not isinstance(axis, Axis):
                raise TypeError(f"Axis must be an Axis, not {type(axis).__name__}")
            if not isinstance(axis_angle, (int, float)):
                raise TypeError(f"Angle must be an int or float, not {type(axis_angle).__name__}")
            trsf = _IDENTITY_TRSF
            if axis_angle != 0.0:
                trsf = _rotation_about(axis._position, axis._direction, _math.radians(axis_angle))
            self.location_index = 0
            self._nodes = _single(trsf)
        elif rotation_like is not None:
            if has_euler_angles:
                raise TypeError("Unsupported or ambiguous Rotation arguments")
            if ordering is not None and not _is_ordering(ordering):
                raise TypeError("ordering must be an Extrinsic or Intrinsic value")
            if isinstance(rotation_like, Rotation):
                super().__init__(rotation_like)
            elif isinstance(rotation_like, (Vector, tuple)):
                angles = list(rotation_like)[:3]
                angles.extend([0.0] * (3 - len(angles)))
                if not all(isinstance(angle, (int, float)) for angle in angles):
                    raise TypeError("Euler angles must be int or float values")
                super().__init__((0, 0, 0), tuple(angles), ordering or _default_ordering())
            else:
                raise TypeError("rotation must be a Rotation, Vector, or tuple of Euler angles")
        else:
            angles = tuple(a if a is not None else 0.0 for a in (x_angle, y_angle, z_angle))
            if not all(isinstance(angle, (int, float)) for angle in angles):
                raise TypeError("Euler angles must be int or float values")
            if ordering is not None and not _is_ordering(ordering):
                raise TypeError("ordering must be an Extrinsic or Intrinsic value")
            super().__init__((0, 0, 0), angles, ordering or _default_ordering())


def _default_ordering():
    return getattr(_sys.modules.get("build123d"), "Intrinsic").XYZ


Rot = Rotation


class Pos(Location):
    """build123d.Pos: a position-only Location."""

    __slots__ = ()

    def __init__(self, *args, **kwargs):
        x, y, z, v = 0, 0, 0, None
        if args:
            if all(isinstance(value, (float, int)) for value in args):
                x, y, z = Vector(args)
            elif len(args) == 1:
                x, y, z = Vector(args[0])
            else:
                raise TypeError(f"Invalid inputs to Pos {args}")
        x = kwargs.pop("X", x)
        y = kwargs.pop("Y", y)
        z = kwargs.pop("Z", z)
        v = kwargs.pop("v", Vector(x, y, z))
        if kwargs:
            raise ValueError(f"Unexpected argument(s): {', '.join(kwargs.keys())}")
        if v is not None:
            x, y, z = v
        super().__init__(Vector(x, y, z))


# ---------------------------------------------------------------------------
# Plane (gp_Pln)

class _PlaneMeta(_GeometryMeta):
    XY = property(lambda cls: cls((0, 0, 0), (1, 0, 0), (0, 0, 1)), doc="XY Plane")
    YZ = property(lambda cls: cls((0, 0, 0), (0, 1, 0), (1, 0, 0)), doc="YZ Plane")
    ZX = property(lambda cls: cls((0, 0, 0), (0, 0, 1), (0, 1, 0)), doc="ZX Plane")
    XZ = property(lambda cls: cls((0, 0, 0), (1, 0, 0), (0, -1, 0)), doc="XZ Plane")
    YX = property(lambda cls: cls((0, 0, 0), (0, 1, 0), (0, 0, -1)), doc="YX Plane")
    ZY = property(lambda cls: cls((0, 0, 0), (0, 0, 1), (-1, 0, 0)), doc="ZY Plane")
    front = property(lambda cls: cls((0, 0, 0), (1, 0, 0), (0, -1, 0)), doc="Front Plane")
    back = property(lambda cls: cls((0, 0, 0), (-1, 0, 0), (0, 1, 0)), doc="Back Plane")
    left = property(lambda cls: cls((0, 0, 0), (0, -1, 0), (-1, 0, 0)), doc="Left Plane")
    right = property(lambda cls: cls((0, 0, 0), (0, 1, 0), (1, 0, 0)), doc="Right Plane")
    top = property(lambda cls: cls((0, 0, 0), (1, 0, 0), (0, 0, 1)), doc="Top Plane")
    bottom = property(lambda cls: cls((0, 0, 0), (1, 0, 0), (0, 0, -1)), doc="Bottom Plane")
    isometric = property(lambda cls: cls((0, 0, 0), (1 / 2 ** 0.5, 1 / 2 ** 0.5, 0),
                                         (1 / 3 ** 0.5, -1 / 3 ** 0.5, 1 / 3 ** 0.5)), doc="Isometric Plane")


_PLANE_TYPE_ERROR = "Expected gp_Pln, Face, Location, Axis, VectorLike, or three points"


def _is_shape_like(value):
    """A shim topology object (Shape, Face, Sketch, ...): Plane(face) needs face geometry the shim lacks."""
    return isinstance(value, _core.Shape) or type(value).__name__ in ("Face", "Sketch", "Wire", "Edge", "Vertex",
                                                                         "Shell", "Solid", "Compound", "Part")


class Plane(metaclass=_PlaneMeta):
    """build123d.Plane: origin with x, y and z directions (right-handed gp_Ax3)."""

    __slots__ = ("_origin", "_x", "_y", "_z")
    build123d_type = "Plane"
    _wonky_public = frozenset({"build123d_type", "contains", "forward_transform", "from_local_coords",
                               "get_topods_face_normal", "intersect", "location", "location_between", "move",
                               "moved", "offset", "origin", "reverse", "reverse_transform", "rotated",
                               "shift_origin", "to_gp_ax2", "to_gp_ax3", "to_local_coords", "wrapped", "x_dir",
                               "y_dir", "z_dir"})

    @staticmethod
    def _single_arg_as_origin_and_dirs(arg0):
        sequence = list(arg0)
        if all(isinstance(coordinate, (int, float)) for coordinate in sequence):
            return Vector(sequence), None
        if len(sequence) != 3:
            raise TypeError("Expected three VectorLike points")
        try:
            points = [Vector(point) for point in sequence]
        except Exception as exc:
            raise TypeError("Expected three VectorLike points") from exc
        x_dir = points[1] - points[0]
        return points[0], (x_dir, x_dir.cross(points[2] - points[0]))

    def __init__(self, *args, **kwargs):
        passed_z_dir, passed_y_dir = "z_dir" in kwargs, "y_dir" in kwargs
        for ocp in ("gp_pln",):
            if kwargs.pop(ocp, None) is not None:
                _unsupported("Plane(gp_pln=...) takes an OpenCascade (OCP) object, and external geometry is disabled")
        arg_face = kwargs.pop("face", None)
        arg_location = kwargs.pop("location", None)
        arg_axis = kwargs.pop("axis", None)
        arg_origin = kwargs.pop("origin", None)
        arg_x_dir = kwargs.pop("x_dir", None)
        arg_y_dir = kwargs.pop("y_dir", None)
        arg_z_dir = kwargs.pop("z_dir", (0, 0, 1))
        if kwargs:
            raise TypeError(f"Unexpected keyword arguments: {', '.join(kwargs)}")
        if args:
            arg0 = args[0]
            if arg_face is None and _is_shape_like(arg0):
                arg_face = arg0
            elif arg_location is None and isinstance(arg0, Location):
                arg_location = arg0
            elif arg_axis is None and isinstance(arg0, Axis):
                arg_axis = arg0
                if len(args) > 1:
                    try:
                        arg_x_dir = Vector(args[1])
                    except Exception as exc:
                        raise TypeError(_PLANE_TYPE_ERROR) from exc
            elif arg_origin is None:
                try:
                    if len(args) == 1 and not any((arg_x_dir, arg_y_dir, passed_y_dir, passed_z_dir)):
                        arg_origin, dirs = self._single_arg_as_origin_and_dirs(arg0)
                        if dirs is not None:
                            arg_x_dir, arg_z_dir = dirs
                    else:
                        arg_origin = Vector(arg0)
                    if arg_x_dir is None and len(args) > 1:
                        arg_x_dir = Vector(args[1]).normalized()
                    if len(args) > 2:
                        arg_z_dir = Vector(args[2]).normalized()
                except TypeError:
                    raise
                except Exception as exc:
                    raise TypeError(_PLANE_TYPE_ERROR) from exc
        if arg_face is not None:
            _unsupported("Plane(face) is not implemented by the Python frontend: it needs the face's surface "
                         "and centre of mass")
            return

        if arg_location:
            trsf = arg_location._trsf()
            origin = arg_location.position
            # BRepBuilderAPI_MakeFace(Plane.XY) moved by the location: the surface's transformed
            # x direction and the face normal D1U x D1V, both rounded to 14 digits.
            xy = Plane.XY
            x_dir = round(Vector._of(_dir_transform(trsf, xy._x)), 14)
            z_dir = round(Vector._of(_cross(_vec_transform(trsf, xy._x), _vec_transform(trsf, xy._y))), 14)
        elif arg_axis:
            origin = arg_axis.position
            x_dir = Vector(arg_x_dir) if arg_x_dir is not None else None
            z_dir = arg_axis.direction
        elif arg_origin is not None:
            origin = Vector(arg_origin)
            x_dir = Vector(arg_x_dir) if arg_x_dir else None
            z_dir = Vector(arg_z_dir)
        else:
            raise TypeError(_PLANE_TYPE_ERROR)

        if passed_y_dir and passed_z_dir:
            raise TypeError("Specify either y_dir or z_dir, not both")
        if arg_y_dir is not None:
            if x_dir is None:
                raise ValueError("x_dir must be provided when y_dir is specified")
            if Vector(x_dir).length == 0.0:
                raise ValueError("x_dir must be non null")
            if Vector(arg_y_dir).length == 0.0:
                raise ValueError("y_dir must be non null")
            x_dir = Vector(x_dir).normalized()
            z_from_xy = x_dir.cross(Vector(arg_y_dir).normalized())
            if z_from_xy.length == 0.0:
                raise ValueError("x_dir and y_dir must not be parallel")
            z_dir = z_from_xy.normalized()
            y_dir = z_dir.cross(x_dir).normalized()
            x_dir = y_dir.cross(z_dir).normalized()
        else:
            if z_dir.length == 0.0:
                raise ValueError("z_dir must be non null")
            z_dir = z_dir.normalized()
            if x_dir is None:
                x_dir = Vector._of(_ax3(origin._xyz, _gp_dir(z_dir._xyz))[1]).normalized()
            else:
                if Vector(x_dir).length == 0.0:
                    raise ValueError("x_dir must be non null")
                x_dir = Vector(x_dir).normalized()
        self._set_frame(_ax3(origin._xyz, _gp_dir(z_dir._xyz), _gp_dir(x_dir._xyz)))

    def _set_frame(self, frame):
        self._origin, self._x, self._y, self._z = frame

    @classmethod
    def _of(cls, frame):
        plane = object.__new__(cls)
        plane._set_frame(frame)
        return plane

    def _wonky_rigid(self):
        """(3x3 rotation rows, offset in mm) of plane.location, which Plane * shape applies."""
        trsf = self.location._trsf()
        return trsf.m, trsf.t

    origin = property(lambda self: Vector._of(self._origin), doc="global position of local (0,0,0) point")
    x_dir = property(lambda self: Vector._of(self._x), doc="Local X direction of the plane.")
    y_dir = property(lambda self: Vector._of(self._y), doc="Local Y direction of the plane.")
    z_dir = property(lambda self: Vector._of(self._z), doc="Local Z direction normal to the plane.")

    @property
    def location(self):
        return Location(self)

    def offset(self, amount):
        return Plane(origin=self.origin + self.z_dir * amount, x_dir=self.x_dir, z_dir=self.z_dir)

    def moved(self, loc):
        if isinstance(loc, Plane):
            loc = loc.location
        return Plane(self.location * loc)

    def move(self, loc):
        self._set_frame(self.moved(loc)._frame())
        return self

    def rotated(self, rotation=(0, 0, 0), ordering=None):
        """Plane.rotated: the axes turned about the origin (gp_Ax2::Transformed; z = x' cross y')."""
        trsf = _euler_trsf(list(Vector(rotation)), ordering)
        x, y = _dir_transform(trsf, self._x), _dir_transform(trsf, self._y)
        return Plane._of((self._origin, x, y, _dir_cross(x, y)))

    def _frame(self):
        return self._origin, self._x, self._y, self._z

    def reverse(self):
        return -self

    def __neg__(self):
        return Plane(self.origin, self.x_dir, -self.z_dir)

    def __copy__(self):
        return Plane._of(self._frame())

    def __deepcopy__(self, _memo):
        return Plane._of(self._frame())

    def __eq__(self, other):
        if not isinstance(other, Plane):
            return NotImplemented
        return self._key() == other._key()

    def __hash__(self):
        return hash(self._key())

    def _key(self):
        return _key_digits(self._origin), _key_digits(self._x), _key_digits(self._z)

    def __mul__(self, other):
        if isinstance(other, Location):
            return Location(self) * other
        if isinstance(other, Plane):
            return Location(self) * other.location
        if isinstance(other, _core.Shape) or callable(getattr(other, "moved", None)):
            # A shape or profile: its __rmul__ moves it. build123d first lists the operand (list(other)):
            # Compound()/Part()/Sketch() assert on their missing wrapped shape, Compound([]) lists as [].
            empty = getattr(type(other), "_wonky_empty_kind", None)
            kind = empty(other) if empty is not None else None
            if kind == "null":
                raise AssertionError
            if kind == "empty":
                return []
            return NotImplemented
        try:
            others = list(other)
            if all(isinstance(item, (Location, Plane)) for item in others):
                return [Location(self) * (item.location if isinstance(item, Plane) else item) for item in others]
        except TypeError:
            pass
        return NotImplemented

    def __rmul__(self, other):
        return apply_location_like(self, other)

    def __and__(self, other):
        return _unsupported("Plane & ... (intersect) is not implemented by the Python frontend")

    def __format__(self, spec):
        last = spec[-1] if spec else None
        if last in ("f", "g"):
            return f"({self.origin:{spec}}, {self.x_dir:{spec}}, {self.z_dir:{spec}})"
        return f"({tuple(self.origin)}, {tuple(self.x_dir)}, {tuple(self.z_dir)})"

    def __repr__(self):
        return f"{type(self).__name__}{self:.{TOL_DIGITS}g}"

    def __str__(self):
        return (f"{type(self).__name__}: (origin={self.origin:.{TOL_DIGITS}g}, "
                f"x_dir={self.x_dir:.{TOL_DIGITS}g}, z_dir={self.z_dir:.{TOL_DIGITS}g})")

    def __getattr__(self, name):
        return _missing(self, name)


# ---------------------------------------------------------------------------
# Axis (gp_Ax1)

class _AxisMeta(_GeometryMeta):
    X = property(lambda cls: cls((0, 0, 0), (1, 0, 0)), doc="X Axis")
    Y = property(lambda cls: cls((0, 0, 0), (0, 1, 0)), doc="Y Axis")
    Z = property(lambda cls: cls((0, 0, 0), (0, 0, 1)), doc="Z Axis")


class Axis(metaclass=_AxisMeta):
    """build123d.Axis: a point and a unit direction."""

    __slots__ = ("_position", "_direction")
    build123d_type = "Axis"
    _dim = 1
    _wonky_public = frozenset({"angle_between", "build123d_type", "direction", "intersect", "is_coaxial",
                               "is_normal", "is_opposite", "is_parallel", "is_skew", "located", "location",
                               "position", "reverse", "wrapped"})

    def __init__(self, *args, **kwargs):
        if kwargs.pop("gp_ax1", None) is not None:
            _unsupported("Axis(gp_ax1=...) takes an OpenCascade (OCP) object, and external geometry is disabled")
        origin = kwargs.pop("origin", None)
        direction = kwargs.pop("direction", None)
        end_point = kwargs.pop("end_point", None)
        edge = kwargs.pop("edge", None)
        location = kwargs.pop("location", None)
        if kwargs:
            raise ValueError(f"Unexpected argument(s): {', '.join(kwargs.keys())}")
        if len(args) == 1:
            arg = args[0]
            if isinstance(arg, Location):
                location = arg
            elif _is_shape_like(arg):
                edge = arg
            elif isinstance(arg, (Vector, tuple)):
                origin = arg
            else:
                raise ValueError(f"Unrecognized single argument: {arg}")
        elif len(args) == 2:
            origin, direction = args
        if end_point is not None:
            if direction is not None:
                raise ValueError("Axis end_point cannot be used with direction")
            direction = Vector(end_point) - Vector(origin)
        if edge is not None:
            _unsupported("Axis(edge) is not implemented by the Python frontend: it needs the edge's curve")
            return
        if location is not None:
            placed = Axis.Z.located(location)
            self._position, self._direction = placed._position, placed._direction
            return
        try:
            position = Vector(origin)._xyz
            self._direction = _gp_dir(Vector(direction).normalized()._xyz)
        except Exception as exc:
            raise ValueError("Invalid Axis parameters") from exc
        self._position = position

    @classmethod
    def _of(cls, position, direction):
        axis = object.__new__(cls)
        axis._position, axis._direction = tuple(position), tuple(direction)
        return axis

    @property
    def position(self):
        return Vector._of(self._position)

    @position.setter
    def position(self, position):
        self._position = Vector(position)._xyz

    @property
    def direction(self):
        return Vector._of(self._direction)

    @direction.setter
    def direction(self, direction):
        self._direction = _gp_dir(Vector(direction)._xyz)

    @property
    def location(self):
        return Location(Plane(origin=self.position, z_dir=self.direction))

    def located(self, new_location):
        trsf = new_location._trsf()
        return Axis._of(_pnt_transform(trsf, self._position), _dir_transform(trsf, self._direction))

    def reverse(self):
        return Axis._of(self._position, _neg(self._direction))

    def __neg__(self):
        return self.reverse()

    def __copy__(self):
        return Axis(self.position, self.direction)

    def __deepcopy__(self, _memo):
        return Axis(self.position, self.direction)

    def __hash__(self):
        return hash(self._key())

    def __eq__(self, other):
        if not isinstance(other, Axis):
            return NotImplemented
        return self._key() == other._key()

    def _key(self):
        return _key_digits(self._position), _key_digits(self._direction)

    def __and__(self, other):
        return _unsupported("Axis & ... (intersect) is not implemented by the Python frontend")

    def __format__(self, spec):
        last = spec[-1] if spec else None
        if last in ("f", "g"):
            return f"({self.position:{spec}}, {self.direction:{spec}})"
        return f"({tuple(self.position)}, {tuple(self.direction)})"

    def __repr__(self):
        return f"{type(self).__name__}{self:.{TOL_DIGITS}g}"

    def __str__(self):
        return (f"{type(self).__name__}: (position={self.position:.{TOL_DIGITS}g}, "
                f"direction={self.direction:.{TOL_DIGITS}g})")

    def __getattr__(self, name):
        return _missing(self, name)


# ---------------------------------------------------------------------------
# Placing shapes

def _is_identity_matrix(m):
    return m == _IDENTITY_MATRIX


# A placed shape is its unplaced B-rep (the TShape) at a TopLoc_Location chain,
# as in OCCT: handle -> (base handle, chain). Moving composes the chains and
# builds the base at the composed transformation, once. The same base at an
# equal chain (same datums and powers) is the same shape (is_same), so it gets
# the same handle; the cache keeps the datums alive, so their ids stay unique.
_PLACED = {}
_PLACEMENTS = {}


def _chain_key(base, nodes):
    return base, tuple((id(datum), power) for datum, power, _ in nodes)


def _shape_moved(self, loc):
    """Shape.moved: a copy of the B-rep at ``loc`` relative to its current place, built now in Bend."""
    if isinstance(loc, Plane):
        loc = loc.location
    if not isinstance(loc, Location):
        raise AttributeError(f"{type(loc).__name__!r} object has no attribute 'wrapped'")
    base, chain = _PLACED.get(self._handle, (self._handle, ()))
    nodes = _chain_multiplied(loc._nodes, chain)
    if not nodes:
        # An empty TopLoc_Location (e.g. p * p.inverse()): the unplaced shape itself (is_same).
        return _like(self, base)
    key = _chain_key(base, nodes)
    cached = _PLACEMENTS.get(key)
    if cached is not None:
        return _like(self, cached[0])
    trsf = nodes[-1][2]
    if _is_identity_matrix(trsf.m):
        handle = _request("translate", handle=base, offset=list(trsf.t))
    else:
        handle = _request("transform", handle=base, rows=[list(row) for row in trsf.m], offset=list(trsf.t))
    _PLACEMENTS[key] = (handle, nodes)
    _PLACED[handle] = (base, nodes)
    return _like(self, handle)


def _like(shape, handle):
    """A shape of the same class on another handle (build123d's moved() keeps the class: Box stays a Box)."""
    moved = object.__new__(type(shape))
    object.__setattr__(moved, "_handle", handle)
    return moved


def apply_location_like(obj, other):
    """build123d's apply_location_like: ``location * obj`` or one placed copy per item of an iterable."""
    if isinstance(other, (Location, Plane)):
        return obj.moved(other)
    try:
        items = list(other)
    except TypeError:
        items = None
    if items is not None:
        wrong = {type(item) for item in items if not isinstance(item, (Location, Plane))}
        if wrong:
            raise TypeError(f"{type(obj).__name__} cannot be multiplied by "
                            f"{', '.join(sorted(t.__name__ for t in wrong))}")
        return [obj.moved(item) for item in items]
    raise TypeError(f"{type(obj).__name__} cannot be multiplied by {type(other).__name__}")


_core.register_shape_method("moved", _shape_moved)
_core._HOOKS["apply_location_like"] = apply_location_like


BUILD123D = {
    "Vector": Vector,
    "Location": Location,
    "Rotation": Rotation,
    "Rot": Rot,
    "Pos": Pos,
    "Plane": Plane,
    "Axis": Axis,
}
