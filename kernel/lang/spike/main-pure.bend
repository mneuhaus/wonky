import Base
import ../../../kernel/analytic.bend as A
import ./core.bend as C
import ./frontend.bend as FE
import ./tokenize.bend as TK

# Size/compile-time control build of the spike: the same evaluator, decoder
# and tokenizer as main.bend, WITHOUT the kernel builtins (no topology,
# planar Boolean or solid-intersection code). Modes: pure, pure-arg,
# tokenize (same arguments as main.bend).

def body_json(s: A.Solid) -> String:
  "{\"body\":\"opaque\"}"

def prims(span: U32, op: C.Op, xs: List<&2, C.Value>) -> C.Value:
  C.pure_prim(span, op, xs)

def loop(left: Nat, +fuel: Nat, +prog: C.Expr, last: C.Value) -> C.Value:
  match left:
    case 0n:
      last
    case 1n+p:
      loop(p, fuel, prog, C.run(~prims, fuel, prog))

def ms(t1: Nat, t0: Nat) -> String:
  Nat.show(Nat.sub(t1, t0))

def report(t0: Nat, t1: Nat, t2: Nat, v: C.Value) -> IO(Unit):
  +a = t1
  IO.print("{\"mode\":\"eval\",\"decodeMs\":" ++ ms(a, t0) ++ ",\"evalMs\":" ++ ms(t2, a) ++ ",\"value\":" ++ FE.show(~body_json, v) ++ "}")

def evaluate(t0: Nat, fuel: Nat, reps: Nat, +prog: C.Expr) -> IO(Unit):
  do IO<Unit>:
    t1 : Nat <- IO.now()
    v : C.Value = loop(reps, fuel, prog, C.VUnit{})
    t2 : Nat <- IO.now()
    report(t0, t1, t2, v)

def run_text(text: String, fuel: Nat, reps: Nat) -> IO(Unit):
  do IO<Unit>:
    t0 : Nat <- IO.now()
    evaluate(t0, fuel, reps, FE.program(FE.ints(text)))

def run_file(path: String, fuel: Nat, reps: Nat) -> IO(Unit):
  do IO<Unit>:
    text : String <- FE.read_all(path)
    run_text(text, fuel, reps)

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

def number(m: Maybe<&2, Nat>) -> Nat:
  match m:
    case Some{n}:
      n
    case None{}:
      0n

def mode_code(+m: String) -> U32:
  Bool.pick(U32, String.eq(m, "pure"), 1, Bool.pick(U32, String.eq(m, "pure-arg"), 2, Bool.pick(U32, String.eq(m, "tokenize"), 3, 0)))

def usage() -> String:
  "usage: main-pure pure <ast-file> <fuel> <reps> | pure-arg <ast-text> <fuel> <reps> | tokenize <fs> <reps>"

def with_three(file: Bool, rest: List<String>) -> IO(Unit):
  match file:
    case True{}:
      match rest:
        case src <> fuel <> reps <> Nil{}:
          run_file(src, number(Nat.read(fuel)), number(Nat.read(reps)))
        case _:
          IO.die(Unit, 2, usage())
    case False{}:
      match rest:
        case src <> fuel <> reps <> Nil{}:
          run_text(src, number(Nat.read(fuel)), number(Nat.read(reps)))
        case _:
          IO.die(Unit, 2, usage())

def pick_mode(code: U32, rest: List<String>) -> IO(Unit):
  match code:
    case 1:
      with_three(True{}, rest)
    case 2:
      with_three(False{}, rest)
    case 3:
      match rest:
        case path <> reps <> Nil{}:
          run_tokenize(path, number(Nat.read(reps)))
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
