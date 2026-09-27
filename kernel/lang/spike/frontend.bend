import Base
import ../../../kernel/real.bend as R
import ../../../kernel/analytic.bend as A
import ./core.bend as C

# ===========================================================================
# Host <-> evaluator boundary of the spike: the integer-stream AST decoder
# and the JSON result printer. Encoding (produced by
# src/lang/spike-compile.mjs, documented in docs/language/bend-feasibility.md):
#
#   file    := decimal U32 tokens separated by single spaces
#   program := node
#   node    := 0 s m e s m e        ENum   hi word then lo word, each
#                                          (-1)^s * m * 2^(e - 200), m < 2^24
#            | 1 len c1 .. clen     EStr   character codes
#            | 2 | 3 | 4            true | false | unit
#            | 5 i                  EVar   de Bruijn index
#            | 6 arity body         ELam
#            | 7 arity body         ERec   (self at index arity)
#            | 8 span n f a1 .. an  EApp
#            | 9 x body             ELet
#            | 10 span c t e        EIf
#            | 11 span op n a1..an  EPrim
#            | 12 n e1 .. en        EList
#            | 13 a b               EPar   (fork-join, concatenates lists)
#
# Decoding is one recursive def driven by a DTask selector for the same
# reason as C.step: Bend forbids mutual recursion and matching computed
# values, and the token list does not shrink structurally across a returned
# tuple, so decode consumes a depth fuel Nat (the host passes 4 * tokens).
# ===========================================================================

type IntState is Data:
  IntState{cur: U32, active: Bool, acc: List<&2, U32>}

def int_flush(st: IntState) -> IntState:
  IntState{cur, active, acc} = st
  match active:
    case True{}:
      IntState{0, False{}, cur <> acc}
    case False{}:
      IntState{0, False{}, acc}

def int_more(d: U32, st: IntState) -> IntState:
  IntState{cur, active, acc} = st
  IntState{(cur * 10 + d : U32), True{}, acc}

def int_digit(isd: Bool, d: U32, st: IntState) -> IntState:
  match isd:
    case True{}:
      int_more(d, st)
    case False{}:
      int_flush(st)

def int_result(st: IntState) -> List<&2, U32>:
  IntState{cur, active, acc} = st
  List.reverse(&2, U32, acc)

def int_step(+code: U32, st: IntState) -> IntState:
  +d = (code - 48 : U32)
  int_digit((d < 10 : U32), d, st)

def ints_go(s: String, st: IntState) -> List<&2, U32>:
  match s:
    case SNil{}:
      int_result(int_flush(st))
    case SCon{c, rest}:
      ints_go(rest, int_step(Char.to_u32(c), st))

def ints(s: String) -> List<&2, U32>:
  ints_go(s, IntState{0, False{}, Nil{}})

# --- exact F32 words from (sign, mantissa, biased exponent) ----------------

def scale(n: Nat, x: F32, up: Bool) -> F32:
  match n:
    case 0n:
      x
    case 1n+p:
      match up:
        case True{}:
          scale(p, (x * 2.0 : F32), True{})
        case False{}:
          scale(p, (x * 0.5 : F32), False{})

def signed(s: U32, x: F32) -> F32:
  match s:
    case 0:
      x
    case _:
      F32.neg(x)

def word(s: U32, m: U32, +e: U32) -> F32:
  +up = (e >= 200 : U32)
  +k = U32.to_nat(Bool.pick(U32, up, (e - 200 : U32), (200 - e : U32)))
  signed(s, scale(k, U32.to_f32(m), up))

# --- header parsing -----------------------------------------------------------

type Head is Data:
  Head{kind: U32, a: U32, b: U32, num: R.Real, str: String, kids: U32, rest: List<&2, U32>}

type StrRes is Data:
  StrRes{s: String, rest: List<&2, U32>}

def read_str(toks: List<&2, U32>, n: U32, acc: String) -> StrRes:
  match toks:
    case Nil{}:
      StrRes{String.reverse(acc), Nil{}}
    case c <> t:
      match n:
        case 0:
          StrRes{String.reverse(acc), c <> t}
        case _:
          read_str(t, (n - 1 : U32), SCon{Char.from_u32(c), acc})

