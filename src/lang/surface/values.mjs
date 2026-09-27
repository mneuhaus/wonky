// Value layer of the WPy host evaluator. Python semantics for the subset:
// int is arbitrary precision (BigInt), float is IEEE binary64 (JS number), bool
// is a separate type that behaves as int in arithmetic, str is a JS string,
// list/dict/set are mutable with aliasing, tuple is immutable. Float formatting
// follows CPython's repr/str/format rules, because formatted numbers end up in
// names, ids and messages. Kernel values (shapes, sketches, lazy measures) are
// defined in eval.mjs; this module only knows them through `kernelRepr`.

export class WpyError extends Error {
  // kind: 'syntax' | 'capability' | 'model' | 'resource' | 'check'
  constructor(kind, message, span, { pyType = null, trace = [], hint = null } = {}) {
    super(message);
    this.name = 'WpyError';
    this.kind = kind;
    this.span = span ?? null;
    this.pyType = pyType ?? { capability: 'CapabilityError', model: 'ModelError', resource: 'ResourceError', syntax: 'SyntaxError', check: 'CheckError' }[kind];
    this.trace = trace;
    this.hint = hint;
  }
  // `file:line:col: kind error: message`, the source line with a caret, the
  // call trace, and the hint. Same shape as wonky's FeatureScript errors.
  format(source) {
    const s = this.span;
    const head = `${s?.file ?? '<wpy>'}${s ? `:${s.line}:${s.col}` : ''}: ${this.kind} error: ${this.message}`;
    const lines = [head];
    if (s && source) {
      const text = source.split('\n')[s.line - 1];
      if (text !== undefined) lines.push(`  ${String(s.line).padStart(4)} | ${text}`, `       | ${' '.repeat(Math.max(0, s.col - 1))}^`);
    }
    for (const t of this.trace) lines.push(`    in ${t.name} called at ${t.span?.line}:${t.span?.col}`);
    if (this.hint) lines.push(`  hint: ${this.hint}`);
    return lines.join('\n');
  }
}

export const capability = (message, span, hint) => { throw new WpyError('capability', message, span, { hint }); };
export const modelError = (message, span, pyType = 'ModelError') => { throw new WpyError('model', message, span, { pyType }); };

export class PyList { constructor(items = []) { this.items = items; } }
export class PyTuple { constructor(items = []) { this.items = items; } }
export class PySet { constructor() { this.m = new Map(); } }
export class PyDict {
  constructor() { this.m = new Map(); }
  get(k) { return this.m.get(keyOf(k))?.[1]; }
  has(k) { return this.m.has(keyOf(k)); }
  set(k, v) { const key = keyOf(k); const old = this.m.get(key); this.m.set(key, [old ? old[0] : k, v]); }
  delete(k) { return this.m.delete(keyOf(k)); }
}
export class Builtin { constructor(name, fn) { this.name = name; this.fn = fn; } }
export class BoundMethod { constructor(self, name, fn) { this.self = self; this.name = name; this.fn = fn; } }
export class PyModule { constructor(name, attrs) { this.name = name; this.attrs = attrs; } }
export class PyExceptionType { constructor(name, base = null) { this.name = name; this.base = base; } }
export class PyException { constructor(type, message) { this.type = type; this.message = message; } }

export const isInt = v => typeof v === 'bigint';
export const isFloat = v => typeof v === 'number';
export const isNumber = v => typeof v === 'bigint' || typeof v === 'number' || typeof v === 'boolean';
export const isSeq = v => v instanceof PyList || v instanceof PyTuple;

// Hash key for dict/set membership: 1 == 1.0 == True share a key, as in Python.
export function keyOf(v) {
  if (v === null) return 'N';
  if (typeof v === 'boolean') return `n:${v ? 1 : 0}`;
  if (typeof v === 'bigint') return `n:${v}`;
  if (typeof v === 'number') return Number.isInteger(v) && Math.abs(v) < 2 ** 63 ? `n:${BigInt(v)}` : `f:${v}`;
  if (typeof v === 'string') return `s:${v}`;
  if (v instanceof PyTuple) return `t:(${v.items.map(keyOf).join(',')})`;
  if (v && typeof v === 'object' && 'hashKey' in v) return v.hashKey();
  throw new WpyError('model', `unhashable type: '${typeName(v)}'`, null, { pyType: 'TypeError' });
}

