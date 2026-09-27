import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A

# Volume of an analytic B-rep with a stated error bound (host: src/volume.mjs).
#
# V = sum over faces f of the flux of F = (p - c) / 3 through f (divergence
# theorem; c is a reference point near the body). Per face a field F_f with
# div F_f = 1 is chosen for the carrier; F - F_f is divergence free, so its
# flux through f is the boundary integral of a vector potential (Stokes):
#
#   plane (o, n), cylinder (o, a): F_f = ((p - o).a) a is tangent to the
#     carrier, flux_f = -(1/3) J + (o - c).E / 6, where along the boundary
#     J = int (q.a) [a, q, dq] (q = p - o) and E = int (p - c) x dp;
#   cone: F_f = (p - apex) / 3 is tangent, flux_f = (apex - c).E / 6;
#   sphere (centre o, radius rho): F_f = (p - o) / 3, flux of F_f = s rho/3
#     times the face area, the area by Green's theorem in (latitude,
#     longitude) of a frame whose poles avoid the boundary, modulo the whole
#     sphere;
#   torus: F_f = (p - o) / 3, flux of F_f = the boundary integral of A(u) dv,
#     A closed-form in the tube angle u, modulo the whole torus.
#
# Every boundary integral of a plane, cylinder or cone face is closed-form on
# lines and conics (circle and ellipse arcs, p = m + U cos t + V sin t).
# Sphere and torus faces use adaptive 10-point Gauss-Legendre along the edges,
# with the estimate |G(whole) - G(halves)| of each accepted interval summed as
# the quadrature bound. A result is labelled closed-form only when no face
# needed quadrature.
#
# Each edge runs from its start vertex to its end vertex: a line edge is the
# vertex segment, a conic edge is its arc plus two straight connectors from
# the vertices to the arc ends (zero for exact input), so every loop closes
# exactly and the vector-area term E does not depend on an origin.
#
# Extension point: an implicit two-carrier intersection curve would be one more
# Piece kind whose sample() Newton-refines a seed onto both carriers; the
# quadrature below is generic over sample().

def rf(x: F32) -> R.Real:
  R.from_f32(x)

def zero() -> R.Real:
  R.from_f32(0.0)

def tau() -> R.Real:
  R.mul(R.pi(), rf(2.0))

def origin() -> G.Vec3:
  G.v3(0.0, 0.0, 0.0)

def triple(a: G.Vec3, b: G.Vec3, c: G.Vec3) -> R.Real:
  G.dot(a, G.cross(b, c))

def sq(+x: R.Real) -> R.Real:
  R.mul(x, x)

def half(x: R.Real) -> R.Real:
  R.div(x, rf(2.0))

def sign(+positive: Bool) -> R.Real:
  Bool.pick(R.Real, positive, rf(1.0), rf(F32.neg(1.0)))

# --- input -------------------------------------------------------------------

# An explicit curve parameter interval [first, last] (first < last), traversed
# forward when the edge has the curve's sense, else backward (the curveRange
# convention of the body format and of STEP TRIMMED_CURVE).
type Range is Data:
  Free{}
  Span{first: R.Real, last: R.Real}

# One coedge with its edge geometry: the host flattens face -> loops -> uses.
#
# Meet (certified-mesh bodies, docs/hybrid-mesh-bodies.md): one boundary
# segment of a mesh patch, from mesh vertex a to mesh vertex b, lying on the
# intersection curve of the carriers s1 and s2 (the face's own carrier and
# its neighbour's, in a canonical order shared by both faces). ca and cb are
# every carrier meeting at a and b (canonical order); the seeds are refined
# onto them first. forward: the face traverses a -> b.
type Use is Data:
  Use{curve: A.Curve, start: G.Vec3, end: G.Vec3, closed: Bool, sense: Bool, range: Range, forward: Bool}
  Meet{a: G.Vec3, b: G.Vec3, ca: List<&2, A.Surface>, cb: List<&2, A.Surface>, s1: A.Surface, s2: A.Surface, forward: Bool}

# One triangle of a mesh patch (its orientation is the patch's outward side).
type Tri3 is Data:
  Tri3{a: G.Vec3, b: G.Vec3, c: G.Vec3}

# whole: every edge of the face is used twice in it (seams only), so the face
# is the entire closed carrier (a full sphere or torus).
#
# MFace: one patch of a certified-mesh body (connected triangles on one
# carrier): its carrier, its triangles (only needed for the orientation of a
# sphere or torus patch; Nil otherwise), whether it has no boundary at all,
# and its boundary loops of Meet uses.
type VFace is Data:
  VFace{surface: A.Surface, sense: Bool, whole: Bool, loops: List<&2, List<&2, Use>>}
  MFace{surface: A.Surface, tris: List<&2, Tri3>, whole: Bool, loops: List<&2, List<&2, Use>>}

# Refusal codes (volume in kernel/volume.bend):
#   1  sphere face: no candidate polar axis keeps both poles off its boundary
#   2  sphere face: the area is within its bound of zero modulo the sphere
#      (the region is empty or the whole sphere; undecided)
#   3  torus face on a spindle or horn torus (minor radius >= major radius)
#   4  torus face with a loop that winds around the tube (no seam)
#   5  torus face: the parameter area is within its bound of zero modulo the
#      torus (undecided)
#   6  adaptive quadrature did not reach its tolerance within 24 halvings
#   7  mesh patch: Newton did not bring a boundary point within 1e-9 mm of
#      both carriers of its segment
#   8  mesh patch: a boundary segment's exact curve is not monotone along its
#      chord (tangent more than 60 degrees off the chord)
#   9  mesh patch without a boundary on a plane, cylinder or cone carrier
#   10 mesh patch whose triangles do not agree on a side of their carrier
type Volume is Data:
  Measured{volume: R.Real, bound: R.Real, quadrature: U32, faces: U32}
  Refused{code: U32, face: U32}

# --- carriers as implicit functions (certified-mesh boundaries) ---------------

def vlen(+v: G.Vec3) -> R.Real:
  R.sqrt(G.dot(v, v))

# Implicit value (the signed distance to first order) and unit gradient of a
# carrier at p. Cone: radius r + h tan(angle) at height h = (p - o).a, value
# (rho - r - h tan) cos, the distance to the cone away from its apex.
type FG is Data:
  FG{f: R.Real, g: G.Vec3}

def fg_f(q: FG) -> R.Real:
  FG{f, _} = q
  f

def fg_g(q: FG) -> G.Vec3:
  FG{_, g} = q
  g

def carrier_fg(s: A.Surface, +p: G.Vec3) -> FG:
  match s:
    case A.Plane{o, n, _}:
      +k = G.normalize(n)
      FG{G.dot(G.sub(p, o), k), k}
    case A.Cylinder{o, a, _, r}:
      +rad = A.radial(p, o, G.normalize(a))
      FG{R.sub(vlen(rad), r), G.normalize(rad)}
    case A.Cone{o, a, _, r, +angle}:
      +k = G.normalize(a)
      +d = G.sub(p, o)
      +h = G.dot(d, k)
      +rad = G.sub(d, G.scale(k, h))
      +cs = R.cos(angle)
      +sn = R.sin(angle)
      FG{R.mul(R.sub(R.sub(vlen(rad), r), R.mul(h, R.div(sn, cs))), cs), G.sub(G.scale(G.normalize(rad), cs), G.scale(k, sn))}
    case A.Sphere{o, _, _, r}:
      +d = G.sub(p, o)
      FG{R.sub(vlen(d), r), G.normalize(d)}
    case A.Torus{o, axis, _, big, small}:
      +k = G.normalize(axis)
      +d = G.sub(p, o)
      +h = G.dot(d, k)
      +rad = G.sub(d, G.scale(k, h))
      +w = G.add(G.scale(G.normalize(rad), R.sub(vlen(rad), big)), G.scale(k, h))
      FG{R.sub(vlen(w), small), G.normalize(w)}

# Least-squares Newton (Levenberg-Marquardt with a fixed tiny damping) on
# every carrier of the list: p <- p - (J^T J + mu I)^-1 J^T f over the unit
# gradients J. Two carriers: the minimum-norm step onto their curve; three or
# more: the corner; dependent gradients (tangent carriers) are damped rather
# than divided by zero. Sums of g g^T and f g:
type Normal is Data:
  Normal{xx: R.Real, yy: R.Real, zz: R.Real, xy: R.Real, xz: R.Real, yz: R.Real, b: G.Vec3, res: R.Real}

def normal_add(q: FG, acc: Normal) -> Normal:
  FG{+f, g} = q
  G.V3{+gx, +gy, +gz} = g
  Normal{xx, yy, zz, xy, xz, yz, b, res} = acc
  Normal{R.add(xx, R.mul(gx, gx)), R.add(yy, R.mul(gy, gy)), R.add(zz, R.mul(gz, gz)), R.add(xy, R.mul(gx, gy)),
    R.add(xz, R.mul(gx, gz)), R.add(yz, R.mul(gy, gz)), G.add(b, G.scale(G.V3{gx, gy, gz}, f)), R.max(res, R.abs(f))}

def normal_sum(ss: List<&2, A.Surface>, +p: G.Vec3, acc: Normal) -> Normal:
  match ss:
    case Nil{}:
      acc
    case s <> rest:
      normal_sum(rest, p, normal_add(carrier_fg(s, p), acc))

def normal_res(n: Normal) -> R.Real:
  Normal{_, _, _, _, _, _, _, res} = n
  res

def damping() -> R.Real:
  rf(0.000000000001)

# The symmetric matrix [[m11 m12 m13] [m12 m22 m23] [m13 m23 m33]] times v,
# scaled by k.
def sym_apply(v: G.Vec3, +m11: R.Real, +m12: R.Real, +m13: R.Real, +m22: R.Real, +m23: R.Real, +m33: R.Real, +k: R.Real) -> G.Vec3:
  G.V3{+bx, +by, +bz} = v
  G.scale(G.V3{R.add(R.mul(m11, bx), R.add(R.mul(m12, by), R.mul(m13, bz))),
    R.add(R.mul(m12, bx), R.add(R.mul(m22, by), R.mul(m23, bz))),
    R.add(R.mul(m13, bx), R.add(R.mul(m23, by), R.mul(m33, bz)))}, k)

# (M + mu I)^-1 b for the symmetric M of the sums, by its adjugate.
def normal_step(n: Normal) -> G.Vec3:
  Normal{xx, yy, zz, +d, +e, +f, b, _} = n
  +a = R.add(xx, damping())
  +bb = R.add(yy, damping())
  +c = R.add(zz, damping())
  +m11 = R.sub(R.mul(bb, c), R.mul(f, f))
  +m12 = R.sub(R.mul(e, f), R.mul(d, c))
  +m13 = R.sub(R.mul(d, f), R.mul(bb, e))
  +m22 = R.sub(R.mul(a, c), R.mul(e, e))
  +m23 = R.sub(R.mul(d, e), R.mul(a, f))
  +m33 = R.sub(R.mul(a, bb), R.mul(d, d))
  +det = R.add(R.mul(a, m11), R.add(R.mul(d, m12), R.mul(e, m13)))
  sym_apply(b, m11, m12, m13, m22, m23, m33, R.div(rf(1.0), det))

