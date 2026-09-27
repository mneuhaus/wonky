import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isMainThread, parentPort, threadId, Worker, workerData } from 'node:worker_threads';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const schema = 'wonky-bend-js-cache/2';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ownSource = { path: fileURLToPath(import.meta.url), sha256: hash(readFileSync(new URL(import.meta.url))) };
const filePath = value => value instanceof URL ? fileURLToPath(value) : resolve(value);
const error = (message, code) => Object.assign(new Error(message), { code });
let registered;
let compiler;
let compilationQueue = Promise.resolve();

function configuration(options) {
  if (options.cache !== undefined && typeof options.cache !== 'boolean') throw new TypeError('Bend cache must be a boolean');
  const lockFile = filePath(options.lockFile ?? join(projectRoot, 'bend.lock.json'));
  const lockBytes = readFileSync(lockFile), lock = JSON.parse(lockBytes);
  // Import discovery below follows this pinned loader's book_load semantics.
  // A compiler upgrade requires reviewing that contract, not guessing at it.
  if (lock.version !== '2.0.25') throw error(`Bend cache does not support compiler version ${lock.version}`, 'BEND_CACHE_VERSION');
  const compilerDirectory = filePath(options.compilerDirectory ?? join(projectRoot, '.tools', `bend-source-${lock.version}`, 'bend2'));
  const main = join(compilerDirectory, 'main.ts');
  if (!existsSync(main)) throw error('Bend is not installed. Run npm run setup from the project folder.', 'BEND_NOT_INSTALLED');
  return { lockFile, lockSha256: hash(lockBytes), version: lock.version, compilerDirectory, main,
    cache: options.cache !== false && process.env.WONKY_BEND_CACHE !== '0',
    cacheDirectory: filePath(options.cacheDirectory ?? join(projectRoot, '.tools', 'bend-js-cache')) };
}

// Preserve the original raw .bend import facility for adapters that have not
// migrated. The persistent cache API below does not compile through this hook.
export async function registerBendImports() {
  registered ??= import(pathToFileURL(configuration({}).main).href);
  await registered;
}

function fileRecord(path, optional = false) {
  try { return { path, real: realpathSync(path), sha256: hash(readFileSync(path)) }; }
  catch (cause) {
    if (optional && cause.code === 'ENOENT') return { path, real: null, sha256: null };
    throw cause;
  }
}

function compilerRecords(directory, seen = new Set()) {
  const real = realpathSync(directory);
  if (seen.has(real)) throw error(`Compiler directory cycle at ${directory}`, 'BEND_CACHE_COMPILER_CYCLE');
  seen.add(real);
  const records = [];
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) records.push(...compilerRecords(path, seen));
    else if (entry.isFile()) records.push(fileRecord(path));
    else throw error(`Unsupported compiler filesystem entry ${path}`, 'BEND_CACHE_COMPILER_ENTRY');
  }
  seen.delete(real);
  return records;
}

// Only foreign JS text can be embedded into the JS compilation. A small lexer
// avoids treating import-shaped text in comments/strings as dependencies. An
// unused, missing foreign file is recorded as absent; the compiler decides
// whether that file is needed, and reports its own failure if it is.
function foreignJsPaths(text, directory) {
  const paths = [];
  let at = 0;
  function space() {
    while (at < text.length) {
      if (/\s/.test(text[at])) { at++; continue; }
      if (text[at] === '#') { while (at < text.length && text[at] !== '\n') at++; continue; }
      break;
    }
  }
  while (at < text.length) {
    space();
    const quote = text[at];
    if (quote === '"' || quote === "'") {
      at++;
      while (at < text.length && text[at] !== quote) { if (text[at] === '\\') at++; at++; }
      at++; continue;
    }
    if (/[A-Za-z_]/.test(text[at] ?? '')) {
      const start = at++;
      while (at < text.length && /[A-Za-z0-9_]/.test(text[at])) at++;
      if (text.slice(start, at) !== 'import') continue;
      space();
      if (text[at] !== '"') continue;
      const begin = ++at;
      // Bend's foreign-path parser reads raw bytes up to the next quote.
      while (at < text.length && text[at] !== '"') at++;
      const target = text.slice(begin, at++);
      if (target.endsWith('.js')) paths.push(resolve(`${directory}/${target}`));
      continue;
    }
    at++;
  }
  return paths;
}

