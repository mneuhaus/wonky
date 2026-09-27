#!/usr/bin/env node
// Boolean bake-off TEST INFRASTRUCTURE: runs one prototype on one job on the
// Bend JavaScript target, in its own process so the runner can enforce a
// timeout. Geometry is computed by the Bend module; this file only times it.
//
//   node scripts/bakeoff/js-worker.mjs <main.bend> <input> <result> [repeat]
//
// Prints one JSON line: {loadMs, coldMs, warm: {parseMs, computeMs,
// serializeMs, totalMs} (medians of `repeat` warm runs), phased, runs,
// deterministic}. With parse/solve/show exported the phases are timed
// separately; otherwise only run() is timed (totalMs) and the phases are null.

import fs from 'node:fs';
import { loadBend } from '../../src/bend-loader.mjs';

const [entry, input, output, repeatArg] = process.argv.slice(2);
const repeat = Math.max(1, Number(repeatArg ?? 3));
const median = (xs) => {
  const v = [...xs].sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
};

const t0 = performance.now();
const mod = await loadBend(entry);
const loadMs = performance.now() - t0;
if (typeof mod.run !== 'function') throw new Error(`${entry} does not export run`);
const phased = ['parse', 'solve', 'show'].every((k) => typeof mod[k] === 'function');
const text = fs.readFileSync(input, 'utf8');

function once() {
  if (!phased) {
    const a = performance.now();
    const out = mod.run(text);
    return { out, totalMs: performance.now() - a, parseMs: null, computeMs: null, serializeMs: null };
  }
  const a = performance.now();
  const p = mod.parse(text);
  const b = performance.now();
  const o = mod.solve(p);
  const c = performance.now();
  const out = mod.show(o);
  const d = performance.now();
  return { out, parseMs: b - a, computeMs: c - b, serializeMs: d - c, totalMs: d - a };
}

const cold = once();
if (typeof cold.out !== 'string') throw new Error('run/show did not return a string');
fs.writeFileSync(output, cold.out);
const runs = [];
let deterministic = true;
for (let i = 0; i < repeat; i++) {
  const r = once();
  if (r.out !== cold.out) deterministic = false;
  runs.push(r);
}
const pick = (k) => (phased || k === 'totalMs' ? median(runs.map((r) => r[k])) : null);
console.log(JSON.stringify({
  loadMs,
  coldMs: cold.totalMs,
  phased,
  runs: repeat,
  deterministic,
  warm: { parseMs: pick('parseMs'), computeMs: pick('computeMs'), serializeMs: pick('serializeMs'), totalMs: pick('totalMs') },
}));
