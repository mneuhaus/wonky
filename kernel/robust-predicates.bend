import Base
import ./real.bend as R
import ./precise.bend as G

# Reference-guided implementation of filtered exact decisions and implicit
# constructions (Shewchuk 1997; Attene 2020, sections 2 and 4). This is original
# Bend code, not a translation of either author's C/C++ implementation.
# Exact fallback uses signed base-4096 integers, not floating expansions.
# Every finite F32 word equals an integer times 2^-149. Thus polynomial signs
# can be evaluated without underflow/overflow, including subnormal inputs.
# A sign concerns the represented source geometry, not a tolerance policy.
type Sign is Data:
  Negative{}
  ExactlyZero{}
  Positive{}
  Undefined{}

type Method is Data:
  FloatFilter{}
  ExactDyadic{}
  IndirectExact{}
  Invalid{}

type Decision is Data:
  Decision{sign: Sign, method: Method}

type Point is Data:
  Explicit{point: G.Vec3}
  LinePlane{first: G.Vec3, last: G.Vec3, origin: G.Vec3, normal: G.Vec3}

type Big is Data:
  Big{negative: Bool, digits: List<&2, U32>}

type Term is Data:
  Term{a: F32, b: F32}

type Estimate is Data:
  Estimate{safe: Bool, value: F32, absolute_sum: F32}

def zero() -> Big:
  Big{False{}, Nil{}}

def empty(digits: List<&2, U32>) -> Bool:
  match digits:
    case Nil{}:
      True{}
    case _:
      False{}

def digit(+head: U32, +tail: List<&2, U32>) -> List<&2, U32>:
  Bool.pick(List<&2, U32>, Bool.and(U32.is_eq(head, 0), empty(tail)), Nil{}, head <> tail)

def make(negative: Bool, +digits: List<&2, U32>) -> Big:
  Big{Bool.and(negative, Bool.not(empty(digits))), digits}

def mag_add(a: List<&2, U32>, b: List<&2, U32>, carry: U32) -> List<&2, U32>:
  match a b:
    case Nil{} Nil{}:
      digit(carry, Nil{})
    case ah <> at Nil{}:
      +sum = (ah + carry : U32)
      digit(U32.and(sum, 4095), mag_add(at, Nil{}, U32.shrn(sum, 12n)))
    case Nil{} bh <> bt:
      +sum = (bh + carry : U32)
      digit(U32.and(sum, 4095), mag_add(Nil{}, bt, U32.shrn(sum, 12n)))
    case ah <> at bh <> bt:
      +sum = (ah + bh + carry : U32)
      digit(U32.and(sum, 4095), mag_add(at, bt, U32.shrn(sum, 12n)))

def mag_cmp_finish(high: Cmp, a: U32, b: U32) -> Cmp:
  match high:
    case EQ{}:
      U32.cmp(a, b)
    case _:
      high

def mag_cmp(a: List<&2, U32>, b: List<&2, U32>) -> Cmp:
  match a b:
    case Nil{} Nil{}:
      EQ{}
    case Nil{} _ <> _:
      LT{}
    case _ <> _ Nil{}:
      GT{}
    case ah <> at bh <> bt:
      mag_cmp_finish(mag_cmp(at, bt), ah, bh)

# Precondition a >= b. Each temporary is <= 8191 and never underflows U32.
def mag_sub(a: List<&2, U32>, b: List<&2, U32>, borrow: U32) -> List<&2, U32>:
  match a b:
    case Nil{} _:
      Nil{}
    case ah <> at Nil{}:
      +d = (ah + 4096 - borrow : U32)
      digit(U32.and(d, 4095), mag_sub(at, Nil{}, Bool.pick(U32, U32.is_lt(d, 4096), 1, 0)))
    case ah <> at bh <> bt:
      +d = (ah + 4096 - bh - borrow : U32)
      digit(U32.and(d, 4095), mag_sub(at, bt, Bool.pick(U32, U32.is_lt(d, 4096), 1, 0)))

def add_opposite(order: Cmp, an: Bool, ad: List<&2, U32>, bn: Bool, bd: List<&2, U32>) -> Big:
  match order:
    case EQ{}:
      zero()
    case GT{}:
      make(an, mag_sub(ad, bd, 0))
    case LT{}:
      make(bn, mag_sub(bd, ad, 0))