export function typeName(v) {
  if (v === null) return 'NoneType';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'bigint') return 'int';
  if (typeof v === 'number') return 'float';
  if (typeof v === 'string') return 'str';
  if (v instanceof PyList) return 'list';
  if (v instanceof PyTuple) return 'tuple';
  if (v instanceof PyDict) return 'dict';
  if (v instanceof PySet) return 'set';
  if (v?.typeName) return v.typeName;
  if (v instanceof Builtin || v instanceof BoundMethod) return 'builtin_function_or_method';
  if (v?.constructor?.name === 'PyFunction') return 'function';
  return v?.constructor?.name ?? typeof v;
}

// ------------------------------------------------------------------------ numbers
export const toFloat = (v, span) => {
  if (typeof v === 'number') return v;
  if (typeof v === 'bigint') {
    const f = Number(v);
    if (!Number.isFinite(f)) modelError('int too large to convert to float', span, 'OverflowError');
    return f;
  }
  if (typeof v === 'boolean') return v ? 1 : 0;
  modelError(`expected a number, got ${typeName(v)}`, span, 'TypeError');
};
export const toIntLike = v => (typeof v === 'boolean' ? BigInt(v ? 1 : 0) : v);

function floorDivInt(a, b, span) {
  if (b === 0n) modelError('integer division or modulo by zero', span, 'ZeroDivisionError');
  let q = a / b;
  if ((a % b !== 0n) && ((a < 0n) !== (b < 0n))) q -= 1n;
  return [q, a - q * b];
}
function floatDivmod(vx, wx, span) {
  if (wx === 0) modelError('float division by zero', span, 'ZeroDivisionError');
  let mod = vx % wx;
  let div = (vx - mod) / wx;
  if (mod) { if ((wx < 0) !== (mod < 0)) { mod += wx; div -= 1; } }
  else mod = wx < 0 ? -0 : 0; // copysign(0.0, wx)
  let floordiv;
  if (div) { floordiv = Math.floor(div); if (div - floordiv > 0.5) floordiv += 1; }
  else floordiv = (vx / wx < 0 || Object.is(vx / wx, -0)) ? -0 : 0;
  return [floordiv, mod];
}

export function arith(op, a, b, span) {
  a = toIntLike(a); b = toIntLike(b);
  if (typeof a === 'bigint' && typeof b === 'bigint') {
    switch (op) {
      case '+': return a + b;
      case '-': return a - b;
      case '*': return a * b;
      case '/': if (b === 0n) modelError('division by zero', span, 'ZeroDivisionError'); return toFloat(a, span) / toFloat(b, span);
      case '//': return floorDivInt(a, b, span)[0];
      case '%': return floorDivInt(a, b, span)[1];
      case '**': return b >= 0n ? a ** b : Math.pow(toFloat(a, span), toFloat(b, span));
      case '<<': return a << b;
      case '>>': return a >> b;
      case '&': return a & b;
      case '|': return a | b;
      case '^': return a ^ b;
    }
  }
  if (isNumber(a) && isNumber(b)) {
    const x = toFloat(a, span), y = toFloat(b, span);
    switch (op) {
      case '+': return x + y;
      case '-': return x - y;
      case '*': return x * y;
      case '/': if (y === 0) modelError('float division by zero', span, 'ZeroDivisionError'); return x / y;
      case '//': return floatDivmod(x, y, span)[0];
      case '%': return floatDivmod(x, y, span)[1];
      case '**': {
        if (x === 0 && y < 0) modelError('0.0 cannot be raised to a negative power', span, 'ZeroDivisionError');
        const r = Math.pow(x, y);
        if (Number.isNaN(r) && !Number.isNaN(x) && !Number.isNaN(y)) modelError('complex result of a fractional power', span, 'ValueError');
        return r;
      }
    }
  }
  return undefined; // caller tries sequence/string/kernel operators
}

