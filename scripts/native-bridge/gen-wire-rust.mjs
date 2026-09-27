#!/usr/bin/env node
// The Rust side of the kernel wire (docs/rust-migration.md 3.3, package W0).
// From the same `type`/`def` declarations in kernel/**/*.bend that gen-wire.mjs
// reads for the Bend native build (and with its parser), it writes
//
//   rust/wonky-wire/src/generated.rs  Rust value types, v1 and v2 codecs, the op
//                                      table, the `Kernel` trait (one method per
//                                      op, default: unavailable) and dispatch
//   src/native/rust-wire.mjs           JS v1 and v2 codecs for the same ops
//
// Both are generated; edit this script, never its output. The op set is every
// production entry of src/native/surface.json, in its order (op id = index).
//
//   node scripts/native-bridge/gen-wire-rust.mjs            write both files
//   node scripts/native-bridge/gen-wire-rust.mjs --check    write nothing; exit 1 when either differs
//
// The plan (docs/rust-migration.md W0) names this `gen-wire.mjs --rust`. It is a
// separate entry point because scripts/native-bridge/gen-wire.mjs is a hashed
// input of the Bend native build key (src/native/build-key.mjs BUILD_INPUTS):
// any edit to it makes every cached Bend native build stale.
//
// Wire v1 is exactly the Bend native wire of gen-wire.mjs (F32 = 1 word, Real =
// its two F32 words hi, lo). It exists to replay Bend's captured requests: both
// kernels see the same words. Wire v2 is the production wire of
// WONKY_BACKEND=rust: every F32 field and every Real is one IEEE binary64 in two
// words, low 32 bits first; tags, counts, U32, Bool, String, List and Maybe are
// as in v1. JS decodes a v2 Real to { $: 'Real', hi: value, lo: 0 }; a Real
// {hi, lo} encodes in v2 only when hi + lo is exact in binary64 (lo = 0 keeps
// the sign of hi, so -0 survives). NaN and +-Inf never cross: every Rust
// decoder answers status 3 for them, the JS v2 codec throws.
//
// Reply statuses (first reply word): 0 ok (result follows), 1 malformed request
// (truncated, count larger than the message, bad tag, Bool > 1, Char >
// 0x10FFFF, trailing words), 2 unknown op, 3 invalid value (NaN or +-Inf), 5
// kernel fault (a panic caught at the addon boundary, or a result that does not
// encode), 6 unavailable (the entry is not ported to Rust). Every nonzero
// status is followed by one diagnostic String (count, code points).
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WireError, closure, kernelRoot, parseModule, projectRoot, resolveType, typeKey, typeLabel } from './gen-wire.mjs';

export const RUST_GENERATED = 'rust/wonky-wire/src/generated.rs';
export const JS_GENERATED = 'src/native/rust-wire.mjs';
export const WIRE_FORMAT = 'wonky-wire-rust/1';
export const API_VERSION = 1;
const SURFACE_FILE = 'src/native/surface.json';

const fail = message => { throw new WireError(message); };
const isReal = t => t.kind === 'adt' && t.module.id === 'real' && t.name === 'Real';

// ---------------------------------------------------------------- op set

