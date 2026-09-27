# W1 fix: casts, Boolean no-ops, the N-ary UNION fold and four low items

Date: 2026-09-23. Defects: the three "medium" items and four of the "low"
items in [w1.md](w1.md), "Open after the third verification round". Verifier
round 3 found them. Its probes are in `tmp/w1-verify/semantic3/` and
`tmp/w1-verify/r3/fs/`. Run them with
`node tmp/w1-verify/semantic3/run.mjs <file> [feature ...]`. The worklog with
every command and log is local development evidence.

## 1. Casts (`as`)

FsDoc type-tags.html says `as` tags a value that passes the type's typecheck:
`"A" as Example` is the same as `Example.A`. Before this fix, `cast()` in
`src/values.mjs` sent every type it did not know to `checkType`. That raised a
catchable `Expected <T>`, so `try silent` swallowed a wonky gap.

| Cast | std | wonky now |
|---|---|---|
| `map as Plane` | surfaceGeometry.fs `canBePlane`: 3D length `origin`, unit `x` and `normal`, `abs(dot(x, normal)) < TOLERANCE.zeroAngle` | the `Plane` value; a map that fails the typecheck raises `Invalid Plane` |
| `map as Transform` | transform.fs `canBeTransform`: `linear is Matrix`, 3×3, 3D length `translation` | the `Transform` value, or `Invalid Transform` |
| `array as Matrix` | matrix.fs: "an array of rows, all the same size, each of which is an array of numbers" | the `Matrix`, or `Invalid Matrix`. `matrix()` is now the same cast (matrix.fs `matrix(value) = value as Matrix`) |
| `"FACE" as EntityType` | FsDoc type-tags.html | the enum member, from the enum declaration in scope (std or input). A name that is not a member raises |
| `array as Vector` | vector.fs `canBeVector`: a non-empty array | also one-item arrays now |
| `map as Query` | query.fs `canBeQuery` | capability error; `Invalid Query` when the map has neither `queryType` nor `historyType` |

These are capability errors, so `try silent` does not catch them:

- a Plane or Transform map with keys beyond the typecheck's;
- `[] as Matrix`: whether `@isMatrix` accepts it is not documented;
- a string cast to a type wonky does not declare (`"X" as ErrorStringEnum`);
- std enum members wonky does not implement. `enumSet` in `src/queries.mjs`
  lists the rest of `BodyType` (query.fs:268) and `PropertyType`
  (propertytype.gen.fs). `"MATERIAL" as PropertyType` and
  `PropertyType.MATERIAL` are now capability errors. Before, the member
  access read `undefined` silently.

Probe `casts.fs`: `mapAsPlaneInTry`, `mapAsTransformInTry`,
`arrayAsMatrixInTry` and `stringAsEnumInTry` change from 27 to 8 mm³.
`badMapAsPlaneInTry` stays 27 mm³, as in Onshape.

## 2. No-op SUBTRACTION

std boolean.fs:1764 `reportBooleanNoOpWarning` reports a subtraction that
removes nothing (`BOOLEAN_SUBTRACT_NO_OP`) the same way as an empty
intersection (`BOOLEAN_INTERSECT_NO_OP`). Neither is an error. Before this
fix, wonky handled the two paths differently:

- The binary path committed the kernel result. The target got a new body
  (`model/s/0`), the feature's lineage, and the tool was consumed.
- The N-ary path left the target alone only when bounds ruled every tool out,
  and it consumed the tools.

The empty INTERSECTION already refuses, because it is not verified whether
Onshape keeps the tools. The same holds here. So both paths now refuse
before they commit anything (`refuseNoOpSubtraction` in `src/library.mjs`).

~~A target counts as unchanged when the result is one piece with the target's
volume, within a relative 1e-9.~~ **Replaced in refix 1 (24.09.2026):** the
volume rule could not tell a small real cut from a no-op. A 0.125 mm³ corner
notch in a 1000 mm cube (relative 1.25e-10) was refused on the binary path
and silently dropped on the N-ary path. Now `removedMaterial` in
`src/library.mjs` reads the kernel's own account of each result:

- planar arrangement: every result face lists the original faces it lies on
  (`construction.faceOrigins`, operand 0 = target, 1 = tool). A face with no
  target contributor is a piece of the tool's boundary inside the target, so
  material was removed. The result lies inside the one-lump target, so when
  every face lies on the target's boundary, nothing was removed;
- coaxial cylinders: the target is a cylinder primitive, which is convex. A
  result face that lies on none of its surfaces (within the path's own
  1e-9 mm axis tolerance) is a cut;
- through-hole pierce: it is admitted only when it bores through, so it always
  removes material;
- anything else refuses with a capability error. The volume is kept only as a
  consistency guard for a "nothing removed" verdict.

This works whether or not the kernel ran: an abutting tool, a far tool, or a
curved body.

In an N-ary call that does cut something, an unchanged target keeps its
record untouched on both paths.

Probe `noop-booleans.fs`: all four features now give the same explicit
capability error. Before, `CreatedByBinary` gave 8 mm³ (`model/s/0`) and
`CreatedByNary` gave 1 mm³ (`model/target`).

## 3. The N-ary UNION fold and the two corpus timeouts

The verifier was right. `base-templates.fs#tunnelChannelV2` and
`step_feeder.fs` spend their time in the P7 fold, not in other workflows.
Traces of every kernel call, taken with the legacy fold (`ab-units-old.jsonl`):

- **tunnelChannelV2** (7 tools): 336 s user. Four calls, and all of them are
  merges: roof∪wallP (10+6 faces → 52 faces, 20 s), then +wallN (→ 74, 78 s),
  then +zapP0 (→ 166, 229 s). The fourth call, +zapP1, fails with
  AmbiguousContact (stage 2, detail 22).
- **step_feeder** (11 tools): 539 s user. Eight calls, all merges: 14, 26, 36,
  48, 66, 160 and 244 faces. The call 160 faces × 6 faces alone takes 380 s.
  The last call fails with ResolutionLimit (stage 2, detail 21).

A CPU profile (union3 of `tunnel-scaling.fs`) puts 89 of 110 s inside the Bend
planar arrangement (exact expansion arithmetic). Identity and decoding take
about 1 s. Neither unit has a wasted call. Every second is spent on a merge
that the source-order fold must perform. The cost grows because Bend keeps
split coplanar faces.

**A cheaper order changes results.** I first tried fewest-faces-first pairing
(greedy). It brought tunnelChannelV2 down to 54 s and step_feeder to 133 s.
But `tunnel-scaling.fs#union4` builds with the source order (166 faces,
35661.256327 mm³) and fails with the greedy order: UnsupportedArrangement
(stage 6) in the big × big merge. Bend resolves some contacts only in some
orders. The greedy order also changed the refusal detail of three
motorBracket units and the refusal class of step_feeder. So I dropped it.
The evidence is in local development evidence.

**What changed.** Every merge keeps the operands and step ids of the
source-order fold. Only the wasted call is removed: re-Booleaning an
already-merged body to learn that it does not touch a further component.
Once a tool has merged into `current`, the components collected so far are
apart from each other. So `current` touches a further component exactly
where the tool does. The tool alone is tested first:

1. bounds (`disjoint bounds: tool`);
2. then a small kernel test, `<id>/~test<n>` (`tool not touching` /
   `tool touching`).

The merged body is re-Booleaned only when the tool touches, or when Bend
refuses the test. The Python frontend's `compoundBoolean` (`src/python.mjs`)
still re-tests merged bodies. It builds the same bodies.

