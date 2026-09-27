import Base
import ../../robust-predicates.bend as RP
import ./arith-spec.bend as A
import ./base-lemmas.bend as N
import ./order-lemmas.bend as O
import ./arith-lemmas.bend as AL
import ./limb-lemmas.bend as LL

# Nat correctness of RP.mag_add, the multi-limb adder of the exact predicates.

# If 1 + s <= 2^k and k <= n, an n-bit sum s = r + 2^n * carry has no carry.
# Width-generic on purpose: pow2(32n) must never appear in a checked type.
def carry_free(+n: Nat, co: Bool, +r: Nat, +s: Nat, +k: Nat,
  eq: {s == Nat.add(r, A.scaled(n, co)) : Nat},
  kn: {A.le(k, n) == True{} : Bool},
  bound: {A.le(1n+s, A.pow2(k)) == True{} : Bool}) -> {r == s : Nat}:
  match co:
    case False{}:
      Equal.trans(Nat, r, Nat.add(r, 0n), s, Equal.sym(Nat, Nat.add(r, 0n), r, N.add_zero(r)), Equal.sym(Nat, s, Nat.add(r, 0n), eq))
    case True{}:
      +p = A.pow2(n)
      h1 = O.le_trans(1n+s, A.pow2(k), p, bound, O.pow2_mono(k, n, kn))
      h3 = O.le_trans(1n+s, p, Nat.add(r, p), h1, O.le_add_r(p, r, p, O.le_refl(p)))
      e = Equal.cong(Nat, Bool, x => A.le(1n+s, x), Nat.add(r, p), s, Equal.sym(Nat, s, Nat.add(r, p), eq))
      h4 = Equal.trans(Bool, A.le(1n+s, s), A.le(1n+s, Nat.add(r, p)), True{}, Equal.sym(Bool, A.le(1n+s, Nat.add(r, p)), A.le(1n+s, s), e), h3)
      Empty.absurd({r == s : Nat}, O.false_true(
        Equal.trans(Bool, False{}, A.le(1n+s, s), True{}, Equal.sym(Bool, A.le(1n+s, s), False{}, O.le_succ_false(s)), h4)))

# U32 addition of values whose sum is below 8192 is exact.
def u32_add_small(a: U32, b: U32, bound: {A.le(1n+Nat.add(U32.to_nat(a), U32.to_nat(b)), A.pow2(13n)) == True{} : Bool}) ->
  {U32.to_nat(U32.add(a, b)) == Nat.add(U32.to_nat(a), U32.to_nat(b)) : Nat}:
  match a b:
    case U32{+x} U32{+y}:
      +s = Nat.add(Word.to_nat(32n, x), Word.to_nat(32n, y))
      -co = A.carry_out(32n, x, y, False{})
      -r = Word.to_nat(32n, Word.adc(32n, x, y, False{}, False{}))
      carry_free(32n, A.carry_out(32n, x, y, False{}), Word.to_nat(32n, Word.adc(32n, x, y, False{}, False{})), s, 13n,
        Equal.trans(Nat, s, Nat.add(s, 0n), Nat.add(r, A.scaled(32n, co)),
          Equal.sym(Nat, Nat.add(s, 0n), s, N.add_zero(s)), AL.adc_value(32n, x, y, False{})),
        {==}, bound)

def fin_true_false(t: Cmp, e: {Cmp.is_eq(Word.cmp.fin(True{}, False{}, t)) == True{} : Bool}) -> Empty:
  match t:
    case LT{}:
      O.false_true(e)
    case EQ{}:
      O.false_true(e)
    case GT{}:
      O.false_true(e)

def fin_ff(t: Cmp) -> {Cmp.is_eq(t) == Cmp.is_eq(Word.cmp.fin(False{}, False{}, t)) : Bool}:
  match t:
    case LT{}:
      {==}
    case EQ{}:
      {==}
    case GT{}:
      {==}

# A word that compares equal to zero has value 0.
def word_zero(+n: Nat, a: Word(n), e: {Cmp.is_eq(Word.cmp(n, a, Word.zero(n))) == True{} : Bool}) -> {0n == Word.to_nat(n, a) : Nat}:
  match n:
    case 0n:
      match a:
        case WNil{}:
          {==}
    case 1n+p:
      match a:
        case WCon{True{}, +t}:
          Empty.absurd({0n == Word.to_nat(1n+p, WCon{True{}, t}) : Nat}, fin_true_false(Word.cmp(p, t, Word.zero(p)), e))
        case WCon{False{}, +t}:
          +c = Word.cmp(p, t, Word.zero(p))
          %word_zero(p, t, Equal.trans(Bool, Cmp.is_eq(c), Cmp.is_eq(Word.cmp.fin(False{}, False{}, c)), True{}, fin_ff(c), e)) :
            {0n == Nat.double(_) : Nat}
          {==}

