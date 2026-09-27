// Exact Booleans of right prisms with a shared axis and shared cap planes
// (kernel/prism-boolean.bend, docs/prism-boolean.md, local design note task
// 12a). This file only moves words: it encodes both operands as analytic
// solids, calls the Bend arm and decodes its answer. Every geometric decision
// (is this a prism, where do the profiles meet, which pieces stay, the area
// and the volume) is made in Bend.
//
// The arm sits in booleanInBend just before the hybrid Boolean (src/boolean.mjs
// last()). It either builds the exact result or declines with a code; it never
// guesses, so a decline hands the operation on unchanged.
import { list, array } from './kernel.mjs';
import { real, number, vector, coords } from './real.mjs';
import { decodeAnalytic } from './analytic.mjs';
import { isMeshBody } from './hybrid-mesh.mjs';

export const PRISM_METHOD = 'native Bend prism region Boolean';

const OPERATIONS = ['UNION', 'INTERSECTION', 'SUBTRACTION'];

// kernel/prism-boolean.bend decline codes.
export const PRISM_DECLINES = Object.freeze({
  1: 'an operand face is not a plane or a cylinder',
  2: 'an operand face is neither a cap nor vertical along any coordinate axis',
  3: 'an operand has not exactly two cap faces (one facing down below one facing up)',
  4: 'an operand vertex lies off both cap planes',
  5: 'a cap edge is not a line or a circle about the axis, or is degenerate',
  6: 'a cap face could not be read',
  7: 'a cap face is not one counterclockwise outer loop with clockwise holes of nonzero area',
  10: 'the cap planes do not fit the operation (union: equal; subtraction: the tool spans the target; intersection: one spans the other)',
  20: 'a crossing lies next to a vertex it is not exactly incident with',
  21: 'two crossings are closer than the tangent resolution (near tangency)',
  22: 'two split points of a profile segment are closer than the snap resolution',
  23: 'a piece midpoint lies too close to the other profile to classify',
  24: 'the winding number at a piece midpoint is not 0 or 1',
  25: 'the result pieces do not meet two by two at every vertex (non-manifold touch)',
  26: 'the result pieces do not close into loops',
  27: 'a result loop has (near) zero area',
  28: 'a result hole lies in no outer loop',
});

const TOLERANCES = Object.freeze({ snapRelative: 1e-8, tangentRelative: 1e-5, classifyRelative: 1e-9,
  note: 'relative to max(1 mm, the largest profile coordinate or centre distance plus radius); used only to decline, never to move or merge geometry' });

const zero = [0, 0, 0];

function encodeCurve(body, edge) {
  const c = edge.curve;
  const type = typeof c === 'string' ? c : c?.type;
  if (type === 'line') return { $: 'Line', origin: vector(c.origin ?? body.vertices[edge.start]), direction: vector(c.direction ?? zero) };
  if (type === 'circle') return { $: 'Circle', origin: vector(c.origin), normal: vector(c.normal), x: vector(c.x), radius: real(c.radius) };
  return null;
}

function encodeSurface(s) {
  if (s?.type === 'plane') return { $: 'Plane', origin: vector(s.origin), normal: vector(s.normal), x: vector(s.x ?? zero) };
  if (s?.type === 'cylinder') return { $: 'Cylinder', origin: vector(s.origin), axis: vector(s.axis), x: vector(s.x ?? zero), radius: real(s.radius) };
  return null;
}

