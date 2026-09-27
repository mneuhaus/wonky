// Logical faces: fragments joined across exact subdivision edges (spec D21).
// Package: topology-classes.
//
// Frozen signature:
//   logicalFaces(model) -> { bodies: [{ logicalOf: Int32Array,
//                                        groups: [{ alias, fragments, support }] }] }
// `logicalOf[f]` is the group index of face f; `fragments` are face indices in
// ascending order. Groups are ordered by their smallest fragment index, so a
// body without subdivision edges numbers its logical faces like its faces
// (B1.L3 = B1.F3). `support` describes the shared oriented support, taken
// from the smallest fragment: { type, fragment, surface, sameSense }.
//
// Two faces join only across an edge classified `subdivision` by
// classifyEdges (identical oriented support within tolerance, not
// contradicted by the recorded construction origin). Faces on the same plane
// that no subdivision edge connects stay separate logical faces. An optional
// second argument `{ classes }` reuses a classifyEdges(model) result.
import { EDGE_CLASS, classifyEdges, faceSign, joinFragments } from './edge-classes.mjs';

export const LOGICAL_FACES_SCHEMA = 'wonky.logical-faces/1';

const copyVector = value => (Array.isArray(value) ? [...value] : value);

// The oriented support of a face as served to clients (a copy, never the
// model's own objects).
export function faceSupport(body, faceIndex) {
  const face = body.faces[faceIndex];
  const surface = Object.fromEntries(Object.entries(face.surface ?? {})
    .map(([key, value]) => [key, copyVector(value)]));
  return {
    type: surface.type ?? null,
    fragment: faceIndex,
    surface,
    sameSense: faceSign(body, face) === 1,
  };
}

function groupBody(body, bodyIndex, classified) {
  const { classes, adjacent } = classified;
  const pairs = [];
  for (let edge = 0; edge < classes.length; edge++) {
    if (classes[edge] === EDGE_CLASS.subdivision) {
      pairs.push([adjacent[2 * edge], adjacent[2 * edge + 1]]);
    }
  }
  const { groupOf, groups } = joinFragments(body.faces.length, pairs);
  return {
    logicalOf: groupOf,
    groups: groups.map((fragments, index) => ({
      alias: `B${bodyIndex + 1}.L${index + 1}`,
      fragments,
      support: faceSupport(body, fragments[0]),
    })),
  };
}

export function logicalFaces(model, { classes = classifyEdges(model) } = {}) {
  return {
    schema: LOGICAL_FACES_SCHEMA,
    bodies: model.bodies.map((body, bodyIndex) => groupBody(body, bodyIndex,
      classes.bodies[bodyIndex])),
  };
}