def zero_of_eq(h: U32, e: {U32.is_eq(h, 0) == True{} : Bool}) -> {0n == U32.to_nat(h) : Nat}:
  match h:
    case U32{w}:
      word_zero(32n, w, e)

# RP.digit drops a zero top digit; the value does not change.
def digit_gen(c: Bool, +h: U32, t: List<&2, U32>, hz: {c == True{} : Bool} -> {0n == U32.to_nat(h) : Nat}) ->
  {A.value(h <> t) == A.value(Bool.pick(List<&2, U32>, Bool.and(c, RP.empty(t)), Nil{}, h <> t)) : Nat}:
  match c:
    case False{}:
      {==}
    case True{}:
      match t:
        case Nil{}:
          %hz({==}) : {Nat.add(_, 0n) == 0n : Nat}
          {==}
        case x <> xs:
          {==}

def digit_value(+h: U32, +t: List<&2, U32>) -> {A.value(h <> t) == A.value(RP.digit(h, t)) : Nat}:
  digit_gen(U32.is_eq(h, 0), h, t, e => zero_of_eq(h, e))

# A carry out of a base-4096 digit sum below 8192 is 0 or 1.
def hi_bound(h: Nat, hyp: {A.le(Nat.mul(h, A.pow2(12n)), 8191n) == True{} : Bool}) -> {A.le(h, 1n) == True{} : Bool}:
  match h:
    case 0n:
      {==}
    case 1n+q:
      match q:
        case 0n:
          {==}
        case 1n+r:
          Empty.absurd({A.le(2n+r, 1n) == True{} : Bool}, O.false_true(hyp))

# Nat algebra of one limb, a-and-b case and one-sided case.
def alg2(+a: Nat, +b: Nat, +c: Nat, +lo: Nat, +h: Nat, +va: Nat, +vb: Nat, +p: Nat,
  split: {Nat.add(Nat.add(a, b), c) == Nat.add(lo, Nat.mul(h, p)) : Nat}) ->
  {Nat.add(Nat.add(Nat.add(a, Nat.mul(va, p)), Nat.add(b, Nat.mul(vb, p))), c) == Nat.add(lo, Nat.mul(Nat.add(Nat.add(va, vb), h), p)) : Nat}:
  +m = Nat.add(Nat.mul(va, p), Nat.mul(vb, p))
  +ab = Nat.add(a, b)
  +mh = Nat.mul(h, p)
  -l0 = Nat.add(Nat.add(Nat.add(a, Nat.mul(va, p)), Nat.add(b, Nat.mul(vb, p))), c)
  %N.mul_distr(Nat.add(va, vb), h, p) : {l0 == Nat.add(lo, _) : Nat}
  %N.mul_distr(va, vb, p) : {l0 == Nat.add(lo, Nat.add(_, mh)) : Nat}
  %N.add_comm(mh, m) : {l0 == Nat.add(lo, _) : Nat}
  %N.add_assoc(lo, mh, m) : {l0 == _ : Nat}
  %split : {l0 == Nat.add(_, m) : Nat}
  %N.swap_middle(a, b, Nat.mul(va, p), Nat.mul(vb, p)) : {Nat.add(_, c) == Nat.add(Nat.add(ab, c), m) : Nat}
  %N.assoc_r(ab, m, c) : {_ == Nat.add(Nat.add(ab, c), m) : Nat}
  %N.add_comm(c, m) : {Nat.add(ab, _) == Nat.add(Nat.add(ab, c), m) : Nat}
  N.assoc_r(ab, c, m)

def alg1(+a: Nat, +c: Nat, +lo: Nat, +h: Nat, +va: Nat, +p: Nat,
  split: {Nat.add(a, c) == Nat.add(lo, Nat.mul(h, p)) : Nat}) ->
  {Nat.add(Nat.add(a, Nat.mul(va, p)), c) == Nat.add(lo, Nat.mul(Nat.add(va, h), p)) : Nat}:
  +mv = Nat.mul(va, p)
  +mh = Nat.mul(h, p)
  -l0 = Nat.add(Nat.add(a, mv), c)
  %N.mul_distr(va, h, p) : {l0 == Nat.add(lo, _) : Nat}
  %N.add_comm(mh, mv) : {l0 == Nat.add(lo, _) : Nat}
  %N.add_assoc(lo, mh, mv) : {l0 == _ : Nat}
  %split : {l0 == Nat.add(_, mv) : Nat}
  %N.assoc_r(a, mv, c) : {_ == Nat.add(Nat.add(a, c), mv) : Nat}
  %N.add_comm(c, mv) : {Nat.add(a, _) == Nat.add(Nat.add(a, c), mv) : Nat}
  N.assoc_r(a, c, mv)

