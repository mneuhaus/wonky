import Base
import ../../../kernel/real.bend as R
import ../../../kernel/analytic.bend as A
import ../../../scripts/build123d-workload.bend as W
import ../spike/core.bend as C
import ../spike/frontend.bend as FE
import ../spike/kernel-ops.bend as K
import ./real.bend as RL

# ===========================================================================
# Native evaluator for WK/0 graphs (docs/language/proposal-core-ir.md §7).
#
#   main <session-file>        run every graph of a session, in order, with one
#                              memo table shared across the graphs (sealed and
#                              checked strictly before anything runs; exit 3)
#   main fork|seq|serial <reps> <real-graph-file>
#                              the real-model evaluator (kernel/lang/wk/real.bend,
#                              docs/language.md §12): `fork` evaluates each level
#                              by fork-join over a pre-built tree, `seq` runs the
#                              same nodes one after another, `serial` also times
#                              each node; the graph is evaluated <reps> times in
#                              sequence and the last values are printed
#
# A WK graph is first-order SSA: no closures, no general recursion, no host
# calls. The host (src/lang/wk/encode-bend.mjs) sends it level by level; the
# nodes of one level are independent, so a level is evaluated by fork-join
# (`par`) and the whole graph needs no synchronization with the host. Every
# loop below is ONE self-recursive def that is structural in a list, a Nat
# count or a fuel Nat; intermediate results are passed as parameters of the
# next step (Bend: no forward references, no mutual recursion, match only on
# parameters and fields).
#
# The kernel builtins are the language spike's (kernel/lang/spike/
# kernel-ops.bend): the production topology.extrude, planar-boolean
# union/subtract and planar_measures, with capability errors carrying span ids.
# A node whose content hash is in the memo is not evaluated again.
# ===========================================================================

type NNode is Data:
  NNode{op: U32, span: U32, hi: U32, lo: U32, refs: List<&2, U32>, lits: List<&2, C.Value>}

type NodeRes is Data:
  NodeRes{node: Maybe<&2, NNode>, rest: List<&2, U32>}

type PtsRes is Data:
  PtsRes{pts: List<&2, C.Value>, rest: List<&2, U32>}

type NodesRes is Data:
  NodesRes{nodes: List<&2, NNode>, rest: List<&2, U32>}

type LevelsRes is Data:
  LevelsRes{levels: List<&2, List<&2, NNode>>, rest: List<&2, U32>}

type OutsRes is Data:
  OutsRes{outs: List<&2, U32>, rest: List<&2, U32>}

type Graph is Data:
  Graph{levels: List<&2, List<&2, NNode>>, outs: List<&2, U32>}

type GraphRes is Data:
  GraphRes{graph: Maybe<&2, Graph>, rest: List<&2, U32>}

type Memo is Data:
  Memo{hi: U32, lo: U32, v: C.Value}

type RunRes is Data:
  RunRes{env: List<&2, C.Value>, memo: List<&2, Memo>}

type Out is Data:
  Out{text: String, memo: List<&2, Memo>}

# --- decoding ------------------------------------------------------------------

def bad_node() -> NodeRes:
  NodeRes{Some{NNode{0, 0, 0, 0, Nil{}, Nil{}}}, Nil{}}

def f32_of(s: U32, m: U32, e: U32) -> C.Value:
  C.VNum{R.from_f32(FE.word(s, m, e))}

def real_of(s1: U32, m1: U32, e1: U32, s2: U32, m2: U32, e2: U32) -> C.Value:
  C.VNum{R.Real{FE.word(s1, m1, e1), FE.word(s2, m2, e2)}}

def points(n: Nat, toks: List<&2, U32>, acc: List<&2, C.Value>) -> PtsRes:
  match n:
    case 0n:
      PtsRes{List.reverse(&2, C.Value, acc), toks}
    case 1n+p:
      match toks:
        case s1 <> m1 <> e1 <> s2 <> m2 <> e2 <> rest:
          points(p, rest, C.VList{f32_of(s1, m1, e1) <> f32_of(s2, m2, e2) <> Nil{}} <> acc)
        case _:
          PtsRes{Nil{}, Nil{}}

def extrude_tail(span: U32, hi: U32, lo: U32, r: PtsRes) -> NodeRes:
  match r:
    case PtsRes{pts, rest}:
      match rest:
        case s1 <> m1 <> e1 <> s2 <> m2 <> e2 <> more:
          NodeRes{Some{NNode{1, span, hi, lo, Nil{}, C.VList{pts} <> f32_of(s1, m1, e1) <> f32_of(s2, m2, e2) <> Nil{}}}, more}
        case _:
          bad_node()

