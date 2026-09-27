import Base
import ./real.bend as R
import ./precise.bend as G
import ./robust-predicates.bend as P

# Profile ring simplification (corpus W2, K2): merges profile vertices that lie
# on the straight segment between their neighbours, before a prism is built.
#
# Input: the closed profile ring in sketch coordinates, one G.Vec3 per vertex
# (x and y are read; z is ignored), without a repeated closing point.
#
# Every decision is exact on the represented F32x2 words: coordinate
# differences, cross and dot products and their comparisons use the signed
# base-4096 integers of robust-predicates.bend (Big). Nothing is rounded before
# a sign is taken. Only the reported deviation (mm) is rounded: the exact value
# to F32x2 (relative error about 2^-46).
#
# tol = max(real(1e-5), 2^-20 * max |coordinate|), the F32x2 image of the
# host's tolerance(points) in src/brep.mjs.
#
# Vertex b between neighbours a and c (h = distance of b from the line a-c):
# - Short:     |c - b| <= tol. Refused (ShortEdge, edge index = index of b).
# - candidate: h <= tol and b projects strictly inside the segment a-c.
#              h = 0 exactly is an exact merge. 0 < h <= tol is a regularized
#              merge; it happens only if allow_regularized, and its deviation is
#              recorded. The merged ring differs from the source by at most tol.
# - Back:      the triangle a, b, c is thin (its smallest height is <= tol)
#              and b does not project inside a-c: the ring reverses on itself.
#              Refused (Backtracking); a backtracking corner is never merged.
# - Thin:      thin, b inside a-c, but h > tol: too flat to be a corner, too
#              far off the line to merge. Refused (Sliver).
# - Corner:    everything else. Kept.
#
# The walk starts at the first vertex that is not a merge candidate (the
# anchor, always kept). A run of candidates is merged only while every vertex
# of the run stays a candidate of the final span between the two kept vertices
# around it: deviations are reported against that span, never accumulated.
# Kept indices and merges come back in source order. A result below 3 kept
# vertices is refused.

type Merge is Data:
  Merge{index: U32, deviation: R.Real, exact: Bool}

type Reason is Data:
  VertexCount{}
  InvalidPoint{index: U32}
  ShortEdge{index: U32}
  Backtracking{index: U32}
  Sliver{index: U32}
  NoCorner{}
  TooFewCorners{}

type Ring is Data:
  Simplified{kept: List<&2, U32>, merged: List<&2, Merge>, tolerance: R.Real}
  Refused{reason: Reason}

type Class is Data:
  Short{}
  Back{}
  Thin{}
  Candidate{exact: Bool}
  Corner{}

type BP is Data:
  BP{x: P.Big, y: P.Big}

type Item is Data:
  Item{index: U32, point: G.Vec3, exact: BP, class: Class}

type D2 is Data:
  D2{x: P.Big, y: P.Big}

type Fit is Data:
  Fit{within: Bool, inside: Bool, exact: Bool}

type Walk is Data:
  Walk{kept: List<&2, U32>, merged: List<&2, Merge>}

def limit() -> U32:
  4096

# The F32x2 words nearest to 1e-5 (hi + lo differs from 1e-5 by 1.7e-21).
def floor() -> R.Real:
  R.Real{0.000009999999747378752, 0.0000000000002526212474884132}

# Every list walk below is tail recursive (a loop on the JS target), so rings
# up to limit() vertices never grow the host stack.
def magnitude(points: List<&2, G.Vec3>, +acc: R.Real) -> R.Real:
  match points:
    case Nil{}:
      acc
    case G.V3{x, y, _} <> tail:
      magnitude(tail, R.max(R.max(R.abs(x), R.abs(y)), acc))

def tolerance(points: List<&2, G.Vec3>) -> R.Real:
  R.max(floor(), R.mul(magnitude(points, R.from_f32(0.0)), R.from_f32(0.00000095367431640625)))

def bp(point: G.Vec3) -> BP:
  G.V3{x, y, _} = point
  BP{P.from_real(x), P.from_real(y)}

def delta(a: BP, b: BP) -> D2:
  BP{ax, ay} = a
  BP{bx, by} = b
  D2{P.sub(bx, ax), P.sub(by, ay)}

