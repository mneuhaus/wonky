# FreeCAD topological naming: realthunder's element-map algorithm

- **Kind:** algorithm description (wiki) plus the production C++ implementation in FreeCAD 1.0+, and user docs.
- **Canonical URL:** https://github.com/realthunder/FreeCAD_assembly3/wiki/Topological-Naming-Algorithm
- **Other URLs:**
  - Mainline code:
    - https://github.com/FreeCAD/FreeCAD/blob/main/src/App/ElementMap.cpp
    - https://github.com/FreeCAD/FreeCAD/blob/main/src/App/MappedName.cpp
    - https://github.com/FreeCAD/FreeCAD/blob/main/src/App/ElementNamingUtils.h
    - https://github.com/FreeCAD/FreeCAD/blob/main/src/App/StringHasher.h
    - https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/Part/App/TopoShapeExpansion.cpp
    - https://github.com/FreeCAD/FreeCAD/blob/main/src/Mod/Part/App/TopoShapeMapper.cpp
  - User docs: https://wiki.freecad.org/Topological_naming_problem (read via `api.php?action=parse&prop=wikitext`, because the HTML page is behind a bot wall).
  - Release post: https://blog.freecad.org/2024/11/19/freecad-version-1-0-released/
- **Authors/org:**
  - Zheng Lei ("realthunder") designed it in the LinkStage3 fork (https://github.com/realthunder/FreeCAD, default branch `LinkMerge`) around 2019-2020.
  - The `ElementMap` class came to mainline 2023-06-15 in PR #9175 (by Pesc0).
  - The TopoShape element methods came to mainline Feb 2024 (Zheng Lei, bgbsww, Vincenzo Calligaro; merged by Chris Hennes, e.g. https://github.com/FreeCAD/FreeCAD/pull/12201).
  - It shipped in FreeCAD 1.0 (2024-11-19).
- **License:**
  - FreeCAD is LGPL-2.1 (`gh api repos/FreeCAD/FreeCAD`).
  - The assembly3 repo that hosts the wiki is GPL-3.0. The realthunder/FreeCAD fork reports NOASSERTION (it is LGPL in practice as a FreeCAD fork, INFERRED).
  - Porting implication: wonky is private and unlicensed, so copying code is out. The naming *scheme* (ideas, name grammar) can be re-implemented from the wiki description.
- **Status/activity (gh api, 2026-09-22):**
  - FreeCAD/FreeCAD: C++, 33.7k stars, 6.1k forks, about 4.0k open issues, last commit 2026-09-22.
  - `ElementMap.cpp`: 20 commits.
  - `TopoShapeExpansion.cpp`: last commit 2026-08-03 ("Part: Allow unorientable shapes in booleans").
  - realthunder/FreeCAD: 851 stars, last commit 2026-07-12.
  - FreeCAD_assembly3: 905 stars, 334 open issues, last commit 2025-11-08.
  - Issues with "Toponaming" in the title: 52 closed and 27 open.

## What it is

- It is a **history-based naming scheme for B-rep sub-elements** (vertex/edge/face). Every element produced by a modelling operation gets a *mapped name*: a string encoding which input elements it was modified or generated from, which operation made it, and the owner object's tag.
- Downstream features (sketch attachment, fillet edge lists, TechDraw dimensions, assembly joints) store the mapped name instead of the positional index `Face6`/`Edge12`. They resolve it back to the current index through a per-shape bidirectional `ElementMap` (DOCUMENTED, wiki "Topological-Naming-Algorithm").
- The wiki is explicit about what this achieves. Its purposes are to:
  1. detect that a reference broke and flag an error;
  2. propose a likely replacement (fillet/chamfer candidates);
  3. auto-resolve only when confidence is high.
- It "has been widely described as 'fixing the topological naming problem'", which has "unintentionally misled many users". It still recommends datum planes and robust modelling practice (DOCUMENTED, wiki.freecad.org/Topological_naming_problem).
- The 1.0 release post calls it a "mitigation algorithm". It is active in Sketcher and PartDesign and "being progressively extended to everything else", and is "not finished" (DOCUMENTED, blog.freecad.org 2024-11-19).

## How it works

### Core algorithm: `TopoShape::makeShapeWithElementMap`

Formerly `makESHAPE`; TopoShapeExpansion.cpp lines 1420-2030 (DOCUMENTED, code and wiki). The inputs are:

- the result shape;
- a `Mapper` exposing OCCT's `BRepBuilderAPI_MakeShape::Modified()/Generated()` history (TopoShapeMapper.cpp);
- the source `TopoShape`s with their own element maps;
- an operation code (`FUS`, `CUT`, `XTR`, `RFI`, `FAC`, `SKT`, ...).

The steps:

1. **Copy unchanged elements.** Any result sub-shape that is identical (`IsSame`) to an input sub-shape inherits that input's name verbatim.
2. **Name modified and generated elements.**
   - For each input element, `Mapper::modified()` and `generated()` are queried. Every result element collects the set of (source name, source tag, shape type) keys that produced it.
   - Keys are sorted by `NameKey` (line 1276): vertex < edge < face < other, then tag, then name. So the name is built from the lowest-dimension, lowest-tag source first.
   - The **first** source becomes the prefix. Up to four further sources are appended in brackets `(a|b|c|d)`.
   - Then comes `;:M` (modified), `;:G` (generated) or `;:MG`, plus the op code and a tag postfix `;:H<hextag>:<len>,<type>`. `len` is the length of the embedded source name, which is what makes recursive decoding possible.
   - Elements hit by several sources get an index `;:M2`.
3. **Reverse pass (upper → lower).** A still-unnamed lower element (for example an edge) gets a name derived from the named upper element that contains it, with postfix `;:U<n>`.
4. **Forward pass (lower → upper).** A still-unnamed upper element gets a name from *all* its lower elements' names, with postfix `;:L(...)`.
   - Faces use only the outer wire's edges.
   - The step is skipped if any lower element is unnamed.
5. **Delayed round.** High-level mappings are excluded in the first round and used only as a fallback in a second round (`delayed = true`, lines 1663-2007). An example is a solid generated from a face, where the shapetype difference is at least 3. Steps 2-4 repeat until nothing more can be named.
6. **Coplanar/parallel special indices** (`checkForParallelOrCoplanar`, lines 1363-1417):
   - When a face generates faces, the first *coplanar* generated face gets index `INT_MIN+1` (printed "00") and the first *parallel* one gets `INT_MIN` ("0").
   - Code comment: "the top or bottom face of an extrusion will be named using the extruding face. With a fixed index, the name is no longer affected by adding/removing of holes inside the extruding face/sketch."
   - Coplanarity uses OCCT `Precision::Angular()` and `Precision::Confusion()` (1e-7 mm).

### Name grammar

- Markers are defined in `ElementNamingUtils.h`:

  | Marker | Meaning |
  | --- | --- |
  | `;` | map prefix |
  | `?` | missing element |
  | `;:H` | hex tag |
  | `;:T` | decimal tag, older |
  | `;:X` | external |
  | `;:C` | child |
  | `;:I` | index |
  | `;:U` | upper |
  | `;:L` | lower |
  | `;:M` | modified |
  | `;:G` | generated |
  | `;:MG` | modified and generated |
  | `;D` | duplicate |

- A real mainline name, from https://github.com/FreeCAD/FreeCAD/issues/14129: `;g11;SKT;:H1db,E;FAC;:H1db:4,F;:G0;XTR;:H1db:8,F;:H-1de,F.Face11`.
- Wiki-era examples:
  - `Face6;:M2;FUS;:T1:5:F`
  - a refine-after-fusion name that embeds two earlier names in `;:M(...)`.

### StringHasher

- This is a document-level string table (`StringHasher.h`). Long names are replaced by `#<hex>` IDs, e.g. the wiki's `#a8;:M#a7;RFI;:T2:2:F`, with prefix and postfix encoded recursively.
- Over-long strings are stored as SHA1 (flag `Hashed`).
- Flags include Binary, Hashed, PostfixEncoded, Postfixed, Indexed, PrefixID, PrefixIDIndex, Persistent and Marked.
- The table is saved inside the `.FCStd`. Names are only meaningful together with their table (DOCUMENTED, header).

### History and recovery

- `ElementMap::getElementHistory` (ElementMap.cpp:1335) and `traceElement` (1394) decode the first source name recursively using the embedded `len` and tag.
- `encodeElementName` (620) limits re-encoding of the same tag to one extra level during multi-step ops, to stop names doubling.
- `Part::Feature::getRelatedElements` guesses a replacement when a stored name no longer resolves:
  - It does a prefix search on `name;:M` / `source;:M` and looks for elements sharing history.
  - The fillet feature deliberately does *not* auto-apply this ("first, do no harm"). The wiki explains why: the modified-index order depends on OCCT's report order, so a fillet on an edge that gets split can jump to the *lower* split edge (DOCUMENTED, realthunder wiki).

### Duplicates

- `ElementMap::setElementName` → `renameDuplicateElement` (756).
- When two different elements would receive the same mapped name, it appends `;D<hex>`.

## Robustness and guarantees

- **No correctness guarantee; heuristic by design.** Both the wiki and user docs say the algorithm can produce a name that resolves to a *different* element after an edit, and that auto-repair is limited to high-confidence cases (DOCUMENTED, wiki.freecad.org/Topological_naming_problem).
- **Non-determinism across runs (DOCUMENTED in code, consequence INFERRED).**
  - In release builds, `renameDuplicateElement` uses `static std::mt19937 _RGEN(_RD()); std::uniform_int_distribution<> _RDIST(1, 10000); idx = _RDIST(_RGEN);`.
  - So the duplicate suffix is **random per process**. Only `FC_DEBUG` builds use the deterministic attempt index (ElementMap.cpp:756-779). `setElementName` retries up to 100 times.
  - Any model that hits duplicates therefore gets different names on each recompute or session. This is a plausible root cause of "IDs change after recompute" reports such as https://github.com/FreeCAD/FreeCAD/issues/17041 (INFERRED).
- **Order dependence on the underlying kernel (DOCUMENTED, realthunder wiki).** Index postfixes (`;:M2`) follow the order OCCT reports modified/generated shapes. An OCCT upgrade or algorithm change can permute them.
- **Cyclic mappings (DOCUMENTED, ElementMap.cpp:1422-1431).**
  - Tracing without the owning object can look names up in the wrong (external) string table and loop.
  - The mitigation is an "arbitrary depth limit" of 50 plus a `tagSet` for early cycle detection. See https://github.com/realthunder/FreeCAD_assembly3/issues/968.
- **Tolerances.** Coplanar/parallel detection uses OCCT's fixed 1e-7 confusion and angular precision. There is no user-exposed tolerance (DOCUMENTED, code).

## Parallelism and performance

- The map build is single-threaded C++ with `std::map`/`QHash` lookups and string concatenation (DOCUMENTED, code).
- Measured overhead, as an informal wiki benchmark (DOCUMENTED, realthunder wiki; HEARSAY as to generality):
  - a 148-object model recomputed in 40 s without the element map and 52 s with it;
  - the uncompressed file grew 17.8 → 22.6 MiB (2.8 → 3.6 MiB compressed).
- Names grow with history depth. The hasher and the one-extra-level re-encoding exist to bound growth (DOCUMENTED, code).
- There is no inherent sequential dependency between result elements *within* one step. Steps 1-2 are a map over result elements plus a sort, while 3-4 are fixpoint propagations over the adjacency graph (INFERRED).

## Known failures, limitations, war stories

- https://github.com/FreeCAD/FreeCAD/issues/17041: face/edge IDs change after recompute; a regression in 1.0 RC2 / 1.1dev with OCC 7.7.2.
- https://github.com/FreeCAD/FreeCAD/issues/14129: "Shape index 11 out of bound 10". The stored mapped name survived but the resolved index was stale.
- https://github.com/FreeCAD/FreeCAD/issues/27266: a chamfer loses its face after a thickness change upstream.
- https://github.com/FreeCAD/FreeCAD/issues/27546: users ask for an easier UI to *reassign* broken references. Detection works, repair UX is the pain point.
- Workbenches the map has not reached yet:
  - https://github.com/FreeCAD/FreeCAD/issues/22482 (TechDraw dimensions corrupted)
  - https://github.com/FreeCAD/FreeCAD/issues/17554 and https://github.com/FreeCAD/FreeCAD/issues/17776 (Assembly)
  - https://github.com/FreeCAD/FreeCAD/issues/32126 (FEM material assignment lost)
  - https://github.com/FreeCAD/FreeCAD/issues/31651 (external sketch geometry fails to project)
  - https://github.com/FreeCAD/FreeCAD/issues/26084 (Spreadsheet + SubShapeBinder)
- Maturity summary: 27 open and 52 closed "Toponaming" issues two years after release, matching the "mitigation, not a fix" framing (DOCUMENTED counts via `gh search issues`, interpretation INFERRED).

## Relevance for wonky

**Where it plugs in:** naming across Boolean split/merge, fillet edge references, and model diff. Today wonky's `kernel/identity.bend` gives semantic identities for primitives, box roles, transforms and imports. `boolean_result` stamps every Boolean output as `"boolean-generated"` / `"unsupported-split-merge-correspondence"`, and `docs/topology-identity.md` says general Boolean naming is not solved. The element-map idea is the most battle-tested open design for filling that gap.

**Bend fit:** good, but with deliberate changes.

- **Steps 1-2 are pure and parallel.**
  - Given a Boolean or fillet that emits an explicit *provenance relation* (result element → sorted list of (source key, relation kind)), the name is a pure function: sort by (dimension, source key), take the first as prefix, then append at most k more.
  - That is a fork-join map plus a sort over U32-encoded keys.
  - wonky's hybrid Boolean already has a *tagged* mesh Boolean. Carrying source face tags through the mesh arrangement *is* the provenance relation, so no OCCT-style `Modified()/Generated()` API is needed (INFERRED).
- **Steps 3-4 (upper/lower fallback)** are a bounded fixpoint over the adjacency graph. In Bend they are iterated rounds of map-over-elements with an immutable name table per round. The round count is at most the number of dimensions (3) plus the delayed round.
- **Keys:** use wonky's existing length-prefixed framed strings (`wk1/…`) instead of the ad-hoc `;:H<tag>:<len>` grammar. Framing already provides unambiguous recursive decoding, which the `len` field emulates. Store the parent list structurally in `lineage.parents` instead of embedding it in a string. A content hash (already used for `revision`) replaces StringHasher if names must be bounded.
- **Determinism:** do **not** copy the random `;D` suffix. Break duplicates by a canonical, geometry-independent order: sorted parent keys, then the relation kind, then a canonical ordinal within the source's split (for example order along the source edge's parameter, or lexicographic on the exact vertex coordinates). Where no canonical order exists, mark the entity `revision-local`, as `identity.bend` already does for anonymous profile edges, rather than inventing a stable-looking name.
- **Coplanar/parallel fixed indices:** port the idea directly. For an extrude, the cap faces already have semantic roles (`start`/`end`) in wonky. Generalise this to "a generated face coplanar with its generating face keeps a fixed role independent of holes". Detect coplanarity exactly (same plane, via exact predicates on the analytic surface) rather than with 1e-7 tolerance.
- **Failure policy:** adopt the three-tier stance (detect → propose candidate → auto-resolve only on unique, high-confidence match) as the resolver contract. Refuse explicitly otherwise. This matches wonky's "unsupported cases fail explicitly".
- **LLM ergonomics:** FreeCAD names are unreadable (`;g11;SKT;:H1db,E;FAC;…`). wonky should expose a short semantic role (`cap/start`, `split(edge=…,i=1)`) alongside the opaque key, so an LLM author can reference edges by meaning.
- **Testing:** the wiki's canonical regressions make a ready-made naming torture list for wonky's golden tests:
  - add a hole to a sketch and check the top face name stays;
  - split an edge under a fillet;
  - refine after a fusion;
  - reorder features.

**Precision:** it needs no numerics beyond coplanarity/parallelism predicates. In wonky these are exact (multi-limb integers on analytic plane data) or F32x2 with explicit tolerance.

## Pointers worth porting or studying

- realthunder wiki sections on the naming steps, the "Delayed" round, and the fillet "first, do no harm" rationale: https://github.com/realthunder/FreeCAD_assembly3/wiki/Topological-Naming-Algorithm
- `TopoShapeExpansion.cpp`:
  - `NameKey` ordering (l.1276);
  - `checkForParallelOrCoplanar` (l.1363);
  - `makeShapeWithElementMap` (l.1420-2030), especially the `delayed` loop and the `;:U`/`;:L` passes;
  - `makeElementFillet` (l.4148) and `makeElementBoolean` (l.4355) for how ops feed the mapper.
- `ElementMap.cpp`:
  - `renameDuplicateElement` (l.756): the anti-pattern;
  - `traceElement` (l.1394): depth limit and cycle set;
  - `encodeElementName` (l.620): the growth limit.
- `MappedName.cpp::findTagInElementName` (l.77): the reverse parser, as a spec for what information a name must carry.
- The FreeCAD wiki TNP page's user-facing guidance, for wonky's own docs on what naming does and does not promise.

## Verdict: learn-from

Adopt the *concepts*:

- provenance-derived names from modified/generated relations;
- the first-source prefix with a bounded extra-source list;
- the upper/lower fallback passes with a delayed high-level round;
- fixed roles for coplanar/parallel generated faces;
- the detect/propose/auto-fix-only-if-confident resolver policy.

Re-implement them on wonky's framed keys and structured lineage.

Do not port the code (LGPL-2.1, entangled with OCCT and Qt). Avoid four things:

- random duplicate suffixes;
- dependence on the kernel's report order;
- string-grammar names with hash tables;
- 1e-7 tolerance coplanarity.

This avoidance list, together with 79 "Toponaming" issues, is the war-story value.
