// Exact edge classes (spec 7.3, D21). Package: topology-classes.
//
// Frozen signature: classifyEdges(model, scene) -> { bodies: [{ classes: Uint8Array }] }
// with one class code per edge (EDGE_CLASS). Each body result also carries,
// additively: `adjacent` (Int32Array, the two faces of every edge, -1 when
// absent), `evidence` (per edge: support relation, recorded construction
// origin, normal angle range, reason), the tolerances used and class counts.
//
// Every decision is a closed form over the stored analytic parameters
// (planes, cylinders, cones; lines, circles, ellipses), evaluated in float64
// at fixed parameter samples of the exact edge curve. No display mesh and no
// kernel call is involved, so the module runs unchanged in the server, the
// build worker and the query worker.
//
// Classes:
//   seam         a line edge used twice, in opposite directions, by one periodic
//                face (cylinder, cone): the closing generator of the surface
//   subdivision  both faces lie on the identical oriented support within the
//                tolerance, and the recorded construction origin does not
//                contradict it (FaceSubdivision or SurfaceSeam confirm;
//                OriginalEdge is inherited from an operand and neutral;
//                FaceIntersection contradicts)
//   tangent      distinct supports whose outward normals agree at every sample
//   sharp        distinct supports whose normals differ at every sample
//   unresolved   anything else, with a reason: evidence disagrees, tangency
//                varies along the edge, an unsupported surface or curve,
//                data off its support, or a non-manifold edge. Drawn as sharp.
//
// Tolerances: toleranceMm is the body's recorded validation tolerance (the
// larger endpoint vertex tolerance where imports record one).
// angularToleranceRad = toleranceMm / extentMm, where extentMm is the body's
// bounding-box diagonal from its vertices and curve extents: two normals
// closer than that deviate by less than the tolerance across the whole body.

export const EDGE_CLASSES = Object.freeze([
  'sharp', 'tangent', 'seam', 'subdivision', 'unresolved',
]);
export const EDGE_CLASS = Object.freeze(Object.fromEntries(
  EDGE_CLASSES.map((name, code) => [name, code]),
));
export const EDGE_CLASSES_SCHEMA = 'wonky.edge-classes/1';

// Parameter fractions of the edge range at which normals are compared.
export const SAMPLE_FRACTIONS = Object.freeze([0, 0.25, 0.5, 0.75, 1]);

export const EDGE_CLASS_METHOD = Object.freeze({
  exactness: 'exact-parameters',
  origins: 'recorded',
  samples: 'outward normals compared at fractions 0, 1/4, 1/2, 3/4, 1 of the exact edge range',
  angularTolerance: 'toleranceMm / body bounding-box diagonal',
  support: 'same surface type and parameters within toleranceMm, same outward orientation',
});

const PERIODIC = new Set(['cylinder', 'cone']);
const SUPPORTED_SURFACES = new Set(['plane', 'cylinder', 'cone']);

// Small float64 vector helpers.
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm = a => Math.hypot(a[0], a[1], a[2]);
const unit = a => {
  const length = norm(a);
  return length > 0 && Number.isFinite(length) ? scale(a, 1 / length) : null;
};
const isVector = value => Array.isArray(value) && value.length === 3
  && value.every(Number.isFinite);

// Angle between two unit vectors, robust near 0 and pi.
const angleBetween = (a, b) => Math.atan2(norm(cross(a, b)), dot(a, b));

export const isLegacyBody = body => body.geometry !== 'analytic';
export const faceSign = (body, face) => (isLegacyBody(body) || face.sameSense !== false ? 1 : -1);
const curveType = edge => (typeof edge.curve === 'string' ? edge.curve : edge.curve?.type);

// Body extent (bounding-box diagonal) from vertices and curve extents.
export function bodyExtent(body) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const include = (point, pad = 0) => {
    if (!isVector(point)) return;
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], point[i] - pad);
      max[i] = Math.max(max[i], point[i] + pad);
    }
  };
  for (const vertex of body.vertices ?? []) include(vertex);
  for (const edge of body.edges ?? []) {
    const curve = edge.curve;
    if (curve && typeof curve === 'object' && curve.type !== 'line') {
      include(curve.origin, Math.max(curve.radius ?? 0, curve.major ?? 0, curve.minor ?? 0));
    }
  }
  const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
  return Number.isFinite(diagonal) ? diagonal : 0;
}

