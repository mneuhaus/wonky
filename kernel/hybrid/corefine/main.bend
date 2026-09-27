import Base
import ../../real.bend as R
import ../../precise.bend as G
import ../mesh.bend as M
import ../mesh-io.bend as MIO
import ./util.bend as U
import ./prep.bend as P
import ./inter.bend as I
import ./boolean.bend as B
import ./unify.bend as Y
import ../unify.bend as UN

# The hybrid Boolean's mesh stage (kernel/hybrid/main.bend; bake-off prototype
# "corefine", driver kernel/proto/corefine): a tagged triangle-mesh Boolean in
# the style of Manifold (symbolic-perturbation shadow predicates, topology derived only
# from shared decisions), evaluating whole CSG trees. See
# docs/proto-corefine.md.
#
# Every output triangle carries the tag of the input face it was cut from.
# Anything the prototype cannot do is an explicit Unresolved with a reason.
#
# Ownership: a mesh is never duplicated here. Bend turns a value that is used
# after an owned use into a shared (reference-counted) one, and every read of
# a shared mesh inside the parallel phases then pays an atomic count; that
# alone cost all thread scaling (measured: 1.2 s at 1 and 18 threads). So
# each leaf mesh is moved into its tree leaf once, each mesh is measured once
# (box and triangle count ride along in Ev), and operands are routed by
# matches, never picked or copied.

type Ev is Data:
  EvOk{m: M.Mesh, box: P.Box, n: U32}
  EvBad{reason: String}

# Fork width of the parallel phases (chunks per fork tree).
def leaves() -> U32:
  64

def ev_empty() -> Ev:
  EvOk{M.empty_mesh(), P.box_empty(), 0}

# Box and triangle count, read before the mesh is moved into the record.
def measure(m: M.Mesh) -> Ev:
  M.Mesh{+vs, +ts} = m
  +b = P.mesh_box(vs, P.box_empty())
  +n = U.len(M.Tri, ts)
  EvOk{M.Mesh{vs, ts}, b, n}

def from_bout(b: B.BOut) -> Ev:
  match b:
    case B.BOk{m}:
      measure(m)
    case B.BBad{r}:
      EvBad{r}

# Both operands are non-empty and their boxes may touch. uc: the job's
# unified plane classes (unify.bend), read by every Boolean.
def full(+op: M.Op, a: M.Mesh, b: M.Mesh, uc: Y.Uc) -> Ev:
  from_bout(B.boolean(op, a, b, leaves(), uc))

# Operands whose conservative boxes are strictly apart share no point.
def apart(op: M.Op, a: M.Mesh, +ba: P.Box, +na: U32, b: M.Mesh, +bb: P.Box, +nb: U32) -> Ev:
  match op:
    case M.Union{}:
      EvOk{M.concat(a, b), P.box_union(ba, bb), (na + nb : U32)}
    case M.Subtract{}:
      EvOk{a, ba, na}
    case M.Intersect{}:
      ev_empty()

def nonempty(sep: Bool, +op: M.Op, a: M.Mesh, +ba: P.Box, +na: U32, b: M.Mesh, +bb: P.Box, +nb: U32, uc: Y.Uc) -> Ev:
  match sep:
    case True{}:
      apart(op, a, ba, na, b, bb, nb)
    case False{}:
      full(op, a, b, uc)

# b is empty.
def empty_b(op: M.Op, a: M.Mesh, +ba: P.Box, +na: U32) -> Ev:
  match op:
    case M.Intersect{}:
      ev_empty()
    case _:
      EvOk{a, ba, na}

# a is empty.
def empty_a(op: M.Op, b: M.Mesh, +bb: P.Box, +nb: U32) -> Ev:
  match op:
    case M.Union{}:
      EvOk{b, bb, nb}
    case _:
      ev_empty()

def plan.b(eb: Bool, +op: M.Op, a: M.Mesh, +ba: P.Box, +na: U32, b: M.Mesh, +bb: P.Box, +nb: U32, uc: Y.Uc) -> Ev:
  match eb:
    case True{}:
      empty_b(op, a, ba, na)
    case False{}:
      nonempty(P.box_apart(ba, bb), op, a, ba, na, b, bb, nb, uc)

def plan.a(ea: Bool, +op: M.Op, a: M.Mesh, +ba: P.Box, +na: U32, b: M.Mesh, +bb: P.Box, +nb: U32, uc: Y.Uc) -> Ev:
  match ea:
    case True{}:
      empty_a(op, b, bb, nb)
    case False{}:
      plan.b(U.is_zero(nb), op, a, ba, na, b, bb, nb, uc)