def two_refs(op: U32, span: U32, hi: U32, lo: U32, toks: List<&2, U32>) -> NodeRes:
  match toks:
    case a <> b <> rest:
      NodeRes{Some{NNode{op, span, hi, lo, a <> b <> Nil{}, Nil{}}}, rest}
    case _:
      bad_node()

def one_ref(op: U32, span: U32, hi: U32, lo: U32, toks: List<&2, U32>) -> NodeRes:
  match toks:
    case a <> rest:
      NodeRes{Some{NNode{op, span, hi, lo, a <> Nil{}, Nil{}}}, rest}
    case _:
      bad_node()

def range_node(span: U32, hi: U32, lo: U32, toks: List<&2, U32>) -> NodeRes:
  match toks:
    case a <> s1 <> m1 <> e1 <> s2 <> m2 <> e2 <> s3 <> m3 <> e3 <> s4 <> m4 <> e4 <> rest:
      NodeRes{Some{NNode{6, span, hi, lo, a <> Nil{}, real_of(s1, m1, e1, s2, m2, e2) <> real_of(s3, m3, e3, s4, m4, e4) <> Nil{}}}, rest}
    case _:
      bad_node()

def dec_payload(op: U32, span: U32, hi: U32, lo: U32, toks: List<&2, U32>) -> NodeRes:
  match op:
    case 1:
      match toks:
        case np <> rest:
          extrude_tail(span, hi, lo, points(U32.to_nat(np), rest, Nil{}))
        case _:
          bad_node()
    case 2:
      two_refs(2, span, hi, lo, toks)
    case 3:
      two_refs(3, span, hi, lo, toks)
    case 6:
      range_node(span, hi, lo, toks)
    case _:
      one_ref(op, span, hi, lo, toks)

def dec_node(toks: List<&2, U32>) -> NodeRes:
  match toks:
    case op <> span <> hi <> lo <> rest:
      dec_payload(op, span, hi, lo, rest)
    case _:
      bad_node()

def push_node(m: Maybe<&2, NNode>, acc: List<&2, NNode>) -> List<&2, NNode>:
  match m:
    case Some{x}:
      x <> acc
    case None{}:
      acc

# The previous step's NodeRes is a parameter, so its fields can be matched.
def nodes_loop(n: Nat, r: NodeRes, acc: List<&2, NNode>) -> NodesRes:
  match n:
    case 0n:
      match r:
        case NodeRes{m, rest}:
          NodesRes{List.reverse(&2, NNode, push_node(m, acc)), rest}
    case 1n+p:
      match r:
        case NodeRes{m, rest}:
          nodes_loop(p, dec_node(rest), push_node(m, acc))

def level_start(toks: List<&2, U32>) -> NodesRes:
  match toks:
    case c <> rest:
      nodes_loop(U32.to_nat(c), NodeRes{None{}, rest}, Nil{})
    case _:
      NodesRes{Nil{}, Nil{}}

# The first element pushed is an empty dummy level: harmless for evaluation.
def levels_loop(n: Nat, r: NodesRes, acc: List<&2, List<&2, NNode>>) -> LevelsRes:
  match n:
    case 0n:
      match r:
        case NodesRes{ns, rest}:
          LevelsRes{List.reverse(&2, List<&2, NNode>, ns <> acc), rest}
    case 1n+p:
      match r:
        case NodesRes{ns, rest}:
          levels_loop(p, level_start(rest), ns <> acc)

def outs_loop(n: Nat, toks: List<&2, U32>, acc: List<&2, U32>) -> OutsRes:
  match n:
    case 0n:
      OutsRes{List.reverse(&2, U32, acc), toks}
    case 1n+p:
      match toks:
        case d <> rest:
          outs_loop(p, rest, d <> acc)
        case _:
          OutsRes{Nil{}, Nil{}}

def graph_fin(lv: List<&2, List<&2, NNode>>, r: OutsRes) -> GraphRes:
  match r:
    case OutsRes{os, rest}:
      GraphRes{Some{Graph{lv, os}}, rest}

def graph_outs(r: LevelsRes) -> GraphRes:
  match r:
    case LevelsRes{lv, rest}:
      match rest:
        case n <> more:
          graph_fin(lv, outs_loop(U32.to_nat(n), more, Nil{}))
        case _:
          GraphRes{None{}, Nil{}}

def dec_graph(toks: List<&2, U32>) -> GraphRes:
  match toks:
    case nl <> rest:
      graph_outs(levels_loop(U32.to_nat(nl), NodesRes{Nil{}, rest}, Nil{}))
    case _:
      GraphRes{None{}, Nil{}}

