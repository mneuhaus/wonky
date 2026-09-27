# Repros: fs-interpreter-semantics

Minimal FeatureScript inputs for the cluster "Interpreter semantic gaps"
(67 units, 58 files, 13 families; see
[docs/corpus/cluster-fs-interpreter-semantics.md](../../../docs/corpus/cluster-fs-interpreter-semantics.md)).
They do not depend on `~/Workspace/cad`. These are inputs, not tests.

Checked on 2026-09-22 with `node bin/wonky.mjs <file> --check` on the default JS
path. The "with prototype fix" column runs the same CLI with the in-memory
prototype, `node --import ./scripts/corpus/fs-interpreter-semantics/prototype/register.mjs bin/wonky.mjs <file> --check`.
It does not change any file under `src/`.

| File | Units | Production CLI | With prototype fix |
|---|---:|---|---|
| `length-bounds-default.fs` | 21 | `13:9: Expected a length with units (for example 10 * millimeter)` | builds, 25 mm cube (LENGTH_BOUNDS default 0.025 m) |
| `boolean-default.fs` | 15 | `12:9: Feature precondition failed` | builds (`open` = false) |
| `annotation-filter-and.fs` | 16 | `15:50: FeatureScript conditions must be boolean` | builds (only the annotation's `Default` is evaluated). An unpicked query parameter is not resolved by this feature; a feature that resolves one gets an explicit capability error (supply it with --param, e.g. part=qNothing()). |
| `angle-bound-spec.fs` | 9 | `8:14: Expected AngleBoundSpec` | builds |
| `color-type-tag.fs` | 2 | `16:9: Expected Color` | builds (`color()` returns a `Color`-tagged map) |
| `units-source-error.fs` | 4 | `15:22: Incompatible units in expression` | same error. This is correct: the corpus source adds a unitless vector to a length vector. |

With explicit parameters, production already builds the first two, for example
`--param 'size=25*millimeter'` and `--param 'open=false'`.

Re-checked on 2026-09-23: same results.

After W1 (2026-09-23), the production CLI gives the "with prototype fix"
results: `length-bounds-default.fs` 15625 mm³, `boolean-default.fs`,
`annotation-filter-and.fs`, `angle-bound-spec.fs` and `color-type-tag.fs`
1000 mm³ each. `units-source-error.fs` still fails with
`15:22: Incompatible units in expression`. See
[docs/corpus/w1.md](../../../docs/corpus/w1.md).

The two files in `next/` are not part of this cluster. They are the Boolean
that 19 units hit once the cluster is fixed, and they fail in production today
independent of it. Both are the boolean-capability cluster's
`pierce-admission` subcause: after earlier planar cuts or unions, the cap
planes are split into several coplanar faces and the edges are ranged.

| File | Units | Production CLI | Bake-off recover route |
|---|---:|---|---|
| `next/lochwand-hole-in-notched-panel.fs` | 17 lochwand + 1 gt2 mini-r1 (through holes) | `29:9`: general trimmed-face `opBoolean` message | exact, OCCT-valid, volume 1189758.850 mm³ (closed form) |
| `next/blind-pilot-in-stepped-body.fs` | 1 mini_camera (blind pilot bore, 1 mm floor) | `31:9`: same message | exact, OCCT-valid, volume 12146.907 mm³ (closed form) |

The same hole in the panel without the notch builds in production. A
through-hole admission fix ("pierce v2") would cover the first file but not
the second: a blind pocket needs a floor the hole arm does not build. The
bake-off run is `scripts/corpus/fs-interpreter-semantics/next-bakeoff.mjs`;
see `docs/corpus/cluster-fs-interpreter-semantics.md` §4.4.
