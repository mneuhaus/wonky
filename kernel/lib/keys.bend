import Base

# Ordered keys for the vendored tree map (docs/collections.md). The tree map
# (vendor/bend-collections/src/containers/balanced_search_tree.bend) takes
# any Data key with a comparator template, so it needs no adapter, only keys:
#
#   U32 ids            TreeMap<U32, V, U32.cmp>
#   edge pairs         TreeMap<IdPair, V, pair_cmp>   edge(a, b) = edge(b, a)
#   Vec3 / grid cells  TreeMap<Key3, V, key3_cmp>
#
# e.g. TM.put(~K.IdPair, ~U32, ~K.pair_cmp, m, K.edge(a, b), id). Iteration
# (first_key, higher_key, ...) is in comparator order, which for these keys is
# lexicographic on the U32 words.
#
# Vec3 keys are exact: vec3_key keeps the full F32 bits of every coordinate,
# so two points share a key only when they are bit-identical (-0.0 and 0.0
# differ, as does every NaN payload). Tolerance-based identity (points within
# a resolution) is not a key property; a caller that quantizes to grid cells
# builds Key3 from its own cell indexes and must still compare neighbouring
# cells to stay equivalent to a pairwise distance test.

# Lexicographic tie-break: the first difference decides.
def then(first: Cmp, next: Cmp) -> Cmp:
  match first:
    case EQ{}:
      next
    case LT{}:
      LT{}
    case GT{}:
      GT{}

type IdPair is Data:
  P{a: U32, b: U32}

def pair_cmp(x: IdPair, y: IdPair) -> Cmp:
  P{xa, xb} = x
  P{ya, yb} = y
  then(U32.cmp(xa, ya), U32.cmp(xb, yb))

# Undirected edge key: the smaller vertex id first.
def ordered(ascending: Bool, a: U32, b: U32) -> IdPair:
  match ascending:
    case True{}:
      P{a, b}
    case False{}:
      P{b, a}

def edge(+a: U32, +b: U32) -> IdPair:
  ordered(U32.is_le(a, b), a, b)

type Key3 is Data:
  K3{x: U32, y: U32, z: U32}

def key3_cmp(p: Key3, q: Key3) -> Cmp:
  K3{px, py, pz} = p
  K3{qx, qy, qz} = q
  then(U32.cmp(px, qx), then(U32.cmp(py, qy), U32.cmp(pz, qz)))

# Order-preserving U32 image of an F32: for non-NaN a, b with a < b,
# f32_order(a) < f32_order(b); -0.0 sorts just below 0.0; injective on bits.
def order_bits(negative: Bool, bits: U32) -> U32:
  match negative:
    case True{}:
      U32.not(bits)
    case False{}:
      U32.or(bits, 2147483648)

def f32_order(x: F32) -> U32:
  +bits = F32.bits(x)
  order_bits(U32.is_ge(bits, 2147483648), bits)

# Exact key of a point (x, y, z): ordered by x, then y, then z.
def vec3_key(x: F32, y: F32, z: F32) -> Key3:
  K3{f32_order(x), f32_order(y), f32_order(z)}