def cross2(u: D2, v: D2) -> P.Big:
  D2{ux, uy} = u
  D2{vx, vy} = v
  P.sub(P.mul(ux, vy), P.mul(uy, vx))

def dot2(u: D2, v: D2) -> P.Big:
  D2{ux, uy} = u
  D2{vx, vy} = v
  P.add(P.mul(ux, vx), P.mul(uy, vy))

def sign_positive(s: P.Sign) -> Bool:
  match s:
    case P.Positive{}:
      True{}
    case _:
      False{}

def sign_zero(s: P.Sign) -> Bool:
  match s:
    case P.ExactlyZero{}:
      True{}
    case _:
      False{}

def positive(a: P.Big) -> Bool:
  sign_positive(P.sign(a))

def is_zero(a: P.Big) -> Bool:
  sign_zero(P.sign(a))

# a <= b, exactly.
def at_most(a: P.Big, b: P.Big) -> Bool:
  Bool.not(positive(P.sub(a, b)))

def big_max(+a: P.Big, +b: P.Big) -> P.Big:
  Bool.pick(P.Big, positive(P.sub(a, b)), a, b)

# Every comparison below is homogeneous in the coordinates and tol (degree 2
# or 4 on both sides). Dropping the same number of low base-4096 zero digits
# from every coordinate and from tol divides all of them by the same power of
# 4096 exactly, so no decision changes; the products just get shorter.
def low_zeros(digits: List<&2, U32>, +cap: U32) -> U32:
  match digits:
    case Nil{}:
      cap
    case head <> tail:
      Bool.pick(U32, U32.is_eq(head, 0), U32.min(cap, (1 + low_zeros(tail, cap) : U32)), 0)

def big_zeros(a: P.Big, +cap: U32) -> U32:
  P.Big{_, digits} = a
  low_zeros(digits, cap)

def common_zeros(points: List<&2, BP>, +acc: U32) -> U32:
  match points:
    case Nil{}:
      acc
    case BP{x, y} <> tail:
      common_zeros(tail, U32.min(big_zeros(x, acc), big_zeros(y, acc)))

def drop(a: P.Big, +count: Nat) -> P.Big:
  P.Big{negative, digits} = a
  P.Big{negative, List.drop(&2, U32, digits, count)}

# Both reverse their input: to_bp then drop_points restores source order.
def drop_points(points: List<&2, BP>, +count: Nat, acc: List<&2, BP>) -> List<&2, BP>:
  match points:
    case Nil{}:
      acc
    case BP{x, y} <> tail:
      drop_points(tail, count, BP{drop(x, count), drop(y, count)} <> acc)

def to_bp(points: List<&2, G.Vec3>, acc: List<&2, BP>) -> List<&2, BP>:
  match points:
    case Nil{}:
      acc
    case p <> tail:
      to_bp(tail, bp(p) <> acc)

# b against the segment a-c, from the differences ab = b - a, ac = c - a,
# bc = c - b and cr = cross(ac, ab).
def fit_parts(+ab: D2, +ac: D2, +bc: D2, +cr: P.Big, +tol2: P.Big) -> Fit:
  within = at_most(P.mul(cr, cr), P.mul(tol2, dot2(ac, ac)))
  inside = Bool.and(positive(dot2(ab, ac)), positive(dot2(bc, ac)))
  Fit{within, inside, is_zero(cr)}

def fit(+a: BP, +b: BP, +c: BP, +tol2: P.Big) -> Fit:
  +ab = delta(a, b)
  +ac = delta(a, c)
  fit_parts(ab, ac, delta(b, c), cross2(ac, ab), tol2)

def classify_fit(+short: Bool, +near: Bool, f: Fit) -> Class:
  Fit{+within, +inside, exact} = f
  Bool.pick(Class, short, Short{},
    Bool.pick(Class, Bool.and(within, inside), Candidate{exact},
      Bool.pick(Class, near, Bool.pick(Class, inside, Thin{}, Back{}), Corner{})))

