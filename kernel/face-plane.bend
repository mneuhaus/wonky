import Base
import ./real.bend as R
import ./precise.bend as G
import ./analytic.bend as A
import ./intersections.bend as I
import ./curve-plane.bend as C
import ./edge-plane.bend as E
import ./face-classification.bend as F
import ./cylinder-classification.bend as K
import ./face-bounds.bend as Bounds

type FaceSource is Data:
  FaceSource{index: U32, face: A.Face, plane_origin: G.Vec3, plane_normal: G.Vec3, source_budget: R.Real}

type BoundaryEvent is Data:
  BoundaryEvent{edge: U32, forward: Bool, source: E.EdgeSource, hit: E.EdgeHit, support_index: U32, parameter: R.Real, point: G.Vec3, gap: R.Real, parameter_resolution: R.Real}

type Endpoint is Data:
  Boundary{event: BoundaryEvent, parameter: R.Real, point: G.Vec3}
  PeriodicSeam{parameter: R.Real, point: G.Vec3}

type Section is Data:
  Section{support_index: U32, curve: A.Curve, domain: C.Domain, first: Endpoint, last: Endpoint}

type Relation is Data:
  Empty{}
  Transverse{}

type Contact is Data:
  Coplanar{}
  TangentSupport{}
  BoundaryCoincidence{edge: U32}
  BoundaryTangency{edge: U32}
  VertexContact{edge: U32, location: E.Location}
  SampleBoundary{support: U32, parameter: R.Real, point: G.Vec3}

type ProbeIssue is Data:
  Planar{reason: F.Reason}
  Cylinder{reason: K.Reason}
  SampleRange{}

type Issue is Data:
  Preparation{reason: F.Reason}
  CylinderPreparation{reason: K.Reason}
  Supporting{reason: I.ResolutionIssue}
  EdgeUnresolved{edge: U32, reason: E.Issue}
  SupportMismatch{edge: U32}
  AmbiguousSupport{edge: U32}
  EventRange{edge: U32}
  CrowdedEvents{support: U32}
  OddEvents{support: U32}
  InconsistentIntervals{support: U32}
  SampleUnresolved{support: U32, parameter: R.Real, point: G.Vec3, reason: ProbeIssue}

type Rejection is Data:
  InvalidInput{}
  InvalidIndex{}
  InvalidTopology{}
  UnsupportedSurface{}
  SupportingRejected{reason: I.Rejection}
  EdgeRejected{edge: U32, reason: E.Rejection}

type FacePlaneResult is Data:
  Resolved{relation: Relation, sections: List<&2, Section>, events: List<&2, BoundaryEvent>, supports: List<&2, A.Curve>, source: FaceSource, linear_resolution: R.Real}
  NonTransverse{reason: Contact, supports: List<&2, A.Curve>, source: FaceSource}
  Unresolved{reason: Issue}
  Rejected{reason: Rejection}

type FacePreparation is Data:
  Prepared{edges: List<&2, F.PreparedEdge>, source: FaceSource, resolution: R.Real}
  PreparationUnresolved{reason: Issue}
  PreparationRejected{reason: Rejection}

type Mapping is Data:
  NoMapping{}
  Mapped{event: BoundaryEvent}
  MultipleMappings{}
  InvalidMapping{}

type EventCollection is Data:
  Events{events: List<&2, BoundaryEvent>, resolution: R.Real}
  EventContact{reason: Contact}
  EventUnresolved{reason: Issue}
  EventRejected{reason: Rejection}

type Probe is Data:
  ProbeInside{}
  ProbeOutside{}
  ProbeBoundary{}
  ProbeUnknown{reason: ProbeIssue}

type Partition is Data:
  Partition{sections: List<&2, Section>, first_inside: Bool, last_inside: Bool, count: U32}
  PartitionContact{reason: Contact}
  PartitionUnresolved{reason: Issue}

type Sections is Data:
  Sections{sections: List<&2, Section>}
  SectionContact{reason: Contact}
  SectionUnresolved{reason: Issue}

def zero() -> R.Real:
  R.from_f32(0.0)

def source_face(source: FaceSource) -> A.Face:
  FaceSource{_, face, _, _, _} = source
  face

def source_index(source: FaceSource) -> U32:
  FaceSource{index, _, _, _, _} = source
  index

def source_budget(source: FaceSource) -> R.Real:
  FaceSource{_, _, _, _, budget} = source
  budget

