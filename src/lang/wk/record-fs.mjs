// FeatureScript -> WK/0 by recording (docs/language.md section 12, spike step 1).
//
// wonky's own parser and interpreter (src/parser.mjs, src/interpreter.mjs) run
// UNCHANGED. So does almost all of the FeatureScript modeling library
// (src/library.mjs ModelingContext, src/queries.mjs): the sketch builtins, the
// body store with its lineage (records, createdBy), queries, opDeleteBodies,
// setProperty, and the source-map tracker (src/source-map.mjs). Only the
// builtins that call the kernel are swapped for recording ones. Each of them
// validates its definition exactly as the production builtin does and then,
// instead of calling the kernel adapter (extrudeInBend, circularFrustumInBend,
// booleanInBend, transformInBend / transformAnalytic), appends one WK/0 node
// whose args are exactly the adapter's arguments. A body in the store becomes
// a symbolic handle (WkBody) that names its node.
//
// Speculation: a recorded Boolean is assumed to return exactly one body, the
// lineage count the production store would see for a one-component result.
// Every boolean node therefore carries `components: 1` (added by
// annotateMethods), which the evaluator checks; and wherever the host program
// OBSERVES a body count that depends on Boolean results (evaluateQuery), an
// `expect_count` node records the observed count at that FS span.
//
// Kernel ops inside `try` (src/interpreter.mjs: only FeatureScriptError is
// catchable, capability errors never are) are recorded speculatively: the node
// carries attrs.try = {mode, at: [spans]} (mode 'rethrow' for Marc's decorate
// idiom `try { ... } catch (e) { throw ...; }`, 'speculate' for any other
// handler, `try(expr)` and `try silent(expr)`). When such a node fails with a
// catchable error, the host REPLAYS the recording (real-run.mjs evaluate):
// options.failures maps the attempt number of that kernel call (every
// recording builtin call counts, including the ones that throw) to today's
// error (name, message, line, column), and the recording builtin throws
// exactly that error at that call instead of adding a node. The unchanged
// interpreter then runs the real handler: a decorating rethrow reports
// today's decorated message at today's location, `try silent` continues, a
// handler may build something else. The replay is deterministic up to the
// failing call (same program, same outcomes), which addNode checks.
//
// Explicit capability errors (UnsupportedFeatureError / GraphBreak) with the
// FS span, never a guess:
//   - a builtin that needs kernel values on the host (evVolume, evBox3d, owned
//     faces/edges, ...): a graph break;
//   - line/arc sketch solving (it runs in the kernel today);
//   - anything outside the WK/0 kernel op set stays explicitly unsupported
//     (for example reflected transforms).
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parse, parseExpression } from '../../parser.mjs';
import { Interpreter } from '../../interpreter.mjs';
import { ModelingContext } from '../../library.mjs';
import { sourceTracker } from '../../source-map.mjs';
import { fail, unsupported, FeatureScriptError, FeatureScriptException, UnsupportedFeatureError } from '../../errors.mjs';
import { EnumValue, Id, Transform, map, isMap, length, vectorNumbers } from '../../values.mjs';
import { dot, cross, norm, normalized, scale, signedArea, tolerance, validatePolygon } from '../../brep.mjs';
import { resolveTopology, rigidTransformDeterminant } from '../../queries.mjs';
import { real, number } from '../../real.mjs';
import { operationEvidenceSchema } from '../../construction-history.mjs';
import { Graph, Ref } from './ir.mjs';

// Boolean method names as today's host predicates (src/boolean.mjs) choose them,
// keyed by the operation-evidence text that the production build reports.
export const METHOD_TEXT = {
  'native Bend planar arrangement union': 'PLANAR', 'native Bend planar arrangement subtraction': 'PLANAR',
  'native Bend planar intersection': 'PLANAR_INTERSECT', 'native Bend curved convex-tool intersection': 'CURVED',
  'native Bend through-hole pierce': 'PIERCE', 'coaxial radial/axial arrangement in Bend': 'COAXIAL',
};
export const methodOf = text => METHOD_TEXT[text] ?? `UNKNOWN(${text})`;

export class GraphBreak extends UnsupportedFeatureError {
  constructor(message, loc, site) { super(message, loc); this.name = 'GraphBreak'; this.site = site; }
}
class SymbolicGeometryAccess extends Error {}
// A replay that does not reach the failing call the same way: an internal
// error of the host, thrown out of the recording (never a recorded status).
export class ReplayDivergence extends Error { constructor(message) { super(message); this.name = 'ReplayDivergence'; } }

