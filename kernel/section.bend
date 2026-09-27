import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./topology.bend as T
import ./intersections.bend as I
import ./curve-plane.bend as C
import ./edge-plane.bend as E
import ./face-classification.bend as F
import ./face-plane.bend as P
import ./solid-classification.bend as S
import ./boundary.bend as B

# Complete directed solid/plane contours. A root is a source edge and its
# original native hit parameter, never a nearby coordinate. Every finite-face
# result is retained, including Empty and failures. This constructs wires only.
type Root is Data:
  SourceRoot{edge: U32, hit: E.EdgeHit, source: E.EdgeSource}
  SyntheticSeam{face: U32, section: U32, parameter: R.Real, point: G.Vec3}

type Association is Data:
  BoundaryAssociation{original: P.BoundaryEvent, checked: P.BoundaryEvent, margin: R.Real}
  SeamAssociation{parameter: R.Real, point: G.Vec3}

type EndpointRef is Data:
  EndpointRef{root: U32, association: Association}

type Family is Data:
  PlaneLine{}
  CylinderGenerator{}
  CylinderCircle{}
  CylinderEllipse{}

type Orientation is Data:
  Orientation{family: Family, parameter: R.Real, outward_normal: G.Vec3, tangent: G.Vec3, positive_tangent: G.Vec3, alignment: R.Real, parallel_error: R.Real, angular_margin: R.Real, forward: Bool}

type Piece is Data:
  Piece{face: P.FaceSource, section_index: U32, section: P.Section, first: EndpointRef, last: EndpointRef, orientation: Orientation}

type FaceRecord is Data:
  FaceRecord{index: U32, result: P.FacePlaneResult}

type Failure is Data:
  InvalidInput{}
  EmptySource{}
  InvalidVertex{vertex: U32}
  SourceNotClosed{edge: U32, forward: U32, backward: U32}
  FaceRejected{face: U32, reason: P.Rejection}
  FaceUnresolved{face: U32, reason: P.Issue}
  FaceContact{face: U32, reason: P.Contact}
  InvalidSection{face: U32, section: U32}
  AmbiguousOrientation{face: U32, section: U32}
  EndpointMismatch{face: U32, section: U32, first: Bool}
  RootPointMismatch{face: U32, section: U32, first: Bool, root: U32}
  RootIncidence{root: U32, forward: U32, backward: U32}
  StitchFailure{reason: B.Reason}

type SectionResult is Data:
  Resolved{relation: P.Relation, roots: List<&2, Root>, edges: List<&2, A.Edge>, pieces: List<&2, Piece>, contours: List<&2, B.Ring>, faces: List<&2, FaceRecord>, tolerance: I.Tolerance}
  Failed{reason: Failure, faces: List<&2, FaceRecord>}

type RootLookup is Data:
  MissingRoot{}
  FoundRoot{index: U32}
  ConflictingRoot{index: U32}

type EndpointResolution is Data:
  EndpointResolved{reference: EndpointRef, roots: List<&2, Root>}
  EndpointFailed{reason: Failure}

type PairResolution is Data:
  PairResolved{first: EndpointRef, last: EndpointRef, roots: List<&2, Root>}
  PairFailed{reason: Failure}

type Construction is Data:
  Built{roots: List<&2, Root>, pieces: List<&2, Piece>}
  BuildFailed{reason: Failure}

def zero() -> R.Real:
  R.from_f32(0.0)

# Word identity is deliberately stronger than a proximity predicate. Signed
# zeros also retain their original words; no canonicalization happens here.
def same_real(a: R.Real, b: R.Real) -> Bool:
  R.Real{ah, al} = a
  R.Real{bh, bl} = b
  Bool.and(U32.is_eq(F32.bits(ah), F32.bits(bh)), U32.is_eq(F32.bits(al), F32.bits(bl)))

def same_point(a: G.Vec3, b: G.Vec3) -> Bool:
  G.V3{ax, ay, az} = a
  G.V3{bx, by, bz} = b
  Bool.and(same_real(ax, bx), Bool.and(same_real(ay, by), same_real(az, bz)))

def hit_parameter(hit: E.EdgeHit) -> R.Real:
  E.Hit{parameter, _, _, _} = hit
  parameter

def hit_point(hit: E.EdgeHit) -> G.Vec3:
  E.Hit{_, point, _, _} = hit
  point

