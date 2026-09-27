import { fail, raise, unsupported } from './errors.mjs';
import { list, array } from './kernel.mjs';
import { real, number, vector, coords } from './real.mjs';
import { identifyImport, identifyFrustum, identifyTransform } from './identity.mjs';
import { transformConstructionHistory } from './construction-history.mjs';
import { copyExactness } from './exactness.mjs';

const xyz = (value, scale = 1) => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) fail('Invalid analytic geometry coordinate');
  return vector(value.map(n => n * scale));
};
const mm = value => xyz(value, 1000);
const num = (value, positive = false) => {
  if (!Number.isFinite(value) || (positive && value <= 0)) fail('Invalid analytic geometry parameter');
  return real(value);
};
const direction = (kernel, value) => {
  const v = xyz(value);
  if (number(kernel.precise.dot(v, v)) < 1e-16) fail('Analytic direction must be nonzero');
  return kernel.precise.normalize(v);
};

export function importOnshapeBody(kernel, source, id, provenance, identityContext = {}) {
  if (source.type !== 'solid') unsupported('Only solid input B-reps can be imported');
  const A = kernel.analytic;
  const vertexIds = new Map(source.vertices.map((v, i) => [v.id, i]));
  const edgeIds = new Map(source.edges.map((e, i) => [e.id, i]));
  if (vertexIds.size !== source.vertices.length || edgeIds.size !== source.edges.length) fail('Duplicate imported topology IDs');
  const vertices = source.vertices.map(v => mm(v.point));
  const vertexTolerancesMm = vertices.map(() => 0.0003);
  let maxInputEndpointDisagreementMm = 0;
  const surfaces = source.faces.map(({ surface: s }) => {
    if (s.type === 'plane') return A.plane(mm(s.origin), direction(kernel, s.normal));
    if (s.type === 'cylinder') return A.cylinder(mm(s.origin), direction(kernel, s.axis), num(s.radius * 1000, true));
    if (s.type === 'cone') return A.cone(mm(s.origin), direction(kernel, s.axis), num(s.radius * 1000, true), num(s.halfAngle));
    unsupported(`Imported surface '${s.type}' is not implemented`);
  });
  const recovered = [];
  const ranges = [];
  const edges = source.edges.map((edge, edgeIndex) => {
    const c = edge.curve, g = edge.geometry;
    let curve, sense = !g.arcIsCW;
    if (c.type === 'line') curve = { $: 'Line', origin: mm(g.startPoint), direction: direction(kernel, g.startVector) };
    else if (c.type === 'circle') {
      const normal = direction(kernel, c.normal);
      // A vertex-free periodic edge has no privileged start point. Choose the
      // same seam direction as its coaxial surfaces, so STEP readers need not
      // split the shared circular boundary at a second synthetic vertex.
      const x = A.axis_x(normal);
      curve = A.circle(mm(c.origin), normal, x, num(c.radius * 1000, true));
    }
    else if (c.type === 'ellipse') curve = A.ellipse(mm(c.origin), direction(kernel, c.normal), direction(kernel, c.majorAxis), num(c.majorRadius * 1000, true), num(c.minorRadius * 1000, true));
    else if (c.type === 'other') {
      const adjacent = source.faces.flatMap((f, i) => f.loops.some(l => l.coedges.some(u => u.edgeId === edge.id)) ? [surfaces[i]] : []);
      const p = adjacent.find(s => s.$ === 'Plane'), cyl = adjacent.find(s => s.$ === 'Cylinder');
      if (!p || !cyl) unsupported(`Imported edge '${edge.id}' has no recoverable analytic curve definition`);
      const d = Math.abs(number(kernel.precise.dot(p.normal, cyl.axis)));
      if (d < 1e-5 || d > 1 - 1e-5) unsupported(`Imported edge '${edge.id}' requires a different plane/cylinder intersection branch`);
      curve = A.plane_cylinder(p.origin, p.normal, cyl.origin, cyl.axis, cyl.radius);
      // Determine traversal against the analytic ellipse from the recorded tangent.
      sense = A.ellipse_forward(curve, mm(g.startPoint), xyz(g.startVector));
      recovered.push({ edge: edge.id, method: 'analytic plane/cylinder intersection in Bend' });
    } else unsupported(`Imported curve '${c.type}' is not implemented`);
    for (const key of ['startPoint', 'quarterPoint', 'midPoint', 'endPoint']) {
      const residual = A.curve_residual(curve, mm(g[key]));
      if (!Number.isFinite(residual) || residual > 0.0003) fail(`Imported edge '${edge.id}' ${key} misses its curve by ${residual} mm`);
    }
    ranges[edgeIndex] = ['circle', 'ellipse'].includes(c.type) && edge.vertices.length && Number.isFinite(g.arcSweep)
      ? A.arc_range(curve, mm(g.startPoint), mm(g.endPoint), xyz(g.startVector), xyz(g.endVector), sense, num(g.arcSweep)) : null;
    let start, end;
    if (!edge.vertices.length && ['circle', 'ellipse'].includes(c.type)) {
      const adjacent = source.faces.flatMap((face, i) => face.loops.some(loop => loop.coedges.some(use => use.edgeId === edge.id)) ? [surfaces[i]] : []);
      const seam = A.periodic_vertex(curve, list(adjacent));
      if (seam.$ !== 'Some') unsupported(`Imported edge '${edge.id}' has no resolved periodic seam on its supporting surface`);
      start = end = vertices.length; vertices.push(seam.value);
      vertexTolerancesMm.push(0.0003);
    } else if (edge.vertices.length === 2 && edge.vertices.every(v => vertexIds.has(v))) [start, end] = edge.vertices.map(v => vertexIds.get(v));
    else fail(`Invalid endpoints on imported edge '${edge.id}'`);
    if (edge.vertices.length) for (const [index, point] of [[start, g.startPoint], [end, g.endPoint]]) {
      // Preserve tolerant source topology: Onshape can store a vertex slightly
      // off its edge endpoints. Do not move points/curves to force coincidence.
      const disagreement = kernel.precise.distance(vertices[index], mm(point));
      if (disagreement > 0.01) unsupported(`Imported vertex '${source.vertices[index].id}' needs an input tolerance beyond the supported 0.01 mm budget`);
      maxInputEndpointDisagreementMm = Math.max(maxInputEndpointDisagreementMm, disagreement);
      vertexTolerancesMm[index] = Math.max(vertexTolerancesMm[index], disagreement + 0.0003);
    }
    return { $: 'Edge', start, end, curve, same_sense: sense };
  });
  const faces = source.faces.map((face, i) => ({
    $: 'Face', surface: surfaces[i], same_sense: face.orientation,
    loops: list(face.loops.map(loop => ({ $: 'Loop', outer: loop.type === 'outer', uses: list(loop.coedges.map(use => {
      const edge = edgeIds.get(use.edgeId);
      if (edge === undefined) fail(`Missing imported edge '${use.edgeId}'`);
      for (const key of ['startPoint', 'quarterPoint', 'midPoint', 'endPoint']) {
        const residual = A.surface_residual(surfaces[i], mm(source.edges[edge].geometry[key]));
        if (!Number.isFinite(residual) || residual > 0.0003) fail(`Imported edge '${use.edgeId}' misses face '${face.id}' by ${residual} mm`);
      }
      return { $: 'Use', edge, forward: use.orientation };
    })) }))),
  }));
  const solid = A.with_seams(A.assemble(list(vertices), list(edges), list(faces)));
  const body = decodeAnalytic(solid, id, kernel, vertexTolerancesMm);
  ranges.forEach((range, i) => { if (range) body.edges[i].curveRange = [number(range.first), number(range.last)]; });
  body.provenance = { ...provenance, recoveredCurves: recovered, maxInputEndpointDisagreementMm,
    toleranceRule: 'per-vertex observed input endpoint disagreement + 0.0003 mm input allowance; input disagreement limited to 0.01 mm' };
  body.referenceMeasurements = { source: 'frozen Onshape input; validation oracle only',
    faceAreasMm2: source.faces.map(f => f.area * 1e6),
    facePerimetersMm: source.faces.map(f => f.loops.flatMap(l => l.coedges).reduce((sum, use) => sum + source.edges[edgeIds.get(use.edgeId)].geometry.length * 1000, 0)),
    faceTolerancesMm: body.faces.map(f => Math.max(0.0003, ...f.loops.flatMap(l => l.flatMap(u => [body.edges[u.edge].start, body.edges[u.edge].end])).map(i => vertexTolerancesMm[i]))),
  };
  identifyImport(kernel, body, source, id, provenance, identityContext);
  return body;
}

