import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("hybrid-entry.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: path } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { loadBend } = await import("../src/bend-loader.mjs");
const { loadJsKernel } = await import("../src/kernel.mjs");
const { buildCase, ensureJobs } = await import("../scripts/bakeoff/fixtures.mjs");
const { decodeHybrid, decodeJob, decodeResult, encodeJob } = await import("../scripts/bakeoff/jobfmt.mjs");
const { decodeRecover } = await import("../scripts/bakeoff/recover-brep.mjs");
const { bendSources } = await import("../scripts/bakeoff/run.mjs");
const { prototype, PROTOTYPES } = await import("../scripts/bakeoff/prototypes.mjs");
const { checkOne } = await import("../scripts/bakeoff/hybrid-check.mjs");
// The hybrid Boolean entry kernel/hybrid/main.bend (docs/hybrid-boolean-plan.md
// section 8, step 5): corefine, then recover on its mesh, as one Bend call on
// the JS target. Checks that the entry is the two stages run in sequence byte
// for byte, the three answers and their classes, the bake-off registration and
// the kernel loader. Budget: about a minute (the loader test loads the whole
// JS kernel).















const root = fileURLToPath(new URL('../', import.meta.url));
const hybrid = await loadBend(path.join(root, 'kernel/hybrid/main.bend'));
const corefine = await loadBend(path.join(root, 'kernel/hybrid/corefine/main.bend'));
const recover = await loadBend(path.join(root, 'kernel/hybrid/recover/main.bend'));

const corpusJob = (id) => fs.readFileSync(ensureJobs([id])[id].job, 'utf8');
const advCases = ['adversarial-corefine', 'adversarial-recover']
  .flatMap((f) => JSON.parse(fs.readFileSync(path.join(root, `fixtures/bakeoff/${f}.json`), 'utf8')).cases);
const advJob = (id) => encodeJob(buildCase(advCases.find((c) => c.id === id)).job);
// The two stages as the bake-off runs them: corefine on the job, recover on
// the job followed by corefine's result text.
const stages = (job) => {
  const mesh = corefine.run(job);
  return { mesh, brep: mesh.startsWith('ok\n') ? recover.run(job + mesh) : null };
};

test('exact: the recovered B-rep of corefine\'s mesh, recover\'s text after `exact`', () => {
  for (const id of ['box-union-overlap', 'plate-blind-pocket']) {
    const job = corpusJob(id);
    const out = hybrid.boolean(job);
    const { brep } = stages(job);
    assert.ok(brep.startsWith('ok\n'), brep.slice(0, 200));
    assert.equal(out, `exact\n${brep.slice(3)}`, id);
    const h = decodeHybrid(out);
    assert.equal(h.status, 'exact');
    assert.equal(decodeRecover(h.okText).status, 'ok');
    assert.equal(hybrid.run(job), out, 'run and boolean are the same entry');
  }
});

test('mesh: recover refuses the exact curves, the certified mesh stays, labelled with the job deviation', () => {
  const job = corpusJob('steinmetz-union');
  const out = hybrid.boolean(job);
  const { mesh, brep } = stages(job);
  const reason = brep.split('\n', 1)[0].replace(/^unresolved /, '');
  const [first, ...rest] = out.split('\n');
  const m = /^mesh (\d+) (\d+) (.*)$/.exec(first);
  assert.ok(m, first);
  assert.equal(m[3], reason);
  assert.match(reason, /patches of only 2 distinct carriers meet/);
  assert.equal(rest.join('\n'), mesh.slice(3), 'the mesh body is corefine\'s, byte for byte');
  const h = decodeHybrid(out);
  assert.equal(h.status, 'mesh');
  assert.equal(h.deviationMm, decodeJob(job).deviation);
  assert.deepEqual(h.mesh, decodeResult(mesh).mesh);
});

test('unresolved: corefine\'s refusal, the pre-certificate and recover\'s mesh certificates', () => {
  // corefine refuses a point contact itself; recover never runs.
  const touch = advJob('adv-cube-vertex-touch');
  assert.equal(hybrid.boolean(touch), corefine.run(touch));
  assert.match(hybrid.boolean(touch), /^unresolved non-manifold contact \(point\)\n/);
  // A tool that grazes the target below the deviation: corefine answers the
  // untouched target, recover's pre-certificate refuses; no mesh is kept.
  const graze = advJob('adv4-cyl-shave-tilt-1e-8rad');
  const g = stages(graze);
  assert.ok(g.mesh.startsWith('ok\n'));
  assert.equal(hybrid.boolean(graze), g.brep);
  assert.match(g.brep, /^unresolved leaf faces on a cylinder carrier and a plane carrier .* without touching/);
  // A sealed void under a 1e-11 mm skin: corefine's two shells are closer than
  // the clearance, recover's clearance certificate refuses; no mesh is kept.
  const skin = advJob('adv-skin-void-rot-1e-11');
  const s = stages(skin);
  assert.ok(s.mesh.startsWith('ok\n'));
  assert.equal(hybrid.boolean(skin), s.brep);
  assert.match(s.brep, /the mesh does not certify their topology/);
  // A cone shaved 0.1 mm deep: recover finds a corner's exact vertex 0.124 mm
  // from the mesh, beyond its bound; the mesh would not meet its stated
  // deviation there, so it is not kept.
  const shave = advJob('adv3-cone-side-shave-phase0');
  const v = stages(shave);
  assert.ok(v.mesh.startsWith('ok\n'));
  assert.match(v.brep, /^unresolved mesh vertex \d+: exact vertex is 0\.12\d* mm from the mesh \(bound 0\.1/);
  assert.equal(hybrid.boolean(shave), v.brep);
  assert.match(hybrid.boolean('wonky-bakeoff-job 1\ncase x\n'), /^unresolved malformed-job /);
});

test('hybrid-check reads the three answers off the two prototypes\' texts', () => {
  const mesh = 'ok\nmesh 3 1\n0 0 0 0 0 0\n1 0 0 0 0 0\n0 1 0 0 0 0\n0 1 2 0\nend\n';
  assert.deepEqual(checkOne('unresolved a\nend\n', 'unresolved a\nend\n', null), { kind: 'corefine-unresolved', ok: true, cls: 'unresolved' });
  assert.equal(checkOne('exact\nbrep 0 0 0 0\nend\n', mesh, 'ok\nbrep 0 0 0 0\nend\n').ok, true);
  assert.equal(checkOne('exact\nbrep 0 0 0 1\nend\n', mesh, 'ok\nbrep 0 0 0 0\nend\n').ok, false);
  const refused = 'unresolved no curve\nend\n';
  assert.equal(checkOne(refused, mesh, refused).cls, 'unresolved');
  const kept = checkOne(`mesh 1 2 no curve\n${mesh.slice(3)}`, mesh, refused);
  assert.deepEqual([kept.ok, kept.cls], [true, 'mesh']);
  assert.equal(checkOne(`mesh 1 2 other reason\n${mesh.slice(3)}`, mesh, refused).ok, false);
});

test('bake-off: hybrid is registered; corefine and recover stay runnable over the moved code', () => {
  const p = prototype('hybrid');
  assert.deepEqual([p.dir, p.input, p.output], ['kernel/proto/hybrid', 'mesh', 'hybrid']);
  for (const name of ['corefine', 'recover', 'hybrid']) assert.ok(PROTOTYPES[name]);
  const own = bendSources('kernel/proto/hybrid/native.bend');
  for (const f of ['kernel/hybrid/main.bend', 'kernel/hybrid/corefine/main.bend', 'kernel/hybrid/recover/main.bend', 'kernel/hybrid/unify.bend', 'kernel/hybrid/mesh-io.bend']) {
    assert.ok(own.includes(f), f);
  }
  assert.ok(!own.some((f) => f.startsWith('kernel/proto/corefine/') || f.startsWith('kernel/proto/recover/')));
  for (const name of ['corefine', 'recover']) {
    const files = bendSources(`kernel/proto/${name}/native.bend`);
    assert.ok(files.includes(`kernel/hybrid/${name}/main.bend`), name);
    assert.ok(!files.some((f) => f.startsWith('kernel/proto/') && !f.startsWith(`kernel/proto/${name}/`)), name);
  }
  // The other prototypes read the same wire format through symlinks.
  for (const f of ['mesh.bend', 'mesh-io.bend']) {
    assert.equal(fs.realpathSync(path.join(root, 'kernel/proto', f)), fs.realpathSync(path.join(root, 'kernel/hybrid', f)));
  }
  assert.ok(!fs.existsSync(path.join(root, 'kernel/proto/unify.bend')));
});

test('loadJsKernel exposes hybrid.boolean', async () => {
  const kernel = await loadJsKernel();
  assert.equal(typeof kernel.hybrid.boolean, 'function');
  const job = corpusJob('box-union-overlap');
  assert.equal(kernel.hybrid.boolean(job), hybrid.boolean(job));
});

}
