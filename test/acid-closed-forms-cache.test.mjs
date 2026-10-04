import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {closedFormIdentity, cachedClosedForms} from '../scripts/acid/closed-forms-cache.mjs';

test('closed forms cache keys transitive imports and refuses damaged entries', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-cf-'));
  try {
    const put = (name, data) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive:true}); fs.writeFileSync(file, data); return file; };
    put('scripts/acid/closed-form-inputs.py', fs.readFileSync(new URL('../scripts/acid/closed-form-inputs.py', import.meta.url)));
    const source = put('scripts/acid/closed-forms.py', 'import measure\n');
    const extension = put('scripts/acid/closed-forms-errata.py', 'import extension_dependency\n');
    const extensionDependency = put('scripts/acid/extension_dependency.py', 'value = 1\n');
    const imported = put('scripts/acid/measure.py', 'from spline_fit import fit\n');
    const transitive = put('scripts/acid/spline_fit.py', 'def fit(): pass\n');
    const catalog = put('catalog.json', '{}');
    const env = put('pyproject.toml', '[project]\nname="cf"\nversion="0.0.1"\n');
    const identity = () => closedFormIdentity(root, catalog);
    const first = identity();
    for (const file of [catalog, source, imported, transitive, env, extension, extensionDependency]) {
      const bytes = fs.readFileSync(file);
      fs.appendFileSync(file, file === catalog ? ' ' : '\n');
      assert.notEqual(identity().key, first.key, file);
      fs.writeFileSync(file, bytes);
    }
    let computations = 0;
    const out = path.join(root, 'output');
    const execute = (command, args) => { assert.equal(args[3], extension); computations++; fs.rmSync(out, {recursive:true, force:true}); put('output/command.log', 'all checks pass\n'); put('output/nested/check.json', '{}\n'); return {ok:true,status:0,signal:null}; };
    const run = () => cachedClosedForms({root,catalog,out,execute,identity:first});
    assert.equal(run().reused, false);
    const original = fs.readFileSync(path.join(out, 'command.log'));
    fs.writeFileSync(path.join(out, 'command.log'), 'old run');
    assert.equal(run().reused, true);
    assert.deepEqual(fs.readFileSync(path.join(out, 'command.log')), original);
    const entry = path.join(root, 'tmp/acid-cache/closed-forms', first.key);
    for (const corruption of ['', 'edited']) {
      fs.writeFileSync(path.join(entry, 'files/command.log'), corruption);
      assert.equal(run().reused, false);
      assert.deepEqual(fs.readFileSync(path.join(out, 'command.log')), original);
    }
    fs.unlinkSync(path.join(entry, 'manifest.json'));
    assert.equal(run().reused, false);
    fs.writeFileSync(`${entry}.lock`, '2147483647');
    assert.equal(run().reused, true, 'stale PID lock reclaimed');
    assert.equal(computations, 4);
    assert.equal(fs.existsSync(`${entry}.lock`), false);
  } finally { fs.rmSync(root, {recursive:true,force:true}); }
});

test('concurrent misses execute once and publish complete files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-cf-flight-'));
  try {
    const module = new URL('../scripts/acid/closed-forms-cache.mjs', import.meta.url).href;
    const worker = path.join(root, 'worker.mjs');
    fs.writeFileSync(worker, `import {cachedClosedForms} from ${JSON.stringify(module)};\nimport fs from 'node:fs';\nconst root=process.argv[2], out=root+'/out-'+process.pid;\ncachedClosedForms({root,out,identity:{key:'test',python:'unused'},execute:()=>{fs.appendFileSync(root+'/count','x');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,200);fs.mkdirSync(out);fs.writeFileSync(out+'/command.log','complete');return {ok:true};}});`);
    const driver = `const {spawn}=require('node:child_process'); Promise.all(Array.from({length:4},()=>new Promise((resolve,reject)=>{const p=spawn(process.execPath,[${JSON.stringify(worker)},${JSON.stringify(root)}],{stdio:'inherit'});p.on('exit',c=>c===0?resolve():reject(Error('worker '+c)));}))).catch(e=>{console.error(e);process.exitCode=1;});`;
    const r = spawnSync(process.execPath, ['-e', driver], {encoding:'utf8'});
    assert.equal(r.status, 0, r.stderr);
    assert.equal(fs.readFileSync(path.join(root,'count'),'utf8'), 'x');
    for (const name of fs.readdirSync(root).filter(n=>n.startsWith('out-'))) assert.equal(fs.readFileSync(path.join(root,name,'command.log'),'utf8'), 'complete');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});