def root_match(key_equal: Bool, +point_equal: Bool, +index: U32, rest: RootLookup) -> RootLookup:
  Bool.pick(RootLookup, key_equal, Bool.pick(RootLookup, point_equal, FoundRoot{index}, ConflictingRoot{index}), rest)

def find_root(roots: List<&2, Root>, +edge: U32, +hit: E.EdgeHit, +index: U32) -> RootLookup:
  match roots:
    case Nil{}:
      MissingRoot{}
    case SourceRoot{source_edge, +source_hit, _} <> tail:
      same_key = Bool.and(U32.is_eq(edge, source_edge), same_real(hit_parameter(hit), hit_parameter(source_hit)))
      root_match(same_key, same_point(hit_point(hit), hit_point(source_hit)), index, find_root(tail, edge, hit, (index + 1 : U32)))
    case SyntheticSeam{_, _, _, _} <> tail:
      find_root(tail, edge, hit, (index + 1 : U32))

def root_reference(found: RootLookup, +roots: List<&2, Root>, edge: U32, hit: E.EdgeHit, source: E.EdgeSource, association: Association, face: U32, section: U32, first: Bool) -> EndpointResolution:
  match found:
    case ConflictingRoot{root}:
      EndpointFailed{RootPointMismatch{face, section, first, root}}
    case FoundRoot{index}:
      EndpointResolved{EndpointRef{index, association}, roots}
    case MissingRoot{}:
      index = U32.from_nat(List.length(&2, Root, roots))
      EndpointResolved{EndpointRef{index, association}, List.append(&2, Root, roots, [SourceRoot{edge, hit, source}])}

def mapped_endpoint(mapping: P.Mapping, +original: P.BoundaryEvent, margin: R.Real, +roots: List<&2, Root>, face: U32, section: U32, first: Bool) -> EndpointResolution:
  match mapping:
    case P.Mapped{checked}:
      P.BoundaryEvent{+edge, _, +source, +hit, _, _, _, _, _} = original
      association : Association = BoundaryAssociation{original, checked, margin}
      root_reference(find_root(roots, edge, hit, 0), roots, edge, hit, source, association, face, section, first)
    case _:
      EndpointFailed{EndpointMismatch{face, section, first}}

# Reuse the existing checked support/edge-hit association at the actual
# section endpoint. In particular, a lifted wrap end is not replaced by its
# canonical event point. The final face resolution bounds both resolution
# terms used by face-plane, so 2*resolution bounds their sum.
def boundary_endpoint(+event: P.BoundaryEvent, parameter: R.Real, point: G.Vec3, curve: A.Curve, +margin: R.Real, roots: List<&2, Root>, face: U32, section: U32, first: Bool) -> EndpointResolution:
  P.BoundaryEvent{edge, forward, source, hit, support, _, _, _, _} = event
  mapping = P.mapping_point(parameter, point, edge, forward, source, hit, support, curve, margin)
  mapped_endpoint(mapping, event, margin, roots, face, section, first)

def last_endpoint(result: EndpointResolution, first: EndpointRef) -> PairResolution:
  match result:
    case EndpointFailed{reason}:
      PairFailed{reason}
    case EndpointResolved{last, roots}:
      PairResolved{first, last, roots}

def first_endpoint(result: EndpointResolution, event: P.BoundaryEvent, parameter: R.Real, point: G.Vec3, curve: A.Curve, margin: R.Real, face: U32, section: U32) -> PairResolution:
  match result:
    case EndpointFailed{reason}:
      PairFailed{reason}
    case EndpointResolved{first, roots}:
      last_endpoint(boundary_endpoint(event, parameter, point, curve, margin, roots, face, section, False{}), first)

def seam_pair(valid: Bool, +roots: List<&2, Root>, +face: U32, +section: U32, +parameter: R.Real, +point: G.Vec3) -> PairResolution:
  match valid:
    case False{}:
      PairFailed{InvalidSection{face, section}}
    case True{}:
      +index = U32.from_nat(List.length(&2, Root, roots))
      +reference : EndpointRef = EndpointRef{index, SeamAssociation{parameter, point}}
      PairResolved{reference, reference, List.append(&2, Root, roots, [SyntheticSeam{face, section, parameter, point}])}

def periodic(curve: A.Curve) -> Bool:
  match curve:
    case A.Line{_, _}:
      False{}
    case _:
      True{}

