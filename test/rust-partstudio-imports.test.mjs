import test from 'node:test';
import { missing, missingBend } from './helpers/public-tree.mjs';
const publicTreeSkip = missing("fixtures/r20-modules/onshape-store/manifests/cad-project-041/single-step-r20/build/studios/context.fs.json");
if (publicTreeSkip) {
  test("rust-partstudio-imports.test.mjs", { skip: publicTreeSkip }, () => {});
} else {
const { default: assert } = await import("node:assert/strict");
const { default: fs } = await import("node:fs");
const { default: os } = await import("node:os");
const { default: path } = await import("node:path");
const { createHash } = await import("node:crypto");
const { fileURLToPath } = await import("node:url");
// Import owner boundary: real frozen source regeneration, source-query lifetime,
// native instantiation and downstream Boolean. No live Onshape dependencies.







process.env.WONKY_BACKEND = 'rust';
const { build } = await import('../src/index.mjs');
const { measureRustBody, describeRustBody, rustModelKernel, RustCapabilityError } = await import('../src/native/rust-host.mjs');
const { frozenModules, manifestInputFiles, instantiatorBuiltins } = await import('../src/modules.mjs');
const { loadKernel } = await import('../src/kernel.mjs');
const { ModelingContext } = await import('../src/library.mjs');
const { Id, map, tagOf } = await import('../src/values.mjs');
const { UnsupportedFeatureError } = await import('../src/errors.mjs');
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = path.join(root, 'fixtures/fs-partstudio-imports');
const manifest = path.join(fixture, 'modules.json');
const read = name => fs.readFileSync(path.join(fixture, name), 'utf8');
const sha = data => createHash('sha256').update(data).digest('hex');
const sourceId = '111111111111111111111111', revision = '222222222222222222222222';
const rawManifest = path.join(root, 'fixtures/r20-modules/onshape-store/manifests/cad-project-041/single-step-r20/build/studios/context.fs.json');
const rawId = 'onshape-id-019892ef', rawRevision = 'onshape-id-676f05b9';
const feature = (body, imports = `rails::import(path : "${sourceId}", version : "${revision}");`) => `FeatureScript 3044;
import(path : "onshape/std/geometry.fs", version : "3044.0");
import(path : "onshape/std/instantiator.fs", version : "3044.0");
${imports}
export const probe = defineFeature(function(context is Context, id is Id, definition is map) precondition {} {${body}});`;
const options = { moduleManifest: manifest, trace: false };
function store(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wonky-imports-'));
  fs.cpSync(fixture, dir, { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('two frozen Part Studios derive real native parts and union them to the independent exact volume', async () => {
  const provenance = JSON.parse(read('provenance.json'));
  for (const entry of provenance.files) assert.equal(sha(read(entry.path)), entry.sha256, entry.path);
  const model = await build(read('derived.fs'), options);
  assert.equal(model.bodies.length, 2, 'joined rail and untouched derived spare, no source leakage');
  const kernel = rustModelKernel(model);
  const measurements = model.bodies.map(body => measureRustBody(kernel, body));
  // Union: 8*4*4 + 8*4*4 - 4*4*4 = 192; spare: 8*4*4 = 128.
  const volumes = measurements.map(m => m.volumeMm3).sort((a, b) => a - b);
  assert.ok(Math.abs(volumes[0] - 128) < 1e-10);
  assert.ok(Math.abs(volumes[1] - 192) < 1e-10);
  assert.ok(Math.abs(volumes.reduce((a, b) => a + b) - 320) < 1e-10);
  assert.ok(measurements.every(m => m.boundToConstruction && m.validity.brep && m.validity.closed && m.validity.positive));
  const spare = model.bodies.find(body => body.name === 'spare');
  assert.ok(spare, 'properties are inherited from the source, not replaced by instance IDs');
  assert.equal(spare.description, 'Frozen source rail');
  assert.equal(tagOf(spare.appearance), 'Color', 'copying preserves FeatureScript property types');
  assert.equal(spare.appearance.red, 0.2);
  assert.equal(spare.provenance.sourceSha256, sha(read('source.fs')));
  assert.equal(spare.provenance.microversion, revision);
  assert.ok(spare.id.includes('Auto0'), 'std automatic instance name');
  assert.equal(manifestInputFiles(manifest).length, 1);
});

test('unresolved imported namespace refuses by name instead of building a fallback solid', async () => {
  await assert.rejects(build(read('missing.fs'), { ...options, feature: 'missingDependency' }),
    e => e instanceof UnsupportedFeatureError && /Unresolved Onshape module 'missingRails': 333333333333333333333333 at version 444444444444444444444444/.test(e.message));
});

test('frozen R20 part names are enumerable without loading their unsupported analytic B-reps', async () => {
  const body = `const loaded = base::build({});
    const parts = evaluateQuery(loaded, qAllModifiableSolidBodies());
    var found = 0;
    for (var part in parts)
      if (getProperty(loaded, {"entity":part,"propertyType":PropertyType.NAME}) == "T05 R6d 249.2mm hopper floor") found += 1;
    if (size(parts) != 17 || found != 1) throw regenError("Frozen part-name selection failed");
    fCuboid(context,id+"local",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(1,1,1)*millimeter});`;
  const imports = `base::import(path : "${rawId}", version : "${rawRevision}");`;
  const model = await build(feature(body, imports), { moduleManifest: rawManifest, trace: false });
  assert.equal(model.bodies.length, 1);
  const geometry = body.replace('var found = 0;', 'try silent { evVolume(loaded,{"entities":qAllModifiableSolidBodies()}); } var found = 0;');
  await assert.rejects(build(feature(geometry, imports), { moduleManifest: rawManifest, trace: false }),
    e => e instanceof RustCapabilityError && /import\/onshape-brep-conversion-unavailable: 'base' part/.test(e.message));
});

test('source queries cannot be evaluated in the destination, and frozen sources cannot be mutated', async () => {
  await assert.rejects(build(feature(`const loaded=rails::build({});
    const parts=evaluateQuery(loaded,qAllModifiableSolidBodies()); evaluateQuery(context,parts[0]);`), options),
    /Query refers to a different modeling context/);
  await assert.rejects(build(feature(`const loaded=rails::build({});
    setProperty(loaded,{"entities":qAllModifiableSolidBodies(),"propertyType":PropertyType.NAME,"value":"changed"});`), options),
    /Cannot change properties in an imported source context/);
});

test('instance placement preserves the original SI binary64 value across addInstance and native copying', async () => {
  const model = await build(feature(`const loaded=rails::build({});
    const parts=evaluateQuery(loaded,qAllModifiableSolidBodies());
    var inst=newInstantiator(id+"imported");
    const selected=addInstance(inst,rails::build,{"name":"one","partQuery":parts[0],"loadedContext":loaded,
      "transform":transform(vector(10.000000000000002,0,0)*millimeter)});
    instantiate(context,inst);
    if(size(evaluateQuery(context,qOwnedByBody(selected,EntityType.FACE)))!=6 ||
       size(evaluateQuery(context,qCreatedBy(id+"imported"+"one",EntityType.FACE)))!=6)
       throw regenError("Instance topology creator identity lost");`), options);
  assert.equal(model.bodies.length, 1);
  const native = describeRustBody(rustModelKernel(model), model.bodies[0]).body;
  const bytes = Buffer.alloc(8); bytes.writeDoubleLE(10.000000000000002 * 0.001);
  assert.equal(native.frames.at(-1).translation[0], bytes.readBigUInt64LE().toString(16).padStart(16, '0'));
});

test('instantiation preserves toWorld construction axes rather than its rounded matrix cache', async () => {
  const model = await build(feature(`var inst=newInstantiator(id+"placed");
    const cs=coordSystem(vector(10,20,30)*millimeter,normalize(vector(1,1,1)),normalize(vector(1,1,-2)));
    addInstance(inst,rails::build,{"transform":toWorld(cs)}); instantiate(context,inst);`), options);
  assert.equal(model.bodies.length, 2);
  const native = describeRustBody(rustModelKernel(model), model.bodies[0]).body;
  const frame = native.frames.at(-1);
  // WC0 distinguishes the exact cross product of supplied X/Z from a rounded
  // explicit matrix. This wire contract guards downstream exact predicates.
  assert.equal(frame.kind, 'InterpreterImage');
  assert.equal(frame.origin[0], '3f847ae147ae147b'); // 10 mm as interpreter metres
  assert.equal(frame.x[0], '3fe279a74590331d');
  assert.equal(frame.z[2], 'bfea20bd700c2c3f');
});

test('frozen source files are hash-checked before regeneration and cyclic imports refuse explicitly', async t => {
  const dir = store(t), manifestPath = path.join(dir, 'modules.json');
  fs.appendFileSync(path.join(dir, 'source.fs'), '\n');
  await assert.rejects(build(read('derived.fs'), { moduleManifest: manifestPath, trace: false }), /Frozen module checksum mismatch: source.fs/);
  const cycle = feature('rails::build({});');
  fs.writeFileSync(path.join(dir, 'source.fs'), cycle);
  const json = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  json.modules[0].source = { file: 'source.fs', sha256: sha(cycle), feature: 'probe' };
  fs.writeFileSync(manifestPath, JSON.stringify(json));
  await assert.rejects(build(read('derived.fs'), { moduleManifest: manifestPath, trace: false }),
    e => e instanceof UnsupportedFeatureError && /Cyclic frozen Part Studio import 'rails'/.test(e.message));
  json.modules[0].parts = { file: 'captured-parts.json', sha256: '0'.repeat(64) };
  fs.writeFileSync(manifestPath, JSON.stringify(json));
  await assert.rejects(build(read('derived.fs'), { moduleManifest: manifestPath, trace: false }),
    /must use either a schema-2 regeneration source or captured parts\/bodies, not both/);
});

test('a regenerated frozen Part Studio can itself derive another frozen source revision', async t => {
  const dir = store(t), manifestPath = path.join(dir, 'modules.json');
  const json = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const middle = feature(`var inst=newInstantiator(id+"middle");
    addInstance(inst,rails::build,{}); instantiate(context,inst);`);
  fs.writeFileSync(path.join(dir, 'middle.fs'), middle);
  json.modules.push({ ...json.modules[0], element: '666666666666666666666666',
    source: { file: 'middle.fs', sha256: sha(middle), feature: 'probe' } });
  fs.writeFileSync(manifestPath, JSON.stringify(json));
  const model = await build(feature(`var inst=newInstantiator(id+"second");
    addInstance(inst,derived::build,{}); instantiate(context,inst);`,
    `derived::import(path : "666666666666666666666666", version : "${revision}");`), { moduleManifest: manifestPath, trace: false });
  assert.equal(model.bodies.length, 2);
  const kernel = rustModelKernel(model);
  assert.ok(Math.abs(model.bodies.reduce((sum, body) => sum + measureRustBody(kernel, body).volumeMm3, 0) - 256) < 1e-10);
  // General exact placement now supports arranged Boolean bodies too. Check
  // their geometry after nested regeneration, not merely that import succeeds.
  json.modules[1].source = { file: 'derived.fs', sha256: sha(read('derived.fs')), feature: 'derivedRailUnion' };
  fs.writeFileSync(manifestPath, JSON.stringify(json));
  // Hand oracle: union [4,16]×[0,4]×[0,4], spare [8,16]×[8,12]×[0,4].
  // Exercise both identity copying and a nontrivial exact quarter-turn placement.
  for (const placed of [false, true]) {
    const transform = placed ? '"transform":transform(matrix([[0,-1,0],[1,0,0],[0,0,1]]),vector(20,-3,5)*millimeter)' : '';
    const arranged = await build(feature(`var inst=newInstantiator(id+"arranged");
      addInstance(inst,derived::build,{${transform}}); instantiate(context,inst);`,
      `derived::import(path : "666666666666666666666666", version : "${revision}");`), { moduleManifest: manifestPath, trace: false });
    assert.equal(arranged.bodies.length, 2);
    const arrangedKernel = rustModelKernel(arranged);
    const measurements = arranged.bodies.map(body => measureRustBody(arrangedKernel, body)).sort((a, b) => a.volumeMm3 - b.volumeMm3);
    for (const [i, m] of measurements.entries()) {
      const expectedMin = placed ? (i === 0 ? [8, 5, 5] : [16, 1, 5]) : (i === 0 ? [8, 8, 0] : [4, 0, 0]);
      const expectedMax = placed ? [20 - (i === 0 ? 8 : 0), 13, 9] : [16, i === 0 ? 12 : 4, 4];
      assert.ok(Math.abs(m.volumeMm3 - (i === 0 ? 128 : 192)) < 1e-10);
      assert.ok(Math.abs(m.areaMm2 - (i === 0 ? 160 : 224)) < 1e-10);
      assert.ok(m.boundToConstruction && m.validity.brep && m.validity.closed && m.validity.positive);
      if (i === 1) assert.equal(m.certificate, 'ExactPlaneArrangement');
      for (let k = 0; k < 3; k++) {
        assert.ok(Math.abs(m.bboxMm.min[k] - expectedMin[k]) < 1e-10);
        assert.ok(Math.abs(m.bboxMm.max[k] - expectedMax[k]) < 1e-10);
      }
      // Check the observed boundary itself: a single genus-zero shell, closed
      // oriented edge incidence, and every planar face on a hand-derived box side.
      const { vertices, edges, faces } = m.projection;
      assert.equal(m.topology.bodies, 1);
      assert.equal(m.topology.shells, 1);
      assert.equal(m.topology.genus, 0);
      assert.equal(vertices.length - edges.length + faces.length, 2);
      const incidence = edges.map(() => []), sides = new Set();
      for (const face of faces) {
        assert.equal(face.length, 1, 'cuboid boundary has no face holes');
        const ends = face[0].map(([edge, forward]) => {
          incidence[edge].push(forward);
          return forward ? edges[edge] : [...edges[edge]].reverse();
        });
        ends.forEach((end, k) => assert.equal(end[1], ends[(k + 1) % ends.length][0]));
        const points = ends.map(([start]) => vertices[start]);
        const side = [0, 1, 2].flatMap(k => [expectedMin[k], expectedMax[k]].map((value, b) => ({ k, b, value })))
          .find(({ k, value }) => points.every(p => Math.abs(p[k] - value) < 1e-10));
        assert.ok(side, 'every face lies on the expected cuboid boundary');
        sides.add(`${side.k}/${side.b}`);
        // Sum the polygon area vector; collinear arrangement subdivisions do
        // not require the first three vertices to form a nondegenerate triangle.
        let normal = 0;
        const u = (side.k + 1) % 3, v = (side.k + 2) % 3;
        points.forEach((p, j) => { const q = points[(j + 1) % points.length]; normal += p[u] * q[v] - p[v] * q[u]; });
        assert.ok(normal * (side.b === 0 ? -1 : 1) > 0, 'boundary faces point outward');
      }
      assert.equal(sides.size, 6);
      incidence.forEach(uses => { assert.equal(uses.length, 2); assert.notEqual(uses[0], uses[1]); });
    }
    const {toStep} = await import('../src/exporters.mjs');
    assert.match(toStep(arranged), /MANIFOLD_SOLID_BREP/);
  }
  // Unsupported metrics must still propagate as typed capability errors even
  // through try silent and a nested regenerated source.
  await assert.rejects(build(feature(`var inst=newInstantiator(id+"arrangedScale");
    addInstance(inst,derived::build,{}); instantiate(context,inst);
    var joined = qUnion([]);
    for (var part in evaluateQuery(context,qAllModifiableSolidBodies()))
      if (evVolume(context,{"entities":part}) / (millimeter^3) > 190) joined = part;
    if (size(evaluateQuery(context,joined)) != 1) throw regenError("Expected arranged union for metric refusal");
    try silent { opPattern(context,id+"scale",{"entities":joined,
      "transforms":[transform(matrix([[2,0,0],[0,1,0],[0,0,1]]),vector(0,0,0)*millimeter)],"instanceNames":["scaled"]}); }`,
    `derived::import(path : "666666666666666666666666", version : "${revision}");`), { moduleManifest: manifestPath, trace: false }),
    e => e instanceof RustCapabilityError && /pattern\/metric-not-near-isometric/.test(e.message));
});

test('nested element-only imports resolve in their source document version, not the host document', async t => {
  const dir = store(t), manifestPath = path.join(dir, 'modules.json');
  const json = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const document = 'aaaaaaaaaaaaaaaaaaaaaaaa', documentVersion = 'bbbbbbbbbbbbbbbbbbbbbbbb';
  const middleId = '666666666666666666666666';
  const middle = feature(`var inst=newInstantiator(id+"middle");
    addInstance(inst,rails::build,{}); instantiate(context,inst);`);
  const leaf = feature(`fCuboid(context,id+"leaf",{
    "corner1":vector(0,0,0)*millimeter,"corner2":vector(2,3,4)*millimeter});`, '');
  fs.writeFileSync(path.join(dir, 'middle.fs'), middle);
  fs.writeFileSync(path.join(dir, 'leaf.fs'), leaf);
  // Keep the host's same-element entry first as a decoy (256 mm³, not 24).
  json.modules.push({ ...json.modules[0], document, documentVersion,
    source: { file: 'leaf.fs', sha256: sha(leaf), feature: 'probe' } });
  json.modules.push({ ...json.modules[0], document, documentVersion, element: middleId,
    source: { file: 'middle.fs', sha256: sha(middle), feature: 'probe' } });
  fs.writeFileSync(manifestPath, JSON.stringify(json));
  const model = await build(feature(`var inst=newInstantiator(id+"foreign");
    addInstance(inst,foreign::build,{}); instantiate(context,inst);`,
    `foreign::import(path : "${document}/${documentVersion}/${middleId}", version : "${revision}");`),
    { moduleManifest: manifestPath, trace: false });
  assert.equal(model.bodies.length, 1, 'nested dependency must not use the host document decoy');
  assert.ok(Math.abs(measureRustBody(rustModelKernel(model), model.bodies[0]).volumeMm3 - 24) < 1e-10);
});

test('regenerated imports share the caller execution budget across nested dependencies', async t => {
  const dir = store(t), manifestPath = path.join(dir, 'modules.json');
  const json = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const source = feature(`var sum=0; for(var i=0;i<1000;i+=1) sum+=i;
    fCuboid(context,id+"leaf",{"corner1":vector(0,0,0)*millimeter,"corner2":vector(1,1,1)*millimeter});`, '');
  fs.writeFileSync(path.join(dir, 'source.fs'), source);
  json.modules[0].source = { file: 'source.fs', sha256: sha(source), feature: 'probe' };
  fs.writeFileSync(manifestPath, JSON.stringify(json));
  const imported = feature(`try silent { var inst=newInstantiator(id+"imported");
    addInstance(inst,rails::build,{}); instantiate(context,inst); }`);
  await assert.rejects(build(imported, { moduleManifest: manifestPath, trace: false, maxSteps: 1000 }),
    /Execution limit exceeded \(1000 expression\/statement steps\)/);
  const model = await build(imported, { moduleManifest: manifestPath, trace: false, maxSteps: 12000 });
  assert.equal(model.bodies.length, 1, 'a sufficient caller budget must allow the same source');
  const middleId = '666666666666666666666666';
  const middle = feature(`var sum=0; for(var i=0;i<1000;i+=1) sum+=i;
    var inst=newInstantiator(id+"nested"); addInstance(inst,rails::build,{}); instantiate(context,inst);`);
  fs.writeFileSync(path.join(dir, 'middle.fs'), middle);
  json.modules.push({ ...json.modules[0], element: middleId,
    source: { file: 'middle.fs', sha256: sha(middle), feature: 'probe' } });
  fs.writeFileSync(manifestPath, JSON.stringify(json));
  await assert.rejects(build(feature(`var inst=newInstantiator(id+"aggregate");
    addInstance(inst,middle::build,{}); instantiate(context,inst);`,
    `middle::import(path : "${middleId}", version : "${revision}");`),
    { moduleManifest: manifestPath, trace: false, maxSteps: 12000 }),
    /Execution limit exceeded \(12000 expression\/statement steps\)/);
});

test('a later unconvertible import publishes none of the earlier native instances', async () => {
  const kernel = await loadKernel(), target = new ModelingContext(kernel);
  const create = () => new ModelingContext(kernel);
  const nativeResolver = frozenModules(manifest, '', create);
  const rawResolver = frozenModules(rawManifest, '', create);
  const nativeBuild = nativeResolver({ namespace: 'rails', path: sourceId, version: revision }).build;
  const rawBuild = rawResolver({ namespace: 'raw', path: rawId, version: rawRevision }).build;
  const { newInstantiator, addInstance, instantiate } = instantiatorBuiltins(target);
  const inst = newInstantiator.call([new Id(['imported'])]);
  addInstance.call([inst, nativeBuild, map({})]);
  addInstance.call([inst, rawBuild, map({})]);
  assert.throws(() => instantiate.call([target.context, inst]),
    e => e instanceof RustCapabilityError && /import\/onshape-brep-conversion-unavailable/.test(e.message));
  assert.equal(target.records.size, 0, 'earlier native copies must not leak');
  assert.equal(target.ids.size, 0, 'failed instantiation must not claim its operation ID');
  assert.equal(inst.done, false);
});

}