// A body in the recording store: the WK node that will produce it. Geometry
// fields throw, so production code that would read kernel results on the host
// (evVolume, evBox3d, owned faces/edges) becomes an explicit graph break.
// Its prototype's `constructor` is Object, like a production body's: the
// source-map snapshot (src/source-map.mjs valueSnapshot) records a
// constructor name where it truncates a nested value, and that snapshot flows
// into identity.operation.parameters.
export class WkBody {
  constructor(ref, id) { this.ref = ref; this.id = id; }
}
Object.defineProperty(WkBody.prototype, 'constructor', { value: Object, writable: true, configurable: true, enumerable: false });
for (const key of ['vertices', 'edges', 'faces', 'validation']) {
  Object.defineProperty(WkBody.prototype, key, {
    get() { throw new SymbolicGeometryAccess(key); },
    set() { throw new SymbolicGeometryAccess(key); },
  });
}

const fieldMap = (value, required, optional, loc) => {
  if (!isMap(value)) fail('Expected a definition map', loc);
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`Missing required field '${key}'`, loc);
  for (const key of Object.keys(value)) if (![...required, ...optional].includes(key)) unsupported(`Field '${key}' is not supported by this operation`, loc);
  return value;
};

// Call sites lexically inside try statements or try expressions, mapped to the
// enclosing tries (innermost last): {mode, line, column}. A try statement whose
// handler is a single `throw` rethrows (decorates); every other form may
// resume host control flow after a catchable failure (see header).
const rethrows = node => node.kind === 'try' && node.handler?.kind === 'block' && node.handler.statements.length === 1 && node.handler.statements[0].kind === 'throw';
function trySites(program) {
  const sites = new WeakMap();
  const walk = (node, enclosing) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(n => walk(n, enclosing)); return; }
    if (node.kind === 'call' && enclosing.length && node.loc) sites.set(node.loc, enclosing);
    const entering = node.kind === 'try' || node.kind === 'tryExpression'
      ? [...enclosing, { mode: rethrows(node) ? 'rethrow' : 'speculate', line: node.loc?.line ?? null, column: node.loc?.column ?? null }] : null;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'loc') continue;
      walk(value, entering && (key === 'body' || key === 'value') ? entering : enclosing);
    }
  };
  walk(program.declarations, []);
  return sites;
}

