import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../topology.bend as T
import ../intersections.bend as I
import ../curve-plane.bend as C
import ../edge-plane.bend as E
import ../face-classification.bend as F
import ../face-plane.bend as FP
import ../section.bend as Q
import ../solid-classification.bend as S
import ../halfspace.bend as H
import ./types.bend as P
import ./curved-metrics.bend as M

# Shared analytic edge events. Root identity is the native edge+parameter key
# checked by section; there is no proximity merge or root recomputation.
type Graph is Data:
  Graph{valid: Bool, vertices: List<&2, G.Vec3>, edges: List<&2, A.Edge>, domains: List<&2, F.DomainChoice>, origins: List<&2, P.EdgeOrigin>, blocks: List<&2, List<&2, U32>>, roots: List<&2, U32>}

type RootBuild is Data:
  RootBuild{vertices: List<&2, G.Vec3>, roots: List<&2, U32>}

type Pave is Data:
  Pave{parameter: R.Real, vertex: U32}

type Paves is Data:
  Paves{valid: Bool, points: List<&2, Pave>}

type EdgeBuild is Data:
  EdgeBuild{graph: Graph, indices: List<&2, U32>}

def zero() -> R.Real:
  R.from_f32(0.0)

def vertices(graph: Graph) -> List<&2, G.Vec3>:
  Graph{_, values, _, _, _, _, _} = graph
  values

def edges(graph: Graph) -> List<&2, A.Edge>:
  Graph{_, _, values, _, _, _, _} = graph
  values

def domains(graph: Graph) -> List<&2, F.DomainChoice>:
  Graph{_, _, _, values, _, _, _} = graph
  values

def origins(graph: Graph) -> List<&2, P.EdgeOrigin>:
  Graph{_, _, _, _, values, _, _} = graph
  values

def blocks(graph: Graph) -> List<&2, List<&2, U32>>:
  Graph{_, _, _, _, _, values, _} = graph
  values

def roots(graph: Graph) -> List<&2, U32>:
  Graph{_, _, _, _, _, _, values} = graph
  values

def failed(graph: Graph) -> Graph:
  Graph{_, vertices, edges, domains, origins, blocks, roots} = graph
  Graph{False{}, vertices, edges, domains, origins, blocks, roots}

def append(edge: A.Edge, domain: C.Domain, origin: P.EdgeOrigin, graph: Graph) -> Graph:
  Graph{valid, vertices, edges, domains, origins, blocks, roots} = graph
  Graph{valid, vertices, List.append(&2, A.Edge, edges, [edge]), List.append(&2, F.DomainChoice, domains, [F.GivenDomain{domain}]),
    List.append(&2, P.EdgeOrigin, origins, [origin]), blocks, roots}

def append_blocks(indices: List<&2, U32>, graph: Graph) -> Graph:
  Graph{valid, vertices, edges, domains, origins, blocks, roots} = graph
  Graph{valid, vertices, edges, domains, origins, List.append(&2, List<&2, U32>, blocks, [indices]), roots}

def id(found: Maybe<&2, U32>) -> U32:
  match found:
    case Some{value}:
      value
    case None{}:
      4294967295

def mapped(graph: Graph, root: U32) -> U32:
  id(List.get(&2, U32, roots(graph), U32.to_nat(root)))

def is_seam(faces: List<&2, A.Face>, +edge: U32) -> Bool:
  match faces:
    case Nil{}:
      False{}
    case A.Face{A.Cylinder{_, _, _, _}, _, loops} <> tail:
      Bool.or(S.pair_valid(S.count_loops(loops, edge)), is_seam(tail, edge))
    case _ <> tail:
      is_seam(tail, edge)

def first_kept_vertex(uses: List<&2, T.Coedge>, +edges: List<&2, A.Edge>, +vertices: List<&2, G.Vec3>, +origin: G.Vec3, +normal: G.Vec3, +margin: R.Real) -> Maybe<&2, G.Vec3>:
  match uses:
    case Nil{}:
      None{}
    case use <> tail:
      +point = H.vertex(vertices, H.use_start(use, edges))
      inside = U32.is_eq(H.side_kind(H.side(point, origin, normal, margin)), 1)
      Bool.pick(Maybe<&2, G.Vec3>, inside, Some{point}, first_kept_vertex(tail, edges, vertices, origin, normal, margin))

