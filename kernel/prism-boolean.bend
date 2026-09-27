import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./topology.bend as T
import ./robust-predicates.bend as E

# Exact Booleans of right prisms that share their extrusion axis and cap
# planes (local design note task 12a, docs/prism-boolean.md).
#
# Two operands that are right prisms over line/arc regions along the same
# coordinate axis are combined as a 2D region Boolean of their profiles and
# extruded again. A prism is recognized with exact predicates: its axis is a
# coordinate axis exactly (so the profile coordinates are the input words
# themselves, never a rounded projection); every face is either one of the two
# caps (a plane whose normal is that axis) or a vertical plane or cylinder;
# every vertex lies on one of the two cap planes. A valid closed shell of that
# form is exactly the region of its bottom cap swept between the two caps.
#
# The 2D Boolean splits both profiles at their common points and keeps the
# pieces the operation wants:
#   - coincidence of carriers, tangency (discriminant exactly zero) and the
#     incidence of a profile vertex with the other operand's carrier are
#     decided exactly (robust-predicates.bend Big: every F32 word is an integer
#     times 2^-149);
#   - a vertex also lies on a carrier when a segment of its own profile ending
#     at it has exactly that carrier (the body's topology says so);
#   - transversal crossings are computed in F32x2 and used as they are;
#   - a piece is classified by the winding number of the other profile at its
#     midpoint, certified by the midpoint's distance to that profile.
# Tolerances are used only to decline: a computed crossing within snap of a
# vertex it is not exactly incident with, two crossings closer than tangent
# (a near tangency), split points closer than snap, a midpoint within classify
# of the other boundary, pieces meeting more than two at a vertex (a
# non-manifold touch). The caller then hands the operation to the next arm.
# Nothing is moved, snapped or merged within a tolerance.
#
# Decline codes (Declined{code, detail}):
#   1  an operand face is not a plane or cylinder
#   2  an operand face is neither a cap nor vertical along any coordinate axis
#   3  an operand has not exactly two cap faces (one down, one up, low < high)
#   4  a vertex lies off both cap planes
#   5  a cap edge is not a line or a circle about the axis, or is degenerate
#   6  a cap face could not be read (missing face)
#   7  a cap face's loops are not one counterclockwise outer loop and
#      clockwise holes of nonzero area
#  10  the cap planes do not fit the operation (UNION: equal; SUBTRACTION: the
#      tool spans the target; INTERSECTION: one spans the other)
#  20  a crossing lies within snap of a vertex it is not exactly incident with
#  21  two crossings closer than tangent (near tangency) on both segments
#  22  two split points of a segment closer than snap
#  23  a piece midpoint within classify of the other boundary
#  24  the winding number at a piece midpoint is not 0 or 1
#  25  pieces do not meet two by two at every vertex (non-manifold touch)
#  26  the kept pieces do not close into loops
#  27  a result loop has (near) zero area or a degenerate line loop
#  28  a hole lies in no outer loop
# detail: the operand (0, 1) for recognition codes, else 0.

type P2 is Data:
  P2{u: R.Real, v: R.Real}

type Carrier is Data:
  CLine{a: P2, b: P2}
  CCircle{c: P2, r: R.Real}

type Origin is Data:
  Origin{operand: U32, face: U32}

type Seg is Data:
  Seg{carrier: Carrier, start: P2, end: P2, ccw: Bool, full: Bool, origins: List<&2, Origin>}

type S is Data:
  SN{}
  SZ{}
  SP{}
  SU{}

type Tol is Data:
  Tol{snap: R.Real, tangent: R.Real, classify: R.Real, area: R.Real}

type Hits is Data:
  Hits{ok: Bool, code: U32, points: List<&2, P2>}

type Memb is Data:
  In{}
  Out{}
  Unsure{}

type Segs is Data:
  SegsOk{segs: List<&2, Seg>}
  SegsBad{code: U32}

type Loops is Data:
  LoopsOk{loops: List<&2, List<&2, Seg>>}
  LoopsBad{code: U32}

type Cls is Data:
  Inside{}
  Outside{}
  SameDir{}
  OppDir{}
  Unclear{code: U32}

type Keep is Data:
  Drop{}
  Kept{}
  Flip{}
  Refuse{code: U32}

type FaceKind is Data:
  KCap{height: R.Real, up: Bool}
  KSide{}
  KBad{code: U32}

type Cap is Data:
  Cap{index: U32, height: R.Real, up: Bool}

type CapPair is Data:
  CapPair{bottom: Cap, top: Cap}

type SlabPair is Data:
  SlabPair{low: R.Real, high: R.Real}

type Scan is Data:
  Scan{code: U32, caps: List<&2, Cap>}

type Prism is Data:
  Prism{low: R.Real, high: R.Real, bottom: U32, top: U32, loops: List<&2, List<&2, Seg>>}
  NotPrism{code: U32}

type Range is Data:
  NoRange{}
  Span{first: R.Real, last: R.Real}

type Body is Data:
  Body{solid: A.Solid, volume: R.Real, area: R.Real, low: G.Vec3, high: G.Vec3, ranges: List<&2, Range>, origins: List<&2, List<&2, Origin>>}

type Answer is Data:
  Built{bodies: List<&2, Body>, axis: U32, low: R.Real, high: R.Real}
  Declined{code: U32, detail: U32}

type Box is Data:
  Box{lu: R.Real, lv: R.Real, hu: R.Real, hv: R.Real}

type Step is Data:
  Closed{pool: List<&2, Seg>}
  Next{seg: Seg, pool: List<&2, Seg>}
  Stuck{pool: List<&2, Seg>}

type Chain is Data:
  Chain{ok: Bool, loop: List<&2, Seg>, pool: List<&2, Seg>}

type Take is Data:
  Taken{seg: Seg, rest: List<&2, Seg>}
  Missing{rest: List<&2, Seg>}

type Keyed is Data:
  Keyed{key: R.Real, point: P2}

type Placed is Data:
  Placed{loop: List<&2, Seg>, owner: U32}

# --- reals and points -------------------------------------------------------

def tol_snap(t: Tol) -> R.Real:
  Tol{x, _, _, _} = t
  x

def tol_tangent(t: Tol) -> R.Real:
  Tol{_, x, _, _} = t
  x

def tol_classify(t: Tol) -> R.Real:
  Tol{_, _, x, _} = t
  x

def tol_area(t: Tol) -> R.Real:
  Tol{_, _, _, x} = t
  x

def zero() -> R.Real:
  R.from_f32(0.0)

def one() -> R.Real:
  R.from_f32(1.0)

def half() -> R.Real:
  R.from_f32(0.5)

def tau() -> R.Real:
  R.mul(R.pi(), R.from_f32(2.0))

def is_zero(+x: R.Real) -> Bool:
  R.equal(x, zero())

def is_neg(+x: R.Real) -> Bool:
  R.less(x, zero())

def is_pos(+x: R.Real) -> Bool:
  R.less(zero(), x)

def at_most(+a: R.Real, +b: R.Real) -> Bool:
  Bool.not(R.less(b, a))

def pu(p: P2) -> R.Real:
  P2{u, _} = p
  u

def pv(p: P2) -> R.Real:
  P2{_, v} = p
  v

def same(p: P2, q: P2) -> Bool:
  P2{pu, pv} = p
  P2{qu, qv} = q
  Bool.and(R.equal(pu, qu), R.equal(pv, qv))

def psub(p: P2, q: P2) -> P2:
  P2{pu, pv} = p
  P2{qu, qv} = q
  P2{R.sub(pu, qu), R.sub(pv, qv)}

def padd(p: P2, q: P2) -> P2:
  P2{pu, pv} = p
  P2{qu, qv} = q
  P2{R.add(pu, qu), R.add(pv, qv)}

def pscale(p: P2, +s: R.Real) -> P2:
  P2{pu, pv} = p
  P2{R.mul(pu, s), R.mul(pv, s)}

def cross2(a: P2, b: P2) -> R.Real:
  P2{au, av} = a
  P2{bu, bv} = b
  R.sub(R.mul(au, bv), R.mul(av, bu))

def dot2(a: P2, b: P2) -> R.Real:
  P2{au, av} = a
  P2{bu, bv} = b
  R.add(R.mul(au, bu), R.mul(av, bv))

def norm2(+a: P2) -> R.Real:
  dot2(a, a)

def dist(+p: P2, +q: P2) -> R.Real:
  R.sqrt(norm2(psub(p, q)))

def near(+p: P2, +q: P2, +eps: R.Real) -> Bool:
  at_most(dist(p, q), eps)

def perp(p: P2) -> P2:
  P2{u, v} = p
  P2{R.neg(v), u}

def unit(+p: P2) -> P2:
  pscale(p, R.div(one(), R.sqrt(norm2(p))))

def angle_of(+p: P2) -> R.Real:
  R.atan2(pv(p), pu(p))

def polar(+c: P2, +r: R.Real, +theta: R.Real) -> P2:
  padd(c, P2{R.mul(r, R.cos(theta)), R.mul(r, R.sin(theta))})

# --- exact predicates --------------------------------------------------------

def big(x: R.Real) -> E.Big:
  E.from_real(x)

def bdiff(x: R.Real, y: R.Real) -> E.Big:
  E.sub(big(x), big(y))

def sign_map(s: E.Sign) -> S:
  match s:
    case E.Negative{}:
      SN{}
    case E.ExactlyZero{}:
      SZ{}
    case E.Positive{}:
      SP{}
    case E.Undefined{}:
      SU{}

def sgn(b: E.Big) -> S:
  sign_map(E.sign(b))

def s_zero(s: S) -> Bool:
  match s:
    case SZ{}:
      True{}
    case _:
      False{}

def s_pos(s: S) -> Bool:
  match s:
    case SP{}:
      True{}
    case _:
      False{}

def s_neg(s: S) -> Bool:
  match s:
    case SN{}:
      True{}
    case _:
      False{}

def same_side(+a: S, +b: S) -> Bool:
  Bool.or(Bool.and(s_pos(a), s_pos(b)), Bool.and(s_neg(a), s_neg(b)))

# (q - p) x (r - p), exactly.
def orient(p: P2, q: P2, r: P2) -> E.Big:
  P2{+px, +py} = p
  P2{qx, qy} = q
  P2{rx, ry} = r
  E.sub(E.mul(bdiff(qx, px), bdiff(ry, py)), E.mul(bdiff(qy, py), bdiff(rx, px)))

# (q - p) . (r - p), exactly.
def bdot(p: P2, q: P2, r: P2) -> E.Big:
  P2{+px, +py} = p
  P2{qx, qy} = q
  P2{rx, ry} = r
  E.add(E.mul(bdiff(qx, px), bdiff(rx, px)), E.mul(bdiff(qy, py), bdiff(ry, py)))

# |p - c|^2 - r^2, exactly.
def circle_power(p: P2, c: P2, r: R.Real) -> E.Big:
  P2{px, py} = p
  P2{cx, cy} = c
  +dx = bdiff(px, cx)
  +dy = bdiff(py, cy)
  +br = big(r)
  E.sub(E.add(E.mul(dx, dx), E.mul(dy, dy)), E.mul(br, br))

def on_line(+a: P2, +b: P2, +p: P2) -> Bool:
  s_zero(sgn(orient(a, b, p)))

