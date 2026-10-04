// FeatureScript -> WK/0 staging frontend (prototype, docs/language/proposal-core-ir.md §5).
//
// Pipeline: src/parser.mjs -> idiom rewrite (./idioms-fs.mjs) -> WCore/0
// desugaring (../semcore/desugar-fs.mjs) -> this staging evaluator.
//
// The staging evaluator is the semantic-core reference evaluator with a
// different effect handler: all value-level FeatureScript runs here, in IEEE
// binary64 with FS units, exactly as in the interpreter; kernel operations,
// queries and measurements do not execute but append WK nodes and return
// symbolic values (Sym). The FS modeling store (records with lineage, sketches,
// properties) is tracked symbolically: lineage is static (it depends on ids,
// not on geometry), so qCreatedBy/qEverything resolve at staging time to the
// nodes that produce those bodies.
//
// A program may force a symbolic value. Covered cases become structured nodes:
//   if (cond) throw ...                 -> expect(cond)               (check)
//   a && b, a ? b : c on measured data  -> and/or/choose nodes         (pure)
//   loops of ./idioms-fs.mjs            -> select / map / fold regions
//   size(evaluateQuery(q)) of bodies    -> concrete when the cardinality is
//                                          statically known (extrude = 1 body)
// Anything else is a GRAPH BREAK: the graph so far must execute before the
// host can continue. The prototype stops there and reports kind and span; a
// production frontend would submit the segment through the native binding,
// read the value back and continue (in-process cost ~0.5 us per call,
// docs/native-bridge/binding.md).
import { parse } from '../../parser.mjs';
import { fail, unsupported, FeatureScriptError, UnsupportedFeatureError } from '../../errors.mjs';
import { ModelingContext } from '../../library.mjs';
import { binary, EnumValue, Id, isMap, KeyedMap, map, Matrix, Plane, Quantity, Transform, Vector, vectorNumbers, length, truth, matchesType } from '../../values.mjs';
import { normalized, scale, signedArea, tolerance, validatePolygon, dot } from '../../brep.mjs';
import { enumSet } from '../../queries.mjs';
import { desugarProgram } from '../semcore/desugar-fs.mjs';
import { CoreEvaluator } from '../semcore/eval.mjs';
import { rewriteIdioms } from './idioms-fs.mjs';
import { Graph, Ref, Param } from './ir.mjs';

export class GraphBreak extends Error {
  constructor(kind, message, loc) { super(message); this.name = 'GraphBreak'; this.kind = kind; this.loc = loc ?? null; }
}

// --- symbolic values ------------------------------------------------------------

// A value that only the kernel can produce: a reference to a WK node (or a
// region parameter) plus its static type:
//   {t:'bodies'} {t:'entities'} {t:'entity'} {t:'list', of} {t:'num', dim, angle}
//   {t:'bool'} {t:'str'} {t:'vec', dim} {t:'rec', fields} {t:'any'}
export class Sym {
  constructor(ref, type, owners = null) { this.ref = ref; this.type = type; this.owners = owners; }
  toString() { return `⟨${this.ref}⟩`; }
}
const isSym = v => v instanceof Sym;
const containsSym = v => isSym(v) || (Array.isArray(v) && v.some(containsSym)) || (v instanceof Vector && v.items.some(containsSym))
  || (isMap(v) && Object.values(v).some(containsSym));
const NUM = (dim = 0, angle = 0) => ({ t: 'num', dim, angle });
const LEN = NUM(1), VEC_LEN = { t: 'vec', dim: 1 }, VEC_1 = { t: 'vec', dim: 0 };
const MEASURES = {
  evBox3d: { t: 'rec', fields: { minCorner: VEC_LEN, maxCorner: VEC_LEN } },
  evVolume: NUM(3), evArea: NUM(2), evLength: LEN,
  evPlane: { t: 'rec', fields: { origin: VEC_LEN, normal: VEC_1, x: VEC_1 } },
  evLine: { t: 'rec', fields: { origin: VEC_LEN, direction: VEC_1 } },
  evApproximateCentroid: VEC_LEN, evCentroid: VEC_LEN, evVertexPoint: VEC_LEN,
  evDistance: { t: 'rec', fields: { distance: LEN } },
  evOwnerSketchPlane: { t: 'rec', fields: { origin: VEC_LEN, normal: VEC_1, x: VEC_1 } },
};
const fieldType = (type, key) => type.t === 'rec' ? type.fields?.[key] ?? { t: 'any' } : type.t === 'table' ? type.of ?? { t: 'any' }
  : type.t === 'vec' ? NUM(type.dim) : type.t === 'list' ? type.of ?? { t: 'any' } : { t: 'any' };

// Queries are data, as in FeatureScript (and src/queries.mjs).
class SQuery { constructor(kind, data = {}) { this.type = 'Query'; this.kind = kind; Object.assign(this, data); } }

const EFFECTFUL = /^(op[A-Z]|sk[A-Z]|f[A-Z]|newSketchOnPlane$|newInstantiator$|addInstance$|instantiate$|setProperty$|setAttribute$|setVariable$|opDeleteBodies$)/;
const KERNELISH = /^(op|sk|ev|q|f)[A-Z]/;
const CREATES_ONE = new Set(['extrude_polygon', 'frustum', 'extrude_profile', 'loft']);

export class StagingEvaluator extends CoreEvaluator {
  constructor({ graph, file, context = 'empty' } = {}) {
    super({}, { transactions: false });
    this.graph = graph ?? new Graph({ frontend: 'featurescript', file });
    this.records = new Map(); this.nextRecord = 0; this.sketches = new Map(); this.ids = new Set();
    this.context = { type: 'Context', staging: true };
    this.effectDepth = 0; this.pure = 0; this.frames = []; this.arms = [];
    this.stats = { ...this.stats, breaks: 0, checks: 0, choices: 0, regions: 0, imports: 0, genericOps: 0, genericQueries: 0 };
    this.installBuiltins();
    // Optional symbolic initial Part Studio: for features that operate on
    // bodies an earlier Onshape feature created (checks such as "Derive
    // exactly one ... into a NEW Part Studio first").
    if (context === 'symbolic') this.addRecord(new Id(['partStudio']), this.node('input', { name: 'partStudio' }, { t: 'bodies' }, null), null);
  }

  // ---- WK plumbing -------------------------------------------------------------
  where(loc, id = null) { return { span: this.graph.span(loc), id: id === null ? null : String(id), stack: this.callStack.map(f => this.graph.span(f.loc)).filter(s => s >= 0) }; }
  node(op, args, type, loc, id = null, attrs = null) { return new Sym(this.graph.add(op, args, { type: type.t, ...this.where(loc, id), attrs }), type); }
  brk(kind, message, loc) { this.stats.breaks++; throw new GraphBreak(kind, message, loc); }

