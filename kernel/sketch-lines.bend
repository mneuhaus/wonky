import Base
import ./real.bend as R
import ./precise.bend as G
import ./geometry.bend as Q
import ./intersections.bend as I

# Exact represented endpoint identity precedes all numeric resolution checks.
# The remainder retains bits lost by the host's F32x2 serialization; it is never
# a welding tolerance or a displacement applied to the profile geometry.
# SourcePoint stores the original SI binary64 words before conversion to mm.
type SourcePoint is Data:
  SourcePoint{x_high: U32, x_low: U32, y_high: U32, y_low: U32}

type Point is Data:
  Point{value: G.Vec3, remainder: G.Vec3, source: SourcePoint}

type Segment is Data:
  Segment{index: U32, start: Point, end: Point}

type Use is Data:
  Use{segment: Segment, forward: Bool}

type Reason is Data:
  SegmentCount{}
  InvalidPoint{segment: U32}
  DuplicateId{segment: U32}
  DuplicateSegment{first: U32, second: U32}
  DegenerateSegment{segment: U32}
  OpenEndpoint{point: Point, degree: U32}
  BranchEndpoint{point: Point, degree: U32}
  MultipleRegions{}
  WalkLimit{}
  ShortEdge{segment: U32}
  CollinearCorner{segment: U32}
  SelfIntersectionOrTouch{first: U32, second: U32}
  UnresolvedArea{}
  QuantizationCollapse{first: U32, second: U32}
  QuantizationOrientation{}

type SolveResult is Data:
  Solved{points: List<&2, Q.Vec3>, uses: List<&2, Use>, source: List<&2, Segment>, area: R.Real, source_area: R.Real, quantization_error: R.Real, linear_resolution: R.Real}
  Rejected{reason: Reason}

type Take is Data:
  Taken{use: Use, rest: List<&2, Segment>}
  Missing{}

type Walk is Data:
  Walked{uses: List<&2, Use>, rest: List<&2, Segment>}
  BadWalk{reason: Reason}

def zero() -> R.Real:
  R.from_f32(0.0)

def x(point: G.Vec3) -> R.Real:
  G.V3{x, _, _} = point
  x

def y(point: G.Vec3) -> R.Real:
  G.V3{_, y, _} = point
  y

def z(point: G.Vec3) -> R.Real:
  G.V3{_, _, z} = point
  z

def value(point: Point) -> G.Vec3:
  Point{value, _, _} = point
  value

def remainder(point: Point) -> G.Vec3:
  Point{_, remainder, _} = point
  remainder

def source(point: Point) -> SourcePoint:
  Point{_, _, source} = point
  source

def source_coordinate_equal(+ah: U32, +al: U32, +bh: U32, +bl: U32) -> Bool:
  words = Bool.and(U32.is_eq(ah, bh), U32.is_eq(al, bl))
  a_zero = Bool.and(U32.is_eq(U32.and(ah, 2147483647), 0), U32.is_eq(al, 0))
  b_zero = Bool.and(U32.is_eq(U32.and(bh, 2147483647), 0), U32.is_eq(bl, 0))
  Bool.or(words, Bool.and(a_zero, b_zero))

def source_equal(a: SourcePoint, b: SourcePoint) -> Bool:
  SourcePoint{axh, axl, ayh, ayl} = a
  SourcePoint{bxh, bxl, byh, byl} = b
  Bool.and(source_coordinate_equal(axh, axl, bxh, bxl), source_coordinate_equal(ayh, ayl, byh, byl))

def source_coordinate_valid(high: U32, low: U32) -> Bool:
  +magnitude = U32.and(high, 2147483647)
  # IEEE binary64 magnitudes are ordered lexically; 10 m is 0x40240000:0.
  # This also rejects every infinity and NaN encoding.
  Bool.or(U32.is_lt(magnitude, 1076101120), Bool.and(U32.is_eq(magnitude, 1076101120), U32.is_eq(low, 0)))

