// Draw models: the binary payload `wonky.draw/1` (spec 9.3) and its JSON-scene
// adapter. Pure ES module, shared by the browser and src/viewer/draw.mjs so
// both sides build byte-identical picking data:
//
//   - positions relative to the model center, subtracted in float64
//   - triangle winding normalized to the outward (display) normal
//   - one triangle, edge and point order: bodies, then faces / edges /
//     vertices in scene order
//
// Payload layout (little-endian, every section 4-byte aligned):
//
//   u32 magic 'WKD1' | u32 headerBytes | header JSON (utf-8, space padded)
//   | f32 positions[3n] | i16 normals[2n] (oct16) | u32 faceOfVertex[n]
//   | u16 bodyOfVertex[n] | u32 indices[3m]
//   | f32 edgePoints[3k] | u32 edgeSegments[2s] | u32 edgeOfSegment[s] | u8 edgeClass[e]
//   | f32 vertexPoints[3v] | u16 bodyOfPoint[v] | u32 vertexIndex[v]
//   | u32 faceEdgeOffsets[f + 1] | u32 faceEdges[b]      (extension: face -> edges)
//
// The two trailing sections list the global boundary edges of every face
// (CSR); they drive boundary highlights and are cheaper than JSON lists.
// Header counts: vertices, triangles, edgePoints, segments, edges, points,
// faces, faceOffsets (= faces + 1), faceEdges, logicalFaces.
//
// A draw model is the decoded payload plus lookup tables (faceBody, faceLocal,
// edgeBody, edgeLocal, logicalOf, logical fragments, edgeOfPoint). Global
// face, edge and point numbers run over all bodies in order.
export const DRAW_SCHEMA = 'wonky.draw/1';
export const DRAW_MAGIC = 0x31444b57;
export const EDGE_CLASS_NAMES = Object.freeze([
  'sharp', 'tangent', 'seam', 'subdivision', 'unresolved',
]);
export const UNRESOLVED_CLASS = 4;
const NONE = 0xffffffff;

// [name, element type, count key, components]
export const SECTIONS = Object.freeze([
  ['positions', Float32Array, 'vertices', 3],
  ['normals', Int16Array, 'vertices', 2],
  ['faceOfVertex', Uint32Array, 'vertices', 1],
  ['bodyOfVertex', Uint16Array, 'vertices', 1],
  ['indices', Uint32Array, 'triangles', 3],
  ['edgePoints', Float32Array, 'edgePoints', 3],
  ['edgeSegments', Uint32Array, 'segments', 2],
  ['edgeOfSegment', Uint32Array, 'segments', 1],
  ['edgeClass', Uint8Array, 'edges', 1],
  ['vertexPoints', Float32Array, 'points', 3],
  ['bodyOfPoint', Uint16Array, 'points', 1],
  ['vertexIndex', Uint32Array, 'points', 1],
  ['faceEdgeOffsets', Uint32Array, 'faceOffsets', 1],
  ['faceEdges', Uint32Array, 'faceEdges', 1],
]);

const align4 = value => Math.ceil(value / 4) * 4;

export function drawCenter(bounds) {
  if (!bounds?.min || !bounds?.max) return [0, 0, 0];
  return [0, 1, 2].map(axis => (bounds.min[axis] + bounds.max[axis]) / 2);
}

// Byte offsets of every section after a header of `headerBytes` bytes.
export function drawLayout(counts, headerBytes) {
  let offset = 8 + align4(headerBytes);
  const sections = {};
  for (const [name, Type, key, components] of SECTIONS) {
    const length = (counts[key] ?? 0) * components;
    sections[name] = { offset, length, Type };
    offset = align4(offset + length * Type.BYTES_PER_ELEMENT);
  }
  return { sections, byteLength: offset };
}

// Octahedral unit-vector encoding into two snorm16 values.
export function octEncode(x, y, z, out, index) {
  const sum = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
  let u = x / sum;
  let v = y / sum;
  if (z < 0) {
    const signU = u >= 0 ? 1 : -1;
    const signV = v >= 0 ? 1 : -1;
    const folded = (1 - Math.abs(v)) * signU;
    v = (1 - Math.abs(u)) * signV;
    u = folded;
  }
  out[index] = Math.round(Math.max(-1, Math.min(1, u)) * 32767);
  out[index + 1] = Math.round(Math.max(-1, Math.min(1, v)) * 32767);
}

export function octDecode(u16, v16) {
  const u = Math.max(-1, u16 / 32767);
  const v = Math.max(-1, v16 / 32767);
  let x = u;
  let y = v;
  const z = 1 - Math.abs(u) - Math.abs(v);
  if (z < 0) {
    x = (1 - Math.abs(v)) * (u >= 0 ? 1 : -1);
    y = (1 - Math.abs(u)) * (v >= 0 ? 1 : -1);
  }
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

// Whether the triangle (a, b, c) winds against `normal` (float64 math).
export function windsBackward(a, b, c, normal) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return nx * normal[0] + ny * normal[1] + nz * normal[2] < 0;
}

