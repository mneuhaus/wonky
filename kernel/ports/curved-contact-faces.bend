import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../topology.bend as T
import ../intersections.bend as I
import ../curve-plane.bend as C
import ../face-classification.bend as F
import ../face-plane.bend as FP
import ../face-bounds.bend as FB
import ../halfspace.bend as H
import ../boundary.bend as B
import ./types.bend as P
import ./occt.bend as O
import ./occt-edges.bend as OE
import ./occt-planar.bend as V
import ./curved-edges.bend as GE
import ./curved-faces.bend as CF
import ./curved-contact-state.bend as S

type Built is Data:
  Built{state: O.BuildState, coplanar_kept: Bool}

type Curves is Data:
  Curves{valid: Bool, edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>}

def zero() -> R.Real:
  R.from_f32(0.0)

def failed(state: O.BuildState) -> O.BuildState:
  O.BuildState{_, table, faces, origins} = state
  O.BuildState{False{}, table, faces, origins}

def block_map(blocks: List<&2, Maybe<&2, U32>>, +index: U32) -> List<&2, H.VertexMap>:
  match blocks:
    case Nil{}:
      Nil{}
    case Some{block} <> tail:
      H.VertexMap{index, block} <> block_map(tail, (index + 1 : U32))
    case None{} <> tail:
      block_map(tail, (index + 1 : U32))

def mapped(found: Maybe<&2, Maybe<&2, U32>>) -> Bool:
  match found:
    case Some{Some{_}}:
      True{}
    case _:
      False{}

def uses_mapped(uses: List<&2, T.Coedge>, +blocks: List<&2, Maybe<&2, U32>>) -> Bool:
  match uses:
    case Nil{}:
      True{}
    case T.Use{edge, _} <> tail:
      Bool.and(mapped(List.get(&2, Maybe<&2, U32>, blocks, U32.to_nat(edge))), uses_mapped(tail, blocks))

def loops_mapped(loops: List<&2, A.Loop>, +blocks: List<&2, Maybe<&2, U32>>) -> Bool:
  match loops:
    case Nil{}:
      True{}
    case A.Loop{_, uses} <> tail:
      Bool.and(uses_mapped(uses, blocks), loops_mapped(tail, blocks))

def copy_face(face: A.Face, index: U32, +state: O.BuildState) -> O.BuildState:
  A.Face{surface, sense, +loops} = face
  +blocks = OE.blocks(O.table(state))
  good = loops_mapped(loops, blocks)
  O.append_face(good, A.Face{surface, sense, O.remap_loops(loops, block_map(blocks, 0))}, P.SourceFace{index}, state)

def on_uses_clear(uses: List<&2, T.Coedge>, +edges: List<&2, A.Edge>, +vertices: List<&2, G.Vec3>, +values: List<&2, H.Side>, +out: G.Vec3, +normal: G.Vec3, +angular: R.Real) -> Bool:
  match uses:
    case Nil{}:
      True{}
    case +use <> tail:
      +a = H.use_start(use, edges)
      +b = V.use_end(use, edges)
      on = Bool.and(U32.is_eq(H.side_kind(H.side_at(values, a)), 0), U32.is_eq(H.side_kind(H.side_at(values, b)), 0))
      inward = G.cross(out, G.normalize(G.sub(H.vertex(vertices, b), H.vertex(vertices, a))))
      clear = R.less(angular, R.abs(G.dot(inward, normal)))
      Bool.and(Bool.or(Bool.not(on), clear), on_uses_clear(tail, edges, vertices, values, out, normal, angular))

def wholly_band(bounds: FB.Bounds, cap: R.Real) -> Bool:
  match bounds:
    case FB.Finite{a, b, scale}:
      I.at_most(R.add(R.max(R.abs(a), R.abs(b)), R.mul(I.guard(scale), R.from_f32(16.0))), cap)
    case _:
      False{}

def coincident(result: I.IntersectionResult) -> Bool:
  match result:
    case I.Resolved{I.CoincidentPlanes{}, _, _, _}:
      True{}
    case _:
      False{}

def face_band(bounds: FB.Bounds, surface: A.Surface, origin: G.Vec3, normal: G.Vec3, +policy: S.Policy) -> Bool:
  exact = coincident(I.intersect(surface, A.plane(origin, normal), S.tolerance(policy)))
  Bool.or(exact, wholly_band(bounds, S.cap(policy)))

