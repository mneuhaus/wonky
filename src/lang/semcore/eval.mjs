// JS reference evaluator for WCore/0 (./ir.mjs). It is an oracle for the
// semantic-core study, not a production path: values, value operations and
// every modeling builtin are the ones the FeatureScript interpreter uses
// (src/values.mjs, src/library.mjs, ...), so any difference in results comes
// from the desugaring or from the core semantics chosen here.
//
// Core semantics beyond the reference interpreter (option `transactions`):
// - every effectful builtin (op*/sk*/f*/newSketchOnPlane/instantiator/
//   setProperty) is atomic: on any error the modeling store is restored;
// - calling a feature value (defineFeature) is a transaction like std's
//   startFeature/abortFeature: a model exception restores the store and is
//   rethrown.
// With `transactions: false` the evaluator reproduces the interpreter's
// non-transactional store behavior.
import { fail, unsupported, FeatureScriptError, UnsupportedFeatureError } from '../../errors.mjs';
import { binary, cast, checkType, equal, EnumValue, isMap, KeyedMap, map, matchesType, truth, Vector, Plane } from '../../values.mjs';
import { lengthBoundRows } from '../../scalars.mjs';

class Closure {
  constructor(fn, env) { this.type = 'function'; this.fn = fn; this.env = env; this.name = fn[3]?.name ?? null; }
}
class Ctor { constructor(tag, items) { this.tag = tag; this.items = items; } }

const catchable = error => error instanceof FeatureScriptError && !(error instanceof UnsupportedFeatureError);
const effectful = name => /^(op[A-Z]|sk[A-Z]|f[A-Z])/.test(name) || ['newSketchOnPlane', 'newInstantiator', 'addInstance', 'instantiate', 'setProperty'].includes(name);
const SPAN_AT = { call: 3, prim: 3, if: 4, map: 2, raise: 2, glob: 2 };
const spanOf = node => node[0] === 'handle' ? node[4].span : SPAN_AT[node[0]] !== undefined ? node[SPAN_AT[node[0]]] : -1;
const extend = (env, name, value) => { const e = Object.create(env); e[name] = value; return e; };

// Store snapshots for transactions. Record objects keep their identity
// (transient 'reference' queries compare them); their fields are restored.
function ownFields(object) {
  const copy = {};
  for (const key of Object.keys(object)) {
    const d = Object.getOwnPropertyDescriptor(object, key);
    if ('value' in d) copy[key] = key === 'createdBy' ? new Set(d.value) : d.value;
  }
  return copy;
}
function snapshot(engine) {
  return {
    records: [...engine.records.entries()].map(([key, record]) => [key, record, ownFields(record),
      record.body && Object.getOwnPropertyDescriptor(record, 'body')?.value ? { name: record.body.name, appearance: record.body.appearance } : null]),
    nextRecord: engine.nextRecord, ids: new Set(engine.ids), evidence: engine.operationEvidence.length,
    sketches: [...engine.sketches.entries()].map(([key, s]) => [key, s, { profiles: [...s.profiles], lineSegments: [...s.lineSegments],
      curveEntities: [...s.curveEntities], entityIds: new Set(s.entityIds), solved: s.solved, deleted: s.deleted,
      lineProfileSource: s.lineProfileSource, arcProfileSource: s.arcProfileSource }]),
  };
}
function restore(engine, s) {
  engine.records = new Map(s.records.map(([key, record, fields, body]) => {
    for (const k of Object.keys(record)) if ('value' in Object.getOwnPropertyDescriptor(record, k) && !(k in fields)) delete record[k];
    Object.assign(record, fields);
    if (body) for (const k of ['name', 'appearance']) { if (body[k] === undefined) delete record.body[k]; else record.body[k] = body[k]; }
    return [key, record];
  }));
  engine.nextRecord = s.nextRecord; engine.ids = s.ids; engine.operationEvidence.length = s.evidence;
  engine.sketches = new Map(s.sketches.map(([key, sketch, fields]) => { Object.assign(sketch, fields); return [key, sketch]; }));
}

