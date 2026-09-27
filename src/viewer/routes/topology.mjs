// GET /api/models/:id/topology (spec 9.2). Package: topology-classes.
//
// Edge classes (sharp, tangent, seam, subdivision, unresolved) and logical
// face groups with fragment aliases for every body of a revision. Classes and
// groups are closed forms over the exact stored parameters
// (`exact-parameters`); construction origins are `recorded`. The computation
// takes a few milliseconds (r10b-retained about 2 to 11 ms), so it runs
// in-process and is cached per revision; there is no `topology` query kind.
//
// ?detail=summary answers only totals and per-body counts.
import { performance } from 'node:perf_hooks';
import { HttpError, sendJson } from '../http.mjs';
import { EDGE_CLASSES, EDGE_CLASS_METHOD, classifyEdges } from '../edge-classes.mjs';
import { logicalFaces } from '../logical-faces.mjs';

export const TOPOLOGY_SCHEMA = 'wonky.viewer-topology/1';
const MODEL = '[a-f0-9]{64}';
const DETAILS = ['full', 'summary'];

const countClasses = classes => {
  const counts = Object.fromEntries(EDGE_CLASSES.map(name => [name, 0]));
  for (const code of classes) counts[EDGE_CLASSES[code]]++;
  return counts;
};

function edgeRecord(bodyAlias, classified, edge) {
  const record = classified.evidence[edge];
  const faces = [classified.adjacent[2 * edge], classified.adjacent[2 * edge + 1]]
    .filter(face => face >= 0).map(face => `${bodyAlias}.F${face + 1}`);
  return {
    alias: `${bodyAlias}.E${edge + 1}`,
    class: EDGE_CLASSES[classified.classes[edge]],
    faces,
    support: record.support,
    origin: record.origin,
    ...(record.angleRad ? { normalAngleRad: record.angleRad } : {}),
    ...(record.reason ? { reason: record.reason } : {}),
  };
}

// Plain JSON topology document of a model (the route body; also used by
// tests and QA). `computeMs` is the time spent in classifyEdges and
// logicalFaces for this document (near 0 when the classes were cached).
export function topologyDocument(model, modelId, { detail = 'full' } = {}) {
  const started = performance.now();
  const classes = classifyEdges(model);
  const logical = logicalFaces(model, { classes });
  const computeMs = performance.now() - started;
  const totals = {
    bodies: model.bodies.length, faces: 0, logicalFaces: 0, edges: 0,
    classes: Object.fromEntries(EDGE_CLASSES.map(name => [name, 0])),
  };
  const bodies = model.bodies.map((body, index) => {
    const alias = `B${index + 1}`;
    const classified = classes.bodies[index];
    const groups = logical.bodies[index].groups;
    const counts = {
      faces: body.faces.length,
      logicalFaces: groups.length,
      edges: body.edges.length,
      classes: countClasses(classified.classes),
    };
    totals.faces += counts.faces;
    totals.logicalFaces += counts.logicalFaces;
    totals.edges += counts.edges;
    for (const name of EDGE_CLASSES) totals.classes[name] += counts.classes[name];
    const result = {
      alias,
      id: body.id,
      ...(body.name ? { name: body.name } : {}),
      toleranceMm: classified.toleranceMm,
      angularToleranceRad: classified.angularToleranceRad,
      extentMm: classified.extentMm,
      counts,
    };
    if (detail === 'summary') return result;
    result.logicalFaces = groups.map(group => ({
      alias: group.alias,
      fragments: group.fragments.map(face => `${alias}.F${face + 1}`),
      support: { ...group.support, fragment: `${alias}.F${group.support.fragment + 1}` },
    }));
    result.edges = body.edges.map((_edge, edge) => edgeRecord(alias, classified, edge));
    return result;
  });
  return {
    schema: TOPOLOGY_SCHEMA,
    modelId,
    totals,
    exactness: {
      classes: 'exact-parameters',
      logicalFaces: 'exact-parameters',
      origins: 'recorded',
    },
    method: EDGE_CLASS_METHOD,
    computeMs,
    bodies,
  };
}

export function register(router, ctx) {
  const cache = new WeakMap();
  const pattern = new RegExp(`^/api/models/(${MODEL})/topology$`);
  router.add('GET', pattern, (_req, res, { url, match }) => {
    const model = ctx.registry.model(match[1]);
    if (!model) throw new HttpError(404, 'Unknown model revision');
    const detail = url.searchParams.get('detail') ?? 'full';
    if (!DETAILS.includes(detail)) throw new HttpError(400, 'detail must be full or summary');
    if (!cache.has(model)) cache.set(model, new Map());
    const documents = cache.get(model);
    if (!documents.has(detail)) {
      documents.set(detail, topologyDocument(model, match[1], { detail }));
    }
    sendJson(res, 200, documents.get(detail));
  });
}