export function bodyTolerances(body) {
  const recorded = body.validation?.toleranceMm;
  const toleranceMm = Number.isFinite(recorded) && recorded > 0 ? recorded : null;
  const extentMm = bodyExtent(body);
  const angularToleranceRad = toleranceMm === null ? null
    : toleranceMm / Math.max(extentMm, 1);
  return { toleranceMm, extentMm, angularToleranceRad };
}

// Linear tolerance of one edge: body tolerance, or a larger recorded tolerance
// of its endpoint vertices (frozen imports record per-vertex tolerances).
function edgeTolerance(body, edge, toleranceMm) {
  const vertexTolerances = body.vertexTolerancesMm;
  if (!Array.isArray(vertexTolerances)) return toleranceMm;
  const endpoints = [vertexTolerances[edge.start], vertexTolerances[edge.end]]
    .filter(value => Number.isFinite(value));
  return Math.max(toleranceMm, ...endpoints);
}

// Face uses of every edge: [{ face, forward }].
export function edgeUses(body) {
  const uses = body.edges.map(() => []);
  body.faces.forEach((face, faceIndex) => {
    for (const loop of face.loops ?? []) {
      for (const use of loop) {
        if (uses[use.edge]) uses[use.edge].push({ face: faceIndex, forward: use.forward });
      }
    }
  });
  return uses;
}

// Curve frame for circles and ellipses.
function conicFrame(curve) {
  const normal = unit(curve.normal ?? []);
  const x = unit(curve.x ?? []);
  if (!normal || !x || !isVector(curve.origin)) return null;
  const a = curve.type === 'circle' ? curve.radius : curve.major;
  const b = curve.type === 'circle' ? curve.radius : curve.minor;
  if (!(a > 0) || !(b > 0)) return null;
  return { origin: curve.origin, x, y: cross(normal, x), a, b };
}

const conicPoint = (frame, t) => add(frame.origin,
  add(scale(frame.x, frame.a * Math.cos(t)), scale(frame.y, frame.b * Math.sin(t))));

const conicParameter = (frame, point) => {
  const d = sub(point, frame.origin);
  return Math.atan2(dot(d, frame.y) / frame.b, dot(d, frame.x) / frame.a);
};

// Exact points of an edge at SAMPLE_FRACTIONS of its range, or a reason.
export function edgePoints(body, edge) {
  const type = curveType(edge);
  const start = body.vertices[edge.start];
  const end = body.vertices[edge.end];
  if (type === 'line') {
    const curve = typeof edge.curve === 'object' ? edge.curve : null;
    const direction = curve ? unit(curve.direction ?? []) : null;
    if (curve && direction && isVector(curve.origin) && Array.isArray(edge.curveRange)) {
      const [t0, t1] = edge.curveRange;
      if (!Number.isFinite(t0) || !Number.isFinite(t1)) return { reason: 'invalid line range' };
      return {
        points: SAMPLE_FRACTIONS.map(f => add(curve.origin, scale(direction, t0 + (t1 - t0) * f))),
      };
    }
    if (!isVector(start) || !isVector(end)) return { reason: 'line edge without vertices' };
    return { points: SAMPLE_FRACTIONS.map(f => add(start, scale(sub(end, start), f))) };
  }
  if (type === 'circle' || type === 'ellipse') {
    const frame = conicFrame(edge.curve);
    if (!frame) return { reason: `invalid ${type} parameters` };
    let first;
    let last;
    if (Array.isArray(edge.curveRange)) [first, last] = edge.curveRange;
    else if (edge.start === edge.end) {
      if (!isVector(start)) return { reason: `${type} edge without a vertex` };
      first = conicParameter(frame, start);
      last = first + 2 * Math.PI;
    } else {
      if (!isVector(start) || !isVector(end)) return { reason: `${type} edge without vertices` };
      first = conicParameter(frame, edge.sameSense === false ? end : start);
      last = conicParameter(frame, edge.sameSense === false ? start : end);
      while (last <= first) last += 2 * Math.PI;
    }
    if (!Number.isFinite(first) || !Number.isFinite(last)) {
      return { reason: `invalid ${type} range` };
    }
    return { points: SAMPLE_FRACTIONS.map(f => conicPoint(frame, first + (last - first) * f)) };
  }
  return { reason: `curve type ${type ?? 'unknown'} cannot be evaluated` };
}

// Unit axis, radial vector and axial height of a point for cylinders/cones.
function axial(surface, point) {
  const axis = unit(surface.axis ?? []);
  if (!axis || !isVector(surface.origin)) return null;
  const d = sub(point, surface.origin);
  const height = dot(d, axis);
  const radial = sub(d, scale(axis, height));
  return { axis, height, radial, rho: norm(radial) };
}

