import Base
import ../vendor/bend-collections/src/containers/dynamic_array.bend as D
import ../vendor/bend-collections/src/containers/types/dynamic_array.bend as DE

# Dense vector indexed by U32 ids (vertex, edge, face indexes), over the
# vendored packed dynamic array (docs/collections.md). It replaces
# List.get(xs, U32.to_nat(id)) scans: get and set are one indexed slot access
# natively, push is amortized O(1), from_list and to_list are O(n).
#
# Ids are positions: the element pushed k-th has id k. Order is never
# rearranged, so to_list(from_list(xs)) = xs.
#
# Every operation hands the vector back (it owns a Base.Array). Reads of an id
# outside [0, length) do not fail: get answers the caller's fallback, find
# answers None, exactly as List.get does on a list. Writes that cannot happen
# report False and leave the vector unchanged: set outside [0, length), and
# push once the vector holds 2^31 elements (the vendored capacity limit).

type IdVec<-T: Data> is Type:
  IV{items: D.DynArray<&2, T>}

def new(-T: Data) -> IdVec<T>:
  IV{D.new(T)}

def length_done(-T: Data, r: D.DynArray<&2, T> & Nat) -> IdVec<T> & U32:
  (da, n) = r
  (IV{da}, U32.from_nat(n))

def length(-T: Data, v: IdVec<T>) -> IdVec<T> & U32:
  IV{da} = v
  length_done(T, D.length(T, da))

def unit_done(-T: Data, r: D.DynArray<&2, T> & Result<&2, &2, DE.Error, Unit>) -> IdVec<T> & Bool:
  match r:
    case Tuple{da, Done{_}}:
      (IV{da}, True{})
    case Tuple{da, Fail{_}}:
      (IV{da}, False{})

# Appends x under id = the old length. False only past the capacity limit.
def push(-T: Data, v: IdVec<T>, x: T) -> IdVec<T> & Bool:
  IV{da} = v
  unit_done(T, D.push(T, da, x))

# Overwrites the element at id. False (and no change) when id >= length.
def set(-T: Data, v: IdVec<T>, id: U32, x: T) -> IdVec<T> & Bool:
  IV{da} = v
  unit_done(T, D.set(T, da, U32.to_nat(id), x))

def get_done(-T: Data, r: D.DynArray<&2, T> & Result<&2, &2, DE.Error, T>, fallback: T) -> IdVec<T> & T:
  match r:
    case Tuple{da, Done{x}}:
      (IV{da}, x)
    case Tuple{da, Fail{_}}:
      (IV{da}, fallback)

# The element at id, or fallback when id >= length.
def get(-T: Data, v: IdVec<T>, id: U32, fallback: T) -> IdVec<T> & T:
  IV{da} = v
  get_done(T, D.get(T, da, U32.to_nat(id)), fallback)

def find_done(-T: Data, r: D.DynArray<&2, T> & Result<&2, &2, DE.Error, T>) -> IdVec<T> & Maybe<&2, T>:
  match r:
    case Tuple{da, Done{x}}:
      (IV{da}, Some{x})
    case Tuple{da, Fail{_}}:
      (IV{da}, None{})

# Some(element at id), or None when id >= length.
def find(-T: Data, v: IdVec<T>, id: U32) -> IdVec<T> & Maybe<&2, T>:
  IV{da} = v
  find_done(T, D.get(T, da, U32.to_nat(id)))

def list_done(-T: Data, r: D.DynArray<&2, T> & List<&2, T>) -> IdVec<T> & List<&2, T>:
  (da, xs) = r
  (IV{da}, xs)

# The elements in id order.
def to_list(-T: Data, v: IdVec<T>) -> IdVec<T> & List<&2, T>:
  IV{da} = v
  list_done(T, D.to_list(T, da))

# r is the answer of the previous push; ok accumulates every push flag.
def fill(-T: Data, xs: List<&2, T>, r: IdVec<T> & Bool, ok: Bool) -> IdVec<T> & Bool:
  match xs r:
    case x <> tail Tuple{v, pushed}:
      fill(T, tail, push(T, v, x), Bool.and(ok, pushed))
    case Nil{} Tuple{v, pushed}:
      (v, Bool.and(ok, pushed))

# xs[k] under id k. False when xs exceeds the capacity limit.
def from_list(-T: Data, xs: List<&2, T>) -> IdVec<T> & Bool:
  fill(T, xs, (new(T), True{}), True{})

def repeat(-T: Data, n: Nat, +x: T, r: IdVec<T> & Bool, ok: Bool) -> IdVec<T> & Bool:
  match n r:
    case 1n+p Tuple{v, pushed}:
      repeat(T, p, x, push(T, v, x), Bool.and(ok, pushed))
    case 0n Tuple{v, pushed}:
      (v, Bool.and(ok, pushed))

# n copies of x (ids 0 .. n-1), e.g. per-edge counters or per-face labels.
def filled(-T: Data, n: U32, +x: T) -> IdVec<T> & Bool:
  repeat(T, U32.to_nat(n), x, (new(T), True{}), True{})
