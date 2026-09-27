#!/usr/bin/env node
// Attributes wonky CPU profiles (node --cpu-prof) to cost buckets, maps the
// Bend-emitted JS back to Bend definitions, merges the host -> kernel call
// counts and computes Amdahl bounds for a native kernel binding.
//
//   node --max-old-space-size=12000 scripts/native-bridge/analyze-profiles.mjs [--only id,id]
//
// Inputs (all produced by scripts/native-bridge/profile-workloads.mjs):
//   out/native-bridge/profile/cpuprofiles/<id>.cpuprofile   sampled CPU profile
//   out/native-bridge/profile/calls/<id>.json               host -> kernel call counts
//   out/native-bridge/profile/runs.json                     wall/user/RSS + uptime load
//   out/native-bridge/profile/startup-phases.json           optional, startup-phases.mjs
//   .tools/bend-js-cache/*.json                             emitted JS -> Bend definitions
// Outputs:
//   out/native-bridge/profile/summary.json                  compact, per workload + aggregate
//   out/native-bridge/profile/analysis/<id>.json            full per-workload detail
//
// Attribution rules (each sample is one node = one unique call stack):
//   * (garbage collector), (idle), (program) are V8 pseudo frames.
//   * Any frame of a data: module (Bend-emitted JS) that is not the module's
//     top-level body makes the sample `kernel`. Its self time goes to the
//     nearest Bend definition; its host caller is the project frame just above
//     the outermost Bend frame.
//   * Otherwise the nearest (leaf-most) meaningful frame decides: a project
//     file maps through `fileBuckets`; ESM loader internals are `moduleLoading`
//     unless they run under src/bend-loader.mjs; data: URL decoding, the
//     TypeScript stripper (Bend compiler main.ts), the ESM hooks worker that
//     main.ts registers, and .tools/ are `bendLoad`.
//   * GC samples are also re-attributed to the bucket of the preceding non-GC
//     sample (`bucketsGcAttributed`), a heuristic stated in the report.
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { workloads } from './profile-workloads.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const profileDirectory = join(root, 'out/native-bridge/profile');
const analysisDirectory = join(profileDirectory, 'analysis');
const cacheDirectory = join(root, '.tools/bend-js-cache');
const rootUrl = 'file://' + root;
const rel = path => relative(root, path);

export const bucketOrder = ['processStart', 'moduleLoading', 'bendLoad', 'frontendParse', 'interpreter', 'kernel',
  'hostAdaptation', 'export', 'gc', 'program', 'idle', 'nodeRuntime', 'other'];
export const bucketTitles = {
  processStart: 'Node bootstrap', moduleLoading: 'ESM module loading (src/bin graph)',
  bendLoad: 'Bend JS cache load (fingerprint, read, decode, evaluate)', frontendParse: 'FS parse / Python bridge (JS side)',
  interpreter: 'Interpreter evaluation (excl. kernel)', kernel: 'Bend kernel execution (emitted JS)',
  hostAdaptation: 'Host adaptation (encode/decode, validate, identity, history, queries)', export: 'Export, print mesh, CLI output',
  gc: 'Garbage collection', program: 'V8 native, unattributed ((program))', idle: 'Idle (I/O, Python subprocess wait)',
  nodeRuntime: 'Node runtime without project frame', other: 'Other',
};

// Project file -> [bucket, sub-bucket]. Functions named load<Name> in glue files are Bend loading.
const fileBuckets = {
  'src/bend-loader.mjs': ['bendLoad', 'bend-loader.mjs (fingerprint, cache read, import)'],
  'src/parser.mjs': ['frontendParse', 'FeatureScript parser'],
  'src/python.mjs': ['frontendParse', 'Python bridge (JSON lines, session)'],
  'src/interpreter.mjs': ['interpreter', 'interpreter.mjs'], 'src/library.mjs': ['interpreter', 'library.mjs (std builtins)'],
  'src/values.mjs': ['interpreter', 'values.mjs'], 'src/scalars.mjs': ['interpreter', 'scalars.mjs'],
  'src/modules.mjs': ['interpreter', 'modules.mjs'], 'src/errors.mjs': ['interpreter', 'errors.mjs'],
  'src/index.mjs': ['interpreter', 'index.mjs (build driver)'], 'src/modeling-policy.mjs': ['interpreter', 'modeling-policy.mjs'],
  'src/source-map.mjs': ['interpreter', 'source-map.mjs (model trace)'],
  'src/kernel.mjs': ['hostAdaptation', 'kernel.mjs (list/array/vector/decodeSolid)'],
  'src/real.mjs': ['hostAdaptation', 'real.mjs (Real/V3 encoders)'], 'src/brep.mjs': ['hostAdaptation', 'brep.mjs (validateSolid)'],
  'src/identity.mjs': ['hostAdaptation', 'identity.mjs (topology identity)'],
  'src/construction-history.mjs': ['hostAdaptation', 'construction-history.mjs'], 'src/queries.mjs': ['hostAdaptation', 'queries.mjs (walk decoded bodies)'],
  'src/geometry-summary.mjs': ['export', 'geometry-summary.mjs'],
  'src/exporters.mjs': ['export', 'exporters.mjs (STEP/STL text)'], 'src/preview.mjs': ['export', 'preview.mjs (HTML)'],
  'src/print-mesh.mjs': ['export', 'print-mesh.mjs'], 'src/display-export.mjs': ['export', 'display-export.mjs'],
  'src/display-cylinder.mjs': ['export', 'display-cylinder.mjs'], 'src/step-pcurves.mjs': ['export', 'step-pcurves.mjs'],
  'src/step-cylinder-pcurves.mjs': ['export', 'step-cylinder-pcurves.mjs'], 'src/render-publication.mjs': ['export', 'render-publication.mjs'],
  'src/review-scene.mjs': ['export', 'review-scene.mjs'], 'src/review-server.mjs': ['export', 'review-server.mjs'],
};
// loadKernel() runs its module loads inside an anonymous async IIFE.
const kernelSourceLines = readFileSync(join(root, 'src/kernel.mjs'), 'utf8').split('\n');
const loadKernelStart = kernelSourceLines.findIndex(line => line.startsWith('export function loadKernel'));
const loadKernelEnd = kernelSourceLines.findIndex((line, i) => i > loadKernelStart && line.startsWith('export '));
const glueBucket = file => file.startsWith('src/') ? ['hostAdaptation', `${file.slice(4)} (kernel glue)`] : null;

