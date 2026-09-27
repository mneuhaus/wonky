#!/usr/bin/env node
// Generates exact U32 wire codecs for Bend kernel ADTs, plus a U32-in/U32-out
// op dispatcher, from the `type` declarations and `def` signatures in
// kernel/**/*.bend. Everything under the output directory is generated; edit
// this script, never its output.
//
// Wire format (one flat little-endian U32 stream, no padding):
//   U32   -> 1 word
//   F32   -> 1 word, IEEE-754 bit pattern (F32.bits); -0, subnormals kept
//   Bool  -> 1 word, 0 or 1 (anything else is a decode error)
//   String-> code point count word, then one word per Char code (Unicode
//            scalar values and lone surrogates; > 0x10FFFF is a decode error)
//   ADT   -> constructor tag word (declaration index) when the type has more
//            than one constructor, then every field in declaration order.
//            Real{hi, lo} is therefore exactly two words: bits(hi), bits(lo).
//   List  -> element count word, then the elements
//   Maybe -> tag word (0 None, 1 Some) then the value
// Op frames: request = arguments in parameter order; response = status word
// (0 ok, 1 malformed request, 2 unknown op) followed, on 0, by the result.
//
// Counts are checked before anything is decoded: a List or String count n
// whose elements need at least w words each (minWords, w >= 1: the generator
// refuses element types without words) is malformed when n * w exceeds the
// words left after the count word. Both decoders apply exactly this rule, so a
// request that claims more than it carries costs work and memory in proportion
// to its own length, never to the claimed count. The Bend decoder also treats
// every count met after a failure as 0, so a failed request decodes nothing more
// than its remaining fields' fixed parts.
//
// Usage:
//   node scripts/native-bridge/gen-wire.mjs --out DIR --type real.bend:Real \
//     --type analytic.bend:Solid --op real.bend:max
//   node scripts/native-bridge/gen-wire.mjs --survey FILE.json   (codability of every kernel type/def)
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const kernelRoot = join(projectRoot, 'kernel');
const BASE = new Set(['U32', 'F32', 'Bool', 'String']);

export class WireError extends Error {}
const wireError = message => { throw new WireError(message); };

// ---------------------------------------------------------------- parsing

