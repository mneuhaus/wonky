import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {parse} from '../src/parser.mjs';
import {Interpreter} from '../src/interpreter.mjs';
import {StagingEvaluator} from '../src/lang/wk/stage-fs.mjs';
import {Id} from '../src/values.mjs';
import {ModelingContext} from '../src/library.mjs';
import {ROOT,loadCatalog,catalogBySha,sha256} from '../scripts/acid/common.mjs';
import {assertPackageDelta,assertOwnZonesLive} from './helpers/catalog-delta.mjs';

test('ZW1 is additive and preserves the exact pre-extension catalog',()=>{
  const {catalog:c}=loadCatalog();
  const pkg=assertPackageDelta(c,'AC1-2026-10-02-extZW1-sweeps',{added:['AC126','AC127','AC128','AC129','AC130','AC131']});
  const h=pkg.entry;
  assert.deepEqual(pkg.after,catalogBySha('a468b244797de7a59ca45256f104e5f27616efdb3e39d78d37410442428c236f'));
  const bytes=fs.readFileSync(path.join(ROOT,'fixtures/cad-acid/catalog-history',h.previousSha256+'.json'));
  assert.equal(sha256(bytes),h.previousSha256);
  // An undeclared edit of a ZW1 zone fails; later packages touching other zones do not.
  const planted=structuredClone(c);planted.zones.find(z=>z.id==='AC129').planted=true;
  assert.throws(()=>assertOwnZonesLive(planted,pkg),/AC129 undeclared later change/);
  const later=structuredClone(c);later.zones.find(z=>z.id==='AC36').planted=true;
  assert.doesNotThrow(()=>assertOwnZonesLive(later,pkg));
});

test('ZW1 independent routes reject wrong loft topology, wrong draft target and altered V4 radius',{timeout:240000},()=>{
  const code=String.raw`
import importlib.util,json,copy
spec=importlib.util.spec_from_file_location('current','scripts/acid/closed-forms-errata.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
f=mod.forms
cat=json.load(open('fixtures/cad-acid/zones.json'));by={z['id']:z for z in cat['zones']}
for zid in mod.zw1_forms.IDS:
    rep=f.Report();f.check_zone(by[zid],rep,by,cat)
    bad=[r for r in rep.rows if not r[2]]
    assert not bad,(zid,bad)
def wrong_topology(z):
    # Eight lateral faces with matching edges/loops still satisfies Euler.
    # Keep V4 consistent so only the independent face derivation can reject it.
    for cf in (z['closedForm'],z['closedFormByVariant']['V4']):
        cf['topology'].update(faces=10,edges=16,loops=10)

def wrong_draft(z):
    for params in (z['construction']['params'],z['construction']['paramsByVariant']['V4']):
        params['targetSlope']='3/8'

cases=[
    ('AC129',wrong_topology,'construction hand-derived topology faces'),
    ('AC131',wrong_draft,'volume [quad]'),
    ('AC126',lambda z:z['construction']['paramsByVariant']['V4'].update(radius='163/40'),
     'V4 parameters = V0 with every radius +0.025 mm'),
]
for zid,mutate,guard in cases:
    z=copy.deepcopy(by[zid]);mutate(z);rep=f.Report();f.check_zone(z,rep,by,cat)
    failures=[r[1] for r in rep.rows if not r[2]]
    assert guard in failures,(zid,guard,'planted error escaped intended guard',failures)
print('ZW1: six contracts and three planted errors checked')
`;
  const r=spawnSync('uv',['run','--with','sympy==1.13.3','--with','mpmath==1.3.0','python','-c',code],{cwd:ROOT,encoding:'utf8',timeout:235000,maxBuffer:4<<20});
  if(r.stderr)process.stderr.write(r.stderr);
  assert.equal(r.status,0,r.error?.message??r.stdout);
});

// Capture evaluated sketch inputs before solving; this proves input premises,
// not successful kernel construction or Onshape acceptance.
test('ZW1 evaluated arc inputs have exact axial center and tangent junction in every variant',()=>{
  const source=fs.readFileSync(path.join(ROOT,'fixtures/cad-acid/fs/acid-sweep-zw1.fs'),'utf8');
  const declarations=source.slice(0,source.indexOf('annotation { "Feature Type Name"'));
  const stopped=new Error('sketch inputs captured');
  class Capture extends StagingEvaluator {
    solveSketch(sketch) { this.captured=sketch; throw stopped; }
  }
  for(const variant of ['V0','V1','V2','V3','V4','V5']) {
    for(const zone of ['AC128','AC130']) {
      const call=zone==='AC128'
        ? `zwRevolve(context,id,"AC128",AcidVariant.${variant},500,360);`
        : `zwSweep(context,id,AcidVariant.${variant});`;
      const program=parse(declarations+`
export const premise=defineFeature(function(context is Context,id is Id,definition is map)
precondition {} { ${call} });`);
      const evaluator=new Capture();
      const builtins=new ModelingContext(null).builtins();
      // Use production scalar/frame semantics and observe sketch declarations only.
      for(const name of ['newSketchOnPlane','skLineSegment','skArc','skEllipticalArc','skSolve'])
        builtins[name]=evaluator.globals.get(name);
      const interpreter=new Interpreter(builtins);
      assert.throws(()=>interpreter.run(program,'premise',evaluator.context,new Id(['premise']),null),e=>e===stopped);
      const entities=evaluator.captured.entities;
      assert.equal(entities.filter(e=>e.kind==='skArc').length,0);
      const arc=entities.find(e=>e.id===(zone==='AC128'?'sphere':'bend'));
      assert.equal(arc.kind,'skEllipticalArc');
      const d=arc.d;
      assert.deepEqual(d.majorAxis.items,[1,0]);
      assert.equal(d.majorRadius.value,d.minorRadius.value);
      assert.equal(d.endParameter-d.startParameter,0.25);
      if(zone==='AC128') {
        assert.equal(d.center.items[0].value,0,'sphere center is exactly on the sketch axis');
        assert.equal(d.startParameter,0);
        assert.equal(d.endParameter,0.25);
      } else {
        const end=entities.find(e=>e.id==='line').d.end.items;
        assert.equal(d.center.items[0].value,end[0].value,'no horizontal center offset');
        assert.equal(d.center.items[1].value,d.majorRadius.value,'start height is exactly zero');
        assert.equal(end[1].value,0);
        assert.equal(d.startParameter,0.75);
        assert.equal(d.endParameter,1);
      }
    }
  }
});
