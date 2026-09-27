import Base
import ../../real.bend as R
import ../../precise.bend as G

# Token reader and printer of the fillet job / sample text (docs/fillet/harness.md,
# "Job and result format"). A private copy of the lexer and printer of
# kernel/hybrid/mesh-io.bend (that directory belongs to another workflow), so
# this prototype does not break when the hybrid wire code changes.
#
# Tokens are separated by ASCII whitespace. A real is two decimal U32 words,
# the IEEE-754 bits of hi and lo; the value is R.Real{hi, lo}.
# Every reader returns `value & rest`. A malformed token turns the rest of the
# input into the poison "!", so the error reaches the final `end` check.

def poison() -> String:
  "!"

def digit(acc: U32, d: U32) -> U32:
  ((acc * 10 : U32) + d : U32)

# One decimal U32; leading whitespace skipped, the terminating one consumed.
def number.go(s: String, +acc: U32, started: Bool) -> U32 & String:
  match s:
    case SNil{}:
      match started:
        case True{}:
          (acc, SNil{})
        case False{}:
          (0, poison())
    case SCon{Chr{32}, t}:
      match started:
        case True{}:
          (acc, t)
        case False{}:
          number.go(t, acc, False{})
    case SCon{Chr{10}, t}:
      match started:
        case True{}:
          (acc, t)
        case False{}:
          number.go(t, acc, False{})
    case SCon{Chr{13}, t}:
      match started:
        case True{}:
          (acc, t)
        case False{}:
          number.go(t, acc, False{})
    case SCon{Chr{9}, t}:
      match started:
        case True{}:
          (acc, t)
        case False{}:
          number.go(t, acc, False{})
    case SCon{Chr{48}, t}:
      number.go(t, digit(acc, 0), True{})
    case SCon{Chr{49}, t}:
      number.go(t, digit(acc, 1), True{})
    case SCon{Chr{50}, t}:
      number.go(t, digit(acc, 2), True{})
    case SCon{Chr{51}, t}:
      number.go(t, digit(acc, 3), True{})
    case SCon{Chr{52}, t}:
      number.go(t, digit(acc, 4), True{})
    case SCon{Chr{53}, t}:
      number.go(t, digit(acc, 5), True{})
    case SCon{Chr{54}, t}:
      number.go(t, digit(acc, 6), True{})
    case SCon{Chr{55}, t}:
      number.go(t, digit(acc, 7), True{})
    case SCon{Chr{56}, t}:
      number.go(t, digit(acc, 8), True{})
    case SCon{Chr{57}, t}:
      number.go(t, digit(acc, 9), True{})
    case SCon{_, _}:
      (0, poison())

def number(s: String) -> U32 & String:
  number.go(s, 0, False{})

def word.go(s: String, acc: String, started: Bool) -> String & String:
  match s:
    case SNil{}:
      (String.reverse(acc), SNil{})
    case SCon{Chr{32}, t}:
      match started:
        case True{}:
          (String.reverse(acc), t)
        case False{}:
          word.go(t, acc, False{})
    case SCon{Chr{10}, t}:
      match started:
        case True{}:
          (String.reverse(acc), t)
        case False{}:
          word.go(t, acc, False{})
    case SCon{Chr{13}, t}:
      match started:
        case True{}:
          (String.reverse(acc), t)
        case False{}:
          word.go(t, acc, False{})
    case SCon{Chr{9}, t}:
      match started:
        case True{}:
          (String.reverse(acc), t)
        case False{}:
          word.go(t, acc, False{})
    case SCon{c, t}:
      word.go(t, SCon{c, acc}, True{})

# The next whitespace-delimited word (empty at the end of the input).
def word(s: String) -> String & String:
  word.go(s, SNil{}, False{})

def line.go(s: String, acc: String) -> String & String:
  match s:
    case SNil{}:
      (String.reverse(acc), SNil{})
    case SCon{Chr{10}, t}:
      (String.reverse(acc), t)
    case SCon{c, t}:
      line.go(t, SCon{c, acc})

