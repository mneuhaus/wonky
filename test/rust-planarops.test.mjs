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
    if(size(evaluateQuery(context,qCreatedBy(id+"shell",EntityType.BODY)))!=1)throw "lost shell identity";
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

test('unsupported shell input remains a named capability even inside try silent', async () => {
  for (const [thickness, reason] of [
    ['2', 'shell/inward-only'],
    ['-0.1', 'shell/offset-not-binary64'],
    ['-8', 'shell/collapsed-cavity'],
  ]) {
    await assert.rejects(build(source(`
      const top=qClosestTo(qOwnedByBody(body,EntityType.FACE),vector(8,8,8)*millimeter);
      try silent(opShell(context,id+"shell",{"entities":top,"thickness":${thickness}*millimeter}));
    `),{feature:'f'}),e=>e.name==='RustCapabilityError'&&e.builtin==='opShell'&&e.reason===reason);
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
      const model = await build(source(`
        const turn=rotationAround(line(vector(3,-2,5)*millimeter,vector(1,2,3)),0.1*radian);
        const zero=turn*(vector(0,0,0)*millimeter);
        const cs=${skew
          ? 'coordSystem(vector(65536.25,-32768.5,16384.125)*millimeter+zero,(turn*(vector(1,0,0)*millimeter)-zero)/millimeter,(turn*(vector(0,0,1)*millimeter)-zero)/millimeter)'
          : 'coordSystem(vector(0,0,0)*millimeter,vector(1,0,0),vector(0,0,1))'};
        opTransform(context,id+"pose",{"bodies":body,"transform":toWorld(cs)});
        const top=qClosestTo(qOwnedByBody(body,EntityType.FACE),toWorld(cs,vector(8,8,8)*millimeter));
        opShell(context,id+"shell",{"entities":top,"thickness":-2*millimeter});
      `),{feature:'f'});
      const prefix = path.join(dir, skew ? 'skew' : 'identity');
      fs.writeFileSync(prefix+'.step',toStep(model,'shell'));
      fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
      prefixes.push(prefix);
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
