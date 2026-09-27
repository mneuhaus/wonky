import Base
import ../../geometry.bend as G
import ../../topology.bend as T
import ./topology-spec.bend as W
import ./base-lemmas.bend as N
import ./word-lemmas.bend as WL

# ---------------------------------------------------------------- transform

def transform_points_length(vs: List<&2, G.Vec3>, +r: G.Rotation, +o: G.Vec3) ->
  {List.length(&2, G.Vec3, G.transform_points(vs, r, o)) == List.length(&2, G.Vec3, vs) : Nat}:
  match vs:
    case Nil{}:
      {==}
    case p <> tail:
      %transform_points_length(tail, r, o) : {1n+List.length(&2, G.Vec3, G.transform_points(tail, r, o)) == 1n+_ : Nat}
      {==}

def transform_faces_loops(fs: List<&2, T.Face>, +r: G.Rotation, +o: G.Vec3) ->
  {W.loops(T.transform_faces(fs, r, o)) == W.loops(fs) : List<&2, List<&2, T.Coedge>>}:
  match fs:
    case Nil{}:
      {==}
    case f <> tail:
      match f:
        case T.Face{origin, normal, x, boundary}:
          %transform_faces_loops(tail, r, o) :
            {boundary <> W.loops(T.transform_faces(tail, r, o)) == boundary <> _ : List<&2, List<&2, T.Coedge>>}
          {==}

# ---------------------------------------------------------------- reverse_uses

def bool_eq_flip(f: Bool, dir: Bool) -> {W.bool_eq(Bool.not(f), dir) == W.bool_eq(f, Bool.not(dir)) : Bool}:
  match f dir:
    case True{} True{}:
      {==}
    case True{} False{}:
      {==}
    case False{} True{}:
      {==}
    case False{} False{}:
      {==}

# Reversing a loop onto an accumulator turns forward uses into backward ones.
def reverse_use_count(cs: List<&2, T.Coedge>, +acc: List<&2, T.Coedge>, +k: Nat, +dir: Bool) ->
  {W.use_count(T.reverse_uses(cs, acc), k, dir) ==
    Nat.add(W.use_count(cs, k, Bool.not(dir)), W.use_count(acc, k, dir)) : Nat}:
  match cs:
    case Nil{}:
      {==}
    case c <> +tail:
      match c:
        case T.Use{+e, +f}:
          +ut = W.use_count(tail, k, Bool.not(dir))
          +ua = W.use_count(acc, k, dir)
          +q = Nat.is_eq(U32.to_nat(e), k)
          +h = W.hit(Bool.and(q, W.bool_eq(Bool.not(f), dir)))
          %Equal.sym(Nat, W.use_count(T.reverse_uses(tail, T.Use{e, Bool.not(f)} <> acc), k, dir),
              Nat.add(ut, W.use_count(T.Use{e, Bool.not(f)} <> acc, k, dir)),
              reverse_use_count(tail, T.Use{e, Bool.not(f)} <> acc, k, dir)) :
            {_ == Nat.add(Nat.add(W.hit(Bool.and(q, W.bool_eq(f, Bool.not(dir)))), ut), ua) : Nat}
          %bool_eq_flip(f, dir) :
            {Nat.add(ut, Nat.add(h, ua)) == Nat.add(Nat.add(W.hit(Bool.and(q, _)), ut), ua) : Nat}
          %N.add_assoc(ut, h, ua) : {_ == Nat.add(Nat.add(h, ut), ua) : Nat}
          %N.add_comm(ut, h) : {Nat.add(Nat.add(ut, h), ua) == Nat.add(_, ua) : Nat}
          {==}

# ---------------------------------------------------------------- closure
# Lemmas below are stated {replacement == form-in-goal}, because `%e : P`
# replaces the right-hand side of e (marked `_` in P) by its left-hand side.

