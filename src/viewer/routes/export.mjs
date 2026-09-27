// Print export routes (spec 3.6, 9.2). Package: reviews-context.
//
//   GET /api/models/:id/print.stl[?body=<id|B2>&deviationMm=0.02]
//   GET /api/models/:id/print.json[?body=…&deviationMm=…]
//
// Both archive the revision first (D7), so the manifest's snapshot path and
// wonky-inspect command resolve after the server stops. The mesh and its
// manifest come from src/viewer/export.mjs in a worker thread; the last few
// results are cached by (model, body, deviation), so the STL and its manifest
// are meshed once. A body the print mesh cannot cover answers 422 with the
// print mesh's capability error.
import { HttpError, sendBinary, sendJson } from '../http.mjs';
import { inspectCommand } from '../context.mjs';
import { createPrintExporter, readDeviation, selectBody } from '../export.mjs';

const PATH = /^\/api\/models\/([a-f0-9]{64})\/print\.(stl|json)$/;
const CACHE_LIMIT = 4;

const disposition = name => `attachment; filename="${name.replace(/["\\]/g, '_')}"`;

export function register(router, ctx) {
  const { registry } = ctx;
  const exporter = createPrintExporter();
  const results = new Map();

  function exportOnce(id, body, deviationMm) {
    const key = `${id}|${body ?? ''}|${deviationMm}`;
    if (!results.has(key)) {
      const run = (async () => {
        const snapshot = await registry.archive(id);
        const metadata = registry.get(id);
        const revision = Number.isInteger(metadata?.live?.revision)
          ? metadata.live.revision : null;
        return exporter.run(await registry.bytes(id), {
          body, deviationMm, modelId: id, label: metadata?.label ?? null, revision, snapshot,
          inspect: inspectCommand(snapshot, { bodiesOnly: true }),
        });
      })();
      results.set(key, run);
      run.catch(() => results.delete(key));
      while (results.size > CACHE_LIMIT) results.delete(results.keys().next().value);
    }
    return results.get(key);
  }

  router.add('GET', PATH, async (_req, res, { url, match }) => {
    const [, id, format] = match;
    const model = registry.model(id);
    if (!model) throw new HttpError(404, 'Unknown model revision');
    const body = url.searchParams.get('body') || null;
    selectBody(model, body);
    const deviationMm = readDeviation(url.searchParams.get('deviationMm'));
    let result;
    try {
      result = await exportOnce(id, body, deviationMm);
    } catch (error) {
      if (!error.capability) throw error;
      sendJson(res, 422, {
        error: error.message, kind: 'capability', exactness: 'unsupported',
        scope: body ? 'body' : 'revision',
      });
      return;
    }
    const name = result.manifest.file.name;
    if (format === 'stl') {
      sendBinary(res, 200, result.stl, {
        type: 'model/stl', headers: { 'Content-Disposition': disposition(name) },
      });
      return;
    }
    sendJson(res, 200, result.manifest, {
      headers: { 'Content-Disposition': disposition(name.replace(/\.stl$/, '.print.json')) },
    });
  });
}