def active_valid(valid: Bool, face: A.Face, index: U32, edges: List<&2, A.Edge>, vertices: List<&2, G.Vec3>, values: List<&2, H.Side>, origin: G.Vec3, normal: G.Vec3, resolution: R.Real, state: O.BuildState) -> O.BuildState:
  match valid:
    case True{}:
      O.build_one(face, index, edges, vertices, values, origin, normal, resolution, state)
    case False{}:
      failed(state)

def active_face(+face: A.Face, index: U32, bounds: FB.Bounds, +edges: List<&2, A.Edge>, +vertices: List<&2, G.Vec3>, +values: List<&2, H.Side>, +origin: G.Vec3, +normal: G.Vec3, +policy: S.Policy, resolution: R.Real, built: Built) -> Built:
  match face built:
    case A.Face{+surface, +sense, A.Loop{True{}, +uses} <> Nil{}} Built{state, previous}:
      +on = O.all_on(H.ring_vertices(uses, edges), values)
      +out = V.outward(surface, sense)
      +unit = G.normalize(normal)
      +alignment = G.dot(out, unit)
      +angular = I.tolerance_angular(S.tolerance(policy))
      coplanar_ok = Bool.and(face_band(bounds, surface, origin, normal, policy), R.less(angular, R.abs(alignment)))
      transverse_ok = on_uses_clear(uses, edges, vertices, values, out, unit, angular)
      valid = Bool.pick(Bool, on, coplanar_ok, transverse_ok)
      kept = Bool.and(on, R.less(angular, alignment))
      Built{active_valid(valid, face, index, edges, vertices, values, origin, normal, resolution, state), Bool.or(previous, kept)}
    case _ Built{state, previous}:
      Built{failed(state), previous}

def face_mode(mode: U32, face: A.Face, index: U32, bounds: FB.Bounds, edges: List<&2, A.Edge>, vertices: List<&2, G.Vec3>, values: List<&2, H.Side>, origin: G.Vec3, normal: G.Vec3, policy: S.Policy, resolution: R.Real, built: Built) -> Built:
  match mode built:
    case 1 Built{state, previous}:
      Built{copy_face(face, index, state), previous}
    case 2 _:
      built
    case 3 _:
      active_face(face, index, bounds, edges, vertices, values, origin, normal, policy, resolution, built)
    case _ Built{state, previous}:
      Built{failed(state), previous}

def faces(remaining: List<&2, A.Face>, records: List<&2, S.FaceRecord>, +edges: List<&2, A.Edge>, +vertices: List<&2, G.Vec3>, +values: List<&2, H.Side>, +origin: G.Vec3, +normal: G.Vec3, +policy: S.Policy, +resolution: R.Real, built: Built) -> Built:
  match remaining records:
    case Nil{} Nil{}:
      built
    case face <> tail S.FaceRecord{index, bounds, mode} <> rest:
      faces(tail, rest, edges, vertices, values, origin, normal, policy, resolution, face_mode(mode, face, index, bounds, edges, vertices, values, origin, normal, policy, resolution, built))
    case _ _:
      Built{state, previous} = built
      Built{failed(state), previous}

def probe_inside(probe: FP.Probe) -> Bool:
  match probe:
    case FP.ProbeInside{}:
      True{}
    case _:
      False{}

def new_curve(support: I.IntersectionResult, edge: A.Edge, +face: U32, +surface: A.Surface, +solid: A.Solid, +source_domains: List<&2, F.DomainChoice>, +vertices: List<&2, G.Vec3>, +policy: S.Policy, rest: Curves) -> Curves:
  match support edge rest:
    case I.Resolved{I.CrossingPlanes{}, +curve <> Nil{}, _, _} A.Edge{+a, +b, _, _} Curves{valid, edges, domains}:
      +pa = A.curve_parameter(curve, H.vertex(vertices, a))
      +pb = A.curve_parameter(curve, H.vertex(vertices, b))
      +lo = R.min(pa, pb)
      +hi = R.max(pa, pb)
      midpoint = A.curve_point(curve, R.mul(R.add(lo, hi), R.from_f32(0.5)))
      probe = FP.probe_surface(surface, solid, face, source_domains, midpoint, S.tolerance(policy), S.budget(policy))
      Curves{Bool.and(valid, Bool.and(R.less(lo, hi), probe_inside(probe))), A.Edge{a, b, curve, R.less(pa, pb)} <> edges, F.GivenDomain{C.Interval{lo, hi}} <> domains}
    case _ _ Curves{_, edges, domains}:
      Curves{False{}, edges, domains}