// ---------------------------------------------------------------- Bend artifacts
let artifacts;
function loadArtifacts() {
  if (artifacts) return artifacts;
  artifacts = [];
  for (const file of readdirSync(cacheDirectory)) {
    if (!file.endsWith('.json')) continue;
    const path = join(cacheDirectory, file);
    let artifact;
    try { artifact = JSON.parse(readFileSync(path, 'utf8')); } catch { continue; }
    if (typeof artifact?.source !== 'string' || !artifact.manifest?.entry) continue;
    const lines = artifact.source.split('\n'), starts = [], exportsByName = new Map();
    for (let i = 0; i < lines.length; i++) {
      const fn = /^function (\S+?)\(/.exec(lines[i]);
      if (fn) starts.push({ line: i, name: fn[1] });
      const exported = /^ {2}("(?:[^"\\]|\\.)*"): run_lib\((\S+?), \d+\),$/.exec(lines[i]);
      if (exported) exportsByName.set(exported[2], JSON.parse(exported[1]));
    }
    artifacts.push({ key: artifact.key, entry: artifact.manifest.entry, mtime: statSync(path).mtimeMs, lines, starts, exportsByName,
      defs: new Map() });
  }
  return artifacts;
}

const runtimeNames = new Set(['word_to_u32', 'u32_to_word', 'cmp_new', 'nat_divmod', 'nat_chk', 'f32_show', 'f32_bits', 'f32_from_bits',
  'f32_read', 'char_new', 'array_new', 'array_node', 'array_rmw', 'run_jump', 'run_tail', 'run_clo', 'run_loop', 'run_lib']);

// Top-level JS function name -> Bend definition { file, def }.
function bendDefinition(artifact, name) {
  let def = artifact.defs.get(name);
  if (def) return def;
  const key = artifact.exportsByName.get(name);
  if (runtimeNames.has(name) || !name.startsWith('$')) def = { file: 'bend-js-runtime', def: name };
  else if (key !== undefined) {
    // Keys look like "union", "geometry.add" or "../real.add": a path relative
    // to the entry directory, then the definition name.
    const dot = key.lastIndexOf('.');
    if (dot > 0) {
      const file = resolve(dirname(artifact.entry), key.slice(0, dot) + '.bend');
      def = { file: existsSync(file) ? rel(file) : `unresolved:${key.slice(0, dot)}`, def: key.slice(dot + 1) };
    } else def = { file: rel(artifact.entry), def: key };
  } else {
    const segments = name.split('$').filter(Boolean);
    def = /^[A-Z]/.test(segments[0] ?? '') ? { file: 'Base (bend2/base.bend)', def: segments.join('/') } : { file: 'unmapped', def: name };
  }
  artifact.defs.set(name, def);
  return def;
}

function enclosing(artifact, line) {
  const { starts } = artifact;
  let lo = 0, hi = starts.length - 1, found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid].line <= line) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found < 0 ? null : starts[found].name;
}

function matchScripts(nodes, preferredKeys) {
  const frames = new Map();
  for (const node of nodes) {
    const frame = node.callFrame;
    if (!frame.url.startsWith('data:text/javascript')) continue;
    let entry = frames.get(frame.scriptId);
    if (!entry) frames.set(frame.scriptId, entry = new Map());
    if (/^[$A-Za-z_][\w$]*$/.test(frame.functionName)) entry.set(`${frame.functionName}@${frame.lineNumber}`, frame);
  }
  const result = new Map();
  for (const [scriptId, named] of frames) {
    let best = null;
    if (named.size) {
      for (const artifact of loadArtifacts()) {
        let hits = 0;
        for (const frame of named.values()) {
          if (artifact.lines[frame.lineNumber]?.includes(`function ${frame.functionName}(`)) hits++;
        }
        const score = [hits, preferredKeys.has(artifact.key) ? 1 : 0, artifact.mtime];
        if (!best || score[0] > best.score[0] || (score[0] === best.score[0] &&
            (score[1] > best.score[1] || (score[1] === best.score[1] && score[2] > best.score[2])))) best = { artifact, score };
      }
    }
    result.set(scriptId, best && best.score[0] === named.size
      ? { artifact: best.artifact, entry: rel(best.artifact.entry), named: named.size, matched: best.score[0] }
      : { artifact: null, entry: named.size ? 'unmatched' : 'module-body-only', named: named.size, matched: best?.score[0] ?? 0 });
  }
  return result;
}

