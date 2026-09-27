#!/usr/bin/env node
// CAD lead's actionable list, assembled from the real CLI diagnostics, never
// from edited/skipped features. Retire the generated list after the snapshot's
// CAD/kernel corrections have been validated; regenerate for a new revision.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { carrierHint } from './carrier-hints.mjs';

const [snapshotArg, outputArg] = process.argv.slice(2);
if (!snapshotArg || !outputArg) throw new Error('Usage: node scripts/r20/diagnostics.mjs <frozen-snapshot> <diagnostic-output>');
const snapshot = resolve(snapshotArg), output = resolve(outputArg);
const manifest = JSON.parse(readFileSync(join(snapshot, 'manifest.json')));
const read = path => JSON.parse(readFileSync(path));
const cases = new Map(), exports = new Map();
for (const module of ['tray', 'return', 'cores', 'feed', 'probe', 'edge']) {
  const dir = join(output, module), fallbackDir = join(dir, 'fallbacks');
  const exportManifest = join(dir, 'tessellate-manifest.json');
  if (existsSync(exportManifest)) for (const [part, row] of Object.entries(read(exportManifest).parts))
    exports.set(part, { module, row, diagnostic: exportManifest });
  if (existsSync(fallbackDir)) for (const file of readdirSync(fallbackDir).filter(file => file.endsWith('.json'))) {
    const record = read(join(fallbackDir, file));
    const part = file.slice(0, -5);
    cases.set(part, { module, record, diagnostic: join(fallbackDir, file) });
  }
  if (existsSync(join(dir, 'error.json'))) {
    const error = read(join(dir, 'error.json'));
    if (error.dump) {
      const diagnostic = join(dir, error.dump), record = read(diagnostic);
      // The operation id, not a guessed part NAME, identifies the refused part.
      const part = record.operation.operationId?.split('/')[1] ?? 'unknown';
      cases.set(part, { module, record: { current: record.refusal, history: [] }, diagnostic });
    }
  }
}
const required = ['T01', 'HUB_R', 'ARM_R', 'P01', 'HUB_L', 'ARM_L', 'RET_HUB', 'K15', 'CORE_L', 'CORE_R', 'P03B_B', 'MOTOR_MOUNT_L', 'RACK'];
const degenerate = new Set(required.slice(4, 12));
const missingAccessors = new Set();
const rows = required.map(part => {
  const found = cases.get(part);
  if (!found) {
    const exported = exports.get(part);
    // Main may have recovered a former fallback. Cite the real export instead
    // of inventing a failing carrier pair (T01 after r20-exact).
    if (exported?.row.wonky?.exact === true && exported.row.wonky.approximation === null)
      return { part, module: exported.module, status: 'exact-export', diagnostic: exported.diagnostic,
        reason: 'Current kernel exported this part exactly; no fallback/refusal carrier pair was emitted.',
        carriers: [], residualMm: null, gapMm: null, hint: 'resolved: exact export', cadChange: null };
    return { part, status: 'not-observed', reason: 'No fallback/refusal diagnostic or exact export was produced for this part', carriers: [], residualMm: null, gapMm: null,
      cadChange: 'No targeted CAD change is justified without a diagnostic for this part.' };
  }
  const { module, record, diagnostic } = found, records = [record.current, ...record.history];
  const selected = degenerate.has(part) ? records.find(row => /degenerate vertex/.test(row.reason)) ?? record.current : record.current;
  const missing = selected.missing ?? (selected.carriers?.length ? null : 'Refusal has no carrier tags');
  if (missing) missingAccessors.add(`${part}: ${missing}; need recover's failing boundary-run carrier tags (and measured residual/gap when computed) in the JS-visible result. No kernel/hybrid files were changed.`);
  for (const carrier of selected.carriers ?? []) for (const origin of carrier.provenance ?? []) if (origin.missing) missingAccessors.add(`${part}: ${origin.missing} (${origin.operationId ?? carrier.bodyId}, face ${carrier.faceIndex})`);
  const arcs = (selected.carriers ?? []).flatMap(c => c.provenance ?? []).filter(p => p.sketchEntityId).map(p => `${p.sketchId}/${p.sketchEntityId}`);
  const advice = missing ? null : carrierHint(selected);
  const cadChange = missing
    ? 'Do not infer a near-tangent sketch defect from a missing curve-type capability; obtain the failing carrier pair before choosing a targeted contour edit.'
    : `Construct ${arcs.join(' and ') || 'the named sketch features'} with a shared exact tangency, or remove the dependent corner by changing the intended contour; tolerance widening is not a geometric repair.`;
  return { part, module, featureType: manifest.modules[module].featureType, status: missing ? 'missing-accessor' : 'located', diagnostic,
    reason: selected.reason ?? selected.message, residualMm: selected.residualMm ?? null, gapMm: selected.gapMm ?? null,
    determinant: selected.determinant ?? null, meshVertex: selected.meshVertex ?? null, meshVertexMm: selected.meshVertexMm ?? null,
    carriers: selected.carriers ?? [], ...(missing ? { missing } : {}),
    currentReason: record.current.reason ?? record.current.message,
    relatedReasons: [...new Set(records.map(r => r.reason ?? r.message))], cadChange, ...advice };
});
const target = join(output, 'r20-near-tangent.json');
writeFileSync(target, JSON.stringify({ schema: 'wonky-r20-carrier-cases/1', snapshot, units: 'millimeter',
  parameters: { withBlends: false }, requestedDeviationMm: 0.01,
  scope: '13 requested cases; original carrier parameters and kernel measurements, not inferred tangency errors. Three-carrier corners retain all three carriers. A null residual/gap was not reported by the kernel.',
  rows, missingAccessors: [...missingAccessors] }, null, 2) + '\n');
console.log(target);
const lines = rows.map(row => `${row.part}: ${row.status}: ${row.reason}`
  + (row.gapMm !== null ? `; leaf gap ${row.gapMm} mm; carrier distance ${row.carrierDistanceMm ?? 'unavailable'} mm` : '')
  + (row.tangency ? `; tangency uncertainty ${row.tangency.uncertaintyMm} mm` : '')
  + (row.hint ? `; ${row.hint}` : ''));
writeFileSync(join(output, 'r20-near-tangent.txt'), lines.join('\n') + '\n');
for (const line of lines) console.log(line);
