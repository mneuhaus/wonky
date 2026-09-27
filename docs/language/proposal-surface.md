# Proposal (surface-language angle): WPy, a wonky dialect of Python, not a new language

Date: 2026-09-22. Role: language architect, angle "design the human- and LLM-facing wonky language itself".
Machine: Apple M5 Pro, 18 logical CPUs, shared with three other workflows. The one-minute load average was
**12.1 to 19.4** during every measurement below; it is recorded next to each number in the JSON reports. All
timings are indicative. Correctness checks (geometry revisions, hashes, volumes, op counts) are exact.

Evidence labels: **[M]** measured by me for this chapter (script and output named), **[O]** measured by another
stage (cited), **[D]** documented by the cited source, **[I]** my inference.

Inputs read: [prior-art.md](prior-art.md), [corpus.md](corpus.md), [semantic-core.md](semantic-core.md),
[bend-feasibility.md](bend-feasibility.md), [../native-bridge/profile.md](../native-bridge/profile.md),
[../native-bridge/binding.md](../native-bridge/binding.md), [../native-bridge/surface.md](../native-bridge/surface.md).
`docs/research/` held only source notes at the time of writing.

## 1. Answer in short

I set out to design "the wonky language" and to argue for it. The evidence pushed me to a narrower result.

1. **Do not invent new syntax.** The strongest objection holds: LLMs have no training data for a new syntax.
   The prior-art chapter shows the price of ignoring that. KCL needed a funded team and three breaking language
   versions. CADFS still had a 3x higher invalid rate than Python after 451k training programs. The design below
   therefore borrows everything an LLM already knows. The syntax is Python 3. The value semantics are CPython's.
   The geometry vocabulary is build123d's: **64 of the 70 names** in the prototype vocabulary are build123d
   names. The 6 others are four wonky extensions (`param`, `expect`, `frozen_import`, `offset_faces`) and two
   ocp_vscode no-ops. [M, `out/lang/surface/vocab.json`]
2. **What is new is semantics, not notation.** I call the result **WPy**. It is a hermetic, deterministic
   Python subset in the style of Starlark. Its build123d-compatible shapes are *lazy nodes* of a pure kernel
   graph, not eager OCCT objects. That one change brings six things neither FeatureScript nor build123d-on-CPython
   has together:
   - stable source-derived operation ids;
   - content hashes per node, so incremental rebuilds recompute only what changed;
   - geometric comprehension filters compiled to declarative in-kernel predicates;
   - total (empty-tolerant) Booleans;
   - mock execution ("preflight") that lists kernel gaps and host read-backs before any geometry runs;
   - automatic fork-join over independent parts.
3. **The prototype works end to end** (`src/lang/surface/`, about 3.2k lines of JS, 8 focused tests pass). [M]
   - The **unmodified** build123d `frame-with-tab.py` runs through WPy **without CPython**. Its geometry is
     bit-identical to today's `buildPython` path (same geometry revision `sha256:2bfde128…`, 13,840 mm³).
   - `bracket.py` produces the same geometry revision as `examples/bracket.fs`, and so does the FeatureScript
     that WPy emits from its graph.
   - Natively, WPy graphs run on the existing Bend spike binary without any Bend compile. frame-with-tab gives
     hash `3141504600`, the same as the spike and the kernel-only benchmark.
   - Four independent parts get fork-join with no `par` in the source: **317 ms on 4 threads against 783 ms**
     for the same lowering without it, and 1,255 ms on 1 thread.
4. **Real code, real limits.** Marc's unmodified 396-line `cad-project-035/project-component-d98e059b.py` (py-medium,
   corpus level 7) evaluates to a 274-node graph in 3.2 ms, warm.
   - All 34 selections become declarative predicates.
   - The graph's op counts equal build123d/OCCT's call counts exactly (Box 39, Rectangle 12, fillet 11,
     extrude 5, chamfer 4, …). The WPy evaluator therefore takes the same control flow as CPython on this file.
   - Wonky cannot *build* it: fillet, chamfer, offset, 2D Booleans, text and the selection engine are kernel
     gaps. The preflight names each gap at its source line.
5. **Coverage is the sobering part.** Over Marc's 91 unique build123d modeling files (82 families):
   - The WPy parser accepts 97.8 %.
   - Only **6 files (6.6 %) are WPy as-is**, meaning they evaluate to a graph without CPython.
   - **38 (41.8 %; 45.1 % of families) become reachable** with three changes: splitting the model from the
     build-script driver code (IO), the planned v1 features (project modules, builders, numpy-lite), and
     vocabulary work.
   - The rest are blocked by `cad_khana` (26), by other geometry kernels or libraries such as OCP and trimesh
     (16), or by classes and decorators (9). [M, `out/lang/surface/corpus.json`]
6. **FeatureScript does not translate into WPy source.** It translates into the shared core, as
   [semantic-core.md](semantic-core.md) showed. FeatureScript is a language that mutates a store:
   - `qAllModifiableSolidBodies` appears in 75 of 129 families;
   - `opDeleteBodies` in 116;
   - instantiator imports in 54. [M over `out/lang/corpus.json`]

   A mechanical source port would have to re-create that store in WPy. Hand translations are shorter and have
   fewer read-backs: guide-r2 goes from 7 static read-back sites to 0 sync points. They are still rewrites, not
   compilation. The reverse direction does work mechanically: the WPy graph to FeatureScript for Onshape.
7. **Speed comes from the kernel, not from the language.**
   - The WPy frontend costs 0.17 to 8.7 ms per file, warm.
   - The 8.3 to 8.7x from 12.9 to 13.4 s (`buildPython`, two runs) to 1.55 s on frame-with-tab is the native kernel. The in-process binding delivers it
     without any language [O].
   - WPy's own measured gains are narrower:
     - fork-join over independent parts, 2.5x at 4 threads in the pocket test;
     - early cutoff after an edit: 3 of 7 nodes recomputed, identical result;
     - no CPython process: 23 to 41 ms per build [O].

**Verdict.**
- **Now:** nothing ships in production. Keep the prototype. Use preflight as an experiment in LLM sessions.
- **Later:** after the native binding and the graph IR v0, build WPy as a *host-side frontend to the core
  graph*. It replaces the CPython tracer for the subset and Marc's hand-rolled Python-to-FS generators (Trace).
  Promote it as the preferred authoring language only if a measured LLM task study on Marc's parts shows at
  least parity with build123d-on-CPython.
- **Never:**
  - a new syntax;
  - a WPy or FeatureScript interpreter inside Bend;
  - a mechanical FeatureScript-to-WPy source port.

## 2. What was built

