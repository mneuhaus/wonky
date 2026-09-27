import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {aggregate, selectCases, summarize, geometryDigest, checkOcctRepeat} from '../scripts/acid/bench-report.mjs';
import {ROOT, loadCatalog, loadErrata, readJSON} from '../scripts/acid/common.mjs';

// Synthetic scoreboard inputs exercise the benchmark's filtering contract only.
// They are not kernel proof and are never passed to execution admission.
const catalog = {zones: [{id: 'AC01'}, {id: 'AC02'}]};
function row(kernel, zone, statuses, status = 'PASS') {
  return {kernel, zone, status, reasons: ['aggregate metamorphic check'],
    variants: Object.fromEntries(statuses.map((value, i) => [`V${i}`, {status: value, reason: 'test score'}]))};
}

test('benchmark denominator retains exclusions and admits only matched PASS, never expected refusals', () => {
  const selection = selectCases(catalog, {zones: [
    row('wonky-rust', 'AC01', ['PASS', 'PASS', 'REFUSED', 'PASS'], 'REFUSED'),
    row('occt', 'AC01', ['PASS', 'NOT_RUN', 'PASS', 'DISPUTED'], 'NOT_RUN'),
    row('wonky-rust', 'AC02', ['PASS', 'PASS', 'PASS', 'PASS'], 'WRONG'),
    row('occt', 'AC02', ['PASS', 'PASS', 'PASS', 'PASS']),
  ]});
  assert.equal(selection.included.length, 1);
  assert.equal(selection.included[0].zone, 'AC01');
  assert.equal(selection.included[0].variant, 'V0');
  assert.equal(selection.excluded.length, 7);
  assert.match(selection.excluded.find(c => c.zone === 'AC02').reason, /zone: WRONG/);
  assert.match(selection.excluded.find(c => c.zone === 'AC01' && c.variant === 'V2').reason, /REFUSED/);
  const expectedRefusals = selectCases(catalog, {zones: ['wonky-rust', 'occt'].map(kernel =>
    row(kernel, 'AC01', Array(4).fill('REFUSED_EXPECTED'), 'REFUSED_EXPECTED'))});
  assert.equal(expectedRefusals.included.length, 0);
  assert.match(expectedRefusals.excluded[0].reason, /REFUSED_EXPECTED/);
  // v2's CORRECT includes expected refusals; only its preserved strict PASS
  // qualifies. A practical-only aggregate must not leak passing variants in.
  const v2 = (kernel, strictStatus, status = 'CORRECT') => {
    const cell = row(kernel, 'AC01', Array(4).fill(status), status);
    cell.strictStatus = strictStatus;
    for (const variant of Object.values(cell.variants)) variant.strictStatus = strictStatus;
    return cell;
  };
  const strict = v2('wonky-rust', 'PASS');
  assert.equal(selectCases(catalog, {zones:[strict,v2('occt','PASS')]}).included.length,4);
  assert.equal(selectCases(catalog, {zones:[strict,v2('occt','REFUSED_EXPECTED')]}).included.length,0);
  const tolerant = v2('occt','PASS');tolerant.status='TOLERANT';tolerant.strictStatus='WRONG';
  assert.equal(selectCases(catalog, {zones:[strict,tolerant]}).included.length,0);
  const limited = selectCases(catalog, {zones: []}, ['AC01']);
  assert.equal(limited.included.length, 0);
  assert.equal(limited.excluded.filter(c => c.reason === 'outside requested zone selection').length, 4);
});

test('unverified aggregate cannot promote otherwise passing variants into benchmark results', () => {
  const selection = selectCases(catalog, {zones: [
    row('wonky-rust', 'AC01', ['PASS', 'PASS', 'PASS', 'PASS'], 'UNVERIFIED'),
    row('occt', 'AC01', ['PASS', 'PASS', 'PASS', 'PASS']),
  ]});
  assert.equal(selection.included.length, 0);
  assert.equal(selection.excluded.length, 8);
  assert.match(selection.excluded.find(c => c.zone === 'AC01').reason, /UNVERIFIED/);
  assert.match(selection.excluded.find(c => c.zone === 'AC02').reason, /NOT_RUN/);
});

