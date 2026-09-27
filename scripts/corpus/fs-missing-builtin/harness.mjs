// Next-blocker harness for the fs-missing-builtin cluster. NOT production:
// the prototype builtins below exist only to find what a unit hits next.
//
// Runs one corpus FS unit through the same production pieces src/index.mjs
// build() uses (parser, Interpreter, ModelingContext, source-map tracker, JS
// kernel, strict modeling policy) plus PROTOTYPE implementations of the
// missing Onshape std builtins, defined in this file only. Unprototyped names
// still fail exactly as in production ('<name>' is not defined ...), so the
// first failure after the prototypes is the unit's next blocker.
//
// Source stubs (--stub 'regex=>replacement') are applied to an in-memory copy;
// the patched copy is written under tmp/corpus/fs-missing-builtin/src/ for the
// record. The corpus is only read.
//
// Usage: node scripts/corpus/fs-missing-builtin/harness.mjs <corpus-relative path> [--feature F] [--stub 're=>rep']...
//          [--no-proto a,b] [--fold-booleans]
// HARNESS_ROOT=<dir> resolves the path against <dir> instead of ~/Workspace/cad (repros);
// HARNESS_OUT=<prefix> writes <prefix>.step and <prefix>.brep.json on success.
// --fold-booleans stubs the next cluster (opBoolean arity) by pairwise folding.
// Prints one JSON line.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { parse } from '../../../src/parser.mjs';
import { Interpreter } from '../../../src/interpreter.mjs';
import { loadKernel, transformInBend, precisionForBodies } from '../../../src/kernel.mjs';
import { backendInfo } from '../../../src/native/backend.mjs';
import { ModelingContext } from '../../../src/library.mjs';
import { Id, KeyedMap, Matrix, Plane, Quantity, Transform, Vector, isMap, map, vectorNumbers, binary } from '../../../src/values.mjs';
import { fail, unsupported, FeatureScriptError } from '../../../src/errors.mjs';
import { resolveTopology, TopologyQuery } from '../../../src/queries.mjs';
import { transformAnalytic, revolveInBend } from '../../../src/analytic.mjs';
import { sourceTracker } from '../../../src/source-map.mjs';
import { normalizeModelingPolicy } from '../../../src/modeling-policy.mjs';
import { toStep } from '../../../src/exporters.mjs';
import { loadFaceClassifier, classificationInput } from '../../../src/face-classification.mjs';
import { loadSolidClassifier } from '../../../src/solid-classification.mjs';
import { intersectionTolerance } from '../../../src/intersections.mjs';
import { vector as realVector } from '../../../src/real.mjs';
import { classify } from '../../../scripts/corpus/lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const DATA = join(here, '..', '..', '..', 'tmp', 'corpus', 'fs-missing-builtin');
const corpus = process.env.HARNESS_ROOT ?? join(homedir(), 'Workspace', 'cad');
const argv = process.argv.slice(2);
const path = argv[0];
let feature, fold = false; const stubs = [], disabled = new Set();
for (let i = 1; i < argv.length; i++) {
  if (argv[i] === '--feature') feature = argv[++i];
  else if (argv[i] === '--fold-booleans') fold = true;
  else if (argv[i] === '--stub') { const [re, rep] = argv[++i].split('=>'); stubs.push([new RegExp(re, 'g'), rep ?? '']); }
  else if (argv[i] === '--no-proto') for (const n of argv[++i].split(',')) disabled.add(n);
}