| File | Role |
|---|---|
| `src/lang/surface/parse.mjs` | Python 3 lexer and parser in JS: indentation, f-strings including PEP 701 nesting, comprehensions, decorators, classes, `with`, `try`. It builds a full AST with spans, so rejections can name the construct. |
| `src/lang/surface/check.mjs` | WPy subset checker: `reject`, `planned`, `tolerated` and `note` rules with a rewrite hint each |
| `src/lang/surface/values.mjs` | CPython value semantics: BigInt `int`, binary64 `float`, floor division and modulo, banker's `round`, `repr`/`str`/`format` spec, errors with spans |
| `src/lang/surface/eval.mjs` | Host evaluator. Python scoping (locals, closures, `nonlocal`), lists and dicts with aliasing, the build123d-compatible vocabulary, lazy measures, predicate lowering, stable ids |
| `src/lang/surface/graph.mjs` | `wonky-graph/0`: nodes with stable id, content hash and span; canonical text form; diff by id |
| `src/lang/surface/backend-js.mjs` | Reference backend on the Bend JS target. It uses the same kernel functions as `src/python.mjs` and `src/library.mjs`, with a node cache keyed by (hash, id). |
| `src/lang/surface/backend-native.mjs` | Lowers the graph to the spike's core AST with automatic `par`, and runs `out/lang/spike/build/main` |
| `src/lang/surface/emit-fs.mjs` | Graph to FeatureScript in SSA style, one `op*` per node, ids = stable node ids |
| `src/lang/surface/index.mjs` | `preflightWpy` (no kernel) and `buildWpy` (JS backend) |
| `src/lang/surface/py/wonky.py` | CPython shim: the wonky extensions for real build123d, for validation runs only |
| `scripts/lang/surface-check.mjs` | Equivalence, native, incremental, stable-id and error-message evidence, written to `out/lang/surface/report.json` |
| `scripts/lang/surface-corpus.mjs` | Corpus coverage, written to `out/lang/surface/corpus.json` (read-only on `~/Workspace/cad`) |
| `scripts/lang/surface-native.mjs`, `surface-frontend.mjs`, `surface-vocab.mjs` | Native timings, frontend cost, vocabulary overlap, written to `native.json`, `frontend.json`, `vocab.json` |
| `scripts/lang/surface-occt.py` | Runs WPy or build123d files on real build123d/OCCT (`uv run`), counts API calls, records outputs |
| `test/lang-surface.test.mjs` | 8 focused tests, all pass (`node --test test/lang-surface.test.mjs`, under 1 s) |
| `out/lang/surface/examples/` | `bracket.py`, `frame-with-tab.py` (byte-identical to the fixture), `pockets.py`, `inserts.py`, `guide-r2.py`, and the two emitted `.fs` files |

Parser fidelity: on all 257 unique build123d modeling and check files in the corpus that do not use `yield`, the
counts of 24 AST node kinds equal CPython's `ast` counts exactly (`tmp/lang/surface/cross-check.mjs`). [M]

```sh
node --test test/lang-surface.test.mjs            # 8 tests, < 1 s
node scripts/lang/surface-check.mjs               # ~1 min on the JS target; buildPython needs the reference venv
node scripts/lang/surface-native.mjs              # ~15 s, at most 4 threads
node scripts/lang/surface-corpus.mjs              # ~0.3 s over 91 corpus files
node scripts/lang/surface-frontend.mjs && node scripts/lang/surface-vocab.mjs
cd tmp/lang/surface/occt-cwd && uv run --no-project --offline --with build123d python ../../../../scripts/lang/surface-occt.py <files>
```

## 3. The design

### 3.1 Principles, each traced to evidence

| Principle | Why |
|---|---|
| Borrow syntax and value semantics wholesale from Python | LLMs write Python far more reliably than rarely seen CAD languages ([prior-art.md](prior-art.md) §4.3: CADFS 9 % vs 3 % invalid; Text2CAD-Bench 13 % vs 67 %). A hermetic Python subset is a proven pattern: Starlark / Bazel BUILD files [D]. |
| Borrow the geometry vocabulary from build123d | Marc's corpus has 0 CadQuery files and 129 build123d modeling files, 76.8 % of families in algebra mode ([corpus.md](corpus.md) §4). Every unmodified algebra-mode file inside the subset is WPy. |
| Borrow ids, queries-by-role, checks and versioning from FeatureScript | FeatureScript's robustness comes from hierarchical ids, queries, determinism and versioned semantics ([prior-art.md](prior-art.md) §3.2). CADFS: deterministic ids improved median chamfer distance from 124.87 to 97.82. |
| Geometry is a lazy, pure graph | 98 % of FS families and 89 % of build123d families need at most a lazy IR: predicates, measure arithmetic, map regions and failure combinators ([corpus.md](corpus.md) §2). A pure graph gives caching, fork-join and mock execution. |
| Keep the host round trip for the rest | Level-7 control flow (2.3 % of FS families, 6.1 % of build123d) stays ordinary Python. It costs a sync point, about 0.5 µs in-process ([binding.md](../native-bridge/binding.md)). |
| Never silent | AGENTS.md: capability errors are never caught. A caught kernel failure is a reported notice, not a suppression. |

### 3.2 Syntax: Python 3, checked

A WPy file is a Python 3 file that starts with `from wonky import *`. `from build123d import …` is accepted as an
alias, which is why unmodified build123d files qualify.

| In WPy v0 | Rejected with a hint | Planned (v1) |
|---|---|---|
| functions, defaults, keyword and star arguments, lambdas, closures, `nonlocal` | `class`, decorators, `global` | project modules (hash-pinned sibling `.py` files) |
| `if`/`elif`/`else`, `for`/`while` (step budget), `break`/`continue`, `try`/`except`/`else`/`finally` | imports other than `wonky`, `build123d`, `math`, `typing` | builder contexts (`with BuildPart()`) as an explicit accumulator |
| comprehensions (list, dict, set, generator), f-strings with format specs | `yield`, `async`, `eval`/`exec`/`open`/`getattr`, dunder attributes | a numpy-lite vector module |
| lists, dicts, tuples, sets with CPython semantics (mutable, aliasing) | `numpy`, `OCP`, `trimesh`, `cad_khana`, IO outside the main block | role-based topology references (§3.5) |
| `assert`, `raise`, `print` (logged) | | |
| `if __name__ == "__main__":` runs; its `export_*` calls become named outputs and file IO is inert | | |

### 3.3 Values

- **Numbers.** `int` is arbitrary precision and `float` is IEEE binary64, with CPython's floor division,
  modulo, `round` (half-even) and `repr`. Examples: `1e16` prints as `1e+16` and `3.0` as `3.0`. Tests pin
  these rules. Kernel inputs are split to F32/F32x2 at the boundary exactly as today (`src/real.mjs`). When a
  backend cannot take a value exactly, that is a capability error; see the native backend's F32-exact check in
  §6. [M]
- **Collections** keep Python's aliasing (`b = a; b.append(1)` changes `a`) and insertion-ordered dicts. WPy does
  not "improve" Python semantics. The same file must mean the same thing under CPython, because the OCCT
  validation run uses CPython (§3.10).
- **Geometry values** are immutable node references:
  - `Part` / `Solid`, `Sketch`, `Curve`, `ShapeList` (a lazy selection);
  - lazy numbers (`part.volume`), lazy vectors (`bounding_box().min`);
  - `Location`, `Plane` and `Vector` are plain host values.
- **Units.** Numbers are millimetres and degrees, as in build123d. Explicit constants (`inch`, `cm`) can be
  added as plain factors. There is no dimension checking. KCL's history shows why: "no checking" produced
  silent errors, but "perfect tracking" was declared a non-goal ([prior-art.md](prior-art.md) §3.1). For WPy,
  CPython compatibility forces plain floats. FeatureScript keeps its dimension checks in its own frontend.

### 3.4 Geometry: lazy graph, build123d algebra

`a + b`, `a - b`, `a & b`, `Pos(...) * Rot(...) * shape` and `extrude(Plane.XY * Polygon(...), h)` do not
compute anything. Each creates one node of `wonky-graph/0`:

```
; wonky-graph/0 frame-with-tab.py
%0 = box({"align":["MIN","MIN","MIN"],"size":[50,40,10]})  ; id=stock/box at=3:9 h=dbe720cc2211f204
%1 = box({"align":["MIN","MIN","MIN"],"size":[34,24,12]})  ; id=opening/box at=4:27 h=a94901fb6f7ccbc4
%2 = move({"offset":[8,8,-1],"rows":[[1,0,0],[0,1,0],[0,0,1]]}, %1)  ; id=opening/move at=4:11 h=90a5dca04224580c
%3 = subtract(%0, %2)  ; id=frame/subtract at=5:9 h=63f4778a062d010c
%4 = box({"align":["MIN","MIN","MIN"],"size":[12,20,10]})  ; id=tab/box at=6:24 h=9c2ebccc7c28b895
%5 = move({"offset":[48,10,0],"rows":[[1,0,0],[0,1,0],[0,0,1]]}, %4)  ; id=tab/move at=6:7 h=36b970cb44a4e64e
%6 = union(%3, %5)  ; id=result/union at=7:10 h=2f0224a9b14ae18e
output "result" = %6
```

That text is the canonical form: one line per node, with parameters as stable JSON, the stable id, the span
and the content hash. It serves golden tests, `wonky diff`, reproducible bug reports and LLM inspection.

- **Total Booleans.** `Part() + x == x` and `x - Part() == x`. The corpus wraps `opBoolean` in emptiness guards
  (the `cp`/`combine`/`keepMain` helpers, 25 to 38 families) only because Onshape throws on empty inputs.
- **Placement** composes `Location`s on the host. `Plane * sketch` records a frame. The kernel lifts the profile
  (`geometry.frame`/`lift_points`), so no geometry is computed in JS.
- **Kernel gaps are nodes, not errors, until something needs them.** `fillet`, `offset`, `loft`, `Text`,
  `mirror` and the other not-yet-implemented operations create ordinary nodes. The preflight lists them, and a
  backend raises a capability error at the node's span only if it has to evaluate one.

### 3.5 Stable ids, queries and topology naming

**Operation ids** follow the pattern `<caller binding>/<function>/…/<binding>[loop indices]/<op>[#n]`:

| Source | Node ids |
|---|---|
| `stock = Box(...)` at module level | `stock/box` |
| `for x in SLOT_XS: for y in SLOT_YS: tray -= Pos(x, y, z) * Box(...)` | `tray[0,1]/box`, `tray[0,1]/move`, `tray[0,1]/subtract` |
| `result = [pocket(dx) for dx in (0, 100, 200, 300)]` | `result[2]/pocket/cavity/box` |
| `shell, tray, fence = build_shell(), build_tray(), build_fence()` | `shell/build_shell/…`, `tray/build_tray/…` |

Measured stability [M, `report.json` `stableIds`]:
- Inserting an unrelated `washer = …` before `stock` in frame-with-tab leaves all 7 WPy node ids and hashes
  unchanged and adds 2 nodes.
- The Python frontend's session-serial ids (`python/N`, `src/python.mjs`) rename all 7 operations.

[topology-identity.md](../topology-identity.md) requires exactly this: "Frontends must supply stable operation
IDs". WPy passes them as `identityContext.operationId` together with the source span (`backend-js.mjs`).

Two honest limits:
- Rebinding the same name gives positional suffixes: `guide = relieve_envelope(...)` twice yields
  `guide/relieve_envelope/…` and `…#2`. The rule for authors and LLMs is: bind distinct steps to distinct names
  (`guide_seat`, `guide_chute`). FeatureScript authors do the same with `id + "seatClearance"`.
- Renaming a variable renames its nodes. That is visible in `wonky diff` and intended.

**Queries.** WPy has two reference kinds, following [prior-art.md](prior-art.md) §6.2:

1. **Geometric selections**, the build123d way: `.edges().filter_by(Axis.Y)`, `group_by(Axis.Z)[-1]`,
   `sort_by(SortBy.VOLUME)[-1]`, and comprehension filters such as
   `[e for e in s.edges() if abs(e.center().X) < 3]`.
   - If the filter is built from centres, bounding-box windows, normal·axis tests, lengths or types, compared
     against host numbers, the evaluator runs it *symbolically* and emits a `select` node with the predicate as
     data. That includes helper functions called in the filter. Constants are folded:
     `abs(abs(center.y) - 76.5) < 0.6`.
   - Anything else becomes an opaque selection and a reported sync point.
   - These selections are revision-local by definition: they are re-evaluated on every build.
2. **Role references** (designed, not implemented in v0). The kernel already derives semantic roles: box
   x-min/x-max/start/end, frustum caps and rims, extrusion start/end caps ([topology-identity.md](../topology-identity.md)).
   WPy exposes them as `ext.face(END)` and `box.face(X_MAX)`. They carry the `(operation id, role, kind)` triple
   that CADFS and SolveSpace converge on, and they survive parameter edits.

Measured lowering [M]:
- In the 6 corpus files that evaluate as-is, **34 of 36** comprehension and lambda filters lower to declarative
  predicates. The 2 opaque ones are in `cad-project-033/case.py`. The corpus stage's independent classifier found
  156 of 170 declarative predicates ([corpus.md](corpus.md)).
- project-component-d98e059b: all 34 selection nodes are declarative: 11 comprehension filters plus 23 `filter_by`, `group_by`,
  pick and union nodes.
- guide-r2.py: 8 of 8, including the FeatureScript level-6 pattern "plane faces whose normal satisfies two dot
  tests and whose bounding box lies in a y-window".

### 3.6 Measures, checks and sync points

- `part.volume`, `len(part.solids())` and `part.bounding_box().max.Y` are lazy.
- Arithmetic and comparisons on lazy values build `arith` nodes. `expect(cond, message)` or an `assert` on a
  lazy condition becomes a `check` node. Checks are evaluated after the build and reported; they never block
  construction.
- A **sync point** happens only when Python control flow needs a kernel value:
  - `if selection:` (emptiness guard);
  - a loop over entities;
  - `f"{part.volume:.1f}"`;
  - an opaque predicate.

  With a backend, the needed cone is evaluated synchronously. In preflight, the sync point is recorded with its
  span and an explicit assumption: the guard is true, the loop has zero entities. [M]

| File | Nodes | Sync points | Kind |
|---|---:|---:|---|
| frame-with-tab.py, bracket.py, pockets.py | 7 / 8 / 20 | 0 | |
| guide-r2.py (from guide-r2.fs, 7 static read-back sites) | 106 | 0 | the evaluateQuery loops became selections and a list subtraction |
| project-component-d98e059b.py (unmodified) | 274 | 12 | 9 emptiness guards on selections, 3 volume prints |

Emptiness guards before `fillet` would vanish if fillet on an empty selection were defined as identity, the same
totality rule as for Booleans. That is a kernel-operation decision, not syntax.

### 3.7 Failures and errors

| Class | Raised by | Catchable by `except` | Shown as |
|---|---|---|---|
| syntax | parser | no | `part.py:2:21: syntax error: expected ), found "5"` plus the source line and a caret |
| capability | subset checker, vocabulary, kernel gap, backend limit | **never** (AGENTS.md) | `part.py:1:1: capability error: import numpy is not part of WPy v0` plus a hint |
| model | Python errors (`TypeError`, `NameError`, …), `raise`, kernel failures (`KernelError`) | yes | span, message, call trace |
| resource | step budget, call depth | no | span |
| check | `expect` / lazy `assert` false after the build | no (reported) | span, message, node id |

Messages measured on six typical mistakes are in `report.json` `errors` [M]. This one has a trace:

