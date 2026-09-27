import { fail, unsupported, UnsupportedFeatureError } from './errors.mjs';
import { isMeshBody, snappedPrintMesh } from './hybrid-mesh.mjs';
import { reusableMesh } from './hybrid.mjs';
import { triangulate } from './brep.mjs';
import { real, vector, number, coords } from './real.mjs';

// A watertight triangle mesh for analytic B-reps, with the deviation it holds
// to stated as a computed bound rather than a hope.
//
// Two rules make it watertight by construction instead of by repair. Every
// edge is sampled exactly once and both faces that use it take those samples:
// its two ends are the B-rep vertices themselves, and every point between
// them comes from Bend (kernel/tessellate.bend) -- the host places and orients
// triangles but constructs no coordinates. And one angular division serves
// the whole body: a circle gets `count` steps per full turn and an arc of
// sweep s gets ceil(count * s / 2 pi) steps, so parallel arcs of one band and
// the interior rows between them are divided alike. Choosing per face is what
// leaves the display tessellation with up to 184 unpaired edges on a revolved
// body; a shared count only ever over-divides a smaller circle, which lowers
// its deviation rather than raising it.
//
// Faces covered, and the bound each obeys (all computed in Bend; the stated
// achievedDeviationMm is the largest over every edge and face):
// - every edge: a line is exact; an arc of radius r divided into steps of
//   angle t stays within r (1 - cos(t / 2)) (sagitta / arc_sagitta);
// - planes bounded by any loops of lines, arcs and circles (outline plus
//   holes, bridged and ear clipped; a seam is cut out first): no deviation of
//   their own, the triangles lie in the plane;
// - cylinders and cones bounded by parallels (circles about the surface axis)
//   and meridians (rulings): partial and full bands, apexes. Adjacent rulings
//   are coplanar, so a triangle spanning one angular step t stays within
//   r_max (1 - cos(t / 2)) of the surface;
// - spheres and tori bounded by parallels and meridian arcs: bands, lunes
//   between poles, a full torus on one vertex. A triangle whose corners lie on
//   the surface du apart about the axis and dv apart along the meridian stays
//   within ((R + r) du^2 + 2 r du dv + r dv^2) / 8 (grid_bound, derived in
//   kernel/tessellate.bend), both ways;
// - planes and ruled surfaces between two whole circles (the annulus of a
//   bored body), zipped by angle.
// Everything else (ellipse and intersection-curve edges, B-spline faces, a
// sphere or torus zone without a meridian) is refused by name.

