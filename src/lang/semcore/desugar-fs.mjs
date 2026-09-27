// FeatureScript (wonky's parsed subset, src/parser.mjs AST) -> WCore/0 IR.
//
// The translation removes every imperative construct:
// - `var`/`const`/parameters become immutable `let` bindings; an assignment
//   (including member paths `a.b[i] = v` and `+=`) creates a new binding of an
//   updated *value* (FS value semantics make this exact);
// - control flow joins (after if/else, loop exits) become join-point
//   functions that receive the current values of all mutable variables;
// - loops become recursive join points (`letrec`), `break`/`continue` calls of
//   the exit/next join point, `return e` simply the value e in tail position;
// - `try { } catch` reifies how its body left (#N normal, #R return, #B break,
//   #C continue) so that exceptions raised *after* the try are not caught;
// - preconditions become explicit checks, typed declarations type checks.
// Names that are not local stay late-bound globals (`glob`), so undefined
// names fail when evaluated, exactly where the reference interpreter fails.
//
// Deliberate semantic choice (see docs/language/semantic-core.md): a lambda
// captures the *values* of the locals it references when it is created. The
// reference interpreter captures live bindings instead; the difference is
// observable only if a captured variable is reassigned after the lambda was
// created (or assigned from inside the lambda).
import { SpanTable } from './ir.mjs';

export class DesugarError extends Error {
  constructor(message, loc) { super(`${message}${loc ? ` at ${loc.line}:${loc.column}` : ''}`); this.name = 'DesugarError'; this.line = loc?.line; this.column = loc?.column; }
}

// Translation-time environment: an array of scopes mirroring the reference
// interpreter's Environment chain; each maps an FS name to its current core
// name plus mutability/type. Updates copy (the environment is persistent).
const lookup = (env, name) => {
  for (let i = env.length - 1; i >= 0; i--) if (env[i].has(name)) return { index: i, entry: env[i].get(name) };
  return null;
};
const push = env => [...env, new Map()];
const upTo = (env, length) => env.slice(0, length);
const setIn = (env, index, name, entry) => { const copy = [...env]; copy[index] = new Map(copy[index]); copy[index].set(name, entry); return copy; };
const mutables = env => env.flatMap((scope, index) => [...scope].filter(([, e]) => e.mutable).map(([name]) => [index, name]));
// Only variables assigned inside a construct need to flow through its join
// points; all others keep the value captured where the join point is defined.
// Assignments inside nested lambdas rebind lambda-local copies and are not
// statements of this construct, so expressions are not searched.
function assignedNames(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  switch (node.kind) {
    case 'assign': { let t = node.target; while (t.kind === 'access') t = t.value; if (t.kind === 'name') out.add(t.name); break; }
    case 'block': node.statements.forEach(n => assignedNames(n, out)); break;
    case 'if': assignedNames(node.yes, out); assignedNames(node.no, out); break;
    case 'for': assignedNames(node.body, out); break;
    case 'forC': case 'while': assignedNames(node.initial, out); assignedNames(node.increment, out); assignedNames(node.body, out); break;
    case 'try': assignedNames(node.body, out); assignedNames(node.handler, out); break;
    default: break;
  }
  return out;
}
const assignedIn = (env, nodes) => {
  const names = new Set(); for (const n of nodes) assignedNames(n, names);
  return mutables(env).filter(([, name]) => names.has(name));
};
const STRAIGHT = new Set(['empty', 'declaration', 'expression', 'assign']);
const wrap = (binders, body) => binders.reduceRight((acc, [kind, name, value]) => kind === 'letrec' ? ['letrec', [[name, value]], acc] : ['let', name, value, acc], body);
const argsOf = (env, muts) => muts.map(([i, name]) => ['var', env[i].get(name).core]);

