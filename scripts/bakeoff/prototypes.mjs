// Boolean bake-off TEST INFRASTRUCTURE: prototype registry.
//
// Every prototype lives in kernel/proto/<name>/ with (corefine, recover and
// hybrid are thin entries over the production code in kernel/hybrid/)
//   main.bend    def run(job: String) -> String   (required)
//                def parse / solve / show          (optional; lets the JS
//                                                   target time the phases)
//   native.bend  main reads IO.args [job, result], writes the result and
//                prints one JSON line of phase times (copy null/native.bend);
//                exactly one line marked `# @bakeoff-device-call`.
//
// input:  'mesh'   the full job (tree + face table + tagged leaf meshes)
//         'csg'    the job without meshes (<case>.csg.job)
//         'recover' the full job immediately followed by a tagged Boolean
//                  result (see docs/bakeoff.md, "Recover mode")
// output: 'mesh'   bake-off result text, validated and scored
//         'brep'   status line + prototype-defined body; only the status and
//                  an optional embedded `mesh` section are checked
//         'hybrid' exact <B-rep> | mesh <dev> <reason> <mesh> | unresolved
//                  (kernel/hybrid/main.bend); the mesh answer is validated
//                  and scored like a 'mesh' result (verdict mesh-<verdict>),
//                  the exact B-rep is graded by judge-recover.mjs
// gpu:    the metal target's device heap (`--gpu` of the Bend runtime),
//         DEFAULT_GPU unless the prototype needs more; run.mjs --gpu
//         overrides it for one run.

export const DEFAULT_GPU = '1GB';

export const PROTOTYPES = {
  null: {
    input: 'mesh', output: 'mesh',
    description: 'Harness baseline: single leaf pass-through and separated-union concatenation; everything else unresolved.',
  },
  corefine: {
    input: 'mesh', output: 'mesh',
    description: 'Tagged mesh corefinement with exact/filtered predicates (topology oracle for the hybrid).',
  },
  'exact-plane': {
    input: 'mesh', output: 'mesh',
    description: 'Plane-based exact mesh Boolean (triangles as plane triples, exact arrangement).',
  },
  sdf: {
    input: 'csg', output: 'mesh',
    // Octrees of the large corpus cases do not fit 1GB (plate-hole-grid-10x10,
    // hex-nut, enclosure-shell, pin-array-chain-20; docs/proto-sdf.md).
    gpu: '8GB',
    description: 'Analytic CSG evaluated as distance fields; meshing at the stated deviation.',
  },
  recover: {
    input: 'recover', output: 'brep',
    description: 'Analytic B-rep recovery from a tagged Boolean mesh (exact intersection curves per tag pair).',
  },
  hybrid: {
    input: 'mesh', output: 'hybrid',
    description: 'The production hybrid Boolean (kernel/hybrid): corefine, then recover on its mesh; exact B-rep, certified mesh or a named refusal.',
  },
};

export function prototype(name) {
  const p = PROTOTYPES[name];
  if (!p) throw new Error(`unknown prototype '${name}' (known: ${Object.keys(PROTOTYPES).join(', ')})`);
  return { name, dir: `kernel/proto/${name}`, gpu: DEFAULT_GPU, ...p };
}