def source_surface(source: FaceSource) -> A.Surface:
  FaceSource{_, A.Face{surface, _, _}, _, _, _} = source
  surface

def face_geometry(face: A.Face) -> A.Surface:
  A.Face{surface, _, _} = face
  surface

def prepared_edges(edges: List<&2, F.PreparedEdge>, source: FaceSource, resolution: R.Real) -> FacePreparation:
  match edges:
    case Nil{}:
      PreparationRejected{InvalidTopology{}}
    case _:
      Prepared{edges, source, resolution}

def cylinder_edges(result: K.PhysicalEdges, source: FaceSource, resolution: R.Real) -> FacePreparation:
  match result:
    case K.PhysicalEdges{edges}:
      prepared_edges(edges, source, resolution)
    case K.BadPhysicalEdges{reason}:
      PreparationUnresolved{CylinderPreparation{reason}}

def planar_loops(valid: Bool, loops: List<&2, F.PreparedLoop>, source: FaceSource, resolution: R.Real) -> FacePreparation:
  match valid:
    case False{}:
      PreparationRejected{InvalidTopology{}}
    case True{}:
      prepared_edges(K.flatten(loops), source, resolution)

def prepared_loops(result: F.LoopPreparation, cylinder: Bool, source: FaceSource, resolution: R.Real) -> FacePreparation:
  match result cylinder:
    case F.BadLoops{reason} _:
      PreparationUnresolved{Preparation{reason}}
    case F.PreparedLoops{+loops} False{}:
      planar_loops(U32.is_eq(F.outer_count(loops), 1), loops, source, resolution)
    case F.PreparedLoops{loops} True{}:
      +edges = K.flatten(loops)
      cylinder_edges(K.physical_edges(edges, edges), source, resolution)

def prepare_surface(surface: A.Surface, loops: List<&2, A.Loop>, vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, +source: FaceSource, +resolution: R.Real) -> FacePreparation:
  match surface:
    case A.Plane{origin, normal, _}:
      budget = R.add(source_budget(source), resolution)
      result = F.prepare_loops(loops, vertices, edges, domains, origin, G.normalize(normal), budget)
      prepared_loops(result, False{}, source, resolution)
    case A.Cylinder{origin, axis, _, radius}:
      budget = R.add(source_budget(source), resolution)
      result = K.prepare_loops(loops, vertices, edges, domains, origin, G.normalize(axis), radius, budget)
      prepared_loops(result, True{}, source, resolution)
    case _:
      PreparationRejected{UnsupportedSurface{}}

# Surface frame vectors are directions, so nonunit magnitudes are allowed.
# Validate the supplied words before normalizing local copies for the existing
# frame guard; source records are retained without repairing their vectors.
def surface_frame_checked(valid: Bool, normal: G.Vec3, x: G.Vec3) -> Bool:
  match valid:
    case False{}:
      False{}
    case True{}:
      C.frame_valid(G.normalize(normal), G.normalize(x))

def surface_frame_valid(+normal: G.Vec3, +x: G.Vec3) -> Bool:
  words = Bool.and(I.vec_valid(normal), I.vec_valid(x))
  directions = Bool.and(I.direction_valid(normal), I.direction_valid(x))
  surface_frame_checked(Bool.and(words, directions), normal, x)

def surface_valid(surface: A.Surface) -> Bool:
  match surface:
    case A.Plane{origin, normal, x}:
      Bool.and(I.vec_valid(origin), surface_frame_valid(normal, x))
    case A.Cylinder{origin, axis, x, +radius}:
      Bool.and(Bool.and(I.vec_valid(origin), surface_frame_valid(axis, x)), Bool.and(I.scalar_valid(radius), R.less(zero(), radius)))
    case _:
      False{}

def surface_origin(surface: A.Surface) -> G.Vec3:
  match surface:
    case A.Plane{origin, _, _}:
      origin
    case A.Cylinder{origin, _, _, _}:
      origin
    case A.Cone{origin, _, _, _, _}:
      origin
    case A.Sphere{origin, _, _, _}:
      origin
    case A.Torus{origin, _, _, _, _}:
      origin

def surface_size(surface: A.Surface) -> R.Real:
  match surface:
    case A.Cylinder{_, _, _, radius}:
      R.max(R.from_f32(1.0), radius)
    case _:
      R.from_f32(1.0)

def surface_budget_valid(surface: A.Surface, source: R.Real, linear: R.Real, resolution: R.Real) -> Bool:
  match surface:
    case A.Cylinder{_, _, _, radius}:
      R.less(R.add(R.add(source, linear), resolution), radius)
    case _:
      True{}