def cut_curve(found: Maybe<&2, A.Face>, edge: A.Edge, face: U32, solid: A.Solid, source_domains: List<&2, F.DomainChoice>, vertices: List<&2, G.Vec3>, origin: G.Vec3, normal: G.Vec3, +policy: S.Policy, rest: Curves) -> Curves:
  match found:
    case Some{A.Face{+surface, _, _}}:
      new_curve(I.intersect(surface, A.plane(origin, normal), S.tolerance(policy)), edge, face, surface, solid, source_domains, vertices, policy, rest)
    case None{}:
      Curves{_, edges, domains} = rest
      Curves{False{}, edges, domains}

def prepend_curve(edge: A.Edge, domain: F.DomainChoice, rest: Curves) -> Curves:
  Curves{valid, edges, domains} = rest
  Curves{valid, edge <> edges, domain <> domains}

def curves(remaining: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, origins: List<&2, P.EdgeOrigin>, +solid: A.Solid, +source_faces: List<&2, A.Face>, +source_domains: List<&2, F.DomainChoice>, +vertices: List<&2, G.Vec3>, +origin: G.Vec3, +normal: G.Vec3, +policy: S.Policy) -> Curves:
  match remaining domains origins:
    case Nil{} Nil{} Nil{}:
      Curves{True{}, Nil{}, Nil{}}
    case edge <> tail domain <> rest P.SourceEdge{_} <> more:
      prepend_curve(edge, domain, curves(tail, rest, more, solid, source_faces, source_domains, vertices, origin, normal, policy))
    case edge <> tail domain <> rest P.SurfaceSeam{_} <> more:
      prepend_curve(edge, domain, curves(tail, rest, more, solid, source_faces, source_domains, vertices, origin, normal, policy))
    case edge <> tail _ <> rest P.CutEdge{+face} <> more:
      cut_curve(List.get(&2, A.Face, source_faces, U32.to_nat(face)), edge, face, solid, source_domains, vertices, origin, normal, policy, curves(tail, rest, more, solid, source_faces, source_domains, vertices, origin, normal, policy))
    case _ _ _:
      Curves{False{}, Nil{}, Nil{}}

def changed_curves(curves: Curves, built: Built) -> Built:
  Curves{good, edges, domains} = curves
  Built{O.BuildState{valid, OE.Table{vertices, _, _, origins, blocks}, faces, face_origins}, previous} = built
  Built{O.BuildState{Bool.and(good, valid), OE.Table{vertices, edges, domains, origins, blocks}, faces, face_origins}, previous}

def block_lists(blocks: List<&2, Maybe<&2, U32>>) -> List<&2, List<&2, U32>>:
  match blocks:
    case Nil{}:
      Nil{}
    case Some{block} <> tail:
      [block] <> block_lists(tail)
    case None{} <> tail:
      Nil{} <> block_lists(tail)

def as_graph(table: OE.Table) -> GE.Graph:
  OE.Table{vertices, edges, domains, origins, blocks} = table
  GE.Graph{True{}, vertices, edges, domains, origins, block_lists(blocks), Nil{}}

def adjacent_clear(+joint: G.Vec3, +a: G.Vec3, +b: G.Vec3, +resolution: R.Real) -> Bool:
  Bool.and(Bool.not(V.near_segment(a, joint, b, resolution)), Bool.not(V.near_segment(b, joint, a, resolution)))