def interval_pair(valid: Bool, a: P.BoundaryEvent, ap: R.Real, at: G.Vec3, b: P.BoundaryEvent, bp: R.Real, bt: G.Vec3, +curve: A.Curve, +margin: R.Real, roots: List<&2, Root>, +face: U32, +section: U32) -> PairResolution:
  match valid:
    case False{}:
      PairFailed{InvalidSection{face, section}}
    case True{}:
      first_endpoint(boundary_endpoint(a, ap, at, curve, margin, roots, face, section, True{}), b, bp, bt, curve, margin, face, section)

def endpoint_pair(piece: P.Section, roots: List<&2, Root>, margin: R.Real, face: U32, section: U32) -> PairResolution:
  P.Section{_, +curve, domain, first, last} = piece
  match domain first last:
    case C.Interval{+lo, +hi} P.Boundary{a, +ap, at} P.Boundary{b, +bp, bt}:
      valid = Bool.and(R.less(lo, hi), Bool.and(same_real(lo, ap), same_real(hi, bp)))
      interval_pair(valid, a, ap, at, b, bp, bt, curve, margin, roots, face, section)
    case C.Untrimmed{} P.PeriodicSeam{+ap, +at} P.PeriodicSeam{bp, bt}:
      valid = Bool.and(periodic(curve), Bool.and(same_real(ap, bp), same_point(at, bt)))
      seam_pair(valid, roots, face, section, ap, at)
    case _ _ _:
      PairFailed{InvalidSection{face, section}}

def orientation_family(surface: A.Surface, curve: A.Curve) -> Maybe<&2, Family>:
  match surface curve:
    case A.Plane{_, _, _} A.Line{_, _}:
      Some{PlaneLine{}}
    case A.Cylinder{_, _, _, _} A.Line{_, _}:
      Some{CylinderGenerator{}}
    case A.Cylinder{_, _, _, _} A.Circle{_, _, _, _}:
      Some{CylinderCircle{}}
    case A.Cylinder{_, _, _, _} A.Ellipse{_, _, _, _, _}:
      Some{CylinderEllipse{}}
    case _ _:
      None{}

def normalized(valid: Bool, vector: G.Vec3) -> Maybe<&2, G.Vec3>:
  Bool.pick(Maybe<&2, G.Vec3>, valid, Some{G.normalize(vector)}, None{})

def normal_vector(surface: A.Surface, point: G.Vec3) -> Maybe<&2, G.Vec3>:
  match surface:
    case A.Plane{_, +normal, _}:
      normalized(Bool.and(I.vec_valid(normal), I.direction_valid(normal)), normal)
    case A.Cylinder{origin, axis, _, _}:
      +unit = G.normalize(axis)
      +delta = G.sub(point, origin)
      +radial = G.sub(delta, G.scale(unit, G.dot(delta, unit)))
      normalized(Bool.and(I.vec_valid(radial), I.direction_valid(radial)), radial)
    case _:
      None{}

def orientation_checked(valid: Bool, orientation: Orientation) -> Maybe<&2, Orientation>:
  Bool.pick(Maybe<&2, Orientation>, valid, Some{orientation}, None{})

def orientation_unit(family: Family, parameter: R.Real, outward: G.Vec3, +tangent: G.Vec3, +positive: G.Vec3, +margin: R.Real) -> Maybe<&2, Orientation>:
  +alignment = G.dot(tangent, positive)
  +error = I.length(G.cross(tangent, positive))
  valid = Bool.and(Bool.and(I.scalar_valid(alignment), I.scalar_valid(error)), Bool.and(R.less(margin, R.abs(alignment)), I.at_most(error, margin)))
  orientation : Orientation = Orientation{family, parameter, outward, tangent, positive, alignment, error, margin, R.less(zero(), alignment)}
  orientation_checked(valid, orientation)

def orientation_regular(valid: Bool, family: Family, parameter: R.Real, outward: G.Vec3, tangent: G.Vec3, positive: G.Vec3, margin: R.Real) -> Maybe<&2, Orientation>:
  match valid:
    case False{}:
      None{}
    case True{}:
      orientation_unit(family, parameter, outward, G.normalize(tangent), G.normalize(positive), margin)

