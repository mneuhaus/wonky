import Base
import ./arith-spec.bend as A
import ./base-lemmas.bend as N

# Nat meaning of the limb split used by kernel/robust-predicates.bend:
#   to_nat(s & 4095) + 4096 * to_nat(s >> 12) == to_nat(s)   for every U32 s.
# Generic Word(n) lemmas first; U32 = U32{Word(32n)}, least significant bit first.

# Value of the lowest k bits / of the bits from k up.
def loww(n: Nat, k: Nat, w: Word(n)) -> Nat:
  match n:
    case 0n:
      0n
    case 1n+p:
      match k:
        case 0n:
          0n
        case 1n+q:
          match w:
            case WCon{b, t}:
              Nat.add(A.bit(b), Nat.double(loww(p, q, t)))

def dropw(n: Nat, k: Nat, w: Word(n)) -> Nat:
  match n:
    case 0n:
      0n
    case 1n+p:
      match k:
        case 0n:
          Word.to_nat(1n+p, w)
        case 1n+q:
          match w:
            case WCon{b, t}:
              dropw(p, q, t)

# k ones, then zeros: the U32 literal 4095 is U32{maskw(32n, 12n)}.
def maskw(n: Nat, k: Nat) -> Word(n):
  match n:
    case 0n:
      WNil{}
    case 1n+p:
      match k:
        case 0n:
          WCon{False{}, maskw(p, 0n)}
        case 1n+q:
          WCon{True{}, maskw(p, q)}

# k-fold right shift at width 32, innermost first (U32.shrn is outermost first).
def shrw(k: Nat, w: Word(32n)) -> Word(32n):
  match k:
    case 0n:
      w
    case 1n+p:
      Word.shr(32n, shrw(p, w))

def shrw_in(k: Nat, w: Word(32n)) -> Word(32n):
  match k:
    case 0n:
      w
    case 1n+p:
      shrw_in(p, Word.shr(32n, w))

def loww_zero(+n: Nat, w: Word(n)) -> {0n == loww(n, 0n, w) : Nat}:
  match n:
    case 0n:
      {==}
    case 1n+p:
      {==}

def mask_value(+n: Nat, +k: Nat, w: Word(n)) -> {loww(n, k, w) == Word.to_nat(n, Word.and(n, w, maskw(n, k))) : Nat}:
  match n:
    case 0n:
      match w:
        case WNil{}:
          {==}
    case 1n+p:
      match k:
        case 0n:
          match w:
            case WCon{True{}, +t}:
              %mask_value(p, 0n, t) : {0n == Nat.double(_) : Nat}
              %loww_zero(p, t) : {0n == Nat.double(_) : Nat}
              {==}
            case WCon{False{}, +t}:
              %mask_value(p, 0n, t) : {0n == Nat.double(_) : Nat}
              %loww_zero(p, t) : {0n == Nat.double(_) : Nat}
              {==}
        case 1n+q:
          match w:
            case WCon{True{}, +t}:
              %mask_value(p, q, t) : {1n+Nat.double(loww(p, q, t)) == 1n+Nat.double(_) : Nat}
              {==}
            case WCon{False{}, +t}:
              %mask_value(p, q, t) : {Nat.double(loww(p, q, t)) == Nat.double(_) : Nat}
              {==}

# The value of a word is its low bit plus twice the rest.
def bit_word(-p: Nat, b: Bool, -t: Word(p)) -> {Nat.add(A.bit(b), Nat.double(Word.to_nat(p, t))) == Word.to_nat(1n+p, WCon{b, t}) : Nat}:
  match b:
    case True{}:
      {==}
    case False{}:
      {==}

# low_k(w) + 2^k * high_k(w) == w
def split_value(+n: Nat, +k: Nat, w: Word(n)) ->
  {Nat.add(loww(n, k, w), Nat.mul(dropw(n, k, w), A.pow2(k))) == Word.to_nat(n, w) : Nat}:
  match n:
    case 0n:
      match w:
        case WNil{}:
          {==}
    case 1n+p:
      match k:
        case 0n:
          Equal.sym(Nat, Word.to_nat(1n+p, w), Nat.mul(Word.to_nat(1n+p, w), 1n), N.mul_one_r(Word.to_nat(1n+p, w)))
        case 1n+q:
          match w:
            case WCon{+b, +t}:
              +l = loww(p, q, t)
              +d = dropw(p, q, t)
              +pq = A.pow2(q)
              -rhs = Word.to_nat(1n+p, WCon{b, t})
              %N.mul_double_r(d, pq) : {Nat.add(Nat.add(A.bit(b), Nat.double(l)), _) == rhs : Nat}
              %N.assoc_r(A.bit(b), Nat.double(l), Nat.double(Nat.mul(d, pq))) : {_ == rhs : Nat}
              %N.double_fold(l, Nat.mul(d, pq)) : {Nat.add(A.bit(b), _) == rhs : Nat}
              %Equal.sym(Nat, Nat.add(l, Nat.mul(d, pq)), Word.to_nat(p, t), split_value(p, q, t)) : {Nat.add(A.bit(b), Nat.double(_)) == rhs : Nat}
              bit_word(p, b, t)