def push_graph(m: Maybe<&2, Graph>, acc: List<&2, Graph>) -> List<&2, Graph>:
  match m:
    case Some{g}:
      g <> acc
    case None{}:
      acc

def graphs_loop(n: Nat, r: GraphRes, acc: List<&2, Graph>) -> List<&2, Graph>:
  match n:
    case 0n:
      match r:
        case GraphRes{m, rest}:
          List.reverse(&2, Graph, push_graph(m, acc))
    case 1n+p:
      match r:
        case GraphRes{m, rest}:
          graphs_loop(p, dec_graph(rest), push_graph(m, acc))

def session(toks: List<&2, U32>) -> List<&2, Graph>:
  match toks:
    case n <> rest:
      graphs_loop(U32.to_nat(n), GraphRes{None{}, rest}, Nil{})
    case _:
      Nil{}

# --- native ops ----------------------------------------------------------------

def single_check(span: U32, v: C.Value) -> C.Value:
  match v:
    case C.VBody{s, d}:
      C.VBool{True{}}
    case C.VErr{c, sp, m, t}:
      C.VErr{c, sp, m, t}
    case _:
      C.VErr{1, span, "expected exactly one solid body", Nil{}}

def expect_single(span: U32, xs: List<&2, C.Value>) -> C.Value:
  match xs:
    case v <> Nil{}:
      single_check(span, v)
    case _:
      C.VErr{3, span, "expect_single expects 1 argument", Nil{}}

def range_ok(ok: Bool, span: U32) -> C.Value:
  match ok:
    case True{}:
      C.VBool{True{}}
    case False{}:
      C.VErr{1, span, "measured value outside the expected range", Nil{}}

def range3(span: U32, x: C.Value, lo: C.Value, hi: C.Value) -> C.Value:
  match x:
    case C.VNum{+r}:
      match lo:
        case C.VNum{l}:
          match hi:
            case C.VNum{h}:
              range_ok(Bool.and(Bool.not(R.less(r, l)), Bool.not(R.less(h, r))), span)
            case _:
              C.VErr{2, span, "expect_range bounds must be numbers", Nil{}}
        case _:
          C.VErr{2, span, "expect_range bounds must be numbers", Nil{}}
    case C.VErr{c, sp, m, t}:
      C.VErr{c, sp, m, t}
    case _:
      C.VErr{2, span, "expect_range expects a number", Nil{}}

def expect_range(span: U32, xs: List<&2, C.Value>) -> C.Value:
  match xs:
    case x <> lo <> hi <> Nil{}:
      range3(span, x, lo, hi)
    case _:
      C.VErr{3, span, "expect_range expects 3 arguments", Nil{}}

def run_op(op: U32, span: U32, args: List<&2, C.Value>) -> C.Value:
  match op:
    case 1:
      K.prim_extrude(span, args)
    case 2:
      K.prim_boolean(span, args, False{})
    case 3:
      K.prim_boolean(span, args, True{})
    case 4:
      K.prim_measure(span, args, 0)
    case 5:
      K.prim_measure(span, args, 1)
    case 6:
      expect_range(span, args)
    case 7:
      expect_single(span, args)
    case _:
      C.VErr{7, span, "malformed WK stream or unknown native op", Nil{}}

# --- evaluation ------------------------------------------------------------------

def memo_find(memo: List<&2, Memo>, +hi: U32, +lo: U32) -> Maybe<&2, C.Value>:
  match memo:
    case Nil{}:
      None{}
    case m <> rest:
      Memo{h, l, v} = m
      Bool.pick(Maybe<&2, C.Value>, Bool.and(U32.is_eq(h, hi), U32.is_eq(l, lo)), Some{v}, memo_find(rest, hi, lo))

def memo_or(m: Maybe<&2, C.Value>, op: U32, span: U32, args: List<&2, C.Value>) -> C.Value:
  match m:
    case Some{v}:
      v
    case None{}:
      run_op(op, span, args)

def ref_values(refs: List<&2, U32>, +env: List<&2, C.Value>) -> List<&2, C.Value>:
  match refs:
    case Nil{}:
      Nil{}
    case r <> rest:
      C.lookup(env, r) <> ref_values(rest, env)

def eval_node(node: NNode, +env: List<&2, C.Value>, +memo: List<&2, Memo>) -> C.Value:
  NNode{op, span, hi, lo, refs, lits} = node
  memo_or(memo_find(memo, hi, lo), op, span, List.append(&2, C.Value, ref_values(refs, env), lits))

