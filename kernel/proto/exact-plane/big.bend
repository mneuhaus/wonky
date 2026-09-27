import Base
import ../../real.bend as R

# Signed arbitrary-precision integers for the exact-plane prototype.
#
# Magnitudes are little-endian lists of 16-bit limbs held in U32 words, with
# no most-significant zero limb (zero is the empty list and is never
# negative). A limb product plus a carry stays below 2^32, so no U32
# operation overflows. Lengths are variable: the axis-aligned and small
# plane coefficients that dominate CAD input stay one or two limbs long, and
# the worst-case plane-side predicate of the prototype (9 B + 19 bits for
# B-bit grid coordinates, 325 bits at B = 34) is 21 limbs.
#
# Adapted in structure from kernel/robust-predicates.bend (base-4096 digits);
# the radix, the division and the approximations are new.

type Big is Data:
  Big{neg: Bool, mag: List<&2, U32>}

type Sign is Data:
  Lt0{}
  Eq0{}
  Gt0{}

def zero() -> Big:
  Big{False{}, Nil{}}

def is_nil(xs: List<&2, U32>) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case _ <> _:
      False{}

def digit.pick(nz: Bool, +h: U32, t: List<&2, U32>) -> List<&2, U32>:
  match nz:
    case True{}:
      h <> t
    case False{}:
      match t:
        case Nil{}:
          Nil{}
        case x <> r:
          h <> (x <> r)

# h prepended below t, dropping a top zero limb.
def digit(+h: U32, t: List<&2, U32>) -> List<&2, U32>:
  digit.pick(U32.is_ne(h, 0), h, t)

def make(neg: Bool, +mag: List<&2, U32>) -> Big:
  Big{Bool.and(neg, Bool.not(is_nil(mag))), mag}

def from_u32(+x: U32) -> Big:
  make(False{}, digit(U32.and(x, 65535), digit((x >> 16n : U32), Nil{})))

def from_i32(neg: Bool, +x: U32) -> Big:
  make(neg, digit(U32.and(x, 65535), digit((x >> 16n : U32), Nil{})))

def one() -> Big:
  Big{False{}, [1]}

# --- magnitudes -----------------------------------------------------------

def mag_add(a: List<&2, U32>, b: List<&2, U32>, +carry: U32) -> List<&2, U32>:
  match a b:
    case Nil{} Nil{}:
      digit(carry, Nil{})
    case ah <> at Nil{}:
      +s = (ah + carry : U32)
      digit(U32.and(s, 65535), mag_add(at, Nil{}, (s >> 16n : U32)))
    case Nil{} bh <> bt:
      +s = (bh + carry : U32)
      digit(U32.and(s, 65535), mag_add(Nil{}, bt, (s >> 16n : U32)))
    case ah <> at bh <> bt:
      +s = (ah + bh + carry : U32)
      digit(U32.and(s, 65535), mag_add(at, bt, (s >> 16n : U32)))

def cmp_fin(high: Cmp, +a: U32, +b: U32) -> Cmp:
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
      cmp_fin(mag_cmp(at, bt), ah, bh)

def borrow_of(+d: U32) -> U32:
  (1 - (d >> 16n : U32) : U32)

# Precondition a >= b.
def mag_sub(a: List<&2, U32>, b: List<&2, U32>, +borrow: U32) -> List<&2, U32>:
  match a b:
    case Nil{} _:
      Nil{}
    case ah <> at Nil{}:
      +d = (ah + 65536 - borrow : U32)
      digit(U32.and(d, 65535), mag_sub(at, Nil{}, borrow_of(d)))
    case ah <> at bh <> bt:
      +d = (ah + 65536 - bh - borrow : U32)
      digit(U32.and(d, 65535), mag_sub(at, bt, borrow_of(d)))

# a * m + carry for a limb m < 2^16: each product plus carry < 2^32.
def mag_scale(a: List<&2, U32>, +m: U32, +carry: U32) -> List<&2, U32>:
  match a:
    case Nil{}:
      digit(carry, Nil{})
    case h <> t:
      +p = (h * m + carry : U32)
      digit(U32.and(p, 65535), mag_scale(t, m, (p >> 16n : U32)))

