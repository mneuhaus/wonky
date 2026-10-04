// Interpreter owner: shell replaces its existing body, preserves metadata and
// does not freeze a lazy face query before a later exact body placement.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { measureRustBody, rustModelKernel } = await import('../src/native/rust-host.mjs');
const source = statements => `FeatureScript 3044; import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context,id is Id,definition is map) precondition {} {
 fCuboid(context,id+"box",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(16,16,8)*millimeter});
 const body=qCreatedBy(id+"box",EntityType.BODY);
 ${statements}
});`;

test('shell preserves body identity and metadata; closest-face query resolves lazily after placement', async () => {
  const model = await build(source(`
    setProperty(context,{"entities":body,"propertyType":PropertyType.NAME,"value":"open box"});
    const pick=qClosestTo(qOwnedByBody(body,EntityType.FACE),vector(8,8,28)*millimeter);
    opTransform(context,id+"turn",{"bodies":body,"transform":toWorld(coordSystem(vector(16,0,16)*millimeter,vector(-1,0,0),vector(0,0,-1)))});
    opShell(context,id+"shell",{"entities":pick,"thickness":-2*millimeter});
    if(size(evaluateQuery(context,qCreatedBy(id+"shell",EntityType.BODY)))!=0)throw "modifying feature incorrectly created a body";
    if(size(evaluateQuery(context,body))!=1)throw "lost original identity";
  `), { feature:'f' });
  assert.equal(model.bodies.length,1);
  assert.equal(model.bodies[0].name,'open box');
  const m=measureRustBody(rustModelKernel(model),model.bodies[0],{probes:[[8,8,15]]});
  assert.ok(Math.abs(m.volumeMm3-(16*16*8-12*12*6))<1e-9);
  // Downward Z placement means world-above selects SOURCE BOTTOM. If qClosestTo
  // were evaluated before placement, the source TOP would be removed instead.
  assert.equal(m.probes[0].inside,false);
  assert.ok(Math.abs(m.probes[0].distanceMm-5)<1e-9);
});

test('rational shells succeed and unsupported inputs remain named capabilities inside try silent', async () => {
  for (const [thickness, reason] of [
    ['2', 'shell/inward-only'],
    ['-0.1', 'success'],
    ['-8', 'shell/collapsed-cavity'],
  ]) {
    const task = build(source(`
      const top=qClosestTo(qOwnedByBody(body,EntityType.FACE),vector(8,8,8)*millimeter);
      try silent(opShell(context,id+"shell",{"entities":top,"thickness":${thickness}*millimeter}));
    `),{feature:'f'});
    if (reason === 'success') {
      const model = await task;
      const m = measureRustBody(rustModelKernel(model),model.bodies[0],{probes:[[8,8,4],[0.05,8,4]]});
      assert.ok(Math.abs(m.volumeMm3-(16*16*8-15.8*15.8*7.9))<1e-9);
      assert.equal(m.probes[0].inside,false);
      assert.equal(m.probes[1].inside,true);
    } else await assert.rejects(task,e=>e.name==='RustCapabilityError'&&e.builtin==='opShell'&&e.reason===reason);
  }
});

// A replacement must invalidate evaluated topology, while body identity stays
// live (above). Otherwise an old face index can select a different shell face.
test('shell invalidates captured topology instead of silently reusing face indices', async () => {
  await assert.rejects(build(source(`
    const top=qClosestTo(qOwnedByBody(body,EntityType.FACE),vector(8,8,8)*millimeter);
    const captured=evaluateQuery(context,top)[0];
    opShell(context,id+"shell",{"entities":top,"thickness":-2*millimeter});
    evaluateQuery(context,captured);
  `),{feature:'f'}),e=>e.name==='RustCapabilityError'&&e.reason==='stale-topology-reference');
});

