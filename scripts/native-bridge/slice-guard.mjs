// Evidence preload for the native slice: records every module URL this process
// resolves and loads, plus every process.dlopen, so a run can prove it never
// loaded the Bend JS kernel (no data: module, no Bend compiler main.ts, no
// .bend import). It changes nothing it observes.
//
//   WONKY_SLICE_GUARD_LOG=<file.json> node --import ./scripts/native-bridge/slice-guard.mjs bin/wonky.mjs ...
//
// The log is written at exit: { urls: [{kind, url, ms}], dlopen: [...], summary }.
// summary.jsKernel is true when any of the three markers appeared.
import { registerHooks } from 'node:module';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const out = process.env.WONKY_SLICE_GUARD_LOG;
if (!out) throw new Error('slice-guard: WONKY_SLICE_GUARD_LOG must name the output file');
const events = [], dlopen = [];
const short = url => url.startsWith('data:') ? `${url.slice(0, 48)}...(${url.length} chars)` : url;
const isData = url => url.startsWith('data:');
const isCompiler = url => /\/bend2\/main\.ts$/.test(url.split('?')[0]);
const isBend = url => /\.bend([?#].*)?$/.test(url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    events.push({ kind: 'resolve', url: short(result.url), ms: performance.now(), data: isData(result.url), compiler: isCompiler(result.url), bend: isBend(result.url) });
    return result;
  },
  load(url, context, nextLoad) {
    events.push({ kind: 'load', url: short(url), ms: performance.now(), data: isData(url), compiler: isCompiler(url), bend: isBend(url) });
    return nextLoad(url, context);
  },
});

const original = process.dlopen;
process.dlopen = function guardedDlopen(module, filename, ...rest) {
  dlopen.push({ filename, ms: performance.now() });
  return original.call(this, module, filename, ...rest);
};

process.on('exit', code => {
  const summary = {
    exitCode: code, modules: events.filter(e => e.kind === 'load').length,
    dataUrls: events.filter(e => e.data).length, compiler: events.filter(e => e.compiler).length, bendImports: events.filter(e => e.bend).length,
    addons: dlopen.map(d => d.filename),
  };
  summary.jsKernel = summary.dataUrls > 0 || summary.compiler > 0 || summary.bendImports > 0;
  writeFileSync(out, JSON.stringify({ schema: 'wonky-slice-guard/1', argv: process.argv.slice(1), env: { WONKY_BACKEND: process.env.WONKY_BACKEND ?? null }, summary, dlopen, urls: events }, null, 1) + '\n');
});
