# Bend feasibility spike: a native core language for wonky

Date: 2026-09-22. Apple M5 Pro (18 logical CPUs, 64 GiB), macOS arm64, Node v22.23.1, Bend 2.0.25.
The machine was shared with three other workflows. The one-minute load average was **13 to 21** during every
measurement (recorded per group in the report). Every timing here is **indicative**. Correctness checks are
not indicative: they are exact.

Evidence: [`out/lang/spike/run-2/report.json`](../../out/lang/spike/run-2/report.json) (all runtime numbers below),
[`out/lang/spike/build/builds.json`](../../out/lang/spike/build/builds.json) (compile cost). `run-1` is an earlier
full run with the same results, except that its JS list evaluator still copied arrays.

## Answer in short

1. **Feasible.** A dynamic core language runs natively in Bend. It has a universal value type, closures,
   recursion, lists, maps, strings, errors as values, and fork-join `par`. The evaluator reads a serialized
   AST from a file or argv. It calls the real planar-Boolean kernel as builtins. It returns errors with
   source-span ids and a call trace. Size: about 2,100 lines of Bend in `kernel/lang/spike/`, plus about 360
   lines of host JS in `src/lang/` and the benchmark scripts.
2. **Kernel results are bit-identical.** "Box, second box, union, pocket" and the three build123d planar
   cases run end to end natively. Each result has the same B-rep hash, the same F32x2 volume words and the
   same face count as the direct kernel calls in the same binary. The hashes also equal the earlier native
   kernel-only benchmark. Volumes are 15500 / 18240 / 13840 mm³, faces 26 / 46 / 64.
3. **The evaluator is not where the time goes.** Native evaluation costs **27 to 35 ns per AST node**. A plain
   V8 tree-walker over the same AST costs **30 to 45 ns** per node. wonky's FeatureScript interpreter needs
   about **50 ns per step**. For the same computation that is 2.3x slower than native on `fib` and 0.86x
   (faster) on a loop. Evaluator overhead in a kernel program is below timer noise: frame-with-tab takes
   1494 ms through the language and 1508 ms as direct kernel calls.
4. **The end-to-end speedup is the kernel's, not the language's.**
   - frame-with-tab takes **1.49 s** natively with 1 thread and **0.93 s** with 4 threads.
   - Today's JS path (`buildPython`, warm, same load) takes **12.9 s**. That is 8.6x slower than 1 thread and
     13.8x slower than 4 threads.
   - The in-process N-API binding gets the same kind of factor (8.3 to 9.7x, docs/native-bridge/binding.md)
     and needs no new language.
5. **The one thing a native language adds is fork-join over independent features.** Take four independent
   pocket parts written with `par`: they run in 1246 / 638 / 327 ms with 1 / 2 / 4 threads. Written
   sequentially they take 773 ms with 4 threads, because only the kernel's internal fork helps there. The
   binding re-enters Bend serially, so a JS host cannot get this.
6. **Blockers for "the" language in Bend:**
   - Numbers are F32x2, not IEEE double. `0.1 + 0.2` evaluates to 0.2999999999999998, and `(= (+ 0.1 0.2) 0.3)`
     is true. FeatureScript's double semantics therefore cannot be reproduced bit-for-bit, and Bend has no
     F64 or I64.
   - Every evaluator change needs a full relink with the kernel: **27 s and 7 GiB compiler RSS**. There is no
     separate compilation and no library mode.
   - The Bend JS target is 5 to 35x slower than native. Its File IO needs Bun (`bun:ffi`), so it does not run
     under Node.
7. **Parsing FeatureScript in Bend works and is exact, but it does not pay off.** The native tokenizer
   reproduces `src/parser.mjs` token for token on r10b.fs and on a 1.1 MB file from Marc's corpus. It is 1.6x
   faster than V8 (9.3 vs 14.7 ms for r10b). It uses 26 to 72 MB, because a Bend String is a cons list of
   chars. Parse plus interpretation is at most 0.7 % of today's wall time (docs/native-bridge/profile.md).

