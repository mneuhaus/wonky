// POST /api/models/:id/resolve { from, references } (live-client, spec 9.2).
//
// Carries selection references of revision `from` to revision `:id` through
// their recorded topology identity (src/viewer/carry.mjs). Answer:
//
//   { schema: 'wonky.resolve/1', from, to, results: [{ status, fromAlias, alias?,
//     reference?, reason?, stability?, candidates? }] }
//
// `status` is exact (reference names the entity in `:id`), ambiguous or lost;
// ambiguous and lost carry the reason. The references are selection
// references ({ modelId?, bodyId, entityType, entityIndex }); a given modelId
// must equal `from`. Identity matching is linear in the entity count, so it
// runs inline (well below the 50 ms event-loop budget for the fixtures and
// r10b-sized models).
import { HttpError, readJson, sendJson } from '../http.mjs';
import { referenceProblem, resolveReferences } from '../carry.mjs';

const PATH = /^\/api\/models\/([a-f0-9]{64})\/resolve$/;
const MODEL = /^[a-f0-9]{64}$/;
export const MAX_REFERENCES = 64;
export const RESOLVE_SCHEMA = 'wonky.resolve/1';

export function register(router, ctx) {
  router.add('POST', PATH, async (req, res, { match }) => {
    const to = match[1];
    const toModel = ctx.registry.model(to);
    if (!toModel) throw new HttpError(404, 'Unknown model revision');
    const body = await readJson(req, { limit: 64 * 1024 });
    const from = body?.from;
    if (typeof from !== 'string' || !MODEL.test(from)) {
      throw new HttpError(400, 'from must be a model revision id');
    }
    const fromModel = ctx.registry.model(from);
    if (!fromModel) throw new HttpError(404, 'Unknown source model revision');
    const references = body.references;
    if (!Array.isArray(references) || references.length > MAX_REFERENCES) {
      throw new HttpError(400, `references must be an array of at most ${MAX_REFERENCES}`);
    }
    references.forEach((reference, index) => {
      const problem = referenceProblem(reference);
      if (problem) throw new HttpError(400, `references[${index}]: ${problem}`);
      if (reference.modelId !== undefined && reference.modelId !== from) {
        throw new HttpError(400, `references[${index}] belongs to another revision than from`);
      }
    });
    const results = resolveReferences(fromModel, toModel, references).map(result => (
      result.status === 'exact'
        ? {
          ...result,
          reference: {
            modelId: to, bodyId: result.bodyId, entityType: result.entityType,
            entityIndex: result.entityIndex,
          },
        }
        : result));
    sendJson(res, 200, { schema: RESOLVE_SCHEMA, from, to, results });
  });
}
