import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../topology.bend as T
import ../curve-plane.bend as C
import ../face-classification.bend as F
import ../halfspace.bend as H
import ../cylinder-classification.bend as K

# Analytic boundary integrals. No sampled polygon is used for area or volume.
type Span is Data:
  Span{first: R.Real, last: R.Real}

def zero() -> R.Real:
  R.from_f32(0.0)

def one() -> R.Real:
  R.from_f32(1.0)

def sign(forward: Bool, +sense: Bool) -> R.Real:
  Bool.pick(R.Real, Bool.pick(Bool, forward, sense, Bool.not(sense)), one(), R.neg(one()))

def span(domain: C.Domain) -> Span:
  match domain:
    case C.Interval{first, last}:
      Span{first, last}
    case C.Untrimmed{}:
      Span{zero(), C.tau()}

def domain(choice: Maybe<&2, F.DomainChoice>, +edge: A.Edge, +vertices: List<&2, G.Vec3>) -> Maybe<&2, C.Domain>:
  A.Edge{a, b, _, _} = edge
  F.resolve_domain(F.choose_domain(choice), edge, H.vertex(vertices, a), H.vertex(vertices, b))

def resolved_domain(found: Maybe<&2, C.Domain>) -> C.Domain:
  match found:
    case Some{value}:
      value
    case None{}:
      C.Untrimmed{}

def edge_domain(+edge: A.Edge, index: U32, domains: List<&2, F.DomainChoice>, vertices: List<&2, G.Vec3>) -> C.Domain:
  resolved_domain(domain(List.get(&2, F.DomainChoice, domains, U32.to_nat(index)), edge, vertices))

def round_vector(+center: G.Vec3, +u: G.Vec3, +v: G.Vec3, range: Span) -> G.Vec3:
  Span{+a, +b} = range
  delta = G.add(G.scale(u, R.sub(R.cos(b), R.cos(a))), G.scale(v, R.sub(R.sin(b), R.sin(a))))
  G.add(G.cross(center, delta), G.scale(G.cross(u, v), R.sub(b, a)))

def curve_vector(+curve: A.Curve, range: Span, +reference: G.Vec3) -> G.Vec3:
  match curve:
    case A.Line{_, _}:
      Span{a, b} = range
      G.cross(G.sub(A.curve_point(curve, a), reference), G.sub(A.curve_point(curve, b), reference))
    case A.Circle{center, normal, +x, +radius}:
      round_vector(G.sub(center, reference), G.scale(x, radius), G.scale(G.cross(normal, x), radius), range)
    case A.Ellipse{center, normal, +x, major, minor}:
      round_vector(G.sub(center, reference), G.scale(x, major), G.scale(G.cross(normal, x), minor), range)

def vector_edge(+edge: A.Edge, index: U32, forward: Bool, domains: List<&2, F.DomainChoice>, vertices: List<&2, G.Vec3>, reference: G.Vec3) -> G.Vec3:
  A.Edge{_, _, curve, sense} = edge
  G.scale(curve_vector(curve, span(edge_domain(edge, index, domains, vertices)), reference), sign(forward, sense))

def vector_use(use: T.Coedge, edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, vertices: List<&2, G.Vec3>, reference: G.Vec3) -> G.Vec3:
  T.Use{+index, forward} = use
  vector_edge(H.edge(List.get(&2, A.Edge, edges, U32.to_nat(index))), index, forward, domains, vertices, reference)

def vector_ring(uses: List<&2, T.Coedge>, +edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, +vertices: List<&2, G.Vec3>, +reference: G.Vec3) -> G.Vec3:
  match uses:
    case Nil{}:
      G.v3(0.0, 0.0, 0.0)
    case head <> tail:
      G.add(vector_use(head, edges, domains, vertices, reference), vector_ring(tail, edges, domains, vertices, reference))

