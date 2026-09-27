import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./topology.bend as T
import ./intersections.bend as I
import ./curve-plane.bend as C
import ./face-classification.bend as F
import ./sketch-lines.bend as L
import ./sketch-arcs-intersections.bend as P
import ./ports/curved-validate.bend as V
import ./lib/id-vec.bend as IV

# Source words are immutable. Near endpoints share a topological vertex only
# when each original endpoint has exactly one other incident entity within the
# precomputed native rounding resolution; the carrier circles are not moved.
type Entity is Data:
  Line{index: U32, start: L.Point, end: L.Point}
  Arc{index: U32, start: L.Point, mid: L.Point, end: L.Point}

type Fit is Data:
  Fit{source: Entity, curve: A.Curve, first: R.Real, last: R.Real, sense: Bool, error: R.Real}

type Use is Data:
  Use{fit: Fit, forward: Bool}

type Reason is Data:
  EntityCount{}
  InvalidPoint{entity: U32}
  DuplicateId{entity: U32}
  DegenerateEntity{entity: U32}
  UnresolvedArc{entity: U32}
  OpenEndpoint{entity: U32}
  AmbiguousEndpoint{entity: U32}
  MultipleRegions{}
  SelfIntersectionOrTouch{first: U32, second: U32}
  UnresolvedArea{}
  InvalidFrame{}
  NonNormalSweep{}
  UnresolvedDepth{}
  NativeAudit{}

type FitResult is Data:
  Fitted{fits: List<&2, Fit>}
  BadFit{reason: Reason}

type Take is Data:
  Taken{use: Use, rest: List<&2, Fit>}
  Missing{}

type Walk is Data:
  Walked{uses: List<&2, Use>}
  BadWalk{reason: Reason}

type SolveResult is Data:
  Solved{uses: List<&2, Use>, source: List<&2, Entity>, area: R.Real, resolution: R.Real, endpoint_gap: R.Real, fit_error: R.Real, source_budget: R.Real}
  Rejected{reason: Reason}

type ExtrusionResult is Data:
  Extruded{solid: A.Solid, domains: List<&2, F.DomainChoice>, profile: SolveResult, audit: V.Audit, volume: R.Real, depth: R.Real, source_budget: R.Real}
  Unsupported{reason: Reason}

def zero() -> R.Real:
  R.from_f32(0.0)

def one() -> R.Real:
  R.from_f32(1.0)

def index(entity: Entity) -> U32:
  match entity:
    case Line{index, _, _}:
      index
    case Arc{index, _, _, _}:
      index

def start(entity: Entity) -> L.Point:
  match entity:
    case Line{_, start, _}:
      start
    case Arc{_, start, _, _}:
      start

def end(entity: Entity) -> L.Point:
  match entity:
    case Line{_, _, end}:
      end
    case Arc{_, _, _, end}:
      end

def source(fit: Fit) -> Entity:
  Fit{source, _, _, _, _, _} = fit
  source

def curve(fit: Fit) -> A.Curve:
  Fit{_, curve, _, _, _, _} = fit
  curve

def fit_first(fit: Fit) -> R.Real:
  Fit{_, _, first, _, _, _} = fit
  first

def fit_last(fit: Fit) -> R.Real:
  Fit{_, _, _, last, _, _} = fit
  last

def sense(fit: Fit) -> Bool:
  Fit{_, _, _, _, sense, _} = fit
  sense

def fit_error(fit: Fit) -> R.Real:
  Fit{_, _, _, _, _, error} = fit
  error

def point_distance(+a: L.Point, +b: L.Point) -> R.Real:
  I.length(G.add(G.sub(L.value(a), L.value(b)), G.sub(L.remainder(a), L.remainder(b))))

def near(a: L.Point, b: L.Point, resolution: R.Real) -> Bool:
  I.at_most(point_distance(a, b), resolution)

def entity_scale(entity: Entity) -> R.Real:
  match entity:
    case Line{_, a, b}:
      R.max(I.magnitude(L.value(a)), I.magnitude(L.value(b)))
    case Arc{_, a, m, b}:
      R.max(I.magnitude(L.value(m)), R.max(I.magnitude(L.value(a)), I.magnitude(L.value(b))))

def input_scale(entities: List<&2, Entity>) -> R.Real:
  match entities:
    case Nil{}:
      one()
    case entity <> rest:
      R.max(entity_scale(entity), input_scale(rest))

def points_valid(entity: Entity) -> Bool:
  match entity:
    case Line{_, a, b}:
      Bool.and(L.point_valid(a), L.point_valid(b))
    case Arc{_, a, m, b}:
      Bool.and(L.point_valid(m), Bool.and(L.point_valid(a), L.point_valid(b)))

def duplicate(+id: U32, entities: List<&2, Entity>) -> Bool:
  match entities:
    case Nil{}:
      False{}
    case head <> tail:
      Bool.or(U32.is_eq(id, index(head)), duplicate(id, tail))

def prepend_fit(fit: Fit, result: FitResult) -> FitResult:
  match result:
    case BadFit{reason}:
      BadFit{reason}
    case Fitted{fits}:
      Fitted{fit <> fits}

def signed_angle(+circle: A.Curve, mid: G.Vec3, end: G.Vec3) -> R.Real:
  +m = C.canonical(A.curve_parameter(circle, mid))
  +b = C.canonical(A.curve_parameter(circle, end))
  Bool.pick(R.Real, R.less(m, b), b, R.sub(b, C.tau()))

