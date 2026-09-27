# Bend 2.0.25 in wonky: the reference

This is the long form behind the `wonky-bend` skill (`.claude/skills/wonky-bend/SKILL.md`). It covers
the Bend that wonky writes: the errors agents actually hit here, with before/after code, the idioms
the kernel uses, performance traps, targets, testing, `R.*`, the exact predicates, the collections
adapters and the laws gate. The syntax cheat sheet is [syntax.md](syntax.md).

General Bend 2 knowledge (language core, Base API, proof technique, GPU tuning, the compiler repo) is
in the third-party `bend2-mega-skill`, which was written against 2.0.13/2.0.16. Section 13 lists every
place where our pinned 2.0.25 behaves differently from what that skill says.

**Evidence.** Every `bend` code block below is a complete file. It was compiled with the pinned
compiler, and its first comment lines state the outcome it must produce (`# expect: error <text>`
for "before" examples; no directive means `All terms check.`). Re-run all of them with:

```sh
node docs/bend/check-snippets.mjs     # report in tmp/bend-docs-check/results.txt
BEND_DOCS_CHECK_OUT=tmp/x node docs/bend/check-snippets.mjs   # another output dir; full log in full.txt
```

Imports written `import ./real.bend as R` resolve as if the file lived in `kernel/`. Error counts come from 591 unique errors observed in 10,378 Bend-related commands during development (2026-09-24). Claims marked **[unverified]** come from repo docs or development notes and were not reproduced.

## Contents

