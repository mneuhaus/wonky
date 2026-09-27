import Base

# ===========================================================================
# Native FeatureScript tokenizer spike. It reproduces src/parser.mjs
# `tokenize` token for token (kinds, line, column; verified by
# scripts/lang/spike-bench.mjs through a positional hash): whitespace,
# // and /* */ comments, "..." and '...' strings with \n \r \t \\ \" \'
# escapes, numbers \d+\.?\d*|\.\d+ with an optional exponent, identifiers,
# the eleven two-character operators and the single-character symbols.
#
# The lexer is ONE structural recursion over the String (a linked list of
# Char in Bend). Every character goes through a non-recursive transition
# function; "finish the pending token and re-process this character" is a
# call to the normal-state transition, not a recursive lex call, which is
# how the no-mutual-recursion / structural-termination rules are met.
# Known deviation: an exponent marker not followed by digits ("1e+x") is
# split as number, name "e", symbol; the JS regex does the same except for
# `1e+=`, which the corpus does not contain. Invalid characters are counted
# in `bad` (JS throws) instead of aborting.
# ===========================================================================

type Tok is Data:
  Tok{kind: U32, line: U32, col: U32, text: String}

type Pos is Data:
  Pos{line: U32, col: U32, tl: U32, tc: U32}

type Lx is Data:
  Lx{st: U32, pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32}

def is_digit(+c: U32) -> Bool:
  ((c - 48 : U32) < 10 : U32)

def is_alpha(+c: U32) -> Bool:
  Bool.or(((c .|. 32) - 97 < 26 : U32), U32.is_eq(c, 95))

def is_ident(+c: U32) -> Bool:
  Bool.or(is_alpha(c), is_digit(c))

def is_space(+c: U32) -> Bool:
  Bool.or(U32.is_eq(c, 32), ((c - 9 : U32) < 5 : U32))

def mark(p: Pos) -> Pos:
  Pos{+line, +col, tl, tc} = p
  Pos{line, col, line, col}

def advance_pick(nl: Bool, p: Pos) -> Pos:
  match nl:
    case True{}:
      Pos{line, col, tl, tc} = p
      Pos{(line + 1 : U32), 1, tl, tc}
    case False{}:
      Pos{line, col, tl, tc} = p
      Pos{line, (col + 1 : U32), tl, tc}

def advance(c: U32, p: Pos) -> Pos:
  advance_pick(U32.is_eq(c, 10), p)

def tok(kind: U32, p: Pos, cur: String) -> Tok:
  Pos{line, col, tl, tc} = p
  Tok{kind, tl, tc, String.reverse(cur)}

def one(+c: U32) -> String:
  SCon{Char.from_u32(c), SNil{}}

def symbol_here(+c: U32, p: Pos) -> Tok:
  Pos{line, col, tl, tc} = p
  Tok{3, line, col, one(c)}

# --- the normal state -----------------------------------------------------

