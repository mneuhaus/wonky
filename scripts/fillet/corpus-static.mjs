// Static fillet/chamfer census over Marc's CAD corpus (read only).
//
// Population: out/corpus/targets.json `files` = unique modeling files (SHA-256 dedup)
// with their design family (union-find over Jaccard >= 0.6 of token 5-shingles; the
// same families as docs/language/corpus.md and docs/corpus-triage.md).
//
// Per call site of
//   FS: opFillet opChamfer fFillet fChamfer opVariableFillet opFullRoundFillet
//   py: fillet( chamfer( (build123d free function; method form .fillet/.chamfer too)
// it records: op, reachability (FS: call graph from defineFeature bodies; py: the
// enclosing def is referenced outside itself, is a test_* function, or module level),
// size expression and its resolved value(s) in mm through helper parameters and
// constants, the edge-selection class (regex over the selecting code, hand-checked,
// see docs/fillet/corpus.md), loop/try context and 2D-vs-3D (vertex fillets of
// sketches are 2D profile rounding, not edge blends).
//
// Usage: node scripts/fillet/corpus-static.mjs  -> tmp/fillet/static.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const REPO = new URL('../..', import.meta.url).pathname;
const targets = JSON.parse(readFileSync(join(REPO, 'out/corpus/targets.json'), 'utf8'));
const ROOT = targets.corpusRoot;