# p (on the line ab) lies on the closed segment ab.
def within_closed(+a: P2, +b: P2, +p: P2) -> Bool:
  +t = bdot(a, b, p)
  Bool.and(Bool.not(s_neg(sgn(t))), Bool.not(s_pos(sgn(E.sub(t, bdot(a, b, b))))))

def on_circle(+p: P2, +c: P2, +r: R.Real) -> Bool:
  s_zero(sgn(circle_power(p, c, r)))

# --- segments ----------------------------------------------------------------

def seg_carrier(s: Seg) -> Carrier:
  Seg{carrier, _, _, _, _, _} = s
  carrier

def seg_start(s: Seg) -> P2:
  Seg{_, start, _, _, _, _} = s
  start

def seg_end(s: Seg) -> P2:
  Seg{_, _, end, _, _, _} = s
  end

def seg_ccw(s: Seg) -> Bool:
  Seg{_, _, _, ccw, _, _} = s
  ccw

def seg_full(s: Seg) -> Bool:
  Seg{_, _, _, _, full, _} = s
  full

def seg_origins(s: Seg) -> List<&2, Origin>:
  Seg{_, _, _, _, _, origins} = s
  origins

def is_circle(carrier: Carrier) -> Bool:
  match carrier:
    case CLine{_, _}:
      False{}
    case CCircle{_, _}:
      True{}

def center_of(carrier: Carrier) -> P2:
  match carrier:
    case CLine{a, _}:
      a
    case CCircle{c, _}:
      c

def radius_of(carrier: Carrier) -> R.Real:
  match carrier:
    case CLine{_, _}:
      zero()
    case CCircle{_, r}:
      r

def seg_circle(+s: Seg) -> Bool:
  is_circle(seg_carrier(s))

def seg_center(+s: Seg) -> P2:
  center_of(seg_carrier(s))

def seg_radius(+s: Seg) -> R.Real:
  radius_of(seg_carrier(s))

def reverse_carrier(carrier: Carrier, +start: P2, +end: P2) -> Carrier:
  match carrier:
    case CLine{_, _}:
      CLine{start, end}
    case CCircle{c, r}:
      CCircle{c, r}

# The traversal reversed. A line keeps its carrier through its own endpoints.
def reverse_seg(s: Seg) -> Seg:
  Seg{carrier, +start, +end, ccw, full, origins} = s
  Seg{reverse_carrier(carrier, end, start), end, start, Bool.not(ccw), full, origins}

def reverse_loop(loop: List<&2, Seg>, acc: List<&2, Seg>) -> List<&2, Seg>:
  match loop:
    case Nil{}:
      acc
    case s <> rest:
      reverse_loop(rest, reverse_seg(s) <> acc)

def same_carrier(x: Carrier, y: Carrier) -> Bool:
  match x y:
    case CLine{+a, +b} CLine{c, d}:
      Bool.and(on_line(a, b, c), on_line(a, b, d))
    case CLine{_, _} CCircle{_, _}:
      False{}
    case CCircle{_, _} CLine{_, _}:
      False{}
    case CCircle{c1, r1} CCircle{c2, r2}:
      Bool.and(same(c1, c2), R.equal(r1, r2))

def on_carrier(+p: P2, carrier: Carrier) -> Bool:
  match carrier:
    case CLine{a, b}:
      on_line(a, b, p)
    case CCircle{c, r}:
      on_circle(p, c, r)

def shares_when(touch: Bool, own: Carrier, +carrier: Carrier) -> Bool:
  match touch:
    case True{}:
      same_carrier(own, carrier)
    case False{}:
      False{}

# Some segment of the vertex's own profile ends at p and has exactly this carrier.
def shares(own: List<&2, Seg>, +p: P2, +carrier: Carrier) -> Bool:
  match own:
    case Nil{}:
      False{}
    case +s <> rest:
      Bool.or(shares_when(Bool.or(same(seg_start(s), p), same(seg_end(s), p)), seg_carrier(s), carrier), shares(rest, p, carrier))

def incident_when(exact: Bool, +p: P2, +carrier: Carrier, +own: List<&2, Seg>) -> Bool:
  match exact:
    case True{}:
      True{}
    case False{}:
      shares(own, p, carrier)

# p lies on the carrier: exactly, or by the topology of p's own profile.
def incident(+p: P2, +carrier: Carrier, +own: List<&2, Seg>) -> Bool:
  incident_when(on_carrier(p, carrier), p, carrier, own)

def sweep_of(full: Bool, +c: P2, +a: P2, +b: P2, +ccw: Bool) -> R.Real:
  match full:
    case True{}:
      tau()
    case False{}:
      +x = psub(a, c)
      +y = psub(b, c)
      +cr = cross2(x, y)
      +theta = R.atan2(Bool.pick(R.Real, ccw, cr, R.neg(cr)), dot2(x, y))
      Bool.pick(R.Real, at_most(theta, zero()), R.add(theta, tau()), theta)

# --- approximate positions (used only away from every vertex) ---------------

# Sweep of an arc in (0, tau].
def sweep(+s: Seg) -> R.Real:
  sweep_of(seg_full(s), seg_center(s), seg_start(s), seg_end(s), seg_ccw(s))

# Angle from `start` to `x` about c in the arc's sense, in [0, tau).
def arc_pos(+c: P2, +start: P2, +ccw: Bool, +x: P2) -> R.Real:
  +a = psub(start, c)
  +b = psub(x, c)
  +cr = cross2(a, b)
  +theta = R.atan2(Bool.pick(R.Real, ccw, cr, R.neg(cr)), dot2(a, b))
  Bool.pick(R.Real, is_neg(theta), R.add(theta, tau()), theta)

def in_arc_open(+s: Seg, +x: P2) -> Bool:
  +pos = arc_pos(seg_center(s), seg_start(s), seg_ccw(s), x)
  Bool.or(seg_full(s), Bool.and(is_pos(pos), R.less(pos, sweep(s))))

def in_line_open(+a: P2, +b: P2, +x: P2) -> Bool:
  +d = psub(b, a)
  +t = dot2(psub(x, a), d)
  Bool.and(is_pos(t), R.less(t, norm2(d)))

def in_open(+s: Seg, +x: P2) -> Bool:
  Bool.pick(Bool, seg_circle(s), in_arc_open(s, x), in_line_open(seg_start(s), seg_end(s), x))

def near_any(points: List<&2, P2>, +x: P2, +eps: R.Real) -> Bool:
  match points:
    case Nil{}:
      False{}
    case p <> rest:
      Bool.or(near(p, x, eps), near_any(rest, x, eps))

def ends_of(+s: Seg) -> List<&2, P2>:
  [seg_start(s), seg_end(s)]

# Membership of a point on the arc's circle in the closed arc.
def arc_closed(+s: Seg, +p: P2, +eps: R.Real) -> Memb:
  +start = seg_start(s)
  +end = seg_end(s)
  exact = Bool.or(same(p, start), same(p, end))
  close = Bool.or(near(p, start, eps), near(p, end, eps))
  Bool.pick(Memb, exact, In{}, Bool.pick(Memb, close, Unsure{}, Bool.pick(Memb, in_arc_open(s, p), In{}, Out{})))

def memb_when(c: Bool, m: Memb) -> Memb:
  match c:
    case True{}:
      m
    case False{}:
      Out{}

# --- hits ---------------------------------------------------------------------

def hits_ok(points: List<&2, P2>) -> Hits:
  Hits{True{}, 0, points}

def hits_bad(code: U32) -> Hits:
  Hits{False{}, code, Nil{}}

def hits_append(points: List<&2, P2>, b: Hits) -> Hits:
  match b:
    case Hits{ok, code, rest}:
      Hits{ok, code, List.append(&2, P2, points, rest)}

def hits_join_ok(ok: Bool, code: U32, points: List<&2, P2>, b: Hits) -> Hits:
  match ok:
    case False{}:
      Hits{False{}, code, Nil{}}
    case True{}:
      hits_append(points, b)

def hits_join(a: Hits, b: Hits) -> Hits:
  match a:
    case Hits{ok, code, points}:
      hits_join_ok(ok, code, points, b)

def hits_memb(m: Memb, +p: P2, rest: Hits) -> Hits:
  match m:
    case In{}:
      hits_append([p], rest)
    case Out{}:
      rest
    case Unsure{}:
      hits_bad(20)

def keep_if(c: Bool, +p: P2, rest: List<&2, P2>) -> List<&2, P2>:
  match c:
    case True{}:
      p <> rest
    case False{}:
      rest

# A computed common point of two carriers: covered by an exact incidence
# found already, ambiguous next to a vertex, a hit inside both segments, or
# not on the segments at all.
def root_hit(+x: P2, +snaps: List<&2, P2>, +s1: Seg, +s2: Seg, +tol: Tol) -> Hits:
  +eps = tol_snap(tol)
  +ends1 = ends_of(s1)
  +ends2 = ends_of(s2)
  +near1 = near_any(ends1, x, eps)
  +near2 = near_any(ends2, x, eps)
  +relevant = Bool.and(Bool.or(in_open(s1, x), near1), Bool.or(in_open(s2, x), near2))
  Bool.pick(Hits, near_any(snaps, x, eps), hits_ok(Nil{}),
    Bool.pick(Hits, relevant, Bool.pick(Hits, Bool.or(near1, near2), hits_bad(20), hits_ok([x])), hits_ok(Nil{})))

def root_hits(roots: List<&2, P2>, +snaps: List<&2, P2>, +s1: Seg, +s2: Seg, +tol: Tol) -> Hits:
  match roots:
    case Nil{}:
      hits_ok(Nil{})
    case x <> rest:
      hits_join(root_hit(x, snaps, s1, s2, tol), root_hits(rest, snaps, s1, s2, tol))

# Two roots closer than the tangent resolution near both segments: a near
# tangency whose crossings are not resolved.
def near_tangent(+x: P2, +y: P2, +s1: Seg, +s2: Seg, +tol: Tol) -> Bool:
  +tangent = tol_tangent(tol)
  +m = pscale(padd(x, y), half())
  +close = near(x, y, tangent)
  +on1 = Bool.or(in_open(s1, m), near_any(ends_of(s1), m, tangent))
  +on2 = Bool.or(in_open(s2, m), near_any(ends_of(s2), m, tangent))
  Bool.and(close, Bool.and(on1, on2))

def roots_pair(rest: List<&2, P2>, +x: P2, +snaps: List<&2, P2>, +s1: Seg, +s2: Seg, +tol: Tol) -> Hits:
  match rest:
    case Nil{}:
      root_hits([x], snaps, s1, s2, tol)
    case +y <> _:
      Bool.pick(Hits, near_tangent(x, y, s1, s2, tol), hits_bad(21), root_hits([x, y], snaps, s1, s2, tol))

def roots_checked(roots: List<&2, P2>, +snaps: List<&2, P2>, +s1: Seg, +s2: Seg, +tol: Tol) -> Hits:
  match roots:
    case Nil{}:
      hits_ok(Nil{})
    case x <> rest:
      roots_pair(rest, x, snaps, s1, s2, tol)

def with_roots(snaps: Hits, +roots: List<&2, P2>, +s1: Seg, +s2: Seg, +tol: Tol) -> Hits:
  match snaps:
    case Hits{ok, code, +points}:
      hits_join(Hits{ok, code, points}, roots_checked(roots, points, s1, s2, tol))