# x == to_nat(s) splits into the new digit and the carry of s.
def split_of(+s: U32, -x: Nat, ts: {U32.to_nat(s) == x : Nat}) ->
  {x == Nat.add(U32.to_nat(U32.and(s, 4095)), Nat.mul(U32.to_nat(U32.shrn(s, 12n)), A.pow2(12n))) : Nat}:
  Equal.trans(Nat, x, U32.to_nat(s), Nat.add(U32.to_nat(U32.and(s, 4095)), Nat.mul(U32.to_nat(U32.shrn(s, 12n)), A.pow2(12n))),
    Equal.sym(Nat, U32.to_nat(s), x, ts),
    Equal.sym(Nat, Nat.add(U32.to_nat(U32.and(s, 4095)), Nat.mul(U32.to_nat(U32.shrn(s, 12n)), A.pow2(12n))), U32.to_nat(s), LL.limb_split(s)))

# ... and if x <= 8191 that carry is 0 or 1.
def carry_bound(+s: U32, +x: Nat,
  split: {x == Nat.add(U32.to_nat(U32.and(s, 4095)), Nat.mul(U32.to_nat(U32.shrn(s, 12n)), A.pow2(12n))) : Nat},
  hx: {A.le(x, 8191n) == True{} : Bool}) -> {A.le(U32.to_nat(U32.shrn(s, 12n)), 1n) == True{} : Bool}:
  +lo = U32.to_nat(U32.and(s, 4095))
  +mh = Nat.mul(U32.to_nat(U32.shrn(s, 12n)), A.pow2(12n))
  hi_bound(U32.to_nat(U32.shrn(s, 12n)), O.le_drop_l(lo, mh, 8191n,
    Equal.trans(Bool, A.le(Nat.add(lo, mh), 8191n), A.le(x, 8191n), True{},
      Equal.sym(Bool, A.le(x, 8191n), A.le(Nat.add(lo, mh), 8191n),
        Equal.cong(Nat, Bool, y => A.le(y, 8191n), x, Nat.add(lo, mh), split)), hx)))

