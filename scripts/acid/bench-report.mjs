// Benchmark selection and report arithmetic; never creates kernel PASS evidence.
import {VARIANTS, sha256} from './common.mjs';
import {canonical} from './evidence.mjs';
import {scoreVariant} from './score.mjs';

export function checkOcctRepeat(catalog, zone, qualified, observation, errata) {
  // Reuse the scorer's branch/band policy, including sliverBound. The frozen
  // roundtrip remains a reference here, NOT a claim of a new sample roundtrip.
  const verdict = scoreVariant(catalog, zone, 'occt', {...qualified, metrics: observation}, qualified, {errata});
  if (verdict.strictStatus !== 'PASS') return `scorer repeat check ${verdict.strictStatus}: ${verdict.reason}`;
  if (canonical(observation.topology) !== canonical(qualified.metrics.topology)) return 'topology differs from frozen observation';
  const a = observation.bbox, b = qualified.metrics.bbox;
  if (!(a === null && b === null) && (!a || !b || !['min', 'max'].every(side =>
    [0, 1, 2].every(i => Math.abs(a[side][i] - b[side][i]) <= zone.tolerance.bboxAbsMm.tolerance)))) return 'bbox differs from frozen observation';
  return null;
}

// Repeat binding, not a new correctness verdict: hash the qualifying observation
// fields after canonical key ordering so transport/object insertion order is irrelevant.
export function geometryDigest(metrics) {
  return sha256(canonical({topology: metrics.topology, volume: metrics.volume, bbox: metrics.bbox}));
}

export const PHASES = ['constructionMs', 'twinCallMs', 'measurementMs', 'exportMs', 'warmPipelineMs', 'peakRssMiB', 'nativeBoundaryMs', 'kernelOnlyMs'];
export const ADDITIVE_PHASES = ['constructionMs', 'measurementMs', 'exportMs'];
const COLD_PHASES = ['coldStartMs', 'coldPeakRssMiB'];
export const phaseDefinitions = {
  coldStartMs: 'Parent wall time through fresh process exit: Node + direct addon require; OCCT: uv run --no-project + Python + import OCP. Includes launch/scheduling/exit and tiny RSS/result reporting; no FS/build123d import, stale check or construction. OS page cache is NOT flushed. uv overhead is included only for OCCT.',
  constructionMs: 'Warm process, fresh model each repetition. Wonky: production build(), FS parsing/interpreting/module resolution + strict Rust ops, including construction-time validation and normal tracing; source text pre-read, addon/frontend loaded. OCCT: cached Python module build twin call + labelled-body/compound assembly. Imports excluded; no reused geometry. Frontends differ. OCCT twinCallMs also records the exact twin call alone.',
  twinCallMs: 'OCCT only: Python twin entrypoint call itself, excluding the benchmark harness compound assembly. Subset of constructionMs, not additional work. Wonky has no matching Python entrypoint; its value and ratio are null.',
  coldPeakRssMiB: 'Peak RSS of the cold-start Node/Python process, separate from warm worker RSS. Excludes uv and parent. Totals use maximum, never sum.',
  nativeBoundaryMs: 'Wonky construction only: summed synchronous addon.hostOp/addon.call wall time, including N-API copying, native decode/audit/encode and construction-time measurement. Benchmark wrapper overhead affects construction. NOT pure Rust algorithm time. No comparable OCCT boundary instrumentation; its value and the ratio are null.',
  kernelOnlyMs: 'Unavailable on both backends: neither exposes a comparable pure-kernel timer here. Null, never inferred by subtracting frontend time.',
  measurementMs: 'Wonky: the scored native observation on live bodies, including measureRustBody, body distances, source extents, frame/probe preparation and JS request/response adaptation; excludes scoreboard aggregation, provenance hashing and BREP serialization. OCCT: measure.py observe() on live compound, including properties, canonical topology, validity, frame transforms and probes. NOT measure.py CLI startup/STEP read/roundtrip. These scopes differ and are disclosed, not a kernel-only comparison.',
  exportMs: 'Warm STEP generation plus synchronous file write/close (Wonky toStep + writeFileSync; OCCT measure.py export_step). No fsync, import, roundtrip, BREP JSON serialization or validation. Same output pathname overwritten each repetition; warm filesystem cache.',
  warmPipelineMs: 'Sum of construction + native/in-memory observation + STEP export for each repetition. Warm end-to-end geometry pipeline, NOT process startup or CAD-Acid correctness qualification. Cold startup is a separate non-additive experiment.',
  peakRssMiB: 'Worker process cumulative peak RSS after each repetition (includes imports and discarded warm-up; high-water marks are not independent memory samples). Node maxRSS KiB and macOS Python ru_maxrss bytes normalized to MiB. No phase-specific RSS; no parent/uv-child sum. Totals use maximum, never sum.',
};

function statistics(values) {
  const nums = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!nums.length) return null;
  const middle = Math.floor(nums.length / 2);
  return {n: nums.length, min: nums[0], median: nums.length % 2 ? nums[middle] : (nums[middle - 1] + nums[middle]) / 2, max: nums.at(-1)};
}