const decodeGeometry = geometry => Object.fromEntries(Object.entries(geometry).map(([key, value]) => [key === '$' ? 'type' : key, key === '$' ? value.toLowerCase() : value?.$ === 'V3' ? coords(value) : number(value)]));
const encodeGeometry = geometry => Object.fromEntries(Object.entries(geometry).map(([key, value]) => [key === 'type' ? '$' : key, key === 'type' ? value[0].toUpperCase() + value.slice(1) : Array.isArray(value) ? vector(value) : real(value)]));

export function decodeAnalytic(solid, id, kernel, vertexTolerancesMm) {
  const body = {
    id, geometry: 'analytic', precision: 'F32x2', vertices: array(solid.vertices).map(coords),
    edges: array(solid.edges).map(e => ({ start: e.start, end: e.end, curve: decodeGeometry(e.curve), sameSense: e.same_sense })),
    faces: array(solid.faces).map(f => ({ surface: decodeGeometry(f.surface), sameSense: f.same_sense,
      loops: array(f.loops).map(l => array(l.uses).map(({ edge, forward }) => ({ edge, forward }))),
      outer: array(f.loops).map(l => l.outer) })),
  };
  body.shell = { closed: true, faces: body.faces.map((_, i) => i) };
  if (vertexTolerancesMm) body.vertexTolerancesMm = vertexTolerancesMm;
  body.validation = validateAnalytic(body, kernel);
  return body;
}