// Key of a display point in exact-normal maps (same form on both sides).
export const pointKey = point => `${point[0]},${point[1]},${point[2]}`;

// Builds the draw arrays of a JSON display scene (the reviewScene shape).
// Options (server only):
//   exactNormals(bodyIndex, face) -> Map(pointKey -> [x, y, z]) | null
//     exact outward normals for every distinct point of the face, or null
//     (the face then uses its triangle normals and is flagged `display`)
//   edgeClass(bodyIndex, edgeIndex) -> class code (default unresolved)
//   logical: logicalFaces(model) result; default one logical face per face
export function buildDrawArrays(scene, { exactNormals, edgeClass, logical } = {}) {
  const center = drawCenter(scene.bounds);
  const positions = [];
  const normals = [];
  const faceOfVertex = [];
  const bodyOfVertex = [];
  const indices = [];
  const edgePoints = [];
  const edgeSegments = [];
  const edgeOfSegment = [];
  const edgeClasses = [];
  const vertexPoints = [];
  const bodyOfPoint = [];
  const vertexIndex = [];
  const faceEdgeOffsets = [0];
  const faceEdges = [];
  const bodies = [];
  const faces = [];
  const edges = [];
  const logicalFaces = [];
  const notes = [];
  const pushPoint = (target, point) => {
    target.push(point[0] - center[0], point[1] - center[1], point[2] - center[2]);
  };
  const pushVertex = (point, normal, face, body) => {
    pushPoint(positions, point);
    normals.push(normal);
    faceOfVertex.push(face);
    bodyOfVertex.push(body);
    return faceOfVertex.length - 1;
  };

  scene.bodies.forEach((body, bodyIndex) => {
    const record = {
      index: bodyIndex, id: body.id, name: body.name ?? body.id,
      faceRange: [faces.length, 0], indexRange: [indices.length, 0],
      vertexRange: [faceOfVertex.length, 0], edgeRange: [edges.length, 0],
      segmentRange: [edgeOfSegment.length, 0], pointRange: [bodyOfPoint.length, 0],
    };
    const faceBase = faces.length;
    const edgeBase = edges.length;
    const edgePosition = new Map(body.edges.map((edge, position) => [edge.index, position]));
    const logicalBase = logicalFaces.length;
    const groups = logical?.bodies?.[bodyIndex];
    for (const face of body.faces) {
      const global = faces.length;
      const triangles = face.triangles ?? [];
      const start = indices.length;
      const exact = exactNormals && triangles.length ? exactNormals(bodyIndex, face) : null;
      const shared = new Map();
      for (const triangle of triangles) {
        const [a, b, c] = triangle.points;
        const corners = windsBackward(a, b, c, triangle.normal) ? [a, c, b] : [a, b, c];
        for (const point of corners) {
          if (!exact) {
            indices.push(pushVertex(point, triangle.normal, global, bodyIndex));
            continue;
          }
          const key = pointKey(point);
          if (!shared.has(key)) {
            shared.set(key, pushVertex(point, exact.get(key), global, bodyIndex));
          }
          indices.push(shared.get(key));
        }
      }
      const entry = {
        body: bodyIndex, index: face.index, surfaceType: face.surfaceType ?? null,
        indexRange: [start, indices.length], normalSource: exact ? 'exact' : 'display',
      };
      for (const edge of face.edgeIndices ?? []) {
        if (edgePosition.has(edge)) faceEdges.push(edgeBase + edgePosition.get(edge));
      }
      faceEdgeOffsets.push(faceEdges.length);
      if (face.displayWarning) entry.displayWarning = face.displayWarning;
      faces.push(entry);
    }
    if (groups?.groups?.length) {
      for (const group of groups.groups) {
        logicalFaces.push({
          alias: group.alias,
          fragments: group.fragments.map(fragment => faceBase + fragment),
        });
      }
      for (let local = 0; local < body.faces.length; local++) {
        faces[faceBase + local].logical = logicalBase + groups.logicalOf[local];
      }
    } else {
      for (let local = 0; local < body.faces.length; local++) {
        faces[faceBase + local].logical = logicalFaces.length;
        logicalFaces.push({ alias: null, fragments: [faceBase + local] });
      }
    }
    for (const edge of body.edges) {
      const global = edges.length;
      const first = edgePoints.length / 3;
      const points = edge.points ?? [];
      for (const point of points) pushPoint(edgePoints, point);
      for (let index = 1; index < points.length; index++) {
        edgeSegments.push(first + index - 1, first + index);
        edgeOfSegment.push(global);
      }
      edgeClasses.push(edgeClass ? edgeClass(bodyIndex, edge.index) : UNRESOLVED_CLASS);
      edges.push({ body: bodyIndex, index: edge.index, curveType: edge.curveType ?? null });
    }
    for (const vertex of body.vertices) {
      pushPoint(vertexPoints, vertex.point);
      bodyOfPoint.push(bodyIndex);
      vertexIndex.push(vertex.index);
    }
    record.faceRange[1] = faces.length;
    record.indexRange[1] = indices.length;
    record.vertexRange[1] = faceOfVertex.length;
    record.edgeRange[1] = edges.length;
    record.segmentRange[1] = edgeOfSegment.length;
    record.pointRange[1] = bodyOfPoint.length;
    bodies.push(record);
  });
  if (bodies.length > 0xffff) throw new Error('Draw payloads support at most 65535 bodies');
  const octNormals = new Int16Array(normals.length * 2);
  normals.forEach((normal, index) => {
    octEncode(normal[0], normal[1], normal[2], octNormals, index * 2);
  });
  const counts = {
    vertices: faceOfVertex.length, triangles: indices.length / 3,
    edgePoints: edgePoints.length / 3, segments: edgeOfSegment.length, edges: edges.length,
    points: bodyOfPoint.length, faces: faces.length, faceOffsets: faces.length + 1,
    faceEdges: faceEdges.length, logicalFaces: logicalFaces.length,
  };
  return {
    center, bounds: scene.bounds, counts, bodies, faces, edges, logicalFaces, notes,
    arrays: {
      positions: Float32Array.from(positions), normals: octNormals,
      faceOfVertex: Uint32Array.from(faceOfVertex), bodyOfVertex: Uint16Array.from(bodyOfVertex),
      indices: Uint32Array.from(indices), edgePoints: Float32Array.from(edgePoints),
      edgeSegments: Uint32Array.from(edgeSegments),
      edgeOfSegment: Uint32Array.from(edgeOfSegment), edgeClass: Uint8Array.from(edgeClasses),
      vertexPoints: Float32Array.from(vertexPoints), bodyOfPoint: Uint16Array.from(bodyOfPoint),
      vertexIndex: Uint32Array.from(vertexIndex),
      faceEdgeOffsets: Uint32Array.from(faceEdgeOffsets), faceEdges: Uint32Array.from(faceEdges),
    },
  };
}