def add_choice(same: Bool, an: Bool, +ad: List<&2, U32>, bn: Bool, +bd: List<&2, U32>) -> Big:
  match same:
    case True{}:
      make(an, mag_add(ad, bd, 0))
    case False{}:
      add_opposite(mag_cmp(ad, bd), an, ad, bn, bd)

def add(a: Big, b: Big) -> Big:
  Big{+an, ad} = a
  Big{+bn, bd} = b
  add_choice(Bool.not(Bool.xor(an, bn)), an, ad, bn, bd)

def neg(a: Big) -> Big:
  Big{negative, digits} = a
  make(Bool.not(negative), digits)

def sub(a: Big, b: Big) -> Big:
  add(a, neg(b))

# A digit product plus carry is < 2^24; no U32 multiplication overflows.
def mag_scale(a: List<&2, U32>, +b: U32, carry: U32) -> List<&2, U32>:
  match a:
    case Nil{}:
      digit(carry, Nil{})
    case head <> tail:
      +p = (head * b + carry : U32)
      digit(U32.and(p, 4095), mag_scale(tail, b, U32.shrn(p, 12n)))

def mag_mul(a: List<&2, U32>, +b: List<&2, U32>) -> List<&2, U32>:
  match a:
    case Nil{}:
      Nil{}
    case head <> tail:
      mag_add(mag_scale(b, head, 0), digit(0, mag_mul(tail, b)), 0)

def mul(a: Big, b: Big) -> Big:
  Big{an, ad} = a
  Big{bn, bd} = b
  make(Bool.xor(an, bn), mag_mul(ad, bd))

def pad(count: Nat, digits: List<&2, U32>) -> List<&2, U32>:
  match count:
    case 0n:
      digits
    case 1n+tail:
      digit(0, pad(tail, digits))

def shift(digits: List<&2, U32>, +bits: U32) -> List<&2, U32>:
  pad(U32.to_nat(U32.div(bits, 12)), mag_scale(digits, U32.shln(1, U32.to_nat(U32.mod(bits, 12))), 0))

def exponent(word: F32) -> U32:
  U32.and(U32.shrn(F32.bits(word), 23n), 255)

def finite(word: F32) -> Bool:
  U32.is_lt(exponent(word), 255)

def from_word(+word: F32) -> Big:
  +bits = F32.bits(word)
  +e = exponent(word)
  m = U32.or(U32.and(bits, 8388607), Bool.pick(U32, U32.is_eq(e, 0), 0, 8388608))
  +mantissa = m
  make(U32.is_ne(U32.and(bits, 2147483648), 0),
    shift(digit(U32.and(mantissa, 4095), digit(U32.shrn(mantissa, 12n), Nil{})), (U32.max(e, 1) - 1 : U32)))

def from_real(a: R.Real) -> Big:
  R.Real{hi, lo} = a
  add(from_word(hi), from_word(lo))

def real_valid(a: R.Real) -> Bool:
  R.Real{hi, lo} = a
  Bool.and(finite(hi), finite(lo))

def vec_valid(a: G.Vec3) -> Bool:
  G.V3{x, y, z} = a
  Bool.and(real_valid(x), Bool.and(real_valid(y), real_valid(z)))

def dot(+a: G.Vec3, b: G.Vec3) -> Big:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  add(mul(from_real(ax), from_real(bx)), add(mul(from_real(ay), from_real(by)), mul(from_real(az), from_real(bz))))

def dot_delta(+normal: G.Vec3, a: G.Vec3, b: G.Vec3) -> Big:
  sub(dot(normal, a), dot(normal, b))

def sign(a: Big) -> Sign:
  Big{negative, digits} = a
  Bool.pick(Sign, empty(digits), ExactlyZero{}, Bool.pick(Sign, negative, Negative{}, Positive{}))

def terms(a: R.Real, b: R.Real) -> List<&2, Term>:
  R.Real{+ah, +al} = a
  R.Real{+bh, +bl} = b
  [Term{ah, bh}, Term{ah, bl}, Term{al, bh}, Term{al, bl}]

def dot_terms(a: G.Vec3, b: G.Vec3) -> List<&2, Term>:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  List.append(&2, Term, terms(ax, bx), List.append(&2, Term, terms(ay, by), terms(az, bz)))

def negative_terms(values: List<&2, Term>) -> List<&2, Term>:
  match values:
    case Nil{}:
      Nil{}
    case Term{a, b} <> tail:
      Term{a, F32.neg(b)} <> negative_terms(tail)