// Independent consumer contract: the rim's inner loop and all inward faces
// must remain a valid open-top SOLID through STEP export, including a skew
// interpreter frame. Native metrics alone cannot detect reversed STEP holes.
test('source-frame shell STEP reimports with inner rim and declared affine rounding budget', async () => {
  const { toStep } = await import('../src/exporters.mjs');
  const { serializeModel } = await import('../src/construction-history.mjs');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-shell-step-'));
  try {
    const prefixes = [];
    for (const skew of [false, true]) {
      for (const thickness of [2, 0.1]) {
        const model = await build(source(`
        const turn=rotationAround(line(vector(3,-2,5)*millimeter,vector(1,2,3)),0.1*radian);
        const zero=turn*(vector(0,0,0)*millimeter);
        const cs=${skew
          ? 'coordSystem(vector(65536.25,-32768.5,16384.125)*millimeter+zero,(turn*(vector(1,0,0)*millimeter)-zero)/millimeter,(turn*(vector(0,0,1)*millimeter)-zero)/millimeter)'
          : 'coordSystem(vector(0,0,0)*millimeter,vector(1,0,0),vector(0,0,1))'};
        opTransform(context,id+"pose",{"bodies":body,"transform":toWorld(cs)});
        const top=qClosestTo(qOwnedByBody(body,EntityType.FACE),toWorld(cs,vector(8,8,8)*millimeter));
        opShell(context,id+"shell",{"entities":top,"thickness":-${thickness}*millimeter});
        `),{feature:'f'});
        const prefix = path.join(dir, `${skew ? 'skew' : 'identity'}-${thickness}`);
        fs.writeFileSync(prefix+'.step',toStep(model,'shell'));
        fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
        prefixes.push(prefix);
      }
    }
    const result=spawnSync('uv',['run',path.join(root,'scripts/validate-step.py'),...prefixes],{
      cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,
    });
    assert.equal(result.status,0,result.stderr||String(result.error));
    assert.equal(JSON.parse(result.stdout).length,prefixes.length);
  } finally {
    fs.rmSync(dir,{recursive:true,force:true});
  }
});