def first_some(a: Maybe<&2, G.Vec3>, b: Maybe<&2, G.Vec3>) -> Maybe<&2, G.Vec3>:
  match a:
    case Some{value}:
      Some{value}
    case None{}:
      b

def kept_vertex(loops: List<&2, A.Loop>, +edges: List<&2, A.Edge>, +vertices: List<&2, G.Vec3>, +origin: G.Vec3, +normal: G.Vec3, +margin: R.Real) -> Maybe<&2, G.Vec3>:
  match loops:
    case Nil{}:
      None{}
    case A.Loop{_, uses} <> tail:
      first_some(first_kept_vertex(uses, edges, vertices, origin, normal, margin), kept_vertex(tail, edges, vertices, origin, normal, margin))

def seam_point(base: Maybe<&2, G.Vec3>, axis: G.Vec3, origin: G.Vec3, +normal: G.Vec3, fallback: G.Vec3) -> G.Vec3:
  match base:
    case None{}:
      fallback
    case Some{+point}:
      +unit = G.normalize(axis)
      G.add(point, G.scale(unit, R.div(G.dot(normal, G.sub(origin, point)), G.dot(normal, unit))))

def synthetic_point(face: Maybe<&2, A.Face>, +solid: A.Solid, +origin: G.Vec3, +normal: G.Vec3, margin: R.Real, fallback: G.Vec3) -> G.Vec3:
  match face:
    case Some{A.Face{A.Cylinder{_, axis, _, _}, _, loops}}:
      A.Solid{vertices, edges, _} = solid
      seam_point(kept_vertex(loops, edges, vertices, origin, normal, margin), axis, origin, normal, fallback)
    case _:
      fallback

def root_existing(location: E.Location) -> Maybe<&2, U32>:
  match location:
    case E.Interior{}:
      None{}
    case E.StartVertex{index, _, _}:
      Some{index}
    case E.EndVertex{index, _, _}:
      Some{index}
    case E.SeamVertex{index, _, _}:
      Some{index}

def add_root(existing: Maybe<&2, U32>, point: G.Vec3, build: RootBuild) -> RootBuild:
  match existing build:
    case Some{index} RootBuild{vertices, roots}:
      RootBuild{vertices, List.append(&2, U32, roots, [index])}
    case None{} RootBuild{+vertices, roots}:
      index = U32.from_nat(List.length(&2, G.Vec3, vertices))
      RootBuild{List.append(&2, G.Vec3, vertices, [point]), List.append(&2, U32, roots, [index])}

def build_root(root: Q.Root, +solid: A.Solid, origin: G.Vec3, normal: G.Vec3, margin: R.Real, build: RootBuild) -> RootBuild:
  match root:
    case Q.SourceRoot{_, E.Hit{_, point, _, location}, _}:
      add_root(root_existing(location), point, build)
    case Q.SyntheticSeam{face, _, _, point}:
      A.Solid{_, _, faces} = solid
      add_root(None{}, synthetic_point(List.get(&2, A.Face, faces, U32.to_nat(face)), solid, origin, normal, margin, point), build)

def build_roots(roots: List<&2, Q.Root>, +solid: A.Solid, +origin: G.Vec3, +normal: G.Vec3, +margin: R.Real, build: RootBuild) -> RootBuild:
  match roots:
    case Nil{}:
      build
    case head <> tail:
      build_roots(tail, solid, origin, normal, margin, build_root(head, solid, origin, normal, margin, build))

def graph_roots(build: RootBuild) -> Graph:
  RootBuild{vertices, roots} = build
  Graph{True{}, vertices, Nil{}, Nil{}, Nil{}, Nil{}, roots}

def init(+roots: List<&2, Q.Root>, +solid: A.Solid, origin: G.Vec3, normal: G.Vec3, margin: R.Real) -> Graph:
  A.Solid{vertices, _, _} = solid
  graph_roots(build_roots(roots, solid, origin, normal, margin, RootBuild{vertices, Nil{}}))