# Empty operands and operands with separated boxes are answered directly
# (a union of separated solids is their disjoint concatenation); everything
# else is one full Boolean.
def combine(+op: M.Op, x: Ev, y: Ev, uc: Y.Uc) -> Ev:
  match x y:
    case EvBad{r} _:
      EvBad{r}
    case _ EvBad{r}:
      EvBad{r}
    case EvOk{a, +ba, +na} EvOk{b, +bb, +nb}:
      plan.a(U.is_zero(na), op, a, ba, na, b, bb, nb, uc)

# --- leaves -------------------------------------------------------------------
# The tree with each leaf's mesh moved into it (measured), built by a stack
# machine: a leaf pushes, a node pops its two children.

type MCsg is Data:
  CfLeaf{e: Ev}
  CfNode{op: M.Op, l: MCsg, r: MCsg}

type ASt is Data:
  ASt{ms: List<&2, M.LeafMesh>, out: List<&2, MCsg>}

type Tk is Data:
  Tk{found: Ev, rest: List<&2, M.LeafMesh>}

def take.step(hit: Bool, x: M.LeafMesh, st: Tk) -> Tk:
  match hit x st:
    case True{} M.LeafMesh{_, m} Tk{_, rest}:
      Tk{measure(m), rest}
    case False{} y Tk{f, rest}:
      Tk{f, y <> rest}

# Remove the mesh of `leaf` from the list (missing or already taken: EvBad).
def take(ms: List<&2, M.LeafMesh>, +leaf: U32, st: Tk) -> Tk:
  match ms:
    case Nil{}:
      Tk{f, rest} = st
      Tk{f, U.rev(M.LeafMesh, rest)}
    case M.LeafMesh{+l, m} <> t:
      take(t, leaf, take.step(U32.is_eq(l, leaf), M.LeafMesh{l, m}, st))

def at.leaf(r: Tk, out: List<&2, MCsg>) -> ASt:
  Tk{e, ms} = r
  ASt{ms, CfLeaf{e} <> out}

def at.node(op: M.Op, st: ASt) -> ASt:
  ASt{ms, out} = st
  match out:
    case r <> l <> rest:
      ASt{ms, CfNode{op, l, r} <> rest}
    case other:
      ASt{ms, other}

def attach(t: M.Csg, st: ASt) -> ASt:
  match t:
    case M.CLeaf{leaf}:
      ASt{ms, out} = st
      at.leaf(take(ms, leaf, Tk{EvBad{"no mesh for a leaf, or a leaf used twice (corefine needs one mesh per leaf)"}, Nil{}}), out)
    case M.CNode{op, l, r}:
      at.node(op, attach(r, attach(l, st)))

def attached(st: ASt) -> MCsg:
  ASt{_, out} = st
  match out:
    case t <> Nil{}:
      t
    case _:
      CfLeaf{EvBad{"internal: malformed csg tree"}}

# --- n-ary unions and subtract spines ------------------------------------------
# Union is associative and commutative, and (A - B) - C = A - (B u C), for
# regularized solids as for sets. Union chains are therefore flattened into
# operand lists, and a left spine of subtractions becomes one subtraction of
# the union of all subtrahends. The operands of a union are combined in
# rounds: a greedy set of operands whose conservative boxes are pairwise
# strictly apart shares no point, so it is concatenated without a Boolean
# and joined to the running result by one Boolean; the rest goes to the next
# round (the idea of Manifold's CSG-tree flattening and box-disjoint batch
# compose). Deterministic: the order is the tree order.

# Operands of a union chain, left to right.
def union_ops(t: MCsg, acc: List<&2, MCsg>) -> List<&2, MCsg>:
  match t:
    case CfNode{M.Union{}, l, r}:
      union_ops(l, union_ops(r, acc))
    case CfNode{op, l, r}:
      CfNode{op, l, r} <> acc
    case CfLeaf{e}:
      CfLeaf{e} <> acc

# (((A - B) - C) - D) -> A and [B, C, D].
def sub_spine(t: MCsg, acc: List<&2, MCsg>) -> MCsg & List<&2, MCsg>:
  match t:
    case CfNode{M.Subtract{}, l, r}:
      sub_spine(l, r <> acc)
    case CfNode{op, l, r}:
      (CfNode{op, l, r}, acc)
    case CfLeaf{e}:
      (CfLeaf{e}, acc)