def take(xs: List<&2, NNode>, n: U32) -> List<&2, NNode>:
  match xs:
    case Nil{}:
      Nil{}
    case x <> rest:
      match n:
        case 0:
          Nil{}
        case _:
          x <> take(rest, (n - 1 : U32))

def drop(xs: List<&2, NNode>, n: U32) -> List<&2, NNode>:
  match xs:
    case Nil{}:
      Nil{}
    case x <> rest:
      match n:
        case 0:
          x <> rest
        case _:
          drop(rest, (n - 1 : U32))

type Tree is Data:
  TEmpty{}
  TLeaf{node: NNode}
  TFork{a: Tree, b: Tree}

# A balanced binary tree over the independent nodes of one level. The fork
# below happens on its FIELDS. Measured (proposal-core-ir.md §7.4): the same
# levels forked on computed arguments (take/drop results) ran only 2-way at 2,
# 4 and 8 threads; forking over this pre-built tree scaled.
def tree_of(fuel: Nat, +n: U32, +ns: List<&2, NNode>) -> Tree:
  match fuel:
    case 0n:
      TEmpty{}
    case 1n+ +f:
      match n:
        case 0:
          TEmpty{}
        case 1:
          match ns:
            case Nil{}:
              TEmpty{}
            case x <> rest:
              TLeaf{x}
        case _:
          +h = (n / 2 : U32)
          TFork{tree_of(f, h, take(ns, h)), tree_of(f, (n - h : U32), drop(ns, h))}

def run_tree(t: Tree, +env: List<&2, C.Value>, +memo: List<&2, Memo>) -> List<&2, C.Value>:
  match t:
    case TEmpty{}:
      Nil{}
    case TLeaf{node}:
      eval_node(node, env, memo) <> Nil{}
    case TFork{a, b}:
      x y = run_tree(a, env, memo) run_tree(b, env, memo)
      List.append(&2, C.Value, x, y)

def prepend_all(vals: List<&2, C.Value>, env: List<&2, C.Value>) -> List<&2, C.Value>:
  match vals:
    case Nil{}:
      env
    case v <> rest:
      prepend_all(rest, v <> env)

def remember(ns: List<&2, NNode>, vals: List<&2, C.Value>, memo: List<&2, Memo>) -> List<&2, Memo>:
  match ns:
    case Nil{}:
      memo
    case n <> rest:
      match n:
        case NNode{op, span, hi, lo, refs, lits}:
          match vals:
            case Nil{}:
              memo
            case v <> vs:
              remember(rest, vs, Memo{hi, lo, v} <> memo)

def next_run(l: List<&2, NNode>, +vals: List<&2, C.Value>, env: List<&2, C.Value>, memo: List<&2, Memo>) -> RunRes:
  RunRes{prepend_all(vals, env), remember(l, vals, memo)}

def run_levels(levels: List<&2, List<&2, NNode>>, r: RunRes) -> RunRes:
  match levels:
    case Nil{}:
      r
    case lvl <> rest:
      match r:
        case RunRes{+env, +memo}:
          +l = lvl
          run_levels(rest, next_run(l, run_tree(tree_of(64n, U32.from_nat(List.length(&2, NNode, l)), l), env, memo), env, memo))

def hit_of(m: Maybe<&2, C.Value>) -> U32:
  match m:
    case Some{v}:
      1
    case None{}:
      0

def hits_level(ns: List<&2, NNode>, +memo: List<&2, Memo>, acc: U32) -> U32:
  match ns:
    case Nil{}:
      acc
    case n <> rest:
      NNode{op, span, hi, lo, refs, lits} = n
      hits_level(rest, memo, (acc + hit_of(memo_find(memo, hi, lo)) : U32))

def hits(levels: List<&2, List<&2, NNode>>, +memo: List<&2, Memo>, acc: U32) -> U32:
  match levels:
    case Nil{}:
      acc
    case l <> rest:
      hits(rest, memo, hits_level(l, memo, acc))

def count_nodes(levels: List<&2, List<&2, NNode>>, acc: Nat) -> Nat:
  match levels:
    case Nil{}:
      acc
    case l <> rest:
      count_nodes(rest, Nat.add(acc, List.length(&2, NNode, l)))

def pick_outs(outs: List<&2, U32>, +env: List<&2, C.Value>) -> List<&2, C.Value>:
  match outs:
    case Nil{}:
      Nil{}
    case d <> rest:
      C.lookup(env, d) <> pick_outs(rest, env)

# --- reporting -------------------------------------------------------------------

def body_json_kept(+s: A.Solid) -> String:
  A.Solid{vs, es, fs} = s
  "{\"body\":{" ++ W.evidence_json(W.measured_evidence(s)) ++ ",\"faces\":" ++ Nat.show(List.length(&2, A.Face, fs)) ++ "}}"

