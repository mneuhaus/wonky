import { existsSync } from 'node:fs';
// Every documented invocation under fixtures/corpus-repro/ with the outcome its
// README states. Independent verification (docs/corpus/run.md "Verifikation").
//
// role: 'cluster'  = stands for the first blocker of corpus units in `cluster`;
//                    its message pattern must be one the cluster holds;
//       'control'  = documented to build;
//       'next'     = documented next/later blocker (not the cluster's first blocker).
// expect.err: substring of the CLI's stderr; expect.out: substring of stdout.
const R = 'fixtures/corpus-repro';
const fs = (file, feature, cluster, role, expect, extra = []) => ({
  id: `${file}${feature ? '#' + feature : ''}${extra.length ? ' ' + extra.join(' ') : ''}`, cluster, role, expect,
  argv: ['bin/wonky.mjs', `${R}/${file}`, ...(extra.includes('--format') ? [] : ['--check']), ...(feature ? ['--feature', feature] : []), ...extra],
});
const py = (file, cluster, role, expect, python = 'tmp/corpus/uv-python', extra = []) => ({
  id: file, cluster, role, expect, argv: ['bin/wonky-python.mjs', `${R}/${file}`, '--check', '--python', python, ...extra],
});
const fail = err => ({ exit: 1, err });
const builds = out => ({ exit: 0, out });

