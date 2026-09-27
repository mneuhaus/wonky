// Inspector source section (spec 3.2 and 13: sketch-entity source first).
//
// For a face or edge that a line/arc sketch extrusion produced, the recorded
// sketch entity (`identity.source.kind === 'sketch-entity'`, e.g. skArc
// "right" at line 10) is the primary source and the body operation (opExtrude
// at line 14) is shown as context. Everything else shows the operation that
// produced the entity. When that call happened inside a helper function, the
// headline names the helper and its call site ("copyBody (line 20) called
// from r10b.fs:1382"). Every location links to the configured editor
// (setting `editor`, scope G, default zed://) as file:line:column.
//
// `identity.source` on imported bodies is an external entity record
// (Onshape ids, no span), not a code location; only `sketch-entity` sources
// count here. All data is read from the JSON scene: `sourceMap.operations`,
// `body.debug`, `entity.identity`. Nothing is inferred.
import { escape } from '../../core/dom.js';
import { icon } from '../../core/icons.js';
import { short } from '../../core/format.js';
import { DEFAULT_EDITOR, EDITOR_SCHEMES, editorLink } from '../../core/editor-links.js';

export const EDITOR_LABELS = Object.freeze({ zed: 'Zed', vscode: 'VS Code', cursor: 'Cursor' });

// Settings item for the editor scheme (rendered by the settings UI).
export const EDITOR_SETTING = Object.freeze({
  id: 'source.editor',
  order: 70,
  label: 'Open in editor',
  scope: 'G',
  key: 'editor',
  type: 'choice',
  choices: Object.keys(EDITOR_SCHEMES),
  default: DEFAULT_EDITOR,
  description: 'Editor for source links (file:line:column)',
});

// The configured editor scheme; source.js does not pass it to sourceMarkup,
// so the source drawer installs the settings reader here at setup.
let editorSetting = () => DEFAULT_EDITOR;
export function useEditorSetting(read) {
  editorSetting = read;
}

export const editorScheme = value => (Object.hasOwn(EDITOR_SCHEMES, value ?? '')
  ? value : DEFAULT_EDITOR);

const SKETCH_CALL = /^sk[A-Z]/;
const basename = file => (file ? String(file).split('/').at(-1) : null);

const sameFrame = (a, b) => a.name === b.name
  && a.calledAt?.line === b.calledAt?.line && a.calledAt?.column === b.calledAt?.column
  && a.declaration?.line === b.declaration?.line
  && a.declaration?.column === b.declaration?.column;

// Recorded call stack without consecutive duplicates, outermost first (same
// rule as callPath() in src/viewer/history.mjs).
export function callPath(stack = []) {
  const frames = [];
  for (const frame of stack ?? []) {
    if (frames.length && sameFrame(frames.at(-1), frame)) continue;
    frames.push(frame);
  }
  return frames;
}

// Innermost frame that was called from somewhere: the helper of a call.
export const helperFrame = stack => [...callPath(stack)].reverse()
  .find(frame => frame.calledAt?.line) ?? null;

// The sk* call that recorded a sketch entity (same rule as the server).
export function sketchOperation(operations, source) {
  if (source?.kind !== 'sketch-entity') return null;
  const calls = operations.filter(op => SKETCH_CALL.test(op.name ?? ''));
  return calls.find(op => op.parameters?.[0]?.id === source.sketchId
    && op.parameters?.[1] === source.entityId)
    ?? calls.find(op => op.source?.span?.line === source.span?.line
      && (!source.span?.column || op.source?.span?.column === source.span.column))
    ?? null;
}

const spanOf = source => source?.span?.start ?? source?.span ?? null;

function operationDescriptor(op) {
  return {
    kind: 'operation', name: op.name, operationId: op.operationId ?? null,
    status: op.status ?? null, sequence: op.sequence, file: op.source?.file ?? null,
    sha256: op.source?.sha256 ?? null, span: spanOf(op.source), excerpt: op.source?.excerpt,
    callStack: op.callStack ?? [], parameters: op.parameters,
  };
}