# Padding a zero on top (what Word.shr does) keeps the value.
def pad_value(+p: Nat, t: Word(p)) -> {Word.to_nat(p, t) == Word.to_nat(1n+p, Word.shr.pad(p, t)) : Nat}:
  match p:
    case 0n:
      match t:
        case WNil{}:
          {==}
    case 1n+q:
      match t:
        case WCon{True{}, +u}:
          %pad_value(q, u) : {1n+Nat.double(Word.to_nat(q, u)) == 1n+Nat.double(_) : Nat}
          {==}
        case WCon{False{}, +u}:
          %pad_value(q, u) : {Nat.double(Word.to_nat(q, u)) == Nat.double(_) : Nat}
          {==}

def dropw_pad(+p: Nat, +k: Nat, t: Word(p)) -> {dropw(p, k, t) == dropw(1n+p, k, Word.shr.pad(p, t)) : Nat}:
  match p:
    case 0n:
      match k t:
        case 0n WNil{}:
          {==}
        case 1n+j WNil{}:
          {==}
    case 1n+q:
      match k t:
        case 0n WCon{True{}, +u}:
          %pad_value(q, u) : {1n+Nat.double(Word.to_nat(q, u)) == 1n+Nat.double(_) : Nat}
          {==}
        case 0n WCon{False{}, +u}:
          %pad_value(q, u) : {Nat.double(Word.to_nat(q, u)) == Nat.double(_) : Nat}
          {==}
        case 1n+j WCon{b, +u}:
          dropw_pad(q, j, u)

# Shifting right by one moves the drop point down by one.
def shr_drop(+p: Nat, +k: Nat, w: Word(1n+p)) -> {dropw(1n+p, 1n+k, w) == dropw(1n+p, k, Word.shr(1n+p, w)) : Nat}:
  match w:
    case WCon{b, +t}:
      dropw_pad(p, k, t)

def shrw_in_drop(+k: Nat, +w: Word(32n)) -> {dropw(32n, k, w) == Word.to_nat(32n, shrw_in(k, w)) : Nat}:
  match k:
    case 0n:
      {==}
    case 1n+j:
      %shrw_in_drop(j, Word.shr(32n, w)) : {dropw(32n, 1n+j, w) == _ : Nat}
      shr_drop(31n, j, w)

def shr_commute(+k: Nat, +w: Word(32n)) -> {shrw_in(k, Word.shr(32n, w)) == Word.shr(32n, shrw_in(k, w)) : Word(32n)}:
  match k:
    case 0n:
      {==}
    case 1n+j:
      shr_commute(j, Word.shr(32n, w))

def shrw_same(+k: Nat, +w: Word(32n)) -> {shrw_in(k, w) == shrw(k, w) : Word(32n)}:
  match k:
    case 0n:
      {==}
    case 1n+j:
      %shrw_same(j, w) : {shrw_in(1n+j, w) == Word.shr(32n, _) : Word(32n)}
      shr_commute(j, w)

def shrn_word(+k: Nat, +w: Word(32n)) -> {U32{shrw(k, w)} == U32.shrn(U32{w}, k) : U32}:
  match k:
    case 0n:
      {==}
    case 1n+j:
      %shrn_word(j, w) : {U32{shrw(1n+j, w)} == U32.shr(_) : U32}
      {==}

# The limb split, for every U32 s:  to_nat(s & 4095) + to_nat(s >> 12) * 4096 == to_nat(s)
def limb_split(s: U32) ->
  {Nat.add(U32.to_nat(U32.and(s, 4095)), Nat.mul(U32.to_nat(U32.shrn(s, 12n)), A.pow2(12n))) == U32.to_nat(s) : Nat}:
  match s:
    case U32{+w}:
      -hi = Nat.mul(U32.to_nat(U32.shrn(U32{w}, 12n)), A.pow2(12n))
      %mask_value(32n, 12n, w) : {Nat.add(_, hi) == Word.to_nat(32n, w) : Nat}
      %shrn_word(12n, w) : {Nat.add(loww(32n, 12n, w), Nat.mul(U32.to_nat(_), A.pow2(12n))) == Word.to_nat(32n, w) : Nat}
      %shrw_same(12n, w) : {Nat.add(loww(32n, 12n, w), Nat.mul(Word.to_nat(32n, _), A.pow2(12n))) == Word.to_nat(32n, w) : Nat}
      %shrw_in_drop(12n, w) : {Nat.add(loww(32n, 12n, w), Nat.mul(_, A.pow2(12n))) == Word.to_nat(32n, w) : Nat}
      split_value(32n, 12n, w)
