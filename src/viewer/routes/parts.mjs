// Parts route (spec 9.2). Package: parts-tree.
//
//   GET /api/models/:id/parts
//     { schema: wonky.viewer-parts/1, modelId, scope, exactness, totals,
//       logicalFacesReason, bodies: [{ index, alias, id, name, label, settingsKey,
//       appearance, color, representation, counts {faces, logicalFaces, edges, vertices},
//       volumeMm3, boundsMm, validationScope, toleranceMm, operation, identity,
//       provenance }] }
//
// Recorded model data plus the exact logical face grouping (a few
// milliseconds even for r10b-retained), so it runs inline and is cached per
// revision object. An unknown revision answers 404.
import { HttpError, sendJson } from '../http.mjs';
import { partsDocument } from '../parts.mjs';

const PATH = /^\/api\/models\/([a-f0-9]{64})\/parts$/;

export function register(router, ctx) {
  const cache = new WeakMap();
  router.add('GET', PATH, (_req, res, { match }) => {
    const [, modelId] = match;
    const model = ctx.registry.model(modelId);
    if (!model) throw new HttpError(404, 'Unknown model revision');
    if (!cache.has(model)) cache.set(model, partsDocument(model, modelId));
    sendJson(res, 200, cache.get(model));
  });
}