def ll_finish(touch: Maybe<&2, P2>, +p0: P2, +p1: P2, +q0: P2, +q1: P2, +tol: Tol) -> Hits:
  match touch:
    case Some{p}:
      hits_ok([p])
    case None{}:
      +eps = tol_snap(tol)
      +e = psub(q1, q0)
      +a3 = cross2(e, psub(p0, q0))
      +a4 = cross2(e, psub(p1, q0))
      +x = padd(p0, pscale(psub(p1, p0), R.div(a3, R.sub(a3, a4))))
      Bool.pick(Hits, near_any([p0, p1, q0, q1], x, eps), hits_bad(20), hits_ok([x]))

def ll_general(apart: Bool, +o1: S, +o2: S, +o3: S, +o4: S, +p0: P2, +p1: P2, +q0: P2, +q1: P2, +tol: Tol) -> Hits:
  match apart:
    case True{}:
      hits_ok(Nil{})
    case False{}:
      touch = Bool.pick(Maybe<&2, P2>, s_zero(o1), Some{q0}, Bool.pick(Maybe<&2, P2>, s_zero(o2), Some{q1},
        Bool.pick(Maybe<&2, P2>, s_zero(o3), Some{p0}, Bool.pick(Maybe<&2, P2>, s_zero(o4), Some{p1}, None{}))))
      ll_finish(touch, p0, p1, q0, q1, tol)

def ll_split(collinear: Bool, +o1: S, +o2: S, +p0: P2, +p1: P2, +q0: P2, +q1: P2, +tol: Tol) -> Hits:
  match collinear:
    case True{}:
      hits_ok(keep_if(within_closed(p0, p1, q0), q0, keep_if(within_closed(p0, p1, q1), q1,
        keep_if(within_closed(q0, q1, p0), p0, keep_if(within_closed(q0, q1, p1), p1, Nil{})))))
    case False{}:
      +o3 = sgn(orient(q0, q1, p0))
      +o4 = sgn(orient(q0, q1, p1))
      ll_general(Bool.or(same_side(o1, o2), same_side(o3, o4)), o1, o2, o3, o4, p0, p1, q0, q1, tol)

# --- line / line -----------------------------------------------------------

def line_line(+p0: P2, +p1: P2, +q0: P2, +q1: P2, +tol: Tol) -> Hits:
  +o1 = sgn(orient(p0, p1, q0))
  +o2 = sgn(orient(p0, p1, q1))
  ll_split(Bool.and(s_zero(o1), s_zero(o2)), o1, o2, p0, p1, q0, q1, tol)

def lc_roots(disc: S, +p0: P2, +p1: P2, +c: P2, +r: R.Real) -> List<&2, P2>:
  match disc:
    case SP{}:
      +d = psub(p1, p0)
      +w = psub(c, p0)
      +len2 = norm2(d)
      +m = dot2(w, d)
      +cr = cross2(d, w)
      +root = R.sqrt(R.max(zero(), R.sub(R.mul(R.mul(r, r), len2), R.mul(cr, cr))))
      [padd(p0, pscale(d, R.div(R.sub(m, root), len2))), padd(p0, pscale(d, R.div(R.add(m, root), len2)))]
    case SZ{}:
      +d = psub(p1, p0)
      [padd(p0, pscale(d, R.div(dot2(psub(c, p0), d), norm2(d))))]
    case _:
      Nil{}

def line_circle_roots(+p0: P2, +p1: P2, +c: P2, +r: R.Real) -> List<&2, P2>:
  +br = big(r)
  +disc = E.sub(E.mul(E.mul(br, br), bdot(p0, p1, p1)), E.mul(orient(p0, p1, c), orient(p0, p1, c)))
  lc_roots(sgn(disc), p0, p1, c, r)

# --- line / circle ---------------------------------------------------------

# l: a line segment, k: an arc (or full circle) segment; own_l / own_k: the
# profiles they belong to.
def line_circle(+l: Seg, +k: Seg, +own_l: List<&2, Seg>, +own_k: List<&2, Seg>, +tol: Tol) -> Hits:
  +eps = tol_snap(tol)
  +p0 = seg_start(l)
  +p1 = seg_end(l)
  +c = seg_center(k)
  +r = seg_radius(k)
  +e0 = seg_start(k)
  +e1 = seg_end(k)
  +line = {CLine{p0, p1} : Carrier}
  +circle = {CCircle{c, r} : Carrier}
  e0_on = memb_when(Bool.and(incident(e0, line, own_k), within_closed(p0, p1, e0)), In{})
  e1_on = memb_when(Bool.and(incident(e1, line, own_k), within_closed(p0, p1, e1)), In{})
  p0_on = memb_when(incident(p0, circle, own_l), arc_closed(k, p0, eps))
  p1_on = memb_when(incident(p1, circle, own_l), arc_closed(k, p1, eps))
  snaps = hits_memb(e0_on, e0, hits_memb(e1_on, e1, hits_memb(p0_on, p0, hits_memb(p1_on, p1, hits_ok(Nil{})))))
  with_roots(snaps, line_circle_roots(p0, p1, c, r), l, k, tol)

def cc_roots(outer: S, inner: S, +c1: P2, +r1: R.Real, +c2: P2, +r2: R.Real) -> List<&2, P2>:
  match outer inner:
    case SP{} _:
      Nil{}
    case SZ{} _:
      [padd(c1, pscale(psub(c2, c1), R.div(r1, R.add(r1, r2))))]
    case _ SN{}:
      Nil{}
    case _ SZ{}:
      [padd(c1, pscale(psub(c2, c1), R.div(r1, R.sub(r1, r2))))]
    case _ _:
      +e = psub(c2, c1)
      +d2 = norm2(e)
      +d = R.sqrt(d2)
      +a = R.div(R.add(d2, R.sub(R.mul(r1, r1), R.mul(r2, r2))), R.mul(R.from_f32(2.0), d))
      +h = R.sqrt(R.max(zero(), R.sub(R.mul(r1, r1), R.mul(a, a))))
      +n = pscale(e, R.div(one(), d))
      +base = padd(c1, pscale(n, a))
      [padd(base, pscale(perp(n), R.neg(h))), padd(base, pscale(perp(n), h))]

def cc_general(+s: Seg, +t: Seg, +own_s: List<&2, Seg>, +own_t: List<&2, Seg>, +tol: Tol) -> Hits:
  +eps = tol_snap(tol)
  +c1 = seg_center(s)
  +c2 = seg_center(t)
  +r1 = seg_radius(s)
  +r2 = seg_radius(t)
  +first = {CCircle{c1, r1} : Carrier}
  +second = {CCircle{c2, r2} : Carrier}
  +e0 = seg_start(t)
  +e1 = seg_end(t)
  +f0 = seg_start(s)
  +f1 = seg_end(s)
  snaps = hits_memb(memb_when(incident(e0, first, own_t), arc_closed(s, e0, eps)), e0,
    hits_memb(memb_when(incident(e1, first, own_t), arc_closed(s, e1, eps)), e1,
    hits_memb(memb_when(incident(f0, second, own_s), arc_closed(t, f0, eps)), f0,
    hits_memb(memb_when(incident(f1, second, own_s), arc_closed(t, f1, eps)), f1, hits_ok(Nil{})))))
  +b1 = big(r1)
  +b2 = big(r2)
  +d2 = bdot(c1, c2, c2)
  +sum = E.add(b1, b2)
  +diff = E.sub(b1, b2)
  outer = sgn(E.sub(d2, E.mul(sum, sum)))
  inner = sgn(E.sub(d2, E.mul(diff, diff)))
  with_roots(snaps, cc_roots(outer, inner, c1, r1, c2, r2), s, t, tol)

def cc_concentric(concentric: Bool, +equal: Bool, +s: Seg, +t: Seg, +own_s: List<&2, Seg>, +own_t: List<&2, Seg>, +tol: Tol) -> Hits:
  match concentric:
    case True{}:
      +eps = tol_snap(tol)
      +pts = hits_memb(arc_closed(s, seg_start(t), eps), seg_start(t), hits_memb(arc_closed(s, seg_end(t), eps), seg_end(t),
        hits_memb(arc_closed(t, seg_start(s), eps), seg_start(s), hits_memb(arc_closed(t, seg_end(s), eps), seg_end(s), hits_ok(Nil{})))))
      Bool.pick(Hits, equal, pts, hits_ok(Nil{}))
    case False{}:
      cc_general(s, t, own_s, own_t, tol)

# --- circle / circle -------------------------------------------------------

def circle_circle(+s: Seg, +t: Seg, +own_s: List<&2, Seg>, +own_t: List<&2, Seg>, +tol: Tol) -> Hits:
  +c1 = seg_center(s)
  +c2 = seg_center(t)
  +r1 = seg_radius(s)
  +r2 = seg_radius(t)
  cc_concentric(same(c1, c2), R.equal(r1, r2), s, t, own_s, own_t, tol)

def pair_kind(sc: Bool, tc: Bool, +s: Seg, +t: Seg, +own_a: List<&2, Seg>, +own_b: List<&2, Seg>, +tol: Tol) -> Hits:
  match sc tc:
    case False{} False{}:
      line_line(seg_start(s), seg_end(s), seg_start(t), seg_end(t), tol)
    case False{} True{}:
      line_circle(s, t, own_a, own_b, tol)
    case True{} False{}:
      line_circle(t, s, own_b, own_a, tol)
    case True{} True{}:
      circle_circle(s, t, own_a, own_b, tol)

# --- all common points of an A segment and a B segment --------------------

# A box around a segment: its end points for a line, the whole circle for an
# arc. Two segments whose boxes are apart by more than the tangent resolution
# have no common point and no near miss any decline above could see (every
# hit, snap and near tangency lies within tangent of both segments), so the
# exact tests are skipped for them. This only prunes work; F32x2 rounding of
# the box corners is far below the margin (Box as for the result bounds).

def seg_box(+s: Seg) -> Box:
  +a = seg_start(s)
  +b = seg_end(s)
  +c = seg_center(s)
  +r = seg_radius(s)
  +line = {Box{R.min(pu(a), pu(b)), R.min(pv(a), pv(b)), R.max(pu(a), pu(b)), R.max(pv(a), pv(b))} : Box}
  +circle = {Box{R.sub(pu(c), r), R.sub(pv(c), r), R.add(pu(c), r), R.add(pv(c), r)} : Box}
  Bool.pick(Box, seg_circle(s), circle, line)

def boxes_apart(x: Box, y: Box, +m: R.Real) -> Bool:
  Box{+xlu, +xlv, +xhu, +xhv} = x
  Box{+ylu, +ylv, +yhu, +yhv} = y
  +u = Bool.or(R.less(R.add(xhu, m), ylu), R.less(R.add(yhu, m), xlu))
  +v = Bool.or(R.less(R.add(xhv, m), ylv), R.less(R.add(yhv, m), xlv))
  Bool.or(u, v)

def pair_when(apart: Bool, +s: Seg, +t: Seg, +own_a: List<&2, Seg>, +own_b: List<&2, Seg>, +tol: Tol) -> Hits:
  match apart:
    case True{}:
      hits_ok(Nil{})
    case False{}:
      pair_kind(seg_circle(s), seg_circle(t), s, t, own_a, own_b, tol)

def pair(+s: Seg, +t: Seg, +own_a: List<&2, Seg>, +own_b: List<&2, Seg>, +tol: Tol) -> Hits:
  pair_when(boxes_apart(seg_box(s), seg_box(t), R.mul(tol_tangent(tol), R.from_f32(2.0))), s, t, own_a, own_b, tol)

