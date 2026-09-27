// Tolerant FeatureScript parser for corpus analysis only (never for modeling).
//
// Differences to src/parser.mjs, which is a deliberately bounded modeling
// subset: this parser accepts the full surface syntax found in Marc's corpus
// (fragments without a header, bare evaluation lambdas, `try silent { }`,
// `try { }` without catch, type/predicate/operator declarations, boxes,
// re-exported imports, arbitrary string escapes). It produces a plain AST for
// static counting; it evaluates nothing.

export class FsSyntaxError extends Error {
  constructor(message, token) {
    super(`${message} at ${token?.line ?? '?'}:${token?.column ?? '?'}`);
    this.line = token?.line; this.column = token?.column;
  }
}
const fail = (message, token) => { throw new FsSyntaxError(message, token); };

const SYMBOLS2 = ['::', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '~=', '^=', '%='];
const SYMBOLS1 = '{}[]();,:.+-*/%^~!=<>?@|&';

export function tokenize(source) {
  const tokens = [];
  let offset = 0, line = 1, column = 1;
  const take = () => {
    const c = source[offset++];
    if (c === '\n') { line++; column = 1; } else column++;
    return c;
  };
  const comments = [];
  while (offset < source.length) {
    const c = source[offset];
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v' || c === '﻿' || c === ' ') { take(); continue; }
    const start = { line, column };
    if (source.startsWith('//', offset)) {
      let text = '';
      while (offset < source.length && source[offset] !== '\n') text += take();
      comments.push({ ...start, text });
      continue;
    }
    if (source.startsWith('/*', offset)) {
      take(); take(); let text = '';
      while (offset < source.length && !source.startsWith('*/', offset)) text += take();
      if (offset >= source.length) fail('Unterminated block comment', start);
      take(); take(); comments.push({ ...start, text }); continue;
    }
    if (c === '"' || c === "'") {
      const quote = take();
      let value = '';
      while (offset < source.length && source[offset] !== quote) {
        let next = take();
        if (next === '\n') fail('Newline in string literal', start);
        if (next === '\\') next = take();
        value += next;
      }
      if (offset >= source.length) fail('Unterminated string literal', start);
      take(); tokens.push({ kind: 'string', value, ...start }); continue;
    }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(source.slice(offset, offset + 64));
    if (number) {
      for (let i = 0; i < number[0].length; i++) take();
      tokens.push({ kind: 'number', value: Number(number[0]), ...start }); continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(offset, offset + 256));
    if (name) {
      for (let i = 0; i < name[0].length; i++) take();
      tokens.push({ kind: 'name', value: name[0], ...start }); continue;
    }
    const op = SYMBOLS2.find(x => source.startsWith(x, offset));
    if (op) { take(); take(); tokens.push({ kind: 'symbol', value: op, ...start }); continue; }
    if (SYMBOLS1.includes(c)) { take(); tokens.push({ kind: 'symbol', value: c, ...start }); continue; }
    fail(`Unsupported token ${JSON.stringify(c)}`, start);
  }
  tokens.push({ kind: 'eof', value: '<eof>', line, column });
  return { tokens, comments };
}

const PRECEDENCE = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '~': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7, '^': 8 };
const ASSIGN = ['=', '+=', '-=', '*=', '/=', '~=', '^=', '%='];

