import { fail } from './errors.mjs';

// This is a parser for a deliberately bounded subset of FeatureScript. No
// JavaScript eval or regex-to-JavaScript rewriting is used.
export function tokenize(source) {
  const tokens = [];
  let offset = 0, line = 1, column = 1;
  const take = () => {
    const c = source[offset++];
    if (c === '\n') { line++; column = 1; } else column++;
    return c;
  };
  // FsDoc "Lexical conventions" (https://cad.onshape.com/FsDoc/tokens.html):
  // the C escapes b, t, n, f, r, an escaped backslash or quotation mark, and
  // \u followed by exactly four hex digits, as in Java or JavaScript. A
  // surrogate pair is two \u escapes; the UTF-16 code units concatenate.
  const escape = start => {
    if (offset >= source.length) fail('Unterminated string literal', start);
    const escaped = take();
    if (escaped === 'u') {
      const hex = source.slice(offset, offset + 4);
      if (!/^[0-9A-Fa-f]{4}$/.test(hex)) fail('String escape \\u needs exactly four hex digits', start);
      for (const _ of hex) take();
      return String.fromCharCode(Number.parseInt(hex, 16));
    }
    const escapes = { b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '\\': '\\', '"': '"', "'": "'" };
    if (!Object.hasOwn(escapes, escaped)) fail(`Unsupported string escape \\${escaped}`, start);
    return escapes[escaped];
  };
  while (offset < source.length) {
    if (/\s/.test(source[offset])) { take(); continue; }
    if (source.startsWith('//', offset)) {
      while (offset < source.length && source[offset] !== '\n') take();
      continue;
    }
    const start = { line, column };
    if (source.startsWith('/*', offset)) {
      take(); take();
      while (offset < source.length && !source.startsWith('*/', offset)) take();
      if (offset === source.length) fail('Unterminated block comment', start);
      take(); take(); continue;
    }
    const c = source[offset];
    if (c === '"' || c === "'") {
      const quote = take();
      let value = '';
      while (offset < source.length && source[offset] !== quote) {
        let next = take();
        if (next === '\n' || next === '\r') fail('Newline in string literal', start);
        if (next === '\\') next = escape(start);
        value += next;
      }
      if (offset >= source.length) fail('Unterminated string literal', start);
      take(); tokens.push({ kind: 'string', value, ...start }); continue;
    }
    const number = source.slice(offset).match(/^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/);
    if (number) {
      for (const _ of number[0]) take();
      const value = Number(number[0]);
      if (!Number.isFinite(value)) fail('Number is not finite', start);
      tokens.push({ kind: 'number', value, ...start }); continue;
    }
    const name = source.slice(offset).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (name) {
      for (const _ of name[0]) take();
      tokens.push({ kind: 'name', value: name[0], ...start }); continue;
    }
    const op = ['::', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/='].find(x => source.startsWith(x, offset));
    if (op) { take(); take(); tokens.push({ kind: 'symbol', value: op, ...start }); continue; }
    if ('{}[]();,:.+-*/%^~!=<>?'.includes(c)) {
      take(); tokens.push({ kind: 'symbol', value: c, ...start }); continue;
    }
    fail(`Unsupported FeatureScript token ${JSON.stringify(c)}`, start);
  }
  tokens.push({ kind: 'eof', value: '<eof>', line, column });
  return tokens;
}

const precedence = { '||': 1, '&&': 2, '==': 3, '!=': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '~': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7, '^': 8 };

class Parser {
  constructor(source) { this.tokens = tokenize(source); this.index = 0; }
  get token() { return this.tokens[this.index]; }
  // Keywords and punctuation are name and symbol tokens. A string literal is
  // never syntax, so "function" or "-" stays a string value.
  at(value) { return this.token.value === value && this.token.kind !== 'string'; }
  peek(offset = 1) { return this.tokens[this.index + offset]; }
  peekIs(value, offset = 1) { const token = this.peek(offset); return token?.value === value && token.kind !== 'string'; }
  take() { return this.tokens[this.index++]; }
  accept(value) { if (this.at(value)) return this.take(); return null; }
  expect(value) {
    if (!this.at(value)) fail(`Expected '${value}', found '${this.token.value}'`, this.token);
    return this.take();
  }
  name() {
    if (this.token.kind !== 'name') fail('Expected an identifier', this.token);
    return this.take().value;
  }
  annotations() {
    const values = [];
    while (this.accept('annotation')) values.push(this.object());
    return values;
  }
  program() {
    this.expect('FeatureScript');
    const version = this.take();
    if (version.kind !== 'number' || !Number.isInteger(version.value) || version.value <= 0) fail('Expected FeatureScript version number', version);
    this.expect(';');
    const imports = [], declarations = [];
    while (this.token.kind !== 'eof') {
      const annotations = this.annotations();
      const exported = !!this.accept('export');
      let namespace = null;
      if (this.token.kind === 'name' && this.peekIs('::')) {
        namespace = this.name(); this.expect('::');
        if (!this.at('import')) fail('Expected a namespace import', this.token);
      }
      if (this.accept('import')) {
        if (exported) fail('Re-exported imports are not supported', this.token);
        this.expect('(');
        const fields = Object.create(null);
        do {
          const key = this.name(); this.expect(':');
          const value = this.take();
          if (value.kind !== 'string') fail('Import paths and versions must be strings', value);
          if (Object.hasOwn(fields, key)) fail(`Duplicate import field '${key}'`, value);
          fields[key] = value.value;
        } while (this.accept(','));
        this.expect(')'); this.expect(';'); imports.push({ ...fields, namespace });
      } else if (this.at('const')) {
        declarations.push({ ...this.declaration(), exported, annotations });
      } else if (this.accept('function')) {
        const loc = this.token;
        const name = this.name();
        declarations.push({ kind: 'declaration', name, constant: true, value: this.functionTail(loc), exported, annotations, loc });
      } else if (this.accept('enum')) {
        const loc = this.token, name = this.name(), members = [];
        this.expect('{');
        if (!this.at('}')) do {
          if (this.at('}')) break;
          const annotations = this.annotations();
          members.push({ name: this.name(), annotations });
        } while (this.accept(','));
        this.expect('}');
        declarations.push({ kind: 'enum', name, members, exported, annotations, loc });
      } else {
        fail('Supported top-level constructs: imports, constants, functions, and enums', this.token);
      }
    }
    return { version: version.value, imports, declarations };
  }
  declaration(terminate = true) {
    const loc = this.take(); const name = this.name();
    const type = this.accept('is') ? this.name() : null;
    let value = null;
    if (this.accept('=')) value = this.expression();
    if ((loc.value === 'const' || type) && !value) fail('A constant or typed variable requires an initializer', loc);
    if (terminate) this.expect(';');
    return { kind: 'declaration', name, type, value, constant: loc.value === 'const', loc };
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
    const loc = this.token;
    if (this.accept(';')) return { kind: 'empty', loc };
    if (this.at('{')) return this.block();
    if (this.at('const') || this.at('var')) return this.declaration();
    if (this.accept('throw')) {
      const value = this.expression(); this.expect(';'); return { kind: 'throw', value, loc };
    }
    if (this.at('break') || this.at('continue')) {
      const kind = this.take().value; this.expect(';'); return { kind, loc };
    }
    // FsDoc "Exception handling" (https://cad.onshape.com/FsDoc/exceptions.html):
    // `try { } catch (e) { }`, `catch { }` without a binding, and a try
    // statement without catch, after which execution continues with the next
    // statement. `silent` only suppresses the notice; it catches the same
    // errors. The try(...) and try silent(...) expression forms stay below.
    if (this.at('try') && (this.peekIs('{') || (this.peekIs('silent') && this.peekIs('{', 2)))) {
      this.take(); const silent = !!this.accept('silent'); const body = this.block();
      let name = null, handler;
      if (this.accept('catch')) {
        if (this.accept('(')) { name = this.name(); this.expect(')'); }
        handler = this.block();
      } else handler = { kind: 'block', statements: [], loc: this.token };
      return { kind: 'try', body, name, handler, silent, loc };
    }
    if (this.accept('return')) {
      const value = this.at(';') ? null : this.expression(); this.expect(';');
      return { kind: 'return', value, loc };
    }
    if (this.accept('if')) {
      this.expect('('); const condition = this.expression(); this.expect(')');
      const yes = this.statement(); const no = this.accept('else') ? this.statement() : null;
      return { kind: 'if', condition, yes, no, loc };
    }
    if (this.accept('for')) {
      this.expect('(');
      // FsDoc "Syntax and semantics": `for (var a in x)` binds each item (or,
      // for a map, a { key, value } map); `for (var a, b in x)` binds the key
      // or index to a and the value to b. `name` is always the value binding;
      // `key` is null for the one-variable form.
      if (this.at('var') && (this.peekIs('in', 2) || (this.peekIs(',', 2) && this.peekIs('in', 4)))) {
        this.take(); let key = null, name = this.name();
        if (this.accept(',')) { key = name; name = this.name(); }
        this.expect('in');
        const values = this.expression(); this.expect(')');
        return { kind: 'for', key, name, values, body: this.statement(), loc };
      }
      const initial = this.at(';') ? null : (this.at('var') || this.at('const') ? this.declaration(false) : this.expressionStatement(false));
      this.expect(';'); const condition = this.expression(); this.expect(';');
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
  expressionStatement(terminate = true) {
    const loc = this.token;
    const value = this.expression();
    if (['=', '+=', '-=', '*=', '/='].includes(this.token.value)) {
      const operator = this.take().value;
      if (!['name', 'access'].includes(value.kind)) fail('Expected a variable or container element for assignment', loc);
      const rhs = this.expression(); if (terminate) this.expect(';');
      return { kind: 'assign', target: value, operator, value: rhs, loc };
    }
    if (terminate) this.expect(';'); return { kind: 'expression', value, loc };
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
    return { kind: 'function', params, returnType, precondition, body, loc };
  }
  object() {
    const loc = this.expect('{'), fields = [];
    if (!this.at('}')) do {
      if (this.at('}')) break;
      let key;
      if (this.accept('(')) { key = this.expression(); this.expect(')'); }
      else {
        const token = this.take();
        if (!['string', 'name'].includes(token.kind)) fail('Expected map key', token);
        key = { kind: 'literal', value: token.value, loc: token };
      }
      this.expect(':'); fields.push([key, this.expression()]);
    } while (this.accept(','));
    this.expect('}'); return { kind: 'map', fields, loc };
  }
  expression(min = 0) {
    const loc = this.token; let value;
    if (this.accept('try')) {
      const silent = !!this.accept('silent'); this.expect('(');
      const expression = this.expression(); this.expect(')');
      value = { kind: 'tryExpression', value: expression, silent, loc };
    } else if (this.accept('-') || this.accept('!')) {
      value = { kind: 'unary', operator: loc.value, value: this.expression(8), loc };
    } else if (this.accept('(')) {
      value = this.expression(); this.expect(')');
    } else if (this.at('{')) value = this.object();
    else if (this.accept('[')) {
      const items = [];
      if (!this.at(']')) do { if (this.at(']')) break; items.push(this.expression()); } while (this.accept(','));
      this.expect(']'); value = { kind: 'array', items, loc };
    } else if (this.accept('function')) value = this.functionTail(loc);
    else if (loc.kind === 'number' || loc.kind === 'string') {
      this.take(); value = { kind: 'literal', value: loc.value, loc };
    } else if (['true', 'false', 'undefined'].includes(loc.value)) {
      this.take(); value = { kind: 'literal', value: { true: true, false: false, undefined: undefined }[loc.value], loc };
    } else if (loc.kind === 'name') {
      this.take(); const name = this.accept('::') ? `${loc.value}::${this.name()}` : loc.value;
      value = { kind: 'name', name, loc };
    } else fail(`Unsupported expression '${loc.value}'`, loc);
    while (true) {
      if (this.accept('(')) {
        const args = [];
        if (!this.at(')')) do { args.push(this.expression()); } while (this.accept(','));
        this.expect(')'); value = { kind: 'call', callee: value, args, loc }; continue;
      }
      if (this.accept('.')) {
        value = { kind: 'access', value, key: { kind: 'literal', value: this.name(), loc }, loc }; continue;
      }
      if (this.accept('[')) {
        const key = this.expression(); this.expect(']'); value = { kind: 'access', value, key, loc }; continue;
      }
      const op = this.token.value;
      if (op === 'is' || op === 'as') {
        if (min > 4) break;
        this.take(); value = { kind: 'type', operator: op, value, type: this.name(), loc }; continue;
      }
      const rank = precedence[op];
      if (rank === undefined || rank < min) break;
      this.take(); value = { kind: 'binary', operator: op, left: value, right: this.expression(op === '^' ? rank : rank + 1), loc };
    }
    if (min === 0 && this.accept('?')) {
      const yes = this.expression(); this.expect(':'); value = { kind: 'conditional', condition: value, yes, no: this.expression(), loc };
    }
    return value;
  }
}

export const parse = source => new Parser(source).program();
export function parseExpression(source) {
  const parser = new Parser(source); const result = parser.expression();
  if (parser.token.kind !== 'eof') fail('Unexpected token after parameter expression', parser.token);
  return result;
}