def empty_normal() -> Normal:
  Normal{zero(), zero(), zero(), zero(), zero(), zero(), origin(), zero()}

# Stops once every value is below 1e-13 mm (F32x2 carries about 48 bits), or
# after `fuel` steps (tangent carriers converge linearly).
def newton_go(fuel: Nat, done: Bool, +ss: List<&2, A.Surface>, +p: G.Vec3, n: Normal) -> G.Vec3:
  match fuel done:
    case _ True{}:
      p
    case 0n False{}:
      p
    case 1n+rest False{}:
      +q = G.sub(p, normal_step(n))
      +next = normal_sum(ss, q, empty_normal())
      newton_go(rest, R.less(normal_res(next), rf(0.000000000001)), ss, q, next)

def newton_onto(+ss: List<&2, A.Surface>, +p: G.Vec3) -> G.Vec3:
  +n = normal_sum(ss, p, empty_normal())
  newton_go(40n, R.less(normal_res(n), rf(0.000000000001)), ss, p, n)

# A plane through p with normal k, as a carrier (the chord constraint).
def chord_plane(+p: G.Vec3, +k: G.Vec3) -> A.Surface:
  A.Plane{p, k, A.axis_x(k)}

# The point of the s1/s2 curve in the plane normal to the chord a -> b at
# parameter t, and its derivative in t: the curve tangent T = g1 x g2 scaled
# so that its chord component is |b - a| (the plane moves by |b - a| per unit
# t).
type On is Data:
  On{p: G.Vec3, dp: G.Vec3, res: R.Real, cosine: R.Real}

def trace_at(+a: G.Vec3, +b: G.Vec3, +s1: A.Surface, +s2: A.Surface, +t: R.Real) -> On:
  +chord = G.sub(b, a)
  +k = G.normalize(chord)
  +seed = G.add(a, G.scale(chord, t))
  +p = newton_onto([s1, s2, chord_plane(seed, k)], seed)
  +q1 = carrier_fg(s1, p)
  +q2 = carrier_fg(s2, p)
  +tangent = G.cross(fg_g(q1), fg_g(q2))
  +along = G.dot(tangent, chord)
  On{p, G.scale(tangent, R.div(G.dot(chord, chord), along)), R.max(R.abs(fg_f(q1)), R.abs(fg_f(q2))),
    R.div(R.abs(G.dot(tangent, k)), R.add(vlen(tangent), rf(0.000000000000000000001)))}

def on_p(x: On) -> G.Vec3:
  On{p, _, _, _} = x
  p

def on_dp(x: On) -> G.Vec3:
  On{_, dp, _, _} = x
  dp

def on_res(x: On) -> R.Real:
  On{_, _, res, _} = x
  res

def on_cosine(x: On) -> R.Real:
  On{_, _, _, cosine} = x
  cosine

# --- pieces --------------------------------------------------------------------

# Seg: a straight segment a -> b, parameter [0, 1].
# Conic: m + u cos t + v sin t (u perpendicular to v) from t0 to t1.
# Trace: the s1/s2 intersection curve between the points a and b (both on
#   it), sampled by trace_at; parameter t0 -> t1 with {t0, t1} = {0, 1}.
# Chord: a boundary segment between two tangent carriers, taken as the
#   straight segment a -> b (its bound is stated, see chord_err).
type Piece is Data:
  Seg{a: G.Vec3, b: G.Vec3}
  Conic{m: G.Vec3, u: G.Vec3, v: G.Vec3, t0: R.Real, t1: R.Real}
  Trace{a: G.Vec3, b: G.Vec3, s1: A.Surface, s2: A.Surface, t0: R.Real, t1: R.Real}
  Chord{a: G.Vec3, b: G.Vec3, s1: A.Surface, s2: A.Surface}

def conic_at(+u: G.Vec3, +v: G.Vec3, +t: R.Real) -> G.Vec3:
  G.add(G.scale(u, R.cos(t)), G.scale(v, R.sin(t)))

def conic_param(+m: G.Vec3, +u: G.Vec3, +v: G.Vec3, p: G.Vec3) -> R.Real:
  +d = G.sub(p, m)
  R.atan2(R.div(G.dot(d, v), G.dot(v, v)), R.div(G.dot(d, u), G.dot(u, u)))

def forward_turn(+d: R.Real) -> R.Real:
  Bool.pick(R.Real, R.less(zero(), d), d, R.add(d, tau()))

def backward_turn(+d: R.Real) -> R.Real:
  Bool.pick(R.Real, R.less(d, zero()), d, R.sub(d, tau()))

type Ends is Data:
  Ends{ts: R.Real, te: R.Real}

# Parameters at the start and end vertex of an edge, in traversal order.
def free_ends(closed: Bool, +sense: Bool, +ts: R.Real, +te: R.Real) -> Ends:
  match closed:
    case True{}:
      Ends{ts, Bool.pick(R.Real, sense, R.add(ts, tau()), R.sub(ts, tau()))}
    case False{}:
      +d = R.sub(te, ts)
      Ends{ts, R.add(ts, Bool.pick(R.Real, sense, forward_turn(d), backward_turn(d)))}

def edge_ends(range: Range, +closed: Bool, +sense: Bool, +m: G.Vec3, +u: G.Vec3, +v: G.Vec3, +start: G.Vec3, +end: G.Vec3) -> Ends:
  match range:
    case Free{}:
      free_ends(closed, sense, conic_param(m, u, v, start), conic_param(m, u, v, end))
    case Span{+first, +last}:
      Ends{Bool.pick(R.Real, sense, first, last), Bool.pick(R.Real, sense, last, first)}

def conic_pieces(forward: Bool, +m: G.Vec3, +u: G.Vec3, +v: G.Vec3, ends: Ends, +start: G.Vec3, +end: G.Vec3) -> List<&2, Piece>:
  match forward:
    case True{}:
      Ends{+ts, +te} = ends
      [Seg{start, G.add(m, conic_at(u, v, ts))}, Conic{m, u, v, ts, te}, Seg{G.add(m, conic_at(u, v, te)), end}]
    case False{}:
      Ends{+ts, +te} = ends
      [Seg{end, G.add(m, conic_at(u, v, te))}, Conic{m, u, v, te, ts}, Seg{G.add(m, conic_at(u, v, ts)), start}]

# A unit x perpendicular to the unit normal (input frames carry rounding).
def in_plane(+n: G.Vec3, +x: G.Vec3) -> G.Vec3:
  G.normalize(G.sub(x, G.scale(n, G.dot(x, n))))

def curve_pieces(curve: A.Curve, +start: G.Vec3, +end: G.Vec3, +closed: Bool, +sense: Bool, range: Range, +forward: Bool) -> List<&2, Piece>:
  match curve:
    case A.Line{_, _}:
      [Bool.pick(Piece, forward, Seg{start, end}, Seg{end, start})]
    case A.Circle{+m, n, x, +r}:
      +k = G.normalize(n)
      +i = in_plane(k, x)
      +u = G.scale(i, r)
      +v = G.scale(G.cross(k, i), r)
      conic_pieces(forward, m, u, v, edge_ends(range, closed, sense, m, u, v, start, end), start, end)
    case A.Ellipse{+m, n, x, +major, +minor}:
      +k = G.normalize(n)
      +i = in_plane(k, x)
      +u = G.scale(i, major)
      +v = G.scale(G.cross(k, i), minor)
      conic_pieces(forward, m, u, v, edge_ends(range, closed, sense, m, u, v, start, end), start, end)

# |g1 x g2|: the sine of the angle between the two carriers at p.
def transversal(s1: A.Surface, s2: A.Surface, +p: G.Vec3) -> R.Real:
  vlen(G.cross(fg_g(carrier_fg(s1, p)), fg_g(carrier_fg(s2, p))))

# A mesh boundary segment: both seeds refined onto every carrier at their
# vertex, then the exact s1/s2 curve between them (Trace), or the straight
# chord where the carriers are tangent at an end (Chord; checked in
# chord_check). The refinement depends only on the seed and the canonical
# carrier list, so the two faces of a segment get the same piece.
def meet_pieces(+pa: G.Vec3, +pb: G.Vec3, +s1: A.Surface, +s2: A.Surface, +forward: Bool) -> List<&2, Piece>:
  +tangent = R.less(R.min(transversal(s1, s2, pa), transversal(s1, s2, pb)), rf(0.001))
  +t0 = Bool.pick(R.Real, forward, zero(), rf(1.0))
  +t1 = Bool.pick(R.Real, forward, rf(1.0), zero())
  Bool.pick(List<&2, Piece>, tangent, [Bool.pick(Piece, forward, Chord{pa, pb, s1, s2}, Chord{pb, pa, s1, s2})], [Trace{pa, pb, s1, s2, t0, t1}])

def use_pieces(use: Use) -> List<&2, Piece>:
  match use:
    case Use{curve, start, end, closed, sense, range, forward}:
      curve_pieces(curve, start, end, closed, sense, range, forward)
    case Meet{a, b, +ca, +cb, s1, s2, forward}:
      meet_pieces(newton_onto(ca, a), newton_onto(cb, b), s1, s2, forward)

def onto(pieces: List<&2, Piece>, acc: List<&2, Piece>) -> List<&2, Piece>:
  match pieces:
    case Nil{}:
      acc
    case piece <> rest:
      onto(rest, piece <> acc)

# Tail-recursive: loops of a thousand edges (a gear) stay off the JS stack.
def loop_pieces(uses: List<&2, Use>, acc: List<&2, Piece>) -> List<&2, Piece>:
  match uses:
    case Nil{}:
      List.reverse(&2, Piece, acc)
    case use <> rest:
      loop_pieces(rest, onto(use_pieces(use), acc))

def face_loops(loops: List<&2, List<&2, Use>>) -> List<&2, List<&2, Piece>>:
  match loops:
    case Nil{}:
      Nil{}
    case uses <> rest:
      loop_pieces(uses, Nil{}) <> face_loops(rest)

def piece_start(piece: Piece) -> G.Vec3:
  match piece:
    case Seg{a, _}:
      a
    case Conic{m, +u, +v, t0, _}:
      G.add(m, conic_at(u, v, t0))
    case Trace{a, b, _, _, t0, _}:
      Bool.pick(G.Vec3, R.less(t0, rf(0.5)), a, b)
    case Chord{a, _, _, _}:
      a

# --- closed-form boundary integrals ------------------------------------------

# E = int (p - c) x dp along the piece.
def piece_e(piece: Piece, +c: G.Vec3) -> G.Vec3:
  match piece:
    case Seg{a, b}:
      G.cross(G.sub(a, c), G.sub(b, c))
    case Conic{m, +u, +v, +t0, +t1}:
      +chord = G.sub(conic_at(u, v, t1), conic_at(u, v, t0))
      G.add(G.cross(G.sub(m, c), chord), G.scale(G.cross(u, v), R.sub(t1, t0)))
    case Trace{_, _, _, _, _, _}:
      origin()
    case Chord{a, b, _, _}:
      G.cross(G.sub(a, c), G.sub(b, c))

