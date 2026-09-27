// JavaScript reference evaluator for the core AST of src/lang/spike-compile.mjs.
// Same semantics as kernel/lang/spike/core.bend (errors are values carrying a
// span id and a call trace; the first error wins; no kernel builtins), but
// numbers are JS doubles instead of F32x2. It exists as a correctness oracle
// for pure programs and to count evaluated AST nodes (one per TEval step in
// the Bend evaluator), which turns wall time into time per node.
import { KERNEL_OPS, PRIMS } from './spike-compile.mjs';

// Lists are immutable cons cells (like the Bend List), so cons/head/tail are
// O(1) and the per-node comparison with the native evaluator is fair.
class Cons { constructor(h, t) { this.h = h; this.t = t; } }
const NIL = new Cons(undefined, undefined);
const isList = v => v instanceof Cons;
const fromArray = xs => xs.reduceRight((t, h) => new Cons(h, t), NIL);
const lengthOf = xs => { let n = 0; for (let c = xs; c !== NIL; c = c.t) n++; return n; };
export const toJS = v => {
  if (isList(v)) { const out = []; for (let c = v; c !== NIL; c = c.t) out.push(toJS(c.h)); return out; }
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [k, toJS(x)]));
  return v;
};

const OPS = Object.fromEntries(Object.entries(PRIMS).map(([name, [code]]) => [code, name]));
const err = (code, span, message) => ({ error: code, span, message, trace: [] });
const isErr = v => v !== null && typeof v === 'object' && 'error' in v;
const typeOf = v => typeof v === 'number' ? 'num' : typeof v === 'boolean' ? 'bool' : typeof v === 'string' ? 'str'
  : v === null ? 'unit' : isList(v) ? 'list' : v instanceof Map ? 'map' : v?.closure ? 'clo' : 'err';

export function evaluate(ast, { maxDepth = 1e7 } = {}) {
  let nodes = 0;
  const prim = (span, op, xs) => {
    const name = OPS[op];
    const bad = xs.find(isErr); if (bad) return bad;
    const want = PRIMS[name][1];
    if (want >= 0 && xs.length !== want && name !== 'map-new') return err(3, span, `${name} expects ${want} arguments`);
    const [a, b, c] = xs;
    const nums = () => typeof a === 'number' && typeof b === 'number';
    switch (name) {
      case '+': case '-': case '*': case '/': case '<': case '<=':
        if (!nums()) return err(2, span, 'arithmetic expects numbers');
        return name === '+' ? a + b : name === '-' ? a - b : name === '*' ? a * b : name === '/' ? a / b : name === '<' ? a < b : a <= b;
      case '=': {
        const ta = typeOf(a);
        if (!['num', 'bool', 'str', 'unit'].includes(ta)) return err(2, span, '= compares numbers, booleans, strings or unit');
        return ta === typeOf(b) && a === b;
      }
      case 'not': case 'neg':
        return typeof a === 'boolean' ? !a : typeof a === 'number' ? -a : err(2, span, 'not/neg expects a boolean or number');
      case 'cons': return isList(b) ? new Cons(a, b) : err(2, span, 'cons expects a list as second argument');
      case 'head': case 'tail': case 'empty?': case 'len':
        if (!isList(a)) return err(2, span, 'list operation expects a list');
        if (name === 'empty?') return a === NIL;
        if (name === 'len') return lengthOf(a);
        if (a === NIL) return err(9, span, `${name} of empty list`);
        return name === 'head' ? a.h : a.t;
      case 'nth': {
        if (!isList(a)) return err(2, span, 'nth expects a list');
        if (!Number.isInteger(b) || b < 0) return err(9, span, 'list index must be a non-negative integer');
        let c = a; for (let i = 0; i < b && c !== NIL; i++) c = c.t;
        return c !== NIL ? c.h : err(9, span, 'list index out of range');
      }
      case 'append': {
        if (!isList(a) || !isList(b)) return err(2, span, 'append expects lists');
        const xs = []; for (let c = a; c !== NIL; c = c.t) xs.push(c.h);
        return xs.reduceRight((t, h) => new Cons(h, t), b);
      }
      case 'map-new': return new Map();
      case 'map-set': return a instanceof Map && typeof b === 'string' ? new Map(a).set(b, c) : err(2, span, 'map-set expects a map and a string key');
      case 'map-get': return a instanceof Map && typeof b === 'string' ? (a.has(b) ? a.get(b) : c) : err(2, span, 'map-get expects a map and a string key');
      case 'map-has': return a instanceof Map && typeof b === 'string' ? a.has(b) : err(2, span, 'map-has expects a map and a string key');
      case 'str++': return typeof a === 'string' && typeof b === 'string' ? a + b : err(2, span, 'str++ expects strings');
      case 'error': return err(1, span, typeof a === 'string' ? a : 'error raised with a non-string value');
      default: return KERNEL_OPS.has(name) ? err(6, span, `kernel builtin '${name}' is not available in the JS reference evaluator`)
        : err(6, span, 'primitive is not available in this evaluator build');
    }
  };
  // Arguments stay a JS array; list literals become cons lists.
  const args = (es, env, depth) => {
    const out = [];
    for (const e of es) { const v = ev(e, env, depth); if (isErr(v)) return v; out.push(v); }
    return out;
  };
  const ev = (n, env, depth) => {
    nodes++;
    if (depth > maxDepth) return err(5, 0, 'evaluation depth fuel exhausted');
    switch (n.t) {
      case 'num': return n.v;
      case 'str': return n.s;
      case 'bool': return n.b;
      case 'unit': return null;
      case 'var': return n.i < env.length ? env[env.length - 1 - n.i] : err(4, 0, 'unbound variable index');
      case 'lam': case 'rec': return { closure: true, arity: n.arity, rec: n.t === 'rec', body: n.body, env };
      case 'let': { const x = ev(n.x, env, depth + 1); return isErr(x) ? x : ev(n.body, [...env, x], depth + 1); }
      case 'if': {
        const c = ev(n.c, env, depth + 1);
        if (isErr(c)) return c;
        if (typeof c !== 'boolean') return err(2, n.span, 'if condition must be a boolean');
        return ev(c ? n.th : n.el, env, depth + 1);
      }
      case 'prim': { const xs = args(n.args, env, depth + 1); return isErr(xs) ? xs : prim(n.span, n.op, xs); }
      case 'list': { const xs = args(n.items, env, depth + 1); return isErr(xs) ? xs : fromArray(xs); }
      case 'par': {
        const a = ev(n.a, env, depth + 1), b = ev(n.b, env, depth + 1);
        if (isErr(a)) return a;
        return isList(a) && isList(b) ? prim(0, PRIMS.append[0], [a, b]) : b;
      }
      case 'app': {
        const f = ev(n.f, env, depth + 1);
        const xs = args(n.args, env, depth + 1);
        let v;
        if (isErr(f)) v = f;
        else if (!f?.closure) v = err(8, n.span, 'value is not callable');
        else if (isErr(xs)) v = xs;
        else if (xs.length !== f.arity) v = err(3, n.span, `closure expects ${f.arity} arguments, got ${xs.length}`);
        else v = ev(f.body, [...(f.rec ? [...f.env, f] : f.env), ...xs], depth + 1);
        if (isErr(v)) return { ...v, trace: [n.span, ...v.trace] };
        return v;
      }
      default: throw new Error(`unknown core node ${n.t}`);
    }
  };
  const value = toJS(ev(ast, [], 0));
  return { value, nodes };
}
