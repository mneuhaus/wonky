import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { booleanPortCases } from './boolean-port-cases.mjs';
import { booleanPortNames, loadBooleanPort, preparePortClip, runPortClip, decodePortResult, portComponents } from '../src/boolean-ports.mjs';
import { array } from '../src/kernel.mjs';
import { coords } from '../src/real.mjs';
import { toStep } from '../src/exporters.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const json = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
const sub = (a, b) => a.map((x, i) => x - b[i]);
const dot = (a, b) => a.reduce((sum, x, i) => sum + x * b[i], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const almost = (a, b) => Math.abs(a - b) <= 2e-8 * Math.max(1, Math.abs(b));
const summary = values => {
  const sorted = values.toSorted((a, b) => a - b);
  return { samples: values, median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.ceil(sorted.length * 0.95) - 1] };
};

function sources() {
  const files = ['bend.lock.json', 'src/boolean-ports.mjs', 'scripts/boolean-port-cases.mjs', 'scripts/compare-boolean-ports.mjs'];
  for (const directory of ['kernel', 'src']) {
    for (const path of readdirSync(join(root, directory), { recursive: true }).filter(path => /\.(bend|mjs)$/.test(path))) files.push(`${directory}/${path}`);
  }
  return Object.fromEntries([...new Set(files)].sort().map(file => [file, hash(readFileSync(join(root, file)))]));
}

// Independent output check, never used to construct production geometry.
// Signed fans integrate planar polygon loops even for concave polygons/holes.
function planarVolume(body) {
  if (body.faces.some(f => f.surface.type !== 'plane') || body.edges.some(e => e.curve.type !== 'line')) return null;
  const reference = body.vertices[0]; let volume = 0;
  for (const face of body.faces) for (const loop of face.loops) {
    const points = loop.map(use => { const e = body.edges[use.edge]; return body.vertices[use.forward ? e.start : e.end]; });
    const a = sub(points[0], reference);
    for (let i = 1; i + 1 < points.length; i++) volume += dot(a, cross(sub(points[i], reference), sub(points[i + 1], reference))) / 6;
    const n = face.surface.normal;
    let twiceArea = 0;
    for (let i = 0; i < points.length; i++) {
      assert.ok(Math.abs(dot(sub(points[i], face.surface.origin), n)) < 1e-6, 'output face incidence');
      twiceArea += dot(cross(sub(points[i], points[0]), sub(points[(i + 1) % points.length], points[0])), n);
    }
    const outer = face.outer[face.loops.indexOf(loop)];
    assert.ok(twiceArea * (face.sameSense ? 1 : -1) * (outer ? 1 : -1) > 0, 'output trim orientation');
  }
  assert.ok(volume > 0, 'positive output component volume');
  return volume;
}

function validateOrigins(component, input) {
  const faces = array(component.face_origins), edges = array(component.edge_origins);
  const nf = array(input.solid.faces).length, ne = array(input.solid.edges).length;
  for (const origin of faces) assert.ok(origin.$ === 'CutFace' || (origin.$ === 'SourceFace' && Number.isInteger(origin.index) && origin.index >= 0 && origin.index < nf));
  for (const origin of edges) assert.ok((origin.$ === 'SourceEdge' && Number.isInteger(origin.index) && origin.index >= 0 && origin.index < ne) ||
    (origin.$ === 'CutEdge' && Number.isInteger(origin.face) && origin.face >= 0 && origin.face < nf));
}

