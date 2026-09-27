import Base
import ../real.bend as R
import ../precise.bend as G
import ../analytic.bend as A
import ../topology.bend as T
import ../intersections.bend as I
import ../curve-plane.bend as C
import ../face-classification.bend as F
import ../cylinder-classification.bend as K
import ../face-plane.bend as FP
import ../section.bend as Q
import ../boundary.bend as B
import ../halfspace.bend as H
import ./types.bend as P
import ./curved-metrics.bend as M
import ./curved-edges.bend as E

type FaceBuild is Data:
  FaceBuild{valid: Bool, graph: E.Graph, faces: List<&2, A.Face>, origins: List<&2, P.FaceOrigin>}

type WireInfo is Data:
  WireInfo{uses: List<&2, T.Coedge>, area: R.Real, winding: R.Real}

type OwnerCount is Data:
  OwnerCount{valid: Bool, count: U32}

type Holes is Data:
  Holes{valid: Bool, loops: List<&2, A.Loop>}

def zero() -> R.Real:
  R.from_f32(0.0)

def graph(build: FaceBuild) -> E.Graph:
  FaceBuild{_, graph, _, _} = build
  graph

def fail(build: FaceBuild) -> FaceBuild:
  FaceBuild{_, graph, faces, origins} = build
  FaceBuild{False{}, graph, faces, origins}

def append_face(valid: Bool, face: A.Face, origin: P.FaceOrigin, build: FaceBuild) -> FaceBuild:
  FaceBuild{ok, graph, faces, origins} = build
  FaceBuild{Bool.and(ok, valid), graph, List.append(&2, A.Face, faces, [face]), List.append(&2, P.FaceOrigin, origins, [origin])}

def block_ids(found: Maybe<&2, List<&2, U32>>) -> List<&2, U32>:
  match found:
    case Some{values}:
      values
    case None{}:
      Nil{}

def block_uses(indices: List<&2, U32>, +forward: Bool) -> List<&2, T.Coedge>:
  match indices:
    case Nil{}:
      Nil{}
    case head <> tail:
      T.Use{head, forward} <> block_uses(tail, forward)

def source_uses(uses: List<&2, T.Coedge>, +blocks: List<&2, List<&2, U32>>) -> List<&2, T.Coedge>:
  match uses:
    case Nil{}:
      Nil{}
    case T.Use{index, forward} <> tail:
      one = block_uses(block_ids(List.get(&2, List<&2, U32>, blocks, U32.to_nat(index))), forward)
      List.append(&2, T.Coedge, one, source_uses(tail, blocks))

def source_loops(loops: List<&2, A.Loop>, +blocks: List<&2, List<&2, U32>>) -> List<&2, T.Coedge>:
  match loops:
    case Nil{}:
      Nil{}
    case A.Loop{_, uses} <> tail:
      List.append(&2, T.Coedge, source_uses(uses, blocks), source_loops(tail, blocks))

def section_uses(pieces: List<&2, Q.Piece>, +face: U32, +index: U32, +cap: Bool) -> List<&2, T.Coedge>:
  match pieces:
    case Nil{}:
      Nil{}
    case Q.Piece{source, _, _, _, _, Q.Orientation{_, _, _, _, _, _, _, _, +forward}} <> tail:
      +rest = section_uses(tail, face, (index + 1 : U32), cap)
      use : T.Coedge = T.Use{index, Bool.pick(Bool, cap, forward, Bool.not(forward))}
      Bool.pick(List<&2, T.Coedge>, Bool.or(cap, U32.is_eq(face, FP.source_index(source))), use <> rest, rest)

def uses(info: WireInfo) -> List<&2, T.Coedge>:
  WireInfo{values, _, _} = info
  values

def area(info: WireInfo) -> R.Real:
  WireInfo{_, value, _} = info
  value

def winding(info: WireInfo) -> R.Real:
  WireInfo{_, _, value} = info
  value

def wire_infos(rings: List<&2, B.Ring>, +surface: A.Surface, +sense: Bool, +graph: E.Graph) -> List<&2, WireInfo>:
  match rings:
    case Nil{}:
      Nil{}
    case B.Ring{+uses} <> tail:
      a = M.ring_area(surface, sense, uses, E.edges(graph), E.domains(graph), E.vertices(graph))
      w = M.winding(surface, uses, E.edges(graph), E.domains(graph), E.vertices(graph))
      WireInfo{uses, a, w} <> wire_infos(tail, surface, sense, graph)

