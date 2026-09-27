// Explicit, opt-in acceptance over immutable snapshot artifacts. This is not
// in the fast lane, never reads ~/Workspace/cad and never rebuilds geometry.
// Authoring gate: catches false provenance, missing cases, mislabeled memory,
// and accidental geometry/publication changes at the real CAD CLI boundary.
// No mocks or new production test seams; the baseline predates this change.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { checkCarrierSource } from '../../test/helpers/carrier-diagnostics.mjs';
import { readStl, measure } from './mesh.mjs';

assert.ok(process.env.WONKY_DIAGNOSTIC_OUT, 'Set WONKY_DIAGNOSTIC_OUT to the real snapshot diagnostic directory');
const out = resolve(process.env.WONKY_DIAGNOSTIC_OUT);
const read = file => JSON.parse(readFileSync(file));
const list = read(join(out,'r20-near-tangent.json'));
const manifest = read(join(list.snapshot,'manifest.json'));
const modules = ['tray','return','cores','edge'];
const feedError = read(join(out,'feed/error.json'));
const refusalFile = join(out,'feed',feedError.dump), refusal = read(refusalFile);

test('A3 completeness: all 13 cases have identified carriers or an independently verified exact export', () => {
  assert.equal(list.rows.length,13);
  assert.equal(new Set(list.rows.map(r=>r.part)).size,13);
  for(const row of list.rows) {
    // r20-exact at the new base genuinely recovers T01. Do not demand a
    // fabricated failing pair; verify both pre-port and current export instead.
    if(row.status==='exact-export') {
      assert.equal(row.part,'T01');
      assert.deepEqual(row.carriers,[]);
      assert.equal(row.cadChange,null);
      for(const dir of [join(out,'baseline',row.module),join(out,row.module)]) {
        const part=read(join(dir,'tessellate-manifest.json')).parts[row.part];
        assert.equal(part.wonky.exact,true);
        assert.equal(part.wonky.approximation,null);
        assert.ok(part.wonky.volumeMm3>0);
      }
    } else {
      assert.equal(row.status,'located',`${row.part}: ${row.missing ?? row.reason}`);
      assert.ok(row.carriers.length>=2,`${row.part}: both carriers are required`);
    }
  }
});

test('A3 provenance: every located carrier agrees with frozen source calls and independent surface equations', () => {
  const located=list.rows.filter(row=>row.status==='located');
  assert.ok(located.length>0);
  for(const row of located) for(const carrier of row.carriers) checkCarrierSource(carrier,list.snapshot);
});

test('A2 RACK refusal records the exact gap, both carriers and all input/studio STLs', () => {
  assert.equal(refusal.refusal.gapMm,Number(feedError.message.match(/come within ([\d.eE+-]+) mm/)[1]));
  assert.equal(refusal.refusal.gapMm,0.0056079486);
  assert.deepEqual(refusal.refusal.carriers.map(c=>c.tag),[229,233]);
  assert.deepEqual(refusal.refusal.carriers.map(c=>c.type),['cylinder','plane']);
  assert.ok(refusal.inputs.some(b=>b.role==='targets') && refusal.inputs.some(b=>b.role==='tools'));
  assert.ok(refusal.inputs.some(b=>b.bodyId.endsWith('/~step0')), 'the actual n-ary intermediate operand must survive too');
  assert.equal(refusal.studio.length,5);
  const bodies=new Map([...refusal.inputs,...refusal.studio].map(b=>[b.stl,b]));
  assert.equal(bodies.size,6);
  for(const [stl,body] of bodies) {
    assert.ok(stl && !body.stlRefusal,body.stlRefusal);
    assert.ok(body.bboxMm && body.bboxMm.min.every(Number.isFinite) && body.bboxMm.max.every(Number.isFinite));
    const solids=readStl(join(dirname(refusalFile),stl));
    assert.equal(solids.length,1);
    const measured=measure(solids[0].triangles);
    assert.ok(measured.watertight && measured.volumeMm3>0);
    const metadata=read(join(dirname(refusalFile),body.metadata));
    assert.equal(metadata.bodyId,body.bodyId);
    assert.equal(metadata.carriers.length,Object.values(body.faceCounts).reduce((n,x)=>n+x,0));
  }
});

test('A4 every requested module reports positive elapsed wall time and process peak RSS', () => {
  for(const module of [...modules,'feed']) {
    const resources=module==='feed'?refusal.resources:read(join(out,module,'tessellate-manifest.json')).resources;
    assert.equal(resources.module,manifest.modules[module].featureType);
    assert.ok(Number.isFinite(resources.wallTimeMs) && resources.wallTimeMs>0);
    assert.ok(Number.isFinite(resources.maxRSSKiB) && resources.maxRSSKiB>0 && resources.maxRSSKiB<16*1024*1024);
  }
});

test('A5 unchanged baseline: all STL bytes, volumes, exactness, statuses and non-diagnostic files', () => {
  for(const module of modules) {
    const before=join(out,'baseline',module), after=join(out,module);
    const beforeManifest=read(join(before,'tessellate-manifest.json'));
    const {resources,...afterManifest}=read(join(after,'tessellate-manifest.json'));
    assert.ok(resources);
    assert.equal(JSON.stringify(afterManifest),JSON.stringify(beforeManifest),`${module}: manifest changed beyond new diagnostics`);
    const files=dir=>readdirSync(dir,{withFileTypes:true}).filter(e=>e.isFile()&&e.name!=='println.log').map(e=>e.name).sort();
    assert.deepEqual(files(after),files(before),`${module}: non-diagnostic output files changed`);
    for(const file of files(before).filter(name=>name.endsWith('.stl')))
      assert.ok(readFileSync(join(before,file)).equals(readFileSync(join(after,file))),`${module}/${file}: geometry bytes changed`);
  }
  for(const module of ['feed','probe']) {
    const {dump,...current}=read(join(out,module,'error.json'));
    assert.ok(dump);
    assert.equal(JSON.stringify(current),JSON.stringify(read(join(out,'baseline',module,'error.json'))),`${module} must refuse identically, not skip a label/feature`);
  }
});