export function selectCases(catalog, report, requestedZones = null) {
  const included = [], excluded = [];
  for (const zone of catalog.zones) for (const variant of VARIANTS) {
    const pair = {zone: zone.id, variant};
    if (requestedZones && !requestedZones.includes(zone.id)) {
      excluded.push({...pair, reason: 'outside requested zone selection'});
      continue;
    }
    const rust = report.zones.find(r => r.kernel === 'wonky-rust' && r.zone === zone.id);
    const occt = report.zones.find(r => r.kernel === 'occt' && r.zone === zone.id);
    const reasons = [];
    for (const [kernel, row] of [['wonky-rust', rust], ['frozen occt', occt]]) {
      const score = row?.variants[variant];
      const variantStatus = score?.strictStatus ?? score?.status;
      const zoneStatus = row?.strictStatus ?? row?.status;
      if (variantStatus !== 'PASS') reasons.push(`${kernel}: ${variantStatus ?? 'NOT_RUN'} (${score?.reason ?? 'missing'})`);
      // Practical acceptance cannot qualify a strict matched-PASS benchmark,
      // including otherwise passing variants of a metamorphically wrong zone.
      if (zoneStatus === 'WRONG' || zoneStatus === 'UNVERIFIED' || row?.status === 'UNVERIFIED') reasons.push(`${kernel} zone: ${zoneStatus} (${row.reasons.join('; ')})`);
    }
    if (reasons.length) excluded.push({...pair, reason: reasons.join('; ')});
    else included.push(pair);
  }
  return {included, excluded};
}

export function summarize(samples, cold = false) {
  return Object.fromEntries((cold ? COLD_PHASES : PHASES).map(phase => [phase, statistics(samples.map(sample => sample[phase]))]));
}

const ratio = (a, b) => Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null;
export function aggregate(cases) {
  const result = {};
  for (const phase of PHASES) {
    const metric = kernel => {
      const values = cases.map(c => c[kernel].summary[phase]?.[phase.endsWith('RssMiB') ? 'max' : 'median']);
      if (!values.length || values.some(v => !Number.isFinite(v))) return null;
      return phase.endsWith('RssMiB') ? Math.max(...values) : values.reduce((sum, value) => sum + value, 0);
    };
    const wonky = metric('wonky-rust'), occt = metric('occt');
    result[phase] = {wonky, occt, ratio: ratio(wonky, occt)};
  }
  return result;
}

export function markdown(report) {
  const fmt = n => n === null || n === undefined ? 'n/a' : n.toFixed(3);
  const columns = ['constructionMs', 'measurementMs', 'exportMs', 'warmPipelineMs', 'peakRssMiB'];
  const lines = ['# CAD-Acid matched-PASS performance', '', report.noClaim, '',
    `Revision: ${report.revision}. Host: ${report.machine.hostname}, ${report.machine.cpu}.`,
    `${report.cases.length} measured / ${report.selection.included.length} eligible / ${report.denominator} catalog zone-variants. ${report.reps} measured reps after 1 discarded warm-up in each worker.`,
    'Ratios below are wonky / OCCT (lower is faster/smaller); sum of per-case medians, not median of ratios. RSS aggregates by maximum. Cases are isolated; imports are excluded from warm timings.', '',
    '## Cold startup (once per backend per run, never added to zone totals)', '',
    '| Backend | Reps | Median ms | Min ms | Max ms | Peak RSS MiB |', '|---|---:|---:|---:|---:|---:|'];
  for (const [kernel, cold] of Object.entries(report.coldStart)) {
    const time = cold.summary.coldStartMs;
    lines.push(`| ${kernel} | ${time.n} | ${fmt(time.median)} | ${fmt(time.min)} | ${fmt(time.max)} | ${fmt(cold.summary.coldPeakRssMiB.max)} |`);
  }
  lines.push('', '## Warm zone comparisons', '',
    '| Zone | Variants | Construction ratio | Measurement ratio | STEP ratio | Warm pipeline ratio | Peak RSS ratio |',
    '|---|---|---:|---:|---:|---:|---:|');
  for (const [zone, cases] of Object.entries(Object.groupBy(report.cases, c => c.zone))) {
    const totals = aggregate(cases);
    lines.push(`| ${zone} | ${cases.map(c => c.variant).join(', ')} | ${columns.map(p => fmt(totals[p].ratio)).join(' | ')} |`);
  }
  lines.push(`| TOTAL (additive phases only) | ${report.cases.length} cases | ${columns.map(p => fmt(report.totals[p]?.ratio)).join(' | ')} |`, '',
    '## Absolute additive totals (sum of per-case medians, ms)', '',
    '| Phase | Wonky | OCCT | Ratio |', '|---|---:|---:|---:|');
  for (const phase of ADDITIVE_PHASES) {
    const v = report.totals[phase];
    lines.push(`| ${phase} | ${fmt(v.wonky)} | ${fmt(v.occt)} | ${fmt(v.ratio)} |`);
  }
  lines.push('', '## Non-comparable construction detail (sum of case medians, ms)', '',
    '| Zone | Rust native boundary | OCCT twin call | Pure-kernel ratio |', '|---|---:|---:|---:|');
  for (const [zone, cases] of Object.entries(Object.groupBy(report.cases, c => c.zone))) {
    const totals = aggregate(cases);
    lines.push(`| ${zone} | ${fmt(totals.nativeBoundaryMs.wonky)} | ${fmt(totals.twinCallMs.occt)} | n/a |`);
  }
  lines.push('No ratio between native boundary and Python twin: these are different scopes.', '', '## Phase definitions', '');
  for (const [phase, meaning] of Object.entries(phaseDefinitions)) lines.push(`- **${phase}**: ${meaning}`);
  lines.push('', '## Excluded / failed', '');
  for (const row of [...report.selection.excluded, ...report.failures]) lines.push(`- ${row.zone}/${row.variant}: ${row.reason.replaceAll('\n', ' ')}`);
  return lines.join('\n') + '\n';
}