```
part.py:3:12: model error: expected a number, got str
     3 |     return Box(w, 10, 4)
       |            ^
    in lug called at 5:21
    in bracket called at 6:10
```

**`try`/`except` around kernel work.** Kernel work is lazy, so a fillet failure would otherwise surface after the
`try` block had ended. WPy therefore specifies the timing:
- With a backend, the evaluator evaluates the nodes the `try` body created *before leaving the block*. That is
  Python semantics.
- In preflight, the block is recorded as a failure-combinator site (`orElse`), 12 of them in project-component-d98e059b.
- Every caught failure is appended to the build report's notices, including `except Exception: pass`.

project-component-d98e059b.py has 11 `except Exception:` clauses, and 10 of them are a bare `pass`. Under CPython they hide
fillet and chamfer failures silently today. At run time they give 12 failure sites (the `go` helper runs three
times): 11 keep the previous value and 1 takes a fallback branch. WPy keeps the syntax and removes the silence.

### 3.8 Determinism

- There are no clocks, randomness, environment or file system. Imports are allow-listed, and the evaluator
  enforces this, not only the checker.
- Evaluation order is Python's. Dict order is insertion order. Ties in selections are broken by kernel entity
  order (to be specified with the selection engine).
- Transcendental functions come from V8's fdlibm port, which is deterministic for wonky across platforms. They
  can differ from CPython's libm in the last ulp. This matters only when validation compares bits instead of
  using a tolerance. [D/I]
- Rotations by multiples of 90° are exact: `Rot(0, 0, 180)` is exactly `diag(-1, -1, 1)`. The prototype
  initially produced `1.2e-16` noise here, and the transcendental path would feed that noise into F32 kernel
  inputs.

### 3.9 Parameters and outputs

- Module-level constants assigned from a literal or from `param(default, min=, max=)` can be overridden
  (`--param WALL=5`). Overriding a computed value is a capability error, so no silent re-derivation happens. The
  "parameters on top" style is the normalization Arko-T and CADFS used ([prior-art.md](prior-art.md) §4).
- Outputs are `result` (a part, a list or a dict of parts) or the main block's `export_stl` / `export_step`
  calls, which become named outputs. WPy never writes files; `wonky build` does.

### 3.10 Standard library and the CPython shim

- **Value layer:** Python builtins (`len`, `range`, `sorted`, `zip`, `enumerate`, `min`/`max` with `key`,
  `round`, …), `str`/`list`/`dict` methods, `math`. This matters more than it looks.
  - [corpus.md](corpus.md) §5 found the construct curves "flat": the long tail is value-level builtins.
  - wonky's FeatureScript frontend stops at **line 9 of inserts.fs** on `'atan2' is not defined or not
    implemented by this prototype` [M].
  - WPy inherits a specified, LLM-known library instead of re-implementing Onshape's std value functions one by
    one.
- **Geometry layer:** 64 build123d names plus 4 wonky extensions. Every WPy file also runs under CPython with
  `src/lang/surface/py/wonky.py`, which defines `param`, `expect`, `KernelError = Exception` and
  `frozen_import` on top of real build123d.
- **Validation runs** (never production geometry, per AGENTS.md) use `scripts/lang/surface-occt.py` [M]:

  | File | OCCT result |
  |---|---|
  | bracket.py | 8,832.0 mm³ |
  | frame-with-tab.py | 13,839.999999999998 mm³ |
  | pockets.py | 4 × 18,240 mm³ |
  | inserts.py | 2 × 142,929.7 mm³, valid, mirrored |
  | project-component-d98e059b.py | shell 422,619.4 / tray 160,099.8 / fence 20,092.1 mm³ |

  All run under `uv run`, at load 13.1 to 16.7.

## 4. Examples: originals and WPy

### 4.1 `examples/bracket.fs` (FeatureScript, 34 lines, 245 tokens) → WPy (6 lines, 91 tokens)

The FeatureScript original is `examples/bracket.fs`: a `defineFeature` wrapper, a `precondition` with
`isLength`, `newSketchOnPlane`, `skPolyline` with seven `vector(...) * millimeter` points, `skSolve`, and
`opExtrude` with `qSketchRegion`.

```python
"""L-bracket of examples/bracket.fs in WPy: outline 50 x 40 mm, extruded 8 mm."""
from wonky import *

THICKNESS = param(8.0, min=0.1)  # mm; the FeatureScript feature's "thickness"

outline = Polygon((0, 0), (50, 0), (50, 12), (18, 12), (18, 40), (0, 40), align=None)
bracket = extrude(Plane.XY * outline, THICKNESS)

expect(abs(bracket.volume - 8832) < 1e-6, "bracket volume is 8832 mm^3")
result = bracket
```

- Graph: 8 nodes. The `expect` becomes `volume → arith(−) → arith(abs) → arith(<) → check`, with 0 sync points.
- On the JS target the result has the **same geometry revision as `examples/bracket.fs`**, `sha256:8d87c2ae…`,
  8,832 mm³, 8 faces.
- WPy emits FeatureScript from the graph (`out/lang/surface/examples/bracket.emitted.fs`: newSketchOnPlane,
  skPolyline, skSolve, opExtrude, setProperty). Wonky's FS frontend builds it to the **same revision again**.
  [M, `report.json` `equivalence[0]`]
- Natively, the same graph gives 8,832 mm³ and 8 faces with hash 874548491, in a 4.6 ms process.
- Token counts: FeatureScript 245, build123d 59, WPy 91 (with the `param` bounds and the `expect`), and the
  emitted FeatureScript 249. [M, `vocab.json`] The extra WPy tokens buy a checked volume and a declared
  parameter, not ceremony.

### 4.2 build123d frame-with-tab: WPy is the original, byte for byte

```python
from build123d import Align, Box, Pos

stock = Box(50, 40, 10, align=Align.MIN)
opening = Pos(8, 8, -1) * Box(34, 24, 12, align=Align.MIN)
frame = stock - opening
tab = Pos(48, 10, 0) * Box(12, 20, 10, align=Align.MIN)
result = frame + tab
```

`fixtures/lang/surface/frame-with-tab.py` is `cmp`-identical to `fixtures/performance-build123d/cases/frame-with-tab.py`.

| Path | Result | Time (load) |
|---|---|---|
| today: `buildPython` (CPython + shim + RPC + Bend JS target) | `sha256:2bfde128…`, 13,840.000000000002 mm³, 64 faces, 7 requests | 13,427 ms (15.6); an earlier run 12,901 ms (13.3) |
| WPy, JS backend (no CPython) | **same revision** | 12,990 ms, of which host 1.06 ms (15.4) |
| WPy → emitted FS → wonky FS frontend | **same revision** | 13,062 ms |
| WPy → spike core AST → native, 1 thread | hash **3141504600**, volume words `1180188672/739621607`, 64 faces | 1,547 ms median (15.8) |
| same, 4 threads | same | 992 ms (15.5) |
| real build123d/OCCT (validation) | 13,839.999999999998 mm³, 14 faces (OCCT merges coplanar faces) | 9 ms |

Native lowering, generated from the graph (translations folded into the primitives, Booleans let-bound):

```lisp
(let ((b3 (subtract (box 0 0 0 50 40 10) (box 8 8 -1 42 32 12)))
      (b6 (union b3 (box 48 10 0 60 30 10))))
  (list (list (volume b6) (faces b6) b6)))
