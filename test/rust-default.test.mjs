import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
function isolated(run) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'rust-default-'));
  try {
    // Baseline regressions must fail BEFORE the retired kernel can be loaded.
    const deny=path.join(dir,'deny-bend.mjs');
    fs.writeFileSync(deny,`import {registerHooks} from 'node:module';
      registerHooks({load(url,context,next){
        if(url.startsWith('data:')||/\\.bend(?:[?#]|$)|\\/bend2\\/main\\.ts$/.test(url))throw new Error('BEND_LOAD_FORBIDDEN');
        return next(url,context);
      }});`);
    const env={...process.env,NODE_OPTIONS:'--max-old-space-size=8192',WONKY_BEND_GUARD_LOG:path.join(dir,'guard.json')};
    delete env.WONKY_BACKEND;
    const invoke=(args,extra={})=>spawnSync(process.execPath,['--import',deny,'--import',path.join(root,'scripts/r20/bend-guard.mjs'),...args],
      {cwd:root,encoding:'utf8',timeout:60000,env:{...env,...extra}});
    run({dir,invoke});
    assert.equal(JSON.parse(fs.readFileSync(env.WONKY_BEND_GUARD_LOG,'utf8')).summary.bendLoaded,false);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
}

test('unset backend builds and exports on Rust with binary64 input precision',()=>isolated(({invoke})=>{
  const script=`
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import {selectBackend,openKernel,isStrictRustKernel} from './src/native/backend.mjs';
    assert.equal(selectBackend(),'rust');
    const {real}=await import('./src/real.mjs');
    const {vector}=await import('./src/kernel.mjs');
    assert.equal(real(0.1).hi,0.1);assert.equal(real(0.1).lo,0);
    assert.equal(vector([0.1,0,0]).x,0.1);
    assert.equal(isStrictRustKernel(await openKernel()),true);
    const {build}=await import('./src/index.mjs');
    const {toStep}=await import('./src/exporters.mjs');
    const source=fs.readFileSync('./test/fixtures/rust-host/segment-controls.fs','utf8');
    const model=await build(source,{feature:'segmentControl',parameters:{control:'SegmentControl.CLOSED'},trace:false});
    assert.equal(model.backend.language,'Rust');assert.equal(model.bodies.length,1);
    assert(Math.abs(model.bodies[0].validation.volumeMm3-512)<=512e-9);
    assert.match(toStep(model),/ISO-10303-21/);
  `;
  const result=invoke(['--input-type=module','-e',script]);
  assert.equal(result.status,0,result.stderr);
}));

test('unset backend refuses a missing Rust addon instead of loading Bend',()=>isolated(({dir,invoke})=>{
  const script=`import assert from 'node:assert/strict';
    const {loadKernel}=await import('./src/kernel.mjs');
    await assert.rejects(loadKernel(),error=>error.code==='BX_LOAD'&&/no Rust kernel build/.test(error.message));`;
  const result=invoke(['--input-type=module','-e',script],{WONKY_RUST_CACHE:path.join(dir,'missing')});
  assert.equal(result.status,0,result.stderr);
}));

// tea-box-F.fs (the former input here) builds since its rounded boxes subtract as one prism stack
// (fillets3d F2b); a loft without profiles is a refusal by the operation's own contract.
test('CLI modeling refusal with unset backend uses the documented human-mode exit code',()=>isolated(({dir,invoke})=>{
  const source=path.join(dir,'loft.fs');
  fs.writeFileSync(source,`FeatureScript 3044;
    import(path : "onshape/std/geometry.fs", version : "3044.0");
    export const teaBox = defineFeature(function(context is Context, id is Id, definition is map) {
      opLoft(context, id + "loft", {"profileSubqueries": []});
    });`);
  const result=invoke(['bin/wonky.mjs',source,'--feature','teaBox','--check']);
  assert.match(result.stderr,/wonky: \S*loft\/two-profiles-required\S* op=opLoft feature=teaBox/);
  assert.equal(result.stdout,'');
  assert.equal(result.status,2,result.stderr);
}));

test('CLI check-only R20 export succeeds on Rust without loading Bend',()=>isolated(({dir,invoke})=>{
  const source=path.join(dir,'named-box.fs');
  fs.writeFileSync(source,`FeatureScript 3044;
    import(path : "onshape/std/geometry.fs", version : "3044.0");
    export const namedBox = defineFeature(function(context is Context, id is Id, definition is map) {
      fCuboid(context, id + "box", {"corner1": vector(0,0,0)*millimeter, "corner2": vector(8,8,8)*millimeter});
      setProperty(context, {"entities": qCreatedBy(id + "box", EntityType.BODY), "propertyType": PropertyType.NAME, "value": "box"});
    });`);
  const result=invoke(['bin/wonky.mjs',source,'--feature','namedBox','--format','r20-check','--check']);
  assert.match(result.stdout,/6 faces .*512 mm³/);
  assert.equal(result.stderr,'');
  assert.equal(result.status,0,result.stderr);
}));

test('CLI help with unset backend needs neither a Rust addon nor Bend',()=>isolated(({dir,invoke})=>{
  const result=invoke(['bin/wonky.mjs','--help','--json'],{WONKY_RUST_CACHE:path.join(dir,'missing')});
  assert.equal(result.status,0,result.stderr);
  const report=JSON.parse(result.stdout);
  assert.equal(report.schema,'wonky-cli/v1');
  assert.equal(report.status,'ok');
  assert.equal(report.backend.selected,'rust');
  assert.match(report.help,/Usage:/);
}));
