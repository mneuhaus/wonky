import { fail, unsupported } from './errors.mjs';
import { real, number, vector } from './real.mjs';
import { booleanInBend } from './boolean.mjs';

export function compareBodiesInBend(kernel, before, after, { toleranceMm = 1e-7, includeGeometry = false } = {}) {
  if (!Number.isFinite(toleranceMm) || toleranceMm < 1e-9 || toleranceMm > 0.01) fail('Comparison tolerance must be between 1e-9 and 0.01 mm');
  const cylinder = body => body.primitive?.type === 'frustum' && body.primitive.r0 === body.primitive.r1;
  if (!cylinder(before) || !cylinder(after)) unsupported('Model comparison currently supports two coaxial cylinder primitives; general B-rep comparison is not implemented');
  const a = before.primitive, b = after.primitive;
  const c = kernel.comparison.coaxial(vector(a.bottom), vector(a.top), real(a.r0), vector(b.bottom), vector(b.top), real(b.r0), real(toleranceMm));
  if (!c.supported) unsupported('Model comparison currently requires coaxial cylinders within 1e-9 mm axis tolerance');
  const report = {
    schema: 'wonky-comparison/1', status: 'measured', backend: { language: 'Bend', target: 'JavaScript', precision: 'F32x2' },
    scope: 'two coaxial cylinder primitives in their existing coordinate frames',
    toleranceMm, axisDeviationMm: c.axis_deviation,
    equivalentWithinTolerance: c.equivalent,
    relation: ['separated', 'contact', 'overlap', 'withinTolerance'][c.relation],
    volumesMm3: Object.fromEntries([
      ['before', c.before_volume], ['after', c.after_volume], ['common', c.common_volume],
      ['added', c.added_volume], ['removed', c.removed_volume], ['symmetricDifference', c.symmetric_difference],
    ].map(([key, value]) => [key, number(value)])),
    minimumDistanceMm: number(c.clearance), axialOverlapLengthMm: number(c.axial_overlap),
    contactAreaMm2: c.relation === 1 ? number(c.contact_area) : null,
    evidence: { basis: 'analytic coaxial-cylinder calculations in Bend; no tessellation',
      measured: ['material added/removed/common', 'minimum distance for coaxial cylinders', 'cap contact area at coincident axial endpoints'],
      notMeasured: ['motion paths', 'general surface deviation', 'physical fit', 'render differences'] },
    limitations: ['No automatic alignment or part matching', 'No general surface distance, Hausdorff distance, or minimum translation vector', 'withinTolerance requires treating the contact/overlap classification as unresolved'],
  };
  if (includeGeometry) {
    // Geometry is all-or-error: never publish a partly constructed diff.
    report.geometry = {
      added: booleanInBend(kernel, after, before, 'SUBTRACTION', 'added'),
      removed: booleanInBend(kernel, before, after, 'SUBTRACTION', 'removed'),
      common: booleanInBend(kernel, before, after, 'INTERSECTION', 'common'),
    };
  }
  return report;
}