export function encodeAnalytic(body) {
  return { $: 'Solid', vertices: list(body.vertices.map(vector)),
    edges: list(body.edges.map(e => ({ $: 'Edge', start: e.start, end: e.end, curve: encodeGeometry(e.curve), same_sense: e.sameSense }))),
    faces: list(body.faces.map(f => ({ $: 'Face', surface: encodeGeometry(f.surface), same_sense: f.sameSense,
      loops: list(f.loops.map((uses, i) => ({ $: 'Loop', outer: f.outer[i], uses: list(uses.map(u => ({ $: 'Use', ...u }))) }))) }))),
  };
}

export function transformAnalytic(kernel, body, id, rows, offset, identityContext = {}) {
  const columns = [0, 1, 2].map(i => vector(rows.map(row => row[i])));
  const rotation = { $: 'Rotation', x: columns[0], y: columns[1], z: columns[2] };
  const result = decodeAnalytic(kernel.analytic.transform(encodeAnalytic(body), rotation, vector(offset)), id, kernel, body.vertexTolerancesMm);
  body.edges.forEach((edge, i) => { if (edge.curveRange) result.edges[i].curveRange = [...edge.curveRange]; });
  if (body.primitive?.type === 'frustum') {
    const p = body.primitive;
    applyFrustumMeasures(kernel, result, kernel.analytic.point_transform(vector(p.bottom), rotation, vector(offset)), kernel.analytic.point_transform(vector(p.top), rotation, vector(offset)), real(p.r0), real(p.r1));
  }
  if (body.construction?.method === 'coaxial radial/axial arrangement in Bend') {
    const bounds = kernel.boolean.rim_bounds(encodeAnalytic(result).edges);
    result.construction = { ...body.construction };
    result.validation.volumeMm3 = body.validation.volumeMm3;
    result.validation.boundsMm = { min: coords(bounds.low), max: coords(bounds.high) };
    result.validation.scope = 'boundary topology and endpoint incidence; rigidly preserved Boolean volume and tight circular-rim bounds in Bend';
  }
  if (body.construction?.method === 'convex planar halfspace clipping in Bend' ||
      body.construction?.method === 'native Bend planar arrangement union' ||
      body.construction?.method === 'native Bend planar arrangement subtraction' ||
      (body.construction?.method === 'native Bend convex-tool intersection' && body.faces.every(face => face.surface.type === 'plane'))) {
    const vertices = list(result.vertices.map(vector)), first = vector(result.vertices[0]);
    const bounds = kernel.halfspace.bounds(vertices, first, first);
    result.construction = structuredClone(body.construction);
    result.validation.volumeMm3 = body.validation.volumeMm3;
    result.validation.boundsMm = { min: coords(bounds.low), max: coords(bounds.high) };
    result.validation.scope = 'boundary topology and endpoint incidence; rigidly preserved planar Boolean volume and tight vertex bounds in Bend';
  }
  // Volumes that a rigid motion preserves exactly. The pierce belongs here: a
  // copied through-hole body (opPattern, opTransform) is the same solid, and
  // without its volume the next hole in the copy has nothing to subtract from.
  // Its bounds were never evaluated (decodeAnalytic leaves them null), so none
  // are invented for the copy either.
  const preservedScope = {
    'native Bend curved convex-tool intersection': 'rigidly preserved native Bend nominal curved volume',
    'native Bend line/arc sketch extrusion': 'rigidly preserved native Bend nominal curved volume',
    'native Bend exact revolve': 'rigidly preserved exact revolve volume in Bend',
    'native Bend through-hole pierce': body.exactness ? 'rigidly preserved through-hole volume in Bend, exact relative to a regularized target (see exactness, regularizedSources)'
      : 'rigidly preserved exact through-hole volume in Bend',
  }[body.construction?.method];
  if (preservedScope) {
    result.construction = structuredClone(body.construction);
    result.validation.volumeMm3 = body.validation.volumeMm3;
    result.validation.boundsMm = null;
    result.validation.scope = `boundary topology and endpoint incidence; ${preservedScope}; tight bounds not evaluated`;
  }
  copyExactness(body, result);
  transformConstructionHistory(body, result, id, rows, offset);
  if (body.sketchProfile) result.sketchProfile = structuredClone(body.sketchProfile);
  for (const key of ['name', 'appearance', 'description', 'provenance', 'referenceMeasurements']) if (body[key] !== undefined) result[key] = body[key];
  identifyTransform(kernel, body, result, id, rows, offset, identityContext);
  return result;
}

