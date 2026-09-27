# Repros: cluster boolean-capability

Minimal FeatureScript inputs for the corpus cluster "opBoolean outside the
admitted Boolean paths" ([analysis](../../../docs/corpus/cluster-boolean-capability.md)).
Each feature is one real corpus failure reduced to the refused `opBoolean` and
the operations that build its operands. Corpus numbers are kept where the
failure depends on them. The files do not read anything from `~/Workspace/cad`.

Checked on 2026-09-23 (00:38, and again at 04:13 against the unchanged production
Boolean code) with the production CLI on the default JS path:
`node bin/wonky.mjs fixtures/corpus-repro/boolean-capability/<file> --check --feature <feature>`.
The messages are shortened after the first clause; all four are exactly the
corpus messages of the cluster. Each feature runs in 0 to 3 s.

| file `#feature` | sub-cause | stands for (corpus units) | observed |
|---|---|---|---|
| `coaxial-revolution.fs#ringUnion` | coaxial-revolution | fs95 ring unions (56) | `61:9: opBoolean supports coaxial cylinder primitives, … general trimmed-face booleans are not implemented` |
| `coaxial-revolution.fs#countersunkHead` | coaxial-revolution | countersunk screws: cylinder ∪ cone (26) | `70:9:` same message |
| `through-hole-admission.fs#obliqueHole` | pierce-admission (oblique caps) | hopper panels fs421/fs269/fs244 (13) | `61:5: opBoolean through holes need a tool axis perpendicular to exactly two faces of the target` |
| `through-hole-admission.fs#steppedHole` | pierce-admission (extra perpendicular faces) | fs87/fs88 diagonals (4) | `61:5:` same as above |
| `through-hole-admission.fs#arcPlateHole` | pierce-admission (arc edges) | fs422/fs425 guides (8) | `61:5: opBoolean supports coaxial cylinder primitives, …` (the pierce gate excludes ranged edges) |
| `through-hole-admission.fs#unitedPlateHole` | pierce-admission (ranged line edges) | switchPinCapR4, drilledHangerU2, upperMotorHanger (3) | `61:5:` general message |
| `general-trimmed-face.fs#socketHex` | general | hex sockets in coaxial screws fs95/fs88/fs273 (18) | `57:5:` general message |
| `general-trimmed-face.fs#bandNotch` | general | channel bases fs398/fs550/fs386 (16) | `57:5:` general message |
| `general-trimmed-face.fs#bossUnion` | general | rounded ends (stadium unions) fs276/fs398/fs509 (6) | `62:5:` general message |
| `general-trimmed-face.fs#ringBoss` | general | fs95 screw bosses on ring walls (next blocker of 28) | `62:5:` general message |
| `general-trimmed-face.fs#spokeTrim` | general-trim | fs95 bottomSpoke/switchBracket, fs88 motorBracket (10) | `57:5: opBoolean through hole must land in material; this axis misses the face it would pierce` |
| `nary-union.fs#threeToolUnion` | nary | `unite(context, id, [a, b, c])` helpers (13) | `34:9: opBoolean currently requires two tools for union/intersection, or one target and one tool for subtraction` |
| `nary-union.fs#bridgedThreeToolUnion` | nary (first two tools disjoint, the third connects them) | fs95 `motorBracket` `join` | `48:9:` same as above |

After W1 (2026-09-23), production `opBoolean` is N-ary
(`ModelingContext.naryBoolean`): both `nary-union.fs` features build one body
of 15000 mm³ with the production CLI. See
[docs/corpus/w1.md](../../../docs/corpus/w1.md).

## Through the bake-off route

`node scripts/corpus/boolean-bakeoff.mjs` freezes the operands of each refused
`opBoolean` (production probe), runs them through the corefine mesh Boolean
and the recover prototype (native CPU builds), exports STEP with the kernel's
serializer and measures it with OpenCascade. Results:
`out/corpus/boolean-capability/bakeoff.json`.

| repro | result | volume vs closed form |
|---|---|---|
| ringUnion, countersunkHead, steppedHole, arcPlateHole, unitedPlateHole, socketHex, bandNotch, spokeTrim | exact: OCCT-valid STEP | ≤ 2.4e-14 relative |
| obliqueHole | recovered, but the kernel's cylinder pcurve export refuses it (`InvalidSource`): the rims are circles on the F64 tool axis, the caps are the planar kernel's F32 planes, tilted by 3e-7 rad | – |
| bossUnion | recover refuses: `mesh boundary does not traverse its exact curve once` (plane tangent to the cylinder at the stadium corners) | – |
| ringBoss | recover refuses: `cylinder/cylinder intersection off a common axis is a space quartic` (the axes are parallel, so the exact curves are lines) | – |

Both N-ary features build one body of 15000 mm³ (closed form: 6000 + 2 × 4500)
once the call is decomposed into binary calls
(`WONKY_CORPUS_STUB=nary node scripts/corpus/boolean-probe.mjs <file> <feature>`).
`bridgedThreeToolUnion` needs the component-aware decomposition: a left fold
that continues with the first result body returns two bodies, because the
first pair is disjoint.

## With F32x2 prisms (simulation)

With every polygon prism built by the existing F32x2 line/arc extruder
(`WONKY_CORPUS_SIMULATE=linearc node scripts/corpus/boolean-probe.mjs <file> <feature>`,
the fix proposed by the boolean-invalid-topology analysis), `obliqueHole`,
`steppedHole`, `unitedPlateHole`, `bossUnion` and `spokeTrim` all refuse with
the general message. Every F32x2 prism edge carries a `curveRange` (18 of 18
on `steppedHole`), and the pierce gate (`src/boolean.mjs:108`) keeps ranged
edges out. That fix therefore needs the gate to admit ranged lines at the
same time.
