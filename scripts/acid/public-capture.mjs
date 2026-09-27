// Public document metadata is allowlisted; account profiles never enter fixtures.
export const PRIVATE_POTS = new Set(['local', 'sessioninfo', 'metering']);
const pick = (value, keys) => Object.fromEntries(keys.filter(k => Object.hasOwn(value, k)).map(k => [k, value[k]]));
export function publicDocument(document) {
  const result = pick(document, ['id', 'name', 'href', 'public', 'publicLinkable', 'anonymousAccessAllowed', 'jsonType', 'resourceType', 'documentType', 'createdAt', 'modifiedAt', 'defaultElementId']);
  if (document.defaultWorkspace) result.defaultWorkspace = pick(document.defaultWorkspace, ['id', 'documentId', 'microversion', 'name', 'href', 'type', 'createdAt', 'modifiedAt']);
  return result;
}
export function publicRuns(runs) {
  return runs.map(({startedAt, variants, finishedAt}) => ({startedAt, variants, finishedAt}));
}