// ------------------------------------------------------------------ prototypes
const builtin = (name, min, max, call) => ({ type: 'builtin', name, min, max, call });
const used = Object.create(null);
const raw = x => (x instanceof Quantity ? x.value : x);
const vec3 = (v, loc) => { if (!(v instanceof Vector) || v.items.length !== 3) fail('Expected a 3D Vector', loc); return v.items.map(raw); };
const unit = (v, loc) => { const n = Math.hypot(...v); if (!(n > 1e-12)) fail('Direction must be nonzero', loc); return v.map(x => x / n); };
const crossN = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dotN = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const lengthVector = xs => new Vector(xs.map(x => new Quantity(x, 1, 0)));
const isCsys = v => isMap(v) && v.origin instanceof Vector && v.xAxis instanceof Vector && v.zAxis instanceof Vector;
// +1 proper rotation, -1 reflection, 0 not orthonormal (scale/shear).
const rigid = rows => {
  const cols = [0, 1, 2].map(k => rows.map(r => r[k]));
  const orth = cols.every((c, j) => Math.abs(Math.hypot(...c) - 1) < 1e-6 && cols.every((o, k) => j === k || Math.abs(dotN(c, o)) < 1e-6));
  return orth ? Math.sign(dotN(cols[0], crossN(cols[1], cols[2]))) : 0;
};
const LAZY = new Set(['everything-lazy', 'contains-lazy']);
const hasLazy = q => q instanceof TopologyQuery && (LAZY.has(q.kind) || [q.query, q.a, q.b, ...(q.queries ?? [])].some(hasLazy));