export class CoreEvaluator {
  constructor(builtins, { engine = null, maxSteps = 20000000, moduleResolver, callObserver, transactions = true } = {}) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) fail('maxSteps must be a positive safe integer');
    this.globals = new Map(Object.entries(builtins));
    this.namespaces = new Map();
    this.engine = engine; this.transactions = transactions;
    this.steps = 0; this.maxSteps = maxSteps; this.depth = 0;
    this.moduleResolver = moduleResolver; this.callObserver = callObserver; this.callStack = [];
    this.spans = null; this.root = Object.create(null); this.lastSpan = -1;
    this.stats = { transactions: 0, rollbacks: 0, joinCalls: 0, userCalls: 0, builtinCalls: 0 };
  }
  loc(span) { return this.spans?.get(span); }
  // Step budget (the Bend evaluator's fuel). Step counts differ from the
  // interpreter's (join points, lets), so budgets are comparable, not equal.
  tick(node) {
    const span = spanOf(node);
    if (span >= 0) this.lastSpan = span;
    if (++this.steps > this.maxSteps) fail(`Execution limit exceeded (${this.maxSteps} expression/statement steps)`, this.loc(this.lastSpan));
  }

  global(name, span) {
    if (this.globals.has(name)) return this.globals.get(name);
    const [namespace] = name.split('::');
    if (name.includes('::') && this.namespaces.has(namespace)) {
      const spec = this.namespaces.get(namespace);
      unsupported(`Unresolved Onshape module '${namespace}': ${spec.path} at version ${spec.version}. Supply its frozen source or B-rep snapshot.`, this.loc(span));
    }
    unsupported(`'${name}' is not defined or not implemented by this prototype`, this.loc(span));
  }
  define(name, value, span) {
    if (this.globals.has(name)) fail(`Duplicate declaration '${name}'`, this.loc(span));
    this.globals.set(name, value);
  }

  // Mirrors Interpreter.run: imports, top-level definitions in order, feature
  // selection, defaults, then one call of the selected feature.
  run(program, name, context, id, definition) {
    this.spans = program.spans;
    const supportedImports = new Set(['geometry', 'common', 'primitives', 'sketch', 'query', 'units', 'valueBounds', 'vector', 'plane', 'feature', 'instantiator']);
    for (const item of program.imports) {
      if (item.namespace) {
        this.namespaces.set(item.namespace, item);
        const exports = this.moduleResolver?.(item);
        if (exports) for (const [key, value] of Object.entries(exports)) this.define(`${item.namespace}::${key}`, value);
        continue;
      }
      if (Object.keys(item).some(k => !['path', 'version', 'namespace'].includes(k)) || typeof item.version !== 'string' || !/^\d+\.0$/.test(item.version)) fail('Expected standard-library import with a numeric version such as "3000.0"');
      const match = item.path?.match(/^onshape\/std\/([A-Za-z]+)\.fs$/);
      if (!match || !supportedImports.has(match[1])) unsupported(`Import '${item.path}' is not supported; only the documented local standard-library subset is available`);
    }
    if (!program.imports.length) fail('Import onshape/std/geometry.fs to use the local modeling library');
    for (const def of program.globals) this.define(def.name, this.evaluate(def.value, this.root), def.span);
    const exports = program.globals.filter(d => d.exported && matchesType(this.globals.get(d.name), 'function')).map(d => d.name);
    const selected = name ?? (exports.length === 1 ? exports[0] : exports.includes('main') ? 'main' : null);
    if (!selected || !exports.includes(selected)) fail(`Choose an exported feature with --feature. Available: ${exports.join(', ') || '(none)'}`);
    const entry = this.globals.get(selected);
    const defaults = this.featureDefaults(entry);
    const supplied = typeof definition === 'function' ? definition() : definition;
    this.call(entry, [context, id, map({ ...defaults, ...supplied })], null);
    return selected;
  }
  featureDefaults(entry) {
    const defaults = map({});
    if (entry?.type !== 'feature' || !(entry.fn instanceof Closure)) return defaults;
    for (const row of entry.fn.fn[3].defaults ?? []) {
      for (const annotation of row.annotations) {
        const metadata = this.evaluate(annotation, entry.fn.env);
        if (Object.hasOwn(metadata, 'Default')) defaults[row.key] = metadata.Default;
      }
      if (row.bounds) {
        const bounds = this.evaluate(row.bounds, entry.fn.env);
        if (bounds instanceof KeyedMap) defaults[row.key] = lengthBoundRows(bounds, this.loc(row.span))[0][1];
      }
    }
    return defaults;
  }

  evaluate(node, env) {
    for (;;) {
      this.tick(node);
      switch (node[0]) {
        case 'lit': return node[1];
        case 'undef': return undefined;
        case 'var': {
          if (!(node[1] in env)) throw new Error(`Internal: unbound core variable ${node[1]}`);
          return env[node[1]];
        }
        case 'glob': return this.global(node[1], node[2]);
        case 'let': env = extend(env, node[1], this.evaluate(node[2], env)); node = node[3]; continue;
        case 'letrec': {
          const e = Object.create(env);
          for (const [name, fn] of node[1]) e[name] = new Closure(fn, e);
          env = e; node = node[2]; continue;
        }
        case 'fn': return new Closure(node, env);
        case 'call': {
          const f = this.evaluate(node[1], env);
          const args = node[2].map(a => this.evaluate(a, env));
          if (f instanceof Closure && f.fn[3]?.join) {
            // Compiler join points and loops: proper tail calls, not FS calls.
            this.stats.joinCalls++;
            let e = f.env;
            f.fn[1].forEach((p, i) => { e = extend(e, p, args[i]); });
            env = e; node = f.fn[2]; continue;
          }
          return this.call(f, args, this.loc(node[3]));
        }
        case 'prim': return this.prim(node[1], node[2].map(a => this.evaluate(a, env)), this.loc(node[3]));
        case 'if': node = truth(this.evaluate(node[1], env), this.loc(node[4])) ? node[2] : node[3]; continue;
        case 'list': return node[1].map(n => this.evaluate(n, env));
        case 'map': {
          const entries = [];
          for (const [keyNode, valueNode] of node[1]) {
            const key = this.evaluate(keyNode, env);
            if (entries.some(([k]) => equal(k, key))) fail('Duplicate map key', this.loc(node[2]));
            entries.push([key, this.evaluate(valueNode, env)]);
          }
          return entries.every(([k]) => typeof k === 'string') ? map(Object.fromEntries(entries)) : new KeyedMap(entries);
        }
        case 'ctor': return new Ctor(node[1], node[2].map(n => this.evaluate(n, env)));
        case 'case': {
          const value = this.evaluate(node[1], env);
          const arm = value instanceof Ctor ? node[2][value.tag] : null;
          if (!arm) throw new Error(`Internal: no case arm for ${value?.tag}`);
          arm[0].forEach((name, i) => { env = extend(env, name, value.items[i]); });
          node = arm[1]; continue;
        }
        case 'handle': {
          try { return this.evaluate(node[1], env); }
          catch (error) {
            if (!catchable(error)) throw error;
            env = extend(env, node[2], error.value ?? error); node = node[3]; continue;
          }
        }
        case 'raise': {
          const value = this.evaluate(node[1], env);
          if (value instanceof FeatureScriptError) throw value;
          const error = new FeatureScriptError(String(value), this.loc(node[2])); error.value = value; throw error;
        }
        default: throw new Error(`Internal: unknown core node ${node[0]}`);
      }
    }
  }

  call(fn, args, loc) {
    if (!this.callObserver || (fn?.type === 'builtin' && this.callObserver.watches && !this.callObserver.watches(fn))) return this.invoke(fn, args, loc);
    const frame = { fn, args, loc }; this.callStack.push(frame);
    let token, result, error;
    try {
      token = this.callObserver.enter({ fn, args, loc, stack: this.callStack });
      result = this.invoke(fn, args, loc);
      return result;
    } catch (caught) { error = caught; throw caught; }
    finally { try { this.callObserver.leave(token, { result, error }); } finally { this.callStack.pop(); } }
  }
  transaction(run, rollbackOn) {
    if (!this.transactions || !this.engine) return run();
    this.stats.transactions++;
    const saved = snapshot(this.engine);
    try { return run(); }
    catch (error) { if (rollbackOn(error)) { this.stats.rollbacks++; restore(this.engine, saved); } throw error; }
  }
  invoke(fn, args, loc) {
    if (fn?.type === 'builtin') {
      if (args.length < fn.min || args.length > fn.max) fail(`${fn.name} expects ${fn.min === fn.max ? fn.min : `${fn.min}–${fn.max}`} arguments`, loc);
      this.stats.builtinCalls++;
      return effectful(fn.name) ? this.transaction(() => fn.call(args, loc, this), () => true) : fn.call(args, loc, this);
    }
    if (fn?.type === 'feature') {
      if (args.length !== 3 || !isMap(args[2])) fail('Feature calls require context, id, and definition map', loc);
      return this.transaction(() => this.call(fn.fn, [args[0], args[1], map({ ...fn.defaults, ...args[2] })], loc), catchable);
    }
    if (!(fn instanceof Closure)) fail('Value is not a callable function', loc);
    const params = fn.fn[1];
    if (args.length !== params.length) fail(`Function expects ${params.length} arguments`, loc);
    if (++this.depth > 64) { this.depth--; fail('Function call depth exceeded (64)', loc); }
    this.stats.userCalls++;
    let env = fn.env;
    params.forEach((p, i) => { env = extend(env, p, args[i]); });
    try { return this.evaluate(fn.fn[2], env); }
    finally { this.depth--; }
  }

  prim(op, args, loc) {
    const [a, b, c] = args;
    switch (op) {
      case '+': case '-': case '*': case '/': case '%': case '^': case '==': case '!=':
      case '<': case '<=': case '>': case '>=': case '~': return binary(op, a, b, loc);
      case 'neg': return binary('*', -1, a, loc);
      case 'not': return !truth(a, loc);
      case 'truth': return truth(a, loc);
      case 'index': {
        let value = a; const key = b;
        if (value instanceof KeyedMap) return value.get(key);
        if (value instanceof Vector) value = value.items;
        if (Array.isArray(value)) {
          if (!Number.isInteger(key) || key < 0 || key >= value.length) fail('Array index is out of bounds', loc);
          return value[key];
        }
        if (isMap(value)) {
          if (typeof key !== 'string') fail('Only string map keys are supported', loc);
          return Object.hasOwn(value, key) ? value[key] : undefined;
        }
        if (value instanceof Plane && ['origin', 'normal', 'x'].includes(key)) return value[key];
        fail('Expected a map, array, Vector, or Plane for member access', loc);
        break;
      }
      case 'update': return this.update(a, b, c, loc);
      case 'iter-array': if (!Array.isArray(a)) fail('This prototype supports for-in over arrays', loc); return a;
      case 'size-of': return a.length;
      case 'is': return matchesType(a, b, loc);
      case 'as': return cast(a, b, loc);
      case 'enum': {
        const members = map({});
        for (const member of b) {
          if (Object.hasOwn(members, member)) fail(`Duplicate enum member '${member}'`, loc);
          members[member] = new EnumValue(a, member);
        }
        return members;
      }
      case 'fail': return fail(a, loc);
      case 'unsupported': return unsupported(a, loc);
      case 'precondition': if (a !== true) fail('Feature precondition failed', loc); return a;
      case 'check-type': return checkType(a, b, loc);
      case 'loop-control-outside-loop': return fail(`'${a}' outside a loop`, loc);
      case 'assign-global': return this.global(a, -1) && undefined;
      default: throw new Error(`Internal: unknown primitive ${op}`);
    }
  }
  update(container, keys, value, loc) {
    if (!keys.length) return value;
    const [key, ...rest] = keys;
    if (container instanceof Vector) return new Vector(this.update(container.items, keys, value, loc));
    if (Array.isArray(container)) {
      if (!Number.isInteger(key) || key < 0 || key >= container.length) fail('Array assignment index is out of bounds', loc);
      const result = [...container]; result[key] = this.update(result[key], rest, value, loc); return result;
    }
    if (isMap(container)) {
      if (typeof key !== 'string') fail('Expected a string map key', loc);
      const result = map(container); result[key] = this.update(result[key], rest, value, loc); return result;
    }
    fail('Cannot assign a member of this value', loc);
  }
}
