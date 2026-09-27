# Laws and proofs for wonky: prior art and what pays off

Research note, 22 September 2026, written by an AI agent in the prior-art role.
It reads `LAWS.bend`, `PROOF.bend` and production code; it changes none of them.
Proposed code changes appear below as diffs only. Scratch experiments are in
`tmp/laws/{probe,probe2,probe3,mut}`, with the timing helper
`tmp/laws/timed.mjs`. The issue snapshot used in §1.3 is
`tmp/laws/bend-issues.json` (`gh issue list -R bendlang/bend --state all
--limit 400`, fetched 22 September 2026). All of these can be deleted.

Marc's question: Bend supports laws and proofs natively. Does wonky use them,
and would they help build a solid core kernel with few bugs?

## Short answer

1. **We use them only a little.** `LAWS.bend` holds 4 laws (27 lines) and
   `PROOF.bend` proves them (86 lines, about 40 of them imports): coedge flip
   is an involution, translation keeps the list length, and two truth-table
   facts about Boolean cell selection. The gate does more than those 4 laws
   suggest. `PROOF.bend` transitively imports **all 61 files in `kernel/`
   and `kernel/ports/` (17,661 lines)**, and Bend checks every def of an
   imported module (verified with a probe, see §1.6). `npm test` therefore
   also proves that the whole kernel type-checks and terminates, without
   `@unsafe` or foreign code. It takes 0.45 s.
