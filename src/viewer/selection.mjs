// Ephemeral browser selection for GET/POST /api/selection (spec 3.7, 9.2).
// Package: reviews-context.
//
// Frozen signature:
//   createSelectionStore() -> { get() -> selection | null, set(selection) }
//
// The browser posts its selection (primary first) whenever it changes, so an
// agent can "look at the face Marc selected" with GET /api/selection instead
// of asking for copied indices. The store lives in server memory only:
// nothing is written to disk, and the last post from any tab wins.
//
// describeSelection() adds, per reference, the alias, the logical face and an
// exact summary from the stored analytic parameters (src/viewer/geometry.mjs,
// `exact-parameters` with tolerance t; bodies: recorded counts, volume and
// bounds). The display mesh is never read.
import { byModel, exactSummaries, readModelIds, readReferences, referenceRecord, revisionText }
  from './context.mjs';
import { HttpError } from './http.mjs';

export const SELECTION_SCHEMA = 'wonky.viewer-selection/1';
export const SELECTION_NOTE = 'The current browser selection (ephemeral, last post wins).'
  + ' Aliases refer only to the modelId of their reference; `detail` is the entity route of'
  + ' this server.';
const CLIENT = /^[A-Za-z0-9_-]{1,64}$/;

export function createSelectionStore({ now = () => new Date() } = {}) {
  let current = null;
  let sequence = 0;
  return {
    get: () => current,
    set(selection) {
      current = selection
        ? { ...selection, sequence: ++sequence, updatedAt: now().toISOString() }
        : null;
      return current;
    },
  };
}

// Validates a POST body: { references, visible?, client? }.
export function readSelection(body, { has } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Selection must be an object with references');
  }
  if (body.client !== undefined && body.client !== null
    && (typeof body.client !== 'string' || !CLIENT.test(body.client))) {
    throw new HttpError(400, 'Invalid client id');
  }
  return {
    references: readReferences(body.references, { has }),
    visible: readModelIds(body.visible, { has }),
    client: body.client ?? null,
  };
}

const revisionOf = metadata => (Number.isInteger(metadata?.live?.revision)
  ? metadata.live.revision : null);

// The selection with alias, logical face and exact summary per reference.
export function describeSelection(selection, { registry, kernel }) {
  const empty = !selection;
  const references = selection?.references ?? [];
  const summaries = new Map();
  const errors = new Map();
  for (const [id, items] of byModel(references)) {
    try {
      summaries.set(id, exactSummaries(registry.model(id), id, items.map(item => item.reference),
        { kernel }));
    } catch (error) {
      errors.set(id, error.message);
    }
  }
  const primary = references[0]?.modelId ?? selection?.visible?.[0] ?? null;
  const metadata = primary ? registry.get(primary) : null;
  const describe = id => ({
    modelId: id, label: registry.get(id)?.label ?? null, revision: revisionOf(registry.get(id)),
  });
  return {
    schema: SELECTION_SCHEMA,
    updatedAt: selection?.updatedAt ?? null,
    sequence: selection?.sequence ?? 0,
    client: selection?.client ?? null,
    modelId: primary,
    revision: revisionOf(metadata),
    model: metadata ? {
      label: metadata.label ?? null, sourcePath: metadata.sourcePath ?? null,
      description: revisionText(metadata, { snapshotDirectory: registry.snapshotDirectory }),
    } : null,
    visible: (selection?.visible ?? []).map(describe),
    references: references.map(reference => {
      const record = referenceRecord(registry.model(reference.modelId), reference);
      const summary = summaries.get(reference.modelId)?.get(record.alias);
      return {
        ref: { ...reference },
        alias: record.alias,
        logical: record.logical ?? null,
        summary: summary ? {
          text: summary.text, exactness: summary.exactness, toleranceMm: summary.toleranceMm,
          entry: summary.entry,
        } : {
          text: null, exactness: 'unsupported',
          reason: errors.get(reference.modelId) ?? 'no exact summary',
        },
        identity: record.identity,
        ...(record.source ? { source: record.source } : {}),
        detail: `/api/models/${reference.modelId}/entities/${record.alias}`,
      };
    }),
    note: empty ? 'No browser has posted a selection yet.' : SELECTION_NOTE,
  };
}
