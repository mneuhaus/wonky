// The Rust host port on WONKY_BACKEND=rust (HS1 seam, WC0 wire v3): the
// sketch, extrude and export families of the planar extrusion slice.
//
// Every geometric decision runs in Rust (rust/wonky-ops/src/host.rs) on the
// interpreter's own binary64 values (E9): lengths travel as Quantity.value in
// metres, never through length()/vectorNumbers(), which round to mm
// (src/values.mjs). A body is held as opaque WC0 v3 words that only Rust reads;
// the host keeps names and bookkeeping beside them. What the port does not
// implement refuses by name (host-ops.mjs); nothing falls back to Bend.
import { createHash } from 'node:crypto';
import { FeatureScriptException, UnsupportedFeatureError, raise, unsupported } from '../errors.mjs';
import { NativeKernelError } from './errors.mjs';
import { Quantity, Vector, Transform } from '../values.mjs';
import { resolveTopology } from '../queries.mjs';
import { normalized } from '../brep.mjs';
import { rustBoxBuiltins } from './rust-box.mjs';
import { rustQueryBuiltins } from './rust-query.mjs';
import { rustFilletBuiltins } from './rust-fillet.mjs';
import { rustPlanarBuiltins } from './rust-planarops.mjs';
import { rustChamferBuiltins } from './rust-chamfer.mjs';
import { revolveBuiltins } from './rust-revolve.mjs';
import { rustSphereBuiltins } from './rust-sphere.mjs';

export const HOST_OP = Object.freeze({ MAGIC: 0x31484b57, VERSION: 1, REGION: 1, PRISM: 2, MEASURE: 3, STEP: 4, STL: 5, PATTERN: 8, CUBOID: 10, PLACEMENT: 11, BOOLEAN: 12, DISTANCE: 13, EXTENTS: 14, CYLINDER: 15, QUERY: 16, SHELL: 17, CLOSEST_BOX_FACES: 18, SPHERE: 30, CLOSEST_EDGES: 32, FILLET: 31, CHAMFER: 33, ARC_REGION: 26, ARC_EXTRUDE: 27, PROFILE_REGION: 24, PROFILE_EXTRUDE: 25, CIRCLE_REGION: 20, CIRCLE_REVOLVE: 21, FRAME_CIRCLE_REVOLVE: 22, FRAME_POLYGON_REVOLVE: 23 });
const STATUS = Object.freeze({ OK: 0, MALFORMED: 1, FAULT: 5, REFUSED: 7 });

// A capability the Rust kernel does not have for this input (a crossing
// sketch, a hole, a sloped edge without an exact carrier): named, and like
// every capability error never caught by FeatureScript `try`.
export class RustCapabilityError extends UnsupportedFeatureError {
  constructor(builtin, reason, loc) {
    super(`${builtin}: ${reason} is not implemented on the Rust kernel (WONKY_BACKEND=rust)`, loc);
    this.name = 'RustCapabilityError';
    Object.assign(this, { builtin, reason });
  }
}
// A proven geometric failure of the operation itself, as Onshape raises one
// (for example opExtrude of a sketch whose exact incidence graph has no closed
// loop): a FeatureScript exception, so `try` catches it like Onshape's.
export class GeometryRefusal extends FeatureScriptException {
  constructor(builtin, category, message, loc) {
    super(`${builtin}: ${message}`, loc);
    Object.assign(this, { builtin, refusalCategory: category, operationUnderTest: true,
      location: loc ? { line: loc.line, column: loc.column } : null });
  }
}

const ports = new WeakMap();
export function registerRustHost(kernel, backend) {
  const info = backend?.addon?.info?.();
  if (typeof backend?.addon?.hostOp !== 'function' || typeof backend.addon.wireV3Json !== 'function' ||
      !info?.wireVersions?.includes(3) || info.hostOpVersion !== HOST_OP.VERSION) {
    throw new NativeKernelError('BX_ABI', `Rust addon lacks hostOp v${HOST_OP.VERSION} or the WC0 v3 transport`);
  }
  ports.set(kernel, backend);
}
export const rustHostOf = kernel => ports.get(kernel) ?? null;