def prepare_resolution(valid: Bool, surface: A.Surface, loops: List<&2, A.Loop>, vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, source: FaceSource, resolution: R.Real) -> FacePreparation:
  match valid:
    case False{}:
      PreparationUnresolved{Preparation{F.ResolutionLimit{}}}
    case True{}:
      prepare_surface(surface, loops, vertices, edges, domains, source, resolution)

def prepare_valid(valid: Bool, +face: A.Face, index: U32, vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, +plane_origin: G.Vec3, plane_normal: G.Vec3, tolerance: I.Tolerance, +budget: R.Real) -> FacePreparation:
  match valid:
    case False{}:
      PreparationRejected{InvalidInput{}}
    case True{}:
      A.Face{+surface, _, loops} = face
      scale = F.edges_scale(edges, I.input_scale(surface_origin(surface), plane_origin, surface_size(surface)))
      +resolution = R.mul(I.angular_guard(), scale)
      +linear = I.tolerance_linear(tolerance)
      enough = Bool.and(R.less(resolution, linear), surface_budget_valid(surface, budget, linear, resolution))
      source = {FaceSource{index, face, plane_origin, plane_normal, budget} : FaceSource}
      prepare_resolution(enough, surface, loops, vertices, edges, domains, source, resolution)

def curve_parameter(+curve: A.Curve, point: G.Vec3) -> R.Real:
  match curve:
    case A.Line{origin, direction}:
      F.line_parameter(origin, direction, point)
    case _:
      C.canonical(A.curve_parameter(curve, point))

def minimum_speed(curve: A.Curve) -> R.Real:
  match curve:
    case A.Line{_, direction}:
      I.length(direction)
    case A.Circle{_, _, _, radius}:
      radius
    case A.Ellipse{_, _, _, major, minor}:
      R.min(major, minor)

def mapping_checked(valid: Bool, matches: Bool, event: BoundaryEvent) -> Mapping:
  match valid matches:
    case False{} _:
      InvalidMapping{}
    case True{} False{}:
      NoMapping{}
    case True{} True{}:
      Mapped{event}

def mapping_point(+parameter: R.Real, +at: G.Vec3, edge: U32, forward: Bool, source: E.EdgeSource, +hit: E.EdgeHit, support: U32, curve: A.Curve, +margin: R.Real) -> Mapping:
  E.Hit{_, point, _, _} = hit
  +gap = F.distance(at, point)
  +parameter_resolution = R.div(R.mul(margin, R.from_f32(4.0)), minimum_speed(curve))
  valid = Bool.and(Bool.and(I.scalar_valid(parameter), I.vec_valid(at)), I.scalar_valid(parameter_resolution))
  mapping_checked(valid, I.at_most(gap, margin), BoundaryEvent{edge, forward, source, hit, support, parameter, at, gap, parameter_resolution})

def map_curve(+curve: A.Curve, edge: U32, forward: Bool, source: E.EdgeSource, +hit: E.EdgeHit, support: U32, margin: R.Real) -> Mapping:
  E.Hit{_, point, _, _} = hit
  +parameter = curve_parameter(curve, point)
  mapping_point(parameter, A.curve_point(curve, parameter), edge, forward, source, hit, support, curve, margin)

def mapping_join(a: Mapping, b: Mapping) -> Mapping:
  match a b:
    case InvalidMapping{} _:
      InvalidMapping{}
    case _ InvalidMapping{}:
      InvalidMapping{}
    case MultipleMappings{} _:
      MultipleMappings{}
    case _ MultipleMappings{}:
      MultipleMappings{}
    case Mapped{_} Mapped{_}:
      MultipleMappings{}
    case Mapped{event} NoMapping{}:
      Mapped{event}
    case NoMapping{} Mapped{event}:
      Mapped{event}
    case NoMapping{} NoMapping{}:
      NoMapping{}

def map_supports(curves: List<&2, A.Curve>, +index: U32, +edge: U32, +forward: Bool, +source: E.EdgeSource, +hit: E.EdgeHit, +margin: R.Real) -> Mapping:
  match curves:
    case Nil{}:
      NoMapping{}
    case curve <> tail:
      mapping_join(map_curve(curve, edge, forward, source, hit, index, margin), map_supports(tail, (index + 1 : U32), edge, forward, source, hit, margin))

