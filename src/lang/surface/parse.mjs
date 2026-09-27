// WPy (wonky Python dialect) front end: a Python 3 lexer and parser written in
// JS, so WPy programs never need CPython to run. It accepts the full Python
// statement and expression grammar that Marc's corpus uses (classes, while,
// with, try, decorators, comprehensions, f-strings, ...) and produces a plain
// AST with 1-based source spans on every node. Whether a construct is *part of
// WPy* is decided afterwards by check.mjs, so that rejections can name the
// construct, its span and a rewrite hint instead of failing at the first token.
//
// Deliberately not supported by the parser (reported as WpySyntaxError):
// async/await, `match` statements, type-parameter syntax, bytes literals with
// escapes beyond ASCII, and implicit line joining inside f-string expressions
// that span several lines. None occurs in the corpus scan (docs/language/proposal-surface.md).

export class WpySyntaxError extends Error {
  constructor(message, span) {
    super(message);
    this.name = 'WpySyntaxError';
    this.span = span;
  }
}

const KEYWORDS = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue',
  'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda',
  'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']);
const OPERATORS = ['**=', '//=', '>>=', '<<=', '...', '->', ':=', '**', '//', '>>', '<<', '<=', '>=', '==', '!=',
  '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '@=', '+', '-', '*', '/', '%', '@', '&', '|', '^', '~', '<', '>',
  '(', ')', '[', ']', '{', '}', ',', ':', ';', '.', '='];
const AUG = new Set(['+=', '-=', '*=', '/=', '//=', '%=', '**=', '>>=', '<<=', '&=', '|=', '^=', '@=']);