def project(surface: A.Surface, point: G.Vec3) -> G.Vec3:
  match surface:
    case A.Plane{origin, normal, _}:
      F.project(point, origin, G.normalize(normal))
    case A.Cylinder{origin, axis, _, radius}:
      K.project(point, origin, G.normalize(axis), radius)
    case _:
      point

def ring_point(info: WireInfo, +graph: E.Graph) -> G.Vec3:
  H.vertex(E.vertices(graph), H.first_id(H.ring_vertices(uses(info), E.edges(graph)), 0))

def contains(+surface: A.Surface, sense: Bool, outer: WireInfo, inner: WireInfo, +graph: E.Graph, tolerance: I.Tolerance, budget: R.Real) -> FP.Probe:
  face : A.Face = A.Face{surface, sense, [A.Loop{True{}, uses(outer)}]}
  solid : A.Solid = A.Solid{E.vertices(graph), E.edges(graph), [face]}
  FP.probe_surface(surface, solid, 0, E.domains(graph), project(surface, ring_point(inner, graph)), tolerance, budget)

def count_probe(probe: FP.Probe, count: OwnerCount) -> OwnerCount:
  match probe count:
    case FP.ProbeInside{} OwnerCount{valid, n}:
      OwnerCount{valid, (n + 1 : U32)}
    case FP.ProbeOutside{} OwnerCount{valid, n}:
      OwnerCount{valid, n}
    case _ OwnerCount{_, n}:
      OwnerCount{False{}, n}

def owners(infos: List<&2, WireInfo>, +hole: WireInfo, +surface: A.Surface, +sense: Bool, +graph: E.Graph, +tolerance: I.Tolerance, +budget: R.Real) -> OwnerCount:
  match infos:
    case Nil{}:
      OwnerCount{True{}, 0}
    case +head <> tail:
      +rest = owners(tail, hole, surface, sense, graph, tolerance, budget)
      Bool.pick(OwnerCount, R.less(zero(), area(head)), count_probe(contains(surface, sense, head, hole, graph, tolerance, budget), rest), rest)

def unique_owner(count: OwnerCount) -> Bool:
  OwnerCount{valid, n} = count
  Bool.and(valid, U32.is_eq(n, 1))

def holes_valid(infos: List<&2, WireInfo>, +all: List<&2, WireInfo>, +surface: A.Surface, +sense: Bool, +graph: E.Graph, +tolerance: I.Tolerance, +budget: R.Real, +resolution: R.Real) -> Bool:
  match infos:
    case Nil{}:
      True{}
    case +head <> tail:
      significant = R.less(R.mul(resolution, resolution), R.abs(area(head)))
      hole_ok = Bool.or(R.less(zero(), area(head)), unique_owner(owners(all, head, surface, sense, graph, tolerance, budget)))
      Bool.and(significant, Bool.and(hole_ok, holes_valid(tail, all, surface, sense, graph, tolerance, budget, resolution)))

def add_hole(probe: FP.Probe, uses: List<&2, T.Coedge>, rest: Holes) -> Holes:
  match probe rest:
    case FP.ProbeInside{} Holes{valid, loops}:
      Holes{valid, A.Loop{False{}, uses} <> loops}
    case FP.ProbeOutside{} Holes{valid, loops}:
      Holes{valid, loops}
    case _ Holes{_, loops}:
      Holes{False{}, loops}

def select_holes(infos: List<&2, WireInfo>, +outer: WireInfo, +surface: A.Surface, +sense: Bool, +graph: E.Graph, +tolerance: I.Tolerance, +budget: R.Real) -> Holes:
  match infos:
    case Nil{}:
      Holes{True{}, Nil{}}
    case +head <> tail:
      +rest = select_holes(tail, outer, surface, sense, graph, tolerance, budget)
      Bool.pick(Holes, R.less(area(head), zero()), add_hole(contains(surface, sense, outer, head, graph, tolerance, budget), uses(head), rest), rest)

