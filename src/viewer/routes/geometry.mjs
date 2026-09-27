// GET /api/models/:id/geometry[?aliases=B1.F3,B1.L2&page=N] (exact-measure).
//
// Exact per-entity geometry from the stored analytic parameters (see
// src/viewer/geometry.mjs). Without `aliases` the response is one page of
// every face, edge and vertex (PAGE_SIZE entities, pages counted from 0).
// Closed forms take well under 5 ms per page for the QA fixtures (about
// 24 ms for a full page of r10b-retained), so they run inline once the kernel
// is loaded (spec 10.4); unknown aliases answer 404.
//
// Edge classes come from classifyEdges(model) (topology-classes), which reads
// only the exact model and caches per model object, so this route never
// forces the display scene of a lazily prepared revision.
import { loadKernel } from '../../kernel.mjs';
import { classifyEdges } from '../edge-classes.mjs';
import { cachedLogicalFaces, geometryEntities } from '../geometry.mjs';
import { HttpError, sendJson } from '../http.mjs';

const PATH = /^\/api\/models\/([a-f0-9]{64})\/geometry$/;
const MAX_ALIASES = 2000;

export function register(router, ctx) {
  router.add('GET', PATH, async (_req, res, { url, match }) => {
    const id = match[1];
    const model = ctx.registry.model(id);
    if (!model) throw new HttpError(404, 'Unknown model revision');
    const aliases = url.searchParams.get('aliases')?.split(',').map(value => value.trim())
      .filter(Boolean) ?? null;
    if (aliases?.length > MAX_ALIASES) {
      throw new HttpError(400, `At most ${MAX_ALIASES} aliases per request`);
    }
    const pageText = url.searchParams.get('page') ?? '0';
    if (!/^[0-9]+$/.test(pageText)) throw new HttpError(400, 'page must be a whole number');
    const kernel = await loadKernel();
    const result = geometryEntities(model, {
      aliases, page: Number(pageText), kernel, modelId: id,
      logical: cachedLogicalFaces(model), classes: classifyEdges(model),
    });
    sendJson(res, 200, result, { compact: true });
  });
}
