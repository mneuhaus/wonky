// Saved reviews: validation (validateReview, re-exported by
// src/review-server.mjs), save, load and the workspace listing. Package:
// reviews-context. Records are written atomically (temp + rename) with a
// Markdown summary and a port-independent LLM context file; the context file
// is rewritten when the review is read and its context is stale. Saving
// archives every referenced revision first (D7). The listing reads only the
// records, and a corrupt one becomes an error row (spec 3.5).
import { readFile, readdir, writeFile, rename, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { cameraConventionField, validateReviewCamera } from './review-camera.mjs';
import { loadKernel } from '../kernel.mjs';
import { contextText, reviewMarkdown } from './context.mjs';
import { prettyJson } from './http.mjs';

export const reviewIdPattern = /^WKR-[A-F0-9]{10}$/;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const text = (value, label, max, optional = false) => {
  if (optional && value === undefined) return '';
  if (typeof value !== 'string' || value.length > max) {
    throw new Error(`${label} must be text up to ${max} characters`);
  }
  return value;
};

function view(value, models) {
  if (!value || !models.has(value.before) || !models.has(value.after) || !finite(value.split)
    || value.split < 0 || value.split > 1) {
    throw new Error('Invalid comparison or model revision');
  }
  const result = {
    before: value.before, after: value.after, split: value.split, compare: value.compare !== false,
  };
  if (value.layout !== undefined) {
    if (!['wipe', 'side-by-side'].includes(value.layout)) {
      throw new Error('Invalid comparison layout');
    }
    result.layout = value.layout;
  }
  if (value.aspect !== undefined) {
    if (!finite(value.aspect) || value.aspect <= 0 || value.aspect > 100) {
      throw new Error('Invalid viewport aspect');
    }
    result.aspect = value.aspect;
  }
  return result;
}

const entityKeys = { face: 'faces', edge: 'edges', vertex: 'vertices' };
const aliasLetters = { face: 'F', edge: 'E', vertex: 'V' };

function target(t, rawModels) {
  const model = rawModels.get(t.modelId);
  const body = model?.bodies.find(item => item.id === t.bodyId);
  if (!body || !['body', 'face', 'edge', 'vertex'].includes(t.entityType)
    || !Number.isInteger(t.entityIndex) || t.entityIndex < 0) {
    throw new Error('Annotation target does not exist');
  }
  const key = entityKeys[t.entityType];
  if (t.entityType === 'body' ? t.entityIndex !== 0 : t.entityIndex >= body[key].length) {
    throw new Error('Annotation entity index is outside its frozen revision');
  }
  const identity = t.entityType === 'body'
    ? body.identity
    : body.identity?.topology?.[key]?.[t.entityIndex];
  const bodyIndex = model.bodies.indexOf(body);
  const entity = t.entityType === 'body' ? ''
    : '.' + aliasLetters[t.entityType] + (t.entityIndex + 1);
  const compact = value => Object.fromEntries(Object.entries(value)
    .filter(([name]) => name !== 'topology'));
  const compactIdentity = identity ? { identity: compact(identity) } : {};
  return {
    modelId: t.modelId, bodyId: t.bodyId, entityType: t.entityType, entityIndex: t.entityIndex,
    alias: `B${bodyIndex + 1}${entity}`,
    ...compactIdentity,
    source: body.identity?.operation?.source ?? body.debug?.source ?? null,
    referencePolicy: 'Bound to immutable model revision; semantic lineage included when available',
  };
}

export function validateReview(value, models, rawModels) {
  if (!value || typeof value !== 'object') throw new Error('Review must be an object');
  const refs = new Set(value.models);
  if (!Array.isArray(value.models) || !refs.size || refs.size > 30
    || ![...refs].every(id => models.has(id))) {
    throw new Error('Review must reference known immutable model revisions');
  }
  if (!Array.isArray(value.annotations) || value.annotations.length > 500) {
    throw new Error('Review annotations must be an array with at most 500 entries');
  }
  const annotations = value.annotations.map((a, index) => {
    if (!a || !['comment', 'arrow', 'box', 'pen'].includes(a.tool)) {
      throw new Error(`Invalid annotation tool at ${index}`);
    }
    const points = a.points ?? [];
    if (!Array.isArray(points) || points.length > 4000 || points.some(p => !Array.isArray(p)
      || p.length !== 2 || !p.every(v => finite(v) && v >= 0 && v <= 1))) {
      throw new Error('Annotation points must be normalized viewport coordinates');
    }
    const twoPoints = ['arrow', 'box'].includes(a.tool) && points.length !== 2;
    if (twoPoints || a.tool === 'pen' && points.length < 2) {
      throw new Error('Drawing has insufficient control points');
    }
    const annotation = {
      tool: a.tool, text: text(a.text, 'Annotation', 10000, true),
      points: points.map(p => [...p]), camera: validateReviewCamera(a.camera),
    };
    if (a.view) {
      annotation.view = view(a.view, models);
      refs.add(a.view.before);
      refs.add(a.view.after);
    }
    if (a.target) {
      annotation.target = target(a.target, rawModels);
      refs.add(a.target.modelId);
    }
    return annotation;
  });
  const comparison = view(value.comparison, models);
  refs.add(comparison.before);
  refs.add(comparison.after);
  const camera = validateReviewCamera(value.camera);
  return {
    schema: 'wonky-review/1', title: text(value.title, 'Title', 200),
    notes: text(value.notes, 'Notes', 30000, true), models: [...refs], comparison,
    camera, ...cameraConventionField(camera), annotations,
  };
}

async function writeAtomic(file, content) {
  const temporary = file + '.' + randomBytes(6).toString('hex') + '.tmp';
  try {
    await writeFile(temporary, content, { flag: 'wx' });
    await rename(temporary, file);
  } finally {
    await rm(temporary, { force: true });
  }
}

// Every-review listing for the workspace: only the records are read, so one
// corrupt or foreign file becomes an error row instead of failing the whole
// workspace (spec 3.5). Error rows come last.
export async function listReviews(reviewDirectory) {
  const feedback = [];
  const failures = [];
  for (const name of await readdir(reviewDirectory)) {
    if (!/^WKR-[A-F0-9]{10}\.json$/.test(name)) continue;
    const id = name.slice(0, -5);
    const file = join(reviewDirectory, name);
    try {
      const record = JSON.parse(await readFile(file, 'utf8'));
      if (!record || typeof record !== 'object' || record.id !== id) {
        throw new Error('not a saved review record (its id does not match the file name)');
      }
      if (typeof record.createdAt !== 'string') throw new Error('createdAt is missing');
      feedback.push({
        id, title: typeof record.title === 'string' ? record.title : id,
        createdAt: record.createdAt,
      });
    } catch (error) {
      failures.push({ id, file, error: `Review ${id} cannot be read: ${error.message}` });
    }
  }
  feedback.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  failures.sort((a, b) => a.id.localeCompare(b.id));
  return [...feedback, ...failures];
}

export function createReviewStore({ reviewDirectory, registry, origin }) {
  // The LLM context of a record (async: exact data needs the Bend kernel).
  // A kernel that cannot load leaves "exact data unavailable" lines.
  const context = async (record, originPrefix) => contextText(record, {
    originPrefix,
    reviewDirectory,
    snapshotDirectory: registry.snapshotDirectory,
    inspector: id => registry.inspector(id),
    model: id => registry.model(id),
    kernel: await loadKernel().catch(() => null),
  });
  const decorate = (id, record, file, contextFile, extra = {}) => ({
    ...record,
    url: `${origin()}/viewer/#review=${id}`,
    file,
    contextFile,
    contextUrl: `${origin()}/api/feedback/${id}/context`,
    ...extra,
  });
  return {
    context,
    // A saved record plus its URLs; refreshes a stale on-disk context file.
    // A context that cannot be written (for example a missing snapshot) does
    // not block opening the review: the record carries `contextError`.
    async load(id) {
      if (!reviewIdPattern.test(id)) throw new Error('Invalid review ID');
      const file = join(reviewDirectory, `${id}.json`);
      const record = JSON.parse(await readFile(file, 'utf8'));
      const contextFile = join(reviewDirectory, `${id}.context.md`);
      let current;
      try {
        current = await context(record, '');
      } catch (error) {
        return decorate(id, record, file, contextFile, { contextError: error.message });
      }
      let existing;
      try {
        existing = await readFile(contextFile, 'utf8');
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (existing !== current) await writeAtomic(contextFile, current);
      return decorate(id, record, file, contextFile);
    },
    list: () => listReviews(reviewDirectory),
    // Archives every revision the review references before writing it (D7):
    // live revisions leave memory or the spool for <reviews>/models, so the
    // review and its context resolve after the server stops.
    async save(value) {
      const record = validateReview(value, registry.models, registry.rawModels);
      const snapshots = new Map();
      for (const model of record.models) snapshots.set(model, await registry.archive(model));
      const id = 'WKR-' + randomBytes(5).toString('hex').toUpperCase();
      const file = join(reviewDirectory, `${id}.json`);
      const complete = {
        ...record, id, createdAt: new Date().toISOString(),
        revisions: record.models.map(model => ({
          ...registry.get(model), snapshot: snapshots.get(model),
        })),
      };
      const temporary = file + '.tmp';
      await writeFile(temporary, prettyJson(complete), { flag: 'wx' });
      await rename(temporary, file);
      await writeFile(join(reviewDirectory, `${id}.md`), reviewMarkdown(complete, {
        origin: origin(), file,
      }), { flag: 'wx' });
      const contextFile = join(reviewDirectory, `${id}.context.md`);
      await writeFile(contextFile, await context(complete, ''), { flag: 'wx' });
      return {
        id, url: `${origin()}/viewer/#review=${id}`, file, contextFile,
        contextUrl: `${origin()}/api/feedback/${id}/context`,
        archived: [...snapshots].map(([modelId, path]) => ({ modelId, path })),
      };
    },
  };
}