```

### 4.3 fs-simple: `hopper-corner-inserts-r1/inserts.fs` (55 lines) → `inserts.py`

Original, core of the feature:

```javascript
for(var x in [-120,-95,-72,-51,-44,-36.5]){
  var n=x<=-51?0.3:0.3-(x+51)/14.5*12.3;
  var r=18+0.55*(-x-36.5);var sid=id+("section"~x);
  sections=append(sections,fillSection(context,sid,x,r,n));sketches=append(sketches,qCreatedBy(sid,EntityType.BODY));
}
opLoft(context,id+"loft",{"profileSubqueries":sections});var left=qCreatedBy(id+"loft",EntityType.BODY);
opDeleteBodies(context,id+"sketches",{"entities":qUnion(sketches)});
var n=normalize(vector(-0.6932337712483952,-0.6241555926213797,-0.360356399416164));
trimOutside(context,id+"side",left,n,vector(-51,0,0)-n*0.3);
...
opPattern(context,id+"mirror",{"entities":left,"transforms":[mirrorAcross(plane(vector(0,0,0)*millimeter,vector(1,0,0)))],"instanceNames":["right"]});
```

WPy (full file `fixtures/lang/surface/inserts.py`, 54 lines including docstrings):

```python
def fill_section(x, r, floor_n):
    """Chute cross-section in the YZ plane at `x` (lines + one arc)."""
    ...                                   # the same arithmetic, math.atan2/cos/sin in radians
    outline = Line(o, b) + Line(b, f) + ThreePointArc(f, mid, t) + Line(t, o)
    return Plane(origin=(x, 0, 0), x_dir=(0, 1, 0), z_dir=(1, 0, 0)) * make_face(outline)

sections = []
for x in SECTIONS_X:
    floor_n = 0.3 if x <= -51 else 0.3 - (x + 51) / 14.5 * 12.3
    r = 18 + 0.55 * (-x - 36.5)
    sections.append(fill_section(x, r, floor_n))

left = loft(sections)
left = trim_outside(left, TRIM_NORMAL, Vector(-51, 0, 0) - TRIM_NORMAL * 0.3)
seat_cut = extrude(Plane.XY.offset(0.3) * (Pos(-300, -100) * Rectangle(249, 400, align=Align.MIN)), -100)
left = left - seat_cut
right = mirror(left, about=Plane.YZ)
left.label = "P01 Hopper rounded corner L R1 - glue in"
right.label = "P02 Hopper rounded corner R R1 - glue in"
left.color = right.color = Color(0.28, 0.64, 0.53)
result = [POSE * left, POSE * right]
```

What changed in translation:
- The sketch-body bookkeeping disappears: `opDeleteBodies` of the section sketches, `qCreatedBy` per section.
- `id + ("section" ~ x)` becomes the loop-indexed ids `sections[3]/fill_section/…`.
- The `transform(matrix, translation)` pose becomes `Location(t, (60, 0, 0))`.

Results [M]:
- WPy preflight: 67 nodes, 0 sync points, 1.4 ms warm. Kernel gaps: `line`/`wire`/`three_point_arc`/`make_face`
  (6 profiles), `loft`, `mirror`. wonky today only lofts two coaxial circles.
- OCCT validation of the WPy file: two valid mirrored solids of 142,929.7 mm³.
- The original FeatureScript is not validated against Onshape here. The translation is a hand rewrite, not a
  compiler output.

### 4.4 fs-medium: `funnel-holder-r2/guide-r2.fs` (111 lines) → `guide-r2.py` (55 lines)

The FeatureScript original selects the chute-seat faces with an `evaluateQuery` loop (a level-6 map in the
corpus ladder):

```javascript
for (var face in evaluateQuery(context, qGeometry(qOwnedByBody(guide, EntityType.FACE), GeometryType.PLANE)))
{
    var p = evPlane(context, { "face" : face });
    var bb = evBox3d(context, { "topology" : face, "tight" : true });
    if (abs(dot(p.normal, RAIL_AXIS)) < 0.001 && abs(abs(p.normal[1]) - sqrt(0.5)) < 0.001 &&
        bb.minCorner[1] >= -65.001 * millimeter && bb.maxCorner[1] <= -59.999 * millimeter)
        faces = append(faces, face);
}
if (size(faces) < 2 || size(faces) > 4) throw regenError("Expected symmetric chute seat ramps, found " ~ size(faces) ...);
opOffsetFace(context, id, { "moveFaces" : qUnion(faces), "offsetDistance" : -FIT.seat * millimeter });
```

It also cuts every envelope body in a loop: `for (var body in evaluateQuery(...)) cutters = append(...,
makeRobustQuery(...)); for (i ...) opBoolean(...)`. It wraps the whole feature in
`try { ... } catch (error) { throw regenError(stage ~ ": " ~ error); }` with a mutable `stage` string.

WPy:

```python
def relieve_chute_seat(guide):
    seat = [f for f in guide.faces().filter_by(GeomType.PLANE)
            if abs(f.normal_at().dot(RAIL_AXIS)) < 0.001
            and abs(abs(f.normal_at().Y) - sqrt(0.5)) < 0.001
            and f.bounding_box().min.Y >= -65.001 and f.bounding_box().max.Y <= -59.999]
    expect(2 <= len(seat) <= 4, "symmetric chute seat ramps")
    return offset_faces(guide, seat, -FIT["seat"])

def relieve_envelope(guide, tool, clearance):
    shifts = [Pos((RAIL_AXIS * x + Vector(0, y, 0) + WIDTH_AXIS * z) * clearance)
              for x in (-1, 1) for y in (-1, 1) for z in (-1, 1)]
    tools = [tool] + [s * tool for s in shifts]
    tools += [mirror(t, about=WIDTH_MIRROR) for t in tools]
    return guide - tools

guides = frozen_import("651610df74efbe36ad793aa1", version="a097c1094ad5072c3034ddc9")
left = [b for b in guides.solids() if b.bounding_box().max.Y < 0]
expect(len(left) == 1, "one left source guide")
guide = left[0]
guide = guide & mirror(guide, about=WIDTH_MIRROR)  # matching bevel on both guide ends
```

Results [M]:
- 106 nodes, **8 of 8 selections declarative** (the face predicate above becomes one `select` node with
  `dot(normal, [0.866, 0, -0.5])`, `bbox.min.y` and `bbox.max.y` terms), **0 sync points**, 3 checks, 1.2 ms
  warm.
- The FeatureScript original has 7 static read-back sites (`corpus.json` test case fs-medium).
- The `stage` bookkeeping is unnecessary: an error in the second envelope already names
  `guide/relieve_envelope#2/…` and carries the call trace.
- Kernel gaps: `frozen_import` (3), `mirror` (19), the selection engine, `offset_faces`, `text`.

Not executable anywhere offline: the three Part Studios are Onshape documents. The skText box-fit layout was
approximated by `Text(..., font_size=2.4)`. That is a stated deviation, not a silent one.

### 4.5 py-medium: `cad-project-035/project-component-d98e059b.py` (396 lines): WPy as-is

No edit was needed. The file keeps its IO inside `if __name__ == "__main__":`, uses only algebra mode, and
closes over `tray` with `nonlocal`. [M, `corpus.json`, `frontend.json`, OCCT run]

