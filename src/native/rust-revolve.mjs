import { verifyAngleWitness } from './rust-host.mjs';
// Analytic revolve port. Only protocol/bookkeeping here; disk admission,
// exact axis contact, B-rep construction and every measurement run in Rust.
import { sharedMeridianFrame, sharedSketchXAxis } from '../construction-frame.mjs';

export function revolveBuiltins(engine, h, api) {
  const { Request, HOST_OP, call, segmentSketch, noConstruction, point2, point3, direction3,
    metres, bodyKey, RustBody, RustCapabilityError, measureRustBody, raise, Quantity, splineSketch } = api;
  return {
    skCircle: ([sketch, id, definition], loc) => {
      segmentSketch(sketch, loc);
      const d = h.fieldMap(definition, ['center', 'radius'], ['construction'], loc);
      noConstruction(d, loc, 'skCircle');
      if (typeof id !== 'string' || !id || sketch.entityIds.has(id)) raise('Sketch entity ID must be nonempty and unique', loc);
      const center = point2(d.center, 'center', loc), radius = metres(d.radius, 'radius', loc);
      // Validate even before skSolve, without inventing a host-side region.
      call(engine.kernel, new Request(HOST_OP.CIRCLE_REGION).f64(center[0]).f64(center[1]).f64(radius).done(), 'skCircle', loc);
      sketch.entityIds.add(id);
      sketch.rust.circles.push({ id, center, radius });
      sketch.rust.curves.push({ id, tag: 'circle', data: [...center, radius] });
    },
    opRevolve: ([context, id, definition], loc) => {
      const d = h.fieldMap(definition, ['entities', 'axis', 'angleForward'], [], loc);
      h.checkType(d.axis, 'Line', loc);
      if (!(d.angleForward instanceof Quantity) || d.angleForward.dimension !== 0 || d.angleForward.angle !== 1) raise('angleForward must be an angle', loc);
      verifyAngleWitness(engine.kernel, d.angleForward, loc);
      const sketch = engine.resolve(d.entities, loc);
      // A spline profile has no revolve path; its line segments alone are not the profile.
      if (sketch.rust && splineSketch(sketch)) throw new RustCapabilityError('opRevolve', 'revolve/spline-profile', loc);
      // Arrangement regions are not revolved here: the loose-edge solver's refusal stands.
      if (sketch.rust?.regions?.arrangement) throw new RustCapabilityError('opRevolve', sketch.rust.regions.legacyRefusal, loc);
      if (sketch.rust?.arcs.length) throw new RustCapabilityError('opRevolve', 'revolve/trimmed-arc-profile', loc);
      if (sketch.rust?.circles.length && sketch.rust.segments.length) throw new RustCapabilityError('opRevolve', 'revolve/mixed-circle-profile', loc);
      if (!sketch.rust?.regions || (sketch.rust.circles.length !== 1 && !sketch.rust.segments.length)) {
        throw new RustCapabilityError('opRevolve', 'revolve/profile-family (only a disk or a line region is implemented)', loc);
      }
      const origin = point3(sketch.plane.origin, 'sketch plane origin', loc);
      const x = direction3(sketch.plane.x, 'sketch plane x', loc);
      const normal = direction3(sketch.plane.normal, 'sketch plane normal', loc);
      const axisOrigin = point3(d.axis.origin, 'axis origin', loc), axis = direction3(d.axis.direction, 'axis direction', loc);
      const circle = sketch.rust.circles[0];
      const frame = sharedMeridianFrame(sketch.plane, d.axis);
      const polygon = sketch.rust.segments.length > 0;
      const bodyId = id.toString(), request = new Request(polygon ? (frame ? HOST_OP.FRAME_POLYGON_REVOLVE : HOST_OP.SKETCH_POLYGON_REVOLVE) : frame ? HOST_OP.FRAME_CIRCLE_REVOLVE : HOST_OP.CIRCLE_REVOLVE);
      for (const w of bodyKey(bodyId)) request.u32(w);
      request.u32(0).u32(0).u32(0).u32(0).u32(0);
      // Local XZ meridian and Z axis are identical construction-frame values.
      // Normalized world plane/line values are not used as an incidence proof.
      // Both constructors used the same exact input axis: revolve in the
      // original sketch frame, not either constructor's independently rounded
      // world normalization. Rust still proves the resulting local incidence.
      const provenAxis = polygon && sharedSketchXAxis(sketch.plane, d.axis) ? x : axis;
      const geometry = frame ? [...frame.origin, ...frame.x, ...frame.z] : [...origin, ...x, ...normal, ...axisOrigin, ...provenAxis];
      for (const value of geometry) request.f64(value);
      if (polygon) request.f64(d.angleForward.value).segments(sketch.rust.segments.map(s => s.s));
      else for (const value of [...circle.center, circle.radius, d.angleForward.value]) request.f64(value);
      const words = call(engine.kernel, request.done(), 'opRevolve', loc);
      const body = new RustBody(bodyId, words, null), m = measureRustBody(engine.kernel, body);
      body.validation = { closed: m.validity.closed, brep: m.validity.brep, volumeMm3: m.volumeMm3, areaMm2: m.areaMm2,
        toleranceMm: m.toleranceMm, boundsMm: m.bboxMm, certificate: m.certificate, boundToConstruction: m.boundToConstruction };
      engine.claim(context, id, loc);
      engine.addSolid(id, body);
    },
  };
}
