// WPy host evaluator. Runs the value-level Python code of a WPy program with
// CPython semantics (see values.mjs) and turns every kernel-relevant value into
// a node of a pure operation graph (graph.mjs). Geometry is never computed
// here: shapes, sketches, selections and measures are lazy node references.
//
// A kernel result is read back ("sync point") only when Python control flow
// needs it: truthiness, loop bounds, string formatting, host iteration over
// entities. Arithmetic on measures, comparisons inside expect(...), geometric
// comprehension filters and empty-tolerant Booleans stay in the graph.
//
// Modes: with a backend, a sync point evaluates the needed cone right away.
// Without one ("preflight", Zoo-style mock execution), a sync point is recorded
// with its span and an explicit assumption, and evaluation continues.
//
// Stable ids: every node is named <call path>/<binding>[loop indices]/<op>[#n],
// where the call path is made of the callers' binding names and function names.
// Inserting an unrelated statement never renames a node (unlike python/N serials).

import { parse } from './parse.mjs';
import { checkModule } from './check.mjs';
import { Graph } from './graph.mjs';
import {
  WpyError, capability, modelError, PyList, PyTuple, PyDict, PySet, Builtin, BoundMethod, PyModule, PyExceptionType, PyException,
  isInt, isNumber, isSeq, keyOf, typeName, toFloat, toIntLike, arith, compareNumbers, floatRepr, strOf, reprOf, formatValue, pyRound,
} from './values.mjs';

// ------------------------------------------------------------------ kernel values
export class Shape {
  constructor(node, { empty = false } = {}) { this.node = node; this.empty = empty; this.meta = {}; }
  get typeName() { return 'Part'; }
}
export class Sketch { constructor(node, { empty = false } = {}) { this.node = node; this.empty = empty; } get typeName() { return 'Sketch'; } }
export class Curve { constructor(node) { this.node = node; } get typeName() { return 'Curve'; } }
export class EntitySet {
  constructor(node, owner, kind) { this.node = node; this.owner = owner; this.kind = kind; }
  get typeName() { return 'ShapeList'; }
}
export class EntityGroups { constructor(node, owner, kind) { this.node = node; this.owner = owner; this.kind = kind; } get typeName() { return 'GroupBy'; } }
export class Lazy { constructor(node, type) { this.node = node; this.type = type; } get typeName() { return `lazy ${this.type}`; } }
export class LazyVec { constructor(node, field) { this.node = node; this.field = field; } get typeName() { return 'lazy Vector'; } }
export class LazyBox { constructor(node) { this.node = node; } get typeName() { return 'lazy BoundBox'; } }
// Inert path value for main-block driver code: joins strings, never touches the file system.
export class PathV {
  constructor(p) { this.p = p; }
  get typeName() { return 'Path'; }
}
export class Compound { constructor(items) { this.items = items; } get typeName() { return 'Compound'; } }
export class Vec {
  constructor(x, y, z = 0) { this.x = x; this.y = y; this.z = z; }
  get typeName() { return 'Vector'; }
  hashKey() { return `v:${this.x},${this.y},${this.z}`; }
}
export class EnumV { constructor(type, name) { this.type = type; this.name = name; } get typeName() { return this.type; } hashKey() { return `e:${this.type}.${this.name}`; } }
export class PlaneV { constructor(origin, x, z) { this.origin = origin; this.x = x; this.z = z; } get typeName() { return 'Plane'; } }
export class Loc {
  constructor(rows, t) { this.rows = rows; this.t = t; }
  get typeName() { return 'Location'; }
  static translation(t) { return new Loc([[1, 0, 0], [0, 1, 0], [0, 0, 1]], t); }
  compose(o) { // this * o
    const R = this.rows, S = o.rows;
    const rows = [0, 1, 2].map(i => [0, 1, 2].map(j => R[i][0] * S[0][j] + R[i][1] * S[1][j] + R[i][2] * S[2][j]));
    const t = [0, 1, 2].map(i => R[i][0] * o.t[0] + R[i][1] * o.t[1] + R[i][2] * o.t[2] + this.t[i]);
    return new Loc(rows, t);
  }
  isTranslation() { return this.rows.every((r, i) => r.every((v, j) => v === (i === j ? 1 : 0))); }
}
// Symbolic entity used to lower comprehension filters to in-kernel predicates.
class SymEntity { constructor(kind) { this.kind = kind; } get typeName() { return 'Edge/Face (symbolic)'; } }
class SymMethod { constructor(name) { this.name = name; } }
class SymVec { constructor(path) { this.path = path; } }
class SymTerm { constructor(term) { this.term = term; } }
class SymPred { constructor(pred) { this.pred = pred; } }
class NotLowerable extends Error {}

const ALIGN = { MIN: 0, CENTER: 0.5, MAX: 1 };
const deg = Math.PI / 180;
const identityRows = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
// Angles arrive in radians (degrees * deg); quarter turns are made exact so
// Rot(0, 0, 180) is exactly diag(-1, -1, 1), as FeatureScript matrices usually are.
const quarter = a => { const q = a / (Math.PI / 2); return Math.abs(q - Math.round(q)) < 1e-12 ? ((Math.round(q) % 4) + 4) % 4 : -1; };
const cosE = a => { const q = quarter(a); return q < 0 ? Math.cos(a) : [1, 0, -1, 0][q]; };
const sinE = a => { const q = quarter(a); return q < 0 ? Math.sin(a) : [0, 1, 0, -1][q]; };
const rotX = a => [[1, 0, 0], [0, cosE(a), -sinE(a)], [0, sinE(a), cosE(a)]];
const rotY = a => [[cosE(a), 0, sinE(a)], [0, 1, 0], [-sinE(a), 0, cosE(a)]];
const rotZ = a => [[cosE(a), -sinE(a), 0], [sinE(a), cosE(a), 0], [0, 0, 1]];
const mul = (A, B) => [0, 1, 2].map(i => [0, 1, 2].map(j => A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j]));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (v, span) => { const n = Math.hypot(...v); if (!(n > 0)) modelError('zero-length direction', span, 'ValueError'); return v.map(x => x / n); };

// ------------------------------------------------------------------- functions & scopes
class PyFunction {
  constructor(name, params, body, env, span, { isLambda = false, node } = {}) {
    this.name = name; this.params = params; this.body = body; this.env = env; this.span = span; this.isLambda = isLambda; this.node = node;
  }
  get typeName() { return 'function'; }
}
class Env {
  constructor(parent, { fn = false, localNames = null, nonlocals = new Set(), globals = new Set() } = {}) {
    this.vars = new Map(); this.parent = parent; this.fn = fn; this.localNames = localNames; this.nonlocals = nonlocals; this.globals = globals;
  }
}
class ReturnSignal { constructor(value) { this.value = value; } }
class BreakSignal {}
class ContinueSignal {}

// Names bound in a function body (Python's static local analysis).
function analyzeLocals(fnNode) {
  if (fnNode._locals) return fnNode._locals;
  const locals = new Set(), nonlocals = new Set(), globals = new Set();
  const addTarget = t => {
    if (!t) return;
    if (t.k === 'Name') locals.add(t.id);
    else if (t.k === 'Tuple' || t.k === 'List') t.elts.forEach(addTarget);
    else if (t.k === 'Starred') addTarget(t.value);
  };
  const params = fnNode.params;
  for (const p of [...params.posonly, ...params.args, ...params.kwonly]) locals.add(p.name);
  if (params.vararg) locals.add(params.vararg.name);
  if (params.kwarg) locals.add(params.kwarg.name);
  const visit = stmts => {
    for (const s of stmts) {
      switch (s.k) {
        case 'Assign': s.targets.forEach(addTarget); break;
        case 'AugAssign': case 'AnnAssign': addTarget(s.target); break;
        case 'For': addTarget(s.target); visit(s.body); visit(s.orelse); break;
        case 'While': visit(s.body); visit(s.orelse); break;
        case 'If': visit(s.body); visit(s.orelse); break;
        case 'Try': visit(s.body); s.handlers.forEach(h => { if (h.name) locals.add(h.name); visit(h.body); }); visit(s.orelse); visit(s.finalbody); break;
        case 'With': s.items.forEach(i => addTarget(i.as)); visit(s.body); break;
        case 'FunctionDef': case 'ClassDef': locals.add(s.name); break;
        case 'Import': s.names.forEach(n => locals.add(n.asname ?? n.name.split('.')[0])); break;
        case 'ImportFrom': if (s.names !== '*') s.names.forEach(n => locals.add(n.asname ?? n.name)); break;
        case 'Nonlocal': s.names.forEach(n => nonlocals.add(n)); break;
        case 'Global': s.names.forEach(n => globals.add(n)); break;
        case 'Del': addTarget(s.targets); break;
      }
    }
  };
  if (Array.isArray(fnNode.body)) visit(fnNode.body);
  for (const n of [...nonlocals, ...globals]) locals.delete(n);
  fnNode._locals = { locals, nonlocals, globals };
  return fnNode._locals;
}

// ---------------------------------------------------------------------- evaluator
export class Evaluator {
  constructor({ file = '<wpy>', source = '', params = {}, backend = null, maxSteps = 5_000_000, maxDepth = 200, namespace = 'wpy' } = {}) {
    this.file = file; this.source = source; this.overrides = params; this.backend = backend;
    this.maxSteps = maxSteps; this.maxDepth = maxDepth; this.namespace = namespace;
    this.graph = new Graph({ file });
    this.steps = 0;
    this.frames = [{ path: [], stmt: null, loop: [], counters: new Map(), calls: new Map(), name: '<module>', span: null }];
    this.log = [];
    this.params = [];
    this.failedChecks = [];
    this.assumptions = [];
    this.module = new Env(null);
    this.builtins = this.makeBuiltins();
  }
  get frame() { return this.frames.at(-1); }
  tick(span) { if (++this.steps > this.maxSteps) throw new WpyError('resource', `step budget of ${this.maxSteps} exhausted`, span); }

  // ---- stable ids
  stmtLabel() {
    const f = this.frame;
    const label = f.stmt ?? '';
    return f.loop.length ? `${label}[${f.loop.join(',')}]` : label;
  }
  nodeId(op) {
    const f = this.frame;
    const label = this.stmtLabel();
    const key = `${label}|${op}`;
    const n = (f.counters.get(key) ?? 0) + 1;
    f.counters.set(key, n);
    return [...f.path, label, n > 1 ? `${op}#${n}` : op].filter(Boolean).join('/');
  }
  node(op, params, inputs, span, kind) {
    return this.graph.add(op, params, inputs, { id: this.nodeId(op), span, kind });
  }
  sync(v, span, reason) {
    this.graph.syncPoints.push({ span, reason, node: v?.node ?? null });
    if (this.backend) return this.backend.valueOf(this.graph, v.node, span);
    return undefined;
  }

  // ---- entry
  run(ast) {
    const checked = checkModule(ast);
    const reject = checked.findings.find(f => f.severity === 'reject' || f.severity === 'planned');
    if (reject) throw new WpyError('capability', `${reject.message} is not part of WPy v0`, reject.span, { hint: reject.hint });
    this.module.vars.set('__name__', '__main__');
    this.module.vars.set('__file__', this.file);
    this.execBlock(ast.body, this.module);
    const outputs = this.graph.outputs;
    if (!outputs.length && this.module.vars.has('result')) this.addOutputs('result', this.module.vars.get('result'), null);
    return this.graph;
  }
  addOutputs(name, v, span) {
    if (v instanceof Shape) { if (!v.empty && !this.graph.outputs.some(o => o.node === v.node)) this.graph.outputs.push({ name, node: v.node, meta: v.meta }); return; }
    if (v instanceof Compound || isSeq(v)) { (v.items).forEach((x, i) => this.addOutputs(`${name}[${i}]`, x, span)); return; }
    if (v instanceof PyDict) { for (const [k, x] of v.m.values()) this.addOutputs(`${name}.${strOf(k)}`, x, span); return; }
    capability(`output '${name}' must be a Part, a list of Parts or a dict of Parts, got ${typeName(v)}`, span);
  }

