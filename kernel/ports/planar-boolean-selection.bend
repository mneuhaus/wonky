import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../intersections.bend as I
import ../face-classification.bend as F
import ../solid-classification.bend as S
import ../halfspace.bend as H
import ./types.bend as P
import ./planar-boolean-arrangement.bend as D
import ./planar-boolean-classification.bend as K

type Selection is Data:
  Selection{polygons: List<&2, H.Polygon>, count: U32}
  Failed{reason: P.Reason, stage: U32, index: U32}
type Membership is Data:
  Membership{valid: Bool, inside: Bool}
type Boundary is Data:
  Boundary{valid: Bool, polygons: List<&2, H.Polygon>, internal: U32}
type Pairing is Data:
  Pairing{count: U32, opposite: Bool, rest: List<&2, H.Polygon>}

def membership(result: S.Classification) -> Membership:
  match result:
    case S.Inside{_}:
      Membership{True{}, True{}}
    case S.Outside{_}:
      Membership{True{}, False{}}
    case _:
      Membership{False{}, False{}}

def choose(a: Membership, b: Membership, polygons: List<&2, H.Polygon>, prior: Selection, index: U32, subtraction: Bool) -> Selection:
  match a b prior:
    case Membership{True{}, +ai} Membership{True{}, +bi} Selection{+before, count}:
      +keep = Bool.pick(Bool, subtraction, Bool.and(ai, Bool.not(bi)), Bool.or(ai, bi))
      Selection{Bool.pick(List<&2, H.Polygon>, keep, List.append(&2, H.Polygon, before, polygons), before), (count + Bool.pick(U32, keep, 1, 0) : U32)}
    case _ _ _:
      Failed{P.UnsupportedArrangement{}, 4, index}

def classify_cell(valid: Bool, polygons: List<&2, H.Polygon>, +point: G.Vec3, first: K.Prepared, second: K.Prepared, prior: Selection, index: U32, subtraction: Bool) -> Selection:
  match valid:
    case False{}:
      Failed{P.ResolutionLimit{}, 3, index}
    case True{}:
      a = membership(K.classify(first, point))
      b = membership(K.classify(second, point))
      choose(a, b, polygons, prior, index, subtraction)

def half(n: Nat) -> Nat:
  match n:
    case 0n:
      0n
    case 1n+a:
      match a:
        case 0n:
          0n
        case 1n+b:
          1n+half(b)

def merge(a: Selection, b: Selection) -> Selection:
  match a b:
    case Failed{reason, stage, bad} _:
      Failed{reason, stage, bad}
    case _ Failed{reason, stage, bad}:
      Failed{reason, stage, bad}
    case Selection{ap, ac} Selection{bp, bc}:
      Selection{List.append(&2, H.Polygon, ap, bp), (ac + bc : U32)}

def one_cell(cells: List<&2, D.Cell>, +vertices: List<&2, G.Vec3>, +first: K.Prepared, +second: K.Prepared, +resolution: R.Real, +index: U32, +subtraction: Bool) -> Selection:
  match cells:
    case Nil{}:
      Selection{Nil{}, 0}
    case D.Cell{+polygons} <> _:
      +point = D.centroid(polygons, vertices)
      positive = R.less(R.mul(resolution, R.mul(resolution, resolution)), D.cell_volume(polygons, vertices))
      valid = Bool.and(positive, D.interior(polygons, point, resolution))
      classify_cell(valid, polygons, point, first, second, Selection{Nil{}, 0}, index, subtraction)

# Every cell is classified against both operands independently of every other
# cell, so the list is halved and the two halves are evaluated side by side.
# What makes them run side by side is the simultaneous binding below, not the
# halving: Bend reduces a nested application left to right, so writing this as
# merge(select(..), select(..)) classifies one half completely before starting
# the other however the list is split. Both were measured. The accumulator fold
# this replaces, and a balanced split still written as a nested application,
# each held one planar Boolean to a single core at any thread count; the
# simultaneous binding takes planar-union from 168 to 96 ms and frame-with-tab
# from 1497 to 908 ms with a bit-identical result. It saturates at two threads,
# so only the outermost split is distributed and the depth below it is still to
# be won.
#
# Halving produces computed halves, which is not a structurally decreasing
# self-call, so the recursion is carried by fuel in the first argument the way
# cyclic and boundary below already do it. Passing the cell count as fuel is
# ample: the recursion is log2 of it deep. Polygon order, selected count and the
# lowest-index failure match the fold this replaces. Early exit is given up: a
# rejected operation now classifies every cell instead of stopping at the first.
def select_cells(fuel: Nat, +cells: List<&2, D.Cell>, +size: Nat, +vertices: List<&2, G.Vec3>, +first: K.Prepared, +second: K.Prepared, +resolution: R.Real, +index: U32, +subtraction: Bool) -> Selection:
  match fuel:
    case 0n:
      one_cell(cells, vertices, first, second, resolution, index, subtraction)
    case 1n+ +left:
      match size:
        case 0n:
          one_cell(cells, vertices, first, second, resolution, index, subtraction)
        case 1n+rest:
          match rest:
            case 0n:
              one_cell(cells, vertices, first, second, resolution, index, subtraction)
            case 1n+_:
              +low = half(size)
              lower upper = select_cells(left, List.take(&2, D.Cell, cells, low), low, vertices, first, second, resolution, index, subtraction) select_cells(left, List.drop(&2, D.Cell, cells, low), Nat.sub(size, low), vertices, first, second, resolution, (index + U32.from_nat(low) : U32), subtraction)
              merge(lower, upper)

