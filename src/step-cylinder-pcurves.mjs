import { loadBend } from './bend-loader.mjs';
import { array } from './kernel.mjs';
import { classificationInput } from './face-classification.mjs';
import { intersectionTolerance } from './intersections.mjs';
import { number, real } from './real.mjs';

let loaded;
export function loadStepCylinderPCurves() {
  loaded ??= loadBend(new URL('../kernel/step-cylinder-pcurves.bend', import.meta.url));
  return loaded;
}

function decodeCurve(curve) {
  return {
    first: number(curve.first), last: number(curve.last), degree: curve.degree,
    points: array(curve.points).map(({ u, v }) => [number(u), number(v)]),
    knots: array(curve.knots).map(number), multiplicities: array(curve.multiplicities),
    approximationBoundMm: number(curve.approximation_bound), supportBoundMm: number(curve.support_bound),
    normalizationBoundMm: number(curve.normalization_bound), numericGuardMm: number(curve.numeric_guard),
    totalBoundMm: number(curve.total_bound),
  };
}

export function decodeCylinderPCurves(result) {
  if (result.$ !== 'Resolved') return {
    status: 'Unresolved', reason: result.reason.$,
    ...Object.fromEntries([['faceIndex', 'face_index'], ['loopIndex', 'loop_index'], ['useIndex', 'use_index'], ['edgeIndex', 'edge_index']]
      .flatMap(([key, field]) => result[field] === 0xffffffff ? [] : [[key, result[field]]])),
  };
  return {
    status: 'Resolved', maxTotalBoundMm: number(result.max_total_bound),
    charts: array(result.charts).map(chart => ({
      faceIndex: chart.face_index, closureBoundMm: number(chart.closure_bound),
      pcurves: array(chart.pcurves).map(pcurve => ({
        edgeIndex: pcurve.edge_index, loopIndex: pcurve.loop_index, useIndex: pcurve.use_index,
        forward: pcurve.forward, increasing: pcurve.increasing, periodLift: number(pcurve.period_lift),
        ...decodeCurve(pcurve.curve),
      })),
    })),
    edges: array(result.edges).map(edge => ({
      edgeIndex: edge.edge_index, kind: edge.kind.$,
      associations: array(edge.associations).map(ref => ({ faceIndex: ref.face_index, pcurveIndex: ref.pcurve_index })),
    })),
  };
}

// Encoding/decoding only. Bend audits the whole body and decides every domain,
// chart lift, approximation, seam and association. An explicit body curveRange
// remains authoritative even when callers supply an AutoDomain override.
export function cylinderPCurves(native, bodyOrSolid, { budgetMm = 1e-8, domains, inputTolerance } = {}) {
  const supplied = domains == null ? [] : Array.isArray(domains) ? domains : array(domains);
  const ranges = Array.isArray(bodyOrSolid.edges)
    ? [...bodyOrSolid.edges.map((edge, i) => edge.curveRange ?? supplied[i]), ...supplied.slice(bodyOrSolid.edges.length)]
    : supplied;
  const input = classificationInput(bodyOrSolid, native, {
    domains: ranges, inputTolerance: inputTolerance ?? bodyOrSolid.construction?.sourceBudgetMm ?? 0,
  });
  if (input.solid === null) return { status: 'Unresolved', reason: 'InvalidSource' };
  return decodeCylinderPCurves(native.for_cylinders_domains(
    input.solid, input.domains, intersectionTolerance(), input.sourceBudget, real(budgetMm),
  ));
}
