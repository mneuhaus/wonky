# OpenSCAD frontend: language and geometry semantics

Status: research and specification, 24 September 2026. Nothing here is
implemented. This document says what a faithful OpenSCAD frontend for wonky
has to reproduce, and how each construct maps onto wonky in the two modes
"faceted" and "intent". The frontend architecture itself is in
[../openscad.md](../openscad.md) (if present); this file is the semantic
reference it builds on.

## 0. Evidence, sources and versions

Every claim is marked:

- **MEASURED**: run on the installed OpenSCAD CLI. The test files, their
  exports (`.off`, `.stl`, `.echo`, `.csg`) and logs are in
  `tmp/openscad/semantics/tests/`; `tests/offinfo.mjs` prints vertex counts,
  signed volume, bounding box and per-level azimuths of an OFF file.
- **READ**: read in OpenSCAD's source. Citations name the file and line in
  one of two trees (blobless clone in `tmp/openscad/semantics/upstream`,
  snapshot worktree in `tmp/openscad/semantics/snap`; neither is committed):
  - **[S]** = git `6aae79634` (14 May 2022). This is exactly the installed
    binary: `OpenSCAD --info` prints `OpenSCAD Version: 2022.05.16 (git
    6aae79634)`, CGAL 5.3, features `fast-csg`, `lazy-union`, `textmetrics`,
    `import-function`, `sort-stl`, `roof` compiled in, no Manifold (MEASURED).
    URL form: `https://github.com/openscad/openscad/blob/6aae7963498675dfb5bedaaef2cb8e56bdcddcab/<path>#L<n>`.
  - **[M]** = git `28fe66bc` (master, 23 September 2026). URL form:
    `https://github.com/openscad/openscad/blob/28fe66bcaf3e89239153cd16c34499c541d2841e/<path>#L<n>`.
- **INFERRED**: a conclusion or design proposal that nothing above proves.

No GPL code is copied here. Rules are restated in prose and formulas. The
Clipper library that OpenSCAD vendors (`src/ext/polyclipping/clipper.cpp`,
version 6.4.2) is under the Boost Software License; its behaviour is also
restated, not copied.

### 0.1 Which OpenSCAD is "OpenSCAD"?

There is no release tag after `openscad-2021.01` except a
`openscad-2026.01.01-TEST2` test tag (READ, `git tag`). "2022.05.16" is a
development snapshot, not a release. The language and the tessellation rules
drifted between [S] and [M] in ways that change geometry (sections 1, 7.1,
7.7, 7.8). Consequences (INFERRED):

1. The frontend parses the **[M] grammar** (a superset of [S]) but evaluates
   under an explicit **dialect** flag, `openscad-2022.05` or `openscad-master`,
   because tessellation counts and start angles differ.
2. Every reference baseline records the oracle's `--info` version line and
   git hash. A baseline is only compared with wonky run under the matching
   dialect.
3. Recommendation for Marc (not done, nothing was installed): install a
   current development snapshot next to 2022.05.16. [M] defaults to the
   Manifold backend ([M] `src/core/Settings.cc:243`, `src/openscad.cc:888`),
   which is reported to be much faster than CGAL (INFERRED, not measured
   here; the CGAL corefinement path of [S] is already 11x faster than Nef,
   section 8.3) and is what most current internet examples are written
   against.

## 1. Lexical structure

READ from [S] `src/core/lexer.l` (rules section) and [M] `src/core/lexer.l`.

| token | rule |
|---|---|
| whitespace | space, tab, CR, LF; U+00A0 (NBSP, UTF-8 `C2 A0`) is skipped as whitespace. [M] also skips U+FEFF (BOM) anywhere and a lone Latin-1 `A0`. |
| comments | `// ...` to end of line; `/* ... */` not nested; an unterminated block comment is a parse error. |
| keywords | `module function if else for let assert echo each true false undef`. `include` and `use` are not tokens; they are recognized by the lexer only in the form `include <...>` / `use <...>` (section 5). |
| numbers [S] | `D+ E?`, `D* . D+ E?`, `D+ . D* E?` with `E = [eE][+-]?D+`, read as IEEE double. No hex, no sign (sign is the unary operator). `.5` and `5.` are valid. |
| numbers [M] | adds `0x` hex integers; a decimal integer that is not exactly representable as a double warns "cannot be represented precisely". |
| identifiers | `$?[A-Za-z0-9_]+`. Identifiers **may start with a digit**: `2d = 5; echo(2d);` prints 5 (MEASURED, `tests/lex1.scad`). Flex longest match decides: `123` is a number (number rule first at equal length), `2d` and `1e5x` are identifiers. [M] deprecates digit-leading identifiers and adds (experimental) Unicode identifiers. |
| strings | `"..."` may span lines. Escapes: `\n \t \r \\ \"`, `\xHH` with first hex digit 0-7 (`\x00` becomes a space), `\uHHHH`, `\UHHHHHH` (to UTF-8). [S] keeps an unknown escape's characters silently; [M] warns "Undefined escape sequence" and adds `\` + newline as line continuation. Non-ASCII UTF-8 inside strings is kept verbatim. |
| operators | `<= >= == != && \|\|` and single characters `! + - * / % ^ < > = ? : , ; . ( ) [ ] { } #`. [M] adds `<< >> & \| ~`. |
| `\x03` | end-of-text marker. The CLI appends `\x03` and then every `-D name=value` as `name=value;` to the main file's text ([S] `src/openscad.cc:392,1082`), so `-D` assignments are ordinary assignments at the end of the main file that override silently (section 4.2). |

`include <path>` and `use <path>`: the lexer reads everything up to `>`
(a newline inside warns). `include` pushes the named file into the lexer's
input stream (textual inclusion); `use` returns a `TOK_USE` token carrying the
resolved path ([S] `lexer.l` `cond_include`/`cond_use`, `includefile()` l.328).

## 2. Grammar

READ from [S] `src/core/parser.y` (l.172-620 rules) and diffed against [M]
(the only grammar change is the bitwise operators). Restated as EBNF:

```
file          = { statement | USE } ;
statement     = ";" | "{" { statement } "}" | module_inst | assignment
              | "module" ID "(" params ")" statement
              | "function" ID "(" params ")" "=" expr ";" ;
assignment    = ID "=" expr ";" ;
module_inst   = ("!" | "#" | "%" | "*") module_inst
              | ifelse
              | module_id "(" args ")" child_stmt ;
ifelse        = "if" "(" expr ")" child_stmt [ "else" child_stmt ] ;
child_stmt    = ";" | "{" { child_stmt | assignment } "}" | module_inst ;
module_id     = ID | "for" | "let" | "assert" | "echo" | "each" ;
expr          = logic_or
              | "function" "(" params ")" expr
              | logic_or "?" expr ":" expr
              | "let" "(" args ")" expr
              | "assert" "(" args ")" [ expr ]
              | "echo" "(" args ")" [ expr ] ;
logic_or      = logic_and { "||" logic_and } ;
logic_and     = equality { "&&" equality } ;
equality      = comparison { ("==" | "!=") comparison } ;
comparison    = addition { ("<" | "<=" | ">" | ">=") addition } ;   (* [M]: binaryor *)
(* [M] only:  binaryor = binaryand { "|" binaryand } ;
              binaryand = shift { "&" shift } ;  shift = addition { ("<<"|">>") addition } *)
addition      = multiplication { ("+" | "-") multiplication } ;
multiplication= unary { ("*" | "/" | "%") unary } ;
unary         = exponent | ("+" | "-" | "!") unary ;               (* [M] adds "~" *)
exponent      = call [ "^" unary ] ;
call          = primary { "(" args ")" | "[" expr "]" | "." ID } ;
primary       = "true" | "false" | "undef" | NUMBER | STRING | ID
              | "(" expr ")"
              | "[" expr ":" expr [ ":" expr ] "]"
              | "[" [ vec_elem { "," vec_elem } [","] ] "]" ;
vec_elem      = expr | lc_elem | "(" lc_elem ")" ;
lc_elem       = "let" "(" args ")" lc_elem_p
              | "each" vec_elem
              | "for" "(" args ")" vec_elem
              | "for" "(" args ";" expr ";" args ")" vec_elem
              | "if" "(" expr ")" vec_elem [ "else" vec_elem ] ;
params        = [ param { "," param } [","] ] ;   param = ID [ "=" expr ] ;
args          = [ arg { "," arg } [","] ] ;       arg   = expr | ID "=" expr ;
```

Consequences that a hand-written parser must reproduce (READ):

- `^` is right-associative and binds tighter than unary minus on its left:
  `-2^2` is `-4`, `2^-1` is `0.5` (MEASURED, `tests/lang1.scad`).
- Ternary, `let`, `assert`, `echo` and function literals are lowest
  precedence and extend as far right as possible.
- Comparison operators are left-associative (`a < b < c` compares a bool with
  a number, which is undef with a warning).