def bad_head(code: U32) -> Head:
  Head{99, code, 0, R.from_f32(0.0), "", 0, Nil{}}

def head_str(r: StrRes) -> Head:
  StrRes{s, rest} = r
  Head{1, 0, 0, R.from_f32(0.0), s, 0, rest}

def head_num(xs: List<&2, U32>) -> Head:
  match xs:
    case s1 <> m1 <> e1 <> s2 <> m2 <> e2 <> rest:
      Head{0, 0, 0, R.Real{word(s1, m1, e1), word(s2, m2, e2)}, "", 0, rest}
    case _:
      bad_head(1)

def head_one(kind: U32, kids: U32, xs: List<&2, U32>) -> Head:
  match xs:
    case a <> rest:
      Head{kind, a, 0, R.from_f32(0.0), "", kids, rest}
    case _:
      bad_head(2)

def head_app(xs: List<&2, U32>) -> Head:
  match xs:
    case span <> n <> rest:
      Head{8, span, 0, R.from_f32(0.0), "", (n + 1 : U32), rest}
    case _:
      bad_head(3)

def head_prim(xs: List<&2, U32>) -> Head:
  match xs:
    case span <> op <> n <> rest:
      Head{11, span, op, R.from_f32(0.0), "", n, rest}
    case _:
      bad_head(4)

def head_list(xs: List<&2, U32>) -> Head:
  match xs:
    case n <> rest:
      Head{12, 0, 0, R.from_f32(0.0), "", n, rest}
    case _:
      bad_head(5)

def head_str_len(xs: List<&2, U32>) -> Head:
  match xs:
    case n <> rest:
      head_str(read_str(rest, n, SNil{}))
    case _:
      bad_head(6)

def head_plain(kind: U32, kids: U32, rest: List<&2, U32>) -> Head:
  Head{kind, 0, 0, R.from_f32(0.0), "", kids, rest}

def header_op(op: U32, rest: List<&2, U32>) -> Head:
  match op:
    case 0:
      head_num(rest)
    case 1:
      head_str_len(rest)
    case 2:
      head_plain(2, 0, rest)
    case 3:
      head_plain(3, 0, rest)
    case 4:
      head_plain(4, 0, rest)
    case 5:
      head_one(5, 0, rest)
    case 6:
      head_one(6, 1, rest)
    case 7:
      head_one(7, 1, rest)
    case 8:
      head_app(rest)
    case 9:
      head_plain(9, 2, rest)
    case 10:
      head_one(10, 3, rest)
    case 11:
      head_prim(rest)
    case 12:
      head_list(rest)
    case 13:
      head_plain(13, 2, rest)
    case _:
      bad_head(7)

def header(toks: List<&2, U32>) -> Head:
  match toks:
    case op <> rest:
      header_op(op, rest)
    case Nil{}:
      bad_head(8)

def op_of(code: U32) -> C.Op:
  match code:
    case 0:
      C.OAdd{}
    case 1:
      C.OSub{}
    case 2:
      C.OMul{}
    case 3:
      C.ODiv{}
    case 4:
      C.OLt{}
    case 5:
      C.OLe{}
    case 6:
      C.OEq{}
    case 7:
      C.ONot{}
    case 8:
      C.ONeg{}
    case 9:
      C.OCons{}
    case 10:
      C.OHead{}
    case 11:
      C.OTail{}
    case 12:
      C.OEmpty{}
    case 13:
      C.OLen{}
    case 14:
      C.ONth{}
    case 15:
      C.OAppend{}
    case 16:
      C.OMapNew{}
    case 17:
      C.OMapSet{}
    case 18:
      C.OMapGet{}
    case 19:
      C.OMapHas{}
    case 20:
      C.OStrCat{}
    case 21:
      C.OError{}
    case 22:
      C.OExtrude{}
    case 23:
      C.OUnion{}
    case 24:
      C.OSubtract{}
    case 25:
      C.OVolume{}
    case 26:
      C.OFaces{}
    case _:
      C.OUnknown{code}

