import Base
import ../../../kernel/real.bend as R
import ../../../kernel/analytic.bend as A
import ../../../kernel/face-classification.bend as F

# ===========================================================================
# wonky core-language spike: types, pure primitives and the evaluator.
#
# This file has no kernel dependency. kernel/lang/spike/kernel-ops.bend adds
# the geometry builtins and kernel/lang/spike/main.bend the IO entrypoints.
# Documented in docs/language/bend-feasibility.md.
#
# Bend constraints that shape this file:
# - no forward references: Expr, then Value, then Task, then helpers, then
#   the single recursive `step`;
# - no mutual recursion: eval / apply / eval-list / branch / let are ONE def
#   (`step`) selected by a Task constructor; the non-recursive parts of apply
#   and branch are helpers that RETURN the next Task instead of calling step;
# - match only on parameters or pattern-bound fields, so every "match on a
#   computed value" becomes a helper call;
# - live recursion must terminate: step consumes a depth fuel Nat.
# ===========================================================================

# Primitive operations. A dedicated enum keeps dispatch a single constructor
# match; the integer opcode is mapped once at decode time.
type Op is Data:
  OAdd{}
  OSub{}
  OMul{}
  ODiv{}
  OLt{}
  OLe{}
  OEq{}
  ONot{}
  ONeg{}
  OCons{}
  OHead{}
  OTail{}
  OEmpty{}
  OLen{}
  ONth{}
  OAppend{}
  OMapNew{}
  OMapSet{}
  OMapGet{}
  OMapHas{}
  OStrCat{}
  OError{}
  OExtrude{}
  OUnion{}
  OSubtract{}
  OVolume{}
  OFaces{}
  OUnknown{code: U32}

# Core expressions. Variables are de Bruijn indices resolved by the host
# compiler (src/lang/spike-compile.mjs). Nodes that can fail carry a span id
# that the host maps back to a source location.
type Expr is Data:
  ENum{v: R.Real}
  EStr{s: String}
  EBool{b: Bool}
  EUnit{}
  EVar{i: U32}
  ELam{arity: U32, body: Expr}
  ERec{arity: U32, body: Expr}
  EApp{span: U32, f: Expr, args: List<&2, Expr>}
  ELet{x: Expr, body: Expr}
  EIf{span: U32, c: Expr, t: Expr, e: Expr}
  EPrim{span: U32, op: Op, args: List<&2, Expr>}
  EList{items: List<&2, Expr>}
  EPar{a: Expr, b: Expr}
  EBad{code: U32}

# Runtime values. VBody is the opaque kernel handle: a planar analytic solid
# plus the per-edge domain choices the planar Boolean needs for chaining.
# Only the kernel types are imported here; the kernel OPERATIONS are linked
# through the ~kernel template of `step` (kernel-ops.bend).
type Value is Data:
  VNum{v: R.Real}
  VBool{b: Bool}
  VStr{s: String}
  VUnit{}
  VList{xs: List<&2, Value>}
  VMap{m: Map<&2, Value>}
  VClo{arity: U32, rec: Bool, body: Expr, env: List<&2, Value>}
  VBody{solid: A.Solid, domains: List<&2, F.DomainChoice>}
  VErr{code: U32, span: U32, msg: String, trace: List<&2, U32>}

# Error codes (mirrored in src/lang/spike-compile.mjs).
#  1 user error      2 type error      3 arity error     4 unbound variable
#  5 fuel exhausted  6 capability      7 decode error    8 not callable
#  9 index range

type Task is Data:
  TDone{v: Value}
  TEval{e: Expr, env: List<&2, Value>}
  TList{es: List<&2, Expr>, env: List<&2, Value>}

def err(code: U32, span: U32, msg: String) -> Value:
  VErr{code, span, msg, Nil{}}

def is_err(v: Value) -> Bool:
  match v:
    case VErr{c, s, m, t}:
      True{}
    case _:
      False{}

def lookup(env: List<&2, Value>, i: U32) -> Value:
  match env:
    case Nil{}:
      err(4, 0, "unbound variable index")
    case h <> t:
      match i:
        case 0:
          h
        case _:
          lookup(t, (i - 1 : U32))