  // ---- statements
  execBlock(stmts, env) { for (const s of stmts) this.exec(s, env); }
  labelFor(target) {
    if (!target) return null;
    if (target.k === 'Name') return target.id;
    if (target.k === 'Attribute') return `${this.labelFor(target.value)}.${target.attr}`;
    if (target.k === 'Subscript') return this.labelFor(target.value);
    if (target.k === 'Tuple' || target.k === 'List') return target.elts.map(t => this.labelFor(t)).join(',');
    if (target.k === 'Starred') return this.labelFor(target.value);
    return null;
  }
  withStmt(label, fn) {
    const f = this.frame, saved = [f.stmt, f.counters, f.calls];
    f.stmt = label; f.counters = new Map(); f.calls = new Map();
    try { return fn(); } finally { [f.stmt, f.counters, f.calls] = saved; }
  }
  exec(s, env) {
    this.tick(s.span);
    switch (s.k) {
      case 'Expr': {
        // a bare call statement has no binding name: its callee frame is named by the function
        // alone, numbered per frame (bind results to names for fully order-independent ids)
        // `xs.append(f(...))` is named after the receiver `xs`
        const receiver = s.value.k === 'Call' && s.value.func.k === 'Attribute' ? this.labelFor(s.value.func.value) : null;
        this.withStmt(s.value.k === 'Call' ? (receiver ?? '') : 'expr', () => this.eval(s.value, env));
        return;
      }
      case 'Assign': {
        const label = this.labelFor(s.targets[0]);
        // `a, b = f(), g()`: name each element after its own target
        const t = s.targets[0];
        if (s.targets.length === 1 && (t.k === 'Tuple' || t.k === 'List') && s.value.k === 'Tuple' && t.elts.length === s.value.elts.length && !t.elts.some(e => e.k === 'Starred') && !s.value.elts.some(e => e.k === 'Starred')) {
          const values = t.elts.map((te, i) => this.withStmt(this.labelFor(te), () => this.eval(s.value.elts[i], env)));
          t.elts.forEach((te, i) => this.assign(te, values[i], env));
          return;
        }
        let value = this.withStmt(label, () => this.eval(s.value, env));
        if (env === this.module && t.k === 'Name' && Object.hasOwn(this.overrides, t.id)) value = this.override(t.id, s, value);
        if (env === this.module && t.k === 'Name' && s.value.k === 'Call' && s.value.func.k === 'Name' && s.value.func.id === 'param') this.recordParam(t.id, s, value);
        for (const target of s.targets) this.assign(target, value, env);
        return;
      }
      case 'AnnAssign': {
        if (!s.value) return;
        let value = this.withStmt(this.labelFor(s.target), () => this.eval(s.value, env));
        if (env === this.module && s.target.k === 'Name' && Object.hasOwn(this.overrides, s.target.id)) value = this.override(s.target.id, s, value);
        this.assign(s.target, value, env);
        return;
      }
      case 'AugAssign': {
        const label = this.labelFor(s.target);
        this.withStmt(label, () => {
          const cur = this.eval(s.target, env);
          const rhs = this.eval(s.value, env);
          let v;
          if (s.op === '+' && cur instanceof PyList) { cur.items.push(...this.iterate(rhs, s.span)); v = cur; }
          else v = this.binop(s.op, cur, rhs, s.span);
          this.assign(s.target, v, env);
        });
        return;
      }
      case 'Pass': return;
      case 'Break': throw new BreakSignal();
      case 'Continue': throw new ContinueSignal();
      case 'Return': throw new ReturnSignal(s.value ? this.withStmt('', () => this.eval(s.value, env)) : null);
      case 'If': {
        const test = this.withStmt('if', () => this.eval(s.test, env));
        if (this.truthy(test, s.test.span, 'if condition')) this.execBlock(s.body, env); else this.execBlock(s.orelse, env);
        return;
      }
      case 'For': {
        const iterable = this.withStmt(this.labelFor(s.target), () => this.eval(s.iter, env));
        const items = this.iterate(iterable, s.iter.span, 'for loop');
        const f = this.frame;
        let broke = false;
        for (let i = 0; i < items.length; i++) {
          f.loop.push(i);
          try {
            this.assign(s.target, items[i], env);
            this.execBlock(s.body, env);
          } catch (e) {
            if (e instanceof BreakSignal) { broke = true; break; }
            if (!(e instanceof ContinueSignal)) throw e;
          } finally { f.loop.pop(); }
        }
        if (!broke) this.execBlock(s.orelse, env);
        return;
      }
      case 'While': {
        const f = this.frame;
        let broke = false;
        for (let i = 0; ; i++) {
          this.tick(s.span);
          if (!this.truthy(this.eval(s.test, env), s.test.span, 'while condition')) break;
          f.loop.push(i);
          try { this.execBlock(s.body, env); }
          catch (e) {
            if (e instanceof BreakSignal) { broke = true; break; }
            if (!(e instanceof ContinueSignal)) throw e;
          } finally { f.loop.pop(); }
        }
        if (!broke) this.execBlock(s.orelse, env);
        return;
      }
      case 'FunctionDef': {
        this.setName(s.name, new PyFunction(s.name, s.params, s.body, env, s.span, { node: s }), env);
        return;
      }
      case 'Import': case 'ImportFrom': return this.importStmt(s, env);
      case 'Assert': {
        const test = this.eval(s.test, env);
        if (test instanceof Lazy) { this.addCheck(test, s.msg ? strOf(this.eval(s.msg, env)) : 'assert', s.span); return; }
        if (!this.truthy(test, s.test.span, 'assert')) modelError(s.msg ? strOf(this.eval(s.msg, env), this.kernelRepr) : 'assertion failed', s.span, 'AssertionError');
        return;
      }
      case 'Raise': {
        if (!s.exc) modelError('re-raise outside except', s.span);
        const e = this.eval(s.exc, env);
        const ex = e instanceof PyExceptionType ? new PyException(e, '') : e;
        if (!(ex instanceof PyException)) modelError('exceptions must derive from Exception', s.span, 'TypeError');
        throw new WpyError('model', ex.message, s.span, { pyType: ex.type.name });
      }
      case 'Try': return this.tryStmt(s, env);
      case 'Nonlocal': case 'Global': return;
      case 'Del': {
        const targets = s.targets.k === 'Tuple' ? s.targets.elts : [s.targets];
        for (const t of targets) {
          if (t.k === 'Name') this.lookupEnvFor(t.id, env).vars.delete(t.id);
          else if (t.k === 'Subscript') { const c = this.eval(t.value, env), k = this.eval(t.slice, env); if (c instanceof PyDict) c.delete(k); else if (c instanceof PyList) c.items.splice(this.index(c, k, t.span), 1); }
        }
        return;
      }
      default: capability(`statement '${s.k}' is not part of WPy v0`, s.span);
    }
  }
  override(name, s, value) {
    const raw = this.overrides[name];
    const isLiteral = s.value.k === 'Const' || (s.value.k === 'UnaryOp' && s.value.operand.k === 'Const') || (s.value.k === 'Call' && s.value.func.k === 'Name' && s.value.func.id === 'param');
    if (!isLiteral) capability(`parameter '${name}' is computed from other values and cannot be overridden`, s.span);
    const v = typeof raw === 'number' ? raw : typeof raw === 'string' && /^-?\d+$/.test(raw) ? BigInt(raw) : Number(raw);
    if (typeof v === 'number' && !Number.isFinite(v)) capability(`parameter '${name}' must be a number`, s.span);
    this.log.push(`parameter ${name} = ${reprOf(v)} (default ${reprOf(value, this.kernelRepr)})`);
    return v;
  }
  recordParam(name, s, value) { this.params.push({ name, value: typeof value === 'bigint' ? Number(value) : value, span: s.span }); }

  tryStmt(s, env) {
    const firstNode = this.graph.nodes.length;
    try {
      this.execBlock(s.body, env);
      // Kernel work is lazy, so a failure would surface after the try block has
      // been left. With a backend, WPy evaluates the nodes the block created
      // while still inside it (Python semantics). In preflight the block is
      // recorded as a failure combinator site (orElse in the graph).
      const created = this.graph.nodes.slice(firstNode).filter(n => n.kind === 'body' || n.kind === 'sketch');
      if (created.length) {
        if (this.backend) for (const n of created) this.backend.ensure(this.graph, n.index, n.span);
        else this.graph.failureSites.push({ span: s.span, nodes: created.map(n => n.id), handler: s.handlers.every(h => h.body.every(b => b.k === 'Pass')) ? 'keep previous value (pass)' : 'fallback branch' });
      }
    } catch (e) {
      if (!(e instanceof WpyError) || e.kind !== 'model') throw e; // capability and resource errors are never caught
      const handler = s.handlers.find(h => this.handlerMatches(h, e, env));
      if (!handler) throw e;
      this.graph.notices.push({ span: handler.span, caught: e.pyType, message: e.message, at: e.span, silent: handler.body.every(b => b.k === 'Pass') });
      if (handler.name) this.setName(handler.name, new PyException(new PyExceptionType(e.pyType), e.message), env);
      this.execBlock(handler.body, env);
      this.execBlock(s.finalbody, env);
      return;
    }
    this.execBlock(s.orelse, env);
    this.execBlock(s.finalbody, env);
  }
  handlerMatches(h, e, env) {
    if (!h.type) return true;
    const types = h.type.k === 'Tuple' ? h.type.elts : [h.type];
    return types.some(t => {
      const v = this.eval(t, env);
      if (!(v instanceof PyExceptionType)) modelError('except expects exception classes', t.span, 'TypeError');
      for (let x = new PyExceptionType(e.pyType, this.exceptionBase(e.pyType)); x; x = x.base) if (x.name === v.name) return true;
      return false;
    });
  }
  exceptionBase(name) {
    const chain = { ZeroDivisionError: 'ArithmeticError', OverflowError: 'ArithmeticError', ArithmeticError: 'Exception', ValueError: 'Exception', TypeError: 'Exception',
      KeyError: 'LookupError', IndexError: 'LookupError', LookupError: 'Exception', AssertionError: 'Exception', RuntimeError: 'Exception', NameError: 'Exception',
      UnboundLocalError: 'NameError', AttributeError: 'Exception', KernelError: 'Exception', ModelError: 'Exception', CheckError: 'Exception' };
    const b = chain[name];
    return b ? new PyExceptionType(b, this.exceptionBase(b)) : (name === 'Exception' ? null : new PyExceptionType('Exception'));
  }

  importStmt(s, env) {
    const moduleValue = name => {
      const root = name.split('.')[0];
      if (root === 'math') return this.builtins.get('__math__');
      if (root === 'wonky' || root === 'build123d') return this.builtins.get('__wonky__');
      if (root === 'os' || root === 'sys' || root === 'pathlib') return new PyModule(root, new Map([['makedirs', new Builtin('makedirs', () => null)], ['Path', new Builtin('Path', ([p = '.']) => new PathV(strOf(p)))], ['argv', new PyList([])],
        ['path', new PyModule('os.path', new Map([['join', new Builtin('join', a => a.map(x => strOf(x)).join('/'))], ['dirname', new Builtin('dirname', a => strOf(a[0]).split('/').slice(0, -1).join('/'))]]))]]));
      if (root === 'typing' || root === '__future__') return new PyModule(root, new Map());
      capability(`import ${name} is not part of WPy`, s.span);
    };
    if (s.k === 'Import') {
      for (const { name, asname } of s.names) this.setName(asname ?? name.split('.')[0], moduleValue(name), env);
      return;
    }
    const mod = moduleValue(s.module);
    if (s.names === '*') { for (const [k, v] of mod.attrs) if (!k.startsWith('_')) this.setName(k, v, env); return; }
    for (const { name, asname } of s.names) {
      if (s.module === 'typing' || s.module === '__future__') { this.setName(asname ?? name, null, env); continue; }
      if (!mod.attrs.has(name)) capability(`'${name}' is not in the WPy v0 vocabulary of ${s.module}`, s.span);
      this.setName(asname ?? name, mod.attrs.get(name), env);
    }
  }