def classify(+a: BP, +b: BP, +c: BP, +tol2: P.Big) -> Class:
  +ab = delta(a, b)
  +ac = delta(a, c)
  +bc = delta(b, c)
  +bc2 = dot2(bc, bc)
  +cr = cross2(ac, ab)
  longest = big_max(big_max(dot2(ab, ab), bc2), dot2(ac, ac))
  near = at_most(P.mul(cr, cr), P.mul(tol2, longest))
  classify_fit(at_most(bc2, tol2), near, fit_parts(ab, ac, bc, cr, tol2))

def last(points: List<&2, BP>, +fallback: BP) -> BP:
  match points:
    case Nil{}:
      fallback
    case head <> tail:
      last(tail, head)

def next_or(rest: List<&2, BP>, +fallback: BP) -> BP:
  match rest:
    case Nil{}:
      fallback
    case head <> _:
      head

# items(rest, points, prev, first, tol2, i, acc): rest (exact, scaled) and
# points start at vertex i, prev is vertex i - 1 and first closes the ring.
# The result is in reverse order.
def items(rest: List<&2, BP>, points: List<&2, G.Vec3>, +prev: BP, +first: BP, +tol2: P.Big, +index: U32, acc: List<&2, Item>) -> List<&2, Item>:
  match rest points:
    case +b <> +tail p <> ptail:
      items(tail, ptail, b, first, tol2, (index + 1 : U32), Item{index, p, b, classify(prev, b, next_or(tail, first), tol2)} <> acc)
    case _ _:
      acc

def keep_first(found: Maybe<&2, Reason>, +bad: Bool, +index: U32) -> Maybe<&2, Reason>:
  match found:
    case Some{reason}:
      Some{reason}
    case None{}:
      Bool.pick(Maybe<&2, Reason>, bad, Some{InvalidPoint{index}}, None{})

def valid_points(points: List<&2, G.Vec3>, +index: U32, found: Maybe<&2, Reason>) -> Maybe<&2, Reason>:
  match points:
    case Nil{}:
      found
    case p <> tail:
      valid_points(tail, (index + 1 : U32), keep_first(found, Bool.not(P.vec_valid(p)), index))

def refusal(items: List<&2, Item>) -> Maybe<&2, Reason>:
  match items:
    case Nil{}:
      None{}
    case Item{index, _, _, Short{}} <> _:
      Some{ShortEdge{index}}
    case Item{index, _, _, Back{}} <> _:
      Some{Backtracking{index}}
    case Item{index, _, _, Thin{}} <> _:
      Some{Sliver{index}}
    case _ <> tail:
      refusal(tail)

def candidate(class: Class, +allow: Bool) -> Bool:
  match class:
    case Candidate{exact}:
      Bool.or(exact, allow)
    case _:
      False{}

def item_candidate(item: Item, +allow: Bool) -> Bool:
  Item{_, _, _, class} = item
  candidate(class, allow)

def item_index(item: Item) -> U32:
  Item{index, _, _, _} = item
  index

def item_point(item: Item) -> G.Vec3:
  Item{_, point, _, _} = item
  point

def item_bp(item: Item) -> BP:
  Item{_, _, exact, _} = item
  exact

def first_anchor(found: Maybe<&2, U32>, +skip: Bool, +index: U32) -> Maybe<&2, U32>:
  match found:
    case Some{k}:
      Some{k}
    case None{}:
      Bool.pick(Maybe<&2, U32>, skip, None{}, Some{index})

# The first vertex that is not a merge candidate.
def anchor(items: List<&2, Item>, +allow: Bool, found: Maybe<&2, U32>) -> Maybe<&2, U32>:
  match items:
    case Nil{}:
      found
    case +head <> tail:
      anchor(tail, allow, first_anchor(found, item_candidate(head, allow), item_index(head)))

# split(items, k, before, from): items in source order; both outputs reversed.
def split(items: List<&2, Item>, +k: U32, +before: List<&2, Item>, +from: List<&2, Item>) -> List<&2, Item> & List<&2, Item>:
  match items:
    case Nil{}:
      (before, from)
    case +head <> tail:
      +low = U32.is_lt(item_index(head), k)
      split(tail, k, Bool.pick(List<&2, Item>, low, head <> before, before), Bool.pick(List<&2, Item>, low, from, head <> from))

