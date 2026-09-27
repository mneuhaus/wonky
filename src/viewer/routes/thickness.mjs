// POST /api/models/:id/thickness { face, point } | { origin, direction, body? }
// (thickness-probe).
//
// One wall-thickness probe of one revision through the query worker (kind
// `thickness`, never on the event loop; 10 s timeout). Latest wins per
// model: a newer probe of the same revision supersedes the running one
// (409), and a client that goes away cancels its query (499). A refused
// probe is a normal 200 answer with status `unresolved` and its blocking
// entities; see src/viewer/thickness.mjs for the response.
import { HttpError, readJson, sendJson } from '../http.mjs';
import { parseThicknessRequest } from '../thickness.mjs';

const PATH = /^\/api\/models\/([a-f0-9]{64})\/thickness$/;

export const supersedeKey = modelId => `thickness:${modelId}`;

export function register(router, ctx) {
  router.add('POST', PATH, async (req, res, { match }) => {
    const id = match[1];
    if (!ctx.registry.get(id)) throw new HttpError(404, 'Unknown model revision');
    const payload = parseThicknessRequest(await readJson(req, { limit: 16 * 1024 }));
    const controller = new AbortController();
    const gone = () => {
      if (!res.writableEnded) {
        controller.abort(new HttpError(499, 'Thickness request closed by the client'));
      }
    };
    res.once('close', gone);
    try {
      const result = await ctx.pool.query('thickness', id, payload, {
        supersedeKey: supersedeKey(id), signal: controller.signal,
      });
      sendJson(res, 200, { modelId: id, ...result }, { compact: true });
    } finally {
      res.off('close', gone);
    }
  });
}
