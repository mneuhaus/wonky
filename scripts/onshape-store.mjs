// The shared Onshape input store (docs/onshape-inputs.md).
//
//   var/onshape-store/
//     revisions/<element>@<microversion>/revision.json   what is held, with provenance
//     revisions/<element>@<microversion>/parts.json      raw part list, byte for byte
//     revisions/<element>@<microversion>/bodies/<partId>.body.json   raw bodydetails
//     captures/<captureId>.json                          one record per capture run or seed
//     manifests/<corpus-relative path>.json              schema wonky-onshape-inputs/2
//
// Offline code only: nothing here talks to Onshape (the bridge client is
// scripts/onshape-bridge.mjs).
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/parser.mjs';
import { parseImportPath } from '../src/modules.mjs';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const STORE = process.env.WONKY_ONSHAPE_STORE ? resolve(process.env.WONKY_ONSHAPE_STORE) : join(REPO, 'var/onshape-store');
export const REVISION_SCHEMA = 'wonky-onshape-revision/1';
export const CAPTURE_SCHEMA = 'wonky-onshape-capture/1';
export const MANIFEST_SCHEMA = 'wonky-onshape-inputs/2';

export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const revisionKey = (element, microversion) => `${element}@${microversion}`;
// Part ids are case-sensitive (RUHD and RuHD are two parts of one Part Studio)
// but macOS file systems usually are not: every uppercase letter is marked
// with '_' so the name stays unique under case folding (RuHD -> _Ru_H_D).
// Files written earlier keep the name their revision.json records.
export const bodyFile = partId => `bodies/${encodeURIComponent(partId.replace(/[A-Z]/g, c => '_' + c))}.body.json`;
export const json = value => JSON.stringify(value, null, 2) + '\n';

