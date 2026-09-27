// Host compiler of the Bend core-language spike: a small S-expression text
// form -> resolved core AST -> compact integer stream that
// kernel/lang/spike/frontend.bend decodes natively. The encoding is
// documented in docs/language/bend-feasibility.md and at the top of
// frontend.bend; opcodes and error codes are mirrored from core.bend.
//
// Text form (one program = top-level forms, the last one is the result):
//   (def name (p1 p2 ..) body)    recursive function, visible to later forms
//   (let name expr)               top-level binding, visible to later forms
//   expr
// Expressions:
//   12  -1.5  "text"  true  false  unit  name
//   (fn (p ..) body)  (let ((x e) ..) body)  (if c t e)  (and a b)  (or a b)
//   (list e ..)  (par a b)  (prim-or-builtin e ..)  (f e ..)
// There is no mutual recursion between top-level defs (a def only sees the
// defs above it), exactly like Bend itself.

export class CoreCompileError extends Error {
  constructor(message, loc) { super(`${message} at ${loc.line}:${loc.column}`); this.loc = loc; }
}

// Opcode table = frontend.bend `op_of`. arity -1 = variadic (checked natively).
export const PRIMS = {
  '+': [0, 2], '-': [1, 2], '*': [2, 2], '/': [3, 2], '<': [4, 2], '<=': [5, 2], '=': [6, 2],
  not: [7, 1], neg: [8, 1], cons: [9, 2], head: [10, 1], tail: [11, 1], 'empty?': [12, 1], len: [13, 1],
  nth: [14, 2], append: [15, 2], 'map-new': [16, 0], 'map-set': [17, 3], 'map-get': [18, 3], 'map-has': [19, 2],
  'str++': [20, 2], error: [21, 1], extrude: [22, 3], union: [23, 2], subtract: [24, 2], volume: [25, 1], faces: [26, 1],
};
export const KERNEL_OPS = new Set(['extrude', 'union', 'subtract', 'volume', 'faces']);
export const ERROR_CODES = { 1: 'user', 2: 'type', 3: 'arity', 4: 'unbound', 5: 'fuel', 6: 'capability', 7: 'decode', 8: 'not-callable', 9: 'index' };
const SUGAR = { '>': '<', '>=': '<=' };

// --- reader --------------------------------------------------------------------
export function read(text) {
  const forms = []; let i = 0, line = 1, column = 1;
  const loc = () => ({ line, column, offset: i });
  const bump = () => { if (text[i] === '\n') { line++; column = 1; } else column++; i++; };
  const skip = () => {
    for (;;) {
      if (i < text.length && /\s/.test(text[i])) bump();
      else if (text[i] === ';') while (i < text.length && text[i] !== '\n') bump();
      else return;
    }
  };
  const datum = () => {
    skip();
    const start = loc();
    if (i >= text.length) throw new CoreCompileError('unexpected end of input', start);
    if (text[i] === '(') {
      bump(); const items = [];
      for (;;) {
        skip();
        if (i >= text.length) throw new CoreCompileError('unclosed (', start);
        if (text[i] === ')') { bump(); break; }
        items.push(datum());
      }
      return { kind: 'list', items, loc: start, end: loc() };
    }
    if (text[i] === ')') throw new CoreCompileError('unexpected )', start);
    if (text[i] === '"') {
      bump(); let value = '';
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\') { bump(); value += { n: '\n', t: '\t', '"': '"', '\\': '\\' }[text[i]] ?? text[i]; }
        else value += text[i];
        bump();
      }
      if (i >= text.length) throw new CoreCompileError('unterminated string', start);
      bump();
      return { kind: 'string', value, loc: start, end: loc() };
    }
    let raw = '';
    while (i < text.length && !/[\s()";]/.test(text[i])) { raw += text[i]; bump(); }
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(raw)) return { kind: 'number', value: Number(raw), raw, loc: start, end: loc() };
    return { kind: 'symbol', name: raw, loc: start, end: loc() };
  };
  for (;;) { skip(); if (i >= text.length) break; forms.push(datum()); }
  return forms;
}