def body_json(s: A.Solid) -> String:
  body_json_kept(s)

def make_out(k: U32, t0: Nat, t1: Nat, hit: U32, nodes: Nat, outs: List<&2, U32>, r: RunRes) -> Out:
  match r:
    case RunRes{+env, memo}:
      Out{"{\"graph\":" ++ U32.show(k) ++ ",\"evalMs\":" ++ Nat.show(Nat.sub(t1, t0)) ++ ",\"memoHits\":" ++ U32.show(hit) ++ ",\"nodes\":" ++ Nat.show(nodes) ++ ",\"outputs\":" ++ FE.show(~body_json, C.VList{pick_outs(outs, env)}) ++ "}\n", memo}

def levels_of(g: Graph) -> List<&2, List<&2, NNode>>:
  match g:
    case Graph{levels, outs}:
      levels

def outs_of(g: Graph) -> List<&2, U32>:
  match g:
    case Graph{levels, outs}:
      outs

# Each step receives the previous graph's Out as a parameter (see header).
def run_graphs(gs: List<&2, Graph>, prev: Out, +k: U32) -> IO(Unit):
  match gs:
    case Nil{}:
      match prev:
        case Out{text, memo}:
          IO.write(text)
    case +g <> rest:
      match prev:
        case Out{text, +memo}:
          +levels = levels_of(g)
          do IO<Unit>:
            IO.write(text)
            hit : U32 = hits(levels, memo, 0)
            n : Nat = count_nodes(levels, 0n)
            t0 : Nat <- IO.now()
            r : RunRes = run_levels(levels, RunRes{Nil{}, memo})
            t1 : Nat <- IO.now()
            run_graphs(rest, make_out(k, t0, t1, hit, n, outs_of(g), r), (k + 1 : U32))

# --- real-model mode (kernel/lang/wk/real.bend) -------------------------------------
#
#   fork   <reps> <file>   each level by fork-join over a pre-built tree (run_graph)
#   seq    <reps> <file>   the same code path with fork = False: the same nodes one
#                          after another (the serial baseline W of the spike gate)
#   serial <reps> <file>   like seq, but every node is timed (per-node costs for the
#                          cost-weighted bound); the timing IO makes it slower than seq
#
# Output: "D <decode us>", "R <us per rep>...", in serial mode "T <node> <us>" per
# node of the last rep, then "N <node> <value>" per node (real.bend node_line).

# Microsecond monotonic clock (kernel/lang/wk/now_us.c); IO.now has ms resolution.
def WK.now_us() -> IO(Nat):
  import "./now_us.c"
  import "./now_us.js"

type SerialRes is Data:
  SerialRes{env: List<&2, RL.Val>, times: List<&2, U32>}

def emit_nodes(ns: List<&2, RL.WNode>, vals: List<&2, RL.Val>) -> String:
  match ns:
    case Nil{}:
      ""
    case n <> rest:
      match vals:
        case v <> vrest:
          RL.node_line(RL.node_key(n), v) ++ emit_nodes(rest, vrest)
        case _:
          ""

# times holds (us, key) pairs, most recent first.
def times_text(ts: List<&2, U32>) -> String:
  match ts:
    case us <> key <> rest:
      "T " ++ RL.su(key) ++ U32.show(us) ++ "\n" ++ times_text(rest)
    case _:
      ""

def real_out(levels: List<&2, List<&2, RL.WNode>>, env: List<&2, RL.Val>, times: List<&2, U32>, reps: String) -> IO(Unit):
  do IO<Unit>:
    IO.write("R " ++ reps ++ "\n")
    IO.write(times_text(times))
    IO.write(emit_nodes(RL.flat_nodes(levels), List.reverse(&2, RL.Val, env)))

# Timed serial mode: one node after the other, each timed; refs resolve against
# the environment at the start of its level, exactly as in fork mode.
def serial_level(ns: List<&2, RL.WNode>, +k: RL.K, +env: List<&2, RL.Val>, acc: List<&2, RL.Val>, times: List<&2, U32>) -> IO(SerialRes):
  match ns:
    case Nil{}:
      IO.pure(SerialRes, SerialRes{acc, times})
    case +n <> rest:
      do IO<SerialRes>:
        t0 : Nat <- WK.now_us()
        v : RL.Val = RL.eval_node(k, n, env)
        t1 : Nat <- WK.now_us()
        serial_level(rest, k, env, v <> acc, U32.from_nat(Nat.sub(t1, t0)) <> RL.node_key(n) <> times)