def parameter(pave: Pave) -> R.Real:
  Pave{value, _} = pave
  value

def insert(+pave: Pave, points: List<&2, Pave>) -> List<&2, Pave>:
  match points:
    case Nil{}:
      [pave]
    case +head <> +tail:
      Bool.pick(List<&2, Pave>, R.less(parameter(pave), parameter(head)), pave <> head <> tail, head <> insert(pave, tail))

def hit_pave(found: Q.RootLookup, parameter: R.Real, +first_id: U32, +last_id: U32, graph: Graph, rest: Paves) -> Paves:
  match found rest:
    case Q.FoundRoot{root} Paves{valid, +points}:
      +index = mapped(graph, root)
      endpoint = Bool.or(U32.is_eq(index, first_id), U32.is_eq(index, last_id))
      Paves{valid, Bool.pick(List<&2, Pave>, endpoint, points, insert(Pave{parameter, index}, points))}
    case _ Paves{_, points}:
      Paves{False{}, points}

def hit_paves(hits: List<&2, E.EdgeHit>, +edge: U32, +roots: List<&2, Q.Root>, +graph: Graph, +periodic: Bool, +first: R.Real, +last: R.Real, +first_id: U32, +last_id: U32, paves: Paves) -> Paves:
  match hits:
    case Nil{}:
      paves
    case +hit <> tail:
      E.Hit{parameter, _, _, _} = hit
      lifted = C.lift_parameter(periodic, parameter, first, last)
      found = Q.find_root(roots, edge, hit, 0)
      hit_paves(tail, edge, roots, graph, periodic, first, last, first_id, last_id, hit_pave(found, lifted, first_id, last_id, graph, paves))

def append_block(edge: A.Edge, domain: C.Domain, index: U32, build: EdgeBuild) -> EdgeBuild:
  EdgeBuild{+graph, indices} = build
  out = U32.from_nat(List.length(&2, A.Edge, edges(graph)))
  EdgeBuild{append(edge, domain, P.SourceEdge{index}, graph), List.append(&2, U32, indices, [out])}

def span_checked(side: H.Side, edge: A.Edge, domain: C.Domain, index: U32, build: EdgeBuild) -> EdgeBuild:
  match side:
    case H.Side{1, _}:
      append_block(edge, domain, index, build)
    case H.Side{2, _}:
      build
    case _:
      EdgeBuild{graph, indices} = build
      EdgeBuild{failed(graph), indices}

def span_piece(first: Pave, last: Pave, +curve: A.Curve, +sense: Bool, index: U32, origin: G.Vec3, normal: G.Vec3, margin: R.Real, build: EdgeBuild) -> EdgeBuild:
  Pave{+lo, +a} = first
  Pave{+hi, +b} = last
  midpoint = A.curve_point(curve, R.mul(R.add(lo, hi), R.from_f32(0.5)))
  edge : A.Edge = A.Edge{Bool.pick(U32, sense, a, b), Bool.pick(U32, sense, b, a), curve, sense}
  span_checked(H.side(midpoint, origin, normal, margin), edge, C.Interval{lo, hi}, index, build)

def spans(points: List<&2, Pave>, +curve: A.Curve, +sense: Bool, +index: U32, +origin: G.Vec3, +normal: G.Vec3, +margin: R.Real, build: EdgeBuild) -> EdgeBuild:
  match points:
    case a <> +b <> tail:
      spans(b <> tail, curve, sense, index, origin, normal, margin, span_piece(a, b, curve, sense, index, origin, normal, margin, build))
    case _:
      build

def split_paves(paves: Paves, curve: A.Curve, sense: Bool, index: U32, origin: G.Vec3, normal: G.Vec3, margin: R.Real, graph: Graph) -> EdgeBuild:
  match paves:
    case Paves{False{}, _}:
      EdgeBuild{failed(graph), Nil{}}
    case Paves{True{}, points}:
      spans(points, curve, sense, index, origin, normal, margin, EdgeBuild{graph, Nil{}})