def area_face(holes: Holes, outer: WireInfo, surface: A.Surface, sense: Bool, origin: P.FaceOrigin, build: FaceBuild) -> FaceBuild:
  Holes{valid, loops} = holes
  append_face(valid, A.Face{surface, sense, A.Loop{True{}, uses(outer)} <> loops}, origin, build)

def area_faces(infos: List<&2, WireInfo>, +all: List<&2, WireInfo>, +surface: A.Surface, +sense: Bool, +origin: P.FaceOrigin, +tolerance: I.Tolerance, +budget: R.Real, +build: FaceBuild) -> FaceBuild:
  match infos:
    case Nil{}:
      build
    case +head <> tail:
      next = Bool.pick(FaceBuild, R.less(zero(), area(head)), area_face(select_holes(all, head, surface, sense, graph(build), tolerance, budget), head, surface, sense, origin, build), build)
      area_faces(tail, all, surface, sense, origin, tolerance, budget, next)

def ordinary_checked(valid: Bool, +infos: List<&2, WireInfo>, surface: A.Surface, sense: Bool, origin: P.FaceOrigin, tolerance: I.Tolerance, budget: R.Real, build: FaceBuild) -> FaceBuild:
  match valid:
    case False{}:
      fail(build)
    case True{}:
      area_faces(infos, infos, surface, sense, origin, tolerance, budget, build)

def winding_guard(surface: A.Surface, count: U32, +budget: R.Real, resolution: R.Real, angular: R.Real) -> R.Real:
  match surface:
    case A.Cylinder{_, _, _, radius}:
      R.add(angular, R.mul(R.div(R.mul(R.from_f32(2.0), R.add(budget, resolution)), radius), R.from_f32(U32.to_f32(count))))
    case _:
      angular

def has_winding(infos: List<&2, WireInfo>, +surface: A.Surface, +budget: R.Real, +resolution: R.Real, +angular: R.Real) -> Bool:
  match infos:
    case Nil{}:
      False{}
    case +head <> tail:
      count = U32.from_nat(List.length(&2, T.Coedge, uses(head)))
      Bool.or(R.less(winding_guard(surface, count, budget, resolution, angular), R.abs(winding(head))), has_winding(tail, surface, budget, resolution, angular))

def full_domain(domain: C.Domain, edge: A.Edge) -> Bool:
  match domain edge:
    case C.Untrimmed{} A.Edge{a, b, _, _}:
      U32.is_eq(a, b)
    case _ _:
      False{}

def full_edge(use: T.Coedge, +graph: E.Graph) -> Bool:
  T.Use{+index, _} = use
  +edge = H.edge(List.get(&2, A.Edge, E.edges(graph), U32.to_nat(index)))
  full_domain(M.edge_domain(edge, index, E.domains(graph), E.vertices(graph)), edge)

def full_ring(uses: List<&2, T.Coedge>, graph: E.Graph) -> Bool:
  match uses:
    case use <> Nil{}:
      full_edge(use, graph)
    case _:
      False{}

def band_face(allowed: Bool, a: WireInfo, b: WireInfo, surface: A.Surface, sense: Bool, origin: P.FaceOrigin, face: U32, build: FaceBuild) -> FaceBuild:
  match allowed:
    case False{}:
      fail(build)
    case True{}:
      FaceBuild{valid, +graph, faces, origins} = build
      +ua = uses(a)
      +ub = uses(b)
      +va = H.first_id(H.ring_vertices(ua, E.edges(graph)), 0)
      +vb = H.first_id(H.ring_vertices(ub, E.edges(graph)), 0)
      +pa = H.vertex(E.vertices(graph), va)
      +delta = G.sub(H.vertex(E.vertices(graph), vb), pa)
      +index = U32.from_nat(List.length(&2, A.Edge, E.edges(graph)))
      edge : A.Edge = A.Edge{va, vb, A.Line{pa, G.normalize(delta)}, True{}}
      boundary = List.append(&2, T.Coedge, ua, T.Use{index, True{}} <> List.append(&2, T.Coedge, ub, [T.Use{index, False{}}]))
      next = E.append(edge, C.Interval{zero(), I.length(delta)}, P.SurfaceSeam{face}, graph)
      append_face(True{}, A.Face{surface, sense, [A.Loop{True{}, boundary}]}, origin, FaceBuild{valid, next, faces, origins})