class Desugarer {
  constructor(spans = new SpanTable()) { this.spans = spans; this.counter = 0; }
  fresh(base) { return `${String(base).replace(/[^A-Za-z0-9_:]/g, '_')}.${this.counter++}`; }
  span(loc) { return this.spans.add(loc); }
  rebindAll(env, muts, names) {
    let out = env;
    muts.forEach(([i, name], k) => { out = setIn(out, i, name, { ...out[i].get(name), core: names[k] }); });
    return out;
  }
  // A join point: a non-recursive local function whose parameters are the
  // current values of `muts`, and whose body is `body(envWithParams)`.
  join(env, muts, label, body) {
    const params = muts.map(([, name]) => this.fresh(name));
    return ['fn', params, body(this.rebindAll(env, muts, params)), { join: true, label }];
  }

  program(ast) {
    const globals = [];
    for (const decl of ast.declarations) {
      const span = this.span(decl.loc);
      if (decl.kind === 'enum') {
        globals.push({ name: decl.name, kind: 'enum', exported: !!decl.exported, span,
          value: ['prim', 'enum', [['lit', decl.name], ['list', decl.members.map(m => ['lit', m.name])]], span] });
      } else if (decl.kind === 'declaration') {
        const value = decl.value?.kind === 'function' ? this.fn(decl.value, [], decl.name) : decl.value ? this.expr(decl.value, []) : ['undef'];
        globals.push({ name: decl.name, kind: decl.value?.kind === 'function' ? 'function' : 'const', exported: !!decl.exported, span, value });
      } else throw new DesugarError(`Unexpected top-level ${decl.kind}`, decl.loc);
    }
    return { schema: 'wonky-core/0', language: 'FeatureScript', version: ast.version, imports: ast.imports, globals, spans: this.spans };
  }

  fn(node, env, name = null) {
    const span = this.span(node.loc);
    const params = node.params.map(p => this.fresh(p.name));
    const scope = new Map();
    const checks = [];
    node.params.forEach((p, i) => {
      scope.set(p.name, { core: params[i], mutable: true, type: p.type });
      if (p.type) checks.push(['prim', 'check-type', [['var', params[i]], ['lit', p.type]], span]);
    });
    const envF = [...env, scope];
    const typed = v => node.returnType ? ['prim', 'check-type', [v, ['lit', node.returnType]], span] : v;
    const ctx = { ret: (e, v) => typed(v), brk: null, cont: null, precondition: false };
    const end = () => typed(['undef']);
    let body = node.precondition
      ? this.stmt(node.precondition, envF, { ...ctx, precondition: true }, e => this.stmt(node.body, e, ctx, end))
      : this.stmt(node.body, envF, ctx, end);
    for (const check of checks.reverse()) body = ['let', this.fresh('_param'), check, body];
    return ['fn', params, body, { span, name, arity: params.length, defaults: this.featureDefaults(node, env) }];
  }

  // Mirrors Interpreter.featureDefaults: annotation "Default" values and the
  // default of an isLength(definition.key, bounds) row, evaluated at run time
  // in the closure's defining environment.
  featureDefaults(node, env) {
    if (!node.precondition) return null;
    const rows = [];
    for (const statement of node.precondition.statements) {
      if (statement.kind !== 'expression') continue;
      const e = statement.value;
      const target = e.kind === 'type' ? e.value : e.kind === 'call' ? e.args[0] : null;
      if (target?.kind !== 'access' || target.value.kind !== 'name' || target.value.name !== node.params[2]?.name || target.key.kind !== 'literal') continue;
      const bounds = e.kind === 'call' && e.callee.kind === 'name' && e.callee.name === 'isLength' && e.args.length === 2 ? this.expr(e.args[1], env) : null;
      rows.push({ key: target.key.value, annotations: (statement.annotations ?? []).map(a => this.expr(a, env)), bounds, span: this.span(e.loc) });
    }
    return rows.length ? rows : null;
  }

  // Straight-line statements are collected iteratively into let-binders, so
  // long blocks (generated FS has >1,600 statements in one block) do not
  // recurse; only control statements nest their continuation.
  stmts(list, i, env, ctx, k) {
    const binders = [];
    for (; i < list.length; i++) {
      const r = this.straight(list[i], env, ctx);
      if (!r) break;
      binders.push(...r.binders);
      if (r.terminal) return wrap(binders, r.terminal);
      env = r.env;
    }
    const j = i;
    return wrap(binders, j < list.length ? this.stmt(list[j], env, ctx, e => this.stmts(list, j + 1, e, ctx, k)) : k(env));
  }