// The same source-frame mechanism must admit both rectangular construction
// grammars and preserve a chain of placements; no CAD-Acid-specific routing.
test('native and sketch rectangular offsets retain composed placements and valid STEP geometry', async () => {
  const {toStep} = await import('../src/exporters.mjs');
  const {serializeModel} = await import('../src/construction-history.mjs');
  const root = fileURLToPath(new URL('../',import.meta.url));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'wonky-rational-offset-'));
  try {
    const prefixes = [];
    for (const idiom of ['native','sketch']) {
      for (const operation of ['fillet','shell']) {
        const initial = idiom === 'native'
          ? 'fCuboid(context,id+"box",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(40,30,20)*millimeter});'
          : `var sk=newSketchOnPlane(context,id+"sk",{"sketchPlane":plane(vector(0,0,0)*millimeter,vector(0,0,1),vector(1,0,0))});
             skRectangle(sk,"r",{"firstCorner":vector(0,0)*millimeter,"secondCorner":vector(40,30)*millimeter});
             skSolve(sk);
             opExtrude(context,id+"box",{"entities":qSketchRegion(id+"sk",false),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":20*millimeter});`;
        const p = operation === 'fillet' ? 'vector(40,30,10)' : 'vector(20,15,20)';
        const modify = operation === 'fillet'
          ? 'opFillet(context,id+"offset",{"entities":picked,"radius":4*millimeter});'
          : 'opShell(context,id+"offset",{"entities":picked,"thickness":-2*millimeter});';
        const model = await build(`FeatureScript 3044; import(path:"onshape/std/geometry.fs",version:"3044.0");
          export const f=defineFeature(function(context is Context,id is Id,definition is map) {
            ${initial}
            const body=qCreatedBy(id+"box",EntityType.BODY);
            const cs1=coordSystem(vector(17,19,23)*millimeter,vector(1,0,0),vector(0,0,1));
            const cs2=coordSystem(vector(100,200,300)*millimeter,vector(0,0,1),vector(0,-1,0));
            opTransform(context,id+"first",{"bodies":body,"transform":toWorld(cs1)});
            opTransform(context,id+"second",{"bodies":body,"transform":toWorld(cs2)});
            const picked=qClosestTo(qOwnedByBody(body,EntityType.${operation==='fillet'?'EDGE':'FACE'}),toWorld(cs2,toWorld(cs1,${p}*millimeter)));
            ${modify}
          });`,{feature:'f'});
        const m=measureRustBody(rustModelKernel(model),model.bodies[0],{probes:[[66,167,337],[66,167,318]]});
        const volume=operation==='fillet' ? (40*30-16*(1-Math.PI/4))*20 : 40*30*20-36*26*18;
        assert.ok(Math.abs(m.volumeMm3-volume)<1e-8,`${idiom}/${operation}: ${m.volumeMm3}`);
        assert.equal(model.bodies.length,1);
        assert.equal(m.probes[0].inside,operation === 'fillet');
        assert.equal(m.probes[1].inside,true);
        const prefix=path.join(dir,`${idiom}-${operation}`);
        fs.writeFileSync(prefix+'.step',toStep(model,'rational offset'));
        fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
        prefixes.push(prefix);
      }
    }
    const result=spawnSync('uv',['run',path.join(root,'scripts/validate-step.py'),...prefixes],{cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
    assert.equal(result.status,0,result.stderr||String(result.error));
    assert.equal(JSON.parse(result.stdout).length,4);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('rational planar shells export watertight oriented STL at 0.005 mm through placements', async () => {
  const {rustMesh,rustStl}=await import('../src/native/rust-host.mjs');
  for (const thickness of [2,0.1]) for (const placed of [false,true]) {
    const model=await build(source(`
      ${placed ? `const turn=rotationAround(line(vector(0,0,0)*millimeter,vector(1,2,3)),0.1*radian);
      const zero=turn*(vector(0,0,0)*millimeter);
      const pose=toWorld(coordSystem(vector(23,-11,7)*millimeter+zero,(turn*(vector(1,0,0)*millimeter)-zero)/millimeter,(turn*(vector(0,0,1)*millimeter)-zero)/millimeter));
      opTransform(context,id+"pose",{"bodies":body,"transform":pose});` : ''}
      const top=qClosestTo(qOwnedByBody(body,EntityType.FACE),${placed ? 'pose*(vector(8,8,8)*millimeter)' : 'vector(8,8,8)*millimeter'});
      opShell(context,id+"shell",{"entities":top,"thickness":-${thickness}*millimeter});
    `),{feature:'f'});
    const kernel=rustModelKernel(model), mesh=rustMesh(kernel,model.bodies,0.005).bodies[0];
    const stl=rustStl(kernel,model.bodies,0.005);
    assert.match(stl.subarray(0,80).toString(),/deviationMm=0.005/);
    assert.equal(stl.readUInt32LE(80),mesh.triangles.length/3);
    assert.equal(mesh.faces.length,mesh.triangles.length/3);
    const edges=new Map(), exported=[]; let volume=0;
    for(let i=0;i<stl.readUInt32LE(80);i++) {
      const p=Array.from({length:3},(_,j)=>Array.from({length:3},(_,k)=>stl.readFloatLE(84+50*i+12+12*j+4*k)));
      exported.push(...p);
      const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
      const n=cross(p[1].map((x,k)=>x-p[0][k]),p[2].map((x,k)=>x-p[0][k]));
      assert.ok(Math.hypot(...n)>0);
      volume+=p[0].reduce((s,x,k)=>s+x*cross(p[1],p[2])[k],0)/6;
      for(let j=0;j<3;j++) {
        const a=p[j].join(','),b=p[(j+1)%3].join(','),key=[a,b].sort().join('|');
        const e=edges.get(key)??[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(key,e);
      }
    }
    for(const e of edges.values())assert.deepEqual(e,[2,0]);
    const expected=16*16*8-(16-2*thickness)**2*(8-thickness);
    assert.ok(Math.abs(volume-expected)<0.01,`${volume} != ${expected}`);
    // Boundary probes also classify interior and deliberately refuse rounded
    // rational boundary points. Verify the actual float32 output against an
    // independent analytic corner construction instead, at the same budget.
    const axis=[1,2,3].map(x=>x/Math.sqrt(14)), cos=Math.cos(0.1),sin=Math.sin(0.1);
    const rotate=p=>{
      const dot=p.reduce((s,x,k)=>s+x*axis[k],0);
      const cross=[axis[1]*p[2]-axis[2]*p[1],axis[2]*p[0]-axis[0]*p[2],axis[0]*p[1]-axis[1]*p[0]];
      return p.map((x,k)=>x*cos+cross[k]*sin+axis[k]*dot*(1-cos)+[23,-11,7][k]);
    };
    const expectedCorners=[];
    for(const [lo,hi,bottom] of [[0,16,0],[thickness,16-thickness,thickness]])
      for(const x of [lo,hi])for(const y of [lo,hi])for(const z of [bottom,8])
        expectedCorners.push(placed?rotate([x,y,z]):[x,y,z]);
    const distance=(a,b)=>Math.hypot(...a.map((x,k)=>x-b[k]));
    for(const p of exported)assert.ok(Math.min(...expectedCorners.map(q=>distance(p,q)))<=0.005,JSON.stringify(p));
    for(const p of expectedCorners)assert.ok(Math.min(...exported.map(q=>distance(p,q)))<=0.005,JSON.stringify(p));
    if(placed)assert.throws(()=>rustStl(kernel,model.bodies,1e-15),/precision|budget|deviation/);
  }
});