// ---------------------------------------------------------------- profile analysis
const special = new Set(['(root)', '(program)', '(idle)', '(garbage collector)']);
const isModuleBody = frame => frame.functionName === '' && frame.lineNumber === 0 && frame.columnNumber === 0;

function projectBucket(file, fn, frame) {
  if (file.startsWith('.tools/')) return ['bendLoad', 'Bend compiler main.ts import (.tools)'];
  if (file.startsWith('bin/')) return isModuleBody(frame) || fn === '' ? ['export', `${file} (CLI body: serialize + write)`] : ['export', file];
  if (isModuleBody(frame)) return ['moduleLoading', 'src module body evaluation'];
  if (file === 'src/kernel.mjs' && frame.lineNumber >= loadKernelStart && frame.lineNumber < loadKernelEnd) return ['bendLoad', 'kernel.mjs loadKernel'];
  const mapped = fileBuckets[file] ?? glueBucket(file) ?? ['other', file];
  if (/^load[A-Z]\w*$/.test(fn) && ['hostAdaptation', 'export'].includes(mapped[0])) return ['bendLoad', `${file} ${fn}`];
  return mapped;
}

function classifyInternal(url) {
  if (url.startsWith('node:internal/data_url')) return ['bendLoad', 'data: URL decode of Bend modules'];
  if (url.startsWith('node:internal/modules/typescript') || url.startsWith('node:internal/deps/amaro') || url.startsWith('wasm://')) {
    return ['bendLoad', 'TypeScript strip of Bend compiler main.ts'];
  }
  // Customization hooks exist only because registerBendImports() imports the
  // Bend compiler main.ts, which registers them; every later import pays a
  // round trip to the hooks worker thread.
  if (url.startsWith('node:internal/modules/esm/hooks')) return ['bendLoad', 'ESM hooks worker round trips (registered by Bend main.ts)'];
  if (url.startsWith('node:internal/modules/')) return ['moduleLoading', 'ESM loader'];
  if (url.startsWith('node:internal/main/') || url.startsWith('node:internal/bootstrap/') || url.startsWith('node:internal/process/pre_execution')) {
    return ['processStart', 'Node bootstrap'];
  }
  return null;
}

function frameLabel(frame, script) {
  const name = frame.functionName || '(anonymous)';
  if (frame.url.startsWith('data:')) {
    if (script?.artifact) {
      const outer = enclosing(script.artifact, frame.lineNumber);
      const def = outer ? bendDefinition(script.artifact, outer) : { file: script.entry, def: '(module body)' };
      return `${def.file}:${def.def}${outer && outer !== frame.functionName ? ` [${name}]` : ''}`;
    }
    return `bend:${script?.entry ?? '?'}:${name}@${frame.lineNumber + 1}`;
  }
  if (frame.url.startsWith(rootUrl)) return `${frame.url.slice(rootUrl.length)}:${name}:${frame.lineNumber + 1}`;
  return `${frame.url || '(native)'}:${name}${frame.lineNumber >= 0 ? `:${frame.lineNumber + 1}` : ''}`;
}

const add = (map, key, value) => map.set(key, (map.get(key) ?? 0) + value);
const top = (map, n, total) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n)
  .map(([name, us]) => ({ name, ms: +(us / 1000).toFixed(2), share: +(us / total).toFixed(4) }));

