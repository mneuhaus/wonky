import Base
import ./arith-spec.bend as A
import ./base-lemmas.bend as N
import ./word-lemmas.bend as WL

# U32 addition in the checker is Base's Word.adc: a 32-step ripple-carry adder
# over Bools. These lemmas give it Nat meaning, for every width n.

def scaled_succ(-p: Nat, co: Bool) -> {Nat.double(A.scaled(p, co)) == A.scaled(1n+p, co) : Nat}:
  match co:
    case False{}:
      {==}
    case True{}:
      {==}

# One ripple step, as pure Nat algebra: the low sum bit plus twice the rest.
def adder_step(+ab: Bool, +bb: Bool, +c: Bool, +s: Bool, +k: Bool, +x: Nat, +y: Nat, +r: Nat, +p: Nat, +co: Bool,
  fa: {Nat.add(Nat.add(A.bit(ab), A.bit(bb)), A.bit(c)) == Nat.add(A.bit(s), Nat.double(A.bit(k))) : Nat},
  ih: {Nat.add(Nat.add(x, y), A.bit(k)) == Nat.add(r, A.scaled(p, co)) : Nat}) ->
  {Nat.add(Nat.add(Nat.add(A.bit(ab), Nat.double(x)), Nat.add(A.bit(bb), Nat.double(y))), A.bit(c))
    == Nat.add(Nat.add(A.bit(s), Nat.double(r)), A.scaled(1n+p, co)) : Nat}:
  +t = A.scaled(p, co)
  +l0 = Nat.add(Nat.add(Nat.add(A.bit(ab), Nat.double(x)), Nat.add(A.bit(bb), Nat.double(y))), A.bit(c))
  +bs = A.bit(s)
  +dk = Nat.double(A.bit(k))
  +xy = Nat.add(x, y)
  +dxy = Nat.double(xy)
  +ha = Nat.add(A.bit(ab), A.bit(bb))
  # right side: (s + 2r) + 2t  ->  ((ab + bb) + c) + 2(x + y)
  %scaled_succ(p, co) : {l0 == Nat.add(Nat.add(bs, Nat.double(r)), _) : Nat}
  %N.assoc_r(bs, Nat.double(r), Nat.double(t)) : {l0 == _ : Nat}
  %N.double_fold(r, t) : {l0 == Nat.add(bs, _) : Nat}
  %ih : {l0 == Nat.add(bs, Nat.double(_)) : Nat}
  %N.double_unfold(xy, A.bit(k)) : {l0 == Nat.add(bs, _) : Nat}
  %N.add_comm(dk, dxy) : {l0 == Nat.add(bs, _) : Nat}
  %N.add_assoc(bs, dk, dxy) : {l0 == _ : Nat}
  %fa : {l0 == Nat.add(_, dxy) : Nat}
  # left side: ((ab + 2x) + (bb + 2y)) + c  ->  ((ab + bb) + c) + 2(x + y)
  %N.swap_middle(A.bit(ab), A.bit(bb), Nat.double(x), Nat.double(y)) :
    {Nat.add(_, A.bit(c)) == Nat.add(Nat.add(ha, A.bit(c)), dxy) : Nat}
  %N.double_fold(x, y) : {Nat.add(Nat.add(ha, _), A.bit(c)) == Nat.add(Nat.add(ha, A.bit(c)), dxy) : Nat}
  %N.assoc_r(ha, dxy, A.bit(c)) : {_ == Nat.add(Nat.add(ha, A.bit(c)), dxy) : Nat}
  %N.add_comm(A.bit(c), dxy) : {Nat.add(ha, _) == Nat.add(Nat.add(ha, A.bit(c)), dxy) : Nat}
  %N.add_assoc(ha, A.bit(c), dxy) : {_ == Nat.add(Nat.add(ha, A.bit(c)), dxy) : Nat}
  {==}

