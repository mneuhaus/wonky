// WPy entry points.
//
//   preflightWpy(source)  - evaluate without a kernel (mock execution): graph,
//                           kernel-capability gaps, sync points, failure sites,
//                           assumptions. Needs no Bend at all.
//   buildWpy(source)      - evaluate with the JS-target reference backend and
//                           return bodies in the wonky-brep/1 shape.
//
// The native backend (backend-native.mjs) and the FeatureScript emitter
// (emit-fs.mjs) consume the same graph.

import { readFileSync } from 'node:fs';
import { parse } from './parse.mjs';
import { checkModule } from './check.mjs';
import { Evaluator } from './eval.mjs';
import { JsBackend, runGraph } from './backend-js.mjs';
import { WpyError } from './values.mjs';
import { geometryRevision } from '../../identity.mjs';

// Ops the wonky kernel implements today through the reference backend. Every
// other node op is a kernel capability gap, reported before anything runs.
export const IMPLEMENTED_OPS = new Set(['box', 'cylinder', 'polygon', 'rectangle', 'circle', 'move', 'extrude', 'union', 'subtract', 'intersect',
  'volume', 'entities', 'count', 'arith', 'check']);

export function preflightWpy(source, { file = '<wpy>', params = {} } = {}) {
  const t0 = performance.now();
  const ast = parse(source, { file });
  const tParse = performance.now();
  const ev = new Evaluator({ file, source, params, backend: null });
  ev.run(ast);
  const t1 = performance.now();
  const g = ev.graph;
  const gaps = g.nodes.filter(n => !IMPLEMENTED_OPS.has(n.op)).map(n => ({ op: n.op, id: n.id, line: n.span?.line, col: n.span?.col }));
  const selections = g.nodes.filter(n => ['select', 'filter', 'sort', 'group', 'pick', 'pick_group', 'select_union'].includes(n.op));
  return {
    file, graph: g, evaluator: ev,
    report: {
      file,
      parseMs: +(tParse - t0).toFixed(2), evalMs: +(t1 - tParse).toFixed(2),
      summary: g.summary(),
      outputs: g.outputs.map(o => ({ name: o.name, id: g.nodes[o.node].id })),
      params: ev.params,
      kernelGaps: gaps,
      kernelGapOps: Object.fromEntries([...new Set(gaps.map(x => x.op))].map(op => [op, gaps.filter(x => x.op === op).length])),
      selections: {
        total: selections.length,
        declarative: selections.filter(n => n.op !== 'select' || n.params.predicate.op !== 'host').length,
        host: selections.filter(n => n.op === 'select' && n.params.predicate.op === 'host').map(n => ({ id: n.id, line: n.span?.line, source: n.params.predicate.source })),
      },
      syncPoints: g.syncPoints.map(s => ({ line: s.span?.line, col: s.span?.col, reason: s.reason })),
      failureSites: g.failureSites.map(f => ({ line: f.span?.line, handler: f.handler, nodes: f.nodes })),
      assumptions: ev.assumptions.map(a => ({ line: a.span?.line, assumption: a.assumption, reason: a.reason })),
      failedChecks: ev.failedChecks.map(c => ({ message: c.message, line: c.span?.line })),
      log: ev.log,
    },
  };
}

// Human/LLM-readable preflight summary (what `wonky check` would print).
export function formatPreflight(report, { maxLines = 3 } = {}) {
  const s = report.summary, sel = report.selections;
  const lines = [`${report.file}: ${s.nodes} nodes, ${s.outputs} outputs, ${sel.declarative}/${sel.total} selections declarative, ${s.syncPoints} sync points, ${s.failureSites} failure sites, ${s.checks} checks`];
  if (report.kernelGaps.length) {
    lines.push(`kernel gaps: ${Object.entries(report.kernelGapOps).map(([op, n]) => `${op} ${n}`).join(', ')}`);
    for (const g of report.kernelGaps.slice(0, maxLines)) lines.push(`  ${report.file}:${g.line}:${g.col} ${g.op} (${g.id})`);
    if (report.kernelGaps.length > maxLines) lines.push(`  ... ${report.kernelGaps.length - maxLines} more`);
  }
  for (const p of report.syncPoints.slice(0, maxLines)) lines.push(`sync ${report.file}:${p.line}:${p.col} ${p.reason}`);
  if (report.syncPoints.length > maxLines) lines.push(`  ... ${report.syncPoints.length - maxLines} more sync points`);
  for (const f of report.failureSites.slice(0, 1)) lines.push(`failure site ${report.file}:${f.line} try around ${f.nodes.join(', ')}: ${f.handler}`);
  for (const c of report.failedChecks) lines.push(`check failed ${report.file}:${c.line}: ${c.message}`);
  return lines.join('\n');
}

export async function buildWpy(source, { file = '<wpy>', params = {}, backend } = {}) {
  backend ??= await JsBackend.create({ file });
  const t0 = performance.now();
  const ast = parse(source, { file });
  const ev = new Evaluator({ file, source, params, backend });
  ev.run(ast);
  const t1 = performance.now();
  const { outputs, checks } = runGraph(ev.graph, backend);
  const t2 = performance.now();
  if (!outputs.length) throw new WpyError('model', 'the program produced no output parts (assign `result` or call export_*)', null);
  const failed = [...ev.failedChecks.map(c => ({ ...c, ok: false })), ...checks.filter(c => !c.ok)];
  const bodies = outputs.flatMap(o => o.bodies.map(b => Object.assign(b, { name: b.name ?? o.name })));
  return {
    schema: 'wonky-brep/1', units: 'millimeter',
    source: { language: 'WPy', version: 0, file },
    graph: ev.graph,
    outputs: outputs.map(o => ({ name: o.name, id: o.id, revisions: o.bodies.map(geometryRevision), volumes: o.bodies.map(b => b.validation?.volumeMm3), faces: o.bodies.map(b => b.faces.length) })),
    checks, failedChecks: failed,
    notices: ev.graph.notices, syncPoints: ev.graph.syncPoints.length,
    timings: { hostMs: +(t1 - t0).toFixed(2), kernelMs: +(t2 - t1).toFixed(2), backend: { ...backend.stats } },
    bodies,
  };
}

export function checkWpyFile(path) {
  const source = readFileSync(path, 'utf8');
  return checkModule(parse(source, { file: path }));
}