// Exact outward unit normal of a face's support at a point, or null.
export function outwardNormal(body, face, point) {
  const surface = face.surface ?? {};
  const sign = faceSign(body, face);
  if (surface.type === 'plane') {
    const normal = unit(surface.normal ?? []);
    return normal && scale(normal, sign);
  }
  if (surface.type === 'cylinder' || surface.type === 'cone') {
    const frame = axial(surface, point);
    if (!frame || !(frame.rho > 1e-12)) return null;
    const radial = scale(frame.radial, 1 / frame.rho);
    if (surface.type === 'cylinder') return scale(radial, sign);
    if (!Number.isFinite(surface.angle)) return null;
    const normal = unit(sub(radial, scale(frame.axis, Math.tan(surface.angle))));
    return normal && scale(normal, sign);
  }
  return null;
}

// Distance from a point to a face's (untrimmed) support, or null.
export function supportDistance(face, point) {
  const surface = face.surface ?? {};
  if (surface.type === 'plane') {
    const normal = unit(surface.normal ?? []);
    if (!normal || !isVector(surface.origin)) return null;
    return Math.abs(dot(sub(point, surface.origin), normal));
  }
  if (surface.type === 'cylinder' || surface.type === 'cone') {
    const frame = axial(surface, point);
    if (!frame || !Number.isFinite(surface.radius)) return null;
    if (surface.type === 'cylinder') return Math.abs(frame.rho - surface.radius);
    if (!Number.isFinite(surface.angle)) return null;
    const expected = surface.radius + frame.height * Math.tan(surface.angle);
    return Math.abs(frame.rho - expected) * Math.cos(surface.angle);
  }
  return null;
}

// Compares the supports of faces a and b over `points` (points known to lie
// on face b: edge samples, or a fragment's boundary samples).
// -> { relation: 'identical' | 'distinct' | 'unknown', why }
export function compareSupports(body, a, b, points, toleranceMm, angularToleranceRad) {
  const sa = a.surface ?? {};
  const sb = b.surface ?? {};
  if (!SUPPORTED_SURFACES.has(sa.type) || !SUPPORTED_SURFACES.has(sb.type)) {
    return { relation: 'unknown', why: `support comparison unsupported for ${sa.type}/${sb.type}` };
  }
  if (sa.type !== sb.type) return { relation: 'distinct', why: `${sa.type} and ${sb.type}` };
  if (toleranceMm === null) return { relation: 'unknown', why: 'no recorded model tolerance' };
  if (!points.length) return { relation: 'unknown', why: 'no evaluable boundary points' };
  if (sa.type !== 'plane') {
    const axisA = unit(sa.axis ?? []);
    const axisB = unit(sb.axis ?? []);
    if (!axisA || !axisB) return { relation: 'unknown', why: 'invalid axis' };
    const axisAngle = Math.asin(Math.min(1, norm(cross(axisA, axisB))));
    if (axisAngle > angularToleranceRad) {
      return { relation: 'distinct', why: `axes differ by ${degrees(axisAngle)}` };
    }
    if (sa.type === 'cylinder' && Math.abs(sa.radius - sb.radius) > toleranceMm) {
      return { relation: 'distinct', why: `radii ${sa.radius} and ${sb.radius} mm` };
    }
    if (sa.type === 'cone') {
      const flip = dot(axisA, axisB) < 0 ? -1 : 1;
      const halfAngle = Math.abs(Math.atan(Math.tan(sa.angle))
        - Math.atan(flip * Math.tan(sb.angle)));
      if (!(halfAngle <= angularToleranceRad)) {
        return { relation: 'distinct', why: `half angles differ by ${degrees(halfAngle)}` };
      }
    }
    for (const point of points) {
      const onB = axial(sb, point);
      if (!onB) return { relation: 'unknown', why: 'invalid axis' };
      const foot = add(sb.origin, scale(onB.axis, onB.height));
      const offAxis = axial(sa, foot);
      if (!offAxis || offAxis.rho > toleranceMm) {
        return { relation: 'distinct', why: 'axes are not coincident' };
      }
    }
  }
  const angles = [];
  for (const point of points) {
    const distance = supportDistance(a, point);
    if (distance === null) return { relation: 'unknown', why: 'support distance not evaluable' };
    if (distance > toleranceMm) {
      return { relation: 'distinct', why: `offset ${distance.toExponential(2)} mm` };
    }
    const na = outwardNormal(body, a, point);
    const nb = outwardNormal(body, b, point);
    if (!na || !nb) return { relation: 'unknown', why: 'normal not evaluable' };
    angles.push(angleBetween(na, nb));
  }
  const worst = Math.max(...angles);
  if (worst > Math.PI / 2) return { relation: 'distinct', why: 'opposite orientation' };
  if (worst > angularToleranceRad) {
    return { relation: 'distinct', why: `normals differ by ${degrees(worst)}` };
  }
  return { relation: 'identical', why: null };
}