# The ring rotated to start at vertex k: k, ..., n - 1, 0, ..., k - 1.
def rotate(parts: List<&2, Item> & List<&2, Item>) -> List<&2, Item>:
  (before, from) = parts
  List.append(&2, Item, List.reverse(&2, Item, from), List.reverse(&2, Item, before))

def fit_ok(f: Fit) -> Bool:
  Fit{within, inside, _} = f
  Bool.and(within, inside)

def fit_exact(f: Fit) -> Bool:
  Fit{_, _, exact} = f
  exact

# Every pending vertex stays a candidate of the segment a-c.
def pending_fit(pending: List<&2, Item>, +a: BP, +c: BP, +tol2: P.Big, acc: Bool) -> Bool:
  match pending:
    case Nil{}:
      acc
    case head <> tail:
      pending_fit(tail, a, c, tol2, Bool.and(acc, fit_ok(fit(a, item_bp(head), c, tol2))))

# If b lies exactly on the segment a-c, every pending vertex that fits a-b also
# fits a-c (same line, larger segment); only an inexact b needs the rescan.
def span_rescan(rescan: Bool, pending: List<&2, Item>, +a: BP, +c: BP, +tol2: P.Big) -> Bool:
  match rescan:
    case False{}:
      True{}
    case True{}:
      pending_fit(pending, a, c, tol2, True{})

def span_fit(f: Fit, +run_exact: Bool, pending: List<&2, Item>, +a: BP, +c: BP, +allow: Bool, +tol2: P.Big) -> Fit:
  Fit{within, inside, +exact} = f
  +accepted = Bool.and(Bool.and(within, inside), Bool.or(exact, allow))
  Fit{Bool.and(accepted, span_rescan(Bool.and(accepted, Bool.not(exact)), pending, a, c, tol2)), True{}, Bool.and(run_exact, exact)}

def span_check(check: Bool, +run_exact: Bool, pending: List<&2, Item>, +a: BP, +b: BP, +c: BP, +allow: Bool, +tol2: P.Big) -> Fit:
  match check:
    case False{}:
      Fit{False{}, False{}, False{}}
    case True{}:
      span_fit(fit(a, b, c, tol2), run_exact, pending, a, c, allow, tol2)

# |a| ~ mantissa * 4096^low, from the top 5 base-4096 digits (>= 48 bits).
type Approx is Data:
  Approx{mantissa: R.Real, low: U32}

def horner(digits: List<&2, U32>, +acc: R.Real) -> R.Real:
  match digits:
    case Nil{}:
      acc
    case d <> tail:
      horner(tail, R.add(R.mul(acc, R.from_f32(4096.0)), R.from_f32(U32.to_f32(d))))

def approx(a: P.Big) -> Approx:
  P.Big{_, +digits} = a
  +count = U32.from_nat(List.length(&2, U32, digits))
  Approx{horner(List.take(&2, U32, List.reverse(&2, U32, digits), 5n), R.from_f32(0.0)), Bool.pick(U32, U32.is_lt(count, 5), 0, (count - 5 : U32))}

def pow2(n: Nat, +r: R.Real, +factor: R.Real) -> R.Real:
  match n:
    case 0n:
      r
    case 1n+p:
      pow2(p, R.mul(r, factor), factor)

def scale2(up: Bool, +ratio: R.Real, +high: U32, +low: U32) -> R.Real:
  match up:
    case True{}:
      pow2(U32.to_nat((high - low : U32)), ratio, R.from_f32(2.0))
    case False{}:
      pow2(U32.to_nat((low - high : U32)), ratio, R.from_f32(0.5))

# cross = |cross(k - a, p - a)| and square = |k - a|^2, both exact in the
# scaled integer units: a coordinate v is v * 2^(149 - 12 * scale). So
# deviation = cross / (sqrt(square) * 2^(149 - 12 * scale)).
def deviation_from(c: Approx, s: Approx, +scale: U32) -> R.Real:
  Approx{mc, kc} = c
  Approx{+ms, +ks} = s
  +odd = U32.is_eq(U32.and(ks, 1), 1)
  +half = U32.shrn(Bool.pick(U32, odd, (ks - 1 : U32), ks), 1n)
  +ratio = R.div(R.abs(mc), R.sqrt(Bool.pick(R.Real, odd, R.mul(ms, R.from_f32(4096.0)), ms)))
  +high = (12 * (kc + scale) : U32)
  +low = (12 * half + 149 : U32)
  scale2(U32.is_le(low, high), ratio, high, low)