**Withdrawn in refix 1 (24.09.2026):** step 2, the kernel test of the tool
alone, is not equivalent to the merged body's own call. Verifier probe
`tmp/w1-fix-verify/nary-adv.fs#vertexTouch`: C touches A by a face and B only
at a vertex. Bend returns two bodies for C ∪ B, but refuses (A+C) ∪ B
(UnsupportedArrangement, stage 6), and it refuses the same unions done one by
one. The tool test turned that refusal into two bodies, and Onshape's result
for vertex contact is not known. The fold now skips a pair only by geometry:
the pair's bounds, or the bounds of every tool that the merged body was built
from, separated by more than the margin (`disjoint bounds: every tool of the
merged body`). Otherwise it makes the source-order call, as HEAD and the
Python frontend do. The six `nary-adv.fs` probes now give HEAD's output
exactly.

**Proof that results are unchanged** (legacy fold against the new code in
the same tree):

- 50 corpus units (development evidence kept locally): the 8 building units,
  both timeouts, and every w1-r3 unit that fails in a Boolean with
  AmbiguousContact, ResolutionLimit or the coaxial-cylinder message. All 50
  give identical CLI output: exit code, body ids, vertex, edge and face
  counts, volumes, error message and location. They also make the same
  number of kernel calls (`ab-compare.mjs`).
- 25 verifier N-ary probes (`nary-union.fs`, `nary-more.fs`, `nary2.fs`,
  `nary3.fs`): identical bodies, raw ids, counts, bounds and errors.
- `tunnel-scaling.fs` union3 (74 faces, 35526.058057 mm³) and union4 (166
  faces, 35661.256327 mm³): the same as verifier round 3.
- Corpus label `w1-casts-nary`: see section 5.

**Not solved.** Both units still exceed the corpus caps (180 s and 480 s). No
frontend change that keeps the results can remove necessary merges. The way
out is in the kernel: coalescing coplanar faces after a union, or a cheaper
arrangement. That is W2's area.

## 4. Low items

- **Assigning `undefined` removes the map key** (FsDoc variables.html). This
  holds for nested keys and definition maps too. Probe `maps-try.fs`: the
  `assignUndefined*` and `definitionFieldRemoved` features change from 27/64
  to 8 mm³.
- **`==` on the std maps compares values** (FsDoc relational.html):
  - Plane and Transform compare through their std maps (`stdMapView`);
  - a Matrix compares by its rows;
  - a caught regenError compares by its error.fs map;
  - a KeyedMap compares by its entries and tag;
  - a Query compares through `TopologyQuery.stdFields()` for the kinds whose
    std map wonky can rebuild (qCreatedBy, qUnion, qIntersection,
    qSubtraction, qEverything, qOwnedByBody). Other Queries are a capability
    error: `qNothing()` and `qUnion([])` share wonky's empty union, and
    evaluated or robust queries hold wonky records. So are two different
    exceptions that wonky raised itself.

  Probe `equality.fs`: all four features change from 64 to 8 mm³.
- **`throw` of a map**: the exception message is `display(value)`, and the
  catch variable binds the map. Before, this failed with a raw JS TypeError.
- **`throw undefined`**: the catch variable binds `undefined`, not the
  internal error object. Probe `maps-try.fs#throwUndefined`: 64 → 8 mm³.

## 5. Tests and runs

- New tests:
  - `interpreter-corpus`: "valid std casts work: map as Plane, map as
    Transform, array as Matrix, string as enum";
  - `interpreter-corpus`: "undefined removes a map key; == compares std map
    values; throw passes maps and undefined through";
  - `library-corpus`: "a SUBTRACTION that removes nothing refuses on the
    binary and the N-ary path alike; untouched targets keep their identity";
  - `library-corpus`: "the N-ary UNION re-Booleans a merged body only with
    components its tool touches" (replaced in refix 1 by "the N-ary UNION
    skips a merged body only by the bounds of its tools, and agrees with
    binary unions on vertex contact").

  `nary-union.fs repro` accepts the new step outcomes.
- W1 suites (`*-corpus`, `language*`, `modeling-policy`): 81/81 pass.
- Final `npm test` on the final tree: 1325/1332. Every failure is a load
  artefact and passes when run alone:
  - `native-bridge-slice` 157 ×2 and 467: the first two did not finish under
    load. The third found a stale divergence dump that the concurrent run
    left behind. Run alone: 25/26, and the last one passes on its own rerun.
  - `python-host-queries:155`, `python-names:156` and `:354`,
    `python-unify:45`: "Python execution exceeded". Run alone: 28/28.

  `python.test.mjs:26` (fCuboid 9.000000000000002) no longer fails on this
  tree.