def orientation_normal(normal: Maybe<&2, G.Vec3>, family: Family, +parameter: R.Real, curve: A.Curve, cutter: G.Vec3, same_sense: Bool, +margin: R.Real) -> Maybe<&2, Orientation>:
  match normal:
    case None{}:
      None{}
    case Some{+vector}:
      +outward = Bool.pick(G.Vec3, same_sense, vector, G.scale(vector, R.from_f32(F32.neg(1.0))))
      +positive = G.cross(G.normalize(cutter), outward)
      +tangent = A.curve_tangent(curve, parameter)
      valid = Bool.and(Bool.and(I.vec_valid(tangent), I.direction_valid(tangent)), Bool.and(I.vec_valid(positive), R.less(margin, I.length(positive))))
      orientation_regular(valid, family, parameter, outward, tangent, positive, margin)

def orientation_sample(family: Maybe<&2, Family>, +surface: A.Surface, sense: Bool, +curve: A.Curve, +parameter: R.Real, cutter: G.Vec3, margin: R.Real) -> Maybe<&2, Orientation>:
  match family:
    case None{}:
      None{}
    case Some{family}:
      orientation_normal(normal_vector(surface, A.curve_point(curve, parameter)), family, parameter, curve, cutter, sense, margin)

# For these validated supports, native tangent and cross(cutter,outward) are
# continuous, nonzero, parallel fields on the whole connected support. Their
# relative sign is constant. A midpoint determines that sign; the residual is
# an arithmetic/conditioning guard, not a sample-based proof for other curves.
def sample_parameter(domain: C.Domain) -> R.Real:
  match domain:
    case C.Interval{first, last}:
      R.mul(R.add(first, last), R.from_f32(0.5))
    case C.Untrimmed{}:
      zero()

def orient(piece: P.Section, source: P.FaceSource, tolerance: I.Tolerance) -> Maybe<&2, Orientation>:
  P.Section{_, +curve, domain, _, _} = piece
  P.FaceSource{_, A.Face{+surface, sense, _}, _, cutter, _} = source
  orientation_sample(orientation_family(surface, curve), surface, sense, curve, sample_parameter(domain), cutter, I.tolerance_angular(tolerance))

def append_piece(pair: PairResolution, source: P.FaceSource, index: U32, section: P.Section, orientation: Orientation, pieces: List<&2, Piece>) -> Construction:
  match pair:
    case PairFailed{reason}:
      BuildFailed{reason}
    case PairResolved{first, last, roots}:
      piece : Piece = Piece{source, index, section, first, last, orientation}
      Built{roots, List.append(&2, Piece, pieces, [piece])}

def oriented(orientation: Maybe<&2, Orientation>, +section: P.Section, +source: P.FaceSource, +index: U32, roots: List<&2, Root>, pieces: List<&2, Piece>, margin: R.Real) -> Construction:
  match orientation:
    case None{}:
      BuildFailed{AmbiguousOrientation{P.source_index(source), index}}
    case Some{orientation}:
      append_piece(endpoint_pair(section, roots, margin, P.source_index(source), index), source, index, section, orientation, pieces)

def build_piece(state: Construction, +section: P.Section, +source: P.FaceSource, index: U32, +tolerance: I.Tolerance, resolution: R.Real) -> Construction:
  match state:
    case BuildFailed{reason}:
      BuildFailed{reason}
    case Built{roots, pieces}:
      margin = R.add(R.add(P.source_budget(source), I.tolerance_linear(tolerance)), R.mul(R.from_f32(2.0), resolution))
      oriented(orient(section, source, tolerance), section, source, index, roots, pieces, margin)

def build_sections(sections: List<&2, P.Section>, +source: P.FaceSource, +index: U32, +tolerance: I.Tolerance, +resolution: R.Real, state: Construction) -> Construction:
  match sections:
    case Nil{}:
      state
    case section <> tail:
      build_sections(tail, source, (index + 1 : U32), tolerance, resolution, build_piece(state, section, source, index, tolerance, resolution))

def build_faces(faces: List<&2, FaceRecord>, +tolerance: I.Tolerance, state: Construction) -> Construction:
  match faces:
    case Nil{}:
      state
    case FaceRecord{_, P.Resolved{_, sections, _, _, source, resolution}} <> tail:
      build_faces(tail, tolerance, build_sections(sections, source, 0, tolerance, resolution, state))
    case _ <> _:
      BuildFailed{InvalidInput{}}

