---
name: wonky-bend
description: Use when writing, editing, debugging or optimizing Bend 2.0.25 code in wonky-kernel (kernel/**/*.bend, LAWS.bend, PROOF.bend, native-bridge, bakeoff and scratch .bend files). Holds the rules that prevent the compiler errors agents actually hit in this repo, the fast compile-fix loop, target order (JS, cpu1, cpuN, Metal), R.* reals, exact predicates, collections adapters, and where the pinned 2.0.25 differs from bend2-mega-skill.
---

# wonky-bend

Wonky pins Bend **2.0.25** (`bend.lock.json`, binary `.tools/bend-2.0.25/bin/bend`, source
`.tools/bend-source-2.0.25/bend2`; no `bend` on PATH, so `bend` below means that binary). This skill
holds wonky's rules and the 2.0.25 deltas. General Bend 2 lives in `~/.claude/skills/bend2-mega-skill` (written for 2.0.13/2.0.16; see
the delta table before trusting its details). Full reference with before/after code:
[docs/bend/guide.md](../../../docs/bend/guide.md). Cheat sheet: [docs/bend/syntax.md](../../../docs/bend/syntax.md).

Most frequent Bend error classes, in order: types, affinity, names/order, match rules (the most re-run), native/stack, syntax, laws, termination.

## Rules, most frequent first

**Types (137)**
1. Annotate every let-bound literal, list, constructor or lambda: `+h = {0.5 : F32}`,
   `xs = {[1, 2] : List<&2, U32>}`, `g : U32 -> U32 = y => (y + 1 : U32)`. (`an annotated term (cannot infer)`)
2. Every arithmetic, comparison, bitwise and shift operator group carries its type and spaces:
   `(a + b : U32)`. A bare `(a + b)` is an error in 2.0.25. Only `&&`, `||`, `++`, `<>` have fixed types
   and need no `: T`. The `: T` reaches nested parentheses but not call arguments:
   `(F32.abs((a - b : F32)) * c : F32)`. Shifts take a Nat: `(x >> 1n : U32)`. Equality is `U32.is_eq(a, b)`; xor is `.^.`;
   there is no `==`, `^`, `|>` or unary minus in terms.
3. `is Data` types hold only Data: no closures, `Array`, `IdVec`/`IdSet`, or `is Type` records. `+` only on Data.
4. When a type gains a constructor, grep every `match` on it (13 breaks came from `analytic.Solid`
   growing); use `case _:` for a shared fallback.
5. Quantities are exact: wonky lists are `List<&2, T>` (never `List<T>`); a def passed as `~f` must
   match the expected parameter quantities (`@+x:U32 -> U32` is not `U32 -> U32`).

**Affinity (125)**
6. A binder used twice on one path needs `+` where it is bound: `+acc`, `case 1n+ +p` (or `1n++p`),
   `case +h <> +t`, `R.Real{+hi, lo} = r`. Branches do not add up; the two calls of a parallel let do.
7. Closures are single-use and cannot take `+`: take a function used twice as a template `~f` whose
   argument is closed (a top-level def or a closed lambda).

**Names and order (113)**
8. Define before use: `f.k`/`f.go` helpers above `f` (46 hits), types above their users. No mutual
   recursion: one def with a selector argument, or return a `Step` value the caller acts on.
9. Prefix constructors with their type (`WDone{}`, `KCap{}`). Base owns `Done Fail Some None Nil Con
   True False LT EQ GT Tuple Unit WNil WCon Zero Succ`. A module that declares `Done{}` passes when
   imported (so `check:bend` is green) but fails as the entry (`bend kernel/x.bend --check-only`,
   `loadBend(kernel/x.bend)`).
10. Keywords are never names: `def type law match case do return for exs where is import Type Data Kind Quant`.
11. No field access `p.x` (it is looked up as a def): destructure `P{x, _} = p`. Aliases are not
    transitive (`P.R.Real` fails: import `real.bend` yourself); qualify imported constructors (`RP.Positive{}`).

**Match rules (94 unique, 236 raw)**
12. Every def is "destructure and match parameters in declaration order, then compute". No let before
    a match or destructure; never match a computed value or a let-bound local. Branch on a computed
    value through a helper whose parameter it is (`f.k(U32.is_eq(x, 0))`), and never destructure a
    call result (`(a, b) = f(x)`, `K{..} = f(x)`): pass it to a `.k`/`*_done` helper.
