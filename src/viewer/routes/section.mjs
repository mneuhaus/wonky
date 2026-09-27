// POST /api/models/:id/section { origin, normal, bodies? } (section).
//
// Exact section contours of one revision through the query worker (kind
// `section`, never on the event loop). Latest wins per model: a newer
// request for the same revision supersedes the running one (409), and a
// client that goes away cancels its query (499). A kernel failure is a
// normal 200 answer with status `failed` and the verbatim kernel reason;
// see src/viewer/section.mjs for the response.
import { HttpError, readJson, sendJson } from '../http.mjs';
import { parseSectionRequest } from '../section.mjs';

const PATH = /^\/api\/models\/([a-f0-9]{64})\/section$/;

export const supersedeKey = modelId => `section:${modelId}`;

export function register(router, ctx) {
  router.add('POST', PATH, async (req, res, { match }) => {
    const id = match[1];
    if (!ctx.registry.get(id)) throw new HttpError(404, 'Unknown model revision');
    const payload = parseSectionRequest(await readJson(req, { limit: 64 * 1024 }));
    const controller = new AbortController();
    const gone = () => {
      if (!res.writableEnded) {
        controller.abort(new HttpError(499, 'Section request closed by the client'));
      }
    };
    res.once('close', gone);
    try {
      const result = await ctx.pool.query('section', id, payload, {
        supersedeKey: supersedeKey(id), signal: controller.signal,
      });
      sendJson(res, 200, result, { compact: true });
    } finally {
      res.off('close', gone);
    }
  });
}