def build_one(ks: List<&2, C.Expr>, kind: U32, +a: U32) -> C.Expr:
  match ks:
    case body <> Nil{}:
      match kind:
        case 6:
          C.ELam{a, body}
        case _:
          C.ERec{a, body}
    case _:
      C.EBad{10}

def build_app(+a: U32, ks: List<&2, C.Expr>) -> C.Expr:
  match ks:
    case f <> args:
      C.EApp{a, f, args}
    case _:
      C.EBad{11}

def build_let(ks: List<&2, C.Expr>) -> C.Expr:
  match ks:
    case x <> body <> Nil{}:
      C.ELet{x, body}
    case _:
      C.EBad{12}

def build_if(+a: U32, ks: List<&2, C.Expr>) -> C.Expr:
  match ks:
    case c <> t <> e <> Nil{}:
      C.EIf{a, c, t, e}
    case _:
      C.EBad{13}

def build_par(ks: List<&2, C.Expr>) -> C.Expr:
  match ks:
    case x <> y <> Nil{}:
      C.EPar{x, y}
    case _:
      C.EBad{14}

def build(kind: U32, +a: U32, b: U32, num: R.Real, str: String, ks: List<&2, C.Expr>) -> C.Expr:
  match kind:
    case 0:
      C.ENum{num}
    case 1:
      C.EStr{str}
    case 2:
      C.EBool{True{}}
    case 3:
      C.EBool{False{}}
    case 4:
      C.EUnit{}
    case 5:
      C.EVar{a}
    case 6:
      build_one(ks, 6, a)
    case 7:
      build_one(ks, 7, a)
    case 8:
      build_app(a, ks)
    case 9:
      build_let(ks)
    case 10:
      build_if(a, ks)
    case 11:
      C.EPrim{a, op_of(b), ks}
    case 12:
      C.EList{ks}
    case 13:
      build_par(ks)
    case _:
      C.EBad{a}

type Dec is Data:
  Dec{es: List<&2, C.Expr>, rest: List<&2, U32>}

type DTask is Data:
  Many{n: U32, toks: List<&2, U32>}
  WithHead{n: U32, h: Head}
  WithKids{n: U32, kind: U32, a: U32, b: U32, num: R.Real, str: String, kids: Dec}

def prepend(e: C.Expr, d: Dec) -> Dec:
  Dec{es, rest} = d
  Dec{e <> es, rest}

def decode(fuel: Nat, t: DTask) -> Dec:
  match fuel:
    case 0n:
      Dec{C.EBad{20} <> Nil{}, Nil{}}
    case 1n+ +f:
      match t:
        case Many{n, toks}:
          match n:
            case 0:
              Dec{Nil{}, toks}
            case _:
              decode(f, WithHead{n, header(toks)})
        case WithHead{n, h}:
          Head{kind, a, b, num, str, kids, rest} = h
          decode(f, WithKids{n, kind, a, b, num, str, decode(f, Many{kids, rest})})
        case WithKids{n, kind, a, b, num, str, d}:
          Dec{ks, rest} = d
          prepend(build(kind, a, b, num, str, ks), decode(f, Many{(n - 1 : U32), rest}))

def single(d: Dec) -> C.Expr:
  Dec{es, rest} = d
  match es:
    case e <> more:
      match more:
        case Nil{}:
          match rest:
            case Nil{}:
              e
            case _:
              C.EBad{21}
        case _:
          C.EBad{22}
    case Nil{}:
      C.EBad{23}

def program(+toks: List<&2, U32>) -> C.Expr:
  +n = List.length(&2, U32, toks)
  single(decode(Nat.add(Nat.mul(4n, n), 16n), Many{1, toks}))

# --- result printing ----------------------------------------------------------