def fit_circle(+entity: Entity, +a: G.Vec3, +m: G.Vec3, +b: G.Vec3) -> Fit:
  +u = G.sub(m, a)
  +v = G.sub(b, a)
  +det = R.mul(R.from_f32(2.0), L.z(G.cross(u, v)))
  +u2 = G.dot(u, u)
  +v2 = G.dot(v, v)
  dx = R.div(R.sub(R.mul(u2, L.y(v)), R.mul(v2, L.y(u))), det)
  dy = R.div(R.sub(R.mul(L.x(u), v2), R.mul(L.x(v), u2)), det)
  +center = G.add(a, G.V3{dx, dy, zero()})
  +radius = I.length(G.sub(a, center))
  +circle = {A.Circle{center, G.v3(0.0, 0.0, 1.0), G.normalize(G.sub(a, center)), radius} : A.Curve}
  +sweep = signed_angle(circle, m, b)
  +first = R.min(zero(), sweep)
  +last = R.max(zero(), sweep)
  +forward = R.less(zero(), sweep)
  +domain = {C.Interval{first, last} : C.Domain}
  endpoint = F.endpoint_error(domain, circle, a, b, forward)
  middle = I.length(G.sub(m, A.curve_point(circle, A.curve_parameter(circle, m))))
  Fit{entity, circle, first, last, forward, R.max(endpoint, middle)}

def fit_arc_valid(valid: Bool, +entity: Entity, +fit: Fit, resolution: R.Real, rest: FitResult) -> FitResult:
  match valid:
    case False{}:
      BadFit{UnresolvedArc{index(entity)}}
    case True{}:
      +geometry = curve(fit)
      resolved = Bool.and(C.curve_valid(geometry), Bool.and(C.domain_valid(C.Interval{fit_first(fit), fit_last(fit)}, True{}), I.at_most(fit_error(fit), resolution)))
      Bool.pick(FitResult, resolved, prepend_fit(fit, rest), BadFit{UnresolvedArc{index(entity)}})

def fit_original(fit: Fit, +original: Bool) -> Fit:
  Fit{source, curve, first, last, +sense, error} = fit
  Fit{source, curve, first, last, Bool.pick(Bool, original, sense, Bool.not(sense)), error}

def fit_line(+entity: Entity, +a: L.Point, +b: L.Point, +resolution: R.Real, rest: FitResult) -> FitResult:
  +ordered = L.point_less(a, b)
  +point = L.value(Bool.pick(L.Point, ordered, a, b))
  +last = L.value(Bool.pick(L.Point, ordered, b, a))
  +delta = G.sub(last, point)
  +length = I.length(delta)
  fit = {Fit{entity, A.Line{point, G.normalize(delta)}, zero(), length, ordered, zero()} : Fit}
  Bool.pick(FitResult, R.less(resolution, length), prepend_fit(fit, rest), BadFit{DegenerateEntity{index(entity)}})

def fit_one(+entity: Entity, +resolution: R.Real, rest: FitResult) -> FitResult:
  match entity:
    case Line{_, a, b}:
      fit_line(entity, a, b, resolution, rest)
    case Arc{_, +a, +m, +b}:
      +ordered = L.point_less(a, b)
      +p = L.value(Bool.pick(L.Point, ordered, a, b))
      +q = L.value(m)
      +r = L.value(Bool.pick(L.Point, ordered, b, a))
      +u = G.sub(q, p)
      +v = G.sub(r, p)
      +scale = R.max(I.length(u), I.length(v))
      valid = Bool.and(R.less(resolution, point_distance(a, m)), Bool.and(R.less(resolution, point_distance(m, b)), R.less(R.mul(resolution, scale), R.abs(L.z(G.cross(u, v))))))
      fit_arc_valid(valid, entity, fit_original(fit_circle(entity, p, q, r), ordered), resolution, rest)

def fit_inputs(entities: List<&2, Entity>, +resolution: R.Real) -> FitResult:
  match entities:
    case Nil{}:
      Fitted{Nil{}}
    case +head <> +tail:
      +id = index(head)
      result = fit_one(head, resolution, fit_inputs(tail, resolution))
      Bool.pick(FitResult, points_valid(head),
        Bool.pick(FitResult, duplicate(id, tail), BadFit{DuplicateId{id}},
          Bool.pick(FitResult, near(start(head), end(head), resolution), BadFit{DegenerateEntity{id}}, result)), BadFit{InvalidPoint{id}})

def incident(+entity: Entity, +point: L.Point, +resolution: R.Real) -> Bool:
  Bool.or(near(start(entity), point, resolution), near(end(entity), point, resolution))

def degree_reason(+count: U32, +id: U32) -> Maybe<&2, Reason>:
  Bool.pick(Maybe<&2, Reason>, U32.is_eq(count, 2), None{},
    Bool.pick(Maybe<&2, Reason>, U32.is_lt(count, 2), Some{OpenEndpoint{id}}, Some{AmbiguousEndpoint{id}}))

def first_reason(first: Maybe<&2, Reason>, rest: Maybe<&2, Reason>) -> Maybe<&2, Reason>:
  match first:
    case None{}:
      rest
    case Some{reason}:
      Some{reason}

def least(entities: List<&2, Entity>, +point: L.Point) -> L.Point:
  match entities:
    case Nil{}:
      point
    case +head <> tail:
      +a = start(head)
      +b = end(head)
      +candidate = Bool.pick(L.Point, L.point_less(a, b), a, b)
      least(tail, Bool.pick(L.Point, L.point_less(candidate, point), candidate, point))

def put_back(result: Take, fit: Fit) -> Take:
  match result:
    case Missing{}:
      Missing{}
    case Taken{use, rest}:
      Taken{use, fit <> rest}

def take(fits: List<&2, Fit>, +point: L.Point, +resolution: R.Real) -> Take:
  match fits:
    case Nil{}:
      Missing{}
    case +head <> +tail:
      +entity = source(head)
      Bool.pick(Take, incident(entity, point, resolution), Taken{Use{head, near(start(entity), point, resolution)}, tail}, put_back(take(tail, point, resolution), head))

def use_start(use: Use) -> L.Point:
  Use{fit, forward} = use
  +entity = source(fit)
  Bool.pick(L.Point, forward, start(entity), end(entity))

def use_end(use: Use) -> L.Point:
  Use{fit, forward} = use
  +entity = source(fit)
  Bool.pick(L.Point, forward, end(entity), start(entity))

def use_fit(use: Use) -> Fit:
  Use{fit, _} = use
  fit

def use_forward(use: Use) -> Bool:
  Use{_, forward} = use
  forward

def use_sense(use: Use) -> Bool:
  Use{fit, forward} = use
  +s = sense(fit)
  Bool.pick(Bool, forward, s, Bool.not(s))

