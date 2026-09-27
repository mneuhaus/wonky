import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadPrivateTerms, privateTermPattern, assertNoPrivateTerms, redactPrivateTerms } from '../scripts/reports/private-terms.mjs';
import { publicDocument, publicRuns } from '../scripts/acid/public-capture.mjs';

// Owner: the publication boundary. Regressions are substring overmatching,
// unescaped punctuation, stateful regex reuse, and secrets printed in errors.
// Existing report tests only inspect generated pages; no production seam needed.
test('local privacy terms load, match and redact without exposing a match', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-private-terms-'));
  try {
    const file = join(dir, 'terms.txt');
    writeFileSync(file, '# comment\n\nAcme Widgets\nFoo.Bar GmbH\nÄrger & Co\n');
    const terms = loadPrivateTerms(file);
    assert.equal(terms.length, 3);
    const p = privateTermPattern(terms);
    for (const text of ['acme widgets', '(FOO.BAR GMBH)', 'Ärger & Co']) assert.ok(p.test(text));
    for (const text of ['FooXBar GmbH', 'acme widgetsmith', 'XÄrger & Co', 'Ärger & Company']) assert.ok(!p.test(text));
    assert.equal(redactPrivateTerms('acme widgets and Foo.Bar GmbH', '[removed]', privateTermPattern(terms, 'gi')), '[removed] and [removed]');
    const stateful = privateTermPattern(terms, 'gi');
    for (let i = 0; i < 2; i++) assert.throws(() => assertNoPrivateTerms('x acme widgets y', 'test page', stateful), error => {
      assert.ok(!/acme|widgets/i.test(error.message));
      return /Private term \(local list\) in test page/.test(error.message);
    });
    const missingFile = join(dir, 'missing');
    const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { loadPrivateTerms, privateTermPattern, assertNoPrivateTerms } from './scripts/reports/private-terms.mjs';
      import assert from 'node:assert/strict';
      assert.equal(loadPrivateTerms().length, 0);
      assert.equal(privateTermPattern(), null);
      assertNoPrivateTerms('anything', 'page');
    `], { cwd: new URL('../', import.meta.url), encoding: 'utf8', env: { ...process.env, WONKY_PRIVATE_TERMS: missingFile, WONKY_REQUIRE_PRIVATE_TERMS: '0' } });
    assert.equal(run.status, 0, run.stderr);
    const required = spawnSync(process.execPath, ['--input-type=module', '-e', "import { loadPrivateTerms } from './scripts/reports/private-terms.mjs'; loadPrivateTerms();"], {
      cwd: new URL('../', import.meta.url), encoding: 'utf8', env: { ...process.env, WONKY_PRIVATE_TERMS: missingFile, WONKY_REQUIRE_PRIVATE_TERMS: '1' },
    });
    assert.notEqual(required.status, 0);
    assert.match(required.stderr, /private terms file missing/);
    const page = join(dir, 'page.html');
    writeFileSync(page, '<p>acme widgets</p>');
    const planted = spawnSync(process.execPath, ['--input-type=module', '-e', "import { readFileSync } from 'node:fs'; import { assertPublicSafe } from './scripts/reports/lib.mjs'; assertPublicSafe(readFileSync(process.argv[1], 'utf8'));", page], {
      cwd: new URL('../', import.meta.url), encoding: 'utf8', env: { ...process.env, WONKY_PRIVATE_TERMS: file, WONKY_REQUIRE_PRIVATE_TERMS: '1' },
    });
    assert.notEqual(planted.status, 0);
    assert.match(planted.stderr, /Private term \(local list\) in public report/);
    assert.ok(!/acme|widgets/i.test(planted.stdout + planted.stderr));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Owner: persisted capture data. Upstream may add profile fields at any time;
// a denylist would leak them. Offline fixtures do not test future responses.
test('public capture metadata preserves immutable references and drops unknown account fields', () => {
  const input = { id: 'document', public: true, name: 'Synthetic probe', owner: { id: 'private-owner' }, futureAccountField: 'private-data', defaultWorkspace: { id: 'workspace', microversion: 'revision', creator: { id: 'private-owner' }, name: 'Main' } };
  const output = publicDocument(input);
  assert.equal(output.id, input.id);
  assert.equal(output.public, true);
  assert.equal(output.defaultWorkspace.microversion, 'revision');
  assert.equal(Object.keys(output).length, 4);
  assert.equal(Object.keys(output.defaultWorkspace).length, 3);
  assert.ok(!JSON.stringify(output).includes('private-'));
  assert.ok(input.owner);
  const runs = publicRuns([{ startedAt: 'start', variants: ['V0'], finishedAt: 'end', health: { account: 'private-account' }, meterBefore: 7, limitsAfter: 12 }]);
  assert.equal(runs.length, 1);
  assert.equal(Object.keys(runs[0]).length, 3);
  assert.equal(runs[0].variants[0], 'V0');
  assert.ok(!JSON.stringify(runs).includes('private-'));
});
