#!/usr/bin/env node
// Lexical census of Marc's real CAD corpus (read-only) for the semantic-core
// study (docs/language/semantic-core.md). Counts are regex-based and therefore
// approximate: they locate constructs and library calls, they do not prove
// semantics. Files are deduplicated by SHA-256 so copied revisions count once.
// Also runs wonky's own FeatureScript parser on every unique .fs file to
// measure today's syntactic coverage (parse only, no evaluation).
//
// Usage: node scripts/lang/semantic-census.mjs [corpusRoot] [outJson]
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { parse } from '../../src/parser.mjs';
import { ModelingContext } from '../../src/library.mjs';

const root = process.argv[2] ?? `${process.env.HOME}/Workspace/cad`;
const outPath = process.argv[3] ?? new URL('../../out/lang/semantic-census.json', import.meta.url).pathname;
const skipDirs = new Set(['node_modules', '.venv', 'venv', 'site-packages', '.git', '__pycache__', '.tox', 'dist', 'build']);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.isDirectory()) { if (!skipDirs.has(e.name) && !e.name.startsWith('.')) walk(join(dir, e.name), out); }
    else if (e.isFile() && (e.name.endsWith('.fs') || e.name.endsWith('.py'))) out.push(join(dir, e.name));
  }
  return out;
}

const sha = s => createHash('sha256').update(s).digest('hex');
// Remove comments and string contents so construct counts see code only.
function codeOnly(src, lang) {
  let out = '', i = 0;
  while (i < src.length) {
    const c = src[i];
    if (lang === 'fs' && src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (lang === 'fs' && src.startsWith('/*', i)) { const j = src.indexOf('*/', i + 2); i = j < 0 ? src.length : j + 2; continue; }
    if (lang === 'py' && c === '#') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (lang === 'py' && (src.startsWith('"""', i) || src.startsWith("'''", i))) {
      const q = src.slice(i, i + 3), j = src.indexOf(q, i + 3); out += '""'; i = j < 0 ? src.length : j + 3; continue;
    }
    if (c === '"' || c === "'") {
      const q = c; out += q + q; i++;
      while (i < src.length && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
      i++; continue;
    }
    out += c; i++;
  }
  return out;
}
const count = (text, re) => (text.match(re) ?? []).length;
const bump = (m, k, n = 1) => { m[k] = (m[k] ?? 0) + n; };
const top = (m, n = 60) => Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n));