def cuts_a(ts: List<&2, Seg>, +s: Seg, +own_a: List<&2, Seg>, +own_b: List<&2, Seg>, +tol: Tol) -> Hits:
  match ts:
    case Nil{}:
      hits_ok(Nil{})
    case t <> rest:
      hits_join(pair(s, t, own_a, own_b, tol), cuts_a(rest, s, own_a, own_b, tol))

def cuts_b(ss: List<&2, Seg>, +t: Seg, +own_a: List<&2, Seg>, +own_b: List<&2, Seg>, +tol: Tol) -> Hits:
  match ss:
    case Nil{}:
      hits_ok(Nil{})
    case s <> rest:
      hits_join(pair(s, t, own_a, own_b, tol), cuts_b(rest, t, own_a, own_b, tol))

# --- splitting --------------------------------------------------------------

def key_le(a: Keyed, b: Keyed) -> Bool:
  Keyed{ka, _} = a
  Keyed{kb, _} = b
  Bool.not(R.less(kb, ka))

def param_of(+s: Seg, +x: P2) -> R.Real:
  +a = seg_start(s)
  Bool.pick(R.Real, seg_circle(s), arc_pos(seg_center(s), a, seg_ccw(s), x), dot2(psub(x, a), psub(seg_end(s), a)))

def keyed(points: List<&2, P2>, +s: Seg) -> List<&2, Keyed>:
  match points:
    case Nil{}:
      Nil{}
    case +p <> rest:
      +interior = Bool.not(Bool.or(same(p, seg_start(s)), same(p, seg_end(s))))
      +tail = keyed(rest, s)
      Bool.pick(List<&2, Keyed>, interior, Keyed{param_of(s, p), p} <> tail, tail)

def piece(+s: Seg, +from: P2, +to: P2) -> Seg:
  Seg{carrier, _, _, ccw, _, origins} = s
  Seg{carrier, from, to, ccw, False{}, origins}

def segs_cons(+s: Seg, rest: Segs) -> Segs:
  match rest:
    case SegsOk{xs}:
      SegsOk{s <> xs}
    case SegsBad{code}:
      SegsBad{code}

def segs_join(a: Segs, b: Segs) -> Segs:
  match a b:
    case SegsOk{xs} SegsOk{ys}:
      SegsOk{List.append(&2, Seg, xs, ys)}
    case SegsBad{code} _:
      SegsBad{code}
    case SegsOk{_} SegsBad{code}:
      SegsBad{code}

def pieces_from(ks: List<&2, Keyed>, +s: Seg, +from: P2, +eps: R.Real) -> Segs:
  match ks:
    case Nil{}:
      +end = seg_end(s)
      Bool.pick(Segs, same(from, seg_start(s)), SegsOk{[s]},
        Bool.pick(Segs, near(from, end, eps), SegsBad{22}, SegsOk{[piece(s, from, end)]}))
    case Keyed{_, +x} <> rest:
      +dup = same(x, from)
      +tail = pieces_from(rest, s, Bool.pick(P2, dup, from, x), eps)
      Bool.pick(Segs, dup, tail, Bool.pick(Segs, near(x, from, eps), SegsBad{22}, segs_cons(piece(s, from, x), tail)))

def split_seg(+s: Seg, points: List<&2, P2>, +eps: R.Real) -> Segs:
  pieces_from(List.sort(~Keyed, ~key_le, keyed(points, s)), s, seg_start(s), eps)

def split_ok(ok: Bool, code: U32, points: List<&2, P2>, +s: Seg, +eps: R.Real) -> Segs:
  match ok:
    case True{}:
      split_seg(s, points, eps)
    case False{}:
      SegsBad{code}

def split_hits(h: Hits, +s: Seg, +eps: R.Real) -> Segs:
  match h:
    case Hits{ok, code, points}:
      split_ok(ok, code, points, s, eps)

def split_a(ss: List<&2, Seg>, +own_a: List<&2, Seg>, +own_b: List<&2, Seg>, +tol: Tol) -> Segs:
  match ss:
    case Nil{}:
      SegsOk{Nil{}}
    case +s <> rest:
      +eps = tol_snap(tol)
      segs_join(split_hits(cuts_a(own_b, s, own_a, own_b, tol), s, eps), split_a(rest, own_a, own_b, tol))

def split_b(ts: List<&2, Seg>, +own_a: List<&2, Seg>, +own_b: List<&2, Seg>, +tol: Tol) -> Segs:
  match ts:
    case Nil{}:
      SegsOk{Nil{}}
    case +t <> rest:
      +eps = tol_snap(tol)
      segs_join(split_hits(cuts_b(own_a, t, own_a, own_b, tol), t, eps), split_b(rest, own_a, own_b, tol))

def arc_mid(+s: Seg) -> P2:
  +c = seg_center(s)
  +theta = angle_of(psub(seg_start(s), c))
  +h = R.mul(sweep(s), half())
  polar(c, seg_radius(s), Bool.pick(R.Real, seg_ccw(s), R.add(theta, h), R.sub(theta, h)))

def midpoint(+s: Seg) -> P2:
  Bool.pick(P2, seg_circle(s), arc_mid(s), pscale(padd(seg_start(s), seg_end(s)), half()))

# Angle swept by one segment as seen from m.
def swept(+m: P2, +s: Seg) -> R.Real:
  +x = psub(seg_start(s), m)
  +y = psub(seg_end(s), m)
  +cr = cross2(x, y)
  +phi = R.atan2(cr, dot2(x, y))
  +c = seg_center(s)
  +r = seg_radius(s)
  +inside = R.less(norm2(psub(m, c)), R.mul(r, r))
  +ccw = seg_ccw(s)
  +turn = Bool.pick(R.Real, ccw, tau(), R.neg(tau()))
  +right = is_neg(cr)
  +in_region = Bool.and(inside, Bool.pick(Bool, ccw, right, Bool.not(right)))
  +arc = Bool.pick(R.Real, seg_full(s), Bool.pick(R.Real, inside, turn, zero()), Bool.pick(R.Real, in_region, R.add(phi, turn), phi))
  Bool.pick(R.Real, seg_circle(s), arc, phi)

def winding(segs: List<&2, Seg>, +m: P2) -> R.Real:
  match segs:
    case Nil{}:
      zero()
    case s <> rest:
      R.add(swept(m, s), winding(rest, m))

def clamp01(+t: R.Real) -> R.Real:
  Bool.pick(R.Real, is_neg(t), zero(), Bool.pick(R.Real, R.less(one(), t), one(), t))

def seg_distance(+m: P2, +s: Seg) -> R.Real:
  +a = seg_start(s)
  +b = seg_end(s)
  +d = psub(b, a)
  +t = clamp01(R.div(dot2(psub(m, a), d), norm2(d)))
  line_d = dist(m, padd(a, pscale(d, t)))
  +c = seg_center(s)
  +radial = R.abs(R.sub(dist(m, c), seg_radius(s)))
  +ends = R.min(dist(m, a), dist(m, b))
  arc_d = Bool.pick(R.Real, in_arc_open(s, m), radial, R.min(radial, ends))
  Bool.pick(R.Real, seg_circle(s), Bool.pick(R.Real, seg_full(s), radial, arc_d), line_d)

def min_distance(segs: List<&2, Seg>, +m: P2, +best: R.Real) -> R.Real:
  match segs:
    case Nil{}:
      best
    case s <> rest:
      min_distance(rest, m, R.min(best, seg_distance(m, s)))

def by_turns(+w: R.Real) -> Cls:
  +tol = R.from_f32(0.01)
  Bool.pick(Cls, R.less(R.abs(R.sub(w, one())), tol), Inside{}, Bool.pick(Cls, R.less(R.abs(w), tol), Outside{}, Unclear{24}))

def by_winding(+m: P2, +orig: List<&2, Seg>, +tol: Tol) -> Cls:
  +classify = tol_classify(tol)
  +clear = R.less(classify, min_distance(orig, m, R.from_f32(1000000000000.0)))
  Bool.pick(Cls, clear, by_turns(R.div(winding(orig, m), tau())), Unclear{23})

def classify_shared(free: Bool, +rel: U32, +p: Seg, +orig: List<&2, Seg>, +tol: Tol) -> Cls:
  match free:
    case True{}:
      by_winding(midpoint(p), orig, tol)
    case False{}:
      Bool.pick(Cls, U32.is_eq(rel, 1), SameDir{}, OppDir{})

def classify_when(+rel: U32, +p: Seg, +orig: List<&2, Seg>, +tol: Tol) -> Cls:
  classify_shared(U32.is_eq(rel, 0), rel, p, orig, tol)

# Operation 0 UNION, 1 INTERSECTION, 2 SUBTRACTION (src/boolean.mjs order).
def verdict(cls: Cls, +op: U32, +from_a: Bool) -> Keep:
  match cls:
    case Unclear{code}:
      Refuse{code}
    case Inside{}:
      Bool.pick(Keep, U32.is_eq(op, 0), Drop{}, Bool.pick(Keep, U32.is_eq(op, 1), Kept{}, Bool.pick(Keep, from_a, Drop{}, Flip{})))
    case Outside{}:
      Bool.pick(Keep, U32.is_eq(op, 0), Kept{}, Bool.pick(Keep, U32.is_eq(op, 1), Drop{}, Bool.pick(Keep, from_a, Kept{}, Drop{})))
    case SameDir{}:
      Bool.pick(Keep, Bool.and(from_a, Bool.not(U32.is_eq(op, 2))), Kept{}, Drop{})
    case OppDir{}:
      Bool.pick(Keep, Bool.and(from_a, U32.is_eq(op, 2)), Kept{}, Drop{})

def apply_keep(k: Keep, +p: Seg, rest: Segs) -> Segs:
  match k:
    case Drop{}:
      rest
    case Kept{}:
      segs_cons(p, rest)
    case Flip{}:
      segs_cons(reverse_seg(p), rest)
    case Refuse{code}:
      SegsBad{code}

# --- assembly ------------------------------------------------------------------

def count_from(segs: List<&2, Seg>, +p: P2) -> U32:
  match segs:
    case Nil{}:
      0
    case +s <> rest:
      (Bool.to_u32(same(seg_start(s), p)) + count_from(rest, p) : U32)

def count_to(segs: List<&2, Seg>, +p: P2) -> U32:
  match segs:
    case Nil{}:
      0
    case +s <> rest:
      (Bool.to_u32(same(seg_end(s), p)) + count_to(rest, p) : U32)

def degrees_ok(ks: List<&2, Seg>, +all: List<&2, Seg>) -> Bool:
  match ks:
    case Nil{}:
      True{}
    case +k <> rest:
      Bool.and(Bool.and(U32.is_eq(count_from(all, seg_end(k)), 1), U32.is_eq(count_to(all, seg_start(k)), 1)), degrees_ok(rest, all))

def take_put(taken: Take, +s: Seg) -> Take:
  match taken:
    case Taken{seg, rest}:
      Taken{seg, s <> rest}
    case Missing{rest}:
      Missing{s <> rest}

def take_from(pool: List<&2, Seg>, +at: P2) -> Take:
  match pool:
    case Nil{}:
      Missing{Nil{}}
    case +s <> +rest:
      Bool.pick(Take, same(seg_start(s), at), Taken{s, rest}, take_put(take_from(rest, at), s))

