import Base

# A normalized pair of F32 words, approximately 48 significand bits.
# No host floating-point operations participate in arithmetic on these values.
type Real is Data:
  Real{hi: F32, lo: F32}

def from_f32(hi: F32) -> Real:
  Real{hi, 0.0}

def approx(value: Real) -> F32:
  Real{hi, lo} = value
  (hi + lo : F32)

def renorm(+hi: F32, +lo: F32) -> Real:
  +sum = (hi + lo : F32)
  Real{sum, (lo - (sum - hi) : F32)}

def neg(value: Real) -> Real:
  Real{hi, lo} = value
  Real{F32.neg(hi), F32.neg(lo)}

def add(a: Real, b: Real) -> Real:
  Real{+ah, al} = a
  Real{+bh, bl} = b
  +sum = (ah + bh : F32)
  +v = (sum - ah : F32)
  error = ((ah - (sum - v)) + (bh - v) + al + bl : F32)
  renorm(sum, error)

def sub(a: Real, b: Real) -> Real:
  add(a, neg(b))

def mul(a: Real, b: Real) -> Real:
  Real{+ah, +al} = a
  Real{+bh, +bl} = b
  +ac = (4097.0 * ah : F32)
  +bc = (4097.0 * bh : F32)
  +a1 = (ac - (ac - ah) : F32)
  +b1 = (bc - (bc - bh) : F32)
  +a2 = (ah - a1 : F32)
  +b2 = (bh - b1 : F32)
  +p = (ah * bh : F32)
  error = (((a1 * b1 - p) + a1 * b2 + a2 * b1) + a2 * b2 : F32)
  renorm(p, (error + ah * bl + al * bh + al * bl : F32))

def div(+a: Real, +b: Real) -> Real:
  +q = (approx(a) / approx(b) : F32)
  r = sub(a, mul(b, from_f32(q)))
  renorm(q, (approx(r) / approx(b) : F32))

def less(a: Real, b: Real) -> Bool:
  Real{+ah, al} = a
  Real{+bh, bl} = b
  Bool.or((ah < bh : F32), Bool.and(F32.is_eq(ah, bh), (al < bl : F32)))

def equal(a: Real, b: Real) -> Bool:
  Real{ah, al} = a
  Real{bh, bl} = b
  Bool.and(F32.is_eq(ah, bh), F32.is_eq(al, bl))

def abs(+a: Real) -> Real:
  Bool.pick(Real, less(a, from_f32(0.0)), neg(a), a)

def max(+a: Real, +b: Real) -> Real:
  Bool.pick(Real, less(a, b), b, a)

def min(+a: Real, +b: Real) -> Real:
  Bool.pick(Real, less(a, b), a, b)

def sqrt_nonzero(+a: Real) -> Real:
  +s = F32.sqrt(approx(a))
  r = sub(a, mul(from_f32(s), from_f32(s)))
  renorm(s, (approx(r) / (2.0 * s) : F32))

def sqrt_pick(zero: Bool, a: Real) -> Real:
  match zero:
    case True{}:
      from_f32(0.0)
    case False{}:
      sqrt_nonzero(a)

def sqrt(+a: Real) -> Real:
  sqrt_pick(equal(a, from_f32(0.0)), a)

def pi() -> Real:
  Real{3.1415927410125732, F32.neg(0.000000087422780003724851)}

def atan_series(left: Nat, +x2: Real, +term: Real, +denom: F32) -> Real:
  match left:
    case 0n:
      from_f32(0.0)
    case 1n+p:
      add(div(term, from_f32(denom)), atan_series(p, x2, neg(mul(term, x2)), (denom + 2.0 : F32)))

def atan_small(+x: Real) -> Real:
  atan_series(20n, mul(x, x), x, 1.0)

def atan_unit_pick(reduce: Bool, +x: Real) -> Real:
  match reduce:
    case False{}:
      atan_small(x)
    case True{}:
      add(div(pi(), from_f32(4.0)), atan_small(div(sub(x, from_f32(1.0)), add(x, from_f32(1.0)))))

def atan_unit(+x: Real) -> Real:
  atan_unit_pick(less(from_f32(0.41421356), x), x)

def atan_positive_pick(invert: Bool, x: Real) -> Real:
  match invert:
    case False{}:
      atan_unit(x)
    case True{}:
      sub(div(pi(), from_f32(2.0)), atan_unit(div(from_f32(1.0), x)))

def atan(+x: Real) -> Real:
  +magnitude = abs(x)
  +angle = atan_positive_pick(less(from_f32(1.0), magnitude), magnitude)
  Bool.pick(Real, less(x, from_f32(0.0)), neg(angle), angle)

def atan2_nonvertical(+y: Real, +x: Real) -> Real:
  angle = atan(div(y, x))
  correction = Bool.pick(Real, less(x, from_f32(0.0)), Bool.pick(Real, less(y, from_f32(0.0)), neg(pi()), pi()), from_f32(0.0))
  add(angle, correction)

def atan2_pick(vertical: Bool, +y: Real, x: Real) -> Real:
  match vertical:
    case True{}:
      +half = div(pi(), from_f32(2.0))
      Bool.pick(Real, equal(y, from_f32(0.0)), from_f32(0.0), Bool.pick(Real, less(y, from_f32(0.0)), neg(half), half))
    case False{}:
      atan2_nonvertical(y, x)

def atan2(y: Real, +x: Real) -> Real:
  atan2_pick(equal(x, from_f32(0.0)), y, x)

def reduce_angle(+x: Real) -> Real:
  +tau = mul(pi(), from_f32(2.0))
  turns = F32.floor((approx(x) / approx(tau) + 0.5 : F32))
  sub(x, mul(tau, from_f32(turns)))

def trig_series(left: Nat, +x2: Real, +term: Real, +n: F32) -> Real:
  match left:
    case 0n:
      from_f32(0.0)
    case 1n+p:
      add(term, trig_series(p, x2, neg(div(mul(term, x2), from_f32(((n + 1.0) * (n + 2.0) : F32)))), (n + 2.0 : F32)))

def sin(x: Real) -> Real:
  +r = reduce_angle(x)
  trig_series(18n, mul(r, r), r, 1.0)

def cos(x: Real) -> Real:
  +r = reduce_angle(x)
  trig_series(18n, mul(r, r), from_f32(1.0), 0.0)