// Serializes { header, arrays } into one ArrayBuffer (header.counts required).
export function encodeDraw(header, arrays) {
  let text = JSON.stringify(header);
  const encoder = new TextEncoder();
  let bytes = encoder.encode(text);
  const padded = align4(bytes.length);
  if (padded !== bytes.length) {
    text += ' '.repeat(padded - bytes.length);
    bytes = encoder.encode(text);
  }
  const { sections, byteLength } = drawLayout(header.counts, bytes.length);
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  view.setUint32(0, DRAW_MAGIC, true);
  view.setUint32(4, bytes.length, true);
  new Uint8Array(buffer, 8, bytes.length).set(bytes);
  for (const [name, Type] of SECTIONS) {
    const { offset, length } = sections[name];
    const values = arrays[name];
    if (values.length !== length) {
      throw new Error(`Draw section ${name} has ${values.length} values, expected ${length}`);
    }
    new Type(buffer, offset, length).set(values);
  }
  return buffer;
}

export function decodeDrawHeader(buffer) {
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer)
    : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 8 || view.getUint32(0, true) !== DRAW_MAGIC) {
    throw new Error('Not a wonky.draw/1 payload');
  }
  const headerBytes = view.getUint32(4, true);
  if (8 + headerBytes > bytes.byteLength) throw new Error('Truncated wonky.draw/1 header');
  const text = new TextDecoder().decode(bytes.subarray(8, 8 + headerBytes));
  const header = JSON.parse(text.replace(/\0+$/, '').trimEnd());
  if (header.schema !== DRAW_SCHEMA) throw new Error(`Unsupported draw schema ${header.schema}`);
  return { header, headerBytes, offset: 8 + headerBytes };
}

// Decodes a payload (ArrayBuffer or Uint8Array) into typed-array views.
export function decodeDrawPayload(input) {
  let buffer = input instanceof ArrayBuffer ? input : null;
  if (!buffer) {
    // Views need 4-byte aligned offsets; copy unaligned slices (Node pools).
    buffer = input.byteOffset % 4 === 0 && input.byteLength === input.buffer.byteLength
      ? input.buffer : input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength);
  }
  const { header, headerBytes } = decodeDrawHeader(buffer);
  const { sections, byteLength } = drawLayout(header.counts, headerBytes);
  if (byteLength > buffer.byteLength) throw new Error('Truncated wonky.draw/1 payload');
  const arrays = {};
  for (const [name, Type] of SECTIONS) {
    const { offset, length } = sections[name];
    arrays[name] = new Type(buffer, offset, length);
  }
  return { header, arrays, byteLength: buffer.byteLength };
}

