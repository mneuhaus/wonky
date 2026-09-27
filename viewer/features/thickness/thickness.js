// Wall thickness probe (package: thickness-probe, spec 3.3, 5 and 9.2).
//
//   K / rail     thickness tool, one-shot: the next click on a face probes the
//                wall there and the rail returns to Select. K again (or a
//                double-click on the tool) keeps the tool until Escape.
//   click        POST /api/models/:id/thickness { face, point } with the
//                clicked fragment and its display pick. The query worker
//                casts the exact inward-normal ray and decides every root by
//                kernel membership (src/viewer/thickness.mjs).
//   result       overlay line from entry to exit with the value and the
//                `kernel` chip, plus a card with the faces, tolerance, ray and
//                method. Positions of the line are kernel points on the ray;
//                the ray itself starts at the display pick projected onto the
//                exact surface, so the label says "anchor: display pick".
//   refusal      `unresolved`: dashed ray, a marker per blocking entity and
//                the list with the kernel reasons. The ray is never nudged.
//   latest wins  a new probe aborts the running request (the server also
//                supersedes per model), Escape cancels. A revision swap
//                re-probes when the face identity carries exactly
//                (POST /resolve), otherwise the probe is marked stale.
//
// Store: `thickness` { probe, locked }. Debug and QA handle
// (window.wonkyViewer.app): thicknessProbe(request, { modelId, reference }),
// thicknessState(), thicknessStats(), thicknessCancel(), thicknessClear().
import { escape } from '../../core/dom.js';
import { geometryAlias } from '../../core/scene-records.js';

export const id = 'thickness';
export const legacy = false;

export const TOOL = 'thickness';
export const HINT = 'Click a face to probe the wall along its inward normal · Alt-drag to orbit'
  + ' · Double-click the tool to keep it';
export const LOCKED_HINT = 'Click a face to probe the wall along its inward normal · Alt-drag'
  + ' to orbit · Locked · Esc to release';
const DISPLAY_ANCHOR = 'anchor: display pick';
const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor"'
  + ' stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16M4 19h16"/>'
  + '<path d="M12 7.5v9"/><path d="m9.5 10 2.5-2.5 2.5 2.5M9.5 14l2.5 2.5 2.5-2.5"/></svg>';
const BUTTON = `<button class="tool" type="button" data-tool="${TOOL}" aria-pressed="false"`
  + ' title="Wall thickness probe (K)" aria-label="Wall thickness probe">'
  + `${ICON}</button>`;
const PANEL = `<section id="thickness-panel" class="thickness-panel" hidden
  aria-label="Wall thickness probe">
  <div class="thickness-head">
    <span class="thickness-title">Wall thickness</span>
    <span id="thickness-state" class="thickness-state"></span>
    <button id="thickness-cancel" class="thickness-small" type="button"
      data-thickness-action="cancel" hidden>Cancel</button>
    <button id="thickness-collapse" class="thickness-icon" type="button"
      data-thickness-action="collapse" aria-expanded="true" aria-controls="thickness-body"
      aria-label="Collapse the probe details" title="Collapse">&minus;</button>
    <button class="thickness-icon" type="button" data-thickness-action="clear"
      aria-label="Clear the probe" title="Clear the probe (Esc)">&times;</button>
  </div>
  <div id="thickness-body" class="thickness-body" role="status" aria-live="polite"></div>
</section>`;

// Statuses that end a probe (a result or a refusal from the server).
export const ANSWERS = Object.freeze(['measured', 'unresolved', 'no-hit']);
const REASON_LABELS = Object.freeze({
  boundary: 'boundary hit',
  tangent: 'tangent hit',
  coincident: 'ray in face',
  'membership-unknown': 'membership unknown',
  overlap: 'overlapping faces',
  orientation: 'orientation',
  grazing: 'grazing hit',
  'root-unresolved': 'root unresolved',
  'root-invalid': 'root invalid',
  'root-range': 'root out of range',
  'unsupported-surface': 'unsupported surface',
  'start-boundary': 'start on boundary',
  'start-outside': 'start outside face',
  'start-missing': 'no start root',
});

