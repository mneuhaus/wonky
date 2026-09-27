import { array } from './kernel.mjs';
import { number } from './real.mjs';
import { decodeAnalytic } from './analytic.mjs';
import { unsupported, fail } from './errors.mjs';
import { constructionBudget } from './construction-history.mjs';

// Native construction, topology audit, domains, provenance and mass properties
// are kept separate from the reader's serialization tolerance.
export function decodeCurvedIntersection(result, id, kernel, tolerance, loc) {
  if (result.$ !== 'Bodies') unsupported(`Native curved convex-tool intersection unresolved: ${result.reason?.$ ?? result.$} (tool ${result.tool}, face ${result.face})`, loc);
  const audits = [];
  const bodies = array(result.bodies).map((part, component) => {
    const audit = kernel.curved.audit(part.solid, part.domains, tolerance, result.source_budget);
    if (!audit.valid) fail(`Native curved intersection component ${component} failed its final audit`, loc);
    const exportToleranceMm = Math.max(0.0003, number(audit.allowance));
    const body = decodeAnalytic(part.solid, `${id}/${component}`, kernel,
      array(part.solid.vertices).map(() => exportToleranceMm));
    const domains = array(part.domains), faces = array(part.face_origins), edges = array(part.edge_origins);
    if (domains.length !== body.edges.length || faces.length !== body.faces.length || edges.length !== body.edges.length) {
      fail('Incomplete native curved-intersection domains or provenance', loc);
    }
    domains.forEach((choice, index) => {
      const edge = body.edges[index];
      if (choice.$ === 'GivenDomain' && choice.domain?.$ === 'Interval') {
        edge.curveRange = [number(choice.domain.first), number(choice.domain.last)];
      } else if (!(choice.$ === 'GivenDomain' && choice.domain?.$ === 'Untrimmed' &&
          ['circle', 'ellipse'].includes(edge.curve.type) && edge.start === edge.end)) {
        unsupported('Curved intersection requires a finite native interval or a complete closed conic', loc);
      }
    });
    body.constructionBudget = constructionBudget(result.source_budget);
    body.construction = { method: 'native Bend curved convex-tool intersection', operation: 'INTERSECTION',
      frameId: `${id}/input-frame`, sourceBudgetMm: number(result.source_budget),
      requiredIncidenceMm: number(audit.required), allowanceMm: number(audit.allowance),
      numericResolutionMm: number(audit.resolution), exportToleranceMm,
      faceOrigins: faces, edgeOrigins: edges };
    body.validation.volumeMm3 = number(audit.volume);
    body.validation.scope = 'Native Bend plane/cylinder construction and incidence audit; analytic nominal volume; tight bounds not evaluated';
    body.validation.boundsMm = null;
    audits.push({ component, ...audit });
    return body;
  });
  return { bodies, audits };
}
