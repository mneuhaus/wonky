# fs-needs-partstudio-input repros

Analysis: [docs/corpus/cluster-fs-needs-partstudio-input.md](../../../docs/corpus/cluster-fs-needs-partstudio-input.md).
Checked on 2026-09-23 (04:12 and later) with the production CLI on the default JS path
(`node bin/wonky.mjs <file> --check`). These are inputs, not tests.

| File | Stands for | Observed |
|---|---|---|
| `modify-existing-part.fs` | 26 fixed-frame R29/R30 files, 4 c-channel files, 3 return-hardware files, the flush-return guide and the rotor closure (count guard, then a bounds guard) | `15:19: Derive exactly one source part into this Part Studio first` |
| `volume-selected-source.fs` | 14 TOP-clearance files (source part picked by `evVolume`) | `14:15: Expected exactly the declared current TOP source body; matching count=0` |
| `source-block.fs` | The 40 x 20 x 10 mm part both repros expect. It stands in for the earlier Part Studio feature. | builds: `model/block: 8 vertices · 12 edges · 6 faces · 8000 mm³` |
| `catch-without-binding.fs` | 2 misclassified files: `cad-project-028/sorter.fs`, `cad-project-038/scripts/skirt_collar.fs` | `14:143: Expected '(', found '{'` (parser gap; the corpus probe flagged it as a model throw). After W1 (2026-09-23): builds, 2 bodies of 1000 mm³ |

Next blockers behind the guard (they need no Part Studio input; the lines are
copied unchanged from the corpus):

| File | Stands for | Observed |
|---|---|---|
| `next-blocker-fixed-frame-n3.fs` | Level 1 of 20 fixed-frame R29/R30 files: `n3 = n1 - n2` (`fixed-frame-r30.fs:81-83`) | `33:9: Native planar arrangement subtraction unresolved: InvalidTopology (stage 1, detail 0)`. F32-built slanted operands; with F32x2 prisms simulated: `AmbiguousContact (stage 2, detail 15)` |
| `next-blocker-line-arc-joins.fs --feature tinyFilletArcJoin` | Level 2 of the same 20 files: a 0.19° fillet arc between two lines (sketch `n4s0`) | `27:9: Native line/arc sketch unsupported: SelfIntersectionOrTouch` |
| `next-blocker-line-arc-joins.fs --feature splitStraightEdge` | Level 1 of 5 older fixed-frame files (sketch `n2s0`): two exactly collinear consecutive lines | `46:9: Native line/arc sketch unsupported: SelfIntersectionOrTouch` |

Both Part Studio repros build a through hole once `source-block.fs` runs first
in the same context. The CLI cannot do that. The prototype harness can
(`tmp/corpus/cluster-partstudio/seeded-build.mjs`, analysis only):

```
node tmp/corpus/cluster-partstudio/seeded-build.mjs \
  fixtures/corpus-repro/fs-needs-partstudio-input/modify-existing-part.fs \
  --seed-fs fixtures/corpus-repro/fs-needs-partstudio-input/source-block.fs
# {"ok":true,"bodies":1,...}
```
