import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./topology.bend as T
import ./intersections.bend as I
import ./ray.bend as Y
import ./face-classification.bend as F
import ./cylinder-classification.bend as C
import ./lib/id-vec.bend as V

# Even/odd membership of a closed, embedded boundary. Actual trimmed faces are
# tested at every crossing; supporting surfaces alone never count as a solid.
# Geometrically valid nonintersecting face arrangements remain a precondition.
type Reason is Data:
  InvalidInput{}
  InvalidTopology{}
  UnsupportedSurface{face: U32}
  FaceUnresolved{face: U32}
  AmbiguousRays{}
  ConflictingRays{}

type Classification is Data:
  Inside{rays: U32}
  Outside{rays: U32}
  Boundary{face: U32}
  Unresolved{reason: Reason}

type Membership is Data:
  FaceInside{}
  FaceOutside{}
  FaceBoundary{}
  FaceUnknown{}

type UseCount is Data:
  UseCount{forward: U32, backward: U32}

type LineCount is Data:
  LineCount{valid: Bool, forward: U32, backward: U32}

type Vote is Data:
  Vote{valid: Bool, inside: Bool}

type Votes is Data:
  Votes{count: U32, inside: Bool, conflict: Bool}

def zero() -> R.Real:
  R.from_f32(0.0)

def plus_uses(a: UseCount, b: UseCount) -> UseCount:
  UseCount{af, ab} = a
  UseCount{bf, bb} = b
  UseCount{(af + bf : U32), (ab + bb : U32)}

def count_uses(uses: List<&2, T.Coedge>, +index: U32) -> UseCount:
  match uses:
    case Nil{}:
      UseCount{0, 0}
    case T.Use{edge, +forward} <> tail:
      +found = U32.is_eq(edge, index)
      here = {UseCount{Bool.pick(U32, Bool.and(found, forward), 1, 0), Bool.pick(U32, Bool.and(found, Bool.not(forward)), 1, 0)} : UseCount}
      plus_uses(here, count_uses(tail, index))

def count_loops(loops: List<&2, A.Loop>, +index: U32) -> UseCount:
  match loops:
    case Nil{}:
      UseCount{0, 0}
    case A.Loop{_, uses} <> tail:
      plus_uses(count_uses(uses, index), count_loops(tail, index))

def count_faces(faces: List<&2, A.Face>, +index: U32) -> UseCount:
  match faces:
    case Nil{}:
      UseCount{0, 0}
    case A.Face{_, _, loops} <> tail:
      plus_uses(count_loops(loops, index), count_faces(tail, index))

def pair_valid(count: UseCount) -> Bool:
  UseCount{forward, backward} = count
  Bool.and(U32.is_eq(forward, 1), U32.is_eq(backward, 1))

# Per-edge use counts in one pass over all uses (docs/collections.md). Slot k
# of the table counts edge id index + k (U32, wrapping, as the per-edge scan
# steps its index), so slot = edge - index; uses of ids outside the n slots
# change nothing (V.set refuses them). The sums are the same U32 sums
# count_faces forms per edge, in a different (commutative) order.
def vec_of(r: V.IdVec<UseCount> & Bool) -> V.IdVec<UseCount>:
  (v, _) = r
  v

def add_use(r: V.IdVec<UseCount> & UseCount, slot: U32, +forward: Bool) -> V.IdVec<UseCount>:
  (v, prior) = r
  vec_of(V.set(UseCount, v, slot, plus_uses(prior, UseCount{Bool.pick(U32, forward, 1, 0), Bool.pick(U32, forward, 0, 1)})))

def table_uses(uses: List<&2, T.Coedge>, +index: U32, v: V.IdVec<UseCount>) -> V.IdVec<UseCount>:
  match uses:
    case Nil{}:
      v
    case T.Use{edge, forward} <> tail:
      +slot = (edge - index : U32)
      table_uses(tail, index, add_use(V.get(UseCount, v, slot, UseCount{0, 0}), slot, forward))

