// GET /api/models/:id/draw: the binary draw payload `wonky.draw/1` (spec 9.3).
// Package: render-transport.
//
// Payloads are produced by the query pool (kind `draw`, never on the event
// loop), shared by concurrent requests and kept in a small byte-bounded LRU.
// A live registry may offer a payload its build worker already produced
// (`registry.drawPayload(id)`, optional). `ETag` is the model id plus the
// draw version; `If-None-Match` answers 304. Clients that accept gzip get the
// payload compressed (cached next to the raw bytes). Display failures are
// explicit capability errors (501) from the producer.
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import { HttpError, sendBinary } from '../http.mjs';
import { DRAW_VERSION, drawEtag } from '../draw.mjs';

const MODEL = '[a-f0-9]{64}';
const compress = promisify(gzip);
export const DRAW_CACHE_BYTES = 128 * 1024 * 1024;

// Latest-used payload cache by model id, bounded by raw + compressed bytes.
export function createDrawCache({ maxBytes = DRAW_CACHE_BYTES } = {}) {
  const entries = new Map();
  const pending = new Map();
  let bytes = 0;
  const sizeOf = entry => entry.raw.byteLength + (entry.gzip?.byteLength ?? 0);
  const trim = () => {
    for (const [id, entry] of entries) {
      if (bytes <= maxBytes || entries.size <= 1) break;
      entries.delete(id);
      bytes -= sizeOf(entry);
    }
  };
  return {
    async get(id, produce) {
      if (entries.has(id)) {
        const entry = entries.get(id);
        entries.delete(id);
        entries.set(id, entry);
        return entry;
      }
      if (!pending.has(id)) {
        const run = produce().then(raw => {
          const entry = { raw, gzip: null };
          entries.set(id, entry);
          bytes += sizeOf(entry);
          trim();
          return entry;
        }).finally(() => pending.delete(id));
        pending.set(id, run);
      }
      return pending.get(id);
    },
    async gzipped(entry) {
      if (!entry.gzip) {
        entry.gzipping ??= compress(entry.raw, { level: 6 });
        entry.gzip = await entry.gzipping;
        if ([...entries.values()].includes(entry)) bytes += entry.gzip.byteLength;
        trim();
      }
      return entry.gzip;
    },
    stats: () => ({ entries: entries.size, bytes, pending: pending.size }),
  };
}

const acceptsGzip = req => /\bgzip\b/.test(req.headers['accept-encoding'] ?? '');

export function register(router, ctx) {
  const { registry, pool } = ctx;
  const cache = createDrawCache();

  // Shared by concurrent requests, so it is not tied to one client's
  // connection: an abandoned request still leaves a cached payload.
  async function produce(id) {
    const precomputed = await registry.drawPayload?.(id);
    const payload = precomputed ?? await (async () => {
      // An already prepared scene is passed along (in-process shortcut);
      // otherwise the query handler prepares its own.
      const scene = registry.get(id)?.bounds ? await registry.scene(id) : undefined;
      return pool.query('draw', id, { modelId: id, scene });
    })();
    if (!payload?.buffer) throw new HttpError(500, 'Draw payload producer returned nothing');
    return Buffer.from(payload.buffer);
  }

  router.add('GET', new RegExp(`^/api/models/(${MODEL})/draw$`), async (req, res, { match }) => {
    const id = match[1];
    if (!registry.get(id)) throw new HttpError(404, 'Unknown model revision');
    const etag = drawEtag(id);
    const headers = { 'X-Wonky-Draw-Version': String(DRAW_VERSION), Vary: 'Accept-Encoding' };
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, ...headers });
      res.end();
      return;
    }
    const entry = await cache.get(id, () => produce(id));
    headers['X-Wonky-Draw-Bytes'] = String(entry.raw.byteLength);
    if (acceptsGzip(req)) {
      const body = await cache.gzipped(entry);
      sendBinary(res, 200, body, { etag, headers: { ...headers, 'Content-Encoding': 'gzip' } });
    } else sendBinary(res, 200, entry.raw, { etag, headers });
  });
}