// ------------------------------------------------------------------ lexing helpers
// Returns { code, masked }: code = comments blanked; masked = comments and string
// contents blanked (quotes kept). Offsets and line numbers are preserved.
function lex(src, lang) {
  let code = '', masked = '', i = 0;
  const push = (c, m = c) => { code += c; masked += m; };
  while (i < src.length) {
    const c = src[i];
    if (lang === 'fs' && src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') { push(' '); i++; } continue; }
    if (lang === 'fs' && src.startsWith('/*', i)) {
      while (i < src.length && !src.startsWith('*/', i)) { push(src[i] === '\n' ? '\n' : ' '); i++; }
      push(' '); push(' '); i += 2; continue;
    }
    if (lang === 'py' && c === '#') { while (i < src.length && src[i] !== '\n') { push(' '); i++; } continue; }
    if (lang === 'py' && (src.startsWith('"""', i) || src.startsWith("'''", i))) {
      const q = src.slice(i, i + 3); push(q); i += 3;
      while (i < src.length && !src.startsWith(q, i)) { const ch = src[i] === '\n' ? '\n' : ' '; push(src[i], ch); i++; }
      push(q); i += 3; continue;
    }
    if (c === '"' || c === "'") {
      const q = c; push(c); i++;
      while (i < src.length && src[i] !== q && src[i] !== '\n') {
        if (src[i] === '\\') { push(src[i], ' '); i++; }
        if (i < src.length) { push(src[i], ' '); i++; }
      }
      if (i < src.length) { push(src[i]); i++; }
      continue;
    }
    push(c); i++;
  }
  return { code, masked };
}
// balanced (...) / {...} over masked text; returns [start, end) of the inside
function balancedRange(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') { depth--; if (depth === 0) return [open + 1, i]; }
  }
  return null;
}
const lineOf = (src, off) => src.slice(0, off).split('\n').length;
// split top-level comma-separated args
function splitArgs(text) {
  const out = []; let depth = 0, cur = '', q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { cur += c; if (c === '\\') { cur += text[++i] ?? ''; continue; } if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if ('([{'.includes(c)) depth++;
    if (')]}'.includes(c)) depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ------------------------------------------------------------------ numbers
// Evaluate a small arithmetic expression after substituting known constants.
function evalNum(expr, consts, depth = 0) {
  if (expr == null || depth > 6) return null;
  let e = String(expr).trim();
  e = e.replace(/\*\s*millimeter\b/g, '').replace(/\bmillimeter\s*\*/g, '').replace(/\*\s*mm\b/g, '').replace(/\bmm\s*\*/g, '');
  if (/\*\s*(inch|meter|centimeter)\b/.test(e)) {
    const f = /inch/.test(e) ? 25.4 : /centimeter/.test(e) ? 10 : 1000;
    const v = evalNum(e.replace(/\*\s*(inch|meter|centimeter)\b/g, ''), consts, depth + 1);
    return v == null ? null : v * f;
  }
  e = e.replace(/\b([A-Za-z_][\w.]*)\b/g, (m) => {
    if (['min', 'max', 'abs', 'sqrt'].includes(m)) return 'Math.' + m;
    const k = m.split('.').pop();
    if (consts.has(m)) { const v = evalNum(consts.get(m), consts, depth + 1); return v == null ? 'NaN' : String(v); }
    if (consts.has(k)) { const v = evalNum(consts.get(k), consts, depth + 1); return v == null ? 'NaN' : String(v); }
    return 'NaN';
  });
  if (!/^[\d\s.+\-*/()eENaMath,minaxbsqrt]*$/.test(e)) return null;
  try { const v = Function(`"use strict";return (${e});`)(); return Number.isFinite(v) ? v : null; } catch { return null; }
}

// ------------------------------------------------------------------ FS
function fsFunctions(code, masked) {
  const fns = [];
  const re = /\bfunction\s+(\w+)\s*\(/g; let m;
  while ((m = re.exec(masked))) {
    const pr = balancedRange(masked, masked.indexOf('(', m.index));
    if (!pr) continue;
    const params = splitArgs(code.slice(pr[0], pr[1])).map(p => p.split(/\s+is\s+/)[0].trim());
    const open = masked.indexOf('{', pr[1]);
    const br = balancedRange(masked, open);
    if (!br) continue;
    fns.push({ name: m[1], params, start: m.index, bodyStart: br[0], end: br[1], kind: 'function' });
  }
  const fe = /\b(?:export\s+)?const\s+(\w+)\s*=\s*defineFeature\s*\(/g;
  while ((m = fe.exec(masked))) {
    const r = balancedRange(masked, masked.indexOf('(', m.index + m[0].length - 1));
    if (r) fns.push({ name: m[1], params: ['context', 'id', 'definition'], start: m.index, bodyStart: r[0], end: r[1], kind: 'feature' });
  }
  return fns;
}
function fsConsts(code) {
  const c = new Map(); const re = /\b(?:const|var)\s+(\w+)\s*=\s*([^;{}]+);/g; let m;
  while ((m = re.exec(code))) if (!c.has(m[1])) c.set(m[1], m[2]);
  // map-literal constants: NAME : value  (e.g. REVS or definition defaults)
  const kv = /["']?(\w+)["']?\s*:\s*([-\d.]+\s*(?:\*\s*millimeter)?)\s*[,}]/g;
  while ((m = kv.exec(code))) if (!c.has(m[1])) c.set(m[1], m[2]);
  return c;
}

// ------------------------------------------------------------------ Python
function pyFunctions(code) {
  const lines = code.split('\n'); const fns = []; let off = 0; const offs = [];
  for (const l of lines) { offs.push(off); off += l.length + 1; }
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)def\s+(\w+)\s*\(([^)]*)/);
    if (!m) continue;
    const ind = m[1].length; let j = i + 1;
    // skip continuation of signature
    while (j < lines.length && (!lines[j].trim() || lines[j].match(/^\s*/)[0].length > ind)) j++;
    const params = m[3].split(',').map(p => p.split(/[:=]/)[0].replace(/\*/g, '').trim()).filter(Boolean);
    fns.push({ name: m[2], params, start: offs[i], bodyStart: offs[i], end: offs[j] ?? code.length, kind: 'function', indent: ind, line: i + 1 });
  }
  return fns;
}
function pyConsts(code) {
  const c = new Map(); const re = /^\s*([A-Za-z_]\w*)\s*(?::\s*[\w\[\]]+)?\s*=\s*([^\n#]+)$/gm; let m;
  while ((m = re.exec(code))) if (!c.has(m[1])) c.set(m[1], m[2].trim());
  return c;
}

// ------------------------------------------------------------------ selection classes
const SEL_RULES = {
  fs: [
    ['all-body-edges', /qOwnedByBody\([^;]*EntityType\.EDGE\)\s*[,}]/],
    ['face-loop', /qAdjacent\([^;]*EntityType\.EDGE|qLoopEdges|qEdgeAdjacent/],
    ['axis-dir', /direction\[[^\]]+\]\)\s*[<>]=?\s*0\.99|abs\(\w+\.direction\[\w+\]\)\s*[<>]/],
    ['line-only', /GeometryType\.LINE|evLine\(/],
    ['coord-window', /minCorner\[[^\]]+\][^;]*-\s*\w+\)\s*<|p\[\d\]\s*[<>]\s*\w+\[\d\]|abs\(p\[\d\][^)]*\)\s*<|origin\[[^\]]+\][^;]*<|abs\(mid\[\d\]/],
    ['point-pick', /qContainsPoint|qClosestTo|qWithinRadius/],
    ['created-by', /qCreatedBy\([^;]*EntityType\.EDGE/],
    ['per-edge-retry', /for\s*\(var\s+\w+\s+in\s+evaluateQuery[^{]*\)\s*\{?[^}]*try\s+silent|try\s*\{\s*opFillet|try\s*\{\s*opChamfer/],
  ],
  py: [
    ['vertices-2d', /\.vertices\(\)|\bvertices\(\)/],
    ['axis-dir', /filter_by\(\s*Axis\.[XYZ]|filter_by\(\s*GeomType\.LINE[^)]*\)[^\n]*Axis/],
    ['plane-group', /group_by\(\s*(?:Axis\.[XYZ])?\s*\)\s*\[\s*-?\d+\s*\]|sort_by\([^)]*\)\s*\[\s*-?\d+\s*\]\s*\.edges\(\)/],
    ['face-loop', /faces\(\)[^\n]*\.edges\(\)|outer_wire\(\)\.edges\(\)|inner_wires\(\)|\.wires\(\)/],
    ['predicate', /\[\s*\w+\s+for\s+\w+\s+in\s+[^\]]*\bif\b|filter\(\s*lambda|\.center\(\)\.[XYZ]|position_at|\.radius\b/],
    ['circle-only', /GeomType\.CIRCLE|geom_type\s*==\s*GeomType\.CIRCLE|geom_type\s*==\s*["']CIRCLE/],
    ['line-only', /GeomType\.LINE|geom_type\s*==\s*["']LINE/],
    ['all-edges', /^\s*[\w.\[\]()]+\.edges\(\)\s*$/],
    ['new-edges', /\.edges\(\)\s*-\s*\w|new_edges|edges\(Select\.LAST\)|Select\.NEW/],
    ['single-edge', /^\s*\[\s*\w+\s*\]\s*$/],
  ],
};

function classifySelection(text, lang) {
  const out = [];
  for (const [k, re] of SEL_RULES[lang]) if (re.test(text)) out.push(k);
  return out;
}

// ------------------------------------------------------------------ main
const FS_RE = /\b(opFillet|opChamfer|fFillet|fChamfer|opVariableFillet|opFullRoundFillet)\s*\(/g;
const PY_RE = /(\.?)\b(fillet|chamfer)\s*\(/g;
const sites = [];
const fileRecs = [];

for (const f of targets.files) {
  const raw = readFileSync(join(ROOT, f.path), 'utf8');
  const lang = f.frontend;
  const { code, masked } = lex(raw, lang);
  const fns = lang === 'fs' ? fsFunctions(code, masked) : pyFunctions(code);
  const consts = lang === 'fs' ? fsConsts(code) : pyConsts(code);
  const enclosing = off => fns.filter(fn => fn.bodyStart <= off && off < fn.end).sort((a, b) => (a.end - a.bodyStart) - (b.end - b.bodyStart))[0] ?? null;
  // call graph (by name) over masked text
  const callsOf = new Map();
  for (const fn of fns) {
    const body = masked.slice(fn.bodyStart, fn.end); const set = new Set();
    for (const g of fns) if (g !== fn && new RegExp(`\\b${g.name}\\s*\\(`).test(body)) set.add(g.name);
    callsOf.set(fn, set);
  }
  // reachability
  const reach = new Set();
  const roots = lang === 'fs'
    ? fns.filter(fn => fn.kind === 'feature')
    : fns.filter(fn => /^test_/.test(fn.name));
  if (lang === 'fs' && !roots.length) roots.push(...fns.filter(fn => /\bexport\s+function\s+$/.test(masked.slice(Math.max(0, fn.start - 16), fn.start + 0)) || masked.slice(Math.max(0, fn.start - 7), fn.start).includes('export')));
  if (lang === 'py') {
    // module-level code: everything outside any top-level def/class body
    const top = fns.filter(fn => fn.indent === 0);
    let moduleText = masked; for (const fn of [...top].sort((a, b) => b.start - a.start)) moduleText = moduleText.slice(0, fn.start) + moduleText.slice(fn.end);
    for (const fn of fns) if (new RegExp(`\\b${fn.name}\\b`).test(moduleText)) roots.push(fn);
    // referenced from another function body counts through the graph; also any
    // reference as a value (callbacks, dict tables) is treated as a call.
    for (const fn of fns) {
      const body = masked.slice(fn.bodyStart, fn.end); const set = callsOf.get(fn);
      for (const g of fns) if (g !== fn && new RegExp(`\\b${g.name}\\b`).test(body)) set.add(g.name);
    }
  }
  const byName = new Map(); for (const fn of fns) { if (!byName.has(fn.name)) byName.set(fn.name, []); byName.get(fn.name).push(fn); }
  const stack = [...roots];
  while (stack.length) { const fn = stack.pop(); if (reach.has(fn)) continue; reach.add(fn); for (const n of callsOf.get(fn) ?? []) for (const g of byName.get(n) ?? []) stack.push(g); }
  const pyLibrary = lang === 'py' && !roots.length; // a module imported by others (no entry): count reachable if referenced

  const re = lang === 'fs' ? FS_RE : PY_RE; re.lastIndex = 0; let m;
  let fileSites = 0;
  while ((m = re.exec(masked))) {
    const before = masked.slice(Math.max(0, m.index - 12), m.index);
    if (/def\s+$|function\s+$/.test(before)) continue;
    const open = masked.indexOf('(', m.index + m[0].length - 1);
    const r = balancedRange(masked, open); if (!r) continue;
    const argText = code.slice(r[0], r[1]).replace(/\s+/g, ' ').trim();
    const op = lang === 'fs' ? m[1] : (m[1] ? '.' : '') + m[2];
    const enc = enclosing(m.index);
    const reachable = enc ? reach.has(enc) : true;
    const line = lineOf(code, m.index);
    // context
    const encText = enc ? masked.slice(enc.bodyStart, m.index) : masked.slice(0, m.index);
    let inLoop = false, inTry = false, inIf = false;
    if (lang === 'fs') {
      const st = []; const rr = /\b(for|while|try|if|else)\b[^{;]*\{|\{|\}/g; let x;
      while ((x = rr.exec(encText))) { if (x[0] === '}') st.pop(); else st.push(x[1] ?? 'b'); }
      inLoop = st.includes('for') || st.includes('while'); inTry = st.includes('try'); inIf = st.includes('if') || st.includes('else');
      if (/try\s+silent\s*\(?\s*$/.test(masked.slice(Math.max(0, m.index - 20), m.index))) inTry = true;
    } else {
      const ls = code.slice(0, m.index).split('\n'); let ind = ls[ls.length - 1].match(/^\s*/)[0].length;
      for (let i = ls.length - 2; i >= 0 && ind > 0; i--) {
        const l = ls[i]; if (!l.trim()) continue; const li = l.match(/^\s*/)[0].length;
        if (li < ind) { const t = l.trim(); if (/^(for|while)\b/.test(t)) inLoop = true; if (/^(try|except)\b/.test(t)) inTry = true; if (/^(if|elif|else)\b/.test(t)) inIf = true; if (/^def\b/.test(t)) break; ind = li; }
      }
    }
    // arguments
    const args = splitArgs(argText);
    let entitiesExpr = null, sizeExpr = null, extra = {};
    if (lang === 'fs') {
      const map = args[2] ?? '';
      const get = k => { const mm = map.match(new RegExp(`["']${k}["']\\s*:\\s*([^,}]+(?:\\([^)]*\\))?[^,}]*)`)); return mm ? mm[1].trim() : null; };
      entitiesExpr = get('entities'); sizeExpr = get('radius') ?? get('width') ?? get('distance');
      extra = { chamferType: get('chamferType'), tangentPropagation: get('tangentPropagation') };
      if (op === 'fFillet' || op === 'fChamfer') { entitiesExpr = args[1] ?? null; sizeExpr = args[2] ?? null; }
    } else {
      const pos = args.filter(a => !/^\w+\s*=/.test(a) || /==/.test(a));
      const kw = Object.fromEntries(args.filter(a => /^\w+\s*=[^=]/.test(a)).map(a => [a.split('=')[0].trim(), a.slice(a.indexOf('=') + 1).trim()]));
      if (op.startsWith('.')) { // Solid.fillet(radius, edge_list) / Solid.chamfer(length, length2, edge_list)
        sizeExpr = kw.radius ?? kw.length ?? pos[0] ?? null; entitiesExpr = kw.edge_list ?? pos[pos.length - 1] ?? null;
      } else { entitiesExpr = kw.objects ?? pos[0] ?? null; sizeExpr = kw.radius ?? kw.length ?? pos[1] ?? null; extra = { length2: kw.length2 ?? pos[2] ?? null, angle: kw.angle ?? null }; }
    }
    // resolve size: literal / constant / helper parameter
    let sizeValues = [], sizeVia = 'literal';
    const direct = evalNum(sizeExpr, consts);
    if (direct != null) sizeValues = [direct];
    const paramName = sizeExpr && (sizeExpr.match(/^\s*(\w+)\s*(?:\*\s*millimeter)?\s*$/) ?? [])[1];
    if (direct == null && enc && paramName && enc.params.includes(paramName)) {
      sizeVia = 'helper-param'; const idx = enc.params.indexOf(paramName);
      const callRe = new RegExp(`\\b${enc.name}\\s*\\(`, 'g'); let cm;
      while ((cm = callRe.exec(masked))) {
        const bb = masked.slice(Math.max(0, cm.index - 12), cm.index); if (/function\s+$|def\s+$/.test(bb)) continue;
        const cr = balancedRange(masked, masked.indexOf('(', cm.index)); if (!cr) continue;
        const cargs = splitArgs(code.slice(cr[0], cr[1]));
        const kwv = cargs.find(a => new RegExp(`^${paramName}\\s*=`).test(a));
        const v = evalNum(kwv ? kwv.split('=').slice(1).join('=') : cargs[idx], consts);
        const cenc = enclosing(cm.index);
        sizeValues.push(v);
        (extra.helperCalls ??= []).push({ line: lineOf(code, cm.index), arg: kwv ?? cargs[idx] ?? null, value: v, reachable: cenc ? reach.has(cenc) : true });
      }
    } else if (direct == null) sizeVia = sizeExpr ? 'unresolved' : 'missing';
    // selection text: FS -> enclosing function body (the selecting loop lives there);
    // py -> the argument plus the latest assignment(s) of a bare variable in the function
    let selText = entitiesExpr ?? '';
    if (lang === 'fs' && enc) selText = code.slice(enc.bodyStart, r[1]);
    if (lang === 'py' && entitiesExpr) {
      const scopeStart = enc ? enc.bodyStart : 0;
      const scopeM = masked.slice(scopeStart, m.index), scopeC = code.slice(scopeStart, m.index);
      // statements assigning `name` (=, +=, for-target, comprehension source) in scope, bracket-balanced
      const assignments = name => {
        const out = []; const re2 = new RegExp(`^[ \\t]*(?:${name}\\s*(?:\\+?=|\\.(?:append|extend)\\()|for\\s+${name}\\s+in\\b)`, 'gm'); let a;
        while ((a = re2.exec(scopeM))) {
          let i = a.index, depth = 0;
          for (; i < scopeM.length; i++) { const c = scopeM[i]; if ('([{'.includes(c)) depth++; else if (')]}'.includes(c)) depth--; else if (c === '\n' && depth <= 0) break; }
          out.push(scopeC.slice(a.index, i));
        }
        return out;
      };
      const names = new Set(); const texts = [entitiesExpr];
      const queue = [...entitiesExpr.matchAll(/\b([a-z_]\w*)\b(?!\s*\()/g)].map(x => x[1]);
      for (let hop = 0; hop < 3 && queue.length; hop++) {
        const next = [];
        for (const n of queue) {
          if (names.has(n) || ['e', 'x', 'v', 'f', 'in', 'if', 'for', 'and', 'or', 'not', 'list', 'abs', 'len'].includes(n)) continue;
          names.add(n); const a = assignments(n); texts.push(...a);
          if (!a.length && enc && enc.params.includes(n) && n === entitiesExpr.trim()) texts.push(`<param ${n}>`);
          for (const t of a) for (const x of t.matchAll(/\b([a-z_]\w*)\b(?!\s*\()/g)) next.push(x[1]);
        }
        queue.length = 0; queue.push(...next);
      }
      selText = texts.join('\n');
    }
    const selection = classifySelection(selText, lang);
    if (lang === 'py' && /^<param/.test(selText)) selection.push('passed-in');
    const is2d = lang === 'py' && (selection.includes('vertices-2d'));
    sites.push({
      path: f.path, family: f.family, project: f.project, frontend: lang, generated: f.generated ?? null,
      duplicatePaths: f.duplicatePaths ?? [], line, op: op.replace(/^\./, ''), methodForm: op.startsWith('.'),
      kind: /hamfer/i.test(op) ? 'chamfer' : 'fillet', dim: is2d ? '2d' : '3d',
      reachable, enclosing: enc ? enc.name : '<module>', inLoop, inTry, inIf,
      entitiesExpr, sizeExpr, sizeVia, sizeValuesMm: sizeValues, selection, extra,
    });
    fileSites++;
  }
  fileRecs.push({ path: f.path, family: f.family, frontend: lang, sites: fileSites });
}

mkdirSync(join(REPO, 'tmp/fillet'), { recursive: true });
writeFileSync(join(REPO, 'tmp/fillet/static.json'), JSON.stringify({ schema: 'wonky-fillet-static/1', generatedAt: new Date().toISOString(), sites }, null, 1));
const live = sites.filter(s => s.reachable);
const fam = xs => new Set(xs.map(s => s.family)).size, fil = xs => new Set(xs.map(s => s.path)).size;
console.log(JSON.stringify({
  sites: sites.length, reachableSites: live.length,
  files: fil(sites), families: fam(sites), reachableFiles: fil(live), reachableFamilies: fam(live),
  reachable3dFiles: fil(live.filter(s => s.dim === '3d')), reachable3dFamilies: fam(live.filter(s => s.dim === '3d')),
}));
