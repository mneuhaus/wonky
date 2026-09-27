import Base
import ../vendor/bend-collections/src/containers/bitset.bend as B
import ../vendor/bend-collections/src/containers/types/bitset.bend as BE

# A set of U32 ids drawn from [0, capacity), e.g. face or edge indexes, over
# the vendored packed bitset (docs/collections.md). has/add/remove are one
# indexed word access natively; count and members walk the words, O(capacity/32).
#
# The capacity is fixed at new(n). An id outside [0, n) is never a member:
# has answers False, and add/remove report False and change nothing, so a
# caller that must not lose an id checks the flag (add_all folds the flags).
# members lists ascending ids, independent of insertion order.

type IdSet is Type:
  IS{bits: B.Bitset}

def new(n: U32) -> IdSet:
  IS{B.new(U32.to_nat(n))}

def capacity_done(r: B.Bitset & Nat) -> IdSet & U32:
  (bits, n) = r
  (IS{bits}, U32.from_nat(n))

def capacity(s: IdSet) -> IdSet & U32:
  IS{bits} = s
  capacity_done(B.length(bits))

def has_done(r: B.Bitset & Result<&2, &2, BE.Error, Bool>) -> IdSet & Bool:
  match r:
    case Tuple{bits, Done{b}}:
      (IS{bits}, b)
    case Tuple{bits, Fail{_}}:
      (IS{bits}, False{})

def has(s: IdSet, id: U32) -> IdSet & Bool:
  IS{bits} = s
  has_done(B.get(bits, U32.to_nat(id)))

def unit_done(r: B.Bitset & Result<&2, &2, BE.Error, Unit>) -> IdSet & Bool:
  match r:
    case Tuple{bits, Done{_}}:
      (IS{bits}, True{})
    case Tuple{bits, Fail{_}}:
      (IS{bits}, False{})

# Inserts id. False (no change) when id >= capacity.
def add(s: IdSet, id: U32) -> IdSet & Bool:
  IS{bits} = s
  unit_done(B.set(bits, U32.to_nat(id)))

# Removes id. False (no change) when id >= capacity.
def remove(s: IdSet, id: U32) -> IdSet & Bool:
  IS{bits} = s
  unit_done(B.clear(bits, U32.to_nat(id)))

# r is the answer of the previous add; ok accumulates every flag.
def add_go(ids: List<&2, U32>, r: IdSet & Bool, ok: Bool) -> IdSet & Bool:
  match ids r:
    case id <> tail Tuple{s, added}:
      add_go(tail, add(s, id), Bool.and(ok, added))
    case Nil{} Tuple{s, added}:
      (s, Bool.and(ok, added))

# Inserts every id. False when any id was out of range (the others are added).
def add_all(s: IdSet, ids: List<&2, U32>) -> IdSet & Bool:
  add_go(ids, (s, True{}), True{})

# Stops at the first member: r carries the answer so far.
def any_go(ids: List<&2, U32>, r: IdSet & Bool) -> IdSet & Bool:
  match ids r:
    case Nil{} Tuple{s, found}:
      (s, found)
    case _ <> _ Tuple{s, True{}}:
      (s, True{})
    case id <> tail Tuple{s, False{}}:
      any_go(tail, has(s, id))

# True when some id of the list is a member.
def has_any(s: IdSet, ids: List<&2, U32>) -> IdSet & Bool:
  any_go(ids, (s, False{}))

def count_done(r: B.Bitset & Nat) -> IdSet & U32:
  (bits, n) = r
  (IS{bits}, U32.from_nat(n))

def count(s: IdSet) -> IdSet & U32:
  IS{bits} = s
  count_done(B.count(bits))

def to_u32(xs: List<&2, Nat>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case x <> tail:
      U32.from_nat(x) <> to_u32(tail)

def members_done(r: B.Bitset & List<&2, Nat>) -> IdSet & List<&2, U32>:
  (bits, xs) = r
  (IS{bits}, to_u32(xs))

# The members in ascending order.
def members(s: IdSet) -> IdSet & List<&2, U32>:
  IS{bits} = s
  members_done(B.to_list(bits))

# n-capacity set holding the in-range ids of the list, and whether all were in range.
def from_ids(n: U32, ids: List<&2, U32>) -> IdSet & Bool:
  add_all(new(n), ids)

# Releases the word array (O(capacity/32)).
def dispose(s: IdSet) -> Unit:
  IS{bits} = s
  B.dispose(bits)