- Corpus: label `w1-casts-nary` on the final tree. It uses the same
  selection as `w1-r3`: 264 records, the anchor included, concurrency 2, no
  store manifests (development evidence kept locally).
  - `compare.mjs --base w1-r3`: no transitions, no regressions, no new
    message in the same cluster, ok 8 → 8.
  - The deep diff (`tmp/w1-verify/r2/diff-runs.mjs`) finds 0 differences over
    264 records: status, message, location, failing operation, completed
    operations, and body volumes and bounds.
  - The anchor is unchanged: `model/UpperCore/g2/op`, 11 completed
    operations.
  - The same two units time out.
  - No record carries one of the new messages. The corpus has no `as Plane`,
    `as Transform`, `as Matrix` or string-to-enum cast.
  - `PropertyType.DESCRIPTION` appears 5 times, in `setProperty` calls of
    `cad-project-041/single-step-r20`. It now fails at the member access instead
    of at `setProperty`. Both are capability errors.

## 6. Refix 1 (24.09.2026)

Verifier `verify-1` found four defects in this Regression review. Its probes are in
`tmp/w1-fix-verify/`. The worklog is local development evidence.

- **N-ary SUBTRACTION kept a target unchanged when a real cut removed less
  than 1e-9 of its volume (high), and the binary path refused the same cut
  (medium).** Fixed in section 2: `removedMaterial` replaces the volume rule.
  `noop-adv.fs`: `tinyNotchNary` and `tinyNotchBinary` build HEAD's
  999999999.875 mm³ body with 24 faces again, `smallNotchNary` cuts T2 to
  999999.9999 mm³. The abutting, far, `keepTools` and `try silent` no-ops
  still refuse, and `noop-curved.fs` is unchanged.
- **The tool-first UNION test turned a refusal into two bodies (medium).**
  Withdrawn, see section 3. The six `nary-adv.fs` probes give HEAD's output,
  and `vertex-binary.fs` is unchanged.
- **`plane(origin, normal)` with a normal shorter than 1e-8 (medium).** Fixed
  in [w1-plane-axis.md](w1-plane-axis.md). All six `plane-axes.fs` features
  match the std oracle.

Tests. Each one fails on the pre-refix tree (`tmp/w1-fix-verify/tree-new`):

- `library-corpus`: "a SUBTRACTION below any relative volume threshold still
  cuts, on the binary and the N-ary path". It covers a 1.25e-4 mm³ planar
  notch and a 5e-9 mm coaxial trim.
- `library-corpus`: "the N-ary UNION skips a merged body only by the bounds of
  its tools, and agrees with binary unions on vertex contact".
- `plane-axis-corpus`: "plane(origin, normal) with a normal shorter than
  TOLERANCE.zeroLength takes x = (1, 0, 0) or fails its Plane typecheck".

Runs on the final tree:

- W1 suites (`*-corpus`, `language*`, `modeling-policy`): 83/83 pass.
- Boolean, pierce, coaxial, identity, planar-difference, curved-boolean,
  section, ray, print-mesh, step-pcurves, lang-wk-real and cli: 114/114 pass.
- 111 examples and fixtures: identical output before and after refix 1.
- r10b: unchanged failure at 25:2. `r10b.fs` is unchanged.
- Corpus label `w1-refix1` (same selection, 264 records) against
  `w1-casts-nary`: no transitions, no regressions, deep diff 0. The same two
  units time out, and no record carries a new no-op message.

Still open: the explicit-x `plane(origin, normal, x)` and the Transform-of-
Plane path check perpendicularity at 1e-7, not at std's
`TOLERANCE.zeroAngle` (1e-11). This is pre-existing and was not part of this
refix.