// Operation descriptor from a bare source record (no source map in the
// scene): the body's recorded call stack is the only context.
function recordDescriptor(source, body) {
  return {
    kind: 'operation', name: null, operationId: body.debug?.operationId ?? null,
    status: null, sequence: null, file: source.file ?? null, sha256: source.sha256 ?? null,
    span: spanOf(source), excerpt: source.excerpt,
    callStack: body.debug?.callStack ?? body.identity?.operation?.callStack ?? [],
  };
}

// Source links of a selection: { primary, context, operation, helper }.
// `fallback` is the record-level source (core sourceFor), used when the scene
// has no source map entry for the entity's operation.
export function sourceLinks(records, fallback = null) {
  if (!records?.body) return null;
  const { scene, body, entity } = records;
  const operations = scene?.sourceMap?.operations ?? [];
  const identity = entity?.identity;
  const entityOperation = identity?.operationId
    ? operations.find(op => op.operationId === identity.operationId) : null;
  const bodyOperation = operations.find(op => op.sequence === body.debug?.sourceOperation);
  const recorded = entityOperation ?? bodyOperation;
  const operation = recorded ? operationDescriptor(recorded)
    : fallback?.file || spanOf(fallback) ? recordDescriptor(fallback, body) : null;
  let sketch = null;
  if (identity?.source?.kind === 'sketch-entity') {
    const call = sketchOperation(operations, identity.source);
    sketch = {
      kind: 'sketch-entity', name: call?.name ?? 'Sketch entity', operationId: null,
      status: call?.status ?? null, sequence: call?.sequence ?? null,
      sketchId: identity.source.sketchId ?? null, entityId: identity.source.entityId ?? null,
      curveType: identity.source.curveType ?? null, role: identity.source.role ?? null,
      file: call?.source?.file ?? operation?.file ?? null,
      sha256: call?.source?.sha256 ?? operation?.sha256 ?? null,
      span: spanOf(identity.source), excerpt: call?.source?.excerpt,
      callStack: call?.callStack ?? operation?.callStack ?? [],
    };
  }
  const primary = sketch ?? operation;
  if (!primary) return null;
  return {
    primary,
    context: sketch ? operation : null,
    operation,
    helper: helperFrame(primary.callStack),
  };
}

// Copyable source reference: the recorded record-level descriptor (keys
// unchanged) plus the face-level sketch entity and the helper call site.
export function sourceReference(links, source) {
  const reference = { ...(source ?? {}) };
  const { primary, helper } = links ?? {};
  if (primary?.kind === 'sketch-entity') {
    reference.sketchEntity = {
      name: primary.name, sketchId: primary.sketchId, entityId: primary.entityId,
      curveType: primary.curveType, file: primary.file, sha256: primary.sha256,
      span: primary.span,
    };
  }
  if (helper?.calledAt?.line) {
    reference.callSite = {
      name: helper.name, file: primary.file, line: helper.calledAt.line,
      ...(helper.calledAt.column ? { column: helper.calledAt.column } : {}),
    };
  }
  return reference;
}

const locationText = span => (span?.line
  ? `Line ${span.line}${span.column ? `:${span.column}` : ''}` : '');

// Editor URL for a location, or null (no absolute file path recorded).
export function editorHref(file, span, scheme = editorSetting()) {
  if (!span?.line) return null;
  return editorLink({ file, line: span.line, column: span.column }, editorScheme(scheme));
}

// Link text `label` to the editor, or plain text when no path is recorded.
function editorAnchor(label, file, span, scheme, className = 'source-link') {
  const href = editorHref(file, span, scheme);
  if (!href) return `<span class="${className} source-link-plain">${escape(label)}</span>`;
  return `<a class="${className}" href="${escape(href)}" data-editor="${escape(scheme)}"`
    + ` title="Open in ${escape(EDITOR_LABELS[scheme])}">${escape(label)}</a>`;
}

