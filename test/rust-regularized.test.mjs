// Owning contracts: real FS -> replayed native geometry, and public CLI labels.
// Regressions: ignoring the opt-in policy, epsilon admission above cap, losing
// provenance in WC0 replay/copies or claiming regularized STEP as exact. Existing
// strict arc tests cannot exercise policy admission. No test-only product seam.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
process.env.WONKY_BACKEND = 'rust';
const {build} = await import('../src/index.mjs');
const {toStep, toStl} = await import('../src/exporters.mjs');
const {serializeModel} = await import('../src/construction-history.mjs');
const {measureRustBody, rustModelKernel} = await import('../src/native/rust-host.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const policy = cap => ({curvedContacts: 'tolerated-regularized', contactCapMm: cap});
const source = (lines, arcs, extra = '') => `FeatureScript 3044;
import(path:"onshape/std/geometry.fs",version:"3044.0");
export const f=defineFeature(function(context is Context,id is Id,definition is map) precondition {} {
var s=newSketchOnPlane(context,id+"s",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,0,1),vector(1,0,0))});
${lines.map((s,i) => `skLineSegment(s,"line${i}",{"start":vector(${s.slice(0,2)})*meter,"end":vector(${s.slice(2)})*meter});`).join('\n')}
${arcs.map((s,i) => `skArc(s,"arc${i}",{"start":vector(${s.slice(0,2)})*meter,"mid":vector(${s.slice(2,4)})*meter,"end":vector(${s.slice(4)})*meter});`).join('\n')}
skSolve(s);opExtrude(context,id+"e",{"entities":qSketchRegion(id+"s"),"direction":vector(0,0,1),"endBound":BoundingType.BLIND,"endDepth":0.002*meter});${extra}});`;
const fixtures = {
  slot: {
    lines: [[0,-.005,.02,-.005],[.02,.005,0,.005]],
    arcs: [[0,.005,-.005,0,0,-.005],[.02,-.005,.0250000000000001,0,.02,.005]],
    volume: (200 + 25*Math.PI)*2,
  },
  biarc: {
    lines: [[.01,.01,.02,.01],[.02,.01,.02,-.01],[.02,-.01,0,-.01],[0,-.01,0,0]],
    arcs: [[0,0,.003,.0010000000000001,.005,.005],[.005,.005,.007,.009,.01,.01]],
    volume: 700,
  },
  horn: {
    lines: [[0,-.005,0,0],[-.005,-.005,-.005,-.01],[-.005,-.01,.005,-.01],[.005,-.01,.005,-.005],[.005,-.005,0,-.005],[0,-.01,0,-.005]],
    arcs: [[0,0,-.002,-.0040000000000001,-.005,-.005]],
    volume: (75-25*Math.PI/4)*2,
  },
};
for (const [name, {lines, arcs, volume}] of Object.entries(fixtures)) {
  test(`declared regularization builds ${name} with bounded changes and valid analytic topology`, async () => {
    const model = await build(source(lines, arcs), {feature:'f', modelingPolicy:policy(1e-9)});
    assert.equal(model.bodies.length, 1);
    const body = model.bodies[0], m = measureRustBody(rustModelKernel(model), body);
    assert.equal(m.validity.closed, true);
    assert.ok(Math.abs(m.volumeMm3 - volume) < 1e-7, `${name} volume ${m.volumeMm3} != ${volume}`);
    assert.equal(body.exactness, 'regularized');
    assert.equal(m.regularization.exact, false);
    assert.ok(m.regularization.merges.length > 0);
    for (const merge of m.regularization.merges) {
      assert.equal(merge.operation, 'skSolve');
      assert.equal(merge.entities.length, 2);
      assert.ok(merge.maxResidualMm > 0 && merge.maxResidualMm <= 1e-9);
      const rational = merge.boundMmExact;
      assert.ok(BigInt(rational.numerator) > 0n && BigInt(rational.denominator) > 0n);
    }
    const record = JSON.parse(serializeModel(model)).bodies[0];
    assert.equal(record.exact, false);
    assert.equal(record.exactness, 'regularized');
    assert.equal(record.regularization.merges.length, m.regularization.merges.length);
    assert.ok(toStep(model, name).includes('MANIFOLD_SOLID_BREP'));
    const mesh = toStl(model, {deviationMm:.02});
    assert.ok(mesh.readUInt32LE(80) > 0);
    // Retained for the independent STEP validity oracle on the Studio.
    const out = path.join(root, 'out/regularized-tests'); fs.mkdirSync(out, {recursive:true});
    fs.writeFileSync(path.join(out, `${name}.step`), toStep(model, name));
    fs.writeFileSync(path.join(out, `${name}.brep.json`), serializeModel(model));
  });
}
test('default remains exact-or-refused and an insufficient regularization cap refuses by name', async () => {
  const {lines, arcs} = fixtures.horn;
  await assert.rejects(build(source(lines, arcs), {feature:'f'}), e => e.name === 'RustCapabilityError' && e.reason.startsWith('arc-profile/'));
  await assert.rejects(build(source(lines, arcs), {feature:'f', modelingPolicy:policy(1e-16)}),
    e => e.reason === 'arc-profile/regularization/residual-above-cap-or-unresolved-topology');
  // A dyadic metre slot is exactly tangent and must not be relabelled merely
  // because the policy was selected (zero cap cannot merge anything).
  const dyadic = source([[0,-.125,.5,-.125],[.5,.125,0,.125]], [[0,.125,-.125,0,0,-.125],[.5,-.125,.625,0,.5,.125]]);
  const model = await build(dyadic, {feature:'f', modelingPolicy:policy(0)});
  assert.equal(model.bodies[0].exactness, undefined);
  assert.equal(measureRustBody(rustModelKernel(model), model.bodies[0]).regularization.merges.length, 0);
});
test('CLI and brep.json never label regularized STEP or tessellated STL exact', () => {
  const prefix = path.join(root, 'out/regularized-tests/cli');
  fs.mkdirSync(path.dirname(prefix), {recursive:true});
  fs.writeFileSync(`${prefix}.fs`, source(fixtures.slot.lines, fixtures.slot.arcs));
  const run = spawnSync(process.execPath, [path.join(root, 'bin/wonky.mjs'), `${prefix}.fs`, '--feature','f','--json','--out',prefix,
    '--curved-contacts','tolerated-regularized','--contact-cap-mm','1e-9'], {encoding:'utf8', cwd:root, env:process.env});
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.schema, 'wonky-cli/v1');
  assert.equal(report.exact, false);
  assert.equal(report.geometryClass, 'regularized');
  assert.ok(report.regularization.merges.length > 0);
  assert.equal(report.bodies[0].exact, false);
  assert.equal(report.bodies[0].geometryClass, 'regularized');
  for (const format of ['step','brep.json','stl']) {
    const output = report.outputs.find(o => o.format === format);
    assert.ok(output, `missing ${format}: ${run.stderr}`);
    assert.equal(output.exact, false);
  }
  assert.equal(report.outputs.find(o => o.format === 'stl').approximation, 'tessellated mesh');
  assert.equal(JSON.parse(fs.readFileSync(`${prefix}.brep.json`)).regularization.label, 'regularized');
});