def source_valid(source: SourcePoint) -> Bool:
  SourcePoint{xh, xl, yh, yl} = source
  Bool.and(source_coordinate_valid(xh, xl), source_coordinate_valid(yh, yl))

def vec_equal(a: G.Vec3, b: G.Vec3) -> Bool:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  Bool.and(R.equal(ax, bx), Bool.and(R.equal(ay, by), R.equal(az, bz)))

def point_equal(a: Point, b: Point) -> Bool:
  Point{av, ar, a_source} = a
  Point{bv, br, b_source} = b
  Bool.and(source_equal(a_source, b_source), Bool.and(vec_equal(av, bv), vec_equal(ar, br)))

def coordinate_less(+a: R.Real, ar: R.Real, +b: R.Real, br: R.Real) -> Bool:
  Bool.or(R.less(a, b), Bool.and(R.equal(a, b), R.less(ar, br)))

def point_less(+a: Point, +b: Point) -> Bool:
  +av = value(a)
  +ar = remainder(a)
  +bv = value(b)
  +br = remainder(b)
  same_x = Bool.and(R.equal(x(av), x(bv)), R.equal(x(ar), x(br)))
  Bool.or(coordinate_less(x(av), x(ar), x(bv), x(br)), Bool.and(same_x, coordinate_less(y(av), y(ar), y(bv), y(br))))

def coordinate_valid(+v: R.Real, +r: R.Real) -> Bool:
  +limit = R.from_f32(10000.0)
  words = Bool.and(I.scalar_valid(v), I.scalar_valid(r))
  residual = R.equal(R.add(v, r), v)
  range = Bool.and(Bool.not(coordinate_less(limit, zero(), v, r)), Bool.not(coordinate_less(v, r, R.neg(limit), zero())))
  Bool.and(words, Bool.and(residual, range))

def point_valid(+point: Point) -> Bool:
  +v = value(point)
  +r = remainder(point)
  xy = Bool.and(coordinate_valid(x(v), x(r)), coordinate_valid(y(v), y(r)))
  planar = Bool.and(R.equal(z(v), zero()), Bool.and(I.scalar_valid(z(v)), Bool.and(R.equal(z(r), zero()), I.scalar_valid(z(r)))))
  Bool.and(source_valid(source(point)), Bool.and(xy, planar))

def segment_index(segment: Segment) -> U32:
  Segment{index, _, _} = segment
  index

def segment_start(segment: Segment) -> Point:
  Segment{_, start, _} = segment
  start

def segment_end(segment: Segment) -> Point:
  Segment{_, _, end} = segment
  end

def segment_equal(+a: Segment, +b: Segment) -> Bool:
  Bool.or(Bool.and(point_equal(segment_start(a), segment_start(b)), point_equal(segment_end(a), segment_end(b))),
    Bool.and(point_equal(segment_start(a), segment_end(b)), point_equal(segment_end(a), segment_start(b))))

def pair_reason(+a: Segment, +b: Segment, rest: Maybe<&2, Reason>) -> Maybe<&2, Reason>:
  +same_id = U32.is_eq(segment_index(a), segment_index(b))
  Bool.pick(Maybe<&2, Reason>, same_id, Some{DuplicateId{segment_index(a)}},
    Bool.pick(Maybe<&2, Reason>, segment_equal(a, b), Some{DuplicateSegment{segment_index(a), segment_index(b)}}, rest))

def duplicate_pairs(+first: Segment, rest: List<&2, Segment>) -> Maybe<&2, Reason>:
  match rest:
    case Nil{}:
      None{}
    case head <> tail:
      pair_reason(first, head, duplicate_pairs(first, tail))

def reason_first(first: Maybe<&2, Reason>, rest: Maybe<&2, Reason>) -> Maybe<&2, Reason>:
  match first:
    case None{}:
      rest
    case Some{reason}:
      Some{reason}

