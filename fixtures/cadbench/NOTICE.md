# CADBench source and local adaptations

The public descriptions and parameters in `upstream/public-corpus.json` come
from **gNucleus AI, Inc., cad-gen-freecad**, revision
`a0e2f69b58d857b631ac1b746ff08e70c1240d8a`. The dataset is copyright
gNucleus AI, Inc. and licensed under Apache-2.0. Its exact README is retained as
`upstream/DATASET-README.md`; the license is `upstream/LICENSE-2.0.txt`.

The official v2 task policy is an unchanged file from
`gNucleus-AI/cad-bench-submission`, revision
`6b85cbafd00961c105b1fbc2173163a9b595bbdd`, whose license is Apache-2.0,
copyright 2026 gNucleus AI, Inc.

**Modifications:** only the six text/path metadata columns were extracted from
the public Parquet. PNG data were excluded. The FeatureScript files in
`adapted/` are newly authored local adaptations of five public specifications;
they are not upstream FreeCAD scripts, native FreeCAD files, original Harbor
tasks, or official submissions. Coordinate placement and construction choices
are stated in `pilot.json`. No reference FCStd geometry was downloaded or used
to construct these adaptations. Materials and manufacturing grade are not
tested. See `provenance.json` for immutable URLs and hashes.