function sourceRecords(entry, base) {
  const records = new Map(), pending = new Set();
  function visit(path) {
    path = resolve(path);
    const real = realpathSync(path);
    if (pending.has(real)) throw error(`Bend import cycle at ${path}`, 'BEND_CACHE_IMPORT_CYCLE');
    if (records.has(path)) return;
    const bytes = readFileSync(path), text = bytes.toString('utf8');
    const record = { path, real, sha256: hash(bytes) };
    records.set(path, record); pending.add(real);
    for (const raw of text.split('\n')) {
      const line = raw.trim(), imported = /^import(\s.*|)$/.exec(line);
      if (imported) {
        const parsed = /^\s+(\S+)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*(?:#.*)?$/.exec(imported[1]);
        if (!parsed || (!parsed[2] && parsed[1] !== 'Base')) {
          throw error(`Invalid Bend import in ${path}: ${line}`, 'BEND_CACHE_IMPORT');
        }
        if (!parsed[2]) visit(base);
        else {
          const target = posix.normalize(parsed[1]);
          if (!target.endsWith('.bend')) throw error(`Expected a .bend import in ${path}: ${line}`, 'BEND_CACHE_IMPORT');
          if (/^0x[0-9a-f]+\//.test(target)) {
            throw error(`Persistent Bend loading requires local imports; hub import ${target} is unsupported`, 'BEND_CACHE_REMOTE_IMPORT');
          }
          visit(target.startsWith('/') ? target : `${dirname(path)}/${target}`);
        }
      } else if (line !== '' && !line.startsWith('#')) break;
    }
    for (const foreign of foreignJsPaths(text, dirname(path))) records.set(foreign, fileRecord(foreign, true));
    pending.delete(real);
  }
  visit(entry);
  // main.ts also checks the presence of this sibling for a PROOF entry, even
  // when the file is not imported. Creating it must invalidate an older hit.
  if (basename(entry) === 'PROOF.bend') {
    const laws = join(dirname(entry), 'LAWS.bend');
    if (!records.has(laws)) records.set(laws, fileRecord(laws, true));
  }
  return [...records.values()].sort((a, b) => a.path.localeCompare(b.path));
}

// The cache key covers only content and relative layout, never absolute paths:
// the emitted JS embeds no paths, so a worktree, a scratch copy or a clean
// checkout with the same bytes reuses the same artifact. Sources are keyed
// relative to the entry's directory, compiler files relative to the compiler.
function portablePath(path, entryDirectory, compilerDirectory) {
  const fromCompiler = relative(compilerDirectory, path);
  if (!fromCompiler.startsWith('..') && !isAbsolute(fromCompiler)) return `compiler:${fromCompiler.split(sep).join('/')}`;
  return relative(entryDirectory, path).split(sep).join('/');
}

// Inverse of portablePath: the absolute file a cache manifest path names, for
// callers that re-hash manifest sources (the focused port tests do).
export function manifestSourcePath(path, entryValue, options = {}) {
  if (path.startsWith('compiler:')) return join(configuration(options).compilerDirectory, ...path.slice(9).split('/'));
  return resolve(dirname(filePath(entryValue)), ...path.split('/'));
}

function fingerprint(entry, config) {
  if (hash(readFileSync(ownSource.path)) !== ownSource.sha256) {
    throw error('Bend cache loader changed in this process; start a fresh process', 'BEND_SOURCES_CHANGED');
  }
  const lockSha256 = hash(readFileSync(config.lockFile));
  if (lockSha256 !== config.lockSha256) throw error('Bend lock changed during loading', 'BEND_SOURCES_CHANGED');
  const compilerFiles = compilerRecords(config.compilerDirectory);
  const compilerIdentity = { version: config.version, directory: realpathSync(config.compilerDirectory),
    lock: { path: config.lockFile, sha256: lockSha256 }, files: compilerFiles,
    node: process.versions.node, platform: process.platform, arch: process.arch };
  const compilerKey = hash(JSON.stringify(compilerIdentity));
  const entryDirectory = dirname(entry);
  const where = path => portablePath(path, entryDirectory, config.compilerDirectory);
  const manifest = { schema, loader: ownSource.sha256, entry: basename(entry),
    compiler: { version: config.version, lock: lockSha256, node: process.versions.node, platform: process.platform, arch: process.arch,
      files: compilerFiles.map(file => ({ path: where(file.path), sha256: file.sha256 })) },
    sources: sourceRecords(entry, join(config.compilerDirectory, 'base.bend'))
      .map(source => ({ path: where(source.path), sha256: source.sha256 }))
      .sort((a, b) => a.path.localeCompare(b.path)) };
  return { key: hash(JSON.stringify(manifest)), compilerKey, manifest };
}

function assertStable(entry, config, expected) {
  if (fingerprint(entry, config).key !== expected.key) {
    throw error(`Bend sources or compiler changed while loading ${entry}; retry with a stable source tree`, 'BEND_SOURCES_CHANGED');
  }
}

function startCompiler(config, identity) {
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { wonkyBendCompiler: true, loader: pathToFileURL(config.main).href },
    // Node refuses process-level heap flags in Worker execArgv. Preserve the
    // parent's heap limit via NODE_OPTIONS, not as a worker CLI option.
    execArgv: process.execArgv.filter((argument, index, arguments_) =>
      argument !== '--input-type' && !argument.startsWith('--input-type=') && arguments_[index - 1] !== '--input-type'
      && argument !== '--max-old-space-size' && !argument.startsWith('--max-old-space-size=')
      && arguments_[index - 1] !== '--max-old-space-size'),
  });
  const state = { worker, identity, next: 0, pending: new Map(), failure: null };
  const fail = cause => {
    state.failure = cause;
    for (const pending of state.pending.values()) pending.reject(cause);
    state.pending.clear(); worker.unref();
  };
  worker.on('message', response => {
    const pending = state.pending.get(response.id);
    if (!pending) return;
    state.pending.delete(response.id);
    if (response.error) pending.reject(Object.assign(new Error(response.error.message), response.error));
    else pending.resolve(response.source);
    if (!state.pending.size) worker.unref();
  });
  worker.on('error', fail);
  worker.on('exit', code => { if (state.pending.size) fail(error(`Bend compiler worker exited with code ${code}`, 'BEND_COMPILER_EXIT')); });
  worker.unref();
  return state;
}