  // FS value -> WK value. Lengths become mm (the same `length()` conversion the
  // library uses at the kernel boundary), other dimensioned quantities keep SI
  // units with an explicit unit tag; queries resolve against the symbolic store.
  wk(value, loc) {
    if (isSym(value)) return value.ref;
    if (value instanceof Ref || value instanceof Param) return value;
    if (value === undefined || value === null) return null;
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') return value;
    if (value instanceof Quantity) {
      if (value.dimension === 1 && value.angle === 0) return length(value, loc);
      if (value.dimension === 0 && value.angle === 1) return value.value;
      return { si: value.value, dim: value.dimension, angle: value.angle };
    }
    if (value instanceof Vector) return value.items.map(v => this.wk(v, loc));
    if (value instanceof Plane) return { origin: this.wk(value.origin, loc), normal: this.wk(value.normal, loc), x: this.wk(value.x, loc) };
    if (value instanceof Matrix) return value.rows.map(r => [...r]);
    if (value instanceof Transform) return { linear: value.linear.rows.map(r => [...r]), translation: this.wk(value.translation, loc) };
    if (value instanceof EnumValue) return `${value.enumType}.${value.name}`;
    if (value instanceof Id) return value.toString();
    if (value instanceof SQuery) return this.resolve(value, loc).value;
    if (value instanceof KeyedMap) return value.entries.map(([k, v]) => [this.wk(k, loc), this.wk(v, loc)]);
    if (Array.isArray(value)) return value.map(v => this.wk(v, loc));
    if (isMap(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.wk(v, loc)]));
    if (value?.type === 'Sketch') return `sketch:${value.id}`;
    if (value?.type === 'builtin' || value?.type === 'function' || value?.type === 'feature') return `fn:${value.name ?? '?'}`;
    unsupported(`Staging cannot represent this value in WK (${value?.constructor?.name ?? typeof value})`, loc);
  }

  // ---- symbolic store -----------------------------------------------------------
  addRecord(id, sym, card = null, kind = 'solid') {
    const key = String(this.nextRecord++);
    const record = { key, kind, value: sym, card, createdBy: new Set([id instanceof Id ? id.key() : String(id)]), name: null, appearance: null };
    this.records.set(key, record);
    return record;
  }
  claim(context, id, loc) {
    if (context !== this.context) fail('Invalid modeling context', loc);
    if (!(id instanceof Id)) fail('Expected Id', loc);
    if (id.parts.some(p => p.includes('⟨'))) return; // templated id inside a region: unique per iteration by construction
    if (this.ids.has(id.key())) fail(`Duplicate operation ID '${id}'`, loc);
    this.ids.add(id.key());
  }
  // Resolve a query to {records (static owners or null), value (WK value), type, card}.
  resolve(q, loc) {
    if (isSym(q)) return { records: null, value: q.ref, type: q.type, card: null, sym: q, owners: q.owners ?? [] };
    if (Array.isArray(q)) {
      const parts = q.map(x => this.resolve(x, loc));
      return { records: parts.every(p => p.records) ? parts.flatMap(p => p.records) : null, value: parts.map(p => p.value), type: parts[0]?.type ?? { t: 'bodies' }, card: parts.every(p => p.card !== null) ? parts.reduce((s, p) => s + p.card, 0) : null, owners: parts.flatMap(p => p.records ?? p.owners ?? []) };
    }
    if (!(q instanceof SQuery)) fail('Expected a Query', loc);
    const live = kind => [...this.records.values()].filter(r => r.kind === kind);
    const fromRecords = (rs, entity = 'BODY') => {
      if (entity !== 'BODY') {
        const owners = this.resolve(rs.map(r => r.value), loc);
        const s = this.node('entities', { of: owners.value, kind: entity }, { t: 'entities', kind: entity }, loc);
        return { records: null, value: s.ref, type: s.type, card: null, owners: rs };
      }
      const value = rs.length === 1 ? this.wk(rs[0].value, loc) : rs.map(r => this.wk(r.value, loc));
      return { records: rs, value, type: { t: 'bodies' }, card: rs.every(r => r.card !== null) ? rs.reduce((s, r) => s + r.card, 0) : null };
    };
    const entityOf = e => e instanceof EnumValue ? e.name : 'BODY';
    switch (q.kind) {
      case 'created': return fromRecords([...this.records.values()].filter(r => r.kind === 'solid' && [...r.createdBy].some(k => k === q.id.key() || k.startsWith(q.id.key().slice(0, -1) + ','))), entityOf(q.entityType));
      case 'allSolid': return fromRecords(live('solid'));
      case 'everything': return fromRecords(live('solid'), entityOf(q.entityType));
      case 'nothing': return { records: [], value: [], type: { t: 'bodies' }, card: 0 };
      case 'frozen': return fromRecords(q.records.filter(r => this.records.get(r.key) === r));
      case 'sketchRegion': return { records: null, value: `region:${q.id}`, type: { t: 'region' }, card: null, sketch: q.id };
      case 'union': {
        const parts = q.queries.map(x => this.resolve(x, loc));
        // A record reached by several subqueries counts once (query union is a set union).
        if (parts.every(p => p.records)) return fromRecords([...new Set(parts.flatMap(p => p.records))]);
        const flat = parts.flatMap(p => Array.isArray(p.value) && p.records ? p.value : [p.value]);
        return { records: parts.every(p => p.records) ? parts.flatMap(p => p.records) : null, value: flat.length === 1 ? flat[0] : flat, type: parts[0]?.type ?? { t: 'bodies' },
          card: parts.every(p => p.card !== null) ? parts.reduce((s, p) => s + p.card, 0) : null, parts, owners: [...new Set(parts.flatMap(p => p.records ?? p.owners ?? []))] };
      }
      case 'subtract': {
        const a = this.resolve(q.a, loc), b = this.resolve(q.b, loc);
        if (a.records && b.records) return fromRecords(a.records.filter(r => !b.records.includes(r)));
        const s = this.node('difference', { a: a.value, b: b.value }, a.type, loc);
        return { records: null, value: s.ref, type: a.type, card: null, owners: a.records ?? a.owners };
      }
      case 'bodyType': {
        const inner = this.resolve(q.query, loc);
        if (inner.records) return fromRecords(inner.records.filter(r => r.kind === 'solid'));
        return inner;
      }
      case 'owned': {
        const inner = this.resolve(q.query, loc);
        const s = this.node('entities', { of: inner.value, kind: entityOf(q.entityType) }, { t: 'entities', kind: entityOf(q.entityType) }, loc);
        return { records: null, value: s.ref, type: s.type, card: null, owners: inner.records ?? inner.owners };
      }
      case 'generic': {
        this.stats.genericQueries++;
        const resolved = q.args.map(a => a instanceof SQuery || isSym(a) ? this.resolve(a, loc) : null);
        const args = q.args.map((a, i) => resolved[i] ? resolved[i].value : this.wk(a, loc));
        const owners = resolved.filter(Boolean).flatMap(r => this.ownersOf(r));
        const entity = q.args.find(a => a instanceof EnumValue && a.enumType === 'EntityType')?.name;
        const type = entity && entity !== 'BODY' ? { t: 'entities', kind: entity } : { t: 'bodies' };
        const s = this.node('query', { name: q.name, args }, type, loc);
        return { records: null, value: s.ref, type, card: null, owners };
      }
      default: fail(`Unknown staged query ${q.kind}`, loc);
    }
  }
  // Records a resolved target set belongs to, for store updates.
  ownersOf(res) { return [...new Set(res.records ?? res.owners ?? [])]; }
  rebind(res, result, loc) {
    if (res.records) return;
    for (const r of this.ownersOf(res)) r.value = this.node('replace', { set: this.wk(r.value, loc), by: result.ref }, { t: 'bodies' }, loc);
  }

  // ---- builtins -----------------------------------------------------------------
  installBuiltins() {
    const base = new ModelingContext(null).builtins();
    const b = (name, min, max, call) => ({ type: 'builtin', name, min, max, call });
    const values = {};
    // Value-level builtins of the interpreter (binary64, units) are reused.
    for (const [k, v] of Object.entries(base)) {
      if (v?.type === 'builtin' && (KERNELISH.test(k) || EFFECTFUL.test(k) || ['evaluateQuery', 'getProperty', 'size', 'abs', 'norm', 'normalize'].includes(k))) continue;
      values[k] = v;
    }
    // Missing value builtins the prototype needs for real corpus files. Pure
    // binary64 functions; they belong into src/scalars.mjs regardless of WK.
    values.atan2 = b('atan2', 2, 2, ([y, x], loc) => this.pureCall('atan2', [y, x], loc, () => new Quantity(Math.atan2(num(y), num(x)), 0, 1)));
    values.mirrorAcross = b('mirrorAcross', 1, 1, ([plane], loc) => {
      const n = normalized(vectorNumbers(plane.normal, 0, 3, loc), loc), o = plane.origin.items.map(q => q.value);
      const linear = [0, 1, 2].map(i => [0, 1, 2].map(j => (i === j ? 1 : 0) - 2 * n[i] * n[j]));
      const d = dot(n, o);
      return new Transform(new Matrix(linear), new Vector(n.map(v => new Quantity(2 * d * v))));
    });
    // More pure std value functions (binary64, as in std): coordinate systems,
    // rotations, ids, min/max. They belong into src/scalars.mjs regardless.
    const vec3 = (v, loc) => vectorNumbers(v, v.items[0] instanceof Quantity ? 1 : 0, 3, loc);
    values.coordSystem = b('coordSystem', 3, 3, ([origin, x, z], loc) => {
      if ([origin, x, z].some(containsSym)) this.brk('value-use', 'coordSystem from a kernel result', loc);
      return map({ origin, xAxis: new Vector(normalized(vec3(x, loc), loc)), zAxis: new Vector(normalized(vec3(z, loc), loc)) });
    });
    values.toWorld = b('toWorld', 1, 2, ([cs, point], loc) => {
      if (containsSym(cs) || containsSym(point)) this.brk('value-use', 'toWorld with a kernel result', loc);
      const xs = cs.xAxis.items, zs = cs.zAxis.items, ys = [zs[1] * xs[2] - zs[2] * xs[1], zs[2] * xs[0] - zs[0] * xs[2], zs[0] * xs[1] - zs[1] * xs[0]];
      const t = new Transform(new Matrix([0, 1, 2].map(i => [xs[i], ys[i], zs[i]])), cs.origin);
      return point === undefined ? t : binary('*', t, point, loc);
    });
    values.rotationAround = b('rotationAround', 2, 2, ([line, angle], loc) => {
      if (containsSym(line) || containsSym(angle)) this.brk('value-use', 'rotationAround with a kernel result', loc);
      const [x, y, z] = normalized(vectorNumbers(line.direction, 0, 3, loc), loc), a = angle.value, c = Math.cos(a), s = Math.sin(a), k = 1 - c;
      const r = [[c + x * x * k, x * y * k - z * s, x * z * k + y * s], [y * x * k + z * s, c + y * y * k, y * z * k - x * s], [z * x * k - y * s, z * y * k + x * s, c + z * z * k]];
      const o = line.origin.items.map(q => q.value), ro = r.map(row => row[0] * o[0] + row[1] * o[1] + row[2] * o[2]);
      return new Transform(new Matrix(r), new Vector(o.map((v, i) => new Quantity(v - ro[i]))));
    });
    values.makeId = b('makeId', 1, 1, ([s]) => new Id([String(s)]));
    for (const [fn, pick] of [['min', Math.min], ['max', Math.max]]) values[fn] = b(fn, 1, 2, (args, loc) => {
      const xs = args.length === 1 ? args[0] : args;
      if (xs.some(isSym)) return this.node('math', { fn, args: xs.map(v => this.wk(v, loc)) }, isSym(xs[0]) ? xs[0].type : typeOf(xs[0]), loc);
      return xs.reduce((m, v) => (binary(fn === 'min' ? '<' : '>', v, m, loc) ? v : m));
    });
    values.isInteger = b('isInteger', 1, 2, ([v]) => isSym(v) || Number.isInteger(v));
    values.isLength = b('isLength', 2, 2, ([v, bounds], loc) => isSym(v) || (bounds instanceof KeyedMap ? base.isLength.call([v, bounds], loc)
      : v instanceof Quantity && v.dimension === 1 && v.angle === 0));
    values.isAngle = b('isAngle', 2, 2, ([v]) => isSym(v) || (v instanceof Quantity && v.dimension === 0 && v.angle === 1));
    values.isReal = b('isReal', 2, 2, ([v]) => isSym(v) || typeof v === 'number');
    values.unitless = 1;
    for (const k of ['ANGLE_360_BOUNDS', 'ANGLE_180_MINUS_180_BOUNDS', 'ANGLE_STRICT_90_BOUNDS', 'POSITIVE_COUNT_BOUNDS', 'POSITIVE_REAL_BOUNDS', 'NONNEGATIVE_LENGTH_BOUNDS',
      'NONNEGATIVE_ZERO_INCLUSIVE_LENGTH_BOUNDS', 'ZERO_DEFAULT_LENGTH_BOUNDS', 'NONNEGATIVE_ZERO_DEFAULT_LENGTH_BOUNDS', 'BLEND_BOUNDS']) values[k] = k;
    values.AdjacencyType = enumSet('AdjacencyType', ['EDGE', 'VERTEX']);
    values.GeometryType = enumSet('GeometryType', ['PLANE', 'CYLINDER', 'CONE', 'SPHERE', 'TORUS', 'LINE', 'CIRCLE', 'ARC', 'OTHER']);
    values.EntityType = enumSet('EntityType', ['BODY', 'FACE', 'EDGE', 'VERTEX']);
    values.BodyType = enumSet('BodyType', ['SOLID', 'SHEET', 'WIRE', 'POINT', 'MATE_CONNECTOR', 'COMPOSITE']);
    values.BooleanOperationType = enumSet('BooleanOperationType', ['UNION', 'SUBTRACTION', 'INTERSECTION', 'SUBTRACT_COMPLEMENT']);
    values.PropertyType = enumSet('PropertyType', ['NAME', 'APPEARANCE', 'MATERIAL', 'DESCRIPTION', 'PART_NUMBER', 'EXCLUDE_FROM_BOM']);
    values.ChamferType = enumSet('ChamferType', ['EQUAL_OFFSETS', 'TWO_OFFSETS', 'OFFSET_ANGLE']);
    values.ToleranceType = enumSet('ToleranceType', ['DEFAULT']);
    values.size = b('size', 1, 1, ([v], loc) => {
      if (isSym(v)) {
        if (v.type.t !== 'list') this.brk('value-use', 'size() of a symbolic non-list value', loc);
        return this.node('count', { of: v.ref }, NUM(), loc);
      }
      return base.size.call([v], loc);
    });
    values.abs = b('abs', 1, 1, ([v], loc) => isSym(v) ? this.node('math', { fn: 'abs', x: v.ref }, v.type, loc) : base.abs.call([v], loc));
    values.sqrt = b('sqrt', 1, 1, ([v], loc) => isSym(v) ? this.node('math', { fn: 'sqrt', x: v.ref }, NUM(v.type.dim / 2), loc) : base.sqrt.call([v], loc));
    values.norm = b('norm', 1, 1, ([v], loc) => containsSym(v) ? this.node('math', { fn: 'norm', x: this.wk(v, loc) }, NUM(1), loc) : base.norm.call([v], loc));
    values.normalize = b('normalize', 1, 1, ([v], loc) => containsSym(v) ? this.node('math', { fn: 'normalize', x: this.wk(v, loc) }, VEC_1, loc) : base.normalize.call([v], loc));
    values.dot = b('dot', 2, 2, (args, loc) => containsSym(args) ? this.node('math', { fn: 'dot', a: this.wk(args[0], loc), b: this.wk(args[1], loc) }, NUM(0), loc) : base.dot.call(args, loc));
    values.append = b('append', 2, 2, ([a, v], loc) => {
      if (isSym(a)) this.brk('value-use', 'append() to a symbolic list', loc);
      return base.append.call([a, v], loc);
    });
    values.regenError = b('regenError', 1, 2, ([m], loc) => new FeatureScriptError(isSym(m) ? `⟨${m.ref}⟩` : typeof m === 'string' ? m : String(m?.message ?? m), loc));
    // FsDoc: a robust query resolves to the entities the input query resolves
    // to AT THE TIME OF THE CALL. Staging freezes the record set (records then
    // follow their bodies through later operations) or keeps the symbolic set.
    values.makeRobustQuery = b('makeRobustQuery', 2, 2, ([, q], loc) => {
      if (isSym(q)) return q;
      const res = this.resolve(q, loc);
      return res.records ? new SQuery('frozen', { records: res.records }) : new Sym(res.value, res.type, this.ownersOf(res));
    });
    values.qUnion = b('qUnion', 1, 1, ([qs], loc) => {
      if (isSym(qs)) return qs;
      if (!Array.isArray(qs)) fail('qUnion expects an array', loc);
      return new SQuery('union', { queries: qs });
    });
    values.qCreatedBy = b('qCreatedBy', 1, 2, ([id, entityType]) => new SQuery('created', { id, entityType }));
    values.qAllModifiableSolidBodies = b('qAllModifiableSolidBodies', 0, 0, () => new SQuery('allSolid'));
    values.qEverything = b('qEverything', 0, 1, ([entityType]) => new SQuery('everything', { entityType }));
    values.qNothing = b('qNothing', 0, 0, () => new SQuery('nothing'));
    values.qSubtraction = b('qSubtraction', 2, 2, ([a, bq]) => new SQuery('subtract', { a, b: bq }));
    values.qBodyType = b('qBodyType', 2, 2, ([query, bodyType]) => new SQuery('bodyType', { query, bodyType }));
    values.qOwnedByBody = b('qOwnedByBody', 1, 2, ([query, entityType]) => new SQuery('owned', { query, entityType }));
    values.qSketchRegion = b('qSketchRegion', 1, 2, ([id]) => new SQuery('sketchRegion', { id }));
    values.evaluateQuery = b('evaluateQuery', 2, 2, ([context, q], loc) => this.evaluateQuery(context, q, loc));
    values.isQueryEmpty = b('isQueryEmpty', 2, 2, ([context, q], loc) => {
      const list = this.evaluateQuery(context, q, loc);
      return isSym(list) ? this.node('cmp', { op: '==', a: this.node('count', { of: list.ref }, NUM(), loc).ref, b: 0 }, { t: 'bool' }, loc) : list.length === 0;
    });
    values.getProperty = b('getProperty', 2, 2, ([c, d], loc) => {
      if (isSym(c)) return this.node('property', { context: c.ref, of: this.wk(d.entity, loc), key: d.propertyType?.name ?? '?' }, { t: 'str' }, loc);
      const res = this.resolve(d.entity, loc);
      const key = d.propertyType?.name === 'NAME' ? 'name' : 'appearance';
      if (res.records?.length === 1 && res.records[0][key] !== null) return res.records[0][key];
      return this.node('property', { of: res.value, key }, key === 'name' ? { t: 'str' } : { t: 'any' }, loc);
    });
    values.setProperty = b('setProperty', 2, 2, ([context, d], loc) => this.effect('setProperty', loc, () => {
      const res = this.resolve(d.entities, loc);
      const key = d.propertyType?.name === 'NAME' ? 'name' : d.propertyType?.name === 'APPEARANCE' ? 'appearance' : `prop:${d.propertyType?.name}`;
      if (res.records && !containsSym(d.value)) { for (const r of res.records) r[key] = key === 'appearance' ? this.wk(d.value, loc) : d.value; return; }
      const s = this.node('set_property', { set: res.value, key, value: this.wk(d.value, loc) }, { t: 'bodies' }, loc);
      for (const r of this.ownersOf(res)) r.value = this.node('replace', { set: this.wk(r.value, loc), by: s.ref }, { t: 'bodies' }, loc);
    }));
    values.newSketchOnPlane = b('newSketchOnPlane', 3, 3, ([context, id, d], loc) => this.effect('newSketchOnPlane', loc, () => {
      this.claim(context, id, loc);
      const sketch = { type: 'Sketch', id, plane: d.sketchPlane, entities: [], solved: false };
      this.sketches.set(id.key(), sketch); return sketch;
    }));
    for (const name of ['skRectangle', 'skPolyline', 'skLineSegment', 'skArc', 'skCircle', 'skText', 'skEllipse', 'skFitSpline', 'skBezier', 'skPoint', 'skRegularPolygon', 'skConstraint', 'skEllipticalArc'])
      values[name] = b(name, 2, 3, ([sketch, id, d], loc) => this.effect(name, loc, () => {
        if (sketch?.type !== 'Sketch') fail('Expected a sketch', loc);
        sketch.entities.push({ kind: name, id, d, loc });
      }));
    values.skSolve = b('skSolve', 1, 1, ([sketch], loc) => this.effect('skSolve', loc, () => this.solveSketch(sketch, loc)));
    values.opExtrude = b('opExtrude', 3, 3, ([c, id, d], loc) => this.effect('opExtrude', loc, () => this.opExtrude(c, id, d, loc)));
    values.fCuboid = b('fCuboid', 3, 3, ([c, id, d], loc) => this.effect('fCuboid', loc, () => {
      const a = vectorNumbers(d.corner1, 1, 3, loc), z = vectorNumbers(d.corner2, 1, 3, loc);
      const lo = a.map((v, i) => Math.min(v, z[i])), hi = a.map((v, i) => Math.max(v, z[i]));
      this.claim(c, id, loc);
      this.polygonBody(id, [[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]], { origin: [0, 0, lo[2]], normal: [0, 0, 1], x: [1, 0, 0] }, [0, 0, hi[2] - lo[2]], undefined, loc, 'box');
    }));
    values.opLoft = b('opLoft', 3, 3, ([c, id, d], loc) => this.effect('opLoft', loc, () => {
      this.claim(c, id, loc);
      const profiles = (Array.isArray(d.profileSubqueries) ? d.profileSubqueries : [d.profileSubqueries]).map(q => this.profileOf(q, loc));
      const circles = profiles.every(p => p.kind === 'circle');
      const s = circles && profiles.length === 2
        ? this.node('frustum', { first: profiles[0].wk, second: profiles[1].wk, delta: null, offset: null }, { t: 'bodies' }, loc, id)
        : this.node('loft', { profiles: profiles.map(p => p.wk), options: this.wk(omit(d, ['profileSubqueries']), loc) }, { t: 'bodies' }, loc, id);
      this.addRecord(id, s, 1);
    }));
    values.opBoolean = b('opBoolean', 3, 3, ([c, id, d], loc) => this.effect('opBoolean', loc, () => this.opBoolean(c, id, d, loc)));
    values.opDeleteBodies = b('opDeleteBodies', 3, 3, ([c, id, d], loc) => this.effect('opDeleteBodies', loc, () => {
      this.claim(c, id, loc);
      const res = this.resolve(d.entities, loc);
      if (res.records) { for (const r of res.records) this.records.delete(r.key); return; }
      for (const r of this.ownersOf(res)) r.value = this.node('difference', { a: this.wk(r.value, loc), b: res.value }, { t: 'bodies' }, loc, id);
    }));
    values.opTransform = b('opTransform', 3, 3, ([c, id, d], loc) => this.effect('opTransform', loc, () => {
      this.claim(c, id, loc);
      const res = this.resolve(d.bodies, loc), t = this.wk(d.transform, loc);
      if (res.records) { for (const r of res.records) r.value = this.node('transform', { bodies: this.wk(r.value, loc), transform: t }, { t: 'bodies' }, loc, id); return; }
      this.rebind(res, this.node('transform', { bodies: res.value, transform: t }, { t: 'bodies' }, loc, id), loc);
    }));
    values.opPattern = b('opPattern', 3, 3, ([c, id, d], loc) => this.effect('opPattern', loc, () => {
      this.claim(c, id, loc);
      const res = this.resolve(d.entities, loc);
      const s = this.node('pattern', { bodies: res.value, transforms: this.wk(d.transforms, loc), names: this.wk(d.instanceNames, loc) }, { t: 'bodies' }, loc, id);
      this.addRecord(id, s, res.card !== null && Array.isArray(d.transforms) ? res.card * d.transforms.length : null);
    }));
    values.newInstantiator = b('newInstantiator', 1, 2, ([id]) => ({ type: 'Instantiator', id, instances: [] }));
    // std instantiator.fs: the instance id is instantiator id + name (or
    // "Auto<n>"), and addInstance returns the query of the instance's bodies.
    values.addInstance = b('addInstance', 2, 3, ([inst, fn, d = map({})], loc) => {
      if (inst?.type !== 'Instantiator') fail('Expected an instantiator', loc);
      const name = d.name ?? `Auto${inst.instances.length}`;
      if (inst.instances.some(i => i.name === name)) fail(`Duplicate name ${name}`, loc);
      const id = new Id([...inst.id.parts, name]);
      inst.instances.push({ fn, d, loc, name, id });
      return new SQuery('created', { id, entityType: new EnumValue('EntityType', 'BODY') });
    });
    values.instantiate = b('instantiate', 2, 2, ([c, inst], loc) => this.effect('instantiate', loc, () => {
      this.claim(c, inst.id, loc);
      for (const { fn, d, loc: at, name, id } of inst.instances) {
        this.stats.imports++;
        const source = fn?.importOf ?? { function: fn?.name ?? '?' };
        const part = isSym(d?.partQuery) ? d.partQuery.ref : describeQuery(d?.partQuery);
        const s = this.node('import', { source, part, name, configuration: this.wk(d?.configuration ?? null, at), transform: this.wk(d?.transform ?? null, at),
          loadedContext: isSym(d?.loadedContext) ? d.loadedContext.ref : null }, { t: 'bodies' }, at, id);
        this.addRecord(id, s, null);
      }
    }));
    this.builtinTable = values;
    for (const [k, v] of Object.entries(values)) this.globals.set(k, v);
    this.globals.set('__wk_select', b('__wk_select', 3, 3, (args, loc) => this.idiomSelect(...args, loc)));
    this.globals.set('__wk_map', b('__wk_map', 3, 3, (args, loc) => this.idiomMap(...args, loc)));
    this.globals.set('__wk_message', b('__wk_message', 1, 1, ([fn], loc) => {
      // Only shapes a check's message: a failure or graph break while
      // computing it degrades the message, never the check.
      try { return this.call(fn, [], loc); } catch (error) { if (error instanceof GraphBreak || error instanceof FeatureScriptError) return new FeatureScriptError('check failed (diagnostic message needs kernel results)', loc); throw error; }
    }));
    this.globals.set('__wk_reduce', b('__wk_reduce', 3, 3, (args, loc) => this.idiomReduce(...args, loc)));
    this.globals.set('__wk_index', b('__wk_index', 3, 3, (args, loc) => this.idiomIndex(...args, loc)));
    this.globals.set('__wk_foreach', b('__wk_foreach', 2, 2, (args, loc) => this.idiomForeach(args[0], args[1], loc, false)));
    this.globals.set('__wk_foreach_index', b('__wk_foreach_index', 2, 2, (args, loc) => this.idiomForeach(args[0], args[1], loc, true)));
  }

  pureCall(name, args, loc, run) {
    if (args.some(containsSym)) return this.node('math', { fn: name, args: args.map(a => this.wk(a, loc)) }, NUM(0, 1), loc);
    return run();
  }
  effect(name, loc, run) {
    if (this.pure) this.brk('effect-in-predicate', `${name} inside a select/map predicate region`, loc);
    return run();
  }

  // Generic kernel functions the prototype does not model individually. They
  // still become nodes with resolved inputs, so the graph (and its dependency
  // structure) stays complete; executing them is the kernel's business and
  // raises a capability error there if unsupported.
  global(name, span) {
    if (this.globals.has(name)) return this.globals.get(name);
    if (name.includes('::')) {
      const [ns, member] = name.split('::');
      const spec = this.namespaces.get(ns);
      if (spec) return { type: 'builtin', name, min: 0, max: 99, importOf: { document: spec.path, version: spec.version, member },
        call: (args, loc) => this.node('import_context', { source: { document: spec.path, version: spec.version, member }, configuration: this.wk(args[0] ?? null, loc) }, { t: 'context' }, loc) };
    }
    if (KERNELISH.test(name)) return this.genericBuiltin(name);
    return super.global(name, span);
  }
  genericBuiltin(name) {
    const b = { type: 'builtin', name, min: 0, max: 16, call: (args, loc) => {
      if (name.startsWith('q')) return new SQuery('generic', { name, args });
      if (name.startsWith('ev')) {
        const [, d] = args;
        const target = isMap(d) ? Object.values(d).find(v => v instanceof SQuery || isSym(v)) : null;
        const res = target ? this.resolve(target, loc) : null;
        return this.node('measure', { fn: name, of: res?.value ?? null, options: isMap(d) ? this.wk(omit(d, Object.keys(d).filter(k => d[k] === target)), loc) : null }, MEASURES[name] ?? { t: 'any' }, loc);
      }
      return this.effect(name, loc, () => this.genericOp(name, args, loc));
    } };
    this.globals.set(name, b);
    return b;
  }
  genericOp(name, [context, id, d], loc) {
    this.stats.genericOps++;
    if (!(id instanceof Id)) return this.node('op', { fn: name, args: this.wk([context, id, d].filter(x => x !== undefined && x !== this.context), loc) }, { t: 'any' }, loc);
    this.claim(context, id, loc);
    const queries = isMap(d) ? Object.values(d).flatMap(v => v instanceof SQuery || isSym(v) ? [v] : Array.isArray(v) ? v.filter(x => x instanceof SQuery || isSym(x)) : []) : [];
    const owners = [...new Set(queries.flatMap(q => this.ownersOf(this.resolve(q, loc))))];
    const s = this.node('op', { fn: name, definition: this.wk(d, loc) }, { t: 'bodies' }, loc, id);
    // Conservative store effect: every body the op reads may be modified, and
    // the op may create bodies under its id.
    // Identity semantics: bodies of the owner sets that the op modified are
    // replaced by their new versions (matched through persistent identity).
    for (const r of owners) r.value = this.node('replace', { set: this.wk(r.value, loc), by: s.ref }, { t: 'bodies' }, loc);
    if (/^(opRevolve|opSweep|opThicken|opPlane|opSplitPart|opExtrude|fCylinder|fCone|fSphere|opFitSpline|opHelix|opPoint)$/.test(name)) this.addRecord(id, s, /^(opRevolve|opSweep|opThicken|fCylinder|fCone|fSphere)$/.test(name) ? 1 : null);
  }

  evaluateQuery(context, q, loc) {
    if (isSym(context) && context.type.t === 'context')
      return this.node('evaluate', { context: context.ref, query: isSym(q) ? q.ref : describeQuery(q) }, { t: 'list', of: { t: 'entity', kind: 'BODY' } }, loc);
    if (context !== this.context) fail('Invalid context', loc);
    if (isSym(q) && q.type.t === 'list') return q;
    const res = this.resolve(q, loc);
    // Static cardinality: bodies of records whose count is known (an extrusion
    // makes exactly one body) evaluate to a concrete list of symbolic bodies.
    if (res.records && res.card !== null && res.records.every(r => r.card !== null)) {
      const out = [];
      for (const r of res.records) for (let i = 0; i < r.card; i++)
        out.push(r.card === 1 ? new Sym(isSym(r.value) ? r.value.ref : this.wk(r.value, loc), { t: 'entity', kind: 'BODY' }, [r])
          : withOwners(this.node('nth', { of: this.wk(r.value, loc), index: i }, { t: 'entity', kind: 'BODY' }, loc), [r]));
      return out;
    }
    return withOwners(this.node('evaluate', { query: res.value }, { t: 'list', of: { t: 'entity', kind: res.type.kind ?? 'BODY' } }, loc), this.ownersOf(res));
  }

  solveSketch(sketch, loc) {
    const plane = sketch.plane;
    const polygon = [], curves = [], circles = [], others = [];
    for (const e of sketch.entities) {
      const d = e.d;
      if (e.kind === 'skRectangle' && !containsSym(d)) {
        const a = vectorNumbers(d.firstCorner, 1, 2, loc), c = vectorNumbers(d.secondCorner, 1, 2, loc);
        const [x0, y0] = a.map((v, i) => Math.min(v, c[i])), [x1, y1] = a.map((v, i) => Math.max(v, c[i]));
        polygon.push([[x0, y0], [x1, y0], [x1, y1], [x0, y1]]);
      } else if (e.kind === 'skPolyline' && !containsSym(d)) polygon.push(d.points.slice(0, -1).map(p => vectorNumbers(p, 1, 2, loc)));
      else if (e.kind === 'skCircle' && !containsSym(d)) circles.push({ center: vectorNumbers(d.center, 1, 2, loc), radius: length(d.radius, loc) });
      else if ((e.kind === 'skLineSegment' || e.kind === 'skArc') && !containsSym(d)) curves.push({ type: e.kind === 'skArc' ? 'arc' : 'line', id: e.id, ...Object.fromEntries(Object.entries(d).filter(([k]) => ['start', 'mid', 'end'].includes(k)).map(([k, v]) => [k, vectorNumbers(v, 1, 2, loc)])) });
      else others.push({ kind: e.kind, id: e.id, definition: this.wk(e.d, e.loc) });
    }
    const wkPlane = this.wk(plane, loc);
    const profiles = [];
    for (const p of polygon) profiles.push({ kind: 'polygon', points: p });
    for (const c of circles) profiles.push({ kind: 'circle', wk: { center: c.center, radius: c.radius, plane: wkPlane } });
    if (curves.length) {
      const s = this.node(curves.some(c => c.type === 'arc') ? 'sketch_arcs' : 'sketch_lines', { entities: curves, plane: wkPlane }, { t: 'profile' }, loc, sketch.id);
      profiles.push({ kind: 'profile', wk: s.ref });
    }
    if (others.length) {
      const s = this.node('sketch', { entities: others, plane: wkPlane }, { t: 'profile' }, loc, sketch.id);
      profiles.push({ kind: 'profile', wk: s.ref });
    }
    sketch.profiles = profiles; sketch.solved = true;
    this.addRecord(sketch.id, null, null, 'sketch');
  }
  profileOf(q, loc) {
    const res = this.resolve(q, loc);
    if (!res.sketch) return { kind: 'other', wk: res.value };
    const sketch = this.sketches.get(res.sketch.key());
    if (!sketch?.solved) fail(`Sketch '${res.sketch}' does not exist or has not been solved`, loc);
    if (sketch.profiles.length !== 1) return { kind: 'regions', wk: sketch.profiles.map(p => p.wk ?? p.points), sketch };
    const p = sketch.profiles[0];
    return { ...p, wk: p.wk ?? p.points, sketch };
  }
  // The same values ModelingContext.body() hands to extrudeInBend: validated
  // polygon, orientation from signedArea * height, plane as numbers.
  polygonBody(id, points, plane, delta, offset, loc, primitive = null) {
    // wonky validates polygons in JS today (brep.mjs). In WK that is part of
    // the kernel op: a rejected profile is recorded and fails at execution,
    // where FS try/catch around it can see it, instead of failing staging.
    let invalid = null;
    try {
      validatePolygon(points, loc);
      const eps = tolerance([...points, plane.origin, delta, offset ?? [0, 0, 0]]);
      const height = dot(delta, plane.normal);
      if (!Number.isFinite(height) || Math.abs(height) <= eps) fail('Extrusion has zero or unresolved thickness normal to the sketch plane', loc);
    } catch (error) { if (!(error instanceof FeatureScriptError)) throw error; invalid = error.message; }
    const oriented = !invalid && signedArea(points) * dot(delta, plane.normal) < 0 ? [...points].reverse() : points;
    const s = this.node('extrude_polygon', { points: oriented, plane, delta, offset: offset ?? null, precision: 'F32x2' }, { t: 'bodies' }, loc, id, invalid || primitive ? { ...(invalid ? { invalid } : {}), ...(primitive ? { primitive } : {}) } : null);
    this.addRecord(id, s, 1);
  }
  opExtrude(context, id, d, loc) {
    const profile = this.profileOf(d.entities, loc);
    if (d.endBound?.name !== 'BLIND' && !(typeof d.endBound === 'string' && d.endBound.endsWith('BLIND'))) {
      this.claim(context, id, loc);
      const s = this.node('op', { fn: 'opExtrude', profile: profile.wk, definition: this.wk(omit(d, ['entities']), loc) }, { t: 'bodies' }, loc, id);
      this.addRecord(id, s, null); return;
    }
    this.claim(context, id, loc);
    if (containsSym(d.direction) || containsSym(d.endDepth) || containsSym(d.startDepth) || !profile.sketch || containsSym(profile.sketch.plane)) {
      const s = this.node('extrude_profile', { profile: profile.wk, direction: this.wk(d.direction, loc), end: this.wk(d.endDepth, loc), start: this.wk(d.startDepth ?? null, loc) }, { t: 'bodies' }, loc, id);
      this.addRecord(id, s, 1); return;
    }
    const direction = normalized(vectorNumbers(d.direction, 0, 3, loc), loc);
    const end = length(d.endDepth, loc), start = d.startDepth === undefined ? 0 : length(d.startDepth, loc);
    const plane = this.wk(profile.sketch.plane, loc);
    const delta = scale(direction, end + start), offset = d.startDepth === undefined ? undefined : scale(direction, -start);
    if (profile.kind === 'polygon') return this.polygonBody(id, profile.points, plane, delta, offset, loc);
    if (profile.kind === 'circle') { this.addRecord(id, this.node('frustum', { first: profile.wk, second: null, delta, offset: offset ?? null }, { t: 'bodies' }, loc, id), 1); return; }
    this.addRecord(id, this.node('extrude_profile', { profile: profile.wk, plane, delta, offset: offset ?? null }, { t: 'bodies' }, loc, id), profile.kind === 'regions' ? null : 1);
  }
  opBoolean(context, id, d, loc) {
    const kind = { UNION: 'union', SUBTRACTION: 'subtract', INTERSECTION: 'intersect' }[d.operationType?.name] ?? String(d.operationType?.name);
    this.claim(context, id, loc);
    const tools = this.resolve(d.tools, loc), targets = d.targets === undefined ? null : this.resolve(d.targets, loc);
    const list = v => Array.isArray(v) ? v : [v];
    const s = this.node('boolean', { kind, targets: targets ? list(targets.value) : [], tools: list(tools.value), keepTools: d.keepTools ?? false }, { t: 'bodies' }, loc, id);
    // FS store semantics (library.mjs opBoolean): the result replaces the first
    // target (subtraction) or first tool (union/intersection) record; the other
    // operand records lose their bodies unless keepTools. With a symbolic
    // operand set the owner records are known but not which bodies they keep,
    // so the first owner gets rebind(removed, added) and the others difference.
    const keeper = kind === 'subtract' ? targets : tools;
    const done = new Set();
    if (keeper?.records?.length) {
      const [first, ...rest] = keeper.records;
      // Lineage as in library.mjs: the surviving record is created by its own
      // creators, the merged tools' creators (union/intersection) and this op.
      if (kind !== 'subtract') for (const r of rest) for (const k of r.createdBy) first.createdBy.add(k);
      first.value = s; first.card = null; first.createdBy.add(id.key()); done.add(first);
      for (const r of rest) { this.records.delete(r.key); done.add(r); }
    } else if (keeper) {
      this.ownersOf(keeper).forEach((r, k) => {
        r.value = k === 0 ? this.node('rebind', { set: this.wk(r.value, loc), removed: keeper.value, added: s.ref }, { t: 'bodies' }, loc)
          : this.node('difference', { a: this.wk(r.value, loc), b: keeper.value }, { t: 'bodies' }, loc);
        r.card = null; done.add(r);
      });
    }
    if (!(kind === 'subtract' && d.keepTools)) {
      if (tools.records) { for (const r of tools.records) if (!done.has(r)) this.records.delete(r.key); }
      else for (const r of this.ownersOf(tools)) if (!done.has(r)) r.value = this.node('difference', { a: this.wk(r.value, loc), b: tools.value }, { t: 'bodies' }, loc);
    }
  }

  // ---- if-conversion ----------------------------------------------------------
  // A condition on a kernel result that guards effects (if (size(es) > 0)
  // opFillet(...), generated total-Boolean helpers with early returns) becomes
  // two `when` regions, one per arm, with the modeling store as carried state
  // (as in fold). Each arm is traced until it leaves the if: by calling the
  // if's join point (normal if/else) or by producing the enclosing function's
  // value (early return). Store records, join arguments and return values are
  // merged with `choose` nodes. Arms that leave in different ways (break
  // from a loop in one arm only, ...) are a graph break.
  ifConvert(cond, yes, no, env, loc) {
    const live = () => [...this.records.values()];
    const saved = live().map(r => ({ r, value: r.value, card: r.card, name: r.name, appearance: r.appearance }));
    const savedIds = new Set(this.ids), savedSketches = new Map(this.sketches), claimed = new Set();
    const restore = () => {
      this.records = new Map(saved.map(s => [s.r.key, s.r]));
      for (const s of saved) Object.assign(s.r, { value: s.value, card: s.card, name: s.name, appearance: s.appearance });
      // Only one arm runs in FS, so both may claim the same ids.
      for (const id of this.ids) if (!savedIds.has(id)) claimed.add(id);
      this.ids = new Set(savedIds); this.sketches = new Map(savedSketches);
    };
    const arm = (branch, holds, through = null) => {
      const solid = live().filter(r => r.kind === 'solid');
      const start = this.graph.nodes.length;
      const region = this.graph.openRegion(['c', ...solid.map(r => `r${r.key}`)]);
      const frame = { local: new Set(through ? [through] : []) };
      this.arms.push(frame);
      let exit;
      try {
        solid.forEach((r, k) => { r.value = new Sym(region.params[k + 1], { t: 'bodies' }, r.value?.owners); });
        try { exit = { kind: 'value', value: this.evaluate(branch, env) }; }
        catch (e) { if (e instanceof ArmExit && e.frame === frame) exit = { kind: 'join', f: e.f, args: e.args }; else throw e; }
      } catch (error) {
        this.graph.regionStack.pop(); this.arms.pop();
        this.graph.nodes[region.owner] = { n: region.owner, op: 'abandoned', args: {}, type: 'none', id: null, span: -1, region: this.graph.region?.owner ?? null };
        throw error;
      }
      this.arms.pop();
      const changed = solid.filter((r, k) => r.value !== undefined && (!this.records.has(r.key) || !(isSym(r.value) && r.value.ref === region.params[k + 1])));
      const created = live().filter(r => r.kind === 'solid' && !saved.some(s => s.r === r));
      const exported = [];
      const exportValue = v => {
        if (!containsSym(v)) return v;
        const key = `v${exported.length}`;
        exported.push([key, this.wk(v, loc)]);
        return { exported: key, type: isSym(v) ? v.type : { t: 'any' }, owners: isSym(v) ? v.owners : null };
      };
      const values = exit.kind === 'join' ? exit.args.map(exportValue) : [exportValue(exit.value)];
      const results = Object.fromEntries([...changed.map(r => [`r${r.key}`, this.records.has(r.key) ? this.wk(r.value, loc) : []]),
        ...created.map(r => [`c${r.key}`, this.wk(r.value, loc)]), ...exported]);
      const used = new Set();
      const collect = v => { if (v instanceof Param && v.region === region.owner) used.add(v.name); else if (Array.isArray(v)) v.forEach(collect); else if (v && typeof v === 'object' && !(v instanceof Ref)) Object.values(v).forEach(collect); };
      for (const n of this.graph.nodes) if (n && n.n > region.owner) collect(n.args);
      collect(results);
      const empty = this.graph.nodes.length === start + 1 && !Object.keys(results).length;
      region.params = region.params.filter((p, k) => k > 0 && used.has(p.name));
      const init = Object.fromEntries(saved.filter(s => used.has(`r${s.r.key}`)).map(s => [`r${s.r.key}`, this.wk(s.value, loc)]));
      const node = this.graph.closeRegion(region, 'when', { cond: holds, init }, results, { type: 'bodies', ...this.where(loc), attrs: { arm: this.armSerial } });
      if (empty) this.graph.nodes[node.node] = { ...this.graph.nodes[node.node], op: 'when', args: { cond: holds, init: {} } };
      const out = key => new Ref(node.node, key);
      return { exit, values: values.map(v => v?.exported ? new Sym(out(v.exported), v.type, v.owners) : v),
        changed: new Map(changed.map(r => [r, this.records.has(r.key) ? new Sym(out(`r${r.key}`), { t: 'bodies' }) : undefined])),
        created: created.map(r => ({ r, value: new Sym(out(`c${r.key}`), { t: 'bodies' }) })) };
    };
    this.armSerial = (this.armSerial ?? 0) + 1;
    let a, b;
    const notCond = this.node('not', { x: cond.ref }, { t: 'bool' }, loc).ref;
    try {
      a = arm(yes, cond.ref); restore();
      b = arm(no, notCond); restore();
      // Early return: one arm produced the function's value, the other left
      // through the if's join point. Retrace that arm THROUGH the join (the
      // rest of the function) so that both arms end with the function value.
      if (a.exit.kind !== b.exit.kind) {
        const [joinArm, branch, holds] = a.exit.kind === 'join' ? ['a', yes, cond.ref] : ['b', no, notCond];
        const through = (joinArm === 'a' ? a : b).exit.f;
        const retried = arm(branch, holds, through); restore();
        if (joinArm === 'a') a = retried; else b = retried;
      }
    } catch (error) { restore(); if (error instanceof GraphBreak) throw error; if (error instanceof FeatureScriptError && !(error instanceof UnsupportedFeatureError)) this.brk('branch', `an arm of a kernel-dependent if fails while staging: ${error.message}`, loc); throw error; }
    for (const id of claimed) this.ids.add(id);
    const sameExit = a.exit.kind === b.exit.kind && (a.exit.kind === 'value' || a.exit.f === b.exit.f);
    if (!sameExit) this.brk('branch', 'the two arms of a kernel-dependent if leave it differently (return vs. continue, break, ...)', loc);
    this.stats.ifConversions = (this.stats.ifConversions ?? 0) + 1;
    // Merge the store.
    const touched = new Set([...a.changed.keys(), ...b.changed.keys()]);
    for (const s of saved) {
      if (!touched.has(s.r)) continue;
      const va = a.changed.has(s.r) ? a.changed.get(s.r) : s.value, vb = b.changed.has(s.r) ? b.changed.get(s.r) : s.value;
      s.r.value = this.node('choose', { cond: cond.ref, then: va === undefined ? [] : this.wk(va, loc), else: vb === undefined ? [] : this.wk(vb, loc) }, { t: 'bodies' }, loc);
      s.r.card = null;
    }
    for (const { r, value } of [...a.created, ...b.created]) { r.value = value; r.card = null; this.records.set(r.key, r); }
    const merge = (x, y) => {
      if (x === y || (!containsSym(x) && !containsSym(y) && x !== undefined && y !== undefined && binary('==', x, y, loc) === true)) return x;
      const rep = v => v === undefined || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean' || isSym(v) || v instanceof Quantity || v instanceof Vector || v instanceof SQuery || Array.isArray(v) || isMap(v);
      if (!rep(x) || !rep(y)) this.brk('value-use', 'a kernel-dependent if merges values that WK cannot represent', loc);
      const type = isSym(x) ? x.type : isSym(y) ? y.type : typeOf(x ?? y);
      const owners = [...(ownersOfValues(x) ?? []), ...(ownersOfValues(y) ?? [])];
      return withOwners(this.node('choose', { cond: cond.ref, then: this.wk(x, loc), else: this.wk(y, loc) }, type, loc), owners);
    };
    if (a.exit.kind === 'value') return ['lit', merge(a.values[0], b.values[0])];
    const args = a.values.map((x, i) => merge(x, b.values[i]));
    const f = a.exit.f;
    let e = f.env;
    f.fn[1].forEach((p, i) => { const x = Object.create(e); x[p] = args[i]; e = x; });
    return ['__continue', f.fn[2], e];
  }

  // ---- loop idioms (./idioms-fs.mjs) -------------------------------------------
  elementType(values) { return isSym(values) ? values.type.of ?? { t: 'entity' } : values[0]?.type ?? { t: 'any' }; }
  region(params, types, body) {
    this.stats.regions++;
    const region = this.graph.openRegion(params);
    try { return { region, results: body(region.params.map((p, i) => new Sym(p, types[i]))) }; }
    catch (error) { this.graph.regionStack.pop(); this.graph.nodes[region.owner] = { n: region.owner, op: 'abandoned', args: {}, type: 'none', id: null, span: -1, region: this.graph.region?.owner ?? null }; throw error; }
  }
  idiomSelect(acc, values, fn, loc) {
    if (!isSym(values) && Array.isArray(values)) {
      // Concrete elements first; if a predicate needs kernel results the
      // attempt's nodes are dropped (nothing references them) and a region
      // is emitted instead.
      const kept = [], preds = [], start = this.graph.nodes.length;
      this.pure++;
      try { for (const x of values) { const c = this.call(fn, [x], loc); preds.push(c); if (!isSym(c) && truth(c, loc)) kept.push(x); } }
      finally { this.pure--; }
      if (!preds.some(isSym)) return [...acc, ...kept];
      this.graph.nodes.length = start;
    }
    if (isSym(acc) || (Array.isArray(acc) && acc.length)) this.brk('value-use', 'select into a non-empty accumulator', loc);
    this.pure++;
    try {
      const { region, results } = this.region(['x'], [this.elementType(values)], ([x]) => {
        const c = this.call(fn, [x], loc);
        if (!isSym(c) && typeof c !== 'boolean') fail('select predicate must be boolean', loc);
        return [this.wk(c, loc)];
      });
      return new Sym(this.graph.closeRegion(region, 'select', { list: this.wk(values, loc) }, results, { type: 'list', ...this.where(loc) }), { t: 'list', of: this.elementType(values) }, ownersOfValues(values));
    } finally { this.pure--; }
  }
  idiomMap(acc, values, fn, loc) {
    if (!isSym(values) && Array.isArray(values)) return [...acc, ...values.map(x => this.call(fn, [x], loc))];
    if (isSym(acc) || acc.length) this.brk('value-use', 'map into a non-empty accumulator', loc);
    this.pure++;
    try {
      let identity = false;
      const { region, results } = this.region(['x'], [this.elementType(values)], ([x]) => {
        const y = this.call(fn, [x], loc);
        identity = y === x;
        return [this.wk(y, loc)];
      });
      return new Sym(this.graph.closeRegion(region, 'map', { list: this.wk(values, loc) }, results, { type: 'list', ...this.where(loc) }), { t: 'list', of: identity ? this.elementType(values) : { t: 'any' } }, identity ? ownersOfValues(values) : null);
    } finally { this.pure--; }
  }
  // reduce: carried variables through a pure loop body (sums, argmax, ...).
  idiomReduce(values, init, fn, loc) {
    if (!isSym(values) && Array.isArray(values)) {
      let acc = init;
      for (const x of values) acc = this.call(fn, [x, ...acc], loc);
      return acc;
    }
    this.pure++;
    try {
      const types = init.map(v => isSym(v) ? v.type : typeOf(v));
      const { region, results } = this.region(['x', ...init.map((_, i) => `a${i}`)], [this.elementType(values), ...types], ([x, ...acc]) => {
        const out = this.call(fn, [x, ...acc], loc);
        return out.map(v => this.wk(v, loc));
      });
      const node = this.graph.closeRegion(region, 'reduce', { list: this.wk(values, loc), init: init.map(v => this.wk(v, loc)) }, results, { type: 'value', ...this.where(loc) });
      return init.map((v, i) => new Sym(new Ref(node.node, i), types[i].t === 'any' ? this.elementType(values) : types[i], ownersOfValues(values)));
    } finally { this.pure--; }
  }
  // Name table: M[K(x)] = x for every x. Concrete keys build the map as FS
  // would; kernel-derived keys (getProperty on imported bodies) become an
  // index region whose lookups by literal name are get nodes.
  idiomIndex(table, values, fn, loc) {
    if (!isSym(values) && Array.isArray(values)) {
      const keys = values.map(x => this.call(fn, [x], loc));
      if (!keys.some(containsSym)) { let m = table; values.forEach((x, i) => { m = this.update(m, [keys[i]], x, loc); }); return m; }
    }
    if (isSym(table) || !isMap(table) || Object.keys(table).length) this.brk('value-use', 'name table with kernel-derived keys that is not empty before the loop', loc);
    this.pure++;
    try {
      const { region, results } = this.region(['x'], [this.elementType(values)], ([x]) => [this.wk(this.call(fn, [x], loc), loc)]);
      return new Sym(this.graph.closeRegion(region, 'index', { list: this.wk(values, loc) }, results, { type: 'table', ...this.where(loc) }), { t: 'table', of: this.elementType(values) }, ownersOfValues(values));
    } finally { this.pure--; }
  }
  // foreach with effects: a fold over the list; the FS store is the carried
  // state. Every live solid record becomes a region parameter; records the
  // body changes are fold results, bodies created in the body are collected.
  idiomForeach(values, fn, loc, indexed) {
    if (!isSym(values)) {
      if (!Array.isArray(values)) fail('foreach expects an array', loc);
      values.forEach((x, i) => this.call(fn, [indexed ? i : x], loc));
      return undefined;
    }
    const live = [...this.records.values()].filter(r => r.kind === 'solid');
    const saved = live.map(r => [r, r.value]);
    const before = new Set(this.records.keys());
    const params = [indexed ? 'i' : 'x', ...live.map(r => `r${r.key}`)];
    const types = [indexed ? NUM() : this.elementType(values), ...live.map(() => ({ t: 'bodies' }))];
    let carried = [], created = [];
    const { region } = this.region(params, types, syms => {
      live.forEach((r, k) => { r.value = syms[k + 1]; });
      this.call(fn, [syms[0]], loc);
      carried = live.filter((r, k) => r.value !== syms[k + 1] || !this.records.has(r.key));
      created = [...this.records.values()].filter(r => !before.has(r.key));
      return null;
    });
    // Results are keyed: r<key> is the new state of a carried record, c<key>
    // collects the bodies a record created in the body gets over all iterations.
    const results = Object.fromEntries([...carried.map(r => [`r${r.key}`, this.records.has(r.key) ? this.wk(r.value, loc) : []]), ...created.map(r => [`c${r.key}`, this.wk(r.value, loc)])]);
    // Parameters the body never reads are dropped (with their initial values).
    const used = new Set();
    const collect = v => { if (v instanceof Param && v.region === region.owner) used.add(v.name); else if (Array.isArray(v)) v.forEach(collect); else if (v && typeof v === 'object' && !(v instanceof Ref)) Object.values(v).forEach(collect); };
    for (const n of this.graph.nodes) if (n && n.n > region.owner) collect(n.args);
    collect(results);
    region.params = region.params.filter((p, k) => k === 0 || used.has(p.name));
    const init = Object.fromEntries(saved.filter(([r]) => used.has(`r${r.key}`)).map(([r, v]) => [`r${r.key}`, this.wk(v, loc)]));
    const fold = this.graph.closeRegion(region, 'fold', { list: this.wk(values, loc), init }, results, { type: 'bodies', ...this.where(loc) });
    for (const [r, v] of saved) if (!carried.includes(r)) r.value = v;
    carried.forEach(r => { r.value = new Sym(new Ref(fold.node, `r${r.key}`), { t: 'bodies' }); r.card = null; if (!this.records.has(r.key)) this.records.set(r.key, r); });
    created.forEach(r => { r.value = new Sym(new Ref(fold.node, `c${r.key}`), { t: 'bodies' }); r.card = null; });
    return undefined;
  }

  // ---- evaluation: symbolic prims and conditions --------------------------------
  prim(op, args, loc) {
    const [a, b, c] = args;
    // Container primitives look at the container, not at its elements: a
    // concrete array may hold symbolic bodies and still be iterated.
    switch (op) {
      case 'iter-array':
        if (isSym(a)) this.brk('loop', 'loop over a kernel result that is not a recognised select/map/foreach idiom', loc);
        if (isMap(a)) return Object.keys(a).sort(); // FS iterates map keys in value order (strings: lexicographic)
        if (a instanceof KeyedMap) return a.entries.map(([k]) => k);
        return super.prim(op, args, loc);
      case 'size-of': return isSym(a) ? this.node('count', { of: a.ref }, NUM(), loc) : super.prim(op, args, loc);
      case 'update': if (isSym(a) || (Array.isArray(b) && b.some(isSym))) this.brk('value-use', 'assignment into a kernel result', loc); return this.update(a, b, c, loc);
      case 'check-type': return isSym(a) ? a : UNTAGGED.has(b) && (isMap(a) || a instanceof KeyedMap) ? a : super.prim(op, args, loc);
      case 'is':
        if (isSym(a)) { if (b === 'Query' && ['bodies', 'entities', 'entity', 'list'].includes(a.type.t)) return true; this.brk('value-use', 'type test on a kernel result', loc); }
        if (UNTAGGED.has(b)) return isMap(a) || a instanceof KeyedMap;
        return super.prim(op, args, loc);
      case 'as':
        if (isSym(a)) this.brk('value-use', 'type cast of a kernel result', loc);
        if (/BoundSpec$/.test(b) && a instanceof KeyedMap) return new KeyedMap(a.entries, b);
        if (UNTAGGED.has(b) && isMap(a)) return a;
        return super.prim(op, args, loc);
      case 'index': {
        if (isSym(a)) return withOwners(this.node('get', { of: a.ref, key: this.wk(b, loc) }, fieldType(a.type, b), loc, null), a.owners);
        if (isSym(b)) {
          if (Array.isArray(a)) return withOwners(this.node('get', { of: this.wk(a, loc), key: b.ref }, a[0]?.type ?? { t: 'any' }, loc), ownersOfValues(a));
          this.brk('value-use', 'index with a kernel result as key', loc);
        }
        if (a instanceof Id && typeof b === 'number') return a.parts[b];
        return super.prim(op, args, loc);
      }
      default: break;
    }
    if (!args.some(containsSym)) return super.prim(op, args, loc);
    switch (op) {
      case 'truth': return a;
      case 'not': return this.node('not', { x: this.wk(a, loc) }, { t: 'bool' }, loc);
      case 'neg': return this.node('arith', { op: '*', a: -1, b: this.wk(a, loc) }, isSym(a) ? a.type : typeOf(a), loc);
      case '==': case '!=': case '<': case '<=': case '>': case '>=':
        return this.node('cmp', { op, a: this.wk(a, loc), b: this.wk(b, loc) }, { t: 'bool' }, loc);
      case '+': case '-': case '*': case '/': case '%': case '^': {
        if (a instanceof Id && isSym(b)) return new Id([...a.parts, `⟨${b.ref}⟩`]);
        const ta = isSym(a) ? a.type : typeOf(a), tb = isSym(b) ? b.type : typeOf(b);
        return this.node('arith', { op, a: this.wk(a, loc), b: this.wk(b, loc) }, arithType(op, ta, tb), loc);
      }
      case '~': return this.node('format', { parts: [this.wk(a, loc), this.wk(b, loc)] }, { t: 'str' }, loc);
      default: this.brk('value-use', `'${op}' on a kernel result`, loc);
    }
  }
  define(name, value, span) {
    const existing = this.globals.get(name);
    if (existing && !(existing.type === 'builtin' && !this.userDefined?.has(name))) fail(`Duplicate declaration '${name}'`, this.loc(span));
    (this.userDefined ??= new Set()).add(name);
    this.globals.set(name, value); // a user definition shadows a staging builtin
  }
  // Call frames are always kept: node provenance records the call-site stack.
  call(fn, args, loc) {
    this.callStack.push({ fn, args, loc });
    try { return this.invoke(fn, args, loc); } finally { this.callStack.pop(); }
  }

  // The `if` rule of the staging evaluator (see header).
  stageIf(node, env) {
    const [, condNode, yes, no, span] = node;
    const cond = this.evaluate(condNode, env);
    if (!isSym(cond)) return truth(cond, this.loc(span)) ? yes : no;
    const loc = this.loc(span);
    const raising = branch => { let n = branch; while (n[0] === 'let') n = n[3]; return n[0] === 'raise'; };
    if (raising(yes) !== raising(no)) {
      // Check idiom: continue on the non-raising branch; the check becomes a
      // deferred expect node carrying the message the raise would produce.
      this.stats.checks++;
      const raiseBranch = raising(yes) ? yes : no;
      let message = 'check failed';
      try { this.evaluate(raiseBranch, env); } catch (error) { if (error instanceof FeatureScriptError) message = error.message; else if (!(error instanceof GraphBreak || error instanceof UnsupportedFeatureError)) throw error; }
      const holds = raising(yes) ? this.node('not', { x: cond.ref }, { t: 'bool' }, loc).ref : cond.ref;
      this.node('expect', { cond: holds, message }, { t: 'check' }, loc);
      return raising(yes) ? no : yes;
    }
    if (!isPureExpression(yes) || !isPureExpression(no)) {
      const converted = this.ifConvert(cond, yes, no, env, loc);
      if (converted) return converted;
    }
    if (isPureExpression(yes) && isPureExpression(no)) {
      this.stats.choices++;
      let a, b;
      try { a = this.evaluate(yes, env); b = this.evaluate(no, env); }
      catch (error) { if (error instanceof FeatureScriptError) this.brk('branch', `speculative branch failed: ${error.message}`, loc); throw error; }
      return ['lit', this.node('choose', { cond: cond.ref, then: this.wk(a, loc), else: this.wk(b, loc) }, isSym(a) ? a.type : typeOf(a), loc)];
    }
    this.brk('branch', 'control flow depends on a kernel result', loc);
  }

  // The core evaluator's loop (../semcore/eval.mjs) with two changed cases:
  // `if` goes through stageIf, and `handle` (FS try) turns kernel failures
  // inside its body into failure-combinator nodes instead of losing them.
  evaluate(node, env) {
    const extend = (e, name, value) => { const x = Object.create(e); x[name] = value; return x; };
    for (;;) {
      this.tick(node);
      switch (node[0]) {
        case 'if': {
          const next = this.stageIf(node, env);
          if (next[0] === '__continue') { node = next[1]; env = next[2]; continue; }
          node = next; continue;
        }
        case 'handle': return this.stageHandle(node, env);
        case 'let': {
          const value = this.evaluate(node[2], env);
          if (this.arms.length && value?.fn?.[3]?.join) this.arms.at(-1).local.add(value);
          env = extend(env, node[1], value); node = node[3]; continue;
        }
        case 'letrec': {
          const e = Object.create(env);
          for (const [name, fn] of node[1]) { e[name] = this.closure(fn, e); if (this.arms.length) this.arms.at(-1).local.add(e[name]); }
          env = e; node = node[2]; continue;
        }
        case 'call': {
          const f = this.evaluate(node[1], env);
          const args = node[2].map(a => this.evaluate(a, env));
          if (f?.fn?.[3]?.join) {
            // A join point defined outside the arm being traced ends the arm.
            const frame = this.arms.at(-1);
            if (frame && !frame.local.has(f)) throw new ArmExit(frame, f, args);
            this.stats.joinCalls++;
            let e = f.env;
            f.fn[1].forEach((p, i) => { e = extend(e, p, args[i]); });
            env = e; node = f.fn[2]; continue;
          }
          return this.call(f, args, this.loc(node[3]));
        }
        case 'case': {
          const value = this.evaluate(node[1], env);
          const arm = node[2][value.tag];
          if (!arm) throw new Error(`Internal: no case arm for ${value?.tag}`);
          arm[0].forEach((name, i) => { env = extend(env, name, value.items[i]); });
          node = arm[1]; continue;
        }
        default: return super.evaluate(node, env);
      }
    }
  }
  closure(fn, env) { return super.evaluate(['fn', fn[1], fn[2], fn[3]], env); }

  // FS try in staging. Value-level exceptions raised while staging behave as
  // in FS (the handler runs). Kernel failures can only happen when the graph
  // executes, so the handler is classified instead:
  //   rethrow (throw regenError(prefix ~ error)) -> `decorate` attribute on the
  //     body's nodes: the host formats the message when one of them fails;
  //   try(expr) / try silent / handler without effects that yields undefined ->
  //     every record the body changed becomes or_else(new, old) and every
  //     record it created becomes optional(new): an atomic best effort;
  //   anything else -> graph break (the handler needs the failure as a value).
  stageHandle(node, env) {
    const [, body, name, handler, meta] = node;
    const start = this.graph.nodes.length;
    const before = new Map([...this.records.values()].map(r => [r.key, r.value]));
    let result;
    try { result = this.evaluate(body, env); }
    catch (error) {
      if (!(error instanceof FeatureScriptError) || error instanceof UnsupportedFeatureError) throw error;
      const e = Object.create(env); e[name] = error.value ?? error;
      return this.evaluate(handler, e);
    }
    if (this.graph.nodes.length === start) return result;
    const loc = this.loc(meta.span);
    let h = handler; while (h[0] === 'let') h = h[3];
    const emitted = this.graph.nodes.slice(start).filter(Boolean);
    if (h[0] === 'raise') {
      let template = 'failed';
      try { const e = Object.create(env); e[name] = new FeatureScriptError('⟨error⟩'); this.evaluate(handler, e); }
      catch (error) { if (error instanceof FeatureScriptError) template = error.message; else throw error; }
      for (const n of emitted) n.attrs = { ...(n.attrs ?? {}), decorate: [...(n.attrs?.decorate ?? []), template] };
      this.stats.decorations = (this.stats.decorations ?? 0) + 1;
      return result;
    }
    if (meta.silent || h[0] === 'undef' || (h[0] === 'ctor' && h[2].every(isPureExpression))) {
      this.stats.optionals = (this.stats.optionals ?? 0) + 1;
      for (const r of this.records.values()) {
        if (!before.has(r.key)) r.value = this.node('optional', { value: this.wk(r.value, loc) }, { t: 'bodies' }, loc);
        else if (r.value !== before.get(r.key)) r.value = this.node('or_else', { value: this.wk(r.value, loc), fallback: this.wk(before.get(r.key), loc) }, { t: 'bodies' }, loc);
      }
      for (const [key] of before) if (!this.records.has(key)) this.brk('failure-handler', 'a best-effort try deletes bodies; its fallback needs the deleted records', loc);
      return result;
    }
    this.brk('failure-handler', 'a try handler with its own effects runs only when a kernel operation fails', loc);
  }

  // Imports: any onshape/std module is accepted (missing functions fail when
  // used, as capability errors); namespaced Part Studio imports stay symbolic.
  run(program, name, context, id, definition) {
    this.spans = program.spans;
    for (const item of program.imports) if (item.namespace) this.namespaces.set(item.namespace, item);
    for (const def of program.globals) this.define(def.name, this.evaluate(def.value, this.root), def.span);
    const exports = program.globals.filter(d => d.exported && matchesType(this.globals.get(d.name), 'function')).map(d => d.name);
    const selected = name ?? (exports.length === 1 ? exports[0] : exports.includes('main') ? 'main' : null);
    if (!selected || !exports.includes(selected)) fail(`Choose an exported feature. Available: ${exports.join(', ') || '(none)'}`);
    const entry = this.globals.get(selected);
    const inputs = {};
    for (const spec of this.inputSpecs?.(selected) ?? []) {
      if (spec.kind === 'query') {
        const ctx = [...this.records.values()].find(r => r.createdBy.has(new Id(['partStudio']).key()));
        inputs[spec.key] = new Sym(this.node('input', { name: `definition.${spec.key}`, of: ctx ? this.wk(ctx.value, null) : null }, { t: 'bodies' }, null).ref, { t: 'bodies' }, ctx ? [ctx] : null);
      } else inputs[spec.key] = spec.value;
    }
    // Precedence: std bound defaults < defineFeature's defaults map <
    // annotation "Default"s < an explicitly supplied definition.
    this.call(entry, [context, id, map({ ...inputs, ...(entry.defaults ?? {}), ...this.featureDefaults(entry), ...(definition ?? {}) })], null);
    return selected;
  }
  // Annotations are UI metadata; an annotation the prototype cannot evaluate
  // (e.g. "Filter" : EntityType.BODY && BodyType.SOLID, an FS operator
  // overload wonky lacks) only loses its "Default".
  featureDefaults(entry) {
    const defaults = map({});
    if (entry?.type !== 'feature' || !entry.fn?.fn) return defaults;
    for (const row of entry.fn.fn[3].defaults ?? []) {
      for (const annotation of row.annotations) {
        try { const metadata = this.evaluate(annotation, entry.fn.env); if (isMap(metadata) && Object.hasOwn(metadata, 'Default')) defaults[row.key] = metadata.Default; } catch { /* metadata only */ }
      }
      if (row.bounds) {
        try { const bounds = this.evaluate(row.bounds, entry.fn.env); if (bounds instanceof KeyedMap) defaults[row.key] = lengthDefault(bounds, this.loc(row.span)); } catch { /* keep std default */ }
      }
    }
    return defaults;
  }
}