const TURN = 2 * Math.PI;
const sub = (a, b) => a.map((v, i) => v - b[i]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
const scale = (a, k) => a.map(v => v * k);
const norm = a => Math.hypot(...a);
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
const wrap = a => a - TURN * Math.round(a / TURN);
const curveType = edge => typeof edge.curve === 'string' ? edge.curve : edge.curve.type;

// The outward direction of a face at a point. Orientation bookkeeping over
// surfaces Bend already produced, not new geometry.
function outward(face, point) {
  const s = face.surface, sign = face.sameSense ? 1 : -1;
  if (s.type === 'plane') return scale(s.normal, sign);
  if (s.type === 'sphere') {
    const d = sub(point, s.origin), length = norm(d);
    if (length === 0) unsupported('Print mesh cannot orient a spherical face at its own centre');
    return scale(d, sign / length);
  }
  const radial = sub(sub(point, s.origin), scale(s.axis, dot(sub(point, s.origin), s.axis)));
  const length = norm(radial);
  if (length === 0) unsupported('Print mesh cannot orient a face at a point on its own axis');
  if (s.type === 'cylinder') return scale(radial, sign / length);
  if (s.type === 'cone') {
    // decodeAnalytic has already resolved the half-angle to a plain number.
    // Reading it as a double-word Real gave NaN here, which silently disabled
    // the flip below on every conical face -- harmless only while the strip
    // winding happened to already agree.
    if (!Number.isFinite(s.angle)) unsupported('Print mesh needs a resolved cone half-angle to orient a face');
    const n = sub(scale(radial, 1 / length), scale(s.axis, Math.tan(s.angle)));
    return scale(n, sign / norm(n));
  }
  if (s.type === 'torus') {
    // Away from the core circle point nearest to it.
    const d = sub(point, sub(s.origin, scale(radial, -s.major / length)));
    return scale(d, sign / norm(d));
  }
  return unsupported(`Print mesh does not know how to orient a ${s.type} face`);
}

// The parameter interval of a circle edge in the curve's own (counter-
// clockwise about its normal) direction, and the vertices at its two ends.
//
// An arc is a circle plus either an explicit curveRange or two different end
// vertices: a revolved body's arcs carry no curveRange at all. Reading only
// the curveRange as "trimmed" turned every such arc into a whole circle -- a
// lens profile came out 6.6 times its own volume with 71 unpaired edges.
// sameSense false means the edge runs against its curve, so its start vertex
// sits at the END of the curve interval.
function circleSpan(kernel, body, edge) {
  const c = edge.curve, withCurve = edge.sameSense !== false;
  const from = body.vertices[withCurve ? edge.start : edge.end], to = body.vertices[withCurve ? edge.end : edge.start];
  const full = edge.start === edge.end;
  const angle = point => number(kernel.tessellate.angle_of(vector(c.origin), vector(c.normal), vector(c.x), vector(point)));
  let first, sweep;
  if (edge.curveRange) {
    [first] = edge.curveRange;
    sweep = edge.curveRange[1] - edge.curveRange[0];
  } else {
    first = angle(from);
    sweep = full ? TURN : angle(to) - first;
    while (sweep <= 0) sweep += TURN;
    while (sweep > TURN) sweep -= TURN;
  }
  if (!(sweep > 0 && sweep <= TURN * (1 + 1e-12))) fail(`Invalid circle edge interval (${first}, sweep ${sweep})`);
  return { first, sweep, full: full || sweep >= TURN * (1 - 1e-12), from, to, withCurve };
}

// Steps for an arc of `sweep` under the body's division of `count` per turn.
// The slack absorbs the last bits of a sweep that should be an exact multiple
// of one step, so two parallel arcs of one band always agree.
const stepsFor = (sweep, count) => sweep >= TURN * (1 - 1e-12) ? count : Math.max(1, Math.ceil(count * sweep / TURN - 1e-9));

// Every edge sampled once, in its own start -> end direction. The two ends are
// the B-rep vertices (the same arrays every other edge at that vertex uses);
// the interior points come from Bend. `bound` is how far the chords stay from
// the edge, computed in Bend; `step` the parameter step.
function edgeSampler(kernel, body, count) {
  const cache = new Map();
  return index => {
    if (cache.has(index)) return cache.get(index);
    const edge = body.edges[index], type = curveType(edge);
    let entry;
    if (type === 'line') {
      entry = { type, points: [body.vertices[edge.start], body.vertices[edge.end]], bound: 0, step: 0 };
    } else if (type === 'circle') {
      const c = edge.curve, span = circleSpan(kernel, body, edge), steps = stepsFor(span.sweep, count);
      const interior = arrayOf(kernel.tessellate.arc_interior(vector(c.origin), vector(c.normal), vector(c.x), real(c.radius),
        real(span.first), real(span.sweep), steps)).map(coords);
      const points = [span.from, ...interior, span.to];
      if (!span.withCurve) points.reverse();
      // A whole circle states the same sagitta the chord count was chosen by.
      const bound = number(span.full ? kernel.tessellate.sagitta(real(c.radius), steps) : kernel.tessellate.arc_sagitta(real(c.radius), real(span.sweep), steps));
      entry = { type, points, bound, step: span.sweep / steps, sweep: span.sweep, full: span.full, radius: c.radius };
    } else {
      return unsupported(`Print mesh does not cover a ${type} edge (edge ${index})`);
    }
    cache.set(index, entry);
    return entry;
  };
}

// The body-wide division: the most any circle asks for to hold the deviation
// with its chords, and any sphere or torus zone with its grid (grid_bound).
function bodyCount(kernel, body, deviationMm) {
  const deviation = real(deviationMm);
  let count = 0;
  for (const edge of body.edges) {
    if (curveType(edge) !== 'circle') continue;
    const radius = real(edge.curve.radius), n = kernel.tessellate.chord_count(radius, deviation);
    if (!kernel.tessellate.within(radius, n, deviation))
      unsupported(`Print mesh cannot hold ${deviationMm} mm on a radius of ${edge.curve.radius} mm without exceeding the chord cap`);
    count = Math.max(count, n);
  }
  for (const face of body.faces) {
    const zone = zoneRadii(face.surface);
    if (!zone) continue;
    const [major, minor] = zone.map(real), n = kernel.tessellate.grid_count(major, minor, deviation);
    if (!kernel.tessellate.grid_within(major, minor, n, deviation))
      unsupported(`Print mesh cannot hold ${deviationMm} mm on a ${face.surface.type} of radius ${zone[1]} mm without exceeding the chord cap`);
    count = Math.max(count, n);
  }
  return count;
}
const zoneRadii = s => s.type === 'sphere' ? [0, s.radius] : s.type === 'torus' ? [s.major, s.minor] : null;

// With { tags: true } the result also carries `tags`: for every triangle the
// index of the body face it lies on (the face-provenance a tagged mesh Boolean
// or B-rep recovery needs). Without it the result is unchanged.
//
// Two bodies bring their own mesh (src/hybrid-mesh.mjs, src/hybrid.mjs):
// - a certified-mesh body is its mesh, snapped onto the exact curves where
//   that re-certifies within its deviation (src/hybrid-mesh.mjs snapMesh),
//   with the deviation it states and its approximation label; a finer request
//   is refused by name;
// - a body the hybrid Boolean recovered exactly keeps corefine's result mesh
//   assigned to its faces (hybridMesh). It is used only where this mesher
//   refuses the body by name, and only while the body is unchanged and the
//   mesh holds the request.
export function printMesh(kernel, body, deviationMm, { tags: withTags = false } = {}) {
  if (isMeshBody(body)) {
    const own = snappedPrintMesh(kernel, body, deviationMm);
    selfCheck(body, own.triangles);
    return { triangles: own.triangles, count: 0, deviationMm, achievedDeviationMm: own.deviationMm, approximation: { ...body.approximation, snap: own.snap },
      source: own.snap?.applied ? 'certified mesh snapped onto the exact curves (src/hybrid-mesh.mjs snapMesh)' : 'certified mesh (src/hybrid-mesh.mjs)',
      ...(withTags ? { tags: own.tags } : {}) };
  }
  try { return meshBody(kernel, body, deviationMm, withTags); } catch (error) {
    const attached = error instanceof UnsupportedFeatureError && body.hybridMesh ? reusableMesh(body, deviationMm).mesh : null;
    if (!attached) throw error;
    const triangles = attached.triangles.map(t => [attached.vertices[t[0]], attached.vertices[t[1]], attached.vertices[t[2]]]);
    selfCheck(body, triangles);
    return { triangles, count: 0, deviationMm, achievedDeviationMm: attached.deviationMm, refused: error.message,
      source: 'the hybrid Boolean result mesh attached to this recovered body (src/hybrid.mjs attachResultMesh)',
      ...(withTags ? { tags: attached.triangles.map(t => t[3]) } : {}) };
  }
}

function meshBody(kernel, body, deviationMm, withTags) {
  const curved = body.edges.some(e => curveType(e) !== 'line');
  if (!curved && body.geometry !== 'analytic') {
    // Nothing curved to approximate, so the body's own facets are already the
    // mesh and carry no deviation at all. Handled here rather than refused so
    // that one flag produces a printable file for every body a part contains.
    const facets = triangulate(body);
    const triangles = facets.map(t => t.vertices.map(i => body.vertices[i]));
    selfCheck(body, triangles);
    return { triangles, count: 0, deviationMm, achievedDeviationMm: 0, ...(withTags ? { tags: facets.map(t => t.face) } : {}) };
  }
  // The division is chosen to hold the request; the bound actually achieved
  // is then measured over every edge and face. An arc's step may exceed a
  // whole turn's by the slack stepsFor allows, so the one case where that
  // tips the bound past the request is answered with a finer division.
  let count = bodyCount(kernel, body, deviationMm);
  for (let attempt = 0; attempt < 4; attempt++) {
    const mesh = meshAt(kernel, body, count);
    if (mesh.achieved <= deviationMm) {
      selfCheck(body, mesh.triangles);
      return { triangles: mesh.triangles, count, deviationMm, achievedDeviationMm: mesh.achieved, ...(withTags ? { tags: mesh.tags } : {}) };
    }
    count++;
  }
  return unsupported(`Print mesh could not hold ${deviationMm} mm on body ${body.id}`);
}

function meshAt(kernel, body, count) {
  const sample = edgeSampler(kernel, body, count);
  const oriented = use => use.forward ? sample(use.edge).points : [...sample(use.edge).points].reverse();
  const triangles = [], tags = [];
  let achieved = 0;
  for (const [index, face] of body.faces.entries()) {
    const emit = (a, b, c) => {
      const n = cross(sub(b, a), sub(c, a));
      if (norm(n) === 0) return; // a degenerate sliver (a pole, a bridge) contributes no surface
      triangles.push(dot(n, outward(face, [0, 1, 2].map(i => (a[i] + b[i] + c[i]) / 3))) < 0 ? [a, c, b] : [a, b, c]);
      tags.push(index);
    };
    // A planar outline's triangles come out of withHoles counterclockwise
    // about the surface normal (exact signs, polygonFlat), so the face sense
    // orients them. The rounded 3D cross product of a sliver between nearly
    // collinear outline points (a rotated face: area 1e-13 mm2) has no
    // reliable direction and may be exactly zero; emit would flip or drop
    // such a triangle and open or misorient its edges.
    const emitFlat = (a, b, c) => {
      triangles.push(face.sameSense ? [a, b, c] : [a, c, b]);
      tags.push(index);
    };
    // Every edge's chord bound counts: each edge bounds some face.
    for (const use of face.loops.flat()) achieved = Math.max(achieved, sample(use.edge).bound);
    const type = face.surface.type;
    // Whole circles as the only boundary, whether each is its own loop (a
    // bore) or a straight seam joins them into one (a full revolve).
    const uses = face.loops.flat(), once = uses.filter(u => uses.filter(v => v.edge === u.edge).length === 1);
    const rims = once.length && once.length <= 2 && once.every(u => sample(u.edge).full)
      && uses.every(u => once.includes(u) || curveType(body.edges[u.edge]) === 'line') ? once.map(u => u.edge) : null;
    if (rims?.length === 1 && type === 'plane') {
      // A disc: a fan about the circle's own centre, which lies on the face.
      const rim = sample(rims[0]).points, centre = body.edges[rims[0]].curve.origin;
      for (let k = 0; k + 1 < rim.length; k++) emit(centre, rim[k], rim[k + 1]);
    } else if (rims?.length === 2 && ['plane', 'cylinder', 'cone'].includes(type)) {
      // An annulus or a full band: the two rims zipped by angle, whichever way
      // round each runs (X06). On a ruled surface each triangle spans rulings
      // at most one step apart, so the edge bound of the larger rim holds.
      for (const [a, b, c] of band(...rims.map(edge => [sample(edge).points.slice(0, -1), body.edges[edge].curve]))) emit(a, b, c);
    } else if (type === 'plane') {
      planarFace(body, face, index, oriented, emitFlat);
    } else if (['cylinder', 'cone', 'sphere', 'torus'].includes(type)) {
      achieved = Math.max(achieved, revolvedFace(kernel, body, face, index, count, sample, oriented, emit));
    } else {
      unsupported(`Print mesh does not cover a ${type} face (face ${index})`);
    }
  }
  return { triangles, tags, achieved };
}

// The points of a run of uses in traversal order, each shared vertex once;
// a closed run drops its repeated first point.
function runPoints(run, oriented, index) {
  const out = [];
  for (const use of run) {
    const points = oriented(use);
    if (out.length && !samePoint(out.at(-1), points[0])) fail(`Print mesh found face ${index}'s loop broken between its edges`);
    out.push(...(out.length ? points.slice(1) : points));
  }
  const closed = out.length > 1 && samePoint(out[0], out.at(-1));
  if (closed) out.pop();
  return { points: out, closed };
}

// A plane: one outline and any holes, each a closed polyline of the shared
// edge samples. A plane adds no deviation of its own: its triangles lie in it,
// and only the chords of its curved edges depart from the true outline.
//
// A seam (an edge the face uses twice, as a full revolve closes its annulus)
// bounds no area, so it is cut out and the loop falls apart into the closed
// rings it joined. Each ring is then oriented by withHoles, not by the loop:
// an imported circle may run either way round (X06), and a seam joining it
// would otherwise fold the outline across itself. The outline is the ring of
// largest area; every other ring is a hole in it.
function planarFace(body, face, index, oriented, emit) {
  const s = face.surface, y = cross(s.normal, s.x);
  const uses = new Map();
  for (const use of face.loops.flat()) uses.set(use.edge, (uses.get(use.edge) ?? 0) + 1);
  const rings = [];
  const close = run => {
    const { points, closed } = runPoints(run, oriented, index);
    if (!closed) unsupported(`Print mesh could not close face ${index} into rings once its seams are cut out`);
    rings.push(points);
  };
  for (const loop of face.loops) {
    const kept = loop.map(use => uses.get(use.edge) > 1 ? null : use);
    if (kept.every(Boolean)) { close(loop); continue; }
    const start = kept.findIndex((use, k) => use && !kept[(k + kept.length - 1) % kept.length]);
    let run = [];
    for (let k = 0; start >= 0 && k < kept.length; k++) {
      const use = kept[(start + k) % kept.length];
      if (use) run.push(use);
      else if (run.length) { close(run); run = []; }
    }
    if (run.length) close(run);
  }
  if (!rings.length) unsupported(`Print mesh found no boundary around face ${index}`);
  const area = ring => Math.abs(ring.reduce((sum, p, k) => {
    const q = ring[(k + 1) % ring.length];
    return sum + dot(p, s.x) * dot(q, y) - dot(q, s.x) * dot(p, y);
  }, 0));
  const outerIndex = rings.reduce((best, ring, k) => area(ring) > area(rings[best]) ? k : best, 0);
  const parts = withHoles(rings[outerIndex], rings.filter((_, k) => k !== outerIndex), s.normal, s.x);
  if (!parts) unsupported(`Print mesh could not triangulate face ${index}; a hole may be unreachable or the outline may cross itself`);
  for (const [a, b, c] of parts) emit(a, b, c);
}

// A face of a surface of revolution (cylinder, cone, sphere, torus) whose one
// loop runs along parallels (circles about the surface axis) and meridians
// (lines or arcs in a plane through it). In its (u = angle about the axis,
// v = along the meridian) parameters such a face is a rectangle, a triangle
// with a pole or apex, or a lune between two poles:
//   P M P M  a band: bottom parallel, meridian, top parallel, meridian
//            (a full band closes on a seam, a full torus on one vertex);
//   P M M    a parallel and two meridians meeting at an apex or pole;
//   M M      two meridians from pole to pole (a sphere, partial or whole).
// Rows run along u: the parallels' own samples at the ends, a single point at
// a pole, and between them each meridian sample turned about the axis by Bend
// (row_interior) in the body's division. Consecutive rows are zipped by angle.
// Returns the face's own deviation bound (beyond its edges').
function revolvedFace(kernel, body, face, index, count, sample, oriented, emit) {
  const s = face.surface, type = s.type;
  const refuse = why => unsupported(`Print mesh covers ${type} faces bounded by parallels and meridians; face ${index} ${why}`);
  if (face.loops.length !== 1) refuse(`has ${face.loops.length} loops`);
  if (!Array.isArray(s.x)) refuse('has no reference direction');
  const axis = s.axis, origin = s.origin, x = s.x, y = cross(axis, x);
  const offAxis = p => { const d = sub(p, origin); return sub(d, scale(axis, dot(d, axis))); };
  const extent = Math.max(1, ...body.vertices.map(v => norm(sub(v, origin))));
  const tolerance = 1e-7 + 1e-8 * extent;
  const onAxis = p => norm(offAxis(p)) <= tolerance;
  const kindOf = edgeIndex => {
    const edge = body.edges[edgeIndex], type = curveType(edge), c = edge.curve;
    if (type === 'circle') {
      if (norm(cross(c.normal, axis)) <= 1e-7 && onAxis(c.origin)) return 'P';
      if (Math.abs(dot(c.normal, axis)) <= 1e-7 && Math.abs(dot(c.normal, sub(c.origin, origin))) <= tolerance) return 'M';
    } else if (type === 'line') {
      const [a, b] = [body.vertices[edge.start], body.vertices[edge.end]], d = sub(b, a);
      if (Math.abs(dot(cross(d, axis), sub(a, origin))) <= tolerance * norm(d)) return 'M';
    }
    return refuse(`has a ${type} edge (edge ${edgeIndex}) that is neither`);
  };

  // Uses grouped into sides. Two meridian uses continue one side when they
  // meet off the axis; meeting on it they are two sides at a pole or apex.
  const uses = face.loops[0].map(use => ({ use, kind: kindOf(use.edge), points: oriented(use) }));
  const joined = (a, b) => a.kind === b.kind && (a.kind === 'P' || !onAxis(b.points[0]));
  const start = uses.findIndex((u, k) => !joined(uses[(k + uses.length - 1) % uses.length], u));
  if (start < 0) refuse('is closed by a single run of one kind of edge');
  const sides = [];
  for (let k = 0; k < uses.length; k++) {
    const u = uses[(start + k) % uses.length];
    if (k && joined(sides.at(-1).uses.at(-1), u)) {
      sides.at(-1).uses.push(u);
      sides.at(-1).points.push(...u.points.slice(1));
    } else sides.push({ kind: u.kind, uses: [u], points: [...u.points] });
  }
  const first = sides.findIndex(side => side.kind === 'P');
  if (first > 0) sides.push(...sides.splice(0, first));
  const pattern = sides.map(side => side.kind).join('');
  const reversed = points => [...points].reverse();
  let row0, rowEnd, col0, col1;
  if (pattern === 'PMPM') {
    [row0, col1, rowEnd, col0] = [sides[0].points, sides[1].points, reversed(sides[2].points), reversed(sides[3].points)];
  } else if (pattern === 'PMM') {
    [row0, col1, col0] = [sides[0].points, sides[1].points, reversed(sides[2].points)];
    rowEnd = [col1.at(-1)];
  } else if (pattern === 'MM') {
    [col0, col1] = [sides[0].points, reversed(sides[1].points)];
    [row0, rowEnd] = [[col0[0]], [col0.at(-1)]];
  } else {
    return refuse(`runs ${pattern} (parallel P, meridian M)`);
  }
  for (const row of [row0, rowEnd]) if (row.length === 1 && !onAxis(row[0])) refuse('closes at a point off its axis');
  if (col0.length !== col1.length) refuse('has meridians divided differently');

  // The signed turn from col0 to col1 about the axis, and how each row runs.
  const angle = p => { const d = offAxis(p); return Math.atan2(dot(d, y), dot(d, x)); };
  const direction = row => Math.sign(wrap(angle(row[1]) - angle(row[0])));
  let delta;
  if (pattern !== 'MM') {
    // The parallel's own sweep, signed the way its samples run in loop order.
    delta = direction(row0) * sides[0].uses.reduce((sum, u) => sum + sample(u.use.edge).sweep, 0);
  } else {
    // No parallel: the face lies to the left of its loop seen from outside.
    if (col0.length < 3) refuse('has a meridian with no sample off its axis');
    const k = Math.floor((col0.length - 2) / 2);
    const p = scale([0, 1, 2].map(i => col0[k][i] + col0[k + 1][i]), 0.5), along = sub(col0[k + 1], col0[k]);
    const side = Math.sign(dot(cross(outward(face, p), along), cross(axis, offAxis(p))));
    if (!side) refuse('has no measurable side');
    const whole = sides[0].uses.length === 1 && sides[1].uses.length === 1 && sides[0].uses[0].use.edge === sides[1].uses[0].use.edge;
    let turn = whole ? TURN : ((side * (angle(col1[k + 1]) - angle(col0[k + 1]))) % TURN + TURN) % TURN;
    if (!(turn > 0)) refuse('spans no angle');
    delta = side * turn;
  }
  if (!(Math.abs(delta) > 0 && Math.abs(delta) <= TURN * (1 + 1e-12))) refuse(`spans an invalid angle (${delta})`);
  const steps = stepsFor(Math.abs(delta), count);

  const rows = [row0];
  for (let k = 1; k + 1 < col0.length; k++)
    rows.push([col0[k], ...arrayOf(kernel.tessellate.row_interior(vector(col0[k]), vector(origin), vector(axis), real(delta), steps)).map(coords), col1[k]]);
  rows.push(rowEnd);
  // A whole-turn row may run either way round (an imported circle's normal
  // need not agree with the loop); it is put in delta's direction. An open
  // row's direction is fixed by its ends, so disagreeing with delta is refused.
  const sign = Math.sign(delta);
  const runs = rows.map(row => {
    if (row.length === 1 || direction(row) === sign) return row;
    if (samePoint(row[0], row.at(-1))) return reversed(row);
    return refuse('has a parallel running against its own band');
  });
  const angles = runs.map(row => {
    if (row.length === 1) return [0];
    const out = [0];
    for (let k = 1; k < row.length; k++) {
      const step = sign * wrap(angle(row[k]) - angle(row[k - 1]));
      if (!(step > 0)) refuse('has a row that does not advance about its axis');
      out.push(out[k - 1] + step);
    }
    return out;
  });
  for (let k = 0; k + 1 < runs.length; k++)
    for (const [a, b, c] of zip(runs[k], angles[k], runs[k + 1], angles[k + 1])) emit(a, b, c);

  // The face's own bound. Steps about the axis are the parallels' and the
  // interior rows'; along the meridian, the meridian arcs'.
  const parallels = sides.filter(side => side.kind === 'P').flatMap(side => side.uses.map(u => sample(u.use.edge)));
  const du = Math.max(Math.abs(delta) / steps, ...parallels.map(e => e.step));
  if (type === 'sphere' || type === 'torus') {
    const meridians = sides.filter(side => side.kind === 'M').flatMap(side => side.uses.map(u => sample(u.use.edge)));
    const dv = Math.max(0, ...meridians.map(e => e.step));
    const [major, minor] = zoneRadii(s).map(real);
    return number(kernel.tessellate.grid_bound(major, minor, real(du), real(dv)));
  }
  // A ruled surface: adjacent rulings are coplanar and a zipped triangle
  // spans at most one step of either row, so the flat triangle stays within
  // the sagitta of that step at the largest radius -- the largest parallel's
  // own edge bound when it has the largest step, as it does in a full band.
  const widest = parallels.reduce((best, e) => !best || e.radius > best.radius ? e : best, null);
  if (!widest) refuse('has no parallel');
  return widest.step >= du ? widest.bound : number(kernel.tessellate.arc_sagitta(real(widest.radius), real(du), 1));
}

// Two rows of one face, each running from the col0 side to the col1 side,
// zipped by their angles (both start at 0). A single-point row is a pole: a
// fan. Rows stepping together make quads, split as the band strip splits them.
function zip(low, lowAngles, high, highAngles) {
  const out = [];
  if (low.length === 1 || high.length === 1) {
    const [pole, row] = low.length === 1 ? [low[0], high] : [high[0], low];
    for (let k = 0; k + 1 < row.length; k++) out.push([pole, row[k], row[k + 1]]);
    return out;
  }
  const n = low.length - 1, m = high.length - 1;
  const tie = 1e-9 * Math.max(lowAngles[n], highAngles[m]) / Math.max(n, m);
  let i = 0, j = 0;
  while (i < n || j < m) {
    const step = i >= n ? 1 : j >= m ? -1 : Math.abs(lowAngles[i + 1] - highAngles[j + 1]) <= tie ? 0 : lowAngles[i + 1] < highAngles[j + 1] ? -1 : 1;
    if (step === 0) {
      out.push([low[i], low[i + 1], high[j + 1]], [low[i], high[j + 1], high[j]]);
      i++; j++;
    } else if (step < 0) { out.push([low[i], low[i + 1], high[j]]); i++; }
    else { out.push([low[i], high[j + 1], high[j]]); j++; }
  }
  return out;
}

// The strip between the two rims of a band, zipped by angle about the axis.
//
// Pairing ring index k with ring index k assumed both rims run the same way
// from the same start. They need not: an imported hole (X06) carries its two
// rim circles with opposite normals, so one ring runs clockwise where the other
// runs counterclockwise, and index-wise stitching twisted every band into a
// bow tie -- 168 misoriented edges and 1.57 mm off the real surface, exported
// without a word. Here each ring is put in counterclockwise order in the first
// rim's frame and the two are merged by angle, which holds whatever the rims'
// normals, x axes or starting points are. The rings themselves are the cached
// Bend points the neighbouring faces use, so the seams still close; only the
// order they are visited in is decided here. Every triangle spans at most one
// chord step of either ring, so the stated deviation still bounds it.
function band([lowRing, lowCircle], [highRing, highCircle]) {
  const axis = lowCircle.normal, x = lowCircle.x, y = cross(axis, x), turn = 2 * Math.PI;
  const wrap = a => a - turn * Math.round(a / turn);
  const angleAbout = centre => p => { const d = sub(p, centre); return Math.atan2(dot(d, y), dot(d, x)); };
  const ordered = (points, centre) => {
    const angle = angleAbout(centre);
    const counterclockwise = wrap(angle(points[1]) - angle(points[0])) > 0;
    return counterclockwise ? points : [points[0], ...points.slice(1).reverse()];
  };
  const low = ordered(lowRing, lowCircle.origin), lowAngle = angleAbout(lowCircle.origin);
  let high = ordered(highRing, highCircle.origin);
  const highAngle = angleAbout(highCircle.origin), start = lowAngle(low[0]);
  // Start the high ring at the point angularly nearest the low ring's start.
  let nearest = 0;
  high.forEach((p, k) => { if (Math.abs(wrap(highAngle(p) - start)) < Math.abs(wrap(highAngle(high[nearest]) - start))) nearest = k; });
  high = [...high.slice(nearest), ...high.slice(0, nearest)];
  const unwrapped = (points, angle, first) => {
    const out = [first];
    for (let k = 1; k <= points.length; k++)
      out.push(out[k - 1] + wrap(angle(points[k % points.length]) - angle(points[k - 1])));
    return out;
  };
  const a = unwrapped(low, lowAngle, start), b = unwrapped(high, highAngle, start + wrap(highAngle(high[0]) - start));
  // Rims that already run alike step together, a quad at a time, split the
  // way the index-wise strip always split them: those bands mesh exactly as
  // before. The tie tolerance only absorbs the rounding of the angles.
  const tie = 1e-9 * turn / Math.max(low.length, high.length);
  const n = low.length, m = high.length, out = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    const step = i >= n ? 1 : j >= m ? -1 : Math.abs(a[i + 1] - b[j + 1]) <= tie ? 0 : a[i + 1] < b[j + 1] ? -1 : 1;
    if (step === 0) {
      out.push([low[i], low[(i + 1) % n], high[(j + 1) % m]], [low[i], high[(j + 1) % m], high[j]]);
      i++; j++;
    } else if (step < 0) { out.push([low[i], low[(i + 1) % n], high[j % m]]); i++; }
    else { out.push([low[i % n], high[(j + 1) % m], high[j]]); j++; }
  }
  return out;
}

