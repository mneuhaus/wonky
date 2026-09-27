// Fillet harness TEST INFRASTRUCTURE: prototype registry (docs/fillet/harness.md).
//
// A Bend prototype lives in a directory with
//   main.bend    def run(job: String) -> String     (required)
//                def parse / solve / show           (optional; lets the JS
//                                                   target time the phases)
//   native.bend  main reads IO.args [job, result], writes the result and
//                prints one JSON line of phase times (copy proto/null/native.bend);
//                at most one line marked `# @bakeoff-device-call` (Metal).
// Part-2 prototypes go to kernel/proto/fillet-<name>/. The null baseline sits
// in scripts/fillet/proto/null/ because kernel/proto/** belonged to other
// workflows while the harness was written.
//
// A `results` entry is not a prototype: it replays result files that already
// exist (<dir>/<case>.<target>.result), e.g. OCCT's blends dumped by
// `uv run scripts/fillet/reference.py --dump out/fillet/oracle-occt/results`.
// It exists to test the validator on real blends and is never a candidate.
//
// `claim` is what the prototype says about its faces' stated tolerances
// (tightcheck.mjs, docs/fillet-plan.md §8 step 0): 'exact' (every face states
// tol 0; A and OCCT's analytic blends) or 'approximate' (blend faces may state
// a tolerance > 0 that must then hold; support and cap faces stay exact; C).
// A prototype not listed claims 'exact'.
//
// `stepWriter` is the STEP writer its valid results are measured and
// strictly validated through: 'production' (src/exporters.mjs on the
// production types, kernel/fillet/production.bend; A, docs/fillet-plan.md §8
// step 1) or 'harness' (validate.mjs resultStep, no parameter curves; the
// default). The runners gate on strict STEP for the production writer.

export const DEFAULT_GPU = '1GB';

export const PROTOTYPES = {
  null: {
    dir: 'scripts/fillet/proto/null',
    description: 'Harness baseline: refuses every blend (`unresolved not-implemented`); malformed jobs are `invalid-input`.',
    claim: 'exact',
  },
  'oracle-occt': {
    results: 'out/fillet/oracle-occt/results',
    description: 'OCCT 8.0.1 blends replayed from reference.py --dump (validator self-check; OCCT is an oracle, never a prototype).',
    claim: 'exact',
  },
  'fillet-kpart': {
    dir: 'kernel/proto/fillet-kpart',
    description: 'Prototype A: exact analytic ladder, corner network, local B-rep surgery, overflow as notch (docs/fillet/proto-kpart.md); the reference of the production fillet `fillet` (kernel/fillet, docs/fillet-plan.md §8 step 2).',
    claim: 'exact',
    stepWriter: 'production',
  },
  fillet: {
    dir: 'kernel/fillet',
    description: 'The production fillet and chamfer: prototype A ported onto the production carriers (kernel/analytic.bend; docs/fillet-plan.md §8 step 2). kernel/proto/fillet-kpart stays the reference.',
    claim: 'exact',
    stepWriter: 'production',
  },
  'fillet-rollingball-tori': {
    dir: 'kernel/proto/fillet-rollingball-tori',
    description: 'Prototype C, analytic-carrier variant: rolling-ball stations, blends fitted to cylinder/torus/sphere/plane/cone labelled approximate at 1e-9 mm (the CI cross-check).',
    claim: 'approximate',
  },
  'fillet-rollingball-spline': {
    dir: 'kernel/proto/fillet-rollingball-spline',
    description: 'Prototype C, B-spline variant: blends as bicubic B-splines labelled approximate (1e-9 to 1e-7 mm; the opt-in tolerance stage).',
    claim: 'approximate',
  },
};

export function prototype(name) {
  const p = PROTOTYPES[name] ?? (name.startsWith('fillet-') ? { dir: `kernel/proto/${name}`, description: 'part-2 prototype' } : null);
  if (!p) throw new Error(`unknown prototype '${name}' (known: ${Object.keys(PROTOTYPES).join(', ')}, or fillet-<name> in kernel/proto/)`);
  return { name, gpu: DEFAULT_GPU, claim: 'exact', stepWriter: 'harness', ...p };
}