def table_loops(loops: List<&2, A.Loop>, +index: U32, v: V.IdVec<UseCount>) -> V.IdVec<UseCount>:
  match loops:
    case Nil{}:
      v
    case A.Loop{_, uses} <> tail:
      table_loops(tail, index, table_uses(uses, index, v))

def table_faces(faces: List<&2, A.Face>, +index: U32, v: V.IdVec<UseCount>) -> V.IdVec<UseCount>:
  match faces:
    case Nil{}:
      v
    case A.Face{_, _, loops} <> tail:
      table_faces(tail, index, table_loops(loops, index, v))

def counts_of(r: V.IdVec<UseCount> & List<&2, UseCount>) -> List<&2, UseCount>:
  (_, counts) = r
  counts

# [count_faces(faces, index + k) for k in 0 .. n-1], in O(uses + n).
def edge_counts(faces: List<&2, A.Face>, index: U32, n: U32) -> List<&2, UseCount>:
  counts_of(V.to_list(UseCount, table_faces(faces, index, vec_of(V.filled(UseCount, n, UseCount{0, 0})))))

def all_pairs(counts: List<&2, UseCount>) -> Bool:
  match counts:
    case Nil{}:
      True{}
    case head <> tail:
      Bool.and(pair_valid(head), all_pairs(tail))

# Every edge id index .. index + |edges| - 1 has exactly one forward and one
# backward use. Same answer as the former per-edge count_faces scan.
def edges_closed(edges: List<&2, A.Edge>, faces: List<&2, A.Face>, index: U32) -> Bool:
  all_pairs(edge_counts(faces, index, U32.from_nat(List.length(&2, A.Edge, edges))))

def nonempty(solid: A.Solid) -> Bool:
  A.Solid{vertices, edges, faces} = solid
  match vertices edges faces:
    case Con{_, _} Con{_, _} Con{_, _}:
      True{}
    case _ _ _:
      False{}

def supported(surface: A.Surface) -> Bool:
  match surface:
    case A.Plane{_, _, _}:
      True{}
    case A.Cylinder{_, _, _, _}:
      True{}
    case _:
      False{}

# All faces are visited even if an earlier one contains the query. A malformed
# later face cannot hide behind a superficially successful Boundary result.
def boundary_join(a: Classification, b: Classification) -> Classification:
  match a b:
    case Unresolved{reason} _:
      Unresolved{reason}
    case _ Unresolved{reason}:
      Unresolved{reason}
    case Boundary{face} _:
      Boundary{face}
    case _ Boundary{face}:
      Boundary{face}
    case _ _:
      Outside{0}

def planar_membership(result: F.Classification) -> Membership:
  match result:
    case F.Inside{_}:
      FaceInside{}
    case F.Boundary{_, _}:
      FaceBoundary{}
    case F.Outside{_}:
      FaceOutside{}
    case F.Unresolved{_}:
      FaceUnknown{}

def cylinder_membership(result: C.Classification) -> Membership:
  match result:
    case C.Inside{_}:
      FaceInside{}
    case C.Boundary{_, _}:
      FaceBoundary{}
    case C.Outside{_}:
      FaceOutside{}
    case C.Unresolved{_}:
      FaceUnknown{}

def membership_face(face: Maybe<&2, A.Face>, solid: A.Solid, index: U32, domains: List<&2, F.DomainChoice>, point: G.Vec3, tolerance: I.Tolerance, source_budget: R.Real) -> Membership:
  match face:
    case Some{A.Face{A.Plane{_, _, _}, _, _}}:
      planar_membership(F.classify(solid, index, domains, point, tolerance, source_budget))
    case Some{A.Face{A.Cylinder{_, _, _, _}, _, _}}:
      cylinder_membership(C.classify(solid, index, domains, point, tolerance, source_budget))
    case _:
      FaceUnknown{}

def membership(+solid: A.Solid, +index: U32, domains: List<&2, F.DomainChoice>, point: G.Vec3, tolerance: I.Tolerance, source_budget: R.Real) -> Membership:
  A.Solid{_, _, faces} = solid
  membership_face(List.get(&2, A.Face, faces, U32.to_nat(index)), solid, index, domains, point, tolerance, source_budget)

