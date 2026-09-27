// Failure banner and failure panel. Package: live-client.
//
// The banner is a strip over the top edge of the viewport (stage slot). It
// overlays the canvas instead of taking layout space, so a failure or a fix
// never resizes the viewport and the model does not jump (fix round 3); the
// viewport's top HUD line moves down by the banner height, so the model title
// stays readable:
//
//   Showing last good r2. Source now fails: capability error at part.fs:24:17 in
//   opBoolean, called from part.fs:57
//   general trimmed-face booleans are not implemented
//                                                        [Details] [Open in editor]
//
// It shows the latest failure of the displayed live source (amber), a build
// worker that failed to start (red, with Rebuild), or the build notices of
// the displayed revision (blue, e.g. show() calls the result contract ignored). When no build of
// the source ever succeeded there is no model to keep: the viewport shows the
// failure panel instead (location, message, excerpt, call site, actions).
// The text helpers are pure and unit-tested.
import { escape } from '../../core/dom.js';

const BANNER = '<div id="live-banner" class="live-banner" data-tone="amber" role="alert" hidden>'
  + '<span class="live-banner-icon" aria-hidden="true">!</span><div class="live-banner-copy">'
  + '<strong id="live-banner-title" class="live-banner-title"></strong>'
  + '<span id="live-banner-detail" class="live-banner-detail"></span></div>'
  + '<div class="live-banner-actions"><button id="live-banner-details"'
  + ' class="button secondary live-banner-button" type="button">Details</button>'
  + '<a id="live-banner-editor" class="button secondary live-banner-button" hidden>Open in'
  + ' editor</a><button id="live-banner-rebuild" class="button secondary live-banner-button"'
  + ' type="button" hidden>Rebuild</button></div></div>';

const PANEL = '<div id="live-failure-panel" class="live-failure-panel" role="alert" hidden>'
  + '<span id="live-panel-eyebrow" class="eyebrow">No successful build</span>'
  + '<h2 id="live-panel-title"></h2><p id="live-panel-message" class="live-panel-message"></p>'
  + '<pre id="live-panel-excerpt" class="live-excerpt" hidden></pre>'
  + '<p id="live-panel-called" class="live-panel-called" hidden></p>'
  + '<div class="live-banner-actions"><button id="live-panel-details" class="button secondary'
  + ' live-banner-button" type="button">Details</button><a id="live-panel-editor"'
  + ' class="button secondary live-banner-button" hidden>Open in editor</a></div></div>';

const MESSAGE_LIMIT = 220;

export const basename = path => String(path ?? '').split(/[/\\]/).at(-1);

// "part.fs:24:17" (column optional).
export function locationText(location, { column = true } = {}) {
  if (!location?.file || !Number.isInteger(location.line)) return null;
  const col = column && Number.isInteger(location.column) ? `:${location.column}` : '';
  return `${basename(location.file)}:${location.line}${col}`;
}

export const failureLocation = failure => failure?.error?.location ?? null;

// "capability error at part.fs:24:17 in opBoolean"
export function failureSummary(failure) {
  if (!failure) return 'build failed';
  const where = locationText(failureLocation(failure));
  const operation = failure.failedOperation?.name;
  return `${failure.kind ?? 'build'} error${where ? ` at ${where}` : ''}`
    + (operation ? ` in ${operation}` : '');
}

// "called from part.fs:57" when the failing frame is inside a helper (the
// payload's callSite is the outermost call into it), else null.
export function calledFrom(failure) {
  const site = failure?.callSite;
  const location = failureLocation(failure);
  if (!site || !Number.isInteger(site.line)) return null;
  if (location && site.line === location.line && site.file === location.file) return null;
  return `called from ${locationText(site, { column: false })}`;
}

export function shortMessage(failure, limit = MESSAGE_LIMIT) {
  const message = String(failure?.error?.message ?? '').replace(/\s+/g, ' ').trim();
  return message.length > limit ? `${message.slice(0, limit - 1)}…` : message;
}

// Banner title for a failure while a model is shown; the call site is part of
// the title so a narrow viewport never cuts it off.
export function bannerTitle({ failure, displayed, good }) {
  const lastGood = !!displayed && !!good && displayed.modelId === good.modelId;
  const shown = displayed?.revision !== null && displayed?.revision !== undefined
    ? `r${displayed.revision}` : 'the last model';
  const head = lastGood ? `Showing last good ${shown}.` : `Showing ${shown}.`;
  const called = calledFrom(failure);
  return `${head} Source now fails: ${failureSummary(failure)}${called ? `, ${called}` : ''}`;
}

export const bannerDetail = failure => shortMessage(failure);

// Build notices of the displayed revision: "r6: 2 show/export calls ignored: …".
export function noticeTitle({ notices, displayed }) {
  const shown = Number.isInteger(displayed?.revision) ? `r${displayed.revision}: ` : '';
  return `${shown}${(notices ?? []).map(entry => entry.message).join(' · ')}`;
}
export const noticeDetail = ({ notices }) => (notices ?? []).map(entry => entry.detail)
  .filter(Boolean).join(' ');