const fsConstructs = {
  trySilent: /\btry\s+silent\b/g, tryExpr: /\btry\s*\(/g, tryBlock: /\btry\s*\{/g, catch: /\bcatch\b/g,
  annotation: /\bannotation\b/g, precondition: /\bprecondition\b/g, defineFeature: /\bdefineFeature\s*\(/g,
  lambda: /\bfunction\s*\(/g, forIn: /\bfor\s*\(\s*var\s+\w+\s+in\b/g, forC: /\bfor\s*\(\s*(var|const)?\s*\w+\s*=/g,
  while: /\bwhile\s*\(/g, tilde: /~/g, isType: /\bis\s+[A-Za-z]\w*/g, asCast: /\bas\s+[A-Z]\w*/g,
  namespaceRef: /\b\w+::\w+/g, namespaceImport: /\b\w+::import\s*\(/g, enumDecl: /\benum\s+\w+/g,
  typeDecl: /\btype\s+\w+\s+typecheck\b/g, predicateDecl: /\bpredicate\s+\w+/g, operatorOverload: /\boperator\s*[-+*\/]/g,
  newBox: /\bnew\s+box\s*\(/g, boxDeref: /\w\s*\[\s*\]/g, switchLike: /\}\s*\[\s*\w+/g, ternary: /\?[^?:]+:/g,
  returns: /\breturns\s+\w+/g, constDecl: /\bconst\s+\w+/g, varDecl: /\bvar\s+\w+/g,
  compoundAssign: /[+\-*\/]=/g, unitsMul: /\*\s*(millimeter|meter|inch|degree|radian|centimeter)\b/g,
  idPlus: /\bid\s*\+\s*["'(]/g,
};
const pyConstructs = {
  buildPart: /\bBuildPart\s*\(/g, buildSketch: /\bBuildSketch\s*\(/g, buildLine: /\bBuildLine\s*\(/g, withStmt: /^\s*with\s+/gm,
  locations: /\b(Locations|GridLocations|PolarLocations|HexLocations)\s*\(/g, modeKw: /\bmode\s*=\s*Mode\.\w+/g,
  add: /\badd\s*\(/g, pos: /\bPos\s*\(/g, rot: /\bRot\s*\(/g, location: /\bLocation\s*\(/g,
  planeRef: /\bPlane\.\w+/g, axisRef: /\bAxis\.\w+/g,
  selEdges: /\.edges\s*\(/g, selFaces: /\.faces\s*\(/g, selVertices: /\.vertices\s*\(/g, selSolids: /\.solids\s*\(/g,
  filterBy: /\.filter_by\s*\(/g, sortBy: /\.sort_by\s*\(/g, groupBy: /\.group_by\s*\(/g, filterByPosition: /\.filter_by_position\s*\(/g,
  selOpShift: /\)\s*(>>|<<)\s*Axis/g, selOpPipe: /\)\s*\|\s*(Axis|Plane|GeomType)/g, selIndex: /\)\s*\[\s*-?\d+\s*\]/g,
  fillet: /\bfillet\s*\(/g, chamfer: /\bchamfer\s*\(/g, extrude: /\bextrude\s*\(/g, revolve: /\brevolve\s*\(/g,
  loft: /\bloft\s*\(/g, sweep: /\bsweep\s*\(/g, offset: /\boffset\s*\(/g, mirror: /\bmirror\s*\(/g, split: /\bsplit\s*\(/g,
  box: /\bBox\s*\(/g, cylinder: /\bCylinder\s*\(/g, sketchRect: /\bRectangle\s*\(/g, sketchCircle: /\bCircle\s*\(/g,
  polyline: /\b(Polyline|Polygon)\s*\(/g, hole: /\b(Hole|CounterBoreHole|CounterSinkHole)\s*\(/g,
  exportStep: /\bexport_step\s*\(/g, exportStl: /\bexport_stl\s*\(/g,
  pyClass: /^\s*class\s+\w+/gm, pyDef: /^\s*def\s+\w+/gm, pyLambda: /\blambda\b/g, pyComprehension: /\[[^\[\]\n]*\bfor\b[^\[\]\n]*\bin\b/g,
  fString: /\bf["']/g, dataclass: /@dataclass/g, numpy: /\bimport\s+numpy|from\s+numpy/g, tryExcept: /^\s*try\s*:/gm,
  cadKhana: /\bcad_khana\b/g, algebraSub: /\)\s*-\s*[A-Z]\w*\s*\(/g, algebraAdd: /\)\s*\+\s*[A-Z]\w*\s*\(/g,
};

const builtinNames = new Set(Object.keys(new ModelingContext(null).builtins()));
const fsKeywords = new Set(['if', 'for', 'while', 'function', 'return', 'catch', 'try', 'annotation', 'precondition', 'import', 'switch', 'box', 'new', 'returns']);

const files = walk(root);
const seen = new Set();
const fs = { files: 0, duplicates: 0, bytes: 0, constructs: {}, filesWith: {}, calls: {}, missingCalls: {}, missingCallFiles: {}, parse: { ok: 0, fail: 0, errors: {} }, versions: {} };
const py = { files: 0, duplicates: 0, bytes: 0, constructs: {}, filesWith: {}, builderFiles: 0, algebraOnlyFiles: 0, shimSubsetFiles: 0 };
for (const path of files) {
  let src;
  try { if (statSync(path).size > 8e6) continue; src = readFileSync(path, 'utf8'); } catch { continue; }
  const lang = path.endsWith('.fs') ? 'fs' : 'py';
  if (lang === 'py' && !/^\s*(from\s+build123d|import\s+build123d)/m.test(src)) continue;
  const h = sha(src);
  const bucket = lang === 'fs' ? fs : py;
  if (seen.has(h)) { bucket.duplicates++; continue; }
  seen.add(h); bucket.files++; bucket.bytes += src.length;
  const code = codeOnly(src, lang);
  for (const [name, re] of Object.entries(lang === 'fs' ? fsConstructs : pyConstructs)) {
    const n = count(code, re);
    if (n) { bump(bucket.constructs, name, n); bump(bucket.filesWith, name); }
  }
  if (lang === 'fs') {
    const version = src.match(/FeatureScript\s+(\d+)/)?.[1]; if (version) bump(fs.versions, version);
    const declared = new Set([...code.matchAll(/\bfunction\s+(\w+)/g), ...code.matchAll(/\b(?:const|var)\s+(\w+)\s*=/g), ...code.matchAll(/\benum\s+(\w+)/g)].map(m => m[1]));
    const called = new Set();
    for (const m of code.matchAll(/(?<![\w.:])([A-Za-z_]\w*)\s*\(/g)) {
      const name = m[1];
      if (fsKeywords.has(name) || declared.has(name)) continue;
      bump(fs.calls, name);
      if (!builtinNames.has(name)) { bump(fs.missingCalls, name); called.add(name); }
    }
    for (const name of called) bump(fs.missingCallFiles, name);
    try { parse(src); fs.parse.ok++; }
    catch (error) {
      fs.parse.fail++;
      const key = String(error.message).replace(/'[^']*'/g, "'…'").replace(/"[^"]*"/g, '"…"').slice(0, 90);
      bump(fs.parse.errors, key);
    }
  } else {
    const c = bucket.constructs;
    const usesBuilder = /\bBuild(Part|Sketch|Line)\s*\(/.test(code);
    if (usesBuilder) py.builderFiles++; else py.algebraOnlyFiles++;
    const names = new Set([...code.matchAll(/\b([A-Z]\w*)\s*\(/g)].map(m => m[1]));
    const methods = [...code.matchAll(/\.(\w+)\s*\(/g)].map(m => m[1]);
    const shim = new Set(['Box', 'Cylinder', 'Pos']);
    if ([...names].every(n => shim.has(n)) && methods.length === 0) py.shimSubsetFiles++;
    void c;
  }
}
fs.calls = top(fs.calls, 80); fs.missingCalls = top(fs.missingCalls, 80); fs.missingCallFiles = top(fs.missingCallFiles, 80);
fs.parse.errors = top(fs.parse.errors, 25);
const report = {
  schema: 'wonky-lang-semantic-census/1', generatedAt: new Date().toISOString(), corpusRoot: root,
  method: 'Regex census over comment/string-stripped code of unique (SHA-256) files; Python limited to files importing build123d; FS parse via src/parser.mjs (syntax only). Counts are approximate indicators, not semantic proof.',
  wonkyBuiltinCount: builtinNames.size, featureScript: fs, build123d: py,
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ out: relative(process.cwd(), outPath), fsFiles: fs.files, fsParseOk: fs.parse.ok, fsParseFail: fs.parse.fail, pyFiles: py.files, builderFiles: py.builderFiles, shimSubsetFiles: py.shimSubsetFiles }, null, 1));
