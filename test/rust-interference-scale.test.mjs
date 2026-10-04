import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { certifiedBoundsRustBody, rustModelKernel, clashRustBodies, placeRustBody } = await import('../src/native/rust-host.mjs');
const { interferenceReport } = await import('../src/native/interference.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const source = statements => `FeatureScript 3044;
import(path:"onshape/std/geometry.fs", version:"3044.0");
export const f = defineFeature(function(context is Context,id is Id,definition is map) precondition {} { ${statements} });`;
const box = (id, lo, hi, unit = 'millimeter') => `fCuboid(context,id+"${id}",{"corner1":vector(${lo})*${unit},"corner2":vector(${hi})*${unit}});`;
const query = id => `qCreatedBy(id+"${id}",EntityType.BODY)`;
// Geometry assertions must not inherit the interactive 250 ms safety budget.
// The exhaustion regression below deliberately retains its own 25 ms budget.
const DECIDED_PAIR_BUDGET_MS = 5000;
const near = (x, y, bound) => assert.ok(Math.abs(x - y) <= bound + 1e-9, `${x} vs ${y} ±${bound}`);

test('61 separated exact boxes list all 1830 pairs, with broad-phase proofs and no narrow calls', async () => {
  const model = await build(source(Array.from({length:61}, (_, i) => box('b'+i, `${i*20},0,0`, `${i*20+10},10,10`)).join('')), {feature:'f'});
  const batches = [];
  const report = await interferenceReport(model, {pairBudgetMs:DECIDED_PAIR_BUDGET_MS,onPairs: pairs => batches.push(pairs)});
  assert.equal(report.pairs.length, 1830);
  assert.deepEqual(report.phases, {broad:1830,narrow:0});
  assert.equal(new Set(report.pairs.map(p => p.target+'|'+p.tool)).size, 1830);
  assert.equal(batches[0].length, 1830, 'broad results emitted as one batch before narrow work');
  for (const pair of report.pairs) {
    assert.equal(pair.type, 'NONE'); assert.equal(pair.phase, 'broad');
    assert.ok(pair.distanceLowerBoundMm > 0);
    assert.equal(pair.distanceMeaning, 'bounded-exact-distance');
  }
});

test('touching boxes by face/edge/vertex go to narrow; a 2^-30 m gap is certified broad, not contact', async () => {
  for (const lo of ['0.5,0,0','0.5,0.25,0','0.5,0.25,0.25']) {
    const model = await build(source(box('a','0,0,0','0.5,0.25,0.25','meter') + box('b',lo,'1,0.5,0.5','meter')), {feature:'f'});
    const pair = (await interferenceReport(model, {pairBudgetMs:DECIDED_PAIR_BUDGET_MS})).pairs[0];
    assert.equal(pair.phase, 'narrow'); assert.equal(pair.type, 'ABUT_NO_CLASS');
    assert.deepEqual([pair.distanceMm,pair.distanceBoundMm], [0,0]);
  }
  const gap = 2**-30;
  const model = await build(source(box('a','0,0,0','0.5,0.25,0.25','meter') + box('b',`${0.5+gap},0,0`,'1,0.25,0.25','meter')), {feature:'f'});
  const pair = (await interferenceReport(model, {pairBudgetMs:DECIDED_PAIR_BUDGET_MS})).pairs[0];
  assert.equal(pair.phase, 'broad'); assert.equal(pair.type, 'NONE');
  assert.ok(pair.distanceLowerBoundMm > 0 && pair.distanceLowerBoundMm <= gap*1000);
  near(pair.distanceMm,gap*1000,pair.distanceBoundMm);
});

test('overlapping boxes but disjoint solids retain the exact narrow distance, never box clearance', async () => {
  // Two convex triangular prisms have overlapping AABBs but parallel diagonal
  // faces 1/sqrt(2) m apart. No nonconvex-distance extension is needed here.
  const prism = (id, points) => `const ${id} = newSketchOnPlane(context,id+"${id}",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1))});
    skPolyline(${id},"p",{"points":[${[...points,points[0]].map(p=>'vector('+p+')*meter').join(',')}]}); skSolve(${id});
    opExtrude(context,id+"${id}e",{"entities":qSketchRegion(id+"${id}"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":1*meter});`;
  const model = await build(source(prism('a',['0,0','2,0','0,2']) + prism('b',['2,2','2,1','1,2'])), {feature:'f'});
  const previous = clashRustBodies(rustModelKernel(model),...model.bodies);
  const pair = (await interferenceReport(model,{pairBudgetMs:DECIDED_PAIR_BUDGET_MS})).pairs[0];
  assert.equal(pair.phase,'narrow'); assert.equal(pair.type,'NONE');
  assert.equal(pair.distanceMm,previous.distanceMm); assert.equal(pair.distanceBoundMm,previous.distanceBoundMm);
  near(pair.distanceMm,1000/Math.sqrt(2),pair.distanceBoundMm);
});

test('analytic cylinders with separated certified envelopes expose only a lower bound, not a fabricated minimum', async () => {
  const cylinder = (id,x,y) => `fCylinder(context,id+"${id}",{"bottomCenter":vector(${x},${y},0)*millimeter,"topCenter":vector(${x},${y},10)*millimeter,"radius":1*millimeter});`;
  const model = await build(source(cylinder('a',0,0)+cylinder('b',4,4)), {feature:'f'});
  const pair = (await interferenceReport(model, {pairBudgetMs:DECIDED_PAIR_BUDGET_MS})).pairs[0];
  assert.equal(pair.phase,'broad'); assert.equal(pair.type,'NONE');
  assert.equal(pair.distanceMm,null); assert.equal(pair.distanceBoundMm,null);
  assert.equal(pair.distanceMeaning,'certified-lower-bound');
  assert.ok(pair.distanceLowerBoundMm > 1.99 && pair.distanceLowerBoundMm <= 2);
  assert.ok(pair.distanceLowerBoundMm < Math.sqrt(32)-2, 'bound is not claimed to be minimum distance');
});

test('rounded measurement caches cannot manufacture broad clearance after composed placements', async () => {
  const model = await build(source(box('a','0,0,0','1,1,1') + `opTransform(context,id+"move",{"bodies":${query('a')},"transform":toWorld(coordSystem(vector(65536,0,0)*meter,vector(1,0,0),vector(0,0,1)))});`), {feature:'f'});
  const body = model.bodies[0];
  body.validation.boundsMm = {min:[-1,-1,-1],max:[-1,-1,-1]};
  const bounds = certifiedBoundsRustBody(rustModelKernel(model),body);
  assert.ok(bounds.min[0] <= 65536000 && bounds.max[0] >= 65536001);
  assert.ok(bounds.occupiedBoxMm);
});

test('exact composed translation retains sub-ulp displacement instead of manufacturing clearance', async () => {
  // A rounded world-origin cache loses the +1 between the two huge shifts,
  // putting a at x=0 instead of x=1 and falsely declaring the touching pair clear.
  const model = await build(source(box('a','0,0,0','0.125,0.25,0.5','meter') +
    box('b','1.125,0,0','1.25,0.25,0.5','meter')), {feature:'f'});
  // Use the production motion placement boundary: intermediate huge-coordinate
  // display measurements may refuse, but are not needed to place or clash bodies.
  const kernel = rustModelKernel(model);
  for (const x of [2 ** 53, 1, -(2 ** 53)]) {
    model.bodies[0] = placeRustBody(kernel, model.bodies[0], {origin:[x,0,0],x:[1,0,0],z:[0,0,1]});
  }
  const pair = (await interferenceReport(model, {pairBudgetMs:DECIDED_PAIR_BUDGET_MS})).pairs[0];
  assert.equal(pair.phase, 'narrow');
  assert.equal(pair.type, 'ABUT_NO_CLASS');
  assert.equal(pair.distanceMm, 0);
  assert.equal(pair.distanceBoundMm, 0);
});

test('audited nested rounded profiles prove clearance without constructing a quadratic-crossing Boolean', async () => {
  const capsule = (id, x, y, width, radius, depth) => `const ${id}sk = newSketchOnPlane(context,id+"${id}sk",{"sketchPlane":plane(vector(${x},${y},0)*millimeter,vector(0,0,1))});
    skLineSegment(${id}sk,"bottom",{"start":vector(${radius},0)*millimeter,"end":vector(${width-radius},0)*millimeter});
    skArc(${id}sk,"right",{"start":vector(${width-radius},0)*millimeter,"mid":vector(${width},${radius})*millimeter,"end":vector(${width-radius},${2*radius})*millimeter});
    skLineSegment(${id}sk,"top",{"start":vector(${width-radius},${2*radius})*millimeter,"end":vector(${radius},${2*radius})*millimeter});
    skArc(${id}sk,"left",{"start":vector(${radius},${2*radius})*millimeter,"mid":vector(0,${radius})*millimeter,"end":vector(${radius},0)*millimeter}); skSolve(${id}sk);
    opExtrude(context,id+"${id}",{"entities":qSketchRegion(id+"${id}sk"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":${depth}*millimeter});`;
  const cut = (target, tool) => `opBoolean(context,id+"cut${target}",{"targets":${query(target)},"tools":${query(tool)},"operationType":BooleanOperationType.SUBTRACTION});`;
  const model=await build(source(box('plate','-2,-2,1','12,6,3')+capsule('hole',0,0,9,2,4)+cut('plate','hole')+capsule('sleeve',0.2,0.2,8.6,1.8,4)+capsule('bore',0.6,0.6,7.8,1.4,5)+cut('sleeve','bore')), {feature:'f'});
  const report=await interferenceReport(model, {pairBudgetMs:DECIDED_PAIR_BUDGET_MS});
  assert.equal(report.preparationMs>0,true);
  assert.deepEqual(report.summary,{pairs:1,interference:0,abutment:0,clear:1,refused:0},JSON.stringify(report.pairs));
  const pair=report.pairs[0];
  assert.equal(pair.phase,'narrow'); assert.equal(pair.type,'NONE');
  assert.equal(pair.volumeMm3,0); assert.equal(pair.volumeBoundMm3,0);
  assert.equal(pair.distanceMm,null); assert.equal(pair.distanceBoundMm,null);
  assert.equal(pair.distanceMeaning,'certified-lower-bound');
  assert.ok(pair.distanceLowerBoundMm>0 && pair.distanceLowerBoundMm<0.2);
});

test('source certificates retain exact cap contacts and reject positive-volume overlap and removed-face witnesses', async () => {
  const disk = (id,z,depth) => `const ${id}sk = newSketchOnPlane(context,id+"${id}sk",{"sketchPlane":plane(vector(0,0,${z})*meter,vector(0,0,1))});
    skCircle(${id}sk,"c",{"center":vector(0,0)*meter,"radius":0.125*meter});skSolve(${id}sk);
    opExtrude(context,id+"${id}",{"entities":qSketchRegion(id+"${id}sk"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":${depth}*meter});`;
  for (const [z,expected] of [[0.25,'ABUT_NO_CLASS'],[0.25-2**-30,'INTERFERE']]) {
    const model=await build(source(box('plate','-0.5,-0.5,0','0.5,0.5,0.25','meter')+disk('disk',z,0.25)),{feature:'f'});
    const pair=(await interferenceReport(model, {pairBudgetMs:DECIDED_PAIR_BUDGET_MS})).pairs[0];
    if(expected==='ABUT_NO_CLASS') {assert.equal(pair.type,expected);assert.equal(pair.volumeMm3,0);assert.equal(pair.distanceMm,0);}
    else {assert.notEqual(pair.kind,'clear');assert.notEqual(pair.kind,'abutment');if(pair.decided)assert.ok(pair.volumeMm3>0);}
  }
  const cut=`opBoolean(context,id+"cut",{"targets":${query('plate')},"tools":${query('void')},"operationType":BooleanOperationType.SUBTRACTION});`;
  const removed=await build(source(box('plate','0,0,0','1,1,1','meter')+box('void','0.125,0.125,0.5','0.875,0.875,1.5','meter')+cut+box('insert','0.25,0.25,1','0.75,0.75,1.25','meter')),{feature:'f'});
  const pair=(await interferenceReport(removed, {pairBudgetMs:DECIDED_PAIR_BUDGET_MS})).pairs[0];
  assert.equal(pair.type,'NONE');assert.ok(pair.distanceLowerBoundMm>0);
});

test('prepared source geometry is keyed by full immutable words, not reused body IDs', async () => {
  const separated=await build(source(box('a','0,0,0','10,10,10')+box('b','20,0,0','30,10,10')),{feature:'f'});
  const overlapping=await build(source(box('a','0,0,0','10,10,10')+box('b','5,0,0','15,10,10')),{feature:'f'});
  assert.deepEqual(separated.bodies.map(b=>b.id),overlapping.bodies.map(b=>b.id));
  const kernel=rustModelKernel(separated);
  assert.equal(clashRustBodies(kernel,...separated.bodies,{certify:true}).type,'NONE');
  const actual=clashRustBodies(kernel,...overlapping.bodies,{certify:true});
  assert.equal(actual.type,'INTERFERE');near(actual.volumeMm3,500,actual.volumeBoundMm3);
});

test('chamfer contact uses replayed rational vertices rather than rounded display caches', async () => {
  for (const [width, y, touching] of [[0.125, 0.875, true], [0.1, 0.9, false]]) {
    // Q(0.9) > 1-Q(0.1) by 2^-55 m. The display vertex rounds to 0.9,
    // inventing contact unless the exact construction points remain authoritative.
    const model = await build(source(box('base', '0,0,0', '1,1,1', 'meter') + `
      const edge = qClosestTo(qOwnedByBody(${query('base')},EntityType.EDGE),vector(0.5,1,1)*meter);
      opChamfer(context,id+"chamfer",{"entities":edge,"chamferType":ChamferType.EQUAL_OFFSETS,"width":${width}*meter});
    ` + box('insert', `0.25,${y},1`, '0.75,1.1,1.2', 'meter')), { feature: 'f' });
    const pair = (await interferenceReport(model, {pairBudgetMs:DECIDED_PAIR_BUDGET_MS})).pairs[0];
    assert.equal(pair.phase, 'narrow');
    if (touching) {
      assert.equal(pair.type, 'ABUT_NO_CLASS');
      assert.equal(pair.distanceMm, 0);
      assert.equal(pair.volumeMm3, 0);
    } else {
      assert.notEqual(pair.kind, 'abutment');
      if (pair.decided) {
        assert.equal(pair.type, 'NONE');
        assert.ok(pair.distanceLowerBoundMm > 0 || pair.distanceMm > pair.distanceBoundMm);
      } else {
        assert.equal(pair.kind, 'refused');
        assert.equal(typeof pair.refusal, 'string');
        assert.ok(pair.refusal.length > 0);
      }
    }
  }
});

test('a real expensive native pair exhausts its budget without starving broad results or later narrow pairs', async () => {
  // A multiply-connected planar slab has hundreds of faces; intersection
  // arrangement work is genuinely synchronous native work, not a mocked timer.
  const holes = Array.from({length:81},(_,i)=>box('h'+i,`${2+(i%9)*3},${2+Math.floor(i/9)*3},-1`,`${3+(i%9)*3},${3+Math.floor(i/9)*3},11`));
  const cut = `opBoolean(context,id+"cut",{"targets":${query('a')},"tools":qUnion([${Array.from({length:81},(_,i)=>query('h'+i)).join(',')}]),"operationType":BooleanOperationType.SUBTRACTION});`;
  const model = await build(source(box('a','0,0,0','30,30,10')+holes.join('')+cut+box('b','1,1,1','29,29,9')+box('c','100,0,0','101,1,1')+box('d','101,0,0','102,1,1')), {feature:'f'});
  const emitted = [];
  const report = await interferenceReport(model,{pairBudgetMs:25,onPairs: pairs => emitted.push(...pairs)});
  assert.equal(report.pairs.length,6); assert.equal(emitted.length,6);
  assert.equal(emitted[0].phase,'broad');
  const slow = report.pairs.find(p=>p.target.endsWith('/a')&&p.tool.endsWith('/b'));
  assert.equal(slow.kind,'refused'); assert.equal(slow.refusal,'interference/pair-work-budget-exceeded');
  const touching = report.pairs.find(p=>p.target.endsWith('/c')&&p.tool.endsWith('/d'));
  assert.equal(touching.phase,'narrow'); assert.equal(touching.type,'ABUT_NO_CLASS');
});

test('CLI JSONL batches are complete while stdout stays one JSON object; flags fail closed', () => {
  const dir=mkdtempSync(join(tmpdir(),'wonky-broad-'));
  try {
    const file=join(dir,'scene.fs'),stream=join(dir,'pairs.jsonl');
    writeFileSync(file,source(box('a','0,0,0','1,1,1')+box('b','2,0,0','3,1,1')+box('c','3,0,0','4,1,1')));
    const run=spawnSync(process.execPath,['bin/wonky.mjs',file,'--feature','f','--interference','--interference-pair-budget-ms',String(DECIDED_PAIR_BUDGET_MS),'--interference-stream',stream,'--json'],{cwd:root,encoding:'utf8',timeout:30000});
    assert.equal(run.status,0,run.stderr);
    const report=JSON.parse(run.stdout),rows=readFileSync(stream,'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows.length,3); assert.equal(rows[0].phase,'broad'); assert.equal(rows.at(-1).phase,'narrow');
    assert.deepEqual(rows.sort((a,b)=>(a.target+a.tool).localeCompare(b.target+b.tool)),report.interference.pairs.sort((a,b)=>(a.target+a.tool).localeCompare(b.target+b.tool)));
    const inputBytes=readFileSync(file,'utf8'),alias=join(dir,'input-alias.jsonl');
    symlinkSync(file,alias);
    const unsafe=spawnSync(process.execPath,['bin/wonky.mjs',file,'--interference','--interference-pair-budget-ms',String(DECIDED_PAIR_BUDGET_MS),'--interference-stream',alias,'--json'],{cwd:root,encoding:'utf8'});
    assert.equal(unsafe.status,1); assert.match(JSON.parse(unsafe.stdout).refusals[0].message,/must not overwrite/);
    assert.equal(readFileSync(file,'utf8'),inputBytes,'stream aliases must not corrupt input');
    const unrelated=join(dir,'unrelated.txt'),outputAlias=join(dir,'output-alias.jsonl');
    writeFileSync(unrelated,'preserve'); symlinkSync(unrelated,outputAlias);
    const safe=spawnSync(process.execPath,['bin/wonky.mjs',file,'--interference','--interference-pair-budget-ms',String(DECIDED_PAIR_BUDGET_MS),'--interference-stream',outputAlias,'--json'],{cwd:root,encoding:'utf8'});
    assert.equal(safe.status,0,safe.stderr); assert.equal(readFileSync(unrelated,'utf8'),'preserve');
    assert.equal(readFileSync(outputAlias,'utf8').trim().split('\n').length,3);
    for (const budget of ['0','NaN','1.5']) {
      const bad=spawnSync(process.execPath,['bin/wonky.mjs',file,'--interference','--interference-pair-budget-ms',budget,'--json'],{cwd:root,encoding:'utf8'});
      assert.equal(bad.status,1); assert.equal(JSON.parse(bad.stdout).status,'error');
    }
  } finally {rmSync(dir,{recursive:true,force:true});}
});