def same_sym(a: Maybe<&2, U32>, b: Maybe<&2, U32>) -> {W.same(b, a) == W.same(a, b) : Bool}:
  match a b:
    case None{} None{}:
      {==}
    case None{} Some{y}:
      {==}
    case Some{x} None{}:
      {==}
    case Some{x} Some{y}:
      WL.u32_is_eq_sym(x, y)

def head_flip(+E: List<&2, T.Edge>, c: T.Coedge) ->
  {W.vertex(E, c, False{}) == W.vertex(E, T.flip(c), True{}) : Maybe<&2, U32>}:
  match c:
    case T.Use{e, f}:
      match f:
        case True{}:
          {==}
        case False{}:
          {==}

def tail_flip(+E: List<&2, T.Edge>, c: T.Coedge) ->
  {W.vertex(E, c, True{}) == W.vertex(E, T.flip(c), False{}) : Maybe<&2, U32>}:
  match c:
    case T.Use{e, f}:
      match f:
        case True{}:
          {==}
        case False{}:
          {==}

# Open chain: head(prev) == tail(c1), head(c1) == tail(c2), ...
def chain(rest: List<&2, T.Coedge>, +E: List<&2, T.Edge>, +prev: T.Coedge) -> Bool:
  match rest:
    case Nil{}:
      True{}
    case +c <> tail:
      Bool.and(W.same(W.vertex(E, prev, True{}), W.vertex(E, c, False{})), chain(tail, E, c))

def lst(rest: List<&2, T.Coedge>, prev: T.Coedge) -> T.Coedge:
  match rest:
    case Nil{}:
      prev
    case c <> tail:
      lst(tail, c)

def links_split(rest: List<&2, T.Coedge>, +E: List<&2, T.Edge>, +s: Maybe<&2, U32>, +prev: T.Coedge) ->
  {Bool.and(chain(rest, E, prev), W.same(W.vertex(E, lst(rest, prev), True{}), s)) == W.links(rest, E, s, prev) : Bool}:
  match rest:
    case Nil{}:
      {==}
    case +c <> tail:
      +l0 = W.same(W.vertex(E, prev, True{}), W.vertex(E, c, False{}))
      -ch = chain(tail, E, c)
      -sc = W.same(W.vertex(E, lst(tail, c), True{}), s)
      %links_split(tail, E, s, c) : {Bool.and(Bool.and(l0, ch), sc) == Bool.and(l0, _) : Bool}
      N.and_assoc(l0, ch, sc)

# reverse_uses(xs, a0 <> as) == revfirst(xs, a0) <> revrest(xs, a0, as)
def revfirst(xs: List<&2, T.Coedge>, a0: T.Coedge) -> T.Coedge:
  match xs:
    case Nil{}:
      a0
    case x <> xt:
      revfirst(xt, T.flip(x))

def revrest(xs: List<&2, T.Coedge>, a0: T.Coedge, as: List<&2, T.Coedge>) -> List<&2, T.Coedge>:
  match xs:
    case Nil{}:
      as
    case x <> xt:
      revrest(xt, T.flip(x), a0 <> as)

def rev_split(xs: List<&2, T.Coedge>, +a0: T.Coedge, +as: List<&2, T.Coedge>) ->
  {revfirst(xs, a0) <> revrest(xs, a0, as) == T.reverse_uses(xs, a0 <> as) : List<&2, T.Coedge>}:
  match xs:
    case Nil{}:
      {==}
    case +x <> xt:
      rev_split(xt, T.flip(x), a0 <> as)

def chainx(xs: List<&2, T.Coedge>, +E: List<&2, T.Edge>, +a0: T.Coedge) -> Bool:
  match xs:
    case Nil{}:
      True{}
    case +x <> xt:
      Bool.and(chainx(xt, E, T.flip(x)), W.same(W.vertex(E, T.flip(x), True{}), W.vertex(E, a0, False{})))

