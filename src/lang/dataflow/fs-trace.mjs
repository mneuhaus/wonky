// FeatureScript -> WGraph/0 by *mock execution*: wonky's own parser and
// interpreter run the unmodified FeatureScript value layer (loops, helper
// functions, ids, units, maps) on the host, and every modeling builtin is
// replaced by a symbolic one that appends a WGraph node instead of computing
// geometry. No kernel is loaded.
//
// The symbolic store knows body lineage (creation ids, versions, names), so
// body-level queries (qCreatedBy, qUnion, qSubtraction, qBodyType, imports by
// name, evaluateQuery over bodies) resolve on the host without geometry.
// Anything that needs geometry on the host - evaluateQuery over faces/edges,
// ev* measurements - is a *graph break*: the trace stops there with the site.
// When a host branch depends on a body count the store cannot know for sure
// (a Boolean may split or remove a body), the tracer speculates on the count it
// derived from lineage and records a kernel-side `expect.count` check node, so
// a wrong guess is detected at evaluation time, never silently accepted.
//
// Missing builtins are capability errors (UnsupportedFeatureError), exactly as
// in the interpreter. Nothing is approximated.
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parse, parseExpression } from '../../parser.mjs';
import { Interpreter } from '../../interpreter.mjs';
import { ModelingContext } from '../../library.mjs';
import { frozenModules, isCompositeRecord, refuseComposite } from '../../modules.mjs';
import { enumSet, GEOMETRY_TYPES, TopologyQuery } from '../../queries.mjs';
import { fail, unsupported, UnsupportedFeatureError } from '../../errors.mjs';
import { EnumValue, Id, KeyedMap, Matrix, Plane, Quantity, Transform, Vector, binary, isMap, map, vectorNumbers } from '../../values.mjs';
import { Graph } from './graph.mjs';
import { canon } from './canon.mjs';
import { extraValueBuiltins } from './fs-values.mjs';

export class GraphBreak extends UnsupportedFeatureError {
  constructor(message, loc, site) { super(message, loc); this.name = 'GraphBreak'; this.site = site; }
}

const builtin = (name, min, max, call) => ({ type: 'builtin', name, min, max, call });
const enumIs = (value, type, name) => value instanceof EnumValue && value.enumType === type && value.name === name;

// Symbolic query: FeatureScript queries are data in FS as well (std query.fs).
class SymQuery {
  constructor(kind, data = {}) { this.type = 'Query'; this.kind = kind; Object.assign(this, data); }
}

class SymSketch {
  constructor(id, plane) { this.type = 'Sketch'; this.id = id; this.plane = plane; this.entities = []; this.solved = false; this.regions = 0; }
}

// ---------------------------------------------------------------------------------------------
class GraphEngine {
  constructor(graph, trace) {
    this.graph = graph; this.trace = trace;
    this.context = { type: 'Context', engine: this };
    this.records = new Map(); this.nextRecord = 0; this.ids = new Set(); this.sketches = new Map();
    this.readOnly = false; this.variables = new Map();
    this.kernel = null; // frozen-module bodies are never materialized in a trace
  }
  claim(context, id, loc) {
    if (context !== this.context) fail('Invalid modeling context', loc);
    if (this.readOnly) fail('An imported source context is read-only', loc);
    if (!(id instanceof Id)) fail('Expected Id', loc);
    if (this.ids.has(id.key())) fail(`Duplicate operation ID '${id}'`, loc);
    this.ids.add(id.key());
  }
  record(kind, id, node, extra = {}) {
    const key = String(this.nextRecord++);
    const r = { key, kind, createdBy: new Set(id ? [id.key()] : []), node, uncertain: false, ...extra };
    this.records.set(key, r); return r;
  }
  span(loc) { return loc ? { line: loc.line, column: loc.column } : null; }
}

