// Fillet harness TEST INFRASTRUCTURE: the grade of one result on top of the
// validator's verdict (docs/fillet-plan.md §8 step 0). It computes no blend.
//
// verdictOf (validate.mjs) scores a result through OpenCascade's reading of
// the exported STEP at 1e-7 × V. Every `pass` is then also graded by
//   tight   tightcheck.mjs with the prototype's claim (prototypes.mjs):
//           supports on input surfaces to 1e-9 mm, edges on their faces to
//           1e-9 mm, blends grounded and G1, the stated tolerances as claimed
//           -> `tight-fail`;
//   div     the result's volume from its own exact geometry (divvolume.mjs,
//           no OCCT, no STEP) against the same reference the verdict used:
//           the closed forms on the job's geometry (closedform.mjs) to
//           1e-9 × V, else Onshape's value or bounds, else the OCCT oracle,
//           at their precision (1e-7 × V) -> `div-mismatch`;
//   step    strict STEP (uv run scripts/validate-step.py: OpenCascade reads
//           the STEP, BRepCheck with exact CurveOnSurface, topology and
//           volume); a failure is `step-fail` only where the runner gates on
//           it (run.mjs for the production writer or with --step-gate;
//           run-adversarial.mjs by default); a production export refusal
//           (no STEP, so `unmeasured`) is `step-fail` there too.
// Results that are not `pass*` keep their verdict; their checks are reported.

import { decodeJob, decodeResult } from './brepfmt.mjs';
import { closedFormVariants } from './closedform.mjs';
import { divVolume } from './divvolume.mjs';
import { tightCheck } from './tightcheck.mjs';
import { VOLUME_REL, verdictOf } from './validate.mjs';

export const DIV_REL = 1e-9;

// The volume change of the result from both bodies' own geometry, against the
// reference the verdict used. spec carries `onshape` (reference.json) like
// verdictOf; ref is the OCCT oracle record; approxTolMm and areaMm2 widen the
// tolerance for faces that state an approximation.
export function divCheck(jobText, resultText, spec, { ref = null, approxTolMm = 0, areaMm2 = null } = {}) {
  const job = decodeJob(jobText), res = decodeResult(resultText);
  if (res.status !== 'ok') return { status: res.status };
  const d1 = divVolume(res.body), d0 = divVolume(job.body);
  if (d1.errors || d0.errors) return { status: 'unsupported', errors: [...(d0.errors ?? []).map((e) => `input ${e}`), ...(d1.errors ?? [])].slice(0, 3) };
  const V0 = d0.volume, dV = d1.volume - V0;
  const out = { status: 'ok', volume: d1.volume, inputVolume: V0, deltaVolume: dV };
  const scale = Math.max(Math.abs(V0), 1);
  // approximated faces: area × stated tolerance (area from OCCT when measured)
  const approx = approxTolMm > 0 ? (areaMm2 ?? 0) * approxTolMm : 0;
  const tight = DIV_REL * scale + approx, loose = VOLUME_REL * scale + approx;
  const on = spec?.onshape?.verdict === 'built' ? spec.onshape : null;
  const forms = closedFormVariants(spec?.closedForm, job);
  // A job form the harness cannot evaluate is a harness defect: reported, never
  // replaced by the design value.
  if (forms?.primary.jobError) return { ...out, status: 'job-form-error', error: forms.primary.jobError };
  if (forms) {
    // With a probe, the forms Onshape agrees with (on the design geometry) decide.
    const agree = on ? Object.entries(forms).filter(([, f]) => Math.abs(f.design - on.deltaVolume) <= loose) : [];
    const use = agree.length ? agree : Object.entries(forms);
    out.reference = agree.length ? 'closed form (Onshape agrees)' : 'closed form';
    out.forms = Object.fromEntries(Object.entries(forms).map(([k, f]) => [k, { ...f, absErr: Math.abs(dV - f.value), used: use.some(([u]) => u === k) }]));
    out.tolerance = tight;
    out.matches = use.filter(([, f]) => Math.abs(dV - f.value) <= tight).map(([k]) => k);
    out.ok = out.matches.length > 0;
    return out;
  }
  if (on) {
    const e = Math.abs(dV - on.deltaVolume), lo = on.volumeMin - on.inputVolume, hi = on.volumeMax - on.inputVolume;
    Object.assign(out, { reference: 'Onshape', expected: on.deltaVolume, absErr: e, tolerance: loose, inRange: dV >= lo - loose && dV <= hi + loose });
    out.ok = e <= loose || out.inRange;
    return out;
  }
  if (ref?.status === 'done' && ref.result?.valid && Number.isFinite(ref.input?.volume)) {
    const expected = ref.result.volume - ref.input.volume, e = Math.abs(dV - expected);
    Object.assign(out, { reference: 'OCCT oracle', expected, absErr: e, tolerance: loose, ok: e <= loose });
    return out;
  }
  return { ...out, status: 'no-reference' };
}

// The final verdict. `base` = verdictOf; the runner has already turned a pass
// on disagreeing targets into its mismatch verdict. stepStrict = {ok, error}
// or null; stepGate: demote a strict STEP failure.
export function gradeVerdict(base, { tight = null, div = null, stepStrict = null, stepGate = false } = {}) {
  // A valid result the production writer refused to export has no STEP to
  // measure (`unmeasured`); where STEP gates, that is its failure.
  if (stepGate && stepStrict?.exportRefused && base === 'unmeasured') return 'step-fail';
  if (!String(base).startsWith('pass')) return base;
  if (tight?.status === 'ok' && !tight.ok) return 'tight-fail';
  if (div?.status === 'ok' && !div.ok) return 'div-mismatch';
  if (stepGate && stepStrict && !stepStrict.ok) return 'step-fail';
  return base;
}

// Everything for one result: checks and verdict (selftest.mjs and the
// runners). targetsAgree false turns a pass into `targetMismatch` (run.mjs
// 'mismatch', run-adversarial.mjs 'mismatch-targets') before the checks.
export function gradeResult({ spec, onshape = null, ref = null, jobText, resultText, report, claim = 'exact', stepStrict = null, stepGate = false, targetsAgree = true, targetMismatch = 'mismatch' }) {
  const s = { ...spec, onshape };
  const verdict = verdictOf(s, report);
  const base = targetsAgree === false && verdict.startsWith('pass') ? targetMismatch : verdict;
  const checks = {};
  if (report?.status === 'ok') {
    checks.tight = tightCheck(jobText, resultText, { claim });
    if (report.valid) {
      checks.div = divCheck(jobText, resultText, s, { ref, approxTolMm: Math.max(0, ...(report.surfaces?.approximated ?? []).map((a) => a.tolMm)), areaMm2: report.comparison?.area ?? null });
    }
  }
  return { base, checks, verdict: gradeVerdict(base, { ...checks, stepStrict, stepGate }) };
}
