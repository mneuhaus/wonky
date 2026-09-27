# Bend 2.0.25 syntax cheat sheet (the subset wonky uses)

Companion to [guide.md](guide.md) and the `wonky-bend` skill. Rules cite the pinned compiler source in
`.tools/bend-source-2.0.25/bend2/` (`bend.ts` = parser and checker, `comp.ts` = C/JS emitter and runtime,
`base.bend` = Base, `main.ts` = CLI; `.tools/` is not in git: `npm run setup` installs it). `bend guide`
prints the full upstream guide for this version. Every `bend` block is a complete file checked by
`node docs/bend/check-snippets.mjs`; imports `./x.bend` resolve as if the file lived in
`kernel/`.

Construct frequency in `kernel/` (without vendor/, 2026-09-24): `match` 5376, `List<&2, ...>` 4471,
`Bool.pick` 1165, `(.. : U32)` 1898, `(.. : F32)` 944, `case Nn` 756, `fuel` 386, `do IO<` 180,
`~` template args 156, laws 60, parallel lets 51, `is Type` types 21, `!` GPU calls 7, `@unsafe` 1.

## 1. File layout

```bend
import Base
import ./real.bend as R

# Types first, leaves before the types that use them.
type Pt is Data:
  Pt{x: R.Real, y: R.Real}

# Helpers above callers; no forward references, no mutual recursion.
def pt_x(p: Pt) -> R.Real:
  Pt{x, _} = p
  x

def origin() -> Pt:
  Pt{R.from_f32(0.0), R.from_f32(0.0)}
```

- Imports only at the head of the file (`bend.ts:1062-1098`); a later import is a parse error. Forms:
  `import Base`, `import ./path.bend as Name` (`as` is mandatory, the path ends in `.bend`).
- Imported types and constructors are always qualified: `R.Real`, `R.Real{hi, lo}`, `case RP.Positive{}:`.
  Aliases are not re-exported (`P.R.Real` fails). Reaching one file through two relative paths gives
  `one namespace per file`.
- Declarations are revealed in file order (`bend.ts:3839-3846`): a use above the definition is
  `a defined name`. A type may refer to itself. Mutual recursion is impossible.
- A dot is an ordinary name character: `f.k`, `msort.go` are plain names; `p.x` is **not** field access.

## 2. Names

- Reserved (`bend.ts:1578-1582`): `def type law match case do return for exs where is import Type Data
  Kind Quant`. Not reserved: `as`, `if`, `cases`. Uppercase variable names are allowed.
- Constructor names are global per namespace; the entry file shares Base's (`Done Fail Some None Nil
  Con True False LT EQ GT Tuple Unit WNil WCon Zero Succ`...). Prefix constructors with their type.
- Duplicates: `a fresh name (duplicate declaration: f)`, `a fresh constructor name (...)`.
- Look names up: `bend base <Name>`, `bend base --types`. `U32.is_eq` exists, `U32.eq` does not;
  `String.eq` exists, `String.equal` does not.

## 3. Definitions and binders

| binder | meaning | needs |
|---|---|---|
| `x: A` | affine: at most one use per path; dropping is free | nothing |
| `+x: A` | reusable (refcounted natively) | `A` is `Data` |
| `-x: A` | erased: types and proofs only | nothing |
| `~x: A` | template, inlined at compile time; closed arguments only | leading position |
| `a` (bare, in a parameter list) | `-a: Quant` | |

```bend
import Base

def add3(+x: U32, -A: Type, y: U32) -> U32:
  ((x + x : U32) + (x + y : U32) : U32)

def lets(x: U32) -> U32:
  +k = {3 : U32}
  n : U32 = 4
  (k * k + n + x : U32)
```

- Every non-law def declares `-> T` (`a def with no return type fills a law`, `bend.ts:2563`).
- `@unsafe def` skips the descent check and relaxes the `Data` kind check on `+` binders (a `+f: U32 ->
  U32` parameter passes); affinity and scrutinee rules still apply. The verdict then names it and every
  def that reaches it (`main.ts:530-538`). Wonky code does not use it (guide 2.8).
- Newlines end a call spine: `g(x) (y + 1 : U32)` on one line parses as a call of `g(x)`'s result.
- Constructors always take braces: `True{}`, `Nil{}`, `LT{}`. Arity is checked: `P with 2 fields`.
- Parameterised types are always applied: `List` alone is `a family instance (write List<..>)`.

## 4. Types and kinds

```bend
import Base

