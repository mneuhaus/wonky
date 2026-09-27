import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { array, snapPrismCaps } from './kernel.mjs';
import { real, number, vector, coords } from './real.mjs';
import { decodeAnalytic, validateAnalytic } from './analytic.mjs';
import { fail, unsupported, UnsupportedFeatureError } from './errors.mjs';
import { identifyBoolean, ensureBodyIdentity } from './identity.mjs';
import { decodeHalfspace } from './halfspace.mjs';
import { intersectionTolerance } from './intersections.mjs';
import { classificationInput } from './face-classification.mjs';
import { decodeNativeIntersection } from './solid-intersection.mjs';
import { decodeCurvedIntersection } from './curved-intersection.mjs';
import { decodePlanarBoolean } from './planar-boolean.mjs';
import { normalizeModelingPolicy, nativeContactPolicy, booleanPolicy } from './modeling-policy.mjs';
import { constructionBudget, operationEvidence, attachOperationEvidence } from './construction-history.mjs';
import { inheritExactness, regularizedSources } from './exactness.mjs';
import { hybridJob, binaryTree, encodeJob, runHybrid, decodeHybrid } from './hybrid.mjs';
import { integrateVolume } from './volume.mjs';
import { certifiedMeshBody, isMeshBody, setRefine } from './hybrid-mesh.mjs';
import { prismBoolean, PRISM_METHOD } from './prism-boolean.mjs';
import { noteParents, noteFallback, noteRefusal } from './diagnostics.mjs';

// Decline codes from kernel/pierce.bend.
const PIERCE_DECLINES = {
  1: 'opBoolean through holes need an all-planar target with straight edges',
  2: 'opBoolean through holes need a tool axis perpendicular to exactly two faces of the target',
  3: 'opBoolean through-hole faces lie at the same height, so nothing is pierced',
  4: 'opBoolean through hole does not clear a boundary edge of a face it pierces',
  5: 'opBoolean through hole needs a positive radius',
  6: 'opBoolean through hole needs a tool that reaches through both pierced faces; a blind pocket needs a floor this operation does not build',
  7: 'opBoolean through hole must land in material; this axis misses the face it would pierce',
  8: 'opBoolean through hole needs two pierced faces facing opposite ways; these two bound no material between them',
};

// Bitwise equality of two decoded analytic curves (binary64 views of the same
// F32x2 words), used to tell whether the kernel handed an edge back unchanged.
const sameCurve = (p, q) => !!p && !!q && p.type === q.type && Object.keys(p).length === Object.keys(q).length &&
  Object.entries(p).every(([key, value]) => Array.isArray(value)
    ? Array.isArray(q[key]) && value.length === q[key].length && value.every((v, i) => Object.is(v, q[key][i]))
    : Object.is(value, q[key]));

// The hybrid Boolean (docs/hybrid-boolean-plan.md section 8, step 7): the last
// arm of booleanInBend. Every exact arm below runs first, unchanged; where
// none admits the operation, its refusal is handed here instead of raised
// (policy 'hybrid-last', the default; 'exact-only' raises it as before). The
// hybrid meshes both operands with face tags, corefines them and recovers an
// analytic B-rep in Bend (kernel/hybrid). Its three answers:
//   exact: a recovered analytic body; its volume is integrated in Bend
//     (kernel/volume.bend) and stated as the certified volume only when every
//     face integrates in closed form;
//   mesh: a certified mesh, never exact, handed to certifiedMeshBody
//     (src/hybrid-mesh.mjs) with its deviation and recover's reason;
//   unresolved: refused by name, with the exact arm's refusal first.
export const HYBRID_METHOD = 'hybrid corefine+recover';
// The exact prism arm's method (src/prism-boolean.mjs), for src/library.mjs removedMaterial.
export { PRISM_METHOD };
// Unresolved reasons of the native arms (kernel/ports/types.bend Reason) that
// are verdicts on the input, not on the arm's capability: a damaged or
// out-of-budget operand is refused as it was, never re-meshed by the hybrid.
const INPUT_VERDICTS = new Set(['InvalidInput', 'InvalidTopology', 'SourceTolerance']);
const capabilityDecline = result => result.$ === 'Unresolved' && !INPUT_VERDICTS.has(result.reason?.$);
const CERTIFICATE_MAXIMA = ['maxBoundaryDeviationMm', 'maxDeviationOverBound', 'maxVertexDriftMm', 'maxDriftOverBound',
  'maxVertexResidualMm', 'maxTagResidualMm', 'minVertexDet'];