// A supported arc placement keeps regularization visible. A later unsupported
// curved-source shell must preserve the completed merge evidence on its refusal.
test('downstream shell refusal retains completed regularization evidence', async () => {
  const copy = `opPattern(context,id+"copy",{"entities":qCreatedBy(id+"e",EntityType.BODY),
      "transforms":[rotationAround(line(vector(0,0,0)*meter,vector(0,0,1)),90*degree)],"instanceNames":["rotated"]});`;
  const completed = await build(source(fixtures.slot.lines, fixtures.slot.arcs, copy),
    {feature:'f', modelingPolicy:policy(1e-9)});
  assert.equal(completed.bodies.length,2);
  for (const body of completed.bodies) {
    const observation = measureRustBody(rustModelKernel(completed),body);
    assert.ok(Math.abs(observation.volumeMm3-fixtures.slot.volume)<1e-7);
    assert.equal(body.exactness,'regularized');
    assert.equal(observation.regularization.exact,false);
    assert.ok(observation.regularization.merges.length>0);
  }
  await assert.rejects(build(source(fixtures.slot.lines, fixtures.slot.arcs, copy+`
    opShell(context,id+"shell",{"entities":qClosestTo(qOwnedByBody(qCreatedBy(id+"e",EntityType.BODY),EntityType.FACE),vector(.01,0,.002)*meter),"thickness":-.0001*meter});`),
    {feature:'f', modelingPolicy:policy(1e-9)}), error => {
      assert.equal(error.reason, 'shell/non-box-source');
      const merges = error.completedOperationEvidence.flatMap(e => e.regularization?.merges ?? []);
      assert.ok(merges.length > 0);
      assert.equal(merges[0].sketch, 'model/s');
      return true;
    });
});