export async function compareBooleanPorts({ variants = booleanPortNames, out = join(root, 'out/boolean-ports/comparison'), independentStep = true, imported = true, samples = 9 } = {}) {
  out = resolve(out); mkdirSync(out, { recursive: true });
  const before = sources(), rows = [], exports = [], loading = {}, kernels = new Map();
  const cases = await booleanPortCases({ imported });
  for (const name of variants) {
    const start = performance.now(); kernels.set(name, await loadBooleanPort(name));
    loading[name] = { processLocalLoadMs: performance.now() - start, scope: 'load/compile/cache/import; not a cold-start or geometry comparison' };
  }
  for (const fixture of cases) {
    const prepared = await preparePortClip(fixture.body, fixture.plane, fixture.options);
    const initial = JSON.stringify(prepared), inputSha256 = hash(initial);
    for (const name of variants) {
      const row = { case: fixture.id, category: fixture.category, variant: name, inputSha256, expected: fixture.expected };
      try {
        const kernel = kernels.get(name), native = runPortClip(kernel, prepared);
        row.nativeStatus = native.$; row.reason = native.reason?.$ ?? null;
        assert.equal(JSON.stringify(prepared), initial, 'source geometry mutated');
        if (native.$ === 'Unresolved') {
          assert.equal(native.solid, undefined); assert.equal(native.bodies, undefined);
          row.status = fixture.expected.kind === 'reject' ? 'correct-rejection' : 'unresolved';
        } else {
          assert.notEqual(fixture.expected.kind, 'reject', 'malformed input accepted');
          const components = portComponents(native), bodies = await decodePortResult(native, name, fixture.id);
          components.forEach(component => validateOrigins(component, prepared));
          row.topology = bodies.map(body => ({ vertices: body.vertices.length, edges: body.edges.length, faces: body.faces.length }));
          row.components = bodies.length;
          const volumes = bodies.map(planarVolume);
          row.referenceMeasuredVolumeMm3 = volumes.every(v => v !== null) ? volumes.reduce((a, b) => a + b, 0) : null;
          if (fixture.expected.kind === 'solid' || fixture.expected.kind === 'empty') {
            assert.equal(bodies.length, fixture.expected.components, 'component count');
            if (row.referenceMeasuredVolumeMm3 !== null) assert.ok(almost(row.referenceMeasuredVolumeMm3, fixture.expected.volume), `volume ${row.referenceMeasuredVolumeMm3} != ${fixture.expected.volume}`);
          }
          const o = coords(prepared.origin), n = coords(prepared.normal), scale = Math.hypot(...n);
          for (const body of bodies) for (const p of body.vertices) assert.ok(dot(sub(p, o), n) / scale < 1e-6, 'output outside retained halfspace');
          row.status = 'valid-local';
          if (bodies.length) {
            const prefix = join(out, `${name}-${fixture.id}`);
            const version = JSON.parse(readFileSync(join(root, 'bend.lock.json'))).version;
            const model = { schema: 'wonky-brep/1', units: 'millimeter', backend: { language: 'Bend', version }, bodies };
            json(`${prefix}.brep.json`, model); writeFileSync(`${prefix}.step`, toStep(model, `${name}-${fixture.id}`));
            row.export = { prefix, brepSha256: hash(readFileSync(`${prefix}.brep.json`)), stepSha256: hash(readFileSync(`${prefix}.step`)) };
            exports.push({ prefix, row });
          }
        }
        // Repeated calls are timed on exactly the same input. Rejections and
        // successful constructions remain separate categories in the report.
        for (let i = 0; i < 3; i++) runPortClip(kernel, prepared);
        const times = [];
        for (let i = 0; i < samples; i++) {
          const start = performance.now(), repeated = runPortClip(kernel, prepared); times.push(performance.now() - start);
          assert.equal(repeated.$, native.$, 'nondeterministic result status');
        }
        row.nativeMs = summary(times);
        assert.equal(JSON.stringify(prepared), initial, 'source changed in repeated execution');
      } catch (error) {
        row.status = 'invalid'; row.error = error.stack ?? String(error);
      }
      rows.push(row);
    }
  }
  if (independentStep) for (const { prefix, row } of exports) {
    const result = spawnSync('uv', ['run', 'scripts/validate-step.py', prefix], { cwd: root, encoding: 'utf8', timeout: 60000 });
    try {
      assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout);
      const verified = JSON.parse(result.stdout); assert.equal(verified.length, 1); assert.equal(verified[0].valid, true);
      row.independentStep = verified[0];
      if (row.expected.kind === 'solid') assert.ok(almost(verified[0].volumeMm3, row.expected.volume), 'independent STEP volume differs from analytic reference');
      row.status = 'valid-independent';
    } catch (error) {
      row.status = 'invalid'; row.error = error.stack ?? String(error);
      row.independentStep = { stdout: result.stdout, stderr: result.stderr, status: result.status };
    }
  }
  const after = sources(), stable = JSON.stringify(before) === JSON.stringify(after);
  const totals = Object.fromEntries(variants.map(name => [name, rows.filter(row => row.variant === name).reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1; return acc;
  }, {})]));
  const report = { schema: 'wonky-boolean-port-comparison/1', createdAt: new Date().toISOString(),
    scope: 'Independent scoped Bend reference adaptations of halfspace construction. Not full upstream kernels. Timings include native JS interop only after load.',
    runtime: { node: process.versions.node, platform: process.platform, arch: process.arch },
    implementation: { stable, sha256: hash(JSON.stringify(before)), files: before }, loading, totals, rows };
  json(join(out, 'report.json'), report);
  assert.ok(stable, 'Implementation changed during comparison; evidence is invalid');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), variants = args.filter(arg => !arg.startsWith('--'));
  const report = await compareBooleanPorts({ ...(variants.length ? { variants } : {}), independentStep: !args.includes('--no-step'), imported: !args.includes('--no-imports') });
  console.log(JSON.stringify({ implementationStable: report.implementation.stable, totals: report.totals,
    invalid: report.rows.filter(row => row.status === 'invalid').map(row => ({ case: row.case, variant: row.variant, error: row.error })) }, null, 2));
  if (report.rows.some(row => row.status === 'invalid')) process.exitCode = 1;
}