// Every production entry of src/native/surface.json with its loadKernel()
// placement (scripts/native-bridge/slice-ops.mjs), in surface order.
export async function productionOps() {
  const { surfaceTable } = await import('./slice-ops.mjs');
  const surface = JSON.parse(readFileSync(join(projectRoot, SURFACE_FILE), 'utf8'));
  const places = new Map(surfaceTable().map(e => [e.entry, e]));
  return surface.entries.filter(e => e.production).map((e, id) => {
    const place = places.get(e.entry) ?? fail(`${e.entry}: no placement in the surface table`);
    const spec = e.entry.replace(/^kernel\//, '');
    return { id, spec, entry: e.entry, scope: place.scope, namespace: place.namespace ?? null, key: place.key ?? null,
      label: place.namespace ? `${place.namespace}.${place.key}` : place.key ?? null };
  });
}

// ---------------------------------------------------------------- model

export function model(table) {
  const opDefs = table.map(op => {
    const [file, name] = op.spec.split(':');
    const module = parseModule(join(kernelRoot, file));
    const def = module.defs.get(name) ?? fail(`${op.spec}: no such def`);
    for (const p of def.params) if (p.mode === '-' || p.mode === '~' || !p.type) fail(`${op.spec}: parameter '${p.name}' is erased or a template`);
    return { ...op, module, def, params: def.params.map(p => ({ name: p.name, type: resolveType(module, p.type) })), result: resolveType(module, def.ret) };
  });
  const everything = opDefs.flatMap(op => [...op.params.map(p => p.type), op.result]);
  const adts = closure(everything);
  const real = adts.find(isReal);
  if (real) {
    const [ctor] = real.type.ctors;
    if (real.type.ctors.length !== 1 || ctor.fields.map(f => `${f.name}:${f.type}`).join(',') !== 'hi:F32,lo:F32') fail('kernel/real.bend:Real is no longer Real{hi: F32, lo: F32}; the v2 Real rule must be re-derived');
  }
  return { opDefs, adts, everything };
}

// Fewest words a value occupies in wire version v (1 or 2).
const minMemo = new Map();
export function minWordsV(t, v) {
  if (t.kind === 'base') return t.name === 'F32' ? (v === 2 ? 2 : 1) : 1;
  if (t.kind === 'list' || t.kind === 'maybe') return 1;
  if (isReal(t)) return 2;
  const key = `${typeKey(t)}@${v}`;
  if (!minMemo.has(key)) minMemo.set(key, (t.type.ctors.length > 1 ? 1 : 0) +
    Math.min(...t.type.ctors.map(c => c.fields.reduce((n, f) => n + minWordsV(resolveType(t.module, f.type), v), 0))));
  return minMemo.get(key);
}

const fieldTypes = (t, ctor) => ctor.fields.map(f => ({ name: f.name, type: resolveType(t.module, f.type) }));

// Layout description: the wire hash input, and the type map JS tests draw values from.
const describe = t => t.kind === 'base' ? { kind: 'base', name: t.name } : t.kind === 'list' ? { kind: 'list', elem: describe(t.elem) }
  : t.kind === 'maybe' ? { kind: 'maybe', elem: describe(t.elem) } : isReal(t) ? { kind: 'real' } : { kind: 'adt', key: typeKey(t) };
export function layout({ opDefs, adts }) {
  return {
    format: WIRE_FORMAT,
    adts: Object.fromEntries(adts.filter(t => !isReal(t)).map(t => [typeKey(t), { label: typeLabel(t),
      ctors: t.type.ctors.map(ctor => ({ name: ctor.name, fields: fieldTypes(t, ctor).map(f => ({ name: f.name, type: describe(f.type) })) })) }])),
    ops: opDefs.map(op => ({ entry: op.entry, params: op.params.map(p => ({ name: p.name, type: describe(p.type) })), result: describe(op.result) })),
  };
}
export const wireHash = l => createHash('sha256').update(JSON.stringify(l)).digest('hex');

// ---------------------------------------------------------------- Rust

const RUST_KEYWORDS = new Set(['as', 'break', 'const', 'continue', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop',
  'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'static', 'struct', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while', 'async', 'await',
  'dyn', 'abstract', 'become', 'box', 'do', 'final', 'macro', 'override', 'priv', 'typeof', 'unsized', 'virtual', 'yield', 'try', 'gen']);
const NOT_RAW = new Set(['crate', 'self', 'Self', 'super', '_']);
export const rustIdent = name => {
  if (!/^[A-Za-z_]\w*$/.test(name)) fail(`'${name}' is not a Rust identifier`);
  return NOT_RAW.has(name) ? `${name}_` : RUST_KEYWORDS.has(name) ? `r#${name}` : name;
};
const rustType = t => t.kind === 'base' ? { U32: 'u32', F32: 'f64', Bool: 'bool', String: 'Text' }[t.name]
  : t.kind === 'list' ? `Vec<${rustType(t.elem)}>` : t.kind === 'maybe' ? `Option<${rustType(t.elem)}>` : isReal(t) ? 'Real' : typeKey(t);
export const rustMethod = op => `${op.module.id}__${op.def.name.replace(/[^A-Za-z0-9]/g, '_')}`;
const source = t => `kernel/${relative(kernelRoot, t.module.file)}:${t.type.line}`;
const lit = s => JSON.stringify(s);

export function emitRust({ opDefs, adts }, hash) {
  const out = [
    '// GENERATED by scripts/native-bridge/gen-wire-rust.mjs. Do not edit.',
    '// Value types, wire v1/v2 codecs, op table, Kernel trait and dispatch for the',
    '// production entries of src/native/surface.json. Wire rules: gen-wire-rust.mjs.',
    '#![allow(non_camel_case_types, non_snake_case, unused_variables, clippy::all)]',
    'use crate::{CallError, OpError, Reader, Real, Text, Version, Wire, WireError};',
    '',
    `pub const WIRE_HASH: &str = ${lit(hash)};`,
    `pub const WIRE_FORMAT: &str = ${lit(WIRE_FORMAT)};`,
    '',
  ];
  const mw = t => `match v { Version::V1 => ${minWordsV(t, 1)}, Version::V2 => ${minWordsV(t, 2)} }`;
  for (const t of adts) {
    if (isReal(t)) continue;
    const key = typeKey(t), many = t.type.ctors.length > 1;
    out.push(`/// ${source(t)} ${t.name}`, '#[derive(Clone, Debug, PartialEq)]');
    const fieldDecl = (t, ctor) => fieldTypes(t, ctor).map(f => `${rustIdent(f.name)}: ${rustType(f.type)}`);
    if (many) {
      out.push(`pub enum ${key} {`);
      for (const ctor of t.type.ctors) out.push(`    ${rustIdent(ctor.name)} { ${fieldDecl(t, ctor).join(', ')} },`);
      out.push('}');
    } else {
      const [ctor] = t.type.ctors;
      out.push(`pub struct ${key} {`, ...fieldDecl(t, ctor).map(f => `    pub ${f},`), '}');
    }
    const names = ctor => fieldTypes(t, ctor).map(f => rustIdent(f.name));
    const decFields = ctor => names(ctor).map(n => `${n}: Wire::dec(v, r)?`).join(', ');
    out.push(`impl Wire for ${key} {`, `    fn min_words(v: Version) -> u64 { ${mw(t)} }`,
      '    fn enc(&self, v: Version, out: &mut Vec<u32>) -> Result<(), WireError> {');
    if (many) {
      out.push('        match self {');
      t.type.ctors.forEach((ctor, tag) => {
        const ns = names(ctor);
        out.push(`            Self::${rustIdent(ctor.name)} { ${ns.join(', ')} } => {`, `                out.push(${tag});`,
          ...ns.map(n => `                ${n}.enc(v, out)?;`), '            }');
      });
      out.push('        }');
    } else {
      out.push(...names(t.type.ctors[0]).map(n => `        self.${n}.enc(v, out)?;`));
      if (!t.type.ctors[0].fields.length) out.push('        let _ = (v, out);');
    }
    out.push('        Ok(())', '    }', '    fn dec(v: Version, r: &mut Reader) -> Result<Self, WireError> {');
    if (many) {
      out.push('        Ok(match r.take()? {');
      t.type.ctors.forEach((ctor, tag) => out.push(`            ${tag} => Self::${rustIdent(ctor.name)} { ${decFields(ctor)} },`));
      out.push(`            tag => return Err(WireError::Malformed(format!("${typeLabel(t)} tag {tag}"))),`, '        })');
    } else {
      if (!t.type.ctors[0].fields.length) out.push('        let _ = (v, r);');
      out.push(`        Ok(Self { ${decFields(t.type.ctors[0])} })`);
    }
    out.push('    }', '}', '');
  }
  // op table
  out.push('pub struct OpInfo { pub id: u32, pub entry: &\'static str }', '', 'pub const OPS: &[OpInfo] = &[');
  for (const op of opDefs) out.push(`    OpInfo { id: ${op.id}, entry: ${lit(op.entry)} },`);
  out.push('];', '');
  // Kernel trait
  const params = op => op.params.map((p, i) => ({ name: `${rustIdent(p.name)}`, type: rustType(p.type), i }));
  out.push('/// One method per op. Every default answers OpError::Unavailable (status 6):',
    '/// a port overrides exactly the methods it implements.', 'pub trait Kernel {');
  for (const op of opDefs) {
    const ps = params(op);
    out.push(`    /// ${op.entry} (kernel/${relative(kernelRoot, op.module.file)}:${op.def.line})`,
      `    fn ${rustMethod(op)}(&self${ps.map(p => `, ${p.name}: ${p.type}`).join('')}) -> Result<${rustType(op.result)}, OpError> {`,
      `        let _ = (${ps.map(p => `${p.name}, `).join('')});`, '        Err(OpError::Unavailable)', '    }');
  }
  out.push('}', '');
  // dispatch, args and result round trips
  const decArgs = op => op.params.map((p, i) => `            let a${i}: ${rustType(p.type)} = Wire::dec(v, &mut r)?;`);
  out.push('/// Decodes the request of `op`, runs it on `kernel`, encodes the result (status 0 first).',
    'pub fn dispatch<K: Kernel + ?Sized>(kernel: &K, v: Version, op: u32, words: &[u32]) -> Result<Vec<u32>, CallError> {',
    '    let mut r = Reader::new(words);', '    match op {');
  for (const op of opDefs) {
    out.push(`        ${op.id} => {`, ...decArgs(op), '            r.finish()?;',
      `            let value = kernel.${rustMethod(op)}(${op.params.map((_, i) => `a${i}`).join(', ')})?;`,
      '            crate::ok_reply(v, &value)', '        }');
  }
  out.push('        _ => Err(CallError::UnknownOp(op)),', '    }', '}', '');
  out.push('/// Decodes the arguments of `op` and encodes them again (wire conformance).',
    'pub fn roundtrip_args(v: Version, op: u32, words: &[u32]) -> Result<Vec<u32>, CallError> {',
    '    let mut r = Reader::new(words);', '    let mut out = Vec::with_capacity(words.len());', '    match op {');
  for (const op of opDefs) {
    out.push(`        ${op.id} => {`, ...decArgs(op), '            r.finish()?;',
      ...op.params.map((_, i) => `            a${i}.enc(v, &mut out).map_err(CallError::Reply)?;`), '        }');
  }
  out.push('        _ => return Err(CallError::UnknownOp(op)),', '    }', '    Ok(out)', '}', '');
  out.push('/// Decodes `words` as the result type of `op` and encodes it again (wire conformance).',
    'pub fn roundtrip_result(v: Version, op: u32, words: &[u32]) -> Result<Vec<u32>, CallError> {',
    '    let mut r = Reader::new(words);', '    let mut out = Vec::with_capacity(words.len());', '    match op {');
  for (const op of opDefs) {
    out.push(`        ${op.id} => {`, `            let value: ${rustType(op.result)} = Wire::dec(v, &mut r)?;`, '            r.finish()?;',
      '            value.enc(v, &mut out).map_err(CallError::Reply)?;', '        }');
  }
  out.push('        _ => return Err(CallError::UnknownOp(op)),', '    }', '    Ok(out)', '}', '');
  return out.join('\n');
}

// ---------------------------------------------------------------- JS

export function emitJs({ opDefs, adts, everything }, hash, table, l) {
  const out = [
    '// GENERATED by scripts/native-bridge/gen-wire-rust.mjs. Do not edit.',
    '// Wire v1 (the Bend native wire: F32 1 word, Real = its F32 words) and wire v2',
    '// (F32 and Real = binary64 in two words, low word first) codecs for the',
    '// production entries of src/native/surface.json, as the Rust kernel reads them.',
    'import { endianness } from "node:os";',
    'if (endianness() !== "LE") throw new Error("wire: the typed-array codecs assume a little-endian host");',
    `export const WIRE_HASH = ${lit(hash)};`,
    `export const WIRE_FORMAT = ${lit(WIRE_FORMAT)};`,
    `export const API_VERSION = ${API_VERSION};`,
    'const f32 = new Float32Array(1), bits32 = new Uint32Array(f32.buffer);',
    'const f64 = new Float64Array(1), bits64 = new Uint32Array(f64.buffer);',
    'const fail = message => { throw new RangeError(`wire: ${message}`); };',
    'const reader = words => ({ words, i: 0, take() { if (this.i >= this.words.length) fail("truncated"); return this.words[this.i++]; } });',
    '// v1: exactly the Bend native codec (scripts/native-bridge/gen-wire.mjs emitJs).',
    'const enc_U32 = (x, out) => { if (!Number.isInteger(x) || x < 0 || x > 0xffffffff) fail(`U32 expected, got ${x}`); out.push(x); };',
    'const dec_U32 = r => r.take();',
    'const enc_Bool = (x, out) => { if (typeof x !== "boolean") fail(`Bool expected, got ${typeof x}`); out.push(x ? 1 : 0); };',
    'const dec_Bool = r => { const x = r.take(); if (x > 1) fail(`Bool word ${x}`); return x === 1; };',
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
    'const enc_U32_1 = enc_U32, dec_U32_1 = dec_U32, enc_Bool_1 = enc_Bool, dec_Bool_1 = dec_Bool, enc_String_1 = enc_String, dec_String_1 = dec_String;',
    'const enc_U32_2 = enc_U32, dec_U32_2 = dec_U32, enc_Bool_2 = enc_Bool, dec_Bool_2 = dec_Bool, enc_String_2 = enc_String, dec_String_2 = dec_String;',
    'const enc_F32_1 = (x, out) => {',
    '  if (typeof x !== "number") fail(`F32 expected, got ${typeof x}`);',
    '  f32[0] = x;',
    '  if (!Object.is(f32[0], x)) fail(`${x} is not exactly representable as F32`);',
    '  out.push(bits32[0]);',
    '};',
    'const dec_F32_1 = r => { bits32[0] = r.take(); return f32[0]; };',
    '// v2: binary64, low word first. NaN and +-Inf are refused both ways.',
    'const enc_F32_2 = (x, out) => {',
    '  if (typeof x !== "number") fail(`binary64 expected, got ${typeof x}`);',
    '  if (!Number.isFinite(x)) fail(`${x} does not cross the wire`);',
    '  f64[0] = x; out.push(bits64[0], bits64[1]);',
    '};',
    'const dec_F32_2 = r => { const lo = r.take(), hi = r.take(); bits64[0] = lo; bits64[1] = hi; const x = f64[0]; if (!Number.isFinite(x)) fail(`${x} does not cross the wire`); return x; };',
    '// A v2 Real is the exact binary64 sum hi + lo (lo = 0 keeps the sign of hi).',
    'const enc_real_Real_2 = (v, out) => {',
    '  if (v?.$ !== "Real") fail(`real.bend:Real constructor ${v?.$}`);',
    '  const { hi, lo } = v;',
    '  if (typeof hi !== "number" || typeof lo !== "number") fail("Real parts must be numbers");',
    '  let s = hi;',
    '  if (lo !== 0) {',
    '    s = hi + lo;',
    '    const b = s - hi, e = (hi - (s - b)) + (lo - b);',
    '    if (e !== 0) fail(`Real ${hi} + ${lo} is not exact in binary64`);',
    '  }',
    '  enc_F32_2(s, out);',
    '};',
    'const dec_real_Real_2 = r => ({ $: "Real", hi: dec_F32_2(r), lo: 0 });',
    '',
  ];
  for (const v of [1, 2]) {
    const emitted = new Set();
    const emitContainer = t => {
      const key = typeKey(t), e = typeKey(t.elem);
      if (emitted.has(key)) return; emitted.add(key);
      if (t.kind === 'list') {
        const w = minWordsV(t.elem, v);
        out.push(
          `function enc_${key}_${v}(xs, out) {`,
          '  const at = out.length; out.push(0); let n = 0;',
          `  for (; xs.$ === "Con"; xs = xs.tail, n++) enc_${e}_${v}(xs.head, out);`,
          '  if (xs.$ !== "Nil") fail("malformed list");',
          '  out[at] = n;',
          '}',
          `function dec_${key}_${v}(r) {`,
          `  const n = r.take(); if (n${w > 1 ? ` * ${w}` : ''} > r.words.length - r.i) fail("list length exceeds message");`,
          `  const items = []; for (let i = 0; i < n; i++) items.push(dec_${e}_${v}(r));`,
          '  return items.reduceRight((tail, head) => ({ $: "Con", head, tail }), { $: "Nil" });',
          '}');
      } else out.push(
        `function enc_${key}_${v}(x, out) { if (x.$ === "None") out.push(0); else if (x.$ === "Some") { out.push(1); enc_${e}_${v}(x.value, out); } else fail("malformed Maybe"); }`,
        `function dec_${key}_${v}(r) { const tag = r.take(); if (tag === 0) return { $: "None" }; if (tag === 1) return { $: "Some", value: dec_${e}_${v}(r) }; return fail(\`Maybe tag \${tag}\`); }`);
    };
    const needContainers = t => { if (t.kind === 'list' || t.kind === 'maybe') { needContainers(t.elem); emitContainer(t); } };
    for (const t of adts) {
      if (v === 2 && isReal(t)) continue;
      const key = typeKey(t), many = t.type.ctors.length > 1;
      for (const ctor of t.type.ctors) for (const field of ctor.fields) needContainers(resolveType(t.module, field.type));
      const encFields = (ctor, indent) => ctor.fields.map(field => `${indent}enc_${typeKey(resolveType(t.module, field.type))}_${v}(v.${field.name}, out);`);
      const literal = ctor => `{ $: ${lit(ctor.name)}${ctor.fields.map(field => `, ${field.name}: dec_${typeKey(resolveType(t.module, field.type))}_${v}(r)`).join('')} }`;
      out.push(`// ${typeLabel(t)} (v${v})`, `function enc_${key}_${v}(v, out) {`);
      if (many) {
        out.push('  switch (v?.$) {');
        t.type.ctors.forEach((ctor, tag) => out.push(`    case ${lit(ctor.name)}: out.push(${tag});`, ...encFields(ctor, '      '), '      return;'));
        out.push(`    default: fail(\`${typeLabel(t)} constructor \${v?.$}\`);`, '  }');
      } else out.push(`  if (v?.$ !== ${lit(t.type.ctors[0].name)}) fail(\`${typeLabel(t)} constructor \${v?.$}\`);`, ...encFields(t.type.ctors[0], '  '));
      out.push('}', `function dec_${key}_${v}(r) {`);
      if (many) {
        out.push('  const tag = r.take();', '  switch (tag) {');
        t.type.ctors.forEach((ctor, tag) => out.push(`    case ${tag}: return ${literal(ctor)};`));
        out.push(`    default: return fail(\`${typeLabel(t)} tag \${tag}\`);`, '  }');
      } else out.push(`  return ${literal(t.type.ctors[0])};`);
      out.push('}', '');
    }
    everything.forEach(needContainers);
  }
  out.push('const codec = (encodeArgs, decodeArgs, encodeResult, decodeResult) => ({',
    '  encode(args) { const out = []; encodeArgs(args, out); return Uint32Array.from(out); },',
    '  decodeArgs(words) { const r = reader(words), args = decodeArgs(r); if (r.i !== words.length) fail("trailing words"); return args; },',
    '  encodeResult(value) { const out = []; encodeResult(value, out); return Uint32Array.from(out); },',
    '  decodeResult(words) { const r = reader(words), value = decodeResult(r); if (r.i !== words.length) fail("trailing words"); return value; },',
    '  decode(reply) { if (reply.length === 0 || reply[0] !== 0) fail(`op status ${reply[0]}`); return this.decodeResult(reply.subarray(1)); },',
    '});', '');
  out.push('export const ops = [');
  for (const op of opDefs) {
    const place = table[op.id];
    const versions = [1, 2].map(v => {
      const k = t => `${typeKey(t)}_${v}`;
      return `codec((args, out) => { if (args.length !== ${op.params.length}) fail("arity"); ${op.params.map((p, i) => `enc_${k(p.type)}(args[${i}], out);`).join(' ')} }, ` +
        `r => [${op.params.map(p => `dec_${k(p.type)}(r)`).join(', ')}], (value, out) => enc_${k(op.result)}(value, out), r => dec_${k(op.result)}(r))`;
    });
    out.push(`  { id: ${op.id}, entry: ${lit(op.entry)}, spec: ${lit(op.spec)}, scope: ${lit(place.scope)}, namespace: ${lit(place.namespace)}, key: ${lit(place.key)}, label: ${lit(place.label)},`,
      `    params: ${lit(op.params.map(p => typeLabel(p.type)))}, result: ${lit(typeLabel(op.result))},`,
      `    v1: ${versions[0]},`, `    v2: ${versions[1]} },`);
  }
  out.push('];', '', '// Type map of every op (the wire hash input).', `export const layout = ${JSON.stringify(l)};`, '');
  return out.join('\n');
}

// ---------------------------------------------------------------- entry

export async function generateRust({ table } = {}) {
  table ??= await productionOps();
  const m = model(table);
  const l = layout(m);
  const hash = wireHash(l);
  return { hash, ops: table.length, adts: m.adts.length, rust: emitRust(m, hash), js: emitJs(m, hash, table, l) };
}

export async function rustCli(args) {
  const unknown = args.filter(a => a !== '--check');
  if (unknown.length) throw new Error(`gen-wire-rust.mjs: unknown argument ${unknown[0]}`);
  const check = args.includes('--check');
  if (!existsSync(join(projectRoot, 'kernel/vendor/bend-collections/src')) || !existsSync(join(projectRoot, 'kernel/ports/occt.bend'))) {
    if (!check) throw new Error('Bend toolchain: retired sources unavailable; committed wire codecs remain authoritative');
    const freeze = JSON.parse(readFileSync(join(projectRoot, 'src/native/rust-wire-provenance.json'), 'utf8'));
    const files = [RUST_GENERATED, JS_GENERATED];
    const stale = files.filter(path => {
      try { return createHash('sha256').update(readFileSync(join(projectRoot, path))).digest('hex') !== freeze.files[path]; }
      catch { return true; }
    });
    console.log(JSON.stringify({ mode: 'public-frozen-codecs', stale }));
    process.exitCode = stale.length ? 1 : 0;
    return;
  }
  const result = await generateRust();
  const files = [[RUST_GENERATED, result.rust], [JS_GENERATED, result.js]];
  const stale = files.filter(([path, text]) => { try { return readFileSync(join(projectRoot, path), 'utf8') !== text; } catch { return true; } }).map(([path]) => path);
  if (!check) for (const [path, text] of files) { mkdirSync(dirname(join(projectRoot, path)), { recursive: true }); writeFileSync(join(projectRoot, path), text); }
  console.log(JSON.stringify({ wireHash: result.hash, ops: result.ops, adts: result.adts, files: files.map(([path, text]) => ({ path, lines: text.split('\n').length })), ...(check ? { stale } : {}) }));
  process.exitCode = check && stale.length ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await rustCli(process.argv.slice(2));
