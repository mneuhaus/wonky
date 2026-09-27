// WebGL2 context, program and GPU resources of draw models.
//
// createGl(canvas) needs WebGL2 with a stencil buffer (spec D12) and throws a
// CapabilityError with the user-facing message otherwise. uploadModel()
// turns a draw model into vertex arrays and R8UI state textures;
// releaseModel() deletes them. Every create and delete is counted in
// `counters` (debug: renderer.stats().gpu).
import {
  ATTRIBUTES, FRAGMENT_SHADER, STATE_TEXTURE_WIDTH, UNIFORMS, VERTEX_SHADER,
} from './shaders.js';

export const WEBGL2_REQUIRED = 'This viewer draws models with WebGL2 and a stencil buffer, which'
  + ' this browser does not provide. The inspector, library, checks and review notes keep'
  + ' working.';

export class RenderCapabilityError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RenderCapabilityError';
    this.capability = 'webgl2';
  }
}

export function createCounters() {
  return {
    buffersCreated: 0, buffersDeleted: 0, texturesCreated: 0, texturesDeleted: 0,
    vertexArraysCreated: 0, vertexArraysDeleted: 0, uploads: 0, releases: 0,
    liveBytes: 0, programs: 0, contextLosses: 0, contextRestores: 0,
  };
}

export function createGl(canvas, counters = createCounters()) {
  const gl = canvas.getContext('webgl2', {
    antialias: true, alpha: true, depth: true, stencil: true, preserveDrawingBuffer: false,
  });
  if (!gl) throw new RenderCapabilityError(WEBGL2_REQUIRED);
  const attributes = gl.getContextAttributes?.();
  if (attributes && !attributes.stencil) throw new RenderCapabilityError(WEBGL2_REQUIRED);
  return setupGl(gl, counters);
}

// Program and state for a (new or restored) context.
export function setupGl(gl, counters) {
  const failed = detail => new Error('The 3D renderer could not start'
    + (detail ? `: ${detail}` : '') + '.');
  const compile = (type, source) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw failed(gl.getShaderInfoLog?.(shader));
    }
    return shader;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw failed(gl.getProgramInfoLog?.(program));
  }
  gl.useProgram(program);
  counters.programs++;
  const uniforms = Object.fromEntries(UNIFORMS.map(name => [
    name, gl.getUniformLocation(program, name),
  ]));
  gl.uniform1i(uniforms.states, 0);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  return { gl, program, uniforms, counters };
}

function buffer(context, target, data, track) {
  const { gl, counters } = context;
  const handle = gl.createBuffer();
  counters.buffersCreated++;
  gl.bindBuffer(target, handle);
  gl.bufferData(target, data, gl.STATIC_DRAW);
  track.buffers.push(handle);
  track.bytes += data.byteLength;
  return handle;
}

function vertexArray(context, track) {
  const { gl, counters } = context;
  const handle = gl.createVertexArray();
  counters.vertexArraysCreated++;
  gl.bindVertexArray(handle);
  track.vertexArrays.push(handle);
  return handle;
}

function attribute(gl, location, size, type, normalized = false) {
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, type, normalized, 0, 0);
}

function integerAttribute(gl, location) {
  gl.enableVertexAttribArray(location);
  gl.vertexAttribIPointer(location, 1, gl.UNSIGNED_INT, 0, 0);
}

// R8UI texture with one state byte per entity, 1024 per row.
function stateTexture(context, count, track) {
  const { gl, counters } = context;
  const width = STATE_TEXTURE_WIDTH;
  const height = Math.max(1, Math.ceil(count / width));
  const data = new Uint8Array(width * height);
  const handle = gl.createTexture();
  counters.texturesCreated++;
  gl.bindTexture(gl.TEXTURE_2D, handle);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, width, height, 0, gl.RED_INTEGER,
    gl.UNSIGNED_BYTE, data);
  track.textures.push(handle);
  track.bytes += data.byteLength;
  return { texture: handle, width, height, data };
}

export function writeStates(context, target, states) {
  const { gl } = context;
  target.data.fill(0);
  target.data.set(states.subarray(0, target.data.length));
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, target.width, target.height, gl.RED_INTEGER,
    gl.UNSIGNED_BYTE, target.data);
}

// Uploads a draw model: faces (position, oct16 normal, face id, u32 indices),
// edges (points, edge id, segment indices), B-rep points, state textures.
export function uploadModel(context, model) {
  const { gl, counters } = context;
  const { arrays, counts } = model;
  const track = { buffers: [], vertexArrays: [], textures: [], bytes: 0 };
  const faces = vertexArray(context, track);
  buffer(context, gl.ARRAY_BUFFER, arrays.positions, track);
  attribute(gl, ATTRIBUTES.position, 3, gl.FLOAT);
  buffer(context, gl.ARRAY_BUFFER, arrays.normals, track);
  attribute(gl, ATTRIBUTES.normal, 2, gl.SHORT, true);
  buffer(context, gl.ARRAY_BUFFER, arrays.faceOfVertex, track);
  integerAttribute(gl, ATTRIBUTES.entity);
  buffer(context, gl.ELEMENT_ARRAY_BUFFER, arrays.indices, track);
  const edges = vertexArray(context, track);
  buffer(context, gl.ARRAY_BUFFER, arrays.edgePoints, track);
  attribute(gl, ATTRIBUTES.position, 3, gl.FLOAT);
  gl.disableVertexAttribArray(ATTRIBUTES.normal);
  gl.vertexAttrib2f(ATTRIBUTES.normal, 0, 0);
  buffer(context, gl.ARRAY_BUFFER, model.edgeOfPoint, track);
  integerAttribute(gl, ATTRIBUTES.entity);
  buffer(context, gl.ELEMENT_ARRAY_BUFFER, arrays.edgeSegments, track);
  const points = vertexArray(context, track);
  buffer(context, gl.ARRAY_BUFFER, arrays.vertexPoints, track);
  attribute(gl, ATTRIBUTES.position, 3, gl.FLOAT);
  gl.bindVertexArray(null);
  const faceStates = stateTexture(context, counts.faces, track);
  const edgeStates = stateTexture(context, counts.edges, track);
  counters.uploads++;
  counters.liveBytes += track.bytes;
  return { faces, edges, points, faceStates, edgeStates, track, bytes: track.bytes };
}

export function releaseModel(context, gpu) {
  if (!gpu) return;
  const { gl, counters } = context;
  for (const handle of gpu.track.vertexArrays) {
    gl.deleteVertexArray(handle);
    counters.vertexArraysDeleted++;
  }
  for (const handle of gpu.track.buffers) {
    gl.deleteBuffer(handle);
    counters.buffersDeleted++;
  }
  for (const handle of gpu.track.textures) {
    gl.deleteTexture(handle);
    counters.texturesDeleted++;
  }
  counters.releases++;
  counters.liveBytes -= gpu.bytes;
}