// One Boolean through the hybrid: encode, run, decode (src/hybrid.mjs
// hybridBoolean, with the job and the answer kept for WONKY_HYBRID_DUMP=<dir>,
// which writes <id>.job and <id>.answer for the bake-off tools).
function runHybridBoolean(kernel, operands, operation, id, validate, deviationMm = undefined) {
  const job = hybridJob(kernel, operands, binaryTree(operation), { id: String(id).replace(/\s+/g, '_'), ...(deviationMm ? { deviationMm } : {}) });
  const jobText = encodeJob(job);
  const dump = process.env.WONKY_HYBRID_DUMP, stem = dump ? join(dump, String(id).replace(/[^A-Za-z0-9._-]+/g, '_')) : null;
  if (dump) { mkdirSync(dump, { recursive: true }); writeFileSync(`${stem}.job`, jobText); }
  const { text: answer, meshText } = runHybrid(kernel, jobText);
  if (dump) writeFileSync(`${stem}.answer`, answer);
  return { job, jobText, answer, ...decodeHybrid(answer, { id, job, operands, meshText, validate, kernel }) };
}

const certificateOf = stats => stats ? Object.fromEntries(CERTIFICATE_MAXIMA.filter(key => stats[key] !== undefined).map(key => [key, stats[key]])) : null;

// A recovered body with an enclosed void shell does not fit the analytic body
// format (validateAnalytic insists on one connected shell), so it is refused by
// name before validation.
const validateRecovered = kernel => body => {
  if (body.voids?.length) unsupported(`the recovered result has ${body.voids.length} enclosed void shell(s); the analytic body format holds one shell`);
  return validateAnalytic(body, kernel);
};

// The volume of a recovered body, integrated in Bend over its faces. Stated as
// the body's certified volume (validation.volumeMm3) only when every face
// integrated in closed form; a quadrature value keeps its label and bound in
// validation.integratedVolume and is never stated as exact.
function recoveredVolume(kernel, body, loc) {
  let measured;
  try { measured = integrateVolume(kernel, body, { loc }); } catch (error) {
    if (!(error instanceof UnsupportedFeatureError)) throw error;
    body.validation.integratedVolume = { refused: error.message };
    return;
  }
  const { volumeMm3, boundMm3, relativeBound, label, method } = measured;
  body.validation.integratedVolume = { volumeMm3, boundMm3, relativeBound, label, method };
  if (label === 'exact') {
    body.validation.volumeMm3 = volumeMm3;
    body.validation.scope = `${body.validation.scope}; recovered by the hybrid Boolean; volume integrated in closed form in Bend (kernel/volume.bend, bound ${boundMm3} mm3)`;
  }
}

// Removal and identity read the face provenance: every face of a recovered
// body lists the operand faces (leaf, face index) its triangles came from.
export function hybridFaceSources(body) {
  return (body.provenance?.faces ?? []).map(face => face.sources ?? null);
}

// WONKY_BOOLEAN_DIFF=1: an operation an exact arm admitted also runs through
// the hybrid; the two are compared on topology (bodies and genus: they agree or
// not), volume (1e-9 relative: agree or not), and on representation (vertex,
// edge and face counts, the operand faces behind each face: reported, since an
// arm may subdivide faces the hybrid keeps whole). The admitted result is
// returned unchanged; the comparison is operation evidence (hybridDiff) and one
// stderr line.
// Genus of a one-shell body by Euler-Poincare: V - E + 2F - L = 2 - 2G.
const genus = body => (2 - (body.vertices.length - body.edges.length + 2 * body.faces.length
  - body.faces.reduce((sum, face) => sum + face.loops.length, 0))) / 2;