def mapping_event(mapping: Mapping, edge: U32, resolution: R.Real) -> EventCollection:
  match mapping:
    case NoMapping{}:
      EventUnresolved{SupportMismatch{edge}}
    case MultipleMappings{}:
      EventUnresolved{AmbiguousSupport{edge}}
    case InvalidMapping{}:
      EventUnresolved{EventRange{edge}}
    case Mapped{event}:
      Events{[event], resolution}

def event_join(a: EventCollection, b: EventCollection) -> EventCollection:
  match a b:
    case EventRejected{reason} _:
      EventRejected{reason}
    case _ EventRejected{reason}:
      EventRejected{reason}
    case EventUnresolved{reason} _:
      EventUnresolved{reason}
    case _ EventUnresolved{reason}:
      EventUnresolved{reason}
    case EventContact{reason} _:
      EventContact{reason}
    case _ EventContact{reason}:
      EventContact{reason}
    case Events{first, a} Events{last, b}:
      Events{List.append(&2, BoundaryEvent, first, last), R.max(a, b)}

def event_interior(location: E.Location) -> Bool:
  match location:
    case E.Interior{}:
      True{}
    case E.SeamVertex{_, _, _}:
      True{}
    case _:
      False{}

def hit_checked(valid: Bool, hit: E.EdgeHit, +edge: U32, forward: Bool, source: E.EdgeSource, supports: List<&2, A.Curve>, margin: R.Real, resolution: R.Real) -> EventCollection:
  match valid:
    case False{}:
      E.Hit{_, _, _, location} = hit
      EventContact{VertexContact{edge, location}}
    case True{}:
      mapping_event(map_supports(supports, 0, edge, forward, source, hit, margin), edge, resolution)

def collect_hits(hits: List<&2, E.EdgeHit>, +edge: U32, +forward: Bool, +source: E.EdgeSource, +supports: List<&2, A.Curve>, +margin: R.Real, +resolution: R.Real) -> EventCollection:
  match hits:
    case Nil{}:
      Events{Nil{}, resolution}
    case +hit <> tail:
      E.Hit{_, _, multiplicity, location} = hit
      valid = Bool.and(U32.is_eq(multiplicity, 1), event_interior(location))
      one = hit_checked(valid, hit, edge, forward, source, supports, margin, resolution)
      event_join(one, collect_hits(tail, edge, forward, source, supports, margin, resolution))

def edge_relation(relation: C.Relation, hits: List<&2, E.EdgeHit>, edge: U32, forward: Bool, source: E.EdgeSource, supports: List<&2, A.Curve>, margin: R.Real, resolution: R.Real) -> EventCollection:
  match relation:
    case C.Disjoint{}:
      Events{Nil{}, resolution}
    case C.Crossing{}:
      collect_hits(hits, edge, forward, source, supports, margin, resolution)
    case C.Coincident{}:
      EventContact{BoundaryCoincidence{edge}}
    case C.Tangent{}:
      EventContact{BoundaryTangency{edge}}

def edge_result(result: E.EdgePlaneResult, edge: U32, forward: Bool, supports: List<&2, A.Curve>, tolerance: I.Tolerance, budget: R.Real, +support_resolution: R.Real) -> EventCollection:
  match result:
    case E.Rejected{reason}:
      EventRejected{EdgeRejected{edge, reason}}
    case E.Unresolved{reason}:
      EventUnresolved{EdgeUnresolved{edge, reason}}
    case E.Resolved{relation, hits, source, +linear_resolution, _}:
      +resolution = R.max(linear_resolution, support_resolution)
      margin = R.add(R.add(budget, I.tolerance_linear(tolerance)), R.add(linear_resolution, support_resolution))
      edge_relation(relation, hits, edge, forward, source, supports, margin, resolution)

def collect_events(edges: List<&2, F.PreparedEdge>, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +source: FaceSource, +supports: List<&2, A.Curve>, +tolerance: I.Tolerance, +resolution: R.Real) -> EventCollection:
  match edges:
    case Nil{}:
      Events{Nil{}, resolution}
    case F.PreparedEdge{+index, _, _, _, _, forward} <> tail:
      FaceSource{_, _, origin, normal, +budget} = source
      result = E.intersect(solid, index, domains, origin, normal, tolerance, budget)
      one = edge_result(result, index, forward, supports, tolerance, budget, resolution)
      event_join(one, collect_events(tail, solid, domains, source, supports, tolerance, resolution))