# Prepends an evaluated argument list onto a closure environment, counting
# the arguments for the arity check.
def push_args(xs: List<&2, Value>, env: List<&2, Value>, n: U32) -> List<&2, Value> & U32:
  match xs:
    case Nil{}:
      (env, n)
    case h <> t:
      push_args(t, h <> env, (n + 1 : U32))

def with_trace(+span: U32, v: Value) -> Value:
  match v:
    case VErr{c, s, m, t}:
      VErr{c, s, m, span <> t}
    case _:
      v

def enter_pick(ok: Bool, span: U32, arity: U32, +n: U32, body: Expr, env: List<&2, Value>) -> Task:
  match ok:
    case True{}:
      TEval{body, env}
    case False{}:
      TDone{err(3, span, "closure expects " ++ U32.show(arity) ++ " arguments, got " ++ U32.show(n))}

def enter(+span: U32, +arity: U32, body: Expr, pushed: List<&2, Value> & U32) -> Task:
  (env, +n) = pushed
  enter_pick(U32.is_eq(arity, n), span, arity, n, body, env)

def self_env(rec: Bool, +arity: U32, +body: Expr, +cenv: List<&2, Value>) -> List<&2, Value>:
  match rec:
    case True{}:
      VClo{arity, True{}, body, cenv} <> cenv
    case False{}:
      cenv

def apply_clo(av: Value, +span: U32, +arity: U32, body: Expr, env: List<&2, Value>) -> Task:
  match av:
    case VList{xs}:
      enter(span, arity, body, push_args(xs, env, 0))
    case _:
      TDone{av}

# The non-recursive half of application: returns the next task. A recursive
# closure re-binds itself (index = arity) below its arguments.
def apply_task(+span: U32, fv: Value, av: Value) -> Task:
  match fv:
    case VClo{+arity, rec, +body, +cenv}:
      apply_clo(av, span, arity, body, self_env(rec, arity, body, cenv))
    case VErr{c, s, m, t}:
      TDone{VErr{c, s, m, t}}
    case _:
      TDone{err(8, span, "value is not callable")}

def branch_task(+span: U32, c: Value, t: Expr, e: Expr, env: List<&2, Value>) -> Task:
  match c:
    case VBool{b}:
      match b:
        case True{}:
          TEval{t, env}
        case False{}:
          TEval{e, env}
    case VErr{c2, s, m, tr}:
      TDone{VErr{c2, s, m, tr}}
    case _:
      TDone{err(2, span, "if condition must be a boolean")}

def bind_pick(bad: Bool, x: Value, body: Expr, env: List<&2, Value>) -> Task:
  match bad:
    case True{}:
      TDone{x}
    case False{}:
      TEval{body, x <> env}

def bind_task(+x: Value, body: Expr, env: List<&2, Value>) -> Task:
  bind_pick(is_err(x), x, body, env)

def cons_pick(bad: Bool, a: Value, b: Value) -> Value:
  match bad:
    case True{}:
      a
    case False{}:
      match b:
        case VList{xs}:
          VList{a <> xs}
        case _:
          b

def cons_value(+a: Value, b: Value) -> Value:
  cons_pick(is_err(a), a, b)

def concat_values(a: Value, b: Value) -> Value:
  match a:
    case VList{xs}:
      match b:
        case VList{ys}:
          VList{List.append(&2, Value, xs, ys)}
        case _:
          b
    case _:
      a

# ---------------------------------------------------------------------------
# Pure primitives (no closures are called from primitives, so they cannot
# re-enter the evaluator; higher-order std functions live in the core-language
# prelude instead).

def num2(+span: U32, a: Value, b: Value, which: U32) -> Value:
  match a:
    case VNum{x}:
      match b:
        case VNum{y}:
          match which:
            case 0:
              VNum{R.add(x, y)}
            case 1:
              VNum{R.sub(x, y)}
            case 2:
              VNum{R.mul(x, y)}
            case 3:
              VNum{R.div(x, y)}
            case 4:
              VBool{R.less(x, y)}
            case _:
              VBool{Bool.not(R.less(y, x))}
        case VErr{c, s, m, t}:
          VErr{c, s, m, t}
        case _:
          err(2, span, "arithmetic expects numbers")
    case VErr{c, s, m, t}:
      VErr{c, s, m, t}
    case _:
      err(2, span, "arithmetic expects numbers")

