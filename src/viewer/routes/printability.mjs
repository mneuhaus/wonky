// POST /api/models/:id/printability (fdm, spec 3.6 and 9.2).
//
// Body: { alphaDeg?, smallBoreMm?, plateMm?, bodies?: [{ bodyId, up?, printed? }] }.
// Without `bodies` every body is checked with up = +Z, printed. With `bodies`
// the answer covers exactly the listed bodies (the client asks only for the
// bodies whose settings changed). The work runs in the query worker (kind
// `printability`, 30 s timeout): body extents may need kernel edge bands,
// which can take several hundred milliseconds. A client that disconnects
// aborts its query. Shape errors answer 400 before the worker is involved;
// an unknown body id answers 400 from the handler.
import { HttpError, readJson, sendJson } from '../http.mjs';
import { checkRequest } from '../printability.mjs';

const PATH = /^\/api\/models\/([a-f0-9]{64})\/printability$/;

export function register(router, ctx) {
  router.add('POST', PATH, async (req, res, { match }) => {
    const id = match[1];
    if (!ctx.registry.get(id)) throw new HttpError(404, 'Unknown model revision');
    const body = await readJson(req, { limit: 256 * 1024 });
    checkRequest(body);
    const controller = new AbortController();
    const onClose = () => {
      if (!res.writableFinished) controller.abort(new HttpError(499, 'Client closed the request'));
    };
    res.on('close', onClose);
    try {
      const result = await ctx.pool.query('printability', id, body, { signal: controller.signal });
      sendJson(res, 200, { ...result, modelId: id }, { compact: true });
    } finally {
      res.off('close', onClose);
    }
  });
}