// Resolve a symbolic query against the symbolic store.
// Result: { level: 'body'|'entity', rows: records (bodies, or owners for entities),
//           exact: bool (membership known without geometry), filters: [text], entity }
function resolve(engine, q, loc) {
  if (q instanceof TopologyQuery) { // produced by wonky's instantiator addInstance
    if (q.kind === 'created') q = new SymQuery('created', { id: q.id, entityType: q.entityType });
    else unsupported(`Query '${q.kind}' from the interpreter library cannot be traced`, loc);
  }
  if (Array.isArray(q)) q = new SymQuery('union', { queries: q });
  if (!(q instanceof SymQuery)) fail('Expected a Query', loc);
  const live = () => [...engine.records.values()];
  const entityOf = (rows, type) => {
    if (!type || enumIs(type, 'EntityType', 'BODY')) return { level: 'body', rows, exact: true, filters: [] };
    return { level: 'entity', rows: rows.filter(r => r.kind === 'solid'), exact: false, filters: [`entities:${type.name}`], entity: type.name };
  };
  switch (q.kind) {
    case 'created': {
      // wonky today: exact id match. Onshape std (query.fs): entities created by the operation or any
      // sub-operation (probe qCreatedByPrefix in docs/language/semantic-core.md); study mode uses that.
      const key = q.id.key(), prefix = engine.createdByPrefix ? JSON.stringify(q.id.parts).slice(0, -1) + ',' : null;
      return entityOf(live().filter(r => r.createdBy.has(key) || (prefix && [...r.createdBy].some(k => k.startsWith(prefix)))), q.entityType);
    }
    case 'everything': {
      // A composite part of an imported module (decision 11): Onshape's answer would include the
      // bodies a closed composite consumes, which the capture does not hold. Refused as in the library.
      const rows = live(), composite = rows.find(isCompositeRecord);
      if (composite) refuseComposite(composite, loc, { wholeContext: true });
      return entityOf(rows, q.entityType);
    }
    case 'allSolid': return { level: 'body', rows: live().filter(r => r.kind === 'solid'), exact: true, filters: [] };
    case 'nothing': return { level: 'body', rows: [], exact: true, filters: [] };
    case 'sketchRegion': {
      const rows = live().filter(r => r.kind === 'sketch' && r.createdBy.has(q.id.key()));
      if (!rows.length) fail(`Sketch '${q.id}' does not exist or has not been solved`, loc);
      return { level: 'body', rows, exact: true, filters: [], sketchRegion: true };
    }
    case 'reference': return { level: q.level, rows: q.records.filter(r => engine.records.get(r.key) === r), exact: q.level === 'body', filters: q.filters ?? [], entity: q.entity };
    case 'union': {
      const parts = q.queries.map(x => resolve(engine, x, loc));
      const rows = [...new Map(parts.flatMap(p => p.rows).map(r => [r.key, r])).values()];
      const level = parts.every(p => p.level === 'body') ? 'body' : 'entity';
      return { level, rows, exact: parts.every(p => p.exact), filters: parts.some(p => !p.exact) ? ['union', ...parts.flatMap(p => p.filters)] : [], entity: parts.find(p => p.entity)?.entity };
    }
    case 'subtract': {
      const a = resolve(engine, q.a, loc), b = resolve(engine, q.b, loc);
      if (a.level === 'body' && b.level === 'body' && a.exact && b.exact) {
        const drop = new Set(b.rows.map(r => r.key));
        return { level: 'body', rows: a.rows.filter(r => !drop.has(r.key)), exact: true, filters: [] };
      }
      return { ...a, rows: [...new Map([...a.rows, ...b.rows].map(r => [r.key, r])).values()], exact: false, filters: [...a.filters, 'minus', ...b.filters] };
    }
    case 'intersection': {
      const parts = q.queries.map(x => resolve(engine, x, loc));
      if (parts.every(p => p.level === 'body' && p.exact)) {
        const keep = parts.slice(1).map(p => new Set(p.rows.map(r => r.key)));
        return { level: 'body', rows: parts[0]?.rows.filter(r => keep.every(s => s.has(r.key))) ?? [], exact: true, filters: [] };
      }
      return { ...parts[0], rows: [...new Map(parts.flatMap(p => p.rows).map(r => [r.key, r])).values()], exact: false, filters: ['intersection', ...parts.flatMap(p => p.filters)] };
    }
    case 'bodyType': {
      const inner = resolve(engine, q.query, loc);
      if (inner.level !== 'body') return { ...inner, filters: [...inner.filters, `bodyType:${q.bodyType.name}`] };
      const solid = enumIs(q.bodyType, 'BodyType', 'SOLID');
      return { ...inner, rows: inner.rows.filter(r => (r.kind === 'solid') === solid) };
    }
    case 'owned': return { level: 'entity', rows: resolve(engine, q.query, loc).rows.filter(r => r.kind === 'solid'), exact: false, filters: [`owned:${q.entityType.name}`], entity: q.entityType.name };
    case 'ownerBody': {
      const inner = resolve(engine, q.query, loc);
      return { level: 'body', rows: inner.rows, exact: inner.level === 'body' ? inner.exact : false, filters: inner.level === 'body' ? inner.filters : [...inner.filters, 'ownerBody'] };
    }
    case 'geometric': { // qGeometry, qContainsPoint, qLargest, qClosestTo, qNthElement, qAdjacent, ...
      const inner = resolve(engine, q.query, loc);
      return { ...inner, exact: false, filters: [...inner.filters, `${q.filter}(${q.args.map(canon).join(',')})`] };
    }
    default: unsupported(`Query kind '${q.kind}' is not traced`, loc);
  }
}

