import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
import { fileURLToPath } from 'node:url';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { fitSplineParameters } = await import('../src/library.mjs');
const { measureRustBody, rustModelKernel, describeRustBody } = await import('../src/native/rust-host.mjs');
const { toStep } = await import('../src/exporters.mjs');
const { serializeModel } = await import('../src/construction-history.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const catalog = JSON.parse(fs.readFileSync(path.join(root,'fixtures/cad-acid/zones.json')));
const zone = catalog.zones.find(z => z.id === 'AC101');
const source = fs.readFileSync(path.join(root,'fixtures/cad-acid/fs/acid-fit-spline.fs'),'utf8');
const bits = x => { const b=Buffer.alloc(8);b.writeDoubleLE(x);return b.readBigUInt64LE().toString(16).padStart(16,'0'); };
const models = new Map();
const ac101 = variant => {
  if (!models.has(variant)) models.set(variant, build(source,{feature:'acidSplinesA',parameters:{variant:`AcidVariant.${variant}`,zone:'AcidSplinesAZone.AC101'}}));
  return models.get(variant);
};
const near = (a,b) => assert.ok(Math.abs(a-b) <= 1e-10*Math.max(1,Math.abs(b)),`${a} vs ${b}`);
const feature = body => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context,id is Id,definition is map) precondition {} {
var s = newSketchOnPlane(context,id+"s",{"sketchPlane":plane(vector(0,0,0)*millimeter,vector(0,0,1),vector(1,0,0))});
${body}
});`;
const fit = (pts,extra='') => `skFitSpline(s,"fit",{"points":[${pts.map(p=>`vector(${p.join(',')})*millimeter`).join(',')}]${extra}});`;
const end = `skLineSegment(s,"top",{"start":vector(30,28)*millimeter,"end":vector(0,28)*millimeter});
skLineSegment(s,"left",{"start":vector(0,28)*millimeter,"end":vector(0,0)*millimeter});
skSolve(s);opExtrude(context,id+"e",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":5*millimeter});`;
const bottom = `skLineSegment(s,"bottom",{"start":vector(0,0)*millimeter,"end":vector(30,0)*millimeter});`;

test('AC101 natural fit is real geometry in every declared variant with exactly zero audited residual', async () => {
  for (const v of zone.variants) {
    const model = await ac101(v), body = model.bodies[0], kernel = rustModelKernel(model);
    assert.equal(model.bodies.length,1);
    const m = measureRustBody(kernel,body);
    assert.equal(m.fitResidual,0,`${v} exact interpolation replay`);
    assert.equal(m.certificate,'CurveProfilePrism');
    near(m.volumeMm3,zone.closedForm.volume.valueFloat);
    near(m.areaMm2,zone.closedForm.area.valueFloat);
    assert.deepEqual([m.topology.faces,m.topology.edges,m.topology.vertices],[6,12,8]);
    const curves = describeRustBody(kernel,body).body.curves.filter(c=>c.geometry.kind==='BSpline');
    assert.equal(curves.length,2);
    assert.ok(curves.every(c=>c.geometry.degree===3 && c.geometry.controls.length===8));
    const step = toStep(model);
    assert.match(step,/SURFACE_OF_LINEAR_EXTRUSION/);
    assert.match(step,/B_SPLINE_CURVE_WITH_KNOTS/);
  }
});

test('D1 normalisation and explicit defaults are bit-identical, including the resulting pole caches', async () => {
  const points = zone.construction.params.fit.points.map(p=>p.map(v=>v*0.001));
  const ts = fitSplineParameters(points);
  assert.equal(ts[0],0);assert.equal(ts.at(-1),1);
  assert.deepEqual(ts,zone.construction.params.fit.parameters);
  assert.deepEqual(fitSplineParameters([[0,0],[0.01,0],[0.01,0.09]]),[0,0.25,1]);
});

test('V5 explicit defaults reproduce V0 pole caches, knots and domains bit for bit', async () => {
  const curves = async v => { const m=await ac101(v);return describeRustBody(rustModelKernel(m),m.bodies[0]).body.curves; };
  assert.deepEqual(await curves('V0'),await curves('V5'));
});

test('fit-point probes catch polyline substitution', async () => {
  const m = await ac101('V0');
  const probes = zone.closedForm.measurements.map(p=>p.definition.point.map((x,i)=>x+zone.cell.originMm[i]));
  const result = measureRustBody(rustModelKernel(m),m.bodies[0],{probes});
  for(const p of result.probes){assert.equal(p.inside,true);assert.equal(p.distanceMm,0);}
});

test('explicit non-default parameters and one-sided derivatives are source inputs', async () => {
  const pts=zone.construction.params.fit.points;
  const def = ',"parameters":[0,0.1,0.3,0.6,0.8,1],"startDerivative":vector(25,25)*millimeter';
  const m=await build(feature(bottom+fit(pts,def)+end),{feature:'f'});
  const measured=measureRustBody(rustModelKernel(m),m.bodies[0]);
  assert.equal(measured.fitResidual,0);
  const curves=describeRustBody(rustModelKernel(m),m.bodies[0]).body.curves.filter(c=>c.geometry.kind==='BSpline');
  assert.deepEqual(curves[0].geometry.knots,[0,0,0,0,0.1,0.3,0.6,0.8,1,1,1,1].map(bits),'explicit parameters are used as given');
  const ordinary=await ac101('V0');
  const defaults=describeRustBody(rustModelKernel(ordinary),ordinary.bodies[0]).body.curves.filter(c=>c.geometry.kind==='BSpline');
  assert.notDeepEqual(curves[0].geometry.controls,defaults[0].geometry.controls,'explicit parameters and derivative change exact geometry');
  const number = x => { const b=Buffer.alloc(8);b.writeBigUInt64LE(BigInt('0x'+x));return b.readDoubleLE(); };
  const [first,next]=curves[0].geometry.controls.map(p=>p.map(number));
  for(const axis of [0,1]) near(3*(next[axis]-first[axis])/0.1*1000,25);

});

test('repeated interior points, closed fits and fit budget refuse by name even in try silent', async () => {
  for (const [pts,code] of [
    [[[30,0],[34,5],[34,5],[30,28]],'curve2/degenerate-span'],
    [[[0,0],[1,1],[0,0]],'curve2/closed-fit-spline'],
    [Array.from({length:65},(_,i)=>[i,i%2]),'curve2/fit-budget'],
    [[[0,0],[1e200,1e200],[2e200,0]],'curve2/fit-budget'],
    [[[0,0],[1e-200,0],[2e-200,1e-200]],'curve2/fit-budget'],
  ]) {
    await assert.rejects(build(feature(`try silent { ${fit(pts)} }`),{feature:'f'}),e=>e.message.includes(code));
  }
});


test('a planted missing D1 normalisation fails real V0/V5 curve equality', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fit-normalisation-'));
  try {
    fs.cpSync(path.join(root,'src'),path.join(dir,'src'),{recursive:true});
    for(const name of ['rust','scripts','fixtures','node_modules','.tools','bend.lock.json'])fs.symlinkSync(path.join(root,name),path.join(dir,name));
    const library=path.join(dir,'src/library.mjs'),text=fs.readFileSync(library,'utf8');
    const needle='return cumulative.map(t => t / total);';
    assert.equal(text.split(needle).length,2,'plant touches the sole D1 formula');
    fs.writeFileSync(library,text.replace(needle,'return cumulative;'));
    const code=`
      import assert from 'node:assert/strict';
      import fs from 'node:fs';
      import {build} from './src/index.mjs';
      import {describeRustBody,rustModelKernel,measureRustBody} from './src/native/rust-host.mjs';
      const source=fs.readFileSync('fixtures/cad-acid/fs/acid-fit-spline.fs','utf8');
      const run=v=>build(source,{feature:'acidSplinesA',parameters:{variant:'AcidVariant.'+v,zone:'AcidSplinesAZone.AC101'}});
      const a=await run('V0'),b=await run('V5');
      assert.equal(measureRustBody(rustModelKernel(a),a.bodies[0]).fitResidual,0);
      assert.equal(measureRustBody(rustModelKernel(b),b.bodies[0]).fitResidual,0);
      console.log('real native fits built with exact residual 0');
      const curves=m=>describeRustBody(rustModelKernel(m),m.bodies[0]).body.curves;
      assert.deepEqual(curves(a),curves(b),'V5 equality detects missing D1 normalisation');
    `;
    const r=spawnSync(process.execPath,['--import',path.join(root,'scripts/r20/bend-guard.mjs'),'--input-type=module','-e',code],{cwd:dir,encoding:'utf8',timeout:180000,maxBuffer:1<<22,
      env:{...process.env,WONKY_BACKEND:'rust',WONKY_BEND_GUARD_LOG:path.join(dir,'plant.guard.json'),WONKY_RUST_CACHE:process.env.WONKY_RUST_CACHE??path.join(root,'tmp/rust/cache')}});
    if(r.stderr)process.stderr.write(r.stderr);
    assert.equal(r.error,undefined);assert.equal(r.status,1);
    assert.match(r.stdout,/real native fits built with exact residual 0/);
    assert.match(r.stderr,/V5 equality detects missing D1 normalisation/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir,'plant.guard.json'))).summary.bendLoaded,false);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});