# Operand lists as balanced trees (the fork trees of the evaluation).
type Ops is Data:
  ONil{}
  OOne{t: MCsg}
  ONode{l: Ops, r: Ops}

def ops.leaves(ts: List<&2, MCsg>, acc: List<&2, Ops>) -> List<&2, Ops>:
  match ts:
    case Nil{}:
      U.rev(Ops, acc)
    case t <> rest:
      ops.leaves(rest, OOne{t} <> acc)

def ops.pairs(xs: List<&2, Ops>, acc: List<&2, Ops>) -> List<&2, Ops>:
  match xs:
    case Nil{}:
      U.rev(Ops, acc)
    case a <> Nil{}:
      U.rev(Ops, a <> acc)
    case a <> b <> t:
      ops.pairs(t, ONode{a, b} <> acc)

def ops.levels(fuel: Nat, xs: List<&2, Ops>) -> Ops:
  match fuel xs:
    case _ Nil{}:
      ONil{}
    case _ t <> Nil{}:
      t
    case 0n _:
      ONil{}
    case 1n+p _:
      ops.levels(p, ops.pairs(xs, Nil{}))

def balanced(ts: List<&2, MCsg>) -> Ops:
  ops.levels(40n, ops.leaves(ts, Nil{}))

# A spine as [base] followed by the subtrahends.
def spine_ops(p: MCsg & List<&2, MCsg>) -> Ops:
  (base, subs) = p
  ONode{OOne{base}, balanced(subs)}

# --- union rounds -----------------------------------------------------------------

type Col is Data:
  ColOk{ms: List<&2, Ev>}
  ColBad{reason: String}

# Non-empty operands, or the first refusal.
def collect(evs: List<&2, Ev>, acc: List<&2, Ev>) -> Col:
  match evs:
    case Nil{}:
      ColOk{U.rev(Ev, acc)}
    case EvBad{r} <> _:
      ColBad{r}
    case EvOk{m, b, +n} <> t:
      collect(t, U.cons_if(Ev, U.nonzero(n), EvOk{m, b, n}, acc))

# Is b apart from every box in ms? Returns the list (rebuilt, same order).
def apart_all(ms: List<&2, Ev>, +b: P.Box, ok: Bool, acc: List<&2, Ev>) -> List<&2, Ev> & Bool:
  match ms:
    case Nil{}:
      (U.rev(Ev, acc), ok)
    case EvOk{m, +x, n} <> t:
      apart_all(t, b, Bool.and(ok, P.box_apart(x, b)), EvOk{m, x, n} <> acc)
    case EvBad{r} <> t:
      apart_all(t, b, ok, EvBad{r} <> acc)

type Split is Data:
  Split{s: List<&2, Ev>, t: List<&2, Ev>}

def indep.put(free: Bool, s: List<&2, Ev>, x: Ev, t: List<&2, Ev>) -> Split:
  match free:
    case True{}:
      Split{x <> s, t}
    case False{}:
      Split{s, x <> t}

def indep.step(r: List<&2, Ev> & Bool, x: Ev, t: List<&2, Ev>) -> Split:
  (s, free) = r
  indep.put(free, U.rev(Ev, s), x, t)

# Greedy: an operand joins s when its box is apart from every box in s
# (s and t are kept reversed while walking).
def indep(xs: List<&2, Ev>, sp: Split) -> Split:
  match xs:
    case Nil{}:
      Split{s, t} = sp
      Split{U.rev(Ev, s), U.rev(Ev, t)}
    case EvOk{m, +b, n} <> rest:
      Split{s, t} = sp
      indep(rest, indep.step(apart_all(U.rev(Ev, s), b, True{}, Nil{}), EvOk{m, b, n}, t))
    case EvBad{_} <> rest:
      indep(rest, sp)

def cat2(x: Ev, y: Ev) -> Ev:
  match x y:
    case EvOk{a, ba, na} EvOk{b, bb, nb}:
      EvOk{M.concat(a, b), P.box_union(ba, bb), (na + nb : U32)}
    case EvBad{r} _:
      EvBad{r}
    case _ EvBad{r}:
      EvBad{r}