def next_of(taken: Take) -> Step:
  match taken:
    case Taken{seg, rest}:
      Next{seg, rest}
    case Missing{rest}:
      Stuck{rest}

def step_from(+at: P2, +goal: P2, +pool: List<&2, Seg>) -> Step:
  Bool.pick(Step, same(at, goal), Closed{pool}, next_of(take_from(pool, at)))

def chain(fuel: Nat, step: Step, +goal: P2, acc: List<&2, Seg>) -> Chain:
  match fuel step:
    case 0n _:
      Chain{False{}, acc, Nil{}}
    case 1n+f Closed{pool}:
      Chain{True{}, List.reverse(&2, Seg, acc), pool}
    case 1n+f Stuck{pool}:
      Chain{False{}, acc, pool}
    case 1n+f Next{+seg, pool}:
      chain(f, step_from(seg_end(seg), goal, pool), goal, seg <> acc)

def loops_put(loop: List<&2, Seg>, rest: Loops) -> Loops:
  match rest:
    case LoopsOk{loops}:
      LoopsOk{loop <> loops}
    case LoopsBad{code}:
      LoopsBad{code}

def loops_cons(ok: Bool, loop: List<&2, Seg>, rest: Loops) -> Loops:
  match ok:
    case False{}:
      LoopsBad{26}
    case True{}:
      loops_put(loop, rest)

def chain_ok(c: Chain) -> Bool:
  Chain{ok, _, _} = c
  ok

def chain_loop(c: Chain) -> List<&2, Seg>:
  Chain{_, loop, _} = c
  loop

def chain_pool(c: Chain) -> List<&2, Seg>:
  Chain{_, _, pool} = c
  pool

def assemble(fuel: Nat, pool: List<&2, Seg>, +limit: Nat) -> Loops:
  match fuel pool:
    case _ Nil{}:
      LoopsOk{Nil{}}
    case 0n Con{_, _}:
      LoopsBad{26}
    case 1n+f Con{+first, rest}:
      +c = chain(limit, step_from(seg_end(first), seg_start(first), rest), seg_start(first), [first])
      loops_cons(chain_ok(c), chain_loop(c), assemble(f, chain_pool(c), limit))

def joinable_when(on: Bool, +x: Seg, +y: Seg) -> Bool:
  match on:
    case False{}:
      False{}
    case True{}:
      +forward = is_pos(dot2(psub(seg_end(x), seg_start(x)), psub(seg_end(y), seg_start(y))))
      Bool.pick(Bool, seg_circle(x), Bool.not(Bool.xor(seg_ccw(x), seg_ccw(y))), forward)

# --- merging pieces on one carrier ------------------------------------------

def joinable(+x: Seg, +y: Seg) -> Bool:
  joinable_when(same_carrier(seg_carrier(x), seg_carrier(y)), x, y)

def join(x: Seg, y: Seg) -> Seg:
  Seg{carrier, start, _, ccw, _, xo} = x
  Seg{_, _, end, _, _, yo} = y
  Seg{carrier, start, end, ccw, False{}, List.append(&2, Origin, xo, yo)}

def merge_into(+x: Seg, rest: List<&2, Seg>) -> List<&2, Seg>:
  match rest:
    case Nil{}:
      [x]
    case +y <> +tail:
      Bool.pick(List<&2, Seg>, joinable(x, y), join(x, y) <> tail, x <> y <> tail)

def merge_run(xs: List<&2, Seg>) -> List<&2, Seg>:
  match xs:
    case Nil{}:
      Nil{}
    case x <> rest:
      merge_into(x, merge_run(rest))

def last_of(xs: List<&2, Seg>, +fallback: Seg) -> Seg:
  match xs:
    case Nil{}:
      fallback
    case x <> rest:
      last_of(rest, x)

# Index of the first piece whose predecessor (cyclically) is on another carrier.
def corner(xs: List<&2, Seg>, +prev: Seg, +i: Nat) -> Maybe<&2, Nat>:
  match xs:
    case Nil{}:
      None{}
    case +x <> rest:
      Bool.pick(Maybe<&2, Nat>, joinable(prev, x), corner(rest, x, 1n+i), Some{i})

def all_origins(xs: List<&2, Seg>) -> List<&2, Origin>:
  match xs:
    case Nil{}:
      Nil{}
    case s <> rest:
      List.append(&2, Origin, seg_origins(s), all_origins(rest))

def merge_at(at: Maybe<&2, Nat>, +first: Seg, +loop: List<&2, Seg>) -> Segs:
  match at:
    case None{}:
      Seg{carrier, start, _, ccw, _, _} = first
      +whole = {Seg{carrier, start, start, ccw, True{}, all_origins(loop)} : Seg}
      Bool.pick(Segs, seg_circle(whole), SegsOk{[whole]}, SegsBad{27})
    case Some{+i}:
      SegsOk{merge_run(List.append(&2, Seg, List.drop(&2, Seg, loop, i), List.take(&2, Seg, loop, i)))}

def merge_loop(+loop: List<&2, Seg>) -> Segs:
  match loop:
    case Nil{}:
      SegsBad{27}
    case +first <> _:
      merge_at(corner(loop, last_of(loop, first), 0n), first, loop)

def merged_put(m: Segs, rest: Loops) -> Loops:
  match m:
    case SegsOk{segs}:
      loops_put(segs, rest)
    case SegsBad{code}:
      LoopsBad{code}

def merge_loops(loops: List<&2, List<&2, Seg>>) -> Loops:
  match loops:
    case Nil{}:
      LoopsOk{Nil{}}
    case loop <> rest:
      merged_put(merge_loop(loop), merge_loops(rest))

# --- areas, orientation and nesting -----------------------------------------

def seg_area(+s: Seg) -> R.Real:
  +chord = R.mul(cross2(seg_start(s), seg_end(s)), half())
  +r = seg_radius(s)
  +mag = sweep(s)
  +sigma = Bool.pick(R.Real, seg_ccw(s), mag, R.neg(mag))
  arc = R.add(chord, R.mul(R.mul(R.mul(r, r), R.sub(sigma, R.sin(sigma))), half()))
  Bool.pick(R.Real, seg_circle(s), arc, chord)

def loop_area(segs: List<&2, Seg>) -> R.Real:
  match segs:
    case Nil{}:
      zero()
    case s <> rest:
      R.add(seg_area(s), loop_area(rest))

def largest(loops: List<&2, List<&2, Seg>>, +best: R.Real) -> R.Real:
  match loops:
    case Nil{}:
      best
    case +loop <> rest:
      +a = loop_area(loop)
      largest(rest, Bool.pick(R.Real, R.less(R.abs(best), R.abs(a)), a, best))

def flip_all(loops: List<&2, List<&2, Seg>>, +flip: Bool) -> List<&2, List<&2, Seg>>:
  match loops:
    case Nil{}:
      Nil{}
    case +loop <> rest:
      Bool.pick(List<&2, Seg>, flip, reverse_loop(loop, Nil{}), loop) <> flip_all(rest, flip)

def count_outer(loops: List<&2, List<&2, Seg>>, +guard: R.Real) -> U32:
  match loops:
    case Nil{}:
      0
    case +loop <> rest:
      (Bool.to_u32(R.less(guard, loop_area(loop))) + count_outer(rest, guard) : U32)

def all_clear(loops: List<&2, List<&2, Seg>>, +guard: R.Real) -> Bool:
  match loops:
    case Nil{}:
      True{}
    case +loop <> rest:
      Bool.and(R.less(guard, R.abs(loop_area(loop))), all_clear(rest, guard))

def concat_loops(loops: List<&2, List<&2, Seg>>) -> List<&2, Seg>:
  match loops:
    case Nil{}:
      Nil{}
    case loop <> rest:
      List.append(&2, Seg, loop, concat_loops(rest))

# One counterclockwise outer loop and clockwise holes (the bottom cap's loops
# in whatever orientation the body stored them).
def orient_profile(+loops: List<&2, List<&2, Seg>>, +guard: R.Real) -> Segs:
  +flipped = flip_all(loops, is_neg(largest(loops, zero())))
  +valid = Bool.and(all_clear(flipped, guard), U32.is_eq(count_outer(flipped, guard), 1))
  Bool.pick(Segs, valid, SegsOk{concat_loops(flipped)}, SegsBad{7})

def outer_loops(loops: List<&2, List<&2, Seg>>) -> List<&2, List<&2, Seg>>:
  match loops:
    case Nil{}:
      Nil{}
    case +loop <> rest:
      +tail = outer_loops(rest)
      Bool.pick(List<&2, List<&2, Seg>>, is_pos(loop_area(loop)), loop <> tail, tail)

def hole_loops(loops: List<&2, List<&2, Seg>>) -> List<&2, List<&2, Seg>>:
  match loops:
    case Nil{}:
      Nil{}
    case +loop <> rest:
      +tail = hole_loops(rest)
      Bool.pick(List<&2, List<&2, Seg>>, is_pos(loop_area(loop)), tail, loop <> tail)

def first_point(loop: List<&2, Seg>) -> P2:
  match loop:
    case Nil{}:
      P2{zero(), zero()}
    case s <> _:
      seg_start(s)

# The owner of a hole: the outer loop of least area around its first vertex.
# 4294967295: none; 4294967294: undecidable (too close to an outer loop).
def owner_of(outers: List<&2, List<&2, Seg>>, +p: P2, +i: U32, +best: U32, +best_area: R.Real, +tol: Tol) -> U32:
  match outers:
    case Nil{}:
      best
    case +loop <> rest:
      +classify = tol_classify(tol)
      +clear = R.less(classify, min_distance(loop, p, R.from_f32(1000000000000.0)))
      +inside = R.less(half(), R.div(winding(loop, p), tau()))
      +a = loop_area(loop)
      +better = Bool.and(inside, R.less(a, best_area))
      +next = owner_of(rest, p, (i + 1 : U32), Bool.pick(U32, better, i, best), Bool.pick(R.Real, better, a, best_area), tol)
      Bool.pick(U32, clear, next, 4294967294)

def place_holes(holes: List<&2, List<&2, Seg>>, +outers: List<&2, List<&2, Seg>>, +tol: Tol) -> List<&2, Placed>:
  match holes:
    case Nil{}:
      Nil{}
    case +hole <> rest:
      Placed{hole, owner_of(outers, first_point(hole), 0, 4294967295, R.from_f32(1000000000000.0), tol)} <> place_holes(rest, outers, tol)

def placed_ok(placed: List<&2, Placed>) -> Bool:
  match placed:
    case Nil{}:
      True{}
    case Placed{_, owner} <> rest:
      Bool.and(U32.is_lt(owner, 4294967294), placed_ok(rest))

def holes_of(placed: List<&2, Placed>, +i: U32) -> List<&2, List<&2, Seg>>:
  match placed:
    case Nil{}:
      Nil{}
    case Placed{+hole, owner} <> rest:
      +tail = holes_of(rest, i)
      Bool.pick(List<&2, List<&2, Seg>>, U32.is_eq(owner, i), hole <> tail, tail)

def components(outers: List<&2, List<&2, Seg>>, +placed: List<&2, Placed>, +i: U32) -> List<&2, List<&2, List<&2, Seg>>>:
  match outers:
    case Nil{}:
      Nil{}
    case outer <> rest:
      (outer <> holes_of(placed, i)) <> components(rest, placed, (i + 1 : U32))

# --- the 3D prism of one component -------------------------------------------

