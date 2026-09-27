import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("python-khana-checks.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { spawnSync } = await import("node:child_process");
const { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { buildPython } = await import("../src/python.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");
// cad_khana check()/inspect() inside a build (decision 12, 2026-09-24): a
// capability error by default; with the opt-in --khana-checks=skip each call
// is recorded as NOT RUN (location and arguments) in brep.json and the CLI
// summary, and its result refuses every use, so a build is never reported as
// if the checks had passed. Python runs through `uv run`, never a bare python3.










const root = fileURLToPath(new URL('../', import.meta.url));
const workspace = realpathSync(mkdtempSync(join(tmpdir(), 'wonky-python-khana-checks-')));
const python = join(workspace, 'uv-python');
writeFileSync(python, '#!/bin/sh\nexec uv run --no-project --quiet python "$@"\n');
chmodSync(python, 0o755);
test.after(() => rmSync(workspace, { recursive: true, force: true }));

let serial = 0;
const model = text => {
  const directory = join(workspace, `m${++serial}`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'assembly.py'), text);
  return join(directory, 'assembly.py');
};
const run = (file, options = {}) => buildPython(readFileSync(file, 'utf8'), { filename: file, python, ...options });
const capability = (pattern, line) => error => {
  assert.ok(error instanceof UnsupportedFeatureError, `${error.name}: ${error.message}`);
  assert.match(error.message, pattern);
  if (line !== undefined) assert.equal(error.line, line);
  return true;
};

const ASSEMBLY = [
  'from pathlib import Path',
  'from build123d import Box, Pos',
  'from cad_khana.mechanism.assembly import Assembly',
  'from cad_khana.mechanism.check import check',
  'from cad_khana.printability.inspect import inspect',
  'from cad_khana.printability.methods import FDM',
  'base = Box(20, 20, 4)',
  'assembly = (Assembly().with_part("base", base).with_part("lid", Box(20, 20, 2), location=Pos(0, 0, 10))',
  '            .assert_no_interference("base", "lid"))',
].join('\n') + '\n';

test('by default check() and inspect() stay capability errors that name the opt-in flag', async () => {
  const file = model(`${ASSEMBLY}check(assembly, out="outputs")\n`);
  await assert.rejects(run(file), capability(
    /^cad_khana\.mechanism\.check\.check\(\) is a cad_khana diagnostic that wonky does not provide: .*bin\/wonky-python\.mjs --khana-checks=skip records the call as not run instead; see docs\/python-khana\.md$/, 10));
  await assert.rejects(run(model(`${ASSEMBLY}inspect(base, method=FDM(), out="outputs", name="base")\n`), { khanaChecks: 'refuse' }),
    capability(/^cad_khana\.printability\.inspect\.inspect\(\) is a cad_khana diagnostic/, 10));
  await assert.rejects(run(file, { khanaChecks: 'yes' }), /khanaChecks must be 'refuse' or 'skip'/);
});

test('--khana-checks=skip records every call as not run, with its location and arguments', async () => {
  const file = model(`${ASSEMBLY}if __name__ == "__main__":
    check(assembly, out="outputs")
    for name in ("base",):
        inspect(base, method=FDM(wall_min_mm=0.8), name=name, out=Path("checks"))
    print(repr(check(assembly)))
`);
  const built = await run(file, { khanaChecks: 'skip' });
  assert.equal(built.source.result, 'assembly');
  assert.deepEqual(built.bodies.map(body => body.name), ['base', 'lid']);
  assert.equal(built.execution.stdout.trim(), '<cad_khana.mechanism.check.check() not run: no wonky equivalent yet>');
  const { mode, notRun } = built.source.khanaChecks;
  assert.equal(mode, 'skip');
  assert.deepEqual(notRun.map(({ call, status, message, location, arguments: args }) => ({ call, status, message, line: location.line, file: location.file, args })), [
    { call: 'cad_khana.mechanism.check.check', status: 'not-run', message: 'cad_khana check() not run: no wonky equivalent yet',
      line: 11, file, args: ['<Assembly: assembly>', "out='outputs'"] },
    { call: 'cad_khana.printability.inspect.inspect', status: 'not-run', message: 'cad_khana inspect() not run: no wonky equivalent yet',
      line: 13, file, args: ['<Box: Shape>', 'method=FDM(up_axis=(0, 0, 1), wall_min_mm=0.8, overhang_max_deg=45.0)', "name='base'", "out='checks'"] },
    { call: 'cad_khana.mechanism.check.check', status: 'not-run', message: 'cad_khana check() not run: no wonky equivalent yet',
      line: 14, file, args: ['<Assembly: assembly>'] },
  ]);
  // The declared assertions stay declared, never evaluated.
  assert.ok(built.source.assembly.assertions.every(assertion => assertion.status === 'declared-not-evaluated'));

  // With the flag and no call reached, the mode is still recorded.
  const quiet = await run(model(ASSEMBLY), { khanaChecks: 'skip' });
  assert.deepEqual(quiet.source.khanaChecks, { mode: 'skip', notRun: [] });
  assert.equal((await run(model(ASSEMBLY))).source.khanaChecks, undefined);
});

test('a skipped check result refuses every use, also inside try/except, so nothing passes by default', async () => {
  const uses = [
    ['diag = inspect(base, method=FDM(), name="base")\nstatus = diag.status\n', /inspect\.inspect\(\) was not run \(--khana-checks=skip at line 10\): its result attribute 'status' is not available, and wonky never reports a skipped check as passed/, 11],
    ['result = check(assembly)\nif not result:\n    raise SystemExit(1)\n', /its result truth value is not available/, 11],
    ['result = check(assembly)\nassert result == "ok"\n', /its result comparison is not available/, 11],
    // cad_khana's coupons.py pattern: the capability is latched, catching it does not help.
    ['try:\n    status = inspect(base, method=FDM(), name="base").status\nexcept Exception:\n    status = "passed"\n', /its result attribute 'status' is not available/, 11],
  ];
  for (const [tail, pattern, line] of uses) {
    await assert.rejects(run(model(ASSEMBLY + tail), { khanaChecks: 'skip' }), capability(pattern, line));
  }
});

test('the host owns the mode and the not-run record: a model can neither switch checks off nor rewrite them', async () => {
  // Without the flag, runtime state set by the model does not turn the call into a skip.
  const flip = model(`${ASSEMBLY}import _wonky_runtime\n_wonky_runtime._khana_checks = "skip"\n_wonky_runtime.khana_checks = "skip"\nr = check(assembly)\n`);
  await assert.rejects(run(flip), capability(/^cad_khana\.mechanism\.check\.check\(\) is a cad_khana diagnostic/, 13));
  // With the flag, the model's copy of the entry is not the record: clearing or forging it changes nothing.
  const forged = model(`${ASSEMBLY}import _wonky_runtime
r = inspect(base, method=FDM(), name="base")
entry = object.__getattribute__(r, "_wonky_entry")
entry["status"] = "passed"
entry["message"] = "cad_khana inspect() passed"
for name in ("_skipped_checks", "skipped_checks"):
    getattr(_wonky_runtime, name, []).clear()
`);
  const built = await run(forged, { khanaChecks: 'skip' });
  assert.deepEqual(built.source.khanaChecks.notRun.map(({ status, message, location }) => [status, message, location.line]),
    [['not-run', 'cad_khana inspect() not run: no wonky equivalent yet', 11]]);
  // A malformed request (e.g. sent by hand) is refused, never recorded as anything else.
  const bogus = model(`${ASSEMBLY}import build123d\nbuild123d._request("khana_check", call="os.system", what="x", site=None, arguments=[])\n`);
  await assert.rejects(run(bogus, { khanaChecks: 'skip' }), /Invalid cad_khana check request/);
});

test('CLI --khana-checks=skip prints each call as NOT RUN and says the build is not checked', () => {
  const file = model(`${ASSEMBLY}if __name__ == "__main__":\n    check(assembly, out="outputs")\n`);
  const prefix = join(workspace, 'cli', 'assembly');
  const cli = args => spawnSync(process.execPath, [join(root, 'bin/wonky-python.mjs'), file, '--python', python, ...args],
    { cwd: root, encoding: 'utf8' });
  const skipped = cli(['--khana-checks=skip', '--out', prefix]);
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.match(skipped.stdout, /^cad_khana check\(\) not run: no wonky equivalent yet \(assembly\.py:11: check\(<Assembly: assembly>, out='outputs'\)\)$/m);
  assert.match(skipped.stdout, /^--khana-checks=skip: 1 cad_khana check\/inspect call\(s\) NOT RUN; this build is not checked$/m);
  const brep = JSON.parse(readFileSync(`${prefix}.brep.json`, 'utf8'));
  assert.deepEqual(brep.source.khanaChecks.notRun.map(entry => [entry.status, entry.location.line]), [['not-run', 11]]);
  // The spaced form works too; the default refuses; an unknown mode is a usage error.
  assert.equal(cli(['--khana-checks', 'skip', '--check']).status, 0);
  const refused = cli(['--check']);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /assembly\.py:11:5: cad_khana\.mechanism\.check\.check\(\) is a cad_khana diagnostic/);
  const wrong = cli(['--khana-checks=pass', '--check']);
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /--khana-checks expects refuse or skip/);
});

}