1. [The compile-fix loop](#1-the-compile-fix-loop)
2. [Errors, most frequent first](#2-errors-most-frequent-first)
3. [Idioms the kernel uses](#3-idioms-the-kernel-uses)
4. [Performance](#4-performance)
5. [Targets and native limits](#5-targets-and-native-limits)
6. [Testing lanes](#6-testing-lanes)
7. [R.*: F32x2 reals](#7-r-f32x2-reals)
8. [Exact predicates](#8-exact-predicates)
9. [bend-collections and kernel/lib](#9-bend-collections-and-kernellib)
10. [LAWS.bend and PROOF.bend](#10-lawsbend-and-proofbend)
11. [Module structure](#11-module-structure)
12. [Loader and cache](#12-loader-and-cache)
13. [Where 2.0.25 differs from the mega skill](#13-where-2025-differs-from-the-mega-skill)
14. [Unverified claims](#14-unverified-claims)

---

## 1. The compile-fix loop

Fastest feedback first. Timings are from 2026-09-24 on the shared M5 Pro. `bend` in commands means
`.tools/bend-2.0.25/bin/bend` (there is no `bend` on PATH; `npm run setup` installs the pin).

| step | command | typical time |
|---|---|---|
| 1. one file | `BEND_NO_TELEMETRY=1 .tools/bend-2.0.25/bin/bend kernel/x.bend --check-only` | 0.3-0.5 s |
| 2. the gate | `npm run -s check:bend` (= `bend PROOF.bend`) | 3.5 s |
| 3. JS reference, one def | `WONKY_BEND_CACHE=0 node --input-type=module -e "..."` (section 12) | ~1 s + run |
| 4. focused tests | `node scripts/test-lane.mjs files <x>.test.mjs` or `npm run -s test:changed` | seconds to minutes |
| 5. native emit (records widened, native code touched) | `bend x.bend -o out/x.c` | 1-30 s |
| 6. cpu1 run | `bend x.bend -o out/x && out/x --threads 1 --gpu off` | build 1.5 s for a tiny file |
| 7. integration / verify only | `npm test`, `npm run -s test:slow`, cpuN, Metal harnesses | minutes |

Rules for the loop:

- **Fix only the first error, then re-run.** The checker stops at the first failing def. A parse
  error's `observed` is the next character (`'1'`, `'('`), not the mistake: read the `Location:`
  line marked `>|`.
- **A kernel module is also an entry.** Tests `loadBend(kernel/x.bend)` and you check it with
  `bend kernel/x.bend --check-only`; both make `x.bend` the entry file. Check it standalone, not
  only through `PROOF.bend` (see the constructor clash in 2.3).
- **The checker never reports native limits.** A constructor over 255 fields passes `--check-only` and
  fails only at `-o x.c` (section 5.1). Emit C whenever you widen a record or touch native-bridge code.
- **Look names up instead of guessing:** `bend base U32.is_eq`, `bend base List.foldr`, `bend base --types`.
  `bend base U32.eq` answers `Base has no U32.eq`. `bend version` prints the version (`--version` is
  an unknown option in 2.0.25).
- **Set `BEND_NO_TELEMETRY=1`** (the scripts do; it skips the daily network ping).
- Put scratch files under `tmp/`, never next to kernel files other agents are editing.

---

## 2. Errors, most frequent first

| class | unique errors | share |
|---|---:|---:|
| types (inference, kinds, cases, operators) | 137 | 23% |
| affinity (consumed more than once) | 125 | 21% |
| names and definition order | 113 | 19% |
| match and scrutinee rules (236 raw: the most re-run class) | 94 | 16% |
| native, Metal and stack limits | 34 | 6% |
| syntax and keywords | 32 | 5% |
| laws and proofs | 27 | 5% |
| termination and fuel | 21 | 4% |
| CLI, runtime traps, imports | 8 | 1% |

### 2.1 Types (137)

**Cannot infer a let-bound literal, list, constructor or lambda (51).** Inference is minimal. A
let-bound value has no expected type.

```bend
# expect: error an annotated term (cannot infer)
import Base

def quarter() -> F32:
  +h = 0.5
  (h * h : F32)
```

Annotate with `{v : T}`, or use a typed let `x : T = v` (allowed outside `do` in 2.0.25):

```bend
import Base

def quarter() -> F32:
  +h = {0.5 : F32}
  (h * h : F32)

def pair_list() -> List<&2, U32>:
  xs = {[1, 2] : List<&2, U32>}
  xs

def bump(x: U32) -> U32:
  g : U32 -> U32 = y => (y + 1 : U32)
  g(x)
```

**Every arithmetic, comparison, bitwise and shift operator needs a type.** A bare one is an error,
even inside parentheses. Until 2.0.16 it silently meant `Nat`; the mega skill still says so. Inner
parentheses inherit the outer `: T` (`((a + b) * c : U32)` checks), call arguments do not:
`(F32.abs(a - b) * c : F32)` fails, `(F32.abs((a - b : F32)) * c : F32)` checks (a real corpus error). `&&`, `||` (Bool), `++` (String) and
`<>` (cons) are fixed to their types and need no annotation (`bend.ts` `INFIX_OPS`, `parse_term_ns`).

```bend
# expect: error a type for this operator
import Base

def add(a: U32, b: U32) -> U32:
  (a + b)
```

**Shifts take a `Nat`, equality is a call, xor is `.^.`.** `>>` is `U32.shrn(a, n: Nat)`.
`(a == b : U32)` and `(a ^ b : U32)` are parse errors (`expected : ')'`). `U32.shr(x)` shifts by one
and takes one argument.

```bend
# expect: error expected : Nat
import Base

def half(x: U32) -> U32:
  (x >> 1 : U32)
```

```bend
# expect: error expected : ')'
import Base

def same(a: U32, b: U32) -> Bool:
  (a == b : U32)
```

```bend
import Base

def half(x: U32) -> U32:
  (x >> 1n : U32)

def same(a: U32, b: U32) -> Bool:
  U32.is_eq(a, b)

def flip(a: U32, b: U32) -> U32:
  (a .^. b : U32)

def below(a: F32, b: F32) -> Bool:
  (a < b : F32)

def scaled(a: U32, b: U32, c: U32) -> U32:
  ((a + b) * c : U32)

def either(a: Bool, b: Bool, c: Bool) -> Bool:
  a && b || c

def greet(name: String) -> String:
  "hi " ++ name
```

```bend
# expect: error a type for this operator
import Base

def gap(a: F32, b: F32, c: F32) -> F32:
  (F32.abs(a - b) * c : F32)
```

```bend
import Base

def gap(a: F32, b: F32, c: F32) -> F32:
  (F32.abs((a - b : F32)) * c : F32)
```

**`Data` expected, `Type` observed (18).** A `Data` type can be copied with `+`; it cannot hold a
`Type` value: a function, an `Array`, a handle, or any `is Type` record such as `IdVec`.

```bend
# expect: error expected : Data
import Base

type Box is Type:
  Box{f: U32 -> U32}

type Holder is Data:
  Holder{b: Box}
```

```bend
import Base

type Box is Type:
  Box{f: U32 -> U32}

type Holder is Type:
  Holder{b: Box}
```

`+b: Box` on a parameter fails the same way. Thread `Type` values through (every `IdVec` operation
hands the vector back).

**Missing cases after a type grows (18).** 13 of the 18 were `cases for analytic.Sphere,
analytic.Torus`: `analytic.Solid` gained constructors and every old `match` broke. When you add a
constructor, grep the kernel for matches on that type and update every one.

```bend
# expect: error cases for
import Base

type Shape is Data:
  SCircle{r: F32}
  SSquare{s: F32}
  SSphere{r: F32}

def is_round(s: Shape) -> Bool:
  match s:
    case SCircle{_}:
      True{}
    case SSquare{_}:
      False{}
```

```bend
import Base

type Shape is Data:
  SCircle{r: F32}
  SSquare{s: F32}
  SSphere{r: F32}

def is_round(s: Shape) -> Bool:
  match s:
    case SSquare{_}:
      False{}
    case _:
      True{}
```

**Quantities must line up exactly (10).** `List<U32>` is `List<&1, U32>`; wonky uses `List<&2, T>`
everywhere, and there is no upcast. A def passed as `~f` must have exactly the expected parameter
quantities: `inc(+x: U32)` is `@+x:U32 -> U32`, not `U32 -> U32`.

```bend
# expect: error List<&1, U32>
import Base

def keep(xs: List<&2, U32>) -> List<U32>:
  xs
```

```bend
# expect: error @+x:U32 -> U32
import Base

def inc(+x: U32) -> U32:
  (x + 1 : U32)

def twice(~f: U32 -> U32, x: U32) -> U32:
  f(f(x))

def two(x: U32) -> U32:
  twice(~inc, x)
```

Fix: `def inc(x: U32) -> U32` (it uses `x` once), or a wrapper def with the plain signature.

### 2.2 Affinity: `x (consumed more than once)` (125)

A plain binder is used at most once per path. Mark reuse with `+` where the name is bound: parameter
`+x`, let `+y = ...`, pattern `case +h <> +t`, `Real{+hi, lo} = r`, Nat predecessor `case 1n+ +p`
(or `1n++p`). `+` needs a `Data` type. Uses in different match branches do not add up; the two
calls of a parallel let do. The most reported names were `acc` (15), `p` (10), `t` (8), `f` (7).

```bend
# expect: error acc (consumed more than once)
import Base

def twice_plus(acc: U32, x: U32) -> U32:
  ((acc + x : U32) + acc : U32)
```

```bend
# expect: error p (consumed more than once)
import Base

def countdown(n: Nat) -> List<&2, U32>:
  match n:
    case 0n:
      Nil{}
    case 1n+p:
      U32.from_nat(p) <> countdown(p)
```

```bend
import Base

def twice_plus(+acc: U32, x: U32) -> U32:
  ((acc + x : U32) + acc : U32)

def countdown(n: Nat) -> List<&2, U32>:
  match n:
    case 0n:
      Nil{}
    case 1n+ +p:
      U32.from_nat(p) <> countdown(p)

def dup_heads(xs: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      Nil{}
    case +h <> t:
      h <> h <> dup_heads(t)
```

**`Bool.pick` consumes both arms**, so a tail used in both arms is consumed twice (and both arms are
computed, see 4.1). Use a match helper:

```bend
# expect: error rest (consumed more than once)
import Base

def push(+x: U32, xs: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      [x]
    case +y <> rest:
      Bool.pick(List<&2, U32>, U32.is_eq(x, y), y <> rest, x <> y <> rest)
```

```bend
import Base

def push.k(same: Bool, x: U32, y: U32, rest: List<&2, U32>) -> List<&2, U32>:
  match same:
    case True{}:
      y <> rest
    case False{}:
      x <> y <> rest

def push(+x: U32, xs: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      [x]
    case +y <> rest:
      push.k(U32.is_eq(x, y), x, y, rest)
```

**Closures are single-use, and `+` does not apply to functions.** Take a function you call twice as a
template `~f`. A `~` argument must be closed: top-level defs and closed lambdas, no locals.

```bend
# expect: error f (consumed more than once)
import Base

def app2(f: U32 -> U32, x: U32) -> U32:
  f(f(x))
```

```bend
import Base

def inc(x: U32) -> U32:
  (x + 1 : U32)

def app2(~f: U32 -> U32, x: U32) -> U32:
  f(f(x))

def plus2(x: U32) -> U32:
  app2(~inc, x)
```

### 2.3 Names and definition order (113)

**Define before use (81).** Every def and type must appear above its first use. 46 of the mined
cases were helpers such as `f.k`, `f.if`, `f.go` placed below their caller.

```bend
# expect: error a defined name
import Base

def count_eq(xs: List<&2, U32>, +k: U32) -> U32:
  match xs:
    case Nil{}:
      0
    case h <> t:
      count_eq.k(U32.is_eq(h, k), count_eq(t, k))

def count_eq.k(hit: Bool, rest: U32) -> U32:
  match hit:
    case True{}:
      (rest + 1 : U32)
    case False{}:
      rest
```

```bend
import Base

def count_eq.k(hit: Bool, rest: U32) -> U32:
  match hit:
    case True{}:
      (rest + 1 : U32)
    case False{}:
      rest

def count_eq(xs: List<&2, U32>, +k: U32) -> U32:
  match xs:
    case Nil{}:
      0
    case h <> t:
      count_eq.k(U32.is_eq(h, k), count_eq(t, k))
```

**No mutual recursion.** It can never be ordered. Merge the two defs into one with a selector
argument, or have the non-recursive half return a value the recursive caller acts on (section 3).

```bend
# expect: error a defined name
import Base

def is_even(n: Nat) -> Bool:
  match n:
    case 0n:
      True{}
    case 1n+p:
      is_odd(p)

def is_odd(n: Nat) -> Bool:
  match n:
    case 0n:
      False{}
    case 1n+p:
      is_even(p)
```

```bend
import Base

def parity(n: Nat, want_even: Bool) -> Bool:
  match n:
    case 0n:
      want_even
    case 1n+p:
      parity(p, Bool.not(want_even))
```

**Constructor names clash with Base (17).** Constructor names are global to a namespace, and the
entry file shares its namespace with Base, which owns `Done`, `Fail`, `Some`, `None`, `Nil`, `Con`,
`True`, `False`, `LT`/`EQ`/`GT`, `Tuple`, `Unit`, `WNil`/`WCon`, `Zero`/`Succ` and more.

```bend
# expect: error duplicate declaration: Done
import Base

type Walk is Data:
  Done{}
  Step{n: U32}
```

Prefix every constructor with its type (`WDone{}`, `WStep{..}`). The trap in wonky: a module that
declares `Done{}` **passes** when imported (by `PROOF.bend`, so `npm run check:bend` is green) and
**fails** when it is the entry, which is what `bend kernel/x.bend --check-only` and
`loadBend(kernel/x.bend)` do (verified with the CLI: `tmp/bend-skill/snippets/skill/delta/mods/done.bend`
vs `d18_import_done.bend`; the loader compiles the same entry file). Two types in one file also cannot share a constructor name.

**Keywords are not names (9).** `def type law match case do return for exs where is import Type
Data Kind Quant`. `as`, `if` and `cases` are not reserved. Rename: `SurfKind`, `where_of`, `exs_`.

```bend
# expect: error got the keyword 'Kind'
import Base

type Kind is Data:
  Planar{}
  Curved{}
```

**No field access with dots.** `p.x` is looked up as a def (dots are ordinary name characters, which
is why `f.k` helpers work). Destructure instead. There are no generated accessors (`B.FCtx.pos`
does not exist).

```bend
# expect: error a defined name
import Base

type P is Data:
  P{x: U32, y: U32}

def px(p: P) -> U32:
  p.x
```

```bend
import Base

type P is Data:
  P{x: U32, y: U32}

def px(p: P) -> U32:
  P{x, _} = p
  x
```

**Aliases are not transitive (5).** If `p.bend` imports `r.bend as R`, then `P.R.Real` does not
exist: import `r.bend` yourself (`tmp/bend-skill/snippets/errs/i_transitive.bend`). Qualify imported
types and constructors (`R.Real{hi, lo}`, `case RP.Positive{}:`); a bare `Positive{}` is `a declared
constructor (unknown: Positive)`. Import each module through one canonical relative path, otherwise
`one namespace per file (... is both 'a' and 'b')`.

### 2.4 Match and scrutinee rules (94 unique, 236 raw)

A `match` or a destructuring let (`K{a, b} = v`, `(a, b) = v`) sees only **a parameter or a field bound
by an earlier pattern**, in declaration order, and **before any let**. It never sees a computed value
or a let-bound local. Shape every def as "destructure parameters in order, then compute". Branch on
anything computed through a helper def (defined above, rule 2.3).

```bend
# expect: error a match on a parameter or field
import Base

type P is Data:
  P{x: U32, y: U32}

def scaled_sum(+k: U32, p: P) -> U32:
  k2 = (k * 2 : U32)
  P{x, y} = p
  ((x + y : U32) * k2 : U32)
```

```bend
import Base

type P is Data:
  P{x: U32, y: U32}

def scaled_sum(+k: U32, p: P) -> U32:
  P{x, y} = p
  k2 = (k * 2 : U32)
  ((x + y : U32) * k2 : U32)
```

Matching a later parameter before an earlier one fails the same way. Match in declaration order,
or use one multi-scrutinee match:

```bend
# expect: error a match on a parameter or field
import Base

def both(a: Bool, b: Bool) -> U32:
  match b:
    case True{}:
      match a:
        case True{}:
          3
        case False{}:
          2
    case False{}:
      0
```

```bend
import Base

def both(a: Bool, b: Bool) -> U32:
  match a b:
    case True{} True{}:
      3
    case False{} True{}:
      2
    case _ False{}:
      0
```

A computed scrutinee, a let-bound local, and a destructured call result are all rejected:

```bend
# expect: error cannot scrutinize a computed value
import Base

def nonzero(x: U32) -> U32:
  match U32.is_eq(x, 0):
    case True{}:
      0
    case False{}:
      1
```

```bend
# expect: error cannot scrutinize a local binder
import Base

def nonzero(x: U32) -> U32:
  zero = U32.is_eq(x, 0)
  match zero:
    case True{}:
      0
    case False{}:
      1
```

```bend
# expect: error cannot scrutinize a computed value
import Base

def split(+x: U32) -> U32 & U32:
  (x, (x + 1 : U32))

def total(x: U32) -> U32:
  (a, b) = split(x)
  (a + b : U32)
```

The fix is always a helper whose **parameter** is the value:

```bend
import Base

def nonzero.k(zero: Bool) -> U32:
  match zero:
    case True{}:
      0
    case False{}:
      1

def nonzero(x: U32) -> U32:
  nonzero.k(U32.is_eq(x, 0))

def split(+x: U32) -> U32 & U32:
  (x, (x + 1 : U32))

def total.k(r: U32 & U32) -> U32:
  (a, b) = r
  (a + b : U32)

def total(x: U32) -> U32:
  total.k(split(x))
```

Other match rules: `match` cannot appear inside a lambda (reported as `a match on a parameter or
field`; `delta/d19_lambda_match.bend`); matching the same value twice in nested cases, or destructuring
a tuple literal (`(a, b) = (acc, 1)`), gives `an undestructed scrutinee` (fold it into the outer case);
a destructure lists every field (`a EC pattern with 8 fields`), so when a record gains a field, grep
`Ctor{` and update every destructure; a one-row destructure `K{..} = v` of a type with several
constructors is `cases for ...`; an erased `-x` cannot be matched in live code (`a live scrutinee`).
(Probes: `tmp/bend-skill/verify/probes.md`, `probes5.md`.)

### 2.5 Native, Metal and stack limits (34)

See section 5. The messages: `Error: an arity over 255` (emit time), `Maximum call stack size exceeded`
(JS under `loadBend`), `bend: memory fault (machine stack overflow?)` (native, Metal, and also the JS
lane of `bend x.bend`), `Error: the machine stack overflowed (a deep recursion, or a literal too large
to expand)` (the checker normalizing huge proof terms or computed Nats),
`bend: out of memory: run again with a bigger span, as in --gpu 8GB`.

### 2.6 Syntax and keywords (32)

**No negative literals.** A `-` glued to a token heads a binder.

```bend
# expect: error expected : a name
import Base

def minus_one() -> F32:
  -1.0
```

```bend
import Base
import ./real.bend as R

def minus_one() -> F32:
  F32.neg(1.0)

def minus_one_b() -> F32:
  (0.0 - 1.0 : F32)

def minus_one_real() -> R.Real:
  R.neg(R.from_f32(1.0))
```

Also: no `if` (`if c:` gives `expected : '='`), no `|>` pipe, spaces around operators (`(a>b : U32)`
fails), constructors always with braces (`True{}`; a bare `True` is `a defined name` as a term),
imports only at the head of the file, and every non-law def declares `-> T`. In `do` blocks, every
bind is typed (`x : T <- m`) and destructuring is not allowed; destructure in a helper def. Prefer an
explicit `IO.bind(...)` over a typed `<-` bind with a compound type (4 mined failures).

### 2.7 Laws and proofs (27)

Live code cannot call a law without a proof def:

```bend
# expect: error a filled definition
import Base

law foo:
  for x: U32
  U32

def g(x: U32) -> U32:
  foo(x)
```

20 of the 27 were proof goals that did not normalize to the stated equation (arithmetic lemmas in
`kernel/laws/spike`). Fix by chaining `Equal.cong`/`Equal.sym` rewrites or splitting into smaller
lemmas. Nothing about F32 is provable: F32 ops are bodiless Base laws. See section 10.

### 2.8 Termination and fuel (21)

Arguments are read **left to right**: each must be passed unchanged until one is a strict subterm of
its parameter's pattern (`t` from `h <> t`, `p` from `1n+p`); every argument after it is free.
`Nat.sub(n, 1n)`, `tail(xs)` and any computed value count as not shrinking.

```bend
# expect: error a decreasing self-call
import Base

def fan(+base: U32, +i: U32, l: Nat) -> List<&2, U32>:
  match l:
    case 0n:
      Nil{}
    case 1n+rest:
      (base + i : U32) <> fan(base, (i + 1 : U32), rest)
```

```bend
import Base

def fan(l: Nat, +base: U32, +i: U32) -> List<&2, U32>:
  match l:
    case 0n:
      Nil{}
    case 1n+rest:
      (base + i : U32) <> fan(rest, base, (i + 1 : U32))
```

When nothing shrinks structurally (halving, Newton, graph walks, fixpoints), add `fuel: Nat` as the
**first** parameter. Fuel exhaustion returns an explicit error value, never a silent truncation
(AGENTS.md: capability errors):

```bend
import Base

type Steps is Data:
  Reached{n: U32}
  OutOfFuel{}

def steps(fuel: Nat, zero: Bool, +x: U32, n: U32) -> Steps:
  match fuel zero:
    case _ True{}:
      Reached{n}
    case 0n False{}:
      OutOfFuel{}
    case 1n+left False{}:
      steps(left, U32.is_eq((x >> 1n : U32), 0), (x >> 1n : U32), (n + 1 : U32))

def halvings(+x: U32) -> Steps:
  steps(33n, U32.is_eq(x, 0), x, 0)
```

Do not use `@unsafe` to dodge descent: the verdict then reads `All terms check, but N defs rely on
unsafe or foreign code` (exit code 0, so `npm run check:bend` stays green: the gate hole in
section 10). The kernel keeps `@unsafe` to the service event loop (`kernel/service/binding/probe.bend`).

### 2.9 CLI and runtime (8)

`bend --version` is an unknown option (use `bend version`); there is no `--target` (the `-o`
extension picks it: `x.c`, `x.js`, or a binary); `--threads` and `--gpu` (`on`, `off` or a size such
as `8GB`) are flags of the built binary, not of `bend` (`bend x.bend --gpu off` is `unknown option`);
building a file without `main` (`-o`) says `Error: no main to run`, while `bend x.bend` just prints
`All terms check.` (use `--check-only`). Runtime traps:
`bend: a Nat past the largest immediate 2^48-1` (native and JS; keep counters in U32 or bound them)
and `runtime fail-stop` (inspect on the JS target first).

---

## 3. Idioms the kernel uses

**The `.k` / `_pick` helper.** Compute a `Bool` (or a `Cmp`, a `Decision`) in the caller, pass it to a
helper that matches its first parameter and computes each arm inside its own case. `kernel/real.bend`
`sqrt -> sqrt_pick`, `atan2 -> atan2_pick`; Base's `U32.div.if`. Define the helper above the caller.

**The `*_done` pair helper.** Container operations return `(container, answer)`. Pass that pair to the
next def as a parameter and destructure it there (`kernel/lib/id-vec.bend` `length_done`, `get_done`;
section 9).

**Carry a decision through the recursion** instead of recomputing it or calling back:
`steps(fuel, zero, ...)` in 2.8, `kernel/tessellate.bend` `refine(fuel, ok, ...)`,
`kernel/sketch-arcs.bend` merge sort with `right_first`.

**Replace mutual recursion** with one recursive def and a selector or a `Task`/`Step` constructor that
says which role runs next; non-recursive halves return the next task instead of calling back
(docs/language/bend-feasibility.md:171-180).

**Tail recursion with a reversed accumulator.** Loops over data-sized lists must be tail calls (4.2):

```bend
# expect-run: 12
# expect-native: 12
import Base

def double_rev(xs: List<&2, U32>, acc: List<&2, U32>) -> List<&2, U32>:
  match xs:
    case Nil{}:
      acc
    case h <> t:
      double_rev(t, (h * 2 : U32) <> acc)

def double(xs: List<&2, U32>) -> List<&2, U32>:
  List.reverse(&2, U32, double_rev(xs, Nil{}))

def sum(xs: List<&2, U32>, acc: U32) -> U32:
  match xs:
    case Nil{}:
      acc
    case h <> t:
      sum(t, (acc + h : U32))

def main() -> IO(Unit):
  IO.print(U32.show(sum(double([1, 2, 3]), 0)))
```

**Multi-column match.** `match fuel arcs:` with one pattern per scrutinee; put the list column first
where it drives recursion; write explicit constructors, no whole-scrutinee binders.

**Explain Bend-forced shapes** in a comment above the def (`kernel/step-pcurves.bend:769-770`,
`kernel/tessellate.bend:41-42`).

---

## 4. Performance

### 4.1 `Bool.pick` evaluates both arms

Evaluation is strict. `Bool.pick(T, c, a, b)` is an ordinary def, so `a` and `b` are both computed
before it picks. `Bool.and`, `Bool.or`, `&&`, `||` also evaluate both sides (verified 2.0.25: a trapping
right side of `Bool.or(True{}, ..)` and `(True{} || ..)` fail-stops on JS and cpu1). Measured: a pick
with a slow arm took 7.6 s against 0.2 s for a match helper on JS
(`tmp/bend-skill/snippets/syntax/v01a_pick.bend` vs `v01b_match.bend`) and 4.9 s against 0.4 s natively
with a runtime condition (`tmp/bend-skill/verify/native/pick_rt*.bend`; only a literal `True{}`
condition gets folded away by the native compiler); in the fillet prototype a comb case went from over 2 min to 277 ms by replacing
picks around recursive calls with `cons_if`/`inc_if` match helpers (docs/fillet/proto-rollingball.md:556-560).

- Fine: `Bool.pick` over cheap, already-computed values (`R.abs`, `R.max`, `R.min` do this).
- Never: a recursive call or an expensive computation in an arm. A walk with a recursive call in a
  pick arm does the recursion even when it is done, and turns exponential with several such arms.
- Also never for short-circuit guards over expensive predicates: write a match helper.

### 4.2 Stack depth

- JS target: Base `List.length`, `List.foldr` and `List.sort` are not tail-recursive. Measured with
  2.0.25 (`tmp/bend-skill/verify/probes4.md`, `verify/loader/len.bend`): `List.length` over a list
  overflows at 10k elements under `loadBend` (5k passes; plain Node stack, `Maximum call stack size
  exceeded`) and at 30k in `bend x.bend` (20k passes; `memory fault (machine stack overflow?)`); cpu1
  handles 100k. docs/proto-exact-plane.md:579-584 reports ~50k with an 8 MB stack. Tail calls use no
  stack on JS (a tail loop over 1M elements runs under `loadBend`).
- Production limits seen: merge overflowed at 2,500 elements until made tail-recursive; prisms with
  1,536+ faces overflowed in `identity.bend` roles (development evidence kept locally).
- Metal: any non-tail recursion over a long list overflows the device stack (`memory fault (machine
  stack overflow?)`); a 240-edge gear polygon did until `poly_keep` became tail-recursive
  (docs/proto-sdf.md:196-199).
- The checker itself overflows (`Maximum call stack size exceeded`) when proofs normalize huge
  `Word`/`U32`/Nat terms: prove over small lemmas, keep big terms opaque.

### 4.3 Fork-join on the CPU pool

Parallel lets `a b = f(x) g(y)` fork. What the measurements in this repo say:

- **Sharing kills scaling.** Each lane that reads a shared `+` value pays an atomic refcount
  operation per read (`bend guide`, "what the lanes share"). Keep single ownership of big data in
  parallel phases (docs/proto-corefine.md:443-446, 590-591).
- **Fork only near the top.** Forking every level of a tree join was 5x slower at 18 threads than
  forking the top 5 levels (docs/proto-recover.md:826-831). After a non-tail self call whose callee
  forked, later parallel lets in that frame ran sequentially (docs/proto-corefine.md:447-452).
- **Hoist per-node bookkeeping out of branch nodes:** 2.15 s to 0.59 s (docs/hardware-performance.md:60-72).
- **Small work does not scale:** 6 threads gave 1.5-1.7x on the planar kernel
  (docs/native-bridge/binding.md:297). Fillets and Booleans run on the CPU pool with `--gpu off`
  (docs/fillet-plan.md:388-393).

A balanced binary fork tree (the depth shrinks first, both halves equal):

```bend
# expect-run: 120
import Base

def tree_sum(depth: Nat, +lo: U32) -> U32:
  match depth:
    case 0n:
      lo
    case 1n+ +d:
      a b = tree_sum(d, (lo * 2 : U32)) tree_sum(d, (lo * 2 + 1 : U32))
      (a + b : U32)

def main() -> IO(Unit):
  IO.print(U32.show(tree_sum(4n, 0)))
```

### 4.4 Metal (`f!(x)`)

- **Never make the whole build the device call.** It overflowed the machine stack on 68 of 70 cases;
  making only the station solve the device call took the build from 504 s to 35 s
  (docs/fillet/proto-rollingball.md:561-564).
- Device work must be flat numeric: flat F32 records, a fork tree, flat loops; no lists, no Big ints.
  List-heavy divergent code is 20-40x slower on Metal (docs/fillet/proto-kpart.md:331-332).
- A `!` after host forks in the same evaluation falls back to the CPU pool: separate stages with
  `IO.now` steps (docs/proto-corefine.md:459-468).
- Fixed costs: ~35 ms per Metal pass, 18.97 s Metal compile vs 1.47 s ARM64
  (docs/hardware-performance.md:86-87). The harness caps the device heap at 1 GB; big jobs need
  `--gpu 8GB`.
- **Prove Metal ran:** count `wonky_metal_passes` / `metalPasses >= 1`; otherwise a silent CPU
  fallback is not a GPU measurement (docs/hardware-performance.md:97-101).

### 4.5 Lists versus collections

`List.get` and list scans are O(n). r10b spent 94% of kernel self time in four list folds; the
IdVec/IdSet rewrite took the kernel from 68.0 s to 2.6 s, byte-identical (docs/collections.md:3-11).
Stop fixpoint loops at the fixpoint, not after E passes (1539 ms to 68 ms,
docs/fillet/proto-kpart.md:333-334). Prepare per-operand data once, not per query.

---

## 5. Targets and native limits

**Order: JS reference first, cpu1 next, cpuN and Metal only in integration/verify.**

| lane | how | use it for |
|---|---|---|
| JS reference | `loadBend` in tests, `bend x.bend` for an IO main | correctness, differential oracle; sequential; 5-35x slower than native |
| cpu1 | `bend x.bend -o out/x`, `out/x --threads 1 --gpu off -- in out` | deterministic native run; catches the 255-word limit and Nat/stack fail-stops |
| cpuN | `--threads N --gpu off` | integration and benchmarks only |
| Metal | `--gpu 1GB` (harness), `!` calls, `-DBEND_METAL=1` builds | verify/bench stage only, one device call per stage |

Never infer native or GPU speed from the JS target (AGENTS.md). Results must agree byte for byte
across js/cpu1/cpuN/metal (`targetsAgree`, docs/bakeoff.md:287-288).

### 5.1 The 255-word limit

The C backend flattens non-recursive records (sum types too) into words; `U32`, `F32` and `Nat` are one
word each, and arity tables are one byte. Emitting C fails with `Error: an arity over 255` when that
byte overflows. `--check-only` and the JS target never report it: **run `-o x.c` whenever you widen a
record.** What was verified with 2.0.25 (`tmp/bend-skill/snippets/errs/` and `snippets/skill/delta/`):

| case | result |
|---|---|
| one constructor with 300 `U32` fields (`errs/x_wide.bend`, `delta/d21`) | checks clean, **fails** at `-o x.c` |
| the same with a never-built recursive constructor added (`delta/d22`) | **still fails**: boxing does not help a single constructor over 255 fields |
| two 150-field sub-records inside one record (`errs/x_nested.bend`) | emits and runs |
| two 150-field records live across a non-tail call, flat or boxed (`delta/d23`, `d24`, `d25`) | emits and runs: the backend boxes multi-word values itself (`lay_wide`, `comp.ts:985-989`) |
| a single 300-operand `( ... : U32)` chain (`tmp/bend-skill/verify/probes5.md` q7) | `-o x.c` succeeds; the binary build `-o x` then **fails in clang**: `bracket nesting level exceeded maximum of 256` |

Rule: no constructor with more than 255 one-word fields. Group scalars into sub-records (below), or
hold long data in a list or an `IdVec`. The kernel also uses a never-built constructor to keep a wide
record boxed (`BlendNil{next: Blend}`, kernel/proto/fillet-rollingball/brep.bend:66-77, "two of them in
one continuation break the backend's 255-word limit"); that failure did not reproduce in these probes,
so treat the boxing trick as **[unverified in 2.0.25]** and check with `-o x.c`. Still blocked in the
kernel: `ports/curved-intersection.bend:intersect` (docs/native-bridge.md, section 1; not re-run here).

```bend
# expect-c: ok
import Base

# Scalars grouped into sub-records: each constructor stays far below 255 fields.
type Frame is Data:
  Frame{ox: F32, oy: F32, oz: F32, nx: F32, ny: F32, nz: F32}

type Station is Data:
  Station{id: U32, left: Frame, right: Frame}

def station_id(s: Station) -> U32:
  Station{id, _, _} = s
  id

def main() -> IO(Unit):
  +f = {Frame{0.0, 0.0, 0.0, 0.0, 0.0, 1.0} : Frame}
  IO.print(U32.show(station_id(Station{7, f, f})))
```

### 5.2 Other native facts

- `Nat` is a 48-bit immediate: past `2^48-1` the runtime fail-stops (JS and native).
- U32 wraps mod 2^32; `a / 0` is 0; `a % 0` is `a`; shifts by 32 or more give 0; `F32.to_u32` truncates
  and gives 0 for negative input ([syntax.md](syntax.md), section 6).
- `match` compiles to if/else with the last arm as the else: an out-of-range tag runs the last arm.
- Only defs reachable from `main` are emitted; there is no library mode or FFI beyond custom effects
  (`def e() -> IO(R)` with `import "./e.c"` / `"./e.js"`).
- Fail-stops on the calling thread are catchable in the native bridge (`BX_FAILSTOP`); on a pool worker
  (threads > 1 or any `!`) the process exits 1 (docs/native-bridge/binding.md:252-262).
- Full kernel relinks are expensive: 27 s and 7 GiB compiler RSS; cold JS compile of the full hull
  394 s (docs/native-bridge/surface.md:316). Import only what a file needs.

### 5.3 F32 across targets

- **Compare by bits, not by text.** `F32.show(20713.8125)` prints `20713.813` on JS and `20713.812`
  natively (verified 2.0.25, `delta/d20_f32_show.bend`).
- Metal flushes subnormals; JS and ARM64 keep them. Decide near-zero by an explicit threshold, and
  range-guard anything that relies on gradual underflow before it runs on Metal
  (docs/research/robust-numerics.md:171-197).
- NaN payload bits differ across targets: compare NaN as a class.
- No FMA anywhere: native C uses `#pragma clang fp contract(off)`, Metal `MTLMathModeSafe`.

---

## 6. Testing lanes

| command | what |
|---|---|
| `npm run -s check:bend` | `bend PROOF.bend`: laws plus type/termination check of every imported kernel file |
| `npm run -s test:fast` | test files recorded under 20 s, fail-fast |
| `npm run -s test:changed` | test files that mention a file changed against HEAD, fail-fast |
| `node scripts/test-lane.mjs files a.test.mjs b.test.mjs` | exactly these files |
| `npm run -s test:slow` | end-to-end, OCCT, corpus |
| `npm test` | `check:bend` + every `test/*.test.mjs` (required before handing off relevant changes) |
| `node --test test/robust-predicates.test.mjs` | exact predicates against a BigInt oracle |
| `node --test test/collections.test.mjs` (`WONKY_COLLECTIONS_NATIVE=1` for native, ~30 s) | adapters |
| `uv run scripts/validate-step.py <prefix> ...` | STEP exports, when geometry/export changes |

`--fail-fast` is for development loops only; integration and verification runs want every failure.
The machine is shared: record load or use `process.cpuUsage` when timing.

---

## 7. R.*: F32x2 reals

`kernel/real.bend` (import as `R`): `Real{hi: F32, lo: F32}`, `from_f32`, `approx`, `renorm`, `neg`,
`add`, `sub`, `mul`, `div`, `less`, `equal`, `abs`, `max`, `min`, `sqrt` (exact 0 for 0), `pi`,
`atan`, `atan2`, `sin`, `cos`, `reduce_angle`. There is no F64 and no I64 in Bend.

```bend
import Base
import ./real.bend as R

def hyp(+a: F32, +b: F32) -> R.Real:
  R.sqrt(R.add(R.mul(R.from_f32(a), R.from_f32(a)), R.mul(R.from_f32(b), R.from_f32(b))))

def clamp_one.k(over: Bool, x: R.Real) -> R.Real:
  match over:
    case True{}:
      R.from_f32(1.0)
    case False{}:
      x

def clamp_one(+x: R.Real) -> R.Real:
  clamp_one.k(R.less(R.from_f32(1.0), x), x)

def hi_word(x: R.Real) -> F32:
  R.Real{hi, _} = x
  hi
```

Limits (docs/research/robust-numerics.md, docs/hybrid-robust.md):

- ~44-46 guaranteed bits; the exponent range stays F32's. It is a filter and evaluation type,
  **never exact**. Exact decisions go through `robust-predicates.bend`.
- `R.add` worst error 2^-46.83 of the operand magnitude, but relative error under cancellation is poor
  (2^-13.5): scale filters by the operands.
- `mul` uses the Veltkamp split (4097); no FMA on any target.
- "Comparing two Reals is exact" assumes canonical `renorm` output, which is not proved. Words that come
  back from Bend are not always the encoder's canonical split: compare round trips by value.
- `0.1 + 0.2` in F32x2 is `0.2999999999999998`: FeatureScript double results are not bit-reproducible.
- F32 facts are not provable (bodiless Base laws), and a value-returning `main` prints stuck F32 terms:
  test F32 code through an IO main, the JS loader, or a native build.

---

## 8. Exact predicates

`kernel/robust-predicates.bend` (docs/robust-predicates.md):

- `point_plane(+normal, +point, +origin) -> Decision` and `classify(point: Point, +origin, +normal)`
  with `Point = Explicit{point} | LinePlane{first, last, origin, normal}` (vectors are `precise.bend`
  `Vec3 = V3{x, y, z: R.Real}`, built with `G.v3(x, y, z)`).
- `Decision{sign: Sign, method: Method}`; `Sign = Negative | ExactlyZero | Positive | Undefined`;
  `Method = FloatFilter | ExactDyadic | IndirectExact | Invalid`. **Always handle `Undefined`**
  (NaN/inf inputs, zero denominator).
- The sign is about the represented words, not a tolerance: callers still choose tolerances.
  `LinePlane` has no float filter and the line is unbounded (segment membership is separate).
- Exact tier: signed base-4096 digit lists decoded from F32 bits (subnormals included, FTZ-immune);
  the fast filter admits exponents 87..167 only. Cost native: exact 1.3-6.0 us, filter 0.10-0.20 us.

```bend
import Base
import ./precise.bend as G
import ./robust-predicates.bend as RP

def side.k(d: RP.Decision) -> U32:
  match d:
    case RP.Decision{RP.Positive{}, _}:
      1
    case RP.Decision{RP.Negative{}, _}:
      2
    case RP.Decision{RP.ExactlyZero{}, _}:
      0
    case RP.Decision{RP.Undefined{}, _}:
      3

def side(p: G.Vec3) -> U32:
  side.k(RP.point_plane(G.v3(0.0, 0.0, 1.0), p, G.v3(0.0, 0.0, 0.0)))
```

---

## 9. bend-collections and kernel/lib

- Never edit `kernel/vendor/bend-collections/src/`; wonky code goes to `kernel/lib/`. Verify the vendor
  tree with `node scripts/vendor/bend-collections.mjs [--offline]`.
- Adapters: `lib/id-vec.bend` (`IdVec<T>`, dense U32 id to T), `lib/id-set.bend` (`IdSet`, bitset of
  ids), `lib/keys.bend` (`IdPair`/`edge`/`pair_cmp`, `Key3`/`vec3_key`/`f32_order`, `then`). The tree map
  is used directly. The hash map is String-keyed only: not for ids.
- `IdVec` and `IdSet` are `is Type` (they own an array): thread them, never `+` them, never store them in
  a `Data` record. Every operation returns `(container, answer)`; pass the pair on as a parameter.
- Out-of-range reads return the caller's fallback; out-of-range writes return `False` and change nothing.
- Collections must not decide output order: keep scan tie-breaks (`put` keeps the last,
  `put_if_absent` the first). `vec3_key` is bit-exact, not a tolerance test.
- Import only what you need: the full 25-module probe costs 13.4 s cold JS compile against 0.1-0.44 s
  per adapter. On the JS target the tree map only wins above a few thousand entries.

```bend
import Base
import ./lib/id-vec.bend as IdVec

def read_answer(r: IdVec.IdVec<U32> & U32) -> U32:
  (_, x) = r
  x

def read_second(r: IdVec.IdVec<U32> & Bool) -> U32:
  (v, _) = r
  read_answer(IdVec.get(U32, v, 1, 0))

def second(xs: List<&2, U32>) -> U32:
  read_second(IdVec.from_list(U32, xs))
```

A native slice that imports changed passes needs `node scripts/native-bridge/build-native.mjs --set planar`.

---

## 10. LAWS.bend and PROOF.bend

- `LAWS.bend` states `law name: for +x: T ... {lhs == rhs : T}`. It, `laws.lock.json` and
  `kernel/laws/spec/**` belong to Marc. Agents write drafts in `kernel/laws/draft/` with a proof and at
  least one killed mutant (docs/laws.md:155-177).
- `PROOF.bend` imports `./LAWS.bend as Laws` and fills each law with `def Laws.name(x, y):` (bare
  names, no types, no `->`). Proof terms: `{==}` (by evaluation), `match` (cases), a recursive call
  (induction), `%e : P` (rewrite; `_` in `P` marks the right side of `e`, which is replaced by its
  left), `?name` (print the goal).
- A law and its proof in one file (the proof def has the law's name):

```bend
import Base

law not_not:
  for b: Bool
  {Bool.not(Bool.not(b)) == b : Bool}

def not_not(b):
  match b:
    case True{}:
      {==}
    case False{}:
      {==}
```

- **Only the exact last line `All terms check.` is green.** Bend exits 0 on `All terms check, but N defs
  rely on unsafe or foreign code:` and `scripts/check-bend.mjs` checks only the exit code, so an
  `@unsafe` def or a foreign import passes `npm test`. Read the output. No `@unsafe`, no `?` holes.
- **What the gate covers (verified for 2.0.25):** every def of every file imported (transitively) by
  `PROOF.bend`, whether reached or not (`delta/d01_reach.bend`, `d02_reach_none.bend`: an unused bad
  def in an imported module fails the check). A new module is gated once `PROOF.bend` imports it,
  directly or through another module. The `*_checked` "reachability" defs at the end of `PROOF.bend`
  are harmless but not needed for checking in 2.0.25; the comment above them predates this.
- F32 facts are unprovable. U32 is `Word(32n)` and provable by induction. Computed Nats of 2^15 or more
  inside a type overflow the checker stack (literals are fine). Evaluation proofs grow about cubically:
  keep instance laws small.
- Use a timeout on checker runs (a probe once hung for over 2 minutes).

---

## 11. Module structure

- Header: `import Base`, then relative imports with short aliases (`import ./real.bend as R`,
  `import ./precise.bend as G`). Imports only at the top.
- Inside a file: types first (leaves before the types that use them), then helpers, then callers.
  `tmp/r20/prism-boolean/reorder.mjs` topologically reorders the top-level blocks of a file.
- Prefix constructors with their type; keep them unique against Base (2.3).
- Errors are values: every helper has an explicit propagation arm; unsupported input returns a
  capability error, never a silent fallback (AGENTS.md).
- Records that cross native calls stay under 255 words; box or nest wide ones (5.1).
- Prototypes: `kernel/proto/<name>/main.bend` exports `run` (ideally `parse`/`solve`/`show`), copies
  `null/native.bend`, marks one device call with `# @bakeoff-device-call`, and answers
  `unresolved <reason>` when it refuses (docs/bakeoff.md:237-261).

---

## 12. Loader and cache

`src/bend-loader.mjs` compiles with the pinned compiler and caches JS in `.tools/bend-js-cache/`
(content-hashed over transitive local imports, compiler, lock and Node version; cold 4,088 ms to warm
333 ms for the bracket CLI). Options: `loadBend(url, { cache: false })`, `cacheDirectory`,
`compilerDirectory`, `lockFile`; `WONKY_BEND_CACHE=0` disables reads and writes globally. Only local
`import ./x.bend as X` lines are followed; import cycles are rejected. Editing a source during its
compile raises `BEND_SOURCES_CHANGED`.

A one-off JS reference run of a scratch file, without touching the cache (verified with
`tmp/bend-skill/snippets/skill/loader/probe.bend`, which prints `{"$":"Real","hi":5,"lo":0}`):

```sh
WONKY_BEND_CACHE=0 node --input-type=module -e "
import { loadBend } from './src/bend-loader.mjs';
const k = await loadBend('tmp/scratch/probe.bend', { cache: false });
console.log(JSON.stringify(k.hyp(3, 4)));"
```

Records come back as `{ $: 'Ctor', field: ... }`; F32 arguments are JS numbers.

---

## 13. Where 2.0.25 differs from the mega skill

The mega skill (`~/.claude/skills/bend2-mega-skill`) was measured on 2.0.13 and audited on 2.0.16.
These differences were checked against the pinned 2.0.25 (probe files `dNN` in the scratch directory
`tmp/bend-skill/snippets/skill/delta/`, output in `run-check.txt`; command
`BEND_NO_TELEMETRY=1 .tools/bend-2.0.25/bin/bend <f> --check-only`). Rows marked with a block below are
also re-checked by `check-snippets.mjs`.

| topic | mega skill says | 2.0.25 does | evidence |
|---|---|---|---|
| version | `bend --version` | `unknown option --version`; use `bend version` | CLI |
| fast check | `scripts/bend-check.sh` (checks through C emission) | `bend f.bend --check-only` checks the file and its imports and runs nothing; cannot be combined with other options | `bend --help` |
| bare operators | a chain without `: T` is `Nat`'s | error `a type for this operator (write (a + b : Nat))`; the compiler notes it changed after 2.0.16 | d08, d09 |
| typed let | `x : T = v` only inside `do` | also works in a def body: `n : U32 = 2`, `g : U32 -> U32 = y => ...` | d07 |
| unsafe verdict | `All terms check, with N unsafe annotation(s)` | `All terms check, but N defs rely on unsafe or foreign code:` plus the list, which includes transitive callers such as `main` | d03, mega `tcp_server` skeleton |
| template instances | counted as unsafe in 2.0.16 | not counted: `List.map` instances and the mega `cli_tool`/`app_headless` skeletons check clean | d04 |
| unused template bodies | typechecked only per instance | type and affinity errors in an unused template body are reported | d13, d15 |
| what a check covers | (PROOF.bend comment in wonky: only reachable defs) | every def of every imported file | d01, d02 |
| constructor namespaces | imported modules may redeclare Base names | true, and it is a trap: the same module fails when checked or loaded as the entry | d18, mods/done.bend |

The three verdict-related rows, as checked files:

```bend
# expect: unsafe - spin
import Base

@unsafe def spin(+x: U32) -> U32:
  spin(x)
```

```bend
import Base

def inc(x: U32) -> U32:
  (x + 1 : U32)

def incs(xs: List<U32>) -> List<U32>:
  List.map(~U32, ~U32, ~inc, xs)
```

```bend
# expect: error expected : U32
import Base

def never_used(~f: U32 -> U32, x: U32) -> U32:
  1.5

def g(y: U32) -> U32:
  y
```

Confirmed unchanged: `1n++p` and `1n+ +p` both bind the predecessor reusable (d05, d06); `F32.show`
still differs between C and JS (d20); `U32` literal patterns work (d12); `--checkup` still exists;
`bend guide shaders` and `bend guide effects` exist.

---

## 14. Unverified claims

Taken from repo docs or transcripts, not reproduced for this guide:

- Metal memory faults and out-of-memory cases (4.4) and all Metal and fork-join timings: repo
  measurements on the shared machine, cited by file.
- Why `a filled definition` was once reported for an ordinary loop helper (transcripts only).
- The native-bridge facts in 5.2 (fail-stop handling, relink costs) come from docs/native-bridge/*.md.
- "Local names may not shadow defs" (development evidence kept locally) did **not** reproduce:
  a parameter and a let with a def's name both check.
