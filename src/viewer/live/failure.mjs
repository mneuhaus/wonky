// Build failure payload `wonky.live-build-failure/1` (spec 9.4). Package: live-server.
//
// Built inside the build worker: structured clone drops custom Error
// properties (line, column, modelTrace, traceback), so only this plain object
// crosses IPC.
//
//   failurePayload(error, { source, jobId, timings, lastGood, phase, manifestPath, texts })
//     -> payload
//
// Python errors raised in an imported project module are located at the
// innermost project frame the runner records (error.sourceFile/sourceLine,
// or error.useSite for a capability error inside a module), not at the line
// of the model that imported or called it; that line becomes the call site.
// `texts` maps other files to the exact text the build read (the excerpt of
// a module location).
//
// `kind` is one of FAILURE_KINDS:
//   capability  UnsupportedFeatureError: the kernel or frontend does not implement it
//   input       FeatureScriptError / PythonExecutionError: the source is wrong
//   provenance  the frozen module manifest does not match (every edit of a
//               manifest-bound source fails this way by design, spec D4)
//   timeout     an execution budget ran out (Python timeout, interpreter steps)
//   display     the model built but display preparation failed
//   internal    anything else, including a crashed worker (a kernel or viewer bug)
import { dirname, resolve } from 'node:path';

export const FAILURE_SCHEMA = 'wonky.live-build-failure/1';
export const FAILURE_KINDS = Object.freeze([
  'capability', 'input', 'provenance', 'timeout', 'display', 'internal',
]);

// Message patterns of src/modules.mjs (it has no distinct error class yet; a
// provenance class is requested from the modules owner, spec section 14).
const PROVENANCE = new RegExp([
  'Frozen module', 'frozen module manifest', 'Part-list revision mismatch',
  'Body snapshot revision',
].join('|'));
const TIMEOUT = /exceeded \d+ ms|Execution limit exceeded/;
const INPUT_ERRORS = new Set(['FeatureScriptError', 'PythonExecutionError', 'SyntaxError']);
const TEXT_LIMIT = 4096;

export function classifyFailure(error, { phase } = {}) {
  if (phase === 'display') return 'display';
  const name = error?.name;
  const message = String(error?.message ?? error ?? '');
  if (PROVENANCE.test(message)) return 'provenance';
  if (name === 'UnsupportedFeatureError' || message.startsWith('UnsupportedFeatureError:')) {
    return 'capability';
  }
  if (TIMEOUT.test(message)) return 'timeout';
  if (INPUT_ERRORS.has(name)) return 'input';
  return 'internal';
}

const tail = text => {
  if (typeof text !== 'string' || !text) return null;
  return text.length > TEXT_LIMIT ? '…' + text.slice(-TEXT_LIMIT) : text;
};

const position = (file, value) => {
  if (!value || !Number.isInteger(value.line)) return null;
  return {
    file: value.file ?? file,
    line: value.line,
    column: Number.isInteger(value.column) ? value.column : null,
  };
};

// Lines around `line` (1-based), like the recorded source excerpts.
export function excerptAt(text, line) {
  if (typeof text !== 'string' || !Number.isInteger(line) || line < 1) return null;
  const lines = text.split('\n');
  if (line > lines.length) return null;
  const firstLine = Math.max(1, line - 2);
  return {
    firstLine,
    text: lines.slice(firstLine - 1, Math.min(lines.length, line + 2)).join('\n'),
  };
}

// The failing operation from error.modelTrace (src/source-map.mjs): the last
// record that did not complete.
function failedOperationOf(trace) {
  const operations = Array.isArray(trace?.operations) ? trace.operations : [];
  const failed = operations.findLast(record => record.status !== 'completed');
  return {
    completed: operations.filter(record => record.status === 'completed').length,
    failed: failed ?? null,
  };
}

// callStack is outermost first: [entry, helper called at …, nested helper …].
// The chain is innermost first; callSite is the call from the top-level
// function into the first helper (spec 9.4). Frames without a call location
// (the runtime calling the entry function, or a defineFeature wrapper calling
// its body) are not calls in the source and are left out.
function callChainOf(stack, file, location) {
  if (!Array.isArray(stack) || stack.length < 2) return { chain: [], callSite: null };
  const chain = [];
  const innermost = stack.at(-1);
  chain.push({ kind: 'at', name: innermost.name ?? null, location });
  for (let index = stack.length - 1; index >= 1; index--) {
    const called = position(file, stack[index].calledAt);
    if (!called) continue;
    chain.push({ kind: 'called-from', name: stack[index - 1].name ?? null, location: called });
  }
  const outermost = stack.slice(1).find(frame => position(file, frame.calledAt));
  return { chain, callSite: outermost ? position(file, outermost.calledAt) : null };
}

// Frames of a Python traceback text, outermost first.
const PYTHON_FRAME = /^\s*File "([^"]+)", line (\d+), in (.+)$/gm;
export function pythonFrames(traceback) {
  if (typeof traceback !== 'string') return [];
  return [...traceback.matchAll(PYTHON_FRAME)]
    .map(match => ({ file: match[1], line: Number(match[2]), name: match[3].trim() }));
}