// ---------------------------------------------------------------- requests

class Request {
  constructor(op) { this.words = [HOST_OP.MAGIC, HOST_OP.VERSION, op]; }
  u32(x) { if (!Number.isInteger(x) || x < 0 || x > 0xffffffff) throw new NativeKernelError('BX_ARGS', `host op word ${x}`); this.words.push(x); return this; }
  f64(x) {
    if (typeof x !== 'number' || !Number.isFinite(x)) throw new NativeKernelError('BX_ARGS', `host op binary64 ${x}`);
    const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, x, true);
    this.words.push(view.getUint32(0, true), view.getUint32(4, true)); return this;
  }
  text(s) { const cps = [...s].map(c => c.codePointAt(0)); this.u32(cps.length); this.words.push(...cps); return this; }
  block(words) { this.u32(words.length); for (const w of words) this.words.push(w); return this; }
  segments(list) { this.u32(list.length); for (const s of list) for (const x of s) this.f64(x); return this; }
  done() { return Uint32Array.from(this.words); }
}
const decodeText = words => { let s = ''; for (const c of words) s += String.fromCodePoint(c); return s; };

function call(kernel, request, builtin, loc) {
  const backend = ports.get(kernel);
  if (!backend) throw new NativeKernelError('BX_ABI', 'no Rust host port is registered for this kernel');
  let reply;
  try { reply = backend.addon.hostOp(request); }
  catch (error) { throw new NativeKernelError(error?.code ?? 'BX_ABI', `hostOp: ${error.message}`, { cause: error }); }
  const status = reply[0], payload = reply.subarray(1);
  if (status === STATUS.OK) return payload;
  const message = decodeText(payload);
  if (status === STATUS.REFUSED) {
    if (builtin === 'opRevolve' && message.startsWith('revolve/singular-geometry:')) throw new GeometryRefusal(builtin, 'singular-geometry', message, loc);
    throw new RustCapabilityError(builtin, message, loc);
  }
  throw new NativeKernelError(status === STATUS.FAULT ? 'BX_FAULT' : 'BX_WIRE', `hostOp (${builtin}) answered status ${status}: ${message}`);
}

// ---------------------------------------------------------------- bodies

const WORDS = new WeakMap();
const LEGACY_FIELDS = ['vertices', 'edges', 'faces', 'shell'];
// A Rust body: WC0 v3 words (read only by Rust) plus host metadata that
// setProperty writes (name, appearance, description). Its legacy B-rep fields
// refuse by name, so a host path that has not been ported stops explicitly.
export class RustBody {
  constructor(id, words, validation) {
    this.type = 'RustBody'; this.id = id; this.geometry = 'rust-wc0-v3'; this.wireVersion = 3;
    this.validation = validation;
    WORDS.set(this, Uint32Array.from(words));
  }
}
for (const field of LEGACY_FIELDS) {
  Object.defineProperty(RustBody.prototype, field, {
    get() { throw new UnsupportedFeatureError(`the legacy B-rep view (${field}) of a Rust WC0 body is not available; this host path is not ported to WONKY_BACKEND=rust`); },
  });
}
export const isRustBody = body => body instanceof RustBody;
export const rustBodyWords = body => {
  const words = WORDS.get(body);
  if (!words) throw new NativeKernelError('BX_WIRE', 'not a Rust WC0 v3 body');
  return Uint32Array.from(words);
};
export const rustBodySha256 = body => createHash('sha256').update(Buffer.from(rustBodyWords(body).buffer)).digest('hex');

export function describeRustBody(kernel, body) {
  const backend = ports.get(kernel);
  if (!backend) throw new NativeKernelError('BX_ABI', 'no Rust host port is registered for this kernel');
  return JSON.parse(backend.addon.wireV3Json(rustBodyWords(body)));
}

