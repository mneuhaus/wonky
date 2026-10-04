// Complete pair enumeration: certify separated enclosures before scheduling any
// narrow work. Narrow calls run in one killable child, so a native synchronous
// Boolean cannot starve the remaining pairs or the JSONL consumer. The geometry
// classifier is shared with evCollision/motion; this report also opts into
// sufficient audited source certificates before exact Boolean reconstruction.
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { certifiedBoundsRustBody, rustBodyWords, rustModelKernel } from './rust-host.mjs';

export const DEFAULT_PAIR_BUDGET_MS = 250;
const view = new DataView(new ArrayBuffer(8));
function next(x, up) {
  if (x === 0) return up ? Number.MIN_VALUE : -Number.MIN_VALUE;
  if (!Number.isFinite(x)) return x;
  view.setFloat64(0, x);
  let bits = view.getBigUint64(0);
  bits += (x > 0) === up ? 1n : -1n;
  view.setBigUint64(0, bits);
  return view.getFloat64(0);
}
const down = x => next(x, false), up = x => next(x, true);
const rational = text => { const [n, d = '1'] = text.split('/'); return { n: BigInt(n), d: BigInt(d) }; };
function binary64(x) {
  view.setFloat64(0, x);
  const bits = view.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
  const mantissa = (bits & ((1n << 52n) - 1n)) | (exponent ? 1n << 52n : 0n);
  const sign = bits >> 63n ? -1n : 1n, shift = exponent ? exponent - 1075 : -1074;
  return shift >= 0 ? { n: sign * (mantissa << BigInt(shift)), d: 1n } : { n: sign * mantissa, d: 1n << BigInt(-shift) };
}
const compare = (a, b) => a.n * b.d - b.n * a.d;
const sub = (a, b) => ({ n: a.n * b.d - b.n * a.d, d: a.d * b.d });
const add = (a, b) => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const square = a => ({ n: a.n * a.n, d: a.d * a.d });
const zero = { n: 0n, d: 1n };
function occupiedBoxDistance(a, b) {
  if (!a.occupiedBoxMm || !b.occupiedBoxMm) return null;
  const aa = a.occupiedBoxMm.map(p => p.map(rational)), bb = b.occupiedBoxMm.map(p => p.map(rational));
  const gaps = [0, 1, 2].map(k => {
    const x = sub(aa[0][k], bb[1][k]), y = sub(bb[0][k], aa[1][k]);
    const z = compare(x, y) > 0n ? x : y;
    return z.n > 0n ? z : zero;
  });
  const squared = gaps.map(square).reduce(add, zero);
  const estimate = Math.hypot(...gaps.map(g => Number(g.n) / Number(g.d)));
  if (!Number.isFinite(estimate) || estimate <= 0) return null;
  let lo = estimate, hi = estimate;
  // The estimate is NOT authority: prove both bounds against the exact rational
  // squared distance. Extreme range/conversion failures leave distance unknown.
  for (let i = 0; i < 32; i++) {
    if (compare(square(binary64(lo)), squared) <= 0n && compare(square(binary64(hi)), squared) >= 0n) {
      return { distanceMm: estimate, distanceBoundMm: up(Math.max(estimate - lo, hi - estimate)), distanceLowerBoundMm: lo,
        distanceMeaning: 'bounded-exact-distance' };
    }
    lo = Math.max(0, down(lo)); hi = up(hi);
    if (!Number.isFinite(hi)) return null;
  }
  return null;
}
export function broadClash(a, b) {
  if (!a || !b || a.schema !== 'wonky-certified-bounds/v1' || b.schema !== a.schema) return null;
  // Directed subtraction gives a certified lower bound on an axis gap. Taking
  // max (rather than an unchecked hypot) is a conservative Euclidean bound.
  const lower = Math.max(0, ...[0, 1, 2].flatMap(k => [down(a.min[k] - b.max[k]), down(b.min[k] - a.max[k])]));
  if (!Number.isFinite(lower) || !(lower > 0)) return null; // touching is NEVER clear here
  return { phase: 'broad', decided: true, type: 'NONE', kind: 'clear', exactClass: true,
    volumeMm3: 0, volumeBoundMm3: 0, distanceMm: null, distanceBoundMm: null,
    distanceLowerBoundMm: lower, distanceMeaning: 'certified-lower-bound',
    ...occupiedBoxDistance(a, b) };
}
const budgetRefusal = budgetMs => ({ phase: 'narrow', decided: false, type: null, kind: 'refused', exactClass: false,
  refusal: 'interference/pair-work-budget-exceeded', budgetMs, volumeMm3: null, volumeBoundMm3: null,
  distanceMm: null, distanceBoundMm: null, distanceMeaning: 'unknown' });