export function compareNumbers(a, b) {
  a = toIntLike(a); b = toIntLike(b);
  if (typeof a === 'bigint' && typeof b === 'bigint') return a < b ? -1 : a > b ? 1 : 0;
  const x = typeof a === 'bigint' ? Number(a) : a, y = typeof b === 'bigint' ? Number(b) : b;
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  return x < y ? -1 : x > y ? 1 : 0;
}

// ------------------------------------------------------------------ formatting
// CPython float repr: shortest round-trip digits; fixed notation when
// -4 <= exponent < 16, otherwise d.ddde+XX; integral values end in ".0".
export function floatRepr(x) {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const [mant, expStr] = x.toExponential().split('e');
  const exp = Number(expStr);
  const neg = mant.startsWith('-');
  const digits = mant.replace('-', '').replace('.', '');
  let out;
  if (exp >= -5 + 1 && exp < 16) {
    if (exp >= 0) {
      const intPart = digits.slice(0, exp + 1).padEnd(exp + 1, '0');
      const frac = digits.slice(exp + 1);
      out = `${intPart}.${frac || '0'}`;
    } else out = `0.${'0'.repeat(-exp - 1)}${digits}`;
  } else {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    out = `${m}e${exp < 0 ? '-' : '+'}${String(Math.abs(exp)).padStart(2, '0')}`;
  }
  return (neg ? '-' : '') + out;
}

export function strOf(v, kernelRepr) {
  if (typeof v === 'string') return v;
  return reprOf(v, kernelRepr);
}
export function reprOf(v, kernelRepr) {
  if (v === null) return 'None';
  if (v === undefined) return '<undefined>';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') return floatRepr(v);
  if (typeof v === 'string') return pyStringRepr(v);
  if (v instanceof PyList) return `[${v.items.map(x => reprOf(x, kernelRepr)).join(', ')}]`;
  if (v instanceof PyTuple) return v.items.length === 1 ? `(${reprOf(v.items[0], kernelRepr)},)` : `(${v.items.map(x => reprOf(x, kernelRepr)).join(', ')})`;
  if (v instanceof PyDict) return `{${[...v.m.values()].map(([k, x]) => `${reprOf(k, kernelRepr)}: ${reprOf(x, kernelRepr)}`).join(', ')}}`;
  if (v instanceof PySet) return v.m.size ? `{${[...v.m.values()].map(x => reprOf(x, kernelRepr)).join(', ')}}` : 'set()';
  if (v instanceof PyException) return `${v.type.name}(${pyStringRepr(v.message)})`;
  if (kernelRepr) { const r = kernelRepr(v); if (r !== undefined) return r; }
  return `<${typeName(v)}>`;
}
function pyStringRepr(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  return q + s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t').replace(new RegExp(q, 'g'), `\\${q}`) + q;
}

