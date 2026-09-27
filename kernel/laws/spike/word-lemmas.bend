import Base
import ./arith-spec.bend as A

# Comparison lemmas for Base Word(n) and U32 = U32{Word(32n)}. Stated
# {replacement == form-in-goal} for use with `%e : P`.

def cmp_fin_flip(ab: Bool, bb: Bool, t: Cmp) ->
  {Word.cmp.fin(ab, bb, A.cmp_flip(t)) == A.cmp_flip(Word.cmp.fin(bb, ab, t)) : Cmp}:
  match ab bb t:
    case True{} True{} LT{}:
      {==}
    case True{} True{} EQ{}:
      {==}
    case True{} True{} GT{}:
      {==}
    case True{} False{} LT{}:
      {==}
    case True{} False{} EQ{}:
      {==}
    case True{} False{} GT{}:
      {==}
    case False{} True{} LT{}:
      {==}
    case False{} True{} EQ{}:
      {==}
    case False{} True{} GT{}:
      {==}
    case False{} False{} LT{}:
      {==}
    case False{} False{} EQ{}:
      {==}
    case False{} False{} GT{}:
      {==}

# Word comparison is antisymmetric, for every width (so for U32 = Word(32n)).
def word_cmp_anti(+n: Nat, a: Word(n), b: Word(n)) ->
  {A.cmp_flip(Word.cmp(n, b, a)) == Word.cmp(n, a, b) : Cmp}:
  match n:
    case 0n:
      match a b:
        case WNil{} WNil{}:
          {==}
    case 1n+p:
      match a b:
        case WCon{+ab, +at} WCon{+bb, +bt}:
          %word_cmp_anti(p, at, bt) : {A.cmp_flip(Word.cmp.fin(bb, ab, Word.cmp(p, bt, at))) == Word.cmp.fin(ab, bb, _) : Cmp}
          Equal.sym(Cmp, Word.cmp.fin(ab, bb, A.cmp_flip(Word.cmp(p, bt, at))),
            A.cmp_flip(Word.cmp.fin(bb, ab, Word.cmp(p, bt, at))), cmp_fin_flip(ab, bb, Word.cmp(p, bt, at)))

def is_eq_flip(c: Cmp) -> {Cmp.is_eq(A.cmp_flip(c)) == Cmp.is_eq(c) : Bool}:
  match c:
    case LT{}:
      {==}
    case EQ{}:
      {==}
    case GT{}:
      {==}

def u32_is_eq_sym(x: U32, y: U32) -> {U32.is_eq(y, x) == U32.is_eq(x, y) : Bool}:
  match x y:
    case U32{+xw} U32{+yw}:
      %word_cmp_anti(32n, xw, yw) : {Cmp.is_eq(Word.cmp(32n, yw, xw)) == Cmp.is_eq(_) : Bool}
      Equal.sym(Bool, Cmp.is_eq(A.cmp_flip(Word.cmp(32n, yw, xw))), Cmp.is_eq(Word.cmp(32n, yw, xw)),
        is_eq_flip(Word.cmp(32n, yw, xw)))

def word_cmp_refl(+n: Nat, a: Word(n)) -> {EQ{} == Word.cmp(n, a, a) : Cmp}:
  match n:
    case 0n:
      match a:
        case WNil{}:
          {==}
    case 1n+p:
      match a:
        case WCon{True{}, t}:
          %word_cmp_refl(p, t) : {EQ{} == Word.cmp.fin(True{}, True{}, _) : Cmp}
          {==}
        case WCon{False{}, t}:
          %word_cmp_refl(p, t) : {EQ{} == Word.cmp.fin(False{}, False{}, _) : Cmp}
          {==}

def u32_cmp_refl(a: U32) -> {EQ{} == U32.cmp(a, a) : Cmp}:
  match a:
    case U32{w}:
      word_cmp_refl(32n, w)

def u32_cmp_anti(a: U32, b: U32) -> {A.cmp_flip(U32.cmp(b, a)) == U32.cmp(a, b) : Cmp}:
  match a b:
    case U32{x} U32{y}:
      word_cmp_anti(32n, x, y)