# Base's Word adder is correct in Nat, carry included, for every width n:
#   a + b + c == adc(a, b, c) + 2^n * carry_out(a, b, c)
def adc_value(+n: Nat, a: Word(n), b: Word(n), c: Bool) ->
  {Nat.add(Nat.add(Word.to_nat(n, a), Word.to_nat(n, b)), A.bit(c))
    == Nat.add(Word.to_nat(n, Word.adc(n, a, b, False{}, c)), A.scaled(n, A.carry_out(n, a, b, c))) : Nat}:
  match n:
    case 0n:
      match a b c:
        case WNil{} WNil{} False{}:
          {==}
        case WNil{} WNil{} True{}:
          {==}
    case 1n+p:
      match a b c:
        case WCon{False{}, +at} WCon{False{}, +bt} False{}:
          adder_step(False{}, False{}, False{}, False{}, False{}, Word.to_nat(p, at), Word.to_nat(p, bt),
            Word.to_nat(p, Word.adc(p, at, bt, False{}, False{})), p, A.carry_out(p, at, bt, False{}), {==}, adc_value(p, at, bt, False{}))
        case WCon{False{}, +at} WCon{False{}, +bt} True{}:
          adder_step(False{}, False{}, True{}, True{}, False{}, Word.to_nat(p, at), Word.to_nat(p, bt),
            Word.to_nat(p, Word.adc(p, at, bt, False{}, False{})), p, A.carry_out(p, at, bt, False{}), {==}, adc_value(p, at, bt, False{}))
        case WCon{False{}, +at} WCon{True{}, +bt} False{}:
          adder_step(False{}, True{}, False{}, True{}, False{}, Word.to_nat(p, at), Word.to_nat(p, bt),
            Word.to_nat(p, Word.adc(p, at, bt, False{}, False{})), p, A.carry_out(p, at, bt, False{}), {==}, adc_value(p, at, bt, False{}))
        case WCon{False{}, +at} WCon{True{}, +bt} True{}:
          adder_step(False{}, True{}, True{}, False{}, True{}, Word.to_nat(p, at), Word.to_nat(p, bt),
            Word.to_nat(p, Word.adc(p, at, bt, False{}, True{})), p, A.carry_out(p, at, bt, True{}), {==}, adc_value(p, at, bt, True{}))
        case WCon{True{}, +at} WCon{False{}, +bt} False{}:
          adder_step(True{}, False{}, False{}, True{}, False{}, Word.to_nat(p, at), Word.to_nat(p, bt),
            Word.to_nat(p, Word.adc(p, at, bt, False{}, False{})), p, A.carry_out(p, at, bt, False{}), {==}, adc_value(p, at, bt, False{}))
        case WCon{True{}, +at} WCon{False{}, +bt} True{}:
          adder_step(True{}, False{}, True{}, False{}, True{}, Word.to_nat(p, at), Word.to_nat(p, bt),
            Word.to_nat(p, Word.adc(p, at, bt, False{}, True{})), p, A.carry_out(p, at, bt, True{}), {==}, adc_value(p, at, bt, True{}))
        case WCon{True{}, +at} WCon{True{}, +bt} False{}:
          adder_step(True{}, True{}, False{}, False{}, True{}, Word.to_nat(p, at), Word.to_nat(p, bt),
            Word.to_nat(p, Word.adc(p, at, bt, False{}, True{})), p, A.carry_out(p, at, bt, True{}), {==}, adc_value(p, at, bt, True{}))
        case WCon{True{}, +at} WCon{True{}, +bt} True{}:
          adder_step(True{}, True{}, True{}, True{}, True{}, Word.to_nat(p, at), Word.to_nat(p, bt),
            Word.to_nat(p, Word.adc(p, at, bt, False{}, True{})), p, A.carry_out(p, at, bt, True{}), {==}, adc_value(p, at, bt, True{}))

# U32.add is exact Nat addition with the carry weighted 2^32.
def u32_add_value(a: U32, b: U32) ->
  {Nat.add(U32.to_nat(a), U32.to_nat(b)) == Nat.add(U32.to_nat(U32.add(a, b)), A.scaled(32n, A.carry32(a, b))) : Nat}:
  match a b:
    case U32{+x} U32{+y}:
      +s = Nat.add(Word.to_nat(32n, x), Word.to_nat(32n, y))
      Equal.trans(Nat, s, Nat.add(s, 0n),
        Nat.add(Word.to_nat(32n, Word.adc(32n, x, y, False{}, False{})), A.scaled(32n, A.carry_out(32n, x, y, False{}))),
        Equal.sym(Nat, Nat.add(s, 0n), s, N.add_zero(s)), adc_value(32n, x, y, False{}))

def lt_zero(x: Nat) -> {Nat.is_lt(x, 0n) == False{} : Bool}:
  match x:
    case 0n:
      {==}
    case 1n+p:
      {==}

def lt_add_self(+r: Nat, m: Nat) -> {Nat.is_lt(Nat.add(r, m), m) == False{} : Bool}:
  match m:
    case 0n:
      lt_zero(Nat.add(r, 0n))
    case 1n+q:
      %N.add_succ(r, q) : {Nat.is_lt(_, 1n+q) == False{} : Bool}
      lt_add_self(r, q)

def truthy(b: Bool) -> Type:
  match b:
    case False{}:
      Empty
    case True{}:
      Unit

def bool_clash(e: {True{} == False{} : Bool}) -> Empty:
  %e : truthy(_)
  Unit{}

# If the Nat sum is below 2^n, the carry is clear and the n-bit sum is exact.
# Kept generic in n: with n = 32n the checker would expand pow2(32n) (2^32
# unary Succ nodes) and overflow its stack.
def no_carry(+n: Nat, co: Bool, +r: Nat, -s: Nat,
  eq: {s == Nat.add(r, A.scaled(n, co)) : Nat},
  lt: {Nat.is_lt(s, A.pow2(n)) == True{} : Bool}) -> {r == s : Nat}:
  match co:
    case False{}:
      Equal.trans(Nat, r, Nat.add(r, 0n), s, Equal.sym(Nat, Nat.add(r, 0n), r, N.add_zero(r)), Equal.sym(Nat, s, Nat.add(r, 0n), eq))
    case True{}:
      Empty.absurd({r == s : Nat}, bool_clash(
        Equal.trans(Bool, True{}, Nat.is_lt(s, A.pow2(n)), False{}, Equal.sym(Bool, Nat.is_lt(s, A.pow2(n)), True{}, lt),
          Equal.trans(Bool, Nat.is_lt(s, A.pow2(n)), Nat.is_lt(Nat.add(r, A.pow2(n)), A.pow2(n)), False{},
            Equal.cong(Nat, Bool, x => Nat.is_lt(x, A.pow2(n)), s, Nat.add(r, A.pow2(n)), eq),
            lt_add_self(r, A.pow2(n))))))