def event_parameter(event: BoundaryEvent) -> R.Real:
  BoundaryEvent{_, _, _, _, _, parameter, _, _, _} = event
  parameter

def event_point(event: BoundaryEvent) -> G.Vec3:
  BoundaryEvent{_, _, _, _, _, _, point, _, _} = event
  point

def event_resolution(event: BoundaryEvent) -> R.Real:
  BoundaryEvent{_, _, _, _, _, _, _, _, resolution} = event
  resolution

def event_support(event: BoundaryEvent) -> U32:
  BoundaryEvent{_, _, _, _, support, _, _, _, _} = event
  support

def insert_event(+event: BoundaryEvent, sorted: List<&2, BoundaryEvent>) -> List<&2, BoundaryEvent>:
  match sorted:
    case Nil{}:
      [event]
    case +head <> +tail:
      Bool.pick(List<&2, BoundaryEvent>, R.less(event_parameter(event), event_parameter(head)), event <> head <> tail, head <> insert_event(event, tail))

def sorted_events(events: List<&2, BoundaryEvent>, +index: U32) -> List<&2, BoundaryEvent>:
  match events:
    case Nil{}:
      Nil{}
    case +event <> tail:
      +rest = sorted_events(tail, index)
      Bool.pick(List<&2, BoundaryEvent>, U32.is_eq(event_support(event), index), insert_event(event, rest), rest)

def planar_probe(result: F.Classification) -> Probe:
  match result:
    case F.Inside{_}:
      ProbeInside{}
    case F.Outside{_}:
      ProbeOutside{}
    case F.Boundary{_, _}:
      ProbeBoundary{}
    case F.Unresolved{reason}:
      ProbeUnknown{Planar{reason}}

def cylinder_probe(result: K.Classification) -> Probe:
  match result:
    case K.Inside{_}:
      ProbeInside{}
    case K.Outside{_}:
      ProbeOutside{}
    case K.Boundary{_, _}:
      ProbeBoundary{}
    case K.Unresolved{reason}:
      ProbeUnknown{Cylinder{reason}}

def probe_surface(surface: A.Surface, solid: A.Solid, index: U32, domains: List<&2, F.DomainChoice>, point: G.Vec3, tolerance: I.Tolerance, budget: R.Real) -> Probe:
  match surface:
    case A.Plane{_, _, _}:
      planar_probe(F.classify(solid, index, domains, point, tolerance, budget))
    case A.Cylinder{_, _, _, _}:
      cylinder_probe(K.classify(solid, index, domains, point, tolerance, budget))
    case _:
      ProbeUnknown{SampleRange{}}

def probe_valid(valid: Bool, solid: A.Solid, domains: List<&2, F.DomainChoice>, source: FaceSource, point: G.Vec3, tolerance: I.Tolerance) -> Probe:
  match valid:
    case False{}:
      ProbeUnknown{SampleRange{}}
    case True{}:
      FaceSource{index, A.Face{surface, _, _}, _, _, budget} = source
      probe_surface(surface, solid, index, domains, point, tolerance, budget)

def probe(solid: A.Solid, domains: List<&2, F.DomainChoice>, source: FaceSource, +point: G.Vec3, tolerance: I.Tolerance) -> Probe:
  probe_valid(I.vec_valid(point), solid, domains, source, point, tolerance)

def finite_section(index: U32, +curve: A.Curve, +first: BoundaryEvent, +last: BoundaryEvent, +last_parameter: R.Real) -> Section:
  +first_parameter = event_parameter(first)
  Section{index, curve, C.Interval{first_parameter, last_parameter},
    Boundary{first, first_parameter, event_point(first)},
    Boundary{last, last_parameter, A.curve_point(curve, last_parameter)}}

def span_probe(result: Probe, index: U32, curve: A.Curve, first: BoundaryEvent, last: BoundaryEvent, last_parameter: R.Real, parameter: R.Real, point: G.Vec3) -> Partition:
  match result:
    case ProbeInside{}:
      Partition{[finite_section(index, curve, first, last, last_parameter)], True{}, True{}, 1}
    case ProbeOutside{}:
      Partition{Nil{}, False{}, False{}, 1}
    case ProbeBoundary{}:
      PartitionContact{SampleBoundary{index, parameter, point}}
    case ProbeUnknown{reason}:
      PartitionUnresolved{SampleUnresolved{index, parameter, point, reason}}