// Headline text parts of the primary source (plain data, used by the markup
// and the drawer): { name, detail, line, callSite: { name, file, span } }.
export function headlineOf(links) {
  const { primary, helper } = links;
  const detail = primary.kind === 'sketch-entity'
    ? (primary.entityId ? `"${primary.entityId}"` : primary.sketchId ?? '')
    : primary.operationId ?? '';
  return {
    name: primary.name ?? 'Operation',
    detail,
    line: primary.span?.line ?? null,
    callSite: helper ? { name: helper.name, file: primary.file, span: helper.calledAt } : null,
  };
}

// Plain text of the headline, e.g. 'copyBody (line 20) called from r10b.fs:1382'.
export function headlineText(links) {
  const head = headlineOf(links);
  if (head.callSite) {
    const where = basename(head.callSite.file);
    const site = where ? `${where}:${head.callSite.span.line}` : `line ${head.callSite.span.line}`;
    return `${head.callSite.name} (line ${head.line}) called from ${site}`;
  }
  return [head.name, head.detail].filter(Boolean).join(' ')
    + (head.line ? ` · line ${head.line}` : '');
}

function headlineMarkup(links, scheme) {
  const head = headlineOf(links);
  if (head.callSite) {
    const where = basename(head.callSite.file);
    const label = where ? `${where}:${head.callSite.span.line}`
      : `line ${head.callSite.span.line}`;
    return `<p class="source-headline"><strong>${escape(head.callSite.name)}</strong>`
      + ` (line ${escape(head.line)}) called from `
      + `${editorAnchor(label, head.callSite.file, head.callSite.span, scheme)}</p>`;
  }
  const detail = head.detail ? ` ${escape(head.detail)}` : '';
  const line = head.line ? ` · ${editorAnchor(`line ${head.line}`, links.primary.file,
    links.primary.span, scheme)}` : '';
  return `<p class="source-headline"><strong>${escape(head.name)}</strong>${detail}${line}</p>`;
}

// One numbered code line; `className` is a mark class (true = current line).
const codeLine = (number, text, className = '') => {
  const mark = className === true ? 'source-current' : className || '';
  return `<span class="source-code-line${mark ? ` ${mark}` : ''}" data-line="${number}">`
    + `<span class="source-line-number">${number}</span>${escape(text)}</span>`;
};

// Class of a code line: the primary line (current), or a context line (the
// operation call or the helper's call site in the same document).
export function lineClass(number, marks) {
  if (number === marks.current) return 'source-current';
  if (marks.context.includes(number)) return 'source-context-line';
  return '';
}

const excerptMarkup = (source, marks) => {
  if (!source.excerpt?.text) return '';
  const lines = source.excerpt.text.split('\n').map((text, index) => {
    const number = source.excerpt.firstLine + index;
    return codeLine(number, text, lineClass(number, marks));
  }).join('');
  return `<pre class="source-excerpt">${lines}</pre>`;
};

const pre = text => `<pre class="source-excerpt parameters">${escape(text)}</pre>`;

function lineageMarkup(ancestry) {
  if (!ancestry.length) return '';
  const operations = ancestry.map(op => {
    const line = op.source?.span?.line ? `:${op.source.span.line}` : '';
    return `<details class="source-parameters"><summary>${escape(op.type)} · ${escape(op.id)}`
      + `</summary><div class="source-path">${escape(op.source?.file ?? 'Source unavailable')}`
      + `${line}</div>${op.source?.excerpt?.text ? pre(op.source.excerpt.text) : ''}</details>`;
  }).join('');
  return '<details class="source-history"><summary>Earlier body operations · '
    + `${ancestry.length}</summary>${operations}</details>`;
}

function frameMarkup(frame, file, scheme) {
  const where = frame.calledAt?.line
    ? editorAnchor(`line ${frame.calledAt.line}`, file, frame.calledAt, scheme)
    : frame.declaration?.line ? `<small>defined at ${escape(frame.declaration.line)}</small>`
      : '';
  return `<div class="source-frame"><span>${escape(frame.name)}</span>${where}</div>`;
}