export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, json(value));
}
// Write raw captured bytes once. An existing file must be byte-identical:
// a revision is immutable, so different bytes mean a broken capture.
export function writeOnce(path, bytes) {
  if (existsSync(path)) {
    if (sha256(readFileSync(path)) !== sha256(bytes)) throw new Error(`Store file differs from the new capture of the same immutable revision: ${path}`);
    return false;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return true;
}

export const revisionDir = (key, store = STORE) => join(store, 'revisions', key);
export function readRevision(key, store = STORE) {
  const path = join(revisionDir(key, store), 'revision.json');
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null;
}
// `pin` says which immutable Onshape state the captured bytes come from
// (docs/onshape-inputs.md, "Resolving an import version"):
//   { mode, documentMicroversion, elementMicroversion, documentVersion?, workspace?, evidence, capture }
// The import `version` is either a document microversion (mode
// document-microversion) or the element's own microversion (modes
// document-version, history, alias). Part lists and bodies then name the
// document microversion D in `microversionId` / `documentMicroversion`.
export function newRevision({ document, documentVersion = null, element, microversion }) {
  return { schema: REVISION_SCHEMA, key: revisionKey(element, microversion), document, documentVersion, element, microversion, pin: null, parts: null, bodies: [], queryAnswers: [], captures: [] };
}
// The document microversion the captured bytes of a revision name.
export const pinnedMicroversion = revision => revision.pin?.documentMicroversion ?? revision.microversion;
export const writeRevision = (revision, store = STORE) => writeJson(join(revisionDir(revision.key, store), 'revision.json'), revision);

// Every solid part of the revision and whether its B-rep is held.
export function revisionCoverage(revision, store = STORE) {
  if (!revision?.parts) return { parts: null, solids: null, captured: 0, missing: null };
  const parts = JSON.parse(readFileSync(join(revisionDir(revision.key, store), revision.parts.file), 'utf8'));
  const solids = parts.filter(p => p.bodyType === 'solid');
  const held = new Set(revision.bodies.map(b => b.partId));
  return { parts: parts.length, solids: solids.length, captured: solids.filter(p => held.has(p.partId)).length,
    missing: solids.filter(p => !held.has(p.partId)).map(p => ({ partId: p.partId, name: p.name })), nonSolid: parts.length - solids.length };
}

// Namespaced imports of a FeatureScript source, with their parsed path form.
export function importsOf(text) {
  return parse(text).imports.filter(spec => spec.namespace).map(spec => ({ namespace: spec.namespace, path: spec.path, version: spec.version, target: parseImportPath(spec.path) }));
}

// The host document of same-document imports: --document, else the nearest
// state.json (walking up from the source, not above `stopAt`) with a
// `document` or `documentId` field. Returns null when neither exists.
export function hostDocumentFor(sourcePath, { document = null, stopAt = null } = {}) {
  if (document) return { document, from: '--document' };
  let dir = dirname(resolve(sourcePath));
  const limit = stopAt ? resolve(stopAt) : null;
  for (;;) {
    const path = join(dir, 'state.json');
    if (existsSync(path)) {
      let state = null;
      try { state = JSON.parse(readFileSync(path, 'utf8')); } catch { /* not JSON: keep looking */ }
      const found = state?.document ?? state?.documentId;
      if (typeof found === 'string' && /^[0-9a-f]{24}$/.test(found)) return { document: found, from: limit ? relative(limit, path) : path };
    }
    if (dir === limit || dirname(dir) === dir) return null;
    dir = dirname(dir);
  }
}

// A schema-2 manifest for one source, pointing into the store. Imports whose
// revision the store does not hold are listed as unresolved (the loader then
// raises its explicit "Unresolved Onshape module" error at their first use).
export function manifestFor({ text, sourceRelPath, corpusRoot, manifestPath, host, store = STORE, generator }) {
  const imports = importsOf(text);
  const modules = [], unresolved = [];
  let hostDocument = host?.document ?? null, hostDocumentFrom = host?.from ?? null;
  for (const spec of imports) {
    const miss = reason => unresolved.push({ namespace: spec.namespace, path: spec.path, version: spec.version, reason });
    if (!spec.target) { miss('not an Onshape Part Studio path (Feature Studio source and local imports are stage 4)'); continue; }
    const revision = readRevision(revisionKey(spec.target.element, spec.version), store);
    if (revision?.notCapturable) { miss(revision.notCapturable.reason); continue; }
    if (!revision?.parts) { miss(revision?.pin ? 'revision pinned but its part list is not in the store' : 'revision not in the store'); continue; }
    if (spec.target.document) {
      if (revision.document !== spec.target.document || (revision.documentVersion && revision.documentVersion !== spec.target.documentVersion)) { miss(`store holds this element@microversion for document ${revision.document}/${revision.documentVersion}`); continue; }
    } else {
      // Onshape element ids are unique, so a captured element@microversion
      // names its document. A host document from state.json or --document
      // must agree with it.
      if (hostDocument && hostDocument !== revision.document) { miss(`host document ${hostDocument} (${hostDocumentFrom}) differs from the captured revision's document ${revision.document}`); continue; }
      if (!hostDocument) { hostDocument = revision.document; hostDocumentFrom = `store revision ${revision.key} (element ids are unique in Onshape)`; }
    }
    const base = `revisions/${revision.key}/`;
    const pinned = pinnedMicroversion(revision);
    modules.push({ namespace: spec.namespace, path: spec.path, revision: revision.key,
      document: revision.document, documentVersion: spec.target.document ? spec.target.documentVersion : null,
      element: revision.element, microversion: revision.microversion,
      ...(pinned !== revision.microversion ? { documentMicroversion: pinned, pin: revision.pin.mode } : {}),
      parts: { file: base + revision.parts.file, sha256: revision.parts.sha256 },
      bodies: revision.bodies.map(b => ({ name: b.name, partId: b.partId, file: base + b.file, sha256: b.sha256 })),
      coverage: (({ solids, captured }) => ({ solids, captured }))(revisionCoverage(revision, store)) });
  }
  const sourceSha256 = sha256(text);
  return {
    schema: MANIFEST_SCHEMA, generator, store: relative(dirname(manifestPath), store) || '.',
    source: { corpusRoot, path: sourceRelPath, sha256: sourceSha256 }, sourceSha256,
    hostDocument, hostDocumentFrom, modules, unresolved,
  };
}

// How each namespace is used: `NS::build` (Part Studio bodies) or other
// names (Feature Studio code, stage 4). Comments and strings are not
// stripped; a false "code" use only makes the capture skip a revision.
export function namespaceUses(text) {
  const uses = new Map();
  for (const [, ns, name] of text.matchAll(/\b([A-Za-z_]\w*)::([A-Za-z_]\w*)/g)) {
    if (name === 'import') continue;
    (uses.get(ns) ?? uses.set(ns, new Set()).get(ns)).add(name);
  }
  return uses;
}
export const isCodeImport = (uses, namespace) => { const names = uses.get(namespace); return !!names && [...names].some(n => n !== 'build') && !names.has('build'); };

// Onshape element ids are globally unique, so any Onshape URL in the corpus
// of the form d/<document>/{w,v,m}/<id>/e/<element> names the element's
// document. Used only for same-document imports that have neither
// --document nor a state.json. Unanimous evidence only; the part-list
// request of the capture then verifies it (elementId in the response).
// Results are cached in var/onshape-store/element-documents.json.
export function elementDocumentEvidence(elements, { corpusRoot, store = STORE, rescan = false } = {}) {
  const cachePath = join(store, 'element-documents.json');
  const cache = existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : { schema: 'wonky-onshape-element-documents/1', elements: {} };
  const wanted = [...new Set(elements)].filter(e => rescan || !cache.elements[e]);
  if (wanted.length) {
    const pattern = `d/[0-9a-f]{24}/[wvm]/[0-9a-f]{24}/e/(${wanted.join('|')})`;
    // Only text files below 1 MiB: the corpus holds tens of GB of exports and
    // logs, and an unbounded grep over it does not finish in useful time.
    const names = ['json', 'jsonl', 'md', 'log', 'txt', 'py', 'mjs', 'js', 'ts', 'yaml', 'yml', 'html', 'fs'].map(x => `-name '*.${x}'`).join(' -o ');
    const script = `find "$1" \\( -name node_modules -o -name .git -o -name .venv \\) -prune -o -type f -size -1024k \\( ${names} \\) -print0 | xargs -0 grep -IoE -e "$2" /dev/null`;
    const r = spawnSync('sh', ['-c', script, 'sh', corpusRoot, pattern], { encoding: 'utf8', maxBuffer: 1 << 30 });
    if (r.status > 1 && r.status !== 123) throw new Error(`grep failed (${r.status}): ${r.stderr}`);
    const found = new Map(wanted.map(e => [e, { documents: {}, files: new Set() }]));
    for (const line of r.stdout.split('\n')) {
      const m = /^(.*):d\/([0-9a-f]{24})\/[wvm]\/[0-9a-f]{24}\/e\/([0-9a-f]{24})$/.exec(line);
      if (!m) continue;
      const row = found.get(m[3]); if (!row) continue;
      row.documents[m[2]] = (row.documents[m[2]] ?? 0) + 1;
      row.files.add(relative(corpusRoot, m[1]));
    }
    const scannedAt = new Date().toISOString();
    for (const [element, row] of found) {
      const docs = Object.keys(row.documents);
      cache.elements[element] = { document: docs.length === 1 ? docs[0] : null, documents: row.documents, files: [...row.files].sort().slice(0, 5), fileCount: row.files.size, scannedAt };
    }
    cache.corpusRoot = corpusRoot; cache.pattern = 'd/<document>/{w,v,m}/<id>/e/<element> in corpus text files';
    writeJson(cachePath, cache);
  }
  return new Map(elements.map(e => [e, cache.elements[e] ?? null]));
}

// Static partQuery expressions of addInstance calls, as source text, per
// namespace: addInstance(<id>, NS::build, { ... "partQuery" : <expr> ... }).
export function staticPartQueries(text) {
  const out = [];
  for (const m of text.matchAll(/addInstance\s*\(\s*[^,]+,\s*([A-Za-z_]\w*)::build\s*,\s*\{/g)) {
    let i = m.index + m[0].length, depth = 1, start = -1;
    const key = /["']partQuery["']\s*:\s*/y;
    for (; i < text.length && depth > 0; i++) {
      if (depth === 1 && start === -1) { key.lastIndex = i; const k = key.exec(text); if (k) { start = i + k[0].length; i = start - 1; continue; } }
      const c = text[i];
      if (c === '"' || c === "'") { const q = c; i++; while (i < text.length && text[i] !== q) { if (text[i] === '\\') i++; i++; } continue; }
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { depth--; if (depth === 0 && start >= 0) { out.push({ namespace: m[1], query: text.slice(start, i).trim() }); start = -2; } }
      else if (c === ',' && depth === 1 && start >= 0) { out.push({ namespace: m[1], query: text.slice(start, i).trim() }); start = -2; }
    }
  }
  return out;
}