def segment_pair(+a: U32, +b: U32, +c: U32, +d: U32, +vertices: List<&2, G.Vec3>, normal: G.Vec3, +resolution: R.Real, adjacency: Bool) -> Bool:
  +ac = U32.is_eq(a, c)
  +ad = U32.is_eq(a, d)
  +bc = U32.is_eq(b, c)
  +bd = U32.is_eq(b, d)
  +shared = Bool.or(Bool.or(ac, ad), Bool.or(bc, bd))
  duplicate = Bool.or(Bool.and(ac, bd), Bool.and(ad, bc))
  joint = Bool.pick(U32, Bool.or(ac, ad), a, b)
  other_a = Bool.pick(U32, Bool.or(ac, ad), b, a)
  other_b = Bool.pick(U32, Bool.or(ac, bc), d, c)
  allowed_joint = Bool.and(adjacency, Bool.and(Bool.not(duplicate), adjacent_clear(H.vertex(vertices, joint), H.vertex(vertices, other_a), H.vertex(vertices, other_b), resolution)))
  separated = Bool.not(V.crossing(H.vertex(vertices, a), H.vertex(vertices, b), H.vertex(vertices, c), H.vertex(vertices, d), normal, resolution))
  Bool.pick(Bool, shared, allowed_joint, separated)

def edge_against(uses: List<&2, T.Coedge>, +a: U32, +b: U32, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +normal: G.Vec3, +resolution: R.Real, +adjacency: Bool) -> Bool:
  match uses:
    case Nil{}:
      True{}
    case +use <> tail:
      good = segment_pair(a, b, H.use_start(use, edges), V.use_end(use, edges), vertices, normal, resolution, adjacency)
      Bool.and(good, edge_against(tail, a, b, vertices, edges, normal, resolution, adjacency))

def unique_start(uses: List<&2, T.Coedge>, +vertex: U32, +edges: List<&2, A.Edge>) -> Bool:
  match uses:
    case Nil{}:
      True{}
    case use <> tail:
      Bool.and(Bool.not(U32.is_eq(H.use_start(use, edges), vertex)), unique_start(tail, vertex, edges))

def ring_clear(uses: List<&2, T.Coedge>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +normal: G.Vec3, +resolution: R.Real) -> Bool:
  match uses:
    case Nil{}:
      True{}
    case +use <> +tail:
      good = Bool.and(unique_start(tail, H.use_start(use, edges), edges), edge_against(tail, H.use_start(use, edges), V.use_end(use, edges), vertices, edges, normal, resolution, True{}))
      Bool.and(good, ring_clear(tail, vertices, edges, normal, resolution))

def ring_against(uses: List<&2, T.Coedge>, +other: List<&2, T.Coedge>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +normal: G.Vec3, +resolution: R.Real) -> Bool:
  match uses:
    case Nil{}:
      True{}
    case +use <> tail:
      a = H.use_start(use, edges)
      b = V.use_end(use, edges)
      Bool.and(edge_against(other, a, b, vertices, edges, normal, resolution, False{}), ring_against(tail, other, vertices, edges, normal, resolution))

def against_rings(rings: List<&2, B.Ring>, +uses: List<&2, T.Coedge>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +normal: G.Vec3, +resolution: R.Real) -> Bool:
  match rings:
    case Nil{}:
      True{}
    case B.Ring{other} <> tail:
      Bool.and(ring_against(uses, other, vertices, edges, normal, resolution), against_rings(tail, uses, vertices, edges, normal, resolution))

def rings_clear(rings: List<&2, B.Ring>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +normal: G.Vec3, +resolution: R.Real) -> Bool:
  match rings:
    case Nil{}:
      True{}
    case B.Ring{+uses} <> +tail:
      Bool.and(ring_clear(uses, vertices, edges, normal, resolution), Bool.and(against_rings(tail, uses, vertices, edges, normal, resolution), rings_clear(tail, vertices, edges, normal, resolution)))

def loop_rings(loops: List<&2, A.Loop>) -> List<&2, B.Ring>:
  match loops:
    case Nil{}:
      Nil{}
    case A.Loop{_, uses} <> tail:
      B.Ring{uses} <> loop_rings(tail)

def linear_edge(edge: A.Edge) -> Bool:
  match edge:
    case A.Edge{_, _, A.Line{_, _}, _}:
      True{}
    case _:
      False{}

def linear_uses(uses: List<&2, T.Coedge>, +edges: List<&2, A.Edge>) -> Bool:
  match uses:
    case Nil{}:
      True{}
    case T.Use{index, _} <> tail:
      Bool.and(linear_edge(H.edge(List.get(&2, A.Edge, edges, U32.to_nat(index)))), linear_uses(tail, edges))

def linear_loops(loops: List<&2, A.Loop>, +edges: List<&2, A.Edge>) -> Bool:
  match loops:
    case Nil{}:
      True{}
    case A.Loop{_, uses} <> tail:
      Bool.and(linear_uses(uses, edges), linear_loops(tail, edges))

