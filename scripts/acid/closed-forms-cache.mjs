// Content cache for the closed-form checker only; live CAD observations are never cached here.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {ROOT, CATALOG, isMain} from './common.mjs';
const checker = root => {
  const current = path.join(root, 'scripts/acid/closed-forms-errata.py');
  return fs.existsSync(current) ? current : path.join(root, 'scripts/acid/closed-forms.py');
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function checked(command, args, cwd) {
  const r = spawnSync(command, args, {cwd, encoding:'utf8', maxBuffer:16 << 20});
  if (r.stderr) process.stderr.write(r.stderr);
  if (r.error || r.status !== 0) throw r.error ?? new Error(`${command} failed (${r.status}): ${r.stdout}`);
  return r.stdout.trim();
}
export function closedFormIdentity(root = ROOT, catalog = CATALOG) {
  const python = checked('uv', ['python', 'find', '>=3.11'], root);
  const probe = path.join(root, 'scripts/acid/closed-form-inputs.py');
  const entry = path.join(root, 'scripts/acid/closed-forms.py');
  const inputs = JSON.parse(checked(python, [probe, root, entry], root));
  const currentInputs = JSON.parse(checked(python, [probe, root, checker(root)], root));
  const files = new Set([...inputs.files, ...currentInputs.files, path.relative(root, probe), path.relative(root, catalog)]);
  // Structural checks read the frozen history as well as the requested catalog.
  const history = path.join(root, 'fixtures/cad-acid/catalog-history');
  if (fs.existsSync(history)) for (const name of fs.readdirSync(history).sort()) if (name.endsWith('.json')) files.add(path.relative(root, path.join(history, name)));
  for (const name of ['pyproject.toml', 'uv.lock', 'uv.toml', 'scripts/acid/closed-forms.py.lock']) {
    for (let dir = path.dirname(entry); ; dir = path.dirname(dir)) {
      const file = path.join(dir, name);
      if (fs.existsSync(file)) files.add(path.relative(root, file));
      if (dir === root) break;
    }
  }
  const records = [...files].sort().map(name => [name, hash(fs.readFileSync(path.resolve(root, name)))]);
  return {key:hash(JSON.stringify({schema:1, python:inputs.python, records})), python, records};
}
function inventory(dir) {
  const files = {};
  function walk(base, rel = '') {
    for (const entry of fs.readdirSync(base, {withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const name = path.join(rel, entry.name);
      if (entry.isDirectory()) walk(path.join(base, entry.name), name);
      else if (entry.isFile()) files[name] = hash(fs.readFileSync(path.join(base, entry.name)));
      else throw new Error('CACHE_NONREGULAR_FILE');
    }
  }
  walk(dir);
  return files;
}
function valid(entry, key) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(entry, 'manifest.json')));
    return manifest.key === key && manifest.result.ok === true &&
      JSON.stringify(inventory(path.join(entry, 'files'))) === JSON.stringify(manifest.files);
  } catch { return false; }
}
// Serialize readers and writers per key; dead process locks are reclaimed.
function lock(file) {
  const until = Date.now() + 5 * 60 * 60 * 1000;
  for (;;) {
    try { fs.writeFileSync(file, String(process.pid), {flag:"wx"}); return; }
    catch (error) { if (error.code !== "EEXIST") throw error; }
    try {
      const pid = Number(fs.readFileSync(file, "utf8"));
      if (pid > 0) {
        try { process.kill(pid, 0); }
        catch (error) { if (error.code === "ESRCH") { fs.unlinkSync(file); continue; } }
      } else if (Date.now() - fs.statSync(file).mtimeMs > 30000) { fs.unlinkSync(file); continue; }
    } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (Date.now() >= until) throw new Error("CLOSED_FORMS_CACHE_LOCK_TIMEOUT");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}
export function cachedClosedForms({root = ROOT, catalog = CATALOG, out, execute, timeout = 180, identity = closedFormIdentity(root, catalog)}) {
  const {key, python} = identity;
  const cache = path.join(root, 'tmp/acid-cache/closed-forms');
  const entry = path.join(cache, key);
  fs.mkdirSync(cache, {recursive:true});
  const lockFile = `${entry}.lock`;
  lock(lockFile);
  try {
  function reuse() {
    const manifest = JSON.parse(fs.readFileSync(path.join(entry, 'manifest.json')));
    fs.rmSync(out, {recursive:true, force:true});
    fs.cpSync(path.join(entry, 'files'), out, {recursive:true});
    console.log(`CLOSED_FORMS_REUSED ${key}`);
    return {...manifest.result, reused:true, cacheKey:key};
  }
  if (valid(entry, key)) return reuse();
  fs.rmSync(out, {recursive:true, force:true});
  const result = execute('uv', ['run', '--python', python, checker(root), '--zones', catalog], out, Math.max(90, timeout));
  if (!result.ok) return {...result, reused:false, cacheKey:key};
  const temp = path.join(cache, `${key}.tmp-${process.pid}-${randomUUID()}`);
  try {
    fs.mkdirSync(temp);
    fs.cpSync(out, path.join(temp, 'files'), {recursive:true});
    fs.writeFileSync(path.join(temp, 'manifest.json'), JSON.stringify({key, files:inventory(path.join(temp, 'files')), result}));
    // Retire corrupt entries by rename, never delete a concurrently published winner.
    if (fs.existsSync(entry) && !valid(entry, key)) {
      const retired = `${temp}.corrupt`;
      try { fs.renameSync(entry, retired); fs.rmSync(retired, {recursive:true, force:true}); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    try { fs.renameSync(temp, entry); }
    catch (error) { if (!['EEXIST', 'ENOTEMPTY'].includes(error.code) || !valid(entry, key)) throw error; }
  } finally { fs.rmSync(temp, {recursive:true, force:true}); }
  return {...result, reused:false, cacheKey:key};
  } finally { fs.unlinkSync(lockFile); }
}
if (isMain(import.meta.url)) {
  const out = path.join(ROOT, 'out/closed-forms-warm');
  const execute = (command, args, dir, timeout) => {
    fs.mkdirSync(dir, {recursive:true});
    const r = spawnSync(command, args, {cwd:ROOT, encoding:'utf8', timeout:timeout*1000, maxBuffer:16 << 20});
    if (r.stderr) process.stderr.write(r.stderr);
    fs.writeFileSync(path.join(dir, 'command.log'), `$ ${[command,...args].join(' ')}\nstatus=${r.status} signal=${r.signal} error=${r.error?.message??''}\n--- stdout\n${r.stdout??''}\n--- stderr\n${r.stderr??''}`);
    return {ok:r.status===0&&!r.error, status:r.status, signal:r.signal, error:r.error?.message, stderrTail:r.stderr?.trim().split('\n').slice(-4)};
  };
  if (!cachedClosedForms({out, execute}).ok) process.exitCode = 1;
}
