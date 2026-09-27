import Base
import ./analytic.bend as A
import ./topology.bend as T

# Stitch directed boundary uses by explicit vertex identity. No distances,
# sorting by angle, nearest-neighbour guesses or coordinate welding occur.
type Arc is Data:
  Arc{use: T.Coedge, start: U32, end: U32}

type Ring is Data:
  Ring{uses: List<&2, T.Coedge>}

type Reason is Data:
  InvalidEdge{edge: U32}
  InvalidVertex{vertex: U32}
  OpenBoundary{vertex: U32}
  BranchBoundary{vertex: U32}
  WalkLimit{}

type Preparation is Data:
  Prepared{arcs: List<&2, Arc>}
  BadPreparation{reason: Reason}

type StitchResult is Data:
  Stitched{rings: List<&2, Ring>}
  Rejected{reason: Reason}

type Take is Data:
  Taken{arc: Arc, rest: List<&2, Arc>}
  Missing{}

type Walk is Data:
  Walked{uses: List<&2, T.Coedge>, rest: List<&2, Arc>}
  BadWalk{reason: Reason}

def prepend_arc(prepared: Preparation, arc: Arc) -> Preparation:
  match prepared:
    case Prepared{arcs}:
      Prepared{arc <> arcs}
    case BadPreparation{reason}:
      BadPreparation{reason}

def endpoints_valid(first_ok: Bool, last_ok: Bool, +start: U32, +end: U32, use: T.Coedge, rest: Preparation) -> Preparation:
  match first_ok last_ok:
    case False{} _:
      BadPreparation{InvalidVertex{start}}
    case _ False{}:
      BadPreparation{InvalidVertex{end}}
    case True{} True{}:
      T.Use{_, +forward} = use
      prepend_arc(rest, Arc{use, Bool.pick(U32, forward, start, end), Bool.pick(U32, forward, end, start)})

def prepare_edge(found: Maybe<&2, A.Edge>, +use: T.Coedge, +vertex_count: U32, rest: Preparation) -> Preparation:
  match found:
    case None{}:
      T.Use{index, _} = use
      BadPreparation{InvalidEdge{index}}
    case Some{A.Edge{+start, +end, _, _}}:
      endpoints_valid(U32.is_lt(start, vertex_count), U32.is_lt(end, vertex_count), start, end, use, rest)

def prepare(uses: List<&2, T.Coedge>, +edges: List<&2, A.Edge>, +vertex_count: U32) -> Preparation:
  match uses:
    case Nil{}:
      Prepared{Nil{}}
    case +use <> tail:
      T.Use{index, _} = use
      prepare_edge(List.get(&2, A.Edge, edges, U32.to_nat(index)), use, vertex_count, prepare(tail, edges, vertex_count))

def count(arcs: List<&2, Arc>, +vertex: U32, +outgoing: Bool) -> U32:
  match arcs:
    case Nil{}:
      0
    case Arc{_, start, end} <> tail:
      here = U32.is_eq(vertex, Bool.pick(U32, outgoing, start, end))
      (Bool.pick(U32, here, 1, 0) + count(tail, vertex, outgoing) : U32)

def degree(+incoming: U32, +outgoing: U32, +vertex: U32, rest: Maybe<&2, Reason>) -> Maybe<&2, Reason>:
  Bool.pick(Maybe<&2, Reason>, Bool.or(U32.is_eq(incoming, 0), U32.is_eq(outgoing, 0)), Some{OpenBoundary{vertex}},
    Bool.pick(Maybe<&2, Reason>, Bool.and(U32.is_eq(incoming, 1), U32.is_eq(outgoing, 1)), rest, Some{BranchBoundary{vertex}}))

def degrees(left: List<&2, Arc>, +all: List<&2, Arc>) -> Maybe<&2, Reason>:
  match left:
    case Nil{}:
      None{}
    case Arc{_, +start, +end} <> tail:
      degree(count(all, start, False{}), count(all, start, True{}), start,
        degree(count(all, end, False{}), count(all, end, True{}), end, degrees(tail, all)))

def put_back(taken: Take, arc: Arc) -> Take:
  match taken:
    case Missing{}:
      Missing{}
    case Taken{found, rest}:
      Taken{found, arc <> rest}

def take(arcs: List<&2, Arc>, +vertex: U32) -> Take:
  match arcs:
    case Nil{}:
      Missing{}
    case +head <> +tail:
      Arc{_, start, _} = head
      Bool.pick(Take, U32.is_eq(start, vertex), Taken{head, tail}, put_back(take(tail, vertex), head))

def walked_prepend(result: Walk, use: T.Coedge) -> Walk:
  match result:
    case BadWalk{reason}:
      BadWalk{reason}
    case Walked{uses, rest}:
      Walked{use <> uses, rest}

def taken_end(taken: Take) -> U32:
  match taken:
    case Missing{}:
      0
    case Taken{Arc{_, _, end}, _}:
      end

def taken_rest(taken: Take) -> List<&2, Arc>:
  match taken:
    case Missing{}:
      Nil{}
    case Taken{_, rest}:
      rest

def continue_taken(taken: Take, result: Walk, vertex: U32) -> Walk:
  match taken:
    case Missing{}:
      BadWalk{OpenBoundary{vertex}}
    case Taken{Arc{use, _, _}, _}:
      walked_prepend(result, use)

def walk(fuel: Nat, +arcs: List<&2, Arc>, +first: U32, +vertex: U32) -> Walk:
  match fuel:
    case 0n:
      Bool.pick(Walk, U32.is_eq(first, vertex), Walked{Nil{}, arcs}, BadWalk{WalkLimit{}})
    case 1n+left:
      +taken = take(arcs, vertex)
      result = walk(left, taken_rest(taken), first, taken_end(taken))
      Bool.pick(Walk, U32.is_eq(first, vertex), Walked{Nil{}, arcs}, continue_taken(taken, result, vertex))

def ring_prepend(result: StitchResult, uses: List<&2, T.Coedge>) -> StitchResult:
  match result:
    case Rejected{reason}:
      Rejected{reason}
    case Stitched{rings}:
      Stitched{Ring{uses} <> rings}

def walk_rest(result: Walk) -> List<&2, Arc>:
  match result:
    case BadWalk{_}:
      Nil{}
    case Walked{_, rest}:
      rest

def ring_walk(result: Walk, first: T.Coedge, next: StitchResult) -> StitchResult:
  match result:
    case BadWalk{reason}:
      Rejected{reason}
    case Walked{uses, _}:
      ring_prepend(next, first <> uses)

def rings(fuel: Nat, arcs: List<&2, Arc>) -> StitchResult:
  match fuel arcs:
    case _ Nil{}:
      Stitched{Nil{}}
    case 0n _:
      Rejected{WalkLimit{}}
    case 1n+ +left Arc{use, first, end} <> rest:
      +result = walk(left, rest, first, end)
      ring_walk(result, use, rings(left, walk_rest(result)))

def checked(reason: Maybe<&2, Reason>, +arcs: List<&2, Arc>) -> StitchResult:
  match reason:
    case Some{value}:
      Rejected{value}
    case None{}:
      rings(List.length(&2, Arc, arcs), arcs)

def stitch_prepared(prepared: Preparation) -> StitchResult:
  match prepared:
    case BadPreparation{reason}:
      Rejected{reason}
    case Prepared{+arcs}:
      checked(degrees(arcs, arcs), arcs)

def stitch(edges: List<&2, A.Edge>, vertex_count: U32, uses: List<&2, T.Coedge>) -> StitchResult:
  stitch_prepared(prepare(uses, edges, vertex_count))