def sum_e(pieces: List<&2, Piece>, +c: G.Vec3, acc: G.Vec3) -> G.Vec3:
  match pieces:
    case Nil{}:
      acc
    case piece <> rest:
      sum_e(rest, c, G.add(acc, piece_e(piece, c)))

def sum_e_loops(loops: List<&2, List<&2, Piece>>, +c: G.Vec3, acc: G.Vec3) -> G.Vec3:
  match loops:
    case Nil{}:
      acc
    case pieces <> rest:
      sum_e_loops(rest, c, sum_e(pieces, c, acc))

# J = int (q.a) [a, q, dq], q = p - o. On a conic, with m' = m - o,
# (q.a) = m'a + Ua cos t + Va sin t and [a, q, dq/dt] = T3 + T2 cos t - T1 sin t
# (T1 = [a, m', U], T2 = [a, m', V], T3 = [a, U, V]); the product is a
# trigonometric polynomial of degree 2, integrated in closed form.
def piece_j(piece: Piece, +o: G.Vec3, +a: G.Vec3) -> R.Real:
  match piece:
    case Seg{+p0, +p1}:
      +q0 = G.sub(p0, o)
      +q1 = G.sub(p1, o)
      half(R.mul(triple(a, q0, G.sub(p1, p0)), G.dot(G.add(q0, q1), a)))
    case Conic{m, +u, +v, +t0, +t1}:
      +mp = G.sub(m, o)
      +ma = G.dot(mp, a)
      +ua = G.dot(u, a)
      +va = G.dot(v, a)
      +k1 = triple(a, mp, u)
      +k2 = triple(a, mp, v)
      +k3 = triple(a, u, v)
      +c0 = R.cos(t0)
      +s0 = R.sin(t0)
      +c1 = R.cos(t1)
      +s1 = R.sin(t1)
      +dt = R.sub(t1, t0)
      +d2 = half(R.sub(R.mul(s1, c1), R.mul(s0, c0)))
      +cc = R.add(half(dt), d2)
      +ss = R.sub(half(dt), d2)
      +sc = half(R.sub(sq(s1), sq(s0)))
      +i0 = R.mul(R.mul(ma, k3), dt)
      +i1 = R.mul(R.add(R.mul(ma, k2), R.mul(ua, k3)), R.sub(s1, s0))
      +i2 = R.mul(R.sub(R.mul(va, k3), R.mul(ma, k1)), R.sub(c0, c1))
      +i3 = R.sub(R.mul(R.mul(ua, k2), cc), R.mul(R.mul(va, k1), ss))
      +i4 = R.mul(R.sub(R.mul(va, k2), R.mul(ua, k1)), sc)
      R.add(R.add(i0, i1), R.add(i2, R.add(i3, i4)))
    case Trace{_, _, _, _, _, _}:
      zero()
    case Chord{+p0, +p1, _, _}:
      +q0 = G.sub(p0, o)
      +q1 = G.sub(p1, o)
      half(R.mul(triple(a, q0, G.sub(p1, p0)), G.dot(G.add(q0, q1), a)))

def sum_j(pieces: List<&2, Piece>, +o: G.Vec3, +a: G.Vec3, acc: R.Real) -> R.Real:
  match pieces:
    case Nil{}:
      acc
    case piece <> rest:
      sum_j(rest, o, a, R.add(acc, piece_j(piece, o, a)))

def sum_j_loops(loops: List<&2, List<&2, Piece>>, +o: G.Vec3, +a: G.Vec3, acc: R.Real) -> R.Real:
  match loops:
    case Nil{}:
      acc
    case pieces <> rest:
      sum_j_loops(rest, o, a, sum_j(pieces, o, a, acc))

# --- quadrature ----------------------------------------------------------------

type Node is Data:
  Node{x: R.Real, w: R.Real}

# 10-point Gauss-Legendre on [-1, 1], ascending, as F32x2 splits of the
# binary64 abscissae and weights.
def gl_nodes() -> List<&2, Node>:
  +x0 = {R.Real{0.14887434244155884, F32.neg(0.000000003459927677695873171615)} : R.Real}
  +x1 = {R.Real{0.4333953857421875, 0.000000008387059935444085567724} : R.Real}
  +x2 = {R.Real{0.6794095635414124, 0.00000000475761208207359231892} : R.Real}
  +x3 = {R.Real{0.8650633692741394, F32.neg(0.000000002585154756928886854439)} : R.Real}
  +x4 = {R.Real{0.9739065170288086, 0.00000001148836314968093574862} : R.Real}
  +w0 = {R.Real{0.2955242395401001, F32.neg(0.000000014825347172120473260293)} : R.Real}
  +w1 = {R.Real{0.2692667245864868, F32.neg(0.000000005276490355754503980279)} : R.Real}
  +w2 = {R.Real{0.21908636391162872, F32.neg(0.0000000013956467093123592349)} : R.Real}
  +w3 = {R.Real{0.149451345205307, 0.00000000394527344127482137992} : R.Real}
  +w4 = {R.Real{0.06667134165763855, 0.000000002651049602064858845551} : R.Real}
  [Node{R.neg(x4), w4}, Node{R.neg(x3), w3}, Node{R.neg(x2), w2}, Node{R.neg(x1), w1}, Node{R.neg(x0), w0},
   Node{x0, w0}, Node{x1, w1}, Node{x2, w2}, Node{x3, w3}, Node{x4, w4}]

type Pt is Data:
  Pt{p: G.Vec3, dp: G.Vec3}

def sample(piece: Piece, +t: R.Real) -> Pt:
  match piece:
    case Seg{+a, +b}:
      +d = G.sub(b, a)
      Pt{G.add(a, G.scale(d, t)), d}
    case Conic{m, +u, +v, _, _}:
      +c = R.cos(t)
      +s = R.sin(t)
      Pt{G.add(m, G.add(G.scale(u, c), G.scale(v, s))), G.add(G.scale(u, R.neg(s)), G.scale(v, c))}
    case Trace{a, b, s1, s2, _, _}:
      +on = trace_at(a, b, s1, s2, t)
      Pt{on_p(on), on_dp(on)}
    case Chord{+a, +b, _, _}:
      +d = G.sub(b, a)
      Pt{G.add(a, G.scale(d, t)), d}

def piece_t0(piece: Piece) -> R.Real:
  match piece:
    case Seg{_, _}:
      zero()
    case Conic{_, _, _, t0, _}:
      t0
    case Trace{_, _, _, _, t0, _}:
      t0
    case Chord{_, _, _, _}:
      zero()

def piece_t1(piece: Piece) -> R.Real:
  match piece:
    case Seg{_, _}:
      rf(1.0)
    case Conic{_, _, _, _, t1}:
      t1
    case Trace{_, _, _, _, _, t1}:
      t1
    case Chord{_, _, _, _}:
      rf(1.0)

# The integrand, in the frame (fx, fy, fz = polar or rotation axis) about o.
#   sphere: the area 1-form (rho^2 + rho Z) dv, v = atan2(Y, X): the region
#     integral of rho^2 cos(lat) by Green's theorem, zero at the south pole;
#   torus: f = A(u) dv and g = u dv, u = atan2(Z, r - R) the tube angle,
#     unwrapped along the loop, A(u) = -(rho/3)(3/2 R rho u + (R^2 + rho^2)
#     sin u + R rho sin(2u) / 4), dA/du = F.(S_u x S_v) for F = (p - o) / 3.
type Kern is Data:
  KSphere{o: G.Vec3, fx: G.Vec3, fy: G.Vec3, fz: G.Vec3, rho: R.Real}
  KTorus{o: G.Vec3, fx: G.Vec3, fy: G.Vec3, fz: G.Vec3, big: R.Real, small: R.Real}
  KFlux{o: G.Vec3, a: G.Vec3, c: G.Vec3, w: G.Vec3, axial: R.Real}

type Val is Data:
  Val{f: R.Real, g: R.Real, u: R.Real, jump: R.Real}

def dv(+x: R.Real, +y: R.Real, +xd: R.Real, +yd: R.Real) -> R.Real:
  R.div(R.sub(R.mul(x, yd), R.mul(y, xd)), R.add(sq(x), sq(y)))

def tube_angle(+q: G.Vec3, +fx: G.Vec3, +fy: G.Vec3, +fz: G.Vec3, +big: R.Real) -> R.Real:
  R.atan2(G.dot(q, fz), R.sub(R.sqrt(R.add(sq(G.dot(q, fx)), sq(G.dot(q, fy)))), big))

def evaluate(kern: Kern, pt: Pt, +previous: R.Real) -> Val:
  match kern:
    case KSphere{o, +fx, +fy, +fz, +rho}:
      Pt{p, +d} = pt
      +q = G.sub(p, o)
      +w = dv(G.dot(q, fx), G.dot(q, fy), G.dot(d, fx), G.dot(d, fy))
      Val{R.mul(R.add(sq(rho), R.mul(rho, G.dot(q, fz))), w), zero(), previous, zero()}
    case KTorus{o, +fx, +fy, +fz, +big, +small}:
      Pt{p, +d} = pt
      +q = G.sub(p, o)
      +x = G.dot(q, fx)
      +y = G.dot(q, fy)
      +z = G.dot(q, fz)
      +w = dv(x, y, G.dot(d, fx), G.dot(d, fy))
      +s = R.sub(R.sqrt(R.add(sq(x), sq(y))), big)
      +step = R.reduce_angle(R.sub(R.atan2(z, s), previous))
      +u = R.add(previous, step)
      +linear = R.mul(R.mul(rf(1.5), R.mul(big, small)), u)
      +wave = R.add(R.div(R.mul(R.add(sq(big), sq(small)), z), small), R.div(R.mul(R.mul(big, z), s), R.mul(rf(2.0), small)))
      +a = R.neg(R.mul(R.div(small, rf(3.0)), R.add(linear, wave)))
      Val{R.mul(a, w), R.mul(u, w), u, R.abs(step)}
    case KFlux{o, +a, c, w, +axial}:
      Pt{+p, +d} = pt
      +q = G.sub(p, o)
      +j = R.mul(G.dot(q, a), triple(a, q, d))
      Val{R.add(R.mul(axial, R.div(R.neg(j), rf(3.0))), R.div(G.dot(w, G.cross(G.sub(p, c), d)), rf(6.0))), zero(), previous, zero()}

def start_angle(kern: Kern, +p: G.Vec3) -> R.Real:
  match kern:
    case KSphere{_, _, _, _, _}:
      zero()
    case KFlux{_, _, _, _, _}:
      zero()
    case KTorus{o, fx, fy, fz, big, _}:
      tube_angle(G.sub(p, o), fx, fy, fz, big)

# Running sums of one Gauss rule (weights unscaled), the unwrapped angle and
# the largest angle step between consecutive nodes.
type Acc is Data:
  Acc{f: R.Real, g: R.Real, u: R.Real, jump: R.Real}

