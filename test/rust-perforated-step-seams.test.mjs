import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
process.env.WONKY_BACKEND = 'rust';
const {build} = await import('../src/index.mjs');
const {rustModelKernel, rustCarriers, measureRustBody} = await import('../src/native/rust-host.mjs');
const source = fs.readFileSync(new URL('../fixtures/step-seams/quarter-arc-bar-bore.fs', import.meta.url), 'utf8');
function run(command, args) {
  const r = spawnSync(command, args, {encoding:'utf8', timeout:180000, maxBuffer:16*1024*1024, env:{...process.env}});
  if(r.stderr) process.stderr.write(r.stderr);
  assert.ifError(r.error);
  assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
  return r.stdout;
}
function checkStl(data, carriers, deviation) {
  assert.match(data.subarray(0,80).toString(),/deviationMm=0.02/);
  const count=data.readUInt32LE(80), edges=new Map();
  assert.ok(count>0); assert.equal(data.length,84+50*count);
  for(let i=0;i<count;i++) {
    const p=Array.from({length:3},(_,j)=>Array.from({length:3},(_,k)=>data.readFloatLE(84+50*i+12+12*j+4*k)));
    const keys=p.map(v=>v.map(x=>Object.is(x,-0)?0:x).join(','));
    assert.equal(new Set(keys).size,3);
    for(let j=0;j<3;j++) {
      const a=keys[j],b=keys[(j+1)%3],key=a<b?`${a}|${b}`:`${b}|${a}`;
      const e=edges.get(key)??[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(key,e);
    }
    const samples=[...p,p[0].map((x,k)=>(x+p[1][k]+p[2][k])/3),...p.map((v,j)=>v.map((x,k)=>(x+p[(j+1)%3][k])/2))];
    // Test the actual float32 artifact against the analytic carriers, rather
    // than assuming the mesh's double coordinates survived STL encoding.
    assert.ok(carriers.some(s=>!s.refused && samples.every(point=>{
      const d=point.map((x,k)=>x-s.origin[k]);
      const axis=s.kind==='plane'?s.normal:s.axis;
      if(!['plane','cylinder'].includes(s.kind))return false;
      const n=Math.hypot(...axis),u=axis.map(x=>x/n),h=d.reduce((a,x,k)=>a+x*u[k],0);
      const distance=s.kind==='plane'?Math.abs(h):Math.abs(Math.hypot(...d.map((x,k)=>x-h*u[k]))-s.radiusMm);
      return distance<=deviation;
    })),`STL triangle ${i} exceeds stated deviation`);
  }
  for(const e of edges.values())assert.deepEqual(e,[2,0]);
}
for(const [name, text, params, notchRadius] of [
  ['quarter',source,{}],
  ['half',source.replace(/        skArc\(sk, "tipA".*\n        skArc\(sk, "tipB".*\n/,
    '        skArc(sk, "tip", { "start" : vector(L, -r), "mid" : vector(L + r, 0 * mm), "end" : vector(L, r) });\n')
    .replace(/        skArc\(sk, "hubA".*\n        skArc\(sk, "hubB".*\n/,
    '        skArc(sk, "hub", { "start" : vector(0 * mm, r), "mid" : vector(-r, 0 * mm), "end" : vector(0 * mm, -r) });\n'),{}],
  ['axis-permuted',source.replace('vector(0, 0, 1), vector(1, 0, 0)', 'vector(1, 0, 0), vector(0, 1, 0)')
    .replaceAll('"direction" : vector(0, 0, 1)','"direction" : vector(1, 0, 0)')
    .replace('vector(holes[i][0], 0 * mm, -1 * mm)','vector(-1 * mm, holes[i][0], 0 * mm)')
    .replace('vector(holes[i][0], 0 * mm, definition.thick + 1 * mm)','vector(definition.thick + 1 * mm, holes[i][0], 0 * mm)'),{}],
  ['resized',source,{endR:'7*millimeter',armL:'18*millimeter',thick:'4*millimeter'}],
  ['side-crossing hub bore',source,{boreD:'12*millimeter'},6],
]) test(`${name}: CLI exports every output, certified STL and OCCT-valid analytic STEP`, async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wonky-step-seams-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const input=path.join(dir,'input.fs'),prefix=path.join(dir,'model');fs.writeFileSync(input,text);
  const args=['bin/wonky.mjs',input,'--out',prefix,'--json'];
  for(const [k,v] of Object.entries(params))args.push('--param',`${k}=${v}`);
  const report=JSON.parse(run(process.execPath,args));
  assert.equal(report.status,'ok');assert.deepEqual(report.skipped,[]);assert.deepEqual(report.refusals,[]);
  for(const ext of ['brep.json','step','stl','html'])assert.ok(fs.existsSync(`${prefix}.${ext}`),ext);
  assert.equal(report.outputs.length,4);
  const model=await build(text,{feature:'jawCrank',parameters:params});
  const kernel=rustModelKernel(model),carriers=rustCarriers(kernel,model.bodies)[0].faces;
  const stl=fs.readFileSync(prefix+'.stl');
  checkStl(stl,carriers,0.02);
  if(name==='quarter') {
    const open=Buffer.from(stl.subarray(0,stl.length-50));
    open.writeUInt32LE(stl.readUInt32LE(80)-1,80);
    assert.throws(()=>checkStl(open,carriers,0.02),assert.AssertionError,'planted missing facet must fail watertightness');
    const displaced=Buffer.from(stl);
    for(let j=0;j<3;j++)for(let k=0;k<3;k++)displaced.writeFloatLE(10000+j*100+k,84+12+12*j+4*k);
    assert.throws(()=>checkStl(displaced,carriers,0.02),/exceeds stated deviation/,'planted displaced facet must fail deviation');
  }
  const step=fs.readFileSync(prefix+'.step','utf8');
  assert.equal((step.match(/SEAM_CURVE\(/g)??[]).length,notchRadius?0:1,'only a closed bore has a periodic seam');
  assert.doesNotMatch(step,/B_SPLINE_SURFACE|FACETED_BREP/);
  const [validation]=JSON.parse(run('uv',['run','scripts/validate-step.py',prefix]));
  assert.equal(validation.valid,true);assert.equal(validation.solids,1);
  assert.deepEqual(validation.surfaceTypes,{Plane:4,Cylinder:name==='half'||notchRadius?3:5});
  const [radius,length,height]=name==='resized'?[7,18,4]:[5,12,6.8];
  // For radius 6 the hub half-disk is removed entirely. The rectangle loses
  // integral[-5,5] sqrt(36-y*y) dy = 5sqrt(11)+36asin(5/6); the tip stays.
  const expectedArea=notchRadius?
    2*radius*length+Math.PI*radius**2/2-5*Math.sqrt(11)-36*Math.asin(5/6):
    2*radius*length+Math.PI*(radius**2-2.9**2);
  const expectedVolume=expectedArea*height;
  if(notchRadius) {
    assert.equal(model.bodies.length,1);
    const measured=measureRustBody(kernel,model.bodies[0]);
    assert.deepEqual(measured.validity,{brep:true,closed:true,positive:true});
    assert.equal(measured.boundToConstruction,true);
    assert.equal(measured.topology.genus,0);
    assert.equal(measured.topology.pinchPoints,0);
    assert.equal(measured.topology.singularPoints,0);
    assert.ok(Math.abs(measured.volumeMm3-expectedVolume)<1e-6);
    // Preserve both exact quadratic notch/straight-side contact edges.
    const x=Math.sqrt(11),body=JSON.parse(fs.readFileSync(prefix+'.brep.json','utf8')).bodies[0];
    for(const y of [-5,5]) {
      const ids=[0,height].map(z=>body.vertices.findIndex(v=>
        Math.hypot(v[0]-x,v[1]-y,v[2]-z)<1e-10));
      assert.ok(ids.every(i=>i>=0),'both endpoints of contact edge survive');
      assert.ok(body.edges.some(e=>e.start===ids[0]&&e.end===ids[1] ||
        e.start===ids[1]&&e.end===ids[0]),'vertical contact edge survives');
    }
  }
  assert.ok(Math.abs(validation.volumeMm3-expectedVolume)<1e-6,`independent stadium-minus-bore volume ${validation.volumeMm3} vs ${expectedVolume}`);
  assert.equal(validation.volumeComparedWithKernel,true);
  assert.equal(validation.sourceFaceAreasCompared,carriers.length);
});
test('coincident hub bore with knife contacts remains a named tangent-order refusal', async()=>{
  await assert.rejects(build(source,{feature:'jawCrank',parameters:{boreD:'10*millimeter'}}),
    e=>e.name==='RustCapabilityError' && e.reason==='prism-stack/tangent-branch-order');
});

for(const [offset,reason] of [[1,'tangent-branch-order'],[3,'multiple-result-bodies']])
  test(`off-hub crossing bore at ${offset} mm remains a named ${reason} refusal`, async()=>{
    const shifted=source.replace('const holes = [[0 * mm,',`const holes = [[${offset} * mm,`);
    await assert.rejects(build(shifted,{feature:'jawCrank',parameters:{boreD:'12*millimeter'}}),
      e=>e.name==='RustCapabilityError' && e.reason===`prism-stack/${reason}`);
  });