  // ---- names
  setName(name, value, env) {
    if (env.fn) {
      const info = env.info;
      if (info?.globals.has(name)) { this.module.vars.set(name, value); return; }
      if (info?.nonlocals.has(name)) {
        for (let e = env.parent; e; e = e.parent) if (e.fn && e.vars.has(name)) { e.vars.set(name, value); return; }
        modelError(`no binding for nonlocal '${name}'`, null, 'SyntaxError');
      }
    }
    env.vars.set(name, value);
  }
  lookupEnvFor(name, env) {
    for (let e = env; e; e = e.parent) if (e.vars.has(name)) return e;
    return env;
  }
  lookup(name, env, span) {
    if (env.fn && env.info?.locals.has(name) && !env.vars.has(name)) modelError(`local variable '${name}' referenced before assignment`, span, 'UnboundLocalError');
    for (let e = env; e; e = e.parent) {
      if (e.vars.has(name)) return e.vars.get(name);
      if (e.fn && e !== env && e.info?.locals.has(name) && !e.vars.has(name)) modelError(`free variable '${name}' referenced before assignment`, span, 'NameError');
    }
    if (this.builtins.has(name)) return this.builtins.get(name);
    modelError(`name '${name}' is not defined`, span, 'NameError');
  }
  assign(t, v, env) {
    switch (t.k) {
      case 'Name': this.setName(t.id, v, env); return;
      case 'Tuple': case 'List': {
        const items = this.iterate(v, t.span, 'unpacking');
        const star = t.elts.findIndex(e => e.k === 'Starred');
        if (star < 0) {
          if (items.length !== t.elts.length) modelError(`cannot unpack ${items.length} values into ${t.elts.length} targets`, t.span, 'ValueError');
          t.elts.forEach((e, i) => this.assign(e, items[i], env));
        } else {
          const after = t.elts.length - star - 1;
          t.elts.slice(0, star).forEach((e, i) => this.assign(e, items[i], env));
          this.assign(t.elts[star].value, new PyList(items.slice(star, items.length - after)), env);
          t.elts.slice(star + 1).forEach((e, i) => this.assign(e, items[items.length - after + i], env));
        }
        return;
      }
      case 'Subscript': {
        const c = this.eval(t.value, env), k = this.eval(t.slice, env);
        if (c instanceof PyDict) { c.set(k, v); return; }
        if (c instanceof PyList) { c.items[this.index(c, k, t.span)] = v; return; }
        modelError(`'${typeName(c)}' object does not support item assignment`, t.span, 'TypeError');
      }
      case 'Attribute': {
        const o = this.eval(t.value, env);
        if (o instanceof Shape && ['label', 'color'].includes(t.attr)) { o.meta[t.attr] = v instanceof PyTuple ? v.items.map(x => toFloat(x)) : strOf(v, this.kernelRepr); return; }
        capability(`attribute assignment '.${t.attr}' is not part of WPy v0`, t.span, 'WPy values are immutable apart from lists, dicts and shape metadata (label, color)');
      }
      default: capability(`cannot assign to ${t.k}`, t.span);
    }
  }

  // ---- expressions
  eval(e, env) {
    this.tick(e.span);
    switch (e.k) {
      case 'Const':
        if (e.kind === 'bytes' || e.kind === 'ellipsis') capability(`${e.kind} literals are not part of WPy`, e.span);
        return e.value;
      case 'JoinedStr': return e.parts.map(p => typeof p === 'string' ? p : this.formatField(p, env)).join('');
      case 'Name': return this.lookup(e.id, env, e.span);
      case 'List': return new PyList(this.evalElts(e.elts, env));
      case 'Tuple': return new PyTuple(this.evalElts(e.elts, env));
      case 'Set': { const s = new PySet(); for (const v of this.evalElts(e.elts, env)) s.m.set(keyOf(v), v); return s; }
      case 'Dict': {
        const d = new PyDict();
        e.keys.forEach((k, i) => {
          if (k === null) { const o = this.eval(e.values[i], env); for (const [kk, vv] of o.m.values()) d.set(kk, vv); }
          else d.set(this.eval(k, env), this.eval(e.values[i], env));
        });
        return d;
      }
      case 'ListComp': case 'GeneratorExp': case 'SetComp': return this.comprehension(e, env);
      case 'DictComp': return this.comprehension(e, env);
      case 'BinOp': return this.binop(e.op, this.eval(e.left, env), this.eval(e.right, env), e.span);
      case 'UnaryOp': return this.unary(e.op, this.eval(e.operand, env), e.span);
      case 'BoolOp': {
        let v;
        for (let i = 0; i < e.values.length; i++) {
          v = this.eval(e.values[i], env);
          // symbolic predicates and lazy booleans combine without short-circuit (both are pure)
          if (v instanceof SymPred || v instanceof Lazy || this.isSym(v)) return this.combineBool(e, env, i, v);
          const t = this.truthy(v, e.values[i].span, e.op);
          if (e.op === 'and' ? !t : t) return v;
        }
        return v;
      }
      case 'Compare': {
        let left = this.eval(e.left, env), result = true, preds = [];
        for (let i = 0; i < e.ops.length; i++) {
          const right = this.eval(e.comparators[i], env);
          const r = this.compare(e.ops[i], left, right, e.span);
          if (r instanceof SymPred || r instanceof Lazy) preds.push(r);
          else if (!r) { if (!preds.length) return false; result = false; }
          left = right;
        }
        if (!preds.length) return result;
        if (!result) return false;
        return preds.reduce((a, b) => this.and(a, b, e.span));
      }
      case 'IfExp': return this.truthy(this.eval(e.test, env), e.test.span, 'conditional expression') ? this.eval(e.body, env) : this.eval(e.orelse, env);
      case 'Lambda': return new PyFunction('<lambda>', e.params, e.body, env, e.span, { isLambda: true, node: e });
      case 'NamedExpr': { const v = this.eval(e.value, env); this.assign(e.target, v, env); return v; }
      case 'Attribute': return this.attribute(this.eval(e.value, env), e.attr, e.span);
      case 'Subscript': return this.subscript(this.eval(e.value, env), e.slice, env, e.span);
      case 'Call': return this.call(e, env);
      case 'Starred': capability('starred expression in this position', e.span);
      default: capability(`expression '${e.k}' is not part of WPy v0`, e.span);
    }
  }
  evalElts(elts, env) {
    const out = [];
    for (const x of elts) {
      if (x.k === 'Starred') out.push(...this.iterate(this.eval(x.value, env), x.span, 'unpacking'));
      else out.push(this.eval(x, env));
    }
    return out;
  }
  formatField(p, env) {
    let v = this.eval(p.expr, env);
    if (v instanceof Lazy || v instanceof LazyVec) v = this.force(v, p.expr.span, 'formatting a measured value');
    const spec = p.spec ? p.spec.map(x => typeof x === 'string' ? x : this.formatField(x, env)).join('') : '';
    if (p.conv === 'r' || (p.selfDoc && !spec && !p.conv)) return reprOf(v, this.kernelRepr);
    return formatValue(p.conv === 's' ? strOf(v, this.kernelRepr) : v, spec, p.expr.span, this.kernelRepr);
  }
  kernelRepr = v => {
    if (v instanceof Shape) return v.empty ? '<Part empty>' : `<Part ${this.graph.nodes[v.node].id}>`;
    if (v instanceof Sketch) return v.empty ? '<Sketch empty>' : `<Sketch ${this.graph.nodes[v.node].id}>`;
    if (v instanceof Vec) return `Vector(${floatRepr(v.x)}, ${floatRepr(v.y)}, ${floatRepr(v.z)})`;
    if (v instanceof EnumV) return `<${v.type}.${v.name}>`;
    if (v instanceof PyFunction) return `<function ${v.name}>`;
    if (v instanceof Builtin || v instanceof BoundMethod) return `<built-in ${v.name}>`;
    if (v instanceof PyExceptionType) return `<class '${v.name}'>`;
    if (v instanceof Loc) return `Location(${v.t.map(floatRepr).join(', ')})`;
    if (v instanceof PathV) return v.p;
    return undefined;
  };

  comprehension(e, env) {
    // Lowering: `[x for x in <lazy entity set> if <declarative predicate>]`
    const first = e.gens[0];
    const scope = new Env(env);
    const iterable = this.eval(first.iter, env);
    if (iterable instanceof EntitySet && e.k !== 'DictComp' && e.gens.length === 1 && first.target.k === 'Name' && e.elt.k === 'Name' && e.elt.id === first.target.id) {
      const lowered = this.lowerFilter(iterable, first, scope, e.span);
      if (lowered) return lowered;
    }
    const out = e.k === 'DictComp' ? new PyDict() : e.k === 'SetComp' ? new PySet() : new PyList();
    const f = this.frame;
    const gen = (i, iterValue) => {
      const g = e.gens[i];
      const items = this.iterate(i === 0 ? iterValue : this.eval(g.iter, scope), g.iter.span, 'comprehension');
      for (let j = 0; j < items.length; j++) {
        f.loop.push(j);
        try {
          this.assign(g.target, items[j], scope);
          if (!g.ifs.every(c => this.truthy(this.eval(c, scope), c.span, 'comprehension filter'))) continue;
          if (i + 1 < e.gens.length) gen(i + 1);
          else if (e.k === 'DictComp') out.set(this.eval(e.key, scope), this.eval(e.value, scope));
          else if (e.k === 'SetComp') { const v = this.eval(e.elt, scope); out.m.set(keyOf(v), v); }
          else out.items.push(this.eval(e.elt, scope));
        } finally { f.loop.pop(); }
      }
    };
    gen(0, iterable);
    return out;
  }
  lowerFilter(set, g, scope, span) {
    try {
      scope.vars.set(g.target.id, new SymEntity(set.kind));
      let pred = null;
      for (const c of g.ifs) {
        const p = this.eval(c, scope);
        if (!(p instanceof SymPred)) throw new NotLowerable();
        pred = pred ? { op: 'and', a: pred, b: p.pred } : p.pred;
      }
      if (!pred) return set;
      return new EntitySet(this.node('select', { predicate: pred }, [set.node], span, 'entities'), set.owner, set.kind);
    } catch (err) {
      if (!(err instanceof NotLowerable)) throw err;
      this.graph.syncPoints.push({ span, reason: 'comprehension filter needs host iteration over kernel entities (not a declarative predicate)', node: set.node });
      if (!this.backend) {
        this.assumptions.push({ span, assumption: 'host-side entity filter kept as an opaque selection node' });
        return new EntitySet(this.node('select', { predicate: { op: 'host', source: this.sourceText(span) } }, [set.node], span, 'entities'), set.owner, set.kind);
      }
      capability('host iteration over kernel entities is not available on this backend', span);
    }
  }
  sourceText(span) { return this.source.split('\n')[span.line - 1]?.trim() ?? ''; }

