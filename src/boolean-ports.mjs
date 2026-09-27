import { loadBend } from './bend-loader.mjs';
import { loadKernel, array } from './kernel.mjs';
import { classificationInput, loadFaceClassifier } from './face-classification.mjs';
import { intersectionTolerance } from './intersections.mjs';
import { vector, number } from './real.mjs';
import { decodeAnalytic } from './analytic.mjs';
import { unsupported } from './errors.mjs';

export const booleanPortNames = Object.freeze(['occt', 'solvespace', 'truck']);
const knownNames = [...booleanPortNames, 'truck-cylinder', 'hybrid'], loaded = new Map();
export function loadBooleanPort(name) {
  if (!knownNames.includes(name)) throw new TypeError(`Unknown Boolean reference port '${name}'`);
  if (!loaded.has(name)) loaded.set(name, loadBend(new URL(`../kernel/ports/${name}.bend`, import.meta.url)));
  return loaded.get(name);
}

// Host code serializes only. Every sign, intersection, loop, face, component
// and output coordinate is computed by the selected native Bend module.
export async function preparePortClip(body, plane, options = {}) {
  if (plane.type !== undefined && plane.type !== 'plane') unsupported('Reference halfspace ports require a plane');
  const classifier = await loadFaceClassifier();
  const input = classificationInput(body, classifier, options);
  return { ...input, origin: plane.origin.$ ? plane.origin : vector(plane.origin),
    normal: plane.normal.$ ? plane.normal : vector(plane.normal), tolerance: intersectionTolerance(options) };
}

export function runPortClip(kernel, prepared) {
  const { solid, domains, origin, normal, tolerance, sourceBudget } = prepared;
  if (!solid) return { $: 'Unresolved', reason: { $: 'InvalidTopology' } };
  return kernel.clip(solid, domains, origin, normal, tolerance, sourceBudget);
}

export async function clipWithPort(name, body, plane, options = {}) {
  const input = await preparePortClip(body, plane, options), kernel = await loadBooleanPort(name);
  return runPortClip(kernel, input);
}

export function portComponents(result) {
  if (result.$ === 'Empty') return [];
  if (result.$ === 'Clipped') return [result];
  if (result.$ === 'Components') {
    const components = array(result.bodies);
    if (!components.length) throw new Error('Components must contain actual solids; use Empty for an empty result');
    return components;
  }
  unsupported(`Boolean reference port unresolved: ${result.reason?.$ ?? result.$}`);
}

export async function decodePortResult(result, name, id = 'reference-clip') {
  const kernel = await loadKernel();
  return portComponents(result).map((component, index) => {
    const body = decodeAnalytic(component.solid, `${id}/${index}`, kernel);
    const domains = array(component.domains), faces = array(component.face_origins), edges = array(component.edge_origins);
    if (faces.length !== body.faces.length || edges.length !== body.edges.length) throw new Error('Incomplete reference-port provenance');
    if (domains.length && domains.length !== body.edges.length) throw new Error('Incomplete reference-port curve domains');
    domains.forEach((choice, i) => {
      if (choice.$ === 'GivenDomain') {
        if (choice.domain.$ !== 'Interval') unsupported('Only finite returned curve intervals can be exported');
        body.edges[i].curveRange = [number(choice.domain.first), number(choice.domain.last)];
      } else if (choice.$ !== 'AutoDomain') throw new Error(`Invalid returned domain ${choice.$}`);
    });
    body.construction = { method: 'Bend Boolean reference port', variant: name,
      scope: 'experimental halfspace construction; see docs/boolean-ports.md', faceOrigins: faces, edgeOrigins: edges };
    return body;
  });
}