def face_boundary(result: Membership, +index: U32) -> Classification:
  match result:
    case FaceInside{}:
      Boundary{index}
    case FaceBoundary{}:
      Boundary{index}
    case FaceOutside{}:
      Outside{0}
    case FaceUnknown{}:
      Unresolved{FaceUnresolved{index}}

def check_face(allowed: Bool, solid: A.Solid, +index: U32, domains: List<&2, F.DomainChoice>, point: G.Vec3, tolerance: I.Tolerance, source_budget: R.Real) -> Classification:
  match allowed:
    case False{}:
      Unresolved{UnsupportedSurface{index}}
    case True{}:
      face_boundary(membership(solid, index, domains, point, tolerance, source_budget), index)

def boundary_faces(faces: List<&2, A.Face>, +solid: A.Solid, +index: U32, +domains: List<&2, F.DomainChoice>, +point: G.Vec3, +tolerance: I.Tolerance, +source_budget: R.Real) -> Classification:
  match faces:
    case Nil{}:
      Outside{0}
    case A.Face{surface, _, _} <> tail:
      boundary_join(check_face(supported(surface), solid, index, domains, point, tolerance, source_budget), boundary_faces(tail, solid, (index + 1 : U32), domains, point, tolerance, source_budget))

def plus_counts(a: LineCount, b: LineCount) -> LineCount:
  LineCount{av, af, ab} = a
  LineCount{bv, bf, bb} = b
  LineCount{Bool.and(av, bv), (af + bf : U32), (ab + bb : U32)}

def count_member(result: Membership, +parameter: R.Real, margin: R.Real) -> LineCount:
  match result:
    case FaceOutside{}:
      LineCount{True{}, 0, 0}
    case FaceInside{}:
      +positive = R.less(zero(), parameter)
      LineCount{R.less(margin, R.abs(parameter)), Bool.pick(U32, positive, 1, 0), Bool.pick(U32, positive, 0, 1)}
    case _:
      LineCount{False{}, 0, 0}

def count_roots(roots: List<&2, R.Real>, +solid: A.Solid, +index: U32, +domains: List<&2, F.DomainChoice>, +point: G.Vec3, +direction: G.Vec3, +tolerance: I.Tolerance, +source_budget: R.Real, +margin: R.Real) -> LineCount:
  match roots:
    case Nil{}:
      LineCount{True{}, 0, 0}
    case +parameter <> tail:
      hit = Y.point(point, direction, parameter)
      result = membership(solid, index, domains, hit, tolerance, source_budget)
      plus_counts(count_member(result, parameter, margin), count_roots(tail, solid, index, domains, point, direction, tolerance, source_budget, margin))

def count_surface(result: Y.Roots, solid: A.Solid, index: U32, domains: List<&2, F.DomainChoice>, point: G.Vec3, direction: G.Vec3, tolerance: I.Tolerance, source_budget: R.Real, margin: R.Real) -> LineCount:
  Y.Roots{kind, roots} = result
  match kind:
    case 0:
      LineCount{True{}, 0, 0}
    case 1:
      count_roots(roots, solid, index, domains, point, direction, tolerance, source_budget, margin)
    case _:
      LineCount{False{}, 0, 0}

def line_faces(faces: List<&2, A.Face>, +solid: A.Solid, +index: U32, +domains: List<&2, F.DomainChoice>, +point: G.Vec3, +direction: G.Vec3, +tolerance: I.Tolerance, +source_budget: R.Real, +margin: R.Real) -> LineCount:
  match faces:
    case Nil{}:
      LineCount{True{}, 0, 0}
    case A.Face{surface, _, _} <> tail:
      result = Y.line_surface(point, direction, surface)
      one = count_surface(result, solid, index, domains, point, direction, tolerance, source_budget, margin)
      plus_counts(one, line_faces(tail, solid, (index + 1 : U32), domains, point, direction, tolerance, source_budget, margin))