export function analyzeProfile(path, preferredKeys = new Set()) {
  const profile = JSON.parse(readFileSync(path, 'utf8'));
  const { nodes, samples, timeDeltas } = profile;
  const index = new Map(nodes.map((node, i) => [node.id, i]));
  const count = nodes.length;
  const scripts = matchScripts(nodes, preferredKeys);

  // Sample weights: V8 timeDeltas[i] is the gap before sample i, so sample i
  // lasts until sample i + 1. The last sample gets the median gap.
  const gaps = timeDeltas.slice(1).filter(d => d > 0).sort((a, b) => a - b);
  const medianGap = gaps.length ? gaps[gaps.length >> 1] : 0;
  const selfUs = new Float64Array(count);
  const sampleIndex = new Int32Array(samples.length), sampleWeight = new Float64Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const w = Math.max(0, i + 1 < timeDeltas.length ? timeDeltas[i + 1] : medianGap);
    sampleIndex[i] = index.get(samples[i]); sampleWeight[i] = w; selfUs[sampleIndex[i]] += w;
  }

  // Top-down pass: per node bucket, sub-bucket and kernel context.
  const strings = [], stringIds = new Map();
  const intern = s => { let id = stringIds.get(s); if (id === undefined) { id = strings.length; strings.push(s); stringIds.set(s, id); } return id; };
  const bucketOf = new Uint8Array(count), subOf = new Int32Array(count).fill(-1);
  const kernelDef = new Int32Array(count).fill(-1), kernelEntry = new Int32Array(count).fill(-1);
  const kernelCaller = new Int32Array(count).fill(-1), kernelPhase = new Int32Array(count).fill(-1);
  const ownLabel = new Int32Array(count), ownBendDef = new Int32Array(count).fill(-1), parent = new Int32Array(count).fill(-1);
  const order = [];
  const rootIndex = 0;
  // Context tuple kept per node on the explicit stack.
  const stack = [[rootIndex, { mode: null, project: null, projectBucket: null, bend: false, bendDef: -1, bendEntry: -1, caller: -1, phase: -1, inExport: false }]];
  while (stack.length) {
    const [i, context] = stack.pop();
    order.push(i);
    const node = nodes[i], frame = node.callFrame, url = frame.url;
    const script = url.startsWith('data:') ? scripts.get(frame.scriptId) : null;
    ownLabel[i] = intern(frameLabel(frame, script));
    const next = { ...context };
    if (url.startsWith('data:')) {
      if (isModuleBody(frame)) {
        if (!next.bend) next.mode = ['bendLoad', 'Bend module body evaluation'];
      } else {
        if (!next.bend) {
          next.bend = true;
          next.caller = intern(next.project ?? '(no project frame)');
          next.phase = intern(next.inExport ? 'export (STEP pcurves, print mesh, display)' : next.mode?.[0] === 'bendLoad' ? 'bendLoad' : 'modeling');
        }
        const outer = script?.artifact ? enclosing(script.artifact, frame.lineNumber) : null;
        const def = outer ? bendDefinition(script.artifact, outer) : { file: script?.entry ?? 'unmatched', def: frame.functionName || '(anonymous)' };
        next.bendDef = intern(`${def.file}:${def.def}`);
        next.bendFile = def.file;
        next.bendEntry = intern(script?.entry ?? 'unmatched');
        ownBendDef[i] = next.bendDef;
      }
    } else if (url.startsWith(rootUrl)) {
      const file = url.slice(rootUrl.length);
      const mapped = projectBucket(file, frame.functionName, frame);
      next.project = `${file}:${frame.functionName || '(body)'}:${frame.lineNumber + 1}`;
      next.projectBucket = mapped[0];
      next.mode = mapped;
      if (mapped[0] === 'export' && file.startsWith('src/')) next.inExport = true;
    } else if (!special.has(frame.functionName)) {
      const internal = classifyInternal(url);
      if (internal) {
        // Loader internals under bend-loader.mjs are Bend loading, not the src graph.
        if (internal[0] === 'moduleLoading' && next.mode?.[0] === 'bendLoad') next.mode = ['bendLoad', 'ESM loader under Bend loading (data: import, hooks)'];
        else if (internal[0] !== 'processStart' || !next.project) next.mode = internal;
      }
    }
    let bucket, sub;
    if (frame.functionName === '(garbage collector)') bucket = 'gc';
    else if (frame.functionName === '(idle)') bucket = 'idle';
    else if (frame.functionName === '(program)') bucket = 'program';
    else if (frame.functionName === '(root)') bucket = 'other';
    else if (next.bend) { bucket = 'kernel'; sub = next.bendFile; }
    else if (next.mode) { [bucket, sub] = next.mode; }
    else { bucket = 'nodeRuntime'; sub = url || '(native)'; }
    bucketOf[i] = bucketOrder.indexOf(bucket);
    if (sub !== undefined) subOf[i] = intern(sub);
    if (next.bend) { kernelDef[i] = next.bendDef; kernelEntry[i] = next.bendEntry; kernelCaller[i] = next.caller; kernelPhase[i] = next.phase; }
    for (const child of node.children ?? []) { const c = index.get(child); parent[c] = i; stack.push([c, next]); }
  }

  // Inclusive time per frame label and per Bend definition, counting a
  // recursive label once per stack.
  const totalUs = Float64Array.from(selfUs);
  for (let k = order.length - 1; k > 0; k--) { const i = order[k]; if (parent[i] >= 0) totalUs[parent[i]] += totalUs[i]; }
  const inclusiveLabel = new Map(), inclusiveBend = new Map();
  const onPathLabel = new Int32Array(strings.length + 1), onPathBend = new Int32Array(strings.length + 1);
  const walk = [[rootIndex, 0]];
  while (walk.length) {
    const top_ = walk[walk.length - 1];
    const [i, state] = top_;
    if (state === 0) {
      top_[1] = 1;
      if (onPathLabel[ownLabel[i]]++ === 0) add(inclusiveLabel, ownLabel[i], totalUs[i]);
      if (ownBendDef[i] >= 0 && onPathBend[ownBendDef[i]]++ === 0) add(inclusiveBend, ownBendDef[i], totalUs[i]);
      for (const child of nodes[i].children ?? []) walk.push([index.get(child), 0]);
    } else {
      walk.pop();
      onPathLabel[ownLabel[i]]--;
      if (ownBendDef[i] >= 0) onPathBend[ownBendDef[i]]--;
    }
  }

  // Aggregate.
  const total = selfUs.reduce((s, v) => s + v, 0);
  const buckets = new Map(bucketOrder.map(b => [b, 0])), gcAttributed = new Map(bucketOrder.map(b => [b, 0]));
  const attributed = new Map(bucketOrder.map(b => [b, 0])), idleAfter = new Map();
  const subs = new Map(), selfByLabel = new Map();
  const kernelByFile = new Map(), kernelByDef = new Map(), kernelByEntry = new Map(), kernelByCaller = new Map(), kernelByPhase = new Map();
  for (let i = 0; i < count; i++) {
    const us = selfUs[i];
    if (!us) continue;
    const bucket = bucketOrder[bucketOf[i]];
    add(buckets, bucket, us);
    if (subOf[i] >= 0) add(subs, `${bucket}\t${strings[subOf[i]]}`, us);
    add(selfByLabel, `${bucket}\t${ownLabel[i]}`, us);
    if (bucket === 'kernel') {
      add(kernelByFile, strings[subOf[i]], us); add(kernelByDef, strings[kernelDef[i]], us);
      add(kernelByEntry, strings[kernelEntry[i]], us); add(kernelByCaller, strings[kernelCaller[i]], us);
      add(kernelByPhase, strings[kernelPhase[i]], us);
    }
  }
  // Coarse timeline: first/last sample per bucket, idle split at the first kernel sample.
  const timeline = {}, kernelIndex = bucketOrder.indexOf('kernel'), idleIndex = bucketOrder.indexOf('idle');
  let clock = 0, firstKernelMs = null, idleBeforeKernel = 0, idleAfterKernel = 0;
  for (let s = 0; s < samples.length; s++) {
    const b = bucketOf[sampleIndex[s]], name = bucketOrder[b], at = clock / 1000;
    const entry = timeline[name] ??= { firstMs: +at.toFixed(1), lastMs: 0 };
    entry.lastMs = +at.toFixed(1);
    if (b === kernelIndex && firstKernelMs === null) firstKernelMs = +at.toFixed(1);
    if (b === idleIndex) { if (firstKernelMs === null) idleBeforeKernel += sampleWeight[s]; else idleAfterKernel += sampleWeight[s]; }
    clock += sampleWeight[s];
  }
  // GC re-attribution to the preceding non-pseudo sample.
  let previous = 'other';
  const pseudo = new Set([bucketOrder.indexOf('gc'), bucketOrder.indexOf('idle'), bucketOrder.indexOf('program')]);
  for (let s = 0; s < samples.length; s++) {
    const b = bucketOf[sampleIndex[s]];
    if (b === bucketOrder.indexOf('gc')) add(gcAttributed, previous, sampleWeight[s]);
    else add(gcAttributed, bucketOrder[b], sampleWeight[s]);
    if (b === bucketOrder.indexOf('gc') || b === idleIndex) add(attributed, previous, sampleWeight[s]);
    else add(attributed, bucketOrder[b], sampleWeight[s]);
    if (b === idleIndex) add(idleAfter, previous, sampleWeight[s]);
    if (!pseudo.has(b)) previous = bucketOrder[b];
  }

  const toMs = map => Object.fromEntries([...map].map(([k, v]) => [k, +(v / 1000).toFixed(2)]));
  const shares = map => Object.fromEntries([...map].map(([k, v]) => [k, +(v / total).toFixed(4)]));
  const subList = [...subs].sort((a, b) => b[1] - a[1]).map(([k, us]) => {
    const [bucket, name] = k.split('\t');
    return { bucket, name, ms: +(us / 1000).toFixed(2), share: +(us / total).toFixed(4) };
  });
  const scriptList = [...scripts.values()].reduce((m, s) => (m[s.entry] = (m[s.entry] ?? 0) + 1, m), {});
  return {
    profile: rel(path), nodes: count, samples: samples.length, durationMs: +((profile.endTime - profile.startTime) / 1000).toFixed(1),
    sampledMs: +(total / 1000).toFixed(1), medianIntervalUs: medianGap, scripts: scriptList,
    unmatchedScripts: [...scripts.values()].filter(s => s.entry === 'unmatched').length,
    bucketsMs: toMs(buckets), bucketShares: shares(buckets),
    bucketsGcAttributedMs: toMs(gcAttributed), bucketSharesGcAttributed: shares(gcAttributed),
    // GC and idle samples both re-attributed to the preceding non-pseudo sample.
    bucketsAttributedMs: toMs(attributed), bucketSharesAttributed: shares(attributed), idleByPrecedingBucketMs: toMs(idleAfter),
    subBuckets: subList,
    timeline: { buckets: timeline, firstKernelMs, idleBeforeFirstKernelMs: +(idleBeforeKernel / 1000).toFixed(1),
      idleAfterFirstKernelMs: +(idleAfterKernel / 1000).toFixed(1) },
    kernel: {
      ms: +(buckets.get('kernel') / 1000).toFixed(2),
      byBendFile: top(kernelByFile, 40, total), byEntryModule: top(kernelByEntry, 30, total),
      byHostCaller: top(kernelByCaller, 30, total), byCallerBucket: top(kernelByPhase, 10, total),
      topSelf: top(new Map([...kernelByDef]), 30, total),
      // The run_lib/run_loop trampoline encloses every kernel sample; omit it.
      topInclusive: top(new Map([...inclusiveBend].map(([k, v]) => [strings[k], v]).filter(([k]) => !k.startsWith('bend-js-runtime:'))), 30, total),
    },
    topSelf: [...selfByLabel].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, us]) => {
      const [bucket, label] = k.split('\t');
      return { name: strings[label], bucket, ms: +(us / 1000).toFixed(2), share: +(us / total).toFixed(4) };
    }),
    topInclusiveHost: [...inclusiveLabel].filter(([k]) => strings[k].startsWith('src/') || strings[k].startsWith('bin/'))
      .sort((a, b) => b[1] - a[1]).slice(0, 40)
      .map(([k, us]) => ({ name: strings[k], ms: +(us / 1000).toFixed(2), share: +(us / total).toFixed(4) })),
  };
}