def piece_edges(pieces: List<&2, Piece>) -> List<&2, A.Edge>:
  match pieces:
    case Nil{}:
      Nil{}
    case Piece{_, _, P.Section{_, curve, _, _, _}, EndpointRef{first, _}, EndpointRef{last, _}, _} <> tail:
      A.Edge{first, last, curve, True{}} <> piece_edges(tail)

def piece_uses(pieces: List<&2, Piece>, +index: U32) -> List<&2, T.Coedge>:
  match pieces:
    case Nil{}:
      Nil{}
    case Piece{_, _, _, _, _, Orientation{_, _, _, _, _, _, _, _, forward}} <> tail:
      T.Use{index, forward} <> piece_uses(tail, (index + 1 : U32))

def endpoint_incidence(reference: EndpointRef, root: U32) -> S.UseCount:
  EndpointRef{index, association} = reference
  match association:
    case BoundaryAssociation{P.BoundaryEvent{_, +forward, _, _, _, _, _, _, _}, _, _}:
      +same = U32.is_eq(index, root)
      S.UseCount{Bool.pick(U32, Bool.and(same, forward), 1, 0), Bool.pick(U32, Bool.and(same, Bool.not(forward)), 1, 0)}
    case _:
      S.UseCount{0, 0}

def root_incidence(pieces: List<&2, Piece>, +root: U32) -> S.UseCount:
  match pieces:
    case Nil{}:
      S.UseCount{0, 0}
    case Piece{_, _, _, first, last, _} <> tail:
      S.plus_uses(S.plus_uses(endpoint_incidence(first, root), endpoint_incidence(last, root)), root_incidence(tail, root))

def checked_incidence(+count: S.UseCount, root: U32, rest: Maybe<&2, Failure>) -> Maybe<&2, Failure>:
  S.UseCount{forward, backward} = count
  Bool.pick(Maybe<&2, Failure>, S.pair_valid(count), rest, Some{RootIncidence{root, forward, backward}})

def check_roots(roots: List<&2, Root>, +pieces: List<&2, Piece>, +index: U32) -> Maybe<&2, Failure>:
  match roots:
    case Nil{}:
      None{}
    case SourceRoot{_, _, _} <> tail:
      checked_incidence(root_incidence(pieces, index), index, check_roots(tail, pieces, (index + 1 : U32)))
    case SyntheticSeam{_, _, _, _} <> tail:
      check_roots(tail, pieces, (index + 1 : U32))

def section_relation(pieces: List<&2, Piece>) -> P.Relation:
  match pieces:
    case Nil{}:
      P.Empty{}
    case _:
      P.Transverse{}

def stitched(result: B.StitchResult, roots: List<&2, Root>, edges: List<&2, A.Edge>, +pieces: List<&2, Piece>, faces: List<&2, FaceRecord>, tolerance: I.Tolerance) -> SectionResult:
  match result:
    case B.Rejected{reason}:
      Failed{StitchFailure{reason}, faces}
    case B.Stitched{contours}:
      Resolved{section_relation(pieces), roots, edges, pieces, contours, faces, tolerance}

def roots_checked(issue: Maybe<&2, Failure>, +roots: List<&2, Root>, +pieces: List<&2, Piece>, faces: List<&2, FaceRecord>, tolerance: I.Tolerance) -> SectionResult:
  match issue:
    case Some{reason}:
      Failed{reason, faces}
    case None{}:
      +edges = piece_edges(pieces)
      stitched(B.stitch(edges, U32.from_nat(List.length(&2, Root, roots)), piece_uses(pieces, 0)), roots, edges, pieces, faces, tolerance)

def finish_construction(state: Construction, faces: List<&2, FaceRecord>, tolerance: I.Tolerance) -> SectionResult:
  match state:
    case BuildFailed{reason}:
      Failed{reason, faces}
    case Built{+roots, +pieces}:
      roots_checked(check_roots(roots, pieces, 0), roots, pieces, faces, tolerance)

def face_failure(faces: List<&2, FaceRecord>) -> Maybe<&2, Failure>:
  match faces:
    case Nil{}:
      None{}
    case FaceRecord{index, result} <> tail:
      match result:
        case P.Rejected{reason}:
          Some{FaceRejected{index, reason}}
        case P.Unresolved{reason}:
          Some{FaceUnresolved{index, reason}}
        case P.NonTransverse{reason, _, _}:
          Some{FaceContact{index, reason}}
        case P.Resolved{_, _, _, _, _, _}:
          face_failure(tail)