def start_symbol(+c: U32, +pos: Pos, toks: List<&2, Tok>, bad: U32) -> Lx:
  match c:
    case 58:
      Lx{158, mark(pos), one(c), toks, bad}
    case 61:
      Lx{161, mark(pos), one(c), toks, bad}
    case 33:
      Lx{133, mark(pos), one(c), toks, bad}
    case 60:
      Lx{160, mark(pos), one(c), toks, bad}
    case 62:
      Lx{162, mark(pos), one(c), toks, bad}
    case 38:
      Lx{138, mark(pos), one(c), toks, bad}
    case 124:
      Lx{224, mark(pos), one(c), toks, bad}
    case 43:
      Lx{143, mark(pos), one(c), toks, bad}
    case 45:
      Lx{145, mark(pos), one(c), toks, bad}
    case 42:
      Lx{142, mark(pos), one(c), toks, bad}
    case 34:
      Lx{7, mark(pos), SNil{}, toks, bad}
    case 39:
      Lx{8, mark(pos), SNil{}, toks, bad}
    case 47:
      Lx{14, mark(pos), one(c), toks, bad}
    case 46:
      Lx{16, mark(pos), one(c), toks, bad}
    case 123:
      Lx{0, pos, SNil{}, symbol_here(c, pos) <> toks, bad}
    case 125:
      Lx{0, pos, SNil{}, symbol_here(c, pos) <> toks, bad}
    case 91:
      Lx{0, pos, SNil{}, symbol_here(c, pos) <> toks, bad}
    case 93:
      Lx{0, pos, SNil{}, symbol_here(c, pos) <> toks, bad}
    case 40:
      Lx{0, pos, SNil{}, symbol_here(c, pos) <> toks, bad}
    case 41:
      Lx{0, pos, SNil{}, symbol_here(c, pos) <> toks, bad}
    case 59:
      Lx{0, pos, SNil{}, symbol_here(c, pos) <> toks, bad}
    case 44:
      Lx{0, pos, SNil{}, symbol_here(c, pos) <> toks, bad}
    case 37:
      Lx{0, pos, SNil{}, symbol_here(c, pos) <> toks, bad}
    case 94:
      Lx{0, pos, SNil{}, symbol_here(c, pos) <> toks, bad}
    case 126:
      Lx{0, pos, SNil{}, symbol_here(c, pos) <> toks, bad}
    case 63:
      Lx{0, pos, SNil{}, symbol_here(c, pos) <> toks, bad}
    case _:
      Lx{0, pos, SNil{}, toks, (bad + 1 : U32)}

def start_digit(isd: Bool, +c: U32, +pos: Pos, toks: List<&2, Tok>, bad: U32) -> Lx:
  match isd:
    case True{}:
      Lx{2, mark(pos), one(c), toks, bad}
    case False{}:
      start_symbol(c, pos, toks, bad)

def start_alpha(isa: Bool, +c: U32, +pos: Pos, toks: List<&2, Tok>, bad: U32) -> Lx:
  match isa:
    case True{}:
      Lx{1, mark(pos), one(c), toks, bad}
    case False{}:
      start_digit(is_digit(c), c, pos, toks, bad)

def start_space(iss: Bool, +c: U32, +pos: Pos, toks: List<&2, Tok>, bad: U32) -> Lx:
  match iss:
    case True{}:
      Lx{0, pos, SNil{}, toks, bad}
    case False{}:
      start_alpha(is_alpha(c), c, pos, toks, bad)

def start(+c: U32, +pos: Pos, toks: List<&2, Tok>, bad: U32) -> Lx:
  start_space(is_space(c), c, pos, toks, bad)

# --- token states -----------------------------------------------------------

def keep(ok: Bool, st: U32, +c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32, kind: U32) -> Lx:
  match ok:
    case True{}:
      Lx{st, pos, SCon{Char.from_u32(c), cur}, toks, bad}
    case False{}:
      start(c, pos, tok(kind, pos, cur) <> toks, bad)