// ---------------------------------------------------------------- call counts
function callSummary(calls) {
  if (!calls) return null;
  const sum = (key, side) => calls.entries.reduce((s, e) => s + e[side][key], 0);
  const histogram = {};
  for (const entry of calls.entries) for (const [k, v] of Object.entries(entry.histogram)) histogram[k] = (histogram[k] ?? 0) + v;
  const argNodes = sum('nodes', 'args'), resultNodes = sum('nodes', 'result');
  // Wire estimate: one 32-bit word per number/BigInt and per object node (tag
  // or list cell). A packed native encoding would be within a small factor.
  const words = side => sum('numbers', side) + sum('bigint', side) + sum('nodes', side);
  const perEntry = calls.entries.filter(e => e.calls).map(e => ({
    name: e.name, calls: e.calls, ms: +e.ms.toFixed(2), meanMs: +(e.ms / e.calls).toFixed(4), maxMs: +e.maxMs.toFixed(2),
    histogram: e.histogram, errors: e.errors,
    argNodesPerCall: Math.round(e.args.nodes / e.calls), resultNodesPerCall: Math.round(e.result.nodes / e.calls),
    maxList: Math.max(e.args.maxList, e.result.maxList),
    solidsIn: e.args.solids, solidsOut: e.result.solids,
    facesInPerCall: +(e.args.faces / e.calls).toFixed(1), facesOutPerCall: +(e.result.faces / e.calls).toFixed(1),
    verticesOutPerCall: +(e.result.vertices / e.calls).toFixed(1),
    reusedArgShare: e.args.nodes ? +(e.args.reusedNodes / e.args.nodes).toFixed(3) : 0,
    truncated: e.args.truncated + e.result.truncated,
    topCaller: Object.entries(e.callers).sort((a, b) => b[1] - a[1])[0]?.[0],
  }));
  return {
    file: rel(join(profileDirectory, 'calls')), exitCode: calls.exitCode, wallMsSincePreload: +calls.wallMsSincePreload.toFixed(1),
    sizeWalkMs: +calls.sizeWalkMs.toFixed(1), outerCalls: calls.totals.calls, distinctEntries: perEntry.length,
    kernelInclusiveMs: +calls.totals.ms.toFixed(1), kernelInclusiveShareOfRun: +(calls.totals.ms / (calls.wallMsSincePreload - calls.sizeWalkMs)).toFixed(4),
    histogram, argNodes, resultNodes, argReusedShare: argNodes ? +(sum('reusedNodes', 'args') / argNodes).toFixed(3) : 0,
    estimatedWireBytes: { args: 4 * words('args'), results: 4 * words('result') },
    modules: calls.modules.map(m => m.entry),
    entries: perEntry.sort((a, b) => b.ms - a.ms),
  };
}

