# Corpus benchmark

This benchmark runs Marc's real CAD code (`~/Workspace/cad`, read only) through the
production CLIs and records, per unit, whether it builds and what stops it.
The baseline run of 2026-09-22 is in [run.md](run.md). The triage and the
ranked fix backlog are in [../corpus-triage.md](../corpus-triage.md). The
per-cluster analyses are the `cluster-*.md` files in this directory.

Every fix to the frontend or the kernel should be followed by a labelled
benchmark run and a comparison against the baseline. That comparison is the
acceptance evidence for the workflows proposed in the triage document.

## Rules

- **Corpus:** the corpus is read only. FS files are read in place, and the CLI
  writes only to `--out`. Python files run from a mirror in `tmp/corpus/src`.
- **Onshape imports:** an FS unit gets its frozen inputs from a sibling
  `modules.json`, else from the store manifest
  `var/onshape-store/manifests/<corpus path>.json` (passed with `--modules`),
  else none. `--no-store-manifests` turns the store off. See
  [../onshape-inputs.md](../onshape-inputs.md#corpus-runner) and [w4.md](w4.md).
- **Backend:** default JS path only. The runner refuses to start when
  `WONKY_BACKEND` is set.
- **Load:** at most 3 wonky processes at once (`--concurrency` is capped at 3).
- **Budget:** each unit has a timeout, 180 s by default. Known-heavy files get
  480 s, and `--retry-timeouts` re-runs timeouts with 2.5× the budget, up to
  900 s.
- **Metadata:** `uptime` and the load average are logged at the start, every
  25 units and the end, in `run-meta.jsonl`.
- **Python:** Python is started through `tmp/corpus/uv-python`, which runs
  `uv run --no-project`. `python3` is never called directly.
- **Git:** no git state is touched.

## Units

One unit is one (file, exported feature) pair for FeatureScript, or one file
for build123d. The run list is `out/corpus/targets.json`, built by
`scripts/corpus/targets.mjs` from the inventory scanners (`--rescan`
re-scans the corpus). The anchor, the frozen `fixtures/r10b/r10b.fs`
`singleStepR10b`, is phase 0. It is reported separately and is not counted in
the corpus totals.

## Baseline

The baseline is `out/corpus/runs.jsonl`, `run-meta.jsonl` and `summary.json`.
Do not overwrite it with an experimental run. Use a label (next section).

```sh
node scripts/corpus/targets.mjs              # run list (after corpus changes: --rescan)
node scripts/corpus/run.mjs                  # resumable; appends to out/corpus/runs.jsonl
node scripts/corpus/reference.mjs            # match and measure reference STEP/STL (uv run)
node scripts/corpus/summarize.mjs            # out/corpus/summary.json
node scripts/corpus/backlog.mjs              # out/corpus/backlog.json (ranked fix backlog)
```

## Standing benchmark: labelled runs

```sh
# full corpus: about 15 min wall time at concurrency 3 on the shared machine (2026-09-22)
node scripts/corpus/run.mjs --label 2026-09-24-f32x2
node scripts/corpus/reference.mjs --label 2026-09-24-f32x2   # optional: references for the successes
node scripts/corpus/summarize.mjs --label 2026-09-24-f32x2
node scripts/corpus/compare.mjs --label 2026-09-24-f32x2
```

A labelled run writes these files and leaves the baseline untouched:

- `out/corpus/bench/<label>/runs.jsonl`
- `out/corpus/bench/<label>/run-meta.jsonl`
- `out/corpus/bench/<label>/summary.json`
- `out/corpus/bench/<label>/compare.json`
- `out/corpus/bench/<label>/reference.json`, when `reference.mjs --label` ran
- the build outputs, in `tmp/corpus/bench/<label>/out/`

A label is resumable: re-running the same command runs only the units that
have no record yet.

Targeted runs, for example after a fix for one cluster:

```sh
node scripts/corpus/run.mjs --label w1-frontend --cluster fs-parser-syntax
node scripts/corpus/run.mjs --label w1-frontend --cluster fs-interpreter-semantics
node scripts/corpus/run.mjs --label w1-frontend --phase 1                # family representatives only
node scripts/corpus/run.mjs --label w1-frontend --phase 0                # r10b anchor
node scripts/corpus/run.mjs --label w1-frontend --skip-fragments         # without header-less include fragments
node scripts/corpus/run.mjs --label w1-frontend --keys-file my-keys.txt  # explicit unit keys, one per line
```

`--cluster <key>` selects the units whose baseline record failed in that
cluster. The keys are the cluster keys in `out/corpus/summary.json`.

Other options:

- `--only <substring>` selects units whose key contains the substring.
- `--limit N` stops after N new units.
- `--rerun` ignores the existing records of the label.
- `--retry-timeouts` re-runs only the units whose last record is a timeout.

### What `compare.mjs` reports

`compare.mjs` compares only the units present in both runs, so partial runs
are compared fairly.

- Files and families that build, per frontend. Only files whose units are all
  in both runs are counted.
- Unit transitions, for example `fs-missing-builtin -> boolean-capability` or
  `boolean-capability -> ok`.
- New successes.
- Regressions:
  - a unit that was `ok` before and fails now;
  - an `ok` unit whose body count changed, or whose volume changed by more than
    1e-9 relative.

  Any regression makes the exit code 2.
- Units that stay in the same cluster but now fail with a different message.
  This shows a blocker moving inside one cluster.
- Wall time p50/p99 of the compared units. Record the load average from
  `run-meta.jsonl` next to it, because the machine is shared.

`--base <label>` compares two labelled runs instead of a run and the baseline.

## Acceptance checklist for a fix workflow

1. Run the repros of the fix's cluster in `fixtures/corpus-repro/` with the
   production CLI. The cluster README states the expected output.
2. Run `npm test` and the r10b anchor (`--phase 0`).
3. Run a labelled benchmark over the cluster's units (`--cluster`), then a
   full labelled run before the merge.
4. `compare.mjs` must show no regressions. The moved units must land in the
   clusters that the triage predicts. When they do not, update the backlog
   (`scripts/corpus/backlog.mjs` reads the cluster data under `out/corpus/`).
5. New successes go through `scripts/corpus/reference.mjs --label <name>` where a reference
   STEP/STL exists. Report agreement only for matched references.

## Scripts

| script | role |
|---|---|
| `targets.mjs` | population, dedup, families, ordered units |
| `run.mjs` | runner (baseline or `--label`), probe on failure |
| `probe.mjs` | re-runs one failure through the production entrypoints to record the error class, failing call and call chain |
| `clusters.mjs` | record loading, normalization and clusters (shared) |
| `summarize.mjs` | `summary.json` for the baseline or a label |
| `compare.mjs` | label vs baseline (or vs `--base <label>`) |
| `reference.mjs`, `measure.py` | reference matching and OCCT measurement (oracle only, via `uv run`) |
| `backlog.mjs` | fix sets per file, confidence, greedy ranking: `out/corpus/backlog.json` |
| `boolean-*.mjs`, `module-import-*.mjs`, `py-imports-*.mjs`, `fragments.mjs`, and the cluster subdirectories | cluster analyses (see each `cluster-*.md`) |
