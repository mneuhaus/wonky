import Base
import ./real.bend as R
import ./precise.bend as G
import ./topology.bend as T
import ./intersections.bend as I

# Polygon prisms and rigid copies of polyhedral bodies on normalized F32x2
# words (docs/polygon-prism.md). All coordinates are millimetres.
#
# extrude builds the prism in the sketch frame: the profile lies on z = 0, the
# sweep s is the world sweep far - origin expressed in the frame, the caps are
# z = 0 and z = s.z, and each side carrier has the normal cross(edge tangent,
# s). Oblique sweeps are kept. The F32x2 rotation {u, v, n} then maps the
# profile to world, placed at the near cap origin (bottom) and at the far cap
# origin (top). Both cap origins are inputs: the host splits each once from its
# binary64 value, so two caps that describe the same plane get the same words
# whatever sum produced them (corpus W2 integrate: an open-top tray, box top
# 0 + 11.78 against pocket top 1.68 + 10.1, drifted 2.9e-14 mm apart when the
# sum was taken in F32x2 and the planar arrangement refused the ambiguous
# contact). The topology (vertex, edge and face order, loop orientation) is the
# one of topology.bend extrude.
#
# Every result is audited: each vertex against each of its face carriers,
# compared with angular_guard * scale, the planar arrangement's own admission
# (ports/curved-validate.bend resolution). Above that the result is a named
# refusal, never a body. The prism audit is structural and O(n); the general
# audit of transform/admit indexes vertices and edges through balanced trees,
# O(n log n).
#
# Preconditions left to the host: the profile is simple (no self-intersection
# or self-touch); that test is O(n^2) and stays in src/brep.mjs.

type Face is Data:
  Face{origin: G.Vec3, normal: G.Vec3, x: G.Vec3, boundary: List<&2, T.Coedge>}

type Solid is Data:
  Solid{vertices: List<&2, G.Vec3>, edges: List<&2, T.Edge>, faces: List<&2, Face>}

type Reason is Data:
  TooFewVertices{}
  InvalidInput{}
  InvalidPoint{index: U32}
  InvalidFrame{}
  DegenerateSweep{}
  ProfileOrientation{}
  ZeroLengthEdge{index: U32}
  NonRigidRotation{}
  DanglingIndex{}
  IncidenceAudit{required: R.Real, allowance: R.Real}
  TransformDrift{required: R.Real, before: R.Real, allowance: R.Real}

# required: the largest vertex-to-carrier distance measured in the audit;
# allowance: angular_guard * scale of the result.
type Outcome is Data:
  Built{solid: Solid, required: R.Real, allowance: R.Real}
  Refused{reason: Reason}

type Check is Data:
  Passed{}
  Failed{reason: Reason}

type Measure is Data:
  Measured{required: R.Real}
  Dangling{}

type Points is Data:
  PTip{}
  PLeaf{point: G.Vec3}
  PNode{even: Points, odd: Points}

type Edges is Data:
  ETip{}
  ELeaf{edge: T.Edge}
  ENode{even: Edges, odd: Edges}

type PointAt is Data:
  PointHit{point: G.Vec3}
  PointMiss{}

type EdgeAt is Data:
  EdgeHit{edge: T.Edge}
  EdgeMiss{}

def zero() -> R.Real:
  R.from_f32(0.0)

def one() -> R.Real:
  R.from_f32(1.0)

# Frame and rotation words must be orthonormal to 10 * angular_guard, the
# budget of curve-plane.bend frame_valid used by the line/arc extruder.
def frame_budget() -> R.Real:
  R.mul(I.angular_guard(), R.from_f32(10.0))

# Index trees hold up to 2^40 entries; deeper input is reported as dangling.
def depth() -> Nat:
  40n

def head_or(points: List<&2, G.Vec3>, fallback: G.Vec3) -> G.Vec3:
  match points:
    case Nil{}:
      fallback
    case p <> _:
      p

def second_or(points: List<&2, G.Vec3>, fallback: G.Vec3) -> G.Vec3:
  match points:
    case Nil{}:
      fallback
    case _ <> tail:
      head_or(tail, fallback)

def first_fail(a: Check, b: Check) -> Check:
  match a:
    case Passed{}:
      b
    case Failed{reason}:
      Failed{reason}