function faceSignatures(body) {
  // An exact arm's face origins: the planar arrangement's contributors, or a
  // single operand face; any other form is not compared.
  const origins = body.construction?.faceOrigins;
  if (Array.isArray(origins)) {
    const refs = origins.map(origin => origin?.contributors ? (Array.isArray(origin.contributors) ? origin.contributors : array(origin.contributors)).map(ref => `${ref.operand}/${ref.index}`)
      : Number.isInteger(origin?.operand) && Number.isInteger(origin.index ?? origin.face) ? [`${origin.operand}/${origin.index ?? origin.face}`] : null);
    return refs.every(Boolean) ? refs.map(list => list.sort().join(' ')) : null;
  }
  const sources = hybridFaceSources(body);
  if (sources.length && sources.every(Boolean)) return sources.map(list => list.map(s => `${s.leaf}/${s.face}`).sort().join(' '));
  return null;
}
function volumeOf(kernel, body) {
  if (Number.isFinite(body.validation?.volumeMm3)) return body.validation.volumeMm3;
  try { return integrateVolume(kernel, body).volumeMm3; } catch { return null; }
}
function compareWithHybrid(kernel, a, b, operation, id, admitted) {
  const report = { admittedMethod: admitted[0]?.construction?.method ?? null, differences: [], representation: [] };
  try {
    const h = runHybridBoolean(kernel, [a, b], operation, `${id}/diff`, validateRecovered(kernel));
    report.status = h.status;
    if (h.status !== 'exact') { report.reason = h.reason ?? null; report.agree = false; report.differences.push(`hybrid answered ${h.status}`); }
    else {
      const counts = body => ({ vertices: body.vertices.length, edges: body.edges.length, faces: body.faces.length, genus: genus(body) });
      const same = (f, x, y) => JSON.stringify(x.map(f).sort()) === JSON.stringify(y.map(f).sort());
      report.admitted = admitted.map(counts);
      report.hybrid = h.bodies.map(counts);
      if (admitted.length !== h.bodies.length || !same(genus, admitted, h.bodies)) report.differences.push('topology');
      else if (!same(body => JSON.stringify(counts(body)), admitted, h.bodies)) report.representation.push('counts');
      const volumes = bodies => bodies.map(body => volumeOf(kernel, body)).sort((x, y) => x - y);
      const va = volumes(admitted), vh = volumes(h.bodies);
      report.volumesMm3 = { admitted: va, hybrid: vh };
      if (va.length !== vh.length || va.some((v, i) => !Number.isFinite(v) || !Number.isFinite(vh[i]) || Math.abs(v - vh[i]) > 1e-9 * Math.abs(v))) report.differences.push('volume');
      const signatures = bodies => { const all = bodies.map(faceSignatures); return all.every(Boolean) ? all.flat().sort() : null; };
      const sa = signatures(admitted), sh = signatures(h.bodies);
      report.faceSources = sa && sh ? (JSON.stringify(sa) === JSON.stringify(sh) ? 'equal' : 'different') : 'not compared';
      if (report.faceSources === 'different') report.representation.push('face sources');
      report.agree = !report.differences.length;
    }
  } catch (error) {
    report.status = 'refused'; report.reason = error.message; report.agree = false; report.differences.push('hybrid refused');
  }
  const representation = report.representation.length ? ` (representation differs: ${report.representation.join(', ')})` : '';
  process.stderr.write(`WONKY_BOOLEAN_DIFF ${id} ${operation}: ${report.agree ? `agree${representation}` : `diverge (${report.differences.join(', ')})`} [${report.admittedMethod}]${report.reason ? ` ${report.reason}` : ''}\n`);
  return report;
}