function compileSource(entry, config, identity) {
  // The upstream compiler owns mutable per-compilation state. One worker runs
  // one compilation at a time; another compiler fingerprint gets a fresh realm.
  const request = compilationQueue.then(async () => {
    if (compiler && (compiler.identity !== identity || compiler.failure)) {
      const previous = compiler; compiler = null;
      await previous.worker.terminate();
    }
    compiler ??= startCompiler(config, identity);
    const state = compiler, id = ++state.next;
    return new Promise((resolve, reject) => {
      state.pending.set(id, { resolve, reject }); state.worker.ref();
      state.worker.postMessage({ id, entry: pathToFileURL(entry).href });
    });
  });
  compilationQueue = request.catch(() => {});
  return request;
}

function readArtifact(path, expected) {
  let bytes;
  try { bytes = readFileSync(path, 'utf8'); }
  catch (cause) { if (cause.code === 'ENOENT') return null; throw cause; }
  let artifact;
  try { artifact = JSON.parse(bytes); }
  catch { throw error(`Invalid Bend cache JSON at ${path}; remove it or use WONKY_BEND_CACHE=0`, 'BEND_CACHE_CORRUPT'); }
  if (!artifact || typeof artifact !== 'object' || artifact.schema !== schema || artifact.key !== expected.key ||
      !artifact.manifest || typeof artifact.manifest !== 'object' || hash(JSON.stringify(artifact.manifest)) !== expected.key ||
      typeof artifact.source !== 'string' || artifact.sourceSha256 !== hash(artifact.source)) {
    throw error(`Invalid Bend cache artifact at ${path}; remove it or use WONKY_BEND_CACHE=0`, 'BEND_CACHE_CORRUPT');
  }
  return artifact;
}

function writeArtifact(path, artifact) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${threadId}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(artifact), { flag: 'wx', mode: 0o600 });
    renameSync(temporary, path);
  } finally { rmSync(temporary, { force: true }); }
}

// Returns checked JS text plus cache provenance. It never evaluates geometry.
export async function compileBend(entryValue, options = {}) {
  const entry = realpathSync(filePath(entryValue));
  if (!entry.endsWith('.bend')) throw new TypeError('A Bend entry must end in .bend');
  const config = configuration(options), before = fingerprint(entry, config);
  const cachePath = config.cache ? join(config.cacheDirectory, `${before.key}.json`) : null;
  const cached = cachePath ? readArtifact(cachePath, before) : null;
  if (cached) {
    assertStable(entry, config, before);
    return { source: cached.source, key: before.key, cacheHit: true, cachePath };
  }
  const source = await compileSource(entry, config, before.compilerKey);
  assertStable(entry, config, before);
  if (typeof source !== 'string') throw error('The pinned Bend loader returned no JavaScript source', 'BEND_COMPILER_OUTPUT');
  if (cachePath) writeArtifact(cachePath, { schema, key: before.key, manifest: before.manifest, sourceSha256: hash(source), source });
  return { source, key: before.key, cacheHit: false, cachePath };
}

export async function loadBend(entry, options = {}) {
  const compiled = await compileBend(entry, options);
  // Execute the verified bytes, not a path that another process could replace
  // between verification and Node's module read. Keyed ESM identity also permits
  // explicit API loads of a changed source revision in one process.
  const namespace = await import(`data:text/javascript;base64,${Buffer.from(compiled.source).toString('base64')}#${compiled.key}`);
  return namespace.default;
}

if (!isMainThread && workerData?.wonkyBendCompiler === true) {
  const upstream = await import(workerData.loader);
  parentPort.on('message', async ({ id, entry }) => {
    try {
      const result = await upstream.load(entry, {}, () => { throw new Error('Expected the pinned loader to handle a .bend file'); });
      parentPort.postMessage({ id, source: result.source });
    } catch (cause) {
      parentPort.postMessage({ id, error: { name: cause.name ?? 'Error', message: cause.message ?? String(cause), stack: cause.stack } });
    }
  });
}
