import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missingBend();
if (publicTreeSkip) {
  test("comparison.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { readFileSync, mkdtempSync, readdirSync, rmSync } = await import("node:fs");
const { execFileSync, spawnSync } = await import("node:child_process");
const { tmpdir } = await import("node:os");
const { join } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const { loadKernel } = await import("../src/kernel.mjs");
const { circularFrustumInBend } = await import("../src/analytic.mjs");
const { compareBodiesInBend } = await import("../src/comparison.mjs");
const { UnsupportedFeatureError } = await import("../src/errors.mjs");












const root = fileURLToPath(new URL('../',import.meta.url));
const near = (a,b) => assert.ok(Math.abs(a-b)<1e-9*Math.max(1,Math.abs(b)),`${a} != ${b}`);
const cylinder = (k,z0,z1,r,x=0) => circularFrustumInBend(k,'c',{
  radius:r,center:[0,0],plane:{origin:[x,0,z0],normal:[0,0,1],x:[1,0,0]},
},null,[0,0,z1-z0]);

test('geometric diff measures added and removed material, independently of source IDs and total volume',async()=>{
  const k = await loadKernel();
  const a = cylinder(k,0,10,5), b = cylinder(k,4,14,3);
  const c = compareBodiesInBend(k,a,b,{includeGeometry:true});
  assert.equal(c.relation,'overlap');assert.equal(c.equivalentWithinTolerance,false);
  for(const [key,v]of Object.entries({before:250,after:90,common:54,added:36,removed:196,symmetricDifference:232})) near(c.volumesMm3[key],v*Math.PI);
  for(const key of ['added','removed','common']) near(c.geometry[key].reduce((v,b)=>v+b.validation.volumeMm3,0),c.volumesMm3[key]);
  const equalVolumes=compareBodiesInBend(k,a,cylinder(k,4,14,5));
  near(equalVolumes.volumesMm3.before,equalVolumes.volumesMm3.after);
  near(equalVolumes.volumesMm3.symmetricDifference,200*Math.PI);
  assert.equal(equalVolumes.equivalentWithinTolerance,false);
  const identity=compareBodiesInBend(k,a,cylinder(k,10,0,5),{includeGeometry:true});
  assert.equal(identity.equivalentWithinTolerance,true);
  near(identity.volumesMm3.symmetricDifference,0);
  assert.deepEqual(identity.geometry.added,[]);assert.deepEqual(identity.geometry.removed,[]);
});

test('interference measurements distinguish positive clearance, cap contact, overlap and unresolved near-contact',async()=>{
  const k=await loadKernel(), a=cylinder(k,0,10,5);
  const separated=compareBodiesInBend(k,a,cylinder(k,12,22,3));
  assert.equal(separated.relation,'separated');near(separated.minimumDistanceMm,2);near(separated.volumesMm3.common,0);
  const touching=compareBodiesInBend(k,a,cylinder(k,10,20,3));
  assert.equal(touching.relation,'contact');near(touching.contactAreaMm2,9*Math.PI);near(touching.volumesMm3.common,0);
  const nearContact=compareBodiesInBend(k,a,cylinder(k,10+5e-8,20,3));
  assert.equal(nearContact.relation,'withinTolerance');assert.equal(nearContact.contactAreaMm2,null);
  const nested=compareBodiesInBend(k,a,cylinder(k,3,7,2));
  assert.equal(nested.relation,'overlap');near(nested.axialOverlapLengthMm,4);
  near(nested.volumesMm3.common,16*Math.PI);
  assert.throws(()=>compareBodiesInBend(k,a,cylinder(k,3,7,2),{includeGeometry:true}),e=>e instanceof UnsupportedFeatureError && /void/.test(e.message));
  assert.throws(()=>compareBodiesInBend(k,a,cylinder(k,0,10,3,1)),UnsupportedFeatureError);
  assert.throws(()=>compareBodiesInBend(k,a,a,{toleranceMm:0}),/tolerance/);
});

test('comparison CLI writes measured reports and complete diff artifacts, and rejects unsupported models without output',()=>{
  const dir=mkdtempSync(join(tmpdir(),'wonky-diff-')), prefix=join(dir,'diff');
  try{
    execFileSync(process.execPath,['bin/wonky-compare.mjs','examples/compare-before.fs','examples/compare-after.fs','--geometry','--out',prefix],{cwd:root});
    const report=JSON.parse(readFileSync(prefix+'.json','utf8'));
    assert.equal(report.status,'measured');assert.equal(report.relation,'overlap');
    assert.ok(report.inputs.every(i=>/^[a-f0-9]{64}$/.test(i.sha256)));
    assert.equal(readdirSync(dir).length,7);
    for(const k of ['added','removed','common'])assert.ok(readFileSync(report.geometryArtifacts[k].step,'utf8').includes('MANIFOLD_SOLID_BREP'));
    // Reusing a prefix for an empty diff must remove obsolete STEP bodies.
    execFileSync(process.execPath,['bin/wonky-compare.mjs','examples/compare-before.fs','examples/compare-before.fs','--geometry','--out',prefix],{cwd:root});
    const identical=JSON.parse(readFileSync(prefix+'.json','utf8'));
    assert.equal(identical.geometryArtifacts.added.step,null);
    assert.equal(identical.geometryArtifacts.removed.step,null);
    assert.ok(!readdirSync(dir).includes('diff.added.step'));
    const failed=spawnSync(process.execPath,['bin/wonky-compare.mjs','examples/box.fs','examples/box.fs','--out',join(dir,'unsupported')],{cwd:root,encoding:'utf8'});
    assert.equal(failed.status,1);assert.match(failed.stderr,/currently supports/);
    assert.ok(!readdirSync(dir).some(f=>f.startsWith('unsupported')));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

}