def mag_mul(a: List<&2, U32>, +b: List<&2, U32>) -> List<&2, U32>:
  match a:
    case Nil{}:
      Nil{}
    case h <> t:
      mag_add(mag_scale(b, h, 0), digit(0, mag_mul(t, b)), 0)

# --- signed arithmetic ----------------------------------------------------

def add.opp(order: Cmp, an: Bool, ad: List<&2, U32>, bn: Bool, bd: List<&2, U32>) -> Big:
  match order:
    case EQ{}:
      zero()
    case GT{}:
      make(an, mag_sub(ad, bd, 0))
    case LT{}:
      make(bn, mag_sub(bd, ad, 0))

def add.pick(same: Bool, an: Bool, +ad: List<&2, U32>, bn: Bool, +bd: List<&2, U32>) -> Big:
  match same:
    case True{}:
      make(an, mag_add(ad, bd, 0))
    case False{}:
      add.opp(mag_cmp(ad, bd), an, ad, bn, bd)

def add(a: Big, b: Big) -> Big:
  Big{+an, ad} = a
  Big{+bn, bd} = b
  add.pick(Bool.not(Bool.xor(an, bn)), an, ad, bn, bd)

def neg(a: Big) -> Big:
  Big{n, m} = a
  make(Bool.not(n), m)

def sub(a: Big, b: Big) -> Big:
  add(a, neg(b))

def mul(a: Big, b: Big) -> Big:
  Big{an, ad} = a
  Big{bn, bd} = b
  make(Bool.xor(an, bn), mag_mul(ad, bd))

def sign.of(m: List<&2, U32>, n: Bool) -> Sign:
  match m n:
    case Nil{} _:
      Eq0{}
    case _ <> _ True{}:
      Lt0{}
    case _ <> _ False{}:
      Gt0{}

def sign(a: Big) -> Sign:
  Big{n, m} = a
  sign.of(m, n)

def is_zero(a: Big) -> Bool:
  Big{_, m} = a
  is_nil(m)

def is_neg(a: Big) -> Bool:
  Big{n, _} = a
  n

def cmp.signed(an: Bool, bn: Bool, +ad: List<&2, U32>, +bd: List<&2, U32>) -> Cmp:
  match an bn:
    case True{} False{}:
      LT{}
    case False{} True{}:
      GT{}
    case False{} False{}:
      mag_cmp(ad, bd)
    case True{} True{}:
      mag_cmp(bd, ad)

def cmp(a: Big, b: Big) -> Cmp:
  Big{an, ad} = a
  Big{bn, bd} = b
  cmp.signed(an, bn, ad, bd)

def eq(a: Big, b: Big) -> Bool:
  Cmp.is_eq(cmp(a, b))

def abs(a: Big) -> Big:
  Big{_, m} = a
  Big{False{}, m}

# Sum of three products (dot products of Big vectors).
def dot3(ax: Big, ay: Big, az: Big, bx: Big, by: Big, bz: Big) -> Big:
  add(add(mul(ax, bx), mul(ay, by)), mul(az, bz))

# --- shifts ---------------------------------------------------------------