// ---------------------------------------------------------------- Amdahl
const ks = [7.5, 25, 75];
// In-process binding costs measured by the parallel binding stage (N-API addon
// around the Bend C runtime), used only to estimate per-call overhead.
function bindingCosts() {
  const directory = join(root, 'out/native-bridge/binding');
  const path = join(directory, 'latency-t1.json');
  if (!existsSync(path)) return null;
  const result = JSON.parse(readFileSync(path, 'utf8')).result;
  const row = label => result.rows.find(r => r.packing === 'u32' && r.label === label);
  const mb = row('1 MB'), small = row('64 B');
  // Addon load varies: the first dlopen after a rebuild pays macOS code checks
  // (hundreds of ms), later loads take about 1 ms. Use the median over every
  // latency file (current and preserved earlier runs) and keep the list.
  const files = [directory, ...readdirSync(directory).filter(d => d.startsWith('prev-')).map(d => join(directory, d))]
    .flatMap(d => readdirSync(d).filter(f => /^latency-t\d+\.json$/.test(f)).map(f => join(d, f)));
  const loads = files.map(f => { const r = JSON.parse(readFileSync(f, 'utf8')).result; return { file: rel(f), ms: +(r.loadMs + r.initMs).toFixed(3) }; });
  const sorted = loads.map(l => l.ms).sort((x, y) => x - y);
  return { source: rel(path), loadAndInitMs: sorted[sorted.length >> 1], loadAndInitAll: loads, callFloorMs: small.sum.p50,
    msPerInputByte: mb.sum.p50 / mb.bytes, msPerOutputByte: Math.max(0, mb.echo.p50 - mb.sum.p50) / mb.bytes,
    loadAvgAtMeasurement: result.loadBefore, note: 'probe addon (1.2 MB), not a full-kernel addon; its load time is an open question' };
}