def arith(+span: U32, which: U32, xs: List<&2, Value>) -> Value:
  match xs:
    case a <> b <> Nil{}:
      num2(span, a, b, which)
    case _:
      err(3, span, "binary operator expects 2 arguments")

def equal_values(+span: U32, a: Value, b: Value) -> Value:
  match a:
    case VNum{x}:
      match b:
        case VNum{y}:
          VBool{R.equal(x, y)}
        case _:
          VBool{False{}}
    case VBool{x}:
      match b:
        case VBool{y}:
          VBool{Bool.not(Bool.xor(x, y))}
        case _:
          VBool{False{}}
    case VStr{x}:
      match b:
        case VStr{y}:
          VBool{String.eq(x, y)}
        case _:
          VBool{False{}}
    case VUnit{}:
      match b:
        case VUnit{}:
          VBool{True{}}
        case _:
          VBool{False{}}
    case VErr{c, s, m, t}:
      VErr{c, s, m, t}
    case _:
      err(2, span, "= compares numbers, booleans, strings or unit")

def index_pick(ok: Bool, u: U32) -> Maybe<&2, U32>:
  match ok:
    case True{}:
      Some{u}
    case False{}:
      None{}

def exact_index(+hi: F32, lo: F32) -> Maybe<&2, U32>:
  +u = F32.to_u32(hi)
  index_pick(Bool.and(F32.is_eq(lo, 0.0), Bool.and(F32.is_eq(U32.to_f32(u), hi), (hi >= 0.0 : F32))), u)

def nth_got(+span: U32, got: Maybe<&2, Value>) -> Value:
  match got:
    case None{}:
      err(9, span, "list index out of range")
    case Some{v}:
      v

def nth_index(+span: U32, xs: List<&2, Value>, i: Maybe<&2, U32>) -> Value:
  match i:
    case None{}:
      err(9, span, "list index must be a non-negative integer")
    case Some{k}:
      nth_got(span, List.get(&2, Value, xs, U32.to_nat(k)))

# Bend rule learned here: after a nested pattern such as `a <> Nil{}` the
# head binder `a` can no longer be scrutinized (the tail was matched after it
# was bound), so every multi-argument primitive destructures its argument
# list once and hands the elements to a helper that matches them in order.

def list_head(+span: U32, ys: List<&2, Value>) -> Value:
  match ys:
    case Nil{}:
      err(9, span, "head of empty list")
    case h <> t:
      h

def list_tail(+span: U32, ys: List<&2, Value>) -> Value:
  match ys:
    case Nil{}:
      err(9, span, "tail of empty list")
    case h <> t:
      VList{t}

def list_op(+span: U32, op: U32, ys: List<&2, Value>) -> Value:
  match op:
    case 0:
      list_head(span, ys)
    case 1:
      list_tail(span, ys)
    case 2:
      VBool{List.is_empty(&2, Value, ys)}
    case _:
      VNum{R.from_f32(U32.to_f32(U32.from_nat(List.length(&2, Value, ys))))}

def list_one(+span: U32, a: Value, op: U32) -> Value:
  match a:
    case VList{ys}:
      list_op(span, op, ys)
    case VErr{c, s, m, t}:
      VErr{c, s, m, t}
    case _:
      err(2, span, "list operation expects a list")

def list_prim(+span: U32, xs: List<&2, Value>, op: U32) -> Value:
  match xs:
    case a <> Nil{}:
      list_one(span, a, op)
    case _:
      err(3, span, "list operation expects 1 argument")

def cons_two(+span: U32, h: Value, l: Value) -> Value:
  match l:
    case VList{ys}:
      cons_value(h, VList{ys})
    case VErr{c, s, m, t}:
      VErr{c, s, m, t}
    case _:
      err(2, span, "cons expects a list as second argument")

def prim_cons(+span: U32, xs: List<&2, Value>) -> Value:
  match xs:
    case h <> l <> Nil{}:
      cons_two(span, h, l)
    case _:
      err(3, span, "cons expects 2 arguments")

def append_two(+span: U32, a: Value, b: Value) -> Value:
  match a:
    case VList{p}:
      match b:
        case VList{q}:
          VList{List.append(&2, Value, p, q)}
        case _:
          err(2, span, "append expects lists")
    case _:
      err(2, span, "append expects lists")