// An `if` whose branches are side-effect-free expressions (&&, ||, ?:): no
// statements, no local function calls, no raise.
function isPureExpression(node) {
  switch (node[0]) {
    case 'lit': case 'undef': case 'var': case 'glob': return true;
    case 'prim': return node[2].every(isPureExpression);
    case 'list': return node[1].every(isPureExpression);
    case 'map': return node[1].every(([k, v]) => isPureExpression(k) && isPureExpression(v));
    case 'if': return isPureExpression(node[1]) && isPureExpression(node[2]) && isPureExpression(node[3]);
    case 'call': return node[1][0] === 'glob' && !EFFECTFUL.test(node[1][1]) && node[2].every(isPureExpression);
    default: return false;
  }
}
const num = v => v instanceof Quantity ? v.value : v;
// FS type tags wonky's value layer does not implement (it has no tagged maps):
// staging accepts any map for them, a documented divergence (semantic-core.md, case 8).
const UNTAGGED = new Set(['Color', 'CoordSystem', 'Line', 'Box3d', 'Instantiator', 'Circle', 'Cone', 'Cylinder', 'Sphere', 'Torus', 'MateConnector', 'PartStudioData']);
const lengthDefault = (bounds, loc) => { const [, row] = bounds.entries[0]; return binary('*', row[1], bounds.entries[0][0], loc); };
const withOwners = (sym, owners) => { sym.owners = owners?.length ? [...new Set(owners)] : null; return sym; };
const ownersOfValues = values => isSym(values) ? values.owners : Array.isArray(values) ? values.flatMap(v => v?.owners ?? []) : null;
const omit = (d, keys) => Object.fromEntries(Object.entries(d).filter(([k]) => !keys.includes(k)));
function typeOf(v) {
  if (v instanceof Quantity) return NUM(v.dimension, v.angle);
  if (typeof v === 'number') return NUM();
  if (typeof v === 'boolean') return { t: 'bool' };
  if (typeof v === 'string') return { t: 'str' };
  if (v instanceof Vector) return { t: 'vec', dim: v.items[0] instanceof Quantity ? v.items[0].dimension : 0 };
  return { t: 'any' };
}
function arithType(op, a, b) {
  if (a.t === 'vec' || b.t === 'vec') return { t: 'vec', dim: (a.dim ?? 0) + (op === '*' ? b.dim ?? 0 : 0) };
  if (a.t !== 'num' || b.t !== 'num') return { t: 'any' };
  if (op === '*') return NUM(a.dim + b.dim, a.angle + b.angle);
  if (op === '/') return NUM(a.dim - b.dim, a.angle - b.angle);
  return NUM(a.dim, a.angle);
}
function describeQuery(q) {
  if (!q) return null;
  if (q instanceof SQuery) return { kind: q.kind, ...Object.fromEntries(Object.entries(q).filter(([k]) => !['type', 'kind'].includes(k)).map(([k, v]) =>
    [k, v instanceof SQuery ? describeQuery(v) : Array.isArray(v) ? v.map(x => x instanceof SQuery ? describeQuery(x) : String(x?.name ?? x)) : v instanceof EnumValue ? `${v.enumType}.${v.name}` : v instanceof Id ? v.toString() : String(v)])) };
  return String(q);
}