  // ---- symbolic predicates (comprehension lowering)
  symAttr(o, name, span) {
    if (o instanceof SymEntity) {
      if (['center', 'position_at', 'normal_at', 'bounding_box'].includes(name)) return new SymMethod(name);
      if (['length', 'area', 'volume', 'radius'].includes(name)) return new SymTerm({ t: 'measure', name });
      if (name === 'geom_type') return new SymTerm({ t: 'measure', name: 'geom_type' });
      throw new NotLowerable();
    }
    if (o instanceof SymVec) {
      // bounding-box windows: e.bounding_box().min.Y, .max.Z, .size.X
      if (o.path === 'bounding_box' && ['min', 'max', 'size'].includes(name)) return new SymVec(`bbox.${name}`);
      if (o.path === 'bounding_box' && name === 'center') return new SymMethod('bbox.center');
      if (name === 'dot') return new Builtin('dot', ([v]) => {
        const c = v instanceof Vec ? [v.x, v.y, v.z] : v instanceof PyTuple ? v.items.map(x => toFloat(x)) : (() => { throw new NotLowerable(); })();
        return new SymTerm({ t: 'dot', name: o.path, v: c });
      });
      const axis = { X: 'x', Y: 'y', Z: 'z' }[name];
      if (!axis) throw new NotLowerable();
      return new SymTerm({ t: 'measure', name: o.path, axis });
    }
    throw new NotLowerable();
  }
  symTerm(v) {
    if (v instanceof SymTerm) return v.term;
    if (typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') return { t: 'num', v: toFloat(v) };
    if (v instanceof EnumV) return { t: 'enum', v: `${v.type}.${v.name}` };
    throw new NotLowerable();
  }
  isSym(v) { return v instanceof SymEntity || v instanceof SymMethod || v instanceof SymVec || v instanceof SymTerm || v instanceof SymPred; }
  and(a, b, span) {
    if (a instanceof SymPred && b instanceof SymPred) return new SymPred({ op: 'and', a: a.pred, b: b.pred });
    return this.lazyNode('and', [a, b], span, 'bool');
  }
  combineBool(e, env, i, first) {
    const all = [first, ...e.values.slice(i + 1).map(x => this.eval(x, env))];
    if (all.every(v => v instanceof SymPred || typeof v === 'boolean')) {
      const preds = all.map(v => typeof v === 'boolean' ? { op: 'const', v } : v.pred);
      return new SymPred(preds.reduce((a, b) => ({ op: e.op, a, b })));
    }
    if (all.some(v => this.isSym(v))) throw new NotLowerable();
    return all.reduce((a, b) => this.lazyNode(e.op, [a, b], e.span, 'bool'));
  }

  // ---- lazy measures
  lazyNode(op, operands, span, type = 'number') {
    const inputs = [], consts = [];
    for (const v of operands) {
      if (v instanceof Lazy) { inputs.push(v.node); consts.push(null); }
      else if (isNumber(v)) consts.push(toFloat(v));
      else if (typeof v === 'string' || v === null) consts.push(v);
      else capability(`${typeName(v)} cannot be combined with a measured value`, span);
    }
    return new Lazy(this.node('arith', { op, consts }, inputs, span, 'value'), type);
  }
  force(v, span, reason) {
    const got = this.sync(v, span, reason);
    if (got !== undefined) return got;
    // preflight: record the assumption; booleans assume the guarded branch runs
    const type = v instanceof Lazy ? v.type : 'entities';
    this.assumptions.push({ span, assumption: type === 'bool' || type === 'entities' ? 'true / non-empty' : 'NaN', reason });
    return type === 'bool' || type === 'entities' ? true : NaN;
  }
  addCheck(test, message, span) {
    if (test instanceof Lazy) { this.graph.checks.push(this.node('check', { message }, [test.node], span, 'check')); return; }
    if (!this.truthy(test, span, 'expect')) this.failedChecks.push({ message, span });
  }

  // ---- truthiness / iteration
  truthy(v, span, why) {
    if (v === null) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'bigint') return v !== 0n;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v.length > 0;
    if (v instanceof PyList || v instanceof PyTuple) return v.items.length > 0;
    if (v instanceof PyDict || v instanceof PySet) return v.m.size > 0;
    if (v instanceof Lazy) return !!this.force(v, span, why);
    if (v instanceof EntitySet) return !!this.force(new Lazy(this.node('count', {}, [v.node], span, 'value'), 'entities'), span, `${why}: emptiness guard on a selection`);
    if (v instanceof Shape || v instanceof Sketch) return !v.empty;
    if (v instanceof SymPred || this.isSym(v)) throw new NotLowerable();
    return true;
  }
  iterate(v, span, why = 'iteration') {
    if (v instanceof PyList || v instanceof PyTuple || v instanceof Compound) return [...v.items];
    if (typeof v === 'string') return [...v];
    if (v instanceof Vec) return [v.x, v.y, v.z];
    if (v instanceof PyDict) return [...v.m.values()].map(([k]) => k);
    if (v instanceof PySet) return [...v.m.values()];
    if (v instanceof EntitySet || v instanceof EntityGroups) {
      this.graph.syncPoints.push({ span, reason: `${why} over kernel entities (sequential geometry control flow)`, node: v.node });
      if (!this.backend) { this.assumptions.push({ span, assumption: 'zero entities: the loop body was not executed in preflight' }); return []; }
      capability('host iteration over kernel entities is not available on this backend', span);
    }
    if (this.isSym(v)) throw new NotLowerable();
    modelError(`'${typeName(v)}' object is not iterable`, span, 'TypeError');
  }
  index(seq, k, span) {
    if (typeof k !== 'bigint' && typeof k !== 'boolean') modelError(`indices must be integers, not ${typeName(k)}`, span, 'TypeError');
    let i = Number(toIntLike(k));
    const n = seq.items.length;
    if (i < 0) i += n;
    if (i < 0 || i >= n) modelError('index out of range', span, 'IndexError');
    return i;
  }

  // ---- operators
  unary(op, v, span) {
    if (op === 'not') { if (v instanceof SymPred) return new SymPred({ op: 'not', a: v.pred }); if (this.isSym(v)) throw new NotLowerable(); return !this.truthy(v, span, 'not'); }
    if (this.isSym(v)) { if (op === '-') return new SymTerm({ t: 'neg', a: this.symTerm(v) }); if (op === '+') return v; throw new NotLowerable(); }
    if (v instanceof Lazy) return op === '+' ? v : this.lazyNode(op === '-' ? 'neg' : op, [v], span);
    if (v instanceof Vec && op === '-') return new Vec(-v.x, -v.y, -v.z);
    if (typeof v === 'boolean') v = toIntLike(v);
    if (typeof v === 'bigint') return op === '-' ? -v : op === '+' ? v : ~v;
    if (typeof v === 'number') { if (op === '~') modelError("bad operand type for unary ~: 'float'", span, 'TypeError'); return op === '-' ? -v : v; }
    modelError(`bad operand type for unary ${op}: '${typeName(v)}'`, span, 'TypeError');
  }
  binop(op, a, b, span) {
    if (this.isSym(a) || this.isSym(b)) {
      if (!['+', '-', '*', '/'].includes(op)) throw new NotLowerable();
      return new SymTerm({ t: 'bin', op, a: this.symTerm(a), b: this.symTerm(b) });
    }
    const r = arith(op, a, b, span);
    if (r !== undefined) return r;
    if (a instanceof Lazy || b instanceof Lazy) {
      if ((a instanceof Lazy || isNumber(a)) && (b instanceof Lazy || isNumber(b))) return this.lazyNode(op, [a, b], span);
    }
    if (op === '+' && typeof a === 'string' && typeof b === 'string') return a + b;
    if (op === '/' && a instanceof PathV) return new PathV(`${a.p}/${strOf(b, this.kernelRepr)}`);
    if (op === '*' && typeof a === 'string' && isInt(toIntLike(b))) return a.repeat(Math.max(0, Number(toIntLike(b))));
    if (op === '+' && a instanceof PyList && b instanceof PyList) return new PyList([...a.items, ...b.items]);
    if (op === '+' && a instanceof PyTuple && b instanceof PyTuple) return new PyTuple([...a.items, ...b.items]);
    if (op === '*' && isSeq(a) && isInt(toIntLike(b))) { const n = Number(toIntLike(b)); const items = []; for (let i = 0; i < n; i++) items.push(...a.items); return new a.constructor(items); }
    if (op === '+' && a instanceof EntitySet && b instanceof EntitySet) {
      if (a.owner !== b.owner) capability('combining selections of different parts', span);
      return new EntitySet(this.node('select_union', {}, [a.node, b.node], span, 'entities'), a.owner, a.kind);
    }
    if (op === '+' && a instanceof EntitySet && b instanceof PyList && !b.items.length) return a;
    if (op === '+' && a instanceof PyList && !a.items.length && b instanceof EntitySet) return b;
    if (a instanceof Vec && b instanceof Vec && (op === '+' || op === '-')) return op === '+' ? new Vec(a.x + b.x, a.y + b.y, a.z + b.z) : new Vec(a.x - b.x, a.y - b.y, a.z - b.z);
    if (a instanceof Vec && isNumber(b) && (op === '*' || op === '/')) { const k = toFloat(b); return op === '*' ? new Vec(a.x * k, a.y * k, a.z * k) : new Vec(a.x / k, a.y / k, a.z / k); }
    if (isNumber(a) && b instanceof Vec && op === '*') return this.binop('*', b, a, span);
    // geometry algebra (build123d): + union, - subtract, & intersect, Location * object
    if (op === '*' && a instanceof Loc) return this.locate(a, b, span);
    if (op === '*' && a instanceof PlaneV) return this.place(a, b, span);
    if (a instanceof Shape && b instanceof Shape && ['+', '-', '&'].includes(op)) return this.boolean(op, a, b, span);
    if (a instanceof Shape && (b instanceof PyList || b instanceof PyTuple) && ['+', '-'].includes(op) && b.items.every(x => x instanceof Shape)) return b.items.reduce((acc, x) => this.boolean(op, acc, x, span), a);
    if (a instanceof Sketch && (b instanceof PyList || b instanceof PyTuple) && ['+', '-'].includes(op) && b.items.every(x => x instanceof Sketch)) return b.items.reduce((acc, x) => this.sketchBoolean(op, acc, x, span), a);
    if (a instanceof Sketch && b instanceof Sketch && ['+', '-', '&'].includes(op)) return this.sketchBoolean(op, a, b, span);
    if (a instanceof Curve && b instanceof Curve && op === '+') return new Curve(this.node('wire', {}, [a.node, b.node], span, 'curve'));
    modelError(`unsupported operand types for ${op}: '${typeName(a)}' and '${typeName(b)}'`, span, 'TypeError');
  }
  compare(op, a, b, span) {
    if (this.isSym(a) || this.isSym(b)) {
      if (!['<', '<=', '>', '>=', '==', '!='].includes(op)) throw new NotLowerable();
      return new SymPred({ op: 'cmp', cmp: op, a: this.symTerm(a), b: this.symTerm(b) });
    }
    if (a instanceof Lazy || b instanceof Lazy) return this.lazyNode(op, [a, b], span, 'bool');
    switch (op) {
      case '==': return this.equal(a, b);
      case '!=': return !this.equal(a, b);
      case 'is': return a === b || (a === null && b === null);
      case 'is not': return !(a === b || (a === null && b === null));
      case 'in': return this.contains(b, a, span);
      case 'not in': return !this.contains(b, a, span);
    }
    const c = this.order(a, b, span);
    if (Number.isNaN(c)) return false;
    return { '<': c < 0, '<=': c <= 0, '>': c > 0, '>=': c >= 0 }[op];
  }
  order(a, b, span) {
    if (isNumber(a) && isNumber(b)) return compareNumbers(a, b);
    if (typeof a === 'string' && typeof b === 'string') return a < b ? -1 : a > b ? 1 : 0;
    if ((a instanceof PyList && b instanceof PyList) || (a instanceof PyTuple && b instanceof PyTuple)) {
      for (let i = 0; i < Math.min(a.items.length, b.items.length); i++) {
        if (!this.equal(a.items[i], b.items[i])) return this.order(a.items[i], b.items[i], span);
      }
      return a.items.length - b.items.length;
    }
    modelError(`'<' not supported between '${typeName(a)}' and '${typeName(b)}'`, span, 'TypeError');
  }
  equal(a, b) {
    if (isNumber(a) && isNumber(b)) return compareNumbers(a, b) === 0;
    if (a === b) return true;
    if ((a instanceof PyList && b instanceof PyList) || (a instanceof PyTuple && b instanceof PyTuple)) return a.items.length === b.items.length && a.items.every((x, i) => this.equal(x, b.items[i]));
    if (a instanceof PyDict && b instanceof PyDict) return a.m.size === b.m.size && [...a.m.entries()].every(([k, [, v]]) => b.m.has(k) && this.equal(v, b.m.get(k)[1]));
    if (a instanceof EnumV && b instanceof EnumV) return a.type === b.type && a.name === b.name;
    if (a instanceof Vec && b instanceof Vec) return a.x === b.x && a.y === b.y && a.z === b.z;
    return false;
  }
  contains(c, x, span) {
    if (c instanceof PyList || c instanceof PyTuple) return c.items.some(y => this.equal(x, y));
    if (c instanceof PyDict || c instanceof PySet) return c.m.has(keyOf(x));
    if (typeof c === 'string') return c.includes(strOf(x));
    if (this.isSym(x) || this.isSym(c)) throw new NotLowerable();
    modelError(`argument of type '${typeName(c)}' is not iterable`, span, 'TypeError');
  }