def filter_word(+a: F32) -> Bool:
  +e = exponent(a)
  Bool.or(F32.is_eq(a, 0.0), Bool.and(U32.is_le(87, e), U32.is_le(e, 167)))

def estimate_add(+a: F32, +b: F32, rest: Estimate) -> Estimate:
  Estimate{safe, value, absolute_sum} = rest
  +p = (a * b : F32)
  Estimate{Bool.and(filter_word(a), Bool.and(filter_word(b), safe)), (value + p : F32), (absolute_sum + F32.abs(p) : F32)}

def estimate(values: List<&2, Term>) -> Estimate:
  match values:
    case Nil{}:
      Estimate{True{}, 0.0, 0.0}
    case Term{a, b} <> tail:
      estimate_add(a, b, estimate(tail))

def exact_decision(normal: G.Vec3, a: G.Vec3, b: G.Vec3) -> Decision:
  Decision{sign(dot_delta(normal, a, b)), ExactDyadic{}}

def filtered_choice(certified: Bool, value: F32, normal: G.Vec3, a: G.Vec3, b: G.Vec3) -> Decision:
  match certified:
    case True{}:
      Decision{Bool.pick(Sign, (value < 0.0 : F32), Negative{}, Positive{}), FloatFilter{}}
    case False{}:
      exact_decision(normal, a, b)

# 24 products and <= 23 nontrivial additions. In the admitted exponent range
# neither product nor summation can underflow/overflow. 2^-16 times the rounded
# absolute sum is a conservative bound (> 10x gamma_24 with u=2^-24), including
# rounding in the absolute sum and the bound. Cancellation falls back exactly.
def filtered(result: Estimate, normal: G.Vec3, a: G.Vec3, b: G.Vec3) -> Decision:
  Estimate{safe, +value, absolute_sum} = result
  certified = Bool.and(safe, (F32.abs(value) > (absolute_sum * 0.0000152587890625) : F32))
  filtered_choice(certified, value, normal, a, b)

def point_plane_valid(valid: Bool, +normal: G.Vec3, +a: G.Vec3, +b: G.Vec3) -> Decision:
  match valid:
    case False{}:
      Decision{Undefined{}, Invalid{}}
    case True{}:
      filtered(estimate(List.append(&2, Term, dot_terms(normal, a), negative_terms(dot_terms(normal, b)))), normal, a, b)

def point_plane(+normal: G.Vec3, +point: G.Vec3, +origin: G.Vec3) -> Decision:
  point_plane_valid(Bool.and(vec_valid(normal), Bool.and(vec_valid(point), vec_valid(origin))), normal, point, origin)

def divide_sign(+numerator: Big, denominator: Big) -> Sign:
  Big{negative, +digits} = denominator
  Bool.pick(Sign, empty(digits), Undefined{}, sign(Bool.pick(Big, negative, neg(numerator), numerator)))

# If alpha = cut(a), beta = cut(b), gamma = test(a), delta = test(b),
# test(a + alpha/(alpha-beta)*(b-a)) = (alpha*delta-beta*gamma)/(alpha-beta).
# Evaluate the sign of this expression from source words without materializing
# or rounding the intersection point. A zero denominator is undefined.
def indirect_values(+alpha: Big, +beta: Big, gamma: Big, delta: Big) -> Decision:
  Decision{divide_sign(sub(mul(alpha, delta), mul(beta, gamma)), sub(alpha, beta)), IndirectExact{}}

def indirect_valid(valid: Bool, +a: G.Vec3, +b: G.Vec3, +cut_origin: G.Vec3, +cut_normal: G.Vec3, +origin: G.Vec3, +normal: G.Vec3) -> Decision:
  match valid:
    case False{}:
      Decision{Undefined{}, Invalid{}}
    case True{}:
      indirect_values(dot_delta(cut_normal, a, cut_origin), dot_delta(cut_normal, b, cut_origin), dot_delta(normal, a, origin), dot_delta(normal, b, origin))

def classify(point: Point, +origin: G.Vec3, +normal: G.Vec3) -> Decision:
  match point:
    case Explicit{value}:
      point_plane(normal, value, origin)
    case LinePlane{+a, +b, +cut_origin, +cut_normal}:
      valid = Bool.and(vec_valid(a), Bool.and(vec_valid(b), Bool.and(vec_valid(cut_origin), Bool.and(vec_valid(cut_normal), Bool.and(vec_valid(origin), vec_valid(normal))))))
      indirect_valid(valid, a, b, cut_origin, cut_normal, origin, normal)