class Parser {
  constructor(source) {
    const { tokens, comments } = tokenize(source);
    this.tokens = tokens; this.comments = comments; this.index = 0;
  }
  get token() { return this.tokens[this.index]; }
  peek(n = 1) { return this.tokens[this.index + n]; }
  at(value) { return this.token.kind !== 'string' && this.token.value === value; }
  take() { return this.tokens[this.index++]; }
  accept(value) { return this.at(value) ? this.take() : null; }
  expect(value) {
    if (!this.at(value)) fail(`Expected '${value}', found '${this.token.value}'`, this.token);
    return this.take();
  }
  name() {
    if (this.token.kind !== 'name') fail(`Expected an identifier, found '${this.token.value}'`, this.token);
    return this.take().value;
  }
  annotations() {
    const values = [];
    while (this.at('annotation') && this.peek()?.value === '{') { this.take(); values.push(this.map()); }
    return values;
  }
  program() {
    const header = this.at('FeatureScript') ? (this.take(), this.take(), this.expect(';'), true) : false;
    const version = header ? this.tokens[1].value : null;
    const imports = [], declarations = [], statements = [];
    while (this.token.kind !== 'eof') {
      if (this.accept(';')) continue;
      const start = this.index;
      const annotations = this.annotations();
      const exported = !!this.accept('export');
      let namespace = null;
      if (this.token.kind === 'name' && this.peek()?.value === '::' && this.peek(2)?.value === 'import') {
        namespace = this.name(); this.expect('::');
      }
      if (this.at('import') && this.peek()?.value === '(') {
        const loc = this.take(); this.expect('(');
        const fields = {};
        if (!this.at(')')) do {
          const key = this.name(); this.expect(':');
          fields[key] = this.take().value;
        } while (this.accept(','));
        this.expect(')'); this.accept(';');
        imports.push({ ...fields, namespace, exported, line: loc.line });
        continue;
      }
      if (this.at('const') && this.peek()?.kind === 'name' && (header || exported || annotations.length || this.isTopLevelConst())) {
        declarations.push({ ...this.declaration(), exported, annotations });
        continue;
      }
      if (this.at('function') && this.peek()?.kind === 'name') {
        const loc = this.take(); const name = this.name();
        declarations.push({ kind: 'declaration', name, constant: true, value: this.functionTail(loc), exported, annotations, loc: loc.line, isFunction: true });
        continue;
      }
      if (this.at('predicate') && this.peek()?.kind === 'name') {
        const loc = this.take(); const name = this.name();
        declarations.push({ kind: 'declaration', name, constant: true, value: this.functionTail(loc), exported, annotations, loc: loc.line, isFunction: true, isPredicate: true });
        continue;
      }
      if (this.at('operator')) {
        const loc = this.take(); let op = this.take().value;
        if (op === '[') { this.expect(']'); op = '[]'; }
        declarations.push({ kind: 'declaration', name: `operator${op}`, constant: true, value: this.functionTail(loc), exported, annotations, loc: loc.line, isFunction: true, isOperator: true });
        continue;
      }
      if (this.at('enum') && this.peek()?.kind === 'name') {
        const loc = this.take(), name = this.name(), members = [];
        this.expect('{');
        while (!this.at('}')) {
          const memberAnnotations = this.annotations();
          members.push({ name: this.name(), annotations: memberAnnotations });
          if (!this.accept(',')) break;
        }
        this.expect('}');
        declarations.push({ kind: 'enum', name, members, exported, annotations, loc: loc.line });
        continue;
      }
      if (this.at('type') && this.peek()?.kind === 'name' && this.peek(2)?.value === 'typecheck') {
        const loc = this.take(); const name = this.name(); this.expect('typecheck');
        const predicate = this.expression(); this.accept(';');
        declarations.push({ kind: 'type', name, predicate, exported, annotations, loc: loc.line });
        continue;
      }
      // Fragment or evaluation snippet: top-level statements / a bare lambda.
      this.index = start;
      const statement = this.statement();
      statements.push(statement);
    }
    return { header, version, imports, declarations, statements, comments: this.comments };
  }
  isTopLevelConst() { return true; }
  declaration(terminate = true) {
    const loc = this.take(); const name = this.name();
    const type = this.accept('is') ? this.name() : null;
    let value = null;
    if (this.accept('=')) value = this.expression();
    if (terminate) this.accept(';');
    return { kind: 'declaration', name, type, value, constant: loc.value === 'const', loc: loc.line };
  }
  block() {
    this.expect('{'); const statements = [];
    while (!this.at('}')) {
      if (this.token.kind === 'eof') fail('Unterminated block', this.token);
      statements.push(this.statement());
    }
    this.expect('}'); return { kind: 'block', statements };
  }
  statement() {
    const annotations = this.annotations();
    const statement = this.statementCore();
    if (annotations.length) statement.annotations = annotations;
    return statement;
  }
  statementCore() {
    const loc = this.token.line;
    if (this.accept(';')) return { kind: 'empty', loc };
    if (this.at('{') && !this.looksLikeMapStatement()) return this.block();
    if ((this.at('const') || this.at('var')) && this.peek()?.kind === 'name') return this.declaration();
    if (this.accept('throw')) { const value = this.expression(); this.accept(';'); return { kind: 'throw', value, loc }; }
    if (this.at('break') || this.at('continue')) { const kind = this.take().value; this.accept(';'); return { kind, loc }; }
    if (this.at('try')) {
      const next = this.peek();
      if (next?.value === '{' || (next?.value === 'silent' && this.peek(2)?.value === '{')) {
        this.take(); const silent = !!this.accept('silent'); const body = this.block();
        let name = null, handler = null;
        if (this.accept('catch')) {
          if (this.accept('(')) { name = this.name(); this.expect(')'); }
          handler = this.block();
        }
        return { kind: 'try', silent, body, name, handler, loc };
      }
    }
    if (this.accept('return')) {
      const value = this.at(';') || this.at('}') ? null : this.expression(); this.accept(';');
      return { kind: 'return', value, loc };
    }
    if (this.accept('if')) {
      this.expect('('); const condition = this.expression(); this.expect(')');
      const yes = this.statement(); const no = this.accept('else') ? this.statement() : null;
      return { kind: 'if', condition, yes, no, loc };
    }
    if (this.accept('for')) {
      this.expect('(');
      if ((this.at('var') || this.at('const')) && this.peek(2)?.value === 'in') {
        this.take(); const name = this.name(); this.expect('in');
        const values = this.expression(); this.expect(')');
        return { kind: 'forIn', name, values, body: this.statement(), loc };
      }
      // `for (var key, value in container)` iterates map entries / array indices.
      if ((this.at('var') || this.at('const')) && this.peek(2)?.value === ',' && this.peek(4)?.value === 'in') {
        this.take(); const key = this.name(); this.expect(','); const name = this.name(); this.expect('in');
        const values = this.expression(); this.expect(')');
        return { kind: 'forIn', key, name, values, keyed: true, body: this.statement(), loc };
      }
      if (this.token.kind === 'name' && this.peek()?.value === 'in') {
        const name = this.name(); this.expect('in');
        const values = this.expression(); this.expect(')');
        return { kind: 'forIn', name, values, body: this.statement(), loc };
      }
      const initial = this.at(';') ? null : (this.at('var') || this.at('const') ? this.declaration(false) : this.expressionStatement(false));
      this.expect(';'); const condition = this.at(';') ? null : this.expression(); this.expect(';');
      const increment = this.at(')') ? null : this.expressionStatement(false);
      this.expect(')');
      return { kind: 'forC', initial, condition, increment, body: this.statement(), loc };
    }
    if (this.accept('while')) {
      this.expect('('); const condition = this.expression(); this.expect(')');
      return { kind: 'while', condition, body: this.statement(), loc };
    }
    return this.expressionStatement();
  }
  looksLikeMapStatement() {
    // `{ "key" : ... }` at statement position is a map expression statement
    // (for example a bare map returned by an evaluation snippet).
    const a = this.peek(), b = this.peek(2);
    return a && b && (a.kind === 'string' || a.kind === 'name') && b.value === ':' && a.value !== 'annotation';
  }
  expressionStatement(terminate = true) {
    const loc = this.token.line;
    const value = this.expression();
    if (ASSIGN.includes(this.token.value) && this.token.kind === 'symbol') {
      const operator = this.take().value;
      const rhs = this.expression(); if (terminate) this.accept(';');
      return { kind: 'assign', target: value, operator, value: rhs, loc };
    }
    if (terminate) this.accept(';');
    return { kind: 'expression', value, loc };
  }
  functionTail(loc) {
    this.expect('('); const params = [];
    if (!this.at(')')) do {
      const name = this.name(); const type = this.accept('is') ? this.name() : null;
      params.push({ name, type });
    } while (this.accept(','));
    this.expect(')');
    const returnType = this.accept('returns') ? this.name() : null;
    const precondition = this.accept('precondition') ? this.block() : null;
    const body = this.block();
    return { kind: 'function', params, returnType, precondition, body, loc: loc.line };
  }
  map() {
    const loc = this.expect('{').line, fields = [];
    while (!this.at('}')) {
      let key;
      if (this.accept('(')) { key = this.expression(); this.expect(')'); }
      else {
        const token = this.take();
        if (!['string', 'name', 'number'].includes(token.kind)) fail('Expected map key', token);
        key = { kind: 'literal', value: token.value, loc: token.line, keyKind: token.kind };
      }
      this.expect(':'); fields.push([key, this.expression()]);
      if (!this.accept(',')) break;
    }
    this.expect('}'); return { kind: 'map', fields, loc };
  }
  expression(min = 0) {
    const tok = this.token, loc = tok.line; let value;
    if (this.at('try') && (this.peek()?.value === '(' || this.peek()?.value === 'silent')) {
      this.take(); const silent = !!this.accept('silent'); this.expect('(');
      const expression = this.expression(); this.expect(')');
      value = { kind: 'tryExpression', value: expression, silent, loc };
    } else if (tok.kind === 'symbol' && (tok.value === '-' || tok.value === '!' || tok.value === '+')) {
      this.take(); value = { kind: 'unary', operator: tok.value, value: this.expression(8), loc };
    } else if (this.accept('(')) {
      value = this.expression(); this.expect(')');
      value = { kind: 'paren', value, loc };
    } else if (this.at('{')) value = this.map();
    else if (this.accept('[')) {
      const items = [];
      while (!this.at(']')) { items.push(this.expression()); if (!this.accept(',')) break; }
      this.expect(']'); value = { kind: 'array', items, loc };
    } else if (this.at('function') || this.at('predicate')) { const f = this.take(); value = this.functionTail(f); value.lambda = true; }
    else if (this.at('new') && this.peek()?.value === 'box') {
      this.take(); this.take(); this.expect('('); const inner = this.expression(); this.expect(')');
      value = { kind: 'newBox', value: inner, loc };
    } else if (tok.kind === 'number' || tok.kind === 'string') {
      this.take(); value = { kind: 'literal', value: tok.value, literalKind: tok.kind, loc };
    } else if (tok.kind === 'name' && ['true', 'false', 'undefined'].includes(tok.value)) {
      this.take(); value = { kind: 'literal', value: tok.value, literalKind: 'keyword', loc };
    } else if (tok.kind === 'name') {
      this.take(); const name = this.accept('::') ? `${tok.value}::${this.name()}` : tok.value;
      value = { kind: 'name', name, loc };
    } else fail(`Unsupported expression '${tok.value}'`, tok);
    while (true) {
      if (this.at('(')) {
        this.take(); const args = [];
        while (!this.at(')')) { args.push(this.expression()); if (!this.accept(',')) break; }
        this.expect(')'); value = { kind: 'call', callee: value, args, loc }; continue;
      }
      if (this.at('.')) {
        this.take();
        const key = this.token.kind === 'name' || this.token.kind === 'number' ? this.take().value : fail('Expected member name', this.token);
        value = { kind: 'access', value, key: { kind: 'literal', value: key, loc }, dot: true, loc }; continue;
      }
      if (this.at('[')) {
        this.take();
        if (this.accept(']')) { value = { kind: 'unbox', value, loc }; continue; }
        const key = this.expression(); this.expect(']'); value = { kind: 'access', value, key, loc }; continue;
      }
      const op = this.token.kind === 'symbol' || this.token.kind === 'name' ? this.token.value : null;
      if (op === 'is' || op === 'as') {
        if (min > 4) break;
        this.take(); value = { kind: 'type', operator: op, value, type: this.name(), loc }; continue;
      }
      const rank = this.token.kind === 'symbol' ? PRECEDENCE[op] : undefined;
      if (rank === undefined || rank < min) break;
      this.take(); value = { kind: 'binary', operator: op, left: value, right: this.expression(op === '^' ? rank : rank + 1), loc };
    }
    if (min === 0 && this.at('?')) {
      this.take();
      const yes = this.expression(); this.expect(':'); value = { kind: 'conditional', condition: value, yes, no: this.expression(), loc };
    }
    return value;
  }
}

export const parseFs = source => new Parser(source).program();
