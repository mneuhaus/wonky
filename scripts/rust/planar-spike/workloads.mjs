// The planar-Boolean workloads of the decision spike (docs/rust-spike.md S3),
// with every input inside this repository: the build123d and FeatureScript
// cases were already fixtures; the R20 kernel case kt6_coplanar_union is frozen
// under fixtures/rust/planar-spike/inputs (provenance.json) instead of being
// read from the live CAD tree.
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const fixtures = join(root, 'fixtures/rust/planar-spike');
export const work = join(root, 'tmp/rust/planar-spike');
const venv = join(root, 'out/build123d-performance/reference-venv/bin/python');
const py = name => ['bin/wonky-python.mjs', `fixtures/performance-build123d/cases/${name}.py`, '--python', venv];

export const WORKLOADS = [
  { id: 'py-planar-union', argv: py('planar-union'), inputs: ['fixtures/performance-build123d/cases/planar-union.py'] },
  { id: 'py-planar-pocket', argv: py('planar-pocket'), inputs: ['fixtures/performance-build123d/cases/planar-pocket.py'] },
  { id: 'py-frame-with-tab', argv: py('frame-with-tab'), inputs: ['fixtures/performance-build123d/cases/frame-with-tab.py'] },
  { id: 'fs-fuse-g1', argv: ['bin/wonky.mjs', 'fixtures/public-boolean-regressions/adapted/fuse-g1.fs', '--format', 'step'], inputs: ['fixtures/public-boolean-regressions/adapted/fuse-g1.fs'] },
  { id: 'fs-cut-h1', argv: ['bin/wonky.mjs', 'fixtures/public-boolean-regressions/adapted/cut-h1.fs', '--format', 'step'], inputs: ['fixtures/public-boolean-regressions/adapted/cut-h1.fs'] },
  { id: 'r20-kt6', argv: ['bin/wonky.mjs', 'fixtures/rust/planar-spike/inputs/kt6_coplanar_union/case.fs', '--feature', 'kt6CoplanarUnion', '--format', 'print', '--deviation-mm', '0.01'], inputs: ['fixtures/rust/planar-spike/inputs/kt6_coplanar_union/case.fs'] },
];
