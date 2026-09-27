import Base
import ../../../kernel/real.bend as R
import ../../../kernel/analytic.bend as A
import ../../../kernel/ports/planar-boolean.bend as PB
import ../../../scripts/build123d-workload.bend as W
import ./core.bend as C
import ./frontend.bend as FE
import ./kernel-ops.bend as K
import ./tokenize.bend as TK

# ===========================================================================
# Native entrypoint of the core-language spike (docs/language/bend-feasibility.md).
#
#   main eval <ast-file> <fuel> <reps>    decode + evaluate a serialized core
#                                         program <reps> times (kernel linked)
#   main pure <ast-file> <fuel> <reps>    same, kernel builtins disabled
#   main tokenize <fs-file> <reps>        native FeatureScript tokenizer
#   main ref <case> <reps>                the same kernel calls without the
#                                         evaluator (3 union, 4 pocket,
#                                         5 frame-with-tab)
#
# Every mode prints ONE JSON line. Times are IO.now milliseconds around the
# pure computation; process start and file reading are outside them.
# ===========================================================================

def body_json_kept(+s: A.Solid) -> String:
  A.Solid{vs, es, fs} = s
  "{\"body\":{" ++ W.evidence_json(W.measured_evidence(s)) ++ ",\"faces\":" ++ Nat.show(List.length(&2, A.Face, fs)) ++ "}}"

def body_json(s: A.Solid) -> String:
  body_json_kept(s)

def eval_loop(left: Nat, +fuel: Nat, +prog: C.Expr, last: C.Value) -> C.Value:
  match left:
    case 0n:
      last
    case 1n+p:
      eval_loop(p, fuel, prog, C.run(~K.kernel, fuel, prog))

def pure_loop(left: Nat, +fuel: Nat, +prog: C.Expr, last: C.Value) -> C.Value:
  match left:
    case 0n:
      last
    case 1n+p:
      pure_loop(p, fuel, prog, C.run(~K.no_kernel, fuel, prog))

def pick_loop(kernel: Bool, reps: Nat, +fuel: Nat, +prog: C.Expr) -> C.Value:
  match kernel:
    case True{}:
      eval_loop(reps, fuel, prog, C.VUnit{})
    case False{}:
      pure_loop(reps, fuel, prog, C.VUnit{})

def ms(t1: Nat, t0: Nat) -> String:
  Nat.show(Nat.sub(t1, t0))

def report_eval(t0: Nat, t1: Nat, t2: Nat, +tokens: Nat, v: C.Value) -> IO(Unit):
  +a = t1
  IO.print("{\"mode\":\"eval\",\"astTokens\":" ++ Nat.show(tokens) ++ ",\"decodeMs\":" ++ ms(a, t0) ++ ",\"evalMs\":" ++ ms(t2, a) ++ ",\"value\":" ++ FE.show(~body_json, v) ++ "}")

def evaluate(kernel: Bool, t0: Nat, +tokens: Nat, fuel: Nat, reps: Nat, +prog: C.Expr) -> IO(Unit):
  do IO<Unit>:
    t1 : Nat <- IO.now()
    v : C.Value = pick_loop(kernel, reps, fuel, prog)
    t2 : Nat <- IO.now()
    report_eval(t0, t1, t2, tokens, v)

def decoded(kernel: Bool, t0: Nat, fuel: Nat, reps: Nat, +toks: List<&2, U32>) -> IO(Unit):
  evaluate(kernel, t0, List.length(&2, U32, toks), fuel, reps, FE.program(toks))

def run_eval_text(kernel: Bool, text: String, fuel: Nat, reps: Nat) -> IO(Unit):
  do IO<Unit>:
    t0 : Nat <- IO.now()
    decoded(kernel, t0, fuel, reps, FE.ints(text))

def run_eval(kernel: Bool, path: String, fuel: Nat, reps: Nat) -> IO(Unit):
  do IO<Unit>:
    text : String <- FE.read_all(path)
    run_eval_text(kernel, text, fuel, reps)

# --- tokenizer ---------------------------------------------------------------

def tok_loop(left: Nat, +text: String, last: String) -> String:
  match left:
    case 0n:
      last
    case 1n+p:
      tok_loop(p, text, TK.summary_of(TK.tokenize(text)))

def run_tokenize(path: String, reps: Nat) -> IO(Unit):
  do IO<Unit>:
    text : String <- FE.read_all(path)
    t0 : Nat <- IO.now()
    s : String = tok_loop(reps, text, "null")
    t1 : Nat <- IO.now()
    IO.print("{\"mode\":\"tokenize\",\"ms\":" ++ ms(t1, t0) ++ ",\"summary\":" ++ s ++ "}")