// ---------------------------------------------------------------------------------------------
// Study mode (corpus statistics only): supply what the Onshape UI and document supply,
// as explicit graph *inputs*, never as invented geometry:
//   - UI defaults for feature parameters without a Default annotation (std bound
//     defaults, false, "", [], the first enum member);
//   - user picks (`definition.x is Query`) become `input.pick` nodes;
//   - namespaced document imports without a frozen snapshot become `import.opaque`
//     nodes with an unknown part list (part names stay unknown: a capability error);
//   - optionally, the Part Studio already contains bodies: one `input.context` node.
const STD_BOUND_DEFAULTS = {
  LENGTH_BOUNDS: '25 * millimeter', NONNEGATIVE_LENGTH_BOUNDS: '25 * millimeter', POSITIVE_LENGTH_BOUNDS: '25 * millimeter',
  NONNEGATIVE_ZERO_INCLUSIVE_LENGTH_BOUNDS: '25 * millimeter', NONNEGATIVE_ZERO_DEFAULT_LENGTH_BOUNDS: '0 * millimeter',
  NONPOSITIVE_ZERO_DEFAULT_LENGTH_BOUNDS: '0 * millimeter', ZERO_DEFAULT_LENGTH_BOUNDS: '0 * millimeter', BLEND_BOUNDS: '5 * millimeter',
  ANGLE_360_BOUNDS: '30 * degree', ANGLE_360_ZERO_DEFAULT_BOUNDS: '0 * degree', ANGLE_360_90_DEFAULT_BOUNDS: '90 * degree',
  ANGLE_STRICT_90_BOUNDS: '3 * degree', ANGLE_STRICT_180_BOUNDS: '30 * degree', POSITIVE_COUNT_BOUNDS: '2', POSITIVE_REAL_BOUNDS: '1',
};
export function studyParameters(program, featureName) {
  const decl = program.declarations.find(d => d.name === featureName);
  const fn = decl?.value?.kind === 'call' ? decl.value.args[0] : null;
  const out = {}, picks = [];
  const enums = new Map(program.declarations.filter(d => d.kind === 'enum').map(d => [d.name, d.members[0]?.name]));
  const hasDefault = st => (st.annotations ?? []).some(a => a.kind === 'map' && a.fields.some(([k]) => k.value === 'Default'));
  const keyOf = e => (e?.kind === 'access' && e.value.kind === 'name' && e.value.name === fn.params[2]?.name && e.key.kind === 'literal' ? e.key.value : null);
  const walk = st => {
    if (!st) return;
    if (st.kind === 'block') return st.statements.forEach(walk);
    if (st.kind === 'if') { walk(st.yes); walk(st.no); return; }
    if (st.kind !== 'expression' || hasDefault(st)) return;
    const e = st.value;
    if (e.kind === 'call' && e.callee.kind === 'name' && ['isLength', 'isAngle', 'isInteger', 'isReal'].includes(e.callee.name)) {
      const key = keyOf(e.args[0]); const bound = e.args[1]?.kind === 'name' ? e.args[1].name : null;
      if (key && bound && STD_BOUND_DEFAULTS[bound]) out[key] = STD_BOUND_DEFAULTS[bound];
      else if (key && !bound) out[key] = { isLength: '25 * millimeter', isAngle: '30 * degree', isInteger: '1', isReal: '1' }[e.callee.name];
    } else if (e.kind === 'type' && e.operator === 'is') {
      const key = keyOf(e.value); if (!key) return;
      if (e.type === 'boolean') out[key] = 'false';
      else if (e.type === 'string') out[key] = '""';
      else if (e.type === 'array') out[key] = '[]';
      else if (e.type === 'Query') { out[key] = `__studyPick(${JSON.stringify(key)})`; picks.push(key); }
      else if (enums.get(e.type)) out[key] = `${e.type}.${enums.get(e.type)}`;
    }
  };
  if (fn?.precondition) walk(fn.precondition);
  return { parameters: out, picks };
}

export function traceFeatureScript(source, { feature, parameters = {}, id = 'model', maxSteps, moduleManifest, sourcePath = null, study = null } = {}) {
  const t0 = performance.now();
  const program = parse(source);
  const graph = new Graph({ frontend: 'featurescript', source: sourcePath ?? '<input>', feature: feature ?? null });
  const trace = { checks: 0, speculations: [], break: null, deletes: 0, properties: 0, inputs: [] };
  const engine = new GraphEngine(graph, trace);
  // The interpreter's call stack array is live; it is copied only when a node is created.
  let live = [];
  const observer = { watches: fn => fn.traced === true, enter({ stack: frames }) { live = frames; return null; }, leave() {} };
  const currentStack = () => live.filter(f => f.fn?.type !== 'builtin' && f.loc).map(f => ({ line: f.loc.line, column: f.loc.column }));
  const inner = moduleManifest ? frozenModules(moduleManifest, source, () => new GraphEngine(graph, trace)) : undefined;
  const opaque = spec => { // study mode: an unfrozen document import with an unknown part list
    let context;
    const build = builtin(`${spec.namespace}::build`, 1, 1, () => {
      if (context) return context;
      const e = new GraphEngine(graph, trace); e.readOnly = true;
      e.record('solid', null, null, { uncertain: true, opaque: true });
      context = e.context; context.moduleBuild = build; return context;
    });
    build.spec = spec; build.opaque = true; trace.inputs.push(`import.opaque:${spec.namespace}`);
    return { build };
  };
  const moduleResolver = spec => {
    const exports = inner?.(spec);
    if (exports) { exports.build.spec = spec; return exports; }
    return study?.opaqueImports ? opaque(spec) : undefined;
  };
  engine.createdByPrefix = !!study?.createdByPrefix;
  const builtins = graphBuiltins(engine, currentStack);
  if (study?.contextInput) {
    const node = graph.add({ name: 'input/context', op: 'input.context', args: '', inputs: [] });
    engine.record('solid', new Id(['input', 'context']), node.name, { uncertain: true, opaque: true });
    trace.inputs.push('input.context');
  }
  const interpreter = new Interpreter(builtins, { maxSteps, moduleResolver, callObserver: observer });
  const definition = () => {
    const result = map({});
    const supplied = study?.defaults ? { ...studyParameters(program, feature).parameters, ...parameters } : parameters;
    for (const [name, expression] of Object.entries(supplied)) result[name] = interpreter.expression(parseExpression(expression));
    return result;
  };
  let status = 'complete', error = null, selected = null;
  try {
    selected = interpreter.run(program, feature, engine.context, new Id([id]), definition);
  } catch (caught) {
    error = { name: caught.name, message: caught.message, line: caught.line ?? null, column: caught.column ?? null, site: caught.site ?? null };
    status = caught instanceof GraphBreak ? 'break' : caught instanceof UnsupportedFeatureError ? 'unsupported' : 'error';
    if (caught instanceof GraphBreak) trace.break = error;
  }
  graph.meta.feature = selected ?? feature ?? null;
  graph.outputs = [...new Set([...engine.records.values()].filter(r => r.kind === 'solid' && r.node).map(r => r.node))];
  return { graph, status, error, trace, steps: interpreter.steps, ms: performance.now() - t0 };
}