def prepend_walk(use: Use, result: Walk) -> Walk:
  match result:
    case BadWalk{reason}:
      BadWalk{reason}
    case Walked{uses}:
      Walked{use <> uses}

def reverse(uses: List<&2, Use>, acc: List<&2, Use>) -> List<&2, Use>:
  match uses:
    case Nil{}:
      acc
    case Use{fit, forward} <> tail:
      reverse(tail, Use{fit, Bool.not(forward)} <> acc)

def area_curve(+geometry: A.Curve, +first: R.Real, +last: R.Real, +sign: R.Real) -> R.Real:
  match geometry:
    case A.Line{_, _}:
      a = A.curve_point(geometry, first)
      b = A.curve_point(geometry, last)
      R.mul(sign, R.mul(L.z(G.cross(a, b)), R.from_f32(0.5)))
    case A.Circle{center, _, _, +radius}:
      a = A.curve_point(geometry, first)
      b = A.curve_point(geometry, last)
      value = R.add(L.z(G.cross(center, G.sub(b, a))), R.mul(R.mul(radius, radius), R.sub(last, first)))
      R.mul(sign, R.mul(value, R.from_f32(0.5)))
    case _:
      zero()

def area_part(+use: Use) -> R.Real:
  +fit = use_fit(use)
  sign = Bool.pick(R.Real, use_sense(use), one(), R.neg(one()))
  area_curve(curve(fit), fit_first(fit), fit_last(fit), sign)

def area(uses: List<&2, Use>) -> R.Real:
  match uses:
    case Nil{}:
      zero()
    case head <> tail:
      R.add(area_part(head), area(tail))

def max_fit_error(uses: List<&2, Use>) -> R.Real:
  match uses:
    case Nil{}:
      zero()
    case head <> tail:
      R.max(fit_error(use_fit(head)), max_fit_error(tail))

def first_point(uses: List<&2, Use>, fallback: L.Point) -> L.Point:
  match uses:
    case Nil{}:
      fallback
    case head <> _:
      use_start(head)

def endpoint_gap(uses: List<&2, Use>, +first: L.Point) -> R.Real:
  match uses:
    case Nil{}:
      zero()
    case +head <> +tail:
      R.max(point_distance(use_end(head), first_point(tail, first)), endpoint_gap(tail, first))

def entity_segment(entity: Entity, +fit: Fit) -> P.Segment:
  match entity:
    case Line{_, a, b}:
      P.line_segment(curve(fit), fit_first(fit), fit_last(fit), a, b)
    case Arc{_, a, m, b}:
      P.arc_segment(curve(fit), fit_first(fit), fit_last(fit), a, m, b)

def pair_segment(+fit: Fit) -> P.Segment:
  entity_segment(source(fit), fit)

# ---- Broad phase: sort and sweep ----------------------------------------
# Admission compares every endpoint with every endpoint and every entity with
# every entity. Sorting axis-aligned boxes by their low x and sweeping selects
# the pairs whose boxes come within a stated window; only those run the
# unchanged exact tests (near, P.clear). A skipped pair is farther apart than
# the window, which covers every neighbourhood those tests look at, so the
# selection changes no decision. Cost: O(n log n) plus the candidate pairs
# (docs/sketch-arcs.md "Admission cost").

type Payload is Data:
  AtPoint{point: L.Point}
  OnSegment{segment: P.Segment}

type Item is Data:
  Item{low: R.Real, high: R.Real, bottom: R.Real, top: R.Real, id: U32, tag: U32, payload: Payload}

type Link is Data:
  Link{first: U32, second: U32}

type Hit is Data:
  Hit{first: U32, second: U32, first_index: U32, second_index: U32}

type Box is Data:
  Box{low: R.Real, high: R.Real, bottom: R.Real, top: R.Real}

def item_low(item: Item) -> R.Real:
  Item{low, _, _, _, _, _, _} = item
  low

def item_high(item: Item) -> R.Real:
  Item{_, high, _, _, _, _, _} = item
  high

def item_bottom(item: Item) -> R.Real:
  Item{_, _, bottom, _, _, _, _} = item
  bottom

def item_top(item: Item) -> R.Real:
  Item{_, _, _, top, _, _, _} = item
  top

def item_id(item: Item) -> U32:
  Item{_, _, _, _, id, _, _} = item
  id

def item_tag(item: Item) -> U32:
  Item{_, _, _, _, _, tag, _} = item
  tag

def origin_point() -> L.Point:
  L.Point{G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 0.0), L.SourcePoint{0, 0, 0, 0}}

def item_point(item: Item) -> L.Point:
  Item{_, _, _, _, _, _, payload} = item
  match payload:
    case AtPoint{point}:
      point
    case OnSegment{_}:
      origin_point()

def item_segment(item: Item, +fallback: P.Segment) -> P.Segment:
  Item{_, _, _, _, _, _, payload} = item
  match payload:
    case AtPoint{_}:
      fallback
    case OnSegment{segment}:
      segment

# Merge sort by low x. Bend has no mutual recursion and matches only
# parameters, so the caller computes which head goes first (`right_first`) and
# each def recurses on itself. fuel and depth are the list length, which bounds
# every merge and each level strictly shortens; their 0n fallbacks never run.
def right_first(a: List<&2, Item>, b: List<&2, Item>) -> Bool:
  match a:
    case Nil{}:
      True{}
    case x <> _:
      match b:
        case Nil{}:
          False{}
        case y <> _:
          R.less(item_low(y), item_low(x))

# Tail recursive (the JS target has a bounded stack): the merged prefix is
# accumulated reversed and put back in front of the rest at the end.
def merge(fuel: Nat, pick: Bool, +a: List<&2, Item>, +b: List<&2, Item>, done: List<&2, Item>) -> List<&2, Item>:
  match fuel:
    case 0n:
      List.reverse.go(&2, Item, done, List.append(&2, Item, a, b))
    case 1n+left:
      match pick:
        case True{}:
          match b:
            case Nil{}:
              List.reverse.go(&2, Item, done, a)
            case y <> +ys:
              merge(left, right_first(a, ys), a, ys, y <> done)
        case False{}:
          match a:
            case Nil{}:
              List.reverse.go(&2, Item, done, b)
            case x <> +xs:
              merge(left, right_first(xs, b), xs, b, x <> done)

