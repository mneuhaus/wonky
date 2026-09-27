import Base
import ../real.bend as R
import ../precise.bend as G
import ../robust-predicates.bend as X

# Exact arithmetic for the fillet's boundary decisions (docs/fillet-plan.md
# §8 step 3). Every input word of a job is an F32x2 value, i.e. a dyadic
# rational; so is every sum and product of them. A decision near a boundary
# (r = w, r = rho, a tangent edge, the modelling tolerance) is the sign of an
# expression in those words with at most a few square roots of squared norms
# (|n| for a normal word that is not a unit vector). This module evaluates
# such signs exactly:
#   D   a dyadic rational m * 2^-sh (m a robust-predicates Big integer);
#   Q   an element of Q(sqrt p1, ..., sqrt pk) as a binary tree: the root
#       holds u + v * sqrt(p1) with u, v in Q(sqrt p2, ..., sqrt pk), and a
#       leaf is a D. The radicands (p1, ..., pk) are passed alongside;
#   sign(u + v sqrt p) from sign(u), sign(v) and sign(u^2 - v^2 p) (p >= 0),
#       recursively; no rounding anywhere.
# The filter in front of it (kernel/fillet/decide.bend) only calls this when
# the F32x2 value lies within its rounding allowance.

# ---------------------------------------------------------------------------
# Dyadic rationals

type D is Data:
  D{m: X.Big, sh: U32}

def d_zero() -> D:
  D{X.zero(), 0}

# An F32x2 word pair: both words are integers times 2^-149.
def d_real(+r: R.Real) -> D:
  D{X.from_real(r), 149}

def d_f32(+x: F32) -> D:
  d_real(R.from_f32(x))

def d_shl(+a: X.Big, +bits: U32) -> X.Big:
  X.Big{neg, digits} = a
  X.make(neg, X.shift(digits, bits))

def d_add.al(+ge: Bool, +am: X.Big, +ash: U32, +bm: X.Big, +bsh: U32) -> D:
  match ge:
    case True{}:
      D{X.add(am, d_shl(bm, (ash - bsh : U32))), ash}
    case False{}:
      D{X.add(d_shl(am, (bsh - ash : U32)), bm), bsh}

def d_add(+a: D, +b: D) -> D:
  D{am, +ash} = a
  D{bm, +bsh} = b
  d_add.al(U32.is_le(bsh, ash), am, ash, bm, bsh)

def d_neg(+a: D) -> D:
  D{m, sh} = a
  D{X.neg(m), sh}

def d_sub(+a: D, +b: D) -> D:
  d_add(a, d_neg(b))

def d_mul(+a: D, +b: D) -> D:
  D{am, ash} = a
  D{bm, bsh} = b
  D{X.mul(am, bm), (ash + bsh : U32)}

def d_sign(+a: D) -> X.Sign:
  D{m, _} = a
  X.sign(m)

# ---------------------------------------------------------------------------
# Signs

def s_zero(+s: X.Sign) -> Bool:
  match s:
    case X.ExactlyZero{}:
      True{}
    case _:
      False{}

def s_pos(+s: X.Sign) -> Bool:
  match s:
    case X.Positive{}:
      True{}
    case _:
      False{}

def s_neg(+s: X.Sign) -> Bool:
  match s:
    case X.Negative{}:
      True{}
    case _:
      False{}

def s_undef(+s: X.Sign) -> Bool:
  match s:
    case X.Undefined{}:
      True{}
    case _:
      False{}

def s_flip(+s: X.Sign) -> X.Sign:
  match s:
    case X.Negative{}:
      X.Positive{}
    case X.Positive{}:
      X.Negative{}
    case X.ExactlyZero{}:
      X.ExactlyZero{}
    case X.Undefined{}:
      X.Undefined{}

def s_same(+a: X.Sign, +b: X.Sign) -> Bool:
  Bool.or(Bool.and(s_pos(a), s_pos(b)), Bool.and(s_neg(a), s_neg(b)))

# sign(u + v sqrt p) given su, sv, sp = sign(p) (p >= 0) and st = sign(u^2 - v^2 p).
def s_combine(+su: X.Sign, +sv: X.Sign, +sp: X.Sign, +st: X.Sign) -> X.Sign:
  +bad = Bool.or(Bool.or(s_undef(su), s_undef(sv)), Bool.or(Bool.or(s_undef(sp), s_neg(sp)), s_undef(st)))
  +vgone = Bool.or(s_zero(sv), s_zero(sp))
  +mixed = Bool.pick(X.Sign, s_pos(st), su, Bool.pick(X.Sign, s_neg(st), sv, X.ExactlyZero{}))
  +agree = Bool.pick(X.Sign, Bool.or(s_same(su, sv), s_zero(sv)), su, Bool.pick(X.Sign, s_zero(su), sv, mixed))
  Bool.pick(X.Sign, bad, X.Undefined{}, Bool.pick(X.Sign, vgone, su, agree))

# ---------------------------------------------------------------------------
# Q(sqrt p1, ..., sqrt pk)

