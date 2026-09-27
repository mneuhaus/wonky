import Base
import ../../robust-predicates.bend as RP

# Nat reference semantics for the U32 bit model (Base defines U32 as
# U32{Word(32n)}, a list of 32 Bools, least significant bit first) and for the
# base-4096 digit lists of kernel/robust-predicates.bend.

def cmp_flip(c: Cmp) -> Cmp:
  match c:
    case LT{}:
      GT{}
    case EQ{}:
      EQ{}
    case GT{}:
      LT{}

def bit(b: Bool) -> Nat:
  match b:
    case False{}:
      0n
    case True{}:
      1n

def pow2(n: Nat) -> Nat:
  match n:
    case 0n:
      1n
    case 1n+p:
      Nat.double(pow2(p))

# 2^n when b, else 0: the weight of the carry out of an n-bit addition.
def scaled(n: Nat, b: Bool) -> Nat:
  match b:
    case False{}:
      0n
    case True{}:
      pow2(n)

def maj(a: Bool, b: Bool, c: Bool) -> Bool:
  match a b:
    case True{} True{}:
      True{}
    case False{} False{}:
      False{}
    case _ _:
      c

# The carry out of Base's ripple-carry Word.adc (Word.adc itself drops it).
def carry_out(n: Nat, a: Word(n), b: Word(n), c: Bool) -> Bool:
  match n:
    case 0n:
      c
    case 1n+p:
      match a b:
        case WCon{ab, at} WCon{bb, bt}:
          carry_out(p, at, bt, maj(ab, bb, c))

# a <= b on unary Nat, structurally (simpler to reason with than Nat.cmp).
def le(a: Nat, b: Nat) -> Bool:
  match a b:
    case 0n _:
      True{}
    case 1n+p 0n:
      False{}
    case 1n+p 1n+q:
      le(p, q)

# Value of a little-endian base-4096 digit list (robust-predicates.bend Big):
# digit + 4096 * value(rest).
def value(ds: List<&2, U32>) -> Nat:
  match ds:
    case Nil{}:
      0n
    case d <> rest:
      Nat.add(U32.to_nat(d), Nat.mul(value(rest), pow2(12n)))

# Every digit is a base-4096 digit (<= 4095).
def digits_ok(ds: List<&2, U32>) -> Bool:
  match ds:
    case Nil{}:
      True{}
    case d <> rest:
      Bool.and(le(U32.to_nat(d), 4095n), digits_ok(rest))

# The carry out of U32.add (which discards it).
def carry32(a: U32, b: U32) -> Bool:
  match a b:
    case U32{x} U32{y}:
      carry_out(32n, x, y, False{})

# A Big in normal form never carries a negative sign on zero (empty digits).
def negative_zero(b: RP.Big) -> Bool:
  RP.Big{negative, digits} = b
  Bool.and(negative, RP.empty(digits))
