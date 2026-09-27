// Live routes (spec 9.2). Package: live-server.
//
//   GET  /api/events                     SSE stream (hello, build events), ?client=<id>
//   GET  /api/live                       live sources, workers, revision ring
//   POST /api/live/pins                  { client, modelIds } -> { client, modelIds }
//   POST /api/live/:sourceId/rebuild     202 { jobId, revision }
//   POST /api/live/:sourceId/cancel      202 { jobId, revision } (409 when nothing runs)
//
// A .brep.json-only session has no live sources: /api/live lists none and
// /api/events still answers `hello`, so clients need no special case.
import { HttpError, readJson, sendJson } from '../http.mjs';

const CLIENT = /^[A-Za-z0-9_-]{1,64}$/;
const MODEL = /^[a-f0-9]{64}$/;

export function register(router, ctx) {
  const { events, live, registry } = ctx;

  router.add('GET', '/api/events', (req, res, { url }) => {
    const client = url.searchParams.get('client');
    if (client !== null && !CLIENT.test(client)) throw new HttpError(400, 'Invalid client id');
    events.connect(req, res, {
      ...(client ? { clientId: client } : {}),
      // The browser's own Last-Event-ID header is newer than a query value a
      // manual reconnect put into the URL.
      lastEventId: req.headers['last-event-id'] ? undefined
        : url.searchParams.get('lastEventId') ?? undefined,
    });
  });

  router.add('GET', '/api/live', (_req, res) => {
    sendJson(res, 200, {
      session: events.session,
      sources: live?.status() ?? [],
      workers: live?.workers() ?? null,
      ring: registry.ringStats?.() ?? null,
      clients: events.clients(),
    });
  });

  router.add('POST', '/api/live/pins', async (req, res) => {
    const body = await readJson(req, { limit: 64 * 1024 });
    const client = body?.client;
    if (typeof client !== 'string' || !CLIENT.test(client)) {
      throw new HttpError(400, 'Pins need a client id (the ?client= of its /api/events stream)');
    }
    if (!Array.isArray(body.modelIds) || body.modelIds.length > 64
      || !body.modelIds.every(id => typeof id === 'string' && MODEL.test(id))) {
      throw new HttpError(400, 'modelIds must be up to 64 model revision ids');
    }
    sendJson(res, 200, { client, modelIds: registry.pin(client, body.modelIds) });
  });

  router.add('POST', /^\/api\/live\/([A-Za-z0-9_-]+)\/(rebuild|cancel)$/,
    async (_req, res, { match }) => {
      const session = live?.session(match[1]);
      if (!session) throw new HttpError(404, 'Unknown live source');
      if (match[2] === 'rebuild') {
        sendJson(res, 202, await session.rebuild('rebuild'));
        return;
      }
      const cancelled = session.cancel();
      if (!cancelled) throw new HttpError(409, 'No build is queued or running for this source');
      sendJson(res, 202, cancelled);
    });
}
