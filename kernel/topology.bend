import Base
import ./geometry.bend as G

type Edge is Data:
  Edge{start: U32, end: U32}

type Coedge is Data:
  Use{edge: U32, forward: Bool}

type Face is Data:
  Face{origin: G.Vec3, normal: G.Vec3, x: G.Vec3, boundary: List<&2, Coedge>}

type Solid is Data:
  Solid{vertices: List<&2, G.Vec3>, edges: List<&2, Edge>, faces: List<&2, Face>}

def flip(use: Coedge) -> Coedge:
  Use{edge, forward} = use
  Use{edge, Bool.not(forward)}

def next(+i: U32, n: U32) -> U32:
  Bool.pick(U32, U32.is_eq((i + 1 : U32), n), 0, (i + 1 : U32))

def ring_edges(left: Nat, +n: U32, +offset: U32, +i: U32) -> List<&2, Edge>:
  match left:
    case 0n:
      Nil{}
    case 1n+p:
      Edge{(offset + i : U32), (offset + next(i, n) : U32)} <>
        ring_edges(p, n, offset, (i + 1 : U32))

def vertical_edges(left: Nat, +n: U32, +i: U32) -> List<&2, Edge>:
  match left:
    case 0n:
      Nil{}
    case 1n+p:
      Edge{i, (n + i : U32)} <> vertical_edges(p, n, (i + 1 : U32))

def ring_uses(left: Nat, +offset: U32, +i: U32) -> List<&2, Coedge>:
  match left:
    case 0n:
      Nil{}
    case 1n+p:
      Use{(offset + i : U32), True{}} <> ring_uses(p, offset, (i + 1 : U32))

def reverse_uses(uses: List<&2, Coedge>, acc: List<&2, Coedge>) -> List<&2, Coedge>:
  match uses:
    case Nil{}:
      acc
    case use <> tail:
      reverse_uses(tail, flip(use) <> acc)

def side_face(+a: G.Vec3, b: G.Vec3, +delta: G.Vec3, +n: U32, +i: U32) -> Face:
  +x = G.normalize(G.sub(b, a))
  Face{a, G.normalize(G.cross(x, delta)), x,
    [Use{i, True{}}, Use{(2 * n + next(i, n) : U32), True{}},
     Use{(n + i : U32), False{}}, Use{(2 * n + i : U32), False{}}]}

def side_faces(points: List<&2, G.Vec3>, +first: G.Vec3, +delta: G.Vec3, +n: U32, +i: U32) -> List<&2, Face>:
  match points:
    case Nil{}:
      Nil{}
    case a <> +tail:
      side_face(a, G.first_or(tail, first), delta, n, i) <>
        side_faces(tail, first, delta, n, (i + 1 : U32))

def first_edge(points: List<&2, G.Vec3>) -> G.Vec3:
  match points:
    case a <> b <> tail:
      G.normalize(G.sub(b, a))
    case _:
      G.V3{1.0, 0.0, 0.0}

# Preconditions, checked by the host: simple planar polygon, >= 3 vertices,
# counterclockwise along delta; finite nonzero sweep crossing the sketch plane.
# Edge tables are shared; face loops reference them with explicit orientation.
def extrude(+points: List<&2, G.Vec3>, +delta: G.Vec3) -> Solid:
  +count = List.length(&2, G.Vec3, points)
  +n = U32.from_nat(count)
  +first = G.first_or(points, G.V3{0.0, 0.0, 0.0})
  +normal = G.normalize(G.area_vector(points, first))
  # Use the first polygon edge as the plane's reference direction.
  +ref = first_edge(points)
  +uses = ring_uses(count, 0, 0)
  bottom = {Face{first, G.scale(normal, F32.neg(1.0)), ref, reverse_uses(uses, Nil{})} : Face}
  top = {Face{G.add(first, delta), normal, ref, ring_uses(count, n, 0)} : Face}
  lower upper = ring_edges(count, n, 0, 0) ring_edges(count, n, n, 0)
  Solid{
    List.append(&2, G.Vec3, points, G.translate(points, delta)),
    List.append(&2, Edge, lower, List.append(&2, Edge, upper, vertical_edges(count, n, 0))),
    bottom <> top <> side_faces(points, first, delta, n, 0)}

def transform_faces(faces: List<&2, Face>, +rotation: G.Rotation, +offset: G.Vec3) -> List<&2, Face>:
  match faces:
    case Nil{}:
      Nil{}
    case Face{origin, normal, x, boundary} <> tail:
      Face{G.add(G.rotate(origin, rotation), offset), G.rotate(normal, rotation), G.rotate(x, rotation), boundary} <>
        transform_faces(tail, rotation, offset)

# Rigid transforms preserve the existing shared topology and outward winding.
def transform(solid: Solid, +rotation: G.Rotation, +offset: G.Vec3) -> Solid:
  Solid{vertices, edges, faces} = solid
  Solid{G.transform_points(vertices, rotation, offset), edges, transform_faces(faces, rotation, offset)}