// Watertight and consistently wound, checked rather than assumed: welded on
// exact coordinates (every shared point here is one Bend value used twice),
// every edge must be used exactly once in each direction. A mesh that fails is
// a defect in this file, never a property of the part, so it is refused as a
// self-audit failure instead of being written.
export function meshDefects(triangles) {
  const key = p => `${p[0]},${p[1]},${p[2]}`;
  const edges = new Map();
  for (const triangle of triangles) {
    const corners = triangle.map(key);
    for (let k = 0; k < 3; k++) {
      const from = corners[k], to = corners[(k + 1) % 3];
      const id = from < to ? `${from}|${to}` : `${to}|${from}`;
      const entry = edges.get(id) ?? { forward: 0, backward: 0 };
      if (from < to) entry.forward++; else entry.backward++;
      edges.set(id, entry);
    }
  }
  let open = 0, misoriented = 0, nonManifold = 0;
  for (const { forward, backward } of edges.values()) {
    if (forward + backward === 1) open++;
    else if (forward + backward > 2) nonManifold++;
    else if (forward !== 1) misoriented++;
  }
  return { open, misoriented, nonManifold, watertight: open + misoriented + nonManifold === 0 };
}

function selfCheck(body, triangles) {
  const defects = meshDefects(triangles);
  if (!defects.watertight)
    fail(`Print mesh self-check failed for body ${body.id}: ${defects.open} open, ${defects.misoriented} misoriented and ${defects.nonManifold} non-manifold edges; the mesh is refused rather than returned`);
}

