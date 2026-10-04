import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
process.env.WONKY_BACKEND = 'rust';
const {build} = await import('../src/index.mjs');
const {rustMesh,rustStl,rustModelKernel,rustCarriers} = await import('../src/native/rust-host.mjs');
const triples = a => Array.from({length:a.length/3},(_,i)=>a.slice(i*3,i*3+3));
function check(vertices, triangles, faces, carriers, deviation) {
  const edges = new Map();
  assert.ok(triangles.length);
  for (const [i,t] of triangles.entries()) {
    const p=t.map(k=>vertices[k]), [a,b,c]=p;
    const u=b.map((x,k)=>x-a[k]),v=c.map((x,k)=>x-a[k]);
    assert.ok(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])>0);
    for(let j=0;j<3;j++) {
      const a=t[j],b=t[(j+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(',');
      const e=edges.get(key)??[0,0];e[0]++;e[1]+=a<b?1:-1;edges.set(key,e);
    }
    const plane=carriers.faces[faces[i]];
    assert.equal(plane.kind,'plane');
    for(const point of [...p,a.map((x,k)=>(x+b[k]+c[k])/3)]) {
      const distance=Math.abs(point.reduce((sum,x,k)=>sum+(x-plane.origin[k])*plane.normal[k],0))/Math.hypot(...plane.normal);
      assert.ok(distance<=deviation,`plane distance ${distance}`);
    }
  }
  for(const e of edges.values())assert.deepEqual(e,[2,0]);
}
for(const [name,feature] of [['box-union-sloped-prisms','jawServoHolder'],['sloped-prism-minus-box','jawTest']]) {
  for(const mirror of [false,true]) test(`${name} mirror=${mirror}: planar Boolean mesh and quantized STL are watertight within deviation`,async()=>{
    let source=fs.readFileSync(new URL(`../fixtures/mesh-sloped/${name}.fs`,import.meta.url),'utf8');
    if(mirror) source=source.replace(/    \}\);\s*$/, `
      opPattern(context,id+"mirror",{"entities":qBodyType(qEverything(EntityType.BODY),BodyType.SOLID),"transforms":[transform(matrix([[-1,0,0],[0,1,0],[0,0,1]]),vector(0,0,0)*millimeter)],"instanceNames":["m"]});
      opDeleteBodies(context,id+"original",{"entities":qSubtraction(qBodyType(qEverything(EntityType.BODY),BodyType.SOLID),qCreatedBy(id+"mirror",EntityType.BODY))});
    });`);
    const model=await build(source,{feature});
    const k=rustModelKernel(model),deviation=0.02;
    assert.equal(model.bodies.length,1);
    const mesh=rustMesh(k,model.bodies,deviation).bodies[0];
    const carriers=rustCarriers(k,model.bodies)[0];
    const vertices=triples(mesh.vertices),triangles=triples(mesh.triangles);
    check(vertices,triangles,mesh.faces,carriers,deviation);
    const volume6=triangles.reduce((sum,t)=>{
      const [a,b,c]=t.map(i=>vertices[i]);
      return sum+a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]);
    },0);
    assert.ok(volume6>0,'outward shell including reflected placement');
    const stl=rustStl(k,model.bodies,deviation);
    assert.match(stl.subarray(0,80).toString(),/deviationMm=0.02/);
    assert.equal(stl.readUInt32LE(80),triangles.length);
    const ids=new Map(),quantized=[],facets=[];
    for(let i=0;i<triangles.length;i++) {
      const t=[];
      for(let j=0;j<3;j++) {
        const p=Array.from({length:3},(_,k)=>stl.readFloatLE(84+i*50+12+j*12+k*4));
        assert.ok(Math.hypot(...p.map((x,k)=>x-vertices[triangles[i][j]][k]))<=deviation/2);
        const key=p.join(',');if(!ids.has(key)){ids.set(key,quantized.length);quantized.push(p);}t.push(ids.get(key));
      }
      facets.push(t);
    }
    check(quantized,facets,mesh.faces,carriers,deviation);
    assert.throws(()=>rustMesh(k,model.bodies,1e-20),/arrangement-vertex-budget/);
    assert.throws(()=>rustStl(k,model.bodies,1e-8),/float32-deviation-exceeded/);
  });
}
