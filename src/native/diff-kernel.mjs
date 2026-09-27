// WONKY_BACKEND=diff: every slice entry runs on both targets. The request is
// encoded once with the generated codec and sent to the native addon; the JS
// target (loadJsKernel(), the reference) runs the same entry on the original
// arguments and its result is encoded with the same generated encoder. The two
// replies must agree word for word; the first differing word raises
// BackendDivergenceError and the request and both replies are dumped under
// tmp/native-bridge/divergence/ (WONKY_DIVERGENCE_DIR overrides). Entries
// outside the native build refuse exactly as on WONKY_BACKEND=native.
// loadKernel().hybrid runs in the wonky-hybrid subprocess and on the JS
// target's stages; corefine's text, the answer and the carrier classes must
// agree character for character (src/native/hybrid-process.mjs).
//
// A divergence can never end in success: it is sticky (every later slice call
// of this process throws the same BackendDivergenceError), frontends treat it
// as run-ending (errors.mjs endsRun), and if a host still catches it and is
// about to exit 0, the exit code becomes 1 with the divergence on stderr.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { BackendDivergenceError, NativeKernelError } from './errors.mjs';
import { compatKernel, openNativeBackend, projectRoot, registerExportOps, writeTraceAtExit, TARGET } from './native-kernel.mjs';
import { budgetSeconds, hybridNamespace, hybridStats } from './hybrid-process.mjs';

export const defaultDivergenceDir = () => process.env.WONKY_DIVERGENCE_DIR ?? join(projectRoot, 'tmp/native-bridge/divergence');

// Names the field that reply word `target` (0-based, status word excluded)
// belongs to, by walking the words along the wire type (wire.json).
export function fieldPathAt(wireManifest, type, words, target) {
  const adts = new Map(wireManifest.adts.map(adt => [adt.type, adt]));
  let i = 0, found = null;
  const visit = (t, path) => {
    if (found !== null) return;
    let m;
    if (t === 'U32' || t === 'F32' || t === 'Bool') {
      if (i === target) found = `${path} (${t})`;
      i += 1;
      return;
    }
    if (t === 'String' || (m = /^(List|Maybe)<(.*)>$/.exec(t))) {
      const head = words[i];
      if (i === target) { found = `${path}${t === 'String' ? '.length' : m[1] === 'List' ? '.length' : '.tag'}`; return; }
      i += 1;
      if (t === 'String') {
        if (target < i + head) found = `${path}[${target - i}] (Char)`;
        i += head;
      } else if (m[1] === 'List') {
        for (let k = 0; k < head && found === null && i < words.length; k += 1) visit(m[2], `${path}[${k}]`);
      } else if (head === 1) visit(m[2], `${path}.value`);
      return;
    }
    const adt = adts.get(t);
    if (!adt) { found = `${path} (type ${t} not in wire.json)`; return; }
    let ctor = adt.constructors[0];
    if (adt.tagged) {
      if (i === target) { found = `${path}.$ (constructor tag of ${t})`; return; }
      ctor = adt.constructors[words[i]];
      i += 1;
      if (!ctor) { found = `${path} (invalid ${t} tag)`; return; }
    }
    for (const field of ctor.fields) visit(field.type, `${path}${adt.tagged ? `<${ctor.name}>` : ''}.${field.name}`);
  };
  visit(type, 'result');
  return found ?? `past the end of the ${type} value (${i} words)`;
}

const bytesOf = words => Buffer.from(words.buffer, words.byteOffset, words.byteLength);