// General measurements of one body (Rust wonky-ops::polyhedron): volume, area,
// bbox (world and, optionally, after an affine map given as data), topology,
// probe distances with an exact inside test. `map`: 3 rows of 4 numbers.
export function measureRustBody(kernel, body, { map = null, probes = [] } = {}) {
  const request = new Request(HOST_OP.MEASURE).block(rustBodyWords(body));
  if (map) { request.u32(1); for (const row of map) for (const x of row) request.f64(x); } else request.u32(0);
  request.u32(probes.length); for (const p of probes) for (const x of p) request.f64(x);
  return JSON.parse(decodeText(call(kernel, request.done(), 'measure')));
}

// Native edge IDs, not a legacy B-rep projection. The tie length is exactly
// the FS zeroLength binary64 in metres; point3 never passes through mm rounding.
export function closestRustEdges(kernel, rows, point, loc) {
  if (rows.some(r => r.kind !== 'edge' || !isRustBody(r.record.body))) {
    throw new RustCapabilityError('qClosestTo', 'requires only Rust line edges', loc);
  }
  const request = new Request(HOST_OP.CLOSEST_EDGES);
  for (const v of point3(point, 'qClosestTo point', loc)) request.f64(v);
  request.f64(1e-8).u32(rows.length);
  for (const row of rows) request.block(rustBodyWords(row.record.body)).u32(row.index);
  return [...call(kernel, request.done(), 'qClosestTo', loc)].map(i => rows[i]);
}

export function distanceRustBodies(kernel, a, b) {
  const request = new Request(HOST_OP.DISTANCE).block(rustBodyWords(a)).block(rustBodyWords(b));
  return JSON.parse(decodeText(call(kernel, request.done(), 'evDistance')));
}
// Extents in the body's construction frame, subtracting exact source values
// before world placement or unit conversion. Not a world bbox subtraction.
export function sourceExtentsRustBody(kernel, body) {
  return JSON.parse(decodeText(call(kernel, new Request(HOST_OP.EXTENTS).block(rustBodyWords(body)).done(), 'evBox3d')));
}

export function rustStep(kernel, bodies, name) {
  const request = new Request(HOST_OP.STEP).text(name).u32(bodies.length);
  for (const body of bodies) request.text(String(body.id)).block(rustBodyWords(body));
  return decodeText(call(kernel, request.done(), 'export'));
}

// Binary STL is constructed in Rust. The response packs four little-endian
// bytes per transport word, prefixed by the unpadded byte length.
export function rustStl(kernel, bodies, deviationMm = 0.02) {
  const request = new Request(HOST_OP.STL).f64(deviationMm).u32(bodies.length);
  for (const body of bodies) request.block(rustBodyWords(body));
  const reply = call(kernel, request.done(), 'export/stl');
  const length = reply[0];
  if (!Number.isInteger(length) || length < 84 || reply.length !== 1 + Math.ceil(length / 4)) {
    throw new NativeKernelError('BX_WIRE', 'invalid binary STL response');
  }
  const bytes = Buffer.alloc((reply.length - 1) * 4);
  for (let i = 1; i < reply.length; i++) bytes.writeUInt32LE(reply[i], (i - 1) * 4);
  return bytes.subarray(0, length);
}

// ---------------------------------------------------------------- builtins

const metres = (quantity, what, loc) => {
  if (!(quantity instanceof Quantity) || quantity.dimension !== 1 || quantity.angle !== 0) raise(`${what} must be a length with units (for example 10 * millimeter)`, loc);
  if (!Number.isFinite(quantity.value)) raise(`${what} is not finite`, loc);
  return quantity.value;
};
const point2 = (value, what, loc) => {
  if (!(value instanceof Vector) || value.items.length !== 2) raise(`${what} must be a 2D length Vector`, loc);
  return value.items.map(q => metres(q, what, loc));
};
const point3 = (value, what, loc) => {
  if (!(value instanceof Vector) || value.items.length !== 3) raise(`${what} must be a 3D length Vector`, loc);
  return value.items.map(q => metres(q, what, loc));
};
const direction3 = (value, what, loc) => {
  if (!(value instanceof Vector) || value.items.length !== 3 || !value.items.every(x => typeof x === 'number' && Number.isFinite(x))) raise(`${what} must be a 3D unitless Vector`, loc);
  return value.items;
};
const bodyKey = id => {
  const digest = createHash('sha256').update(id).digest();
  return [0, 4, 8, 12].map(k => digest.readUInt32LE(k));
};

