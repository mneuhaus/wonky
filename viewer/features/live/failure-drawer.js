// Build failure details in the drawer (spec 3.1 step 9, 9.4). Package:
// live-client.
//
// Shows the `wonky.live-build-failure/1` payload as it came from the build
// worker: kind, message, location with an "Open in editor" link (zed:// by
// default, setting "editor"), the source excerpt with the failing line, the
// call chain (innermost first, every frame linked), the failed operation,
// completed operations, timings, Python output and traceback, the manifest of
// a provenance failure, and the raw payload. A build worker start failure
// shows its attempts and stderr tail. Nothing is summarized away.
import { escape } from '../../core/dom.js';
import { editorLink } from '../../core/editor-links.js';
import {
  basename, excerptMarkup, failureLocation, failureSummary, locationText, workerError,
} from './banner.js';

const KIND_NOTES = {
  capability: 'The kernel or frontend does not implement this yet (a capability error, not a'
    + ' bug in the source).',
  input: 'The source is wrong: syntax, types or arguments.',
  provenance: 'The frozen module manifest does not match the source; every edit of a'
    + ' manifest-bound source fails this way until the manifest is recaptured (spec D4).',
  timeout: 'An execution budget ran out.',
  display: 'The model built, but display preparation failed. It is not shown as a complete'
    + ' render.',
  internal: 'Something failed inside the kernel or the viewer (a bug to report).',
};

// Editor href for a location, or null (relative paths, unknown scheme).
export function editorHref(location, scheme) {
  try {
    return editorLink(location ?? {}, scheme);
  } catch {
    return null;
  }
}

const row = (label, value) => (value === null || value === undefined || value === '' ? ''
  : `<dt>${escape(label)}</dt><dd>${value}</dd>`);
const code = value => `<code>${escape(value)}</code>`;

function locationLink(location, scheme, label = locationText(location)) {
  if (!label) return '';
  const href = editorHref(location, scheme);
  return href ? `<a class="live-editor-link" href="${escape(href)}">${escape(label)}</a>`
    : code(label);
}

// Call chain, innermost first: "at bore (part.fs:13:5)", "called from part.fs:33:5 in part".
export function chainLines(failure) {
  return (failure?.callChain ?? []).map(link => {
    const where = locationText(link.location) ?? 'unknown location';
    return link.kind === 'at'
      ? { text: link.name ? `at ${link.name} (${where})` : `at ${where}`, location: link.location }
      : { text: `called from ${where}${link.name ? ` in ${link.name}` : ''}`,
        location: link.location };
  });
}

function chainMarkup(failure, scheme) {
  const lines = chainLines(failure);
  if (!lines.length) return '';
  const items = lines.map(line => {
    const href = editorHref(line.location, scheme);
    const text = escape(line.text);
    return `<li>${href ? `<a class="live-editor-link" href="${escape(href)}">${text}</a>` : text}`
      + '</li>';
  }).join('');
  return `<section class="live-drawer-section"><h3>Call chain</h3><ol class="live-chain">${items}`
    + '</ol></section>';
}

function timingsMarkup(timings) {
  const entries = Object.entries(timings ?? {}).filter(([, value]) => Number.isFinite(value));
  if (!entries.length) return '';
  return '<section class="live-drawer-section"><h3>Timings</h3><dl class="properties">'
    + entries.map(([key, value]) => row(key.replace(/Ms$/, ''), `${Math.round(value)} ms`))
      .join('')
    + '</dl></section>';
}

function outputMarkup(failure) {
  const blocks = [
    ['Traceback', failure?.error?.traceback], ['Standard error', failure?.output?.stderr],
    ['Standard output', failure?.output?.stdout], ['Stack', failure?.error?.stack],
  ].filter(([, text]) => text);
  return blocks.map(([label, text]) => `<section class="live-drawer-section"><h3>${label}</h3>`
    + `<pre class="live-output">${escape(text)}</pre></section>`).join('');
}