13. No `if`, no `match` inside a lambda, braces on every constructor (`True{}`), every field listed in
    a destructure (grep `Ctor{` when a record grows).

**Native, Metal, stack (34)**
14. Loops over data-sized lists are tail calls with an accumulator plus one `List.reverse`. Non-tail
    recursion overflows the JS stack early: Base `List.length` fails at 10k elements under `loadBend`
    and at 30k in `bend x.bend` (also `List.foldr`, `List.sort`); tail loops run 1M. Metal overflows too.
15. No constructor with more than 255 one-word fields: group scalars into sub-records. `--check-only`
    and JS never report it; only `bend x.bend -o x.c` does (`Error: an arity over 255`).
16. `Nat` is a 48-bit immediate at runtime: keep counters and ids in `U32`.

**Syntax (32), laws (27), termination (21)**
17. No negative literals: `F32.neg(1.0)`, `(0.0 - 1.0 : F32)`, `R.neg(R.from_f32(1.0))`.
18. Live code never calls a law without a proof. Only the exact last line `All terms check.` is
    green: `All terms check, but N defs rely on unsafe or foreign code` exits 0 and passes `npm test`.
    No `@unsafe`, no `?` holes. Nothing about F32 is provable.
19. The shrinking parameter goes first (list or Nat); arguments before it pass unchanged. Without a
    structural decrease, add a leading `fuel: Nat` whose `0n` case returns an explicit error value.

**Performance and numerics**
20. `Bool.pick`, `Bool.and`, `Bool.or`, `&&`, `||` evaluate both sides: only cheap, already computed
    arms. Anything recursive or costly goes through a match helper (JS 7.6 s vs 0.2 s, cpu1 4.9 s vs
    0.4 s; exponential walks).
21. Fork-join: balanced halves, fork near the top only, no shared `+` big data read by every lane.
    Metal: one flat numeric device call per stage (no lists, no Big ints), never the whole build;
    count `metalPasses >= 1` before claiming a GPU number.
22. `R.*` (F32x2, ~44 bits) is a filter type, never exact: exact signs go through
    `kernel/robust-predicates.bend`, whose `Decision` can be `Undefined` (handle it). Compare F32 across
    targets by bits, not `F32.show` text (JS and native print differently); Metal flushes subnormals.
23. Collections: `IdVec`/`IdSet` are `is Type`: thread the returned `(container, answer)` pair.
    Never edit `kernel/vendor/bend-collections/src/`; import only the adapters you use.

## Pre-flight (before you compile)

- [ ] `import Base` and aliased relative imports at the top; imported names qualified.
- [ ] Order: types, then helpers (`.k`, `.go`, `*_done`), then callers. No forward reference.
- [ ] Constructors prefixed, braced, unique against Base; no keyword names.
- [ ] Per def: destructures and matches of parameters, in order, before any let.
- [ ] Every binder read twice has `+` (Data only); functions used twice are `~` templates.
- [ ] First parameter of every recursive def shrinks (or is `fuel: Nat`).
- [ ] Every operator except `&& || ++ <>` in `( ... : T)`; every let-bound literal/constructor annotated.
- [ ] No `Bool.pick` around recursive or costly arms; data-sized loops are tail calls.
- [ ] New constructor on an existing type: every `match` updated. Record widened: plan `-o x.c`.

## Compile-fix loop (fastest feedback first)

1. `BEND_NO_TELEMETRY=1 .tools/bend-2.0.25/bin/bend <file> --check-only` (0.3-0.5 s). Fix the
   **first** error only and re-run. Parse errors show the next character as `observed`: read the
   `>|` line. Look names up with `.tools/bend-2.0.25/bin/bend base <Name>`.
2. `npm run -s check:bend` (`bend PROOF.bend`, 3.5 s): laws plus every file imported by `PROOF.bend`.
   Read the last line, not just the exit code.
3. JS reference for one def, without the loader cache:
   `WONKY_BEND_CACHE=0 node --input-type=module -e "import {loadBend} from './src/bend-loader.mjs'; const k = await loadBend('tmp/x.bend', {cache: false}); console.log(JSON.stringify(k.f(3, 4)))"`
4. Focused tests: `node scripts/test-lane.mjs files <x>.test.mjs`, or `npm run -s test:changed`
   (both fail-fast lanes are for development only).