// format(value, spec) for the spec grammar [[fill]align][sign][#][0][width][,_][.precision][type]
export function formatValue(v, spec, span, kernelRepr) {
  if (!spec) return strOf(v, kernelRepr);
  const m = /^(?:(.)?([<>=^]))?([+\- ])?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGnosxX%])?$/.exec(spec);
  if (!m) capability(`format spec '${spec}' is not supported`, span);
  let [, fill = ' ', align, sign = '-', , zero, width, group, precision, type] = m;
  if (zero && !align) { fill = '0'; align = '='; }
  let body, neg = false;
  const prec = precision === undefined ? undefined : Number(precision);
  if (typeof v === 'string') {
    if (type && type !== 's') modelError(`Unknown format code '${type}' for object of type 'str'`, span, 'ValueError');
    body = prec === undefined ? v : v.slice(0, prec);
    align ??= '<';
  } else if (isNumber(v)) {
    const isI = typeof v === 'bigint' || typeof v === 'boolean';
    let x = isI ? toIntLike(v) : v;
    if (type === 'd' || (isI && !type)) {
      if (!isI) modelError(`Unknown format code 'd' for object of type 'float'`, span, 'ValueError');
      neg = x < 0n; body = (neg ? -x : x).toString();
    } else {
      x = toFloat(x, span); neg = x < 0 || Object.is(x, -0); const ax = Math.abs(x);
      const t = type ?? (prec === undefined ? 'r' : 'g');
      if (!Number.isFinite(ax)) body = Number.isNaN(ax) ? 'nan' : 'inf';
      else switch (t) {
        case 'f': case 'F': body = ax.toFixed(prec ?? 6); break;
        case 'e': case 'E': body = expFormat(ax, prec ?? 6); if (t === 'E') body = body.toUpperCase(); break;
        case '%': body = (ax * 100).toFixed(prec ?? 6) + '%'; break;
        case 'g': case 'G': body = gFormat(ax, prec ?? 6, false); break;
        case 'r': body = floatRepr(ax); break;
        default: capability(`format type '${t}' is not supported for numbers`, span);
      }
    }
    if (group) {
      const [ip, fp] = body.split('.');
      body = ip.replace(/\B(?=(\d{3})+(?!\d))/g, group) + (fp !== undefined ? '.' + fp : '');
    }
    align ??= '>';
  } else {
    body = strOf(v, kernelRepr); align ??= '<';
  }
  const signStr = neg ? '-' : sign === '+' ? '+' : sign === ' ' ? ' ' : '';
  const w = width ? Number(width) : 0;
  const total = signStr.length + body.length;
  if (total >= w) return signStr + body;
  const pad = fill.repeat(w - total);
  switch (align) {
    case '<': return signStr + body + pad;
    case '^': { const l = Math.floor((w - total) / 2); return fill.repeat(l) + signStr + body + fill.repeat(w - total - l); }
    case '=': return signStr + pad + body;
    default: return pad + signStr + body;
  }
}
function expFormat(x, prec) {
  const [m, e] = x.toExponential(prec).split('e');
  const n = Number(e);
  return `${m}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
}
function gFormat(x, prec, alt) {
  const p = prec === 0 ? 1 : prec;
  if (x === 0) return '0';
  const exp = Number(x.toExponential(p - 1).split('e')[1]);
  let s;
  if (exp >= -4 && exp < p) s = x.toFixed(Math.max(0, p - 1 - exp));
  else s = expFormat(x, p - 1);
  if (!alt) {
    if (s.includes('e')) { const [m, e] = s.split('e'); s = (m.includes('.') ? m.replace(/\.?0+$/, '') : m) + 'e' + e; }
    else if (s.includes('.')) s = s.replace(/\.?0+$/, '');
  }
  return s;
}

// Python round(): banker's rounding for ndigits=None (returns int), and
// correctly rounded decimal for ndigits (returns float).
export function pyRound(x, ndigits, span) {
  if (typeof x === 'bigint' || typeof x === 'boolean') return ndigits === undefined || ndigits === null ? toIntLike(x) : toIntLike(x);
  if (!Number.isFinite(x)) { if (ndigits === undefined || ndigits === null) modelError('cannot convert float to integer', span, 'OverflowError'); return x; }
  if (ndigits === undefined || ndigits === null) {
    const f = Math.floor(x), d = x - f;
    let r = d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1);
    return BigInt(r);
  }
  const n = Number(ndigits);
  // exact decimal rounding via the shortest repr string (half-even on exact ties)
  const s = x.toFixed(Math.min(100, Math.max(0, n + 20)));
  const [ip, fp = ''] = s.replace('-', '').split('.');
  if (n < 0) { const f = 10 ** -n; return pyRound(x / f, null, span) === undefined ? x : Number(pyRound(x / f, null, span)) * f; }
  const keep = fp.slice(0, n), rest = fp.slice(n);
  let digits = BigInt(ip + keep);
  const half = rest.length && (rest[0] > '5' || (rest[0] === '5' && /[1-9]/.test(rest.slice(1))));
  const tie = rest.length && rest[0] === '5' && !/[1-9]/.test(rest.slice(1));
  if (half || (tie && digits % 2n === 1n)) digits += 1n;
  const str = digits.toString().padStart(n + 1, '0');
  const out = Number(n ? `${str.slice(0, -n)}.${str.slice(-n)}` : str);
  return x < 0 ? -out : out;
}
