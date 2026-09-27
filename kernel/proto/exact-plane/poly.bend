import Base
import ../../real.bend as R
import ./big.bend as B
import ./geom.bend as E

# Convex polygons in plane representation (Campen & Kobbelt 2010; EMBER,
# Trettner et al. 2022): a support plane plus the cyclic list of edge planes.
# Edge i runs from its start vertex v_i = S n E_(i-1) n E_i to v_(i+1). The
# polygon interior is the negative side of every edge plane. Start vertices
# are cached as exact homogeneous points so the predicate never rebuilds them.

type Edge is Data:
  Edge{p: E.Plane, v: E.Vtx}

type Poly is Data:
  Poly{s: E.Plane, es: List<&2, Edge>}

# Predicate and construction counters (threaded, reported by the stats tool).
# filt: signs certified by the float filter; exact: decided exactly (nonzero);
# zero: decided exactly zero by arithmetic; made: new vertices constructed;
# bad: failures (a construction without a unique point, an impossible sign
# pattern), which turn the job unresolved; sym: zeros known symbolically (the
# plane is one of the three planes that define the vertex).
type St is Data:
  St{filt: U32, exact: U32, zero: U32, made: U32, bad: U32, sym: U32}

def st0() -> St:
  St{0, 0, 0, 0, 0, 0}

def st_add(a: St, b: St) -> St:
  St{f1, e1, z1, m1, b1, s1} = a
  St{f2, e2, z2, m2, b2, s2} = b
  St{(f1 + f2 : U32), (e1 + e2 : U32), (z1 + z2 : U32), (m1 + m2 : U32), (b1 + b2 : U32), (s1 + s2 : U32)}

def st_bad(st: St) -> St:
  St{f, e, z, m, b, s} = st
  St{f, e, z, m, (b + 1 : U32), s}

def st_made(st: St, deg: Bool) -> St:
  St{f, e, z, m, b, s} = st
  St{f, e, z, (m + 1 : U32), (b + Bool.to_u32(deg) : U32), s}

def st_side(st: St, side: E.Side) -> St:
  St{f, e, z, m, b, s} = st
  match side:
    case E.FNeg{}:
      St{(f + 1 : U32), e, z, m, b, s}
    case E.FPos{}:
      St{(f + 1 : U32), e, z, m, b, s}
    case E.XNeg{}:
      St{f, (e + 1 : U32), z, m, b, s}
    case E.XZero{}:
      St{f, e, (z + 1 : U32), m, b, s}
    case E.XPos{}:
      St{f, (e + 1 : U32), z, m, b, s}
    case E.SZero{}:
      St{f, e, z, m, b, (s + 1 : U32)}

def sign_of(side: E.Side) -> B.Sign:
  match side:
    case E.FNeg{}:
      B.Lt0{}
    case E.FPos{}:
      B.Gt0{}
    case E.XNeg{}:
      B.Lt0{}
    case E.XZero{}:
      B.Eq0{}
    case E.XPos{}:
      B.Gt0{}
    case E.SZero{}:
      B.Eq0{}

def is_lt(s: B.Sign) -> Bool:
  match s:
    case B.Lt0{}:
      True{}
    case _:
      False{}

def is_gt(s: B.Sign) -> Bool:
  match s:
    case B.Gt0{}:
      True{}
    case _:
      False{}

def is_eq0(s: B.Sign) -> Bool:
  match s:
    case B.Eq0{}:
      True{}
    case _:
      False{}

def vertices.go(es: List<&2, Edge>, acc: List<&2, E.Vtx>) -> List<&2, E.Vtx>:
  match es:
    case Nil{}:
      List.reverse(&2, E.Vtx, acc)
    case Edge{_, v} <> t:
      vertices.go(t, v <> acc)

def vertices(p: Poly) -> List<&2, E.Vtx>:
  Poly{_, es} = p
  vertices.go(es, Nil{})

# Sides of plane c at every vertex, in order.
def sides.go(vs: List<&2, E.Vtx>, +c: E.Plane, acc: List<&2, E.Side>) -> List<&2, E.Side>:
  match vs:
    case Nil{}:
      List.reverse(&2, E.Side, acc)
    case v <> t:
      sides.go(t, c, E.side(c, v) <> acc)

def sides(+c: E.Plane, vs: List<&2, E.Vtx>) -> List<&2, E.Side>:
  sides.go(vs, c, Nil{})

def tally(xs: List<&2, E.Side>, st: St) -> St:
  match xs:
    case Nil{}:
      st
    case s <> t:
      tally(t, st_side(st, s))

def signs.go(xs: List<&2, E.Side>, acc: List<&2, B.Sign>) -> List<&2, B.Sign>:
  match xs:
    case Nil{}:
      List.reverse(&2, B.Sign, acc)
    case s <> t:
      signs.go(t, sign_of(s) <> acc)