// Implementations of the routed builtins. `h` supplies the host's own sketch
// bookkeeping (the Sketch and Query classes, fieldMap, checkType), so
// snapshots, records and queries keep working unchanged.
export function rustHostBuiltins(engine, h) {
  const kernel = engine.kernel;
  const segmentSketch = (sketch, loc) => {
    engine.sketch(sketch, loc, true);
    if (!sketch.rust) unsupported('This sketch was not created by the Rust port', loc);
    return sketch.rust;
  };
  const addSegments = (sketch, id, segments, loc) => {
    if (typeof id !== 'string' || !id || sketch.entityIds.has(id)) raise('Sketch entity ID must be nonempty and unique', loc);
    sketch.entityIds.add(id);
    for (const s of segments) sketch.rust.segments.push({ id, s });
  };
  const noConstruction = (d, loc, name) => {
    if ((d.construction !== undefined && d.construction !== false) || (d.constrained !== undefined && d.constrained !== false)) {
      throw new RustCapabilityError(name, 'construction geometry or sketch constraints', loc);
    }
  };
  const regions = (sketch, loc, builtin) => {
    if (sketch.rust.arcs.length) {
      if (sketch.rust.circles.length) throw new RustCapabilityError(builtin, 'arc-profile/full-circle-arrangement', loc);
      const request = new Request(HOST_OP.ARC_REGION).segments(sketch.rust.segments.map(s => s.s)).segments(sketch.rust.arcs.map(a => a.s));
      return JSON.parse(decodeText(call(kernel, request.done(), builtin, loc)));
    }
    if (sketch.rust.circles.length) {
      if (sketch.rust.circles.length !== 1) throw new RustCapabilityError(builtin, 'sketch/multiple-circle-arrangement', loc);
      const c = sketch.rust.circles[0], mixed = sketch.rust.segments.length > 0;
      const request = new Request(mixed ? HOST_OP.PROFILE_REGION : HOST_OP.CIRCLE_REGION).f64(c.center[0]).f64(c.center[1]).f64(c.radius);
      if (mixed) request.segments(sketch.rust.segments.map(s => s.s));
      return JSON.parse(decodeText(call(kernel, request.done(), builtin, loc)));
    }

    const request = new Request(HOST_OP.REGION).segments(sketch.rust.segments.map(x => x.s)).done();
    return JSON.parse(decodeText(call(kernel, request, builtin, loc)));
  };
  return {
    ...rustSphereBuiltins(engine, h, { Request, OP: HOST_OP, call, bodyKey, point3, metres, RustBody, measure: measureRustBody }),
    ...rustPlanarBuiltins(engine, h, { Request, OP: HOST_OP, call, metres, RustBody, words: rustBodyWords, measure: measureRustBody, RustCapabilityError }),
    ...rustChamferBuiltins(engine, h, { Request, OP: HOST_OP, call, metres, RustBody, words: rustBodyWords, measure: measureRustBody, RustCapabilityError }),
    ...rustFilletBuiltins(engine, h, { Request, OP: HOST_OP, call, metres, point3, RustBody, words: rustBodyWords, measure: measureRustBody, RustCapabilityError }),
    ...rustBoxBuiltins(engine, h, { Request, OP: HOST_OP, call, bodyKey, point3, metres, RustBody, words: rustBodyWords,
      measure: measureRustBody, GeometryRefusal, RustCapabilityError, distance: distanceRustBodies }),
    ...rustQueryBuiltins(engine, { Request, OP: HOST_OP, call, words: rustBodyWords, RustBody, RustCapabilityError, point3, direction3, closestEdges: closestRustEdges }),
    ...revolveBuiltins(engine, h, { Request, HOST_OP, call, segmentSketch, noConstruction, point2, point3, direction3, metres,
      bodyKey, RustBody, RustCapabilityError, measureRustBody, raise, Quantity }),
    opPattern: ([context, id, definition], loc) => {
      const d = h.fieldMap(definition, ['entities', 'transforms', 'instanceNames'], [], loc);
      if (!Array.isArray(d.transforms) || !Array.isArray(d.instanceNames) || d.transforms.length !== d.instanceNames.length ||
          d.instanceNames.some(n => typeof n !== 'string' || !n) || new Set(d.instanceNames).size !== d.instanceNames.length) {
        raise('opPattern requires matching transforms and unique nonempty instanceNames', loc);
      }
      engine.claim(context, id, loc);
      const source = resolveTopology(engine, d.entities, loc);
      if (!source.length || source.some(row => row.kind !== 'body' || row.record.kind !== 'solid' || !isRustBody(row.record.body))) {
        throw new RustCapabilityError('opPattern', 'only nonempty solid-body selections are supported', loc);
      }
      // Build the entire operation before publishing any copy (atomic failure).
      const copies = d.transforms.flatMap((t, i) => {
        if (!(t instanceof Transform) || t.linear.rows.length !== 3 || t.linear.rows.some(row => row.length !== 3 || row.some(v => typeof v !== 'number' || !Number.isFinite(v)))) raise('opPattern expects finite 3D transforms', loc);
        const offset = point3(t.translation, 'transform translation', loc);
        return source.map(row => {
          const original = row.record.body;
          const name = `${id}/${d.instanceNames[i]}/${original.id}`;
          const request = new Request(HOST_OP.PATTERN).block(rustBodyWords(original));
          for (const w of bodyKey(name)) request.u32(w);
          request.u32(0);
          for (const value of t.linear.rows.flat()) request.f64(value);
          for (const value of offset) request.f64(value);
          const copy = new RustBody(name, call(kernel, request.done(), 'opPattern', loc), null);
          const m = measureRustBody(kernel, copy);
          copy.validation = { ...original.validation, volumeMm3: m.volumeMm3, areaMm2: m.areaMm2, toleranceMm: m.toleranceMm, boundsMm: m.bboxMm };
          for (const key of ['name', 'description', 'appearance']) if (original[key] !== undefined) copy[key] = original[key];
          return copy;
        });
      });
      copies.forEach(body => engine.addSolid(id, body));
    },
    newSketchOnPlane: ([context, id, definition], loc) => {
      const { sketchPlane } = h.fieldMap(definition, ['sketchPlane'], [], loc);
      h.checkType(sketchPlane, 'Plane', loc); engine.claim(context, id, loc);
      const sketch = new h.Sketch(id, sketchPlane);
      sketch.rust = { segments: [], circles: [], arcs: [] };
      engine.sketches.set(id.key(), sketch);
      return sketch;
    },
    skArc: ([sketch, id, definition], loc) => {
      segmentSketch(sketch, loc);
      const d = h.fieldMap(definition, ['start', 'mid', 'end'], ['construction'], loc);
      noConstruction(d, loc, 'skArc');
      if (typeof id !== 'string' || !id || sketch.entityIds.has(id)) raise('Sketch entity ID must be nonempty and unique', loc);
      const s = [...point2(d.start, 'start', loc), ...point2(d.mid, 'mid', loc), ...point2(d.end, 'end', loc)];
      sketch.entityIds.add(id); sketch.rust.arcs.push({ id, s });
    },
    skLineSegment: ([sketch, id, definition], loc) => {
      segmentSketch(sketch, loc);
      const d = h.fieldMap(definition, ['start', 'end'], ['construction'], loc);
      noConstruction(d, loc, 'skLineSegment');
      addSegments(sketch, id, [[...point2(d.start, 'start', loc), ...point2(d.end, 'end', loc)]], loc);
    },
    // skPolyline: one segment between consecutive points; a repeated first
    // point closes it (an open polyline is legal and bounds no region).
    skPolyline: ([sketch, id, definition], loc) => {
      segmentSketch(sketch, loc);
      const d = h.fieldMap(definition, ['points'], ['construction', 'constrained'], loc);
      noConstruction(d, loc, 'skPolyline');
      if (!Array.isArray(d.points) || d.points.length < 2) raise('skPolyline needs at least two points', loc);
      const points = d.points.map(p => point2(p, 'points', loc));
      addSegments(sketch, id, points.slice(1).map((q, k) => [...points[k], ...q]), loc);
    },
    // Axis-aligned rectangle from the corners' own values (min/max only).
    skRectangle: ([sketch, id, definition], loc) => {
      segmentSketch(sketch, loc);
      const d = h.fieldMap(definition, ['firstCorner', 'secondCorner'], ['construction'], loc);
      noConstruction(d, loc, 'skRectangle');
      const a = point2(d.firstCorner, 'firstCorner', loc), b = point2(d.secondCorner, 'secondCorner', loc);
      const [x0, y0] = a.map((v, i) => Math.min(v, b[i])), [x1, y1] = a.map((v, i) => Math.max(v, b[i]));
      addSegments(sketch, id, [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]], loc);
    },
    skSolve: ([sketch], loc) => {
      const rust = segmentSketch(sketch, loc);
      // Regions from the undirected exact incidence graph (Rust); a capability
      // gap (crossings, branching, holes) refuses here by name.
      rust.regions = (rust.segments.length || rust.circles.length || rust.arcs.length) ? regions(sketch, loc, 'skSolve') : { loops: [], openWires: 0 };
      sketch.solved = true;
      const key = String(engine.nextRecord++); engine.records.set(key, { key, kind: 'sketch', sketch, createdBy: new Set([sketch.id.key()]) });
    },
    qSketchRegion: ([id, filterInnerLoops = false], loc) => {
      h.checkType(id, 'Id', loc);
      if (typeof filterInnerLoops !== 'boolean') raise('filterInnerLoops must be boolean', loc);
      const query = new h.Query(id);
      query.filterInnerLoops = filterInnerLoops;
      return query;
    },
    opExtrude: ([context, id, definition], loc) => {
      const d = h.fieldMap(definition, ['entities', 'direction', 'endBound', 'endDepth'], ['startBound', 'startDepth'], loc);
      if (d.endBound !== 'BoundingType.BLIND') throw new RustCapabilityError('opExtrude', `end bound ${d.endBound}`, loc);
      if (d.startBound !== undefined || d.startDepth !== undefined) throw new RustCapabilityError('opExtrude', 'startBound/startDepth', loc);
      const sketch = engine.resolve(d.entities, loc);
      if (!sketch.rust?.regions) unsupported('opExtrude on the Rust kernel needs a sketch built by the Rust port', loc);
      const depth = metres(d.endDepth, 'endDepth', loc);
      if (!(depth > 0)) raise('opExtrude endDepth must be positive', loc);
      // The direction must be the sketch normal or its negation, bit for bit
      // after the same normalization the plane builtin applied (library.mjs).
      const normal = direction3(sketch.plane.normal, 'sketch plane normal', loc);
      const direction = normalized(direction3(d.direction, 'direction', loc), loc);
      const same = direction.every((x, i) => x === normal[i]);
      const opposite = direction.every((x, i) => x === -normal[i]);
      if (!same && !opposite) throw new RustCapabilityError('opExtrude', 'an extrusion direction that is not exactly the sketch normal', loc);
      const { openWires } = sketch.rust.regions;
      const mixed = sketch.rust.circles.length > 0 && sketch.rust.segments.length > 0;
      const loops = mixed && d.entities.filterInnerLoops ? sketch.rust.regions.loops.slice(0, 1) : sketch.rust.regions.loops;
      if (!loops.length) {
        throw openWires
          ? new GeometryRefusal('opExtrude', 'open-profile', 'the sketch has no closed region: exact endpoint incidence leaves every wire open', loc)
          : new GeometryRefusal('opExtrude', 'empty-region', 'the sketch has no region', loc);
      }
      engine.claim(context, id, loc);
      const origin = point3(sketch.plane.origin, 'sketch plane origin', loc), x = direction3(sketch.plane.x, 'sketch plane x', loc);
      const segments = sketch.rust.segments.map(s => s.s);
      loops.forEach((_, index) => {
        const bodyId = loops.length === 1 ? id.toString() : `${id}/${index}`;
        const circle = sketch.rust.circles[0];
        const arcs = sketch.rust.arcs;
        const request = new Request(arcs.length ? HOST_OP.ARC_EXTRUDE : circle ? HOST_OP.PROFILE_EXTRUDE : HOST_OP.PRISM);
        for (const w of bodyKey(bodyId)) request.u32(w);
        request.u32(0); // revision
        if (!circle && !arcs.length) request.u32(0).u32(0).u32(0).u32(0); // interpreter source frame
        for (const v of [...origin, ...x, ...normal]) request.f64(v);
        if (circle) for (const v of [...circle.center, circle.radius]) request.f64(v);
        request.f64(depth).u32(opposite ? 1 : 0);
        if (arcs.length) request.segments(segments).segments(arcs.map(a => a.s));
        else request.u32(circle ? Number(!mixed || index === 1) : index).segments(segments);
        const words = call(kernel, request.done(), 'opExtrude', loc);
        const body = new RustBody(bodyId, words, null);
        const m = measureRustBody(kernel, body);
        body.validation = { closed: m.validity.closed, brep: m.validity.brep, volumeMm3: m.volumeMm3, areaMm2: m.areaMm2,
          toleranceMm: m.toleranceMm, boundsMm: m.bboxMm, certificate: m.certificate, boundToConstruction: m.boundToConstruction };
        engine.addSolid(id, body);
      });
    },
  };
}