# RP.mag_add is exact on base-4096 digit lists (every digit <= 4095, carry <= 1):
#   value(mag_add(a, b, c)) == value(a) + value(b) + c
def mag_add_value(a: List<&2, U32>, b: List<&2, U32>, +c: U32,
  +da: {A.digits_ok(a) == True{} : Bool}, +db: {A.digits_ok(b) == True{} : Bool}, +dc: {A.le(U32.to_nat(c), 1n) == True{} : Bool}) ->
  {Nat.add(Nat.add(A.value(a), A.value(b)), U32.to_nat(c)) == A.value(RP.mag_add(a, b, c)) : Nat}:
  match a b:
    case Nil{} Nil{}:
      %digit_value(c, Nil{}) : {U32.to_nat(c) == _ : Nat}
      N.zero_r(U32.to_nat(c))
    case +ah <> +at Nil{}:
      +s = U32.add(ah, c)
      +lo = U32.and(s, 4095)
      +hi = U32.shrn(s, 12n)
      +xa = U32.to_nat(ah)
      +xc = U32.to_nat(c)
      +va = A.value(at)
      +p = A.pow2(12n)
      -l0 = Nat.add(Nat.add(A.value(ah <> at), 0n), xc)
      ha = O.and_left(A.le(xa, 4095n), A.digits_ok(at), da)
      dat = O.and_right(A.le(xa, 4095n), A.digits_ok(at), da)
      +hs = O.le_trans(Nat.add(xa, xc), 4096n, 8191n, O.le_add(xa, 4095n, xc, 1n, ha, dc), {==})
      +split = split_of(s, Nat.add(xa, xc), u32_add_small(ah, c, hs))
      hH = carry_bound(s, Nat.add(xa, xc), split, hs)
      %digit_value(lo, RP.mag_add(at, Nil{}, hi)) : {l0 == _ : Nat}
      %mag_add_value(at, Nil{}, hi, dat, {==}, hH) : {l0 == Nat.add(U32.to_nat(lo), Nat.mul(_, p)) : Nat}
      %N.zero_r(va) : {l0 == Nat.add(U32.to_nat(lo), Nat.mul(Nat.add(_, U32.to_nat(hi)), p)) : Nat}
      %N.zero_r(Nat.add(xa, Nat.mul(va, p))) : {Nat.add(_, xc) == Nat.add(U32.to_nat(lo), Nat.mul(Nat.add(va, U32.to_nat(hi)), p)) : Nat}
      alg1(xa, xc, U32.to_nat(lo), U32.to_nat(hi), va, p, split)
    case Nil{} +bh <> +bt:
      +s = U32.add(bh, c)
      +lo = U32.and(s, 4095)
      +hi = U32.shrn(s, 12n)
      +xb = U32.to_nat(bh)
      +xc = U32.to_nat(c)
      +vb = A.value(bt)
      +p = A.pow2(12n)
      -l0 = Nat.add(Nat.add(0n, A.value(bh <> bt)), xc)
      hb = O.and_left(A.le(xb, 4095n), A.digits_ok(bt), db)
      dbt = O.and_right(A.le(xb, 4095n), A.digits_ok(bt), db)
      +hs = O.le_trans(Nat.add(xb, xc), 4096n, 8191n, O.le_add(xb, 4095n, xc, 1n, hb, dc), {==})
      +split = split_of(s, Nat.add(xb, xc), u32_add_small(bh, c, hs))
      hH = carry_bound(s, Nat.add(xb, xc), split, hs)
      %digit_value(lo, RP.mag_add(Nil{}, bt, hi)) : {l0 == _ : Nat}
      %mag_add_value(Nil{}, bt, hi, {==}, dbt, hH) : {l0 == Nat.add(U32.to_nat(lo), Nat.mul(_, p)) : Nat}
      alg1(xb, xc, U32.to_nat(lo), U32.to_nat(hi), vb, p, split)
    case +ah <> +at +bh <> +bt:
      +s1 = U32.add(ah, bh)
      +s = U32.add(s1, c)
      +lo = U32.and(s, 4095)
      +hi = U32.shrn(s, 12n)
      +xa = U32.to_nat(ah)
      +xb = U32.to_nat(bh)
      +xc = U32.to_nat(c)
      +va = A.value(at)
      +vb = A.value(bt)
      +p = A.pow2(12n)
      +xab = Nat.add(xa, xb)
      -l0 = Nat.add(Nat.add(A.value(ah <> at), A.value(bh <> bt)), xc)
      +ha = O.and_left(A.le(xa, 4095n), A.digits_ok(at), da)
      +hb = O.and_left(A.le(xb, 4095n), A.digits_ok(bt), db)
      dat = O.and_right(A.le(xa, 4095n), A.digits_ok(at), da)
      dbt = O.and_right(A.le(xb, 4095n), A.digits_ok(bt), db)
      +hab = O.le_add(xa, 4095n, xb, 4095n, ha, hb)
      +t1 = u32_add_small(ah, bh, O.le_succ_r(xab, Nat.add(4095n, 4095n), hab))
      +hs = O.le_add(xab, Nat.add(4095n, 4095n), xc, 1n, hab, dc)
      bound2 = Equal.trans(Bool, A.le(Nat.add(U32.to_nat(s1), xc), 8191n), A.le(Nat.add(xab, xc), 8191n), True{},
        Equal.cong(Nat, Bool, y => A.le(Nat.add(y, xc), 8191n), U32.to_nat(s1), xab, t1), hs)
      ts = Equal.trans(Nat, U32.to_nat(s), Nat.add(U32.to_nat(s1), xc), Nat.add(xab, xc), u32_add_small(s1, c, bound2),
        Equal.cong(Nat, Nat, y => Nat.add(y, xc), U32.to_nat(s1), xab, t1))
      +split = split_of(s, Nat.add(xab, xc), ts)
      hH = carry_bound(s, Nat.add(xab, xc), split, hs)
      %digit_value(lo, RP.mag_add(at, bt, hi)) : {l0 == _ : Nat}
      %mag_add_value(at, bt, hi, dat, dbt, hH) : {l0 == Nat.add(U32.to_nat(lo), Nat.mul(_, p)) : Nat}
      alg2(xa, xb, xc, U32.to_nat(lo), U32.to_nat(hi), va, vb, p, split)