| Measure | Value |
|---|---|
| parse + evaluate (warm) | 1.03 ms + 2.12 ms |
| graph | 274 nodes, 3 outputs (`shell/build_shell/shell/fillet`, `tray/build_tray/_soften_tray/go#3/tray/chamfer`, `fence/build_fence/fence/chamfer`) |
| selections | 34, all declarative (11 comprehension filters, 12 `filter_by`, 5 `group_by`, 5 group picks, 1 union of selections) |
| sync points | 12 (9 `if roots:` emptiness guards, 3 volume prints) |
| failure sites | 12 executed `try` blocks around fillet/chamfer/engraving: 11 `except Exception: pass`, 1 per-edge fallback; each caught failure is reported, not silent |
| kernel gaps | fillet 11, chamfer 4, offset 2, 2D sketch Booleans 16, text 1, selection engine |
| **op counts vs real build123d** | Box 39, Circle 4, Cylinder 2, Polygon 4, Rectangle 12, Text 1, extrude 5, fillet 11, chamfer 4, offset 2: **identical** in the WPy graph and in the instrumented OCCT run |

The control-flow equivalence is the relevant evidence for "WPy is Python": the same loops, guards, helper calls
and fallbacks ran. The level-7 fallback loop `for x in list(vert): try: fillet([x], R_BIG)` only runs when a
batch fillet fails. It did not fail in OCCT and was assumed not to fail in preflight. In a wonky build it becomes
a sequence of sync points.

## 5. How FeatureScript and build123d translate

### 5.1 build123d: identity on the subset, measured coverage

"Translation" is the identity for files inside the subset. Everything else needs edits of known kinds. Over
91 unique files and 82 families, each file is counted under its hardest blocker [M, `corpus.json`, 0.34 s for
all files, load 17.2]:

| Hardest blocker | unique | families | What it would take |
|---|---:|---:|---|
| WPy as-is: graph built without CPython | 6 | 6 | nothing |
| WPy v0 vocabulary gap (`Vertex`, index of an imported STEP) | 2 | 2 | vocabulary (cheap) |
| planned WPy v1 only: project modules, builders, numpy | 7 | 7 | v1 features |
| driver IO outside the main block: pathlib, json, hashlib, argparse, … | 23 | 22 | split the build script: model file (WPy) plus driver (wonky CLI or Python) |
| Python classes, dataclasses, decorators, `global` | 9 | 8 | rewrite to functions and dicts |
| `cad_khana` diagnostics wrapper | 26 | 20 | port cad_khana's checks to `expect` / `wonky check` as a WPy library |
| other geometry kernels or libraries: OCP, trimesh, scipy, shapely, bd_warehouse | 16 | 16 | out of reach: these compute geometry outside Bend |
| generators (`yield`) | 2 | 1 | rewrite |

- **Reachable with the driver split plus v1 features: 38 unique (41.8 %), 37 families (45.1 %).**
- Parser acceptance: 97.8 % unique, 98.8 % families.
- The 6 graphs built have 3,694 nodes, 34 of 36 comprehension and lambda filters declarative, and 24 sync
  points in 4 files.

Two lessons for the design:
1. **Marc's build123d files are build scripts, not models.** Driver IO and cad_khana block 49 of 91 files.
   Moving exports, reports and checks into `wonky build` / `wonky check` is the real translation work. That is a
   workflow decision, not a language feature.
2. The corpus stage's ladder already said that 11 % of build123d families need general control flow. WPy
   handles those with sync points. The blockers above are *library* blockers, not control-flow blockers.

### 5.2 FeatureScript: into the core, not into WPy source

AGENTS.md requires FeatureScript input to stay unmodified, so FeatureScript keeps its own frontend. The question
is only whether FeatureScript should *also* be translated into WPy source, for LLM editing or migration. The
evidence says no, not mechanically:

- **FeatureScript mutates a store.** Queries resolve against the context at call time. The corpus uses
  store-global queries in most families: `qAllModifiableSolidBodies` in 75 of 129, `qEverything` in 36. It uses
  `opDeleteBodies` in 116 and instantiator imports in 54 [M over `out/lang/corpus.json`]. WPy values are
  immutable parts with no global store. A faithful port would have to re-introduce a store API, which would be
  FeatureScript in Python clothes.
- **The semantic core already exists.** [semantic-core.md](semantic-core.md) desugars every parseable corpus
  FeatureScript file (284 of 284) into WCore/0. The r10b operation trace is identical. The WCore effect catalog
  ends in the same kernel operations as the WPy graph: extrude, frustum, transform, Boolean, measure, select.
  **The shared layer between FeatureScript and WPy is that core and its effect catalog, not the WPy surface.**
- **Hand translations are useful as examples and as LLM few-shot material.** They are shorter:

  | File | Original | WPy |
  |---|---|---|
  | inserts | 55 lines | 54 lines with docstrings |
  | guide-r2 | 111 lines | 55 lines |

  They also move read-backs into the graph (guide-r2: 7 static read-back sites to 0 sync points). They are
  rewrites that need validation, not a compilation step.
- **The reverse direction is mechanical.** WPy graph → FeatureScript works for the executed subset: box,
  polygon extrude, Boolean, translation, name. It is proven equal on bracket and frame-with-tab. It is the mechanism
  that Marc's 182 FS-generator Python files implement by hand today (`Trace` in `cad-project-041/single-step-r10/src/core_geometry.py`
  appends one FS line per build123d op).

**Coverage estimate for FeatureScript semantics expressed in the shared graph** (from [corpus.md](corpus.md)
§2, families):

| Corpus bucket | Share | WPy equivalent |
|---|---:|---|
| plain operation graph | 56.6 % | ops with 0 sync points |
| lazy IR | 41.1 % | `select` / `check` / `arith` nodes and total ops, as shown on guide-r2 |
| general control flow over geometry | 2.3 % | host sync points |

In WPy terms, 97.7 % of FeatureScript families need no host round trip. That is a statement about the core, not
about a source port.

## 6. The Bend implementation

### 6.1 The split, and why the surface stays on the host

| Stays on the host (JS) | Goes to Bend |
|---|---|
| WPy parse (0.07 to 1.03 ms warm per file), subset check, Python evaluation (BigInt ints, binary64 floats, strings, dicts, closures), predicate lowering, graph construction, stable ids, spans, error formatting, graph text and diff, FS emitter | the graph evaluator: kernel operations on resident bodies, fork-join over independent nodes, measures, checks, selections once the kernel has them |

Moving the WPy evaluator into Bend would run into every measured Bend limit at once
([bend-feasibility.md](bend-feasibility.md)):
- F32x2 is not binary64: `0.1 + 0.2 == 0.3` is true natively.
- `Nat` is an immediate up to 2^48, so there are no Python big ints.
- Strings are cons lists at about 64 B per character.
- Each evaluator change costs a 27 s / 7 GB relink.
- It would buy nothing: the whole WPy frontend costs 0.17 to 8.7 ms warm [M, `frontend.json`], against seconds
  of kernel time.

A native Python-semantics evaluator would first need a soft binary64 over U32 pairs and a big-integer library in
Bend. Neither exists or was measured.

### 6.2 The graph evaluator under Bend's constraints

The prototype reuses the spike's native core evaluator (`kernel/lang/spike/core.bend`) as the graph evaluator.
`backend-native.mjs` lowers the graph as follows:
- translations fold into primitive coordinates;
- Boolean nodes become `let` bindings;
- outputs whose cones share no Boolean become separate groups;
- groups are combined by a balanced `(par …)` tree.

The whole program travels as an integer stream: 172 to 508 ints for the examples. No Bend compile happens per
program; the binary built by the feasibility stage is reused unchanged. [M, `native.json`]

The production form suggested by this result is a dedicated graph evaluator next to the binding's coarse
operations:

- **Nodes by index, no forward references.** Every input index is smaller than its node's index (the host
  guarantees topological order). This matches Bend's "no forward references" rule and makes evaluation a
  structural fold over the node list. Fuel is the node count, so no extra fuel is needed.
