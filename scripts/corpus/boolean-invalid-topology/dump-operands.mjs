// Cluster boolean-invalid-topology: build one FeatureScript unit through the
// production entry point (src/index.mjs build) and dump the operands of its N-th
// opBoolean (default: the first) as wonky-acceptance-operands/1 (gzip), the
// bake-off's frozen B-rep leaf format, plus a float64 incidence report
// (max distance of each face's own loop vertices from its stored carrier plane).
// Capture uses the in-memory hook of scripts/corpus/boolean-hook-loader.mjs
// (booleanInBend operands); nothing on disk under src/ or kernel/ changes.
//
//   node scripts/corpus/boolean-invalid-topology/dump-operands.mjs <file.fs> [feature] --out <file.json.gz> [--call N] [--linearc]
//
// --linearc (diagnosis only): polygon prisms are built by the existing native
// F32x2 line/arc extruder (kernel/sketch-arcs.bend) instead of the F32 polygon
// extruder, as in scripts/corpus/diagnose-planar-admission.mjs --simulate linearc.
// Polyhedral bodies (edge curve 'line') are written with explicit line curves
// through their own vertices so the bake-off tessellator can read them; vertices
// and face carriers are written unchanged.
import { register } from 'node:module';
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';

register('../boolean-hook-loader.mjs', import.meta.url);
const args = process.argv.slice(2);
const take = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : null; };
const flag = name => { const i = args.indexOf(name); if (i >= 0) args.splice(i, 1); return i >= 0; };
const out = take('--out');
const callIndex = Number(take('--call') ?? 0);
const linearc = flag('--linearc');
const [file, feature] = args;
const source = readFileSync(file, 'utf8');

if (linearc) {
  const { ModelingContext } = await import('../../../src/library.mjs');
  const { solveSketchArcs, extrudeSketchArcs } = await import('../../../src/sketch-arcs.mjs');
  ModelingContext.prototype.body = function (id, points, plane, delta, offset, loc) {
    const entities = points.map((p, i) => {
      const q = points[(i + 1) % points.length];
      return { type: 'line', index: i, id: `l${i}`, startMeters: p.map(v => v / 1000), endMeters: q.map(v => v / 1000) };
    });
    const profile = solveSketchArcs(this.kernel.sketchArcs, entities, loc);
    this.addSolid(id, extrudeSketchArcs(this.kernel.sketchArcs, this.kernel, profile, id.toString(), plane, delta, offset ?? [0, 0, 0], loc));
  };
}

const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const unit = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
function incidence(body) {
  let worst = 0, worstFace = -1;
  body.faces.forEach((face, fi) => {
    if (face.surface.type !== 'plane') return;
    const n = unit(face.surface.normal);
    for (const loop of face.loops) for (const use of loop) {
      const e = body.edges[use.edge];
      for (const v of [e.start, e.end]) {
        const d = Math.abs(dot(sub(body.vertices[v], face.surface.origin), n));
        if (d > worst) { worst = d; worstFace = fi; }
      }
    }
  });
  return { maxVertexOffCarrierMm: worst, face: worstFace };
}
function leafView(body) {
  if (!body.edges.every(e => e.curve === 'line')) return body;
  return { ...body, geometry: body.geometry ?? 'polyhedral',
    edges: body.edges.map(e => ({ ...e, curve: { type: 'line', origin: body.vertices[e.start], direction: unit(sub(body.vertices[e.end], body.vertices[e.start])) } })),
    faces: body.faces.map(f => ({ sameSense: true, outer: f.loops.map((_, i) => i === 0), ...f })) };
}

let result;
try {
  const { build } = await import('../../../src/index.mjs');
  const { normalizeModelingPolicy } = await import('../../../src/modeling-policy.mjs');
  const sibling = resolve(dirname(file), 'modules.json');
  const model = await build(source, { feature: feature || undefined, parameters: {}, moduleManifest: existsSync(sibling) ? sibling : undefined,
    sourcePath: resolve(file), modelingPolicy: normalizeModelingPolicy({ curvedContacts: 'strict' }) });
  result = { ok: true, bodies: model.bodies.length };
} catch (error) {
  result = { ok: false, error: error.name, message: String(error.message).slice(0, 300), line: error.line ?? null };
}
const calls = globalThis.__corpusBoolean?.calls ?? [];
const call = calls[callIndex];
if (!call) { console.log(JSON.stringify({ ...result, booleanCalls: calls.length, dumped: null })); process.exit(0); }
const bodies = [call.a, call.b].map(leafView);
const doc = { schema: 'wonky-acceptance-operands/1', sourceSha256: createHash('sha256').update(source).digest('hex'),
  purpose: `Inputs to opBoolean #${callIndex} of ${file}${feature ? '#' + feature : ''} (corpus cluster boolean-invalid-topology${linearc ? ', --linearc diagnosis build' : ''}); not a completed model.`,
  operation: call.operation, operationId: call.id, location: call.loc ? { line: call.loc.line, column: call.loc.column } : null,
  bodies: bodies.map((body, i) => ({ role: call.operation === 'SUBTRACTION' ? (i === 0 ? 'targets' : 'tools') : 'tools', body })) };
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gzipSync(JSON.stringify(doc)));
console.log(JSON.stringify({ ...result, booleanCalls: calls.length, dumped: out, operation: call.operation, linearc,
  operands: bodies.map(b => ({ id: b.id, geometry: b.geometry ?? null, precision: b.precision ?? null, faces: b.faces.length, vertices: b.vertices.length, ...incidence(b) })) }));