// Structured (JSON) copies of sketch data for lowering to a kernel program; the canonical
// text stays the hashed identity. Coordinates in mm as the kernel boundary uses them today.
function structuredPlane(p) {
  try { return { origin: vectorNumbers(p.origin, 1, 3), normal: vectorNumbers(p.normal, 0, 3), x: vectorNumbers(p.x, 0, 3) }; } catch { return null; }
}
function structuredEntity(kind, def) {
  try {
    if (kind === 'skPolyline') return { kind, points: def.points.map(v => vectorNumbers(v, 1, 2)) };
    if (kind === 'skRectangle') return { kind, a: vectorNumbers(def.firstCorner, 1, 2), b: vectorNumbers(def.secondCorner, 1, 2) };
  } catch { /* fall through */ }
  return { kind };
}

// ---------------------------------------------------------------------------------------------
function graphBuiltins(engine, currentStack) {
  const { graph, trace } = engine;
  // Value builtins (math, vectors, planes, units, feature definition) come from wonky's
  // library unchanged; a ModelingContext without kernel never touches Bend for them.
  const library = new ModelingContext(null).builtins();
  const keep = ['vector', 'plane', 'defineFeature', 'isLength', 'normalize', 'norm', 'abs', 'size', 'meter', 'centimeter', 'millimeter', 'inch', 'foot',
    'BoundingType', 'LENGTH_BOUNDS', 'POSITIVE_LENGTH_BOUNDS', 'degree', 'radian', 'PI', 'append', 'regenError', 'unstableIdComponent', 'matrix',
    'transform', 'identityTransform', 'inverse', 'dot', 'cross', 'line', 'color', 'sin', 'cos', 'tan', 'floor', 'ceil', 'round', 'sqrt',
    'EntityType', 'BodyType', 'BooleanOperationType', 'PropertyType'];
  const values = Object.fromEntries(keep.filter(k => k in library).map(k => [k, library[k]]));
  Object.assign(values, extraValueBuiltins());
  values.BodyType = enumSet('BodyType', ['SOLID', 'SHEET', 'WIRE', 'POINT', 'MATE_CONNECTOR', 'COMPOSITE']);
  values.EntityType = enumSet('EntityType', ['BODY', 'FACE', 'EDGE', 'VERTEX']);
  // std query.fs GeometryType, the same members the evaluator declares (src/queries.mjs GEOMETRY_TYPES).
  values.GeometryType = enumSet('GeometryType', GEOMETRY_TYPES);
  values.BoundingType = map({ BLIND: 'BoundingType.BLIND', SYMMETRIC: 'BoundingType.SYMMETRIC', THROUGH_ALL: 'BoundingType.THROUGH_ALL', UP_TO_NEXT: 'BoundingType.UP_TO_NEXT' });
  values.ChamferType = enumSet('ChamferType', ['EQUAL_OFFSETS', 'TWO_OFFSETS', 'OFFSET_ANGLE']);
  values.ToleranceType = enumSet('ToleranceType', ['NONE']);
  values.PropertyType = enumSet('PropertyType', ['NAME', 'APPEARANCE', 'MATERIAL', 'PART_NUMBER', 'DESCRIPTION', 'CUSTOM']);

  const g = (name, min, max, fn) => { const b = builtin(name, min, max, fn); b.traced = true; values[name] = b; };
  const span = loc => engine.span(loc);
  const ctx = (c, loc) => { if (!c?.engine || c.engine.context !== c) fail('Invalid modeling context', loc); return c.engine; };

  // Canonicalize a definition map: query-valued fields become input slots / select nodes.
  const inputsOf = (opName, def, loc, queryFields) => {
    const inputs = [], fieldRows = {};
    const slot = name => { let i = inputs.indexOf(name); if (i < 0) { i = inputs.length; inputs.push(name); } return { graphRef: `$${i}` }; };
    const argMap = {};
    let q = 0;
    const isQuery = v => v?.type === 'Query' || v instanceof TopologyQuery;
    for (const key of Object.keys(def).sort()) {
      let value = def[key];
      if (queryFields.includes(key) && Array.isArray(value) && value.length && value.every(isQuery)) value = new SymQuery('union', { queries: value });
      if (isQuery(value)) {
        const r = resolve(engine, value, loc); fieldRows[key] = r;
        const bodies = r.rows.filter(x => x.node);
        if (r.exact && r.level === 'body' && r.sketchRegion) argMap[key] = { graphRef: `region(${bodies.map(x => slot(x.node).graphRef).join(',')},filterInnerLoops=${value.filterInner === true})` };
        else if (r.exact && r.level === 'body') argMap[key] = bodies.map(x => slot(x.node));
        else {
          const sel = graph.add({ name: graph.freshName(`${opName}.q${q++}`), kind: 'select', op: `select.${r.level === 'entity' ? (r.entity ?? 'entity').toLowerCase() : 'body'}`,
            args: `[${bodies.map((_, i) => `$${i}`).join(',')}]${r.filters.length ? ` where ${r.filters.join(' ')}` : ''}`, inputs: bodies.map(x => x.node), span: span(loc), stack: currentStack() });
          argMap[key] = slot(sel.name);
        }
      } else argMap[key] = value;
    }
    return { args: canon(map(argMap)).slice(1, -1), inputs, fieldRows };
  };
  const addOp = (id, op, args, inputs, loc, extra = {}) => graph.add({ name: graph.freshName(id.toString()), op, args, inputs, span: span(loc), stack: currentStack(), ...extra });
  const bump = (records, node, uncertain) => { for (const r of records) { r.node = node.name; if (uncertain) r.uncertain = true; } };
  const del = records => { for (const r of records) engine.records.delete(r.key); };

  // --- sketches ---------------------------------------------------------------------------------
  g('newSketchOnPlane', 3, 3, ([c, id, def], loc) => {
    const e = ctx(c, loc); if (!(def?.sketchPlane instanceof Plane)) fail('newSketchOnPlane needs a sketchPlane', loc);
    e.claim(c, id, loc); const s = new SymSketch(id, def.sketchPlane); e.sketches.set(id.key(), s); return s;
  });
  const sk = (name, closed) => g(name, 3, 3, ([s, entityId, def], loc) => {
    if (!(s instanceof SymSketch) || s.solved) fail(`${name} expects an unsolved sketch`, loc);
    s.entities.push(`${name}(${JSON.stringify(entityId)},${canon(def)})`); if (closed(def)) s.regions++;
    s.data ??= []; s.data.push(structuredEntity(name, def));
  });
  sk('skRectangle', () => true); sk('skCircle', () => true); sk('skEllipse', () => true); sk('skRegularPolygon', () => true);
  sk('skPolyline', d => Array.isArray(d.points) && d.points.length > 2); sk('skLineSegment', () => false); sk('skArc', () => false);
  sk('skText', () => true); sk('skFitSpline', () => false);
  g('skSolve', 1, 1, ([s], loc) => {
    if (!(s instanceof SymSketch) || s.solved) fail('skSolve expects an unsolved sketch', loc);
    s.solved = true;
    const node = graph.add({ name: graph.freshName(s.id.toString()), op: 'sketch', args: `${canon(s.plane)},[${s.entities.join(',')}]`, inputs: [], span: span(loc), stack: currentStack(),
      data: { plane: structuredPlane(s.plane), entities: s.data ?? [] } });
    engine.record('sketch', s.id, node.name, { regions: Math.max(1, s.regions), uncertainRegions: s.regions !== 1 && s.entities.length > 0 && s.regions > 0 });
  });
  g('qSketchRegion', 1, 2, ([id, filterInner = false]) => new SymQuery('sketchRegion', { id, filterInner }));
  g('evOwnerSketchPlane', 2, 2, ([c, def], loc) => {
    const r = resolve(ctx(c, loc), def.entity, loc);
    const sketch = r.rows[0] && [...ctx(c, loc).sketches.values()].find(s => r.rows[0].createdBy.has(s.id.key()));
    if (!sketch) throw new GraphBreak('evOwnerSketchPlane over non-sketch geometry needs the kernel', loc, 'evOwnerSketchPlane');
    return sketch.plane;
  });

  // --- queries ------------------------------------------------------------------------------------
  g('qCreatedBy', 1, 2, ([id, entityType]) => new SymQuery('created', { id, entityType: entityType ?? new EnumValue('EntityType', 'BODY') }));
  g('qEverything', 0, 1, ([entityType]) => new SymQuery('everything', { entityType: entityType ?? new EnumValue('EntityType', 'BODY') }));
  g('qAllModifiableSolidBodies', 0, 0, () => new SymQuery('allSolid'));
  g('qAllSolidBodies', 0, 0, () => new SymQuery('allSolid'));
  g('qNothing', 0, 0, () => new SymQuery('nothing'));
  g('qUnion', 1, 1, ([queries]) => new SymQuery('union', { queries }));
  g('qSubtraction', 2, 2, ([a, b]) => new SymQuery('subtract', { a, b }));
  g('qIntersection', 1, 1, ([queries]) => new SymQuery('intersection', { queries }));
  g('qBodyType', 2, 2, ([query, bodyType]) => new SymQuery('bodyType', { query, bodyType }));
  g('qOwnedByBody', 1, 2, ([query, entityType]) => new SymQuery('owned', { query, entityType: entityType ?? new EnumValue('EntityType', 'FACE') }));
  g('qOwnerBody', 1, 1, ([query]) => new SymQuery('ownerBody', { query }));
  for (const [name, arity] of [['qGeometry', 2], ['qContainsPoint', 2], ['qLargest', 1], ['qSmallest', 1], ['qClosestTo', 2], ['qFarthestAlong', 2],
    ['qNthElement', 2], ['qAdjacent', 3], ['qCoincidesWithPlane', 2], ['qParallelEdges', 2], ['qParallelPlanes', 2], ['qEntityFilter', 2], ['qEdgeTopologyFilter', 2],
    ['qConvexConnectedFaces', 1], ['qCapEntity', 2], ['qNonCapEntity', 2], ['qSplitBy', 3], ['qLoopEdges', 1], ['qEdgeAdjacent', 2], ['qFaceAdjacent', 2],
    ['qSketchFilter', 2], ['qCompressed', 1], ['qEdgeConvexityTypeFilter', 2], ['qWithinRadius', 3], ['qInFrontOfPlane', 2], ['qMateConnectorsOfParts', 1]])
    g(name, 1, arity, ([query, ...args]) => new SymQuery('geometric', { query: query instanceof SymQuery || query instanceof TopologyQuery ? query : new SymQuery('union', { queries: [] }), filter: name, args }));
  g('makeRobustQuery', 2, 2, ([, q]) => q);
  g('isQueryEmpty', 2, 2, ([c, q], loc) => evaluate(c, q, loc, 'isQueryEmpty').length === 0);
  const evaluate = (c, q, loc, site) => {
    const e = ctx(c, loc), r = resolve(e, q, loc);
    if (r.level !== 'body' || !r.exact) throw new GraphBreak(`evaluateQuery over ${r.level === 'body' ? 'a geometric body selection' : `${(r.entity ?? 'entities').toLowerCase()}s`} needs the kernel (${r.filters.join(' ') || r.level})`, loc, site);
    const uncertain = r.rows.filter(x => x.uncertain || x.uncertainRegions);
    if (uncertain.length && e === engine) { // speculate on the lineage count, verify in the kernel
      trace.speculations.push({ line: loc?.line ?? null, count: r.rows.length });
      graph.add({ name: graph.freshName(`expect@${loc?.line ?? 0}:${loc?.column ?? 0}`), kind: 'check', op: 'expect.count',
        args: `[${r.rows.filter(x => x.node).map((_, i) => `$${i}`).join(',')}] == ${r.rows.length}`, inputs: r.rows.filter(x => x.node).map(x => x.node), span: span(loc), stack: currentStack() });
      trace.checks++;
    }
    return r.rows.map(row => new SymQuery('reference', { records: [row], level: 'body' }));
  };
  g('evaluateQuery', 2, 2, ([c, q], loc) => evaluate(c, q, loc, 'evaluateQuery'));
  for (const name of ['evBox3d', 'evVolume', 'evArea', 'evLength', 'evLine', 'evPlane', 'evDistance', 'evSurfaceDefinition', 'evCurveDefinition',
    'evApproximateCentroid', 'evEdgeTangentLine', 'evFaceTangentPlane', 'evVertexPoint', 'evFaceNormalAtEdge', 'evMateConnector', 'evAxis', 'evEdgeConvexity', 'evFaceTangentPlanes', 'evEdgeTangentLines'])
    g(name, 1, 3, (args, loc) => { throw new GraphBreak(`${name} returns a measured value to the host`, loc, name); });

  // --- study-mode inputs and std predicates ------------------------------------------------------
  g('__studyPick', 1, 1, ([key]) => {
    const pid = new Id(['input', 'pick', String(key)]);
    const node = graph.add({ name: graph.freshName(pid.toString()), op: 'input.pick', args: JSON.stringify(key), inputs: [] });
    engine.record('solid', pid, node.name, { uncertain: true, opaque: true }); trace.inputs.push(`input.pick:${key}`);
    return new SymQuery('created', { id: pid, entityType: new EnumValue('EntityType', 'BODY') });
  });
  for (const [name, dim, angle] of [['isAngle', 0, 1], ['isInteger', null, null], ['isReal', null, null]])
    g(name, 2, 2, ([value]) => dim === null ? typeof value === 'number' && (name !== 'isInteger' || Number.isInteger(value)) : value instanceof Quantity && value.dimension === dim && value.angle === angle);

  // --- properties and variables (host-side metadata) --------------------------------------------
  g('setProperty', 2, 2, ([c, def], loc) => {
    const e = ctx(c, loc); if (e.readOnly) fail('Cannot change properties in an imported source context', loc);
    const r = resolve(e, def.entities, loc);
    if (!r.exact) throw new GraphBreak('setProperty on a geometric selection needs the kernel', loc, 'setProperty');
    const key = enumIs(def.propertyType, 'PropertyType', 'NAME') ? 'name' : enumIs(def.propertyType, 'PropertyType', 'APPEARANCE') ? 'appearance' : null;
    if (!key) unsupported('Property type is not traced', loc);
    for (const row of r.rows) {
      row[key] = def.value; trace.properties++;
      if (!row.node) continue;
      const node = graph.add({ name: graph.freshName(`${row.node}/${key}`), kind: 'meta', op: `property.${key}`, args: `$0,${canon(def.value)}`, inputs: [row.node], span: span(loc), stack: currentStack() });
      row.node = node.name;
    }
  });
  g('getProperty', 2, 2, ([c, def], loc) => {
    const r = resolve(ctx(c, loc), def.entity, loc);
    if (!r.exact || r.rows.length !== 1) throw new GraphBreak('getProperty needs one known body', loc, 'getProperty');
    if (enumIs(def.propertyType, 'PropertyType', 'NAME')) {
      if (r.rows[0].name === undefined) unsupported(r.rows[0].opaque ? 'Part names of an unfrozen import or input are unknown without its snapshot' : 'Onshape automatic part names are not modeled', loc);
      return r.rows[0].name;
    }
    if (enumIs(def.propertyType, 'PropertyType', 'APPEARANCE')) return r.rows[0].appearance;
    unsupported('Property type is not traced', loc);
  });
  g('setVariable', 3, 3, ([c, name, value], loc) => { ctx(c, loc).variables.set(name, value); });
  g('getVariable', 2, 3, ([c, name, fallback], loc) => { const v = ctx(c, loc).variables; if (v.has(name)) return v.get(name); if (fallback !== undefined) return fallback; fail(`Variable '${name}' is not defined`, loc); });

  // --- operations ---------------------------------------------------------------------------------
  const create = (opName, fields) => (args, loc) => {
    const [c, id, def] = args; const e = ctx(c, loc);
    if (!isMap(def)) fail(`${opName} expects a definition map`, loc);
    const { args: text, inputs, fieldRows } = inputsOf(id.toString(), def, loc, fields);
    e.claim(c, id, loc);
    const node = addOp(id, opName, text, inputs, loc);
    const sources = Object.values(fieldRows).flatMap(r => r.rows);
    e.record('solid', id, node.name, { uncertain: sources.some(s => s.uncertainRegions) });
  };
  g('opExtrude', 3, 3, (args, loc) => { create('extrude', ['entities'])(args, loc); const [, , def] = args; const n = graph.nodes.at(-1);
    try { n.data = { direction: vectorNumbers(def.direction, 0, 3, loc), depthMm: def.endDepth.value * 1000, bound: String(def.endBound), start: def.startDepth ? def.startDepth.value * 1000 : 0 }; } catch { n.data = null; } });
  g('opRevolve', 3, 3, create('revolve', ['entities', 'axis']));
  g('opSweep', 3, 3, create('sweep', ['profiles', 'path']));
  g('opThicken', 3, 3, create('thicken', ['entities']));
  g('opLoft', 3, 3, (args, loc) => {
    const [c, id, def] = args; const e = ctx(c, loc);
    const flat = map({ ...def, profileSubqueries: new SymQuery('union', { queries: def.profileSubqueries ?? [] }) });
    const { args: text, inputs } = inputsOf(id.toString(), flat, loc, ['profileSubqueries', 'guideSubqueries']);
    e.claim(c, id, loc); e.record('solid', id, addOp(id, 'loft', text, inputs, loc).name);
  });
  for (const [name, op] of [['fCuboid', 'cuboid'], ['fCylinder', 'cylinder'], ['fCone', 'cone'], ['fSphere', 'sphere']])
    g(name, 3, 3, create(op, []));
  g('opBoolean', 3, 3, ([c, id, def], loc) => {
    const e = ctx(c, loc);
    if (!(def.operationType instanceof EnumValue)) fail('opBoolean requires a BooleanOperationType', loc);
    const kind = { UNION: 'union', SUBTRACTION: 'subtract', INTERSECTION: 'intersect' }[def.operationType.name];
    if (!kind) unsupported(`Boolean operation '${def.operationType.name}' is not traced`, loc);
    const { args: text, inputs, fieldRows } = inputsOf(id.toString(), def, loc, ['tools', 'targets']);
    e.claim(c, id, loc);
    const node = addOp(id, `boolean.${kind}`, text, inputs, loc);
    const tools = fieldRows.tools?.rows ?? [], targets = fieldRows.targets?.rows ?? [];
    const exact = (fieldRows.tools?.exact ?? true) && (fieldRows.targets?.exact ?? true);
    if (!exact) { bump([...targets, ...tools], node, true); return; } // conservative: every candidate may change
    const lineage = id.key();
    if (targets.length) {
      bump(targets, node, true); for (const t of targets) t.createdBy.add(lineage);
      if (!def.keepTools) del(tools.filter(t => !targets.includes(t)));
    } else if (tools.length) {
      const [first, ...rest] = tools; bump([first], node, true);
      for (const t of rest) for (const k of t.createdBy) first.createdBy.add(k);
      first.createdBy.add(lineage); del(rest);
    }
  });
  g('opPattern', 3, 3, ([c, id, def], loc) => {
    const e = ctx(c, loc);
    const { args: text, inputs, fieldRows } = inputsOf(id.toString(), def, loc, ['entities']);
    e.claim(c, id, loc);
    const node = addOp(id, 'pattern', text, inputs, loc);
    const n = Array.isArray(def.transforms) ? def.transforms.length : 1;
    for (const src of fieldRows.entities.rows.filter(r => r.kind === 'solid')) for (let i = 0; i < n; i++)
      e.record('solid', id, node.name, { uncertain: src.uncertain || !fieldRows.entities.exact, name: src.name, appearance: src.appearance, instance: i });
  });
  const modify = (opName, fields, uncertain = false) => (args, loc) => {
    const [c, id, def] = args; const e = ctx(c, loc);
    const { args: text, inputs, fieldRows } = inputsOf(id.toString(), def, loc, fields);
    e.claim(c, id, loc);
    const node = addOp(id, opName, text, inputs, loc);
    const owners = [...new Set(fields.flatMap(f => fieldRows[f]?.rows ?? []))].filter(r => r.kind === 'solid');
    bump(owners, node, uncertain || fields.some(f => fieldRows[f] && !fieldRows[f].exact && fieldRows[f].level === 'body'));
  };
  g('opTransform', 3, 3, modify('transform', ['bodies']));
  g('opFillet', 3, 3, modify('fillet', ['entities']));
  g('opChamfer', 3, 3, modify('chamfer', ['entities']));
  g('opOffsetFace', 3, 3, modify('offsetFace', ['moveFaces']));
  g('opDeleteFace', 3, 3, modify('deleteFace', ['deleteFaces'], true));
  g('opMoveFace', 3, 3, modify('moveFace', ['moveFaces']));
  g('opShell', 3, 3, modify('shell', ['entities']));
  g('opDraft', 3, 3, modify('draft', ['draftFaces', 'neutralPlane']));
  g('opSplitPart', 3, 3, modify('splitPart', ['targets', 'tool'], true));
  g('opDeleteBodies', 3, 3, ([c, id, def], loc) => {
    const e = ctx(c, loc);
    const r = resolve(e, def.entities, loc);
    e.claim(c, id, loc); trace.deletes++;
    if (r.exact) { del(r.rows); return; }
    // Deleting a geometric selection: every candidate may be gone afterwards.
    const { args: text, inputs } = inputsOf(id.toString(), def, loc, ['entities']);
    bump(r.rows, addOp(id, 'delete', text, inputs, loc), true);
  });

  // --- imports (frozen Part Studio snapshots) --------------------------------------------------------
  g('newInstantiator', 1, 2, ([id], loc) => { if (!(id instanceof Id)) fail('newInstantiator expects an Id', loc); return { type: 'Instantiator', id, instances: [], done: false }; });
  g('addInstance', 3, 3, ([inst, build, def], loc) => {
    if (inst?.type !== 'Instantiator' || inst.done || !isMap(def)) fail('Invalid instantiator', loc);
    const loaded = def.loadedContext ?? build.call([map({})], loc);
    if (!loaded?.engine || loaded.moduleBuild !== build) fail('loadedContext must belong to the specified frozen module build', loc);
    const r = resolve(loaded.engine, def.partQuery, loc);
    // Using a composite part of an imported module is not implemented (decision 11), also when selected by lineage.
    const composite = r.rows.find(isCompositeRecord);
    if (composite) refuseComposite(composite, loc);
    // A geometric part query (qContainsPoint, qNthElement, ...) is a selection inside the
    // import node, evaluated by the kernel; the instance count is then unknown.
    const iid = new Id([...inst.id.parts, def.name]);
    inst.instances.push({ id: iid, rows: r.exact ? r.rows : [{ opaque: true, uncertain: true, key: 'select' }], spec: build.spec, name: def.name, select: r.exact ? null : r.filters.join(' ') });
    return new SymQuery('created', { id: iid, entityType: new EnumValue('EntityType', 'BODY') });
  });
  g('instantiate', 2, 2, ([c, inst], loc) => {
    const e = ctx(c, loc); if (inst?.type !== 'Instantiator' || inst.done) fail('Invalid or already evaluated instantiator', loc);
    e.claim(c, inst.id, loc);
    for (const { id, rows, spec, select } of inst.instances) for (const row of rows) {
      if (isCompositeRecord(row)) refuseComposite(row, loc);
      const part = select ? `where ${select}` : row.opaque ? 'all' : JSON.stringify(row.name ?? row.key);
      const node = graph.add({ name: graph.freshName(id.toString()), op: select ? 'import.select' : row.opaque ? 'import.opaque' : 'import', args: `${JSON.stringify(spec?.namespace ?? '?')},${JSON.stringify(spec?.path ?? '?')},${JSON.stringify(spec?.version ?? '?')},${part}`, inputs: [], span: span(loc), stack: currentStack() });
      e.record('solid', id, node.name, { name: row.name, appearance: row.appearance, uncertain: !!(row.opaque || row.uncertain), opaque: !!row.opaque });
    }
    inst.done = true;
  });
  // Frozen-module build() returns a context whose records carry names; evaluateQuery over it is lineage.
  return values;
}

export function traceFile(path, options = {}) {
  return traceFeatureScript(readFileSync(path, 'utf8'), { sourcePath: path, ...options });
}
// Re-export for tests.
export { SymQuery, resolve as resolveSymbolic, Matrix, Transform, Quantity, Vector, KeyedMap, binary, vectorNumbers };