function applyFrustumMeasures(kernel, body, bottom, top, r0, r1) {
  const bounds = kernel.analytic.frustum_bounds(bottom, top, r0, r1);
  body.primitive = { type: 'frustum', bottom: coords(bottom), top: coords(top), r0: number(r0), r1: number(r1) };
  body.validation.volumeMm3 = number(kernel.analytic.frustum_volume_between(bottom, top, r0, r1));
  body.validation.boundsMm = { min: coords(bounds.low), max: coords(bounds.high) };
  body.validation.scope = 'boundary topology; analytic frustum mass properties in Bend';
}

export function circularFrustumInBend(kernel, id, first, second, delta, startOffset = [0, 0, 0], identityContext = {}) {
  const lift = profile => {
    const frame = kernel.precise.frame(vector(profile.plane.origin), vector(profile.plane.normal), vector(profile.plane.x));
    return kernel.precise.lift(vector([...profile.center, 0]), frame);
  };
  const bottom = kernel.precise.add(lift(first), vector(startOffset));
  const top = second ? lift(second) : kernel.precise.add(bottom, vector(delta));
  const d = kernel.precise.sub(top, bottom), height2 = number(kernel.precise.dot(d, d));
  // height <= 1e-5 mm is std math.fs TOLERANCE.zeroLength (1e-8 m): the sweep
  // has zero height in Onshape too, the operation fails there, and a try in the
  // input catches it (FsDoc exceptions.html: "a failing operation").
  if (height2 <= 1e-10) raise('Circular loft/extrusion has zero or unresolved height');
  const axis = kernel.precise.normalize(d);
  const normals = [first.plane.normal, ...(second ? [second.plane.normal] : [])];
  if (normals.some(n => Math.abs(number(kernel.precise.dot(axis, vector(n)))) < 1 - 1e-6)) unsupported('Circular loft/extrusion currently requires coaxial profiles and a normal sweep');
  const r0 = num(first.radius, true), r1 = num(second?.radius ?? first.radius, true);
  const body = decodeAnalytic(kernel.analytic.frustum(bottom, top, vector(first.plane.x), r0, r1), id, kernel);
  applyFrustumMeasures(kernel, body, bottom, top, r0, r1);
  identifyFrustum(kernel, body, id, { first, second, delta: delta ?? null, startOffset }, identityContext);
  return body;
}