  declare(env, node, core, mutable, type) {
    const top = env.length - 1;
    return setIn(env, top, node.name, { core, mutable, type });
  }

  // Statements without control flow: returns {binders, env} or {binders, terminal}.
  straight(node, env, ctx) {
    if (!STRAIGHT.has(node.kind)) return null;
    const span = this.span(node.loc);
    switch (node.kind) {
      case 'empty': return { binders: [], env };
      case 'declaration': {
        const duplicate = env[env.length - 1].has(node.name);
        const core = this.fresh(node.name);
        if (!duplicate && node.value?.kind === 'function') {
          // `const f = function (...) { ... f(...) ... }`: recursive local
          // function, bound before its body is translated.
          const env2 = this.declare(env, node, core, !node.constant, node.type);
          const binders = [['letrec', core, this.fn(node.value, env2, node.name)]];
          if (node.type) binders.push(['let', this.fresh('_type'), ['prim', 'check-type', [['var', core], ['lit', node.type]], span]]);
          return { binders, env: env2 };
        }
        let value = node.value ? this.expr(node.value, env) : ['undef'];
        if (duplicate) return { binders: [['let', this.fresh('_dup'), value]], terminal: ['prim', 'fail', [['lit', `Duplicate declaration '${node.name}'`]], span] };
        if (node.type) value = ['prim', 'check-type', [value, ['lit', node.type]], span];
        return { binders: [['let', core, value]], env: this.declare(env, node, core, !node.constant, node.type) };
      }
      case 'expression': {
        const value = this.expr(node.value, env);
        return { binders: [['let', this.fresh('_'), ctx.precondition ? ['prim', 'precondition', [value], span] : value]], env };
      }
      case 'assign': return this.assign(node, env, span);
      default: return null;
    }
  }

  stmt(node, env, ctx, k) {
    const simple = this.straight(node, env, ctx);
    if (simple) return wrap(simple.binders, simple.terminal ?? k(simple.env));
    const span = this.span(node.loc);
    switch (node.kind) {
      case 'block': {
        const depth = env.length;
        return this.stmts(node.statements, 0, push(env), ctx, e => k(upTo(e, depth)));
      }
      case 'return': return ctx.ret(env, node.value ? this.expr(node.value, env) : ['undef']);
      case 'break': case 'continue': {
        const exit = node.kind === 'break' ? ctx.brk : ctx.cont;
        return exit ? exit(env) : ['prim', 'loop-control-outside-loop', [['lit', node.kind]], span];
      }
      case 'throw': return ['raise', this.expr(node.value, env), span];
      case 'try': return this.tryStatement(node, env, ctx, k, span);
      case 'if': {
        const muts = assignedIn(env, [node.yes, node.no]);
        const j = this.fresh('join');
        const joinFn = this.join(env, muts, 'if', e => k(e));
        const toJoin = e => ['call', ['var', j], argsOf(e, muts), -1];
        const depth = env.length;
        const yes = this.stmt(node.yes, push(env), ctx, e => toJoin(upTo(e, depth)));
        const no = node.no ? this.stmt(node.no, push(env), ctx, e => toJoin(upTo(e, depth))) : toJoin(env);
        return ['let', j, joinFn, ['if', this.expr(node.condition, env), yes, no, span]];
      }
      case 'for': return this.forIn(node, env, ctx, k, span);
      case 'forC': case 'while': return this.loop(node, env, ctx, k, span);
      default: throw new DesugarError(`Unsupported statement ${node.kind}`, node.loc);
    }
  }

