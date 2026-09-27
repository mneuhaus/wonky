import Base

# Parallel merge sort for the exact-plane prototype: the list is dealt into
# two halves (alternating, so both halves have equal length), each half is
# sorted in its own task, and the two runs are merged. Depth d gives 2^d
# leaf sorts (Base's List.sort, a stable bottom-up merge sort). The result is
# the same sorted list on every target and thread count (a total order `le`
# gives a unique sorted sequence up to equal elements; callers only rely on
# the order of their keys).

def deal(-A: Data, xs: List<&2, A>, a: List<&2, A>, b: List<&2, A>) -> List<&2, A> & List<&2, A>:
  match xs:
    case Nil{}:
      (a, b)
    case x <> Nil{}:
      (x <> a, b)
    case x <> y <> t:
      deal(A, t, x <> a, y <> b)

# Tail-recursive length (Base List.length recurses non-tail, which overflows
# the stack of the JS target on long lists).
def len(-A: Data, xs: List<&2, A>, acc: Nat) -> Nat:
  match xs:
    case Nil{}:
      acc
    case _ <> t:
      len(A, t, 1n+acc)

def merge(~A: Data, ~le: A -> A -> Bool, +x: List<&2, A>, +y: List<&2, A>) -> List<&2, A>:
  List.merge.go(~A, ~le, Nat.add(len(A, x, 0n), len(A, y, 0n)), (Nil{}, x, y))

def psort.k(~A: Data, ~le: A -> A -> Bool, d: Nat, h: List<&2, A> & List<&2, A>) -> List<&2, A>:
  match d:
    case 0n:
      (a, b) = h
      List.sort(~A, ~le, List.append(&2, A, a, b))
    case 1n+(+e):
      (a, b) = h
      x y = psort.k(~A, ~le, e, deal(A, a, Nil{}, Nil{})) psort.k(~A, ~le, e, deal(A, b, Nil{}, Nil{}))
      merge(~A, ~le, x, y)

# Sort with about 2^12 elements per leaf task and at most 2^6 leaf tasks.
def depth_for(+n: U32) -> Nat:
  +m = (n >> 12n : U32)
  U32.to_nat(U32.min(Bool.pick(U32, U32.is_eq(m, 0), 0, (U32.from_nat(U32.log2(m)) + 1 : U32)), 6))

def psort(~A: Data, ~le: A -> A -> Bool, +xs: List<&2, A>) -> List<&2, A>:
  psort.k(~A, ~le, depth_for(U32.from_nat(len(A, xs, 0n))), deal(A, xs, Nil{}, Nil{}))
