// Revisions grouped per source (library, selectors, "Compare with previous").
// Owner: model-first-compare.
//
// Facts come from GET /api/compare/revisions: per model id { kind, source,
// revision, time, timeBasis, recordedSource }. kind is 'input' (a .brep.json
// input, source = its path, rN = registration order in this session),
// 'live' (live-server revisions) or 'archive' (snapshots from
// <reviews>/models, one group). Without facts (legacy seam, failed request)
// localFacts() derives the same grouping from the workspace list, without
// times.
export const ARCHIVE = 'archive';
const SNAPSHOT = /[/\\]models[/\\][a-f0-9]{64}\.brep\.json$/;

export function localFacts(models) {
  const counters = new Map();
  return new Map(models.map(model => {
    const archive = SNAPSHOT.test(model.sourcePath ?? '');
    const source = archive ? ARCHIVE : model.sourcePath ?? model.id;
    const revision = archive ? null : (counters.get(source) ?? 0) + 1;
    if (!archive) counters.set(source, revision);
    const fact = {
      modelId: model.id, kind: archive ? 'archive' : 'input', source, revision,
      time: null, timeBasis: null, recordedSource: null,
    };
    return [model.id, fact];
  }));
}

export const factsFrom = response => new Map((response?.revisions ?? [])
  .map(fact => [fact.modelId, fact]));

const basename = path => String(path ?? '').split(/[/\\]/).at(-1);
const byTimeDescending = (left, right) => (right.time ?? '').localeCompare(left.time ?? '')
  || right.order - left.order;

// Groups in order of first appearance (command-line order), archive last.
// Each group: { key, kind, label, path, revisions: [entry, newest first] };
// entry: { id, model, kind, source, revision, time, timeBasis, recordedSource, order }.
export function groupRevisions(models, facts) {
  const fallback = localFacts(models);
  const groups = new Map();
  models.forEach((model, order) => {
    const fact = facts?.get(model.id) ?? fallback.get(model.id);
    const key = fact.kind === 'archive' ? ARCHIVE : fact.source;
    if (!groups.has(key)) {
      groups.set(key, {
        key, kind: fact.kind, path: fact.kind === 'archive' ? null : fact.source, revisions: [],
      });
    }
    groups.get(key).revisions.push({
      id: model.id, model, kind: fact.kind, source: key, revision: fact.revision ?? null,
      time: fact.time ?? null, timeBasis: fact.timeBasis ?? null,
      recordedSource: fact.recordedSource ?? null, order,
    });
  });
  const result = [...groups.values()];
  for (const group of result) {
    if (group.kind === 'archive') group.revisions.sort(byTimeDescending);
    else group.revisions.sort((left, right) => right.revision - left.revision
      || right.order - left.order);
    group.label = groupLabel(group);
  }
  return [
    ...result.filter(group => group.kind !== 'archive'),
    ...result.filter(group => group.kind === 'archive'),
  ];
}

function groupLabel(group) {
  if (group.kind === 'archive') return 'Archived snapshots';
  const newest = group.revisions[0];
  if (group.kind === 'live') return basename(group.path) || newest.model.label || 'Live source';
  return newest.model.label ?? basename(group.path);
}

// id -> { group, entry, index, previous, newest }
export function indexRevisions(groups) {
  const index = new Map();
  for (const group of groups) {
    group.revisions.forEach((entry, position) => {
      const previous = group.kind === 'archive' ? null : group.revisions[position + 1] ?? null;
      index.set(entry.id, { group, entry, position, previous, newest: group.revisions[0] });
    });
  }
  return index;
}

const pad = value => String(value).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov',
  'Dec'];

// "14:05" today, "Sep 21 14:05" otherwise; null without a valid time.
export function formatRevisionTime(time, now = new Date()) {
  if (!time) return null;
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return null;
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
  if (sameDay) return clock;
  const year = date.getFullYear() === now.getFullYear() ? '' : ` ${date.getFullYear()}`;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}${year} ${clock}`;
}

export const TIME_BASIS = Object.freeze({
  built: 'build finished',
  'first-registered': 'first registered in this review directory',
  'first-seen': 'first seen by this viewer',
});

// "r3 · 14:05", "archived · Sep 21 14:05", "r1".
export function revisionText(entry, now) {
  if (!entry) return '';
  const time = formatRevisionTime(entry.time, now);
  const head = entry.kind === 'archive' ? 'archived' : `r${entry.revision}`;
  return time ? `${head} · ${time}` : head;
}

// Title for a revision in lists and selectors: archived snapshots show the
// recorded source file instead of "Saved revision …".
export function entryTitle(entry, group) {
  if (entry.kind === 'archive') {
    return basename(entry.recordedSource?.file) || entry.model.label || 'Archived snapshot';
  }
  return group?.label ?? entry.model.label ?? 'Model';
}

export function timeTitle(entry) {
  if (!entry?.time) return 'Revision time unknown';
  return `${new Date(entry.time).toLocaleString()} (${TIME_BASIS[entry.timeBasis] ?? 'time'})`;
}

// Revisions matching a search text (label, id, source path, rN, time).
export function matchesSearch(entry, group, text, now) {
  if (!text) return true;
  const haystack = [entryTitle(entry, group), group.label, entry.id, group.path ?? '',
    entry.recordedSource?.file ?? '', revisionText(entry, now)].join(' ').toLowerCase();
  return haystack.includes(text.toLowerCase());
}