function prototypes(engine, classifiers) {
  const ctx = (c, loc) => { if (c !== engine.context) fail('Invalid modeling context', loc); return engine; };
  const v = {};
  const b = (name, min, max, fn) => { v[name] = builtin(name, min, max, (args, loc, it) => { used[name] = (used[name] ?? 0) + 1; return fn(args, loc, it); }); };
  // --- pure values (std context.fs, units.fs, math.fs, valueBounds.fs, coordSystem.fs, curveGeometry.fs, transform.fs)
  b('makeId', 1, 1, ([s], loc) => { if (typeof s !== 'string' || !s || s.includes('/')) fail('makeId expects a nonempty string without "/"', loc); return new Id([s]); });
  v.unitless = 1;
  b('isInteger', 1, 2, ([value, spec], loc) => {
    if (!(typeof value === 'number' && Number.isInteger(value))) return false;
    if (spec === undefined) return true;
    if (!(spec instanceof KeyedMap) || spec.entries.length !== 1 || spec.entries[0][0] !== 1) fail('Expected an IntegerBoundSpec { (unitless) : [min, default, max] }', loc);
    const [lo, , hi] = spec.entries[0][1]; return value >= lo && value <= hi;
  });
  b('atan2', 2, 2, ([y, x], loc) => {
    if ((y instanceof Quantity) !== (x instanceof Quantity) || (y instanceof Quantity && (y.dimension !== x.dimension || y.angle !== x.angle))) fail('atan2 expects two numbers or two values with the same units', loc);
    return new Quantity(Math.atan2(raw(y), raw(x)), 0, 1);
  });
  b('coordSystem', 1, 3, (args, loc) => {
    if (args.length === 1) { const [p] = args; if (!(p instanceof Plane)) fail('coordSystem expects a Plane or origin, xAxis, zAxis', loc); return map({ origin: p.origin, xAxis: p.x, zAxis: p.normal }); }
    if (args.length !== 3) fail('coordSystem expects origin, xAxis, zAxis', loc);
    const [origin, xAxis, zAxis] = args; vectorNumbers(origin, 1, 3, loc);
    const x = unit(vectorNumbers(xAxis, 0, 3, loc), loc), z = unit(vectorNumbers(zAxis, 0, 3, loc), loc);
    if (Math.abs(dotN(x, z)) > 1e-9) fail('coordSystem xAxis must be perpendicular to zAxis', loc);
    return map({ origin, xAxis: new Vector(x), zAxis: new Vector(z) });
  });
  const csysMatrix = (cs, loc) => {
    if (!isCsys(cs)) fail('Expected a CoordSystem', loc);
    const x = vec3(cs.xAxis, loc), z = vec3(cs.zAxis, loc), y = crossN(z, x);
    return new Matrix([0, 1, 2].map(i => [x[i], y[i], z[i]]));
  };
  b('toWorld', 1, 2, ([cs, point], loc) => {
    const M = csysMatrix(cs, loc);
    if (point === undefined) return new Transform(M, cs.origin);
    return binary('+', binary('*', M, point, loc), cs.origin, loc);
  });
  b('fromWorld', 1, 2, ([cs, point], loc) => {
    const M = csysMatrix(cs, loc), T = new Matrix([0, 1, 2].map(i => M.rows.map(r => r[i])));
    const t = binary('*', -1, binary('*', T, cs.origin, loc), loc);
    if (point === undefined) return new Transform(T, t);
    return binary('+', binary('*', T, point, loc), t, loc);
  });
  b('rotationAround', 2, 2, ([axis, theta], loc) => {
    if (!isMap(axis) || !(axis.origin instanceof Vector) || !(axis.direction instanceof Vector)) fail('rotationAround expects a Line', loc);
    if (!(theta instanceof Quantity) || theta.angle !== 1 || theta.dimension !== 0) fail('rotationAround expects an angle', loc);
    const [x, y, z] = unit(vec3(axis.direction, loc), loc), o = vec3(axis.origin, loc), c = Math.cos(theta.value), s = Math.sin(theta.value), t = 1 - c;
    const R = [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
    const Ro = R.map(row => dotN(row, o));
    return new Transform(new Matrix(R), lengthVector(o.map((val, i) => val - Ro[i])));
  });
  b('mirrorAcross', 1, 1, ([plane], loc) => {
    if (!(plane instanceof Plane)) fail('mirrorAcross expects a Plane', loc);
    const n = unit(vec3(plane.normal, loc), loc), o = vec3(plane.origin, loc);
    const L = [0, 1, 2].map(i => [0, 1, 2].map(j => (i === j ? 1 : 0) - 2 * n[i] * n[j]));
    const dd = 2 * dotN(n, o);
    return new Transform(new Matrix(L), lengthVector(n.map(x => dd * x)));
  });
  // --- queries (std query.fs, feature.fs)
  b('qEverything', 0, 1, ([entityType], loc) => {
    if (entityType !== undefined && entityType?.enumType !== 'EntityType') fail('qEverything expects an EntityType', loc);
    const all = new TopologyQuery('everything-lazy');
    if (!entityType || entityType.name === 'BODY') return all;
    return new TopologyQuery('owned', { query: all, entityType });
  });
  b('qNothing', 0, 0, () => new TopologyQuery('union', { queries: [] }));
  b('makeRobustQuery', 2, 2, ([c, q], loc) => {
    const e = ctx(c, loc);
    return new TopologyQuery('reference', { rows: resolveLazy(q, loc), owner: e });
  });
  b('qContainsPoint', 2, 2, ([q, point], loc) => { vectorNumbers(point, 1, 3, loc); return new TopologyQuery('contains-lazy', { query: q, point }); });
  // --- operations (std geomOperations.fs)
  b('opTransform', 3, 3, ([c, id, definition], loc) => {
    const e = ctx(c, loc);
    if (!isMap(definition) || !Object.hasOwn(definition, 'bodies') || !Object.hasOwn(definition, 'transform')) fail('opTransform requires bodies and transform', loc);
    for (const k of Object.keys(definition)) if (!['bodies', 'transform'].includes(k)) unsupported(`Field '${k}' is not supported by this operation`, loc);
    const t = definition.transform;
    if (!(t instanceof Transform)) fail('opTransform expects a Transform', loc);
    const rows = t.linear.rows, sense = rigid(rows);
    if (sense === 0) unsupported('opTransform supports rigid transforms only; scaling is not implemented', loc);
    if (sense < 0) unsupported('opTransform with a mirroring transform is not implemented', loc);
    const offset = vectorNumbers(t.translation, 1, 3, loc);
    e.claim(c, id, loc);
    for (const row of resolveLazy(definition.bodies, loc)) {
      if (row.kind !== 'body') fail('opTransform expects body entities', loc);
      if (row.record.kind !== 'solid') unsupported('opTransform of sketch bodies is not implemented', loc);
      const body = row.record.body;
      row.record.body = (body.geometry === 'analytic' ? transformAnalytic : transformInBend)(e.kernel, body, body.id, rows, offset);
    }
  });
  b('opRevolve', 3, 3, ([c, id, definition], loc) => {
    const e = ctx(c, loc);
    if (!isMap(definition)) fail('Expected a definition map', loc);
    for (const k of Object.keys(definition)) if (!['entities', 'axis', 'angleForward', 'angleBack'].includes(k)) unsupported(`Field '${k}' is not supported by this operation`, loc);
    const sketch = e.resolve(definition.entities, loc), axis = definition.axis;
    if (!isMap(axis) || !(axis.origin instanceof Vector) || !(axis.direction instanceof Vector)) fail('opRevolve expects a Line axis', loc);
    const fwd = definition.angleForward, back = definition.angleBack;
    const full = a => a instanceof Quantity && a.angle === 1 && Math.abs(Math.abs(a.value) - 2 * Math.PI) < 1e-12;
    if (!full(fwd) || (back !== undefined && raw(back) !== 0)) unsupported('opRevolve supports only a full 360-degree revolve', loc);
    const profile = sketch.profiles[0];
    if (!Array.isArray(profile)) unsupported('opRevolve supports only straight-edged (polygon) profiles', loc);
    const P = e.numericPlane(sketch.plane, loc), o = vectorNumbers(axis.origin, 1, 3, loc), a = unit(vectorNumbers(axis.direction, 0, 3, loc), loc);
    const yv = crossN(P.normal, P.x);
    const world = profile.map(([u, w]) => [0, 1, 2].map(i => P.origin[i] + u * P.x[i] + w * yv[i]));
    const rel = world.map(p => p.map((val, i) => val - o[i]));
    const h = rel.map(p => dotN(p, a));
    const radial = rel.map((p, j) => p.map((val, i) => val - h[j] * a[i]));
    const ref = radial.reduce((best, r) => (Math.hypot(...r) > Math.hypot(...best) ? r : best));
    const x = unit(ref, loc);
    const rings = radial.map((r, j) => {
      const along = dotN(r, x);
      if (Math.hypot(...r.map((val, i) => val - along * x[i])) > 1e-9) unsupported('opRevolve profile must lie in a plane through the axis', loc);
      return [along, h[j]];
    });
    const area = rings.reduce((s, p, i) => { const q = rings[(i + 1) % rings.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
    e.claim(c, id, loc);
    e.addSolid(id, revolveInBend(e.kernel, id.toString(), area > 0 ? rings : [...rings].reverse(), o, a, x, 1e-7));
  });

  // Lazy query kinds are resolved here, so production resolveTopology stays untouched.
  function resolveLazy(q, loc) {
    if (q?.kind === 'everything-lazy') return [...engine.records.values()].map(record => ({ record, kind: 'body' }));
    if (q?.kind === 'contains-lazy') {
      const p = vectorNumbers(q.point, 1, 3, loc);
      return resolveLazy(q.query, loc).filter(row => {
        if (row.kind !== 'body') unsupported('qContainsPoint over faces, edges or vertices is not implemented', loc);
        if (row.record.kind !== 'solid') return false;
        const { solid, domains, sourceBudget } = classificationInput(row.record.body, classifiers.face);
        if (solid === null) unsupported('qContainsPoint: solid classification input is invalid', loc);
        const r = classifiers.solid.classify(solid, domains, realVector(p), intersectionTolerance(), sourceBudget);
        if (r.$ === 'Unresolved') unsupported(`qContainsPoint: solid classification unresolved: ${r.reason.$}`, loc);
        return r.$ === 'Inside' || r.$ === 'Boundary';
      });
    }
    if (!hasLazy(q)) return resolveTopology(engine, q, loc);
    const key = r => `${r.record.key}:${r.kind}:${r.index ?? ''}`;
    switch (q.kind) {
      case 'union': return [...new Map(q.queries.flatMap(s => resolveLazy(s, loc)).map(r => [key(r), r])).values()];
      case 'subtract': { const rm = new Set(resolveLazy(q.b, loc).map(key)); return resolveLazy(q.a, loc).filter(r => !rm.has(key(r))); }
      case 'bodyType': return resolveLazy(q.query, loc).filter(r => r.kind === 'body' && r.record.kind === 'solid');
      case 'owned': {
        const kind = q.entityType?.name === 'EDGE' ? 'edges' : q.entityType?.name === 'FACE' ? 'faces' : null;
        if (!kind) unsupported('Only faces and edges can be owned by bodies here', loc);
        return resolveLazy(q.query, loc).filter(r => r.record.kind === 'solid').flatMap(({ record }) => record.body[kind].map((_, index) => ({ record, kind: kind.slice(0, -1), index })));
      }
    }
    unsupported(`Harness cannot resolve lazy query kind '${q.kind}'`, loc);
  }
  return { values: v, resolveLazy };
}

// ------------------------------------------------------------------ run
let source = readFileSync(join(corpus, path), 'utf8');
for (const [re, rep] of stubs) source = source.replace(re, rep);
if (stubs.length) {
  const out = join(DATA, 'src', path);
  mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, source);
}
const t0 = performance.now();
const lines = source.split('\n');
let engine, tracker;
try {
  const program = parse(source);
  const kernel = await loadKernel();
  engine = new ModelingContext(kernel, { modelingPolicy: normalizeModelingPolicy({ curvedContacts: 'strict' }) });
  const classifiers = { face: await loadFaceClassifier(), solid: await loadSolidClassifier() };
  tracker = sourceTracker(engine, source, program, { sourcePath: join(corpus, path) });
  const { values: proto, resolveLazy } = prototypes(engine, classifiers);
  for (const n of disabled) delete proto[n];
  // Production builtins receive lazy queries pre-resolved into 'reference'
  // queries (the rows production would see); query constructors keep them lazy.
  const deep = x => {
    if (hasLazy(x)) return new TopologyQuery('reference', { rows: resolveLazy(x), owner: engine });
    if (isMap(x)) return map(Object.fromEntries(Object.entries(x).map(([k, val]) => [k, deep(val)])));
    if (Array.isArray(x)) return x.map(deep);
    return x;
  };
  const constructors = new Set(['qUnion', 'qSubtraction', 'qBodyType', 'qOwnedByBody']);
  const wrapped = {};
  for (const [name, value] of Object.entries(engine.builtins()))
    wrapped[name] = value?.type === 'builtin' && !constructors.has(name) ? { ...value, call: (args, loc, it) => value.call(args.map(deep), loc, it) } : value;
  // Instrumentation: a query over "all bodies" (qAllModifiableSolidBodies,
  // qEverything) that resolves to nothing means the feature expected parts
  // that already exist in an Onshape Part Studio.
  const overAll = q => q instanceof TopologyQuery && (q.kind === 'allSolid' || q.kind === 'everything-lazy' || [q.query, q.a, q.b, ...(q.queries ?? [])].some(overAll));
  const evaluate = wrapped.evaluateQuery;
  wrapped.evaluateQuery = { ...evaluate, call: (args, loc, it) => {
    const result = evaluate.call(args, loc, it);
    if (overAll(args[1]) && !result.length) { used.emptyAllBodiesQuery = (used.emptyAllBodiesQuery ?? 0) + 1; used.emptyAllBodiesLine ??= loc?.line; }
    return result;
  } };
  if (fold) {
    // STUB of the next cluster (boolean arity): split one multi-tool opBoolean
    // into pairwise production opBoolean calls. Only to see what comes after.
    const base = wrapped.opBoolean;
    const ref = rows => new TopologyQuery('reference', { rows, owner: engine });
    const sub = (id, s) => new Id([...id.parts, s]);
    wrapped.opBoolean = { ...base, call: (args, loc, it) => {
      const [c, id, d0] = args, d = deep(d0);
      const tools = resolveTopology(engine, d.tools, loc), targets = d.targets === undefined ? [] : resolveTopology(engine, d.targets, loc);
      const op = d.operationType?.name;
      if (op === 'SUBTRACTION' && (tools.length > 1 || targets.length > 1)) {
        used.foldBoolean = (used.foldBoolean ?? 0) + 1; let i = 0;
        targets.forEach((t, ti) => tools.forEach(tool => base.call([c, sub(id, `fold${i++}`), map({ ...d, targets: ref([t]), tools: ref([tool]), keepTools: ti < targets.length - 1 || !!d.keepTools })], loc, it)));
        return;
      }
      if (op !== 'SUBTRACTION' && tools.length > 2) {
        used.foldBoolean = (used.foldBoolean ?? 0) + 1;
        for (let i = 1; i < tools.length; i++) base.call([c, sub(id, `fold${i}`), map({ ...d, tools: ref([tools[0], tools[i]]) })], loc, it);
        return;
      }
      return base.call(args, loc, it);
    } };
  }
  const interpreter = new Interpreter({ ...wrapped, ...proto }, { callObserver: tracker.observer });
  const selected = interpreter.run(program, feature, engine.context, new Id(['model']), () => map({}));
  if (!engine.bodies.length) fail('The feature produced no solid bodies');
  // Same model envelope as src/index.mjs build(), so toStep sees what the CLI passes it.
  const { version } = JSON.parse(readFileSync(new URL('../../../bend.lock.json', import.meta.url), 'utf8'));
  const model = { schema: 'wonky-brep/1', units: 'millimeter',
    backend: { language: 'Bend', version, ...backendInfo(kernel), precision: precisionForBodies(engine.bodies) },
    source: { language: 'FeatureScript', version: program.version, feature: selected, imports: program.imports },
    modelingPolicy: engine.modelingPolicy, operationEvidence: [...engine.operationEvidence], bodies: engine.bodies };
  let exportError = null;
  try {
    const step = toStep(model, 'harness');
    if (process.env.HARNESS_OUT) { mkdirSync(dirname(process.env.HARNESS_OUT), { recursive: true }); writeFileSync(`${process.env.HARNESS_OUT}.step`, step); writeFileSync(`${process.env.HARNESS_OUT}.brep.json`, JSON.stringify(model)); }
  } catch (error) { exportError = error.message; }
  const ops = tracker.report().operations;
  console.log(JSON.stringify({ path, feature: feature ?? null, ok: !exportError, stage: exportError ? 'export' : 'ok', message: exportError, bodies: engine.bodies.length,
    faces: engine.bodies.reduce((s, x) => s + x.faces.length, 0), volumesMm3: engine.bodies.map(x => x.validation?.volumeMm3 ?? null), completed: ops.filter(o => o.status === 'completed').length,
    protoCalls: used, ms: Math.round(performance.now() - t0), stubs: stubs.map(([re, rep]) => `${re.source}=>${rep}`) }));
} catch (error) {
  const trace = tracker?.report?.() ?? null;
  const ops = trace?.operations ?? [];
  const failed = [...ops].reverse().find(o => o.status === 'failed') ?? [...ops].reverse().find(o => o.status === 'running');
  const line = error.line ?? null, text = line ? (lines[line - 1] ?? '').trim() : '';
  const userThrow = line != null && /\bthrow\b|regenError\s*\(/.test(text) && error.name === 'FeatureScriptError';
  const completed = ops.filter(o => o.status === 'completed').length;
  let message = String(error.message ?? error);
  if (failed?.error?.message && message !== failed.error.message && message.endsWith(failed.error.message)) message = failed.error.message;
  const cls = classify({ errorClass: failed?.status === 'failed' ? (failed.error?.name ?? error.name) : error.name, message, userThrow, completedOperations: completed });
  console.log(JSON.stringify({ path, feature: feature ?? null, ok: false, stage: 'build', errorClass: error.name, message: message.slice(0, 400), line, column: error.column ?? null,
    sourceLine: text.slice(0, 200), userThrow, completed, failingOperation: failed ? { name: failed.name, status: failed.status, chain: (failed.callStack ?? []).map(f => `${f.name}@${f.calledAt?.line}`).join(' > ') } : null,
    status: cls.status, kind: cls.kind, protoCalls: used, ms: Math.round(performance.now() - t0), stubs: stubs.map(([re, rep]) => `${re.source}=>${rep}`),
    jsStack: error instanceof FeatureScriptError ? undefined : String(error.stack).split('\n').slice(0, 4).join(' | ') }));
}