def take_items(count: Nat, xs: List<&2, Item>) -> List<&2, Item>:
  match count:
    case 0n:
      Nil{}
    case 1n+left:
      match xs:
        case Nil{}:
          Nil{}
        case x <> tail:
          x <> take_items(left, tail)

def drop_items(count: Nat, xs: List<&2, Item>) -> List<&2, Item>:
  match count:
    case 0n:
      xs
    case 1n+left:
      match xs:
        case Nil{}:
          Nil{}
        case _ <> tail:
          drop_items(left, tail)

def half(+n: Nat) -> Nat:
  U32.to_nat(U32.shr(U32.from_nat(n)))

def sort(depth: Nat, +size: Nat, xs: List<&2, Item>) -> List<&2, Item>:
  match depth:
    case 0n:
      xs
    case 1n+ +left:
      match xs:
        case Nil{}:
          Nil{}
        case x <> tail:
          match tail:
            case Nil{}:
              [x]
            case y <> rest:
              +all = {x <> y <> rest : List<&2, Item>}
              +k = half(List.length(&2, Item, all))
              +first = sort(left, size, take_items(k, all))
              +second = sort(left, size, drop_items(k, all))
              merge(size, right_first(first, second), first, second, Nil{})

def sorted(+items: List<&2, Item>) -> List<&2, Item>:
  +n = List.length(&2, Item, items)
  sort(n, n, items)

# Items carry boxes grown by half the window on every side, so two raw boxes
# within the window overlap. The x test is the sweep's stop condition (the
# caller guarantees low(a) <= low(b)); this is the y test.
def boxes_meet(+a: Item, +b: Item) -> Bool:
  Bool.and(Bool.not(R.less(item_top(a), item_bottom(b))), Bool.not(R.less(item_top(b), item_bottom(a))))

def reaches(+item: Item, rest: List<&2, Item>) -> Bool:
  match rest:
    case Nil{}:
      False{}
    case other <> _:
      Bool.not(R.less(item_high(item), item_low(other)))

# -- endpoints: every pair within resolution, as endpoint ids 2k (start), 2k+1 (end)

def point_item(+point: L.Point, +id: U32, +grow: R.Real) -> Item:
  +v = L.value(point)
  Item{R.sub(L.x(v), grow), R.add(L.x(v), grow), R.sub(L.y(v), grow), R.add(L.y(v), grow), id, id, AtPoint{point}}

def point_items(entities: List<&2, Entity>, +position: U32, +grow: R.Real) -> List<&2, Item>:
  match entities:
    case Nil{}:
      Nil{}
    case +head <> tail:
      point_item(start(head), (2 * position : U32), grow) <> point_item(end(head), (2 * position + 1 : U32), grow) <> point_items(tail, (position + 1 : U32), grow)

def remainder_scale(entities: List<&2, Entity>) -> R.Real:
  match entities:
    case Nil{}:
      zero()
    case +head <> tail:
      R.max(R.max(I.magnitude(L.remainder(start(head))), I.magnitude(L.remainder(end(head)))), remainder_scale(tail))

def point_hit(near: Bool, +a: Item, +b: Item, hits: List<&2, Link>) -> List<&2, Link>:
  match near:
    case True{}:
      Link{item_id(a), item_id(b)} <> hits
    case False{}:
      hits

# within says whether the head of rest still starts inside item's x range + window.
def point_scan(rest: List<&2, Item>, within: Bool, +item: Item, +resolution: R.Real, hits: List<&2, Link>) -> List<&2, Link>:
  match rest:
    case Nil{}:
      hits
    case +other <> +tail:
      match within:
        case False{}:
          hits
        case True{}:
          +meet = Bool.and(boxes_meet(item, other), near(item_point(item), item_point(other), resolution))
          point_scan(tail, reaches(item, tail), item, resolution, point_hit(meet, item, other, hits))

def point_sweep(items: List<&2, Item>, +resolution: R.Real, hits: List<&2, Link>) -> List<&2, Link>:
  match items:
    case Nil{}:
      hits
    case +item <> +tail:
      point_sweep(tail, resolution, point_scan(tail, reaches(item, tail), item, resolution, hits))

def counts_vec(r: IV.IdVec<U32> & Bool) -> IV.IdVec<U32>:
  (v, _) = r
  v

def bumped(r: IV.IdVec<U32> & U32, +id: U32) -> IV.IdVec<U32>:
  (v, count) = r
  counts_vec(IV.set(U32, v, id, (count + 1 : U32)))

def bump(counts: IV.IdVec<U32>, +id: U32) -> IV.IdVec<U32>:
  bumped(IV.get(U32, counts, id, 0), id)

def linked(links: IV.IdVec<U32>, +a: U32, +b: U32) -> IV.IdVec<U32>:
  counts_vec(IV.set(U32, counts_vec(IV.set(U32, links, a, b)), b, a))

# Degrees start at 1 (an endpoint is near itself, as in the pairwise count).
def tally(hits: List<&2, Link>, counts: IV.IdVec<U32>, links: IV.IdVec<U32>) -> IV.IdVec<U32> & IV.IdVec<U32>:
  match hits:
    case Nil{}:
      (counts, links)
    case Link{+a, +b} <> tail:
      tally(tail, bump(bump(counts, a), b), linked(links, a, b))

def counts_list(r: IV.IdVec<U32> & List<&2, U32>) -> List<&2, U32>:
  (_, counts) = r
  counts

# The first bad endpoint in source order (start before end), as the pairwise
# count reported it; counts holds start and end degree per entity in order.
def degree_scan(entities: List<&2, Entity>, counts: List<&2, U32>) -> Maybe<&2, Reason>:
  match entities:
    case Nil{}:
      None{}
    case +head <> tail:
      match counts:
        case Nil{}:
          None{}
        case first <> more:
          match more:
            case Nil{}:
              None{}
            case last <> rest:
              first_reason(degree_reason(first, index(head)), first_reason(degree_reason(last, index(head)), degree_scan(tail, rest)))

