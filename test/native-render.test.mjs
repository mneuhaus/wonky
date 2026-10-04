import test from 'node:test';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync,existsSync,cpSync,mkdirSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {renderKey,rendererPaths} from '../src/native/render-build-key.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
import {renderOptions,featureEdgeIndices} from '../src/native/render.mjs';

test('render options preserve requested tile order and refuse invalid requests',()=>{
  assert.deepEqual(renderOptions({views:'top,front',atlas:'2',resolution:'257x193'}),{views:['top','front'],atlas:2,resolution:[257,193],perspective:false});
  for(const options of [{views:'banana'},{views:''},{atlas:0},{resolution:'5x5'},{resolution:'4096x4096',atlas:16},{camera:'fisheye'}])assert.throws(()=>renderOptions(options),e=>e.reason?.startsWith('render/'));
});
test('FeatureScript PNG CLI draws all B-rep edges and deterministically renders requested views',t=>{
  const dir=mkdtempSync(join(tmpdir(),'wonky-render-cli-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const cases=[['examples/tea-box.fs',[]],['fixtures/render/servo-slide-v5.fs',['--feature','jawSlideMount']],
    ['fixtures/cad-acid/fs/acid-curved.fs',['--feature','acidCurved','--param','zone=AcidCurvedZone.AC21','--param','variant=AcidVariant.V0']],
    ['fixtures/cad-acid/fs/acid-fit-spline.fs',['--feature','acidSplinesA','--param','zone=AcidSplinesAZone.AC101','--param','variant=AcidVariant.V0']],
    ['fixtures/cad-acid/fs/acid-shapes-a.fs',['--feature','acidShapesA','--param','zone=AcidShapesAZone.AC81','--param','variant=AcidVariant.V0']]];
  for(const [file,extra] of cases) {
  const reports=[];
  for(const name of ['a','b']) {
    const run=spawnSync(process.execPath,['bin/wonky.mjs',file,...extra,'--format','png','--out',join(dir,name),'--resolution','128x128','--json'],{encoding:'utf8',env:{...process.env,WONKY_BACKEND:'rust'},timeout:120000});
    if(run.stderr)process.stderr.write(run.stderr);
    assert.ifError(run.error);assert.equal(run.status,0);const r=JSON.parse(run.stdout);assert.equal(r.schema,'wonky-cli/v1');
    const o=r.outputs[0];assert.equal(o.format,'png');assert.equal(o.edges,r.bodies.reduce((n,b)=>n+b.topology.edges,0));assert.equal(o.exact,false);assert.equal(o.deviationMm,0.02);assert.equal(o.edgeSource,'exact-brep');assert.ok(o.triangles>0);assert.equal(o.views.length,4);assert.ok(o.silhouette_bounds_px.every(Boolean));
    for(const key of ['tessellate','upload','render','readback','encode'])assert.ok(Number.isFinite(o.timingsMs[key]));
    const min=[0,1,2].map(k=>Math.min(...r.bodies.map(b=>b.bboxMm.min[k])));
    const max=[0,1,2].map(k=>Math.max(...r.bodies.map(b=>b.bboxMm.max[k])));
    for(let view=0;view<3;view++) {
      const axes=[[0,2],[1,2],[0,1]][view],w=max[axes[0]]-min[axes[0]],h=max[axes[1]]-min[axes[1]];
      const scale=Math.min(128/w,128/h)/1.1;
      const expected=[(128-w*scale)/2,(128-h*scale)/2,(128+w*scale)/2,(128+h*scale)/2];
      assert.ok(o.silhouette_bounds_px[view].every((p,k)=>Math.abs(p-expected[k])<=1),`file ${file} view ${view} silhouette ${o.silhouette_bounds_px[view]} bounds ${expected}`);
    }
    reports.push(o);
  }
  assert.deepEqual(readFileSync(reports[0].path),readFileSync(reports[1].path));
  }
});

test('chart seams are excluded by topology, material edges remain',()=>{
  const body={edges:[{},{},{}],faces:[{loops:[0]},{loops:[1]},{loops:[2]}],loops:[{coedges:[0]},{coedges:[1]},{coedges:[2,3,4,5]}],coedges:[{edge:0,forward:false},{edge:1,forward:true},{edge:0,forward:true},{edge:2,forward:true},{edge:1,forward:false},{edge:2,forward:false}]};
  assert.deepEqual(featureEdgeIndices(body),[0,1]);
});

test('existing STL and admitted STEP render via CLI; malformed STEP refuses and retires stale PNG',t=>{
  const dir=mkdtempSync(join(tmpdir(),'wonky-render-import-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const run=args=>{
    const r=spawnSync(process.execPath,['bin/wonky.mjs',...args,'--json'],{encoding:'utf8',env:{...process.env,WONKY_BACKEND:'rust'},timeout:120000});
    if(r.stderr)process.stderr.write(r.stderr);assert.ifError(r.error);return {exit:r.status,report:JSON.parse(r.stdout)};
  };
  const exported=run(['examples/tea-box.fs','--format','stl','--out',join(dir,'source')]);assert.equal(exported.exit,0);
  const stl=run(['render',join(dir,'source.stl'),'--out',join(dir,'stl'),'--views','right,top','--atlas','1','--resolution','128x96']);
  assert.equal(stl.exit,0);const o=stl.report.outputs[0];assert.equal(o.edgeSource,'unavailable-in-stl');assert.equal(o.edges,0);assert.equal(o.width,128);assert.equal(o.height,192);assert.deepEqual(o.views.map(v=>v.view),['right','top']);assert.ok(o.silhouette_bounds_px.every(Boolean));
  const step=run(['render','fixtures/step-import/tetra-si.step','--out',join(dir,'step'),'--resolution','64x64']);
  assert.equal(step.exit,0);assert.equal(step.report.outputs[0].edges,6);
  const invalid=join(dir,'invalid.step');writeFileSync(invalid,'not STEP');
  const bad=run(['render',invalid,'--out',join(dir,'step')]);assert.equal(bad.exit,2);assert.match(bad.report.refusals[0].code,/^import\//);assert.equal(existsSync(join(dir,'step.png')),false);
});
test('frozen servo v5 bytes match recorded provenance',()=>{
  const p=JSON.parse(readFileSync('fixtures/render/provenance.json'));
  assert.equal(createHash('sha256').update(readFileSync('fixtures/render/servo-slide-v5.fs')).digest('hex'),p.files['servo-slide-v5.fs'].sha256);
});

test('standard addon cache hit repairs a missing renderer without deleting kernel artifacts and then reuses it',t=>{
  const key=renderKey(root),{manifest}=rendererPaths(root,key);
  const cache=mkdtempSync(join(tmpdir(),'wonky-render-repair-'));
  t.after(()=>rmSync(cache,{recursive:true,force:true}));
  const dir=join(cache,'render',key.sourceHash);mkdirSync(dir,{recursive:true});
  cpSync(manifest,join(dir,'manifest.json')); // Deliberately omit the binary.
  const args=['scripts/rust/build-node.mjs','--cache',process.env.WONKY_RUST_CACHE??join(root,'tmp/rust/cache')];
  // Populate real kernel Cargo artifacts, not sentinels. A renderer cache
  // miss must preserve them so the Boolean oracle can reuse its dependencies.
  const target=resolve(root,'rust',process.env.CARGO_TARGET_DIR??'target');
  const kernel=spawnSync('cargo',['build','--release','--offline','--locked','-p','wonky-ops'],
    {cwd:join(root,'rust'),encoding:'utf8',env:{...process.env,CARGO_TARGET_DIR:target}});
  if(kernel.stderr)process.stderr.write(kernel.stderr);
  assert.ifError(kernel.error);assert.equal(kernel.status,0,kernel.stdout);
  const deps=join(target,'release/deps');
  const artifacts=readdirSync(deps).filter(name=>/^libwonky_ops-.*\.rlib$/.test(name))
    .map(name=>({file:join(deps,name),hash:createHash('sha256').update(readFileSync(join(deps,name))).digest('hex')}));
  assert.ok(artifacts.length>0,'no real kernel archive to test');
  const options={encoding:'utf8',timeout:300000,env:{...process.env,CARGO_TARGET_DIR:target,WONKY_RUST_CACHE:cache}};
  const r=spawnSync(process.execPath,args,options);
  if(r.stderr)process.stderr.write(r.stderr);
  assert.ifError(r.error);assert.equal(r.status,0,r.stdout);
  const report=JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(report.cached,true);
  assert.equal(report.renderer.cached,false);
  assert.equal(report.renderer.sourceHash,key.sourceHash);
  for(const {file,hash} of artifacts){assert.ok(existsSync(file),`renderer deleted kernel artifact ${file}`);assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'),hash,'renderer changed kernel artifact');}
  const again=spawnSync(process.execPath,args,options);
  if(again.stderr)process.stderr.write(again.stderr);
  assert.ifError(again.error);assert.equal(again.status,0,again.stdout);
  const cached=JSON.parse(again.stdout.trim().split('\n').at(-1));
  assert.equal(cached.cached,true);assert.equal(cached.renderer.cached,true);
});

test('stale and malformed renderer manifests refuse and retire an existing PNG',async t=>{
  const {renderNative}=await import('../src/native/render.mjs');
  const key=renderKey(root),built=rendererPaths(root,key);
  const dir=mkdtempSync(join(tmpdir(),'wonky-render-stale-'));
  const previousCache=process.env.WONKY_RUST_CACHE;
  process.env.WONKY_RUST_CACHE=join(dir,'cache');
  const {manifest,dir:artifactDir,pointer}=rendererPaths(root,key);
  cpSync(built.dir,artifactDir,{recursive:true});
  writeFileSync(pointer,JSON.stringify({sourceHash:key.sourceHash}));
  const original=readFileSync(manifest);
  t.after(()=>{if(previousCache===undefined)delete process.env.WONKY_RUST_CACHE;else process.env.WONKY_RUST_CACHE=previousCache;rmSync(dir,{recursive:true,force:true});});
  for(const altered of [JSON.stringify({...JSON.parse(original),sourceHash:'0'.repeat(64)}),'{broken','null']) {
    writeFileSync(manifest,altered);
    const output=join(dir,'old.png');writeFileSync(output,'previous output');
    await assert.rejects(renderNative({},output),e=>e.reason==='render/build-stale');
    assert.equal(existsSync(output),false);
  }
  writeFileSync(manifest,original);
});
