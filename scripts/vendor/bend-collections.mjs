#!/usr/bin/env node
// Re-fetch the pinned bend-collections commit and verify the vendored copy in
// kernel/vendor/bend-collections/ byte for byte (docs/collections.md).
//
//   node scripts/vendor/bend-collections.mjs                 fetch the pin from GitHub, compare
//   node scripts/vendor/bend-collections.mjs --source <dir>  compare against a local clone instead
//   node scripts/vendor/bend-collections.mjs --offline       only check files against MANIFEST.sha256
//   node scripts/vendor/bend-collections.mjs --update <sha>  re-vendor src/ at <sha> (then review the diff)
//
// Exit status 0 means: the vendored tree is exactly upstream src/ at the pinned
// commit (same paths, same bytes, nothing extra) and MANIFEST.sha256 agrees.
// Uses only git and Node built-ins.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const vendorDir = join(root, 'kernel/vendor/bend-collections');
const pinPath = join(vendorDir, 'PIN.json');
const manifestPath = join(vendorDir, 'MANIFEST.sha256');
const subtree = 'src';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function walk(directory) {
  if (!existsSync(directory)) return [];
  const out = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (entry.isFile()) out.push(path);
    else throw new Error(`unsupported filesystem entry ${path}`);
  }
  return out;
}

// { 'src/containers/x.bend': Buffer } for every file under <base>/src.
function tree(base) {
  const files = new Map();
  for (const path of walk(join(base, subtree))) files.set(relative(base, path).split(sep).join('/'), readFileSync(path));
  return new Map([...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

const manifestText = files => [...files].map(([path, bytes]) => `${sha256(bytes)}  ${path}\n`).join('');

function parseArgs(argv) {
  const options = { mode: 'fetch', source: null, update: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--offline') options.mode = 'offline';
    else if (arg === '--source') { options.mode = 'source'; options.source = argv[++i]; }
    else if (arg === '--update') { options.update = argv[++i]; }
    else if (arg === '--help' || arg === '-h') { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 10).join('\n')); process.exit(0); }
    else throw new Error(`unknown argument ${arg}`);
  }
  if ((options.mode === 'source' && !options.source) || (options.update !== null && !/^[0-9a-f]{40}$/.test(options.update))) {
    throw new Error('--source needs a directory, --update a full 40-hex commit id');
  }
  return options;
}

// A checkout of <commit>: the local clone (verified to be at that commit and
// clean under src/) or a fresh shallow fetch into a temporary directory.
function checkout(pin, commit, source) {
  if (source) {
    const head = git(source, 'rev-parse', 'HEAD');
    if (head !== commit) throw new Error(`${source} is at ${head}, expected ${commit}`);
    const dirty = git(source, 'status', '--porcelain', '--', subtree);
    if (dirty) throw new Error(`${source} has local changes under ${subtree}/:\n${dirty}`);
    return { dir: source, cleanup() {} };
  }
  const dir = mkdtempSync(join(tmpdir(), 'bend-collections-'));
  try {
    git(dir, 'init', '-q');
    git(dir, 'remote', 'add', 'origin', pin.repository);
    git(dir, 'fetch', '-q', '--depth', '1', 'origin', commit);
    git(dir, 'checkout', '-q', 'FETCH_HEAD');
    const head = git(dir, 'rev-parse', 'HEAD');
    if (head !== commit) throw new Error(`fetched ${head}, expected ${commit}`);
  } catch (cause) { rmSync(dir, { recursive: true, force: true }); throw cause; }
  return { dir, cleanup() { rmSync(dir, { recursive: true, force: true }); } };
}

function compare(expected, actual) {
  const problems = [];
  for (const [path, bytes] of expected) {
    const have = actual.get(path);
    if (!have) problems.push(`missing  ${path}`);
    else if (!have.equals(bytes)) problems.push(`differs  ${path}`);
  }
  for (const path of actual.keys()) if (!expected.has(path)) problems.push(`extra    ${path}`);
  return problems;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const pin = JSON.parse(readFileSync(pinPath, 'utf8'));
  const vendored = tree(vendorDir);

  if (options.update) {
    const co = checkout(pin, options.update, options.source);
    try {
      const upstream = tree(co.dir);
      const date = git(co.dir, 'show', '-s', '--format=%cI', options.update);
      rmSync(join(vendorDir, subtree), { recursive: true, force: true });
      for (const [path, bytes] of upstream) {
        mkdirSync(dirname(join(vendorDir, path)), { recursive: true });
        writeFileSync(join(vendorDir, path), bytes);
      }
      writeFileSync(manifestPath, manifestText(upstream));
      writeFileSync(pinPath, `${JSON.stringify({ ...pin, commit: options.update, date }, null, 2)}\n`);
      console.log(`vendored ${upstream.size} files from ${pin.repository} at ${options.update} (${date})`);
      console.log('Review: git diff kernel/vendor/bend-collections; update local design note; rerun npm test and test/collections*.test.mjs.');
    } finally { co.cleanup(); }
    return;
  }

  const problems = [];
  const manifest = readFileSync(manifestPath, 'utf8');
  if (manifest !== manifestText(vendored)) problems.push('MANIFEST.sha256 does not match the vendored files');
  if (options.mode !== 'offline') {
    const co = checkout(pin, pin.commit, options.source);
    try {
      const upstream = tree(co.dir);
      problems.push(...compare(upstream, vendored));
      if (manifest !== manifestText(upstream)) problems.push('MANIFEST.sha256 does not match upstream');
    } finally { co.cleanup(); }
  }
  if (problems.length) {
    console.error(`bend-collections vendor check FAILED (${pin.commit}):\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`bend-collections ${pin.commit}: ${vendored.size} files identical (${options.mode === 'offline' ? 'manifest only' : options.mode === 'source' ? `local clone ${options.source}` : pin.repository})`);
}

try { main(); }
catch (cause) { console.error(`bend-collections vendor check FAILED: ${cause.message}`); process.exit(1); }
