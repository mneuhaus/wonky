// Ghost pairing and exact bounds deltas. Package: diff-overlay.
//
//   GET /api/diff?after=<id>[&before=<id>]
//     { schema: wonky.diff/1, pairing, identical, before, after, ghost, scope,
//       deltas, sourceLines }
//     Without `before` the ghost is the previous revision of after's source
//     (pairing 'previous-revision'); with it, `before` (pairing 'explicit').
//     No earlier revision: 200 { schema, pairing: 'none', ghost: null, reason }.
//
// Bodies whose recorded bounds are null get kernel-resolved edge-band bounds
// from the query worker (kind diffBounds, kernelBoundsFor in diff.mjs), cached
// per model id. When the kernel cannot resolve them (unsupported surfaces,
// unresolved bands, a pool failure) the bounds fall back to the display
// envelope with its tolerance and carry the kernel's reason. Results are
// cached per pair unless a transient pool failure is part of them.
import { join } from 'node:path';
import { HttpError, sendJson } from '../http.mjs';
import { DIFF_SCHEMA, diffModels, ghostPairing, kernelBoundsFor } from '../diff.mjs';
import { logicalFaces } from '../logical-faces.mjs';

const MODEL = /^[a-f0-9]{64}$/;
const CACHE_LIMIT = 64;

const allRecorded = model => model.bodies.every(body => body.validation?.boundsMm);

export function register(router, ctx) {
  const { registry, sources } = ctx;
  const snapshotDirectory = registry.snapshotDirectory ?? join(ctx.reviewDirectory, 'models');
  const results = new Map();
  const logicalResults = new WeakMap();

  const logical = model => {
    if (!logicalResults.has(model)) logicalResults.set(model, logicalFaces(model));
    return logicalResults.get(model);
  };

  function modelId(url, name, { required = true } = {}) {
    const id = url.searchParams.get(name);
    if (!id) {
      if (!required) return null;
      throw new HttpError(400, `Missing ${name} model id`);
    }
    if (!MODEL.test(id)) throw new HttpError(400, `Invalid ${name} model id`);
    if (!registry.get(id) || !registry.model(id)) {
      throw new HttpError(404, `Unknown ${name} model revision`);
    }
    return id;
  }

  async function sourceOf(model) {
    const recorded = model.sourceMap?.source;
    if (!recorded?.sha256) return null;
    const base = {
      file: recorded.file ?? null, sha256: recorded.sha256, language: recorded.language ?? null,
    };
    try {
      const frozen = await sources.read(recorded.sha256);
      if (frozen) return { ...base, text: frozen.text };
      return { ...base, text: null, reason: 'not frozen when the revision was registered' };
    } catch (error) {
      return { ...base, text: null, reason: error.message };
    }
  }

  async function descriptor(id, other) {
    const model = registry.model(id);
    let kernelBounds = null;
    let displayBounds = null;
    if (!allRecorded(model)) {
      kernelBounds = await kernelBoundsFor(ctx, id, { other });
      if (kernelBounds.status !== 'resolved') {
        const scene = await registry.scene(id);
        displayBounds = { ...scene.bounds, toleranceMm: scene.display?.toleranceMm ?? 0.02 };
      }
    }
    return { id, model, kernelBounds, displayBounds, source: await sourceOf(model) };
  }

  const labelOf = (id, fact) => ({
    label: registry.get(id)?.label ?? null,
    revision: fact?.revision ?? null,
    kind: fact?.kind ?? null,
  });

  router.add('GET', '/api/diff', async (_req, res, { url }) => {
    const after = modelId(url, 'after');
    const explicit = modelId(url, 'before', { required: false });
    const pairing = ghostPairing(registry.list(), { after, before: explicit, snapshotDirectory });
    if (pairing.pairing === 'none') {
      sendJson(res, 200, {
        schema: DIFF_SCHEMA, pairing: 'none', ghost: null, reason: pairing.reason,
        after: { modelId: after, ...labelOf(after, pairing.after) }, before: null,
      });
      return;
    }
    const before = pairing.before.modelId;
    const key = `${before}:${after}`;
    if (!results.has(key)) {
      const [left, right] = await Promise.all([
        descriptor(before, after), descriptor(after, before),
      ]);
      const result = diffModels(left, right, {
        logical,
        pairing: pairing.pairing,
        labels: { before: labelOf(before, pairing.before), after: labelOf(after, pairing.after) },
      });
      const transient = [left, right].some(side => side.kernelBounds?.transient);
      if (transient) {
        sendJson(res, 200, result);
        return;
      }
      results.set(key, result);
      if (results.size > CACHE_LIMIT) results.delete(results.keys().next().value);
    }
    sendJson(res, 200, results.get(key));
  });
}