def line_vote(count: LineCount) -> Vote:
  LineCount{valid, forward, backward} = count
  +a = U32.and(forward, 1)
  b = U32.and(backward, 1)
  Vote{Bool.and(valid, U32.is_eq(a, b)), U32.is_eq(a, 1)}

def add_vote(vote: Vote, prior: Votes) -> Votes:
  Vote{+valid, +inside} = vote
  Votes{+count, +before, conflict} = prior
  different = Bool.not(Bool.pick(Bool, before, inside, Bool.not(inside)))
  disagree = Bool.and(valid, Bool.and(Bool.not(U32.is_eq(count, 0)), different))
  Votes{(count + Bool.pick(U32, valid, 1, 0) : U32), Bool.pick(Bool, valid, inside, before), Bool.or(conflict, disagree)}

def cast_lines(directions: List<&2, G.Vec3>, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +point: G.Vec3, +tolerance: I.Tolerance, +source_budget: R.Real, +margin: R.Real) -> Votes:
  match directions:
    case Nil{}:
      Votes{0, False{}, False{}}
    case direction <> tail:
      A.Solid{_, _, faces} = solid
      vote = line_vote(line_faces(faces, solid, 0, domains, point, direction, tolerance, source_budget, margin))
      add_vote(vote, cast_lines(tail, solid, domains, point, tolerance, source_budget, margin))

def finish_votes(votes: Votes) -> Classification:
  Votes{+count, inside, conflict} = votes
  match conflict:
    case True{}:
      Unresolved{ConflictingRays{}}
    case False{}:
      Bool.pick(Classification, (count < 2 : U32), Unresolved{AmbiguousRays{}}, Bool.pick(Classification, inside, Inside{count}, Outside{count}))

def after_boundary(result: Classification, +solid: A.Solid, domains: List<&2, F.DomainChoice>, +point: G.Vec3, +tolerance: I.Tolerance, +source_budget: R.Real) -> Classification:
  match result:
    case Outside{_}:
      A.Solid{_, edges, _} = solid
      scale = F.edges_scale(edges, R.max(R.from_f32(1.0), I.magnitude(point)))
      margin = R.add(R.add(I.tolerance_linear(tolerance), source_budget), R.mul(I.angular_guard(), scale))
      directions = {[G.v3(1.0, 0.3125, 0.6875), G.v3(0.4375, 1.0, 0.8125), G.v3(0.625, 0.1875, 1.0), G.v3(1.0, F32.neg(0.5625), 0.25), G.v3(F32.neg(0.375), 1.0, 0.5625)] : List<&2, G.Vec3>}
      finish_votes(cast_lines(directions, solid, domains, point, tolerance, source_budget, margin))
    case _:
      result

def topology_checked(closed: Bool, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +point: G.Vec3, +tolerance: I.Tolerance, +source_budget: R.Real) -> Classification:
  match closed:
    case False{}:
      Unresolved{InvalidTopology{}}
    case True{}:
      A.Solid{_, _, faces} = solid
      result = boundary_faces(faces, solid, 0, domains, point, tolerance, source_budget)
      after_boundary(result, solid, domains, point, tolerance, source_budget)

def input_checked(valid: Bool, +solid: A.Solid, domains: List<&2, F.DomainChoice>, point: G.Vec3, tolerance: I.Tolerance, source_budget: R.Real) -> Classification:
  match valid:
    case False{}:
      Unresolved{InvalidInput{}}
    case True{}:
      A.Solid{_, edges, +faces} = solid
      topology_checked(Bool.and(nonempty(solid), edges_closed(edges, faces, 0)), solid, domains, point, tolerance, source_budget)

def classify(solid: A.Solid, domains: List<&2, F.DomainChoice>, +point: G.Vec3, +tolerance: I.Tolerance, +source_budget: R.Real) -> Classification:
  valid = Bool.and(I.vec_valid(point), Bool.and(I.tolerance_valid(tolerance), Bool.and(I.at_most(I.angular_guard(), I.tolerance_angular(tolerance)), F.valid_budget(source_budget))))
  input_checked(valid, solid, domains, point, tolerance, source_budget)