function arrayOf(values) {
  const out = [];
  while (values.$ === 'Con') { out.push(values.head); values = values.tail; }
  return out;
}

export function toPrintStl(kernel, model, { deviationMm = 0.02 } = {}) {
  const lines = [], manifest = { schema: 'wonky.print-mesh/1', deviationMm, bodies: [] };
  for (const body of model.bodies) {
    const mesh = printMesh(kernel, body, deviationMm);
    const name = body.id.replace(/[^A-Za-z0-9_-]/g, '_');
    lines.push(`solid ${name}`);
    for (const [a, b, c] of mesh.triangles) {
      const n = cross(sub(b, a), sub(c, a)), length = norm(n);
      lines.push(`  facet normal ${scale(n, 1 / length).map(v => v.toPrecision(9)).join(' ')}`, '    outer loop',
        ...[a, b, c].map(p => `      vertex ${p.map(v => v.toPrecision(9)).join(' ')}`), '    endloop', '  endfacet');
    }
    lines.push(`endsolid ${name}`);
    manifest.bodies.push({ id: body.id, chordCount: mesh.count, triangles: mesh.triangles.length,
      achievedDeviationMm: mesh.achievedDeviationMm, exactVolumeMm3: body.validation?.volumeMm3 ?? null,
      ...(mesh.approximation ? { approximation: mesh.approximation } : {}), ...(mesh.source ? { meshSource: mesh.source } : {}) });
  }
  return { stl: lines.join('\n') + '\n', manifest };
}