def span_clear(clear: Bool, index: U32, +curve: A.Curve, +first: BoundaryEvent, last: BoundaryEvent, +last_parameter: R.Real, solid: A.Solid, domains: List<&2, F.DomainChoice>, source: FaceSource, tolerance: I.Tolerance) -> Partition:
  match clear:
    case False{}:
      PartitionUnresolved{CrowdedEvents{index}}
    case True{}:
      +parameter = R.mul(R.add(event_parameter(first), last_parameter), R.from_f32(0.5))
      +point = A.curve_point(curve, parameter)
      result = probe(solid, domains, source, point, tolerance)
      span_probe(result, index, curve, first, last, last_parameter, parameter, point)

def span(index: U32, curve: A.Curve, +first: BoundaryEvent, +last: BoundaryEvent, +last_parameter: R.Real, solid: A.Solid, domains: List<&2, F.DomainChoice>, source: FaceSource, tolerance: I.Tolerance) -> Partition:
  margin = R.add(event_resolution(first), event_resolution(last))
  clear = R.less(margin, R.sub(last_parameter, event_parameter(first)))
  span_clear(clear, index, curve, first, last, last_parameter, solid, domains, source, tolerance)

def partition_join(a: Partition, b: Partition, index: U32) -> Partition:
  match a b:
    case PartitionUnresolved{reason} _:
      PartitionUnresolved{reason}
    case _ PartitionUnresolved{reason}:
      PartitionUnresolved{reason}
    case PartitionContact{reason} _:
      PartitionContact{reason}
    case _ PartitionContact{reason}:
      PartitionContact{reason}
    case Partition{+sa, +fa, +la, +ca} Partition{+sb, +fb, +lb, +cb}:
      Bool.pick(Partition, U32.is_eq(ca, 0), Partition{sb, fb, lb, cb},
        Bool.pick(Partition, U32.is_eq(cb, 0), Partition{sa, fa, la, ca},
          Bool.pick(Partition, Bool.not(E.bool_equal(la, fb)),
            Partition{List.append(&2, Section, sa, sb), fa, lb, (ca + cb : U32)}, PartitionUnresolved{InconsistentIntervals{index}})))

def adjacent_spans(events: List<&2, BoundaryEvent>, +index: U32, +curve: A.Curve, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +source: FaceSource, +tolerance: I.Tolerance) -> Partition:
  match events:
    case first <> +second <> tail:
      one = span(index, curve, first, second, event_parameter(second), solid, domains, source, tolerance)
      partition_join(one, adjacent_spans(second <> tail, index, curve, solid, domains, source, tolerance), index)
    case _:
      Partition{Nil{}, False{}, False{}, 0}

def closing_span(events: List<&2, BoundaryEvent>, first: BoundaryEvent, index: U32, curve: A.Curve, solid: A.Solid, domains: List<&2, F.DomainChoice>, source: FaceSource, tolerance: I.Tolerance) -> Partition:
  match events:
    case last <> Nil{}:
      +lifted_first = first
      last_parameter = R.add(event_parameter(lifted_first), C.tau())
      span(index, curve, last, lifted_first, last_parameter, solid, domains, source, tolerance)
    case _ <> tail:
      closing_span(tail, first, index, curve, solid, domains, source, tolerance)
    case Nil{}:
      PartitionUnresolved{OddEvents{index}}

def finish_partition(result: Partition, periodic: Bool, index: U32) -> Sections:
  match result:
    case PartitionContact{reason}:
      SectionContact{reason}
    case PartitionUnresolved{reason}:
      SectionUnresolved{reason}
    case Partition{sections, +first, +last, _}:
      valid = Bool.pick(Bool, periodic, Bool.not(E.bool_equal(first, last)), Bool.and(first, last))
      Bool.pick(Sections, valid, Sections{sections}, SectionUnresolved{InconsistentIntervals{index}})

def spans_even(even: Bool, +events: List<&2, BoundaryEvent>, first: BoundaryEvent, +index: U32, +curve: A.Curve, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +source: FaceSource, +tolerance: I.Tolerance) -> Sections:
  match even:
    case False{}:
      SectionUnresolved{OddEvents{index}}
    case True{}:
      +periodic = C.curve_periodic(curve)
      ordinary = adjacent_spans(events, index, curve, solid, domains, source, tolerance)
      closing = Bool.pick(Partition, periodic, closing_span(events, first, index, curve, solid, domains, source, tolerance), Partition{Nil{}, False{}, False{}, 0})
      finish_partition(partition_join(ordinary, closing, index), periodic, index)