5. Native, when records widen or native code changes: `bend x.bend -o out/x.c`; cpu1 run with
   `bend x.bend -o out/x && out/x --threads 1 --gpu off`.
6. Before handing off: `npm test` (AGENTS.md). STEP changes: `uv run scripts/validate-step.py <prefix> ...`.

Scratch files go under `tmp/`. Other agents edit `kernel/` concurrently: never park experiments there.

## Targets

- **JS reference first**: correctness and the differential oracle (sequential, 5-35x slower than native;
  never infer native or GPU speed from it).
- **cpu1 next**: `--threads 1 --gpu off`, deterministic; catches the 255-field limit, Nat and stack fail-stops.
- **cpuN and Metal only in integration/verify**: benchmarks and `targetsAgree` byte-for-byte checks. Fillets
  and Booleans run on the CPU pool with `--gpu off`. A `!` after host forks falls back to the CPU.

## 2.0.25 versus the mega skill (verified, guide section 13)

| mega skill says | 2.0.25 does |
|---|---|
| `bend --version` | unknown option: `bend version` |
| check via `scripts/bend-check.sh` (C emission, needs python3) | `bend f.bend --check-only` checks the file and its imports |
| an operator chain without `: T` is Nat's | error `a type for this operator` |
| `x : T = v` only inside `do` | typed lets work in any def body |
| verdict `with N unsafe annotation(s)` | `All terms check, but N defs rely on unsafe or foreign code:` + names |
| 2.0.16 counts template instances as unsafe | not counted (`List.map`, mega skeletons check clean) |
| unused template bodies are not typechecked | their type and affinity errors are reported |
| (wonky PROOF.bend comment) only reachable defs are checked | every def of every imported file is checked |

Unchanged: `1n++p`, `F32.show` C/JS difference, U32 literal patterns, `--checkup`, `bend guide shaders|effects`.

## Routing: read the mega skill for

| need | mega skill file |
|---|---|
| a Base signature | `bend base <Name>` first; then `references/BASE-API-INDEX.md` (generated from 2.0.16) |
| proof technique, rewrites, stuck goals | `references/PROOF-COOKBOOK.md`, `references/LAWS-AND-PROOFS.md` |
| which laws to state | `references/LAW-PATTERNS-CATALOG.md` (wonky: drafts in `kernel/laws/draft/`, LAWS.bend is Marc's) |
| scheduler, fork-join model, ownership costs | `references/PARALLELISM-AND-GPU.md`, `references/PERFORMANCE-PLAYBOOK.md` |
| reading emitted C, keeps and refcounts | `references/RUNTIME-BENDRT.md`, `references/COMPILER-INTERNALS.md` |
| Metal and Apple silicon details | `references/HARDWARE-PLAYBOOK.md` |
| producing a performance number | `references/MEASUREMENT-PROTOCOL.md` |
| IO, effects, custom C/JS effects | `references/IO-EFFECTS-AND-CONCURRENCY.md`, `references/CUSTOM-EFFECTS.md` |
| an error string not in our guide | `references/ERROR-TAXONOMY.md`, or `bash scripts/explain-error.sh` (not executable; no row for the 2.0.25 operator error) |
| dead/live wall, what a proof guarantees | `references/THEORY-BENDTT.md` |

Its scripts are not executable (`bash <script>`), pick the compiler from `BEND_CLI`, a checkout
argument or `bend` on PATH, and `bend-check`, `bench-speedup`, `ledger-row`, `validate` need Python 3:
prefer the commands above. `keep-audit` works here:
`BEND_CLI=$PWD/.tools/bend-2.0.25/bin/bend bash ~/.claude/skills/bend2-mega-skill/scripts/keep-audit.sh f.bend`.

## Reference files

- [docs/bend/guide.md](../../../docs/bend/guide.md): errors with before/after, idioms, performance,
  targets and native limits, testing lanes, `R.*`, predicates, collections, laws, loader, deltas.
- [docs/bend/syntax.md](../../../docs/bend/syntax.md): the syntax and semantics cheat sheet.
- `node docs/bend/check-snippets.mjs`: re-checks every `bend` block of both docs with the pinned
  compiler against its `# expect:` line (report in `tmp/bend-docs-check/results.txt`, or in
  `$BEND_DOCS_CHECK_OUT`). Run it after editing the docs or bumping the compiler.