// Worker start failure: { failures, windowMs, stderrTail }.
export function workerTitle(worker, displayed) {
  const count = worker?.failures ?? 'several';
  const within = Number.isFinite(worker?.windowMs) ? ` within ${worker.windowMs / 1000} s` : '';
  const shown = displayed?.revision !== null && displayed?.revision !== undefined
    ? ` Showing r${displayed.revision}.` : '';
  return `Build worker failed to start ${count} times${within}.${shown} Builds wait for the`
    + ' next save or Rebuild.';
}

const lastLine = text => String(text ?? '').trim().split('\n').at(-1) ?? '';

// The start error the worker reported ("SyntaxError: The requested module …"),
// else the last stderr line that is not a stack frame.
export function workerError(worker) {
  if (worker?.error) return String(worker.error);
  const lines = String(worker?.stderrTail ?? '').split('\n').map(line => line.trim())
    .filter(Boolean);
  return lines.findLast(line => !line.startsWith('at ')) ?? lastLine(worker?.stderrTail);
}

// Excerpt lines with numbers; the failing line is marked. Each line is a
// block element, so they are joined without newlines inside the <pre>.
export function excerptMarkup(excerpt, line) {
  if (!excerpt?.text) return '';
  return excerpt.text.split('\n').map((text, index) => {
    const number = excerpt.firstLine + index;
    const current = number === line ? ' live-excerpt-current' : '';
    return `<span class="live-excerpt-line${current}"><span class="live-excerpt-number">`
      + `${number}</span>${escape(text)}</span>`;
  }).join('');
}

export function createBanner(ctx) {
  const { slots, commands, dom: { $ } } = ctx;
  slots.add('stage', { id: 'live.banner', order: 15, html: BANNER });
  slots.add('stage', { id: 'live.failure-panel', order: 55, html: PANEL });
  commands.bind('#live-banner-details', 'live.details');
  commands.bind('#live-panel-details', 'live.details');
  commands.bind('#live-banner-rebuild', 'live.rebuild');

  const set = (selector, value) => {
    const element = $(selector);
    if (element && element.textContent !== value) element.textContent = value;
  };
  const show = (selector, visible) => {
    const element = $(selector);
    if (element && element.hidden === visible) element.hidden = !visible;
  };
  // The top HUD line and the viewport banner slot sit below the banner
  // (--live-banner-height on the stage, see live.css).
  const measure = () => {
    const element = $('#live-banner');
    const stage = $('#stage');
    if (!element || typeof stage?.style?.setProperty !== 'function') return;
    const height = element.hidden ? '0px' : `${element.offsetHeight}px`;
    if (stage.style.getPropertyValue('--live-banner-height') !== height) {
      stage.style.setProperty('--live-banner-height', height);
    }
  };
  const Observer = ctx.env?.window?.ResizeObserver;
  if (Observer && $('#live-banner')) new Observer(measure).observe($('#live-banner'));
  const link = (selector, href) => {
    const element = $(selector);
    if (!element) return;
    show(selector, !!href);
    if (href) element.setAttribute('href', href);
    else element.removeAttribute?.('href');
  };

  // view: { mode: null | 'failure' | 'worker' | 'notice' | 'panel', failure, worker,
  //         notices, displayed, good, editorHref, revision }
  function render(view) {
    const mode = view?.mode ?? null;
    show('#live-banner', ['failure', 'worker', 'notice'].includes(mode));
    const element = $('#live-banner');
    const role = mode === 'notice' ? 'status' : 'alert';
    if (element && element.getAttribute('role') !== role) element.setAttribute('role', role);
    set('.live-banner-icon', mode === 'notice' ? 'i' : '!');
    show('#live-failure-panel', mode === 'panel');
    if (mode === 'failure') {
      $('#live-banner').dataset.tone = 'amber';
      set('#live-banner-title', bannerTitle(view));
      set('#live-banner-detail', bannerDetail(view.failure));
      link('#live-banner-editor', view.editorHref);
      show('#live-banner-details', true);
      show('#live-banner-rebuild', false);
    } else if (mode === 'worker') {
      $('#live-banner').dataset.tone = 'red';
      set('#live-banner-title', workerTitle(view.worker, view.displayed));
      set('#live-banner-detail', workerError(view.worker));
      link('#live-banner-editor', null);
      show('#live-banner-details', true);
      show('#live-banner-rebuild', true);
    } else if (mode === 'notice') {
      $('#live-banner').dataset.tone = 'blue';
      set('#live-banner-title', noticeTitle(view));
      set('#live-banner-detail', noticeDetail(view));
      link('#live-banner-editor', null);
      show('#live-banner-details', false);
      show('#live-banner-rebuild', false);
    } else if (mode === 'panel') {
      const { failure } = view;
      set('#live-panel-eyebrow', 'No successful build');
      set('#live-panel-title', `r${view.revision ?? '?'} fails: ${failureSummary(failure)}`);
      set('#live-panel-message', shortMessage(failure, 600));
      const location = failureLocation(failure);
      const excerpt = $('#live-panel-excerpt');
      const markup = excerptMarkup(failure?.error?.excerpt, location?.line);
      if (excerpt) {
        excerpt.innerHTML = markup;
        excerpt.hidden = !markup;
      }
      const called = calledFrom(failure);
      set('#live-panel-called', called ?? '');
      show('#live-panel-called', !!called);
      link('#live-panel-editor', view.editorHref);
    }
    measure();
  }

  return { render };
}
