# fs-headerless-include repros

Cluster: header-less include fragments that the corpus inventory counted as
modeling files (28 unique files, 17 families, 293 run units). Analysis:
[docs/corpus/cluster-fs-headerless-include.md](../../../docs/corpus/cluster-fs-headerless-include.md).

Checked 2026-09-22 and again 2026-09-23 04:12 with the production CLI on
the default JS path (`node bin/wonky.mjs <file> --check`, `WONKY_BACKEND`
unset). These are inputs, not tests.

| File | Stands for | Observed |
|---|---|---|
| `geometry-body.fs` | 21 files: generator bodies and include snippets that start with `function` or `const` (e.g. `machine-interface-r7/geometry-body.fs`, `endstop-r11.fs`, `r20/fs/modules/datums.fs`) | `6:1: Expected 'FeatureScript', found 'function'` (exit 1) |
| `interface.fs` | the headed twin: the two header lines plus `geometry-body.fs` byte for byte, i.e. what `generate_fs.py`/`build_parts.py` write | builds: `model/slab: 8 vertices · 12 edges · 6 faces · 600 mm³ · closed topology` (exit 0) |
| `paste-in.fs` | 7 files that start with `annotation`/`export`: complete features whose header was left to the Onshape Feature Studio they were pasted into (`hopper_v2.fs`, `hopper_v21.fs`), or that a generator cuts out of a headed file or appends to one (`*.fragment.fs`, `transfer_edge.fs`) | `5:1: Expected 'FeatureScript', found 'annotation'` (exit 1) |
| `next-string-minus.fs` | not this cluster: what the generated r20 `datums` studio hits after the header is present | `8:17: Unsupported expression ';'` (exit 1). After W1 (2026-09-23): builds, 1 body, 1000 mm³ (exit 0) |

Check that the twin is the fragment plus a header:

```sh
tail -n +3 fixtures/corpus-repro/fs-headerless-include/interface.fs \
  | cmp - fixtures/corpus-repro/fs-headerless-include/geometry-body.fs
```

The same parse error occurs with `WONKY_BACKEND=native`, because
`src/index.mjs build()` parses before it loads a kernel.