  // ---- geometry algebra
  boolean(op, a, b, span) {
    // total (empty-tolerant) Booleans: the corpus wraps opBoolean in emptiness guards only because Onshape throws on empty inputs
    if (op === '+') { if (a.empty) return b; if (b.empty) return a; }
    if (op === '-') { if (a.empty || b.empty) return a; }
    if (op === '&') { if (a.empty) return a; if (b.empty) return b; }
    const name = { '+': 'union', '-': 'subtract', '&': 'intersect' }[op];
    const s = new Shape(this.node(name, {}, [a.node, b.node], span, 'body'));
    s.meta = { ...a.meta };
    return s;
  }
  sketchBoolean(op, a, b, span) {
    if (op === '+') { if (a.empty) return b; if (b.empty) return a; }
    if (op === '-' && (a.empty || b.empty)) return a;
    return new Sketch(this.node({ '+': 'sketch_union', '-': 'sketch_subtract', '&': 'sketch_intersect' }[op], {}, [a.node, b.node], span, 'sketch'));
  }
  locate(loc, obj, span) {
    if (obj instanceof Loc) return loc.compose(obj);
    if (obj instanceof Shape) { if (obj.empty) return obj; const s = new Shape(this.node('move', { rows: loc.rows, offset: loc.t }, [obj.node], span, 'body')); s.meta = { ...obj.meta }; return s; }
    if (obj instanceof Sketch) return obj.empty ? obj : new Sketch(this.node('move', { rows: loc.rows, offset: loc.t }, [obj.node], span, 'sketch'));
    if (obj instanceof Curve) return new Curve(this.node('move', { rows: loc.rows, offset: loc.t }, [obj.node], span, 'curve'));
    if (obj instanceof PyList || obj instanceof PyTuple) return new PyList(obj.items.map(x => this.locate(loc, x, span)));
    if (obj instanceof PlaneV) {
      const R = loc.rows, ap = v => [0, 1, 2].map(i => R[i][0] * v[0] + R[i][1] * v[1] + R[i][2] * v[2]);
      return new PlaneV(ap(obj.origin).map((v, i) => v + loc.t[i]), ap(obj.x), ap(obj.z));
    }
    modelError(`cannot locate '${typeName(obj)}'`, span, 'TypeError');
  }
  place(plane, obj, span) {
    const y = cross(plane.z, plane.x);
    const loc = new Loc([0, 1, 2].map(i => [plane.x[i], y[i], plane.z[i]]), plane.origin);
    if (obj instanceof Sketch) return obj.empty ? obj : new Sketch(this.node('move', { rows: loc.rows, offset: loc.t, placed: true }, [obj.node], span, 'sketch'));
    if (obj instanceof Loc) return loc.compose(obj);
    if (obj instanceof PlaneV) return this.locate(loc, obj, span);
    return this.locate(loc, obj, span);
  }

  // ---- attributes
  attribute(o, name, span) {
    if (o instanceof PathV) {
      const parts = o.p.split('/');
      switch (name) {
        case 'parent': return new PathV(parts.slice(0, -1).join('/') || '.');
        case 'name': return parts.at(-1);
        case 'stem': return parts.at(-1).replace(/\.[^.]*$/, '');
        case 'suffix': return (/\.[^.]*$/.exec(parts.at(-1)) ?? [''])[0];
        case 'mkdir': case 'write_text': case 'unlink': return new Builtin(name, () => null);
        case 'exists': return new Builtin(name, () => false);
        case 'resolve': case 'absolute': return new Builtin(name, () => o);
        case 'with_suffix': return new Builtin(name, ([x]) => new PathV(o.p.replace(/\.[^./]*$/, '') + strOf(x)));
      }
    }
    if (this.isSym(o)) return this.symAttr(o, name, span);
    if (o instanceof PyModule) {
      if (!o.attrs.has(name)) capability(`'${o.name}.${name}' is not in the WPy v0 vocabulary`, span);
      return o.attrs.get(name);
    }
    if (o instanceof Vec) {
      const v = { X: o.x, Y: o.y, Z: o.z, x: o.x, y: o.y, z: o.z }[name];
      if (v !== undefined) return v;
      if (name === 'length') return Math.hypot(o.x, o.y, o.z);
      if (name === 'normalized') return new Builtin('normalized', () => { const n = Math.hypot(o.x, o.y, o.z); return new Vec(o.x / n, o.y / n, o.z / n); });
      if (name === 'dot') return new Builtin('dot', ([v]) => { const w = v instanceof Vec ? v : new Vec(...v.items.map(x => toFloat(x))); return o.x * w.x + o.y * w.y + o.z * w.z; });
      if (name === 'cross') return new Builtin('cross', ([v]) => { const w = v instanceof Vec ? v : new Vec(...v.items.map(x => toFloat(x))); return new Vec(...cross([o.x, o.y, o.z], [w.x, w.y, w.z])); });
    }
    if (o instanceof LazyVec) {
      const axis = { X: 0, Y: 1, Z: 2 }[name];
      if (axis === undefined) capability(`Vector attribute '${name}'`, span);
      return new Lazy(this.node('pick', { field: o.field, axis }, [o.node], span, 'value'), 'number');
    }
    if (o instanceof LazyBox) {
      if (['min', 'max', 'size'].includes(name)) return new LazyVec(o.node, name);
      if (name === 'center') return new Builtin('center', () => new LazyVec(o.node, 'center'));
      if (name === 'diagonal') return new Lazy(this.node('pick', { field: 'diagonal' }, [o.node], span, 'value'), 'number');
    }
    if (o instanceof EnumV && name === 'value') return o.name;
    if (o instanceof PlaneV) {
      if (name === 'offset') return new Builtin('offset', ([d]) => new PlaneV(o.origin.map((v, i) => v + o.z[i] * toFloat(d)), o.x, o.z));
      if (name === 'origin') return new Vec(...o.origin);
      if (name === 'z_dir') return new Vec(...o.z);
      if (name === 'x_dir') return new Vec(...o.x);
    }
    if (o instanceof Shape || o instanceof Sketch) return this.shapeAttr(o, name, span);
    if (o instanceof EntitySet) return this.entityAttr(o, name, span);
    if (o instanceof EntityGroups) {
      if (name === '__getitem__') return null;
    }
    if (o instanceof PyException && name === 'args') return new PyTuple([o.message]);
    if (o instanceof PyList || o instanceof PyTuple || o instanceof PyDict || o instanceof PySet || typeof o === 'string') return this.methodOf(o, name, span);
    if (o && o.typeName === 'ShapeTypeNamespace' && o.attrs.has(name)) return o.attrs.get(name);
    modelError(`'${typeName(o)}' object has no attribute '${name}'`, span, 'AttributeError');
  }
  shapeAttr(o, name, span) {
    const gapOp = (op, kind = 'body') => new Builtin(`${op}`, (args, kw, call) => this.gapNode(op, [o, ...args], kw, call.span, kind));
    switch (name) {
      case 'volume': case 'area': return o.empty ? 0 : new Lazy(this.node(name, {}, [o.node], span, 'value'), 'number');
      case 'is_valid': return new Lazy(this.node('valid', {}, [o.node], span, 'value'), 'bool');
      case 'bounding_box': return new Builtin('bounding_box', () => new LazyBox(this.node('bbox', {}, [o.node], span, 'value')));
      case 'edges': case 'faces': case 'solids': case 'vertices': case 'wires':
        return new Builtin(name, () => new EntitySet(this.node('entities', { kind: name }, [o.node], span, 'entities'), o, name));
      case 'moved': case 'located': return new Builtin(name, ([loc], kw, call) => this.locate(loc, o, call.span));
      case 'rotate': return new Builtin('rotate', ([axis, angle], kw, call) => {
        const a = toFloat(angle) * deg;
        const rows = { X: rotX, Y: rotY, Z: rotZ }[axis?.name]?.(a) ?? capability('rotate about a custom axis', call.span);
        return this.locate(new Loc(rows, [0, 0, 0]), o, call.span);
      });
      case 'fuse': return new Builtin('fuse', (args, kw, call) => args.reduce((acc, x) => this.boolean('+', acc, x, call.span), o));
      case 'cut': return new Builtin('cut', (args, kw, call) => args.reduce((acc, x) => this.boolean('-', acc, x, call.span), o));
      case 'intersect': return new Builtin('intersect', (args, kw, call) => args.reduce((acc, x) => this.boolean('&', acc, x, call.span), o));
      case 'center': return new Builtin('center', () => new LazyVec(this.node('bbox', {}, [o.node], span, 'value'), 'center'));
      case 'label': case 'color': return o.meta[name] ?? null;
      case 'mirror': return gapOp('mirror');
      case 'offset': return gapOp('offset');
      case 'split': return gapOp('split');
      case 'clean': return new Builtin('clean', () => o);
    }
    modelError(`'${o.typeName}' object has no attribute '${name}' in WPy v0`, span, 'AttributeError');
  }
  entityAttr(o, name, span) {
    const sel = (op, params) => new EntitySet(this.node(op, params, [o.node], span, 'entities'), o.owner, o.kind);
    switch (name) {
      case 'filter_by': return new Builtin('filter_by', ([what, ...rest], kw, call) => {
        if (what instanceof EnumV) return sel('filter', { by: `${what.type}.${what.name}`, reverse: rest.length ? !!rest[0] : false });
        if (what instanceof PyFunction && what.isLambda) {
          const scope = new Env(what.env); const p = what.params.args[0]?.name;
          try {
            scope.vars.set(p, new SymEntity(o.kind));
            const r = this.eval(what.body, scope);
            if (r instanceof SymPred) return sel('select', { predicate: r.pred });
          } catch (err) { if (!(err instanceof NotLowerable)) throw err; }
          this.graph.syncPoints.push({ span: call.span, reason: 'filter_by(lambda) is not a declarative predicate', node: o.node });
          return sel('select', { predicate: { op: 'host', source: this.sourceText(call.span) } });
        }
        capability('filter_by expects an Axis, a GeomType or a lambda', call.span);
      });
      case 'sort_by': return new Builtin('sort_by', ([what = new EnumV('Axis', 'Z')], kw) => sel('sort', { by: what instanceof EnumV ? `${what.type}.${what.name}` : 'custom', reverse: !!kw.reverse }));
      case 'group_by': return new Builtin('group_by', ([what = new EnumV('Axis', 'Z')]) => new EntityGroups(this.node('group', { by: what instanceof EnumV ? `${what.type}.${what.name}` : 'custom' }, [o.node], span, 'groups'), o.owner, o.kind));
      case 'filter_by_position': return new Builtin('filter_by_position', ([axis, lo, hi]) => sel('select', { predicate: { op: 'and', a: { op: 'cmp', cmp: '>=', a: { t: 'measure', name: 'center', axis: axis.name.toLowerCase() }, b: { t: 'num', v: toFloat(lo) } }, b: { op: 'cmp', cmp: '<=', a: { t: 'measure', name: 'center', axis: axis.name.toLowerCase() }, b: { t: 'num', v: toFloat(hi) } } } }));
      case 'first': return sel('pick', { index: 0 });
      case 'last': return sel('pick', { index: -1 });
    }
    modelError(`'ShapeList' object has no attribute '${name}' in WPy v0`, span, 'AttributeError');
  }
  methodOf(o, name, span) {
    const m = fn => new BoundMethod(o, name, fn);
    const it = (v, c) => this.iterate(v, c.span);
    if (o instanceof PyList) {
      switch (name) {
        case 'append': return m(([x]) => { o.items.push(x); return null; });
        case 'extend': return m(([x], kw, c) => { o.items.push(...it(x, c)); return null; });
        case 'insert': return m(([i, x]) => { let k = Number(toIntLike(i)); if (k < 0) k = Math.max(0, o.items.length + k); o.items.splice(k, 0, x); return null; });
        case 'pop': return m(([i], kw, c) => { if (!o.items.length) modelError('pop from empty list', c.span, 'IndexError'); const k = i === undefined ? o.items.length - 1 : this.index(o, i, c.span); return o.items.splice(k, 1)[0]; });
        case 'remove': return m(([x], kw, c) => { const k = o.items.findIndex(y => this.equal(x, y)); if (k < 0) modelError('list.remove(x): x not in list', c.span, 'ValueError'); o.items.splice(k, 1); return null; });
        case 'index': return m(([x], kw, c) => { const k = o.items.findIndex(y => this.equal(x, y)); if (k < 0) modelError('value is not in list', c.span, 'ValueError'); return BigInt(k); });
        case 'count': return m(([x]) => BigInt(o.items.filter(y => this.equal(x, y)).length));
        case 'reverse': return m(() => { o.items.reverse(); return null; });
        case 'copy': return m(() => new PyList([...o.items]));
        case 'clear': return m(() => { o.items.length = 0; return null; });
        case 'sort': return m((args, kw, c) => { o.items = this.builtins.get('sorted').fn([o], kw, c).items; return null; });
      }
    }
    if (o instanceof PyTuple) {
      if (name === 'index') return m(([x], kw, c) => { const k = o.items.findIndex(y => this.equal(x, y)); if (k < 0) modelError('tuple.index(x): x not in tuple', c.span, 'ValueError'); return BigInt(k); });
      if (name === 'count') return m(([x]) => BigInt(o.items.filter(y => this.equal(x, y)).length));
    }
    if (o instanceof PyDict) {
      switch (name) {
        case 'get': return m(([k, d = null]) => (o.has(k) ? o.get(k) : d));
        case 'items': return m(() => new PyList([...o.m.values()].map(([k, v]) => new PyTuple([k, v]))));
        case 'keys': return m(() => new PyList([...o.m.values()].map(([k]) => k)));
        case 'values': return m(() => new PyList([...o.m.values()].map(([, v]) => v)));
        case 'setdefault': return m(([k, d = null]) => { if (!o.has(k)) o.set(k, d); return o.get(k); });
        case 'update': return m(([x], kw) => { if (x instanceof PyDict) for (const [k, v] of x.m.values()) o.set(k, v); for (const [k, v] of Object.entries(kw)) o.set(k, v); return null; });
        case 'pop': return m(([k, d], kw, c) => { if (o.has(k)) { const v = o.get(k); o.delete(k); return v; } if (d !== undefined) return d; modelError(`KeyError: ${reprOf(k)}`, c.span, 'KeyError'); });
        case 'copy': return m(() => { const d = new PyDict(); for (const [k, v] of o.m.values()) d.set(k, v); return d; });
      }
    }
    if (o instanceof PySet) {
      if (name === 'add') return m(([x]) => { o.m.set(keyOf(x), x); return null; });
      if (name === 'discard') return m(([x]) => { o.m.delete(keyOf(x)); return null; });
    }
    if (typeof o === 'string') {
      switch (name) {
        case 'join': return m(([x], kw, c) => it(x, c).map(v => { if (typeof v !== 'string') modelError('sequence item: expected str instance', c.span, 'TypeError'); return v; }).join(o));
        case 'split': return m(([sep = null, max]) => new PyList(sep === null ? o.trim().split(/\s+/).filter(Boolean) : (max === undefined ? o.split(sep) : (() => { const parts = o.split(sep); const n = Number(toIntLike(max)); return n < 0 || parts.length <= n + 1 ? parts : [...parts.slice(0, n), parts.slice(n).join(sep)]; })())));
        case 'strip': return m(([ch]) => (ch === undefined || ch === null ? o.trim() : o.replace(new RegExp(`^[${ch.replace(/[\]\\^-]/g, '\\$&')}]+|[${ch.replace(/[\]\\^-]/g, '\\$&')}]+$`, 'g'), '')));
        case 'lstrip': return m(() => o.trimStart());
        case 'rstrip': return m(() => o.trimEnd());
        case 'upper': return m(() => o.toUpperCase());
        case 'lower': return m(() => o.toLowerCase());
        case 'replace': return m(([a, b]) => o.split(a).join(b));
        case 'startswith': return m(([p]) => (p instanceof PyTuple ? p.items.some(x => o.startsWith(x)) : o.startsWith(p)));
        case 'endswith': return m(([p]) => (p instanceof PyTuple ? p.items.some(x => o.endsWith(x)) : o.endsWith(p)));
        case 'format': return m((args, kw, c) => {
          let auto = 0;
          return o.replace(/\{\{|\}\}|\{([^{}:!]*)(?:![rs])?(?::([^{}]*))?\}/g, (whole, field, spec) => {
            if (whole === '{{') return '{'; if (whole === '}}') return '}';
            const v = field === '' ? args[auto++] : /^\d+$/.test(field) ? args[Number(field)] : kw[field];
            return formatValue(v, spec ?? '', c.span, this.kernelRepr);
          });
        });
        case 'zfill': return m(([w]) => o.padStart(Number(toIntLike(w)), '0'));
        case 'ljust': return m(([w, f = ' ']) => o.padEnd(Number(toIntLike(w)), f));
        case 'rjust': return m(([w, f = ' ']) => o.padStart(Number(toIntLike(w)), f));
        case 'center': return m(([w, f = ' ']) => { const n = Number(toIntLike(w)); const pad = Math.max(0, n - o.length); const l = Math.floor(pad / 2) + (pad % 2 && n % 2 ? 1 : 0); return f.repeat(l) + o + f.repeat(pad - l); });
        case 'isdigit': return m(() => /^\d+$/.test(o));
        case 'find': return m(([x]) => BigInt(o.indexOf(x)));
        case 'count': return m(([x]) => BigInt(o.split(x).length - 1));
      }
    }
    capability(`method '${typeName(o)}.${name}' is not in the WPy v0 value library`, span);
  }
  subscript(o, sliceNode, env, span) {
    if (o instanceof EntitySet || o instanceof EntityGroups) {
      const k = this.eval(sliceNode, env);
      if (sliceNode.k === 'Slice') capability('slicing a selection', span);
      const params = { index: Number(toIntLike(k)) };
      if (o instanceof EntityGroups) return new EntitySet(this.node('pick_group', params, [o.node], span, 'entities'), o.owner, o.kind);
      // one solid out of a solid selection is a part again (build123d: solids()[i] is a Solid)
      if (o.kind === 'solids') { const sh = new Shape(this.node('pick', params, [o.node], span, 'body')); sh.meta = { ...o.owner.meta }; return sh; }
      return new EntitySet(this.node('pick', params, [o.node], span, 'entities'), o.owner, o.kind);
    }
    if (sliceNode.k === 'Slice') {
      const get = x => (x ? this.eval(x, env) : null);
      const lo = get(sliceNode.lower), hi = get(sliceNode.upper), st = get(sliceNode.step);
      const seq = typeof o === 'string' ? [...o] : o.items;
      const n = seq.length, step = st === null ? 1 : Number(toIntLike(st));
      if (step === 0) modelError('slice step cannot be zero', span, 'ValueError');
      const norm = (x, d) => { if (x === null) return d; let i = Number(toIntLike(x)); if (i < 0) i += n; return step > 0 ? Math.min(Math.max(i, 0), n) : Math.min(Math.max(i, -1), n - 1); };
      const start = norm(lo, step > 0 ? 0 : n - 1), stop = norm(hi, step > 0 ? n : -1);
      const out = [];
      for (let i = start; step > 0 ? i < stop : i > stop; i += step) out.push(seq[i]);
      if (typeof o === 'string') return out.join('');
      return new o.constructor(out);
    }
    const k = this.eval(sliceNode, env);
    if (o instanceof PyList || o instanceof PyTuple) return o.items[this.index(o, k, span)];
    if (o instanceof PyDict) { if (!o.has(k)) modelError(`KeyError: ${reprOf(k, this.kernelRepr)}`, span, 'KeyError'); return o.get(k); }
    if (typeof o === 'string') return [...o][this.index({ items: [...o] }, k, span)];
    if (o instanceof Vec) return [o.x, o.y, o.z][this.index({ items: [0, 0, 0] }, k, span)];
    if (o instanceof LazyVec) return new Lazy(this.node('pick', { field: o.field, axis: Number(toIntLike(k)) }, [o.node], span, 'value'), 'number');
    modelError(`'${typeName(o)}' object is not subscriptable`, span, 'TypeError');
  }