# The recorded deviation (mm): an F32x2 rounding of the exact value, relative
# error about 2^-46. Exactly 0 when the cross product is exactly 0.
def deviation_value(exact: Bool, +cross: P.Big, +square: P.Big, +scale: U32) -> R.Real:
  match exact:
    case True{}:
      R.from_f32(0.0)
    case False{}:
      deviation_from(approx(cross), approx(square), scale)

def record(item: Item, +a: Item, +k: Item, +scale: U32) -> Merge:
  Item{index, _, pb, _} = item
  +ab = item_bp(a)
  +ak = delta(ab, item_bp(k))
  +cross = cross2(ak, delta(ab, pb))
  +exact = is_zero(cross)
  Merge{index, deviation_value(exact, cross, dot2(ak, ak), scale), exact}

# Merges are accumulated newest first. A pending run is newest first as well,
# so records reads it oldest first (reversed) and prepends.
def records_go(pending: List<&2, Item>, +a: Item, +k: Item, +scale: U32, acc: List<&2, Merge>) -> List<&2, Merge>:
  match pending:
    case Nil{}:
      acc
    case head <> tail:
      records_go(tail, a, k, scale, record(head, a, k, scale) <> acc)

def records(pending: List<&2, Item>, +a: Item, +k: Item, +scale: U32, acc: List<&2, Merge>) -> List<&2, Merge>:
  records_go(List.reverse(&2, Item, pending), a, k, scale, acc)

def close(merge: Bool, pending: List<&2, Item>, +a: Item, +b: Item, +scale: U32, merged: List<&2, Merge>) -> List<&2, Merge>:
  match merge:
    case True{}:
      merged
    case False{}:
      records(pending, a, b, scale, merged)

def finish(merge: Bool, +pending: List<&2, Item>, +a: Item, +b: Item, +anchor: Item, +scale: U32, kept: List<&2, U32>, merged: List<&2, Merge>) -> Walk:
  match merge:
    case True{}:
      Walk{kept, records(b <> pending, a, anchor, scale, merged)}
    case False{}:
      Walk{item_index(b) <> kept, records(pending, a, b, scale, merged)}

# rest: the vertices after b (the anchor closes the ring). a is the last kept
# vertex, pending the merge run between a and b (newest first).
def walk(rest: List<&2, Item>, +anchor: Item, +a: Item, +pending: List<&2, Item>, +run_exact: Bool, +b: Item, +allow: Bool, +tol2: P.Big, +scale: U32, +kept: List<&2, U32>, +merged: List<&2, Merge>) -> Walk:
  match rest:
    case Nil{}:
      finish(fit_ok(span_check(item_candidate(b, allow), run_exact, pending, item_bp(a), item_bp(b), item_bp(anchor), allow, tol2)), pending, a, b, anchor, scale, kept, merged)
    case +c <> tail:
      +span = span_check(item_candidate(b, allow), run_exact, pending, item_bp(a), item_bp(b), item_bp(c), allow, tol2)
      +merge = fit_ok(span)
      next_a = Bool.pick(Item, merge, a, b)
      next_pending = Bool.pick(List<&2, Item>, merge, b <> pending, Nil{})
      next_exact = Bool.pick(Bool, merge, fit_exact(span), True{})
      next_kept = Bool.pick(List<&2, U32>, merge, kept, item_index(b) <> kept)
      next_merged = close(merge, pending, a, b, scale, merged)
      walk(tail, anchor, next_a, next_pending, next_exact, c, allow, tol2, scale, next_kept, next_merged)

def merge_index(m: Merge) -> U32:
  Merge{index, _, _} = m
  index

