// Native backend for wonky-graph/0: lowers the kernel graph to the core AST of
// the Bend spike (kernel/lang/spike, docs/language/bend-feasibility.md) and runs
// the already-built native binary (out/lang/spike/build/main). No Bend compile
// is needed per program: the graph travels as data (integer stream).
//
// Automatic fork-join: outputs whose dependency cones share no Boolean node are
// independent. They are combined with a balanced (par ...) tree, so the source
// program never mentions parallelism. `parallel: false` emits the same program
// with (append ...) instead, as the sequential control.
//
// Scope of the spike's kernel builtins: extrude of a counterclockwise polygon in
// a plane parallel to XY, union, subtract, volume, face count. Translations are
// folded into primitive coordinates; rotations, intersections, cylinders and
// every other op are capability errors at the node's span.

import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileToStream } from '../spike-compile.mjs';
import { WpyError } from './values.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
export const NATIVE_BINARY = join(root, 'out/lang/spike/build/main');
const PRELUDE = readFileSync(join(root, 'kernel/lang/spike/examples/prelude.core'), 'utf8');
const OFFSET = { MIN: 0, CENTER: 0.5, MAX: 1, NONE: 0 };
const isIdentity = R => R.every((r, i) => r.every((v, j) => v === (i === j ? 1 : 0)));
const f32exact = x => Math.fround(x) === x;

export function lowerGraph(graph, { parallel = true } = {}) {
  const cap = (n, what) => { throw new WpyError('capability', `native backend: ${what} (node ${n.id})`, n.span); };
  const num = (n, x) => {
    if (!Number.isFinite(x)) cap(n, 'non-finite coordinate');
    if (!f32exact(x)) cap(n, `coordinate ${x} is not exactly representable as F32 (the spike kernel's extrude takes F32 input and never rounds)`);
    return Object.is(x, -0) ? '0' : String(x);
  };
  const profile = i => {
    const n = graph.nodes[i], p = n.params;
    if (n.op === 'polygon') {
      const lo = [0, 1].map(k => Math.min(...p.points.map(q => q[k]))), hi = [0, 1].map(k => Math.max(...p.points.map(q => q[k])));
      const sh = [0, 1].map(k => p.align[k] === 'NONE' ? 0 : -(lo[k] + (hi[k] - lo[k]) * OFFSET[p.align[k]]));
      return { points: p.points.map(q => [q[0] + sh[0], q[1] + sh[1]]), t: [0, 0, 0] };
    }
    if (n.op === 'rectangle') {
      const [w, h] = p.size, x0 = -w * OFFSET[p.align[0]], y0 = -h * OFFSET[p.align[1]];
      return { points: [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]], t: [0, 0, 0] };
    }
    if (n.op === 'move') {
      if (!isIdentity(p.rows)) cap(n, 'rotated sketch plane');
      const inner = profile(n.inputs[0]);
      return { ...inner, t: inner.t.map((v, k) => v + p.offset[k]) };
    }
    cap(n, `sketch operation '${n.op}'`);
  };
  const bound = new Map(); // boolean node index -> variable name
  const shape = (i, t = [0, 0, 0]) => {
    const n = graph.nodes[i], p = n.params;
    switch (n.op) {
      case 'box': {
        const lo = p.size.map((s, k) => -s * OFFSET[p.align[k]] + t[k]);
        return `(box ${num(n, lo[0])} ${num(n, lo[1])} ${num(n, lo[2])} ${num(n, lo[0] + p.size[0])} ${num(n, lo[1] + p.size[1])} ${num(n, p.size[2])})`;
      }
      case 'move':
        if (!isIdentity(p.rows)) cap(n, 'rotation (the spike kernel has no transform builtin)');
        return shape(n.inputs[0], t.map((v, k) => v + p.offset[k]));
      case 'extrude': {
        const pr = profile(n.inputs[0]);
        let pts = pr.points.map(q => [q[0] + pr.t[0] + t[0], q[1] + pr.t[1] + t[1]]);
        let z0 = pr.t[2] + t[2], h = p.amount;
        if (p.both) { z0 -= Math.abs(h); h = 2 * Math.abs(h); }
        if (h < 0) { z0 += h; h = -h; }
        const area = pts.reduce((s, q, k) => { const r = pts[(k + 1) % pts.length]; return s + q[0] * r[1] - r[0] * q[1]; }, 0);
        if (area < 0) pts = pts.reverse();
        return `(extrude (list ${pts.map(q => `(list ${num(n, q[0])} ${num(n, q[1])})`).join(' ')}) ${num(n, z0)} ${num(n, h)})`;
      }
      case 'union': case 'subtract':
        if (t.some(v => v !== 0)) cap(n, 'translated Boolean result (no transform builtin)');
        return bound.get(i) ?? cap(n, 'unbound Boolean');
      default: cap(n, `operation '${n.op}'`);
    }
  };
  // group outputs by shared Boolean nodes (union-find)
  const outs = graph.outputs.map((o, k) => ({ ...o, k }));
  const parent = outs.map((_, k) => k);
  const find = k => (parent[k] === k ? k : (parent[k] = find(parent[k])));
  const owner = new Map();
  const booleansOf = o => graph.cone([o.node]).filter(i => ['union', 'subtract'].includes(graph.nodes[i].op));
  outs.forEach(o => booleansOf(o).forEach(b => { if (owner.has(b)) parent[find(o.k)] = find(owner.get(b)); else owner.set(b, o.k); }));
  const groups = new Map();
  outs.forEach(o => { const r = find(o.k); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(o); });
  const order = [];
  const groupExprs = [...groups.values()].map(members => {
    const bools = [...new Set(members.flatMap(booleansOf))].sort((a, b) => a - b);
    const bindings = [];
    for (const b of bools) {
      const n = graph.nodes[b];
      const expr = `(${n.op} ${shape(n.inputs[0])} ${shape(n.inputs[1])})`;
      const name = `b${b}`;
      bound.set(b, name);
      bindings.push(`(${name} ${expr})`);
    }
    const results = members.map(o => {
      order.push(o.k);
      let e = shape(o.node);
      if (!bound.has(o.node)) { const name = `o${o.node}`; bindings.push(`(${name} ${e})`); bound.set(o.node, name); e = name; }
      return `(list (volume ${e}) (faces ${e}) ${e})`;
    });
    const body = `(list ${results.join(' ')})`;
    return bindings.length ? `(let (${bindings.join(' ')}) ${body})` : body;
  });
  const combine = (xs, op) => (xs.length === 1 ? xs[0] : `(${op} ${combine(xs.slice(0, xs.length >> 1), op)} ${combine(xs.slice(xs.length >> 1), op)})`);
  const program = `${PRELUDE}\n; lowered from ${graph.file} (wonky-graph/0), ${groupExprs.length} independent group(s)\n${combine(groupExprs, parallel && groupExprs.length > 1 ? 'par' : 'append')}\n`;
  return { program, order, groups: groupExprs.length };
}