def coord(+v: G.Vec3, +k: U32) -> R.Real:
  G.V3{x, y, z} = v
  Bool.pick(R.Real, U32.is_eq(k, 0), x, Bool.pick(R.Real, U32.is_eq(k, 1), y, z))

def others_zero(+v: G.Vec3, +k: U32) -> Bool:
  G.V3{+x, +y, +z} = v
  Bool.pick(Bool, U32.is_eq(k, 0), Bool.and(is_zero(y), is_zero(z)),
    Bool.pick(Bool, U32.is_eq(k, 1), Bool.and(is_zero(z), is_zero(x)), Bool.and(is_zero(x), is_zero(y))))

# (u, v) = (y, z), (z, x), (x, y) for axis x, y, z: u x v = the axis.
def project(+p: G.Vec3, +k: U32) -> P2:
  G.V3{+x, +y, +z} = p
  Bool.pick(P2, U32.is_eq(k, 0), P2{y, z}, Bool.pick(P2, U32.is_eq(k, 1), P2{z, x}, P2{x, y}))

def lift(+q: P2, +h: R.Real, +k: U32) -> G.Vec3:
  P2{+a, +b} = q
  Bool.pick(G.Vec3, U32.is_eq(k, 0), G.V3{h, a, b}, Bool.pick(G.Vec3, U32.is_eq(k, 1), G.V3{b, h, a}, G.V3{a, b, h}))

def axis_dir(+k: U32) -> G.Vec3:
  lift(P2{zero(), zero()}, one(), k)

def u_dir(+k: U32) -> G.Vec3:
  lift(P2{one(), zero()}, zero(), k)

def loop_len(loop: List<&2, Seg>) -> U32:
  U32.from_nat(List.length(&2, Seg, loop))

def ring_vertices(segs: List<&2, Seg>, +h: R.Real, +k: U32) -> List<&2, G.Vec3>:
  match segs:
    case Nil{}:
      Nil{}
    case s <> rest:
      lift(seg_start(s), h, k) <> ring_vertices(rest, h, k)

def curve3(+s: Seg, +h: R.Real, +k: U32) -> A.Curve:
  +a = seg_start(s)
  Bool.pick(A.Curve, seg_circle(s), A.Circle{lift(seg_center(s), h, k), axis_dir(k), u_dir(k), seg_radius(s)},
    A.Line{lift(a, h, k), lift(unit(psub(seg_end(s), a)), zero(), k)})

def sense(+s: Seg) -> Bool:
  Bool.or(Bool.not(seg_circle(s)), seg_ccw(s))

def shared_when(on: Bool, +p: Seg, +q: Seg) -> U32:
  match on:
    case False{}:
      0
    case True{}:
      +ps = seg_start(p)
      +pe = seg_end(p)
      +qs = seg_start(q)
      +qe = seg_end(q)
      +forward = Bool.and(same(ps, qs), same(pe, qe))
      +backward = Bool.and(same(ps, qe), same(pe, qs))
      +circle = seg_circle(p)
      +sense = Bool.not(Bool.xor(seg_ccw(p), seg_ccw(q)))
      +full = Bool.and(seg_full(p), seg_full(q))
      +partial = Bool.and(Bool.not(seg_full(p)), Bool.not(seg_full(q)))
      line_rel = Bool.pick(U32, forward, 1, Bool.pick(U32, backward, 2, 0))
      full_rel = Bool.pick(U32, forward, Bool.pick(U32, sense, 1, 2), 0)
      arc_rel = Bool.pick(U32, Bool.and(forward, sense), 1, Bool.pick(U32, Bool.and(backward, Bool.not(sense)), 2, 0))
      Bool.pick(U32, circle, Bool.pick(U32, full, full_rel, Bool.pick(U32, partial, arc_rel, 0)), line_rel)

def shared_touch(touch: Bool, +p: Seg, +q: Seg) -> U32:
  match touch:
    case False{}:
      0
    case True{}:
      shared_when(same_carrier(seg_carrier(p), seg_carrier(q)), p, q)

# --- classification ----------------------------------------------------------

# 0: not the same piece of boundary; 1: the same, same direction; 2: opposite.
def shared_rel(+p: Seg, +q: Seg) -> U32:
  +ps = seg_start(p)
  +pe = seg_end(p)
  +qs = seg_start(q)
  +qe = seg_end(q)
  shared_touch(Bool.or(Bool.and(same(ps, qs), same(pe, qe)), Bool.and(same(ps, qe), same(pe, qs))), p, q)

def find_shared(qs: List<&2, Seg>, +p: Seg) -> U32:
  match qs:
    case Nil{}:
      0
    case +q <> rest:
      +rel = shared_rel(p, q)
      Bool.pick(U32, U32.is_eq(rel, 0), find_shared(rest, p), rel)

def select(ps: List<&2, Seg>, +others: List<&2, Seg>, +orig: List<&2, Seg>, +op: U32, +from_a: Bool, +tol: Tol) -> Segs:
  match ps:
    case Nil{}:
      SegsOk{Nil{}}
    case +p <> rest:
      apply_keep(verdict(classify_when(find_shared(others, p), p, orig, tol), op, from_a), p, select(rest, others, orig, op, from_a, tol))

def ring_edges(segs: List<&2, Seg>, +n: U32, +offset: U32, +i: U32, +shift: U32, +h: R.Real, +k: U32) -> List<&2, A.Edge>:
  match segs:
    case Nil{}:
      Nil{}
    case +s <> rest:
      A.Edge{(shift + offset + i : U32), (shift + offset + T.next(i, n) : U32), curve3(s, h, k), sense(s)} <>
        ring_edges(rest, n, offset, (i + 1 : U32), shift, h, k)

def loops_ring_edges(loops: List<&2, List<&2, Seg>>, +offset: U32, +shift: U32, +h: R.Real, +k: U32) -> List<&2, A.Edge>:
  match loops:
    case Nil{}:
      Nil{}
    case +loop <> rest:
      +n = loop_len(loop)
      List.append(&2, A.Edge, ring_edges(loop, n, offset, 0, shift, h, k), loops_ring_edges(rest, (offset + n : U32), shift, h, k))

def vertical_edges(segs: List<&2, Seg>, +count: U32, +i: U32, +low: R.Real, +k: U32) -> List<&2, A.Edge>:
  match segs:
    case Nil{}:
      Nil{}
    case s <> rest:
      A.Edge{i, (count + i : U32), A.Line{lift(seg_start(s), low, k), axis_dir(k)}, True{}} <> vertical_edges(rest, count, (i + 1 : U32), low, k)

def cap_loops(loops: List<&2, List<&2, Seg>>, +offset: U32, +first: Bool, +bottom: Bool) -> List<&2, A.Loop>:
  match loops:
    case Nil{}:
      Nil{}
    case +loop <> rest:
      +n = loop_len(loop)
      +uses = T.ring_uses(List.length(&2, Seg, loop), offset, 0)
      A.Loop{first, Bool.pick(List<&2, T.Coedge>, bottom, T.reverse_uses(uses, Nil{}), uses)} <> cap_loops(rest, (offset + n : U32), False{}, bottom)

def side_surface(+s: Seg, +low: R.Real, +k: U32) -> A.Surface:
  +a = seg_start(s)
  +tangent = lift(unit(psub(seg_end(s), a)), zero(), k)
  Bool.pick(A.Surface, seg_circle(s), A.Cylinder{lift(seg_center(s), low, k), axis_dir(k), u_dir(k), seg_radius(s)},
    A.Plane{lift(a, low, k), G.cross(tangent, axis_dir(k)), tangent})

def side_faces(segs: List<&2, Seg>, +n: U32, +offset: U32, +i: U32, +count: U32, +low: R.Real, +k: U32) -> List<&2, A.Face>:
  match segs:
    case Nil{}:
      Nil{}
    case +s <> rest:
      +j = (offset + i : U32)
      +next = (offset + T.next(i, n) : U32)
      loop = {A.Loop{True{}, [T.Use{j, True{}}, T.Use{(2 * count + next : U32), True{}}, T.Use{(count + j : U32), False{}}, T.Use{(2 * count + j : U32), False{}}]} : A.Loop}
      A.Face{side_surface(s, low, k), sense(s), [loop]} <> side_faces(rest, n, offset, (i + 1 : U32), count, low, k)

def loops_side_faces(loops: List<&2, List<&2, Seg>>, +offset: U32, +count: U32, +low: R.Real, +k: U32) -> List<&2, A.Face>:
  match loops:
    case Nil{}:
      Nil{}
    case +loop <> rest:
      +n = loop_len(loop)
      List.append(&2, A.Face, side_faces(loop, n, offset, 0, count, low, k), loops_side_faces(rest, (offset + n : U32), count, low, k))

def seg_range(+s: Seg) -> Range:
  +c = seg_center(s)
  +ts = angle_of(psub(seg_start(s), c))
  +te = angle_of(psub(seg_end(s), c))
  +first = Bool.pick(R.Real, seg_ccw(s), ts, te)
  +last = Bool.pick(R.Real, seg_ccw(s), te, ts)
  +lifted = Bool.pick(R.Real, R.less(first, last), last, R.add(last, tau()))
  Bool.pick(Range, Bool.and(seg_circle(s), Bool.not(seg_full(s))), Span{first, lifted}, NoRange{})

def ranges_of(segs: List<&2, Seg>) -> List<&2, Range>:
  match segs:
    case Nil{}:
      Nil{}
    case s <> rest:
      seg_range(s) <> ranges_of(rest)

def no_ranges(segs: List<&2, Seg>) -> List<&2, Range>:
  match segs:
    case Nil{}:
      Nil{}
    case _ <> rest:
      NoRange{} <> no_ranges(rest)

def side_origins(segs: List<&2, Seg>) -> List<&2, List<&2, Origin>>:
  match segs:
    case Nil{}:
      Nil{}
    case s <> rest:
      seg_origins(s) <> side_origins(rest)

# Bounds: the vertices and the axis extremes of every arc.
def box_add(+box: Box, +p: P2) -> Box:
  Box{lu, lv, hu, hv} = box
  P2{+u, +v} = p
  Box{R.min(lu, u), R.min(lv, v), R.max(hu, u), R.max(hv, v)}

def box_extreme(+box: Box, +s: Seg, +p: P2) -> Box:
  Bool.pick(Box, in_arc_open(s, p), box_add(box, p), box)

def box_seg(+box: Box, +s: Seg) -> Box:
  +c = seg_center(s)
  +r = seg_radius(s)
  +b0 = box_add(box, seg_start(s))
  +b1 = box_extreme(box_extreme(box_extreme(box_extreme(b0, s, padd(c, P2{r, zero()})), s, padd(c, P2{R.neg(r), zero()})),
    s, padd(c, P2{zero(), r})), s, padd(c, P2{zero(), R.neg(r)}))
  Bool.pick(Box, seg_circle(s), b1, b0)

def box_low(box: Box, +h: R.Real, +k: U32) -> G.Vec3:
  Box{lu, lv, _, _} = box
  lift(P2{lu, lv}, h, k)

def box_high(box: Box, +h: R.Real, +k: U32) -> G.Vec3:
  Box{_, _, hu, hv} = box
  lift(P2{hu, hv}, h, k)

def box_segs(segs: List<&2, Seg>, +box: Box) -> Box:
  match segs:
    case Nil{}:
      box
    case +s <> rest:
      box_segs(rest, box_seg(box, s))