def rev_chain(xs: List<&2, T.Coedge>, +E: List<&2, T.Edge>, +a0: T.Coedge, +as: List<&2, T.Coedge>) ->
  {Bool.and(chainx(xs, E, a0), chain(as, E, a0)) == chain(revrest(xs, a0, as), E, revfirst(xs, a0)) : Bool}:
  match xs:
    case Nil{}:
      {==}
    case +x <> +xt:
      +cx = chainx(xt, E, T.flip(x))
      -y = W.same(W.vertex(E, T.flip(x), True{}), W.vertex(E, a0, False{}))
      -z = chain(as, E, a0)
      %rev_chain(xt, E, T.flip(x), a0 <> as) : {Bool.and(Bool.and(cx, y), z) == _ : Bool}
      N.and_assoc(cx, y, z)

def rev_lst(xs: List<&2, T.Coedge>, +a0: T.Coedge, +as: List<&2, T.Coedge>) ->
  {lst(as, a0) == lst(revrest(xs, a0, as), revfirst(xs, a0)) : T.Coedge}:
  match xs:
    case Nil{}:
      {==}
    case +x <> xt:
      rev_lst(xt, T.flip(x), a0 <> as)

def revfirst_tail(xs: List<&2, T.Coedge>, +E: List<&2, T.Edge>, +c: T.Coedge) ->
  {W.vertex(E, lst(xs, c), True{}) == W.vertex(E, revfirst(xs, T.flip(c)), False{}) : Maybe<&2, U32>}:
  match xs:
    case Nil{}:
      tail_flip(E, c)
    case +x <> xt:
      revfirst_tail(xt, E, x)

def chainx_chain(xs: List<&2, T.Coedge>, +E: List<&2, T.Edge>, +prev: T.Coedge) ->
  {chain(xs, E, prev) == chainx(xs, E, T.flip(prev)) : Bool}:
  match xs:
    case Nil{}:
      {==}
    case +x <> +xt:
      +ch = chain(xt, E, x)
      -tfp = W.vertex(E, T.flip(prev), False{})
      +hp = W.vertex(E, prev, True{})
      +tx = W.vertex(E, x, False{})
      %chainx_chain(xt, E, x) : {Bool.and(W.same(hp, tx), ch) == Bool.and(_, W.same(W.vertex(E, T.flip(x), True{}), tfp)) : Bool}
      %head_flip(E, x) : {Bool.and(W.same(hp, tx), ch) == Bool.and(ch, W.same(_, tfp)) : Bool}
      %tail_flip(E, prev) : {Bool.and(W.same(hp, tx), ch) == Bool.and(ch, W.same(tx, _)) : Bool}
      %same_sym(tx, hp) : {Bool.and(W.same(hp, tx), ch) == Bool.and(ch, _) : Bool}
      N.and_comm(W.same(hp, tx), ch)

