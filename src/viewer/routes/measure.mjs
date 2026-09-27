// POST /api/models/:id/measure { entities, logical? } (exact-measure).
//
// Closed-form measurements between the given entities of this revision (see
// src/viewer/measure.mjs). Entities of another revision are answered with the
// unsupported row "entities from different revisions", never measured.
// `logical: false` measures fragments as picked instead of their logical face.
import { loadKernel } from '../../kernel.mjs';
import { cachedLogicalFaces } from '../geometry.mjs';
import { HttpError, readJson, sendJson } from '../http.mjs';
import { MAX_ENTITIES, measureEntities } from '../measure.mjs';

const PATH = /^\/api\/models\/([a-f0-9]{64})\/measure$/;

export function register(router, ctx) {
  router.add('POST', PATH, async (req, res, { match }) => {
    const id = match[1];
    const model = ctx.registry.model(id);
    if (!model) throw new HttpError(404, 'Unknown model revision');
    const body = await readJson(req, { limit: 64 * 1024 });
    if (!Array.isArray(body?.entities) || body.entities.length < 2) {
      throw new HttpError(400, 'entities must list at least two entities');
    }
    if (body.entities.length > 16 * MAX_ENTITIES) throw new HttpError(400, 'Too many entities');
    const kernel = await loadKernel();
    sendJson(res, 200, measureEntities(model, body.entities, {
      kernel, modelId: id, logical: cachedLogicalFaces(model),
      resolveLogical: body.logical !== false,
    }));
  });
}
