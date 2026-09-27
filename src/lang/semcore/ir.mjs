// WCore/0: the expression-only core IR of the semantic-core study
// (docs/language/semantic-core.md). Frontends desugar into it; an evaluator
// (JS reference in ./eval.mjs, a Bend evaluator later) runs it.
//
// Every node is a JSON array whose first element is the tag:
//   ['lit', v]                     number (binary64) | string | boolean
//   ['undef']                      FeatureScript undefined
//   ['var', name]                  local binding (names are unique per program)
//   ['glob', name, span]           top-level definition or host builtin, late bound
//   ['let', name, value, body]
//   ['letrec', [[name, fn], ...], body]   recursive local functions (join points, loops)
//   ['fn', [params], body, meta]   closure; captures the *values* of free locals
//   ['call', f, [args], span]
//   ['prim', op, [args], span]     pure value operation (see PRIMS)
//   ['if', cond, then, else, span] cond must be a boolean
//   ['list', [items]]
//   ['map', [[key, value], ...], span]
//   ['ctor', tag, [items]]         compiler-internal tagged tuple (reified control)
//   ['case', scrutinee, {tag: [[names], body]}]
//   ['handle', body, name, handler, {silent, span}]  catches model exceptions only
//   ['raise', value, span]
// There are no statements, no mutable variables and no loops: the desugarer
// turns assignment into rebinding, loops into recursive join points and
// return/break/continue into calls of those join points.
//
// Spans are indices into a per-program span table ({line, column}); a failing
// node reports its span, which the host maps back to file:line:column.

export const PRIMS = new Set([
  // arithmetic, comparison, string concatenation (FS operator semantics, units checked)
  '+', '-', '*', '/', '%', '^', '==', '!=', '<', '<=', '>', '>=', '~', 'neg', 'not', 'truth',
  // data
  'index', 'update', 'iter-array', 'size-of', 'is', 'as', 'enum',
  // explicit runtime failures emitted by the desugarer where the reference
  // interpreter fails at run time (kept at run time to preserve laziness)
  'fail', 'unsupported', 'precondition', 'check-type', 'loop-control-outside-loop', 'assign-global',
]);