  // ---- calls
  call(e, env) {
    const f = this.eval(e.func, env);
    const args = this.evalElts(e.args, env);
    const kw = {};
    for (const k of e.keywords) {
      if (k.arg === null) { const d = this.eval(k.value, env); for (const [kk, vv] of d.m.values()) kw[strOf(kk)] = vv; }
      else kw[k.arg] = this.eval(k.value, env);
    }
    if (f instanceof Builtin && f.name === 'dot') return f.fn(args, kw, { span: e.span });
    if (this.isSym(f)) {
      if (f instanceof SymMethod && !args.length) return new SymVec(f.name);
      throw new NotLowerable();
    }
    return this.apply(f, args, kw, e.span, e);
  }
  apply(f, args, kw, span, callNode) {
    if (f instanceof Builtin) return f.fn(args, kw, { span, callNode });
    if (f && f.typeName === 'ShapeTypeNamespace' && f.call) return f.call.fn(args, kw, { span, callNode });
    if (f instanceof BoundMethod) return f.fn(args, kw, { span, callNode });
    if (f instanceof PyExceptionType) return new PyException(f, args.length ? strOf(args[0], this.kernelRepr) : '');
    if (!(f instanceof PyFunction)) modelError(`'${typeName(f)}' object is not callable`, span, 'TypeError');
    if (this.frames.length > this.maxDepth) throw new WpyError('resource', `call depth ${this.maxDepth} exceeded`, span);
    const info = f.isLambda ? { locals: new Set([...f.params.args, ...f.params.kwonly].map(p => p.name)), nonlocals: new Set(), globals: new Set() } : analyzeLocals(f.node);
    const env = new Env(f.env, { fn: true });
    env.info = info;
    this.bindParams(f, args, kw, env, span);
    if (f.isLambda) return this.eval(f.body, env);
    const caller = this.frame;
    const label = this.stmtLabel();
    // occurrence counts are per binding and loop iteration, so ids stay independent of call order elsewhere
    const calls = label ? caller.calls : (caller.anonCalls ??= new Map());
    const occurrenceKey = `${label}|${f.name}`;
    const occurrence = (calls.get(occurrenceKey) ?? 0) + 1;
    calls.set(occurrenceKey, occurrence);
    const fname = occurrence > 1 ? `${f.name}#${occurrence}` : f.name;
    const path = [...caller.path, label, fname].filter(Boolean);
    this.frames.push({ path, stmt: null, loop: [], counters: new Map(), calls: new Map(), name: f.name, span });
    try {
      this.execBlock(f.body, env);
      return null;
    } catch (err) {
      if (err instanceof ReturnSignal) return err.value;
      if (err instanceof WpyError && err.trace.length < 64 && !err._traced?.has(this.frames.length)) {
        err._traced ??= new Set(); err._traced.add(this.frames.length);
        err.trace.push({ name: f.name, span });
      }
      throw err;
    } finally { this.frames.pop(); }
  }
  bindParams(f, args, kw, env, span) {
    const p = f.params;
    const positional = [...p.posonly, ...p.args];
    const rest = [];
    args.forEach((a, i) => { if (i < positional.length) env.vars.set(positional[i].name, a); else rest.push(a); });
    if (rest.length && !p.vararg) modelError(`${f.name}() takes ${positional.length} positional arguments but ${args.length} were given`, span, 'TypeError');
    if (p.vararg) env.vars.set(p.vararg.name, new PyTuple(rest));
    const extra = new PyDict();
    for (const [k, v] of Object.entries(kw)) {
      const target = [...p.args, ...p.kwonly].find(x => x.name === k);
      if (target) { if (env.vars.has(k)) modelError(`${f.name}() got multiple values for argument '${k}'`, span, 'TypeError'); env.vars.set(k, v); }
      else if (p.kwarg) extra.set(k, v);
      else modelError(`${f.name}() got an unexpected keyword argument '${k}'`, span, 'TypeError');
    }
    if (p.kwarg) env.vars.set(p.kwarg.name, extra);
    for (const x of [...positional, ...p.kwonly]) {
      if (env.vars.has(x.name)) continue;
      if (!x.default) modelError(`${f.name}() missing required argument '${x.name}'`, span, 'TypeError');
      // defaults are evaluated at call time here; WPy forbids mutable defaults, so this equals def-time evaluation
      env.vars.set(x.name, this.eval(x.default, f.env));
    }
  }