export function recordFeatureScript(source, { feature, parameters = {}, id = 'model', maxSteps, sourcePath = null, modelingPolicy, failures = null } = {}) {
  const t0 = performance.now();
  const program = parse(source);
  const graph = new Graph({ frontend: 'featurescript', source: sourcePath ?? '<input>', file: sourcePath, feature: feature ?? null });
  const engine = new ModelingContext(null, { modelingPolicy });
  const tracker = sourceTracker(engine, source, program, { sourcePath });
  const tryMap = trySites(program);
  const trace = { speculations: 0, checks: 0, graphBreak: null, tryRethrow: 0, trySpeculate: 0 };
  let interpreter = null;
  const span = loc => graph.span(loc);
  const stackOf = () => (interpreter?.callStack ?? []).filter(f => f.fn?.type !== 'builtin' && f.loc).map(f => ({ line: f.loc.line, column: f.loc.column }));
  // The tries around the current kernel call, outermost first (call stack order).
  const tryContext = loc => {
    const at = [...(interpreter?.callStack ?? []).map(f => f.loc), loc].flatMap(l => (l && tryMap.get(l)) || []);
    if (!at.length) return null;
    const unique = [...new Map(at.map(t => [`${t.line}:${t.column}`, t])).values()];
    return { mode: unique.some(t => t.mode === 'speculate') ? 'speculate' : 'rethrow', at: unique };
  };
  // The tracker pushes its record before the builtin runs: the last record is this call.
  // Replay (options.failures): the attempt-th kernel call throws today's error.
  let attempt = 0;
  const addNode = (op, args, idValue, loc, extra = null) => {
    const k = attempt++;
    const known = failures?.get(k);
    if (known) {
      if (known.op !== op || known.id !== (idValue == null ? null : String(idValue)) || known.line !== (loc?.line ?? null) || known.column !== (loc?.column ?? null))
        throw new ReplayDivergence(`WK replay diverged at kernel call ${k}: expected ${known.op} ${known.id} at ${known.line}:${known.column}, got ${op} ${idValue} at ${loc?.line}:${loc?.column}`);
      throw todayError(known.error);
    }
    const inTry = tryContext(loc);
    if (inTry) trace[inTry.mode === 'rethrow' ? 'tryRethrow' : 'trySpeculate']++;
    const attrs = extra || inTry ? { ...(extra ?? {}), ...(inTry ? { try: inTry } : {}) } : null;
    const ref = graph.add(op, args, { type: 'bodies', id: idValue == null ? null : String(idValue), span: span(loc), stack: stackOf(), attrs });
    graph.nodes[ref.node].sequence = tracker.report().operations.length - 1;
    graph.nodes[ref.node].attempt = k;
    return ref;
  };
  // name / appearance: production copies them from the source body object when a
  // Boolean or a transform creates a result (opBoolean, transformAnalytic:
  // `!== undefined`; transformInBend for polyhedral bodies: truthy), and
  // setProperty writes them into the body object in place. The handle mirrors
  // that object, so its own name/appearance keys (in insertion order) are what
  // production's body holds at this point of the program. Nodes and outputs
  // record them as `props` for the host replay.
  const polyNodes = new Set();
  const handle = (ref, bodyId, from, copy = v => v !== undefined) => {
    const h = new WkBody(ref, bodyId);
    for (const key of ['name', 'appearance']) if (from && copy(from[key])) h[key] = from[key];
    return h;
  };
  const propsOf = h => Object.keys(h ?? {}).filter(k => k === 'name' || k === 'appearance').map(k => [k, h[k]]);

  // --- the production library, with the kernel-facing builtins swapped ----------------
  const values = engine.builtins();
  const production = { ...values };
  // Production ModelingContext.body() (src/library.mjs), with extrudeInBend replaced by a node.
  // Installed as a NON-enumerable own property: the engine is the `owner` of every
  // evaluateQuery reference query, and the source-map snapshot of an operation's
  // arguments (src/source-map.mjs valueSnapshot, which ends up in
  // identity.operation.parameters) walks the owner's enumerable own properties.
  // A plain assignment would add `body: {type: 'function'}` there, which today's
  // engine does not have (docs/language/prototype.md, fix round 2).
  Object.defineProperty(engine, 'body', { configurable: true, writable: true, enumerable: false, value: function (bodyId, points, plane, delta, offset, loc, identityContext = {}, profileSource = null) {
    if (this.bodies.length >= 128) fail('Prototype limit: 128 bodies per feature', loc);
    validatePolygon(points, loc);
    const eps = tolerance([...points, plane.origin, delta, offset ?? [0, 0, 0]]);
    const height = dot(delta, plane.normal);
    if (!Number.isFinite(height) || Math.abs(height) <= eps) fail('Extrusion has zero or unresolved thickness normal to the sketch plane', loc);
    const oriented = signedArea(points) * height < 0 ? [...points].reverse() : points;
    let ref;
    // production (library.mjs body) wraps extrudeInBend: an error without a line gets this loc
    try { ref = addNode('extrude_polygon', { points: oriented.map(p => [...p]), plane: { origin: [...plane.origin], normal: [...plane.normal], x: [...plane.x] },
      delta: [...delta], offset: offset === undefined ? null : [...offset], precision: 'F32x2' }, bodyId, loc,
      identityContext.primitive || profileSource ? { ...(identityContext.primitive ? { primitive: identityContext.primitive } : {}), ...(profileSource ? { profileSource } : {}) } : null); }
    catch (error) { if (!error.line && loc) { error.line = loc.line; error.column = loc.column; } throw error; }
    polyNodes.add(ref.node);
    this.addSolid(bodyId, handle(ref, bodyId.toString()));
  } });
  const builtin = (name, min, max, call) => ({ type: 'builtin', name, min, max, call });
  const circle = p => ({ center: [...p.center], radius: p.radius, plane: { origin: [...p.plane.origin], normal: [...p.plane.normal], x: [...p.plane.x] } });
  values.skSolve = builtin('skSolve', 1, 1, (args, loc, i) => {
    const [sketch] = args;
    engine.sketch(sketch, loc, true);
    if (sketch.curveEntities.length) unsupported('Line/arc sketch solving runs in the kernel today and is not in the WK spike op set', loc);
    return production.skSolve.call(args, loc, i);
  });
  values.opExtrude = builtin('opExtrude', 3, 3, ([context, opId, definition], loc) => {
    const d = fieldMap(definition, ['entities', 'direction', 'endBound', 'endDepth'], ['startBound', 'startDepth'], loc);
    if (d.endBound !== 'BoundingType.BLIND' || (d.startBound !== undefined && d.startBound !== 'BoundingType.BLIND')) unsupported('Only BoundingType.BLIND extrusion bounds are implemented', loc);
    if ((d.startBound !== undefined) !== (d.startDepth !== undefined)) fail('startBound and startDepth must be supplied together', loc);
    const sketch = engine.resolve(d.entities, loc), direction = normalized(vectorNumbers(d.direction, 0, 3, loc), loc);
    const end = length(d.endDepth, loc), start = d.startDepth === undefined ? 0 : length(d.startDepth, loc);
    engine.claim(context, opId, loc);
    const profile = sketch.profiles[0];
    if (profile.type === 'line-arc') unsupported('Extrusion of a line/arc sketch profile is not in the WK spike op set', loc);
    if (profile.type === 'circle') {
      const ref = addNode('frustum', { first: circle({ ...profile, plane: engine.numericPlane(sketch.plane, loc) }), second: null,
        delta: scale(direction, end + start), offset: scale(direction, -start) }, opId, loc);
      engine.addSolid(opId, handle(ref, opId.toString()));
    } else engine.body(opId, profile, engine.numericPlane(sketch.plane, loc), scale(direction, end + start), scale(direction, -start), loc, {}, sketch.lineProfileSource);
  });
  values.opLoft = builtin('opLoft', 3, 3, ([context, opId, definition], loc) => {
    const d = fieldMap(definition, ['profileSubqueries'], [], loc);
    if (!Array.isArray(d.profileSubqueries) || d.profileSubqueries.length !== 2) unsupported('opLoft currently requires two coaxial circular profiles', loc);
    const profiles = d.profileSubqueries.map(q => engine.resolve(q, loc));
    if (profiles.some(s => s.profiles[0].type !== 'circle')) unsupported('opLoft currently requires two coaxial circular profiles', loc);
    engine.claim(context, opId, loc);
    const [a, b] = profiles.map(s => ({ ...s.profiles[0], plane: engine.numericPlane(s.plane, loc) }));
    const ref = addNode('frustum', { first: circle(a), second: circle(b), delta: null, offset: null }, opId, loc);
    engine.addSolid(opId, handle(ref, opId.toString()));
  });
  values.opBoolean = builtin('opBoolean', 3, 3, ([context, opId, definition], loc) => {
    const d = fieldMap(definition, ['tools', 'operationType'], ['targets', 'keepTools'], loc);
    if (!(d.operationType instanceof EnumValue) || d.operationType.enumType !== 'BooleanOperationType') fail('opBoolean requires a BooleanOperationType', loc);
    const operation = d.operationType.name;
    if (!['UNION', 'INTERSECTION', 'SUBTRACTION'].includes(operation)) unsupported(`Boolean operation '${operation}' is not implemented`, loc);
    if (d.keepTools !== undefined && typeof d.keepTools !== 'boolean') fail('keepTools must be boolean', loc);
    const tools = resolveTopology(engine, d.tools, loc);
    const targets = d.targets === undefined ? [] : resolveTopology(engine, d.targets, loc);
    if ([...tools, ...targets].some(r => r.kind !== 'body' || r.record.kind !== 'solid')) fail('opBoolean expects solid-body queries', loc);
    const subtract = operation === 'SUBTRACTION';
    if (subtract ? tools.length !== 1 || targets.length !== 1 : tools.length !== 2 || d.targets !== undefined) unsupported('opBoolean currently requires two tools for union/intersection, or one target and one tool for subtraction', loc);
    if (!subtract && d.keepTools) unsupported('keepTools is currently supported only for subtraction', loc);
    const records = (subtract ? [...targets, ...tools] : tools).map(r => r.record);
    if (records[0] === records[1]) fail('Boolean target and tool must be different bodies', loc);
    engine.claim(context, opId, loc);
    const kind = { UNION: 'union', SUBTRACTION: 'subtract', INTERSECTION: 'intersect' }[operation];
    const [a, b] = records.map(r => r.body.ref);
    const props = propsOf(records[0].body);
    const ref = addNode('boolean', subtract ? { kind, targets: [a], tools: [b], keepTools: d.keepTools ?? false } : { kind, targets: [], tools: [a, b], keepTools: false }, opId, loc,
      props.length ? { props } : null);
    // The production store (library.mjs opBoolean) for a one-component result.
    const lineage = new Set([...records[0].createdBy, ...(subtract ? [] : records[1].createdBy), opId.key()]);
    if (!subtract || !d.keepTools) engine.records.delete(records[1].key);
    records[0].body = handle(ref, `${opId}/0`, records[0].body);
    records[0].body.speculative = true;
    records[0].createdBy = lineage;
    // A COUNT placeholder, never output: the source-map snapshot of an evaluateQuery
    // reference (owner = this engine, see engine.body above) lists one truncated
    // entry per element of engine.operationEvidence, so the recorder keeps the same
    // number of entries as production. The real evidence is built by the host
    // replay (real-host.mjs replayIdentity) and returned by real-run.mjs
    // assembleModel as the model's operationEvidence.
    engine.operationEvidence.push({ schema: operationEvidenceSchema, operationId: String(opId), recorded: true });
    trace.speculations++;
  });
  // opTransform changes the existing body records; unlike opPattern it adds no
  // copies. Reflections require the JS adapter's winding reversal and cannot
  // be represented by WK/0's proper-rotation transform node.
  values.opTransform = builtin('opTransform', 3, 3, ([c, opId, definition], loc) => {
    if (!c?.engine || c.engine !== engine) fail('Invalid modeling context', loc);
    const d = fieldMap(definition, ['bodies', 'transform'], [], loc);
    const source = resolveTopology(engine, d.bodies, loc);
    if (!source.length) unsupported('opTransform bodies resolved to no solids', loc);
    if (source.some(row => row.kind !== 'body' || row.record.kind !== 'solid')) unsupported('opTransform requires solid bodies', loc);
    const t = d.transform;
    if (!(t instanceof Transform) || t.linear?.rows?.length !== 3 || t.linear.rows.some(row => row.length !== 3 || row.some(x => !Number.isFinite(x)))) fail('opTransform expects a 3×3 Transform', loc);
    const rows = t.linear.rows, det = rigidTransformDeterminant(rows);
    if (det === null) unsupported('opTransform supports only rigid transforms and reflections', loc);
    if (det < 0) unsupported('WK/0 opTransform reflection requires orientation reversal not available in its transform node', loc);
    const offset = vectorNumbers(t.translation, 1, 3, loc);
    engine.claim(c, opId, loc);
    // A speculative Boolean may actually have produced several bodies. The
    // transform node accepts a single body, so check its input count BEFORE
    // recording a transform that could silently move only the first result.
    for (const row of source) if (row.record.body.speculative) {
      graph.add('expect_count', { of: [row.record.body.ref], count: 1 }, { type: 'check', span: span(loc), stack: stackOf() });
      trace.checks++;
    }
    for (const row of source) {
      const old = row.record.body, props = propsOf(old);
      const ref = addNode('transform', { bodies: old.ref, rotation: rows.map(r => [...r]), offset: [...offset] }, old.id, loc, props.length ? { props } : null);
      const poly = polyNodes.has(old.ref.node);
      if (poly) polyNodes.add(ref.node);
      const transformed = handle(ref, old.id, old, poly ? v => Boolean(v) : undefined);
      if (old.speculative) transformed.speculative = true;
      row.record.body = transformed;
      row.record.createdBy = new Set([...row.record.createdBy, opId.key()]);
    }
  });
  // Production opPattern (src/queries.mjs), with transformInBend / transformAnalytic replaced by nodes.
  values.opPattern = builtin('opPattern', 3, 3, ([c, opId, definition], loc) => {
    if (!c?.engine || c.engine.context !== c) fail('Invalid modeling context', loc);
    engine.claim(c, opId, loc);
    const { transforms, instanceNames } = definition;
    if (!Array.isArray(transforms) || !Array.isArray(instanceNames) || transforms.length !== instanceNames.length || new Set(instanceNames).size !== instanceNames.length) fail('opPattern requires matching transforms and unique instanceNames', loc);
    const source = resolveTopology(c.engine, definition.entities, loc);
    if (source.some(row => row.kind !== 'body' || row.record.kind !== 'solid')) unsupported('Only solid-body patterns are implemented', loc);
    transforms.forEach((t, i) => {
      if (!(t instanceof Transform)) fail('Expected a Transform', loc);
      const rows = t.linear.rows;
      const proper = rows.every((row, j) => Math.abs(norm(row) - 1) < 1e-6 && rows.every((other, k) => j === k || Math.abs(dot(row, other)) < 1e-6)) && Math.abs(dot(rows[0], cross(rows[1], rows[2])) - 1) < 1e-6;
      if (!proper) unsupported('Only proper rigid transforms are implemented', loc);
      const offset = vectorNumbers(t.translation, 1, 3, loc);
      for (const row of source) {
        const name = `${opId}/${instanceNames[i]}/${row.record.body.id}`;
        const poly = polyNodes.has(row.record.body.ref.node), props = propsOf(row.record.body);
        const ref = addNode('transform', { bodies: row.record.body.ref, rotation: rows.map(r => [...r]), offset: [...offset] }, name, loc, props.length ? { props } : null);
        if (poly) polyNodes.add(ref.node);
        // transformInBend copies name / appearance when truthy, transformAnalytic when defined
        const h = handle(ref, name, row.record.body, poly ? v => Boolean(v) : undefined);
        if (row.record.body.speculative) h.speculative = true;
        engine.addSolid(opId, h);
      }
    });
  });
  // Count speculation: the host observes how many bodies a query returns.
  values.evaluateQuery = builtin('evaluateQuery', 2, 2, (args, loc, i) => {
    const out = production.evaluateQuery.call(args, loc, i);
    const solids = out.flatMap(q => q.rows).filter(r => r.record.kind === 'solid');
    if (solids.some(r => r.record.body.speculative)) {
      graph.add('expect_count', { of: solids.map(r => r.record.body.ref), count: solids.length }, { type: 'check', span: span(loc), stack: stackOf() });
      trace.checks++;
    }
    return out;
  });
  // Every builtin: a symbolic body read on the host is a graph break at this call.
  for (const [name, value] of Object.entries(values)) {
    if (value?.type !== 'builtin') continue;
    const call = value.call;
    values[name] = { ...value, call: (args, loc, i) => {
      try { return call(args, loc, i); }
      catch (error) {
        if (error instanceof SymbolicGeometryAccess) throw new GraphBreak(`${name} reads body ${error.message} on the host; that needs kernel results (graph break)`, loc, name);
        throw error;
      }
    } };
  }

  interpreter = new Interpreter(values, { maxSteps, callObserver: tracker.observer });
  const definition = () => {
    const result = map({});
    for (const [name, expression] of Object.entries(parameters)) result[name] = interpreter.expression(parseExpression(expression));
    return result;
  };
  let status = 'complete', error = null, selected = null;
  try {
    selected = interpreter.run(program, feature, engine.context, new Id([id]), definition);
    if (!engine.bodies.length) fail('The feature produced no solid bodies');
  } catch (caught) {
    if (caught instanceof ReplayDivergence) throw caught;
    error = caught;
    status = caught instanceof GraphBreak ? 'break' : caught instanceof UnsupportedFeatureError ? 'unsupported' : 'error';
    if (caught instanceof GraphBreak) trace.graphBreak = { message: caught.message, line: caught.line ?? null, column: caught.column ?? null, site: caught.site };
  }
  graph.meta.feature = selected ?? feature ?? null;
  // Outputs in production store order (engine.bodies); body.debug.sourceOperation is
  // the tracker sequence of the operation that created each handle.
  const outputs = engine.bodies.map(body => ({ ref: body.ref, bodyId: body.id, name: body.name ?? null, appearance: body.appearance ?? null, props: propsOf(body) }));
  for (const o of outputs) graph.output(o.ref, { name: o.name, appearance: o.appearance });
  const sourceMap = tracker.report();
  return { graph, status, error, trace, outputs, sourceMap, steps: interpreter.steps, ms: performance.now() - t0, attempts: attempt,
    input: { source, options: { feature, parameters, id, maxSteps, sourcePath, modelingPolicy } } };
}