function historyMarkup(operation, scheme) {
  if (!operation) return '';
  const stack = callPath(operation.callStack);
  if (!operation.name && !stack.length) return '';
  const parameters = operation.parameters
    ? '<details class="source-parameters"><summary>Operation parameters</summary>'
      + `${pre(JSON.stringify(operation.parameters, null, 2))}</details>`
    : '';
  const operationMarkup = operation.name
    ? `<div class="source-frame"><strong>${escape(operation.name)}</strong>`
      + `<small>${escape(operation.status ?? '')}</small></div><div class="source-path">`
      + `${escape(operation.operationId ?? '')}</div>${parameters}`
    : '';
  return '<details class="source-history"><summary>Construction history</summary>'
    + `${stack.map(frame => frameMarkup(frame, operation.file, scheme)).join('')}`
    + `${operationMarkup}</details>`;
}

function contextMarkup(links, noun, scheme) {
  const operation = links.context;
  if (!operation) return '';
  const name = operation.name ? `<strong>${escape(operation.name)}</strong>` : 'Operation';
  const id = operation.operationId ? ` ${escape(operation.operationId)}` : '';
  const line = operation.span?.line
    ? editorAnchor(`line ${operation.span.line}`, operation.file, operation.span, scheme) : '';
  return '<div class="source-context"><span class="source-context-label">Context</span>'
    + `<div class="source-frame"><span>${name}${id}</span>${line}</div>`
    + `<p class="small muted">The operation that turned this sketch entity into the ${noun}.`
    + '</p></div>';
}

const entityNoun = ({ body, entity }) => {
  if (!entity || entity === body) return 'body';
  if (entity.surfaceType !== undefined) return 'face';
  return entity.curveType !== undefined ? 'edge' : 'point';
};

// The inspector section. `source` is the record-level source (core
// sourceFor); `options.editor` overrides the configured editor scheme.
export function sourceMarkup(source, records, options = {}) {
  const links = sourceLinks(records, source);
  if (!links) return '';
  const scheme = editorScheme(options.editor ?? editorSetting());
  const { primary, operation } = links;
  const sketch = primary.kind === 'sketch-entity';
  const noun = entityNoun(records);
  const lead = sketch
    ? `Sketch entity recorded for this ${noun}. The operation that produced it is context.`
    : 'Code for the operation that produced this body.';
  const sha = primary.sha256
    ? `<span class="muted">${escape(short(primary.sha256))}</span>` : '';
  const sameDocument = operation && operation.sha256 === primary.sha256;
  const marks = {
    current: primary.span?.line,
    context: [
      ...(sketch && sameDocument && operation.span?.line ? [operation.span.line] : []),
      ...(links.helper?.calledAt?.line ? [links.helper.calledAt.line] : []),
    ],
  };
  const editorLabel = `Open in ${EDITOR_LABELS[scheme]}`;
  const editor = editorHref(primary.file, primary.span, scheme)
    ? editorAnchor(editorLabel, primary.file, primary.span, scheme,
      'button secondary source-button source-editor')
    : '<span class="small muted source-no-path">No file path recorded</span>';
  const open = primary.sha256 || operation?.sha256
    ? '<button id="open-source" class="button secondary source-button source-open">'
      + 'Open frozen source</button>'
    : '';
  const ancestry = records.body.identity?.lineage?.history ?? [];
  return `<section class="inspector-section source-section" data-source-kind="${primary.kind}">`
    + `<h3>${sketch ? 'Sketch source' : 'Operation source'}</h3>`
    + headlineMarkup(links, scheme)
    + `<p class="small muted">${lead}</p><div class="source-path">`
    + `${escape(primary.file ?? 'Source location')}`
    + `<span class="source-location">${escape(locationText(primary.span))}</span>${sha}</div>`
    + excerptMarkup(primary, marks)
    + `<div class="source-actions">${editor}${open}</div>`
    + contextMarkup(links, noun, scheme)
    + `<button id="copy-source" class="button secondary source-button source-copy">${icon('copy')}`
    + 'Copy source reference</button>'
    + historyMarkup(operation, scheme) + lineageMarkup(ancestry) + '</section>';
}

export { codeLine };