  // ---- kernel nodes for operations not (yet) implemented by the Bend kernel
  literal(v, span) {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return v;
    if (isNumber(v)) return toFloat(v);
    if (v instanceof PyTuple || v instanceof PyList) return v.items.map(x => this.literal(x, span));
    if (v instanceof Vec) return [v.x, v.y, v.z];
    if (v instanceof EnumV) return `${v.type}.${v.name}`;
    if (v instanceof PlaneV) return { origin: v.origin, x: v.x, z: v.z };
    if (v instanceof Loc) return { rows: v.rows, offset: v.t };
    if (v instanceof PyDict) return Object.fromEntries([...v.m.values()].map(([k, x]) => [strOf(k), this.literal(x, span)]));
    capability(`${typeName(v)} cannot be a literal operation parameter`, span);
  }
  gapNode(op, args, kw, span, kind) { // eslint-disable-line max-params
    const inputs = [], params = { args: [], kw: {} };
    const put = (v, slot) => {
      if (v instanceof Shape || v instanceof Sketch || v instanceof EntitySet || v instanceof Curve || v instanceof Lazy) {
        if (v.empty) { slot.push('empty'); return; }
        inputs.push(v.node); slot.push({ input: inputs.length - 1 });
        if (v instanceof EntitySet && !inputs.includes(v.owner.node)) { inputs.push(v.owner.node); }
      } else if (v instanceof PyList && v.items.some(x => x instanceof Shape || x instanceof Sketch || x instanceof EntitySet || x instanceof Curve)) {
        const sub = []; v.items.forEach(x => put(x, sub)); slot.push(sub);
      } else slot.push(this.literal(v, span));
    };
    args.forEach(a => put(a, params.args));
    for (const [k, v] of Object.entries(kw)) { const s = []; put(v, s); params.kw[k] = s[0]; }
    const first = args.find(a => a instanceof Shape || a instanceof Sketch || a instanceof Curve);
    if (first && kind === 'body') kind = first instanceof Curve ? 'curve' : first instanceof Sketch ? 'sketch' : 'body';
    const n = this.node(op, params, inputs, span, kind);
    return kind === 'sketch' ? new Sketch(n) : kind === 'curve' ? new Curve(n) : new Shape(n);
  }

  // ---- builtins and vocabulary
  makeBuiltins() {
    const B = new Map();
    const def = (name, fn) => B.set(name, new Builtin(name, fn));
    const num = (v, span) => toFloat(v, span);
    const ex = n => B.set(n, new PyExceptionType(n, this.exceptionBase(n)));
    ['Exception', 'ValueError', 'TypeError', 'RuntimeError', 'AssertionError', 'KeyError', 'IndexError', 'ZeroDivisionError', 'ArithmeticError', 'LookupError', 'NameError', 'AttributeError', 'OverflowError', 'KernelError', 'ModelError'].forEach(ex);
    def('print', args => { this.log.push(args.map(a => strOf(a instanceof Lazy ? '<measured>' : a, this.kernelRepr)).join(' ')); return null; });
    def('len', ([v], kw, c) => {
      if (v instanceof EntitySet) return new Lazy(this.node('count', {}, [v.node], c.span, 'value'), 'number');
      if (typeof v === 'string') return BigInt([...v].length);
      if (v instanceof PyList || v instanceof PyTuple || v instanceof Compound) return BigInt(v.items.length);
      if (v instanceof PyDict || v instanceof PySet) return BigInt(v.m.size);
      modelError(`object of type '${typeName(v)}' has no len()`, c.span, 'TypeError');
    });
    def('range', (args, kw, c) => {
      const a = args.map(x => { if (typeof x !== 'bigint' && typeof x !== 'boolean') modelError(`'${typeName(x)}' object cannot be interpreted as an integer`, c.span, 'TypeError'); return toIntLike(x); });
      const [start, stop, step] = a.length === 1 ? [0n, a[0], 1n] : [a[0], a[1], a[2] ?? 1n];
      if (step === 0n) modelError('range() arg 3 must not be zero', c.span, 'ValueError');
      const out = [];
      for (let i = start; step > 0n ? i < stop : i > stop; i += step) { out.push(i); if (out.length > 1_000_000) throw new WpyError('resource', 'range too large', c.span); }
      return new PyList(out);
    });
    def('abs', ([v], kw, c) => {
      if (this.isSym(v)) return new SymTerm({ t: 'abs', a: this.symTerm(v) });
      if (v instanceof Lazy) return this.lazyNode('abs', [v], c.span);
      if (typeof v === 'number') return Math.abs(v);
      const i = toIntLike(v); if (typeof i === 'bigint') return i < 0n ? -i : i;
      modelError(`bad operand type for abs(): '${typeName(v)}'`, c.span, 'TypeError');
    });
    const minmax = which => (args, kw, c) => {
      const items = args.length === 1 ? this.iterate(args[0], c.span) : args;
      if (!items.length) { if ('default' in kw) return kw.default; modelError(`${which}() arg is an empty sequence`, c.span, 'ValueError'); }
      if (items.some(x => x instanceof Lazy)) return items.reduce((a, b) => this.lazyNode(which, [a, b], c.span));
      const key = kw.key ? x => this.apply(kw.key, [x], {}, c.span) : x => x;
      return items.reduce((best, x) => { const o = this.order(key(x), key(best), c.span); return (which === 'min' ? o < 0 : o > 0) ? x : best; });
    };
    def('min', minmax('min')); def('max', minmax('max'));
    def('sum', ([it, start = 0n], kw, c) => this.iterate(it, c.span).reduce((a, b) => this.binop('+', a, b, c.span), start));
    def('round', ([v, n], kw, c) => v instanceof Lazy ? this.lazyNode('round', [v, n ?? null], c.span) : pyRound(v, n === undefined ? null : Number(toIntLike(n)), c.span));
    def('int', ([v = 0n], kw, c) => {
      if (typeof v === 'number') { if (!Number.isFinite(v)) modelError('cannot convert float to integer', c.span, 'ValueError'); return BigInt(Math.trunc(v)); }
      if (typeof v === 'string') { if (!/^\s*[+-]?\d+\s*$/.test(v)) modelError(`invalid literal for int(): ${reprOf(v)}`, c.span, 'ValueError'); return BigInt(v.trim()); }
      if (v instanceof Lazy) return this.lazyNode('int', [v], c.span);
      return toIntLike(v);
    });
    def('float', ([v = 0], kw, c) => {
      if (typeof v === 'string') { const t = v.trim().toLowerCase(); if (t === 'inf' || t === '+inf' || t === 'infinity') return Infinity; if (t === '-inf') return -Infinity; if (t === 'nan') return NaN; const x = Number(t); if (!t || Number.isNaN(x)) modelError(`could not convert string to float: ${reprOf(v)}`, c.span, 'ValueError'); return x; }
      if (v instanceof Lazy) return v;
      return num(v, c.span);
    });
    def('str', ([v = '']) => (v instanceof Lazy ? capability('str() of a measured value needs a sync point; use it after the build') : strOf(v, this.kernelRepr)));
    def('repr', ([v]) => reprOf(v, this.kernelRepr));
    def('bool', ([v = false], kw, c) => this.truthy(v, c.span, 'bool()'));
    def('list', ([v], kw, c) => new PyList(v === undefined ? [] : this.iterate(v, c.span, 'list()')));
    def('tuple', ([v], kw, c) => new PyTuple(v === undefined ? [] : this.iterate(v, c.span, 'tuple()')));
    def('set', ([v], kw, c) => { const s = new PySet(); if (v !== undefined) for (const x of this.iterate(v, c.span)) s.m.set(keyOf(x), x); return s; });
    def('dict', ([v], kw) => { const d = new PyDict(); if (v instanceof PyDict) for (const [k, x] of v.m.values()) d.set(k, x); else if (v) for (const p of this.iterate(v)) d.set(p.items[0], p.items[1]); for (const [k, x] of Object.entries(kw)) d.set(k, x); return d; });
    def('sorted', ([v], kw, c) => {
      const items = this.iterate(v, c.span, 'sorted()');
      const key = kw.key ? x => this.apply(kw.key, [x], {}, c.span) : x => x;
      const keyed = items.map((x, i) => [key(x), i, x]);
      keyed.sort((a, b) => this.order(a[0], b[0], c.span) || a[1] - b[1]);
      if (kw.reverse && this.truthy(kw.reverse)) { keyed.reverse(); /* Python keeps stability under reverse=True */ keyed.sort((a, b) => -this.order(a[0], b[0], c.span) || a[1] - b[1]); }
      return new PyList(keyed.map(k => k[2]));
    });
    def('reversed', ([v], kw, c) => new PyList(this.iterate(v, c.span).reverse()));
    def('enumerate', ([v, start = 0n], kw, c) => new PyList(this.iterate(v, c.span).map((x, i) => new PyTuple([toIntLike(start) + BigInt(i), x]))));
    def('zip', (args, kw, c) => { const its = args.map(a => this.iterate(a, c.span)); const n = Math.min(...its.map(i => i.length)); return new PyList(Array.from({ length: n }, (_, i) => new PyTuple(its.map(it => it[i])))); });
    def('any', ([v], kw, c) => this.iterate(v, c.span).some(x => this.truthy(x, c.span, 'any()')));
    def('all', ([v], kw, c) => this.iterate(v, c.span).every(x => this.truthy(x, c.span, 'all()')));
    def('map', ([f, ...its], kw, c) => { const lists = its.map(i => this.iterate(i, c.span)); return new PyList(lists[0].map((_, i) => this.apply(f, lists.map(l => l[i]), {}, c.span))); });
    def('filter', ([f, it], kw, c) => new PyList(this.iterate(it, c.span).filter(x => this.truthy(f === null ? x : this.apply(f, [x], {}, c.span), c.span))));
    def('isinstance', ([v, t], kw, c) => {
      const types = t instanceof PyTuple ? t.items : [t];
      return types.some(ty => (ty instanceof Builtin && ({ int: 'int', float: 'float', str: 'str', list: 'list', tuple: 'tuple', dict: 'dict', bool: 'bool' }[ty.name] === typeName(v) || (ty.name === 'int' && typeof v === 'boolean'))));
    });
    def('divmod', ([a, b], kw, c) => new PyTuple([arith('//', a, b, c.span), arith('%', a, b, c.span)]));
    def('pow', ([a, b], kw, c) => arith('**', a, b, c.span));
    def('chr', ([n]) => String.fromCodePoint(Number(toIntLike(n))));
    def('ord', ([s]) => BigInt(s.codePointAt(0)));
    def('format', ([v, spec = ''], kw, c) => formatValue(v, spec, c.span, this.kernelRepr));
    // ---- math
    const M = new Map();
    const m1 = (name, f) => M.set(name, new Builtin(name, ([x], kw, c) => {
      if (x instanceof Lazy) return this.lazyNode(name, [x], c.span);
      const r = f(num(x, c.span));
      if (Number.isNaN(r) && !Number.isNaN(num(x, c.span))) modelError('math domain error', c.span, 'ValueError');
      return r;
    }));
    for (const [n, f] of Object.entries({ sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
      exp: Math.exp, log10: Math.log10, fabs: Math.abs, cbrt: Math.cbrt, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, degrees: x => x * (180 / Math.PI), radians: x => x * (Math.PI / 180) })) m1(n, f);
    M.set('log', new Builtin('log', ([x, b], kw, c) => (b === undefined ? Math.log(num(x, c.span)) : Math.log(num(x, c.span)) / Math.log(num(b, c.span)))));
    M.set('atan2', new Builtin('atan2', ([y, x], kw, c) => Math.atan2(num(y, c.span), num(x, c.span))));
    M.set('hypot', new Builtin('hypot', (args, kw, c) => Math.hypot(...args.map(a => num(a, c.span)))));
    M.set('copysign', new Builtin('copysign', ([a, b], kw, c) => Math.abs(num(a, c.span)) * (Object.is(num(b, c.span), -0) || num(b, c.span) < 0 ? -1 : 1)));
    M.set('fmod', new Builtin('fmod', ([a, b], kw, c) => num(a, c.span) % num(b, c.span)));
    M.set('floor', new Builtin('floor', ([x], kw, c) => (typeof x === 'bigint' ? x : BigInt(Math.floor(num(x, c.span))))));
    M.set('ceil', new Builtin('ceil', ([x], kw, c) => (typeof x === 'bigint' ? x : BigInt(Math.ceil(num(x, c.span))))));
    M.set('trunc', new Builtin('trunc', ([x], kw, c) => BigInt(Math.trunc(num(x, c.span)))));
    M.set('isclose', new Builtin('isclose', ([a, b], kw, c) => { const x = num(a, c.span), y = num(b, c.span), rt = kw.rel_tol === undefined ? 1e-9 : num(kw.rel_tol), at = kw.abs_tol === undefined ? 0 : num(kw.abs_tol); return x === y || Math.abs(x - y) <= Math.max(rt * Math.max(Math.abs(x), Math.abs(y)), at); }));
    M.set('isfinite', new Builtin('isfinite', ([x], kw, c) => Number.isFinite(num(x, c.span))));
    M.set('pi', Math.PI); M.set('e', Math.E); M.set('tau', 2 * Math.PI); M.set('inf', Infinity); M.set('nan', NaN);
    B.set('__math__', new PyModule('math', M));
    B.set('__wonky__', new PyModule('wonky', this.vocabulary()));
    return B;
  }