# Projection is only a planar checking witness; no returned/source vertex is
# replaced. Raw representatives may be on opposite sides of the contact band.
def projected(points: List<&2, G.Vec3>, +origin: G.Vec3, +normal: G.Vec3) -> List<&2, G.Vec3>:
  match points:
    case Nil{}:
      Nil{}
    case +point <> tail:
      G.sub(point, G.scale(normal, G.dot(G.sub(point, origin), normal))) <> projected(tail, origin, normal)

def planar_rings(face: A.Face, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, resolution: R.Real) -> Bool:
  match face:
    case A.Face{A.Plane{origin, normal, _}, _, +loops}:
      +unit = G.normalize(normal)
      Bool.or(Bool.not(linear_loops(loops, edges)), rings_clear(loop_rings(loops), projected(vertices, origin, unit), edges, unit, resolution))
    case _:
      True{}

def planar_faces(faces: List<&2, A.Face>, +vertices: List<&2, G.Vec3>, +edges: List<&2, A.Edge>, +resolution: R.Real) -> Bool:
  match faces:
    case Nil{}:
      True{}
    case face <> tail:
      Bool.and(planar_rings(face, vertices, edges, resolution), planar_faces(tail, vertices, edges, resolution))

def owned_uses(uses: List<&2, T.Coedge>, +edge: U32, +forward: Bool) -> U32:
  match uses:
    case Nil{}:
      0
    case T.Use{index, sense} <> tail:
      (Bool.pick(U32, Bool.and(U32.is_eq(index, edge), Bool.pick(Bool, sense, forward, Bool.not(forward))), 1, 0) + owned_uses(tail, edge, forward) : U32)

def owned_loops(loops: List<&2, A.Loop>, +edge: U32, +forward: Bool) -> U32:
  match loops:
    case Nil{}:
      0
    case A.Loop{_, uses} <> tail:
      (owned_uses(uses, edge, forward) + owned_loops(tail, edge, forward) : U32)

def owned_edge(origin: Maybe<&2, P.EdgeOrigin>, forward: Bool, owner: U32, source: A.Face) -> Bool:
  match origin source:
    case Some{P.SourceEdge{index}} A.Face{_, _, loops}:
      U32.is_eq(owned_loops(loops, index, forward), 1)
    case Some{P.CutEdge{face}} _:
      U32.is_eq(face, owner)
    case Some{P.SurfaceSeam{face}} _:
      U32.is_eq(face, owner)
    case _ _:
      False{}

def owned_boundary(uses: List<&2, T.Coedge>, +origins: List<&2, P.EdgeOrigin>, +owner: U32, +source: A.Face) -> Bool:
  match uses:
    case Nil{}:
      True{}
    case T.Use{index, forward} <> tail:
      Bool.and(owned_edge(List.get(&2, P.EdgeOrigin, origins, U32.to_nat(index)), forward, owner, source), owned_boundary(tail, origins, owner, source))

def owned_boundaries(loops: List<&2, A.Loop>, +origins: List<&2, P.EdgeOrigin>, +owner: U32, +source: A.Face) -> Bool:
  match loops:
    case Nil{}:
      True{}
    case A.Loop{_, uses} <> tail:
      Bool.and(owned_boundary(uses, origins, owner, source), owned_boundaries(tail, origins, owner, source))

def owned_face(found: Maybe<&2, A.Face>, face: A.Face, origins: List<&2, P.EdgeOrigin>, owner: U32) -> Bool:
  match found face:
    case Some{source} A.Face{_, _, loops}:
      owned_boundaries(loops, origins, owner, source)
    case _ _:
      False{}

def owned_faces(faces: List<&2, A.Face>, face_origins: List<&2, P.FaceOrigin>, +edge_origins: List<&2, P.EdgeOrigin>, +source: List<&2, A.Face>) -> Bool:
  match faces face_origins:
    case Nil{} Nil{}:
      True{}
    case face <> tail P.SourceFace{+owner} <> rest:
      Bool.and(owned_face(List.get(&2, A.Face, source, U32.to_nat(owner)), face, edge_origins, owner), owned_faces(tail, rest, edge_origins, source))
    case _ _:
      False{}