- A bare `{ ... }` at statement level does **not** open a scope: its
  assignments land in the enclosing scope (the parser action for
  `'{' inner_input '}'` pushes no scope). The braces after a module
  instantiation (`translate(...) { ... }`) do open one (the instantiation's
  own scope).
- `module`/`function` definitions are allowed at file level and inside module
  bodies (a body is a `statement`), but **not** inside the child braces of an
  instantiation: `child_stmt` admits only instantiations and assignments.
- `for`, `let`, `assert`, `echo`, `each` are valid module names.
- A trailing comma is allowed in vectors, parameter and argument lists.
- A negative numeric literal is folded at parse time (`unary` action), which
  matters only for `isLiteral()` checks (range warnings, section 3.3).

The parser also tracks assignments per scope (`handle_assignment`, [S]
`parser.y:723-757`): a second assignment to the same name in the same scope
replaces the *expression* of the first and keeps the first's *position*
(section 4.2).

## 3. Values, types and operators

### 3.1 Types

READ [S] `src/core/Value.h/.cc`. Seven runtime types: `undef`, `bool`,
`number` (IEEE double), `string` (UTF-8, indexed and measured by code point:
`len("éx") == 2`, MEASURED), `vector` (heterogeneous list), `range`
(begin/step/end, lazily iterated), `function` (a closure). [S] also has an
experimental `object` type; [M] adds `object()`, `has_key()`, `fill()` as
experimental builtins (`Feature.cc`, `ExperimentalObjectFunction`). A wonky
frontend can refuse objects by name at first.

`undef` carries an optional **reason**: an invalid operation returns
`undef("undefined operation (number + string)")`, and the warning is printed
when such an unchecked undef is consumed ([S] `Value.cc` visitors,
`isUncheckedUndef`). MEASURED: `1+undef` and `"a"+"b"` each print
`WARNING: undefined operation (...)` and yield `undef`.

Truthiness ([S] `Value.cc:250`): `undef` false; bool as is; number `!= 0`
(so `nan` is true); string non-empty; vector non-empty; range, function,
object true. MEASURED: `[0?1:2, ""?1:2, []?1:2, [0]?1:2, "0"?1:2]` is
`[2, 2, 2, 1, 1]`.

### 3.2 Operators

READ [S] `Value.cc:861-1260`, MEASURED in `tests/lang1.scad`:

| operation | result |
|---|---|
| `num + - * / num` | IEEE double; `1/0 = inf`, `-1/0 = -inf`, `0/0 = nan`; `%` is C `fmod` (`1%0 = nan`) |
| `num ^ num` | `pow` |
| `vec ± vec` | element-wise, **truncated to the shorter length** (`[1,2,3]+[10,20] = [11,22]`) |
| `vec * num`, `num * vec` | scale every element (recursively via `*`) |
| `vec * vec` (numbers) | dot product; lengths must match, else undef |
| `matrix * vec`, `vec * matrix`, `matrix * matrix` | linear algebra; non-rectangular or non-numeric entries give undef with a reason |
| `-vec` | element-wise negation |
| `string + string` | **undef** with a warning (concatenation is `str()` or `concat()`) |
| `==`, `!=` | deep equality; different types are unequal (no warning); `undef == undef` is true; vectors compare element-wise |
| `< <= > >=` | numbers, strings (lexicographic bytes), bools among themselves; vectors lexicographic; mixed types give undef with a warning (`1 < "a"`, `true < 2`, `undef < 1`) |
| `&& \|\| !` | short-circuit, return bool: `false && unknown_var` does not evaluate (no warning) |
| `v[i]` | `i` is truncated toward zero (`v[1.7] == v[1]`); out of range or negative is undef (no warning in [S]); strings index code points |
| `v.x .y .z` | elements 0, 1, 2 ([M] adds experimental swizzles) |
| [M] `& \| ~ << >>` | integer bit operations (only [M]) |

### 3.3 Ranges

READ [S] `Expression.cc:251` (`Range::evaluate`), `Value.cc:1199`
(`RangeType::numValues`), iterator l.1221-1258:

- `[b:e]` has step 1. If `e < b` the bounds are **swapped** with a
  DEPRECATED message (MEASURED `[for (i=[3:0]) i] = [0,1,2,3]`).
- `[b:s:e]`: element count `n = floor(nextafter((e-b)/s, +huge)) + 1`, empty
  if the direction of `s` disagrees with `e-b` (a literal range warns
  "begin is smaller than the end, but step is negative"), `n = 1` if `b == e`
  or `s` is infinite, "infinite" if `s == 0` or a bound is infinite; any NaN
  gives 0 elements.
- Element `k` is `b + s*k` (computed afresh, not accumulated). MEASURED:
  `[0:0.1:1]` has 11 elements and the last is exactly `1`.
- A range with `>= 1e6` elements in `for`/`each` warns "Bad range parameter
  ... too many elements" and **yields nothing** ([S] `Expression.cc:847`).
  `children([range])` caps at 10000 ([S] `Value.h:51` `MAX_RANGE_STEPS`).

### 3.4 Number formatting

`echo`, `str` and the `.csg` export print numbers with double-conversion
`ToPrecision(6)` ([S] `Value.cc:56-67,156`): `1/3 → 0.333333`,
`0.1+0.2 → 0.3`, `1234567 → 1.23457e+6`, `1e20 → 1e+20`, `-0 → 0`
(MEASURED). String results of `str(x)` inherit this, so any model that parses
or compares `str()` output depends on it; the frontend must reproduce this
formatter exactly (INFERRED).

## 4. Evaluation model and scoping

### 4.1 Two phases

OpenSCAD evaluates in two phases (READ [S] `ModuleInstantiation.cc`,
`GeometryEvaluator.cc`):

1. **Instantiation**: the AST is executed into a tree of nodes (builtin
   primitives, transforms, CSG operations, extrusions, groups). All language
   semantics (variables, functions, loops, recursion) live here. The CLI can
   dump this tree as `.csg` (MEASURED `tests/csgdump.csg`: every call is
   resolved to builtins, `translate`/`rotate`/`mirror` become `multmatrix`,
   each primitive carries its resolved `$fn/$fa/$fs`; numbers are printed with
   6 significant digits, so the dump is structural, not exact).
2. **Geometry evaluation**: the node tree is evaluated bottom-up into
   2D polygons and 3D polysets/Nef polyhedra (section 7 onwards).

The wonky frontend should keep the same split (INFERRED): an interpreter that
produces an explicit CSG node tree (identical in shape to OpenSCAD's `.csg`
dump), and a geometry stage that sends that tree to Bend. The tree is the
natural unit for language-level differential tests (section 10.1).

### 4.2 Scopes and assignment

READ [S] `ScopeContext.cc:59` (`init`), `LocalScope.cc`, `parser.y:723-757`;
MEASURED `tests/lang1.scad`, `tests/scope1.scad`, `tests/incl1.scad`.

- Scopes: the file, each module body, each instantiation'project-component-32f60153 braces, each
  `let`, each function call, each `for` iteration, each list-comprehension
  element. Statement-level `{}` is not a scope (section 2).
- **All assignments of a scope are evaluated first, in textual order, then
  its module instantiations** ([S] `ScopeContext::init` then
  `LocalScope::instantiateModules`). `cube(a); a = 2;` uses `a = 2`.
- **One binding per name per scope.** A later assignment to the same name
  replaces the expression but keeps the position of the first. MEASURED:
  `a = 1; echo(a); a = 2;` prints `2` and warns "a was assigned on line 1 but
  was overwritten". Includes (textual) take part: a main-file assignment
  after `include` overrides the library's value, and the library's own
  functions then see the new value (MEASURED `incl1.scad`: `lib_fn()` returns
  7 after `lib_var = 7`). `-D` assignments override silently.
- Reading an undefined variable warns "Ignoring unknown variable 'x'" and
  yields `undef` ([S] `Context.cc` `lookup_variable`).
- Assigning a module parameter with a literal inside the body warns
  "Parameter x is overwritten with a literal" ([S] `ScopeContext.cc:59ff`).

### 4.3 Three namespaces

READ [S] `ScopeContext.cc` `lookup_local_function/module`; MEASURED
`function h() = 10; h = 20; echo(h(), h)` prints `10, 20`.

Variables, functions and modules are separate namespaces. A call `f(x)` first
looks for a function `f` in the scope chain; each scope falls back to a
**variable** `f` holding a function value (function literals). Module names
are looked up only among modules. Lookup walks the **lexical** chain (the
defining context of the module or function), except for `$`-names.

### 4.4 Special (`$`) variables

