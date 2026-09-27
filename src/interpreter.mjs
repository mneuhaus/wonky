import { catchable, fail, raise, unsupported, FeatureScriptException } from './errors.mjs';
import { binary, cast, checkType, display, equal, EnumValue, Id, isFunctionValue, isMap, KeyedMap, map, matchesType, Matrix, memberless, Quantity, retag, STD_ENUM_UNIMPLEMENTED, stdMapView, truth, Vector } from './values.mjs';
import { boundSpecDefault, resolveBoundSpec } from './scalars.mjs';
import { TopologyQuery } from './queries.mjs';

const BOUND_PREDICATES = ['isLength', 'isAngle', 'isInteger', 'isReal'];
// Map iteration order. FsDoc (variables.html): "maps are ordered
// deterministically", by key, not by insertion; relational.html orders strings
// by "Unicode character values". wonky orders string keys by code point and
// number keys numerically; other key orders are not implemented.
const codePoints = text => Array.from(text, c => c.codePointAt(0));
function compareCodePoints(a, b) {
  const x = codePoints(a), y = codePoints(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}
function mapEntries(value, loc) {
  if (isMap(value)) return Object.keys(value).sort(compareCodePoints).map(key => [key, value[key]]);
  if (value.entries.every(([key]) => typeof key === 'number')) return [...value.entries].sort(([a], [b]) => a - b);
  unsupported('Iterating a map whose keys are not all strings or all numbers is not implemented (FeatureScript key order)', loc);
}

// Member access (the . and [] operators). Arrays: a Vector (vector.fs: a
// tagged array), an Id (context.fs canBeId: an array of strings) and a Matrix
// (matrix.fs indexes rows, m1[0]). Maps: plain and keyed maps, the std maps
// wonky represents with its own classes (stdMapView: Plane, Transform, a
// caught regenError) and ValueWithUnits (units.fs: { value, unit }, value in
// SI base units). A missing map key reads as undefined (FsDoc variables.html).
function member(value, key, loc) {
  if (value instanceof KeyedMap) return value.get(key);
  const items = value instanceof Vector ? value.items : value instanceof Id ? value.parts
    : value instanceof Matrix ? value.rows.map(row => [...row]) : Array.isArray(value) ? value : null;
  if (items) {
    if (!Number.isInteger(key) || key < 0 || key >= items.length) raise('Array index is out of bounds', loc);
    return items[key];
  }
  if (value instanceof Quantity) {
    if (key === 'unit') unsupported('The unit map of a ValueWithUnits is not implemented', loc);
    return key === 'value' ? value.value : undefined;
  }
  const fields = isMap(value) && !isFunctionValue(value) ? value : stdMapView(value);
  if (fields) {
    if (typeof key !== 'string') unsupported('Only string map keys are supported', loc);
    if (Object.hasOwn(fields, key)) return fields[key];
    // A std enum member that wonky does not declare (queries.mjs) is a gap, not undefined.
    if (fields[STD_ENUM_UNIMPLEMENTED]?.includes(key)) unsupported(`${Object.values(fields)[0].enumType}.${key} is not implemented`, loc);
    return undefined;
  }
  memberless(value, 'Member access', loc);
}
// The items of an array value and the { key, value } rows of a map value, for
// for-in and size (see member()).
function iterationRows(values, loc) {
  const items = values instanceof Vector ? values.items : values instanceof Id ? values.parts : Array.isArray(values) ? values : null;
  if (items) return items.map((item, index) => [index, item, item]);
  const fields = (isMap(values) && !isFunctionValue(values)) || values instanceof KeyedMap ? values : stdMapView(values);
  if (fields) return mapEntries(fields, loc).map(([key, value]) => [key, value, map({ key, value })]);
  memberless(values, 'for-in', loc);
}
// A try catches FeatureScript exceptions only (errors.mjs catchable). Catching
// one completes the std defineFeature contract (feature.fs:53-83): every
// sub-feature the exception left was aborted with @abortFeature, so its
// modeling changes are rolled back before the handler runs. invoke() records
// the rollbacks on the exception; an uncaught exception keeps them unapplied,
// so the report of a failed build shows the state at the failure.
function caught(error) {
  if (!catchable(error)) return false;
  const rollbacks = error.rollbacks ?? [];
  error.rollbacks = [];
  for (const rollback of rollbacks) rollback(); // innermost first; the outermost sub-feature's state wins
  return true;
}
// The members map of the enum declaration `type` visible from env (an enum in
// the input or a std enum wonky declares), or null.
function enumMembers(type, env) {
  let scope = env;
  while (scope && !scope.bindings.has(type)) scope = scope.parent;
  const members = scope?.bindings.get(type).value, values = isMap(members) ? Object.values(members) : [];
  return values.length && values.every(value => value instanceof EnumValue && value.enumType === type) ? members : null;
}

export class Environment {
  constructor(parent = null) { this.parent = parent; this.bindings = new Map(); this.namespaces = new Map(); }
  declare(name, value, constant = true, type = null, loc) {
    if (this.bindings.has(name)) fail(`Duplicate declaration '${name}'`, loc);
    // Runtime values are immutable. Member assignment copies the changed path
    // in updateValue; bindings and arguments can safely share unchanged values.
    this.bindings.set(name, { value: checkType(value, type, loc), constant, type });
  }
  lookup(name, loc) {
    if (this.bindings.has(name)) return this.bindings.get(name);
    if (this.parent) return this.parent.lookup(name, loc);
    const [namespace] = name.split('::');
    if (this.namespaces.has(namespace)) {
      const spec = this.namespaces.get(namespace);
      unsupported(`Unresolved Onshape module '${namespace}': ${spec.path} at version ${spec.version}. Supply its frozen source or B-rep snapshot.`, loc);
    }
    unsupported(`'${name}' is not defined or not implemented by this prototype`, loc);
  }
  get(name, loc) { return this.lookup(name, loc).value; }
  set(name, value, loc) {
    const binding = this.lookup(name, loc);
    if (binding.constant) fail(`Cannot assign to constant '${name}'`, loc);
    binding.value = checkType(value, binding.type, loc);
  }
}
class ReturnValue { constructor(value) { this.value = value; } }
class LoopControl { constructor(kind) { this.kind = kind; } }
class FunctionValue {
  constructor(ast, env) { this.type = 'function'; this.ast = ast; this.env = env; }
}

export class Interpreter {
  constructor(builtins, { maxSteps = 20000000, moduleResolver, callObserver } = {}) {
    if (!Number.isSafeInteger(maxSteps) || maxSteps < 1) fail('maxSteps must be a positive safe integer');
    this.global = new Environment(); this.steps = 0; this.maxSteps = maxSteps; this.depth = 0;
    this.moduleResolver = moduleResolver;
    this.callObserver = callObserver; this.callStack = [];
    for (const [name, value] of Object.entries(builtins)) this.global.declare(name, value);
  }
  tick(loc) { if (++this.steps > this.maxSteps) fail(`Execution limit exceeded (${this.maxSteps} expression/statement steps)`, loc); }
  run(program, name, context, id, definition) {
    const supportedImports = new Set(['geometry', 'common', 'primitives', 'sketch', 'query', 'units', 'valueBounds', 'vector', 'plane', 'feature', 'instantiator']);
    for (const item of program.imports) {
      if (item.namespace) {
        this.global.namespaces.set(item.namespace, item);
        const exports = this.moduleResolver?.(item);
        if (exports) for (const [name, value] of Object.entries(exports)) this.global.declare(`${item.namespace}::${name}`, value);
        continue;
      }
      if (Object.keys(item).some(k => !['path', 'version', 'namespace'].includes(k)) || typeof item.version !== 'string' || !/^\d+\.0$/.test(item.version)) fail('Expected standard-library import with a numeric version such as "3000.0"');
      const match = item.path?.match(/^onshape\/std\/([A-Za-z]+)\.fs$/);
      if (!match || !supportedImports.has(match[1])) unsupported(`Import '${item.path}' is not supported; only the documented local standard-library subset is available`);
    }
    if (!program.imports.length) fail('Import onshape/std/geometry.fs to use the local modeling library');
    for (const declaration of program.declarations) this.statement(declaration, this.global);
    const exports = program.declarations.filter(d => d.exported && matchesType(this.global.get(d.name), 'function')).map(d => d.name);
    const selected = name ?? (exports.length === 1 ? exports[0] : exports.includes('main') ? 'main' : null);
    if (!selected || !exports.includes(selected)) fail(`Choose an exported feature with --feature. Available: ${exports.join(', ') || '(none)'}`);
    const entry = this.global.get(selected);
    const { declared, implied } = this.featureDefaults(entry);
    const supplied = typeof definition === 'function' ? definition() : definition;
    // The definition of a feature created in the Part Studio: every dialog
    // parameter has its dialog default, weakest first type-implied < declared
    // ("Default" annotation, bound spec) < supplied parameters. The
    // defineFeature defaults map (merged in invoke) only fills keys that are
    // still missing. std feature.fs defineFeature: the defaults map is "for when
    // this feature is called in FeatureScript" and "does NOT control the
    // user-visible default value when creating this feature"; std merges it
    // under the definition (mergeDefaultsAndCleanFailed: mergeMaps(defaults, definition)).
    this.call(entry, [context, id, map({ ...implied, ...declared, ...supplied })], null);
    return selected;
  }
  // The feature dialog of an exported feature, read from its precondition the
  // way Onshape builds it, including parameters inside precondition if-blocks.
  // Returns two maps:
  // - declared: the annotation "Default" entry, then (winning) the default of a
  //   isLength/isAngle/isInteger/isReal bound spec (valueBounds.fs);
  // - implied: the std dialog default of a parameter type when no "Default"
  //   annotation or bound spec gives one: false for a boolean, "" for a
  //   string, the first member of an enum. It beats the defineFeature
  //   defaults map, which does not set dialog defaults (see run()). feature.fs,
  //   defineFeature: 'To change the
  //   user-visible default for booleans, enums, and strings, use the "Default"
  //   annotation. To change the user-visible default for a length, angle, or
  //   number, see the valueBounds module.'
  //   A Query parameter is the user's pick in the Part Studio. wonky has no
  //   pick, so an unsupplied one becomes a 'uiSelection' query: a feature that
  //   never reads it still builds, and resolving it raises a capability error
  //   instead of standing in an empty selection for Marc's real pick
  //   (docs/corpus/cluster-fs-interpreter-semantics.md §3, decision (a)).
  //   Supply it with --param (e.g. 'part=qNothing()') or a Part Studio input.
  // Annotations are UI metadata and are not evaluated at regeneration. Only the
  // "Default" entry is evaluated; "Filter" (query-filter notation such as
  // EntityType.BODY && BodyType.SOLID, as in std extrude.fs), "UIHint" and the
  // rest stay unevaluated.
  featureDefaults(entry) {
    const declared = map({}), implied = map({});
    if (entry?.type !== 'feature' || !entry.fn.ast.precondition) return { declared, implied };
    const env = entry.fn.env, param = entry.fn.ast.params[2]?.name;
    const visit = statement => {
      if (!statement) return;
      if (statement.kind === 'block') { statement.statements.forEach(visit); return; }
      if (statement.kind === 'if') { visit(statement.yes); visit(statement.no); return; }
      if (statement.kind !== 'expression') return;
      const expression = statement.value;
      const target = expression.kind === 'type' ? expression.value : expression.kind === 'call' ? expression.args[0] : null;
      if (target?.kind !== 'access' || target.value.kind !== 'name' || target.value.name !== param || target.key.kind !== 'literal') return;
      const key = target.key.value;
      for (const annotation of statement.annotations ?? []) {
        const field = annotation.kind === 'map' && annotation.fields.find(([k]) => k.kind === 'literal' && k.value === 'Default');
        if (field) declared[key] = this.expression(field[1], env);
      }
      if (expression.kind === 'call' && expression.callee.kind === 'name' && BOUND_PREDICATES.includes(expression.callee.name) && expression.args.length === 2) {
        const bounds = resolveBoundSpec(this.expression(expression.args[1], env));
        if (bounds) declared[key] = boundSpecDefault(bounds, expression.loc);
      } else if (expression.kind === 'type' && expression.operator === 'is') {
        const value = this.dialogDefault(expression.type, key, env);
        if (value !== undefined) implied[key] = value;
      }
    };
    visit(entry.fn.ast.precondition);
    return { declared, implied };
  }
  dialogDefault(type, key, env) {
    if (type === 'boolean') return false;
    if (type === 'string') return '';
    if (type === 'Query') return new TopologyQuery('uiSelection', { parameter: key });
    const members = enumMembers(type, env);
    return members ? Object.values(members)[0] : undefined;
  }
  expression(node, env = this.global) {
    this.tick(node.loc);
    const evaluate = n => this.expression(n, env);
    switch (node.kind) {
      case 'literal': return node.value;
      case 'name': return env.get(node.name, node.loc);
      case 'array': return node.items.map(evaluate);
      case 'map': {
        const entries = [];
        for (const [keyExpr, expr] of node.fields) {
          const key = evaluate(keyExpr);
          if (entries.some(([k]) => equal(k, key))) fail('Duplicate map key', node.loc);
          entries.push([key, evaluate(expr)]);
        }
        return entries.every(([k]) => typeof k === 'string') ? map(Object.fromEntries(entries)) : new KeyedMap(entries);
      }
      case 'unary': return node.operator === '!' ? !truth(evaluate(node.value), node.loc) : binary('*', -1, evaluate(node.value), node.loc);
      case 'binary': {
        const a = evaluate(node.left);
        if (node.operator === '&&') return truth(a, node.loc) ? truth(evaluate(node.right), node.loc) : false;
        if (node.operator === '||') return truth(a, node.loc) ? true : truth(evaluate(node.right), node.loc);
        return binary(node.operator, a, evaluate(node.right), node.loc);
      }
      case 'conditional': return evaluate(truth(evaluate(node.condition), node.loc) ? node.yes : node.no);
      case 'access': return member(evaluate(node.value), evaluate(node.key), node.loc);
      case 'type': {
        const value = evaluate(node.value);
        if (node.operator === 'is') return matchesType(value, node.type, node.loc);
        return cast(value, node.type, node.loc, typeof value === 'string' || value instanceof EnumValue ? enumMembers(node.type, env) : null);
      }
      case 'function': return new FunctionValue(node, env);
      case 'tryExpression': {
        try { return evaluate(node.value); }
        catch (error) { if (caught(error)) return undefined; throw error; }
      }
      case 'call': return this.call(evaluate(node.callee), node.args.map(evaluate), node.loc);
      default: fail(`Unsupported expression ${node.kind}`, node.loc);
    }
  }
  call(fn, args, loc) {
    if(!this.callObserver||(fn?.type==='builtin'&&this.callObserver.watches&&!this.callObserver.watches(fn)))return this.invoke(fn,args,loc);
    const frame={fn,args,loc};this.callStack.push(frame);
    let token, result, error;
    try {
      token=this.callObserver.enter({fn,args,loc,stack:this.callStack});
      result=this.invoke(fn,args,loc);
      return result;
    } catch(caught){error=caught;throw caught;}
    finally {try{this.callObserver.leave(token,{result,error});}finally{this.callStack.pop();}}
  }
  invoke(fn, args, loc) {
    if (fn?.type === 'builtin') {
      // A builtin is wonky's implementation of a std function, which may have
      // overloads wonky does not implement (query.fs qUnion(query1, query2)). An
      // arity outside the implemented ones is a capability gap, never an exception.
      if (args.length < fn.min || args.length > fn.max) unsupported(`${fn.name} with ${args.length} argument${args.length === 1 ? '' : 's'} is not implemented (wonky implements ${fn.min === fn.max ? fn.min : `${fn.min}–${fn.max}`})`, loc);
      return fn.call(args, loc, this);
    }
    if (fn?.type === 'feature') {
      if (args.length !== 3 || !isMap(args[2])) raise('Feature calls require context, id, and definition map', loc);
      // std feature.fs:53-83 defineFeature: a feature that throws is aborted
      // (@abortFeature rolls back its changes to the context) and, called from
      // another feature, the exception is rethrown. The rollback is applied when
      // a try catches the exception (see caught()).
      const engine = args[0]?.engine, snapshot = engine?.context === args[0] && typeof engine.snapshot === 'function' ? engine.snapshot() : null;
      try { return this.call(fn.fn, [args[0], args[1], map({ ...fn.defaults, ...args[2] })], loc); }
      catch (error) {
        if (snapshot && catchable(error)) (error.rollbacks ??= []).push(() => engine.restore(snapshot));
        throw error;
      }
    }
    if (fn?.type !== 'function') raise('Value is not a callable function', loc);
    if (args.length !== fn.ast.params.length) raise(`Function expects ${fn.ast.params.length} arguments`, loc);
    if (++this.depth > 64) fail('Function call depth exceeded (64)', loc);
    const env = new Environment(fn.env);
    fn.ast.params.forEach((p, i) => env.declare(p.name, args[i], false, p.type, loc));
    try {
      if (fn.ast.precondition) this.statement(fn.ast.precondition, env, true);
      this.statement(fn.ast.body, env);
      return checkType(undefined, fn.ast.returnType, loc);
    } catch (error) {
      if (error instanceof ReturnValue) return checkType(error.value, fn.ast.returnType, loc);
      throw error;
    } finally { this.depth--; }
  }
  statement(node, env, precondition = false) {
    this.tick(node.loc);
    switch (node.kind) {
      case 'empty': break;
      case 'enum': {
        const members = map({});
        for (const member of node.members) {
          if (Object.hasOwn(members, member.name)) fail(`Duplicate enum member '${member.name}'`, node.loc);
          members[member.name] = new EnumValue(node.name, member.name);
        }
        env.declare(node.name, members, true, null, node.loc); break;
      }
      case 'block': {
        const scope = new Environment(env);
        for (const statement of node.statements) this.statement(statement, scope, precondition);
        break;
      }
      case 'declaration': env.declare(node.name, node.value ? this.expression(node.value, env) : undefined, node.constant, node.type, node.loc); break;
      case 'expression': {
        const value = this.expression(node.value, env);
        if (precondition && value !== true) raise('Feature precondition failed', node.loc);
        break;
      }
      case 'return': throw new ReturnValue(node.value ? this.expression(node.value, env) : undefined);
      case 'break': case 'continue': throw new LoopControl(node.kind);
      case 'throw': {
        const value = this.expression(node.value, env);
        if (value instanceof FeatureScriptException) throw value;
        // Any value can be thrown (FsDoc exceptions.html), a map or undefined
        // included; the catch variable binds exactly that value.
        const error = new FeatureScriptException(display(value), node.loc); error.value = value; throw error;
      }
      case 'try': {
        try { this.statement(node.body, env, precondition); }
        catch (error) {
          if (!caught(error)) throw error;
          const scope = new Environment(env);
          if (node.name != null) scope.declare(node.name, Object.hasOwn(error, 'value') ? error.value : error, false); // 'catch { }' binds nothing
          this.statement(node.handler, scope, precondition);
        }
        break;
      }
      case 'if': {
        const branch = truth(this.expression(node.condition, env), node.loc) ? node.yes : node.no;
        if (branch) this.statement(branch, new Environment(env), precondition);
        break;
      }
      case 'for': {
        // FsDoc: 'for (var v in x)' binds each array item, or a { key, value }
        // map per map entry; 'for (var k, v in x)' binds the index or key to k.
        const rows = iterationRows(this.expression(node.values, env), node.loc);
        for (const [key, value, item] of rows) {
          const scope = new Environment(env);
          if (node.key != null) { scope.declare(node.key, key, false); scope.declare(node.name, value, false); }
          else scope.declare(node.name, item, false);
          try { this.statement(node.body, scope, precondition); }
          catch (control) {
            if (!(control instanceof LoopControl)) throw control;
            if (control.kind === 'break') break;
          }
        }
        break;
      }
      case 'forC': case 'while': {
        const scope = new Environment(env);
        if (node.initial) this.statement(node.initial, scope, precondition);
        while (truth(this.expression(node.condition, scope), node.loc)) {
          try { this.statement(node.body, new Environment(scope), precondition); }
          catch (control) {
            if (!(control instanceof LoopControl)) throw control;
            if (control.kind === 'break') break;
          }
          if (node.increment) this.statement(node.increment, scope, precondition);
        }
        break;
      }
      case 'assign': {
        const keys = []; let target = node.target;
        while (target.kind === 'access') { keys.unshift(this.expression(target.key, env)); target = target.value; }
        if (target.kind !== 'name') fail('Assignment must be rooted in a variable', node.loc);
        const root = env.get(target.name, node.loc);
        let value = this.expression(node.value, env);
        if (node.operator !== '=') value = binary(node.operator[0], this.expression(node.target, env), value, node.loc);
        env.set(target.name, this.updateValue(root, keys, value, node.loc), node.loc); break;
      }
      default: fail(`Unsupported statement ${node.kind}`, node.loc);
    }
  }
  updateValue(container, keys, value, loc) {
    if (!keys.length) return value;
    const [key, ...rest] = keys;
    if (container instanceof Vector) return new Vector(this.updateValue(container.items, keys, value, loc));
    if (Array.isArray(container)) {
      if (!Number.isInteger(key) || key < 0 || key >= container.length) raise('Array assignment index is out of bounds', loc);
      const result = [...container]; result[key] = this.updateValue(result[key], rest, value, loc); return result;
    }
    if (isMap(container)) {
      if (typeof key !== 'string') unsupported('Assigning a non-string map key is not implemented', loc);
      // FsDoc variables.html: "setting the value to undefined removes the element from the map".
      const result = retag(container, map(container)), updated = this.updateValue(result[key], rest, value, loc);
      if (updated === undefined) delete result[key]; else result[key] = updated;
      return result;
    }
    if (container instanceof KeyedMap) unsupported('Assigning into a map with non-string keys is not implemented', loc);
    memberless(container, 'Member assignment', loc);
  }
}