def integral_product(+a0: R.Real, +ac: R.Real, +as: R.Real, +b0: R.Real, +bc: R.Real, +bs: R.Real, range: Span) -> R.Real:
  Span{+lo, +hi} = range
  +dt = R.sub(hi, lo)
  cosine = R.sub(R.sin(hi), R.sin(lo))
  sine = R.sub(R.cos(lo), R.cos(hi))
  +double_sine = R.mul(R.sub(R.sin(R.mul(R.from_f32(2.0), hi)), R.sin(R.mul(R.from_f32(2.0), lo))), R.from_f32(0.25))
  cc = R.add(R.mul(dt, R.from_f32(0.5)), double_sine)
  ss = R.sub(R.mul(dt, R.from_f32(0.5)), double_sine)
  cs = R.mul(R.sub(R.cos(R.mul(R.from_f32(2.0), lo)), R.cos(R.mul(R.from_f32(2.0), hi))), R.from_f32(0.25))
  constant = R.mul(R.mul(a0, b0), dt)
  linear = R.add(R.mul(R.add(R.mul(a0, bc), R.mul(ac, b0)), cosine), R.mul(R.add(R.mul(a0, bs), R.mul(as, b0)), sine))
  quadratic = R.add(R.add(R.mul(R.mul(ac, bc), cc), R.mul(R.mul(as, bs), ss)), R.mul(R.add(R.mul(ac, bs), R.mul(as, bc)), cs))
  R.add(constant, R.add(linear, quadratic))

def angular_sign(+u: G.Vec3, +v: G.Vec3, +axis: G.Vec3) -> R.Real:
  Bool.pick(R.Real, R.less(zero(), G.dot(G.cross(K.radial(u, axis), K.radial(v, axis)), axis)), one(), R.neg(one()))

def round_winding(u: G.Vec3, v: G.Vec3, axis: G.Vec3, range: Span) -> R.Real:
  Span{a, b} = range
  R.mul(angular_sign(u, v, axis), R.sub(b, a))

def winding_curve(curve: A.Curve, axis: G.Vec3, range: Span) -> R.Real:
  match curve:
    case A.Line{_, _}:
      zero()
    case A.Circle{_, normal, +x, +radius}:
      round_winding(G.scale(x, radius), G.scale(G.cross(normal, x), radius), axis, range)
    case A.Ellipse{_, normal, +x, major, minor}:
      round_winding(G.scale(x, major), G.scale(G.cross(normal, x), minor), axis, range)

# Integral -r * z * d(theta) is the oriented cylindrical area. For flux,
# multiply by (r + dot(cylinder-origin-reference, radial-unit)).
def round_cylinder(+center: G.Vec3, +u: G.Vec3, +v: G.Vec3, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real, reference: G.Vec3, range: Span, +flux: Bool) -> R.Real:
  +delta = G.sub(origin, reference)
  +radial_center = K.radial(G.sub(center, origin), axis)
  z0 = G.dot(G.sub(center, origin), axis)
  zc = G.dot(u, axis)
  zs = G.dot(v, axis)
  f0 = Bool.pick(R.Real, flux, R.add(radius, R.div(G.dot(delta, radial_center), radius)), one())
  fc = Bool.pick(R.Real, flux, R.div(G.dot(delta, K.radial(u, axis)), radius), zero())
  fs = Bool.pick(R.Real, flux, R.div(G.dot(delta, K.radial(v, axis)), radius), zero())
  R.mul(R.neg(R.mul(radius, angular_sign(u, v, axis))), integral_product(z0, zc, zs, f0, fc, fs, range))

def cylinder_curve(curve: A.Curve, origin: G.Vec3, axis: G.Vec3, radius: R.Real, reference: G.Vec3, range: Span, flux: Bool) -> R.Real:
  match curve:
    case A.Line{_, _}:
      zero()
    case A.Circle{center, normal, +x, +r}:
      round_cylinder(center, G.scale(x, r), G.scale(G.cross(normal, x), r), origin, axis, radius, reference, range, flux)
    case A.Ellipse{center, normal, +x, major, minor}:
      round_cylinder(center, G.scale(x, major), G.scale(G.cross(normal, x), minor), origin, axis, radius, reference, range, flux)