# The empty loop is open either way; otherwise split both sides into
# "open chain" and "closing link" and match them up piece by piece.
def reverse_closed(cs: List<&2, T.Coedge>, +E: List<&2, T.Edge>) ->
  {W.closed(T.reverse_uses(cs, Nil{}), E) == W.closed(cs, E) : Bool}:
  match cs:
    case Nil{}:
      {==}
    case +c0 <> +rest:
      +rf = revfirst(rest, T.flip(c0))
      +rr = revrest(rest, T.flip(c0), Nil{})
      +tc0 = W.vertex(E, c0, False{})
      +hl = W.vertex(E, lst(rest, c0), True{})
      %rev_split(rest, T.flip(c0), Nil{}) : {W.closed(_, E) == W.closed(c0 <> rest, E) : Bool}
      %links_split(rr, E, W.vertex(E, rf, False{}), rf) : {_ == W.links(rest, E, tc0, c0) : Bool}
      %links_split(rest, E, tc0, c0) :
        {Bool.and(chain(rr, E, rf), W.same(W.vertex(E, lst(rr, rf), True{}), W.vertex(E, rf, False{}))) == _ : Bool}
      %rev_chain(rest, E, T.flip(c0), Nil{}) :
        {Bool.and(_, W.same(W.vertex(E, lst(rr, rf), True{}), W.vertex(E, rf, False{}))) == Bool.and(chain(rest, E, c0), W.same(hl, tc0)) : Bool}
      %N.and_true(chainx(rest, E, T.flip(c0))) :
        {Bool.and(_, W.same(W.vertex(E, lst(rr, rf), True{}), W.vertex(E, rf, False{}))) == Bool.and(chain(rest, E, c0), W.same(hl, tc0)) : Bool}
      %chainx_chain(rest, E, c0) :
        {Bool.and(_, W.same(W.vertex(E, lst(rr, rf), True{}), W.vertex(E, rf, False{}))) == Bool.and(chain(rest, E, c0), W.same(hl, tc0)) : Bool}
      %rev_lst(rest, T.flip(c0), Nil{}) :
        {Bool.and(chain(rest, E, c0), W.same(W.vertex(E, _, True{}), W.vertex(E, rf, False{}))) == Bool.and(chain(rest, E, c0), W.same(hl, tc0)) : Bool}
      %head_flip(E, c0) :
        {Bool.and(chain(rest, E, c0), W.same(_, W.vertex(E, rf, False{}))) == Bool.and(chain(rest, E, c0), W.same(hl, tc0)) : Bool}
      %revfirst_tail(rest, E, c0) :
        {Bool.and(chain(rest, E, c0), W.same(tc0, _)) == Bool.and(chain(rest, E, c0), W.same(hl, tc0)) : Bool}
      %same_sym(tc0, hl) :
        {Bool.and(chain(rest, E, c0), _) == Bool.and(chain(rest, E, c0), W.same(hl, tc0)) : Bool}
      {==}

# ---------------------------------------------------------------- extrude counts (every n)

def len_append(-A: Data, xs: List<&2, A>, -ys: List<&2, A>) ->
  {Nat.add(List.length(&2, A, xs), List.length(&2, A, ys)) == List.length(&2, A, List.append(&2, A, xs, ys)) : Nat}:
  match xs:
    case Nil{}:
      {==}
    case x <> xt:
      %len_append(A, xt, ys) : {1n+Nat.add(List.length(&2, A, xt), List.length(&2, A, ys)) == 1n+_ : Nat}
      {==}

def len_translate(ps: List<&2, G.Vec3>, +d: G.Vec3) ->
  {List.length(&2, G.Vec3, ps) == List.length(&2, G.Vec3, G.translate(ps, d)) : Nat}:
  match ps:
    case Nil{}:
      {==}
    case p <> tail:
      %len_translate(tail, d) : {1n+List.length(&2, G.Vec3, tail) == 1n+_ : Nat}
      {==}

def len_ring_edges(left: Nat, +n: U32, +offset: U32, +i: U32) ->
  {left == List.length(&2, T.Edge, T.ring_edges(left, n, offset, i)) : Nat}:
  match left:
    case 0n:
      {==}
    case 1n+p:
      %len_ring_edges(p, n, offset, (i + 1 : U32)) : {1n+p == 1n+_ : Nat}
      {==}

def len_vertical_edges(left: Nat, +n: U32, +i: U32) ->
  {left == List.length(&2, T.Edge, T.vertical_edges(left, n, i)) : Nat}:
  match left:
    case 0n:
      {==}
    case 1n+p:
      %len_vertical_edges(p, n, (i + 1 : U32)) : {1n+p == 1n+_ : Nat}
      {==}

def len_side_faces(ps: List<&2, G.Vec3>, +first: G.Vec3, +d: G.Vec3, +n: U32, +i: U32) ->
  {List.length(&2, G.Vec3, ps) == List.length(&2, T.Face, T.side_faces(ps, first, d, n, i)) : Nat}:
  match ps:
    case Nil{}:
      {==}
    case a <> +tail:
      %len_side_faces(tail, first, d, n, (i + 1 : U32)) : {1n+List.length(&2, G.Vec3, tail) == 1n+_ : Nat}
      {==}

