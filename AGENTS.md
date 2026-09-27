# Wonky Kernel

- Modeling input is unmodified Onshape FeatureScript syntax. Extend the parser/interpreter; do not translate fixtures into a different user language.
- The geometry kernel is moving from Bend to Rust (Marc, 2026-09-26): plain f64 geometry, with exact predicates (expansion arithmetic or exact rationals behind a filter) for every sign and topology decision; anything undecidable is a named refusal. The Bend kernel is retired (Marc, 2026-09-26: "Wonky mit Bend ist Geschichte"): no Bend changes of any kind, including bug fixes, and no new work that serves or targets Bend (call captures, Bend diff modes, Bend re-runs). Existing frozen Bend results stay in the repo as history; a Bend defect is recorded, not fixed. Marc explicitly rejected an OpenCascade hybrid: OpenCascade and other CAD kernels or crates (Truck, Fornjot, ...) may only independently validate exported test artifacts, never construct production geometry.
- Current acceptance target: the R20 step feeder (its sources and gate are kept outside the public repository). Every module is built from its frozen FeatureScript snapshot with real resulting geometry and validation, compared against Onshape. Parsing or constructing an unevaluated operation graph does not satisfy this target. r10b (`fixtures/r10b`, local only, `singleStepR10b`) is no longer an acceptance target (Marc, 2026-09-25). Keep the local fixture byte-for-byte unchanged as a historical test input; do not build acceptance criteria on it.
- Freeze external dependencies with provenance (origin and hash, as in `fixtures/r10b/provenance.json`); do not substitute legacy meshes or a different Onshape revision.
- Unsupported kernel/library functionality must raise an explicit capability error, including inside `try silent`. Do not suppress errors, invent query results, skip operations, or report an incomplete model as successful.
- Do not silently replace analytic curves by polygonal approximations. Any approximation mode needs a stated tolerance and must remain distinguishable from exact geometry.
- Run `npm test` for relevant changes. The test command checks Bend proofs and integration behavior. Validate changed STEP exports with `uv run scripts/validate-step.py <prefix> ...` when geometry/export changes require it.
- Benchmark cold startup, warmed Bend execution/interop, frontend, validation, and export separately. Do not infer native/GPU performance from the JavaScript target.

- Before writing or fixing Bend, read `.claude/skills/wonky-bend/SKILL.md` (wonky rules and the 2.0.25 deltas) and use the bend2-mega-skill for general Bend 2. The pinned CLI is `.tools/bend-2.0.25/bin/bend` (`--check-only` checks one file in under a second).

## Honest Work and Anti-Ceremony (binding for agents and humans alike)

The purpose of agent work here is working, deployable capability. Process
serves that outcome and never becomes the product.

- A process artifact (certificate, ledger, dashboard, matrix, meta-report,
  speculative check) may be created only if it names a concrete consumer,
  the named feature it gates, the observed defect class justifying it, and
  its deletion condition. Otherwise it does not get created. Boundary test:
  if running code branches on it, it is product; if only humans and status
  reports read it, it is process and the creation-gate rule above applies;
  code written just to flip this answer counts as the pathology, not as a
  consumer. Sole exception: a minimal
  integrity/recovery control (crash-recovery state, provenance snapshot) is
  legitimate when it prevents a named evidence-loss or corruption mode and
  is necessary and minimal.
- Real code + real tests in the same unit of work. Forbidden: faked tests,
  fixtures/mocks presented as live proof, weakened assertions, golden
  regeneration to force green, hard-coded success paths, placeholder macros
  in commits, editing the spec instead of implementing it, narrowing scope
  while claiming full success.
- No self-certification: work is closed by an independent verifier citing
  evidence at an exact revision. Solo sessions re-verify by re-execution and
  state what was not independently verified.
- A typed refusal beats a fabricated result and is less valuable than the
  real capability; refusal-only work stays open and says so.
- Truthful null results ("checked X, found no material increment") are
  successful outcomes. Unsupported claims are worse than silence.
- Metrics predeclare denominator and countermetric; agreement between
  agents may raise confidence but is never independent evidence; never
  silence stderr in evidence-bearing commands.
- Name these pathologies when they occur (gate self-weakening, proof-class
  inflation, golden regeneration, tolerance widening, suppression-pragma
  laundering, refusal farming, follow-up laundering); the names are the
  deterrent. The full catalog with countermeasures lives in the
  just-say-no-to-process-porn-and-ceremony skill; ask the operator for it
  if you cannot resolve that reference.

## Process efficiency (maintainer)

Whoever coordinates agents here keeps the whole process under review: effort per role, test lanes, targets per stage, caches, parallelism, and the share of process versus shipped capability. Measure before changing anything (development evidence kept locally), apply clear wins, and report them. A periodic fresh-eyes review of the last hour is allowed under the anti-ceremony rules above: at most five findings, each with evidence and an estimated saving, and retired after two reviews in a row that find nothing material.

Standing rules from those reviews:
- One working tree per workflow. A workflow that edits `kernel/` or `src/` runs in its own `git worktree` (development evidence kept locally), plus only that workflow's own changed files) and edits, tests and records evidence only there. Several workflows in one checkout make every failure ambiguous and evidence irreproducible. Without separate trees, at most two such workflows run at once.
- Deterministic results are not recomputed. When the kernel sources are unchanged since a stored multi-target run (js, cpu1, cpuN, Metal), a later stage reruns one target and compares it with the stored results instead of repeating all four.
- Tests never read a live external project (`~/Workspace/cad` or similar). Freeze what a test needs into `fixtures/` with its provenance; live comparisons belong in scripts such as `scripts/r20/acceptance.mjs`.
- Worklog times come from `date +%H:%M` or are left out; a guessed time is an unsupported claim.
- Memory: run at most one heavy process (native build, OCCT oracle, bake-off) at a time per agent; this is not a machine-wide lock, so do not wait for another agent's heavy process when thermal pressure (`notifyutil -g com.apple.system.thermalpressurelevel`) is below 2. Set `NODE_OPTIONS=--max-old-space-size=8192`; split oracle batches to stay under 16 GB. Treat resource-limit termination as a resource problem, not a flake.
- Searches: never search the whole disk (`find /`, `bfs /`, `mdfind` without `-onlyin`). Name the directories: the repo, `.tools`, the uv cache or `~/Workspace/<project>`. if a file is not where you expect it, say so instead.
