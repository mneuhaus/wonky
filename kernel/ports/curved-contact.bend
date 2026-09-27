import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../intersections.bend as I
import ../face-classification.bend as F
import ../halfspace.bend as H
import ./types.bend as P
import ./occt.bend as O
import ./occt-edges.bend as OE
import ./curved.bend as C
import ./curved-validate.bend as V
import ./curved-edges.bend as GE
import ./curved-faces.bend as CF
import ./curved-contact-state.bend as S
import ./curved-contact-events.bend as E
import ./curved-contact-faces.bend as B
import ./curved-contact-topology.bend as T

type Parts is Data:
  Parts{valid: Bool, bodies: List<&2, P.Component>, records: List<&2, S.ComponentRecord>}

def part_audited(+audit: V.Audit, +solid: A.Solid, domains: List<&2, F.DomainChoice>, face_origins: List<&2, P.FaceOrigin>, edge_origins: List<&2, P.EdgeOrigin>, vertices: List<&2, H.VertexMap>, edges: List<&2, H.VertexMap>, rest: Parts) -> Parts:
  Parts{valid, bodies, records} = rest
  +links = T.valid(solid)
  Parts{Bool.and(valid, Bool.and(links, V.valid(audit))), P.Component{solid, domains, face_origins, edge_origins} <> bodies, S.ComponentRecord{vertices, edges, audit, links} <> records}

def part_compacted(compact: H.Compact, edges: List<&2, A.Edge>, +domains: List<&2, F.DomainChoice>, faces: List<&2, A.Face>, face_origins: List<&2, P.FaceOrigin>, edge_origins: List<&2, P.EdgeOrigin>, edge_map: List<&2, H.VertexMap>, +policy: S.Policy, rest: Parts) -> Parts:
  H.Compact{vertices, +map} = compact
  +solid : A.Solid = A.Solid{vertices, H.remap_edges(edges, map), faces}
  part_audited(C.audit(solid, domains, S.tolerance(policy), S.budget(policy)), solid, domains, face_origins, edge_origins, map, edge_map, rest)

def part(pack: O.EdgePack, vertices: List<&2, G.Vec3>, faces: List<&2, A.Face>, origins: List<&2, P.FaceOrigin>, policy: S.Policy, rest: Parts) -> Parts:
  O.EdgePack{+edges, domains, edge_origins, +map} = pack
  part_compacted(H.compact(vertices, edges, 0, 0), edges, domains, O.remap_faces(faces, map), origins, edge_origins, map, policy, rest)

def parts(fuel: Nat, +faces: List<&2, A.Face>, +origins: List<&2, P.FaceOrigin>, +graph: GE.Graph, +policy: S.Policy) -> Parts:
  match fuel faces:
    case _ Nil{}:
      Parts{True{}, Nil{}, Nil{}}
    case 0n _:
      Parts{False{}, Nil{}, Nil{}}
    case 1n+left _:
      +mask = H.connectivity_steps(List.length(&2, A.Face, faces), faces, H.connected_seed(faces, True{}))
      +selected = H.selected_faces(faces, mask)
      pack = O.edge_pack(GE.edges(graph), GE.domains(graph), GE.origins(graph), selected, 0, 0)
      part(pack, GE.vertices(graph), selected, O.selected_origins(origins, mask), policy,
        parts(left, H.selected_faces(faces, O.inverse(mask)), O.selected_origins(origins, O.inverse(mask)), graph, policy))

def result(bodies: List<&2, P.Component>) -> P.Result:
  match bodies:
    case Nil{}:
      P.Empty{}
    case P.Component{solid, domains, faces, edges} <> Nil{}:
      P.Clipped{solid, domains, faces, edges}
    case _:
      P.Components{bodies}

def finish(parts: Parts, policy: S.Policy, ledger: S.Ledger) -> S.Attempt:
  match parts ledger:
    case Parts{+valid, bodies, records} S.Ledger{version, _, vertices, bands, faces, _}:
      value = Bool.pick(P.Result, valid, result(bodies), P.Unresolved{P.ConstructionFailure{}})
      S.Attempt{value, policy, S.Ledger{version, Bool.pick(U32, valid, 7, 6), vertices, bands, faces, records}}

def built(build: CF.FaceBuild, +policy: S.Policy, ledger: S.Ledger) -> S.Attempt:
  match build:
    case CF.FaceBuild{True{}, graph, +faces, origins}:
      finish(parts(List.length(&2, A.Face, faces), faces, origins, graph, policy), policy, ledger)
    case _:
      S.reject(P.UnsupportedArrangement{}, policy, S.stage(5, ledger))

def faces_built(+build: B.Built, +solid: A.Solid, source_domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +policy: S.Policy, +resolution: R.Real, ledger: S.Ledger) -> S.Attempt:
  match build solid:
    case B.Built{O.BuildState{_, +table, _, _}, _} A.Solid{_, _, +source_faces}:
      curves = B.curves(OE.edges(table), OE.domains(table), OE.origins(table), solid, source_faces, source_domains, OE.vertices(table), origin, normal, policy)
      built(B.cap(B.owned(B.changed_curves(curves, build), source_faces, resolution), origin, normal, policy, resolution), policy, ledger)

