import Base
import ../precise.bend as G
import ../analytic.bend as A
import ../topology.bend as T
import ../halfspace.bend as H

# A vertex link uses edge ENDS, not edge IDs: a periodic edge has two
# distinct ends even when its source start/end vertex IDs are equal.
type Arc is Data:
  Arc{vertex: U32, first: U32, last: U32, valid: Bool}

type Step is Data:
  Step{count: U32, next: U32, rest: List<&2, Arc>}

def corner(incoming: T.Coedge, outgoing: T.Coedge, +edges: List<&2, A.Edge>) -> Arc:
  T.Use{+a, +af} = incoming
  T.Use{+b, +bf} = outgoing
  +vertex = H.oriented_start(H.edge(List.get(&2, A.Edge, edges, U32.to_nat(a))), Bool.not(af))
  other = H.oriented_start(H.edge(List.get(&2, A.Edge, edges, U32.to_nat(b))), bf)
  Arc{vertex, (2 * a + Bool.pick(U32, af, 1, 0) : U32), (2 * b + Bool.pick(U32, bf, 0, 1) : U32), U32.is_eq(vertex, other)}

def corners(uses: List<&2, T.Coedge>, +first: T.Coedge, +edges: List<&2, A.Edge>) -> List<&2, Arc>:
  match uses:
    case Nil{}:
      Nil{}
    case use <> Nil{}:
      [corner(use, first, edges)]
    case use <> +next <> tail:
      corner(use, next, edges) <> corners(next <> tail, first, edges)

def loops(remaining: List<&2, A.Loop>, +edges: List<&2, A.Edge>) -> List<&2, Arc>:
  match remaining:
    case Nil{}:
      Nil{}
    case A.Loop{_, +first <> tail} <> rest:
      List.append(&2, Arc, corners(first <> tail, first, edges), loops(rest, edges))
    case _ <> rest:
      Arc{0, 0, 0, False{}} <> loops(rest, edges)

def faces(remaining: List<&2, A.Face>, +edges: List<&2, A.Edge>) -> List<&2, Arc>:
  match remaining:
    case Nil{}:
      Nil{}
    case A.Face{_, _, boundary} <> tail:
      List.append(&2, Arc, loops(boundary, edges), faces(tail, edges))

def at_vertex(arcs: List<&2, Arc>, +vertex: U32) -> List<&2, Arc>:
  match arcs:
    case Nil{}:
      Nil{}
    case +arc <> tail:
      Arc{index, _, _, _} = arc
      +rest = at_vertex(tail, vertex)
      Bool.pick(List<&2, Arc>, U32.is_eq(index, vertex), arc <> rest, rest)

def taken(matches: Bool, arc: Arc, step: Step) -> Step:
  match matches arc step:
    case True{} Arc{_, _, next, _} Step{count, _, rest}:
      Step{(count + 1 : U32), next, rest}
    case False{} _ Step{count, next, rest}:
      Step{count, next, arc <> rest}

def take(arcs: List<&2, Arc>, +current: U32) -> Step:
  match arcs:
    case Nil{}:
      Step{0, 0, Nil{}}
    case +arc <> tail:
      Arc{_, first, _, _} = arc
      taken(U32.is_eq(first, current), arc, take(tail, current))

def walk(fuel: Nat, step: Step, +target: U32) -> Bool:
  match fuel step:
    case _ Step{1, next, Nil{}}:
      U32.is_eq(next, target)
    case 0n _:
      False{}
    case 1n+left Step{1, +next, rest}:
      Bool.and(Bool.not(U32.is_eq(next, target)), walk(left, take(rest, next), target))
    case _ _:
      False{}

def cycle(arcs: List<&2, Arc>) -> Bool:
  match arcs:
    case Arc{_, first, last, _} <> +tail:
      walk(List.length(&2, Arc, tail), Step{1, last, tail}, first)
    case Nil{}:
      False{}

def corners_valid(arcs: List<&2, Arc>) -> Bool:
  match arcs:
    case Nil{}:
      True{}
    case Arc{_, _, _, valid} <> tail:
      Bool.and(valid, corners_valid(tail))

def vertices(points: List<&2, G.Vec3>, +arcs: List<&2, Arc>, +index: U32) -> Bool:
  match points:
    case Nil{}:
      True{}
    case _ <> tail:
      Bool.and(cycle(at_vertex(arcs, index)), vertices(tail, arcs, (index + 1 : U32)))

def valid(solid: A.Solid) -> Bool:
  A.Solid{points, edges, boundary} = solid
  +arcs = faces(boundary, edges)
  Bool.and(corners_valid(arcs), vertices(points, arcs, 0))