const arcPattern = `opPattern(context,id+"copy",{"entities":qCreatedBy(id+"e",EntityType.BODY),
  "transforms":[rotationAround(line(vector(0,0,0)*meter,vector(0,0,1)),90*degree)],"instanceNames":["rotated"]});`;

test('arc pattern placement preserves regularized volume, provenance and export labels', async () => {
  const model = await build(source(fixtures.slot.lines, fixtures.slot.arcs, arcPattern),
    {feature:'f', modelingPolicy:policy(1e-9)});
  assert.equal(model.bodies.length, 2);
  for (const body of model.bodies) {
    const measured = measureRustBody(rustModelKernel(model), body);
    assert.equal(measured.validity.closed, true);
    assert.ok(Math.abs(measured.volumeMm3 - fixtures.slot.volume) < 1e-7);
    assert.equal(body.exactness, 'regularized');
    assert.equal(measured.regularization.exact, false);
    assert.ok(measured.regularization.merges.length > 0);
  }
  const records = JSON.parse(serializeModel(model)).bodies;
  assert.equal(records.length, 2);
  assert.ok(records.every(body => body.exact === false && body.exactness === 'regularized'));
  assert.ok(toStep(model, 'regularized-pattern').includes('MANIFOLD_SOLID_BREP'));
});

// Placement now builds. Rotating the slot about Z keeps its extrusion along Z,
// while the cutting cylinder runs along X. The general stack must refuse those
// non-parallel axes without erasing earlier regularization merges.
test('downstream named refusal retains completed regularization evidence', async () => {
  await assert.rejects(build(source(fixtures.slot.lines, fixtures.slot.arcs, arcPattern + `
    fCylinder(context,id+"cross",{"bottomCenter":vector(-.01,0,.001)*meter,
      "topCenter":vector(.03,0,.001)*meter,"radius":.001*meter});
    opBoolean(context,id+"cut",{"targets":qCreatedBy(id+"copy",EntityType.BODY),
      "tools":qCreatedBy(id+"cross",EntityType.BODY),"operationType":BooleanOperationType.SUBTRACTION});`),
    {feature:'f', modelingPolicy:policy(1e-9)}), error => {
      assert.equal(error.name, 'RustCapabilityError');
      assert.equal(error.builtin, 'opBoolean');
      // boolean3d G12: the family refusal routes to the general Boolean, which refuses by its own row.
      assert.equal(error.reason, 'boolean/ssi-row-unavailable');
      const merges = error.completedOperationEvidence.flatMap(e => e.regularization?.merges ?? []);
      assert.ok(merges.length > 0);
      assert.equal(merges[0].sketch, 'model/s');
      return true;
    });
});

// Carrier-level fallback owner: exact cap admission is observable even while
// sewing the mixed curved Boolean is unavailable. A match must never fabricate
// a successful solid, applied merge or export. Uses synthetic source only.
const boreArcs = [[.0390625,0,.03125,.0234375,0,.0390625],
  [0,.0390625,-.03125,.0234375,-.0390625,0],
  [-.0390625,0,0,-.0390625,.0390625,0]];
const coincidentSource = ({kind='cylinder', radius=.03906250000000001, origin=0, arcs=boreArcs, lines=[]}={}) => source(lines, arcs, `
  ${kind === 'cylinder' ? `fCylinder(context,id+"other",{"bottomCenter":vector(${origin},0,0)*meter,"topCenter":vector(${origin},0,.01)*meter,"radius":${radius}*meter});` : `
  var meridian=newSketchOnPlane(context,id+"m",{"sketchPlane":plane(vector(0,0,0)*meter,vector(0,-1,0),vector(0,0,1))});
  const pts=[vector(0,0),vector(0,${radius}),vector(.01,.0625),vector(.01,0)];
  for(var i=0;i<4;i+=1)skLineSegment(meridian,"p"~i,{"start":pts[i]*meter,"end":pts[(i+1)%4]*meter});
  skSolve(meridian);opRevolve(context,id+"other",{"entities":qSketchRegion(id+"m"),"axis":line(vector(0,0,0)*meter,vector(0,0,1)),"angleForward":360*degree});`}
  opBoolean(context,id+"join",{"tools":qUnion([qCreatedBy(id+"e",EntityType.BODY),qCreatedBy(id+"other",EntityType.BODY)]),"operationType":BooleanOperationType.UNION});`);