def inputs_valid(segments: List<&2, Segment>) -> Maybe<&2, Reason>:
  match segments:
    case Nil{}:
      None{}
    case +head <> +tail:
      valid = Bool.and(point_valid(segment_start(head)), point_valid(segment_end(head)))
      degenerate = point_equal(segment_start(head), segment_end(head))
      Bool.pick(Maybe<&2, Reason>, valid,
        Bool.pick(Maybe<&2, Reason>, degenerate, Some{DegenerateSegment{segment_index(head)}}, reason_first(duplicate_pairs(head, tail), inputs_valid(tail))),
        Some{InvalidPoint{segment_index(head)}})

def incident(+segment: Segment, +point: Point) -> Bool:
  Bool.or(point_equal(segment_start(segment), point), point_equal(segment_end(segment), point))

def degree(segments: List<&2, Segment>, +point: Point) -> U32:
  match segments:
    case Nil{}:
      0
    case head <> tail:
      (Bool.pick(U32, incident(head, point), 1, 0) + degree(tail, point) : U32)

def degree_reason(+count: U32, +point: Point) -> Maybe<&2, Reason>:
  Bool.pick(Maybe<&2, Reason>, U32.is_eq(count, 2), None{},
    Bool.pick(Maybe<&2, Reason>, U32.is_lt(count, 2), Some{OpenEndpoint{point, count}}, Some{BranchEndpoint{point, count}}))

def degrees(left: List<&2, Segment>, +all: List<&2, Segment>) -> Maybe<&2, Reason>:
  match left:
    case Nil{}:
      None{}
    case +head <> tail:
      first = degree_reason(degree(all, segment_start(head)), segment_start(head))
      last = degree_reason(degree(all, segment_end(head)), segment_end(head))
      reason_first(first, reason_first(last, degrees(tail, all)))

def least(segments: List<&2, Segment>, +current: Point) -> Point:
  match segments:
    case Nil{}:
      current
    case Segment{_, +first, +last} <> tail:
      +candidate = Bool.pick(Point, point_less(first, last), first, last)
      least(tail, Bool.pick(Point, point_less(candidate, current), candidate, current))

def put_back(taken: Take, segment: Segment) -> Take:
  match taken:
    case Missing{}:
      Missing{}
    case Taken{use, rest}:
      Taken{use, segment <> rest}

def take(segments: List<&2, Segment>, +point: Point) -> Take:
  match segments:
    case Nil{}:
      Missing{}
    case +head <> +tail:
      Bool.pick(Take, incident(head, point), Taken{Use{head, point_equal(segment_start(head), point)}, tail}, put_back(take(tail, point), head))

def use_start(use: Use) -> Point:
  Use{Segment{_, start, end}, forward} = use
  Bool.pick(Point, forward, start, end)

def use_end(use: Use) -> Point:
  Use{Segment{_, start, end}, forward} = use
  Bool.pick(Point, forward, end, start)

def use_index(use: Use) -> U32:
  Use{segment, _} = use
  segment_index(segment)

def walked_prepend(result: Walk, use: Use) -> Walk:
  match result:
    case BadWalk{reason}:
      BadWalk{reason}
    case Walked{uses, rest}:
      Walked{use <> uses, rest}

def taken_end(taken: Take) -> Point:
  match taken:
    case Missing{}:
      Point{G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 0.0), SourcePoint{0, 0, 0, 0}}
    case Taken{use, _}:
      use_end(use)

def taken_rest(taken: Take) -> List<&2, Segment>:
  match taken:
    case Missing{}:
      Nil{}
    case Taken{_, rest}:
      rest

def walk_taken(taken: Take, result: Walk) -> Walk:
  match taken:
    case Missing{}:
      BadWalk{WalkLimit{}}
    case Taken{use, _}:
      walked_prepend(result, use)

