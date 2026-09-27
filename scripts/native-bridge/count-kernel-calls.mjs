// Preload (node --import) that counts host -> Bend kernel calls without editing src/.
//
// Every Bend module reaches the host as `export default { "key": run_lib(...) }`
// inside a data: URL import (src/bend-loader.mjs). A synchronous in-thread load
// hook rewrites only that last statement so the export object passes through
// globalThis.__wonkyNativeBridgeWrap, which wraps each entry function in place.
// Function bodies and their line numbers are untouched.
//
// Per entry it records calls, inclusive wall time, a duration histogram, the
// calling host frames, and argument/result object-graph sizes (Con cells, V3,
// Real, BigInt, Solid vertex/edge/face list lengths). It also records how much
// of each argument graph was produced by an earlier kernel call (a value a
// native binding could keep as a handle instead of re-marshaling it).
//
// Use a separate run for counting; the size walks perturb timing.
//   WONKY_NB_COUNT_OUT=<file.json> node --import ./scripts/native-bridge/count-kernel-calls.mjs bin/wonky.mjs ...
import { registerHooks } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const cacheDirectory = join(projectRoot, '.tools', 'bend-js-cache');
const outPath = process.env.WONKY_NB_COUNT_OUT;
if (!outPath) throw new Error('WONKY_NB_COUNT_OUT must name the JSON output file');
const walkCap = Number(process.env.WONKY_NB_WALK_CAP ?? 200000);
const exportMarker = '\nexport default {';

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (!url.startsWith('data:text/javascript;base64,') || !url.includes('#')) return result;
    const key = url.slice(url.lastIndexOf('#') + 1);
    const text = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString('utf8');
    const at = text.lastIndexOf(exportMarker);
    if (at < 0) return result;
    const source = text.slice(0, at) + '\nconst __wonkyDefault = {' + text.slice(at + exportMarker.length) +
      '\nexport default globalThis.__wonkyNativeBridgeWrap(__wonkyDefault, ' + JSON.stringify(key) + ');\n';
    return { ...result, source, shortCircuit: true };
  },
});

const entries = new Map();
const modules = [];
const kernelProduced = new WeakSet();
const wrapped = new WeakSet();
let depth = 0, walkMs = 0;
const limits = [0.01, 0.1, 1, 10, Infinity];
const bucketNames = ['<10us', '<100us', '<1ms', '<10ms', '>=10ms'];

function entryFor(key) {
  try {
    const artifact = JSON.parse(readFileSync(join(cacheDirectory, `${key}.json`), 'utf8'));
    return relative(projectRoot, artifact.manifest.entry);
  } catch { return `unknown:${key.slice(0, 12)}`; }
}

function emptySize() {
  return { nodes: 0, con: 0, v3: 0, real: 0, bigint: 0, numbers: 0, maxList: 0, solids: 0, vertices: 0, edges: 0, faces: 0,
    truncated: 0, reusedNodes: 0 };
}

function listLength(value) {
  let n = 0;
  while (value && value.$ === 'Con' && n < 1e7) { n++; value = value.tail; }
  return n;
}

// Size of one value graph. `mark` registers result nodes as kernel-produced;
// argument walks count how many reachable nodes were kernel-produced already.
function measure(value, size, mark) {
  const seen = new Set(), stack = [value];
  let visited = 0;
  while (stack.length) {
    const v = stack.pop();
    if (typeof v === 'bigint') { size.bigint++; continue; }
    if (typeof v === 'number') { size.numbers++; continue; }
    if (v === null || typeof v !== 'object') continue;
    if (seen.has(v)) continue;
    seen.add(v);
    if (++visited > walkCap) { size.truncated = 1; break; }
    size.nodes++;
    if (mark) kernelProduced.add(v);
    else if (kernelProduced.has(v)) size.reusedNodes++;
    if (Array.isArray(v)) { for (const child of v) stack.push(child); continue; }
    const tag = v.$;
    if (tag === 'Con') size.con++;
    else if (tag === 'V3') size.v3++;
    else if (tag === 'Real') size.real++;
    else if (tag === 'Solid') {
      size.solids++;
      size.vertices += listLength(v.vertices); size.edges += listLength(v.edges); size.faces += listLength(v.faces);
    }
    for (const field of Object.keys(v)) {
      if (field === '$') continue;
      const child = v[field];
      if (tag !== 'Con' && child && typeof child === 'object' && child.$ === 'Con') {
        const length = listLength(child);
        if (length > size.maxList) size.maxList = length;
      }
      stack.push(child);
    }
  }
}

