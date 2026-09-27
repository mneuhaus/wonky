import { loadKernel, list } from './kernel.mjs';
import { encodeAnalytic } from './analytic.mjs';
import { real, vector } from './real.mjs';
import { intersectionSurface, intersectionTolerance } from './intersections.mjs';
import { unsupported } from './errors.mjs';
import { inheritedConstructionBudget } from './construction-history.mjs';

let loaded;
export function loadFaceClassifier() {
  loaded ??= loadKernel().then(kernel => kernel.faceClassifier);
  return loaded;
}

function domainChoice(value) {
  if (value == null) return { $: 'AutoDomain' };
  if (value.$ === 'AutoDomain' || value.$ === 'GivenDomain') return value;
  const domain = Array.isArray(value)
    ? { $: 'Interval', first: real(value[0]), last: real(value[1]) }
    : value;
  return { $: 'GivenDomain', domain };
}

const indexValid = value => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;

// Validate representation fields before JS-to-Bend Boolean coercion. Bounds,
// incidence, closure and all geometric decisions remain in Bend.
function record(value, path, tag) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (tag && value.$ !== tag)) {
    throw new TypeError(`${path} must be ${tag ? `a native ${tag}` : 'an object'}`);
  }
}
function arrayField(value, path) {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array`);
  return value;
}
function booleanField(value, key, path, optional = false) {
  if (optional && value[key] == null) return;
  if (!Object.hasOwn(value, key) || typeof value[key] !== 'boolean') throw new TypeError(`${path}.${key} must be a boolean`);
}
function indexField(value, key, path) {
  if (!Object.hasOwn(value, key) || !indexValid(value[key])) throw new RangeError(`${path}.${key} must be an unsigned 32-bit integer`);
}
function coedgeFields(use, path, native = false) {
  record(use, path, (native || use?.$ !== undefined) ? 'Use' : undefined);
  indexField(use, 'edge', path);
  booleanField(use, 'forward', path);
}
function nativeList(value, path, visit = () => {}) {
  const seen = new Set();
  let index = 0;
  while (value?.$ === 'Con') {
    record(value, path, 'Con');
    if (seen.has(value)) throw new TypeError(`${path} must be an acyclic native list`);
    seen.add(value);
    visit(value.head, `${path}[${index++}]`);
    value = value.tail;
  }
  record(value, path, 'Nil');
}
function nativeFields(body) {
  nativeList(body.vertices, 'solid.vertices');
  nativeList(body.edges, 'solid.edges', (edge, path) => {
    record(edge, path, 'Edge');
    indexField(edge, 'start', path); indexField(edge, 'end', path);
    booleanField(edge, 'same_sense', path);
  });
  nativeList(body.faces, 'solid.faces', (face, path) => {
    record(face, path, 'Face'); booleanField(face, 'same_sense', path);
    nativeList(face.loops, `${path}.loops`, (loop, loopPath) => {
      record(loop, loopPath, 'Loop'); booleanField(loop, 'outer', loopPath);
      nativeList(loop.uses, `${loopPath}.uses`, (use, usePath) => coedgeFields(use, usePath, true));
    });
  });
}
function bodyFields(body, implicit) {
  arrayField(body.vertices, 'body.vertices');
  for (const [i, edge] of body.edges.entries()) {
    const path = `body.edges[${i}]`;
    record(edge, path); indexField(edge, 'start', path); indexField(edge, 'end', path);
    if (!implicit) booleanField(edge, 'sameSense', path);
  }
  for (const [i, face] of arrayField(body.faces, 'body.faces').entries()) {
    const path = `body.faces[${i}]`;
    record(face, path); booleanField(face, 'sameSense', path, implicit);
    const loops = arrayField(face.loops, `${path}.loops`);
    if (!implicit || face.outer != null) {
      const outer = arrayField(face.outer, `${path}.outer`);
      if (outer.length !== loops.length) throw new TypeError(`${path}.outer must provide one boolean per loop`);
      for (let j = 0; j < outer.length; j++) booleanField(outer, j, `${path}.outer`);
    }
    for (const [j, loop] of loops.entries()) for (const [k, use] of arrayField(loop, `${path}.loops[${j}]`).entries()) {
      coedgeFields(use, `${path}.loops[${j}][${k}]`);
    }
  }
}

function polyhedralSolid(body, classifier) {
  const vertices = list(body.vertices.map(vector));
  const edges = [];
  for (const edge of body.edges) {
    if (!indexValid(edge.start) || !indexValid(edge.end)) return null;
    const converted = classifier.linear_edge(vertices, edge.start, edge.end);
    if (converted.$ === 'None') return null;
    edges.push(converted.value);
  }
  const faces = body.faces.map(face => {
    if (!face.outer && face.loops.length !== 1) unsupported('Polyhedral face classification needs explicit outer-loop metadata for multiple loops');
    return { $: 'Face', surface: intersectionSurface(face.surface), same_sense: face.sameSense ?? true,
      loops: list(face.loops.map((uses, i) => ({ $: 'Loop', outer: face.outer?.[i] ?? true,
        uses: list(uses.map(use => ({ $: 'Use', ...use }))) }))) };
  });
  return { $: 'Solid', vertices, edges: list(edges), faces: list(faces) };
}

// Serialization and topology selection only. Bend derives missing line ranges,
// combines source tolerance budgets, validates the face, and classifies points.
export function classificationInput(body, classifier, options = {}) {
  record(body, 'body');
  let solid;
  if (body.$ === 'Solid') { nativeFields(body); solid = body; }
  else {
    if (body.$ !== undefined) throw new TypeError('Expected a native Solid or a B-rep body');
    const edges = arrayField(body.edges, 'body.edges');
    const implicit = edges.every(edge => edge?.curve === 'line');
    bodyFields(body, implicit);
    if (implicit) solid = polyhedralSolid(body, classifier);
    else {
      if (edges.some(edge => typeof edge.curve === 'string')) unsupported('Mixed implicit and analytic edge curves are not supported by face classification');
      solid = encodeAnalytic(body);
    }
  }
  const ranges = options.domains ?? (Array.isArray(body.edges) ? body.edges.map(edge => edge.curveRange) : []);
  const sourceBudget = inheritedConstructionBudget(body, options.inputTolerance ?? 0) ??
    classifier.max_budget(list((body.vertexTolerancesMm ?? []).map(real)), real(options.inputTolerance ?? 0));
  return { solid, domains: list(ranges.map(domainChoice)), sourceBudget };
}

export async function classifyPlanarFace(body, faceIndex, point, options = {}) {
  if (!indexValid(faceIndex)) throw new RangeError('Face index must be an unsigned integer');
  const classifier = await loadFaceClassifier();
  const { solid, domains, sourceBudget } = classificationInput(body, classifier, options);
  if (solid === null) return { $: 'Unresolved', reason: { $: 'InvalidIndex' } };
  return classifier.classify(solid, faceIndex, domains, point.$ ? point : vector(point), intersectionTolerance(options), sourceBudget);
}

export function requireResolvedFaceClassification(result) {
  if (result.$ === 'Unresolved') unsupported(`Planar face classification unresolved: ${result.reason.$}`);
  return result;
}