# Newest-first walk output (anchor, ..., n - 1, 0, ..., anchor - 1 reversed).
# The scan meets the wrapped part (indices below k) first; split_* return
# (wrapped, rest) each in source order.
def split_merges(merged: List<&2, Merge>, +k: U32, +low: List<&2, Merge>, +high: List<&2, Merge>) -> List<&2, Merge>:
  match merged:
    case Nil{}:
      List.append(&2, Merge, low, high)
    case +head <> tail:
      +below = U32.is_lt(merge_index(head), k)
      split_merges(tail, k, Bool.pick(List<&2, Merge>, below, head <> low, low), Bool.pick(List<&2, Merge>, below, high, head <> high))

def split_indices(kept: List<&2, U32>, +k: U32, +low: List<&2, U32>, +high: List<&2, U32>) -> List<&2, U32>:
  match kept:
    case Nil{}:
      List.append(&2, U32, low, high)
    case +head <> tail:
      +below = U32.is_lt(head, k)
      split_indices(tail, k, Bool.pick(List<&2, U32>, below, head <> low, low), Bool.pick(List<&2, U32>, below, high, head <> high))

# kept and merged are newest first: prepending while scanning them restores
# the walk order within each part, and the wrapped part goes first.
def ordered(w: Walk, +k: U32, +tol: R.Real) -> Ring:
  Walk{kept, merged} = w
  +source = split_indices(kept, k, Nil{}, Nil{})
  Bool.pick(Ring, U32.is_lt(U32.from_nat(List.length(&2, U32, source)), 3), Refused{TooFewCorners{}},
    Simplified{source, split_merges(merged, k, Nil{}, Nil{}), tol})

def rotated_walk(rotated: List<&2, Item>, +allow: Bool, +tol2: P.Big, +scale: U32) -> Walk:
  match rotated:
    case +first <> +b <> tail:
      walk(tail, first, first, Nil{}, True{}, b, allow, tol2, scale, [item_index(first)], Nil{})
    case _:
      Walk{Nil{}, Nil{}}

def from_anchor(found: Maybe<&2, U32>, +all: List<&2, Item>, +allow: Bool, +tol2: P.Big, +scale: U32, +tol: R.Real) -> Ring:
  match found:
    case None{}:
      Refused{NoCorner{}}
    case Some{+k}:
      ordered(rotated_walk(rotate(split(all, k, Nil{}, Nil{})), allow, tol2, scale), k, tol)

def from_items(reason: Maybe<&2, Reason>, +all: List<&2, Item>, +allow: Bool, +tol2: P.Big, +scale: U32, +tol: R.Real) -> Ring:
  match reason:
    case Some{reason}:
      Refused{reason}
    case None{}:
      from_anchor(anchor(all, allow, None{}), all, allow, tol2, scale, tol)

def from_points(reason: Maybe<&2, Reason>, +points: List<&2, G.Vec3>, +allow: Bool) -> Ring:
  match reason:
    case Some{reason}:
      Refused{reason}
    case None{}:
      +tol = tolerance(points)
      +raw_tol = P.from_real(tol)
      +raw = to_bp(points, Nil{})
      # 4096 digits of 12 bits exceed any F32 exponent range: the cap is inert.
      +scale = common_zeros(raw, big_zeros(raw_tol, 4096))
      +count = U32.to_nat(scale)
      +tol_big = drop(raw_tol, count)
      +tol2 = P.mul(tol_big, tol_big)
      +exact = drop_points(raw, count, Nil{})
      +origin = {BP{P.zero(), P.zero()} : BP}
      +all = List.reverse(&2, Item, items(exact, points, last(exact, origin), next_or(exact, origin), tol2, 0, Nil{}))
      from_items(refusal(all), all, allow, tol2, scale, tol)

def within_limit(+count: U32) -> Bool:
  Bool.and(U32.is_le(3, count), U32.is_le(count, limit()))

def simplify_count(valid: Bool, +points: List<&2, G.Vec3>, +allow: Bool) -> Ring:
  match valid:
    case False{}:
      Refused{VertexCount{}}
    case True{}:
      from_points(valid_points(points, 0, None{}), points, allow)

# allow_regularized: False merges only exactly collinear vertices (deviation 0);
# near-collinear candidates are then kept and left to the caller's refusal.
def simplify(+points: List<&2, G.Vec3>, +allow_regularized: Bool) -> Ring:
  simplify_count(within_limit(U32.from_nat(List.length(&2, G.Vec3, points))), points, allow_regularized)