def val_f(v: Val) -> R.Real:
  Val{f, _, _, _} = v
  f

def val_g(v: Val) -> R.Real:
  Val{_, g, _, _} = v
  g

def val_u(v: Val) -> R.Real:
  Val{_, _, u, _} = v
  u

def val_jump(v: Val) -> R.Real:
  Val{_, _, _, jump} = v
  jump

def acc_f(a: Acc) -> R.Real:
  Acc{f, _, _, _} = a
  f

def acc_g(a: Acc) -> R.Real:
  Acc{_, g, _, _} = a
  g

def acc_u(a: Acc) -> R.Real:
  Acc{_, _, u, _} = a
  u

def acc_jump(a: Acc) -> R.Real:
  Acc{_, _, _, jump} = a
  jump

def gauss_steps(nodes: List<&2, Node>, +kern: Kern, +piece: Piece, +mid: R.Real, +span: R.Real, acc: Acc) -> Acc:
  match nodes:
    case Nil{}:
      acc
    case Node{x, +w} <> rest:
      Acc{sf, sg, u, jump} = acc
      +val = evaluate(kern, sample(piece, R.add(mid, R.mul(span, x))), u)
      gauss_steps(rest, kern, piece, mid, span, Acc{R.add(sf, R.mul(w, val_f(val))), R.add(sg, R.mul(w, val_g(val))), val_u(val), R.max(jump, val_jump(val))})

def gauss_end(sums: Acc, +kern: Kern, +piece: Piece, +tb: R.Real, +span: R.Real) -> Acc:
  Acc{sf, sg, u, jump} = sums
  +last = evaluate(kern, sample(piece, tb), u)
  Acc{R.mul(span, sf), R.mul(span, sg), val_u(last), R.max(jump, val_jump(last))}

# Gauss-Legendre over [ta, tb] in traversal order (tb < ta integrates
# backward), starting from angle u0; returns the integrals, the angle at tb
# and the largest angle step.
def gauss(+kern: Kern, +piece: Piece, +ta: R.Real, +tb: R.Real, u0: R.Real) -> Acc:
  +span = half(R.sub(tb, ta))
  gauss_end(gauss_steps(gl_nodes(), kern, piece, half(R.add(ta, tb)), span, Acc{zero(), zero(), u0, zero()}), kern, piece, tb, span)

# The result of an interval: integrals, their error estimates, the angle at
# its end and whether every estimate met its tolerance.
type Est is Data:
  Est{f: R.Real, g: R.Real, ef: R.Real, eg: R.Real, u: R.Real, ok: Bool}

def est_f(e: Est) -> R.Real:
  Est{f, _, _, _, _, _} = e
  f

def est_g(e: Est) -> R.Real:
  Est{_, g, _, _, _, _} = e
  g

def est_ef(e: Est) -> R.Real:
  Est{_, _, ef, _, _, _} = e
  ef

def est_eg(e: Est) -> R.Real:
  Est{_, _, _, eg, _, _} = e
  eg

def est_u(e: Est) -> R.Real:
  Est{_, _, _, _, u, _} = e
  u

def est_ok(e: Est) -> Bool:
  Est{_, _, _, _, _, ok} = e
  ok

# An interval either accepted, or to be halved with its two half rules.
type Verdict is Data:
  Accept{est: Est}
  Halve{ta: R.Real, tb: R.Real, u0: R.Real, left: Acc, right: Acc, tf: R.Real, tg: R.Real, est: Est}

# A step of the unwrapped tube angle between nodes stays below pi/2, else the
# unwrap is not trusted and the interval is halved.
def safe_step(+jump: R.Real) -> Bool:
  R.less(jump, rf(1.5707963))

def judge_both(+ta: R.Real, +tb: R.Real, +u0: R.Real, whole: Acc, +tf: R.Real, +tg: R.Real, +left: Acc, +right: Acc) -> Verdict:
  Acc{wf, wg, _, wj} = whole
  +hf = R.add(acc_f(left), acc_f(right))
  +hg = R.add(acc_g(left), acc_g(right))
  +ef = R.abs(R.sub(wf, hf))
  +eg = R.abs(R.sub(wg, hg))
  +steps = Bool.and(safe_step(wj), Bool.and(safe_step(acc_jump(left)), safe_step(acc_jump(right))))
  +good = Bool.and(steps, Bool.and(Bool.not(R.less(tf, ef)), Bool.not(R.less(tg, eg))))
  +est = {Est{hf, hg, ef, eg, acc_u(right), good} : Est}
  Bool.pick(Verdict, good, Accept{est}, Halve{ta, tb, u0, left, right, tf, tg, est})

def judge_left(+kern: Kern, +piece: Piece, +ta: R.Real, +tm: R.Real, +tb: R.Real, +u0: R.Real, whole: Acc, +tf: R.Real, +tg: R.Real, +left: Acc) -> Verdict:
  judge_both(ta, tb, u0, whole, tf, tg, left, gauss(kern, piece, tm, tb, acc_u(left)))

def judge(+kern: Kern, +piece: Piece, +ta: R.Real, +tb: R.Real, +u0: R.Real, whole: Acc, +tf: R.Real, +tg: R.Real) -> Verdict:
  +tm = half(R.add(ta, tb))
  judge_left(kern, piece, ta, tm, tb, u0, whole, tf, tg, gauss(kern, piece, ta, tm, u0))

def adapt(fuel: Nat, verdict: Verdict, +kern: Kern, +piece: Piece) -> Est:
  match fuel verdict:
    case _ Accept{est}:
      est
    case 0n Halve{_, _, _, _, _, _, _, est}:
      est
    case 1n+ +deeper Halve{+ta, +tb, u0, whole_left, whole_right, tf, tg, _}:
      +tm = half(R.add(ta, tb))
      +hf = half(tf)
      +hg = half(tg)
      +first = adapt(deeper, judge(kern, piece, ta, tm, u0, whole_left, hf, hg), kern, piece)
      +second = adapt(deeper, judge(kern, piece, tm, tb, est_u(first), whole_right, hf, hg), kern, piece)
      Est{R.add(est_f(first), est_f(second)), R.add(est_g(first), est_g(second)), R.add(est_ef(first), est_ef(second)),
        R.add(est_eg(first), est_eg(second)), est_u(second), Bool.and(est_ok(first), est_ok(second))}

type Quad is Data:
  Quad{f: R.Real, g: R.Real, ef: R.Real, eg: R.Real, u: R.Real, ok: Bool}

# Halvings allowed per interval. A trace (a certified-mesh boundary segment,
# a fraction of a millimetre long) gets 10: its integrand is smooth unless the
# two carriers are nearly tangent there, and an interval that has not met its
# tolerance after 10 halvings is refused (code 6) instead of being split into
# up to 2^24 pieces, each a Newton solve per sample.
def piece_depth(piece: Piece) -> Nat:
  match piece:
    case Trace{_, _, _, _, _, _}:
      10n
    case Seg{_, _}:
      24n
    case Conic{_, _, _, _, _}:
      24n
    case Chord{_, _, _, _}:
      24n

def quad_subs(n: Nat, +piece: Piece, +kern: Kern, +ta: R.Real, +step: R.Real, +tf: R.Real, +tg: R.Real, acc: Quad) -> Quad:
  match n:
    case 0n:
      acc
    case 1n+rest:
      Quad{f, g, ef, eg, +u, ok} = acc
      +tb = R.add(ta, step)
      +est = adapt(piece_depth(piece), judge(kern, piece, ta, tb, u, gauss(kern, piece, ta, tb, u), tf, tg), kern, piece)
      quad_subs(rest, piece, kern, tb, step, tf, tg, Quad{R.add(f, est_f(est)), R.add(g, est_g(est)), R.add(ef, est_ef(est)),
        R.add(eg, est_eg(est)), est_u(est), Bool.and(ok, est_ok(est))})

# Conic pieces start as intervals of at most pi/4 of their parameter.
def initial_count(piece: Piece) -> U32:
  match piece:
    case Seg{_, _}:
      1
    case Conic{_, _, _, t0, t1}:
      (F32.to_u32(F32.floor((R.approx(R.abs(R.sub(t1, t0))) / 0.7853981 : F32))) + 1 : U32)
    case Trace{_, _, _, _, _, _}:
      1
    case Chord{_, _, _, _}:
      1

def quad_pieces(pieces: List<&2, Piece>, +kern: Kern, +tf: R.Real, +tg: R.Real, acc: Quad) -> Quad:
  match pieces:
    case Nil{}:
      acc
    case +piece <> rest:
      +count = initial_count(piece)
      +t0 = piece_t0(piece)
      +step = R.div(R.sub(piece_t1(piece), t0), rf(U32.to_f32(count)))
      quad_pieces(rest, kern, tf, tg, quad_subs(U32.to_nat(count), piece, kern, t0, step, tf, tg, acc))

def quad_f(q: Quad) -> R.Real:
  Quad{f, _, _, _, _, _} = q
  f

def quad_g(q: Quad) -> R.Real:
  Quad{_, g, _, _, _, _} = q
  g

def quad_ef(q: Quad) -> R.Real:
  Quad{_, _, ef, _, _, _} = q
  ef

def quad_eg(q: Quad) -> R.Real:
  Quad{_, _, _, eg, _, _} = q
  eg

def quad_u(q: Quad) -> R.Real:
  Quad{_, _, _, _, u, _} = q
  u

def quad_ok(q: Quad) -> Bool:
  Quad{_, _, _, _, _, ok} = q
  ok

type Loops is Data:
  Loops{f: R.Real, g: R.Real, ef: R.Real, eg: R.Real, ok: Bool, wraps: Bool}

def first_start(pieces: List<&2, Piece>) -> G.Vec3:
  match pieces:
    case Nil{}:
      origin()
    case piece <> _:
      piece_start(piece)

# Every loop integrated from the tube angle of its first point; a loop whose
# unwrapped angle does not return to its start winds around the tube.
def quad_loops(loops: List<&2, List<&2, Piece>>, +kern: Kern, +tf: R.Real, +tg: R.Real, acc: Loops) -> Loops:
  match loops:
    case Nil{}:
      acc
    case +pieces <> rest:
      Loops{f, g, ef, eg, ok, wraps} = acc
      +u0 = start_angle(kern, first_start(pieces))
      +q = quad_pieces(pieces, kern, tf, tg, Quad{zero(), zero(), zero(), zero(), u0, True{}})
      +wound = R.less(rf(0.000001), R.abs(R.sub(quad_u(q), u0)))
      quad_loops(rest, kern, tf, tg, Loops{R.add(f, quad_f(q)), R.add(g, quad_g(q)), R.add(ef, quad_ef(q)), R.add(eg, quad_eg(q)),
        Bool.and(ok, quad_ok(q)), Bool.or(wraps, wound)})

# --- sphere frame ----------------------------------------------------------------