# -- walk: follow the unique partner of each exit endpoint

def fits_vec(r: IV.IdVec<Fit> & Bool) -> IV.IdVec<Fit>:
  (v, _) = r
  v

def position_of(entities: List<&2, Entity>, +id: U32, +position: U32) -> U32:
  match entities:
    case Nil{}:
      position
    case head <> tail:
      Bool.pick(U32, U32.is_eq(index(head), id), position, position_of(tail, id, (position + 1 : U32)))

# The walk state carries the owned vectors: the next use to take (Open) or a
# closed chain (Closed), and a taken use with its successor (Stepped).
type Next is Type:
  Open{position: U32, forward: Bool, fits: IV.IdVec<Fit>, links: IV.IdVec<U32>}
  Closed{}

type Step is Type:
  Stepped{use: Use, next: Next}
  Blocked{}

def open_next(closed: Bool, +position: U32, +forward: Bool, fits: IV.IdVec<Fit>, links: IV.IdVec<U32>) -> Next:
  match closed:
    case True{}:
      Closed{}
    case False{}:
      Open{position, forward, fits, links}

# After use, follow the partner of its exit endpoint. Reaching the first
# entity (origin) again closes the chain.
def link_step(r: IV.IdVec<U32> & U32, +use: Use, fits: IV.IdVec<Fit>, +origin: U32) -> Step:
  (links, +next) = r
  +following = U32.shr(next)
  closed = Bool.or(U32.is_eq(next, 4294967295), U32.is_eq(following, origin))
  Stepped{use, open_next(closed, following, U32.is_even(next), fits, links)}

def exit_id(+position: U32, +forward: Bool) -> U32:
  (2 * position + Bool.to_u32(forward) : U32)

def fit_step(r: IV.IdVec<Fit> & Fit, +position: U32, +forward: Bool, links: IV.IdVec<U32>, +origin: U32) -> Step:
  (fits, +fit) = r
  link_step(IV.get(U32, links, exit_id(position, forward), 4294967295), Use{fit, forward}, fits, origin)

def advance(next: Next, +origin: U32, +fallback: Fit) -> Step:
  match next:
    case Closed{}:
      Blocked{}
    case Open{+position, +forward, fits, links}:
      fit_step(IV.get(Fit, fits, position, fallback), position, forward, links, origin)

# fuel counts the uses still to take after the one in step. A chain that closes
# before all are taken is a second loop (the pairwise walk found no remaining
# incident entity there); after the last use it must be back at first.
def chain(fuel: Nat, step: Step, +origin: U32, +first: L.Point, +resolution: R.Real) -> Walk:
  match fuel step:
    case _ Blocked{}:
      BadWalk{MultipleRegions{}}
    case 0n Stepped{+use, _}:
      Bool.pick(Walk, near(first, use_end(use), resolution), Walked{[use]}, BadWalk{MultipleRegions{}})
    case 1n+left Stepped{+use, next}:
      prepend_walk(use, chain(left, advance(next, origin, use_fit(use)), origin, first, resolution))

def chain_first(count: Nat, +position: U32, +use: Use, fits: IV.IdVec<Fit>, links: IV.IdVec<U32>, +first: L.Point, +resolution: R.Real) -> Walk:
  match count:
    case 0n:
      BadWalk{MultipleRegions{}}
    case 1n+left:
      chain(left, link_step(IV.get(U32, links, exit_id(position, use_forward(use)), 4294967295), use, fits, position), position, first, resolution)

# The first use is the original first take (the earliest entity in source order
# incident to the least endpoint); every later step follows the partner map.
def chain_taken(taken: Take, count: Nat, +entities: List<&2, Entity>, fits: IV.IdVec<Fit>, links: IV.IdVec<U32>, +first: L.Point, +resolution: R.Real) -> Walk:
  match taken:
    case Missing{}:
      BadWalk{MultipleRegions{}}
    case Taken{+use, _}:
      chain_first(count, position_of(entities, index(source(use_fit(use))), 0), use, fits, links, first, resolution)

# -- pairs: the unchanged exact pair test on every pair whose padded boxes meet

def box_add(+box: Box, +point: G.Vec3) -> Box:
  Box{+low, +high, +bottom, +top} = box
  Box{R.min(low, L.x(point)), R.max(high, L.x(point)), R.min(bottom, L.y(point)), R.max(top, L.y(point))}

def box_points(points: List<&2, G.Vec3>, +box: Box) -> Box:
  match points:
    case Nil{}:
      box
    case +point <> tail:
      box_points(tail, box_add(box, point))

def extreme(+segment: P.Segment, +point: G.Vec3, +fallback: G.Vec3, +resolution: R.Real) -> G.Vec3:
  Bool.pick(G.Vec3, P.contains(segment, point, resolution), point, fallback)

# Both endpoints and both domain ends; on a circle also each axis extreme the
# finite interval contains (with resolution margin, so the box only grows).
def circle_extremes(curve: A.Curve, +segment: P.Segment, +fallback: G.Vec3, +resolution: R.Real) -> List<&2, G.Vec3>:
  match curve:
    case A.Circle{+center, _, _, +radius}:
      +z = zero()
      [extreme(segment, G.add(center, G.V3{radius, z, z}), fallback, resolution),
        extreme(segment, G.add(center, G.V3{R.neg(radius), z, z}), fallback, resolution),
        extreme(segment, G.add(center, G.V3{z, radius, z}), fallback, resolution),
        extreme(segment, G.add(center, G.V3{z, R.neg(radius), z}), fallback, resolution)]
    case _:
      Nil{}

# Both endpoints and both domain ends; on a circle also each axis extreme the
# finite interval contains (with resolution margin, so the box only grows).
def segment_points(+segment: P.Segment, +resolution: R.Real) -> List<&2, G.Vec3>:
  P.Segment{+curve, first, last, _, _, _, _} = segment
  +a = P.start(segment)
  List.append(&2, G.Vec3, [a, P.end(segment), A.curve_point(curve, first), A.curve_point(curve, last)], circle_extremes(curve, segment, a, resolution))