# The rest of the current line; the newline is consumed.
def line(s: String) -> String & String:
  line.go(s, SNil{})

def expect.if(rest: String, same: Bool) -> String:
  match same:
    case True{}:
      rest
    case False{}:
      poison()

def expect.k(p: String & String, kw: String) -> String:
  (w, rest) = p
  expect.if(rest, String.eq(w, kw))

# Consume the keyword `kw` or poison.
def expect(s: String, kw: String) -> String:
  expect.k(word(s), kw)

def f32_of(x: U32) -> F32:
  match x:
    case U32{w}:
      F32{w}

def real.lo(hi: U32, p: U32 & String) -> R.Real & String:
  (lo, s) = p
  (R.Real{f32_of(hi), f32_of(lo)}, s)

def real.hi(p: U32 & String) -> R.Real & String:
  (hi, s) = p
  real.lo(hi, number(s))

def real(s: String) -> R.Real & String:
  real.hi(number(s))

# `n` more reals after the pending pair `st`.
def reals.go(n: Nat, st: R.Real & String, acc: List<&2, R.Real>) -> List<&2, R.Real> & String:
  match n:
    case 0n:
      (x, s) = st
      (List.reverse(&2, R.Real, x <> acc), s)
    case 1n+p:
      (x, s) = st
      reals.go(p, real(s), x <> acc)

def reals(n: Nat, s: String) -> List<&2, R.Real> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      reals.go(p, real(s), Nil{})

# `n` more U32 after the pending pair `st`.
def numbers.go(n: Nat, st: U32 & String, acc: List<&2, U32>) -> List<&2, U32> & String:
  match n:
    case 0n:
      (x, s) = st
      (List.reverse(&2, U32, x <> acc), s)
    case 1n+p:
      (x, s) = st
      numbers.go(p, number(s), x <> acc)

def numbers(n: Nat, s: String) -> List<&2, U32> & String:
  match n:
    case 0n:
      (Nil{}, s)
    case 1n+p:
      numbers.go(p, number(s), Nil{})

# ---------------------------------------------------------------------------
# Printing. Output is built back to front by prepending.

def put_digits(f: Nat, +n: U32, acc: String, more: Bool) -> String:
  match f:
    case 0n:
      acc
    case 1n+g:
      match more:
        case True{}:
          put_digits(g, (n / 10 : U32), SCon{Chr{(48 + (n % 10 : U32) : U32)}, acc}, (n >= 10 : U32))
        case False{}:
          acc

def put_u32(n: U32, acc: String) -> String:
  put_digits(10n, n, acc, True{})

def put(lit: String, acc: String) -> String:
  String.append(lit, acc)

def sp(acc: String) -> String:
  SCon{Chr{32}, acc}

def nl(acc: String) -> String:
  SCon{Chr{10}, acc}

# A word below 2^-60 in magnitude (exponent field < 67: ±0, subnormals and
# rounding noise of coordinates that are zero) is printed as 0. Metal flushes
# subnormals to zero (MEASURED 2026-09-24 on the rolling-ball samples: the
# CPU and Metal texts differed only in such words), so the printed noise floor
# is 2^-60 mm = 8.7e-19 mm on every target.
def flush(+w: U32) -> U32:
  Bool.pick(U32, U32.is_lt(U32.shrn(U32.and(w, 2139095040), 23n), 67), 0, w)

def put_real(r: R.Real, acc: String) -> String:
  R.Real{hi, lo} = r
  put_u32(flush(F32.bits(hi)), sp(put_u32(flush(F32.bits(lo)), acc)))

def put_vec3(v: G.Vec3, acc: String) -> String:
  G.V3{x, y, z} = v
  put_real(x, sp(put_real(y, sp(put_real(z, acc)))))