def cat.pairs(ms: List<&2, Ev>, acc: List<&2, Ev>) -> List<&2, Ev>:
  match ms:
    case Nil{}:
      U.rev(Ev, acc)
    case a <> Nil{}:
      U.rev(Ev, a <> acc)
    case a <> b <> t:
      cat.pairs(t, cat2(a, b) <> acc)

def cat.levels(fuel: Nat, ms: List<&2, Ev>) -> Ev:
  match fuel ms:
    case _ Nil{}:
      ev_empty()
    case _ m <> Nil{}:
      m
    case 0n _:
      EvBad{"internal: concatenation depth"}
    case 1n+p _:
      cat.levels(p, cat.pairs(ms, Nil{}))

# Disjoint concatenation of pairwise apart operands (balanced pairing).
def concat_all(xs: List<&2, Ev>) -> Ev:
  cat.levels(40n, xs)

# One round: acc u concat(s); then the next round over t.
def union_rounds(fuel: Nat, sp: Split, acc: Ev, +uc: Y.Uc) -> Ev:
  match fuel sp:
    case _ Split{s, Nil{}}:
      combine(M.Union{}, acc, concat_all(s), uc)
    case 0n _:
      EvBad{"union operand rounds exhausted"}
    case 1n+p Split{s, x <> rest}:
      union_rounds(p, indep(x <> rest, Split{Nil{}, Nil{}}), combine(M.Union{}, acc, concat_all(s), uc), uc)

def union_col(c: Col, uc: Y.Uc) -> Ev:
  match c:
    case ColBad{r}:
      EvBad{r}
    case ColOk{+ms}:
      union_rounds(U32.to_nat((U.len(Ev, ms) + 1 : U32)), indep(ms, Split{Nil{}, Nil{}}), ev_empty(), uc)

def union_evs(evs: List<&2, Ev>, uc: Y.Uc) -> Ev:
  union_col(collect(evs, Nil{}), uc)

def sub_fin(evs: List<&2, Ev>, +uc: Y.Uc) -> Ev:
  match evs:
    case a <> rest:
      combine(M.Subtract{}, a, union_evs(rest, uc), uc)
    case Nil{}:
      EvBad{"internal: empty subtraction"}

def int_fin(evs: List<&2, Ev>, uc: Y.Uc) -> Ev:
  match evs:
    case a <> b <> Nil{}:
      combine(M.Intersect{}, a, b, uc)
    case _:
      EvBad{"internal: intersection operands"}

# The values of the operand tree o, in order. OOne yields exactly one value:
# a leaf, a flattened union, a subtract spine or an intersection. fuel bounds
# the depth.
#
# The halves of an ONode are evaluated one after the other, not in a parallel
# let. Bend 2.0.25's CPU pool runs every parallel let in a frame sequentially
# once that frame has made a non-tail self call whose callee forked (here: the
# Boolean after the operands of a union). Reproduced in isolation
# (tmp/corefine/prof/micro.bend, mode nontail: 188 ms at 1 thread, 190 ms at
# 18; the same work without that call 190 / 35 ms), and on fine-spheres-50k
# (1.9 / 2.0 s with the fork, 1.6 / 0.96 s without). The parallelism is inside
# each Boolean; after flattening, the corpus trees are dependency chains, so
# no subtree parallelism is lost here (see docs/proto-corefine.md).
def evl(fuel: Nat, o: Ops, +uc: Y.Uc) -> List<&2, Ev>:
  match fuel o:
    case _ ONil{}:
      Nil{}
    case 0n _:
      [EvBad{"csg evaluation depth exhausted"}]
    case 1n+p ONode{l, r}:
      +q = p
      U.cat(Ev, evl(q, l, uc), evl(q, r, uc))
    case 1n+p OOne{CfLeaf{e}}:
      [e]
    case 1n+p OOne{CfNode{M.Union{}, l, r}}:
      [union_evs(evl(p, balanced(union_ops(l, union_ops(r, Nil{}))), uc), uc)]
    case 1n+p OOne{CfNode{M.Subtract{}, l, r}}:
      [sub_fin(evl(p, spine_ops(sub_spine(l, [r])), uc), uc)]
    case 1n+p OOne{CfNode{M.Intersect{}, l, r}}:
      [int_fin(evl(p, ONode{OOne{l}, OOne{r}}, uc), uc)]

def csg_size(t: M.Csg, acc: U32) -> U32:
  match t:
    case M.CLeaf{_}:
      (acc + 1 : U32)
    case M.CNode{_, l, r}:
      csg_size(l, csg_size(r, (acc + 1 : U32)))