READ [S] `ContextFrame.cc:135` (`is_config_variable`: name starts with `$`
and is not `$children`), `EvaluationSession.cc` (`try_lookup_special_variable`
walks the session's frame stack from the innermost frame outward),
`Builtins.cc:108-122` (defaults); MEASURED `tests/scope1.scad`,
`tests/preview_off.scad`.

- `$`-variables are **dynamically scoped**: lookup follows the call stack,
  not the lexical chain. `$x` set inside a module body is visible to
  everything called from there, **including the caller's `children()`**
  (MEASURED: `wrap() { show(); }` with `$x = 3` in `wrap`'s body prints
  `x = 3` in the child).
- Any module or function call may pass `$name = value` as an argument; it
  binds `$name` for that call and everything below, without the
  "not specified as parameter" warning ([S] `Parameters.cc`
  `parse_without_defaults`).
- Defaults: `$fn = 0`, `$fa = 12`, `$fs = 2`, `$t = 0`, `$vpt = $vpr = [0,0,0]`,
  `$vpd = 500`, `$vpf = 22.5`, `$preview = undef` overwritten by the CLI
  ([S] `openscad.cc:422,468`): **false for geometry exports** (`.off`, `.stl`,
  `.nef3`, MEASURED `preview_off.scad` exports the `else` branch) but **true
  for every previewable export: `.csg`, `.echo`, `.ast` and `.png`**, unless
  `--render` is given (MEASURED `lang1.echo` prints `preview = true`;
  corrected after the review, [review.md](review.md) B1: MEASURED
  `tmp/openscad/review/r05_preview.scad` dumps `$fn = 8` to the `.csg` while
  its STL uses `$fn = 64`, also when several `-o` share one invocation).
  `-D '$preview=false'` does not fix it: the `-D` lines are appended at the
  end of the main file (section 1), so file-scope assignments above them
  still read true (MEASURED `r05b_preview_early.scad`). `--render` fixes
  every format ([S] `openscad.cc:952`, `:1038-1040`; MEASURED `r05_multi3`).
  So the oracle dumps `.csg` and `.echo` with `--render`, and the frontend
  evaluates, dumps and echoes with `$preview = false` (oracle.md §4.1).
- `$children` is lexical (bound in the module's own context,
  `ScopeContext.cc:103-108`): the number of child instantiations of the
  current module call. `$parent_modules` is bound the same way; at file level
  it is unknown (MEASURED warning).
- `$fn`, `$fa`, `$fs` are read by each primitive/extrusion at instantiation
  time from the dynamic scope, then clamped (section 7.1).

### 4.5 Functions, modules and parameters

READ [S] `Parameters.cc` (both `parse` overloads), `Expression.cc:501-620`,
`UserModule.cc`, `control.cc`; MEASURED `tests/lang1.scad`, `scope1.scad`.

- Argument binding: named arguments bind by name; positional arguments fill
  the parameters in order, **skipping names already bound by a named
  argument that appeared earlier**. Extra positional arguments warn "Too many
  unnamed arguments supplied" and are dropped. A named argument that is not
  a parameter warns "variable x not specified as parameter" and is **still
  bound** in the callee's frame. For user modules and functions both
  warnings depend on parameter checking (`--check-parameters`, on by
  default); builtins always warn.
- Missing parameters without a default are `undef`.
- **Defaults are evaluated in the defining context, not in the call frame.**
  MEASURED: `a = 1; ... a = 2; function g(a, c=a) = c; echo(g(3));` prints
  `2` (the file-level `a`), not `3`.
- Function bodies run in a new context whose parent is the **defining**
  context (closures); `$`-variables come from the caller.
- Function literals `function(x) expr` capture their defining context
  (MEASURED closure `mk(5)(1) == 6`). They are compared by identity.
- Builtin modules ignore children they do not use and warn "module cube()
  does not support child modules".
- `children()` ([S] `control.cc` `builtin_children`) instantiates the
  current user module'project-component-32f60153 statements **in the caller's context** (but
  with the dynamic `$` stack of the callee, above). Forms: `children()` all,
  `children(i)` (truncated), `children([i, j])`, `children([a:b])`;
  out-of-range indices warn and are skipped. Outside a user module it yields
  nothing. The deprecated `child()` exists in [S].
- Module definitions nest: a module defined inside another module's body is
  local to it (MEASURED `outer()`/`inner()`).

### 4.6 Recursion and loop limits

READ [S] `Expression.cc:562-610` (tail-call loop), `UserModule.cc:42-80`,
`src/utils/StackCheck.h`, `src/platform/PlatformUtils-mac.mm:32-47`;
MEASURED `tests/rec_*.scad`:

- Function calls are evaluated by a **tail-call loop**: when the body reduces
  (through `?:`, `let`, `assert(...) expr`, `echo(...) expr`) to another
  function call in tail position, the call replaces the current one without
  growing the native stack. At most **1,000,000** such tail steps per
  outermost call; then "Recursion detected calling function 'f'" and
  evaluation aborts. MEASURED: `t(999999)` succeeds, `t(1000001)` fails
  (1.3 s).
- Non-tail recursion is limited by the **native stack**: `StackCheck`
  compares the stack depth with `RLIMIT_STACK - 128 KiB`. MEASURED on this
  Mac: `f(n) = n == 0 ? 0 : 1 + f(n-1)` works for `n = 9000` and fails for
  `n = 10000`; module recursion works at 3000 and fails at 10000. These
  numbers are platform and build dependent.
- List comprehensions with C-style `for` stop after 1,000,000 iterations
  with "For loop counter exceeded limit" ([S] `Expression.cc:919`).

A wonky interpreter should reproduce the 1e6 tail limit exactly and define
its own non-tail limit (INFERRED: a fixed depth such as 10,000 frames, stated
in the result, instead of a stack-size accident). Corpus models that sit
between the two platforms' limits are rare but possible.

### 4.7 Control structures

READ [S] `control.cc`, `Expression.cc:775-940`; MEASURED `tests/lang1.scad`,
`tests/ifor.scad`.

- `if (c) A else B` as a statement: an `if` whose branch is not taken and
  that has no `else` contributes no node at all.
- `for (i = X, j = Y) body` iterates the **cartesian product** (nested, `i`
  outer). `X` may be a range, vector (elements), string (code points), object
  (keys, experimental), `undef` (no iteration) or any other value (one
  iteration bound to that value). The children of all iterations form one
  **implicit union** (a group node; with the experimental `lazy-union`
  feature a list instead).
- `intersection_for(...)` intersects the iterations.
- `let(a = 1, b = a + 1)` (statement and expression) assigns
  **sequentially**; the deprecated `assign()` assigns in parallel.
- List comprehensions: `for` (also multi-variable, cartesian), C-style
  `for (init; cond; update)`, `if`/`else`, `let`, `each`. `each` expands a
  range to its values, a vector by one level, a string into characters; other
  values stay as they are; `undef` disappears ([S] `Expression.cc:775-803`).
  MEASURED: `[each [1,2], each [3:5]] = [1,2,3,4,5]`.
- `echo(...)` as statement prints `ECHO: a = 1, ...` and instantiates its
  children; as expression prints and evaluates to the trailing expression.
- `assert(cond, msg)`: on failure logs `ERROR: Assertion 'cond' failed: msg`
  and **throws**, aborting the whole evaluation ([S] `Expression.cc:~650`,
  `AssertionFailedException`).

### 4.8 Builtin functions

READ (names registered with `Builtins::init` in [S]):

`abs acos asin atan atan2 ceil chr concat cos cross exp floor is_bool
is_function is_list is_num is_object is_string is_undef len ln log lookup max
min norm ord parent_module pow rands round search sign sin sqrt str tan
version version_num` plus experimental `textmetrics fontmetrics`, and in
[M] `object has_key fill` (and `import()` as a function, experimental in both).

Semantics that matter (READ/MEASURED):

- Trigonometry is in **degrees** and uses the exact-angle folding of
  section 7.2 (`sin(30) = 0.5`, `cos(60) = 0.5`, `tan(45) = 1` exactly).
- `round` is half away from zero (`round(-2.5) = -3`, MEASURED).
- `rands(min, max, n, seed)` uses `std::mt19937` and
  `std::uniform_real_distribution<>` ([S] `builtin_functions.cc:64,163-173`).
  The distribution algorithm is standard-library specific (libc++ on macOS
  differs from libstdc++), so seeded `rands` reproduces only against the
  oracle's platform; unseeded `rands` seeds from time and process id and is
  non-deterministic (INFERRED). wonky: implement mt19937 plus libc++'s
  `generate_canonical`, and label unseeded calls as non-reproducible.
- `len(1)` warns and returns undef (MEASURED).
- `str()` concatenates the echo formatting of its arguments
  (`str("a", 1, [1,2], undef, true) = "a1[1, 2]undeftrue"`, MEASURED).

### 4.9 Diagnostics

OpenSCAD continues after almost every problem and substitutes `undef` or an
empty geometry: unknown variables/functions/modules, wrong argument types,
bad ranges, mixing 2D and 3D children, `rotate_extrude` across the axis. Only
syntax errors, failed `assert`, recursion limits and a few I/O errors stop
evaluation. `--hardwarnings` stops at the first warning ([S]
`openscad.cc:969`).

The frontend must reproduce the continue-with-undef semantics (models rely
on them), record every warning with its source location, and mark a run with
geometry-affecting warnings (ignored child, unknown module, empty primitive)
as **degraded** rather than successful (INFERRED policy, in line with
AGENTS.md "do not report an incomplete model as successful").

## 5. Files: include, use, library paths, external data

READ [S] `lexer.l:328` (`includefile`), `parsersettings.cc` (`_find_valid_path`,
`search_libs`, `parser_init`), `ScopeContext.cc:119-160` (`FileContext`);
MEASURED `tests/scope1.scad`, `tests/incl1.scad`, `tests/import_rel.scad`.

- **Search order** for `include <p>`/`use <p>`: (1) `p` relative to the
  directory of the file that contains the statement; (2) each directory of
  `OPENSCADPATH` (platform path separator); (3) the user library directory
  (macOS: `~/Documents/OpenSCAD/libraries`); (4) the bundled
  `Resources/libraries`. Absolute paths are used as is. Directories are
  rejected. A file already on the current include stack is rejected
  (circular include), which then fails as "can't open". MEASURED `--info`:
  library path `~/Documents/OpenSCAD/libraries`,
  `/Applications/OpenSCAD.app/Contents/Resources/libraries`.
- **`include`** is textual: the included file's statements become part of the
  including scope, including its top-level geometry and `echo`s (MEASURED:
  the library's `cube(100)` appears), and the one-binding-per-scope rule
  applies across the boundary.
- **`use`** imports only **modules and functions**. The used file's top-level
  variables are invisible to the user (MEASURED warning for `lib_var`), but
  visible to the used file's own modules/functions: each lookup creates a
  fresh file context of the used file and evaluates its top-level
  assignments there ([S] `FileContext::lookup_local_function`). Top-level
  instantiations (geometry, `echo`) of a used file never run (MEASURED).
  `use` is **not transitive**: only the directly used files are searched.
  Local definitions shadow used ones.
- `import()`, `surface()`, and the deprecated `file=` of the extrusions
  resolve relative paths against the directory of the file that contains the
  **statement** (not the caller): MEASURED `lib/importer.scad` imports
  `plate.stl` from `lib/`.
- wonky policy (INFERRED, from AGENTS.md "freeze external dependencies with
  provenance"): every included, used, imported or surface file is recorded
  with absolute path, library root and sha256; libraries such as BOSL2 are
  pinned by their tree hash. `~/Workspace/cad` stays read only (as for the
  Python frontend).

## 6. Output modifiers and non-geometric nodes

READ [S] `GeometryEvaluator.cc:90-100,240,317` (`isBackground`), MEASURED
`tests/modifiers.scad`, `tests/root_modifier.scad`:

- `%` (background): shown in preview, **excluded from geometry**.
- `*` (disable): the subtree is not instantiated.
- `!` (root): only this subtree is rendered; everything else is ignored.
- `#` (highlight): normal geometry.
- `color(c, alpha)`: no geometric effect. wonky maps it to body appearance
  metadata as the Python frontend does for `colors=` (INFERRED).
- `render(convexity)`: no geometric effect (forces CGAL evaluation in preview).
- `convexity=` parameters everywhere: preview-only hints; ignore.
- `echo`/`assert` modules with no children contribute no node.

## 7. Geometry: discretization rules

### 7.1 Fragment count (`$fn`, `$fa`, `$fs`)

READ [S] `src/utils/calc.cc:44-51` and `src/core/primitives.cc:95-111`
(`set_fragments`); [M] `src/core/CurveDiscretizer.cc:25-154`. MEASURED
`tests/frag_*.scad`.

Clamping at the primitive: `$fs < 0.01` and `$fa < 0.01` are clamped to 0.01
with a warning. [M] also clamps `$fn < 0` to 0 with a warning.

For radius `r` (for cylinders `max(r1, r2)`):

- `r < GRID_FINE = 2^-20 ≈ 9.54e-7` (or `$fn` inf/nan): **3** fragments
  ([S] returns 3; [M] returns "none" and every caller substitutes 3 or a
  similar fallback).
- `$fn > 0`: **[S]** `n = max(3, trunc($fn))`; **[M]**
  `n = ceil(ceil(max(3, $fn)) · |angle|/360)` for an arc of `angle` degrees
  (full circle: `ceil(max(3, $fn))`). MEASURED on [S]: `$fn = 10.5` gives 10
  vertices, `$fn = 2` gives 3. [M] gives 11 for `$fn = 10.5`.
- otherwise `n = ceil(max(min(360/$fa, 2πr/$fs), 5))` (both versions;
  [M] multiplies by `angle/360` and ceils again for arcs; [M]'s
  experimental `$fe` chord-error mode is off by default).

With the defaults (`$fa = 12`, `$fs = 2`): `n = 5` for `r ≤ 5/π ≈ 1.59`,
`n = ceil(πr)` up to `r ≈ 9.55`, and `n = 30` above. MEASURED: `r = 1 → 5`,
`r = 5 → 16`, `r = 10 → 30`; `$fa = 1, $fs = 0.001` warns and gives 360.

### 7.2 Degree trigonometry

READ [S] `src/utils/degree_trig.cc`. `sin_degrees`/`cos_degrees` (used by
every primitive, every rotation and the language's `sin`/`cos`) reduce the
angle to `[0, 360)` by subtracting `360·floor(x/360)`, fold into the first
quadrant, return **exact** values at 0, 30, 45, 60, 90 (0.5, √½, √¾ as the
nearest doubles) and otherwise evaluate `sin`/`cos` of the folded angle in
radians, using `cos(90° - x)` for angles above 45°. Angles beyond
`2^52·360` give NaN. `angle_axis_degrees` builds Rodrigues' matrix from these
values without normalizing more than necessary ([S] `degree_trig.cc:197`).
Bit-identical vertices need this exact folding (INFERRED); the effect is at
the 1e-16 relative level, so geometry comparison does not depend on it.

### 7.3 Primitives

All READ in [S] `src/core/primitives.cc` (line of `createGeometry` given)
and checked against [M] (same vertex positions; [M] only changed the index
layout). Circle, cylinder, cone, sphere, polygon and polyhedron rows are
MEASURED in `tests/`.

| primitive | parameters (positional order first) | geometry |
|---|---|---|
| `square(size, center)` l.668 | `size` number or `[x, y]` (default 1) | outline `(0,0) (x,0) (x,y) (0,y)`, shifted by `-size/2` if `center`. Non-positive or non-finite size: empty (warning). |
| `circle(r)` / `circle(d=)` l.752 | positional `r`; `d` wins over `r` with a warning if both | `n` vertices at angle `360·i/n`, `i = 0..n-1`, **starting on +X**, counterclockwise (MEASURED `$fn = 7`: azimuths `0, ±51.43, ±102.86, ±154.29`). |
| `cube(size, center)` l.136 | number or `[x, y, z]` | 6 quads, outward counterclockwise. |
| `cylinder(h, r1, r2, center)` l.384, builtin l.452 | positional order is **`h, r1, r2, center`**; named `r, d, d1, d2`; defaults `h = 1, r1 = r2 = 1`; `d*` beat `r*`; `r` together with `r1/r2` warns "ambiguous" and `r1/r2` win | `n = fragments(max(r1, r2))`; both rings at the same angles `360·i/n` from +X at `z = 0` and `h` (or `±h/2`); side quads (in [S] triangles if `r1 ≠ r2`; the trapezoids are planar anyway), `n`-gon caps; a zero radius gives one apex vertex ([M]); [S] builds `n` coincident apex points and no cap there, which the exporter merges (MEASURED: 7 vertices, 6 triangles and a hexagon for `r2 = 0, $fn = 6`). `cylinder(10, 5)` is **h = 10, r1 = 5, r2 = 1** (MEASURED `cone_positional.scad`). |
| `sphere(r)` / `sphere(d=)` l.260 | | `n = fragments(r)`, `rings = floor((n+1)/2)`; ring `i` at polar angle `φ_i = 180·(i + 0.5)/rings` from +Z, radius `r·sin φ_i`, height `r·cos φ_i`, each ring `n` vertices at `360·j/n` from +X; no pole vertices; the first and last rings are `n`-gon caps. MEASURED `$fn = 6`: rings at `z = ±8.66, 0` (r = 10); default `r = 10`: 450 vertices, volume 4112.86 vs exact 4188.79. |
| `polygon(points, paths, convexity)` l.853 | `points` vec2 list; `paths` optional list of index lists | without `paths`: one outline through all points; with `paths`: one outline per path. The outlines are later sanitized with the **even-odd** rule (section 7.6): MEASURED a square with an inner square path is a frame; with the inner path twice it is filled again. Out-of-range indices warn and are dropped; non-finite points become `[0,0]` with an error. |
| `polyhedron(points, faces, convexity)` l.559, builtin l.574 | `points` vec3 (a vec2 point gets `z = 0`); `faces` (deprecated alias `triangles`) | each face is a polygon of point indices, **clockwise when viewed from outside**; OpenSCAD reverses the order on input (`insert_vertex` prepends), so internally faces are counterclockwise-outward. Faces with fewer than 3 valid indices are dropped; out-of-range indices warn and are dropped. MEASURED: a correctly (clockwise) wound tetrahedron exports with volume +166.67; a wrongly wound one exports with **negative** volume when it is the only object (no CSG runs), but inside a `union()` CGAL reorients it (volume +166.67 + 1). No validity check (closedness, self-intersection) is done at construction. |

### 7.4 Transforms

READ [S] `src/core/TransformNode.cc:51-260`, `GeometryEvaluator.cc:645-690`.

- `translate(v)`, `scale(v)` (`v` number → uniform; vec2 → `z = 1`),
  `multmatrix(m)` (up to 4×4; missing entries from the identity; the matrix is divided by `m[3][3]` when that is not 1, [S] `TransformNode.cc:204-222`), `mirror(v)` =
  `I - 2·v vᵀ/|v|²` (`v = 0`: identity), `rotate(a = [ax, ay, az])` =
  `Rz(az)·Ry(ay)·Rx(ax)` (X first, extrinsic), `rotate(a, v)` = axis–angle
  about `v` (default `v = [0,0,1]`), `rotate(a)` scalar = about Z. A vector
  `a` ignores `v` with a warning. Scaling by 0 warns but is applied.
- NaN or infinite matrices remove the child with a warning.
- A transform applies to the **union** of its children.
- On **2D** geometry the 4×4 matrix is reduced to the 2D affine matrix built
  from rows/columns 0, 1 and 3 (the `z` column and row are dropped, so
  rotating a 2D shape about X squashes it). If the 2D determinant is `≤ 0`
  the outlines are re-sanitized to fix orientation.
- On 3D geometry the matrix is applied to the vertices; OpenSCAD fixes the
  face orientation of mirrored polysets downstream (MEASURED `mirror_cube`:
  volume +6).
- `resize(newsize, auto)` (READ [S] `CgalAdvNode.cc:59-84`,
  `PolySet.cc:178-203`, `Polygon2d.cc:79-102`): union the children, take the
  **bounding box of the evaluated (faceted) geometry**, scale each axis `i`
  with `newsize[i] > 0` by `newsize[i]/size[i]`; axes with `newsize[i] = 0`
  keep scale 1 unless `auto[i]` is true, in which case they take the scale of
  the largest requested dimension. The scale is about the **origin**, not the
  box corner.

### 7.5 Dimension rules and implicit unions

READ [S] `GeometryEvaluator.cc:90-160,234-340`:

- Groups, module calls, `for`, `children()`, the file itself and every
  transform/extrusion input are **implicit unions** of their children
  (MEASURED `union_top.scad`: two overlapping cubes export as one volume).
- The dimension of a union/difference/intersection/hull/minkowski is set by
  the first non-background child that has geometry. A later child of the
  other dimension warns "Mixing 2D and 3D objects is not supported"; the
  operation then ignores it ("Ignoring 3D child object for 2D operation").
- `difference()` subtracts all later children from the first. MEASURED
  (`tests/diff_empty_*.scad`, `isect_empty.scad`): an empty first child
  (`cube(0)`) gives an empty result ("Current top level object is empty"),
  an empty later child is ignored, an empty operand of `intersection()`
  empties it. Union and minkowski skip empty children.

### 7.6 2D subsystem (Clipper)

READ [S] `src/geometry/ClipperUtils.cc`, `GeometryEvaluator.cc:174-233,338-406,512-537`,
Clipper 6.4.2 `clipper.cpp:3958-4215` (Boost licence), `clipper.hpp:79`.

- **Integer grid.** Every 2D operation converts to Clipper's 64-bit integer
  coordinates with a power-of-two scale chosen per operation:
  `exp = ilogb(max(|min|, |max|, size of the combined bounding box)) + 1`,
  `pow2 = 60 - exp` (Clipper's `hiRange = 2^62 - 1`, `ilogb = 61`, minus one
  bit), coordinates are multiplied by `2^pow2` and rounded. For a part of
  about 100 mm the grid is `2^-53 mm`, far below any tolerance of interest.
  The result is converted back and each outline is cleaned with Clipper's
  `CleanPolygon` (distance 1.415 grid units: removes duplicate and collinear
  vertices).
- **Fill rules.** Sanitizing an input polygon (`polygon()` with paths,
  imported DXF/SVG) uses **union with even-odd**. The Boolean operations use
  **non-zero** for subject and clip. Intersection of more than two operands
  is folded left.
- **Orientation.** Results have positive outlines counterclockwise and holes
  clockwise.
- **Hull 2D** (`applyHull2D`): CGAL `convex_hull_2` of all outline vertices of
  all children (double coordinates, exact predicates); collinear points are
  dropped.
- **Minkowski 2D** (`ClipperUtils::applyMinkowski`, l.255): Clipper's
  Minkowski construction (translated copies plus edge quads) followed by a
  union, pairwise over the children.
- **offset** ([S] `OffsetNode.cc:46-74`): `offset(r)` round joins, else
  `offset(delta)` miter joins (miter limit fixed at 1e6, so effectively
  never squared off), `offset(delta, chamfer = true)` Clipper square joins.
  `r` wins over `delta`; no argument means `r = 1`. The children are unioned
  first. Round joins: `n = fragments(|r|)` from `$fn/$fa/$fs`, arc tolerance
  `y = |r|·(1 - cos(180°/n))`, capped at `0.25·|r|`; Clipper then uses
  `steps_per_circle = π / acos(1 - y/|r|)` (which is `n` whenever the cap
  does not bite, i.e. `n ≥ 5`) and puts on each convex corner of turning
  angle `a` the point along the previous edge's normal, then
  `max(round(steps_per_circle·|a|/2π), 1) - 1` further points rotated by
  `2π/steps_per_circle`, then the point along the next edge's normal.
  Concave corners get the two offset points plus the original vertex, which
  the final union removes. MEASURED:
  - `offset(r = 1, $fn = 8)` of `square(10)` equals
    `minkowski() { square(10); circle(1, $fn = 8); }` exactly (12 vertices,
    volume 142.828 after `linear_extrude(1)`), because the square's edge
    normals coincide with the octagon's vertices;
  - on a triangle the two differ (volume 65.293 vs 64.799, bbox min x
    −0.928 vs −1): Clipper's arc points start at each edge normal, not at
    the circle's `+X`-aligned grid;
  - with default resolution `offset(r = 1)` (n = 5) puts **no** intermediate
    point in a 90° corner: the square gets chamfered corners (volume 142 = 100
    + 40 + 4·0.5);
  - `offset(r = -1)` of a square keeps sharp corners (4 vertices).
- **projection** (READ [S] `GeometryEvaluator.cc:1321-1380`):
  `projection(cut = true)` converts the unioned children to a CGAL Nef
  polyhedron and intersects it with the plane `z = 0`;
  `projection(cut = false)` projects every triangle of every child to XY
  (back faces flipped) and unions them with Clipper (strictly simple).
- **text** (READ [S] `FreetypeRenderer.cc:254-279,562`, `DrawingCallback.cc`):
  glyph outlines from FreeType through HarfBuzz shaping and fontconfig font
  lookup; the font is scaled so that `size` is roughly the em height
  (internal scale 1e5); quadratic/cubic Bézier segments are subdivided into
  `max(floor(fragments(size)/8) + 1, 2)` equal parameter steps. OpenSCAD
  bundles Liberation 2.00.1 fonts (MEASURED `Resources/fonts`); the result
  depends on the fonts found at run time (MEASURED: `text("A", size = 10)`
  works and warns about a fontconfig element).

### 7.7 `linear_extrude`

READ [S] `LinearExtrudeNode.cc:50-160`, `GeometryEvaluator.cc:736-1126`,
`calc.cc:62-175`; [M] `LinearExtrudeNode.cc:50-70`, `CurveDiscretizer.cc`.
MEASURED `tests/lex_*.scad`.

- Parameters: `height` (positional first; if `height` is not named and the
  first positional argument is a number, it is the height), `center`,
  `twist` (degrees), `slices`, `segments`, `scale` (number or `[sx, sy]`;
  negatives clamp to 0), `convexity`, deprecated `file/layer/origin`. [M]
  adds `v` (extrusion direction vector) and the alias `h`.
- **Default height is 100** (MEASURED `linear_extrude() square(1)`: 0..100).
  `height ≤ 0` gives an empty result.
- The children are unioned (Clipper) first.
- Slices:
  - no twist, uniform (or no) scale: **1** slice (straight or tapered prism;
    MEASURED `scale = 0.5`: 8 vertices);
  - twist (any scale): with `$fn > 0`
    `max(ceil(|twist|·$fn/360), ceil(|twist|/120), 1)`; otherwise
    `max(min(ceil(|twist|/$fa), ceil(L/$fs)), ceil(|twist|/120), 1)` where
    `L` is the length of the path of the outline vertex farthest from the
    origin: a helix when the scale is 1 or non-uniform, a conical
    (Archimedes) spiral when the scale is uniform and not 1
    ([S] `GeometryEvaluator.cc:1003-1016`, `calc.cc:62-150`);
  - non-uniform scale without twist: `$fn > 0` → `trunc($fn)` slices, else
    `ceil(sqrt(d² + h²)/$fs)` with `d` the largest in-plane displacement of a
    vertex between bottom and top;
  - `slices = k` overrides.
  MEASURED: `twist = 90, h = 10`, square 10 → 8 slices; with `$fn = 8` → 2;
  `scale = [0.5, 1]` → 6.
- Outline refinement when twist or non-uniform scale is present (or
  `segments` is given): edges are subdivided so that the outline has at least
  `$fn` (or `ceil(360/$fa)`) vertices, preferring the longest edges, or so
  that no edge is longer than `$fs`; MEASURED the square becomes 20 vertices
  (edges split into 5 by `$fs = 2`), with `$fn = 8` 8 vertices.
- Slice `j` of `S` sits at `z = h1 + (h2 - h1)·j/S`, is scaled by
  `1 - (1 - s)·j/S` per axis and **rotated by `-twist·j/S`** (clockwise seen
  from +Z for positive twist; MEASURED azimuth shift −11.25° per slice for
  `twist = 90`, 8 slices).
- Each side quad between consecutive slices is split into two triangles
  along the **shorter diagonal**; diagonals equal within a relative 1e-5 are
  split according to twist direction and hole/outline parity; at a zero
  scale the degenerate triangle is dropped ([S] `GeometryEvaluator.cc:736-830`).
  This choice changes the geometry of twisted and non-uniformly scaled
  extrusions and must be reproduced exactly in faceted mode.
- Caps: the bottom is the tessellated outline (reversed), the top is the
  transformed outline; omitted if a scale is 0.

### 7.8 `rotate_extrude`

READ [S] `RotateExtrudeNode.cc:45-100`, `GeometryEvaluator.cc:1160-1280`;
[M] `RotateExtrudeNode.cc:51-72`, `src/geometry/rotate_extrude.cc:78-160`.
MEASURED `tests/rex_*.scad`.

- The 2D children are unioned; the profile lives in the XZ half plane
  (`x` becomes the radius, `y` becomes `z`).
- The profile must not straddle the Y axis: [S] errors "all points for
  rotate_extrude() must have the same X coordinate sign" (MEASURED, no
  geometry); [M] errors when `min x < 0 < max x`. Profiles entirely at
  `x ≤ 0` are allowed and mirrored.
- `angle`: default 360; [S] clamps `angle ≤ -360` or `> 360` to 360 and
  treats `angle = 0` as empty.
- Fragment count, with `R = max(0, max x) - min(0, min x)` (the profile's reach from
  the axis): **[S]** `max(trunc(fragments(R)·|angle|/360), 1)`; **[M]**
  `ceil(ceil(max(3,$fn))·|angle|/360)` (or the `$fa/$fs` rule scaled by
  `angle/360`). MEASURED on [S]: `angle = 90, $fn = 10` → 2 sections (3
  rings); `angle = 45, $fn = 10` → 1; default `R = 6` → 19. [M] gives 3 and
  2 for the first two.
- **Start angle.** [S]: a full turn (angle 360, default or explicit) puts its
  rings at azimuths `180° + 360°·k/n` (it starts on **−X**, "for legacy
  support"); a partial turn starts on **+X** and sweeps counterclockwise for
  positive angles. MEASURED `$fn = 5`: azimuths `180, ±108, ±36`, also for an
  explicit `angle = 360`. [M] has a `start` parameter: without `angle` the
  default start is 180° (same as [S]) with a warning that this will change;
  with an explicit `angle` (also 360) the start is 0°. So an explicit
  `angle = 360` differs between [S] and [M].
- Side faces are triangulated quads between consecutive rings; partial turns
  get the tessellated profile as start and end caps.
- Profile vertices on the axis produce degenerate (zero-area) triangles;
  OpenSCAD does not merge them ([S] comment at l.1180).

### 7.9 Hull and Minkowski in 3D

READ [S] `src/geometry/cgal/cgalutils-applyops.cc:163-230` (`applyHull`),
`233-380` (`applyMinkowski`), `cgalutils-applyops-hybrid-minkowski.cc`
(fast-csg variant). MEASURED `tests/hull_spheres.scad`,
`tests/mink3d_cube_sphere.scad`.

- `hull()`: the convex hull (CGAL `convex_hull_3`, `Epick` kernel: double
  coordinates, exact predicates) of **all vertices** of all children
  (deduplicated). Fewer than 4 points gives nothing. The result is
  triangulated; coplanar and interior points disappear. It is therefore the
  exact hull of the faceted children.
- `minkowski()`: children are summed pairwise, left to right. Each operand
  that is not convex is split by CGAL's Nef `convex_decomposition_3`; for
  every pair of convex parts, the convex hull of all pairwise vertex sums is
  formed; the union of those hulls is the result (with a Nef fallback). Empty
  children are skipped; a single child passes through. MEASURED:
  `minkowski() { cube(10); sphere(1, $fn = 8); }` spans −0.92388..10.9239,
  because the faceted sphere reaches only `sin(67.5°) = 0.92388` in x, y, z.

### 7.10 `import()` and `surface()`

READ [S] `ImportNode.cc:60-230`, `SurfaceNode.cc:133-300`.

- `import(file, layer, convexity, origin, scale, width, height, center, dpi)`
  picks the reader by extension: `.stl .off .amf .3mf .nef3` (3D) and `.dxf
  .svg` (2D); [M] adds more (e.g. `.obj`). DXF/SVG curves (arcs, circles,
  Béziers) are tessellated with the current `$fn/$fa/$fs`. `scale`, `origin`,
  `center`, `dpi` (SVG, default 72) apply to 2D imports. The deprecated
  `import_stl/import_off/import_dxf` and `filename=`/`layername=` exist.
- `surface(file, center, invert, convexity)`: a text `.dat` matrix of heights
  or a PNG (luminance `0.2126 R + 0.7152 G + 0.0722 B`, scaled to 0..100,
  inverted if `invert`). Grid spacing is 1 in x (columns) and y (rows); every
  cell becomes four triangles meeting at a centre vertex with the mean of the
  four corner heights; the solid is closed down to `min height - 1`;
  `center` centres the grid in x and y. MEASURED `tiny.dat`: base at `z = -1`,
  volume 5.

## 8. Evaluation results and precision of the oracle

### 8.1 3D Booleans

[S] evaluates 3D union/difference/intersection with CGAL Nef polyhedra
(exact rational arithmetic, then converted to doubles for export), or with
`--enable=fast-csg` through CGAL corefinement ([S]
`cgalutils-corefine.cc`, `CGALHybridPolyhedron.cc`; not examined in detail). [M]
defaults to Manifold. The results are the exact Boolean of the faceted
operands up to the final double rounding (INFERRED for Manifold, which works
in doubles with symbolic perturbation).

### 8.2 Export precision (MEASURED)

- ASCII STL and OFF write coordinates with the default C++ stream precision,
  **6 significant digits** ([S] `src/io/export_off.cc:43`,
  `export_stl.cc:40-42`; ASCII STL also drops triangles that become
  degenerate at that precision).
- `--export-format=binstl` writes float32 (about 7 digits).
- On a 100 × 100 × 5 plate with 100 holes (`$fn = 32`) the exact faceted
  volume is 43757.10970 mm³. The OFF export (CGAL) measures 43757.08388
  (−2.6e-2), the OFF export (fast-csg) 43757.12951 (+2.0e-2), the binary STL
  (fast-csg) 43757.10842 (−1.3e-3, relative 3e-8, watertight, one
  component; measured with `scripts/r20/mesh.mjs`).
- `.csg` (the evaluated tree) and `.echo` also print 6 significant digits.

**Rule for baselines (INFERRED):** export references as `binstl` (3MF precision not examined),
never ASCII STL/OFF; state the float32
quantization (`≈ 6e-8 × coordinate magnitude`) as part of the comparison
tolerance, like `STL_FLOAT_MM` in `scripts/r20/acceptance.mjs`.

### 8.3 Speed (MEASURED)

The 100-hole plate took 15.1 s with the default CGAL Nef path and 1.35 s with
`--enable=fast-csg` on this machine. For a large corpus the oracle should run
with `--enable=fast-csg` on [S], or use a Manifold build. Both are only
oracles; their topology may differ from each other (the fast-csg export had
twice as many vertices), their volumes agree to the export precision.

## 9. Mapping to wonky

### 9.1 The two modes

- **faceted (literal)**: every OpenSCAD primitive becomes exactly the
  polyhedron (or polygon) OpenSCAD would build, with the vertex placement of
  section 7. All faces are planar, so the result is an exact planar B-rep and
  is directly comparable with the oracle's mesh (volume to about 1e-7
  relative, Hausdorff to the export quantization). This mode tests the
  interpreter, the planar and hybrid Booleans and the exporters against a
  very large body of real CSG trees.
- **intent (exact)**: circles, cylinders, cones, spheres and revolutions
  become exact analytic geometry (plane, cylinder, cone, sphere, torus
  carriers). The comparison with the oracle then needs a chord allowance per
  primitive (section 10.2). This is what Marc would print or export as STEP.

The interpreter, the node tree and the transform handling are shared; only
the **leaf lowering** and a few operations (hull, minkowski, offset, twist)
differ.

### 9.2 Constraint from AGENTS.md

"Geometry only in Bend" (AGENTS.md). The discretization *counts*
(`fragments`, slices, section counts) are language semantics and can be
computed by the JS interpreter. Solids, and every decision that depends on
geometry, belong in Bend.

Reconciled with design.md §4.5 and decision D1 after the review
([review.md](review.md) m3). The split is:

- **JS may compute** language-defined coordinates (the points of a circle
  n-gon, sphere rings, frustum and revolution rings from degree trig in
  binary64, exactly as a user's `polygon()` points computed with `cos()`)
  and **explicit, purely combinatorial face lists** (which ring index joins
  which).
- **Bend decides** everything that is a geometric predicate: the
  shorter-diagonal choice of twisted slices (section 7.7), outline
  refinement by longest edge, collinearity and planarity, the `resize()`
  bounding box, the heightmap centre vertices of `surface()`, and of course
  building, validating and Booleaning every solid.

The alternative is a Bend constructor per primitive from its parameters and
count (`circle r n`, `sphere r n`, `cylinder h r1 r2 n`, `rotate_extrude
profile n angle start`). Bit-identical vertices are not required either
way: Bend works in F32x2 (about 48 bits) while OpenSCAD works in binary64;
the difference (≈1e-14 relative) is far below the oracle's export
precision. The choice is Marc's (design.md D1).

### 9.3 Construct table

"New" marks a kernel capability wonky does not have today (READ:
`docs/FACTSHEET.md`, `docs/python-frontend.md`, `src/analytic.mjs`,
`src/kernel.mjs`, `docs/hybrid-boolean-plan.md`, `docs/revolve.md`).

| OpenSCAD construct | faceted mode | intent mode | refuse (capability error) when |
|---|---|---|---|
| language core (values, scopes, `$`-vars, functions, literals, comprehensions, recursion, `echo`, `assert`) | JS interpreter (like the FS and Python frontends) | same | never for valid programs; `object()` and experimental features by name until implemented |
| `include`/`use`, library path | JS, with provenance (section 5) | same | a library outside the declared roots, or a file whose hash changed against a pinned baseline |
| `rands` | mt19937 + libc++ distribution | same | unseeded: allowed but the run is marked non-reproducible |
| `square`, `polygon` (paths, even-odd) | exact planar polygon; even-odd sanitize in a **new** Bend 2D polygon module | same (straight edges are exact) | self-overlapping input the 2D module cannot resolve exactly |
| `circle` | regular `n`-gon, first vertex on +X | exact circle (sketch arc), **unless** the `n`-gon is intended (section 9.5) | never |
| `cube` | box prism (`extrudeInBend`) | same | never |
| `cylinder` (`r1 = r2`) | `n`-gon prism | exact cylinder (`circularFrustumInBend`) | never |
| `cylinder` (`r1 ≠ r2`, both > 0) | `n`-gon frustum (trapezoid/triangle sides) | exact frustum (`circularFrustumInBend`) | never |
| `cylinder` with a zero radius | `n`-gon pyramid (apex vertex) | cone with apex through `sweepInBend` (a triangle profile with an axis segment is admitted per `docs/revolve.md`; not run here) | never (the Python frontend's refusal of the apex applies to `circularFrustumInBend`, not to `sweep`) |
| `sphere` | ring polyhedron (section 7.3) | exact sphere: `sweepInBend` of a half disc (arc plus axis segment; per `docs/revolve.md`, not run here) | never |
| `polyhedron` | **new**: exact planar B-rep from indexed faces (each face planar within tolerance, else triangulated; closedness and orientation checked; a wrongly wound closed shell reoriented with a warning, as CGAL does inside CSG) | same (the mesh is the intent) | open shell, non-manifold edge, self-intersection: refuse by name (OpenSCAD itself fails or repairs unpredictably there) |
| `translate`, `rotate`, rigid `multmatrix` | vertices mapped (`transformAnalytic` / polygon-prism rigid copy) | `transformAnalytic` | never |
| `mirror`, reflecting `multmatrix` | push the reflection down to the leaves' defining points and reverse face order (no kernel reflection needed) | push down: a reflected circle/cylinder/sphere/torus is the same primitive with a reflected frame; profiles are mirrored in 2D | a leaf that is already an opaque B-rep (none in pure OpenSCAD) |
| `scale`, `resize`, general affine `multmatrix` | push down to leaf vertices (planarity is preserved by affine maps); `resize` from the faceted bounding box, exactly as OpenSCAD | push down: uniform scale scales radii; axis-aligned scale with `sx == sy` keeps a Z-axis cylinder/cone circular; `resize` from the exact bounding box (differs from OpenSCAD's faceted box by at most the chord allowance, INFERRED choice) | intent: any map that turns a circle into an ellipse or a sphere into an ellipsoid (non-uniform scale across a curved leaf, shear): refuse, "elliptic carriers not in Bend" (current Python frontend refuses all non-rigid maps, `src/python.mjs:64-74`) |
| `union`, `difference`, `intersection`, implicit unions, `intersection_for` | hybrid Boolean (corefine + recover, `docs/hybrid-boolean-plan.md`, subject to its production gate) on planar carriers; **not** the planar arrangement for large facet counts (it partitions a box by every supporting plane, `docs/planar-boolean.md`; one `$fn = 200` cylinder already brings 202 planes) | hybrid Boolean on analytic carriers | whatever the hybrid refuses (near-tangent contact, unresolved curve types): the refusal is reported, a certified-mesh result is labelled approximate |
| 2D `union/difference/intersection` | **new** Bend 2D polygon Boolean with Clipper-compatible results (non-zero fill, exact intersections; Clipper's integer snapping at `2^-(60-exp)` is below any tolerance) | lift to 3D where possible: `linear_extrude` and `rotate_extrude` distribute over 2D Booleans (`E(A ∖ B) = E(A) ∖ E(B)` for straight extrusions and for revolutions of profiles on one side of the axis), so the 2D CSG becomes 3D CSG of extruded exact leaves | intent: a 2D Boolean that is not under an extrusion (e.g. `projection` input or a 2D-only model) until an exact 2D line/arc Boolean exists |
| `offset(r)` | **new** 2D offset reproducing Clipper's join rules (section 7.6) | exact line/arc offset: round joins are arcs of radius `|r|` | intent: until an exact 2D offset with topology changes exists; faceted: never |
| `offset(delta)`, `chamfer` | new 2D offset (miter / square join) | exact (straight lines only for polygon input) | intent: input containing arcs until the 2D offset exists |
| `linear_extrude` straight | prism (`extrudeInBend`) of the polygon | extrusion of the line/arc profile (existing normal line/arc extrusion) | never |
| `linear_extrude` with uniform `scale` | 1 slice: planar trapezoid sides | tapered extrusion: planes plus cone carriers for circles (**new**, the Python frontend refuses `taper=`) | intent until tapered extrusion exists |
| `linear_extrude` with `twist` or non-uniform `scale` | triangulated slices exactly as section 7.7 (shorter diagonal rule) through the polyhedron constructor | none: helicoidal / non-planar ruled surfaces have no carrier in Bend | intent: always ("twisted extrusion needs helicoidal surfaces") |
| `rotate_extrude` | ring polyhedron with the version-specific count and start angle (section 7.8) | `sweepInBend` of the line/arc profile, full or partial angle (lines → planes/cones/cylinders, arcs → tori/spheres) | profile across the axis (OpenSCAD errors too: produce the same empty result plus the error); intent: the lemon-shaped spindle case refused by `sweep` (code 8) |
| `hull()` 2D | exact convex hull of all vertices | pattern lowering (section 9.4) | intent: patterns outside section 9.4 |
| `hull()` 3D | **new** exact 3D convex hull of the facet vertices (robust predicates) | pattern lowering (section 9.4) | intent: other patterns (a general convex hull of curved solids has no finite carrier set) |
| `minkowski()` 3D | convex ⊕ convex: hull of pairwise vertex sums (new hull op); non-convex operand: needs convex decomposition (**new**, large) | convex polytope ⊕ sphere/cylinder/circle: a "rounded polytope" (planes, cylinders, spheres), section 9.4 | faceted: non-convex operands until decomposition exists; intent: everything else |
| `minkowski()` 2D | new 2D Minkowski (Clipper construction + union) | polygon ⊕ circle = offset by `r` | as `offset` |
| `projection(cut = true)` | section of the faceted solid at `z = 0` | `section` (`kernel/section.bend`) plus cap construction (**new**) | intent until capping and nesting exist (`section` does not build caps, `docs/section.md`) |
| `projection(cut = false)` | union of projected triangles (new 2D Boolean) | silhouettes of analytic faces | intent: always for now (silhouettes of tilted cylinders/spheres are ellipses) |
| `text()` | none | none | always: needs FreeType, HarfBuzz and pinned font files, and Bézier curves in Bend (refuse "text() needs a font engine"; Marc's corpus has 0 uses) |
| `import()` STL/OFF/3MF/AMF | polyhedron constructor on the file's mesh (pinned by sha256) | same, labelled "mesh input: exact to its facets" | non-closed or self-intersecting meshes (name the defect); `.nef3` |
| `import()` DXF/SVG | tessellated with `$fn/$fa/$fs` as OpenSCAD does | lines exact, arcs exact, Béziers refused | intent: Bézier/spline entities; both: unsupported entity types by name |
| `surface()` | heightmap polyhedron (section 7.10) | same (no analytic intent) | never (after the file is pinned) |
| `color`, `render`, `%`, `#`, `!`, `*`, `convexity` | appearance metadata / tree pruning (section 6) | same | never |
| `roof()` (experimental), `$fe`, `object()`, Python engine ([M]) | not supported | not supported | always, by name |

### 9.4 Intent lowering of `hull()` and `minkowski()`

`hull(` occurs 280 times in 64 of Marc's 395 `.scad` files (MEASURED by
grep; the task statement counts 268) and has no general exact form. The
common patterns do have one (INFERRED, to be proven per pattern):

1. **Congruent round children at points**: `hull()` of translated copies of
   the same `circle(r)` or `sphere(r)` equals `Minkowski(hull(centres),
   disc/ball r)`: in 2D the convex polygon of the centres offset by `r`
   (lines and arcs), in 3D a rounded polytope (planes, cylinders along hull
   edges, spheres at hull vertices).
2. **Parallel cylinders spanning the same height**: `hull()` of cylinders
   with parallel axes and the same axial range equals the extrusion of the
   2D hull of their circles. Equal radii give pattern 1 in 2D; different radii
   give tangent lines between circles (closed form) and arcs.
3. **Polyhedral children** (cubes, polyhedra, prisms): the exact planar
   convex hull, as in faceted mode.
4. **Frusta and mixed round children** (cylinder plus sphere, different
   heights): cone and ruled patches; refuse initially.

`minkowski()` in intent mode: convex polytope ⊕ ball = rounded polytope
(pattern 1 in 3D); a Z-prism (e.g. `cube`) ⊕ a Z-cylinder = the extrusion
of the 2D polygon offset by `r`, over the summed height (the common
rounded-box idiom). A general polytope ⊕ cylinder has oblique elliptic
cylinder patches along non-vertical edges and refuses, as does everything
else.

Every recognized pattern is decided on the evaluated node tree (children
after transform push-down), recorded in the result ("hull lowered as
rounded polytope"), and verified against the faceted build (section 10.2).

### 9.5 When is a polygon intended?

OpenSCAD authors use `$fn` both for smoothness and for deliberate polygons
(hexagon nut traps with `$fn = 6`, octagonal pin holes). Marc's OpenLOCK
files contain `cylinder(..., r = 0.75, $fn = 8)` 52 times (MEASURED grep);
`$fn = 200` appears 337 times. Proposal (INFERRED, open question 2): intent
mode keeps a circle faceted when `$fn` is given explicitly and `n ≤ 8`
(configurable), and treats larger explicit `$fn` and every `$fa/$fs`-derived
count as a circle. The decision is recorded per leaf.

### 9.6 New kernel capabilities, by payoff for the corpus

INFERRED ordering from the corpus census (MEASURED grep over the 395 files in
`~/Workspace/cad`: `difference(` 672, `for` 504, `include <` 365, `echo(`
312, `mirror(` 206, `intersection(` 196, import of `.stl` 88 plus
`import(filename)` 40 (130 `import(` in total), `hull(` 280 in 64 files,
`linear_extrude` 33, `surface(` 15 (heightmaps under non-uniform `scale`),
`polyhedron` 13, `rotate_extrude` 8,
`offset(` 2, `minkowski`, `text(`, `projection`, `resize`, `multmatrix` 0,
`use <` 0):

1. polyhedral solid from indexed faces (polyhedron, import, surface,
   faceted primitives, twisted extrusions); feeds the hybrid Boolean;
2. transform push-down incl. reflections and affine maps (frontend only);
3. exact 3D convex hull (faceted hull, faceted minkowski of convex operands,
   intent pattern 3);
4. 2D polygon Boolean and offset (faceted 2D subsystem);
5. intent hull/minkowski patterns 1-2 (rounded boxes);
6. tapered extrusion, projection caps, exact 2D line/arc Boolean;
7. convex decomposition (general faceted minkowski).

## 10. Verification against OpenSCAD baselines

### 10.1 Language level

Run the model through OpenSCAD with `--render -o model.csg -o model.echo`
(MEASURED: both work in [S]; `.ast` also exists; without `--render` they are
evaluated with `$preview = true`, section 4.4). wonky's interpreter emits
the same node tree with `$preview = false`; compare structure exactly and
numbers parsed, within one unit of the 6th significant digit (the dump's
precision; oracle.md §7). Compare `ECHO:` lines verbatim (same number
formatter, section 3.4) and the set of `WARNING:`/`DEPRECATED:` messages.
This isolates interpreter bugs from kernel bugs and is cheap (no geometry).

### 10.2 Geometry level

- **faceted**: oracle `binstl` export vs. wonky's exact planar B-rep.
  Volume within `1e-7` relative plus the float32 term; bounding box and
  symmetric Hausdorff within `max(1e-4 mm, 1e-7 × extent)` (INFERRED from the
  measured 3e-8 relative volume error of the binary STL). Topology is not
  compared (CGAL, fast-csg and Manifold already disagree on vertex counts).
- **intent**: two hops (INFERRED). (a) wonky faceted vs. oracle, as above;
  (b) wonky intent vs. wonky faceted with a per-leaf allowance that the
  frontend knows exactly, because it knows every leaf's `r` and `n`:
  - a circle or cylinder of radius `r` with `n` fragments lies inside the
    exact circle, at most `r·(1 - cos(π/n))` away; its area is
    `n/(2π)·sin(2π/n)` of the disc (n = 30: 0.99271; n = 5: 0.757);
  - a sphere with `n` fragments and `rings = floor((n+1)/2)`: the caps are
    `r·(1 - cos(90°/rings))` below the poles, the equator bands
    `r·(1 - cos(π/n)·cos(90°/rings))` inside (INFERRED geometry; MEASURED
    volume ratio 0.98187 for `r = 10`, n = 30);
  - after a Boolean the allowance of a result face is the allowance of the
    leaf it came from (the hybrid's tags give that provenance); the
    Hausdorff check uses the maximum over the leaves that bound the result,
    and the volume check an interval from inscribed/circumscribed leaves
    (as in the R20 datums case). A faceted `rotate_extrude` is neither: it
    lies partly outside the exact solid, toward the axis (MEASURED review
    r03), so its per-leaf volume term must be the symmetric-difference
    volume, not the net deficit (oracle.md §6.1).
  Differences beyond the allowance are real bugs in one of the two paths.
- **Refusals** count separately: a construct from section 9.3's refusal
  column must refuse by name, never produce geometry, in either mode.

### 10.3 Oracle hygiene

- Run the oracle only on copies under `tmp/openscad/`, with a timeout, and
  with `$preview = false` semantics: geometry exports do this by themselves,
  `.csg`, `.echo` and `.ast` only with `--render` (MEASURED, section 4.4).
- Record `--info` (version, git hash, CGAL/Manifold, enabled features), the
  exact command line (`--enable=fast-csg`, `--export-format=binstl`,
  `-D` definitions), the input tree's hashes and the library path.
- Treat oracle warnings as part of the baseline: a model that warns in
  OpenSCAD must warn identically in wonky.

## 11. Open questions for Marc

1. Where do faceted vertex coordinates get computed: in the JS interpreter
   (it is part of OpenSCAD's language definition) or strictly in Bend (the
   conservative reading of "geometry only in Bend")? Section 9.2 now states
   the split both documents share (JS: language-defined coordinates and
   combinatorial face lists; Bend: every predicate and every solid); the
   decision is design.md D1.
2. The intent threshold for deliberate polygons (section 9.5): `n ≤ 8`
   explicit `$fn`, or a list of exceptions, or always ask?
3. Which dialect is the default target: the installed 2022.05 snapshot or
   current master? They differ in `$fn` rounding, `rotate_extrude` section
   counts and start angle, and some syntax.
4. May a newer OpenSCAD snapshot (Manifold backend) be installed as a second
   oracle? It should cut the oracle time further (fast-csg on [S] already
   gives 11x, section 8.3) and matches what current internet examples are
   written for.
5. Should `text()` stay refused permanently (it needs a font engine and
   pinned fonts), or is a pinned-font glyph path worth building later?