def prim_append(+span: U32, xs: List<&2, Value>) -> Value:
  match xs:
    case a <> b <> Nil{}:
      append_two(span, a, b)
    case _:
      err(3, span, "append expects 2 arguments")

def nth_two(+span: U32, l: Value, i: Value) -> Value:
  match l:
    case VList{ys}:
      match i:
        case VNum{r}:
          R.Real{+hi, lo} = r
          nth_index(span, ys, exact_index(hi, lo))
        case _:
          err(2, span, "nth expects a number index")
    case _:
      err(2, span, "nth expects a list")

def prim_nth(+span: U32, xs: List<&2, Value>) -> Value:
  match xs:
    case l <> i <> Nil{}:
      nth_two(span, l, i)
    case _:
      err(3, span, "nth expects 2 arguments")

def got_value(p: Map<&2, Value> & Value) -> Value:
  (m, v) = p
  v

def got_bool(p: Map<&2, Value> & Bool) -> Bool:
  (m, b) = p
  b

def map_set3(+span: U32, m: Value, k: Value, v: Value) -> Value:
  match m:
    case VMap{mm}:
      match k:
        case VStr{key}:
          VMap{Map.set(&2, Value, mm, key, v)}
        case _:
          err(2, span, "map keys are strings")
    case _:
      err(2, span, "map-set expects a map")

def map_get3(+span: U32, m: Value, k: Value, d: Value) -> Value:
  match m:
    case VMap{mm}:
      match k:
        case VStr{key}:
          got_value(Map.get(Value, d, mm, key))
        case _:
          err(2, span, "map keys are strings")
    case _:
      err(2, span, "map-get expects a map")

def map_has2(+span: U32, m: Value, k: Value) -> Value:
  match m:
    case VMap{mm}:
      match k:
        case VStr{key}:
          VBool{got_bool(Map.has(&2, Value, mm, key))}
        case _:
          err(2, span, "map keys are strings")
    case _:
      err(2, span, "map-has expects a map")

def prim_map(+span: U32, op: U32, xs: List<&2, Value>) -> Value:
  match op:
    case 0:
      VMap{Map.new(&2, Value)}
    case 1:
      match xs:
        case m <> k <> v <> Nil{}:
          map_set3(span, m, k, v)
        case _:
          err(3, span, "map-set expects 3 arguments")
    case 2:
      match xs:
        case m <> k <> d <> Nil{}:
          map_get3(span, m, k, d)
        case _:
          err(3, span, "map-get expects 3 arguments")
    case _:
      match xs:
        case m <> k <> Nil{}:
          map_has2(span, m, k)
        case _:
          err(3, span, "map-has expects 2 arguments")

def str_two(+span: U32, a: Value, b: Value) -> Value:
  match a:
    case VStr{p}:
      match b:
        case VStr{q}:
          VStr{p ++ q}
        case _:
          err(2, span, "str++ expects strings")
    case _:
      err(2, span, "str++ expects strings")

def prim_str(+span: U32, xs: List<&2, Value>) -> Value:
  match xs:
    case a <> b <> Nil{}:
      str_two(span, a, b)
    case _:
      err(3, span, "str++ expects 2 arguments")

def error_one(+span: U32, m: Value) -> Value:
  match m:
    case VStr{s}:
      err(1, span, s)
    case _:
      err(1, span, "error raised with a non-string value")

def prim_error(+span: U32, xs: List<&2, Value>) -> Value:
  match xs:
    case m <> Nil{}:
      error_one(span, m)
    case _:
      err(3, span, "error expects 1 argument")

def not_one(+span: U32, a: Value) -> Value:
  match a:
    case VBool{b}:
      VBool{Bool.not(b)}
    case VNum{x}:
      VNum{R.neg(x)}
    case VErr{c, s, m, t}:
      VErr{c, s, m, t}
    case _:
      err(2, span, "not/neg expects a boolean or number")

def prim_not(+span: U32, xs: List<&2, Value>) -> Value:
  match xs:
    case a <> Nil{}:
      not_one(span, a)
    case _:
      err(3, span, "not/neg expects 1 argument")

def prim_eq(+span: U32, xs: List<&2, Value>) -> Value:
  match xs:
    case a <> b <> Nil{}:
      equal_values(span, a, b)
    case _:
      err(3, span, "= expects 2 arguments")