type Sign is Data:
  SNeg{}
  SZero{}
  SPos{}

type Seg is Data:
  Seg{a: U32, b: U32, sign: Sign}

type Tagged<-T: Data> is Data:
  Tagged{tag: U32, value: T}

def seg_sign(s: Seg) -> Sign:
  Seg{_, _, sign} = s
  sign

def pair(+x: U32) -> U32 & U32:
  (x, x)
```

- `is Data` = copyable with `+` (`Kind(&2)`); `is Type` = one owner (`Kind(&1)`). A `Data` type cannot
  hold a `Type` field (functions, `Array`, handles, `IdVec`, any `is Type` record).
- `List<U32>` = `List<&1, U32>`; wonky writes `List<&2, T>` everywhere. No upcast between them.
- `A & B` is a pair, built `(a, b)`, taken apart with `(a, b) = p` (on a parameter). A compound first type
  argument needs parentheses: `X<(A & B), C>`. Prefer named records over tuples inside type arguments.
- Native layout: `U32`/`F32`/`Nat` are one word; no constructor may exceed 255 one-word fields
  (`Error: an arity over 255` at `-o x.c` only; guide 5.1).

## 5. match and destructuring

```bend
import Base

type Arc is Data:
  Arc{used: Bool, first: U32, last: U32}

def count_used(fuel: Nat, arcs: List<&2, Arc>, n: U32) -> U32:
  match fuel arcs:
    case _ Nil{}:
      n
    case 0n _:
      n
    case 1n+left Arc{True{}, _, _} <> rest:
      count_used(left, rest, (n + 1 : U32))
    case 1n+left Arc{False{}, _, _} <> rest:
      count_used(left, rest, n)

def small(x: U32) -> U32:
  match x:
    case 0:
      10
    case 1:
      11
    case _:
      0
```

- A scrutinee is a **parameter or a pattern-bound field**, never a computed value (`a match cannot
  scrutinize a computed value`) or a let-bound local (`... a local binder`) (`bend.ts:2714-2871`).
- Match and destructure in **declaration order** and **before any let**, otherwise `a match on a parameter
  or field (this name is a def or a consumed binder ...)` (`bend.ts:2762`; 139 mined hits, the top error).
- `K{a, b} = v` is a one-row match: same rules, and the type has exactly one constructor. List every field.
- Patterns: binders, `_`, `K{..}` (nested), `h <> t`, `[a, b]`, `(a, b)`, `0n`, `1n+p`, `1n++p` /
  `1n+ +p` (reusable predecessor), `U32` literals. One pattern per scrutinee. First matching row wins.
- Missing constructors: `cases for X, Y`. Matching the same value again: `an undestructed scrutinee`.
- No `match` inside a lambda. No `if` at all.

## 6. Numbers and operators

Literals: `42` (U32, at most 4294967295), `1.5` (F32), `3n` (Nat), `'c'`, `"s"`. No negative literals:
`F32.neg(2.5)` or `(0.0 - 2.5 : F32)`.

Every arithmetic, comparison, bitwise and shift group carries its type: `(a + b * c : U32)`; nested
parentheses inherit it, call arguments do not (`F32.abs((a - b : F32))`). A bare one is an error in 2.0.25 (`a type for this operator`). Typed operators:
`+ - * / %`, `.&. .|. .^.`, `<< >>` (shift by a **Nat**: `(x << 3n : U32)`), `< <= > >=` (answer
`Bool`). Fixed operators, no annotation needed: `&& ||` (Bool, eager: `Bool.and`/`Bool.or`), `++`
(`String.append`), `<>` (cons) (`bend.ts` `INFIX_OPS`, `parse_term_ns`). No `==` in terms
(`U32.is_eq`, `F32.is_eq`), no `^`, no `|>`. Spaces around operators are required (`(a+b : U32)` fails).

```bend
# expect-run: 4294967294 0 7 0 2
# expect-native: 4294967294 0 7 0 2
import Base

def show5(a: U32, b: U32, c: U32, d: U32, e: U32) -> String:
  U32.show(a) ++ " " ++ U32.show(b) ++ " " ++ U32.show(c) ++ " " ++ U32.show(d) ++ " " ++ U32.show(e)