// A coaxial cylinder one ulp wider and taller than the bore disc swallows the
// prism: the round operand is a ring leaf of the prism stack, so this union is
// an exact build (the cylinder), with no carrier candidate left to report.
test('a coaxial cylinder that swallows the disc prism builds exactly through the stack', async () => {
  for (const cap of [undefined, 1e-9, 1e-20, 0]) {
    const model = await build(coincidentSource(), {feature:'f', ...(cap === undefined ? {} : {modelingPolicy:policy(cap)})});
    assert.equal(model.bodies.length, 1);
    const body = model.bodies[0], m = measureRustBody(rustModelKernel(model), body);
    assert.equal(m.validity.closed, true);
    const expected = Math.PI * .03906250000000001 ** 2 * 1e9 * .01;
    assert.ok(Math.abs(m.volumeMm3 - expected) < 1e-6 * expected, `volume ${m.volumeMm3} != ${expected}`);
    assert.notEqual(body.exactness, 'regularized');
    assert.equal(m.regularization?.merges?.length ?? 0, 0);
  }
});

// A frustum one ulp wider than the three-arc disc at its base swallows it:
// the general Boolean splits the disc's strips and imprints the coplanar
// bottoms (boolean3d G12b), so the union is the frustum, exactly, whatever
// the cap; no carrier candidate is left to report.
test('a frustum that swallows the disc prism builds exactly through the general Boolean', async () => {
  for (const cap of [undefined, 1e-9, 1e-20, 0]) {
    const model = await build(coincidentSource({kind:'cone'}), {feature:'f', ...(cap === undefined ? {} : {modelingPolicy:policy(cap)})});
    assert.equal(model.bodies.length, 1);
    const body = model.bodies[0], m = measureRustBody(rustModelKernel(model), body);
    assert.equal(m.validity.closed, true);
    const [r0, r1, h] = [.03906250000000001, .0625, .01];
    const expected = Math.PI * h / 3 * (r0 * r0 + r0 * r1 + r1 * r1) * 1e9;
    assert.ok(Math.abs(m.volumeMm3 - expected) < 1e-9 * expected, `volume ${m.volumeMm3} != ${expected}`);
    assert.equal(m.topology.faces, 3);
    assert.notEqual(body.exactness, 'regularized');
    assert.equal(m.regularization?.merges?.length ?? 0, 0);
  }
});

