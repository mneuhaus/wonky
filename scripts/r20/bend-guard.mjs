// Preload of the R20 module gate (scripts/r20/modules.mjs): records whether
// this process used the Bend kernel in any form, so a module run on
// WONKY_BACKEND=rust can be rejected when Bend answered any part of it
// (docs/rust-migration.md 3.4, item 5). It changes nothing it observes.
//
//   WONKY_BEND_GUARD_LOG=<file.json> node --import ./scripts/r20/bend-guard.mjs bin/wonky.mjs ...
//
// Bend markers (the same three as scripts/native-bridge/slice-guard.mjs for
// the JS target, plus the native Bend build):
//   data-url        a data: module (src/bend-loader.mjs loadBend evaluates the
//                   compiled Bend JS as one; nothing else on the CLI path does)
//   bend-import     a .bend module URL
//   bend-compiler   the Bend compiler's main.ts
//   bend-native     process.dlopen of wonky-kernel.node, or a dlopen or child
//                   process (spawn/spawnSync/execFile/execFileSync) of a file
//                   under the Bend native build cache (WONKY_NATIVE_CACHE or
//                   tmp/native-bridge/cache: the addon and wonky-hybrid)
// The log is written at exit: { summary: { bendLoaded, markers }, events }.
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import { realpathSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = process.env.WONKY_BEND_GUARD_LOG;
if (!out) throw new Error('bend-guard: WONKY_BEND_GUARD_LOG must name the output file');
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const nativeCache = resolve(process.env.WONKY_NATIVE_CACHE ?? join(root, 'tmp/native-bridge/cache'));
const events = [], markers = { 'data-url': 0, 'bend-import': 0, 'bend-compiler': 0, 'bend-native': 0 };
let modules = 0;
const note = (kind, what) => { markers[kind]++; if (events.length < 200) events.push({ kind, what: what.length > 160 ? `${what.slice(0, 160)}...(${what.length} chars)` : what }); };
const real = file => { try { return realpathSync(file); } catch { return resolve(String(file)); } };
const inNativeCache = file => real(file).startsWith(nativeCache + sep);

registerHooks({
  load(url, context, nextLoad) {
    modules++;
    const bare = url.split(/[?#]/)[0];
    if (url.startsWith('data:')) note('data-url', url);
    else if (bare.endsWith('.bend')) note('bend-import', url);
    else if (/\/bend2\/main\.ts$/.test(bare)) note('bend-compiler', url);
    return nextLoad(url, context);
  },
});

const dlopen = process.dlopen, addons = [];
process.dlopen = function guardedDlopen(module, filename, ...rest) {
  addons.push(filename);
  if (basename(filename) === 'wonky-kernel.node' || inNativeCache(filename)) note('bend-native', `dlopen ${filename}`);
  return dlopen.call(this, module, filename, ...rest);
};
for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
  const original = childProcess[name];
  childProcess[name] = function guardedChild(file, ...rest) {
    if (typeof file === 'string' && inNativeCache(file)) note('bend-native', `${name} ${file}`);
    return original.call(this, file, ...rest);
  };
  // Keep util.promisify(execFile) resolving to { stdout, stderr }.
  for (const symbol of Object.getOwnPropertySymbols(original)) childProcess[name][symbol] = original[symbol];
}
syncBuiltinESMExports();

// The in-process Acid scorer needs the same check before awarding any points,
// not just an exit-time file that could be rewritten by another process.
export function guardSummary() {
  return {modules, markers:{...markers}, addons:[...addons], bendLoaded:Object.values(markers).some(n => n > 0)};
}
process.on('exit', code => {
  writeFileSync(out, JSON.stringify({ schema: 'wonky/bend-guard/1', argv: process.argv.slice(1), backend: process.env.WONKY_BACKEND ?? null,
    summary: {exitCode:code, ...guardSummary()}, events }, null, 1) + '\n');
});