// --- resolution to core AST ------------------------------------------------------
// Core AST nodes: {t:'num',v} {t:'str',s} {t:'bool',b} {t:'unit'} {t:'var',i}
// {t:'lam',arity,body} {t:'rec',arity,body} {t:'app',span,f,args}
// {t:'let',x,body} {t:'if',span,c,th,el} {t:'prim',span,op,args}
// {t:'list',items} {t:'par',a,b}
export function compile(text, { file = '<core>' } = {}) {
  const spans = [null];
  const span = (d, label) => { spans.push({ file, line: d.loc.line, column: d.loc.column, endLine: d.end.line, endColumn: d.end.column, label }); return spans.length - 1; };
  const sym = (d, what) => { if (d?.kind !== 'symbol') throw new CoreCompileError(`expected ${what}`, d?.loc ?? { line: 0, column: 0 }); return d.name; };
  const params = d => { if (d?.kind !== 'list') throw new CoreCompileError('expected a parameter list', d.loc); return d.items.map(p => sym(p, 'a parameter name')); };
  const lookup = (env, name, d) => {
    const i = env.indexOf(name);
    if (i < 0) throw new CoreCompileError(`unbound name '${name}'`, d.loc);
    return { t: 'var', i };
  };
  const expr = (d, env) => {
    switch (d.kind) {
      case 'number': return { t: 'num', v: d.value };
      case 'string': return { t: 'str', s: d.value };
      case 'symbol':
        if (d.name === 'true' || d.name === 'false') return { t: 'bool', b: d.name === 'true' };
        if (d.name === 'unit') return { t: 'unit' };
        return lookup(env, d.name, d);
      case 'list': break;
    }
    const [head, ...rest] = d.items;
    if (!head) throw new CoreCompileError('empty application', d.loc);
    const name = head.kind === 'symbol' && !env.includes(head.name) ? head.name : null;
    switch (name) {
      case 'fn': {
        const ps = params(rest[0]);
        return { t: 'lam', arity: ps.length, body: expr(rest[1], [...ps].reverse().concat(env)) };
      }
      case 'let': {
        if (rest[0]?.kind !== 'list') throw new CoreCompileError('expected (let ((name expr) ..) body)', d.loc);
        const bind = (bindings, scope) => {
          if (!bindings.length) return expr(rest[1], scope);
          const [b, ...more] = bindings;
          if (b.kind !== 'list' || b.items.length !== 2) throw new CoreCompileError('expected (name expr)', b.loc);
          const n = sym(b.items[0], 'a binding name');
          return { t: 'let', x: expr(b.items[1], scope), body: bind(more, [n, ...scope]) };
        };
        return bind(rest[0].items, env);
      }
      case 'if': {
        if (rest.length !== 3) throw new CoreCompileError('if expects condition, then, else', d.loc);
        return { t: 'if', span: span(d, 'if'), c: expr(rest[0], env), th: expr(rest[1], env), el: expr(rest[2], env) };
      }
      case 'and': return { t: 'if', span: span(d, 'and'), c: expr(rest[0], env), th: expr(rest[1], env), el: { t: 'bool', b: false } };
      case 'or': return { t: 'if', span: span(d, 'or'), c: expr(rest[0], env), th: { t: 'bool', b: true }, el: expr(rest[1], env) };
      case 'list': return { t: 'list', items: rest.map(x => expr(x, env)) };
      case 'par': {
        if (rest.length !== 2) throw new CoreCompileError('par expects two list-valued expressions', d.loc);
        return { t: 'par', a: expr(rest[0], env), b: expr(rest[1], env) };
      }
    }
    if (name && (Object.hasOwn(PRIMS, name) || Object.hasOwn(SUGAR, name) || name === '!=')) {
      if (name === '!=') return { t: 'prim', span: span(d, 'not'), op: PRIMS.not[0], args: [{ t: 'prim', span: span(d, '='), op: PRIMS['='][0], args: rest.map(x => expr(x, env)) }] };
      const op = SUGAR[name] ?? name;
      const args = rest.map(x => expr(x, env));
      return { t: 'prim', span: span(d, name), op: PRIMS[op][0], args: SUGAR[name] ? args.reverse() : args };
    }
    return { t: 'app', span: span(d, head.kind === 'symbol' ? head.name : 'call'), f: expr(head, env), args: rest.map(x => expr(x, env)) };
  };
  const forms = read(text);
  if (!forms.length) throw new CoreCompileError('empty program', { line: 1, column: 1 });
  const top = (i, env) => {
    const d = forms[i];
    const last = i === forms.length - 1;
    const keyword = d.kind === 'list' && d.items[0]?.kind === 'symbol' ? d.items[0].name : null;
    if (keyword === 'def' || (keyword === 'let' && d.items[1]?.kind === 'symbol')) {
      if (last) throw new CoreCompileError('a program must end with an expression', d.loc);
      const name = sym(d.items[1], 'a name');
      if (keyword === 'let') return { t: 'let', x: expr(d.items[2], env), body: top(i + 1, [name, ...env]) };
      const ps = params(d.items[2]);
      const fn = { t: 'rec', arity: ps.length, body: expr(d.items[3], [...ps].reverse().concat([name], env)) };
      return { t: 'let', x: fn, body: top(i + 1, [name, ...env]) };
    }
    if (!last) throw new CoreCompileError('only the last top-level form may be an expression', d.loc);
    return expr(d, env);
  };
  const ast = top(0, []);
  return { ast, spans };
}