  tryStatement(node, env, ctx, k, span) {
    const muts = assignedIn(env, [node.body, node.handler]);
    const reified = {
      ret: (e, v) => ['ctor', 'R', [v]],
      brk: ctx.brk ? e => ['ctor', 'B', argsOf(e, muts)] : null,
      cont: ctx.cont ? e => ['ctor', 'C', argsOf(e, muts)] : null,
      precondition: ctx.precondition,
    };
    const depth = env.length;
    const normal = e => ['ctor', 'N', argsOf(upTo(e, depth), muts)];
    const body = this.stmt(node.body, env, reified, normal);
    const errCore = this.fresh(node.name);
    const handlerEnv = setIn(push(env), depth, node.name, { core: errCore, mutable: true, type: null });
    const handler = this.stmt(node.handler, handlerEnv, reified, normal);
    const result = this.fresh('try');
    const arm = (tag, build) => { const names = muts.map(([, n]) => this.fresh(n)); return [tag, [names, build(this.rebindAll(env, muts, names))]]; };
    const arms = [arm('N', k)];
    const value = this.fresh('ret');
    arms.push(['R', [[value], ctx.ret(env, ['var', value])]]);
    if (ctx.brk) arms.push(arm('B', ctx.brk));
    if (ctx.cont) arms.push(arm('C', ctx.cont));
    return ['let', result, ['handle', body, errCore, handler, { silent: false, span }], ['case', ['var', result], Object.fromEntries(arms)]];
  }

  forIn(node, env, ctx, k, span) {
    const muts = assignedIn(env, [node.body]);
    const items = this.fresh('items'), loop = this.fresh('forIn'), after = this.fresh('after'), i = this.fresh('i');
    const afterFn = this.join(env, muts, 'for-exit', k);
    const loopParams = muts.map(([, n]) => this.fresh(n));
    const envL = this.rebindAll(env, muts, loopParams);
    const next = ['prim', '+', [['var', i], ['lit', 1]], -1];
    const callLoop = e => ['call', ['var', loop], [next, ...argsOf(e, muts)], -1];
    const callAfter = e => ['call', ['var', after], argsOf(e, muts), -1];
    const item = this.fresh(node.name);
    const envB = setIn(push(envL), envL.length, node.name, { core: item, mutable: true, type: null });
    const body = this.stmt(node.body, envB, { ...ctx, brk: callAfter, cont: callLoop }, callLoop);
    const loopFn = ['fn', [i, ...loopParams], ['if', ['prim', '<', [['var', i], ['prim', 'size-of', [['var', items]], -1]], -1],
      ['let', item, ['prim', 'index', [['var', items], ['var', i]], span], body], callAfter(envL), span], { join: true, label: 'for-in' }];
    return ['let', items, ['prim', 'iter-array', [this.expr(node.values, env)], span],
      ['let', after, afterFn, ['letrec', [[loop, loopFn]], ['call', ['var', loop], [['lit', 0], ...argsOf(env, muts)], -1]]]];
  }

  loop(node, env, ctx, k, span) {
    const outer = assignedIn(env, [node.initial, node.increment, node.body]);
    const after = this.fresh('after'), loop = this.fresh('loop'), next = this.fresh('next');
    const afterFn = this.join(env, outer, 'loop-exit', k);
    const callAfter = e => ['call', ['var', after], argsOf(e, outer), -1];
    const start = envInit => {
      const muts = assignedIn(envInit, [node.increment, node.body]), inner = envInit.length;
      const call = (fn, e) => ['call', ['var', fn], argsOf(upTo(e, inner), muts), -1];
      const loopFn = this.join(envInit, muts, 'loop', envL => ['if', this.expr(node.condition, envL),
        this.stmt(node.body, push(envL), { ...ctx, brk: callAfter, cont: e => call(next, e) }, e => call(next, e)),
        callAfter(envL), span]);
      const nextFn = this.join(envInit, muts, 'loop-next', envN => node.increment
        ? this.stmt(node.increment, envN, { ...ctx, brk: null, cont: null }, e => call(loop, e))
        : call(loop, envN));
      return ['let', after, afterFn, ['letrec', [[loop, loopFn], [next, nextFn]], call(loop, envInit)]];
    };
    const envS = push(env);
    // The init scope is dropped by `after`, which only receives outer variables.
    return node.initial ? this.stmt(node.initial, envS, { ...ctx, brk: null, cont: null }, start) : start(envS);
  }