function splitTop(text, separator = ',') {
  const parts = []; let depth = 0, current = '';
  for (const ch of text) {
    if ('<({['.includes(ch)) depth++;
    if ('>)}]'.includes(ch)) depth--;
    if (ch === separator && depth === 0) { parts.push(current.trim()); current = ''; }
    else current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

const balance = text => [...text].reduce((depth, ch) => depth + (ch === '{') - (ch === '}'), 0);

const modules = new Map();
export function parseModule(file) {
  const path = resolve(file);
  if (modules.has(path)) return modules.get(path);
  const lines = readFileSync(path, 'utf8').split('\n');
  const module = { file: path, id: moduleId(path), aliases: new Map(), types: new Map(), defs: new Map() };
  modules.set(path, module);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    if ((m = /^import\s+(\S+\.bend)\s+as\s+(\w+)\s*$/.exec(line))) module.aliases.set(m[2], resolve(dirname(path), m[1]));
    else if ((m = /^type\s+(\w+)(<[^>]*>)?\s+is\s+([^:]+):\s*$/.exec(line))) {
      const type = { name: m[1], generic: Boolean(m[2]), kind: m[3].trim(), line: i + 1, ctors: [] };
      while (i + 1 < lines.length && /^  \w/.test(lines[i + 1])) {
        let text = lines[++i].trim();
        while (balance(text) > 0 && i + 1 < lines.length) text += ' ' + lines[++i].trim();
        const c = /^(\w+)\{(.*)\}$/.exec(text) ?? wireError(`${path}:${i + 1}: cannot parse constructor '${text}'`);
        type.ctors.push({ name: c[1], fields: splitTop(c[2]).map(field => {
          const f = /^(\w+)\s*:\s*(.+)$/.exec(field) ?? wireError(`${path}:${i + 1}: cannot parse field '${field}'`);
          return { name: f[1], type: f[2].trim() };
        }) });
      }
      module.types.set(type.name, type);
    } else if ((m = /^(@unsafe\s+)?def\s+([\w.]+)\s*\(/.exec(line))) {
      let text = line.trim(), start = i;
      while (!/\)\s*->\s*.+:\s*$/.test(text) && i + 1 < lines.length) text += ' ' + lines[++i].trim();
      const s = /^(?:@unsafe\s+)?def\s+([\w.]+)\s*\((.*)\)\s*->\s*(.+):\s*$/.exec(text);
      if (!s) continue; // law-filling defs and oddities are not entry points
      module.defs.set(s[1], { name: s[1], line: start + 1, unsafe: Boolean(m[1]), ret: s[3].trim(),
        params: splitTop(s[2]).map(param => {
          const p = /^([+~-]?)(\w+)(?:\s*:\s*(.+))?$/.exec(param) ?? wireError(`${path}:${start + 1}: cannot parse parameter '${param}'`);
          return { name: p[2], mode: p[1], type: p[3]?.trim() ?? null };
        }) });
    }
  }
  return module;
}

export function moduleId(path) {
  return relative(kernelRoot, path).replace(/\.bend$/, '').replace(/[^A-Za-z0-9]+/g, '_');
}

// Type expressions: base | adt | list | maybe. Anything else is reported with
// the reason it cannot cross the wire, so a survey can count coverage.
export function resolveType(module, text) {
  text = text.trim();
  let m;
  if ((m = /^(List|Maybe)<(.*)>$/.exec(text))) {
    const args = splitTop(m[2]);
    if (args.length !== 2 || args[0] !== '&2') wireError(`${module.id}: '${text}' is not a reusable (&2) container`);
    return { kind: m[1] === 'List' ? 'list' : 'maybe', elem: resolveType(module, args[1]) };
  }
  if (BASE.has(text)) return { kind: 'base', name: text };
  if ((m = /^(\w+)\.(\w+)$/.exec(text))) {
    const target = module.aliases.get(m[1]) ?? wireError(`${module.id}: unknown module alias in '${text}'`);
    return adtRef(parseModule(target), m[2], text);
  }
  if (/^\w+$/.test(text) && module.types.has(text)) return adtRef(module, text, text);
  return wireError(`${module.id}: type '${text}' has no wire encoding (Nat, Char, Cmp, arrays, closures and generics are not supported)`);
}

function adtRef(module, name, text) {
  const type = module.types.get(name) ?? wireError(`${module.id}: '${text}' is not declared in ${relative(projectRoot, module.file)}`);
  if (type.generic) wireError(`${module.id}: generic type '${text}' is not supported`);
  if (type.kind !== 'Data') wireError(`${module.id}: '${text}' is ${type.kind}, not Data`);
  return { kind: 'adt', module, name, type };
}

export const typeKey = t => t.kind === 'base' ? t.name : t.kind === 'list' ? `L_${typeKey(t.elem)}`
  : t.kind === 'maybe' ? `M_${typeKey(t.elem)}` : `${t.module.id}_${t.name}`;
export const typeLabel = t => t.kind === 'base' ? t.name : t.kind === 'list' ? `List<${typeLabel(t.elem)}>`
  : t.kind === 'maybe' ? `Maybe<${typeLabel(t.elem)}>` : `${relative(kernelRoot, t.module.file)}:${t.name}`;

// Walks a type and returns every ADT it reaches, children first. A list whose
// elements can be zero words wide is refused: its count could not be bounded
// by the message length (see the count rule in the header).
export function closure(roots) {
  const order = [], state = new Map();
  const visit = t => {
    if (t.kind === 'list') {
      visit(t.elem);
      if (minWords(t.elem) < 1) wireError(`${typeLabel(t)}: elements of zero words cannot be bounded by the message length`);
      return;
    }
    if (t.kind === 'maybe') return visit(t.elem);
    if (t.kind !== 'adt') return;
    const key = typeKey(t);
    if (state.get(key) === 'done') return;
    if (state.get(key) === 'active') wireError(`recursive type ${typeLabel(t)} is not supported`);
    state.set(key, 'active');
    for (const ctor of t.type.ctors) for (const field of ctor.fields) visit(resolveType(t.module, field.type));
    state.set(key, 'done'); order.push(t);
  };
  roots.forEach(visit);
  return order;
}

// Fewest words any value of the type occupies on the wire (empty lists and
// strings, the narrowest constructor). Call only on types closure() accepted.
const minMemo = new Map();
export function minWords(t) {
  if (t.kind !== 'adt') return 1;
  const key = typeKey(t);
  if (!minMemo.has(key)) minMemo.set(key, (t.type.ctors.length > 1 ? 1 : 0) +
    Math.min(...t.type.ctors.map(c => c.fields.reduce((n, f) => n + minWords(resolveType(t.module, f.type)), 0))));
  return minMemo.get(key);
}

// Static word count when fixed, otherwise null. Used for the manifest only.
export function fixedWords(t) {
  if (t.kind === 'base') return t.name === 'String' ? null : 1;
  if (t.kind !== 'adt') return null;
  if (t.type.ctors.length !== 1) return null;
  let total = 0;
  for (const field of t.type.ctors[0].fields) {
    const n = fixedWords(resolveType(t.module, field.type));
    if (n === null) return null;
    total += n;
  }
  return total;
}

// Estimated flattened width in words as Bend's native C backend lays values
// out (scalars 1, List/String a pointer, Maybe tag + value, ADT tag + the
// widest constructor). The emitter refuses "an arity over 255" when a wide
// value is held across a non-tail call; a generated encoder holds every field
// but the last while it encodes the first, so heldWords > 255 predicts that
// refusal (validated: section.bend:PairResolution, 344 -> refused; the whole
// production closure stays <= 124 and emits). An estimate, not Bend's layout.
const widthMemo = new Map();
export function flatWords(t) {
  if (t.kind === 'base' || t.kind === 'list') return 1;
  if (t.kind === 'maybe') return 1 + flatWords(t.elem);
  const key = typeKey(t);
  if (!widthMemo.has(key)) widthMemo.set(key, (t.type.ctors.length > 1 ? 1 : 0) +
    Math.max(0, ...t.type.ctors.map(c => c.fields.reduce((n, f) => n + flatWords(resolveType(t.module, f.type)), 0))));
  return widthMemo.get(key);
}
export const heldWords = t => t.kind !== 'adt' ? 0 : Math.max(0, ...t.type.ctors.map(c => c.fields.slice(0, -1).reduce((n, f) => n + flatWords(resolveType(t.module, f.type)), 0)));

// ---------------------------------------------------------------- emission

export function generate({ types = [], ops = [], outDir }) {
  const lookup = spec => {
    const [file, name] = spec.split(':');
    return { module: parseModule(join(kernelRoot, file)), name };
  };
  const roots = types.map(spec => { const { module, name } = lookup(spec); return adtRef(module, name, spec); });
  const opDefs = ops.map((spec, id) => {
    const { module, name } = lookup(spec);
    const def = module.defs.get(name) ?? wireError(`${spec}: no such def`);
    for (const p of def.params) if (p.mode === '-' || p.mode === '~' || !p.type) wireError(`${spec}: parameter '${p.name}' is erased or a template`);
    return { id, spec, module, def, params: def.params.map(p => ({ name: p.name, type: resolveType(module, p.type) })), result: resolveType(module, def.ret) };
  });
  const everything = [...roots, ...opDefs.flatMap(op => [...op.params.map(p => p.type), op.result])];
  const adts = closure(everything);
  const files = [...new Set([...adts.map(t => t.module.file), ...opDefs.map(op => op.module.file)])].sort();
  const alias = new Map(files.map((file, i) => [file, `K${i}`]));
  return {
    bend: emitBend({ outDir, files, alias, adts, roots, opDefs, everything }),
    js: emitJs({ adts, roots, opDefs, everything }),
    manifest: manifest({ adts, roots, opDefs, alias }),
  };
}

function containers(types) {
  const seen = new Map();
  const visit = t => {
    if (t.kind === 'list' || t.kind === 'maybe') { visit(t.elem); seen.set(typeKey(t), t); }
    if (t.kind === 'base') seen.set(t.name, t);
  };
  types.forEach(visit);
  return seen;
}

function emitBend({ outDir, files, alias, adts, roots, opDefs, everything }) {
  // Bend only destructures parameters and pattern-bound variables, so every
  // decoder is a chain of small defs that receive the previous (value, cursor)
  // pair as a parameter. Defs are emitted callee-first (no forward references).
  const bt = t => t.kind === 'base' ? t.name : t.kind === 'list' ? `List<&2, ${bt(t.elem)}>`
    : t.kind === 'maybe' ? `Maybe<&2, ${bt(t.elem)}>` : `${alias.get(t.module.file)}.${t.name}`;
  const W = 'List<&2, U32>';
  const out = [
    '# GENERATED by scripts/native-bridge/gen-wire.mjs. Do not edit.',
    'import Base',
    ...files.map(file => `import ${relative(outDir, file).replace(/^(?!\.)/, './')} as ${alias.get(file)}`),
    '',
    '# Decoder state: `ok` turns False on underflow, an invalid tag or an',
    '# impossible count and stays False; `left` is the number of words in `words`',
    '# (modulo 2^32, so never more than there are).',
    'type Cursor is Data:',
    `  Cursor{ok: Bool, left: U32, words: ${W}}`,
    '',
    `def take_words(words: ${W}, ok: Bool, left: U32) -> U32 & Cursor:`,
    '  match words:',
    '    case Nil{}:',
    '      (0, Cursor{False{}, 0, Nil{}})',
    '    case Con{h, t}:',
    '      (h, Cursor{ok, (left - 1 : U32), t})',
    '',
    'def take(c: Cursor) -> U32 & Cursor:',
    '  Cursor{ok, left, words} = c',
    '  take_words(words, ok, left)',
    '',
    'def reject(c: Cursor) -> Cursor:',
    '  Cursor{_, left, words} = c',
    '  Cursor{False{}, left, words}',
    '',
    `def count_words(words: ${W}, n: U32) -> U32:`,
    '  match words:',
    '    case Nil{}:',
    '      n',
    '    case Con{_, t}:',
    '      count_words(t, (n + 1 : U32))',
    '',
    '# The cursor every decode starts from.',
    `def start(+words: ${W}) -> Cursor:`,
    '  Cursor{True{}, count_words(words, 0), words}',
    '',
    '# A count n of elements at least w words wide fits only if n <= left / w.',
    '# An impossible count is refused before one element is decoded; after any',
    '# failure every count is 0. Decoding work and heap therefore stay in',
    '# proportion to the request length, whatever the count words claim.',
    `def count_take(fits: Bool, n: U32, left: U32, words: ${W}) -> Nat & Cursor:`,
    '  match fits:',
    '    case True{}:',
    '      (U32.to_nat(n), Cursor{True{}, left, words})',
    '    case False{}:',
    '      (0n, Cursor{False{}, left, words})',
    '',
    `def count_check(ok: Bool, +n: U32, +left: U32, words: ${W}, w: U32) -> Nat & Cursor:`,
    '  count_take(Bool.and(ok, (n <= (left / w : U32) : U32)), n, left, words)',
    '',
    'def count(p: U32 & Cursor, w: U32) -> Nat & Cursor:',
    '  (n, c) = p',
    '  Cursor{ok, left, words} = c',
    '  count_check(ok, n, left, words, w)',
    '',
    `def empty_words(words: ${W}) -> Bool:`,
    '  match words:',
    '    case Nil{}:',
    '      True{}',
    '    case Con{_, _}:',
    '      False{}',
    '',
    `def complete(ok: Bool, words: ${W}) -> Bool:`,
    '  match ok:',
    '    case True{}:',
    '      empty_words(words)',
    '    case False{}:',
    '      False{}',
    '',
    '# True when decoding consumed every word without a failure.',
    'def done(c: Cursor) -> Bool:',
    '  Cursor{ok, _, rest} = c',
    '  complete(ok, rest)',
    '',
    'def f32_of_bits(x: U32) -> F32:',
    '  U32{w} = x',
    '  F32{w}',
    '',
    `def enc_U32(x: U32, rest: ${W}) -> ${W}:`,
    '  x <> rest',
    '',
    'def dec_U32(c: Cursor) -> U32 & Cursor:',
    '  take(c)',
    '',
    `def enc_F32(x: F32, rest: ${W}) -> ${W}:`,
    '  F32.bits(x) <> rest',
    '',
    'def dec_F32_s(p: U32 & Cursor) -> F32 & Cursor:',
    '  (x, c) = p',
    '  (f32_of_bits(x), c)',
    '',
    'def dec_F32(c: Cursor) -> F32 & Cursor:',
    '  dec_F32_s(take(c))',
    '',
    `def enc_Bool(x: Bool, rest: ${W}) -> ${W}:`,
    '  Bool.to_u32(x) <> rest',
    '',
    'def bool_of_word(x: U32, c: Cursor) -> Bool & Cursor:',
    '  match x:',
    '    case 0:',
    '      (False{}, c)',
    '    case 1:',
    '      (True{}, c)',
    '    case _:',
    '      (False{}, reject(c))',
    '',
    'def dec_Bool_s(p: U32 & Cursor) -> Bool & Cursor:',
    '  (x, c) = p',
    '  bool_of_word(x, c)',
    '',
    'def dec_Bool(c: Cursor) -> Bool & Cursor:',
    '  dec_Bool_s(take(c))',
    '',
    `def enc_str_chars(s: String, rest: ${W}) -> ${W}:`,
    '  match s:',
    '    case SNil{}:',
    '      rest',
    '    case SCon{h, t}:',
    '      Chr{code} = h',
    '      code <> enc_str_chars(t, rest)',
    '',
    `def enc_String(+s: String, rest: ${W}) -> ${W}:`,
    '  U32.from_nat(String.length(s)) <> enc_str_chars(s, rest)',
    '',
    'def str_rev_onto(s: String, acc: String) -> String:',
    '  match s:',
    '    case SNil{}:',
    '      acc',
    '    case SCon{h, t}:',
    '      str_rev_onto(t, SCon{h, acc})',
    '',
    '# Chars beyond U+10FFFF have no JS string form; both sides reject them.',
    '# An invalid code is replaced by 0 while the cursor is marked failed.',
    'def cursor_if(ok: Bool, c: Cursor) -> Cursor:',
    '  match ok:',
    '    case True{}:',
    '      c',
    '    case False{}:',
    '      reject(c)',
    '',
    'def safe_char(+x: U32) -> Char:',
    '  Chr{Bool.pick(U32, (x < 1114112 : U32), x, 0)}',
    '',
    'def char_cursor(+x: U32, c: Cursor) -> Cursor:',
    '  cursor_if((x < 1114112 : U32), c)',
    '',
    '# Nat fuel n = chars still to decode after the pending word in st.',
    'def dec_str_go(n: Nat, st: U32 & Cursor, acc: String) -> String & Cursor:',
    '  match n:',
    '    case 0n:',
    '      (+x, c) = st',
    '      (str_rev_onto(SCon{safe_char(x), acc}, SNil{}), char_cursor(x, c))',
    '    case 1n+p:',
    '      (+x, c) = st',
    '      dec_str_go(p, take(char_cursor(x, c)), SCon{safe_char(x), acc})',
    '',
    'def dec_str_chars(n: Nat, c: Cursor) -> String & Cursor:',
    '  match n:',
    '    case 0n:',
    '      (SNil{}, c)',
    '    case 1n+p:',
    '      dec_str_go(p, take(c), SNil{})',
    '',
    'def dec_String_n(p: Nat & Cursor) -> String & Cursor:',
    '  (n, c) = p',
    '  dec_str_chars(n, c)',
    '',
    'def dec_String(c: Cursor) -> String & Cursor:',
    '  dec_String_n(count(take(c), 1))',
    '',
  ];
  // name(c) decodes `fields` in order, then runs finish(vars) with cursor `c`.
  const sequence = (name, fields, ret, finish) => {
    const n = fields.length, vars = k => Array.from({ length: k }, (_, i) => `x${i}`);
    const typed = k => fields.slice(0, k).map((ft, i) => `x${i}: ${bt(ft)}`);
    for (let k = n - 1; k >= 0; k--) {
      out.push(`def ${name}_s${k}(${[...typed(k), `p: ${bt(fields[k])} & Cursor`].join(', ')}) -> ${ret}:`, `  (x${k}, c) = p`);
      if (k === n - 1) out.push(...finish(vars(n)));
      else out.push(`  ${name}_s${k + 1}(${[...vars(k + 1), `dec_${typeKey(fields[k + 1])}(c)`].join(', ')})`);
      out.push('');
    }
    out.push(`def ${name}(c: Cursor) -> ${ret}:`, ...(n ? [`  ${name}_s0(dec_${typeKey(fields[0])}(c))`] : finish([])), '');
  };
  const emitted = new Set(['U32', 'F32', 'Bool', 'String']);
  const emitContainer = t => {
    const key = typeKey(t), e = typeKey(t.elem), T = bt(t), E = bt(t.elem);
    if (emitted.has(key)) return; emitted.add(key);
    if (t.kind === 'list') out.push(
      `def enc_items_${e}(xs: ${T}, rest: ${W}) -> ${W}:`,
      '  match xs:', '    case Nil{}:', '      rest', '    case Con{h, t}:', `      enc_${e}(h, enc_items_${e}(t, rest))`, '',
      `def enc_${key}(+xs: ${T}, rest: ${W}) -> ${W}:`,
      `  U32.from_nat(List.length(&2, ${E}, xs)) <> enc_items_${e}(xs, rest)`, '',
      `# Nat fuel n = elements still to decode after the pending pair st.`,
      `def dec_items_${e}_go(n: Nat, st: ${E} & Cursor, acc: ${T}) -> ${T} & Cursor:`,
      '  match n:', '    case 0n:', '      (x, c) = st', `      (List.reverse(&2, ${E}, x <> acc), c)`,
      '    case 1n+p:', '      (x, c) = st', `      dec_items_${e}_go(p, dec_${e}(c), x <> acc)`, '',
      `def dec_items_${e}(n: Nat, c: Cursor) -> ${T} & Cursor:`,
      '  match n:', '    case 0n:', '      (Nil{}, c)', '    case 1n+p:', `      dec_items_${e}_go(p, dec_${e}(c), Nil{})`, '',
      `def dec_${key}_n(p: Nat & Cursor) -> ${T} & Cursor:`,
      '  (n, c) = p', `  dec_items_${e}(n, c)`, '',
      `def dec_${key}(c: Cursor) -> ${T} & Cursor:`, `  dec_${key}_n(count(take(c), ${minWords(t.elem)}))`, '');
    else out.push(
      `def enc_${key}(x: ${T}, rest: ${W}) -> ${W}:`,
      '  match x:', '    case None{}:', '      0 <> rest', '    case Some{v}:', `      1 <> enc_${e}(v, rest)`, '',
      `def dec_${key}_some(p: ${E} & Cursor) -> ${T} & Cursor:`, '  (v, c) = p', '  (Some{v}, c)', '',
      `def dec_${key}_tag(tag: U32, c: Cursor) -> ${T} & Cursor:`,
      '  match tag:', '    case 0:', '      (None{}, c)', '    case 1:', `      dec_${key}_some(dec_${e}(c))`,
      '    case _:', '      (None{}, reject(c))', '',
      `def dec_${key}_s(p: U32 & Cursor) -> ${T} & Cursor:`, '  (tag, c) = p', `  dec_${key}_tag(tag, c)`, '',
      `def dec_${key}(c: Cursor) -> ${T} & Cursor:`, `  dec_${key}_s(take(c))`, '');
  };
  const needContainers = t => {
    if (t.kind === 'list' || t.kind === 'maybe') { needContainers(t.elem); emitContainer(t); }
  };
  for (const t of adts) {
    const key = typeKey(t), T = bt(t), A = alias.get(t.module.file), many = t.type.ctors.length > 1;
    for (const ctor of t.type.ctors) for (const field of ctor.fields) needContainers(resolveType(t.module, field.type));
    const fieldTypes = ctor => ctor.fields.map(field => resolveType(t.module, field.type));
    const chain = ctor => fieldTypes(ctor).reduceRight((rest, ft, i) => `enc_${typeKey(ft)}(x${i}, ${rest})`, 'rest');
    const pattern = (ctor, vars) => `${A}.${ctor.name}{${vars.join(', ')}}`;
    const names = ctor => ctor.fields.map((_, i) => `x${i}`);
    out.push(`# ${typeLabel(t)}`, `def enc_${key}(v: ${T}, rest: ${W}) -> ${W}:`);
    if (many) {
      out.push('  match v:');
      t.type.ctors.forEach((ctor, tag) => out.push(`    case ${pattern(ctor, names(ctor))}:`, `      ${tag} <> ${chain(ctor)}`));
    } else {
      const [ctor] = t.type.ctors;
      if (ctor.fields.length) out.push(`  ${pattern(ctor, names(ctor))} = v`);
      out.push(`  ${chain(ctor)}`);
    }
    out.push('');
    const ctorDecoder = (ctor, name) => sequence(name, fieldTypes(ctor), `${T} & Cursor`, vars => [`  (${pattern(ctor, vars)}, c)`]);
    if (many) {
      t.type.ctors.forEach((ctor, tag) => ctorDecoder(ctor, `dec_${key}_${tag}`));
      out.push(`def dec_${key}_tag(tag: U32, c: Cursor) -> ${T} & Cursor:`, '  match tag:');
      t.type.ctors.forEach((_, tag) => out.push(`    case ${tag}:`, `      dec_${key}_${tag}(c)`));
      out.push('    case _:', `      dec_${key}_0(reject(c))`, '',
        `def dec_${key}_s(p: U32 & Cursor) -> ${T} & Cursor:`, '  (tag, c) = p', `  dec_${key}_tag(tag, c)`, '',
        `def dec_${key}(c: Cursor) -> ${T} & Cursor:`, `  dec_${key}_s(take(c))`, '');
    } else ctorDecoder(t.type.ctors[0], `dec_${key}`);
  }
  for (const t of everything) needContainers(t);
  const topLevel = [...new Map(everything.map(t => [typeKey(t), t])).values()];
  for (const t of topLevel) {
    const key = typeKey(t), T = bt(t);
    out.push(`def encode_${key}(v: ${T}) -> ${W}:`, `  enc_${key}(v, Nil{})`, '',
      `def wrap_${key}(ok: Bool, v: ${T}) -> Maybe<&2, ${T}>:`, '  match ok:', '    case True{}:', '      Some{v}', '    case False{}:', '      None{}', '',
      `def decode_${key}_s(p: ${T} & Cursor) -> Maybe<&2, ${T}>:`,
      '  (v, c) = p', `  wrap_${key}(done(c), v)`, '',
      `def decode_${key}(words: ${W}) -> Maybe<&2, ${T}>:`, `  decode_${key}_s(dec_${key}(start(words)))`, '');
  }
  for (const op of opDefs) {
    const name = `op_${op.module.id}_${op.def.name}`, A = alias.get(op.module.file);
    const args = op.params.map((_, i) => `x${i}`);
    out.push(`# kernel/${relative(kernelRoot, op.module.file)}:${op.def.line} ${op.def.name}`,
      `def ${name}_run(${['ok: Bool', ...op.params.map((p, i) => `x${i}: ${bt(p.type)}`)].join(', ')}) -> ${W}:`,
      '  match ok:', '    case True{}:', `      0 <> enc_${typeKey(op.result)}(${A}.${op.def.name}(${args.join(', ')}), Nil{})`,
      '    case False{}:', '      [1]', '');
    sequence(`${name}_dec`, op.params.map(p => p.type), W, vars => [`  ${name}_run(${['done(c)', ...vars].join(', ')})`]);
    out.push(`def ${name}(words: ${W}) -> ${W}:`, `  ${name}_dec(start(words))`, '');
  }
  out.push(`def dispatch(op: U32, words: ${W}) -> ${W}:`, '  match op:');
  for (const op of opDefs) out.push(`    case ${op.id}:`, `      op_${op.module.id}_${op.def.name}(words)`);
  out.push('    case _:', '      [2]', '');
  return out.join('\n');
}

function emitJs({ adts, roots, opDefs, everything }) {
  const out = [
    '// GENERATED by scripts/native-bridge/gen-wire.mjs. Do not edit.',
    '// Exact U32 wire codecs for Bend JS-target values ({$: Ctor, ...fields},',
    '// Con/Nil lists, F32/U32 as numbers, Bool as booleans).',
    'const f32 = new Float32Array(1), bits = new Uint32Array(f32.buffer);',
    'const fail = message => { throw new RangeError(`wire: ${message}`); };',
    'const enc_U32 = (x, out) => { if (!Number.isInteger(x) || x < 0 || x > 0xffffffff) fail(`U32 expected, got ${x}`); out.push(x); };',
    'const enc_F32 = (x, out) => {',
    '  if (typeof x !== "number") fail(`F32 expected, got ${typeof x}`);',
    '  f32[0] = x;',
    '  if (!Object.is(f32[0], x)) fail(`${x} is not exactly representable as F32`);',
    '  out.push(bits[0]);',
    '};',
    'const enc_Bool = (x, out) => { if (typeof x !== "boolean") fail(`Bool expected, got ${typeof x}`); out.push(x ? 1 : 0); };',
    'const dec_U32 = r => r.take();',
    'const dec_F32 = r => { bits[0] = r.take(); return f32[0]; };',
    'const dec_Bool = r => { const x = r.take(); if (x > 1) fail(`Bool word ${x}`); return x === 1; };',
    '// One word per code point; a lone surrogate is its own code point (as [...s] yields it).',
    'const enc_String = (s, out) => {',
    '  if (typeof s !== "string") fail(`String expected, got ${typeof s}`);',
    '  const at = out.length; out.push(0); let n = 0;',
    '  for (let i = 0; i < s.length; n++) { const code = s.codePointAt(i); out.push(code); i += code > 0xffff ? 2 : 1; }',
    '  out[at] = n;',
    '};',
    'const dec_String = r => {',
    '  const n = r.take(); if (n > r.words.length - r.i) fail("string length exceeds message");',
    '  const ws = r.words, end = r.i + n; let s = "";',
    '  for (let k = r.i; k < end; k += 4096) {',
    '    const stop = Math.min(k + 4096, end);',
    '    for (let j = k; j < stop; j++) if (ws[j] > 0x10ffff) fail(`Char ${ws[j]}`);',
    '    s += String.fromCodePoint.apply(null, ws.subarray ? ws.subarray(k, stop) : ws.slice(k, stop));',
    '  }',
    '  r.i = end;',
    '  return s;',
    '};',
    'const reader = words => ({ words, i: 0, take() { if (this.i >= this.words.length) fail("truncated"); return this.words[this.i++]; } });',
    '',
  ];
  const emitted = new Set(['U32', 'F32', 'Bool', 'String']);
  const emitContainer = t => {
    const key = typeKey(t), e = typeKey(t.elem);
    if (emitted.has(key)) return; emitted.add(key);
    if (t.kind === 'list') out.push(
      `function enc_${key}(xs, out) {`,
      '  const at = out.length; out.push(0); let n = 0;',
      `  for (; xs.$ === "Con"; xs = xs.tail, n++) enc_${e}(xs.head, out);`,
      '  if (xs.$ !== "Nil") fail("malformed list");',
      '  out[at] = n;',
      '}',
      `function dec_${key}(r) {`,
      `  const n = r.take(); if (n${minWords(t.elem) > 1 ? ` * ${minWords(t.elem)}` : ''} > r.words.length - r.i) fail("list length exceeds message");`,
      `  const items = []; for (let i = 0; i < n; i++) items.push(dec_${e}(r));`,
      '  return items.reduceRight((tail, head) => ({ $: "Con", head, tail }), { $: "Nil" });',
      '}');
    else out.push(
      `function enc_${key}(x, out) { if (x.$ === "None") out.push(0); else if (x.$ === "Some") { out.push(1); enc_${e}(x.value, out); } else fail("malformed Maybe"); }`,
      `function dec_${key}(r) { const tag = r.take(); if (tag === 0) return { $: "None" }; if (tag === 1) return { $: "Some", value: dec_${e}(r) }; return fail(\`Maybe tag \${tag}\`); }`);
  };
  const needContainers = t => { if (t.kind === 'list' || t.kind === 'maybe') { needContainers(t.elem); emitContainer(t); } };
  for (const t of adts) {
    const key = typeKey(t), many = t.type.ctors.length > 1;
    for (const ctor of t.type.ctors) for (const field of ctor.fields) needContainers(resolveType(t.module, field.type));
    const encFields = (ctor, indent) => ctor.fields.map(field => `${indent}enc_${typeKey(resolveType(t.module, field.type))}(v.${field.name}, out);`);
    const literal = ctor => `{ $: ${JSON.stringify(ctor.name)}${ctor.fields.map(field => `, ${field.name}: dec_${typeKey(resolveType(t.module, field.type))}(r)`).join('')} }`;
    out.push(`// ${typeLabel(t)}`, `function enc_${key}(v, out) {`);
    if (many) {
      out.push('  switch (v?.$) {');
      t.type.ctors.forEach((ctor, tag) => out.push(`    case ${JSON.stringify(ctor.name)}: out.push(${tag});`, ...encFields(ctor, '      '), '      return;'));
      out.push(`    default: fail(\`${typeLabel(t)} constructor \${v?.$}\`);`, '  }');
    } else {
      out.push(`  if (v?.$ !== ${JSON.stringify(t.type.ctors[0].name)}) fail(\`${typeLabel(t)} constructor \${v?.$}\`);`, ...encFields(t.type.ctors[0], '  '));
    }
    out.push('}', `function dec_${key}(r) {`);
    if (many) {
      out.push('  const tag = r.take();', '  switch (tag) {');
      t.type.ctors.forEach((ctor, tag) => out.push(`    case ${tag}: return ${literal(ctor)};`));
      out.push(`    default: return fail(\`${typeLabel(t)} tag \${tag}\`);`, '  }');
    } else out.push(`  return ${literal(t.type.ctors[0])};`);
    out.push('}', '');
  }
  for (const t of everything) needContainers(t);
  const topLevel = [...new Map(everything.map(t => [typeKey(t), t])).values()];
  out.push('export const codecs = {');
  for (const t of topLevel) out.push(`  ${JSON.stringify(typeLabel(t))}: { key: ${JSON.stringify(typeKey(t))},`,
    `    encode(value) { const out = []; enc_${typeKey(t)}(value, out); return Uint32Array.from(out); },`,
    `    decode(words) { const r = reader(words), value = dec_${typeKey(t)}(r); if (r.i !== words.length) fail("trailing words"); return value; },`,
    '  },');
  out.push('};', '', 'export const ops = [');
  for (const op of opDefs) out.push(`  { id: ${op.id}, name: ${JSON.stringify(`${relative(kernelRoot, op.module.file)}:${op.def.name}`)}, params: ${JSON.stringify(op.params.map(p => typeLabel(p.type)))}, result: ${JSON.stringify(typeLabel(op.result))},`,
    `    encode(args) { if (args.length !== ${op.params.length}) fail("arity"); const out = []; ${op.params.map((p, i) => `enc_${typeKey(p.type)}(args[${i}], out);`).join(' ')} return Uint32Array.from(out); },`,
    `    decode(words) { const r = reader(words), status = r.take(); if (status !== 0) fail(\`op status \${status}\`); const value = dec_${typeKey(op.result)}(r); if (r.i !== words.length) fail("trailing words"); return value; } },`);
  out.push('];', '');
  return out.join('\n');
}

function manifest({ adts, roots, opDefs, alias }) {
  const describe = t => ({
    type: typeLabel(t), key: typeKey(t), source: `kernel/${relative(kernelRoot, t.module.file)}:${t.type.line}`,
    fixedWords: fixedWords(t), minWords: minWords(t), flatWordsEstimate: flatWords(t), heldWordsEstimate: heldWords(t), tagged: t.type.ctors.length > 1,
    constructors: t.type.ctors.map((ctor, tag) => ({ tag, name: ctor.name,
      fields: ctor.fields.map(field => ({ name: field.name, type: typeLabel(resolveType(t.module, field.type)) })) })),
  });
  return {
    schema: 'wonky-native-wire/0', generator: 'scripts/native-bridge/gen-wire.mjs',
    roots: roots.map(typeLabel), adts: adts.map(describe),
    nativeWidthWarnings: adts.filter(t => heldWords(t) > 255).map(t => `${typeLabel(t)}: encoder holds ~${heldWords(t)} words across a non-tail call; Bend's C emitter will likely refuse it ("an arity over 255")`),
    ops: opDefs.map(op => ({ id: op.id, def: `kernel/${relative(kernelRoot, op.module.file)}:${op.def.line}`, name: op.def.name,
      params: op.params.map(p => ({ name: p.name, type: typeLabel(p.type) })), result: typeLabel(op.result) })),
    aliases: Object.fromEntries([...alias].map(([file, a]) => [a, `kernel/${relative(kernelRoot, file)}`])),
  };
}

export function writeGenerated({ types, ops, outDir }) {
  const dir = resolve(outDir);
  mkdirSync(dir, { recursive: true });
  const { bend, js, manifest: m } = generate({ types, ops, outDir: dir });
  writeFileSync(join(dir, 'wire.bend'), bend);
  writeFileSync(join(dir, 'wire.mjs'), js);
  writeFileSync(join(dir, 'wire.json'), JSON.stringify(m, null, 2) + '\n');
  return { dir, manifest: m, bendLines: bend.split('\n').length, jsLines: js.split('\n').length };
}

// Codability of every type and def signature in kernel/*.bend and
// kernel/ports/*.bend (kernel/proto and kernel/service are not kernel sources).
export function survey() {
  const files = [kernelRoot, join(kernelRoot, 'ports')].flatMap(dir => readdirSync(dir).filter(f => f.endsWith('.bend')).sort().map(f => join(dir, f)));
  const result = { schema: 'wonky-native-wire-survey/1', generator: 'scripts/native-bridge/gen-wire.mjs', files: files.length,
    types: { total: 0, codable: 0, refused: [] }, defs: { total: 0, codable: 0, refusedBy: {} } };
  const reason = error => error.message.replace(/^[^:]*: /, '').replace(/ has no wire encoding.*$/, ' has no wire encoding');
  for (const file of files) {
    const module = parseModule(file);
    for (const [name, type] of module.types) {
      result.types.total++;
      try { closure([adtRef(module, name, name)]); result.types.codable++; }
      catch (error) { if (!(error instanceof WireError)) throw error; result.types.refused.push({ type: `kernel/${relative(kernelRoot, file)}:${name}`, line: type.line, reason: reason(error) }); }
    }
    for (const def of module.defs.values()) {
      result.defs.total++;
      try {
        for (const p of def.params) if (p.mode === '-' || p.mode === '~' || !p.type) wireError(`parameter '${p.name}' is erased or a template`);
        closure([...def.params.map(p => resolveType(module, p.type)), resolveType(module, def.ret)]);
        result.defs.codable++;
      } catch (error) {
        if (!(error instanceof WireError)) throw error;
        const key = reason(error);
        (result.defs.refusedBy[key] ??= []).push(`kernel/${relative(kernelRoot, file)}:${def.line} ${def.name}`);
      }
    }
  }
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), types = [], ops = [];
  let outDir = join(projectRoot, 'tmp/native-bridge/surface/gen');
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--type') types.push(args[++i]);
    else if (args[i] === '--op') ops.push(args[++i]);
    else if (args[i] === '--out') outDir = args[++i];
    else if (args[i] === '--survey') {
      const file = resolve(args[++i]), data = survey();
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(data, null, 1) + '\n');
      console.log(JSON.stringify({ survey: relative(projectRoot, file), types: `${data.types.codable}/${data.types.total}`, defs: `${data.defs.codable}/${data.defs.total}` }));
      process.exit(0);
    }
    else throw new Error(`Unknown argument ${args[i]}`);
  }
  const result = writeGenerated({ types, ops, outDir });
  console.log(JSON.stringify({ dir: result.dir, adts: result.manifest.adts.length, ops: result.manifest.ops.length, bendLines: result.bendLines, jsLines: result.jsLines }));
}
