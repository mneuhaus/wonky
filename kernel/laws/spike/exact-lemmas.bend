import Base
import ../../robust-predicates.bend as RP
import ./arith-spec.bend as A
import ./word-lemmas.bend as WL

# Lemmas about the exact (signed base-4096) fallback of kernel/robust-predicates.bend.
# Stated {replacement == form-in-goal} for use with `%e : P`.

def mag_cmp_refl(a: List<&2, U32>) -> {EQ{} == RP.mag_cmp(a, a) : Cmp}:
  match a:
    case Nil{}:
      {==}
    case +h <> t:
      %mag_cmp_refl(t) : {EQ{} == RP.mag_cmp_finish(_, h, h) : Cmp}
      WL.u32_cmp_refl(h)

# x - x is exactly zero for EVERY Big, normalized or not.
def sub_self_zero(x: RP.Big) -> {RP.sign(RP.sub(x, x)) == RP.ExactlyZero{} : RP.Sign}:
  match x:
    case RP.Big{n, ds}:
      match n ds:
        case True{} Nil{}:
          {==}
        case False{} Nil{}:
          {==}
        case True{} +h <> +t:
          %mag_cmp_refl(h <> t) : {RP.sign(RP.add_opposite(_, True{}, h <> t, False{}, h <> t)) == RP.ExactlyZero{} : RP.Sign}
          {==}
        case False{} +h <> +t:
          %mag_cmp_refl(h <> t) : {RP.sign(RP.add_opposite(_, False{}, h <> t, True{}, h <> t)) == RP.ExactlyZero{} : RP.Sign}
          {==}

def finish_flip(t: Cmp, +a: U32, +b: U32) ->
  {A.cmp_flip(RP.mag_cmp_finish(t, b, a)) == RP.mag_cmp_finish(A.cmp_flip(t), a, b) : Cmp}:
  match t:
    case LT{}:
      {==}
    case EQ{}:
      WL.u32_cmp_anti(a, b)
    case GT{}:
      {==}

# Magnitude comparison is antisymmetric for every pair of digit lists.
def mag_cmp_anti(a: List<&2, U32>, b: List<&2, U32>) -> {A.cmp_flip(RP.mag_cmp(b, a)) == RP.mag_cmp(a, b) : Cmp}:
  match a b:
    case Nil{} Nil{}:
      {==}
    case Nil{} bh <> bt:
      {==}
    case ah <> at Nil{}:
      {==}
    case +ah <> +at +bh <> +bt:
      %mag_cmp_anti(at, bt) : {A.cmp_flip(RP.mag_cmp_finish(RP.mag_cmp(bt, at), bh, ah)) == RP.mag_cmp_finish(_, ah, bh) : Cmp}
      finish_flip(RP.mag_cmp(bt, at), ah, bh)

def make_normal(neg: Bool, ds: List<&2, U32>) -> {A.negative_zero(RP.make(neg, ds)) == False{} : Bool}:
  match neg ds:
    case True{} Nil{}:
      {==}
    case True{} _ <> _:
      {==}
    case False{} _:
      {==}

def opposite_normal(o: Cmp, an: Bool, +ad: List<&2, U32>, bn: Bool, +bd: List<&2, U32>) ->
  {A.negative_zero(RP.add_opposite(o, an, ad, bn, bd)) == False{} : Bool}:
  match o:
    case EQ{}:
      {==}
    case GT{}:
      make_normal(an, RP.mag_sub(ad, bd, 0))
    case LT{}:
      make_normal(bn, RP.mag_sub(bd, ad, 0))

# Every sum of two Bigs is normal (no negative zero), whatever the inputs.
def add_normal(a: RP.Big, b: RP.Big) -> {A.negative_zero(RP.add(a, b)) == False{} : Bool}:
  match a b:
    case RP.Big{True{}, +ad} RP.Big{True{}, +bd}:
      make_normal(True{}, RP.mag_add(ad, bd, 0))
    case RP.Big{False{}, +ad} RP.Big{False{}, +bd}:
      make_normal(False{}, RP.mag_add(ad, bd, 0))
    case RP.Big{True{}, +ad} RP.Big{False{}, +bd}:
      opposite_normal(RP.mag_cmp(ad, bd), True{}, ad, False{}, bd)
    case RP.Big{False{}, +ad} RP.Big{True{}, +bd}:
      opposite_normal(RP.mag_cmp(ad, bd), False{}, ad, True{}, bd)