# --- reference: the same kernel calls, no evaluator ---------------------------

def ref_box(+x0: F32, +y0: F32, +z0: F32, +x1: F32, +y1: F32, +h: F32) -> C.Value:
  C.VBody{W.box_solid(x0, y0, z0, x1, y1, h), W.box_domains()}

def ref_case(id: U32) -> C.Value:
  match id:
    case 3:
      K.boolean2(0, ref_box(0.0, 0.0, 0.0, 40.0, 30.0, 10.0), ref_box(20.0, 10.0, 0.0, 50.0, 35.0, 10.0), False{})
    case 4:
      K.boolean2(0, ref_box(0.0, 0.0, 0.0, 50.0, 40.0, 12.0), ref_box(8.0, 8.0, 4.0, 38.0, 32.0, 10.0), True{})
    case _:
      frame = K.boolean2(0, ref_box(0.0, 0.0, 0.0, 50.0, 40.0, 10.0), ref_box(8.0, 8.0, F32.neg(1.0), 42.0, 32.0, 12.0), True{})
      K.boolean2(0, frame, ref_box(48.0, 10.0, 0.0, 60.0, 30.0, 10.0), False{})

def ref_loop(left: Nat, +id: U32, last: C.Value) -> C.Value:
  match left:
    case 0n:
      last
    case 1n+p:
      ref_loop(p, id, ref_case(id))

def run_ref(id: U32, reps: Nat) -> IO(Unit):
  do IO<Unit>:
    t0 : Nat <- IO.now()
    v : C.Value = ref_loop(reps, id, C.VUnit{})
    t1 : Nat <- IO.now()
    IO.print("{\"mode\":\"ref\",\"evalMs\":" ++ ms(t1, t0) ++ ",\"value\":" ++ FE.show(~body_json, v) ++ "}")

# --- dispatch -------------------------------------------------------------------

def mode_code(+m: String) -> U32:
  Bool.pick(U32, String.eq(m, "eval"), 1, Bool.pick(U32, String.eq(m, "pure"), 2, Bool.pick(U32, String.eq(m, "tokenize"), 3, Bool.pick(U32, String.eq(m, "ref"), 4, Bool.pick(U32, String.eq(m, "eval-arg"), 5, Bool.pick(U32, String.eq(m, "pure-arg"), 6, 0))))))

def usage() -> String:
  "usage: main eval|pure <ast-file> <fuel> <reps> | eval-arg|pure-arg <ast-text> <fuel> <reps> | tokenize <fs> <reps> | ref <case> <reps>"

# inline = the AST text itself is the argument (no File effect, so the
# Bend JavaScript target runs under Node without bun:ffi).
def source_mode(inline: Bool, kernel: Bool, src: String, fuel: Nat, reps: Nat) -> IO(Unit):
  match inline:
    case True{}:
      run_eval_text(kernel, src, fuel, reps)
    case False{}:
      run_eval(kernel, src, fuel, reps)

def three(kernel: Bool, inline: Bool, rest: List<String>) -> IO(Unit):
  match rest:
    case src <> fuel <> reps <> Nil{}:
      source_mode(inline, kernel, src, W.number(Nat.read(fuel)), W.number(Nat.read(reps)))
    case _:
      IO.die(Unit, 2, usage())

def pick_mode(code: U32, rest: List<String>) -> IO(Unit):
  match code:
    case 1:
      three(True{}, False{}, rest)
    case 2:
      three(False{}, False{}, rest)
    case 5:
      three(True{}, True{}, rest)
    case 6:
      three(False{}, True{}, rest)
    case 3:
      match rest:
        case path <> reps <> Nil{}:
          run_tokenize(path, W.number(Nat.read(reps)))
        case _:
          IO.die(Unit, 2, usage())
    case 4:
      match rest:
        case id <> reps <> Nil{}:
          run_ref(U32.from_nat(W.number(Nat.read(id))), W.number(Nat.read(reps)))
        case _:
          IO.die(Unit, 2, usage())
    case _:
      IO.die(Unit, 2, usage())

def dispatch(args: List<String>) -> IO(Unit):
  match args:
    case mode <> rest:
      pick_mode(mode_code(mode), rest)
    case Nil{}:
      IO.die(Unit, 2, usage())

def main() -> IO(Unit):
  do IO<Unit>:
    args : List<String> <- IO.args()
    dispatch(args)