// Is this model built on the strict Rust port (every body a Rust body)?
export function rustModel(model) {
  const rust = model.bodies.filter(isRustBody);
  if (rust.length && rust.length !== model.bodies.length) throw new NativeKernelError('BX_ABI', 'a model mixes Rust WC0 bodies and legacy bodies');
  return rust.length > 0;
}

// brep.json on the Rust path: the WC0 v3 reading of each body plus a
// legacy-shaped projection (world mm vertices, edges, face loops) that
// scripts/validate-step.py reads. The projection is written by Rust; its
// coordinates carry the stated export budget (validation.toleranceMm).
export function rustModelRecord(kernel, model) {
  return {
    ...model,
    bodies: model.bodies.map(body => {
      const m = measureRustBody(kernel, body);
      const { vertices, edges, faces } = m.projection;
      const wc0 = describeRustBody(kernel, body);
      const faceOrder = wc0.body.shells.flatMap(shell => shell.faces);
      return {
        id: body.id, name: body.name, description: body.description, appearance: body.appearance,
        geometry: body.geometry, validation: body.validation,
        vertices, edges: edges.map(([start, end]) => ({ start, end })),
        faces: faces.map(loops => ({ loops: loops.map(loop => loop.map(([edge, forward]) => ({ edge, forward }))) })),
        referenceMeasurements: { faceAreasMm2: faceOrder.map(i => m.faceAreasMm2[i]), facePerimetersMm: faceOrder.map(i => m.facePerimetersMm[i]), faceTolerancesMm: faceOrder.map(() => m.toleranceMm) },
        wc0,
        wc0Sha256: rustBodySha256(body),
      };
    }),
  };
}

// The kernel that built a Rust model, for export (toStep, serializeModel).
const models = new WeakMap();
export function bindRustModel(model, kernel) { models.set(model, kernel); }
export function rustModelKernel(model) {
  const kernel = models.get(model);
  if (!kernel || !ports.has(kernel)) throw new NativeKernelError('BX_ABI', 'this Rust model has no registered Rust host port');
  return kernel;
}