# Pure primitive dispatch. Kernel operations are dispatched through the
# `~kernel` template parameter of `step`, so this file stays kernel-free and
# the kernel layer is inlined at compile time (no runtime indirection).
def pure_prim(+span: U32, op: Op, xs: List<&2, Value>) -> Value:
  match op:
    case OAdd{}:
      arith(span, 0, xs)
    case OSub{}:
      arith(span, 1, xs)
    case OMul{}:
      arith(span, 2, xs)
    case ODiv{}:
      arith(span, 3, xs)
    case OLt{}:
      arith(span, 4, xs)
    case OLe{}:
      arith(span, 5, xs)
    case OEq{}:
      prim_eq(span, xs)
    case ONot{}:
      prim_not(span, xs)
    case ONeg{}:
      prim_not(span, xs)
    case OCons{}:
      prim_cons(span, xs)
    case OHead{}:
      list_prim(span, xs, 0)
    case OTail{}:
      list_prim(span, xs, 1)
    case OEmpty{}:
      list_prim(span, xs, 2)
    case OLen{}:
      list_prim(span, xs, 3)
    case ONth{}:
      prim_nth(span, xs)
    case OAppend{}:
      prim_append(span, xs)
    case OMapNew{}:
      prim_map(span, 0, xs)
    case OMapSet{}:
      prim_map(span, 1, xs)
    case OMapGet{}:
      prim_map(span, 2, xs)
    case OMapHas{}:
      prim_map(span, 3, xs)
    case OStrCat{}:
      prim_str(span, xs)
    case OError{}:
      prim_error(span, xs)
    case _:
      err(6, span, "primitive is not available in this evaluator build")

def prim_args(~kernel: U32 -> Op -> List<&2, Value> -> Value, +span: U32, op: Op, args: Value) -> Value:
  match args:
    case VList{xs}:
      kernel(span, op, xs)
    case _:
      args

# ---------------------------------------------------------------------------
# The evaluator. ONE recursive def; `fuel` bounds the evaluation DEPTH (not
# the step count): every nested step call consumes one unit. A Nat is passed
# unchanged or shrunk, which is what Bend's termination checker accepts.

def step(~kernel: U32 -> Op -> List<&2, Value> -> Value, fuel: Nat, task: Task) -> Value:
  match fuel:
    case 0n:
      err(5, 0, "evaluation depth fuel exhausted")
    case 1n+ +f:
      match task:
        case TDone{v}:
          v
        case TEval{e, +env}:
          match e:
            case ENum{v}:
              VNum{v}
            case EStr{s}:
              VStr{s}
            case EBool{b}:
              VBool{b}
            case EUnit{}:
              VUnit{}
            case EVar{i}:
              lookup(env, i)
            case ELam{a, b}:
              VClo{a, False{}, b, env}
            case ERec{a, b}:
              VClo{a, True{}, b, env}
            case EApp{+span, fe, args}:
              fv = step(~kernel, f, TEval{fe, env})
              av = step(~kernel, f, TList{args, env})
              with_trace(span, step(~kernel, f, apply_task(span, fv, av)))
            case ELet{x, body}:
              step(~kernel, f, bind_task(step(~kernel, f, TEval{x, env}), body, env))
            case EIf{+span, c, t, el}:
              step(~kernel, f, branch_task(span, step(~kernel, f, TEval{c, env}), t, el, env))
            case EPrim{+span, op, args}:
              prim_args(~kernel, span, op, step(~kernel, f, TList{args, env}))
            case EList{items}:
              step(~kernel, f, TList{items, env})
            case EPar{a, b}:
              # fork-join: both halves are independent pure evaluations.
              x y = step(~kernel, f, TEval{a, env}) step(~kernel, f, TEval{b, env})
              concat_values(x, y)
            case EBad{code}:
              err(7, code, "malformed core program")
        case TList{es, +env}:
          match es:
            case Nil{}:
              VList{Nil{}}
            case h <> t:
              cons_value(step(~kernel, f, TEval{h, env}), step(~kernel, f, TList{t, env}))

def run(~kernel: U32 -> Op -> List<&2, Value> -> Value, fuel: Nat, prog: Expr) -> Value:
  step(~kernel, fuel, TEval{prog, Nil{}})
