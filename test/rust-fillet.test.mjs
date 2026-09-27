// Interpreter transport and query/refusal lifecycle. Exact geometry is owned
// by wonky-ops/tests/fillet.rs; no test-only kernel seam and no Bend backend.
import test from 'node:test';
import assert from 'node:assert/strict';
process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { RustCapabilityError } = await import('../src/native/rust-host.mjs');
const source = statements => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
export const f = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {
  fCuboid(context,id+"box",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(16,12,8)*millimeter});
  const body = qCreatedBy(id+"box",EntityType.BODY);
  ${statements}
});`;
const edges = 'qOwnedByBody(body,EntityType.EDGE)';
const edge = `qClosestTo(${edges},vector(16,12,4)*millimeter)`;
const run = statements => build(source(statements), { feature: 'f' });

test('owned native topology and closest-edge queries evaluate without legacy B-rep access', async () => {
  const model = await run(`
    if(size(evaluateQuery(context,${edges}))!=12)throw "edge ownership";
    if(size(evaluateQuery(context,qOwnedByBody(body,EntityType.FACE)))!=6)throw "face ownership";
    if(size(evaluateQuery(context,qOwnedByBody(body,EntityType.VERTEX)))!=8)throw "vertex ownership";
    if(size(evaluateQuery(context,qCreatedBy(id+"box",EntityType.EDGE)))!=12)throw "creator ownership";
    const nearest=evaluateQuery(context,${edge});
    if(size(nearest)!=1)throw "nearest edge";
    if(size(evaluateQuery(context,nearest[0]))!=1)throw "query reference";
    if(size(evaluateQuery(context,qClosestTo(${edges},vector(0,0,0)*millimeter)))!=3)throw "corner tie";
    if(size(evaluateQuery(context,qClosestTo(qNothing(),vector(0,0,0)*millimeter)))!=0)throw "empty query";
  `);
  assert.equal(model.bodies.length, 1);
  assert.equal(model.backend.language, 'Rust');
});

test('closest-edge transport keeps SI values and transformed-body identity at all placements', async () => {
  const frames = [
    'coordSystem(vector(0,0,0)*millimeter,vector(1,0,0),vector(0,0,1))',
    'coordSystem(vector(65536.25,-32768.5,16384.125)*millimeter,vector(1,0,0),vector(0,0,1))',
    'coordSystem(vector(0,0,0)*millimeter,vector(0,0,1),vector(0,-1,0))',
    'coordSystem(vector(17,19,23)*millimeter,vector(0.6,0.8,0),vector(0,0,1))',
  ];
  for (const frame of frames) {
    const model = await run(`
      const cs=${frame};
      opTransform(context,id+"place",{"bodies":body,"transform":toWorld(cs)});
      const point=toWorld(cs,vector(16,12,4)*millimeter);
      if(size(evaluateQuery(context,qClosestTo(${edges},point)))!=1)throw "placed nearest edge";
      const e=evaluateQuery(context,qClosestTo(${edges},toWorld(cs,vector(16,12,4)*millimeter)))[0];
      const near=qClosestTo(qUnion([e,qClosestTo(${edges},toWorld(cs,vector(0,12,4)*millimeter))]),point);
      if(size(evaluateQuery(context,near))!=1)throw "candidate filter";
    `);
    assert.equal(model.bodies.length, 1);
  }
});

test('default edge overflow remains an uncaught capability rather than false infeasibility', async () => {
  for (const [radius, reason] of [[20, 'fillet/edge-overflow-unimplemented']]) {
    for (const explicitDefault of ['', ',"allowEdgeOverflow":true']) {
      await assert.rejects(run(`try silent { opFillet(context,id+"fillet",{"entities":${edge},"radius":${radius}*millimeter${explicitDefault}}); }`), error => {
        assert.ok(error instanceof RustCapabilityError);
        assert.equal(error.reason, reason);
        assert.equal(error.builtin, 'opFillet');
        assert.equal(error.refusalCategory, undefined);
        return true;
      });
    }
  }
});

test('unsupported selection and options refuse at their owning boundary, not as empty success', async () => {
  const cases = [
    [`opFillet(context,id+"f",{"entities":qNothing(),"radius":1*millimeter});`, 'opFillet', 'fillet/empty-selection'],
    [`opFillet(context,id+"f",{"entities":body,"radius":1*millimeter});`, 'opFillet', 'fillet/requires-line-edges'],
    [`opFillet(context,id+"f",{"entities":${edge},"radius":1*millimeter,"allowEdgeOverflow":false});`, 'opFillet', 'fillet/option-allowEdgeOverflow'],
  ];
  for (const [statement, builtin, reason] of cases) {
    await assert.rejects(run(`try silent { ${statement} }`), error => error instanceof RustCapabilityError && error.builtin === builtin && error.reason === reason);
  }
});

test('a real fillet replaces the native body and preserves creator queries and metadata', async () => {
  const model = await run(`
    setProperty(context,{"entities":body,"propertyType":PropertyType.NAME,"value":"kept-name"});
    setProperty(context,{"entities":body,"propertyType":PropertyType.DESCRIPTION,"value":"kept-description"});
    opFillet(context,id+"blend",{"entities":${edge},"radius":4*millimeter});
    if(size(evaluateQuery(context,body))!=1)throw "old creator body lost";
    if(size(evaluateQuery(context,qCreatedBy(id+"blend",EntityType.BODY)))!=1)throw "new creator body lost";
    if(size(evaluateQuery(context,${edges}))!=15)throw "old topology retained";
  `);
  assert.equal(model.bodies.length, 1);
  const body = model.bodies[0];
  assert.equal(body.name, 'kept-name');
  assert.equal(body.description, 'kept-description');
  assert.equal(body.validation.certificate, 'RollingBallPrism');
});

test('binary64 sketch placement preserves source-radius blends and declares its world export budget', async () => {
  for (const [point, count, certificate, volume] of [
    [[16, 12, 4], 15, 'RollingBallPrism', 1508.5309649148734],
    [[0, 0, 0], 21, 'RollingBallCorner', 1423.1032163829113],
  ]) {
    const model = await run(`
      const cs=coordSystem(vector(17,19,23)*millimeter,vector(0.6,0.8,0),vector(0,0,1));
      opTransform(context,id+"pose",{"bodies":body,"transform":toWorld(cs)});
      opFillet(context,id+"blend",{"entities":qClosestTo(${edges},toWorld(cs,vector(${point.join(',')})*millimeter)),"radius":4*millimeter});
      if(size(evaluateQuery(context,${edges}))!=${count})throw "source blend missing";
    `);
    const validation = model.bodies[0].validation;
    assert.equal(validation.certificate, certificate);
    assert.ok(Math.abs(validation.volumeMm3 - volume) < 1e-8);
    assert.ok(validation.toleranceMm > 0 && validation.toleranceMm < 1e-8);
  }
});