  vocabulary() {
    const V = new Map();
    const def = (name, fn) => V.set(name, new Builtin(name, fn));
    const num = (v, span) => toFloat(v, span);
    const vec3 = (v, span) => {
      if (v instanceof Vec) return [v.x, v.y, v.z];
      const items = this.iterate(v, span).map(x => num(x, span));
      if (items.length === 2) items.push(0);
      if (items.length !== 3) modelError('expected a 2- or 3-component vector', span, 'ValueError');
      return items;
    };
    const enums = (type, names) => { const ns = new Map(names.map(n => [n, new EnumV(type, n)])); V.set(type, { typeName: 'ShapeTypeNamespace', attrs: ns }); return ns; };
    enums('Axis', ['X', 'Y', 'Z']);
    const Align = enums('Align', ['MIN', 'CENTER', 'MAX', 'NONE']);
    enums('GeomType', ['LINE', 'CIRCLE', 'ELLIPSE', 'PLANE', 'CYLINDER', 'CONE', 'SPHERE', 'TORUS', 'BSPLINE', 'BEZIER']);
    enums('Kind', ['ARC', 'INTERSECTION', 'TANGENT']);
    enums('Mode', ['ADD', 'SUBTRACT', 'INTERSECT', 'REPLACE', 'PRIVATE']);
    enums('Select', ['ALL', 'LAST', 'NEW']);
    enums('SortBy', ['LENGTH', 'RADIUS', 'AREA', 'VOLUME', 'DISTANCE']);
    enums('FontStyle', ['REGULAR', 'BOLD', 'ITALIC', 'BOLDITALIC']);
    enums('Keep', ['TOP', 'BOTTOM', 'BOTH', 'INSIDE', 'OUTSIDE']);
    enums('Until', ['NEXT', 'LAST', 'PREVIOUS', 'FIRST']);
    enums('Transition', ['RIGHT', 'ROUND', 'TRANSFORMED']);
    const alignOf = (v, n, def0, span) => {
      if (v === undefined) return Array(n).fill(def0);
      if (v === null) return Array(n).fill('NONE');
      if (v instanceof EnumV) return Array(n).fill(v.name);
      const items = this.iterate(v, span).map(x => x instanceof EnumV ? x.name : capability('align must use Align members', span));
      if (items.length !== n) modelError(`align needs ${n} members`, span, 'ValueError');
      return items;
    };
    // ---- 3D primitives
    def('Box', (args, kw, c) => {
      const [l, w, h] = [args[0] ?? kw.length, args[1] ?? kw.width, args[2] ?? kw.height].map(x => num(x, c.span));
      if (!(l > 0 && w > 0 && h > 0)) modelError('Box dimensions must be positive', c.span, 'ValueError');
      const align = alignOf(kw.align, 3, 'CENTER', c.span);
      if (kw.rotation !== undefined || kw.mode !== undefined) capability('Box rotation=/mode= (builder mode)', c.span);
      return new Shape(this.node('box', { size: [l, w, h], align }, [], c.span, 'body'));
    });
    def('Cylinder', (args, kw, c) => {
      const [r, h] = [args[0] ?? kw.radius, args[1] ?? kw.height].map(x => num(x, c.span));
      if (kw.arc_size !== undefined && num(kw.arc_size) !== 360) capability('partial cylinders (arc_size)', c.span);
      return new Shape(this.node('cylinder', { radius: r, height: h, align: alignOf(kw.align, 3, 'CENTER', c.span) }, [], c.span, 'body'));
    });
    for (const g of ['Cone', 'Sphere', 'Torus', 'Wedge']) def(g, (args, kw, c) => this.gapNode(g.toLowerCase(), args, kw, c.span, 'body'));
    def('Part', (args, kw, c) => { if (args.length) capability('Part(...) with children', c.span); return new Shape(null, { empty: true }); });
    def('Compound', (args, kw, c) => new Compound(this.iterate(kw.children ?? args[0] ?? new PyList(), c.span)));
    // ---- 2D sketches
    def('Polygon', (args, kw, c) => {
      const pts = (args.length === 1 && (args[0] instanceof PyList) ? args[0].items : args).map(p => vec3(p, c.span).slice(0, 2));
      const align = alignOf(kw.align, 2, 'CENTER', c.span);
      return new Sketch(this.node('polygon', { points: pts, align }, [], c.span, 'sketch'));
    });
    def('Rectangle', (args, kw, c) => {
      const [w, h] = [args[0] ?? kw.width, args[1] ?? kw.height].map(x => num(x, c.span));
      return new Sketch(this.node('rectangle', { size: [w, h], align: alignOf(kw.align, 2, 'CENTER', c.span) }, [], c.span, 'sketch'));
    });
    def('Circle', (args, kw, c) => new Sketch(this.node('circle', { radius: num(args[0] ?? kw.radius, c.span), align: alignOf(kw.align, 2, 'CENTER', c.span) }, [], c.span, 'sketch')));
    def('Sketch', () => new Sketch(null, { empty: true }));
    for (const g of ['RectangleRounded', 'Ellipse', 'Text', 'RegularPolygon', 'SlotOverall', 'SlotCenterToCenter', 'Trapezoid']) def(g, (args, kw, c) => this.gapNode(g.replace(/[A-Z]/g, (m, i) => (i ? '_' : '') + m.toLowerCase()), args, kw, c.span, 'sketch'));
    for (const g of ['Line', 'Polyline', 'ThreePointArc', 'Spline', 'CenterArc', 'RadiusArc', 'TangentArc']) def(g, (args, kw, c) => this.gapNode(g.replace(/[A-Z]/g, (m, i) => (i ? '_' : '') + m.toLowerCase()), args, kw, c.span, 'curve'));
    // FeatureScript opOffsetFace has no build123d counterpart; WPy names it explicitly
    def('offset_faces', (args, kw, c) => this.gapNode('offset_faces', args, kw, c.span, 'body'));
    def('frozen_import', (args, kw, c) => this.gapNode('frozen_import', args, kw, c.span, 'body'));
    for (const g of ['import_step', 'import_stl', 'import_brep']) def(g, (args, kw, c) => this.gapNode(g, args, kw, c.span, 'body'));
    def('make_face', (args, kw, c) => this.gapNode('make_face', args, kw, c.span, 'sketch'));
    // ---- placement
    def('Pos', (args, kw, c) => {
      let t = args.length === 1 ? vec3(args[0], c.span) : [args[0] ?? kw.X ?? 0, args[1] ?? kw.Y ?? 0, args[2] ?? kw.Z ?? 0].map(x => num(x, c.span));
      return Loc.translation(t);
    });
    def('Rot', (args, kw, c) => {
      const [x, y, z] = args.length === 1 ? vec3(args[0], c.span) : [args[0] ?? kw.X ?? 0, args[1] ?? kw.Y ?? 0, args[2] ?? kw.Z ?? 0].map(v => num(v, c.span));
      // build123d default ordering Intrinsic.XYZ: R = Rx * Ry * Rz
      return new Loc(mul(mul(rotX(x * deg), rotY(y * deg)), rotZ(z * deg)), [0, 0, 0]);
    });
    def('Location', (args, kw, c) => {
      const t = args[0] === undefined ? [0, 0, 0] : vec3(args[0], c.span);
      if (args[1] === undefined) return Loc.translation(t);
      const [x, y, z] = vec3(args[1], c.span);
      return new Loc(mul(mul(rotX(x * deg), rotY(y * deg)), rotZ(z * deg)), t);
    });
    def('Vector', (args, kw, c) => { const v = args.length === 1 ? vec3(args[0], c.span) : [args[0] ?? 0, args[1] ?? 0, args[2] ?? 0].map(x => num(x, c.span)); return new Vec(...v); });
    const planes = { XY: new PlaneV([0, 0, 0], [1, 0, 0], [0, 0, 1]), XZ: new PlaneV([0, 0, 0], [1, 0, 0], [0, -1, 0]), YZ: new PlaneV([0, 0, 0], [0, 1, 0], [1, 0, 0]),
      YX: new PlaneV([0, 0, 0], [0, 1, 0], [0, 0, -1]), ZX: new PlaneV([0, 0, 0], [0, 0, 1], [0, 1, 0]), ZY: new PlaneV([0, 0, 0], [0, 0, 1], [-1, 0, 0]) };
    const PlaneCtor = new Builtin('Plane', (args, kw, c) => {
      const origin = vec3(args[0] ?? kw.origin ?? new PyTuple([0, 0, 0]), c.span);
      const z = unit(vec3(args[2] ?? kw.z_dir ?? new PyTuple([0, 0, 1]), c.span), c.span);
      let x = kw.x_dir ?? args[1];
      if (x === undefined || x === null) { const cand = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]; const d = cand[0] * z[0] + cand[1] * z[1] + cand[2] * z[2]; x = unit(cand.map((v, i) => v - d * z[i]), c.span); }
      else x = unit(vec3(x, c.span), c.span);
      if (Math.abs(x[0] * z[0] + x[1] * z[1] + x[2] * z[2]) > 1e-9) modelError('Plane x_dir must be perpendicular to z_dir', c.span, 'ValueError');
      return new PlaneV(origin, x, z);
    });
    V.set('Plane', { typeName: 'ShapeTypeNamespace', attrs: new Map(Object.entries(planes)), call: PlaneCtor });
    // ---- operations
    def('extrude', (args, kw, c) => {
      const sk = args[0] ?? kw.to_extrude;
      const amount = args[1] ?? kw.amount;
      if (!(sk instanceof Sketch)) capability('extrude expects a sketch (a face or a placed 2D profile)', c.span);
      if (kw.dir !== undefined || kw.until !== undefined || kw.taper !== undefined) capability('extrude dir=/until=/taper=', c.span);
      if (amount instanceof Lazy) capability('extrude amount from a measured value (needs measure-arithmetic lowering in the backend)', c.span);
      const both = kw.both === undefined ? false : this.truthy(kw.both, c.span, 'both');
      return new Shape(this.node('extrude', both ? { amount: num(amount, c.span), both: true } : { amount: num(amount, c.span) }, [sk.node], c.span, 'body'));
    });
    for (const g of ['revolve', 'loft', 'sweep', 'offset', 'fillet', 'chamfer', 'mirror', 'split', 'section', 'thicken', 'project', 'scale']) {
      def(g, (args, kw, c) => {
        const first = args[0] ?? kw.objects ?? kw.to_extrude ?? kw.sections;
        const kind = first instanceof Sketch || (first instanceof PyList && first.items[0] instanceof Sketch && g !== 'loft') ? 'sketch' : 'body';
        if ((g === 'fillet' || g === 'chamfer') && first instanceof EntitySet) {
          // build123d: fillet(edges, r) returns the edges' owner with rounded edges
          const n = this.node(g, { size: num(args[1] ?? kw.radius ?? kw.length, c.span) }, [first.owner.node, first.node], c.span, 'body');
          const s = new Shape(n); s.meta = { ...first.owner.meta }; return s;
        }
        return this.gapNode(g, args, kw, c.span, kind);
      });
    }
    // ---- wonky extensions (also provided by the Python shim src/lang/surface/py/wonky.py)
    def('param', (args, kw) => args[0] ?? kw.default);
    def('expect', (args, kw, c) => { this.addCheck(args[0], args[1] === undefined ? (kw.message ?? 'expect') : strOf(args[1], this.kernelRepr), c.span); return null; });
    // ---- outputs (main-block IO becomes named outputs; nothing touches the file system)
    const exporter = fmt => (args, kw, c) => {
      const path = strOf(args[1] ?? kw.file_path ?? fmt, this.kernelRepr);
      const stem = path.split('/').at(-1).replace(/\.[^.]*$/, '');
      this.addOutputs(stem, args[0], c.span);
      return null;
    };
    for (const f of ['export_stl', 'export_step', 'export_brep', 'export_gltf']) def(f, exporter(f));
    def('show', () => null); def('show_object', () => null);
    def('Color', (args) => new PyTuple(args.map(a => (typeof a === 'string' ? a : toFloat(a)))));
    return V;
  }
}


export function evaluateWpy(source, { file = '<wpy>', params = {}, backend = null, maxSteps } = {}) {
  const ast = parse(source, { file });
  const ev = new Evaluator({ file, source, params, backend, maxSteps });
  ev.run(ast);
  return ev;
}
