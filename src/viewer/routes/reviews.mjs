// Saved review routes (API-12..14, legacy status mapping) and the copy
// context route. Package: reviews-context.
//
//   GET  /api/feedback/:id            record + url, file, contextFile, contextUrl
//   GET  /api/feedback/:id/context    the review's LLM context (text/plain)
//   POST /api/feedback                save (archives every referenced revision)
//   POST /api/context { kind, references?, visible?, previous? }
//     The text of a copy action (src/viewer/context.mjs copyText):
//       references  Copy reference / Copy references (JSON)
//       geometry    Copy selected geometry (JSON: detail + exact data)
//       overview    Copy model overview (text)
//       llm         Copy LLM context (Markdown, scoped to `visible` and the
//                   selection, with exact data, measurements and, with
//                   `previous`, the change summary against that revision)
//     Every named revision is archived first (D7):
//     { schema, kind, format, text, archived: [{ modelId, path }] }
import { loadKernel } from '../../kernel.mjs';
import { compareModels } from '../compare.mjs';
import {
  COPY_KINDS, copyModels, copyText, readModelIds, readReferences,
} from '../context.mjs';
import { HttpError, readJson, send, sendJson } from '../http.mjs';

const legacy = { legacy: true };
const REVIEW = 'WKR-[A-F0-9]{10}';
const MODEL = /^[a-f0-9]{64}$/;
export const COPY_SCHEMA = 'wonky.viewer-copy/1';

function readCopyRequest(body, has) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Copy request must be an object');
  }
  if (!COPY_KINDS.includes(body.kind)) {
    throw new HttpError(400, `kind must be one of ${COPY_KINDS.join(', ')}`);
  }
  const previous = body.previous ?? null;
  if (previous !== null && (typeof previous !== 'string' || !MODEL.test(previous))) {
    throw new HttpError(400, 'previous must be a model revision id');
  }
  if (previous && !has(previous)) throw new HttpError(404, 'Unknown previous model revision');
  return {
    kind: body.kind,
    references: readReferences(body.references, { has }),
    visible: readModelIds(body.visible, { has }),
    previous,
  };
}

export function register(router, ctx) {
  const { reviews, origin, registry, sources } = ctx;
  router.add('GET', new RegExp(`^/api/feedback/(${REVIEW})$`), async (_req, res, { match }) => {
    send(res, 200, await reviews.load(match[1]));
  }, legacy);
  router.add('GET', new RegExp(`^/api/feedback/(${REVIEW})/context$`),
    async (_req, res, { match }) => {
      const record = await reviews.load(match[1]);
      send(res, 200, await reviews.context(record, origin), 'text/plain; charset=utf-8');
    }, legacy);
  router.add('POST', '/api/feedback', async (req, res) => {
    const value = await readJson(req, { tooLarge: 'Review exceeds 2 MiB' });
    send(res, 201, await reviews.save(value));
  }, legacy);

  // Revision descriptor with its frozen top-level source, for the change
  // summary (compareModels reads the recorded source text when available).
  async function descriptor(id) {
    const model = registry.model(id);
    const recorded = model.sourceMap?.source;
    let source = null;
    if (recorded?.sha256) {
      const frozen = await sources?.read(recorded.sha256).catch(() => null);
      source = {
        file: recorded.file ?? null, sha256: recorded.sha256, language: recorded.language ?? null,
        text: typeof frozen?.text === 'string' ? frozen.text : null,
        ...(typeof frozen?.text === 'string' ? {} : { reason: 'frozen source unavailable' }),
      };
    }
    return { id, model, source };
  }

  router.add('POST', '/api/context', async (req, res) => {
    const body = await readJson(req, { limit: 64 * 1024 });
    const request = readCopyRequest(body, id => registry.has(id));
    const snapshots = new Map();
    for (const id of copyModels(request.kind, request)) {
      snapshots.set(id, await registry.archive(id));
    }
    const kernel = await loadKernel();
    let change = null;
    const [displayed] = request.visible;
    if (request.kind === 'llm' && request.previous && displayed
      && request.previous !== displayed) {
      change = compareModels(await descriptor(request.previous), await descriptor(displayed));
    }
    const result = copyText(request.kind, request, {
      kernel,
      snapshots,
      snapshotDirectory: registry.snapshotDirectory,
      model: id => registry.model(id),
      metadata: id => registry.get(id),
      inspector: id => registry.inspector(id),
      compare: () => change,
    });
    sendJson(res, 200, {
      schema: COPY_SCHEMA, kind: request.kind, format: result.format, text: result.text,
      archived: [...snapshots].map(([modelId, path]) => ({ modelId, path })),
    });
  });
}