def faces_checked(issue: Maybe<&2, Failure>, +faces: List<&2, FaceRecord>, +tolerance: I.Tolerance) -> SectionResult:
  match issue:
    case Some{reason}:
      Failed{reason, faces}
    case None{}:
      finish_construction(build_faces(faces, tolerance, Built{Nil{}, Nil{}}), faces, tolerance)

def collect_faces(faces: List<&2, A.Face>, +solid: A.Solid, +index: U32, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +budget: R.Real) -> List<&2, FaceRecord>:
  match faces:
    case Nil{}:
      Nil{}
    case _ <> tail:
      FaceRecord{index, P.intersect(solid, index, domains, origin, normal, tolerance, budget)} <>
        collect_faces(tail, solid, (index + 1 : U32), domains, origin, normal, tolerance, budget)

def collected(+faces: List<&2, FaceRecord>, tolerance: I.Tolerance) -> SectionResult:
  faces_checked(face_failure(faces), faces, tolerance)

def closed_count(+count: S.UseCount, edge: U32, rest: Maybe<&2, Failure>) -> Maybe<&2, Failure>:
  S.UseCount{forward, backward} = count
  Bool.pick(Maybe<&2, Failure>, S.pair_valid(count), rest, Some{SourceNotClosed{edge, forward, backward}})

def closed_list(counts: List<&2, S.UseCount>, +index: U32) -> Maybe<&2, Failure>:
  match counts:
    case Nil{}:
      None{}
    case count <> tail:
      closed_count(count, index, closed_list(tail, (index + 1 : U32)))

# The first edge without exactly one forward and one backward use. Counts come
# from one pass over the uses (S.edge_counts), not a count_faces scan per edge.
def closed_edges(edges: List<&2, A.Edge>, faces: List<&2, A.Face>, +index: U32) -> Maybe<&2, Failure>:
  closed_list(S.edge_counts(faces, index, U32.from_nat(List.length(&2, A.Edge, edges))), index)

def valid_vertices(vertices: List<&2, G.Vec3>, +index: U32, rest: Maybe<&2, Failure>) -> Maybe<&2, Failure>:
  match vertices:
    case Nil{}:
      rest
    case point <> tail:
      Bool.pick(Maybe<&2, Failure>, I.vec_valid(point), valid_vertices(tail, (index + 1 : U32), rest), Some{InvalidVertex{index}})

def source_checked(issue: Maybe<&2, Failure>, +solid: A.Solid, domains: List<&2, F.DomainChoice>, origin: G.Vec3, normal: G.Vec3, +tolerance: I.Tolerance, budget: R.Real) -> SectionResult:
  match issue:
    case Some{reason}:
      Failed{reason, Nil{}}
    case None{}:
      A.Solid{_, _, faces} = solid
      collected(collect_faces(faces, solid, 0, domains, origin, normal, tolerance, budget), tolerance)

def nonempty_source(valid: Bool, +solid: A.Solid, domains: List<&2, F.DomainChoice>, origin: G.Vec3, normal: G.Vec3, tolerance: I.Tolerance, budget: R.Real) -> SectionResult:
  match valid:
    case False{}:
      Failed{EmptySource{}, Nil{}}
    case True{}:
      A.Solid{vertices, edges, faces} = solid
      source_checked(valid_vertices(vertices, 0, closed_edges(edges, faces, 0)), solid, domains, origin, normal, tolerance, budget)

def input_checked(valid: Bool, +solid: A.Solid, domains: List<&2, F.DomainChoice>, origin: G.Vec3, normal: G.Vec3, tolerance: I.Tolerance, budget: R.Real) -> SectionResult:
  match valid:
    case False{}:
      Failed{InvalidInput{}, Nil{}}
    case True{}:
      nonempty_source(S.nonempty(solid), solid, domains, origin, normal, tolerance, budget)

def section(solid: A.Solid, domains: List<&2, F.DomainChoice>, +plane_origin: G.Vec3, +plane_normal: G.Vec3, +tolerance: I.Tolerance, +source_budget: R.Real) -> SectionResult:
  geometry = Bool.and(I.vec_valid(plane_origin), Bool.and(I.vec_valid(plane_normal), I.direction_valid(plane_normal)))
  budgets = Bool.and(F.valid_budget(source_budget), Bool.and(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance))))
  input_checked(Bool.and(geometry, budgets), solid, domains, plane_origin, plane_normal, tolerance, source_budget)