type Q is Data:
  QL{d: D}
  QN{u: Q, v: Q}

def q_d(+d: D) -> Q:
  QL{d}

def q_real(+r: R.Real) -> Q:
  QL{d_real(r)}

def q_zero() -> Q:
  QL{d_zero()}

def q_add(+a: Q, +b: Q) -> Q:
  match a b:
    case QL{x} QL{y}:
      QL{d_add(x, y)}
    case QL{x} QN{u, v}:
      QN{q_add(QL{x}, u), v}
    case QN{u, v} QL{y}:
      QN{q_add(u, QL{y}), v}
    case QN{u1, v1} QN{u2, v2}:
      QN{q_add(u1, u2), q_add(v1, v2)}

def q_neg(+a: Q) -> Q:
  match a:
    case QL{x}:
      QL{d_neg(x)}
    case QN{u, v}:
      QN{q_neg(u), q_neg(v)}

def q_sub(+a: Q, +b: Q) -> Q:
  q_add(a, q_neg(b))

def q_scale(+a: Q, +s: D) -> Q:
  match a:
    case QL{x}:
      QL{d_mul(x, s)}
    case QN{u, v}:
      QN{q_scale(u, s), q_scale(v, s)}

# The product; ps are the radicands from the root level down.
def q_mul(+ps: List<&2, D>, +a: Q, +b: Q) -> Q:
  match ps:
    case Nil{}:
      match a b:
        case QL{x} QL{y}:
          QL{d_mul(x, y)}
        case _ _:
          q_zero()
    case +p <> +rest:
      match a b:
        case QL{x} QL{y}:
          QL{d_mul(x, y)}
        case QL{+x} QN{u, v}:
          QN{q_mul(rest, QL{x}, u), q_mul(rest, QL{x}, v)}
        case QN{u, v} QL{+y}:
          QN{q_mul(rest, u, QL{y}), q_mul(rest, v, QL{y})}
        case QN{+u1, +v1} QN{+u2, +v2}:
          QN{q_add(q_mul(rest, u1, u2), q_scale(q_mul(rest, v1, v2), p)), q_add(q_mul(rest, u1, v2), q_mul(rest, v1, u2))}

# The exact sign; Undefined for a malformed tree or a negative radicand.
def q_sign(+ps: List<&2, D>, +a: Q) -> X.Sign:
  match ps:
    case Nil{}:
      match a:
        case QL{x}:
          d_sign(x)
        case QN{_, _}:
          X.Undefined{}
    case +p <> +rest:
      match a:
        case QL{x}:
          d_sign(x)
        case QN{+u, +v}:
          +t = q_sub(q_mul(rest, u, u), q_scale(q_mul(rest, v, v), p))
          s_combine(q_sign(rest, u), q_sign(rest, v), d_sign(p), q_sign(rest, t))

# sqrt(p_i) as an element (level i, 0 = root) of a field with k radicands.
def q_root(+i: Nat) -> Q:
  match i:
    case 0n:
      QN{q_zero(), QL{d_f32(1.0)}}
    case 1n+j:
      QN{q_root(j), q_zero()}

# ---------------------------------------------------------------------------
# Vectors of dyadics (input words)

type DV is Data:
  DV{x: D, y: D, z: D}

def dv(+v: G.Vec3) -> DV:
  G.V3{x, y, z} = v
  DV{d_real(x), d_real(y), d_real(z)}

def dv_sub(+a: DV, +b: DV) -> DV:
  DV{ax, ay, az} = a
  DV{bx, by, bz} = b
  DV{d_sub(ax, bx), d_sub(ay, by), d_sub(az, bz)}

def dv_dot(+a: DV, +b: DV) -> D:
  DV{ax, ay, az} = a
  DV{bx, by, bz} = b
  d_add(d_mul(ax, bx), d_add(d_mul(ay, by), d_mul(az, bz)))

def dv_cross(+a: DV, +b: DV) -> DV:
  DV{+ax, +ay, +az} = a
  DV{+bx, +by, +bz} = b
  DV{d_sub(d_mul(ay, bz), d_mul(az, by)), d_sub(d_mul(az, bx), d_mul(ax, bz)), d_sub(d_mul(ax, by), d_mul(ay, bx))}

def dv_norm2(+a: DV) -> D:
  dv_dot(a, a)

# det(a, b, c) = a . (b x c)
def dv_det(+a: DV, +b: DV, +c: DV) -> D:
  dv_dot(a, dv_cross(b, c))

def dv_is_zero(+a: DV) -> Bool:
  DV{x, y, z} = a
  Bool.and(s_zero(d_sign(x)), Bool.and(s_zero(d_sign(y)), s_zero(d_sign(z))))

def dv_scale(+a: DV, +s: D) -> DV:
  DV{ax, ay, az} = a
  DV{d_mul(ax, s), d_mul(ay, s), d_mul(az, s)}

# Is |a|^2 exactly 1 (a unit word vector)?
def dv_unit(+a: DV) -> Bool:
  s_zero(d_sign(d_sub(dv_norm2(a), d_f32(1.0))))