def walk(fuel: Nat, +segments: List<&2, Segment>, +first: Point, +current: Point) -> Walk:
  match fuel:
    case 0n:
      Bool.pick(Walk, point_equal(first, current), Walked{Nil{}, segments}, BadWalk{WalkLimit{}})
    case 1n+left:
      +taken = take(segments, current)
      result = walk(left, taken_rest(taken), first, taken_end(taken))
      Bool.pick(Walk, point_equal(first, current), Walked{Nil{}, segments}, walk_taken(taken, result))

def quantize(point: Point) -> Q.Vec3:
  Point{G.V3{x, y, _}, _, _} = point
  Q.V3{R.approx(x), R.approx(y), 0.0}

def precise_quantized(point: Q.Vec3) -> G.Vec3:
  Q.V3{x, y, z} = point
  G.v3(x, y, z)

def quantized_value(point: Point) -> G.Vec3:
  precise_quantized(quantize(point))

def evaluated(+point: Point, quantized: Bool) -> G.Vec3:
  Bool.pick(G.Vec3, quantized, quantized_value(point), value(point))

def coordinates(use: Use, quantized: Bool) -> G.Vec3:
  evaluated(use_start(use), quantized)

def points(uses: List<&2, Use>) -> List<&2, Q.Vec3>:
  match uses:
    case Nil{}:
      Nil{}
    case head <> tail:
      quantize(use_start(head)) <> points(tail)

def quantization_error(uses: List<&2, Use>) -> R.Real:
  match uses:
    case Nil{}:
      zero()
    case head <> tail:
      +point = use_start(head)
      delta = G.add(G.sub(value(point), quantized_value(point)), remainder(point))
      R.max(I.length(delta), quantization_error(tail))

def quantized_pairs(+first: Use, rest: List<&2, Use>) -> Maybe<&2, Reason>:
  match rest:
    case Nil{}:
      None{}
    case +head <> tail:
      same = vec_equal(quantized_value(use_start(first)), quantized_value(use_start(head)))
      Bool.pick(Maybe<&2, Reason>, same, Some{QuantizationCollapse{use_index(first), use_index(head)}}, quantized_pairs(first, tail))

def quantized_unique(uses: List<&2, Use>) -> Maybe<&2, Reason>:
  match uses:
    case Nil{}:
      None{}
    case head <> +tail:
      reason_first(quantized_pairs(head, tail), quantized_unique(tail))

def scale(uses: List<&2, Use>, +quantized: Bool) -> R.Real:
  match uses:
    case Nil{}:
      R.from_f32(1.0)
    case head <> tail:
      R.max(I.magnitude(coordinates(head, quantized)), scale(tail, quantized))

def epsilon(uses: List<&2, Use>, +quantized: Bool) -> R.Real:
  +size = scale(uses, quantized)
  Bool.pick(R.Real, quantized, R.max(R.from_f32(0.00001), R.mul(size, R.from_f32(0.00000095367431640625))), R.mul(size, I.angular_guard()))

def turn(a: G.Vec3, +b: G.Vec3, c: G.Vec3) -> R.Real:
  z(G.cross(G.sub(b, a), G.sub(c, b)))

def next_use(uses: List<&2, Use>, fallback: Use) -> Use:
  match uses:
    case Nil{}:
      fallback
    case head <> _:
      head

def local_reason(+use: Use, next: Use, +quantized: Bool, +eps: R.Real) -> Maybe<&2, Reason>:
  +a = coordinates(use, quantized)
  +b = evaluated(use_end(use), quantized)
  +length = I.length(G.sub(b, a))
  cross = R.abs(turn(a, b, evaluated(use_end(next), quantized)))
  Bool.pick(Maybe<&2, Reason>, I.at_most(length, eps), Some{ShortEdge{use_index(use)}},
    Bool.pick(Maybe<&2, Reason>, I.at_most(cross, R.mul(eps, length)), Some{CollinearCorner{use_index(use)}}, None{}))