def first_ev(evs: List<&2, Ev>) -> Ev:
  match evs:
    case e <> Nil{}:
      e
    case _:
      EvBad{"internal: expected one result"}

def to_outcome(e: Ev) -> M.Outcome:
  match e:
    case EvOk{m, _, _}:
      M.Solved{m}
    case EvBad{r}:
      M.Unresolved{r}

# --- the root Boolean in stages ------------------------------------------------
# Everything below the root is evaluated by evl. The root's own Boolean (if
# it needs one) is returned unevaluated, so that a driver can run it in three
# stages with an IO step before and after the decisions: a device call (!)
# that follows host forks in one evaluation falls back to the CPU pool, so the
# native driver puts IO.now between pre, decide and post (the decisions then
# really run on Metal with --gpu). The JS target and solve() run the same
# stages without IO; the results are identical on every target.

type Root is Data:
  RDone{e: Ev}
  RFull{op: M.Op, a: M.Mesh, b: M.Mesh}

def r_nonempty(sep: Bool, +op: M.Op, a: M.Mesh, +ba: P.Box, +na: U32, b: M.Mesh, +bb: P.Box, +nb: U32) -> Root:
  match sep:
    case True{}:
      RDone{apart(op, a, ba, na, b, bb, nb)}
    case False{}:
      RFull{op, a, b}

def r_plan.b(eb: Bool, +op: M.Op, a: M.Mesh, +ba: P.Box, +na: U32, b: M.Mesh, +bb: P.Box, +nb: U32) -> Root:
  match eb:
    case True{}:
      RDone{empty_b(op, a, ba, na)}
    case False{}:
      r_nonempty(P.box_apart(ba, bb), op, a, ba, na, b, bb, nb)

def r_plan.a(ea: Bool, +op: M.Op, a: M.Mesh, +ba: P.Box, +na: U32, b: M.Mesh, +bb: P.Box, +nb: U32) -> Root:
  match ea:
    case True{}:
      RDone{empty_a(op, b, bb, nb)}
    case False{}:
      r_plan.b(U.is_zero(nb), op, a, ba, na, b, bb, nb)

# combine, with the full Boolean left pending.
def combine_root(+op: M.Op, x: Ev, y: Ev) -> Root:
  match x y:
    case EvBad{r} _:
      RDone{EvBad{r}}
    case _ EvBad{r}:
      RDone{EvBad{r}}
    case EvOk{a, +ba, +na} EvOk{b, +bb, +nb}:
      r_plan.a(U.is_zero(na), op, a, ba, na, b, bb, nb)

def union_rounds_root(fuel: Nat, sp: Split, acc: Ev, +uc: Y.Uc) -> Root:
  match fuel sp:
    case _ Split{s, Nil{}}:
      combine_root(M.Union{}, acc, concat_all(s))
    case 0n _:
      RDone{EvBad{"union operand rounds exhausted"}}
    case 1n+p Split{s, x <> rest}:
      union_rounds_root(p, indep(x <> rest, Split{Nil{}, Nil{}}), combine(M.Union{}, acc, concat_all(s), uc), uc)

def union_col_root(c: Col, uc: Y.Uc) -> Root:
  match c:
    case ColBad{r}:
      RDone{EvBad{r}}
    case ColOk{+ms}:
      union_rounds_root(U32.to_nat((U.len(Ev, ms) + 1 : U32)), indep(ms, Split{Nil{}, Nil{}}), ev_empty(), uc)

def sub_fin_root(evs: List<&2, Ev>, uc: Y.Uc) -> Root:
  match evs:
    case a <> rest:
      combine_root(M.Subtract{}, a, union_evs(rest, uc))
    case Nil{}:
      RDone{EvBad{"internal: empty subtraction"}}

def int_fin_root(evs: List<&2, Ev>) -> Root:
  match evs:
    case a <> b <> Nil{}:
      combine_root(M.Intersect{}, a, b)
    case _:
      RDone{EvBad{"internal: intersection operands"}}

def evl_root(fuel: Nat, t: MCsg, +uc: Y.Uc) -> Root:
  match t:
    case CfLeaf{e}:
      RDone{e}
    case CfNode{M.Union{}, l, r}:
      union_col_root(collect(evl(fuel, balanced(union_ops(l, union_ops(r, Nil{}))), uc), Nil{}), uc)
    case CfNode{M.Subtract{}, l, r}:
      sub_fin_root(evl(fuel, spine_ops(sub_spine(l, [r])), uc), uc)
    case CfNode{M.Intersect{}, l, r}:
      int_fin_root(evl(fuel, ONode{OOne{l}, OOne{r}}, uc))

