// Legacy workspace, model, source and report routes (API-01..11) plus the
// archive route. Legacy routes keep their pre-foundation status mapping.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { formatGeometrySummary } from '../../geometry-summary.mjs';
import { HttpError, JSON_TYPE, redirect, send, sendJson, sendText } from '../http.mjs';
import { inputLabel } from '../registry.mjs';
import { createStaticHandler } from '../static.mjs';

const MODEL = '[a-f0-9]{64}';
const ALIAS = 'B[1-9][0-9]*(?:\\.[FEV][1-9][0-9]*)?';
const sha256 = value => createHash('sha256').update(value).digest('hex');
const legacy = { legacy: true };
const TEXT = 'text/plain; charset=utf-8';

export function register(router, ctx) {
  const { registry, reports, reviews, sources, inputs, viewerDirectory } = ctx;
  router.add('GET', '/', (_req, res) => redirect(res, '/viewer/'), legacy);
  router.add('GET', /^\/viewer\//, createStaticHandler(viewerDirectory), legacy);

  router.add('GET', '/api/workspace', async (_req, res) => {
    // A rebuilt input becomes a new selectable revision. Existing selections
    // and reviews keep their exact previous snapshot, even at the same path.
    for (const path of inputs) {
      await registry.registerIfNew(await readFile(path), inputLabel(path), path);
    }
    await reports.refresh();
    const feedback = await reviews.list();
    send(res, 200, {
      models: registry.list(), sources: registry.sources(), reports: reports.list(), feedback,
      ...(ctx.workspace ? { tree: ctx.workspace.tree() } : {}),
    });
  }, legacy);

  // Display scene, served compact (content identical to the pretty form).
  // Live revisions send the build worker's compact text without a
  // parse/stringify round trip on the event loop.
  router.add('GET', new RegExp(`^/api/models/(${MODEL})$`), async (_req, res, { match }) => {
    const text = registry.sceneText?.(match[1]);
    if (text) {
      sendText(res, 200, text, JSON_TYPE);
      return;
    }
    sendJson(res, 200, await registry.scene(match[1]), { compact: true });
  }, legacy);

  router.add('GET', new RegExp(`^/api/models/(${MODEL})/summary$`), (_req, res, { url, match }) => {
    const inspector = registry.inspector(match[1]);
    if (!inspector) {
      send(res, 404, { error: 'Unknown model revision' });
      return;
    }
    const summary = inspector.summary({ includeFaces: url.searchParams.get('level') !== 'bodies' });
    if (url.searchParams.get('format') !== 'text') send(res, 200, summary);
    else send(res, 200, formatGeometrySummary(summary), TEXT);
  }, legacy);

  router.add('GET', new RegExp(`^/api/models/(${MODEL})/entities/(${ALIAS})$`),
    (_req, res, { match }) => {
      const inspector = registry.inspector(match[1]);
      if (!inspector) {
        send(res, 404, { error: 'Unknown model revision' });
        return;
      }
      send(res, 200, inspector.detail({ modelId: match[1], alias: match[2] }));
    }, legacy);

  router.add('GET', new RegExp(`^/api/source/(${MODEL})$`), async (_req, res, { match }) => {
    const source = await sources.read(match[1]);
    if (!source) {
      send(res, 404, { error: 'Exact source snapshot unavailable; use the recorded call excerpt' });
      return;
    }
    send(res, 200, source);
  }, legacy);

  router.add('GET', /^\/api\/reports\/([a-z][a-z-]*)$/, (_req, res, { match }) => {
    const report = reports.get(match[1]);
    if (!report) {
      send(res, 404, { error: 'Unknown report' });
      return;
    }
    send(res, 200, report.data);
  }, legacy);

  router.add('GET', /^\/api\/reports\/([a-z][a-z-]*)\/images\/((?:[a-f0-9]{64}\/)?[^/]+)$/,
    async (_req, res, { match }) => {
      const descriptor = reports.image(`${match[1]}/${match[2]}`);
      if (!descriptor) {
        send(res, 404, { error: 'Unknown recorded render image' });
        return;
      }
      const bytes = await readFile(descriptor.path);
      if (sha256(bytes) !== descriptor.sha256) {
        throw new Error('Render image no longer matches its report');
      }
      send(res, 200, bytes, 'image/png');
    }, legacy);

  // New (foundation): idempotent archive of a revision's exact bytes. Every
  // registered revision is archived at registration; live-server extends
  // registry.archive() to live and spooled revisions.
  router.add('POST', new RegExp(`^/api/models/(${MODEL})/archive$`),
    async (_req, res, { match }) => {
      if (!registry.has(match[1])) throw new HttpError(404, 'Unknown model revision');
      sendJson(res, 200, { path: await registry.archive(match[1]), modelId: match[1] });
    });
}