// A planar face with an outer outline and any number of circular holes: a
// pierced cap. Each hole is bridged into the outline and the single polygon
// that leaves is ear clipped below.
//
// The bridge search is adapted from earcut (Mapbox, ISC), whose findHoleBridge
// this follows step for step on arrays rather than a linked list. Two earlier
// hand-rolled attempts failed here and are worth recording. Pairing a hole
// with the outline by angle about its centre is wrong in kind: star-shapedness
// concerns rays from the CENTRE and says nothing about what an outline vertex
// can see, so a plate corner ended up reaching across the hole. Taking the
// nearest edge's far endpoint is wrong in detail: a reflex vertex inside the
// triangle between hole, hit point and candidate blocks the line of sight, and
// a plate survived two holes and failed on the third, where the second hole's
// own bridge was in the way. earcut's rule handles both -- among the blockers
// it takes the one whose direction from the hole is closest to the ray.
//
// No point is created: a bridge reuses an outline vertex and a rim point, and
// every rim point came from Bend.
const area2 = (p, q, r) => (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);

const inTriangle = (a, b, c, p) =>
  (c[0] - p[0]) * (a[1] - p[1]) >= (a[0] - p[0]) * (c[1] - p[1]) &&
  (a[0] - p[0]) * (b[1] - p[1]) >= (b[0] - p[0]) * (a[1] - p[1]) &&
  (b[0] - p[0]) * (c[1] - p[1]) >= (c[0] - p[0]) * (b[1] - p[1]);