def name_step(+c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  keep(is_ident(c), 1, c, pos, cur, toks, bad, 1)

def exp_marker(+c: U32) -> Bool:
  Bool.or(U32.is_eq(c, 101), U32.is_eq(c, 69))

def number_tail(ise: Bool, +c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  match ise:
    case True{}:
      Lx{4, pos, SCon{Char.from_u32(c), cur}, toks, bad}
    case False{}:
      start(c, pos, tok(2, pos, cur) <> toks, bad)

def int_dot(isdot: Bool, +c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  match isdot:
    case True{}:
      Lx{3, pos, SCon{Char.from_u32(c), cur}, toks, bad}
    case False{}:
      number_tail(exp_marker(c), c, pos, cur, toks, bad)

def int_step_pick(isd: Bool, +c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  match isd:
    case True{}:
      Lx{2, pos, SCon{Char.from_u32(c), cur}, toks, bad}
    case False{}:
      int_dot(U32.is_eq(c, 46), c, pos, cur, toks, bad)

def int_step(+c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  int_step_pick(is_digit(c), c, pos, cur, toks, bad)

def frac_pick(isd: Bool, +c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  match isd:
    case True{}:
      Lx{3, pos, SCon{Char.from_u32(c), cur}, toks, bad}
    case False{}:
      number_tail(exp_marker(c), c, pos, cur, toks, bad)

def frac_step(+c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  frac_pick(is_digit(c), c, pos, cur, toks, bad)

def drop1(s: String) -> String:
  match s:
    case SNil{}:
      SNil{}
    case SCon{h, t}:
      t

# After "e" without digits: number, then a name that starts with the e.
def exp_backtrack(+c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  Pos{+line, +col, tl, tc} = pos
  +npos = {Pos{line, col, tl, tc} : Pos}
  +epos = {Pos{line, col, line, (col - 1 : U32)} : Pos}
  keep(is_ident(c), 1, c, epos, one(101), tok(2, npos, drop1(cur)) <> toks, bad, 1)

def exp_sign(iss: Bool, +c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  match iss:
    case True{}:
      Lx{5, pos, SCon{Char.from_u32(c), cur}, toks, bad}
    case False{}:
      exp_backtrack(c, pos, cur, toks, bad)

def exp_step_pick(isd: Bool, +c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  match isd:
    case True{}:
      Lx{6, pos, SCon{Char.from_u32(c), cur}, toks, bad}
    case False{}:
      exp_sign(Bool.or(U32.is_eq(c, 43), U32.is_eq(c, 45)), c, pos, cur, toks, bad)

def exp_step(+c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  exp_step_pick(is_digit(c), c, pos, cur, toks, bad)

def exp_sign_step_pick(isd: Bool, +c: U32, +pos: Pos, +cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  match isd:
    case True{}:
      Lx{6, pos, SCon{Char.from_u32(c), cur}, toks, bad}
    case False{}:
      Pos{+line, +col, tl, tc} = pos
      +here = {Pos{line, col, line, col} : Pos}
      +npos = {Pos{line, col, tl, tc} : Pos}
      e = {Tok{1, line, (col - 2 : U32), one(101)} : Tok}
      s = {Tok{3, line, (col - 1 : U32), drop1(String.reverse(drop1(cur)))} : Tok}
      start(c, here, s <> e <> tok(2, npos, drop1(drop1(cur))) <> toks, bad)

def exp_sign_step(+c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  exp_sign_step_pick(is_digit(c), c, pos, cur, toks, bad)

def exp_digits(+c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  keep(is_digit(c), 6, c, pos, cur, toks, bad, 2)

def escaped(c: U32) -> U32:
  match c:
    case 110:
      10
    case 114:
      13
    case 116:
      9
    case _:
      c

def string_pick3(isnl: Bool, st: U32, +c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  match isnl:
    case True{}:
      Lx{0, pos, SNil{}, toks, (bad + 1 : U32)}
    case False{}:
      Lx{st, pos, SCon{Char.from_u32(c), cur}, toks, bad}

def string_pick2(isesc: Bool, st: U32, +c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  match isesc:
    case True{}:
      Lx{(st + 2 : U32), pos, cur, toks, bad}
    case False{}:
      string_pick3(Bool.or(U32.is_eq(c, 10), U32.is_eq(c, 13)), st, c, pos, cur, toks, bad)

def string_pick(isq: Bool, +st: U32, +c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  match isq:
    case True{}:
      Lx{0, pos, SNil{}, tok(4, pos, cur) <> toks, bad}
    case False{}:
      string_pick2(U32.is_eq(c, 92), st, c, pos, cur, toks, bad)

def string_step(+st: U32, +quote: U32, +c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  string_pick(U32.is_eq(c, quote), st, c, pos, cur, toks, bad)

def comment_line(c: U32, +pos: Pos, toks: List<&2, Tok>, bad: U32) -> Lx:
  match c:
    case 10:
      Lx{0, pos, SNil{}, toks, bad}
    case _:
      Lx{11, pos, SNil{}, toks, bad}

def comment_block(c: U32, +pos: Pos, toks: List<&2, Tok>, bad: U32) -> Lx:
  match c:
    case 42:
      Lx{13, pos, SNil{}, toks, bad}
    case _:
      Lx{12, pos, SNil{}, toks, bad}

def comment_star(+c: U32, +pos: Pos, toks: List<&2, Tok>, bad: U32) -> Lx:
  match c:
    case 47:
      Lx{0, pos, SNil{}, toks, bad}
    case 42:
      Lx{13, pos, SNil{}, toks, bad}
    case _:
      Lx{12, pos, SNil{}, toks, bad}

def slash_step(+c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  match c:
    case 47:
      Lx{11, pos, SNil{}, toks, bad}
    case 42:
      Lx{12, pos, SNil{}, toks, bad}
    case 61:
      Lx{0, pos, SNil{}, tok(3, pos, SCon{Char.from_u32(c), cur}) <> toks, bad}
    case _:
      start(c, pos, tok(3, pos, cur) <> toks, bad)

def dot_step_pick(isd: Bool, +c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  match isd:
    case True{}:
      Lx{3, pos, SCon{Char.from_u32(c), cur}, toks, bad}
    case False{}:
      start(c, pos, tok(3, pos, cur) <> toks, bad)

def dot_step(+c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  dot_step_pick(is_digit(c), c, pos, cur, toks, bad)

def pair_second(p: U32) -> U32:
  match p:
    case 58:
      58
    case 38:
      38
    case 124:
      124
    case _:
      61

def lone_ok(p: U32) -> U32:
  match p:
    case 38:
      1
    case 124:
      1
    case _:
      0

def pair_pick(two: Bool, +p: U32, +c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  match two:
    case True{}:
      Lx{0, pos, SNil{}, tok(3, pos, SCon{Char.from_u32(c), cur}) <> toks, bad}
    case False{}:
      start(c, pos, tok(3, pos, cur) <> toks, (bad + lone_ok(p) : U32))

def pair_step(+st: U32, +c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  +p = (st - 100 : U32)
  pair_pick(U32.is_eq(c, pair_second(p)), p, c, pos, cur, toks, bad)

def transition(+st: U32, +c: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> Lx:
  match st:
    case 0:
      start(c, pos, toks, bad)
    case 1:
      name_step(c, pos, cur, toks, bad)
    case 2:
      int_step(c, pos, cur, toks, bad)
    case 3:
      frac_step(c, pos, cur, toks, bad)
    case 4:
      exp_step(c, pos, cur, toks, bad)
    case 5:
      exp_sign_step(c, pos, cur, toks, bad)
    case 6:
      exp_digits(c, pos, cur, toks, bad)
    case 7:
      string_step(7, 34, c, pos, cur, toks, bad)
    case 8:
      string_step(8, 39, c, pos, cur, toks, bad)
    case 9:
      Lx{7, pos, SCon{Char.from_u32(escaped(c)), cur}, toks, bad}
    case 10:
      Lx{8, pos, SCon{Char.from_u32(escaped(c)), cur}, toks, bad}
    case 11:
      comment_line(c, pos, toks, bad)
    case 12:
      comment_block(c, pos, toks, bad)
    case 13:
      comment_star(c, pos, toks, bad)
    case 14:
      slash_step(c, pos, cur, toks, bad)
    case 16:
      dot_step(c, pos, cur, toks, bad)
    case _:
      pair_step(st, c, pos, cur, toks, bad)

def moved(c: U32, lx: Lx) -> Lx:
  Lx{st, pos, cur, toks, bad} = lx
  Lx{st, advance(c, pos), cur, toks, bad}

def feed(+c: U32, lx: Lx) -> Lx:
  Lx{st, pos, cur, toks, bad} = lx
  moved(c, transition(st, c, pos, cur, toks, bad))

def lex(s: String, lx: Lx) -> Lx:
  match s:
    case SNil{}:
      lx
    case SCon{ch, rest}:
      lex(rest, feed(Char.to_u32(ch), lx))

def finish_state(st: U32, +pos: Pos, cur: String, toks: List<&2, Tok>, bad: U32) -> List<&2, Tok> & U32:
  match st:
    case 0:
      (toks, bad)
    case 11:
      (toks, bad)
    case 1:
      (tok(1, pos, cur) <> toks, bad)
    case 2:
      (tok(2, pos, cur) <> toks, bad)
    case 3:
      (tok(2, pos, cur) <> toks, bad)
    case 6:
      (tok(2, pos, cur) <> toks, bad)
    case 14:
      (tok(3, pos, cur) <> toks, bad)
    case 16:
      (tok(3, pos, cur) <> toks, bad)
    case 7:
      (toks, (bad + 1 : U32))
    case 8:
      (toks, (bad + 1 : U32))
    case 9:
      (toks, (bad + 1 : U32))
    case 10:
      (toks, (bad + 1 : U32))
    case 12:
      (toks, (bad + 1 : U32))
    case 13:
      (toks, (bad + 1 : U32))
    case _:
      (tok(3, pos, cur) <> toks, bad)

def finish(lx: Lx) -> List<&2, Tok> & U32:
  Lx{st, pos, cur, toks, bad} = lx
  finish_state(st, pos, cur, toks, bad)

def tokenize(s: String) -> List<&2, Tok> & U32:
  finish(lex(s, Lx{0, Pos{1, 1, 1, 1}, SNil{}, Nil{}, 0}))

# --- summary (same hash as scripts/lang/spike-bench.mjs computes in JS) ----

type Summary is Data:
  Summary{n: U32, names: U32, nums: U32, syms: U32, strs: U32, hash: U32, chars: U32}

def mix(a: U32, b: U32) -> U32:
  (a * 16777619 + b : U32)

def kind_add(k: U32, s: Summary) -> Summary:
  match k:
    case 1:
      Summary{n, a, b, c, d, h, ch} = s
      Summary{n, (a + 1 : U32), b, c, d, h, ch}
    case 2:
      Summary{n, a, b, c, d, h, ch} = s
      Summary{n, a, (b + 1 : U32), c, d, h, ch}
    case 3:
      Summary{n, a, b, c, d, h, ch} = s
      Summary{n, a, b, (c + 1 : U32), d, h, ch}
    case _:
      Summary{n, a, b, c, d, h, ch} = s
      Summary{n, a, b, c, (d + 1 : U32), h, ch}

def summary_fold(+kind: U32, line: U32, col: U32, text: String, s: Summary) -> Summary:
  Summary{n, a, b, c, d, h, ch} = s
  Summary{(n + 1 : U32), a, b, c, d, mix(mix(mix(h, kind), line), col), (ch + U32.from_nat(String.length(text)) : U32)}

def summary_add(t: Tok, s: Summary) -> Summary:
  Tok{+kind, line, col, text} = t
  summary_fold(kind, line, col, text, kind_add(kind, s))

def summarize(ts: List<&2, Tok>, s: Summary) -> Summary:
  match ts:
    case Nil{}:
      s
    case t <> rest:
      summarize(rest, summary_add(t, s))

def summary_json(s: Summary, bad: U32) -> String:
  Summary{n, a, b, c, d, h, ch} = s
  "{\"tokens\":" ++ U32.show(n) ++ ",\"name\":" ++ U32.show(a) ++ ",\"number\":" ++ U32.show(b) ++ ",\"symbol\":" ++ U32.show(c) ++ ",\"string\":" ++ U32.show(d) ++ ",\"hash\":" ++ U32.show(h) ++ ",\"textChars\":" ++ U32.show(ch) ++ ",\"bad\":" ++ U32.show(bad) ++ "}"

def summary_of(r: List<&2, Tok> & U32) -> String:
  (ts, bad) = r
  summary_json(summarize(List.reverse(&2, Tok, ts), Summary{0, 0, 0, 0, 0, 2166136261, 0}), bad)