export function validateAnalytic(body, kernel) {
  const { vertices, edges, faces } = body;
  if (!vertices.length || !edges.length || !faces.length || vertices.some(p => p.length !== 3 || !p.every(Number.isFinite))) fail('Invalid analytic solid');
  const incident = edges.map(() => []);
  const tolerances = body.vertexTolerancesMm ?? vertices.map(() => 0.0003);
  if (tolerances.length !== vertices.length || tolerances.some(v => !Number.isFinite(v) || v < 0.0003 || v > 0.010301)) fail('Invalid analytic vertex tolerance budget');
  const geometry = (g, types) => {
    if (!types.includes(g?.type)) unsupported(`Unsupported analytic geometry '${g?.type}'`);
    for (const [key, value] of Object.entries(g)) {
      if (key === 'type') continue;
      if (Array.isArray(value)) {
        if (value.length !== 3 || !value.every(Number.isFinite)) fail('Non-finite analytic geometry');
        if (['normal', 'axis', 'x', 'direction'].includes(key) && Math.abs(Math.hypot(...value) - 1) > 1e-5) fail('Analytic directions must be unit vectors');
      } else if (!Number.isFinite(value)) fail('Non-finite analytic parameter');
    }
    if (g.x && Math.abs(g.x.reduce((sum, v, i) => sum + v * (g.normal ?? g.axis)[i], 0)) > 1e-5) fail('Analytic frame axes must be perpendicular');
    for (const key of ['radius', 'major', 'minor']) if (g[key] !== undefined && g[key] <= 0) fail('Analytic radii must be positive');
    if (g.type === 'cone' && !(g.angle > 0 && g.angle < Math.PI / 2)) fail('Invalid cone half-angle');
  };
  edges.forEach((e, edgeIndex) => {
    for (const v of [e.start, e.end]) if (!Number.isInteger(v) || v < 0 || v >= vertices.length) fail('Invalid analytic edge vertex');
    if (typeof e.sameSense !== 'boolean' || (e.start === e.end && e.curve.type === 'line')) fail('Invalid analytic edge');
    geometry(e.curve, ['line', 'circle', 'ellipse']);
    if (kernel) for (const index of [e.start, e.end]) {
      const residual = kernel.analytic.curve_residual(encodeGeometry(e.curve), vector(vertices[index]));
      if (!Number.isFinite(residual) || residual > tolerances[index]) fail(`Analytic body '${body.id}' edge ${edgeIndex} vertex ${index} misses its curve by ${residual} mm`);
    }
  });
  faces.forEach((face, f) => {
    if (typeof face.sameSense !== 'boolean' || !face.loops.length) fail('Invalid analytic face');
    geometry(face.surface, ['plane', 'cylinder', 'cone', 'sphere', 'torus']);
    face.loops.forEach(loop => {
      if (!loop.length) fail('Empty analytic face loop');
      loop.forEach((use, i) => {
        const e = edges[use.edge], next = edges[loop[(i + 1) % loop.length].edge];
        if (!e || !next || typeof use.forward !== 'boolean') fail('Invalid analytic coedge');
        const end = use.forward ? e.end : e.start;
        const startNext = loop[(i + 1) % loop.length].forward ? next.start : next.end;
        if (end !== startNext) fail(`Analytic face ${f} has a disconnected boundary`);
        if (kernel) {
          const residual = kernel.analytic.surface_residual(encodeGeometry(face.surface), vector(vertices[end]));
          if (!Number.isFinite(residual) || residual > tolerances[end]) fail(`Analytic boundary vertex misses face ${f} by ${residual} mm`);
        }
        incident[use.edge].push({ f, forward: use.forward });
      });
    });
  });
  if (incident.some(uses => uses.length !== 2 || uses[0].forward === uses[1].forward)) fail('Analytic solid is not a closed oriented two-manifold');
  if (kernel) edges.forEach((edge, index) => {
    if (edge.curve.type !== 'line') return;
    for (const f of new Set(incident[index].map(use => use.f))) {
      if (faces[f].surface.type !== 'cylinder') continue;
      const residual = number(kernel.analytic.cylinder_line_residual(encodeGeometry(edge.curve), encodeGeometry(faces[f].surface), vector(vertices[edge.start]), vector(vertices[edge.end])));
      if (!Number.isFinite(residual) || residual > Math.max(tolerances[edge.start], tolerances[edge.end])) fail(`Analytic line edge ${index} leaves cylinder face ${f} by ${residual} mm`);
    }
  });
  const seen = new Set([0]), queue = [0];
  while (queue.length) for (const loop of faces[queue.pop()].loops) for (const use of loop) for (const { f } of incident[use.edge]) if (!seen.has(f)) { seen.add(f); queue.push(f); }
  if (seen.size !== faces.length) fail('Analytic solid contains disconnected shells');
  // This certifies the boundary graph, not watertightness of untested surface
  // intersections or mass properties. Never report an invented volume/bounds.
  return { closed: true, vertices: vertices.length, edges: edges.length, faces: faces.length,
    scope: kernel ? 'boundary topology, analytic endpoint incidence and cylinder line-segment incidence in Bend' : 'boundary topology and analytic frame checks', toleranceMm: Math.max(...tolerances),
    volumeMm3: null, boundsMm: null };
}