def local_checks(uses: List<&2, Use>, +first: Use, +quantized: Bool, +eps: R.Real) -> Maybe<&2, Reason>:
  match uses:
    case Nil{}:
      None{}
    case head <> +tail:
      reason_first(local_reason(head, next_use(tail, first), quantized, eps), local_checks(tail, first, quantized, eps))

def coordinate_separated(+a: R.Real, +b: R.Real, +c: R.Real, +d: R.Real, +eps: R.Real) -> Bool:
  Bool.or(R.less(R.add(R.max(a, b), eps), R.min(c, d)), R.less(R.add(R.max(c, d), eps), R.min(a, b)))

def box_separated(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3, +d: G.Vec3, +eps: R.Real) -> Bool:
  Bool.or(coordinate_separated(x(a), x(b), x(c), x(d), eps), coordinate_separated(y(a), y(b), y(c), y(d), eps))

def same_side(+first: R.Real, +last: R.Real, +margin: R.Real) -> Bool:
  Bool.or(Bool.and(R.less(margin, first), R.less(margin, last)), Bool.and(R.less(first, R.neg(margin)), R.less(last, R.neg(margin))))

def side_separated(+a: G.Vec3, +b: G.Vec3, c: G.Vec3, d: G.Vec3, eps: R.Real) -> Bool:
  margin = R.mul(eps, I.length(G.sub(b, a)))
  same_side(turn(a, b, c), turn(a, b, d), margin)

def pair_clear(+first: Use, +last: Use, +quantized: Bool, +eps: R.Real) -> Bool:
  +a = coordinates(first, quantized)
  +b = evaluated(use_end(first), quantized)
  +c = coordinates(last, quantized)
  +d = evaluated(use_end(last), quantized)
  Bool.or(box_separated(a, b, c, d, eps), Bool.or(side_separated(a, b, c, d, eps), side_separated(c, d, a, b, eps)))

def geometry_pairs(+first: Use, rest: List<&2, Use>, +i: U32, +j: U32, +count: U32, +quantized: Bool, +eps: R.Real) -> Maybe<&2, Reason>:
  match rest:
    case Nil{}:
      None{}
    case +head <> tail:
      adjacent = Bool.or(U32.is_eq(j, (i + 1 : U32)), Bool.and(U32.is_eq(i, 0), U32.is_eq((j + 1 : U32), count)))
      clear = Bool.or(adjacent, pair_clear(first, head, quantized, eps))
      Bool.pick(Maybe<&2, Reason>, clear, geometry_pairs(first, tail, i, (j + 1 : U32), count, quantized, eps), Some{SelfIntersectionOrTouch{use_index(first), use_index(head)}})

def pair_checks(uses: List<&2, Use>, +i: U32, +count: U32, +quantized: Bool, +eps: R.Real) -> Maybe<&2, Reason>:
  match uses:
    case Nil{}:
      None{}
    case head <> +tail:
      reason_first(geometry_pairs(head, tail, i, (i + 1 : U32), count, quantized, eps), pair_checks(tail, (i + 1 : U32), count, quantized, eps))

def area_twice(uses: List<&2, Use>, +reference: G.Vec3, +quantized: Bool) -> R.Real:
  match uses:
    case Nil{}:
      zero()
    case +head <> tail:
      a = G.sub(coordinates(head, quantized), reference)
      b = G.sub(evaluated(use_end(head), quantized), reference)
      R.add(z(G.cross(a, b)), area_twice(tail, reference, quantized))

def perimeter(uses: List<&2, Use>, +quantized: Bool) -> R.Real:
  match uses:
    case Nil{}:
      zero()
    case +head <> tail:
      R.add(I.length(G.sub(coordinates(head, quantized), evaluated(use_end(head), quantized))), perimeter(tail, quantized))

