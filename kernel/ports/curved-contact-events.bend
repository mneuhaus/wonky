import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../intersections.bend as I
import ../curve-plane.bend as C
import ../edge-plane.bend as E
import ../face-classification.bend as F
import ../face-plane.bend as FP
import ../face-bounds.bend as FB
import ../halfspace.bend as H
import ../junction.bend as J
import ../curve-band.bend as CB
import ../robust-predicates.bend as Exact
import ./types.bend as P
import ./curved-metrics.bend as M
import ./curved-validate.bend as V
import ./curved-contact-state.bend as S
import ./occt-edges.bend as OE

type VertexPass is Data:
  VertexPass{valid: Bool, values: List<&2, H.Side>, records: List<&2, S.VertexRecord>}

type Samples is Data:
  Samples{valid: Bool, specs: List<&2, J.EventSpec>}

type FacePass is Data:
  FacePass{valid: Bool, records: List<&2, S.FaceRecord>}

type EdgePass is Data:
  EdgePass{valid: Bool, table: OE.Table, records: List<&2, S.BandRecord>}

def zero() -> R.Real:
  R.from_f32(0.0)

def prepend_sample(proposal: J.EndpointProposal, samples: Samples) -> Samples:
  match proposal samples:
    case J.Proposal{_, sample <> _} Samples{valid, specs}:
      Samples{valid, sample <> specs}
    case _ Samples{_, specs}:
      Samples{False{}, specs}

def endpoint_sample(prepared: E.EdgePreparation, body: U32, plane: J.PlaneRef, first: Bool, index: U32, samples: Samples) -> Samples:
  match prepared samples:
    case E.Prepared{source} _:
      prepend_sample(J.endpoint_proposal(source, body, plane, first, index, 4294967295), samples)
    case _ Samples{_, specs}:
      Samples{False{}, specs}

def incident_sample(incident: Bool, +edge: A.Edge, +index: U32, first: Bool, vertices: List<&2, G.Vec3>, domains: List<&2, F.DomainChoice>, +origin: G.Vec3, normal: G.Vec3, +policy: S.Policy, rest: Samples) -> Samples:
  match incident:
    case False{}:
      rest
    case True{}:
      A.Edge{_, _, curve, _} = edge
      match curve:
        case A.Line{_, _}:
          plane : J.PlaneRef = J.PlaneRef{1, 0, origin, normal}
          prepared = E.prepare_edge(Some{edge}, index, vertices, F.choose_domain(List.get(&2, F.DomainChoice, domains, U32.to_nat(index))), origin, S.tolerance(policy), S.budget(policy))
          endpoint_sample(prepared, 0, plane, first, index, rest)
        case _:
          Samples{_, specs} = rest
          Samples{False{}, specs}

def incident_samples(edges: List<&2, A.Edge>, +index: U32, +vertex: U32, +vertices: List<&2, G.Vec3>, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +policy: S.Policy) -> Samples:
  match edges:
    case Nil{}:
      Samples{True{}, Nil{}}
    case +edge <> tail:
      A.Edge{a, b, _, _} = edge
      +first = U32.is_eq(a, vertex)
      incident = Bool.or(first, U32.is_eq(b, vertex))
      incident_sample(incident, edge, index, first, vertices, domains, origin, normal, policy, incident_samples(tail, (index + 1 : U32), vertex, vertices, domains, origin, normal, policy))

def associated(samples: Samples, +anchor: J.SourceVertex, origin: G.Vec3, normal: G.Vec3, cap: R.Real) -> J.Association:
  match samples:
    case Samples{False{}, _}:
      J.Rejected{J.InvalidCurve{}}
    case Samples{True{}, specs}:
      plane : J.PlaneRef = J.PlaneRef{1, 0, origin, normal}
      J.associate(anchor, J.Projection{4294967295, plane, anchor} <> specs, J.Policy{cap})

def association_valid(association: J.Association) -> Bool:
  match association:
    case J.Associated{_}:
      True{}
    case _:
      False{}