def worst(a: Measure, b: Measure) -> Measure:
  match a:
    case Dangling{}:
      Dangling{}
    case Measured{x}:
      match b:
        case Dangling{}:
          Dangling{}
        case Measured{y}:
          Measured{R.max(x, y)}

def unit_valid(+v: G.Vec3, +budget: R.Real) -> Bool:
  I.at_most(R.abs(R.sub(G.dot(v, v), one())), budget)

def ortho_valid(+a: G.Vec3, +b: G.Vec3, +budget: R.Real) -> Bool:
  I.at_most(R.abs(G.dot(a, b)), budget)

def frame_valid(+n: G.Vec3, +u: G.Vec3) -> Bool:
  +budget = frame_budget()
  Bool.and(unit_valid(n, budget), Bool.and(unit_valid(u, budget), ortho_valid(n, u, budget)))

# A proper rotation: orthonormal columns and a positive determinant.
def rotation_valid(rotation: G.Rotation) -> Bool:
  G.Rotation{+x, +y, +z} = rotation
  +budget = frame_budget()
  words = Bool.and(I.vec_valid(x), Bool.and(I.vec_valid(y), I.vec_valid(z)))
  units = Bool.and(unit_valid(x, budget), Bool.and(unit_valid(y, budget), unit_valid(z, budget)))
  orthogonal = Bool.and(ortho_valid(x, y, budget), Bool.and(ortho_valid(y, z, budget), ortho_valid(x, z, budget)))
  Bool.and(words, Bool.and(units, Bool.and(orthogonal, R.less(zero(), G.dot(G.cross(x, y), z)))))

def residual(point: G.Vec3, +origin: G.Vec3, +normal: G.Vec3) -> R.Real:
  R.abs(I.signed_distance(G.sub(point, origin), normal))

def points_scale(points: List<&2, G.Vec3>, +scale: R.Real) -> R.Real:
  match points:
    case Nil{}:
      scale
    case p <> tail:
      points_scale(tail, R.max(scale, I.magnitude(p)))

def faces_scale(faces: List<&2, Face>, +scale: R.Real) -> R.Real:
  match faces:
    case Nil{}:
      scale
    case Face{origin, _, _, _} <> tail:
      faces_scale(tail, R.max(scale, I.magnitude(origin)))

def points_residual(points: List<&2, G.Vec3>, +origin: G.Vec3, +normal: G.Vec3, +acc: R.Real) -> R.Real:
  match points:
    case Nil{}:
      acc
    case p <> tail:
      points_residual(tail, origin, normal, R.max(acc, residual(p, origin, normal)))

# List builders below are tail calls into reversed accumulators, then one
# List.reverse: the JS target keeps no stack for tail calls, so a 4096-vertex
# profile does not depend on the host's call stack depth.
def size(points: List<&2, G.Vec3>, +acc: U32) -> U32:
  match points:
    case Nil{}:
      acc
    case _ <> tail:
      size(tail, (acc + 1 : U32))