def full_section(index: U32, +curve: A.Curve) -> Section:
  +point = A.curve_point(curve, zero())
  Section{index, curve, C.Untrimmed{}, PeriodicSeam{zero(), point}, PeriodicSeam{zero(), point}}

def full_probe(result: Probe, index: U32, curve: A.Curve, point: G.Vec3) -> Sections:
  match result:
    case ProbeInside{}:
      Sections{[full_section(index, curve)]}
    case ProbeOutside{}:
      Sections{Nil{}}
    case ProbeBoundary{}:
      SectionContact{SampleBoundary{index, zero(), point}}
    case ProbeUnknown{reason}:
      SectionUnresolved{SampleUnresolved{index, zero(), point, reason}}

def curve_sections(events: List<&2, BoundaryEvent>, index: U32, +curve: A.Curve, solid: A.Solid, domains: List<&2, F.DomainChoice>, source: FaceSource, tolerance: I.Tolerance) -> Sections:
  match events curve:
    case Nil{} A.Line{_, _}:
      Sections{Nil{}}
    case Nil{} _:
      +point = A.curve_point(curve, zero())
      full_probe(probe(solid, domains, source, point, tolerance), index, curve, point)
    case +first <> +tail _:
      +events = {first <> tail : List<&2, BoundaryEvent>}
      count = U32.from_nat(List.length(&2, BoundaryEvent, events))
      spans_even(U32.is_eq(U32.and(count, 1), 0), events, first, index, curve, solid, domains, source, tolerance)

def section_join(a: Sections, b: Sections) -> Sections:
  match a b:
    case SectionUnresolved{reason} _:
      SectionUnresolved{reason}
    case _ SectionUnresolved{reason}:
      SectionUnresolved{reason}
    case SectionContact{reason} _:
      SectionContact{reason}
    case _ SectionContact{reason}:
      SectionContact{reason}
    case Sections{a} Sections{b}:
      Sections{List.append(&2, Section, a, b)}

def support_sections(curves: List<&2, A.Curve>, +events: List<&2, BoundaryEvent>, +index: U32, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +source: FaceSource, +tolerance: I.Tolerance) -> Sections:
  match curves:
    case Nil{}:
      Sections{Nil{}}
    case curve <> tail:
      one = curve_sections(sorted_events(events, index), index, curve, solid, domains, source, tolerance)
      section_join(one, support_sections(tail, events, (index + 1 : U32), solid, domains, source, tolerance))

def resolved_sections(sections: List<&2, Section>, events: List<&2, BoundaryEvent>, supports: List<&2, A.Curve>, source: FaceSource, resolution: R.Real) -> FacePlaneResult:
  match sections:
    case Nil{}:
      Resolved{Empty{}, Nil{}, events, supports, source, resolution}
    case head <> tail:
      Resolved{Transverse{}, head <> tail, events, supports, source, resolution}

def finish_sections(result: Sections, events: List<&2, BoundaryEvent>, supports: List<&2, A.Curve>, source: FaceSource, resolution: R.Real) -> FacePlaneResult:
  match result:
    case Sections{sections}:
      resolved_sections(sections, events, supports, source, resolution)
    case SectionContact{reason}:
      NonTransverse{reason, supports, source}
    case SectionUnresolved{reason}:
      Unresolved{reason}

def finish_events(result: EventCollection, +supports: List<&2, A.Curve>, solid: A.Solid, domains: List<&2, F.DomainChoice>, +source: FaceSource, tolerance: I.Tolerance) -> FacePlaneResult:
  match result:
    case EventRejected{reason}:
      Rejected{reason}
    case EventUnresolved{reason}:
      Unresolved{reason}
    case EventContact{reason}:
      NonTransverse{reason, supports, source}
    case Events{+events, resolution}:
      sections = support_sections(supports, events, 0, solid, domains, source, tolerance)
      finish_sections(sections, events, supports, source, resolution)

def supporting_relation(relation: I.Relation, +curves: List<&2, A.Curve>, edges: List<&2, F.PreparedEdge>, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +source: FaceSource, +tolerance: I.Tolerance, resolution: R.Real) -> FacePlaneResult:
  match relation:
    case I.CoincidentPlanes{}:
      NonTransverse{Coplanar{}, curves, source}
    case I.TangentGenerator{}:
      NonTransverse{TangentSupport{}, curves, source}
    case I.ParallelPlanes{}:
      Resolved{Empty{}, Nil{}, Nil{}, curves, source, resolution}
    case I.EmptySection{}:
      Resolved{Empty{}, Nil{}, Nil{}, curves, source, resolution}
    case _:
      result = collect_events(edges, solid, domains, source, curves, tolerance, resolution)
      finish_events(result, curves, solid, domains, source, tolerance)