# --- carrier unification ---------------------------------------------------------
# The job's unified plane classes (kernel/hybrid/unify.bend) need the scale of
# the leaf meshes (UN.scan: an upper bound of their largest |coordinate|).
# A refusal of a job with unified classes states the tolerance it used.

def uc_note(u: Y.Uc) -> String:
  Y.Uc{_, _, _, +n, _} = u
  UN.note(n, MIO.put_u32(n, ""))

# The tree below the root and the job's unified classes.
type Staged is Data:
  Staged{r: Root, uc: Y.Uc}

def stage.uc(x: UN.MxL, +tree: M.Csg, faces: List<&2, M.FaceTag>) -> Staged:
  UN.MxL{meshes, +mx} = x
  +uc = Y.classes(faces, mx)
  Staged{evl_root(U32.to_nat((2 * csg_size(tree, 0) + 64 : U32)), attached(attach(tree, ASt{meshes, Nil{}})), uc), uc}

def stage.tree(+tree: M.Csg, faces: List<&2, M.FaceTag>, meshes: List<&2, M.LeafMesh>) -> Staged:
  stage.uc(UN.scan(meshes), tree, faces)

# Stage 0: the tree below the root, the root's Boolean pending.
def stage(p: M.JobParse) -> Staged:
  match p:
    case M.Malformed{reason}:
      Staged{RDone{EvBad{"malformed-job " ++ reason}}, Y.none()}
    case M.Parsed{job}:
      M.Job{_, _, tree, _, faces, meshes} = job
      stage.tree(tree, faces, meshes)

# Stage 1: operand preparation and broad phase of the pending Boolean. The
# candidate pairs are split off (they go to the device; the rest stays).
# note: the refusal suffix of carrier unification.
type Begun is Data:
  BgDone{e: Ev, note: String}
  BgPre{pre: B.Pre, eP: Bool, pp: List<&2, I.PairC>, pq: List<&2, I.PairC>, tz: F32, note: String}

def begin.pre(+r: B.Pre, +op: M.Op, note: String) -> Begun:
  BgPre{r, B.is_union(op), B.pre_pairs_p(r), B.pre_pairs_q(r), B.pre_tz(r), note}

def begin.root(r: Root, +uc: Y.Uc) -> Begun:
  match r:
    case RDone{e}:
      BgDone{e, uc_note(uc)}
    case RFull{+op, a, b}:
      begin.pre(B.pre(op, a, b, leaves(), uc), op, uc_note(uc))

def begin(s: Staged) -> Begun:
  Staged{r, uc} = s
  begin.root(r, uc)

# Stage 2: the decisions (the device kernel), sequentially for P and Q.
type Decided is Data:
  DcDone{e: Ev, note: String}
  DcPost{pre: B.Pre, hp: I.Hits, hq: I.Hits, note: String}

def decide(b: Begun) -> Decided:
  match b:
    case BgDone{e, n}:
      DcDone{e, n}
    case BgPre{pre, +eP, pp, pq, +tz, n}:
      hp = I.decide(pp, eP, True{}, tz)
      hq = I.decide(pq, eP, False{}, tz)
      DcPost{pre, hp, hq, n}

def noted(o: M.Outcome, n: String) -> M.Outcome:
  match o:
    case M.Solved{m}:
      M.Solved{m}
    case M.Unresolved{r}:
      M.Unresolved{r ++ n}

def bout_outcome(b: B.BOut) -> M.Outcome:
  match b:
    case B.BOk{m}:
      M.Solved{m}
    case B.BBad{r}:
      M.Unresolved{r}

# Stage 3: winding, assembly, repair, triangulation.
def finish(d: Decided) -> M.Outcome:
  match d:
    case DcDone{e, n}:
      noted(to_outcome(e), n)
    case DcPost{pre, hp, hq, n}:
      noted(bout_outcome(B.post(pre, hp, hq, leaves())), n)

def parse(job: String) -> M.JobParse:
  MIO.parse_job(job)

def solve(p: M.JobParse) -> M.Outcome:
  finish(decide(begin(stage(p))))

def show(o: M.Outcome) -> String:
  MIO.show_outcome(o)

def run(job: String) -> String:
  show(solve(parse(job)))