def boxed_item(box: Box, +segment: P.Segment, +position: U32, +tag: U32, +grow: R.Real) -> Item:
  Box{low, high, bottom, top} = box
  Item{R.sub(low, grow), R.add(high, grow), R.sub(bottom, grow), R.add(top, grow), position, tag, OnSegment{segment}}

def segment_item(+segment: P.Segment, +position: U32, +tag: U32, +resolution: R.Real, +grow: R.Real) -> Item:
  +a = P.start(segment)
  boxed_item(box_points(segment_points(segment, resolution), Box{L.x(a), L.x(a), L.y(a), L.y(a)}), segment, position, tag, grow)

def segment_items(uses: List<&2, Use>, +position: U32, +resolution: R.Real, +grow: R.Real) -> List<&2, Item>:
  match uses:
    case Nil{}:
      Nil{}
    case +head <> tail:
      +fit = use_fit(head)
      segment_item(pair_segment(fit), position, index(source(fit)), resolution, grow) <> segment_items(tail, (position + 1 : U32), resolution, grow)

def max_scale(uses: List<&2, Use>) -> R.Real:
  match uses:
    case Nil{}:
      one()
    case head <> tail:
      R.max(P.scale(curve(use_fit(head))), max_scale(tail))

# Pairs rejected by P.clear lie within 2 * resolution (a candidate point in
# both intervals), within resolution + 2 * drift (near collinear lines), or
# within 2 * 4 * sqrt(resolution * size) + resolution (tangent exclusion) of
# each other. The window is 8 * sqrt(resolution * max(1, max scale)) + 4 * resolution.
def pair_window(+uses: List<&2, Use>, +resolution: R.Real) -> R.Real:
  +exclusion = R.mul(R.from_f32(4.0), R.sqrt(R.mul(resolution, R.max(one(), max_scale(uses)))))
  R.add(R.mul(R.from_f32(2.0), exclusion), R.mul(R.from_f32(4.0), resolution))

def hit_less(+a: Hit, +b: Hit) -> Bool:
  Hit{+a_first, a_second, _, _} = a
  Hit{+b_first, b_second, _, _} = b
  Bool.or(U32.is_lt(a_first, b_first), Bool.and(U32.is_eq(a_first, b_first), U32.is_lt(a_second, b_second)))

def keep_least(+hit: Hit, best: Maybe<&2, Hit>) -> Maybe<&2, Hit>:
  match best:
    case None{}:
      Some{hit}
    case Some{+other}:
      Some{Bool.pick(Hit, hit_less(hit, other), hit, other)}

# The pair test always runs as clear(earlier, later) in walk order, as the
# pairwise loop did, and the least failing (earlier, later) pair is reported.
def pair_verdict(+a: Item, +b: Item, +resolution: R.Real, +best: Maybe<&2, Hit>) -> Maybe<&2, Hit>:
  +swap = U32.is_lt(item_id(b), item_id(a))
  +early = Bool.pick(Item, swap, b, a)
  +late = Bool.pick(Item, swap, a, b)
  +fallback = item_segment(late, P.Segment{A.Line{G.v3(0.0, 0.0, 0.0), G.v3(1.0, 0.0, 0.0)}, zero(), one(), origin_point(), origin_point(), zero(), zero()})
  +clear = P.clear(item_segment(early, fallback), item_segment(late, fallback), resolution)
  Bool.pick(Maybe<&2, Hit>, clear, best, keep_least(Hit{item_id(early), item_id(late), item_tag(early), item_tag(late)}, best))

def pair_candidate(meet: Bool, +a: Item, +b: Item, +resolution: R.Real, best: Maybe<&2, Hit>) -> Maybe<&2, Hit>:
  match meet:
    case False{}:
      best
    case True{}:
      pair_verdict(a, b, resolution, best)

def pair_scan(rest: List<&2, Item>, within: Bool, +item: Item, +resolution: R.Real, best: Maybe<&2, Hit>) -> Maybe<&2, Hit>:
  match rest:
    case Nil{}:
      best
    case +other <> +tail:
      match within:
        case False{}:
          best
        case True{}:
          pair_scan(tail, reaches(item, tail), item, resolution, pair_candidate(boxes_meet(item, other), item, other, resolution, best))

def pair_sweep(items: List<&2, Item>, +resolution: R.Real, best: Maybe<&2, Hit>) -> Maybe<&2, Hit>:
  match items:
    case Nil{}:
      best
    case +item <> +tail:
      pair_sweep(tail, resolution, pair_scan(tail, reaches(item, tail), item, resolution, best))

def hit_reason(best: Maybe<&2, Hit>) -> Maybe<&2, Reason>:
  match best:
    case None{}:
      None{}
    case Some{Hit{_, _, first, second}}:
      Some{SelfIntersectionOrTouch{first, second}}

def simple(+uses: List<&2, Use>, +resolution: R.Real) -> Maybe<&2, Reason>:
  +grow = R.mul(pair_window(uses, resolution), R.from_f32(0.5))
  hit_reason(pair_sweep(sorted(segment_items(uses, 0, resolution, grow)), resolution, None{}))

# Endpoints of an original pair within resolution differ in their stored
# values by at most resolution + both remainders; twice that is the window.
def point_window(+entities: List<&2, Entity>, +resolution: R.Real) -> R.Real:
  R.mul(R.from_f32(2.0), R.add(resolution, remainder_scale(entities)))

def checked_simple(reason: Maybe<&2, Reason>, result: SolveResult) -> SolveResult:
  match reason:
    case None{}:
      result
    case Some{reason}:
      Rejected{reason}

def solved_walk(result: Walk, source: List<&2, Entity>, +resolution: R.Real) -> SolveResult:
  match result:
    case BadWalk{reason}:
      Rejected{reason}
    case Walked{+uses}:
      +signed = area(uses)
      +ordered = Bool.pick(List<&2, Use>, R.less(signed, zero()), reverse(uses, Nil{}), uses)
      +fallback = {L.Point{G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 0.0), L.SourcePoint{0, 0, 0, 0}} : L.Point}
      Bool.pick(SolveResult, R.less(R.mul(resolution, resolution), R.abs(signed)),
        checked_simple(simple(ordered, resolution), Solved{ordered, source, R.abs(signed), resolution, endpoint_gap(ordered, first_point(ordered, fallback)), max_fit_error(ordered), zero()}), Rejected{UnresolvedArea{}})