class ArmExit { constructor(frame, f, args) { this.frame = frame; this.f = f; this.args = args; } }

// ---- entry point --------------------------------------------------------------------

// Feature parameters the Onshape UI would supply: std defaults for bounded
// numbers (valueBounds.fs: LENGTH_BOUNDS default 0.025 m, ANGLE_360_BOUNDS
// 30 degree, counts 2, reals 1), false for booleans, and a symbolic input for
// a user-selected Query (a subset of the symbolic Part Studio).
const STD_DEFAULT = { isLength: b => new Quantity(/ZERO_DEFAULT/.test(b) ? 0 : 0.025), isAngle: () => new Quantity(30 * Math.PI / 180, 0, 1), isInteger: () => 2, isReal: () => 1 };
function featureInputSpecs(ast) {
  const byFeature = new Map();
  for (const d of ast.declarations) {
    const fn = d.value?.kind === 'call' && d.value.callee?.name === 'defineFeature' ? d.value.args[0] : null;
    if (!fn?.precondition) continue;
    const param = fn.params[2]?.name ?? 'definition', specs = [];
    const keyOf = e => e?.kind === 'access' && e.value.kind === 'name' && e.value.name === param && e.key.kind === 'literal' ? e.key.value : null;
    const visit = e => {
      if (!e || typeof e !== 'object') return;
      if (e.kind === 'call' && STD_DEFAULT[e.callee?.name] && keyOf(e.args[0])) specs.push({ key: keyOf(e.args[0]), kind: 'value', value: STD_DEFAULT[e.callee.name](e.args[1]?.name ?? '') });
      else if (e.kind === 'type' && e.operator === 'is' && keyOf(e.value)) {
        if (e.type === 'Query') specs.push({ key: keyOf(e.value), kind: 'query' });
        else if (e.type === 'boolean') specs.push({ key: keyOf(e.value), kind: 'value', value: false });
      }
      for (const [k, v] of Object.entries(e)) if (k !== 'loc') (Array.isArray(v) ? v : [v]).forEach(x => x && typeof x === 'object' && visit(x));
    };
    fn.precondition.statements.forEach(visit);
    byFeature.set(d.name, specs);
  }
  return byFeature;
}