def interval_split(+edge: A.Edge, +index: U32, +lo: R.Real, +hi: R.Real, hits: List<&2, E.EdgeHit>, roots: List<&2, Q.Root>, +graph: Graph, origin: G.Vec3, normal: G.Vec3, margin: R.Real) -> EdgeBuild:
  A.Edge{+start, +end, +curve, +sense} = edge
  +a = Bool.pick(U32, sense, start, end)
  +b = Bool.pick(U32, sense, end, start)
  paves = hit_paves(hits, index, roots, graph, C.curve_periodic(curve), lo, hi, a, b, Paves{True{}, [Pave{lo, a}, Pave{hi, b}]})
  split_paves(paves, curve, sense, index, origin, normal, margin, graph)

def edge_split(+source: E.EdgeSource, hits: List<&2, E.EdgeHit>, roots: List<&2, Q.Root>, graph: Graph, origin: G.Vec3, normal: G.Vec3, margin: R.Real) -> EdgeBuild:
  E.EdgeSource{index, +edge, domain, start, _, _, _, _} = source
  match domain:
    case C.Interval{lo, hi}:
      interval_split(edge, index, lo, hi, hits, roots, graph, origin, normal, margin)
    case C.Untrimmed{}:
      +lo = C.canonical(A.curve_parameter(E.source_curve(source), start))
      interval_split(edge, index, lo, R.add(lo, C.tau()), hits, roots, graph, origin, normal, margin)

def edge_unchanged(+source: E.EdgeSource, graph: Graph, origin: G.Vec3, normal: G.Vec3, margin: R.Real) -> EdgeBuild:
  E.EdgeSource{index, +edge, +domain, _, _, _, _, _} = source
  point = A.curve_point(E.source_curve(source), Q.sample_parameter(domain))
  span_checked(H.side(point, origin, normal, margin), edge, domain, index, EdgeBuild{graph, Nil{}})

def split_result(result: E.EdgePlaneResult, roots: List<&2, Q.Root>, graph: Graph, origin: G.Vec3, normal: G.Vec3, margin: R.Real) -> EdgeBuild:
  match result:
    case E.Resolved{C.Disjoint{}, Nil{}, source, _, _}:
      edge_unchanged(source, graph, origin, normal, margin)
    case E.Resolved{C.Crossing{}, hits, source, _, _}:
      edge_split(source, hits, roots, graph, origin, normal, margin)
    case _:
      EdgeBuild{failed(graph), Nil{}}

def finish_edge(build: EdgeBuild) -> Graph:
  EdgeBuild{graph, indices} = build
  append_blocks(indices, graph)

def split_one(seam: Bool, solid: A.Solid, index: U32, domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, tolerance: I.Tolerance, budget: R.Real, roots: List<&2, Q.Root>, graph: Graph, margin: R.Real) -> Graph:
  match seam:
    case True{}:
      append_blocks(Nil{}, graph)
    case False{}:
      finish_edge(split_result(E.intersect(solid, index, domains, origin, normal, tolerance, budget), roots, graph, origin, normal, margin))

def split_all(edges: List<&2, A.Edge>, +faces: List<&2, A.Face>, +index: U32, +solid: A.Solid, +domains: List<&2, F.DomainChoice>, +origin: G.Vec3, +normal: G.Vec3, +tolerance: I.Tolerance, +budget: R.Real, +roots: List<&2, Q.Root>, +margin: R.Real, graph: Graph) -> Graph:
  match edges:
    case Nil{}:
      graph
    case _ <> tail:
      split_all(tail, faces, (index + 1 : U32), solid, domains, origin, normal, tolerance, budget, roots, margin,
        split_one(is_seam(faces, index), solid, index, domains, origin, normal, tolerance, budget, roots, graph, margin))

def add_sections(pieces: List<&2, Q.Piece>, +graph: Graph) -> Graph:
  match pieces:
    case Nil{}:
      graph
    case Q.Piece{source, _, FP.Section{_, curve, domain, _, _}, Q.EndpointRef{first, _}, Q.EndpointRef{last, _}, _} <> tail:
      edge : A.Edge = A.Edge{mapped(graph, first), mapped(graph, last), curve, True{}}
      add_sections(tail, append(edge, domain, P.CutEdge{FP.source_index(source)}, graph))