def extrude_nv(+ps: List<&2, G.Vec3>, +d: G.Vec3) ->
  {Nat.add(List.length(&2, G.Vec3, ps), List.length(&2, G.Vec3, ps)) == W.nv(T.extrude(ps, d)) : Nat}:
  -c = List.length(&2, G.Vec3, ps)
  %len_append(G.Vec3, ps, G.translate(ps, d)) : {Nat.add(c, c) == _ : Nat}
  %len_translate(ps, d) : {Nat.add(c, c) == Nat.add(c, _) : Nat}
  {==}

def extrude_ne(+ps: List<&2, G.Vec3>, +d: G.Vec3) ->
  {Nat.add(List.length(&2, G.Vec3, ps), Nat.add(List.length(&2, G.Vec3, ps), List.length(&2, G.Vec3, ps))) == W.ne(T.extrude(ps, d)) : Nat}:
  +c = List.length(&2, G.Vec3, ps)
  +n = U32.from_nat(c)
  +lower = T.ring_edges(c, n, 0, 0)
  +upper = T.ring_edges(c, n, n, 0)
  +vertical = T.vertical_edges(c, n, 0)
  %len_append(T.Edge, lower, List.append(&2, T.Edge, upper, vertical)) : {Nat.add(c, Nat.add(c, c)) == _ : Nat}
  %len_append(T.Edge, upper, vertical) : {Nat.add(c, Nat.add(c, c)) == Nat.add(List.length(&2, T.Edge, lower), _) : Nat}
  %len_ring_edges(c, n, 0, 0) : {Nat.add(c, Nat.add(c, c)) == Nat.add(_, Nat.add(List.length(&2, T.Edge, upper), List.length(&2, T.Edge, vertical))) : Nat}
  %len_ring_edges(c, n, n, 0) : {Nat.add(c, Nat.add(c, c)) == Nat.add(c, Nat.add(_, List.length(&2, T.Edge, vertical))) : Nat}
  %len_vertical_edges(c, n, 0) : {Nat.add(c, Nat.add(c, c)) == Nat.add(c, Nat.add(c, _)) : Nat}
  {==}

def extrude_nf(+ps: List<&2, G.Vec3>, +d: G.Vec3) ->
  {2n+List.length(&2, G.Vec3, ps) == W.nf(T.extrude(ps, d)) : Nat}:
  +c = List.length(&2, G.Vec3, ps)
  %len_side_faces(ps, G.first_or(ps, G.V3{0.0, 0.0, 0.0}), d, U32.from_nat(c), 0) : {2n+c == 2n+_ : Nat}
  {==}

# V + F == E + 2 for the extrusion of a profile of ANY length (V = 2n, E = 3n,
# F = n + 2). Only counts: no U32 index arithmetic is involved.
def extrude_euler(+ps: List<&2, G.Vec3>, +d: G.Vec3) ->
  {Nat.add(W.nv(T.extrude(ps, d)), W.nf(T.extrude(ps, d))) == Nat.add(W.ne(T.extrude(ps, d)), 2n) : Nat}:
  +c = List.length(&2, G.Vec3, ps)
  +cc = Nat.add(c, c)
  +e3 = Nat.add(c, cc)
  %extrude_nv(ps, d) : {Nat.add(_, W.nf(T.extrude(ps, d))) == Nat.add(W.ne(T.extrude(ps, d)), 2n) : Nat}
  %extrude_nf(ps, d) : {Nat.add(cc, _) == Nat.add(W.ne(T.extrude(ps, d)), 2n) : Nat}
  %extrude_ne(ps, d) : {Nat.add(cc, 2n+c) == Nat.add(_, 2n) : Nat}
  %N.add_succ(cc, 1n+c) : {_ == Nat.add(e3, 2n) : Nat}
  %N.add_succ(cc, c) : {1n+_ == Nat.add(e3, 2n) : Nat}
  %N.add_comm(2n, e3) : {2n+Nat.add(cc, c) == _ : Nat}
  %N.add_assoc(c, c, c) : {2n+Nat.add(cc, c) == 2n+_ : Nat}
  {==}