// Lookup tables shared by the picker and the highlight code.
function withLookups(model) {
  const { counts, faces, edges, arrays } = model;
  const faceBody = new Uint16Array(counts.faces);
  const faceLocal = new Uint32Array(counts.faces);
  faces.forEach((face, index) => {
    faceBody[index] = face.body;
    faceLocal[index] = face.index;
  });
  const edgeBody = new Uint16Array(counts.edges);
  const edgeLocal = new Uint32Array(counts.edges);
  edges.forEach((edge, index) => {
    edgeBody[index] = edge.body;
    edgeLocal[index] = edge.index;
  });
  const logicalOf = new Uint32Array(counts.faces);
  const logicalOffsets = new Uint32Array(model.logicalFaces.length + 1);
  const logicalFragments = new Uint32Array(counts.faces);
  let cursor = 0;
  model.logicalFaces.forEach((group, index) => {
    logicalOffsets[index] = cursor;
    for (const fragment of group.fragments) {
      logicalFragments[cursor++] = fragment;
      logicalOf[fragment] = index;
    }
  });
  logicalOffsets[model.logicalFaces.length] = cursor;
  const edgeOfPoint = new Uint32Array(counts.edgePoints).fill(NONE);
  for (let segment = 0; segment < counts.segments; segment++) {
    const edge = arrays.edgeOfSegment[segment];
    edgeOfPoint[arrays.edgeSegments[2 * segment]] = edge;
    edgeOfPoint[arrays.edgeSegments[2 * segment + 1]] = edge;
  }
  const bodyIndexById = new Map(model.bodies.map(body => [body.id, body.index]));
  return {
    ...model, faceBody, faceLocal, edgeBody, edgeLocal, logicalOf, logicalOffsets,
    logicalFragments, edgeOfPoint, bodyIndexById,
  };
}

// Draw model from a decoded payload.
// Entities of a header list with their body and local index (the payload
// numbers entities by position inside their body).
function located(list, bodies, rangeKey) {
  const result = new Array(list.length);
  for (const body of bodies) {
    const [start, end] = body[rangeKey];
    for (let global = start; global < end; global++) {
      result[global] = { ...list[global], body: body.index, index: global - start };
    }
  }
  return result;
}

export function drawModel(decoded, { id } = {}) {
  const { header, arrays } = decoded;
  const faces = located(header.faces, header.bodies, 'faceRange');
  const edges = located(header.edges, header.bodies, 'edgeRange');
  return withLookups({
    id: id ?? header.modelId, source: 'draw', header, center: header.center,
    bounds: header.bounds, toleranceMm: header.toleranceMm, notes: header.notes ?? [],
    diagnostic: header.diagnostic ?? null, counts: header.counts, bodies: header.bodies, faces,
    edges, logicalFaces: header.logicalFaces, arrays, byteLength: decoded.byteLength,
  });
}

// JSON-scene adapter: the same draw model built from a JSON display scene
// (VS fixtures, the WebGL-less capability fallback, the legacy load path).
// Normals are the scene's triangle normals (display); logical faces are one
// per face.
export function sceneDrawModel(scene) {
  const built = buildDrawArrays(scene);
  const bytes = Object.values(built.arrays).reduce((sum, array) => sum + array.byteLength, 0);
  return withLookups({
    id: scene.id, source: 'json', header: null, center: built.center, bounds: built.bounds,
    toleranceMm: scene.display?.toleranceMm ?? null, notes: scene.display?.notes ?? [],
    diagnostic: scene.diagnostic ?? null, counts: built.counts, bodies: built.bodies,
    faces: built.faces, edges: built.edges, logicalFaces: built.logicalFaces,
    arrays: built.arrays, byteLength: bytes,
  });
}

// World point of a model-relative float32 position.
export function worldPoint(model, array, index) {
  return [0, 1, 2].map(axis => model.center[axis] + array[3 * index + axis]);
}

// World polyline of a global edge (display points, for overlays).
export function edgeWorldPoints(model, edge) {
  const points = [];
  const { edgeSegments, edgeOfSegment, edgePoints } = model.arrays;
  const range = model.bodies[model.edges[edge]?.body]?.segmentRange;
  if (!range) return points;
  for (let segment = range[0]; segment < range[1]; segment++) {
    if (edgeOfSegment[segment] !== edge) continue;
    if (!points.length) points.push(worldPoint(model, edgePoints, edgeSegments[2 * segment]));
    points.push(worldPoint(model, edgePoints, edgeSegments[2 * segment + 1]));
  }
  return points;
}
