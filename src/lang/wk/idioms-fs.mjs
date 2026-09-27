// Loop idioms of FeatureScript that WK expresses as structured regions
// (proposal §5.2). The rewrite runs on the parser AST before desugaring and
// replaces a loop only when the replacement has the same meaning for every
// collection, concrete or symbolic:
//
//   select   for (var x in E) { if (P) acc = append(acc, x); }
//            -> acc = __wk_select(acc, E, function(x) { return P; });
//   map      for (var x in E) { acc = append(acc, F); }
//            -> acc = __wk_map(acc, E, function(x) { return F; });
//   index    for (var x in E) M[K] = x;   -> M = __wk_index(M, E, function(x) { return K; });
//   foreach  for (var x in E) BODY          (BODY assigns no outer variable and
//            -> __wk_foreach(E, function(x) BODY);     has no break/continue/return)
//   foreach  for (var i = 0; i < size(L); i += 1) BODY   (same conditions, i not assigned)
//            -> __wk_foreach_index(L, function(i) BODY);
//
// With a concrete collection the staging builtins simply run the loop, in
// order; the idiom only matters when the collection is a kernel result.

const unwrap = s => (s?.kind === 'block' && s.statements.length === 1 ? s.statements[0] : s);
const name = (n, loc) => ({ kind: 'name', name: n, loc });
const call = (callee, args, loc) => ({ kind: 'call', callee: name(callee, loc), args, loc });
const lambda = (params, body, loc) => ({ kind: 'function', params: params.map(p => ({ name: p, type: null })), returnType: null, precondition: null,
  body: body.kind === 'block' ? body : { kind: 'block', statements: [body], loc }, loc });
const isName = (n, v) => n?.kind === 'name' && (v === undefined || n.name === v);

function mentions(node, variable) {
  if (!node || typeof node !== 'object') return false;
  if (node.kind === 'name' && node.name === variable) return true;
  return Object.values(node).some(v => Array.isArray(v) ? v.some(x => mentions(x, variable)) : v && typeof v === 'object' && v !== node.loc && mentions(v, variable));
}
// Variables declared inside a statement (not in nested functions).
function declared(node, out = new Set()) {
  if (!node || typeof node !== 'object') return out;
  if (node.kind === 'declaration') out.add(node.name);
  if (node.kind === 'function') return out;
  for (const [k, v] of Object.entries(node)) if (k !== 'loc') (Array.isArray(v) ? v : [v]).forEach(x => x && typeof x === 'object' && declared(x, out));
  return out;
}
function assignedRoots(node, out = new Set()) {
  if (!node || typeof node !== 'object' || node.kind === 'function') return out;
  if (node.kind === 'assign') { let t = node.target; while (t.kind === 'access') t = t.value; if (t.kind === 'name') out.add(t.name); }
  for (const [k, v] of Object.entries(node)) if (k !== 'loc') (Array.isArray(v) ? v : [v]).forEach(x => x && typeof x === 'object' && assignedRoots(x, out));
  return out;
}
function escapes(node) {
  if (!node || typeof node !== 'object' || node.kind === 'function') return false;
  if (['break', 'continue', 'return'].includes(node.kind)) return true;
  return Object.entries(node).some(([k, v]) => k !== 'loc' && (Array.isArray(v) ? v.some(escapes) : v && typeof v === 'object' && escapes(v)));
}
const selfContained = (body, extra = []) => {
  const inner = declared(body);
  return !escapes(body) && [...assignedRoots(body)].every(v => inner.has(v) && !extra.includes(v));
};