test('AC101 STEP passes the independent pinned OCCT 8 validator', async () => {
  const model=await ac101('V0');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fit-step-'));
  try {
    const prefix=path.join(dir,'ac101');
    fs.writeFileSync(prefix+'.step',toStep(model));
    fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
    const r=spawnSync('uv',['run',path.join(root,'scripts/validate-step.py'),prefix],
      {cwd:root,encoding:'utf8',timeout:180000,maxBuffer:1<<22});
    if(r.stderr)process.stderr.write(r.stderr);
    assert.equal(r.error,undefined);
    assert.equal(r.status,0,r.stdout+'\n'+r.stderr);
    near(JSON.parse(r.stdout)[0].volumeMm3,zone.closedForm.volume.valueFloat);
  } finally { fs.rmSync(dir,{recursive:true,force:true}); }
});

test('smooth analytic supports with multi-span trimming edges retain valid STEP property observations', {skip: !process.getBuiltinModule('node:fs').existsSync(new URL('../out/build123d-performance/reference-venv/bin/python', import.meta.url)) && 'REFERENCE_VENV_UNAVAILABLE: build123d/OCCT reference observer'},async () => {
  const z=catalog.zones.find(z=>z.id==='AC20');
  const model=await build(fs.readFileSync(path.join(root,'fixtures/cad-acid/fs/acid-curved.fs'),'utf8'),
    {feature:'acidCurved',parameters:{variant:'AcidVariant.V0',zone:'AcidCurvedZone.AC20'}});
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fit-analytic-trims-'));
  try {
    const prefix=path.join(dir,'ac20');
    fs.writeFileSync(prefix+'.step',toStep(model));
    fs.writeFileSync(prefix+'.brep.json',serializeModel(model));
    const code=`
import sys, math
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'scripts/acid'))
from measure import read_step, props, canonical
from occt_properties import integration_shape, _needs_partition
from OCP.TopExp import TopExp_Explorer
from OCP.TopAbs import TopAbs_EDGE
from OCP.TopoDS import TopoDS
from OCP.BRepAdaptor import BRepAdaptor_Curve
from OCP.GeomAbs import GeomAbs_CN
s=read_step(sys.argv[1])
before=canonical(s)
edges=TopExp_Explorer(s,TopAbs_EDGE)
multi_span=False
while edges.More():
    multi_span |= BRepAdaptor_Curve(TopoDS.Edge_s(edges.Current())).NbIntervals(GeomAbs_CN)>1
    edges.Next()
assert multi_span, 'positive control has real internal trimming-edge knots'
assert not _needs_partition(s), 'smooth supports have no intrinsic surface knot breaks'
assert integration_shape(s).IsSame(s), 'smooth supports must not enter the topology upgrader'
p=props(s)
for field, expected, tolerance in [('volume',float(sys.argv[2]),float(sys.argv[4])),('area',float(sys.argv[3]),float(sys.argv[5]))]:
    assert math.isclose(p[field],expected,rel_tol=tolerance), (field,p[field],expected)
assert canonical(s)==before, 'property integration changed topology'
print('real analytic trimmed STEP properties passed')
`;
    const observer=spawnSync('uv',['run','--no-project',path.join(root,'out/build123d-performance/reference-venv/bin/python'),'-B','-c',code,
      prefix+'.step',String(z.closedForm.volume.valueFloat),String(z.closedForm.area.valueFloat),
      String(z.tolerance.volumeRel.exact),String(z.tolerance.areaRel.exact)],
      {cwd:root,encoding:'utf8',timeout:180000,maxBuffer:1<<22});
    if(observer.stderr)process.stderr.write(observer.stderr);
    assert.equal(observer.error,undefined);
    assert.equal(observer.status,0,observer.stdout+'\n'+observer.stderr);
    assert.match(observer.stdout,/real analytic trimmed STEP properties passed/);
    const validator=spawnSync('uv',['run',path.join(root,'scripts/validate-step.py'),prefix],
      {cwd:root,encoding:'utf8',timeout:180000,maxBuffer:1<<22});
    if(validator.stderr)process.stderr.write(validator.stderr);
    assert.equal(validator.error,undefined);
    assert.equal(validator.status,0,validator.stdout+'\n'+validator.stderr);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