export const REPROS = [
  // ---------------------------------------------------------------- top-level README
  fs('string-function-keyword.fs', null, 'fs-parser-syntax', 'cluster', fail("10:57: Expected '(', found '}'")),
  fs('try-block-statement.fs', null, 'fs-parser-syntax', 'cluster', fail("10:20: Expected '(', found '{'")),
  fs('for-in-key-value.fs', null, 'fs-parser-syntax', 'cluster', fail("10:19: Expected ';', found ','")),
  fs('annotation-filter-and.fs', null, 'fs-interpreter-semantics', 'cluster', fail('10:50: FeatureScript conditions must be boolean')),
  fs('feature-parameter-defaults.fs', null, 'fs-interpreter-semantics', 'cluster', fail('12:9: Expected a length with units')),
  fs('op-transform.fs', null, 'fs-missing-builtin', 'cluster', fail("9:9: 'opTransform' is not defined")),
  fs('fs-missing-builtin/op-transform-pose.fs', null, 'fs-missing-builtin', 'cluster', fail("24:9: 'opTransform' is not defined")),
  fs('fs-missing-builtin/std-queries.fs', 'robustEverything', 'fs-missing-builtin', 'cluster', fail("23:19: 'makeRobustQuery' is not defined")),
  fs('fs-missing-builtin/std-queries.fs', 'containsPoint', 'fs-missing-builtin', 'cluster', fail("34:19: 'qContainsPoint' is not defined")),
  fs('fs-missing-builtin/std-queries.fs', 'idFromString', 'fs-missing-builtin', 'cluster', fail("43:28: 'makeId' is not defined")),
  fs('fs-missing-builtin/op-revolve.fs', 'sleeve', 'fs-missing-builtin', 'cluster', fail("21:9: 'opRevolve' is not defined")),
  fs('fs-missing-builtin/op-revolve.fs', 'reliefCone', 'fs-missing-builtin', 'cluster', fail("32:9: 'opRevolve' is not defined")),
  fs('fs-missing-builtin/pure-values.fs', 'atan2Angle', 'fs-missing-builtin', 'cluster', fail("24:17: 'atan2' is not defined")),
  fs('fs-missing-builtin/pure-values.fs', 'rotatedCopy', 'fs-missing-builtin', 'cluster', fail("38:33: 'rotationAround' is not defined")),
  fs('fs-missing-builtin/pure-values.fs', 'mirroredCopy', 'fs-missing-builtin', 'cluster', fail("55:33: 'mirrorAcross' is not defined")),
  fs('fs-missing-builtin/integer-bound.fs', 'integerBound', 'fs-missing-builtin', 'cluster', fail("18:25: 'unitless' is not defined")),
  fs('fs-missing-builtin/integer-bound.fs', 'plainBox', 'fs-missing-builtin', 'cluster', fail("18:25: 'unitless' is not defined")),
  fs('fs-missing-builtin/next-countersink-breakout.fs', 'countersink', 'boolean-capability', 'next', fail('57:9: opBoolean supports coaxial cylinder primitives')),
  fs('fs-missing-builtin/next-countersink-breakout.fs', 'hole', null, 'control', builds('1067.162392 mm³')), // W2: F32x2 prism (was 1067.162397 with F32)
  fs('fs-missing-builtin/next-pierced-web-step.fs', 'headPilot', 'boolean-capability', 'next', fail('56:9: opBoolean through holes need a tool axis perpendicular to exactly two faces of the target')),
  // W2: the F32x2 web makes the hole exact (116252.868455 mm³ = closed form; F32 gave 116252.854131)
  // and the STEP export resolves its cylindrical parameter curves (validate-step: valid).
  fs('fs-missing-builtin/next-pierced-web-step.fs', 'footHole', null, 'control', builds('repro-footHole/model.step'),
    ['--format', 'step', '--out', 'tmp/corpus/verify/out/repro-footHole/model']),
  fs('fs-module-import/part-studio-import.fs', null, 'fs-module-import', 'cluster', fail("13:23: Unresolved Onshape module 'Parts': d9c8543f8a347821ee2e2194 at version 188904c7a670c9866e4b06de")),
  fs('fs-headerless-include/geometry-body.fs', null, 'fs-headerless-include', 'cluster', fail("6:1: Expected 'FeatureScript', found 'function'")),
  // W5 integration (2026-09-23): runner sys.path, name table and use-site columns.
  py('python-local-import/part.py', null, 'control', builds('6 faces · 1000 mm³')),
  py('py-api-surface/named-import.py', 'py-api-surface', 'cluster', fail('9:10: build123d.Part is not implemented by the Python frontend')),
  py('py-api-surface/wildcard-annotation.py', null, 'control', builds('6 faces · 800 mm³')),
  py('py-api-surface/submodule-import.py', null, 'next', fail("8: NameError: name 'Box' is not defined")),
  // W2 integrate fix: built 114 faces · 10869.511374 mm³ before W2 (F32); the F32x2 rigid transform of Pos(...) * Box(...)
  // split the two tops (5.89 + 5.89, 5.05 + 6.73) by a last word (AmbiguousContact). A translation of a prism is now the
  // prism of its binary64-summed caps (src/kernel.mjs translatedPrismInputs): 10869.5112 = 56·29.44·11.78 − 52.64·24.4·10.1 + 17.94·24.4·10.1.
  py('py-api-surface/next-box-chain.py', null, 'control', builds('114 faces · 10869.5112 mm³'), undefined, ['--timeout-ms', '170000']),

  // ---------------------------------------------------------------- boolean-capability
  fs('boolean-capability/coaxial-revolution.fs', 'ringUnion', 'boolean-capability', 'cluster', fail('61:9: opBoolean supports coaxial cylinder primitives')),
  fs('boolean-capability/coaxial-revolution.fs', 'countersunkHead', 'boolean-capability', 'cluster', fail('70:9: opBoolean supports coaxial cylinder primitives')),
  // W2: the F32x2 prism's cap normal equals the hole axis, so the oblique hole is admitted and exact.
  fs('boolean-capability/through-hole-admission.fs', 'obliqueHole', null, 'control', builds('6 faces · 84837.410962 mm³')),
  fs('boolean-capability/through-hole-admission.fs', 'steppedHole', 'boolean-capability', 'cluster', fail('61:5: opBoolean through holes need a tool axis perpendicular to exactly two faces of the target')),
  // W2 pierce gate: a ranged circle edge gets its own refusal; ranged lines pass the gate.
  fs('boolean-capability/through-hole-admission.fs', 'arcPlateHole', 'boolean-capability', 'cluster', fail('61:5: opBoolean through holes do not admit arc edges yet')),
  fs('boolean-capability/through-hole-admission.fs', 'unitedPlateHole', 'boolean-capability', 'cluster', fail('61:5: opBoolean through holes need a tool axis perpendicular to exactly two faces of the target')),
  fs('boolean-capability/general-trimmed-face.fs', 'socketHex', 'boolean-capability', 'cluster', fail('57:5: opBoolean supports coaxial cylinder primitives')),
  fs('boolean-capability/general-trimmed-face.fs', 'bandNotch', 'boolean-capability', 'cluster', fail('57:5: opBoolean supports coaxial cylinder primitives')),
  fs('boolean-capability/general-trimmed-face.fs', 'bossUnion', 'boolean-capability', 'cluster', fail('62:5: opBoolean supports coaxial cylinder primitives')),
  fs('boolean-capability/general-trimmed-face.fs', 'ringBoss', 'boolean-capability', 'cluster', fail('62:5: opBoolean supports coaxial cylinder primitives')),
  fs('boolean-capability/general-trimmed-face.fs', 'spokeTrim', 'boolean-capability', 'cluster', fail('57:5: opBoolean through hole must land in material; this axis misses the face it would pierce')),
  fs('boolean-capability/nary-union.fs', 'threeToolUnion', 'boolean-capability', 'cluster', fail('34:9: opBoolean currently requires two tools for union/intersection, or one target and one tool for subtraction')),
  fs('boolean-capability/nary-union.fs', 'bridgedThreeToolUnion', 'boolean-capability', 'cluster', fail('48:9: opBoolean currently requires two tools for union/intersection, or one target and one tool for subtraction')),

  // ---------------------------------------------------------------- boolean-invalid-topology
  // W2 (docs/corpus/w2.md): F32x2 polygon prisms; the former InvalidTopology repros build.
  fs('boolean-invalid-topology/wedge-union.fs', 'slanted', null, 'control', builds('40 faces · 319 mm³')),
  fs('boolean-invalid-topology/wedge-union.fs', 'diag45', null, 'control', builds('40 faces · 394')),
  fs('boolean-invalid-topology/wedge-union.fs', 'square', null, 'control', builds('42 faces · 494')),
  fs('boolean-invalid-topology/slanted-prism-union.fs', null, null, 'control', builds('52 faces · 206767.2 mm³')),
  fs('boolean-invalid-topology/slanted-prism-cut.fs', null, null, 'control', builds('45 faces · 48766.666667 mm³')),
  fs('boolean-invalid-topology/rotated-box-cut.fs', null, null, 'control', builds('6 faces · 36339.234517 mm³')),
  fs('boolean-invalid-topology/slanted-prism-intersection.fs', null, null, 'control', builds('10 faces · 43659.488134 mm³')),
  fs('boolean-invalid-topology/many-vertex-prism-cut.fs', null, 'boolean-invalid-topology', 'cluster', fail('37:9: Native planar arrangement subtraction unresolved: UnsupportedArrangement (stage 1, detail 0)')),
  fs('boolean-invalid-topology/next-blocker-chamfer.fs', 'chamferOnEdge', null, 'control', builds('10 faces · 2170 mm³')),
  fs('boolean-invalid-topology/next-blocker-chamfer.fs', 'slantedCut', null, 'control', builds('11 faces · 2285.694444 mm³')),
  fs('boolean-invalid-topology/next-blocker-chamfer.fs', 'chamfer45', null, 'control', builds('20 faces · 1904')),

  // ---------------------------------------------------------------- fs-headerless-include
  fs('fs-headerless-include/interface.fs', null, null, 'control', builds('6 faces · 600 mm³')),
  fs('fs-headerless-include/paste-in.fs', null, 'fs-headerless-include', 'cluster', fail("5:1: Expected 'FeatureScript', found 'annotation'")),
  fs('fs-headerless-include/next-string-minus.fs', null, 'fs-parser-syntax', 'next', fail("8:17: Unsupported expression ';'")),

  // ---------------------------------------------------------------- fs-interpreter-semantics
  fs('fs-interpreter-semantics/length-bounds-default.fs', null, 'fs-interpreter-semantics', 'cluster', fail('13:9: Expected a length with units')),
  fs('fs-interpreter-semantics/boolean-default.fs', null, 'fs-interpreter-semantics', 'cluster', fail('12:9: Feature precondition failed')),
  fs('fs-interpreter-semantics/annotation-filter-and.fs', null, 'fs-interpreter-semantics', 'cluster', fail('15:50: FeatureScript conditions must be boolean')),
  fs('fs-interpreter-semantics/angle-bound-spec.fs', null, 'fs-interpreter-semantics', 'cluster', fail('8:14: Expected AngleBoundSpec')),
  fs('fs-interpreter-semantics/color-type-tag.fs', null, 'fs-interpreter-semantics', 'cluster', fail('16:9: Expected Color')),
  fs('fs-interpreter-semantics/units-source-error.fs', null, 'fs-interpreter-semantics', 'cluster', fail('15:22: Incompatible units in expression')),
  // W2 pierce gate: ranged line edges reach the kernel's own admission.
  fs('fs-interpreter-semantics/next/lochwand-hole-in-notched-panel.fs', null, 'boolean-capability', 'next', fail('29:9: opBoolean through holes need a tool axis perpendicular to exactly two faces of the target')),
  fs('fs-interpreter-semantics/next/blind-pilot-in-stepped-body.fs', null, 'boolean-capability', 'next', fail('31:9: opBoolean through holes need a tool axis perpendicular to exactly two faces of the target')),

  // ---------------------------------------------------------------- fs-module-import
  fs('fs-module-import/feature-studio-import.fs', null, 'fs-module-import', 'cluster', fail("12:5: Unresolved Onshape module 'SourceR11'")),
  fs('fs-module-import/local-path/main.fs', null, 'fs-module-import', 'cluster', fail("12:5: Unresolved Onshape module 'M3': ./lib.fs at version local")),
  fs('fs-module-import/snapshot/idioms.fs', 'nameLookup', null, 'control', builds('10 faces')),
  fs('fs-module-import/snapshot/idioms.fs', 'instantiatorIdQuery', null, 'next', fail('42:15: qCreatedBy(instantiator id) found 0 bodies; Onshape finds 1')),
  fs('fs-module-import/snapshot/idioms.fs', 'noLoadedContext', null, 'next', fail('51:5: loadedContext must belong to the specified frozen module build')),
  fs('fs-module-import/snapshot/idioms.fs', 'instanceTransform', null, 'next', fail("62:5: addInstance field 'transform' is not implemented")),
  fs('fs-module-import/snapshot/idioms.fs', 'sourceFeatureId', 'fs-missing-builtin', 'next', fail("74:89: 'makeId' is not defined")),
  fs('fs-module-import/snapshot/idioms.fs', 'containsPoint', 'fs-missing-builtin', 'next', fail("85:68: 'qNthElement' is not defined")),
  fs('fs-module-import/snapshot/idioms.fs', 'importedVolume', null, 'control', builds('10 faces')),
  fs('fs-module-import/snapshot/idioms.fs', 'importedBox', null, 'next', fail('111:5: Tight bounds over analytic imported faces are not implemented')),
  fs('fs-module-import/snapshot/idioms.fs', 'nameLookup', 'fs-module-import', 'next', fail('Frozen module manifest does not match the FeatureScript source SHA-256'), ['--modules', 'fixtures/r10b/modules.json']),

  // ---------------------------------------------------------------- fs-needs-partstudio-input
  fs('fs-needs-partstudio-input/modify-existing-part.fs', null, 'fs-needs-partstudio-input', 'cluster', fail('15:19: Derive exactly one source part into this Part Studio first')),
  fs('fs-needs-partstudio-input/volume-selected-source.fs', null, 'fs-needs-partstudio-input', 'cluster', fail('14:15: Expected exactly the declared current TOP source body; matching count=0')),
  fs('fs-needs-partstudio-input/source-block.fs', null, null, 'control', builds('6 faces · 8000 mm³')),
  fs('fs-needs-partstudio-input/catch-without-binding.fs', null, 'fs-parser-syntax', 'cluster', fail("14:143: Expected '(', found '{'")),
  fs('fs-needs-partstudio-input/next-blocker-fixed-frame-n3.fs', null, 'boolean-invalid-topology', 'next', fail('33:9: Native planar arrangement subtraction unresolved: AmbiguousContact (stage 2, detail 15)')), // W2: past InvalidTopology
  fs('fs-needs-partstudio-input/next-blocker-line-arc-joins.fs', 'tinyFilletArcJoin', null, 'next', fail('27:9: Native line/arc sketch unsupported: SelfIntersectionOrTouch')),
  fs('fs-needs-partstudio-input/next-blocker-line-arc-joins.fs', 'splitStraightEdge', null, 'next', fail('46:9: Native line/arc sketch unsupported: SelfIntersectionOrTouch')),

  // ---------------------------------------------------------------- kernel-sketch-and-ops
  // W2 (docs/corpus/w2.md): cap normals, collinear merge, 4096-vertex limit and the pierce gate.
  fs('kernel-sketch-and-ops/cap-normal-far-from-origin.fs', 'tiltedOctagonFar', null, 'control', builds('10 faces · 7677.8832 mm³')),
  fs('kernel-sketch-and-ops/cap-normal-far-from-origin.fs', 'tiltedRectangleFar', null, 'control', builds('6 faces · 1454.4 mm³')),
  fs('kernel-sketch-and-ops/cap-normal-far-from-origin.fs', 'tiltedOctagonNear', null, 'control', builds('10 faces · 7677.88')),
  fs('kernel-sketch-and-ops/through-hole-tilted-panel.fs', null, null, 'control', builds('7 faces · 62690.946551 mm³')),
  fs('kernel-sketch-and-ops/loft-two-polygons.fs', 'prismatoid', 'kernel-sketch-and-ops', 'cluster', fail('27:9: opLoft currently requires two coaxial circular profiles')),
  fs('kernel-sketch-and-ops/loft-two-polygons.fs', 'twistedOctagon', 'kernel-sketch-and-ops', 'cluster', fail('36:9: opLoft currently requires two coaxial circular profiles')),
  fs('kernel-sketch-and-ops/loft-two-polygons.fs', 'squareToCircle', 'kernel-sketch-and-ops', 'cluster', fail('47:9: opLoft currently requires two coaxial circular profiles')),
  fs('kernel-sketch-and-ops/loft-tapered-slot.fs', 'taperedSlot', 'kernel-sketch-and-ops', 'next', fail('32:9: opLoft currently requires two coaxial circular profiles')),
  fs('kernel-sketch-and-ops/loft-tapered-slot.fs', 'slotExtrudeControl', null, 'control', builds('6 faces · 7865.574951')),
  fs('kernel-sketch-and-ops/collinear-polyline-vertex.fs', null, null, 'control', builds('6 faces · 1600 mm³')),
  fs('kernel-sketch-and-ops/profile-over-256-vertices.fs', null, null, 'control', builds('302 faces · 2513.090386 mm³')),
  fs('kernel-sketch-and-ops/line-arc-sketch-with-holes.fs', null, 'kernel-sketch-and-ops', 'cluster', fail('18:9: A line/arc sketch cannot mix entities with rectangle, polyline or circle profiles')),
  fs('kernel-sketch-and-ops/next-pierce-after-copy.fs', null, null, 'control', builds('8 faces · 3919.575228 mm³')),
  fs('kernel-sketch-and-ops/next-tilted-pocket-subtraction.fs', null, 'boolean-invalid-topology', 'next', fail('27:9: Native planar arrangement subtraction unresolved: UnsupportedArrangement (stage 6, detail 0)')),

  // ---------------------------------------------------------------- py-imports
  py('py-imports/local-module/part.py', null, 'control', builds('6 faces · 1000 mm³')),
  py('py-imports/installed-package/part.py', 'py-imports', 'cluster', fail("8:1: Python package 'numpy' is not available to wonky models"), 'fixtures/corpus-repro/py-imports/installed-package/python-with-numpy'),
  py('py-imports/build123d-submodule/part.py', null, 'control', builds('6 faces · 1000 mm³')),
  py('py-imports/control-syspath/part.py', null, 'control', builds('6 faces · 1000 mm³')),
  // py-khana (decision 3): cad_khana modeling API and the package policy.
  py('py-khana/assembly/assembly.py', null, 'control', builds('"pin_right": 2 vertices · 3 edges · 3 faces · 56.548668 mm³')),
  py('py-khana/corpus-color/assembly.py', null, 'control', builds('"hood": 8 vertices · 12 edges · 6 faces · 24000 mm³')),
  py('py-khana/check-in-main/assembly.py', null, 'next', fail('18:5: cad_khana.mechanism.check.check() is a cad_khana diagnostic that wonky does not provide')),
  py('py-khana/diagnostic-caught/part.py', null, 'next', fail('10:12: cad_khana.printability.inspect.inspect() is a cad_khana diagnostic that wonky does not provide')),
  py('py-khana/external-package/part.py', 'py-imports', 'cluster', fail("4:1: Python package 'bd_warehouse' is not available to wonky models")),
].filter(r => !r.id.startsWith('fs-module-import/snapshot/') || existsSync(new URL('../../../fixtures/corpus-repro/fs-module-import/snapshot/idioms.fs', import.meta.url)));