export function booleanInBend(kernel, a, b, operation, id, loc, identityContext = {}) {
  const operationIndex = ['UNION', 'INTERSECTION', 'SUBTRACTION'].indexOf(operation);
  if (operationIndex < 0) fail(`Invalid Boolean operation '${operation}'`, loc);
  const modelingPolicy = normalizeModelingPolicy(identityContext.modelingPolicy);
  const arms = booleanPolicy(modelingPolicy);
  for (const body of [a, b]) ensureBodyIdentity(kernel, body);
  // A result computed from a regularized input is exact only relative to it
  // (src/exactness.mjs), so it states the inputs' label before its identity.
  // labelInputs: the operands the result was computed from (a cap-snapped copy
  // after a planar retry, below); the identity lineage names the user's bodies.
  let labelInputs = [a, b];
  const identify = bodies => bodies.map((body, i) => {
    noteParents(body, [a, b]);
    body.construction.operation = operation;
    inheritExactness(body, labelInputs);
    identifyBoolean(kernel, body, id, operation, [a, b], i, { ...identityContext,
      source: { file: null, sha256: null, span: loc ? { line: loc.line, column: loc.column } : null, ...identityContext.source } });
    return body;
  });
  // An exact arm's result, returned as it is; in diff mode also compared with
  // the hybrid (evidence only).
  const admitted = bodies => {
    if (process.env.WONKY_BOOLEAN_DIFF === '1' && bodies.length && kernel.hybrid) {
      const evidence = bodies.operationEvidence?.[0];
      const report = compareWithHybrid(kernel, a, b, operation, id, bodies);
      if (evidence) evidence.hybridDiff = report;
    }
    return bodies;
  };
  // The last arms. `message` is the refusal of the exact arm that declined,
  // `declined` its record. Under 'exact-only' the refusal is raised as before
  // the hybrid existed. Otherwise first the exact prism arm (src/prism-boolean.mjs):
  // right prisms along one coordinate axis with fitting cap planes, combined
  // as a 2D line/arc region Boolean in Bend; it builds or declines, never
  // guesses. What it declines goes to the hybrid.
  const last = (message, declined = {}) => {
    labelInputs = [a, b];
    if (arms === 'exact-only') unsupported(message, loc);
    const prism = prismBoolean(kernel, a, b, operation, id);
    if (prism.status === 'built') {
      return admitted(attachOperationEvidence(identify(prism.bodies), operationEvidence(id, operation, [a, b], modelingPolicy,
        { ...prism.evidence, booleanPolicy: arms, declined: { message, ...declined } })));
    }
    const details = { method: HYBRID_METHOD, booleanPolicy: arms, declined: { message, ...declined }, prism: prism.evidence };
    // extra: what the hybrid answered (answer, deviation, leaves); the status
    // of a refusal is always 'Refused' and its reason the refusal's own.
    let h;
    const refuse = (reason, extra = {}, cause = null) => {
      const evidence = operationEvidence(id, operation, [a, b], modelingPolicy, { ...details, ...extra, status: 'Refused', reason });
      const error = new UnsupportedFeatureError(`${message} [hybrid: ${reason}]`, loc);
      error.operationEvidence = [evidence];
      noteRefusal(error, [a, b], h);
      if (cause) error.cause = cause;
      throw error;
    };
    if (!kernel.hybrid) refuse('the hybrid Boolean (kernel/hybrid) is not loaded in this kernel backend');
    try { h = runHybridBoolean(kernel, [a, b], operation, id, validateRecovered(kernel)); } catch (error) {
      // A named refusal on the way (an operand printMesh does not cover, a
      // recovered void) keeps the exact arm's refusal in front of it.
      if (error instanceof UnsupportedFeatureError) refuse(error.message, {}, error);
      if (!error.line && loc) { error.line = loc.line; error.column = loc.column; }
      error.operationEvidence = [operationEvidence(id, operation, [a, b], modelingPolicy, { ...details, status: 'Failed', reason: error.message })];
      throw error;
    }
    const outcome = { answer: h.status, deviationMm: h.job.deviation, leaves: h.job.leaves };
    if (h.status === 'unresolved') refuse(h.reason, outcome);
    if (h.status === 'mesh') {
      // Never exact: a certified mesh with the job deviation and recover's
      // reason for not recovering it (src/hybrid-mesh.mjs).
      const meshEvidence = { ...details, ...outcome, status: 'mesh', meshReason: h.reason, approximation: true, exact: false };
      let bodies;
      try { bodies = certifiedMeshBody(h, id, [a, b], loc); } catch (error) {
        if (error instanceof UnsupportedFeatureError) refuse(error.message, { ...outcome, meshReason: h.reason, approximation: true, exact: false }, error);
        error.operationEvidence = [operationEvidence(id, operation, [a, b], modelingPolicy, { ...meshEvidence, status: 'Failed', reason: error.message })];
        throw error;
      }
      bodies = Array.isArray(bodies) ? bodies : [bodies];
      // Print-only refinement (src/hybrid-mesh.mjs snappedPrintMesh): the same
      // job again at a finer deviation, its mesh operands refined the same way
      // first. Only a mesh answer counts; anything else is no refinement.
      const refine = deviationMm => {
        const operands = [a, b].map(o => (isMeshBody(o) && !(o.mesh.deviationMm <= deviationMm) ? o.refineMesh?.(deviationMm) ?? null : o));
        if (operands.includes(null)) return { reason: 'a certified-mesh operand does not refine' };
        let h2;
        try { h2 = runHybridBoolean(kernel, operands, operation, `${id}~${deviationMm}`, validateRecovered(kernel), deviationMm); } catch (error) {
          if (error instanceof UnsupportedFeatureError) return { reason: error.message };
          throw error;
        }
        if (h2.status !== 'mesh') return { reason: `the job at ${deviationMm} mm answers ${h2.status}${h2.reason ? ` (${h2.reason})` : ''}` };
        try { return { body: certifiedMeshBody(h2, id, operands, loc)[0] }; } catch (error) {
          if (error instanceof UnsupportedFeatureError) return { reason: error.message };
          throw error;
        }
      };
      for (const body of bodies) {
        noteFallback(body, h, [a, b]);
        setRefine(body, refine);
      }
      return attachOperationEvidence(identify(bodies), operationEvidence(id, operation, [a, b], modelingPolicy, meshEvidence));
    }
    for (const body of h.bodies) {
      body.construction = { ...body.construction, operation };
      recoveredVolume(kernel, body, loc);
    }
    const bodies = identify(h.bodies);
    // Result faces name the operand faces they came from (recover's tags);
    // the identity records them next to the operation's lineage.
    for (const body of bodies) {
      const faces = body.identity?.topology?.faces;
      if (faces) hybridFaceSources(body).forEach((sources, i) => {
        if (faces[i]) faces[i].sources = sources ? sources.map(s => ({ operand: s.leaf, face: s.face, ...(s.identity ? { identity: s.identity } : {}) })) : null;
      });
    }
    return attachOperationEvidence(bodies, operationEvidence(id, operation, [a, b], modelingPolicy, {
      ...details, ...outcome, status: 'exact', certificate: certificateOf(h.stats), statements: h.statements,
      volumes: bodies.map(body => body.validation.integratedVolume ?? null),
      attachedMesh: bodies.map(body => body.hybridMesh ? (body.hybridMesh.refused ? { refused: body.hybridMesh.refused } : { triangles: body.hybridMesh.triangles.length }) : null) }));
  };
  // A certified-mesh operand (src/hybrid-mesh.mjs) has no exact edges or
  // vertices, so no exact arm can admit it (their tests over body.edges would
  // hold vacuously); it goes to the last arm directly.
  const meshOperands = [a, b].filter(isMeshBody);
  if (meshOperands.length) {
    return last(`opBoolean exact arms do not take certified-mesh operands (${meshOperands.map(body => body.id).join(', ')}): they are approximations with no exact edges`,
      { arm: 'none (certified-mesh operand)' });
  }
  const cylinder = body => body.primitive?.type === 'frustum' && body.primitive.r0 === body.primitive.r1;
  if (!cylinder(a) || !cylinder(b)) {
    const planar = body => body.faces.every(face => face.surface.type === 'plane') && body.edges.every(edge => (edge.curve.type ?? edge.curve) === 'line');
    if (['UNION', 'SUBTRACTION'].includes(operation) && planar(a) && planar(b)) {
      const tolerance = intersectionTolerance();
      const arrange = (x, y) => {
        const first = classificationInput(x, kernel.faceClassifier), second = classificationInput(y, kernel.faceClassifier);
        if (!first.solid || !second.solid) fail('Invalid planar Boolean topology', loc);
        return { first, second, result: kernel.planarBoolean[operation === 'UNION' ? 'union' : 'subtract'](first.solid, first.domains, first.sourceBudget,
          second.solid, second.domains, second.sourceBudget, tolerance) };
      };
      let { first, second, result } = arrange(a, b), capSnap = null;
      // A contact the arrangement cannot resolve (a vertex within its resolution
      // of a plane but not on it) is retried once with one prism operand's caps
      // moved onto the near-coplanar planes of the other (src/kernel.mjs
      // snapPrismCaps, stated tolerance, labelled 'regularized'). Nothing that
      // resolves without it is changed.
      if (result.$ === 'Unresolved' && result.reason?.$ === 'AmbiguousContact') {
        const snappedB = snapPrismCaps(kernel, b, a), snappedA = snappedB ? null : snapPrismCaps(kernel, a, b);
        if (snappedA || snappedB) {
          const inputs = [snappedA ?? a, snappedB ?? b], retry = arrange(...inputs);
          capSnap = { refused: { reason: result.reason.$, stage: result.stage, detail: result.detail },
            snapped: (snappedA ?? snappedB).construction.capSnap.map(snap => ({ body: (snappedA ?? snappedB).id, ...snap })), retry: retry.result.$,
            ...(retry.result.$ === 'Unresolved' ? { retryReason: { reason: retry.result.reason?.$, stage: retry.result.stage, detail: retry.result.detail } } : {}) };
          if (retry.result.$ !== 'Unresolved') { ({ first, second, result } = retry); labelInputs = inputs; }
        }
      }
      const evidence = operationEvidence(id, operation, [a, b], modelingPolicy, {
        method: `native Bend planar arrangement ${operation === 'UNION' ? 'union' : 'subtraction'}`, status: result.$,
        sourceBudget: kernel.real.max(first.sourceBudget, second.sourceBudget), nativeSourceBudget: result.source_budget,
        inputBudgets: [first.sourceBudget, second.sourceBudget], tolerance, stats: result.stats,
        ...(result.$ === 'Unresolved' ? { reason: result.reason, stage: result.stage, detail: result.detail } : {}),
        ...(capSnap ? { capSnap } : {}),
      });
      // Still unresolved after the cap-snap retry: the last arm, which starts
      // again from the user's operands (never from a cap-snapped copy).
      if (capabilityDecline(result) && arms !== 'exact-only') {
        return last(`Native planar arrangement ${operation.toLowerCase()} unresolved: ${result.reason?.$ ?? result.$} (stage ${result.stage}, detail ${result.detail})`,
          { arm: evidence.method, reason: result.reason?.$ ?? null, stage: result.stage, detail: result.detail, ...(capSnap ? { capSnap } : {}) });
      }
      try {
        const { bodies, audits } = decodePlanarBoolean(result, id, kernel, tolerance, labelInputs, loc, operation);
        evidence.audits = audits;
        return admitted(attachOperationEvidence(identify(bodies), evidence));
      } catch (error) { error.operationEvidence = [evidence]; throw error; }
    }
    if (operation === 'INTERSECTION' && planar(a) && planar(b) &&
        (!a.constructionBudget || a.constructionBudget.ceilingMm === 0) &&
        (!b.constructionBudget || b.constructionBudget.ceilingMm === 0)) {
      const first = classificationInput(a, kernel.faceClassifier), second = classificationInput(b, kernel.faceClassifier);
      if (!first.solid || !second.solid) fail('Invalid convex Boolean topology', loc);
      const explicitDomains = [a, b].some(body => body.edges.some(edge => edge.curveRange));
      const result = explicitDomains ? { $: 'Unresolved' } : kernel.halfspace.intersect(first.solid, second.solid, intersectionTolerance(), first.sourceBudget, second.sourceBudget);
      const bodies = result.$ !== 'Unresolved' ? decodeHalfspace(result, `${id}/0`, kernel)
        : decodeNativeIntersection(kernel.solidIntersection.intersect(first.solid, first.domains, first.sourceBudget,
          second.solid, second.domains, second.sourceBudget, intersectionTolerance()), id, kernel, loc);
      // A resolved planar tool has budget zero. The native maximum therefore
      // equals the selected source ceiling (and is zero in the convex path).
      const sourceBudget = kernel.real.max(first.sourceBudget, second.sourceBudget);
      for (const body of bodies) body.constructionBudget = constructionBudget(sourceBudget);
      return admitted(attachOperationEvidence(identify(bodies), operationEvidence(id, operation, [a, b], modelingPolicy,
        { method: 'native Bend planar intersection', status: 'Resolved', sourceBudget,
          inputBudgets: [first.sourceBudget, second.sourceBudget] })));
    }
    const curvedFamily = body => body.faces.every(face => ['plane', 'cylinder'].includes(face.surface.type)) &&
      body.edges.every(edge => ['line', 'circle', 'ellipse'].includes(edge.curve.type ?? edge.curve));
    if (operation === 'INTERSECTION' && curvedFamily(a) && curvedFamily(b)) {
      const first = classificationInput(a, kernel.faceClassifier), second = classificationInput(b, kernel.faceClassifier);
      if (!first.solid || !second.solid) fail('Invalid curved Boolean topology', loc);
      const tolerance = intersectionTolerance();
      const result = kernel.curvedIntersection.intersect(first.solid, first.domains, first.sourceBudget,
        second.solid, second.domains, second.sourceBudget, tolerance, nativeContactPolicy(modelingPolicy));
      const evidence = operationEvidence(id, operation, [a, b], modelingPolicy, {
        method: 'native Bend curved convex-tool intersection', status: result.$,
        policy: result.policy, sourceBudget: result.source_budget, tolerance, steps: array(result.steps),
        inputBudgets: [first.sourceBudget, second.sourceBudget],
        ...(result.$ === 'Unresolved' ? { reason: result.reason, tool: result.tool, face: result.face } : {}),
      });
      if (capabilityDecline(result) && arms !== 'exact-only') {
        return last(`Native curved convex-tool intersection unresolved: ${result.reason?.$ ?? result.$} (tool ${result.tool}, face ${result.face})`,
          { arm: evidence.method, reason: result.reason?.$ ?? null, tool: result.tool, face: result.face });
      }
      try {
        const { bodies, audits } = decodeCurvedIntersection(result, id, kernel, tolerance, loc);
        evidence.audits = audits;
        return admitted(attachOperationEvidence(identify(bodies), evidence));
      } catch (error) { error.operationEvidence = [evidence]; throw error; }
    }
    // A round through hole in a planar body. Not a general Boolean: the tool's
    // axis must be perpendicular to exactly two of the target's faces and its
    // circle must clear every boundary edge of both, which is what a bolt hole,
    // a cable gland or a screw clearance actually is. Inside that admission the
    // result is exact and needs no surface intersection; outside it the kernel
    // declines and this refuses rather than approximating.
    // A target that already carries holes has cylindrical walls and circular
    // rims, so the all-planar gate refused every second bore. Only the faces
    // the tool pierces must be planar, which the kernel's own admission
    // insists on; the rest may be what an earlier hole left behind.
    // A curveRange is refused on circles only. The kernel reads every circle
    // edge as a full turn (an earlier hole's rim), so an arc would be cleared
    // and crossed as the whole circle it lies on. A line edge is read through
    // its two vertices, so its range adds no geometry the kernel could miss;
    // planar arrangement results and native sketch extrusions carry one on
    // every line.
    const curveType = edge => edge.curve.type ?? edge.curve;
    const pierceableFaces = body => body.faces.every(face => ['plane', 'cylinder'].includes(face.surface.type));
    const pierceable = body => pierceableFaces(body)
      && body.edges.every(edge => curveType(edge) === 'line' || (curveType(edge) === 'circle' && !edge.curveRange));
    if (operation === 'SUBTRACTION' && cylinder(b) && pierceableFaces(a)
        && a.edges.every(edge => ['line', 'circle'].includes(curveType(edge))) && !pierceable(a)) {
      return last('opBoolean through holes do not admit arc edges yet: the target has a circle edge with a curve range, which the hole admission would read as a full circle',
        { arm: 'native Bend through-hole pierce' });
    }
    if (operation === 'SUBTRACTION' && pierceable(a) && cylinder(b)) {
      const first = classificationInput(a, kernel.faceClassifier);
      if (!first.solid) fail('Invalid pierce topology', loc);
      const tool = b.primitive, span = tool.top.map((v, i) => v - tool.bottom[i]);
      const length = Math.hypot(...span);
      if (length === 0) fail('Pierce tool has no length', loc);
      const axis = vector(span.map(v => v / length)), radius = real(tool.r0);
      const linear = real(1e-7);
      // The tool's own extent along the axis, so a tool that stops inside the
      // body is declined instead of cut as though it went through.
      const reach = [tool.bottom, tool.top].map(p => p.reduce((sum, v, i) => sum + v * span[i] / length, 0));
      const result = kernel.pierce.pierce(first.solid, vector(tool.bottom), axis, radius,
        real(Math.min(...reach)), real(Math.max(...reach)), linear);
      if (result.$ !== 'Bored') return last(PIERCE_DECLINES[result.reason] ?? `opBoolean could not pierce this body (code ${result.reason})`,
        { arm: 'native Bend through-hole pierce', code: result.reason });
      const body = decodeAnalytic(result.solid, `${id}/0`, kernel);
      // The result volume is the target's minus the bore, so the target must
      // state one. Recovered bodies and imported snapshots do not by design
      // (validateAnalytic never invents a volume); real(null) used to throw a
      // serialization RangeError here with no source location. Checked after
      // admission, where that RangeError was, so a declined hole still reports
      // its own reason first.
      if (!Number.isFinite(a.validation?.volumeMm3)) {
        return last(`opBoolean through hole needs a target with a certified volume; this target (${a.construction?.method ?? a.id ?? 'body'}) states none, and the pierced volume is not invented`,
          { arm: 'native Bend through-hole pierce' });
      }
      // A line keeps its range when the kernel kept its carrier, which it does
      // for every original edge except where it had to normalise a direction.
      // Then the range is dropped rather than rescaled: the two vertices still
      // bound the line exactly.
      a.edges.forEach((edge, i) => {
        if (edge.curveRange && curveType(edge) === 'line' && sameCurve(edge.curve, body.edges[i]?.curve)) body.edges[i].curveRange = [...edge.curveRange];
      });
      const depth = kernel.pierce.bore_depth(first.solid, axis, linear);
      body.validation.volumeMm3 = number(kernel.pierce.pierced_volume(real(a.validation.volumeMm3), radius, depth));
      body.validation.scope = [a, b].some(input => regularizedSources(input).length)
        ? 'boundary topology; through-hole volume in Bend, exact relative to a regularized target (see exactness, regularizedSources)'
        : 'boundary topology; exact through-hole volume in Bend';
      body.constructionBudget = constructionBudget(first.sourceBudget);
      body.construction = { method: 'native Bend through-hole pierce', operation,
        frameId: `${id}/input-frame`, sourceBudgetMm: number(first.sourceBudget),
        radiusMm: tool.r0, depthMm: number(depth),
        admission: 'the tool axis is perpendicular to exactly two target faces and its circle clears every boundary edge of both',
        subdivision: 'no face is subdivided; the two pierced faces gain an inner loop and one cylindrical wall is added' };
      return admitted(attachOperationEvidence(identify([body]), operationEvidence(id, operation, [a, b], modelingPolicy,
        { method: 'native Bend through-hole pierce', status: 'Bored', depthMm: number(depth), radiusMm: tool.r0 })));
    }
    return last('opBoolean supports coaxial cylinder primitives, admitted planar arrangement unions/subtractions, plane/cylinder intersections with a convex tool and a round through hole in a planar body; general trimmed-face booleans are not implemented',
      { arm: 'none admitted' });
  }
  const first = a.primitive, second = b.primitive;
  const result = kernel.boolean.coaxial(vector(first.bottom), vector(first.top), real(first.r0),
    vector(second.bottom), vector(second.top), real(second.r0), operationIndex);
  if (result.enclosed_void) unsupported('opBoolean enclosed void shells are not implemented; through holes and open recesses are supported', loc);
  if (!result.supported) return last('opBoolean requires coaxial cylinders (axis tolerance 1e-9 mm) and retained radial/axial material intervals larger than 1e-7 mm',
    { arm: 'coaxial radial/axial arrangement in Bend' });
  const bodies = array(result.bodies).map((part, i) => {
    const body = decodeAnalytic(part.solid, `${id}/${i}`, kernel);
    body.validation.volumeMm3 = number(part.volume);
    body.validation.boundsMm = { min: coords(part.bounds.low), max: coords(part.bounds.high) };
    body.validation.scope = 'boundary topology and endpoint incidence; coaxial cylinder Boolean volume and bounds in Bend';
    body.construction = { operation, method: 'coaxial radial/axial arrangement in Bend', axisToleranceMm: 1e-9, minimumIntervalMm: 1e-7 };
    inheritExactness(body, [a, b]);
    identifyBoolean(kernel, body, id, operation, [a, b], i, { ...identityContext,
      source: { file: null, sha256: null, span: loc ? { line: loc.line, column: loc.column } : null, ...identityContext.source } });
    return body;
  });
  return admitted(attachOperationEvidence(bodies, operationEvidence(id, operation, [a, b], modelingPolicy,
    { method: 'coaxial radial/axial arrangement in Bend', status: 'Resolved' })));
}