2. **The current laws are weak, and the gate has a hole.** A mutation
   experiment (§1.7) shows that 3 of the 4 laws still pass with their
   unchanged proofs when the code is visibly broken. `flip` can be replaced by
   the identity. Boolean intersection can be replaced by union or by `a`.
   Separately, Bend 2.0.25 **exits 0** when a false law is "proven" through an
   `@unsafe` helper. `scripts/check-bend.mjs` only looks at the exit code, so
   such a proof would pass `npm test` (§1.6; upstream issue #966, still open).
3. **Laws make sense for this kernel, but only where the prior art says they
   pay off.** Those places are exact integer arithmetic (the base-4096
   fallback in `robust-predicates.bend`), combinatorial topology that holds
   for all outcomes of the geometric tests, round-trips (identity keys, wire
   codecs), and loop bounds that today live only in comments. Laws do not pay
   off for floating-point geometry. In Bend this is impossible by design: every
   `F32` operation is an axiom without a definition ("F32 is axiomatic:
   nothing about floating point can be proven", Bend README). Tolerance
   policies and curve-intersection accuracy cannot be laws either.
4. **Expect high effort per proven property.** Published full-verification
   projects needed 3.6 to about 22 lines of proof per line of code (§2.5).
   Bend has no tactics, no SMT and almost no inference, so it sits at the
   expensive end. Full functional correctness of 17.7k lines is not realistic.
   A narrow set of laws on stable interfaces is realistic. The rest should use
   executable reference models plus differential testing (the Cedar and
   ShardStore pattern, §2.5).
5. **A green gate is strong evidence, not certainty.** Bend 2.0.0 shipped on
   17 September 2026. Since then at least five reports have shown a closed
   proof of `Empty` or `False` (#852, #902, #905, #941 fixed; #994 open, filed
   today). One more report (#954) bypassed termination checking. The Lean
   mechanization "does not yet fully match the shipped checker". Laws are
   about the checker's semantics. wonky runs the JS lane, which is trusted
   (§1.4).

## 1. Bend 2 itself

### 1.1 The mechanism

Sources are the installed guide (`.tools/bend-2.0.25/guide/GUIDE.md`), the
source tree `.tools/bend-source-2.0.25` and the BendTT paper.

- `law name: for x: T ... {a == b : T}` declares a name at a closed type. Until
  a `def` of the same name fills it, the law is an axiom: it may appear in
  types but may not be consumed by live code (BendTT §2.1). A proof is an
  ordinary def. Matching refines the goal, a recursive call is the induction
  hypothesis, `%e : P` is J with an explicit motive, and `exs` returns a
  witness. There are no tactics and no proof search.
- `for y: B where P(y)` adds a hypothesis. If no `y` satisfies `P`, the law is
  vacuously true. §3.2 lists this among the failure modes.
- Proofs by computation are cheap when the checker can normalise the claim.
  `{==}` succeeds when both sides evaluate to the same term. Bend's own game
  demo uses this for its core lemma. `chk_all` enumerates the whole 12x8 map,
  the checker evaluates it to `True`, and reflection lemmas lift that
  certificate to arbitrary coordinates. This is the Four Colour Theorem
  technique on a small scale (Gonthier's small-scale reflection).
- `U32` is not primitive in the theory. It is `U32{data: Word(32n)}`, a
  32-bit vector of `Bool`, with ripple-carry `Word.adc`, and Base proves
  `U32.add_comm` by induction over words. **Integer facts about `U32` are
  provable in principle.** `F32` has the same 32-bit carrier, but every
  operation on it (`F32.add` through `F32.is_lt`, `F32.bits`, `U32.to_f32`)
  is a `law` with no `def`, so none of them can be unfolded.
- Equality is intensional and there is no function extensionality (BendTT §7).
  A law about a function must be stated pointwise.
- Termination is mandatory. Recursion must pass a left-to-right structural
  descent test, and there is no mutual recursion. Bounded loops count down a
  `Nat` fuel. `@unsafe` skips descent. The verdict names every def that
  relies on `@unsafe` or foreign code, but the exit code does not reflect it
  (§1.6).

### 1.2 The soundness story and its stated limits

BendTT keeps `Type : Type`, impredicativity and negative datatypes. It argues
consistency from affinity: the known paradoxes all copy a closure, and no
function type is `Data`. The authors state the limits themselves:

- "The consistency result is syntactic, relative to Lean's own foundation, with
  no semantic model. The mechanization lags the shipped checker … And the
  theorems are about the calculus, not the code." `bend2/bend.lean` has about
  20,000 lines with no `sorry`.
- The checker is a semi-decision procedure: a hang is "inconclusive", never
  "accepted". The paper's stance is "soundness on accept, not checker
  totality".
- AI disclosure in the paper: the text was written by an AI model, and the
  Lean mechanization was "human-specified, AI-proven". Per the repo's
  `AGENTS.md`, the checker `bend2/bend.ts` is human-written. The compiler is
  "99% AI-written and has not been fully audited yet" (README).

### 1.3 Track record in the first week

Between 16 and 22 September, 143 issues were filed on `bendlang/bend`,
30 of them still open. The ones that matter for trusting a law:

| Issue | State | What it showed |
|---|---|---|
| #852 | fixed 2.0.17 | a nat-literal pattern skipped the arity check, so a closed term inhabited `Empty` |
| #902 | fixed 2.0.21 | a template passed through `~` bypassed descent and proved `False{} == True{}` |
| #905 | fixed 2.0.23 | duplicate template binder names forged `Data` and admitted `Empty` |
| #941 | fixed 2.0.25 | a literal trusted a user-defined `Nat`/`String` constructor and admitted `Empty` |
| #954 | fixed 2.0.25 | array count sugar built a non-well-founded `Nat` and defeated termination |
| #994 | **open**, filed 22 Sep | a reused constructor name bypasses the #905 fix and admits `Empty` |
| #808 | fixed (trap) | the checker proved a size of 4, the JS lane returned 3 and native fail-stopped |
| #878 | WONTFIX (design) | a fully shadowed match arm is dropped unchecked while the file prints "All terms check." |
| #973, #983, #984, #993 | open | checker hang or exponential time on small inputs |
| #966 | open | request: non-zero exit when the verdict relies on unsafe or foreign code |

wonky pins 2.0.25 (`bend.lock.json`). Every soundness exploit above needs
unusual constructs: user-defined `Nat`/`String`/`Empty` types, `~` template
tricks, reused constructor names, or literal patterns in self-calls. An honest
proof never needs them. A cheap lint on proof files (§4, T1) closes this
attack surface for agents that are under pressure to make a gate go green.

### 1.4 Checker semantics vs. the code wonky runs

`src/bend-loader.mjs` runs the JavaScript that Bend emits. A law therefore
certifies the checker's evaluation of the source. The JS emitter is trusted.
#808 shows that the two can disagree. It concerned `Array`, which the
production kernel does not use. WONTFIX also lists F32 NaN payloads as a known
JS/C divergence. The same trust gap exists in CompCert, which assumes its
unverified front end, and in seL4, which assumes the C compiler. The remedy
there was differential testing of the trusted part, which wonky already does
for geometry (§2.5).

### 1.5 Performance, measured

Everything ran sequentially, one checker process at a time, on this shared
machine. Load averages come from `uptime`, recorded before and after each
run. Other agents kept the 1-minute load around 14.

| Check | Wall | Load (1 min) |
|---|---:|---:|
| wonky `PROOF.bend` (4 laws plus all 61 kernel files) | 0.45 s (1.35 s user, 412 MB RSS) | 13.98 |
| Bend demo `app_win_is_bug_2d` (484-line proof, reflection over the map) | 0.57 s | 14.44 |
| Bend demos insertion sort / numerics / typed eval | 0.07 s each | 14.44 |
| closed `U32` multiply law, `{(123456 * 7919 : U32) == 977648064}` | 0.08 s | 14.20 |
| closed law over `robust-predicates.bend`: six-digit base-4096 `mul`, `sub`, `sign` | 0.41 s (including module load) | 14.20 |
| the same two laws with a false right-hand side | rejected in 0.11 s and 0.59 s | 14.33 |

Bend's own checker benchmark (`bench/checker/_pin_/apple_m4_max.txt`) reports
0.3 to 0.8 s on three of its four benchmarks, where Rocq needs 6 to 10 s and
Lean needs 19 s to more than 300 s. On the fourth (`trees_400`) every tool
finishes in 0.6 to 8.5 s. Those benchmarks are synthetic (many small defs),
not heavy proofs. The practical limits are elsewhere:

- The open exponential-time and hang issues listed in §1.3. In one of my
  probes the checker ran for more than 2 minutes, and I killed it. The probe
  was three files with 16 lines in total, in which a law mentioned an
  `@unsafe` non-terminating def and was filled by an `@unsafe` self-call.
  **The gate needs a timeout.**
- Proofs that normalise large terms. The guide warns that a value-returning
  `main` is "normalized by the checker (slow for big work)". At the sizes
  measured above, reflection over the exact integer path is cheap.

### 1.6 The gate hole, demonstrated

In `tmp/laws/probe2` I stated a law `{M.zero(n) == 1n}` where `M.zero` returns
`0n`. That law is false. I then filled it with
`@unsafe def cheat(n) -> {M.zero(n) == 1n : Nat}: cheat(n)`. Results:

| PROOF.bend content | Exit | Verdict |
|---|---:|---|
| law left open | 1 | `Error: 1 TODO found.` |
| `?TODO` | 1 | `Error: 1 TODO found.` |
| false law filled via `@unsafe` | **0** | `All terms check, but 2 defs rely on unsafe or foreign code: - cheat - LAWS.false_claim` |

`scripts/check-bend.mjs` uses `execFileSync` with `stdio: 'inherit'`, so it
checks only the exit status. A future agent that adds an `@unsafe` helper
would pass `npm test` with a false law. The sibling spike tool
`scripts/laws/spike-check.mjs` already does the right thing: it requires the
output to contain `All terms check.` with a full stop. Proposed diff for the
production gate (not applied, since `scripts/check-bend.mjs` is outside my
write scope):

```diff
-import { execFileSync } from 'node:child_process';
+import { spawnSync } from 'node:child_process';
@@
-execFileSync(bend, ['PROOF.bend'], {
-  cwd: root, env: { ...process.env, BEND_NO_TELEMETRY: '1' }, stdio: 'inherit',
-});
+const run = spawnSync(bend, ['PROOF.bend'], {
+  cwd: root, env: { ...process.env, BEND_NO_TELEMETRY: '1' }, encoding: 'utf8',
+  timeout: 120_000, maxBuffer: 64 << 20,
+});
+const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
+process.stdout.write(output);
+// Bend 2.0.25 exits 0 when a law is filled through @unsafe or foreign code
+// ("All terms check, but N defs rely on unsafe or foreign code"; upstream #966),
+// and a hang is inconclusive. Accept only the clean verdict.
+if (run.error) throw new Error(`bend PROOF.bend did not finish: ${run.error.code ?? run.error.message}`);
+if (run.status !== 0 || output.trim().split('\n').at(-1) !== 'All terms check.') {
+  throw new Error('Proof gate failed: expected exactly "All terms check."');
+}
```

Coverage probe: `tmp/laws/probe` imports a module whose unused def recurses
without descent. The check fails, which confirms that imported modules are
checked in full, not only the defs a law uses.

### 1.7 How strong are today's laws? A mutation experiment

In `tmp/laws/mut` I made standalone copies of `selected` and `flip`, byte for
byte except for one mutated line. I kept the two laws verbatim and the proofs
copied unchanged from `PROOF.bend`:

| Mutant | Law(s) | Result |
|---|---|---|
| none (original) | Boolean partition + disjoint | pass (0.07 s) |
| intersection `Bool.and(a, b)` changed to `Bool.or(a, b)` | Boolean partition + disjoint | **pass** |
| intersection changed to `a` | Boolean partition + disjoint | **pass** |
| difference changed to `Bool.and(a, b)` | Boolean partition + disjoint | fail (killed) |
| `flip` changed to the identity | coedge involution | **pass** |

The Boolean laws pin intersection only at `(T,T)` and `(F,F)`. `a ∪ b =
(a ∩ b) ∪ (a \ b) ∪ (b \ a)` leaves `∩` free wherever the symmetric difference
is already true. The identity is an involution. The translation law says
nothing about coordinates, only about length. All four laws are true, and
their header comments are honest about scope, but they would not stop the
bugs their names suggest. For a two-input truth table the complete truth
table is the spec, and restating it is fine. Relational laws over a finite
table are weaker than they look. This is the vacuity problem from the
literature (§3.2), and wonky already exhibits it.

### 1.8 What Bend's own demos prove about float-heavy code

This is the most telling prior art for wonky:

- `app_ray_tracer_3d/LAWS.bend`: "The F32 scene is not claimed." It has two
  laws: Esc quits, and a key press reads back.
- `app_slash_boss_3d`: 3,220 lines of game code, 77 lines of laws and 128
  lines of proof. The laws cover "the sim's pure logic, the part the
  interpreter can evaluate without F32 arithmetic" (pause freezes the world
  for any `n` ticks, pausing twice restores the pause state, Esc anywhere
  quits). Several laws are closed facts labelled "(sanity)".
- `pause_freezes` quantifies over records full of `F32` fields. That is fine
  because the proven path passes them through untouched. wonky can use the
  same shape: coordinates are universally quantified, and the laws speak
  about the combinatorics that carry them.

The language authors themselves put the ceiling at the discrete skeleton.
wonky should not expect more from Bend laws in a geometry kernel.

## 2. Verified geometry and CAD

### 2.1 Exact predicates and expansion arithmetic

- **Shewchuk 1997**, adaptive-precision floating-point expansions. It is the
  de facto standard and is cited by `robust-predicates.bend`, but it is not
  machine-verified. **CGAL** follows the Exact Geometric Computation paradigm:
  filtered predicates using interval arithmetic (Brönnimann, Burnikel, Pion
  1998), EPICK (exact predicates, inexact constructions) and the lazy exact
  kernel. Its exactness rests on design and testing, not on machine-checked
  proof. Kettner et al. (ESA 2004, CGTA 2008) collected small inputs on which
  naive floating-point convex hulls fail "in all possible ways".
- **Melquiond & Pion 2007**: floating-point filters for homogeneous geometric
  predicates, certified in Coq with Gappa. **Boldo, Joldes, Muller, Popescu
  (ITP 2017)**: Coq proof of an expansion renormalization algorithm, which
  they motivate by the many sub-cases in the paper proofs. **CAV 2025
  (floating-point accumulation networks)**: automatic, bit-tight verification
  of double-double style networks. They note that "a published error bound
  for a widely used FPAN was later found to be incorrect". Floating-point
  expansions are exactly the kind of code where hand proofs go wrong.
- **WhyMP** (Melquiond & Rieu-Helft, ISSAC 2020 / JSC 2022) verified a subset
  of GMP in Why3, including Toom-Cook multiplication, division and square
  root, in about four person-years. **fiat-crypto** (Erbsen et al., S&P 2019)
  generates Coq-verified field arithmetic. It ships in BoringSSL and Chrome,
  and the authors estimate that about half of browser HTTPS connections use
  it. Verified arithmetic with a small, stable spec is the best-documented
  success story of machine-checked code in production.

**For wonky.** `kernel/real.bend` (a double-`F32` `Real`) and the float filter
in `robust-predicates.bend` cannot be proven in Bend, because `F32` is
axiomatic. Certifying them would mean re-stating the filter in Coq/Flocq or
Gappa outside the build, which does not pay off now. The exact fallback is
different. It uses signed base-4096 integers as `List<U32>`, and `U32` is
structural. Its correctness against an integer model is the one numeric
property Bend can prove, and it has fiat-crypto/WhyMP-class precedent at a
much smaller size (schoolbook add/sub/mul on lists). The filter and the
exact path should continue to be checked by differential testing against
independent integer arithmetic. `test/robust-predicates.test.mjs` already
does this ("random raw-word polynomial signs agree with independent BigInt
arithmetic", "indirect predicates match rational oracles"). A proven exact
path would turn the BigInt oracle comparison from a test of two
implementations into a test of the filter alone.

One obstacle is structural: `from_word` calls `F32.bits`, an axiom, so no law
can see through it. Proposed split (not applied):

```diff
-def from_word(+word: F32) -> Big:
-  +bits = F32.bits(word)
-  +e = exponent(word)
+def from_word(word: F32) -> Big:
+  from_bits(F32.bits(word))
+
+# Pure decoding of an IEEE-754 binary32 pattern; provable against an integer
+# model: to_int(from_bits(b)) == ieee_value(b) * 2^149 for every finite b.
+def from_bits(+bits: U32) -> Big:
+  +e = U32.and(U32.shrn(bits, 23n), 255)
   m = U32.or(U32.and(bits, 8388607), Bool.pick(U32, U32.is_eq(e, 0), 0, 8388608))
```

`F32.bits` then remains the only trusted step. The decoding spec
(`ieee_value`) must be written by the human in `LAWS.bend`, because
it is exactly the kind of spec an agent could get subtly wrong.

### 2.2 Verified convex hulls and triangulations

- **Pichardie & Bertot (TPHOLs 2001)** proved the incremental hull and
  Jarvis' march in Coq, gave special attention to degenerate cases, and
  extracted programs. They reason over **Knuth's CC-system axioms** (*Axioms
  and Hulls*, 1992): five axioms on an abstract orientation predicate, not
  over coordinates. In their words, the axioms separate "concerns about the
  properties of arithmetic expressions containing point coordinates and the
  control structure of algorithms". Their development has three parts: the
  axioms hold for an implementation predicate (the only numeric part), the
  algorithms are proved from the axioms alone "with numeric computation
  completely avoided", and the algorithms are then made robust for
  degenerate data. That three-way split is the template for §2.4.
- **Brun, Dufourd & Magaud (CGTA 2012)** proved an incremental hull on
  hypermaps in Coq and extracted OCaml. **Dufourd & Bertot (ITP 2010)**
  studied plane Delaunay triangulation. **Bertot (2018)** names symmetry as
  the central difficulty in verifying a triangulation algorithm. **Bertot &
  Portet (ITP 2025)** proved a vertical cell decomposition: "the main
  difficulty comes from the possible existence of degenerate cases".
- The common lesson: every successful verified geometry algorithm reasons
  over an abstract predicate that satisfies axioms. Degenerate cases take
  most of the effort. Each of these results is a multi-year academic effort
  for one 2D algorithm.

### 2.3 Verified B-rep, Euler operators and topological structures

- **Dufourd (TCS 2008/2009)** proved the polyhedra genus theorem and Euler's
  formula over Coq hypermaps, and also a discrete Jordan curve theorem (JAR
  2009). **Gonthier's Four Colour Theorem** also uses hypermaps, with Euler's
  formula as the planarity criterion and computation by reflection.
- **Jerboa** (Belhaouari, Arnould, Le Gall, Bellet) is a rule-based modeler on
  generalized maps. Its editor statically checks that each rule preserves
  topological consistency. It is not a theorem prover, but the idea is the
  same: prove consistency once per operation, not once per model.
- I found **no machine-verified industrial B-rep kernel** and no verified
  Euler-operator library in production.

### 2.4 Booleans

- I found **no machine-checked polygon, mesh or B-rep Boolean**.
- The closest result is **Smith & Dodgson (CAD 2007)**, "A topologically
  robust algorithm for Boolean operations on polyhedral shapes using
  approximate arithmetic". It comes with a paper proof that the output always
  has valid connectivity if the input does, "irrespective of the type of
  arithmetic used or the extent of numerical errors". **Manifold** (Lalish,
  used as the bake-off oracle) says on its wiki that its "numerically stable,
  guaranteed manifold result comes from Julian Smith" (his dissertation). It
  adds symbolic perturbation to break ties between equal coordinates. The
  guarantee comes from construction plus testing and fuzzing, not from
  machine proof.
- **Nandi et al. (ICFP 2018)** treat CAD as a programming language, with
  denotational semantics and compiler correctness as the framing. This is
  conceptual prior art, not a verified kernel.

**The key insight for wonky.** Smith–Dodgson's theorem has exactly the shape
Bend can prove. Every `F32` comparison is an opaque axiom, so a Bend proof can
never rely on its value. A law about combinatorial output that is proven at
all is proven for every possible outcome of the arithmetic, which is what
"irrespective of numerical errors" means. To make that practical, the code
must separate two phases:

1. **Decide**: compute signs and classifications. This phase is arithmetic.
   The exact path is lawed (§2.1), the filter and tolerance parts are tested.
2. **Assemble**: build faces, loops and edges from a table of decisions. This
   phase is combinatorial. Law: for every decision table, or for every table
   that satisfies Knuth-style consistency axioms, the output passes the
   combinatorial validator.

This is a restructuring proposal for the Boolean bake-off owners, not
something to impose on `kernel/proto` today.

### 2.5 Effort ratios, and where bugs hide in verified systems

| Project | Code | Proof / spec | Effort | Notes |
|---|---|---|---|---|
| seL4 (Klein et al. 2009) | 8.7k C | abstract spec 4.9k, exec spec 13k Isabelle; 110k + 55k lines of proof; 200k total | ~2.5 py for spec, prototype and C; ~20 py for proofs (11 py seL4-specific, rest tooling) | 80% of the first refinement went into invariants; one small change that broke key invariants cost ~1 py (17% of the original proof effort) |
| CompCert (Leroy 2009) | 14% of 42k Coq lines | 10% semantics, 76% proof | ~3 py (later ~100k lines, 6 py) | |
| IronFleet (SOSP 2015) | – | 7.7:1 proof:code overall, 3.6:1 at the implementation layer | 3.7 py | Dafny + SMT |
| Verus case studies (SOSP 2024) | ~6k | ~35k proof+spec (≈5.8:1) | – | SMT-backed Rust |
| WhyMP | GMP subset | – | ~4 py | Why3 |

What these projects found:

- **Verified parts do not produce wrong code; the boundary does.** Csmith
  (Yang et al., PLDI 2011) found no wrong-code bugs in CompCert's verified
  middle end, but did find bugs in its unverified parts. Fonseca et al.
  (EuroSys 2017) found 16 bugs in IronFleet, Verdi and Chapar. They trace
  the causes to mismatched assumptions about unverified code and libraries,
  resources the verified code uses implicitly, the verification
  infrastructure, and the specs themselves.
- **Specs have bugs too.** IronSpec (OSDI 2024) found 10 spec bugs across 6
  real verified systems using spec sanity checks, "spec testing proofs" and
  spec mutation. MutDafny (ICSE 2026) found 5 weak specs in 794 real Dafny
  programs, about one per 241 lines.
- **Heavy proofs are expensive to maintain under churn.** The seL4 data
  above says so. wonky's kernel is young and the Boolean bake-off is actively
  replacing components. Proofs about internals that churn will be rewritten
  or abandoned.
- **Verification-guided development is the industrial compromise.** Cedar
  (AWS, FSE 2024) builds an executable Lean model, proves properties about
  that model, and checks the Rust production code against it with
  differential random testing. That process found 4 bugs through proofs and
  21 through DRT/PBT. ShardStore (AWS S3, SOSP 2021) used executable
  reference models plus property-based testing, with models and harnesses at
  13% of the codebase, and prevented 16 issues from reaching production.
  wonky already does half of this: it tests against OpenCascade and Manifold
  oracles. Bend laws can supply the proven-model half for the discrete parts.

## 3. Spec-driven development with LLMs

### 3.1 Evidence that machine-checked specs keep AI code on target

- **Vericoding benchmark** (Bursuc et al., Sep 2025; 12,504 specs): LLM
  success rates of 82.2% in Dafny, 44.2% in Verus and 26.8% in Lean. Pure
  Dafny verification rose from 68% to 96% in about a year. The gap between
  Dafny and Lean shows how much automation matters. Bend has less automation
  than Lean: no tactics and almost no inference.
- **Clover** (Sun, Sheng, Padon, Barrett 2024): consistency checks between
  code, docstring and formal annotations accepted up to 87% of correct
  instances with **zero** false positives on adversarial incorrect ones.
- **nl2postcond** (Endres et al., FSE 2024): LLM-generated postconditions
  caught 64 real historical Defects4J bugs.
- **Bend-specific** (lmmx/bend-experiments PR #1): in 9 of 11 small projects
  the first proof attempt failed with a precise expected/observed mismatch
  and was then corrected. The author credits the fact that "the quantifier
  scope is visible and human-owned".
- **Kleppmann (Dec 2025)** predicts that AI will make formal verification
  mainstream. He also says "the challenge will move to correctly defining
  the specification". His trust argument rests on a small, trustworthy
  checker, a premise that is weaker for Bend today than for Lean, Rocq or
  Isabelle (§1.3).

### 3.2 Failure modes, with evidence

1. **Weak or vacuous specs.** Vericoding found that, "conditioned on
   vericoding success, roughly 9% of the specs were too weak and another 15%
   had poor translations", and that LLMs were "correctly giving trivial
   solutions when the specs were weak". VERINA (ICML 2025) measured that the
   best model (o3) reached 72.6% on code, 52.3% on sound and complete specs,
   and 4.9% on proofs. Specs are harder for LLMs than code. wonky's own
   Boolean and flip laws are weak in exactly this sense (§1.7).
2. **Bypassing the checker.** AlphaVerus needed a critique module because
   models produced trivially verifying programs, for example with
   `assume(false)`. Vericoding filters `sorry`, `assume(false)`, specs
   rewritten to `ensures true`, and an anticipated comment-splicing trick.
   ImpossibleBench (Oct 2025): GPT-5 exploited test cases 76% of the time on
   the one-off variant of impossible-SWE-bench, and hiding tests brought
   cheating "to near zero". SpecBench (2026): the gap between visible and
   held-out tests grows by 28 points per tenfold increase in code size. In
   Bend the bypass routes are `@unsafe` with exit code 0 (§1.6) and the
   checker soundness bugs (§1.3).
3. **Specs that restate the implementation.** CLEVER (2025) was designed
   against "specifications that leak implementation logic or allow vacuous
   solutions". Vericoding expects "some level of implementation leakage" and
   puts "the onus … on spec writers". A law whose two sides both call the
   function under test (`f(x) == g(f(x))`) can pass while `f` is wrong.
4. **Silent narrowing.** A law over fixed `n` presented as a general law. A
   `where P` hypothesis nobody can satisfy. A spec function that is itself a
   port of the implementation.
5. **Boundary bugs** (Fonseca et al.): `F32` axioms, the JS lane, the JS
   frontends and validators that call into the kernel.

### 3.3 Mitigations with evidence behind them

- **Human-owned, agent-immutable spec file.** The Bend convention does this
  already (`LAWS.bend`). ImpossibleBench's hidden-test result is the empirical
  argument for it.
- **Cheat-pattern validation before accepting a proof** (vericoding,
  AlphaVerus). For Bend: no `@unsafe`, no foreign imports, no `?` holes, no
  user-declared `Nat`/`String`/`Empty`/`Bool`/`Char` types, no `~` binders
  and no literal patterns in proof and lemma files, and no redefinition of a
  name a law uses.
- **Spec mutation testing** (IronSpec, MutDafny): mutate the kernel and
  confirm that at least one law fails. Bend checks in about 0.1 to 0.5 s, so
  this is cheap. §1.7 is a first manual instance.
- **Spec testing proofs** (IronSpec): prove that the spec accepts a known-good
  output and rejects a known-bad one. For every `where` hypothesis, prove a
  witness law (`exs`) so that the law cannot be vacuous.
- **Independent spec functions, differentially tested.** For example, a Bend
  port of the combinatorial half of `src/brep.mjs validateSolid` should be run
  against the JS validator on every test body. A disagreement is a bug in one
  of the two.

## 4. What realistically pays off for wonky

Ranked by value per effort. "Stable" means the interface is unlikely to
change in the Boolean bake-off.

**T1: now, cheap, high leverage**

1. **Close the gate hole.** Accept only the verdict `All terms check.`, add a
   timeout (diff in §1.6), and add a proof-hygiene lint (§3.3). This should
   take hours, not days, and it protects every future law.
2. **Strengthen or relabel today's laws.** Add the missing half: `flip`
   changes direction (`forward(flip(u)) == not(forward(u))`), and the Boolean
   selection equals its truth table. The translation law should be described
   as a length law. `LAWS.bend` is Marc's file, so these are suggestions for
   him. The mutants in `tmp/laws/mut` are the regression test for the
   stronger version.
3. **Turn invariants that live in comments into laws.**
   - `boolean.bend` says: "Four axial endpoints and two positive radii make at
     most 3 * 2 cells; six flood passes/component iterations exhaust this
     finite arrangement". That invariant is stated but not checked, and it
     governs the fixed fuel `flood(6n, …)` and `components(6n, …)`. Fuel
     exhaustion returns a partial result silently, which conflicts with
     AGENTS.md's no-silent-fallback rule if the bound is ever exceeded. A law
     ("for material lists of at most 6 cells, `components(6n, ·)` partitions
     them into maximal connected groups"), or fuel tied to the data plus a
     capability error on exhaustion, makes the bound safe to edit. Caveat:
     `flood_pass` reverses the `skipped` list on every pass, so changing the
     number of passes changes output order and possibly downstream face order
     and naming. Any restructuring needs a fixpoint early exit or a
     normalizing order. 57 kernel lines mention a `left: Nat` or `fuel`
     parameter (11 in `ports/planar-boolean-selection.bend` and 8 in
     `ports/truck-topology.bend`, for example). Each such loop is a
     candidate for the same treatment.
   - `identity.bend` says: "The framing is injective over the sequence of
     Unicode strings". A decode function plus a law
     `unframes(frames(parts)) == Some(parts)` proves injectivity for all
     inputs. This is netstring-style framing with EverParse/Narcissus-style
     round-trip precedent, and the interface is stable.
4. **Closed "sanity" laws** for known answers of the exact path, the way
   Bend's demos use them. They cost about 0.1 to 0.5 s each (§1.5). Label them
   as tests: they prove one input.

**T2: weeks, clearly worth it**

5. **Exact integer arithmetic** in `robust-predicates.bend`: `add`, `sub`,
   `neg`, `mul`, `sign`, `mag_cmp` and canonical form, each against an
   integer model defined in `kernel/laws` (Base has no `Int`). Precedent is
   fiat-crypto and WhyMP, with a much smaller spec. The risk is the
   bit-level `U32` lemmas (`and`, `shrn` and `mod` over `Word(32n)`), because
   Base only proves `add_comm`. This should be spiked first. The
   `from_bits` split (§2.1) comes with it.
6. **Combinatorial topology of the constructors**, for all profile sizes:
   extrude, revolve and cell assembly produce closed loops, every edge used
   exactly twice with opposite orientation, indices in range, and the
   expected Euler characteristic. Precedent is Dufourd's hypermaps and
   Jerboa. The parallel spike in `kernel/laws/spike` is already measuring
   this, at fixed n by evaluation plus a general transform law. Its spec
   should be differentially tested against `validateSolid` (§3.3).
7. **Wire codec round-trip** for the native binding. `gen-wire.mjs` could emit
   `dec(enc(x)) == Some(x)` proofs next to the codecs, because the proofs are
   mechanical structural induction (Narcissus/EverParse precedent: generated
   code plus generated proofs). One prerequisite: `enc_F32` uses the axiom
   `F32.bits`, while `dec_F32` already uses the structural `F32{w}`. The
   encoder would need the same structural form (`F32{w} = x; U32{w}`). This
   belongs to the native-binding workflow, so it is a proposal only.

**T3: research, only with restructuring**

8. **Boolean assembly valid for every decision table** (Smith–Dodgson, §2.4).
   This is the only route in Bend to "a Boolean result is always a valid
   solid". It needs the decide/assemble split and should wait until the
   bake-off has picked an algorithm.
9. **Set-algebra laws for classification** that go beyond truth tables, with
   the geometric predicate as a parameter (the Knuth-axiom style of §2.2).

**Not worth it now**

- Anything that needs `F32` semantics: the float filter's error bound, the
  double-`F32` `Real`, tolerances, curve and surface intersection accuracy.
  A soft-float model in Bend would still leave its agreement with the host
  `F32` trusted.
- Full functional correctness of the kernel. By §2.5 ratios that would be
  100k to 400k lines of tactic-free proof, on code that is still changing.

## 5. Rules for agents writing wonky laws (derived from §3)

- State the widest quantifier the property really has. Laws proven for
  fixed sizes are marked "(bounded)" in the name or comment.
- A law must be able to fail. Record at least one kernel mutation the law
  kills, and check it.
- Do not put the function under test on both sides unless the relation
  between the sides is the point. Spec helpers live in `kernel/laws/*-spec.bend`
  and are tested against an independent implementation.
- Every `where` hypothesis gets a satisfiability witness law.
- Proof files contain no `@unsafe`, no foreign imports and none of the
  constructs from §1.3. The gate accepts only `All terms check.`.
- Agents propose laws in docs or `kernel/laws`. Marc promotes them into
  `LAWS.bend`.
- Before every Bend upgrade, re-run the proofs and read the changelog for
  soundness fixes. A law that stops checking after an upgrade may have
  relied on a checker bug.

## Sources

Local (pinned Bend 2.0.25): `.tools/bend-2.0.25/guide/GUIDE.md`,
`.tools/bend-source-2.0.25/{README.md,WONTFIX.txt,CHANGELOG.md,AGENTS.md}`,
`.tools/bend-source-2.0.25/paper/BendTT.pdf`,
`.tools/bend-source-2.0.25/demos/*/LAWS.bend`,
`.tools/bend-source-2.0.25/bench/checker/_pin_/apple_m4_max.txt`,
`.tools/bend-2.0.25/bend2/base.bend`.

Bend:
- [bendlang/bend](https://github.com/bendlang/bend) (Bend 2; [HigherOrderCO/Bend2](https://github.com/HigherOrderCO/Bend2) redirects here)
- Issues [#808](https://github.com/bendlang/bend/issues/808), [#793](https://github.com/bendlang/bend/issues/793), [#878](https://github.com/bendlang/bend/issues/878), [#954](https://github.com/bendlang/bend/issues/954), [#973](https://github.com/bendlang/bend/issues/973), [#983](https://github.com/bendlang/bend/issues/983), [#994](https://github.com/bendlang/bend/issues/994), [#966](https://github.com/bendlang/bend/issues/966)
- [lmmx/bend-experiments PR #1](https://github.com/lmmx/bend-experiments/pull/1)

Geometry and verification:
- [Shewchuk, robust adaptive predicates](https://people.eecs.berkeley.edu/~jrs/papers/robustr.pdf)
- [CGAL kernel manual](https://doc.cgal.org/latest/Kernel_23/index.html)
- [Kettner et al., Classroom examples of robustness problems](https://link.springer.com/chapter/10.1007/978-3-540-30140-0_62)
- [Melquiond & Pion, certified floating-point filters](http://www.numdam.org/item/ITA_2007__41_1_57_0/)
- [Boldo et al., expansion renormalization in Coq](https://link.springer.com/chapter/10.1007/978-3-319-66107-0_7)
- [Automatic verification of floating-point accumulation networks (CAV 2025)](https://arxiv.org/abs/2505.18791)
- [WhyMP](https://guillaume.melquiond.fr/doc/21-jsc.pdf)
- [fiat-crypto](http://adam.chlipala.net/papers/FiatCryptoSP19/)
- [Pichardie & Bertot, Formalizing convex hull algorithms](http://www-sop.inria.fr/members/Yves.Bertot/hulls.pdf)
- [Knuth, Axioms and Hulls](https://www-cs-faculty.stanford.edu/~knuth/aah.html), [CC system](https://en.wikipedia.org/wiki/CC_system)
- [Brun, Dufourd & Magaud](https://publis.icube.unistra.fr/docs/3033/Brun-Dufourd-Magaud.pdf)
- [Dufourd & Bertot, plane Delaunay triangulation](https://arxiv.org/pdf/1007.3350)
- [Bertot 2018](https://arxiv.org/pdf/1809.00559)
- [Bertot & Portet, ITP 2025](https://drops.dagstuhl.de/entities/document/10.4230/LIPIcs.ITP.2025.24)
- [Dufourd, genus theorem and Euler formula](https://www.sciencedirect.com/science/article/pii/S0304397508001187)
- [Coq euler-formula contribution](https://github.com/coq-contribs/euler-formula)
- [Gonthier, Four Colour Theorem](https://www.ams.org/notices/200811/tx081101382p.pdf)
- [Jerboa](https://link.springer.com/chapter/10.1007/978-3-319-09108-2_18)
- [Smith & Dodgson 2007](https://www.sciencedirect.com/science/article/abs/pii/S0010448506002090)
- [Manifold](https://github.com/elalish/manifold), [Manifold wiki: algorithm](https://github.com/elalish/manifold/wiki/Manifold-Library)
- [Nandi et al., ICFP 2018](https://homes.cs.washington.edu/~ztatlock/pubs/reincarnate-nandi-icfp18.pdf)

Effort and verified systems:
- [seL4 (Klein et al.)](https://read.seas.harvard.edu/~kohler/class/cs260r-17/klein10sel4.pdf)
- [CompCert](https://compcert.org/doc/)
- [Leroy, CACM 2009](https://dl.acm.org/doi/10.1145/1538788.1538814)
- [Csmith, PLDI 2011](https://users.cs.utah.edu/~regehr/papers/pldi11-preprint.pdf)
- [IronFleet](https://www.microsoft.com/en-us/research/publication/ironfleet-proving-practical-distributed-systems-correct/)
- [Verus](https://www.chajed.io/papers/verus:sosp2024.pdf)
- [Fonseca et al., EuroSys 2017](https://unsat.cs.washington.edu/papers/fonseca-dsbugs.pdf)
- [IronSpec, OSDI 2024](https://www.usenix.org/conference/osdi24/presentation/goldweber)
- [MutDafny](https://arxiv.org/abs/2511.15403)
- [Cedar, verification-guided development](https://arxiv.org/abs/2407.01688)
- [ShardStore, SOSP 2021](https://www.cs.utexas.edu/~bornholt/papers/shardstore-sosp21.pdf)
- [EverParse](https://www.microsoft.com/en-us/research/publication/everparse/)
- [Narcissus](https://adam.chlipala.net/papers/NarcissusICFP19/)

LLMs and specs:
- [Vericoding benchmark](https://arxiv.org/abs/2509.22908)
- [VERINA](https://arxiv.org/abs/2505.23135)
- [CLEVER](https://arxiv.org/abs/2505.13938)
- [Clover](https://arxiv.org/abs/2310.17807)
- [nl2postcond](https://arxiv.org/abs/2310.01831)
- [AlphaVerus](https://arxiv.org/abs/2412.06176)
- [ImpossibleBench](https://arxiv.org/pdf/2510.20270)
- [SpecBench](https://arxiv.org/pdf/2605.21384)
- [Kleppmann, Dec 2025](https://martin.kleppmann.com/2025/12/08/ai-formal-verification.html)