// ---------------------------------------------------------------------------------- lexer
export function tokenize(src, { file = '<wpy>', lineOffset = 0, colOffset = 0 } = {}) {
  const toks = [];
  let i = 0, line = 1, col = 1, depth = 0, atLineStart = true;
  const indents = [0];
  const here = () => ({ line: line + lineOffset, col: line === 1 ? col + colOffset : col });
  const push = (t, v, start, extra) => toks.push({ t, v, line: start.line, col: start.col, endLine: line + lineOffset, endCol: line === 1 ? col + colOffset : col, ...extra });
  const adv = n => { for (let k = 0; k < n; k++) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; } };
  const err = (m, s = here()) => { throw new WpySyntaxError(m, { file, line: s.line, col: s.col }); };
  while (i < src.length) {
    if (atLineStart && depth === 0) {
      // measure indentation; skip blank and comment-only lines entirely
      let j = i, width = 0;
      while (src[j] === ' ' || src[j] === '\t' || src[j] === '\f') { width = src[j] === '\t' ? (width + 8) - (width % 8) : width + 1; j++; }
      if (src[j] === '\n' || src[j] === '#' || src[j] === '\r' || j >= src.length) {
        while (j < src.length && src[j] !== '\n') j++;
        adv(j - i + (j < src.length ? 1 : 0));
        continue;
      }
      if (src[j] === '\\' && src[j + 1] === '\n') { adv(j - i + 2); continue; }
      adv(j - i);
      const start = here();
      if (width > indents.at(-1)) { indents.push(width); push('indent', width, start); }
      while (width < indents.at(-1)) {
        indents.pop(); push('dedent', width, start);
        if (width > indents.at(-1)) err('unindent does not match any outer indentation level', start);
      }
      atLineStart = false;
      continue;
    }
    const c = src[i];
    if (c === ' ' || c === '\t' || c === '\f' || c === '\r') { adv(1); continue; }
    if (c === '#') { while (i < src.length && src[i] !== '\n') adv(1); continue; }
    if (c === '\\' && src[i + 1] === '\n') { adv(2); continue; }
    if (c === '\\' && src[i + 1] === '\r' && src[i + 2] === '\n') { adv(3); continue; }
    if (c === '\n') {
      const start = here();
      if (depth === 0) { push('newline', null, start); atLineStart = true; }
      adv(1);
      continue;
    }
    const start = here();
    // string literal (with optional prefix)
    const sm = /^([rRbBuUfF]{0,2})('''|"""|'|")/.exec(src.slice(i, i + 5));
    if (sm && (sm[1] === '' || /^(r|u|b|f|br|rb|fr|rf)$/i.test(sm[1]))) {
      const prefix = sm[1].toLowerCase(), quote = sm[2];
      adv(sm[0].length);
      let body = '', fdepth = 0;
      const fstr = prefix.includes('f');
      for (;;) {
        if (i >= src.length) err('unterminated string literal', start);
        // PEP 701 (Python 3.12): inside an f-string replacement field, quotes open nested strings
        if (fstr && fdepth > 0 && (src[i] === '"' || src[i] === "'")) {
          const q = src.startsWith(src[i].repeat(3), i) ? src[i].repeat(3) : src[i];
          let j = i + q.length;
          while (j < src.length && !src.startsWith(q, j)) j += src[j] === '\\' ? 2 : 1;
          const n = j + q.length - i;
          body += src.slice(i, i + n); adv(n); continue;
        }
        if (src.startsWith(quote, i)) { adv(quote.length); break; }
        if (quote.length === 1 && src[i] === '\n' && fdepth === 0) err('unterminated string literal', start);
        if (src[i] === '\\' && i + 1 < src.length) { body += src[i] + src[i + 1]; adv(2); continue; }
        if (fstr && src[i] === '{') { if (src[i + 1] === '{' && fdepth === 0) { body += '{{'; adv(2); continue; } fdepth++; }
        else if (fstr && src[i] === '}' && fdepth > 0) fdepth--;
        body += src[i]; adv(1);
      }
      push('string', { prefix, quote, body }, start, { bodyLine: start.line, bodyCol: start.col + sm[0].length });
      continue;
    }
    const nm = /^[A-Za-z_À-￿][A-Za-z0-9_À-￿]*/.exec(src.slice(i, i + 200));
    if (nm) { adv(nm[0].length); push('name', nm[0], start); continue; }
    const num = /^(0[xX][0-9a-fA-F_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d[\d_]*)?[jJ]?)/.exec(src.slice(i, i + 100));
    if (num && num[0] !== '.') { adv(num[0].length); push('number', num[0], start); continue; }
    const op = OPERATORS.find(o => src.startsWith(o, i));
    if (op) {
      if ('([{'.includes(op)) depth++;
      if (')]}'.includes(op)) depth = Math.max(0, depth - 1);
      adv(op.length); push('op', op, start); continue;
    }
    err(`unexpected character ${JSON.stringify(c)}`, start);
  }
  const end = here();
  if (!atLineStart && toks.length && toks.at(-1).t !== 'newline') push('newline', null, end);
  while (indents.length > 1) { indents.pop(); push('dedent', 0, end); }
  push('eof', null, end);
  return toks;
}

// --------------------------------------------------------------------------- string values
function unescape(body, raw, span) {
  if (raw) return body;
  return body.replace(/\\(\n|\\|'|"|a|b|f|n|r|t|v|x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|U[0-9a-fA-F]{8}|N\{[^}]*\}|[0-7]{1,3}|.)/g, (m, e) => {
    const simple = { '\n': '', '\\': '\\', "'": "'", '"': '"', a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };
    if (e in simple) return simple[e];
    if (/^x/.test(e) || /^u/i.test(e)) return String.fromCodePoint(parseInt(e.slice(1), 16));
    if (/^[0-7]/.test(e)) return String.fromCodePoint(parseInt(e, 8));
    if (/^N\{/.test(e)) throw new WpySyntaxError('\\N{...} escapes are not supported', span);
    return m; // unknown escapes stay literal, as in Python
  });
}

// ---------------------------------------------------------------------------------- parser
export function parse(src, { file = '<wpy>' } = {}) {
  const p = new Parser(tokenize(src, { file }), file, src);
  return p.module();
}

export function parseExpression(src, { file = '<wpy>', line = 1, col = 1 } = {}) {
  // An expression (f-string field, CLI parameter) never starts a logical line:
  // strip leading blanks so the lexer does not read them as indentation.
  const lead = /^[ \t]*/.exec(src)[0].length;
  const p = new Parser(tokenize(src.slice(lead), { file, lineOffset: line - 1, colOffset: col - 1 + lead }), file, src);
  const e = p.testListStarExpr();
  while (p.peek().t === 'newline') p.next();
  if (p.peek().t !== 'eof') p.fail('unexpected token after expression');
  return e;
}

class Parser {
  constructor(toks, file, src) { this.toks = toks; this.i = 0; this.file = file; this.src = src; }
  peek(k = 0) { return this.toks[this.i + k]; }
  next() { return this.toks[this.i++]; }
  at(t, v) { const x = this.peek(); return x.t === t && (v === undefined || x.v === v); }
  atOp(v) { return this.at('op', v); }
  atKw(v) { return this.at('name', v); }
  accept(t, v) { if (this.at(t, v)) return this.next(); return null; }
  expect(t, v, what) {
    if (this.at(t, v)) return this.next();
    const x = this.peek();
    this.fail(`expected ${what ?? v ?? t}, found ${x.t === 'eof' ? 'end of file' : JSON.stringify(x.v ?? x.t)}`);
  }
  fail(m, tok = this.peek()) { throw new WpySyntaxError(m, { file: this.file, line: tok.line, col: tok.col }); }
  span(a, b = this.toks[this.i - 1]) { return { file: this.file, line: a.line, col: a.col, endLine: b.endLine, endCol: b.endCol }; }
  node(k, a, props) { return { k, span: this.span(a), ...props }; }

  module() {
    const body = [];
    while (!this.at('eof')) {
      if (this.accept('newline')) continue;
      body.push(...this.statement());
    }
    return { k: 'Module', body, span: { file: this.file, line: 1, col: 1 } };
  }

  block() {
    if (!this.at('newline')) return this.simpleStatements();
    this.expect('newline');
    this.expect('indent', undefined, 'an indented block');
    const body = [];
    while (!this.at('dedent') && !this.at('eof')) {
      if (this.accept('newline')) continue;
      body.push(...this.statement());
    }
    this.accept('dedent');
    return body;
  }

  statement() {
    const x = this.peek();
    if (x.t === 'op' && x.v === '@') return [this.decorated()];
    if (x.t === 'name' && !this.isSoftKeywordUse(x)) {
      switch (x.v) {
        case 'if': return [this.ifStmt()];
        case 'for': return [this.forStmt()];
        case 'while': return [this.whileStmt()];
        case 'try': return [this.tryStmt()];
        case 'with': return [this.withStmt()];
        case 'def': return [this.funcDef([])];
        case 'class': return [this.classDef([])];
        case 'async': this.fail('async is not supported');
      }
    }
    return this.simpleStatements();
  }

  isSoftKeywordUse(x) { return false; }

  simpleStatements() {
    const out = [this.smallStatement()];
    while (this.accept('op', ';')) { if (this.at('newline') || this.at('eof')) break; out.push(this.smallStatement()); }
    if (!this.accept('newline') && !this.at('eof')) this.fail('expected end of statement');
    return out;
  }

  smallStatement() {
    const a = this.peek();
    if (a.t === 'name') {
      switch (a.v) {
        case 'pass': this.next(); return this.node('Pass', a);
        case 'break': this.next(); return this.node('Break', a);
        case 'continue': this.next(); return this.node('Continue', a);
        case 'return': {
          this.next();
          const value = this.at('newline') || this.atOp(';') || this.at('eof') ? null : this.testListStarExpr();
          return this.node('Return', a, { value });
        }
        case 'raise': {
          this.next();
          let exc = null, cause = null;
          if (!this.at('newline') && !this.atOp(';') && !this.at('eof')) {
            exc = this.test();
            if (this.accept('name', 'from')) cause = this.test();
          }
          return this.node('Raise', a, { exc, cause });
        }
        case 'global': case 'nonlocal': {
          this.next();
          const names = [this.expect('name').v];
          while (this.accept('op', ',')) names.push(this.expect('name').v);
          return this.node(a.v === 'global' ? 'Global' : 'Nonlocal', a, { names });
        }
        case 'del': { this.next(); return this.node('Del', a, { targets: this.exprList() }); }
        case 'assert': {
          this.next();
          const test = this.test();
          const msg = this.accept('op', ',') ? this.test() : null;
          return this.node('Assert', a, { test, msg });
        }
        case 'import': {
          this.next();
          const names = [];
          do {
            const name = this.dottedName();
            const asname = this.accept('name', 'as') ? this.expect('name').v : null;
            names.push({ name, asname });
          } while (this.accept('op', ','));
          return this.node('Import', a, { names });
        }
        case 'from': {
          this.next();
          let level = 0;
          while (this.atOp('.') || this.atOp('...')) level += this.next().v.length;
          const module = this.atKw('import') ? null : this.dottedName();
          this.expect('name', 'import');
          let names;
          if (this.accept('op', '*')) names = '*';
          else {
            const paren = this.accept('op', '(');
            names = [];
            do {
              if (paren && this.atOp(')')) break;
              const name = this.expect('name').v;
              const asname = this.accept('name', 'as') ? this.expect('name').v : null;
              names.push({ name, asname });
            } while (this.accept('op', ','));
            if (paren) this.expect('op', ')');
          }
          return this.node('ImportFrom', a, { module, names, level });
        }
        case 'yield': this.fail('yield is not supported');
      }
    }
    // expression, assignment, augmented or annotated assignment
    const first = this.testListStarExpr();
    if (this.atOp(':') ) {
      this.next();
      const annotation = this.test();
      const value = this.accept('op', '=') ? this.testListStarExpr() : null;
      return this.node('AnnAssign', a, { target: first, annotation, value });
    }
    const t = this.peek();
    if (t.t === 'op' && AUG.has(t.v)) {
      this.next();
      const value = this.testListStarExpr();
      return this.node('AugAssign', a, { target: first, op: t.v.slice(0, -1), value });
    }
    if (this.atOp('=')) {
      const targets = [first];
      let value;
      for (;;) {
        this.expect('op', '=');
        const rhs = this.testListStarExpr();
        if (this.atOp('=')) targets.push(rhs); else { value = rhs; break; }
      }
      return this.node('Assign', a, { targets, value });
    }
    return this.node('Expr', a, { value: first });
  }

  dottedName() {
    let n = this.expect('name').v;
    while (this.accept('op', '.')) n += '.' + this.expect('name').v;
    return n;
  }

  decorated() {
    const decorators = [];
    while (this.atOp('@')) {
      this.next();
      decorators.push(this.namedExprTest());
      this.expect('newline');
    }
    if (this.atKw('def')) return this.funcDef(decorators);
    if (this.atKw('class')) return this.classDef(decorators);
    this.fail('expected def or class after decorator');
  }

  ifStmt() {
    const a = this.next();
    const test = this.namedExprTest();
    this.expect('op', ':');
    const body = this.block();
    let orelse = [];
    if (this.atKw('elif')) orelse = [this.ifStmt()];
    else if (this.accept('name', 'else')) { this.expect('op', ':'); orelse = this.block(); }
    return this.node('If', a, { test, body, orelse });
  }

  forStmt() {
    const a = this.next();
    const target = this.targetList();
    this.expect('name', 'in');
    const iter = this.testListStarExpr();
    this.expect('op', ':');
    const body = this.block();
    let orelse = [];
    if (this.accept('name', 'else')) { this.expect('op', ':'); orelse = this.block(); }
    return this.node('For', a, { target, iter, body, orelse });
  }

  whileStmt() {
    const a = this.next();
    const test = this.namedExprTest();
    this.expect('op', ':');
    const body = this.block();
    let orelse = [];
    if (this.accept('name', 'else')) { this.expect('op', ':'); orelse = this.block(); }
    return this.node('While', a, { test, body, orelse });
  }

  tryStmt() {
    const a = this.next();
    this.expect('op', ':');
    const body = this.block();
    const handlers = [];
    let orelse = [], finalbody = [];
    while (this.atKw('except')) {
      const h = this.next();
      if (this.accept('op', '*')) this.fail('except* is not supported');
      let type = null, name = null;
      if (!this.atOp(':')) {
        type = this.test();
        if (this.accept('name', 'as')) name = this.expect('name').v;
      }
      this.expect('op', ':');
      handlers.push({ type, name, body: this.block(), span: this.span(h) });
    }
    if (this.accept('name', 'else')) { this.expect('op', ':'); orelse = this.block(); }
    if (this.accept('name', 'finally')) { this.expect('op', ':'); finalbody = this.block(); }
    if (!handlers.length && !finalbody.length) this.fail('try needs except or finally');
    return this.node('Try', a, { body, handlers, orelse, finalbody });
  }

  withStmt() {
    const a = this.next();
    const items = [];
    const paren = this.atOp('(') && this.looksLikeParenthesizedWith();
    if (paren) this.next();
    do {
      if (paren && this.atOp(')')) break;
      const expr = this.test();
      const as = this.accept('name', 'as') ? this.starOr(() => this.expr()) : null;
      items.push({ expr, as });
    } while (this.accept('op', ','));
    if (paren) this.expect('op', ')');
    this.expect('op', ':');
    return this.node('With', a, { items, body: this.block() });
  }

  looksLikeParenthesizedWith() {
    // `with (a as b, c as d):` vs `with (expr).method() as x:`; scan to the matching paren
    let depth = 0;
    for (let k = this.i; k < this.toks.length; k++) {
      const x = this.toks[k];
      if (x.t === 'op' && '([{'.includes(x.v)) depth++;
      if (x.t === 'op' && ')]}'.includes(x.v)) { depth--; if (depth === 0) return this.toks[k + 1]?.t === 'op' && this.toks[k + 1].v === ':'; }
      if (depth === 1 && x.t === 'name' && x.v === 'as') return true;
    }
    return false;
  }

  funcDef(decorators) {
    const a = this.next();
    const name = this.expect('name').v;
    if (this.atOp('[')) this.fail('type parameter syntax is not supported');
    this.expect('op', '(');
    const params = this.parameters(')', true);
    this.expect('op', ')');
    const returns = this.accept('op', '->') ? this.test() : null;
    this.expect('op', ':');
    const body = this.block();
    return this.node('FunctionDef', a, { name, params, body, decorators, returns });
  }

  parameters(close, annotations) {
    const params = { posonly: [], args: [], vararg: null, kwonly: [], kwarg: null };
    let kwOnly = false;
    while (!this.atOp(close)) {
      const s = this.peek();
      if (this.accept('op', '/')) { params.posonly = params.args; params.args = []; }
      else if (this.accept('op', '**')) params.kwarg = this.param(annotations, false, s);
      else if (this.accept('op', '*')) {
        kwOnly = true;
        if (this.at('name')) params.vararg = this.param(annotations, false, s);
      } else {
        const p = this.param(annotations, true, s);
        (kwOnly ? params.kwonly : params.args).push(p);
      }
      if (!this.accept('op', ',')) break;
    }
    return params;
  }

  param(annotations, withDefault, s) {
    const name = this.expect('name').v;
    const annotation = annotations && this.accept('op', ':') ? this.test() : null;
    const def = withDefault && this.accept('op', '=') ? this.test() : null;
    return { name, annotation, default: def, span: this.span(s) };
  }

  classDef(decorators) {
    const a = this.next();
    const name = this.expect('name').v;
    let bases = [];
    if (this.accept('op', '(')) { bases = this.callArgs().args; this.expect('op', ')'); }
    this.expect('op', ':');
    return this.node('ClassDef', a, { name, bases, body: this.block(), decorators });
  }

  // ------------------------------------------------------------------ expressions
  targetList() {
    const a = this.peek();
    const first = this.starOr(() => this.expr());
    if (!this.atOp(',')) return first;
    const elts = [first];
    while (this.accept('op', ',')) { if (this.atKw('in') || this.atOp('=')) break; elts.push(this.starOr(() => this.expr())); }
    return this.node('Tuple', a, { elts });
  }
  target() { return this.targetList(); }

  exprList() {
    const a = this.peek();
    const first = this.starOr(() => this.expr());
    if (!this.atOp(',')) return first;
    const elts = [first];
    while (this.accept('op', ',')) { if (this.endOfExprList()) break; elts.push(this.starOr(() => this.expr())); }
    return this.node('Tuple', a, { elts });
  }

  endOfExprList() {
    const x = this.peek();
    return x.t === 'newline' || x.t === 'eof' || (x.t === 'op' && [')', ']', '}', '=', ':', ';'].includes(x.v)) || (x.t === 'op' && AUG.has(x.v)) || (x.t === 'name' && x.v === 'in');
  }

  starOr(f) {
    const a = this.peek();
    if (this.accept('op', '*')) return this.node('Starred', a, { value: this.expr() });
    return f();
  }

  testListStarExpr() {
    const a = this.peek();
    const first = this.starOr(() => this.namedExprTest());
    if (!this.atOp(',')) return first;
    const elts = [first];
    while (this.accept('op', ',')) { if (this.endOfExprList()) break; elts.push(this.starOr(() => this.namedExprTest())); }
    return this.node('Tuple', a, { elts });
  }

  namedExprTest() {
    const a = this.peek();
    if (a.t === 'name' && this.peek(1).t === 'op' && this.peek(1).v === ':=') {
      this.next(); this.next();
      return this.node('NamedExpr', a, { target: { k: 'Name', id: a.v, span: this.span(a, a) }, value: this.test() });
    }
    return this.test();
  }

  test() {
    const a = this.peek();
    if (this.atKw('lambda')) {
      this.next();
      const params = this.parameters(':', false);
      this.expect('op', ':');
      return this.node('Lambda', a, { params, body: this.test() });
    }
    const body = this.orTest();
    if (this.atKw('if') ) {
      this.next();
      const test = this.orTest();
      this.expect('name', 'else');
      const orelse = this.test();
      return this.node('IfExp', a, { test, body, orelse });
    }
    return body;
  }
  testNoCond() {
    if (this.atKw('lambda')) return this.test();
    return this.orTest();
  }

  orTest() {
    const a = this.peek();
    const first = this.andTest();
    if (!this.atKw('or')) return first;
    const values = [first];
    while (this.accept('name', 'or')) values.push(this.andTest());
    return this.node('BoolOp', a, { op: 'or', values });
  }
  andTest() {
    const a = this.peek();
    const first = this.notTest();
    if (!this.atKw('and')) return first;
    const values = [first];
    while (this.accept('name', 'and')) values.push(this.notTest());
    return this.node('BoolOp', a, { op: 'and', values });
  }
  notTest() {
    const a = this.peek();
    if (this.accept('name', 'not')) return this.node('UnaryOp', a, { op: 'not', operand: this.notTest() });
    return this.comparison();
  }
  comparison() {
    const a = this.peek();
    const left = this.expr();
    const ops = [], comparators = [];
    for (;;) {
      const x = this.peek();
      let op = null;
      if (x.t === 'op' && ['<', '>', '==', '>=', '<=', '!='].includes(x.v)) { this.next(); op = x.v; }
      else if (x.t === 'name' && x.v === 'in') { this.next(); op = 'in'; }
      else if (x.t === 'name' && x.v === 'not' && this.peek(1).t === 'name' && this.peek(1).v === 'in') { this.next(); this.next(); op = 'not in'; }
      else if (x.t === 'name' && x.v === 'is') { this.next(); op = this.accept('name', 'not') ? 'is not' : 'is'; }
      if (!op) break;
      ops.push(op); comparators.push(this.expr());
    }
    return ops.length ? this.node('Compare', a, { left, ops, comparators }) : left;
  }
  binary(next, ops) {
    const a = this.peek();
    let left = next();
    for (;;) {
      const x = this.peek();
      if (x.t !== 'op' || !ops.includes(x.v)) return left;
      this.next();
      left = { k: 'BinOp', op: x.v, left, right: next(), span: this.span(a) };
    }
  }
  expr() { return this.binary(() => this.xorExpr(), ['|']); }
  xorExpr() { return this.binary(() => this.andExpr(), ['^']); }
  andExpr() { return this.binary(() => this.shiftExpr(), ['&']); }
  shiftExpr() { return this.binary(() => this.arithExpr(), ['<<', '>>']); }
  arithExpr() { return this.binary(() => this.term(), ['+', '-']); }
  term() { return this.binary(() => this.factor(), ['*', '/', '//', '%', '@']); }
  factor() {
    const a = this.peek();
    if (a.t === 'op' && ['+', '-', '~'].includes(a.v)) { this.next(); return this.node('UnaryOp', a, { op: a.v, operand: this.factor() }); }
    return this.power();
  }
  power() {
    const a = this.peek();
    if (this.atKw('await')) this.fail('await is not supported');
    const base = this.atomExpr();
    if (this.accept('op', '**')) return this.node('BinOp', a, { op: '**', left: base, right: this.factor() });
    return base;
  }
  atomExpr() {
    const a = this.peek();
    let e = this.atom();
    for (;;) {
      if (this.accept('op', '(')) { const { args, keywords } = this.callArgs(); this.expect('op', ')'); e = this.node('Call', a, { func: e, args, keywords }); }
      else if (this.accept('op', '[')) { const slice = this.subscriptList(); this.expect('op', ']'); e = this.node('Subscript', a, { value: e, slice }); }
      else if (this.accept('op', '.')) { const attr = this.expect('name').v; e = this.node('Attribute', a, { value: e, attr }); }
      else return e;
    }
  }
  callArgs() {
    const args = [], keywords = [];
    while (!this.atOp(')')) {
      const a = this.peek();
      if (this.accept('op', '**')) keywords.push({ arg: null, value: this.test(), span: this.span(a) });
      else if (this.accept('op', '*')) args.push(this.node('Starred', a, { value: this.test() }));
      else if (a.t === 'name' && this.peek(1).t === 'op' && this.peek(1).v === '=') {
        this.next(); this.next(); keywords.push({ arg: a.v, value: this.test(), span: this.span(a) });
      } else {
        const v = this.namedExprTest();
        if (this.atKw('for') || this.atKw('async')) args.push(this.node('GeneratorExp', a, { elt: v, gens: this.compFor() }));
        else args.push(v);
      }
      if (!this.accept('op', ',')) break;
    }
    return { args, keywords };
  }
  subscriptList() {
    const a = this.peek();
    const first = this.subscript();
    if (!this.atOp(',')) return first;
    const elts = [first];
    while (this.accept('op', ',')) { if (this.atOp(']')) break; elts.push(this.subscript()); }
    return this.node('Tuple', a, { elts });
  }
  subscript() {
    const a = this.peek();
    let lower = null, upper = null, step = null;
    if (!this.atOp(':')) { lower = this.namedExprTest(); if (!this.atOp(':')) return lower; }
    this.expect('op', ':');
    if (!this.atOp(']') && !this.atOp(',') && !this.atOp(':')) upper = this.test();
    if (this.accept('op', ':') && !this.atOp(']') && !this.atOp(',')) step = this.test();
    return this.node('Slice', a, { lower, upper, step });
  }
  compFor() {
    const gens = [];
    while (this.atKw('for') || this.atKw('async')) {
      if (this.atKw('async')) this.fail('async comprehensions are not supported');
      this.next();
      const target = this.targetList();
      this.expect('name', 'in');
      const iter = this.orTest();
      const ifs = [];
      while (this.atKw('if')) { this.next(); ifs.push(this.testNoCond()); }
      gens.push({ target, iter, ifs });
    }
    return gens;
  }
  atom() {
    const a = this.peek();
    switch (a.t) {
      case 'number': {
        this.next();
        const raw = a.v.replace(/_/g, '');
        if (/[jJ]$/.test(raw)) this.fail('complex numbers are not supported', a);
        if (/^0[xX]/.test(raw)) return this.node('Const', a, { kind: 'int', value: BigInt(raw) });
        if (/^0[oO]/.test(raw)) return this.node('Const', a, { kind: 'int', value: BigInt('0o' + raw.slice(2)) });
        if (/^0[bB]/.test(raw)) return this.node('Const', a, { kind: 'int', value: BigInt('0b' + raw.slice(2)) });
        if (/^\d+$/.test(raw)) return this.node('Const', a, { kind: 'int', value: BigInt(raw) });
        return this.node('Const', a, { kind: 'float', value: Number(raw), raw });
      }
      case 'string': return this.strings();
      case 'name': {
        if (a.v === 'True' || a.v === 'False') { this.next(); return this.node('Const', a, { kind: 'bool', value: a.v === 'True' }); }
        if (a.v === 'None') { this.next(); return this.node('Const', a, { kind: 'none', value: null }); }
        if (a.v === 'yield') this.fail('yield is not supported');
        if (KEYWORDS.has(a.v) && !['match', 'case', 'type'].includes(a.v)) this.fail(`unexpected keyword '${a.v}'`);
        this.next();
        return this.node('Name', a, { id: a.v });
      }
      case 'op': {
        if (a.v === '...') { this.next(); return this.node('Const', a, { kind: 'ellipsis', value: null }); }
        if (a.v === '(') {
          this.next();
          if (this.accept('op', ')')) return this.node('Tuple', a, { elts: [] });
          if (this.atKw('yield')) this.fail('yield is not supported');
          const first = this.starOr(() => this.namedExprTest());
          if (this.atKw('for')) { const gens = this.compFor(); this.expect('op', ')'); return this.node('GeneratorExp', a, { elt: first, gens }); }
          if (this.accept('op', ')')) return first.k === 'Starred' ? this.fail('cannot use starred expression here', a) : { ...first, parens: true };
          const elts = [first];
          while (this.accept('op', ',')) { if (this.atOp(')')) break; elts.push(this.starOr(() => this.namedExprTest())); }
          this.expect('op', ')');
          return this.node('Tuple', a, { elts });
        }
        if (a.v === '[') {
          this.next();
          if (this.accept('op', ']')) return this.node('List', a, { elts: [] });
          const first = this.starOr(() => this.namedExprTest());
          if (this.atKw('for')) { const gens = this.compFor(); this.expect('op', ']'); return this.node('ListComp', a, { elt: first, gens }); }
          const elts = [first];
          while (this.accept('op', ',')) { if (this.atOp(']')) break; elts.push(this.starOr(() => this.namedExprTest())); }
          this.expect('op', ']');
          return this.node('List', a, { elts });
        }
        if (a.v === '{') {
          this.next();
          if (this.accept('op', '}')) return this.node('Dict', a, { keys: [], values: [] });
          if (this.accept('op', '**')) {
            const keys = [null], values = [this.expr()];
            return this.dictRest(a, keys, values);
          }
          const first = this.starOr(() => this.namedExprTest());
          if (this.accept('op', ':')) {
            const v = this.test();
            if (this.atKw('for')) { const gens = this.compFor(); this.expect('op', '}'); return this.node('DictComp', a, { key: first, value: v, gens }); }
            return this.dictRest(a, [first], [v]);
          }
          if (this.atKw('for')) { const gens = this.compFor(); this.expect('op', '}'); return this.node('SetComp', a, { elt: first, gens }); }
          const elts = [first];
          while (this.accept('op', ',')) { if (this.atOp('}')) break; elts.push(this.starOr(() => this.namedExprTest())); }
          this.expect('op', '}');
          return this.node('Set', a, { elts });
        }
      }
    }
    this.fail(`unexpected ${a.t === 'eof' ? 'end of file' : JSON.stringify(a.v ?? a.t)}`);
  }
  dictRest(a, keys, values) {
    while (this.accept('op', ',')) {
      if (this.atOp('}')) break;
      if (this.accept('op', '**')) { keys.push(null); values.push(this.expr()); continue; }
      keys.push(this.test()); this.expect('op', ':'); values.push(this.test());
    }
    this.expect('op', '}');
    return this.node('Dict', a, { keys, values });
  }
  strings() {
    const a = this.peek();
    const parts = [];
    let isF = false, isBytes = false;
    while (this.at('string')) {
      const s = this.next();
      const { prefix, body } = s.v;
      const raw = prefix.includes('r');
      if (prefix.includes('b')) isBytes = true;
      const span = { file: this.file, line: s.line, col: s.col };
      if (prefix.includes('f')) { isF = true; parts.push(...this.fstring(body, raw, s)); }
      else parts.push(unescape(body, raw, span));
    }
    if (isBytes) return this.node('Const', a, { kind: 'bytes', value: parts.join('') });
    if (!isF) return this.node('Const', a, { kind: 'str', value: parts.join('') });
    const merged = [];
    for (const part of parts) {
      if (typeof part === 'string' && typeof merged.at(-1) === 'string') merged[merged.length - 1] += part;
      else merged.push(part);
    }
    return this.node('JoinedStr', a, { parts: merged });
  }
  fstring(body, raw, tok) {
    const parts = [];
    let lit = '', i = 0;
    const lineOf = k => { const pre = body.slice(0, k); const nl = pre.split('\n'); return nl.length === 1 ? { line: tok.bodyLine, col: tok.bodyCol + k } : { line: tok.bodyLine + nl.length - 1, col: nl.at(-1).length + 1 }; };
    while (i < body.length) {
      const c = body[i];
      if (c === '{' && body[i + 1] === '{') { lit += '{'; i += 2; continue; }
      if (c === '}' && body[i + 1] === '}') { lit += '}'; i += 2; continue; }
      if (c === '{') {
        if (lit) { parts.push(unescape(lit, raw, lineOf(i))); lit = ''; }
        // find the end of the replacement field, honouring nesting and strings
        let j = i + 1, depth = 0, quote = null, exprEnd = -1, conv = null, specStart = -1;
        for (; j < body.length; j++) {
          const d = body[j];
          if (quote) { if (d === '\\') { j++; continue; } if (body.startsWith(quote, j)) { j += quote.length - 1; quote = null; } continue; }
          if (d === '"' || d === "'") { quote = body.startsWith(d.repeat(3), j) ? d.repeat(3) : d; j += quote.length - 1; continue; }
          if ('([{'.includes(d)) { depth++; continue; }
          if (')]'.includes(d) || (d === '}' && depth > 0)) { depth--; continue; }
          if (depth === 0 && d === '!' && body[j + 1] !== '=' && exprEnd < 0) { exprEnd = j; conv = body[j + 1]; j++; continue; }
          if (depth === 0 && d === ':' && specStart < 0) { if (exprEnd < 0) exprEnd = j; specStart = j + 1; break; }
          if (depth === 0 && d === '}') break;
        }
        let k = j;
        if (specStart >= 0) {
          // format spec may itself contain {nested} fields; scan to the closing brace
          let depth2 = 0;
          for (k = specStart; k < body.length; k++) { if (body[k] === '{') depth2++; else if (body[k] === '}') { if (depth2 === 0) break; depth2--; } }
        }
        if (k >= body.length) throw new WpySyntaxError("f-string: expecting '}'", { file: this.file, ...lineOf(i) });
        if (exprEnd < 0) exprEnd = j;
        let exprText = body.slice(i + 1, exprEnd);
        let selfDoc = false;
        if (/=\s*$/.test(exprText) && !/[=!<>]=\s*$/.test(exprText)) { selfDoc = true; exprText = exprText.replace(/=\s*$/, ''); }
        const at = lineOf(i + 1);
        const expr = parseExpression(exprText, { file: this.file, line: at.line, col: at.col });
        const spec = specStart >= 0 ? this.fstring(body.slice(specStart, k), raw, { ...tok, bodyCol: tok.bodyCol + specStart }) : null;
        if (selfDoc) parts.push(exprText + '=');
        parts.push({ expr, conv, spec, selfDoc });
        i = k + 1;
        continue;
      }
      lit += c; i++;
    }
    if (lit) parts.push(unescape(lit, raw, lineOf(i)));
    return parts;
  }
}

// Walks every AST node (statements, expressions, handler bodies, params).
export function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) walk(n, visit, parent); return; }
  if (typeof node.k === 'string') visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'span') continue;
    if (value && typeof value === 'object') walk(value, visit, typeof node.k === 'string' ? node : parent);
  }
}