def exact_kind(decision: Exact.Decision) -> U32:
  match decision:
    case Exact.Decision{Exact.Negative{}, _}:
      1
    case Exact.Decision{Exact.Positive{}, _}:
      2
    case Exact.Decision{Exact.ExactlyZero{}, _}:
      0
    case _:
      3

def vertex_record(+index: U32, +decision: Exact.Decision, +distance: R.Real, +kind: U32, association: Maybe<&2, J.Association>, rest: VertexPass) -> VertexPass:
  VertexPass{valid, values, records} = rest
  VertexPass{Bool.and(valid, U32.is_lt(kind, 3)), H.Side{kind, distance} <> values, S.VertexRecord{index, decision, distance, kind, association} <> records}

def contact_vertex(+association: J.Association, index: U32, decision: Exact.Decision, distance: R.Real, rest: VertexPass) -> VertexPass:
  vertex_record(index, decision, distance, Bool.pick(U32, association_valid(association), 0, 3), Some{association}, rest)

def vertex_choice(near: Bool, clear: Bool, +index: U32, +point: G.Vec3, +decision: Exact.Decision, distance: R.Real, edges: List<&2, A.Edge>, vertices: List<&2, G.Vec3>, domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +policy: S.Policy, rest: VertexPass) -> VertexPass:
  match near:
    case True{}:
      anchor : J.SourceVertex = J.SourceVertex{0, index, point, S.budget(policy)}
      samples = incident_samples(edges, 0, index, vertices, domains, origin, normal, policy)
      contact_vertex(associated(samples, anchor, origin, normal, S.cap(policy)), index, decision, distance, rest)
    case False{}:
      vertex_record(index, decision, distance, Bool.pick(U32, clear, exact_kind(decision), 3), None{}, rest)

def vertices(points: List<&2, G.Vec3>, +index: U32, +edges: List<&2, A.Edge>, +all: List<&2, G.Vec3>, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +policy: S.Policy) -> VertexPass:
  match points:
    case Nil{}:
      VertexPass{True{}, Nil{}, Nil{}}
    case +point <> tail:
      +decision = Exact.point_plane(normal, point, origin)
      +distance = E.signed_point(point, origin, normal)
      +guard = J.resolution(point, origin)
      near = Bool.or(U32.is_eq(exact_kind(decision), 0), I.at_most(R.add(R.abs(distance), guard), S.cap(policy)))
      clear = R.less(S.cap(policy), R.sub(R.abs(distance), guard))
      vertex_choice(near, clear, index, point, decision, distance, edges, all, domains, origin, normal, policy,
        vertices(tail, (index + 1 : U32), edges, all, domains, origin, normal, policy))

# Independent source identities are never merged. Reject overlapping contact
# neighborhoods instead of assigning a sample to the nearer source anchor.
def anchor_clear(records: List<&2, S.VertexRecord>, +point: G.Vec3, +points: List<&2, G.Vec3>, +cap: R.Real) -> Bool:
  match records:
    case Nil{}:
      True{}
    case S.VertexRecord{index, _, _, kind, _} <> tail:
      +other = H.vertex(points, index)
      lower = R.sub(I.length(G.sub(point, other)), J.resolution(point, other))
      clear = R.less(R.mul(cap, R.from_f32(2.0)), lower)
      Bool.and(Bool.or(Bool.not(U32.is_eq(kind, 0)), clear), anchor_clear(tail, point, points, cap))

def separated(records: List<&2, S.VertexRecord>, +points: List<&2, G.Vec3>, +cap: R.Real) -> VertexPass:
  match records:
    case Nil{}:
      VertexPass{True{}, Nil{}, Nil{}}
    case S.VertexRecord{+index, exact, distance, +kind, association} <> +tail:
      clear = Bool.or(Bool.not(U32.is_eq(kind, 0)), anchor_clear(tail, H.vertex(points, index), points, cap))
      vertex_record(index, exact, distance, Bool.pick(U32, clear, kind, 3), association, separated(tail, points, cap))

def checked_vertices(pass: VertexPass, points: List<&2, G.Vec3>, cap: R.Real) -> VertexPass:
  VertexPass{_, _, records} = pass
  separated(records, points, cap)