# Both operands are prepared once for all cells (docs/collections.md, "Planar
# Boolean classification"): K.classify(K.prepare(solid, domains, tolerance, 0),
# point) is S.classify(solid, domains, point, tolerance, 0) with the
# point-independent work done once.
def select(fuel: Nat, cells: List<&2, D.Cell>, size: Nat, vertices: List<&2, G.Vec3>, first: A.Solid, ad: List<&2, F.DomainChoice>, second: A.Solid, bd: List<&2, F.DomainChoice>, +tolerance: I.Tolerance, resolution: R.Real, index: U32, subtraction: Bool) -> Selection:
  select_cells(fuel, cells, size, vertices, K.prepare(first, ad, tolerance, R.from_f32(0.0)), K.prepare(second, bd, tolerance, R.from_f32(0.0)), resolution, index, subtraction)

def ring_equal(a: List<&2, U32>, b: List<&2, U32>) -> Bool:
  match a b:
    case Nil{} Nil{}:
      True{}
    case ah <> at bh <> bt:
      Bool.and(U32.is_eq(ah, bh), ring_equal(at, bt))
    case _ _:
      False{}

def cyclic(fuel: Nat, +a: List<&2, U32>, b: List<&2, U32>) -> Bool:
  match fuel b:
    case 0n _:
      False{}
    case 1n+left +head <> +tail:
      Bool.or(ring_equal(a, head <> tail), cyclic(left, a, List.append(&2, U32, tail, [head])))
    case _ Nil{}:
      False{}

def paired(same: Bool, reverse: Bool, polygon: H.Polygon, result: Pairing) -> Pairing:
  Pairing{+count, +opposite, +rest} = result
  Bool.pick(Pairing, same, Pairing{(count + 1 : U32), Bool.and(opposite, reverse), rest}, Pairing{count, opposite, polygon <> rest})

def take_pair(polygons: List<&2, H.Polygon>, +ids: List<&2, U32>) -> Pairing:
  match polygons:
    case Nil{}:
      Pairing{0, True{}, Nil{}}
    case +polygon <> tail:
      H.Polygon{_, _, +other} = polygon
      +fuel = List.length(&2, U32, ids)
      +opposite = cyclic(fuel, ids, D.reverse(other, Nil{}))
      same = Bool.or(opposite, cyclic(fuel, ids, other))
      paired(same, opposite, polygon, take_pair(tail, ids))

def continue_boundary(valid: Bool, +keep: Bool, polygon: H.Polygon, state: Boundary) -> Boundary:
  Boundary{old_valid, +polygons, internal} = state
  Boundary{Bool.and(valid, old_valid), Bool.pick(List<&2, H.Polygon>, keep, List.append(&2, H.Polygon, polygons, [polygon]), polygons), (internal + Bool.pick(U32, keep, 0, 1) : U32)}

def apply_pair(previous: Maybe<&2, H.Polygon>, +count: U32, opposite: Bool, state: Boundary) -> Boundary:
  match previous:
    case None{}:
      state
    case Some{polygon}:
      valid = Bool.and(U32.is_lt(count, 2), opposite)
      continue_boundary(valid, U32.is_eq(count, 0), polygon, state)

def boundary(fuel: Nat, state: Boundary, pair: Pairing, previous: Maybe<&2, H.Polygon>) -> Boundary:
  match fuel state pair:
    case _ Boundary{False{}, _, _} _:
      Boundary{False{}, Nil{}, 0}
    case _ before Pairing{count, opposite, Nil{}}:
      apply_pair(previous, count, opposite, before)
    case 0n _ _:
      Boundary{False{}, Nil{}, 0}
    case 1n+left before Pairing{count, opposite, +head <> tail}:
      H.Polygon{_, _, ids} = head
      next = take_pair(tail, ids)
      boundary(left, apply_pair(previous, count, opposite, before), next, Some{head})