test('coincident primitive and circumcircle carriers prove the cap but refuse missing Boolean topology', async () => {
  for (const options of [
    {radius:.005,lines:[[0,-.005,0,.005]],arcs:[[0,.005,.00500000000000001,0,0,-.005]]},
    {origin:1e-17},
  ]) {
    const input=coincidentSource(options);
    await assert.rejects(build(input,{feature:'f'}),e=>e.builtin==='opBoolean' && !e.carrierCoincidence);
    for (const [cap,within] of [[1e-9,true],[1e-20,false]]) {
      await assert.rejects(build(input,{feature:'f',modelingPolicy:policy(cap)}),e=>{
        assert.equal(e.reason,`regularization/coincidence/${within?'boolean-arrangement-unimplemented':'residual-bound-above-cap'}`);
        assert.equal(e.carrierCoincidence.operationId,'model/join');
        const checks=e.carrierCoincidence.coincidences;
        assert.equal(checks.length,(options.arcs ?? boreArcs).length);
        for(const check of checks) {
          assert.equal(check.applied,false);
          assert.equal(check.withinCap,within);
          assert.ok(check.maxResidualMm>0);
          assert.equal(check.maxResidualMm<=cap,within);
          assert.equal(check.entities[0].body,'model/e');
          assert.equal(check.entities[1].body,'model/other');
          assert.ok(BigInt(check.boundMmExact.numerator)>0n);
        }
        return true;
      });
    }
  }
  // One binary64 step below the outward report is below the exact rational
  // bound. Admission must not compare a rounded-down residual or add epsilon.
  let upper;
  const nearCoincident = coincidentSource({origin:1e-17});
  await assert.rejects(build(nearCoincident,{feature:'f',modelingPolicy:policy(1e-9)}),e=>{
    upper=e.carrierCoincidence.coincidences[0].maxResidualMm; return true;
  });
  const bits=new DataView(new ArrayBuffer(8));bits.setFloat64(0,upper);bits.setBigUint64(0,bits.getBigUint64(0)-1n);
  for(const [cap,admitted] of [[upper,true],[bits.getFloat64(0),false]]) {
    await assert.rejects(build(nearCoincident,{feature:'f',modelingPolicy:policy(cap)}),e=>{
      assert.ok(e.carrierCoincidence.coincidences.every(c=>c.withinCap===admitted)); return true;
    });
  }
  const separated=coincidentSource().replace('vector(0,0,0)*meter,"topCenter":vector(0,0,.01)',
    'vector(0,0,.02)*meter,"topCenter":vector(0,0,.03)');
  await assert.rejects(build(separated,{feature:'f',modelingPolicy:policy(1e-9)}),e=>{
    // The axially separated cylinder would be a second lump; the column
    // arrangement owns profile-cylinder unions and refuses it by name.
    assert.equal(e.reason,'prism-stack/multiple-result-bodies');
    assert.equal(e.carrierCoincidence,undefined); return true;
  });
  // Exact equality needs no tolerance: retaining the periodic seam now serves
  // the actual cylinder topology. Near-coincident cases above remain refused.
  for (const modelingPolicy of [undefined, policy(0)]) {
    const model = await build(coincidentSource({radius:.0390625}), {feature:'f', ...(modelingPolicy ? {modelingPolicy} : {})});
    assert.equal(model.bodies.length, 1);
    const body = model.bodies[0], measured = measureRustBody(rustModelKernel(model), body);
    const expected = Math.PI * .0390625 ** 2 * .01 * 1e9;
    assert.ok(Math.abs(measured.volumeMm3 - expected) <= expected * 1e-10);
    assert.equal(measured.validity.closed, true);
    assert.equal(measured.topology.genus, 0);
    assert.notEqual(body.exactness, 'regularized');
    assert.equal(measured.regularization?.merges?.length ?? 0, 0);
    assert.ok(toStep(model, 'coincident-exact').includes('CYLINDRICAL_SURFACE('));
    assert.ok(toStl(model, {deviationMm:.02}).length > 84);
    const out = path.join(root, 'out/regularized-tests'); fs.mkdirSync(out, {recursive:true});
    fs.writeFileSync(path.join(out, 'coincident-exact.step'), toStep(model, 'coincident-exact'));
    fs.writeFileSync(path.join(out, 'coincident-exact.brep.json'), serializeModel(model));
  }
});

test('CLI distinguishes bounded carrier candidates from applied regularization merges', () => {
  const prefix=path.join(root,'out/regularized-tests/coincidence');
  fs.mkdirSync(path.dirname(prefix),{recursive:true});
  fs.writeFileSync(`${prefix}.fs`,coincidentSource({origin:1e-17}));
  const run=spawnSync(process.execPath,[path.join(root,'bin/wonky.mjs'),`${prefix}.fs`,'--feature','f','--json','--check',
    '--curved-contacts','tolerated-regularized','--contact-cap-mm','1e-9'],{encoding:'utf8',cwd:root,env:process.env});
  assert.equal(run.status,2,run.stderr);
  const report=JSON.parse(run.stdout);
  assert.equal(report.status,'refused');
  assert.equal(report.refusals[0].code,'regularization/coincidence/boolean-arrangement-unimplemented');
  assert.equal(report.outputs.length,0);
  assert.equal(report.bodies.length,0);
  assert.equal(report.regularization.merges.length,0);
  assert.equal(report.regularization.coincidences.length,3);
  assert.ok(report.regularization.coincidences.every(c=>c.withinCap && !c.applied));
});
