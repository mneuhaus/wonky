// Terminal lines and NDJSON output for build events (spec 3.1 step 3).
// Package: live-server.
//
//   const terminal = createTerminal({ json, write, errorWrite, cwd })
//   terminal.event(name, data)    every SSE event (the same names and data)
//   terminal.notice(kind, data)   terminal-only lines: listening, watching,
//                                 worker-backoff, outputs, note, error, tab
//
// Text mode prints one line per event that matters (building, ok, FAILED with
// its call chain, cancelled, worker failures). With `json`, stdout carries
// only NDJSON: one {"event": <SSE name>, ...data} object per SSE event, the
// startup `hello` included; terminal-only notices go to stderr as text.
import { relative, isAbsolute } from 'node:path';

const round = (value, digits = 3) => Number(Number(value).toFixed(digits)).toString();

export const formatSize = sizeMm => sizeMm.map(value => round(value)).join('×');

export function formatSummary(summary) {
  if (!summary) return '';
  const parts = [`${summary.bodies} ${summary.bodies === 1 ? 'body' : 'bodies'}`];
  const logical = summary.logicalFaces === null || summary.logicalFaces === undefined
    ? '' : ` (${summary.logicalFaces} logical)`;
  parts.push(`${summary.faces} faces${logical}`);
  const bounds = summary.bounds;
  if (bounds?.sizeMm) {
    parts.push(bounds.exactness === 'recorded'
      ? `${formatSize(bounds.sizeMm)} mm recorded`
      : `≈ ${formatSize(bounds.sizeMm)} mm display ±${bounds.toleranceMm ?? '?'} mm`);
  }
  return parts.join(' · ');
}

// "0.21 s", or "0.16 s (queued 3.3 s)": the build time excludes the wait for
// a worker; a wait of half a second or more is named.
export function buildTimeText(timings = {}) {
  const build = timings?.buildMs ?? timings?.totalMs ?? 0;
  const queued = timings?.queuedMs ?? 0;
  return `${round(build / 1000, 2)} s${queued >= 500 ? ` (queued ${round(queued / 1000, 1)} s)` : ''}`;
}