def component_body(+loops: List<&2, List<&2, Seg>>, +low: R.Real, +high: R.Real, +k: U32, +bottom: List<&2, Origin>, +top: List<&2, Origin>) -> Body:
  +flat = concat_loops(loops)
  +count = loop_len(flat)
  +origin = {P2{zero(), zero()} : P2}
  +normal = axis_dir(k)
  +x = u_dir(k)
  vertices = List.append(&2, G.Vec3, ring_vertices(flat, low, k), ring_vertices(flat, high, k))
  edges = List.append(&2, A.Edge, loops_ring_edges(loops, 0, 0, low, k),
    List.append(&2, A.Edge, loops_ring_edges(loops, 0, count, high, k), vertical_edges(flat, count, 0, low, k)))
  bottom_face = {A.Face{A.Plane{lift(origin, low, k), normal, x}, False{}, cap_loops(loops, 0, True{}, True{})} : A.Face}
  top_face = {A.Face{A.Plane{lift(origin, high, k), normal, x}, True{}, cap_loops(loops, count, True{}, False{})} : A.Face}
  faces = {bottom_face <> top_face <> loops_side_faces(loops, 0, count, low, k) : List<&2, A.Face>}
  +area = loop_area(flat)
  +p0 = first_point(flat)
  +box = box_segs(flat, Box{pu(p0), pv(p0), pu(p0), pv(p0)})
  +ranges = ranges_of(flat)
  Body{A.Solid{vertices, edges, faces}, R.mul(area, R.sub(high, low)), area, box_low(box, low, k), box_high(box, high, k),
    List.append(&2, Range, ranges, List.append(&2, Range, ranges, no_ranges(flat))),
    bottom <> top <> side_origins(flat)}

def component_bodies(comps: List<&2, List<&2, List<&2, Seg>>>, +low: R.Real, +high: R.Real, +k: U32, +bottom: List<&2, Origin>, +top: List<&2, Origin>) -> List<&2, Body>:
  match comps:
    case Nil{}:
      Nil{}
    case loops <> rest:
      component_body(loops, low, high, k, bottom, top) <> component_bodies(rest, low, high, k, bottom, top)

# --- recognition -------------------------------------------------------------

def plane_kind(horizontal: Bool, +nk: R.Real, +h: R.Real, +same_sense: Bool) -> FaceKind:
  match horizontal:
    case True{}:
      KCap{h, Bool.not(Bool.xor(is_pos(nk), same_sense))}
    case False{}:
      Bool.pick(FaceKind, is_zero(nk), KSide{}, KBad{2})

def surface_kind(surface: A.Surface, +same_sense: Bool, +k: U32) -> FaceKind:
  match surface:
    case A.Plane{origin, +normal, _}:
      plane_kind(others_zero(normal, k), coord(normal, k), coord(origin, k), same_sense)
    case A.Cylinder{_, +axis, _, _}:
      Bool.pick(FaceKind, others_zero(axis, k), KSide{}, KBad{2})
    case _:
      KBad{1}

def face_kind(face: A.Face, +k: U32) -> FaceKind:
  match face:
    case A.Face{surface, same_sense, _}:
      surface_kind(surface, same_sense, k)

def scan_cap(rest: Scan, +cap: Cap) -> Scan:
  match rest:
    case Scan{code, caps}:
      Scan{code, cap <> caps}

def scan_put(kind: FaceKind, +i: U32, rest: Scan) -> Scan:
  match kind:
    case KCap{h, up}:
      scan_cap(rest, Cap{i, h, up})
    case KSide{}:
      rest
    case KBad{code}:
      Scan{code, Nil{}}

def scan(faces: List<&2, A.Face>, +k: U32, +i: U32) -> Scan:
  match faces:
    case Nil{}:
      Scan{0, Nil{}}
    case face <> rest:
      scan_put(face_kind(face, k), i, scan(rest, k, (i + 1 : U32)))

def cap_up(cap: Cap) -> Bool:
  Cap{_, _, up} = cap
  up

def cap_height(cap: Cap) -> R.Real:
  Cap{_, h, _} = cap
  h

def cap_index(cap: Cap) -> U32:
  Cap{i, _, _} = cap
  i

def cap_pair_last(more: List<&2, Cap>, +x: Cap, +y: Cap) -> Maybe<&2, CapPair>:
  match more:
    case Nil{}:
      +bottom = Bool.pick(Cap, cap_up(x), y, x)
      +top = Bool.pick(Cap, cap_up(x), x, y)
      +valid = Bool.and(Bool.not(Bool.xor(cap_up(x), Bool.not(cap_up(y)))), R.less(cap_height(bottom), cap_height(top)))
      Bool.pick(Maybe<&2, CapPair>, valid, Some{CapPair{bottom, top}}, None{})
    case _ <> _:
      None{}

def cap_pair_second(rest: List<&2, Cap>, +x: Cap) -> Maybe<&2, CapPair>:
  match rest:
    case Nil{}:
      None{}
    case +y <> more:
      cap_pair_last(more, x, y)

# Exactly one down cap below exactly one up cap: (bottom, top).
def cap_pair(caps: List<&2, Cap>) -> Maybe<&2, CapPair>:
  match caps:
    case Nil{}:
      None{}
    case +x <> rest:
      cap_pair_second(rest, x)

def vertices_on(vertices: List<&2, G.Vec3>, +k: U32, +low: R.Real, +high: R.Real) -> Bool:
  match vertices:
    case Nil{}:
      True{}
    case +p <> rest:
      +h = coord(p, k)
      Bool.and(Bool.or(R.equal(h, low), R.equal(h, high)), vertices_on(rest, k, low, high))

def uses_have(uses: List<&2, T.Coedge>, +e: U32) -> Bool:
  match uses:
    case Nil{}:
      False{}
    case T.Use{edge, _} <> rest:
      Bool.or(U32.is_eq(edge, e), uses_have(rest, e))

def loops_have(loops: List<&2, A.Loop>, +e: U32) -> Bool:
  match loops:
    case Nil{}:
      False{}
    case A.Loop{_, uses} <> rest:
      Bool.or(uses_have(uses, e), loops_have(rest, e))

def face_has(face: A.Face, +e: U32) -> Bool:
  match face:
    case A.Face{_, _, loops}:
      loops_have(loops, e)

# The face other than `exclude` that uses edge e (the side face of a cap edge).
def other_face(faces: List<&2, A.Face>, +e: U32, +exclude: U32, +i: U32) -> U32:
  match faces:
    case Nil{}:
      4294967295
    case face <> rest:
      Bool.pick(U32, Bool.and(U32.is_ne(i, exclude), face_has(face, e)), i, other_face(rest, e, exclude, (i + 1 : U32)))

def face_at(faces: List<&2, A.Face>, +i: U32) -> Maybe<&2, A.Face>:
  match faces:
    case Nil{}:
      None{}
    case +face <> rest:
      Bool.pick(Maybe<&2, A.Face>, U32.is_eq(i, 0), Some{face}, face_at(rest, (i - 1 : U32)))

def seg_ok(+s: Seg) -> Segs:
  SegsOk{[s]}

def circle_seg(axial: Bool, +ccw_edge: Bool, +forward: Bool, +c: P2, +r: R.Real, +ps: P2, +pt: P2, +full: Bool, +origin: Origin) -> Segs:
  match axial:
    case False{}:
      SegsBad{5}
    case True{}:
      +start = Bool.pick(P2, forward, ps, pt)
      +end = Bool.pick(P2, forward, pt, ps)
      +ccw = Bool.not(Bool.xor(ccw_edge, forward))
      +degenerate = Bool.or(Bool.not(is_pos(r)), Bool.and(Bool.not(full), same(start, end)))
      Bool.pick(Segs, degenerate, SegsBad{5}, seg_ok(Seg{CCircle{c, r}, start, end, ccw, full, [origin]}))

def curve_seg(curve: A.Curve, +s: U32, +t: U32, +same_sense: Bool, +forward: Bool, +ps: P2, +pt: P2, +k: U32, +origin: Origin) -> Segs:
  match curve:
    case A.Line{_, _}:
      +start = Bool.pick(P2, forward, ps, pt)
      +end = Bool.pick(P2, forward, pt, ps)
      Bool.pick(Segs, Bool.or(U32.is_eq(s, t), same(start, end)), SegsBad{5}, seg_ok(Seg{CLine{start, end}, start, end, True{}, False{}, [origin]}))
    case A.Circle{center, +normal, _, radius}:
      circle_seg(others_zero(normal, k), Bool.not(Bool.xor(is_pos(coord(normal, k)), same_sense)), forward,
        project(center, k), radius, ps, pt, U32.is_eq(s, t), origin)
    case _:
      SegsBad{5}

def edge_seg(edge: A.Edge, +forward: Bool, +vertices: List<&2, G.Vec3>, +k: U32, +origin: Origin) -> Segs:
  match edge:
    case A.Edge{+s, +t, curve, same_sense}:
      curve_seg(curve, s, t, same_sense, forward, project(A.vertex_at(vertices, s), k), project(A.vertex_at(vertices, t), k), k, origin)

def use_seg(use: T.Coedge, +edges: List<&2, A.Edge>, +vertices: List<&2, G.Vec3>, +faces: List<&2, A.Face>, +k: U32, +cap: U32, +operand: U32) -> Segs:
  match use:
    case T.Use{+e, forward}:
      edge_seg(A.edge_at(edges, e), forward, vertices, k, Origin{operand, other_face(faces, e, cap, 0)})

def loop_segs(uses: List<&2, T.Coedge>, +edges: List<&2, A.Edge>, +vertices: List<&2, G.Vec3>, +faces: List<&2, A.Face>, +k: U32, +cap: U32, +operand: U32) -> Segs:
  match uses:
    case Nil{}:
      SegsOk{Nil{}}
    case use <> rest:
      segs_join(use_seg(use, edges, vertices, faces, k, cap, operand), loop_segs(rest, edges, vertices, faces, k, cap, operand))

def face_loops(loops: List<&2, A.Loop>, +edges: List<&2, A.Edge>, +vertices: List<&2, G.Vec3>, +faces: List<&2, A.Face>, +k: U32, +cap: U32, +operand: U32) -> Loops:
  match loops:
    case Nil{}:
      LoopsOk{Nil{}}
    case A.Loop{_, uses} <> rest:
      merged_put(loop_segs(uses, edges, vertices, faces, k, cap, operand), face_loops(rest, edges, vertices, faces, k, cap, operand))

def cap_face_loops(face: Maybe<&2, A.Face>, +edges: List<&2, A.Edge>, +vertices: List<&2, G.Vec3>, +faces: List<&2, A.Face>, +k: U32, +cap: U32, +operand: U32) -> Loops:
  match face:
    case None{}:
      LoopsBad{6}
    case Some{A.Face{_, _, loops}}:
      face_loops(loops, edges, vertices, faces, k, cap, operand)

def prism_loops(loops: Loops, +low: R.Real, +high: R.Real, +bottom: U32, +top: U32) -> Prism:
  match loops:
    case LoopsOk{xs}:
      Prism{low, high, bottom, top, xs}
    case LoopsBad{code}:
      NotPrism{code}

def pair_first(pair: CapPair) -> Cap:
  CapPair{x, _} = pair
  x

def pair_second(pair: CapPair) -> Cap:
  CapPair{_, y} = pair
  y