// --- F32x2 number encoding ---------------------------------------------------------
const f32 = Math.fround;
function word(x) {
  if (x === 0) return [0, 0, 200];
  const s = x < 0 ? 1 : 0; let a = Math.abs(x), k = 0;
  while (a >= 2 ** 24) { a /= 2; k++; }
  while (!Number.isInteger(a) && a < 2 ** 23) { a *= 2; k--; }
  if (!Number.isInteger(a) || a >= 2 ** 24) throw new Error(`not an F32 value: ${x}`);
  return [s, a, k + 200];
}
export function splitReal(x) {
  if (!Number.isFinite(x)) throw new Error(`non-finite number literal ${x}`);
  const hi = f32(x), lo = f32(x - hi);
  return { hi, lo, exact: hi + lo === x };
}

// --- integer stream ---------------------------------------------------------------
export function encode(ast) {
  const out = [];
  const node = n => {
    switch (n.t) {
      case 'num': { const { hi, lo } = splitReal(n.v); out.push(0, ...word(hi), ...word(lo)); return; }
      case 'str': { const cs = [...n.s].map(c => c.codePointAt(0)); out.push(1, cs.length, ...cs); return; }
      case 'bool': out.push(n.b ? 2 : 3); return;
      case 'unit': out.push(4); return;
      case 'var': out.push(5, n.i); return;
      case 'lam': out.push(6, n.arity); node(n.body); return;
      case 'rec': out.push(7, n.arity); node(n.body); return;
      case 'app': out.push(8, n.span, n.args.length); node(n.f); n.args.forEach(node); return;
      case 'let': out.push(9); node(n.x); node(n.body); return;
      case 'if': out.push(10, n.span); node(n.c); node(n.th); node(n.el); return;
      case 'prim': out.push(11, n.span, n.op, n.args.length); n.args.forEach(node); return;
      case 'list': out.push(12, n.items.length); n.items.forEach(node); return;
      case 'par': out.push(13); node(n.a); node(n.b); return;
      default: throw new Error(`unknown core node ${n.t}`);
    }
  };
  node(ast);
  return out;
}

export function compileToStream(text, options) {
  const { ast, spans } = compile(text, options);
  const ints = encode(ast);
  return { ast, spans, ints, text: ints.join(' ') };
}

// Maps a native error value back to its source span and enclosing call trace.
export function explainError(value, spans) {
  if (!value || typeof value !== 'object' || !('error' in value)) return null;
  const at = id => spans[id] ?? null;
  return { code: value.error, kind: ERROR_CODES[value.error] ?? 'unknown', message: value.message, at: at(value.span), trace: (value.trace ?? []).map(at) };
}