def area(uses: List<&2, Use>, +quantized: Bool) -> R.Real:
  match uses:
    case Nil{}:
      zero()
    case +first <> tail:
      R.mul(area_twice(first <> tail, coordinates(first, quantized), quantized), R.from_f32(0.5))

def shape_checks(uses: List<&2, Use>, +quantized: Bool) -> Maybe<&2, Reason>:
  match uses:
    case Nil{}:
      Some{SegmentCount{}}
    case +first <> +tail:
      +all = {first <> tail : List<&2, Use>}
      +eps = epsilon(all, quantized)
      local = local_checks(all, first, quantized, eps)
      pairs = pair_checks(all, 0, U32.from_nat(List.length(&2, Use, all)), quantized, eps)
      enough_area = R.less(R.mul(eps, perimeter(all, quantized)), R.abs(area(all, quantized)))
      reason_first(local, reason_first(pairs, Bool.pick(Maybe<&2, Reason>, enough_area, None{}, Some{UnresolvedArea{}})))

def reverse_uses(uses: List<&2, Use>, acc: List<&2, Use>) -> List<&2, Use>:
  match uses:
    case Nil{}:
      acc
    case Use{segment, forward} <> tail:
      reverse_uses(tail, Use{segment, Bool.not(forward)} <> acc)

def finish_geometry(reason: Maybe<&2, Reason>, +uses: List<&2, Use>, source: List<&2, Segment>) -> SolveResult:
  match reason:
    case Some{reason}:
      Rejected{reason}
    case None{}:
      +signed = area(uses, True{})
      +source_area = area(uses, False{})
      same = Bool.or(Bool.and(R.less(zero(), signed), R.less(zero(), source_area)), Bool.and(R.less(signed, zero()), R.less(source_area, zero())))
      +ordered = Bool.pick(List<&2, Use>, R.less(zero(), signed), uses, reverse_uses(uses, Nil{}))
      Bool.pick(SolveResult, same, Solved{points(ordered), ordered, source, R.abs(signed), R.abs(source_area), quantization_error(ordered), epsilon(ordered, True{})}, Rejected{QuantizationOrientation{}})

def finish_walk(walk: Walk, source: List<&2, Segment>) -> SolveResult:
  match walk:
    case BadWalk{reason}:
      Rejected{reason}
    case Walked{_, _ <> _}:
      Rejected{MultipleRegions{}}
    case Walked{+uses, Nil{}}:
      checks = reason_first(shape_checks(uses, False{}), reason_first(quantized_unique(uses), shape_checks(uses, True{})))
      finish_geometry(checks, uses, source)

def solve_degrees(reason: Maybe<&2, Reason>, segments: List<&2, Segment>) -> SolveResult:
  match reason segments:
    case Some{reason} _:
      Rejected{reason}
    case None{} Nil{}:
      Rejected{SegmentCount{}}
    case None{} +head <> +tail:
      +all = {head <> tail : List<&2, Segment>}
      +first = least(all, segment_start(head))
      +taken = take(all, first)
      result = walk_taken(taken, walk(List.length(&2, Segment, all), taken_rest(taken), first, taken_end(taken)))
      finish_walk(result, all)

def solve_inputs(reason: Maybe<&2, Reason>, +segments: List<&2, Segment>) -> SolveResult:
  match reason:
    case Some{reason}:
      Rejected{reason}
    case None{}:
      solve_degrees(degrees(segments, segments), segments)

def solve_count(valid: Bool, +segments: List<&2, Segment>) -> SolveResult:
  match valid:
    case False{}:
      Rejected{SegmentCount{}}
    case True{}:
      solve_inputs(inputs_valid(segments), segments)

def solve(+segments: List<&2, Segment>) -> SolveResult:
  +count = U32.from_nat(List.length(&2, Segment, segments))
  solve_count(Bool.and(U32.is_le(3, count), U32.is_le(count, 256)), segments)
