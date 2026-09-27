import { loadKernel, list } from './kernel.mjs';
import { real, vector } from './real.mjs';
import { curvePlaneCurve, curvePlaneDomain } from './curve-plane.mjs';
import { intersectionTolerance } from './intersections.mjs';
import { unsupported } from './errors.mjs';

let loaded;
export function loadJunction() {
  loaded ??= (async () => {
    await loadKernel();
    const { default: kernel } = await import('../kernel/junction.bend');
    return kernel;
  })();
  return loaded;
}

const asReal = value => value?.$ === 'Real' ? value : real(value);
const asVector = value => value?.$ === 'V3' ? value : vector(value);
const index = value => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new RangeError('Junction references require unsigned integer identifiers');
  return value;
};

export function junctionAnchor(source) {
  if (source.$ === 'SourceVertex') {
    index(source.body); index(source.vertex);
    return source;
  }
  return { $: 'SourceVertex', body: index(source.body), vertex: index(source.vertex),
    point: asVector(source.point), allowance: asReal(source.sourceTolerance ?? 0) };
}

function curveReference(spec) {
  return { $: 'CurveRef', body: index(spec.body), edge: index(spec.edge),
    curve: curvePlaneCurve(spec.curve), domain: curvePlaneDomain(spec.interval) };
}

function planeReference(spec, body = spec.body) {
  if (spec.plane.type !== undefined && spec.plane.type !== 'plane') unsupported('Junction plane witnesses require a plane');
  return { $: 'PlaneRef', body: index(body), face: index(spec.face),
    origin: asVector(spec.plane.origin), normal: asVector(spec.plane.normal) };
}

// These are descriptions, not manufactured geometric points. Bend evaluates
// samples/projections or obtains a hit from the existing curve-plane solver.
export function junctionEvent(spec) {
  if (spec.$) {
    index(spec.key);
    if (spec.$ === 'Vertex') junctionAnchor(spec.source);
    else if (spec.$ === 'Sample') { index(spec.reference.body); index(spec.reference.edge); }
    else if (spec.$ === 'Projection') {
      index(spec.reference.body); index(spec.reference.face); junctionAnchor(spec.seed);
    } else if (spec.$ === 'Intersection') {
      index(spec.curve.body); index(spec.curve.edge);
      index(spec.plane.body); index(spec.plane.face); index(spec.hit_index);
    } else unsupported(`Junction event '${spec.$}' is not supported`);
    return spec;
  }
  const key = index(spec.id);
  switch (spec.type) {
    case 'vertex': return { $: 'Vertex', key, source: junctionAnchor(spec.source) };
    case 'curve-sample': return { $: 'Sample', key, reference: curveReference(spec),
      parameter: asReal(spec.parameter), allowance: asReal(spec.sourceTolerance ?? 0) };
    case 'plane-projection': return { $: 'Projection', key, reference: planeReference(spec), seed: junctionAnchor(spec.seed) };
    case 'curve-plane-hit': return { $: 'Intersection', key, curve: curveReference(spec),
      plane: planeReference(spec, spec.planeBody), hit_index: index(spec.hit ?? 0),
      tolerance: spec.tolerance?.$ ? spec.tolerance : intersectionTolerance(spec.tolerance),
      allowance: asReal(spec.sourceTolerance ?? 0) };
    default: return unsupported(`Junction event '${spec.type}' is not supported`);
  }
}

export function junctionPolicy(policy) {
  if (policy?.$ === 'Policy') return policy;
  if (policy?.contactTolerance === undefined) throw new TypeError('An explicit junction contactTolerance is required');
  return { $: 'Policy', contact_tolerance: asReal(policy.contactTolerance) };
}

export async function associateJunction(anchor, events, policy) {
  const kernel = await loadJunction();
  return kernel.associate(junctionAnchor(anchor), list(events.map(junctionEvent)), junctionPolicy(policy));
}

export async function chooseJunctionAnchor(anchors, events, policy) {
  const kernel = await loadJunction();
  return kernel.choose_anchor(list(anchors.map(junctionAnchor)), list(events.map(junctionEvent)), junctionPolicy(policy));
}

// The native source must come from edge-plane.prepare_edge or a resolved
// finite-edge result. No endpoint parameter is chosen in JavaScript.
export async function endpointJunctionProposal(source, sourceBody, plane, { atStart, sampleId, projectionId }) {
  if (source?.$ !== 'EdgeSource') throw new TypeError('A prepared native EdgeSource is required');
  index(source.index); index(source.edge.start); index(source.edge.end);
  if (typeof source.edge.same_sense !== 'boolean' || typeof atStart !== 'boolean') {
    throw new TypeError('Endpoint sense and selection must be booleans');
  }
  const kernel = await loadJunction();
  return kernel.endpoint_proposal(source, index(sourceBody), planeReference(plane), atStart, index(sampleId), index(projectionId));
}

export function requireAssociatedJunction(result) {
  if (result.$ !== 'Associated') unsupported(`Junction association ${result.$.toLowerCase()}${result.reason ? `: ${result.reason.$}` : ''}`);
  return result.junction;
}