def candidate_axes() -> List<&2, G.Vec3>:
  [G.v3(0.0, 0.0, 1.0), G.v3(1.0, 0.0, 0.0), G.v3(0.0, 1.0, 0.0),
   G.normalize(G.v3(1.0, 1.0, 0.0)), G.normalize(G.v3(1.0, F32.neg(1.0), 0.0)),
   G.normalize(G.v3(1.0, 0.0, 1.0)), G.normalize(G.v3(1.0, 0.0, F32.neg(1.0))),
   G.normalize(G.v3(0.0, 1.0, 1.0)), G.normalize(G.v3(0.0, 1.0, F32.neg(1.0))),
   G.normalize(G.v3(1.0, 1.0, 1.0)), G.normalize(G.v3(1.0, 1.0, F32.neg(1.0))),
   G.normalize(G.v3(1.0, F32.neg(1.0), 1.0)), G.normalize(G.v3(F32.neg(1.0), 1.0, 1.0))]

def conic_samples(n: Nat, +m: G.Vec3, +u: G.Vec3, +v: G.Vec3, +t: R.Real, +step: R.Real, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match n:
    case 0n:
      acc
    case 1n+rest:
      conic_samples(rest, m, u, v, R.add(t, step), step, G.add(m, conic_at(u, v, t)) <> acc)

def piece_samples(piece: Piece, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match piece:
    case Seg{+a, +b}:
      a <> G.scale(G.add(a, b), rf(0.5)) <> b <> acc
    case Conic{+m, +u, +v, +t0, t1}:
      conic_samples(17n, m, u, v, t0, R.div(R.sub(t1, t0), rf(16.0)), acc)
    case Trace{+a, +b, s1, s2, _, _}:
      a <> on_p(trace_at(a, b, s1, s2, rf(0.5))) <> b <> acc
    case Chord{+a, +b, _, _}:
      a <> G.scale(G.add(a, b), rf(0.5)) <> b <> acc

def samples(pieces: List<&2, Piece>, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match pieces:
    case Nil{}:
      acc
    case piece <> rest:
      samples(rest, piece_samples(piece, acc))

def loop_samples(loops: List<&2, List<&2, Piece>>, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match loops:
    case Nil{}:
      acc
    case pieces <> rest:
      loop_samples(rest, samples(pieces, acc))

# min over samples of sin^2 of the angle between the axis and the direction
# from the centre: how far both poles stay from the boundary.
def clearance(points: List<&2, G.Vec3>, +o: G.Vec3, +axis: G.Vec3, acc: R.Real) -> R.Real:
  match points:
    case Nil{}:
      acc
    case p <> rest:
      +d = G.sub(p, o)
      +c = R.div(sq(G.dot(d, axis)), G.dot(d, d))
      clearance(rest, o, axis, R.min(acc, R.sub(rf(1.0), c)))

type Pick is Data:
  Pick{axis: G.Vec3, clear: R.Real}

def best_axis(axes: List<&2, G.Vec3>, +points: List<&2, G.Vec3>, +o: G.Vec3, acc: Pick) -> Pick:
  match axes:
    case Nil{}:
      acc
    case +axis <> rest:
      Pick{best, +clear} = acc
      +c = clearance(points, o, axis, rf(1.0))
      best_axis(rest, points, o, Bool.pick(Pick, R.less(clear, c), Pick{axis, c}, Pick{best, clear}))

# --- faces -------------------------------------------------------------------------

# value: the flux of F; err: its quadrature bound; code 0 unless refused.
type Flux is Data:
  Flux{value: R.Real, err: R.Real, quadrature: Bool, code: U32}

def flux_value(x: Flux) -> R.Real:
  Flux{value, _, _, _} = x
  value

def flux_err(x: Flux) -> R.Real:
  Flux{_, err, _, _} = x
  err

def flux_quadrature(x: Flux) -> Bool:
  Flux{_, _, quadrature, _} = x
  quadrature

def flux_code_of(x: Flux) -> U32:
  Flux{_, _, _, code} = x
  code

def closed_form(+value: R.Real) -> Flux:
  Flux{value, zero(), False{}, 0}

def refused(+code: U32) -> Flux:
  Flux{zero(), zero(), False{}, code}

def axial_flux(+loops: List<&2, List<&2, Piece>>, +o: G.Vec3, +a: G.Vec3, +c: G.Vec3, +e: G.Vec3) -> Flux:
  +j = sum_j_loops(loops, o, a, zero())
  closed_form(R.add(R.div(R.neg(j), rf(3.0)), R.div(G.dot(G.sub(o, c), e), rf(6.0))))

# apex = o - a (radius / tan(angle)); a negative angle (a cone narrowing along
# its axis) is handled by the same formula.
def cone_flux(+o: G.Vec3, +a: G.Vec3, +radius: R.Real, +angle: R.Real, +c: G.Vec3, +e: G.Vec3) -> Flux:
  +apex = G.sub(o, G.scale(a, R.div(R.mul(radius, R.cos(angle)), R.sin(angle))))
  closed_form(R.div(G.dot(G.sub(apex, c), e), rf(6.0)))

# area + m * full lies in (0, full]; None when it is within `margin` of zero.
def wrapped(+raw: R.Real, +full: R.Real) -> R.Real:
  +turns = F32.floor((R.approx(raw) / R.approx(full) : F32))
  +first = R.sub(raw, R.mul(full, rf(turns)))
  +second = Bool.pick(R.Real, R.less(first, zero()), R.add(first, full), first)
  Bool.pick(R.Real, R.less(full, second), R.sub(second, full), second)

def sphere_area(result: Loops, +rho: R.Real, +base: R.Real, +out: R.Real) -> Flux:
  Loops{f, _, +err, _, ok, _} = result
  +raw = R.mul(R.neg(out), f)
  +full = R.mul(R.mul(rf(4.0), R.pi()), sq(rho))
  +area = wrapped(raw, full)
  +margin = R.add(R.mul(rf(4.0), err), R.mul(full, rf(0.000000001)))
  +scale = R.div(rho, rf(3.0))
  Bool.pick(Flux, ok,
    Bool.pick(Flux, R.less(area, margin), refused(2), Flux{R.add(base, R.mul(R.mul(out, scale), area)), R.mul(scale, err), True{}, 0}),
    refused(6))

def sphere_checked(blocked: Bool, +loops: List<&2, List<&2, Piece>>, +kern: Kern, +rho: R.Real, +out: R.Real, +base: R.Real, +tol: R.Real) -> Flux:
  match blocked:
    case True{}:
      refused(1)
    case False{}:
      +tf = R.mul(R.mul(tol, sq(rho)), rf(0.8))
      sphere_area(quad_loops(loops, kern, tf, tf, Loops{zero(), zero(), zero(), zero(), True{}, False{}}), rho, base, out)

def sphere_quadrature(+loops: List<&2, List<&2, Piece>>, +o: G.Vec3, +rho: R.Real, +out: R.Real, +base: R.Real, +tol: R.Real, pick: Pick) -> Flux:
  Pick{+fz, clear} = pick
  +fx = A.axis_x(fz)
  sphere_checked(R.less(clear, rf(0.00000001)), loops, KSphere{o, fx, G.cross(fz, fx), fz, rho}, rho, out, base, tol)

# The flux of the constant field (o - c) / 3 through the face: (o - c).E / 6.
def shifted(+o: G.Vec3, +c: G.Vec3, +e: G.Vec3) -> R.Real:
  R.div(G.dot(G.sub(o, c), e), rf(6.0))

def sphere_flux(whole: Bool, +loops: List<&2, List<&2, Piece>>, +o: G.Vec3, +rho: R.Real, +sense: Bool, +c: G.Vec3, +e: G.Vec3, +tol: R.Real) -> Flux:
  match whole:
    case True{}:
      closed_form(R.add(shifted(o, c, e), R.mul(sign(sense), R.div(R.mul(R.mul(rf(4.0), R.pi()), R.mul(rho, sq(rho))), rf(3.0)))))
    case False{}:
      sphere_quadrature(loops, o, rho, sign(sense), shifted(o, c, e), tol, best_axis(candidate_axes(), loop_samples(loops, Nil{}), o, Pick{G.v3(0.0, 0.0, 1.0), rf(F32.neg(1.0))}))

def torus_region(result: Loops, +full_flux: R.Real, +out: R.Real, +base: R.Real) -> Flux:
  Loops{+f, +g, +ef, +eg, ok, wraps} = result
  +period = sq(tau())
  +raw = R.mul(R.neg(out), g)
  +area = wrapped(raw, period)
  +turns = R.div(R.sub(area, raw), period)
  +m = rf(F32.floor((R.approx(turns) + 0.5 : F32)))
  +margin = R.add(R.mul(rf(4.0), eg), R.mul(period, rf(0.000000001)))
  Bool.pick(Flux, wraps, refused(4),
    Bool.pick(Flux, ok,
      Bool.pick(Flux, R.less(area, margin), refused(5), Flux{R.add(base, R.add(f, R.mul(m, full_flux))), ef, True{}, 0}),
      refused(6)))

def torus_quadrature(+loops: List<&2, List<&2, Piece>>, +o: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +big: R.Real, +small: R.Real, +full_flux: R.Real, +out: R.Real, +base: R.Real, +tol: R.Real) -> Flux:
  +fz = G.normalize(axis)
  +fx = G.normalize(G.sub(x, G.scale(fz, G.dot(x, fz))))
  +kern = {KTorus{o, fx, G.cross(fz, fx), fz, big, small} : Kern}
  +tf = R.mul(R.mul(tol, R.mul(big, sq(small))), rf(2.0))
  +tg = R.mul(tol, rf(4.0))
  torus_region(quad_loops(loops, kern, tf, tg, Loops{zero(), zero(), zero(), zero(), True{}, False{}}), full_flux, out, base)

# 2 pi^2 R rho^2: the flux of (p - o) / 3 through the whole torus, signed by
# the face orientation.
def torus_full(+out: R.Real, +big: R.Real, +small: R.Real) -> R.Real:
  R.mul(out, R.mul(R.mul(rf(2.0), sq(R.pi())), R.mul(big, sq(small))))

def torus_open(ring: Bool, +loops: List<&2, List<&2, Piece>>, +o: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +big: R.Real, +small: R.Real, +out: R.Real, +base: R.Real, +tol: R.Real) -> Flux:
  match ring:
    case True{}:
      torus_quadrature(loops, o, axis, x, big, small, torus_full(out, big, small), out, base, tol)
    case False{}:
      refused(3)

def torus_flux(whole: Bool, +loops: List<&2, List<&2, Piece>>, +o: G.Vec3, +axis: G.Vec3, +x: G.Vec3, +big: R.Real, +small: R.Real, +sense: Bool, +c: G.Vec3, +e: G.Vec3, +tol: R.Real) -> Flux:
  match whole:
    case True{}:
      Bool.pick(Flux, R.less(small, big), closed_form(R.add(shifted(o, c, e), torus_full(sign(sense), big, small))), refused(3))
    case False{}:
      torus_open(R.less(small, big), loops, o, axis, x, big, small, sign(sense), shifted(o, c, e), tol)

def carrier_flux(surface: A.Surface, +sense: Bool, +whole: Bool, +loops: List<&2, List<&2, Piece>>, +c: G.Vec3, +e: G.Vec3, +tol: R.Real) -> Flux:
  match surface:
    case A.Plane{+o, +n, _}:
      axial_flux(loops, o, n, c, e)
    case A.Cylinder{+o, +a, _, _}:
      axial_flux(loops, o, a, c, e)
    case A.Cone{+o, +a, _, +radius, +angle}:
      cone_flux(o, a, radius, angle, c, e)
    case A.Sphere{+o, _, _, +rho}:
      sphere_flux(whole, loops, o, rho, sense, c, e, tol)
    case A.Torus{+o, +axis, +x, +big, +small}:
      torus_flux(whole, loops, o, axis, x, big, small, sense, c, e, tol)

# --- certified-mesh patches (docs/hybrid-mesh-bodies.md) --------------------------
#
# A patch of a certified-mesh body is a face on its exact carrier whose
# boundary is the mesh's boundary polyline refined onto the exact curves:
# every boundary vertex by Newton onto all carriers meeting there, every
# segment between two vertices as the exact curve of its two carriers
# (Trace, sampled by Newton in the plane normal to the chord), or as the chord
# where the two carriers are tangent (Chord). The flux of a patch is the flux
# of a face with that boundary: the closed-form terms of its carrier over the
# chords, plus the same integrand by Gauss-Legendre over the traces (KFlux),
# plus, on a sphere or torus, the area term, whose quadrature runs over every
# piece. Always labelled quadrature.

# Unit axes, so the closed-form terms and KFlux use the same field.
def unit_surface(s: A.Surface) -> A.Surface:
  match s:
    case A.Plane{o, n, x}:
      A.Plane{o, G.normalize(n), x}
    case A.Cylinder{o, a, x, r}:
      A.Cylinder{o, G.normalize(a), x, r}
    case A.Cone{o, a, x, r, angle}:
      A.Cone{o, G.normalize(a), x, r, angle}
    case A.Sphere{o, a, x, r}:
      A.Sphere{o, a, x, r}
    case A.Torus{o, a, x, big, small}:
      A.Torus{o, G.normalize(a), x, big, small}

# The point the carrier's field is anchored at (its origin; a cone's apex).
def anchor(s: A.Surface) -> G.Vec3:
  match s:
    case A.Plane{o, _, _}:
      o
    case A.Cylinder{o, _, _, _}:
      o
    case A.Cone{+o, +a, _, +radius, +angle}:
      G.sub(o, G.scale(a, R.div(R.mul(radius, R.cos(angle)), R.sin(angle))))
    case A.Sphere{o, _, _, _}:
      o
    case A.Torus{o, _, _, _, _}:
      o

def flat(s: A.Surface) -> Bool:
  match s:
    case A.Plane{_, _, _}:
      True{}
    case A.Cylinder{_, _, _, _}:
      True{}
    case A.Cone{_, _, _, _, _}:
      True{}
    case A.Sphere{_, _, _, _}:
      False{}
    case A.Torus{_, _, _, _, _}:
      False{}

def flux_kern(s: A.Surface, +c: G.Vec3) -> Kern:
  match s:
    case A.Plane{+o, n, _}:
      KFlux{o, n, c, G.sub(o, c), rf(1.0)}
    case A.Cylinder{+o, a, _, _}:
      KFlux{o, a, c, G.sub(o, c), rf(1.0)}
    case A.Cone{o, +a, x, radius, angle}:
      +apex = anchor(A.Cone{o, a, x, radius, angle})
      KFlux{apex, a, c, G.sub(apex, c), zero()}
    case A.Sphere{+o, _, _, _}:
      KFlux{o, G.v3(0.0, 0.0, 1.0), c, G.sub(o, c), zero()}
    case A.Torus{+o, a, _, _, _}:
      KFlux{o, a, c, G.sub(o, c), zero()}

# Which side of its carrier a patch lies on: the summed (b - a) x (c - a) .
# gradient over its triangles; clear when the sum is at least 0.9 of the sum
# of magnitudes.
type Side is Data:
  Side{sum: R.Real, abs: R.Real}

def tri_side(ts: List<&2, Tri3>, +s: A.Surface, acc: Side) -> Side:
  match ts:
    case Nil{}:
      acc
    case Tri3{+a, +b, +c} <> rest:
      Side{sum, abs} = acc
      +n = G.cross(G.sub(b, a), G.sub(c, a))
      +m = G.scale(G.add(a, G.add(b, c)), R.div(rf(1.0), rf(3.0)))
      +x = G.dot(n, fg_g(carrier_fg(s, m)))
      tri_side(rest, s, Side{R.add(sum, x), R.add(abs, R.abs(x))})

def side_out(x: Side) -> Bool:
  Side{sum, _} = x
  R.less(zero(), sum)

def side_clear(x: Side) -> Bool:
  Side{+sum, abs} = x
  R.less(R.mul(abs, rf(0.9)), R.abs(sum))

# Checks of the pieces and their stated allowance: along a piece of length L
# whose points lie within r of both carriers, the face it bounds is off by a
# strip of width r at most, so the flux changes by at most
# 2 L r (|p - c| + |p - anchor|) (both fields F and F_f bounded by the
# distances); summed over every piece. Trace: r = the largest residual at
# t = 0, 1/4, 1/2, 3/4, 1 (code 7 above 1e-9 mm), and the curve must stay
# within 60 degrees of its chord there (code 8). Chord: r = the largest
# carrier value on the chord at the same points (code 7 above 1e-9 mm: a
# tangent boundary that is not straight is not taken as a chord).
type Chk is Data:
  Chk{err: R.Real, code: U32}

def chk_err(x: Chk) -> R.Real:
  Chk{err, _} = x
  err

def chk_code(x: Chk) -> U32:
  Chk{_, code} = x
  code

def at_res(+a: G.Vec3, +b: G.Vec3, +s1: A.Surface, +s2: A.Surface, +t: R.Real, acc: Chk) -> Chk:
  Chk{+r, +cmin} = acc
  +on = trace_at(a, b, s1, s2, t)
  Chk{R.max(r, on_res(on)), Bool.pick(U32, R.less(on_cosine(on), rf(0.5)), 1, cmin)}

def chord_res(+a: G.Vec3, +b: G.Vec3, +s1: A.Surface, +s2: A.Surface, +t: R.Real, +r: R.Real) -> R.Real:
  +p = G.add(a, G.scale(G.sub(b, a), t))
  R.max(r, R.max(R.abs(fg_f(carrier_fg(s1, p))), R.abs(fg_f(carrier_fg(s2, p)))))

def allowance(+a: G.Vec3, +b: G.Vec3, +r: R.Real, +c: G.Vec3, +o: G.Vec3) -> R.Real:
  +m = G.scale(G.add(a, b), rf(0.5))
  R.mul(R.mul(rf(2.0), R.mul(vlen(G.sub(b, a)), r)), R.add(vlen(G.sub(m, c)), vlen(G.sub(m, o))))

def worse(+code: U32, +bad: Bool, +mine: U32) -> U32:
  Bool.pick(U32, Bool.and(U32.is_eq(code, 0), bad), mine, code)

def trace_check(q: Chk, +a: G.Vec3, +b: G.Vec3, +c: G.Vec3, +o: G.Vec3, acc: Chk) -> Chk:
  Chk{+r, +turn} = q
  Chk{err, code} = acc
  Chk{R.add(err, allowance(a, b, r, c, o)), worse(worse(code, R.less(rf(0.000000001), r), 7), U32.is_ne(turn, 0), 8)}

def chord_check(+r: R.Real, +a: G.Vec3, +b: G.Vec3, +c: G.Vec3, +o: G.Vec3, acc: Chk) -> Chk:
  Chk{err, code} = acc
  Chk{R.add(err, allowance(a, b, r, c, o)), worse(code, R.less(rf(0.000000001), r), 7)}

def piece_check(piece: Piece, +c: G.Vec3, +o: G.Vec3, acc: Chk) -> Chk:
  match piece:
    case Seg{_, _}:
      acc
    case Conic{_, _, _, _, _}:
      acc
    case Trace{+a, +b, +s1, +s2, _, _}:
      trace_check(at_res(a, b, s1, s2, zero(), at_res(a, b, s1, s2, rf(0.25), at_res(a, b, s1, s2, rf(0.5),
        at_res(a, b, s1, s2, rf(0.75), at_res(a, b, s1, s2, rf(1.0), Chk{zero(), 0}))))), a, b, c, o, acc)
    case Chord{+a, +b, +s1, +s2}:
      chord_check(chord_res(a, b, s1, s2, zero(), chord_res(a, b, s1, s2, rf(0.25), chord_res(a, b, s1, s2, rf(0.5),
        chord_res(a, b, s1, s2, rf(0.75), chord_res(a, b, s1, s2, rf(1.0), zero()))))), a, b, c, o, acc)

def check_pieces(pieces: List<&2, Piece>, +c: G.Vec3, +o: G.Vec3, acc: Chk) -> Chk:
  match pieces:
    case Nil{}:
      acc
    case piece <> rest:
      check_pieces(rest, c, o, piece_check(piece, c, o, acc))

def check_loops(loops: List<&2, List<&2, Piece>>, +c: G.Vec3, +o: G.Vec3, acc: Chk) -> Chk:
  match loops:
    case Nil{}:
      acc
    case pieces <> rest:
      check_loops(rest, c, o, check_pieces(pieces, c, o, acc))

def is_trace(piece: Piece) -> Bool:
  match piece:
    case Trace{_, _, _, _, _, _}:
      True{}
    case Seg{_, _}:
      False{}
    case Conic{_, _, _, _, _}:
      False{}
    case Chord{_, _, _, _}:
      False{}

# The KFlux integral over the traces; the tolerance of a trace scales with
# its length and the square of its distance from c and from the anchor (the
# integrand's size), floored at 1e-11 relative so that Newton's rounding
# (about 1e-13 mm per sample) never forces pointless halvings.
def trace_tol(+piece: Piece, +c: G.Vec3, +o: G.Vec3, +tol: R.Real) -> R.Real:
  +a = piece_start(piece)
  +size = R.add(R.add(vlen(G.sub(a, c)), vlen(G.sub(a, o))), rf(1.0))
  R.mul(R.max(tol, rf(0.00000000001)), R.mul(sq(size), rf(1.0)))

def trace_one(yes: Bool, +piece: Piece, +kern: Kern, +tf: R.Real, acc: Quad) -> Quad:
  match yes:
    case True{}:
      +t0 = piece_t0(piece)
      quad_subs(1n, piece, kern, t0, R.sub(piece_t1(piece), t0), tf, tf, acc)
    case False{}:
      acc

def trace_pieces(pieces: List<&2, Piece>, +kern: Kern, +c: G.Vec3, +o: G.Vec3, +tol: R.Real, acc: Quad) -> Quad:
  match pieces:
    case Nil{}:
      acc
    case +piece <> rest:
      trace_pieces(rest, kern, c, o, tol, trace_one(is_trace(piece), piece, kern, trace_tol(piece, c, o, tol), acc))

def trace_loops(loops: List<&2, List<&2, Piece>>, +kern: Kern, +c: G.Vec3, +o: G.Vec3, +tol: R.Real, acc: Quad) -> Quad:
  match loops:
    case Nil{}:
      acc
    case pieces <> rest:
      trace_loops(rest, kern, c, o, tol, trace_pieces(pieces, kern, c, o, tol, acc))

def mesh_flux(base: Flux, +traces: Quad, +chk: Chk, +side_ok: Bool) -> Flux:
  Flux{value, err, _, +code} = base
  +ccode = chk_code(chk)
  +first = worse(worse(worse(0, Bool.not(side_ok), 10), U32.is_ne(ccode, 0), ccode), U32.is_ne(code, 0), code)
  Flux{R.add(value, quad_f(traces)), R.add(err, R.add(quad_ef(traces), chk_err(chk))), True{}, worse(first, Bool.not(quad_ok(traces)), 6)}

def mface_open(+s: A.Surface, +tris: List<&2, Tri3>, +whole: Bool, +loops: List<&2, List<&2, Piece>>, +c: G.Vec3, +tol: R.Real) -> Flux:
  +side = tri_side(tris, s, Side{zero(), zero()})
  +o = anchor(s)
  +chk = check_loops(loops, c, o, Chk{zero(), 0})
  +base = carrier_flux(s, side_out(side), whole, loops, c, sum_e_loops(loops, c, origin()), tol)
  +traces = trace_loops(loops, flux_kern(s, c), c, o, tol, Quad{zero(), zero(), zero(), zero(), zero(), True{}})
  +side_ok = Bool.or(flat(s), side_clear(side))
  mesh_flux(base, traces, chk, side_ok)

def mface_flux(surface: A.Surface, +tris: List<&2, Tri3>, +whole: Bool, uses: List<&2, List<&2, Use>>, +c: G.Vec3, +tol: R.Real) -> Flux:
  +s = unit_surface(surface)
  Bool.pick(Flux, Bool.and(whole, flat(s)), refused(9), mface_open(s, tris, whole, face_loops(uses), c, tol))

def face_flux(face: VFace, +c: G.Vec3, +tol: R.Real) -> Flux:
  match face:
    case VFace{surface, sense, whole, uses}:
      +loops = face_loops(uses)
      carrier_flux(surface, sense, whole, loops, c, sum_e_loops(loops, c, origin()), tol)
    case MFace{surface, tris, whole, uses}:
      mface_flux(surface, tris, whole, uses, c, tol)

# --- body ------------------------------------------------------------------------

type Center is Data:
  Center{sum: G.Vec3, count: U32}

def use_starts(uses: List<&2, Use>, acc: Center) -> Center:
  match uses:
    case Nil{}:
      acc
    case Use{_, p, _, _, _, _, _} <> rest:
      Center{sum, count} = acc
      use_starts(rest, Center{G.add(sum, p), (count + 1 : U32)})
    case Meet{p, _, _, _, _, _, _} <> rest:
      Center{sum, count} = acc
      use_starts(rest, Center{G.add(sum, p), (count + 1 : U32)})

def loop_starts(loops: List<&2, List<&2, Use>>, acc: Center) -> Center:
  match loops:
    case Nil{}:
      acc
    case uses <> rest:
      loop_starts(rest, use_starts(uses, acc))

def face_starts(faces: List<&2, VFace>, acc: Center) -> Center:
  match faces:
    case Nil{}:
      acc
    case VFace{_, _, _, loops} <> rest:
      face_starts(rest, loop_starts(loops, acc))
    case MFace{_, _, _, loops} <> rest:
      face_starts(rest, loop_starts(loops, acc))

def mean(center: Center) -> G.Vec3:
  Center{sum, +count} = center
  G.scale(sum, R.div(rf(1.0), rf(U32.to_f32(U32.max(count, 1)))))

def reference(faces: List<&2, VFace>) -> G.Vec3:
  mean(face_starts(faces, Center{origin(), 0}))

type Sum is Data:
  Sum{volume: R.Real, err: R.Real, size: R.Real, quadrature: U32, index: U32, code: U32, face: U32}

def faces_sum(faces: List<&2, VFace>, +c: G.Vec3, +tol: R.Real, acc: Sum) -> Sum:
  match faces:
    case Nil{}:
      acc
    case face <> rest:
      Sum{volume, err, size, quadrature, +index, +code, +failed} = acc
      +flux = face_flux(face, c, tol)
      +value = flux_value(flux)
      +flux_code = flux_code_of(flux)
      +first = Bool.and(U32.is_eq(code, 0), U32.is_ne(flux_code, 0))
      faces_sum(rest, c, tol, Sum{R.add(volume, value), R.add(err, flux_err(flux)), R.add(size, R.abs(value)),
        (quadrature + Bool.pick(U32, flux_quadrature(flux), 1, 0) : U32), (index + 1 : U32),
        Bool.pick(U32, first, flux_code, code), Bool.pick(U32, first, index, failed)})

# The bound: the summed quadrature estimates plus an arithmetic allowance of
# 2^-38 of the summed face flux magnitudes (F32x2 carries about 48 bits).
def finish(sum: Sum) -> Volume:
  Sum{volume, err, size, quadrature, index, +code, face} = sum
  +bound = R.add(err, R.mul(size, rf(0.0000000000036379788)))
  Bool.pick(Volume, U32.is_eq(code, 0), Measured{volume, bound, quadrature, index}, Refused{code, face})

# `tol`: the relative quadrature tolerance per unit carrier measure (1e-13
# is the default of src/volume.mjs).
def volume(+faces: List<&2, VFace>, +tol: R.Real) -> Volume:
  finish(faces_sum(faces, reference(faces), tol, Sum{zero(), zero(), zero(), 0, 0, 0, 0}))

# --- certified-mesh snapping and triangle bounds (src/hybrid-mesh.mjs) -----------
#
# mesh_snap: every item is refined by Newton onto its carriers (newton_onto):
#   Onto{p, cs}: the point p onto every carrier in cs (a vertex of a mesh face
#     on one carrier, or of a boundary on two or more);
#   Mid{a, b, cs}: the midpoint of the segment a b onto cs; with exactly two
#     carriers (a boundary segment) also onto the plane normal to the segment
#     through its midpoint, so the point is the curve's point there;
#   Value{p, s}: no Newton: the carrier's value f at p (signed, a distance to
#     first order) as res, the first-order foot p - f g as q (moved = |f|).
# Out: the point, the largest carrier value there (distance to first order),
# the smallest sine between two carriers' unit gradients there (1 for fewer
# than two carriers) and the distance moved from the seed.

type Snap is Data:
  Onto{p: G.Vec3, cs: List<&2, A.Surface>}
  Mid{a: G.Vec3, b: G.Vec3, cs: List<&2, A.Surface>}
  Value{p: G.Vec3, s: A.Surface}

type Snapped is Data:
  Snapped{q: G.Vec3, res: R.Real, sine: R.Real, moved: R.Real}

def carrier_count(cs: List<&2, A.Surface>, +n: U32) -> U32:
  match cs:
    case Nil{}:
      n
    case _ <> rest:
      carrier_count(rest, (n + 1 : U32))

def carrier_res(cs: List<&2, A.Surface>, +p: G.Vec3, acc: R.Real) -> R.Real:
  match cs:
    case Nil{}:
      acc
    case s <> rest:
      carrier_res(rest, p, R.max(acc, R.abs(fg_f(carrier_fg(s, p)))))

def grads(cs: List<&2, A.Surface>, +p: G.Vec3) -> List<&2, G.Vec3>:
  match cs:
    case Nil{}:
      Nil{}
    case s <> rest:
      fg_g(carrier_fg(s, p)) <> grads(rest, p)

def sine_with(gs: List<&2, G.Vec3>, +g: G.Vec3, acc: R.Real) -> R.Real:
  match gs:
    case Nil{}:
      acc
    case h <> rest:
      sine_with(rest, g, R.min(acc, vlen(G.cross(g, h))))

def sine_min(gs: List<&2, G.Vec3>, acc: R.Real) -> R.Real:
  match gs:
    case Nil{}:
      acc
    case +g <> +rest:
      sine_min(rest, sine_with(rest, g, acc))

def snapped(+cs: List<&2, A.Surface>, +seed: G.Vec3, +q: G.Vec3) -> Snapped:
  Snapped{q, carrier_res(cs, q, zero()), sine_min(grads(cs, q), rf(1.0)), vlen(G.sub(q, seed))}

def mid_onto(+cs: List<&2, A.Surface>, +a: G.Vec3, +b: G.Vec3) -> Snapped:
  +m = G.scale(G.add(a, b), rf(0.5))
  +two = U32.is_eq(carrier_count(cs, 0), 2)
  +guide = Bool.pick(List<&2, A.Surface>, two, List.append(&2, A.Surface, cs, [chord_plane(m, G.normalize(G.sub(b, a)))]), cs)
  snapped(cs, m, newton_onto(guide, m))

def value_at(q: FG, +p: G.Vec3) -> Snapped:
  FG{+f, g} = q
  Snapped{G.sub(p, G.scale(g, f)), f, rf(1.0), R.abs(f)}

def snap_one(s: Snap) -> Snapped:
  match s:
    case Onto{+p, +cs}:
      snapped(cs, p, newton_onto(cs, p))
    case Mid{a, b, cs}:
      mid_onto(cs, a, b)
    case Value{+p, s}:
      value_at(carrier_fg(s, p), p)

# Tail-recursive (meshes of tens of thousands of vertices stay off the JS
# stack); acc holds the answers in reverse.
def mesh_snap.go(items: List<&2, Snap>, acc: List<&2, Snapped>) -> List<&2, Snapped>:
  match items:
    case Nil{}:
      List.reverse(&2, Snapped, acc)
    case s <> rest:
      mesh_snap.go(rest, snap_one(s) <> acc)

def mesh_snap(items: List<&2, Snap>) -> List<&2, Snapped>:
  mesh_snap.go(items, Nil{})

# mesh_bound: an upper bound of the distance from every point of the triangle
# a b c to the carrier s (negative: no bound here).
#
# For phi = the squared radial distance (cylinder), squared distance to the
# centre (sphere) or to the core circle (torus), or rho^2 - r_h^2 (cone),
# Taylor's theorem about p = sum l_i v_i gives
#   phi(p) = sum l_i phi(v_i) - 1/2 sum l_i d_i^T H(xi_i) d_i,  d_i = v_i - p,
# and sum l_i |M d_i|^2 = sum_{i<j} l_i l_j |M e_ij|^2 for any linear M. So
# phi over the triangle lies within the vertex values minus the extremes of a
# quadratic form q(l) = sum_{i<j} w_ij l_i l_j over the simplex, which are at
# a vertex (0), an edge midpoint (w_ij / 4) or the interior critical point
# (w01 w12 w20 / (s0 + s1 + s2), s0 = w12 (w01 + w20 - w12) etc., when all
# s_i share the sign of their sum). The distance to the carrier follows from
# phi. Plane: the largest vertex distance (the distance is linear).

type QR is Data:
  QR{lo: R.Real, hi: R.Real}

def qr_lo(x: QR) -> R.Real:
  QR{lo, _} = x
  lo

def qr_hi(x: QR) -> R.Real:
  QR{_, hi} = x
  hi

def same_sign(+x: R.Real, +sum: R.Real) -> Bool:
  Bool.or(R.less(zero(), R.mul(x, sum)), R.equal(x, zero()))

def q_range(+w01: R.Real, +w12: R.Real, +w20: R.Real) -> QR:
  +s0 = R.mul(w12, R.sub(R.add(w01, w20), w12))
  +s1 = R.mul(w20, R.sub(R.add(w01, w12), w20))
  +s2 = R.mul(w01, R.sub(R.add(w12, w20), w01))
  +sum = R.add(s0, R.add(s1, s2))
  +inside = Bool.and(Bool.not(R.equal(sum, zero())), Bool.and(same_sign(s0, sum), Bool.and(same_sign(s1, sum), same_sign(s2, sum))))
  +star = Bool.pick(R.Real, inside, R.div(R.mul(w01, R.mul(w12, w20)), Bool.pick(R.Real, inside, sum, rf(1.0))), zero())
  +e01 = R.div(w01, rf(4.0))
  +e12 = R.div(w12, rf(4.0))
  +e20 = R.div(w20, rf(4.0))
  QR{R.min(R.min(zero(), star), R.min(e01, R.min(e12, e20))), R.max(R.max(zero(), star), R.max(e01, R.max(e12, e20)))}

def sq3(+v: G.Vec3) -> R.Real:
  G.dot(v, v)

def perp(+v: G.Vec3, +k: G.Vec3) -> G.Vec3:
  G.sub(v, G.scale(k, G.dot(v, k)))

# The distance to a level set phi = t^2 (t > 0: radius) of points whose phi
# lies in [lo, hi]: max(t - sqrt(max(0, lo)), sqrt(hi) - t).
def radial_gap(+lo: R.Real, +hi: R.Real, +t: R.Real) -> R.Real:
  R.max(R.sub(t, R.sqrt(R.max(zero(), lo))), R.sub(R.sqrt(R.max(zero(), hi)), t))

def min3(+x: R.Real, +y: R.Real, +z: R.Real) -> R.Real:
  R.min(x, R.min(y, z))

def max3(+x: R.Real, +y: R.Real, +z: R.Real) -> R.Real:
  R.max(x, R.max(y, z))

def plane_bound(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3, +s: A.Surface) -> R.Real:
  max3(R.abs(fg_f(carrier_fg(s, a))), R.abs(fg_f(carrier_fg(s, b))), R.abs(fg_f(carrier_fg(s, c))))

def quad_bound(+pa: R.Real, +pb: R.Real, +pc: R.Real, q: QR, +t: R.Real) -> R.Real:
  QR{+lo, +hi} = q
  radial_gap(R.sub(min3(pa, pb, pc), hi), R.sub(max3(pa, pb, pc), lo), t)

def cyl_bound(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3, +o: G.Vec3, +k: G.Vec3, +r: R.Real) -> R.Real:
  quad_bound(sq3(perp(G.sub(a, o), k)), sq3(perp(G.sub(b, o), k)), sq3(perp(G.sub(c, o), k)),
    q_range(sq3(perp(G.sub(b, a), k)), sq3(perp(G.sub(c, b), k)), sq3(perp(G.sub(a, c), k))), r)

def sphere_bound(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3, +o: G.Vec3, +r: R.Real) -> R.Real:
  quad_bound(sq3(G.sub(a, o)), sq3(G.sub(b, o)), sq3(G.sub(c, o)), q_range(sq3(G.sub(b, a)), sq3(G.sub(c, b)), sq3(G.sub(a, c))), r)

# Cone: phi = rho^2 - r_h^2, r_h = r + h tan; 1/2 e^T H e = |e_perp|^2 -
# tan^2 (e.a)^2 (indefinite). |rho - r_h| = |phi| / (rho + r_h), rho + r_h >=
# r_min + sqrt(max(0, r_min^2 - |phi|)) with r_min the smallest r_h at a
# vertex (r_h is linear); the distance is |rho - r_h| cos. No bound when
# r_min <= 0 (the triangle reaches the apex).
def cone_w(+e: G.Vec3, +k: G.Vec3, +tn2: R.Real) -> R.Real:
  R.sub(sq3(perp(e, k)), R.mul(tn2, sq(G.dot(e, k))))

def cone_phi(+p: G.Vec3, +o: G.Vec3, +k: G.Vec3, +r: R.Real, +tn: R.Real) -> R.Real:
  +d = G.sub(p, o)
  R.sub(sq3(perp(d, k)), sq(R.add(r, R.mul(G.dot(d, k), tn))))

def cone_rh(+p: G.Vec3, +o: G.Vec3, +k: G.Vec3, +r: R.Real, +tn: R.Real) -> R.Real:
  R.add(r, R.mul(G.dot(G.sub(p, o), k), tn))

def cone_finish(+phi_abs: R.Real, +rmin: R.Real, +cs: R.Real) -> R.Real:
  +den = R.add(rmin, R.sqrt(R.max(zero(), R.sub(sq(rmin), phi_abs))))
  Bool.pick(R.Real, R.less(zero(), rmin), R.div(R.mul(phi_abs, cs), Bool.pick(R.Real, R.less(zero(), rmin), den, rf(1.0))), rf(F32.neg(1.0)))

def cone_range(+pa: R.Real, +pb: R.Real, +pc: R.Real, q: QR) -> R.Real:
  QR{+lo, +hi} = q
  R.max(R.abs(R.sub(min3(pa, pb, pc), hi)), R.abs(R.sub(max3(pa, pb, pc), lo)))

def cone_bound(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3, +o: G.Vec3, +k: G.Vec3, +r: R.Real, +angle: R.Real) -> R.Real:
  +cs = R.cos(angle)
  +tn = R.div(R.sin(angle), cs)
  +tn2 = sq(tn)
  +range = cone_range(cone_phi(a, o, k, r, tn), cone_phi(b, o, k, r, tn), cone_phi(c, o, k, r, tn),
    q_range(cone_w(G.sub(b, a), k, tn2), cone_w(G.sub(c, b), k, tn2), cone_w(G.sub(a, c), k, tn2)))
  cone_finish(range, min3(cone_rh(a, o, k, r, tn), cone_rh(b, o, k, r, tn), cone_rh(c, o, k, r, tn)), cs)

# Torus: phi = (rho - R)^2 + h^2, H = 2 I - 2 R Hess(rho), 0 <= e^T Hess(rho)
# e <= |e_perp|^2 / rho. Hence phi(p) >= min phi_i - max q(|e|^2) and
# phi(p) <= max phi_i - min q(|e|^2 - (R / rho_min) |e_perp|^2), rho_min =
# the smallest vertex rho minus the longest edge (rho is 1-Lipschitz); no
# bound when rho_min <= 0.
def torus_phi(+p: G.Vec3, +o: G.Vec3, +k: G.Vec3, +big: R.Real) -> R.Real:
  +d = G.sub(p, o)
  R.add(sq(R.sub(vlen(perp(d, k)), big)), sq(G.dot(d, k)))

def torus_rho(+p: G.Vec3, +o: G.Vec3, +k: G.Vec3) -> R.Real:
  vlen(perp(G.sub(p, o), k))

def torus_w(+e: G.Vec3, +k: G.Vec3, +ratio: R.Real) -> R.Real:
  R.sub(sq3(e), R.mul(ratio, sq3(perp(e, k))))

def torus_finish(+pa: R.Real, +pb: R.Real, +pc: R.Real, qlow: QR, qhigh: QR, +rmin: R.Real, +small: R.Real) -> R.Real:
  +gap = radial_gap(R.sub(min3(pa, pb, pc), qr_hi(qlow)), R.sub(max3(pa, pb, pc), qr_lo(qhigh)), small)
  Bool.pick(R.Real, R.less(zero(), rmin), gap, rf(F32.neg(1.0)))

def torus_bound(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3, +o: G.Vec3, +k: G.Vec3, +big: R.Real, +small: R.Real) -> R.Real:
  +eab = G.sub(b, a)
  +ebc = G.sub(c, b)
  +eca = G.sub(a, c)
  +longest = R.sqrt(max3(sq3(eab), sq3(ebc), sq3(eca)))
  +rmin = R.sub(min3(torus_rho(a, o, k), torus_rho(b, o, k), torus_rho(c, o, k)), longest)
  +ratio = R.div(big, Bool.pick(R.Real, R.less(zero(), rmin), rmin, rf(1.0)))
  torus_finish(torus_phi(a, o, k, big), torus_phi(b, o, k, big), torus_phi(c, o, k, big),
    q_range(sq3(eab), sq3(ebc), sq3(eca)), q_range(torus_w(eab, k, ratio), torus_w(ebc, k, ratio), torus_w(eca, k, ratio)), rmin, small)

type BTri is Data:
  BTri{a: G.Vec3, b: G.Vec3, c: G.Vec3, s: A.Surface}

# bound: as above; cosine: the triangle normal against the carrier's unit
# normal at the centroid (recover refuses a triangle with |cosine| <= 1/2).
type Bounded is Data:
  Bounded{bound: R.Real, cosine: R.Real}

def tri_cosine(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3, s: A.Surface) -> R.Real:
  +n = G.cross(G.sub(b, a), G.sub(c, a))
  +m = G.scale(G.add(a, G.add(b, c)), R.div(rf(1.0), rf(3.0)))
  R.div(G.dot(n, fg_g(carrier_fg(s, m))), R.add(vlen(n), rf(0.000000000000000000001)))

def tri_distance(+a: G.Vec3, +b: G.Vec3, +c: G.Vec3, s: A.Surface) -> R.Real:
  match s:
    case A.Plane{o, n, x}:
      plane_bound(a, b, c, A.Plane{o, n, x})
    case A.Cylinder{o, k, _, r}:
      cyl_bound(a, b, c, o, G.normalize(k), r)
    case A.Cone{o, k, _, r, angle}:
      cone_bound(a, b, c, o, G.normalize(k), r, angle)
    case A.Sphere{o, _, _, r}:
      sphere_bound(a, b, c, o, r)
    case A.Torus{o, k, _, big, small}:
      torus_bound(a, b, c, o, G.normalize(k), big, small)

def tri_bound(t: BTri) -> Bounded:
  BTri{+a, +b, +c, +s} = t
  Bounded{tri_distance(a, b, c, s), tri_cosine(a, b, c, s)}

def mesh_bound.go(ts: List<&2, BTri>, acc: List<&2, Bounded>) -> List<&2, Bounded>:
  match ts:
    case Nil{}:
      List.reverse(&2, Bounded, acc)
    case t <> rest:
      mesh_bound.go(rest, tri_bound(t) <> acc)

def mesh_bound(ts: List<&2, BTri>) -> List<&2, Bounded>:
  mesh_bound.go(ts, Nil{})
