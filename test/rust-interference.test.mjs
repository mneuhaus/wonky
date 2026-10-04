// Exact interference / abutment / clearance between Rust solids (evCollision and
// bin/wonky.mjs --interference). Closed forms only: every expected value is the
// hand-computed volume or gap of the construction, and the decision cases are
// exact-contact versus a gap of 2^-30 m, which a tolerance or a binary64 cache
// cannot separate. No production hook; the kernel's own Boolean/distance run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { clashRustBodies, placeRustBody, rustModelKernel } = await import('../src/native/rust-host.mjs');

const root = fileURLToPath(new URL('../', import.meta.url));
const source = statements => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
${statements}
});`;
const box = (id, lo, hi, unit = 'millimeter') => `fCuboid(context,id+"${id}",{"corner1":vector(${lo})*${unit},"corner2":vector(${hi})*${unit}});`;
const cyl = (id, bottom, top, r, unit = 'millimeter') => `fCylinder(context,id+"${id}",{"bottomCenter":vector(${bottom})*${unit},"topCenter":vector(${top})*${unit},"radius":${r}*${unit}});`;
const body = id => `qCreatedBy(id+"${id}",EntityType.BODY)`;
const subtract = (target, tool) => `opBoolean(context,id+"cut",{"targets":${body(target)},"tools":${body(tool)},"operationType":BooleanOperationType.SUBTRACTION});`;
const named = (model, key) => model.bodies.find(b => b.id.endsWith(`/${key}`));
const clash = async (statements, a = 'a', b = 'b') => {
  const model = await build(source(statements), { feature: 'f' });
  return clashRustBodies(rustModelKernel(model), named(model, a), named(model, b));
};
const near = (value, expected, bound) => assert.ok(Math.abs(value - expected) <= bound + 1e-9, `${value} vs ${expected} (+-${bound})`);

test('overlapping boxes interfere with the exact closed-form volume', async () => {
  const v = await clash(box('a', '0,0,0', '10,10,10') + box('b', '5,5,5', '15,15,15'));
  assert.equal(v.type, 'INTERFERE');
  assert.equal(v.kind, 'interference');
  near(v.volumeMm3, 125, v.volumeBoundMm3);
  assert.ok(v.volumeBoundMm3 < 1e-9);
  assert.equal(v.distanceMm, 0);
});

test('containment is classified by the exact subtraction, in both directions', async () => {
  const scene = box('a', '0,0,0', '10,10,10') + box('b', '2,2,2', '4,5,6');
  const inner = await clash(scene);
  assert.equal(inner.type, 'TOOL_IN_TARGET');
  near(inner.volumeMm3, 2 * 3 * 4, inner.volumeBoundMm3);
  assert.equal((await clash(scene, 'b', 'a')).type, 'TARGET_IN_TOOL');
});

test('boxes that only touch abut with zero volume, whether by face, partial face, edge or vertex', async () => {
  for (const [name, second] of [['face', '10,0,0:20,10,10'], ['partial face', '10,3,3:20,20,20'], ['edge', '10,10,0:20,20,10'], ['vertex', '10,10,10:20,20,20']]) {
    const [lo, hi] = second.split(':');
    const v = await clash(box('a', '0,0,0', '10,10,10') + box('b', lo, hi));
    assert.equal(v.type, 'ABUT_NO_CLASS', name);
    assert.equal(v.kind, 'abutment', name);
    assert.equal(v.volumeMm3, 0, name);
    assert.deepEqual([v.distanceMm, v.distanceBoundMm], [0, 0], name);
  }
});

test('boxes 1 mm apart are clear at the certified distance 1 mm', async () => {
  const v = await clash(box('a', '0,0,0', '10,10,10') + box('b', '11,0,0', '21,10,10'));
  assert.equal(v.type, 'NONE');
  assert.equal(v.kind, 'clear');
  near(v.distanceMm, 1, v.distanceBoundMm);
  assert.ok(v.distanceMm - v.distanceBoundMm > 0.999999);
});

test('square pin in a square hole: clearance is clear, touching abuts, interference fit has the exact overlap volume', async () => {
  const plate = box('a', '-10,-10,0', '10,10,10') + box('h', '-2,-2,-1', '2,2,11') + subtract('a', 'h');
  const clear = await clash(plate + box('b', '-1.75,-1.75,-5', '1.75,1.75,15'));
  assert.equal(clear.type, 'NONE');
  near(clear.distanceMm, 0.25, clear.distanceBoundMm);
  const touching = await clash(plate + box('b', '-2,-2,-5', '2,2,15'));
  assert.equal(touching.type, 'ABUT_NO_CLASS');
  assert.equal(touching.distanceMm, 0);
  // 0.25 mm of interference on the two x walls: 2 * 0.25 * 4 * 10 mm^3.
  const fit = await clash(plate + box('b', '-2.25,-2,-5', '2.25,2,15'));
  assert.equal(fit.type, 'INTERFERE');
  near(fit.volumeMm3, 20, fit.volumeBoundMm3);
});

test('a gap of 2^-30 m is clear at its exact distance while exact contact abuts', async () => {
  const gap = 2 ** -30, x = 0.5 + gap;   // dyadic: exact in binary64 metres
  const scene = (b0) => box('a', '0,0,0', '0.5,0.25,0.25', 'meter') + box('b', `${b0},0,0`, '1,0.25,0.25', 'meter');
  const apart = await clash(scene(x));
  assert.equal(apart.type, 'NONE');
  near(apart.distanceMm, gap * 1000, apart.distanceBoundMm);
  assert.ok(apart.distanceMm - apart.distanceBoundMm > 0);
  assert.ok(apart.distanceMm < 1e-6, 'the gap is below a 1e-6 mm tolerance');
  const touching = await clash(scene(0.5));
  assert.equal(touching.type, 'ABUT_NO_CLASS');
  assert.deepEqual([touching.distanceMm, touching.distanceBoundMm], [0, 0]);
});

test('parallel cylinders: tangent abuts, a 2^-30 m gap is clear, a 2^-30 m overlap is never taken for contact', async () => {
  const gap = 2 ** -30;
  const pair = x => cyl('a', '0,0,0', '0,0,1', 0.25, 'meter') + cyl('b', `${x},0,0`, `${x},0,1`, 0.25, 'meter');
  const tangent = await clash(pair(0.5));
  assert.equal(tangent.type, 'ABUT_NO_CLASS');
  assert.deepEqual([tangent.distanceMm, tangent.distanceBoundMm], [0, 0]);
  const apart = await clash(pair(0.5 + gap));   // dyadic: exact in binary64 metres
  assert.equal(apart.type, 'NONE');
  near(apart.distanceMm, gap * 1000, apart.distanceBoundMm);
  assert.ok(apart.distanceMm - apart.distanceBoundMm > 0);
  // The exact quadratic lens proves positive volume, never mere contact.
  const overlap = await clash(pair(0.5 - gap));
  assert.equal(overlap.distanceMm, 0);
  assert.equal(overlap.decided, true);
  assert.equal(overlap.type, 'INTERFERE');
  assert.equal(overlap.kind, 'interference');
  // Stable circular-segment expansion avoids subtracting nearly equal terms
  // in acos(d/2r)-d*sqrt(4r^2-d^2). The next term is below binary64 rounding.
  const expected = (4/3)*Math.sqrt(.25)*gap**1.5*(1-3*gap/(40*.25))*1e9;
  assert.ok(overlap.volumeMm3-overlap.volumeBoundMm3>0);
  near(overlap.volumeMm3, expected, overlap.volumeBoundMm3);
  assert.equal(overlap.refusal, undefined);
});

test('a pair the kernel cannot decide refuses by name and is never clear', async () => {
  const plate = box('a', '-10,-10,0', '10,10,10') + cyl('h', '0,0,-1', '0,0,11', 5) + subtract('a', 'h');
  for (const radius of [4.9, 5.1]) {   // clearance and interference round pin
    const v = await clash(plate + cyl('b', '0,0,-5', '0,0,15', radius));
    assert.equal(v.decided, false, `radius ${radius}`);
    assert.equal(v.type, null);
    assert.equal(v.kind, 'refused');
    assert.match(v.refusal, /mixed/);
    assert.equal(v.volumeMm3, null);
  }
});

test('half-cylinder interference proves neither body contains the other and evCollision returns INTERFERE', async () => {
  const scene = cyl('a', '0,0,0', '0,0,10', 5) + box('b', '0,-10,0', '10,10,10');
  const v = await clash(scene);
  assert.equal(v.decided, true);
  assert.equal(v.kind, 'interference');
  near(v.volumeMm3, 125 * Math.PI, v.volumeBoundMm3);
  assert.ok(v.volumeBoundMm3 < 1e-9);
  assert.equal(v.containment, 'none');
  assert.equal(v.exactClass, true);
  assert.equal(v.type, 'INTERFERE');
  const report = `const clashes=evCollision(context,{"tools":${body('b')},"targets":${body('a')}});
    if(size(clashes)!=1 || clashes[0]["type"]!=ClashType.INTERFERE) throw "incorrect cylinder clash";
    setProperty(context,{"entities":${body('a')},"propertyType":PropertyType.DESCRIPTION,"value":"INTERFERE"});`;
  const model = await build(source(scene + report), { feature: 'f' });
  assert.equal(named(model, 'a').description, 'INTERFERE');
});

test('a sphere cut at its equator by a box interferes, neither containing the other', async () => {
  // The intersection and both differences are exact hemisphere-type bodies
  // (boolean3d G14 emits the vertex-free sphere - box). A radius-5
  // hemisphere has volume 250 pi / 3 mm^3.
  const scene = 'fSphere(context,id+"a",{"center":vector(0,0,0)*millimeter,"radius":5*millimeter});'
    + box('b', '0,-10,-10', '10,10,10');
  const v = await clash(scene);
  assert.equal(v.decided, true);
  assert.equal(v.kind, 'interference');
  near(v.volumeMm3, 250 * Math.PI / 3, v.volumeBoundMm3);
  assert.ok(v.volumeBoundMm3 < 1e-9);
  assert.equal(v.containment, 'none');
  assert.equal(v.exactClass, true);
  assert.equal(v.type, 'INTERFERE');
  const report = `const clashes=evCollision(context,{"tools":${body('b')},"targets":${body('a')}});
    if(size(clashes)!=1 || clashes[0]["type"]!=ClashType.INTERFERE) throw "incorrect sphere clash";
    setProperty(context,{"entities":${body('a')},"propertyType":PropertyType.DESCRIPTION,"value":"INTERFERE"});`;
  const model = await build(source(scene + report), { feature: 'f' });
  assert.equal(named(model, 'a').description, 'INTERFERE');
});

test('proven interference whose containment is undecided carries no ClashType, and evCollision refuses it', async () => {
  // A radius-5 ball and a coaxial radius-3 pin (z 0..10): the intersection is
  // exact, the pin's part to z = 4 plus the ball's cap of height 1 above it,
  // 36 pi + 14 pi / 3 mm^3; the containment is not decided.
  const scene = 'fSphere(context,id+"a",{"center":vector(0,0,0)*millimeter,"radius":5*millimeter});'
    + cyl('b', '0,0,0', '0,0,10', 3);
  const v = await clash(scene);
  assert.equal(v.decided, true);
  assert.equal(v.kind, 'interference');
  near(v.volumeMm3, 122 * Math.PI / 3, v.volumeBoundMm3);
  assert.ok(v.volumeBoundMm3 < 1e-9);
  assert.equal(v.containment, 'undecided');
  assert.equal(v.exactClass, false);
  assert.equal(v.type, null, 'INTERFERE would claim that neither side contains the other');
  const refused = build(source(scene + `evCollision(context,{"tools":${body('b')},"targets":${body('a')}});`), { feature: 'f' });
  await assert.rejects(refused, e => e.name === 'RustCapabilityError' && e.builtin === 'evCollision' && /containment-undecided/.test(e.reason));
});

test('evCollision returns Onshape clash maps for clashing pairs only and refuses undecidable pairs', async () => {
  const names = `setProperty(context,{"entities":${body('a')},"propertyType":PropertyType.NAME,"value":"A"});
    setProperty(context,{"entities":${body('b')},"propertyType":PropertyType.NAME,"value":"B"});
    setProperty(context,{"entities":${body('c')},"propertyType":PropertyType.NAME,"value":"C"});
    setProperty(context,{"entities":${body('d')},"propertyType":PropertyType.NAME,"value":"D"});`;
  const report = `var tags = "";
    for (var c in evCollision(context,{"tools":qUnion([${body('b')},${body('c')},${body('d')}]),"targets":${body('a')}}))
    {
      const kind = c["type"] == ClashType.INTERFERE ? "I" : c["type"] == ClashType.ABUT_NO_CLASS ? "A" : c["type"] == ClashType.TOOL_IN_TARGET ? "T" : c["type"] == ClashType.TARGET_IN_TOOL ? "t" : "?";
      tags = tags ~ kind ~ getProperty(context,{"entity":c.target,"propertyType":PropertyType.NAME}) ~ getProperty(context,{"entity":c.tool,"propertyType":PropertyType.NAME}) ~ getProperty(context,{"entity":c.toolBody,"propertyType":PropertyType.NAME}) ~ " ";
    }
    setProperty(context,{"entities":${body('a')},"propertyType":PropertyType.DESCRIPTION,"value":tags});`;
  // b overlaps a, c touches a, d is 1 mm away: only b and c clash.
  const model = await build(source(box('a', '0,0,0', '10,10,10') + box('b', '5,5,5', '15,15,15') + box('c', '10,0,0', '20,10,10') + box('d', '11,20,0', '21,30,10') + names + report), { feature: 'f' });
  assert.equal(named(model, 'a').description, 'IABB AACC ');
  // Undecidable pair: a round pin in a round-holed plate refuses instead of returning [].
  const refused = build(source(box('a', '-10,-10,0', '10,10,10') + cyl('h', '0,0,-1', '0,0,11', 5) + subtract('a', 'h') + cyl('p', '0,0,-5', '0,0,15', 4.9)
    + `evCollision(context,{"tools":${body('p')},"targets":${body('a')}});`), { feature: 'f' });
  await assert.rejects(refused, e => e.name === 'RustCapabilityError' && e.builtin === 'evCollision' && /mixed/.test(e.reason));
});

test('the --interference CLI report lists every pair with type, volume, distance and refusals, and exits 2 on an undecided pair', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wonky-interference-'));
  try {
    const run = (statements, budget = ['--interference-pair-budget-ms', '5000']) => {
      const file = join(dir, 'scene.fs');
      writeFileSync(file, source(statements));
      const result = spawnSync(process.execPath, ['bin/wonky.mjs', file, '--feature', 'f', '--interference', '--json', ...budget], { cwd: root, encoding: 'utf8', env: { ...process.env, WONKY_BACKEND: 'rust' } });
      return { status: result.status, stderr: result.stderr, report: JSON.parse(result.stdout) };
    };
    const decided = run(box('a', '0,0,0', '10,10,10') + box('b', '5,5,5', '15,15,15') + box('c', '10,10,0', '20,20,10') + box('d', '30,0,0', '40,10,10'));
    assert.equal(decided.status, 0, decided.stderr);
    const { interference } = decided.report;
    assert.equal(interference.schema, 'wonky-interference/v1');
    assert.equal(interference.pairs.length, 6);
    assert.deepEqual(interference.summary, { pairs: 6, interference: 2, abutment: 1, clear: 3, refused: 0 });
    const pair = (x, y) => interference.pairs.find(p => p.target.endsWith(`/${x}`) && p.tool.endsWith(`/${y}`));
    assert.equal(pair('a', 'b').type, 'INTERFERE');
    near(pair('a', 'b').volumeMm3, 125, pair('a', 'b').volumeBoundMm3);
    assert.equal(pair('a', 'c').type, 'ABUT_NO_CLASS');
    assert.equal(pair('a', 'd').type, 'NONE');
    near(pair('a', 'd').distanceMm, 20, pair('a', 'd').distanceBoundMm);
    assert.ok(interference.notChecked.includes('motion'));

    // boolean3d G12: the general Boolean now proves this pin-in-hole
    // intersection empty before the distance refuses; that exact work took
    // about 0.4 s in a cold worker (measured 2026-10-03), above the default
    // 250 ms pair budget, so this undecided pair gets an explicit budget.
    const refused = run(box('a', '-10,-10,0', '10,10,10') + cyl('h', '0,0,-1', '0,0,11', 5) + subtract('a', 'h') + cyl('b', '0,0,-5', '0,0,15', 4.9),
      ['--interference-pair-budget-ms', '10000']);
    assert.equal(refused.status, 2);
    assert.equal(refused.report.status, 'partial');
    assert.deepEqual(refused.report.interference.summary, { pairs: 1, interference: 0, abutment: 0, clear: 0, refused: 1 });
    assert.match(refused.report.interference.pairs[0].refusal, /mixed/);
    assert.equal(refused.report.interference.pairs[0].type, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Exact nonconvex boundary, not a union-of-convex-parts modeling requirement.
const lPrism = `const sk = newSketchOnPlane(context,id+"sk",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1))});
  skPolyline(sk,"outline",{"points":[vector(0,0)*meter,vector(3,0)*meter,vector(3,1)*meter,vector(1,1)*meter,vector(1,3)*meter,vector(0,3)*meter,vector(0,0)*meter]});
  skSolve(sk);opExtrude(context,id+"a",{"entities":qSketchRegion(id+"sk",false),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":1*meter});
  opDeleteBodies(context,id+"delete",{"entities":qCreatedBy(id+"sk",EntityType.BODY)});`;
const rationalFrame = { rational: { rows: [[4,-3,0],[3,4,0],[0,0,5]], denominator: 5 } };

test('concave planar intersection and contact survive rational rotation with hand-calculated volume and gaps', async () => {
  for (const [lo, hi, type, expected] of [
    ['0.5,0.5,0','2,2,1','INTERFERE',1.25e9],
    ['1.5,1.5,0','2,2,1','NONE',500],
    ['1,1,0','2,2,1','ABUT_NO_CLASS',0],
  ]) {
    const model = await build(source(lPrism + box('b', lo, hi, 'meter')), { feature: 'f' });
    const kernel = rustModelKernel(model);
    const [a,b] = model.bodies.map(body => placeRustBody(kernel,body,rationalFrame));
    for (const [x,y] of [[a,b],[b,a]]) {
      const v = clashRustBodies(kernel,x,y);
      assert.equal(v.type, type, v.refusal);
      if (type === 'ABUT_NO_CLASS') {
        assert.equal(v.exactClass, true);
        assert.deepEqual([v.distanceMm, v.distanceBoundMm, v.volumeMm3, v.volumeBoundMm3], [0, 0, 0, 0]);
      }
      if (type === 'INTERFERE') near(v.volumeMm3, expected, v.volumeBoundMm3);
      else near(v.distanceMm, expected, v.distanceBoundMm);
    }
  }
});

test('a planar cavity and its island keep exact clearance rather than their convex hulls colliding', async () => {
  const model = await build(source(box('a','0,0,0','4,4,4','meter') + box('cutter','1,1,1','3,3,3','meter')
    + subtract('a','cutter') + box('b','1.5,1.5,1.5','2.5,2.5,2.5','meter')), { feature:'f' });
  const kernel = rustModelKernel(model);
  const [a,b] = model.bodies.map(body => placeRustBody(kernel,body,rationalFrame));
  const v = clashRustBodies(kernel,a,b);
  assert.equal(v.type, 'NONE', v.refusal);
  near(v.distanceMm, 500, v.distanceBoundMm);
});

test('a binary64 cos/sin 20 degree frame refuses by name instead of guessing an exact rotation', async () => {
  const model = await build(source(box('a','0,0,0','1,1,1')), { feature:'f' });
  const angle=20*Math.PI/180;
  assert.throws(() => placeRustBody(rustModelKernel(model),model.bodies[0],{
    origin:[0,0,0],x:[Math.cos(angle),Math.sin(angle),0],z:[0,0,1],
  }), e => e.name==='RustCapabilityError' && e.reason==='placement/rotation-not-exact');
  assert.throws(() => placeRustBody(rustModelKernel(model),model.bodies[0],{
    rational:{rows:[[5,0,0],[0,5,0],[0,0,4]],denominator:5},
  }), e => e.name==='RustCapabilityError' && e.reason==='placement/rational-not-isometric');
});

test('real nonconvex servo swings agree with the frozen convex split; columns clear by 3.3 mm and fork by 0.15 mm', async () => {
  const text=file=>readFileSync(new URL('../fixtures/motion/'+file,import.meta.url),'utf8');
  for (const part of ['FIT_SWING_POS','FIT_SWING_NEG']) {
    const reference=await build(text('servo-slide.fs'),{feature:'jawSlideMount',parameters:{part:'SlidePart.'+part}});
    const actual=await build(text('servo-slide-nonconvex.fs'),{feature:'jawSlideMount',parameters:{part:'SlidePart.'+part}});
    const coupling=actual.bodies.find(b=>b.id.endsWith('/c/cap')), bracket=actual.bodies.find(b=>b.id.endsWith('/b/plate'));
    const ak=rustModelKernel(actual),rk=rustModelKernel(reference);
    const refCoupling=reference.bodies.filter(b=>/\/k\/c(Cap|ProngA|ProngB)$/.test(b.id));
    const refBracket=reference.bodies.filter(b=>/\/k\/(plate|columnA|columnB|shelfA|shelfB|capA|capB|stopA|stopB)$/.test(b.id));
    assert.equal(refCoupling.length,3);assert.equal(refBracket.length,9);
    const split=refCoupling.flatMap(a=>refBracket.map(b=>clashRustBodies(rk,a,b)));
    assert.ok(split.every(v=>v.type==='NONE'));
    const whole=clashRustBodies(ak,coupling,bracket);
    assert.equal(whole.type,'NONE',whole.refusal);
    near(whole.distanceMm,Math.min(...split.map(v=>v.distanceMm)),whole.distanceBoundMm+Math.max(...split.map(v=>v.distanceBoundMm)));
    // Use the same physical column volumes from the independent split model.
    const columns=refBracket.filter(b=>b.id.includes('/column'));
    for (const column of columns) {
      const v=clashRustBodies(ak,coupling,column);
      assert.equal(v.type,'NONE',v.refusal);
      assert.ok(v.distanceMm-v.distanceBoundMm>=3.3,JSON.stringify(v));
      const oracle=refCoupling.map(a=>clashRustBodies(rk,a,column));
      near(v.distanceMm,Math.min(...oracle.map(v=>v.distanceMm)),v.distanceBoundMm+Math.max(...oracle.map(v=>v.distanceBoundMm)));
    }
    const arm=actual.bodies.find(b=>b.id.endsWith('/s/arm'));
    const gap=clashRustBodies(ak,coupling,arm);
    assert.equal(gap.type,'NONE',gap.refusal);
    near(gap.distanceMm,0.15,gap.distanceBoundMm);
  }
});