export function runNative(graph, { threads = 1, parallel = true, reps = 1, fuel = 100000000, workDir = join(root, 'tmp/lang/surface/native') } = {}) {
  const { program, order, groups } = lowerGraph(graph, { parallel });
  const { text, ints } = compileToStream(program, { file: graph.file });
  mkdirSync(workDir, { recursive: true });
  const astFile = join(workDir, `${graph.file.replace(/[^A-Za-z0-9_.-]/g, '_')}.${parallel ? 'par' : 'seq'}.ast`);
  writeFileSync(astFile, text);
  writeFileSync(astFile.replace(/\.ast$/, '.core'), program);
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    const child = spawn(NATIVE_BINARY, ['--threads', String(threads), '--gpu', 'off', '--', 'eval', astFile, String(fuel), String(reps)], { env: { ...process.env, BEND_NO_TELEMETRY: '1' } });
    let out = '', err = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      const wallMs = performance.now() - t0;
      if (code !== 0) { reject(new Error(`native run failed (${code}): ${err}`)); return; }
      const json = JSON.parse(out.trim().split('\n').at(-1));
      if (!Array.isArray(json.value)) { reject(new WpyError('model', `native evaluation returned an error value: ${JSON.stringify(json.value)}`, null)); return; }
      const outputs = json.value.map((triple, k) => {
        const [vol, faces, body] = triple;
        const o = graph.outputs[order[k]];
        return { name: o.name, id: graph.nodes[o.node].id, volume: vol.num, volumeWords: [vol.hi, vol.lo], faces: faces.num, hash: body.body.hash, errors: body.body.errors };
      });
      resolve({ outputs, groups, threads, parallel, astInts: ints.length, decodeMs: json.decodeMs, evalMs: json.evalMs, wallMs: +wallMs.toFixed(1) });
    });
  });
}