def serial_levels(levels: List<&2, List<&2, RL.WNode>>, +k: RL.K, r: SerialRes) -> IO(SerialRes):
  match levels:
    case Nil{}:
      IO.pure(SerialRes, r)
    case l <> rest:
      match r:
        case SerialRes{+env, times}:
          do IO<SerialRes>:
            r2 : SerialRes <- serial_level(l, k, env, env, times)
            serial_levels(rest, k, r2)

def serial_reps(n: Nat, +levels: List<&2, List<&2, RL.WNode>>, +k: RL.K, acc: String, r: SerialRes) -> IO(Unit):
  match n:
    case 0n:
      match r:
        case SerialRes{env, times}:
          real_out(levels, env, times, acc)
    case 1n+p:
      do IO<Unit>:
        t0 : Nat <- WK.now_us()
        r2 : SerialRes <- serial_levels(levels, k, SerialRes{Nil{}, Nil{}})
        t1 : Nat <- WK.now_us()
        serial_reps(p, levels, k, acc ++ Nat.show(Nat.sub(t1, t0)) ++ " ", r2)

# fork and seq: RL.run_levels with fork = True / False, nothing else differs.
def level_reps(n: Nat, +fork: Bool, +levels: List<&2, List<&2, RL.WNode>>, +k: RL.K, acc: String, env: List<&2, RL.Val>) -> IO(Unit):
  match n:
    case 0n:
      real_out(levels, env, Nil{}, acc)
    case 1n+p:
      do IO<Unit>:
        t0 : Nat <- WK.now_us()
        vals : List<&2, RL.Val> = RL.run_levels(levels, fork, k, Nil{})
        t1 : Nat <- WK.now_us()
        level_reps(p, fork, levels, k, acc ++ Nat.show(Nat.sub(t1, t0)) ++ " ", vals)

# mode: 0 fork, 1 seq, 2 timed serial
def mode_prog(mode: U32, reps: Nat, levels: List<&2, List<&2, RL.WNode>>, k: RL.K) -> IO(Unit):
  match mode:
    case 0:
      level_reps(reps, True{}, levels, k, "", Nil{})
    case 1:
      level_reps(reps, False{}, levels, k, "", Nil{})
    case _:
      serial_reps(reps, levels, k, "", SerialRes{Nil{}, Nil{}})

# A malformed stream (real.bend program: bad token, inconsistent counts,
# leftover tokens, incomplete read) is rejected before anything is evaluated:
# exit code 3, the reason on stderr, no node lines. The host treats any
# nonzero exit as an error.
def real_prog(mode: U32, reps: Nat, p: RL.Program) -> IO(Unit):
  match p:
    case RL.Program{k, levels, ok, why}:
      match ok:
        case True{}:
          mode_prog(mode, reps, levels, k)
        case False{}:
          IO.die(Unit, 3, "malformed WK real-model stream: " ++ why)

# The whole file, checked against its size (File.size fails past 4 GiB).
type Sized is Data:
  Sized{text: String, size: U32}

def sized_done(p: File & Result<&1, &1, U32 & String, String>, size: U32) -> IO(Sized):
  (fh, r) = p
  do IO<Sized>:
    File.close(fh)
    text : String <- IO.pass(String, r)
    IO.pure(Sized, Sized{text, size})

def sized_read(fh: File, +size: U32) -> IO(Sized):
  do IO<Sized>:
    p : File & Result<&1, &1, U32 & String, String> <- File.read(fh, size)
    sized_done(p, size)

def sized_of(p: File & Result<&1, &1, U32 & String, U32>) -> IO(Sized):
  (fh, r) = p
  do IO<Sized>:
    size : U32 <- IO.pass(U32, r)
    sized_read(fh, size)

def read_stream(path: String) -> IO(Sized):
  do IO<Sized>:
    fh : File <- IO.try(File, File.open(path, "r"))
    p : File & Result<&1, &1, U32 & String, U32> <- File.size(fh)
    sized_of(p)

def run_sized(mode: U32, reps: Nat, s: Sized) -> IO(Unit):
  match s:
    case Sized{text, size}:
      do IO<Unit>:
        t0 : Nat <- WK.now_us()
        prog : RL.Program = RL.program(text, size)
        t1 : Nat <- WK.now_us()
        IO.write("D " ++ Nat.show(Nat.sub(t1, t0)) ++ "\n")
        real_prog(mode, reps, prog)

def run_real(mode: U32, reps: Nat, path: String) -> IO(Unit):
  do IO<Unit>:
    s : Sized <- read_stream(path)
    run_sized(mode, reps, s)

