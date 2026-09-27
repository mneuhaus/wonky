import { loadBend } from './bend-loader.mjs';
import { list, array } from './kernel.mjs';
import { coords, number, vector } from './real.mjs';
import { decodeAnalytic } from './analytic.mjs';
import { constructionBudget } from './construction-history.mjs';
import { unsupported } from './errors.mjs';

let loaded;
export function loadSketchArcs() {
  loaded ??= loadBend(new URL('../kernel/sketch-arcs.bend', import.meta.url));
  return loaded;
}

// SI identity and the remaining mm serialization bits are immutable reference
// data. This adapter performs no fitting, welding, ordering or triangulation.
export function sketchArcPoint(meters) {
  if (!Array.isArray(meters) || meters.length !== 2 || !meters.every(Number.isFinite)) {
    throw new TypeError('A sketch point requires two finite SI coordinates');
  }
  const bits = new DataView(new ArrayBuffer(16));
  meters.forEach((value, i) => bits.setFloat64(i * 8, value));
  const mm = [...meters.map(value => value * 1000), 0];
  const value = vector(mm), stored = coords(value);
  return { $: 'Point', value, remainder: vector(mm.map((v, i) => v - stored[i])),
    source: { $: 'SourcePoint', x_high: bits.getUint32(0), x_low: bits.getUint32(4),
      y_high: bits.getUint32(8), y_low: bits.getUint32(12) } };
}

export function encodeSketchArcEntities(entities) {
  return list(entities.map((entity, index) => {
    if (entity.construction === true) unsupported('Construction geometry in a line/arc profile is unsupported');
    if (!['line', 'arc'].includes(entity.type)) unsupported(`Analytic sketch entity '${entity.type}' is unsupported`);
    const base = { $: entity.type === 'arc' ? 'Arc' : 'Line', index: entity.index ?? index,
      start: sketchArcPoint(entity.startMeters), end: sketchArcPoint(entity.endMeters) };
    if (!Number.isInteger(base.index) || base.index < 0 || base.index > 0xffffffff) throw new RangeError('Invalid sketch entity index');
    if (entity.type === 'arc') base.mid = sketchArcPoint(entity.midMeters);
    return base;
  }));
}

export function solveSketchArcs(native, entities, loc) {
  const result = native.solve(encodeSketchArcEntities(entities));
  if (result.$ !== 'Solved') unsupported(`Native line/arc sketch unsupported: ${result.reason?.$ ?? result.$}`, loc);
  return result;
}

export function decodeSketchArcExtrusion(result, id, kernel, loc) {
  if (result.$ !== 'Extruded') unsupported(`Native line/arc extrusion unsupported: ${result.reason?.$ ?? result.$}`, loc);
  if (!result.audit.valid) throw new Error('Native line/arc extrusion failed its final audit');
  const body = decodeAnalytic(result.solid, id, kernel);
  const domains = array(result.domains);
  if (domains.length !== body.edges.length) throw new Error('Incomplete native line/arc edge domains');
  domains.forEach((choice, index) => {
    if (choice.$ !== 'GivenDomain' || choice.domain.$ !== 'Interval') throw new Error('Expected finite native line/arc edge domain');
    body.edges[index].curveRange = [number(choice.domain.first), number(choice.domain.last)];
  });
  body.constructionBudget = constructionBudget(result.source_budget);
  body.construction = { method: 'native Bend line/arc sketch extrusion',
    sourceBudgetMm: number(result.source_budget), requiredIncidenceMm: number(result.audit.required),
    allowanceMm: number(result.audit.allowance), numericResolutionMm: number(result.audit.resolution),
    sourceEndpointGapMm: number(result.profile.endpoint_gap), sourceFitErrorMm: number(result.profile.fit_error),
    sourceResolutionMm: number(result.profile.resolution), signedDepthMm: number(result.depth),
    auditVolumeMm3: number(result.audit.volume), exportToleranceMm: body.validation.toleranceMm };
  body.validation.volumeMm3 = number(result.volume);
  body.validation.scope = 'Native Bend line/arc construction, finite domains, closed topology and carrier incidence; analytic profile area times normal depth';
  body.sketchProfile = { schema: 'wonky-line-arc-sketch/1', native: result.profile };
  return body;
}

export function extrudeSketchArcs(native, kernel, profile, id, plane, delta, startOffset = [0, 0, 0], loc) {
  const origin = kernel.precise.add(vector(plane.origin), vector(startOffset));
  return decodeSketchArcExtrusion(native.extrude(profile, origin, vector(plane.normal), vector(plane.x), vector(delta)), id, kernel, loc);
}