// The innermost project frame of a Python error (a module file), with the
// call chain through the model's project frames. Null when the error is
// located in the executed file itself and no helper frames exist.
export function pythonLocation(error, file) {
  const base = file ? dirname(file) : process.cwd();
  const at = value => (value && Number.isInteger(value.line) ? {
    file: resolve(base, value.file ?? file), line: value.line,
    column: Number.isInteger(value.column) ? value.column : null,
  } : null);
  const main = position(file, { line: error?.line, column: error?.column });
  const site = at(error?.useSite)
    ?? (error?.sourceFile ? at({ file: error.sourceFile, line: error.sourceLine }) : null);
  const projectFiles = new Set([file, site?.file,
    ...(Array.isArray(error?.sourceFiles) ? error.sourceFiles.map(entry => entry?.path) : [])]
    .filter(Boolean));
  const frames = pythonFrames(error?.traceback)
    .filter(frame => projectFiles.has(resolve(base, frame.file)))
    .map(frame => ({ ...frame, file: resolve(base, frame.file) }));
  const innermost = site ?? (frames.length >= 2 && main ? main : null);
  if (!innermost) return null;
  const last = frames.at(-1);
  if (last && last.file === innermost.file && last.line === innermost.line) {
    // Only the model's own call carries a column (the runner records it).
    const where = frame => ({
      file: frame.file, line: frame.line,
      column: main && frame.file === main.file && frame.line === main.line ? main.column : null,
    });
    const chain = [{ kind: 'at', name: last.name, location: innermost }];
    for (let index = frames.length - 1; index >= 1; index--) {
      chain.push({ kind: 'called-from', name: frames[index - 1].name,
        location: where(frames[index - 1]) });
    }
    return { location: innermost, chain, callSite: frames.length > 1 ? where(frames[0]) : null };
  }
  // No matching traceback (a capability error the host latched): the model's
  // line that led there is the call site.
  const chain = [{ kind: 'at', name: null, location: innermost }];
  const called = main && (main.file !== innermost.file || main.line !== innermost.line);
  if (called) chain.push({ kind: 'called-from', name: null, location: main });
  return { location: innermost, chain, callSite: called ? main : null };
}

export function failurePayload(error, {
  source = {}, jobId = null, revision = null, sourceId = null, timings = {}, lastGood = null,
  phase = null, manifestPath = null, texts = {},
} = {}) {
  const kind = classifyFailure(error, { phase });
  const file = source.path ?? null;
  const trace = error?.modelTrace ?? null;
  const { completed, failed } = failedOperationOf(trace);
  const python = source.language === 'python' ? pythonLocation(error, file) : null;
  const location = python?.location
    ?? position(file, { line: error?.line, column: error?.column })
    ?? position(file, failed?.error)
    ?? position(file, failed?.source?.span);
  const { chain, callSite } = python
    ? { chain: python.chain, callSite: python.callSite }
    : callChainOf(failed?.callStack, file, location);
  const text = location?.file && location.file !== file ? texts[location.file] : source.text;
  const excerpt = excerptAt(text, location?.line);
  const sourceLine = location && typeof text === 'string'
    ? text.split('\n')[location.line - 1] ?? null
    : null;
  return {
    schema: FAILURE_SCHEMA,
    kind,
    sourceId,
    jobId,
    revision,
    phase,
    source: {
      path: file, sha256: source.sha256 ?? null, language: source.language ?? null,
    },
    error: {
      name: error?.name ?? 'Error',
      message: String(error?.message ?? error),
      location,
      sourceLine,
      excerpt,
      traceback: tail(error?.traceback),
      ...(kind === 'internal' && error?.stack ? { stack: tail(error.stack) } : {}),
    },
    failedOperation: failed ? {
      sequence: failed.sequence ?? null,
      name: failed.name ?? null,
      operationId: failed.operationId ?? null,
      callStack: failed.callStack ?? [],
    } : null,
    callSite,
    callChain: chain,
    completedOperations: trace ? completed : null,
    ...(kind === 'provenance' ? { manifest: manifestPath } : {}),
    output: error?.stdout || error?.stderr
      ? { stdout: tail(error.stdout), stderr: tail(error.stderr) }
      : null,
    timings,
    lastGood,
  };
}

// A failure the parent observes itself (worker crash, start failure).
export function internalFailure(message, { stderrTail = null, ...options } = {}) {
  const payload = failurePayload({ name: 'BuildWorkerError', message }, options);
  payload.kind = 'internal';
  if (stderrTail) payload.output = { stdout: null, stderr: tail(stderrTail) };
  return payload;
}

// The watched source exists but cannot be read (a directory, no permission).
export function unreadableSourceFailure(path, error, options = {}) {
  const payload = failurePayload({
    name: 'UnreadableSourceError',
    message: `Live source ${path} cannot be read (${error.message}); the watcher rebuilds`
      + ' once it reads',
  }, { ...options, source: { path, ...options.source } });
  payload.kind = 'input';
  return payload;
}

// The watched source itself is gone (deleted, or renamed away and not back).
export function missingSourceFailure(path, options = {}) {
  const payload = failurePayload({
    name: 'MissingSourceError',
    message: `Live source ${path} is missing; the watcher rebuilds once it is back`,
  }, { ...options, source: { path, ...options.source } });
  payload.kind = 'input';
  return payload;
}