const finite = value => typeof value === 'number' && Number.isFinite(value);
const isPoint = value => Array.isArray(value) && value.length === 3 && value.every(finite);
const add = (a, b) => a.map((value, axis) => value + b[axis]);
const scale = (a, s) => a.map(value => value * s);
const round = value => Math.round(value * 10) / 10;
const now = () => globalThis.performance?.now?.() ?? Date.now();

// ---- Pure helpers (tested) ----

// { face, point } request and the selection reference of a face pick.
export function pickRequest(scene, detail) {
  const reference = detail?.reference;
  if (!scene || reference?.entityType !== 'face' || !isPoint(detail.point)) return null;
  return {
    request: { face: geometryAlias(scene, reference), point: [...detail.point] },
    reference: { ...reference },
  };
}

// Selection reference of an alias ('B1.F5', 'B1.E16', 'B1.V3') in `scene`.
export function aliasReference(scene, alias, modelId = scene?.id) {
  const match = /^B([1-9][0-9]*)\.([FEV])([1-9][0-9]*)$/.exec(String(alias ?? ''));
  const body = match && scene?.bodies?.[Number(match[1]) - 1];
  if (!body) return null;
  const entityType = { F: 'face', E: 'edge', V: 'vertex' }[match[2]];
  return { modelId, bodyId: body.id, entityType, entityIndex: Number(match[3]) - 1 };
}

// Parameter along the ray up to which a refused probe is drawn: the
// furthest known point (exit candidate or blocking entity), else a fraction
// of the model size.
export function rayLength(result, extentMm = 20) {
  const values = [result?.hit?.t, ...(result?.blocking ?? []).map(item => item.t)]
    .filter(value => finite(value) && value > 0);
  return values.length ? Math.max(...values) : Math.max(1, 0.25 * extentMm);
}

// What the overlay draws for a probe entry (world coordinates):
//   { kind: 'pending', at } | { kind: 'span', from, to } | { kind: 'ray', from, to, markers }
export function probeGeometry(probe, { extentMm = 20 } = {}) {
  if (!probe) return null;
  if (probe.status === 'pending') {
    const at = probe.request?.point ?? probe.request?.origin;
    return isPoint(at) ? { kind: 'pending', at } : null;
  }
  const result = probe.result;
  if (!result || !ANSWERS.includes(result.status)) return null;
  if (result.status === 'measured' && isPoint(result.entry?.point) && isPoint(result.hit?.point)) {
    return { kind: 'span', from: result.entry.point, to: result.hit.point };
  }
  const { origin, direction } = result.ray ?? {};
  if (!isPoint(origin) || !isPoint(direction)) return null;
  const markers = (result.blocking ?? []).filter(item => isPoint(item.point))
    .map(item => ({ at: item.point, label: item.alias }));
  return {
    kind: 'ray', from: origin, to: add(origin, scale(direction, rayLength(result, extentMm))),
    markers,
  };
}

// Label of a probe: { value, chip, detail } (chip: an exactness value).
export function probeLabel(probe, format) {
  const result = probe?.result;
  switch (probe?.status) {
    case 'pending':
      return { value: 'probing…', chip: null, detail: probe.request?.face
        ? `${probe.request.face} · query worker` : 'ray · query worker' };
    case 'measured':
      return {
        value: format.formatLength(result.mm, result.toleranceMm),
        chip: result.exactness,
        detail: `${result.entry.alias} → ${result.hit.alias} · ${result.ray.mode === 'face'
          ? DISPLAY_ANCHOR : 'given ray'}`,
      };
    case 'unresolved':
      return {
        value: 'unresolved', chip: result.exactness,
        detail: result.blocking.length ? `blocked by ${[...new Set(result.blocking
          .map(item => item.alias))].join(', ')} · not nudged` : result.reason,
      };
    case 'no-hit':
      return { value: 'no hit', chip: result.exactness, detail: result.reason };
    default:
      return null;
  }
}