def main() -> IO(Unit):
  IO.print(show5((3 - 5 : U32), (7 / 0 : U32), (7 % 0 : U32), (1 << 32n : U32), F32.to_u32(2.9)))
```

| op | result (JS and native agree) |
|---|---|
| `+ - *` on U32 | wrap mod 2^32 |
| `a / 0`, `a % 0` | `0`, `a` |
| shift by 32 or more | `0` |
| `F32.to_u32` | truncates; negative or out of range gives `0` |
| `Nat.sub` | saturates at `0n` |
| Nat past 2^48-1 | runtime fail-stop `a Nat past the largest immediate 2^48-1` |

Conversions are explicit: `U32.to_f32`, `F32.to_u32`, `U32.to_nat`, `U32.from_nat` (mod 2^32).
`U32.shl`/`U32.shr` shift by one; `U32.shln`/`U32.shrn` take a Nat. There is no `F32.cmp`. F32 ops are
bodiless Base laws: the checker cannot evaluate them, so test F32 through IO, the loader or native.

## 7. Recursion, termination, fuel

- Arguments are compared left to right with the def's own pattern columns: each passed **unchanged**
  until one is a **strict subterm** (`t` of `h <> t`, `p` of `1n+p`); later arguments are free
  (`bend.ts:893-931`). `Nat.sub`, `tail(xs)` and anything computed do not shrink.
- Put the shrinking parameter first (after erased type parameters); when nothing shrinks, add a leading
  `fuel: Nat` and return an explicit error value at `0n`.
- Error: `a decreasing self-call (arguments are read left to right: each passed unchanged until one shrinks)`.

```bend
import Base

def take(n: Nat, xs: List<&2, U32>) -> List<&2, U32>:
  match n xs:
    case 0n _:
      Nil{}
    case _ Nil{}:
      Nil{}
    case 1n+p h <> t:
      h <> take(p, t)
```

## 8. Lists, arrays, strings

- Lists: `[a, b]`, `h <> t`, `Nil{}`. Base list functions take quantity and type first:
  `List.length(&2, U32, xs)` (returns Nat), `List.reverse(&2, T, xs)`, `List.append(&2, T, xs, ys)`,
  `List.get(&2, T, xs, n)` (Maybe, O(n)). Higher-order ones are templates: `List.map(~A, ~B, ~f, xs)`
  works on `List<&1, A>` only; `List.foldr(~&2, ~A, ~B, ~f, xs, z)` takes a quantity.
- `List.length`, `List.foldr` and `List.sort` are not tail-recursive: on JS, `List.length` overflows at
  10k elements under `loadBend` and at 30k in `bend x.bend` (guide 4.2). Write tail loops.
- `Array<T>` is `is Type`: `[v : U32*8n]` (a power-of-two count) or `[v : T^3n]` (depth). The sugar
  `a[i]` (returns `Array<U32> & U32`) and `a[i] <- v` works only for `Array<U32>`; otherwise
  `Array.get(T, a, i)` (Data T), `Array.set`, `Array.swap`, `Array.size`. Indexes wrap. The kernel
  wraps arrays in `kernel/lib/id-vec.bend` instead of using them raw.
- Strings are cons lists of chars: `++`, `String.*`, `U32.show`, `Nat.show`, `F32.show`.

```bend
# expect-run: 42
import Base

def cell(r: Array<U32> & U32) -> U32:
  (_, v) = r
  v

def main() -> IO(Unit):
  a = [0 : U32*8n]
  a[5] <- 42
  IO.print(U32.show(cell(a[5])))
```

## 9. Templates

```bend
import Base

def twice(~f: U32 -> U32, x: U32) -> U32:
  f(f(x))

def inc(x: U32) -> U32:
  (x + 1 : U32)

def plus2(x: U32) -> U32:
  twice(~inc, x)

def plus4(x: U32) -> U32:
  twice(~(y => (y + 2 : U32)), x)