test('report totals sum timing medians, use maximum observed RSS, and keep uninstrumented kernel time null', () => {
  const series = (times, rss) => ({summary: summarize(times.map((ms, i) => ({
    constructionMs: ms, peakRssMiB: rss[i], kernelOnlyMs: null,
  })))});
  const a = {'wonky-rust': series([7, 1, 3], [80, 90, 120]), occt: series([2, 6, 4], [100, 200, 300])};
  const b = {'wonky-rust': series([11, 13, 9], [60, 75, 100]), occt: series([10, 8, 12], [90, 100, 200])};
  assert.equal(a['wonky-rust'].summary.constructionMs.n, 3);
  assert.equal(a['wonky-rust'].summary.constructionMs.min, 1);
  assert.equal(a['wonky-rust'].summary.constructionMs.median, 3);
  assert.equal(a['wonky-rust'].summary.constructionMs.max, 7);
  const total = aggregate([a, b]);
  assert.equal(total.constructionMs.wonky, 14);
  assert.equal(total.constructionMs.occt, 14);
  assert.equal(total.constructionMs.ratio, 1);
  assert.equal(total.peakRssMiB.wonky, 120);
  assert.equal(total.peakRssMiB.occt, 300);
  assert.equal(total.peakRssMiB.ratio, 0.4);
  assert.equal(total.kernelOnlyMs.wonky, null);
  assert.equal(total.kernelOnlyMs.ratio, null);
  assert.equal(aggregate([]).constructionMs.ratio, null);
  assert.equal(summarize([{constructionMs: 2}, {constructionMs: 4}]).constructionMs.median, 3);
});

test('repeat binding rejects topology, volume and bbox divergence from qualified geometry', () => {
  const {catalog: realCatalog} = loadCatalog();
  const zone = realCatalog.zones.find(z => z.id === 'AC01');
  const qualified = readJSON(`${ROOT}/fixtures/cad-acid/occt/observations.json`).rows.find(r => r.zone === 'AC01' && r.variant === 'V0');
  const errata = loadErrata();
  assert.equal(checkOcctRepeat(realCatalog, zone, qualified, qualified.metrics, errata), null);
  for (const mutate of [m => { m.volume += 1; }, m => { m.topology.faces += 1; }, m => { m.bbox.min[0] -= 1; }]) {
    const changed = structuredClone(qualified.metrics);
    mutate(changed);
    assert.notEqual(geometryDigest(changed), geometryDigest(qualified.metrics));
    assert.notEqual(checkOcctRepeat(realCatalog, zone, qualified, changed, errata), null);
  }
  const cold = summarize([{coldStartMs: 2, coldPeakRssMiB: 20}, {coldStartMs: 4, coldPeakRssMiB: 40}], true);
  assert.equal(cold.coldStartMs.median, 3);
  assert.equal(cold.coldPeakRssMiB.max, 40);
  assert.equal(aggregate([]).coldStartMs, undefined, 'cold startup is never an additive per-case metric');
});

test('CLI requires five production reps, accepts one only as smoke, and refuses invalid arguments before execution', () => {
  const cli = fileURLToPath(new URL('../scripts/acid/bench.mjs', import.meta.url));
  const cases = [
    [['--reps', '1'], /At least 5 reps/],
    [['--reps', '4'], /At least 5 reps/],
    [['--smoke', '--reps', '0'], /At least 5 reps/],
    [['--reps', '5.5'], /At least 5 reps/],
    [['--timeout', 'NaN'], /Invalid timeout/],
    [['--zones'], /needs a value/],
    // AC99 exercises the next real guard: parsing accepted the repetition count.
    [['--zones', 'AC99', '--reps', '1', '--smoke'], /Unknown zone/],
    [['--zones', 'AC99', '--reps', '5'], /Unknown zone/],
    [['--zones', 'AC99'], /Unknown zone/],
  ];
  for (const [args, reason] of cases) {
    const result = spawnSync(process.execPath, [cli, ...args], {encoding: 'utf8', timeout: 10_000,
      env: {...process.env, NODE_OPTIONS: '--max-old-space-size=8192'}});
    assert.equal(result.status, 1, `${args}: ${result.stderr}`);
    assert.match(result.stderr, reason);
  }
});
