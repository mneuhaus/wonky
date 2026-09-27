import Base
import ../../geometry.bend as G
import ../../topology.bend as T

# Spike spec: the combinatorial half of src/brep.mjs validateSolid, written as
# Bend functions over the production T.Solid so laws can talk about it.
# Checked here: edge endpoints in range and distinct, every vertex referenced,
# one loop per face with >= 3 in-range coedges, every loop closed, every edge
# used exactly once forward and once backward, and V + F == E + 2 (Euler 2).
# NOT checked (validateSolid does these numerically or they need a graph
# search): F32 geometry, planarity, orientation vs. normal, the two uses of an
# edge lying on distinct faces, shell connectivity.

def below(i: U32, n: Nat) -> Bool:
  Nat.is_lt(U32.to_nat(i), n)

def edge_ok(+nv: Nat, e: T.Edge) -> Bool:
  T.Edge{+s, +t} = e
  Bool.and(below(s, nv), Bool.and(below(t, nv), U32.is_ne(s, t)))

def edges_ok(es: List<&2, T.Edge>, +nv: Nat) -> Bool:
  match es:
    case Nil{}:
      True{}
    case e <> rest:
      Bool.and(edge_ok(nv, e), edges_ok(rest, nv))

def touches(es: List<&2, T.Edge>, +v: Nat) -> Bool:
  match es:
    case Nil{}:
      False{}
    case e <> rest:
      T.Edge{s, t} = e
      Bool.or(Nat.is_eq(U32.to_nat(s), v), Bool.or(Nat.is_eq(U32.to_nat(t), v), touches(rest, v)))

# Every vertex index v < nv is an endpoint of some edge.
def referenced(left: Nat, +es: List<&2, T.Edge>, +v: Nat) -> Bool:
  match left:
    case 0n:
      True{}
    case 1n+p:
      Bool.and(touches(es, v), referenced(p, es, 1n+v))

# An edge endpoint: its start when `start` is True, else its end.
def end_of(m: Maybe<&2, T.Edge>, start: Bool) -> Maybe<&2, U32>:
  match m:
    case None{}:
      None{}
    case Some{e}:
      T.Edge{s, t} = e
      Some{Bool.pick(U32, start, s, t)}

# Endpoint of a coedge: its tail (head False) or its head (head True). The
# selector is computed before the lookup, so flip lemmas need no edge lookup.
def vertex(+edges: List<&2, T.Edge>, c: T.Coedge, head: Bool) -> Maybe<&2, U32>:
  T.Use{e, forward} = c
  end_of(List.get(&2, T.Edge, edges, U32.to_nat(e)), Bool.xor(forward, head))

def same(a: Maybe<&2, U32>, b: Maybe<&2, U32>) -> Bool:
  match a:
    case None{}:
      False{}
    case Some{x}:
      match b:
        case None{}:
          False{}
        case Some{y}:
          U32.is_eq(x, y)

def links(rest: List<&2, T.Coedge>, +edges: List<&2, T.Edge>, +start: Maybe<&2, U32>, +prev: T.Coedge) -> Bool:
  match rest:
    case Nil{}:
      same(vertex(edges, prev, True{}), start)
    case +c <> tail:
      Bool.and(same(vertex(edges, prev, True{}), vertex(edges, c, False{})), links(tail, edges, start, c))

# head(c[i]) == tail(c[i+1]) for every i, cyclically. The empty loop is open.
def closed(loop: List<&2, T.Coedge>, +edges: List<&2, T.Edge>) -> Bool:
  match loop:
    case Nil{}:
      False{}
    case +c <> rest:
      links(rest, edges, vertex(edges, c, False{}), c)

def uses_in_range(loop: List<&2, T.Coedge>, +ne: Nat) -> Bool:
  match loop:
    case Nil{}:
      True{}
    case c <> rest:
      T.Use{e, _} = c
      Bool.and(below(e, ne), uses_in_range(rest, ne))

def loop_ok(+loop: List<&2, T.Coedge>, +edges: List<&2, T.Edge>) -> Bool:
  +ne = List.length(&2, T.Edge, edges)
  Bool.and(Nat.is_ge(List.length(&2, T.Coedge, loop), 3n),
    Bool.and(uses_in_range(loop, ne), closed(loop, edges)))

def loops_ok(loops: List<&2, List<&2, T.Coedge>>, +edges: List<&2, T.Edge>) -> Bool:
  match loops:
    case Nil{}:
      True{}
    case l <> rest:
      Bool.and(loop_ok(l, edges), loops_ok(rest, edges))

def hit(b: Bool) -> Nat:
  match b:
    case False{}:
      0n
    case True{}:
      1n

def bool_eq(a: Bool, b: Bool) -> Bool:
  Bool.not(Bool.xor(a, b))

def use_count(loop: List<&2, T.Coedge>, +k: Nat, +dir: Bool) -> Nat:
  match loop:
    case Nil{}:
      0n
    case c <> rest:
      T.Use{e, f} = c
      Nat.add(hit(Bool.and(Nat.is_eq(U32.to_nat(e), k), bool_eq(f, dir))), use_count(rest, k, dir))

def uses(loops: List<&2, List<&2, T.Coedge>>, +k: Nat, +dir: Bool) -> Nat:
  match loops:
    case Nil{}:
      0n
    case l <> rest:
      Nat.add(use_count(l, k, dir), uses(rest, k, dir))

# Every edge index k < ne is used exactly once forward and once backward.
def paired(left: Nat, +loops: List<&2, List<&2, T.Coedge>>, +k: Nat) -> Bool:
  match left:
    case 0n:
      True{}
    case 1n+p:
      Bool.and(Nat.is_eq(uses(loops, k, True{}), 1n),
        Bool.and(Nat.is_eq(uses(loops, k, False{}), 1n), paired(p, loops, 1n+k)))

def loops(faces: List<&2, T.Face>) -> List<&2, List<&2, T.Coedge>>:
  match faces:
    case Nil{}:
      Nil{}
    case f <> rest:
      T.Face{_, _, _, b} = f
      b <> loops(rest)

def topo_ok(+nv: Nat, +edges: List<&2, T.Edge>, +ls: List<&2, List<&2, T.Coedge>>) -> Bool:
  +ne = List.length(&2, T.Edge, edges)
  +nf = List.length(&2, List<&2, T.Coedge>, ls)
  Bool.and(edges_ok(edges, nv),
    Bool.and(referenced(nv, edges, 0n),
      Bool.and(loops_ok(ls, edges),
        Bool.and(paired(ne, ls, 0n),
          Nat.is_eq(Nat.add(nv, nf), Nat.add(ne, 2n))))))

# Vertices matter only through their count; faces only through their loops.
def solid_ok(s: T.Solid) -> Bool:
  T.Solid{vs, es, fs} = s
  topo_ok(List.length(&2, G.Vec3, vs), es, loops(fs))

# Element counts of a solid (V, E, F).
def nv(s: T.Solid) -> Nat:
  T.Solid{vs, _, _} = s
  List.length(&2, G.Vec3, vs)

def ne(s: T.Solid) -> Nat:
  T.Solid{_, es, _} = s
  List.length(&2, T.Edge, es)

def nf(s: T.Solid) -> Nat:
  T.Solid{_, _, fs} = s
  List.length(&2, T.Face, fs)