```

- `~` parameters come first; call sites write `~arg`. Arguments must be closed (top-level defs, closed
  lambdas): `a template applied to closed ~ arguments (k is a variable here ...)`. For a capturing
  map, write an explicit recursive def that takes the captured value as a parameter.
- A template may be called many times (a closure only once). Each distinct `~` set compiles a copy.
- A def passed as `~f` must match the parameter quantities exactly (`@+x:U32 -> U32` is not `U32 -> U32`).

## 10. Parallel lets and `!`

- `a b = f(x) g(y)` forks both calls; both are checked in the outer scope, so their uses add up (`+x`
  if both read `x`). The left side is plain names; destructure on the next line. Non-call sides check
  (`a b = {1 : U32} {2 : U32}`) but there is nothing to fork: put the work in calls.
- The scheduler is a binary fork-join without work stealing: balance the halves.
- `f!(x)` runs a named def on the GPU (Metal); without a device it runs on the CPU pool. JS runs all of
  it sequentially. See guide 4.3-4.4 for wonky's measured rules.

## 11. Strict evaluation

`Bool.pick(-A: Type, c: Bool, a: A, b: A) -> A` is an ordinary def: both `a` and `b` are computed and
consumed. The same holds for `Bool.and`, `Bool.or`, `&&`, `||`. Use a match helper for any costly or
recursive arm (guide 4.1).

## 12. do-blocks and IO

```bend
# expect-run: n=5
import Base

def main() -> IO(Unit):
  do IO<Unit>:
    n : U32 = (2 + 3 : U32)
    IO.print("n=" ++ U32.show(n))
    return Unit{}
```

- Every bind and let in `do` is typed: `x : T <- m`, `x : T = v`. No destructuring inside `do`:
  destructure in a helper def. For compound result types prefer an explicit `IO.bind(...)`.
- `do M<..>:` works for any type with `bind`/`pure` (`Maybe`, `Result`).
- A foreign effect returns `IO(...)` directly: `def e(x: A) -> IO(B):` with `import "./e.c"` /
  `import "./e.js"` as the body.

## 13. Laws

- `law name: for x: T ... {lhs == rhs : T}`; proof `def name(x):` (same file) or `def Laws.name(x):`
  in `PROOF.bend`. Terms: `{==}`, `match`, recursive call = induction, `%e : P` rewrite (`_` marks the
  right side of `e`), `?goal`, `?TODO`. Guide section 10 has a checked example and the gate rules.
- A law without a proof cannot be used by live code: `a filled definition (an unfilled law is a dead claim ...)`.

## 14. CLI, runtime flags, error format

| command | effect |
|---|---|
| `bend f.bend --check-only` | check the file and its imports, run nothing; takes no other option |
| `bend f.bend` | check, then run `main` (IO main on JS; a value main is normalised by the checker) |
| `bend f.bend -o out.c` / `-o out.js` / `-o out` | C source, JS, native binary (clang) |
| `bend f.bend -- args` | run with `IO.args` |
| `bend base [--types\|Name]`, `bend guide [shaders\|effects]`, `bend version` | reference, version |

Native binary flags: `--threads N` (1-128), `--gpu on|off|<size>` (e.g. `1GB`, `8GB`), `--gpu-build`,
`--` ends runtime options. Wonky uses `--threads 1 --gpu off -- in out` for deterministic CPU runs.
Always set `BEND_NO_TELEMETRY=1`.

Runtime fail-stops print `bend: <msg>`: `out of memory: run again with a bigger span, as in --gpu 8GB`,
`a Nat past the largest immediate 2^48-1`, `memory fault (machine stack overflow?)`, `an array past the
deepest block class 31`. Emit-time errors print `Error: <msg>`: `an arity over 255`, `an id over 65535`,
`two names mangle to X`.

Checker errors print `Error:`, then `- expected` / `- observed` or `- message`, then `Context:` (typed
locals) and `Location: <def>` with the offending line marked `>|`. For parse errors `observed` is the
next character, not the mistake.

## 15. First-try checklist

1. `import Base` plus aliased relative imports at the top; qualify imported names (`R.Real`).
2. Types and helpers above their users; no mutual recursion.
3. No keywords as names; constructors prefixed and unique against Base; braces on every constructor.
4. Every arithmetic/comparison/bitwise/shift operator inside `( ... : T)`, spaced; `U32.is_eq`; shifts by `1n`; `F32.neg` for negatives.
5. Destructure/match parameters in order before any let; computed conditions go to a `.k` helper.
6. Binders used twice carry `+` (Data only); closures used twice become `~` templates.
7. Shrinking parameter (or `fuel: Nat`) first.
8. `Bool.pick` only for cheap arms.
9. Let-bound literals, lists, constructors annotated (`{v : T}` or `x : T = v`).
10. No constructor over 255 fields; `-o x.c` after widening records.
11. `bend <file> --check-only`, then `npm run -s check:bend`.