// Refusal codes from kernel/revolve.bend. The kernel returns a Result rather
// than a Solid precisely so a profile cannot be built without passing
// admission; this turns that refusal into the capability error the rest of the
// pipeline expects, which stays visible inside `try silent`.
const REVOLVE_REFUSALS = {
  1: 'Revolve needs at least three profile points to bound an area',
  2: 'Revolve of a profile touching the axis is not implemented; every radius must be positive',
  3: 'Revolve profile has a segment shorter than the linear tolerance',
  4: 'Revolve profile is not counterclockwise in (radius, height); the solid would be inside out',
};

export function revolveInBend(kernel, id, profile, origin, axis, x, tolerance) {
  const rings = list(profile.map(([radius, height]) => ({ $: 'Ring', radius: real(radius), height: real(height) })));
  const result = kernel.revolve.revolve(rings, real(tolerance), vector(origin), vector(axis), vector(x));
  if (result.$ !== 'Swept') unsupported(REVOLVE_REFUSALS[result.reason] ?? `Revolve refused the profile (code ${result.reason})`);
  const body = decodeAnalytic(result.solid, id, kernel);
  body.primitive = { type: 'revolve', origin, axis, x, profile };
  body.validation.volumeMm3 = number(kernel.revolve.volume(rings));
  body.validation.scope = 'boundary topology; analytic swept volume in Bend';
  return body;
}