def real_json(r: R.Real) -> String:
  R.Real{+hi, +lo} = r
  "{\"num\":" ++ F32.show((hi + lo : F32)) ++ ",\"hi\":" ++ U32.show(F32.bits(hi)) ++ ",\"lo\":" ++ U32.show(F32.bits(lo)) ++ "}"

def trace_json(xs: List<&2, U32>) -> String:
  match xs:
    case Nil{}:
      ""
    case x <> rest:
      match rest:
        case Nil{}:
          U32.show(x)
        case _:
          U32.show(x) ++ "," ++ trace_json(rest)

# JSON string escaping for the result printer: quote, backslash and newline are
# escaped; other control characters (< 32) are printed as "?" (display only).
def escape_ctl(ctl: Bool, +c: U32, rest: String) -> String:
  match ctl:
    case True{}:
      SCon{Char.from_u32(63), rest}
    case False{}:
      SCon{Char.from_u32(c), rest}

def escape_char(+c: U32, rest: String) -> String:
  match c:
    case 34:
      SCon{Char.from_u32(92), SCon{Char.from_u32(34), rest}}
    case 92:
      SCon{Char.from_u32(92), SCon{Char.from_u32(92), rest}}
    case 10:
      SCon{Char.from_u32(92), SCon{Char.from_u32(110), rest}}
    case _:
      escape_ctl((c < 32 : U32), c, rest)

def json_escape(s: String) -> String:
  match s:
    case SNil{}:
      SNil{}
    case SCon{h, t}:
      escape_char(Char.to_u32(h), json_escape(t))

def bool_json(b: Bool) -> String:
  match b:
    case True{}:
      "true"
    case False{}:
      "false"

def sep(xs: List<&2, C.Value>) -> String:
  match xs:
    case Nil{}:
      ""
    case _:
      ","

# One structural def over a list of values (a single value is shown as a
# one-element list): VList recursion goes into a field of the head, the
# sibling recursion into the tail, so no mutual recursion is needed.
def show_items(~body: A.Solid -> String, xs: List<&2, C.Value>) -> String:
  match xs:
    case Nil{}:
      ""
    case v <> +rest:
      match v:
        case C.VNum{r}:
          real_json(r) ++ sep(rest) ++ show_items(~body, rest)
        case C.VBool{b}:
          bool_json(b) ++ sep(rest) ++ show_items(~body, rest)
        case C.VStr{s}:
          "\"" ++ json_escape(s) ++ "\"" ++ sep(rest) ++ show_items(~body, rest)
        case C.VUnit{}:
          "null" ++ sep(rest) ++ show_items(~body, rest)
        case C.VList{ys}:
          "[" ++ show_items(~body, ys) ++ "]" ++ sep(rest) ++ show_items(~body, rest)
        case C.VMap{m}:
          "{\"map\":" ++ Nat.show(Map.size(&2, C.Value, m)) ++ "}" ++ sep(rest) ++ show_items(~body, rest)
        case C.VClo{a, rc, b, e}:
          "{\"closure\":" ++ U32.show(a) ++ "}" ++ sep(rest) ++ show_items(~body, rest)
        case C.VBody{s, d}:
          body(s) ++ sep(rest) ++ show_items(~body, rest)
        case C.VErr{c, s, m, t}:
          "{\"error\":" ++ U32.show(c) ++ ",\"span\":" ++ U32.show(s) ++ ",\"message\":\"" ++ json_escape(m) ++ "\",\"trace\":[" ++ trace_json(t) ++ "]}" ++ sep(rest) ++ show_items(~body, rest)

def show(~body: A.Solid -> String, v: C.Value) -> String:
  show_items(~body, v <> Nil{})

# --- file input -----------------------------------------------------------------

def read_done(p: File & Result<&1, &1, U32 & String, String>) -> IO(String):
  (fh, r) = p
  do IO<String>:
    File.close(fh)
    IO.pass(String, r)

def read_all(path: String) -> IO(String):
  do IO<String>:
    fh : File <- IO.try(File, File.open(path, "r"))
    p : File & Result<&1, &1, U32 & String, String> <- File.read(fh, 268435456)
    read_done(p)