// Is the segment from ring[i] to q inside the polygon near ring[i]?
const locallyInside = (ring, i, q) => {
  const p = ring[i], before = ring[(i + ring.length - 1) % ring.length], after = ring[(i + 1) % ring.length];
  return area2(before, p, after) < 0
    ? area2(p, q, after) >= 0 && area2(p, before, q) >= 0
    : area2(p, q, before) < 0 || area2(p, after, q) < 0;
};

function holeBridge(ring, hole) {
  let leftmost = 0;
  for (let i = 1; i < hole.length; i++) if (hole[i][0] < hole[leftmost][0]) leftmost = i;
  const [hx, hy] = hole[leftmost];
  // The segment a ray to the left first meets; its lower-x endpoint is the
  // first candidate.
  let reach = -Infinity, candidate = -1;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (hy <= a[1] && hy >= b[1] && b[1] !== a[1]) {
      const x = a[0] + (hy - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
      if (x <= hx && x > reach) {
        reach = x;
        candidate = a[0] < b[0] ? i : (i + 1) % ring.length;
        if (x === hx) return { leftmost, candidate };
      }
    }
  }
  if (candidate < 0) return null;
  const [mx, my] = ring[candidate];
  let closest = Infinity, best = candidate;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    if (hx < p[0] || p[0] < mx || hx === p[0]) continue;
    const corner = hy < my ? [hx, hy] : [reach, hy], other = hy < my ? [reach, hy] : [hx, hy];
    if (!inTriangle(corner, [mx, my], other, p)) continue;
    const slope = Math.abs(hy - p[1]) / (hx - p[0]);
    if (locallyInside(ring, i, [hx, hy]) && (slope < closest || (slope === closest && p[0] > ring[best][0]))) {
      best = i; closest = slope;
    }
  }
  return { leftmost, candidate: best };
}