function rewriteLoop(stmt, rewrites) {
  if (stmt.kind === 'for') {
    const x = stmt.name, loc = stmt.loc;
    // select: optional leading declarations (per-element measurements such as
    // var bb = evBox3d(...)), then one guarded append of the element itself.
    const statements = stmt.body.kind === 'block' ? stmt.body.statements : [stmt.body];
    const lead = statements.slice(0, -1), last = unwrap(statements.at(-1));
    if (lead.every(s => s.kind === 'declaration' && s.value?.kind !== 'function') && last?.kind === 'if' && !last.no) {
      const yes = unwrap(last.yes);
      if (yes?.kind === 'assign' && yes.operator === '=' && isName(yes.target) && yes.value.kind === 'call' && isName(yes.value.callee, 'append')
        && isName(yes.value.args[0], yes.target.name) && isName(yes.value.args[1], x) && !lead.some(s => s.name === yes.target.name)) {
        rewrites.push({ idiom: 'select', line: loc.line });
        return { kind: 'assign', target: yes.target, operator: '=', loc,
          value: call('__wk_select', [name(yes.target.name, loc), stmt.values, lambda([x], { kind: 'block', statements: [...lead, { kind: 'return', value: last.condition, loc }], loc }, loc)], loc) };
      }
    }
    const body = unwrap(stmt.body);
    // index: a name table built from a kernel result, e.g. generated code's
    // n_base[getProperty(c, {entity: b, propertyType: NAME})] = b
    if (body?.kind === 'assign' && body.operator === '=' && body.target.kind === 'access' && isName(body.target.value) && isName(body.value, x)
      && !mentions(body.target.key, body.target.value.name)) {
      rewrites.push({ idiom: 'index', line: loc.line });
      const table = body.target.value.name;
      return { kind: 'assign', target: name(table, loc), operator: '=', loc,
        value: call('__wk_index', [name(table, loc), stmt.values, lambda([x], { kind: 'return', value: body.target.key, loc }, loc)], loc) };
    }
    if (body?.kind === 'assign' && body.operator === '=' && isName(body.target) && body.value.kind === 'call' && isName(body.value.callee, 'append')
      && isName(body.value.args[0], body.target.name) && !mentions(body.value.args[1], body.target.name)) {
      rewrites.push({ idiom: 'map', line: loc.line });
      return { kind: 'assign', target: body.target, operator: '=', loc,
        value: call('__wk_map', [name(body.target.name, loc), stmt.values, lambda([x], { kind: 'return', value: body.value.args[1], loc }, loc)], loc) };
    }
    if (selfContained(stmt.body)) {
      rewrites.push({ idiom: 'foreach', line: loc.line });
      return { kind: 'expression', value: call('__wk_foreach', [stmt.values, lambda([x], stmt.body, loc)], loc), loc };
    }
    // reduce: the body assigns outer variables (an accumulator, an argmax) and
    // has no break/continue/return. The carried variables go in and out of a
    // lambda; the staging builtin runs it as a loop or as a reduce region
    // (effects inside are rejected there).
    const carried = [...assignedRoots(stmt.body)].filter(v => !declared(stmt.body).has(v));
    if (!escapes(stmt.body) && carried.length && !carried.includes(x)) {
      rewrites.push({ idiom: 'reduce', line: loc.line });
      const acc = `__wk_acc${loc.line}_${loc.column}`;
      const arr = vs => ({ kind: 'array', items: vs.map(v => name(v, loc)), loc });
      const fn = lambda([x, ...carried], { kind: 'block', statements: [stmt.body, { kind: 'return', value: arr(carried), loc }], loc }, loc);
      return { kind: 'block', loc, statements: [
        { kind: 'declaration', name: acc, type: null, constant: false, value: call('__wk_reduce', [stmt.values, arr(carried), fn], loc), loc },
        ...carried.map((v, i) => ({ kind: 'assign', target: name(v, loc), operator: '=', value: { kind: 'access', value: name(acc, loc), key: { kind: 'literal', value: i, loc }, loc }, loc })),
      ] };
    }
  }
  if (stmt.kind === 'forC') {
    const { initial: init, condition: cond, increment: inc, loc } = stmt;
    const i = init?.kind === 'declaration' ? init.name : null;
    const zero = init?.value?.kind === 'literal' && init.value.value === 0;
    const bound = cond?.kind === 'binary' && cond.operator === '<' && isName(cond.left, i) && cond.right.kind === 'call' && isName(cond.right.callee, 'size') && cond.right.args.length === 1 && !mentions(cond.right.args[0], i);
    const step = inc?.kind === 'assign' && isName(inc.target, i) && ((inc.operator === '+=' && inc.value.kind === 'literal' && inc.value.value === 1));
    if (i && zero && bound && step && selfContained(stmt.body, [i])) {
      rewrites.push({ idiom: 'foreach-index', line: loc.line });
      return { kind: 'expression', value: call('__wk_foreach_index', [cond.right.args[0], lambda([i], stmt.body, loc)], loc), loc };
    }
  }
  return null;
}

// check with diagnostics: if (C) { S...; throw E; }  (S computes the message,
// no return/break/continue) -> if (C) throw __wk_message(function() { S...; return E; });
// Same meaning (the throw aborts the feature either way); the check becomes
// one expect node and S only shapes its message.
function rewriteCheck(stmt, rewrites) {
  if (stmt.kind !== 'if' || stmt.no || stmt.yes?.kind !== 'block') return null;
  const body = stmt.yes.statements, last = body.at(-1);
  if (body.length < 2 || last?.kind !== 'throw' || body.slice(0, -1).some(escapes)) return null;
  rewrites.push({ idiom: 'check-message', line: stmt.loc.line });
  const fn = lambda([], { kind: 'block', statements: [...body.slice(0, -1), { kind: 'return', value: last.value, loc: last.loc }], loc: stmt.loc }, stmt.loc);
  return { ...stmt, yes: { kind: 'throw', value: call('__wk_message', [fn], last.loc), loc: last.loc } };
}

function walk(node, rewrites) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(n => walk(n, rewrites));
  const out = {};
  for (const [k, v] of Object.entries(node)) out[k] = k === 'loc' ? v : walk(v, rewrites);
  if (out.kind === 'for' || out.kind === 'forC') return rewriteLoop(out, rewrites) ?? out;
  if (out.kind === 'if') return rewriteCheck(out, rewrites) ?? out;
  return out;
}

export function rewriteIdioms(ast) {
  const rewrites = [];
  const declarations = ast.declarations.map(d => walk(d, rewrites));
  return { ast: { ...ast, declarations }, rewrites };
}