export function createTerminal({
  json = false,
  write = text => process.stdout.write(text),
  errorWrite = text => process.stderr.write(text),
  cwd = process.cwd(),
} = {}) {
  const labels = new Map();
  const show = path => {
    if (!path) return '<unknown>';
    const inside = relative(cwd, path);
    return inside && !inside.startsWith('..') && !isAbsolute(inside) ? inside : path;
  };
  const prefix = data => {
    const label = labels.size > 1 ? `${labels.get(data.sourceId) ?? data.sourceId} ` : '';
    return `${label}r${data.revision}`;
  };
  const line = text => write(`${text}\n`);
  const note = text => (json ? errorWrite(`${text}\n`) : write(`${text}\n`));
  const where = location => (location
    ? `${show(location.file)}:${location.line}${location.column ? `:${location.column}` : ''}`
    : null);

  const failureLines = data => {
    const failure = data.failure ?? {};
    const error = failure.error ?? {};
    const operation = failure.failedOperation?.name;
    const message = operation && !error.message?.startsWith(operation)
      ? `${operation}: ${error.message}` : error.message;
    const lines = [[`${prefix(data)} FAILED ${failure.kind}`, where(error.location), message]
      .filter(Boolean).join(' ')];
    for (const link of failure.callChain ?? []) {
      const at = where(link.location) ?? 'unknown location';
      lines.push(link.kind === 'at'
        ? `   at ${link.name ? `${link.name} (${at})` : at}`
        : `   called from ${at}${link.name ? ` in ${link.name}` : ''}`);
    }
    if (failure.kind === 'provenance' && failure.manifest) {
      lines.push(`   manifest ${show(failure.manifest)}`);
    }
    if (failure.download?.path) lines.push(`   model kept at ${show(failure.download.path)}`);
    const good = data.lastGood ?? failure.lastGood;
    lines.push(good
      ? `   showing last good r${good.revision}${good.previousSession ? ' (previous session)' : ''}`
      : '   no successful build yet');
    return lines;
  };

  const text = {
    'build-started': data => [`${prefix(data)} building ${show(data.path)}`
      + (data.worker === 'cold' ? ' (cold worker)' : '')],
    'build-cancelled': data => [`${prefix(data)} cancelled`
      + (data.supersededBy ? ` (superseded by r${data.supersededBy.revision})` : '')],
    revision: data => {
      const same = data.sameAs !== null && data.sameAs !== undefined
        ? ` · same model as r${data.sameAs}` : '';
      const head = data.previousSession
        ? `${prefix(data)} previous session`
        : `${prefix(data)} ok ${buildTimeText(data.timings)}`;
      return [`${head} · ${formatSummary(data.summary)}${same}`,
        ...(data.notices ?? []).map(entry => `   note: ${entry.message}`)];
    },
    'build-failed': failureLines,
    // The error itself (reported by the worker), not the end of its stack;
    // the whole stderr tail is in the event and the Details drawer.
    'worker-failed': data => [
      `${data.worker ?? 'build'} worker failed to start ${data.failures} times within `
        + `${round((data.windowMs ?? 60000) / 1000, 0)} s; waiting for the next save or rebuild`,
      ...(data.error ? [`   ${data.error}`]
        : String(data.stderrTail ?? '').trim().split('\n').filter(Boolean).slice(-6)
          .map(entry => `   ${entry}`)),
    ],
  };

  return {
    hello(data) {
      // Two workspace models of one file share a label: their keys tell them apart.
      const sources = data.sources ?? [];
      const shared = label => sources.filter(source => source.label === label).length > 1;
      for (const source of sources) {
        labels.set(source.id, shared(source.label) && source.key ? source.key : source.label);
      }
      if (json) {
        write(`${JSON.stringify({ event: 'hello', ...data })}\n`);
        return;
      }
      for (const source of data.sources ?? []) {
        const modules = source.watched.filter(entry => entry.role !== 'source' && entry.exists);
        line(`watching    ${show(source.path)}`
          + (modules.length ? ` (+${modules.length} module file${modules.length > 1 ? 's' : ''})`
            : ''));
        for (const entry of source.notes ?? []) line(`            ${entry}`);
      }
    },
    event(name, data) {
      if (json) {
        write(`${JSON.stringify({ event: name, ...data })}\n`);
        return;
      }
      for (const entry of text[name]?.(data) ?? []) line(entry);
    },
    notice(kind, data = {}) {
      if (kind === 'listening') {
        const why = data.derived
          ? '(port from source path; --port pins it)'
          : '(--port)';
        note(`wonky-view  ${data.url}  ${why}`);
        if (data.reviewDirectory) note(`reviews     ${show(data.reviewDirectory)}`);
      } else if (kind === 'worker-backoff') {
        const how = data.signal ? `on ${data.signal}` : `with code ${data.code}`;
        const reason = data.error ?? String(data.stderrTail ?? '').trim().split('\n').at(-1);
        note(`build worker exited ${how} before it was ready; retry ${data.attempt} in `
          + `${round(data.retryInMs / 1000, 0)} s${reason ? ` · ${reason}` : ''}`);
      } else if (kind === 'worker-recycled') {
        note(`   build worker ${data.pid} recycled (${data.reason}); a fresh one takes over`);
      } else if (kind === 'outputs') {
        if (data.files?.length) note(`   wrote ${data.files.map(show).join(', ')}`);
        for (const refused of data.refused ?? []) {
          note(`   no .${refused.extension} written: ${refused.error}`);
        }
      } else if (kind === 'note') {
        note(`   note: ${data.message}`);
      } else if (kind === 'tab') {
        note(data.reused ? 'browser     tab reconnected; no new tab opened'
          : `browser     opened ${data.url}`);
      } else if (kind === 'error') {
        errorWrite(`wonky-view: ${data.message}\n`);
      }
    },
  };
}