def linear_edges(edges: List<&2, F.PreparedEdge>) -> Bool:
  match edges:
    case Nil{}:
      True{}
    case F.PreparedEdge{_, A.Edge{_, _, A.Line{_, _}, _}, _, _, _, _} <> tail:
      linear_edges(tail)
    case _:
      False{}

def linear_face(face: A.Face, edges: List<&2, F.PreparedEdge>) -> Bool:
  match face:
    case A.Face{A.Plane{_, _, _}, _, A.Loop{True{}, _} <> Nil{}}:
      linear_edges(edges)
    case _:
      False{}

def bound_kind(bounds: FB.Bounds, cap: R.Real, resolution: R.Real) -> U32:
  match bounds:
    case FB.Finite{lower, upper, scale}:
      +margin = R.add(cap, R.mul(R.max(resolution, I.guard(scale)), R.from_f32(16.0)))
      Bool.pick(U32, R.less(upper, R.neg(margin)), 1, Bool.pick(U32, R.less(margin, lower), 2, 3))
    case _:
      0

def preparation_error(remaining: List<&2, F.PreparedEdge>, +surface: A.Surface) -> R.Real:
  match remaining:
    case Nil{}:
      zero()
    case F.PreparedEdge{_, A.Edge{_, _, +curve, sense}, +domain, start, end, _} <> tail:
      one = R.max(V.carrier_error(surface, curve, domain), F.endpoint_error(domain, curve, start, end, sense))
      R.max(one, preparation_error(tail, surface))

def expand_bounds(bounds: FB.Bounds, +error: R.Real) -> FB.Bounds:
  match bounds:
    case FB.Finite{lower, upper, scale}:
      FB.Finite{R.sub(lower, error), R.add(upper, error), scale}
    case _:
      bounds

def prepared_face(prepared: FP.FacePreparation, +face: A.Face, index: U32, origin: G.Vec3, normal: G.Vec3, cap: R.Real, rest: FacePass) -> FacePass:
  match prepared rest:
    case FP.Prepared{+edges, _, resolution} FacePass{valid, records}:
      +bounds = expand_bounds(FB.directional(FP.face_geometry(face), edges, origin, G.normalize(normal)), preparation_error(edges, FP.face_geometry(face)))
      +mode = bound_kind(bounds, cap, resolution)
      allowed = Bool.and(Bool.not(U32.is_eq(mode, 0)), Bool.or(Bool.not(U32.is_eq(mode, 3)), linear_face(face, edges)))
      FacePass{Bool.and(valid, allowed), S.FaceRecord{index, bounds, mode} <> records}
    case _ FacePass{_, records}:
      FacePass{False{}, S.FaceRecord{index, FB.UnknownBounds{}, 0} <> records}

def faces(remaining: List<&2, A.Face>, +index: U32, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +policy: S.Policy) -> FacePass:
  match remaining:
    case Nil{}:
      FacePass{True{}, Nil{}}
    case +face <> tail:
      prep = FP.prepare_valid(FP.surface_valid(FP.face_geometry(face)), face, index, vertices, edges, domains, origin, normal, S.tolerance(policy), S.budget(policy))
      prepared_face(prep, face, index, origin, normal, S.cap(policy), faces(tail, (index + 1 : U32), vertices, edges, domains, origin, normal, policy))

def append(edge: A.Edge, domain: C.Domain, origin: P.EdgeOrigin, table: OE.Table) -> OE.Table:
  OE.Table{vertices, edges, domains, origins, blocks} = table
  OE.Table{vertices, List.append(&2, A.Edge, edges, [edge]), List.append(&2, F.DomainChoice, domains, [F.GivenDomain{domain}]), List.append(&2, P.EdgeOrigin, origins, [origin]), blocks}

def kept(edge: A.Edge, domain: C.Domain, index: U32, +table: OE.Table) -> OE.Table:
  block = U32.from_nat(List.length(&2, A.Edge, OE.edges(table)))
  OE.append_block(Some{block}, append(edge, domain, P.SourceEdge{index}, table))