def nlimbs.go(xs: List<&2, U32>, +acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case _ <> t:
      nlimbs.go(t, (acc + 1 : U32))

def nlimbs(a: Big) -> U32:
  Big{_, m} = a
  nlimbs.go(m, 0)

def mag_shl_limbs(k: Nat, m: List<&2, U32>) -> List<&2, U32>:
  match k:
    case 0n:
      m
    case 1n+p:
      digit(0, mag_shl_limbs(p, m))

def mag_drop_limbs(k: Nat, m: List<&2, U32>) -> List<&2, U32>:
  match k m:
    case 0n _:
      m
    case 1n+p Nil{}:
      Nil{}
    case 1n+p _ <> t:
      mag_drop_limbs(p, t)

# a * 2^bits for bits < 16 (as a scale by a power of two).
def mag_shl_small(m: List<&2, U32>, +bits: U32) -> List<&2, U32>:
  mag_scale(m, U32.shln(1, U32.to_nat(bits)), 0)

def shl(a: Big, +bits: U32) -> Big:
  Big{n, m} = a
  make(n, mag_shl_limbs(U32.to_nat((bits >> 4n : U32)), mag_shl_small(m, U32.and(bits, 15))))

# Magnitude shifted right by one bit (floor); h is the pending limb below t.
def mag_shr1.go(t: List<&2, U32>, +h: U32) -> List<&2, U32>:
  match t:
    case Nil{}:
      digit((h >> 1n : U32), Nil{})
    case +x <> r:
      digit(U32.or((h >> 1n : U32), U32.shln(U32.and(x, 1), 15n)), mag_shr1.go(r, x))

def mag_shr1(m: List<&2, U32>) -> List<&2, U32>:
  match m:
    case Nil{}:
      Nil{}
    case h <> t:
      mag_shr1.go(t, h)

# --- division (for the final rounding of implicit vertices) --------------

type QR is Data:
  QR{q: List<&2, U32>, r: List<&2, U32>}

def div.step(ge: Cmp, +q: List<&2, U32>, +r: List<&2, U32>, +d: List<&2, U32>) -> QR:
  match ge:
    case LT{}:
      QR{mag_add(q, q, 0), r}
    case _:
      QR{mag_add(mag_add(q, q, 0), [1], 0), mag_sub(r, d, 0)}

def div.go(k: Nat, +dk: List<&2, U32>, st: QR) -> QR:
  match k:
    case 0n:
      st
    case 1n+p:
      QR{+q, +r} = st
      +dn = mag_shr1(dk)
      div.go(p, dn, div.step(mag_cmp(r, dn), q, r, dn))

def mag_shl(m: List<&2, U32>, +bits: U32) -> List<&2, U32>:
  mag_shl_limbs(U32.to_nat((bits >> 4n : U32)), mag_shl_small(m, U32.and(bits, 15)))

# Quotient and remainder of magnitudes n / d (d != 0) when n < d * 2^(k+1).
def mag_divmod(+n: List<&2, U32>, d: List<&2, U32>, +k: U32) -> QR:
  +dk = mag_shl(d, k)
  div.go(U32.to_nat(k), dk, div.step(mag_cmp(n, dk), Nil{}, n, dk))

def floor_up(r: List<&2, U32>) -> List<&2, U32>:
  match r:
    case Nil{}:
      Nil{}
    case _ <> _:
      [1]

def floor_fix(neg: Bool, qr: QR) -> Big:
  match neg:
    case False{}:
      QR{q, _} = qr
      make(False{}, q)
    case True{}:
      QR{q, r} = qr
      make(True{}, mag_add(q, floor_up(r), 0))

# floor(n / d) for d > 0, provided |n| < d * 2^(k+1).
def floor_div(n: Big, d: Big, +k: U32) -> Big:
  Big{nn, nm} = n
  Big{_, dm} = d
  floor_fix(nn, mag_divmod(nm, dm, k))

# --- approximations -------------------------------------------------------

def scale16(a: R.Real) -> R.Real:
  R.Real{hi, lo} = a
  R.Real{(hi * 65536.0 : F32), (lo * 65536.0 : F32)}

def horner(rev: List<&2, U32>, acc: R.Real) -> R.Real:
  match rev:
    case Nil{}:
      acc
    case h <> t:
      horner(t, R.add(scale16(acc), R.from_f32(U32.to_f32(h))))

def signed_real(neg: Bool, r: R.Real) -> R.Real:
  match neg:
    case True{}:
      R.neg(r)
    case False{}:
      r

# The value as a Real (callers keep |a| < 2^120).
def to_real(a: Big) -> R.Real:
  Big{n, m} = a
  signed_real(n, horner(List.reverse(&2, U32, m), R.from_f32(0.0)))

# a / 2^(16 k), the dropped limbs truncated (magnitude rounded toward zero).
def to_real_drop(a: Big, k: Nat) -> R.Real:
  Big{n, m} = a
  signed_real(n, horner(List.reverse(&2, U32, mag_drop_limbs(k, m)), R.from_f32(0.0)))
