// Revision comparison routes. Package: model-first-compare.
//
//   GET /api/compare?before=<id>&after=<id>
//     { schema: wonky.compare/1, before, after, identical, scope, deltas, sourceLines }
//     (compareModels in src/viewer/compare.mjs; results are cached per pair,
//     because revisions are immutable by id)
//   GET /api/compare/revisions
//     { schema: wonky.revisions/1, revisions: [{ modelId, kind, source, revision,
//       time, timeBasis, recordedSource }] } in registry order
//
// Revision time: live.builtAt (or live.time) when live-server provides it,
// else the modification time of the archived snapshot <reviews>/models/<id>
// (written once, when the revision was first registered), else the time this
// server first saw the revision. `timeBasis` names which one it is.
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError, sendJson } from '../http.mjs';
import {
  COMPARE_SCHEMA, COMPARE_SCOPE, REVISIONS_SCHEMA, compareModels, describeRevisions,
} from '../compare.mjs';
import { logicalFaces } from '../logical-faces.mjs';
import { kernelBoundsFor } from '../diff.mjs';

const MODEL = /^[a-f0-9]{64}$/;
const CACHE_LIMIT = 64;

export function register(router, ctx) {
  const { registry, sources } = ctx;
  const snapshotDirectory = registry.snapshotDirectory ?? join(ctx.reviewDirectory, 'models');
  const snapshotPath = id => join(snapshotDirectory, `${id}.brep.json`);
  const results = new Map();
  const logicalResults = new WeakMap();
  const times = new Map();
  const seen = new Map();
  registry.onRevision(metadata => {
    if (!seen.has(metadata.id)) seen.set(metadata.id, new Date().toISOString());
  });

  const logical = model => {
    if (!logicalResults.has(model)) logicalResults.set(model, logicalFaces(model));
    return logicalResults.get(model);
  };

  function modelId(url, name) {
    const id = url.searchParams.get(name);
    if (!id) throw new HttpError(400, `Missing ${name} model id`);
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

  // Bodies without recorded bounds get kernel-resolved edge-band bounds from
  // the query worker (diff-overlay, cached per model id); the display
  // envelope is the fallback when the kernel cannot resolve them.
  async function descriptor(id) {
    const model = registry.model(id);
    let displayBounds = null;
    let kernelBounds = null;
    const recorded = model.bodies.every(body => body.validation?.boundsMm);
    if (!recorded) {
      kernelBounds = await kernelBoundsFor(ctx, id);
      if (kernelBounds.status !== 'resolved') {
        const scene = await registry.scene(id);
        displayBounds = { ...scene.bounds, toleranceMm: scene.display?.toleranceMm ?? 0.02 };
      }
    }
    return { id, model, displayBounds, kernelBounds, source: await sourceOf(model) };
  }

  const summary = id => ({ modelId: id, label: registry.get(id)?.label ?? null });

  router.add('GET', '/api/compare', async (_req, res, { url }) => {
    const before = modelId(url, 'before');
    const after = modelId(url, 'after');
    const key = `${before}:${after}`;
    if (!results.has(key)) {
      const [left, right] = await Promise.all([descriptor(before), descriptor(after)]);
      const result = {
        schema: COMPARE_SCHEMA, before: summary(before), after: summary(after),
        identical: before === after, scope: COMPARE_SCOPE,
        ...compareModels(left, right, { logical }),
      };
      // A transient kernel-bounds failure (timeout, worker down) is not cached.
      if ([left, right].some(side => side.kernelBounds?.transient)) {
        sendJson(res, 200, result);
        return;
      }
      results.set(key, result);
      if (results.size > CACHE_LIMIT) results.delete(results.keys().next().value);
    }
    sendJson(res, 200, results.get(key));
  });

  async function timeOf(metadata) {
    const live = metadata.live;
    const liveTime = [live?.builtAt, live?.time].find(value => typeof value === 'string');
    if (liveTime) return { at: liveTime, basis: 'built' };
    if (!times.has(metadata.id)) {
      try {
        const info = await stat(snapshotPath(metadata.id));
        times.set(metadata.id, { at: info.mtime.toISOString(), basis: 'first-registered' });
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (seen.has(metadata.id)) return { at: seen.get(metadata.id), basis: 'first-seen' };
        return { at: null, basis: null };
      }
    }
    return times.get(metadata.id);
  }

  router.add('GET', '/api/compare/revisions', async (_req, res) => {
    const list = registry.list();
    const resolved = new Map(await Promise.all(list.map(async metadata => [
      metadata.id, await timeOf(metadata),
    ])));
    const revisions = describeRevisions(list, {
      snapshotDirectory,
      modelOf: id => registry.model(id),
      timeOf: metadata => resolved.get(metadata.id),
    });
    sendJson(res, 200, { schema: REVISIONS_SCHEMA, revisions });
  });
}