// Compares [status, ...result] replies word for word. Returns the number of
// compared words, or throws BackendDivergenceError after writing the dump.
export function compareReplies({ op, request, nativeReply, jsReply, wireManifest, sourceHash, dumpDir = defaultDivergenceDir() }) {
  const n = Math.max(nativeReply.length, jsReply.length);
  let at = -1;
  for (let k = 0; k < n; k += 1) if (nativeReply[k] !== jsReply[k]) { at = k; break; }
  if (at < 0) return n;
  const resultType = wireManifest.ops[op.id].result;
  const fieldPath = at === 0 ? 'status' : fieldPathAt(wireManifest, resultType, jsReply.subarray(1), at - 1);
  const dump = join(dumpDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-op${op.id}-${process.pid}`);
  mkdirSync(dump, { recursive: true });
  writeFileSync(join(dump, 'request.u32'), bytesOf(request));
  writeFileSync(join(dump, 'reply-native.u32'), bytesOf(nativeReply));
  writeFileSync(join(dump, 'reply-js.u32'), bytesOf(jsReply));
  writeFileSync(join(dump, 'meta.json'), JSON.stringify({ op: op.id, entry: op.entry, label: op.label, resultType, wordIndex: at, fieldPath,
    nativeWord: nativeReply[at] ?? null, jsWord: jsReply[at] ?? null, nativeWords: nativeReply.length, jsWords: jsReply.length,
    sourceHash, format: 'little-endian U32 words; request = arguments, replies = [status, ...result]' }, null, 1) + '\n');
  throw new BackendDivergenceError({ op: op.id, entry: op.entry, wordIndex: at, fieldPath, nativeWord: nativeReply[at], jsWord: jsReply[at], dump });
}

// Last line of defence: a host that caught a divergence must not exit 0.
function armExitGuard(divergence) {
  process.on('exit', code => {
    if (!divergence.first || code !== 0) return;
    process.stderr.write(`wonky diff backend: ${divergence.count} divergence(s) between the native build and the JS target were raised and caught; ` +
      `exiting 1. First: ${divergence.first.message}\n`);
    process.exitCode = 1;
  });
}

export async function openDiffKernel(options = {}) {
  const backend = await openNativeBackend(options);
  const { manifest, wire, wireManifest } = backend;
  const { loadJsKernel } = await import('../kernel.mjs');
  const js = await loadJsKernel();
  // The export-scope ops' reference: the two STEP pcurve modules as src/exporters.mjs loads them on js.
  const jsExports = manifest.ops.some(op => op.scope === 'export') ? await (async () => {
    const [{ loadStepPCurves }, { loadStepCylinderPCurves }] = await Promise.all([import('../step-pcurves.mjs'), import('../step-cylinder-pcurves.mjs')]);
    const [stepPCurves, stepCylinderPCurves] = await Promise.all([loadStepPCurves(), loadStepCylinderPCurves()]);
    return { stepPCurves, stepCylinderPCurves };
  })() : {};
  const stats = Object.fromEntries(manifest.ops.map(op => [op.label, { entry: op.entry, op: op.id, calls: 0, compared: 0, words: 0,
    divergences: 0, encodeMs: 0, nativeMs: 0, jsMs: 0, jsEncodeMs: 0, decodeMs: 0 }]));
  const divergence = { first: null, count: 0 };
  armExitGuard(divergence);
  const member = op => {
    const codec = wire.ops[op.id], result = wire.codecs[codec.result], stat = stats[op.label];
    const target = op.scope === 'export' ? jsExports[op.namespace]?.[op.key] : op.namespace ? js[op.namespace]?.[op.key] : js[op.key];
    if (typeof target !== 'function' || !result) throw new NativeKernelError('BX_ABI', `the JS target has no ${op.label} (${op.entry}) or no codec for ${codec.result}`);
    return function diffEntry(...args) {
      if (divergence.first) throw divergence.first;
      const t0 = performance.now();
      let request;
      try { request = codec.encode(args); }
      catch (error) { throw new NativeKernelError('BX_ARGS', `${op.entry} (kernel.${op.label}): the arguments do not fit the wire: ${error.message}`, { op: op.id, entry: op.entry, cause: error }); }
      const t1 = performance.now();
      const nativeReply = backend.call(op.id, request);
      const t2 = performance.now();
      const value = target(...args);
      const t3 = performance.now();
      let jsReply;
      try {
        const words = result.encode(value);
        jsReply = new Uint32Array(words.length + 1);
        jsReply.set(words, 1);
      } catch (error) {
        throw new NativeKernelError('BX_WIRE', `${op.entry}: the JS target's result is not wire-encodable: ${error.message}`, { op: op.id, entry: op.entry, cause: error });
      }
      const t4 = performance.now();
      try { stat.words += compareReplies({ op, request, nativeReply, jsReply, wireManifest, sourceHash: manifest.sourceHash }); }
      catch (error) {
        if (error instanceof BackendDivergenceError) { stat.divergences += 1; divergence.count += 1; divergence.first ??= error; }
        throw error;
      }
      stat.compared += 1;
      let decoded;
      try { decoded = codec.decode(nativeReply); }
      catch (error) { throw new NativeKernelError('BX_WIRE', `${op.entry}: the native reply does not decode: ${error.message}`, { op: op.id, entry: op.entry, cause: error }); }
      const t5 = performance.now();
      stat.calls += 1; stat.encodeMs += t1 - t0; stat.nativeMs += t2 - t1; stat.jsMs += t3 - t2; stat.jsEncodeMs += t4 - t3; stat.decodeMs += t5 - t4;
      return decoded;
    };
  };
  const hybrid = manifest.hybrid ? hybridNamespace({ backend: 'diff', binary: join(backend.dir, manifest.hybrid.file), threads: backend.threads,
    budgetS: budgetSeconds(), sourceHash: manifest.sourceHash, js: js.hybrid, divergence, dumpDir: defaultDivergenceDir(), stats: hybridStats() }) : null;
  registerExportOps(manifest, member);
  const kernel = compatKernel({ manifest, backend: 'diff', member, hosted: hybrid?.hosted });
  const trace = () => ({ schema: 'wonky-native-trace/1', backend: 'diff', set: manifest.set, sourceHash: manifest.sourceHash,
    threads: backend.threads, pid: process.pid, open: backend.open, exitAt: performance.now(),
    divergences: divergence.count, firstDivergence: divergence.first && { op: divergence.first.op, entry: divergence.first.entry, wordIndex: divergence.first.wordIndex, dump: divergence.first.dump },
    entries: stats, hybrid: hybrid?.stats ?? null, stats: backend.addon.stats() });
  if (process.env.WONKY_NATIVE_TRACE) writeTraceAtExit(process.env.WONKY_NATIVE_TRACE, trace);
  return { kernel, backend: { ...backend, info: { ...backend.info, target: TARGET.diff } }, stats, trace };
}