// Today's error object for a replayed kernel failure: a FeatureScriptException
// (a raise(), which FeatureScript try can catch) or a FeatureScriptError (a
// fail(), which it cannot; W1 try semantics, src/errors.mjs catchable), as
// real-run.mjs replayName decides, with today's message and today's location
// (none where today's adapter raises it without one; the library wrapper above
// adds the call location for polygon extrusions, as production does).
function todayError({ name, message, line, column }) {
  const Kind = name === 'FeatureScriptException' ? FeatureScriptException : name === 'FeatureScriptError' ? FeatureScriptError : null;
  if (!Kind) throw new Error(`WK replay: only FeatureScript kernel failures are replayed, not ${name}`);
  return new Kind(message, line != null ? { line, column } : undefined);
}

export function recordFile(path, options = {}) {
  return recordFeatureScript(readFileSync(path, 'utf8'), { sourcePath: path, ...options });
}

// --- Boolean method speculation over any WK graph (FS or build123d) -------------------
//
// Mirrors the predicates of src/boolean.mjs booleanInBend on symbolic body
// classes derived from the graph: which surface/curve types a node's bodies
// have, whether edges carry explicit curve ranges, and whether the body is a
// frustum primitive with equal radii (compared, like the host, as binary64
// numbers of the F32x2 radii). The evaluator re-checks every predicate on the
// real operands and refuses a mismatch; it never switches methods.
const cls = (geometry, faces, edges, { curveRange = false, primitive = null, construction = null } = {}) =>
  ({ geometry, faces: new Set(faces), edges: new Set(edges), curveRange, primitive, construction });