def prism_pair(+pair: CapPair, +solid: A.Solid, +k: U32, +operand: U32) -> Prism:
  A.Solid{+vertices, +edges, +faces} = solid
  +bottom = pair_first(pair)
  +top = pair_second(pair)
  +low = cap_height(bottom)
  +high = cap_height(top)
  +b = cap_index(bottom)
  +loops = cap_face_loops(face_at(faces, b), edges, vertices, faces, k, b, operand)
  Bool.pick(Prism, vertices_on(vertices, k, low, high), prism_loops(loops, low, high, b, cap_index(top)), NotPrism{4})

def prism_caps(pair: Maybe<&2, CapPair>, +solid: A.Solid, +k: U32, +operand: U32) -> Prism:
  match pair:
    case None{}:
      NotPrism{3}
    case Some{pair}:
      prism_pair(pair, solid, k, operand)

def prism_scan(s: Scan, +solid: A.Solid, +k: U32, +operand: U32) -> Prism:
  match s:
    case Scan{+code, caps}:
      Bool.pick(Prism, U32.is_eq(code, 0), prism_caps(cap_pair(caps), solid, k, operand), NotPrism{code})

def recognize(+solid: A.Solid, +k: U32, +operand: U32) -> Prism:
  A.Solid{_, _, faces} = solid
  prism_scan(scan(faces, k, 0), solid, k, operand)

# --- the operation -------------------------------------------------------------

def seg_scale(+s: Seg) -> R.Real:
  +a = seg_start(s)
  +b = seg_end(s)
  +c = seg_center(s)
  +r = seg_radius(s)
  +ends = R.max(R.max(R.abs(pu(a)), R.abs(pv(a))), R.max(R.abs(pu(b)), R.abs(pv(b))))
  R.max(ends, R.add(R.max(R.abs(pu(c)), R.abs(pv(c))), r))

def segs_scale(segs: List<&2, Seg>, +best: R.Real) -> R.Real:
  match segs:
    case Nil{}:
      best
    case s <> rest:
      segs_scale(rest, R.max(best, seg_scale(s)))

def loops_scale(loops: List<&2, List<&2, Seg>>, +best: R.Real) -> R.Real:
  match loops:
    case Nil{}:
      best
    case loop <> rest:
      loops_scale(rest, segs_scale(loop, best))

def tolerance(+scale: R.Real) -> Tol:
  +snap = R.mul(scale, R.from_f32(0.00000001))
  Tol{snap, R.mul(scale, R.from_f32(0.00001)), R.mul(scale, R.from_f32(0.000000001)), R.mul(snap, snap)}

def region_loops(ka: Segs, kb: Segs) -> Segs:
  segs_join(ka, kb)

def kept_loops(kept: Segs) -> Loops:
  match kept:
    case SegsBad{code}:
      LoopsBad{code}
    case SegsOk{+segs}:
      +n = List.length(&2, Seg, segs)
      Bool.pick(Loops, degrees_ok(segs, segs), assemble(1n+n, segs, 1n+n), LoopsBad{25})

def region_selected(pa: Segs, pb: Segs, +sa: List<&2, Seg>, +sb: List<&2, Seg>, +op: U32, +tol: Tol) -> Loops:
  match pa pb:
    case SegsOk{+xa} SegsOk{+xb}:
      kept_loops(segs_join(select(xa, xb, sb, op, True{}, tol), select(xb, xa, sa, op, False{}, tol)))
    case SegsBad{code} _:
      LoopsBad{code}
    case SegsOk{_} SegsBad{code}:
      LoopsBad{code}

def region_checked(loops: Loops, +tol: Tol) -> Loops:
  match loops:
    case LoopsBad{code}:
      LoopsBad{code}
    case LoopsOk{+xs}:
      +guard = tol_area(tol)
      Bool.pick(Loops, all_clear(xs, guard), LoopsOk{xs}, LoopsBad{27})

def region_merged(loops: Loops, +tol: Tol) -> Loops:
  match loops:
    case LoopsBad{code}:
      LoopsBad{code}
    case LoopsOk{xs}:
      region_checked(merge_loops(xs), tol)

# The result loops of the 2D Boolean, merged, each of nonzero area.
def region(+sa: List<&2, Seg>, +sb: List<&2, Seg>, +op: U32, +tol: Tol) -> Loops:
  region_merged(region_selected(split_a(sa, sa, sb, tol), split_b(sb, sa, sb, tol), sa, sb, op, tol), tol)

def built(loops: Loops, +k: U32, +low: R.Real, +high: R.Real, +bottom: List<&2, Origin>, +top: List<&2, Origin>, +tol: Tol) -> Answer:
  match loops:
    case LoopsBad{code}:
      Declined{code, 0}
    case LoopsOk{+xs}:
      +outers = outer_loops(xs)
      +placed = place_holes(hole_loops(xs), outers, tol)
      Bool.pick(Answer, placed_ok(placed), Built{component_bodies(components(outers, placed, 0), low, high, k, bottom, top), k, low, high}, Declined{28, 0})

def cap_origin(+operand: U32, +height: R.Real, +at: R.Real, +face: U32) -> List<&2, Origin>:
  Bool.pick(List<&2, Origin>, R.equal(height, at), [Origin{operand, face}], Nil{})

# Result slab for the operation, or None when the caps do not fit it.
def slab(+op: U32, +la: R.Real, +ha: R.Real, +lb: R.Real, +hb: R.Real) -> Maybe<&2, SlabPair>:
  +equal = Bool.and(R.equal(la, lb), R.equal(ha, hb))
  +b_spans = Bool.and(at_most(lb, la), at_most(ha, hb))
  +a_spans = Bool.and(at_most(la, lb), at_most(hb, ha))
  +union = Bool.pick(Maybe<&2, SlabPair>, equal, Some{SlabPair{la, ha}}, None{})
  +subtract = Bool.pick(Maybe<&2, SlabPair>, b_spans, Some{SlabPair{la, ha}}, None{})
  +intersect = Bool.pick(Maybe<&2, SlabPair>, b_spans, Some{SlabPair{la, ha}}, Bool.pick(Maybe<&2, SlabPair>, a_spans, Some{SlabPair{lb, hb}}, None{}))
  Bool.pick(Maybe<&2, SlabPair>, U32.is_eq(op, 0), union, Bool.pick(Maybe<&2, SlabPair>, U32.is_eq(op, 1), intersect, subtract))

def run_profiles(pa: Segs, pb: Segs, +k: U32, +op: U32, +low: R.Real, +high: R.Real, +bottom: List<&2, Origin>, +top: List<&2, Origin>, +tol: Tol) -> Answer:
  match pa pb:
    case SegsOk{+sa} SegsOk{+sb}:
      built(region(sa, sb, op, tol), k, low, high, bottom, top, tol)
    case SegsBad{code} _:
      Declined{code, 0}
    case SegsOk{_} SegsBad{code}:
      Declined{code, 1}

def slab_low(pair: SlabPair) -> R.Real:
  SlabPair{x, _} = pair
  x

def slab_high(pair: SlabPair) -> R.Real:
  SlabPair{_, y} = pair
  y

def prism_low(p: Prism) -> R.Real:
  match p:
    case Prism{low, _, _, _, _}:
      low
    case NotPrism{_}:
      zero()

def prism_high(p: Prism) -> R.Real:
  match p:
    case Prism{_, high, _, _, _}:
      high
    case NotPrism{_}:
      zero()

def prism_bottom(p: Prism) -> U32:
  match p:
    case Prism{_, _, bottom, _, _}:
      bottom
    case NotPrism{_}:
      0

def prism_top(p: Prism) -> U32:
  match p:
    case Prism{_, _, _, top, _}:
      top
    case NotPrism{_}:
      0

def prism_loops_of(p: Prism) -> List<&2, List<&2, Seg>>:
  match p:
    case Prism{_, _, _, _, loops}:
      loops
    case NotPrism{_}:
      Nil{}

def run_pair(+pair: SlabPair, +a: Prism, +b: Prism, +k: U32, +op: U32) -> Answer:
  +low = slab_low(pair)
  +high = slab_high(pair)
  +la = prism_loops_of(a)
  +lb = prism_loops_of(b)
  +scale = R.max(one(), loops_scale(lb, loops_scale(la, zero())))
  +tol = tolerance(scale)
  +guard = tol_area(tol)
  +bottom = List.append(&2, Origin, cap_origin(0, prism_low(a), low, prism_bottom(a)), cap_origin(1, prism_low(b), low, prism_bottom(b)))
  +top = List.append(&2, Origin, cap_origin(0, prism_high(a), high, prism_top(a)), cap_origin(1, prism_high(b), high, prism_top(b)))
  run_profiles(orient_profile(la, guard), orient_profile(lb, guard), k, op, low, high, bottom, top, tol)

def run_slab(s: Maybe<&2, SlabPair>, +a: Prism, +b: Prism, +k: U32, +op: U32) -> Answer:
  match s:
    case None{}:
      Declined{10, 0}
    case Some{pair}:
      run_pair(pair, a, b, k, op)

def is_prism(p: Prism) -> Bool:
  match p:
    case Prism{_, _, _, _, _}:
      True{}
    case NotPrism{_}:
      False{}

def prism_code(p: Prism) -> U32:
  match p:
    case Prism{_, _, _, _, _}:
      0
    case NotPrism{code}:
      code

def along_both(both: Bool, +declined: Answer, +a: Prism, +b: Prism, +k: U32, +op: U32) -> Answer:
  match both:
    case False{}:
      declined
    case True{}:
      run_slab(slab(op, prism_low(a), prism_high(a), prism_low(b), prism_high(b)), a, b, k, op)

def along_prisms(+a: Prism, +b: Prism, +k: U32, +op: U32) -> Answer:
  +both = Bool.and(is_prism(a), is_prism(b))
  +declined = Bool.pick(Answer, is_prism(a), Declined{prism_code(b), 1}, Declined{prism_code(a), 0})
  along_both(both, declined, a, b, k, op)

def along(+a: A.Solid, +b: A.Solid, +op: U32, +k: U32) -> Answer:
  along_prisms(recognize(a, k, 0), recognize(b, k, 1), k, op)

# Of two declines along different axes the one that got further (the higher
# code: recognition < cap planes < region) is reported.
def further(next: Answer, +code: U32, +detail: U32) -> Answer:
  match next:
    case Built{bodies, axis, low, high}:
      Built{bodies, axis, low, high}
    case Declined{+c, +d}:
      Bool.pick(Answer, U32.is_lt(c, code), Declined{code, detail}, Declined{c, d})

def retry_code(again: Bool, +code: U32, +detail: U32, +a: A.Solid, +b: A.Solid, +op: U32, +k: U32) -> Answer:
  match again:
    case True{}:
      further(along(a, b, op, k), code, detail)
    case False{}:
      Declined{code, detail}

# Recognition and cap-plane declines (codes below 20) try the next axis; the
# decline reported is the one that got furthest.
def retry(first: Answer, +a: A.Solid, +b: A.Solid, +op: U32, +k: U32) -> Answer:
  match first:
    case Built{bodies, axis, low, high}:
      Built{bodies, axis, low, high}
    case Declined{+code, +detail}:
      retry_code(U32.is_lt(code, 20), code, detail, a, b, op, k)

def boolean(+a: A.Solid, +b: A.Solid, +op: U32) -> Answer:
  retry(retry(along(a, b, op, 2), a, b, op, 1), a, b, op, 0)
