import { array } from './kernel.mjs';
import { number, coords } from './real.mjs';
import { decodeAnalytic } from './analytic.mjs';
import { unsupported, fail } from './errors.mjs';
import { constructionBudget } from './construction-history.mjs';

// Geometry, domain construction, provenance and final incidence are native.
// This adapter checks the serialization contract before publishing any body.
export function decodePlanarBoolean(result, id, kernel, tolerance, inputs, loc, operation = 'UNION') {
  if (!['UNION', 'SUBTRACTION'].includes(operation)) fail('Unknown planar arrangement operation', loc);
  const method = `native Bend planar arrangement ${operation === 'UNION' ? 'union' : 'subtraction'}`;
  if (result.$ !== 'Bodies') {
    unsupported(`Native planar arrangement ${operation.toLowerCase()} unresolved: ${result.reason?.$ ?? result.$} (stage ${result.stage}, detail ${result.detail})`, loc);
  }
  if (number(result.source_budget) !== 0) fail('Planar arrangement requires the original zero construction budget', loc);
  const faceKey = ref => `${ref.operand}/${ref.index}`;
  const reference = (ref, kind) => {
    if (!Number.isInteger(ref?.operand) || !Number.isInteger(ref?.index) ||
        ref.operand < 0 || ref.operand >= inputs.length || ref.index < 0 || ref.index >= inputs[ref.operand][kind].length) {
      fail(`Invalid planar arrangement ${kind} origin`, loc);
    }
  };
  const faceReferences = refs => {
    const values = array(refs);
    if (!values.length || new Set(values.map(faceKey)).size !== values.length) fail('Invalid planar arrangement face contributors', loc);
    values.forEach(ref => reference(ref, 'faces'));
    return values;
  };
  const audits = [];
  const bodies = array(result.bodies).map((part, component) => {
    const audit = kernel.curved.audit(part.solid, part.domains, tolerance, result.source_budget);
    if (!audit.valid) fail(`Native planar arrangement component ${component} failed its final audit`, loc);
    const body = decodeAnalytic(part.solid, `${id}/${component}`, kernel);
    if (body.faces.some(face => face.surface.type !== 'plane') || body.edges.some(edge => edge.curve.type !== 'line')) {
      fail('Planar arrangement returned nonplanar geometry', loc);
    }
    const domains = array(part.domains), faces = array(part.face_origins), edges = array(part.edge_origins);
    if (domains.length !== body.edges.length || faces.length !== body.faces.length || edges.length !== body.edges.length) {
      fail('Incomplete native planar-arrangement domains or provenance', loc);
    }
    domains.forEach((choice, index) => {
      if (choice.$ !== 'GivenDomain' || choice.domain?.$ !== 'Interval') fail('Planar arrangement requires finite native line intervals', loc);
      const range = [number(choice.domain.first), number(choice.domain.last)];
      if (!range.every(Number.isFinite) || range[0] >= range[1]) fail('Invalid native planar-arrangement interval', loc);
      body.edges[index].curveRange = range;
    });
    for (const origin of faces) {
      reference(origin.owner, 'faces');
      if (!faceReferences(origin.contributors).some(ref => faceKey(ref) === faceKey(origin.owner))) {
        fail('Planar arrangement face owner is absent from its contributors', loc);
      }
    }
    for (const origin of edges) {
      if (origin.$ === 'OriginalEdge') reference(origin, 'edges');
      else if (origin.$ === 'FaceIntersection') {
        reference(origin.first, 'faces'); reference(origin.second, 'faces');
        if (faceKey(origin.first) === faceKey(origin.second)) fail('Planar edge intersection requires distinct source faces', loc);
      } else if (origin.$ === 'FaceSubdivision') faceReferences(origin.faces);
      else fail('Unknown native planar-arrangement edge origin', loc);
    }
    const metrics = kernel.solidIntersection.planar_measures(part.solid);
    const volume = number(metrics.volume), bounds = { min: coords(metrics.bounds.low), max: coords(metrics.bounds.high) };
    if (!Number.isFinite(volume) || volume <= 0 || ![...bounds.min, ...bounds.max].every(Number.isFinite) ||
        bounds.min.some((value, i) => value >= bounds.max[i])) fail('Invalid native planar-arrangement measures', loc);
    body.constructionBudget = constructionBudget(result.source_budget);
    body.construction = { method, operation,
      frameId: `${id}/input-frame`, sourceBudgetMm: number(result.source_budget),
      requiredIncidenceMm: number(audit.required), allowanceMm: number(audit.allowance),
      numericResolutionMm: number(audit.resolution), stats: structuredClone(result.stats),
      ownership: 'owner is a deterministic representative; all matching original trimmed faces are retained as contributors',
      subdivision: 'FaceSubdivision edges are explicit arrangement subdivisions, not asserted operand intersections',
      faceOrigins: faces, edgeOrigins: edges,
      ...(operation === 'SUBTRACTION' ? { contributorOrientation: 'operand 0 preserves its original orientation; operand 1 reverses its original orientation',
        faceContributorOrientations: faces.map(origin => array(origin.contributors).map(ref => ({ ...ref, reversed: ref.operand === 1 }))) } : {}) };
    body.validation.volumeMm3 = volume;
    body.validation.boundsMm = bounds;
    body.validation.scope = 'Native Bend planar arrangement, closed topology and incidence audit; volume and tight vertex bounds in Bend';
    audits.push({ component, ...audit });
    return body;
  });
  return { bodies, audits };
}