def supporting_result(result: I.IntersectionResult, edges: List<&2, F.PreparedEdge>, solid: A.Solid, domains: List<&2, F.DomainChoice>, source: FaceSource, tolerance: I.Tolerance, resolution: R.Real) -> FacePlaneResult:
  match result:
    case I.Rejected{reason}:
      Rejected{SupportingRejected{reason}}
    case I.Unresolved{reason, _, _}:
      Unresolved{Supporting{reason}}
    case I.Resolved{relation, curves, linear_resolution, _}:
      supporting_relation(relation, curves, edges, solid, domains, source, tolerance, R.max(resolution, linear_resolution))

def finite_intersection(excluded: Bool, edges: List<&2, F.PreparedEdge>, solid: A.Solid, domains: List<&2, F.DomainChoice>, +source: FaceSource, +tolerance: I.Tolerance, resolution: R.Real) -> FacePlaneResult:
  match excluded:
    case True{}:
      Resolved{Empty{}, Nil{}, Nil{}, Nil{}, source, resolution}
    case False{}:
      FaceSource{_, _, origin, normal, _} = source
      result = I.intersect(source_surface(source), A.Plane{origin, normal, G.v3(1.0, 0.0, 0.0)}, tolerance)
      supporting_result(result, edges, solid, domains, source, tolerance, resolution)

def intersect_prepared(prepared: FacePreparation, solid: A.Solid, domains: List<&2, F.DomainChoice>, +tolerance: I.Tolerance) -> FacePlaneResult:
  match prepared:
    case PreparationUnresolved{reason}:
      Unresolved{reason}
    case PreparationRejected{reason}:
      Rejected{reason}
    case Prepared{+edges, +source, +resolution}:
      FaceSource{_, _, origin, normal, budget} = source
      excluded = Bounds.excludes(source_surface(source), edges, origin, normal, tolerance, budget, resolution)
      finite_intersection(excluded, edges, solid, domains, source, tolerance, resolution)

def face_supported(surface: A.Surface) -> Bool:
  match surface:
    case A.Plane{_, _, _}:
      True{}
    case A.Cylinder{_, _, _, _}:
      True{}
    case _:
      False{}

def face_allowed(allowed: Bool, +face: A.Face, index: U32, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +plane_origin: G.Vec3, +plane_normal: G.Vec3, +tolerance: I.Tolerance, +budget: R.Real) -> FacePlaneResult:
  match allowed:
    case False{}:
      Rejected{UnsupportedSurface{}}
    case True{}:
      A.Solid{vertices, edges, _} = solid
      geometry = Bool.and(surface_valid(face_geometry(face)), Bool.and(I.vec_valid(plane_origin), Bool.and(I.vec_valid(plane_normal), I.direction_valid(plane_normal))))
      budgets = Bool.and(F.valid_budget(budget), Bool.and(I.tolerance_valid(tolerance), I.at_most(I.angular_guard(), I.tolerance_angular(tolerance))))
      prepared = prepare_valid(Bool.and(geometry, budgets), face, index, vertices, edges, domains, plane_origin, plane_normal, tolerance, budget)
      intersect_prepared(prepared, solid, domains, tolerance)

def face_lookup(found: Maybe<&2, A.Face>, index: U32, solid: A.Solid, domains: List<&2, F.DomainChoice>, plane_origin: G.Vec3, plane_normal: G.Vec3, tolerance: I.Tolerance, budget: R.Real) -> FacePlaneResult:
  match found:
    case None{}:
      Rejected{InvalidIndex{}}
    case Some{+face}:
      A.Face{surface, _, _} = face
      face_allowed(face_supported(surface), face, index, solid, domains, plane_origin, plane_normal, tolerance, budget)

def intersect(+solid: A.Solid, +face_index: U32, domains: List<&2, F.DomainChoice>, plane_origin: G.Vec3, plane_normal: G.Vec3, tolerance: I.Tolerance, source_budget: R.Real) -> FacePlaneResult:
  A.Solid{_, _, faces} = solid
  face_lookup(List.get(&2, A.Face, faces, U32.to_nat(face_index)), face_index, solid, domains, plane_origin, plane_normal, tolerance, source_budget)