// Short status for the card header: the value when measured.
export function stateText(probe, format) {
  if (probe?.status === 'measured') {
    return `${format.formatLength(probe.result.mm, probe.result.toleranceMm)} · kernel`;
  }
  if (probe?.status === 'pending') return probe.carrying ? 'carrying…' : 'probing…';
  return String(probe?.status ?? '').replace('-', ' ');
}

const tAt = (value, result, format) => format.formatLength(value,
  result.bodyToleranceMm ?? result.toleranceMm ?? 1e-4);

// Plain-text summary of a probe (Copy).
export function probeText(probe, format) {
  const result = probe?.result;
  if (!result) return '';
  const lines = [`Wall thickness probe · model ${probe.modelId}`];
  const ray = result.ray;
  lines.push(ray.mode === 'face'
    ? `Ray: inward normal of ${ray.face} at the display pick [${ray.pick.join(', ')}],`
      + ` projected onto the exact surface: origin [${ray.origin.join(', ')}]`
    : `Ray: origin [${ray.origin.join(', ')}], direction [${ray.direction.join(', ')}]`);
  if (result.status === 'measured') {
    lines.push(`Thickness: ${format.formatWithTolerance(result.mm, result.toleranceMm)}`
      + ` (${result.exactness}) from ${result.entry.alias} to ${result.hit.alias}`);
  } else {
    lines.push(`Status: ${result.status}${result.reason ? ` (${result.reason})` : ''}`);
    for (const item of result.blocking ?? []) {
      lines.push(`  blocking ${item.alias}${item.edges?.length ? ` (${item.edges.join(', ')})`
        : ''}: ${item.reason}${finite(item.t) ? ` at ${tAt(item.t, result, format)}` : ''}`
        + ` · ${item.text}`);
    }
  }
  lines.push(`Method: ${result.method}`);
  return lines.join('\n');
}

// SVG markup of a probe drawing seen through one pane.
export function probeMarkup({ geometry, label, pane, project, height, chips }) {
  const point = world => project(world, pane);
  const ok = screen => Number.isFinite(screen?.x) && Number.isFinite(screen?.y);
  const clip = `thickness-${pane.side}-clip`;
  const parts = [];
  let anchor;
  if (geometry.kind === 'pending') {
    anchor = point(geometry.at);
    if (!ok(anchor)) return '';
    parts.push(`<circle class="thickness-pulse" cx="${round(anchor.x)}" cy="${round(anchor.y)}"`
      + ' r="9"/><circle class="thickness-end" cx="' + round(anchor.x) + '" cy="'
      + round(anchor.y) + '" r="3"/>');
  } else {
    const a = point(geometry.from);
    const b = point(geometry.to);
    if (!ok(a) || !ok(b)) return '';
    anchor = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const line = `x1="${round(a.x)}" y1="${round(a.y)}" x2="${round(b.x)}" y2="${round(b.y)}"`;
    const kind = geometry.kind === 'span' ? 'thickness-line' : 'thickness-ray';
    parts.push(`<line class="thickness-halo" ${line}/><line class="${kind}" ${line}/>`);
    const ends = geometry.kind === 'span' ? [a, b] : [a];
    for (const end of ends) {
      parts.push(`<circle class="thickness-end" cx="${round(end.x)}" cy="${round(end.y)}"`
        + ' r="3"/>');
    }
    for (const marker of geometry.markers ?? []) {
      const m = point(marker.at);
      if (!ok(m)) continue;
      parts.push(`<g class="thickness-block" transform="translate(${round(m.x)} ${round(m.y)})">`
        + '<path d="M-5-5 5 5M5-5-5 5"/></g>');
    }
  }
  if (label) {
    const chip = label.chip ? chips.exactnessChip(label.chip).label : '';
    const first = `${label.value}${chip ? `  ${chip}` : ''}`;
    const detail = label.detail ?? '';
    const width = Math.max(first.length * 6.8, detail.length * 5.7) + 16;
    const x = round(anchor.x + 14);
    const y = round(anchor.y - 22);
    parts.push(`<g class="thickness-label" transform="translate(${x} ${y})">`
      + `<rect class="thickness-box" x="0" y="0" width="${round(width)}" height="36" rx="5"/>`
      + `<text class="thickness-value" x="8" y="15">${escape(label.value)}`
      + (chip ? `<tspan class="thickness-chip" dx="8">${escape(chip)}</tspan>` : '')
      + `</text><text class="thickness-detail" x="8" y="29">${escape(detail)}</text></g>`);
  }
  return `<defs><clipPath id="${clip}"><rect x="${pane.clipX}" y="0" width="${pane.clipWidth}"`
    + ` height="${height}"/></clipPath></defs><g class="thickness-probe thickness-kind-${
      escape(geometry.kind)}" clip-path="url(#${clip})">${parts.join('')}</g>`;
}

