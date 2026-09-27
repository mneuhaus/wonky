import Base
import ./arith-spec.bend as A
import ./base-lemmas.bend as N

# Order facts over A.le, stated as Bool equations {A.le(..) == True{}}.

def falsy(b: Bool) -> Type:
  match b:
    case False{}:
      Unit
    case True{}:
      Empty

def false_true(e: {False{} == True{} : Bool}) -> Empty:
  %e : falsy(_)
  Unit{}

def le_refl(a: Nat) -> {A.le(a, a) == True{} : Bool}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      le_refl(p)

def le_succ_r(a: Nat, b: Nat, h: {A.le(a, b) == True{} : Bool}) -> {A.le(a, 1n+b) == True{} : Bool}:
  match a b:
    case 0n _:
      {==}
    case 1n+p 0n:
      Empty.absurd({A.le(1n+p, 1n) == True{} : Bool}, false_true(h))
    case 1n+p 1n+q:
      le_succ_r(p, q, h)

def le_add_r(+a: Nat, +x: Nat, +y: Nat, h: {A.le(a, y) == True{} : Bool}) -> {A.le(a, Nat.add(x, y)) == True{} : Bool}:
  match x:
    case 0n:
      h
    case 1n+p:
      le_succ_r(a, Nat.add(p, y), le_add_r(a, p, y, h))

def le_add(a: Nat, x: Nat, +b: Nat, +y: Nat, ha: {A.le(a, x) == True{} : Bool}, hb: {A.le(b, y) == True{} : Bool}) ->
  {A.le(Nat.add(a, b), Nat.add(x, y)) == True{} : Bool}:
  match a x:
    case 0n _:
      le_add_r(b, x, y, hb)
    case 1n+p 0n:
      Empty.absurd({A.le(Nat.add(1n+p, b), Nat.add(0n, y)) == True{} : Bool}, false_true(ha))
    case 1n+p 1n+q:
      le_add(p, q, b, y, ha, hb)

def le_drop_l(x: Nat, +y: Nat, +z: Nat, h: {A.le(Nat.add(x, y), z) == True{} : Bool}) -> {A.le(y, z) == True{} : Bool}:
  match x z:
    case 0n _:
      h
    case 1n+p 0n:
      Empty.absurd({A.le(y, 0n) == True{} : Bool}, false_true(h))
    case 1n+p 1n+q:
      le_succ_r(y, q, le_drop_l(p, y, q, h))

def le_trans(a: Nat, b: Nat, c: Nat, hab: {A.le(a, b) == True{} : Bool}, hbc: {A.le(b, c) == True{} : Bool}) ->
  {A.le(a, c) == True{} : Bool}:
  match a b c:
    case 0n _ _:
      {==}
    case 1n+p 0n _:
      Empty.absurd({A.le(1n+p, c) == True{} : Bool}, false_true(hab))
    case 1n+p 1n+q 0n:
      Empty.absurd({A.le(1n+p, 0n) == True{} : Bool}, false_true(hbc))
    case 1n+p 1n+q 1n+r:
      le_trans(p, q, r, hab, hbc)

def le_succ_false(a: Nat) -> {A.le(1n+a, a) == False{} : Bool}:
  match a:
    case 0n:
      {==}
    case 1n+p:
      le_succ_false(p)

def le_double(+a: Nat, +b: Nat, h: {A.le(a, b) == True{} : Bool}) -> {A.le(a, Nat.double(b)) == True{} : Bool}:
  match a b:
    case 0n _:
      {==}
    case 1n+p 0n:
      Empty.absurd({A.le(1n+p, 0n) == True{} : Bool}, false_true(h))
    case 1n+p 1n+q:
      le_succ_r(p, Nat.double(q), le_double(p, q, h))

def le_double_mono(a: Nat, b: Nat, h: {A.le(a, b) == True{} : Bool}) -> {A.le(Nat.double(a), Nat.double(b)) == True{} : Bool}:
  match a b:
    case 0n _:
      {==}
    case 1n+p 0n:
      Empty.absurd({A.le(Nat.double(1n+p), 0n) == True{} : Bool}, false_true(h))
    case 1n+p 1n+q:
      le_double_mono(p, q, h)

def pow2_pos(+n: Nat) -> {A.le(1n, A.pow2(n)) == True{} : Bool}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      le_double(1n, A.pow2(p), pow2_pos(p))

def pow2_mono(+k: Nat, +n: Nat, h: {A.le(k, n) == True{} : Bool}) -> {A.le(A.pow2(k), A.pow2(n)) == True{} : Bool}:
  match k n:
    case 0n _:
      pow2_pos(n)
    case 1n+p 0n:
      Empty.absurd({A.le(A.pow2(1n+p), 1n) == True{} : Bool}, false_true(h))
    case 1n+p 1n+q:
      le_double_mono(A.pow2(p), A.pow2(q), pow2_mono(p, q, h))

def and_left(x: Bool, -y: Bool, h: {Bool.and(x, y) == True{} : Bool}) -> {x == True{} : Bool}:
  match x:
    case True{}:
      {==}
    case False{}:
      Empty.absurd({False{} == True{} : Bool}, false_true(h))

def and_right(x: Bool, -y: Bool, h: {Bool.and(x, y) == True{} : Bool}) -> {y == True{} : Bool}:
  match x:
    case True{}:
      h
    case False{}:
      Empty.absurd({y == True{} : Bool}, false_true(h))
