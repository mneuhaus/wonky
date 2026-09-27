// The production fillet and chamfer (kernel/fillet: prototype A ported onto
// the production carriers; docs/fillet-plan.md §8 steps 1-2). Encoding and
// decoding only: kernel/fillet/production.bend runs the fillet on a job
// (filletJob) or reads a result text (filletResultBody) and gives the solid on
// kernel/analytic.bend (Sphere, Torus, a cone with a positive half-angle,
// periodic whole circles); this file turns that solid into the host's
// analytic body, the one src/exporters.mjs writes as STEP.
import { loadBend } from './bend-loader.mjs';
import { decodeAnalytic } from './analytic.mjs';
import { array } from './kernel.mjs';
import { number } from './real.mjs';
import { unsupported } from './errors.mjs';

let loaded, analytic;
export function loadFilletProduction() {
  loaded ??= loadBend(new URL('../kernel/fillet/production.bend', import.meta.url));
  return loaded;
}

// The part of loadKernel() that validateAnalytic uses (kernel/analytic.bend
// residuals), without loading every other kernel module.
export async function loadFilletValidation() {
  analytic ??= loadBend(new URL('../kernel/analytic.bend', import.meta.url));
  return { analytic: await analytic };
}

export const FILLET_ROLES = ['support', 'blend', 'corner', 'cap'];

// A's result text -> { status: 'ok', body } | { status: 'unresolved', class,
// reason } (A's own typed refusal). A result the production types cannot hold
// exactly, or a malformed text, is a capability error naming the reason.
// `kernel` (loadKernel()) adds Bend's endpoint-incidence checks to the body's
// validation; without it only the structural checks run.
export function filletResultBody(native, text, id, kernel) {
  if (typeof text !== 'string') throw new TypeError('Fillet result must be a string');
  return producedBody(native.result(text), id, kernel);
}

// The fillet of a job text (docs/fillet/harness.md "Job and result format"):
// filletResultBody's outcome plus the record: the deterministic stripe order
// (ascending edge index, tangent continuations added) and the selection notes
// ("seam-ignored <edge>", "propagated <edge>"), on refusals too.
export function filletJob(native, job, id, kernel) {
  if (typeof job !== 'string') throw new TypeError('Fillet job must be a string');
  const record = native.fillet(job);
  if (record.$ !== 'Record') throw new Error('Unknown fillet record');
  const order = array(record.order), notes = array(record.notes);
  const out = producedBody(record.out, id, kernel);
  if (out.body) Object.assign(out.body.fillet, { order, notes });
  return { ...out, order, notes };
}

function producedBody(produced, id, kernel) {
  if (produced.$ === 'Refused') return { status: 'unresolved', class: produced.cls, reason: produced.why };
  if (produced.$ === 'Unmapped') unsupported(`Fillet result ${id} has no exact production form: ${produced.why}`);
  if (produced.$ !== 'Built') throw new Error('Unknown fillet production outcome');
  const body = decodeAnalytic(produced.solid, id, kernel);
  // Production edge domains: AutoDomain (unranged, or a whole periodic
  // circle) or the stated interval, kept exactly.
  array(produced.domains).forEach((choice, i) => {
    if (choice.$ === 'GivenDomain' && choice.domain.$ === 'Interval') body.edges[i].curveRange = [number(choice.domain.first), number(choice.domain.last)];
    else if (choice.$ !== 'AutoDomain') throw new Error('Unknown fillet edge domain');
  });
  body.fillet = { engine: 'kernel/fillet', claim: 'exact', faceRoles: array(produced.roles).map(code => FILLET_ROLES[code]) };
  return { status: 'ok', body };
}