// ---- Feature ----

export function setup(ctx) {
  const {
    store, state, app, api, requests, slots, commands, keyboard, pointer, overlay, env,
    format, dom: { $ },
  } = ctx;
  slots.toolbar.tool({ id: 'tool.thickness', order: 25, html: BUTTON });
  slots.add('stage', { id: 'thickness.panel', order: 29, html: PANEL });

  const thickness = () => store.get().thickness;
  const stats = {
    requests: 0, completed: 0, superseded: 0, cancelled: 0, errors: 0, carried: 0,
    stale: 0, lastMs: null, lastStatus: null,
  };
  const scope = requests.scope('thickness');
  let pending = false;
  let releaseEscape = null;
  let serial = 0;

  const scene = modelId => state.scenes.get(modelId) ?? null;
  const displayed = () => [...new Set([state.after, state.compare ? state.before : null])]
    .filter(Boolean);
  function setProbe(probe, reason = 'thickness.probe') {
    store.update(reason, current => {
      current.thickness.probe = probe;
    });
    render();
    app.scheduleDraw?.();
  }

  // ---- Requests (query worker, latest wins) ----

  async function post(modelId, request, signal) {
    const response = await api.fetch(`/api/models/${encodeURIComponent(modelId)}/thickness`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request), signal,
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return data;
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }

  // Probes `request` ({ face, point } or { origin, direction, body? }) on
  // `modelId`; resolves with the server answer, or null when superseded.
  async function probe(request, { modelId = state.after, reference = null, carried = null } = {}) {
    if (!modelId) return null;
    if (pending) stats.superseded++;
    const { signal, current } = scope.begin();
    const started = now();
    const context = { id: ++serial, modelId, request, reference, carried, startedAt: started };
    pending = true;
    stats.requests++;
    setProbe({ status: 'pending', ...context });
    try {
      const result = await post(modelId, request, signal);
      if (!current()) return null;
      pending = false;
      stats.completed++;
      stats.lastMs = now() - started;
      stats.lastStatus = result.status;
      setProbe({ status: result.status, ...context, result, ms: stats.lastMs });
      return result;
    } catch (error) {
      if (!current() || error?.name === 'AbortError') return null;
      pending = false;
      stats.errors++;
      stats.lastStatus = error.status === 501 ? 'unsupported' : 'error';
      setProbe({ status: stats.lastStatus, ...context, message: error.message });
      return null;
    }
  }

  function cancel() {
    if (!pending) return false;
    pending = false;
    stats.cancelled++;
    scope.abort();
    const current = thickness().probe;
    setProbe({ ...current, status: 'cancelled' });
    return true;
  }

  function clear() {
    if (pending) {
      pending = false;
      stats.cancelled++;
      scope.abort();
    }
    setProbe(null, 'thickness.clear');
  }

  // A swapped revision: the probe re-runs when its face carries exactly.
  async function carry(previous, modelId) {
    const request = previous.request;
    if (request.origin) return probe(request, { modelId, carried: { from: previous.modelId } });
    if (!previous.reference) {
      return markStale(previous, modelId, 'the probed face has no reference');
    }
    if (pending) stats.superseded++;
    const { signal, current } = scope.begin();
    pending = true;
    setProbe({ ...previous, status: 'pending', modelId, carrying: true });
    let answer;
    try {
      // The reference names its own revision (a carry may be interrupted by
      // another swap, so the entry's modelId is not always the source).
      answer = await api.post(`/api/models/${encodeURIComponent(modelId)}/resolve`, {
        from: previous.reference.modelId ?? previous.modelId,
        references: [previous.reference],
      }, { signal });
    } catch (error) {
      if (!current() || error?.name === 'AbortError') return null;
      pending = false;
      return markStale(previous, modelId, error.message);
    }
    if (!current()) return null;
    pending = false;
    const resolved = answer.results?.[0];
    if (resolved?.status !== 'exact' || !resolved.reference) {
      return markStale(previous, modelId, resolved?.reason ?? `${request.face} did not resolve`);
    }
    stats.carried++;
    const target = scene(modelId);
    const face = target ? geometryAlias(target, resolved.reference) : resolved.alias;
    return probe({ face, point: request.point }, {
      modelId, reference: resolved.reference,
      carried: { from: previous.reference.modelId ?? previous.modelId, face: request.face },
    });
  }

  // The probe stays visible as a note for the displayed model; the next swap drops it.
  function markStale(previous, modelId, reason) {
    stats.stale++;
    setProbe({ ...previous, status: 'stale', modelId, from: previous.modelId, result: null,
      reason });
    return null;
  }

  // ---- Tool ----

  function hint() {
    const element = $('#interaction-hint');
    if (element && state.tool === TOOL) {
      element.textContent = thickness().locked ? LOCKED_HINT : HINT;
    }
  }
  function unlock() {
    releaseEscape?.();
    releaseEscape = null;
    if (thickness().locked) {
      store.update('thickness.locked', current => {
        current.thickness.locked = false;
      });
    }
  }
  function activate() {
    if (state.tool === TOOL && !thickness().locked) {
      store.update('thickness.locked', current => {
        current.thickness.locked = true;
      });
      releaseEscape = keyboard.pushEscape(() => {
        unlock();
        app.tool('select');
      });
      $(`.tool[data-tool="${TOOL}"]`)?.classList.add('locked');
      hint();
      return;
    }
    app.tool(TOOL);
    hint();
  }
  const stopTool = store.select(current => current.annotations?.tool, tool => {
    if (tool !== TOOL) {
      unlock();
      $(`.tool[data-tool="${TOOL}"]`)?.classList.remove('locked');
    } else hint();
  });

  // In a workspace assembly the hit may be any member: its point is sent in
  // that model's own frame, and without its JSON scene the alias comes from
  // the draw model (same rule).
  function probeAt(point) {
    const hit = app.pick?.detail?.(point.x, point.y, 'face');
    const detail = hit?.localPoint ? { ...hit, point: hit.localPoint } : hit;
    const modelId = detail?.reference.modelId;
    const alias = detail && ctx.renderer?.alias?.(detail.reference);
    const picked = !detail ? null : scene(modelId) ? pickRequest(scene(modelId), detail)
      : alias && detail.reference.entityType === 'face' ? {
        request: { face: alias, point: [...detail.point] }, reference: { ...detail.reference },
      } : null;
    if (!picked) {
      ctx.notify('Click a face of the model to probe its wall thickness');
      return null;
    }
    if (!thickness().locked) app.tool('select');
    return probe(picked.request, {
      modelId: detail.reference.modelId, reference: picked.reference,
    });
  }

  pointer.tool({
    id: TOOL,
    up(point, gesture) {
      if (!gesture.moved) probeAt(point);
    },
  });

  // Hover preview of the face the next click probes.
  let hoverPoint = null;
  let hoverPending = false;
  pointer.onHover(point => {
    if (state.tool !== TOOL) return;
    hoverPoint = point;
    if (hoverPending) return;
    hoverPending = true;
    env.requestAnimationFrame(() => {
      hoverPending = false;
      const next = hoverPoint;
      hoverPoint = null;
      if (!next || state.tool !== TOOL || pointer.gesture() || state.loading) return;
      const reference = app.pick(next.x, next.y, 'face');
      const pane = reference ? ctx.panes.paneAt(next.x, next.y)?.side ?? null : null;
      app.setHover?.(reference, pane);
    });
  });

  commands.register({
    id: 'thickness.tool', label: 'Wall thickness probe', keys: ['K'], run: activate,
    enabled: () => !!state.after,
  });
  commands.register({ id: 'thickness.cancel', label: 'Cancel the thickness probe', run: cancel });
  commands.register({ id: 'thickness.clear', label: 'Clear the thickness probe', run: clear });
  const button = commands.bind(`.tool[data-tool="${TOOL}"]`, 'thickness.tool');
  if (button) {
    button.ondblclick = () => {
      if (state.tool !== TOOL) app.tool(TOOL);
      if (!thickness().locked) activate();
    };
  }
  // Escape (default chain): cancels a running probe, else clears the result.
  keyboard.onEscape(() => {
    if (!cancel() && thickness().probe) clear();
  }, 20);

  // ---- Card ----

  const chipMarkup = (exactness, tolerance) => format.exactnessChipMarkup(exactness, tolerance);
  const aliasButton = (alias, modelId) => `<button type="button" class="thickness-alias"`
    + ` data-thickness-select="${escape(alias)}" data-model="${escape(modelId)}"`
    + ` title="Select ${escape(alias)}">${escape(alias)}</button>`;

  function blockingMarkup(result, modelId) {
    return `<ul class="thickness-blocking">${result.blocking.map(item => {
      const at = finite(item.t) ? ` at ${escape(tAt(item.t, result, format))}` : '';
      const edges = (item.edges ?? []).map(edge => aliasButton(edge, modelId)).join(' ');
      return `<li><span class="thickness-reason">${escape(REASON_LABELS[item.reason]
        ?? item.reason)}</span> ${aliasButton(item.alias, modelId)}${edges ? ` ${edges}` : ''}`
        + `<small>${escape(item.text ?? '')}${at}${item.membership
          ? ` · kernel: ${escape(item.membership)}` : ''}${item.detail
          ? ` · ${escape(item.detail)}` : ''}</small></li>`;
    }).join('')}</ul>`;
  }

  const vector = values => `[${values.map(value => Number(value.toFixed(6))).join(', ')}]`;

  // One line under the value: where the ray comes from.
  function anchorMarkup(result) {
    const ray = result.ray;
    if (ray.mode !== 'face') {
      return `<p class="thickness-note">Given ray ${escape(vector(ray.origin))} along`
        + ` ${escape(vector(ray.direction))}.</p>`;
    }
    return '<p class="thickness-note">Along the exact inward normal at your click; the value'
      + ' depends on where you click.</p>';
  }

  // "How": method, ray numbers and every kernel refusal that was settled.
  function howMarkup(result) {
    const ray = result.ray;
    const pick = ray.mode === 'face'
      ? `<li>Origin: the display pick ${chipMarkup('display-approximation', 0.02)} projected`
        + ` onto the exact surface of ${escape(ray.face)} ${chipMarkup('exact-parameters')}`
        + ` (offset ${escape(format.formatLength(ray.pickOffsetMm, 0.001))}):`
        + ` ${escape(vector(ray.origin))}, direction ${escape(vector(ray.direction))}.</li>`
      : '';
    const refused = (result.refusedRoots ?? []).map(item => `<li>${escape(item.alias)}:`
      + ` line_surface ${escape(item.rootKind)}, settled as ${escape(item.how)}`
      + ` (offset ${escape(format.formatLength(item.offsetMm, 1e-4))}${item.beyondMm
        ? `; any crossing ≥ ${escape(item.beyondMm.toExponential(0))} mm` : ''})</li>`)
      .join('');
    const coincident = result.coincident?.length ? `<li>Ray in the supporting surface of`
      + ` ${escape(result.coincident.join(', '))}: checked by membership along the span.</li>`
      : '';
    return `<details class="thickness-how"><summary>How · ${round(result.ms)} ms</summary>`
      + `<ul><li>${escape(result.method)}.</li>${pick}${coincident}${refused}</ul></details>`;
  }

  const COPY = '<button type="button" class="thickness-small" data-thickness-action="copy">'
    + 'Copy</button>';

  function bodyMarkup(entry) {
    const result = entry.result;
    const carried = entry.carried?.face
      ? `<p class="thickness-note">Re-probed on this revision: ${escape(entry.carried.face)}`
        + ` carried exactly to ${escape(entry.request.face)}.</p>` : '';
    switch (entry.status) {
      case 'pending':
        return `<p class="thickness-pending">${entry.carrying
          ? `Carrying ${escape(entry.request.face)} to the new revision…`
          : `Probing ${escape(entry.request.face ?? 'the ray')} in the query worker…`}</p>`;
      case 'measured':
        return `<p class="thickness-result"><strong>${escape(format.formatLength(result.mm,
          result.toleranceMm))}</strong> ${chipMarkup(result.exactness)}`
          + ` <span class="thickness-tolerance" title="Larger of the entry and exit face`
          + ` tolerances">±${escape(format.formatTolerance(result.toleranceMm))} mm</span></p>`
          + `<p class="thickness-faces">${aliasButton(result.entry.alias, entry.modelId)}`
          + `${result.entry.logical ? ` <small>(${escape(result.entry.logical)})</small>` : ''}`
          + ` → ${aliasButton(result.hit.alias, entry.modelId)}${result.hit.logical
            ? ` <small>(${escape(result.hit.logical)})</small>` : ''}</p>`
          + carried + anchorMarkup(result)
          + `<div class="thickness-foot">${howMarkup(result)}${COPY}</div>`;
      case 'unresolved':
      case 'no-hit':
        return `<p class="thickness-result thickness-refused"><strong>${escape(entry.status
          === 'no-hit' ? 'no hit' : 'unresolved')}</strong> ${chipMarkup(result.exactness)}`
          + ` <span class="thickness-verbatim">${escape(result.reason ?? '')}</span></p>`
          + (result.blocking.length ? blockingMarkup(result, entry.modelId) : '')
          + carried + anchorMarkup(result)
          + '<p class="thickness-note">The ray is not nudged: probe another point.</p>'
          + `<div class="thickness-foot">${howMarkup(result)}${COPY}</div>`;
      case 'unsupported':
        return `<p class="thickness-refused">${chipMarkup('unsupported')} <span`
          + ` class="thickness-verbatim">${escape(entry.message)}</span></p>`;
      case 'error':
        return `<p class="thickness-refused">Probe failed: <span class="thickness-verbatim">`
          + `${escape(entry.message)}</span></p>`;
      case 'stale':
        return `<p class="thickness-note">The displayed model changed; the probe of`
          + ` ${escape(entry.request.face ?? 'the ray')} was not carried: ${escape(entry.reason)}.`
          + ' Press K to probe again.</p>';
      case 'cancelled':
        return '<p class="thickness-note">Probe cancelled.</p>';
      default:
        return '';
    }
  }

  function render() {
    const panel = $('#thickness-panel');
    if (!panel) return;
    const entry = thickness()?.probe ?? null;
    panel.hidden = !entry;
    const cancelButton = $('#thickness-cancel');
    if (cancelButton) cancelButton.hidden = entry?.status !== 'pending';
    const tag = $('#thickness-state');
    if (tag) {
      tag.textContent = entry ? stateText(entry, format) : '';
      tag.className = `thickness-state thickness-state-${entry?.status ?? 'none'}`;
    }
    const collapsed = !!thickness()?.collapsed;
    const toggle = $('#thickness-collapse');
    if (toggle) {
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.textContent = collapsed ? '+' : '−';
      toggle.title = collapsed ? 'Expand' : 'Collapse';
    }
    const body = $('#thickness-body');
    if (body) {
      body.hidden = collapsed;
      body.innerHTML = entry ? bodyMarkup(entry) : '';
    }
  }

  function selectAlias(alias, modelId) {
    const reference = aliasReference(scene(modelId), alias, modelId);
    if (!reference) return;
    app.select?.(reference);
  }
  const panelElement = $('#thickness-panel');
  if (panelElement) {
    panelElement.onclick = event => {
      const target = event.target?.closest?.('[data-thickness-action], [data-thickness-select]');
      if (!target) return;
      const { thicknessAction: action, thicknessSelect: alias, model } = target.dataset;
      if (alias) selectAlias(alias, model);
      else if (action === 'cancel') cancel();
      else if (action === 'clear') clear();
      else if (action === 'collapse') {
        store.update('thickness.collapsed', current => {
          current.thickness.collapsed = !current.thickness.collapsed;
        });
        render();
      }
      else if (action === 'copy') {
        ctx.copyText(probeText(thickness().probe, format), 'Thickness probe copied');
      }
    };
  }

  // ---- Overlay ----

  const extentOf = modelId => {
    const bounds = scene(modelId)?.bounds;
    if (!bounds?.min || !bounds?.max) return 20;
    return Math.hypot(...bounds.max.map((value, axis) => value - bounds.min[axis]));
  };
  const removeLayer = overlay.layer({
    id: 'thickness.probe',
    order: 62,
    render({ height }) {
      const entry = thickness()?.probe;
      const geometry = probeGeometry(entry, { extentMm: extentOf(entry?.modelId) });
      if (!geometry) return '';
      const label = probeLabel(entry, format);
      return app.viewPanes().filter(pane => pane.modelId === entry.modelId
        || pane.members?.some(member => member.modelId === entry.modelId))
        .map(pane => probeMarkup({ geometry, label, pane, project: app.project, height,
          chips: format })).join('');
    },
  });

  // ---- Revision swap ----

  const stopModel = store.select(current => current.compare?.after ?? null, () => {
    const entry = thickness()?.probe;
    if (!entry || displayed().includes(entry.modelId) || !state.after) return;
    if (entry.status === 'pending' && !entry.carrying) {
      pending = false;
      scope.abort();
    }
    if (['stale', 'cancelled', 'error', 'unsupported'].includes(entry.status)) {
      setProbe(null, 'thickness.clear');
      return;
    }
    carry(entry, state.after);
  });

  queueMicrotask(render);

  const snapshot = () => {
    const entry = thickness()?.probe;
    return JSON.parse(JSON.stringify({ locked: thickness()?.locked ?? false, probe: entry ?? null,
      label: entry ? probeLabel(entry, format) : null }));
  };

  return {
    api: {
      thicknessProbe: probe,
      thicknessState: snapshot,
      thicknessStats: () => ({ ...stats, pending }),
      thicknessCancel: cancel,
      thicknessClear: clear,
    },
    defaults: { thickness: { probe: null, locked: false, collapsed: false } },
    dispose() {
      removeLayer();
      stopModel();
      stopTool();
      releaseEscape?.();
      scope.abort();
    },
  };
}