// Refusal codes of revolve.sweep in kernel/revolve.bend (docs/revolve.md).
const SWEEP_REFUSALS = {
  1: 'Revolve profile bounds no area: it needs three points, or an arc',
  2: 'Revolve profile crosses or touches the axis away from its vertices; every point must satisfy r >= 0 and an arc may reach the axis only at its ends',
  3: 'Revolve profile has a segment, or an arc radius, not longer than the linear tolerance',
  4: 'Revolve profile is not counterclockwise in (radius, height); the solid would be inside out',
  5: 'Revolve profile arc does not end on its own circle within the linear tolerance',
  6: 'Revolve angle must lie in (0, 360) degrees by more than the linear tolerance at the largest radius; a full turn is a separate request',
  7: 'Revolve of this profile a full turn pinches the solid to a point on the axis (a profile vertex on the axis without an axis segment beside it); the result would not be a manifold',
  8: 'Revolve of an arc whose centre lies across the axis (the lemon half of a spindle torus) is not implemented',
  9: 'Revolve profile has a radius, an arc centre radius, or a straight segment within the linear tolerance of zero, perpendicular or parallel to the axis without being exactly so; snap it first',
};

const ring = ([radius, height]) => ({ $: 'Ring', radius: real(radius), height: real(height) });
const pair = value => {
  if (!Array.isArray(value) || value.length !== 2 || !value.every(Number.isFinite)) fail('Invalid revolve profile coordinate');
  return value;
};

// General exact revolve (kernel/revolve.bend `sweep`). `profile` is a closed
// chain of nodes counterclockwise in (radius, height) about the line through
// `origin` along `axis`, radius measured along `x` (unit, perpendicular):
// each node is [r, h] (a straight segment to the next node) or
// { at: [r, h], arc: { center: [r, h], ccw } } (an arc to the next node; a
// single arc node is a full circle). `angle` in radians sweeps from x about
// axis (right hand); null or undefined is a full turn.
export function sweepInBend(kernel, id, profile, origin, axis, x, tolerance, angle = null) {
  if (!Array.isArray(profile)) fail('Invalid revolve profile');
  const nodes = profile.map(node => {
    const at = pair(Array.isArray(node) ? node : node?.at);
    const arc = Array.isArray(node) ? null : node.arc ?? null;
    if (arc && typeof arc.ccw !== 'boolean') fail('Invalid revolve profile arc');
    return { $: 'Node', point: ring(at), segment: arc ? { $: 'Arc', center: ring(pair(arc.center)), ccw: arc.ccw } : { $: 'Straight' } };
  });
  if (angle !== null && angle !== undefined && !Number.isFinite(angle)) fail('Invalid revolve angle');
  const turn = angle === null || angle === undefined ? { $: 'Full' } : { $: 'Partial', angle: real(angle) };
  const result = kernel.revolve.sweep(list(nodes), turn, real(tolerance), vector(origin), vector(axis), vector(x));
  if (result.$ !== 'Built') unsupported(SWEEP_REFUSALS[result.reason] ?? `Revolve refused the profile (code ${result.reason})`);
  const body = decodeAnalytic(result.solid, id, kernel);
  body.primitive = { type: 'revolve', origin, axis, x, profile: structuredClone(profile), angle: angle ?? null };
  body.construction = { method: 'native Bend exact revolve' };
  body.validation.volumeMm3 = number(result.volume);
  body.validation.scope = 'boundary topology; exact swept volume (Green/Pappus over lines and arcs) in Bend';
  return body;
}