# --- the session mode: strict decoding ----------------------------------------
#
# A session stream carries the real mode's seal and is tokenized as strictly
# (RL.tokens: decimal U32 tokens and whitespace only, the whole file read):
# the number of tokens after the two seal tokens and their sum mod 2^32 come
# first. Its grammar is then checked BEFORE anything is decoded or evaluated:
#   session := ngraphs graph*        graph := nlevels level* nouts ref*
#   level   := nnodes node*          node  := op span hashHi hashLo payload
#   payload := 1: npoints (6 tokens)* 6 tokens | 2, 3: 2 refs | 4, 5, 7: 1 ref
#              | 6: 1 ref + 12 tokens
# Every count must be followed by that many items, no token may be left
# over, and each loop stops at the first violation, so a count is never used
# as fuel beyond the tokens that are actually there (verifier round 3: a
# real-mode stream given to the old lenient decoder took a checksum as its
# level count and grew to 33 GB). A violation exits with code 3, before
# evaluation, with the reason on stderr.

type SV is Data:
  SV{ok: Bool, rest: List<&2, U32>}

def sv_bad() -> SV:
  SV{False{}, Nil{}}

def sv_drop(n: Nat, toks: List<&2, U32>) -> SV:
  match n:
    case 0n:
      SV{True{}, toks}
    case 1n+p:
      match toks:
        case t <> rest:
          sv_drop(p, rest)
        case _:
          sv_bad()

def sv_then(r: SV, n: Nat) -> SV:
  match r:
    case SV{ok, rest}:
      match ok:
        case True{}:
          sv_drop(n, rest)
        case False{}:
          sv_bad()

def sv_points(n: Nat, r: SV) -> SV:
  match n:
    case 0n:
      r
    case 1n+p:
      match r:
        case SV{ok, rest}:
          match ok:
            case True{}:
              sv_points(p, sv_drop(6n, rest))
            case False{}:
              sv_bad()

def sv_payload(op: U32, toks: List<&2, U32>) -> SV:
  match op:
    case 1:
      match toks:
        case np <> rest:
          sv_then(sv_points(U32.to_nat(np), SV{True{}, rest}), 6n)
        case _:
          sv_bad()
    case 2:
      sv_drop(2n, toks)
    case 3:
      sv_drop(2n, toks)
    case 4:
      sv_drop(1n, toks)
    case 5:
      sv_drop(1n, toks)
    case 6:
      sv_drop(13n, toks)
    case 7:
      sv_drop(1n, toks)
    case _:
      sv_bad()

def sv_node(r: SV) -> SV:
  match r:
    case SV{ok, toks}:
      match ok:
        case True{}:
          match toks:
            case op <> span <> hi <> lo <> rest:
              sv_payload(op, rest)
            case _:
              sv_bad()
        case False{}:
          sv_bad()

def sv_nodes(n: Nat, r: SV) -> SV:
  match n:
    case 0n:
      r
    case 1n+p:
      match r:
        case SV{ok, rest}:
          match ok:
            case True{}:
              sv_nodes(p, sv_node(SV{True{}, rest}))
            case False{}:
              sv_bad()

def sv_level(r: SV) -> SV:
  match r:
    case SV{ok, toks}:
      match ok:
        case True{}:
          match toks:
            case c <> rest:
              sv_nodes(U32.to_nat(c), SV{True{}, rest})
            case _:
              sv_bad()
        case False{}:
          sv_bad()

def sv_levels(n: Nat, r: SV) -> SV:
  match n:
    case 0n:
      r
    case 1n+p:
      match r:
        case SV{ok, rest}:
          match ok:
            case True{}:
              sv_levels(p, sv_level(SV{True{}, rest}))
            case False{}:
              sv_bad()

def sv_outs(r: SV) -> SV:
  match r:
    case SV{ok, toks}:
      match ok:
        case True{}:
          match toks:
            case n <> more:
              sv_drop(U32.to_nat(n), more)
            case _:
              sv_bad()
        case False{}:
          sv_bad()

def sv_graph(r: SV) -> SV:
  match r:
    case SV{ok, toks}:
      match ok:
        case True{}:
          match toks:
            case nl <> rest:
              sv_outs(sv_levels(U32.to_nat(nl), SV{True{}, rest}))
            case _:
              sv_bad()
        case False{}:
          sv_bad()

def sv_graphs(n: Nat, r: SV) -> SV:
  match n:
    case 0n:
      r
    case 1n+p:
      match r:
        case SV{ok, rest}:
          match ok:
            case True{}:
              sv_graphs(p, sv_graph(SV{True{}, rest}))
            case False{}:
              sv_bad()