const subset = (set, allowed) => [...set].every(x => allowed.includes(x));

export function booleanMethod(operation, a, b) {
  if (!a || !b) return 'UNKNOWN';
  const cylinder = x => x.primitive !== null && x.primitive.r0 === x.primitive.r1;
  if (cylinder(a) && cylinder(b)) return 'COAXIAL';
  const planar = x => subset(x.faces, ['plane']) && subset(x.edges, ['line']);
  if (['UNION', 'SUBTRACTION'].includes(operation) && planar(a) && planar(b)) return 'PLANAR';
  if (operation === 'INTERSECTION' && planar(a) && planar(b)) return 'PLANAR_INTERSECT';
  const curvedFamily = x => subset(x.faces, ['plane', 'cylinder']) && subset(x.edges, ['line', 'circle', 'ellipse']);
  if (operation === 'INTERSECTION' && curvedFamily(a) && curvedFamily(b)) return 'CURVED';
  const pierceable = x => subset(x.faces, ['plane', 'cylinder']) && subset(x.edges, ['line', 'circle']) && !x.curveRange;
  if (operation === 'SUBTRACTION' && pierceable(a) && cylinder(b)) return 'PIERCE';
  return 'NONE';
}

export function annotateMethods(graph) {
  const classes = new Map();
  const classOf = ref => ref instanceof Ref ? classes.get(ref.node) ?? null : null;
  for (const node of graph.nodes) {
    const a = node.args;
    if (node.op === 'extrude_polygon') classes.set(node.n, cls('poly', ['plane'], ['line']));
    else if (node.op === 'frustum') {
      const r0 = number(real(a.first.radius)), r1 = number(real((a.second ?? a.first).radius));
      classes.set(node.n, cls('analytic', ['plane', r0 === r1 ? 'cylinder' : 'cone'], ['circle', 'line'], { primitive: { r0, r1 } }));
    } else if (node.op === 'transform') classes.set(node.n, classOf(a.bodies));
    else if (node.op === 'boolean') {
      const operation = { union: 'UNION', subtract: 'SUBTRACTION', intersect: 'INTERSECTION' }[a.kind];
      const [x, y] = operation === 'SUBTRACTION' ? [a.targets[0], a.tools[0]] : [a.tools[0], a.tools[1]];
      const method = booleanMethod(operation, classOf(x), classOf(y));
      node.args = { ...a, method, components: 1 };
      classes.set(node.n, {
        COAXIAL: cls('analytic', ['plane', 'cylinder'], ['circle', 'line'], { construction: 'coaxial' }),
        PLANAR: cls('analytic', ['plane'], ['line'], { curveRange: true, construction: 'planar' }),
        PIERCE: cls('analytic', ['plane', 'cylinder'], ['line', 'circle'], { construction: 'pierce' }),
      }[method] ?? null);
    }
  }
  return graph;
}