const degrees = radians => `${(radians * 180 / Math.PI).toPrecision(3)} deg`;

const ORIGIN_VERDICT = Object.freeze({
  FaceSubdivision: 'same',
  SurfaceSeam: 'same',
  FaceIntersection: 'distinct',
  OriginalEdge: 'inherited',
});

// Recorded construction origin of an edge: { tag, verdict } or null.
function recordedOrigin(body, edgeIndex) {
  const origins = body.construction?.edgeOrigins;
  if (!Array.isArray(origins) || origins.length !== body.edges.length) return null;
  const tag = origins[edgeIndex]?.$;
  if (!tag) return null;
  return { tag, verdict: ORIGIN_VERDICT[tag] ?? 'unknown' };
}

// Union-find over faces joined by `pairs` ([a, b] face indices). Returns
// Int32Array groupOf and groups ordered by their smallest face index; each
// group lists its faces in ascending order.
export function joinFragments(faceCount, pairs) {
  const parent = Int32Array.from({ length: faceCount }, (_v, index) => index);
  const find = index => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  for (const [a, b] of pairs) {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  }
  const groupOf = new Int32Array(faceCount);
  const groups = [];
  const indexOfRoot = new Map();
  for (let face = 0; face < faceCount; face++) {
    const root = find(face);
    if (!indexOfRoot.has(root)) {
      indexOfRoot.set(root, groups.length);
      groups.push([]);
    }
    groupOf[face] = indexOfRoot.get(root);
    groups[groupOf[face]].push(face);
  }
  return { groupOf, groups };
}

function classifyBody(body) {
  const { toleranceMm, extentMm, angularToleranceRad } = bodyTolerances(body);
  const count = body.edges.length;
  const classes = new Uint8Array(count).fill(EDGE_CLASS.unresolved);
  const adjacent = new Int32Array(2 * count).fill(-1);
  const evidence = new Array(count);
  const samples = new Array(count);
  const uses = edgeUses(body);
  const candidates = [];

  body.edges.forEach((edge, index) => {
    const faceUses = uses[index];
    faceUses.slice(0, 2).forEach((use, k) => { adjacent[2 * index + k] = use.face; });
    const origin = recordedOrigin(body, index);
    const record = {
      support: null, origin: origin?.tag ?? null, angleRad: null, reason: null,
    };
    evidence[index] = record;
    const decide = (name, reason = null) => {
      classes[index] = EDGE_CLASS[name];
      record.reason = reason;
    };
    if (faceUses.length !== 2) {
      decide('unresolved', `edge has ${faceUses.length} face uses (expected 2)`);
      return;
    }
    const [fa, fb] = [faceUses[0].face, faceUses[1].face];
    const [a, b] = [body.faces[fa], body.faces[fb]];
    if (fa === fb) {
      const type = a.surface?.type;
      if (!PERIODIC.has(type)) decide('unresolved', `edge is used twice by one ${type} face`);
      else if (curveType(edge) !== 'line') {
        decide('unresolved', 'edge is used twice by one face but is not a surface generator');
      } else if (faceUses[0].forward === faceUses[1].forward) {
        decide('unresolved', 'edge is used twice by one face in the same direction');
      } else if (origin?.verdict === 'distinct') {
        decide('unresolved', `seam of one face but recorded as ${origin.tag}`);
      } else decide('seam');
      return;
    }
    if (toleranceMm === null) {
      decide('unresolved', 'no recorded model tolerance');
      return;
    }
    const sampled = edgePoints(body, edge);
    if (!sampled.points) {
      decide('unresolved', sampled.reason);
      return;
    }
    samples[index] = sampled.points;
    const tolerance = edgeTolerance(body, edge, toleranceMm);
    for (const [face, faceIndex] of [[a, fa], [b, fb]]) {
      for (const point of sampled.points) {
        const distance = supportDistance(face, point);
        if (distance !== null && distance > tolerance) {
          decide('unresolved', `edge point lies ${distance.toExponential(2)} mm off the support `
            + `of face F${faceIndex + 1} (tolerance ${tolerance} mm)`);
          return;
        }
      }
    }
    const support = compareSupports(body, a, b, sampled.points, tolerance, angularToleranceRad);
    record.support = support.relation;
    const verdict = origin?.verdict;
    if (support.relation === 'identical') {
      if (verdict === 'distinct') {
        decide('unresolved', `identical supports but recorded as ${origin.tag}`);
      } else {
        decide('subdivision');
        candidates.push(index);
      }
      return;
    }
    if (verdict === 'same') {
      decide('unresolved', `recorded as ${origin.tag} but ${support.relation === 'distinct'
        ? `the supports differ (${support.why})` : support.why}`);
      return;
    }
    const angles = [];
    for (const point of sampled.points) {
      const na = outwardNormal(body, a, point);
      const nb = outwardNormal(body, b, point);
      if (!na || !nb) {
        decide('unresolved', `outward normal not evaluable on ${(na ? b : a).surface?.type} face`);
        return;
      }
      angles.push(angleBetween(na, nb));
    }
    const low = Math.min(...angles);
    const high = Math.max(...angles);
    record.angleRad = [low, high];
    if (high <= angularToleranceRad) decide('tangent');
    else if (low > angularToleranceRad) decide('sharp');
    else {
      decide('unresolved',
        `tangency varies along the edge (${degrees(low)} to ${degrees(high)})`);
    }
  });

  validateChains(body, {
    classes, adjacent, evidence, samples, candidates, toleranceMm, angularToleranceRad,
  });
  const counts = Object.fromEntries(EDGE_CLASSES.map(name => [name, 0]));
  for (const code of classes) counts[EDGE_CLASSES[code]]++;
  return {
    classes, adjacent, evidence, toleranceMm, extentMm, angularToleranceRad, counts,
  };
}

