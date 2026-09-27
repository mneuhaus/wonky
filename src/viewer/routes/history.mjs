// GET /api/models/:id/history (spec 9.2). Package: source-links.
//
// The construction history of one revision: recorded modeling calls with
// spans, call paths and parameters, entity -> operation and face/edge ->
// sketch-entity links, and a per-line index from source lines to the
// geometry they produced (see src/viewer/history.mjs). A pure walk over the
// recorded model (about 1 to 5 ms for the QA fixtures and r10b-retained), so
// it runs inline and is cached per model object. Unknown revisions answer 404.
import { HttpError, sendJson } from '../http.mjs';
import { operationHistory } from '../history.mjs';

const PATH = /^\/api\/models\/([a-f0-9]{64})\/history$/;

export function register(router, ctx) {
  const cache = new WeakMap();
  router.add('GET', PATH, (_req, res, { match }) => {
    const model = ctx.registry.model(match[1]);
    if (!model) throw new HttpError(404, 'Unknown model revision');
    if (!cache.has(model)) cache.set(model, operationHistory(model, { modelId: match[1] }));
    sendJson(res, 200, cache.get(model), { compact: true });
  });
}