// Time-based projections on one sampled run: T total, K kernel, H host
// adaptation, B Bend JS load. Shares are applied to the uninstrumented wall.
export function projections(ms, calls, binding) {
  const T = bucketOrder.reduce((s, b) => s + (ms[b] ?? 0), 0);
  const K = ms.kernel ?? 0, H = ms.hostAdaptation ?? 0, B = ms.bendLoad ?? 0;
  const S = (ms.processStart ?? 0) + (ms.moduleLoading ?? 0) + B;
  const overhead = calls && binding ? calls.outerCalls * binding.callFloorMs + calls.estimatedWireBytes.args * binding.msPerInputByte +
    calls.estimatedWireBytes.results * binding.msPerOutputByte : null;
  const load = binding?.loadAndInitMs ?? null;
  const row = (base, after, formula) => ({ formula, speedup: Object.fromEntries(ks.map(k => [k, +(base / after(k)).toFixed(3)])),
    limit: +(base / after(Infinity)).toFixed(3) });
  const U = T - S;
  return {
    totalMs: +T.toFixed(1), kernelMs: +K.toFixed(1), hostMs: +H.toFixed(1), bendLoadMs: +B.toFixed(1), startupMs: +S.toFixed(1),
    bindingOverheadEstimateMs: overhead === null ? null : +overhead.toFixed(3), addonLoadMs: load,
    kernelOnly: row(T, k => T - K + K / k, 'T / (T - K + K/k)'),
    kernelAndHost: row(T, k => T - K - H + (K + H) / k, 'T / (T - K - H + (K+H)/k)'),
    nativeCli: overhead === null ? null : row(T, k => T - K + K / k - B + load + overhead,
      'T / (T - K + K/k - B + addonLoad + bindingOverhead); the addon replaces the Bend JS load'),
    residentSession: row(U, k => U - K + K / k, 'U / (U - K + K/k), U = T - S, S = Node start + module load + Bend load (paid once)'),
  };
}

// ---------------------------------------------------------------- main
function load(path) { return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null; }

function headline(summary) {
  const rows = summary.table, range = values => { const v = values.filter(x => x !== undefined && x !== null);
    return v.length ? [Math.min(...v), Math.max(...v)] : null; };
  const heavy = rows.filter(r => r.kernelShare > 0.5), light = rows.filter(r => r.kernelShare <= 0.5);
  const pick = (list, key) => Object.fromEntries(ks.map(k => [k, range(list.map(r => r[key]?.[k]))]));
  const w = summary.workloads;
  return {
    kernelHeavy: heavy.map(r => r.id), startupDominated: light.map(r => r.id),
    kernelShareHeavy: range(heavy.map(r => r.kernelShare)), kernelShareLight: range(light.map(r => r.kernelShare)),
    bendLoadMsAllRuns: range(Object.values(w).map(x => x.projections.attributed.bendLoadMs)),
    hostAdaptationShareMax: Math.max(...rows.map(r => r.hostShare)), frontendShareMax: Math.max(...rows.map(r => r.frontendShare)),
    exportShareMax: Math.max(...rows.map(r => r.exportShare)), gcRawShare: range(rows.map(r => r.gcRawShare)),
    kernelCalls: range(rows.map(r => r.kernelCalls)), bindingOverheadEstimateMsMax: Math.max(...Object.values(w).map(x => x.projections.attributed.bindingOverheadEstimateMs ?? 0)),
    speedupKernelOnlyHeavy: pick(heavy, 'speedupKernelOnly'), limitKernelOnlyHeavy: range(heavy.map(r => r.limitKernelOnly)),
    speedupNativeCliHeavy: pick(heavy, 'speedupNativeCli'), speedupNativeCliLight: pick(light, 'speedupNativeCli'),
    speedupResidentHeavy: pick(heavy, 'speedupResident'),
  };
}