export function stageFeatureScript(source, { feature, file = null, id = 'model', maxSteps = 20000000, context } = {}) {
  const t0 = performance.now();
  const parsed = parse(source);
  const t1 = performance.now();
  const { ast, rewrites } = rewriteIdioms(parsed);
  const program = desugarProgram(ast);
  const t2 = performance.now();
  const specs = featureInputSpecs(parsed);
  const needsQueryInput = feature ? (specs.get(feature) ?? []).some(s => s.kind === 'query') : [...specs.values()].some(ss => ss.some(s => s.kind === 'query'));
  const evaluator = new StagingEvaluator({ file, context: context ?? (needsQueryInput ? 'symbolic' : 'empty') });
  evaluator.inputSpecs = name => specs.get(name) ?? [];
  evaluator.maxSteps = maxSteps;
  const graph = evaluator.graph;
  graph.meta.idioms = rewrites;
  let selected = null, graphBreak = null, error = null;
  try { selected = evaluator.run(program, feature, evaluator.context, new Id([id]), null); }
  catch (e) { if (e instanceof GraphBreak) graphBreak = e; else error = e; }
  const t3 = performance.now();
  if (!graphBreak && !error) for (const r of evaluator.records.values()) if (r.kind === 'solid')
    graph.output(isSym(r.value) ? r.value.ref : r.value, { name: r.name, appearance: r.appearance });
  return { graph, feature: selected, graphBreak, error, idioms: rewrites, context: evaluator.records.size && [...evaluator.records.values()].some(r => r.createdBy.has(new Id(['partStudio']).key())) ? 'symbolic' : 'empty', stats: { ...evaluator.stats, steps: evaluator.steps },
    timingsMs: { parse: t1 - t0, rewriteAndDesugar: t2 - t1, stage: t3 - t2 } };
}