  // Evaluation order of the reference interpreter: keys (last first), root,
  // value, then the target again for compound assignment.
  assign(node, env, span) {
    const keys = []; let target = node.target;
    while (target.kind === 'access') { keys.unshift(target.key); target = target.value; }
    if (target.kind !== 'name') return { binders: [], terminal: ['prim', 'fail', [['lit', 'Assignment must be rooted in a variable']], span] };
    const found = lookup(env, target.name);
    const keyNames = keys.map(() => this.fresh('key'));
    const binders = keys.map((key, i) => ['let', keyNames[i], this.expr(key, env)]).reverse();
    const constant = ['prim', 'fail', [['lit', `Cannot assign to constant '${target.name}'`]], span];
    const rhs = this.fresh('rhs');
    if (!found) {
      // A global exists (constant) or the lookup fails as a capability error, like Environment.set.
      binders.push(['let', this.fresh('_root'), ['prim', 'assign-global', [['lit', target.name]], span]], ['let', rhs, this.expr(node.value, env)]);
      return { binders, terminal: constant };
    }
    binders.push(['let', rhs, this.expr(node.value, env)]);
    let value = ['var', rhs];
    if (node.operator !== '=') {
      const current = this.fresh('cur');
      binders.push(['let', current, this.expr(node.target, env)]);
      value = ['prim', node.operator[0], [['var', current], ['var', rhs]], span];
    }
    const { index, entry } = found;
    if (!entry.mutable) return { binders, terminal: constant };
    const updated = keys.length ? ['prim', 'update', [['var', entry.core], ['list', keyNames.map(n => ['var', n])], value], span] : value;
    const core = this.fresh(target.name);
    binders.push(['let', core, entry.type ? ['prim', 'check-type', [updated, ['lit', entry.type]], span] : updated]);
    return { binders, env: setIn(env, index, target.name, { ...entry, core }) };
  }

  expr(node, env) {
    const span = this.span(node.loc);
    switch (node.kind) {
      case 'literal': return node.value === undefined ? ['undef'] : ['lit', node.value];
      case 'name': {
        const found = lookup(env, node.name);
        return found ? ['var', found.entry.core] : ['glob', node.name, span];
      }
      case 'array': return ['list', node.items.map(n => this.expr(n, env))];
      case 'map': return ['map', node.fields.map(([key, value]) => [this.expr(key, env), this.expr(value, env)]), span];
      case 'unary': return ['prim', node.operator === '!' ? 'not' : 'neg', [this.expr(node.value, env)], span];
      case 'binary': {
        const a = this.expr(node.left, env), b = this.expr(node.right, env);
        if (node.operator === '&&') return ['if', a, ['prim', 'truth', [b], span], ['lit', false], span];
        if (node.operator === '||') return ['if', a, ['lit', true], ['prim', 'truth', [b], span], span];
        return ['prim', node.operator, [a, b], span];
      }
      case 'conditional': return ['if', this.expr(node.condition, env), this.expr(node.yes, env), this.expr(node.no, env), span];
      case 'access': return ['prim', 'index', [this.expr(node.value, env), this.expr(node.key, env)], span];
      case 'type': return ['prim', node.operator, [this.expr(node.value, env), ['lit', node.type]], span];
      case 'function': return this.fn(node, env);
      case 'tryExpression': return ['handle', this.expr(node.value, env), this.fresh('_error'), ['undef'], { silent: node.silent, span }];
      case 'call': return ['call', this.expr(node.callee, env), node.args.map(a => this.expr(a, env)), span];
      default: throw new DesugarError(`Unsupported expression ${node.kind}`, node.loc);
    }
  }
}

export function desugarProgram(ast) { return new Desugarer().program(ast); }
export function desugarExpression(ast, spans) { return new Desugarer(spans).expr(ast, []); }