function addSize(total, size) {
  for (const key of Object.keys(size)) {
    if (key === 'maxList') total.maxList = Math.max(total.maxList, size.maxList);
    else total[key] += size[key];
  }
}

function callerOf() {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 8;
  const lines = new Error().stack.split('\n').slice(1);
  Error.stackTraceLimit = limit;
  for (const line of lines) {
    if (line.includes('count-kernel-calls.mjs') || line.includes('data:text/javascript')) continue;
    const match = /at (?:(\S+) )?\(?(?:file:\/\/)?([^()]+):(\d+):\d+\)?$/.exec(line.trim());
    if (!match) continue;
    const file = match[2].startsWith(projectRoot) ? match[2].slice(projectRoot.length) : match[2];
    return `${file}:${match[1] ?? '<anonymous>'}:${match[3]}`;
  }
  return '<unknown>';
}

function record(name) {
  let entry = entries.get(name);
  if (!entry) {
    entry = { calls: 0, nested: 0, partial: 0, errors: 0, ms: 0, maxMs: 0,
      histogram: Object.fromEntries(bucketNames.map(b => [b, 0])),
      args: emptySize(), result: emptySize(), callers: {}, callerSamples: 0 };
    entries.set(name, entry);
  }
  return entry;
}

function wrap(fn, name) {
  if (wrapped.has(fn)) return fn;
  const counted = function (...args) {
    const entry = record(name), outer = depth === 0;
    if (outer) {
      entry.calls++;
      if (entry.callerSamples < 2000 || entry.calls % 16 === 0) {
        entry.callerSamples++;
        const caller = callerOf();
        entry.callers[caller] = (entry.callers[caller] ?? 0) + 1;
      }
    } else entry.nested++;
    depth++;
    const start = performance.now();
    let result, failed = false;
    try { result = fn.apply(this, args); }
    catch (cause) { failed = true; throw cause; }
    finally {
      const ms = performance.now() - start;
      depth--;
      if (failed) entry.errors++;
      if (outer) {
        entry.ms += ms; entry.maxMs = Math.max(entry.maxMs, ms);
        entry.histogram[bucketNames[limits.findIndex(limit => ms < limit)]]++;
      }
    }
    if (outer) {
      const walkStart = performance.now();
      const argSize = emptySize();
      for (const argument of args) measure(argument, argSize, false);
      addSize(entry.args, argSize);
      if (typeof result === 'function') entry.partial++;
      else { const resultSize = emptySize(); measure(result, resultSize, true); addSize(entry.result, resultSize); }
      walkMs += performance.now() - walkStart;
    }
    return typeof result === 'function' ? wrap(result, name) : result;
  };
  wrapped.add(counted);
  return counted;
}

globalThis.__wonkyNativeBridgeWrap = (object, key) => {
  const entry = entryFor(key);
  modules.push({ entry, key, exports: Object.keys(object).length });
  for (const name of Object.keys(object)) {
    if (typeof object[name] === 'function') object[name] = wrap(object[name], `${entry}:${name}`);
  }
  return object;
};

const started = performance.now();
process.on('exit', code => {
  const list = [...entries].map(([name, entry]) => ({ name, ...entry }))
    .sort((a, b) => b.ms - a.ms || b.calls - a.calls);
  const totals = list.reduce((sum, entry) => ({ calls: sum.calls + entry.calls, ms: sum.ms + entry.ms }), { calls: 0, ms: 0 });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify({
    schema: 'wonky-native-bridge-kernel-calls/1', argv: process.argv.slice(1), exitCode: code,
    wallMsSincePreload: performance.now() - started, sizeWalkMs: walkMs, walkCap,
    note: 'ms is inclusive wall time per outer host->kernel call in this instrumented run; size walks are excluded from ms but slow the run.',
    modules, totals, entries: list,
  }, null, 1));
});