// Readable S-expression form for documentation and debugging.
export function printIR(node, indent = 0) {
  const pad = ' '.repeat(indent), next = indent + 2;
  const atom = v => typeof v === 'string' ? JSON.stringify(v) : String(v);
  switch (node[0]) {
    case 'lit': return atom(node[1]);
    case 'undef': return 'undefined';
    case 'var': return node[1];
    case 'glob': return `@${node[1]}`;
    case 'let': return `(let ${node[1]} ${printIR(node[2], next)}\n${pad}${printIR(node[3], indent)})`;
    case 'letrec': return `(letrec (${node[1].map(([n, f]) => `[${n} ${printIR(f, next + 2)}]`).join(`\n${pad}  `)})\n${pad}${printIR(node[2], indent)})`;
    case 'fn': return `(${node[3]?.join ? 'join' : 'fn'} (${node[1].join(' ')})\n${' '.repeat(next)}${printIR(node[2], next)})`;
    case 'call': return `(${[node[1], ...node[2]].map(n => printIR(n, next)).join(' ')})`;
    case 'prim': return `(${node[1]} ${node[2].map(n => printIR(n, next)).join(' ')})`;
    case 'if': return `(if ${printIR(node[1], next)}\n${' '.repeat(next)}${printIR(node[2], next)}\n${' '.repeat(next)}${printIR(node[3], next)})`;
    case 'list': return `[${node[1].map(n => printIR(n, next)).join(' ')}]`;
    case 'map': return `{${node[1].map(([k, v]) => `${printIR(k, next)} ${printIR(v, next)}`).join(', ')}}`;
    case 'ctor': return `(#${node[1]} ${node[2].map(n => printIR(n, next)).join(' ')})`;
    case 'case': return `(case ${printIR(node[1], next)}${Object.entries(node[2]).map(([t, [ns, b]]) => `\n${' '.repeat(next)}[#${t} (${ns.join(' ')}) ${printIR(b, next + 2)}]`).join('')})`;
    case 'handle': return `(handle${node[4].silent ? '-silent' : ''} ${printIR(node[1], next)}\n${' '.repeat(next)}(catch ${node[2]} ${printIR(node[3], next)}))`;
    case 'raise': return `(raise ${printIR(node[1], next)})`;
    default: return `<?${node[0]}>`;
  }
}

export class SpanTable {
  constructor() { this.spans = []; }
  add(loc) {
    if (!loc) return -1;
    this.spans.push({ line: loc.line, column: loc.column });
    return this.spans.length - 1;
  }
  get(index) { return index >= 0 ? this.spans[index] : undefined; }
}

// Node statistics and an exact U32 word encoding size, as a stand-in for what
// a host would ship to a Bend evaluator: one word per tag/arity/child count,
// numbers as two words of binary64 bits, strings interned once in a table
// (length word + 4 UTF-8 bytes per word), span ids one word.
export function irStats(program) {
  const strings = new Map();
  let nodes = 0, words = 0, numbers = 0, maxDepth = 0;
  const intern = s => { if (!strings.has(s)) strings.set(s, strings.size); words++; };
  // Explicit work stack: desugared straight-line code nests deeply (one let per statement).
  const stack = [];
  const walk = (root, rootDepth) => {
    stack.push([root, rootDepth]);
    while (stack.length) {
      const [node, depth] = stack.pop();
      if (!Array.isArray(node) || typeof node[0] !== 'string') throw new TypeError(`Invalid IR node ${JSON.stringify(node)?.slice(0, 80)}`);
      nodes++; words++; maxDepth = Math.max(maxDepth, depth);
      const child = n => stack.push([n, depth + 1]);
      switch (node[0]) {
        case 'lit':
          if (typeof node[1] === 'number') { words += 2; numbers++; } else if (typeof node[1] === 'string') intern(node[1]); else words++;
          break;
        case 'undef': break;
        case 'var': intern(node[1]); break;
        case 'glob': intern(node[1]); words++; break;
        case 'let': intern(node[1]); child(node[2]); child(node[3]); break;
        case 'letrec': words++; for (const [name, fn] of node[1]) { intern(name); child(fn); } child(node[2]); break;
        case 'fn':
          words += 2; for (const p of node[1]) intern(p); child(node[2]);
          for (const row of node[3]?.defaults ?? []) { intern(row.key); row.annotations.forEach(child); if (row.bounds) child(row.bounds); }
          break;
        case 'call': child(node[1]); words += 2; node[2].forEach(child); break;
        case 'prim': intern(node[1]); words += 2; node[2].forEach(child); break;
        case 'if': node.slice(1, 4).forEach(child); words++; break;
        case 'list': words++; node[1].forEach(child); break;
        case 'map': words += 2; for (const [k, v] of node[1]) { child(k); child(v); } break;
        case 'ctor': intern(node[1]); words++; node[2].forEach(child); break;
        case 'case': child(node[1]); words++; for (const [tag, [names, body]] of Object.entries(node[2])) { intern(tag); words++; names.forEach(intern); child(body); } break;
        case 'handle': child(node[1]); intern(node[2]); child(node[3]); words += 2; break;
        case 'raise': child(node[1]); words++; break;
        default: throw new TypeError(`Unknown IR tag ${node[0]}`);
      }
    }
  };
  for (const def of program.globals) { words += 2; intern(def.name); walk(def.value, 0); }
  let stringWords = 0;
  for (const s of strings.keys()) stringWords += 1 + Math.ceil(Buffer.byteLength(s) / 4);
  return { nodes, numbers, maxDepth, globals: program.globals.length, spans: program.spans.spans.length,
    distinctStrings: strings.size, words: words + stringWords + program.spans.spans.length * 2,
    bytes: 4 * (words + stringWords + program.spans.spans.length * 2) };
}