**Implication for the language decision:** a Bend-native evaluator is technically sound. As a performance
play it adds nothing beyond the binding. Its unique value is whole-graph submission with fork-join and resident
bodies. That argues for a native core IR (a feature/dataflow graph of kernel operations with span ids) behind
the binding. FeatureScript and build123d semantics would stay in the host, where numbers are doubles. It does
not argue for a new human-facing language implemented in Bend. See [Implications](#implications) for the
reasoning.

## What was built

| File | Role |
|---|---|
| `kernel/lang/spike/core.bend` (650 lines, 51 defs) | `Expr`, `Value`, `Task`, the pure primitives, and the evaluator `step` (one def) |
| `kernel/lang/spike/frontend.bend` (492) | Integer-stream decoder, JSON result printer, file reading |
| `kernel/lang/spike/kernel-ops.bend` (281) | Kernel builtins `extrude`, `union`, `subtract`, `volume`, `faces` on the production kernel |
| `kernel/lang/spike/tokenize.bend` (497) | Native FeatureScript tokenizer and positional token hash |
| `kernel/lang/spike/main.bend` (186) | Native entrypoint: modes `eval`, `pure`, `eval-arg`, `pure-arg`, `tokenize`, `ref` |
| `kernel/lang/spike/main-pure.bend` (117) | Control build without kernel builtins (size and compile attribution) |
| `kernel/lang/spike/examples/*.core` | Benchmark, kernel and error programs, plus `prelude.core` (`box`) |
| `src/lang/spike-compile.mjs` | Host compiler: S-expression text to resolved core AST to integer stream; span table; `explainError` |
| `src/lang/spike-eval.mjs` | JS reference evaluator (same semantics, doubles). It is the correctness oracle and the node counter |
| `src/lang/token-summary.mjs` | The positional token hash, shared by the JS side and the test |
| `scripts/lang/spike-bench.mjs`, `scripts/lang/spike-js-worker.mjs` | Build (`--build`) and every measurement |
| `test/lang-spike.test.mjs` | 7 focused tests (encoding, scoping, spans, native vs reference vs kernel, tokens) |

Reproduce: `node scripts/lang/spike-bench.mjs --build`, then `node scripts/lang/spike-bench.mjs --out <name>`.
Run the tests with `node --test test/lang-spike.test.mjs`.

### Core language

The text form is a plain S-expression syntax, so the host compiler stays trivial. It is a test vehicle, not a
language proposal.

```lisp
(def box (x0 y0 z0 x1 y1 h)
  (extrude (list (list x0 y0) (list x1 y0) (list x1 y1) (list x0 y1)) z0 h))
(let a (box 0 0 0 40 30 10))
(let b (box 20 10 0 50 35 10))
(let u (union a b))
(let p (subtract u (box 5 5 4 30 25 10)))
(list (volume u) (volume p) (faces p) p)
```

- **Values** (`core.bend`):
  - `VNum` holds a `Real`, which is F32x2.
  - `VBool`, `VStr`, `VUnit`, `VList` and `VMap` (Base's string-keyed `Map`).
  - `VClo` holds arity, a recursive flag, body and environment.
  - `VBody` is the opaque kernel handle: an analytic solid plus the per-edge domain choices that the planar
    Boolean needs for chaining.
  - `VErr` holds code, span id, message and trace.
- **Forms:** `def` (recursive, visible to later forms only), top-level `let`, `fn`, `let` with bindings, `if`,
  `and`/`or`, `list`, and `par` (fork-join; both sides must be lists, which it concatenates). Application is
  `(f args..)`.
- **Standard set (27 opcodes):**
  - Arithmetic and comparison: `+ - * / < <= = not neg`, plus sugar `> >= !=`.
  - Lists: `cons head tail empty? len nth append`.
  - Maps and strings: `map-new map-set map-get map-has str++`.
  - `error`.
  - Kernel: `extrude union subtract volume faces`.
  - Higher-order functions (`map`, `fold`) are written in the language itself (`examples/lists.core`).
    Primitives never call closures, so they never re-enter the evaluator.
- **Kernel builtins** call exactly the production functions that `scripts/build123d-workload.bend` calls:
  `topology.extrude`, the F32 to F32x2 analytic lift of `face-classification`, `ports/planar-boolean`
  union/subtract with zero source budgets, and `ports/solid-intersection.planar_measures`. Unsupported input
  raises a capability error (code 6) with the call's span. This covers:
  - a clockwise or degenerate profile,
  - a coordinate that is not exactly representable as F32 (the kernel's extrude takes F32; nothing is rounded),
  - a Boolean with no or several result bodies,
  - `Unresolved` Boolean stages.

### Serialized AST encoding

The host compiler resolves names to de Bruijn indices. A closure body sees its last argument at index 0. A
recursive closure sees itself at index `arity`, just below its arguments. The file is decimal U32 tokens
separated by spaces:

```
node := 0 s m e s m e        number: hi word, then lo word; each word = (-1)^s * m * 2^(e-200), m < 2^24
      | 1 len c1..clen       string (code points)
      | 2 | 3 | 4            true | false | unit
      | 5 i                  variable (de Bruijn)
      | 6 arity body         lambda
      | 7 arity body         recursive lambda (self at index arity)
      | 8 span n f a1..an    application
      | 9 x body             let
      | 10 span c t e        if
      | 11 span op n a1..an  primitive (opcode table: PRIMS in spike-compile.mjs = op_of in frontend.bend)
      | 12 n e1..en          list literal
      | 13 a b               par (fork-join)
```

- Numbers travel as their exact F32x2 words, so the host decides rounding once and documents it: `splitReal`
  gives hi = fround(x) and lo = fround(x - hi).
- Span ids index a JSON side table with file, line, column, end and label.
- Decoding cost: 700,006 ints (2.24 MB of text) decode in **25 ms**, about 36 ns per int, including digit
  parsing. Peak RSS is 64.5 MB.
- Programs of this size travel on argv as well (`eval-arg`), which is how the Bend JS target is driven.

## Measurements

### 1. Evaluator overhead per node (pure programs, 1 thread)

| Program | Nodes | Native Bend | JS reference evaluator (V8) | wonky FS interpreter | Bend JS target |
|---|---:|---:|---:|---:|---:|
| `fib 25`, 3 runs | 7,283,550 | **199 ms, 27.3 ns/node** | 218 ms, 29.9 ns/node | 457 ms (3,034,808 steps/run, 50 ns/step), **2.3x native** | 360 ms per run, 148 ns/node, **5.4x native** |
| `sumsq 20000` (recursive), 10 runs | 3,000,120 | **101 ms, 33.7 ns/node** | 136 ms, 45 ns/node | 87 ms as a `for` loop (240,011 steps/run, 36 ns/step), **0.86x native** | 1188 ns/node, **35x** |
| `lists 5000` (range, map with a lambda, fold, map lookup), 10 runs | 2,200,520 | **77 ms, 35 ns/node** | 90 ms, 41 ns/node | (no FS equivalent without the std array builtins) | 1041 ns/node, **30x** |

How to read the table:

- One node is one evaluated AST expression, one `TEval` step. The count comes from the JS reference evaluator
  on the same AST. The FS interpreter reports its own statement and expression steps.
- The native process for `fib` peaks at **2.1 MB RSS**. Node runs take 56 to 106 MB.
- Correctness: all three native results equal the JS reference results and the FS interpreter's results
  exactly, compared as doubles reconstructed from the F32x2 words.
- **Result:** a native tree-walker in Bend runs at V8 tree-walker speed, not faster. The existing FS
  interpreter is within about 2x on call-heavy code and faster on loops. For the language layer alone,
  native evaluation brings no speed argument.

### 2. What the Bend rules cost the evaluator

- **No mutual recursion (eval / apply / eval-list / branch / let).**
  - `step(~kernel, fuel, task)` is the only recursive def. A `Task` constructor (`TDone`, `TEval`, `TList`)
    selects the role.
  - The non-recursive halves of apply (`apply_task`, including the arity check and binding a recursive
    closure to itself), branch (`branch_task`) and let (`bind_task`) *return the next Task* instead of
    calling `step`.
  - The same trick drives the AST decoder (`DTask`) and the tokenizer: "finish the pending token and re-read
    this char" is a call to the non-recursive transition function.
  - The price is one Task node per apply, branch or let. It is included in the 27 to 35 ns/node, which
    already matches V8. The design cost is acceptable.
- **Termination (fuel).** `fuel` bounds evaluation *depth*, not steps. Each nested `step` consumes one unit,
  and siblings share the rest as a `+` value. A `Nat` is a runtime immediate up to 2^48, so large fuel costs
  nothing to build.
  - Measured against a generated control build (same evaluator, fuel removed, `step` marked `@unsafe`):
    fib 196 vs 195 ms, sumsq 102 vs 100 ms, lists 93 vs 90 ms. That is **3 % or less, within noise**.
  - `@unsafe` is not free in another way: Bend then reports every caller as "relies on unsafe code", which
    taints the proof story.
  - Fuel exhaustion is an ordinary error value (code 5), never a hang. Deep object-language recursion is
    cheap natively: 1,000,000 nested non-tail calls take 523 ms and 18 MB RSS, because Bend has no machine
    stack for this.
  - The JS reference evaluator needs `--stack-size` for 20,000 levels and overflows at 5,000-element lists
    under the default stack.
- **No forward references.** Every file is ordered so that `Expr` comes before `Value`, then `Task`, then
  helpers, then `step`. Helpers precede their callers. This is easy to get wrong while editing: the JSON
  escaper failed to check with `expected: a defined name` until `escape_ctl` was moved above `escape_char`.
- **`match` only on parameters or pattern-bound fields.**
  - Every "match on a computed value" becomes a helper def. The result is 51 defs in 650 lines of `core.bend`,
    61 in the tokenizer and 33 in `kernel-ops.bend`.
  - A related trap: after a nested pattern like `a <> Nil{}`, the head binder cannot be scrutinized again. So
    every multi-argument primitive first destructures its argument list and passes the elements to a helper.
  - Errors are values. Every helper needs an explicit `case VErr{c, s, m, t}: VErr{c, s, m, t}` arm to
    propagate them, which is boilerplate an effect or exception would remove.
- **Affinity and templates.** Closures are affine. The kernel operations are therefore linked through a
  template parameter (`~kernel`), inlined at compile time. The pure-only build is simply another template
  argument (`~no_kernel`). A template argument's type must match exactly: a def with a `+s` parameter is
  rejected where `@_: A.Solid -> String` is expected. The fix is a wrapper def.
- **Base details:**
  - `Bool.show` prints `True`, so the printer has its own JSON booleans and string escaping.
  - `File.read` decodes UTF-8 into a cons-list `String`.

### 3. Kernel programs end to end (native, 1 thread)

Each program runs in its own process with 3 samples. "Direct kernel calls" is the `ref` mode of the same
binary: the same kernel calls with no evaluator in between.

| Program | Through the core language | Direct kernel calls | Check |
|---|---:|---:|---|
| planar-union | 166 ms (process 172 ms, 3.2 MB RSS) | 166 ms | hash 3056124424 equal, volume words equal (15500.000000000007), 26 faces |
| planar-pocket | 304 ms | 300 ms | hash 1451706507 equal, 18240.00000000002, 46 faces |
| frame-with-tab | **1494 ms** (process 1500 ms, 3.4 MB RSS) | 1508 ms | hash 3141504600 equal, 13840.000000000002, 64 faces |
| box, second box, union, pocket | 1976 ms | (no direct counterpart) | volumes 15500 and 12500 as expected, 90 faces, 0 kernel errors |

- The hashes are also the ones recorded by the earlier native kernel-only benchmark
  (`out/build123d-kernel/quick-1`).
- The volume the program returns through `volume` equals the evidence volume.
- Decode time is 0 ms for these ASTs (152 to 218 ints).

**Today's JS path for the same build123d files.** This is `buildPython` via `scripts/lang/spike-js-worker.mjs`
with 1 warmup and the reference venv's Python for the shim. It includes the Python shim process, RPC, host
validation and the Bend kernel on the JS target:

| Case | JS path median (samples) | Native core, 1 thread | Ratio | Native core, 4 threads | Ratio |
|---|---:|---:|---:|---:|---:|
| planar-union.py | 1631 ms (1646, 1622, 1631) | 166 ms | 9.8x | (not run) | |
| planar-pocket.py | 2738 ms (2738, 2706, 2866) | 304 ms | 9.0x | (not run) | |
| frame-with-tab.py | 12,881 ms (13,099, 12,664) | 1494 ms | **8.6x** | 930 ms | **13.8x** |

- Load average rose to 20 to 21 during the JS frame run. The principal build123d report measured 15,851 ms
  at load 12.
- The JS path's bodies have the same volumes and face counts (26, 46, 64).
- The two sides measure different boundaries: the JS numbers include the Python frontend and RPC, the native
  numbers include decoding the AST. These are end-to-end numbers for their respective pipelines, not a
  kernel-only ratio.
- Real build123d/OCCT builds frame-with-tab in 9.4 ms (docs/build123d-performance.md). The remaining 160x
  gap is kernel algorithm cost, which a language cannot change.

### 4. Threads

| Program | 1 thread | 2 threads | 4 threads |
|---|---:|---:|---:|
| frame-with-tab (one dependent chain) | 1502 ms | | 930 ms |
| four pockets, sequential `(list ...)` | 1339 ms | | 773 ms |
| four pockets, `(par (par ..) (par ..))` | 1246 ms | 638 ms | **327 ms** |

- The speedup for the dependent chain comes from the kernel's own fork in
  `ports/planar-boolean-selection.bend`, not from the evaluator.
- `par` adds evaluator-level fork-join on top: 3.8x at 4 threads, 2.4x better than the sequential form.
- Peak RSS stays at 5.6 MB with 4 threads.
- No runs above 4 threads were made, because the machine is shared.

### 5. Compile cost, binary size, startup, memory

| Build | Bend to C | clang -O3 | C source | Binary | Bend to JS | JS |
|---|---:|---:|---:|---:|---:|---:|
| `main.bend` (evaluator, tokenizer, kernel builtins) | 17.9 s, **7.07 GB peak RSS** | 8.9 s | 4.9 MB | **2.37 MB** | 4.1 s | 770 KB |
| `main-pure.bend` (the same without topology and Boolean code) | 5.8 s, 2.5 GB | 1.6 s | 1.18 MB | 1.34 MB | 2.8 s | 267 KB |

- Load average was 13 to 15. Bend's CLI build is exactly `clang -std=c11 -O3 f.c -lpthread -lm`; the
  separately timed clang step produces a byte-identical-sized binary.
- For comparison, the kernel-only workload binary is 2.25 MB.
- **The evaluator itself adds little. The linked kernel dominates.** Every change to the evaluator or its
  builtins costs the full 27 s. Bend has no separate compilation and no library mode (binding.md).
- Native process start: 4.7 ms wall, 2.0 MB RSS. The Bend JS target under Node starts in 30 ms with 45 MB.
- Native peak RSS for every kernel program is 3.2 to 3.7 MB with 1 thread. That is two orders of magnitude
  below the Node processes, which take 237 to 240 MB on the JS path.

### 6. Parsing in Bend: tokenizing FeatureScript

`tokenize.bend` is one structural recursion over the String. Each character goes through a non-recursive
transition function. It reproduces `src/parser.mjs` `tokenize` token for token, verified with a positional
hash over kind, line and column plus per-kind counts and total text length:

| File | Bytes | Tokens | Native per run | JS `tokenize` per run | JS `parse` per run | Identical |
|---|---:|---:|---:|---:|---:|---|
| fixtures/r10b/r10b.fs (read only, frozen) | 404,086 | 80,663 | **9.3 ms** (26.6 MB RSS) | 14.7 ms | 18.1 ms | yes |
| ~/Workspace/cad/…/lochwand/topo-native/source.fs (Marc's corpus, read only) | 1,103,733 | 289,264 | **27.6 ms** (72 MB RSS) | 43.4 ms | 62.2 ms | yes |
| fixtures/cadbench/adapted/cup.fs | 1,248 | 245 | 0.025 ms | 0.030 ms | 0.20 ms | yes |

- Native is about 1.6x faster than V8's regex tokenizer.
- The memory cost is the cons-list String: about 64 bytes per character.
- A parser on top is more of the same state-machine style. At r10b's 18 ms it is not worth moving: parsing
  plus interpretation is at most 0.7 % of wall time today.
- The Onshape std sources start with `FeatureScript ✨;`. The JS tokenizer rejects that character. The
  native one counts it as `bad` and would need the same explicit error.

### 7. Errors carry a span id back to the host

Errors are values with a code, the span id of the failing node, a message and the span ids of every enclosing
application (`with_trace`). `explainError` in `spike-compile.mjs` maps them back to source:

- **Type error:** `examples/error-type.core` has `(union base 5)` three calls deep. The error is code 2,
  "Boolean expects two bodies", at `union` line 7:17. The trace is `build` (9:9), then `tab` (8:16).
- **Capability error:** a clockwise profile gives code 6 at `extrude` 6:1, with a message that states the
  requirements.
- **Fuel:** code 5 after 5000 levels. The trace is valid but grows with depth (1250 entries). It needs a cap,
  such as the first and last N frames plus a count. The error also has no own span (0). The enclosing
  application should be the span. Both are recorded follow-ups, not fixed here.

### 8. Number semantics: F32x2 is not FeatureScript's double

| Core expression | Native (F32x2) | JS double (wonky's FS interpreter, Onshape) |
|---|---|---|
| `(+ 0.1 0.2)` | 0.2999999999999998 | 0.30000000000000004 |
| `(= (+ 0.1 0.2) 0.3)` | **true** | **false** |
| `(+ 281474976710656 1)` (2^48 + 1) | exact | exact |
| sum of i² for i < 10⁶ | 333332833335669760 | 333332833333127550 (exact: …333500000) |

`Real` carries about 48 significant bits, not 53, and rounds differently. The same FeatureScript source can
therefore take a different branch or loop count when its numbers are evaluated in Bend. Bend 2.0.25 has no F64
or I64 to emulate IEEE double cheaply. For translation layers this is a semantic issue, not a performance
issue.

## Implications

- **A native core IR/graph is feasible and cheap. Its value is structural, not speed.**
  - Build it as a small typed IR of kernel operations over handles (the `VBody` idea) with span ids, not as
    a general dynamic language.
  - Submitted as a whole, it gives two things the host-driven binding cannot: fork-join across independent
    features, and resident intermediate bodies with no host round-trips.
  - The evaluator loop, error-as-value with spans, and the decoder patterns here can be reused as they are.
- **Keep FeatureScript and build123d semantics in the host.** FS needs IEEE doubles, `try silent`,
  exceptions and a large std surface. A Bend-native FS interpreter would change numeric results (section 8)
  and cost a 27 s relink per change. The interpreter's own speed is not a bottleneck (section 1). The host
  lowers geometry calls into the IR and keeps span ids, which the spike shows round-trip to source.
- **Order:**
  1. Land the in-process binding first. It delivers the measured ~9x kernel speedup on its own.
  2. Introduce the IR/graph as the unit that crosses the binding (`par` for independent features, handles
     for residency).
  3. Consider a human- or LLM-facing surface syntax only afterwards, as a printer/parser for that IR on the
     host side, not as an interpreter in Bend.
- **Do not use the Bend JS target for a language runtime.** It is 5 to 35x slower than native, and its IO
  needs Bun.
- **Compile-time tax:** anything implemented in Bend that changes often, such as a language front end or std
  library, pays 18 s of Bend C emission plus 9 s of clang and up to 7 GB of compiler memory per iteration. It
  is better to keep that surface host-side and keep the Bend side small and stable.

## Limits of this spike

- The text syntax is an S-expression vehicle, not a language design.
- There are no mutual-recursive top-level defs (the same restriction as Bend itself), no tail calls and no
  proper string/number conversion builtins.
- The fuel error trace is uncapped.
- The JS reference evaluator uses doubles: pure results are compared only on programs whose values are exact
  in both representations.
- The FS comparison uses wonky's interpreter without its modeling builtins (`fib`, loop).
- The JS-path comparison includes the Python shim and RPC. The native side reads a pre-compiled AST. The
  host compile takes 0.1 to 1 ms and is recorded per program.
- All timings come from a shared machine with load 13 to 21. There are no runs above 4 threads and no Metal.