function main() {
  const args = process.argv.slice(2);
  const onlyAt = args.indexOf('--only');
  const only = onlyAt >= 0 ? args[onlyAt + 1].split(',') : null;
  const runs = load(join(profileDirectory, 'runs.json'));
  const summaryPath = join(profileDirectory, 'summary.json');
  const summary = load(summaryPath) ?? {};
  summary.schema = 'wonky-native-bridge-profile-summary/1';
  summary.generatedAt = new Date().toISOString();
  summary.node = runs?.node; summary.platform = runs?.platform;
  summary.method = {
    profiler: 'node --cpu-prof (sampling); interval per workload in runs.profile.*.intervalUs',
    attribution: 'scripts/native-bridge/analyze-profiles.mjs header comment',
    callCounts: 'scripts/native-bridge/count-kernel-calls.mjs (separate instrumented run)',
    ampdahlK: ks, gcNote: 'bucketSharesGcAttributed assigns each GC sample to the preceding non-pseudo sample bucket',
  };
  summary.startup = runs?.runs?.startup ? Object.fromEntries(Object.entries(runs.runs.startup).map(([k, list]) => [k, {
    wallMs: list.map(r => +r.wallMs.toFixed(1)), minMs: +Math.min(...list.map(r => r.wallMs)).toFixed(1), load1: list.map(r => r.loadBefore.one) }])) : null;
  const phases = load(join(profileDirectory, 'startup-phases.json'));
  if (phases) summary.startupPhases = phases;
  summary.workloads ??= {};
  const binding = bindingCosts();
  summary.bindingCosts = binding;
  mkdirSync(analysisDirectory, { recursive: true });
  for (const workload of workloads) {
    if (only ? !only.includes(workload.id) : workload.optional) continue;
    const profilePath = join(profileDirectory, 'cpuprofiles', `${workload.id}.cpuprofile`);
    if (!existsSync(profilePath)) { console.warn(`skip ${workload.id}: no profile`); continue; }
    const calls = load(join(profileDirectory, 'calls', `${workload.id}.json`));
    const started = performance.now();
    const analysis = analyzeProfile(profilePath, new Set(calls?.modules?.map(m => m.key) ?? []));
    const profileRun = runs?.runs?.profile?.[workload.id]?.runs?.[0];
    const plainRuns = runs?.runs?.plain?.[workload.id]?.runs ?? [];
    const countRun = runs?.runs?.count?.[workload.id]?.runs?.[0];
    const brief = run => run && { wallMs: +run.wallMs.toFixed(0), userS: run.userS, sysS: run.sysS, maxRssMiB: +run.maxRssMiB?.toFixed(0),
      exitCode: run.exitCode, expectedExit: run.expectedExit, load1Before: run.loadBefore?.one, load1After: run.loadAfter?.one, at: run.at,
      stderrTail: run.exitCode ? run.stderrTail : undefined };
    const detail = {
      id: workload.id, frontend: workload.frontend, argv: profileRun?.argv,
      runs: { profile: brief(profileRun), plain: plainRuns.map(brief), count: brief(countRun) },
      analysis, calls: callSummary(calls),
    };
    // Primary basis: GC and idle re-attributed (kernel GC vanishes with a native kernel; the k
    // factors were measured end to end, JS GC included). Pessimistic: raw buckets, GC stays in JS.
    detail.projections = { attributed: projections(analysis.bucketsAttributedMs, detail.calls, binding),
      raw: projections(analysis.bucketsMs, detail.calls, binding) };
    writeFileSync(join(analysisDirectory, `${workload.id}.json`), JSON.stringify(detail, null, 1) + '\n');
    summary.workloads[workload.id] = {
      frontend: workload.frontend, argv: detail.argv, runs: detail.runs,
      timeline: analysis.timeline,
      profile: { durationMs: analysis.durationMs, sampledMs: analysis.sampledMs, samples: analysis.samples, medianIntervalUs: analysis.medianIntervalUs,
        unmatchedScripts: analysis.unmatchedScripts },
      bucketsMs: analysis.bucketsMs, bucketShares: analysis.bucketShares, bucketSharesGcAttributed: analysis.bucketSharesGcAttributed,
      kernelByBendFile: analysis.kernel.byBendFile.slice(0, 12), kernelByEntryModule: analysis.kernel.byEntryModule.slice(0, 8),
      kernelByHostCaller: analysis.kernel.byHostCaller.slice(0, 8), kernelByCallerBucket: analysis.kernel.byCallerBucket,
      kernelTopSelf: analysis.kernel.topSelf.slice(0, 20), kernelTopInclusive: analysis.kernel.topInclusive.slice(0, 20),
      topSelf: analysis.topSelf.slice(0, 20), hostSubBuckets: analysis.subBuckets.filter(s => s.bucket !== 'kernel').slice(0, 20),
      calls: detail.calls && { ...detail.calls, entries: detail.calls.entries.slice(0, 15) },
      bucketSharesAttributed: analysis.bucketSharesAttributed, idleByPrecedingBucketMs: analysis.idleByPrecedingBucketMs,
      projections: detail.projections,
      detail: rel(join(analysisDirectory, `${workload.id}.json`)),
    };
    summary.table = Object.entries(summary.workloads).map(([id, w]) => {
      const sh = w.bucketSharesAttributed, pr = w.projections.attributed, median = list => {
        const v = list.map(r => r.wallMs).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : null; };
      return { id, plainWallMs: median(w.runs.plain), profileMs: w.profile.durationMs, load1: w.runs.profile?.load1Before,
        startupShare: +((sh.processStart ?? 0) + (sh.moduleLoading ?? 0) + (sh.bendLoad ?? 0)).toFixed(4), bendLoadShare: sh.bendLoad,
        frontendShare: +((sh.frontendParse ?? 0) + (sh.interpreter ?? 0)).toFixed(4), kernelShare: sh.kernel, hostShare: sh.hostAdaptation,
        exportShare: sh.export, gcRawShare: w.bucketShares.gc, kernelCalls: w.calls?.outerCalls, kernelInclusiveMsCountRun: w.calls?.kernelInclusiveMs,
        speedupKernelOnly: pr.kernelOnly.speedup, limitKernelOnly: pr.kernelOnly.limit, speedupKernelAndHost: pr.kernelAndHost.speedup,
        speedupNativeCli: pr.nativeCli?.speedup, limitNativeCli: pr.nativeCli?.limit, speedupResident: pr.residentSession.speedup };
    });
    summary.headline = headline(summary);
    writeFileSync(summaryPath, JSON.stringify(summary, null, 1) + '\n');
    console.log(`${workload.id}: ${analysis.samples} samples, ${analysis.durationMs} ms, kernel ${(analysis.bucketShares.kernel * 100).toFixed(1)}%` +
      ` host ${(analysis.bucketShares.hostAdaptation * 100).toFixed(1)}% gc ${(analysis.bucketShares.gc * 100).toFixed(1)}%` +
      ` bendLoad ${(analysis.bucketShares.bendLoad * 100).toFixed(1)}% (analyzed in ${((performance.now() - started) / 1000).toFixed(1)} s)`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