def cylindrical_edge(+edge: A.Edge, index: U32, forward: Bool, domains: List<&2, F.DomainChoice>, vertices: List<&2, G.Vec3>, origin: G.Vec3, +axis: G.Vec3, radius: R.Real, reference: G.Vec3, +mode: U32) -> R.Real:
  A.Edge{_, _, +curve, sense} = edge
  +range = span(edge_domain(edge, index, domains, vertices))
  value = Bool.pick(R.Real, U32.is_eq(mode, 0), winding_curve(curve, axis, range), cylinder_curve(curve, origin, axis, radius, reference, range, U32.is_eq(mode, 2)))
  R.mul(sign(forward, sense), value)

def cylindrical_use(use: T.Coedge, edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, vertices: List<&2, G.Vec3>, origin: G.Vec3, axis: G.Vec3, radius: R.Real, reference: G.Vec3, mode: U32) -> R.Real:
  T.Use{+index, forward} = use
  cylindrical_edge(H.edge(List.get(&2, A.Edge, edges, U32.to_nat(index))), index, forward, domains, vertices, origin, axis, radius, reference, mode)

def cylindrical_ring(uses: List<&2, T.Coedge>, +edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, +vertices: List<&2, G.Vec3>, +origin: G.Vec3, +axis: G.Vec3, +radius: R.Real, +reference: G.Vec3, +mode: U32) -> R.Real:
  match uses:
    case Nil{}:
      zero()
    case head <> tail:
      R.add(cylindrical_use(head, edges, domains, vertices, origin, axis, radius, reference, mode), cylindrical_ring(tail, edges, domains, vertices, origin, axis, radius, reference, mode))

def ring_area(surface: A.Surface, sense: Bool, uses: List<&2, T.Coedge>, edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, vertices: List<&2, G.Vec3>) -> R.Real:
  match surface:
    case A.Plane{origin, normal, _}:
      R.mul(R.mul(sign(True{}, sense), R.from_f32(0.5)), G.dot(vector_ring(uses, edges, domains, vertices, origin), G.normalize(normal)))
    case A.Cylinder{+origin, axis, _, radius}:
      R.mul(sign(True{}, sense), cylindrical_ring(uses, edges, domains, vertices, origin, G.normalize(axis), radius, origin, 1))
    case _:
      zero()

def winding(surface: A.Surface, uses: List<&2, T.Coedge>, edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, vertices: List<&2, G.Vec3>) -> R.Real:
  match surface:
    case A.Cylinder{+origin, axis, _, radius}:
      cylindrical_ring(uses, edges, domains, vertices, origin, G.normalize(axis), radius, origin, 0)
    case _:
      zero()

def face_ring_flux(surface: A.Surface, uses: List<&2, T.Coedge>, edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, vertices: List<&2, G.Vec3>, reference: G.Vec3) -> R.Real:
  match surface:
    case A.Plane{+origin, normal, _}:
      +unit = G.normalize(normal)
      area = R.mul(G.dot(vector_ring(uses, edges, domains, vertices, origin), unit), R.from_f32(0.5))
      R.mul(area, G.dot(G.sub(origin, reference), unit))
    case A.Cylinder{origin, axis, _, radius}:
      cylindrical_ring(uses, edges, domains, vertices, origin, G.normalize(axis), radius, reference, 2)
    case _:
      zero()

def loop_flux(+surface: A.Surface, loops: List<&2, A.Loop>, +edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, +vertices: List<&2, G.Vec3>, +reference: G.Vec3) -> R.Real:
  match loops:
    case Nil{}:
      zero()
    case A.Loop{_, uses} <> tail:
      R.add(face_ring_flux(surface, uses, edges, domains, vertices, reference), loop_flux(surface, tail, edges, domains, vertices, reference))

def faces_flux(faces: List<&2, A.Face>, +edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, +vertices: List<&2, G.Vec3>, +reference: G.Vec3) -> R.Real:
  match faces:
    case Nil{}:
      zero()
    case A.Face{surface, _, loops} <> tail:
      R.add(loop_flux(surface, loops, edges, domains, vertices, reference), faces_flux(tail, edges, domains, vertices, reference))

def volume(solid: A.Solid, domains: List<&2, F.DomainChoice>) -> R.Real:
  A.Solid{+vertices, edges, faces} = solid
  R.div(faces_flux(faces, edges, domains, vertices, H.vertex(vertices, 0)), R.from_f32(3.0))