def signs(xs: List<&2, E.Side>) -> List<&2, B.Sign>:
  signs.go(xs, Nil{})

def any_lt(xs: List<&2, B.Sign>) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case s <> t:
      Bool.or(is_lt(s), any_lt(t))

def any_gt(xs: List<&2, B.Sign>) -> Bool:
  match xs:
    case Nil{}:
      False{}
    case s <> t:
      Bool.or(is_gt(s), any_gt(t))

# Cyclic successor list: [s1, ..., s_(n-1), s0].
def rotate1(-A: Data, xs: List<&2, A>) -> List<&2, A>:
  match xs:
    case Nil{}:
      Nil{}
    case h <> t:
      List.append(&2, A, t, [h])

# --- splitting by a plane ------------------------------------------------------

type Split is Data:
  AllNeg{p: Poly, st: St}
  AllPos{p: Poly, st: St}
  Both{neg: Poly, pos: Poly, st: St}

type Acc is Data:
  Acc{n: List<&2, Edge>, p: List<&2, Edge>, st: St}

def acc_put(a: Acc, n: List<&2, Edge>, p: List<&2, Edge>) -> Acc:
  Acc{an, ap, st} = a
  Acc{List.append(&2, Edge, n, an), List.append(&2, Edge, p, ap), st}

def acc_cross(a: Acc, +x: E.Vtx) -> Acc:
  Acc{an, ap, st} = a
  Acc{an, ap, st_made(st, E.degenerate(x))}

def acc_badp(a: Acc) -> Acc:
  Acc{an, ap, st} = a
  Acc{an, ap, st_bad(st)}

# One edge (E_i from v_i) with s_i and s_(i+1); lists are built reversed, so
# a two-edge contribution is given in reverse order.
def split.edge(si: B.Sign, sn: B.Sign, +ei: E.Plane, +vi: E.Vtx, +s: E.Plane, +c: E.Plane, +nc: E.Plane, a: Acc) -> Acc:
  match si sn:
    case B.Lt0{} B.Gt0{}:
      +x = E.meet(s, ei, c)
      acc_cross(acc_put(a, [Edge{c, x}, Edge{ei, vi}], [Edge{ei, x}]), x)
    case B.Gt0{} B.Lt0{}:
      +x = E.meet(s, ei, c)
      acc_cross(acc_put(a, [Edge{ei, x}], [Edge{nc, x}, Edge{ei, vi}]), x)
    case B.Lt0{} _:
      acc_put(a, [Edge{ei, vi}], Nil{})
    case B.Gt0{} _:
      acc_put(a, Nil{}, [Edge{ei, vi}])
    case B.Eq0{} B.Lt0{}:
      acc_put(a, [Edge{ei, vi}], [Edge{nc, vi}])
    case B.Eq0{} B.Gt0{}:
      acc_put(a, [Edge{c, vi}], [Edge{ei, vi}])
    case B.Eq0{} B.Eq0{}:
      acc_badp(acc_put(a, [Edge{ei, vi}], Nil{}))

def split.go(es: List<&2, Edge>, ss: List<&2, B.Sign>, ns: List<&2, B.Sign>, +s: E.Plane, +c: E.Plane, +nc: E.Plane, a: Acc) -> Acc:
  match es ss ns:
    case Edge{ei, vi} <> et si <> st sn <> nt:
      split.go(et, st, nt, s, c, nc, split.edge(si, sn, ei, vi, s, c, nc, a))
    case _ _ _:
      a

def split.fin(+s: E.Plane, a: Acc) -> Split:
  Acc{n, p, st} = a
  Both{Poly{s, List.reverse(&2, Edge, n)}, Poly{s, List.reverse(&2, Edge, p)}, st}

def split.both(+s: E.Plane, es: List<&2, Edge>, +ss: List<&2, B.Sign>, +c: E.Plane, st: St) -> Split:
  split.fin(s, split.go(es, ss, rotate1(B.Sign, ss), s, c, E.plane_neg(c), Acc{Nil{}, Nil{}, st}))

def split.pick(neg: Bool, pos: Bool, +s: E.Plane, +es: List<&2, Edge>, +ss: List<&2, B.Sign>, +c: E.Plane, st: St) -> Split:
  match neg pos:
    case True{} True{}:
      split.both(s, es, ss, c, st)
    case _ False{}:
      AllNeg{Poly{s, es}, st}
    case False{} True{}:
      AllPos{Poly{s, es}, st}

# Split polygon p by plane c into its parts on the negative and positive side.
# A polygon on one side (touching allowed) is reported as AllNeg / AllPos.
def split(p: Poly, +c: E.Plane, st: St) -> Split:
  Poly{+s, +es} = p
  +sd = sides(c, vertices.go(es, Nil{}))
  +ss = signs(sd)
  split.pick(any_lt(ss), any_gt(ss), s, es, ss, c, tally(sd, st))