- **One dispatch def** over a node ADT (`Box`, `ExtrudePolygon`, `Frustum`, `Move`, `Boolean`, `Measure`,
  `Select`, `Check`, …). Match on parameters only, one helper per op, as in `core.bend`'s `step`/Task pattern.
  There is no mutual recursion.
- **Fork-join by cones or levels, computed on the host.** Measured: the spike evaluator's `par` over four
  independent cones gives 1,255 / 658 / 317 ms on 1 / 2 / 4 threads, against 1,259 / 783 ms for the `append`
  form on 1 / 4 threads. The only speedup of the `append` form comes from the kernel's internal fork
  ([bend-feasibility.md](bend-feasibility.md) §4).
- **Errors as values with the node index.** The host maps the index to the node's span and stable id. The spike
  already returns span ids and call traces.
- **Resident bodies.** Results stay in the Bend heap as binding handles ([binding.md](../native-bridge/binding.md)
  "Residenz funktioniert"). The content-hash cache then lives next to them.
- **Kernel linking.** The same template-parameter linking as the spike (`~kernel`), or the binding's generated
  dispatcher (`gen-wire.mjs`, [surface.md](../native-bridge/surface.md) §8). Compile cost is that of the kernel
  (17.9 s Bend-to-C plus 8.9 s clang, 7 GB, per kernel change [O]). Language changes cost **no** Bend compile.
- **Memory.** Native runs of these graphs peak at 3.2 to 5.6 MB RSS [O, spike].

### 6.3 Parse in JS or in Bend

JS. Parsing Python correctly needs indentation, f-string nesting (PEP 701 appears in the corpus) and 24 node
kinds that match CPython on 257 real files. It costs 0.07 to 1.03 ms per file. A Bend parser would buy a host-free
CLI; a cached graph file keyed by the source hash buys the same ([semantic-core.md](semantic-core.md) §8.3).

## 7. Relationship to the native binding: build on it

- **WPy needs the binding and does not replace it.** The binding gives the 8.3 to 9.7x kernel speedup
  ([binding.md](../native-bridge/binding.md)). WPy adds only what a *batch* of operations can give.
- **The graph's node vocabulary should equal the binding's coarse operations**
  ([surface.md](../native-bridge/surface.md) §6): `extrude_polygon`, `frustum`, `sketch_lines`/`sketch_arcs`/
  `extrude_profile`, `transform`, `boolean`, `measure`, `import_brep`, `identity`. One interface, not two, as
  [prior-art.md](prior-art.md) §6.3 asked.
- **Add one operation: `eval_graph(nodes, roots) -> handles + views`.** The binding re-enters Bend serially, so
  fork-join over independent parts is only reachable when a whole graph crosses at once. Everything else,
  including sync points, is ordinary binding calls at about 0.5 µs each.
- **Semantic-core's WCore is FeatureScript's path to the same catalog.** FeatureScript desugars to WCore, and
  WCore's effect handler calls the coarse operations. WPy goes to the graph directly because its values are
  already immutable. Both frontends meet at the kernel operations. Neither needs the other's surface.

## 8. Dev loop and error messages

Proposed commands (the prototype has the functions; the CLI wrapper is not built):

| Command | Does | Cost |
|---|---|---|
| `wonky check part.py` | preflight: subset, vocabulary, graph, kernel gaps with spans, sync points, failure sites, checks that are decidable without geometry | 0.2 to 9 ms, no kernel load |
| `wonky graph part.py` | canonical graph text (§3.4) | same |
| `wonky diff a.py b.py` | node diff by stable id: unchanged / changed / added / removed | same |
| `wonky build part.py [--backend native] [--param K=V]` | build and export; checks reported | kernel time |
| `wonky emit-fs part.py` | FeatureScript for Onshape (executed subset) | ms |
| `wonky validate part.py` | same file on build123d/OCCT via the shim (`uv run`), with volumes and bboxes compared | seconds |

A preflight excerpt for the unmodified project-component-d98e059b.py, as an LLM session would see it [M]:

```
project-component-d98e059b.py: 274 nodes, 3 outputs, 34/34 selections declarative, 12 sync points, 12 failure sites, 0 checks
kernel gaps: filter 12, select 11, fillet 11, select_union 1, chamfer 4, offset 2, sketch_subtract 2, sketch_union 14, text 1, group 5, pick_group 5
  project-component-d98e059b.py:214:24 filter (shell/build_shell/outer/_round_outer/vert/filter)
  project-component-d98e059b.py:214:12 select (shell/build_shell/outer/_round_outer/vert/select)
  project-component-d98e059b.py:216:17 fillet (shell/build_shell/outer/_round_outer/solid/fillet)
  ... 65 more
sync project-component-d98e059b.py:229:8 if condition: emptiness guard on a selection
sync project-component-d98e059b.py:195:8 if condition: emptiness guard on a selection
sync project-component-d98e059b.py:266:8 if condition: emptiness guard on a selection
  ... 9 more sync points
failure site project-component-d98e059b.py:215 try around shell/build_shell/outer/_round_outer/solid/fillet: fallback branch
```

(`formatPreflight` in `src/lang/surface/index.mjs`; the real output, unedited.)

Incremental loop [M, `report.json` `incremental`, JS target, load 16.0 to 16.1]:
- Editing the tab width in frame-with-tab changes 3 of 7 nodes (`tab/box`, `tab/move`, `result/union`). The
  cached `frame/subtract` is reused.
- The warm rebuild evaluates 3 nodes, 10.7 s against 13.1 s for a fresh build of the edited file (an earlier run:
  11.1 s against 14.3 s). The result is bit-identical to the fresh build.
- The saving is small here because the edited branch contains the expensive union. In multi-part files
  (project-component-d98e059b: shell, tray, fence), an edit to one part leaves the other cones cached. That has not been measured
  on a runnable multi-part model.

## 9. LLM-friendliness: the strongest objection, confronted

**The objection.** LLMs have seen a great deal of Python, CadQuery and build123d, some FeatureScript, and none of
any new wonky language. Every study without massive fine-tuning targets Python ([prior-art.md](prior-art.md)
§4.1). KCL's designer names the problem himself.

**What WPy does about it:**

1. **No new syntax and no new value semantics.** The parser accepts what CPython accepts, and the evaluator
   follows CPython. It matched CPython's control flow on a real 396-line file.
2. **The vocabulary is build123d's.** 64 of 70 names. The additions fit on one card: `param`, `expect`,
   `frozen_import`, `offset_faces`, plus the rules "no IO, exports are outputs" and "bind steps to names".
3. **Unmodified LLM-written build123d already qualifies** when it is a pure model. Marc's corpus is largely
   agent-written. 6 files are WPy today; 38 are reachable after the driver split.