// The drawer body for a build failure.
export function failureMarkup(failure, { scheme = 'zed', lastGood = null } = {}) {
  const location = failureLocation(failure);
  const operation = failure?.failedOperation;
  const excerpt = excerptMarkup(failure?.error?.excerpt, location?.line);
  const openLink = editorHref(location, scheme);
  return '<div class="live-drawer">'
    + '<p class="live-drawer-summary"><span class="live-kind"'
    + ` data-kind="${escape(failure?.kind)}">`
    + `${escape(failure?.kind ?? 'failure')}</span> ${escape(failureSummary(failure))}</p>`
    + `<p class="live-drawer-message">${escape(failure?.error?.message ?? '')}</p>`
    + (KIND_NOTES[failure?.kind] ? `<p class="small muted">${KIND_NOTES[failure.kind]}</p>` : '')
    + (openLink ? '<p><a id="live-drawer-editor" class="button secondary"'
      + ` href="${escape(openLink)}">Open in editor</a> <span class="small muted">`
      + `${escape(openLink)}</span></p>` : '')
    + '<dl class="properties">'
    + row('Revision', failure?.revision !== null && failure?.revision !== undefined
      ? escape(`r${failure.revision}`) : null)
    + row('Kind', escape(failure?.kind ?? ''))
    + row('Error', escape(failure?.error?.name ?? ''))
    + row('Location', locationLink(location, scheme))
    + row('Source', failure?.source?.path ? code(failure.source.path) : null)
    + row('Called from', failure?.callSite ? locationLink(failure.callSite, scheme) : null)
    + row('Failed operation', operation ? escape([operation.name, operation.operationId
      && `(${operation.operationId})`, Number.isInteger(operation.sequence)
      ? `#${operation.sequence}` : null].filter(Boolean).join(' ')) : null)
    + row('Completed operations', Number.isInteger(failure?.completedOperations)
      ? escape(String(failure.completedOperations)) : null)
    + row('Manifest', failure?.manifest ? code(failure.manifest) : null)
    + row('Kept model', failure?.download?.path ? code(failure.download.path) : null)
    + row('Last good', lastGood ? escape(`r${lastGood.revision}`) : 'none')
    + '</dl>'
    + (excerpt ? '<section class="live-drawer-section"><h3>Source excerpt · '
      + `${escape(basename(location?.file))}</h3><pre class="live-excerpt">${excerpt}</pre>`
      + '</section>' : '')
    + chainMarkup(failure, scheme)
    + timingsMarkup(failure?.timings)
    + outputMarkup(failure)
    + '<details class="report-disclosure"><summary>Failure payload</summary>'
    + `<pre class="report-json">${escape(JSON.stringify(failure, null, 2))}</pre></details>`
    + '</div>';
}

// displayed: whether a model is on screen (it is the last one that built).
export function workerMarkup(worker, { displayed = false } = {}) {
  const attempts = (worker?.attempts ?? []).map(attempt => `<li>${escape(attempt.at)}: exit`
    + ` ${escape(attempt.code ?? attempt.signal ?? '?')}`
    + `${attempt.error ? ` · ${escape(attempt.error)}` : ''}</li>`).join('');
  const error = workerError(worker);
  return '<div class="live-drawer"><p class="live-drawer-summary"><span class="live-kind"'
    + ' data-kind="internal">worker</span> The build worker failed to start'
    + ` ${escape(worker?.failures ?? '')} times.</p>`
    + (error ? `<p class="live-drawer-message">${escape(error)}</p>` : '')
    + '<p class="small muted">Builds wait until the next save or Rebuild. '
    + (displayed ? 'The model on screen is the last one that built.'
      : 'No model is shown until a build succeeds.') + '</p>'
    + (attempts ? `<section class="live-drawer-section"><h3>Attempts</h3><ul>${attempts}</ul>`
      + '</section>' : '')
    + (worker?.stderrTail ? '<section class="live-drawer-section"><h3>Standard error</h3>'
      + `<pre class="live-output">${escape(worker.stderrTail)}</pre></section>` : '')
    + '</div>';
}

export async function openFailureDrawer(ctx, {
  failure, worker, lastGood, scheme, displayed = false,
}) {
  const { drawer, dom: { $ } } = ctx;
  const data = await drawer.open({
    title: worker ? 'Build worker failed to start'
      : `r${failure?.revision ?? '?'} failed: ${failure?.kind ?? 'build'} error`,
    eyebrow: 'Build failure',
    load: async () => ({ failure, worker }),
  });
  if (!data) return;
  $('#report-content').innerHTML = worker ? workerMarkup(worker, { displayed })
    : failureMarkup(failure, { scheme, lastGood });
  $('#close-report')?.focus?.();
}