class NarrowWorker {
  child = null;
  preparationMs = 0;
  constructor(bodies) { this.bodies = bodies; }
  async open() {
    const child = fork(new URL('./interference-worker.mjs', import.meta.url), [], { serialization: 'advanced', stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    this.child = child;
    this.closed = once(child, 'close');
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('interference/worker-startup-timeout')), 30_000);
      const message = data => {
        if (data.kind === 'ready') finish();
        else if (data.kind === 'fault') finish(Object.assign(new Error(data.message), { name: data.name, code: data.code }));
      };
      const exit = (code, signal) => finish(new Error(`interference worker exited during startup (${code ?? signal})`));
      const finish = error => { clearTimeout(timer); child.off('message', message); child.off('exit', exit); child.off('error', finish); error ? reject(error) : resolve(); };
      child.on('message', message); child.once('exit', exit); child.once('error', finish);
    });
    const start = performance.now();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('interference/worker-preparation-timeout')), 30_000);
      const message = data => {
        if (data.kind === 'prepared') finish();
        else if (data.kind === 'fault') finish(Object.assign(new Error(data.message), { name: data.name, code: data.code }));
      };
      const exit = (code, signal) => finish(new Error(`interference worker exited during preparation (${code ?? signal})`));
      const finish = error => { clearTimeout(timer); child.off('message', message); child.off('exit', exit); child.off('error', finish); error ? reject(error) : resolve(); };
      child.on('message', message); child.once('exit', exit); child.once('error', finish);
      child.send({ bodies: this.bodies.map(b => ({ id: b.id, words: rustBodyWords(b) })) }, error => { if (error) finish(error); });
    });
    this.preparationMs += performance.now() - start;
  }
  async pair(a, b, budgetMs) {
    if (!this.child) await this.open();
    const child = this.child;
    const result = await new Promise((resolve, reject) => {
      let timer;
      const finish = (error, value) => { clearTimeout(timer); child.off('message', message); child.off('exit', exit); child.off('error', fault); error ? reject(error) : resolve(value); };
      const fault = error => finish(error);
      const message = data => {
        if (data.kind === 'started') { clearTimeout(timer); timer = setTimeout(() => finish(null, budgetRefusal(budgetMs)), budgetMs); }
        else if (data.kind === 'result') finish(null, { phase: 'narrow',
          distanceMeaning: data.verdict.distanceMm === null ? 'unknown' : 'bounded-exact-distance', ...data.verdict });
        else if (data.kind === 'fault') finish(Object.assign(new Error(data.message), { name: data.name, code: data.code }));
      };
      const exit = (code, signal) => finish(new Error(`interference worker exited (${code ?? signal})`));
      child.on('message', message); child.once('exit', exit); child.once('error', fault);
      // Bound request delivery too, but distinguish IPC failure from work budget.
      timer = setTimeout(() => finish(new Error('interference/worker-request-timeout')), 30_000);
      child.send({ a: { id: a.id, words: rustBodyWords(a) }, b: { id: b.id, words: rustBodyWords(b) } }, error => { if (error) fault(error); });
    });
    if (result.refusal === 'interference/pair-work-budget-exceeded') await this.close(true);
    return result;
  }
  async close(kill = false) {
    if (!this.child) return;
    const child = this.child; this.child = null;
    if (kill) child.kill('SIGKILL'); else child.disconnect();
    await this.closed;
  }
}

export async function interferenceReport(model, { pairBudgetMs = DEFAULT_PAIR_BUDGET_MS, onPairs = () => {} } = {}) {
  if (!Number.isSafeInteger(pairBudgetMs) || pairBudgetMs <= 0) throw new Error('interference pair budget must be a positive integer in milliseconds');
  const kernel = rustModelKernel(model), bodies = model.bodies;
  const bounds = bodies.map(body => {
    try { return certifiedBoundsRustBody(kernel, body); }
    catch (error) { if (error.name === 'RustCapabilityError') return null; throw error; }
  });
  const pairs = [], narrow = [], batch = [];
  const identity = (a, b) => ({ target: a.id, tool: b.id, targetName: a.name ?? null, toolName: b.name ?? null });
  for (let i = 0; i < bodies.length; i++) for (let j = i + 1; j < bodies.length; j++) {
    const a = bodies[i], b = bodies[j], verdict = broadClash(bounds[i], bounds[j]);
    const index = pairs.length;
    pairs.push(verdict ? { ...identity(a, b), ...verdict } : null);
    if (verdict) batch.push(pairs[index]); else narrow.push({ index, a, b });
  }
  // All clear broad results reach the consumer before the first native call.
  await onPairs(batch);
  // Audit and prepare each narrow operand once, as assembly setup rather than
  // repeatedly per pair. This time remains part of the end-to-end report and
  // is exposed explicitly; no Boolean/distance/pair refinement happens here.
  const worker = new NarrowWorker([...new Set(narrow.flatMap(({ a, b }) => [a, b]))]);
  try {
    for (const { index, a, b } of narrow) {
      pairs[index] = { ...identity(a, b), ...await worker.pair(a, b, pairBudgetMs) };
      await onPairs([pairs[index]]);
    }
  } finally { await worker.close(true); }
  const count = kind => pairs.filter(p => p.kind === kind).length;
  return { schema: 'wonky-interference/v1', bodies: bodies.length, pairBudgetMs, preparationMs: worker.preparationMs,
    exactness: { volume: 'exact-Boolean result measured with its relative bound',
      distance: 'distanceMeaning distinguishes a certified lower bound from a bounded exact minimum; unknown is null',
      broad: 'strict positive gap between certified outward-rounded enclosures; occupied boxes additionally prove exact minimum distance',
      contact: 'narrow only: distance exactly 0 with an empty positive-volume intersection' },
    notChecked: ['continuous (swept) collision', 'motion'], pairs,
    phases: { broad: pairs.length - narrow.length, narrow: narrow.length },
    summary: { pairs: pairs.length, interference: count('interference'), abutment: count('abutment'), clear: count('clear'), refused: count('refused') } };
}