// Subdivision edges chain fragments into groups. Every fragment of a group
// must lie on the representative's (smallest index) support within the
// tolerance; otherwise the chain drifted, the evidence disagrees, and every
// subdivision edge of that group becomes unresolved (no merge).
function validateChains(body, context) {
  const { classes, adjacent, evidence, samples, candidates } = context;
  if (!candidates.length) return;
  const pairs = candidates.map(edge => [adjacent[2 * edge], adjacent[2 * edge + 1]]);
  const { groupOf, groups } = joinFragments(body.faces.length, pairs);
  const failed = new Map();
  const faceEdges = new Map();
  body.edges.forEach((_edge, edge) => {
    for (const face of [adjacent[2 * edge], adjacent[2 * edge + 1]]) {
      if (face < 0) continue;
      if (!faceEdges.has(face)) faceEdges.set(face, []);
      faceEdges.get(face).push(edge);
    }
  });
  groups.forEach((group, groupIndex) => {
    if (group.length < 3) return; // two fragments: their shared edge was compared directly
    const representative = body.faces[group[0]];
    for (const fragment of group.slice(1)) {
      const points = (faceEdges.get(fragment) ?? []).flatMap(edge => samples[edge]
        ?? edgePoints(body, body.edges[edge]).points ?? []);
      const result = compareSupports(body, representative, body.faces[fragment], points,
        context.toleranceMm, context.angularToleranceRad);
      if (result.relation !== 'identical') {
        failed.set(groupIndex, `subdivision chain drifts: F${fragment + 1} and F${group[0] + 1} `
          + `do not share one support (${result.why})`);
        return;
      }
    }
  });
  if (!failed.size) return;
  for (const edge of candidates) {
    const reason = failed.get(groupOf[adjacent[2 * edge]]);
    if (!reason) continue;
    classes[edge] = EDGE_CLASS.unresolved;
    evidence[edge].reason = reason;
  }
}

const cache = new WeakMap();

// classifyEdges(model, scene) -> { schema, method, bodies: [{ classes, adjacent,
// evidence, toleranceMm, extentMm, angularToleranceRad, counts }] }.
// `scene` is accepted for the frozen signature; classes come from the exact
// model only. Results are cached per model object; treat them as read-only.
export function classifyEdges(model, _scene) {
  if (cache.has(model)) return cache.get(model);
  const result = {
    schema: EDGE_CLASSES_SCHEMA,
    method: EDGE_CLASS_METHOD,
    bodies: model.bodies.map(body => classifyBody(body)),
  };
  cache.set(model, result);
  return result;
}