def band_valid(result: CB.BandResult) -> Bool:
  match result:
    case CB.Resolved{CB.ToleratedBand{}, _}:
      True{}
    case CB.Resolved{CB.ExactCurveInPlane{}, _}:
      True{}
    case _:
      False{}

def band_result(+result: CB.BandResult, edge: A.Edge, domain: C.Domain, +index: U32, pass: EdgePass) -> EdgePass:
  EdgePass{valid, table, records} = pass
  EdgePass{Bool.and(valid, band_valid(result)), kept(edge, domain, index, table), List.append(&2, S.BandRecord, records, [S.BandRecord{index, result}])}

def crossing(result: E.EdgePlaneResult, +edge: A.Edge, domain: C.Domain, index: U32, +keep_start: Bool, pass: EdgePass) -> EdgePass:
  match result edge domain pass:
    case E.Resolved{C.Crossing{}, E.Hit{+parameter, point, 1, E.Interior{}} <> Nil{}, _, _, _} A.Edge{a, b, curve, +sense} C.Interval{lo, hi} EdgePass{valid, +table, records}:
      OE.Table{+vertices, edges, domains, origins, blocks} = table
      +vertex = U32.from_nat(List.length(&2, G.Vec3, vertices))
      +low = Bool.pick(Bool, sense, keep_start, Bool.not(keep_start))
      trim : C.Domain = C.Interval{Bool.pick(R.Real, low, lo, parameter), Bool.pick(R.Real, low, parameter, hi)}
      new : A.Edge = A.Edge{Bool.pick(U32, keep_start, a, vertex), Bool.pick(U32, keep_start, vertex, b), curve, sense}
      next : OE.Table = OE.Table{List.append(&2, G.Vec3, vertices, [point]), edges, domains, origins, blocks}
      EdgePass{valid, kept(new, trim, index, next), records}
    case _ _ _ EdgePass{_, table, records}:
      EdgePass{False{}, OE.append_block(None{}, table), records}

def edge_choice(on: Bool, cross: Bool, keep: Bool, edge: A.Edge, +index: U32, +domain: C.Domain, keep_start: Bool, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +policy: S.Policy, pass: EdgePass) -> EdgePass:
  match on cross keep:
    case True{} _ _:
      band_result(CB.bound_edge(solid, index, domains, origin, normal, S.tolerance(policy), S.cap(policy), S.budget(policy)), edge, domain, index, pass)
    case False{} True{} _:
      crossing(E.intersect(solid, index, domains, origin, normal, S.tolerance(policy), S.budget(policy)), edge, domain, index, keep_start, pass)
    case False{} False{} True{}:
      EdgePass{valid, table, records} = pass
      EdgePass{valid, kept(edge, domain, index, table), records}
    case False{} False{} False{}:
      EdgePass{valid, table, records} = pass
      EdgePass{valid, OE.append_block(None{}, table), records}

def edges(remaining: List<&2, A.Edge>, +index: U32, +solid: A.Solid, +vertices: List<&2, G.Vec3>, +domains: List<&2, F.DomainChoice>, +values: List<&2, H.Side>, +origin: G.Vec3, +normal: G.Vec3, +policy: S.Policy, pass: EdgePass) -> EdgePass:
  match remaining:
    case Nil{}:
      pass
    case +edge <> tail:
      A.Edge{a, b, _, _} = edge
      +ka = H.side_kind(H.side_at(values, a))
      +kb = H.side_kind(H.side_at(values, b))
      on = Bool.and(U32.is_eq(ka, 0), U32.is_eq(kb, 0))
      cross = Bool.or(Bool.and(U32.is_eq(ka, 1), U32.is_eq(kb, 2)), Bool.and(U32.is_eq(ka, 2), U32.is_eq(kb, 1)))
      keep = Bool.and(Bool.not(U32.is_eq(ka, 2)), Bool.not(U32.is_eq(kb, 2)))
      domain = M.edge_domain(edge, index, domains, vertices)
      next = edge_choice(on, cross, keep, edge, index, domain, U32.is_eq(ka, 1), solid, domains, origin, normal, policy, pass)
      edges(tail, (index + 1 : U32), solid, vertices, domains, values, origin, normal, policy, next)