def bands(infos: List<&2, WireInfo>, +surface: A.Surface, sense: Bool, origin: P.FaceOrigin, face: U32, resolution: R.Real, budget: R.Real, angular: R.Real, +build: FaceBuild) -> FaceBuild:
  match infos:
    case +a <> +b <> Nil{}:
      +guard = winding_guard(surface, 2, budget, resolution, angular)
      winding_ok = Bool.and(I.at_most(R.abs(R.sub(R.abs(winding(a)), C.tau())), guard), I.at_most(R.abs(R.add(winding(a), winding(b))), guard))
      full = Bool.and(full_ring(uses(a), graph(build)), full_ring(uses(b), graph(build)))
      band_face(Bool.and(winding_ok, full), a, b, surface, sense, origin, face, build)
    case _:
      fail(build)

def choose_areas(winding: Bool, ordinary: Bool, infos: List<&2, WireInfo>, surface: A.Surface, sense: Bool, origin: P.FaceOrigin, face: U32, +tolerance: I.Tolerance, budget: R.Real, resolution: R.Real, build: FaceBuild) -> FaceBuild:
  match winding:
    case True{}:
      bands(infos, surface, sense, origin, face, resolution, budget, I.tolerance_angular(tolerance), build)
    case False{}:
      ordinary_checked(ordinary, infos, surface, sense, origin, tolerance, budget, build)

def areas(+infos: List<&2, WireInfo>, +surface: A.Surface, +sense: Bool, origin: P.FaceOrigin, face: U32, +tolerance: I.Tolerance, +budget: R.Real, +resolution: R.Real, +build: FaceBuild) -> FaceBuild:
  winding = has_winding(infos, surface, budget, resolution, I.tolerance_angular(tolerance))
  ordinary = holes_valid(infos, infos, surface, sense, graph(build), tolerance, budget, resolution)
  choose_areas(winding, ordinary, infos, surface, sense, origin, face, tolerance, budget, resolution, build)

def stitched(rings: B.StitchResult, +surface: A.Surface, +sense: Bool, origin: P.FaceOrigin, face: U32, tolerance: I.Tolerance, budget: R.Real, resolution: R.Real, +build: FaceBuild) -> FaceBuild:
  match rings:
    case B.Rejected{_}:
      fail(build)
    case B.Stitched{rings}:
      areas(wire_infos(rings, surface, sense, graph(build)), surface, sense, origin, face, tolerance, budget, resolution, build)

def build_face(face: A.Face, +index: U32, pieces: List<&2, Q.Piece>, section_offset: U32, tolerance: I.Tolerance, budget: R.Real, resolution: R.Real, +build: FaceBuild) -> FaceBuild:
  A.Face{surface, sense, loops} = face
  +g = graph(build)
  uses = List.append(&2, T.Coedge, source_loops(loops, E.blocks(g)), section_uses(pieces, index, section_offset, False{}))
  rings = B.stitch(E.edges(g), U32.from_nat(List.length(&2, G.Vec3, E.vertices(g))), uses)
  stitched(rings, surface, sense, P.SourceFace{index}, index, tolerance, budget, resolution, build)

def build_faces(faces: List<&2, A.Face>, +index: U32, +pieces: List<&2, Q.Piece>, +section_offset: U32, +tolerance: I.Tolerance, +budget: R.Real, +resolution: R.Real, build: FaceBuild) -> FaceBuild:
  match faces:
    case Nil{}:
      build
    case head <> tail:
      build_faces(tail, (index + 1 : U32), pieces, section_offset, tolerance, budget, resolution, build_face(head, index, pieces, section_offset, tolerance, budget, resolution, build))

def cap(pieces: List<&2, Q.Piece>, section_offset: U32, origin: G.Vec3, normal: G.Vec3, tolerance: I.Tolerance, budget: R.Real, resolution: R.Real, +build: FaceBuild) -> FaceBuild:
  +g = graph(build)
  rings = B.stitch(E.edges(g), U32.from_nat(List.length(&2, G.Vec3, E.vertices(g))), section_uses(pieces, 0, section_offset, True{}))
  stitched(rings, A.plane(origin, normal), True{}, P.CutFace{}, 4294967295, tolerance, budget, resolution, build)