// Any wonky B-rep body (a polygon prism with implicit line edges, or an
// analytic body) as a kernel/analytic.bend Solid; null when an edge or face
// type cannot belong to a prism (the arm would decline anyway).
export function encodePrismOperand(body) {
  if (!body || isMeshBody(body) || !Array.isArray(body.faces) || !Array.isArray(body.edges)) return null;
  const edges = body.edges.map(edge => ({ edge, curve: encodeCurve(body, edge) }));
  const faces = body.faces.map(face => ({ face, surface: encodeSurface(face.surface) }));
  if (edges.some(e => !e.curve) || faces.some(f => !f.surface)) return null;
  return { $: 'Solid', vertices: list(body.vertices.map(vector)),
    edges: list(edges.map(({ edge, curve }) => ({ $: 'Edge', start: edge.start, end: edge.end, curve, same_sense: edge.sameSense ?? true }))),
    faces: list(faces.map(({ face, surface }) => ({ $: 'Face', surface, same_sense: face.sameSense ?? true,
      loops: list(face.loops.map((uses, i) => ({ $: 'Loop', outer: face.outer?.[i] ?? i === 0,
        uses: list(uses.map(use => ({ $: 'Use', edge: use.edge, forward: use.forward }))) }))) }))) };
}

// { status: 'built', bodies, evidence } or { status: 'declined', code, reason, evidence }.
export function prismBoolean(kernel, a, b, operation, id) {
  const op = OPERATIONS.indexOf(operation);
  if (op < 0 || !kernel.prismBoolean) return { status: 'declined', code: 0, reason: 'not available', evidence: { method: PRISM_METHOD, status: 'Declined', reason: 'not available' } };
  const first = encodePrismOperand(a), second = encodePrismOperand(b);
  if (!first || !second) {
    const reason = `operand ${first ? 1 : 0} has an edge or face that no prism has (${PRISM_DECLINES[1]})`;
    return { status: 'declined', code: 1, reason, evidence: { method: PRISM_METHOD, status: 'Declined', code: 1, operand: first ? 1 : 0, reason } };
  }
  const answer = kernel.prismBoolean.boolean(first, second, op);
  if (answer.$ !== 'Built') {
    const reason = PRISM_DECLINES[answer.code] ?? `decline code ${answer.code}`;
    return { status: 'declined', code: answer.code, reason,
      evidence: { method: PRISM_METHOD, status: 'Declined', code: answer.code, detail: answer.detail, reason } };
  }
  const axis = 'xyz'[answer.axis], slabMm = [number(answer.low), number(answer.high)];
  const bodies = array(answer.bodies).map((part, i) => {
    const body = decodeAnalytic(part.solid, `${id}/${i}`, kernel);
    array(part.ranges).forEach((range, e) => { if (range.$ === 'Span') body.edges[e].curveRange = [number(range.first), number(range.last)]; });
    body.validation.volumeMm3 = number(part.volume);
    body.validation.boundsMm = { min: coords(part.low), max: coords(part.high) };
    body.validation.scope = 'boundary topology and endpoint incidence; exact prism Boolean in Bend: closed-form profile area (lines and circular arcs) times the cap distance, tight bounds';
    const faceOrigins = array(part.origins).map(origins => ({ contributors: array(origins).map(o => ({ operand: o.operand, index: o.face })) }));
    body.construction = { method: PRISM_METHOD, operation, axis, slabMm, profileAreaMm2: number(part.area), faceOrigins,
      // Faces 0 and 1 are the caps, the rest are side faces. A side face
      // names the operand whose profile piece it extrudes; a piece both
      // profiles share is kept from operand 0 only. So in a SUBTRACTION a
      // side face from operand 1 is the tool's boundary inside the target:
      // material was removed exactly when one exists (src/library.mjs
      // removedMaterial).
      toolBoundaryKept: faceOrigins.slice(2).some(origin => origin.contributors.some(ref => ref.operand === 1)),
      admission: 'both operands are right prisms along the same coordinate axis (decided exactly on the input words) whose cap planes fit the operation; the profiles meet only at points decided exactly or computed away from every vertex',
      tolerances: TOLERANCES };
    return body;
  });
  return { status: 'built', bodies,
    evidence: { method: PRISM_METHOD, status: 'Built', axis, slabMm, bodies: bodies.length,
      profileAreasMm2: bodies.map(body => body.construction.profileAreaMm2), tolerances: TOLERANCES } };
}