def checked_degrees(reason: Maybe<&2, Reason>, +fits: List<&2, Fit>, links: IV.IdVec<U32>, +source: List<&2, Entity>, +resolution: R.Real) -> SolveResult:
  match reason:
    case Some{reason}:
      Rejected{reason}
    case None{}:
      match source:
        case Nil{}:
          Rejected{EntityCount{}}
        case +head <> _:
          +first = least(source, start(head))
          walked = chain_taken(take(fits, first, resolution), List.length(&2, Entity, source), source, fits_vec(IV.from_list(Fit, fits)), links, first, resolution)
          solved_walk(walked, source, resolution)

def linked_degrees(r: IV.IdVec<U32> & IV.IdVec<U32>, +fits: List<&2, Fit>, +source: List<&2, Entity>, +resolution: R.Real) -> SolveResult:
  (counts, links) = r
  checked_degrees(degree_scan(source, counts_list(IV.to_list(U32, counts))), fits, links, source, resolution)

def fitted(result: FitResult, +source: List<&2, Entity>, +resolution: R.Real) -> SolveResult:
  match result:
    case BadFit{reason}:
      Rejected{reason}
    case Fitted{+fits}:
      +ends = (2 * U32.from_nat(List.length(&2, Entity, source)) : U32)
      +grow = R.mul(point_window(source, resolution), R.from_f32(0.5))
      hits = point_sweep(sorted(point_items(source, 0, grow)), resolution, Nil{})
      counted = tally(hits, counts_vec(IV.filled(U32, ends, 1)), counts_vec(IV.filled(U32, ends, 4294967295)))
      linked_degrees(counted, fits, source, resolution)

# Host resource limit on one profile (was 256), src/library.mjs
# SKETCH_ENTITY_LIMIT. Admission itself is O(n log n) plus candidate pairs and
# runs past 2500 entities; the bound is set by the rest of the JS pipeline
# (identity roles of a prism exhaust the stack between 1280 and 1536 faces).
# Measured costs: docs/sketch-arcs.md "Admission cost". Above it: EntityCount.
def entity_limit() -> U32:
  1024

def solve(+source: List<&2, Entity>) -> SolveResult:
  +n = U32.from_nat(List.length(&2, Entity, source))
  +resolution = R.mul(I.angular_guard(), input_scale(source))
  valid = Bool.and(Bool.not(U32.is_lt(n, 2)), Bool.not(U32.is_lt(entity_limit(), n)))
  Bool.pick(SolveResult, valid, fitted(fit_inputs(source, resolution), source, resolution), Rejected{EntityCount{}})

def joint(+a: L.Point, +b: L.Point) -> G.Vec3:
  L.value(Bool.pick(L.Point, L.point_less(a, b), a, b))

def vertices(uses: List<&2, Use>, +previous: L.Point, +height: R.Real) -> List<&2, G.Vec3>:
  match uses:
    case Nil{}:
      Nil{}
    case +head <> tail:
      G.add(joint(previous, use_start(head)), G.V3{zero(), zero(), height}) <> vertices(tail, use_end(head), height)

def last_point(uses: List<&2, Use>, fallback: L.Point) -> L.Point:
  match uses:
    case Nil{}:
      fallback
    case +head <> tail:
      last_point(tail, use_end(head))

def translated_curve(curve: A.Curve, height: R.Real) -> A.Curve:
  A.curve_transform(curve, G.Rotation{G.v3(1.0, 0.0, 0.0), G.v3(0.0, 1.0, 0.0), G.v3(0.0, 0.0, 1.0)}, G.V3{zero(), zero(), height})

def ring_edges(uses: List<&2, Use>, +n: U32, +offset: U32, +i: U32, +height: R.Real) -> List<&2, A.Edge>:
  match uses:
    case Nil{}:
      Nil{}
    case +head <> tail:
      A.Edge{(offset + i : U32), (offset + T.next(i, n) : U32), translated_curve(curve(use_fit(head)), height), use_sense(head)} <>
        ring_edges(tail, n, offset, (i + 1 : U32), height)

def vertical_edges(points: List<&2, G.Vec3>, +n: U32, +i: U32) -> List<&2, A.Edge>:
  match points:
    case Nil{}:
      Nil{}
    case head <> tail:
      A.Edge{i, (n + i : U32), A.Line{head, G.v3(0.0, 0.0, 1.0)}, True{}} <> vertical_edges(tail, n, (i + 1 : U32))

def ring_domains(uses: List<&2, Use>) -> List<&2, F.DomainChoice>:
  match uses:
    case Nil{}:
      Nil{}
    case head <> tail:
      +fit = use_fit(head)
      F.GivenDomain{C.Interval{fit_first(fit), fit_last(fit)}} <> ring_domains(tail)

def vertical_domains(left: Nat, +depth: R.Real) -> List<&2, F.DomainChoice>:
  match left:
    case 0n:
      Nil{}
    case 1n+rest:
      F.GivenDomain{C.Interval{zero(), depth}} <> vertical_domains(rest, depth)

def side_surface_curve(geometry: A.Curve, +forward: Bool) -> A.Surface:
  match geometry:
    case A.Line{origin, +direction}:
      +tangent = Bool.pick(G.Vec3, forward, direction, G.scale(direction, R.neg(one())))
      A.Plane{origin, G.cross(tangent, G.v3(0.0, 0.0, 1.0)), tangent}
    case A.Circle{origin, normal, x, radius}:
      A.Cylinder{origin, normal, x, radius}
    case _:
      A.Plane{G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 1.0), G.v3(1.0, 0.0, 0.0)}

def side_surface(+use: Use, height: R.Real) -> A.Surface:
  side_surface_curve(translated_curve(curve(use_fit(use)), height), use_sense(use))

def side_sense_curve(geometry: A.Curve, forward: Bool) -> Bool:
  match geometry:
    case A.Line{_, _}:
      True{}
    case _:
      forward