4. **The properties that measurably help LLMs are built in without syntax** ([prior-art.md](prior-art.md) §4.3):

   | Property | Where it comes from in WPy |
   |---|---|
   | deterministic ids (CADFS) | from binding names |
   | a global frame (Makatura) | the build123d default |
   | kernel measurements as feedback (CADSmith: median IoU 0.81 to 0.96) | `expect` plus reported checks |
   | a preflight before execution (Zoo's MCP) | `wonky check` |
   | precise errors with hints | §3.7 |
   | semantic references resolved by deterministic code (Embodied CAD, FutureCAD) | declarative selections and role references |

**What could still make it fail:**
- LLM agents write *build scripts*. In Marc's corpus, 23 files use driver IO and 26 use cad_khana. A hermetic
  dialect fights that habit, and every subset violation costs an iteration.
- A dialect that looks like Python invites features it lacks: classes and decorators (the hardest blocker in 9
  files), numpy (16 files), builders (22 files).
- Nothing here measured an LLM.

**What would make the new language worth it anyway**, as three pass criteria, all measured end to end:
1. **Task study (hypothesis H6 in [prior-art.md](prior-art.md) §6.4).**
   - Tasks: 10 to 20 parts sampled from Marc's corpus families.
   - Conditions, all with the same frontier model and a fixed iteration budget:
     1. build123d on CPython with wonky's current tools;
     2. raw FeatureScript;
     3. WPy with the one-card spec and `wonky check`;
     4. WPy with check plus the graph text.
   - Metrics: validated success (OCCT volume and bbox within tolerance, or wonky checks pass); iterations to
     success; manual interventions.
   - Pass: condition 3 or 4 ≥ condition 1.
2. **A measured native benefit on a real multi-part model.** Fork-join or cache hits in a resident session,
   through the binding, with correctness checks.
3. **Onshape reach.** The FS emitter covers the op set of the files that the Python-to-FS generators produce
   today (box, cylinder, prism, cone, hex, M3 tools, Booleans, rigid moves, names). That makes WPy the one source
   for wonky, Onshape and OCCT validation, replacing ad-hoc `Trace` generators.

If criterion 1 fails, keep build123d on CPython with stable ids added to the tracer, and keep WPy only as the
preflight and graph tool.

## 10. What gets faster, and by how much

| Where | Today | With WPy | Source of the gain | Evidence |
|---|---|---|---|---|
| frontend, build123d file | CPython start plus 23 to 41 ms subprocess wait, 3 to 4 ms bridge | 0.17 ms (frame-with-tab) to 3.2 ms (project-component-d98e059b) warm | no CPython | [O profile.md], [M frontend.json] |
| frontend, FeatureScript | ≤ 0.7 % of wall time (r10b 47 ms of 56 s) | unchanged (FS keeps its frontend) | none | [O] |
| kernel, frame-with-tab | 12,901 to 13,427 ms (`buildPython`, two runs, load 13.3 / 15.6) | 1,547 ms native, 1 thread (8.3 to 8.7x); 992 ms, 4 threads (13 to 13.5x) | **native kernel**; the binding alone gives 8.3 to 9.7x | [M report.json, native.json], [O binding.md] |
| 4 independent parts | 783 ms (4 threads, kernel-internal fork only) | 317 ms (4 threads, automatic par): **2.5x**; 3.96x against 1 thread | whole-graph fork-join, which needs `eval_graph` | [M native.json] |
| edit, rebuild | full re-run | only nodes with changed hashes (3 of 7 in the test; 10.7 s against 13.1 s on the JS target) | content hashes plus stable ids | [M report.json] |
| r10b acceptance target | FeatureScript | unchanged | WPy does not touch r10b | [I] |

No row claims a native speedup that was not measured with a correctness check. The 8.3x row is not a language
result.

## 11. Incremental path: every step ships on its own

| # | Step | Ships | Depends on |
|---|---|---|---|
| 0 | nothing changes for FeatureScript; r10b and the Boolean path stay first | | |
| 1 | native binding with the coarse handle operations (in flight) | about 9x kernel speed for every frontend | |
| 2 | graph IR v0 = the binding's operation vocabulary plus `eval_graph`; stable ids and spans on every node | fork-join for independent parts; one host-kernel interface | 1 |
| 3 | WPy v0 as a second build123d frontend: files inside the subset run without CPython; everything else keeps the CPython tracer, which gets stable call-site ids | no CPython for pure models; stable ids for all Python | 2 (native) or the JS target (today) |
| 4 | `wonky check` / `graph` / `diff` for LLM sessions (MCP tool) | preflight feedback, kernel-gap lists with spans | 3 (host only, no kernel) |
| 5 | WPy → FeatureScript emitter for the Trace op set; `wonky validate` on OCCT | one source for wonky, Onshape and validation; the Python FS generators can retire | 3 |
| 6 | kernel: selection engine for the declarative predicates, total fillet/chamfer, 2D sketch Booleans | project-component-d98e059b-class files build | kernel work, independent of language |
| 7 | WPy v1: project modules, builders as explicit accumulators, numpy-lite, role references; a cad_khana port as a WPy library | the 38-file reachable set | 3 |
| 8 | LLM task study (§9) and then the decision whether WPy becomes the preferred authoring language | a decision backed by data | 4, 5 |

Steps 3 to 5 are host-side JS and need no Bend compile. Step 6 is where the real capability gains lie: WPy's
preflight lists them.

## 12. Risks, and what not to build

**Risks:**
- **Python-semantics drift.** Every divergence from CPython breaks the "valid Python, same meaning" promise,
  including in the OCCT validation runs. Mitigation: differential tests that run the same program in CPython and
  WPy and compare values and op counts. The project-component-d98e059b op-count equality is the first such test.
- **Vocabulary creep.** build123d is large: 199 constructs cover 100 % of families, 142 cover 80 %
  ([corpus.md](corpus.md) §5). WPy should grow by corpus frequency, and every name must be a real kernel op or an
  explicit gap node, never an approximation.
- **Kernel gaps dominate.** Of the 6 corpus graphs WPy builds, none can run on today's kernel (`kernelReadyToday: 0`).
  A language cannot fix that; it only makes the gaps visible earlier.
- **Rebinding and ids.** Ids are only as stable as the naming. Rebinding the same name gives positional
  suffixes. The linter should say so.
- **Two Python implementations.** WPy in JS and CPython for validation. Accepted, because CPython is only an
  oracle, never a production path.
- **Lazy `try`.** WPy has to evaluate kernel work inside `try` blocks. That costs sync points exactly where the
  corpus uses best-effort fillets.
- **Maintenance.** The prototype is about 3.2k lines of JS against wonky's 5.5k in `src/*.mjs`. KCL's 6.1 MB of
  Rust is the warning about where a surface language can go.

**What not to build:**
- a new syntax or grammar;
- a WPy or FeatureScript interpreter or parser in Bend, unless a measured need appears after step 2;
- full CPython compatibility: classes, numpy, arbitrary imports;
- a mechanical FeatureScript-to-WPy source translator;
- a unit system beyond mm and degrees;
- a visual dataflow language (the graph is internal);
- any silent fallback: kernel gaps stay nodes that fail loudly with their span.

## 13. Evidence files

| File | Content |
|---|---|
| `out/lang/surface/report.json` | JS-target equivalence (bracket vs FS; frame-with-tab vs buildPython; emitter round trips), native runs, incremental rebuild, stable ids, error messages, loads |
| `out/lang/surface/native.json` | native medians and samples: bracket, frame-with-tab at 1 and 4 threads, pockets par/seq at 1, 2 and 4 threads |
| `out/lang/surface/corpus.json` | per-file parse / subset / graph results, blockers, selections, sync points, kernel gaps for 91 unique build123d files |
| `out/lang/surface/frontend.json` | warm parse and evaluate medians per example |
| `out/lang/surface/vocab.json` | vocabulary overlap with build123d 0.13.0; bracket token counts |
| `out/lang/surface/examples/` | the WPy examples and the emitted FeatureScript |
| `tmp/lang/surface/cross-check.mjs`, `py-shape.py` | parser fidelity against CPython `ast` (257 files) |