# World images rotate(p) + offset, in reverse order, pushed onto acc.
def moved_rev(points: List<&2, G.Vec3>, +rotation: G.Rotation, +offset: G.Vec3, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match points:
    case Nil{}:
      acc
    case p <> tail:
      moved_rev(tail, rotation, offset, G.add(G.rotate(p, rotation), offset) <> acc)

def move_face(face: Face, +rotation: G.Rotation, +offset: G.Vec3) -> Face:
  Face{origin, normal, x, boundary} = face
  Face{G.add(G.rotate(origin, rotation), offset), G.rotate(normal, rotation), G.rotate(x, rotation), boundary}

def move_faces_rev(faces: List<&2, Face>, +rotation: G.Rotation, +offset: G.Vec3, acc: List<&2, Face>) -> List<&2, Face>:
  match faces:
    case Nil{}:
      acc
    case face <> tail:
      move_faces_rev(tail, rotation, offset, move_face(face, rotation, offset) <> acc)

# ---------------------------------------------------------------------------
# General incidence audit: balanced index trees (even/odd split), O(n log n).

def alternate_points(points: List<&2, G.Vec3>, keep: Bool, acc: List<&2, G.Vec3>) -> List<&2, G.Vec3>:
  match points:
    case Nil{}:
      List.reverse(&2, G.Vec3, acc)
    case p <> tail:
      match keep:
        case True{}:
          alternate_points(tail, False{}, p <> acc)
        case False{}:
          alternate_points(tail, True{}, acc)

def points_tree(fuel: Nat, +points: List<&2, G.Vec3>) -> Points:
  match fuel:
    case 0n:
      PTip{}
    case 1n+(+d):
      match points:
        case Nil{}:
          PTip{}
        case p <> rest:
          match rest:
            case Nil{}:
              PLeaf{p}
            case _:
              PNode{points_tree(d, alternate_points(points, True{}, Nil{})), points_tree(d, alternate_points(points, False{}, Nil{}))}

def point_at(fuel: Nat, tree: Points, +index: U32) -> PointAt:
  match fuel:
    case 0n:
      PointMiss{}
    case 1n+(+d):
      match tree:
        case PTip{}:
          PointMiss{}
        case PLeaf{p}:
          Bool.pick(PointAt, U32.is_eq(index, 0), PointHit{p}, PointMiss{})
        case PNode{even, odd}:
          point_at(d, Bool.pick(Points, U32.is_eq((index % 2 : U32), 0), even, odd), (index / 2 : U32))

def alternate_edges(edges: List<&2, T.Edge>, keep: Bool, acc: List<&2, T.Edge>) -> List<&2, T.Edge>:
  match edges:
    case Nil{}:
      List.reverse(&2, T.Edge, acc)
    case e <> tail:
      match keep:
        case True{}:
          alternate_edges(tail, False{}, e <> acc)
        case False{}:
          alternate_edges(tail, True{}, acc)

def edges_tree(fuel: Nat, +edges: List<&2, T.Edge>) -> Edges:
  match fuel:
    case 0n:
      ETip{}
    case 1n+(+d):
      match edges:
        case Nil{}:
          ETip{}
        case e <> rest:
          match rest:
            case Nil{}:
              ELeaf{e}
            case _:
              ENode{edges_tree(d, alternate_edges(edges, True{}, Nil{})), edges_tree(d, alternate_edges(edges, False{}, Nil{}))}

def edge_at(fuel: Nat, tree: Edges, +index: U32) -> EdgeAt:
  match fuel:
    case 0n:
      EdgeMiss{}
    case 1n+(+d):
      match tree:
        case ETip{}:
          EdgeMiss{}
        case ELeaf{e}:
          Bool.pick(EdgeAt, U32.is_eq(index, 0), EdgeHit{e}, EdgeMiss{})
        case ENode{even, odd}:
          edge_at(d, Bool.pick(Edges, U32.is_eq((index % 2 : U32), 0), even, odd), (index / 2 : U32))

def point_measure(found: PointAt, +origin: G.Vec3, +normal: G.Vec3) -> Measure:
  match found:
    case PointMiss{}:
      Dangling{}
    case PointHit{p}:
      Measured{residual(p, origin, normal)}

def edge_measure(found: EdgeAt, +points: Points, +origin: G.Vec3, +normal: G.Vec3) -> Measure:
  match found:
    case EdgeMiss{}:
      Dangling{}
    case EdgeHit{T.Edge{start, end}}:
      worst(point_measure(point_at(depth(), points, start), origin, normal), point_measure(point_at(depth(), points, end), origin, normal))

def loop_measure(uses: List<&2, T.Coedge>, +points: Points, +edges: Edges, +origin: G.Vec3, +normal: G.Vec3, acc: Measure) -> Measure:
  match uses:
    case Nil{}:
      acc
    case T.Use{edge, _} <> tail:
      loop_measure(tail, points, edges, origin, normal, worst(acc, edge_measure(edge_at(depth(), edges, edge), points, origin, normal)))

def faces_measure(faces: List<&2, Face>, +points: Points, +edges: Edges, acc: Measure) -> Measure:
  match faces:
    case Nil{}:
      acc
    case Face{origin, normal, _, boundary} <> tail:
      faces_measure(tail, points, edges, loop_measure(boundary, points, edges, origin, normal, acc))

def incidence(solid: Solid) -> Measure:
  Solid{+vertices, +edges, faces} = solid
  faces_measure(faces, points_tree(depth(), vertices), edges_tree(depth(), edges), Measured{zero()})

def allowance(solid: Solid) -> R.Real:
  Solid{vertices, _, faces} = solid
  R.mul(I.angular_guard(), faces_scale(faces, points_scale(vertices, one())))

def admitted(measure: Measure, +limit: R.Real, solid: Solid) -> Outcome:
  match measure:
    case Dangling{}:
      Refused{DanglingIndex{}}
    case Measured{+required}:
      Bool.pick(Outcome, I.at_most(required, limit), Built{solid, required, limit}, Refused{IncidenceAudit{required, limit}})

# The general audit of an existing polyhedral body.
def admit(+solid: Solid) -> Outcome:
  admitted(incidence(solid), allowance(solid), solid)

# ---------------------------------------------------------------------------
# Rigid transform.

def moved(solid: Solid, +rotation: G.Rotation, +offset: G.Vec3) -> Solid:
  Solid{vertices, edges, faces} = solid
  Solid{List.reverse(&2, G.Vec3, moved_rev(vertices, rotation, offset, Nil{})), edges, List.reverse(&2, Face, move_faces_rev(faces, rotation, offset, Nil{}))}

# The copy may not move any vertex off its carriers by more than the
# allowance beyond what the source already had, so an imprecise source is
# copied (with its own residual reported) but never made worse.
def drift_checked(before: Measure, after: Measure, +limit: R.Real, solid: Solid) -> Outcome:
  match before:
    case Dangling{}:
      Refused{DanglingIndex{}}
    case Measured{+b}:
      match after:
        case Dangling{}:
          Refused{DanglingIndex{}}
        case Measured{+a}:
          Bool.pick(Outcome, I.at_most(a, R.add(b, limit)), Built{solid, a, limit}, Refused{TransformDrift{a, b, limit}})

def transform_checked(rigid: Bool, finite: Bool, +solid: Solid, +rotation: G.Rotation, +offset: G.Vec3) -> Outcome:
  match rigid:
    case False{}:
      Refused{NonRigidRotation{}}
    case True{}:
      match finite:
        case False{}:
          Refused{InvalidInput{}}
        case True{}:
          +after = moved(solid, rotation, offset)
          drift_checked(incidence(solid), incidence(after), allowance(after), after)

# rotation holds the columns: rotate(p) = x * p.x + y * p.y + z * p.z.
def transform(+solid: Solid, +rotation: G.Rotation, +offset: G.Vec3) -> Outcome:
  transform_checked(rotation_valid(rotation), I.vec_valid(offset), solid, rotation, offset)

# ---------------------------------------------------------------------------
# Prism.

def point_valid(+p: G.Vec3) -> Bool:
  G.V3{_, _, z} = p
  Bool.and(I.vec_valid(p), R.equal(z, zero()))

def check_points(points: List<&2, G.Vec3>, +index: U32, acc: Check) -> Check:
  match points:
    case Nil{}:
      acc
    case p <> tail:
      check_points(tail, (index + 1 : U32), first_fail(acc, Bool.pick(Check, point_valid(p), Passed{}, Failed{InvalidPoint{index}})))

def check_edges(points: List<&2, G.Vec3>, +first: G.Vec3, +resolution: R.Real, +index: U32, acc: Check) -> Check:
  match points:
    case Nil{}:
      acc
    case a <> +tail:
      short = I.at_most(I.magnitude(G.sub(head_or(tail, first), a)), resolution)
      check_edges(tail, first, resolution, (index + 1 : U32), first_fail(acc, Bool.pick(Check, short, Failed{ZeroLengthEdge{index}}, Passed{})))

def cross_z(a: G.Vec3, b: G.Vec3) -> R.Real:
  G.V3{ax, ay, _} = a
  G.V3{bx, by, _} = b
  R.sub(R.mul(ax, by), R.mul(ay, bx))

# Twice the signed area of the profile in the sketch plane.
def area2(points: List<&2, G.Vec3>, +first: G.Vec3, +acc: R.Real) -> R.Real:
  match points:
    case Nil{}:
      acc
    case a <> +tail:
      area2(tail, first, R.add(acc, cross_z(a, head_or(tail, first))))

def sweep_depth(s: G.Vec3) -> R.Real:
  G.V3{_, _, z} = s
  z

def side_face(+a: G.Vec3, b: G.Vec3, +s: G.Vec3, +n: U32, +i: U32) -> Face:
  +t = G.sub(b, a)
  Face{a, G.normalize(G.cross(t, s)), G.normalize(t),
    [T.Use{i, True{}}, T.Use{(2 * n + T.next(i, n) : U32), True{}},
     T.Use{(n + i : U32), False{}}, T.Use{(2 * n + i : U32), False{}}]}

# World side faces, reversed, pushed onto acc.
def sides_rev(points: List<&2, G.Vec3>, +first: G.Vec3, +s: G.Vec3, +n: U32, +i: U32, +rotation: G.Rotation, +offset: G.Vec3, acc: List<&2, Face>) -> List<&2, Face>:
  match points:
    case Nil{}:
      acc
    case a <> +tail:
      sides_rev(tail, first, s, n, (i + 1 : U32), rotation, offset, move_face(side_face(a, head_or(tail, first), s, n, i), rotation, offset) <> acc)

# Edge i of the ring at offset: offset + i -> offset + next(i).
def ring_rev(points: List<&2, G.Vec3>, +n: U32, +offset: U32, +i: U32, acc: List<&2, T.Edge>) -> List<&2, T.Edge>:
  match points:
    case Nil{}:
      acc
    case _ <> tail:
      ring_rev(tail, n, offset, (i + 1 : U32), T.Edge{(offset + i : U32), (offset + T.next(i, n) : U32)} <> acc)

def vertical_rev(points: List<&2, G.Vec3>, +n: U32, +i: U32, acc: List<&2, T.Edge>) -> List<&2, T.Edge>:
  match points:
    case Nil{}:
      acc
    case _ <> tail:
      vertical_rev(tail, n, (i + 1 : U32), T.Edge{i, (n + i : U32)} <> acc)

# Coedges offset + i with the given direction, reversed, pushed onto acc.
def uses_rev(points: List<&2, G.Vec3>, +offset: U32, +i: U32, +forward: Bool, acc: List<&2, T.Coedge>) -> List<&2, T.Coedge>:
  match points:
    case Nil{}:
      acc
    case _ <> tail:
      uses_rev(tail, offset, (i + 1 : U32), forward, T.Use{(offset + i : U32), forward} <> acc)

# Side i spans bottom vertices i, i+1 and top vertices i, i+1 (cyclic).
def sides_residual(faces: List<&2, Face>, low: List<&2, G.Vec3>, high: List<&2, G.Vec3>, +low0: G.Vec3, +high0: G.Vec3, +acc: R.Real) -> R.Real:
  match faces:
    case Nil{}:
      acc
    case Face{+origin, +normal, _, _} <> tail:
      match low:
        case Nil{}:
          acc
        case a <> +lows:
          match high:
            case Nil{}:
              acc
            case c <> +highs:
              bottom = R.max(residual(a, origin, normal), residual(head_or(lows, low0), origin, normal))
              top = R.max(residual(c, origin, normal), residual(head_or(highs, high0), origin, normal))
              sides_residual(tail, lows, highs, low0, high0, R.max(acc, R.max(bottom, top)))

def cap_residual(face: Face, points: List<&2, G.Vec3>) -> R.Real:
  Face{origin, normal, _, _} = face
  points_residual(points, origin, normal, zero())

# The topology is the one of topology.bend extrude: vertices bottom 0..n-1
# then top n..2n-1; edges bottom ring, top ring, verticals; faces bottom, top,
# then side i. The bottom loop is the reversed ring with flipped uses.
def construct(+n: U32, +points: List<&2, G.Vec3>, +first: G.Vec3, +rotation: G.Rotation, +origin: G.Vec3, +far: G.Vec3, +s: G.Vec3) -> Outcome:
  +up = Bool.pick(R.Real, R.less(zero(), sweep_depth(s)), one(), R.neg(one()))
  +ref = G.normalize(G.sub(second_or(points, first), first))
  +bottom = move_face(Face{first, G.V3{zero(), zero(), R.neg(up)}, ref, uses_rev(points, 0, 0, False{}, Nil{})}, rotation, origin)
  +lid = move_face(Face{first, G.V3{zero(), zero(), up}, ref, List.reverse(&2, T.Coedge, uses_rev(points, n, 0, True{}, Nil{}))}, rotation, far)
  +sides = List.reverse(&2, Face, sides_rev(points, first, s, n, 0, rotation, origin, Nil{}))
  +low_rev = moved_rev(points, rotation, origin, Nil{})
  +low = List.reverse(&2, G.Vec3, low_rev)
  +high = List.reverse(&2, G.Vec3, moved_rev(points, rotation, far, Nil{}))
  +limit = R.mul(I.angular_guard(), points_scale(high, points_scale(low, one())))
  caps = R.max(cap_residual(bottom, low), cap_residual(lid, high))
  +required = R.max(caps, sides_residual(sides, low, high, head_or(low, first), head_or(high, first), zero()))
  edges = List.reverse(&2, T.Edge, vertical_rev(points, n, 0, ring_rev(points, n, n, 0, ring_rev(points, n, 0, 0, Nil{}))))
  solid = {Solid{List.reverse.go(&2, G.Vec3, low_rev, high), edges, bottom <> lid <> sides} : Solid}
  Bool.pick(Outcome, I.at_most(required, limit), Built{solid, required, limit}, Refused{IncidenceAudit{required, limit}})

def oriented(valid: Bool, +count: U32, +points: List<&2, G.Vec3>, +first: G.Vec3, +rotation: G.Rotation, +origin: G.Vec3, +far: G.Vec3, +s: G.Vec3) -> Outcome:
  match valid:
    case False{}:
      Refused{ProfileOrientation{}}
    case True{}:
      construct(count, points, first, rotation, origin, far, s)

def swept(flat: Bool, edges_check: Check, +orientation: R.Real, +count: U32, +points: List<&2, G.Vec3>, +first: G.Vec3, +rotation: G.Rotation, +origin: G.Vec3, +far: G.Vec3, +s: G.Vec3) -> Outcome:
  match flat:
    case True{}:
      Refused{DegenerateSweep{}}
    case False{}:
      match edges_check:
        case Failed{reason}:
          Refused{reason}
        case Passed{}:
          oriented(R.less(zero(), orientation), count, points, first, rotation, origin, far, s)

def framed(valid: Bool, +count: U32, +points: List<&2, G.Vec3>, +origin: G.Vec3, +n: G.Vec3, +u: G.Vec3, +far: G.Vec3) -> Outcome:
  match valid:
    case False{}:
      Refused{InvalidFrame{}}
    case True{}:
      +delta = G.sub(far, origin)
      +v = G.cross(n, u)
      +s = {G.V3{G.dot(delta, u), G.dot(delta, v), G.dot(delta, n)} : G.Vec3}
      +scale = R.max(one(), R.add(I.magnitude(origin), R.add(points_scale(points, zero()), I.magnitude(s))))
      +resolution = R.mul(I.angular_guard(), scale)
      +first = head_or(points, G.V3{zero(), zero(), zero()})
      flat = I.at_most(R.abs(sweep_depth(s)), resolution)
      orientation = R.mul(area2(points, first, zero()), sweep_depth(s))
      swept(flat, check_edges(points, first, resolution, 0, Passed{}), orientation, count, points, first, G.Rotation{u, v, n}, origin, far, s)

def sized(few: Bool, valid: Bool, points_check: Check, +count: U32, +points: List<&2, G.Vec3>, +origin: G.Vec3, +normal: G.Vec3, +x: G.Vec3, +far: G.Vec3) -> Outcome:
  match few:
    case True{}:
      Refused{TooFewVertices{}}
    case False{}:
      match valid:
        case False{}:
          Refused{InvalidInput{}}
        case True{}:
          match points_check:
            case Failed{reason}:
              Refused{reason}
            case Passed{}:
              +n = G.normalize(normal)
              +u = G.normalize(x)
              framed(frame_valid(n, u), count, points, origin, n, u, far)

# points: the profile in sketch coordinates (z word exactly 0), counterclockwise
# along the sweep. origin: the world origin of the near cap (the sketch plane
# origin moved by the extrude start offset). normal/x: the sketch plane
# directions. far: the world origin of the far cap, origin + the world sweep;
# the sweep must cross the plane, it need not be normal to it. The host takes
# both sums in binary64 and splits each result once (src/kernel.mjs
# prismInputs).
def extrude(+points: List<&2, G.Vec3>, +origin: G.Vec3, +normal: G.Vec3, +x: G.Vec3, +far: G.Vec3) -> Outcome:
  +count = size(points, 0)
  words = Bool.and(Bool.and(I.vec_valid(origin), I.vec_valid(far)), Bool.and(I.vec_valid(normal), I.vec_valid(x)))
  directions = Bool.and(I.direction_valid(normal), I.direction_valid(x))
  sized(U32.is_lt(count, 3), Bool.and(words, directions), check_points(points, 0, Passed{}), count, points, origin, normal, x, far)