def begin_faces(table: OE.Table, +solid: A.Solid, domains: List<&2, F.DomainChoice>, values: List<&2, H.Side>, face_records: List<&2, S.FaceRecord>, +origin: G.Vec3, +normal: G.Vec3, +policy: S.Policy, +resolution: R.Real, ledger: S.Ledger) -> S.Attempt:
  A.Solid{vertices, edges, source_faces} = solid
  state : O.BuildState = O.BuildState{True{}, table, Nil{}, Nil{}}
  faces_built(B.faces(source_faces, face_records, edges, vertices, values, origin, normal, policy, resolution, B.Built{state, False{}}), solid, domains, origin, normal, policy, resolution, ledger)

def edges_checked(pass: E.EdgePass, solid: A.Solid, domains: List<&2, F.DomainChoice>, values: List<&2, H.Side>, origin: G.Vec3, normal: G.Vec3, policy: S.Policy, resolution: R.Real, ledger: S.Ledger) -> S.Attempt:
  match pass ledger:
    case E.EdgePass{False{}, _, bands} S.Ledger{version, _, records, _, faces, components}:
      S.reject(P.AmbiguousContact{}, policy, S.Ledger{version, 4, records, bands, faces, components})
    case E.EdgePass{True{}, table, bands} S.Ledger{version, _, records, _, +faces, components}:
      next_ledger : S.Ledger = S.Ledger{version, 4, records, bands, faces, components}
      begin_faces(table, solid, domains, values, faces, origin, normal, policy, resolution, next_ledger)

def vertices_checked(pass: E.VertexPass, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +policy: S.Policy, +resolution: R.Real, face_records: List<&2, S.FaceRecord>) -> S.Attempt:
  match pass solid:
    case E.VertexPass{False{}, _, records} _:
      S.reject(P.AmbiguousContact{}, policy, S.Ledger{1, 3, records, Nil{}, face_records, Nil{}})
    case E.VertexPass{True{}, +values, records} A.Solid{+vertices, edges, _}:
      table : OE.Table = OE.Table{vertices, Nil{}, Nil{}, Nil{}, Nil{}}
      ledger : S.Ledger = S.Ledger{1, 3, records, Nil{}, face_records, Nil{}}
      edges_checked(E.edges(edges, 0, solid, vertices, domains, values, origin, normal, policy, E.EdgePass{True{}, table, Nil{}}), solid, domains, values, origin, normal, policy, resolution, ledger)

def faces_checked(pass: E.FacePass, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +policy: S.Policy, resolution: R.Real) -> S.Attempt:
  match pass solid:
    case E.FacePass{False{}, records} _:
      S.reject(P.UnsupportedArrangement{}, policy, S.Ledger{1, 2, Nil{}, Nil{}, records, Nil{}})
    case E.FacePass{True{}, records} A.Solid{+vertices, edges, _}:
      vertices_checked(E.checked_vertices(E.vertices(vertices, 0, edges, vertices, domains, origin, normal, policy), vertices, S.cap(policy)), solid, domains, origin, normal, policy, resolution, records)

def source_checked(valid: Bool, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +policy: S.Policy) -> S.Attempt:
  match valid solid:
    case False{} _:
      S.reject(P.InvalidTopology{}, policy, S.stage(1, S.empty()))
    case True{} A.Solid{vertices, edges, faces}:
      faces_checked(E.faces(faces, 0, vertices, edges, domains, origin, normal, policy), solid, domains, origin, normal, policy, V.resolution(solid))

def source_audit(+solid: A.Solid, domains: List<&2, F.DomainChoice>, +policy: S.Policy) -> Bool:
  A.Solid{vertices, edges, faces} = solid
  rings = B.planar_faces(faces, vertices, edges, V.resolution(solid))
  Bool.and(rings, Bool.and(T.valid(solid), V.valid(C.audit(solid, domains, S.tolerance(policy), S.budget(policy)))))

def input_checked(valid: Bool, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, origin: G.Vec3, normal: G.Vec3, +policy: S.Policy) -> S.Attempt:
  match valid:
    case False{}:
      S.reject(P.InvalidInput{}, policy, S.empty())
    case True{}:
      source_checked(source_audit(solid, domains, policy), solid, domains, origin, normal, policy)

# Explicit modeled contact cap. It is never inferred from or added to either
# query tolerance or source construction budget. Existing strict APIs are intact.
def clip(solid: A.Solid, domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +source_budget: R.Real, +contact_cap: R.Real) -> S.Attempt:
  valid = Bool.and(I.vec_valid(origin), Bool.and(I.vec_valid(normal), Bool.and(I.direction_valid(normal),
    Bool.and(I.tolerance_valid(tolerance), Bool.and(I.at_most(I.angular_guard(), I.tolerance_angular(tolerance)), Bool.and(F.valid_budget(source_budget), F.valid_budget(contact_cap)))))))
  input_checked(valid, solid, domains, origin, normal, S.ToleratedRegularized{contact_cap, source_budget, tolerance})