export function withHoles(outerPoints, holes, normal, xAxis) {
  const y = cross(normal, xAxis);
  const flat = p => [dot(p, xAxis), dot(p, y)];
  const signed = points => points.reduce((sum, p, k) => {
    const q = points[(k + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0);
  // earcut's convention: the outline runs counterclockwise and every hole the
  // other way, or the bridged polygon crosses itself where the two meet.
  const at = new Map();
  const project = points => points.map(p => { const f = flat(p); at.set(f, p); return f; });
  let ring = project(outerPoints);
  if (signed(ring) < 0) ring.reverse();
  const inward = holes.map(h => { const f = project(h); return signed(f) > 0 ? f.reverse() : f; });
  // Leftmost first, so a hole whose bridge would cross another is spliced after
  // it and sees it as part of the outline.
  inward.sort((a, b) => Math.min(...a.map(p => p[0])) - Math.min(...b.map(p => p[0])));

  for (const hole of inward) {
    const bridge = holeBridge(ring, hole);
    if (!bridge) return null;
    const { leftmost, candidate } = bridge;
    ring = [...ring.slice(0, candidate + 1),
      ...Array.from({ length: hole.length + 1 }, (_, i) => hole[(leftmost + i) % hole.length]),
      ...ring.slice(candidate)];
  }
  const flatTriangles = polygonFlat(ring);
  return flatTriangles && flatTriangles.map(t => t.map(p => at.get(p)));
}

// Ear clipping on the projected outline, rather than a fan, because a planar
// Boolean leaves outlines that are not convex and a fan would put triangles
// outside them. Strictly-inside is deliberate: a bridged hole puts two
// vertices in the same place and runs an edge out and back along itself, so
// treating a point that merely lies ON an ear's boundary as blocking it leaves
// no ear anywhere and the face is refused.
//
// A reflex vertex on the ear's new edge (the diagonal a-c), strictly between
// its ends, does block it, within a rounding margin: clipping that ear leaves
// an outline that runs through the vertex and touches itself there, and a
// later ear then covers area outside the face (the E01 foot plane with its
// chamfered corners: its upper outline edges at x -90.8..-88 and 88..90.8
// lie on one line, the diagonal from 88 to -90.8 ran through -88, and the
// last triangle came out reversed: 6 misoriented print-mesh edges). Blocking
// an ear is always safe; if none is left the face is refused. Bridge copies
// of a or c coincide with them and do not block.
//
// Orientation signs are exact (orient2d): the outline of a rotated face has
// nearly collinear runs (the E01 foot turned by 35 degrees: its edges on
// y = 72.29 lie 1e-14 mm off one line), where the rounded determinant gave
// inconsistent signs, an ear was clipped across the run, and the last
// triangle, three points of that line, came out reversed.
//
// Every vertex is kept, collinear ones included: dropping one would leave the
// neighbouring face's edge with a vertex this face does not have. The ring is
// a linked list walked from the last ear, and only reflex (or straight)
// vertices are tested against an ear -- an ear that contains any vertex
// contains a reflex one -- so an arc-rich outline of a few thousand points
// (the R20 gear) costs milliseconds rather than the cubic scan it used to.
const dyadicView = new DataView(new ArrayBuffer(8));
// A finite double as [integer mantissa, exponent]: x = m * 2^e exactly.
function dyadic(x) {
  dyadicView.setFloat64(0, x);
  const hi = dyadicView.getUint32(0), e = (hi >>> 20) & 0x7ff;
  const m = (BigInt(hi & 0xfffff) << 32n) | BigInt(dyadicView.getUint32(4));
  const mantissa = e ? m | (1n << 52n) : m;
  return [x < 0 ? -mantissa : mantissa, (e || 1) - 1075];
}

// Sign of (b - a) x (c - a), exact for finite doubles: the rounded
// determinant when it exceeds Shewchuk's (1997) error bound for this
// expression, (3 + 16 eps) eps (|left| + |right|), else integer arithmetic on
// the six coordinates scaled to their smallest exponent.
const ORIENT_BOUND = (3 + 16 * 2 ** -53) * 2 ** -53;
function orient2d(a, b, c) {
  const left = (b[0] - a[0]) * (c[1] - a[1]), right = (b[1] - a[1]) * (c[0] - a[0]), det = left - right;
  if (Math.abs(det) > ORIENT_BOUND * (Math.abs(left) + Math.abs(right))) return Math.sign(det);
  const d = [a[0], a[1], b[0], b[1], c[0], c[1]].map(dyadic), low = Math.min(...d.map(([, e]) => e));
  const [ax, ay, bx, by, cx, cy] = d.map(([m, e]) => m << BigInt(e - low));
  const exact = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  return exact > 0n ? 1 : exact < 0n ? -1 : 0;
}

function polygonFlat(points) {
  const n = points.length;
  if (n < 3) return null;
  const left = (a, b, c) => orient2d(points[a], points[b], points[c]);
  const inside = (p, a, b, c) => [[a, b], [b, c], [c, a]].every(([i, j]) => left(i, j, p) > 0);
  const same = (p, q) => points[p][0] === points[q][0] && points[p][1] === points[q][1];
  const onDiagonal = (p, a, c) => {
    const [ax, ay] = points[a], dx = points[c][0] - ax, dy = points[c][1] - ay, px = points[p][0] - ax, py = points[p][1] - ay;
    const length2 = dx * dx + dy * dy, along = px * dx + py * dy;
    const margin = 1e-12 * (Math.abs(ax) + Math.abs(ay) + Math.abs(points[c][0]) + Math.abs(points[c][1]) + Math.sqrt(length2));
    return !same(p, a) && !same(p, c) && along > 0 && along < length2 && Math.abs(dx * py - dy * px) <= margin * Math.sqrt(length2);
  };
  let signed = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    signed += points[i][0] * points[j][1] - points[j][0] * points[i][1];
  }
  const order = points.map((_, i) => i);
  if (signed < 0) order.reverse();
  const next = new Array(n), prev = new Array(n);
  order.forEach((v, k) => { next[v] = order[(k + 1) % n]; prev[v] = order[(k + n - 1) % n]; });
  const reflex = new Set();
  const classify = v => { if (left(prev[v], v, next[v]) <= 0) reflex.add(v); else reflex.delete(v); };
  order.forEach(classify);
  const isEar = (a, b, c) => {
    if (left(a, b, c) <= 0) return false;
    const [ax, ay] = points[a], [bx, by] = points[b], [cx, cy] = points[c];
    const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx), minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
    for (const p of reflex) {
      if (p === a || p === b || p === c) continue;
      const [px, py] = points[p];
      if (px < minX || px > maxX || py < minY || py > maxY) continue;
      if (inside(p, a, b, c) || onDiagonal(p, a, c)) return false;
    }
    return true;
  };

  const triangles = [];
  let remaining = n, v = order[0], stall = 0;
  while (remaining > 3) {
    const a = prev[v], c = next[v];
    if (isEar(a, v, c)) {
      triangles.push([points[a], points[v], points[c]]);
      next[a] = c; prev[c] = a; reflex.delete(v); remaining--;
      classify(a); classify(c);
      v = c; stall = 0;
    } else {
      v = next[v];
      if (++stall > remaining) return null;
    }
  }
  if (left(prev[v], v, next[v]) <= 0) return null;
  triangles.push([points[prev[v]], points[v], points[next[v]]]);
  return triangles;
}
