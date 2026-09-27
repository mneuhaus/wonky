import { array, loadKernel } from './kernel.mjs';
import { classificationInput } from './face-classification.mjs';
import { intersectionTolerance } from './intersections.mjs';
import { decodeAnalytic } from './analytic.mjs';
import { unsupported } from './errors.mjs';
import { number, coords } from './real.mjs';

let loaded;
export function loadSolidIntersection() {
  loaded ??= loadKernel().then(kernel => kernel.solidIntersection);
  return loaded;
}

export async function intersectWithHybrid(first, second, options = {}) {
  const kernel = await loadKernel(), native = await loadSolidIntersection();
  const a = classificationInput(first, kernel.faceClassifier, options.first);
  const b = classificationInput(second, kernel.faceClassifier, options.second);
  if (!a.solid || !b.solid) return { $: 'Unresolved', reason: { $: 'InvalidTopology' }, tool: 0, face: 0 };
  return native.intersect(a.solid, a.domains, a.sourceBudget,
    b.solid, b.domains, b.sourceBudget, intersectionTolerance(options));
}

export function requireResolvedIntersection(result, loc) {
  if (result.$ !== 'Bodies') unsupported(`Native convex-tool intersection unresolved: ${result.reason?.$ ?? result.$} (tool ${result.tool}, face ${result.face})`, loc);
  return result;
}

export async function decodeIntersection(result, id = 'intersection') {
  return decodeNativeIntersection(result, id, await loadKernel());
}

export function decodeNativeIntersection(result, id, kernel, loc) {
  requireResolvedIntersection(result, loc);
  return array(result.bodies).map((component, index) => {
    const body = decodeAnalytic(component.solid, `${id}/${index}`, kernel);
    const domains = array(component.domains), faces = array(component.face_origins), edges = array(component.edge_origins);
    if (domains.length && domains.length !== body.edges.length) throw new Error('Incomplete solid-intersection curve domains');
    domains.forEach((choice, i) => {
      if (choice.$ === 'GivenDomain' && choice.domain.$ === 'Interval') body.edges[i].curveRange = [number(choice.domain.first), number(choice.domain.last)];
      else if (choice.$ !== 'AutoDomain') unsupported('Only finite returned curve intervals can be exported');
    });
    if (faces.length !== body.faces.length || edges.length !== body.edges.length) throw new Error('Incomplete solid-intersection provenance');
    body.construction = { method: 'native Bend convex-tool intersection', scope: 'bounded hybrid halfspace sequence',
      faceOrigins: faces, edgeOrigins: edges };
    if (body.faces.every(face => face.surface.type === 'plane') && body.edges.every(edge => edge.curve.type === 'line')) {
      const metrics = kernel.solidIntersection.planar_measures(component.solid);
      body.validation.volumeMm3 = number(metrics.volume);
      body.validation.boundsMm = { min: coords(metrics.bounds.low), max: coords(metrics.bounds.high) };
      body.validation.scope = 'closed planar halfspace sequence; original-operand provenance, volume and tight bounds computed in Bend';
    }
    return body;
  });
}