def side_sense(+use: Use) -> Bool:
  side_sense_curve(curve(use_fit(use)), use_sense(use))

def side_faces(uses: List<&2, Use>, +n: U32, +i: U32, +height: R.Real) -> List<&2, A.Face>:
  match uses:
    case Nil{}:
      Nil{}
    case +head <> tail:
      loop = {A.Loop{True{}, [T.Use{i, True{}}, T.Use{(2 * n + T.next(i, n) : U32), True{}}, T.Use{(n + i : U32), False{}}, T.Use{(2 * n + i : U32), False{}}]} : A.Loop}
      A.Face{side_surface(head, height), side_sense(head), [loop]} <> side_faces(tail, n, (i + 1 : U32), height)

def local_solid(+uses: List<&2, Use>, +depth: R.Real) -> A.Solid:
  +count = List.length(&2, Use, uses)
  +n = U32.from_nat(count)
  +low = R.min(zero(), depth)
  +high = R.max(zero(), depth)
  fallback = {L.Point{G.v3(0.0, 0.0, 0.0), G.v3(0.0, 0.0, 0.0), L.SourcePoint{0, 0, 0, 0}} : L.Point}
  +last = last_point(uses, fallback)
  +bottom = vertices(uses, last, low)
  top = vertices(uses, last, high)
  lower = ring_edges(uses, n, 0, 0, low)
  upper = ring_edges(uses, n, n, 0, high)
  +ref = G.v3(1.0, 0.0, 0.0)
  +normal = G.v3(0.0, 0.0, 1.0)
  bottom_face = {A.Face{A.Plane{G.V3{zero(), zero(), low}, normal, ref}, False{}, [A.Loop{True{}, T.reverse_uses(T.ring_uses(count, 0, 0), Nil{})}]} : A.Face}
  top_face = {A.Face{A.Plane{G.V3{zero(), zero(), high}, normal, ref}, True{}, [A.Loop{True{}, T.ring_uses(count, n, 0)}]} : A.Face}
  A.Solid{List.append(&2, G.Vec3, bottom, top),
    List.append(&2, A.Edge, lower, List.append(&2, A.Edge, upper, vertical_edges(bottom, n, 0))),
    bottom_face <> top_face <> side_faces(uses, n, 0, low)}

def audit_volume(audit: V.Audit) -> R.Real:
  V.Audit{_, _, _, _, volume} = audit
  volume

def audit_resolution(audit: V.Audit) -> R.Real:
  V.Audit{_, _, _, resolution, _} = audit
  resolution

def perimeter(uses: List<&2, Use>) -> R.Real:
  match uses:
    case Nil{}:
      zero()
    case head <> tail:
      +fit = use_fit(head)
      R.add(R.mul(P.scale(curve(fit)), R.sub(fit_last(fit), fit_first(fit))), perimeter(tail))

def extruded_audit(+audit: V.Audit, solid: A.Solid, domains: List<&2, F.DomainChoice>, profile: SolveResult, +depth: R.Real, +area: R.Real, perimeter: R.Real) -> ExtrusionResult:
  +volume = R.mul(area, R.abs(depth))
  surface_area = R.add(R.mul(R.from_f32(2.0), area), R.mul(perimeter, R.abs(depth)))
  mass_budget = R.mul(audit_resolution(audit), surface_area)
  consistent = I.at_most(R.abs(R.sub(volume, audit_volume(audit))), mass_budget)
  Bool.pick(ExtrusionResult, Bool.and(V.valid(audit), consistent), Extruded{solid, domains, profile, audit, volume, depth, zero()}, Unsupported{NativeAudit{}})

def construct_frame(+profile: SolveResult, +uses: List<&2, Use>, area: R.Real, frame: G.Frame, +depth: R.Real) -> ExtrusionResult:
  G.Frame{offset, n, u, v} = frame
  +solid = A.transform(local_solid(uses, depth), G.Rotation{u, v, n}, offset)
  +ring = ring_domains(uses)
  +domains = List.append(&2, F.DomainChoice, ring, List.append(&2, F.DomainChoice, ring, vertical_domains(List.length(&2, Use, uses), R.abs(depth))))
  tolerance = {I.Tolerance{R.from_f32(0.0000001), R.from_f32(0.0000000001)} : I.Tolerance}
  extruded_audit(V.audit(solid, domains, tolerance, zero()), solid, domains, profile, depth, area, perimeter(uses))

def checked_sweep(valid: Bool, +profile: SolveResult, +uses: List<&2, Use>, area: R.Real, +origin: G.Vec3, +normal: G.Vec3, x: G.Vec3, +delta: G.Vec3) -> ExtrusionResult:
  match valid:
    case False{}:
      Unsupported{InvalidFrame{}}
    case True{}:
      +n = G.normalize(normal)
      +depth = G.dot(delta, n)
      +resolution = R.mul(I.angular_guard(), R.max(one(), R.max(I.magnitude(origin), I.magnitude(G.add(origin, delta)))))
      sweep_valid = I.at_most(I.length(G.sub(delta, G.scale(n, depth))), resolution)
      Bool.pick(ExtrusionResult, sweep_valid,
        Bool.pick(ExtrusionResult, R.less(resolution, R.abs(depth)), construct_frame(profile, uses, area, G.frame(origin, n, x), depth), Unsupported{UnresolvedDepth{}}), Unsupported{NonNormalSweep{}})

def extrude(+profile: SolveResult, +origin: G.Vec3, +normal: G.Vec3, +x: G.Vec3, +delta: G.Vec3) -> ExtrusionResult:
  match profile:
    case Rejected{reason}:
      Unsupported{reason}
    case Solved{uses, _, area, _, _, _, _}:
      vectors = Bool.and(I.vec_valid(origin), Bool.and(I.vec_valid(normal), Bool.and(I.vec_valid(x), I.vec_valid(delta))))
      directions = Bool.and(I.direction_valid(normal), I.direction_valid(x))
      frame = C.frame_valid(G.normalize(normal), G.normalize(x))
      checked_sweep(Bool.and(vectors, Bool.and(directions, frame)), profile, uses, area, origin, normal, x, delta)