# Check the ownership omitted by the reusable endpoint-pair lookup, before
# caps can consume any open coedge. Source/cutter supports remain unchanged.
def owned(built: Built, source: List<&2, A.Face>, resolution: R.Real) -> Built:
  Built{O.BuildState{valid, +table, +faces, +origins}, previous} = built
  good = Bool.and(owned_faces(faces, origins, OE.origins(table), source), planar_faces(faces, OE.vertices(table), OE.edges(table), resolution))
  Built{O.BuildState{Bool.and(valid, good), table, faces, origins}, previous}

def cap_valid(result: B.StitchResult, vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>, normal: G.Vec3, resolution: R.Real) -> Bool:
  match result:
    case B.Stitched{rings}:
      rings_clear(rings, vertices, edges, normal, resolution)
    case _:
      False{}

def probe_outside(probe: FP.Probe) -> Bool:
  match probe:
    case FP.ProbeOutside{}:
      True{}
    case _:
      False{}

def same_sign(+a: R.Real, +b: R.Real) -> Bool:
  Bool.or(Bool.and(R.less(zero(), a), R.less(zero(), b)), Bool.and(R.less(a, zero()), R.less(b, zero())))

def nesting_pair(check: Bool, outer: CF.WireInfo, inner: CF.WireInfo, surface: A.Surface, graph: GE.Graph, +policy: S.Policy) -> Bool:
  match check:
    case False{}:
      True{}
    case True{}:
      probe_outside(CF.contains(surface, True{}, outer, inner, graph, S.tolerance(policy), S.budget(policy)))

def nesting_against(infos: List<&2, CF.WireInfo>, +index: U32, +target: U32, +inner: CF.WireInfo, +surface: A.Surface, +graph: GE.Graph, +policy: S.Policy) -> Bool:
  match infos:
    case Nil{}:
      True{}
    case +head <> tail:
      check = Bool.and(Bool.not(U32.is_eq(index, target)), same_sign(CF.area(head), CF.area(inner)))
      Bool.and(nesting_pair(check, head, inner, surface, graph, policy), nesting_against(tail, (index + 1 : U32), target, inner, surface, graph, policy))

# Boundary separation alone does not rule out nested overlapping interiors.
# First-slice policy rejects same-oriented ring containment in either direction:
# no nested positive cap regions, no nested negative holes, and conservatively
# no material island inside another cap face's hole.
def nesting_clear(infos: List<&2, CF.WireInfo>, +all: List<&2, CF.WireInfo>, +index: U32, +surface: A.Surface, +graph: GE.Graph, +policy: S.Policy) -> Bool:
  match infos:
    case Nil{}:
      True{}
    case head <> tail:
      Bool.and(nesting_against(all, 0, index, head, surface, graph, policy), nesting_clear(tail, all, (index + 1 : U32), surface, graph, policy))

def cap_regions(rings: B.StitchResult, +surface: A.Surface, +graph: GE.Graph, policy: S.Policy) -> Bool:
  match rings:
    case B.Stitched{rings}:
      +infos = CF.wire_infos(rings, surface, True{}, graph)
      nesting_clear(infos, infos, 0, surface, graph, policy)
    case _:
      False{}

def cap(built: Built, +origin: G.Vec3, +normal: G.Vec3, +policy: S.Policy, +resolution: R.Real) -> CF.FaceBuild:
  Built{O.BuildState{valid, +table, +faces, origins}, coplanar_kept} = built
  +vertices = OE.vertices(table)
  +edges = OE.edges(table)
  +uses = H.open_uses(edges, faces, 0)
  conflict = Bool.and(coplanar_kept, Bool.not(U32.is_eq(U32.from_nat(List.length(&2, T.Coedge, uses)), 0)))
  +rings = B.stitch(edges, U32.from_nat(List.length(&2, G.Vec3, vertices)), uses)
  +graph = as_graph(table)
  good = Bool.and(valid, Bool.and(Bool.not(conflict), Bool.and(cap_valid(rings, projected(vertices, origin, G.normalize(normal)), edges, G.normalize(normal), R.max(resolution, S.cap(policy))), cap_regions(rings, A.plane(origin, normal), graph, policy))))
  build : CF.FaceBuild = CF.FaceBuild{good, graph, faces, origins}
  CF.stitched(rings, A.plane(origin, normal), True{}, P.CutFace{}, 4294967295, S.tolerance(policy), S.budget(policy), resolution, build)