def sv_session(toks: List<&2, U32>) -> SV:
  match toks:
    case n <> rest:
      sv_graphs(U32.to_nat(n), SV{True{}, rest})
    case _:
      sv_bad()

def sv_complete(r: SV) -> Bool:
  match r:
    case SV{ok, rest}:
      match ok:
        case True{}:
          match rest:
            case Nil{}:
              True{}
            case _:
              False{}
        case False{}:
          False{}

type SChk is Data:
  SChk{ok: Bool, why: String, toks: List<&2, U32>}

def schk_bad(why: String) -> SChk:
  SChk{False{}, why, Nil{}}

def schk_grammar_ok(ok: Bool, toks: List<&2, U32>) -> SChk:
  match ok:
    case True{}:
      SChk{True{}, "", toks}
    case False{}:
      schk_bad("a graph, level, node or output count does not match the tokens, an op code is unknown, or tokens are left over")

def schk_grammar(+toks: List<&2, U32>) -> SChk:
  schk_grammar_ok(sv_complete(sv_session(toks)), toks)

def schk_sealed(sealed: Bool, rest: List<&2, U32>) -> SChk:
  match sealed:
    case True{}:
      schk_grammar(rest)
    case False{}:
      schk_bad("the seal does not match (token count or checksum): the stream was cut or altered")

def schk_seal(xs: List<&2, U32>, +n: U32, +sum: U32) -> SChk:
  match xs:
    case +count <> +check <> rest:
      schk_sealed(Bool.and(U32.is_eq(count, (n - 2 : U32)), U32.is_eq(check, (sum - count - check : U32))), rest)
    case _:
      schk_bad("the seal (token count and checksum) is missing")

def schk_sized(complete: Bool, xs: List<&2, U32>, chars: U32, size: U32, n: U32, sum: U32) -> SChk:
  match complete:
    case True{}:
      schk_seal(xs, n, sum)
    case False{}:
      schk_bad("the stream was not read completely (" ++ U32.show(chars) ++ " of " ++ U32.show(size) ++ " bytes)")

def schk_of(t: RL.Toks, +size: U32) -> SChk:
  match t:
    case RL.Toks{ok, xs, +chars, n, sum}:
      match ok:
        case False{}:
          schk_bad("a token is not a decimal U32 (bad character or above 4294967295)")
        case True{}:
          schk_sized(U32.is_eq(chars, size), xs, chars, size, n, sum)

def run_session(c: SChk) -> IO(Unit):
  match c:
    case SChk{ok, why, toks}:
      match ok:
        case True{}:
          do IO<Unit>:
            t0 : Nat <- IO.now()
            gs : List<&2, Graph> = session(toks)
            t1 : Nat <- IO.now()
            IO.write("{\"decodeMs\":" ++ Nat.show(Nat.sub(t1, t0)) ++ "}\n")
            run_graphs(gs, Out{"", Nil{}}, 0)
        case False{}:
          IO.die(Unit, 3, "malformed WK session stream: " ++ why)

def run_session_sized(s: Sized) -> IO(Unit):
  match s:
    case Sized{text, +size}:
      run_session(schk_of(RL.tokens(text), size))

def run_file(path: String) -> IO(Unit):
  do IO<Unit>:
    s : Sized <- read_stream(path)
    run_session_sized(s)

def mode_code(+mode: String) -> U32:
  Bool.pick(U32, String.eq(mode, "fork"), 0, Bool.pick(U32, String.eq(mode, "seq"), 1, Bool.pick(U32, String.eq(mode, "serial"), 2, 3)))

# reps must be a decimal number of at least 1: every mode prints the values of
# the last repetition, so 0 repetitions would print no node lines at all.
def reps_ok(m: Maybe<&2, U32>, code: U32, path: String) -> IO(Unit):
  match m:
    case Some{+n}:
      match n:
        case 0:
          IO.die(Unit, 2, "reps must be at least 1")
        case _:
          run_real(code, U32.to_nat(n), path)
    case None{}:
      IO.die(Unit, 2, "reps must be a decimal number")

def real_mode(code: U32, reps: String, path: String) -> IO(Unit):
  match code:
    case 3:
      IO.die(Unit, 2, "usage: main fork|seq|serial <reps> <real-graph-file>")
    case _:
      reps_ok(U32.read(reps), code, path)

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case path <> Nil{}:
      run_file(path)
    case mode <> reps <> path <> Nil{}:
      real_mode(mode_code(mode), reps, path)
    case _:
      IO.die(Unit, 2, "usage: main <wk-session-file> | main fork|seq|serial <reps> <real-graph-file>")

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
